/**
 * Vocabulary View — Foreground UI for Vocabulary Prompts and Retrieval Kick Graph
 *
 * Domain-specific foreground view for vocabulary:
 * - Active target word, streak, slot badge, and hint readout
 * - Real-time kick reward curve and multiplier indicator
 *
 * Independent of physics engine internals and musical audio/MIDI.
 */

(function (root, factory) {
  const api = factory(
    typeof FallingField !== 'undefined' ? FallingField : (typeof require === 'function' ? require('./field.js') : null)
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VocabularyView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (FallingFieldModule) {
  'use strict';

  const HINT_SECONDS = 2;
  const defaultLatencyMultiplier = t => 0.5 + 1.5 * Math.exp(-1.5 * Math.max(0, t));

  const setAttribute = FallingFieldModule?.setAttribute || function (node, key, value) {
    if (node) node.setAttribute(key, String(value));
  };
  const setText = FallingFieldModule?.setText || function (node, value) {
    if (node) node.textContent = String(value);
  };
  const el = id => typeof document !== 'undefined' ? document.getElementById(id) : null;

  function createVocabularyView(options = {}) {
    const hintSeconds = options.hintSeconds ?? HINT_SECONDS;
    const latencyMultiplier = options.latencyMultiplier ?? defaultLatencyMultiplier;

    let kickGraphEnded = false;

    function renderKickGraph(state, dt = 0) {
      if (dt > 0) kickGraphEnded = false;
      const graph = el('kick-graph');
      if (!graph) return;

      const hidden = Boolean(state.complete || state.selectedIndex < 0 || kickGraphEnded);
      if (graph.hidden !== hidden) graph.hidden = hidden;
      setAttribute(graph, 'aria-hidden', String(graph.hidden));
      if (state.complete || state.selectedIndex < 0) return;

      const elapsed = Math.max(0, state.time - state.selectedAt);
      const windowSeconds = Math.max(4, elapsed);
      const x = t => 32 + 192 * t / windowSeconds;
      const y = m => 64 - 52 * m / latencyMultiplier(0);
      const multiplier = latencyMultiplier(elapsed);
      const hintX = x(hintSeconds);

      const curve = el('kick-reward-curve');
      if (curve && curve.windowSeconds !== windowSeconds) {
        curve.windowSeconds = windowSeconds;
        const denseEnd = Math.min(windowSeconds, 8);
        const curvePoints = Array.from({ length: 97 }, (_, i) => {
          const t = denseEnd * i / 96;
          return `${i === 0 ? 'M' : 'L'}${x(t)} ${y(latencyMultiplier(t))}`;
        });
        if (windowSeconds > denseEnd) curvePoints.push(`L224 ${y(latencyMultiplier(windowSeconds))}`);
        setAttribute(curve, 'd', curvePoints.join(' '));
      }

      if (el('kick-hint-guide')) {
        setAttribute(el('kick-hint-guide'), 'x1', hintX);
        setAttribute(el('kick-hint-guide'), 'x2', hintX);
      }
      if (el('kick-hint-point')) {
        setAttribute(el('kick-hint-point'), 'cx', hintX);
        setAttribute(el('kick-hint-point'), 'cy', y(latencyMultiplier(hintSeconds)));
      }
      if (el('kick-indicator')) {
        setAttribute(el('kick-indicator'), 'cx', x(elapsed));
        setAttribute(el('kick-indicator'), 'cy', y(multiplier));
      }
      if (el('kick-one-second')) {
        setAttribute(el('kick-one-second'), 'x', x(1));
        setAttribute(el('kick-one-second'), 'visibility', x(hintSeconds) - x(1) >= 18 ? 'visible' : 'hidden');
      }
      if (el('kick-hint-time')) {
        setAttribute(el('kick-hint-time'), 'x', hintX);
        setAttribute(el('kick-hint-time'), 'visibility', hintX - x(0) >= 24 ? 'visible' : 'hidden');
        setText(el('kick-hint-time'), hintSeconds + 's');
      }
      if (el('kick-axis-end')) setText(el('kick-axis-end'), windowSeconds.toFixed(1) + 's');
      if (el('kick-graph-value')) setText(el('kick-graph-value'), elapsed.toFixed(1) + 's / ' + multiplier.toFixed(2) + '×');
      if (el('kick-graph-svg')) {
        setAttribute(el('kick-graph-svg'), 'aria-label', `Possible kick: ${multiplier.toFixed(2)} times at ${elapsed.toFixed(1)} seconds; hint at ${hintSeconds} seconds`);
      }
    }

    function renderPrompt(state, dt = 0) {
      const target = state.target;
      const selected = state.selectedIndex ?? -1;
      const promptState = state.promptState;

      if (target && el('target-word')) {
        setText(el('target-word'), target.english || `Slot ${String(selected + 1).padStart(2, '0')}`);
      }
      if (target && el('target-streak')) {
        setText(el('target-streak'), 'STREAK ' + String(target.streak ?? 0).padStart(2, '0'));
      }
      if (el('card-slot-tag')) {
        setText(el('card-slot-tag'), selected >= 0 ? `ACTIVE SLOT ${String(selected + 1).padStart(2, '0')}` : 'COMPLETE');
      }

      if (promptState) {
        renderKickGraph(promptState, dt);

        if (el('target-hint')) {
          const hinted = (promptState.time - promptState.selectedAt) >= hintSeconds;
          if (el('target-hint').hidden === hinted) el('target-hint').hidden = !hinted;
          setText(el('target-hint'), hinted ? 'HINT → ' + (target?.spanish || 'C4 D4 E4') : '');
        }
      }
    }

    function endKickGraph() {
      kickGraphEnded = true;
      const graph = el('kick-graph');
      if (graph) {
        graph.hidden = true;
        setAttribute(graph, 'aria-hidden', 'true');
      }
    }

    function reset() {
      kickGraphEnded = false;
      const graph = el('kick-graph');
      if (graph) {
        graph.hidden = false;
        setAttribute(graph, 'aria-hidden', 'false');
      }
      if (el('target-hint')) {
        el('target-hint').hidden = true;
        setText(el('target-hint'), '');
      }
    }

    return {
      renderPrompt,
      renderKickGraph,
      endKickGraph,
      reset,
      isKickGraphEnded: () => kickGraphEnded,
      setKickGraphEnded: val => { kickGraphEnded = Boolean(val); }
    };
  }

  return Object.freeze({
    HINT_SECONDS,
    defaultLatencyMultiplier,
    createVocabularyView
  });
});
