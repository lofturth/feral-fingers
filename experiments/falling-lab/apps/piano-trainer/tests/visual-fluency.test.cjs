'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('../card-lab/node_modules/typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
const { attemptColor } = require('../visualFluency.ts');
const timing = { tempo: 120, notesPerBeat: 2 };
const expected = [60, 62, 64];
const first = [{ pitch: 60, timestamp: 100 }];

test('clean attempts turn from blue to green only after the fluency deadline', () => {
  assert.equal(attemptColor('blue', expected, first, timing, 700), 'blue');
  assert.equal(attemptColor('blue', expected, first, timing, 701), 'green');
  assert.equal(attemptColor('green', expected, first, timing, 200), 'green');
});
test('a wrong or extra note turns orange and never improves', () => {
  const wrong = [...first, { pitch: 63, timestamp: 200 }];
  assert.equal(attemptColor('blue', expected, wrong, timing, 200), 'orange');
  assert.equal(attemptColor('green', expected, wrong, timing, 200), 'orange');
  assert.equal(attemptColor('orange', expected, first, timing, 200), 'orange');
  assert.equal(attemptColor('blue', [60], [{ pitch: 60, timestamp: 1 }, { pitch: 60, timestamp: 2 }], timing, 2), 'orange');
});
test('unknown reference timing does not invent a slow outcome', () => {
  assert.equal(attemptColor('blue', expected, first, null, 100000), 'blue');
  assert.equal(attemptColor('blue', [60], first, timing, 100000), 'blue');
});
