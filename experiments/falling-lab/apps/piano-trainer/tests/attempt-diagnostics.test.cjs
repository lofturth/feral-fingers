'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('../card-lab/node_modules/typescript');
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
};
const { createAttemptDiagnostics } = require('../attemptDiagnostics.ts');
const { createPhraseAttempt } = require('../cards/phraseAttempt.ts');
const { createTrainingSession } = require('../trainingSession.ts');
const { createSession } = require('../../../core/physics.js');

function midi(type, pitch, timestamp) {
  return { type, pitch, velocity: type === 'note-on' ? 90 : 0, channel: 2, timestamp, device: { id: 'mini', name: 'MiniLab' } };
}

test('recorded MIDI notes link an attempt, evaluation and Core reward', () => {
  const events = [], exercise = { id: 'card-a', label: 'Arpeggio', notes: [60, 64, 67] };
  const diagnostic = createAttemptDiagnostics(event => events.push(event), () => 42);
  const phrase = createPhraseAttempt(exercise.notes);
  const session = createSession({ cards: [exercise.id] });
  const trainer = createTrainingSession(session);
  trainer.advanceTo(100);
  let result;
  for (const [index, pitch] of exercise.notes.entries()) {
    const event = midi('note-on', pitch, 200 + index * 100);
    const attemptId = diagnostic.midi(event, exercise);
    const score = phrase.note(pitch);
    if (score !== null) {
      assert.equal(diagnostic.complete(exercise, score, event.timestamp), attemptId);
      let selection;
      result = trainer.complete(exercise.id, score, event.timestamp, id => { selection = id; });
      assert.equal(selection, exercise.id);
      events.push({ type: 'Core reward', attemptId, detail: `Card ${result.cardId}; magnitude ${result.rewardMagnitude}` });
    } else diagnostic.midi(midi('note-off', pitch, event.timestamp + 5), exercise);
  }
  assert.equal(result.rewardMagnitude, 1);
  assert.deepEqual(events.map(event => event.type), ['Attempt started', 'MIDI note-on', 'MIDI note-off', 'MIDI note-on', 'MIDI note-off', 'MIDI note-on', 'Attempt completed', 'Evaluation', 'Core reward']);
  assert.ok(events.every(event => event.attemptId === 42));
  assert.match(events[1].detail, /pitch 60; velocity 90; channel 2; input MiniLab \[mini\]/);
  assert.match(events[6].detail, /expected: \[60, 64, 67\]; actual: \[60, 64, 67\]/);
  assert.match(events[8].detail, /card-a; magnitude 1/);
});

test('skip logs actual notes and begins a fresh linked attempt', () => {
  const events = [], exercise = { id: 'a', label: 'A', notes: [60, 64] };
  let counter = 0;
  const diagnostic = createAttemptDiagnostics(event => events.push(event), () => ++counter);
  diagnostic.midi(midi('note-on', 62, 10), exercise);
  assert.equal(diagnostic.skip(exercise, 20), 1);
  assert.match(events.at(-1).detail, /expected: \[60, 64\]; actual: \[62\]/);
  diagnostic.midi(midi('note-on', 60, 30), exercise);
  assert.equal(events.at(-1).attemptId, 2);
});
