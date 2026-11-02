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
const presentationSounds = new Set();
const presentationPitches = [60, 62, 64];
const presentationBeatSeconds = 60 / 80;
const presentationNoteSeconds = .65;
let presentationRunning = false;
let presentationGeneration = 0;
let metronomeTimer = null;
let presentationProgress = 0;
let presentationComplete = false;
let presentationListeningAt = Infinity;
let presentationPlaybackEnd = Infinity;
let presentationAttempt = null;
let presentationMatchEvents = [];
let rollStartedAt = 0;
let rollStoppedAt = 0;
let rollFrame = null;
let rollNotes = [];
const rollHeld = new Map();
let rollZoomSeconds = 8;

function drawPianoRoll() {
  const canvas = $('piano-roll');
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return;
  const { width, height } = canvas;
  const left = 48, top = 30, rowHeight = 10, secondsVisible = rollZoomSeconds;
  const elapsed = rollStartedAt ? ((presentationRunning ? performance.now() : rollStoppedAt) - rollStartedAt) / 1000 : 0;
  const viewStart = Math.max(0, elapsed - secondsVisible);
  const pixelsPerSecond = (width - left - 10) / secondsVisible;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#f7f8fa';
  ctx.fillRect(0, 0, width, height);
  ctx.font = '11px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  for (let pitch = 48; pitch <= 72; pitch++) {
    const y = top + (72 - pitch) * rowHeight;
    ctx.fillStyle = pitch % 12 === 0 ? '#e5e7eb' : pitch % 12 === 5 ? '#f0f1f3' : '#f7f8fa';
    ctx.fillRect(left, y, width - left, rowHeight);
    ctx.fillStyle = '#4b5563';
    if (pitch % 12 === 0) ctx.fillText(noteName(pitch), 6, y + rowHeight / 2);
  }
  ctx.strokeStyle = '#9ca3af';
  ctx.beginPath(); ctx.moveTo(left, top); ctx.lineTo(left, height - 20); ctx.stroke();
  for (let second = Math.ceil(viewStart); second <= viewStart + secondsVisible; second++) {
    const x = left + (second - viewStart) * pixelsPerSecond;
    ctx.strokeStyle = '#d1d5db';
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, height - 20); ctx.stroke();
    ctx.fillStyle = '#4b5563'; ctx.fillText(`${second}s`, x + 3, 15);
  }
  if (presentationAttempt?.metronomeBeatOriginMs !== null && presentationAttempt?.metronomeBeatOriginMs !== undefined) {
    const beatOrigin = presentationAttempt.metronomeBeatOriginMs / 1000;
    const beatSeconds = presentationAttempt.beatDurationMs / 1000;
    for (let beat = Math.max(0, Math.ceil((viewStart - beatOrigin) / beatSeconds));
      beatOrigin + beat * beatSeconds <= Math.min(viewStart + secondsVisible, elapsed); beat++) {
      const x = left + (beatOrigin + beat * beatSeconds - viewStart) * pixelsPerSecond;
      ctx.strokeStyle = beat === 4 ? '#475569' : '#b9bec6';
      ctx.lineWidth = beat === 4 ? 3 : 1;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, height - 20); ctx.stroke();
      ctx.lineWidth = 1;
      if (beat === 4) {
        ctx.fillStyle = '#334155';
        ctx.fillText('ENTRY', Math.min(x + 4, width - 50), 15);
      }
    }
    for (const [index, pitch] of presentationAttempt.targetPitches.entries()) {
      const start = Math.max(presentationAttempt.intendedEntryMs / 1000 + index * beatSeconds, viewStart);
      const end = Math.min(presentationAttempt.intendedEntryMs / 1000 + index * beatSeconds + presentationNoteSeconds, viewStart + secondsVisible);
      if (end <= start) continue;
      ctx.fillStyle = 'rgba(37, 99, 235, 0.42)';
      ctx.fillRect(left + (start - viewStart) * pixelsPerSecond, top + (72 - pitch) * rowHeight + 1,
        (end - start) * pixelsPerSecond, rowHeight - 2);
    }
  }
  const noteEnd = presentationRunning ? elapsed : (rollStoppedAt - rollStartedAt) / 1000;
  for (const note of rollNotes) {
    if (note.pitch < 48 || note.pitch > 72) continue;
    const start = Math.max(note.start, viewStart);
    const end = Math.min(note.end ?? noteEnd, viewStart + secondsVisible);
    if (end <= start) continue;
    ctx.fillStyle = '#ea580c';
    ctx.fillRect(left + (start - viewStart) * pixelsPerSecond, top + (72 - note.pitch) * rowHeight + 1,
      Math.max(2, (end - start) * pixelsPerSecond), rowHeight - 2);
  }
}

