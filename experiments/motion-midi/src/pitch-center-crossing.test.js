import test from 'node:test'
import assert from 'node:assert/strict'
import { PitchCenterCrossing } from './pitch-center-crossing.js'
import { PitchBendController } from './pitch-bend.js'

test('both crossing directions require rearming outside five cents', () => {
  const crossing = new PitchCenterCrossing()
  assert.deepEqual([1, 4, 6, 2, 0, -1, -4, -6, -2, 1, 0, 7].map(x => crossing.observe(x)),
    [false, false, false, false, true, false, false, false, false, true, false, false])
  assert.equal(crossing.observe(-7), true)
})

test('only successful measurement sends trigger; controls and safety centers reset', () => {
  let taps = 0
  const output = { state: 'connected', fail: false, send() { if (this.fail) throw new Error('send failed') } }
  const pitch = new PitchBendController({ onCrossing: () => taps++ })
  pitch.setOutput(output)
  pitch.setEnabled(true)
  pitch.setHapticEnabled(true)
  const move = angle => pitch.update({ status: 'ok', angle, velocity: 0, acceleration: 0 })
  move(10); move(-10)
  assert.equal(taps, 1)
  move(-11); move(10)
  assert.equal(taps, 2)
  pitch.setSource('velocity'); pitch.setSource('angle')
  pitch.setNeutralAngle(0)
  pitch.setSensitivity(2.1)
  pitch.unavailable('stale')
  assert.equal(taps, 2)
  move(10)
  output.fail = true
  move(-10)
  assert.equal(taps, 2, 'failed MIDI send cannot tap')
  output.fail = false
  pitch.setEnabled(false)
  pitch.setEnabled(true)
  move(-10)
  assert.equal(taps, 2, 'enable and control centers cannot tap')
})
