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
