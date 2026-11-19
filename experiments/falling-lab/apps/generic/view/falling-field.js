/**
 * Falling View — Generic Visual Renderer for Falling Core
 *
 * Renders the visual representation of falling cards, columns, thresholds,
 * grid lines, and progress history trace.
 *
 * Domain-independent: has zero knowledge of vocabulary, music, MIDI, or audio.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.FallingView = api;
    root.FallingField = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TUNE = Object.freeze({
    top: 24,
    bottom: 502,
    reachableTop: 60,
    left: 20,
    right: 1180,
    traceMargin: 4
  });

  const COLOR = Object.freeze({
    grid: '#202738',
    muted: '#657087',
    pink: '#ED4CA8',
    cyan: '#43E6ED'
  });

  const TRACE_LABEL = Object.freeze({ gap: 12 });

  const NS = 'http://www.w3.org/2000/svg';

  function screenY(position, layout = TUNE) {
    return layout.bottom - (position / 100) * (layout.bottom - layout.reachableTop);
  }

  function traceY(value, layout = TUNE) {
    return layout.bottom - layout.traceMargin - (value / 100) * (layout.bottom - layout.top - 2 * layout.traceMargin);
  }

  const renderedAttributes = new WeakMap();

  function setAttribute(node, key, value) {
    if (!node) return;
    const stringValue = String(value);
    let cached = renderedAttributes.get(node);
    if (!cached) {
      cached = new Map();
      renderedAttributes.set(node, cached);
    }
    if (cached.get(key) === stringValue) return;
    cached.set(key, stringValue);
    node.setAttribute(key, stringValue);
  }

  function setText(node, value) {
    if (!node) return;
    const stringValue = String(value);
    if (node.textContent === stringValue) return;
    node.textContent = stringValue;
  }

  function toggleClass(node, key, value) {
    if (!node) return;
    node.classList.toggle(key, Boolean(value));
  }

  function svgNode(type, attributes = {}, parent = null) {
    const doc = typeof document !== 'undefined' ? document : null;
    if (!doc) return null;
    const node = doc.createElementNS(NS, type);
    let cached = renderedAttributes.get(node);
    if (!cached) {
      cached = new Map();
      renderedAttributes.set(node, cached);
    }
    for (const [k, v] of Object.entries(attributes)) {
      if (k === 'textContent') {
        node.textContent = String(v);
      } else {
        cached.set(k, String(v));
        node.setAttribute(k, v);
      }
    }
    if (parent) parent.appendChild(node);
    return node;
  }

  function getElement(idOrElement) {
    if (!idOrElement) return null;
    if (typeof idOrElement !== 'string') return idOrElement;
    return typeof document !== 'undefined' ? document.getElementById(idOrElement) : null;
  }

  function createField(options = {}) {
    const layout = options.layout ? { ...TUNE, ...options.layout } : TUNE;
    const colors = options.colors ? { ...COLOR, ...options.colors } : COLOR;

    const chartEl = () => getElement(options.chartId || 'chart');
    const gridEl = () => getElement(options.gridId || 'grid');
    const barsEl = () => getElement(options.barsId || 'bars');
    const labelsEl = () => getElement(options.labelsId || 'labels');
    const traceEl = () => getElement(options.traceId || 'trace');
    const traceLiveEl = () => getElement(options.traceLiveId || 'trace-live');
    const tracePercentageEl = () => getElement(options.tracePercentageId || 'trace-percentage');
    const scoreEl = () => getElement(options.scoreId || 'score');

    const nodes = [];
    let historyLength = 0;
    let historyPath = '';

    function updateTraceStroke() {
      const chart = chartEl();
      const scale = chart?.getScreenCTM?.()?.a || 1;
      for (const elNode of [traceEl(), traceLiveEl()]) {
        if (elNode) setAttribute(elNode, 'stroke-width', 2.3 * scale);
      }
    }

    function build(cards, buildOptions = {}) {
      updateTraceStroke();
      const grid = gridEl();
      const bars = barsEl();
      const labels = labelsEl();

      if (grid) grid.replaceChildren();
      if (bars) bars.replaceChildren();
      if (labels) labels.replaceChildren();
      nodes.length = 0;
      historyLength = 0;
      historyPath = '';

      if (!grid || !bars || !labels) return nodes;

      const unlockThreshold = buildOptions.unlockThreshold ?? options.unlockThreshold ?? 50;
      const finishThreshold = buildOptions.finishThreshold ?? options.finishThreshold ?? 90;
      const unlockLabelText = buildOptions.unlockLabel ?? options.unlockLabel ?? 'NEW WORDS';
      const finishLabelText = buildOptions.finishLabel ?? options.finishLabel ?? 'COMPLETION';

      svgNode('line', {
        id: 'unlock-line',
        x1: layout.left,
        y1: screenY(unlockThreshold, layout),
        x2: layout.right,
        y2: screenY(unlockThreshold, layout),
        stroke: '#8b7aa8',
        'stroke-width': 1,
        'stroke-dasharray': '3 8',
        opacity: 0.65
      }, labels);

      const unlockLabelNode = svgNode('text', {
        id: 'unlock-label',
        x: layout.left + 3,
        y: screenY(unlockThreshold, layout) - 7,
        fill: '#8b7aa8',
        'font-size': 8
      }, labels);
      if (unlockLabelNode) unlockLabelNode.textContent = unlockLabelText;

      svgNode('line', {
        id: 'completion-line',
        x1: layout.left,
        y1: screenY(finishThreshold, layout),
        x2: layout.right,
        y2: screenY(finishThreshold, layout),
        stroke: colors.muted,
        'stroke-width': 1,
        'stroke-dasharray': '5 7',
        opacity: 0.65
      }, labels);

      const thresholdLabelNode = svgNode('text', {
        id: 'completion-label',
        x: layout.left + 3,
        y: screenY(finishThreshold, layout) - 7,
        fill: colors.muted,
        'font-size': 8
      }, labels);
      if (thresholdLabelNode) thresholdLabelNode.textContent = finishLabelText;

      for (let i = 0; i <= 4; i++) {
        const y = layout.top + i * (layout.bottom - layout.top) / 4;
        svgNode('line', {
          x1: layout.left,
          y1: y,
          x2: layout.right,
          y2: y,
          stroke: colors.grid,
          'stroke-width': 1
        }, grid);
        const text = svgNode('text', {
          x: 1190,
          y: y + 3,
          fill: colors.muted,
          'font-size': 8,
          'text-anchor': 'end'
        }, grid);
        if (text) text.textContent = String(100 - i * 25);
      }

      const count = Array.isArray(cards) ? cards.length : (typeof cards === 'number' ? cards : 10);
      const slotWidth = (layout.right - layout.left) / count;

      for (let i = 0; i < count; i++) {
        const card = Array.isArray(cards) ? cards[i] : null;
        const x = layout.left + i * slotWidth + 5;
        const width = slotWidth - 10;

        const slotCol = svgNode('rect', {
          x: x - 2,
          y: layout.top,
          width: width + 4,
          height: layout.bottom - layout.top,
          fill: 'rgba(67, 230, 237, 0.04)',
          stroke: '#43E6ED',
          'stroke-width': 1.2,
          'stroke-dasharray': '3 6',
          opacity: 0,
          rx: 2
        }, grid);

        const slotArrow = svgNode('polygon', {
          points: `${x + width / 2 - 5},${layout.top - 10} ${x + width / 2 + 5},${layout.top - 10} ${x + width / 2},${layout.top - 3}`,
          fill: '#43E6ED',
          opacity: 0
        }, grid);

        const guide = svgNode('line', {
          x1: x + width / 2,
          y1: layout.top,
          x2: x + width / 2,
          y2: layout.bottom,
          stroke: colors.grid,
          'stroke-width': 0.6,
          'stroke-dasharray': '2 8'
        }, grid);

        const bar = svgNode('rect', {
          x,
          y: layout.top,
          width,
          height: 0,
          fill: 'url(#bar-fill)'
        }, bars);

        const edge = svgNode('line', {
          x1: x,
          y1: 0,
          x2: x + width,
          y2: 0,
          stroke: colors.pink,
          'stroke-width': 1.3
        }, bars);

        const label = svgNode('text', {
          x: 0,
          y: 0,
          fill: '#e3e8ef',
          'font-size': 14,
          'text-anchor': 'start',
          'dominant-baseline': 'central'
        }, labels);
        if (label) {
          label.textContent = card?.label || card?.english || `Phrase ${i + 1}`;
        }

        const streak = svgNode('text', {
          x: x + width / 2,
          y: 0,
          fill: colors.pink,
          'font-size': 8,
          'text-anchor': 'middle'
        }, labels);

        const index = svgNode('text', {
          x: x + width / 2,
          y: 540,
          fill: colors.muted,
          'font-size': 8,
          'text-anchor': 'middle'
        }, grid);
        if (index) index.textContent = String(i + 1).padStart(2, '0');

        nodes.push({ bar, edge, label, streak, guide, index, slotCol, slotArrow });
      }

      return nodes;
    }

    function render(state, dt = 0) {
      const cards = state.cards || [];
      const selectedIndex = state.selectedIndex ?? -1;

      for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        const node = nodes[i];
        if (!node) continue;

        const { bar, edge, label, streak, guide, index, slotCol, slotArrow } = node;
        const y = screenY(card.shown, layout);
        const isSelected = (card.isSelected !== undefined) ? card.isSelected : (i === selectedIndex);

        for (const element of [bar, edge, label, streak, guide, index]) {
          setAttribute(element, 'visibility', card.unlocked ? 'visible' : 'hidden');
        }

        if (slotCol) {
          setAttribute(slotCol, 'visibility', card.unlocked && isSelected ? 'visible' : 'hidden');
          setAttribute(slotCol, 'opacity', isSelected ? '0.9' : '0');
        }

        if (slotArrow) {
          setAttribute(slotArrow, 'visibility', card.unlocked && isSelected ? 'visible' : 'hidden');
          setAttribute(slotArrow, 'opacity', isSelected ? '1' : '0');
        }

        const isComplete = Boolean(card.isComplete || card.aboveFinish);
        if (node.aboveFinish === true && !isComplete) node.reactivation = 0.28;
        else node.reactivation = Math.max(0, (node.reactivation || 0) - dt);
        node.aboveFinish = isComplete;

        for (const element of [bar, edge, label, streak]) {
          toggleClass(element, 'word-faded', isComplete);
          toggleClass(element, 'word-reactivated', !isComplete && node.reactivation > 0);
        }

        setAttribute(bar, 'height', y - layout.top);
        setAttribute(bar, 'fill', isSelected ? 'url(#bar-fill-selected)' : 'url(#bar-fill)');

        setAttribute(edge, 'y1', y);
        setAttribute(edge, 'y2', y);
        const flash = card.flash || 0;
        setAttribute(edge, 'stroke-width', 1.3 + flash * 1.5);
        setAttribute(edge, 'stroke', flash > 0.2 ? '#ffffff' : (isSelected ? colors.cyan : colors.pink));

        const labelX = layout.left + (i + 0.5) * (layout.right - layout.left) / cards.length;
        setAttribute(label, 'transform', `translate(${labelX},${y - 8}) rotate(-90)`);
        setAttribute(label, 'fill', flash > 0.2 || node.reactivation > 0 ? colors.pink : (isSelected ? colors.cyan : '#e3e8ef'));
        if (card.label && label.textContent !== card.label) {
          label.textContent = card.label;
        }

        setAttribute(streak, 'y', y + 16);
        const percentVal = Math.round(Math.min(card.depth, card.shown));
        setText(streak, percentVal + '%');
        setAttribute(streak, 'font-size', 15);
        setAttribute(streak, 'font-weight', 700);
        setAttribute(streak, 'fill', isSelected ? colors.cyan : colors.pink);
        setAttribute(streak, 'stroke', '#0A0D19');
        setAttribute(streak, 'stroke-width', 4);
        setAttribute(streak, 'paint-order', 'stroke');

        if (isSelected) {
          setAttribute(index, 'fill', colors.cyan);
          setAttribute(index, 'font-weight', '700');
        } else {
          setAttribute(index, 'fill', colors.muted);
          setAttribute(index, 'font-weight', '400');
        }
      }

      // Progress score readout
      const progressValue = state.progress ?? 0;
      const score = scoreEl();
      if (score) setText(score, progressValue.toFixed(1));

      // Progress history trace
      const observations = state.observations || [];
      const observationTimes = state.observationTimes || [];
      const activeTime = state.activeTime ?? 0;

      if (state.historyLength !== undefined) historyLength = state.historyLength;
      if (state.historyPath !== undefined) historyPath = state.historyPath;
      if (observations.length < historyLength) {
        historyLength = 0;
        historyPath = '';
      }

      while (historyLength < observations.length) {
        const i = historyLength++;
        historyPath += (i ? ' L' : 'M') + observationTimes[i] + ',' + traceY(observations[i], layout).toFixed(2);
      }

      if (state.historyLength !== undefined) state.historyLength = historyLength;
      if (state.historyPath !== undefined) state.historyPath = historyPath;

      const trace = traceEl();
      if (trace) setAttribute(trace, 'd', historyPath);

      const transform = `translate(${layout.left} 0) scale(${activeTime > 0 ? (layout.right - layout.left) / activeTime : 1} 1)`;
      for (const elNode of [trace, traceLiveEl()]) {
        if (elNode) {
          setAttribute(elNode, 'transform', transform);
          setAttribute(elNode, 'vector-effect', 'non-scaling-stroke');
        }
      }

      const last = observations.length - 1;
      const headY = traceY(progressValue, layout);
      const traceLive = traceLiveEl();
      if (traceLive && observations.length) {
        setAttribute(traceLive, 'd', `M${observationTimes[last]},${traceY(observations[last], layout).toFixed(2)} L${activeTime},${headY.toFixed(2)}`);
      }

      const tracePercentage = tracePercentageEl();
      if (tracePercentage) {
        setAttribute(tracePercentage, 'x', layout.right + TRACE_LABEL.gap);
        setAttribute(tracePercentage, 'y', headY);
        setText(tracePercentage, progressValue.toFixed(1) + '%');
      }
    }

    function resetHistory() {
      historyLength = 0;
      historyPath = '';
      const trace = traceEl();
      if (trace) setAttribute(trace, 'd', '');
      const traceLive = traceLiveEl();
      if (traceLive) setAttribute(traceLive, 'd', '');
    }

    return {
      TUNE: layout,
      COLOR: colors,
      screenY: pos => screenY(pos, layout),
      traceY: val => traceY(val, layout),
      build,
      render,
      updateTraceStroke,
      resetHistory,
      getNodes: () => nodes,
      nodes,
      get historyLength() { return historyLength; },
      set historyLength(v) { historyLength = v; },
      get historyPath() { return historyPath; },
      set historyPath(v) { historyPath = v; }
    };
  }

  return Object.freeze({
    TUNE,
    COLOR,
    TRACE_LABEL,
    screenY,
    traceY,
    createField,
    setAttribute,
    setText,
    toggleClass,
    svgNode
  });
});