function animatePianoRoll() {
  drawPianoRoll();
  if (presentationRunning && typeof requestAnimationFrame !== 'undefined') rollFrame = requestAnimationFrame(animatePianoRoll);
}

function startPianoRoll() {
  rollStartedAt = performance.now();
  rollStoppedAt = 0;
  rollNotes = [];
  rollHeld.clear();
  animatePianoRoll();
}

function stopPianoRoll() {
  rollStoppedAt = performance.now();
  const end = (rollStoppedAt - rollStartedAt) / 1000;
  for (const notes of rollHeld.values()) for (const note of notes) note.end = end;
  rollHeld.clear();
  if (rollFrame !== null && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(rollFrame);
  rollFrame = null;
  drawPianoRoll();
}

function recordPianoRollEvent(noteOn, pitch, velocity, channel) {
  if (!presentationRunning) return null;
  const timeMs = Math.max(0, performance.now() - rollStartedAt);
  const time = timeMs / 1000;
  const event = { type: noteOn ? 'noteOn' : 'noteOff', pitch, velocity, channel, timeMs };
  presentationAttempt.midiEvents.push(event);
  const key = `${channel}:${pitch}`;
  if (noteOn) {
    const note = { pitch, start: time, end: null };
    rollNotes.push(note);
    if (!rollHeld.has(key)) rollHeld.set(key, []);
    rollHeld.get(key).push(note);
  } else {
    const held = rollHeld.get(key);
    if (held?.length) held.shift().end = time;
    if (held?.length === 0) rollHeld.delete(key);
  }
  drawPianoRoll();
  return event;
}

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
  const oscillators = [];
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
    oscillators.push(oscillator);
  });
  return oscillators;
}

function trackPresentation(oscillators) {
  for (const oscillator of oscillators) {
    presentationSounds.add(oscillator);
    oscillator.onended = () => presentationSounds.delete(oscillator);
  }
}

function playPresentationPhrase(start, scheduledStartMs, initial = false, requestedAtMs = null) {
  const notes = presentationPitches.map((pitch, index) => ({ pitch, timeMs: scheduledStartMs + index * presentationBeatSeconds * 1000, durationMs: presentationNoteSeconds * 1000 }));
  if (initial) presentationAttempt.promptNotes = notes;
  else presentationAttempt.replays.push({ requestedAtMs, notes });
  for (const [index, pitch] of presentationPitches.entries()) {
    trackPresentation(sound(start + index * presentationBeatSeconds, 440 * 2 ** ((pitch - 69) / 12), presentationNoteSeconds, .12, true, false));
  }
  presentationPlaybackEnd = start + (presentationPitches.length - 1) * presentationBeatSeconds + presentationNoteSeconds;
  $('presentation-replay').disabled = true;
  const generation = presentationGeneration;
  setTimeout(() => {
    if (presentationRunning && generation === presentationGeneration) $('presentation-replay').disabled = false;
  }, Math.max(0, (presentationPlaybackEnd - audio.currentTime) * 1000));
}

function recognizePresentationNote(event) {
  if (!presentationRunning || presentationComplete || presentationListeningAt === Infinity ||
    (audio && audio.currentTime < presentationListeningAt)) return;
  const { pitch } = event;
  presentationProgress = pitch === presentationPitches[presentationProgress]
    ? presentationProgress + 1
    : pitch === presentationPitches[0] ? 1 : 0;
  presentationMatchEvents = presentationProgress ? [...presentationMatchEvents.slice(0, presentationProgress - 1), event] : [];
  if (presentationProgress === presentationPitches.length) {
    presentationComplete = true;
    presentationAttempt.completedAtMs = event.timeMs;
    presentationAttempt.matchedMidiEvents = [...presentationMatchEvents];
    renderTimingDeviation();
    $('presentation-status').textContent = 'Correct!';
  }
}

