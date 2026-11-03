'use strict';

const VocabularyApp = (() => {
  const HINT_SECONDS = 2;
  const latencyMultiplier = t => 0.5 + 1.5 * Math.exp(-1.5 * Math.max(0, t));

  const VOCABULARY = [
    ['river', 'río'], ['light', 'luz'], ['apple', 'manzana'],
    ['night', 'noche'], ['house', 'casa'], ['water', 'agua'], ['bread', 'pan'],
    ['bird', 'pájaro'], ['dream', 'sueño'], ['window', 'ventana'],
    ['sun', 'sol'], ['moon', 'luna'], ['star', 'estrella'], ['sky', 'cielo'],
    ['sea', 'mar'], ['mountain', 'montaña'], ['tree', 'árbol'], ['flower', 'flor'],
    ['road', 'camino'], ['city', 'ciudad'], ['book', 'libro'], ['table', 'mesa'],
    ['chair', 'silla'], ['door', 'puerta'], ['fire', 'fuego'], ['earth', 'tierra'],
    ['hand', 'mano'], ['eye', 'ojo'], ['heart', 'corazón'], ['time', 'tiempo']
  ];

  function createVocabularyApp(options = {}) {
    const {
      coordinator,
      vocabularyView,
      el = id => typeof document !== 'undefined' ? document.getElementById(id) : null
    } = options;

    let keydownListener = null;

    function getCardLabel(index) {
      return VOCABULARY[index]?.[0] || `Word ${index + 1}`;
    }

    function retrieve(skipped = false) {
      if (!coordinator) return;
      const { session, isPaused, isComplete, getTime, advanceTo, recordObservation, acceptTransition, updateReadouts, render, checkCompletion, setWordFlash, setLastMeasurement, setKickGraphEnded } = coordinator;
      if (isPaused() || isComplete()) return;
      advanceTo(getTime());
      if (isPaused() || isComplete()) return;
      recordObservation();

      const sessionState = session.getState();
      const targetIndex = sessionState ? sessionState.selectedIndex : 0;
      if (targetIndex < 0) return;

      if (skipped) {
        const result = session.skip();
        if (!result) return;
        setLastMeasurement({
          kind: 'skip',
          index: targetIndex,
          word: VOCABULARY[targetIndex]?.[0] || 'Phrase',
          translation: VOCABULARY[targetIndex]?.[1] || '',
          lift: 0
        });
        setKickGraphEnded(true);
        vocabularyView?.endKickGraph();
        acceptTransition(result);
        recordObservation();
        updateReadouts();
        render(0);
        checkCompletion();
      } else {
        const latency = sessionState ? Math.max(0, sessionState.time - sessionState.selectedAt) : 0;
        const multiplier = latencyMultiplier(latency);
        const result = session.applyReward(targetIndex, multiplier);
        if (!result) return;
        setWordFlash(targetIndex, 1);
        const hinted = latency >= HINT_SECONDS;
        setLastMeasurement({
          kind: 'retrieval',
          index: targetIndex,
          word: VOCABULARY[targetIndex]?.[0] || 'Phrase',
          translation: VOCABULARY[targetIndex]?.[1] || '',
          hintVisible: hinted,
          multiplier,
          kickTime: result.kickTime,
          lift: result.lift
        });
        setKickGraphEnded(true);
        vocabularyView?.endKickGraph();
        acceptTransition(result);
        recordObservation();
        updateReadouts();
        render(0);
        checkCompletion();
      }
    }

    function renderView(state, dt) {
      if (!coordinator) return;
      const selected = state ? state.selectedIndex : 0;
      const words = coordinator.getWords();
      const target = words ? words[selected] : null;
      if (vocabularyView) {
        vocabularyView.renderPrompt({
          target,
          selectedIndex: selected,
          promptState: state
        }, dt);
        coordinator.setKickGraphEnded(vocabularyView.isKickGraphEnded());
      }
    }

    function reset() {
      vocabularyView?.reset();
    }

    function attach() {
      // Configure DOM visibility for vocabulary mode:
      const overlay = el('musical-card-overlay');
      if (overlay) overlay.style.display = 'none';
      const devPanel = el('dev-panel');
      if (devPanel) devPanel.style.display = 'none';
      const deviceReadout = el('device-readout');
      if (deviceReadout) deviceReadout.style.display = 'none';
      const connectBtn = el('connect');
      if (connectBtn) connectBtn.style.display = 'none';
      const playDemoBtn = el('play-demo');
      if (playDemoBtn) playDemoBtn.style.display = 'none';

      const prompt = el('prompt');
      if (prompt) prompt.textContent = 'TYPE SPANISH = RETRIEVE / ESC = SKIP';

      // Setup keyboard listener ISOLATED to vocabulary
      if (typeof document !== 'undefined') {
        keydownListener = event => {
          if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
          if (event.target?.matches?.('input, select, textarea')) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            retrieve(true);
            return;
          }
          if (/^Key[A-Z]$/.test(event.code) || /^\p{L}$/u.test(event.key)) {
            event.preventDefault();
            retrieve(false);
          }
          // Note: keys 1, 2, 3 and MIDI are not handled here
        };
        document.addEventListener('keydown', keydownListener);
      }
    }

    function detach() {
      if (keydownListener && typeof document !== 'undefined') {
        document.removeEventListener('keydown', keydownListener);
        keydownListener = null;
      }
    }

    return {
      name: 'vocabulary',
      VOCABULARY,
      getCardLabel,
      retrieve,
      render: renderView,
      reset,
      attach,
      detach
    };
  }

  return {
    createVocabularyApp,
    VOCABULARY
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VocabularyApp;
}
