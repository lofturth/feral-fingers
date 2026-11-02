'use strict';

// SVG coordinates are rendering only; engine positions are percentages.
const TUNE = { top:24, bottom:502, reachableTop:60, left:20, right:1180,
  traceMargin:4 };
// Gravity uses percentage points per second, independent of retrieval streak.
const MOTION = { ...MunduPhysics.DEFAULTS.motion };
// A selected word starts a new response clock; active session time excludes pause.
// Store and render every raw observation.
const PROGRESS = { sampleSeconds:0.25 };
const TRACE_LABEL = { gap:12 };
const FINISH = { ...MunduPhysics.DEFAULTS.finish };
// NEW WORDS must remain strictly below completion and above the starting floor.
const DATASET = { totalWords:10 };
const UNLOCK = { ...MunduPhysics.DEFAULTS.unlock };
let sessionComplete=false, completionPresented=false;
let session, sessionState, selectedIndex=0, pendingUnlock=false;
let wordFlashes=[];
let kickGraphEnded=false;
let gravityReadout;
const COLOR = { grid:'#202738', muted:'#657087', pink:'#ED4CA8' };
const VOCABULARY = [ ['river','río'], ['light','luz'], ['apple','manzana'],
  ['night','noche'], ['house','casa'], ['water','agua'], ['bread','pan'],
  ['bird','pájaro'], ['dream','sueño'], ['window','ventana'],
  ['sun','sol'], ['moon','luna'], ['star','estrella'], ['sky','cielo'],
  ['sea','mar'], ['mountain','montaña'], ['tree','árbol'], ['flower','flor'],
  ['road','camino'], ['city','ciudad'], ['book','libro'], ['table','mesa'],
  ['chair','silla'], ['door','puerta'], ['fire','fuego'], ['earth','tierra'],
  ['hand','mano'], ['eye','ojo'], ['heart','corazón'], ['time','tiempo'] ];
const NS = 'http://www.w3.org/2000/svg';
const el = id => document.getElementById(id);
const screenY = position => TUNE.bottom-position/100*(TUNE.bottom-TUNE.reachableTop);
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
let words, observations, progressValue, count, paused=false;
let lastTime=null, lastMeasurement=null;
let activeTime=0, nextSampleTime=PROGRESS.sampleSeconds;
let observationTimes=[];
const nodes=[];
let animationFrame=null;
let historyPath='', historyLength=0;
// Attribute writes can invalidate SVG paint even when the value is unchanged.
const renderedAttributes=new WeakMap();
function setAttribute(node,key,value) {
  let values=renderedAttributes.get(node);
  if (!values) { values=new Map(); renderedAttributes.set(node,values); }
  const text=String(value);
  if (values.get(key)!==text) { node.setAttribute(key,text); values.set(key,text); }
}
function setText(node,value) {
  const text=String(value);
  if (node.textContent!==text) node.textContent=text;
}
function toggleClass(node,key,value) {
  if (node.classList.contains(key)!==value) node.classList.toggle(key,value);
}
function scheduleFrame() {
  if (animationFrame===null && !paused && !sessionComplete && !document.hidden)
    animationFrame=requestAnimationFrame(frame);
}
function stopFrames() {
  if (animationFrame!==null) cancelAnimationFrame(animationFrame);
  animationFrame=null;
}

function svgNode(type, attributes, parent) {
  const node=document.createElementNS(NS,type);
  for (const [key,value] of Object.entries(attributes)) node.setAttribute(key,value);
  parent.appendChild(node); return node;
}

// Adapter: wall-clock input, rendering effects and raw history stay here.
// The engine owns every gameplay position, threshold decision and response timer.
function physicsConfig() {
  return {motion:{...MOTION},unlock:{...UNLOCK},finish:{...FINISH},
    instantPosition:motionPreference.matches};
}
function syncSession() {
  const state=sessionState=session.getState();
  words=state.words.map((word,i)=>({...word,flash:wordFlashes[i] || 0}));
  activeTime=state.time; paused=state.paused; sessionComplete=state.complete;
  count=state.retrievalCount; selectedIndex=state.selectedIndex;
}
function acceptTransition(result) {
  if (result && result.unlockedIndex!==null && result.unlockedIndex!==undefined) pendingUnlock=true;
  syncSession();
}
function reset() {
  if (el('completion-screen').open) el('completion-screen').close();
  session=MunduPhysics.createSession({vocabulary:VOCABULARY.slice(0,DATASET.totalWords),config:physicsConfig()});
  wordFlashes=Array.from({length:DATASET.totalWords},()=>0); pendingUnlock=false; completionPresented=false;
  kickGraphEnded=false;
  observations=[0]; observationTimes=[0]; nextSampleTime=PROGRESS.sampleSeconds;
  historyPath=''; historyLength=0;
  progressValue=0; lastMeasurement=null;
  syncSession();
  buildSvg();
  lastTime=performance.now(); updateStatus(); render(0); updateReadouts(); scheduleFrame();
}

