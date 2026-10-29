import SwiftUI

@main
struct MotionStarterNativeApp: App {
    @StateObject private var sender = MotionSender()

    var body: some Scene {
        WindowGroup {
            ContentView(sender: sender)
        }
    }
}

struct ContentView: View {
    @ObservedObject var sender: MotionSender
    @AppStorage("relayAddress") private var relayAddress = "wss://Lofturs-MacBook-Air.local:5184/motion-relay"
    @AppStorage(PitchHaptic.durationKey) private var hapticDuration = PitchHaptic.defaultDurationMs
    @AppStorage(PitchHaptic.intensityKey) private var hapticIntensity = PitchHaptic.defaultIntensity

    var body: some View {
        Form {
            Section("Relay") {
                TextField("WebSocket URL", text: $relayAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                Button(sender.connected ? "Disconnect" : "Connect") {
                    if sender.connected { sender.disconnect() }
                    else { sender.connect(relayAddress) }
                }
                Text(sender.connectionStatus)
            }
            Section("Motion") {
                Button(sender.streaming ? "Stop motion" : "Start motion") {
                    if sender.streaming { sender.stopMotion() }
                    else { sender.startMotion() }
                }
                .disabled(!sender.connected)
                Text("Sent samples: \(sender.sentSamples)")
                Text(sender.diagnostic)
                    .font(.footnote)
            }
            Section("Haptic diagnostics") {
                HStack {
                    Text("Duration")
                    Slider(value: $hapticDuration, in: 20...300, step: 10)
                    Text("\(Int(hapticDuration)) ms").monospacedDigit()
                }
                HStack {
                    Text("Intensity")
                    Slider(value: $hapticIntensity, in: 0.1...1.0, step: 0.1)
                    Text(hapticIntensity.formatted(.number.precision(.fractionLength(1)))).monospacedDigit()
                }
                Button("Test Haptic") { sender.testHaptic() }
                Text(sender.hapticTestStatus)
                Text("Haptic commands received: \(sender.hapticCommandsReceived)")
                Text("Last command: \(sender.lastHapticCommand)")
                Text(sender.hapticCommandStatus)
            }
        }
        .onAppear {
            hapticDuration = PitchHaptic.validDuration(hapticDuration)
            hapticIntensity = PitchHaptic.validIntensity(hapticIntensity)
        }
    }
}
