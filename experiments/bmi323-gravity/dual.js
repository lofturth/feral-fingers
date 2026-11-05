const dualRoot = document.getElementById('dual-charts');
const dualBuffers = [makeBuffer(), makeBuffer()];
const dualCards = [[], []];
const dualCharts = [[], []];
const dualHeadings = [];
const dualVisibility = new IntersectionObserver(entries => {
  for (const entry of entries) entry.target._chart.visible = entry.isIntersecting;
  dualRedraw = true;
}, {rootMargin: '200px'});
let dualClockOffset = null;
let dualLatest = null;
let dualFrozen = null;
let dualFrozenEnd = 0;
let dualView = 'separate';
let dualRedraw = true;
let dualGaps = 0;
let wirelessMode = false;
let previousFrame = 0;
let frameWindow = performance.now();
let frames = 0;
let longFrames = 0;
let maxFrame = 0;
let maxDraw = 0;

// More than 30 seconds at 400 Hz. Old samples are overwritten in constant time.
function makeBuffer() {
  const slots = new Array(16384);
  let start = 0, length = 0;
  return {
    get length() { return length; },
    get(i) { return slots[(start + i) % slots.length]; },
    push(item) {
      slots[(start + length) % slots.length] = item;
      if (length < slots.length) length++;
      else start = (start + 1) % slots.length;
    },
    clear() { start = 0; length = 0; },
    snapshot() {
      const copy = Array.from({length}, (_, i) => slots[(start + i) % slots.length]);
      return {length: copy.length, get(i) { return copy[i]; }};
    },
  };
}

function lowerBound(source, timeUs) {
  let lo = 0, hi = source.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (source.get(mid).us < timeUs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function arrangeDual() {
  const order = dualView === 'separate'
    ? [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]]
    : [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]];
  dualHeadings.forEach(heading => { heading.hidden = dualView !== 'separate'; });
  for (const [sensor, kind] of order) {
    if (dualView === 'separate' && kind === 0) dualRoot.append(dualHeadings[sensor]);
    dualRoot.append(dualCards[sensor][kind]);
  }
  document.querySelectorAll('.dual-view button').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.view === dualView));
  });
  dualRedraw = true;
}

function initDual() {
  if (dualCharts[0].length) return;
  document.getElementById('single-charts').hidden = true;
  dualRoot.hidden = false;
  midiOutputEl.hidden = false;
  document.querySelector('.sub').textContent = 'Live motion from two BMI323 sensors';
  document.querySelector('footer span').textContent = 'Qwiic · SDA 6 / SCL 7 · 400 Hz sensor configuration';
  const toggle = document.createElement('div');
  toggle.className = 'dual-view';
  toggle.innerHTML = '<span>View</span><button type="button" data-view="separate">Separate</button><button type="button" data-view="combined">Combined</button>';
  dualRoot.before(toggle);
  toggle.addEventListener('click', event => {
    const view = event.target.dataset.view;
    if (view && view !== dualView) { dualView = view; arrangeDual(); }
  });
  const types = [['Acceleration', 'g', 'accel'], ['Angular velocity', 'degrees / second', 'gyro'],
                 ['Filtered gravity', 'g', 'gravity']];
  for (let sensor = 0; sensor < 2; sensor++) {
    const heading = document.createElement('h2');
    heading.className = 'dual-sensor-heading';
    heading.textContent = `Sensor ${sensor + 1} (0x${sensor ? '69' : '68'})`;
    dualHeadings.push(heading);
    dualRoot.append(heading);
    for (let kind = 0; kind < 3; kind++) {
      const [title, unit, id] = types[kind];
      const card = document.createElement('section');
      card.className = 'card';
      card.innerHTML = `<div class="chart-head"><div><h2>Sensor ${sensor + 1} (0x${sensor ? '69' : '68'}) — ${title}</h2><span>${unit}</span></div>` +
        '<div class="legend"><span><i class="x"></i>X</span><span><i class="y"></i>Y</span><span><i class="z"></i>Z</span></div></div>' +
        `<canvas id="dual-${sensor}-${id}" aria-label="Sensor ${sensor + 1} ${title} X Y Z graph"></canvas>`;
      dualCards[sensor][kind] = card;
      dualRoot.append(card);
      const chart = makeChart(`dual-${sensor}-${id}`);
      chart.visible = true;
      card._chart = chart;
      dualVisibility.observe(card);
      dualCharts[sensor][kind] = chart;
    }
  }
  arrangeDual();
}

events.addEventListener('status', event => { if (JSON.parse(event.data).dual) initDual(); });
events.addEventListener('wireless', event => {
  wirelessMode = true;
  const stats = JSON.parse(event.data);
  rateEl.textContent = `${stats.received_hz.toFixed(1)} packets/s`;
  const p95 = stats.arrival_us?.p95, jitter = stats.arrival_jitter_us?.p95;
  deliveryEl.textContent = `UDP gaps ${stats.sequence_gaps} · arrival p95 ${p95 == null ? '—' : (p95 / 1000).toFixed(2)} ms · jitter p95 ${jitter == null ? '—' : (jitter / 1000).toFixed(2)} ms`;
  document.querySelector('footer span').textContent = 'Qwiic · SDA 6 / SCL 7 · 400 Hz · Wi-Fi UDP';
});
events.addEventListener('dual', event => {
  const packet = JSON.parse(event.data);
  if (!dualCharts[0].length) initDual();
  if (dualLatest && packet.us <= dualLatest.us) {
    dualBuffers.forEach(buffer => buffer.clear());
    dualClockOffset = null;
    dualGaps = 0;
  }
  if (dualLatest && packet.seq > dualLatest.seq + 1) dualGaps += packet.seq - dualLatest.seq - 1;
  dualLatest = packet;
  if (dualClockOffset === null) dualClockOffset = packet.us - performance.now() * 1000;
  packet.sensors.forEach((sample, sensor) => {
    if (sample && sample.v?.length === 6) dualBuffers[sensor].push(sample);
  });
});
pauseButton.addEventListener('click', () => {
  if (!dualMode) return;
  if (paused) {
    dualFrozenEnd = performance.now() * 1000 + (dualClockOffset || 0);
    dualFrozen = dualBuffers.map(buffer => buffer.snapshot());
  } else dualFrozen = null;
  dualRedraw = true;
});
windowSelect.addEventListener('change', () => { dualRedraw = true; });

