'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('../card-lab/node_modules/typescript');
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);
require.extensions['.css'] = () => {};
const { createPracticeClock } = require('../practiceClock.ts');

test('practice clock excludes repeated pauses and freezes while paused', () => {
  const clock = createPracticeClock();
  clock.pause(1100); clock.pause(1200);
  assert.equal(clock.time(5000), 1100);
  clock.resume(6100); clock.resume(7000);
  assert.equal(clock.time(6200), 1200);
  clock.pause(6300); clock.resume(7300);
  assert.equal(clock.time(7400), 1400);
});

test('paused MIDI is recorded raw but excluded from the ongoing attempt and fluency time', () => {
  const events = [], completions = [];
  let callbacks, paused = false, clears = 0;
  const hooks = { useRef: value => ({ current: value }), useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}], useEffect() {}, useCallback: fn => fn };
  const original = Module._load;
  Module._load = function(request, parent, main) {
    if (request === 'react') return hooks;
    if (request === 'react/jsx-runtime') return { jsx() {}, jsxs() {} };
    if (request === '../midi/useMidi') return { noteName: String, useMidi(onEvent, onReset, onRaw) { callbacks = { onEvent, onRaw }; return { clearHeldNotes() { clears++; }, heldNotes: [] }; } };
    return original.call(this, request, parent, main);
  };
  try {
    const { usePianoPractice } = require('../cards/TrainerPianoCard.tsx');
    const practice = usePianoPractice({ recorder: { record: event => events.push(event) }, startRecording: () => false, getTiming: () => ({ tempo: 120, notesPerBeat: 1 }), getDemonstrationTiming: () => ({ tempo: 120, notesPerBeat: 1 }), paused: false, selectedId: 'a', getSelectedId: () => paused ? null : 'a', getExercise: () => ({ id: 'a', label: 'A', notes: [60, 64] }), onComplete: (...args) => completions.push(args), onSkip() {}, onLog() {}, nextAttemptId: () => 1, replay() {}, togglePause() {} });
    function note(pitch, timestamp) {
      callbacks.onRaw([0x90, pitch, 90], timestamp, { id: 'k', name: 'Keys' });
      return callbacks.onEvent({ type: 'note-on', pitch, velocity: 90, channel: 1, timestamp, device: { id: 'k', name: 'Keys' } });
    }
    note(60, 1000);
    paused = true; practice.setPracticePaused(true, 1100); practice.setPracticePaused(true, 1200);
    assert.equal(note(61, 3000), false);
    assert.equal(completions.length, 0);
    paused = false; practice.setPracticePaused(false, 6100); practice.setPracticePaused(false, 6200);
    note(64, 6200);
    const result = events.find(event => event.type === 'fluency');
    assert.equal(result.executionTime, .2); assert.equal(result.accuracy, 'clean'); assert.equal(result.fluent, true);
    assert.equal(completions.length, 1); assert.equal(completions[0][1], 100);
    assert.deepEqual(events.filter(event => event.type === 'midi').map(event => event.data[1]), [60, 61, 64]);
    assert.equal(clears, 1);
  } finally { Module._load = original; }
});
