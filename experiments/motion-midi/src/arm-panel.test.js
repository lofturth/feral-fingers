import test from 'node:test'
import assert from 'node:assert/strict'
import { createArmPanel } from './arm-panel.js'

test('unified arm panel updates three readouts and three independent traces, then resets at a gap', () => {
  const oldFrame = globalThis.requestAnimationFrame
  const oldRatio = globalThis.devicePixelRatio
  const frames = []
  globalThis.requestAnimationFrame = callback => frames.push(callback)
  globalThis.devicePixelRatio = 1
  try {
    const elements = new Map()
    const traces = new Map()
    function byId(id) {
      if (!elements.has(id)) {
        if (id.endsWith('-graph')) {
          const lines = []
          traces.set(id, lines)
          const ctx = {
            clearRect() {}, beginPath() {}, moveTo() {}, stroke() {}, fillText() {},
            save() {}, rect() {}, clip() {}, restore() {},
            lineTo(...args) { if (this.strokeStyle === '#60e4c4') lines.push(args) },
          }
          elements.set(id, { clientWidth: 400, clientHeight: 170, getContext: () => ctx })
        } else elements.set(id, { value: id.includes('acceleration-scale') ? '1000' : '180', textContent: '' })
      }
      return elements.get(id)
    }
    const panel = createArmPanel(byId)
    panel.receive({ t: 1000, alpha: 0, beta: 0, gamma: 0 })
    panel.receive({ t: 1020, alpha: 0, beta: 10, gamma: 80 })
    assert.equal(byId('arm-angle').textContent, '10.0')
    assert.ok(Number(byId('arm-velocity').textContent) > 0)
    assert.ok(Number(byId('arm-acceleration').textContent) > 0)
    frames.shift()(performance.now())
    for (const key of ['angle', 'velocity', 'acceleration']) {
      assert.ok(traces.get(`arm-${key}-graph`).length > 0, `${key} trace`)
    }
    panel.gap('Relay disconnected')
    for (const key of ['angle', 'velocity', 'acceleration']) assert.equal(byId(`arm-${key}`).textContent, '—')
    panel.receive({ t: 10, alpha: 0, beta: 5, gamma: 0 })
    assert.equal(byId('arm-velocity').textContent, '—', 'reconnection starts a fresh baseline')
  } finally {
    globalThis.requestAnimationFrame = oldFrame
    globalThis.devicePixelRatio = oldRatio
  }
})
