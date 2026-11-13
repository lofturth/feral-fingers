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
 const storage={},p=page(storage);await new Promise(r=>setImmediate(r));
 const cases=[['triads',0],['triads',1],['triads',6],['sevenths',1],['sevenths',6]];
 for(const [category,index] of cases){
  const result=JSON.parse(p.run(`JSON.stringify(generateVoicings([48,55,60,64,67],catalog.${category}[${index}].tones))`));
  const tones=Array.from(p.run(`catalog.${category}[${index}].tones`));
  assert.ok(result.length>1&&result.length<=8);
  assert.equal(new Set(result.map(x=>x.join(','))).size,result.length);
  assert.equal(JSON.stringify(result),p.run(`JSON.stringify(generateVoicings([48,55,60,64,67],catalog.${category}[${index}].tones))`));
  for(const pitches of result){assert.ok(pitches.every(n=>n>=48&&n<=84&&tones.includes(n%12)));assert.ok(tones.every(t=>pitches.some(n=>n%12===t)))}
  const cost=a=>a.reduce((v,n,i)=>v+Math.abs(n-[48,55,60,64,67][i]),0);
  assert.ok(result.every((v,i)=>!i||cost(result[i-1])<=cost(v)));
  // Independent exhaustive minimum, without assuming ordered voices.
  const legal=Array.from({length:37},(_,i)=>i+48).filter(n=>tones.includes(n%12));let best=Infinity;
  function walk(notes){if(notes.length===5){if(tones.every(t=>notes.some(n=>n%12===t)))best=Math.min(best,cost(notes));return}for(const n of legal)walk([...notes,n])}walk([]);
  assert.equal(cost(result[0]),best);
  assert.ok(result.slice(1).some(v=>v.reduce((sum,n,i)=>sum+Math.abs(n-result[0][i]),0)>=4));
 }
 assert.deepEqual(JSON.parse(p.run('JSON.stringify(generateVoicings([72,48,64,55,60],[0,4,7])[0])')),[72,48,64,55,60]);
 p.document.getElementById('triad-choices').children[0].onclick({detail:0});
 assert.deepEqual(Array.from(p.run('chords[0].pitches')),[48,52,55,60,64]);
 p.key('Enter');const before=Array.from(p.run('chords[0].pitches'));
 p.document.getElementById('seventh-choices').children[1].onclick({detail:0});
 assert.deepEqual(Array.from(p.run('chords[1].pitches')),Array.from(p.run('generateVoicings(chords[0].pitches,catalog.sevenths[1].tones)[0]')));
 p.run("mapping=[4,3,2,1,0];mappingMode='reverse';selectedVoice=0;pitchMode='chromatic';editVoice(1)");
 assert.equal(p.run('chords[1].edited'),true);const edited=Array.from(p.run('chords[1].pitches'));
 assert.notDeepEqual(edited,Array.from(p.run('chords[1].voicings[0]')));
 p.document.getElementById('voicing-next').click();assert.equal(p.run('chords[1].voicingIndex'),1);assert.equal(p.run('chords[1].edited'),false);
 assert.deepEqual(Array.from(p.run('chords[0].pitches')),before);
 const selected=Array.from(p.run('chords[1].pitches'));assert.deepEqual(JSON.parse(storage[keyName]).chords[1].pitches,selected);
 await new Promise(r=>setImmediate(r));await p.run('actionQueue');assert.deepEqual(p.sent.filter(x=>x.path==='/play').at(-1).data.voice_notes,selected);
 const restored=page(storage);await new Promise(r=>setImmediate(r));assert.deepEqual(Array.from(restored.run('chords[1].pitches')),selected);assert.equal(restored.sent.length,0);assert.equal(restored.document.getElementById('voicing-controls').hidden,true);
 console.log('Voicing coverage, minimum movement, variety, crossings, browsing and persistence passed');
})().catch(e=>{console.error(e);process.exitCode=1});
