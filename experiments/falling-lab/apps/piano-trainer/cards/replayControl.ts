import type { AttemptMidiEvent } from '../midi/attemptRecording';

export function createReplayControl(replay: () => void, togglePause: () => void = () => {}) {
  const held = new Map<number, Set<number>>();
  return {
    handle(event: AttemptMidiEvent) {
      if (event.pitch !== 48 && event.pitch !== 84) return false;
      let channels = held.get(event.pitch);
      if (!channels) { channels = new Set(); held.set(event.pitch, channels); }
      if (event.type === 'note-off') channels.delete(event.channel);
      else if (!channels.has(event.channel)) {
        const wasHeld = channels.size > 0; channels.add(event.channel);
        if (!wasHeld) (event.pitch === 48 ? replay : togglePause)();
      }
      return true;
    },
    reset() { held.clear(); }
  };
}
