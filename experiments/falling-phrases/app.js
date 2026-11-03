'use strict';

// SVG coordinates are rendering only; engine positions are percentages.
const TUNE = { top: 24, bottom: 502, reachableTop: 60, left: 20, right: 1180, traceMargin: 4 };
// Gravity uses percentage points per second, independent of retrieval streak.
const MOTION = { ...MunduPhysics.DEFAULTS.motion };
// A selected word starts a new response clock; active session time excludes pause.
// Store and render every raw observation.
const PROGRESS = { sampleSeconds: 0.25 };
const TRACE_LABEL = { gap: 12 };
const FINISH = { ...MunduPhysics.DEFAULTS.finish };
// NEW WORDS must remain strictly below completion and above the starting floor.
const DATASET = { totalWords: 10 };
const UNLOCK = { ...MunduPhysics.DEFAULTS.unlock };
let sessionComplete = false, completionPresented = false;
let session, sessionState, selectedIndex = 0, pendingUnlock = false;
let wordFlashes = [];
let kickGraphEnded = false;
let gravityReadout;
const COLOR = { grid: '#202738', muted: '#657087', pink: '#ED4CA8', cyan: '#43E6ED' };
const HINT_SECONDS = 2;
const latencyMultiplier = t => 0.5 + 1.5 * Math.exp(-1.5 * Math.max(0, t));
const VOCABULARY = [
  ['river', 'río'], ['light', 'luz'], ['apple', 'manzana'],
  ['night', 'noche'], ['house', 'casa'], ['water', 'agua'], ['bread', 'pan'],
  ['bird', 'pájaro'], ['dream', 'sueño'], ['window', 'ventana'],
  ['sun', 'sol'], ['moon', 'luna'], ['star', 'estrella'], ['sky', 'cielo'],
  ['sea', 'mar'], ['mountain', 'montaña'], ['tree', 'árbol'], ['flower', 'flor'],
  ['road', 'camino'], ['city', 'ciudad'], ['book', 'libro'], ['table', 'mesa'],
  ['chair', 'silla'], ['door', 'puerta'], ['fire', 'fuego'], ['earth', 'tierra'],
  ['hand', 'mano'], ['eye', 'ojo'], ['heart', 'corazón'], ['time', 'tiempo']
];
const NS = 'http://www.w3.org/2000/svg';
const el = id => typeof document !== 'undefined' ? document.getElementById(id) : null;
const screenY = position => TUNE.bottom - position / 100 * (TUNE.bottom - TUNE.reachableTop);
const motionPreference = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
let words, observations, progressValue, count, paused = false;
let lastTime = null, lastMeasurement = null;
let activeTime = 0, nextSampleTime = PROGRESS.sampleSeconds;
let observationTimes = [];
const nodes = [];
let animationFrame = null;
let historyPath = '', historyLength = 0;
const renderedAttributes = new WeakMap();

function setAttribute(node, key, value) {
  if (!node) return;
  let values = renderedAttributes.get(node);
  if (!values) { values = new Map(); renderedAttributes.set(node, values); }
  const text = String(value);
  if (values.get(key) !== text) { node.setAttribute(key, text); values.set(key, text); }
}
function setText(node, value) {
  if (!node) return;
  const text = String(value);
  if (node.textContent !== text) node.textContent = text;
}
function toggleClass(node, key, value) {
  if (!node || !node.classList) return;
  if (node.classList.contains(key) !== value) node.classList.toggle(key, value);
}
function scheduleFrame() {
  if (animationFrame === null && !paused && !sessionComplete && typeof document !== 'undefined' && !document.hidden) {
    if (typeof requestAnimationFrame === 'function') {
      animationFrame = requestAnimationFrame(frame);
    }
  }
}
function stopFrames() {
  if (animationFrame !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(animationFrame);
  }
  animationFrame = null;
}

function svgNode(type, attributes, parent) {
  const node = document.createElementNS(NS, type);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  parent.appendChild(node);
  return node;
}

function physicsConfig() {
  return {
    motion: { ...MOTION },
    unlock: { ...UNLOCK },
    finish: { ...FINISH },
    instantPosition: motionPreference.matches
  };
}

function syncSession() {
  const state = sessionState = session.getState();
  words = state.cards.map((card, i) => ({
    ...card,
    flash: wordFlashes[i] || 0,
    english: VOCABULARY[i]?.[0] || `Phrase ${i + 1}`,
    spanish: VOCABULARY[i]?.[1] || 'C4 D4 E4'
  }));
  activeTime = state.time;
  paused = state.paused;
  sessionComplete = state.complete;
  count = state.rewardCount ?? 0;
  selectedIndex = state.selectedIndex;
}

function acceptTransition(result) {
  if (result && result.unlockedIndex !== null && result.unlockedIndex !== undefined) pendingUnlock = true;
  syncSession();
}

function reset() {
  if (el('completion-screen')?.open) el('completion-screen').close();
  session = MunduPhysics.createSession({ cardCount: DATASET.totalWords, config: physicsConfig() });
  wordFlashes = Array.from({ length: DATASET.totalWords }, () => 0);
  pendingUnlock = false;
  completionPresented = false;
  kickGraphEnded = false;
  observations = [0];
  observationTimes = [0];
  nextSampleTime = PROGRESS.sampleSeconds;
  historyPath = '';
  historyLength = 0;
  progressValue = 0;
  lastMeasurement = null;
  syncSession();
  buildSvg();
  lastTime = typeof performance !== 'undefined' ? performance.now() : 0;
  updateStatus();
  render(0);
  updateReadouts();
  initAttempt();
  scheduleFrame();
}

function retrieve(skipped = false) {
  if (paused || sessionComplete) return;
  advanceTo(typeof performance !== 'undefined' ? performance.now() : 0);
  if (paused || sessionComplete) return;
  recordObservation();
  const targetIndex = sessionState ? sessionState.selectedIndex : selectedIndex;
  if (targetIndex < 0) return;

  if (skipped) {
    const result = session.skip();
    if (!result) return;
    lastMeasurement = {
      kind: 'skip',
      index: targetIndex,
      word: VOCABULARY[targetIndex]?.[0] || 'Phrase',
      translation: VOCABULARY[targetIndex]?.[1] || '',
      lift: 0
    };
    kickGraphEnded = true;
    acceptTransition(result);
    progressValue = overallProgress();
    recordObservation();
    updateReadouts();
    render(0);
    checkCompletion();
  } else {
    const latency = sessionState ? Math.max(0, sessionState.time - sessionState.selectedAt) : 0;
    const multiplier = latencyMultiplier(latency);
    const result = session.applyReward(targetIndex, multiplier);
    if (!result) return;
    wordFlashes[targetIndex] = 1;
    const hinted = latency >= HINT_SECONDS;
    lastMeasurement = {
      kind: 'retrieval',
      index: targetIndex,
      word: VOCABULARY[targetIndex]?.[0] || 'Phrase',
      translation: VOCABULARY[targetIndex]?.[1] || '',
      hintVisible: hinted,
      multiplier,
      kickTime: result.kickTime,
      lift: result.lift
    };
    kickGraphEnded = true;
    acceptTransition(result);
    progressValue = overallProgress();
    recordObservation();
    updateReadouts();
    render(0);
    checkCompletion();
  }
}

function recordObservation() {
  observations.push(progressValue);
  observationTimes.push(activeTime);
}

function overallProgress() {
  return session.getProgress();
}

function advanceProgress() {
  progressValue = overallProgress();
  if (activeTime >= nextSampleTime) {
    recordObservation();
    nextSampleTime = activeTime + PROGRESS.sampleSeconds;
  }
}

function checkCompletion() {
  if (!sessionComplete || completionPresented) return;
  completionPresented = true;
  progressValue = overallProgress();
  recordObservation();
  paused = true;
  stopFrames();
  updateStatus();
  const seconds = Math.floor(activeTime);
  if (el('completion-time')) el('completion-time').textContent = String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
  if (el('completion-count')) el('completion-count').textContent = String(count);
  if (el('completion-word-count')) el('completion-word-count').textContent = String(words.length);
  setTuningOpen(false);
  el('completion-screen')?.showModal?.();
}

