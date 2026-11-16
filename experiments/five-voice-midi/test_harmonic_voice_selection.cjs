const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(__dirname + '/harmonic-explorer.html','utf8');
const keyName='feral-fingers.harmonic-explorer.workspace.v1';
function page(storage, unavailable=false){
 const elements={}, radios=['normal','reverse','custom'].map(value=>Object.assign(new Element('INPUT'),{value})),handlers={},timers=new Map(),sent=[];let timerId=0;
 function Element(tag='DIV'){this.tagName=tag;this.attrs={};this.children=[];this.value='0';const classes=new Set();this.classList={toggle(name,force){if(force===undefined)force=!classes.has(name);if(force)classes.add(name);else classes.delete(name)},remove(name){classes.delete(name)},contains(name){return classes.has(name)}}}
 Element.prototype.setAttribute=function(k,v){this.attrs[k]=v};
 Element.prototype.getAttribute=function(k){return this.attrs[k]};
 Element.prototype.append=function(...children){for(const c of children){c.parent=this;this.children.push(c)}};
 Element.prototype.replaceChildren=function(){this.children=[]};
 Element.prototype.addEventListener=function(k,fn){this[k]=fn};
 Element.prototype.remove=function(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this)};
 Element.prototype.getBoundingClientRect=function(){return {top:300,height:100}};
 Element.prototype.scrollIntoView=function(){};
 Element.prototype.focus=function(){document.activeElement=this};
 Element.prototype.closest=function(selector){return this.tagName==='BUTTON'&&selector.startsWith('button,')?this:null};
 const document={activeElement:new Element('BODY'),getElementById(id){if(!elements[id]){elements[id]=new Element();if(id==='shortcuts-panel')elements[id].hidden=true}return elements[id]},createElement(tag){return new Element(tag.toUpperCase())},createElementNS(ns,tag){return new Element(tag)},querySelectorAll(){return radios},addEventListener(k,fn){handlers[k]=fn}};
 const status={voice_channel_mapping_supported:true,output_available:true,sensor_fresh:[true,true,true,true,true],gates:[0,0,0,0,0],live_melody:false,assigned_notes:null,chord_source:null};
 const context={document,window:{innerHeight:800,scrollY:0,scrollTo(){},addEventListener(k,fn){handlers[k]=fn}},performance:{now(){return 0}},localStorage:{getItem(k){if(unavailable)throw Error('unavailable');return storage[k]??null},setItem(k,v){if(unavailable)throw Error('unavailable');storage[k]=v}},fetch:async(path,opts)=>{if(opts?.method==='POST')sent.push({path,data:JSON.parse(opts.body)});return {ok:true,json:async()=>opts?.method==='POST'?{ok:true}:status}},setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id},clearTimeout(id){timers.delete(id)},requestAnimationFrame(){return 1},cancelAnimationFrame(){}};
 vm.createContext(context);vm.runInContext(html.split('<script>')[1].split('</script>')[0],context);
 const run=code=>vm.runInContext(code,context);
 const key=(value,target=document.activeElement,extra={})=>{let prevented=false;handlers.keydown({key:value,target,...extra,preventDefault(){prevented=true}});return prevented};
 return {document,handlers,sent,run,key,status,timers};
}
(async()=>{
 const storage={},p=page(storage);await new Promise(r=>setImmediate(r));
 const plain=()=>({preventDefault(){},stopPropagation(){}}),up=()=>p.handlers.keyup({key:' ',preventDefault(){}}),hold=q=>{assert.equal(q.key(' '),true);const id=q.run('spaceHoldTimer');assert.equal(q.timers.get(id).ms,200);q.timers.get(id).fn()};
 const initialJourney=JSON.stringify(p.run('chords.map(copyChord)'));const beforeMidi=p.sent.length;
 for(const map of [[0,1,2,3,4],[4,3,2,1,0],[2,4,0,3,1]]){
  p.run(`mapping=${JSON.stringify(map)};mappingMode=mapMode;draw()` .replace('mapMode',JSON.stringify(map.join(',')==='0,1,2,3,4'?'normal':map.join(',')==='4,3,2,1,0'?'reverse':'custom')));
  for(let mask=0;mask<32;mask++){
   const expected=Array.from({length:5},(_,i)=>!!(mask&(1<<i)));
   p.status.gates=expected.map(x=>x?.8:.1);p.status.sensor_fresh=[true,true,true,true,true];await p.run('refresh()');
   hold(p);assert.equal(p.run('selectionMode'),true);assert.deepEqual(Array.from(p.run('liveSelection')),expected);
   for(let i=0;i<5;i++){p.run(`var finger=${i}`);assert.equal(p.run('chords[0].selectionIndicators[finger].item.attrs["aria-checked"]'),String(expected[i]));assert.equal(p.run('mapping.indexOf(finger)'),map.indexOf(i))}
   up();assert.equal(p.run('selectionMode'),false);assert.deepEqual(Array.from(p.run('latchedSelection')),expected);
  }
 }
 assert.equal(p.sent.length,beforeMidi);assert.equal(JSON.stringify(p.run('chords.map(copyChord)')),initialJourney);
 const saved=JSON.parse(storage[keyName]);assert.deepEqual(saved.voiceSelection,[true,true,true,true,true]);const restored=page(storage);assert.deepEqual(Array.from(restored.run('latchedSelection')),[true,true,true,true,true]);
 // Controls follow each colored voice through crossings, mappings and shared pitches.
 const layout=page({});await new Promise(r=>setImmediate(r));
 for(const map of [[0,1,2,3,4],[4,3,2,1,0],[2,4,0,3,1]])for(const pitches of [[36,48,60,72,84],[72,48,84,36,60],[60,60,60,60,60],[61,61,61,61,61],[60,61,62,63,64]]){
  layout.run(`mapping=${JSON.stringify(map)};chords[0].pitches=${JSON.stringify(pitches)};draw()`);
  const entries=layout.run('chords[0].selectionIndicators');
  for(let finger=0;finger<5;finger++){layout.run(`var testedFinger=${finger}`);const pos=layout.run('selectionLayout(chords[0])[testedFinger]'),center=layout.run('voiceX(chords[0],testedFinger)'),meter=layout.run('chords[0].meters[testedFinger].base.attrs');
   assert.equal(pos.x,center);assert(Math.abs(pos.x-(meter.x+meter.width/2))<1e-9);assert.equal(entries[finger].item.attrs.transform,`translate(${pos.x} ${pos.y})`);assert.equal(entries[finger].item.attrs['aria-label'],`${['Thumb','Index','Middle','Ring','Pinky'][finger]} voice selection`);assert.equal(entries[finger].circle.attrs.stroke,layout.run(`voices[${finger}].color`));assert.equal(entries[finger].item.children[0].attrs.width,16);
  }
  const positions=JSON.parse(layout.run('JSON.stringify(selectionLayout(chords[0]))'));for(let i=0;i<5;i++)for(let j=i+1;j<5;j++){const a=positions[i],b=positions[j];if(Math.abs(a.x-b.x)<16){assert(Math.abs(a.y-b.y)>=(a.hitHeight+b.hitHeight)/2);assert(Math.hypot(a.x-b.x,a.y-b.y)>=a.radius+a.outline/2+b.radius+b.outline/2)}}
 }
 layout.run('mapping=[0,1,2,3,4];chords[0].pitches=[60,60,60,60,60];draw()');for(let i=0;i<5;i++){const control=layout.run(`chords[0].selectionIndicators[${i}].item`);control.click(plain());assert.equal(layout.run(`latchedSelection[${i}]`),true);control.keydown({key:' ',...plain()});assert.equal(layout.run(`latchedSelection[${i}]`),false)}
 // Coordinates are in the same responsive SVG viewBox as the piano.
 assert(html.includes('.canvas svg{display:block;width:100%;'));assert.equal(layout.run('chords[0].selectionGroup.parent'),layout.run('chords[0].content'));
 // Pointer use of controls restores app shortcuts, without taking focus from keyboard users or fields.
 const focusPage=page({});await new Promise(r=>setImmediate(r));const button=focusPage.document.createElement('button');button.focus();focusPage.handlers.click({detail:1,target:button});assert.equal(focusPage.document.activeElement,focusPage.run('chords[0].node'));hold(focusPage);assert.equal(focusPage.run('selectionMode'),true);focusPage.handlers.keyup({key:' ',preventDefault(){}});assert.equal(focusPage.run('selectionMode'),false);
 const beforeEdit=focusPage.run('chords[0].pitches[0]');focusPage.run("pitchMode='chromatic';selectedVoice=mapping[0]");assert.equal(focusPage.key('ArrowRight'),true);assert.equal(focusPage.run('chords[0].pitches[0]'),beforeEdit+1);assert.equal(focusPage.key('z',focusPage.document.activeElement,{metaKey:true}),true);assert.equal(focusPage.run('chords[0].pitches[0]'),beforeEdit);
 const checkbox=focusPage.run('chords[0].selectionIndicators[0].item');checkbox.focus();checkbox.click({detail:1,...plain()});assert.equal(focusPage.document.activeElement,focusPage.run('chords[0].node'));hold(focusPage);focusPage.handlers.blur();assert.equal(focusPage.run('selectionMode'),false);
 button.focus();focusPage.handlers.click({detail:0,target:button});assert.equal(focusPage.document.activeElement,button);const field=focusPage.document.createElement('input');field.focus();focusPage.handlers.click({detail:1,target:field});assert.equal(focusPage.document.activeElement,field);assert.equal(focusPage.key(' ',field),false);
 const help=focusPage.document.getElementById('shortcuts-button'),panel=focusPage.document.getElementById('shortcuts-panel');help.tagName='BUTTON';help.click();focusPage.handlers.click({detail:1,target:help});assert.equal(panel.hidden,false);assert.equal(focusPage.document.activeElement,focusPage.run('chords[0].node'));assert.equal(focusPage.key(' '),true);focusPage.handlers.keyup({key:' ',preventDefault(){}});assert.equal(focusPage.key('ArrowRight'),true);assert.equal(focusPage.key('Escape'),true);assert.equal(panel.hidden,true);assert.equal(focusPage.document.activeElement,focusPage.run('chords[0].node'));
 const summary={tagName:'SUMMARY'};focusPage.handlers.click({detail:1,target:summary});assert.equal(focusPage.document.activeElement,focusPage.run('chords[0].node'));const galleryButton={tagName:'g',closest(selector){return selector.startsWith('button,')?this:null}};focusPage.handlers.click({detail:1,target:galleryButton});assert.equal(focusPage.document.activeElement,focusPage.run('chords[0].node'));
 // Quick taps clear without a live preview; rapid taps stay empty and do not send MIDI.
 const tapsStore={},taps=page(tapsStore);await new Promise(r=>setImmediate(r));taps.run("var simulatedNow=1000;Date.now=()=>simulatedNow;updateSelectionFromStatus({sensor_fresh:[true,true,true,true,true],gates:[.8,0,.8,0,0]});toggleVoiceSelection(1);toggleVoiceSelection(4)");
 const tapPitches=JSON.stringify(taps.run('chords[0].pitches')),tapSends=taps.sent.length;assert.equal(taps.key(' '),true);const pending=taps.run('spaceHoldTimer');assert.equal(taps.timers.get(pending).ms,200);assert.deepEqual(Array.from(taps.run('latchedSelection')),[false,true,false,false,true]);assert.equal(taps.run('selectionMode'),false);assert.equal(taps.run('chords[0].node.classList.contains("selecting")'),false);assert.equal(taps.run('chords[0].selectionStatus.textContent'),'Selected voices');
 assert.equal(taps.key(' ',{tagName:'BODY'},{repeat:true}),true);assert.equal(taps.run('spaceHoldTimer'),pending);taps.run('simulatedNow+=100');taps.handlers.keyup({key:' ',preventDefault(){}});assert.deepEqual(Array.from(taps.run('latchedSelection')),[false,false,false,false,false]);assert.equal(taps.run('selectionMode'),false);assert.equal(taps.timers.has(pending),false);
 for(let i=0;i<4;i++){assert.equal(taps.key(' '),true);taps.run('simulatedNow+=50');taps.handlers.keyup({key:' ',preventDefault(){}});assert.deepEqual(Array.from(taps.run('latchedSelection')),[false,false,false,false,false])}assert.equal(taps.sent.length,tapSends);assert.equal(JSON.stringify(taps.run('chords[0].pitches')),tapPitches);
 // A release at the threshold still latches even if the timer callback was delayed.
 taps.key(' ');taps.run('simulatedNow+=200');taps.handlers.keyup({key:' ',preventDefault(){}});assert.deepEqual(Array.from(taps.run('latchedSelection')),[true,false,true,false,false]);
 taps.key(' ');taps.handlers.blur();taps.run('simulatedNow+=300');taps.handlers.keyup({key:' ',preventDefault(){}});assert.deepEqual(Array.from(taps.run('latchedSelection')),[true,false,true,false,false]);assert.equal(taps.run('spacePressed'),false);
 taps.key(' ');taps.run('simulatedNow+=50');const fieldDuringTap=taps.document.createElement('input');fieldDuringTap.focus();taps.handlers.keyup({key:' ',target:fieldDuringTap,preventDefault(){}});assert.deepEqual(Array.from(taps.run('latchedSelection')),[false,false,false,false,false]);
 // The existing .30 threshold is applied independently to each physical finger.
 p.status.gates=[.2999,.3,.3001,0,1];await p.run('refresh()');hold(p);assert.equal(p.run('chords[0].node.classList.contains("selecting")'),true);assert.equal(p.run('chords[0].selectionStatus.textContent'),'SELECTING VOICES');assert.deepEqual(Array.from(p.run('liveSelection')),[false,true,true,false,true]);p.handlers.blur();assert.equal(p.run('chords[0].node.classList.contains("selecting")'),false);assert.equal(p.run('chords[0].selectionStatus.textContent'),'Selected voices');
 // Live updates and individual stale sensors must never overwrite the latched selection.
 p.status.gates=[.8,.1,.1,.1,.1];await p.run('refresh()');hold(p);assert.deepEqual(Array.from(p.run('liveSelection')),[true,false,false,false,false]);
 p.status.gates=[.1,.8,.1,.8,.1];await p.run('refresh()');assert.deepEqual(Array.from(p.run('liveSelection')),[false,true,false,true,false]);assert.deepEqual(Array.from(p.run('latchedSelection')),[true,true,true,true,true]);
 p.status.sensor_fresh=[true,true,false,true,true];await p.run('refresh()');assert.equal(p.run('selectionFresh'),false);assert.deepEqual(Array.from(p.run('liveSelection')),[true,true,true,true,true]);up();assert.deepEqual(Array.from(p.run('latchedSelection')),[true,true,true,true,true]);
 p.status.sensor_fresh=[true,true,true,true,true];await p.run('refresh()');hold(p);p.run('updateSelectionFromStatus(null)');up();assert.deepEqual(Array.from(p.run('latchedSelection')),[true,true,true,true,true]);
 await p.run('refresh()');hold(p);p.run('selectionStatusAt=Date.now()-751');up();assert.deepEqual(Array.from(p.run('latchedSelection')),[true,true,true,true,true]);
 await p.run('refresh()');hold(p);p.handlers.blur();assert.equal(p.run('selectionMode'),false);assert.deepEqual(Array.from(p.run('latchedSelection')),[true,true,true,true,true]);
 // Clicking or using keyboard on any indicator toggles the same persisted selection without auditioning.
 const indicator=p.run('chords[0].selectionIndicators[2].item');indicator.click(plain());assert.equal(p.run('latchedSelection[2]'),false);indicator.keydown({key:' ',...plain()});assert.equal(p.run('latchedSelection[2]'),true);indicator.keydown({key:'Enter',...plain()});assert.equal(p.run('latchedSelection[2]'),false);assert.equal(page(storage).run('latchedSelection[2]'),false);assert.equal(p.sent.length,beforeMidi);
 // Editable fields and native controls keep Space; repeats cannot enter selection.
 for(const tagName of ['INPUT','TEXTAREA','SELECT','BUTTON','A'])assert.equal(p.key(' ',{tagName}),false);assert.equal(p.key(' ',{tagName:'DIV',isContentEditable:true}),false);
 assert.equal(p.key(' ',{tagName:'BODY'},{repeat:true}),true);assert.equal(p.run('selectionMode'),false);
 hold(p);assert.equal(p.key('n',{tagName:'BODY'}),true);assert.equal(p.key('?',{tagName:'BODY'},{shiftKey:true}),true);assert.equal(p.run('chords.length'),1);up();
 // A Shift shortcut cancels an in-progress preview and retains its original meaning.
 p.status.gates=[.8,.1,.1,.1,.1];await p.run('refresh()');const latched=Array.from(p.run('latchedSelection'));hold(p);p.key('Enter',{tagName:'BODY'},{shiftKey:true});assert.equal(p.run('selectionMode'),false);assert.equal(p.run('chords.length'),2);assert.equal(p.run('selectedKeyboard'),0);assert.deepEqual(Array.from(p.run('latchedSelection')),latched);
 // Shift+Space retains keyboard audition outside selection, and is silent while selecting.
 await p.run('actionQueue');const beforePlay=p.sent.length;const chord=p.run('chords[0].node');chord.keydown({key:' ',shiftKey:true,...plain()});await p.run('actionQueue');assert.equal(p.sent.length,beforePlay+1);assert.equal(p.sent.at(-1).path,'/play');
 hold(p);const beforeHeld=p.sent.length;p.run('chords[0].node').keydown({key:' ',shiftKey:true,...plain()});await p.run('actionQueue');assert.equal(p.sent.length,beforeHeld);up();
 console.log('Voice selection combinations, mapping, latching, fallback and safety passed');
})().catch(e=>{console.error(e);process.exitCode=1});
