export type AttemptMidiEvent = {
  type: 'note-on' | 'note-off';
  pitch: number;
  velocity: number;
  channel: number;
  timestamp: number; // milliseconds on the browser's performance timeline
  device: { id: string; name: string };
};

export function createAttemptRecording() {
  let events: AttemptMidiEvent[] = [];
  return {
    record(event: AttemptMidiEvent) { events.push(event); },
    reset() { events = []; },
    getEvents() { return [...events]; }
  };
}
