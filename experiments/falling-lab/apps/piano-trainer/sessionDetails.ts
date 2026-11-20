import type { SessionEvent } from './sessionRecorder';
import type { SavedDeck } from './deckStorage';
import { canonical } from './deckStorage';

export function summarizeSession(events: SessionEvent[]) {
  const cards = new Map<string, { id: string; attempts: number; results: string[] }>();
  let attempts = 0, successes = 0, skips = 0;
  for (const event of events) {
    if (event.type !== 'attempt-start' && event.type !== 'result' && event.type !== 'attempt-end') continue;
    if (event.type === 'attempt-end' && event.reason === 'completed') continue;
    let card = cards.get(event.exerciseId);
    if (!card) { card = { id: event.exerciseId, attempts: 0, results: [] }; cards.set(event.exerciseId, card); }
    if (event.type === 'attempt-start') { attempts++; card.attempts++; }
    else if (event.type === 'result') { successes++; card.results.push(`${event.score}%`); }
    else if (event.reason === 'skipped') { skips++; card.results.push('Skipped'); }
    else card.results.push('Interrupted');
  }
  return { attempts, successes, skips, cards: [...cards.values()] };
}

export function findRevision(snapshot: unknown, decks: SavedDeck[]) {
  const id = (snapshot as { id?: unknown } | null)?.id;
  const revisions = decks.filter(deck => deck.deckId === id).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.revision.localeCompare(b.revision));
  const index = revisions.findIndex(deck => deck.revision === canonical(snapshot));
  return index < 0 ? null : { number: index + 1, createdAt: revisions[index].createdAt };
}
