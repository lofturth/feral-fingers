const test=require('node:test'),assert=require('node:assert/strict');
const {Physics:P,stateOf}=require('./physics-harness.cjs').testPhysics();
function sessionWithUnlocked(options) {
 const initial=options.config?.unlock?.initialCount ?? 1;
 const config={...options.config};
 if(config.unlock){config.unlock={...config.unlock};delete config.unlock.initialCount;}
 const session=P.createSession({...options,config});
 stateOf(session).cards.forEach((card,i)=>card.unlocked=i<initial);
 return session;
}
const reward=t=>.5+1.5*Math.exp(-1.5*Math.max(0,t));
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
function setPositions(s,positions,shown=positions){const state=stateOf(s);positions.forEach((p,i)=>{state.cards[i].depth=p;state.cards[i].shown=shown[i];});}
// Keep explicit-second regression cases while configuring the new percentage API.
function kickSecondsConfig(seconds,motion={}) {
 const session=P.createSession({config:{motion}});
 session.configure({motion:{kickHeightPercent:P.positionAtTime(seconds,session.getState().config)}});
 return session.getState().config;
}
test('shared falling-speed scaling remains linear, including R=1',()=>{
 for(const bottomToTopMultiplier of [3,10,1]){
  const s=P.createSession({config:{motion:{bottomToTopMultiplier}}}),c=s.getState().config;
  for(const position of [0,25,50,75,100]){
   const factor=bottomToTopMultiplier-(bottomToTopMultiplier-1)*position/100;
   near(P.scalingFactor(position,c),factor);
   near(P.fallingSpeed(position,c),c.motion.topFallingSpeed*factor);
  }
  near(P.fallingSpeed(50,c),(P.fallingSpeed(0,c)+P.fallingSpeed(100,c))/2);
 }
});
test('exact elapsed integration decreases position, saturates at zero, and matches subdivided time',()=>{
 const c=P.createSession().getState().config;
 for(const position of [0,20,80,100]){
  let split=position;for(let i=0;i<600;i++)split=P.fallingDepth(split,1/60,c);
  near(split,P.fallingDepth(position,10,c));assert.ok(split<=position);
 }
 near(P.fallingDepth(100,1e-6,c),100-P.fallingSpeed(100,c)*1e-6);
 assert.equal(P.fallingDepth(80,1000,c),0);
 const flat=P.createSession({config:{motion:{bottomToTopMultiplier:1}}}).getState().config;
 near(P.fallingDepth(50,3,flat),50-P.derivedMotion(flat).baseFallingSpeed*3);
});
test('successful kick uses the pre-kick logical position and no streak bonus',()=>{
 const s=P.createSession({cardCount:2,config:kickSecondsConfig(10)});setPositions(s,[50,0],[40,0]);
 const state=stateOf(s);state.cards[0].streak=20;
 const expected=P.fullKick(50,state.config),answer=s.applyReward(2.0);
 near(answer.kickTime,20);near(answer.lift,P.reverseFallingTime(50,20,state.config)-50);near(s.getState().cards[0].depth,P.reverseFallingTime(50,20,state.config));
 assert.equal(s.getState().cards[0].shown,40);assert.equal(s.getState().cards[0].streak,21);
});
test('exponential rewards apply caller-provided multiplier to time-coordinate kick',()=>{
 for(const [seconds,multiplier] of [0,.5,1,1.5,1.999,2,3,4,10].map(t=>[t,reward(t)])){
  const s=P.createSession({config:kickSecondsConfig(2)});s.advance(seconds);
  const answer=s.applyReward(multiplier);assert.equal(answer.rewardMagnitude,multiplier);
  near(answer.kickTime,2*multiplier);
  near(P.timeCoordinate(s.getState().cards[answer.index].depth,s.getState().config),answer.kickTime);
 }
});
test('reward magnitude directly determines kick time without independent penalty',()=>{
 const s=P.createSession();
 const answer=s.applyReward(reward(0));assert.equal(answer.rewardMagnitude,2);
});
test('skip gives no kick, no success, and moves to the next-lowest active prompt',()=>{
 const s=sessionWithUnlocked({cardCount:4,config:{unlock:{initialCount:3}}});
 setPositions(s,[10,20,30,0]);s.advance(2);const before=s.getState(),result=s.skip(),after=s.getState();
 assert.equal(result.kind,'skip');assert.equal(result.index,0);
 assert.equal(after.rewardCount,before.rewardCount);assert.equal(after.skipCount,1);
 assert.deepEqual(after.cards,before.cards);assert.equal(after.selectedIndex,1);
 s.advance(.1);assert.equal(s.getState().selectedIndex,1); // skipped card does not immediately reappear
 const rewardResult=s.applyReward(reward(.1));assert.equal(rewardResult.index,1);
 assert.equal(s.getState().selectedIndex,0);assert.equal(s.getState().rewardCount,1);
});
test('single active card skip re-selects that card',()=>{
 const s=P.createSession();s.advance(2);s.skip();assert.equal(s.getState().selectedIndex,0);
});
test('lowest selection is deterministic, ignores locks, and tracks active cards',()=>{
 const s=sessionWithUnlocked({cardCount:5,config:{unlock:{initialCount:3}}});
 assert.equal(s.getLowestIndex(),0);s.applyReward(1.0);assert.equal(s.getLowestIndex(),1);
 s.advance(.1);s.applyReward(1.0);assert.equal(s.getLowestIndex(),2);
 const one=P.createSession({cardCount:1});one.advance(4);one.applyReward(1.0);one.advance(.1);assert.equal(one.getLowestIndex(),0);
});
test('successful kicks clamp at 100 with no extra stored lift or headroom',()=>{
 const s=P.createSession({cardCount:2,config:{instantPosition:true}});setPositions(s,[99,0]);
 const answer=s.applyReward(1.0);near(answer.lift,1);assert.equal(s.getState().cards[0].depth,100);
 assert.equal(s.getState().cards[0].shown,100);s.advance(1);
 assert.ok(s.getState().cards[0].depth<100);
});
test('arbitrary dataset sizes, one-card start, stationary locked cards, and no streak gravity effect',()=>{
 for(const size of [1,5,31]){const s=P.createSession({cardCount:size});assert.equal(s.getState().cards.length,size);
 assert.equal(s.getState().cards.filter(w=>w.unlocked).length,1);assert.ok(s.getState().cards.every(w=>w.depth===0));assert.equal(s.getProgress(),0);}
 const s=sessionWithUnlocked({cardCount:4,config:{unlock:{initialCount:3}}});setPositions(s,[50,50,0,0]);
 const state=stateOf(s);state.cards[1].streak=20;s.advance(1);
 near(s.getState().cards[0].depth,s.getState().cards[1].depth);assert.equal(s.getState().cards[3].depth,0);
});
test('strict NEW CARDS contact unlocks one ordered card; no relocking or progress dilution',()=>{
 const s=sessionWithUnlocked({cardCount:5,config:{unlock:{initialCount:3}}}),threshold=P.DEFAULTS.unlock.threshold;
 setPositions(s,[threshold,threshold,threshold,0,0]);assert.equal(s.advance(0).unlockedIndex,null);
 setPositions(s,[threshold+.1,threshold+.1,threshold+.1,0,0]);const before=s.getProgress();
 assert.equal(s.advance(0).unlockedIndex,3);near(s.getProgress(),before);assert.equal(s.advance(0).unlockedIndex,null);
 assert.equal(s.getState().cards[3].depth,0);
 setPositions(s,[0,0,0,0,0]);s.advance(1);assert.equal(s.getState().cards.filter(w=>w.unlocked).length,4);
});
test('unlock and completion require both logical and displayed positions',()=>{
 const s=P.createSession({cardCount:2});setPositions(s,[100,0],[30,0]);assert.equal(s.advance(0).unlockedIndex,null);
 assert.equal(s.isComplete(),false);s.advance(.2);assert.equal(s.getState().cards.filter(w=>w.unlocked).length,2);
 const one=P.createSession({cardCount:1}),threshold=P.DEFAULTS.finish.threshold;
 setPositions(one,[threshold],[threshold]);one.advance(0);assert.equal(one.isComplete(),false);
 setPositions(one,[100],[threshold]);one.advance(0);assert.equal(one.isComplete(),false);
 setPositions(one,[threshold+.1],[threshold+.1]);one.advance(0);assert.equal(one.isComplete(),true);assert.equal(one.getProgress(),100);
});
test('completion requires the full dataset and freezes positions, timers, successes, and skips',()=>{
 const s=P.createSession({cardCount:5,config:{instantPosition:true}});
 for(let i=0;i<1000&&!s.isComplete();i++){s.advance(.05);s.applyReward(1.0);}
 assert.ok(s.isComplete());assert.equal(s.getProgress(),100);const saved=s.getState();
 s.advance(60);assert.equal(s.applyReward(1.0),null);assert.equal(s.skip(),null);s.setPaused(false);assert.deepEqual(s.getState(),saved);
});
test('pause freezes physics and input; resume excludes paused duration',()=>{
 const s=P.createSession();s.advance(1.9);s.setPaused(true);const saved=s.getState();
 s.advance(50);s.applyReward(1.0);s.skip();assert.deepEqual(s.getState(),saved);
 s.setPaused(false);s.advance(.1);const res=s.applyReward(reward(2));near(res.rewardMagnitude,reward(2));
});
test('fresh sessions replay mixed reward/skip runs deterministically and getState stays detached',()=>{
 const a=sessionWithUnlocked({cardCount:8,config:{unlock:{initialCount:3}}}),b=sessionWithUnlocked({cardCount:8,config:{unlock:{initialCount:3}}});
 for(const s of [a,b]){s.advance(2);s.skip();s.advance(2);}
 for(let i=0;i<40;i++){for(const s of [a,b]){s.advance(.17);if(i%7===0)s.skip();else s.applyReward(1.0);}}
 assert.deepEqual(a.getState(),b.getState());const snapshot=a.getState();snapshot.cards[0].depth=-99;assert.notEqual(a.getState().cards[0].depth,-99);
});
test('rejects invalid configurations and multipliers and supports the three new controls',()=>{
 const s=P.createSession();assert.throws(()=>s.applyReward(0,-1),RangeError);
 for(const bottomToTopMultiplier of [0,-1,.9,NaN])assert.throws(()=>s.configure({motion:{bottomToTopMultiplier}}),RangeError);
 for(const dt of [-1,NaN,Infinity])assert.throws(()=>s.advance(dt),RangeError);
 assert.throws(()=>s.configure({gravity:{maxSpeed:9}}),RangeError);assert.throws(()=>P.createSession({cardCount:0}),RangeError);
 s.configure({motion:{kickHeightPercent:25,topFallingSpeed:.5,bottomToTopMultiplier:2}});assert.deepEqual(s.getState().config.motion,{kickHeightPercent:25,topFallingSpeed:.5,bottomToTopMultiplier:2,gravityReductionPercent:5});
});

