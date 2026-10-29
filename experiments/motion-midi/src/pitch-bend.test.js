import test from 'node:test'
import assert from 'node:assert/strict'
import { bendFromCents, bendMessage, centsFromBend, PitchBendController, CENTER } from './pitch-bend.js'
import { traceSegments } from './cc1-history.js'

function output(id) {
  const messages = []
  return { id, state: 'connected', messages, send(bytes) { messages.push(bytes) } }
}

function setup() {
  const events = []
  const controller = new PitchBendController({
    onSend: (value, cents) => events.push({ t: events.length, value: cents, midi: value }),
    onGap: () => events.push({ t: events.length, value: null }),
  })
  const port = output('first')
  controller.setOutput(port)
  controller.setEnabled(true)
  return { controller, port, events }
}

test('14-bit pitch bend encodes center and both endpoints', () => {
  assert.equal(bendFromCents(0), CENTER)
  assert.deepEqual(bendMessage(CENTER), [0xE0, 0x00, 0x40])
  assert.deepEqual(bendMessage(bendFromCents(-200)), [0xE0, 0x00, 0x00])
  assert.deepEqual(bendMessage(bendFromCents(200)), [0xE0, 0x7F, 0x7F])
  assert.equal(bendFromCents(-10000), 0)
  assert.equal(bendFromCents(10000), 16383)
  assert.equal(centsFromBend(CENTER), 0)
})

test('angle neutral, positive and negative bends, and change-only sends', () => {
  const { controller, port } = setup()
  controller.update({ status: 'ok', angle: 10, velocity: 0, acceleration: 0 })
  assert.ok(port.messages.at(-1)[2] > 64)
  const count = port.messages.length
  controller.update({ status: 'ok', angle: 10, velocity: 0, acceleration: 0 })
  assert.equal(port.messages.length, count)
  assert.equal(controller.setNeutralAngle(10), true)
  assert.deepEqual(port.messages.at(-1), [0xE0, 0, 64])
  controller.update({ status: 'ok', angle: 5, velocity: 0, acceleration: 0 })
  assert.ok(port.messages.at(-1)[2] < 64)
  controller.update({ status: 'ok', angle: 15, velocity: 0, acceleration: 0 })
  assert.ok(port.messages.at(-1)[2] > 64)
})

test('velocity and acceleration signs, source switching, sensitivity memory, and saturation', () => {
  const { controller, port } = setup()
  controller.setSource('velocity')
  assert.deepEqual(port.messages.at(-1), [0xE0, 0, 64])
  controller.setSensitivity(1.25)
  controller.update({ status: 'ok', angle: 0, velocity: 40, acceleration: 0 })
  assert.ok(controller.lastSent > CENTER)
  controller.update({ status: 'ok', angle: 0, velocity: -40, acceleration: 0 })
  assert.ok(controller.lastSent < CENTER)
  const beforeSlider = port.messages.length
  controller.setSensitivity(0.25)
  assert.equal(port.messages.length, beforeSlider + 1, 'slider updates the current bend')
  assert.ok(controller.lastSent < CENTER)
  controller.update({ status: 'ok', angle: 0, velocity: 0, acceleration: 0 })
  assert.equal(controller.lastSent, CENTER)
  controller.setSource('acceleration')
  controller.update({ status: 'ok', angle: 0, velocity: 0, acceleration: 1000 })
  assert.ok(controller.lastSent > CENTER)
  controller.update({ status: 'ok', angle: 0, velocity: 0, acceleration: -1000 })
  assert.ok(controller.lastSent < CENTER)
  controller.setSensitivity(0.5)
  controller.update({ status: 'ok', angle: 0, velocity: 0, acceleration: 10000 })
  assert.equal(controller.lastSent, 16383)
  controller.update({ status: 'ok', angle: 0, velocity: 0, acceleration: -10000 })
  assert.equal(controller.lastSent, 0)
  controller.setSource('velocity')
  assert.equal(controller.sensitivity.velocity, 0.25)
  assert.equal(controller.sensitivity.acceleration, 0.5)
})

test('timeout, disable, and output switch center safely; history records sends and gaps', () => {
  const { controller, port, events } = setup()
  controller.update({ status: 'ok', angle: 30, velocity: 0, acceleration: 0 })
  controller.unavailable('Sensor stale')
  assert.deepEqual(port.messages.at(-1), [0xE0, 0, 64])
  assert.equal(events.at(-1).value, null)
  controller.update({ status: 'ok', angle: -30, velocity: 0, acceleration: 0 })
  controller.setEnabled(false)
  assert.deepEqual(port.messages.at(-1), [0xE0, 0, 64])
  controller.setEnabled(true)
  controller.update({ status: 'ok', angle: 30, velocity: 0, acceleration: 0 })
  const next = output('second')
  controller.setOutput(next)
  assert.deepEqual(port.messages.at(-1), [0xE0, 0, 64], 'previous output centered')
  assert.deepEqual(next.messages.at(-1), [0xE0, 0, 64], 'new output initialized at center')
  assert.equal(traceSegments(events, 0, events.length).length > 1, true)
  assert.ok(events.some(event => event.value === 0 && event.midi === CENTER))
  assert.ok(events.some(event => event.value === null))
})

test('pitch graph holds transmitted cents and breaks after a disconnected output', () => {
  const { controller, port, events } = setup()
  controller.update({ status: 'ok', angle: 25, velocity: 0, acceleration: 0 })
  const transmitted = events.at(-1).value
  assert.ok(transmitted > 0)
  controller.update({ status: 'ok', angle: 25, velocity: 0, acceleration: 0 })
  assert.equal(events.at(-1).value, transmitted, 'no fabricated point for unchanged bend')
  const lastTime = events.at(-1).t
  assert.deepEqual(traceSegments(events, lastTime, lastTime + 2).at(-1), [
    { t: lastTime, value: transmitted }, { t: lastTime + 2, value: transmitted },
  ])
  port.state = 'disconnected'
  controller.setOutput(null)
  assert.equal(events.at(-1).value, null)
  assert.equal(port.messages.at(-1)[0], 0xE0, 'no message fabricated after disconnect')
})
