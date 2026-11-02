'use strict';
const Physics=require('./physics.js');

// A focused ten-word experiment: successful answers at fixed intervals.
function run(responseDelay=1,timeoutSeconds=3600,kickHeightPercent=Physics.DEFAULTS.motion.kickHeightPercent){
  for(const value of [responseDelay,timeoutSeconds]){
    if(!Number.isFinite(value)||value<=0)throw new RangeError('Delay and timeout must be finite positive seconds');
  }
  const session=Physics.createSession({wordCount:10,config:{motion:{kickHeightPercent}}});
  const words=Array.from({length:10},(_,i)=>({word:i+1,unlockTime:i===0?0:null,successfulRetrievals:0,skips:0,totalAttempts:0}));
  let elapsed=0,attempt=1;
  function recordUnlock(transition){
    if(transition.unlockedIndex!==null)words[transition.unlockedIndex].unlockTime=elapsed;
  }
  while(!session.isComplete()&&elapsed<timeoutSeconds){
    const deadline=Math.min(attempt*responseDelay,timeoutSeconds);
    while(!session.isComplete()&&elapsed<deadline){
      const remaining=deadline-elapsed,dt=Math.min(1/60,remaining);
      const transition=session.advance(dt);
      elapsed=remaining<=1/60?deadline:elapsed+dt;
      recordUnlock(transition);
    }
    if(session.isComplete()||attempt*responseDelay>timeoutSeconds)break;
    // retrieve() itself selects the lowest active logical position.
    const action=session.retrieve(),word=words[action.index];
    word.successfulRetrievals+=action.kind==='retrieval'?1:0;
    word.skips+=action.kind==='skip'?1:0;
    word.totalAttempts++;
    recordUnlock(action);attempt++;
  }
  const counts=words.map(word=>word.successfulRetrievals),min=Math.min(...counts),max=Math.max(...counts);
  return {kickHeightPercent,responseDelay,timeoutSeconds,complete:session.isComplete(),duration:session.getState().time,
    words,min,max,ratio:min>0?max/min:null};
}
function sweep(){return [25,35,50,75,100].map(height=>run(1,3600,height));}
function grid(){return [35,42.5,50].flatMap(height=>[.5,1,1.5,2,3].map(delay=>run(delay,3600,height)));}
function formatDuration(seconds){
  const milliseconds=Math.round(seconds*1000);
  return Math.floor(milliseconds/60000)+':'+((milliseconds%60000)/1000).toFixed(3).padStart(6,'0');
}
if(require.main===module){
  try {
    if(process.argv[2]==='--grid'){
      if(process.argv.length!==3)throw new RangeError('Usage: node repetitions.cjs --grid');
      const results=grid();
      console.log('10 words; 60 Hz updates; all retrievals successful; other parameters at factory defaults. TIMEOUT counts are measured at 3600s, not completion.');
      console.log('Completion time (minutes:seconds)');
      console.table([35,42.5,50].map(height=>({kickHeight:height+'%',...Object.fromEntries(
        results.filter(r=>r.kickHeightPercent===height).map(r=>[r.responseDelay+'s',
          r.complete?formatDuration(r.duration):`TIMEOUT (${r.words.filter(w=>w.unlockTime!==null).length} unlocked)`]))})));
      console.log('Repetitions per word (all 10 words, including locked words)');
      console.table(results.map(r=>({kickHeight:r.kickHeightPercent+'%',delay:r.responseDelay+'s',
        status:r.complete?'completed':'TIMEOUT',min:r.min,max:r.max,
        average:r.words.reduce((sum,w)=>sum+w.successfulRetrievals,0)/10})));
      console.log('Full repetition distribution');
      console.table(results.map(r=>({kickHeight:r.kickHeightPercent+'%',delay:r.responseDelay+'s',
        status:r.complete?'completed':'TIMEOUT',...Object.fromEntries(r.words.map(w=>['W'+w.word,w.successfulRetrievals]))})));
    } else if(process.argv[2]==='--sweep'){
      if(process.argv.length!==3)throw new RangeError('Usage: node repetitions.cjs --sweep');
      const results=sweep();
      console.log('10 words; 1s response delay; 60 Hz updates; other parameters at factory defaults. Incomplete counts are measured at the 3600s timeout.');
      console.table(results.map(r=>({kickHeight:r.kickHeightPercent+'%',completed:r.complete?'yes':'no',
        duration:r.duration.toFixed(3)+'s',unlocked:r.words.filter(w=>w.unlockTime!==null).length,
        successes:r.words.reduce((sum,w)=>sum+w.successfulRetrievals,0),min:r.min,max:r.max})));
      console.table(results.map(r=>({kickHeight:r.kickHeightPercent+'%',measuredAt:r.complete?'completion':'timeout',
        ...Object.fromEntries(r.words.map(w=>['word '+w.word,w.successfulRetrievals]))})));
    } else {
      if(process.argv.length>4)throw new RangeError('Usage: node repetitions.cjs [response-delay-seconds] [timeout-seconds], or --sweep / --grid');
      const result=run(process.argv[2]===undefined?1:Number(process.argv[2]),process.argv[3]===undefined?3600:Number(process.argv[3]));
      console.log(`Factory defaults; 10 words; ${result.responseDelay}s response delay; 60 Hz updates; all attempts successful.`);
      console.table(result.words.map(word=>({...word,unlockTime:word.unlockTime===null?'locked':word.unlockTime.toFixed(3)+'s'})));
      console.log(`${result.complete?'Completed':'Safety timeout reached'} after ${result.duration.toFixed(3)} simulated seconds.`);
      console.log(`Successful retrievals: min ${result.min}, max ${result.max}; max/min ratio ${result.ratio===null?'undefined (minimum is zero)':result.ratio.toFixed(3)+'×'}.`);
      if(!result.complete)process.exitCode=1;
    }
  } catch(error){console.error(error.message);process.exitCode=1;}
}
module.exports={run,sweep,grid,formatDuration};