test('compensation controls derive speeds and kicks without independent overrides',()=>{
 const s=P.createSession();const initial=s.getState().config;
 near(initial.motion.topFallingSpeed,1);near(initial.motion.kickHeightPercent,25);
 near(P.derivedMotion(initial).baseFallingSpeed,5);near(P.derivedMotion(initial).baseKick,P.fullKick(0,initial));
 for(const strength of [10,60,100])for(const bottomToTopMultiplier of [10,3,1]){
  s.configure({motion:{topFallingSpeed:.8,kickHeightPercent:strength,bottomToTopMultiplier}});
  const c=s.getState().config,seconds=P.timeCoordinate(strength,c);near(P.fallingSpeed(100,c),.8);near(P.fallingSpeed(0,c),.8*bottomToTopMultiplier);
  for(const h of [0,25,50,75,100]){
   const ceiling=P.timeCoordinate(100,c),before=P.timeCoordinate(h,c);
   near(P.timeCoordinate(h+P.fullKick(h,c),c),Math.min(ceiling,before+seconds));
   near(P.timeCoordinate(h+P.timeCoordinateKick(h,reward(2),c).lift,c),Math.min(ceiling,before+seconds*reward(2)));
  }
 }
 for(const field of ['baseKick','baseFallingSpeed','ratio','kickCompensationSeconds'])assert.throws(()=>s.configure({motion:{[field]:5}}),RangeError);
 for(const field of ['topFallingSpeed','kickHeightPercent'])for(const value of [0,-1,Infinity,NaN])assert.throws(()=>s.configure({motion:{[field]:value}}),RangeError);
 const capped=P.createSession({cardCount:2,config:{motion:{kickHeightPercent:100}}});const answer=capped.applyReward(1.0);assert.equal(answer.lift,100);near(answer.kickTime,P.baselineKickTime(capped.getState().config));capped.advance(.1);assert.ok(capped.getState().cards[0].depth<100);
});

