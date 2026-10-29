import test from 'node:test'
import assert from 'node:assert/strict'
import { visibleSegments } from './history.js'

test('five-second traces retain samples across the left edge and break at gaps', () => {
  const points = [
    { t: 0, angle: 10, velocity: null },
    { t: 2, angle: 20, velocity: 30 },
    { t: 3, angle: null, velocity: null },
    { t: 4, angle: 25, velocity: null },
    { t: 5, angle: 30, velocity: -10 },
  ]
  assert.deepEqual(visibleSegments(points, 'angle', 1, 5), [
    [{ t: 1, value: 10 }, { t: 2, value: 20 }],
    [{ t: 4, value: 25 }, { t: 5, value: 30 }],
  ])
  assert.deepEqual(visibleSegments(points, 'velocity', 1, 5), [
    [{ t: 2, value: 30 }], [{ t: 5, value: -10 }],
  ])
})
