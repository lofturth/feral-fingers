const assert = require('node:assert/strict');
const { classify } = require('./harmony-analysis.js');
const cases = [
  ['major', '', [0,4,7]], ['minor', 'm', [0,3,7]],
  ['diminished', 'dim', [0,3,6]], ['augmented', 'aug', [0,4,8]],
  ['sus2', 'sus2', [0,2,7]], ['sus4', 'sus4', [0,5,7]],
  ['dominant seventh', '7', [0,4,7,10]], ['major seventh', 'maj7', [0,4,7,11]],
  ['minor seventh', 'm7', [0,3,7,10]], ['half-diminished seventh', 'm7b5', [0,3,6,10]],
  ['diminished seventh', 'dim7', [0,3,6,9]], ['minor-major seventh', 'mMaj7', [0,3,7,11]],
  ['major sixth', '6', [0,4,7,9]], ['minor sixth', 'm6', [0,3,7,9]]
];
const names=['C','Db','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
for (let root=0;root<12;root++) for (const [quality,suffix,intervals] of cases) {
  const pitches=intervals.map(i=>48+root+i), notes=[...pitches];
  while(notes.length<5) notes.push(pitches[0]+12);
  const original=[...notes], result=classify(notes);
  assert.equal(result.primary?.quality,quality,`${names[root]} ${quality}`);
  assert.equal(result.primary?.symbol,names[root]+suffix);
  assert.equal(result.primary.root,root);assert.deepEqual(notes,original);
  assert.equal(classify([...notes].reverse()).label,result.label);
}
assert.equal(classify([50,53,57,62,69]).label,'Dm');
for(let root=0;root<12;root++)for(const [third,suffix] of [[4,''],[3,'m']]){const p=[48+root,48+root+third,48+root+7,60+root,72+root+7];for(const order of [[0,1,2,3,4],[4,2,0,3,1],[3,1,4,0,2]])assert.equal(classify(order.map(i=>p[i])).label,names[root]+suffix)}
assert.equal(classify([52,55,60,64,67]).label,'C/E');
assert.equal(classify([55,59,62,65,67]).label,'G7');
const sixth=classify([48,52,55,57,60]);assert.equal(sixth.label,'C6');assert(sixth.ambiguous);assert(sixth.alternatives.some(x=>x.symbol==='Am7/C'));
assert.equal(classify([49,53,56,61,65]).label,'Db');assert.equal(classify([54,58,61,66,70]).label,'F#');
assert.equal(classify([60,60,60,72,84]).label,'Unclassified');
for(const notes of [[60,64,60,64,72],[60,67,60,67,72],[64,67,64,67,76],[60,61,62,63,64]]){const result=classify(notes);assert.equal(result.primary,null);assert(result.ambiguous)}
assert.equal(classify([60,64,67,60,72],64).label,'Unclassified');
assert.equal(classify([60,64,67]).label,'Unclassified');
console.log('Harmony recognition: 14 qualities, 12 roots, inversions, ambiguity and invalid inputs passed');
