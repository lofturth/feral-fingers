import { useEffect, useRef, useState } from 'react';
import { PianoCard } from './PianoCard';
import { createPhraseAttempt } from './phraseAttempt';
import { createReplayControl } from './replayControl';
import { noteName, useMidi } from '../midi/useMidi';
import type { PianoExercise } from '../deck';
import { createAttemptDiagnostics } from '../attemptDiagnostics';
import type { LogEvent } from '../eventLog';
import type { SessionRecorder } from '../sessionRecorder';

type PracticeOptions = {
  recorder: SessionRecorder;
  startRecording: (timestamp: number) => boolean;
  selectedId: string;
  getSelectedId: () => string | null;
  getExercise: (id: string) => PianoExercise | undefined;
  onComplete: (id: string, score: 50 | 100, time: number, attemptId: number) => void;
  onSkip: (id: string, time: number, attemptId: number) => void;
  onLog: LogEvent;
  nextAttemptId: () => number;
  replay: () => void;
  togglePause: () => void;
};

// Mounted once per session, so switching cards does not create MIDI connections.
export function usePianoPractice({ recorder, startRecording, selectedId, getSelectedId, getExercise, onComplete, onSkip, onLog, nextAttemptId, replay, togglePause }: PracticeOptions) {
  const recordedAttempt = useRef<{ id: string; attemptId: number } | null>(null);
  function endRecordedAttempt(timestamp: number, reason: 'completed' | 'skipped' | 'interrupted') {
    const current = recordedAttempt.current;
    if (current) recorder.record({ type: 'attempt-end', timestamp, exerciseId: current.id, attemptId: current.attemptId, reason });
    recordedAttempt.current = null;
  }
  function startRecordedAttempt(id: string, attemptId: number, timestamp: number) {
    if (recordedAttempt.current?.id === id && recordedAttempt.current.attemptId === attemptId) return;
    endRecordedAttempt(timestamp, 'interrupted');
    recordedAttempt.current = { id, attemptId };
    recorder.record({ type: 'attempt-start', timestamp, exerciseId: id, attemptId });
  }
  const attempt = useRef<{ id: string; phrase: ReturnType<typeof createPhraseAttempt> } | null>(null);
  const diagnostic = useRef(createAttemptDiagnostics(onLog, nextAttemptId));
  const [result, setResult] = useState<{ id: string; score: 50 | 100 } | null>(null);
  const pauseRef = useRef(togglePause);
  pauseRef.current = togglePause;
  const replayRef = useRef(replay);
  replayRef.current = replay;
  const replayControl = useRef(createReplayControl(() => replayRef.current(), () => pauseRef.current()));
  const midi = useMidi(event => {
    if (replayControl.current.handle(event)) {
      onLog({ timestamp: event.timestamp, type: `MIDI ${event.type}`, detail: `pitch ${event.pitch} (control); velocity ${event.velocity}; channel ${event.channel}; input ${event.device.name} [${event.device.id}]` });
      return;
    }
    const id = getSelectedId();
    const selected = id && getExercise(id);
    const attemptId = diagnostic.current.midi(event, selected || null);
    if (event.type !== 'note-on' || !id || !selected) return;
    if (attemptId !== null) startRecordedAttempt(id, attemptId, event.timestamp);
    if (attempt.current?.id !== id) attempt.current = { id, phrase: createPhraseAttempt(selected.notes) };
    setResult(null);
    const score = attempt.current.phrase.note(event.pitch);
    if (score !== null && attemptId !== null) {
      diagnostic.current.complete(selected, score, event.timestamp);
      recorder.record({ type: 'result', timestamp: event.timestamp, exerciseId: id, attemptId, score });
      endRecordedAttempt(event.timestamp, 'completed');
      setResult({ id, score });
      onComplete(id, score, event.timestamp, attemptId);
    }
  }, () => replayControl.current.reset(), (data, timestamp, device) => {
    const firstNote = data.length >= 3 && (data[0] & 0xf0) === 0x90 && data[2] > 0 && startRecording(timestamp);
    recorder.record({ type: 'midi', timestamp, data, device });
    if (firstNote) recorder.record({ type: 'selection', timestamp, previous: null, next: getSelectedId(), cause: 'session start' });
  });
  useEffect(() => {
    const now = performance.now();
    diagnostic.current.selectionChanged(selectedId, now);
    if (recordedAttempt.current && recordedAttempt.current.id !== selectedId) endRecordedAttempt(now, 'interrupted');
    if (attempt.current && attempt.current.id !== selectedId) attempt.current = null;
  }, [selectedId]);
  useEffect(() => () => endRecordedAttempt(performance.now(), 'interrupted'), []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat) return;
      const id = getSelectedId();
      const selected = id && getExercise(id);
      if (!id || !selected) return;
      const attemptId = diagnostic.current.skip(selected, event.timeStamp);
      startRecordedAttempt(id, attemptId, event.timeStamp);
      endRecordedAttempt(event.timeStamp, 'skipped');
      attempt.current = null;
      setResult(null);
      onSkip(id, event.timeStamp, attemptId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [getSelectedId, getExercise, onSkip, onLog, nextAttemptId]);
  function resetAttempt() { attempt.current = null; const now = performance.now(); diagnostic.current.reset(now); endRecordedAttempt(now, 'interrupted'); setResult(null); }
  return { ...midi, result, resetAttempt };
}

type CardProps = { exercise: PianoExercise; active: boolean; paused: boolean; practice: ReturnType<typeof usePianoPractice>; replay: () => void; playbackEnabled: boolean };
export function TrainerPianoCard({ exercise, active, paused, practice, replay, playbackEnabled }: CardProps) {
  const score = practice.result?.id === exercise.id ? practice.result.score : null;
  return <div className="trainer-card">
    <PianoCard title={exercise.label} notes={exercise.notes.map(noteName)} heldNotes={practice.heldNotes}/>
    <p>{paused ? 'Paused.' : !active ? 'Session complete.' : score === null ? 'Press Esc to finish an incomplete attempt.' : `Result: ${score}%`}</p>
    <div><span>{practice.status}</span> <button type="button" onClick={practice.connect}>Connect MIDI</button> <button type="button" data-audio-replay onClick={replay} disabled={!playbackEnabled || !active}>Replay Phrase</button></div>
  </div>;
}
