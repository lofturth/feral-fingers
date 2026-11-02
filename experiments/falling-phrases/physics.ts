/* DOM-free, deterministic session model for Falling Phrases.
 *
 * Example:
 *   import { createSession } from './physics';
 *   const session = createSession({ wordCount: 20 });
 *   session.advance(0.1);       // explicit seconds, not wall clock
 *   session.retrieve();         // successful retrieval; session.skip() advances without a kick
 *   const state = session.getState(); // detached inspection snapshot
 */

// --- Configuration Types ---

export interface BoundsConfig {
  readonly top: number;
  readonly bottom: number;
}

export interface MotionConfig {
  readonly topFallingSpeed: number;
  readonly kickHeightPercent: number;
  readonly bottomToTopMultiplier: number;
  readonly gravityReductionPercent: number;
}

export interface UnlockConfig {
  readonly threshold: number;
}

export interface FinishConfig {
  readonly threshold: number;
}

export interface PhysicsConfig {
  readonly bounds: BoundsConfig;
  readonly motion: MotionConfig;
  readonly unlock: UnlockConfig;
  readonly finish: FinishConfig;
  readonly instantPosition: boolean;
}

export interface PhysicsConfigPatch {
  bounds?: Partial<BoundsConfig>;
  motion?: Partial<MotionConfig>;
  unlock?: Partial<UnlockConfig>;
  finish?: Partial<FinishConfig>;
  instantPosition?: boolean;
}

// --- Card / Word State ---

export type VocabularyPair = readonly [english: string, spanish: string];

export interface VocabularyObject {
  english: string;
  spanish?: string;
}

export type VocabularyEntry = VocabularyPair | VocabularyObject | string;

export interface WordState {
  english: string;
  spanish: string;
  streak: number;
  unlocked: boolean;
  initialDepth: number;
  depth: number;
  shown: number;
}

// --- Simulation Results & Transitions ---

export interface TransitionResult {
  unlockedIndex: number | null;
  completedNow: boolean;
}

export interface RetrievalResult extends TransitionResult {
  kind: 'retrieval';
  index: number;
  word: string;
  translation: string;
  latency: number;
  hintVisible: boolean;
  multiplier: number;
  kickTime: number;
  fullLift: number;
  lift: number;
}

export interface SkipResult extends TransitionResult {
  kind: 'skip';
  index: number;
  word: string;
  translation: string;
  latency: number;
  hintVisible: boolean;
  multiplier: 0;
  kickTime: 0;
  lift: 0;
}

export interface RewardResult extends TransitionResult {
  kind: 'reward';
  index: number;
  rewardMagnitude: number;
  previousDepth: number;
  newDepth: number;
  lift: number;
}

export type SessionTransition = RetrievalResult | SkipResult;

// --- Session State Snapshot ---

export interface SessionSnapshot {
  config: PhysicsConfig;
  words: WordState[];
  time: number;
  paused: boolean;
  complete: boolean;
  selectedIndex: number;
  selectedAt: number;
  hintVisible: boolean;
  skippedIndex: number;
  retrievalCount: number;
  skipCount: number;
  lastRetrieval: SessionTransition | null;
  unlockedWordCount: number;
  gravityMultiplier: number;
  fieldFallTime: number;
  baselineKickTime: number;
}

// --- Session Options ---

export interface CreateSessionOptions {
  config?: PhysicsConfigPatch;
  vocabulary?: readonly VocabularyEntry[];
  wordCount?: number;
}

export interface ConfigureOptions {
  recheckCompletion?: boolean;
}

// --- Derived Motion Metrics ---

export interface DerivedMotion {
  baseFallingSpeed: number;
  baseKick: number;
  fieldFallTime: number;
  baselineKickTime: number;
}

export interface FallingCoefficients {
  a: number;
  b: number;
}

// --- Physics Session Interface ---

