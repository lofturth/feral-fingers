'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('../card-lab/node_modules/typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
const { canonical } = require('../deckStorage.ts');
const { summarizeSession, findRevision } = require('../sessionDetails.ts');

test('summarizes recorded attempts, scores, skips, and interruptions without counting rewards', () => {
  const events = [
    { type: 'attempt-start', exerciseId: 'a', attemptId: 1 },
    { type: 'result', exerciseId: 'a', attemptId: 1, score: 50 },
    { type: 'attempt-end', exerciseId: 'a', attemptId: 1, reason: 'completed' },
    { type: 'reward', exerciseId: 'a', attemptId: 1, applied: true },
    { type: 'attempt-start', exerciseId: 'a', attemptId: 2 },
    { type: 'attempt-end', exerciseId: 'a', attemptId: 2, reason: 'skipped' },
    { type: 'skip', exerciseId: 'a', attemptId: 2, applied: true },
    { type: 'attempt-start', exerciseId: 'b', attemptId: 3 },
    { type: 'attempt-end', exerciseId: 'b', attemptId: 3, reason: 'interrupted' },
    { type: 'attempt-start', exerciseId: 'b', attemptId: 4 },
    { type: 'result', exerciseId: 'b', attemptId: 4, score: 100 }
  ];
  assert.deepEqual(summarizeSession(events), { attempts: 4, successes: 2, skips: 1, cards: [
    { id: 'a', attempts: 2, results: ['50%', 'Skipped'] },
    { id: 'b', attempts: 2, results: ['Interrupted', '100%'] }
  ] });
  assert.deepEqual(summarizeSession([]), { attempts: 0, successes: 0, skips: 0, cards: [] });
});

test('matches the snapshot to its saved revision and leaves unknown revisions unknown', () => {
  const old = { id: 'a', title: 'Old' }, current = { id: 'a', title: 'New' };
  const decks = [ { deckId: 'a', revision: canonical(current), createdAt: '2026-02-01' }, { deckId: 'a', revision: canonical(old), createdAt: '2026-01-01' } ];
  assert.deepEqual(findRevision(old, decks), { number: 1, createdAt: '2026-01-01' });
  assert.deepEqual(findRevision(current, decks), { number: 2, createdAt: '2026-02-01' });
  assert.equal(findRevision({ id: 'a', title: 'Unknown' }, decks), null);
});
