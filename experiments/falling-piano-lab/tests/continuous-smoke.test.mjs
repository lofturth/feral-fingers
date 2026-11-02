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
  toggleAttribute(name, force) { this.attributes ??= new Set(); if (force) this.attributes.add(name); else this.attributes.delete(name); }
  hasAttribute(name) { return this.attributes?.has(name) ?? false; }
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
  const intervals = new Map();
  let nextInterval = 0;
  let oscillators = 0;
  const starts = [], stops = [];
  const soundNode = { connect() { return this; }, start(when) { starts.push({ when, frequency: this.frequency.value }); }, stop(when) { stops.push(when); }, frequency: { value: 0 },
    gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } };
  class AudioContext {
    state = 'running'; currentTime = 0; destination = {};
    async resume() {}
    createOscillator() { oscillators++; return { ...soundNode, frequency: { value: 0 } }; }
    createGain() { return { ...soundNode, gain: soundNode.gain }; }
  }
  const context = vm.createContext({
    document: { getElementById: get, createElement: () => new Element() }, window: {},
    navigator: { requestMIDIAccess: async () => ({ inputs: new Map() }) },
    localStorage: { getItem() { return null; }, setItem() {} },
    crypto: { randomUUID: () => 'test-session' }, AudioContext,
    setTimeout: (handler, ms) => { timers.push({ handler, ms }); return timers.length; }, clearTimeout() {},
    setInterval: (handler, ms) => { const id = ++nextInterval; intervals.set(id, { handler, ms }); return id; },
    clearInterval: id => intervals.delete(id),
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
  const letters = get('show-letters'), notation = get('show-notation'), audioToggle = get('play-audio'), metronome = get('play-metronome');
  const toggle = () => get('presentation-start').listeners.click();
  letters.checked = notation.checked = audioToggle.checked = metronome.checked = true;
  await toggle();
  assert.equal(get('presentation-start').textContent, 'Stop');
  assert.equal(get('presentation-letters').hidden, false);
  assert.equal(get('presentation-notation').hasAttribute('hidden'), false);
  assert.equal(oscillators, 11); // Three notes with piano harmonics, plus a two-oscillator click.
  assert.equal(intervals.size, 1);
  const firstNote = starts.find(event => Math.abs(event.frequency - 261.6256) < .01);
  const secondNote = starts.find(event => Math.abs(event.frequency - 293.6648) < .01);
  const thirdNote = starts.find(event => Math.abs(event.frequency - 329.6276) < .01);
  const firstClick = starts.find(event => event.frequency === 1760);
  assert.equal(firstNote.when, firstClick.when);
  assert.ok(Math.abs(secondNote.when - firstNote.when - .75) < 1e-9);
  assert.ok(Math.abs(thirdNote.when - secondNote.when - .75) < 1e-9);
  run('audio.currentTime = 3.1');
  intervals.values().next().value.handler();
  assert.equal(starts.filter(event => event.frequency === 1760).length, 2); // Clicks continue after the phrase.
  const stopsBefore = stops.length;
  await toggle();
  assert.equal(get('presentation-start').textContent, 'Start');
  assert.equal(intervals.size, 0);
  assert.ok(stops.length > stopsBefore); // Stop cancels scheduled or sounding oscillators.
  letters.checked = false; notation.checked = true; audioToggle.checked = metronome.checked = false;
  await toggle();
  assert.equal(get('presentation-letters').hidden, true);
  assert.equal(get('presentation-notation').hasAttribute('hidden'), false);
  assert.equal(oscillators, 13);
  await toggle();
  letters.checked = true; notation.checked = false;
  await toggle();
  assert.equal(get('presentation-letters').hidden, false);
  assert.equal(get('presentation-notation').hasAttribute('hidden'), true);
  await toggle();
  audioToggle.checked = true; letters.checked = false;
  await toggle();
  assert.equal(oscillators, 22);
  assert.equal(get('presentation-letters').hidden, true);
  assert.equal(get('presentation-notation').hasAttribute('hidden'), true);
  assert.equal(intervals.size, 0);
  await toggle();
  audioToggle.checked = false; metronome.checked = true;
  await toggle();
  assert.equal(oscillators, 24);
  assert.equal(intervals.size, 1);
  await toggle();
  metronome.checked = false;
  await toggle();
  assert.equal(oscillators, 24);
  assert.equal(get('presentation-status').textContent, 'All presentation methods are off.');
  await toggle();
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

test('presentation defaults and treble staff positions are declared in HTML', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const id of ['show-letters', 'show-notation', 'play-audio', 'play-metronome']) {
    assert.match(html, new RegExp(`id="${id}"[^>]*checked`));
  }
  assert.doesNotMatch(html, /𝄞|font-family="Bravura/);
  assert.match(html, /M78 105 C70 99/); // Treble clef drawn as SVG paths.
  assert.match(html, /M94 90H124/); // C4 ledger line below the E4 staff line.
  assert.match(html, /cx="109" cy="90"/); // C4
  assert.match(html, /cx="170" cy="85"/); // D4
  assert.match(html, /cx="231" cy="80"/); // E4
});
