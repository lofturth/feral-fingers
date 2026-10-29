import test from 'node:test'
import assert from 'node:assert/strict'
import { graphY } from './graph-scale.js'

test('fixed symmetric scale centers zero and clips values outside the limits', () => {
  assert.equal(graphY(0, 10, 100), 50)
  assert.equal(graphY(5, 10, 100), 25)
  assert.equal(graphY(-5, 10, 100), 75)
  assert.equal(graphY(20, 10, 100), 0)
  assert.equal(graphY(-20, 10, 100), 100)
  assert.equal(graphY(5, 5, 100), 0)
})
