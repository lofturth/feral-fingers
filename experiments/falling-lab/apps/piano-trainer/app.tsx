/// <reference path="./json.d.ts" />
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { createSession } from '../../core/physics.ts';
import { FallingView, type FieldHandle } from './view/FallingView';
import { CardProjection, type Projection } from './view/CardProjection';
import { EventLog } from './view/EventLog';
import { VisualKeyboard } from './view/VisualKeyboard';
import type { DiagnosticEvent, LogEvent } from './eventLog';
import { noteName } from './midi/useMidi';
import type { SessionSnapshot } from '../../core/physics';
import { TrainerPianoCard, usePianoPractice } from './cards/TrainerPianoCard';
import { createTrainingSession } from './trainingSession';
import { parseDeck, type PianoDeck } from './deck';
import { usePhrasePlayback } from './audio/usePhrasePlayback';
import sampleDeckJson from './decks/sample.json?raw';
import './style.css';

function PracticeSession({ deck, onLog, nextAttemptId, playback }: { deck: PianoDeck; onLog: LogEvent; nextAttemptId: () => number; playback: ReturnType<typeof usePhrasePlayback> }) {
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
  const [session] = useState(() => createSession({ holdSelection: true, cards: deck.exercises.map(({ id }) => ({ id })), config: { instantPosition: window.matchMedia('(prefers-reduced-motion: reduce)').matches } }));
  const [trainer] = useState(() => createTrainingSession(session, change => {
    onLog({ timestamp: change.timestamp, type: 'Core selection', detail: `${change.previous || 'none'} → ${change.next || 'none'}; cause ${change.cause}` });
  }));
  const [state, setState] = useState(() => session.getState());
  const [progress, setProgress] = useState(() => session.getProgress());
  const [history, setHistory] = useState([{ time: 0, progress: 0 }]);
  const fieldRef = useRef<FieldHandle>(null);
  const overlayRef = useRef<HTMLElement>(null);
  const lastSelected = useRef<string | null>(null);
  const lastPlaybackSelection = useRef<string | null>(null);
  const selectPlayback = useCallback((snapshot: SessionSnapshot, delayed = false) => {
    const selected = !snapshot.paused && !snapshot.complete ? deck.exercises[snapshot.selectedIndex] : undefined;
    lastPlaybackSelection.current = selected?.id ?? null;
    playback.setExercise(selected?.notes ?? null, delayed);
  }, [deck, playback.setExercise]);
  useEffect(() => () => playback.stop(), [playback.stop]);
  const projectionId = useRef(0);
  const [projection, setProjection] = useState<Projection | null>(null);
  useEffect(() => {
    onLog({ timestamp: performance.now(), type: 'Core selection', detail: `none → ${session.getState().selectedCardId || 'none'}; cause session start` });
  }, [onLog, session]);
  const projectSelection = useCallback((snapshot: SessionSnapshot) => {
    lastSelected.current = snapshot.selectedCardId;
    const exercise = deck.exercises[snapshot.selectedIndex];
    if (snapshot.complete || !exercise || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setProjection(null);
      return;
    }
    const start = fieldRef.current?.selectedCardRect(snapshot);
    const end = overlayRef.current?.getBoundingClientRect();
    if (!start || !end || start.width <= 0 || start.height <= 0) { setProjection(null); return; }
    setProjection({ id: ++projectionId.current, label: exercise.label, notes: exercise.notes.map(noteName).join(' · '), start, end });
  }, [deck]);
  const finishProjection = useCallback((id: number) => setProjection(current => current?.id === id ? null : current), []);
  useEffect(() => {
    let nextSample = .25, frame = 0;
    const visibility = () => { trainer.resetClock(); };
    const tick = (time: number) => {
      if (!document.hidden) {
        trainer.advanceTo(time);
        const snapshot = session.getState(), value = session.getProgress();
        if (snapshot.selectedCardId !== lastSelected.current) projectSelection(snapshot);
        if (!snapshot.paused && (snapshot.complete ? null : snapshot.selectedCardId) !== lastPlaybackSelection.current) selectPlayback(snapshot);
        setState(snapshot); setProgress(value);
        if (snapshot.time >= nextSample) { setHistory(previous => [...previous, { time: snapshot.time, progress: value }]); nextSample = snapshot.time + .25; }
      }
      frame = requestAnimationFrame(tick);
    };
    document.addEventListener('visibilitychange', visibility);
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', visibility); };
  }, [session, trainer, projectSelection, selectPlayback]);
  const refresh = useCallback(() => {
    const snapshot = session.getState(), value = session.getProgress();
    setState(snapshot); setProgress(value);
    setHistory(previous => [...previous, { time: snapshot.time, progress: value }]);
    projectSelection(snapshot);
    selectPlayback(snapshot, true);
  }, [session, projectSelection, selectPlayback]);
  const complete = useCallback((cardId: string, score: 50 | 100, time: number, attemptId: number) => {
    let before = '';
    const result = trainer.complete(cardId, score, time, id => { before = id; });
    const after = session.getState().selectedCardId;
    onLog({ timestamp: time, type: 'Core reward', attemptId, detail: `Card ${cardId}; magnitude ${score / 100}; selection before ${before || 'none'} → after ${after || 'none'}; ${result ? 'applied' : 'not applied'}` });
    if (result) refresh();
  }, [session, trainer, refresh, onLog]);
  const skip = useCallback((cardId: string, time: number, attemptId: number) => {
    let before = '';
    const result = trainer.skip(cardId, time, id => { before = id; });
    const after = session.getState().selectedCardId;
    onLog({ timestamp: time, type: 'Core skip', attemptId, detail: `Card ${cardId}; selection before ${before || 'none'} → after ${after || 'none'}; ${result ? 'applied' : 'not applied'}` });
    if (result) refresh();
  }, [session, trainer, refresh, onLog]);
  const getSelectedId = useCallback(() => { const current = session.getState(); return current.paused || current.complete ? null : current.selectedCardId; }, [session]);
  const getExercise = useCallback((id: string) => deck.exercises.find(exercise => exercise.id === id), [deck]);
  const resetAttemptRef = useRef<() => void>(() => {});
  const togglePause = useCallback(() => {
    const current = session.getState();
    if (current.complete) return;
    const now = performance.now();
    trainer.advanceTo(now);
    session.setPaused(!current.paused);
    trainer.resetClock();
    playback.setPaused(!current.paused);
    resetAttemptRef.current();
    setState(session.getState());
  }, [session, trainer, playback.setPaused]);
  const practice = usePianoPractice({ selectedId: state.selectedCardId, getSelectedId, getExercise, onComplete: complete, onSkip: skip, onLog, nextAttemptId, replay: playback.replay, togglePause });
  resetAttemptRef.current = practice.resetAttempt;
  const selected = deck.exercises[state.selectedIndex] ?? deck.exercises[0];
  return <>
    <div className="readouts"><span className="status"><i/>{state.complete ? 'COMPLETE' : state.paused ? 'PAUSED' : 'PLAYING'} <button type="button" onClick={togglePause} disabled={state.complete}>{state.paused ? 'Resume' : 'Pause'}</button></span><span>PROGRESS <b id="score">{progress.toFixed(1)}</b><small>%</small></span></div>
    <section className="instrument trainer-field" aria-label="Piano phrase field">
      <div className="chart-heading"><span>{deck.title}</span><div className="legend"><span className="magenta">▥ ITEM DEPTH</span><span className="cyan">∿ OVERALL PROGRESS</span></div></div>
      <FallingView ref={fieldRef} state={state} progress={progress} history={history} exercises={deck.exercises}/>
      <aside ref={overlayRef} className="active-card-overlay" aria-label="Active piano exercise" style={{ backgroundColor: `rgba(11, 18, 32, ${overlayOpacity / 100})` }}>
        <label className="overlay-opacity">Background <input type="range" min="0" max="100" step="1" value={overlayOpacity} onChange={event => changeOpacity(Number(event.target.value))} aria-label="Overlay background opacity"/> <span>{overlayOpacity}%</span></label>
        <TrainerPianoCard exercise={selected} active={!state.paused && !state.complete} paused={state.paused && !state.complete} practice={practice} replay={playback.replay} playbackEnabled={playback.enabled}/>
      </aside>
      <div className="chart-foot"><span>SLOTS: FIXED POSITIONS <span className="divider">/</span> TRACE: SESSION TIME →</span><span>FULL SESSION <span className="divider">/</span> PROGRESS HISTORY</span></div>
    </section>
    <VisualKeyboard heldNotes={practice.heldNotes}/>
    {projection && <CardProjection key={projection.id} projection={projection} onFinish={finishProjection}/>}
  </>;
}
function App() {
  const playback = usePhrasePlayback();
  const [tempoDraft, setTempoDraft] = useState(() => String(playback.tempo));
  const [deck, setDeck] = useState(() => parseDeck(JSON.parse(sampleDeckJson)));
  const [generation, setGeneration] = useState(0);
  const [error, setError] = useState('');
  const [entries, setEntries] = useState<(DiagnosticEvent & { sequence: number })[]>([]);
  const entrySequence = useRef(0);
  const attemptSequence = useRef(0);
  const log = useCallback((entry: DiagnosticEvent) => {
    const sequence = ++entrySequence.current;
    setEntries(previous => [...previous, { ...entry, sequence }]);
  }, []);
  const nextAttemptId = useCallback(() => ++attemptSequence.current, []);
  const clearLog = useCallback(() => setEntries([]), []);
  const [loadedNotice, setLoadedNotice] = useState(false);
  const [pastedJson, setPastedJson] = useState('');
  const [pasteError, setPasteError] = useState('');
  const pasteDialog = useRef<HTMLDialogElement>(null);
  const loadId = useRef(0);
  useEffect(() => {
    if (!loadedNotice) return;
    const timeout = window.setTimeout(() => setLoadedNotice(false), 3000);
    return () => window.clearTimeout(timeout);
  }, [loadedNotice, generation]);
  function applyDeckText(text: string) {
    const next = parseDeck(JSON.parse(text));
    playback.stop();
    setDeck(next); setGeneration(value => value + 1); setError(''); setLoadedNotice(true);
  }
  function loadPastedDeck() {
    ++loadId.current;
    try {
      applyDeckText(pastedJson);
      setPasteError('');
      pasteDialog.current?.close();
    } catch (reason) {
      setPasteError(`Could not load deck: ${reason instanceof Error ? reason.message : String(reason)}`);
    }
  }
  async function loadDeck(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const request = ++loadId.current;
    try {
      const text = await file.text();
      if (request !== loadId.current) return;
      applyDeckText(text);
    } catch (reason) {
      if (request !== loadId.current) return;
      setLoadedNotice(false);
      setError(`Could not load deck: ${reason instanceof Error ? reason.message : String(reason)}`);
    }
  }
  return <main>
    <header><div className="identity"><h1>FALLING LAB<span>_</span></h1><span className="edition">PIANO TRAINER / 01</span><a href="../../">Launcher</a></div><div className="deck-controls">
      <div className="playback-controls">
        <button type="button" aria-pressed={playback.enabled} onClick={() => playback.setEnabled(!playback.enabled)}>Phrase Playback {playback.enabled ? 'On' : 'Off'}</button>
        <button type="button" aria-pressed={playback.metronome} onClick={() => playback.setMetronome(!playback.metronome)}>Metronome {playback.metronome ? 'On' : 'Off'}</button>
        <label>Phrase Volume <input type="range" min="0" max="100" value={playback.phraseVolume} onChange={event => playback.setVolume('phraseVolume', Number(event.target.value))}/> {playback.phraseVolume}%</label>
        <label>Metronome Volume <input type="range" min="0" max="100" value={playback.metronomeVolume} onChange={event => playback.setVolume('metronomeVolume', Number(event.target.value))}/> {playback.metronomeVolume}%</label>
        <label>Next Phrase Delay <input type="range" min="0" max="5" step="0.25" value={playback.delay} onChange={event => playback.setDelay(Number(event.target.value))}/> {playback.delay} s</label>
        <label>Tempo <input type="number" min="30" max="240" step="1" value={tempoDraft} onChange={event => { const text = event.target.value; setTempoDraft(text); playback.setTempo(Number(text)); }} onBlur={() => setTempoDraft(String(playback.tempo))}/> BPM</label>
      </div>
      {playback.audioError && <span role="status">{playback.audioError}</span>}
      <div className="deck-load-actions">
        <label>Load Deck <input type="file" accept=".json,application/json" onChange={loadDeck}/></label>
        <button type="button" onClick={() => { setPasteError(''); pasteDialog.current?.showModal(); }}>Paste JSON</button>
      </div>
      <div className="deck-info"><span>{deck.title} · {deck.exercises.length} {deck.exercises.length === 1 ? 'exercise' : 'exercises'}</span><span role="status">{loadedNotice ? 'Deck loaded' : ''}</span></div>
      {error && <p className="deck-error" role="alert">{error}</p>}
    </div></header>
    <dialog ref={pasteDialog} className="paste-deck-dialog" aria-labelledby="paste-deck-title" onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}>
      <h2 id="paste-deck-title">Paste JSON deck</h2>
      <label htmlFor="paste-deck-json">Deck JSON</label>
      <textarea id="paste-deck-json" value={pastedJson} onChange={event => setPastedJson(event.target.value)} rows={14} spellCheck={false}/>
      {pasteError && <p className="deck-error" role="alert">{pasteError}</p>}
      <div className="paste-deck-actions">
        <button type="button" onClick={loadPastedDeck}>Load Deck</button>
        <button type="button" onClick={() => pasteDialog.current?.close()}>Cancel</button>
      </div>
    </dialog>
    <PracticeSession key={generation} deck={deck} onLog={log} nextAttemptId={nextAttemptId} playback={playback}/>
    <EventLog entries={entries} clear={clearLog}/>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
