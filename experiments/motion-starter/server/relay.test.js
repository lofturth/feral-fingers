import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { startRelay } from './relay.js'

function receive(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off('message', handler); reject(new Error('Relay timeout')) }, 1500)
    const handler = data => {
      const value = JSON.parse(data.toString())
      if (!predicate(value)) return
      clearTimeout(timer)
      socket.off('message', handler)
      resolve(value)
    }
    socket.on('message', handler)
  })
}

test('forwards nullable and omitted sensor fields, then reports disconnect', async t => {
  const server = startRelay(0)
  t.after(async () => {
    for (const socket of server.clients) socket.terminate()
    await new Promise(resolve => server.close(resolve))
  })
  await once(server, 'listening')
  const url = `ws://127.0.0.1:${server.address().port}/motion-relay`
  async function connect(role) {
    const socket = new WebSocket(url)
    await once(socket, 'open')
    const status = receive(socket, message => message.type === 'status')
    socket.send(JSON.stringify({ role }))
    await status
    return socket
  }
  const mac = await connect('receiver')
  const connected = receive(mac, message => message.type === 'status' && message.controllerConnected)
  const phone = await connect('controller')
  await connected
  const sample = { type: 'motion', source: 'deviceMotion', t: 123.4,
    rotationRate: { alpha: null }, acceleration: { x: 1, y: null }, accelerationIncludingGravity: {} }
  const next = receive(mac, message => message.type === 'motion')
  phone.send(JSON.stringify(sample))
  assert.deepEqual(await next, sample)
  const disconnected = receive(mac, message => message.type === 'status' && !message.controllerConnected)
  phone.close()
  await disconnected
})

test('routes pitch-center feedback only to the active controller', async t => {
  const server = startRelay(0)
  t.after(async () => {
    for (const socket of server.clients) socket.terminate()
    await new Promise(resolve => server.close(resolve))
  })
  await once(server, 'listening')
  const url = `ws://127.0.0.1:${server.address().port}/motion-relay`
  async function connect(role) {
    const socket = new WebSocket(url)
    await once(socket, 'open')
    const status = receive(socket, message => message.type === 'status')
    socket.send(JSON.stringify({ role }))
    await status
    return socket
  }
  const receiver = await connect('receiver')
  const otherReceiver = await connect('receiver')
  const phone = await connect('controller')
  const command = receive(phone, message => message.type === 'pitchCenterHaptic')
  let otherSawCommand = false
  otherReceiver.on('message', data => {
    if (JSON.parse(data.toString()).type === 'pitchCenterHaptic') otherSawCommand = true
  })
  receiver.send(JSON.stringify({ type: 'pitchCenterHaptic' }))
  assert.deepEqual(await command, { type: 'pitchCenterHaptic' })
  assert.equal(otherSawCommand, false)
  receiver.send(JSON.stringify({ type: 'pitchCenterHaptic', extra: true }))
  await new Promise(resolve => setTimeout(resolve, 40))
  assert.equal(otherSawCommand, false)
})
