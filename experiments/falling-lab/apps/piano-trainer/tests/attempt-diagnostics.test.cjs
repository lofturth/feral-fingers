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

test('unfinished attempt remains linked while a card unlocks; reward changes selection once', () => {
  const events = [], selections = [], exercise = { id: 'first', label: 'C D E', notes: [60, 62, 64] };
  let nextId = 0;
  const diagnostic = createAttemptDiagnostics(event => events.push(event), () => ++nextId);
  const phrase = createPhraseAttempt(exercise.notes);
  const session = createSession({ cards: ['first', 'second'], holdSelection: true });
  const trainer = createTrainingSession(session, event => selections.push(event));
  trainer.advanceTo(0);
  for (let i = 0; i < 3; i++) trainer.complete('first', 100, 0);
  trainer.advanceTo(100);
  for (const pitch of [60, 62]) {
    assert.equal(diagnostic.midi(midi('note-on', pitch, 100), exercise), 1);
    assert.equal(phrase.note(pitch), null);
  }
  trainer.advanceTo(150);
  assert.equal(session.getState().unlockedCardCount, 2);
  assert.equal(session.getState().selectedCardId, 'first');
  assert.equal(selections.length, 0);
  diagnostic.midi(midi('note-on', 64, 150), exercise);
  const score = phrase.note(64);
  assert.equal(score, 100);
  assert.equal(diagnostic.complete(exercise, score, 150), 1);
  assert.equal(trainer.complete('first', score, 150).cardId, 'first');
  assert.equal(session.getState().selectedCardId, 'second');
  assert.deepEqual(selections.map(({ previous, next, cause }) => ({ previous, next, cause })), [{ previous: 'first', next: 'second', cause: 'reward' }]);
  assert.match(events.find(event => event.type === 'Attempt completed').detail, /actual: \[60, 62, 64\]/);
  diagnostic.midi(midi('note-on', 67, 160), { id: 'second', label: 'Next', notes: [67] });
  assert.equal(events.at(-1).attemptId, 2);
});

test('selection changes and diagnostic attempt interruptions identify cause and boundary', () => {
  const selections = [];
  const session = createSession({ cards: ['one', 'two'], holdSelection: true, config: { instantPosition: true } });
  const trainer = createTrainingSession(session, change => selections.push(change));
  trainer.advanceTo(0);
  for (let i = 0; i < 3; i++) trainer.complete('one', 100, 0);
  assert.equal(session.getState().selectedCardId, 'two');
  trainer.skip('two', 10);
  assert.deepEqual(selections.map(({ previous, next, cause }) => ({ previous, next, cause })), [
    { previous: 'one', next: 'two', cause: 'reward' },
    { previous: 'two', next: 'one', cause: 'skip' }
  ]);
  const entries = [];
  const diagnostic = createAttemptDiagnostics(event => entries.push(event), () => 1);
  const first = { id: 'two', label: 'Two', notes: [60, 64] };
  diagnostic.midi(midi('note-on', 60, 10), first);
  diagnostic.selectionChanged('one', 11);
  assert.equal(entries.at(-1).type, 'Attempt interrupted');
  assert.match(entries.at(-1).detail, /actual: \[60\]; selection changed/);
});

test('trainer logs advance-driven selection changes when holding is not enabled', () => {
  const selections = [];
  const session = createSession({ cards: ['one', 'two'], config: { instantPosition: true } });
  const trainer = createTrainingSession(session, change => selections.push(change));
  trainer.advanceTo(0);
  for (let i = 0; i < 3; i++) trainer.complete('one', 100, 0);
  assert.equal(session.getState().selectedCardId, 'two');
  trainer.advanceTo(1000000);
  assert.equal(session.getState().selectedCardId, 'one');
  assert.equal(selections.at(-1).cause, 'advance');
  assert.equal(selections.at(-1).previous, 'two');
  assert.equal(selections.at(-1).next, 'one');
});
