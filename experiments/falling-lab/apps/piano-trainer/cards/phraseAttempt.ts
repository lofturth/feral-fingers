import { evaluatePhrase } from './evaluatePhrase.ts';

export function createPhraseAttempt(expected: readonly number[]) {
  let played: number[] = [];
  return {
    note(pitch: number): 50 | 100 | null {
      played.push(pitch);
      const score = evaluatePhrase(expected, played);
      if (score === 0) return null;
      played = [];
      return score;
    },
    reset() { played = []; }
  };
}
