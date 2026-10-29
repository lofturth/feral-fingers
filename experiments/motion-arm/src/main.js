import './style.css'
import { ElevationTracker } from './measure.js'
import { visibleSegments } from './history.js'

const byId = id => document.getElementById(id)
const tracker = new ElevationTracker()
const history = []
let socket = null
let lastOrientationAt = 0

function display(result) {
  for (const key of ['angle', 'velocity', 'acceleration']) {
    byId(key).textContent = result[key] === null ? '—' : result[key].toFixed(1)
  }
}

function gap(reason, reset = true) {
  if (history.length && history.at(-1).angle !== null) history.push({ t: performance.now(), angle: null, velocity: null, acceleration: null })
  if (reset) tracker.reset()
  lastOrientationAt = 0
  display({ angle: null, velocity: null, acceleration: null })
  byId('sensor').textContent = reason
}

function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/motion-relay`)
  socket = ws
  ws.onopen = () => ws.send(JSON.stringify({ role: 'receiver' }))
  ws.onmessage = event => {
    let message
    try { message = JSON.parse(event.data) } catch { ws.close(); return }
    if (message.type === 'status') {
      byId('connection').textContent = message.controllerConnected ? 'Relay connected · phone connected' : 'Relay connected · waiting for phone'
      if (!message.controllerConnected) gap('Waiting for orientation')
    } else if (message.type === 'motion' && message.source === 'orientation') {
      const result = tracker.add(message)
      if (result.status === 'invalid') { gap('Invalid orientation'); return }
      if (result.status === 'duplicate') { byId('sensor').textContent = 'Duplicate or out-of-order timestamp ignored'; return }
      if (result.status === 'baseline' && history.length && history.at(-1).angle !== null) gap('Timestamp gap · restarting derivatives', false)
      const now = performance.now()
      lastOrientationAt = now
      history.push({ t: now, angle: result.angle, velocity: result.velocity, acceleration: result.acceleration })
      display(result)
      byId('sensor').textContent = result.status === 'baseline' ? 'Receiving · waiting for next sample to differentiate' : 'Receiving'
    }
  }
  ws.onerror = () => ws.close()
  ws.onclose = () => {
    if (socket !== ws) return
    gap('Relay disconnected')
    byId('connection').textContent = 'Relay disconnected · reconnecting…'
    setTimeout(connect, 1500)
  }
}

setInterval(() => {
  if (lastOrientationAt && performance.now() - lastOrientationAt > 3000) gap('Orientation data stale')
}, 500)

const charts = [
  { key: 'angle', scale: () => 90, unit: '°' },
  { key: 'velocity', scale: () => Number(byId('velocity-scale').value), unit: '°/s' },
  { key: 'acceleration', scale: () => Number(byId('acceleration-scale').value), unit: '°/s²' },
].map(item => ({ ...item, canvas: byId(`${item.key}-graph`), ctx: byId(`${item.key}-graph`).getContext('2d') }))

function render(now) {
  for (const { key, scale, unit, canvas, ctx } of charts) {
    const ratio = devicePixelRatio || 1
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio))
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio))
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
    const left = 65 * ratio, right = width - 8 * ratio, top = 12 * ratio, bottom = height - 12 * ratio
    const limit = scale()
    const x = t => left + (t - (now - 5000)) / 5000 * (right - left)
    const y = value => (top + bottom) / 2 - value / limit * (bottom - top) / 2
    ctx.clearRect(0, 0, width, height)
    ctx.font = `${11 * ratio}px system-ui`
    ctx.textAlign = 'right'
    for (const value of [-limit, 0, limit]) {
      ctx.strokeStyle = value === 0 ? '#8995a3' : '#43505d'
      ctx.lineWidth = ratio
      ctx.beginPath(); ctx.moveTo(left, y(value)); ctx.lineTo(right, y(value)); ctx.stroke()
      ctx.fillStyle = '#c6d0d8'
      ctx.fillText(`${value} ${unit}`, left - 5 * ratio, y(value) + 4 * ratio)
    }
    ctx.save()
    ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip()
    ctx.strokeStyle = '#60e4c4'; ctx.lineWidth = 2.2 * ratio
    for (const segment of visibleSegments(history, key, now - 5000, now)) {
      ctx.beginPath()
      segment.forEach((point, index) => index ? ctx.lineTo(x(point.t), y(point.value)) : ctx.moveTo(x(point.t), y(point.value)))
      ctx.stroke()
    }
    ctx.restore()
  }
  while (history.length > 1 && history[1].t < now - 5000) history.shift()
  requestAnimationFrame(render)
}

requestAnimationFrame(render)
connect()
