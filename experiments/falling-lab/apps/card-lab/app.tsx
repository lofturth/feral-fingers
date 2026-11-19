import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PianoCard, type PianoCardState } from '../../shared/piano/PianoCard';
import './style.css';
import { useMidi } from './useMidi';

const phrase = { title: 'Piano phrase', notes: ['C4', 'E4', 'G4'] };

function App() {
  const [state, setState] = useState<PianoCardState>('waiting');
  const [playedCount, setPlayedCount] = useState(0);
  const [progress, setProgress] = useState(0);
  const [attempt, setAttempt] = useState<'active' | 'success' | 'error'>('active');
  const attemptRef = useRef({ progress: 0, status: 'active' as 'active' | 'success' | 'error' });
  const midi = useMidi(note => {
    const current = attemptRef.current;
    if (current.status === 'error') return;
    if (current.status === 'success' || note !== phrase.notes[current.progress]) {
      attemptRef.current = { ...current, status: 'error' };
      setAttempt('error');
      setState('incorrect');
      return;
    }
    const next = current.progress + 1;
    const status = next === phrase.notes.length ? 'success' : 'active';
    attemptRef.current = { progress: next, status };
    setProgress(next);
    setAttempt(status);
    setPlayedCount(next);
    setState(status === 'success' ? 'correct' : 'playing');
  });

  function retry() {
    attemptRef.current = { progress: 0, status: 'active' };
    setProgress(0);
    setAttempt('active');
    setPlayedCount(0);
    setState('waiting');
  }

  function simulate(action: PianoCardState) {
    setState(action);
    if (action === 'waiting') setPlayedCount(0);
    if (action === 'playing') setPlayedCount(count => count >= phrase.notes.length ? 1 : count + 1);
    if (action === 'correct') setPlayedCount(phrase.notes.length);
  }

  return <main>
    <a className="back" href="../../">← Falling Lab</a>
    <p className="eyebrow">Falling Lab / Experiment</p>
    <h1>Card Lab</h1>
    <p className="intro">Explore a piano card’s states with simulated input.</p>
    <PianoCard {...phrase} state={state} playedCount={playedCount} heldNotes={midi.heldNotes} />
    <section className="recognition" aria-labelledby="recognition-title">
      <h2 id="recognition-title">Phrase practice</h2>
      <p role="status">{attempt === 'success' ? 'Phrase complete!' : attempt === 'error' ? 'Incorrect or extra note. Try again.' : `Progress: ${progress} / ${phrase.notes.length} notes`}</p>
      <button type="button" onClick={retry}>Retry phrase</button>
    </section>
    <section className="midi" aria-labelledby="midi-title">
      <h2 id="midi-title">MIDI input</h2>
      <div className="midi-controls">
        <button type="button" onClick={midi.connect}>Connect MIDI</button>
        <label htmlFor="midi-input">Input device</label>
        <select id="midi-input" value={midi.selectedId} onChange={event => midi.selectInput(event.target.value)}>
          <option value="">Select a device</option>
          {midi.devices.map(device => <option value={device.id} key={device.id}>{device.name || 'MIDI input'}</option>)}
        </select>
      </div>
      <p role="status">{midi.status}</p>
      <h3>Incoming notes</h3>
      {midi.events.length ? <ul className="midi-events" aria-label="Recent MIDI events">
        {midi.events.map(event => <li key={event.id}>{event.type} · {event.note} · velocity {event.velocity} · channel {event.channel}</li>)}
      </ul> : <p>No notes received yet.</p>}
    </section>
    <section className="controls" aria-labelledby="controls-title">
      <h2 id="controls-title">Simulate</h2>
      <div className="buttons">
        <button type="button" onClick={() => simulate('waiting')}>Waiting for input</button>
        <button type="button" onClick={() => simulate('playing')}>Play next note</button>
        <button type="button" onClick={() => simulate('correct')}>Correct completion</button>
        <button type="button" onClick={() => simulate('incorrect')}>Incorrect attempt</button>
      </div>
      <p>Playing a note advances the highlight. These controls only simulate card states.</p>
    </section>
  </main>;
}

createRoot(document.getElementById('root')!).render(<App />);
