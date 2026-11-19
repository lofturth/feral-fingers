import { useEffect, useRef, useState } from 'react';
import { PianoCard } from './PianoCard';
import { evaluatePhrase } from './evaluatePhrase';
import { noteName, useMidi } from '../midi/useMidi';

const pitches = [60, 64, 67];
export function TrainerPianoCard() {
  const played = useRef<number[]>([]);
  const finished = useRef(false);
  const [result, setResult] = useState<0 | 50 | 100 | null>(null);
  const midi = useMidi(event => {
    if (event.type !== 'note-on') return;
    if (finished.current) { played.current = []; finished.current = false; setResult(null); }
    played.current.push(event.pitch);
    const score = evaluatePhrase(pitches, played.current);
    if (score > 0) { setResult(score); finished.current = true; }
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.repeat && !finished.current) { setResult(0); finished.current = true; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return <div className="trainer-card">
    <PianoCard title="Piano phrase" notes={pitches.map(noteName)} heldNotes={midi.heldNotes}/>
    <p>{result === null ? 'Press Esc to finish an incomplete attempt.' : `Result: ${result}%`}</p>
    <div><span>{midi.status}</span> <button type="button" onClick={midi.connect}>Connect MIDI</button></div>
  </div>;
}