export interface PhysicsSession {
  advance(dt: number): TransitionResult;
  retrieve(...args: unknown[]): RetrievalResult | null;
  skip(): SkipResult | null;
  applyReward(cardIdentifier: number, rewardMagnitude: number): RewardResult | null;
  getState(): SessionSnapshot;
  getProgress(): number;
  getLowestIndex(): number;
  isComplete(): boolean;
  setPaused(value: boolean): void;
  configure(patch?: PhysicsConfigPatch, options?: ConfigureOptions): TransitionResult;
}

// --- Public Physics API Interface ---

export interface MunduPhysicsAPI {
  readonly DEFAULTS: Readonly<PhysicsConfig>;
  readonly RETRIEVAL: Readonly<{ hintSeconds: number }>;
  createSession(options?: CreateSessionOptions): PhysicsSession;
  gravityMultiplier(config: PhysicsConfig, unlockedWordCount?: number): number;
  derivedMotion(config: PhysicsConfig, unlockedWordCount?: number): DerivedMotion;
  fieldFallTime(config: PhysicsConfig, unlockedWordCount?: number): number;
  baselineKickTime(config: PhysicsConfig, unlockedWordCount?: number): number;
  timeCoordinate(position: number, config: PhysicsConfig, unlockedWordCount?: number): number;
  positionAtTime(seconds: number, config: PhysicsConfig, unlockedWordCount?: number): number;
  reverseFallingTime(position: number, seconds: number, config: PhysicsConfig, unlockedWordCount?: number): number;
  scalingFactor(position: number, config: PhysicsConfig): number;
  fullKick(position: number, config: PhysicsConfig, unlockedWordCount?: number): number;
  fallingSpeed(position: number, config: PhysicsConfig, unlockedWordCount?: number): number;
  fallingDepth(position: number, dt: number, config: PhysicsConfig, unlockedWordCount?: number): number;
  kickMultiplier(elapsedSeconds: number): number;
  retrievalMultiplier(elapsedSeconds: number): number;
  retrievalLift(
    position: number,
    config: PhysicsConfig,
    hintVisible?: boolean,
    latency?: number,
    unlockedWordCount?: number
  ): number;
  wordProgress(word: Pick<WordState, 'unlocked' | 'depth' | 'shown' | 'initialDepth'>, threshold: number): number;
  isAboveFinish(word: Pick<WordState, 'unlocked' | 'depth' | 'shown'>, threshold: number): boolean;
}

// ==========================================
// Implementation
// ==========================================

export const DEFAULTS: Readonly<PhysicsConfig> = Object.freeze({
  bounds: Object.freeze({ top: 100, bottom: 0 }),
  motion: Object.freeze({
    topFallingSpeed: 1,
    kickHeightPercent: 25,
    bottomToTopMultiplier: 5,
    gravityReductionPercent: 5
  }),
  unlock: Object.freeze({ threshold: 50 }),
  finish: Object.freeze({ threshold: 90 }),
  instantPosition: false
});

export const RETRIEVAL: Readonly<{ hintSeconds: number }> = Object.freeze({
  hintSeconds: 2
});

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const clamp = (n: number, low: number, high: number): number => Math.max(low, Math.min(high, n));

