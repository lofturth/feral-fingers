import type { SavedDeck } from './deckStorage';
import type { SessionSummary } from './practiceStorage';

export type DeckRow = { deck: SavedDeck; createdAt: string; sessions: SessionSummary[] };
export function groupDecks(decks: SavedDeck[], sessions: SessionSummary[], sort: 'created' | 'practiced'): DeckRow[] {
  const rows = new Map<string, DeckRow>();
  for (const deck of decks) {
    const row = rows.get(deck.deckId);
    if (!row) rows.set(deck.deckId, { deck, createdAt: deck.createdAt, sessions: [] });
    else {
      if (deck.createdAt < row.createdAt) row.createdAt = deck.createdAt;
      if (deck.createdAt > row.deck.createdAt) row.deck = deck;
    }
  }
  for (const session of sessions) {
    const id = (session.deck as { id?: unknown } | null)?.id;
    if (typeof id === 'string') rows.get(id)?.sessions.push(session);
  }
  for (const row of rows.values()) row.sessions.sort((a, b) => b.startTime.localeCompare(a.startTime));
  return [...rows.values()].sort((a, b) => {
    const first = sort === 'created' ? a.createdAt : a.sessions[0]?.startTime ?? '';
    const second = sort === 'created' ? b.createdAt : b.sessions[0]?.startTime ?? '';
    return second.localeCompare(first) || a.deck.title.localeCompare(b.deck.title);
  });
}
