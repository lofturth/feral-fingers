'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('../card-lab/node_modules/typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
const { groupDecks } = require('../myDecks.ts');

test('groups revisions and sorts decks and sessions using the requested dates', () => {
  const decks = [
    { deckId: 'a', title: 'Old', createdAt: '2025-01-01', revision: '1' },
    { deckId: 'a', title: 'New', createdAt: '2025-03-01', revision: '2' },
    { deckId: 'b', title: 'B', createdAt: '2025-02-01', revision: '1' },
    { deckId: 'c', title: 'C', createdAt: '2025-04-01', revision: '1' }
  ];
  const sessions = [
    { sessionId: 'one', deck: { id: 'a' }, startTime: '2025-05-01' },
    { sessionId: 'two', deck: { id: 'a' }, startTime: '2025-07-01' },
    { sessionId: 'three', deck: { id: 'b' }, startTime: '2025-06-01' },
    { sessionId: 'unknown', deck: { id: 'other' }, startTime: '2025-08-01' }
  ];
  const created = groupDecks(decks, sessions, 'created');
  assert.deepEqual(created.map(row => row.deck.deckId), ['c', 'b', 'a']);
  assert.equal(created[2].deck.title, 'New');
  assert.equal(created[2].createdAt, '2025-01-01');
  assert.deepEqual(created[2].sessions.map(session => session.sessionId), ['two', 'one']);
  assert.deepEqual(groupDecks(decks, sessions, 'practiced').map(row => row.deck.deckId), ['a', 'b', 'c']);
});
