'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('../card-lab/node_modules/typescript');
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
};
class Param {
  value = 1; calls = [];
  setValueAtTime(value, time) { this.value = value; this.calls.push(['set', value, time]); }
  exponentialRampToValueAtTime(value, time) { this.value = value; this.calls.push(['ramp', value, time]); }
  cancelScheduledValues(time) { this.calls.push(['cancel', time]); }
  setTargetAtTime(value, time, duration) { this.calls.push(['target', value, time, duration]); }
}
class Gain {
  gain = new Param();
  connect() { return this; }
  disconnect() {}
}
class Oscillator {
  frequency = { value: 0 }; stops = []; starts = [];
  connect() { return this; }
  disconnect() {}
  start(time) { this.starts.push(time); }
  stop(time) { this.stops.push(time); }
}
class AudioContextMock {
  state = 'running'; currentTime = 1; destination = {}; gains = []; oscillators = [];
  createGain() { const gain = new Gain(); this.gains.push(gain); return gain; }
  createOscillator() { const osc = new Oscillator(); this.oscillators.push(osc); return osc; }
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; }
}
const { createPhrasePlayer } = require('../audio/phrasePlayer.ts');
const { createReplayControl } = require('../cards/replayControl.ts');
function timers() {
  let id = 0; const pending = new Map();
  return { pending, setTimeout(fn) { pending.set(++id, fn); return id; }, clearTimeout(key) { pending.delete(key); } };
}
test('phrase playback schedules even beats and cancels prior voices on replay', () => {
  const audio = new AudioContextMock(), clock = timers(), player = createPhrasePlayer(audio, clock);
  player.play([60, 64, 67], 90, true, false);
  assert.equal(audio.oscillators.length, 9);
  assert.ok(Math.abs(audio.oscillators[3].starts[0] - (1.03 + 60 / 90)) < 1e-9);
  assert.ok(Math.abs(audio.oscillators[6].starts[0] - (1.03 + 120 / 90)) < 1e-9);
  player.play([72, 74], 120, true, false);
  assert.equal(audio.oscillators[0].stops.at(-1), 1);
  assert.ok(Math.abs(audio.oscillators[12].starts[0] - 1.53) < 1e-9);
  player.stop();
  assert.equal(audio.oscillators[9].stops.at(-1), 1);
});
test('metronome shares the beat, toggles independently and cancels stale timers', () => {
  const audio = new AudioContextMock(), clock = timers(), player = createPhrasePlayer(audio, clock);
  player.play([60], 90, true, true);
  assert.equal(audio.oscillators[3].frequency.value, 1600);
  assert.equal(audio.oscillators[3].starts[0], audio.oscillators[0].starts[0]);
  const stale = [...clock.pending.values()][0];
  player.setMetronome(false);
  assert.equal(clock.pending.size, 0);
  assert.equal(audio.oscillators[0].stops.length, 1);
  player.setMetronome(true);
  assert.equal(clock.pending.size, 1);
  stale();
  assert.equal(clock.pending.size, 1);
  player.stopPhrase();
  assert.equal(audio.oscillators[0].stops.at(-1), 1);
  player.stop();
  assert.equal(clock.pending.size, 0);
  const count = audio.oscillators.length;
  player.play([60], 90, false, true);
  assert.equal(audio.oscillators.length, count + 1);
  assert.equal(audio.oscillators.at(-1).frequency.value, 1600);
  player.stop();
});
test('C3 replays and C6 toggles pause once per physical press; both are reserved', () => {
  let replays = 0, pauses = 0; const control = createReplayControl(() => replays++, () => pauses++);
  const event = (type, pitch, channel = 1) => ({ type, pitch, channel });
  for (const pitch of [48, 84]) {
    assert.equal(control.handle(event('note-on', pitch)), true);
    control.handle(event('note-on', pitch)); control.handle(event('note-on', pitch, 2));
    control.handle(event('note-off', pitch)); control.handle(event('note-off', pitch, 2));
    control.handle(event('note-on', pitch));
  }
  assert.equal(replays, 2); assert.equal(pauses, 2);
  assert.equal(control.handle(event('note-on', 60)), false);
  control.reset(); control.handle(event('note-on', 48)); assert.equal(replays, 3);
});

