import { noteName } from './scoring.mjs';
import { RECORD_SCHEMA_VERSION, DATABASE_VERSION, openRecordings, saveSession, readAllRecordings } from './recordings.mjs';
import { composition } from './a-little-jazzy-walk.mjs';
import { tonics, scalePitches, degree, displayNote, interval } from './note-display.mjs';

const $ = id => document.getElementById(id);
const inputPreferenceKey = 'robot-piano-midi-input';
const settingsKey = 'robot-piano-settings';
const replayControlPitch = 48;
const sectionOrder = ['A', 'B', 'C', 'D', 'full'];
const continuousOrder = [['A'], ['B'], ['C'], ['D'], ['A', 'B'], ['C', 'D'], ['A', 'B', 'C', 'D']];
let activeSessionId = null;
let activeSessionRecord = null;
let lastSessionId = null;
let sessionEventCount = 0;
let sessionReady = false;
let sessionClosing = false;
let midiAccess = null;
let input = null;
let midiConnecting = false;
let audio = null;
let activeSounds = [];
let phrasePlaying = false;
let audioActivationPending = false;
let audioActivationId = 0;
let playbackTimer = null;
let recentNotes = [];
let continuousStage = 'idle';
let continuousArmed = false;
let continuousRange = ['A'];
let continuousAnchor = 'A';
let continuousIndex = 0;
let continuousCompleted = new Set();
let continuousTimer = null;
let continuousGeneration = 0;
const heldNotes = new Map();
const heldControlNotes = new Map();
let displayStartPitch = 48;
const database = openRecordings();
let latestWrite = Promise.resolve();
let exportSnapshot = null;
let exportFeedbackTimer = null;

function showExportFeedback(message) {
  $('export-status').textContent = message;
  clearTimeout(exportFeedbackTimer);
  exportFeedbackTimer = setTimeout(() => { $('export-status').textContent = ''; }, 3000);
}

function queueWrite(work) {
  const job = latestWrite.catch(() => {}).then(() => database).then(async db => {
    const result = await work(db);
    exportSnapshot = null;
    return result;
  });
  latestWrite = job;
  return job;
}

function storageError(action, error) {
  $('storage-status').textContent = `${action}: ${error?.message || 'browser storage failed'}`;
}

function showReplayDiagnostic(message) {
  $('replay-diagnostic').textContent = message;
}

function renderPiano() {
  const tonic = Number($('tonic').value);
  const mode = $('scale').value;
  const held = [...new Set(heldNotes.values())].sort((a, b) => a - b);
  const inScale = scalePitches(tonic, mode);
  for (const key of $('piano').children) {
    const pitch = displayStartPitch + Number(key.dataset.offset);
    key.dataset.pitch = String(pitch);
    const control = pitch >= 48 && pitch <= 50;
    key.classList.toggle('control-key', control);
    key.classList.toggle('held', control ? [...heldControlNotes.values()].includes(pitch) : held.includes(pitch));
    key.classList.toggle('outside-scale', !control && !inScale.includes(pitch % 12));
  }
  $('piano-range').textContent = `${noteName(displayStartPitch)}–${noteName(displayStartPitch + 36)} · MIDI ${displayStartPitch}–${displayStartPitch + 36}`;
  $('piano').setAttribute('aria-label', `Live piano ${noteName(displayStartPitch)} through ${noteName(displayStartPitch + 36)}`);
  $('octave-down').disabled = displayStartPitch === 0;
  $('octave-up').disabled = displayStartPitch === 84;
  const description = pitch => `${displayNote(pitch, tonic, mode)} (${degree(pitch, tonic)})`;
  $('note-readout').textContent = held.length === 0 ? ''
    : held.length === 2 ? `${held.map(description).join(' · ')} — ${held[1] - held[0]} semitones · ${interval(held[1] - held[0])}`
    : held.map(description).join(' · ');
}

function shiftPiano(octaves) {
  displayStartPitch = Math.max(0, Math.min(84, displayStartPitch + octaves * 12));
  renderPiano();
}

function setupPiano() {
  for (const [name, pitch] of tonics) {
    const option = document.createElement('option');
    option.value = pitch;
    option.textContent = name;
    $('tonic').append(option);
  }
  renderPiano();
}

