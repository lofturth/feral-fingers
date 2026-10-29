export class PitchCenterCrossing {
  constructor(threshold = 5) { this.threshold = threshold; this.reset() }
  reset() { this.armedSide = 0 }
  observe(cents) {
    const side = Math.sign(cents)
    if (!this.armedSide) {
      if (Math.abs(cents) >= this.threshold) this.armedSide = side
      return false
    }
    if (side === 0 || side !== this.armedSide) {
      this.armedSide = Math.abs(cents) >= this.threshold ? side : 0
      return true
    }
    return false
  }
}
