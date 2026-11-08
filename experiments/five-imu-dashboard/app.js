// Graph grid, time mapping, scaling and pause behavior adapted from bmi323-gravity/app.js.
const axisColors = ['#ff727f', '#65d5ab', '#75a8ff'];
const fingerColors = ['#ff727f', '#65d5ab', '#75a8ff', '#e6b75f', '#cb93e9'];
// Anatomical display order; binary sensor ID is mux channel minus three.
const fingers = [
  {name:'Thumb', channel:6}, {name:'Index', channel:7},
  {name:'Middle', channel:5}, {name:'Ring', channel:4}, {name:'Pinky', channel:3},
];
const names = fingers.map(finger=>finger.name);
const sensorToFinger = new Map(fingers.map((finger,index)=>[finger.channel-3,index]));
const axes = ['X', 'Y', 'Z'];
const samples = Array.from({length: 5}, () => []);
let estimators = Array.from({length: 5}, () => new GravityEstimator());
const individual = document.getElementById('individual');
const combined = document.getElementById('combined');
const gravity = document.getElementById('gravity');
const gate = document.getElementById('gate');
const windowSelect = document.getElementById('window');
const pauseButton = document.getElementById('pause');
let paused = false, frozen = null, frozenEnd = 0, clockOffsetUs = null;
let lastTimestamp = null, lastArrivalMs = 0, state = null, needsDraw = true;
let lastGeneration = null, reconnectReset = false;

function legend(labels, colors) {
  return '<div class="legend">' + labels.map((label,i) =>
    `<span><i style="background:${colors[i]}"></i>${label}</span>`).join('') + '</div>';
}
function card(title, unit, labels, colors, id) {
  return `<section class="card"><div class="chart-head"><div><h2>${title}</h2><span>${unit}</span></div>${legend(labels,colors)}</div><canvas id="${id}" aria-label="${title} graph"></canvas><div class="values" id="${id}-values">Waiting for samples</div></section>`;
}
names.forEach((name,i) => {
  const section=document.createElement('section');
  section.className='finger-section';
  section.innerHTML=`<h2 class="finger-title">${name}<small>Finger ${i+1} · mux channel ${fingers[i].channel}</small></h2>`+
    card('Acceleration','g',axes,axisColors,`acc-${i}`)+
    card('Angular velocity','degrees / second',axes,axisColors,`gyro-${i}`);
  individual.append(section);
});
for(const [key,title,unit] of [['acc','Accelerometers','g'],['gyro','Gyroscopes','degrees / second']]){
  const group=document.createElement('section');group.className='combined-group';
  group.innerHTML=`<h2 class="finger-title">${title}</h2>`+names.map((name,i)=>
    card(`${name} — ${key==='acc'?'Accel':'Gyro'} XYZ`,unit,axes,axisColors,`combined-${key}-${i}`)).join('');
  combined.append(group);
}
names.forEach((name,i)=>{
  const section=document.createElement('section');section.className='finger-section';
  section.innerHTML=`<h2 class="finger-title">${name}<small>Finger ${i+1} · mux channel ${fingers[i].channel}</small></h2>`+
    card('Estimated gravity','g',axes,axisColors,`gravity-${i}`);
  gravity.append(section);
});
gate.innerHTML=`<section class="card gate-card"><div class="chart-head"><div><h2>Gravity gate</h2><span>0 closed · 1 open</span></div><div class="legend gate-legend">${names.map((name,i)=>`<span><i style="background:${fingerColors[i]}"></i>${name} <b id="gate-${i}-values">—</b></span>`).join('')}</div></div><canvas id="gate-chart" aria-label="Gravity gate graph for all five fingers"></canvas></section>`;
function makeChart(id) {
  const canvas=document.getElementById(id);
  return {canvas,ctx:canvas.getContext('2d'),grid:document.createElement('canvas'),
          width:0,height:0,dpr:0,gridKey:'',visible:true,sizeDirty:true};
}
const individualCharts=names.map((_,i)=>[makeChart(`acc-${i}`),makeChart(`gyro-${i}`)]);
const combinedCharts=names.map((_,i)=>[makeChart(`combined-acc-${i}`),makeChart(`combined-gyro-${i}`)]);
const gravityCharts=names.map((_,i)=>makeChart(`gravity-${i}`));
const gateChart=makeChart('gate-chart');
const allCharts=[...individualCharts.flat(),...combinedCharts.flat(),...gravityCharts,gateChart];
const chartByCanvas=new Map(allCharts.map(chart=>[chart.canvas,chart]));
if(typeof IntersectionObserver!=='undefined'){
  const observer=new IntersectionObserver(entries=>{
    for(const entry of entries){const chart=chartByCanvas.get(entry.target);chart.visible=entry.isIntersecting;if(chart.visible){chart.sizeDirty=true;needsDraw=true}}
  });
  allCharts.forEach(chart=>observer.observe(chart.canvas));
}
if(typeof ResizeObserver!=='undefined'){
  const observer=new ResizeObserver(entries=>{for(const entry of entries){chartByCanvas.get(entry.target).sizeDirty=true}needsDraw=true});
  allCharts.forEach(chart=>observer.observe(chart.canvas));
}else window.addEventListener('resize',()=>{allCharts.forEach(chart=>chart.sizeDirty=true);needsDraw=true});

