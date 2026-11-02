// Reproducible JS/DOM-call microbenchmark; this does NOT measure browser CPU,
// layout, paint, GPU work, refresh cadence, or laptop temperature.
// node tests/render-benchmark.cjs [git-revision]
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {makeHost}=require('./dom-harness.cjs');
const base=path.join(__dirname,'..');
const revision=process.argv[2];
const read=file=>revision
  ?execFileSync('git',['show',`${revision}:${file}`],{cwd:base,encoding:'utf8'})
  :fs.readFileSync(path.join(base,file),'utf8');
const files={html:read('index.html'),app:read('app.js'),physics:read('physics.js')};
function measure(historySeconds){
 const h=makeHost(files);
 h.tick(historySeconds);h.click('reset');
 // Same synthetic raw history for each implementation, at 4 samples/second.
 h.run(`for(let i=1;i<=${historySeconds*4};i++){
   observations.push(i%100);observationTimes.push(i*.25);
 }testState(session).time=${historySeconds};syncSession();
 lastTime=${historySeconds*1000};nextSampleTime=${historySeconds+.25};render(0);`);
 h.run(`globalThis.attributeWrites=0;globalThis.pathCharacters=0;
 const proto=Object.getPrototypeOf(nodes[0].bar),original=proto.setAttribute;
 proto.setAttribute=function(k,v){attributeWrites++;if(k==='d')pathCharacters+=String(v).length;return original.call(this,k,v);};`);
 // Normal rAF scheduling via the harness, 600 frames at 60 Hz (10 seconds).
 // Warm the VM before measuring, then create fresh hosts for each run.
 const start=performance.now();
 for(let i=0;i<600;i++)h.tick(1/60);
 const milliseconds=performance.now()-start;
 const elapsed=h.run('activeTime')-historySeconds;
 if(Math.abs(elapsed-10)>1e-8)throw new Error('Benchmark did not advance ten simulation seconds');
 return {milliseconds,
   attributeWrites:h.run('attributeWrites'),pathCharacters:h.run('pathCharacters')};
}
const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
for(const historySeconds of [0,600]){
 measure(historySeconds);
 const runs=Array.from({length:5},()=>measure(historySeconds));
 console.log(JSON.stringify({source:revision||'working tree',historySeconds,frames:600,
   medianMilliseconds:median(runs.map(r=>r.milliseconds)),
   minMilliseconds:Math.min(...runs.map(r=>r.milliseconds)),
   maxMilliseconds:Math.max(...runs.map(r=>r.milliseconds)),
   attributeWrites:runs[0].attributeWrites,pathCharacters:runs[0].pathCharacters}));
}
