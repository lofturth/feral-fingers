const colors = ['#ff727f', '#65d5ab', '#75a8ff'];
const samples = [];
const statusEl = document.getElementById('status');
const rateEl = document.getElementById('rate');
const framesEl = document.getElementById('frames');
const deliveryEl = document.getElementById('delivery');
const midiOutputEl = document.getElementById('midi-output');
const midiModeSelect = document.getElementById('midi-mode');
const latestEl = document.getElementById('latest');
const pauseButton = document.getElementById('pause');
const windowSelect = document.getElementById('window');
const charts = [makeChart('accel'), makeChart('gyro'), makeChart('gate')];
let first = 0;
let paused = false;
let connected = false;
let needsPausedDraw = false;
let frozenEnd = 0;
let frozenSamples = [];
let clockOffsetUs = null;
let latestSample = null;
let lastFrameMs = 0;
let frameCount = 0;
let frameWindowMs = performance.now();
let worstFrameMs = 0;
let worstDrawMs = 0;
let worstArrivalMs = 0;
let lastArrivalMs = 0;
let sequenceGaps = 0;
let midiMode = 'mod-wheel';
let midiValue = null;
let midiAvailable = true;
let dualMode = false;

function makeChart(id) {
  const canvas = document.getElementById(id);
  return {canvas, ctx: canvas.getContext('2d'), grid: document.createElement('canvas'),
          width: 0, height: 0, dpr: 0, gridKey: ''};
}

pauseButton.addEventListener('click', () => {
  paused = !paused;
  if (paused) {
    frozenEnd = displayEnd(performance.now());
    frozenSamples = samples.slice(first);
    needsPausedDraw = true;
  } else {
    frozenSamples = [];
  }
  pauseButton.textContent = paused ? 'Resume' : 'Pause';
});
windowSelect.addEventListener('change', () => { needsPausedDraw = true; });
midiModeSelect.addEventListener('change', async () => {
  try {
    const response = await fetch('/midi-mode', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({mode: midiModeSelect.value})});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    midiModeSelect.value = midiMode;
    midiOutputEl.textContent = `MIDI mode update failed: ${error.message}`;
  }
});

function showMidi() {
  const gravityZ = latestSample?.gravity?.[2];
  const source = Number.isFinite(gravityZ) ? `Raw Z ${latestSample.v[2].toFixed(3)} g · gravity Z ${gravityZ.toFixed(3)} g` : 'Estimated Z — g';
  const output = midiMode === 'mod-wheel' ? `Mod wheel CC1 ${midiValue ?? '—'}` : `Pitch bend ${midiValue ?? '—'}`;
  midiOutputEl.textContent = `${source} → ${output}${midiAvailable ? '' : ' (MIDI unavailable)'}`;
}
const events = new EventSource('/events');
events.addEventListener('status', event => {
  const state = JSON.parse(event.data);
  connected = state.connected;
  dualMode = !!state.dual;
  statusEl.textContent = connected ? '● Connected' : '○ Waiting for device';
  statusEl.classList.toggle('live', connected);
  if (!connected) rateEl.textContent = '— samples/s';
});
events.addEventListener('midi', event => {
  const state = JSON.parse(event.data);
  midiMode = state.mode;
  midiValue = state.value;
  midiAvailable = state.available;
  midiModeSelect.value = midiMode;
  showMidi();
});
events.addEventListener('sample', event => {
  const sample = JSON.parse(event.data);
  if (!Number.isFinite(sample.us) || !Array.isArray(sample.v) || sample.v.length !== 6) return;
  if (latestSample && sample.us <= latestSample.us) {
    if (sample.us === latestSample.us) return;
    samples.length = 0; first = 0; clockOffsetUs = null; // ESP32 reset.
    lastArrivalMs = 0;
    sequenceGaps = 0;
  }
  const arrival = performance.now();
  if (clockOffsetUs === null) clockOffsetUs = sample.us - arrival * 1000;
  if (lastArrivalMs) worstArrivalMs = Math.max(worstArrivalMs, arrival - lastArrivalMs);
  if (latestSample && sample.seq > latestSample.seq + 1) sequenceGaps += sample.seq - latestSample.seq - 1;
  lastArrivalMs = arrival;
  latestSample = sample;
  if (sample.midiMode === midiMode) midiValue = sample.midiValue;
  showMidi();
  samples.push(sample);
  const cutoff = sample.us - 31_000_000;
  while (first < samples.length && samples[first].us < cutoff) first++;
  if (first > 1024) { samples.splice(0, first); first = 0; }
});
events.onerror = () => {
  connected = false;
  statusEl.textContent = '○ Server disconnected';
  statusEl.classList.remove('live');
  rateEl.textContent = '— samples/s';
};

function displayEnd(nowMs) {
  if (clockOffsetUs === null) return 0;
  // Only the animation clock moves the viewport. Sensor arrivals never move it.
  return nowMs * 1000 + clockOffsetUs;
}

function sizeChart(chart) {
  const w = chart.canvas.clientWidth, h = chart.canvas.clientHeight;
  const dpr = devicePixelRatio || 1;
  if (w === chart.width && h === chart.height && dpr === chart.dpr) return;
  chart.width = w; chart.height = h; chart.dpr = dpr;
  chart.canvas.width = chart.grid.width = Math.max(1, Math.round(w * dpr));
  chart.canvas.height = chart.grid.height = Math.max(1, Math.round(h * dpr));
  chart.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  chart.gridKey = '';
}

