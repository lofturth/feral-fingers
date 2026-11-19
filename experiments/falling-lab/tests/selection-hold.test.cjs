'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Physics: P, stateOf } = require('./physics-harness.cjs').testPhysics();

function atBottom(holdSelection) {
  const session = P.createSession({ cards: ['earlier', 'active'], holdSelection, config: { instantPosition: true } });
  for (let i = 0; i < 3; i++) session.applyReward('earlier', 1);
  assert.equal(session.getState().selectedCardId, 'active');
  const before = session.getState();
  const untilFloor = P.timeCoordinate(before.cards[0].depth, before.config, before.unlockedCardCount);
  session.advance(untilFloor - .05);
  return session;
}

test('held selection survives another card reaching the bottom while other cards fall', () => {
  const session = atBottom(true);
  const before = session.getState();
  session.advance(.1);
  const after = session.getState();
  assert.equal(after.selectedCardId, 'active');
  assert.ok(after.cards[0].depth < before.cards[0].depth);
  assert.equal(after.cards[0].depth, 0);
  assert.equal(after.cards[1].depth, 0);
  assert.equal(after.rewardCount, before.rewardCount);
  assert.equal(after.skipCount, before.skipCount);
  assert.equal(after.selectedAt, before.selectedAt);
});

test('unlocking on advance does not interrupt a held selection', () => {
  const session = P.createSession({ cards: ['first', 'second'], holdSelection: true });
  for (let i = 0; i < 3; i++) session.applyReward('first', 1);
  session.advance(.1);
  assert.equal(session.getState().unlockedCardCount, 1);
  const transition = session.advance(.05);
  assert.equal(transition.unlockedCardId, 'second');
  assert.equal(session.getState().selectedCardId, 'first');
  assert.equal(session.getState().cards[1].unlocked, true);
  session.applyReward('first', .5);
  assert.equal(session.getState().selectedCardId, 'second');
});

test('skip and shorthand reward act on the held card and then select by existing rules', () => {
  const skipped = atBottom(true);
  skipped.advance(.1);
  const result = skipped.skip();
  assert.equal(result.cardId, 'active');
  assert.equal(skipped.getState().selectedCardId, 'earlier');
  assert.equal(skipped.getState().skipCount, 1);
  const rewarded = atBottom(true);
  rewarded.advance(.1);
  assert.equal(rewarded.applyReward(1).cardId, 'active');
  assert.equal(rewarded.getState().selectedCardId, 'earlier');
});

test('same-card reward and skip reselect it and establish a fresh hold', () => {
  const session = P.createSession({ cardCount: 1, holdSelection: true });
  session.advance(1);
  assert.equal(session.skip().cardId, 'card-1');
  assert.equal(session.getState().selectedCardId, 'card-1');
  assert.equal(session.getState().selectedAt, 1);
  session.advance(1);
  assert.equal(session.applyReward(1).cardId, 'card-1');
  assert.equal(session.getState().selectedAt, 2);
});

test('default sessions retain continuous selection and validate the new option', () => {
  const session = atBottom(false);
  session.advance(.1);
  assert.equal(session.getState().selectedCardId, 'earlier');
  assert.throws(() => P.createSession({ holdSelection: 'yes' }), TypeError);
  assert.equal(stateOf(P.createSession()).selectedIndex, 0);
});