function plottedHistory() {
  const points = observations.map((value, i) => [observationTimes[i], value]);
  points.push([activeTime, progressValue]);
  return points;
}

function updateTraceStroke() {
  const scale = el('chart')?.getScreenCTM?.()?.a || 1;
  for (const id of ['trace', 'trace-live']) {
    const node = el(id);
    if (node) setAttribute(node, 'stroke-width', 2.3 * scale);
  }
}

function buildSvg() {
  updateTraceStroke();
  for (const id of ['grid', 'bars', 'labels']) {
    const container = el(id);
    if (container) container.replaceChildren();
  }
  nodes.length = 0;

  const labels = el('labels');
  const grid = el('grid');
  const bars = el('bars');
  if (!labels || !grid || !bars) return;

  svgNode('line', {
    id: 'unlock-line', x1: TUNE.left, y1: screenY(UNLOCK.threshold), x2: TUNE.right, y2: screenY(UNLOCK.threshold),
    stroke: '#8b7aa8', 'stroke-width': 1, 'stroke-dasharray': '3 8', opacity: 0.65
  }, labels);
  const unlockLabel = svgNode('text', {
    id: 'unlock-label', x: TUNE.left + 3, y: screenY(UNLOCK.threshold) - 7,
    fill: '#8b7aa8', 'font-size': 8
  }, labels);
  unlockLabel.textContent = 'NEW WORDS';

  svgNode('line', {
    id: 'completion-line', x1: TUNE.left, y1: screenY(FINISH.threshold), x2: TUNE.right, y2: screenY(FINISH.threshold),
    stroke: COLOR.muted, 'stroke-width': 1, 'stroke-dasharray': '5 7', opacity: 0.65
  }, labels);
  const thresholdLabel = svgNode('text', {
    id: 'completion-label', x: TUNE.left + 3, y: screenY(FINISH.threshold) - 7, fill: COLOR.muted, 'font-size': 8
  }, labels);
  thresholdLabel.textContent = 'COMPLETION';

  for (let i = 0; i <= 4; i++) {
    const y = TUNE.top + i * (TUNE.bottom - TUNE.top) / 4;
    svgNode('line', { x1: TUNE.left, y1: y, x2: TUNE.right, y2: y, stroke: COLOR.grid, 'stroke-width': 1 }, grid);
    const text = svgNode('text', { x: 1190, y: y + 3, fill: COLOR.muted, 'font-size': 8, 'text-anchor': 'end' }, grid);
    text.textContent = 100 - i * 25;
  }

  const slot = (TUNE.right - TUNE.left) / words.length;
  words.forEach((word, i) => {
    const x = TUNE.left + i * slot + 5, width = slot - 10;
    const slotCol = svgNode('rect', {
      x: x - 2, y: TUNE.top, width: width + 4, height: TUNE.bottom - TUNE.top,
      fill: 'rgba(67, 230, 237, 0.04)', stroke: '#43E6ED', 'stroke-width': 1.2,
      'stroke-dasharray': '3 6', opacity: 0, rx: 2
    }, grid);
    const slotArrow = svgNode('polygon', {
      points: `${x + width / 2 - 5},${TUNE.top - 10} ${x + width / 2 + 5},${TUNE.top - 10} ${x + width / 2},${TUNE.top - 3}`,
      fill: '#43E6ED', opacity: 0
    }, grid);
    const guide = svgNode('line', {
      x1: x + width / 2, y1: TUNE.top, x2: x + width / 2, y2: TUNE.bottom,
      stroke: COLOR.grid, 'stroke-width': 0.6, 'stroke-dasharray': '2 8'
    }, grid);
    const bar = svgNode('rect', { x, y: TUNE.top, width, height: 0, fill: 'url(#bar-fill)' }, bars);
    const edge = svgNode('line', { x1: x, y1: 0, x2: x + width, y2: 0, stroke: COLOR.pink, 'stroke-width': 1.3 }, bars);
    const label = svgNode('text', { x: 0, y: 0, fill: '#e3e8ef', 'font-size': 14, 'text-anchor': 'start', 'dominant-baseline': 'central' }, labels);
    label.textContent = word.english || `Phrase ${i + 1}`;
    const streak = svgNode('text', { x: x + width / 2, y: 0, fill: COLOR.pink, 'font-size': 8, 'text-anchor': 'middle' }, labels);
    const index = svgNode('text', { x: x + width / 2, y: 540, fill: COLOR.muted, 'font-size': 8, 'text-anchor': 'middle' }, grid);
    index.textContent = String(i + 1).padStart(2, '0');
    nodes.push({ bar, edge, label, streak, guide, index, slotCol, slotArrow });
  });
}

function wordAboveFinish(word) {
  return MunduPhysics.isAboveFinish ? MunduPhysics.isAboveFinish(word, FINISH.threshold) : (word.depth >= FINISH.threshold);
}

function renderKickGraph(state, dt) {
  if (dt > 0) kickGraphEnded = false;
  const graph = el('kick-graph');
  if (!graph) return;
  const hidden = state.complete || state.selectedIndex < 0 || kickGraphEnded;
  if (graph.hidden !== hidden) graph.hidden = hidden;
  setAttribute(graph, 'aria-hidden', String(graph.hidden));
  if (state.complete || state.selectedIndex < 0) return;
  const elapsed = Math.max(0, state.time - state.selectedAt);
  const hintSeconds = HINT_SECONDS;
  const windowSeconds = Math.max(4, elapsed);
  const x = t => 32 + 192 * t / windowSeconds;
  const y = m => 64 - 52 * m / latencyMultiplier(0);
  const multiplier = latencyMultiplier(elapsed);
  const hintX = x(hintSeconds);
  const curve = el('kick-reward-curve');
  if (curve && curve.windowSeconds !== windowSeconds) {
    curve.windowSeconds = windowSeconds;
    const denseEnd = Math.min(windowSeconds, 8);
    const curvePoints = Array.from({ length: 97 }, (_, i) => {
      const t = denseEnd * i / 96;
      return `${i === 0 ? 'M' : 'L'}${x(t)} ${y(latencyMultiplier(t))}`;
    });
    if (windowSeconds > denseEnd) curvePoints.push(`L224 ${y(latencyMultiplier(windowSeconds))}`);
    setAttribute(curve, 'd', curvePoints.join(' '));
  }
  if (el('kick-hint-guide')) { setAttribute(el('kick-hint-guide'), 'x1', hintX); setAttribute(el('kick-hint-guide'), 'x2', hintX); }
  if (el('kick-hint-point')) { setAttribute(el('kick-hint-point'), 'cx', hintX); setAttribute(el('kick-hint-point'), 'cy', y(latencyMultiplier(hintSeconds))); }
  if (el('kick-indicator')) { setAttribute(el('kick-indicator'), 'cx', x(elapsed)); setAttribute(el('kick-indicator'), 'cy', y(multiplier)); }
  if (el('kick-one-second')) { setAttribute(el('kick-one-second'), 'x', x(1)); setAttribute(el('kick-one-second'), 'visibility', x(hintSeconds) - x(1) >= 18 ? 'visible' : 'hidden'); }
  if (el('kick-hint-time')) { setAttribute(el('kick-hint-time'), 'x', hintX); setAttribute(el('kick-hint-time'), 'visibility', hintX - x(0) >= 24 ? 'visible' : 'hidden'); setText(el('kick-hint-time'), hintSeconds + 's'); }
  if (el('kick-axis-end')) setText(el('kick-axis-end'), windowSeconds.toFixed(1) + 's');
  if (el('kick-graph-value')) setText(el('kick-graph-value'), elapsed.toFixed(1) + 's / ' + multiplier.toFixed(2) + '×');
  if (el('kick-graph-svg')) setAttribute(el('kick-graph-svg'), 'aria-label', `Possible kick: ${multiplier.toFixed(2)} times at ${elapsed.toFixed(1)} seconds; hint at ${hintSeconds} seconds`);
}

