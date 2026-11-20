import type { DemonstrationTiming } from './fluency';

export type AttemptColor = 'blue' | 'green' | 'orange';
export function attemptColor(previous: AttemptColor, expected: readonly number[], played: readonly { pitch: number; timestamp: number }[], timing: DemonstrationTiming | null, now: number): AttemptColor {
  if (previous === 'orange' || played.some((note, index) => note.pitch !== expected[index])) return 'orange';
  if (previous === 'green') return 'green';
  if (played.length && timing && expected.length > 1) {
    const limitMs = 1.2 * (expected.length - 1) * 60000 / (timing.tempo * timing.notesPerBeat);
    if (now - played[0].timestamp > limitMs) return 'green';
  }
  return 'blue';
}
