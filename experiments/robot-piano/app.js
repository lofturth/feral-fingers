import { newSequence, scoreAttempt, noteName } from './scoring.mjs';
import { RECORD_SCHEMA_VERSION, DATABASE_VERSION, openRecordings, saveSession, saveAttempt, countCompleted, readAllRecordings } from './recordings.mjs';

const $ = id => document.getElementById(id);
const beatSeconds = 1;
const inputPreferenceKey = 'robot-piano-midi-input';
const sequenceChoiceKey = 'robot-piano-sequence-choice';
let sequence = [];
let currentMode = 'text';
let runId = 0;
let activeSessionId = null;
let continuousSession = false;
let currentAttempt = null;
let pendingNotes = new Map();
let allNotesReceived = false;
let midiAccess = null;
let input = null;
let audio = null;
let phase = 'ready';
let attemptRevealed = false;
let activeSounds = [];
let timers = [];
let targetTimes = [];
let played = [];
const attemptHistory = [];
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

async function refreshSavedCount(db) {
  const count = await countCompleted(db);
  $('saved-count').textContent = `${count} completed attempt${count === 1 ? '' : 's'} saved`;
}

database.then(async db => {
  await refreshSavedCount(db);
  $('storage-status').textContent = 'Recordings are stored in this browser.';
}).catch(error => {
  $('saved-count').textContent = 'Saved attempts unavailable';
  storageError('Recording unavailable', error);
});

function persistAttempt(status) {
  if (!currentAttempt) return;
  const record = currentAttempt;
  currentAttempt = null;
  record.status = status;
  record.endedAt = new Date().toISOString();
  queueWrite(async db => { await saveAttempt(db, record); await refreshSavedCount(db); })
    .then(() => { $('storage-status').textContent = `${status === 'completed' ? 'Completed' : 'Cancelled'} attempt saved locally.`; })
    .catch(error => storageError('Attempt not saved', error));
}

function beginSession(mode) {
  activeSessionId = crypto.randomUUID();
  continuousSession = $('continuous-on').checked;
  const session = { schemaVersion: RECORD_SCHEMA_VERSION, sessionId: activeSessionId, startedAt: new Date().toISOString(), mode, continuous: continuousSession };
  queueWrite(db => saveSession(db, session))
    .catch(error => storageError('Session not saved', error));
}

function setPhase(next, message) {
  phase = next;
  $('phase').textContent = next === 'counting' ? 'Count in' : next === 'recording' ? 'Playing' : next === 'listening' ? 'Listening' : next === 'preparing' ? 'Preparing' : next === 'reviewing' ? 'Results' : 'Ready';
  $('status').textContent = message;
  $('stop').disabled = next === 'ready';
  $('audio-mode').disabled = next !== 'ready' || !input;
  $('text-mode').disabled = next !== 'ready' || !input;
  $('level').disabled = next !== 'ready';
  $('sequence-choice').disabled = next !== 'ready';
  $('continuous-choice').disabled = next !== 'ready';
}

function renderNotes(active = -1) {
  $('notes').replaceChildren(...sequence.map((pitch, index) => {
    const note = document.createElement('div');
    const hidden = currentMode === 'audio' && !attemptRevealed;
    note.className = `note${index === active ? ' active' : ''}`;
    note.textContent = hidden ? '?' : noteName(pitch);
    return note;
  }));
}

function schedule(fn, delayMs) { timers.push(setTimeout(fn, Math.max(0, delayMs))); }
function clearScheduled() {
  timers.forEach(clearTimeout);
  timers = [];
  for (const oscillator of activeSounds) { try { oscillator.stop(); } catch {} }
  activeSounds = [];
}

function sound(when, frequency, duration, volume = .14, piano = false) {
  const harmonics = piano ? [1, .22, .07] : [1];
  harmonics.forEach((strength, index) => {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency * (index + 1);
    gain.gain.setValueAtTime(.0001, when);
    gain.gain.exponentialRampToValueAtTime(volume * strength, when + (piano ? .005 : .008));
    if (piano) gain.gain.exponentialRampToValueAtTime(volume * strength * .38, when + .16);
    gain.gain.exponentialRampToValueAtTime(.0001, when + duration);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(when);
    oscillator.stop(when + duration + .01);
    activeSounds.push(oscillator);
  });
}

