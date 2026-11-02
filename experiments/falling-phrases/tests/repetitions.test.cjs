const test=require('node:test');
const assert=require('node:assert/strict');
const Physics=require('../physics.js');
const {run}=require('../repetitions.cjs');

test('focused experiment matches lowest-word engine actions and unlock events',()=>{
 const result=run(1,20),session=Physics.createSession({wordCount:10});
 const counts=Array(10).fill(0),unlocks=Array(10).fill(null);unlocks[0]=0;
 for(let answer=1;answer<=20;answer++){
  for(let frame=0;frame<60;frame++){
   const transition=session.advance(1/60);
   if(transition.unlockedIndex!==null)unlocks[transition.unlockedIndex]=session.getState().time;
  }
  const lowest=session.getLowestIndex(),action=session.retrieve();assert.equal(action.index,lowest);
  counts[action.index]++;
  if(action.unlockedIndex!==null)unlocks[action.unlockedIndex]=session.getState().time;
 }
 assert.deepEqual(result.words.map(w=>w.successfulRetrievals),counts);
 result.words.forEach((word,i)=>{
  if(unlocks[i]===null)assert.equal(word.unlockTime,null);
  else assert.ok(Math.abs(word.unlockTime-unlocks[i])<1e-8);
  assert.equal(word.skips,0);assert.equal(word.totalAttempts,counts[i]);
 });
 assert.equal(result.complete,false);assert.ok(Math.abs(result.duration-20)<1e-8);
 assert.deepEqual(run(1,20),result);
});
test('fast answers complete with per-word counts; partial timeout makes no premature attempt',()=>{
 const result=run(.1,120);
 assert.equal(result.complete,true);assert.ok(result.duration<120);
 assert.ok(result.words.every(w=>w.unlockTime!==null&&w.successfulRetrievals>0));
 assert.equal(result.ratio,result.max/result.min);
 const short=run(1,.5);assert.equal(short.complete,false);
 assert.equal(short.words.reduce((sum,w)=>sum+w.totalAttempts,0),0);
 assert.equal(short.ratio,null);assert.ok(Math.abs(short.duration-.5)<1e-8);
});
test('delay and timeout reject invalid values',()=>{
 for(const value of [0,-1,NaN,Infinity]){
  assert.throws(()=>run(value,1),RangeError);assert.throws(()=>run(1,value),RangeError);
 }
});

test('kick overrides use the engine configuration without changing factory defaults',()=>{
 const before=JSON.stringify(Physics.DEFAULTS);
 assert.deepEqual(run(1,20),run(1,20,25));
 const large=run(1,60,100);assert.equal(large.complete,true);
 assert.deepEqual(large.words.map(w=>w.successfulRetrievals),Array(10).fill(2));
 assert.equal(run(1,60,25).complete,false);
 for(const height of [0,101,NaN,Infinity])assert.throws(()=>run(1,1,height),RangeError);
 assert.equal(JSON.stringify(Physics.DEFAULTS),before);
});
test('five-case sweep reports all words, completion and timeout counts consistently',()=>{
 const {sweep}=require('../repetitions.cjs'),results=sweep();
 assert.deepEqual(results.map(r=>r.kickHeightPercent),[25,35,50,75,100]);
 assert.deepEqual(results.map(r=>r.complete),[false,true,true,true,true]);
 for(const r of results){
  assert.equal(r.responseDelay,1);assert.equal(r.timeoutSeconds,3600);assert.equal(r.words.length,10);
  const counts=r.words.map(w=>w.successfulRetrievals);
  assert.equal(r.min,Math.min(...counts));assert.equal(r.max,Math.max(...counts));
  assert.equal(counts.reduce((sum,n)=>sum+n,0),Math.floor(r.duration+1e-7));
  assert.ok(r.words.every(w=>w.skips===0&&w.totalAttempts===w.successfulRetrievals));
  if(r.complete){assert.ok(r.duration<3600);assert.ok(r.words.every(w=>w.unlockTime!==null));}
  else {assert.ok(Math.abs(r.duration-3600)<1e-7);assert.ok(r.words.some(w=>w.unlockTime===null));}
 }
});
test('single-run CLI remains available alongside the sweep command',()=>{
 const {spawnSync}=require('node:child_process'),path=require('node:path');
 const script=path.join(__dirname,'../repetitions.cjs');
 const single=spawnSync(process.execPath,[script,'1','.5'],{encoding:'utf8'});
 assert.equal(single.status,1);assert.match(single.stdout,/Safety timeout reached/);
 const sweep=spawnSync(process.execPath,[script,'--sweep'],{encoding:'utf8'});
 assert.equal(sweep.status,0);assert.match(sweep.stdout,/word 10/);assert.match(sweep.stdout,/measuredAt/);
 const invalid=spawnSync(process.execPath,[script,'--sweep','extra'],{encoding:'utf8'});
 assert.equal(invalid.status,1);assert.match(invalid.stderr,/Usage:/);
});

test('3 by 5 grid covers every configuration and includes locked words in statistics',()=>{
 const {grid}=require('../repetitions.cjs'),factory=JSON.stringify(Physics.DEFAULTS),results=grid();
 assert.equal(results.length,15);
 assert.deepEqual(results.map(r=>[r.kickHeightPercent,r.responseDelay]),
  [35,42.5,50].flatMap(height=>[.5,1,1.5,2,3].map(delay=>[height,delay])));
 for(const r of results){
  assert.equal(r.timeoutSeconds,3600);assert.equal(r.words.length,10);
  assert.equal(r.complete,r.responseDelay<=1);
  const counts=r.words.map(w=>w.successfulRetrievals),total=counts.reduce((sum,n)=>sum+n,0);
  assert.equal(r.min,Math.min(...counts));assert.equal(r.max,Math.max(...counts));
  assert.equal(total,Math.floor(r.duration/r.responseDelay+1e-7));
  assert.ok(r.words.every(w=>w.totalAttempts===w.successfulRetrievals&&w.skips===0));
  if(r.complete)assert.ok(r.words.every(w=>w.unlockTime!==null));
  else {assert.ok(Math.abs(r.duration-3600)<1e-7);assert.equal(r.min,0);assert.ok(r.words.some(w=>w.unlockTime===null));}
 }
 assert.equal(JSON.stringify(Physics.DEFAULTS),factory);
});
test('grid command prints three tables and formats minute boundaries correctly',()=>{
 const {formatDuration}=require('../repetitions.cjs');
 assert.equal(formatDuration(25.0166667),'0:25.017');assert.equal(formatDuration(426.033333),'7:06.033');
 assert.equal(formatDuration(59.9996),'1:00.000');
 const {spawnSync}=require('node:child_process'),path=require('node:path');
 const script=path.join(__dirname,'../repetitions.cjs');
 const output=spawnSync(process.execPath,[script,'--grid'],{encoding:'utf8'});
 assert.equal(output.status,0);
 for(const text of ['Completion time (minutes:seconds)','Repetitions per word','Full repetition distribution','TIMEOUT (9 unlocked)','42.5%','average','W10'])assert.ok(output.stdout.includes(text));
 const invalid=spawnSync(process.execPath,[script,'--grid','extra'],{encoding:'utf8'});
 assert.equal(invalid.status,1);assert.match(invalid.stderr,/Usage:/);
});
