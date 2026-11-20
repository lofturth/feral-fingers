import type { PhysicsSession } from '../../core/physics';

export type SelectionChange = { previous: string; next: string; cause: 'advance' | 'reward' | 'skip'; timestamp: number };
export function createTrainingSession(session: PhysicsSession, onSelectionChange?: (change: SelectionChange) => void) {
  let lastTime: number | null = null;
  function reportSelection(previous: string, cause: SelectionChange['cause'], timestamp: number) {
    const next = session.getState().selectedCardId;
    if (previous !== next) onSelectionChange?.({ previous, next, cause, timestamp });
  }
  function advanceTo(time: number) {
    const nextTime = lastTime === null ? time : Math.max(time, lastTime);
    if (lastTime !== null && !session.getState().paused) {
      const previous = session.getState().selectedCardId;
      session.advance((nextTime - lastTime) / 1000);
      reportSelection(previous, 'advance', nextTime);
    }
    lastTime = nextTime;
  }
  return {
    advanceTo,
    resetClock() { lastTime = null; },
    complete(cardId: string, score: 50 | 100, time: number, observeSelection?: (id: string) => void, fluent: boolean | null = null) {
      advanceTo(time);
      const state = session.getState();
      observeSelection?.(state.selectedCardId);
      if (state.paused || state.complete || state.selectedCardId !== cardId) return null;
      const result = session.applyReward(cardId, score / 100);
      if (result && (score === 50 || fluent === true)) {
        const card = session.getCard(cardId);
        if (card) session.setCardGravityMultiplier(cardId, Math.min(1, Math.max(.2, card.gravityMultiplier * (score === 50 ? 1.03 : .9))));
      }
      reportSelection(state.selectedCardId, 'reward', Math.max(time, lastTime ?? time));
      return result;
    },
    skip(cardId: string, time: number, observeSelection?: (id: string) => void) {
      advanceTo(time);
      const state = session.getState();
      observeSelection?.(state.selectedCardId);
      if (state.paused || state.complete || state.selectedCardId !== cardId) return null;
      const result = session.skip();
      reportSelection(state.selectedCardId, 'skip', Math.max(time, lastTime ?? time));
      return result;
    }
  };
}