export function configuration(
  patch: PhysicsConfigPatch = {},
  previous: PhysicsConfig = DEFAULTS
): PhysicsConfig {
  const config: Record<string, unknown> = {};
  const groups = ['bounds', 'motion', 'unlock', 'finish'] as const;

  for (const key of Object.keys(patch)) {
    if (!groups.includes(key as typeof groups[number]) && key !== 'instantPosition') {
      throw new RangeError('Unknown configuration field: ' + key);
    }
  }

  for (const key of groups) {
    const patchGroup = (patch as Record<string, Record<string, unknown> | undefined>)[key] ?? {};
    const prevGroup = previous[key] as unknown as Record<string, unknown>;

    for (const field of Object.keys(patchGroup)) {
      if (!(field in prevGroup)) {
        throw new RangeError('Unknown configuration field: ' + key + '.' + field);
      }
    }

    const merged = { ...prevGroup, ...patchGroup };
    config[key] = merged;

    for (const value of Object.values(merged)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new RangeError('Configuration values must be finite');
      }
    }
  }

  config.instantPosition = patch.instantPosition ?? previous.instantPosition;

  const b = config.bounds as BoundsConfig;
  const m = config.motion as MotionConfig;
  const u = config.unlock as UnlockConfig;
  const f = config.finish as FinishConfig;

  if (
    !(
      b.bottom === 0 &&
      b.top === 100 &&
      b.bottom < u.threshold &&
      u.threshold < f.threshold &&
      f.threshold < b.top &&
      m.topFallingSpeed > 0 &&
      m.kickHeightPercent >= 1 &&
      m.kickHeightPercent <= 100 &&
      Number.isFinite(m.topFallingSpeed * m.bottomToTopMultiplier) &&
      m.bottomToTopMultiplier >= 1 &&
      m.gravityReductionPercent >= 0 &&
      m.gravityReductionPercent <= 10 &&
      typeof config.instantPosition === 'boolean'
    )
  ) {
    throw new RangeError('Invalid physics configuration');
  }

  return config as unknown as PhysicsConfig;
}

export function isAboveFinish(
  word: Pick<WordState, 'unlocked' | 'depth' | 'shown'>,
  threshold: number
): boolean {
  return word.unlocked && Math.min(word.depth, word.shown) > threshold;
}

export function wordProgress(
  word: Pick<WordState, 'unlocked' | 'depth' | 'shown' | 'initialDepth'>,
  threshold: number
): number {
  if (!word.unlocked) return 0;
  const distance = Math.max(0, threshold - word.initialDepth);
  const traveled = clamp(Math.min(word.depth, word.shown) - word.initialDepth, 0, distance);
  return distance > 0 ? traveled / distance : 1;
}

export function scalingFactor(position: number, config: PhysicsConfig): number {
  const h = clamp(position / 100, 0, 1);
  const R = config.motion.bottomToTopMultiplier;
  return R - (R - 1) * h;
}

export function gravityMultiplier(config: PhysicsConfig, unlockedWordCount = 1): number {
  if (!Number.isInteger(unlockedWordCount) || unlockedWordCount < 1) {
    throw new RangeError('Unlocked count must be a positive integer');
  }
  return Math.pow(1 - config.motion.gravityReductionPercent / 100, unlockedWordCount - 1);
}

export function fallingCoefficients(config: PhysicsConfig, unlockedWordCount = 1): FallingCoefficients {
  const { topFallingSpeed, bottomToTopMultiplier: R } = config.motion;
  const effectiveTopSpeed = topFallingSpeed * gravityMultiplier(config, unlockedWordCount);
  return { a: effectiveTopSpeed * R, b: (effectiveTopSpeed * (R - 1)) / 100 };
}

export function fallingSpeed(position: number, config: PhysicsConfig, unlockedWordCount = 1): number {
  return config.motion.topFallingSpeed * gravityMultiplier(config, unlockedWordCount) * scalingFactor(position, config);
}

export function timeCoordinate(position: number, config: PhysicsConfig, unlockedWordCount = 1): number {
  const x = clamp(position, 0, 100);
  const { a, b } = fallingCoefficients(config, unlockedWordCount);
  if (b === 0) return x / a;
  if (x === 100) return Math.log1p(config.motion.bottomToTopMultiplier - 1) / b;
  const q = (b * x) / a;
  return q === 0 ? x / a : (x / a) * (-Math.log1p(-q) / q);
}

export function positionAtTime(seconds: number, config: PhysicsConfig, unlockedWordCount = 1): number {
  const { a, b } = fallingCoefficients(config, unlockedWordCount);
  const ceiling = timeCoordinate(100, config, unlockedWordCount);
  if (seconds <= 0) return 0;
  if (seconds >= ceiling) return 100;
  const z = b * seconds;
  const x = z === 0 ? a * seconds : a * seconds * (-Math.expm1(-z) / z);
  return clamp(x, 0, 100);
}

