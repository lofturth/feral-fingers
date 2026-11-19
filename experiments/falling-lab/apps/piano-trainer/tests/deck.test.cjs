'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../card-lab/node_modules/typescript');
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
};
const { parseDeck } = require('../deck.ts');
const { createPhraseAttempt } = require('../cards/phraseAttempt.ts');
const { createTrainingSession } = require('../trainingSession.ts');
const { createSession } = require('../../../core/physics.js');
const sample = JSON.parse(fs.readFileSync(path.join(__dirname, '../decks/sample.json'), 'utf8'));

test('sample deck validates and preserves each exercise and pitch sequence', () => {
  const deck = parseDeck(sample);
  assert.equal(deck.schemaVersion, 1);
  assert.equal(deck.exercises.length, 10);
  assert.deepEqual(deck.exercises[0].notes, [60, 64, 67]);
  for (const exercise of deck.exercises) {
    const attempt = createPhraseAttempt(exercise.notes);
    const scores = exercise.notes.map(note => attempt.note(note));
    assert.equal(scores.at(-1), 100, exercise.id);
  }
});

test('invalid decks produce useful errors', () => {
  for (const [data, message] of [
    [null, /object/], [{ ...sample, schemaVersion: 2 }, /schemaVersion/],
    [{ ...sample, id: '' }, /Deck id/], [{ ...sample, title: '' }, /title/],
    [{ ...sample, exercises: [] }, /at least one/],
    [{ ...sample, exercises: [sample.exercises[0], sample.exercises[0]] }, /duplicate id/],
    [{ ...sample, exercises: [{ id: 'x', label: 'X', notes: [128] }] }, /MIDI integers/],
    [{ ...sample, exercises: [{ id: 'x', label: '', notes: [60] }] }, /label/]
  ]) assert.throws(() => parseDeck(data), message);
  assert.throws(() => JSON.parse('{'), SyntaxError);
});

test('Core cards use deck IDs, advance across exercises, skip, and reset with another deck', () => {
  const deck = parseDeck(sample);
  const makeSession = data => createSession({ cards: data.exercises.map(({ id }) => ({ id })), config: { instantPosition: true } });
  const session = makeSession(deck);
  const trainer = createTrainingSession(session);
  assert.deepEqual(session.getState().cards.map(card => card.id), deck.exercises.map(exercise => exercise.id));
  trainer.advanceTo(1000);
  const first = deck.exercises[0], second = deck.exercises[1];
  for (let i = 0; i < 3; i++) assert.equal(trainer.complete(first.id, 100, 1000).rewardMagnitude, 1);
  assert.equal(session.getState().selectedCardId, second.id);
  const secondAttempt = createPhraseAttempt(second.notes);
  assert.equal(secondAttempt.note(61), null);
  for (const note of second.notes.slice(0, -1)) assert.equal(secondAttempt.note(note), null);
  assert.equal(secondAttempt.note(second.notes.at(-1)), 50);
  assert.equal(trainer.complete(second.id, 50, 1000).rewardMagnitude, .5);
  const selected = session.getState().selectedCardId;
  const before = session.getState();
  assert.equal(trainer.skip(selected, 1000).kind, 'skip');
  assert.equal(session.getState().rewardCount, before.rewardCount);
  assert.equal(session.getState().skipCount, before.skipCount + 1);
  const replacement = parseDeck({ schemaVersion: 1, id: 'new', title: 'New', exercises: [{ id: 'other', label: 'Other', notes: [72] }] });
  const reset = makeSession(replacement).getState();
  assert.deepEqual(reset.cards.map(card => card.id), ['other']);
  assert.equal(reset.rewardCount, 0);
  assert.equal(reset.time, 0);
});