// Retrieval changes only word state; progress observes the resulting movement.
function retrieve(skipped=false) {
  if (paused || sessionComplete) return;
  advanceTo(performance.now());
  if (paused || sessionComplete) return;
  recordObservation();
  const result=skipped?session.skip():session.retrieve();
  if (!result) return;
  if (!skipped) wordFlashes[result.index]=1;
  lastMeasurement=result;
  kickGraphEnded=true; // Retire the old graph; the next animation frame shows the fresh prompt.
  acceptTransition(result);
  progressValue=overallProgress(); recordObservation();
  updateReadouts(); render(0); checkCompletion();
}

function recordObservation() {
  observations.push(progressValue);
  observationTimes.push(activeTime);
}

function overallProgress() { return session.getProgress(); }

function advanceProgress() {
  progressValue=overallProgress();
  // Sample actual observed positions, never invent intermediate states after
  // a slow frame. The live endpoint is updated on every frame independently.
  if (activeTime>=nextSampleTime) {
    recordObservation(); nextSampleTime=activeTime+PROGRESS.sampleSeconds;
  }
}

// Completion is a state check, independent of progress rendering.
function checkCompletion() {
  if (!sessionComplete || completionPresented) return;
  completionPresented=true;
  progressValue=overallProgress(); recordObservation();
  paused=true; stopFrames(); updateStatus();
  const seconds=Math.floor(activeTime);
  el('completion-time').textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
  el('completion-count').textContent=String(count);
  el('completion-word-count').textContent=String(words.length);
  setTuningOpen(false);
  el('completion-screen').showModal();
}

function plottedHistory() {
  const points=observations.map((value,i)=>[observationTimes[i],value]);
  // Include the actual current progress between recorded samples.
  points.push([activeTime,progressValue]);
  return points;
}

function updateTraceStroke() {
  // non-scaling-stroke cancels the chart's viewBox scale too. Restore that
  // scale on resize so line weight stays identical to the original chart.
  const scale=el('chart').getScreenCTM?.()?.a || 1;
  for (const id of ['trace','trace-live']) setAttribute(el(id),'stroke-width',2.3*scale);
}
function buildSvg() {
  updateTraceStroke();
  for (const id of ['grid','bars','labels']) el(id).replaceChildren();
  nodes.length=0;
  svgNode('line',{id:'unlock-line',x1:TUNE.left,y1:screenY(UNLOCK.threshold),x2:TUNE.right,y2:screenY(UNLOCK.threshold),
    stroke:'#8b7aa8','stroke-width':1,'stroke-dasharray':'3 8',opacity:0.65},el('labels'));
  const unlockLabel=svgNode('text',{id:'unlock-label',x:TUNE.left+3,y:screenY(UNLOCK.threshold)-7,
    fill:'#8b7aa8','font-size':8},el('labels'));
  unlockLabel.textContent='NEW WORDS';
  svgNode('line',{id:'completion-line',x1:TUNE.left,y1:screenY(FINISH.threshold),x2:TUNE.right,y2:screenY(FINISH.threshold),
    stroke:COLOR.muted,'stroke-width':1,'stroke-dasharray':'5 7',opacity:0.65},el('labels'));
  const thresholdLabel=svgNode('text',{id:'completion-label',x:TUNE.left+3,y:screenY(FINISH.threshold)-7,fill:COLOR.muted,'font-size':8},el('labels'));
  thresholdLabel.textContent='COMPLETION';
  for (let i=0;i<=4;i++) {
    const y=TUNE.top+i*(TUNE.bottom-TUNE.top)/4;
    svgNode('line',{x1:TUNE.left,y1:y,x2:TUNE.right,y2:y,stroke:COLOR.grid,'stroke-width':1},el('grid'));
    const text=svgNode('text',{x:1190,y:y+3,fill:COLOR.muted,'font-size':8,'text-anchor':'end'},el('grid'));
    text.textContent=100-i*25;
  }
  const slot=(TUNE.right-TUNE.left)/words.length;
  words.forEach((word,i) => {
    const x=TUNE.left+i*slot+5, width=slot-10;
    const guide=svgNode('line',{x1:x+width/2,y1:TUNE.top,x2:x+width/2,y2:TUNE.bottom,stroke:COLOR.grid,'stroke-width':0.6,'stroke-dasharray':'2 8'},el('grid'));
    const bar=svgNode('rect',{x,y:TUNE.top,width,height:0,fill:'url(#bar-fill)'},el('bars'));
    const edge=svgNode('line',{x1:x,y1:0,x2:x+width,y2:0,stroke:COLOR.pink,'stroke-width':1.3},el('bars'));
    const label=svgNode('text',{x:0,y:0,fill:'#e3e8ef','font-size':14,'text-anchor':'start','dominant-baseline':'central'},el('labels'));
    label.textContent=word.english;
    const streak=svgNode('text',{x:x+width/2,y:0,fill:COLOR.muted,'font-size':8,'text-anchor':'middle'},el('labels'));
    const index=svgNode('text',{x:x+width/2,y:540,fill:COLOR.muted,'font-size':8,'text-anchor':'middle'},el('grid'));
    index.textContent=String(i+1).padStart(2,'0');
    nodes.push({bar,edge,label,streak,guide,index});
  });
}