function render(dt) {
  const unlocked = pendingUnlock;
  pendingUnlock = false;
  const selected = sessionState ? sessionState.selectedIndex : selectedIndex;

  words.forEach((word, i) => {
    const node = nodes[i];
    if (!node) return;
    const { bar, edge, label, streak, guide, index, slotCol, slotArrow } = node, y = screenY(word.shown);
    const isSelected = i === selected;

    for (const element of [bar, edge, label, streak, guide, index]) {
      setAttribute(element, 'visibility', word.unlocked ? 'visible' : 'hidden');
    }
    if (slotCol) {
      setAttribute(slotCol, 'visibility', word.unlocked && isSelected ? 'visible' : 'hidden');
      setAttribute(slotCol, 'opacity', isSelected ? '0.9' : '0');
    }
    if (slotArrow) {
      setAttribute(slotArrow, 'visibility', word.unlocked && isSelected ? 'visible' : 'hidden');
      setAttribute(slotArrow, 'opacity', isSelected ? '1' : '0');
    }

    const above = wordAboveFinish(word);
    if (node.aboveFinish === true && !above) node.reactivation = 0.28;
    else node.reactivation = Math.max(0, (node.reactivation || 0) - dt);
    node.aboveFinish = above;
    for (const element of [bar, edge, label, streak]) {
      toggleClass(element, 'word-faded', above);
      toggleClass(element, 'word-reactivated', !above && node.reactivation > 0);
    }
    setAttribute(bar, 'height', y - TUNE.top);
    setAttribute(bar, 'fill', isSelected ? 'url(#bar-fill-selected)' : 'url(#bar-fill)');
    setAttribute(edge, 'y1', y);
    setAttribute(edge, 'y2', y);
    setAttribute(edge, 'stroke-width', 1.3 + word.flash * 1.5);
    setAttribute(edge, 'stroke', word.flash > 0.2 ? '#ffffff' : isSelected ? COLOR.cyan : COLOR.pink);
    setAttribute(label, 'transform', `translate(${TUNE.left + (i + 0.5) * (TUNE.right - TUNE.left) / words.length},${y - 8}) rotate(-90)`);
    setAttribute(label, 'fill', word.flash > 0.2 || node.reactivation > 0 ? COLOR.pink : isSelected ? COLOR.cyan : '#e3e8ef');
    setAttribute(streak, 'y', y + 16);
    setText(streak, Math.round(Math.min(word.depth, word.shown)) + '%');
    setAttribute(streak, 'font-size', 15);
    setAttribute(streak, 'font-weight', 700);
    setAttribute(streak, 'fill', isSelected ? COLOR.cyan : COLOR.pink);
    setAttribute(streak, 'stroke', '#0A0D19');
    setAttribute(streak, 'stroke-width', 4);
    setAttribute(streak, 'paint-order', 'stroke');

    if (isSelected) {
      setAttribute(index, 'fill', COLOR.cyan);
      setAttribute(index, 'font-weight', '700');
    } else {
      setAttribute(index, 'fill', COLOR.muted);
      setAttribute(index, 'font-weight', '400');
    }
  });

  progressValue = overallProgress();
  if (unlocked) recordObservation();
  if (el('score')) setText(el('score'), progressValue.toFixed(1));

  const traceY = value => TUNE.bottom - TUNE.traceMargin - value / 100 * (TUNE.bottom - TUNE.top - 2 * TUNE.traceMargin);
  while (historyLength < observations.length) {
    const i = historyLength++;
    historyPath += (i ? ' L' : 'M') + observationTimes[i] + ',' + traceY(observations[i]).toFixed(2);
  }
  if (el('trace')) setAttribute(el('trace'), 'd', historyPath);
  const transform = `translate(${TUNE.left} 0) scale(${activeTime > 0 ? (TUNE.right - TUNE.left) / activeTime : 1} 1)`;
  for (const id of ['trace', 'trace-live']) {
    const node = el(id);
    if (node) {
      setAttribute(node, 'transform', transform);
      setAttribute(node, 'vector-effect', 'non-scaling-stroke');
    }
  }
  const last = observations.length - 1, headY = traceY(progressValue);
  if (el('trace-live') && observations.length) {
    setAttribute(el('trace-live'), 'd', `M${observationTimes[last]},${traceY(observations[last]).toFixed(2)} L${activeTime},${headY.toFixed(2)}`);
  }
  if (el('trace-percentage')) {
    setAttribute(el('trace-percentage'), 'x', TUNE.right + TRACE_LABEL.gap);
    setAttribute(el('trace-percentage'), 'y', headY);
    setText(el('trace-percentage'), progressValue.toFixed(1) + '%');
  }

  const target = words[selected];
  if (target && el('target-word')) setText(el('target-word'), target.english || `Slot ${String(selected + 1).padStart(2, '0')}`);
  if (target && el('target-streak')) setText(el('target-streak'), 'STREAK ' + String(target.streak).padStart(2, '0'));
  if (el('card-slot-tag')) setText(el('card-slot-tag'), selected >= 0 ? `ACTIVE SLOT ${String(selected + 1).padStart(2, '0')}` : 'COMPLETE');

  const promptState = sessionState;
  if (promptState) renderKickGraph(promptState, dt);
  if (gravityReadout && promptState) setText(gravityReadout, 'EFFECTIVE GRAVITY ' + (100 * promptState.gravityMultiplier).toFixed(2) + '%');
  if (promptState && el('target-hint')) {
    const hinted = (promptState.time - promptState.selectedAt) >= HINT_SECONDS;
    if (el('target-hint').hidden === hinted) el('target-hint').hidden = !hinted;
    setText(el('target-hint'), hinted ? 'HINT → ' + (target ? target.spanish : 'C4 D4 E4') : '');
  }
  checkCompletion();
}

function updateReadouts() {
  if (el('count')) el('count').textContent = String(count).padStart(3, '0');
  if (el('score')) el('score').textContent = progressValue.toFixed(1);
  if (el('feedback')) {
    if (lastMeasurement) {
      if (lastMeasurement.kind === 'reward') {
        el('feedback').textContent = `Slot ${String(lastMeasurement.index + 1).padStart(2, '0')} rewarded / ↑${lastMeasurement.lift.toFixed(1)} pp lift / ${lastMeasurement.rewardMagnitude >= 1 ? 'First Try (full)' : 'After mistakes (half)'}`;
      } else {
        el('feedback').textContent = `${lastMeasurement.word || 'Phrase'} → ${lastMeasurement.translation || ''} / ${lastMeasurement.kind === 'retrieval' ? (lastMeasurement.hintVisible ? 'hinted' : 'unhinted') + ' / ' + lastMeasurement.multiplier.toFixed(2) + '× kick' + ' / ↑' + lastMeasurement.lift.toFixed(1) + ' pp' : 'skipped / no kick'}`;
      }
    } else {
      el('feedback').textContent = `${words.length} slots. One keyboard. Keep them afloat.`;
    }
  }
}

function updateStatus() {
  if (el('status')) el('status').textContent = sessionComplete ? 'COMPLETE' : paused ? 'PAUSED' : 'LIVE';
  if (el('pause')) {
    el('pause').disabled = sessionComplete;
    el('pause').innerHTML = paused ? 'RESUME <span>▶</span>' : 'PAUSE <span>Ⅱ</span>';
    el('pause').setAttribute('aria-pressed', String(paused));
  }
  if (el('status')?.parentElement) el('status').parentElement.classList.toggle('paused', paused);
  if (el('prompt')) el('prompt').textContent = sessionComplete ? 'ALL PHRASES CLEAR / RESET TO RESTART' : paused ? 'SESSION PAUSED / RESUME TO RETRIEVE' : 'PLAY C4-D4-E4 = RETRIEVE / ESC = SKIP';
}

