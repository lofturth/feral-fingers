import './style.css'
import { mapOrientation } from './mapping.js'
import { Cc1Response } from './cc1-response.js'
import { traceSegments } from './cc1-history.js'
import { alignmentSegments } from './alignment-history.js'
import { createArmPanel } from './arm-panel.js'
import { PitchBendController, PITCH_RANGES, SOURCE_UNITS } from './pitch-bend.js'
import { loadSettings, saveSettings, applySettings, availableOutputId } from './settings.js'

const element = id => document.getElementById(id)
const outputSelect = element('output')
let settingsStorage = null
try { settingsStorage = window.localStorage } catch { /* Private browser modes may deny storage. */ }
const savedSettings = loadSettings(settingsStorage)
let preferredOutputId = savedSettings.outputId
const armPanel = createArmPanel(element)
let access = null
let selectedOutput = null
let lastSensorAt = 0
let lastArmAt = 0
let socket = null
let phoneConnected = false
const history = []
const graph = element('cc1-graph')
const ctx = graph.getContext('2d')
const cc1Response = new Cc1Response({
  onSend: recordSend,
  onError: error => {
    markGap('MIDI send failed')
    element('midi-status').textContent = `MIDI send failed: ${error.message}`
  },
})
const alignmentHistory = []
const alignmentGraph = element('alignment-graph')
const alignmentCtx = alignmentGraph.getContext('2d')
const pitchHistory = []
const pitchGraph = element('pitch-graph')
const pitchCtx = pitchGraph.getContext('2d')
let hapticGenerated = 0
let hapticHandedOff = 0
const pitch = new PitchBendController({
  onSend: (_value, cents) => {
    pitchHistory.push({ t: performance.now(), value: cents })
    element('pitch-cents').textContent = cents.toFixed(1)
    element('pitch-status').textContent = 'Sending'
  },
  onGap: reason => {
    if (pitchHistory.length && pitchHistory.at(-1).value !== null) pitchHistory.push({ t: performance.now(), value: null })
    element('pitch-status').textContent = reason
  },
  onCrossing: () => {
    element('haptic-generated').textContent = String(++hapticGenerated)
    if (socket?.readyState === WebSocket.OPEN && phoneConnected) {
      try {
        socket.send(JSON.stringify({ type: 'pitchCenterHaptic' }))
        element('haptic-handed-off').textContent = String(++hapticHandedOff)
      } catch { /* relay disconnection is handled by the socket */ }
    }
  },
})

function persistSettings() {
  saveSettings(settingsStorage, {
    version: 1,
    outputId: preferredOutputId,
    exponent: cc1Response.exponent,
    source: pitch.source,
    sensitivity: pitch.sensitivity,
    velocityScale: Number(element('arm-velocity-scale').value),
    accelerationScale: Number(element('arm-acceleration-scale').value),
    hapticEnabled: pitch.hapticEnabled,
  })
}

// Apply configuration while controllers have no output and Pitch Bend is disabled.
applySettings(savedSettings, cc1Response, pitch)
element('pitch-source').value = pitch.source
element('pitch-haptic').checked = pitch.hapticEnabled
element('arm-velocity-scale').value = String(savedSettings.velocityScale)
element('arm-acceleration-scale').value = String(savedSettings.accelerationScale)
element('response-curve').value = String(cc1Response.exponent)
element('curve-exponent').textContent = cc1Response.exponent.toFixed(2)
for (const id of ['arm-velocity-scale', 'arm-acceleration-scale']) {
  element(id).addEventListener('change', persistSettings)
}

function updatePitchUI() {
  const range = PITCH_RANGES[pitch.source]
  const slider = element('pitch-sensitivity')
  slider.min = range.min
  slider.max = range.max
  slider.step = range.step
  slider.value = pitch.sensitivity[pitch.source]
  element('pitch-sensitivity-value').textContent = `${pitch.sensitivity[pitch.source].toFixed(3)} ${range.unit}`
  element('pitch-neutral-value').textContent = `${pitch.neutralAngle.toFixed(1)}°`
  element('pitch-neutral').disabled = pitch.source !== 'angle' || pitch.latest?.angle === null || pitch.latest?.angle === undefined
  element('pitch-measurement').textContent = pitch.selectedValue === null ? '—' : `${pitch.selectedValue.toFixed(1)} ${SOURCE_UNITS[pitch.source]}`
}

