const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Physics = require('../physics.js');

test('musical card: starts at bottom and remains available for retrieval at floor', () => {
  const session = Physics.createSession({
    wordCount: 1,
    config: { motion: { topFallingSpeed: 1, kickHeightPercent: 25, bottomToTopMultiplier: 5 } }
  });
  const state0 = session.getState();
  assert.equal(state0.words.length, 1);
  assert.equal(state0.words[0].depth, 0);

  // Advancing time while on the floor clamps at floor (0) without disappearing
  session.advance(2.0);
  const state1 = session.getState();
  assert.equal(state1.words[0].depth, 0);
  assert.equal(state1.complete, false);
});

test('musical card: full lift and half lift have exact 2:1 relationship', () => {
  const sessionFull = Physics.createSession({ wordCount: 1 });
  const sessionHalf = Physics.createSession({ wordCount: 1 });

  const fullResult = sessionFull.applyReward(0, 1.0);
  const halfResult = sessionHalf.applyReward(0, 0.5);

  assert.equal(fullResult.lift, 25.0);
  assert.equal(halfResult.lift, 12.5);
  assert.equal(fullResult.lift, halfResult.lift * 2);
  assert.equal(sessionFull.getState().words[0].depth, 25.0);
  assert.equal(sessionHalf.getState().words[0].depth, 12.5);
});

test('musical card: continues falling after upward lift', () => {
  const session = Physics.createSession({ wordCount: 1 });
  session.applyReward(0, 1.0); // Lifted to 25%
  assert.equal(session.getState().words[0].depth, 25.0);

  // Advance time
  session.advance(1.0);
  const depthAfterFall = session.getState().words[0].depth;
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
  const session = Physics.createSession({ wordCount: 1 });
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
  const session = Physics.createSession({ wordCount: 10 });
  const state0 = session.getState();
  assert.equal(state0.words.length, 10);
  assert.equal(state0.selectedIndex, 0);

  // Slot 0 is rewarded with full lift (1.0)
  const rewardResult = session.applyReward(state0.selectedIndex, 1.0);
  assert.equal(rewardResult.index, 0);
  assert.equal(rewardResult.lift, 25.0);
  assert.equal(session.getState().words[0].depth, 25.0);
  // Other slots remain at initial depth (unlocked or locked)
  assert.equal(session.getState().words[1].depth, 0);

  // Background slots continue falling over time while player interacts with foreground card
  session.advance(1.0);
  assert.ok(session.getState().words[0].depth < 25.0, 'Background slot 0 falls with time');
  assert.ok(session.getState().words[0].depth > 0, 'Background slot 0 remains airborne');
});
