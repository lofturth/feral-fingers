# BMI323 gravity experiment

Live six-axis dashboard for the board marked **7Semi ESP32-C6-MICRO**, paired with a **7Semi BMI323 NANO QWIIC**. It uses I²C address `0x69`, SDA GPIO6, and SCL GPIO7.

Uses PlatformIO's `esp32-c6-devkitm-1` target provisionally. A dedicated 7Semi ESP32-C6-MICRO definition or board specification confirming this target has not been located. ESP-IDF directs the console to the chip's USB Serial/JTAG port.

PlatformIO/ESP-IDF rejects project paths containing spaces. This repository currently sits under `My coding projects`. From the `feral-fingers` repository root, copy only this experiment to a temporary path without spaces and build there:

```sh
cp -R experiments/bmi323-gravity /tmp/bmi323-gravity
pio run -d /tmp/bmi323-gravity
```

The build output is `/tmp/bmi323-gravity/.pio/build/esp32-c6-devkitm-1/firmware.bin`. No board needs to be connected for the build.

## Check a board's I²C address

Connect only one BMI323 board to the ESP32-C6 by Qwiic. From the repository root, copy the experiment to a path without spaces and build the independent scanner:

```sh
cp -R experiments/bmi323-gravity /tmp/bmi323-gravity
pio run -d /tmp/bmi323-gravity -e i2c-scan
pio run -d /tmp/bmi323-gravity -e i2c-scan -t upload --upload-port /dev/cu.usbmodem101
pio device monitor -p /dev/cu.usbmodem101 -b 115200
```

Adjust the port to the one shown by `pio device list`. Record the ACK and CHIP_ID results for both `0x68` and `0x69`. Disconnect power, swap in the second board as the only Qwiic sensor, power up, and reset or rerun the scanner. Do not connect both boards until their individual addresses are known to differ. The normal streaming firmware still builds with `pio run -d /tmp/bmi323-gravity` and can be restored by uploading that default environment.

## Measure two BMI323 sensors

### Live two-sensor graphs

Build and upload the proven 400 Hz dual firmware from a temporary path without spaces, then start the existing dashboard in dual mode:

```sh
cp -R experiments/bmi323-gravity /tmp/bmi323-gravity
pio run -d /tmp/bmi323-gravity -e dual-400 -t upload --upload-port /dev/cu.usbmodem101
./experiments/bmi323-gravity/run.sh --dual --serial /dev/cu.usbmodem101
```

Open `http://127.0.0.1:4188`. Sensor 1 is `0x68`; Sensor 2 is `0x69`. Each has acceleration, angular velocity, and filtered gravity X/Y/Z on a shared scrolling time axis. The browser draws at a lower rate than the 400 Hz acquisition; the ESP32 and server retain every received measurement. Dual mode does not send MIDI. To return to the original single-sensor dashboard, upload the default PlatformIO environment and start `run.sh` without `--dual`.

The **Separate / Combined** toggle only changes card order. Separate groups the three graphs for Sensor 1, then Sensor 2. Combined pairs the two acceleration graphs, then the two angular velocity graphs, then the two filtered gravity graphs. All six canvases retain their data and the same shared time axis. The browser requests a draw on every animation frame, keeps roughly 41 seconds of samples in fixed-size circular buffers, and preserves each display bucket's minimum and maximum when graph density exceeds the canvas width. The header reports FPS, frames over 25 ms, maximum frame interval, and maximum draw time in rolling two-second windows. Browser frame rate depends on the machine and visible graph count; sensor acquisition remains at 400 Hz.

### Wi-Fi UDP transport

Copy `diagnostics/wifi_config.example.h` to `diagnostics/wifi_config.local.h` and set the 2.4 GHz SSID, password, Mac receiver IPv4 address, and UDP port. The local header is ignored by Git; do not add credentials to the example or tracked files. If the Mac changes networks or receives a new IP, update `UDP_RECEIVER_IP` and reflash. On macOS, `ipconfig getifaddr en0` shows the current address for `en0`.

The separate `dual-wifi` environment uses the same 400 Hz sensor acquisition and 400 kHz I²C settings. Build it from a path without spaces, then start the UDP receiver and upload while USB is still attached:

```sh
cp -R experiments/bmi323-gravity /tmp/bmi323-gravity
pio run -d /tmp/bmi323-gravity -e dual-wifi
./experiments/bmi323-gravity/run.sh --udp-port 4191
pio run -d /tmp/bmi323-gravity -e dual-wifi -t upload --upload-port /dev/cu.usbmodem101
```

