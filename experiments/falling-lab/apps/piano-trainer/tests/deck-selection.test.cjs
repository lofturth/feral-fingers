'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('../card-lab/node_modules/typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
const { canonical } = require('../deckStorage.ts');
const { starterRecord, withStarter, rememberDeck, readRecentDecks, chooseInitialDeck } = require('../deckSelection.ts');
const { groupDecks } = require('../myDecks.ts');
const source = (id, title) => ({ schemaVersion: 1, id, title, exercises: [{ id: 'one', label: 'One', notes: [60] }] });
const saved = (content, createdAt) => ({ deckId: content.id, title: content.title, revision: canonical(content), content, createdAt });

test('reload restores the last practiced revision and falls back when it is deleted', () => {
  const storage = new Map();
  global.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  try {
    const starter = starterRecord(source('starter', 'Piano Starter'));
    const a = source('a', 'A'), b = source('b', 'B');
    const decks = [saved(a, '2025-01-01'), saved(b, '2025-02-01')];
    rememberDeck(a); rememberDeck(b);
    assert.equal(chooseInitialDeck(decks, [], readRecentDecks(), starter).deckId, 'b');
    assert.equal(chooseInitialDeck([decks[0]], [], readRecentDecks(), starter).deckId, 'a');
    assert.equal(chooseInitialDeck([], [], readRecentDecks(), starter).deckId, 'starter');
    rememberDeck(starter.content);
    assert.equal(chooseInitialDeck(decks, [], readRecentDecks(), starter).deckId, 'starter');
  } finally { delete global.localStorage; }
});

test('starter is virtual, deduplicated and groups with its session history', () => {
  const starter = starterRecord(source('starter', 'Piano Starter'));
  assert.deepEqual(withStarter([], starter), [starter]);
  const previouslySaved = saved(starter.content, '2025-01-01');
  const merged = withStarter([previouslySaved], starter);
  assert.equal(merged.length, 1); assert.equal(merged[0].builtIn, true);
  assert.equal(previouslySaved.builtIn, undefined);
  const rows = groupDecks(merged, [{ sessionId: 's', deck: starter.content, startTime: '2025-03-01' }], 'created');
  assert.equal(rows.length, 1); assert.equal(rows[0].sessions.length, 1);
});

test('existing history and available revisions provide fallback when recent preferences are absent', () => {
  const starter = starterRecord(source('starter', 'Piano Starter'));
  const a = saved(source('a', 'Old'), '2025-01-01'), newer = saved(source('a', 'New'), '2025-03-01');
  const b = saved(source('b', 'B'), '2025-02-01');
  assert.equal(chooseInitialDeck([a, newer, b], [{ deck: b.content, startTime: '2025-04-01' }], [], starter).deckId, 'b');
  assert.equal(chooseInitialDeck([newer], [], [{ deckId: 'a', revision: a.revision }], starter).revision, newer.revision);
  assert.equal(chooseInitialDeck([a, newer, b], [], [], starter).revision, newer.revision);
});
