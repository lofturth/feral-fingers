#!/usr/bin/env python3
"""Local serial-to-SSE bridge for the five-IMU binary stream."""
import argparse
import collections
import importlib.util
import json
import queue
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import serial
from serial.tools import list_ports

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("imu_decoder", ROOT.parent / "embedded/five-imu-stream/decode_binary.py")
decoder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(decoder)

def normalized_serial(value):
    return ''.join(ch for ch in (value or '').lower() if ch.isalnum())


def find_feather(serial_number, preferred_port=None):
    expected = normalized_serial(serial_number)
    matches = [p.device for p in list_ports.comports()
               if p.vid == 0x303a and p.pid == 0x1001
               and expected and normalized_serial(p.serial_number) == expected]
    return preferred_port if preferred_port in matches else (matches[0] if matches else None)


class Bridge:
    def __init__(self, serial_number, preferred_port=None):
        self.serial_number = serial_number
        self.preferred_port = preferred_port
        self.port = None
        self.lock = threading.Lock()
        self.subscribers = set()
        self.stop_event = threading.Event()
        self.thread = None
        self.state = "disconnected"
        self.message = ""
        self.gaps = self.crc = self.errors = self.received = 0
        self.last_seq = self.last_us = None
        self.last_wall = 0
        self.rate_window = collections.deque()
        self.generation = 0

    def start(self):
        with self.lock:
            if self.thread and self.thread.is_alive():
                return
            self.stop_event.clear()
            self.state = "connecting"
            self.message = ""
            self.gaps = self.crc = self.errors = self.received = 0
            self.last_seq = self.last_us = None
            self.last_wall = 0
            self.rate_window.clear()
            self.thread = threading.Thread(target=self.run, daemon=True)
            self.thread.start()

    def stop(self):
        self.stop_event.set()

    def publish(self, obj):
        with self.lock:
            targets = list(self.subscribers)
        for q in targets:
            try:
                q.put_nowait(obj)
            except queue.Full:
                try:
                    q.get_nowait()
                    q.put_nowait(obj)
                except (queue.Empty, queue.Full):
                    pass

    def status(self):
        with self.lock:
            age = (time.monotonic() - self.last_wall) if self.last_wall else None
            now = time.monotonic()
            while self.rate_window and self.rate_window[0] < now - 2:
                self.rate_window.popleft()
            rate = ((len(self.rate_window)-1)/(self.rate_window[-1]-self.rate_window[0])
                    if len(self.rate_window)>1 and self.rate_window[-1]>self.rate_window[0] else 0)
            return dict(state=self.state, message=self.message, age=age, rate=rate, generation=self.generation,
                        gaps=self.gaps, crc=self.crc, errors=self.errors,
                        received=self.received, timestamp_us=self.last_us, port=self.port)

    def run(self):
        while not self.stop_event.is_set():
            try:
                port = find_feather(self.serial_number, self.preferred_port)
            except OSError:
                port = None
            if not port:
                with self.lock:
                    self.state, self.message, self.port = "waiting", "Waiting for the Feather", None
                self.publish({"samples": [], "status": self.status()})
                self.stop_event.wait(1.0)
                continue
            buf = bytearray()
            batch = []
            try:
                with serial.Serial(port, 115200, timeout=.05) as device:
                    now = time.monotonic()
                    last_publish = last_data = now
                    with self.lock:
                        self.port = port
                        self.state, self.message = "connected", ""
                        self.generation += 1
                        self.last_seq = self.last_us = None
                        self.last_wall = 0
                        self.rate_window.clear()
                    self.publish({"samples": [], "status": self.status()})
                    while not self.stop_event.is_set():
                        chunk = device.read(4096)
                        now = time.monotonic()
                        if chunk:
                            buf.extend(chunk)
                            last_data = now
                        elif now-last_data > 2:
                            raise serial.SerialException("No serial data for two seconds")
                        while True:
                            start = buf.find(decoder.MAGIC)
                            if start < 0:
                                if len(buf) > 3:
                                    del buf[:-3]
                                break
                            if start:
                                del buf[:start]
                            if len(buf) < decoder.SIZE:
                                break
                            packets, _, _, _ = decoder.decode(bytes(buf[:decoder.SIZE]))
                            if not packets:
                                with self.lock:
                                    self.crc += 1
                                del buf[0]
                                continue
                            del buf[:decoder.SIZE]
                            seq, timestamp, _, _, sensors, _ = packets[0]
                            now = time.monotonic()
                            converted = []
                            for sensor in sensors:
                                ident, status, error, _, offset, ax, ay, az, gx, gy, gz = sensor
                                converted.append([ident, status, error, offset,
                                                  ax*.000061, ay*.000061, az*.000061,
                                                  gx*.00875, gy*.00875, gz*.00875])
                            with self.lock:
                                if self.last_seq is not None:
                                    delta = (seq - self.last_seq) & 0xffffffff
                                    if 1 < delta < 0x80000000:
                                        self.gaps += delta - 1
                                self.last_seq, self.last_us = seq, timestamp
                                self.last_wall = now
                                self.received += 1
                                self.errors += sum(s[2] != 0 for s in sensors)
                                self.rate_window.append(now)
                            batch.append([timestamp, converted])
                        now = time.monotonic()
                        if batch and (now-last_publish >= .05 or len(batch)>=100):
                            self.publish({"samples": batch, "status": self.status()})
                            batch = []
                            last_publish = now
            except (serial.SerialException, OSError) as exc:
                with self.lock:
                    self.state, self.message, self.port = "waiting", str(exc), None
                    self.last_wall = 0
                    self.rate_window.clear()
                self.publish({"samples": [], "status": self.status()})
                self.stop_event.wait(1.0)
        with self.lock:
            self.state, self.message, self.port = "disconnected", "", None
        self.publish({"samples": [], "status": self.status()})

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        if self.path == "/events":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            q = queue.Queue(maxsize=20)
            with bridge.lock:
                bridge.subscribers.add(q)
            try:
                while True:
                    try:
                        obj = q.get(timeout=1)
                    except queue.Empty:
                        obj = {"samples": [], "status": bridge.status()}
                    self.wfile.write(("data: " + json.dumps(obj, separators=(",", ":")) + "\n\n").encode())
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            finally:
                with bridge.lock:
                    bridge.subscribers.discard(q)
        elif self.path == "/status":
            data = json.dumps(bridge.status()).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        else:
            super().do_GET()

    def do_POST(self):
        if self.path not in ("/start", "/stop"):
            self.send_error(404)
            return
        if self.path == "/start":
            bridge.start()
        else:
            bridge.stop()
        self.send_response(204)
        self.end_headers()

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--port", help="preferred serial path; identity is still checked")
    p.add_argument("--serial-number", default="D0:CF:13:0A:F4:E0", help="Feather USB serial number")
    p.add_argument("--http-port", type=int, default=8766)
    args = p.parse_args()
    bridge = Bridge(args.serial_number, args.port)
    bridge.start()
    server = ThreadingHTTPServer(("127.0.0.1", args.http_port), Handler)
    print(f"Dashboard: http://127.0.0.1:{args.http_port}  Feather serial: {args.serial_number}", flush=True)
    try:
        server.serve_forever()
    finally:
        bridge.stop()
        server.server_close()