Open `http://127.0.0.1:4188`; `http://127.0.0.1:4188/wireless-stats` returns cumulative receiver diagnostics. Once UDP packets are arriving, the USB cable can be moved to a power bank. The ESP32 sends one 84-byte little-endian UDP packet per acquisition cycle: `FFU1` magic (4 bytes), sequence (u32), acquisition start and four I²C read begin/end timestamps (five u64 values, microseconds since ESP32 boot), missed timer slots and transmit drops (two u32 values), signed raw axes for `0x68` then `0x69` (twelve i16 values), two read-success bytes, and two data-ready bit masks. Accelerometer counts divide by 16384 for g; gyro counts divide by 65.536 for degrees/second. A 16-record queue isolates acquisition from Wi-Fi sending; when full, the oldest queued record is discarded. The network task sends without blocking and disables Wi-Fi power saving. UDP is intentionally unbuffered and can lose or reorder packets.

The dashboard reports received packets per second, sequence gaps, and p95 UDP arrival interval/jitter. The stats endpoint also reports acquisition interval and duration. Jitter is the absolute difference between each Mac arrival interval and the 2.5 ms target. ESP32 and Mac clocks are not synchronized, so these diagnostics do not claim one-way latency or packet age.

With both boards connected on the same Qwiic chain, build and upload the separate raw stream environment. Use a path without spaces as above, and adjust the serial port if needed:

```sh
cp -R experiments/bmi323-gravity /tmp/bmi323-gravity
pio run -d /tmp/bmi323-gravity -e dual-stream
pio run -d /tmp/bmi323-gravity -e dual-stream -t upload --upload-port /dev/cu.usbmodem101
python3 -m pip install pyserial
python3 /tmp/bmi323-gravity/diagnostics/measure_dual.py /dev/cu.usbmodem101 --seconds 60 --output /tmp/bmi323-dual.csv
```

The firmware emits one `D` CSV record per attempted cycle. The fields are `D,seq,scheduled_us,start_us,missed_slots,dropped_records,a_addr,a_ok,a_begin_us,a_end_us,a_ax,a_ay,a_az,a_gx,a_gy,a_gz,b_addr,b_ok,b_begin_us,b_end_us,b_ax,b_ay,b_az,b_gx,b_gy,b_gz`. All times use `esp_timer_get_time()` microseconds since ESP32 boot. `a` is address `0x68`; `b` is `0x69`. `ok` is 1 on a successful six-axis read. Axis values are signed raw counts; failed reads have zeros. Divide accelerometer counts by 16384 for g and gyroscope counts by 65.536 for degrees/second. Both sensors use ±2 g, ±500 degrees/second, and 100 Hz output data rate. I²C runs at 400 kHz.

The timestamp associated with each read is the midpoint of its `begin_us` and `end_us`. Their difference measures **host I²C transaction separation**, not the actual difference between the IMUs' internal sample times. The total acquisition duration is `b_end_us - start_us`. `missed_slots` counts skipped timer periods; `dropped_records` counts full serial queues. An ESP microsecond timer wakes the acquisition task at the selected rate; a lower-priority task prints queued records. The reader reports cycle intervals, read separation, read errors, missed slots, queue drops, and sequence gaps. It requires `pyserial` only; it does not run the gravity or MIDI application.

### Sampling-rate benchmark

