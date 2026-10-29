export function cc1FromAlignment(alignment, exponent = 0.5) {
  const bounded = Math.max(0, Math.min(1, alignment))
  return Math.round(1 + 126 * bounded ** exponent)
}

export function mapOrientation(reading, exponent = 0.5) {
  const { alpha, beta, gamma } = reading ?? {}
  if (![alpha, beta, gamma].every(value => typeof value === 'number' && Number.isFinite(value))) return null
  // W3C intrinsic Z-X'-Y'' rotation: R[2][2] = cos(beta) cos(gamma).
  // Alpha rotates only around world vertical.
  const radians = Math.PI / 180
  const alignment = Math.min(1, Math.abs(Math.cos(beta * radians) * Math.cos(gamma * radians)))
  return { alignment, cc1: cc1FromAlignment(alignment, exponent) }
}

export const cc1Message = value => [0xB0, 0x01, value]
