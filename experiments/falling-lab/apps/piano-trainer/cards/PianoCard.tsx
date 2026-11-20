import type { ReactNode } from 'react';
import './piano-card.css';
import { colorForNoteName } from './noteColors';

export type PianoCardState = 'waiting' | 'playing' | 'correct' | 'incorrect';

export interface PianoCardProps {
  title: string;
  notes: readonly string[];
  state?: PianoCardState;
  playedCount?: number;
  heldNotes?: readonly string[];
  showStatus?: boolean;
  headerDetail?: ReactNode;
}

const messages: Record<PianoCardState, string> = {
  waiting: 'Waiting for input',
  playing: 'Playing notes',
  correct: 'Correct completion',
  incorrect: 'Incorrect attempt'
};

export function PianoCard({ title, notes, state = 'waiting', playedCount = 0, heldNotes = [], showStatus = true, headerDetail }: PianoCardProps) {
  return <article className="piano-card" data-state={state}>
    <div className="piano-card__header">
      <span>{title}</span>
      {headerDetail ?? (showStatus && <span className="piano-card__status">{messages[state]}</span>)}
    </div>
    <div className="piano-card__notes" aria-label={`Phrase: ${notes.join(', ')}`}>
      {notes.map((note, index) => <span key={index} className={`piano-card__note${index < playedCount || heldNotes.includes(note) ? ' is-played' : ''}`} style={{ backgroundColor: colorForNoteName(note) }}>{note}</span>)}
    </div>
    {showStatus && <p className="piano-card__feedback" aria-live="polite">{messages[state]}</p>}
  </article>;
}
