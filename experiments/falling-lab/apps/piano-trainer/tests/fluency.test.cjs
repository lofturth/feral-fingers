'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('../card-lab/node_modules/typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
const { measureFluency } = require('../fluency.ts');
const timing = { tempo: 120, notesPerBeat: 2 };
const notes = (...pairs) => pairs.map(([pitch, timestamp]) => ({ pitch, timestamp }));

test('measures onset span against demonstration timing including threshold', () => {
  assert.deepEqual(measureFluency([60, 62, 64], notes([60, 100], [62, 400], [64, 700]), timing, true), { accuracy: 'clean', executionTime: .6, referenceTime: .5, speedRatio: .5 / .6, fluent: true });
  assert.equal(measureFluency([60, 62, 64], notes([60, 100], [62, 400], [64, 701]), timing, true).fluent, false);
});

test('extra notes are inaccurate and the matched phrase determines the onset span', () => {
  const result = measureFluency([60, 62], notes([65, 0], [60, 100], [62, 350]), timing, true);
  assert.deepEqual(result, { accuracy: 'extra-or-incorrect', executionTime: .25, referenceTime: .25, speedRatio: 1, fluent: false });
});

test('single notes, simultaneous onsets, missing demonstrations and unfinished attempts are safe', () => {
  assert.deepEqual(measureFluency([60], notes([60, 100]), timing, true), { accuracy: 'clean', executionTime: 0, referenceTime: 0, speedRatio: null, fluent: true });
  assert.deepEqual(measureFluency([60, 62], notes([60, 100], [62, 100]), timing, true), { accuracy: 'clean', executionTime: 0, referenceTime: .25, speedRatio: null, fluent: true });
  assert.deepEqual(measureFluency([60, 62], notes([60, 100], [62, 350]), null, true), { accuracy: 'clean', executionTime: .25, referenceTime: null, speedRatio: null, fluent: null });
  assert.deepEqual(measureFluency([60, 62], notes([60, 100]), timing, false), { accuracy: null, executionTime: null, referenceTime: .25, speedRatio: null, fluent: null });
});
