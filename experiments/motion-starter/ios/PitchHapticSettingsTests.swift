import Foundation

@main
struct PitchHapticSettingsTests {
    static func main() {
        let suite = "org.feralfingers.PitchHapticSettingsTests"
        guard let defaults = UserDefaults(suiteName: suite) else { fatalError("No test defaults") }
        defaults.removePersistentDomain(forName: suite)
        assert(PitchHaptic.settings(defaults: defaults).duration == 100)
        assert(PitchHaptic.settings(defaults: defaults).intensity == 0.7)
        defaults.set(230.0, forKey: PitchHaptic.durationKey)
        defaults.set(0.9, forKey: PitchHaptic.intensityKey)
        assert(PitchHaptic.settings(defaults: defaults).duration == 230)
        assert(PitchHaptic.settings(defaults: defaults).intensity == 0.9)
        defaults.set(-50.0, forKey: PitchHaptic.durationKey)
        defaults.set(3.0, forKey: PitchHaptic.intensityKey)
        assert(PitchHaptic.settings(defaults: defaults).duration == 100)
        assert(PitchHaptic.settings(defaults: defaults).intensity == 0.7)
        defaults.removePersistentDomain(forName: suite)
        print("Pitch haptic settings persistence and validation passed")
    }
}
