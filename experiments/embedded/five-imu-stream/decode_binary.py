#!/usr/bin/env python3
"""Capture or analyze the fixed-size binary-200 stream."""
import argparse
import binascii
import collections
import statistics
import struct
import time

MAGIC = b"FFIM"
SIZE = 136
HEADER = struct.Struct("<4sBBHIQQQQ")
SENSOR = struct.Struct("<BBBBH6h")

def decode(data):
    packets, corrupt, skipped = [], 0, 0
    pos = 0
    while pos + SIZE <= len(data):
        start = data.find(MAGIC, pos)
        if start < 0 or start + SIZE > len(data):
            break
        skipped += start - pos
        raw = data[start:start + SIZE]
        magic, version, count, length, seq, timestamp, deadline, end, prev_end = HEADER.unpack_from(raw)
        crc = int.from_bytes(raw[-2:], "little")
        if version != 1 or count != 5 or length != SIZE or binascii.crc_hqx(raw[:-2], 0xffff) != crc:
            corrupt += 1
            pos = start + 1
            continue
        sensors = [SENSOR.unpack_from(raw, HEADER.size + i * SENSOR.size) for i in range(5)]
        if [s[0] for s in sensors] != list(range(5)):
            corrupt += 1
            pos = start + 1
            continue
        packets.append((seq, timestamp, deadline, end, sensors, prev_end))
        pos = start + SIZE
    return packets, corrupt, skipped, len(data)-pos

def summarize(data):
    p, corrupt, skipped, trailing = decode(data)
    print(f"valid_packets={len(p)} corrupt_candidates={corrupt} skipped_bytes={skipped} trailing_bytes={trailing}")
    if len(p) < 2:
        return
    intervals = [b[1]-a[1] for a,b in zip(p,p[1:])]
    missing = sum(max(0, ((b[0]-a[0]) & 0xffffffff)-1) for a,b in zip(p,p[1:]))
    err = sum(s[2] != 0 for row in p for s in row[4])
    complete = [row for row in p if all(s[2] == 0 for s in row[4])]
    spans = [row[4][-1][4] - row[4][0][4] for row in complete]
    duration = (p[-1][1]-p[0][1])/1e6
    complete_rate = ((len(complete)-1)*1e6/(complete[-1][1]-complete[0][1])) if len(complete)>1 else 0
    print(f"duration_s={duration:.3f} packet_hz={(len(p)-1)/duration:.3f} complete={len(complete)} complete_sweeps_per_s={complete_rate:.3f} missing_sequences={missing} sensor_i2c_errors={err}")
    print(f"interval_us mean={statistics.mean(intervals):.1f} std={statistics.pstdev(intervals):.1f} p95={sorted(intervals)[int(.95*(len(intervals)-1))]} min={min(intervals)} max={max(intervals)}")
    print(f"acquisition_us mean={statistics.mean(row[3]-row[1] for row in p):.1f} max={max(row[3]-row[1] for row in p)}")
    pairs=[(a,b) for a,b in zip(p,p[1:]) if ((b[0]-a[0]) & 0xffffffff)==1]
    print(f"acquisition_deadline_misses={sum(row[3]>row[2] for row in p)} write_completion_deadline_misses={sum(b[5]>a[2] for a,b in pairs)} write_completion_checks={len(pairs)}")
    if pairs:
        margin=[a[2]-b[5] for a,b in pairs]
        print(f"write_completion_margin_us mean={statistics.mean(margin):.1f} min={min(margin)}")
    if spans:
        print(f"first_last_read_us mean={statistics.mean(spans):.1f} max={max(spans)}")
    for i in range(5):
        ss=[row[4][i] for row in p]
        print(f"id={i} channel={i+3} ok={sum(s[2]==0 for s in ss)} accel_ready={sum(bool(s[1]&1) for s in ss if not s[2])} gyro_ready={sum(bool(s[1]&2) for s in ss if not s[2])}")

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("file", help="capture file to read or write")
    parser.add_argument("--port", help="capture from this serial port (requires pyserial)")
    parser.add_argument("--seconds", type=float, default=35)
    args=parser.parse_args()
    if args.port:
        import serial
        with serial.Serial(args.port,115200,timeout=.25) as port, open(args.file,"wb") as out:
            end=time.monotonic()+args.seconds
            while time.monotonic()<end:
                out.write(port.read(8192))
    with open(args.file,"rb") as source:
        summarize(source.read())
if __name__ == "__main__":
    main()
