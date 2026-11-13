const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(__dirname + '/harmonic-explorer.html','utf8');
const keyName='feral-fingers.harmonic-explorer.workspace.v1';
function page(storage, unavailable=false){
 const elements={}, radios=['normal','reverse','custom'].map(value=>Object.assign(new Element('INPUT'),{value})),handlers={},timers=new Map(),sent=[];let timerId=0;
 function Element(tag='DIV'){this.tagName=tag;this.attrs={};this.children=[];this.value='0';this.classList={toggle(){},remove(){}}}
 Element.prototype.setAttribute=function(k,v){this.attrs[k]=v};
 Element.prototype.append=function(...children){for(const c of children){c.parent=this;this.children.push(c)}};
 Element.prototype.replaceChildren=function(){this.children=[]};
 Element.prototype.addEventListener=function(k,fn){this[k]=fn};
 Element.prototype.remove=function(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this)};
 Element.prototype.getBoundingClientRect=function(){return {top:300,height:100}};
 Element.prototype.scrollIntoView=function(){};
 Element.prototype.focus=function(){document.activeElement=this};
 Element.prototype.closest=function(selector){return this.tagName==='BUTTON'&&selector.startsWith('button,')?this:null};
 const document={activeElement:new Element('BODY'),getElementById(id){return elements[id]??=new Element()},createElement(tag){return new Element(tag.toUpperCase())},createElementNS(ns,tag){return new Element(tag)},querySelectorAll(){return radios},addEventListener(k,fn){handlers[k]=fn}};
 const status={voice_channel_mapping_supported:true,output_available:true,sensor_fresh:[true,true,true,true,true],gates:[0,0,0,0,0],live_melody:false,assigned_notes:null,chord_source:null};
 const context={document,window:{innerHeight:800,scrollY:0,scrollTo(){},addEventListener(k,fn){handlers[k]=fn}},performance:{now(){return 0}},localStorage:{getItem(k){if(unavailable)throw Error('unavailable');return storage[k]??null},setItem(k,v){if(unavailable)throw Error('unavailable');storage[k]=v}},fetch:async(path,opts)=>{if(opts?.method==='POST')sent.push({path,data:JSON.parse(opts.body)});return {ok:true,json:async()=>opts?.method==='POST'?{ok:true}:status}},setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id},clearTimeout(id){timers.delete(id)},requestAnimationFrame(){return 1},cancelAnimationFrame(){}};
 vm.createContext(context);vm.runInContext(html.split('<script>')[1].split('</script>')[0],context);
 const run=code=>vm.runInContext(code,context);
 const key=(value,target=document.activeElement)=>{let prevented=false;handlers.keydown({key:value,target,preventDefault(){prevented=true}});return prevented};
 return {document,handlers,sent,run,key};
}
(async()=>{
 const storage={},p=page(storage);await new Promise(r=>setImmediate(r));const original=[48,55,60,64,67];
 p.run("switchSurface('lab')");assert.equal(p.sent.length,0);assert.equal(p.run('labMode'),'parallel');
 const span=a=>Math.max(...a)-Math.min(...a),base=span(original);
 const spread=Array.from(p.run("transformVoicing(labWorking,labSource.tones,'spread',1)")),compressed=Array.from(p.run("transformVoicing(labWorking,labSource.tones,'spread',-1)"));
 assert.ok(span(spread)>base);assert.ok(span(compressed)<base);for(const pitches of [spread,compressed])pitches.forEach((n,i)=>assert.equal(n%12,original[i]%12));
 assert.deepEqual(Array.from(p.run("transformVoicing(labWorking,labSource.tones,'spread',0)")),original);
 for(const mode of ['parallel','inversion','octave','spread']){const [min,max]=Array.from(p.run(`labBounds('${mode}')`));for(const step of [min,max])assert.ok(Array.from(p.run(`transformVoicing(labWorking,labSource.tones,'${mode}',${step})`)).every(n=>n>=36&&n<=84));assert.ok(p.run(`transformVoicing(labWorking,labSource.tones,'${mode}',${max+1})`)===null||Array.from(p.run(`transformVoicing(labWorking,labSource.tones,'${mode}',${max+1})`)).some(n=>n>84||n<36));}
 p.document.getElementById('lab-start').click();assert.equal(p.key('ArrowRight'),true);const first=Array.from(p.run('labPitches'));assert.notDeepEqual(first,original);
 assert.equal(p.key('ArrowDown'),true);assert.equal(p.run('labMode'),'inversion');assert.deepEqual(Array.from(p.run('labPitches')),first);assert.equal(p.run("document.getElementById('lab-parallel').value"),'1');assert.equal(p.run("document.getElementById('lab-value-parallel').textContent"),'1');
 p.key('ArrowRight');const second=Array.from(p.run('labPitches'));p.key('ArrowDown');p.key('ArrowRight');const third=Array.from(p.run('labPitches'));p.key('ArrowDown');assert.equal(p.run('labMode'),'spread');p.key('ArrowRight');const fourth=Array.from(p.run('labPitches'));assert.ok(span(fourth)>span(third));fourth.forEach((n,i)=>assert.equal(n%12,third[i]%12));
 p.key('ArrowLeft');assert.deepEqual(Array.from(p.run('labPitches')),third);p.key('ArrowRight');assert.deepEqual(Array.from(p.run('labPitches')),fourth);
 // Revisiting retains every displayed value and applies only the new delta.
 const before=Array.from(p.run('labPitches'));p.key('ArrowUp');p.key('ArrowUp');p.key('ArrowUp');assert.equal(p.run('labMode'),'parallel');assert.deepEqual(Array.from(p.run('labPitches')),before);assert.equal(p.run("document.getElementById('lab-parallel').value"),'1');assert.equal(p.run("document.getElementById('lab-spread').value"),'1');
 const expected=Array.from(p.run("transformVoicing(labWorking,labSource.tones,'parallel',-1)"));p.key('ArrowLeft');assert.deepEqual(Array.from(p.run('labPitches')),expected);assert.equal(p.run("document.getElementById('lab-parallel').value"),'0');p.key('ArrowRight');assert.deepEqual(Array.from(p.run('labPitches')),before);
 // At the actual bound, another step neither changes pitches nor sends MIDI.
 const slider=p.document.getElementById('lab-parallel');slider.value=slider.max;p.run('updateLab()');const atBound=Array.from(p.run('labPitches'));p.key('ArrowRight');assert.deepEqual(Array.from(p.run('labPitches')),atBound);
 const field={tagName:'INPUT',type:'text'};assert.equal(p.key('ArrowRight',field),false);
 p.document.getElementById('lab-reset').click();assert.deepEqual(Array.from(p.run('labPitches')),original);for(const mode of ['parallel','inversion','octave','spread'])assert.equal(p.run(`document.getElementById('lab-${mode}').value`),'0');
 p.run("switchSurface('explorer')");await p.run('actionQueue');const calls=p.sent.filter(x=>x.path==='/play'||x.path==='/stop');assert.equal(calls.length,11);assert.ok(calls.filter(x=>x.path==='/play').every(x=>x.data.release_first===true));assert.deepEqual(calls.at(-2).data.voice_notes,original);assert.equal(calls.at(-1).path,'/stop');assert.deepEqual(Array.from(p.run('chords[0].pitches')),original);
 p.run('saveWorkspace()');const q=page(storage);await new Promise(r=>setImmediate(r));assert.equal(q.sent.length,0);assert.deepEqual(Array.from(q.run('chords[0].pitches')),original);
 const negative=page({});await new Promise(r=>setImmediate(r));negative.run("switchSurface('lab')");negative.key('ArrowLeft');assert.equal(negative.run("document.getElementById('lab-parallel').value"),'-1');negative.key('ArrowDown');negative.key('ArrowRight');const current=Array.from(negative.run('labPitches'));negative.key('ArrowUp');assert.equal(negative.run("document.getElementById('lab-parallel').value"),'-1');assert.deepEqual(Array.from(negative.run('labPitches')),current);const next=Array.from(negative.run("transformVoicing(labWorking,labSource.tones,'parallel',1)"));negative.key('ArrowRight');assert.deepEqual(Array.from(negative.run('labPitches')),next);assert.equal(negative.run("document.getElementById('lab-parallel').value"),'0');
 console.log('Spread, slider chaining, navigation, bounds, MIDI and persistence passed');
})().catch(e=>{console.error(e);process.exitCode=1});