element('pitch-enabled').addEventListener('change', event => { pitch.setEnabled(event.target.checked); updatePitchUI() })
element('pitch-haptic').addEventListener('change', event => { pitch.setHapticEnabled(event.target.checked); persistSettings() })
element('pitch-source').addEventListener('change', event => { pitch.setSource(event.target.value); updatePitchUI(); persistSettings() })
element('pitch-sensitivity').addEventListener('input', event => { pitch.setSensitivity(Number(event.target.value)); updatePitchUI(); persistSettings() })
element('pitch-neutral').addEventListener('click', () => { pitch.setNeutralAngle(pitch.latest?.angle); updatePitchUI() })
updatePitchUI()

function drawCurvePreview() {
  const canvas = element('curve-preview')
  const preview = canvas.getContext('2d')
  const ratio = devicePixelRatio || 1
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio))
  const height = Math.max(1, Math.round(canvas.clientHeight * ratio))
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
  const left = 27 * ratio, right = width - 9 * ratio, top = 9 * ratio, bottom = height - 18 * ratio
  preview.clearRect(0, 0, width, height)
  preview.strokeStyle = '#647080'
  preview.lineWidth = ratio
  preview.beginPath(); preview.moveTo(left, top); preview.lineTo(left, bottom); preview.lineTo(right, bottom); preview.stroke()
  preview.fillStyle = '#c6d0d8'
  preview.font = `${10 * ratio}px system-ui`
  preview.textAlign = 'right'
  preview.fillText('1', left - 5 * ratio, top + 4 * ratio)
  preview.fillText('0', left - 5 * ratio, bottom + 4 * ratio)
  preview.strokeStyle = '#9db5ff'
  preview.lineWidth = 2 * ratio
  preview.beginPath()
  for (let step = 0; step <= 100; step++) {
    const input = step / 100
    const x = left + input * (right - left)
    const y = bottom - input ** cc1Response.exponent * (bottom - top)
    if (step) preview.lineTo(x, y)
    else preview.moveTo(x, y)
  }
  preview.stroke()
}

function setCurveExponent(value) {
  cc1Response.setExponent(value)
  element('response-curve').value = cc1Response.exponent
  element('curve-exponent').textContent = cc1Response.exponent.toFixed(2)
  if (cc1Response.cc1 !== null) {
    element('cc1').textContent = String(cc1Response.cc1)
    element('meter').value = cc1Response.cc1
  }
  drawCurvePreview()
  persistSettings()
}

element('response-curve').addEventListener('input', event => setCurveExponent(Number(event.target.value)))
for (const button of document.querySelectorAll('[data-exponent]')) {
  button.addEventListener('click', () => setCurveExponent(Number(button.dataset.exponent)))
}
window.addEventListener('resize', drawCurvePreview)
drawCurvePreview()

function markGap(reason) {
  if (history.at(-1)?.value !== null && history.length) history.push({ t: performance.now(), value: null })
  element('graph-status').textContent = reason
}

function recordSend(value) {
  history.push({ t: performance.now(), value })
  element('last-sent').textContent = String(value)
  element('graph-status').textContent = 'Sending'
}

function clearSensor(message) {
  markGap(message)
  if (alignmentHistory.length && alignmentHistory.at(-1).value !== null) alignmentHistory.push({ t: performance.now(), value: null })
  lastSensorAt = 0
  element('sensor').textContent = message
  element('alignment').textContent = '—'
  element('cc1').textContent = '—'
  element('meter').value = 1
  cc1Response.clear()
}

function refreshOutputs() {
  const prior = outputSelect.value
  const outputs = access ? [...access.outputs.values()].filter(output => output.state === 'connected') : []
  outputSelect.replaceChildren(new Option('No output selected', ''))
  for (const output of outputs) outputSelect.add(new Option(output.name || output.id, output.id))
  outputSelect.disabled = !access || outputs.length === 0
  outputSelect.value = availableOutputId(outputs, prior, preferredOutputId)
  selectedOutput = access?.outputs.get(outputSelect.value) ?? null
  cc1Response.setOutput(selectedOutput)
  pitch.setOutput(selectedOutput)
  if (prior !== outputSelect.value || !selectedOutput) markGap('MIDI output unavailable')
  element('midi-status').textContent = selectedOutput ? `Ready: ${selectedOutput.name}` : outputs.length ? 'Select a MIDI output' : 'No connected MIDI outputs'
}

