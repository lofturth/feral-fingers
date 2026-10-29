import CoreHaptics
import Foundation

@MainActor
final class PitchHaptic {
    private let supported = CHHapticEngine.capabilitiesForHardware().supportsHaptics
    static let durationKey = "pitchHapticDurationMs"
    static let intensityKey = "pitchHapticIntensity"
    static let defaultDurationMs = 100.0
    static let defaultIntensity = 0.7
    private var engine: CHHapticEngine?

    static func validDuration(_ value: Double) -> Double {
        guard value.isFinite, (20...300).contains(value) else { return defaultDurationMs }
        return (value / 10).rounded() * 10
    }

    static func validIntensity(_ value: Double) -> Double {
        guard value.isFinite, (0.1...1.0).contains(value) else { return defaultIntensity }
        return (value * 10).rounded() / 10
    }

    static func settings(defaults: UserDefaults = .standard) -> (duration: Double, intensity: Double) {
        let duration = defaults.object(forKey: Self.durationKey) as? Double ?? Self.defaultDurationMs
        let intensity = defaults.object(forKey: Self.intensityKey) as? Double ?? Self.defaultIntensity
        return (Self.validDuration(duration), Self.validIntensity(intensity))
    }

    // Both the diagnostic button and incoming relay commands call this path.
    func tap() async -> String {
        guard supported else { return "Haptic hardware unavailable" }
        do {
            if engine == nil {
                let next = try CHHapticEngine()
                next.isAutoShutdownEnabled = true
                next.stoppedHandler = { [weak self] _ in
                    Task { @MainActor in self?.engine = nil }
                }
                next.resetHandler = { [weak self] in
                    Task { @MainActor in self?.engine = nil }
                }
                engine = next
            }
            guard let engine else { return "Haptic engine unavailable" }
            try await engine.start()
            let pulse = Self.settings()
            let event = CHHapticEvent(eventType: .hapticContinuous, parameters: [
                CHHapticEventParameter(parameterID: .hapticIntensity, value: Float(pulse.intensity)),
                CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.55),
            ], relativeTime: 0, duration: pulse.duration / 1000)
            let pattern = try CHHapticPattern(events: [event], parameters: [])
            let player = try engine.makePlayer(with: pattern)
            try player.start(atTime: CHHapticTimeImmediate)
            return "Core Haptics pulse requested"
        } catch {
            engine = nil
            return "Haptic failed: \(error.localizedDescription)"
        }
    }
}
