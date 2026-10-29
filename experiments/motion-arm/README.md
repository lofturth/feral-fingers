# Motion Arm

Independent Mac dashboard for the existing Motion Starter iPhone `deviceorientation` stream. It uses the existing relay on port 8784 and its own HTTPS page on port 5186. It does not acquire phone sensors, produce MIDI, or modify Motion Starter or Motion MIDI.

## Run

Keep Motion Starter's web server (5184) and relay (8784) running. From this directory:

```sh
npm ci
MOTION_HTTPS_CERT=/path/to/existing/cert.pem MOTION_HTTPS_KEY=/path/to/existing/key.pem npm run start
```

Open `https://<Mac-hostname>.local:5186/` on the Mac. Open the existing phone page at `https://<Mac-hostname>.local:5184/?phone=1` in iPhone Safari and tap **Enable motion sensors**. The relay allows multiple receivers, so the original Mac dashboard and Motion MIDI can remain open. HMR is disabled; refresh after edits.

## Measurement

Hold the phone with its top edge toward the fingertips, long axis along the forearm, wrist straight, and elbow approximately fixed. Local +Y is then the forearm direction. Under the [W3C device-orientation intrinsic Z–X′–Y″ convention](https://www.w3.org/TR/orientation-event/#device-orientation), the vertical component of local +Y is the second entry of the rotation matrix's third row: `sin(beta)`. Elevation above horizontal is `asin(sin(beta))`, in degrees. It ranges from −90° to +90°. Positive means the phone's top edge points upward. Alpha turns around world vertical; gamma twists around the rotated local Y axis. Neither changes this vertical component. In particular, using `beta` directly beyond ±90° would give the wrong elevation; the inverse sine folds those representations correctly.

The angle readout is raw orientation-derived elevation. Derivatives use the iPhone event timestamp `t` (milliseconds), not Mac arrival spacing. Velocity is the angle difference divided by elapsed seconds, then a causal exponential average with a 120 ms time constant. Acceleration is the difference of filtered velocity divided by elapsed seconds, then a causal exponential average with a 150 ms time constant. Angle has no filter latency. Velocity changes respond over roughly 120 ms; acceleration combines both stages and responds over roughly 270 ms. These are response time constants, not fixed delays. Differentiation remains sensitive to sensor noise and may show spikes.

The first valid sample establishes a baseline and has no derivative. Timestamps less than 5 ms apart, duplicates, and out-of-order samples are ignored. A gap over 250 ms starts a new baseline. Invalid orientation, relay disconnect, or no orientation sample for three seconds clears the readouts and breaks the traces. Reconnection also starts a new baseline. The graphs show five seconds of received samples with fixed ±90° angle scale and manually selected fixed velocity and acceleration scales; each has a zero line.

## Check

```sh
npm test
npm run build
```

Automated tests cover synthetic raising and lowering, acceleration sign, twist independence across headings and angle boundaries, stationary settling, irregular timestamps, gaps, and graph discontinuities. Physical sign, grip alignment, Safari orientation behavior, and noise must still be checked on an iPhone.