test('changing to R preserves the previous effective linear position physics',()=>{
 for(const R of [1,3,10]){
  const c=P.createSession({config:{motion:{bottomToTopMultiplier:R}}}).getState().config;
  for(const height of [0,25,50,75,100]){
   const oldFactor=1-(1-1/R)*height/100;
   near(P.fallingSpeed(height,c),c.motion.topFallingSpeed*R*oldFactor);
  }
 }
});

test('60-second 1x kicks reverse 60 seconds of falling at multiple heights and speed multipliers',()=>{
 for(const R of [1,1+Number.EPSILON,1+1e-12,1+1e-8,2,3,10]){
  const c=P.createSession({config:kickSecondsConfig(60,{topFallingSpeed:.1,bottomToTopMultiplier:R})}).getState().config;
  for(const start of [5,20,40,70]){
   const kicked=start+P.fullKick(start,c);assert.ok(kicked<100);
   near(P.fallingDepth(kicked,60,c),start);
   near(P.timeCoordinate(kicked,c)-P.timeCoordinate(start,c),60);
   near(P.positionAtTime(P.timeCoordinate(start,c),c),start);
   assert.ok(Number.isFinite(kicked));
   if(R===1)near(kicked,start+6);
  }
 }
 const c=kickSecondsConfig(60,{topFallingSpeed:300/442,bottomToTopMultiplier:3});
 for(const start of [5,15,25])near(P.fallingDepth(start+P.fullKick(start,c),60,c),start);
});

