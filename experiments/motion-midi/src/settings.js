import { PITCH_RANGES } from './pitch-bend.js'

export const SETTINGS_KEY = 'feral-motion-midi-settings'
const DEFAULTS = {
  version: 1,
  outputId: '',
  exponent: 0.5,
  source: 'angle',
  sensitivity: Object.fromEntries(Object.entries(PITCH_RANGES).map(([key, range]) => [key, range.initial])),
  velocityScale: 180,
  accelerationScale: 1000,
  hapticEnabled: false,
}

export function parseSettings(text) {
  let stored
  try { stored = JSON.parse(text) } catch { return structuredClone(DEFAULTS) }
  if (!stored || typeof stored !== 'object' || stored.version !== 1) return structuredClone(DEFAULTS)
  const result = structuredClone(DEFAULTS)
  if (typeof stored.outputId === 'string' && stored.outputId.length < 256) result.outputId = stored.outputId
  if (Number.isFinite(stored.exponent) && stored.exponent >= 0.25 && stored.exponent <= 2) result.exponent = stored.exponent
  if (Object.hasOwn(PITCH_RANGES, stored.source)) result.source = stored.source
  for (const [key, range] of Object.entries(PITCH_RANGES)) {
    const value = stored.sensitivity?.[key]
    if (Number.isFinite(value) && value >= range.min && value <= range.max) result.sensitivity[key] = value
  }
  if ([180, 360, 720].includes(stored.velocityScale)) result.velocityScale = stored.velocityScale
  if ([1000, 2000, 4000].includes(stored.accelerationScale)) result.accelerationScale = stored.accelerationScale
  if (typeof stored.hapticEnabled === 'boolean') result.hapticEnabled = stored.hapticEnabled
  return result
}

export function loadSettings(storage) {
  try { return parseSettings(storage.getItem(SETTINGS_KEY)) } catch { return structuredClone(DEFAULTS) }
}

export function saveSettings(storage, settings) {
  try { storage.setItem(SETTINGS_KEY, JSON.stringify(parseSettings(JSON.stringify(settings)))) } catch { /* Storage may be disabled. */ }
}

export function applySettings(settings, cc1, pitch) {
  cc1.setExponent(settings.exponent)
  pitch.setSource(settings.source)
  for (const [source, value] of Object.entries(settings.sensitivity)) pitch.sensitivity[source] = value
  pitch.setHapticEnabled(settings.hapticEnabled)
  // MIDI output, Pitch Bend enablement, and angle neutral are deliberately untouched.
}

export function availableOutputId(outputs, currentId, preferredId) {
  if (outputs.some(output => output.id === currentId)) return currentId
  if (outputs.some(output => output.id === preferredId)) return preferredId
  return ''
}
