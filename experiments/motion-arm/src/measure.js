const TO_RADIANS = Math.PI / 180
const TO_DEGREES = 180 / Math.PI

export function elevationFromOrientation(sample) {
  const { alpha, beta, gamma } = sample ?? {}
  if (![alpha, beta, gamma].every(value => typeof value === 'number' && Number.isFinite(value))) return null
  // W3C intrinsic Z-X'-Y'': the world-Z component of local +Y is R[2][1].
  const up = Math.sin(beta * TO_RADIANS)
  return Math.asin(Math.max(-1, Math.min(1, up))) * TO_DEGREES
}

export class ElevationTracker {
  constructor() { this.reset() }

  reset() {
    this.previous = null
    this.velocity = 0
    this.acceleration = 0
  }

  add(sample) {
    const angle = elevationFromOrientation(sample)
    const t = sample?.t
    if (angle === null || typeof t !== 'number' || !Number.isFinite(t) || t < 0) {
      this.reset()
      return { status: 'invalid', angle: null, velocity: null, acceleration: null }
    }
    if (this.previous) {
      const dt = (t - this.previous.t) / 1000
      if (dt < 0.005) return { status: 'duplicate', angle: null, velocity: null, acceleration: null }
      if (dt > 0.25) this.reset()
    }
    if (!this.previous) {
      this.previous = { t, angle }
      return { status: 'baseline', angle, velocity: null, acceleration: null }
    }
    const dt = (t - this.previous.t) / 1000
    const rawVelocity = (angle - this.previous.angle) / dt
    const oldVelocity = this.velocity
    const velocityWeight = 1 - Math.exp(-dt / 0.12)
    this.velocity += velocityWeight * (rawVelocity - this.velocity)
    const rawAcceleration = (this.velocity - oldVelocity) / dt
    const accelerationWeight = 1 - Math.exp(-dt / 0.15)
    this.acceleration += accelerationWeight * (rawAcceleration - this.acceleration)
    this.previous = { t, angle }
    return { status: 'ok', angle, velocity: this.velocity, acceleration: this.acceleration }
  }
}
