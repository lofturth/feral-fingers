import type { PianoExercise } from './deck';
import { createAttemptRecording, type AttemptMidiEvent } from './midi/attemptRecording';
import type { LogEvent } from './eventLog';

export function createAttemptDiagnostics(onLog: LogEvent, nextAttemptId: () => number) {
  let current: { cardId: string; exercise: PianoExercise; id: number; recording: ReturnType<typeof createAttemptRecording> } | null = null;
  function begin(exercise: PianoExercise, timestamp: number) {
    if (current && current.cardId !== exercise.id) {
      onLog({ timestamp, type: 'Attempt interrupted', attemptId: current.id, detail: `${describe(current.exercise)}; selection changed` });
      current = null;
    }
    if (!current) {
      current = { cardId: exercise.id, exercise, id: nextAttemptId(), recording: createAttemptRecording() };
      onLog({ timestamp, type: 'Attempt started', attemptId: current.id, detail: `Card ${exercise.id} (${exercise.label}); expected: [${exercise.notes.join(', ')}]` });
    }
    return current;
  }
  function describe(exercise: PianoExercise) {
    const actual = current!.recording.getEvents().filter(note => note.type === 'note-on').map(note => note.pitch);
    return `Card ${exercise.id} (${exercise.label}); expected: [${exercise.notes.join(', ')}]; actual: [${actual.join(', ')}]`;
  }
  return {
    reset(timestamp: number) { if (current) { onLog({ timestamp, type: 'Attempt interrupted', attemptId: current.id, detail: `${describe(current.exercise)}; paused` }); current = null; } },
    selectionChanged(selectedId: string, timestamp: number) {
      if (current && current.cardId !== selectedId) {
        onLog({ timestamp, type: 'Attempt interrupted', attemptId: current.id, detail: `${describe(current.exercise)}; selection changed` });
        current = null;
      }
    },
    midi(event: AttemptMidiEvent, exercise: PianoExercise | null) {
      if (exercise && event.type === 'note-on') begin(exercise, event.timestamp);
      if (current) current.recording.record(event);
      onLog({ timestamp: event.timestamp, type: `MIDI ${event.type}`, attemptId: current?.id, detail: `pitch ${event.pitch}; velocity ${event.velocity}; channel ${event.channel}; input ${event.device.name} [${event.device.id}]` });
      return current?.id ?? null;
    },
    complete(exercise: PianoExercise, score: 50 | 100, timestamp: number) {
      const active = begin(exercise, timestamp);
      onLog({ timestamp, type: 'Attempt completed', attemptId: active.id, detail: describe(exercise) });
      onLog({ timestamp, type: 'Evaluation', attemptId: active.id, detail: `Result ${score}` });
      current = null;
      return active.id;
    },
    skip(exercise: PianoExercise, timestamp: number) {
      const active = begin(exercise, timestamp);
      onLog({ timestamp, type: 'Attempt skipped', attemptId: active.id, detail: describe(exercise) });
      current = null;
      return active.id;
    }
  };
}