test('time-coordinate kicks agree with independently integrated physical falling time',()=>{
 for(const R of [1,1+1e-10,3,10]){
  const c=P.createSession({config:kickSecondsConfig(60,{topFallingSpeed:.1,bottomToTopMultiplier:R})}).getState().config;
  const start=20,end=P.reverseFallingTime(start,90,c);assert.ok(end<100);
  const n=10000,dx=(end-start)/n;let elapsed=0;
  for(let i=0;i<n;i++){const x=start+(i+.5)*dx;elapsed+=dx/(.1*(R-(R-1)*x/100));}
  assert.ok(Math.abs(elapsed-90)<1e-6,`${R}: ${elapsed}`);
 }
});

test('speed and hint multipliers scale reversed time, not displacement',()=>{
 for(const [latency,multiplier] of [[0,reward(0)],[.5,reward(.5)],[1,reward(1)],[1.5,reward(1.5)],[2,reward(2)],[100,reward(100)]]){
  const s=P.createSession({cardCount:2,config:kickSecondsConfig(60,{topFallingSpeed:.1})});
  const snapshot=stateOf(s);snapshot.cards[0].depth=20;snapshot.cards[0].shown=20;
  const c=s.getState().config,answer=s.applyReward(multiplier),end=s.getState().cards[0].depth;
  near(answer.kickTime,60*multiplier);near(answer.rewardMagnitude,multiplier);assert.ok(end<100);
  near(P.fallingDepth(end,answer.kickTime,c),20);
  near(P.timeCoordinate(end,c)-P.timeCoordinate(20,c),answer.kickTime);
  s.advance(answer.kickTime);near(s.getState().cards[0].depth,20);
 }
});

