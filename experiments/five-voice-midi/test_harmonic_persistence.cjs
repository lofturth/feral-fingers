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
 const storage={};let p=page(storage);await new Promise(r=>setImmediate(r));
 assert.equal(p.run('chords.length'),1);assert.equal(p.sent.length,0);
 // A pointer-selected chord returns focus to its keyboard; Enter remains musical.
 p.document.getElementById('triad-choices').children[1].onclick({detail:1});
 assert.equal(p.document.activeElement,p.run('chords[0].node'));
 assert.equal(p.key('Enter'),true);assert.equal(p.key('Enter'),true);assert.equal(p.run('chords.length'),3);assert.equal(p.run('selectedKeyboard'),2);
 p.run("mapping=[4,3,2,1,0];mappingMode='reverse';setPitchMode('chromatic');selectedVoice=0;editVoice(1)");
 assert.equal(p.key('ArrowUp'),true);assert.equal(p.run('selectedKeyboard'),1);assert.equal(p.key('Backspace'),true);assert.equal(p.run('chords.length'),2);assert.equal(p.run('selectedKeyboard'),0);
 let saved=JSON.parse(storage[keyName]);assert.equal(saved.version,1);assert.equal(saved.chords.length,2);assert.equal(saved.active,0);assert.equal(saved.chords[1].root,2);assert.equal(saved.chords[1].edited,true);assert.deepEqual(saved.mapping,[4,3,2,1,0]);assert.equal(saved.pitchMode,'chromatic');
 p.key('ArrowDown');p.handlers.pagehide();saved=JSON.parse(storage[keyName]);assert.equal(saved.active,1);
 p=page(storage);await new Promise(r=>setImmediate(r));assert.equal(p.sent.length,0);assert.equal(p.run('chords.length'),2);assert.equal(p.run('selectedKeyboard'),1);assert.equal(p.run('chords[1].root'),2);assert.equal(p.run('chords[1].edited'),true);assert.equal(p.run('mappingMode'),'reverse');assert.equal(p.run('pitchMode'),'chromatic');assert.equal(p.run('lines.children.length'),5);
 p.run("changeMapping('custom',[2,1,4,3,0])");p.handlers.pagehide();
 const custom=page(storage);await new Promise(r=>setImmediate(r));assert.equal(custom.run('mappingMode'),'custom');assert.deepEqual(Array.from(custom.run('mapping')),[2,1,4,3,0]);assert.equal(custom.sent.length,0);
 custom.run('chords[1].pitches[4]=84;scheduleSave(true)');
 const extended=page(storage);await new Promise(r=>setImmediate(r));assert.equal(extended.run('chords[1].pitches[4]'),84);assert.equal(extended.sent.length,0);
 // Keyboard activation of a chord button keeps normal control focus.
 const button=p.document.getElementById('triad-choices').children[2];button.focus();button.onclick({detail:0});assert.equal(p.document.activeElement,button);assert.equal(p.key('Enter'),false);
 for(const bad of ['{',JSON.stringify({version:2}),JSON.stringify({version:1,chords:[],active:0})]){const q=page({[keyName]:bad});await new Promise(r=>setImmediate(r));assert.equal(q.run('chords.length'),1);assert.equal(q.run('chords[0].name'),'C major');assert.equal(q.sent.length,0)}
 const legacy=page({'feral-fingers.harmonic-explorer.mapping.v1':JSON.stringify({mode:'reverse',mapping:[4,3,2,1,0]}),'feral-fingers.harmonic-explorer.pitch-mode.v1':'chromatic'});await new Promise(r=>setImmediate(r));assert.equal(legacy.run('mappingMode'),'reverse');assert.equal(legacy.run('pitchMode'),'chromatic');assert.equal(legacy.sent.length,0);
 const q=page({},true);await new Promise(r=>setImmediate(r));assert.doesNotThrow(()=>q.key('Enter'));assert.equal(q.run('chords.length'),2);
 console.log('Workspace save, restore, fallback, no-play and pointer focus passed');
})().catch(e=>{console.error(e);process.exitCode=1});
