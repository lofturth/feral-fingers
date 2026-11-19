// Owns only the automatic-playback timer; it never advances the learning session.
export function createPlaybackDelay(play: () => void, clock = { now: () => performance.now(), set: (fn: () => void, ms: number) => setTimeout(fn, ms), clear: (id: ReturnType<typeof setTimeout>) => clearTimeout(id) }) {
  let timer: ReturnType<typeof setTimeout> | null = null, remaining: number | null = null, started = 0, paused = false;
  function cancel() { if (timer !== null) clock.clear(timer); timer = null; remaining = null; }
  function start() {
    if (remaining === null || paused) return;
    if (remaining <= 0) { remaining = null; play(); return; }
    started = clock.now();
    timer = clock.set(() => { timer = null; remaining = null; play(); }, remaining);
  }
  return {
    schedule(ms: number) { cancel(); remaining = ms; start(); },
    cancel,
    isPending() { return remaining !== null; },
    pause() { if (paused) return; paused = true; if (timer !== null) { clock.clear(timer); timer = null; remaining = Math.max(0, (remaining ?? 0) - (clock.now() - started)); } },
    resume() { if (!paused) return; paused = false; start(); },
    reset() { cancel(); paused = false; }
  };
}
