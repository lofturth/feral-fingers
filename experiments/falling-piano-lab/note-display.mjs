export const tonics = [
  ['C', 0], ['D♭', 1], ['D', 2], ['E♭', 3], ['E', 4], ['F', 5],
  ['F♯', 6], ['G', 7], ['A♭', 8], ['A', 9], ['B♭', 10], ['B', 11],
];

const major = [0, 2, 4, 5, 7, 9, 11];
const minor = [0, 2, 3, 5, 7, 8, 10];
const degreeLabels = ['1', '♭2', '2', '♭3', '3', '4', '♯4', '5', '♭6', '6', '♭7', '7'];
const intervalNames = ['unison', 'minor 2nd', 'major 2nd', 'minor 3rd', 'major 3rd', 'perfect 4th', 'tritone', 'perfect 5th', 'minor 6th', 'major 6th', 'minor 7th', 'major 7th', 'octave'];
const sharpNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const flatNames = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const letters = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const naturalPitches = [0, 2, 4, 5, 7, 9, 11];

export function scalePitches(tonic, mode) {
  return (mode === 'minor' ? minor : major).map(step => (tonic + step) % 12);
}

export function degree(pitch, tonic) {
  return degreeLabels[((pitch - tonic) % 12 + 12) % 12];
}

export function displayNote(pitch, tonic, mode) {
  const pitchClass = ((pitch % 12) + 12) % 12;
  const steps = mode === 'minor' ? minor : major;
  const position = steps.findIndex(step => (tonic + step) % 12 === pitchClass);
  let name;
  if (position >= 0) {
    const tonicName = tonics.find(item => item[1] === tonic)[0];
    const letter = letters[(letters.indexOf(tonicName[0]) + position) % 7];
    const alteration = (pitchClass - naturalPitches[letters.indexOf(letter)] + 12) % 12;
    name = letter + (alteration === 1 ? '♯' : alteration === 11 ? '♭' : '');
  } else {
    name = ([1, 3, 5, 8, 10].includes(tonic) ? flatNames : sharpNames)[pitchClass];
  }
  return `${name}${Math.floor(pitch / 12) - 1}`;
}

export function interval(semitones) {
  if (semitones < 0) return '';
  const octaves = Math.floor(semitones / 12);
  const remainder = semitones % 12;
  if (octaves === 0) return intervalNames[remainder];
  if (remainder === 0) return octaves === 1 ? 'octave' : `${octaves} octaves`;
  return `${intervalNames[remainder]} + ${octaves} octave${octaves === 1 ? '' : 's'}`;
}
