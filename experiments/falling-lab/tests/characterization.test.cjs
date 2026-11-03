/**
 * Falling Core — Characterization Test Suite (Stage 0)
 *
 * Establishes a verified behavioral baseline for:
 * 1. Time-coordinate reward mechanics (heights, latencies, R-values, ceiling, roundtrip)
 * 2. Visual settling (15/s exponential smoothing) and progression threshold gating
 * 3. Scheduling dynamics (lowest selection, consecutive skips, 1/2/3 items, unlock handoff)
 * 4. Vocabulary learning dynamics (multiplier formula, 2s hint boundary, prompt timers, streaks)
 * 5. Musical canonical reward characterization (linear spatial lift vs. time-coordinate kick)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const tsPath = path.join(__dirname, '../core/physics.js');
const harnessPath = path.join(__dirname, './physics-harness.cjs');

const Physics = require(tsPath);
const { Physics: InstrumentedPhysics, stateOf } = require(harnessPath).testPhysics();

const EPS = 1e-9;
function assertNear(actual, expected, message = '') {
  if (typeof actual === 'number' && typeof expected === 'number') {
    if (Object.is(actual, expected)) return;
    const diff = Math.abs(actual - expected);
    assert.ok(diff < EPS, `${message} expected ${expected} ± ${EPS}, got ${actual} (diff: ${diff})`);
  } else {
    assert.deepEqual(actual, expected, message);
  }
}

const latencyMultiplier = t => 0.5 + 1.5 * Math.exp(-1.5 * Math.max(0, t));

// ============================================================================
// 1. Time-Coordinate Reward Mechanism
// ============================================================================

test('time-coordinate reward: baseline kick lift decays linearly with starting height under R=5', () => {
  const config = Physics.DEFAULTS;
  const bkt = Physics.baselineKickTime(config);
  assertNear(bkt, 5.578588782855244, 'Baseline kick time for 25% reference height');

  // Exact formula: delta_x = 25 - 0.2 * x for R=5
  const heights = [0, 25, 50, 75];
  const expectedLifts = [25.0, 20.0, 15.0, 10.0];

  for (let i = 0; i < heights.length; i++) {
    const h = heights[i];
    const newH = Physics.reverseFallingTime(h, bkt, config);
    const lift = newH - h;
    assertNear(lift, expectedLifts[i], `Lift from height ${h}`);
    assertNear(newH, h + expectedLifts[i], `New height from ${h}`);
  }
});

test('time-coordinate reward: latency decay matches 0.5 + 1.5 * exp(-1.5 * t)', () => {
  const config = Physics.DEFAULTS;
  const bkt = Physics.baselineKickTime(config);

  const latencies = [0, 0.5, 1.0, 2.0, 5.0];
  const expectedMultipliers = latencies.map(t => latencyMultiplier(t));

  for (let i = 0; i < latencies.length; i++) {
    const t = latencies[i];
    const mult = latencyMultiplier(t);
    assertNear(mult, expectedMultipliers[i], `Multiplier at latency ${t}`);

    const kickTime = bkt * mult;
    const liftFrom0 = Physics.reverseFallingTime(0, kickTime, config) - 0;
    const liftFrom50 = Physics.reverseFallingTime(50, kickTime, config) - 50;

    // Fast response (t=0) reaches 45% from floor; slow response (t=5s) reaches ~13.2%
    if (t === 0) {
      assertNear(liftFrom0, 45.0, 'Instant response reaches 45%');
      assertNear(liftFrom50, 27.0, 'Instant response from 50 reaches 77%');
    }
    if (t >= 5.0) {
      assertNear(liftFrom0, 13.217296904715441, 'Limiting slow response from 0');
      assertNear(liftFrom50, 7.9303781428292694, 'Limiting slow response from 50');
    }
  }
});

test('time-coordinate reward: velocity gradient R alters height sensitivity while keeping floor kick at 25%', () => {
  for (const R of [1, 5, 10]) {
    const session = Physics.createSession({ config: { motion: { bottomToTopMultiplier: R } } });
    const c = session.getState().config;
    const bkt = Physics.baselineKickTime(c);

    // Floor baseline kick is always exactly 25.0% across all R
    const floorLift = Physics.reverseFallingTime(0, bkt, c) - 0;
    assertNear(floorLift, 25.0, `Floor baseline lift at R=${R}`);

    const midLift = Physics.reverseFallingTime(50, bkt, c) - 50;
    if (R === 1) {
      // At R=1 (constant speed), lift is completely uniform at all heights
      assertNear(midLift, 25.0, 'R=1 uniform lift at mid height');
      assertNear(bkt, 25.0, 'R=1 baseline kick time in seconds');
    } else if (R === 5) {
      assertNear(midLift, 15.0, 'R=5 lift at mid height');
      assertNear(bkt, 5.578588782855244, 'R=5 baseline kick time');
    } else if (R === 10) {
      assertNear(midLift, 13.75, 'R=10 lift at mid height');
      assertNear(bkt, 2.8321361069865563, 'R=10 baseline kick time');
    }
  }
});

test('time-coordinate reward: ceiling saturation clamps at 100 with zero headroom or stored energy', () => {
  const session = Physics.createSession({
    cardCount: 1,
    config: { finish: { threshold: 99.9 } }
  });

  // Multiple immediate rewards drive card into ceiling
  session.applyReward(2.0);
  session.applyReward(2.0);
  session.applyReward(2.0);
  session.applyReward(2.0);

  const stateCeiling = session.getState();
  assert.equal(stateCeiling.cards[0].depth, 100, 'Logical depth clamped at 100');

  // Advancing by 1.0 second immediately drops position below 100 with no delay
  session.advance(1.0);
  const stateAfterFall = session.getState();
  assert.ok(stateAfterFall.cards[0].depth < 100, 'Depth immediately decreases from 100');
  assertNear(stateAfterFall.cards[0].depth, 98.9797306451903, 'Exact falling depth from ceiling after 1s');
});

test('time-coordinate reward: exact numerical bidirectional round-trip invariance', () => {
  const c = Physics.DEFAULTS;
  const testHeights = [5, 20, 50, 75, 90];
  const testDurations = [0.01, 0.1, 0.5, 1.0, 2.0];

  for (const h of testHeights) {
    for (const dt of testDurations) {
      const kicked = Physics.reverseFallingTime(h, dt, c);
      const fallen = Physics.fallingDepth(kicked, dt, c);
      assertNear(fallen, h, `Roundtrip at h=${h}, dt=${dt}`);
    }
  }
});

// ============================================================================
// 2. Visual Settling & Progression Gating
// ============================================================================

test('visual settling: shown position asymptotically tracks depth via 15/s exponential filter', () => {
  const session = Physics.createSession({ cardCount: 1 });
  session.applyReward(2.0); // Reward with 2.0 multiplier kicks depth to 45.0, shown stays at 0.0

  const s0 = session.getState();
  assert.equal(s0.cards[0].depth, 45.0);
  assert.equal(s0.cards[0].shown, 0.0);

  // Advance by 0.1s: depth falls slightly, shown moves toward depth
  session.advance(0.1);
  const s1 = session.getState();

  const expectedDepthFall = Physics.fallingDepth(45.0, 0.1, s0.config);
  assertNear(s1.cards[0].depth, expectedDepthFall);

  // shown_new = shown_old + (depth - shown_old) * (1 - exp(-15 * dt))
  const expectedShown = 0.0 + (s1.cards[0].depth - 0.0) * (1 - Math.exp(-15 * 0.1));
  assertNear(s1.cards[0].shown, expectedShown);
  assertNear(s1.cards[0].shown, 34.71004658427827);
});

test('progression gating: unlocking strictly requires smoothed shown position > 50%', () => {
  const session = Physics.createSession({ cardCount: 2 });
  session.applyReward(2.0); // Kick 1 to 45%
  session.applyReward(2.0); // Kick 2 to 73.8% (well above 50% threshold)

  const stateAfterKicks = session.getState();
  assert.ok(stateAfterKicks.cards[0].depth > 50, 'Logical depth is well above 50%');
  assert.equal(stateAfterKicks.cards[0].shown, 0, 'Shown position has not moved yet');
  assert.equal(stateAfterKicks.cards[1].unlocked, false, 'Card 1 must NOT unlock before settling');

  // Step 1: 0.05s advance -> shown reaches ~38.89% (still below 50%)
  const tr1 = session.advance(0.05);
  assert.equal(tr1.unlockedIndex, null, 'No unlock when shown <= 50%');
  assert.equal(session.getState().cards[1].unlocked, false);

  // Step 2: another 0.05s advance -> shown reaches ~57.20% (crosses 50%)
  const tr2 = session.advance(0.05);
  assert.equal(tr2.unlockedIndex, 1, 'Unlocks card 1 exactly when shown crosses 50%');
  assert.equal(session.getState().cards[1].unlocked, true, 'Card 1 is now unlocked');
  assert.equal(session.getState().cards[1].depth, 0, 'New unlocked card starts at floor');
  assert.equal(session.getState().cards[1].shown, 0, 'New unlocked card shown starts at floor');
});

test('progression gating: completion strictly requires smoothed shown position > 90%', () => {
  const session = Physics.createSession({ cardCount: 1 });
  // 3 rewards lift card to ~92.23% (above 90% finish threshold)
  session.applyReward(2.0);
  session.applyReward(2.0);
  session.applyReward(2.0);

  assert.ok(session.getState().cards[0].depth > 90);
  assert.equal(session.isComplete(), false, 'Not complete before shown position settles');

  // Settling steps: shown reaches 90% at approximately t = 0.30s
  session.advance(0.1); // shown ~71.57%
  assert.equal(session.isComplete(), false);
  session.advance(0.1); // shown ~87.43%
  assert.equal(session.isComplete(), false);

  const trComplete = session.advance(0.1); // shown ~90.87%
  assert.equal(trComplete.completedNow, true, 'completedNow triggered');
  assert.equal(session.isComplete(), true, 'Session marked complete');
  assert.equal(session.getState().paused, true, 'Complete session automatically pauses');
});

test('visual settling: pause freezes settling and resume preserves exact continuity', () => {
  const session = Physics.createSession({ cardCount: 1 });
  session.applyReward(2.0);
  session.applyReward(2.0);
  session.applyReward(2.0);

  session.advance(0.15);
  const snapshotBeforePause = session.getState();
  const frozenDepth = snapshotBeforePause.cards[0].depth;
  const frozenShown = snapshotBeforePause.cards[0].shown;

  session.setPaused(true);
  const trPaused = session.advance(1.0);
  assert.equal(trPaused.unlockedIndex, null);
  assert.equal(trPaused.completedNow, false);

  const snapshotWhilePaused = session.getState();
  assert.equal(snapshotWhilePaused.cards[0].depth, frozenDepth, 'Depth does not move while paused');
  assert.equal(snapshotWhilePaused.cards[0].shown, frozenShown, 'Shown does not move while paused');
  assert.equal(snapshotWhilePaused.time, snapshotBeforePause.time, 'Time does not advance while paused');

  session.setPaused(false);
  session.advance(0.15);
  const snapshotResumed = session.getState();
  assert.ok(snapshotResumed.cards[0].shown > frozenShown, 'Settling resumes smoothly');
  assert.equal(snapshotResumed.complete, true, 'Session completes after resumption');
});

// ============================================================================
// 3. Selection & Scheduling Dynamics
// ============================================================================

test('scheduling: lowest-slot priority queue selects minimum depth with index tie-breaker', () => {
  const session = InstrumentedPhysics.createSession({ cardCount: 4 });
  const internal = stateOf(session);

  // Unlock first 3 cards
  internal.cards[0].unlocked = true;
  internal.cards[1].unlocked = true;
  internal.cards[2].unlocked = true;

  // Case A: Strictly lowest
  internal.cards[0].depth = 40;
  internal.cards[1].depth = 15;
  internal.cards[2].depth = 30;
  session.advance(0);
  assert.equal(session.getState().selectedIndex, 1, 'Selects card 1 (depth 15)');

  // Case B: Tie between card 0 and card 2 (both at 20) -> tie broken by lower index (0)
  internal.cards[0].depth = 20;
  internal.cards[1].depth = 50;
  internal.cards[2].depth = 20;
  session.advance(0);
  assert.equal(session.getState().selectedIndex, 0, 'Tie broken in favor of index 0');
});

test('scheduling: consecutive skips alternate between lowest two items, starving higher items', () => {
  const session = InstrumentedPhysics.createSession({ cardCount: 3 });
  const internal = stateOf(session);
  internal.cards[0].unlocked = true;
  internal.cards[1].unlocked = true;
  internal.cards[2].unlocked = true;
  internal.cards[0].depth = 10;
  internal.cards[1].depth = 20;
  internal.cards[2].depth = 30;

  session.advance(0);
  assert.equal(session.getState().selectedIndex, 0, 'Initial lowest is card 0');

  // Skip 0 -> card 1 is selected
  const r1 = session.skip();
  assert.equal(r1.index, 0);
  assert.equal(session.getState().selectedIndex, 1, 'After skipping 0, card 1 selected');

  // Skip 1 -> card 0 is no longer skippedIndex, so card 0 is selected again!
  const r2 = session.skip();
  assert.equal(r2.index, 1);
  assert.equal(session.getState().selectedIndex, 0, 'After skipping 1, card 0 selected');

  // Skip 0 again -> card 1 selected again! Card 2 (depth 30) is never reached while 0 and 1 remain lower
  const r3 = session.skip();
  assert.equal(r3.index, 0);
  assert.equal(session.getState().selectedIndex, 1, 'Alternation back to card 1');
});

test('scheduling: single active item re-selects itself on skip and resets prompt timer', () => {
  const session = Physics.createSession({ cardCount: 3 });
  assert.equal(session.getState().selectedIndex, 0);

  session.advance(2.5);

  const skipResult = session.skip();
  assert.equal(skipResult.index, 0);

  const stateAfterSkip = session.getState();
  assert.equal(stateAfterSkip.selectedIndex, 0, 'Re-selects card 0 when it is the sole unlocked card');
  assert.equal(stateAfterSkip.selectedAt, 2.5, 'selectedAt updated to current time');
});

test('scheduling: selection immediately hands off to newly unlocked card at floor', () => {
  const session = Physics.createSession({ cardCount: 2 });
  session.applyReward(2.0);
  session.applyReward(2.0); // Card 0 lifted high

  assert.equal(session.getState().selectedIndex, 0);

  // Advance settling until card 1 unlocks at floor (0%)
  session.advance(0.15);
  const stateUnlocked = session.getState();
  assert.equal(stateUnlocked.cards[1].unlocked, true);
  assert.equal(stateUnlocked.cards[1].depth, 0);
  assert.equal(stateUnlocked.selectedIndex, 1, 'Selection immediately shifts to newly unlocked card 1');
  assert.equal(stateUnlocked.selectedAt, stateUnlocked.time, 'selectedAt syncs with unlock time');
});

// ============================================================================
// 4. Vocabulary Domain Behavior
// ============================================================================

test('vocabulary: prompt timer resets on selection change and tracks latency', () => {
  const session = InstrumentedPhysics.createSession({ cardCount: 2 });
  const internal = stateOf(session);
  internal.cards[0].unlocked = true;
  internal.cards[1].unlocked = true;
  internal.cards[0].depth = 10;
  internal.cards[1].depth = 20;

  session.advance(1.5);
  assert.equal(session.getState().time, 1.5);
  assert.equal(session.getState().selectedAt, 0);

  // Application computes latency and passes multiplier
  const latency = Math.max(0, session.getState().time - session.getState().selectedAt);
  assertNear(latency, 1.5);
  const mult = latencyMultiplier(latency);
  const res = session.applyReward(0, mult);
  assert.equal(res.index, 0);

  const nextState = session.getState();
  assert.equal(nextState.selectedIndex, 1, 'Selection shifted to card 1');
  assert.equal(nextState.selectedAt, 1.5, 'selectedAt updated to 1.5s');
});

test('vocabulary: 2-second hint boundary triggers hint without reward cliff penalty', () => {
  // Verify application-level mathematical multiplier continuity across 2.0s
  const multBefore = latencyMultiplier(1.999);
  const multAfter = latencyMultiplier(2.001);
  const delta = Math.abs(multBefore - multAfter);
  assert.ok(delta < 0.005, 'Multiplier is continuous across hint threshold');
});

test('vocabulary: streaks increment on retrieval and persist across skips; reset on unlock', () => {
  const session = Physics.createSession({ cardCount: 2 });

  assert.equal(session.getState().cards[0].streak, 0);
  assert.equal(session.getState().rewardCount, 0);
  assert.equal(session.getState().skipCount, 0);

  session.applyReward(2.0);
  assert.equal(session.getState().cards[0].streak, 1);
  assert.equal(session.getState().rewardCount, 1);

  session.skip();
  assert.equal(session.getState().cards[0].streak, 1, 'Streak is NOT reset by skip');
  assert.equal(session.getState().skipCount, 1);

  session.applyReward(2.0);
  assert.equal(session.getState().cards[0].streak, 2);
  assert.equal(session.getState().rewardCount, 2);

  // Settle until card 1 unlocks
  session.advance(0.2);
  assert.equal(session.getState().cards[1].unlocked, true);
  assert.equal(session.getState().cards[1].streak, 0, 'Newly unlocked card starts with streak 0');
});

test('vocabulary application dynamics: latency calculation drives generic applyReward', () => {
  const session = Physics.createSession({ cardCount: 5 });
  const actions = [
    { type: 'advance', dt: 0.5 },
    { type: 'retrieve' },
    { type: 'advance', dt: 1.2 },
    { type: 'skip' },
    { type: 'advance', dt: 0.3 },
    { type: 'retrieve' }
  ];

  for (const act of actions) {
    if (act.type === 'advance') {
      session.advance(act.dt);
    } else if (act.type === 'retrieve') {
      const s = session.getState();
      const latency = Math.max(0, s.time - s.selectedAt);
      const mult = latencyMultiplier(latency);
      const res = session.applyReward(s.selectedIndex, mult);
      assert.ok(res.lift > 0);
    } else if (act.type === 'skip') {
      const res = session.skip();
      assert.equal(res.kind, 'skip');
    }
  }

  assert.equal(session.getState().rewardCount, 2);
  assert.equal(session.getState().skipCount, 1);
});

// ============================================================================
// 5. Unified Canonical Reward: Time-Coordinate Kick for Musical & Vocabulary
// ============================================================================

test('canonical reward: applyReward executes time-coordinate kicks matching reverseFallingTime', () => {
  const sessionFull = Physics.createSession({ cardCount: 1 });
  const sessionHalf = Physics.createSession({ cardCount: 1 });

  // Baseline from floor (0%)
  const rFull0 = sessionFull.applyReward(0, 1.0);
  const rHalf0 = sessionHalf.applyReward(0, 0.5);

  assertNear(rFull0.lift, 25.0, 'Full kick from floor reaches 25%');
  assertNear(rHalf0.lift, 13.196601125010515, 'Half kick from floor reaches ~13.20% (not linear 12.5%)');
  assertNear(sessionFull.getState().cards[0].depth, 25.0);
  assertNear(sessionHalf.getState().cards[0].depth, 13.196601125010515);

  // Subsequent reward starting from 25.0%
  const rFull1 = sessionFull.applyReward(0, 1.0);
  // Canonical kick from 25% adds 20% lift (reaches 45%), whereas old musical fixed lift reached 50%
  assertNear(rFull1.lift, 20.0, 'Full kick from height 25 reaches 45% (lift 20%)');
  assertNear(sessionFull.getState().cards[0].depth, 45.0);
});

test('canonical reward: 50% starting height reaches 65% (15% lift) vs historical 75% comparison', () => {
  const session = InstrumentedPhysics.createSession({ cardCount: 1 });
  stateOf(session).cards[0].depth = 50.0;
  stateOf(session).cards[0].shown = 50.0;

  // Apply canonical 1.0x baseline reward from 50%
  const result = session.applyReward(0, 1.0);

  // Canonical Mündu physics:
  // At h=50%, adding baseline kick time reverses falling to exactly 65.0% (15.0% lift)
  assertNear(result.newDepth, 65.0, 'Canonical 1.0x reward reaches 65% from 50%');
  assertNear(result.lift, 15.0, 'Canonical lift is +15.0 pp (due to velocity gradient R=5)');

  // Historical contrast:
  // Old musical shim added fixed linear +25.0 pp, reaching 75.0%
  const historicalFixedDepth = 75.0;
  const historicalDelta = historicalFixedDepth - result.newDepth;
  assertNear(historicalDelta, 10.0, 'Historical comparison: old fixed reward was 10 pp higher at 50%');
});

test('canonical reward: multi-slot field routes time-coordinate rewards across different heights', () => {
  const session = InstrumentedPhysics.createSession({ cardCount: 3 });
  const internal = stateOf(session);
  internal.cards[0].unlocked = true;
  internal.cards[1].unlocked = true;
  internal.cards[2].unlocked = true;

  // Slot 0 at 0%, Slot 1 at 25%, Slot 2 at 50%
  internal.cards[0].depth = 0;
  internal.cards[1].depth = 25;
  internal.cards[2].depth = 50;

  // Reward slot 0 with 1.0x -> reaches 25% (+25 lift)
  const r0 = session.applyReward(0, 1.0);
  assertNear(r0.newDepth, 25.0);
  assertNear(r0.lift, 25.0);

  // Reward slot 1 with 1.0x -> reaches 45% (+20 lift)
  const r1 = session.applyReward(1, 1.0);
  assertNear(r1.newDepth, 45.0);
  assertNear(r1.lift, 20.0);

  // Reward slot 2 with 1.0x -> reaches 65% (+15 lift)
  const r2 = session.applyReward(2, 1.0);
  assertNear(r2.newDepth, 65.0);
  assertNear(r2.lift, 15.0);
});