function fakeHooks() {
  const effects = [];
  return { effects, useState(initial) { return [typeof initial === 'function' ? initial() : initial, () => {}]; }, useRef(initial) { return { current: initial }; }, useCallback(callback) { return callback; }, useEffect(callback) { effects.push(callback); } };
}
function importWithHooks(filename, hooks) {
  const original = Module._load;
  Module._load = function(request, parent, isMain) { return request === 'react' ? hooks : original.call(this, request, parent, isMain); };
  try { delete require.cache[require.resolve(filename)]; return require(filename); } finally { Module._load = original; }
}
test('selection waits for interaction, replays, switches exercise and cleans up', () => {
  const hooks = fakeHooks(), listeners = new Map(), stored = new Map(), contexts = [];
  const oldWindow = global.window, oldStorage = global.localStorage;
  class AudioClass extends AudioContextMock { constructor() { super(); contexts.push(this); } }
  global.window = { AudioContext: AudioClass, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  global.localStorage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) };
  try {
    const { usePhrasePlayback } = importWithHooks('../audio/usePhrasePlayback.ts', hooks);
    const playback = usePhrasePlayback(), cleanups = hooks.effects.map(effect => effect());
    playback.setExercise([60, 64, 67]);
    assert.equal(contexts.length, 0);
    listeners.get('pointerdown')();
    const audio = contexts[0];
    assert.equal(audio.oscillators.length, 9);
    playback.replay();
    assert.equal(audio.oscillators.length, 18);
    assert.equal(audio.oscillators[0].stops.at(-1), 1);
    playback.setExercise([62, 65]);
    assert.equal(audio.oscillators.length, 24);
    assert.equal(audio.oscillators[9].stops.at(-1), 1);
    playback.setTempo(120);
    assert.equal(stored.get('piano-trainer.tempo-bpm'), '120');
    playback.setEnabled(false);
    assert.equal(stored.get('piano-trainer.phrase-playback-enabled'), 'false');
    const before = audio.oscillators.length;
    playback.replay();
    assert.equal(audio.oscillators.length, before);
    playback.stop();
    cleanups.forEach(cleanup => cleanup?.());
    assert.equal(audio.state, 'closed');
  } finally { global.window = oldWindow; global.localStorage = oldStorage; }
});

test('ordinary gestures, tempo edits and re-renders do not replay; explicit selection and replay do', () => {
  const hooks = fakeHooks(), listeners = new Map(), contexts = [], stored = new Map();
  const oldWindow = global.window, oldStorage = global.localStorage;
  class AudioClass extends AudioContextMock { constructor() { super(); contexts.push(this); } }
  global.window = { AudioContext: AudioClass, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  global.localStorage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) };
  try {
    const { usePhrasePlayback } = importWithHooks('../audio/usePhrasePlayback.ts', hooks);
    const playback = usePhrasePlayback(), cleanups = hooks.effects.map(effect => effect());
    playback.setExercise([60, 62]); listeners.get('pointerdown')();
    const audio = contexts[0]; assert.equal(audio.oscillators.length, 6);
    listeners.get('pointerdown')(); listeners.get('keydown')();
    playback.setTempo(120); assert.equal(audio.oscillators.length, 6);
    playback.setExercise([60, 62]); assert.equal(audio.oscillators.length, 12); // same-card reselection
    playback.setExercise([64]); assert.equal(audio.oscillators.length, 15);
    playback.replay(); assert.equal(audio.oscillators.length, 18);
    cleanups.forEach(cleanup => cleanup?.());
  } finally { global.window = oldWindow; global.localStorage = oldStorage; }
});

test('independent volumes apply immediately and persist without replaying', () => {
  const hooks = fakeHooks(), listeners = new Map(), contexts = [], stored = new Map();
  const oldWindow = global.window, oldStorage = global.localStorage;
  class AudioClass extends AudioContextMock { constructor() { super(); contexts.push(this); } }
  global.window = { AudioContext: AudioClass, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  global.localStorage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) };
  try {
    const { usePhrasePlayback } = importWithHooks('../audio/usePhrasePlayback.ts', hooks);
    const playback = usePhrasePlayback(), cleanups = hooks.effects.map(effect => effect());
    playback.setExercise([60]); listeners.get('pointerdown')(); const audio = contexts[0];
    playback.setVolume('phraseVolume', 100); playback.setVolume('metronomeVolume', 15);
    assert.equal(audio.gains[0].gain.value, 1); assert.equal(audio.gains[1].gain.value, .15);
    assert.equal(stored.get('piano-trainer.phrase-volume'), '100'); assert.equal(stored.get('piano-trainer.metronome-volume'), '15');
    assert.equal(audio.oscillators.length, 3);
    const restored = usePhrasePlayback(); assert.equal(restored.phraseVolume, 100); assert.equal(restored.metronomeVolume, 15);
    cleanups.forEach(cleanup => cleanup?.()); assert.equal(audio.state, 'closed');
  } finally { global.window = oldWindow; global.localStorage = oldStorage; }
});

