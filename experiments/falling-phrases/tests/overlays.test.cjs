'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const VocabularyView = require('../vocabulary-view.js');
const MusicalView = require('../musical-view.js');

class MockElement {
  constructor() {
    this.attrs = {};
    this.children = [];
    this.hidden = false;
    this.classes = new Set();
    this.classList = {
      contains: k => this.classes.has(k),
      add: k => this.classes.add(k),
      remove: (...ks) => { for (const k of ks) this.classes.delete(k); },
      toggle: (k, v) => { if (v) this.classes.add(k); else this.classes.delete(k); }
    };
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  appendChild(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = [...children]; }
  set textContent(v) { this._textContent = String(v); }
  get textContent() { return this._textContent ?? ''; }
  set innerHTML(v) { this._innerHTML = String(v); }
  get innerHTML() { return this._innerHTML ?? ''; }
}

function createMockDocument() {
  const elements = new Map();
  const getOrCreate = id => {
    if (!elements.has(id)) elements.set(id, new MockElement());
    return elements.get(id);
  };
  return {
    elements,
    doc: {
      getElementById: id => getOrCreate(id),
      createElement: type => new MockElement(),
      createElementNS: (ns, type) => new MockElement()
    }
  };
}

test('VocabularyView: prompt and streak formatting and hint timing', () => {
  const { doc, elements } = createMockDocument();
  globalThis.document = doc;

  const vocab = VocabularyView.createVocabularyView({ hintSeconds: 2 });

  // 1. Prompt rendering before hint time (< 2s)
  vocab.renderPrompt({
    target: { english: 'river', spanish: 'río', streak: 3 },
    selectedIndex: 0,
    promptState: { time: 1.5, selectedAt: 0, complete: false, selectedIndex: 0 }
  }, 0.1);

  assert.equal(elements.get('target-word').textContent, 'river');
  assert.equal(elements.get('target-streak').textContent, 'STREAK 03');
  assert.equal(elements.get('card-slot-tag').textContent, 'ACTIVE SLOT 01');
  assert.equal(elements.get('target-hint').hidden, true);

  // 2. Prompt rendering after hint time (>= 2s)
  vocab.renderPrompt({
    target: { english: 'river', spanish: 'río', streak: 3 },
    selectedIndex: 0,
    promptState: { time: 2.1, selectedAt: 0, complete: false, selectedIndex: 0 }
  }, 0.1);

  assert.equal(elements.get('target-hint').hidden, false);
  assert.equal(elements.get('target-hint').textContent, 'HINT → río');

  // 3. Complete session
  vocab.renderPrompt({
    target: null,
    selectedIndex: -1,
    promptState: { time: 10, selectedAt: 0, complete: true, selectedIndex: -1 }
  }, 0);

  assert.equal(elements.get('card-slot-tag').textContent, 'COMPLETE');

  delete globalThis.document;
});

test('VocabularyView: kick graph visibility and ending', () => {
  const { doc, elements } = createMockDocument();
  globalThis.document = doc;

  const vocab = VocabularyView.createVocabularyView();

  vocab.renderKickGraph({
    time: 1.0,
    selectedAt: 0,
    complete: false,
    selectedIndex: 0
  }, 0.1);

  assert.equal(elements.get('kick-graph').hidden, false);
  assert.equal(elements.get('kick-graph').attrs['aria-hidden'], 'false');

  vocab.endKickGraph();
  assert.equal(elements.get('kick-graph').hidden, true);
  assert.equal(elements.get('kick-graph').attrs['aria-hidden'], 'true');
  assert.equal(vocab.isKickGraphEnded(), true);

  vocab.reset();
  assert.equal(elements.get('kick-graph').hidden, false);
  assert.equal(vocab.isKickGraphEnded(), false);

  delete globalThis.document;
});

test('MusicalView: formatFeedback correctly formats first try and after mistakes', () => {
  const firstTryFeedback = MusicalView.formatFeedback({
    isFirstTry: true,
    extraNotes: 0,
    targetIndex: 0,
    rewardResult: { lift: 25.0 }
  });

  assert.equal(firstTryFeedback.badgeText, 'First Try! Full Lift (+25.0%)');
  assert.equal(firstTryFeedback.feedbackText, 'Flawless! Slot 01 lifted (+25.0%).');

  const mistakesFeedback = MusicalView.formatFeedback({
    isFirstTry: false,
    extraNotes: 2,
    targetIndex: 4,
    rewardResult: { lift: 13.2 }
  });

  assert.equal(mistakesFeedback.badgeText, 'Completed! Half Lift (+13.2%)');
  assert.equal(mistakesFeedback.feedbackText, 'Completed with 2 extra notes. Slot 05 lifted (+13.2%).');
});

test('MusicalView: updateCardVisuals toggles matched class on notes and letters', () => {
  const { doc, elements } = createMockDocument();
  globalThis.document = doc;

  const music = MusicalView.createMusicalView({ targetPitches: [60, 62, 64] });

  // 1 matched note (C4)
  music.updateCardVisuals(1);
  assert.equal(elements.get('note-head-0').classes.has('matched'), true);
  assert.equal(elements.get('letter-0').classes.has('matched'), true);
  assert.equal(elements.get('note-head-1').classes.has('matched'), false);
  assert.equal(elements.get('letter-1').classes.has('matched'), false);

  // 3 matched notes (all)
  music.updateCardVisuals(3);
  assert.equal(elements.get('note-head-0').classes.has('matched'), true);
  assert.equal(elements.get('note-head-1').classes.has('matched'), true);
  assert.equal(elements.get('note-head-2').classes.has('matched'), true);

  // Reset
  music.resetCardVisuals();
  assert.equal(elements.get('note-head-0').classes.has('matched'), false);
  assert.equal(elements.get('note-head-1').classes.has('matched'), false);
  assert.equal(elements.get('note-head-2').classes.has('matched'), false);
  assert.equal(elements.get('card-badge').textContent, 'Ready');

  delete globalThis.document;
});

test('MusicalView: showRewardFeedback applies celebrate animation class and badge styles', () => {
  const { doc, elements } = createMockDocument();
  globalThis.document = doc;

  const music = MusicalView.createMusicalView();

  music.showRewardFeedback({
    isFirstTry: true,
    extraNotes: 0,
    targetIndex: 0,
    rewardResult: { lift: 25.0 }
  });

  const overlay = elements.get('musical-card-overlay');
  assert.equal(overlay.classes.has('celebrate-full'), true);
  assert.equal(overlay.classes.has('celebrate-half'), false);
  assert.equal(elements.get('card-badge').className, 'card-badge first-try');

  music.showRewardFeedback({
    isFirstTry: false,
    extraNotes: 1,
    targetIndex: 0,
    rewardResult: { lift: 13.2 }
  });

  assert.equal(overlay.classes.has('celebrate-half'), true);
  assert.equal(overlay.classes.has('celebrate-full'), false);
  assert.equal(elements.get('card-badge').className, 'card-badge completed');

  delete globalThis.document;
});

test('Simulated musical input: keys 1, 2, and 3 trigger end-to-end musical reward via overlay', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { makeHost } = require('./dom-harness.cjs');
  const base = path.join(__dirname, '..');
  const files = {
    html: fs.readFileSync(path.join(base, 'index.html'), 'utf8'),
    app: fs.readFileSync(path.join(base, 'app.js'), 'utf8'),
    physics: fs.readFileSync(path.join(base, 'physics.js'), 'utf8'),
    field: fs.readFileSync(path.join(base, 'field.js'), 'utf8'),
    vocabularyView: fs.readFileSync(path.join(base, 'vocabulary-view.js'), 'utf8'),
    musicalView: fs.readFileSync(path.join(base, 'musical-view.js'), 'utf8')
  };

  const h = makeHost(files);

  // Initial state: slot 0 at depth 0
  assert.equal(h.run('words[0].depth'), 0);

  // Play keys 1 (C4), 2 (D4), 3 (E4)
  h.key('1');
  assert.equal(h.elements.get('note-head-0').classes.has('matched'), true);
  assert.equal(h.elements.get('letter-0').classes.has('matched'), true);

  h.key('2');
  assert.equal(h.elements.get('note-head-1').classes.has('matched'), true);
  assert.equal(h.elements.get('letter-1').classes.has('matched'), true);

  h.key('3');
  // All 3 matched -> reward triggered!
  assert.equal(h.elements.get('musical-card-overlay').classes.has('celebrate-full'), true);
  assert.equal(h.elements.get('card-badge').textContent, 'First Try! Full Lift (+25.0%)');
  assert.equal(h.elements.get('card-feedback').textContent, 'Flawless! Slot 01 lifted (+25.0%).');
  assert.ok(Math.abs(h.run('words[0].depth') - 25) < 1e-6);
});

