import { useEffect, useRef, useState } from 'react';
import { PianoCard } from './PianoCard';
import { createPhraseAttempt } from './phraseAttempt';
import { noteName, useMidi } from '../midi/useMidi';
import type { PianoExercise } from '../deck';

type PracticeOptions = {
  selectedId: string;
  getSelectedId: () => string | null;
  getExercise: (id: string) => PianoExercise | undefined;
  onComplete: (id: string, score: 50 | 100, time: number) => void;
  onSkip: (id: string, time: number) => void;
};

// Mounted once per session, so switching cards does not create MIDI connections.
export function usePianoPractice({ selectedId, getSelectedId, getExercise, onComplete, onSkip }: PracticeOptions) {
  const attempt = useRef<{ id: string; phrase: ReturnType<typeof createPhraseAttempt> } | null>(null);
  const [result, setResult] = useState<{ id: string; score: 50 | 100 } | null>(null);
  const midi = useMidi(event => {
    if (event.type !== 'note-on') return;
    const id = getSelectedId();
    const selected = id && getExercise(id);
    if (!id || !selected) return;
    if (attempt.current?.id !== id) attempt.current = { id, phrase: createPhraseAttempt(selected.notes) };
    setResult(null);
    const score = attempt.current.phrase.note(event.pitch);
    if (score !== null) { setResult({ id, score }); onComplete(id, score, event.timestamp); }
  });
  useEffect(() => {
    if (attempt.current && attempt.current.id !== selectedId) attempt.current = null;
  }, [selectedId]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat) return;
      const id = getSelectedId();
      if (!id) return;
      attempt.current = null;
      setResult(null);
      onSkip(id, event.timeStamp);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [getSelectedId, onSkip]);
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
