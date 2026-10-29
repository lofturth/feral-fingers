import { PitchCenterCrossing } from './pitch-center-crossing.js'

export const CENTER = 8192
export const PITCH_RANGES = {
  angle: { min: 0, max: 10, step: 0.1, initial: 2, unit: 'cents/°' },
  velocity: { min: 0, max: 2, step: 0.01, initial: 0.5, unit: 'cents/(°/s)' },
  acceleration: { min: 0, max: 0.5, step: 0.005, initial: 0.1, unit: 'cents/(°/s²)' },
}
export const SOURCE_UNITS = { angle: '°', velocity: '°/s', acceleration: '°/s²' }

export function bendFromCents(cents) {
  const limited = Math.max(-200, Math.min(200, cents))
  return Math.round(CENTER + limited * (limited < 0 ? 8192 : 8191) / 200)
}

export function centsFromBend(value) {
  return (value - CENTER) * 200 / (value < CENTER ? 8192 : 8191)
}

export const bendMessage = value => [0xE0, value & 0x7F, (value >> 7) & 0x7F]

export class PitchBendController {
  constructor({ onSend = () => {}, onGap = () => {}, onCrossing = () => {} } = {}) {
    this.onSend = onSend
    this.onGap = onGap
    this.onCrossing = onCrossing
    this.crossing = new PitchCenterCrossing()
    this.hapticEnabled = false
    this.output = null
    this.enabled = false
    this.source = 'angle'
    this.sensitivity = Object.fromEntries(Object.entries(PITCH_RANGES).map(([key, range]) => [key, range.initial]))
    this.neutralAngle = 0
    this.latest = null
    this.lastSent = null
  }

  get selectedValue() { return this.latest?.[this.source] ?? null }

  send(value, force = false, output = this.output, measurement = false) {
    if (!output || output.state !== 'connected' || (!force && value === this.lastSent && output === this.output)) return false
    try {
      output.send(bendMessage(value))
      if (output === this.output) this.lastSent = value
      this.onSend(value, centsFromBend(value))
      if (measurement && this.hapticEnabled && this.crossing.observe(centsFromBend(value))) this.onCrossing()
      return true
    } catch {
      this.onGap('MIDI send failed')
      if (output === this.output) this.lastSent = null
      return false
    }
  }

  setOutput(next) {
    if (next === this.output) return
    this.crossing.reset()
    if (this.output && this.lastSent !== null) this.send(CENTER, true, this.output)
    this.onGap('MIDI output changed')
    this.output = next
    this.lastSent = null
    if (next && this.enabled) this.send(CENTER, true)
  }

  setEnabled(enabled) {
    if (enabled === this.enabled) return
    this.crossing.reset()
    this.enabled = enabled
    if (enabled) this.send(CENTER, true)
    else { this.send(CENTER, true); this.onGap('Pitch bend disabled') }
  }

  setSource(source) {
    if (!(source in PITCH_RANGES) || source === this.source) return
    this.crossing.reset()
    this.source = source
    this.send(CENTER, true)
  }

  setNeutralAngle(angle) {
    if (typeof angle !== 'number' || !Number.isFinite(angle)) return false
    this.crossing.reset()
    this.neutralAngle = angle
    this.send(CENTER, true)
    return true
  }

  setSensitivity(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return
    this.crossing.reset()
    const range = PITCH_RANGES[this.source]
    this.sensitivity[this.source] = Math.max(range.min, Math.min(range.max, value))
    this.sendCurrent(false)
  }

  update(result) {
    if (!result || result.status === 'invalid') { this.unavailable('Orientation unavailable'); return }
    if (result.status === 'duplicate') return
    this.latest = result
    if (this.selectedValue === null) { this.unavailable('Waiting for derivative'); return }
    this.sendCurrent(true)
  }

  setHapticEnabled(enabled) { this.hapticEnabled = enabled; this.crossing.reset() }

  sendCurrent(measurement = true) {
    if (!this.enabled || this.selectedValue === null) return
    const offset = this.source === 'angle' ? this.neutralAngle : 0
    const cents = (this.selectedValue - offset) * this.sensitivity[this.source]
    this.send(bendFromCents(cents), false, this.output, measurement)
  }

  unavailable(reason) {
    this.crossing.reset()
    if (this.enabled && this.lastSent !== null && this.lastSent !== CENTER) this.send(CENTER)
    this.latest = null
    this.onGap(reason)
  }
}
