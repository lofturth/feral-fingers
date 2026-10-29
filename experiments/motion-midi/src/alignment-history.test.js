import test from 'node:test'
import assert from 'node:assert/strict'
import { alignmentSegments } from './alignment-history.js'

test('alignment graph plots continuous calculated samples without MIDI or fabricated holds', () => {
  const events = [
    { t: 0, value: 1 }, { t: 2, value: Math.SQRT1_2 },
    { t: 3, value: null }, { t: 4, value: 0.25 }, { t: 5, value: 0.5 },
  ]
  const segments = alignmentSegments(events, 1, 6)
  assert.ok(Math.abs(segments[0][0].value - (1 + Math.SQRT1_2) / 2) < 1e-12)
  assert.deepEqual(segments[0][1], { t: 2, value: Math.SQRT1_2 })
  assert.deepEqual(segments[1], [{ t: 4, value: 0.25 }, { t: 5, value: 0.5 }])
  assert.equal(segments[1].at(-1).t, 5, 'no invented sample at current time')
})
