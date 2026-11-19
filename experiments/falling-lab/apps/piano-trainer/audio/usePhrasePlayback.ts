import { useCallback, useEffect, useRef, useState } from 'react';
import { createPhrasePlayer } from './phrasePlayer';

const phraseKey = 'piano-trainer.phrase-playback-enabled';
const metroKey = 'piano-trainer.metronome-enabled';
const tempoKey = 'piano-trainer.tempo-bpm';
function storedBoolean(key: string, fallback: boolean) {
  try { const value = localStorage.getItem(key); return value === null ? fallback : value === 'true'; } catch { return fallback; }
}
function storedTempo() {
  try { const raw = localStorage.getItem(tempoKey); const value = raw === null ? 90 : Number(raw); return Number.isFinite(value) && value >= 30 && value <= 240 ? value : 90; } catch { return 90; }
}
function save(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* Keep the session setting. */ } }

export function usePhrasePlayback() {
  const [enabled, setEnabledState] = useState(() => storedBoolean(phraseKey, storedBoolean('piano-trainer.sound-enabled', true)));
  const [metronome, setMetronomeState] = useState(() => storedBoolean(metroKey, false));
  const [tempo, setTempoState] = useState(storedTempo);
  const [audioError, setAudioError] = useState('');
  const settings = useRef({ enabled, metronome, tempo });
  const context = useRef<AudioContext | null>(null);
  const player = useRef<ReturnType<typeof createPhrasePlayer> | null>(null);
  const exercise = useRef<readonly number[] | null>(null);
  const pending = useRef(false);
  const playCurrent = useCallback(() => {
    if (!exercise.current || (!settings.current.enabled && !settings.current.metronome)) return;
    if (!context.current || context.current.state !== 'running') { pending.current = true; setAudioError('Interact with the page to enable audio.'); return; }
    try { player.current?.play(exercise.current, settings.current.tempo, settings.current.enabled, settings.current.metronome); pending.current = false; setAudioError(''); }
    catch { setAudioError('Audio could not be played.'); }
  }, []);
  const activate = useCallback(() => {
    if (!settings.current.enabled && !settings.current.metronome) return;
    try {
      const AudioClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioClass) { setAudioError('Web Audio is unavailable.'); return; }
      if (!context.current) { context.current = new AudioClass(); player.current = createPhrasePlayer(context.current); }
      const audio = context.current;
      if (audio.state === 'suspended') {
        void audio.resume().then(() => { if (pending.current && audio.state === 'running') playCurrent(); }).catch(() => setAudioError('Interact with the page to enable audio.'));
      } else if (pending.current && audio.state === 'running') playCurrent();
    } catch { setAudioError('Audio could not be started.'); }
  }, [playCurrent]);
  const stop = useCallback(() => { pending.current = false; exercise.current = null; player.current?.stop(); }, []);
  const setExercise = useCallback((notes: readonly number[] | null) => {
    player.current?.stop();
    exercise.current = notes;
    pending.current = false;
    if (notes) playCurrent();
  }, [playCurrent]);
  const replay = useCallback(() => { if (settings.current.enabled && exercise.current) { pending.current = true; activate(); } }, [activate]);
  const setEnabled = useCallback((value: boolean) => {
    settings.current.enabled = value; setEnabledState(value); save(phraseKey, String(value));
    if (value) { pending.current = !!exercise.current; activate(); }
    else { player.current?.stopPhrase(); pending.current = settings.current.metronome && !!exercise.current && context.current?.state !== 'running'; if (!settings.current.metronome) { player.current?.stop(); setAudioError(''); } }
  }, [activate, playCurrent]);
  const setMetronome = useCallback((value: boolean) => {
    settings.current.metronome = value; setMetronomeState(value); save(metroKey, String(value));
    if (value && exercise.current) {
      if (context.current?.state === 'running') player.current?.setMetronome(true);
      else { pending.current = !!exercise.current; activate(); }
    } else if (!value) { player.current?.setMetronome(false); if (!settings.current.enabled) { pending.current = false; setAudioError(''); } }
  }, [activate]);
  const setTempo = useCallback((value: number) => {
    if (!Number.isInteger(value) || value < 30 || value > 240) return;
    settings.current.tempo = value; setTempoState(value); save(tempoKey, String(value));
    playCurrent();
  }, [playCurrent]);
  useEffect(() => {
    window.addEventListener('pointerdown', activate);
    window.addEventListener('keydown', activate);
    return () => { window.removeEventListener('pointerdown', activate); window.removeEventListener('keydown', activate); };
  }, [activate]);
  useEffect(() => () => {
    stop();
    if (context.current && context.current.state !== 'closed') void context.current.close().catch(() => {});
  }, [stop]);
  return { enabled, setEnabled, metronome, setMetronome, tempo, setTempo, audioError, replay, setExercise, stop };
}