export function reverseFallingTime(
  position: number,
  seconds: number,
  config: PhysicsConfig,
  unlockedWordCount = 1
): number {
  const x = clamp(position, 0, 100);
  return seconds === 0
    ? x
    : positionAtTime(timeCoordinate(x, config, unlockedWordCount) + seconds, config, unlockedWordCount);
}

export function fieldFallTime(config: PhysicsConfig, unlockedWordCount = 1): number {
  return timeCoordinate(100, config, unlockedWordCount);
}

export function baselineKickTime(config: PhysicsConfig, unlockedWordCount = 1): number {
  return timeCoordinate(config.motion.kickHeightPercent, config, unlockedWordCount);
}

export function fullKick(position: number, config: PhysicsConfig, unlockedWordCount = 1): number {
  return (
    reverseFallingTime(position, baselineKickTime(config, unlockedWordCount), config, unlockedWordCount) -
    clamp(position, 0, 100)
  );
}

export function derivedMotion(config: PhysicsConfig, unlockedWordCount = 1): DerivedMotion {
  return {
    baseFallingSpeed: fallingCoefficients(config, unlockedWordCount).a,
    baseKick: fullKick(0, config, unlockedWordCount),
    fieldFallTime: fieldFallTime(config, unlockedWordCount),
    baselineKickTime: baselineKickTime(config, unlockedWordCount)
  };
}

export function fallingDepth(position: number, dt: number, config: PhysicsConfig, unlockedWordCount = 1): number {
  const x = clamp(position, 0, 100);
  return dt === 0 ? x : positionAtTime(timeCoordinate(x, config, unlockedWordCount) - dt, config, unlockedWordCount);
}

export function kickMultiplier(elapsedSeconds: number): number {
  const t = Math.max(0, elapsedSeconds);
  return 0.5 + 1.5 * Math.exp(-1.5 * t);
}

export const retrievalMultiplier = kickMultiplier;

export function retrievalLift(
  position: number,
  config: PhysicsConfig,
  _hintVisible = false,
  latency = 0,
  unlockedWordCount = 1
): number {
  const kickTime = baselineKickTime(config, unlockedWordCount) * kickMultiplier(latency);
  return reverseFallingTime(position, kickTime, config, unlockedWordCount) - clamp(position, 0, 100);
}

interface InternalSessionState {
  config: PhysicsConfig;
  words: WordState[];
  time: number;
  paused: boolean;
  complete: boolean;
  selectedIndex: number;
  selectedAt: number;
  hintVisible: boolean;
  skippedIndex: number;
  retrievalCount: number;
  skipCount: number;
  lastRetrieval: SessionTransition | null;
}

