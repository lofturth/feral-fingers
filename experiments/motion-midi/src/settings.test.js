import test from 'node:test'
import assert from 'node:assert/strict'
import { applySettings, availableOutputId, loadSettings, parseSettings, saveSettings, SETTINGS_KEY } from './settings.js'
import { Cc1Response } from './cc1-response.js'
import { PitchBendController } from './pitch-bend.js'

function memoryStorage() {
  const entries = new Map()
  return { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) }
}

test('settings survive reload with separate sensitivities, scales, haptic preference, and output ID', () => {
  const storage = memoryStorage()
  const first = loadSettings(storage)
  first.outputId = 'stable-midi-id'
  first.exponent = 1.45
  first.source = 'acceleration'
  first.sensitivity = { angle: 3.2, velocity: 1.23, acceleration: 0.275 }
  first.velocityScale = 720
  first.accelerationScale = 4000
  first.hapticEnabled = true
  saveSettings(storage, first)
  assert.deepEqual(loadSettings(storage), first)
  assert.equal(JSON.parse(storage.getItem(SETTINGS_KEY)).version, 1)
})

test('malformed, outdated, and invalid fields fall back safely', () => {
  const defaults = parseSettings(null)
  assert.deepEqual(parseSettings('{oops'), defaults)
  assert.deepEqual(parseSettings('{"version":2,"exponent":2}'), defaults)
  const parsed = parseSettings(JSON.stringify({ version: 1, outputId: 44, exponent: 99, source: 'unknown', sensitivity: { angle: -1, velocity: 1 }, velocityScale: 123, hapticEnabled: 'yes' }))
  assert.equal(parsed.exponent, 0.5)
  assert.equal(parsed.source, 'angle')
  assert.equal(parsed.sensitivity.angle, 2)
  assert.equal(parsed.sensitivity.velocity, 1)
  assert.equal(parsed.velocityScale, 180)
  assert.equal(parsed.hapticEnabled, false)
})

test('restoration never sends MIDI, enables Pitch Bend, or restores neutral calibration', () => {
  const cc1 = new Cc1Response()
  const pitch = new PitchBendController()
  const messages = []
  const output = { id: 'preferred', state: 'connected', send: bytes => messages.push(bytes) }
  const settings = parseSettings(JSON.stringify({ version: 1, outputId: 'preferred', exponent: 2, source: 'velocity', sensitivity: { angle: 4, velocity: 1.5, acceleration: 0.2 }, hapticEnabled: true }))
  applySettings(settings, cc1, pitch)
  assert.equal(cc1.exponent, 2)
  assert.equal(pitch.source, 'velocity')
  assert.equal(pitch.sensitivity.angle, 4)
  assert.equal(pitch.neutralAngle, 0)
  assert.equal(pitch.enabled, false)
  assert.equal(pitch.hapticEnabled, true)
  assert.deepEqual(messages, [])
  // A preferred output is only selected once it is connected and MIDI is enabled by the user.
  assert.equal(cc1.output, null)
  assert.equal(pitch.output, null)
  pitch.setOutput(output)
  cc1.setOutput(output)
  assert.deepEqual(messages, [])
})

test('source changes retain all restored sensitivities; absent preferred outputs remain unselected', () => {
  const settings = parseSettings(JSON.stringify({ version: 1, outputId: 'missing', source: 'velocity', sensitivity: { angle: 4, velocity: 1.5, acceleration: 0.2 } }))
  const pitch = new PitchBendController()
  applySettings(settings, new Cc1Response(), pitch)
  pitch.setSource('angle')
  assert.equal(pitch.sensitivity.angle, 4)
  pitch.setSource('acceleration')
  assert.equal(pitch.sensitivity.acceleration, 0.2)
  assert.equal(availableOutputId([{ id: 'other' }], '', settings.outputId), '')
  assert.equal(availableOutputId([{ id: 'missing' }], '', settings.outputId), 'missing')
})