function advanceTo(time) {
  const nextTime = lastTime === null ? time : Math.max(time, lastTime);
  const dt = lastTime === null ? 0 : (nextTime - lastTime) / 1000;
  lastTime = nextTime;
  if (!paused && !sessionComplete && (typeof document === 'undefined' || !document.hidden)) {
    wordFlashes = wordFlashes.map(flash => Math.max(0, flash - dt * 2.8));
    acceptTransition(session.advance(dt));
    advanceProgress();
    render(dt);
  }
}

function frame(time) {
  animationFrame = null;
  advanceTo(time);
  if (el('dev-panel')?.open) {
    drawPianoRoll();
  }
  scheduleFrame();
}

// Physical letter keys accept all layouts; modifier shortcuts retain browser behavior.
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      retrieve(true);
      return;
    }
    if (event.target?.matches('input, select, textarea')) return;
    if (event.key === '1') { event.preventDefault(); handleMidiNote(true, 60, 90); return; }
    if (event.key === '2') { event.preventDefault(); handleMidiNote(true, 62, 90); return; }
    if (event.key === '3') { event.preventDefault(); handleMidiNote(true, 64, 90); return; }
    if (event.key === 'p' || event.key === 'P') { event.preventDefault(); startDemoPlayback(); return; }
    if (/^Key[A-Z]$/.test(event.code) || /^\p{L}$/u.test(event.key)) {
      event.preventDefault();
      retrieve();
    }
  });

  el('pause')?.addEventListener('click', () => {
    if (sessionComplete) return;
    if (!paused) { advanceTo(typeof performance !== 'undefined' ? performance.now() : 0); render(0); }
    session.setPaused(!paused);
    syncSession();
    lastTime = typeof performance !== 'undefined' ? performance.now() : 0;
    updateStatus();
    if (paused) {
      stopFrames();
      stopAllAudio();
    } else {
      scheduleFrame();
    }
  });

  el('reset')?.addEventListener('click', reset);

  motionPreference.addEventListener?.('change', () => {
    acceptTransition(session.configure({ instantPosition: motionPreference.matches }));
    render(0);
    scheduleFrame();
  });

  document.addEventListener('visibilitychange', () => {
    lastTime = typeof performance !== 'undefined' ? performance.now() : 0;
    if (document.hidden) stopFrames(); else scheduleFrame();
  });
}

// Live tuning settings
const SETTINGS = [
  { name: 'VOCABULARY SET', values: DATASET, fields: [
    ['totalWords', 'Total words', 'Applied on the next session Reset', 1, VOCABULARY.length, 1]
  ] },
  { name: 'PROGRESSIVE WORDS', values: UNLOCK, fields: [
    ['threshold', 'NEW WORDS position (%)', '0% = bottom; must stay below completion', 100 / 442, 44000 / 442, 0.1]
  ] },
  { name: 'SHARED LINEAR PHYSICS', values: MOTION, fields: [
    ['topFallingSpeed', 'Top falling speed', 'At top; percentage points / second', 0.01, 15, 0.01],
    ['bottomToTopMultiplier', 'Bottom-to-top multiplier', 'Bottom ÷ top for falling and kicks; 3 = three times', 1, 1000, 0.1],
    ['kickHeightPercent', 'Kick height (%)', 'A 1× kick from the bottom reaches this height', 1, 100, 0.1],
    ['gravityReductionPercent', 'Gravity reduction / new word (%)', 'Each additional unlocked word reduces current gravity', 0, 10, 0.1]
  ] },
  { name: 'COMPLETION LINE', values: FINISH, fields: [
    ['threshold', 'Completion position (%)', 'Higher percentage = higher / harder to reach', 25200 / 442, 44100 / 442, 0.1]
  ] }
];
const DEFAULTS_STORAGE_KEY = 'mundu.tuningDefaults';
const factoryDefaults = SETTINGS.map(group => ({ ...group.values }));
function validTuningValue(value, min, max, step) {
  return Number.isFinite(value) && value >= min && value <= max && (step !== 1 || Number.isInteger(value));
}
function loadTuningDefaults() {
  try {
    if (typeof localStorage === 'undefined') return;
    const saved = JSON.parse(localStorage.getItem(DEFAULTS_STORAGE_KEY));
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return;
    for (const group of SETTINGS) for (const [key, , , min, max, step] of group.fields) {
      if (!validTuningValue(saved[group.name]?.[key], min, max, step)) return;
    }
    if (saved['PROGRESSIVE WORDS'].threshold >= saved['COMPLETION LINE'].threshold) return;
    for (const group of SETTINGS) for (const [key] of group.fields) group.values[key] = saved[group.name][key];
  } catch { /* Missing storage leaves factory values intact */ }
}
const tuningInputs = [];
function refreshTuning(recheckCompletion = false) {
  el('unlock-line')?.setAttribute('y1', screenY(UNLOCK.threshold));
  el('unlock-line')?.setAttribute('y2', screenY(UNLOCK.threshold));
  el('unlock-label')?.setAttribute('y', screenY(UNLOCK.threshold) - 7);
  el('completion-line')?.setAttribute('y1', screenY(FINISH.threshold));
  el('completion-line')?.setAttribute('y2', screenY(FINISH.threshold));
  el('completion-label')?.setAttribute('y', screenY(FINISH.threshold) - 7);
  if (recheckCompletion) completionPresented = false;
  acceptTransition(session.configure(physicsConfig(), { recheckCompletion }));
  updateStatus();
  render(0);
  scheduleFrame();
}
function setTuningOpen(open) {
  if (el('tuning-panel')) el('tuning-panel').hidden = !open;
  el('tune')?.setAttribute('aria-expanded', String(open));
}
function buildTuning() {
  if (!el('tuning-fields')) return;
  for (const [groupIndex, group] of SETTINGS.entries()) {
    const fieldset = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = group.name;
    fieldset.appendChild(legend);
    for (const [key, title, description, min, max, step] of group.fields) {
      const row = document.createElement('label');
      row.className = 'tuning-row';
      const caption = document.createElement('span');
      const name = document.createElement('span');
      name.textContent = title;
      const note = document.createElement('small');
      note.textContent = description;
      caption.appendChild(name);
      caption.appendChild(note);
      if (key === 'gravityReductionPercent') {
        gravityReadout = document.createElement('small');
        gravityReadout.setAttribute('id', 'effective-gravity');
        gravityReadout.textContent = 'EFFECTIVE GRAVITY ' + (100 * session.getState().gravityMultiplier).toFixed(2) + '%';
        caption.appendChild(gravityReadout);
      }
      const input = document.createElement('input');
      input.type = 'number';
      input.min = min;
      input.max = max;
      input.step = step;
      input.value = Number(group.values[key].toFixed(6));
      input.title = key;
      const original = factoryDefaults[groupIndex][key];
      const commit = () => {
        const value = Number(input.value);
        if (input.value.trim() === '' || !validTuningValue(value, min, max, step)) return false;
        if (key === 'threshold' && ((group.values === UNLOCK && value >= FINISH.threshold) || (group.values === FINISH && value <= UNLOCK.threshold))) return false;
        if (!paused) advanceTo(typeof performance !== 'undefined' ? performance.now() : 0);
        group.values[key] = value;
        if (group.values !== DATASET) refreshTuning(group.values === FINISH);
        return true;
      };
      input.addEventListener('input', commit);
      input.addEventListener('change', () => { if (!commit()) input.value = Number(group.values[key].toFixed(6)); });
      row.appendChild(caption);
      row.appendChild(input);
      fieldset.appendChild(row);
      tuningInputs.push({ input, values: group.values, key, original });
    }
    el('tuning-fields').appendChild(fieldset);
  }
  el('tune')?.addEventListener('click', () => setTuningOpen(el('tuning-panel').hidden));
  el('tuning-close')?.addEventListener('click', () => { setTuningOpen(false); el('tune')?.focus(); });
  el('tuning-save')?.addEventListener('click', () => {
    const saved = Object.fromEntries(SETTINGS.map(group => [group.name,
      Object.fromEntries(group.fields.map(([key]) => [key, group.values[key]]))]));
    try {
      localStorage.setItem(DEFAULTS_STORAGE_KEY, JSON.stringify(saved));
      if (el('tuning-save')) el('tuning-save').textContent = 'DEFAULTS SAVED ✓';
    } catch {
      if (el('tuning-save')) el('tuning-save').textContent = 'SAVE UNAVAILABLE';
    }
  });
  el('tuning-defaults')?.addEventListener('click', () => {
    for (const { input, values, key, original } of tuningInputs) {
      values[key] = original;
      input.value = Number(values[key].toFixed(6));
    }
    try {
      localStorage.removeItem(DEFAULTS_STORAGE_KEY);
      if (el('tuning-save')) el('tuning-save').textContent = 'SAVE AS DEFAULTS';
    } catch {
      if (el('tuning-save')) el('tuning-save').textContent = 'STORAGE UNAVAILABLE';
    }
    refreshTuning(true);
  });
}
function buildCompletionScreen() {
  el('completion-again')?.addEventListener('click', reset);
  el('completion-review')?.addEventListener('click', () => {
    el('completion-screen')?.close();
    el('reset')?.focus();
  });
}

