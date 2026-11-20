export type GravityHistoryEntry = { value: number; direction: 'neutral' | 'decrease' | 'increase' };
export function appendGravityHistory(history: readonly GravityHistoryEntry[], value: number): GravityHistoryEntry[] {
  const previous = history[history.length - 1]?.value;
  const direction: GravityHistoryEntry['direction'] = previous === undefined || value === previous ? 'neutral' : value < previous ? 'decrease' : 'increase';
  return [...history, { value, direction }].slice(-10);
}
