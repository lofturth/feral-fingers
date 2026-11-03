'use strict';

const FallingFieldModule = typeof FallingView !== 'undefined' ? FallingView : (typeof FallingField !== 'undefined' ? FallingField : (typeof require === 'function' ? require('../../views/falling/view.js') : null));
const MunduPhysicsModule = typeof MunduPhysics !== 'undefined' ? MunduPhysics : (typeof require === 'function' ? require('../../core/physics.js') : null);

if (!FallingFieldModule || !MunduPhysicsModule) {
  throw new Error('FallingField and MunduPhysics modules are required.');
}

const GenericDemo = (() => {
  const CARD_LABELS = ['Card A', 'Card B', 'Card C', 'Card D', 'Card E'];
  const CARD_COUNT = CARD_LABELS.length;

  function createDemo(options = {}) {
    const {
      chartId = 'chart',
      gridId = 'grid',
      barsId = 'bars',
      labelsId = 'labels',
      traceId = 'trace',
      traceLiveId = 'trace-live',
      tracePercentageId = 'trace-percentage',
      scoreId = 'score',
      el = id => typeof document !== 'undefined' ? document.getElementById(id) : null
    } = options;

    const field = FallingFieldModule.createField({
      chartId,
      gridId,
      barsId,
      labelsId,
      traceId,
      traceLiveId,
      tracePercentageId,
      scoreId
    });

    let session = null;
    let sessionState = null;
    let paused = false;
    let observations = [0];
    let observationTimes = [0];
    let activeTime = 0;
    let progressValue = 0;
    let nextSampleTime = 0.25;
    let historyPath = '';
    let historyLength = 0;
    let animationFrame = null;
    let lastTime = null;
    let wordFlashes = new Array(CARD_COUNT).fill(0);
    let pendingUnlock = false;

    function reset() {
      session = MunduPhysicsModule.createSession({
        cardCount: CARD_COUNT,
        config: {
          unlock: { threshold: 50 },
          finish: { threshold: 90 },
          motion: {
            topFallingSpeed: 1,
            bottomToTopMultiplier: 5,
            kickHeightPercent: 25,
            gravityReductionPercent: 0
          }
        }
      });
      sessionState = session.getState();
      paused = false;
      wordFlashes = new Array(CARD_COUNT).fill(0);
      observations = [0];
      observationTimes = [0];
      activeTime = 0;
      progressValue = 0;
      nextSampleTime = 0.25;
      historyPath = '';
      historyLength = 0;
      lastTime = typeof performance !== 'undefined' ? performance.now() : 0;
      field.resetHistory();

      const cards = sessionState.cards.map((c, i) => ({
        ...c,
        label: CARD_LABELS[i]
      }));
      field.build(cards, {
        unlockThreshold: 50,
        finishThreshold: 90,
        unlockLabel: 'UNLOCK',
        finishLabel: 'COMPLETE'
      });

      render(0);
      updateStatus();
      scheduleFrame();
    }

    function reward(magnitude = 1.0) {
      if (paused || sessionState?.complete) return null;
      advanceTo(typeof performance !== 'undefined' ? performance.now() : 0);
      const targetIndex = sessionState ? sessionState.selectedIndex : -1;
      if (targetIndex < 0) return null;

      const result = session.applyReward(targetIndex, magnitude);
      if (result) {
        wordFlashes[targetIndex] = 1;
        recordObservation();
        acceptTransition(result);
        render(0);
        updateStatus();
      }
      return result;
    }

    function skip() {
      if (paused || sessionState?.complete) return null;
      advanceTo(typeof performance !== 'undefined' ? performance.now() : 0);
      const result = session.skip();
      if (result) {
        recordObservation();
        acceptTransition(result);
        render(0);
        updateStatus();
      }
      return result;
    }

    function togglePause() {
      if (sessionState?.complete) return;
      if (!paused) {
        advanceTo(typeof performance !== 'undefined' ? performance.now() : 0);
      }
      paused = !paused;
      session.setPaused(paused);
      sessionState = session.getState();
      lastTime = typeof performance !== 'undefined' ? performance.now() : 0;
      updateStatus();
      if (!paused) scheduleFrame();
    }

    function recordObservation() {
      observations.push(progressValue);
      observationTimes.push(activeTime);
    }

    function acceptTransition(result) {
      if (result?.unlockedIndex !== null && result?.unlockedIndex !== undefined) {
        pendingUnlock = true;
      }
      sessionState = session.getState();
      progressValue = session.getProgress();
      activeTime = sessionState.time;
    }

    function advanceTo(time) {
      const nextTime = lastTime === null ? time : Math.max(time, lastTime);
      const dt = lastTime === null ? 0 : (nextTime - lastTime) / 1000;
      lastTime = nextTime;
      if (!paused && !sessionState?.complete) {
        wordFlashes = wordFlashes.map(flash => Math.max(0, flash - dt * 2.8));
        const transition = session.advance(dt);
        acceptTransition(transition);

        progressValue = session.getProgress();
        if (activeTime >= nextSampleTime) {
          recordObservation();
          nextSampleTime = activeTime + 0.25;
        }
        render(dt);
      }
    }

    function render(dt) {
      if (!sessionState) return;
      const selected = sessionState.selectedIndex;
      const displayCards = sessionState.cards.map((card, i) => ({
        id: card.id,
        index: i,
        depth: card.depth,
        shown: card.shown,
        unlocked: card.unlocked,
        flash: wordFlashes[i] || 0,
        isComplete: card.depth >= 90,
        isSelected: i === selected,
        label: CARD_LABELS[i]
      }));

      progressValue = session.getProgress();
      if (pendingUnlock) {
        pendingUnlock = false;
        recordObservation();
      }

      field.render({
        cards: displayCards,
        selectedIndex: selected,
        progress: progressValue,
        activeTime,
        observations,
        observationTimes,
        historyLength,
        historyPath
      }, dt);

      updateReadouts();
    }

    function updateReadouts() {
      const selected = sessionState?.selectedIndex ?? -1;
      const currentCard = selected >= 0 ? CARD_LABELS[selected] : 'None';
      if (el('selected-card')) el('selected-card').textContent = currentCard;
      if (el('progress-val')) el('progress-val').textContent = progressValue.toFixed(1) + '%';
      if (el('reward-count')) el('reward-count').textContent = String(sessionState?.rewardCount ?? 0);
    }

    function updateStatus() {
      const statusEl = el('demo-status');
      if (statusEl) {
        statusEl.textContent = sessionState?.complete ? 'COMPLETE' : paused ? 'PAUSED' : 'LIVE';
      }
      const pauseBtn = el('btn-pause');
      if (pauseBtn) {
        pauseBtn.textContent = paused ? 'Resume' : 'Pause';
      }
    }

    function scheduleFrame() {
      if (animationFrame === null && !paused && !sessionState?.complete && typeof requestAnimationFrame === 'function') {
        animationFrame = requestAnimationFrame(time => {
          animationFrame = null;
          advanceTo(time);
          scheduleFrame();
        });
      }
    }

    function attachUI() {
      el('btn-reward')?.addEventListener('click', () => reward(1.0));
      el('btn-skip')?.addEventListener('click', skip);
      el('btn-pause')?.addEventListener('click', togglePause);
      el('btn-reset')?.addEventListener('click', reset);
    }

    return {
      CARD_LABELS,
      CARD_COUNT,
      field,
      getSession: () => session,
      getState: () => sessionState,
      getProgress: () => progressValue,
      reward,
      skip,
      togglePause,
      reset,
      attachUI,
      render,
      advanceTo
    };
  }

  return {
    createDemo,
    CARD_LABELS
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GenericDemo;
}