function renderSectionSelection() {
  for (const button of $('section-buttons').querySelectorAll('button')) {
    const selected = button.dataset.section === 'full' ? continuousRange.length === 4 : continuousRange.includes(button.dataset.section);
    button.setAttribute('aria-pressed', String(selected));
  }
}

function continuousKey(range = continuousRange) { return range.join('+'); }

function nextContinuousRange() {
  if (continuousRange.length === 4) return null;
  const index = continuousOrder.findIndex(range => continuousKey(range) === continuousKey());
  if (index >= 0) return continuousOrder[index + 1] || null;
  const after = sectionOrder.indexOf(continuousRange.at(-1)) + 1;
  return after < 4 ? [sectionOrder[after]] : continuousOrder.at(-1);
}

function renderPractice() {
  $('practice-heading').textContent = continuousStage === 'complete' ? 'PHRASES COMPLETE' : `PHRASE PRACTICE — ${continuousKey() === 'A+B+C+D' ? 'ALL' : continuousKey()}`;
  $('practice-state').textContent = continuousStage === 'explore' && !continuousArmed ? 'Explore · Press Play to begin'
    : ({ idle: 'Press Start to begin at phrase A', explore: 'Explore · Find the phrase', repeat: 'Repeat · Play it correctly from the first note', transition: 'Phrase complete · Moving on', complete: 'All phrases complete!' })[continuousStage];
  const shown = new Set([...continuousCompleted, continuousKey()]);
  $('continuous-progress').replaceChildren(...[...shown].map(key => {
    const step = document.createElement('span');
    step.textContent = `${continuousCompleted.has(key) ? '✓ ' : ''}${key === 'A+B+C+D' ? 'All' : key}`;
    step.classList.toggle('completed', continuousCompleted.has(key));
    step.classList.toggle('current', key === continuousKey() && continuousStage !== 'complete');
    return step;
  }));
  $('continuous-next').hidden = continuousStage === 'idle' || !nextContinuousRange();
  $('continuous-next').textContent = nextContinuousRange() ? `Next: ${continuousKey(nextContinuousRange()) === 'A+B+C+D' ? 'All' : continuousKey(nextContinuousRange())}` : '';
  renderSectionSelection();
}

function cancelContinuous(clearCompleted = true) {
  ++continuousGeneration;
  clearTimeout(continuousTimer);
  continuousTimer = null;
  continuousStage = 'idle';
  continuousArmed = false;
  continuousIndex = 0;
  recentNotes = [];
  if (clearCompleted) continuousCompleted.clear();
  renderPractice();
}

function exploreContinuous(armed = true) {
  ++continuousGeneration;
  clearTimeout(continuousTimer);
  continuousTimer = null;
  continuousStage = 'explore';
  continuousArmed = armed;
  continuousIndex = 0;
  recentNotes = [];
  renderPractice();
}

function continuousChime(repeat, final = false) {
  if (audio?.state !== 'running') return;
  const now = audio.currentTime + .01;
  if (!repeat) sound(now, 1318.51, .18, .034, false, false, 'bell');
  else {
    sound(now, 523.25, .34, .047, false, false, 'warm');
    sound(now + .22, 659.25, final ? .65 : .5, .05, false, false, 'warm');
  }
}

function selectContinuousRange(range, demonstrate = false) {
  interruptPhrase();
  continuousRange = [...range];
  $('section').value = range[0];
  exploreContinuous(demonstrate);
  $('match-status').textContent = '';
  if (demonstrate) playPhrase();
}

function restoreSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(settingsKey));
    if (!saved || typeof saved !== 'object') return;
    if (tonics.some(([, pitch]) => String(pitch) === saved.tonic)) $('tonic').value = saved.tonic;
    if (['major', 'minor'].includes(saved.scale)) $('scale').value = saved.scale;
    if (Number.isInteger(saved.displayStartPitch) && saved.displayStartPitch >= 0 && saved.displayStartPitch <= 84 && saved.displayStartPitch % 12 === 0) displayStartPitch = saved.displayStartPitch;
    renderPiano();
  } catch {}
}

function saveSettings() {
  try {
    localStorage.setItem(settingsKey, JSON.stringify({ tonic: $('tonic').value, scale: $('scale').value, displayStartPitch }));
    $('settings-status').textContent = 'Settings saved';
    setTimeout(() => { $('settings-status').textContent = ''; }, 2500);
  } catch {
    $('settings-status').textContent = 'Could not save settings';
  }
}

