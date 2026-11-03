/**
 * Musical View — Foreground UI for Musical Card Overlay and Performance Diagnostics
 *
 * Domain-specific foreground view for music:
 * - Stationary foreground card with notation, noteheads, letters, and celebration animations
 * - Interactive feedback badge and lift metrics
 * - Live piano roll canvas and performance diagnostics
 *
 * Independent of physics engine internals and vocabulary data.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MusicalView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const sharpNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const noteName = pitch => sharpNames[pitch % 12] + (Math.floor(pitch / 12) - 1);

  const el = id => typeof document !== 'undefined' ? document.getElementById(id) : null;

  function formatSignedMs(value) {
    const rounded = Math.round(value);
    return `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${Math.abs(rounded)} ms`;
  }

  function formatFeedback({ isFirstTry, extraNotes, targetIndex, rewardResult }) {
    const liftAmount = rewardResult ? rewardResult.lift : 0;
    const liftText = `+${liftAmount.toFixed(1)}%`;
    const badgeText = isFirstTry
      ? `First Try! Full Lift (${liftText})`
      : `Completed! Half Lift (${liftText})`;
    const feedbackText = isFirstTry
      ? `Flawless! Slot ${String(targetIndex + 1).padStart(2, '0')} lifted (${liftText}).`
      : `Completed with ${extraNotes} extra note${extraNotes === 1 ? '' : 's'}. Slot ${String(targetIndex + 1).padStart(2, '0')} lifted (${liftText}).`;
    return { badgeText, feedbackText, liftText };
  }

  function createMusicalView(options = {}) {
    const defaultPitches = options.targetPitches || [60, 62, 64];

    function updateCardVisuals(presentationProgress = 0, targetPitches = defaultPitches) {
      for (let i = 0; i < targetPitches.length; i++) {
        const isMatched = i < presentationProgress;
        const noteHead = el(`note-head-${i}`);
        const letter = el(`letter-${i}`);
        if (noteHead) noteHead.classList.toggle('matched', isMatched);
        if (letter) letter.classList.toggle('matched', isMatched);
      }
    }

    function showRewardFeedback({ isFirstTry, extraNotes = 0, targetIndex = 0, rewardResult = null }) {
      const card = el('musical-card-overlay');
      if (card && card.classList) {
        if (typeof card.classList.remove === 'function') {
          card.classList.remove('celebrate-full', 'celebrate-half');
        } else if (typeof card.classList.toggle === 'function') {
          card.classList.toggle('celebrate-full', false);
          card.classList.toggle('celebrate-half', false);
        }
        void card.offsetWidth;
        if (typeof card.classList.add === 'function') {
          card.classList.add(isFirstTry ? 'celebrate-full' : 'celebrate-half');
        } else if (typeof card.classList.toggle === 'function') {
          card.classList.toggle(isFirstTry ? 'celebrate-full' : 'celebrate-half', true);
        }
      }

      const { badgeText, feedbackText } = formatFeedback({
        isFirstTry,
        extraNotes,
        targetIndex,
        rewardResult
      });

      if (el('card-badge')) {
        el('card-badge').className = `card-badge ${isFirstTry ? 'first-try' : 'completed'}`;
        el('card-badge').textContent = badgeText;
      }
      if (el('card-feedback')) {
        el('card-feedback').textContent = feedbackText;
      }
    }

    function resetCardVisuals() {
      updateCardVisuals(0);
      if (el('card-badge')) {
        el('card-badge').className = 'card-badge';
        el('card-badge').textContent = 'Ready';
      }
      if (el('card-feedback')) {
        el('card-feedback').textContent = 'Phrase ready · play C4 D4 E4 on MIDI to lift';
      }
    }

    function drawPianoRoll({ rollNotes = [], rollStartedAt = 0, rollZoomSeconds = 8, activeAttempt = null, noteSeconds = 0.65 } = {}) {
      const canvas = el('piano-roll');
      if (!canvas) return;
      const ctx = canvas.getContext?.('2d');
      if (!ctx) return;

      const { width, height } = canvas;
      const left = 48, top = 25, rowHeight = 8, secondsVisible = rollZoomSeconds;
      const elapsed = rollStartedAt ? (((typeof performance !== 'undefined' ? performance.now() : 0) - rollStartedAt) / 1000) : 0;
      const viewStart = Math.max(0, elapsed - secondsVisible);
      const pixelsPerSecond = (width - left - 10) / secondsVisible;

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, width, height);
      ctx.font = '10px system-ui, sans-serif';
      ctx.textBaseline = 'middle';

      for (let pitch = 48; pitch <= 72; pitch++) {
        const y = top + (72 - pitch) * rowHeight;
        ctx.fillStyle = pitch % 12 === 0 ? '#e2e8f0' : pitch % 12 === 5 ? '#edf2f7' : '#f8fafc';
        ctx.fillRect(left, y, width - left, rowHeight);
        ctx.fillStyle = '#475569';
        if (pitch % 12 === 0) ctx.fillText(noteName(pitch), 8, y + rowHeight / 2);
      }

      ctx.strokeStyle = '#94a3b8';
      ctx.beginPath(); ctx.moveTo(left, top); ctx.lineTo(left, height - 15); ctx.stroke();
      for (let second = Math.ceil(viewStart); second <= viewStart + secondsVisible; second++) {
        const x = left + (second - viewStart) * pixelsPerSecond;
        ctx.strokeStyle = '#cbd5e1';
        ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, height - 15); ctx.stroke();
        ctx.fillStyle = '#64748b';
        ctx.fillText(`${second}s`, x + 3, 12);
      }

      if (activeAttempt?.metronomeBeatOriginMs != null) {
        const beatOrigin = activeAttempt.metronomeBeatOriginMs / 1000;
        const beatSec = activeAttempt.beatDurationMs / 1000;
        for (let beat = Math.max(0, Math.ceil((viewStart - beatOrigin) / beatSec));
          beatOrigin + beat * beatSec <= Math.min(viewStart + secondsVisible, elapsed); beat++) {
          const x = left + (beatOrigin + beat * beatSec - viewStart) * pixelsPerSecond;
          ctx.strokeStyle = beat === 4 ? '#334155' : '#cbd5e1';
          ctx.lineWidth = beat === 4 ? 2 : 1;
          ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, height - 15); ctx.stroke();
          ctx.lineWidth = 1;
          if (beat === 4) {
            ctx.fillStyle = '#1e293b';
            ctx.fillText('ENTRY', Math.min(x + 4, width - 45), 12);
          }
        }

        for (const [index, pitch] of activeAttempt.targetPitches.entries()) {
          const start = Math.max(activeAttempt.intendedEntryMs / 1000 + index * beatSec, viewStart);
          const end = Math.min(activeAttempt.intendedEntryMs / 1000 + index * beatSec + noteSeconds, viewStart + secondsVisible);
          if (end > start) {
            ctx.fillStyle = '#3b82f6';
            ctx.fillRect(left + (start - viewStart) * pixelsPerSecond, top + (72 - pitch) * rowHeight + 1,
              Math.max(2, (end - start) * pixelsPerSecond), rowHeight - 2);
          }
        }
      }

      const noteEnd = elapsed;
      for (const note of rollNotes) {
        const start = Math.max(note.start, viewStart);
        const end = Math.min(note.end ?? noteEnd, viewStart + secondsVisible);
        if (end <= start) continue;
        ctx.fillStyle = '#ea580c';
        ctx.fillRect(left + (start - viewStart) * pixelsPerSecond, top + (72 - note.pitch) * rowHeight + 1,
          Math.max(2, (end - start) * pixelsPerSecond), rowHeight - 2);
      }
    }

    function renderPerformanceMetrics({ activeAttempt = null, presentationProgress = 0, presentationComplete = false, presentationMatchEvents = [] } = {}) {
      const attempt = activeAttempt;
      if (!attempt) return;
      const noteOns = attempt.midiEvents.filter(e => e.type === 'noteOn');
      const extra = Math.max(0, noteOns.length - presentationProgress);

      if (el('dashboard-state')) {
        el('dashboard-state').textContent = presentationComplete ? 'Completed' : attempt.promptStartedAt ? 'In Progress' : 'Awaiting Attempt';
      }

      const strip = el('pitch-sequence');
      if (strip) {
        strip.replaceChildren(...noteOns.map(event => {
          const chip = document.createElement('span');
          chip.textContent = `${noteName(event.pitch)}${attempt.matchedMidiEvents.includes(event) ? ' ✓' : ''}`;
          if (attempt.matchedMidiEvents.includes(event)) chip.className = 'matched';
          else if (presentationMatchEvents.includes(event)) chip.className = 'candidate';
          return chip;
        }));
        if (!noteOns.length) strip.textContent = 'Play C4 D4 E4';
      }

      if (el('pitch-progress')) el('pitch-progress').textContent = `${presentationProgress}/3${presentationComplete ? ' — Correct' : ''}`;
      if (el('pitch-extra')) el('pitch-extra').textContent = `${extra} extra/wrong note${extra === 1 ? '' : 's'}`;
      if (el('first-try-badge')) el('first-try-badge').hidden = !(presentationComplete && extra === 0);

      const entry = noteOns.length && Number.isFinite(attempt.intendedEntryMs) ? noteOns[0].timeMs - attempt.intendedEntryMs : null;
      const marker = el('entry-marker');
      if (marker) marker.hidden = entry === null;
      let position = 50;
      if (entry !== null) {
        const scaled = Math.asinh(entry / 100) / Math.asinh(20);
        position = 50 + 45 * Math.max(-1, Math.min(1, scaled));
        if (marker) marker.style.left = `${position}%`;
      }
      el('entry-track')?.style?.setProperty?.('--entry-left', `${position}%`);
      if (el('entry-value')) el('entry-value').textContent = entry === null ? 'Awaiting first note' : formatSignedMs(entry);

      const sequence = presentationMatchEvents;
      const beat = attempt.beatDurationMs;
      const offsets = sequence.map(event => event.timeMs - sequence[0].timeMs);
      const maxTime = Math.max(2 * beat, ...offsets, 1);
      const x = time => 65 + time / maxTime * 470;
      const intervals = [0, 1].map(index => sequence[index + 1] ? sequence[index + 1].timeMs - sequence[index].timeMs : null);
      const labelX = (index, time) => index ? Math.max(355, Math.min(470, x(time))) : Math.max(140, Math.min(245, x(time)));

      if (el('rhythm-timeline')) {
        el('rhythm-timeline').innerHTML = `<line x1="${x(0)}" y1="35" x2="${x(2 * beat)}" y2="35" stroke="#2563eb" stroke-width="2"/>
          ${offsets.slice(1).map((time, index) => `<line x1="${x(offsets[index])}" y1="115" x2="${x(time)}" y2="115" stroke="#ea580c" stroke-width="2"/>`).join('')}
          <text x="5" y="39" fill="#2563eb" font-size="12">Target</text><text x="5" y="119" fill="#ea580c" font-size="12">Played</text>
          ${['C4', 'D4', 'E4'].map((name, index) => `<circle cx="${x(index * beat)}" cy="35" r="6" fill="#2563eb"/><text x="${x(index * beat)}" y="20" text-anchor="middle" fill="#94a3b8" font-size="11">${name}</text>`).join('')}
          ${offsets.map((time, index) => `<circle cx="${x(time)}" cy="115" r="6" fill="#ea580c"/><text x="${x(time)}" y="140" text-anchor="middle" fill="#94a3b8" font-size="11">${['C4', 'D4', 'E4'][index]}</text>`).join('')}
          ${[0, 1].map(index => `<text x="${labelX(index, (index + 0.5) * beat)}" y="57" text-anchor="middle" fill="#2563eb" font-size="12">${Math.round(beat)} ms</text>`).join('')}
          ${intervals.map((played, index) => played === null ? '' : `<text x="${labelX(index, (offsets[index] + offsets[index + 1]) / 2)}" y="96" text-anchor="middle" fill="#ea580c" font-size="12">${Math.round(played)} ms</text>
            <text x="${labelX(index, (index + 0.5) * beat)}" y="77" text-anchor="middle" fill="#94a3b8" font-size="12">${formatSignedMs(played - beat)}</text>`).join('')}`;
      }

      const errors = intervals.filter(v => v !== null).map(v => Math.abs(v - beat));
      if (el('rhythm-mean')) {
        el('rhythm-mean').textContent = `Mean error: ${errors.length ? `${Math.round(errors.reduce((sum, v) => sum + v, 0) / errors.length)} ms` : '—'}`;
      }
    }

    function renderTimingDeviation({ activeAttempt = null, presentationMatchEvents = [] } = {}) {
      const chart = el('timing-deviation');
      if (!chart) return;
      const attempt = activeAttempt;
      const sequence = presentationMatchEvents;
      const errors = attempt && Number.isFinite(attempt.intendedEntryMs)
        ? sequence.map((event, index) => event.timeMs - attempt.intendedEntryMs - index * attempt.beatDurationMs)
        : [];

      const range = Math.max(50, ...errors.map(Math.abs));
      const scale = 55 / range;
      const labels = ['C4', 'D4', 'E4'];

      chart.innerHTML = `<line x1="65" y1="35" x2="65" y2="160" stroke="#94a3b8"/>
        <line x1="65" y1="98" x2="550" y2="98" stroke="#475569" stroke-width="2"/>
        <text x="58" y="47" text-anchor="end" fill="#64748b" font-size="11">+${Math.round(range)} ms</text>
        <text x="58" y="102" text-anchor="end" fill="#64748b" font-size="11">0</text>
        <text x="58" y="157" text-anchor="end" fill="#64748b" font-size="11">−${Math.round(range)} ms</text>
        ${labels.map((label, index) => `<text x="${150 + index * 150}" y="190" text-anchor="middle" fill="#94a3b8" font-size="13">${label}</text>`).join('')}
        ${errors.length ? '' : '<text x="300" y="70" text-anchor="middle" fill="#64748b" font-size="12">Play matching notes to see onset deviations</text>'}
        ${errors.map((error, index) => {
          const x = 110 + index * 150;
          const height = Math.abs(error) * scale;
          const y = error >= 0 ? 98 - height : 98;
          const signed = `${error >= 0 ? '+' : '−'}${Math.round(Math.abs(error))} ms`;
          return `<rect x="${x}" y="${y}" width="80" height="${Math.max(1, height)}" rx="3" fill="#ea580c"/>
            <text x="${x + 40}" y="${error >= 0 ? y - 9 : y + height + 18}" text-anchor="middle" fill="#94a3b8" font-size="12" font-weight="600">${signed}</text>`;
        }).join('')}`;

      if (el('alignment-mean')) {
        el('alignment-mean').textContent = `Mean absolute onset error: ${errors.length ? `${Math.round(errors.reduce((sum, e) => sum + Math.abs(e), 0) / errors.length)} ms` : '—'}`;
      }
    }

    function renderNoteDuration({ activeAttempt = null, presentationMatchEvents = [], presentationComplete = false } = {}) {
      const attempt = activeAttempt;
      if (!attempt || !el('duration-rows')) return;
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
      const maxDuration = Math.max(1, ...attempt.promptNotes.map(n => n.durationMs), ...played.filter(Number.isFinite));

      el('duration-rows').innerHTML = names.map((name, index) => {
        const on = sequence[index];
        const reference = attempt.promptNotes[index]?.durationMs;
        const actual = played[index];
        const detail = !on ? '—' : actual === null ? 'Held · incomplete'
          : Number.isFinite(reference) ? `Demo ${Math.round(reference)}ms · Played ${Math.round(actual)}ms · ${formatSignedMs(differences[index])}`
            : `Played ${Math.round(actual)}ms`;
        return `<div class="duration-row"><b>${name}</b><div class="duration-bars">
          ${Number.isFinite(reference) ? `<span class="duration-reference" style="width:${reference / maxDuration * 100}%"></span>` : ''}
          ${actual != null ? `<span class="duration-actual" style="width:${actual / maxDuration * 100}%"></span>` : ''}
          </div><em>${detail}</em></div>`;
      }).join('');

      if (el('duration-mean')) {
        el('duration-mean').textContent = `Mean absolute duration error: ${completed.length ? `${Math.round(completed.reduce((s, v) => s + Math.abs(v), 0) / completed.length)} ms` : '—'}`;
      }

      if (el('articulation-values')) {
        el('articulation-values').textContent = ['C4→D4', 'D4→E4'].map((label, index) => {
          const off = presentationComplete && releases.get(sequence[index]);
          if (!off) return `${label} —`;
          const gap = sequence[index + 1].timeMs - off.timeMs;
          return `${label} ${formatSignedMs(gap)} ${gap > 0 ? 'gap' : gap < 0 ? 'overlap' : 'touch'}`;
        }).join(' · ');
      }
    }

    function renderAllDiagnostics(params = {}) {
      renderPerformanceMetrics(params);
      renderTimingDeviation(params);
      renderNoteDuration(params);
    }

    return {
      noteName,
      formatSignedMs,
      formatFeedback,
      updateCardVisuals,
      showRewardFeedback,
      resetCardVisuals,
      drawPianoRoll,
      renderPerformanceMetrics,
      renderTimingDeviation,
      renderNoteDuration,
      renderAllDiagnostics
    };
  }

  return Object.freeze({
    noteName,
    formatSignedMs,
    formatFeedback,
    createMusicalView
  });
});
