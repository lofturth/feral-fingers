import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createSession } from '../../core/physics.ts';
import { FallingView } from './view/FallingView';
import { TrainerPianoCard } from './cards/TrainerPianoCard';
import { createTrainingSession } from './trainingSession';
import './style.css';

function App() {
  const [session] = useState(() => createSession({ cardCount: 1, config: { instantPosition: window.matchMedia('(prefers-reduced-motion: reduce)').matches } }));
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
  const complete = useCallback((cardId: string, score: 50 | 100, time: number) => {
    if (trainer.complete(cardId, score, time)) refresh();
  }, [trainer, refresh]);
  const skip = useCallback((cardId: string, time: number) => {
    if (trainer.skip(cardId, time)) refresh();
  }, [trainer, refresh]);
  return <main>
    <header><div className="identity"><h1>FALLING LAB<span>_</span></h1><span className="edition">PIANO TRAINER / 01</span><a href="../../">Launcher</a></div><div className="readouts"><span className="status"><i/>LIVE</span><span>PROGRESS <b id="score">{progress.toFixed(1)}</b><small>%</small></span></div></header>
    <section className="instrument" aria-label="Piano phrase field">
      <div className="chart-heading"><span>PIANO PHRASE FIELD</span><div className="legend"><span className="magenta">▥ ITEM DEPTH</span><span className="cyan">∿ OVERALL PROGRESS</span></div></div>
      <FallingView state={state} progress={progress} history={history} card={<TrainerPianoCard active={!state.paused && !state.complete && state.selectedIndex === 0} cardId={state.cards[0].id} onComplete={complete} onSkip={skip}/>}/>
      <div className="chart-foot"><span>SLOTS: FIXED POSITIONS <span className="divider">/</span> TRACE: SESSION TIME →</span><span>FULL SESSION <span className="divider">/</span> PROGRESS HISTORY</span></div>
    </section>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
