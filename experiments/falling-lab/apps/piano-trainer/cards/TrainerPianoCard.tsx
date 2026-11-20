import { useEffect, useRef, useState } from 'react';
import { PianoCard } from './PianoCard';
import { createPhraseAttempt } from './phraseAttempt';
import { createReplayControl } from './replayControl';
import { noteName, useMidi } from '../midi/useMidi';
import type { PianoExercise } from '../deck';
import { createAttemptDiagnostics } from '../attemptDiagnostics';
import type { LogEvent } from '../eventLog';
import type { SessionRecorder } from '../sessionRecorder';
import { measureFluency, type DemonstrationTiming } from '../fluency';
import { attemptColor, type AttemptColor } from '../visualFluency';
import type { GravityHistoryEntry } from '../gravityHistory';

type PracticeOptions = {
  recorder: SessionRecorder;
  startRecording: (timestamp: number) => boolean;
  getTiming: () => { tempo: number; notesPerBeat: 1 | 2 | 4 };
  getDemonstrationTiming: (id: string) => DemonstrationTiming | null;
  selectedId: string;
  getSelectedId: () => string | null;
  getExercise: (id: string) => PianoExercise | undefined;
  onComplete: (id: string, score: 50 | 100, time: number, attemptId: number, fluent: boolean | null) => void;
  onSkip: (id: string, time: number, attemptId: number) => void;
  onLog: LogEvent;
  nextAttemptId: () => number;
  replay: () => void;
  togglePause: () => void;
};

// Mounted once per session, so switching cards does not create MIDI connections.
export function usePianoPractice({ recorder, startRecording, getTiming, getDemonstrationTiming, selectedId, getSelectedId, getExercise, onComplete, onSkip, onLog, nextAttemptId, replay, togglePause }: PracticeOptions) {
  const recordedAttempt = useRef<{ id: string; attemptId: number; expected: readonly number[]; played: { pitch: number; timestamp: number }[]; demonstration: DemonstrationTiming | null; color: AttemptColor } | null>(null);
  const [feedback, setFeedback] = useState<{ id: string; color: AttemptColor } | null>(null);
  const [flash, setFlash] = useState<{ id: string; color: AttemptColor; sequence: number } | null>(null);
  const flashSequence = useRef(0);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function endRecordedAttempt(timestamp: number, reason: 'completed' | 'skipped' | 'interrupted') {
    const current = recordedAttempt.current;
    if (current) {
      const measurements = measureFluency(current.expected, current.played, current.demonstration, reason === 'completed');
      recorder.record({ type: 'fluency', timestamp, exerciseId: current.id, attemptId: current.attemptId, demonstrationTempo: current.demonstration?.tempo ?? null, demonstrationNotesPerBeat: current.demonstration?.notesPerBeat ?? null, ...measurements });
      recorder.record({ type: 'attempt-end', timestamp, exerciseId: current.id, attemptId: current.attemptId, reason });
      recordedAttempt.current = null;
      setFeedback(null);
      return measurements.fluent;
    }
    recordedAttempt.current = null;
    return null;
  }
  function startRecordedAttempt(id: string, attemptId: number, timestamp: number) {
    if (recordedAttempt.current?.id === id && recordedAttempt.current.attemptId === attemptId) return;
    endRecordedAttempt(timestamp, 'interrupted');
    recordedAttempt.current = { id, attemptId, expected: getExercise(id)?.notes ?? [], played: [], demonstration: getDemonstrationTiming(id), color: 'blue' };
    recorder.record({ type: 'attempt-start', timestamp, exerciseId: id, attemptId, ...getTiming() });
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
    if (attemptId !== null) {
      startRecordedAttempt(id, attemptId, event.timestamp);
      const current = recordedAttempt.current;
      if (current) {
        current.played.push({ pitch: event.pitch, timestamp: event.timestamp });
        current.color = attemptColor(current.color, current.expected, current.played, current.demonstration, event.timestamp);
        setFeedback({ id, color: current.color });
      }
    }
    if (attempt.current?.id !== id) attempt.current = { id, phrase: createPhraseAttempt(selected.notes) };
    setResult(null);
    const score = attempt.current.phrase.note(event.pitch);
    if (score !== null && attemptId !== null) {
      diagnostic.current.complete(selected, score, event.timestamp);
      recorder.record({ type: 'result', timestamp: event.timestamp, exerciseId: id, attemptId, score });
      const color = recordedAttempt.current?.color;
      const fluent = endRecordedAttempt(event.timestamp, 'completed');
      if (color) {
        if (flashTimer.current !== null) clearTimeout(flashTimer.current);
        setFlash({ id, color, sequence: ++flashSequence.current });
        flashTimer.current = setTimeout(() => { setFlash(null); flashTimer.current = null; }, 150);
      }
      setResult({ id, score });
      onComplete(id, score, event.timestamp, attemptId, fluent);
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
  useEffect(() => {
    if (!feedback || feedback.color !== 'blue') return;
    const timer = setInterval(() => {
      const current = recordedAttempt.current;
      if (!current) return;
      const color = attemptColor(current.color, current.expected, current.played, current.demonstration, performance.now());
      if (color !== current.color) { current.color = color; setFeedback({ id: current.id, color }); }
    }, 50);
    return () => clearInterval(timer);
  }, [feedback]);
  useEffect(() => () => { endRecordedAttempt(performance.now(), 'interrupted'); if (flashTimer.current !== null) clearTimeout(flashTimer.current); }, []);
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
  return { ...midi, result, resetAttempt, feedback, flash };
}

type CardProps = { exercise: PianoExercise; gravity: number; history: readonly GravityHistoryEntry[]; practice: ReturnType<typeof usePianoPractice> };
export function TrainerPianoCard({ exercise, gravity, history, practice }: CardProps) {
  const historyRef = useRef<HTMLSpanElement>(null);
  useEffect(() => { if (historyRef.current) historyRef.current.scrollLeft = historyRef.current.scrollWidth; }, [history]);
  return <div className="trainer-card">
    <PianoCard title={exercise.label} notes={exercise.notes.map(noteName)} heldNotes={practice.heldNotes} showStatus={false} headerDetail={<span className="trainer-gravity-group"><span ref={historyRef} className="trainer-gravity-history" aria-label="Gravity history, oldest to newest">{history.map((entry, index) => <span key={index} data-direction={entry.direction}>{entry.value.toFixed(2)}×</span>)}</span><span className="trainer-gravity" aria-label={`Gravity ${gravity.toFixed(2)} times`}>{gravity.toFixed(2)}×</span></span>}/>
  </div>;
}
