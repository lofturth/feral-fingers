import { useEffect, useRef, useState } from 'react';
import { PianoCard } from './PianoCard';
import { createPhraseAttempt } from './phraseAttempt';
import { noteName, useMidi } from '../midi/useMidi';

const pitches = [60, 64, 67];
type Props = { active: boolean; cardId: string; onComplete: (cardId: string, score: 50 | 100, time: number) => void; onSkip: (cardId: string, time: number) => void };
export function TrainerPianoCard({ active, cardId, onComplete, onSkip }: Props) {
  const attempt = useRef(createPhraseAttempt(pitches));
  const [result, setResult] = useState<50 | 100 | null>(null);
  const midi = useMidi(event => {
    if (!active || event.type !== 'note-on') return;
    setResult(null);
    const score = attempt.current.note(event.pitch);
    if (score !== null) { setResult(score); onComplete(cardId, score, event.timestamp); }
  });
  useEffect(() => { attempt.current.reset(); setResult(null); }, [cardId, active]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || !active) return;
      attempt.current.reset();
      setResult(null);
      onSkip(cardId, event.timeStamp);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, cardId, onSkip]);
  return <div className="trainer-card">
    <PianoCard title="Piano phrase" notes={pitches.map(noteName)} heldNotes={midi.heldNotes}/>
    <p>{result === null ? 'Press Esc to finish an incomplete attempt.' : `Result: ${result}%`}</p>
    <div><span>{midi.status}</span> <button type="button" onClick={midi.connect}>Connect MIDI</button></div>
  </div>;
}
