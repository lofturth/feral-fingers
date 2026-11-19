import { useCallback, useEffect, useRef, useState } from 'react';
import type { AttemptMidiEvent } from '../midi/attemptRecording';
import { createPianoSound } from './pianoSound';

const preferenceKey = 'piano-trainer.sound-enabled';
export function usePianoSound() {
  const [enabled, setEnabledState] = useState(() => {
    try { return localStorage.getItem(preferenceKey) === 'true'; } catch { return false; }
  });
  const enabledRef = useRef(enabled);
  const context = useRef<AudioContext | null>(null);
  const piano = useRef<ReturnType<typeof createPianoSound> | null>(null);
  const [audioError, setAudioError] = useState('');
  const activate = useCallback(() => {
    if (!enabledRef.current) return;
    try {
      const AudioClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioClass) { setAudioError('Web Audio is unavailable.'); return; }
      if (!context.current) { context.current = new AudioClass(); piano.current = createPianoSound(context.current); }
      if (context.current.state === 'suspended') void context.current.resume().catch(() => setAudioError('Interact with the page to enable sound.'));
      setAudioError('');
    } catch { setAudioError('Audio could not be started.'); }
  }, []);
  const stopAll = useCallback(() => { try { piano.current?.stopAll(); } catch { /* Audio must not interrupt practice. */ } }, []);
  const setEnabled = useCallback((value: boolean) => {
    enabledRef.current = value;
    setEnabledState(value);
    try { localStorage.setItem(preferenceKey, String(value)); } catch { /* Keep this session's preference. */ }
    if (value) activate(); else { stopAll(); setAudioError(''); }
  }, [activate, stopAll]);
  const onMidiEvent = useCallback((event: AttemptMidiEvent) => {
    if (!enabledRef.current) return;
    try { piano.current?.handle(event); } catch { /* Audio must not interrupt practice. */ }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    window.addEventListener('pointerdown', activate);
    window.addEventListener('keydown', activate);
    return () => { window.removeEventListener('pointerdown', activate); window.removeEventListener('keydown', activate); };
  }, [enabled, activate]);
  useEffect(() => () => {
    stopAll();
    if (context.current && context.current.state !== 'closed') void context.current.close().catch(() => {});
  }, [stopAll]);
  return { enabled, setEnabled, onMidiEvent, stopAll, audioError };
}
