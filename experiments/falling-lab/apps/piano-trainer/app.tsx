/// <reference path="./json.d.ts" />
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { createSession } from '../../core/physics.ts';
import { FallingView } from './view/FallingView';
import { EventLog } from './view/EventLog';
import { VisualKeyboard } from './view/VisualKeyboard';
import type { DiagnosticEvent, LogEvent } from './eventLog';
import type { SessionSnapshot } from '../../core/physics';
import { TrainerPianoCard, usePianoPractice } from './cards/TrainerPianoCard';
import { createTrainingSession } from './trainingSession';
import { parseDeck, type PianoDeck } from './deck';
import { canonical, listDecks, saveDeck } from './deckStorage';
import { chooseInitialDeck, readRecentDecks, rememberDeck, starterRecord } from './deckSelection';
import { listPracticeSessions } from './practiceStorage';
import { MyDecks } from './MyDecks.tsx';
import { usePhrasePlayback, type NotesPerBeat } from './audio/usePhrasePlayback';
import { useAudioOutput } from './audio/useAudioOutput';
import { createSessionRecorder, type SessionRecorder } from './sessionRecorder';
import { appendGravityHistory, type GravityHistoryEntry } from './gravityHistory';
import { loadKeyboardVisibility, saveKeyboardVisibility } from './keyboardVisibility';
import { DEFAULT_PHYSICS_SETTINGS, loadPhysicsSettings, physicsPatch, savePhysicsSettings, validPhysicsSettings, type PhysicsSettings } from './physicsSettings';
import sampleDeckJson from './decks/sample.json?raw';
import './style.css';

