import Foundation

func matrix(alpha: Double, beta: Double, gamma: Double) -> Matrix3 {
    let a = alpha * .pi / 180, b = beta * .pi / 180, g = gamma * .pi / 180
    let ca = cos(a), sa = sin(a), cb = cos(b), sb = sin(b), cg = cos(g), sg = sin(g)
    return Matrix3(
        m11: ca*cg-sa*sb*sg, m12: -cb*sa, m13: ca*sg+sa*sb*cg,
        m21: sa*cg+ca*sb*sg, m22: cb*ca, m23: sa*sg-ca*sb*cg,
        m31: -cb*sg, m32: sb, m33: cb*cg)
}

@main
struct CompatibilityTests {
    static func main() {
        for (a, b, g) in [(0.0, 0.0, 0.0), (90, 45, 20), (217, -45, -70),
                          (12, 180, 0), (250, 90, 40), (15, -90, -35), (130, 135, 30)] {
            let expected = matrix(alpha: a, beta: b, gamma: g)
            let row = expected.upInDevice
            let gravity = Vector3(x: -row.x, y: -row.y, z: -row.z)
            for candidate in [expected, expected.transposed] {
                guard let converted = BrowserOrientation.convert(candidate, gravity: gravity) else {
                    fatalError("Missing conversion at \(a), \(b), \(g)")
                }
                let reconstructed = matrix(alpha: converted.alpha, beta: converted.beta, gamma: converted.gamma)
                let mismatch = sqrt(pow(reconstructed.m31-row.x, 2) + pow(reconstructed.m32-row.y, 2) + pow(reconstructed.m33-row.z, 2))
                precondition(mismatch < 0.002, "Vertical alignment mismatch: \(mismatch)")
                let fullMismatch = [reconstructed.m11-expected.m11, reconstructed.m12-expected.m12, reconstructed.m13-expected.m13,
                                    reconstructed.m21-expected.m21, reconstructed.m22-expected.m22, reconstructed.m23-expected.m23,
                                    reconstructed.m31-expected.m31, reconstructed.m32-expected.m32, reconstructed.m33-expected.m33]
                    .map { $0 * $0 }.reduce(0, +).squareRoot()
                precondition(fullMismatch < 0.002, "Full attitude mismatch: \(fullMismatch)")
                precondition(converted.gamma >= -90.001 && converted.gamma <= 90.001)
                precondition(converted.matrixError < 0.002)
            }
        }
        let wrongGravity = Vector3(x: 0, y: 1, z: 0)
        precondition(BrowserOrientation.convert(matrix(alpha: 0, beta: 0, gamma: 0), gravity: wrongGravity) == nil)
        print("Browser orientation compatibility tests passed")
    }
}
