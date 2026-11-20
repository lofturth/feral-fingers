// Converts browser performance timestamps to a timeline that excludes pauses.
export function createPracticeClock() {
  let pausedAt: number | null = null, pausedTotal = 0;
  return {
    pause(time: number) { if (pausedAt === null) pausedAt = time; },
    resume(time: number) { if (pausedAt !== null) { pausedTotal += Math.max(0, time - pausedAt); pausedAt = null; } },
    time(time: number) { return (pausedAt === null ? time : Math.min(time, pausedAt)) - pausedTotal; },
    isPaused() { return pausedAt !== null; }
  };
}
