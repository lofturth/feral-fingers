import { WebSocket, WebSocketServer } from 'ws'
import { pathToFileURL } from 'node:url'

const finiteOrNull = value => value === null || (typeof value === 'number' && Number.isFinite(value))
const fields = (value, names) => value && typeof value === 'object' && !Array.isArray(value)
  && names.every(name => value[name] === undefined || finiteOrNull(value[name]))

export function validSample(value) {
  if (!value || value.type !== 'motion' || !Number.isFinite(value.t) || value.t < 0) return false
  if (value.source === 'orientation') return fields(value, ['alpha', 'beta', 'gamma'])
    && (value.absolute === undefined || value.absolute === null || typeof value.absolute === 'boolean')
  if (value.source === 'deviceMotion') return fields(value.rotationRate, ['alpha', 'beta', 'gamma'])
    && fields(value.acceleration, ['x', 'y', 'z'])
    && fields(value.accelerationIncludingGravity, ['x', 'y', 'z'])
    && (value.interval === undefined || finiteOrNull(value.interval))
  return false
}

export function startRelay(port = 8784, host = '127.0.0.1') {
  const server = new WebSocketServer({ port, host, maxPayload: 4096, path: '/motion-relay' })
  const peers = new Set()
  let phone = null
  let lastSeen = 0
  const send = (socket, message) => {
    if (socket.readyState !== WebSocket.OPEN) return
    if (socket.bufferedAmount > 65536) return socket.terminate()
    socket.send(JSON.stringify(message))
  }
  const status = () => {
    for (const peer of peers) send(peer, { type: 'status', controllerConnected: phone !== null })
  }
  const release = socket => {
    peers.delete(socket)
    if (phone === socket) { phone = null; status() }
  }
  const timer = setInterval(() => {
    if (phone && performance.now() - lastSeen > 3000) phone.terminate()
    status()
  }, 500)
  server.on('close', () => clearInterval(timer))
  server.on('connection', socket => {
    let role = null
    socket.on('error', () => socket.terminate())
    socket.on('close', () => release(socket))
    socket.on('message', (data, binary) => {
      let value
      try { value = JSON.parse(data.toString()) } catch { return socket.close(1008, 'Invalid JSON') }
      if (binary || !value || typeof value !== 'object' || Array.isArray(value)) return socket.close(1008, 'Invalid message')
      if (!role) {
        if (!['controller', 'receiver'].includes(value.role) || (value.role === 'controller' && phone)) return socket.close(1008, 'Invalid role')
        role = value.role
        peers.add(socket)
        if (role === 'controller') { phone = socket; lastSeen = performance.now() }
        status()
        return
      }
      if (socket !== phone) {
        if (role === 'receiver' && value.type === 'pitchCenterHaptic' && Object.keys(value).length === 1 && phone) {
          send(phone, { type: 'pitchCenterHaptic' })
        }
        return
      }
      if (value.type === 'heartbeat') { lastSeen = performance.now(); return }
      if (!validSample(value)) return socket.close(1008, 'Invalid motion sample')
      lastSeen = performance.now()
      for (const peer of peers) if (peer !== phone) send(peer, value)
    })
  })
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startRelay().on('listening', () => console.log('Motion relay listening on ws://127.0.0.1:8784/motion-relay'))
}
