'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('../card-lab/node_modules/typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
const { saveDeck, listDecks, getDeck } = require('../deckStorage.ts');

function fakeIndexedDB() {
  const records = new Map();
  return { open() {
    const db = {
      createObjectStore() {}, close() {},
      transaction() {
        const tx = { objectStore() { return {
          get(key) { const request = {}; setImmediate(() => { request.result = structuredClone(records.get(JSON.stringify(key))); request.onsuccess?.(); setImmediate(() => tx.oncomplete?.()); }); return request; },
          getAll() { const request = {}; setImmediate(() => { request.result = structuredClone([...records.values()]); tx.oncomplete?.(); }); return request; },
          add(value) { records.set(JSON.stringify([value.deckId, value.revision]), structuredClone(value)); }
        }; } };
        return tx;
      }
    };
    const request = { result: db };
    setImmediate(() => { request.onupgradeneeded?.(); request.onsuccess?.(); });
    return request;
  } };
}
const deck = { schemaVersion: 1, id: 'one', title: 'Original', exercises: [{ id: 'a', label: 'A', notes: [60] }], extra: { author: 'Player', instrument: 'piano' } };

test('stores distinct revisions, deduplicates reordered objects, and retrieves original content', async () => {
  global.indexedDB = fakeIndexedDB();
  const first = await saveDeck(deck);
  const duplicate = await saveDeck({ extra: { instrument: 'piano', author: 'Player' }, exercises: [{ notes: [60], label: 'A', id: 'a' }], title: 'Original', id: 'one', schemaVersion: 1 });
  assert.equal(duplicate.revision, first.revision);
  assert.equal(duplicate.createdAt, first.createdAt);
  const changed = await saveDeck({ ...deck, title: 'Revised', exercises: [{ ...deck.exercises[0], notes: [61] }] });
  assert.notEqual(changed.revision, first.revision);
  assert.equal((await listDecks()).length, 2);
  assert.deepEqual((await getDeck('one', first.revision)).content, deck);
  assert.equal((await getDeck('one', changed.revision)).title, 'Revised');
  assert.equal(await getDeck('missing', first.revision), undefined);
  await assert.rejects(saveDeck({ ...deck, exercises: [] }));
  assert.equal((await listDecks()).length, 2);
  delete global.indexedDB;
});

test('storage failures reject for the caller to handle', async () => {
  global.indexedDB = { open() { throw new Error('denied'); } };
  await assert.rejects(saveDeck(deck), /denied/);
  delete global.indexedDB;
});
