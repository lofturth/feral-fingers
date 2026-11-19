'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), Module = require('node:module');
const ts = require('../card-lab/node_modules/typescript');
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);
const { createPlaybackDelay } = require('../audio/playbackDelay.ts');
function fakeClock() {
  let now = 0, id = 0; const queue = new Map();
  return { now: () => now, set: (fn, ms) => { queue.set(++id, { fn, at: now + ms }); return id; }, clear: id => queue.delete(id), tick(ms) { now += ms; for (const [key, job] of [...queue]) if (job.at <= now) { queue.delete(key); job.fn(); } }, get size() { return queue.size; } };
}
test('delay cancels stale events, preserves remaining time on pause, and manual cancel prevents replay', () => {
  const clock = fakeClock(), played = []; const delay = createPlaybackDelay(() => played.push(clock.now()), clock);
  delay.schedule(1500); clock.tick(500); delay.pause(); clock.tick(5000); assert.deepEqual(played, []);
  delay.resume(); clock.tick(999); assert.deepEqual(played, []); clock.tick(1); assert.equal(played.length, 1);
  delay.schedule(1500); clock.tick(300); delay.schedule(250); clock.tick(250); assert.equal(played.length, 2);
  delay.schedule(5000); delay.cancel(); clock.tick(6000); assert.equal(played.length, 2);
  delay.schedule(0); assert.equal(played.length, 3); delay.reset(); assert.equal(clock.size, 0);
});
test('keyboard renders 37 labeled keys with concurrent highlights and releases', () => {
  const original = Module._load;
  Module._load = function(request, parent, main) { if (request === 'react') return {}; if (request === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }; return original.call(this, request, parent, main); };
  try {
    const { VisualKeyboard } = require('../view/VisualKeyboard.tsx');
    const keys = VisualKeyboard({ heldNotes: ['C3', 'F♯4', 'C6'] }).props.children;
    assert.equal(keys.length, 37); assert.equal(keys[0].props.children.props.children, 'C3'); assert.equal(keys[36].props.children.props.children, 'C6');
    assert.deepEqual(keys.filter(k => k.props.className.includes('held')).map(k => k.props.children.props.children), ['C3', 'F♯4', 'C6']);
    assert.equal(VisualKeyboard({ heldNotes: [] }).props.children.filter(k => k.props.className.includes('held')).length, 0);
    assert.equal(keys.filter(k => k.props.className.includes('black')).length, 15);
  } finally { Module._load = original; }
});
