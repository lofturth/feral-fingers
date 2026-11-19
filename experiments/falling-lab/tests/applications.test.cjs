'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeHost } = require('./dom-harness.cjs');
const base = path.join(__dirname, '..');
const files = {
  html: fs.readFileSync(path.join(base, 'apps/vocabulary/index.html'), 'utf8'),
  app: fs.readFileSync(path.join(base, 'apps/vocabulary/coordinator.js'), 'utf8'),
  physics: fs.readFileSync(path.join(base, 'core/physics.js'), 'utf8')
};
test('Vocabulary input rewards letters and skips on Escape', () => {
  const h = makeHost(files);
  h.key('1');
  assert.equal(h.run('count'), 0);
  h.key('a', 'KeyA');
  assert.ok(h.run('words[0].depth') > 0);
  assert.equal(h.run('count'), 1);
  h.key('Escape');
  assert.equal(h.run('count'), 1);
  assert.equal(h.run('session.getState().skipCount'), 1);
});
