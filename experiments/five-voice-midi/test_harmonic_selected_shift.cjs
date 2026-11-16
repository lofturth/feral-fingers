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
 const scale=[0,2,4,5,7,9,11];const step=(n,d)=>{do{n+=d}while(!scale.includes((n%12+12)%12));return n};
 const store={},p=page(store);await new Promise(r=>setImmediate(r));const mappings=[[0,1,2,3,4],[4,3,2,1,0],[2,4,0,3,1]],base=[64,65,71,60,67];
 for(const map of mappings)for(let mask=1;mask<32;mask++){
  const selected=Array.from({length:5},(_,i)=>!!(mask&(1<<i))),mode=map.join(',')==='0,1,2,3,4'?'normal':map.join(',')==='4,3,2,1,0'?'reverse':'custom';
  p.run(`mapping=${JSON.stringify(map)};mappingMode=${JSON.stringify(mode)};latchedSelection=${JSON.stringify(selected)};pitchMode='chromatic';chords[0].pitches=${JSON.stringify(base)};undoStack.length=0;redoStack.length=0;draw()`);
  const before=p.sent.length;assert.equal(p.key('ArrowRight'),true);const expected=base.map((n,slot)=>selected[map[slot]]?step(n,1):n);assert.deepEqual(Array.from(p.run('chords[0].pitches')),expected);assert.equal(p.run('undoStack.length'),1);assert.equal(p.run('chords[0].edited'),true);assert.equal(p.run('chords[0].voicingIndex'),-1);
  await p.run('actionQueue');assert.equal(p.sent.length,before+1);assert.deepEqual(p.sent.at(-1).data.voice_notes,expected);assert.deepEqual(p.sent.at(-1).data.mapping,map);
 }
 // E–F, B–C and whole-tone transitions move simultaneously, even in chromatic mode.
 p.run("mapping=[0,1,2,3,4];mappingMode='normal';latchedSelection=[true,true,true,true,true];pitchMode='chromatic';chords[0].pitches=[64,65,71,60,67];draw()");p.key('ArrowRight');assert.deepEqual(Array.from(p.run('chords[0].pitches')),[65,67,72,62,69]);p.key('ArrowLeft');assert.deepEqual(Array.from(p.run('chords[0].pitches')),[64,65,71,60,67]);
 // Unison and crossing are allowed, with the unselected voice unchanged.
 p.run("latchedSelection=[true,false,false,false,false];chords[0].pitches=[64,65,71,60,67];draw()");p.key('ArrowRight');assert.deepEqual(Array.from(p.run('chords[0].pitches')),[65,65,71,60,67]);assert.equal(p.run('chords[0].selectionIndicators[0].item.attrs["aria-label"]'),'Thumb voice selection');
 p.run('chords[0].pitches=[64,63,71,60,67];draw()');p.key('ArrowLeft');assert.deepEqual(Array.from(p.run('chords[0].pitches')),[62,63,71,60,67]);assert(p.run('voiceX(chords[0],0)<voiceX(chords[0],1)'));
 // Atomic boundary: no partial shift, undo entry or playback if any selected voice is blocked.
 await p.run('actionQueue');p.run("latchedSelection=[true,true,false,false,false];chords[0].pitches=[84,60,71,60,67];undoStack.length=0;draw()");let before=p.sent.length;p.key('ArrowRight');await p.run('actionQueue');assert.deepEqual(Array.from(p.run('chords[0].pitches')),[84,60,71,60,67]);assert.equal(p.run('undoStack.length'),0);assert.equal(p.sent.length,before);
 p.run('chords[0].pitches=[36,60,71,60,67];draw()');p.key('ArrowLeft');await p.run('actionQueue');assert.deepEqual(Array.from(p.run('chords[0].pitches')),[36,60,71,60,67]);assert.equal(p.sent.length,before);
 // With no selection, the existing gravity-selected voice and chromatic mode remain in use.
 p.run("latchedSelection=[false,false,false,false,false];selectedVoice=1;pitchMode='chromatic';chords[0].pitches=[60,65,71,60,67];draw()");p.key('ArrowRight');assert.deepEqual(Array.from(p.run('chords[0].pitches')),[60,66,71,60,67]);
 // One undo/redo restores the entire subset; autosave restores both pitches and selection.
 p.run("mapping=[4,3,2,1,0];mappingMode='reverse';latchedSelection=[true,false,true,false,true];chords[0].pitches=[64,65,71,60,67];undoStack.length=0;redoStack.length=0;draw()");const selection=Array.from(p.run('latchedSelection'));p.key('ArrowRight');const shifted=Array.from(p.run('chords[0].pitches'));p.key('z',p.document.activeElement,{metaKey:true});assert.deepEqual(Array.from(p.run('chords[0].pitches')),[64,65,71,60,67]);p.key('z',p.document.activeElement,{metaKey:true,shiftKey:true});assert.deepEqual(Array.from(p.run('chords[0].pitches')),shifted);assert.deepEqual(Array.from(p.run('latchedSelection')),selection);p.handlers.pagehide();const restored=page(store);assert.deepEqual(Array.from(restored.run('chords[0].pitches')),shifted);assert.deepEqual(Array.from(restored.run('latchedSelection')),selection);
 // The subsequent keyboard and line endpoints use the edited pitches.
 await p.run('actionQueue');p.key('Enter');await p.run('actionQueue');p.run('latchedSelection=[true,true,true,true,true]');p.key('ArrowLeft');for(let finger=0;finger<5;finger++){p.run(`var lineFinger=${finger}`);assert.equal(p.run('lines.children[lineFinger].attrs.x2'),p.run('voiceX(chords[1],lineFinger)'))}assert(p.run('chords[1].content.children.some(e=>e.attrs.class==="degree-label")'));
 console.log('Selected voice diatonic shifts, mapping, limits, undo and playback passed');
})().catch(e=>{console.error(e);process.exitCode=1});
