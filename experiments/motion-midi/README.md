# Motion dashboard · CC1 and forearm movement

Mac receiver for the existing Motion Starter iPhone stream. It uses the existing relay on port 8784 and runs a separate HTTPS page on port 5185. Motion Starter stays on port 5184 with HMR disabled; this page also has HMR disabled. The page combines the original Motion MIDI CC1 experiment with the diagnostic forearm measurements from Motion Arm. The standalone Motion Arm page remains available on port 5186.

## Run

Keep the Motion Starter relay and web server running as described in `../motion-starter/README.md`. In this directory:

```sh
npm ci
MOTION_HTTPS_CERT=/path/to/existing/cert.pem MOTION_HTTPS_KEY=/path/to/existing/key.pem npm run start
```

Open `https://<Mac-hostname>.local:5185/` on the Mac. Keep the original dashboard open at `https://<Mac-hostname>.local:5184/` if desired. Open `https://<Mac-hostname>.local:5184/?phone=1` on the iPhone and tap **Enable motion sensors**. The relay supports both Mac receivers at once.

In a browser with Web MIDI support, click **Enable MIDI** and choose a connected MIDI output. Route that port's channel 1 CC1 to Phase Plant (through a virtual MIDI port or your MIDI interface), then assign Phase Plant's mod wheel to the parameter you want to hear. The page sends `B0 01 vv` only when the integer CC1 value changes.

The top **MIDI Output** section places the CC1 and pitch-bend output graphs side by side on wide screens and stacks them on narrow screens. Both use the same five-second clock. The CC1 graph shows only integer values actually sent, held flat until the next change, with reference lines at 1, 64, and 127. Its trace breaks when sensor data or MIDI output becomes unavailable. The last successfully sent CC1 remains visible above it.

The **Gravity Alignment** section shows the continuous calculated 0–1 alignment from orientation samples, even when MIDI is not enabled. Its five-second graph connects measured samples and stops at missing or stale data; it does not plot quantized CC1 values or extend a value beyond the latest sample. The **Response Curve** slider ranges from exponent 0.25 to 2.0 in steps of 0.05, starts at 0.5 (square root), and displays its numeric value. Square root, Linear, and Square buttons select 0.5, 1.0, and 2.0. The small preview shows the normalized input-to-output curve. Changing it immediately recalculates and sends CC1 from the latest valid alignment when a MIDI output is selected, subject to the existing change-only rule.

The forearm section shows raw elevation, filtered elevation velocity, and filtered elevation acceleration. Each has its own five-second graph. The angle graph has a fixed ±90° scale; velocity and acceleration have manual fixed-scale selectors. All three have zero reference lines. The unified page imports Motion Arm's tested [measurement](../motion-arm/src/measure.js) and [history](../motion-arm/src/history.js) modules directly, so the calculation has one source. Hold the phone with its top toward the fingertips, its long axis along the forearm, wrist straight, and elbow approximately fixed. See [Motion Arm's notes](../motion-arm/README.md) for the math, filtering, timing, and physical assumptions.

## Pitch Bend

Enable pitch bend separately from MIDI access, then choose **Angle**, **Velocity**, or **Acceleration**. The slider controls cents per degree, cents per degree/second, or cents per degree/second² respectively. Defaults are 2 cents/°, 0.5 cents/(°/s), and 0.1 cents/(°/s²). Slider ranges are 0–10, 0–2, and 0–0.5 in those units. Each source remembers its own sensitivity. In angle mode, **Set current angle as neutral** makes the current elevation zero bend; its initial neutral angle is 0°. Velocity and acceleration use zero as neutral. The current source value and the last successfully sent pitch bend in cents are shown live.

**Pitch-center haptic** is off by default. When enabled, the Mac sends `{"type":"pitchCenterHaptic"}` over the existing relay after a successfully transmitted, measurement-driven pitch bend crosses zero cents in either direction. The crossing must first arm beyond ±5 cents; it rearms after a genuine crossing, so small jitter around center does not repeat taps. Initial enable, source or sensitivity changes, neutral calibration, output changes, safety-centering, invalid measurements, and failed MIDI sends reset or skip crossing detection. Only the active native phone controller plays its adjustable Core Haptics pulse; Safari ignores the optional command.

Browser localStorage saves the preferred MIDI output ID, response exponent, pitch source, separate sensitivities, both arm graph scales, and haptic preference in a validated versioned object. Missing or incompatible data uses defaults. A preferred output is selected only after the user enables MIDI and the device is available. Reloading never enables MIDI or Pitch Bend, sends messages, or restores the physical angle-neutral calibration; set the neutral angle again when using Angle mode. Live measurements, history, connection state, and diagnostic counts are session-only.

The page shows **Haptic events generated** and **handed to WebSocket** counts. If generated stays at zero, inspect the pitch graph and enabled controls. If generated rises but handoff does not, inspect the WebSocket connection. If both rise but the native phone's received count does not, inspect the relay and phone connection. If the phone count rises, use its independent **Test Haptic** button to distinguish command delivery from tactile output. WebSocket handoff is not a delivery acknowledgment.

The output uses standard 14-bit channel 1 pitch bend, `E0 LSB MSB`, centered at 8192 and clamped to 0–16383. Cents assume the synth is configured for ±2 semitones (±200 cents). A message is sent when the calculated integer bend changes. Source changes, neutral-angle calibration, and disabling pitch bend send center when an output is available. Switching MIDI outputs centers the previous output when connected and initializes the new one at center. Missing or stale sensor data also centers a bent output when possible. The pitch graph in **MIDI Output** plots only successfully transmitted values, held flat between changes, with gaps when data or MIDI output is unavailable. It has a fixed ±200-cent scale and zero line. The last successfully sent cents remain visible above it. The existing CC1 path remains independent.

## Mapping

The phone's outward screen normal is local +Z. The existing `deviceorientation` stream supplies alpha, beta, and gamma. Under the [W3C intrinsic Z–X′–Y″ rotation convention](https://www.w3.org/TR/orientation-event/#device-orientation), the world-vertical component of local +Z is `cos(beta) × cos(gamma)` (angles converted to radians). Alpha rotates around world vertical and does not affect this component. The page takes its absolute value as alignment, clamps it to 0–1, and computes `round(1 + 126 × alignment^exponent)`. At alignment 0.5, square root gives CC1 90, linear gives 64, and square gives 33. Face-up and face-down both give CC1 127; screen vertical gives CC1 1. The mapping is continuous through vertical and independent of compass heading.

Missing, invalid, or stale orientation readings clear the displayed CC1 and arm values. The arm traces break at gaps and restart derivatives on reconnection or a timestamp gap. Pitch bend attempts to return to center before marking a gap; a physically disconnected output cannot receive that safety message. This assumes Safari follows the W3C angle convention; actual Safari orientation delivery, permission, and Phase Plant routing require testing with the devices.

## Check

```sh
npm test
npm run build
```
