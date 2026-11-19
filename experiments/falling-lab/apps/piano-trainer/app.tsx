import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createSession } from '../../core/physics.ts';
import { FallingView } from './view/FallingView';
import { TrainerPianoCard } from './cards/TrainerPianoCard';
import './style.css';

function App() {
  const [session] = useState(() => createSession({ cardCount: 1, config: { instantPosition: window.matchMedia('(prefers-reduced-motion: reduce)').matches } }));
  const [state, setState] = useState(() => session.getState());
  const [progress, setProgress] = useState(() => session.getProgress());
  const [history, setHistory] = useState([{ time: 0, progress: 0 }]);
  useEffect(() => {
    let last: number | null = null, nextSample = .25, frame = 0;
    const visibility = () => { last = null; };
    const tick = (time: number) => {
      if (last !== null && !document.hidden) {
        session.advance(Math.max(0, (time - last) / 1000));
        const snapshot = session.getState(), value = session.getProgress();
        setState(snapshot); setProgress(value);
        if (snapshot.time >= nextSample) { setHistory(previous => [...previous, { time: snapshot.time, progress: value }]); nextSample = snapshot.time + .25; }
      }
      last = time;
      frame = requestAnimationFrame(tick);
    };
    document.addEventListener('visibilitychange', visibility);
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', visibility); };
  }, [session]);
  return <main>
    <header><div className="identity"><h1>FALLING LAB<span>_</span></h1><span className="edition">PIANO TRAINER / 01</span><a href="../../">Launcher</a></div><div className="readouts"><span className="status"><i/>LIVE</span><span>PROGRESS <b id="score">{progress.toFixed(1)}</b><small>%</small></span></div></header>
    <section className="instrument" aria-label="Piano phrase field">
      <div className="chart-heading"><span>PIANO PHRASE FIELD</span><div className="legend"><span className="magenta">▥ ITEM DEPTH</span><span className="cyan">∿ OVERALL PROGRESS</span></div></div>
      <FallingView state={state} progress={progress} history={history} card={<TrainerPianoCard/>}/>
      <div className="chart-foot"><span>SLOTS: FIXED POSITIONS <span className="divider">/</span> TRACE: SESSION TIME →</span><span>FULL SESSION <span className="divider">/</span> PROGRESS HISTORY</span></div>
    </section>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