async function replayPresentation() {
  if (!presentationRunning || $('presentation-replay').disabled) return;
  const requestedAtMs = performance.now() - rollStartedAt;
  const generation = presentationGeneration;
  $('presentation-replay').disabled = true;
  try {
    await prepareAudio();
    if (!presentationRunning || generation !== presentationGeneration) return;
    if (audio.currentTime < presentationPlaybackEnd) {
      $('presentation-replay').disabled = false;
      return;
    }
    const start = audio.currentTime + .1;
    const scheduledStartMs = performance.now() - rollStartedAt + (start - audio.currentTime) * 1000;
    playPresentationPhrase(start, scheduledStartMs, false, requestedAtMs);
  } catch (error) {
    if (presentationRunning && generation === presentationGeneration) {
      $('presentation-replay').disabled = false;
      $('presentation-status').textContent = `Audio unavailable: ${error.message || error.name}`;
    }
  }
}

function renderTimingDeviation() {
  const chart = $('timing-deviation');
  const attempt = presentationAttempt;
  const sequence = presentationMatchEvents;
  const errors = attempt && Number.isFinite(attempt.intendedEntryMs)
    ? sequence.map((event, index) => event.timeMs - attempt.intendedEntryMs - index * attempt.beatDurationMs) : [];
  const range = Math.max(50, ...errors.map(Math.abs));
  const scale = 55 / range;
  const labels = ['C4', 'D4', 'E4'];
  chart.innerHTML = `<line x1="65" y1="35" x2="65" y2="160" stroke="#94a3b8"/>
    <line x1="65" y1="98" x2="550" y2="98" stroke="#475569" stroke-width="2"/>
    <text x="58" y="47" text-anchor="end" fill="#475569" font-size="11">+${Math.round(range)} ms</text>
    <text x="58" y="102" text-anchor="end" fill="#475569" font-size="11">0</text>
    <text x="58" y="157" text-anchor="end" fill="#475569" font-size="11">−${Math.round(range)} ms</text>
    ${labels.map((label, index) => `<text x="${150 + index * 150}" y="190" text-anchor="middle" fill="#334155" font-size="13">${label}</text>`).join('')}
    ${errors.length ? '' : '<text x="300" y="70" text-anchor="middle" fill="#64748b" font-size="12">Play matching notes to see deviations</text>'}
    ${errors.map((error, index) => {
      const x = 110 + index * 150;
      const height = Math.abs(error) * scale;
      const y = error >= 0 ? 98 - height : 98;
      const signed = `${error >= 0 ? '+' : '−'}${Math.round(Math.abs(error))} ms`;
      return `<rect x="${x}" y="${y}" width="80" height="${Math.max(1, height)}" rx="3" fill="#ea580c"/>
        <text x="${x + 40}" y="${error >= 0 ? y - 9 : y + height + 18}" text-anchor="middle" fill="#334155" font-size="13" font-weight="600">${signed}</text>`;
    }).join('')}`;
  chart.setAttribute('aria-label', errors.length ? `Onset deviations: ${errors.map((error, index) => `${labels[index]} ${Math.round(error)} milliseconds`).join(', ')}` : 'Awaiting matching notes for onset deviations');
  $('alignment-mean').textContent = `Mean absolute onset error: ${errors.length ? `${Math.round(errors.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length)} ms` : '—'}`;
}

