'use strict';

const FallingFieldModule = typeof FallingField !== 'undefined' ? FallingField : (typeof require === 'function' ? require('./field.js') : null);
const VocabularyViewModule = typeof VocabularyView !== 'undefined' ? VocabularyView : (typeof require === 'function' ? require('./vocabulary-view.js') : null);
const MusicalViewModule = typeof MusicalView !== 'undefined' ? MusicalView : (typeof require === 'function' ? require('./musical-view.js') : null);

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
  field.resetHistory();
  vocabularyView.reset();
  musicalView.resetCardVisuals();
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
    vocabularyView.endKickGraph();
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
    vocabularyView.endKickGraph();
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

  const target = words[selected];
  vocabularyView.renderPrompt({
    target,
    selectedIndex: selected,
    promptState: sessionState
  }, dt);
  kickGraphEnded = vocabularyView.isKickGraphEnded();

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

      musicalView.showRewardFeedback({
        isFirstTry,
        extraNotes,
        targetIndex,
        rewardResult
      });
      musicalView.renderAllDiagnostics({
        activeAttempt,
        presentationProgress,
        presentationComplete,
        presentationMatchEvents
      });

      if (typeof setTimeout === 'function') {
        attemptResetTimer = setTimeout(() => {
          if (!paused && !sessionComplete) {
            initAttempt();
            musicalView.resetCardVisuals();
          }
        }, 1200);
      }
    }
  }

  renderNoteDuration();
}

function updateCardVisuals() {
  musicalView.updateCardVisuals(presentationProgress, targetPitches);
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
  musicalView.drawPianoRoll({
    rollNotes,
    rollStartedAt,
    rollZoomSeconds,
    activeAttempt,
    noteSeconds
  });
}

function renderPerformanceMetrics() {
  musicalView.renderPerformanceMetrics({
    activeAttempt,
    presentationProgress,
    presentationComplete,
    presentationMatchEvents
  });
}

function renderTimingDeviation() {
  musicalView.renderTimingDeviation({
    activeAttempt,
    presentationMatchEvents
  });
}

function renderNoteDuration() {
  musicalView.renderNoteDuration({
    activeAttempt,
    presentationMatchEvents,
    presentationComplete
  });
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
