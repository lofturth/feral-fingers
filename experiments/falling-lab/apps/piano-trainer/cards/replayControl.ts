import type { AttemptMidiEvent } from '../midi/attemptRecording';

export function createReplayControl(replay: () => void) {
  const held = new Set<number>();
  return {
    handle(event: AttemptMidiEvent) {
      if (event.pitch !== 84) return false;
      if (event.type === 'note-off') held.delete(event.channel);
      else if (!held.has(event.channel)) { const wasHeld = held.size > 0; held.add(event.channel); if (!wasHeld) replay(); }
      return true;
    },
    reset() { held.clear(); }
  };
}
