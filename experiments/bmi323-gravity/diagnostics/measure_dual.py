#!/usr/bin/env python3
"""Capture and summarize a dual BMI323 raw serial stream."""

import argparse
import statistics
import time

import serial


def percentile(values, fraction):
    ordered = sorted(values)
    return ordered[round((len(ordered) - 1) * fraction)]


def summary(rows):
    if not rows:
        print("No valid D records received")
        return
    starts = [r[3] for r in rows]
    intervals = [b[3] - a[3] for a, b in zip(rows, rows[1:])
                 if b[1] == a[1] + 1]
    separations = [((r[8] + r[9]) - (r[18] + r[19])) // 2 for r in rows]
    durations_a = [r[9] - r[8] for r in rows]
    durations_b = [r[19] - r[18] for r in rows]
    acquisition = [r[19] - r[3] for r in rows]
    errors_a = sum(not r[7] for r in rows)
    errors_b = sum(not r[17] for r in rows)
    lost_records = sum(max(0, b[1] - a[1] - 1) for a, b in zip(rows, rows[1:]))
    elapsed = (starts[-1] - starts[0]) / 1_000_000 if len(rows) > 1 else 0
    period_us = round(1_000_000 * elapsed / (rows[-1][1] - rows[0][1])) if elapsed else 0
    print(f"Cycles received: {len(rows)}; elapsed device time: {elapsed:.3f} s")
    if elapsed:
        print(f"Acquisition rate (sequence/time): {(rows[-1][1] - rows[0][1]) / elapsed:.3f} Hz")
        print(f"Received record rate: {(len(rows) - 1) / elapsed:.3f} Hz")
    if intervals:
        print("Cycle intervals (us): mean %.1f, min %d, p50 %d, p95 %d, p99 %d, max %d" %
              (statistics.mean(intervals), min(intervals), percentile(intervals, .5),
               percentile(intervals, .95), percentile(intervals, .99), max(intervals)))
        print(f"Intervals above 15 ms: {sum(x > 15000 for x in intervals)}")
    print("Sensor transaction midpoint separation (us): mean %.1f, max %d" %
          (statistics.mean(abs(x) for x in separations), max(abs(x) for x in separations)))
    print("I2C transaction duration (us): 0x68 mean %.1f max %d; 0x69 mean %.1f max %d" %
          (statistics.mean(durations_a), max(durations_a),
           statistics.mean(durations_b), max(durations_b)))
    print("Total acquisition duration (us): mean %.1f, max %d; over period: %d" %
          (statistics.mean(acquisition), max(acquisition),
           sum(x > period_us for x in acquisition)))
    print(f"I2C failed reads: 0x68={errors_a}, 0x69={errors_b}")
    if len(rows[0]) >= 28:
        for address, field in (("0x68", 26), ("0x69", 27)):
            acc = sum(bool(r[field] & 2) for r in rows)
            gyr = sum(bool(r[field] & 1) for r in rows)
            both = sum((r[field] & 3) == 3 for r in rows)
            print(f"{address} fresh flags: accel={acc}, gyro={gyr}, both={both}; "
                  f"observed both/s={both / elapsed:.2f}" if elapsed else f"{address} fresh flags: both={both}")
    print(f"Missed deadline slots: {rows[-1][4] - rows[0][4]}; "
          f"serial queue drops: {rows[-1][5] - rows[0][5]}; "
          f"sequence gaps: {lost_records}")
    print(f"Maximum start lateness: {max(r[3] - r[2] for r in rows)} us")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("port", help="serial port, e.g. /dev/cu.usbmodem101")
    parser.add_argument("--seconds", type=float, default=60)
    parser.add_argument("--output", help="optional file for raw D records")
    args = parser.parse_args()
    rows = []
    with serial.Serial(args.port, 115200, timeout=1) as device:
        with open(args.output, "w") if args.output else open("/dev/null", "w") as output:
            deadline = time.monotonic() + args.seconds
            while time.monotonic() < deadline:
                line = device.readline().decode("ascii", "replace").strip()
                if not line.startswith("D,"):
                    if line.startswith("#"):
                        print(line)
                    continue
                try:
                    parts = line.split(",")
                    if len(parts) not in (26, 28) or parts[6] != "0x68" or parts[16] != "0x69":
                        continue
                    row = [int(p) if i not in (0, 6, 16) else p
                           for i, p in enumerate(parts)]
                except ValueError:
                    continue
                rows.append(row)
                if args.output:
                    output.write(line + "\n")
    summary(rows)


if __name__ == "__main__":
    main()