function PracticeSession({ deck, recorder, onLog, nextAttemptId, playback, output, exitRef, pauseRef, startRef, onHeaderUpdate, onPracticeStart, physics, demonstrationRef }: { onPracticeStart: () => void; startRef: React.MutableRefObject<() => void>; pauseRef: React.MutableRefObject<() => void>; onHeaderUpdate: (info: { status: string; progress: string; paused: boolean; canPause: boolean; started: boolean }) => void; demonstrationRef: React.MutableRefObject<((timing: { timestamp: number; tempo: number; notesPerBeat: NotesPerBeat }) => void) | null>; physics: PhysicsSettings; deck: PianoDeck; recorder: SessionRecorder; output: string; exitRef: React.MutableRefObject<() => void>; onLog: LogEvent; nextAttemptId: () => number; playback: ReturnType<typeof usePhrasePlayback> }) {
  const [practiceStarted, setPracticeStarted] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(loadKeyboardVisibility);
  function toggleKeyboard() {
    const next = !keyboardVisible;
    setKeyboardVisible(next);
    saveKeyboardVisibility(next);
  }
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
  const overlayRef = useRef<HTMLElement>(null);
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
  useEffect(() => {
    const timestamp = performance.now();
    onLog({ timestamp, type: 'Core selection', detail: `none → ${session.getState().selectedCardId || 'none'}; cause session start` });
    return () => { queueMicrotask(() => recorder.finish('interrupted')); };
  }, [onLog, session, recorder]);
  useEffect(() => {
    let nextSample = .25, frame = 0;
    const visibility = () => { trainer.resetClock(); };
    const tick = (time: number) => {
      if (!document.hidden && startedRef.current) {
        trainer.advanceTo(time);
        const snapshot = session.getState(), value = session.getProgress();
        if (snapshot.complete) recorder.finish('completed');
        if (!snapshot.paused && (snapshot.complete ? null : snapshot.selectedCardId) !== lastPlaybackSelection.current) selectPlayback(snapshot);
        setState(snapshot); setProgress(value);
        if (snapshot.time >= nextSample) { setHistory(previous => [...previous, { time: snapshot.time, progress: value }]); nextSample = snapshot.time + .25; }
      }
      frame = requestAnimationFrame(tick);
    };
    document.addEventListener('visibilitychange', visibility);
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', visibility); };
  }, [session, trainer, selectPlayback, recorder]);
  const refresh = useCallback(() => {
    const snapshot = session.getState(), value = session.getProgress();
    setState(snapshot); setProgress(value);
    setHistory(previous => [...previous, { time: snapshot.time, progress: value }]);
    selectPlayback(snapshot, true);
  }, [session, selectPlayback]);
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
  const practicePauseRef = useRef<(paused: boolean, timestamp: number) => void>(() => {});
  const togglePause = useCallback(() => {
    const current = session.getState();
    if (!startedRef.current || current.complete) return;
    const now = performance.now();
    trainer.advanceTo(now);
    const nextPaused = !current.paused;
    session.setPaused(nextPaused);
    trainer.resetClock();
    practicePauseRef.current(nextPaused, now);
    playback.setPaused(nextPaused);
    recorder.record({ type: nextPaused ? 'pause' : 'resume', timestamp: now });
    setState(session.getState());
  }, [session, trainer, playback.setPaused, recorder]);
  pauseRef.current = togglePause;
  const progressLabel = progress.toFixed(1);
  useEffect(() => {
    onHeaderUpdate({ status: !practiceStarted ? 'READY' : state.complete ? 'COMPLETE' : state.paused ? 'PAUSED' : 'PLAYING', progress: progressLabel, paused: state.paused, canPause: practiceStarted && !state.complete, started: practiceStarted });
  }, [practiceStarted, state.complete, state.paused, progressLabel, onHeaderUpdate]);
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
  const practice = usePianoPractice({ paused: state.paused, recorder, startRecording, getTiming: () => ({ tempo: playback.tempo, notesPerBeat: playback.notesPerBeat }), getDemonstrationTiming: id => latestDemonstrations.current.get(id) ?? null, selectedId: state.selectedCardId, getSelectedId, getExercise, onComplete: complete, onSkip: skip, onLog, nextAttemptId, replay: playback.replay, togglePause });
  practicePauseRef.current = practice.setPracticePaused;
  exitRef.current = practice.resetAttempt;
  const startPractice = () => {
    if (startedRef.current) return;
    startedRef.current = true;
    onPracticeStart();
    trainer.resetClock();
    setPracticeStarted(true);
    selectPlayback(session.getState(), false, true);
  };
  startRef.current = startPractice;
  const selected = deck.exercises[state.selectedIndex] ?? deck.exercises[0];
  const overlayFeedback = practice.flash?.color ?? (practice.feedback?.id === state.selectedCardId ? practice.feedback.color : practiceStarted && !state.paused && !state.complete ? 'blue' : undefined);
  return <>
    <section className="instrument trainer-field" aria-label="Piano phrase field">
      <FallingView state={state} progress={progress} history={history} exercises={deck.exercises}/>
    </section>
    <section className="active-exercise" aria-label="Active exercise">
      <aside ref={overlayRef} className="active-card-overlay" data-paused={state.paused || undefined} data-feedback={overlayFeedback} data-flash={practice.flash ? 'true' : undefined} aria-label={overlayFeedback ? `Active piano exercise, ${overlayFeedback} feedback` : 'Active piano exercise'}>
        {practice.flash && <span key={practice.flash.sequence} className="overlay-flash" data-color={practice.flash.color} aria-hidden="true"/>}
        <TrainerPianoCard exercise={selected} gravity={state.cards[state.selectedIndex]?.gravityMultiplier ?? 1} history={gravityHistory[state.selectedCardId] ?? []} practice={practice}/>
      </aside>
    </section>
    <section className="keyboard-section" aria-label="Piano keyboard">
      <div className="keyboard-heading"><button type="button" aria-expanded={keyboardVisible} aria-controls="practice-keyboard" onClick={toggleKeyboard}>Keyboard {keyboardVisible ? '▾' : '▴'}</button></div>
      <div id="practice-keyboard" hidden={!keyboardVisible}>{keyboardVisible && <VisualKeyboard heldNotes={practice.heldNotes}/>}</div>
    </section>
    {state.paused && !state.complete && <div className="pause-overlay" role="dialog" aria-modal="true" aria-labelledby="pause-title">
      <div className="pause-card"><h2 id="pause-title">Paused</h2><button type="button" onClick={togglePause} autoFocus>Resume Practice</button></div>
    </div>}
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
  const [starter] = useState(() => starterRecord(initialDeck));
  const [deck, setDeck] = useState(() => parseDeck(initialDeck));
  const [recorder, setRecorder] = useState(() => createSessionRecorder(initialDeck));
  const deckSource = useRef(initialDeck);
  const exitRef = useRef<() => void>(() => {});
  const pauseRef = useRef<() => void>(() => {});
  const startRef = useRef<() => void>(() => {});
  const [headerInfo, setHeaderInfo] = useState({ status: 'READY', progress: '0.0', paused: false, canPause: false, started: false });
  const onHeaderUpdate = useCallback((info: { status: string; progress: string; paused: boolean; canPause: boolean; started: boolean }) => setHeaderInfo(info), []);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const onPracticeStart = useCallback(() => { ++loadId.current; rememberDeck(deckSource.current); }, []);
  useEffect(() => {
    let active = true;
    void Promise.allSettled([listDecks(), listPracticeSessions()]).then(([saved, sessions]) => {
      if (!active || loadId.current !== 0 || saved.status !== 'fulfilled') return;
      const selected = chooseInitialDeck(saved.value, sessions.status === 'fulfilled' ? sessions.value : [], readRecentDecks(), starter);
      if (selected.revision === starter.revision && selected.deckId === starter.deckId) return;
      deckSource.current = selected.content;
      setDeck(parseDeck(selected.content));
      setRecorder(createSessionRecorder(selected.content));
      setGeneration(value => value + 1);
    });
    return () => { active = false; };
  }, [starter]);
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
    setHeaderInfo({ status: 'READY', progress: '0.0', paused: false, canPause: false, started: false });
    const nextRecorder = createSessionRecorder(source);
    deckSource.current = source;
    setStorageError('');
    if (next.id !== starter.deckId || canonical(source) !== starter.revision) void saveDeck(source).catch(() => setStorageError('Could not save this deck to the library.'));
    setRecorder(nextRecorder);
    playback.stop();
    setDeck(next); setGeneration(value => value + 1); setError(''); setLoadedNotice(true);
  }
  async function leavePractice() {
    ++loadId.current;
    exitRef.current();
    playback.stop();
    await recorder.finish('interrupted');
    setShowDecks(true);
  }
  function returnToPractice() {
    setHeaderInfo({ status: 'READY', progress: '0.0', paused: false, canPause: false, started: false });
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
  return <main className={showDecks ? undefined : "practice-screen"}>
    <div className={showDecks ? undefined : "practice-viewport"}>
    <header className="trainer-header">
      <div className="header-top">
        <div className="header-identity"><span className="header-kicker">PIANO TRAINER</span><h1 className="header-deck">{deck.title}</h1></div>
        <div className="header-actions"><button type="button" onClick={() => void leavePractice()}>My Decks</button><button type="button" aria-expanded={settingsOpen} aria-controls="trainer-settings" onClick={() => setSettingsOpen(value => !value)}>Settings</button></div>
      </div>
      {!showDecks && <div className="header-bottom">
        <div className="header-practice-controls"><button type="button" className={`practice-action ${headerInfo.started ? 'finish' : 'start'}`} onClick={headerInfo.started ? () => void leavePractice() : () => startRef.current()}>{headerInfo.started ? 'Finish Practice' : 'Start Practice'}</button><button type="button" onClick={() => pauseRef.current()} disabled={!headerInfo.canPause}>{headerInfo.paused ? 'Resume' : 'Pause'}</button></div>
        <div className="header-progress"><progress aria-label="Learning progress" max={100} value={Number(headerInfo.progress)}/><span>{headerInfo.progress}%</span></div>
      </div>}
    <div id="trainer-settings" className="trainer-settings" hidden={!settingsOpen}>
      <div className="settings-grid">
        <section className="settings-group" aria-labelledby="settings-playback">
          <h2 id="settings-playback">Playback &amp; Tempo</h2>
          <div className="settings-controls">
            <button type="button" aria-pressed={playback.enabled} onClick={() => playback.setEnabled(!playback.enabled)}>Phrase Playback {playback.enabled ? 'On' : 'Off'}</button>
            <label>Tempo <span><input type="number" min="30" max="240" step="1" value={tempoDraft} onChange={event => { const text = event.target.value; setTempoDraft(text); playback.setTempo(Number(text)); }} onBlur={() => setTempoDraft(String(playback.tempo))}/> BPM</span></label>
            <label>Notes per Beat <select value={playback.notesPerBeat} onChange={event => playback.setNotesPerBeat(Number(event.target.value) as NotesPerBeat)}><option value={1}>1</option><option value={2}>2</option><option value={4}>4</option></select></label>
            <label className="settings-wide">Next Phrase Delay <span><input type="range" min="0" max="1" step="0.01" value={playback.delay} onChange={event => playback.setDelay(Number(event.target.value))}/> {playback.delay.toFixed(2)} s</span></label>
          </div>
        </section>
        <section className="settings-group" aria-labelledby="settings-audio">
          <h2 id="settings-audio">Audio &amp; Metronome</h2>
          <div className="settings-controls">
            <label>Phrase Volume <span><input type="range" min="0" max="100" value={playback.phraseVolume} onChange={event => playback.setVolume('phraseVolume', Number(event.target.value))}/> {playback.phraseVolume}%</span></label>
            <button type="button" aria-pressed={playback.metronome} onClick={() => playback.setMetronome(!playback.metronome)}>Metronome {playback.metronome ? 'On' : 'Off'}</button>
            <label className="settings-wide">Metronome Volume <span><input type="range" min="0" max="100" value={playback.metronomeVolume} onChange={event => playback.setVolume('metronomeVolume', Number(event.target.value))}/> {playback.metronomeVolume}%</span></label>
            <label className="audio-output settings-wide">Audio output <select value={audioOutput.supported ? audioOutput.selected : ''} disabled={!audioOutput.supported} onChange={event => audioOutput.select(event.target.value)}>
              <option value="">System default</option>
              {audioOutput.selected && !audioOutput.devices.some(device => device.deviceId === audioOutput.selected) && <option value={audioOutput.selected}>Saved output (availability unknown)</option>}
              {audioOutput.devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Audio output ${index + 1}`}</option>)}
            </select></label>
            {audioOutput.supported && <button className="settings-wide" type="button" onClick={audioOutput.allowDevices}>Allow microphone access to list outputs</button>}
            {!audioOutput.supported && <span className="settings-wide" role="status">This browser uses the system default audio output.</span>}
            {audioOutput.message && <span className="settings-wide" role="status">{audioOutput.message}</span>}
            {playback.audioError && <span className="settings-wide" role="status">{playback.audioError}</span>}
          </div>
        </section>
        <section className="settings-group" aria-labelledby="settings-physics">
          <h2 id="settings-physics">Learning Physics</h2>
          <div className="settings-controls">
            <PhysicsInput label="Falling speed" min={0.01} step={0.1} value={physics.fallingSpeed} onChange={value => updatePhysics({ ...physics, fallingSpeed: value })}/>
            <PhysicsInput label="Reward strength" min={1} max={100} step={1} value={physics.rewardStrength} onChange={value => updatePhysics({ ...physics, rewardStrength: value })}/>
            <PhysicsInput label="Unlock threshold" min={1} max={99} step={1} value={physics.unlockThreshold} onChange={value => updatePhysics({ ...physics, unlockThreshold: value })}/>
            <PhysicsInput label="Completion threshold" min={1} max={99} step={1} value={physics.completionThreshold} onChange={value => updatePhysics({ ...physics, completionThreshold: value })}/>
            <button className="settings-wide" type="button" onClick={() => updatePhysics({ ...DEFAULT_PHYSICS_SETTINGS })}>Reset to Defaults</button>
          </div>
        </section>
        <section className="settings-group" aria-labelledby="settings-deck">
          <h2 id="settings-deck">Deck Management</h2>
          <div className="deck-info"><span>{deck.title} · {deck.exercises.length} {deck.exercises.length === 1 ? 'exercise' : 'exercises'}</span><span role="status">{loadedNotice ? 'Deck loaded' : ''}</span></div>
          <div className="deck-load-actions">
            <label>Load Deck <input type="file" accept=".json,application/json" onChange={loadDeck}/></label>
            <button type="button" onClick={() => { setPasteError(''); pasteDialog.current?.showModal(); }}>Paste JSON</button>
          </div>
          {error && <p className="deck-error" role="alert">{error}</p>}
          {storageError && <p className="deck-error" role="status">{storageError}</p>}
          <a className="settings-launcher" href="../../" onClick={() => { exitRef.current(); void recorder.finish('interrupted'); }}>Launcher</a>
        </section>
      </div>
    </div>
    </header>
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
    {showDecks && <MyDecks starter={starter} onBack={returnToPractice} onPractice={saved => {
      ++loadId.current;
      try { applyDeckText(JSON.stringify(saved.content)); setShowDecks(false); }
      catch (reason) { setError(`Could not load deck: ${reason instanceof Error ? reason.message : String(reason)}`); setShowDecks(false); }
    }}/>} 
    {!showDecks && <div className="practice-layout">
      <PracticeSession key={generation} deck={deck} recorder={recorder} demonstrationRef={demonstrationRef} physics={physics} output={audioOutput.selected} exitRef={exitRef} pauseRef={pauseRef} startRef={startRef} onHeaderUpdate={onHeaderUpdate} onPracticeStart={onPracticeStart} onLog={log} nextAttemptId={nextAttemptId} playback={playback}/>
    </div>}
    </div>
    {!showDecks && <EventLog entries={entries} clear={clearLog}/>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
