'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('../card-lab/node_modules/typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
const { appendGravityHistory } = require('../gravityHistory.ts');
test('gravity history preserves order, direction, unchanged outcomes and a ten-entry window', () => {
  let history = appendGravityHistory([], 1);
  assert.deepEqual(history, [{ value: 1, direction: 'neutral' }]);
  history = appendGravityHistory(history, .9);
  history = appendGravityHistory(history, .927);
  history = appendGravityHistory(history, .927);
  assert.deepEqual(history.map(entry => entry.direction), ['neutral', 'decrease', 'increase', 'neutral']);
  for (let i = 0; i < 10; i++) history = appendGravityHistory(history, .927);
  assert.equal(history.length, 10);
  assert.ok(history.every(entry => entry.value === .927 && entry.direction === 'neutral'));
});