function renderPerformanceMetrics() {
  const attempt = presentationAttempt;
  if (!attempt) return;
  const noteOns = attempt.midiEvents.filter(event => event.type === 'noteOn');
  const extra = Math.max(0, noteOns.length - presentationProgress);
  const sequence = presentationMatchEvents;
  $('dashboard-state').textContent = presentationComplete ? 'Completed' : presentationRunning ? 'Provisional' : 'Stopped · incomplete';
  const strip = $('pitch-sequence');
  strip.replaceChildren(...noteOns.map(event => {
    const chip = document.createElement('span');
    chip.textContent = `${noteName(event.pitch)}${attempt.matchedMidiEvents.includes(event) ? ' ✓' : ''}`;
    if (attempt.matchedMidiEvents.includes(event)) chip.className = 'matched';
    else if (!presentationComplete && sequence.includes(event)) chip.className = 'candidate';
    return chip;
  }));
  if (!noteOns.length) strip.textContent = 'Play C4 D4 E4';
  $('pitch-progress').textContent = `${presentationProgress}/3${presentationComplete ? ' — Correct' : ''}`;
  $('pitch-extra').textContent = `${extra} extra/wrong note${extra === 1 ? '' : 's'}`;
  $('first-try-badge').hidden = !(presentationComplete && noteOns.length === 3 && extra === 0);
  const entry = noteOns.length && Number.isFinite(attempt.intendedEntryMs) ? noteOns[0].timeMs - attempt.intendedEntryMs : null;
  const marker = $('entry-marker');
  marker.hidden = entry === null;
  let position = 50;
  if (entry !== null) {
    const scaled = Math.asinh(entry / 100) / Math.asinh(20);
    position = 50 + 45 * Math.max(-1, Math.min(1, scaled));
    marker.style.left = `${position}%`;
  }
  $('entry-track').style.setProperty('--entry-left', `${position}%`);
  $('entry-value').textContent = entry === null ? 'Awaiting first note' : formatSignedMs(entry);
  const beat = attempt.beatDurationMs;
  const offsets = sequence.map(event => event.timeMs - sequence[0].timeMs);
  const maxTime = Math.max(2 * beat, ...offsets, 1);
  const x = time => 65 + time / maxTime * 470;
  const intervals = [0, 1].map(index => sequence[index + 1] ? sequence[index + 1].timeMs - sequence[index].timeMs : null);
  const labelX = (index, time) => index ? Math.max(355, Math.min(470, x(time))) : Math.max(140, Math.min(245, x(time)));
  $('rhythm-timeline').innerHTML = `<line x1="${x(0)}" y1="35" x2="${x(2 * beat)}" y2="35" stroke="#2563eb" stroke-width="2"/>
    ${offsets.slice(1).map((time, index) => `<line x1="${x(offsets[index])}" y1="115" x2="${x(time)}" y2="115" stroke="#ea580c" stroke-width="2"/>`).join('')}
    <text x="5" y="39" fill="#2563eb" font-size="12">Target</text><text x="5" y="119" fill="#ea580c" font-size="12">Played</text>
    ${['C4', 'D4', 'E4'].map((name, index) => `<circle cx="${x(index * beat)}" cy="35" r="6" fill="#2563eb"/><text x="${x(index * beat)}" y="20" text-anchor="middle" fill="#334155" font-size="11">${name}</text>`).join('')}
    ${offsets.map((time, index) => `<circle cx="${x(time)}" cy="115" r="6" fill="#ea580c"/><text x="${x(time)}" y="140" text-anchor="middle" fill="#334155" font-size="11">${['C4', 'D4', 'E4'][index]}</text>`).join('')}
    ${[0, 1].map(index => `<text x="${labelX(index, (index + .5) * beat)}" y="57" text-anchor="middle" fill="#2563eb" font-size="12">${Math.round(beat)} ms</text>`).join('')}
    ${intervals.map((played, index) => played === null ? '' : `<text x="${labelX(index, (offsets[index] + offsets[index + 1]) / 2)}" y="96" text-anchor="middle" fill="#ea580c" font-size="12">${Math.round(played)} ms</text>
      <text x="${labelX(index, (index + .5) * beat)}" y="77" text-anchor="middle" fill="#334155" font-size="12">${formatSignedMs(played - beat)}</text>`).join('')}`;
  const errors = intervals.filter(value => value !== null).map(value => Math.abs(value - beat));
  $('rhythm-mean').textContent = `Mean error: ${errors.length ? `${Math.round(errors.reduce((sum, value) => sum + value, 0) / errors.length)} ms` : '—'}`;
}