function timingReference() {
  if (audio.getOutputTimestamp) {
    const stamp = audio.getOutputTimestamp();
    if (stamp.contextTime > 0 && stamp.performanceTime > 0)
      return { source: 'getOutputTimestamp', audioContextTimeSeconds: stamp.contextTime, performanceTimeMs: stamp.performanceTime, performanceTimeOriginMs: performance.timeOrigin };
  }
  return { source: 'currentTimeFallback', audioContextTimeSeconds: audio.currentTime, performanceTimeMs: performance.now(), performanceTimeOriginMs: performance.timeOrigin };
}

function audioTimeToPerformanceMs(contextTime, reference) {
  return reference.performanceTimeMs + (contextTime - reference.audioContextTimeSeconds) * 1000;
}

async function prepareAudio() {
  audio ??= new AudioContext();
  await audio.resume();
}

function firstExpectedAudioTime(mode, start, noteCount, secondsPerBeat) {
  return start + (mode === 'audio' ? noteCount : 4) * secondsPerBeat;
}

async function startExercise(mode, automatic = false) {
  if (phase !== 'ready' || !input) return;
  const thisRun = ++runId;
  if (!automatic) beginSession(mode);
  currentMode = mode;
  if ($('new-sequence').checked || !sequence.length) {
    sequence = newSequence(Number($('level').value));
  }
  attemptRevealed = false;
  currentAttempt = {
    schemaVersion: RECORD_SCHEMA_VERSION,
    sessionId: activeSessionId,
    attemptId: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    mode,
    pitchLevel: Number($('level').value),
    tempoBpm: 60,
    settings: { sequenceChoice: $('new-sequence').checked ? 'new' : 'same', continuous: continuousSession },
    targetMidiPitches: [...sequence],
    targetPlaybackAudioTimesSeconds: [],
    targetPlaybackPerformanceTimesMs: [],
    expectedAudioTimesSeconds: [],
    expectedPerformanceTimesMs: [],
    recordingWindowStartPerformanceMs: null,
    timingReference: null,
    rawMidiEvents: [],
    scoredNoteOnEventIndices: [],
  };
  renderNotes();
  $('result').hidden = true;
  setPhase('preparing', 'Preparing exercise…');
  try { await prepareAudio(); } catch { if (thisRun === runId) cancel(); return; }
  if (thisRun !== runId) return;
  clearScheduled();
  played = [];
  pendingNotes = new Map();
  allNotesReceived = false;
  const targetStart = audio.currentTime + .15;
  const firstExpected = firstExpectedAudioTime(mode, targetStart, sequence.length, beatSeconds);
  const reference = timingReference();
  const expectedAudioTimes = sequence.map((_, index) => firstExpected + index * beatSeconds);
  targetTimes = expectedAudioTimes.map(time => audioTimeToPerformanceMs(time, reference));
  currentAttempt.timingReference = reference;
  currentAttempt.expectedAudioTimesSeconds = expectedAudioTimes;
  currentAttempt.expectedPerformanceTimesMs = [...targetTimes];
  currentAttempt.recordingWindowStartPerformanceMs = targetTimes[0] - 250;
  if (mode === 'audio') {
    currentAttempt.targetPlaybackAudioTimesSeconds = sequence.map((_, index) => targetStart + index * beatSeconds);
    currentAttempt.targetPlaybackPerformanceTimesMs = currentAttempt.targetPlaybackAudioTimesSeconds.map(time => audioTimeToPerformanceMs(time, reference));
    sequence.forEach((pitch, index) => {
      const when = targetStart + index * beatSeconds;
      sound(when, 440 * 2 ** ((pitch - 69) / 12), Math.min(.6, beatSeconds * .7), .12, true);
      schedule(() => renderNotes(index), audioTimeToPerformanceMs(when, reference) - performance.now());
    });
    setPhase('listening', `Listen to the ${sequence.length} notes.`);
  } else {
    setPhase('counting', 'Count in: 1 · 2 · 3 · 4');
    for (let beat = 0; beat < 4; beat++) sound(targetStart + beat * beatSeconds, beat === 0 ? 880 : 660, .09, .16);
  }
  schedule(() => { renderNotes(); setPhase('recording', `Play the ${sequence.length} notes now.`); }, targetTimes[0] - performance.now() - 250);
  schedule(() => finishAttempt(), targetTimes.at(-1) - performance.now() + 2000);
}

