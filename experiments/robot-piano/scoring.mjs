export const WHITE_KEYS = [60, 62, 64, 65, 67, 69, 71, 72];
const PITCH_CLASSES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

export function noteName(pitch) {
  return `${PITCH_CLASSES[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
}

export function newSequence(level = 0, random = Math.random) {
  const available = WHITE_KEYS.slice(0, level + 2);
  return Array.from({ length: level + 3 }, () => available[Math.floor(random() * available.length)]);
}

export function scoreAttempt(target, played, targetTimes) {
  const rows = target.map((pitch, index) => ({
    target: pitch,
    played: played[index]?.pitch ?? null,
    velocity: played[index]?.velocity ?? null,
    correct: played[index] ? played[index].pitch === pitch : false,
    error: played[index] ? Math.round(played[index].time - targetTimes[index]) : null,
  }));
  const errors = rows.map(row => row.error).filter(error => error !== null);
  const offset = errors.length ? Math.round(errors.reduce((sum, error) => sum + error, 0) / errors.length) : null;
  return {
    rows,
    correct: rows.filter(row => row.correct).length,
    offset,
    relativeError: errors.length ? Math.round(errors.reduce((sum, error) => sum + Math.abs(error - offset), 0) / errors.length) : null,
    meanAbsoluteError: errors.length ? Math.round(errors.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length) : null,
  };
}