// Use the same conservative position as completion: both the simulation and
// the animated bar must be clear of the line. Touching it is active again.
function wordAboveFinish(word) {
  return MunduPhysics.isAboveFinish(word,FINISH.threshold);
}

function renderKickGraph(state,dt) {
  if(dt>0)kickGraphEnded=false;
  const graph=el('kick-graph');
  const hidden=state.complete || state.selectedIndex<0 || kickGraphEnded;
  if (graph.hidden!==hidden) graph.hidden=hidden;
  setAttribute(graph,'aria-hidden',String(graph.hidden));
  if(state.complete || state.selectedIndex<0)return;
  const elapsed=Math.max(0,state.time-state.selectedAt);
  const hintSeconds=MunduPhysics.RETRIEVAL.hintSeconds;
  const windowSeconds=Math.max(4,elapsed);
  const x=t=>32+192*t/windowSeconds;
  const y=m=>64-52*m/MunduPhysics.kickMultiplier(0);
  const multiplier=MunduPhysics.kickMultiplier(elapsed);
  const hintX=x(hintSeconds);
  const curve=el('kick-reward-curve');
  if (curve.windowSeconds!==windowSeconds) {
    curve.windowSeconds=windowSeconds;
    const denseEnd=Math.min(windowSeconds,8);
    const curvePoints=Array.from({length:97},(_,i)=>{
      const t=denseEnd*i/96;
      return `${i===0?'M':'L'}${x(t)} ${y(MunduPhysics.kickMultiplier(t))}`;
    });
    if(windowSeconds>denseEnd)curvePoints.push(`L224 ${y(MunduPhysics.kickMultiplier(windowSeconds))}`);
    setAttribute(curve,'d',curvePoints.join(' '));
  }
  setAttribute(el('kick-hint-guide'),'x1',hintX);setAttribute(el('kick-hint-guide'),'x2',hintX);
  setAttribute(el('kick-hint-point'),'cx',hintX);setAttribute(el('kick-hint-point'),'cy',y(MunduPhysics.kickMultiplier(hintSeconds)));
  setAttribute(el('kick-indicator'),'cx',x(elapsed));setAttribute(el('kick-indicator'),'cy',y(multiplier));
  setAttribute(el('kick-one-second'),'x',x(1));setAttribute(el('kick-hint-time'),'x',hintX);
  setAttribute(el('kick-one-second'),'visibility',x(hintSeconds)-x(1)>=18?'visible':'hidden');
  setAttribute(el('kick-hint-time'),'visibility',hintX-x(0)>=24?'visible':'hidden');
  setText(el('kick-hint-time'),hintSeconds+'s');setText(el('kick-axis-end'),windowSeconds.toFixed(1)+'s');
  setText(el('kick-graph-value'),elapsed.toFixed(1)+'s / '+multiplier.toFixed(2)+'×');
  setAttribute(el('kick-graph-svg'),'aria-label',`Possible kick: ${multiplier.toFixed(2)} times at ${elapsed.toFixed(1)} seconds; hint at ${hintSeconds} seconds`);
}

