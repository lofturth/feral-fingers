/* YIN difference function with cumulative mean normalization and parabolic
   interpolation. Fixed comparison window keeps lag scores comparable. */
'use strict';
function detectPitch(samples, sampleRate, thresholdDb = -45) {
  let mean = 0;
  for (const x of samples) mean += x;
  mean /= samples.length;
  let energy = 0;
  for (const x of samples) energy += (x - mean) ** 2;
  const rms = Math.sqrt(energy / samples.length);
  const db = 20 * Math.log10(Math.max(rms, 1e-8));
  const empty = { frequency: null, db, confidence: 0 };
  if (db < thresholdDb) return empty;
  const minLag = Math.max(2, Math.floor(sampleRate / 4000));
  const maxLag = Math.ceil(sampleRate / 250);
  const window = samples.length - maxLag - 1;
  if (window < maxLag) return empty;
  const scores = new Float64Array(maxLag + 1);
  scores[0] = 1;
  let sum = 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    let difference = 0;
    for (let i = 0; i < window; i++) difference += (samples[i] - samples[i + lag]) ** 2;
    sum += difference;
    scores[lag] = sum > 0 ? difference * lag / sum : 1;
  }
  // First convincing valley, rather than the deepest harmonic valley.
  let lag = minLag;
  while (lag < maxLag && scores[lag] >= 0.12) lag++;
  if (lag >= maxLag) return empty;
  while (lag < maxLag && scores[lag + 1] < scores[lag]) lag++;
  if (lag >= maxLag || scores[lag] > 0.12) return empty;
  const left = scores[lag - 1], mid = scores[lag], right = scores[lag + 1];
  const denominator = left - 2 * mid + right;
  const offset = denominator ? Math.max(-0.5, Math.min(0.5, (left - right) / (2 * denominator))) : 0;
  const frequency = sampleRate / (lag + offset);
  if (frequency < 250 || frequency > 4000) return empty;
  return { frequency, db, confidence: 1 - mid };
}
function midiPitch(hz) { return 69 + 12 * Math.log2(hz / 440); }
function noteName(midi) {
  const n = Math.round(midi);
  return ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
}
