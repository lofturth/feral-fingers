export type DemonstrationTiming = { tempo: number; notesPerBeat: 1 | 2 | 4 };
export type Fluency = { accuracy: 'clean' | 'extra-or-incorrect' | null; executionTime: number | null; referenceTime: number | null; speedRatio: number | null; fluent: boolean | null };

// Durations are seconds; MIDI event timestamps are milliseconds.
export function measureFluency(expected: readonly number[], played: readonly { pitch: number; timestamp: number }[], timing: DemonstrationTiming | null, completed: boolean): Fluency {
  const referenceTime = timing && expected.length > 0 ? (expected.length - 1) * 60 / (timing.tempo * timing.notesPerBeat) : null;
  let start = -1;
  if (completed && expected.length) start = played.findIndex((_, index) => index + expected.length <= played.length && expected.every((pitch, offset) => played[index + offset].pitch === pitch));
  const span = start < 0 ? null : (played[start + expected.length - 1].timestamp - played[start].timestamp) / 1000;
  const executionTime = span !== null && Number.isFinite(span) && span >= 0 ? span : null;
  const accuracy = start < 0 ? null : played.length === expected.length ? 'clean' : 'extra-or-incorrect';
  const speedRatio = referenceTime !== null && executionTime !== null && executionTime > 0 ? referenceTime / executionTime : null;
  const fluent = accuracy === 'extra-or-incorrect' ? false : accuracy === 'clean' && executionTime !== null && referenceTime !== null ? executionTime <= 1.2 * referenceTime : null;
  return { accuracy, executionTime, referenceTime, speedRatio, fluent };
}
