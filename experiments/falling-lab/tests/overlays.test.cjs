'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const VocabularyView = require('../apps/vocabulary/view/vocabulary-overlay.js');

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

