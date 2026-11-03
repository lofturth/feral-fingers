'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const FallingField = require('../field.js');

class MockElement {
  constructor() {
    this.attrs = {};
    this.children = [];
    this.listeners = {};
    this.classes = new Set();
    this.classList = {
      contains: k => this.classes.has(k),
      toggle: (k, v) => { if (v) this.classes.add(k); else this.classes.delete(k); }
    };
  }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k]; }
  appendChild(child) { this.children.push(child); }
  replaceChildren() { this.children = []; }
  set textContent(v) { this._textContent = String(v); }
  get textContent() { return this._textContent ?? ''; }
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
      createElementNS: (ns, type) => new MockElement()
    }
  };
}

test('FallingField exports public layout constants and pure coordinate converters', () => {
  assert.equal(typeof FallingField.createField, 'function');
  assert.equal(typeof FallingField.screenY, 'function');
  assert.equal(typeof FallingField.traceY, 'function');
  assert.equal(FallingField.TUNE.top, 24);
  assert.equal(FallingField.TUNE.bottom, 502);
  assert.equal(FallingField.TUNE.reachableTop, 60);

  // Pure math coordinate checks
  assert.equal(FallingField.screenY(0), 502);
  assert.equal(FallingField.screenY(100), 60);
  assert.equal(FallingField.screenY(50), 281);
  assert.equal(FallingField.traceY(0), 498);
  assert.equal(FallingField.traceY(100), 28);
});

test('FallingField.createField builds SVG field nodes and threshold labels', () => {
  const { doc, elements } = createMockDocument();
  globalThis.document = doc;

  const field = FallingField.createField();
  const cards = [
    { id: 'c1', label: 'Phrase 1' },
    { id: 'c2', label: 'Phrase 2' },
    { id: 'c3', label: 'Phrase 3' }
  ];

  const nodes = field.build(cards, {
    unlockThreshold: 50,
    finishThreshold: 90,
    unlockLabel: 'NEW CARDS',
    finishLabel: 'GOAL'
  });

  assert.equal(nodes.length, 3);
  assert.equal(elements.get('bars').children.length, 6); // bar + edge per card

  const labels = elements.get('labels').children;
  const unlockLine = labels.find(n => n.attrs.id === 'unlock-line');
  const completionLine = labels.find(n => n.attrs.id === 'completion-line');
  const unlockLabel = labels.find(n => n.attrs.id === 'unlock-label');
  const completionLabel = labels.find(n => n.attrs.id === 'completion-label');

  assert.ok(unlockLine);
  assert.ok(completionLine);
  assert.equal(unlockLine.attrs.y1, 281);
  assert.ok(Math.abs(completionLine.attrs.y1 - 104.2) < 1e-6);
  assert.equal(unlockLabel.textContent, 'NEW CARDS');
  assert.equal(completionLabel.textContent, 'GOAL');

  delete globalThis.document;
});

test('FallingField.render updates card positions, classes, and progress history trace', () => {
  const { doc, elements } = createMockDocument();
  globalThis.document = doc;

  const field = FallingField.createField();
  const nodes = field.build(2);

  const state = {
    cards: [
      { id: 'c1', depth: 40, shown: 40, unlocked: true, isSelected: true, isComplete: false },
      { id: 'c2', depth: 0, shown: 0, unlocked: false, isSelected: false, isComplete: false }
    ],
    selectedIndex: 0,
    progress: 20,
    activeTime: 10,
    observations: [0, 20],
    observationTimes: [0, 10]
  };

  field.render(state, 0.1);

  // Card 0 is unlocked and selected
  assert.equal(nodes[0].bar.attrs.visibility, 'visible');
  assert.equal(nodes[0].bar.attrs.fill, 'url(#bar-fill-selected)');
  assert.equal(nodes[0].edge.attrs.stroke, FallingField.COLOR.cyan);
  assert.equal(nodes[0].streak.textContent, '40%');
  assert.equal(nodes[0].slotCol.attrs.opacity, '0.9');

  // Card 1 is locked
  assert.equal(nodes[1].bar.attrs.visibility, 'hidden');

  // Score and trace updates
  assert.equal(elements.get('score').textContent, '20.0');
  assert.ok(elements.get('trace').attrs.d.startsWith('M0,498.00 L10,'));
  assert.equal(elements.get('trace-percentage').textContent, '20.0%');

  delete globalThis.document;
});

test('FallingField caches rendered attributes for zero-write performance optimization', () => {
  const { doc } = createMockDocument();
  globalThis.document = doc;

  const field = FallingField.createField();
  const nodes = field.build(1);

  const state = {
    cards: [
      { id: 'c1', depth: 50, shown: 50, unlocked: true, isSelected: true, isComplete: false }
    ],
    selectedIndex: 0,
    progress: 50,
    activeTime: 5,
    observations: [0],
    observationTimes: [0]
  };

  field.render(state, 0);

  // Monkey patch setAttribute on the mock bar element to detect duplicate writes
  let duplicateWrites = 0;
  const originalSetAttribute = nodes[0].bar.setAttribute;
  nodes[0].bar.setAttribute = function (k, v) {
    duplicateWrites++;
    return originalSetAttribute.call(this, k, v);
  };

  // Re-render identical state with dt = 0
  field.render(state, 0);

  assert.equal(duplicateWrites, 0, 'No attribute writes should occur when rendering unchanged state');

  delete globalThis.document;
});
