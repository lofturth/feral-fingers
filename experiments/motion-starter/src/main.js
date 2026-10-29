import './style.css'
import { graphY } from './graph-scale.js'

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
const history = { orientation: [], deviceMotion: [] }
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
      if (!phoneConnected && !phone) clearSamples()
    } else if (!phone && message.type === 'motion' && (message.source === 'orientation' || message.source === 'deviceMotion')) {
      latest[message.source] = message
      lastSample = performance.now()
      const points = history[message.source]
      points.push({ receivedAt: lastSample, sample: message })
      trim(points, lastSample)
    }
  }
  ws.onerror = () => ws.close()
  ws.onclose = () => {
    if (socket !== ws) return
    phoneConnected = false
    clearSamples()
    byId('connection').textContent = 'Relay disconnected · reconnecting…'
    retry = setTimeout(connect, 1500)
  }
}

setTimeout(connect, 0)

function trim(points, now) {
  while (points.length && (points[0].receivedAt < now - 5000 || points.length > 1500)) points.shift()
}

function clearSamples() {
  lastSample = 0
  latest.orientation = null
  latest.deviceMotion = null
  history.orientation.length = 0
  history.deviceMotion.length = 0
}

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
  const groups = [
    { title: 'Orientation', source: 'orientation', unit: '°', scale: 360, scales: [15, 45, 90, 180, 360], axes: ['alpha', 'beta', 'gamma'], labels: ['Alpha — Yaw-like', 'Beta — Pitch-like', 'Gamma — Roll-like'], descriptions: ['First orientation angle, around the reference frame’s vertical axis; not necessarily a compass heading.', 'Second angle in the browser’s ordered rotation convention, about the rotated X axis.', 'Third angle in that convention, about the further-rotated Y axis.'], intro: 'These are orientation angles, not turning speeds. The phone need not be upright; yaw, pitch, and roll are approximate names, not independent physical rotations.', images: ['01-orientation-alpha', '02-orientation-beta', '03-orientation-gamma'], read: (sample, axis) => sample[axis] },
    { title: 'Rotation rate', source: 'deviceMotion', unit: '°/s', scale: 120, scales: [30, 60, 120, 300, 600], axes: ['alpha', 'beta', 'gamma'], labels: ['Alpha — X-axis rate', 'Beta — Y-axis rate', 'Gamma — Z-axis rate'], descriptions: ['How quickly the phone turns around its X axis.', 'How quickly the phone turns around its Y axis.', 'How quickly the phone turns around its Z axis.'], intro: 'Turning speed around the phone’s own axes, in degrees per second; separate from the orientation angles above. This alpha→X, beta→Y, gamma→Z mapping was verified on the target iPhone in Safari; other browsers may differ.', images: ['04-rotation-rate-alpha', '05-rotation-rate-beta', '06-rotation-rate-gamma'], read: (sample, axis) => sample.rotationRate?.[axis] },
    { title: 'Acceleration excluding gravity', source: 'deviceMotion', unit: 'm/s²', scale: 5, scales: [1, 2, 5, 15, 30], axes: ['x', 'y', 'z'], labels: ['X — Without gravity', 'Y — Without gravity', 'Z — Without gravity'], descriptions: ['Acceleration along the phone’s X axis, with gravity removed.', 'Acceleration along the phone’s Y axis, with gravity removed.', 'Acceleration along the phone’s Z axis, with gravity removed.'], intro: 'Linear acceleration with the gravity contribution removed; near zero when the phone is still.', images: ['07-acceleration-x', '08-acceleration-y', '09-acceleration-z'], read: (sample, axis) => sample.acceleration?.[axis] },
    { title: 'Acceleration including gravity', source: 'deviceMotion', unit: 'm/s²', scale: 15, scales: [12, 15, 30, 60], axes: ['x', 'y', 'z'], labels: ['X — With gravity', 'Y — With gravity', 'Z — With gravity'], descriptions: ['X-axis reading including the effect of gravity.', 'Y-axis reading including the effect of gravity.', 'Z-axis reading including the effect of gravity.'], intro: 'Acceleration with gravity’s effect included; a stationary phone can show a nonzero reading.', images: ['10-acceleration-gravity-x', '11-acceleration-gravity-y', '12-acceleration-gravity-z'], read: (sample, axis) => sample.accelerationIncludingGravity?.[axis] },
  ]
  const charts = []
  for (const group of groups) {
    const section = document.createElement('section')
    const heading = document.createElement('h2')
    heading.textContent = group.title
    section.append(heading)
    const scaleLabel = document.createElement('label')
    scaleLabel.className = 'scale-control'
    scaleLabel.textContent = 'Vertical scale '
    const scaleSelect = document.createElement('select')
    for (const scale of group.scales) {
      const option = document.createElement('option')
      option.value = String(scale)
      option.textContent = `−${scale} to +${scale} ${group.unit}`
      scaleSelect.append(option)
    }
    scaleSelect.value = String(group.scale)
    scaleSelect.addEventListener('change', () => { group.scale = Number(scaleSelect.value) })
    scaleLabel.append(scaleSelect)
    section.append(scaleLabel)
    if (group.intro) {
      const explanation = document.createElement('p')
      explanation.className = 'illustration-note'
      explanation.textContent = group.intro
      section.append(explanation)
    }
    byId('graphs').append(section)
    for (const [index, axis] of group.axes.entries()) {
      const label = group.labels?.[index] ?? axis
      const row = document.createElement('div')
      row.className = 'sensor missing'
      const illustration = document.createElement('img')
      illustration.src = `/illustrations/${group.images[index]}.png`
      illustration.alt = `Illustration for ${group.title} ${label}`
      illustration.width = 96
      illustration.height = 96
      illustration.loading = 'lazy'
      const name = document.createElement('span')
      name.textContent = label
      const description = document.createElement('small')
      description.textContent = group.descriptions[index]
      const value = document.createElement('strong')
      value.textContent = 'Unavailable'
      const canvas = document.createElement('canvas')
      canvas.setAttribute('aria-label', `${group.title} ${label}, latest 5 seconds`)
      row.append(illustration, name, value, description, canvas)
      section.append(row)
      charts.push({ row, value, canvas, ctx: canvas.getContext('2d'), missing: true, group, source: group.source, unit: group.unit, read: sample => group.read(sample, axis) })
    }
  }

  const draw = (chart, now) => {
    const { canvas, ctx, source, read, group } = chart
    const width = Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio))
    const height = Math.max(1, Math.round(canvas.clientHeight * devicePixelRatio))
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
    ctx.clearRect(0, 0, width, height)
    const points = history[source]
    ctx.strokeStyle = '#535775'
    ctx.lineWidth = Math.max(1, devicePixelRatio)
    ctx.beginPath()
    ctx.moveTo(0, height / 2)
    ctx.lineTo(width, height / 2)
    ctx.stroke()
    ctx.strokeStyle = '#55dfc2'
    ctx.lineWidth = Math.max(1, devicePixelRatio * 1.5)
    ctx.beginPath()
    let drawing = false
    for (const point of points) {
      if (point.receivedAt < now - 5000) continue
      const value = read(point.sample)
      if (typeof value !== 'number' || !Number.isFinite(value)) { drawing = false; continue }
      const x = (point.receivedAt - (now - 5000)) / 5000 * width
      const y = graphY(value, group.scale, height)
      if (drawing) ctx.lineTo(x, y)
      else ctx.moveTo(x, y)
      drawing = true
    }
    ctx.stroke()
  }

  // Draw and update values at the display refresh rate; socket receipt remains independent.
  const render = () => {
    const now = performance.now()
    for (const chart of charts) draw(chart, now)
    for (const chart of charts) {
      const current = chart.read(latest[chart.source] ?? {})
      const next = `${display(current)}${current == null ? '' : ` ${chart.unit}`}`
      if (chart.value.textContent !== next) chart.value.textContent = next
      if (chart.missing !== (current == null)) {
        chart.missing = current == null
        chart.row.classList.toggle('missing', chart.missing)
      }
    }
    requestAnimationFrame(render)
  }
  requestAnimationFrame(render)

  setInterval(() => {
    const now = performance.now()
    for (const source of ['orientation', 'deviceMotion']) trim(history[source], now)
    const rate = source => history[source].filter(point => point.receivedAt >= now - 1000).length
    byId('rate').textContent = `Received samples/s (last 1 s): orientation ${rate('orientation')} · device motion ${rate('deviceMotion')}`
    const interval = source => {
      const points = history[source]
      const deltas = []
      for (let i = 1; i < points.length; i++) {
        const delta = points[i].sample.t - points[i - 1].sample.t
        if (delta > 0 && Number.isFinite(delta)) deltas.push(delta)
      }
      if (!deltas.length) return 'waiting'
      return `${(deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(1)} ms mean · ${Math.min(...deltas).toFixed(1)}–${Math.max(...deltas).toFixed(1)} ms range`
    }
    byId('interval').textContent = `Phone event intervals (last 5 s): orientation ${interval('orientation')} · device motion ${interval('deviceMotion')}`
  }, 500)
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
  }
}, 500)

window.addEventListener('pagehide', () => {
  clearTimeout(retry)
  if (socket) { socket.onclose = null; socket.close() }
})
