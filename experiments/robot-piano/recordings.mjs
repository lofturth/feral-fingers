export const RECORD_SCHEMA_VERSION = 1;
export const DATABASE_VERSION = 1;
const DATABASE_NAME = 'robot-piano-recordings';

export function openRecordings() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('IndexedDB is unavailable in this browser.')); return; }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'sessionId' });
      if (!db.objectStoreNames.contains('attempts')) {
        const attempts = db.createObjectStore('attempts', { keyPath: 'attemptId' });
        attempts.createIndex('status', 'status');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Recording database is blocked by another tab.'));
  });
}

function put(db, storeName, record) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Recording write was aborted.'));
  });
}

export const saveSession = (db, session) => put(db, 'sessions', session);
export const saveAttempt = (db, attempt) => put(db, 'attempts', attempt);

export function countCompleted(db) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('attempts', 'readonly');
    const request = transaction.objectStore('attempts').index('status').count('completed');
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
  });
}

export function readAllRecordings(db) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['sessions', 'attempts'], 'readonly');
    const sessions = transaction.objectStore('sessions').getAll();
    const attempts = transaction.objectStore('attempts').getAll();
    transaction.oncomplete = () => resolve({ sessions: sessions.result, attempts: attempts.result });
    transaction.onerror = () => reject(transaction.error);
  });
}
