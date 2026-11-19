import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PianoCard, type PianoCardState } from '../../shared/piano/PianoCard';
import './style.css';
import { noteName, useMidi } from './useMidi';
import { createAttemptRecording, type AttemptMidiEvent } from './attemptRecording';

const phrase = { title: 'Piano phrase', notes: ['C4', 'E4', 'G4'] };

function App() {
  const [state, setState] = useState<PianoCardState>('waiting');
  const [playedCount, setPlayedCount] = useState(0);
  const [progress, setProgress] = useState(0);
  const [recordedCount, setRecordedCount] = useState(0);
  const [eventLog, setEventLog] = useState<AttemptMidiEvent[]>([]);
  const logPanel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logPanel.current) logPanel.current.scrollTop = logPanel.current.scrollHeight;
  }, [eventLog]);
  const recording = useRef(createAttemptRecording());
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
  }, event => {
    recording.current.record(event);
    setEventLog(previous => [...previous, event]);
    setRecordedCount(recording.current.getEvents().length);
  });

  function retry() {
    recording.current.reset();
    setRecordedCount(0);
    attemptRef.current = { progress: 0, status: 'active' };
    setProgress(0);
    setAttempt('active');
    setPlayedCount(0);
    setState('waiting');
  }

  return <main>
    <a className="back" href="../../">← Falling Lab</a>
    <p className="eyebrow">Falling Lab / Experiment</p>
    <h1>Card Lab</h1>
    <p className="intro">Play the phrase on your MIDI keyboard.</p>
    <PianoCard {...phrase} state={state} playedCount={playedCount} heldNotes={midi.heldNotes} />
    <details className="event-log" onToggle={event => {
      if (event.currentTarget.open && logPanel.current) logPanel.current.scrollTop = logPanel.current.scrollHeight;
    }}>
      <summary>MIDI Event Log</summary>
      <button type="button" onClick={() => setEventLog([])}>Clear Log</button>
      <div className="event-log__panel" ref={logPanel} tabIndex={0} aria-label="MIDI event log">
        {eventLog.length ? <ol className="event-log__list">
          {eventLog.map((event, index) => <li key={index}>{event.type === 'note-on' ? 'Note on' : 'Note off'} · {noteName(event.pitch)} · velocity {event.velocity} · channel {event.channel} · {event.timestamp.toFixed(1)} ms</li>)}
        </ol> : <p>No MIDI events yet.</p>}
      </div>
      <p className="event-log__hint">Timestamps are milliseconds on the browser’s performance clock.</p>
    </details>
    <section className="recognition" aria-labelledby="recognition-title">
      <h2 id="recognition-title">Phrase practice</h2>
      <p role="status">{attempt === 'success' ? 'Phrase complete!' : attempt === 'error' ? 'Incorrect or extra note. Try again.' : `Progress: ${progress} / ${phrase.notes.length} notes`}</p>
      <button type="button" onClick={retry}>Retry phrase</button>
      <p>Events recorded this attempt: {recordedCount}</p>
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
    </section>
  </main>;
}

createRoot(document.getElementById('root')!).render(<App />);
