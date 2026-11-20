'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('../card-lab/node_modules/typescript');
require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  module._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
};
const { createSession } = require('../../../core/physics.js');
const { createTrainingSession } = require('../trainingSession.ts');
const { createPhraseAttempt } = require('../cards/phraseAttempt.ts');

function makePractice() {
  const session = createSession({ cardCount: 1 });
  const trainer = createTrainingSession(session);
  const attempt = createPhraseAttempt([60, 64, 67]);
  const id = session.getState().selectedCardId;
  trainer.advanceTo(1000);
  function note(pitch, time) {
    const score = attempt.note(pitch);
    return score === null ? null : trainer.complete(id, score, time);
  }
  return { session, trainer, attempt, id, note };
}

test('clean phrase awards 1x at event time and immediately permits another attempt', () => {
  const p = makePractice();
  assert.equal(p.note(60, 1100), null);
  assert.equal(p.note(64, 1200), null);
  const result = p.note(67, 1500);
  assert.equal(result.rewardMagnitude, 1);
  assert.equal(result.cardId, p.id);
  assert.equal(p.session.getState().time, 0.5);
  assert.ok(p.session.getState().cards[0].depth > 0);
  assert.equal(p.session.getState().selectedCardId, p.id);
  assert.equal(p.note(60, 1600), null);
  assert.equal(p.note(64, 1700), null);
  assert.equal(p.note(67, 1800).rewardMagnitude, 1);
  assert.equal(p.session.getState().rewardCount, 2);
});

test('extra notes award half and skip resets the attempt without a reward', () => {
  const p = makePractice();
  for (const pitch of [61, 60, 64]) assert.equal(p.note(pitch, 1100), null);
  assert.equal(p.note(67, 1200).rewardMagnitude, 0.5);
  assert.equal(p.note(60, 1300), null);
  p.attempt.reset();
  const before = p.session.getState();
  const skip = p.trainer.skip(p.id, 1300);
  assert.equal(skip.kind, 'skip');
  const after = p.session.getState();
  assert.equal(after.rewardCount, before.rewardCount);
  assert.equal(after.skipCount, before.skipCount + 1);
  assert.equal(after.selectedCardId, p.id);
  assert.equal(p.note(60, 1400), null);
  assert.equal(p.note(64, 1500), null);
  assert.equal(p.note(67, 1600).rewardMagnitude, 1);
});

test('stale card results do not reward or skip the selected card', () => {
  const p = makePractice();
  assert.equal(p.trainer.complete('other', 100, 1100), null);
  assert.equal(p.trainer.skip('other', 1200), null);
  assert.equal(p.session.getState().rewardCount, 0);
  assert.equal(p.session.getState().skipCount, 0);
});

test('reward and skip transitions reselect one card or select another card', () => {
  const single = makePractice();
  const first = single.session.getState().selectedCardId;
  assert.equal(single.trainer.skip(first, 1100).cardId, first);
  assert.equal(single.session.getState().selectedCardId, first);
  assert.equal(single.trainer.complete(first, 100, 1200).cardId, first);
  assert.equal(single.session.getState().selectedCardId, first);

  const session = createSession({ cards: ['one', 'two'], config: { instantPosition: true } });
  const trainer = createTrainingSession(session);
  trainer.advanceTo(1000);
  for (let i = 0; i < 3; i++) assert.ok(trainer.complete('one', 100, 1000));
  assert.equal(session.getState().selectedCardId, 'two');
  assert.equal(trainer.skip('two', 1000).cardId, 'two');
  assert.equal(session.getState().selectedCardId, 'one');
  assert.equal(trainer.skip('one', 1000).cardId, 'one');
  assert.equal(session.getState().selectedCardId, 'two');
});

test('pause freezes simulation and resetting the trainer clock prevents a resume time jump', () => {
  const session = createSession({ cardCount: 2, holdSelection: true });
  const trainer = createTrainingSession(session);
  trainer.advanceTo(1000); trainer.advanceTo(1500);
  const before = session.getState(); session.setPaused(true); trainer.resetClock();
  trainer.advanceTo(7000); trainer.advanceTo(9000);
  assert.equal(session.getState().time, before.time);
  assert.equal(session.getState().selectedCardId, before.selectedCardId);
  assert.deepEqual(session.getState().cards, before.cards);
  session.setPaused(false); trainer.resetClock(); trainer.advanceTo(10000); trainer.advanceTo(10250);
  assert.equal(session.getState().time, before.time + .25);
});

test('only accepted fluent attempts reduce the practiced card gravity to the floor', () => {
  const session = createSession({ cards: ['a', 'b'], config: { instantPosition: true, motion: { kickHeightPercent: 1 } } });
  const trainer = createTrainingSession(session);
  const untouched = session.getCard('b');
  assert.equal(session.getCard('a').gravityMultiplier, 1);
  assert.equal(trainer.complete('b', 100, 0, undefined, true), null);
  assert.equal(session.getCard('b').gravityMultiplier, untouched.gravityMultiplier);
  trainer.complete('a', 100, 0, undefined, true);
  assert.equal(session.getCard('a').gravityMultiplier, .9);
  trainer.complete('a', 100, 0, undefined, false);
  trainer.complete('a', 100, 0, undefined, null);
  assert.equal(session.getCard('a').gravityMultiplier, .9);
  trainer.skip('a', 0);
  assert.equal(session.getCard('a').gravityMultiplier, .9);
  for (let i = 0; i < 30; i++) trainer.complete('a', 100, 0, undefined, true);
  assert.equal(session.getCard('a').gravityMultiplier, .2);
  assert.equal(session.getCard('b').gravityMultiplier, 1);
});

test('fluent gravity changes do not alter the current upward reward', () => {
  const options = { cards: ['a'], config: { instantPosition: true, motion: { kickHeightPercent: 1 } } };
  const fluent = createSession(options), normal = createSession(options);
  const a = createTrainingSession(fluent), b = createTrainingSession(normal);
  const fluentResult = a.complete('a', 100, 0, undefined, true);
  const normalResult = b.complete('a', 100, 0, undefined, false);
  assert.equal(fluentResult.lift, normalResult.lift);
  assert.equal(fluentResult.newDepth, normalResult.newDepth);
  assert.equal(fluent.getCard('a').gravityMultiplier, .9);
  assert.equal(normal.getCard('a').gravityMultiplier, 1);
});


test('mistakes increase only the practiced card gravity and clamp at one', () => {
  const session = createSession({ cards: ['a', 'b'], config: { instantPosition: true, motion: { kickHeightPercent: 1 } } });
  const trainer = createTrainingSession(session);
  trainer.complete('a', 100, 0, undefined, true);
  trainer.complete('a', 50, 0, undefined, false);
  assert.ok(Math.abs(session.getCard('a').gravityMultiplier - .927) < 1e-12);
  const before = session.getCard('a').gravityMultiplier;
  trainer.complete('a', 100, 0, undefined, false);
  assert.equal(session.getCard('a').gravityMultiplier, before);
  for (let i = 0; i < 20; i++) trainer.complete('a', 50, 0, undefined, false);
  assert.equal(session.getCard('a').gravityMultiplier, 1);
  assert.equal(session.getCard('b').gravityMultiplier, 1);
});