function displayEnd(nowMs){return clockOffsetUs===null?0:nowMs*1000+clockOffsetUs}
pauseButton.addEventListener('click',()=>{
  paused=!paused;
  if(paused){frozenEnd=displayEnd(performance.now());frozen=samples.map(s=>s.slice())}
  else frozen=null;
  pauseButton.textContent=paused?'Resume':'Pause';needsDraw=true;
});
windowSelect.addEventListener('change',()=>{needsDraw=true});
function setView(view) {
  individual.hidden=view!=='individual';combined.hidden=view!=='combined';gravity.hidden=view!=='gravity';gate.hidden=view!=='gate';
  for(const name of ['individual','combined','gravity','gate'])document.getElementById(`${name}-tab`).setAttribute('aria-pressed',String(name===view));
  needsDraw=true;
}
document.getElementById('individual-tab').onclick=()=>setView('individual');
document.getElementById('combined-tab').onclick=()=>setView('combined');
document.getElementById('gravity-tab').onclick=()=>setView('gravity');
document.getElementById('gate-tab').onclick=()=>setView('gate');
document.getElementById('start').onclick=()=>fetch('/start',{method:'POST'});
document.getElementById('stop').onclick=()=>fetch('/stop',{method:'POST'});

const events=new EventSource('/events');
events.onmessage=e=>{
  const message=JSON.parse(e.data);
  const generation=message.status.generation;
  if((generation!=null && lastGeneration!==null && generation!==lastGeneration) || (reconnectReset && message.status.state==='connected')){
    samples.forEach(s=>s.length=0);estimators=names.map(()=>new GravityEstimator());
    clockOffsetUs=null;lastTimestamp=null;lastArrivalMs=0;reconnectReset=false;
  }
  if(generation!=null)lastGeneration=generation;
  if(state?.state==='connected' && message.status.state!=='connected')reconnectReset=true;
  state=message.status;
  for(const [us,sensors] of message.samples){
    const now=performance.now();
    if(lastTimestamp!==null && us<lastTimestamp){
      samples.forEach(s=>s.length=0);clockOffsetUs=null;estimators=names.map(()=>new GravityEstimator());
    }
    if(clockOffsetUs===null)clockOffsetUs=us-now*1000;
    lastTimestamp=us;lastArrivalMs=now;
    for(const [id,status,error,offset,...v] of sensors){
      const finger=sensorToFinger.get(id);
      if(finger===undefined)continue;
      const source=samples[finger];
      const timestamp=us+offset;
      const g=error?null:estimators[finger].update(v.slice(0,3),v.slice(3,6),timestamp);
      const value=gravityGate(g);
      source.push({us:timestamp,v:error?null:v,g,gate:value===null?null:[value]});
      if(source.length>6400){
        const cutoff=us-31_000_000;let count=0;
        while(count<source.length && source[count].us<cutoff)count++;
        if(count)source.splice(0,count);
      }
    }
  }
};
events.onerror=()=>{state=null;reconnectReset=true};

