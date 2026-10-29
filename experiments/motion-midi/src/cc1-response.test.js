import test from 'node:test'
import assert from 'node:assert/strict'
import { Cc1Response } from './cc1-response.js'
import { traceSegments } from './cc1-history.js'

test('curve changes send immediately from the last alignment without phone movement', () => {
  const messages = []
  const events = []
  const output = { state: 'connected', send(message) { messages.push(message) } }
  const response = new Cc1Response({ onSend: value => events.push({ t: events.length, value }) })
  response.setOutput(output)
  response.setAlignment(0.5)
  assert.deepEqual(messages.at(-1), [0xB0, 0x01, 90])
  response.setExponent(1)
  assert.deepEqual(messages.at(-1), [0xB0, 0x01, 64])
  response.setExponent(2)
  assert.deepEqual(messages.at(-1), [0xB0, 0x01, 33])
  const sent = messages.length
  response.setExponent(2)
  assert.equal(messages.length, sent, 'unchanged integer CC1 is not resent')
  assert.deepEqual(events.map(event => event.value), [90, 64, 33])
  assert.deepEqual(traceSegments(events, 0, 4).at(-1).at(-1), { t: 4, value: 33 })
})

test('curve changes without valid alignment or MIDI output send nothing', () => {
  const messages = []
  const output = { state: 'connected', send(message) { messages.push(message) } }
  const response = new Cc1Response()
  response.setExponent(1)
  response.setAlignment(0.5)
  assert.equal(messages.length, 0)
  response.setOutput(output)
  response.setExponent(2)
  assert.deepEqual(messages.at(-1), [0xB0, 0x01, 33])
  response.clear()
  response.setExponent(0.5)
  assert.equal(messages.length, 1)
})
