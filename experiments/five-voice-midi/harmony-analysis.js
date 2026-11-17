// Pitch-class recognition only: no dependency on the Explorer's fixed harmony.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HarmonyAnalysis = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // Conventional flat spellings for chromatic roots; F-sharp avoids an awkward G-flat.
  const names = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const templates = [
    { quality: 'major', suffix: '', intervals: [0, 4, 7] },
    { quality: 'minor', suffix: 'm', intervals: [0, 3, 7] },
    { quality: 'diminished', suffix: 'dim', intervals: [0, 3, 6] },
    { quality: 'augmented', suffix: 'aug', intervals: [0, 4, 8] },
    { quality: 'sus2', suffix: 'sus2', intervals: [0, 2, 7] },
    { quality: 'sus4', suffix: 'sus4', intervals: [0, 5, 7] },
    { quality: 'dominant seventh', suffix: '7', intervals: [0, 4, 7, 10] },
    { quality: 'major seventh', suffix: 'maj7', intervals: [0, 4, 7, 11] },
    { quality: 'minor seventh', suffix: 'm7', intervals: [0, 3, 7, 10] },
    { quality: 'half-diminished seventh', suffix: 'm7b5', intervals: [0, 3, 6, 10] },
    { quality: 'diminished seventh', suffix: 'dim7', intervals: [0, 3, 6, 9] },
    { quality: 'minor-major seventh', suffix: 'mMaj7', intervals: [0, 3, 7, 11] },
    { quality: 'major sixth', suffix: '6', intervals: [0, 4, 7, 9] },
    { quality: 'minor sixth', suffix: 'm6', intervals: [0, 3, 7, 9] }
  ];
  function classify(notes, bass = Array.isArray(notes) ? Math.min(...notes) : NaN) {
    if (!Array.isArray(notes) || notes.length !== 5 || notes.some(n => !Number.isInteger(n) || n < 0 || n > 127) || !Number.isInteger(bass) || bass !== Math.min(...notes)) {
      return { primary: null, alternatives: [], ambiguous: false, label: 'Unclassified' };
    }
    const pcs = [...new Set(notes.map(n => n % 12))], bassPc = bass % 12;
    if (pcs.length < 2) return { primary: null, alternatives: [], ambiguous: false, label: 'Unclassified' };
    const matches = [];
    for (let root = 0; root < 12; root++) for (let order = 0; order < templates.length; order++) {
      const t = templates[order], wanted = t.intervals.map(i => (root + i) % 12);
      const missing = wanted.filter(p => !pcs.includes(p)), extra = pcs.filter(p => !wanted.includes(p));
      if (missing.length > 1 || extra.length > 1 || wanted.length - missing.length < 2) continue;
      const exact = !missing.length && !extra.length;
      const third = t.intervals.find(i => i === 3 || i === 4);
      const seventh = t.intervals.find(i => i === 10 || i === 11 || (t.quality === 'diminished seventh' && i === 9));
      const defining = (third !== undefined && pcs.includes((root + third) % 12) ? 1 : 0) + (seventh !== undefined && pcs.includes((root + seventh) % 12) ? 1 : 0);
      const symbol = names[root] + t.suffix + (bassPc === root ? '' : '/' + names[bassPc]);
      matches.push({ symbol, root, quality: t.quality, bass: bassPc, exact, missing, extra, defining, order, rootBass: root === bassPc });
    }
    matches.sort((a, b) => Number(b.exact) - Number(a.exact) || a.missing.length - b.missing.length || a.extra.length - b.extra.length || Number(b.rootBass) - Number(a.rootBass) || b.defining - a.defining || a.order - b.order || a.root - b.root);
    const exact = matches.filter(m => m.exact);
    if (!exact.length) return { primary: null, alternatives: matches.slice(0, 2), ambiguous: true, label: 'Ambiguous' };
    return { primary: exact[0], alternatives: exact.slice(1, 3), ambiguous: exact.length > 1, label: exact[0].symbol };
  }
  return { classify };
});
