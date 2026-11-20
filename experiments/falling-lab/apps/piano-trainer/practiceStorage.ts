import type { SessionEvent } from './sessionRecorder';

// An unfinished session is stored as interrupted from the outset. This remains
// accurate after an abrupt browser exit, without relying on unload events.
export type StoredSession = { schemaVersion: 1; sessionId: string; startTime: string; deck: unknown; settings?: unknown; status: 'interrupted' | 'completed' };

export function createPracticeStorage() {
  let database: Promise<IDBDatabase> | undefined;
  function open() {
    if (!database) database = new Promise((resolve, reject) => {
      const request = indexedDB.open('piano-trainer-practice', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('sessions', { keyPath: 'sessionId' });
        request.result.createObjectStore('events', { keyPath: ['sessionId', 'sequence'] });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Practice storage is blocked'));
    });
    return database;
  }
  let queue = Promise.resolve();
  let failed = false;
  function write(store: 'sessions' | 'events', value: unknown, add = false) {
    queue = queue.then(async () => {
      if (failed) return;
      const db = await open();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(store, 'readwrite');
        if (add) transaction.objectStore(store).add(value); else transaction.objectStore(store).put(value);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    }).catch(() => { failed = true; /* Storage must never interrupt practice. */ });
  }
  return {
    flush() { return queue; },
    start(session: StoredSession) { write('sessions', session, true); },
    event(sessionId: string, sequence: number, event: unknown) { write('events', { sessionId, sequence, event }, true); },
    complete(session: StoredSession) { write('sessions', { ...session, status: 'completed' }); }
  };
}

export type SessionSummary = StoredSession & { durationMs: number | null };
export async function listPracticeSessions(): Promise<SessionSummary[]> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('piano-trainer-practice', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('sessions', { keyPath: 'sessionId' });
      request.result.createObjectStore('events', { keyPath: ['sessionId', 'sequence'] });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Practice storage is blocked'));
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(['sessions', 'events'], 'readonly');
      const sessions = tx.objectStore('sessions').getAll();
      const events = tx.objectStore('events').getAll();
      tx.oncomplete = () => {
        const durations = new Map<string, number>();
        for (const entry of events.result as { sessionId: string; event?: { time?: number } }[]) {
          const time = entry.event?.time;
          if (typeof time === 'number' && Number.isFinite(time)) durations.set(entry.sessionId, Math.max(0, durations.get(entry.sessionId) ?? 0, time));
        }
        resolve((sessions.result as StoredSession[]).map(session => ({ ...session, durationMs: durations.get(session.sessionId) ?? null })));
      };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export async function getPracticeEvents(sessionId: string): Promise<SessionEvent[]> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('piano-trainer-practice', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('sessions', { keyPath: 'sessionId' });
      request.result.createObjectStore('events', { keyPath: ['sessionId', 'sequence'] });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Practice storage is blocked'));
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('events', 'readonly');
      const request = tx.objectStore('events').getAll(IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER]));
      tx.oncomplete = () => resolve((request.result as { event: SessionEvent }[]).map(entry => entry.event));
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export async function deletePracticeSession(sessionId: string): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('piano-trainer-practice', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('sessions', { keyPath: 'sessionId' });
      request.result.createObjectStore('events', { keyPath: ['sessionId', 'sequence'] });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Practice storage is blocked'));
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['sessions', 'events'], 'readwrite');
      tx.objectStore('sessions').delete(sessionId);
      tx.objectStore('events').delete(IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER]));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
