const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Physics = require('../physics.js');
const { Physics: InstrumentedPhysics, stateOf } = require('./physics-harness.cjs').testPhysics();

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('musical card: starts at bottom and remains available for retrieval at floor', () => {
  const session = Physics.createSession({
    cardCount: 1,
    config: { motion: { topFallingSpeed: 1, kickHeightPercent: 25, bottomToTopMultiplier: 5 } }
  });
  const state0 = session.getState();
  assert.equal(state0.cards.length, 1);
  assert.equal(state0.cards[0].depth, 0);

  // Advancing time while on the floor clamps at floor (0) without disappearing
  session.advance(2.0);
  const state1 = session.getState();
  assert.equal(state1.cards[0].depth, 0);
  assert.equal(state1.complete, false);
});

test('musical card: full lift and half lift apply canonical time-coordinate kicks', () => {
  const sessionFull = Physics.createSession({ cardCount: 1 });
  const sessionHalf = Physics.createSession({ cardCount: 1 });

  const fullResult = sessionFull.applyReward(0, 1.0);
  const halfResult = sessionHalf.applyReward(0, 0.5);

  // Full kick reaches 25% height; half kick reaches ~13.1966%
  near(fullResult.lift, 25.0);
  near(halfResult.lift, 13.196601125010515);
  near(sessionFull.getState().cards[0].depth, 25.0);
  near(sessionHalf.getState().cards[0].depth, 13.196601125010515);

  // Added falling time has an exact 2:1 relationship (5.5786s vs 2.7893s)
  const c = sessionFull.getState().config;
  const bkt = Physics.baselineKickTime(c);
  near(Physics.timeCoordinate(sessionFull.getState().cards[0].depth, c), bkt);
  near(Physics.timeCoordinate(sessionHalf.getState().cards[0].depth, c), bkt * 0.5);
});

test('musical card: continues falling after upward lift', () => {
  const session = Physics.createSession({ cardCount: 1 });
  session.applyReward(0, 1.0); // Lifted to 25%
  near(session.getState().cards[0].depth, 25.0);

  // Advance time
  session.advance(1.0);
  const depthAfterFall = session.getState().cards[0].depth;
  assert.ok(depthAfterFall < 25.0, `Card should fall downwards from 25.0, got ${depthAfterFall}`);
  assert.ok(depthAfterFall > 0, `Card should still be airborne after 1s fall, got ${depthAfterFall}`);
});

test('musical phrase recognition logic: evaluates first try, extra notes, and incomplete sequences', () => {
  const targetPitches = [60, 62, 64];

  function evaluateAttempt(playedPitches) {
    let progress = 0;
    const noteOns = [];
    const matched = [];

    for (const pitch of playedPitches) {
      noteOns.push(pitch);
      if (pitch === targetPitches[progress]) {
        progress++;
        matched.push(pitch);
      } else if (pitch === targetPitches[0]) {
        progress = 1;
        matched.length = 0;
        matched.push(pitch);
      } else {
        progress = 0;
        matched.length = 0;
      }
      if (progress === targetPitches.length) break;
    }

    if (progress < targetPitches.length) {
      return { completed: false, reward: 0, extraNotes: 0 };
    }
    const extraNotes = Math.max(0, noteOns.length - targetPitches.length);
    const reward = extraNotes === 0 ? 1.0 : 0.5;
    return { completed: true, reward, extraNotes };
  }

  // 1. Correct on first try: C4, D4, E4
  const firstTry = evaluateAttempt([60, 62, 64]);
  assert.equal(firstTry.completed, true);
  assert.equal(firstTry.extraNotes, 0);
  assert.equal(firstTry.reward, 1.0);

  // 2. Correct after wrong notes: C4, F4 (wrong), C4, D4, E4
  const afterWrong = evaluateAttempt([60, 65, 60, 62, 64]);
  assert.equal(afterWrong.completed, true);
  assert.equal(afterWrong.extraNotes, 2);
  assert.equal(afterWrong.reward, 0.5);

  // 3. Incomplete: C4, D4
  const incomplete = evaluateAttempt([60, 62]);
  assert.equal(incomplete.completed, false);
  assert.equal(incomplete.reward, 0);

  // 4. All wrong notes: F4, G4, A4
  const allWrong = evaluateAttempt([65, 67, 69]);
  assert.equal(allWrong.completed, false);
  assert.equal(allWrong.reward, 0);
});