test('ceiling discards excess kick time, falling clamps at bottom, and dt=0 preserves exact thresholds',()=>{
 const c=kickSecondsConfig(60,{topFallingSpeed:300/442,bottomToTopMultiplier:3});
 const topTime=P.timeCoordinate(100,c);
 assert.equal(P.positionAtTime(topTime+1000,c),100);assert.equal(P.positionAtTime(-10,c),0);
 assert.equal(P.reverseFallingTime(95,60,c),100);assert.equal(P.fallingDepth(50,10000,c),0);
 assert.ok(P.fallingDepth(100,.1,c)<100);
 for(const height of [0,50,95,100])assert.equal(P.fallingDepth(height,0,c),height);
 const oldLocalDistance=P.fallingSpeed(0,c)*60,exact=P.fullKick(0,c);
 assert.ok(oldLocalDistance>100);assert.ok(exact<100);near(P.fallingDepth(exact,60,c),0);
});

test('time-coordinate falling preserves the previous analytic linear-speed trajectory',()=>{
 for(const R of [1,2,3,10]){
  const c=P.createSession({config:{motion:{bottomToTopMultiplier:R}}}).getState().config;
  const a=c.motion.topFallingSpeed*R,b=c.motion.topFallingSpeed*(R-1)/100;
  for(const x of [0,20,50,95,100])for(const dt of [0,1/60,1,10,60,100]){
   const previous=b>0?x+(x*b-a)*Math.expm1(b*dt)/b:x-a*dt;
   near(P.fallingDepth(x,dt,c),Math.max(0,Math.min(100,previous)));
  }
 }
});

test('25% reference height, 2x and caller-scaled kicks reverse exponential multiples of baseline time',()=>{
 const s=P.createSession({cardCount:2}),c=s.getState().config;
 near(c.motion.kickHeightPercent,25);near(P.baselineKickTime(c),P.timeCoordinate(25,c));
 const baseline=P.fullKick(0,c);assert.ok(baseline>0 && baseline<100);
 near(baseline,25);near(P.timeCoordinate(baseline,c),P.baselineKickTime(c));
 near(P.fallingDepth(baseline,P.baselineKickTime(c),c),0);
 const immediate=s.applyReward(2);near(s.getState().cards[0].depth,45);
 near(immediate.rewardMagnitude,2);near(immediate.kickTime,2*P.baselineKickTime(c));
 const assisted=P.createSession({cardCount:2});assisted.advance(2);
 const result=assisted.applyReward(reward(2)),height=assisted.getState().cards[0].depth;
 near(result.rewardMagnitude,reward(2));near(result.kickTime,P.baselineKickTime(c)*reward(2));
 near(P.timeCoordinate(height,c),P.baselineKickTime(c)*reward(2));assert.ok(height<baseline);
});

