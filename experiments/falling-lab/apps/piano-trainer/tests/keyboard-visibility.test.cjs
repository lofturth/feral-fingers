'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('../card-lab/node_modules/typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
const { loadKeyboardVisibility, saveKeyboardVisibility } = require('../keyboardVisibility.ts');
test('keyboard visibility defaults open, persists changes and tolerates unavailable storage', () => {
  const storage = new Map();
  global.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  try {
    assert.equal(loadKeyboardVisibility(), true);
    saveKeyboardVisibility(false); assert.equal(loadKeyboardVisibility(), false);
    saveKeyboardVisibility(true); assert.equal(loadKeyboardVisibility(), true);
    global.localStorage = { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } };
    assert.equal(loadKeyboardVisibility(), true);
    assert.doesNotThrow(() => saveKeyboardVisibility(false));
  } finally { delete global.localStorage; }
});