element('enable').addEventListener('click', async () => {
  if (!navigator.requestMIDIAccess) { element('midi-status').textContent = 'Web MIDI is unavailable in this browser'; return }
  try {
    access = await navigator.requestMIDIAccess()
    access.onstatechange = refreshOutputs
    refreshOutputs()
    element('enable').disabled = true
  } catch (error) { element('midi-status').textContent = `MIDI access failed: ${error.message}` }
})

outputSelect.addEventListener('change', () => {
  preferredOutputId = outputSelect.value
  persistSettings()
  markGap('MIDI output changed')
  selectedOutput = access?.outputs.get(outputSelect.value) ?? null
  cc1Response.setOutput(selectedOutput)
  pitch.setOutput(selectedOutput)
  element('midi-status').textContent = selectedOutput ? `Ready: ${selectedOutput.name}` : 'Select a MIDI output'
})

function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/motion-relay`)
  socket = ws
  ws.onopen = () => ws.send(JSON.stringify({ role: 'receiver' }))
  ws.onmessage = event => {
    let message
    try { message = JSON.parse(event.data) } catch { ws.close(); return }
    if (message.type === 'status') {
      phoneConnected = Boolean(message.controllerConnected)
      element('connection').textContent = phoneConnected ? 'Relay connected · phone connected' : 'Relay connected · waiting for phone'
      if (!phoneConnected) { clearSensor('Waiting for phone'); armPanel.gap('Waiting for orientation'); lastArmAt = 0; pitch.unavailable('Waiting for orientation'); updatePitchUI() }
    } else if (message.type === 'motion' && message.source === 'orientation') {
      const armResult = armPanel.receive(message)
      if (armResult?.status === 'ok' || armResult?.status === 'baseline') lastArmAt = performance.now()
      else if (armResult?.status === 'invalid') lastArmAt = 0
      pitch.update(armResult)
      updatePitchUI()
      const mapped = mapOrientation(message)
      if (!mapped) { clearSensor('Orientation reading unavailable'); return }
      lastSensorAt = performance.now()
      alignmentHistory.push({ t: lastSensorAt, value: mapped.alignment })
      element('sensor').textContent = 'Receiving'
      element('alignment').textContent = mapped.alignment.toFixed(3)
      cc1Response.setAlignment(mapped.alignment)
      element('cc1').textContent = String(cc1Response.cc1)
      element('meter').value = cc1Response.cc1
    }
  }
  ws.onerror = () => ws.close()
  ws.onclose = () => {
    if (socket !== ws) return
    phoneConnected = false
    clearSensor('No sensor data')
    armPanel.gap('Relay disconnected')
    lastArmAt = 0
    pitch.unavailable('Relay disconnected')
    updatePitchUI()
    element('connection').textContent = 'Relay disconnected · reconnecting…'
    setTimeout(connect, 1500)
  }
}

setInterval(() => {
  const now = performance.now()
  if (lastSensorAt && now - lastSensorAt > 3000) { clearSensor('Orientation data stale'); armPanel.gap('Orientation data stale'); lastArmAt = 0; pitch.unavailable('Orientation data stale'); updatePitchUI() }
  if (lastArmAt && now - lastArmAt > 3000) { armPanel.gap('Orientation timestamps stale'); lastArmAt = 0; pitch.unavailable('Orientation timestamps stale'); updatePitchUI() }
}, 500)

function renderGraph(now) {
  const width = Math.max(1, Math.round(graph.clientWidth * devicePixelRatio))
  const height = Math.max(1, Math.round(graph.clientHeight * devicePixelRatio))
  if (graph.width !== width || graph.height !== height) { graph.width = width; graph.height = height }
  const left = 30 * devicePixelRatio
  const right = width - 8 * devicePixelRatio
  const top = 10 * devicePixelRatio
  const bottom = height - 12 * devicePixelRatio
  const x = t => left + (t - (now - 5000)) / 5000 * (right - left)
  const y = value => bottom - (value - 1) / 126 * (bottom - top)
  ctx.clearRect(0, 0, width, height)
  ctx.font = `${11 * devicePixelRatio}px system-ui`
  ctx.textAlign = 'right'
  ctx.fillStyle = '#b8c0ca'
  ctx.strokeStyle = '#59616d'
  ctx.lineWidth = devicePixelRatio
  for (const value of [1, 64, 127]) {
    const lineY = y(value)
    ctx.beginPath(); ctx.moveTo(left, lineY); ctx.lineTo(right, lineY); ctx.stroke()
    ctx.fillText(String(value), left - 5 * devicePixelRatio, lineY + 4 * devicePixelRatio)
  }
  ctx.strokeStyle = '#65f0cf'
  ctx.lineWidth = 2.5 * devicePixelRatio
  for (const segment of traceSegments(history, now - 5000, now)) {
    ctx.beginPath()
    segment.forEach((point, index) => index ? ctx.lineTo(x(point.t), y(point.value)) : ctx.moveTo(x(point.t), y(point.value)))
    ctx.stroke()
  }
  while (history.length > 1 && history[1].t < now - 5000) history.shift()
  renderPitchGraph(now)
  renderAlignmentGraph(now)
  requestAnimationFrame(renderGraph)
}

requestAnimationFrame(renderGraph)

function renderPitchGraph(now) {
  const ratio = devicePixelRatio || 1
  const width = Math.max(1, Math.round(pitchGraph.clientWidth * ratio))
  const height = Math.max(1, Math.round(pitchGraph.clientHeight * ratio))
  if (pitchGraph.width !== width || pitchGraph.height !== height) { pitchGraph.width = width; pitchGraph.height = height }
  const left = 48 * ratio, right = width - 8 * ratio, top = 12 * ratio, bottom = height - 12 * ratio
  const x = t => left + (t - (now - 5000)) / 5000 * (right - left)
  const y = cents => (top + bottom) / 2 - cents / 200 * (bottom - top) / 2
  pitchCtx.clearRect(0, 0, width, height)
  pitchCtx.font = `${11 * ratio}px system-ui`
  pitchCtx.textAlign = 'right'
  for (const cents of [-200, 0, 200]) {
    pitchCtx.strokeStyle = cents === 0 ? '#a5b2c0' : '#535e6a'
    pitchCtx.lineWidth = ratio
    pitchCtx.beginPath(); pitchCtx.moveTo(left, y(cents)); pitchCtx.lineTo(right, y(cents)); pitchCtx.stroke()
    pitchCtx.fillStyle = '#c6d0d8'
    pitchCtx.fillText(String(cents), left - 5 * ratio, y(cents) + 4 * ratio)
  }
  pitchCtx.strokeStyle = '#f4b66c'
  pitchCtx.lineWidth = 2.5 * ratio
  for (const segment of traceSegments(pitchHistory, now - 5000, now)) {
    pitchCtx.beginPath()
    segment.forEach((point, index) => index ? pitchCtx.lineTo(x(point.t), y(point.value)) : pitchCtx.moveTo(x(point.t), y(point.value)))
    pitchCtx.stroke()
  }
  while (pitchHistory.length > 1 && pitchHistory[1].t < now - 5000) pitchHistory.shift()
}

function renderAlignmentGraph(now) {
  const ratio = devicePixelRatio || 1
  const width = Math.max(1, Math.round(alignmentGraph.clientWidth * ratio))
  const height = Math.max(1, Math.round(alignmentGraph.clientHeight * ratio))
  if (alignmentGraph.width !== width || alignmentGraph.height !== height) { alignmentGraph.width = width; alignmentGraph.height = height }
  const left = 30 * ratio, right = width - 8 * ratio, top = 12 * ratio, bottom = height - 12 * ratio
  const x = t => left + (t - (now - 5000)) / 5000 * (right - left)
  const y = value => bottom - value * (bottom - top)
  alignmentCtx.clearRect(0, 0, width, height)
  alignmentCtx.font = `${11 * ratio}px system-ui`
  alignmentCtx.textAlign = 'right'
  for (const value of [0, 0.5, 1]) {
    alignmentCtx.strokeStyle = '#535e6a'
    alignmentCtx.lineWidth = ratio
    alignmentCtx.beginPath(); alignmentCtx.moveTo(left, y(value)); alignmentCtx.lineTo(right, y(value)); alignmentCtx.stroke()
    alignmentCtx.fillStyle = '#c6d0d8'
    alignmentCtx.fillText(String(value), left - 5 * ratio, y(value) + 4 * ratio)
  }
  alignmentCtx.strokeStyle = '#9db5ff'
  alignmentCtx.lineWidth = 2.5 * ratio
  for (const segment of alignmentSegments(alignmentHistory, now - 5000, now)) {
    alignmentCtx.beginPath()
    segment.forEach((point, index) => index ? alignmentCtx.lineTo(x(point.t), y(point.value)) : alignmentCtx.moveTo(x(point.t), y(point.value)))
    alignmentCtx.stroke()
  }
  while (alignmentHistory.length > 1 && alignmentHistory[1].t < now - 5000) alignmentHistory.shift()
}

connect()
