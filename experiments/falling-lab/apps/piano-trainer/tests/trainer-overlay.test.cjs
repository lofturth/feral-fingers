'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('../card-lab/node_modules/typescript');
const modules = path.join(__dirname, '../card-lab/node_modules');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'react' || request === 'react/jsx-runtime') return originalLoad.call(this, path.join(modules, request), parent, isMain);
  return originalLoad.call(this, request, parent, isMain);
};
require.extensions['.css'] = () => {};
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);
const React = require('../card-lab/node_modules/react');
const { renderToStaticMarkup } = require('../card-lab/node_modules/react-dom/server');
const { TrainerPianoCard } = require('../cards/TrainerPianoCard.tsx');

test('practice overlay shows the exercise, notes and gravity without instructional controls', () => {
  const html = renderToStaticMarkup(React.createElement(TrainerPianoCard, { exercise: { id: 'a', label: 'Arpeggio', notes: [60, 64] }, gravity: .81, history: [{ value: 1, direction: 'neutral' }, { value: .9, direction: 'decrease' }, { value: .81, direction: 'decrease' }], practice: { heldNotes: [] } }));
  assert.match(html, /Arpeggio/); assert.match(html, /C4/); assert.match(html, /E4/); assert.match(html, /0\.81×/);
  for (const text of ['Waiting for input', 'Press Esc', 'Connect MIDI', 'Replay Phrase', 'Connected:']) assert.equal(html.includes(text), false);
});

test('held notes keep their pastel fill and use the active overlay highlight', () => {
  const html = renderToStaticMarkup(React.createElement(TrainerPianoCard, { exercise: { id: 'a', label: 'A', notes: [60] }, gravity: 1, history: [], practice: { heldNotes: ['C4'] } }));
  assert.match(html, /class="piano-card__note is-played" style="background-color:#ffb4ab"/);
  const css = fs.readFileSync(path.join(__dirname, '../style.css'), 'utf8');
  assert.match(css, /\.practice-layout \.trainer-card \.piano-card__note\.is-played\s*\{[^}]*border-color:\s*#247c83;[^}]*outline:\s*none;[^}]*box-shadow:\s*none;[^}]*transform:\s*none;/);
});


test('note-sequence titles are omitted while descriptive names remain', () => {
  const props = { exercise: { id: 'a', label: 'C E G', notes: [60, 64, 67] }, gravity: 1, history: [], practice: { heldNotes: [] } };
  const redundant = renderToStaticMarkup(React.createElement(TrainerPianoCard, props));
  assert.doesNotMatch(redundant, />C E G</);
  assert.match(redundant, />C4</);
  const descriptive = renderToStaticMarkup(React.createElement(TrainerPianoCard, { ...props, exercise: { ...props.exercise, label: 'C major' } }));
  assert.match(descriptive, />C major</);
});
