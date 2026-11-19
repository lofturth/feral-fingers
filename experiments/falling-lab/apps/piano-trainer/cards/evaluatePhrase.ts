// Compare note-on pitches only; timing and other MIDI details do not affect the result.
export function evaluatePhrase(expected: readonly number[], played: readonly number[]): 0 | 50 | 100 {
  if (expected.length === 0 || played.length < expected.length) return 0;
  const containsPhrase = played.some((_, start) =>
    start + expected.length <= played.length && expected.every((pitch, offset) => played[start + offset] === pitch)
  );
  if (!containsPhrase) return 0;
  return played.length === expected.length ? 100 : 50;
}
