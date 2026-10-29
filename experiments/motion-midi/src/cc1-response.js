import { cc1FromAlignment, cc1Message } from './mapping.js'

export class Cc1Response {
  constructor({ onSend = () => {}, onError = () => {} } = {}) {
    this.exponent = 0.5
    this.alignment = null
    this.output = null
    this.lastSent = null
    this.onSend = onSend
    this.onError = onError
  }

  get cc1() { return this.alignment === null ? null : cc1FromAlignment(this.alignment, this.exponent) }

  setOutput(output) { this.output = output; this.lastSent = null }
  clear() { this.alignment = null; this.lastSent = null }

  setAlignment(alignment) {
    this.alignment = alignment
    this.sendCurrent()
  }

  setExponent(exponent) {
    if (!Number.isFinite(exponent)) return
    this.exponent = Math.max(0.25, Math.min(2, exponent))
    this.sendCurrent()
  }

  sendCurrent() {
    const value = this.cc1
    if (value === null || !this.output || this.output.state !== 'connected' || value === this.lastSent) return
    try {
      this.output.send(cc1Message(value))
      this.lastSent = value
      this.onSend(value)
    } catch (error) {
      this.lastSent = null
      this.onError(error)
    }
  }
}
