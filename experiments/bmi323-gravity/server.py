#!/usr/bin/env python3
"""Local BMI323 serial-to-SSE bridge with optional CoreMIDI output."""

import argparse
import json
import math
import os
import queue
import select
import socket
import statistics
import struct
import termios
import threading
import time
import tty
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).parent
subscribers = set()
subscribers_lock = threading.Lock()
connected = False
midi_bridge = None
dual_mode = False
wireless_stats = None
UDP_PACKET = struct.Struct("<4sIQQQQQII12h4B")


def z_to_cc1(z):
    return max(0, min(127, int(z * 127 + 0.5)))


def z_to_pitch_bend(z):
    return max(0, min(16383, int(z * 16383 + 0.5)))


class MidiBridge:
    def __init__(self, output):
        self.output = output
        self.lock = threading.Lock()
        self.mode = "mod-wheel"
        self.gravity_z = None
        self.last_value = None

    def _send(self, message):
        if self.output is None:
            return
        try:
            self.output.send_message(message)
        except (RuntimeError, OSError) as exc:
            print(f"MIDI send failed ({exc}); dashboard will continue", flush=True)
            self.output = None

    def _value(self):
        if self.gravity_z is None:
            return None
        mapper = z_to_cc1 if self.mode == "mod-wheel" else z_to_pitch_bend
        return mapper(self.gravity_z)

    def _send_current(self):
        value = self._value()
        if value is not None and value != self.last_value:
            message = [0xB0, 1, value] if self.mode == "mod-wheel" else [0xE0, value & 0x7f, value >> 7]
            self._send(message)
            self.last_value = value
        return value

    def update(self, gravity_z):
        with self.lock:
            self.gravity_z = gravity_z
            return self.mode, self._send_current()

    def select(self, mode):
        with self.lock:
            if mode != self.mode:
                self._send([0xB0, 1, 0] if self.mode == "mod-wheel" else [0xE0, 0, 64])
                self.mode = mode
                self.last_value = None
            return self.mode, self._send_current()

    def state(self):
        with self.lock:
            return {"mode": self.mode, "value": self._value(), "available": self.output is not None}


class GravityEstimator:
    # Accelerometer correction reaches 63% of an error in one second.
    correction_seconds = 1.0

    def __init__(self):
        self.gravity = None
        self.last_us = None

    def update(self, accel, gyro, timestamp_us):
        norm = math.sqrt(sum(value * value for value in accel))
        measured = tuple(value / norm for value in accel) if 0.5 <= norm <= 1.5 else None
        dt = None if self.last_us is None else (timestamp_us - self.last_us) / 1_000_000
        self.last_us = timestamp_us
        if dt is None or dt <= 0 or dt > 0.25 or self.gravity is None:
            self.gravity = measured or self.gravity
            return self.gravity
        if any(abs(rate) > 2000 for rate in gyro):
            return self.gravity
        wx, wy, wz = (math.radians(rate) for rate in gyro)
        gx, gy, gz = self.gravity
        # A body-frame gravity vector rotates opposite to the sensor's gyro rotation.
        gx, gy, gz = (gx + (gy * wz - gz * wy) * dt,
                      gy + (gz * wx - gx * wz) * dt,
                      gz + (gx * wy - gy * wx) * dt)
        if measured is not None:
            correction = 1 - math.exp(-dt / self.correction_seconds)
            gx += correction * (measured[0] - gx)
            gy += correction * (measured[1] - gy)
            gz += correction * (measured[2] - gz)
        norm = math.sqrt(gx * gx + gy * gy + gz * gz)
        self.gravity = (gx / norm, gy / norm, gz / norm)
        return self.gravity


def open_midi():
    try:
        import rtmidi
        output = rtmidi.MidiOut(rtmidi.API_MACOSX_CORE)
        output.open_virtual_port("BMI323 Mod Wheel")
        print("MIDI source: BMI323 Mod Wheel (channel 1)", flush=True)
        return output
    except (ImportError, RuntimeError, OSError) as exc:
        print(f"MIDI unavailable ({exc}); dashboard will continue", flush=True)
        return None


def broadcast(kind, payload):
    message = f"event: {kind}\ndata: {json.dumps(payload, separators=(',', ':'))}\n\n".encode()
    with subscribers_lock:
        for inbox in subscribers:
            try:
                inbox.put_nowait(message)
            except queue.Full:
                try:
                    inbox.get_nowait()
                    inbox.put_nowait(message)
                except queue.Empty:
                    pass


def set_connected(value):
    global connected
    if value != connected:
        connected = value
        broadcast("status", {"connected": value, "dual": dual_mode})
        print(("UDP" if wireless_stats is not None else "Serial") +
              (" connected" if value else " disconnected"), flush=True)