function render(dt) {
  const unlocked=pendingUnlock; pendingUnlock=false;
  words.forEach((word,i) => {
    const node=nodes[i];
    const {bar,edge,label,streak,guide,index}=node, y=screenY(word.shown);
    for (const element of [bar,edge,label,streak,guide,index]) {
      setAttribute(element,'visibility',word.unlocked?'visible':'hidden');
    }
    const above=wordAboveFinish(word);
    if (node.aboveFinish===true && !above) node.reactivation=0.28;
    else node.reactivation=Math.max(0,(node.reactivation || 0)-dt);
    node.aboveFinish=above;
    for (const element of [bar,edge,label,streak]) {
      toggleClass(element,'word-faded',above);
      toggleClass(element,'word-reactivated',!above && node.reactivation>0);
    }
    setAttribute(bar,'height',y-TUNE.top);
    setAttribute(edge,'y1',y); setAttribute(edge,'y2',y);
    setAttribute(edge,'stroke-width',1.3+word.flash*1.5);
    setAttribute(label,'transform',`translate(${TUNE.left+(i+0.5)*(TUNE.right-TUNE.left)/words.length},${y-8}) rotate(-90)`);
    setAttribute(label,'fill',word.flash>0.2 || node.reactivation>0?COLOR.pink:'#e3e8ef');
    setAttribute(streak,'y',y+16); setText(streak,Math.round(Math.min(word.depth,word.shown))+'%');
    setAttribute(streak,'font-size',15);
    setAttribute(streak,'font-weight',700);
    setAttribute(streak,'fill',COLOR.pink);
    setAttribute(streak,'stroke','#0A0D19');
    setAttribute(streak,'stroke-width',4);
    setAttribute(streak,'paint-order','stroke');
  });
  progressValue=overallProgress();
  if (unlocked) recordObservation();
  setText(el('score'),progressValue.toFixed(1));
  // Keep sample times in seconds. SVG scales the existing path instead of JS
  // allocating/reformatting the entire history on every display frame.
  const traceY=value=>TUNE.bottom-TUNE.traceMargin-value/100*(TUNE.bottom-TUNE.top-2*TUNE.traceMargin);
  while (historyLength<observations.length) {
    const i=historyLength++;
    historyPath+=(i?' L':'M')+observationTimes[i]+','+traceY(observations[i]).toFixed(2);
  }
  setAttribute(el('trace'),'d',historyPath);
  const transform=`translate(${TUNE.left} 0) scale(${activeTime>0?(TUNE.right-TUNE.left)/activeTime:1} 1)`;
  for (const id of ['trace','trace-live']) {
    setAttribute(el(id),'transform',transform);
    setAttribute(el(id),'vector-effect','non-scaling-stroke');
  }
  const last=observations.length-1, headY=traceY(progressValue);
  setAttribute(el('trace-live'),'d',`M${observationTimes[last]},${traceY(observations[last]).toFixed(2)} L${activeTime},${headY.toFixed(2)}`);
  setAttribute(el('trace-percentage'),'x',TUNE.right+TRACE_LABEL.gap);
  setAttribute(el('trace-percentage'),'y',headY);
  setText(el('trace-percentage'),progressValue.toFixed(1)+'%');
  const target=words[selectedIndex]; setText(el('target-word'),target.english);
  setText(el('target-streak'),'STREAK '+String(target.streak).padStart(2,'0'));
  const promptState=sessionState;
  renderKickGraph(promptState,dt);
  if(gravityReadout)setText(gravityReadout,'EFFECTIVE GRAVITY '+(100*promptState.gravityMultiplier).toFixed(2)+'%');
  const hinted=promptState.hintVisible;
  if (el('target-hint').hidden===hinted) el('target-hint').hidden=!hinted;
  setText(el('target-hint'),hinted?'HINT → '+target.spanish:'');
  checkCompletion();
}

function updateReadouts() {
  el('count').textContent=String(count).padStart(3,'0');
  el('score').textContent=progressValue.toFixed(1);
  el('feedback').textContent=lastMeasurement ? `${lastMeasurement.word} → ${lastMeasurement.translation} / ${lastMeasurement.kind==='retrieval'?(lastMeasurement.hintVisible?'hinted':'unhinted')+' / '+lastMeasurement.multiplier.toFixed(2)+'× kick'+' / ↑'+lastMeasurement.lift.toFixed(1)+' pp':'skipped / no kick'}` : `${words.length} words. One key. Keep them afloat.`;
}

