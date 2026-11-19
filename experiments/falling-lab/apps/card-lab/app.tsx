import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PianoCard } from '../../shared/piano/PianoCard';
import { evaluatePhrase } from '../../shared/piano/evaluatePhrase';
import './style.css';
import { noteName, useMidi } from './useMidi';
import { createAttemptRecording, type AttemptMidiEvent } from './attemptRecording';

const expectedPitches = [60, 64, 67];
const phrase = { title: 'Piano phrase', notes: expectedPitches.map(noteName) };

function App() {
  const [eventLog, setEventLog] = useState<AttemptMidiEvent[]>([]);
  const recording = useRef(createAttemptRecording());
  const startNextAttempt = useRef(false);
  const [result, setResult] = useState<0 | 50 | 100 | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.repeat || startNextAttempt.current) return;
      setResult(0);
      startNextAttempt.current = true;
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  const midi = useMidi(event => {
    if (startNextAttempt.current && event.type === 'note-on') {
      recording.current.reset();
      startNextAttempt.current = false;
      setResult(null);
    }
    recording.current.record(event);
    if (event.type === 'note-on') {
      const played = recording.current.getEvents().filter(note => note.type === 'note-on').map(note => note.pitch);
      const score = evaluatePhrase(expectedPitches, played);
      if (score > 0) {
        setResult(score);
        startNextAttempt.current = true;
      }
    }
    setEventLog(previous => [...previous, event]);
  });

  return <main>
    <a className="back" href="../../">← Falling Lab</a>
    <p className="eyebrow">Falling Lab / Experiment</p>
    <h1>Card Lab</h1>
    <p className="intro">Play the phrase on your MIDI keyboard.</p>
    <PianoCard {...phrase} heldNotes={midi.heldNotes} />
    <p>Press Esc to finish an incomplete attempt.</p>
    {result !== null && <p className="phrase-result" role="status">Result: {result}%</p>}
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
    <details className="event-log">
      <summary>MIDI Event Log</summary>
      <button type="button" onClick={() => setEventLog([])}>Clear Log</button>
      <div className="event-log__panel" aria-label="MIDI event log">
        {eventLog.length ? <ol className="event-log__list">
          {eventLog.map((event, index) => <li key={index}>{event.type === 'note-on' ? 'Note on' : 'Note off'} · {noteName(event.pitch)} · velocity {event.velocity} · channel {event.channel} · {event.timestamp.toFixed(1)} ms</li>)}
        </ol> : <p>No MIDI events yet.</p>}
      </div>
      <p className="event-log__hint">Timestamps are milliseconds on the browser’s performance clock.</p>
    </details>
  </main>;
}

createRoot(document.getElementById('root')!).render(<App />);
