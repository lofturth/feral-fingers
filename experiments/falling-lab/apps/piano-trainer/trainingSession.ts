import type { PhysicsSession } from '../../core/physics';

export function createTrainingSession(session: PhysicsSession) {
  let lastTime: number | null = null;
  function advanceTo(time: number) {
    const nextTime = lastTime === null ? time : Math.max(time, lastTime);
    if (lastTime !== null && !session.getState().paused) session.advance((nextTime - lastTime) / 1000);
    lastTime = nextTime;
  }
  return {
    advanceTo,
    resetClock() { lastTime = null; },
    complete(cardId: string, score: 50 | 100, time: number) {
      advanceTo(time);
      const state = session.getState();
      if (state.paused || state.complete || state.selectedCardId !== cardId) return null;
      return session.applyReward(cardId, score / 100);
    },
    skip(cardId: string, time: number) {
      advanceTo(time);
      const state = session.getState();
      if (state.paused || state.complete || state.selectedCardId !== cardId) return null;
      return session.skip();
    }
  };
}
