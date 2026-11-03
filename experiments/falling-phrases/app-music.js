'use strict';

const MusicalApp = (() => {
  const sharpNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const noteName = pitch => sharpNames[pitch % 12] + (Math.floor(pitch / 12) - 1);
  const targetPitches = [60, 62, 64]; // C4, D4, E4
  const tempoBpm = 80;
  const beatSeconds = 60 / tempoBpm;
  const noteSeconds = 0.65;

  function createMusicalApp(options = {}) {
    const {
      coordinator,
      musicalView,
      el = id => typeof document !== 'undefined' ? document.getElementById(id) : null
    } = options;

    let audio = null;
    let activeSounds = new Set();
    let metronomeTimer = null;
    let presentationRunning = false;
    let presentationListeningAt = Infinity;
    let presentationPlaybackEnd = Infinity;
    let presentationProgress = 0;
    let presentationMatchEvents = [];
    let presentationComplete = false;
    let attemptResetTimer = null;
    let activeAttempt = null;
    let totalLifts = 0;

    let rollStartedAt = 0;
    let rollStoppedAt = 0;
    let rollNotes = [];
    const rollHeld = new Map();
    let rollZoomSeconds = 8;

    let midiAccess = null;
    let activeInput = null;
    let midiConnecting = false;
    let keydownListener = null;

    function getCardLabel(index) {
      return `Phrase ${index + 1}`;
    }

    async function prepareAudio() {
      if (typeof window === 'undefined') return null;
      if (!audio) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) audio = new AudioContextClass();
      }
      if (audio && audio.state === 'suspended') {
        await audio.resume();
      }
      return audio;
    }

    function sound(when, frequency, duration, volume = 0.14, piano = false, timbre = 'sine') {
      if (!audio) return [];
      const harmonics = timbre === 'bell' ? [1, 0.23] : timbre === 'warm' ? [1, 0.16] : piano ? [1, 0.22, 0.07] : [1];
      const oscillators = [];
      harmonics.forEach((strength, index) => {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.type = 'sine';
        osc.frequency.value = frequency * (timbre === 'bell' && index === 1 ? 2.71 : index + 1);

        gain.gain.setValueAtTime(0.0001, when);
        gain.gain.exponentialRampToValueAtTime(
          volume * strength,
          when + (timbre === 'bell' ? 0.003 : timbre === 'warm' ? 0.018 : piano ? 0.005 : 0.008)
        );
        if (piano) gain.gain.exponentialRampToValueAtTime(volume * strength * 0.38, when + 0.16);
        if (timbre === 'warm') gain.gain.exponentialRampToValueAtTime(volume * strength * 0.45, when + 0.18);
        gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);

        osc.connect(gain).connect(audio.destination);
        osc.start(when);
        osc.stop(when + duration + 0.02);

        activeSounds.add(osc);
        osc.onended = () => activeSounds.delete(osc);
        oscillators.push(osc);
      });
      return oscillators;
    }

    function stopAllAudio() {
      if (metronomeTimer) clearInterval(metronomeTimer);
      metronomeTimer = null;
      if (audio) {
        for (const osc of activeSounds) {
          try { osc.stop(audio.currentTime); } catch {}
        }
      }
      activeSounds.clear();
    }

    function playCompletionChime() {
      if (!audio || audio.state !== 'running') return;
      const now = audio.currentTime + 0.01;
      sound(now, 523.25, 0.3, 0.05, false, 'warm');
      sound(now + 0.18, 659.25, 0.4, 0.05, false, 'warm');
    }

    function updateCardVisuals() {
      musicalView?.updateCardVisuals(presentationProgress, targetPitches);
    }

    function drawPianoRoll() {
      musicalView?.drawPianoRoll({
        rollNotes,
        rollStartedAt,
        rollZoomSeconds,
        activeAttempt,
        noteSeconds
      });
    }

    function renderPerformanceMetrics() {
      musicalView?.renderPerformanceMetrics({
        activeAttempt,
        presentationProgress,
        presentationComplete,
        presentationMatchEvents
      });
    }

    function renderTimingDeviation() {
      musicalView?.renderTimingDeviation({
        activeAttempt,
        presentationMatchEvents
      });
    }

    function renderNoteDuration() {
      musicalView?.renderNoteDuration({
        activeAttempt,
        presentationMatchEvents,
        presentationComplete
      });
    }

    function initAttempt() {
      presentationProgress = 0;
      presentationMatchEvents = [];
      presentationComplete = false;
      if (attemptResetTimer) clearTimeout(attemptResetTimer);
      attemptResetTimer = null;

      rollStartedAt = typeof performance !== 'undefined' ? performance.now() : 0;
      rollStoppedAt = 0;
      rollNotes = [];
      rollHeld.clear();

      activeAttempt = {
        timeUnit: 'milliseconds',
        timeReference: 'Monotonic performance.now() elapsed since Start',
        startedAtMs: 0,
        completedAtMs: null,
        stoppedAtMs: null,
        targetPitches: [...targetPitches],
        tempoBpm,
        beatDurationMs: beatSeconds * 1000,
        audioPromptEnabled: el('play-audio')?.checked ?? true,
        metronomeEnabled: el('play-metronome')?.checked ?? true,
        promptNotes: [],
        promptEndMs: null,
        metronomeBeatOriginMs: null,
        preparationBeatMs: null,
        intendedEntryMs: null,
        replays: [],
        midiEvents: [],
        matchedMidiEvents: []
      };

      updateCardVisuals();
      renderPerformanceMetrics();
      renderTimingDeviation();
      renderNoteDuration();
      drawPianoRoll();
    }

    async function startDemoPlayback() {
      stopAllAudio();
      initAttempt();

      const playAudio = el('play-audio')?.checked ?? true;
      const playMetronome = el('play-metronome')?.checked ?? true;

      presentationRunning = true;
      if (el('card-badge')) {
        el('card-badge').className = 'card-badge';
        el('card-badge').textContent = 'Listening…';
      }
      if (el('card-feedback')) el('card-feedback').textContent = 'Listen to phrase C4 D4 E4, then play it';

      if (!playAudio && !playMetronome) {
        activeAttempt.metronomeBeatOriginMs = 0;
        activeAttempt.preparationBeatMs = 3 * activeAttempt.beatDurationMs;
        activeAttempt.intendedEntryMs = 4 * activeAttempt.beatDurationMs;
        presentationListeningAt = 0;
        presentationPlaybackEnd = 0;
        return;
      }

      try {
        await prepareAudio();
        if (!audio) return;
        const startTime = audio.currentTime + 0.1;
        const scheduledStartMs = performance.now() - rollStartedAt + (startTime - audio.currentTime) * 1000;

        activeAttempt.metronomeBeatOriginMs = scheduledStartMs;
        activeAttempt.preparationBeatMs = scheduledStartMs + 3 * activeAttempt.beatDurationMs;
        activeAttempt.intendedEntryMs = scheduledStartMs + 4 * activeAttempt.beatDurationMs;

        if (playAudio) {
          const promptNotes = targetPitches.map((pitch, index) => ({
            pitch,
            timeMs: scheduledStartMs + index * beatSeconds * 1000,
            durationMs: noteSeconds * 1000
          }));
          activeAttempt.promptNotes = promptNotes;

          for (const [index, pitch] of targetPitches.entries()) {
            const freq = 440 * (2 ** ((pitch - 69) / 12));
            sound(startTime + index * beatSeconds, freq, noteSeconds, 0.14, true);
          }
          presentationPlaybackEnd = startTime + (targetPitches.length - 1) * beatSeconds + noteSeconds;
          activeAttempt.promptEndMs = scheduledStartMs + 2 * activeAttempt.beatDurationMs + noteSeconds * 1000;
          presentationListeningAt = presentationPlaybackEnd;
        } else {
          presentationListeningAt = 0;
          presentationPlaybackEnd = 0;
        }

        if (playMetronome) {
          let nextClick = startTime;
          const scheduleClicks = () => {
            while (nextClick < audio.currentTime - 0.01) nextClick += beatSeconds;
            while (nextClick < audio.currentTime + 0.15) {
              sound(nextClick, 1760, 0.06, 0.035, false, 'bell');
              nextClick += beatSeconds;
            }
          };
          scheduleClicks();
          metronomeTimer = setInterval(scheduleClicks, 50);
        }
      } catch (err) {
        presentationListeningAt = 0;
        presentationPlaybackEnd = 0;
        if (el('card-feedback')) el('card-feedback').textContent = `Audio unavailable (${err.message}); you can still play via MIDI.`;
      }
    }

    function recordPianoRollEvent(noteOn, pitch, velocity, channel) {
      if (!activeAttempt) return null;
      const timeMs = Math.max(0, (typeof performance !== 'undefined' ? performance.now() : 0) - rollStartedAt);
      const time = timeMs / 1000;
      const event = { type: noteOn ? 'noteOn' : 'noteOff', pitch, velocity, channel, timeMs };
      activeAttempt.midiEvents.push(event);

      const key = `${channel}:${pitch}`;
      if (noteOn) {
        const note = { pitch, start: time, end: null };
        rollNotes.push(note);
        if (!rollHeld.has(key)) rollHeld.set(key, []);
        rollHeld.get(key).push(note);
      } else {
        const held = rollHeld.get(key);
        if (held?.length) held.shift().end = time;
        if (held?.length === 0) rollHeld.delete(key);
      }

      drawPianoRoll();
      return event;
    }

    function handleMidiNote(noteOn, pitch, velocity, channel = 0) {
      const event = recordPianoRollEvent(noteOn, pitch, velocity, channel);
      if (!event || presentationComplete) return;

      if (noteOn) {
        if (pitch === targetPitches[presentationProgress]) {
          presentationProgress++;
          presentationMatchEvents.push(event);
        } else if (pitch === targetPitches[0]) {
          presentationProgress = 1;
          presentationMatchEvents = [event];
        } else {
          presentationProgress = 0;
          presentationMatchEvents = [];
        }

        updateCardVisuals();
        renderPerformanceMetrics();
        renderTimingDeviation();

        if (presentationProgress === targetPitches.length) {
          presentationComplete = true;
          activeAttempt.completedAtMs = event.timeMs;
          activeAttempt.matchedMidiEvents = [...presentationMatchEvents];

          const noteOns = activeAttempt.midiEvents.filter(e => e.type === 'noteOn');
          const extraNotes = Math.max(0, noteOns.length - targetPitches.length);
          const isFirstTry = extraNotes === 0;
          const rewardMagnitude = isFirstTry ? 1.0 : 0.5;

          const sessionState = coordinator ? coordinator.session.getState() : null;
          const targetIndex = sessionState ? sessionState.selectedIndex : 0;
          let rewardResult = null;
          if (coordinator && targetIndex >= 0 && !coordinator.isPaused() && !coordinator.isComplete()) {
            coordinator.advanceTo(coordinator.getTime());
            coordinator.recordObservation();
            const result = coordinator.session.applyReward(targetIndex, rewardMagnitude);
            if (result) {
              rewardResult = result;
              coordinator.setWordFlash(targetIndex, 1);
              totalLifts++;
              coordinator.setLastMeasurement({
                kind: 'reward',
                index: targetIndex,
                rewardMagnitude,
                lift: result.lift,
                kickTime: result.kickTime
              });
              coordinator.setKickGraphEnded(true);
              coordinator.acceptTransition(result);
              coordinator.recordObservation();
              coordinator.updateReadouts();
              coordinator.render(0);
              coordinator.checkCompletion();
            }
          }

          playCompletionChime();

          musicalView?.showRewardFeedback({
            isFirstTry,
            extraNotes,
            targetIndex,
            rewardResult
          });
          musicalView?.renderAllDiagnostics({
            activeAttempt,
            presentationProgress,
            presentationComplete,
            presentationMatchEvents
          });

          if (typeof setTimeout === 'function') {
            attemptResetTimer = setTimeout(() => {
              if (coordinator && !coordinator.isPaused() && !coordinator.isComplete()) {
                initAttempt();
                musicalView?.resetCardVisuals();
              }
            }, 1200);
          }
        }
      }

      renderNoteDuration();
    }

    async function connectMidi() {
      if (midiConnecting || typeof navigator === 'undefined') return;
      midiConnecting = true;
      if (el('device')) el('device').textContent = 'Requesting MIDI…';
      if (el('connect')) el('connect').disabled = true;

      if (!navigator.requestMIDIAccess) {
        if (el('device')) el('device').textContent = 'Web MIDI not supported (use keys 1, 2, 3)';
        if (el('connect')) el('connect').disabled = false;
        midiConnecting = false;
        return;
      }

      try {
        midiAccess = await navigator.requestMIDIAccess();
        midiAccess.onstatechange = updateMidiInputs;
        updateMidiInputs();
      } catch (error) {
        if (el('device')) el('device').textContent = `MIDI access failed: ${error.message || error.name}`;
      } finally {
        if (el('connect')) el('connect').disabled = false;
        midiConnecting = false;
      }
    }

    function updateMidiInputs() {
      if (!midiAccess) return;
      const inputs = Array.from(midiAccess.inputs.values());
      const select = el('inputs');
      if (select) {
        select.replaceChildren();
        inputs.forEach(input => {
          const opt = document.createElement('option');
          opt.value = input.id;
          opt.textContent = input.name || `MIDI Port ${input.id}`;
          select.appendChild(opt);
        });
        select.hidden = inputs.length <= 1;
      }

      if (inputs.length > 0 && !activeInput) {
        selectMidiInput(inputs[0].id);
      } else if (inputs.length === 0) {
        if (el('device')) el('device').textContent = 'No MIDI devices detected (use keys 1, 2, 3)';
        activeInput = null;
      }
    }

    function selectMidiInput(id) {
      if (!midiAccess) return;
      if (activeInput) activeInput.onmidimessage = null;
      activeInput = midiAccess.inputs.get(id);
      if (activeInput) {
        try {
          activeInput.onmidimessage = event => {
            const [status, pitch, velocity] = event.data;
            const command = status >> 4;
            const channel = status & 0x0f;
            if (command === 0x09 && velocity > 0) handleMidiNote(true, pitch, velocity, channel);
            else if (command === 0x08 || (command === 0x09 && velocity === 0)) handleMidiNote(false, pitch, velocity, channel);
          };
          if (el('device')) el('device').textContent = activeInput.name || 'Connected';
        } catch (err) {
          if (el('device')) el('device').textContent = `Input error: ${err.message}`;
        }
      }
    }

    async function copyAttemptJson() {
      if (!activeAttempt || typeof navigator === 'undefined' || !navigator.clipboard) return;
      try {
        const rounded = (key, val) => key.endsWith('Ms') && Number.isFinite(val) ? Math.round(val * 10) / 10 : val;
        await navigator.clipboard.writeText(JSON.stringify({ schemaVersion: 1, ...activeAttempt }, rounded, 2));
        if (el('json-status')) {
          el('json-status').textContent = 'JSON copied ✓';
          setTimeout(() => { if (el('json-status')) el('json-status').textContent = ''; }, 2500);
        }
      } catch (err) {
        if (el('json-status')) el('json-status').textContent = `Copy failed: ${err.message}`;
      }
    }

    function renderView(state, dt) {
      // Stationary musical card does not move with gravity
    }

    function reset() {
      stopAllAudio();
      musicalView?.resetCardVisuals();
      initAttempt();
    }

    function attach() {
      // Show musical elements
      const overlay = el('musical-card-overlay');
      if (overlay) overlay.style.display = '';
      const devPanel = el('dev-panel');
      if (devPanel) devPanel.style.display = '';
      const deviceReadout = el('device-readout');
      if (deviceReadout) deviceReadout.style.display = '';
      const connectBtn = el('connect');
      if (connectBtn) connectBtn.style.display = '';
      const playDemoBtn = el('play-demo');
      if (playDemoBtn) playDemoBtn.style.display = '';

      // Hide vocabulary prompt elements
      const kickGraph = el('kick-graph');
      if (kickGraph) kickGraph.style.display = 'none';
      const prompt = el('prompt');
      if (prompt) prompt.textContent = 'PLAY C4-D4-E4 = RETRIEVE / ESC = SKIP';

      // Attach UI click listeners
      el('play-demo')?.addEventListener('click', startDemoPlayback);
      el('card-demo-btn')?.addEventListener('click', startDemoPlayback);
      el('connect')?.addEventListener('click', connectMidi);
      el('inputs')?.addEventListener('change', e => selectMidiInput(e.target.value));
      el('copy-attempt-json')?.addEventListener('click', copyAttemptJson);
      el('roll-zoom')?.addEventListener('input', e => {
        rollZoomSeconds = Number(e.target.value);
        if (el('roll-zoom-value')) el('roll-zoom-value').textContent = `${rollZoomSeconds} s`;
        drawPianoRoll();
      });

      el('letter-0')?.addEventListener('click', () => handleMidiNote(true, 60, 90));
      el('letter-1')?.addEventListener('click', () => handleMidiNote(true, 62, 90));
      el('letter-2')?.addEventListener('click', () => handleMidiNote(true, 64, 90));

      // Keydown listener: ONLY 1, 2, 3, p/P, Escape.
      // ARBITRARY LETTERS ARE NOT HANDLED AND DO NOT TRIGGER RETRIEVAL!
      if (typeof document !== 'undefined') {
        keydownListener = event => {
          if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
          if (event.target?.matches?.('input, select, textarea')) return;
          if (event.key === '1') { event.preventDefault(); handleMidiNote(true, 60, 90); return; }
          if (event.key === '2') { event.preventDefault(); handleMidiNote(true, 62, 90); return; }
          if (event.key === '3') { event.preventDefault(); handleMidiNote(true, 64, 90); return; }
          if (event.key === 'p' || event.key === 'P') { event.preventDefault(); startDemoPlayback(); return; }
          if (event.key === 'Escape') {
            event.preventDefault();
            if (coordinator && !coordinator.isPaused() && !coordinator.isComplete()) {
              coordinator.session.skip();
            }
            return;
          }
          // Letters: explicitly ignored!
        };
        document.addEventListener('keydown', keydownListener);
      }

      initAttempt();
    }

    function detach() {
      stopAllAudio();
      if (keydownListener && typeof document !== 'undefined') {
        document.removeEventListener('keydown', keydownListener);
        keydownListener = null;
      }
    }

    return {
      name: 'music',
      targetPitches,
      getCardLabel,
      handleMidiNote,
      startDemoPlayback,
      stopAllAudio,
      initAttempt,
      render: renderView,
      reset,
      attach,
      detach
    };
  }

  return {
    createMusicalApp,
    targetPitches,
    noteName
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MusicalApp;
}