// =========================================================================
// MUSICAL LAYER & DIAGNOSTICS (FP-020 & FP-021)
// Completely decoupled from physics:
// - Observes sessionState.selectedIndex
// - Handles Audio / Metronome / MIDI
// - Evaluates accuracy (first try vs after mistakes)
// - Applies reward to session.applyReward(selectedIndex, magnitude)
// - Stationary foreground overlay (never moves vertically)
// =========================================================================

const sharpNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const noteName = pitch => sharpNames[pitch % 12] + (Math.floor(pitch / 12) - 1);
const targetPitches = [60, 62, 64]; // C4, D4, E4
const tempoBpm = 80;
const beatSeconds = 60 / tempoBpm;
const noteSeconds = 0.65;

let audio = null;
let activeSounds = new Set();
let metronomeTimer = null;
let presentationRunning = false;
let presentationListeningAt = Infinity;
let presentationPlaybackEnd = Infinity;
let presentationProgress = 0;
let presentationMatchEvents = [];
let presentationComplete = false;
let attemptResetTimer = null;
let activeAttempt = null;
let totalLifts = 0;

let rollStartedAt = 0;
let rollStoppedAt = 0;
let rollNotes = [];
const rollHeld = new Map();
let rollZoomSeconds = 8;

let midiAccess = null;
let activeInput = null;
let midiConnecting = false;

async function prepareAudio() {
  if (typeof window === 'undefined') return null;
  if (!audio) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) audio = new AudioContextClass();
  }
  if (audio && audio.state === 'suspended') {
    await audio.resume();
  }
  return audio;
}

function sound(when, frequency, duration, volume = 0.14, piano = false, timbre = 'sine') {
  if (!audio) return [];
  const harmonics = timbre === 'bell' ? [1, 0.23] : timbre === 'warm' ? [1, 0.16] : piano ? [1, 0.22, 0.07] : [1];
  const oscillators = [];
  harmonics.forEach((strength, index) => {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'sine';
    osc.frequency.value = frequency * (timbre === 'bell' && index === 1 ? 2.71 : index + 1);

    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(
      volume * strength,
      when + (timbre === 'bell' ? 0.003 : timbre === 'warm' ? 0.018 : piano ? 0.005 : 0.008)
    );
    if (piano) gain.gain.exponentialRampToValueAtTime(volume * strength * 0.38, when + 0.16);
    if (timbre === 'warm') gain.gain.exponentialRampToValueAtTime(volume * strength * 0.45, when + 0.18);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);

    osc.connect(gain).connect(audio.destination);
    osc.start(when);
    osc.stop(when + duration + 0.02);

    activeSounds.add(osc);
    osc.onended = () => activeSounds.delete(osc);
    oscillators.push(osc);
  });
  return oscillators;
}

function stopAllAudio() {
  if (metronomeTimer) clearInterval(metronomeTimer);
  metronomeTimer = null;
  if (audio) {
    for (const osc of activeSounds) {
      try { osc.stop(audio.currentTime); } catch {}
    }
  }
  activeSounds.clear();
}

function playCompletionChime() {
  if (!audio || audio.state !== 'running') return;
  const now = audio.currentTime + 0.01;
  sound(now, 523.25, 0.3, 0.05, false, 'warm');
  sound(now + 0.18, 659.25, 0.4, 0.05, false, 'warm');
}

function initAttempt() {
  presentationProgress = 0;
  presentationMatchEvents = [];
  presentationComplete = false;
  if (attemptResetTimer) clearTimeout(attemptResetTimer);
  attemptResetTimer = null;

  rollStartedAt = typeof performance !== 'undefined' ? performance.now() : 0;
  rollStoppedAt = 0;
  rollNotes = [];
  rollHeld.clear();

  activeAttempt = {
    timeUnit: 'milliseconds',
    timeReference: 'Monotonic performance.now() elapsed since Start',
    startedAtMs: 0,
    completedAtMs: null,
    stoppedAtMs: null,
    targetPitches: [...targetPitches],
    tempoBpm,
    beatDurationMs: beatSeconds * 1000,
    audioPromptEnabled: el('play-audio')?.checked ?? true,
    metronomeEnabled: el('play-metronome')?.checked ?? true,
    promptNotes: [],
    promptEndMs: null,
    metronomeBeatOriginMs: null,
    preparationBeatMs: null,
    intendedEntryMs: null,
    replays: [],
    midiEvents: [],
    matchedMidiEvents: []
  };

  updateCardVisuals();
  renderPerformanceMetrics();
  renderTimingDeviation();
  renderNoteDuration();
  drawPianoRoll();
}

async function startDemoPlayback() {
  stopAllAudio();
  initAttempt();

  const playAudio = el('play-audio')?.checked ?? true;
  const playMetronome = el('play-metronome')?.checked ?? true;

  presentationRunning = true;
  if (el('card-badge')) {
    el('card-badge').className = 'card-badge';
    el('card-badge').textContent = 'Listening…';
  }
  if (el('card-feedback')) el('card-feedback').textContent = 'Listen to phrase C4 D4 E4, then play it';

  if (!playAudio && !playMetronome) {
    activeAttempt.metronomeBeatOriginMs = 0;
    activeAttempt.preparationBeatMs = 3 * activeAttempt.beatDurationMs;
    activeAttempt.intendedEntryMs = 4 * activeAttempt.beatDurationMs;
    presentationListeningAt = 0;
    presentationPlaybackEnd = 0;
    return;
  }

  try {
    await prepareAudio();
    if (!audio) return;
    const startTime = audio.currentTime + 0.1;
    const scheduledStartMs = performance.now() - rollStartedAt + (startTime - audio.currentTime) * 1000;

    activeAttempt.metronomeBeatOriginMs = scheduledStartMs;
    activeAttempt.preparationBeatMs = scheduledStartMs + 3 * activeAttempt.beatDurationMs;
    activeAttempt.intendedEntryMs = scheduledStartMs + 4 * activeAttempt.beatDurationMs;

    if (playAudio) {
      const promptNotes = targetPitches.map((pitch, index) => ({
        pitch,
        timeMs: scheduledStartMs + index * beatSeconds * 1000,
        durationMs: noteSeconds * 1000
      }));
      activeAttempt.promptNotes = promptNotes;

      for (const [index, pitch] of targetPitches.entries()) {
        const freq = 440 * (2 ** ((pitch - 69) / 12));
        sound(startTime + index * beatSeconds, freq, noteSeconds, 0.14, true);
      }
      presentationPlaybackEnd = startTime + (targetPitches.length - 1) * beatSeconds + noteSeconds;
      activeAttempt.promptEndMs = scheduledStartMs + 2 * activeAttempt.beatDurationMs + noteSeconds * 1000;
      presentationListeningAt = presentationPlaybackEnd;
    } else {
      presentationListeningAt = 0;
      presentationPlaybackEnd = 0;
    }

    if (playMetronome) {
      let nextClick = startTime;
      const scheduleClicks = () => {
        while (nextClick < audio.currentTime - 0.01) nextClick += beatSeconds;
        while (nextClick < audio.currentTime + 0.15) {
          sound(nextClick, 1760, 0.06, 0.035, false, 'bell');
          nextClick += beatSeconds;
        }
      };
      scheduleClicks();
      metronomeTimer = setInterval(scheduleClicks, 50);
    }
  } catch (err) {
    presentationListeningAt = 0;
    presentationPlaybackEnd = 0;
    if (el('card-feedback')) el('card-feedback').textContent = `Audio unavailable (${err.message}); you can still play via MIDI.`;
  }
}