test('speed changes rescale kick seconds but preserve reference-height behavior',()=>{
 for(const R of [1,1+1e-12,3,10,100]){
  const s=P.createSession({config:{motion:{topFallingSpeed:.5,bottomToTopMultiplier:R}}});
  const before=s.getState().config,field=P.fieldFallTime(before),baseline=P.baselineKickTime(before);
  s.configure({motion:{topFallingSpeed:2}});const after=s.getState().config;
  assert.equal(after.motion.kickHeightPercent,25);
  near(P.fieldFallTime(after),field/4);near(P.baselineKickTime(after),baseline/4);
  for(const height of [0,20,70,95])for(const latency of [0,.5,1,1.5]){
   near(P.timeCoordinateKick(height,reward(latency),before).lift,P.timeCoordinateKick(height,reward(latency),after).lift);
  }
 }
});

test('R changes recalculate field time and baseline while preserving reference height',()=>{
 const s=P.createSession();
 for(const R of [1,1+1e-12,2,10,100])for(const strength of [25,50,76,100]){
  s.configure({motion:{bottomToTopMultiplier:R,kickHeightPercent:strength}});
  const c=s.getState().config,field=P.fieldFallTime(c);
  near(P.baselineKickTime(c),P.timeCoordinate(strength,c));
  near(P.fullKick(0,c),strength);
  assert.equal(c.motion.kickHeightPercent,strength);
  assert.equal(P.derivedMotion(c).fieldFallTime,field);
  assert.equal(P.derivedMotion(c).baselineKickTime,P.baselineKickTime(c));
 }
});

test('unlocked-card gravity follows the multiplicative rule and excludes locked cards',()=>{
 assert.equal(P.DEFAULTS.motion.gravityReductionPercent,5);
 const c=P.createSession({config:{motion:{gravityReductionPercent:2}}}).getState().config;
 for(const n of [1,5,10,20,30]){
  near(P.gravityMultiplier(c,n),Math.pow(.98,n-1));
  const s=sessionWithUnlocked({cardCount:35,config:{unlock:{initialCount:n},motion:{gravityReductionPercent:2}}}),state=s.getState();
  assert.equal(state.unlockedCardCount,n);near(state.gravityMultiplier,Math.pow(.98,n-1));
  for(const height of [0,50,100])near(P.fallingSpeed(height,c,n),P.fallingSpeed(height,c)*state.gravityMultiplier);
  near(state.fieldFallTime,P.fieldFallTime(c)/state.gravityMultiplier);
 }
 assert.equal(P.gravityMultiplier(c,1),1);
 assert.ok(Math.abs(P.gravityMultiplier(c,30)*100-55.66)<.005);
 for(let n=2;n<=30;n++)near(P.gravityMultiplier(c,n)/P.gravityMultiplier(c,n-1),.98);
});

test('zero reduction preserves original falling and kicks, including many active cards',()=>{
 const s=sessionWithUnlocked({cardCount:30,config:{motion:{gravityReductionPercent:0},unlock:{initialCount:30}}});
 const c=s.getState().config,original=P.createSession().getState().config;
 assert.equal(s.getState().gravityMultiplier,1);
 for(const height of [0,20,60,100]){
  near(P.fallingSpeed(height,c,30),P.fallingSpeed(height,original,1));
  near(P.fallingDepth(height,3,c,30),P.fallingDepth(height,3,original,1));
  near(P.timeCoordinateKick(height,1.0,c,30).lift,P.timeCoordinateKick(height,1.0,original,1).lift);
 }
});

test('unlock immediately updates effective gravity and the next falling update uses it',()=>{
 const s=P.createSession({cardCount:5,config:{instantPosition:true}});setPositions(s,[51,0,0,0,0]);
 const transition=s.advance(0),after=s.getState();assert.equal(transition.unlockedIndex,1);
 assert.equal(after.unlockedCardCount,2);near(after.gravityMultiplier,.95);
 near(after.fieldFallTime,P.fieldFallTime(after.config,1)/.95);
 s.advance(1);near(s.getState().cards[0].depth,P.fallingDepth(51,1,after.config,2));
 assert.ok(s.getState().cards[0].depth>P.fallingDepth(51,1,after.config,1));
 assert.equal(s.getState().cards[2].depth,0);
});