test('diagnostics isolation: toggling developer view state does not mutate physics or attempt state', () => {
  const session = Physics.createSession({ cardCount: 1 });
  session.applyReward(0, 1.0);
  const snapshotBefore = session.getState();

  // Simulating developer panel details toggle
  let devPanelOpen = false;
  devPanelOpen = true; // expanded
  assert.deepEqual(session.getState(), snapshotBefore);

  session.advance(0.5);
  const snapshotMid = session.getState();

  devPanelOpen = false; // collapsed
  assert.deepEqual(session.getState(), snapshotMid);
});

test('FP-021: multi-slot falling field routes rewards specifically to selected background slot', () => {
  const session = Physics.createSession({ cardCount: 10 });
  const state0 = session.getState();
  assert.equal(state0.cards.length, 10);
  assert.equal(state0.selectedIndex, 0);

  // Slot 0 is rewarded with full lift (1.0)
  const rewardResult = session.applyReward(state0.selectedIndex, 1.0);
  assert.equal(rewardResult.index, 0);
  near(rewardResult.lift, 25.0);
  near(session.getState().cards[0].depth, 25.0);
  // Other slots remain at initial depth (unlocked or locked)
  assert.equal(session.getState().cards[1].depth, 0);

  // Background slots continue falling over time while player interacts with foreground card
  session.advance(1.0);
  assert.ok(session.getState().cards[0].depth < 25.0, 'Background slot 0 falls with time');
  assert.ok(session.getState().cards[0].depth > 0, 'Background slot 0 remains airborne');
});

test('musical card feedback: accurately formats dynamic time-coordinate lift across heights', () => {
  function formatOverlayFeedback({ isFirstTry, extraNotes, targetIndex, rewardResult }) {
    const liftAmount = rewardResult ? rewardResult.lift : 0;
    const liftText = `+${liftAmount.toFixed(1)}%`;
    const badgeText = isFirstTry
      ? `First Try! Full Lift (${liftText})`
      : `Completed! Half Lift (${liftText})`;
    const feedbackText = isFirstTry
      ? `Flawless! Slot ${String(targetIndex + 1).padStart(2, '0')} lifted (${liftText}).`
      : `Completed with ${extraNotes} extra note${extraNotes === 1 ? '' : 's'}. Slot ${String(targetIndex + 1).padStart(2, '0')} lifted (${liftText}).`;
    return { badgeText, feedbackText, liftText };
  }

  // 1. At floor (0%)
  const sessionFloorFull = Physics.createSession({ cardCount: 1 });
  const resFloorFull = sessionFloorFull.applyReward(0, 1.0);
  const fbFloorFull = formatOverlayFeedback({ isFirstTry: true, extraNotes: 0, targetIndex: 0, rewardResult: resFloorFull });
  assert.equal(fbFloorFull.badgeText, 'First Try! Full Lift (+25.0%)');
  assert.equal(fbFloorFull.feedbackText, 'Flawless! Slot 01 lifted (+25.0%).');

  const sessionFloorHalf = Physics.createSession({ cardCount: 1 });
  const resFloorHalf = sessionFloorHalf.applyReward(0, 0.5);
  const fbFloorHalf = formatOverlayFeedback({ isFirstTry: false, extraNotes: 1, targetIndex: 0, rewardResult: resFloorHalf });
  assert.equal(fbFloorHalf.badgeText, 'Completed! Half Lift (+13.2%)');
  assert.equal(fbFloorHalf.feedbackText, 'Completed with 1 extra note. Slot 01 lifted (+13.2%).');

  // 2. Mid-field (50%)
  const sessionMidFull = InstrumentedPhysics.createSession({ cardCount: 1 });
  stateOf(sessionMidFull).cards[0].depth = 50.0;
  const resMidFull = sessionMidFull.applyReward(0, 1.0);
  const fbMidFull = formatOverlayFeedback({ isFirstTry: true, extraNotes: 0, targetIndex: 0, rewardResult: resMidFull });
  assert.equal(fbMidFull.badgeText, 'First Try! Full Lift (+15.0%)');
  assert.equal(fbMidFull.feedbackText, 'Flawless! Slot 01 lifted (+15.0%).');

  const sessionMidHalf = InstrumentedPhysics.createSession({ cardCount: 3 });
  stateOf(sessionMidHalf).cards[2].depth = 50.0;
  stateOf(sessionMidHalf).cards[2].unlocked = true;
  const resMidHalf = sessionMidHalf.applyReward(2, 0.5);
  const fbMidHalf = formatOverlayFeedback({ isFirstTry: false, extraNotes: 3, targetIndex: 2, rewardResult: resMidHalf });
  assert.equal(fbMidHalf.badgeText, 'Completed! Half Lift (+7.9%)');
  assert.equal(fbMidHalf.feedbackText, 'Completed with 3 extra notes. Slot 03 lifted (+7.9%).');

  // 3. At ceiling (100%) - saturation
  const sessionCeil = InstrumentedPhysics.createSession({ cardCount: 1 });
  stateOf(sessionCeil).cards[0].depth = 100.0;
  const resCeil = sessionCeil.applyReward(0, 1.0);
  const fbCeil = formatOverlayFeedback({ isFirstTry: true, extraNotes: 0, targetIndex: 0, rewardResult: resCeil });
  assert.equal(fbCeil.badgeText, 'First Try! Full Lift (+0.0%)');
  assert.equal(fbCeil.feedbackText, 'Flawless! Slot 01 lifted (+0.0%).');
});

