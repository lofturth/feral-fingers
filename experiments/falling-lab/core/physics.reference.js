/* DOM-free, deterministic session model. Classic browser script + CommonJS
 * export keep index.html usable directly via file:// without a build/server.
 *
 * const session = MunduPhysics.createSession({ wordCount: 20 });
 * session.advance(0.1);       // explicit seconds, not a wall clock
 * session.retrieve();         // successful; session.skip() advances without a kick
 * const state = session.getState(); // detached inspection snapshot
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MunduPhysics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // Positions and lifts are percentages (0 = bottom, 100 = top).
  // Falling speeds are positive magnitudes in percentage points per second.
  const DEFAULTS = Object.freeze({
    bounds: Object.freeze({ top:100, bottom:0 }),
    motion: Object.freeze({ topFallingSpeed:1, kickHeightPercent:25, bottomToTopMultiplier:5, gravityReductionPercent:5 }),
    unlock: Object.freeze({ threshold:50 }),
    finish: Object.freeze({ threshold:90 }),
    instantPosition:false
  });
  const RETRIEVAL=Object.freeze({ hintSeconds:2 });
  const clone = value => JSON.parse(JSON.stringify(value));
  const clamp = (n,low,high) => Math.max(low,Math.min(high,n));
  function configuration(patch={}, previous=DEFAULTS) {
    const config={};
    const groups=['bounds','motion','unlock','finish'];
    for(const key of Object.keys(patch))if(!groups.includes(key)&&key!=='instantPosition')throw new RangeError('Unknown configuration field: '+key);
    for (const key of groups) {
      for(const field of Object.keys(patch[key]??{}))if(!(field in previous[key]))throw new RangeError('Unknown configuration field: '+key+'.'+field);
      config[key]={...previous[key],...patch[key]};
      for (const value of Object.values(config[key])) {
        if (!Number.isFinite(value)) throw new RangeError('Configuration values must be finite');
      }
    }
    config.instantPosition=patch.instantPosition ?? previous.instantPosition;
    const {bounds:b,motion:m,unlock:u,finish:f}=config;
    if (!(b.bottom===0 && b.top===100 && b.bottom<u.threshold &&
      u.threshold<f.threshold && f.threshold<b.top && m.topFallingSpeed>0 && m.kickHeightPercent>=1 && m.kickHeightPercent<=100 && Number.isFinite(m.topFallingSpeed*m.bottomToTopMultiplier) && m.bottomToTopMultiplier>=1 && m.gravityReductionPercent>=0 && m.gravityReductionPercent<=10 &&
      typeof config.instantPosition==='boolean')) throw new RangeError('Invalid physics configuration');
    return config;
  }
  function isAboveFinish(word,threshold) {
    return word.unlocked && Math.min(word.depth,word.shown)>threshold;
  }
  function wordProgress(word,threshold) {
    if (!word.unlocked) return 0;
    const distance=Math.max(0,threshold-word.initialDepth);
    const traveled=clamp(Math.min(word.depth,word.shown)-word.initialDepth,0,distance);
    return distance>0?traveled/distance:1;
  }
  function scalingFactor(position,config) {
    const h=clamp(position/100,0,1);
    const R=config.motion.bottomToTopMultiplier;
    return R-(R-1)*h;
  }
  function gravityMultiplier(config,unlockedWordCount=1) {
    if(!Number.isInteger(unlockedWordCount) || unlockedWordCount<1)throw new RangeError('Unlocked count must be a positive integer');
    return Math.pow(1-config.motion.gravityReductionPercent/100,unlockedWordCount-1);
  }
  // x is percentage height; a is points/second and b is 1/second.
  // v(x) = a - b*x. The tau coordinate is measured in seconds.
  function fallingCoefficients(config,unlockedWordCount=1) {
    const {topFallingSpeed,bottomToTopMultiplier:R}=config.motion;
    const effectiveTopSpeed=topFallingSpeed*gravityMultiplier(config,unlockedWordCount);
    return {a:effectiveTopSpeed*R,b:effectiveTopSpeed*(R-1)/100};
  }
  function fallingSpeed(position,config,unlockedWordCount=1) {
    return config.motion.topFallingSpeed*gravityMultiplier(config,unlockedWordCount)*scalingFactor(position,config);
  }
  function timeCoordinate(position,config,unlockedWordCount=1) {
    const x=clamp(position,0,100),{a,b}=fallingCoefficients(config,unlockedWordCount);
    if(b===0)return x/a;
    if(x===100)return Math.log1p(config.motion.bottomToTopMultiplier-1)/b;
    const q=b*x/a;
    // log1p avoids cancellation as R approaches one; the q=0 limit
    // also handles underflow at negligible heights/slopes.
    return q===0?x/a:(x/a)*(-Math.log1p(-q)/q);
  }
  function positionAtTime(seconds,config,unlockedWordCount=1) {
    const {a,b}=fallingCoefficients(config,unlockedWordCount),ceiling=timeCoordinate(100,config,unlockedWordCount);
    if(seconds<=0)return 0;
    if(seconds>=ceiling)return 100;
    const z=b*seconds;
    const x=z===0?a*seconds:a*seconds*(-Math.expm1(-z)/z);
    return clamp(x,0,100);
  }
  function reverseFallingTime(position,seconds,config,unlockedWordCount=1) {
    const x=clamp(position,0,100);
    return seconds===0?x:positionAtTime(timeCoordinate(x,config,unlockedWordCount)+seconds,config,unlockedWordCount);
  }
  function fieldFallTime(config,unlockedWordCount=1) { return timeCoordinate(100,config,unlockedWordCount); }
  function baselineKickTime(config,unlockedWordCount=1) { return timeCoordinate(config.motion.kickHeightPercent,config,unlockedWordCount); }
  function fullKick(position,config,unlockedWordCount=1) {
    return reverseFallingTime(position,baselineKickTime(config,unlockedWordCount),config,unlockedWordCount)-clamp(position,0,100);
  }
  function derivedMotion(config,unlockedWordCount=1) {
    return {baseFallingSpeed:fallingCoefficients(config,unlockedWordCount).a,baseKick:fullKick(0,config,unlockedWordCount),fieldFallTime:fieldFallTime(config,unlockedWordCount),baselineKickTime:baselineKickTime(config,unlockedWordCount)};
  }
  function fallingDepth(position,dt,config,unlockedWordCount=1) {
    const x=clamp(position,0,100);
    return dt===0?x:positionAtTime(timeCoordinate(x,config,unlockedWordCount)-dt,config,unlockedWordCount);
  }
  function kickMultiplier(elapsedSeconds) {
    const t=Math.max(0,elapsedSeconds);
    return 0.5+1.5*Math.exp(-1.5*t);
  }
  function retrievalLift(position,config,_hintVisible=false,latency=0,unlockedWordCount=1) {
    const kickTime=baselineKickTime(config,unlockedWordCount)*kickMultiplier(latency);
    return reverseFallingTime(position,kickTime,config,unlockedWordCount)-clamp(position,0,100);
  }
  function createSession(options={}) {
    let config=configuration(options.config);
    const vocabulary=options.vocabulary ?? Array.from({length:options.wordCount ?? 10},(_,i)=>['word'+(i+1),'']);
    if (!Array.isArray(vocabulary) || vocabulary.length<1 ||
      (options.wordCount!==undefined && (!Number.isInteger(options.wordCount) || options.wordCount<1))) {
      throw new RangeError('A session needs a positive vocabulary size');
    }
    let state={config,words:vocabulary.map((entry,i)=>({
      english:Array.isArray(entry)?String(entry[0]):String(entry.english ?? entry),
      spanish:Array.isArray(entry)?String(entry[1] ?? ''):String(entry.spanish ?? ''),
      streak:0,unlocked:i===0,
      initialDepth:config.bounds.bottom,depth:config.bounds.bottom,shown:config.bounds.bottom
    })),time:0,paused:false,complete:false,selectedIndex:0,selectedAt:0,hintVisible:false,skippedIndex:-1,retrievalCount:0,skipCount:0,lastRetrieval:null};
    function lowestIndex() {
      let lowest=-1;
      state.words.forEach((word,i)=>{
        if (i!==state.skippedIndex && word.unlocked && (lowest<0 || word.depth<state.words[lowest].depth)) lowest=i;
      });
      // With only one active word, skipping restarts that same prompt.
      if(lowest<0)lowest=state.words.findIndex(word=>word.unlocked);
      return lowest;
    }
    function select() {
      const index=lowestIndex();
      if (index!==state.selectedIndex) { state.selectedIndex=index; state.selectedAt=state.time; state.hintVisible=false; }
      return index;
    }
    function reconcile() {
      let unlockedIndex=null, completedNow=false;
      if (!state.paused && !state.complete) {
        const active=state.words.filter(word=>word.unlocked);
        if (active.every(word=>Math.min(word.depth,word.shown)>config.unlock.threshold)) {
          const index=state.words.findIndex(word=>!word.unlocked);
          if (index>=0) {
            const word=state.words[index];
            word.unlocked=true; word.depth=config.bounds.bottom; word.shown=config.bounds.bottom; word.streak=0;
            unlockedIndex=index;
          }
        }
      }
      select();
      // Absorb floating-point clock conversion noise at the exact deadline.
      // This is sub-nanosecond precision tolerance, not a gameplay grace period.
      const clockPrecision=128*Number.EPSILON*Math.max(1,state.time,state.selectedAt);
      if(!state.paused&&!state.complete&&state.time-state.selectedAt+clockPrecision>=RETRIEVAL.hintSeconds)state.hintVisible=true;
      // Existing completion can also be detected when paused/tuning changes.
      if (!state.complete && state.words.every(word=>isAboveFinish(word,config.finish.threshold))) {
        state.complete=true; state.paused=true; completedNow=true;
      }
      return {unlockedIndex,completedNow};
    }
    function getProgress() {
      const value=clamp(100*state.words.reduce((sum,word)=>sum+wordProgress(word,config.finish.threshold),0)/state.words.length,0,100);
      return value===100 && !state.words.every(word=>isAboveFinish(word,config.finish.threshold))?100-1e-10:value;
    }
    function unlockedCount() { return state.words.filter(word=>word.unlocked).length; }
    const api={
      advance(dt) {
        if (!Number.isFinite(dt) || dt<0) throw new RangeError('Duration must be finite and nonnegative');
        if (state.paused || state.complete) return {unlockedIndex:null,completedNow:false};
        const activeCount=unlockedCount();
        for (const word of state.words) {
          if (!word.unlocked) continue;
          word.depth=fallingDepth(word.depth,dt,config,activeCount);
          // A numerical response position, not a browser animation: threshold
          // checks historically wait for this position as well as logical depth.
          word.shown=config.instantPosition?word.depth:word.shown+(word.depth-word.shown)*(1-Math.exp(-15*dt));
        }
        state.time+=dt;
        return reconcile();
      },
      retrieve() {
        if(arguments.length)throw new TypeError('retrieve() is successful only; use skip() to skip');
        if (state.paused || state.complete) return null;
        const index=select(),word=state.words[index],previousDepth=word.depth;
        const latency=Math.max(0,state.time-state.selectedAt),hintVisible=state.hintVisible;
        const activeCount=unlockedCount();
        const fullLift=fullKick(previousDepth,config,activeCount);
        word.streak++;
        word.depth=clamp(previousDepth+retrievalLift(previousDepth,config,hintVisible,latency,activeCount),config.bounds.bottom,config.bounds.top);
        if(config.instantPosition)word.shown=word.depth;
        const result={kind:'retrieval',index,word:word.english,translation:word.spanish,latency,hintVisible,
          multiplier:kickMultiplier(latency),kickTime:baselineKickTime(config,activeCount)*kickMultiplier(latency),fullLift,lift:word.depth-previousDepth};
        state.lastRetrieval=result;state.retrievalCount++;
        state.skippedIndex=-1;state.selectedIndex=-1;
        Object.assign(result,reconcile());return clone(result);
      },
      skip() {
        if(state.paused||state.complete)return null;
        const index=select(),word=state.words[index];
        const result={kind:'skip',index,word:word.english,translation:word.spanish,
          latency:Math.max(0,state.time-state.selectedAt),hintVisible:state.hintVisible,multiplier:0,kickTime:0,lift:0};
        state.lastRetrieval=result;state.skipCount++;
        // Skip this word for the next prompt; all words continue falling.
        state.skippedIndex=index;state.selectedIndex=-1;
        Object.assign(result,reconcile());return clone(result);
      },
      getState() {
        const unlockedWordCount=unlockedCount();
        return clone({...state,config,unlockedWordCount,gravityMultiplier:gravityMultiplier(config,unlockedWordCount),
          fieldFallTime:fieldFallTime(config,unlockedWordCount),baselineKickTime:baselineKickTime(config,unlockedWordCount)});
      },
      getProgress,
      getLowestIndex:lowestIndex,
      isComplete() { return state.complete; },
      setPaused(value) {
        if (typeof value!=='boolean') throw new TypeError('Paused must be a boolean');
        if (!state.complete) state.paused=value;
      },
      configure(patch, {recheckCompletion=false}={}) {
        config=configuration(patch,config); state.config=config;
        if (recheckCompletion) state.complete=false;
        return reconcile();
      }
    };
    return api;
  }
  return Object.freeze({DEFAULTS,RETRIEVAL,createSession,gravityMultiplier,derivedMotion,fieldFallTime,baselineKickTime,timeCoordinate,positionAtTime,reverseFallingTime,scalingFactor,fullKick,fallingSpeed,fallingDepth,kickMultiplier,retrievalMultiplier:kickMultiplier,retrievalLift,wordProgress,isAboveFinish});
});