test('failed playback does not retry on ordinary gestures and a successful replay clears the error', () => {
  const hooks = fakeHooks(), listeners = new Map(), messages = [], contexts = [];
  hooks.useState = initial => [typeof initial === 'function' ? initial() : initial, value => { if (typeof value === 'string') messages.push(value); }];
  const oldWindow = global.window, oldStorage = global.localStorage;
  class AudioClass extends AudioContextMock {
    constructor() { super(); this.fail = true; contexts.push(this); }
    createOscillator() { if (this.fail) { this.fail = false; throw Error('device failure'); } return super.createOscillator(); }
  }
  global.window = { AudioContext: AudioClass, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  global.localStorage = { getItem: () => null, setItem() {} };
  try {
    const { usePhrasePlayback } = importWithHooks('../audio/usePhrasePlayback.ts', hooks);
    const playback = usePhrasePlayback(), cleanups = hooks.effects.map(effect => effect());
    playback.setExercise([60]); listeners.get('pointerdown')();
    assert.match(messages.at(-1), /playback failed: Error: device failure/);
    listeners.get('pointerdown')(); listeners.get('keydown')();
    assert.equal(contexts[0].oscillators.length, 0);
    playback.replay(); assert.equal(contexts[0].oscillators.length, 3); assert.equal(messages.at(-1), '');
    cleanups.forEach(cleanup => cleanup?.());
  } finally { global.window = oldWindow; global.localStorage = oldStorage; }
});

test('concurrent unlock gestures initialize audio once and play the pending selection once', async () => {
  const hooks = fakeHooks(), listeners = new Map(), contexts = []; let resolveResume;
  const oldWindow = global.window, oldStorage = global.localStorage;
  class AudioClass extends AudioContextMock {
    constructor() { super(); this.state = 'suspended'; this.resumeCalls = 0; contexts.push(this); }
    resume() { this.resumeCalls++; return new Promise(resolve => { resolveResume = () => { this.state = 'running'; resolve(); }; }); }
  }
  global.window = { AudioContext: AudioClass, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  global.localStorage = { getItem: () => null, setItem() {} };
  try {
    const { usePhrasePlayback } = importWithHooks('../audio/usePhrasePlayback.ts', hooks);
    const playback = usePhrasePlayback(), cleanups = hooks.effects.map(effect => effect());
    playback.setExercise([60]); listeners.get('pointerdown')(); listeners.get('keydown')();
    assert.equal(contexts.length, 1); assert.equal(contexts[0].resumeCalls, 2);
    resolveResume(); await Promise.resolve(); await Promise.resolve();
    assert.equal(contexts[0].oscillators.length, 3);
    listeners.get('pointerdown')(); assert.equal(contexts[0].oscillators.length, 3);
    cleanups.forEach(cleanup => cleanup?.());
  } finally { global.window = oldWindow; global.localStorage = oldStorage; }
});

test('React-style rerenders retain callbacks and do not replay the selected phrase', () => {
  const slots = [], effects = [], listeners = new Map(), contexts = []; let cursor = 0;
  const equal = (a, b) => a && b && a.length === b.length && a.every((value, i) => value === b[i]);
  const hooks = {
    useState(initial) { const n = cursor++; if (!(n in slots)) slots[n] = typeof initial === 'function' ? initial() : initial; return [slots[n], value => { slots[n] = value; }]; },
    useRef(initial) { const n = cursor++; return slots[n] ||= { current: initial }; },
    useCallback(fn, deps) { const n = cursor++; if (!slots[n] || !equal(slots[n].deps, deps)) slots[n] = { fn, deps }; return slots[n].fn; },
    useEffect(fn, deps) { const n = cursor++; if (!slots[n] || !equal(slots[n].deps, deps)) { slots[n] = { deps }; effects.push(fn); } }
  };
  const oldWindow = global.window, oldStorage = global.localStorage;
  class AudioClass extends AudioContextMock { constructor() { super(); contexts.push(this); } }
  global.window = { AudioContext: AudioClass, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  global.localStorage = { getItem: () => null, setItem() {} };
  try {
    const { usePhrasePlayback } = importWithHooks('../audio/usePhrasePlayback.ts', hooks);
    let playback = usePhrasePlayback(); const cleanups = effects.splice(0).map(effect => effect());
    playback.setExercise([60]); listeners.get('pointerdown')();
    cursor = 0; const rendered = usePhrasePlayback();
    assert.equal(rendered.setExercise, playback.setExercise); assert.equal(effects.length, 0);
    assert.equal(contexts[0].oscillators.length, 3);
    cleanups.forEach(cleanup => cleanup?.());
  } finally { global.window = oldWindow; global.localStorage = oldStorage; }
});

test('next phrase delay persists without starting playback', () => {
  const hooks = fakeHooks(), stored = new Map();
  const oldWindow = global.window, oldStorage = global.localStorage;
  global.window = { addEventListener() {}, removeEventListener() {} };
  global.localStorage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) };
  try {
    const { usePhrasePlayback } = importWithHooks('../audio/usePhrasePlayback.ts', hooks);
    const playback = usePhrasePlayback(); assert.equal(playback.delay, 1.5);
    playback.setDelay(2.75); assert.equal(stored.get('piano-trainer.next-phrase-delay'), '2.75');
    assert.equal(usePhrasePlayback().delay, 2.75);
  } finally { global.window = oldWindow; global.localStorage = oldStorage; }
});

test('closed audio context is replaced and explicit replay restores playback', async () => {
  const hooks = fakeHooks(), listeners = new Map(), contexts = [], messages = [];
  hooks.useState = initial => [typeof initial === 'function' ? initial() : initial, value => { if (typeof value === 'string') messages.push(value); }];
  const oldWindow = global.window, oldStorage = global.localStorage;
  class AudioClass extends AudioContextMock { constructor() { super(); contexts.push(this); } }
  global.window = { AudioContext: AudioClass, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  global.localStorage = { getItem: () => null, setItem() {} };
  try {
    const { usePhrasePlayback } = importWithHooks('../audio/usePhrasePlayback.ts', hooks);
    const playback = usePhrasePlayback(), cleanups = hooks.effects.map(effect => effect());
    playback.setExercise([60]); listeners.get('pointerdown')();
    assert.equal(contexts[0].oscillators.length, 3);
    await contexts[0].close(); playback.setExercise([62]);
    assert.match(messages.at(-1), /context is closed/);
    playback.replay(); assert.equal(contexts.length, 2); assert.equal(contexts[1].oscillators.length, 3); assert.equal(messages.at(-1), '');
    listeners.get('keydown')(); assert.equal(contexts[1].oscillators.length, 3);
    cleanups.forEach(cleanup => cleanup?.()); assert.equal(contexts[1].state, 'closed');
  } finally { global.window = oldWindow; global.localStorage = oldStorage; }
});

test('rejected resume is reported, clears the request, and manual replay can recover', async () => {
  const hooks = fakeHooks(), listeners = new Map(), contexts = [], messages = [];
  hooks.useState = initial => [typeof initial === 'function' ? initial() : initial, value => { if (typeof value === 'string') messages.push(value); }];
  const oldWindow = global.window, oldStorage = global.localStorage;
  class AudioClass extends AudioContextMock {
    constructor() { super(); this.state = 'suspended'; this.fail = true; contexts.push(this); }
    resume() { if (this.fail) { this.fail = false; return Promise.reject(new Error('activation denied')); } this.state = 'running'; return Promise.resolve(); }
  }
  global.window = { AudioContext: AudioClass, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  global.localStorage = { getItem: () => null, setItem() {} };
  try {
    const { usePhrasePlayback } = importWithHooks('../audio/usePhrasePlayback.ts', hooks);
    const playback = usePhrasePlayback(), cleanups = hooks.effects.map(effect => effect());
    playback.setExercise([60]); listeners.get('pointerdown')(); await Promise.resolve(); await Promise.resolve();
    assert.match(messages.at(-1), /resume was rejected.*activation denied/);
    listeners.get('keydown')(); await Promise.resolve();
    assert.equal(contexts[0].oscillators.length, 0); assert.equal(messages.at(-1), '');
    playback.replay(); assert.equal(contexts[0].oscillators.length, 3);
    playback.setExercise([64]); assert.equal(contexts[0].oscillators.length, 6);
    cleanups.forEach(cleanup => cleanup?.());
  } finally { global.window = oldWindow; global.localStorage = oldStorage; }
});

test('an unresolved resume can be retried by a later interaction without duplicate playback', async () => {
  const hooks = fakeHooks(), listeners = new Map(), contexts = []; let resolveFirst;
  const oldWindow = global.window, oldStorage = global.localStorage;
  class AudioClass extends AudioContextMock {
    constructor() { super(); this.state = 'suspended'; this.calls = 0; contexts.push(this); }
    resume() { this.calls++; if (this.calls === 1) return new Promise(resolve => { resolveFirst = resolve; }); this.state = 'running'; return Promise.resolve(); }
  }
  global.window = { AudioContext: AudioClass, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  global.localStorage = { getItem: () => null, setItem() {} };
  try {
    const { usePhrasePlayback } = importWithHooks('../audio/usePhrasePlayback.ts', hooks);
    const playback = usePhrasePlayback(), cleanups = hooks.effects.map(effect => effect());
    playback.setExercise([60]); listeners.get('pointerdown')();
    assert.equal(contexts[0].oscillators.length, 0);
    playback.replay(); await Promise.resolve();
    assert.equal(contexts[0].calls, 2); assert.equal(contexts[0].oscillators.length, 3);
    resolveFirst(); await Promise.resolve(); assert.equal(contexts[0].oscillators.length, 3);
    cleanups.forEach(cleanup => cleanup?.());
  } finally { global.window = oldWindow; global.localStorage = oldStorage; }
});

test('replay button gesture unlocks only through replay, avoiding duplicate initial playback', () => {
  const hooks = fakeHooks(), listeners = new Map(), contexts = [];
  const oldWindow = global.window, oldStorage = global.localStorage, oldElement = global.Element;
  class ElementMock { closest(selector) { return selector === '[data-audio-replay]' ? this : null; } }
  class AudioClass extends AudioContextMock { constructor() { super(); contexts.push(this); } }
  global.Element = ElementMock;
  global.window = { AudioContext: AudioClass, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  global.localStorage = { getItem: () => null, setItem() {} };
  try {
    const { usePhrasePlayback } = importWithHooks('../audio/usePhrasePlayback.ts', hooks);
    const playback = usePhrasePlayback(), cleanups = hooks.effects.map(effect => effect());
    playback.setExercise([60]); listeners.get('pointerdown')({ target: new ElementMock() });
    assert.equal(contexts.length, 0); playback.replay(); assert.equal(contexts[0].oscillators.length, 3);
    cleanups.forEach(cleanup => cleanup?.());
  } finally { global.window = oldWindow; global.localStorage = oldStorage; global.Element = oldElement; }
});

test('metronome schedules and clears browser timers with their required global receiver', () => {
  const oldSetTimeout = globalThis.setTimeout, oldClearTimeout = globalThis.clearTimeout;
  let scheduled = 0, cleared = 0;
  globalThis.setTimeout = function(callback, delay) {
    if (this !== globalThis) throw new TypeError('Illegal invocation: Window.setTimeout');
    assert.equal(delay, 25); scheduled++; return 123;
  };
  globalThis.clearTimeout = function(id) {
    if (this !== globalThis) throw new TypeError('Illegal invocation: Window.clearTimeout');
    assert.equal(id, 123); cleared++;
  };
  try {
    const audio = new AudioContextMock(), player = createPhrasePlayer(audio);
    assert.equal(player.play([60, 64, 67], 90, true, true), true);
    assert.equal(scheduled, 1);
    player.play([60], 90, true, true);
    assert.equal(cleared, 1); assert.equal(scheduled, 2);
    player.stop(); assert.equal(cleared, 2);
  } finally { globalThis.setTimeout = oldSetTimeout; globalThis.clearTimeout = oldClearTimeout; }
});
