/**
 * Differential Test Suite: Reference JavaScript vs. Compiled TypeScript Engine
 *
 * Verifies exact numerical and structural equivalence between:
 * 1. physics.reference.js (original unaltered JS engine)
 * 2. physics.js (compiled/bundled from physics.ts)
 * 3. dist/physics.js (direct tsc emitted CommonJS module)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const refPath = path.join(__dirname, '../physics.reference.js');
const tsCompiledPath = path.join(__dirname, '../physics.js');
const distPath = path.join(__dirname, '../dist/physics.js');

const RefPhysics = require(refPath);
const TsPhysics = require(tsCompiledPath);
const DistPhysics = require(distPath).MunduPhysics;

// Float comparison tolerance: exact identity preferred, EPSILON-level noise tolerated for transcendentals.
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
  assertNear(snapA.selectedAt, snapB.selectedAt, `${context} selectedAt mismatch`);
  assert.equal(snapA.hintVisible, snapB.hintVisible, `${context} hintVisible mismatch`);
  assert.equal(snapA.skippedIndex, snapB.skippedIndex, `${context} skippedIndex mismatch`);
  assert.equal(snapA.retrievalCount, snapB.retrievalCount, `${context} retrievalCount mismatch`);
  assert.equal(snapA.skipCount, snapB.skipCount, `${context} skipCount mismatch`);
  assert.equal(snapA.unlockedWordCount, snapB.unlockedWordCount, `${context} unlockedWordCount mismatch`);
  assertNear(snapA.gravityMultiplier, snapB.gravityMultiplier, `${context} gravityMultiplier mismatch`);
  assertNear(snapA.fieldFallTime, snapB.fieldFallTime, `${context} fieldFallTime mismatch`);
  assertNear(snapA.baselineKickTime, snapB.baselineKickTime, `${context} baselineKickTime mismatch`);
  assert.equal(snapA.words.length, snapB.words.length, `${context} word count mismatch`);

  for (let i = 0; i < snapA.words.length; i++) {
    const wA = snapA.words[i];
    const wB = snapB.words[i];
    assert.equal(wA.english, wB.english, `${context} word[${i}].english mismatch`);
    assert.equal(wA.spanish, wB.spanish, `${context} word[${i}].spanish mismatch`);
    assert.equal(wA.streak, wB.streak, `${context} word[${i}].streak mismatch`);
    assert.equal(wA.unlocked, wB.unlocked, `${context} word[${i}].unlocked mismatch`);
    assertNear(wA.initialDepth, wB.initialDepth, `${context} word[${i}].initialDepth mismatch`);
    assertNear(wA.depth, wB.depth, `${context} word[${i}].depth mismatch`);
    assertNear(wA.shown, wB.shown, `${context} word[${i}].shown mismatch`);
  }
}

function compareActionResults(resA, resB, context = '') {
  if (resA === null || resB === null) {
    assert.equal(resA, resB, `${context} null result mismatch`);
    return;
  }
  assert.equal(resA.kind, resB.kind, `${context} kind mismatch`);
  assert.equal(resA.index, resB.index, `${context} index mismatch`);
  assert.equal(resA.word, resB.word, `${context} word mismatch`);
  assert.equal(resA.translation, resB.translation, `${context} translation mismatch`);
  assertNear(resA.latency, resB.latency, `${context} latency mismatch`);
  assert.equal(resA.hintVisible, resB.hintVisible, `${context} hintVisible mismatch`);
  assertNear(resA.multiplier, resB.multiplier, `${context} multiplier mismatch`);
  assertNear(resA.kickTime, resB.kickTime, `${context} kickTime mismatch`);
  assertNear(resA.fullLift, resB.fullLift, `${context} fullLift mismatch`);
  assertNear(resA.lift, resB.lift, `${context} lift mismatch`);
  assert.equal(resA.unlockedIndex, resB.unlockedIndex, `${context} unlockedIndex mismatch`);
  assert.equal(resA.completedNow, resB.completedNow, `${context} completedNow mismatch`);
}

// -------------------------------------------------------------
// 1. Static Math and Derived Functions Parity
// -------------------------------------------------------------
test('Differential: Defaults and Constants Parity', () => {
  for (const Engine of [TsPhysics, DistPhysics]) {
    assert.deepEqual(Engine.DEFAULTS, RefPhysics.DEFAULTS);
    assert.deepEqual(Engine.RETRIEVAL, RefPhysics.RETRIEVAL);
  }
});

test('Differential: Math Functions across Parameter Matrix', () => {
  const configs = [
    RefPhysics.DEFAULTS,
    { bounds: { top: 100, bottom: 0 }, motion: { topFallingSpeed: 2.5, kickHeightPercent: 40, bottomToTopMultiplier: 3, gravityReductionPercent: 2 }, unlock: { threshold: 45 }, finish: { threshold: 85 }, instantPosition: false },
    { bounds: { top: 100, bottom: 0 }, motion: { topFallingSpeed: 0.5, kickHeightPercent: 15, bottomToTopMultiplier: 1, gravityReductionPercent: 0 }, unlock: { threshold: 60 }, finish: { threshold: 95 }, instantPosition: true }
  ];

  for (const config of configs) {
    for (const wordCount of [1, 2, 5, 10, 20]) {
      const refGrav = RefPhysics.gravityMultiplier(config, wordCount);
      const tsGrav = TsPhysics.gravityMultiplier(config, wordCount);
      const distGrav = DistPhysics.gravityMultiplier(config, wordCount);
      assertNear(tsGrav, refGrav);
      assertNear(distGrav, refGrav);

      const refDerived = RefPhysics.derivedMotion(config, wordCount);
      const tsDerived = TsPhysics.derivedMotion(config, wordCount);
      assertNear(tsDerived.baseFallingSpeed, refDerived.baseFallingSpeed);
      assertNear(tsDerived.baseKick, refDerived.baseKick);
      assertNear(tsDerived.fieldFallTime, refDerived.fieldFallTime);
      assertNear(tsDerived.baselineKickTime, refDerived.baselineKickTime);

      for (const pos of [0, 10, 25, 50, 75, 90, 100]) {
        assertNear(TsPhysics.scalingFactor(pos, config), RefPhysics.scalingFactor(pos, config));
        assertNear(TsPhysics.fallingSpeed(pos, config, wordCount), RefPhysics.fallingSpeed(pos, config, wordCount));
        assertNear(TsPhysics.timeCoordinate(pos, config, wordCount), RefPhysics.timeCoordinate(pos, config, wordCount));
        assertNear(TsPhysics.fullKick(pos, config, wordCount), RefPhysics.fullKick(pos, config, wordCount));

        for (const t of [0, 0.5, 1.5, 3.0, 10.0]) {
          assertNear(TsPhysics.positionAtTime(t, config, wordCount), RefPhysics.positionAtTime(t, config, wordCount));
          assertNear(TsPhysics.reverseFallingTime(pos, t, config, wordCount), RefPhysics.reverseFallingTime(pos, t, config, wordCount));
          assertNear(TsPhysics.fallingDepth(pos, t, config, wordCount), RefPhysics.fallingDepth(pos, t, config, wordCount));
        }

        for (const latency of [0, 0.5, 1.0, 1.99, 2.0, 2.01, 4.0]) {
          assertNear(TsPhysics.kickMultiplier(latency), RefPhysics.kickMultiplier(latency));
          assertNear(TsPhysics.retrievalMultiplier(latency), RefPhysics.retrievalMultiplier(latency));
          assertNear(TsPhysics.retrievalLift(pos, config, false, latency, wordCount), RefPhysics.retrievalLift(pos, config, false, latency, wordCount));
        }
      }
    }
  }
});

// -------------------------------------------------------------
// 2. Sequential Falling Over Time
// -------------------------------------------------------------
test('Differential: Sequential Falling Over Subdivided and Irregular Time', () => {
  const ref = RefPhysics.createSession({ wordCount: 5 });
  const ts = TsPhysics.createSession({ wordCount: 5 });

  compareSnapshots(ref.getState(), ts.getState(), 'initial');

  const steps = [1/60, 1/60, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 0.001, 0];
  for (const dt of steps) {
    const resRef = ref.advance(dt);
    const resTs = ts.advance(dt);
    assert.deepEqual(resTs, resRef, `advance(${dt}) return mismatch`);
    compareSnapshots(ref.getState(), ts.getState(), `after advance(${dt})`);
    assertNear(ref.getProgress(), ts.getProgress());
  }
});

// -------------------------------------------------------------
// 3. Successful Retrievals at Varied Latencies
// -------------------------------------------------------------
test('Differential: Successful Retrievals across Latency Boundaries', () => {
  const ref = RefPhysics.createSession({ wordCount: 5 });
  const ts = TsPhysics.createSession({ wordCount: 5 });

  const latencies = [0.1, 0.5, 1.2, 1.999, 2.0, 2.001, 3.5, 5.0];
  for (const delay of latencies) {
    ref.advance(delay);
    ts.advance(delay);

    const refAns = ref.retrieve();
    const tsAns = ts.retrieve();
    compareActionResults(refAns, tsAns, `retrieve after ${delay}s`);
    compareSnapshots(ref.getState(), ts.getState(), `snapshot after retrieve at ${delay}s`);
  }
});

// -------------------------------------------------------------
// 4. Skipping and Target Switching
// -------------------------------------------------------------
test('Differential: Skip Mechanics and Selection Cycling', () => {
  // Test single-word skip (restarts prompt on same word)
  const ref1 = RefPhysics.createSession({ wordCount: 1 });
  const ts1 = TsPhysics.createSession({ wordCount: 1 });
  ref1.advance(1.0);
  ts1.advance(1.0);
  compareActionResults(ref1.skip(), ts1.skip(), 'single-word skip');
  compareSnapshots(ref1.getState(), ts1.getState(), 'single-word skip snapshot');

  // Multi-word active skip
  const ref = RefPhysics.createSession({ wordCount: 4 });
  const ts = TsPhysics.createSession({ wordCount: 4 });

  // Lift and unlock words
  for (let i = 0; i < 30; i++) {
    ref.advance(0.1);
    ts.advance(0.1);
    if (i % 2 === 0) {
      ref.retrieve();
      ts.retrieve();
    }
  }

  // Perform multiple skips in a row
  for (let s = 0; s < 5; s++) {
    ref.advance(0.2);
    ts.advance(0.2);
    const refSkip = ref.skip();
    const tsSkip = ts.skip();
    compareActionResults(refSkip, tsSkip, `multi-word skip ${s}`);
    compareSnapshots(ref.getState(), ts.getState(), `multi-word skip ${s} snapshot`);
  }
});

// -------------------------------------------------------------
// 5. Progressive Unlocking and Game Progression
// -------------------------------------------------------------
test('Differential: Progressive Unlocking Sequence to Full Vocabulary', () => {
  const ref = RefPhysics.createSession({ wordCount: 6 });
  const ts = TsPhysics.createSession({ wordCount: 6 });

  // Advance simulation with frequent successful retrievals to unlock all words
  let attempts = 0;
  while (!ref.isComplete() && attempts < 150) {
    attempts++;
    const dt = 0.25;
    const refTrans = ref.advance(dt);
    const tsTrans = ts.advance(dt);
    assert.deepEqual(tsTrans, refTrans, `unlock advance step ${attempts}`);

    if (refTrans.unlockedIndex !== null) {
      assert.equal(tsTrans.unlockedIndex, refTrans.unlockedIndex, 'unlocked index match');
    }

    const refAns = ref.retrieve();
    const tsAns = ts.retrieve();
    compareActionResults(refAns, tsAns, `unlock retrieve step ${attempts}`);
    compareSnapshots(ref.getState(), ts.getState(), `unlock snapshot step ${attempts}`);

    if (ref.isComplete()) break;
  }

  assert.equal(ts.isComplete(), ref.isComplete());
  assert.equal(ts.isComplete(), true, 'Session reached completion');
});

// -------------------------------------------------------------
// 6. Pause, Resume, and Hidden Time Exclusion
// -------------------------------------------------------------
test('Differential: Pause/Resume Freezing and Hint Timer Isolation', () => {
  const ref = RefPhysics.createSession({ wordCount: 3 });
  const ts = TsPhysics.createSession({ wordCount: 3 });

  ref.advance(0.8);
  ts.advance(0.8);

  ref.setPaused(true);
  ts.setPaused(true);
  compareSnapshots(ref.getState(), ts.getState(), 'paused snapshot');

  // Advance while paused: must be a no-op
  const refAdvance = ref.advance(5.0);
  const tsAdvance = ts.advance(5.0);
  assert.deepEqual(tsAdvance, refAdvance);
  assert.equal(ref.retrieve(), null);
  assert.equal(ts.retrieve(), null);
  assert.equal(ref.skip(), null);
  assert.equal(ts.skip(), null);
  compareSnapshots(ref.getState(), ts.getState(), 'post paused advance snapshot');

  // Resume
  ref.setPaused(false);
  ts.setPaused(false);
  ref.advance(0.5);
  ts.advance(0.5);
  compareSnapshots(ref.getState(), ts.getState(), 'post resume snapshot');
});

// -------------------------------------------------------------
// 7. Live Dynamic Configuration Updates
// -------------------------------------------------------------
test('Differential: Configuration Patches and Rechecking Completion', () => {
  const ref = RefPhysics.createSession({ wordCount: 5 });
  const ts = TsPhysics.createSession({ wordCount: 5 });

  const patches = [
    { motion: { topFallingSpeed: 2 } },
    { motion: { kickHeightPercent: 50, bottomToTopMultiplier: 8 } },
    { unlock: { threshold: 40 } },
    { finish: { threshold: 85 } },
    { instantPosition: true }
  ];

  for (const patch of patches) {
    const resRef = ref.configure(patch);
    const resTs = ts.configure(patch);
    assert.deepEqual(resTs, resRef, `configure patch ${JSON.stringify(patch)}`);
    compareSnapshots(ref.getState(), ts.getState(), `snapshot after configure ${JSON.stringify(patch)}`);
  }
});

// -------------------------------------------------------------
// 8. Boundary Conditions and Error Handling
// -------------------------------------------------------------
test('Differential: Boundary Value Enforcement and Exceptions', () => {
  const ref = RefPhysics.createSession({ wordCount: 3 });
  const ts = TsPhysics.createSession({ wordCount: 3 });

  // Invalid advance durations
  for (const invalid of [-1, -0.001, NaN, Infinity]) {
    assert.throws(() => ref.advance(invalid), RangeError);
    assert.throws(() => ts.advance(invalid), RangeError);
  }

  // Invalid retrieve arguments
  assert.throws(() => ref.retrieve(true), TypeError);
  assert.throws(() => ts.retrieve(true), TypeError);

  // Invalid setPaused arguments
  assert.throws(() => ref.setPaused('true'), TypeError);
  assert.throws(() => ts.setPaused('true'), TypeError);

  // Invalid configurations
  for (const badConfig of [
    { unknownField: 1 },
    { motion: { topFallingSpeed: -1 } },
    { motion: { kickHeightPercent: 0 } },
    { motion: { kickHeightPercent: 101 } },
    { motion: { bottomToTopMultiplier: 0.5 } },
    { motion: { gravityReductionPercent: 15 } },
    { unlock: { threshold: 95 }, finish: { threshold: 90 } } // unlock >= finish
  ]) {
    assert.throws(() => ref.configure(badConfig), RangeError);
    assert.throws(() => ts.configure(badConfig), RangeError);
  }

  // Ceiling clamping (clamping at 100 with no overflow)
  ref.configure({ instantPosition: true, motion: { kickHeightPercent: 100 } });
  ts.configure({ instantPosition: true, motion: { kickHeightPercent: 100 } });
  for (let i = 0; i < 5; i++) {
    ref.retrieve();
    ts.retrieve();
    assert.equal(ref.getState().words[0].depth, 100);
    assert.equal(ts.getState().words[0].depth, 100);
  }

  // Floor clamping (falling depth saturating at 0 in a fresh session)
  const freshRef = RefPhysics.createSession({ wordCount: 3 });
  const freshTs = TsPhysics.createSession({ wordCount: 3 });
  freshRef.advance(1000);
  freshTs.advance(1000);
  assert.equal(freshRef.getState().words[0].depth, 0);
  assert.equal(freshTs.getState().words[0].depth, 0);
});