function finishAttempt() {
  if (phase !== 'counting' && phase !== 'recording') return;
  clearScheduled();
  persistAttempt('completed');
  attemptRevealed = true;
  renderNotes();
  const result = scoreAttempt(sequence, played, targetTimes);
  attemptHistory.push({ sequence: [...sequence], played: [...played], result });
  $('result').hidden = false;
  $('accuracy').textContent = `${result.correct} / ${sequence.length} pitches correct`;
  $('rows').replaceChildren(...result.rows.map((row, index) => {
    const div = document.createElement('div');
    div.className = 'row';
    const target = document.createElement('span');
    target.textContent = `${index + 1}. ${noteName(row.target)}`;
    const actual = document.createElement('span');
    actual.className = row.correct ? 'good' : 'bad';
    actual.textContent = row.played === null ? 'Missed' : `${noteName(row.played)} (MIDI ${row.played}) ${row.correct ? '✓' : '✕'}`;
    const timing = document.createElement('span');
    timing.textContent = row.error === null ? '—' : `${row.error >= 0 ? '+' : ''}${row.error} ms`;
    div.append(target, actual, timing);
    return div;
  }));
  const format = value => value === null ? '—' : `${value >= 0 ? '+' : ''}${value} ms`;
  $('offset').textContent = format(result.offset);
  $('relative').textContent = result.relativeError === null ? '—' : `${result.relativeError} ms`;
  $('mae').textContent = result.meanAbsoluteError === null ? '—' : `${result.meanAbsoluteError} ms`;
  if (continuousSession) {
    const completedRun = runId;
    setPhase('reviewing', 'Results shown for 2 seconds. Next exercise starts automatically.');
    schedule(() => {
      if (runId !== completedRun || !continuousSession || !input) return;
      setPhase('ready', 'Starting next exercise…');
      startExercise(currentMode, true);
    }, 2000);
  } else {
    activeSessionId = null;
    setPhase('ready', played.length ? 'Attempt measured. Choose Audio or Text again.' : 'No MIDI notes received. Choose Audio or Text to try again.');
  }
}

async function copyResults() {
  const attempt = attemptHistory.at(-1);
  if (!attempt) return;
  const { result } = attempt;
  const signed = value => value === null ? '—' : `${value >= 0 ? '+' : ''}${value} ms`;
  const lines = [
    'Robot Piano — last attempt',
    `${result.correct} / ${result.rows.length} pitches correct`,
    ...result.rows.map((row, index) => `${index + 1}. ${noteName(row.target)} → ${row.played === null ? 'Missed' : `${noteName(row.played)} (MIDI ${row.played}) ${row.correct ? '✓' : '✕'}`} · ${signed(row.error)}`),
    `Starting offset: ${signed(result.offset)}`,
    `Relative timing error: ${result.relativeError === null ? '—' : `${result.relativeError} ms`}`,
    `Mean absolute error: ${result.meanAbsoluteError === null ? '—' : `${result.meanAbsoluteError} ms`}`,
    'Timing is measured against scheduled audio; MIDI and audio device latency are not calibrated.',
  ];
  try {
    await navigator.clipboard.writeText(lines.join('\n'));
    $('copy').textContent = 'Copied!';
    setTimeout(() => { $('copy').textContent = 'Copy results'; }, 2000);
  } catch {
    $('status').textContent = 'Could not copy results. Check clipboard permission for this site.';
  }
}

async function recordingExport() {
  await latestWrite.catch(() => {});
  if (exportSnapshot) return exportSnapshot;
  const db = await database;
  const { sessions, attempts } = await readAllRecordings(db);
  const data = { exportFormatVersion: 1, databaseVersion: DATABASE_VERSION, recordingSchemaVersion: RECORD_SCHEMA_VERSION, exportedAt: new Date().toISOString(), sessions, attempts };
  exportSnapshot = { json: JSON.stringify(data, null, 2), date: data.exportedAt.slice(0, 10), sessions: sessions.length, attempts: attempts.length };
  return exportSnapshot;
}

async function copyJson() {
  try {
    const { json } = await recordingExport();
    await navigator.clipboard.writeText(json);
    showExportFeedback('Recording JSON copied.');
  } catch (error) { showExportFeedback(`Copy failed: ${error?.message || 'clipboard unavailable'}`); }
}

