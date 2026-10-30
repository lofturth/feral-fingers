'use strict';
const $ = id => document.getElementById(id);
const canvas = $('plot'), ctx = canvas.getContext('2d');
const levelCanvas = $('level-plot'), levelCtx = levelCanvas.getContext('2d');
let audio = null, stream = null, source = null, analyser = null, buffer = null;
let running = false, starting = false, generation = 0, frame = 0, lastAnalysis = -Infinity;
let history = [], lastTime = performance.now() / 1000;
const settingsKey = 'whistle-starter:v1';
let preferredMicrophone = '';
function saveSettings() {
  try {
    localStorage.setItem(settingsKey, JSON.stringify({
      microphone: preferredMicrophone,
      threshold: Number($('threshold').value),
      low: Number($('graph-low').value), high: Number($('graph-high').value),
      graphHeight: Number($('graph-height').value),
      timeWindow: Number($('time-window').value)
    }));
  } catch { /* Storage may be unavailable; controls still work for this session. */ }
}
function restoreSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(settingsKey));
    if (!saved || typeof saved !== 'object') return;
    if (typeof saved.microphone === 'string') preferredMicrophone = saved.microphone;
    if (Number.isInteger(saved.threshold) && saved.threshold >= -70 && saved.threshold <= -15)
      $('threshold').value = String(saved.threshold);
    if (Number.isInteger(saved.low) && Number.isInteger(saved.high) &&
        saved.low >= 36 && saved.high <= 108 && saved.low < saved.high) {
      $('graph-low').value = String(saved.low); $('graph-high').value = String(saved.high);
    }
    if (Number.isInteger(saved.graphHeight) && saved.graphHeight >= 150 && saved.graphHeight <= 700)
      $('graph-height').value = String(saved.graphHeight);
    if (Number.isInteger(saved.timeWindow) && saved.timeWindow >= 2 && saved.timeWindow <= 30)
      $('time-window').value = String(saved.timeWindow);
  } catch { /* Ignore absent, malformed, or inaccessible storage. */ }
  $('threshold-value').textContent = `${$('threshold').value.replace('-', '−')} dBFS`;
  updateGraphSettings();
}
function updateGraphSettings() {
  const height = $('graph-height').value, seconds = $('time-window').value;
  $('plot').style.height = `${height}px`;
  $('graph-height-value').textContent = `${height} px`;
  $('time-window-value').textContent = `${seconds} s`;
  $('window-label').textContent = `Last ${seconds} seconds · semitone scale · A4 = 440 Hz`;
}
// Each measurement keeps raw frequency, continuous MIDI pitch, dBFS, and validity.
function clearPitch() { $('hz').textContent = $('note').textContent = '—'; }
async function refreshMicrophones() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'audioinput');
    const select = $('microphone'), selected = select.value || preferredMicrophone;
    select.replaceChildren(new Option('System default', ''));
    devices.filter(device => device.deviceId && device.deviceId !== 'default').forEach((device, index) =>
      select.add(new Option(device.label || `Microphone ${index + 1}`, device.deviceId)));
    select.value = devices.some(device => device.deviceId === selected) ? selected : '';
  } catch { /* Device list may be unavailable until permission is granted. */ }
}
function renderLevelGraph(now) {
  const windowSeconds = Number($('time-window').value);
  const width = levelCanvas.clientWidth, height = levelCanvas.clientHeight, dpr = window.devicePixelRatio || 1;
  if (!width || !height) return;
  if (levelCanvas.width !== Math.round(width * dpr) || levelCanvas.height !== Math.round(height * dpr)) {
    levelCanvas.width = Math.round(width * dpr); levelCanvas.height = Math.round(height * dpr);
  }
  levelCtx.setTransform(dpr, 0, 0, dpr, 0, 0); levelCtx.clearRect(0, 0, width, height);
  const left = 46, right = width - 12, top = 8, bottom = height - 8;
  const y = db => bottom - (Math.max(-80, Math.min(0, db)) + 80) / 80 * (bottom - top);
  levelCtx.font = '10px system-ui'; levelCtx.textBaseline = 'middle';
  for (const db of [-80, -40, 0]) {
    levelCtx.strokeStyle = '#26393f'; levelCtx.beginPath();
    levelCtx.moveTo(left, y(db)); levelCtx.lineTo(right, y(db)); levelCtx.stroke();
    levelCtx.fillStyle = '#9db1b5'; levelCtx.fillText(String(db), 7, y(db));
  }
  levelCtx.strokeStyle = '#f2ad61'; levelCtx.lineWidth = 1.5; levelCtx.setLineDash([5, 4]);
  levelCtx.beginPath(); levelCtx.moveTo(left, y(Number($('threshold').value)));
  levelCtx.lineTo(right, y(Number($('threshold').value))); levelCtx.stroke(); levelCtx.setLineDash([]);
  levelCtx.save(); levelCtx.beginPath(); levelCtx.rect(left, top, right - left, bottom - top); levelCtx.clip();
  levelCtx.strokeStyle = levelCtx.fillStyle = '#80e5c2'; levelCtx.lineWidth = 1.5;
  let previous = null;
  for (const p of history) {
    const x = right - (now - p.time) / windowSeconds * (right - left), py = y(p.db);
    if (x < left) { previous = null; continue; }
    if (previous && p.time - previous.time < 0.065) {
      levelCtx.beginPath(); levelCtx.moveTo(previous.x, previous.y); levelCtx.lineTo(x, py); levelCtx.stroke();
    } else { levelCtx.beginPath(); levelCtx.arc(x, py, 1.5, 0, Math.PI * 2); levelCtx.fill(); }
    previous = { time: p.time, x, y: py };
  }
  levelCtx.restore();
}
function renderGraph(now) {
  renderLevelGraph(now);
  const windowSeconds = Number($('time-window').value);
  const width = canvas.clientWidth, height = canvas.clientHeight, dpr = window.devicePixelRatio || 1;
  if (!width || !height) return;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
  const left = 46, right = width - 12, top = 10, bottom = height - 28;
  const lo = Number($('graph-low').value), hi = Number($('graph-high').value);
  const y = midi => bottom - (midi - (lo - 0.5)) / (hi - lo + 1) * (bottom - top);
  const labelStep = Math.max(1, Math.ceil(14 / ((bottom - top) / (hi - lo + 1))));
  ctx.font = '11px system-ui'; ctx.textBaseline = 'middle';
  for (let n = Math.ceil(lo); n <= hi; n++) {
    ctx.strokeStyle = n % 12 === 0 ? '#3e555b' : '#26393f';
    ctx.beginPath(); ctx.moveTo(left, y(n + 0.5)); ctx.lineTo(right, y(n + 0.5)); ctx.stroke();
    if (n % labelStep === 0) { ctx.fillStyle = '#9db1b5'; ctx.fillText(noteName(n), 1, y(n)); }
  }
  ctx.beginPath(); ctx.moveTo(left, bottom); ctx.lineTo(right, bottom); ctx.stroke();
  ctx.textBaseline = 'alphabetic';
  const divisions = width < 500 ? 4 : 8;
  for (let s = 0; s <= divisions; s++) {
    const x = left + s / divisions * (right - left);
    ctx.strokeStyle = '#24373d'; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
    const secondsAgo = Number(((s - divisions) / divisions * windowSeconds).toFixed(1));
    ctx.fillStyle = '#8ea5aa'; ctx.fillText(s === divisions ? 'now' : `${secondsAgo}s`, x - 9, height - 7);
  }
  ctx.save(); ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip();
  ctx.lineWidth = 2;
  let previous = null;
  for (const p of history) {
    if (p.midi === null) { previous = null; continue; }
    ctx.strokeStyle = ctx.fillStyle = '#80e5c2';
    const x = right - (now - p.time) / windowSeconds * (right - left), py = y(p.midi);
    if (x < left) { previous = null; continue; }
    if (previous && p.time - previous.time < 0.065 &&
        Math.abs(p.midi - previous.midi) < 3) {
      ctx.beginPath(); ctx.moveTo(previous.x, previous.y); ctx.lineTo(x, py); ctx.stroke();
    } else { ctx.beginPath(); ctx.arc(x, py, 1.5, 0, Math.PI * 2); ctx.fill(); }
    previous = { ...p, x, y: py };
  }
  ctx.restore();
}
function tick() {
  if (!running) return;
  const now = performance.now() / 1000;
  if (now - lastAnalysis >= 0.012) {
    lastAnalysis = now; lastTime = now;
    analyser.getFloatTimeDomainData(buffer);
    const threshold = Number($('threshold').value);
    const result = detectPitch(buffer, audio.sampleRate, threshold);
    const midi = result.frequency === null ? null : midiPitch(result.frequency);
    history.push({ time: now, frequency: result.frequency, midi, db: result.db,
      valid: midi !== null });
    history = history.filter(p => now - p.time <= 30);
    if (midi === null) { clearPitch(); $('status').textContent = 'Listening · no reliable pitch'; }
    else {
      $('hz').textContent = result.frequency.toFixed(1);
      $('note').textContent = noteName(midi);
      $('status').textContent = 'Listening · pitch detected';
    }
  }
  renderGraph(now); frame = requestAnimationFrame(tick);
}
async function stop() {
  generation++; starting = false; running = false; cancelAnimationFrame(frame);
  if (stream) stream.getTracks().forEach(track => track.stop());
  if (source) source.disconnect(); if (analyser) analyser.disconnect();
  const oldAudio = audio;
  stream = source = analyser = audio = buffer = null;
  $('toggle').textContent = 'Start microphone'; $('status').textContent = 'Stopped · microphone released';
  clearPitch(); renderGraph(lastTime);
  if (oldAudio && oldAudio.state !== 'closed') await oldAudio.close().catch(() => {});
}
async function start() {
  const token = ++generation; starting = true;
  $('toggle').textContent = 'Cancel'; $('error').hidden = true;
  $('status').textContent = 'Waiting for microphone permission…';
  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Open this app at http://localhost:8001 in a browser that supports microphone input.');
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) throw new Error('Web Audio is unavailable in this browser. Try a current Safari or Chrome.');
    // Create/resume during the button gesture for Safari autoplay policy.
    audio = new Audio(); await audio.resume();
    if (token !== generation) return;
    const deviceId = $('microphone').value;
    const acquired = await navigator.mediaDevices.getUserMedia({ audio: {
      echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}) }, video: false });
    if (token !== generation) { acquired.getTracks().forEach(track => track.stop()); return; }
    stream = acquired; source = audio.createMediaStreamSource(stream);
    analyser = audio.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0;
    buffer = new Float32Array(analyser.fftSize);
    source.connect(analyser); // No microphone playback.
    stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => { if (running) void stop(); }));
    history = []; lastAnalysis = -Infinity;
    running = true; starting = false; $('toggle').textContent = 'Stop microphone'; tick();
    await refreshMicrophones();
    if (running && $('microphone').value && $('microphone').value !== deviceId) {
      await stop(); await start();
    }
  } catch (error) {
    if (token !== generation) return;
    await stop();
    const messages = {
      NotAllowedError: 'Microphone permission was denied. Allow microphone access for this site and try again.',
      NotFoundError: 'No microphone was found. Connect or enable a microphone and try again.',
      OverconstrainedError: 'The selected microphone is unavailable. Choose another microphone and try again.',
      NotReadableError: 'The microphone could not be opened. Check system microphone access and whether another app is using the device.'
    };
    $('error').textContent = messages[error.name] || `Could not start microphone: ${error.message}`;
    $('error').hidden = false;
  }
}
$('toggle').onclick = () => { if (running || starting) void stop(); else void start(); };
$('microphone').onchange = async () => {
  preferredMicrophone = $('microphone').value; saveSettings();
  if (running || starting) { await stop(); await start(); }
};
$('refresh-microphones').onclick = () => { void refreshMicrophones(); };
for (const id of ['graph-low', 'graph-high']) {
  for (let midi = 108; midi >= 36; midi--) {
    const option = document.createElement('option');
    option.value = String(midi); option.textContent = noteName(midi);
    $(id).appendChild(option);
  }
}
$('graph-low').value = '72'; $('graph-high').value = '96';
restoreSettings();
if (navigator.mediaDevices) {
  void refreshMicrophones();
  navigator.mediaDevices.addEventListener?.('devicechange', refreshMicrophones);
}
function updateGraphRange(event) {
  let lo = Number($('graph-low').value), hi = Number($('graph-high').value);
  if (lo >= hi) {
    if (event.target.id === 'graph-low') { hi = Math.min(108, lo + 1); lo = Math.min(lo, hi - 1); }
    else { lo = Math.max(36, hi - 1); hi = Math.max(hi, lo + 1); }
    $('graph-low').value = String(lo); $('graph-high').value = String(hi);
  }
  saveSettings();
  renderGraph(running ? performance.now() / 1000 : lastTime);
}
$('graph-low').onchange = updateGraphRange; $('graph-high').onchange = updateGraphRange;
$('threshold').oninput = () => {
  $('threshold-value').textContent = `${$('threshold').value.replace('-', '−')} dBFS`;
  saveSettings(); renderLevelGraph(running ? performance.now() / 1000 : lastTime);
};
for (const id of ['graph-height', 'time-window']) {
  $(id).oninput = () => { updateGraphSettings(); saveSettings(); renderGraph(running ? performance.now() / 1000 : lastTime); };
}
window.addEventListener('pagehide', () => { void stop(); });
window.addEventListener('resize', () => { if (!running) renderGraph(lastTime); });
renderGraph(lastTime);