test('kick destinations are unchanged across unlocked counts, including ceilings',()=>{
 for(const height of [0,20,60,95])for(const latency of [0,.5,1,1.5,2,20]){
  let reference;
  const mult=reward(latency);
  for(const n of [1,5,30]){
   const s=sessionWithUnlocked({cardCount:31,config:{unlock:{initialCount:n}}});
   const saved=stateOf(s);
   saved.cards.forEach((card,i)=>{if(card.unlocked){card.depth=i===0?height:100;card.shown=i===0?height:0;}});
   const result=s.applyReward(0,mult),end=s.getState().cards[0].depth;
   assert.equal(result.index,0);
   near(result.kickTime,P.baselineKickTime(saved.config,n)*mult);
   if(reference===undefined)reference=end;else near(end,reference);
   near(end,height+P.timeCoordinateKick(height,mult,saved.config,n).lift);
  }
 }
});

test('gravity settings and unlocked counts replay deterministically; overrides take effect live',()=>{
 const s=sessionWithUnlocked({cardCount:8,config:{unlock:{initialCount:3},motion:{gravityReductionPercent:5}}});
 const replay=sessionWithUnlocked({cardCount:8,config:{unlock:{initialCount:3},motion:{gravityReductionPercent:5}}});
 for(const run of [s,replay]){run.advance(1);run.skip();run.advance(2);}
 for(let i=0;i<20;i++)for(const run of [s,replay]){run.advance(.2);run.applyReward(1.0);}
 assert.deepEqual(s.getState(),replay.getState());
 const saved=s.getState();near(saved.gravityMultiplier,.95**(saved.unlockedCardCount-1));
 s.configure({motion:{gravityReductionPercent:0}});assert.equal(s.getState().gravityMultiplier,1);
 for(const invalid of [-.1,10.1,Infinity,NaN])assert.throws(()=>s.configure({motion:{gravityReductionPercent:invalid}}),RangeError);
 s.configure({motion:{gravityReductionPercent:10}});near(s.getState().gravityMultiplier,.9**(s.getState().unlockedCardCount-1));
 s.setPaused(true);const frozen=s.getState();s.advance(100);s.applyReward(1.0);s.skip();assert.deepEqual(s.getState(),frozen);
 s.setPaused(false);assert.equal(s.getState().unlockedCardCount,frozen.unlockedCardCount);
});

test('normal bottom kick reaches configured reference height across speed, R and gravity settings',()=>{
 for(const height of [1,25,76,100])for(const topFallingSpeed of [.1,1,3])for(const R of [1,1+1e-12,3,10])for(const reduction of [0,2,10]){
  const c=P.createSession({config:{motion:{kickHeightPercent:height,topFallingSpeed,bottomToTopMultiplier:R,gravityReductionPercent:reduction}}}).getState().config;
  for(const n of [1,5,30]){
   near(P.baselineKickTime(c,n),P.timeCoordinate(height,c,n));
   near(P.fullKick(0,c,n),height);
   near(P.reverseFallingTime(0,P.baselineKickTime(c,n),c,n),height);
  }
 }
});

test('reference-height retrieval bonuses scale time',()=>{
 for(const R of [1,3,10])for(const n of [1,5,30])for(const [latency,multiplier] of [[0,reward(0)],[1,reward(1)],[2,reward(2)],[20,reward(20)]]){
  const s=sessionWithUnlocked({cardCount:31,config:{motion:{kickHeightPercent:25,bottomToTopMultiplier:R},unlock:{initialCount:n}}});
  const saved=stateOf(s);
  saved.cards.forEach((w,i)=>{if(w.unlocked){w.depth=i===0?0:100;w.shown=0;}});
  const baseline=P.timeCoordinate(25,saved.config,n),result=s.applyReward(multiplier),height=s.getState().cards[0].depth;
  near(result.kickTime,baseline*multiplier);near(P.timeCoordinate(height,saved.config,n),result.kickTime);
  s.advance(result.kickTime);near(s.getState().cards[0].depth,0);
 }
});

