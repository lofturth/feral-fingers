type Timer = ReturnType<typeof setTimeout>;

// Schedule audio against the audio clock, never the learning-session clock.
export function createPhrasePlayer(context: AudioContext, timers = { setTimeout, clearTimeout }) {
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
    osc.connect(gain); gain.connect(context.destination);
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
  function play(pitches: readonly number[], bpm: number, playNotes: boolean, metronome: boolean) {
    stop();
    if (context.state !== 'running') return false;
    beat = 60 / bpm;
    origin = context.currentTime + .03;
    if (playNotes) pitches.forEach((pitch, i) => {
      const frequency = 440 * 2 ** ((pitch - 69) / 12);
      [1, .22, .07].forEach((strength, harmonic) => voice(frequency * (harmonic + 1), origin + i * beat, Math.min(.45, beat * .8), .07 * strength, notes));
    });
    setMetronome(metronome);
    return true;
  }
  function stopPhrase() { stopNodes(notes); }
  return { play, stop, stopPhrase, setMetronome };
}
