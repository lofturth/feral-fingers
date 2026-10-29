import test from 'node:test'
import assert from 'node:assert/strict'
import { traceSegments } from './cc1-history.js'

test('holds sent CC1 between changes and across the visible left edge', () => {
  assert.deepEqual(traceSegments([{ t: 0, value: 64 }, { t: 3, value: 90 }], 1, 5), [[
    { t: 1, value: 64 }, { t: 3, value: 64 }, { t: 3, value: 90 }, { t: 5, value: 90 },
  ]])
  assert.deepEqual(traceSegments([{ t: 0, value: 64 }], 1, 5), [[
    { t: 1, value: 64 }, { t: 5, value: 64 },
  ]])
})

test('stops at a gap and resumes only with another transmitted value', () => {
  assert.deepEqual(traceSegments([
    { t: 0, value: 64 }, { t: 2, value: null }, { t: 4, value: 127 },
  ], 0, 5), [
    [{ t: 0, value: 64 }, { t: 2, value: 64 }],
    [{ t: 4, value: 127 }, { t: 5, value: 127 }],
  ])
})