The same dual firmware also has `dual-200`, `dual-400`, and `dual-800` environments; `dual-stream` is 100 Hz. For each environment, replace `dual-stream` in the build/upload commands above and capture about 60 seconds with `measure_dual.py`. Use a different `--output` file per rate. Both accelerometer and gyroscope ODRs use the [BMI323 datasheet](https://www.bosch-sensortec.com/media/boschsensortec/downloads/datasheets/bst-bmi323-ds000.PDF) codes 0x8, 0x9, 0xA, and 0xB for 100, 200, 400, and 800 Hz. The range and I²C speed stay fixed.

Benchmark records append `a_fresh,b_fresh` to the CSV fields above. Each is a bit mask: bit 1 means a new accelerometer sample was ready, bit 0 a new gyroscope sample. The firmware reads register `STATUS` (0x02) and the six data words in a single burst. Bosch documents that `STATUS.drdy_acc` and `STATUS.drdy_gyr` are separate, clear on reading STATUS, and also cleared by reading their corresponding data registers. Thus the flags indicate new data since the previous read, but do not count multiple samples produced between reads. The 800 Hz case has particularly little time to spare between host reads; these flags do not measure the IMUs' internal sample timestamps or prove two sensors are synchronized.

To flash and watch the USB serial output (adjust the port if macOS assigns another name):

```sh
pio run -d /tmp/bmi323-gravity -t upload --upload-port /dev/cu.usbmodem1101
pio device monitor -p /dev/cu.usbmodem1101 -b 115200
```

The USB serial port may disconnect briefly during reset; reconnect the monitor if needed. The firmware configures both sensors for 100 Hz, reads six axes every 10 ms, and prints each sample as `M,sequence,timestamp_us,ax,ay,az,gx,gy,gz`. Acceleration is in g and angular velocity in degrees/second. Startup and error messages begin with `#`. It uses ±2 g and ±500 degrees/second ranges. It does not perform sensor fusion.

For the dashboard, run this from the experiment directory on macOS:

```sh
./run.sh
```

Open `http://127.0.0.1:4188`. The dashboard server works with Python's standard library alone; MIDI output requires the optional package below. It reconnects if USB briefly disappears. To choose a different HTTP port or serial device, use `./run.sh --port 4190 --serial /dev/cu.usbmodemXXXX`. The server binds only to localhost and does not reload the page automatically.

For MIDI output, install `python-rtmidi` in a Python environment and launch the server with that interpreter. For example, from this directory:

```sh
python3 -m venv /tmp/bmi323-midi-venv
/tmp/bmi323-midi-venv/bin/python -m pip install python-rtmidi
BMI323_PYTHON=/tmp/bmi323-midi-venv/bin/python ./run.sh
```

The server creates a CoreMIDI virtual source named **BMI323 Mod Wheel**. MIDI now uses estimated gravity Z, clamped to 0–1 g. The dashboard selector switches immediately between channel-1 mod wheel CC1 (0–127, default) and 14-bit pitch bend (0–16383, with 0.5 g at center 8192). Switching resets the old control and sends the current value of the new control. Duplicate values are suppressed. The dashboard shows raw Z, estimated Z, the selected mode, and its output value. If MIDI cannot initialize, the dashboard continues without it; use `./run.sh --no-midi` to disable MIDI explicitly. Stop the server with Ctrl-C to close the virtual source. Restart any already running dashboard server to load server changes; only one server should read the USB serial device.

In Ableton Live, open **Settings → Link, Tempo & MIDI** and enable **Track** for the **BMI323 Mod Wheel** input. Select that input on the MIDI track containing Phase Plant, set its MIDI channel to 1 (or All Channels), and arm the track or set monitoring to **In**. In Phase Plant, use a **MIDI CC** modulator set to controller 1 for mod-wheel mode, or a **Pitch Wheel** modulator for pitch-bend mode, and assign it to a parameter. Enable Live's **Remote** input switch too only if you want to MIDI-map Live controls. [Ableton MIDI settings](https://help.ableton.com/hc/en-us/articles/209774205-Live-s-MIDI-Settings) and [Kilohearts modulation guide](https://kilohearts.com/docs/modulation) describe those routes.

The graphs scroll from the browser's animation clock without a visual delay. The ESP32-to-browser clock offset is set by the first sample and remains fixed until the ESP32 timestamp resets. Samples retain their original timestamps; the time axis keeps moving between arrivals and leaves empty space after the newest sample. The header shows effective sensor rate, browser FPS, longest animation-frame interval, longest canvas draw time, longest sample-arrival interval, and missing sequence numbers. These rolling maxima update every two seconds; the missing count accumulates until a device timestamp reset. Pause freezes the current view while acquisition continues.

The Gravity gate graph compares raw accelerometer Z and estimated gravity Z on a fixed 0–127 reference scale. Only the estimated-gravity trace drives MIDI; pitch bend uses the full 14-bit range separately. The server integrates the gyroscope in the sensor frame, corrects gradually toward the normalized accelerometer direction with a one-second correction time constant, and normalizes the estimate to 1 g. It resets from valid acceleration on startup or an ESP32 timestamp gap above 250 ms. The estimate uses the accelerometer's positive-up convention: +Z at rest maps to CC1 127. Brief linear motion can still disturb the estimate; yaw and gyro bias are not independently observable with six axes.

If PlatformIO's first run fails with missing `idf_component_manager` or another ESP-IDF Python module, its managed Python environment was only partly populated. Install the framework's declared core requirements into that environment, then rerun the build. For example, with PlatformIO's default core directory:

```sh
~/.platformio/penv/.espidf-6.1.0/bin/python -m pip install \
  -r ~/.platformio/packages/framework-espidf/tools/requirements/requirements.core.txt
pio run -d /tmp/bmi323-gravity
```

The environment directory includes the installed ESP-IDF version; adjust `.espidf-6.1.0` if PlatformIO installs a different version. The successful build used PlatformIO 6.2.0, Espressif 32 platform 8.0.0, and ESP-IDF 6.1.0. The board's 4 MB flash was confirmed with esptool and is set in `sdkconfig.defaults`.

For later sensor work, Bosch's [BMI3XY Sensor API](https://github.com/boschsensortec/BMI3XY_SensorAPI) contains `bmi323.c/.h`, `bmi323_defs.h`, and shared `bmi3.c/.h`, `bmi3_defs.h`. The application must supply I²C read/write and delay callbacks. This minimal reader uses Bosch's documented register settings directly with ESP-IDF's I²C driver.

On the connected board, an earlier diagnostic verified **Qwiic SDA = GPIO6** and **SCL = GPIO7**: address `0x69` ACKed and register `0x00` read as raw `0x1143`, with chip-ID low byte `0x43`. [Bosch's datasheet](https://www.bosch-sensortec.com/media/boschsensortec/downloads/datasheets/bst-bmi323-ds000.PDF) says the upper byte of this register must be ignored. This is measured behavior on this board, not a published 7Semi pinout.
