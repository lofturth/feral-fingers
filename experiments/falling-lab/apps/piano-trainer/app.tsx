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
  const [overlayOpacity, setOverlayOpacity] = useState(() => {
    try {
      const saved = localStorage.getItem('piano-trainer.overlay-opacity');
      const value = saved === null ? 90 : Number(saved);
      return Number.isFinite(value) && value >= 0 && value <= 100 ? value : 90;
    } catch { return 90; }
  });
  function changeOpacity(value: number) {
    setOverlayOpacity(value);
    try { localStorage.setItem('piano-trainer.overlay-opacity', String(value)); } catch { /* Keep the setting for this session. */ }
  }
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
      <FallingView state={state} progress={progress} history={history} exercises={deck.exercises}/>
      <div className="chart-foot"><span>SLOTS: FIXED POSITIONS <span className="divider">/</span> TRACE: SESSION TIME →</span><span>FULL SESSION <span className="divider">/</span> PROGRESS HISTORY</span></div>
    </section>
    <aside className="active-card-overlay" aria-label="Active piano exercise" style={{ backgroundColor: `rgba(11, 18, 32, ${overlayOpacity / 100})` }}>
      <label className="overlay-opacity">Background <input type="range" min="0" max="100" step="1" value={overlayOpacity} onChange={event => changeOpacity(Number(event.target.value))} aria-label="Overlay background opacity"/> <span>{overlayOpacity}%</span></label>
      <TrainerPianoCard exercise={selected} active={!state.paused && !state.complete} practice={practice}/>
    </aside>
  </>;
}
function App() {
  const [deck, setDeck] = useState(() => parseDeck(JSON.parse(sampleDeckJson)));
  const [generation, setGeneration] = useState(0);
  const [error, setError] = useState('');
  const [loadedNotice, setLoadedNotice] = useState(false);
  const loadId = useRef(0);
  useEffect(() => {
    if (!loadedNotice) return;
    const timeout = window.setTimeout(() => setLoadedNotice(false), 3000);
    return () => window.clearTimeout(timeout);
  }, [loadedNotice, generation]);
  async function loadDeck(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const request = ++loadId.current;
    try {
      const next = parseDeck(JSON.parse(await file.text()));
      if (request !== loadId.current) return;
      setDeck(next); setGeneration(value => value + 1); setError(''); setLoadedNotice(true);
    } catch (reason) {
      if (request !== loadId.current) return;
      setLoadedNotice(false);
      setError(`Could not load deck: ${reason instanceof Error ? reason.message : String(reason)}`);
    }
  }
  return <main>
    <header><div className="identity"><h1>FALLING LAB<span>_</span></h1><span className="edition">PIANO TRAINER / 01</span><a href="../../">Launcher</a></div><div className="deck-controls">
      <label>Load Deck <input type="file" accept=".json,application/json" onChange={loadDeck}/></label>
      <div className="deck-info"><span>{deck.title} · {deck.exercises.length} {deck.exercises.length === 1 ? 'exercise' : 'exercises'}</span><span role="status">{loadedNotice ? 'Deck loaded' : ''}</span></div>
      {error && <p className="deck-error" role="alert">{error}</p>}
    </div></header>
    <PracticeSession key={generation} deck={deck}/>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
