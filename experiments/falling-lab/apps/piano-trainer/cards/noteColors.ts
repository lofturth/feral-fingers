// Light colors retain contrast against the dark field and dark tile labels.
export const PITCH_CLASS_COLORS = [
  '#ffb4ab', '#ffca9b', '#f5d487', '#d9dd8c',
  '#aee1a0', '#8fe0bd', '#88ddd8', '#9ed5f5',
  '#b4c4fa', '#d0b6f4', '#edb1e3', '#ffb3c9'
] as const;

export function colorForPitch(pitch: number): string {
  return PITCH_CLASS_COLORS[((pitch % 12) + 12) % 12];
}

export function colorForNoteName(note: string): string | undefined {
  const match = /^([A-Ga-g])([#♯b♭]?)(?:-?\d+)?$/.exec(note);
  if (!match) return undefined;
  const natural: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const accidental = match[2] === '#' || match[2] === '♯' ? 1 : match[2] === 'b' || match[2] === '♭' ? -1 : 0;
  return colorForPitch(natural[match[1].toUpperCase()] + accidental);
}
