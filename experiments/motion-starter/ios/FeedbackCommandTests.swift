import Foundation

@main
struct FeedbackCommandTests {
    static func main() throws {
        for text in ["{\"type\":\"pitchCenterHaptic\"}", "{\"type\":\"status\"}",
                     "{\"type\":\"pitchCenterHaptic\",\"extra\":1}", "not json"] {
            let parsed = text.data(using: .utf8).flatMap { try? JSONSerialization.jsonObject(with: $0) }
            precondition(FeedbackCommand.isPitchCenterHaptic(parsed as Any) == (text == "{\"type\":\"pitchCenterHaptic\"}"))
        }
        print("Feedback command parser tests passed")
    }
}
