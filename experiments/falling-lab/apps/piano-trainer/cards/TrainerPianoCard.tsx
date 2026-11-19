import { useEffect, useRef, useState } from 'react';
import { PianoCard } from './PianoCard';
import { createPhraseAttempt } from './phraseAttempt';
import { noteName, useMidi } from '../midi/useMidi';
import type { PianoExercise } from '../deck';
import { createAttemptDiagnostics } from '../attemptDiagnostics';
import type { LogEvent } from '../eventLog';

type PracticeOptions = {
  selectedId: string;
  getSelectedId: () => string | null;
  getExercise: (id: string) => PianoExercise | undefined;
  onComplete: (id: string, score: 50 | 100, time: number, attemptId: number) => void;
  onSkip: (id: string, time: number, attemptId: number) => void;
  onLog: LogEvent;
  nextAttemptId: () => number;
};

// Mounted once per session, so switching cards does not create MIDI connections.
export function usePianoPractice({ selectedId, getSelectedId, getExercise, onComplete, onSkip, onLog, nextAttemptId }: PracticeOptions) {
  const attempt = useRef<{ id: string; phrase: ReturnType<typeof createPhraseAttempt> } | null>(null);
  const diagnostic = useRef(createAttemptDiagnostics(onLog, nextAttemptId));
  const [result, setResult] = useState<{ id: string; score: 50 | 100 } | null>(null);
  const midi = useMidi(event => {
    const id = getSelectedId();
    const selected = id && getExercise(id);
    const attemptId = diagnostic.current.midi(event, selected || null);
    if (event.type !== 'note-on' || !id || !selected) return;
    if (attempt.current?.id !== id) attempt.current = { id, phrase: createPhraseAttempt(selected.notes) };
    setResult(null);
    const score = attempt.current.phrase.note(event.pitch);
    if (score !== null && attemptId !== null) {
      diagnostic.current.complete(selected, score, event.timestamp);
      setResult({ id, score });
      onComplete(id, score, event.timestamp, attemptId);
    }
  });
  useEffect(() => {
    diagnostic.current.selectionChanged(selectedId, performance.now());
    if (attempt.current && attempt.current.id !== selectedId) attempt.current = null;
  }, [selectedId]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat) return;
      const id = getSelectedId();
      const selected = id && getExercise(id);
      if (!id || !selected) return;
      const attemptId = diagnostic.current.skip(selected, event.timeStamp);
      attempt.current = null;
      setResult(null);
      onSkip(id, event.timeStamp, attemptId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [getSelectedId, getExercise, onSkip, onLog, nextAttemptId]);
  return { ...midi, result };
}

type CardProps = { exercise: PianoExercise; active: boolean; practice: ReturnType<typeof usePianoPractice> };
export function TrainerPianoCard({ exercise, active, practice }: CardProps) {
  const score = practice.result?.id === exercise.id ? practice.result.score : null;
  return <div className="trainer-card">
    <PianoCard title={exercise.label} notes={exercise.notes.map(noteName)} heldNotes={practice.heldNotes}/>
    <p>{!active ? 'Session complete.' : score === null ? 'Press Esc to finish an incomplete attempt.' : `Result: ${score}%`}</p>
    <div><span>{practice.status}</span> <button type="button" onClick={practice.connect}>Connect MIDI</button></div>
  </div>;
}