function updateStartButtons() {
  $('start-session').disabled = !!activeSessionId || !sessionReady || sessionClosing;
}

function renderSession() {
  $('session-state').textContent = activeSessionId ? 'Recording' : 'No active session';
  $('session-count').textContent = activeSessionId ? String(sessionEventCount) : '—';
  $('session-start').textContent = activeSessionRecord?.startedAt ? new Date(activeSessionRecord.startedAt).toLocaleString() : '—';
  $('end-session').disabled = !activeSessionId || sessionClosing;
  $('copy-session-json').disabled = !lastSessionId;
  $('download-session-json').disabled = !lastSessionId;
  $('session-hint').textContent = activeSessionId ? 'MIDI notes are recorded until you end this session.' : lastSessionId ? 'Session export uses the most recent session.' : 'Start a session to record MIDI notes.';
}

database.then(async db => {
  const { sessions } = await readAllRecordings(db);
  const newestFirst = sessions.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
  const active = newestFirst.find(session => session.status === 'active');
  activeSessionRecord = active || null;
  activeSessionId = active?.sessionId || null;
  lastSessionId = activeSessionId || newestFirst[0]?.sessionId || null;
  sessionEventCount = active?.rawMidiEvents?.length || 0;
  $('storage-status').textContent = 'Recordings are stored in this browser.';
}).catch(error => {
  storageError('Recording unavailable', error);
}).finally(() => {
  sessionReady = true;
  renderSession();
  updateStartButtons();
});

function beginSession() {
  if (activeSessionId || !sessionReady || sessionClosing) return Promise.resolve();
  activeSessionId = crypto.randomUUID();
  activeSessionRecord = { schemaVersion: RECORD_SCHEMA_VERSION, sessionId: activeSessionId, startedAt: new Date().toISOString(), mode: 'freePractice', status: 'active', rawMidiEvents: [] };
  lastSessionId = activeSessionId;
  sessionEventCount = 0;
  renderSession();
  updateStartButtons();
  const session = activeSessionRecord;
  return queueWrite(db => saveSession(db, session))
    .catch(error => storageError('Session not saved', error));
}

function sound(when, frequency, duration, volume = .14, piano = false, trackPhrase = true, timbre = 'sine') {
  const harmonics = timbre === 'bell' ? [1, .23] : timbre === 'warm' ? [1, .16] : piano ? [1, .22, .07] : [1];
  harmonics.forEach((strength, index) => {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency * (timbre === 'bell' && index === 1 ? 2.71 : index + 1);
    gain.gain.setValueAtTime(.0001, when);
    gain.gain.exponentialRampToValueAtTime(volume * strength, when + (timbre === 'bell' ? .003 : timbre === 'warm' ? .018 : piano ? .005 : .008));
    if (piano) gain.gain.exponentialRampToValueAtTime(volume * strength * .38, when + .16);
    if (timbre === 'warm') gain.gain.exponentialRampToValueAtTime(volume * strength * .45, when + .18);
    gain.gain.exponentialRampToValueAtTime(.0001, when + duration);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(when);
    oscillator.stop(when + duration + .01);
    if (trackPhrase) activeSounds.push(oscillator);
  });
}

function rollingMatch(pitch, target) {
  recentNotes.push(pitch);
  if (recentNotes.length > target.length) recentNotes.shift();
  return recentNotes.length === target.length && recentNotes.every((note, index) => note === target[index]);
}

function observePhraseNote(pitch) {
  const target = composition.sections.filter(section => continuousRange.includes(section.id))
    .flatMap(section => section.notes.map(note => note.pitch));
  if (!target.length || !continuousArmed) return;
  if (continuousStage === 'explore') {
    if (!rollingMatch(pitch, target)) return;
    continuousStage = 'repeat';
    continuousIndex = 0;
    recentNotes = [];
    continuousChime(false);
    renderPractice();
    return;
  }
  if (continuousStage !== 'repeat') return;
  if (pitch !== target[continuousIndex]) {
    exploreContinuous();
    return;
  }
  if (++continuousIndex !== target.length) return;
  continuousCompleted.add(continuousKey());
  const nextRange = nextContinuousRange();
  continuousStage = nextRange ? 'transition' : 'complete';
  continuousChime(true, !nextRange);
  renderPractice();
  if (nextRange) {
    const generation = ++continuousGeneration;
    continuousTimer = setTimeout(() => {
      if (generation !== continuousGeneration) return;
      continuousAnchor = nextRange[0];
      selectContinuousRange(nextRange, true);
    }, 700);
  }
}

