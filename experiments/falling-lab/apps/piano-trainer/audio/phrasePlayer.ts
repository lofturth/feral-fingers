type Timer = ReturnType<typeof setTimeout>;

// Schedule audio against the audio clock, never the learning-session clock.
export function createPhrasePlayer(context: AudioContext, timers = {
  setTimeout: (callback: () => void, delay: number) => globalThis.setTimeout(callback, delay),
  clearTimeout: (id: Timer) => globalThis.clearTimeout(id)
}) {
  const phraseGain = context.createGain(), clickGain = context.createGain();
  phraseGain.gain.value = .8; clickGain.gain.value = .7;
  phraseGain.connect(context.destination); clickGain.connect(context.destination);
  const notes = new Set<OscillatorNode>();
  const clicks = new Set<OscillatorNode>();
  let timer: Timer | null = null;
  let beat = 60 / 90;
  let origin = 0;
  let nextClick = 0;
  let clickEnabled = false;
  let clickGeneration = 0;

  function stopNodes(nodes: Set<OscillatorNode>) {
    for (const node of nodes) {
      try { node.stop(context.currentTime); } catch { /* Already stopped. */ }
      node.disconnect();
    }
    nodes.clear();
  }
  function stopClicks() {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
    clickEnabled = false;
    clickGeneration++;
    stopNodes(clicks);
  }
  function stop() { stopNodes(notes); stopClicks(); origin = 0; }
  function voice(frequency: number, when: number, duration: number, volume: number, nodes: Set<OscillatorNode>) {
    const osc = context.createOscillator(), gain = context.createGain();
    osc.type = 'sine';
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(.0001, when);
    gain.gain.exponentialRampToValueAtTime(volume, when + .005);
    gain.gain.exponentialRampToValueAtTime(.0001, when + duration);
    osc.connect(gain); gain.connect(nodes === notes ? phraseGain : clickGain);
    nodes.add(osc);
    osc.onended = () => { nodes.delete(osc); osc.disconnect(); gain.disconnect(); };
    osc.start(when);
    osc.stop(when + duration + .01);
  }
  function scheduleClicks(generation: number) {
    if (!clickEnabled || generation !== clickGeneration || context.state !== 'running') return;
    while (nextClick < context.currentTime + .12) {
      voice(1600, nextClick, .045, .025, clicks);
      nextClick += beat;
    }
    timer = timers.setTimeout(() => scheduleClicks(generation), 25);
  }
  function setMetronome(enabled: boolean) {
    stopClicks();
    if (!enabled || context.state !== 'running') return;
    if (!origin) origin = context.currentTime + .03;
    nextClick = origin + Math.max(0, Math.ceil((context.currentTime + .015 - origin) / beat)) * beat;
    clickEnabled = true;
    scheduleClicks(clickGeneration);
  }
  function play(pitches: readonly number[], bpm: number, playNotes: boolean, metronome: boolean, notesPerBeat = 1) {
    stop();
    if (context.state !== 'running') return false;
    beat = 60 / bpm;
    origin = context.currentTime + .03;
    const noteInterval = beat / notesPerBeat;
    if (playNotes) pitches.forEach((pitch, i) => {
      const frequency = 440 * 2 ** ((pitch - 69) / 12);
      [1, .22, .07].forEach((strength, harmonic) => voice(frequency * (harmonic + 1), origin + i * noteInterval, Math.min(.45, noteInterval * .8), .22 * strength, notes));
    });
    setMetronome(metronome);
    return true;
  }
  function stopPhrase() { stopNodes(notes); }
  function setTempo(bpm: number) { beat = 60 / bpm; if (clickEnabled) setMetronome(true); }
  function setVolumes(phrase: number, metronome: number) {
    phraseGain.gain.setValueAtTime(phrase / 100, context.currentTime);
    clickGain.gain.setValueAtTime(metronome / 100, context.currentTime);
  }
  function dispose() { stop(); phraseGain.disconnect(); clickGain.disconnect(); }
  return { play, stop, stopPhrase, setMetronome, setTempo, setVolumes, dispose };
}