async function downloadJson() {
  try {
    const { json, date, sessions, attempts } = await recordingExport();
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `robot-piano-recordings-${date}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showExportFeedback(`Downloaded ${sessions} session${sessions === 1 ? '' : 's'} and ${attempts} saved attempt${attempts === 1 ? '' : 's'}.`);
  } catch (error) { showExportFeedback(`Download failed: ${error?.message || 'export unavailable'}`); }
}

function cancel() {
  const wasReviewing = phase === 'reviewing';
  runId++;
  clearScheduled();
  persistAttempt('cancelled');
  continuousSession = false;
  activeSessionId = null;
  if (!wasReviewing) attemptRevealed = false;
  renderNotes();
  setPhase('ready', wasReviewing ? 'Continuous practice stopped.' : 'Cancelled. Ready when you are.');
}

function onMidi(event) {
  const [status, pitch, velocity] = event.data;
  const type = status & 0xf0;
  const noteOn = type === 0x90 && velocity > 0;
  const noteOff = type === 0x80 || (type === 0x90 && velocity === 0);
  if (!noteOn && !noteOff) return;
  const rawIndex = currentAttempt?.rawMidiEvents.length;
  if (currentAttempt) currentAttempt.rawMidiEvents.push({
    type: noteOn ? 'noteOn' : 'noteOff',
    pitch,
    velocity,
    timestampMs: event.timeStamp,
    statusByte: status,
    channel: status & 0x0f,
  });
  if (noteOff && phase === 'recording') {
    const remaining = pendingNotes.get(pitch) || 0;
    if (remaining > 0) pendingNotes.set(pitch, remaining - 1);
    if (allNotesReceived && [...pendingNotes.values()].every(count => count === 0)) finishAttempt();
    return;
  }
  if (!noteOn) return;
  if (phase === 'ready') {
    $('status').textContent = `MIDI received: ${noteName(pitch)} (MIDI ${pitch}, velocity ${velocity}). Ready to play.`;
    return;
  }
  if (phase !== 'recording' || played.length >= sequence.length) return;
  played.push({ pitch, velocity, time: event.timeStamp });
  currentAttempt.scoredNoteOnEventIndices.push(rawIndex);
  pendingNotes.set(pitch, (pendingNotes.get(pitch) || 0) + 1);
  $('status').textContent = `Received ${played.length} of ${sequence.length} notes.`;
  if (played.length === sequence.length) allNotesReceived = true;
}

async function selectInput(id) {
  if (input) input.onmidimessage = null;
  input = midiAccess.inputs.get(id) ?? null;
  if (input) {
    try {
      await input.open();
      input.onmidimessage = onMidi;
      $('device').textContent = input.name || 'Unnamed MIDI input';
      $('status').textContent = `Connected to ${input.name || 'MIDI input'}. Play a key to check incoming notes.`;
    } catch (error) {
      input = null;
      $('device').textContent = `Could not open MIDI input: ${error.message || error.name}`;
    }
  }
  $('audio-mode').disabled = phase !== 'ready' || !input;
  $('text-mode').disabled = phase !== 'ready' || !input;
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
  const inputs = [...midiAccess.inputs.values()];
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
    $('device').textContent = 'No MIDI input detected';
    $('status').textContent = 'Check the keyboard’s USB connection and power, then click Connect keyboard.';
    $('audio-mode').disabled = true;
    $('text-mode').disabled = true;
    $('save-input').disabled = true;
  }
  if (!input && phase !== 'ready') cancel();
}

async function connect() {
  $('device').textContent = 'Requesting MIDI access…';
  $('status').textContent = 'Look for a browser MIDI permission prompt.';
  $('connect').disabled = true;
  if (!navigator.requestMIDIAccess) {
    $('device').textContent = 'Web MIDI unavailable in this browser';
    $('status').textContent = 'Open this page in Chrome or Edge on localhost.';
    $('connect').disabled = false;
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
$('copy').addEventListener('click', copyResults);
$('copy-json').addEventListener('click', copyJson);
$('download-json').addEventListener('click', downloadJson);
$('inputs').addEventListener('change', event => selectInput(event.target.value));
$('level').addEventListener('change', () => { sequence = []; attemptRevealed = false; $('result').hidden = true; renderNotes(); $('status').textContent = 'Choose Audio or Text to start at this level.'; });
$('sequence-choice').addEventListener('change', () => {
  try { sessionStorage.setItem(sequenceChoiceKey, $('same-sequence').checked ? 'same' : 'new'); } catch {}
});
$('audio-mode').addEventListener('click', () => startExercise('audio'));
$('text-mode').addEventListener('click', () => startExercise('text'));
$('stop').addEventListener('click', cancel);
try {
  const same = sessionStorage.getItem(sequenceChoiceKey) === 'same';
  $('same-sequence').checked = same;
  $('new-sequence').checked = !same;
} catch {}
$('continuous-off').checked = true;
$('continuous-on').checked = false;
renderNotes();
showInputPreference();
