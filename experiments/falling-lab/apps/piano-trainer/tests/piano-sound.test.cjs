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
const { createPianoSound } = require('../audio/pianoSound.ts');
const event = (type, pitch, velocity = 100, channel = 1) => ({ type, pitch, velocity, channel, timestamp: 0, device: { id: 'x', name: 'Keyboard' } });

test('note-on, release and chords use correct frequencies, channels and velocity', () => {
  const context = new AudioContextMock(), piano = createPianoSound(context);
  piano.handle(event('note-on', 69, 32, 1));
  piano.handle(event('note-on', 72, 127, 1));
  piano.handle(event('note-on', 69, 90, 2));
  assert.equal(context.oscillators.length, 9);
  assert.equal(context.oscillators[0].frequency.value, 440);
  assert.ok(Math.abs(context.oscillators[3].frequency.value - 523.251) < .01);
  assert.ok(context.gains[0].gain.calls.find(call => call[0] === 'ramp')[1] < context.gains[4].gain.calls.find(call => call[0] === 'ramp')[1]);
  piano.handle(event('note-off', 69, 0, 1));
  assert.deepEqual(context.oscillators[0].stops, [1.5]);
  assert.deepEqual(context.oscillators[3].stops, []);
  assert.deepEqual(context.oscillators[6].stops, []);
  assert.equal(context.gains[0].gain.calls.at(-1)[3], .08);
  piano.stopAll();
  assert.equal(context.oscillators[3].stops.at(-1), 1.08);
  assert.equal(context.oscillators[6].stops.at(-1), 1.08);
});

test('retrigger and stopAll release all voices, including release tails', () => {
  const context = new AudioContextMock(), piano = createPianoSound(context);
  piano.handle(event('note-on', 60));
  piano.handle(event('note-on', 60));
  assert.equal(context.oscillators[0].stops.at(-1), 1.08);
  piano.handle(event('note-off', 60, 0));
  assert.equal(context.oscillators[3].stops.at(-1), 1.5);
  piano.stopAll();
  assert.equal(context.oscillators[0].stops.at(-1), 1.08);
  assert.equal(context.oscillators[3].stops.at(-1), 1.08);
});

function fakeHooks() {
  const effects = [];
  return {
    effects,
    useState(initial) { return [typeof initial === 'function' ? initial() : initial, () => {}]; },
    useRef(initial) { return { current: initial }; },
    useCallback(callback) { return callback; },
    useEffect(callback) { effects.push(callback); }
  };
}
function importWithHooks(filename, hooks) {
  const original = Module._load;
  Module._load = function(request, parent, isMain) { return request === 'react' ? hooks : original.call(this, request, parent, isMain); };
  try { delete require.cache[require.resolve(filename)]; return require(filename); } finally { Module._load = original; }
}

test('sound toggle defaults off, saves preference, and silences active voices', () => {
  const hooks = fakeHooks(), stored = new Map(), contexts = [];
  const oldWindow = global.window, oldStorage = global.localStorage;
  class AudioClass extends AudioContextMock { constructor() { super(); contexts.push(this); } }
  global.window = { AudioContext: AudioClass, addEventListener() {}, removeEventListener() {} };
  global.localStorage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) };
  try {
    const { usePianoSound } = importWithHooks('../audio/usePianoSound.ts', hooks);
    const sound = usePianoSound();
    assert.equal(sound.enabled, false);
    sound.onMidiEvent(event('note-on', 60));
    assert.equal(contexts.length, 0);
    sound.setEnabled(true);
    assert.equal(stored.get('piano-trainer.sound-enabled'), 'true');
    sound.onMidiEvent(event('note-on', 60));
    assert.equal(contexts[0].oscillators.length, 3);
    sound.setEnabled(false);
    assert.equal(stored.get('piano-trainer.sound-enabled'), 'false');
    assert.equal(contexts[0].oscillators[0].stops.at(-1), 1.08);
    sound.onMidiEvent(event('note-on', 64));
    assert.equal(contexts[0].oscillators.length, 3);
  } finally { global.window = oldWindow; global.localStorage = oldStorage; }
});

test('MIDI device disconnect invokes sound cleanup without a second input listener', async () => {
  const hooks = fakeHooks(), midiEvents = [], resets = [];
  const audio = new AudioContextMock(), piano = createPianoSound(audio);
  const input = { id: 'mini', name: 'MiniLab 37', state: 'connected', onmidimessage: null };
  const access = { inputs: new Map([['mini', input]]), onstatechange: null };
  const previous = Object.getOwnPropertyDescriptor(global, 'navigator');
  Object.defineProperty(global, 'navigator', { configurable: true, value: { requestMIDIAccess: async () => access } });
  try {
    const { useMidi } = importWithHooks('../midi/useMidi.ts', hooks);
    const midi = useMidi(value => { midiEvents.push(value); piano.handle(value); }, () => { piano.stopAll(); resets.push('stop'); });
    await midi.connect();
    const afterConnect = resets.length;
    input.onmidimessage({ data: [0x90, 60, 100], timeStamp: 5 });
    input.onmidimessage({ data: [0x80, 60, 0], timeStamp: 6 });
    input.onmidimessage({ data: [0x90, 64, 80], timeStamp: 7 });
    assert.deepEqual(midiEvents.map(value => value.type), ['note-on', 'note-off', 'note-on']);
    input.state = 'disconnected';
    access.inputs.clear();
    access.onstatechange();
    assert.equal(resets.length, afterConnect + 1);
    assert.equal(input.onmidimessage, null);
    assert.equal(audio.oscillators[3].stops.at(-1), 1.08);
    input.state = 'connected'; access.inputs.set('mini', input); access.onstatechange();
    input.onmidimessage({ data: [0x90, 67, 80], timeStamp: 8 });
    const cleanup = hooks.effects[0]();
    cleanup();
    assert.equal(audio.oscillators[6].stops.at(-1), 1.08);
  } finally { if (previous) Object.defineProperty(global, 'navigator', previous); else delete global.navigator; }
});


test('saved sound preference waits for a user gesture and cleans up on unmount', () => {
  const hooks = fakeHooks(), listeners = new Map(), contexts = [];
  const oldWindow = global.window, oldStorage = global.localStorage;
  class AudioClass extends AudioContextMock { constructor() { super(); this.state = 'suspended'; contexts.push(this); } }
  global.window = { AudioContext: AudioClass, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  global.localStorage = { getItem: () => 'true', setItem() {} };
  try {
    const { usePianoSound } = importWithHooks('../audio/usePianoSound.ts', hooks);
    const sound = usePianoSound();
    assert.equal(sound.enabled, true);
    const cleanups = hooks.effects.map(effect => effect());
    assert.equal(contexts.length, 0);
    listeners.get('pointerdown')();
    assert.equal(contexts.length, 1);
    assert.equal(contexts[0].state, 'running');
    sound.onMidiEvent(event('note-on', 60));
    cleanups.forEach(cleanup => cleanup?.());
    assert.equal(contexts[0].oscillators[0].stops.at(-1), 1.08);
    assert.equal(contexts[0].state, 'closed');
  } finally { global.window = oldWindow; global.localStorage = oldStorage; }
});
