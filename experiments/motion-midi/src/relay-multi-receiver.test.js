import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { startRelay } from '../../motion-starter/server/relay.js'

test('two simultaneous receivers get the same phone sample', async t => {
  const server = startRelay(0)
  await once(server, 'listening')
  t.after(async () => {
    for (const peer of server.clients) peer.terminate()
    await new Promise(resolve => server.close(resolve))
  })
  const url = `ws://127.0.0.1:${server.address().port}/motion-relay`
  async function connect(role) {
    const socket = new WebSocket(url)
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', reject, { once: true })
    })
    socket.send(JSON.stringify({ role }))
    await receive(socket, message => message.type === 'status')
    return socket
  }
  function receive(socket, predicate) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { socket.removeEventListener('message', handler); reject(new Error('Relay timeout')) }, 1500)
      function handler(event) {
        const message = JSON.parse(event.data)
        if (!predicate(message)) return
        clearTimeout(timeout)
        socket.removeEventListener('message', handler)
        resolve(message)
      }
      socket.addEventListener('message', handler)
    })
  }
  const dashboard = await connect('receiver')
  const midi = await connect('receiver')
  const phone = await connect('controller')
  t.after(() => { dashboard.close(); midi.close(); phone.close() })
  const sample = { type: 'motion', source: 'orientation', t: 1,
    alpha: 90, beta: 45, gamma: 0, absolute: false }
  const dashboardSample = receive(dashboard, message => message.type === 'motion')
  const midiSample = receive(midi, message => message.type === 'motion')
  phone.send(JSON.stringify(sample))
  assert.deepEqual(await dashboardSample, sample)
  assert.deepEqual(await midiSample, sample)
})