async function prepareAudio() {
  if (!audio) {
    audio = new AudioContext();
    audio.onstatechange = renderAudioState;
  }
  if (audio.state !== 'running') await audio.resume();
  if (audio.state !== 'running') throw new Error('Audio is still suspended');
  renderAudioState();
}

function renderAudioState() {
  const ready = audio?.state === 'running';
  $('audio-state').textContent = ready ? 'Audio Ready' : 'Audio Off';
  $('enable-audio').disabled = ready;
}

async function enableAudio() {
  ++audioActivationId;
  audioActivationPending = false;
  $('status').textContent = 'Enabling audio…';
  try {
    await prepareAudio();
    $('status').textContent = 'Audio ready. Use C3 or Play when you want to listen.';
  } catch (error) {
    renderAudioState();
    $('status').textContent = `Could not enable audio: ${error.message || error.name}`;
  }
}

function renderPlaybackButton() {
  $('play-phrase').textContent = phrasePlaying ? '■ Stop' : '▶ Play';
  $('play-phrase').setAttribute('aria-label', phrasePlaying ? 'Stop phrase' : 'Play phrase');
}

function stopPhrase() {
  ++audioActivationId;
  audioActivationPending = false;
  clearTimeout(playbackTimer);
  playbackTimer = null;
  for (const oscillator of activeSounds) { try { oscillator.stop(audio.currentTime); } catch {} }
  activeSounds = [];
  phrasePlaying = false;
  renderPlaybackButton();
  $('status').textContent = 'Phrase stopped.';
}

function interruptPhrase() {
  if (phrasePlaying || audioActivationPending) stopPhrase();
}

async function playPhrase(fromMidi = false) {
  if (phrasePlaying) {
    stopPhrase();
    cancelContinuous(false);
    if (fromMidi) showReplayDiagnostic(`Replay received · audio ${audio?.state || 'not created'} · stopped`);
    return;
  }
  if (fromMidi && audioActivationPending) {
    showReplayDiagnostic(`Replay received · audio ${audio?.state || 'not created'} · activation pending`);
    return;
  }
  exploreContinuous();
  const activationId = ++audioActivationId;
  audioActivationPending = true;
  let beforeState = audio?.state || 'not created';
  try {
    audio ??= new AudioContext();
    audio.onstatechange = renderAudioState;
    beforeState = audio.state;
    if (fromMidi) showReplayDiagnostic(`Replay received · audio ${beforeState} → activating…`);
    if (fromMidi && beforeState !== 'running') setTimeout(() => {
      if (activationId === audioActivationId && audioActivationPending && audio.state !== 'running')
        showReplayDiagnostic(`Replay received · audio ${beforeState} → ${audio.state} · waiting for browser activation`);
    }, 1200);
    if (fromMidi && audio.state !== 'running') $('status').textContent = `Audio ${audio.state}. Click Play once to enable audio, then use C3 to replay.`;
    await prepareAudio();
    if (activationId !== audioActivationId) {
      if (fromMidi) showReplayDiagnostic(`Replay received · audio ${beforeState} → ${audio.state} · superseded by browser action`);
      return;
    }
    audioActivationPending = false;
    phrasePlaying = true;
    renderPlaybackButton();
    $('status').textContent = 'Phrase playing.';
    const secondsPerBeat = 60 / composition.tempoBpm;
    const start = audio.currentTime + 0.1;
    let elapsedBeats = 0;
    const sections = composition.sections.filter(section => continuousRange.includes(section.id));
    for (const section of sections) {
      for (const note of section.notes) {
        sound(start + elapsedBeats * secondsPerBeat,
          440 * 2 ** ((note.pitch - 69) / 12),
          note.durationBeats * secondsPerBeat, .12 * (note.velocity ?? 85) / 85, true);
        elapsedBeats += note.durationBeats;
      }
    }
    if (fromMidi) showReplayDiagnostic(`Replay received · audio ${beforeState} → ${audio.state} · scheduled`);
    playbackTimer = setTimeout(() => {
      phrasePlaying = false;
      activeSounds = [];
      playbackTimer = null;
      renderPlaybackButton();
    }, (start + elapsedBeats * secondsPerBeat - audio.currentTime) * 1000);
  } catch (error) {
    if (activationId !== audioActivationId) return;
    exploreContinuous();
    audioActivationPending = false;
    phrasePlaying = false;
    renderPlaybackButton();
    $('status').textContent = fromMidi ? `Audio ${audio?.state || 'unavailable'}. Click Play once to enable audio, then use C3 to replay.` : `Playback unavailable: ${error.message || error.name}`;
    if (fromMidi) showReplayDiagnostic(`Replay received · audio ${beforeState} → ${audio?.state || 'unavailable'} · ${audio?.state === 'suspended' ? 'blocked' : 'failed'}: ${error.message || error.name}`);
  }
}

