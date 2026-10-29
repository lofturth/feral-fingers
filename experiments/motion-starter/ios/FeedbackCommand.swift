import Foundation

enum FeedbackCommand {
    static func isPitchCenterHaptic(_ value: Any) -> Bool {
        guard let object = value as? [String: Any], object.count == 1 else { return false }
        return object["type"] as? String == "pitchCenterHaptic"
    }
}