def emit_dual(seq, start_us, raw_values, read_times, ok, estimators):
    sensors = []
    for index, address in enumerate(("0x68", "0x69")):
        if not ok[index]:
            sensors.append(None)
            continue
        raw = raw_values[index]
        values = [value / 16384 for value in raw[:3]] + [value / 65.536 for value in raw[3:]]
        timestamp_us = sum(read_times[index]) // 2
        gravity = estimators[index].update(values[:3], values[3:], timestamp_us)
        sensors.append({"address": address, "us": timestamp_us, "v": values, "gravity": gravity})
    broadcast("dual", {"seq": seq, "us": start_us, "sensors": sensors})


class WirelessStats:
    def __init__(self):
        self.lock = threading.Lock()
        self.first_ns = self.last_ns = self.last_acq = self.last_seq = None
        self.count = self.gaps = self.out_of_order = 0
        self.arrivals = []
        self.acquisitions = []
        self.durations = []
        self.missed = self.dropped = 0

    def add(self, seq, acq_us, duration_us, missed, dropped, arrival_ns):
        with self.lock:
            if self.first_ns is None:
                self.first_ns = arrival_ns
            if self.last_ns is not None:
                self.arrivals.append((arrival_ns - self.last_ns) / 1000)
                self.acquisitions.append(acq_us - self.last_acq)
            if self.last_seq is not None:
                if seq > self.last_seq + 1:
                    self.gaps += seq - self.last_seq - 1
                elif seq <= self.last_seq:
                    self.out_of_order += 1
            self.last_ns, self.last_acq, self.last_seq = arrival_ns, acq_us, seq
            self.count += 1
            self.durations.append(duration_us)
            self.missed, self.dropped = missed, dropped
            for values in (self.arrivals, self.acquisitions, self.durations):
                if len(values) > 24000:
                    del values[:1000]

    def snapshot(self):
        with self.lock:
            def metrics(values):
                if not values:
                    return None
                ordered = sorted(values)
                return {"mean": round(statistics.mean(values), 1), "min": min(values),
                        "p95": ordered[round((len(ordered) - 1) * .95)],
                        "p99": ordered[round((len(ordered) - 1) * .99)], "max": max(values)}
            elapsed = (self.last_ns - self.first_ns) / 1e9 if self.count > 1 else 0
            return {"packets": self.count, "elapsed_s": round(elapsed, 3),
                    "received_hz": round((self.count - 1) / elapsed, 2) if elapsed else 0,
                    "sequence_gaps": self.gaps, "out_of_order": self.out_of_order,
                    "device_missed": self.missed, "device_dropped": self.dropped,
                    "arrival_us": metrics(self.arrivals),
                    "arrival_jitter_us": metrics([abs(x - 2500) for x in self.arrivals]),
                    "acquisition_interval_us": metrics(self.acquisitions),
                    "acquisition_duration_us": metrics(self.durations)}


def udp_reader(port, stop):
    global wireless_stats
    wireless_stats = WirelessStats()
    estimators = [GravityEstimator(), GravityEstimator()]
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.bind(("0.0.0.0", port))
        sock.settimeout(1)
        print(f"Listening for UDP on port {port}", flush=True)
        last_report = time.monotonic()
        while not stop.is_set():
            try:
                data, _ = sock.recvfrom(256)
            except socket.timeout:
                if connected and time.monotonic() - last_report > 2:
                    set_connected(False)
                continue
            arrival_ns = time.monotonic_ns()
            if len(data) != UDP_PACKET.size:
                continue
            magic, seq, start, a_begin, a_end, b_begin, b_end, missed, dropped, *rest = UDP_PACKET.unpack(data)
            if magic != b"FFU1":
                continue
            raw = [rest[:6], rest[6:12]]
            ok = rest[12:14]
            wireless_stats.add(seq, start, b_end - start, missed, dropped, arrival_ns)
            emit_dual(seq, start, raw, [(a_begin, a_end), (b_begin, b_end)], ok, estimators)
            if not connected:
                set_connected(True)
            if time.monotonic() - last_report >= 1:
                broadcast("wireless", wireless_stats.snapshot())
                last_report = time.monotonic()


