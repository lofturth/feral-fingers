import './style.css'

const phone = new URLSearchParams(location.search).has('phone')
const byId = id => document.getElementById(id)
byId(phone ? 'phone' : 'mac').hidden = false
if (!phone) byId('phone-url').textContent = `${location.origin}/?phone=1`

let socket = null
let retry = null
let lastRelay = 0
let lastSample = 0
let phoneConnected = false
let samples = 0
const latest = { orientation: null, deviceMotion: null }
const nullable = value => typeof value === 'number' && Number.isFinite(value) ? value : null
const triple = value => ({ x: nullable(value?.x), y: nullable(value?.y), z: nullable(value?.z) })
const rotation = value => ({ alpha: nullable(value?.alpha), beta: nullable(value?.beta), gamma: nullable(value?.gamma) })
const display = value => value === null || value === undefined ? 'Unavailable' : typeof value === 'number' ? value.toFixed(2) : String(value)

function send(value) {
  if (socket?.readyState !== WebSocket.OPEN) return
  if (socket.bufferedAmount > 65536) { socket.close(); return }
  socket.send(JSON.stringify(value))
}

function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/motion-relay`)
  socket = ws
  lastRelay = performance.now()
  ws.onopen = () => { lastRelay = performance.now(); send({ role: phone ? 'controller' : 'receiver' }) }
  ws.onmessage = event => {
    lastRelay = performance.now()
    let message
    try { message = JSON.parse(event.data) } catch { ws.close(); return }
    if (message.type === 'status') {
      phoneConnected = Boolean(message.controllerConnected)
      byId('connection').textContent = phone
        ? (phoneConnected ? 'Relay connected · sending motion' : 'Relay connected · waiting for controller slot')
        : (phoneConnected ? 'Relay connected · phone connected' : 'Relay connected · waiting for phone')
      if (!phoneConnected && !phone) { latest.orientation = null; latest.deviceMotion = null; lastSample = 0 }
    } else if (!phone && message.type === 'motion' && (message.source === 'orientation' || message.source === 'deviceMotion')) {
      latest[message.source] = message
      lastSample = performance.now()
    }
  }
  ws.onerror = () => ws.close()
  ws.onclose = () => {
    if (socket !== ws) return
    phoneConnected = false
    lastSample = 0
    latest.orientation = null
    latest.deviceMotion = null
    byId('connection').textContent = 'Relay disconnected · reconnecting…'
    retry = setTimeout(connect, 1500)
  }
}

setTimeout(connect, 0)

if (phone) {
  window.addEventListener('deviceorientation', event => {
    if (document.hidden) return
    const sample = { type: 'motion', source: 'orientation', t: event.timeStamp,
      alpha: nullable(event.alpha), beta: nullable(event.beta), gamma: nullable(event.gamma),
      absolute: typeof event.absolute === 'boolean' ? event.absolute : null }
    send(sample)
    samples++
  })
  window.addEventListener('devicemotion', event => {
    if (document.hidden) return
    const sample = { type: 'motion', source: 'deviceMotion', t: event.timeStamp,
      rotationRate: rotation(event.rotationRate), acceleration: triple(event.acceleration),
      accelerationIncludingGravity: triple(event.accelerationIncludingGravity), interval: nullable(event.interval) }
    send(sample)
    samples++
  })
  byId('enable').addEventListener('click', async () => {
    if (!window.isSecureContext) { byId('permission').textContent = 'Trusted HTTPS is required'; return }
    const requests = []
    try {
      // Call both within this click, before awaiting either permission dialog.
      if (typeof DeviceOrientationEvent !== 'undefined') requests.push(['orientation', DeviceOrientationEvent.requestPermission?.() ?? Promise.resolve('available')])
      if (typeof DeviceMotionEvent !== 'undefined') requests.push(['motion', DeviceMotionEvent.requestPermission?.() ?? Promise.resolve('available')])
      if (!requests.length) { byId('permission').textContent = 'Motion APIs unavailable'; return }
      const results = await Promise.all(requests.map(async ([name, request]) => {
        try { return `${name}: ${await request}` } catch (error) { return `${name}: ${error}` }
      }))
      byId('permission').textContent = results.join(' · ')
    } catch (error) { byId('permission').textContent = `Permission error: ${error}` }
  })
} else {
  const labels = [
    ['Orientation α', () => latest.orientation?.alpha, '°'], ['Orientation β', () => latest.orientation?.beta, '°'],
    ['Orientation γ', () => latest.orientation?.gamma, '°'],
    ...['alpha', 'beta', 'gamma'].map(axis => [`Rotation ${axis}`, () => latest.deviceMotion?.rotationRate?.[axis], '°/s']),
    ...['x', 'y', 'z'].map(axis => [`Acceleration ${axis}`, () => latest.deviceMotion?.acceleration?.[axis], 'm/s²']),
    ...['x', 'y', 'z'].map(axis => [`Acceleration + gravity ${axis}`, () => latest.deviceMotion?.accelerationIncludingGravity?.[axis], 'm/s²']),
  ]
  for (const [label, get, unit] of labels) {
    const row = document.createElement('tr')
    const name = document.createElement('th')
    const value = document.createElement('td')
    name.textContent = label
    name.scope = 'row'
    row.append(name, value)
    byId('values').append(row)
    row.update = () => { const current = get(); value.textContent = `${display(current)}${current == null ? '' : ` ${unit}`}` }
  }
}

setInterval(() => {
  const now = performance.now()
  if (socket?.readyState === WebSocket.OPEN && now - lastRelay > 2500) {
    byId('connection').textContent = 'Relay timed out · reconnecting…'
    socket.close()
  }
  if (phone) {
    send({ type: 'heartbeat' })
    byId('sending').textContent = samples ? `${samples} sensor samples observed on this page` : 'Waiting for sensor samples…'
  } else {
    const age = lastSample ? (now - lastSample) / 1000 : null
    byId('sample-status').textContent = !phoneConnected ? 'No phone connected' : age === null ? 'Phone connected · waiting for samples' : age > 2 ? `Samples stopped · last received ${age.toFixed(1)} s ago` : `Receiving samples · last received ${age.toFixed(1)} s ago`
    for (const row of byId('values').rows) row.update()
  }
}, 500)

window.addEventListener('pagehide', () => {
  clearTimeout(retry)
  if (socket) { socket.onclose = null; socket.close() }
})
