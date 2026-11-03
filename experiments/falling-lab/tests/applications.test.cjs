'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeHost } = require('./dom-harness.cjs');

const base = path.join(__dirname, '..');
const files = {
  html: fs.readFileSync(path.join(base, 'apps', 'music', 'index.html'), 'utf8'),
  app: fs.readFileSync(path.join(base, 'shared', 'app.js'), 'utf8'),
  physics: fs.readFileSync(path.join(base, 'core', 'physics.js'), 'utf8'),
  field: fs.readFileSync(path.join(base, 'views', 'falling', 'view.js'), 'utf8'),
  vocabularyView: fs.readFileSync(path.join(base, 'apps', 'vocabulary', 'vocabulary-view.js'), 'utf8'),
  musicalView: fs.readFileSync(path.join(base, 'apps', 'music', 'musical-view.js'), 'utf8'),
  vocabApp: fs.readFileSync(path.join(base, 'apps', 'vocabulary', 'app-vocabulary.js'), 'utf8'),
  musicalApp: fs.readFileSync(path.join(base, 'apps', 'music', 'app-music.js'), 'utf8')
};

test('Input isolation: musical mode ignores arbitrary letters and responds only to musical keys 1, 2, 3', () => {
  const h = makeHost({ ...files, appMode: 'music' });

  // Baseline: slot 0 depth is 0, count is 0
  assert.equal(h.run('words[0].depth'), 0);
  assert.equal(h.run('count'), 0);

  // 1. Press arbitrary letters (a, b, x, z) - MUST NOT reward or lift cards!
  h.key('a', 'KeyA');
  assert.equal(h.run('words[0].depth'), 0, 'Letter A must not lift card in musical mode');
  assert.equal(h.run('count'), 0);

  h.key('b', 'KeyB');
  assert.equal(h.run('words[0].depth'), 0, 'Letter B must not lift card in musical mode');
  assert.equal(h.run('count'), 0);

  h.key('z', 'KeyZ');
  assert.equal(h.run('words[0].depth'), 0, 'Letter Z must not lift card in musical mode');
  assert.equal(h.run('count'), 0);

  // 2. Play musical keys 1, 2, 3 -> triggers musical phrase matching and full lift
  h.key('1');
  assert.equal(h.elements.get('note-head-0').classes.has('matched'), true);
  h.key('2');
  assert.equal(h.elements.get('note-head-1').classes.has('matched'), true);
  h.key('3');
  assert.equal(h.elements.get('note-head-2').classes.has('matched'), true);

  // Verified: depth is rewarded (+25%), count is incremented to 1
  assert.ok(Math.abs(h.run('words[0].depth') - 25) < 1e-6);
  assert.equal(h.run('count'), 1);
  assert.equal(h.elements.get('card-badge').textContent, 'First Try! Full Lift (+25.0%)');
});

test('Input isolation: vocabulary mode responds to letters and ignores musical keys 1, 2, 3', () => {
  const h = makeHost({ ...files, appMode: 'vocabulary' });

  // Baseline: slot 0 depth is 0, count is 0
  assert.equal(h.run('words[0].depth'), 0);
  assert.equal(h.run('count'), 0);

  // 1. Press musical keys 1, 2, 3 - MUST NOT trigger musical notes or rewards
  h.key('1');
  assert.equal(h.run('words[0].depth'), 0, 'Key 1 must not lift card in vocabulary mode');
  assert.equal(h.run('count'), 0);

  h.key('2');
  assert.equal(h.run('words[0].depth'), 0, 'Key 2 must not lift card in vocabulary mode');
  assert.equal(h.run('count'), 0);

  h.key('3');
  assert.equal(h.run('words[0].depth'), 0, 'Key 3 must not lift card in vocabulary mode');
  assert.equal(h.run('count'), 0);

  // 2. Press letter 'a' -> triggers vocabulary retrieval with latency reward
  h.key('a', 'KeyA');
  assert.ok(h.run('words[0].depth') > 0, 'Letter A must lift card in vocabulary mode');
  assert.equal(h.run('count'), 1);

  // 3. Press Escape -> triggers skip
  const beforeSkipIndex = h.run('session.getState().selectedIndex');
  h.key('Escape');
  // Skip recorded
  assert.equal(h.run('count'), 1);
});

test('DOM presentation isolation: musical mode vs vocabulary mode display states', () => {
  // Musical mode: musical overlay and dev panel are visible; kick graph is hidden
  const musicHost = makeHost({ ...files, appMode: 'music' });
  assert.equal(musicHost.elements.get('musical-card-overlay').style.display, '');
  assert.equal(musicHost.elements.get('dev-panel').style.display, '');
  assert.equal(musicHost.elements.get('kick-graph').style.display, 'none');

  // Vocabulary mode: musical overlay and dev panel are hidden; prompt is Spanish
  const vocabHost = makeHost({ ...files, appMode: 'vocabulary' });
  assert.equal(vocabHost.elements.get('musical-card-overlay').style.display, 'none');
  assert.equal(vocabHost.elements.get('dev-panel').style.display, 'none');
  assert.equal(vocabHost.elements.get('prompt').textContent, 'TYPE SPANISH = RETRIEVE / ESC = SKIP');
});
