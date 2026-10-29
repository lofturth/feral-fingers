import test from 'node:test'
import assert from 'node:assert/strict'
import { mapOrientation, cc1FromAlignment, cc1Message } from './mapping.js'

test('W3C orientation maps face-up, face-down, vertical, and 45-degree tilts', () => {
  for (const [pose, beta, gamma, expected] of [
    ['face-up', 0, 0, 127],
    ['face-down', 180, 0, 127],
    ['vertical, top up', 90, 0, 1],
    ['vertical, top right', 0, 90, 1],
    ['45-degree pitch', 45, 0, 107],
    ['45-degree roll', 0, 45, 107],
    ['past vertical', 135, 0, 107],
    ['combined pitch and roll', 45, 45, 90],
  ]) {
    for (const alpha of [0, 90, 217, 359]) {
      const mapped = mapOrientation({ alpha, beta, gamma })
      assert.equal(mapped.cc1, expected, `${pose}, heading ${alpha}`)
      assert.deepEqual(cc1Message(mapped.cc1), [0xB0, 0x01, expected])
    }
  }
})

test('curve exponents preserve endpoints and symmetric screen orientations', () => {
  for (const [exponent, middle] of [[0.5, 90], [1, 64], [2, 33]]) {
    assert.equal(cc1FromAlignment(0, exponent), 1)
    assert.equal(cc1FromAlignment(0.5, exponent), middle)
    assert.equal(cc1FromAlignment(1, exponent), 127)
    assert.equal(mapOrientation({ alpha: 30, beta: 0, gamma: 0 }, exponent).cc1, 127)
    assert.equal(mapOrientation({ alpha: 220, beta: 180, gamma: 0 }, exponent).cc1, 127)
    assert.equal(mapOrientation({ alpha: 30, beta: 90, gamma: 0 }, exponent).cc1, 1)
  }
})

test('missing or invalid orientation never produces a CC1 value', () => {
  for (const reading of [null, {}, { alpha: null, beta: 0, gamma: 0 },
    { alpha: 0, beta: NaN, gamma: 0 }, { alpha: 0, beta: 0, gamma: Infinity }]) {
    assert.equal(mapOrientation(reading), null)
  }
})
