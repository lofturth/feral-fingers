/// <reference path="./json.d.ts" />
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { createSession } from '../../core/physics.ts';
import { FallingView } from './view/FallingView';
import { TrainerPianoCard, usePianoPractice } from './cards/TrainerPianoCard';
import { createTrainingSession } from './trainingSession';
import { parseDeck, type PianoDeck } from './deck';
import sampleDeckJson from './decks/sample.json?raw';
import './style.css';

function PracticeSession({ deck }: { deck: PianoDeck }) {
  const [session] = useState(() => createSession({ cards: deck.exercises.map(({ id }) => ({ id })), config: { instantPosition: window.matchMedia('(prefers-reduced-motion: reduce)').matches } }));
  const [trainer] = useState(() => createTrainingSession(session));
  const [state, setState] = useState(() => session.getState());
  const [progress, setProgress] = useState(() => session.getProgress());
  const [history, setHistory] = useState([{ time: 0, progress: 0 }]);
  useEffect(() => {
    let nextSample = .25, frame = 0;
    const visibility = () => { trainer.resetClock(); };
    const tick = (time: number) => {
      if (!document.hidden) {
        trainer.advanceTo(time);
        const snapshot = session.getState(), value = session.getProgress();
        setState(snapshot); setProgress(value);
        if (snapshot.time >= nextSample) { setHistory(previous => [...previous, { time: snapshot.time, progress: value }]); nextSample = snapshot.time + .25; }
      }
      frame = requestAnimationFrame(tick);
    };
    document.addEventListener('visibilitychange', visibility);
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', visibility); };
  }, [session, trainer]);
  const refresh = useCallback(() => {
    const snapshot = session.getState(), value = session.getProgress();
    setState(snapshot); setProgress(value);
    setHistory(previous => [...previous, { time: snapshot.time, progress: value }]);
  }, [session]);
  const complete = useCallback((cardId: string, score: 50 | 100, time: number) => { if (trainer.complete(cardId, score, time)) refresh(); }, [trainer, refresh]);
  const skip = useCallback((cardId: string, time: number) => { if (trainer.skip(cardId, time)) refresh(); }, [trainer, refresh]);
  const getSelectedId = useCallback(() => { const current = session.getState(); return current.paused || current.complete ? null : current.selectedCardId; }, [session]);
  const getExercise = useCallback((id: string) => deck.exercises.find(exercise => exercise.id === id), [deck]);
  const practice = usePianoPractice({ selectedId: state.selectedCardId, getSelectedId, getExercise, onComplete: complete, onSkip: skip });
  const selected = deck.exercises[state.selectedIndex] ?? deck.exercises[0];
  return <>
    <div className="readouts"><span className="status"><i/>{state.complete ? 'COMPLETE' : 'LIVE'}</span><span>PROGRESS <b id="score">{progress.toFixed(1)}</b><small>%</small></span></div>
    <section className="instrument" aria-label="Piano phrase field">
      <div className="chart-heading"><span>{deck.title}</span><div className="legend"><span className="magenta">▥ ITEM DEPTH</span><span className="cyan">∿ OVERALL PROGRESS</span></div></div>
      <FallingView state={state} progress={progress} history={history} exercises={deck.exercises} card={<TrainerPianoCard exercise={selected} active={!state.paused && !state.complete} practice={practice}/>}/>
      <div className="chart-foot"><span>SLOTS: FIXED POSITIONS <span className="divider">/</span> TRACE: SESSION TIME →</span><span>FULL SESSION <span className="divider">/</span> PROGRESS HISTORY</span></div>
    </section>
  </>;
}
function App() {
  const [deck, setDeck] = useState(() => parseDeck(JSON.parse(sampleDeckJson)));
  const [generation, setGeneration] = useState(0);
  const [error, setError] = useState('');
  const loadId = useRef(0);
  async function loadDeck(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const request = ++loadId.current;
    try {
      const next = parseDeck(JSON.parse(await file.text()));
      if (request !== loadId.current) return;
      setDeck(next); setGeneration(value => value + 1); setError('');
    } catch (reason) {
      if (request !== loadId.current) return;
      setError(`Could not load deck: ${reason instanceof Error ? reason.message : String(reason)}`);
    }
  }
  return <main>
    <header><div className="identity"><h1>FALLING LAB<span>_</span></h1><span className="edition">PIANO TRAINER / 01</span><a href="../../">Launcher</a></div><label>Load Deck <input type="file" accept=".json,application/json" onChange={loadDeck}/></label></header>
    {error && <p role="alert">{error}</p>}
    <PracticeSession key={generation} deck={deck}/>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