async function recordingExport() {
  await latestWrite.catch(() => {});
  if (exportSnapshot) return exportSnapshot;
  const db = await database;
  const { sessions, attempts } = await readAllRecordings(db);
  const data = { exportFormatVersion: 1, databaseVersion: DATABASE_VERSION, recordingSchemaVersion: RECORD_SCHEMA_VERSION, exportedAt: new Date().toISOString(), sessions, attempts };
  exportSnapshot = { data, json: JSON.stringify(data, null, 2), date: data.exportedAt.slice(0, 10), sessions: sessions.length, attempts: attempts.length };
  return exportSnapshot;
}

async function sessionRecordingExport() {
  const sessionId = activeSessionId || lastSessionId;
  if (!sessionId) throw new Error('No session is available to export.');
  const all = await recordingExport();
  const session = all.data.sessions.find(item => item.sessionId === sessionId);
  if (!session) throw new Error('This session has not been saved.');
  const attempts = all.data.attempts.filter(attempt => attempt.sessionId === sessionId);
  const data = { ...all.data, sessions: [session], attempts };
  return { json: JSON.stringify(data, null, 2), date: all.date, sessions: 1, attempts: attempts.length, sessionId };
}

async function copyJson(scope) {
  try {
    const { json } = await (scope === 'session' ? sessionRecordingExport() : recordingExport());
    await navigator.clipboard.writeText(json);
    showExportFeedback(`${scope === 'session' ? 'Session' : 'All recording'} JSON copied.`);
  } catch (error) { showExportFeedback(`Copy failed: ${error?.message || 'clipboard unavailable'}`); }
}