function valueAt(sample, kind, axis) {
  return kind === 2 ? sample.gravity?.[axis] : sample.v[kind * 3 + axis];
}

function drawDual(chart, source, endUs, seconds, kind) {
  sizeChart(chart);
  const startUs = endUs - seconds * 1e6;
  const begin = lowerBound(source, startUs), end = lowerBound(source, endUs);
  let range = kind === 0 ? 2 : kind === 2 ? 1 : 10;
  if (kind === 1) {
    let peak = 5;
    for (let i = begin; i < end; i++) {
      const sample = source.get(i);
      for (let axis = 0; axis < 3; axis++) peak = Math.max(peak, Math.abs(sample.v[3 + axis]));
    }
    range = Math.max(5, Math.ceil(peak / 10) * 10);
  }
  drawGrid(chart, range, seconds);
  const {ctx, width: w, height: h} = chart;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(chart.grid, 0, 0, w, h);
  const left = 48, pw = w - 58, top = 10, ph = h - 35;
  const bucket = Math.max(1, Math.ceil((end - begin) / Math.max(1, pw)));
  for (let axis = 0; axis < 3; axis++) {
    ctx.strokeStyle = colors[axis];
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    let started = false;
    for (let i = begin; i < end; i += bucket) {
      const stop = Math.min(i + bucket, end);
      let low = Infinity, high = -Infinity, last = NaN;
      for (let j = i; j < stop; j++) {
        const value = valueAt(source.get(j), kind, axis);
        if (!Number.isFinite(value)) continue;
        low = Math.min(low, value); high = Math.max(high, value); last = value;
      }
      if (!Number.isFinite(last)) { started = false; continue; }
      const x = left + pw * (source.get(i).us - startUs) / (seconds * 1e6);
      const y = top + ph * (range - last) / (2 * range);
      if (!started) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      const lowY = top + ph * (range - low) / (2 * range);
      const highY = top + ph * (range - high) / (2 * range);
      if (bucket > 1) { ctx.moveTo(x, lowY); ctx.lineTo(x, highY); ctx.moveTo(x, y); }
      started = true;
    }
    ctx.stroke();
  }
}

function renderDual(now) {
  requestAnimationFrame(renderDual);
  if (!dualMode || !dualCharts[0].length) return;
  if (previousFrame) {
    const interval = now - previousFrame;
    maxFrame = Math.max(maxFrame, interval);
    if (interval > 25) longFrames++;
  }
  previousFrame = now;
  const drawStart = performance.now();
  const end = paused ? dualFrozenEnd : now * 1000 + (dualClockOffset || 0);
  const sources = paused ? dualFrozen : dualBuffers;
  const seconds = Number(windowSelect.value);
  if (!paused || dualRedraw) {
    for (let sensor = 0; sensor < 2; sensor++)
      for (let kind = 0; kind < 3; kind++)
        if (dualCharts[sensor][kind].visible)
          drawDual(dualCharts[sensor][kind], sources[sensor], end, seconds, kind);
    dualRedraw = false;
  }
  maxDraw = Math.max(maxDraw, performance.now() - drawStart);
  frames++;
  if (now - frameWindow >= 2000) {
    framesEl.textContent = `${(frames * 1000 / (now - frameWindow)).toFixed(0)} fps · long ${longFrames} · frame max ${maxFrame.toFixed(0)} ms · draw max ${maxDraw.toFixed(1)} ms`;
    if (!wirelessMode) deliveryEl.textContent = `missing ${dualGaps}`;
    if (dualLatest) {
      latestEl.textContent = `Cycle ${dualLatest.seq} · ${Math.round(dualLatest.us / 1000)} ms`;
      const midi = dualLatest.midi;
      if (midi) midiOutputEl.textContent = `S1 gravity X → Pitch ${midi.pitch ?? '—'} · S2 gravity Z → CC1 ${midi.cc1 ?? '—'}${midi.available ? '' : ' (MIDI unavailable)'}`;
      const source = dualBuffers[0];
      const begin = lowerBound(source, dualLatest.us - 2_000_000);
      if (!wirelessMode && source.length - begin > 1) {
        const elapsed = (source.get(source.length - 1).us - source.get(begin).us) / 1e6;
        if (elapsed > 0) rateEl.textContent = `${((source.length - begin - 1) / elapsed).toFixed(1)} samples/s`;
      }
    }
    frames = 0; longFrames = 0; maxFrame = 0; maxDraw = 0; frameWindow = now;
  }
}
requestAnimationFrame(renderDual);
