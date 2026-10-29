export function graphY(value, scale, height) {
  return Math.max(0, Math.min(height, height / 2 - value / scale * height / 2))
}
