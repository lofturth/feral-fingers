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

test('card tiles and compact field notes share colors; pressed note retains its color and highlight', () => {
  const names = ['C4', 'C♯4', 'D4', 'D♯4', 'E4', 'F4', 'F♯4', 'G4', 'G♯4', 'A4', 'A♯4', 'B4'];
  const card = renderToStaticMarkup(React.createElement(PianoCard, { title: 'All notes', notes: names, heldNotes: ['C4'] }));
  assert.match(card, /class="piano-card__note is-played" style="background-color:#ffb4ab">C4/);
  for (const color of PITCH_CLASS_COLORS) assert.ok(card.includes(`background-color:${color}`));
  const css = fs.readFileSync(path.join(__dirname, '../cards/piano-card.css'), 'utf8');
  assert.match(css, /\.piano-card__note\.is-played\s*\{[^}]*outline:/);
  const exercise = { id: 'all', label: 'All notes', notes: names.map((_, i) => 60 + i) };
  const session = createSession({ cards: [exercise.id] });
  const field = renderToStaticMarkup(React.createElement(FallingView, { state: session.getState(), progress: 0, history: [{ time: 0, progress: 0 }], exercises: [exercise] }));
  for (const color of PITCH_CLASS_COLORS) assert.ok(field.includes(`fill="${color}"`), `field includes ${color}`);
});
