import Foundation
import CoreMotion
import SwiftUI

@MainActor
final class MotionSender: ObservableObject {
    @Published var connected = false
    @Published var streaming = false
    @Published var connectionStatus = "Disconnected"
    @Published var diagnostic = "Waiting for motion"
    @Published var sentSamples = 0
    @Published var hapticCommandsReceived = 0
    @Published var lastHapticCommand = "Never"
    @Published var hapticTestStatus = "Not tested"
    @Published var hapticCommandStatus = "No command played"

    private let manager = CMMotionManager()
    private let session = URLSession(configuration: .default)
    private var socket: URLSessionWebSocketTask?
    private var heartbeat: Timer?
    private var previousTimestamp: TimeInterval?
    private let pitchHaptic = PitchHaptic()

    func connect(_ address: String) {
        guard socket == nil else { return }
        guard let url = URL(string: address), url.scheme == "wss", url.path == "/motion-relay" else {
            connectionStatus = "Use wss://<Mac hostname>:5184/motion-relay"
            return
        }
        let task = session.webSocketTask(with: url)
        socket = task
        connectionStatus = "Connecting…"
        task.resume()
        Task {
            do {
                try await task.send(.string("{\"role\":\"controller\"}"))
                guard socket === task else { return }
                connected = true
                connectionStatus = "Connected · waiting for relay status"
                heartbeat = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
                    Task { @MainActor in self?.send(["type": "heartbeat"]) }
                }
                await receive(task)
            } catch {
                if socket === task { close("Connection failed: \(error.localizedDescription)") }
            }
        }
    }

    private func receive(_ task: URLSessionWebSocketTask) async {
        while socket === task {
            do {
                let message = try await task.receive()
                if case .string(let text) = message,
                   let data = text.data(using: .utf8),
                   let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    if json["type"] as? String == "status" {
                        let present = json["controllerConnected"] as? Bool ?? false
                        connectionStatus = present ? "Relay connected · controller active" : "Relay connected · waiting"
                    } else if FeedbackCommand.isPitchCenterHaptic(json) {
                        hapticCommandsReceived += 1
                        lastHapticCommand = Date().formatted(date: .omitted, time: .standard)
                        Task { self.hapticCommandStatus = await self.pitchHaptic.tap() }
                    }
                }
            } catch {
                if socket === task { close("Disconnected: \(error.localizedDescription)") }
                return
            }
        }
    }

    func disconnect() { close("Disconnected") }

    func testHaptic() {
        Task { hapticTestStatus = await pitchHaptic.tap() }
    }

    private func close(_ status: String) {
        stopMotion()
        heartbeat?.invalidate()
        heartbeat = nil
        socket?.cancel(with: .normalClosure, reason: nil)
        socket = nil
        connected = false
        connectionStatus = status
    }

    func startMotion() {
        guard connected, manager.isDeviceMotionAvailable else {
            diagnostic = "Device motion unavailable"
            return
        }
        previousTimestamp = nil
        manager.deviceMotionUpdateInterval = 1.0 / 60.0
        manager.startDeviceMotionUpdates(using: .xArbitraryZVertical, to: .main) { [weak self] motion, error in
            Task { @MainActor in
                guard let self, self.streaming else { return }
                if let motion { self.handle(motion) }
                else if let error { self.diagnostic = error.localizedDescription }
            }
        }
        streaming = true
        diagnostic = "Streaming at requested 60 Hz"
    }

    func stopMotion() {
        manager.stopDeviceMotionUpdates()
        streaming = false
        previousTimestamp = nil
    }

    private func handle(_ motion: CMDeviceMotion) {
        let matrix = motion.attitude.rotationMatrix
        let native = Matrix3(m11: matrix.m11, m12: matrix.m12, m13: matrix.m13,
                             m21: matrix.m21, m22: matrix.m22, m23: matrix.m23,
                             m31: matrix.m31, m32: matrix.m32, m33: matrix.m33)
        let gravity = Vector3(x: motion.gravity.x, y: motion.gravity.y, z: motion.gravity.z)
        let timestamp = motion.timestamp * 1000
        if let angles = BrowserOrientation.convert(native, gravity: gravity) {
            send(["type": "motion", "source": "orientation", "t": timestamp,
                  "alpha": angles.alpha, "beta": angles.beta, "gamma": angles.gamma,
                  "absolute": false])
            diagnostic = String(format: "α %.1f°  β %.1f°  γ %.1f° · matrix/gravity error %.3f",
                                angles.alpha, angles.beta, angles.gamma, angles.matrixError)
        } else {
            diagnostic = "Orientation withheld: attitude/gravity axes disagree"
        }
        let degrees = 180.0 / Double.pi
        let g = 9.80665
        let interval: Any = previousTimestamp.map { (motion.timestamp - $0) * 1000 } ?? NSNull()
        previousTimestamp = motion.timestamp
        send(["type": "motion", "source": "deviceMotion", "t": timestamp,
              "rotationRate": ["alpha": motion.rotationRate.x * degrees,
                               "beta": motion.rotationRate.y * degrees,
                               "gamma": motion.rotationRate.z * degrees],
              "acceleration": ["x": motion.userAcceleration.x * g,
                               "y": motion.userAcceleration.y * g,
                               "z": motion.userAcceleration.z * g],
              "accelerationIncludingGravity": ["x": (motion.userAcceleration.x - motion.gravity.x) * g,
                                                "y": (motion.userAcceleration.y - motion.gravity.y) * g,
                                                "z": (motion.userAcceleration.z - motion.gravity.z) * g],
              "interval": interval])
    }

    private func send(_ payload: [String: Any]) {
        guard let socket, JSONSerialization.isValidJSONObject(payload),
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let text = String(data: data, encoding: .utf8) else { return }
        Task {
            do {
                try await socket.send(.string(text))
                if payload["type"] as? String == "motion" { sentSamples += 1 }
            } catch {
                diagnostic = "Send failed: \(error.localizedDescription)"
            }
        }
    }
}
