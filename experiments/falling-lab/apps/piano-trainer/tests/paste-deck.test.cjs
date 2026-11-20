'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('../card-lab/node_modules/typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);

function createHost() {
  const slots = [];
  let cursor = 0, root, stops = 0;
  const hooks = {
    useState(initial) { const n = cursor++; if (!(n in slots)) slots[n] = typeof initial === 'function' ? initial() : initial; return [slots[n], value => { slots[n] = typeof value === 'function' ? value(slots[n]) : value; }]; },
    useRef(value) { const n = cursor++; return slots[n] ||= { current: value }; },
    useCallback(fn) { return fn; },
    useEffect() {}
  };
  const jsx = (type, props, key) => ({ type, props: props || {}, key });
  const filename = path.resolve(__dirname, '../app.tsx');
  const component = new Module(filename, module);
  component.filename = filename;
  component.paths = Module._nodeModulePaths(path.dirname(filename));
  const playback = { delay: .5, setDelay() {}, enabled: true, setEnabled() {}, metronome: false, setMetronome() {}, tempo: 90, setTempo() {}, stop() { stops++; }, replay() {}, setExercise() {}, audioError: '' };
  const originalRequire = component.require.bind(component);
  component.require = request => {
    if (request === 'react') return hooks;
    if (request === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
    if (request === 'react-dom/client') return { createRoot: () => ({ render: element => { root = element; } }) };
    if (request === './MyDecks.tsx') return { MyDecks: () => null };
    if (request === './audio/useAudioOutput') return { useAudioOutput: () => ({ selected: '', devices: [], message: '', supported: true, select() {}, setContext() {} }) };
    if (request === './audio/usePhrasePlayback') return { usePhrasePlayback: () => playback };
    if (request === './decks/sample.json?raw') return { default: fs.readFileSync(path.join(__dirname, '../decks/sample.json'), 'utf8') };
    if (request.endsWith('.css')) return {};
    if (['../../core/physics.ts', './view/FallingView', './view/VisualKeyboard', './view/CardProjection', './view/EventLog', './midi/useMidi', './cards/TrainerPianoCard', './trainingSession'].includes(request)) return {};
    return originalRequire(request);
  };
  const oldDocument = global.document;
  global.document = { getElementById: () => ({}) };
  try {
    component._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);
  } finally { global.document = oldDocument; }
  function render() { cursor = 0; return root.type(root.props); }
  function all(element) { if (Array.isArray(element)) return element.flatMap(all); if (!element || typeof element !== 'object') return []; return [element, ...[].concat(element.props?.children || []).flatMap(all)]; }
  function find(tree, predicate) { const element = all(tree).find(predicate); assert.ok(element, 'expected element not found'); return element; }
  return { render, find, get stops() { return stops; } };
}

const valid = JSON.stringify({ schemaVersion: 1, id: 'pasted', title: 'Pasted Deck', exercises: [{ id: 'x', label: 'X', notes: [60, 64, 67] }] });

test('paste validation preserves text and session on error, then replaces session on success', () => {
  const host = createHost();
  let tree = host.render();
  const dialog = host.find(tree, node => node.type === 'dialog');
  let open = false;
  dialog.props.ref.current = { showModal() { open = true; }, close() { open = false; } };
  const initial = host.find(tree, node => typeof node.type === 'function' && node.type.name === 'PracticeSession');
  host.find(tree, node => node.type === 'button' && node.props.children === 'Paste JSON').props.onClick();
  assert.equal(open, true);
  host.find(tree, node => node.type === 'textarea').props.onChange({ target: { value: '{ invalid' } });
  tree = host.render();
  host.find(tree, node => node.type === 'button' && node.props.children === 'Load Deck').props.onClick();
  tree = host.render();
  assert.match(host.find(tree, node => node.props.role === 'alert').props.children, /Could not load deck/);
  assert.equal(host.find(tree, node => node.type === 'textarea').props.value, '{ invalid');
  let session = host.find(tree, node => typeof node.type === 'function' && node.type.name === 'PracticeSession');
  assert.equal(session.key, initial.key);
  assert.equal(session.props.deck.title, 'Piano Starter');
  assert.equal(open, true);
  host.find(tree, node => node.type === 'textarea').props.onChange({ target: { value: valid } });
  tree = host.render();
  host.find(tree, node => node.type === 'button' && node.props.children === 'Load Deck').props.onClick();
  tree = host.render();
  session = host.find(tree, node => typeof node.type === 'function' && node.type.name === 'PracticeSession');
  assert.notEqual(session.key, initial.key);
  assert.equal(session.props.deck.title, 'Pasted Deck');
  assert.equal(session.props.deck.exercises.length, 1);
  assert.equal(open, false);
  assert.equal(host.stops, 1);
  assert.equal(host.find(tree, node => node.props.role === 'status' && node.props.children === 'Deck loaded').props.children, 'Deck loaded');
  let stopped = false;
  host.find(tree, node => node.type === 'dialog').props.onKeyDown({ key: 'Escape', stopPropagation() { stopped = true; } });
  assert.equal(stopped, true);
});