// The following chart sizing and grid follow the original single-IMU dashboard.
function sizeChart(chart) {
  const dpr=devicePixelRatio||1;
  if(!chart.sizeDirty&&dpr===chart.dpr)return;
  chart.sizeDirty=false;
  const w=chart.canvas.clientWidth,h=chart.canvas.clientHeight;
  if(w===chart.width&&h===chart.height&&dpr===chart.dpr)return;
  chart.width=w;chart.height=h;chart.dpr=dpr;
  chart.canvas.width=chart.grid.width=Math.max(1,Math.round(w*dpr));
  chart.canvas.height=chart.grid.height=Math.max(1,Math.round(h*dpr));
  chart.ctx.setTransform(dpr,0,0,dpr,0,0);chart.gridKey='';
}
function drawGrid(chart,range,seconds,unipolar=false) {
  const key=`${chart.width}/${chart.height}/${chart.dpr}/${range}/${seconds}/${unipolar}`;
  if(key===chart.gridKey)return;chart.gridKey=key;
  const ctx=chart.grid.getContext('2d');ctx.setTransform(chart.dpr,0,0,chart.dpr,0,0);
  const w=chart.width,h=chart.height,left=48,right=10,top=10,bottom=25;
  const ph=h-top-bottom,pw=w-left-right;
  ctx.clearRect(0,0,w,h);ctx.font='11px ui-sans-serif, system-ui';ctx.lineWidth=1;
  for(let i=-2;i<=2;i++){
    const value=unipolar?(i+2)/4:i*range/2,y=unipolar?top+ph*(1-value):top+ph*(range-value)/(2*range);
    ctx.strokeStyle=value===0?'#536277':'#2a374a';
    ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-right,y);ctx.stroke();
    ctx.fillStyle='#8392a7';ctx.textAlign='right';
    ctx.fillText(Number.isInteger(value)?String(value):value.toFixed(unipolar?2:1),left-8,y+4);
  }
  ctx.textAlign='center';ctx.fillStyle='#8392a7';
  for(let i=0;i<=4;i++){
    const x=left+pw*i/4;
    ctx.fillText(`${(-seconds+seconds*i/4).toFixed(seconds===2?1:0)}s`,x,h-5);
  }
}
function draw(chart,series,endUs,seconds,fixedRange) {
  if(!chart.visible)return;
  sizeChart(chart);if(!chart.width||!chart.height)return;
  const startUs=endUs-seconds*1e6;
  const unipolar=fixedRange==='gate';
  let range=unipolar?1:fixedRange;
  const source=series[0].source;
  function firstVisible(list){let lo=0,hi=list.length;while(lo<hi){const mid=(lo+hi)>>1;if(list[mid].us<startUs)lo=mid+1;else hi=mid}return lo}
  const begin=firstVisible(source);
  if(!range){
    let peak=5;
    for(let i=begin;i<source.length&&source[i].us<=endUs;i++)
      for(const line of series){const values=source[i][line.field||'v'];if(values)peak=Math.max(peak,Math.abs(values[line.axis]))}
    range=Math.max(5,Math.ceil(peak/10)*10);
  }
  drawGrid(chart,range,seconds,unipolar);
  const {ctx,width:w,height:h}=chart,left=48,right=10,top=10,bottom=25;
  const pw=w-left-right,ph=h-top-bottom;
  ctx.clearRect(0,0,w,h);ctx.drawImage(chart.grid,0,0,w,h);
  ctx.save();ctx.beginPath();ctx.rect(left,top,pw,ph);ctx.clip();
  for(const line of series){
    ctx.strokeStyle=line.color;ctx.lineWidth=1.6;ctx.beginPath();let started=false;
    for(let i=firstVisible(line.source);i<line.source.length;i++){
      const sample=line.source[i];if(sample.us>endUs)break;
      const values=sample[line.field||'v'];if(!values){started=false;continue}
      const x=left+pw*(sample.us-startUs)/(seconds*1e6);
      const y=unipolar?top+ph*(1-values[line.axis]):top+ph*(range-values[line.axis])/(2*range);
      if(!started)ctx.moveTo(x,y);else ctx.lineTo(x,y);started=true;
    }
    ctx.stroke();
  }
  ctx.restore();
}
function updateValues(source) {
  names.forEach((_,i)=>{
    const v=source[i].at(-1)?.v;
    for(const [key,offset,unit] of [['acc',0,'g'],['gyro',3,'°/s']]){
      const el=document.getElementById(`${key}-${i}-values`);
      el.textContent=v?axes.map((a,j)=>`${a} ${v[offset+j].toFixed(key==='acc'?3:2)}`).join('   ·   ')+` ${unit}`:'No valid reading';
    }
  });
  names.forEach((_,i)=>{
    const v=source[i].at(-1)?.v;
    for(const [key,offset,unit] of [['acc',0,'g'],['gyro',3,'°/s']]){
      const el=document.getElementById(`combined-${key}-${i}-values`);
      el.textContent=v?axes.map((a,j)=>`${a} ${v[offset+j].toFixed(key==='acc'?3:2)}`).join('   ·   ')+` ${unit}`:'No valid reading';
    }
  });
  names.forEach((_,i)=>{
    const g=source[i].at(-1)?.g;
    document.getElementById(`gravity-${i}-values`).textContent=g?axes.map((a,j)=>`${a} ${g[j].toFixed(3)}`).join('   ·   ')+' g':'No valid estimate';
    const value=source[i].at(-1)?.gate?.[0];
    document.getElementById(`gate-${i}-values`).textContent=value===undefined?'—':value.toFixed(3);
  });
}
let lastFrame=0,lastUI=0;
const perf={frames:0,slow:0,maxFrameMs:0,drawTotalMs:0,drawMaxMs:0,startedMs:performance.now(),intervals:[],intervalIndex:0};
perf.snapshot=()=>{const sorted=perf.intervals.slice().sort((a,b)=>a-b);return {fps:perf.fps,slowFramesOver25ms:perf.slow,maxFrameMs:perf.maxFrameMs,p95FrameMs:sorted.length?sorted[Math.floor((sorted.length-1)*.95)]:null,meanRenderMs:perf.drawMeanMs,maxRenderMs:perf.drawMaxMs}};
window.imuRenderStats=perf;
function render(now) {
  const drawStart=performance.now();
  if(lastFrame){const interval=now-lastFrame;perf.maxFrameMs=Math.max(perf.maxFrameMs,interval);if(interval>25)perf.slow++;perf.intervals[perf.intervalIndex++%300]=interval}
  lastFrame=now;perf.frames++;perf.fps=perf.frames*1000/(now-perf.startedMs);
  if(now-lastUI>=250){
  lastUI=now;
  const age=lastArrivalMs?(now-lastArrivalMs)/1000:Infinity;
  const live=state?.state==='connected'&&age<1.5;
  const status=document.getElementById('status');
  status.textContent=live?'● Connected':state?.state==='waiting'?'○ Waiting for Feather':state?.state==='error'?'○ Serial error':state?.state==='connecting'?'○ Connecting':'○ Disconnected / stale';
  status.title=state?.message||'';
  status.classList.toggle('live',live);
  document.getElementById('rate').textContent=live?`${state.rate.toFixed(1)} sweeps/s`:'— sweeps/s';
  for(const k of ['gaps','crc','errors'])document.getElementById(k).textContent=state?.[k]??'—';
  document.getElementById('age').textContent=isFinite(age)?`${age.toFixed(1)} s`:'—';
  document.getElementById('latest').textContent=lastTimestamp===null?'Waiting for samples':`Device time ${(lastTimestamp/1e6).toFixed(2)} s${paused?' · paused':''}`;
  individual.classList.toggle('stale-graphs',!live&&!paused);combined.classList.toggle('stale-graphs',!live&&!paused);gravity.classList.toggle('stale-graphs',!live&&!paused);gate.classList.toggle('stale-graphs',!live&&!paused);
  }
  if(!paused||needsDraw){
    const source=paused?frozen:samples,end=paused?frozenEnd:displayEnd(now),seconds=Number(windowSelect.value);
    if(!individual.hidden)names.forEach((_,i)=>{
      draw(individualCharts[i][0],axes.map((a,j)=>({source:source[i],axis:j,color:axisColors[j]})),end,seconds,2);
      draw(individualCharts[i][1],axes.map((a,j)=>({source:source[i],axis:j+3,color:axisColors[j]})),end,seconds,null);
    });
    else if(!combined.hidden)names.forEach((_,i)=>{
      draw(combinedCharts[i][0],axes.map((a,j)=>({source:source[i],axis:j,color:axisColors[j]})),end,seconds,2);
      draw(combinedCharts[i][1],axes.map((a,j)=>({source:source[i],axis:j+3,color:axisColors[j]})),end,seconds,null);
    });
    else if(!gravity.hidden)names.forEach((_,i)=>draw(gravityCharts[i],axes.map((a,j)=>({source:source[i],axis:j,color:axisColors[j],field:'g'})),end,seconds,2));
    else draw(gateChart,names.map((_,i)=>({source:source[i],axis:0,color:fingerColors[i],field:'gate'})),end,seconds,'gate');
    if(now-lastValues>=200){updateValues(source);lastValues=now}needsDraw=false;
  }
  const cost=performance.now()-drawStart;perf.drawTotalMs+=cost;perf.drawMaxMs=Math.max(perf.drawMaxMs,cost);perf.drawMeanMs=perf.drawTotalMs/perf.frames;
  requestAnimationFrame(render);
}
let lastValues=0;
requestAnimationFrame(render);
