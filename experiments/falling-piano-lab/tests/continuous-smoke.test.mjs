import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { composition } from '../a-little-jazzy-walk.mjs';

class Element {
  constructor(id = '') {
    this.id = id;
    this.value = id === 'scale' ? 'major' : id === 'tonic' ? '0' : '';
    this.children = [];
    this.dataset = {};
    this.listeners = {};
    this.classList = { toggle() {} };
  }
  addEventListener(type, handler) { this.listeners[type] = handler; }
  append(node) { this.children.push(node); }
  replaceChildren(...nodes) { this.children = nodes; }
  querySelectorAll() { return this.children; }
  setAttribute() {}
}

test('continuous MIDI loop and session recording survive interface removal', async () => {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, new Element(id));
    return elements.get(id);
  };
  for (const id of ['A', 'B', 'C', 'D', 'full']) {
    const button = new Element();
    button.dataset.section = id;
    get('section-buttons').children.push(button);
  }
  get('section').value = 'A';
  const sessions = new Map();
  const timers = [];
  const soundNode = { connect() { return this; }, start() {}, stop() {}, frequency: { value: 0 },
    gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } };
  class AudioContext {
    state = 'running'; currentTime = 0; destination = {};
    async resume() {}
    createOscillator() { return { ...soundNode, frequency: { value: 0 } }; }
    createGain() { return { ...soundNode, gain: soundNode.gain }; }
  }
  const context = vm.createContext({
    document: { getElementById: get, createElement: () => new Element() }, window: {},
    navigator: { requestMIDIAccess: async () => ({ inputs: new Map() }) },
    localStorage: { getItem() { return null; }, setItem() {} },
    crypto: { randomUUID: () => 'test-session' }, AudioContext,
    setTimeout: (handler, ms) => { timers.push({ handler, ms }); return timers.length; }, clearTimeout() {},
    URL, Blob, composition, noteName: String, tonics: [['C', 0]], scalePitches: () => [],
    degree: () => '', displayNote: () => '', interval: () => '',
    RECORD_SCHEMA_VERSION: 1, DATABASE_VERSION: 1, openRecordings: () => Promise.resolve({}),
    saveSession: async (_, record) => { sessions.set(record.sessionId, structuredClone(record)); },
    readAllRecordings: async () => ({ sessions: [...sessions.values()], attempts: [] }),
  });
  const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
  vm.runInContext(source, context);
  const run = code => vm.runInContext(code, context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(run('sessionReady'), true);
  get('continuous-start').listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(run('continuousStage'), 'explore');
  assert.equal(run('phrasePlaying'), true);
  const notes = composition.sections[0].notes.map(note => note.pitch);
  const midi = pitch => run(`onMidi({ data: [144, ${pitch}, 80], timeStamp: 1 })`);
  for (const pitch of notes) midi(pitch);
  assert.equal(run('continuousStage'), 'repeat');
  midi(61);
  assert.equal(run('continuousStage'), 'explore');
  for (const pitch of notes) midi(pitch);
  for (const pitch of notes) midi(pitch);
  assert.equal(run('continuousStage'), 'transition');
  timers.findLast(timer => timer.ms === 700).handler();
  assert.equal(run('continuousRange.join("")'), 'B');
  await run('beginSession()');
  assert.equal(run('activeSessionId'), 'test-session');
  midi(60);
  await run('latestWrite');
  assert.equal(sessions.get('test-session').rawMidiEvents.length, 1);
  await run('endSession()');
  assert.equal(sessions.get('test-session').status, 'ended');
});
