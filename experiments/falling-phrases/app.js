'use strict';

const FallingFieldModule = typeof FallingField !== 'undefined' ? FallingField : (typeof require === 'function' ? require('./field.js') : null);
const VocabularyViewModule = typeof VocabularyView !== 'undefined' ? VocabularyView : (typeof require === 'function' ? require('./vocabulary-view.js') : null);
const MusicalViewModule = typeof MusicalView !== 'undefined' ? MusicalView : (typeof require === 'function' ? require('./musical-view.js') : null);
const VocabularyAppModule = typeof VocabularyApp !== 'undefined' ? VocabularyApp : (typeof require === 'function' ? require('./app-vocabulary.js') : null);
const MusicalAppModule = typeof MusicalApp !== 'undefined' ? MusicalApp : (typeof require === 'function' ? require('./app-music.js') : null);

if (!FallingFieldModule || !VocabularyViewModule || !MusicalViewModule) {
  throw new Error('FallingField, VocabularyView, and MusicalView modules are required.');
}

const field = FallingFieldModule.createField({
  chartId: 'chart',
  gridId: 'grid',
  barsId: 'bars',
  labelsId: 'labels',
  traceId: 'trace',
  traceLiveId: 'trace-live',
  tracePercentageId: 'trace-percentage',
  scoreId: 'score'
});

const vocabularyView = VocabularyViewModule.createVocabularyView();
const musicalView = MusicalViewModule.createMusicalView();

// SVG coordinates are rendering only; engine positions are percentages.
const TUNE = field.TUNE;
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
const COLOR = field.COLOR;
const HINT_SECONDS = 2;
const latencyMultiplier = t => 0.5 + 1.5 * Math.exp(-1.5 * Math.max(0, t));
const VOCABULARY = VocabularyAppModule?.VOCABULARY || [
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
const screenY = position => field.screenY(position);
const motionPreference = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
let words, observations, progressValue, count, paused = false;
let lastTime = null, lastMeasurement = null;
let activeTime = 0, nextSampleTime = PROGRESS.sampleSeconds;
let observationTimes = [];
const nodes = field.nodes;
let animationFrame = null;
let historyPath = '', historyLength = 0;

const { setAttribute, setText, toggleClass, svgNode } = FallingFieldModule;

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
    english: VOCABULARY[i]?.[0] || (activeApp ? activeApp.getCardLabel(i) : `Phrase ${i + 1}`),
    spanish: VOCABULARY[i]?.[1] || 'C4 D4 E4'
  }));
  activeTime = state.time;
  paused = state.paused;
  sessionComplete = state.complete;
  selectedIndex = state.selectedIndex;
  count = state.rewardCount ?? 0;
  progressValue = session.getProgress();
}

function acceptTransition(result) {
  if (result && result.unlockedIndex !== null && result.unlockedIndex !== undefined) pendingUnlock = true;
  syncSession();
}

// Coordinator passed to application modules
const coordinator = {
  get session() { return session; },
  isPaused: () => paused,
  isComplete: () => sessionComplete,
  getTime: () => typeof performance !== 'undefined' ? performance.now() : 0,
  advanceTo,
  recordObservation,
  acceptTransition,
  updateReadouts,
  render,
  checkCompletion,
  setWordFlash: (i, v) => { wordFlashes[i] = v; },
  setLastMeasurement: m => { lastMeasurement = m; },
  setKickGraphEnded: ended => { kickGraphEnded = ended; },
  getWords: () => words
};

let vocabularyApp = null;
let musicalApp = null;
let activeApp = null;

if (VocabularyAppModule) {
  vocabularyApp = VocabularyAppModule.createVocabularyApp({
    coordinator,
    vocabularyView,
    el
  });
}
if (MusicalAppModule) {
  musicalApp = MusicalAppModule.createMusicalApp({
    coordinator,
    musicalView,
    el
  });
}

function getInitialAppMode() {
  if (typeof window !== 'undefined' && window.location) {
    const params = new URLSearchParams(window.location.search);
    if (params.has('mode')) return params.get('mode');
    if (params.has('app')) return params.get('app');
    if (window.location.pathname.includes('vocabulary')) return 'vocabulary';
    if (window.location.pathname.includes('music')) return 'music';
  }
  if (typeof document !== 'undefined') {
    if (document.body?.dataset?.app) return document.body.dataset.app;
    if (document.documentElement?.dataset?.app) return document.documentElement.dataset.app;
  }
  if (typeof globalThis !== 'undefined' && globalThis.__APP_MODE__) {
    return globalThis.__APP_MODE__;
  }
  return 'vocabulary';
}

