import type { AttemptMidiEvent } from '../midi/attemptRecording';

type Voice = { gain: GainNode; oscillators: OscillatorNode[]; remaining: number };

// A short harmonic attack and decaying sustain, with one voice per channel and pitch.
export function createPianoSound(context: AudioContext) {
  const held = new Map<string, Voice>();
  const voices = new Set<Voice>();
  function release(voice: Voice, immediate = false) {
    const now = context.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, .0001), now);
    voice.gain.gain.setTargetAtTime(.0001, now, immediate ? .012 : .08);
    for (const oscillator of voice.oscillators) {
      try { oscillator.stop(now + (immediate ? .08 : .5)); } catch { /* Already stopped. */ }
    }
  }
  function handle(event: AttemptMidiEvent) {
    const key = `${event.channel}:${event.pitch}`;
    if (event.type === 'note-off') {
      const voice = held.get(key);
      if (voice) { held.delete(key); release(voice); }
      return;
    }
    if (context.state !== 'running') return;
    const previous = held.get(key);
    if (previous) { held.delete(key); release(previous, true); }
    const now = context.currentTime;
    const level = .08 * Math.max(1, Math.min(127, event.velocity)) / 127;
    const gain = context.createGain();
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(level, now + .01);
    gain.gain.exponentialRampToValueAtTime(level * .36, now + .2);
    gain.connect(context.destination);
    const voice: Voice = { gain, oscillators: [], remaining: 3 };
    const frequency = 440 * 2 ** ((event.pitch - 69) / 12);
    [1, .22, .07].forEach((strength, index) => {
      const oscillator = context.createOscillator();
      const partial = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency * (index + 1);
      partial.gain.value = strength;
      oscillator.connect(partial); partial.connect(gain);
      oscillator.onended = () => {
        oscillator.disconnect(); partial.disconnect();
        if (--voice.remaining === 0) { gain.disconnect(); voices.delete(voice); }
      };
      voice.oscillators.push(oscillator);
      oscillator.start(now);
    });
    voices.add(voice);
    held.set(key, voice);
  }
  function stopAll() {
    held.clear();
    for (const voice of voices) release(voice, true);
  }
  return { handle, stopAll };
}
