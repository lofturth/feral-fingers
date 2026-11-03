/* DOM-free, deterministic session model for Falling Core.
 *
 * Example:
 *   import { createSession } from './physics';
 *   const session = createSession({ cardCount: 10 });
 *   session.advance(0.1);                // explicit seconds, not wall clock
 *   session.applyReward("card-1", 1.0);  // apply time-coordinate reward
 *   session.skip();                      // advance to next lowest item without reward
 *   const state = session.getState();    // detached inspection snapshot
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

// --- Card State ---

export type CardId = string;

export interface CardState {
  readonly id: CardId;
  streak: number;
  unlocked: boolean;
  initialDepth: number;
  depth: number;
  shown: number;
}

export interface CardInit {
  id: CardId;
}

// --- Simulation Results & Transitions ---

export interface TransitionResult {
  unlockedIndex: number | null;
  unlockedCardId: CardId | null;
  completedNow: boolean;
}

export interface RewardResult extends TransitionResult {
  kind: 'reward';
  index: number;
  cardId: CardId;
  rewardMagnitude: number;
  previousDepth: number;
  newDepth: number;
  lift: number;
  kickTime: number;
}

export interface SkipResult extends TransitionResult {
  kind: 'skip';
  index: number;
  cardId: CardId;
}

export type SessionTransition = RewardResult | SkipResult;

// --- Session State Snapshot ---

export interface SessionSnapshot {
  config: PhysicsConfig;
  cards: CardState[];
  time: number;
  paused: boolean;
  complete: boolean;
  selectedIndex: number;
  selectedCardId: CardId;
  selectedAt: number;
  skippedIndex: number;
  skippedCardId: CardId | null;
  rewardCount: number;
  skipCount: number;
  lastReward: RewardResult | null;
  unlockedCardCount: number;
  gravityMultiplier: number;
  fieldFallTime: number;
  baselineKickTime: number;
}

// --- Session Options ---

export interface CreateSessionOptions {
  config?: PhysicsConfigPatch;
  cards?: readonly (CardInit | CardId)[];
  cardCount?: number;
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
  skip(): SkipResult | null;
  applyReward(cardIdentifier: CardId | number, rewardMagnitude: number): RewardResult | null;
  applyReward(rewardMagnitude: number): RewardResult | null;
  getState(): SessionSnapshot;
  getProgress(): number;
  getLowestIndex(): number;
  getLowestCardId(): CardId;
  getCard(cardIdentifier: CardId | number): CardState | undefined;
  isComplete(): boolean;
  setPaused(value: boolean): void;
  configure(patch?: PhysicsConfigPatch, options?: ConfigureOptions): TransitionResult;
}

// --- Public Physics API Interface ---

export interface MunduPhysicsAPI {
  readonly DEFAULTS: Readonly<PhysicsConfig>;
  createSession(options?: CreateSessionOptions): PhysicsSession;
  gravityMultiplier(config: PhysicsConfig, unlockedCardCount?: number): number;
  derivedMotion(config: PhysicsConfig, unlockedCardCount?: number): DerivedMotion;
  fieldFallTime(config: PhysicsConfig, unlockedCardCount?: number): number;
  baselineKickTime(config: PhysicsConfig, unlockedCardCount?: number): number;
  timeCoordinate(position: number, config: PhysicsConfig, unlockedCardCount?: number): number;
  positionAtTime(seconds: number, config: PhysicsConfig, unlockedCardCount?: number): number;
  reverseFallingTime(position: number, seconds: number, config: PhysicsConfig, unlockedCardCount?: number): number;
  scalingFactor(position: number, config: PhysicsConfig): number;
  fullKick(position: number, config: PhysicsConfig, unlockedCardCount?: number): number;
  fallingSpeed(position: number, config: PhysicsConfig, unlockedCardCount?: number): number;
  fallingDepth(position: number, dt: number, config: PhysicsConfig, unlockedCardCount?: number): number;
  timeCoordinateKick(
    position: number,
    multiplier: number,
    config: PhysicsConfig,
    unlockedCardCount?: number
  ): { newDepth: number; lift: number; kickTime: number };
  cardProgress(card: Pick<CardState, 'unlocked' | 'depth' | 'shown' | 'initialDepth'>, threshold: number): number;
  isAboveFinish(card: Pick<CardState, 'unlocked' | 'depth' | 'shown'>, threshold: number): boolean;
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
  card: Pick<CardState, 'unlocked' | 'depth' | 'shown'>,
  threshold: number
): boolean {
  return card.unlocked && Math.min(card.depth, card.shown) > threshold;
}

export function cardProgress(
  card: Pick<CardState, 'unlocked' | 'depth' | 'shown' | 'initialDepth'>,
  threshold: number
): number {
  if (!card.unlocked) return 0;
  const distance = Math.max(0, threshold - card.initialDepth);
  const traveled = clamp(Math.min(card.depth, card.shown) - card.initialDepth, 0, distance);
  return distance > 0 ? traveled / distance : 1;
}

export function scalingFactor(position: number, config: PhysicsConfig): number {
  const h = clamp(position / 100, 0, 1);
  const R = config.motion.bottomToTopMultiplier;
  return R - (R - 1) * h;
}

export function gravityMultiplier(config: PhysicsConfig, unlockedCardCount = 1): number {
  if (!Number.isInteger(unlockedCardCount) || unlockedCardCount < 1) {
    throw new RangeError('Unlocked count must be a positive integer');
  }
  return Math.pow(1 - config.motion.gravityReductionPercent / 100, unlockedCardCount - 1);
}

export function fallingCoefficients(config: PhysicsConfig, unlockedCardCount = 1): FallingCoefficients {
  const { topFallingSpeed, bottomToTopMultiplier: R } = config.motion;
  const effectiveTopSpeed = topFallingSpeed * gravityMultiplier(config, unlockedCardCount);
  return { a: effectiveTopSpeed * R, b: (effectiveTopSpeed * (R - 1)) / 100 };
}

export function fallingSpeed(position: number, config: PhysicsConfig, unlockedCardCount = 1): number {
  return config.motion.topFallingSpeed * gravityMultiplier(config, unlockedCardCount) * scalingFactor(position, config);
}

export function timeCoordinate(position: number, config: PhysicsConfig, unlockedCardCount = 1): number {
  const x = clamp(position, 0, 100);
  const { a, b } = fallingCoefficients(config, unlockedCardCount);
  if (b === 0) return x / a;
  if (x === 100) return Math.log1p(config.motion.bottomToTopMultiplier - 1) / b;
  const q = (b * x) / a;
  return q === 0 ? x / a : (x / a) * (-Math.log1p(-q) / q);
}

export function positionAtTime(seconds: number, config: PhysicsConfig, unlockedCardCount = 1): number {
  const { a, b } = fallingCoefficients(config, unlockedCardCount);
  const ceiling = timeCoordinate(100, config, unlockedCardCount);
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
  unlockedCardCount = 1
): number {
  const x = clamp(position, 0, 100);
  return seconds === 0
    ? x
    : positionAtTime(timeCoordinate(x, config, unlockedCardCount) + seconds, config, unlockedCardCount);
}

export function fieldFallTime(config: PhysicsConfig, unlockedCardCount = 1): number {
  return timeCoordinate(100, config, unlockedCardCount);
}

export function baselineKickTime(config: PhysicsConfig, unlockedCardCount = 1): number {
  return timeCoordinate(config.motion.kickHeightPercent, config, unlockedCardCount);
}

export function fullKick(position: number, config: PhysicsConfig, unlockedCardCount = 1): number {
  return (
    reverseFallingTime(position, baselineKickTime(config, unlockedCardCount), config, unlockedCardCount) -
    clamp(position, 0, 100)
  );
}

export function derivedMotion(config: PhysicsConfig, unlockedCardCount = 1): DerivedMotion {
  return {
    baseFallingSpeed: fallingCoefficients(config, unlockedCardCount).a,
    baseKick: fullKick(0, config, unlockedCardCount),
    fieldFallTime: fieldFallTime(config, unlockedCardCount),
    baselineKickTime: baselineKickTime(config, unlockedCardCount)
  };
}

export function fallingDepth(position: number, dt: number, config: PhysicsConfig, unlockedCardCount = 1): number {
  const x = clamp(position, 0, 100);
  return dt === 0 ? x : positionAtTime(timeCoordinate(x, config, unlockedCardCount) - dt, config, unlockedCardCount);
}

export function timeCoordinateKick(
  position: number,
  multiplier: number,
  config: PhysicsConfig,
  unlockedCardCount = 1
): { newDepth: number; lift: number; kickTime: number } {
  const x = clamp(position, 0, 100);
  if (multiplier <= 0) {
    return { newDepth: x, lift: 0, kickTime: 0 };
  }
  const kickTime = baselineKickTime(config, unlockedCardCount) * multiplier;
  const newDepth = clamp(
    reverseFallingTime(x, kickTime, config, unlockedCardCount),
    config.bounds.bottom,
    config.bounds.top
  );
  return {
    newDepth,
    lift: newDepth - x,
    kickTime
  };
}

interface InternalSessionState {
  config: PhysicsConfig;
  cards: CardState[];
  time: number;
  paused: boolean;
  complete: boolean;
  selectedIndex: number;
  selectedCardId: CardId;
  selectedAt: number;
  skippedIndex: number;
  skippedCardId: CardId | null;
  rewardCount: number;
  skipCount: number;
  lastReward: RewardResult | null;
}

export function createSession(options: CreateSessionOptions = {}): PhysicsSession {
  let config = configuration(options.config);
  let cards: CardState[];

  if (options.cards !== undefined) {
    if (!Array.isArray(options.cards) || options.cards.length < 1) {
      throw new RangeError('A session needs a positive collection size');
    }
    cards = options.cards.map((item, i) => {
      const id = typeof item === 'string' ? item : (item && typeof item === 'object' && item.id ? String(item.id) : `card-${i + 1}`);
      return {
        id,
        streak: 0,
        unlocked: i === 0,
        initialDepth: config.bounds.bottom,
        depth: config.bounds.bottom,
        shown: config.bounds.bottom
      };
    });
  } else {
    const count = options.cardCount ?? 10;
    if (!Number.isInteger(count) || count < 1) {
      throw new RangeError('A session needs a positive collection size');
    }
    cards = Array.from({ length: count }, (_, i) => ({
      id: `card-${i + 1}`,
      streak: 0,
      unlocked: i === 0,
      initialDepth: config.bounds.bottom,
      depth: config.bounds.bottom,
      shown: config.bounds.bottom
    }));
  }

  const state: InternalSessionState = {
    config,
    cards,
    time: 0,
    paused: false,
    complete: false,
    selectedIndex: 0,
    selectedCardId: cards[0]?.id ?? '',
    selectedAt: 0,
    skippedIndex: -1,
    skippedCardId: null,
    rewardCount: 0,
    skipCount: 0,
    lastReward: null
  };

  function lowestIndex(): number {
    let lowest = -1;
    state.cards.forEach((card, i) => {
      if (i !== state.skippedIndex && card.unlocked && (lowest < 0 || card.depth < state.cards[lowest]!.depth)) {
        lowest = i;
      }
    });
    if (lowest < 0) {
      lowest = state.cards.findIndex(card => card.unlocked);
    }
    return lowest;
  }

  function select(): number {
    const index = lowestIndex();
    if (index !== state.selectedIndex) {
      state.selectedIndex = index;
      state.selectedCardId = state.cards[index]?.id ?? '';
      state.selectedAt = state.time;
    }
    return index;
  }

  function reconcile(): TransitionResult {
    let unlockedIndex: number | null = null;
    let unlockedCardId: CardId | null = null;
    let completedNow = false;

    if (!state.paused && !state.complete) {
      const active = state.cards.filter(card => card.unlocked);
      if (active.every(card => Math.min(card.depth, card.shown) > config.unlock.threshold)) {
        const index = state.cards.findIndex(card => !card.unlocked);
        if (index >= 0) {
          const card = state.cards[index]!;
          card.unlocked = true;
          card.depth = config.bounds.bottom;
          card.shown = config.bounds.bottom;
          card.streak = 0;
          unlockedIndex = index;
          unlockedCardId = card.id;
        }
      }
    }

    select();

    if (!state.complete && state.cards.every(card => isAboveFinish(card, config.finish.threshold))) {
      state.complete = true;
      state.paused = true;
      completedNow = true;
    }

    return { unlockedIndex, unlockedCardId, completedNow };
  }

  function getProgress(): number {
    const value = clamp(
      (100 * state.cards.reduce((sum, card) => sum + cardProgress(card, config.finish.threshold), 0)) /
        state.cards.length,
      0,
      100
    );
    return value === 100 && !state.cards.every(card => isAboveFinish(card, config.finish.threshold))
      ? 100 - 1e-10
      : value;
  }

  function unlockedCount(): number {
    return state.cards.filter(card => card.unlocked).length;
  }

  function executeKick(index: number, multiplier: number) {
    const card = state.cards[index]!;
    const previousDepth = card.depth;
    const activeCount = unlockedCount();
    const kick = timeCoordinateKick(previousDepth, multiplier, config, activeCount);

    if (multiplier > 0) {
      card.depth = kick.newDepth;
      if (config.instantPosition) card.shown = card.depth;
      card.streak++;
    }

    return { previousDepth, newDepth: card.depth, lift: kick.lift, kickTime: kick.kickTime };
  }

  const api: PhysicsSession = {
    advance(dt: number): TransitionResult {
      if (!Number.isFinite(dt) || dt < 0) {
        throw new RangeError('Duration must be finite and nonnegative');
      }
      if (state.paused || state.complete) {
        return { unlockedIndex: null, unlockedCardId: null, completedNow: false };
      }
      const activeCount = unlockedCount();
      for (const card of state.cards) {
        if (!card.unlocked) continue;
        card.depth = fallingDepth(card.depth, dt, config, activeCount);
        card.shown = config.instantPosition
          ? card.depth
          : card.shown + (card.depth - card.shown) * (1 - Math.exp(-15 * dt));
      }
      state.time += dt;
      return reconcile();
    },

    skip(): SkipResult | null {
      if (state.paused || state.complete) return null;

      const index = select();
      const card = state.cards[index]!;
      state.skipCount++;
      state.skippedIndex = index;
      state.skippedCardId = card.id;
      state.selectedIndex = -1;
      state.selectedCardId = '';

      const transition = reconcile();
      const result: SkipResult = {
        kind: 'skip',
        index,
        cardId: card.id,
        unlockedIndex: transition.unlockedIndex,
        unlockedCardId: transition.unlockedCardId,
        completedNow: transition.completedNow
      };
      return clone(result);
    },

    applyReward(cardIdentifierOrMagnitude: CardId | number, maybeMagnitude?: number): RewardResult | null {
      if (state.paused || state.complete) return null;

      let index: number;
      let rewardMagnitude: number;

      if (maybeMagnitude !== undefined) {
        if (typeof cardIdentifierOrMagnitude === 'number') {
          if (!Number.isInteger(cardIdentifierOrMagnitude)) {
            throw new TypeError('cardIdentifier must be an integer index or valid card ID');
          }
          if (cardIdentifierOrMagnitude < 0 || cardIdentifierOrMagnitude >= state.cards.length) {
            throw new RangeError('cardIdentifier out of range');
          }
          index = cardIdentifierOrMagnitude;
        } else if (typeof cardIdentifierOrMagnitude === 'string') {
          index = state.cards.findIndex(c => c.id === cardIdentifierOrMagnitude);
          if (index < 0) {
            throw new TypeError(`Unknown card ID: ${cardIdentifierOrMagnitude}`);
          }
        } else {
          throw new TypeError('cardIdentifier must be an integer index or valid card ID');
        }
        rewardMagnitude = maybeMagnitude;
      } else {
        if (typeof cardIdentifierOrMagnitude !== 'number' || !Number.isFinite(cardIdentifierOrMagnitude) || cardIdentifierOrMagnitude < 0) {
          throw new RangeError('rewardMagnitude must be a finite, nonnegative number');
        }
        index = select();
        rewardMagnitude = cardIdentifierOrMagnitude;
      }

      if (typeof rewardMagnitude !== 'number' || !Number.isFinite(rewardMagnitude) || rewardMagnitude < 0) {
        throw new RangeError('rewardMagnitude must be a finite, nonnegative number');
      }

      const card = state.cards[index]!;
      if (!card.unlocked) return null;

      const previousDepth = card.depth;
      const kick = executeKick(index, rewardMagnitude);

      state.rewardCount++;
      state.skippedIndex = -1;
      state.skippedCardId = null;
      state.selectedIndex = -1;
      state.selectedCardId = '';

      const transition = reconcile();
      const result: RewardResult = {
        kind: 'reward',
        index,
        cardId: card.id,
        rewardMagnitude,
        previousDepth,
        newDepth: card.depth,
        lift: kick.lift,
        kickTime: kick.kickTime,
        unlockedIndex: transition.unlockedIndex,
        unlockedCardId: transition.unlockedCardId,
        completedNow: transition.completedNow
      };
      state.lastReward = result;
      return clone(result);
    },

    getState(): SessionSnapshot {
      const unlockedCardCount = unlockedCount();
      const clonedCards = clone(state.cards);

      return clone({
        ...state,
        cards: clonedCards,
        config,
        unlockedCardCount,
        gravityMultiplier: gravityMultiplier(config, unlockedCardCount),
        fieldFallTime: fieldFallTime(config, unlockedCardCount),
        baselineKickTime: baselineKickTime(config, unlockedCardCount)
      });
    },

    getProgress,

    getLowestIndex: lowestIndex,

    getLowestCardId(): CardId {
      const idx = lowestIndex();
      return idx >= 0 ? state.cards[idx]!.id : '';
    },

    getCard(cardIdentifier: CardId | number): CardState | undefined {
      if (typeof cardIdentifier === 'number') {
        const card = state.cards[cardIdentifier];
        return card ? clone(card) : undefined;
      }
      const card = state.cards.find(c => c.id === cardIdentifier);
      return card ? clone(card) : undefined;
    },

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
  timeCoordinateKick,
  cardProgress,
  isAboveFinish
});

export default MunduPhysics;
