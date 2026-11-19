import { useCallback, useEffect, useRef, useState } from 'react';
import { createPhrasePlayer } from './phrasePlayer';
import { createPlaybackDelay } from './playbackDelay';

const phraseKey = 'piano-trainer.phrase-playback-enabled';
const metroKey = 'piano-trainer.metronome-enabled';
const tempoKey = 'piano-trainer.tempo-bpm';
const delayKey = 'piano-trainer.next-phrase-delay';
function storedDelay() { try { const raw = localStorage.getItem(delayKey); const value = raw === null ? 1.5 : Number(raw); return Number.isFinite(value) && value >= 0 && value <= 5 ? value : 1.5; } catch { return 1.5; } }
const phraseVolumeKey = 'piano-trainer.phrase-volume';
const metronomeVolumeKey = 'piano-trainer.metronome-volume';
function storedVolume(key: string, fallback: number) {
  try { const raw = localStorage.getItem(key); const value = raw === null ? fallback : Number(raw); return Number.isFinite(value) && value >= 0 && value <= 100 ? value : fallback; } catch { return fallback; }
}
function storedBoolean(key: string, fallback: boolean) {
  try { const value = localStorage.getItem(key); return value === null ? fallback : value === 'true'; } catch { return fallback; }
}
function storedTempo() {
  try { const raw = localStorage.getItem(tempoKey); const value = raw === null ? 90 : Number(raw); return Number.isFinite(value) && value >= 30 && value <= 240 ? value : 90; } catch { return 90; }
}
function errorDetail(error: unknown) { return error instanceof Error ? `${error.name}: ${error.message}` : String(error); }
function save(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* Keep the session setting. */ } }