function drawGrid(chart, range, seconds, gate = false) {
  const key = `${chart.width}/${chart.height}/${chart.dpr}/${range}/${seconds}/${gate}`;
  if (key === chart.gridKey) return;
  chart.gridKey = key;
  const ctx = chart.grid.getContext('2d');
  ctx.setTransform(chart.dpr, 0, 0, chart.dpr, 0, 0);
  const w = chart.width, h = chart.height;
  const left = 48, right = 10, top = 10, bottom = 25;
  const ph = h - top - bottom, pw = w - left - right;
  ctx.clearRect(0, 0, w, h);
  ctx.font = '11px ui-sans-serif, system-ui';
  ctx.lineWidth = 1;
  for (let i = -2; i <= 2; i++) {
    const value = gate ? [0, 32, 64, 96, 127][i + 2] : i * range / 2;
    const y = gate ? top + ph * (127 - value) / 127 : top + ph * (range - value) / (2 * range);
    ctx.strokeStyle = value === 0 ? '#536277' : '#2a374a';
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(w - right, y); ctx.stroke();
    ctx.fillStyle = '#8392a7'; ctx.textAlign = 'right';
    ctx.fillText(Number.isInteger(value) ? String(value) : value.toFixed(1), left - 8, y + 4);
  }
  ctx.textAlign = 'center'; ctx.fillStyle = '#8392a7';
  for (let i = 0; i <= 4; i++) {
    const x = left + pw * i / 4;
    ctx.fillText(`${(-seconds + seconds * i / 4).toFixed(seconds === 2 ? 1 : 0)}s`, x, h - 5);
  }
}

function draw(chart, source, startIndex, endUs, seconds, offset, fixedRange) {
  const gate = offset === -1;
  sizeChart(chart);
  const startUs = endUs - seconds * 1e6;
  let begin = startIndex;
  while (begin < source.length && source[begin].us < startUs) begin++;
  let end = begin;
  while (end < source.length && source[end].us <= endUs) end++;
  let range = fixedRange;
  if (!range) {
    let peak = 5;
    for (let i = begin; i < end; i++) {
      for (let axis = 0; axis < 3; axis++) peak = Math.max(peak, Math.abs(source[i].v[offset + axis]));
    }
    range = Math.max(5, Math.ceil(peak / 10) * 10);
  }
  drawGrid(chart, range, seconds, gate);
  const {ctx, width: w, height: h} = chart;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(chart.grid, 0, 0, w, h);
  const left = 48, right = 10, top = 10, bottom = 25;
  const pw = w - left - right, ph = h - top - bottom;
  for (let axis = 0; axis < (gate ? 2 : 3); axis++) {
    ctx.strokeStyle = gate ? (axis === 0 ? '#63768c' : colors[2]) : colors[axis];
    ctx.lineWidth = gate && axis === 1 ? 2.2 : 1.6;
    ctx.beginPath();
    let started = false;
    for (let i = begin; i < end; i++) {
      const gateValue = axis === 0 ? source[i].cc1 : source[i].estimatedCc1;
      if (gate && !Number.isInteger(gateValue)) { started = false; continue; }
      const x = left + pw * (source[i].us - startUs) / (seconds * 1e6);
      const y = gate ? top + ph * (127 - gateValue) / 127
                     : top + ph * (range - source[i].v[offset + axis]) / (2 * range);
      if (!started) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      started = true;
    }
    ctx.stroke();
  }
}

function render(nowMs) {
  if (dualMode) { requestAnimationFrame(render); return; }
  const drawStartMs = performance.now();
  const end = paused ? frozenEnd : displayEnd(nowMs);
  const source = paused ? frozenSamples : samples;
  const startIndex = paused ? 0 : first;
  const seconds = Number(windowSelect.value);
  if (!paused || needsPausedDraw) {
    draw(charts[0], source, startIndex, end, seconds, 0, 2);
    draw(charts[1], source, startIndex, end, seconds, 3, null);
    draw(charts[2], source, startIndex, end, seconds, -1, 127);
    needsPausedDraw = false;
  }
  worstDrawMs = Math.max(worstDrawMs, performance.now() - drawStartMs);
  if (lastFrameMs) worstFrameMs = Math.max(worstFrameMs, nowMs - lastFrameMs);
  lastFrameMs = nowMs;
  frameCount++;
  if (nowMs - frameWindowMs >= 2000) {
    const fps = frameCount * 1000 / (nowMs - frameWindowMs);
    framesEl.textContent = `${fps.toFixed(0)} fps · frame max ${worstFrameMs.toFixed(0)} ms · draw max ${worstDrawMs.toFixed(1)} ms`;
    deliveryEl.textContent = `arrival max ${worstArrivalMs.toFixed(0)} ms · missing ${sequenceGaps}`;
    frameCount = 0; worstFrameMs = 0; worstDrawMs = 0; worstArrivalMs = 0; frameWindowMs = nowMs;
    if (latestSample) {
      if (!paused) latestEl.textContent = `Sample ${latestSample.seq} · ${Math.round(latestSample.us / 1000)} ms`;
      let i = samples.length - 1;
      while (i > first && samples[i].us - samples[i - 1].us < 2_000_000 && latestSample.us - samples[i - 1].us <= 2_000_000) i--;
      const elapsed = (latestSample.us - samples[i].us) / 1e6;
      if (connected && elapsed > 0) rateEl.textContent = `${((samples.length - 1 - i) / elapsed).toFixed(1)} samples/s`;
    }
  }
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