export function createSession(options: CreateSessionOptions = {}): PhysicsSession {
  let config = configuration(options.config);
  const vocabulary =
    options.vocabulary ??
    Array.from({ length: options.wordCount ?? 10 }, (_, i) => ['word' + (i + 1), ''] as const);

  if (
    !Array.isArray(vocabulary) ||
    vocabulary.length < 1 ||
    (options.wordCount !== undefined && (!Number.isInteger(options.wordCount) || options.wordCount < 1))
  ) {
    throw new RangeError('A session needs a positive vocabulary size');
  }

  const state: InternalSessionState = {
    config,
    words: vocabulary.map((entry, i) => {
      let english = '';
      let spanish = '';
      if (Array.isArray(entry)) {
        english = String(entry[0]);
        spanish = String(entry[1] ?? '');
      } else if (typeof entry === 'object' && entry !== null) {
        english = String((entry as VocabularyObject).english ?? '');
        spanish = String((entry as VocabularyObject).spanish ?? '');
      } else {
        english = String(entry);
        spanish = '';
      }
      return {
        english,
        spanish,
        streak: 0,
        unlocked: i === 0,
        initialDepth: config.bounds.bottom,
        depth: config.bounds.bottom,
        shown: config.bounds.bottom
      };
    }),
    time: 0,
    paused: false,
    complete: false,
    selectedIndex: 0,
    selectedAt: 0,
    hintVisible: false,
    skippedIndex: -1,
    retrievalCount: 0,
    skipCount: 0,
    lastRetrieval: null
  };

  function lowestIndex(): number {
    let lowest = -1;
    state.words.forEach((word, i) => {
      if (i !== state.skippedIndex && word.unlocked && (lowest < 0 || word.depth < state.words[lowest]!.depth)) {
        lowest = i;
      }
    });
    if (lowest < 0) {
      lowest = state.words.findIndex(word => word.unlocked);
    }
    return lowest;
  }

  function select(): number {
    const index = lowestIndex();
    if (index !== state.selectedIndex) {
      state.selectedIndex = index;
      state.selectedAt = state.time;
      state.hintVisible = false;
    }
    return index;
  }

  function reconcile(): TransitionResult {
    let unlockedIndex: number | null = null;
    let completedNow = false;

    if (!state.paused && !state.complete) {
      const active = state.words.filter(word => word.unlocked);
      if (active.every(word => Math.min(word.depth, word.shown) > config.unlock.threshold)) {
        const index = state.words.findIndex(word => !word.unlocked);
        if (index >= 0) {
          const word = state.words[index]!;
          word.unlocked = true;
          word.depth = config.bounds.bottom;
          word.shown = config.bounds.bottom;
          word.streak = 0;
          unlockedIndex = index;
        }
      }
    }

    select();

    const clockPrecision = 128 * Number.EPSILON * Math.max(1, state.time, state.selectedAt);
    if (
      !state.paused &&
      !state.complete &&
      state.time - state.selectedAt + clockPrecision >= RETRIEVAL.hintSeconds
    ) {
      state.hintVisible = true;
    }

    if (!state.complete && state.words.every(word => isAboveFinish(word, config.finish.threshold))) {
      state.complete = true;
      state.paused = true;
      completedNow = true;
    }

    return { unlockedIndex, completedNow };
  }

  function getProgress(): number {
    const value = clamp(
      (100 * state.words.reduce((sum, word) => sum + wordProgress(word, config.finish.threshold), 0)) /
        state.words.length,
      0,
      100
    );
    return value === 100 && !state.words.every(word => isAboveFinish(word, config.finish.threshold))
      ? 100 - 1e-10
      : value;
  }

  function unlockedCount(): number {
    return state.words.filter(word => word.unlocked).length;
  }

  const api: PhysicsSession = {
    advance(dt: number): TransitionResult {
      if (!Number.isFinite(dt) || dt < 0) {
        throw new RangeError('Duration must be finite and nonnegative');
      }
      if (state.paused || state.complete) {
        return { unlockedIndex: null, completedNow: false };
      }
      const activeCount = unlockedCount();
      for (const word of state.words) {
        if (!word.unlocked) continue;
        word.depth = fallingDepth(word.depth, dt, config, activeCount);
        word.shown = config.instantPosition
          ? word.depth
          : word.shown + (word.depth - word.shown) * (1 - Math.exp(-15 * dt));
      }
      state.time += dt;
      return reconcile();
    },

    retrieve(...args: unknown[]): RetrievalResult | null {
      if (args.length > 0) {
        throw new TypeError('retrieve() is successful only; use skip() to skip');
      }
      if (state.paused || state.complete) return null;

      const index = select();
      const word = state.words[index]!;
      const previousDepth = word.depth;
      const latency = Math.max(0, state.time - state.selectedAt);
      const hintVisible = state.hintVisible;
      const activeCount = unlockedCount();
      const fullLift = fullKick(previousDepth, config, activeCount);

      word.streak++;
      word.depth = clamp(
        previousDepth + retrievalLift(previousDepth, config, hintVisible, latency, activeCount),
        config.bounds.bottom,
        config.bounds.top
      );
      if (config.instantPosition) word.shown = word.depth;

      const result: RetrievalResult = {
        kind: 'retrieval',
        index,
        word: word.english,
        translation: word.spanish,
        latency,
        hintVisible,
        multiplier: kickMultiplier(latency),
        kickTime: baselineKickTime(config, activeCount) * kickMultiplier(latency),
        fullLift,
        lift: word.depth - previousDepth,
        unlockedIndex: null,
        completedNow: false
      };

      state.lastRetrieval = result;
      state.retrievalCount++;
      state.skippedIndex = -1;
      state.selectedIndex = -1;

      Object.assign(result, reconcile());
      return clone(result);
    },

    skip(): SkipResult | null {
      if (state.paused || state.complete) return null;

      const index = select();
      const word = state.words[index]!;
      const result: SkipResult = {
        kind: 'skip',
        index,
        word: word.english,
        translation: word.spanish,
        latency: Math.max(0, state.time - state.selectedAt),
        hintVisible: state.hintVisible,
        multiplier: 0,
        kickTime: 0,
        lift: 0,
        unlockedIndex: null,
        completedNow: false
      };

      state.lastRetrieval = result;
      state.skipCount++;
      state.skippedIndex = index;
      state.selectedIndex = -1;

      Object.assign(result, reconcile());
      return clone(result);
    },

    applyReward(cardIdentifier: number, rewardMagnitude: number): RewardResult | null {
      if (state.paused || state.complete) return null;
      if (typeof cardIdentifier !== 'number' || !Number.isInteger(cardIdentifier)) {
        throw new TypeError('cardIdentifier must be an integer index');
      }
      if (cardIdentifier < 0 || cardIdentifier >= state.words.length) {
        throw new RangeError('cardIdentifier out of range');
      }
      if (typeof rewardMagnitude !== 'number' || !Number.isFinite(rewardMagnitude) || rewardMagnitude < 0) {
        throw new RangeError('rewardMagnitude must be a finite, nonnegative number');
      }
      const word = state.words[cardIdentifier]!;
      if (!word.unlocked) return null;

      const previousDepth = word.depth;
      const lift = config.motion.kickHeightPercent * rewardMagnitude;
      word.depth = clamp(previousDepth + lift, config.bounds.bottom, config.bounds.top);
      if (config.instantPosition) word.shown = word.depth;
      if (rewardMagnitude > 0) word.streak++;

      const transition = reconcile();
      const result: RewardResult = {
        kind: 'reward',
        index: cardIdentifier,
        rewardMagnitude,
        previousDepth,
        newDepth: word.depth,
        lift: word.depth - previousDepth,
        unlockedIndex: transition.unlockedIndex,
        completedNow: transition.completedNow
      };
      return clone(result);
    },

    getState(): SessionSnapshot {
      const unlockedWordCount = unlockedCount();
      return clone({
        ...state,
        config,
        unlockedWordCount,
        gravityMultiplier: gravityMultiplier(config, unlockedWordCount),
        fieldFallTime: fieldFallTime(config, unlockedWordCount),
        baselineKickTime: baselineKickTime(config, unlockedWordCount)
      });
    },

    getProgress,

    getLowestIndex: lowestIndex,

    isComplete(): boolean {
      return state.complete;
    },

    setPaused(value: boolean): void {
      if (typeof value !== 'boolean') {
        throw new TypeError('Paused must be a boolean');
      }
      if (!state.complete) state.paused = value;
    },

    configure(patch?: PhysicsConfigPatch, { recheckCompletion = false }: ConfigureOptions = {}): TransitionResult {
      config = configuration(patch, config);
      state.config = config;
      if (recheckCompletion) state.complete = false;
      return reconcile();
    }
  };
  return api;
}

export const MunduPhysics: Readonly<MunduPhysicsAPI> = Object.freeze({
  DEFAULTS,
  RETRIEVAL,
  createSession,
  gravityMultiplier,
  derivedMotion,
  fieldFallTime,
  baselineKickTime,
  timeCoordinate,
  positionAtTime,
  reverseFallingTime,
  scalingFactor,
  fullKick,
  fallingSpeed,
  fallingDepth,
  kickMultiplier,
  retrievalMultiplier,
  retrievalLift,
  wordProgress,
  isAboveFinish
});

export default MunduPhysics;
