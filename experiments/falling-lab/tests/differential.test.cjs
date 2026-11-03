/**
 * Differential Test Suite: Mathematical Reference Parity & Engine Artifact Equivalence
 *
 * Verifies:
 * 1. Exact mathematical parity with physics.reference.js for all shared physics equations.
 * 2. Exact structural and behavioral parity between CommonJS build (physics.js) and tsc emit (dist/physics.js).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const refPath = path.join(__dirname, '../core/physics.reference.js');
const tsCompiledPath = path.join(__dirname, '../core/physics.js');
const distPath = path.join(__dirname, '../dist/physics.js');

const RefPhysics = require(refPath);
const TsPhysics = require(tsCompiledPath);
const DistPhysics = require(distPath).MunduPhysics;

const EPS = 1e-12;
function assertNear(actual, expected, message = '') {
  if (typeof actual === 'number' && typeof expected === 'number') {
    if (Object.is(actual, expected)) return;
    const diff = Math.abs(actual - expected);
    assert.ok(diff < EPS, `${message} expected ${expected} ± ${EPS}, got ${actual} (diff: ${diff})`);
  } else {
    assert.deepEqual(actual, expected, message);
  }
}

function compareSnapshots(snapA, snapB, context = '') {
  assert.equal(snapA.time, snapB.time, `${context} time mismatch`);
  assert.equal(snapA.paused, snapB.paused, `${context} paused mismatch`);
  assert.equal(snapA.complete, snapB.complete, `${context} complete mismatch`);
  assert.equal(snapA.selectedIndex, snapB.selectedIndex, `${context} selectedIndex mismatch`);
  assert.equal(snapA.selectedCardId, snapB.selectedCardId, `${context} selectedCardId mismatch`);
  assertNear(snapA.selectedAt, snapB.selectedAt, `${context} selectedAt mismatch`);
  assert.equal(snapA.skippedIndex, snapB.skippedIndex, `${context} skippedIndex mismatch`);
  assert.equal(snapA.skippedCardId, snapB.skippedCardId, `${context} skippedCardId mismatch`);
  assert.equal(snapA.rewardCount, snapB.rewardCount, `${context} rewardCount mismatch`);
  assert.equal(snapA.skipCount, snapB.skipCount, `${context} skipCount mismatch`);
  assert.equal(snapA.unlockedCardCount, snapB.unlockedCardCount, `${context} unlockedCardCount mismatch`);
  assertNear(snapA.gravityMultiplier, snapB.gravityMultiplier, `${context} gravityMultiplier mismatch`);
  assertNear(snapA.fieldFallTime, snapB.fieldFallTime, `${context} fieldFallTime mismatch`);
  assertNear(snapA.baselineKickTime, snapB.baselineKickTime, `${context} baselineKickTime mismatch`);
  assert.equal(snapA.cards.length, snapB.cards.length, `${context} cards count mismatch`);

  for (let i = 0; i < snapA.cards.length; i++) {
    const cA = snapA.cards[i];
    const cB = snapB.cards[i];
    assert.equal(cA.id, cB.id, `${context} card[${i}].id mismatch`);
    assert.equal(cA.streak, cB.streak, `${context} card[${i}].streak mismatch`);
    assert.equal(cA.unlocked, cB.unlocked, `${context} card[${i}].unlocked mismatch`);
    assertNear(cA.initialDepth, cB.initialDepth, `${context} card[${i}].initialDepth mismatch`);
    assertNear(cA.depth, cB.depth, `${context} card[${i}].depth mismatch`);
    assertNear(cA.shown, cB.shown, `${context} card[${i}].shown mismatch`);
  }
}

function compareActionResults(resA, resB, context = '') {
  if (resA === null || resB === null) {
    assert.equal(resA, resB, `${context} null result mismatch`);
    return;
  }
  assert.equal(resA.kind, resB.kind, `${context} kind mismatch`);
  assert.equal(resA.index, resB.index, `${context} index mismatch`);
  assert.equal(resA.cardId, resB.cardId, `${context} cardId mismatch`);
  if (resA.kind === 'reward') {
    assertNear(resA.rewardMagnitude, resB.rewardMagnitude, `${context} rewardMagnitude mismatch`);
    assertNear(resA.kickTime, resB.kickTime, `${context} kickTime mismatch`);
    assertNear(resA.lift, resB.lift, `${context} lift mismatch`);
    assertNear(resA.previousDepth, resB.previousDepth, `${context} previousDepth mismatch`);
    assertNear(resA.newDepth, resB.newDepth, `${context} newDepth mismatch`);
  }
  assert.equal(resA.unlockedIndex, resB.unlockedIndex, `${context} unlockedIndex mismatch`);
  assert.equal(resA.unlockedCardId, resB.unlockedCardId, `${context} unlockedCardId mismatch`);
  assert.equal(resA.completedNow, resB.completedNow, `${context} completedNow mismatch`);
}

// -------------------------------------------------------------
// 1. Static Math and Derived Functions Parity
// -------------------------------------------------------------
test('Differential: Defaults Parity', () => {
  for (const Engine of [TsPhysics, DistPhysics]) {
    assert.deepEqual(Engine.DEFAULTS, RefPhysics.DEFAULTS);
  }
});

test('Differential: Math Functions across Parameter Matrix', () => {
  const configs = [
    RefPhysics.DEFAULTS,
    { bounds: { top: 100, bottom: 0 }, motion: { topFallingSpeed: 2.5, kickHeightPercent: 40, bottomToTopMultiplier: 3, gravityReductionPercent: 2 }, unlock: { threshold: 45 }, finish: { threshold: 85 }, instantPosition: false },
    { bounds: { top: 100, bottom: 0 }, motion: { topFallingSpeed: 0.5, kickHeightPercent: 15, bottomToTopMultiplier: 1, gravityReductionPercent: 0 }, unlock: { threshold: 60 }, finish: { threshold: 95 }, instantPosition: true }
  ];

  for (const config of configs) {
    for (const cardCount of [1, 2, 5, 10, 20]) {
      const refGrav = RefPhysics.gravityMultiplier(config, cardCount);
      const tsGrav = TsPhysics.gravityMultiplier(config, cardCount);
      const distGrav = DistPhysics.gravityMultiplier(config, cardCount);
      assertNear(tsGrav, refGrav);
      assertNear(distGrav, refGrav);

      const refDerived = RefPhysics.derivedMotion(config, cardCount);
      const tsDerived = TsPhysics.derivedMotion(config, cardCount);
      const distDerived = DistPhysics.derivedMotion(config, cardCount);
      assertNear(tsDerived.baseFallingSpeed, refDerived.baseFallingSpeed);
      assertNear(distDerived.baseFallingSpeed, refDerived.baseFallingSpeed);
      assertNear(tsDerived.baseKick, refDerived.baseKick);
      assertNear(distDerived.baseKick, refDerived.baseKick);
      assertNear(tsDerived.fieldFallTime, refDerived.fieldFallTime);
      assertNear(distDerived.fieldFallTime, refDerived.fieldFallTime);
      assertNear(tsDerived.baselineKickTime, refDerived.baselineKickTime);
      assertNear(distDerived.baselineKickTime, refDerived.baselineKickTime);

      for (const pos of [0, 10, 25, 50, 75, 90, 100]) {
        assertNear(TsPhysics.scalingFactor(pos, config), RefPhysics.scalingFactor(pos, config));
        assertNear(DistPhysics.scalingFactor(pos, config), RefPhysics.scalingFactor(pos, config));

        assertNear(TsPhysics.fallingSpeed(pos, config, cardCount), RefPhysics.fallingSpeed(pos, config, cardCount));
        assertNear(DistPhysics.fallingSpeed(pos, config, cardCount), RefPhysics.fallingSpeed(pos, config, cardCount));

        assertNear(TsPhysics.timeCoordinate(pos, config, cardCount), RefPhysics.timeCoordinate(pos, config, cardCount));
        assertNear(DistPhysics.timeCoordinate(pos, config, cardCount), RefPhysics.timeCoordinate(pos, config, cardCount));

        assertNear(TsPhysics.fullKick(pos, config, cardCount), RefPhysics.fullKick(pos, config, cardCount));
        assertNear(DistPhysics.fullKick(pos, config, cardCount), RefPhysics.fullKick(pos, config, cardCount));

        for (const t of [0, 0.5, 1.5, 3.0, 10.0]) {
          assertNear(TsPhysics.positionAtTime(t, config, cardCount), RefPhysics.positionAtTime(t, config, cardCount));
          assertNear(DistPhysics.positionAtTime(t, config, cardCount), RefPhysics.positionAtTime(t, config, cardCount));

          assertNear(TsPhysics.reverseFallingTime(pos, t, config, cardCount), RefPhysics.reverseFallingTime(pos, t, config, cardCount));
          assertNear(DistPhysics.reverseFallingTime(pos, t, config, cardCount), RefPhysics.reverseFallingTime(pos, t, config, cardCount));

          assertNear(TsPhysics.fallingDepth(pos, t, config, cardCount), RefPhysics.fallingDepth(pos, t, config, cardCount));
          assertNear(DistPhysics.fallingDepth(pos, t, config, cardCount), RefPhysics.fallingDepth(pos, t, config, cardCount));
        }
      }
    }
  }
});

// -------------------------------------------------------------
// 2. Sequential Falling Over Time (Artifact Parity)
// -------------------------------------------------------------
test('Differential: Sequential Falling Over Subdivided and Irregular Time', () => {
  const ts = TsPhysics.createSession({ cardCount: 5 });
  const dist = DistPhysics.createSession({ cardCount: 5 });

  compareSnapshots(ts.getState(), dist.getState(), 'initial');

  const steps = [1/60, 1/60, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 0.001, 0];
  for (const dt of steps) {
    const resTs = ts.advance(dt);
    const resDist = dist.advance(dt);
    assert.deepEqual(resDist, resTs, `advance(${dt}) return mismatch`);
    compareSnapshots(ts.getState(), dist.getState(), `after advance(${dt})`);
    assertNear(ts.getProgress(), dist.getProgress());
  }
});

// -------------------------------------------------------------
// 3. Rewards across Multipliers (Artifact Parity)
// -------------------------------------------------------------
test('Differential: Rewards across Multipliers', () => {
  const ts = TsPhysics.createSession({ cardCount: 5 });
  const dist = DistPhysics.createSession({ cardCount: 5 });

  const multipliers = [0.5, 1.0, 1.5, 2.0, 0.835];
  for (const mult of multipliers) {
    ts.advance(0.5);
    dist.advance(0.5);

    const tsAns = ts.applyReward(mult);
    const distAns = dist.applyReward(mult);
    compareActionResults(tsAns, distAns, `applyReward with multiplier ${mult}`);
    compareSnapshots(ts.getState(), dist.getState(), `snapshot after applyReward ${mult}`);
  }
});

// -------------------------------------------------------------
// 4. Skipping and Target Switching (Artifact Parity)
// -------------------------------------------------------------
test('Differential: Skip Mechanics and Selection Cycling', () => {
  // Single card skip
  const ts1 = TsPhysics.createSession({ cardCount: 1 });
  const dist1 = DistPhysics.createSession({ cardCount: 1 });
  ts1.advance(1.0);
  dist1.advance(1.0);
  compareActionResults(ts1.skip(), dist1.skip(), 'single-card skip');
  compareSnapshots(ts1.getState(), dist1.getState(), 'single-card skip snapshot');

  // Multi-card active skip
  const ts = TsPhysics.createSession({ cardCount: 4 });
  const dist = DistPhysics.createSession({ cardCount: 4 });

  for (let i = 0; i < 30; i++) {
    ts.advance(0.1);
    dist.advance(0.1);
    if (i % 2 === 0) {
      ts.applyReward(1.0);
      dist.applyReward(1.0);
    }
  }

  for (let s = 0; s < 5; s++) {
    ts.advance(0.2);
    dist.advance(0.2);
    const tsSkip = ts.skip();
    const distSkip = dist.skip();
    compareActionResults(tsSkip, distSkip, `multi-card skip ${s}`);
    compareSnapshots(ts.getState(), dist.getState(), `multi-card skip ${s} snapshot`);
  }
});

// -------------------------------------------------------------
// 5. Progressive Unlocking and Game Progression (Artifact Parity)
// -------------------------------------------------------------
test('Differential: Progressive Unlocking Sequence to Full Cards', () => {
  const ts = TsPhysics.createSession({ cardCount: 6 });
  const dist = DistPhysics.createSession({ cardCount: 6 });

  let attempts = 0;
  while (!ts.isComplete() && attempts < 150) {
    attempts++;
    const dt = 0.25;
    const tsTrans = ts.advance(dt);
    const distTrans = dist.advance(dt);
    assert.deepEqual(distTrans, tsTrans, `unlock advance step ${attempts}`);

    const tsAns = ts.applyReward(1.5);
    const distAns = dist.applyReward(1.5);
    compareActionResults(tsAns, distAns, `unlock reward step ${attempts}`);
    compareSnapshots(ts.getState(), dist.getState(), `unlock snapshot step ${attempts}`);

    if (ts.isComplete()) break;
  }

  assert.equal(dist.isComplete(), ts.isComplete());
  assert.equal(ts.isComplete(), true, 'Session reached completion');
});

// -------------------------------------------------------------
// 6. Pause, Resume, and Time Exclusion (Artifact Parity)
// -------------------------------------------------------------
test('Differential: Pause/Resume Freezing', () => {
  const ts = TsPhysics.createSession({ cardCount: 3 });
  const dist = DistPhysics.createSession({ cardCount: 3 });

  ts.advance(0.8);
  dist.advance(0.8);

  ts.setPaused(true);
  dist.setPaused(true);
  compareSnapshots(ts.getState(), dist.getState(), 'paused snapshot');

  const tsAdvance = ts.advance(5.0);
  const distAdvance = dist.advance(5.0);
  assert.deepEqual(distAdvance, tsAdvance);
  assert.equal(ts.applyReward(1.0), null);
  assert.equal(dist.applyReward(1.0), null);
  assert.equal(ts.skip(), null);
  assert.equal(dist.skip(), null);
  compareSnapshots(ts.getState(), dist.getState(), 'post paused advance snapshot');

  ts.setPaused(false);
  dist.setPaused(false);
  ts.advance(0.5);
  dist.advance(0.5);
  compareSnapshots(ts.getState(), dist.getState(), 'post resume snapshot');
});

// -------------------------------------------------------------
// 7. Live Dynamic Configuration Updates (Artifact Parity)
// -------------------------------------------------------------
test('Differential: Configuration Patches and Rechecking Completion', () => {
  const ts = TsPhysics.createSession({ cardCount: 5 });
  const dist = DistPhysics.createSession({ cardCount: 5 });

  const patches = [
    { motion: { topFallingSpeed: 2 } },
    { motion: { kickHeightPercent: 50, bottomToTopMultiplier: 8 } },
    { unlock: { threshold: 40 } },
    { finish: { threshold: 85 } },
    { instantPosition: true }
  ];

  for (const patch of patches) {
    const resTs = ts.configure(patch);
    const resDist = dist.configure(patch);
    assert.deepEqual(resDist, resTs, `configure patch ${JSON.stringify(patch)}`);
    compareSnapshots(ts.getState(), dist.getState(), `snapshot after configure ${JSON.stringify(patch)}`);
  }
});

// -------------------------------------------------------------
// 8. Boundary Conditions and Error Handling (Artifact Parity)
// -------------------------------------------------------------
test('Differential: Boundary Value Enforcement and Exceptions', () => {
  const ts = TsPhysics.createSession({ cardCount: 3 });
  const dist = DistPhysics.createSession({ cardCount: 3 });

  for (const invalid of [-1, -0.001, NaN, Infinity]) {
    assert.throws(() => ts.advance(invalid), RangeError);
    assert.throws(() => dist.advance(invalid), RangeError);
  }

  assert.throws(() => ts.applyReward(0, -1), RangeError);
  assert.throws(() => dist.applyReward(0, -1), RangeError);

  assert.throws(() => ts.setPaused('true'), TypeError);
  assert.throws(() => dist.setPaused('true'), TypeError);

  for (const badConfig of [
    { unknownField: 1 },
    { motion: { topFallingSpeed: -1 } },
    { motion: { kickHeightPercent: 0 } },
    { motion: { kickHeightPercent: 101 } },
    { motion: { bottomToTopMultiplier: 0.5 } },
    { motion: { gravityReductionPercent: 15 } },
    { unlock: { threshold: 95 }, finish: { threshold: 90 } }
  ]) {
    assert.throws(() => ts.configure(badConfig), RangeError);
    assert.throws(() => dist.configure(badConfig), RangeError);
  }

  ts.configure({ instantPosition: true, motion: { kickHeightPercent: 100 } });
  dist.configure({ instantPosition: true, motion: { kickHeightPercent: 100 } });
  for (let i = 0; i < 5; i++) {
    ts.applyReward(1.0);
    dist.applyReward(1.0);
    assert.equal(ts.getState().cards[0].depth, 100);
    assert.equal(dist.getState().cards[0].depth, 100);
  }

  const freshTs = TsPhysics.createSession({ cardCount: 3 });
  const freshDist = DistPhysics.createSession({ cardCount: 3 });
  freshTs.advance(1000);
  freshDist.advance(1000);
  assert.equal(freshTs.getState().cards[0].depth, 0);
  assert.equal(freshDist.getState().cards[0].depth, 0);
});
