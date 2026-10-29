# Native iPhone motion sender

Minimal SwiftUI/Core Motion sender for the existing Motion Starter relay. No third-party packages or MIDI. The Safari phone page remains unchanged. The native app also accepts the optional `{"type":"pitchCenterHaptic"}` feedback command from a Mac receiver and plays one Core Haptics pulse; unknown commands are ignored.

The duration slider spans 20–300 ms in 10 ms steps (default 100 ms); intensity spans 0.1–1.0 in 0.1 steps (default 0.7). Sharpness is fixed at 0.55. Both **Test Haptic** and received pitch-center commands request the same pulse using the current sliders. Settings survive app restarts through UserDefaults. The button needs no relay connection. Its status reports a pulse request or engine error, not whether the tap was felt. The engine is recreated after stops, resets, or failures; playback is asynchronous so motion streaming continues. **Haptic commands received** and **Last command** update whenever a valid relay command arrives. On the Mac, Motion MIDI separately counts crossings generated and commands handed to the WebSocket API. Handoff does not confirm relay or device delivery.

## Existing wire contract

The Safari page opens `wss://<Mac hostname>:5184/motion-relay` through Motion Starter's HTTPS WebSocket proxy to the loopback-only relay at `127.0.0.1:8784`. On open it sends `{"role":"controller"}`. The relay admits only one controller, sends periodic `{"type":"status","controllerConnected":true|false}` messages, and forwards valid motion messages to every receiver. The phone sends `{"type":"heartbeat"}` when it has no samples; the relay closes a controller after about three seconds without a sample or heartbeat. The native sender uses the same messages and proxy.

Safari sends two independent sample types, with nullable fields:

- Orientation: `{"type":"motion","source":"orientation","t":<milliseconds>,"alpha":<degrees|null>,"beta":<degrees|null>,"gamma":<degrees|null>,"absolute":<boolean|null>}`. These are W3C intrinsic Z–X′–Y″ angles: alpha about initial Z, beta about rotated X, gamma about twice-rotated Y. Device axes are +X right, +Y to the top edge, +Z out of the screen. Alpha is not necessarily a magnetic heading.
- Device motion: `{"type":"motion","source":"deviceMotion","t":<milliseconds>,"rotationRate":{"alpha":<X degrees/s|null>,"beta":<Y degrees/s|null>,"gamma":<Z degrees/s|null>},"acceleration":{"x":<m/s²|null>,"y":<m/s²|null>,"z":<m/s²|null>},"accelerationIncludingGravity":{"x":<m/s²|null>,"y":<m/s²|null>,"z":<m/s²|null>},"interval":<milliseconds|null>}`. In stationary face-up Safari, `accelerationIncludingGravity.z` is about +9.8, opposite physical gravity.

Safari's `t` is `event.timeStamp`, a monotonic browser-relative millisecond value. The native app sends Core Motion's monotonic `CMDeviceMotion.timestamp` converted from seconds to milliseconds; the origin differs, but existing consumers differentiate within a stream and do not synchronize to Mac time. Both native message types from one Core Motion update share `t`. The requested update interval is 1/60 second, subject to hardware and OS scheduling.

The Mac dashboard displays all orientation and device-motion fields. Motion MIDI uses orientation `alpha`, `beta`, and `gamma` for CC1 and `beta` for forearm elevation; Motion Arm also uses orientation and timestamps for elevation derivatives. The dashboard shows device-motion acceleration and rotation-rate graphs, but the current MIDI and arm calculations do not use acceleration. All consumers require finite orientation angles for their live mappings.

## Native conversion

Core Motion starts with `.xArbitraryZVertical`, so world Z is vertical and yaw has an arbitrary horizontal reference. The app compares both directions of `attitude.rotationMatrix` against the independent Core Motion gravity vector to identify device-to-world rotation. It rejects an orientation update if neither agrees within 0.20 vector units. It then decomposes that matrix into the W3C Z–X′–Y″ order; it does not rename Core Motion `roll`, `pitch`, and `yaw`. At the gimbal-lock boundary, alpha and gamma are non-unique, so it chooses gamma zero and a compatible alpha. It sends `absolute:false`. The app shows the angles and matrix/gravity mismatch for diagnosis. When this compatibility check fails, it withholds the orientation sample rather than sending misleading angles.

Core Motion `rotationRate` is converted from radians/s to degrees/s and assigned X→alpha, Y→beta, Z→gamma as the target Safari dashboard describes. `userAcceleration` is converted from g to m/s² for `acceleration`. `userAcceleration - gravity`, also converted to m/s², gives Safari-style apparent `accelerationIncludingGravity` (face-up +Z). `interval` is the difference between adjacent Core Motion timestamps in milliseconds, or null for the first update.

These axis/sign choices and the attitude/gravity matrix check have synthetic tests, but actual Safari-versus-native equivalence, especially alpha reference and rotation-rate sign during turns, still needs a physical iPhone comparison. If the app reports a matrix/gravity mismatch, do not use its orientation output until that discrepancy is investigated.

## Build and launch on iPhone

1. Keep the Motion Starter relay and HTTPS web server running on ports 8784 and 5184. Ensure the existing certificate for `Lofturs-MacBook-Air.local` is trusted by the iPhone. The native app uses the same `wss://Lofturs-MacBook-Air.local:5184/motion-relay` default, so it does not need direct access to port 8784.
2. Open `MotionStarterNative.xcodeproj` in Xcode. Select the **MotionStarterNative** scheme and a connected iPhone. In Signing & Capabilities, choose your Apple development team and change the bundle identifier if Xcode requires a unique one. Enable Developer Mode on the iPhone if prompted, trust the developer profile, and allow Local Network access.
3. Build and run. Keep the app in the foreground. Close the Safari phone controller first, because the relay accepts one controller. Tap **Connect**, then **Start motion**. The status should say the controller is active, the count should rise, and the original Mac dashboard at `https://Lofturs-MacBook-Air.local:5184/` should show both orientation and device-motion values. Motion MIDI at port 5185 can receive simultaneously.
4. Compare with Safari in separate runs: stationary face-up should show approximately beta 0, gamma 0, `accelerationIncludingGravity.z` +9.8; face-down should still produce strong CC1; raising the top edge should raise forearm elevation; twisting around the long axis should not change elevation. Compare rotation-rate signs on deliberate X/Y/Z turns. Record any discrepancy before treating the feeds as interchangeable.

For a signing-free generic physical-iPhone build from this directory, without a Simulator runtime:

```sh
xcodebuild -project MotionStarterNative.xcodeproj -scheme MotionStarterNative -destination 'generic/platform=iOS' -configuration Debug CODE_SIGNING_ALLOWED=NO -derivedDataPath /private/tmp/feral-motion-ios-build build
swiftc -module-cache-path /private/tmp/motion-native-swift-cache BrowserCompatibility.swift CompatibilityTests.swift -o /private/tmp/motion-native-compat-tests
/private/tmp/motion-native-compat-tests
```

The generic device build tests compilation, not physical sensors or local-network trust. The project leaves the development team unset; select your own team for device deployment.
