import test from 'node:test'
import assert from 'node:assert/strict'
import { elevationFromOrientation, ElevationTracker } from './measure.js'

const sample = (t, beta, gamma = 0, alpha = 0) => ({ t, alpha, beta, gamma })
const close = (actual, expected, tolerance = 0.001) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected}`)

test('A: raising is positive, lowering negative, horizontal zero', () => {
  for (const [beta, expected] of [[-90, -90], [-45, -45], [0, 0], [45, 45], [90, 90], [135, 45], [180, 0]]) {
    close(elevationFromOrientation(sample(0, beta)), expected)
  }
  const tracker = new ElevationTracker()
  tracker.add(sample(0, 0))
  for (let t = 20; t <= 1000; t += 20) tracker.add(sample(t, t * 0.03))
  close(tracker.velocity, 30, 0.1)
  const top = tracker.add(sample(1020, 30 - 0.6))
  assert.ok(top.velocity < 30)
  for (let t = 1040; t <= 2000; t += 20) tracker.add(sample(t, 30 - (t - 1000) * 0.03))
  assert.ok(tracker.velocity < -29)
})

test('B: ideal twist leaves elevation and derivatives unchanged, including angle boundaries', () => {
  for (const beta of [-89.9, -45, 0, 35, 89.9, 90, 90.1, 179.9, -179.9]) {
    const expected = elevationFromOrientation(sample(0, beta))
    const tracker = new ElevationTracker()
    for (let i = 0; i < 100; i++) {
      const gamma = -90 + i * 180 / 99
      const alpha = (i * 73) % 360
      const result = tracker.add(sample(i * 20, beta, gamma, alpha))
      close(result.angle, expected)
      if (i) { close(result.velocity, 0); close(result.acceleration, 0) }
    }
  }
})

test('C: stationary derivatives settle to zero without drift', () => {
  const tracker = new ElevationTracker()
  tracker.add(sample(0, 0))
  for (let t = 20; t <= 500; t += 20) tracker.add(sample(t, t * 0.08))
  let result
  for (let t = 520; t <= 3000; t += 20) result = tracker.add(sample(t, 40))
  close(result.velocity, 0, 0.01)
  close(result.acceleration, 0, 0.1)
  for (let t = 3020; t <= 10000; t += 20) result = tracker.add(sample(t, 40))
  close(result.velocity, 0, 0.00001)
  close(result.acceleration, 0, 0.00001)
})

test('A: acceleration changes sign as a raise speeds up then slows down', () => {
  const tracker = new ElevationTracker()
  tracker.add(sample(0, 0))
  let result
  for (let t = 20; t <= 1000; t += 20) {
    const seconds = t / 1000
    result = tracker.add(sample(t, 20 * seconds * seconds))
  }
  assert.ok(result.velocity > 0)
  assert.ok(result.acceleration > 25)
  for (let t = 1020; t <= 2000; t += 20) {
    const seconds = (t - 1000) / 1000
    result = tracker.add(sample(t, 20 + 40 * seconds - 20 * seconds * seconds))
  }
  assert.ok(result.velocity > 0)
  assert.ok(result.acceleration < -25)
})

test('D: irregular timestamps, duplicates, gaps, invalid samples, and reconnect reset', () => {
  const tracker = new ElevationTracker()
  let result = tracker.add(sample(1000, 0))
  assert.equal(result.status, 'baseline')
  for (const t of [1017, 1041, 1060, 1095, 1120, 1153, 1180, 1211, 1240, 1275, 1300, 1333, 1360, 1390, 1420, 1450, 1480, 1510, 1540, 1570, 1600]) {
    result = tracker.add(sample(t, (t - 1000) * 0.02))
  }
  close(result.velocity, 20, 0.2)
  assert.equal(tracker.add(sample(1600, 50)).status, 'duplicate')
  assert.equal(tracker.add(sample(1590, 50)).status, 'duplicate')
  assert.equal(tracker.add(sample(1602, 50)).status, 'duplicate')
  assert.equal(tracker.add(sample(2000, 30)).status, 'baseline')
  assert.equal(tracker.add(sample(2020, 30.4)).status, 'ok')
  assert.equal(tracker.add(sample(2040, null)).status, 'invalid')
  assert.equal(tracker.add(sample(10, 5)).status, 'baseline')
})

test('invalid angles never produce an elevation', () => {
  for (const value of [null, {}, sample(0, null), sample(0, NaN), sample(0, 0, Infinity), sample(0, 0, 0, null)]) {
    assert.equal(elevationFromOrientation(value), null)
  }
})
