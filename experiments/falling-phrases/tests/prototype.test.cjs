const reward=t=>.5+1.5*Math.exp(-1.5*Math.max(0,t));
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {makeHost}=require('./dom-harness.cjs');
const fixtures=require('./legacy-fixtures.json');
const {Physics,stateOf}=require('./physics-harness.cjs').testPhysics();
const base=path.join(__dirname,'..');
const files={html:fs.readFileSync(path.join(base,'index.html'),'utf8'),app:fs.readFileSync(path.join(base,'app.js'),'utf8'),physics:fs.readFileSync(path.join(base,'physics.js'),'utf8')};
function host(options={}){return makeHost({...files,...options});}
function compare(actual,expected){
 if(typeof expected==='number')assert.ok(Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`);
 else if(expected && typeof expected==='object')for(const key of Object.keys(expected))compare(actual[key],expected[key]);
 else assert.equal(actual,expected);
}
const snapshot=h=>JSON.parse(h.run(`JSON.stringify({time:activeTime,paused,complete:sessionComplete,selectedIndex:session.getState().selectedIndex,selectedAt:session.getState().selectedAt,retrievalCount:count,progress:progressValue,words:words.map(w=>[w.initialDepth,w.depth,w.shown,w.streak,w.unlocked])})`));
for(const fixture of fixtures)test(`prototype/engine parity: initial=${fixture.options.initialCount}, instant=${fixture.options.instantPosition}`,()=>{
 const h=host({instantPosition:fixture.options.instantPosition});
 h.run(`testState(session).words.forEach((w,i)=>w.unlocked=i<${fixture.options.initialCount});syncSession();render(0);`);
 const engine=Physics.createSession({wordCount:10,config:{instantPosition:fixture.options.instantPosition}});
 stateOf(engine).words.forEach((w,i)=>w.unlocked=i<fixture.options.initialCount);
 const expected=()=>{const s=engine.getState();return {
   time:s.time,paused:s.paused,complete:s.complete,selectedIndex:s.selectedIndex,
   selectedAt:s.selectedAt,retrievalCount:s.retrievalCount,progress:engine.getProgress(),
   words:s.words.map(w=>[w.initialDepth,w.depth,w.shown,w.streak,w.unlocked])
 };};
 compare(snapshot(h),expected());
 fixture.actions.forEach(action=>{
   if(action.type==='advance'){h.advance(action.seconds);engine.advance(action.seconds);}
   else if(action.type==='retrieve'){h.retrieve(action.correct);action.correct?engine.retrieve():engine.skip();}
   else {h.click('pause');engine.setPaused(action.type==='pause');}
   compare(snapshot(h),expected());
   assert.ok(!/NaN|undefined/.test(h.elements.get('trace').attrs.d));
 });
});
test('local scripts load in order; controls, tuning and default settings still work',()=>{
 assert.ok(files.html.indexOf('src="physics.js?')<files.html.indexOf('src="app.js?'));
 const h=host();assert.equal(h.run('words.filter(w=>w.unlocked).length'),1);
 h.settings('topFallingSpeed',1,'MOTION');assert.equal(h.run('session.getState().config.motion.topFallingSpeed'),1);
 h.settings('kickHeightPercent',30,'MOTION');assert.equal(h.run('session.getState().config.motion.kickHeightPercent'),30);
 assert.equal(h.run("tuningInputs.find(v=>v.key==='bottomToTopMultiplier').input.value"),'5');
 h.settings('bottomToTopMultiplier',2,'MOTION');assert.equal(h.run('session.getState().config.motion.bottomToTopMultiplier'),2);
 assert.equal(h.run("tuningInputs.some(v=>v.key==='jumpEase')"),false);
 assert.equal('responseRate' in h.run('session.getState().config.bounds'),false);
 assert.ok(files.html.includes('PROGRESS HISTORY'));
 assert.equal(h.run("tuningInputs.some(v=>v.key==='initialCount')"),false);
 h.click('tuning-defaults');h.click('reset');
 assert.equal(h.run('words.filter(w=>w.unlocked).length'),1);
 assert.equal(h.run('session.getState().config.motion.topFallingSpeed'),1);
 assert.equal(h.run('session.getState().config.motion.kickHeightPercent'),25);
 assert.equal(h.run("tuningInputs.some(v=>v.key==='baseKick'||v.key==='baseFallingSpeed'||v.key==='kickStrengthPercent')"),false);
});
test('word lifts keep fixed 15/second settling and reduced-motion support',()=>{
 const h=host();h.retrieve();
 assert.ok(h.run('words[0].depth')>0);assert.equal(h.run('words[0].shown'),0);
 h.advance(.1);
 compare(h.run('words[0].shown'),h.run('words[0].depth')*(1-Math.exp(-15*.1)));
 const reduced=host({instantPosition:true});reduced.retrieve();
 compare(reduced.run('words[0].shown'),reduced.run('words[0].depth'));
 reduced.advance(.1);
 compare(reduced.run('words[0].shown'),reduced.run('words[0].depth'));
});
test('progress keeps every raw history sample, live endpoint and percentages',()=>{
 const h=host();h.advance(.1);h.retrieve();h.advance(.15);
 assert.ok(h.run('progressValue')>0);
 const lifted=h.run('progressValue');h.advance(20);assert.ok(h.run('progressValue')<lifted);
 h.click('reset');for(let i=0;i<2400;i++)h.advance(.25);
 assert.equal(h.run('activeTime'),600);assert.equal(h.run('observationTimes[0]'),0);
 assert.ok(h.run('observations.length')>=2401);
 const original=h.run('JSON.stringify([observations,observationTimes])');
 const points=JSON.parse(h.run('JSON.stringify(plottedHistory())'));
 const recorded=JSON.parse(h.run('JSON.stringify(observations.map((value,i)=>[observationTimes[i],value]))'));
 assert.deepEqual(points.slice(0,-1),recorded);
 assert.deepEqual(points.at(-1),[600,h.run('progressValue')]);
 assert.equal(h.elements.get('trace').attrs.d.split(' ').length,points.length-1);
 assert.equal(h.run('JSON.stringify([observations,observationTimes])'),original);
 assert.equal(h.elements.get('trace-percentage').textContent,h.run("progressValue.toFixed(1)+'%'"));
 assert.ok(h.run('nodes[0].streak.textContent.endsWith("%")'));
 h.click('pause');const saved=h.run('JSON.stringify(session.getState())');h.advance(50);h.retrieve();
 assert.equal(h.run('JSON.stringify(session.getState())'),saved);
});
test('raw history renders straight segments at recorded times, including simultaneous jumps',()=>{
 const h=host();h.advance(10);
 h.run("observations=[0,70,20,80,30];observationTimes=[0,1,1,4,9];historyPath='';historyLength=0;render(0)");
 const value=h.run('progressValue');
 const samples=[[0,0],[1,70],[1,20],[4,80],[9,30],[10,value]];
 assert.deepEqual(JSON.parse(h.run('JSON.stringify(plottedHistory())')),samples);
 const expected=samples.slice(0,-1).map(([time,progress],i)=>
   (i?'L':'M')+time+','+(498-progress/100*470).toFixed(2)).join(' ');
 assert.equal(h.elements.get('trace').attrs.d,expected);
 assert.equal(h.elements.get('trace-live').attrs.d,`M9,357.00 L10,${(498-value/100*470).toFixed(2)}`);
 for(const id of ['trace','trace-live']){
   assert.equal(h.elements.get(id).attrs.transform,'translate(20 0) scale(116 1)');
   assert.equal(h.elements.get(id).attrs['vector-effect'],'non-scaling-stroke');
 }
 assert.equal(h.run("tuningInputs.some(v=>['rawSeconds','settleSeconds','maxWindowSeconds','maxBlend'].includes(v.key))"),false);
 h.click('reset');
 assert.deepEqual(JSON.parse(h.run('JSON.stringify(plottedHistory())')),[[0,0],[0,0]]);
});
test('completion ghosting, modal stats, review and replay remain functional',()=>{
 const h=host();for(let i=0;i<300 && !h.run('sessionComplete');i++){h.advance(.1);h.retrieve();}
 h.advance(1);assert.ok(h.run('sessionComplete && paused'));
 assert.ok(h.run('nodes.every(n=>n.aboveFinish)'));
 assert.equal(h.elements.get('trace-percentage').textContent,'100.0%');
 assert.ok(h.elements.get('completion-screen').open);
 assert.equal(h.elements.get('completion-count').textContent,String(h.run('count')));
 assert.equal(h.elements.get('completion-word-count').textContent,'10');
 h.click('completion-review');assert.ok(!h.elements.get('completion-screen').open);
 const saved=h.run('JSON.stringify(session.getState())');h.advance(100);h.retrieve(false);
 assert.equal(h.run('JSON.stringify(session.getState())'),saved);
 h.click('completion-again');assert.ok(h.run('!paused && !sessionComplete'));
 assert.equal(h.run('observations.length'),1);assert.equal(h.run('progressValue'),0);
});

test('normalized positions render at the unchanged SVG coordinates and Tune uses percentages',()=>{
 const h=host();
 assert.equal(h.run('words[0].depth'),0);
 assert.equal(Number(h.run('nodes[0].edge.attrs.y1')),502);
 compare(Number(h.elements.get('unlock-line').attrs.y1),281);
 compare(Number(h.elements.get('completion-line').attrs.y1),104.2);
 compare(h.run('screenY(100)'),60);
 h.advance(2);h.retrieve();h.advance(.2);
 compare(h.run('nodes[0].edge.attrs.y1'),h.run('502-words[0].shown*442/100'));
 assert.ok(h.elements.get('feedback').textContent.includes('pp'));
 h.settings('threshold',50,'UNLOCK');compare(Number(h.elements.get('unlock-line').attrs.y1),281);
 h.settings('threshold',96,'FINISH');compare(Number(h.elements.get('completion-line').attrs.y1),77.68);
 h.settings('threshold',99,'UNLOCK');assert.equal(h.run('UNLOCK.threshold'),50);
 h.click('tuning-defaults');
 compare(Number(h.elements.get('unlock-line').attrs.y1),281);
 compare(Number(h.elements.get('completion-line').attrs.y1),104.2);
});

test('hint display, Escape skip, successful counters, and removal of mistakes',()=>{
 const h=host();h.settings('kickHeightPercent',1,'MOTION'); // isolate prompt timing from unlocking
 h.advance(1.9);assert.equal(h.elements.get('target-hint').hidden,true);
 h.advance(.1);assert.equal(h.elements.get('target-hint').hidden,false);
 assert.ok(h.elements.get('target-hint').textContent.includes('río'));
 h.retrieve();compare(h.run('lastMeasurement.multiplier'),reward(2));
 assert.equal(h.elements.get('target-hint').hidden,true);
 const count=h.run('count'),depth=h.run('words[0].depth');
 h.key('Backspace');assert.equal(h.run('count'),count);assert.equal(h.run('words[0].depth'),depth);
 h.key('Escape');assert.equal(h.run('count'),count);assert.equal(h.run('session.getState().skipCount'),1);
 assert.equal(h.run('words[0].depth'),depth);assert.equal(h.elements.get('target-hint').hidden,true);
 assert.ok(h.elements.get('feedback').textContent.includes('skipped / no kick'));
 assert.ok(h.elements.get('prompt').textContent.includes('ESC = SKIP'));
 h.advance(1.9);h.click('pause');h.advance(10);assert.equal(h.elements.get('target-hint').hidden,true);
 h.click('pause');h.advance(.1);assert.equal(h.elements.get('target-hint').hidden,false);
 h.click('reset');assert.equal(h.run('session.getState().skipCount'),0);assert.equal(h.elements.get('target-hint').hidden,true);
});


test('prototype applies engine retrieval-time multipliers and reports the unaided bonus',()=>{
 const h=host();h.settings('kickHeightPercent',1,'MOTION');
 for(const [seconds,multiplier] of [0,.5,1,1.5,2,3,4,10].map(t=>[t,reward(t)])){
  h.click('reset');h.advance(seconds);h.retrieve();
  compare(h.run('lastMeasurement.multiplier'),multiplier);
  compare(h.run('lastMeasurement.kickTime'),h.run('MunduPhysics.baselineKickTime(session.getState().config)')*multiplier);
  compare(h.run('MunduPhysics.timeCoordinate(words[0].depth,session.getState().config)'),h.run('lastMeasurement.kickTime'));
  assert.ok(h.elements.get('feedback').textContent.includes(multiplier.toFixed(2)+'× kick'));
 }
});


test('word percentages use field height, matching Tune and the fade threshold',()=>{
 const h=host();h.settings('threshold',95,'FINISH');
 for(const [depth,shown,label,faded] of [[90.25,90.25,'90%',false],[94.05,94.05,'94%',false],[95,95,'95%',false],[95.01,95.01,'95%',true],[100,94,'94%',false]]){
  h.run(`{const saved=testState(session);saved.words[0].depth=${depth};saved.words[0].shown=${shown};syncSession();render(0);}`);
  assert.equal(h.run('nodes[0].streak.textContent'),label);
  assert.equal(h.run('nodes[0].aboveFinish'),faded);
 }
 h.click('reset');assert.equal(h.run('nodes[0].streak.textContent'),'0%');
});

test('Tune exposes reference kick height and keeps it unchanged on speed changes',()=>{
 const h=host();assert.equal(h.run("tuningInputs.some(v=>v.key==='kickCompensationSeconds')"),false);
 assert.equal(h.run("tuningInputs.find(v=>v.key==='kickHeightPercent').input.value"),'25');
 h.settings('kickHeightPercent',90,'MOTION');
 h.settings('kickHeightPercent',100.1,'MOTION');assert.equal(h.run('session.getState().config.motion.kickHeightPercent'),90);
 const initial=h.run('MunduPhysics.baselineKickTime(session.getState().config)');
 h.settings('topFallingSpeed',2,'MOTION');
 assert.equal(h.run('session.getState().config.motion.kickHeightPercent'),90);
 compare(h.run('MunduPhysics.baselineKickTime(session.getState().config)'),initial/2);
 h.settings('bottomToTopMultiplier',3,'MOTION');
 assert.equal(h.run('session.getState().config.motion.kickHeightPercent'),90);
 compare(h.run('MunduPhysics.baselineKickTime(session.getState().config)'),h.run('MunduPhysics.timeCoordinate(90,session.getState().config)'));
 h.click('tuning-defaults');h.click('reset');
 assert.equal(h.run('session.getState().config.motion.kickHeightPercent'),25);
});


test('kick graph follows the shared timer and actual hint state, continuously through the hint',()=>{
 const h=host();assert.equal(h.elements.get('kick-graph').hidden,false);
 compare(Number(h.elements.get('kick-indicator').attrs.cx),32);compare(Number(h.elements.get('kick-indicator').attrs.cy),12);
 h.advance(1);compare(Number(h.elements.get('kick-indicator').attrs.cx),80);compare(Number(h.elements.get('kick-indicator').attrs.cy),64-26*reward(1));
 assert.equal(h.elements.get('kick-graph-value').textContent,'1.0s / 0.83×');
 h.advance(.999);assert.equal(h.run('session.getState().hintVisible'),false);
 compare(Number(h.elements.get('kick-indicator').attrs.cy),64-26*reward(1.999));
 h.advance(.001);assert.equal(h.run('session.getState().hintVisible'),true);
 compare(Number(h.elements.get('kick-indicator').attrs.cx),128);compare(Number(h.elements.get('kick-indicator').attrs.cy),64-26*reward(h.run('session.getState().time-session.getState().selectedAt')));
 assert.equal(h.elements.has('kick-reward-drop'),false);
 compare(Number(h.elements.get('kick-hint-point').attrs.cy),64-26*reward(2));
 h.advance(58);assert.equal(h.elements.get('kick-graph-value').textContent,'60.0s / 0.50×');
 compare(Number(h.elements.get('kick-indicator').attrs.cx),224);compare(Number(h.elements.get('kick-indicator').attrs.cy),64-26*reward(h.run('session.getState().time-session.getState().selectedAt')));
 assert.equal(h.elements.get('kick-axis-end').textContent,'60.0s');
 assert.ok(!/NaN|undefined/.test(h.elements.get('kick-reward-curve').attrs.d));
});

test('kick graph freezes on Pause and resumes the hint timer without counting paused duration',()=>{
 const h=host();h.advance(1.1);h.click('pause');
 const before=JSON.stringify(h.elements.get('kick-indicator').attrs),readout=h.elements.get('kick-graph-value').textContent;
 h.advance(20);assert.equal(JSON.stringify(h.elements.get('kick-indicator').attrs),before);assert.equal(h.elements.get('kick-graph-value').textContent,readout);
 assert.equal(h.elements.get('kick-graph').hidden,false);
 h.click('pause');h.advance(.9);assert.equal(h.elements.get('kick-graph-value').textContent,'2.0s / 0.57×');
});

test('ended prompt graph hides on retrieval/skip, resets for the next prompt, and hides on completion',()=>{
 const h=host();h.settings('kickHeightPercent',1,'MOTION');h.advance(1);h.retrieve();
 assert.equal(h.elements.get('kick-graph').hidden,true);assert.equal(h.elements.get('kick-graph-value').textContent,'0.0s / 2.00×');
 compare(Number(h.elements.get('kick-indicator').attrs.cx),32);
 h.advance(.01);assert.equal(h.elements.get('kick-graph').hidden,false);
 h.key('Escape');assert.equal(h.elements.get('kick-graph').hidden,true);compare(Number(h.elements.get('kick-indicator').attrs.cx),32);
 h.advance(.01);assert.equal(h.elements.get('kick-graph').hidden,false);
 h.click('reset');assert.equal(h.elements.get('kick-graph').hidden,false);assert.equal(h.elements.get('kick-graph-value').textContent,'0.0s / 2.00×');
 const completed=host();for(let i=0;i<300&&!completed.run('sessionComplete');i++){completed.advance(.1);completed.retrieve();}
 assert.equal(completed.run('sessionComplete'),true);assert.equal(completed.elements.get('kick-graph').hidden,true);
 assert.equal(completed.elements.get('kick-graph').attrs['aria-hidden'],'true');
});

test('Tune effective gravity updates on unlocking, parameter edits and Reset',()=>{
 const h=host();assert.equal(h.elements.get('effective-gravity').textContent,'EFFECTIVE GRAVITY 100.00%');
 assert.equal(h.run("tuningInputs.find(v=>v.key==='gravityReductionPercent').input.value"),'5');
 h.run('{const state=testState(session);state.words[0].depth=51;state.words[0].shown=51;}');
 h.advance(.01);assert.equal(h.run('session.getState().unlockedWordCount'),2);
 assert.equal(h.elements.get('effective-gravity').textContent,'EFFECTIVE GRAVITY 95.00%');
 h.settings('gravityReductionPercent',5,'MOTION');assert.equal(h.elements.get('effective-gravity').textContent,'EFFECTIVE GRAVITY 95.00%');
 h.settings('gravityReductionPercent',0,'MOTION');assert.equal(h.elements.get('effective-gravity').textContent,'EFFECTIVE GRAVITY 100.00%');
 h.settings('gravityReductionPercent',10.1,'MOTION');assert.equal(h.run('session.getState().config.motion.gravityReductionPercent'),0);
 h.click('tuning-defaults');assert.equal(h.elements.get('effective-gravity').textContent,'EFFECTIVE GRAVITY 95.00%');
 h.click('reset');assert.equal(h.elements.get('effective-gravity').textContent,'EFFECTIVE GRAVITY 100.00%');
});


test('every reward-curve vertex and live indicator uses the same exponential function as gameplay',()=>{
 const h=host();h.advance(3);
 const path=h.elements.get('kick-reward-curve').attrs.d;assert.equal((path.match(/M/g)||[]).length,1);
 for(const match of path.matchAll(/[ML]([\d.e+-]+) ([\d.e+-]+)/g)){
  const t=(Number(match[1])-32)*4/192;compare(Number(match[2]),64-26*reward(t));
 }
 compare(Number(h.elements.get('kick-indicator').attrs.cy),64-26*reward(3));
 assert.equal(h.elements.get('kick-hint-time').textContent,'2s');
 assert.equal(h.elements.get('target-hint').hidden,false);assert.ok(!h.elements.get('target-hint').textContent.includes('HALF KICK'));
 h.retrieve();compare(h.run('lastMeasurement.multiplier'),reward(3));
 assert.ok(h.elements.get('feedback').textContent.includes('hinted / '+reward(3).toFixed(2)+'× kick'));
});

for(const size of [1,10,30])test(`Total words ${size}: reset, progress, sequential unlocking and completion`,()=>{
 const h=host();h.settings('totalWords',size,'DATASET');
 assert.equal(h.run('words.length'),10); // Editing does not replace the active session.
 h.click('reset');
 assert.equal(h.run('words.length'),size);assert.equal(h.run('nodes.length'),size);
 assert.equal(h.run('words.filter(w=>w.unlocked).length'),1);
 assert.equal(h.run('session.getState().gravityMultiplier'),1);
 assert.equal(h.run('progressValue'),0);
 h.run('{const state=testState(session);state.words[0].depth=45;state.words[0].shown=45;syncSession();render(0);}');
 compare(h.run('progressValue'),50/size);
 for(let i=1;i<size;i++){
  h.run('testState(session).words.forEach(w=>{if(w.unlocked){w.depth=51;w.shown=51;}});acceptTransition(session.advance(0));render(0);');
  assert.equal(h.run('words.filter(w=>w.unlocked).length'),i+1);
  assert.equal(h.run(`words[${i}].depth`),0);
  compare(h.run('session.getState().gravityMultiplier'),.95**i);
  assert.equal(h.run('sessionComplete'),false);
 }
 h.run('testState(session).words.forEach(w=>{w.depth=90;w.shown=90;});acceptTransition(session.advance(0));render(0);');
 assert.equal(h.run('sessionComplete'),false);
 h.run('testState(session).words.forEach(w=>{w.depth=91;w.shown=91;});acceptTransition(session.advance(0));render(0);');
 assert.equal(h.run('sessionComplete && paused'),true);
 assert.equal(h.run('progressValue'),100);
 assert.equal(h.elements.get('completion-word-count').textContent,String(size));
 h.click('reset');assert.equal(h.run('nodes.length'),size);
 assert.equal(h.elements.get('bars').children.length,size*2);
 assert.equal(h.run('words.filter(w=>w.unlocked).length'),1);
});
test('Total words rejects invalid values and restores the ten-word default',()=>{
 const h=host();
 for(const value of [0,31,1.5,'']){h.settings('totalWords',value,'DATASET');assert.equal(h.run('DATASET.totalWords'),10);}
 h.settings('totalWords',30,'DATASET');h.click('reset');assert.equal(h.run('words.length'),30);
 h.click('tuning-defaults');assert.equal(h.run('words.length'),30);
 h.click('reset');assert.equal(h.run('words.length'),10);
 assert.equal(h.run('words.filter(w=>w.unlocked).length'),1);
});

for(const size of [10,20,30])test(`vertical word labels stay centered and follow bars for ${size} words`,()=>{
 const h=host();h.settings('totalWords',size,'DATASET');h.click('reset');
 for(const height of [0,50,100]){
  h.run(`testState(session).words.forEach(w=>{w.depth=${height};w.shown=${height};});syncSession();render(0);`);
  const labels=JSON.parse(h.run('JSON.stringify(nodes.map(n=>({label:n.label.attrs,percentage:n.streak.attrs,index:n.index.attrs})))'));
  labels.forEach((n,i)=>{
   const x=20+(i+.5)*1160/size,y=502-height*442/100;
   assert.equal(n.label.transform,`translate(${x},${y-8}) rotate(-90)`);
   assert.equal(n.label['text-anchor'],'start');
   assert.equal(n.label['dominant-baseline'],'central');
   assert.equal(n.label['font-size'],14);assert.equal(n.percentage.transform,undefined);
   assert.equal(Number(n.percentage.y),y+16);assert.equal(n.index.y,540);
  });
 }
 assert.ok(files.html.includes('viewBox="0 0 1270 560"'));
});

function defaultsStorage(initial=null){
 const data=new Map(initial===null?[]:[['mundu.tuningDefaults',initial]]);
 return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
}
test('saved numeric tuning defaults reload without persisting unsaved edits or session state',()=>{
 const storage=defaultsStorage(),h=host({storage});
 for(const [key,value,group] of [['totalWords',30,'DATASET'],['threshold',40,'UNLOCK'],['topFallingSpeed',2,'MOTION'],['bottomToTopMultiplier',3,'MOTION'],['kickHeightPercent',35,'MOTION'],['gravityReductionPercent',2,'MOTION'],['threshold',95,'FINISH']])h.settings(key,value,group);
 assert.equal(h.run('words.length'),10);
 assert.equal(storage.getItem('mundu.tuningDefaults'),null);
 h.click('tuning-save');const saved=storage.getItem('mundu.tuningDefaults');
 assert.equal(Object.values(JSON.parse(saved)).flatMap(Object.values).length,7);
 h.settings('totalWords',20,'DATASET');h.settings('kickHeightPercent',50,'MOTION');
 assert.equal(storage.getItem('mundu.tuningDefaults'),saved);
 const reopened=host({storage});assert.equal(reopened.run('words.length'),30);
 assert.equal(reopened.run('words.filter(w=>w.unlocked).length'),1);
 assert.equal(reopened.run('count'),0);assert.equal(reopened.run('activeTime'),0);
 assert.deepEqual(JSON.parse(reopened.run('JSON.stringify(MOTION)')),{topFallingSpeed:2,kickHeightPercent:35,bottomToTopMultiplier:3,gravityReductionPercent:2});
 assert.equal(reopened.run('UNLOCK.threshold'),40);assert.equal(reopened.run('FINISH.threshold'),95);
 assert.equal(reopened.run("tuningInputs.find(v=>v.key==='totalWords').input.value"),'30');
 reopened.click('tuning-defaults');assert.equal(storage.getItem('mundu.tuningDefaults'),null);
 assert.equal(reopened.run('DATASET.totalWords'),10);assert.equal(reopened.run('words.length'),30);
 assert.equal(reopened.run('MOTION.kickHeightPercent'),25);
 assert.equal(reopened.run('UNLOCK.threshold'),50);assert.equal(reopened.run('FINISH.threshold'),90);
 reopened.click('reset');assert.equal(reopened.run('words.length'),10);
 assert.equal(host({storage}).run('MOTION.kickHeightPercent'),25);
});
test('invalid, partial and outdated saved defaults fall back atomically to factory values',()=>{
 const storage=defaultsStorage(),h=host({storage});h.click('tuning-save');
 const valid=JSON.parse(storage.getItem('mundu.tuningDefaults'));
 const invalid=['bad JSON','null','[]','{}'];
 for(const [group,key,value] of [['VOCABULARY SET','totalWords',0],['VOCABULARY SET','totalWords',31],['VOCABULARY SET','totalWords',1.5],['SHARED LINEAR PHYSICS','topFallingSpeed',16],['SHARED LINEAR PHYSICS','bottomToTopMultiplier',0],['SHARED LINEAR PHYSICS','kickHeightPercent','25'],['SHARED LINEAR PHYSICS','gravityReductionPercent',11],['PROGRESSIVE WORDS','threshold',96],['COMPLETION LINE','threshold',50]]){
  const saved=JSON.parse(JSON.stringify(valid));saved[group][key]=value;invalid.push(JSON.stringify(saved));
 }
 const outdated=JSON.parse(JSON.stringify(valid));delete outdated['VOCABULARY SET'];invalid.push(JSON.stringify(outdated));
 for(const saved of invalid){
  const reopened=host({storage:defaultsStorage(saved)});
  assert.equal(reopened.run('words.length'),10);assert.equal(reopened.run('MOTION.kickHeightPercent'),25);
  assert.equal(reopened.run('UNLOCK.threshold'),50);assert.equal(reopened.run('FINISH.threshold'),90);
 }
});
test('unavailable storage never breaks startup, saving, restoration or gameplay',()=>{
 const storage={getItem(){throw Error('denied');},setItem(){throw Error('quota');},removeItem(){throw Error('denied');}};
 const h=host({storage});assert.equal(h.run('words.length'),10);
 h.settings('kickHeightPercent',35,'MOTION');h.click('tuning-save');
 assert.equal(h.elements.get('tuning-save').textContent,'SAVE UNAVAILABLE');
 h.click('tuning-defaults');assert.equal(h.run('MOTION.kickHeightPercent'),25);
 h.retrieve();h.advance(.1);assert.equal(h.run('count'),1);assert.ok(h.run('words[0].shown')>0);
 const missing=host({storage:null});missing.click('tuning-save');missing.click('tuning-defaults');missing.retrieve();
 assert.equal(missing.run('count'),1);
});

test('animation scheduling stops on pause and resumes once without counting paused time',()=>{
 const h=host();assert.equal(h.pendingFrames(),1);
 h.tick(.1);assert.equal(h.pendingFrames(),1);h.retrieve();
 h.click('pause');assert.equal(h.pendingFrames(),0);
 const saved=h.run('JSON.stringify(session.getState())');
 h.tick(60);assert.equal(h.run('JSON.stringify(session.getState())'),saved);
 h.click('pause');assert.equal(h.pendingFrames(),1);
 h.tick(.1);compare(h.run('activeTime'),.2);assert.equal(h.pendingFrames(),1);
 h.click('reset');h.click('reset');assert.equal(h.pendingFrames(),1);
 h.tick(.1);compare(h.run('activeTime'),.1);
});

test('hidden tabs stop all frames and exclude hidden time on return, including reset and pause',()=>{
 const h=host();h.tick(.1);h.retrieve();
 h.visibility(true);assert.equal(h.pendingFrames(),0);
 const saved=h.run('JSON.stringify(session.getState())');
 h.tick(120);assert.equal(h.run('JSON.stringify(session.getState())'),saved);
 h.visibility(false);h.visibility(false);assert.equal(h.pendingFrames(),1);
 h.tick(.1);compare(h.run('activeTime'),.2);
 h.click('pause');h.visibility(true);h.tick(120);h.visibility(false);
 assert.equal(h.pendingFrames(),0);h.click('pause');assert.equal(h.pendingFrames(),1);
 h.visibility(true);h.click('reset');assert.equal(h.pendingFrames(),0);
 h.tick(120);compare(h.run('activeTime'),0);
 h.visibility(false);h.tick(.1);compare(h.run('activeTime'),.1);
});

test('completion cancels frames; reset and completion recheck can restart the scheduler',()=>{
 const h=host();h.settings('totalWords',1,'DATASET');h.click('reset');
 h.run('testState(session).words[0].depth=100;testState(session).words[0].shown=100;');
 h.tick(.001);assert.ok(h.run('sessionComplete'));assert.equal(h.pendingFrames(),0);
 const saved=h.run('JSON.stringify(session.getState())');h.tick(60);
 assert.equal(h.run('JSON.stringify(session.getState())'),saved);
 h.click('completion-review');assert.equal(h.pendingFrames(),0);
 // Raising the finish line after a marginal completion can reopen a session.
 h.run('testState(session).words[0].depth=91;testState(session).words[0].shown=91;');
 h.settings('threshold',99,'FINISH');assert.equal(h.run('sessionComplete'),false);
 assert.equal(h.pendingFrames(),0);h.click('pause');
 assert.equal(h.pendingFrames(),1);h.tick(.1);
 h.click('reset');assert.equal(h.pendingFrames(),1);compare(h.run('activeTime'),0);
});

test('unchanged rendering writes no attributes and reuses the synchronized engine snapshot',()=>{
 const h=host();
 h.run(`globalThis.attributeWrites=[];
 const original=Object.getPrototypeOf(nodes[0].bar).setAttribute;
 Object.getPrototypeOf(nodes[0].bar).setAttribute=function(k,v){attributeWrites.push([this,k]);return original.call(this,k,v);};
 globalThis.snapshots=0;const getState=session.getState;
 session.getState=()=>{snapshots++;return getState();};
 render(0);`);
 assert.equal(h.run('attributeWrites.length'),0);
 h.tick(.01);assert.equal(h.run('snapshots'),1);
 assert.equal(h.run("attributeWrites.filter(([node,key])=>key==='d' && node===el('trace')).length"),0);
 assert.equal(h.run("attributeWrites.filter(([node,key])=>key==='d' && node===el('kick-reward-curve')).length"),0);
 h.tick(.25);
 assert.equal(h.run("attributeWrites.filter(([node,key])=>key==='d' && node===el('trace')).length"),1);
});

test('irregular scheduled frames and input retain exact engine timing and displayed settling',()=>{
 const h=host(),engine=Physics.createSession({vocabulary:JSON.parse(h.run('JSON.stringify(VOCABULARY.slice(0,10))'))});
 for(let i=0;i<180;i++){
   const dt=[1/120,1/60,.027,.08][i%4];h.tick(dt);engine.advance(dt);
   if(i%7===0){h.retrieve();engine.retrieve();}
   if(i%19===0){h.retrieve(false);engine.skip();}
   const actual=JSON.parse(h.run('JSON.stringify(session.getState())'));
   compare(actual,engine.getState());
 }
});

test('history stroke retains the original viewBox line weight after resizing',()=>{
 const h=host();
 h.run("el('chart').getScreenCTM=()=>({a:.5});updateTraceStroke();");
 for(const id of ['trace','trace-live'])assert.equal(Number(h.elements.get(id).attrs['stroke-width']),1.15);
 h.run("el('chart').getScreenCTM=()=>({a:1.5});updateTraceStroke();");
 for(const id of ['trace','trace-live'])compare(Number(h.elements.get(id).attrs['stroke-width']),3.45);
});