test('reference height bounds safely reject old kick settings',()=>{
 const s=P.createSession();assert.equal(s.getState().config.motion.kickHeightPercent,25);
 for(const height of [0,.9,100.1,Infinity,NaN])assert.throws(()=>s.configure({motion:{kickHeightPercent:height}}),RangeError);
 assert.throws(()=>s.configure({motion:{kickStrengthPercent:50}}),RangeError);
 s.configure({motion:{kickHeightPercent:60,gravityReductionPercent:5}});s.advance(1);s.skip();
 s.configure({motion:{kickHeightPercent:100}});assert.equal(P.reverseFallingTime(95,2*P.baselineKickTime(s.getState().config),s.getState().config),100);
});

test('shared exponential multiplier matches the formula',()=>{
 const formula=t=>.5+1.5*Math.exp(-1.5*Math.max(0,t));
 for(const [t,rounded] of [[0,2],[.5,1.209],[1,.835],[1.5,.658],[2,.575],[3,.517],[4,.504]]){
  near(formula(t),.5+1.5*Math.exp(-1.5*t));
  assert.ok(Math.abs(formula(t)-rounded)<.0005);
 }
 for(let i=1;i<=200;i++)assert.ok(formula(i/10)<formula((i-1)/10));
 for(const t of [0,1,2,10,20,100,1000])assert.ok(formula(t)>=.5);
 assert.ok(formula(20)<.500000000001);
});

test('production API keeps detached inspection but exposes no restoration or schema version',()=>{
 const Physics=require('../core/physics.js'),session=Physics.createSession();
 assert.equal('restoreSession' in Physics,false);assert.equal('restore' in session,false);
 const view=session.getState();assert.equal('version' in view,false);
 view.cards[0].depth=99;view.config.motion.kickHeightPercent=100;view.rewardCount=900;
 const actual=session.getState();assert.equal(actual.cards[0].depth,0);assert.equal(actual.config.motion.kickHeightPercent,25);assert.equal(actual.rewardCount,0);
});

test('starting count is fixed at one and is not configurable',()=>{
 for(const size of [1,10,30]){
  const s=P.createSession({cardCount:size});assert.equal(s.getState().unlockedCardCount,1);
  assert.throws(()=>s.configure({unlock:{initialCount:2}}),RangeError);
 }
});

test('applyReward supplies a generic magnitude and applies canonical time-coordinate kick',()=>{
 const s=P.createSession({cardCount:1});
 assert.equal(s.getState().cards[0].depth,0);
 const halfResult=s.applyReward(0,0.5);
 assert.equal(halfResult.kind,'reward');
 assert.equal(halfResult.rewardMagnitude,0.5);
 assert.equal(halfResult.previousDepth,0);
 near(halfResult.newDepth,13.196601125010515);
 near(halfResult.lift,13.196601125010515);
 near(s.getState().cards[0].depth,13.196601125010515);

 const fullResult=s.applyReward(0,1.0);
 assert.equal(fullResult.kind,'reward');
 assert.equal(fullResult.rewardMagnitude,1.0);
 near(fullResult.previousDepth,13.196601125010515);
 near(fullResult.newDepth,35.55728090000841);
 near(fullResult.lift,22.36067977499789);
 near(s.getState().cards[0].depth,35.55728090000841);

 const zeroResult=s.applyReward(0,0);
 assert.equal(zeroResult.lift,0);
 near(s.getState().cards[0].depth,35.55728090000841);

 assert.throws(()=>s.applyReward('bad',1),TypeError);
 assert.throws(()=>s.applyReward(99,1),RangeError);
 assert.throws(()=>s.applyReward(0,-1),RangeError);
});