function recordPianoRollEvent(noteOn, pitch, velocity, channel) {
  if (!activeAttempt) return null;
  const timeMs = Math.max(0, (typeof performance !== 'undefined' ? performance.now() : 0) - rollStartedAt);
  const time = timeMs / 1000;
  const event = { type: noteOn ? 'noteOn' : 'noteOff', pitch, velocity, channel, timeMs };
  activeAttempt.midiEvents.push(event);

  const key = `${channel}:${pitch}`;
  if (noteOn) {
    const note = { pitch, start: time, end: null };
    rollNotes.push(note);
    if (!rollHeld.has(key)) rollHeld.set(key, []);
    rollHeld.get(key).push(note);
  } else {
    const held = rollHeld.get(key);
    if (held?.length) held.shift().end = time;
    if (held?.length === 0) rollHeld.delete(key);
  }

  drawPianoRoll();
  return event;
}

function handleMidiNote(noteOn, pitch, velocity, channel = 0) {
  const event = recordPianoRollEvent(noteOn, pitch, velocity, channel);
  if (!event || presentationComplete) return;

  if (noteOn) {
    if (pitch === targetPitches[presentationProgress]) {
      presentationProgress++;
      presentationMatchEvents.push(event);
    } else if (pitch === targetPitches[0]) {
      presentationProgress = 1;
      presentationMatchEvents = [event];
    } else {
      presentationProgress = 0;
      presentationMatchEvents = [];
    }

    updateCardVisuals();
    renderPerformanceMetrics();
    renderTimingDeviation();

    if (presentationProgress === targetPitches.length) {
      presentationComplete = true;
      activeAttempt.completedAtMs = event.timeMs;
      activeAttempt.matchedMidiEvents = [...presentationMatchEvents];

      const noteOns = activeAttempt.midiEvents.filter(e => e.type === 'noteOn');
      const extraNotes = Math.max(0, noteOns.length - targetPitches.length);
      const isFirstTry = extraNotes === 0;
      const rewardMagnitude = isFirstTry ? 1.0 : 0.5;

      const targetIndex = sessionState ? sessionState.selectedIndex : selectedIndex;
      let rewardResult = null;
      if (targetIndex >= 0 && !paused && !sessionComplete) {
        advanceTo(typeof performance !== 'undefined' ? performance.now() : 0);
        recordObservation();
        const result = session.applyReward(targetIndex, rewardMagnitude);
        if (result) {
          rewardResult = result;
          wordFlashes[targetIndex] = 1;
          totalLifts++;
          lastMeasurement = result;
          kickGraphEnded = true;
          acceptTransition(result);
          progressValue = overallProgress();
          recordObservation();
          updateReadouts();
          render(0);
          checkCompletion();
        }
      }

      playCompletionChime();

      const card = el('musical-card-overlay');
      if (card) {
        card.classList.remove('celebrate-full', 'celebrate-half');
        void card.offsetWidth;
        card.classList.add(isFirstTry ? 'celebrate-full' : 'celebrate-half');
      }

      const liftAmount = rewardResult ? rewardResult.lift : 0;
      const liftText = `+${liftAmount.toFixed(1)}%`;

      if (el('card-badge')) {
        el('card-badge').className = `card-badge ${isFirstTry ? 'first-try' : 'completed'}`;
        el('card-badge').textContent = isFirstTry
          ? `First Try! Full Lift (${liftText})`
          : `Completed! Half Lift (${liftText})`;
      }
      if (el('card-feedback')) {
        el('card-feedback').textContent = isFirstTry
          ? `Flawless! Slot ${String(targetIndex + 1).padStart(2, '0')} lifted (${liftText}).`
          : `Completed with ${extraNotes} extra note${extraNotes === 1 ? '' : 's'}. Slot ${String(targetIndex + 1).padStart(2, '0')} lifted (${liftText}).`;
      }

      renderPerformanceMetrics();
      renderTimingDeviation();
      renderNoteDuration();

      attemptResetTimer = setTimeout(() => {
        if (!paused && !sessionComplete) {
          initAttempt();
          if (el('card-feedback')) el('card-feedback').textContent = 'Phrase ready · play C4 D4 E4 on MIDI to lift';
          if (el('card-badge')) {
            el('card-badge').className = 'card-badge';
            el('card-badge').textContent = 'Ready';
          }
        }
      }, 1200);
    }
  }

  renderNoteDuration();
}

function updateCardVisuals() {
  for (let i = 0; i < targetPitches.length; i++) {
    const isMatched = i < presentationProgress;
    const noteHead = el(`note-head-${i}`);
    const letter = el(`letter-${i}`);
    if (noteHead) noteHead.classList.toggle('matched', isMatched);
    if (letter) letter.classList.toggle('matched', isMatched);
  }
}

async function connectMidi() {
  if (midiConnecting || typeof navigator === 'undefined') return;
  midiConnecting = true;
  if (el('device')) el('device').textContent = 'Requesting MIDI…';
  if (el('connect')) el('connect').disabled = true;

  if (!navigator.requestMIDIAccess) {
    if (el('device')) el('device').textContent = 'Web MIDI not supported (use keys 1, 2, 3)';
    if (el('connect')) el('connect').disabled = false;
    midiConnecting = false;
    return;
  }

  try {
    midiAccess = await navigator.requestMIDIAccess();
    midiAccess.onstatechange = updateMidiInputs;
    updateMidiInputs();
  } catch (error) {
    if (el('device')) el('device').textContent = `MIDI access failed: ${error.message || error.name}`;
  } finally {
    if (el('connect')) el('connect').disabled = false;
    midiConnecting = false;
  }
}

function updateMidiInputs() {
  if (!midiAccess) return;
  const inputs = [...midiAccess.inputs.values()].filter(p => p.state === 'connected');
  const picker = el('inputs');
  if (picker) {
    picker.replaceChildren(...inputs.map(port => {
      const option = document.createElement('option');
      option.value = port.id;
      option.textContent = port.name || 'MIDI Input';
      return option;
    }));
    picker.hidden = inputs.length < 2;
  }

  if (inputs.length > 0) {
    const preferred = inputs.find(p => /minilab/i.test(p.name || '')) || inputs[0];
    selectMidiInput(preferred.id);
  } else {
    activeInput = null;
    if (el('device')) el('device').textContent = 'No keyboard connected';
  }
}

async function selectMidiInput(id) {
  if (activeInput) activeInput.onmidimessage = null;
  activeInput = midiAccess?.inputs.get(id) || null;
  if (activeInput) {
    try {
      await activeInput.open();
      activeInput.onmidimessage = event => {
        const [status, pitch, velocity] = event.data;
        const type = status & 0xf0;
        const noteOn = type === 0x90 && velocity > 0;
        const noteOff = type === 0x80 || (type === 0x90 && velocity === 0);
        if (noteOn || noteOff) {
          handleMidiNote(noteOn, pitch, velocity, status & 0x0f);
        }
      };
      if (el('device')) el('device').textContent = activeInput.name || 'Connected';
    } catch (err) {
      if (el('device')) el('device').textContent = `Input error: ${err.message}`;
    }
  }
}

