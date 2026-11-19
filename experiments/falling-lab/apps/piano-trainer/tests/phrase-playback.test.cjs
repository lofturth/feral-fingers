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
test('C6 replays once until released and is excluded from note evaluation', () => {
  let count = 0; const control = createReplayControl(() => count++);
  const event = (type, pitch, channel = 1) => ({ type, pitch, channel });
  assert.equal(control.handle(event('note-on', 84)), true);
  control.handle(event('note-on', 84));
  control.handle(event('note-on', 84, 2));
  control.handle(event('note-off', 84));
  control.handle(event('note-off', 84, 2));
  control.handle(event('note-on', 84));
  assert.equal(count, 2);
  assert.equal(control.handle(event('note-on', 60)), false);
  control.reset(); control.handle(event('note-on', 84));
  assert.equal(count, 3);
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