export function usePhrasePlayback() {
  const [enabled, setEnabledState] = useState(() => storedBoolean(phraseKey, storedBoolean('piano-trainer.sound-enabled', true)));
  const [metronome, setMetronomeState] = useState(() => storedBoolean(metroKey, false));
  const [tempo, setTempoState] = useState(storedTempo);
  const [delay, setDelayState] = useState(storedDelay);
  const [phraseVolume, setPhraseVolumeState] = useState(() => storedVolume(phraseVolumeKey, 80));
  const [metronomeVolume, setMetronomeVolumeState] = useState(() => storedVolume(metronomeVolumeKey, 70));
  const [audioError, setAudioError] = useState('');
  const settings = useRef({ enabled, metronome, tempo, phraseVolume, metronomeVolume });
  const context = useRef<AudioContext | null>(null);
  const player = useRef<ReturnType<typeof createPhrasePlayer> | null>(null);
  const exercise = useRef<readonly number[] | null>(null);
  const pending = useRef(false);
  const resumeAttempt = useRef(0);
  const paused = useRef(false);
  const resumePending = useRef(false);
  const delayValue = useRef(delay);
  const playCurrent = useCallback(() => {
    if (paused.current || !exercise.current || (!settings.current.enabled && !settings.current.metronome)) return;
    const audio = context.current;
    if (!audio || audio.state !== 'running') {
      pending.current = true;
      setAudioError(audio?.state === 'closed' ? 'Audio context is closed. Select Replay Phrase to reconnect.' : 'Audio context is suspended. Interact with the page to enable audio.');
      return;
    }
    pending.current = false;
    try {
      if (!player.current) throw new Error('Audio player is unavailable');
      if (!player.current.play(exercise.current, settings.current.tempo, settings.current.enabled, settings.current.metronome)) throw new Error('Audio context is not running');
      setAudioError('');
    } catch (error) {
      player.current?.stop();
      setAudioError(`Audio playback failed: ${errorDetail(error)}`);
    }
  }, []);
  const delayTimer = useRef(createPlaybackDelay(() => playCurrent()));
  const activate = useCallback(() => {
    if (paused.current || (!settings.current.enabled && !settings.current.metronome)) return;
    try {
      const AudioClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioClass) { setAudioError('Web Audio is unavailable in this browser.'); return; }
      if (context.current?.state === 'closed') {
        player.current?.dispose(); player.current = null; context.current = null;
      }
      if (!context.current) {
        const audio = new AudioClass();
        try {
          const nextPlayer = createPhrasePlayer(audio);
          nextPlayer.setVolumes(settings.current.phraseVolume, settings.current.metronomeVolume);
          context.current = audio; player.current = nextPlayer;
        } catch (error) {
          void audio.close().catch(() => {});
          throw error;
        }
      }
      const audio = context.current;
      if (audio.state === 'running') { if (pending.current) playCurrent(); else setAudioError(''); return; }
      // Some browsers leave resume() pending until another user activation. Each
      // gesture may retry; a single pending playback is consumed at most once.
      const attempt = ++resumeAttempt.current;
      setAudioError('Audio context is suspended. Select Replay Phrase to retry.');
      void audio.resume().then(() => {
        if (context.current !== audio) return;
        if (audio.state === 'running') { if (pending.current) playCurrent(); else setAudioError(''); }
        else if (attempt === resumeAttempt.current) setAudioError(`Audio context remains ${audio.state}. Select Replay Phrase to retry.`);
      }).catch((error: unknown) => {
        if (context.current !== audio || attempt !== resumeAttempt.current || audio.state === 'running') return;
        pending.current = false;
        setAudioError(`Audio resume was rejected: ${errorDetail(error)}. Select Replay Phrase to retry.`);
      });
    } catch (error) {
      pending.current = false;
      setAudioError(`Audio initialization failed: ${errorDetail(error)}. Select Replay Phrase to retry.`);
    }
  }, [playCurrent]);
  const stop = useCallback(() => { delayTimer.current.reset(); paused.current = false; resumePending.current = false; pending.current = false; exercise.current = null; player.current?.stop(); }, []);
  const setExercise = useCallback((notes: readonly number[] | null, delayed = false) => {
    player.current?.stop();
    exercise.current = notes;
    resumePending.current = false;
    pending.current = false;
    delayTimer.current.cancel();
    if (notes) { if (delayed) delayTimer.current.schedule(delayValue.current * 1000); else playCurrent(); }
  }, [playCurrent]);
  const replay = useCallback(() => { if (!paused.current && settings.current.enabled && exercise.current) { delayTimer.current.cancel(); pending.current = true; activate(); } }, [activate]);
  const setPaused = useCallback((value: boolean) => {
    paused.current = value;
    if (value) { delayTimer.current.pause(); resumePending.current = pending.current; pending.current = false; player.current?.stop(); }
    else { delayTimer.current.resume(); if (resumePending.current) { resumePending.current = false; pending.current = true; activate(); } }
  }, [activate]);
  const setDelay = useCallback((value: number) => { if (value >= 0 && value <= 5 && Number.isFinite(value)) { delayValue.current = value; setDelayState(value); save(delayKey, String(value)); } }, []);
  const setEnabled = useCallback((value: boolean) => {
    settings.current.enabled = value; setEnabledState(value); save(phraseKey, String(value));
    if (value) { if (!paused.current && !delayTimer.current.isPending()) { pending.current = !!exercise.current; activate(); } }
    else { player.current?.stopPhrase(); pending.current = settings.current.metronome && !!exercise.current && context.current?.state !== 'running'; if (!settings.current.metronome) { player.current?.stop(); setAudioError(''); } }
  }, [activate, playCurrent]);
  const setMetronome = useCallback((value: boolean) => {
    settings.current.metronome = value; setMetronomeState(value); save(metroKey, String(value));
    if (value && exercise.current && !paused.current && !delayTimer.current.isPending()) {
      if (context.current?.state === 'running') player.current?.setMetronome(true);
      else { pending.current = !!exercise.current; activate(); }
    } else if (!value) { player.current?.setMetronome(false); if (!settings.current.enabled) { pending.current = false; setAudioError(''); } }
  }, [activate]);
  const setTempo = useCallback((value: number) => {
    if (!Number.isInteger(value) || value < 30 || value > 240) return;
    settings.current.tempo = value; setTempoState(value); save(tempoKey, String(value));
    player.current?.setTempo(value);
  }, []);
  const setVolume = useCallback((kind: 'phraseVolume' | 'metronomeVolume', value: number) => {
    if (!Number.isFinite(value) || value < 0 || value > 100) return;
    settings.current[kind] = value;
    if (kind === 'phraseVolume') { setPhraseVolumeState(value); save(phraseVolumeKey, String(value)); }
    else { setMetronomeVolumeState(value); save(metronomeVolumeKey, String(value)); }
    player.current?.setVolumes(settings.current.phraseVolume, settings.current.metronomeVolume);
  }, []);
  useEffect(() => {
    const unlock = (event?: Event) => {
      if (event && event.target instanceof Element && event.target.closest('[data-audio-replay]')) return;
      activate();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  }, [activate]);
  useEffect(() => () => {
    stop();
    player.current?.dispose();
    const audio = context.current; context.current = null; player.current = null; ++resumeAttempt.current;
    if (audio && audio.state !== 'closed') void audio.close().catch(() => {});
  }, [stop]);
  return { delay, setDelay, setPaused, enabled, setEnabled, metronome, setMetronome, tempo, setTempo, phraseVolume, metronomeVolume, setVolume, audioError, replay, setExercise, stop };
}