function formatSignedMs(value) {
  const rounded = Math.round(value);
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${Math.abs(rounded)} ms`;
}

function drawPianoRoll() {
  const canvas = el('piano-roll');
  if (!canvas) return;
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return;

  const { width, height } = canvas;
  const left = 48, top = 25, rowHeight = 8, secondsVisible = rollZoomSeconds;
  const elapsed = rollStartedAt ? (((typeof performance !== 'undefined' ? performance.now() : 0) - rollStartedAt) / 1000) : 0;
  const viewStart = Math.max(0, elapsed - secondsVisible);
  const pixelsPerSecond = (width - left - 10) / secondsVisible;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, width, height);
  ctx.font = '10px system-ui, sans-serif';
  ctx.textBaseline = 'middle';

  for (let pitch = 48; pitch <= 72; pitch++) {
    const y = top + (72 - pitch) * rowHeight;
    ctx.fillStyle = pitch % 12 === 0 ? '#e2e8f0' : pitch % 12 === 5 ? '#edf2f7' : '#f8fafc';
    ctx.fillRect(left, y, width - left, rowHeight);
    ctx.fillStyle = '#475569';
    if (pitch % 12 === 0) ctx.fillText(noteName(pitch), 8, y + rowHeight / 2);
  }

  ctx.strokeStyle = '#94a3b8';
  ctx.beginPath(); ctx.moveTo(left, top); ctx.lineTo(left, height - 15); ctx.stroke();
  for (let second = Math.ceil(viewStart); second <= viewStart + secondsVisible; second++) {
    const x = left + (second - viewStart) * pixelsPerSecond;
    ctx.strokeStyle = '#cbd5e1';
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, height - 15); ctx.stroke();
    ctx.fillStyle = '#64748b';
    ctx.fillText(`${second}s`, x + 3, 12);
  }

  if (activeAttempt?.metronomeBeatOriginMs != null) {
    const beatOrigin = activeAttempt.metronomeBeatOriginMs / 1000;
    const beatSec = activeAttempt.beatDurationMs / 1000;
    for (let beat = Math.max(0, Math.ceil((viewStart - beatOrigin) / beatSec));
      beatOrigin + beat * beatSec <= Math.min(viewStart + secondsVisible, elapsed); beat++) {
      const x = left + (beatOrigin + beat * beatSec - viewStart) * pixelsPerSecond;
      ctx.strokeStyle = beat === 4 ? '#334155' : '#cbd5e1';
      ctx.lineWidth = beat === 4 ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, height - 15); ctx.stroke();
      ctx.lineWidth = 1;
      if (beat === 4) {
        ctx.fillStyle = '#1e293b';
        ctx.fillText('ENTRY', Math.min(x + 4, width - 45), 12);
      }
    }

    for (const [index, pitch] of activeAttempt.targetPitches.entries()) {
      const start = Math.max(activeAttempt.intendedEntryMs / 1000 + index * beatSec, viewStart);
      const end = Math.min(activeAttempt.intendedEntryMs / 1000 + index * beatSec + noteSeconds, viewStart + secondsVisible);
      if (end > start) {
        ctx.fillStyle = '#3b82f6';
        ctx.fillRect(left + (start - viewStart) * pixelsPerSecond, top + (72 - pitch) * rowHeight + 1,
          Math.max(2, (end - start) * pixelsPerSecond), rowHeight - 2);
      }
    }
  }

  const noteEnd = elapsed;
  for (const note of rollNotes) {
    const start = Math.max(note.start, viewStart);
    const end = Math.min(note.end ?? noteEnd, viewStart + secondsVisible);
    if (end <= start) continue;
    ctx.fillStyle = '#ea580c';
    ctx.fillRect(left + (start - viewStart) * pixelsPerSecond, top + (72 - note.pitch) * rowHeight + 1,
      Math.max(2, (end - start) * pixelsPerSecond), rowHeight - 2);
  }
}

function renderPerformanceMetrics() {
  const attempt = activeAttempt;
  if (!attempt) return;
  const noteOns = attempt.midiEvents.filter(e => e.type === 'noteOn');
  const extra = Math.max(0, noteOns.length - presentationProgress);

  if (el('dashboard-state')) {
    el('dashboard-state').textContent = presentationComplete ? 'Completed' : presentationRunning ? 'In Progress' : 'Awaiting Attempt';
  }

  const strip = el('pitch-sequence');
  if (strip) {
    strip.replaceChildren(...noteOns.map(event => {
      const chip = document.createElement('span');
      chip.textContent = `${noteName(event.pitch)}${attempt.matchedMidiEvents.includes(event) ? ' ✓' : ''}`;
      if (attempt.matchedMidiEvents.includes(event)) chip.className = 'matched';
      else if (presentationMatchEvents.includes(event)) chip.className = 'candidate';
      return chip;
    }));
    if (!noteOns.length) strip.textContent = 'Play C4 D4 E4';
  }

  if (el('pitch-progress')) el('pitch-progress').textContent = `${presentationProgress}/3${presentationComplete ? ' — Correct' : ''}`;
  if (el('pitch-extra')) el('pitch-extra').textContent = `${extra} extra/wrong note${extra === 1 ? '' : 's'}`;
  if (el('first-try-badge')) el('first-try-badge').hidden = !(presentationComplete && extra === 0);

  const entry = noteOns.length && Number.isFinite(attempt.intendedEntryMs) ? noteOns[0].timeMs - attempt.intendedEntryMs : null;
  const marker = el('entry-marker');
  if (marker) marker.hidden = entry === null;
  let position = 50;
  if (entry !== null) {
    const scaled = Math.asinh(entry / 100) / Math.asinh(20);
    position = 50 + 45 * Math.max(-1, Math.min(1, scaled));
    if (marker) marker.style.left = `${position}%`;
  }
  el('entry-track')?.style?.setProperty?.('--entry-left', `${position}%`);
  if (el('entry-value')) el('entry-value').textContent = entry === null ? 'Awaiting first note' : formatSignedMs(entry);

  const sequence = presentationMatchEvents;
  const beat = attempt.beatDurationMs;
  const offsets = sequence.map(event => event.timeMs - sequence[0].timeMs);
  const maxTime = Math.max(2 * beat, ...offsets, 1);
  const x = time => 65 + time / maxTime * 470;
  const intervals = [0, 1].map(index => sequence[index + 1] ? sequence[index + 1].timeMs - sequence[index].timeMs : null);
  const labelX = (index, time) => index ? Math.max(355, Math.min(470, x(time))) : Math.max(140, Math.min(245, x(time)));

  if (el('rhythm-timeline')) {
    el('rhythm-timeline').innerHTML = `<line x1="${x(0)}" y1="35" x2="${x(2 * beat)}" y2="35" stroke="#2563eb" stroke-width="2"/>
      ${offsets.slice(1).map((time, index) => `<line x1="${x(offsets[index])}" y1="115" x2="${x(time)}" y2="115" stroke="#ea580c" stroke-width="2"/>`).join('')}
      <text x="5" y="39" fill="#2563eb" font-size="12">Target</text><text x="5" y="119" fill="#ea580c" font-size="12">Played</text>
      ${['C4', 'D4', 'E4'].map((name, index) => `<circle cx="${x(index * beat)}" cy="35" r="6" fill="#2563eb"/><text x="${x(index * beat)}" y="20" text-anchor="middle" fill="#94a3b8" font-size="11">${name}</text>`).join('')}
      ${offsets.map((time, index) => `<circle cx="${x(time)}" cy="115" r="6" fill="#ea580c"/><text x="${x(time)}" y="140" text-anchor="middle" fill="#94a3b8" font-size="11">${['C4', 'D4', 'E4'][index]}</text>`).join('')}
      ${[0, 1].map(index => `<text x="${labelX(index, (index + 0.5) * beat)}" y="57" text-anchor="middle" fill="#2563eb" font-size="12">${Math.round(beat)} ms</text>`).join('')}
      ${intervals.map((played, index) => played === null ? '' : `<text x="${labelX(index, (offsets[index] + offsets[index + 1]) / 2)}" y="96" text-anchor="middle" fill="#ea580c" font-size="12">${Math.round(played)} ms</text>
        <text x="${labelX(index, (index + 0.5) * beat)}" y="77" text-anchor="middle" fill="#94a3b8" font-size="12">${formatSignedMs(played - beat)}</text>`).join('')}`;
  }

  const errors = intervals.filter(v => v !== null).map(v => Math.abs(v - beat));
  if (el('rhythm-mean')) {
    el('rhythm-mean').textContent = `Mean error: ${errors.length ? `${Math.round(errors.reduce((sum, v) => sum + v, 0) / errors.length)} ms` : '—'}`;
  }
}

function renderTimingDeviation() {
  const chart = el('timing-deviation');
  if (!chart) return;
  const attempt = activeAttempt;
  const sequence = presentationMatchEvents;
  const errors = attempt && Number.isFinite(attempt.intendedEntryMs)
    ? sequence.map((event, index) => event.timeMs - attempt.intendedEntryMs - index * attempt.beatDurationMs)
    : [];

  const range = Math.max(50, ...errors.map(Math.abs));
  const scale = 55 / range;
  const labels = ['C4', 'D4', 'E4'];

  chart.innerHTML = `<line x1="65" y1="35" x2="65" y2="160" stroke="#94a3b8"/>
    <line x1="65" y1="98" x2="550" y2="98" stroke="#475569" stroke-width="2"/>
    <text x="58" y="47" text-anchor="end" fill="#64748b" font-size="11">+${Math.round(range)} ms</text>
    <text x="58" y="102" text-anchor="end" fill="#64748b" font-size="11">0</text>
    <text x="58" y="157" text-anchor="end" fill="#64748b" font-size="11">−${Math.round(range)} ms</text>
    ${labels.map((label, index) => `<text x="${150 + index * 150}" y="190" text-anchor="middle" fill="#94a3b8" font-size="13">${label}</text>`).join('')}
    ${errors.length ? '' : '<text x="300" y="70" text-anchor="middle" fill="#64748b" font-size="12">Play matching notes to see onset deviations</text>'}
    ${errors.map((error, index) => {
      const x = 110 + index * 150;
      const height = Math.abs(error) * scale;
      const y = error >= 0 ? 98 - height : 98;
      const signed = `${error >= 0 ? '+' : '−'}${Math.round(Math.abs(error))} ms`;
      return `<rect x="${x}" y="${y}" width="80" height="${Math.max(1, height)}" rx="3" fill="#ea580c"/>
        <text x="${x + 40}" y="${error >= 0 ? y - 9 : y + height + 18}" text-anchor="middle" fill="#94a3b8" font-size="12" font-weight="600">${signed}</text>`;
    }).join('')}`;

  if (el('alignment-mean')) {
    el('alignment-mean').textContent = `Mean absolute onset error: ${errors.length ? `${Math.round(errors.reduce((sum, e) => sum + Math.abs(e), 0) / errors.length)} ms` : '—'}`;
  }
}

function renderNoteDuration() {
  const attempt = activeAttempt;
  if (!attempt || !el('duration-rows')) return;
  const held = new Map();
  const releases = new Map();
  for (const event of attempt.midiEvents) {
    const key = `${event.channel}:${event.pitch}`;
    if (event.type === 'noteOn') {
      if (!held.has(key)) held.set(key, []);
      held.get(key).push(event);
    } else {
      const on = held.get(key)?.shift();
      if (on) releases.set(on, event);
    }
  }

  const sequence = presentationMatchEvents;
  const names = ['C4', 'D4', 'E4'];
  const played = sequence.map(on => {
    const off = releases.get(on);
    return off ? off.timeMs - on.timeMs : null;
  });

  const differences = sequence.map((on, index) => {
    const reference = attempt.promptNotes[index]?.durationMs;
    return played[index] !== null && Number.isFinite(reference) ? played[index] - reference : null;
  });
  const completed = differences.filter(Number.isFinite);
  const maxDuration = Math.max(1, ...attempt.promptNotes.map(n => n.durationMs), ...played.filter(Number.isFinite));

  el('duration-rows').innerHTML = names.map((name, index) => {
    const on = sequence[index];
    const reference = attempt.promptNotes[index]?.durationMs;
    const actual = played[index];
    const detail = !on ? '—' : actual === null ? 'Held · incomplete'
      : Number.isFinite(reference) ? `Demo ${Math.round(reference)}ms · Played ${Math.round(actual)}ms · ${formatSignedMs(differences[index])}`
        : `Played ${Math.round(actual)}ms`;
    return `<div class="duration-row"><b>${name}</b><div class="duration-bars">
      ${Number.isFinite(reference) ? `<span class="duration-reference" style="width:${reference / maxDuration * 100}%"></span>` : ''}
      ${actual != null ? `<span class="duration-actual" style="width:${actual / maxDuration * 100}%"></span>` : ''}
      </div><em>${detail}</em></div>`;
  }).join('');

  if (el('duration-mean')) {
    el('duration-mean').textContent = `Mean absolute duration error: ${completed.length ? `${Math.round(completed.reduce((s, v) => s + Math.abs(v), 0) / completed.length)} ms` : '—'}`;
  }

  if (el('articulation-values')) {
    el('articulation-values').textContent = ['C4→D4', 'D4→E4'].map((label, index) => {
      const off = presentationComplete && releases.get(sequence[index]);
      if (!off) return `${label} —`;
      const gap = sequence[index + 1].timeMs - off.timeMs;
      return `${label} ${formatSignedMs(gap)} ${gap > 0 ? 'gap' : gap < 0 ? 'overlap' : 'touch'}`;
    }).join(' · ');
  }
}

async function copyAttemptJson() {
  if (!activeAttempt || typeof navigator === 'undefined' || !navigator.clipboard) return;
  try {
    const rounded = (key, val) => key.endsWith('Ms') && Number.isFinite(val) ? Math.round(val * 10) / 10 : val;
    await navigator.clipboard.writeText(JSON.stringify({ schemaVersion: 1, ...activeAttempt }, rounded, 2));
    if (el('json-status')) {
      el('json-status').textContent = 'JSON copied ✓';
      setTimeout(() => { if (el('json-status')) el('json-status').textContent = ''; }, 2500);
    }
  } catch (err) {
    if (el('json-status')) el('json-status').textContent = `Copy failed: ${err.message}`;
  }
}

// Attach UI events
if (typeof document !== 'undefined') {
  el('play-demo')?.addEventListener('click', startDemoPlayback);
  el('card-demo-btn')?.addEventListener('click', startDemoPlayback);
  el('connect')?.addEventListener('click', connectMidi);
  el('inputs')?.addEventListener('change', e => selectMidiInput(e.target.value));
  el('copy-attempt-json')?.addEventListener('click', copyAttemptJson);
  el('roll-zoom')?.addEventListener('input', e => {
    rollZoomSeconds = Number(e.target.value);
    if (el('roll-zoom-value')) el('roll-zoom-value').textContent = `${rollZoomSeconds} s`;
    drawPianoRoll();
  });

  el('letter-0')?.addEventListener('click', () => handleMidiNote(true, 60, 90));
  el('letter-1')?.addEventListener('click', () => handleMidiNote(true, 62, 90));
  el('letter-2')?.addEventListener('click', () => handleMidiNote(true, 64, 90));
}

// Initial system boots
loadTuningDefaults();
reset();
buildTuning();
buildCompletionScreen();
connectMidi();
scheduleFrame();
