# Whistle Starter

Standalone browser experiment extracted from `Music projects/archive/whistle-test/`. It keeps the original YIN-style detector and scrolling pitch graph without MIDI, synthesis, or other experiments.

From this folder, run:

```sh
python3 -m http.server 8001 --bind 127.0.0.1
```

Open <http://127.0.0.1:8001/> in Safari or Chrome. Click **Start microphone** and allow access. Select another microphone if the browser exposes one. **Stop microphone** releases capture; Ctrl+C stops the server. Refresh the page manually after source edits. No installation or build is needed.

The pitch graph shows continuous MIDI pitch on a semitone scale (A4 = 440 Hz); the compact readout shows Hz and the nearest note. Its height is adjustable from 150 to 700 px. A shallow graph immediately above it shows measured microphone level on a fixed −80 to 0 dBFS scale, with the adjustable threshold as an orange line. Both graphs share an adjustable 2–30 second window (default 8 seconds) and keep up to 30 seconds of session history. The original 2,048-sample detector uses a 250–4,000 Hz range, a normalized YIN threshold of 0.12, and parabolic interpolation. Analysis runs on browser animation frames, at most once every 12 ms. Green pitch points are measured pitch; uncertain pitch leaves a gap.

Measurements remain in memory for 30 seconds. Each sample includes a timestamp, raw frequency or null, continuous MIDI pitch or null, dBFS level, and validity. Nothing is recorded or transmitted. Microphone permission, device availability, and acoustic tracking still require testing in the target browser and hardware.

The selected microphone, signal threshold, graph range, pitch graph height, and time window save automatically in this browser and load on the next visit. Capture still starts only when you click **Start microphone**. If the saved microphone is unavailable or its identity is hidden until permission is granted, the app uses the system default until it can restore that device.
