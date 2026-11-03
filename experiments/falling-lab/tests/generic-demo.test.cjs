'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const GenericDemo = require('../apps/generic/app-generic.js');
const { Physics } = require('./physics-harness.cjs').testPhysics();

class MockElement {
  constructor() {
    this.attrs = {};
    this.children = [];
    this.style = {};
    this.listeners = {};
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
  addEventListener(k, v) { (this.listeners[k] ??= []).push(v); }
  dispatch(k, e = {}) { for (const fn of this.listeners[k] ?? []) fn(e); }
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
      createElement: () => new MockElement(),
      createElementNS: () => new MockElement()
    }
  };
}

test('Generic Demo: Initializes 5 cards (A, B, C, D, E) without vocabulary or musical dependencies', () => {
  const { doc, elements } = createMockDocument();
  globalThis.document = doc;

  const demo = GenericDemo.createDemo({
    el: id => doc.getElementById(id)
  });
  demo.reset();

  const state = demo.getState();
  assert.equal(state.cards.length, 5);
  assert.deepEqual(GenericDemo.CARD_LABELS, ['Card A', 'Card B', 'Card C', 'Card D', 'Card E']);

  // Initially only card 0 (Card A) is unlocked
  assert.equal(state.cards[0].unlocked, true);
  assert.equal(state.cards[1].unlocked, false);
  assert.equal(state.selectedIndex, 0);
  assert.equal(elements.get('selected-card').textContent, 'Card A');
  assert.equal(elements.get('reward-count').textContent, '0');

  delete globalThis.document;
});

test('Generic Demo: Falling motion, Reward lifts selected card, and Skip rotates selection', () => {
  const { doc, elements } = createMockDocument();
  globalThis.document = doc;

  const demo = GenericDemo.createDemo({
    el: id => doc.getElementById(id)
  });
  demo.reset();

  // 1. Advance time -> Card A falls down
  demo.advanceTo(1000); // 1 second
  assert.equal(demo.getState().cards[0].depth, 0); // At bottom floor

  // 2. Reward Card A with magnitude 1.0 -> Card A lifts
  const result = demo.reward(1.0);
  assert.ok(result);
  assert.ok(result.lift > 0);
  assert.ok(Math.abs(demo.getState().cards[0].depth - 25) < 1e-6, 'Depth reaches 25%');
  assert.equal(demo.getState().rewardCount, 1);
  assert.equal(elements.get('reward-count').textContent, '1');

  // 3. Skip advances selection according to lowest-depth queue
  const prevSelected = demo.getState().selectedIndex;
  demo.skip();
  // With only 1 unlocked card, skip keeps Card A selected and resets prompt clock
  assert.equal(demo.getState().selectedIndex, 0);

  delete globalThis.document;
});

test('Generic Demo: Progression, unlocking next card at 50% threshold, and completion at 90%', () => {
  const { doc, elements } = createMockDocument();
  globalThis.document = doc;

  const demo = GenericDemo.createDemo({
    el: id => doc.getElementById(id)
  });
  demo.reset();

  // Reward Card A rapidly so it lifts above 50% without falling back
  let t = 100;
  demo.advanceTo(t);
  demo.reward(1.0); // 25%
  t += 20;
  demo.advanceTo(t);
  demo.reward(1.0); // ~42%
  t += 20;
  demo.advanceTo(t);
  demo.reward(1.0); // ~57%

  // Settle visual position across 400ms (15/s settling filter)
  for (let i = 0; i < 20; i++) {
    t += 20;
    demo.advanceTo(t);
  }

  // Card B should unlock once Card A shown position crosses 50%
  const state = demo.getState();
  assert.equal(state.cards[1].unlocked, true, 'Card B must unlock when Card A > 50%');
  assert.equal(state.selectedIndex, 1, 'Selection hands off to newly unlocked Card B at floor');
  assert.equal(elements.get('selected-card').textContent, 'Card B');

  // Lift cards towards completion (>90%)
  for (let i = 0; i < 15; i++) {
    demo.reward(1.0);
    demo.advanceTo(6000 + (i + 1) * 200);
  }

  delete globalThis.document;
});

test('Generic Demo: Reset restores pristine initial state', () => {
  const { doc, elements } = createMockDocument();
  globalThis.document = doc;

  const demo = GenericDemo.createDemo({
    el: id => doc.getElementById(id)
  });
  demo.reset();

  demo.reward(1.0);
  demo.advanceTo(2000);
  assert.ok(demo.getProgress() > 0);
  assert.equal(demo.getState().rewardCount, 1);

  // Reset
  demo.reset();
  assert.equal(demo.getProgress(), 0);
  assert.equal(demo.getState().rewardCount, 0);
  assert.equal(demo.getState().cards[0].depth, 0);
  assert.equal(demo.getState().cards[0].unlocked, true);
  assert.equal(demo.getState().cards[1].unlocked, false);
  assert.equal(elements.get('selected-card').textContent, 'Card A');
  assert.equal(elements.get('reward-count').textContent, '0');

  delete globalThis.document;
});

test('Generic Demo: Verification that Core and Field require no domain modules', () => {
  // Verify app-generic.js source contains no references to vocabulary or musical files
  const genericSource = fs.readFileSync(path.join(__dirname, '../apps/generic/app-generic.js'), 'utf8');
  assert.equal(genericSource.includes('app-vocabulary'), false);
  assert.equal(genericSource.includes('app-music'), false);
  assert.equal(genericSource.includes('vocabulary-view'), false);
  assert.equal(genericSource.includes('musical-view'), false);
  assert.equal(genericSource.includes('VOCABULARY'), false);
  assert.equal(genericSource.includes('targetPitches'), false);
  assert.equal(genericSource.includes('midi'), false);
  assert.equal(genericSource.includes('synth'), false);
});
