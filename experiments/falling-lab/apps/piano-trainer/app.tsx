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
import { saveDeck } from './deckStorage';
import { MyDecks } from './MyDecks.tsx';
import { usePhrasePlayback, type NotesPerBeat } from './audio/usePhrasePlayback';
import { useAudioOutput } from './audio/useAudioOutput';
import { createSessionRecorder, type SessionRecorder } from './sessionRecorder';
import { appendGravityHistory, type GravityHistoryEntry } from './gravityHistory';
import { DEFAULT_PHYSICS_SETTINGS, loadPhysicsSettings, physicsPatch, savePhysicsSettings, validPhysicsSettings, type PhysicsSettings } from './physicsSettings';
import sampleDeckJson from './decks/sample.json?raw';
import './style.css';

function PracticeSession({ deck, recorder, onLog, nextAttemptId, playback, output, exitRef, physics, demonstrationRef }: { demonstrationRef: React.MutableRefObject<((timing: { timestamp: number; tempo: number; notesPerBeat: NotesPerBeat }) => void) | null>; physics: PhysicsSettings; deck: PianoDeck; recorder: SessionRecorder; output: string; exitRef: React.MutableRefObject<() => void>; onLog: LogEvent; nextAttemptId: () => number; playback: ReturnType<typeof usePhrasePlayback> }) {
  const [practiceStarted, setPracticeStarted] = useState(false);
  const startedRef = useRef(false);
  const [session] = useState(() => createSession({ holdSelection: true, cards: deck.exercises.map(({ id }) => ({ id })), config: { ...physicsPatch(physics), instantPosition: window.matchMedia('(prefers-reduced-motion: reduce)').matches } }));
  const [trainer] = useState(() => createTrainingSession(session, change => {
    recorder.record({ type: 'selection', timestamp: change.timestamp, previous: change.previous || null, next: change.next || null, cause: change.cause });
    onLog({ timestamp: change.timestamp, type: 'Core selection', detail: `${change.previous || 'none'} → ${change.next || 'none'}; cause ${change.cause}` });
  }));
  const [state, setState] = useState(() => session.getState());
  const [gravityHistory, setGravityHistory] = useState<Record<string, GravityHistoryEntry[]>>(() => Object.fromEntries(session.getState().cards.map(card => [card.id, appendGravityHistory([], card.gravityMultiplier)])));
  const recordGravity = useCallback((cardId: string) => {
    const card = session.getCard(cardId);
    if (card) setGravityHistory(previous => ({ ...previous, [cardId]: appendGravityHistory(previous[cardId] ?? [], card.gravityMultiplier) }));
  }, [session]);
  const appliedPhysics = useRef(physics);
  useEffect(() => {
    if (appliedPhysics.current === physics) return;
    if (startedRef.current) trainer.advanceTo(performance.now());
    session.configure(physicsPatch(physics));
    appliedPhysics.current = physics;
    setState(session.getState());
  }, [physics, session, trainer]);
  const [progress, setProgress] = useState(() => session.getProgress());
  const [history, setHistory] = useState([{ time: 0, progress: 0 }]);
  const fieldRef = useRef<FieldHandle>(null);
  const overlayRef = useRef<HTMLElement>(null);
  const lastSelected = useRef<string | null>(null);
  const lastPlaybackSelection = useRef<string | null>(null);
  const latestDemonstrations = useRef(new Map<string, { tempo: number; notesPerBeat: NotesPerBeat }>());
  const pendingDemonstrations = useRef<{ timestamp: number; exerciseId: string; tempo: number; notesPerBeat: NotesPerBeat }[]>([]);
  const recordingStarted = useRef(false);
  useEffect(() => {
    demonstrationRef.current = timing => {
      const exerciseId = lastPlaybackSelection.current;
      if (!exerciseId) return;
      const event = { ...timing, exerciseId };
      latestDemonstrations.current.set(exerciseId, { tempo: timing.tempo, notesPerBeat: timing.notesPerBeat });
      if (recordingStarted.current) recorder.record({ type: 'demonstration', ...event });
      else pendingDemonstrations.current.push(event);
    };
    return () => { demonstrationRef.current = null; };
  }, [demonstrationRef, recorder]);
  const selectPlayback = useCallback((snapshot: SessionSnapshot, delayed = false, activateNow = false) => {
    const selected = !snapshot.paused && !snapshot.complete ? deck.exercises[snapshot.selectedIndex] : undefined;
    lastPlaybackSelection.current = selected?.id ?? null;
    playback.setExercise(selected?.notes ?? null, delayed, activateNow);
  }, [deck, playback.setExercise]);
  useEffect(() => () => playback.stop(), [playback.stop]);
  const projectionId = useRef(0);
  const [projection, setProjection] = useState<Projection | null>(null);
  useEffect(() => {
    const timestamp = performance.now();
    onLog({ timestamp, type: 'Core selection', detail: `none → ${session.getState().selectedCardId || 'none'}; cause session start` });
    return () => { queueMicrotask(() => recorder.finish('interrupted')); };
  }, [onLog, session, recorder]);
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
      if (!document.hidden && startedRef.current) {
        trainer.advanceTo(time);
        const snapshot = session.getState(), value = session.getProgress();
        if (snapshot.complete) recorder.finish('completed');
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
  }, [session, trainer, projectSelection, selectPlayback, recorder]);
  const refresh = useCallback(() => {
    const snapshot = session.getState(), value = session.getProgress();
    setState(snapshot); setProgress(value);
    setHistory(previous => [...previous, { time: snapshot.time, progress: value }]);
    projectSelection(snapshot);
    selectPlayback(snapshot, true);
  }, [session, projectSelection, selectPlayback]);
  const complete = useCallback((cardId: string, score: 50 | 100, time: number, attemptId: number, fluent: boolean | null) => {
    let before = '';
    const result = trainer.complete(cardId, score, time, id => { before = id; }, fluent);
    const after = session.getState().selectedCardId;
    onLog({ timestamp: time, type: 'Core reward', attemptId, detail: `Card ${cardId}; magnitude ${score / 100}; selection before ${before || 'none'} → after ${after || 'none'}; ${result ? 'applied' : 'not applied'}` });
    recorder.record({ type: 'reward', timestamp: time, exerciseId: cardId, attemptId, magnitude: score / 100, applied: !!result });
    if (result) { recordGravity(cardId); if (session.getState().complete) recorder.finish('completed'); refresh(); }
  }, [session, trainer, refresh, onLog, recorder, recordGravity]);
  const skip = useCallback((cardId: string, time: number, attemptId: number) => {
    let before = '';
    const result = trainer.skip(cardId, time, id => { before = id; });
    const after = session.getState().selectedCardId;
    onLog({ timestamp: time, type: 'Core skip', attemptId, detail: `Card ${cardId}; selection before ${before || 'none'} → after ${after || 'none'}; ${result ? 'applied' : 'not applied'}` });
    recorder.record({ type: 'skip', timestamp: time, exerciseId: cardId, attemptId, applied: !!result });
    if (result) { recordGravity(cardId); if (session.getState().complete) recorder.finish('completed'); refresh(); }
  }, [session, trainer, refresh, onLog, recorder, recordGravity]);
  const getSelectedId = useCallback(() => { const current = session.getState(); return !startedRef.current || current.paused || current.complete ? null : current.selectedCardId; }, [session]);
  const getExercise = useCallback((id: string) => deck.exercises.find(exercise => exercise.id === id), [deck]);
  const resetAttemptRef = useRef<() => void>(() => {});
  const togglePause = useCallback(() => {
    const current = session.getState();
    if (!startedRef.current || current.complete) return;
    const now = performance.now();
    trainer.advanceTo(now);
    session.setPaused(!current.paused);
    trainer.resetClock();
    playback.setPaused(!current.paused);
    resetAttemptRef.current();
    setState(session.getState());
  }, [session, trainer, playback.setPaused]);
  const startRecording = (timestamp: number) => {
    if (!startedRef.current) return false;
    const started = recorder.start(timestamp, { phrasePlayback: playback.enabled, metronome: playback.metronome, tempo: playback.tempo, phraseVolume: playback.phraseVolume, metronomeVolume: playback.metronomeVolume, nextPhraseDelay: playback.delay, audioOutput: output, physics, notesPerBeat: playback.notesPerBeat });
    if (started) {
      recordingStarted.current = true;
      for (const event of pendingDemonstrations.current) recorder.record({ type: 'demonstration', ...event });
      pendingDemonstrations.current = [];
    }
    return started;
  };
  const practice = usePianoPractice({ recorder, startRecording, getTiming: () => ({ tempo: playback.tempo, notesPerBeat: playback.notesPerBeat }), getDemonstrationTiming: id => latestDemonstrations.current.get(id) ?? null, selectedId: state.selectedCardId, getSelectedId, getExercise, onComplete: complete, onSkip: skip, onLog, nextAttemptId, replay: playback.replay, togglePause });
  resetAttemptRef.current = practice.resetAttempt;
  exitRef.current = practice.resetAttempt;
  const startPractice = () => {
    if (startedRef.current) return;
    startedRef.current = true;
    trainer.resetClock();
    setPracticeStarted(true);
    selectPlayback(session.getState(), false, true);
  };
  const selected = deck.exercises[state.selectedIndex] ?? deck.exercises[0];
  const overlayFeedback = practice.flash?.color ?? (practice.feedback?.id === state.selectedCardId ? practice.feedback.color : practiceStarted && !state.paused && !state.complete ? 'blue' : undefined);
  return <>
    <div className="readouts"><span className="status"><i/>{!practiceStarted ? 'READY' : state.complete ? 'COMPLETE' : state.paused ? 'PAUSED' : 'PLAYING'} <button type="button" onClick={togglePause} disabled={!practiceStarted || state.complete}>{state.paused ? 'Resume' : 'Pause'}</button></span><span>PROGRESS <b id="score">{progress.toFixed(1)}</b><small>%</small></span></div>
    <section className="instrument trainer-field" aria-label="Piano phrase field">
      <div className="chart-heading"><span>{deck.title}</span><div className="legend"><span className="magenta">▥ ITEM DEPTH</span><span className="cyan">∿ OVERALL PROGRESS</span></div></div>
      <FallingView ref={fieldRef} state={state} progress={progress} history={history} exercises={deck.exercises}/>
      <aside ref={overlayRef} className="active-card-overlay" data-feedback={overlayFeedback} data-flash={practice.flash ? 'true' : undefined} aria-label={overlayFeedback ? `Active piano exercise, ${overlayFeedback} feedback` : 'Active piano exercise'}>
        {practice.flash && <span key={practice.flash.sequence} className="overlay-flash" data-color={practice.flash.color} aria-hidden="true"/>}
        {!practiceStarted && <button className="start-practice" type="button" onClick={startPractice}>Start Practice</button>}
        <TrainerPianoCard exercise={selected} gravity={state.cards[state.selectedIndex]?.gravityMultiplier ?? 1} history={gravityHistory[state.selectedCardId] ?? []} practice={practice}/>
      </aside>
      <div className="chart-foot"><span>SLOTS: FIXED POSITIONS <span className="divider">/</span> TRACE: SESSION TIME →</span><span>FULL SESSION <span className="divider">/</span> PROGRESS HISTORY</span></div>
    </section>
    <VisualKeyboard heldNotes={practice.heldNotes}/>
    {projection && <CardProjection key={projection.id} projection={projection} onFinish={finishProjection}/>}
  </>;
}
function PhysicsInput({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max?: number; step: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <label>{label} <input type="number" min={min} max={max} step={step} value={draft} onChange={event => { setDraft(event.target.value); onChange(event.target.valueAsNumber); }} onBlur={() => setDraft(String(value))}/></label>;
}
function App() {
  const audioOutput = useAudioOutput();
  const demonstrationRef = useRef<((timing: { timestamp: number; tempo: number; notesPerBeat: NotesPerBeat }) => void) | null>(null);
  const onDemonstration = useCallback((timing: { timestamp: number; tempo: number; notesPerBeat: NotesPerBeat }) => demonstrationRef.current?.(timing), []);
  const playback = usePhrasePlayback(audioOutput.setContext, onDemonstration);
  const [physics, setPhysics] = useState(loadPhysicsSettings);
  function updatePhysics(next: PhysicsSettings) {
    if (!validPhysicsSettings(next)) return;
    setPhysics(next); savePhysicsSettings(next);
  }
  const [tempoDraft, setTempoDraft] = useState(() => String(playback.tempo));
  const [initialDeck] = useState(() => JSON.parse(sampleDeckJson));
  const [deck, setDeck] = useState(() => parseDeck(initialDeck));
  const [recorder, setRecorder] = useState(() => createSessionRecorder(initialDeck));
  const deckSource = useRef(initialDeck);
  const exitRef = useRef<() => void>(() => {});
  const [generation, setGeneration] = useState(0);
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState('');
  const [showDecks, setShowDecks] = useState(false);
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
    const source = JSON.parse(text);
    const next = parseDeck(source);
    exitRef.current();
    void recorder.finish('interrupted');
    const nextRecorder = createSessionRecorder(source);
    deckSource.current = source;
    setStorageError('');
    void saveDeck(source).catch(() => setStorageError('Could not save this deck to the library.'));
    setRecorder(nextRecorder);
    playback.stop();
    setDeck(next); setGeneration(value => value + 1); setError(''); setLoadedNotice(true);
  }
  async function leavePractice() {
    exitRef.current();
    playback.stop();
    await recorder.finish('interrupted');
    setShowDecks(true);
  }
  function returnToPractice() {
    setRecorder(createSessionRecorder(deckSource.current));
    setGeneration(value => value + 1);
    setShowDecks(false);
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
    <header><div className="identity"><h1>FALLING LAB<span>_</span></h1><span className="edition">PIANO TRAINER / 01</span><a href="../../" onClick={() => { exitRef.current(); void recorder.finish('interrupted'); }}>Launcher</a></div><div className="deck-controls">
      <div className="playback-controls">
        <button type="button" aria-pressed={playback.enabled} onClick={() => playback.setEnabled(!playback.enabled)}>Phrase Playback {playback.enabled ? 'On' : 'Off'}</button>
        <button type="button" aria-pressed={playback.metronome} onClick={() => playback.setMetronome(!playback.metronome)}>Metronome {playback.metronome ? 'On' : 'Off'}</button>
        <label>Phrase Volume <input type="range" min="0" max="100" value={playback.phraseVolume} onChange={event => playback.setVolume('phraseVolume', Number(event.target.value))}/> {playback.phraseVolume}%</label>
        <label>Metronome Volume <input type="range" min="0" max="100" value={playback.metronomeVolume} onChange={event => playback.setVolume('metronomeVolume', Number(event.target.value))}/> {playback.metronomeVolume}%</label>
        <label>Next Phrase Delay <input type="range" min="0" max="1" step="0.01" value={playback.delay} onChange={event => playback.setDelay(Number(event.target.value))}/> {playback.delay.toFixed(2)} s</label>
        <label>Notes per Beat <select value={playback.notesPerBeat} onChange={event => playback.setNotesPerBeat(Number(event.target.value) as NotesPerBeat)}><option value={1}>1</option><option value={2}>2</option><option value={4}>4</option></select></label>
        <label>Tempo <input type="number" min="30" max="240" step="1" value={tempoDraft} onChange={event => { const text = event.target.value; setTempoDraft(text); playback.setTempo(Number(text)); }} onBlur={() => setTempoDraft(String(playback.tempo))}/> BPM</label>
      </div>
      <div className="playback-controls" aria-label="Physics settings">
        <PhysicsInput label="Falling speed" min={0.01} step={0.1} value={physics.fallingSpeed} onChange={value => updatePhysics({ ...physics, fallingSpeed: value })}/>
        <PhysicsInput label="Reward strength" min={1} max={100} step={1} value={physics.rewardStrength} onChange={value => updatePhysics({ ...physics, rewardStrength: value })}/>
        <PhysicsInput label="Unlock threshold" min={1} max={99} step={1} value={physics.unlockThreshold} onChange={value => updatePhysics({ ...physics, unlockThreshold: value })}/>
        <PhysicsInput label="Completion threshold" min={1} max={99} step={1} value={physics.completionThreshold} onChange={value => updatePhysics({ ...physics, completionThreshold: value })}/>
        <button type="button" onClick={() => updatePhysics({ ...DEFAULT_PHYSICS_SETTINGS })}>Reset to Defaults</button>
      </div>
      <label className="audio-output">Audio output: <select value={audioOutput.supported ? audioOutput.selected : ''} disabled={!audioOutput.supported} onChange={event => audioOutput.select(event.target.value)}>
        <option value="">System default</option>
        {audioOutput.selected && !audioOutput.devices.some(device => device.deviceId === audioOutput.selected) && <option value={audioOutput.selected}>Saved output (availability unknown)</option>}
        {audioOutput.devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Audio output ${index + 1}`}</option>)}
      </select></label>
      {audioOutput.supported && <button type="button" onClick={audioOutput.allowDevices}>Allow microphone access to list outputs</button>}
      {!audioOutput.supported && <span role="status">This browser uses the system default audio output.</span>}
      {audioOutput.message && <span role="status">{audioOutput.message}</span>}
      {playback.audioError && <span role="status">{playback.audioError}</span>}
      <div className="deck-load-actions">
        <button type="button" onClick={() => void leavePractice()}>My Decks</button>
        <button type="button" onClick={() => void leavePractice()}>Finish Practice</button>
        <label>Load Deck <input type="file" accept=".json,application/json" onChange={loadDeck}/></label>
        <button type="button" onClick={() => { setPasteError(''); pasteDialog.current?.showModal(); }}>Paste JSON</button>
      </div>
      <div className="deck-info"><span>{deck.title} · {deck.exercises.length} {deck.exercises.length === 1 ? 'exercise' : 'exercises'}</span><span role="status">{loadedNotice ? 'Deck loaded' : ''}</span></div>
      {error && <p className="deck-error" role="alert">{error}</p>}
      {storageError && <p className="deck-error" role="status">{storageError}</p>}
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
    {showDecks && <MyDecks onBack={returnToPractice} onPractice={saved => {
      ++loadId.current;
      try { applyDeckText(JSON.stringify(saved.content)); setShowDecks(false); }
      catch (reason) { setError(`Could not load deck: ${reason instanceof Error ? reason.message : String(reason)}`); setShowDecks(false); }
    }}/>} 
    {!showDecks && <div>
      <PracticeSession key={generation} deck={deck} recorder={recorder} demonstrationRef={demonstrationRef} physics={physics} output={audioOutput.selected} exitRef={exitRef} onLog={log} nextAttemptId={nextAttemptId} playback={playback}/>
      <EventLog entries={entries} clear={clearLog}/>
    </div>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