async function downloadJson(scope) {
  try {
    const { json, date, sessions, attempts, sessionId } = await (scope === 'session' ? sessionRecordingExport() : recordingExport());
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = scope === 'session' ? `robot-piano-session-${sessionId}-${date}.json` : `robot-piano-recordings-${date}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showExportFeedback(`Downloaded ${sessions} session${sessions === 1 ? '' : 's'} and ${attempts} saved attempt${attempts === 1 ? '' : 's'}.`);
  } catch (error) { showExportFeedback(`Download failed: ${error?.message || 'export unavailable'}`); }
}

async function endSession() {
  if (!activeSessionId || sessionClosing) return;
  sessionClosing = true;
  renderSession();
  updateStartButtons();
  const ended = { ...activeSessionRecord, status: 'ended', endedAt: new Date().toISOString() };
  try {
    await queueWrite(db => saveSession(db, ended));
    lastSessionId = ended.sessionId;
    activeSessionId = null;
    activeSessionRecord = null;
    sessionEventCount = 0;
    $('status').textContent = 'Session ended. Start another session when ready.';
  } catch (error) { storageError('Session not ended', error); }
  sessionClosing = false;
  renderSession();
  updateStartButtons();
}

function onMidi(event) {
  const [status, pitch, velocity] = event.data;
  const type = status & 0xf0;
  const noteOn = type === 0x90 && velocity > 0;
  const noteOff = type === 0x80 || (type === 0x90 && velocity === 0);
  if (!noteOn && !noteOff) return;
  if (pitch >= replayControlPitch && pitch <= 50) {
    if (pitch === replayControlPitch && noteOn) showReplayDiagnostic(`Replay received · audio ${audio?.state || 'not created'}`);
    const heldKey = `${status & 0x0f}:${pitch}`;
    if (noteOn) heldControlNotes.set(heldKey, pitch);
    else heldControlNotes.delete(heldKey);
    renderPiano();
    if (noteOn) {
      const action = pitch === 48 ? 'replay' : pitch === 49 ? 'previousSection' : 'nextSection';
      if (pitch !== replayControlPitch) {
        interruptPhrase();
        const order = sectionOrder.slice(0, 4);
        const index = order.indexOf($('section').value);
        continuousAnchor = order[(index + (pitch === 49 ? order.length - 1 : 1)) % order.length];
        selectContinuousRange([continuousAnchor]);
      }
      if (activeSessionRecord) {
        activeSessionRecord.controlActions ??= [];
        activeSessionRecord.controlActions.push({ action, pitch, velocity, timestampMs: event.timeStamp, channel: status & 0x0f, sectionId: $('section').value });
        const session = { ...activeSessionRecord, controlActions: [...activeSessionRecord.controlActions] };
        queueWrite(db => saveSession(db, session))
          .catch(error => storageError('Session control not saved', error));
      }
      if (pitch === replayControlPitch) playPhrase(true);
    }
    return;
  }
  if (noteOn) interruptPhrase();
  const heldKey = `${status & 0x0f}:${pitch}`;
  if (noteOn) heldNotes.set(heldKey, pitch);
  else heldNotes.delete(heldKey);
  renderPiano();
  const rawEvent = {
    type: noteOn ? 'noteOn' : 'noteOff',
    pitch,
    velocity,
    timestampMs: event.timeStamp,
    statusByte: status,
    channel: status & 0x0f,
  };
  if (activeSessionRecord) {
    activeSessionRecord.rawMidiEvents ??= [];
    activeSessionRecord.rawMidiEvents.push(rawEvent);
    const session = { ...activeSessionRecord, rawMidiEvents: [...activeSessionRecord.rawMidiEvents] };
    queueWrite(db => saveSession(db, session))
      .catch(error => storageError('Session MIDI not saved', error));
  }
  if (activeSessionRecord) {
    sessionEventCount++;
    $('session-count').textContent = String(sessionEventCount);
    if (noteOn) $('status').textContent = `Recorded ${noteName(pitch)} (MIDI ${pitch}, velocity ${velocity}).`;
  } else if (noteOn) {
    $('status').textContent = `MIDI received: ${noteName(pitch)} (MIDI ${pitch}). Start a session to record.`;
  }
  if (noteOn) observePhraseNote(pitch);
}

async function selectInput(id) {
  if (input) input.onmidimessage = null;
  heldNotes.clear();
  heldControlNotes.clear();
  renderPiano();
  input = midiAccess.inputs.get(id) ?? null;
  if (input) {
    const selected = input;
    try {
      await selected.open();
      if (input !== selected || selected.state !== 'connected') return;
      selected.onmidimessage = onMidi;
      $('device').textContent = selected.name || 'MIDI input connected';
      $('status').textContent = 'Keyboard ready.';
    } catch (error) {
      if (input !== selected) return;
      input = null;
      $('device').textContent = `Could not open MIDI input: ${error.message || error.name}`;
    }
  }
  $('save-input').disabled = !input;
}

function savedInput() {
  try { return JSON.parse(localStorage.getItem(inputPreferenceKey)); }
  catch { return null; }
}

function showInputPreference() {
  const saved = savedInput();
  $('forget-input').hidden = !saved;
  $('input-preference').textContent = saved
    ? `Saved choice: ${saved.name}. If unavailable, MiniLab 37 is preferred.`
    : 'Without a saved choice, MiniLab 37 is preferred when available.';
}

function preferredInput(inputs) {
  const saved = savedInput();
  return inputs.find(port => port.id === saved?.id)
    ?? inputs.find(port => port.name === saved?.name)
    ?? inputs.find(port => /arturia.*minilab|minilab.*37/i.test(port.name || ''))
    ?? inputs[0];
}

function updateInputs() {
  const inputs = [...midiAccess.inputs.values()].filter(port => port.state === 'connected');
  const picker = $('inputs');
  picker.replaceChildren(...inputs.map(port => {
    const option = document.createElement('option');
    option.value = port.id;
    option.textContent = port.name || 'Unnamed MIDI input';
    return option;
  }));
  picker.hidden = inputs.length < 2;
  if (input && inputs.includes(input)) picker.value = input.id;
  else if (inputs.length) selectInput(preferredInput(inputs).id);
  else {
    if (input) input.onmidimessage = null;
    input = null;
    heldNotes.clear();
    heldControlNotes.clear();
    renderPiano();
    $('device').textContent = 'Keyboard disconnected';
    $('status').textContent = 'Connect a keyboard to play.';
    $('save-input').disabled = true;
  }
}

async function connect() {
  if (midiConnecting) return;
  midiConnecting = true;
  $('device').textContent = 'Requesting MIDI access…';
  $('status').textContent = 'Connecting keyboard…';
  $('connect').disabled = true;
  if (!navigator.requestMIDIAccess) {
    $('device').textContent = 'Web MIDI unavailable in this browser';
    $('status').textContent = 'Open this page in Chrome or Edge on localhost.';
    $('connect').disabled = false;
    midiConnecting = false;
    return;
  }
  const waiting = setTimeout(() => {
    $('status').textContent = 'Still waiting for MIDI permission. Check the browser prompt or site settings.';
  }, 8000);
  try {
    midiAccess = await navigator.requestMIDIAccess();
    midiAccess.onstatechange = updateInputs;
    updateInputs();
  } catch (error) {
    $('device').textContent = `MIDI access failed: ${error.message || error.name}`;
    $('status').textContent = 'Check this site’s MIDI permission in your browser, then try again.';
  } finally {
    clearTimeout(waiting);
    $('connect').disabled = false;
    midiConnecting = false;
  }
}

$('connect').addEventListener('click', connect);
$('save-input').addEventListener('click', () => {
  if (!input) return;
  try {
    localStorage.setItem(inputPreferenceKey, JSON.stringify({ id: input.id, name: input.name }));
    showInputPreference();
    $('status').textContent = `Saved ${input.name || 'this MIDI input'} in this browser.`;
  } catch { $('status').textContent = 'This browser could not save the MIDI input choice.'; }
});
$('forget-input').addEventListener('click', () => {
  try {
    localStorage.removeItem(inputPreferenceKey);
    showInputPreference();
    const best = preferredInput([...midiAccess.inputs.values()]);
    if (best) { $('inputs').value = best.id; selectInput(best.id); }
  } catch { $('status').textContent = 'This browser could not clear the saved MIDI input choice.'; }
});
$('copy-json').addEventListener('click', () => copyJson('all'));
$('download-json').addEventListener('click', () => downloadJson('all'));
$('copy-session-json').addEventListener('click', () => copyJson('session'));
$('download-session-json').addEventListener('click', () => downloadJson('session'));
$('end-session').addEventListener('click', endSession);
$('inputs').addEventListener('change', event => selectInput(event.target.value));
$('start-session').addEventListener('click', beginSession);
$('play-phrase').addEventListener('click', () => playPhrase());
$('enable-audio').addEventListener('click', enableAudio);
$('tonic').addEventListener('change', renderPiano);
$('scale').addEventListener('change', renderPiano);
$('octave-down').addEventListener('click', () => shiftPiano(-1));
$('octave-up').addEventListener('click', () => shiftPiano(1));
$('save-settings').addEventListener('click', saveSettings);
$('section-buttons').addEventListener('click', event => {
  const button = event.target.closest('button[data-section]');
  if (!button) return;
  if (button.dataset.section === 'full') {
    continuousAnchor = 'A';
    selectContinuousRange(['A', 'B', 'C', 'D']);
  } else if (event.shiftKey) {
    const a = sectionOrder.indexOf(continuousAnchor);
    const b = sectionOrder.indexOf(button.dataset.section);
    selectContinuousRange(sectionOrder.slice(Math.min(a, b), Math.max(a, b) + 1));
  } else {
    continuousAnchor = button.dataset.section;
    selectContinuousRange([continuousAnchor]);
  }
});
$('continuous-start').addEventListener('click', () => {
  interruptPhrase();
  cancelContinuous();
  continuousAnchor = 'A';
  selectContinuousRange(['A'], true);
});
setupPiano();
restoreSettings();
renderSectionSelection();
renderAudioState();
renderPlaybackButton();
renderPractice();
connect();
showInputPreference();
