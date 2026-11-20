import { canonical, type SavedDeck } from './deckStorage';
import { parseDeck } from './deck';
import type { SessionSummary } from './practiceStorage';

export type DeckReference = { deckId: string; revision: string };
const usageKey = 'piano-trainer.recent-decks';
export function starterRecord(content: unknown): SavedDeck {
  const deck = parseDeck(content);
  return { deckId: deck.id, title: deck.title, revision: canonical(content), createdAt: '', content, builtIn: true };
}
export function withStarter(saved: SavedDeck[], starter: SavedDeck): SavedDeck[] {
  const matching = saved.some(deck => deck.deckId === starter.deckId && deck.revision === starter.revision);
  return matching ? saved.map(deck => deck.deckId === starter.deckId && deck.revision === starter.revision ? { ...deck, builtIn: true } : deck) : [...saved, starter];
}
export function rememberDeck(content: unknown): void {
  try {
    const deck = parseDeck(content), reference = { deckId: deck.id, revision: canonical(content) };
    const recent = readRecentDecks().filter(item => item.deckId !== reference.deckId || item.revision !== reference.revision);
    localStorage.setItem(usageKey, JSON.stringify([reference, ...recent].slice(0, 100)));
  } catch { /* Keep practice available when storage is unavailable. */ }
}
export function readRecentDecks(): DeckReference[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(usageKey) || '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is DeckReference => item && typeof item.deckId === 'string' && typeof item.revision === 'string') : [];
  } catch { return []; }
}
export function chooseInitialDeck(saved: SavedDeck[], sessions: SessionSummary[], recent: DeckReference[], starter: SavedDeck): SavedDeck {
  const available = withStarter(saved, starter).filter(deck => { try { parseDeck(deck.content); return true; } catch { return false; } });
  const references = [...recent, ...[...sessions].sort((a, b) => b.startTime.localeCompare(a.startTime)).flatMap(session => {
    try { return [{ deckId: parseDeck(session.deck).id, revision: canonical(session.deck) }]; } catch { return []; }
  })];
  for (const reference of references) {
    const exact = available.find(deck => deck.deckId === reference.deckId && deck.revision === reference.revision);
    if (exact) return exact;
    const sameDeck = available.filter(deck => deck.deckId === reference.deckId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (sameDeck) return sameDeck;
  }
  return available.filter(deck => !deck.builtIn).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? starter;
}
