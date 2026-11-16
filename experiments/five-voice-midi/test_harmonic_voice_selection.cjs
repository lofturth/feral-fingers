const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(__dirname + '/harmonic-explorer.html','utf8');
const keyName='feral-fingers.harmonic-explorer.workspace.v1';
function page(storage, unavailable=false){
 const elements={}, radios=['normal','reverse','custom'].map(value=>Object.assign(new Element('INPUT'),{value})),handlers={},timers=new Map(),sent=[];let timerId=0;
 function Element(tag='DIV'){this.tagName=tag;this.attrs={};this.children=[];this.value='0';this.classList={toggle(){},remove(){}}}
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
 return {document,handlers,sent,run,key,status};
}
(async()=>{
 const storage={},p=page(storage);await new Promise(r=>setImmediate(r));
 const plain=()=>({preventDefault(){},stopPropagation(){}}),up=()=>p.handlers.keyup({key:' ',preventDefault(){}});
 const initialJourney=JSON.stringify(p.run('chords.map(copyChord)'));const beforeMidi=p.sent.length;
 for(const map of [[0,1,2,3,4],[4,3,2,1,0],[2,4,0,3,1]]){
  p.run(`mapping=${JSON.stringify(map)};mappingMode=mapMode;draw()` .replace('mapMode',JSON.stringify(map.join(',')==='0,1,2,3,4'?'normal':map.join(',')==='4,3,2,1,0'?'reverse':'custom')));
  for(let mask=0;mask<32;mask++){
   const expected=Array.from({length:5},(_,i)=>!!(mask&(1<<i)));
   p.status.gates=expected.map(x=>x?.8:.1);p.status.sensor_fresh=[true,true,true,true,true];await p.run('refresh()');
   assert.equal(p.key(' '),true);assert.equal(p.run('selectionMode'),true);assert.deepEqual(Array.from(p.run('liveSelection')),expected);
   for(let i=0;i<5;i++){p.run(`var finger=${i}`);assert.equal(p.run('chords[0].selectionIndicators[finger].item.attrs["aria-checked"]'),String(expected[i]));assert.equal(p.run('mapping.indexOf(finger)'),map.indexOf(i))}
   up();assert.equal(p.run('selectionMode'),false);assert.deepEqual(Array.from(p.run('latchedSelection')),expected);
  }
 }
 assert.equal(p.sent.length,beforeMidi);assert.equal(JSON.stringify(p.run('chords.map(copyChord)')),initialJourney);
 const saved=JSON.parse(storage[keyName]);assert.deepEqual(saved.voiceSelection,[true,true,true,true,true]);const restored=page(storage);assert.deepEqual(Array.from(restored.run('latchedSelection')),[true,true,true,true,true]);
 // The existing .30 threshold is applied independently to each physical finger.
 p.status.gates=[.2999,.3,.3001,0,1];await p.run('refresh()');p.key(' ');assert.deepEqual(Array.from(p.run('liveSelection')),[false,true,true,false,true]);p.handlers.blur();
 // Live updates and individual stale sensors must never overwrite the latched selection.
 p.status.gates=[.8,.1,.1,.1,.1];await p.run('refresh()');p.key(' ');assert.deepEqual(Array.from(p.run('liveSelection')),[true,false,false,false,false]);
 p.status.gates=[.1,.8,.1,.8,.1];await p.run('refresh()');assert.deepEqual(Array.from(p.run('liveSelection')),[false,true,false,true,false]);assert.deepEqual(Array.from(p.run('latchedSelection')),[true,true,true,true,true]);
 p.status.sensor_fresh=[true,true,false,true,true];await p.run('refresh()');assert.equal(p.run('selectionFresh'),false);assert.deepEqual(Array.from(p.run('liveSelection')),[true,true,true,true,true]);up();assert.deepEqual(Array.from(p.run('latchedSelection')),[true,true,true,true,true]);
 p.status.sensor_fresh=[true,true,true,true,true];await p.run('refresh()');p.key(' ');p.run('updateSelectionFromStatus(null)');up();assert.deepEqual(Array.from(p.run('latchedSelection')),[true,true,true,true,true]);
 await p.run('refresh()');p.key(' ');p.run('selectionStatusAt=Date.now()-751');up();assert.deepEqual(Array.from(p.run('latchedSelection')),[true,true,true,true,true]);
 await p.run('refresh()');p.key(' ');p.handlers.blur();assert.equal(p.run('selectionMode'),false);assert.deepEqual(Array.from(p.run('latchedSelection')),[true,true,true,true,true]);
 // Clicking or using keyboard on any indicator toggles the same persisted selection without auditioning.
 const indicator=p.run('chords[0].selectionIndicators[2].item');indicator.click(plain());assert.equal(p.run('latchedSelection[2]'),false);indicator.keydown({key:' ',...plain()});assert.equal(p.run('latchedSelection[2]'),true);indicator.keydown({key:'Enter',...plain()});assert.equal(p.run('latchedSelection[2]'),false);assert.equal(page(storage).run('latchedSelection[2]'),false);assert.equal(p.sent.length,beforeMidi);
 // Editable fields and native controls keep Space; repeats cannot enter selection.
 for(const tagName of ['INPUT','TEXTAREA','SELECT','BUTTON','A'])assert.equal(p.key(' ',{tagName}),false);assert.equal(p.key(' ',{tagName:'DIV',isContentEditable:true}),false);
 assert.equal(p.key(' ',{tagName:'BODY'},{repeat:true}),true);assert.equal(p.run('selectionMode'),false);
 p.key(' ');assert.equal(p.key('n',{tagName:'BODY'}),true);assert.equal(p.key('?',{tagName:'BODY'},{shiftKey:true}),true);assert.equal(p.run('chords.length'),1);up();
 // A Shift shortcut cancels an in-progress preview and retains its original meaning.
 p.status.gates=[.8,.1,.1,.1,.1];await p.run('refresh()');const latched=Array.from(p.run('latchedSelection'));p.key(' ');p.key('Enter',{tagName:'BODY'},{shiftKey:true});assert.equal(p.run('selectionMode'),false);assert.equal(p.run('chords.length'),2);assert.equal(p.run('selectedKeyboard'),0);assert.deepEqual(Array.from(p.run('latchedSelection')),latched);
 // Shift+Space retains keyboard audition outside selection, and is silent while selecting.
 await p.run('actionQueue');const beforePlay=p.sent.length;const chord=p.run('chords[0].node');chord.keydown({key:' ',shiftKey:true,...plain()});await p.run('actionQueue');assert.equal(p.sent.length,beforePlay+1);assert.equal(p.sent.at(-1).path,'/play');
 p.key(' ');const beforeHeld=p.sent.length;p.run('chords[0].node').keydown({key:' ',shiftKey:true,...plain()});await p.run('actionQueue');assert.equal(p.sent.length,beforeHeld);up();
 console.log('Voice selection combinations, mapping, latching, fallback and safety passed');
})().catch(e=>{console.error(e);process.exitCode=1});