function updateStatus() {
  el('status').textContent=sessionComplete?'COMPLETE':paused?'PAUSED':'LIVE';
  el('pause').disabled=sessionComplete;
  el('status').parentElement.classList.toggle('paused',paused);
  el('pause').innerHTML=paused?'RESUME <span>▶</span>':'PAUSE <span>Ⅱ</span>';
  el('pause').setAttribute('aria-pressed',String(paused));
  el('prompt').textContent=sessionComplete?'ALL WORDS CLEAR / RESET TO RESTART':paused?'SESSION PAUSED / RESUME TO RETRIEVE':'LETTER = RETRIEVE / ESC = SKIP';
}

// Physical letter keys accept all layouts; modifier shortcuts retain browser behavior.
document.addEventListener('keydown',event => {
  if (event.ctrlKey||event.metaKey||event.altKey||event.isComposing) return;
  if (event.key==='Escape') {
    event.preventDefault();
    retrieve(true);return;
  }
  if (event.target?.matches('input, select, textarea')) return;
  if (/^Key[A-Z]$/.test(event.code) || /^\p{L}$/u.test(event.key)) {
    event.preventDefault(); retrieve();
  }
});
el('pause').addEventListener('click',() => {
  if (sessionComplete) return;
  if (!paused) { advanceTo(performance.now()); render(0); }
  session.setPaused(!paused); syncSession(); lastTime=performance.now(); updateStatus();
  if (paused) stopFrames(); else scheduleFrame();
});
el('reset').addEventListener('click',reset);
motionPreference.addEventListener?.('change',() => {
  acceptTransition(session.configure({instantPosition:motionPreference.matches}));
  render(0); scheduleFrame();
});
document.addEventListener('visibilitychange',() => {
  // Hidden time was already excluded; explicitly suspend work as well.
  lastTime=performance.now();
  if (document.hidden) stopFrames(); else scheduleFrame();
});
function advanceTo(time) {
  const nextTime=lastTime===null?time:Math.max(time,lastTime);
  const dt=lastTime===null?0:(nextTime-lastTime)/1000; lastTime=nextTime;
  if (!paused && !sessionComplete && !document.hidden) {
    wordFlashes=wordFlashes.map(flash=>Math.max(0,flash-dt*2.8));
    acceptTransition(session.advance(dt));
    advanceProgress(); render(dt);
  }
}
function frame(time) {
  animationFrame=null;
  advanceTo(time);
  scheduleFrame();
}
// Live tuning stays separate from session state; saving is explicit.
const SETTINGS = [
  {name:'VOCABULARY SET',values:DATASET,fields:[
    ['totalWords','Total words','Applied on the next session Reset',1,VOCABULARY.length,1]]},
  {name:'PROGRESSIVE WORDS',values:UNLOCK,fields:[
    ['threshold','NEW WORDS position (%)','0% = bottom; must stay below completion',100/442,44000/442,0.1]]},
  {name:'SHARED LINEAR PHYSICS',values:MOTION,fields:[
    ['topFallingSpeed','Top falling speed','At top; percentage points / second',0.01,15,0.01],
    ['bottomToTopMultiplier','Bottom-to-top multiplier','Bottom ÷ top for falling and kicks; 3 = three times',1,1000,0.1],
    ['kickHeightPercent','Kick height (%)','A 1× kick from the bottom reaches this height',1,100,0.1],
    ['gravityReductionPercent','Gravity reduction / new word (%)','Each additional unlocked word reduces current gravity',0,10,0.1]]},
  {name:'COMPLETION LINE',values:FINISH,fields:[
    ['threshold','Completion position (%)','Higher percentage = higher / harder to reach',25200/442,44100/442,0.1]]}
];
const DEFAULTS_STORAGE_KEY='mundu.tuningDefaults';
const factoryDefaults=SETTINGS.map(group=>({...group.values}));
function validTuningValue(value,min,max,step) {
  return Number.isFinite(value) && value>=min && value<=max && (step!==1 || Number.isInteger(value));
}
function loadTuningDefaults() {
  try {
    const saved=JSON.parse(localStorage.getItem(DEFAULTS_STORAGE_KEY));
    if(!saved || typeof saved!=='object' || Array.isArray(saved))return;
    for(const group of SETTINGS)for(const [key,,,min,max,step] of group.fields){
      if(!validTuningValue(saved[group.name]?.[key],min,max,step))return;
    }
    if(saved['PROGRESSIVE WORDS'].threshold>=saved['COMPLETION LINE'].threshold)return;
    for(const group of SETTINGS)for(const [key] of group.fields)group.values[key]=saved[group.name][key];
  } catch { /* Missing or inaccessible storage leaves factory values intact. */ }
}
const tuningInputs=[];
function refreshTuning(recheckCompletion=false) {
  el('unlock-line').setAttribute('y1',screenY(UNLOCK.threshold));
  el('unlock-line').setAttribute('y2',screenY(UNLOCK.threshold));
  el('unlock-label').setAttribute('y',screenY(UNLOCK.threshold)-7);
  el('completion-line').setAttribute('y1',screenY(FINISH.threshold));
  el('completion-line').setAttribute('y2',screenY(FINISH.threshold));
  el('completion-label').setAttribute('y',screenY(FINISH.threshold)-7);
  if (recheckCompletion) completionPresented=false;
  acceptTransition(session.configure(physicsConfig(),{recheckCompletion}));
  updateStatus(); render(0); scheduleFrame();
}
function setTuningOpen(open) {
  el('tuning-panel').hidden=!open;
  el('tune').setAttribute('aria-expanded',String(open));
}
function buildTuning() {
  for (const [groupIndex,group] of SETTINGS.entries()) {
    const fieldset=document.createElement('fieldset');
    const legend=document.createElement('legend'); legend.textContent=group.name;
    fieldset.appendChild(legend);
    for (const [key,title,description,min,max,step] of group.fields) {
      const row=document.createElement('label'); row.className='tuning-row';
      const caption=document.createElement('span');
      const name=document.createElement('span'); name.textContent=title;
      const note=document.createElement('small'); note.textContent=description;
      caption.appendChild(name); caption.appendChild(note);
      if(key==='gravityReductionPercent'){
        gravityReadout=document.createElement('small');gravityReadout.setAttribute('id','effective-gravity');
        gravityReadout.textContent='EFFECTIVE GRAVITY '+(100*session.getState().gravityMultiplier).toFixed(2)+'%';
        caption.appendChild(gravityReadout);
      }
      const input=document.createElement('input');
      input.type='number'; input.min=min; input.max=max; input.step=step;
      input.value=Number(group.values[key].toFixed(6)); input.title=key;
      const original=factoryDefaults[groupIndex][key];
      const commit=() => {
        const value=Number(input.value);
        if (input.value.trim()==='' || !validTuningValue(value,min,max,step)) return false;
        if (key==='threshold' && ((group.values===UNLOCK && value>=FINISH.threshold) || (group.values===FINISH && value<=UNLOCK.threshold))) return false;
        if (!paused) advanceTo(performance.now());
        group.values[key]=value;
        if(group.values!==DATASET)refreshTuning(group.values===FINISH);
        return true;
      };
      input.addEventListener('input',commit);
      input.addEventListener('change',() => { if (!commit()) input.value=Number(group.values[key].toFixed(6)); });
      row.appendChild(caption); row.appendChild(input); fieldset.appendChild(row);
      tuningInputs.push({input,values:group.values,key,original});
    }
    el('tuning-fields').appendChild(fieldset);
  }
  el('tune').addEventListener('click',() => setTuningOpen(el('tuning-panel').hidden));
  el('tuning-close').addEventListener('click',() => { setTuningOpen(false); el('tune').focus(); });
  el('tuning-save').addEventListener('click',() => {
    const saved=Object.fromEntries(SETTINGS.map(group=>[group.name,
      Object.fromEntries(group.fields.map(([key])=>[key,group.values[key]]))]));
    try {
      localStorage.setItem(DEFAULTS_STORAGE_KEY,JSON.stringify(saved));
      el('tuning-save').textContent='DEFAULTS SAVED ✓';
    } catch { el('tuning-save').textContent='SAVE UNAVAILABLE'; }
  });
  el('tuning-defaults').addEventListener('click',() => {
    for (const {input,values,key,original} of tuningInputs) { values[key]=original; input.value=Number(values[key].toFixed(6)); }
    try {
      localStorage.removeItem(DEFAULTS_STORAGE_KEY);
      el('tuning-save').textContent='SAVE AS DEFAULTS';
    } catch { el('tuning-save').textContent='STORAGE UNAVAILABLE'; }
    refreshTuning(true);
  });
}
function buildCompletionScreen() {
  el('completion-again').addEventListener('click',reset);
  el('completion-review').addEventListener('click',() => {
    el('completion-screen').close(); el('reset').focus();
  });
}
loadTuningDefaults(); reset(); buildTuning(); buildCompletionScreen(); scheduleFrame();
if (typeof ResizeObserver!=='undefined') new ResizeObserver(updateTraceStroke).observe(el('chart'));
