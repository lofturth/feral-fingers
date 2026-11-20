import { parseDeck } from './deck';

export type SavedDeck = {
  deckId: string;
  title: string;
  revision: string;
  createdAt: string;
  content: unknown;
  builtIn?: boolean;
};

// JSON object key order does not change a deck's identity; array order does.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('piano-trainer-decks', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('decks', { keyPath: ['deckId', 'revision'] });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Deck storage is blocked'));
  });
}

export async function saveDeck(content: unknown): Promise<SavedDeck> {
  const deck = parseDeck(content);
  const snapshot = JSON.parse(JSON.stringify(content)) as unknown;
  const revision = canonical(snapshot);
  const candidate: SavedDeck = { deckId: deck.id, title: deck.title, revision, createdAt: new Date().toISOString(), content: snapshot };
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('decks', 'readwrite');
      const store = tx.objectStore('decks');
      const request = store.get([deck.id, revision]);
      let saved = candidate;
      request.onsuccess = () => {
        if (request.result) saved = request.result as SavedDeck;
        else store.add(candidate);
      };
      tx.oncomplete = () => resolve(saved);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export async function listDecks(): Promise<SavedDeck[]> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('decks', 'readonly');
      const request = tx.objectStore('decks').getAll();
      tx.oncomplete = () => resolve(request.result as SavedDeck[]);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export async function getDeck(deckId: string, revision: string): Promise<SavedDeck | undefined> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('decks', 'readonly');
      const request = tx.objectStore('decks').get([deckId, revision]);
      tx.oncomplete = () => resolve(request.result as SavedDeck | undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