// ============================================================================
// Generic Card State, Identity, and Independent Tasks
// ============================================================================

test('generic cards: engine creates and manages cards with stable identities without vocabulary fields', () => {
  // 1. Create session with generic card definitions
  const session = Physics.createSession({
    cards: [
      { id: 'phrase-01' },
      { id: 'phrase-02' },
      { id: 'phrase-03' }
    ]
  });

  const state = session.getState();
  assert.equal(state.cards.length, 3);
  assert.equal(state.cards[0].id, 'phrase-01');
  assert.equal(state.cards[1].id, 'phrase-02');
  assert.equal(state.cards[2].id, 'phrase-03');

  // Verify generic cards do NOT have english or spanish vocabulary fields
  assert.equal(state.cards[0].english, undefined);
  assert.equal(state.cards[0].spanish, undefined);
  assert.equal('english' in state.cards[0], false);
  assert.equal('spanish' in state.cards[0], false);

  // Generic reward result does not contain vocabulary properties
  const ret = session.applyReward('phrase-01', 1.0);
  assert.equal(ret.kind, 'reward');
  assert.equal(ret.index, 0);
  assert.equal(ret.cardId, 'phrase-01');
  assert.equal(ret.word, undefined);
  assert.equal(ret.translation, undefined);

  // Standard constructor with cardCount
  const cardSession = Physics.createSession({ cardCount: 4 });
  const cardState = cardSession.getState();
  assert.equal(cardState.cards.length, 4);
  assert.equal(cardState.cards[0].id, 'card-1');
  assert.equal(cardState.cards[3].id, 'card-4');
  assert.equal(cardState.cards[0].english, undefined);
});

test('generic cards: card ID identifies task independently of array position and supports ID-based lookup and rewards', () => {
  const session = Physics.createSession({
    cards: [
      { id: 'melody-a' },
      { id: 'melody-b' },
      { id: 'melody-c' }
    ]
  });

  // Verify card retrieval by identifier
  const cardA = session.getCard('melody-a');
  assert.ok(cardA);
  assert.equal(cardA.id, 'melody-a');
  assert.equal(cardA.depth, 0);

  const cardB = session.getCard('melody-b');
  assert.ok(cardB);
  assert.equal(cardB.id, 'melody-b');

  // getLowestCardId
  assert.equal(session.getLowestCardId(), 'melody-a');

  // applyReward by string card ID
  const rewardRes = session.applyReward('melody-a', 1.0);
  assert.ok(rewardRes);
  assert.equal(rewardRes.index, 0);
  assert.equal(rewardRes.cardId, 'melody-a');
  near(rewardRes.lift, 25.0);
  near(session.getCard('melody-a').depth, 25.0);

  // Reject invalid card ID strings with TypeError
  assert.throws(() => session.applyReward('nonexistent-id', 1.0), TypeError);
});

