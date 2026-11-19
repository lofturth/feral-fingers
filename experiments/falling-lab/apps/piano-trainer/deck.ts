export type PianoExercise = { id: string; label: string; notes: number[] };
export type PianoDeck = { schemaVersion: 1; id: string; title: string; exercises: PianoExercise[] };

export function parseDeck(input: unknown): PianoDeck {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Deck must be a JSON object.');
  const deck = input as Record<string, unknown>;
  if (deck.schemaVersion !== 1) throw new Error('Unsupported schemaVersion; expected 1.');
  if (typeof deck.id !== 'string' || !deck.id.trim()) throw new Error('Deck id must be a non-empty string.');
  if (typeof deck.title !== 'string' || !deck.title.trim()) throw new Error('Deck title must be a non-empty string.');
  if (!Array.isArray(deck.exercises) || !deck.exercises.length) throw new Error('Deck must contain at least one exercise.');
  const ids = new Set<string>();
  const exercises = deck.exercises.map((value, index): PianoExercise => {
    const prefix = `Exercise ${index + 1}`;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${prefix} must be an object.`);
    const exercise = value as Record<string, unknown>;
    if (typeof exercise.id !== 'string' || !exercise.id.trim()) throw new Error(`${prefix}: id must be a non-empty string.`);
    if (ids.has(exercise.id)) throw new Error(`${prefix}: duplicate id "${exercise.id}".`);
    ids.add(exercise.id);
    if (typeof exercise.label !== 'string' || !exercise.label.trim()) throw new Error(`${prefix}: label must be a non-empty string.`);
    if (!Array.isArray(exercise.notes) || !exercise.notes.length || !exercise.notes.every(note => Number.isInteger(note) && note >= 0 && note <= 127)) throw new Error(`${prefix}: notes must be a non-empty array of MIDI integers from 0 to 127.`);
    return { id: exercise.id, label: exercise.label, notes: exercise.notes as number[] };
  });
  return { schemaVersion: 1, id: deck.id, title: deck.title, exercises };
}
