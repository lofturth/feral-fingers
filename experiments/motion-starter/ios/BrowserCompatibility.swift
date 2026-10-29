import Foundation

struct Vector3 {
    let x: Double
    let y: Double
    let z: Double
    var length: Double { sqrt(x*x + y*y + z*z) }
    func normalized() -> Vector3? {
        let n = length
        guard n.isFinite && n > 0.001 else { return nil }
        return Vector3(x: x/n, y: y/n, z: z/n)
    }
}

struct Matrix3 {
    let m11: Double, m12: Double, m13: Double
    let m21: Double, m22: Double, m23: Double
    let m31: Double, m32: Double, m33: Double
    var transposed: Matrix3 {
        Matrix3(m11: m11, m12: m21, m13: m31,
                m21: m12, m22: m22, m23: m32,
                m31: m13, m32: m23, m33: m33)
    }
    var upInDevice: Vector3 { Vector3(x: m31, y: m32, z: m33) }
}

struct BrowserOrientation {
    let alpha: Double
    let beta: Double
    let gamma: Double
    let matrixError: Double

    // R = Rz(alpha) Rx(beta) Ry(gamma), with local +Z out of the screen.
    // Validate whether Core Motion supplied device→world R or its transpose
    // against the independently reported gravity vector before decomposing.
    static func convert(_ candidate: Matrix3, gravity: Vector3) -> BrowserOrientation? {
        guard let down = gravity.normalized() else { return nil }
        let up = Vector3(x: -down.x, y: -down.y, z: -down.z)
        func error(_ matrix: Matrix3) -> Double {
            let row = matrix.upInDevice
            return sqrt(pow(row.x-up.x, 2) + pow(row.y-up.y, 2) + pow(row.z-up.z, 2))
        }
        let transposed = candidate.transposed
        let directError = error(candidate)
        let transposeError = error(transposed)
        let matrix = directError <= transposeError ? candidate : transposed
        let chosenError = min(directError, transposeError)
        guard chosenError.isFinite && chosenError < 0.20 else { return nil }

        let halfPi = Double.pi / 2
        var beta = asin(max(-1, min(1, matrix.m32)))
        var alpha: Double
        var gamma: Double
        if abs(cos(beta)) < 0.001 {
            // At gimbal lock alpha and gamma are not individually unique.
            gamma = 0
            alpha = atan2(matrix.m21, matrix.m11)
        } else {
            alpha = atan2(-matrix.m12, matrix.m22)
            gamma = atan2(-matrix.m31, matrix.m33)
            if gamma > halfPi || gamma < -halfPi {
                gamma += gamma > 0 ? -Double.pi : Double.pi
                beta = beta >= 0 ? Double.pi - beta : -Double.pi - beta
                alpha += Double.pi
            }
        }
        func degrees(_ radians: Double) -> Double { radians * 180 / Double.pi }
        let heading = (degrees(alpha).truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
        let result = BrowserOrientation(alpha: heading, beta: degrees(beta), gamma: degrees(gamma), matrixError: chosenError)
        guard [result.alpha, result.beta, result.gamma].allSatisfy(\.isFinite) else { return nil }
        return result
    }
}