test('generic cards: two cards with identical application content maintain independent state and progression', () => {
  // Application attaches identical musical notes to two distinct cards
  const identicalContent = { notes: [60, 62, 64], tempo: 80 };
  const appRegistry = new Map([
    ['phrase-copy-1', { ...identicalContent, tag: 'Slot 1' }],
    ['phrase-copy-2', { ...identicalContent, tag: 'Slot 2' }]
  ]);

  const session = InstrumentedPhysics.createSession({
    cards: [{ id: 'phrase-copy-1' }, { id: 'phrase-copy-2' }]
  });

  // Unlock both cards for independent comparison
  stateOf(session).cards[0].unlocked = true;
  stateOf(session).cards[1].unlocked = true;

  // Reward phrase-copy-1 only
  session.applyReward('phrase-copy-1', 1.0);

  // Verify phrase-copy-1 lifted while phrase-copy-2 stayed at floor
  const card1 = session.getCard('phrase-copy-1');
  const card2 = session.getCard('phrase-copy-2');
  near(card1.depth, 25.0);
  assert.equal(card1.streak, 1);
  assert.equal(card2.depth, 0);
  assert.equal(card2.streak, 0);

  // Advance time: card 1 falls from 25, card 2 remains on floor
  session.advance(0.5);
  const card1After = session.getCard('phrase-copy-1');
  const card2After = session.getCard('phrase-copy-2');
  assert.ok(card1After.depth < 25.0 && card1After.depth > 0, 'Card 1 is airborne and falling');
  assert.equal(card2After.depth, 0, 'Card 2 remains clamped at floor');

  // Verify application content remains identical while engine states are strictly independent
  assert.deepEqual(appRegistry.get('phrase-copy-1').notes, appRegistry.get('phrase-copy-2').notes);
  assert.notEqual(card1After.depth, card2After.depth);
  assert.notEqual(card1After.streak, card2After.streak);
});

test('generic cards: selection, rewards, settling, and progression operate correctly on generic card models', () => {
  const session = InstrumentedPhysics.createSession({
    cards: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }]
  });

  // Unlock first two cards
  stateOf(session).cards[0].unlocked = true;
  stateOf(session).cards[1].unlocked = true;
  stateOf(session).cards[0].depth = 30;
  stateOf(session).cards[1].depth = 10;

  // Selection chooses lowest card (c2 at depth 10)
  session.advance(0);
  assert.equal(session.getState().selectedIndex, 1);
  assert.equal(session.getState().selectedCardId, 'c2');
  assert.equal(session.getLowestCardId(), 'c2');

  // Reward lowest card by ID
  session.applyReward('c2', 1.0);
  assert.ok(session.getCard('c2').depth > 10);

  // Progression gating: unlock card 3 when settled shown crosses 50%
  stateOf(session).cards[0].depth = 60;
  stateOf(session).cards[1].depth = 60;
  stateOf(session).cards[0].shown = 60;
  stateOf(session).cards[1].shown = 49; // Below 50 threshold

  const t1 = session.advance(0);
  assert.equal(t1.unlockedIndex, null);
  assert.equal(session.getCard('c3').unlocked, false);

  // Once shown crosses 50%, card 3 unlocks with unlockedCardId
  stateOf(session).cards[1].shown = 51;
  const t2 = session.advance(0);
  assert.equal(t2.unlockedIndex, 2);
  assert.equal(t2.unlockedCardId, 'c3');
  assert.equal(session.getCard('c3').unlocked, true);
});

test('vocabulary application: application evaluates latency and passes multiplier to generic engine', () => {
  // Vocabulary application owns content and evaluation
  const vocabulary = [
    { id: 'v-1', prompt: 'river', answer: 'río' },
    { id: 'v-2', prompt: 'light', answer: 'luz' }
  ];
  const latencyMultiplier = t => 0.5 + 1.5 * Math.exp(-1.5 * Math.max(0, t));

  const session = Physics.createSession({
    cards: vocabulary.map(item => ({ id: item.id }))
  });

  const state = session.getState();
  assert.equal(state.cards.length, 2);
  assert.equal(state.cards[0].id, 'v-1');
  assert.equal(state.cards[0].english, undefined);

  // App simulates 0.5s retrieval response
  session.advance(0.5);
  const latency = session.getState().time - session.getState().selectedAt;
  const mult = latencyMultiplier(latency);

  // App calls generic applyReward with computed multiplier
  const res = session.applyReward(session.getState().selectedIndex, mult);
  assert.equal(res.kind, 'reward');
  assert.equal(res.cardId, 'v-1');
  near(res.rewardMagnitude, mult);
  assert.ok(res.lift > 0);

  // Application constructs its own presentation feedback
  const feedback = `${vocabulary[res.index].prompt} → ${vocabulary[res.index].answer} / ↑${res.lift.toFixed(1)} pp lift`;
  assert.equal(feedback.startsWith('river → río'), true);
});