function formatSignedMs(value) {
  const rounded = Math.round(value);
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${Math.abs(rounded)} ms`;
}

function renderNoteDuration() {
  const attempt = presentationAttempt;
  if (!attempt) return;
  const held = new Map();
  const releases = new Map();
  for (const event of attempt.midiEvents) {
    const key = `${event.channel}:${event.pitch}`;
    if (event.type === 'noteOn') {
      if (!held.has(key)) held.set(key, []);
      held.get(key).push(event);
    } else {
      const on = held.get(key)?.shift();
      if (on) releases.set(on, event);
    }
  }
  const sequence = presentationMatchEvents;
  const names = ['C4', 'D4', 'E4'];
  const played = sequence.map(on => {
    const off = releases.get(on);
    return off ? off.timeMs - on.timeMs : null;
  });
  const differences = sequence.map((on, index) => {
    const reference = attempt.promptNotes[index]?.durationMs;
    return played[index] !== null && Number.isFinite(reference) ? played[index] - reference : null;
  });
  const completed = differences.filter(Number.isFinite);
  const maxDuration = Math.max(1, ...attempt.promptNotes.map(note => note.durationMs), ...played.filter(Number.isFinite));
  $('duration-rows').innerHTML = names.map((name, index) => {
    const on = sequence[index];
    const reference = attempt.promptNotes[index]?.durationMs;
    const actual = played[index];
    const detail = !on ? '—' : actual === null ? presentationRunning ? 'Held · incomplete' : 'Incomplete'
      : Number.isFinite(reference) ? `Demo ${Math.round(reference)} · Played ${Math.round(actual)} · ${formatSignedMs(differences[index])}`
        : `Played ${Math.round(actual)} ms · no demo`;
    return `<div class="duration-row"><b>${name}</b><div class="duration-bars">
      ${Number.isFinite(reference) ? `<span class="duration-reference" style="width:${reference / maxDuration * 100}%"></span>` : ''}
      ${actual !== null && actual !== undefined ? `<span class="duration-actual" style="width:${actual / maxDuration * 100}%"></span>` : ''}
      </div><em>${detail}</em></div>`;
  }).join('');
  $('duration-mean').textContent = `Mean absolute duration error: ${completed.length ? `${Math.round(completed.reduce((sum, value) => sum + Math.abs(value), 0) / completed.length)} ms` : '—'}`;
  $('articulation-values').textContent = ['C4→D4', 'D4→E4'].map((label, index) => {
    const off = presentationComplete && releases.get(sequence[index]);
    if (!off) return `${label} —`;
    const gap = sequence[index + 1].timeMs - off.timeMs;
    return `${label} ${formatSignedMs(gap)} ${gap > 0 ? 'gap' : gap < 0 ? 'overlap' : 'touch'}`;
  }).join(' · ');
}

async function copyPresentationJson() {
  if (!presentationAttempt) return;
  try {
    const roundedMs = (key, value) => key.endsWith('Ms') && Number.isFinite(value) ? Math.round(value * 10) / 10 : value;
    await navigator.clipboard.writeText(JSON.stringify({ schemaVersion: 1, ...presentationAttempt }, roundedMs, 2));
    $('presentation-json-status').textContent = 'Attempt JSON copied.';
  } catch (error) {
    $('presentation-json-status').textContent = `Copy failed: ${error.message || error.name}`;
  }
}

function stopPresentation() {
  ++presentationGeneration;
  presentationRunning = false;
  renderPerformanceMetrics();
  renderNoteDuration();
  if (presentationAttempt) presentationAttempt.stoppedAtMs = performance.now() - rollStartedAt;
  stopPianoRoll();
  clearInterval(metronomeTimer);
  metronomeTimer = null;
  for (const oscillator of presentationSounds) {
    try { oscillator.stop(audio.currentTime); } catch {}
  }
  presentationSounds.clear();
  $('presentation-replay').disabled = true;
  $('presentation-start').textContent = 'Start';
  $('presentation-start').setAttribute('aria-pressed', 'false');
  $('presentation-status').textContent = 'Stopped.';
}

async function togglePresentation() {
  if (presentationRunning) { stopPresentation(); return; }
  presentationRunning = true;
  presentationAttempt = {
    timeUnit: 'milliseconds',
    timeReference: 'Monotonic performance.now() elapsed since Start; scheduled audio times converted to this reference',
    startedAtMs: 0,
    completedAtMs: null,
    stoppedAtMs: null,
    targetPitches: [...presentationPitches],
    tempoBpm: 80,
    beatDurationMs: presentationBeatSeconds * 1000,
    audioPromptEnabled: $('play-audio').checked,
    metronomeEnabled: $('play-metronome').checked,
    promptNotes: [],
    promptEndMs: null,
    metronomeBeatOriginMs: null,
    preparationBeatMs: null,
    intendedEntryMs: null,
    replays: [],
    midiEvents: [],
    matchedMidiEvents: [],
  };
  renderTimingDeviation();
  $('presentation-copy-json').disabled = false;
  $('presentation-json-status').textContent = '';
  startPianoRoll();
  const generation = ++presentationGeneration;
  presentationProgress = 0;
  presentationMatchEvents = [];
  presentationComplete = false;
  renderPerformanceMetrics();
  renderNoteDuration();
  presentationListeningAt = Infinity;
  presentationPlaybackEnd = Infinity;
  $('presentation-replay').disabled = true;
  const letters = $('show-letters').checked;
  const notation = $('show-notation').checked;
  const playAudio = $('play-audio').checked;
  const playMetronome = $('play-metronome').checked;
  $('presentation-letters').hidden = !letters;
  $('presentation-notation').toggleAttribute('hidden', !notation);
  $('presentation-start').textContent = 'Stop';
  $('presentation-start').setAttribute('aria-pressed', 'true');
  $('presentation-status').textContent = letters || notation || playAudio || playMetronome ? '' : 'All presentation methods are off.';
  if (!playAudio && !playMetronome) {
    presentationAttempt.metronomeBeatOriginMs = 0;
    presentationAttempt.preparationBeatMs = 3 * presentationAttempt.beatDurationMs;
    presentationAttempt.intendedEntryMs = 4 * presentationAttempt.beatDurationMs;
    presentationListeningAt = 0;
    presentationPlaybackEnd = 0;
    $('presentation-replay').disabled = false;
    renderPerformanceMetrics();
    renderTimingDeviation();
    renderNoteDuration();
    return;
  }
  try {
    await prepareAudio();
    if (!presentationRunning || generation !== presentationGeneration) return;
    const start = audio.currentTime + .1;
    const scheduledStartMs = performance.now() - rollStartedAt + (start - audio.currentTime) * 1000;
    presentationAttempt.metronomeBeatOriginMs = scheduledStartMs;
    presentationAttempt.preparationBeatMs = scheduledStartMs + 3 * presentationAttempt.beatDurationMs;
    presentationAttempt.intendedEntryMs = scheduledStartMs + 4 * presentationAttempt.beatDurationMs;
    if (playAudio) {
      playPresentationPhrase(start, scheduledStartMs, true);
      presentationAttempt.promptEndMs = scheduledStartMs + 2 * presentationAttempt.beatDurationMs + presentationNoteSeconds * 1000;
      presentationListeningAt = presentationPlaybackEnd;
    } else {
      presentationListeningAt = 0;
      presentationPlaybackEnd = 0;
      $('presentation-replay').disabled = false;
    }
    if (playMetronome) {
      let nextClickTime = start;
      const scheduleClicks = () => {
        while (nextClickTime < audio.currentTime - .01) nextClickTime += presentationBeatSeconds;
        while (nextClickTime < audio.currentTime + .15) {
          trackPresentation(sound(nextClickTime, 1760, .06, .035, false, false, 'bell'));
          nextClickTime += presentationBeatSeconds;
        }
      };
      scheduleClicks();
      metronomeTimer = setInterval(scheduleClicks, 50);
    }
    renderPerformanceMetrics();
    renderTimingDeviation();
    renderNoteDuration();
  } catch (error) {
    if (!presentationRunning || generation !== presentationGeneration) return;
    $('presentation-status').textContent = `Audio unavailable: ${error.message || error.name}`;
    presentationListeningAt = 0;
    presentationPlaybackEnd = 0;
    $('presentation-replay').disabled = false;
  }
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
  const presentationEvent = recordPianoRollEvent(noteOn, pitch, velocity, status & 0x0f);
  if (noteOn && presentationEvent) {
    recognizePresentationNote(presentationEvent);
    renderPerformanceMetrics();
    renderTimingDeviation();
  }
  if (presentationEvent) renderNoteDuration();
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
$('presentation-start').addEventListener('click', togglePresentation);
$('presentation-replay').addEventListener('click', replayPresentation);
$('presentation-copy-json').addEventListener('click', copyPresentationJson);
$('roll-zoom').addEventListener('input', event => {
  rollZoomSeconds = Number(event.target.value);
  $('roll-zoom-value').value = `${rollZoomSeconds} s`;
  drawPianoRoll();
});
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