def serial_reader(port, bridge, stop):
    estimator = GravityEstimator()
    dual_estimators = [GravityEstimator(), GravityEstimator()]
    while not stop.is_set():
        fd = None
        try:
            fd = os.open(port, os.O_RDONLY | os.O_NOCTTY | os.O_NONBLOCK)
            tty.setraw(fd)
            attrs = termios.tcgetattr(fd)
            attrs[4] = attrs[5] = termios.B115200
            termios.tcsetattr(fd, termios.TCSANOW, attrs)
            set_connected(True)
            pending = b""
            while not stop.is_set():
                if not select.select([fd], [], [], 1)[0]:
                    continue
                chunk = os.read(fd, 4096)
                if not chunk:
                    raise OSError("serial device closed")
                pending += chunk
                if len(pending) > 8192:
                    pending = pending[-4096:]
                while b"\n" in pending:
                    line, pending = pending.split(b"\n", 1)
                    line = line.strip()
                    if line.startswith(b"#"):
                        print(line.decode(errors="replace"), flush=True)
                        continue
                    if dual_mode and line.startswith(b"D,"):
                        try:
                            fields = line.decode("ascii").split(",")
                            if len(fields) != 28 or fields[6] != "0x68" or fields[16] != "0x69":
                                continue
                            seq = int(fields[1])
                            raw_values, read_times, ok = [], [], []
                            for index, base in enumerate((6, 16)):
                                ok.append(fields[base + 1] == "1")
                                read_times.append((int(fields[base + 2]), int(fields[base + 3])))
                                raw_values.append([int(value) for value in fields[base + 4:base + 10]])
                            emit_dual(seq, int(fields[3]), raw_values, read_times, ok, dual_estimators)
                        except ValueError:
                            continue
                        continue
                    if dual_mode or not line.startswith(b"M,"):
                        continue
                    try:
                        fields = line.decode("ascii").split(",")
                        if len(fields) != 9:
                            continue
                        values = [float(v) for v in fields[3:]]
                        if not all(abs(v) < 100000 for v in values):
                            continue
                        timestamp_us = int(fields[2])
                        cc1 = z_to_cc1(values[2])
                        gravity = estimator.update(values[:3], values[3:], timestamp_us)
                        mode, midi_value = bridge.update(gravity[2] if gravity else None)
                        broadcast("sample", {"seq": int(fields[1]), "us": timestamp_us, "v": values,
                                             "cc1": cc1, "estimatedCc1": z_to_cc1(gravity[2]) if gravity else None,
                                             "gravity": gravity, "midiMode": mode, "midiValue": midi_value})
                    except ValueError:
                        continue
        except OSError as exc:
            set_connected(False)
            print(f"Waiting for {port}: {exc}", flush=True)
            stop.wait(1)
        finally:
            if fd is not None:
                os.close(fd)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        if self.path == "/wireless-stats":
            body = json.dumps(wireless_stats.snapshot() if wireless_stats else {}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path != "/events":
            return super().do_GET()
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        inbox = queue.Queue(maxsize=300)
        with subscribers_lock:
            subscribers.add(inbox)
        try:
            self.wfile.write(f"event: status\ndata: {json.dumps({'connected': connected, 'dual': dual_mode})}\n\n".encode())
            self.wfile.write(f"event: midi\ndata: {json.dumps(midi_bridge.state())}\n\n".encode())
            self.wfile.flush()
            while True:
                try:
                    message = inbox.get(timeout=5)
                except queue.Empty:
                    message = b": keepalive\n\n"
                self.wfile.write(message)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            with subscribers_lock:
                subscribers.discard(inbox)

    def do_POST(self):
        if self.path != "/midi-mode":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length < 100:
                raise ValueError("invalid body size")
            mode = json.loads(self.rfile.read(length))["mode"]
            if mode not in ("mod-wheel", "pitch-bend"):
                raise ValueError("invalid MIDI mode")
        except (ValueError, KeyError, TypeError):
            self.send_error(400, "Expected mod-wheel or pitch-bend mode")
            return
        midi_bridge.select(mode)
        state = midi_bridge.state()
        broadcast("midi", state)
        body = json.dumps(state).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=4188)
    parser.add_argument("--serial", default="/dev/cu.usbmodem1101")
    parser.add_argument("--no-midi", action="store_true", help="run the dashboard without MIDI output")
    parser.add_argument("--dual", action="store_true", help="show both BMI323 sensors without MIDI")
    parser.add_argument("--udp-port", type=int, help="receive dual-sensor UDP instead of USB serial")
    args = parser.parse_args()
    dual_mode = args.dual or args.udp_port is not None
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    midi = None if args.no_midi or dual_mode else open_midi()
    midi_bridge = MidiBridge(midi)
    stop = threading.Event()
    reader = threading.Thread(target=udp_reader if args.udp_port is not None else serial_reader,
                              args=(args.udp_port, stop) if args.udp_port is not None else
                              (args.serial, midi_bridge, stop), daemon=True)
    reader.start()
    print(f"Open http://127.0.0.1:{args.port} " +
          (f"(UDP {args.udp_port})" if args.udp_port is not None else f"(serial {args.serial})"), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        server.server_close()
        reader.join(timeout=2)
        if midi is not None:
            midi.close_port()
