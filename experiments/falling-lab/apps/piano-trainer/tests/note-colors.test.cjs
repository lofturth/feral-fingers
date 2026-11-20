'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
process.env.NODE_PATH = [path.resolve(__dirname, '../card-lab/node_modules'), process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
Module._initPaths();
const ts = require('typescript');
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);
};
require.extensions['.css'] = () => {};
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { PITCH_CLASS_COLORS, colorForPitch, colorForNoteName } = require('../cards/noteColors.ts');
const { PianoCard } = require('../cards/PianoCard.tsx');
const { FallingView } = require('../view/FallingView.tsx');
const { createSession } = require('../../../core/physics.js');

function contrast(a, b) {
  const lum = hex => {
    const channels = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
    return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
  };
  const values = [lum(a), lum(b)].sort((x, y) => y - x);
  return (values[0] + .05) / (values[1] + .05);
}

test('all pitch classes have distinct octave-consistent colors and enharmonic names', () => {
  const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  assert.equal(new Set(PITCH_CLASS_COLORS).size, 12);
  names.forEach((name, index) => {
    assert.equal(colorForPitch(60 + index), PITCH_CLASS_COLORS[index]);
    assert.equal(colorForPitch(72 + index), PITCH_CLASS_COLORS[index]);
    assert.equal(colorForNoteName(`${name}4`), PITCH_CLASS_COLORS[index]);
  });
  for (const [flat, sharp] of [['D♭4', 'C♯4'], ['Eb3', 'D#4'], ['G♭4', 'F♯5'], ['Ab4', 'G#2'], ['Bb4', 'A♯4'], ['C♭4', 'B3'], ['B#3', 'C4']]) assert.equal(colorForNoteName(flat), colorForNoteName(sharp));
});

test('palette maintains readable dark tile labels and light field notes', () => {
  for (const color of PITCH_CLASS_COLORS) {
    assert.ok(contrast(color, '#101828') >= 4.5, `${color} against tile label`);
    assert.ok(contrast(color, '#141e30') >= 4.5, `${color} against dark field`);
  }
  assert.ok(contrast('#263247', '#ffffff') >= 4.5, 'tile border remains visible on a light background');
});

test('card tiles retain their colors and pressed-note highlight', () => {
  const names = ['C4', 'C♯4', 'D4', 'D♯4', 'E4', 'F4', 'F♯4', 'G4', 'G♯4', 'A4', 'A♯4', 'B4'];
  const card = renderToStaticMarkup(React.createElement(PianoCard, { title: 'All notes', notes: names, heldNotes: ['C4'] }));
  assert.match(card, /class="piano-card__note is-played" style="background-color:#ffb4ab">C4/);
  for (const color of PITCH_CLASS_COLORS) assert.ok(card.includes(`background-color:${color}`));
  const css = fs.readFileSync(path.join(__dirname, '../cards/piano-card.css'), 'utf8');
  assert.match(css, /\.piano-card__note\.is-played\s*\{[^}]*outline:/);
 });

test('falling columns keep stable slots and extend down from the top as progress changes', () => {
  const exercises = [{ id: 'a', label: 'First', notes: [60] }, { id: 'b', label: 'Second', notes: [64] }];
  const state = createSession({ cards: ['a', 'b'] }).getState();
  state.cards[1].unlocked = true;
  function render() { return renderToStaticMarkup(React.createElement(FallingView, { state, progress: 0, history: [{ time: 0, progress: 0 }], exercises })); }
  function geometry(markup) {
    return [...markup.matchAll(/<g visibility="visible" aria-label="(?:First|Second)[^"]*"><rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map(match => match.slice(1).map(Number));
  }
  const initialMarkup = render(), initial = geometry(initialMarkup);
  assert.equal(initial.length, 2);
  assert.equal((initialMarkup.match(/<line /g) || []).length, 2);
  assert.doesNotMatch(initialMarkup, /stroke-dasharray|rotate\(/);
  assert.match(initialMarkup, /fill="#ffb4ab"/);
  assert.match(initialMarkup, />C4<\/text>/);
  assert.match(initialMarkup, />E4<\/text>/);
  assert.match(initialMarkup, /<polygon/);
  state.cards[0].shown = 50;
  const lifted = geometry(render());
  assert.deepEqual(lifted.map(column => column.slice(0, 3)), initial.map(column => column.slice(0, 3)));
  assert.ok(lifted[0][3] < initial[0][3]);
  state.cards[0].shown = 25;
  assert.ok(geometry(render())[0][3] > lifted[0][3]);
});


test('falling note tiles keep note order and stay within field bounds for long phrases', () => {
  const exercise = { id: 'a', label: 'Scale', notes: Array.from({ length: 30 }, (_, i) => 48 + i) };
  const state = createSession({ cards: ['a'] }).getState();
  state.cards[0].shown = 100;
  const field = renderToStaticMarkup(React.createElement(FallingView, { state, progress: 0, history: [{ time: 0, progress: 0 }], exercises: [exercise] }));
  const tiles = [...field.matchAll(/<rect x="[\d.]+" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="4" fill="(#[a-f0-9]+)" stroke="#d2c9bc"/g)];
  assert.equal(tiles.length, 30);
  assert.deepEqual(tiles.map(tile => tile[4]), exercise.notes.map(colorForPitch));
  for (let i = 1; i < tiles.length; i++) assert.ok(Number(tiles[i][1]) >= Number(tiles[i - 1][1]) + Number(tiles[i - 1][3]));
  assert.ok(Number(tiles.at(-1)[1]) + Number(tiles.at(-1)[3]) <= 502);
  assert.doesNotMatch(field, /rotate\(/);
});