test('file picker uses the same load path and allows reselecting the same file', async () => {
  const host = createHost();
  let tree = host.render();
  const initial = host.find(tree, node => typeof node.type === 'function' && node.type.name === 'PracticeSession');
  const file = { text: async () => valid };
  for (let i = 1; i <= 2; i++) {
    const input = host.find(tree, node => node.type === 'input' && node.props.type === 'file');
    const target = { files: [file], value: 'deck.json' };
    await input.props.onChange({ target });
    assert.equal(target.value, '');
    tree = host.render();
    const session = host.find(tree, node => typeof node.type === 'function' && node.type.name === 'PracticeSession');
    assert.equal(session.key, initial.key + i);
    assert.equal(session.props.deck.title, 'Pasted Deck');
  }
  assert.equal(host.stops, 2);
});

test('settings panel opens and closes without removing its controls', () => {
  const host = createHost();
  let tree = host.render();
  const panel = () => host.find(tree, node => node.props?.id === 'trainer-settings');
  assert.equal(panel().props.hidden, true);
  host.find(tree, node => node.type === 'button' && node.props.children === 'Settings').props.onClick();
  tree = host.render();
  assert.equal(panel().props.hidden, false);
  for (const title of ['Playback & Tempo', 'Audio & Metronome', 'Learning Physics', 'Deck Management']) host.find(panel(), node => node.type === 'h2' && node.props.children === title);
  assert.ok(host.find(tree, node => node.type === 'input' && node.props.type === 'file'));
  host.find(tree, node => node.type === 'button' && node.props.children === 'Settings').props.onClick();
  tree = host.render();
  assert.equal(panel().props.hidden, true);
});

test('header switches between start and finish while pause stays separate', async () => {
  const host = createHost();
  let tree = host.render(), starts = 0;
  let session = host.find(tree, node => typeof node.type === 'function' && node.type.name === 'PracticeSession');
  session.props.startRef.current = () => { starts++; };
  host.find(tree, node => node.type === 'button' && node.props.children === 'Start Practice').props.onClick();
  assert.equal(starts, 1);
  session.props.onHeaderUpdate({ status: 'PLAYING', progress: '1.0', paused: false, canPause: true, started: true });
  tree = host.render();
  assert.ok(host.find(tree, node => node.type === 'button' && node.props.children === 'Finish Practice'));
  assert.equal(host.find(tree, node => node.type === 'button' && node.props.children === 'Pause').props.disabled, false);
  await host.find(tree, node => node.type === 'button' && node.props.children === 'Finish Practice').props.onClick();
  await Promise.resolve();
  tree = host.render();
  assert.ok(host.find(tree, node => typeof node.type === 'function' && node.type.name === 'MyDecks'));
});

test('header separates status and progress, and event log sits outside the practice viewport', () => {
  const host = createHost();
  const tree = host.render();
  const viewport = host.find(tree, node => node.props?.className === 'practice-viewport');
  const settings = host.find(viewport, node => node.props?.id === 'trainer-settings');
  assert.equal(host.find(settings, node => node.type === 'a' && node.props.children === 'Launcher').props.href, '../../');
  const progress = host.find(viewport, node => node.type === 'progress');
  assert.equal(progress.props['aria-label'], 'Learning progress');
  assert.equal(progress.props.value, 0);
  const top = host.find(viewport, node => node.props?.className === 'header-top');
  const bottom = host.find(viewport, node => node.props?.className === 'header-bottom');
  assert.equal(host.find(top, node => node.type === 'h1').props.children, 'Piano Starter');
  assert.equal(host.find(top, node => node.type === 'button' && node.props.children === 'Settings').props.children, 'Settings');
  assert.equal(host.find(bottom, node => node.type === 'button' && node.props.children === 'Start Practice').props.children, 'Start Practice');
  function all(node) { return !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(all) : [node, ...all(node.props?.children)]; }
  const log = all(tree).find(node => Array.isArray(node.props?.entries) && typeof node.props.clear === 'function');
  assert.ok(log);
  assert.equal(all(viewport).includes(log), false);
});