function setAppMode(mode) {
  if (activeApp) {
    activeApp.detach?.();
  }
  if (mode === 'music' && musicalApp) {
    activeApp = musicalApp;
  } else if (vocabularyApp) {
    activeApp = vocabularyApp;
  } else {
    activeApp = musicalApp;
  }
  if (activeApp) {
    activeApp.attach();
  }
  if (session) {
    syncSession();
    render(0);
  }
}

function reset() {
  session = MunduPhysics.createSession({
    cardCount: DATASET.totalWords,
    config: physicsConfig()
  });
  sessionState = session.getState();
  wordFlashes = new Array(DATASET.totalWords).fill(0);
  selectedIndex = 0;
  pendingUnlock = false;
  completionPresented = false;
  kickGraphEnded = false;
  observations = [0];
  observationTimes = [0];
  nextSampleTime = PROGRESS.sampleSeconds;
  historyPath = '';
  historyLength = 0;
  field.resetHistory();
  if (activeApp) {
    activeApp.reset();
  }
  progressValue = 0;
  lastMeasurement = null;
  syncSession();
  buildSvg();
  lastTime = typeof performance !== 'undefined' ? performance.now() : 0;
  updateStatus();
  render(0);
  updateReadouts();
  scheduleFrame();
}

function retrieve(skipped = false) {
  if (activeApp && activeApp.retrieve) {
    activeApp.retrieve(skipped);
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
  field.updateTraceStroke();
}

function buildSvg() {
  field.build(words, {
    unlockThreshold: UNLOCK.threshold,
    finishThreshold: FINISH.threshold,
    unlockLabel: 'NEW WORDS',
    finishLabel: 'COMPLETION'
  });
}

function wordAboveFinish(word) {
  return MunduPhysics.isAboveFinish ? MunduPhysics.isAboveFinish(word, FINISH.threshold) : (word.depth >= FINISH.threshold);
}

function renderKickGraph(state, dt) {
  vocabularyView.renderKickGraph(state, dt);
  kickGraphEnded = vocabularyView.isKickGraphEnded();
}

function render(dt) {
  const unlocked = pendingUnlock;
  pendingUnlock = false;
  const selected = sessionState ? sessionState.selectedIndex : selectedIndex;

  const displayCards = words.map((word, i) => ({
    id: word.id,
    index: i,
    depth: word.depth,
    shown: word.shown,
    unlocked: word.unlocked,
    flash: word.flash || 0,
    isComplete: wordAboveFinish(word),
    isSelected: i === selected,
    label: word.english || `Phrase ${i + 1}`
  }));

  progressValue = overallProgress();
  if (unlocked) recordObservation();

  const fieldState = {
    cards: displayCards,
    selectedIndex: selected,
    progress: progressValue,
    activeTime,
    observations,
    observationTimes,
    historyLength,
    historyPath
  };
  field.render(fieldState, dt);
  historyLength = fieldState.historyLength;
  historyPath = fieldState.historyPath;

  if (activeApp) {
    activeApp.render(sessionState, dt);
  }

  const promptState = sessionState;
  if (gravityReadout && promptState) setText(gravityReadout, 'EFFECTIVE GRAVITY ' + (100 * promptState.gravityMultiplier).toFixed(2) + '%');
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
  if (el('prompt')) {
    el('prompt').textContent = sessionComplete
      ? 'ALL PHRASES CLEAR / RESET TO RESTART'
      : paused
        ? 'SESSION PAUSED / RESUME TO RETRIEVE'
        : (activeApp?.name === 'music' ? 'PLAY C4-D4-E4 = RETRIEVE / ESC = SKIP' : 'TYPE SPANISH = RETRIEVE / ESC = SKIP');
  }
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

// Coordinator UI events
if (typeof document !== 'undefined') {
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

// Application facade delegates
function startDemoPlayback() {
  return activeApp?.startDemoPlayback?.();
}
function handleMidiNote(noteOn, pitch, velocity, channel) {
  return activeApp?.handleMidiNote?.(noteOn, pitch, velocity, channel);
}
function drawPianoRoll() {
  // MusicalView draws via activeApp
}
function renderPerformanceMetrics() {}
function renderTimingDeviation() {}
function renderNoteDuration() {}
function connectMidi() {
  return activeApp?.connectMidi?.();
}
function stopAllAudio() {
  activeApp?.stopAllAudio?.();
}

// Boot initial mode and system
setAppMode(getInitialAppMode());
loadTuningDefaults();
reset();
buildTuning();
buildCompletionScreen();
if (activeApp?.name === 'music') {
  connectMidi();
}
scheduleFrame();
