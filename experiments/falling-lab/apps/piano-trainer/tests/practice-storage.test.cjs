'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('../card-lab/node_modules/typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
const { createSessionRecorder } = require('../sessionRecorder.ts');
const flush = () => new Promise(resolve => setTimeout(resolve, 20));

function fakeIndexedDB() {
  const stores = { sessions: new Map(), events: new Map() };
  const db = {
    createObjectStore() {},
    transaction(name) {
      const transaction = { objectStore: () => ({
        add(value) { const key = name === 'sessions' ? value.sessionId : `${value.sessionId}:${value.sequence}`; if (stores[name].has(key)) throw Error('duplicate'); stores[name].set(key, structuredClone(value)); },
        put(value) { stores[name].set(value.sessionId, structuredClone(value)); }
      }) };
      setTimeout(() => transaction.oncomplete?.(), 0);
      return transaction;
    }
  };
  return { stores, open() { const request = { result: db }; setTimeout(() => { request.onupgradeneeded?.(); request.onsuccess?.(); }, 0); return request; } };
}

test('sessions and events are written incrementally and completed sessions stop changing', async () => {
  const idb = fakeIndexedDB(); global.indexedDB = idb;
  const recorder = createSessionRecorder({ id: 'deck', extra: true });
  recorder.start(100, { tempo: 100 });
  recorder.record({ type: 'midi', timestamp: 110, data: [144, 60, 80], device: { id: 'x', name: 'keys' } });
  await flush();
  const id = recorder.getRecord().sessionId;
  assert.equal(idb.stores.sessions.get(id).status, 'interrupted');
  assert.deepEqual(idb.stores.events.get(`${id}:0`).event.data, [144, 60, 80]);
  recorder.record({ type: 'skip', timestamp: 120, exerciseId: 'a', attemptId: 1, applied: true });
  recorder.finish('completed');
  recorder.record({ type: 'midi', timestamp: 130, data: [128, 60, 0], device: { id: 'x', name: 'keys' } });
  await flush();
  assert.equal(idb.stores.sessions.get(id).status, 'completed');
  assert.equal(idb.stores.events.size, 2);
  assert.equal(idb.stores.sessions.get(id).schemaVersion, 1);
  delete global.indexedDB;
});

test('unavailable storage does not prevent recording in memory', async () => {
  global.indexedDB = { open() { throw Error('denied'); } };
  const recorder = createSessionRecorder({});
  recorder.start(100, { tempo: 100 });
  recorder.record({ type: 'selection', timestamp: 101, previous: null, next: 'a', cause: 'start' });
  recorder.finish('completed');
  await flush();
  assert.equal(recorder.getRecord().events.length, 1);
  delete global.indexedDB;
});

test('deleting a session removes only its events in one transaction', async () => {
  const sessions = new Map([['a', {}], ['b', {}]]);
  const events = new Map([['a:0', {}], ['a:1', {}], ['b:0', {}]]);
  let names, mode;
  global.IDBKeyRange = { bound: (lower, upper) => ({ lower, upper }) };
  global.indexedDB = { open() {
    const request = { result: {
      close() {},
      transaction(stores, access) {
        names = stores; mode = access;
        const tx = { objectStore(name) { return { delete(key) {
          if (name === 'sessions') sessions.delete(key);
          else for (const eventKey of events.keys()) if (eventKey.startsWith(`${key.lower[0]}:`)) events.delete(eventKey);
        } }; } };
        setImmediate(() => tx.oncomplete());
        return tx;
      }
    } };
    setImmediate(() => request.onsuccess());
    return request;
  } };
  const { deletePracticeSession } = require('../practiceStorage.ts');
  await deletePracticeSession('a');
  assert.deepEqual(names, ['sessions', 'events']);
  assert.equal(mode, 'readwrite');
  assert.deepEqual([...sessions.keys()], ['b']);
  assert.deepEqual([...events.keys()], ['b:0']);
  delete global.IDBKeyRange;
  delete global.indexedDB;
});
