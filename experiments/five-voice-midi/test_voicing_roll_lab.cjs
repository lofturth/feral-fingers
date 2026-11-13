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
 const transform=(mode,steps,source='[48,55,60,64,67]')=>Array.from(p.run(`transformVoicing(${source},[0,4,7],"${mode}",${steps})`));
 assert.deepEqual(transform('parallel',1),[52,60,64,67,72]);assert.deepEqual(transform('parallel',-1),[43,52,55,60,64]);
 assert.deepEqual(transform('inversion',1),[60,55,60,64,67]);assert.deepEqual(transform('inversion',-1),[48,55,60,64,55]);
 assert.deepEqual(transform('octave',1),[60,67,72,76,79]);assert.deepEqual(transform('octave',-1),[36,43,48,52,55]);
 for(const mode of ['parallel','inversion','octave'])assert.deepEqual(transform(mode,0),[48,55,60,64,67]);
 assert.deepEqual(transform('inversion',1,'[60,60,64,67,72]'),[72,60,64,67,72]);
 assert.deepEqual(transform('parallel',1,'[49,55,60,64,67]'),[52,60,64,67,72]);
 const snapshot=p.run('JSON.stringify(chords.map(c=>c.pitches))');p.run("switchSurface('lab')");assert.equal(p.sent.length,0);
 assert.equal(p.run('JSON.stringify(chords.map(c=>c.pitches))'),snapshot);
 for(const mode of ['parallel','inversion','octave']){p.run(`document.getElementById('lab-mode').value='${mode}';updateLab()`);const [min,max]=Array.from(p.run(`labBounds('${mode}')`));for(const step of [min,max])assert.ok(Array.from(p.run(`transformVoicing(labSource.pitches,labSource.tones,'${mode}',${step})`)).every(n=>n>=36&&n<=84));}
 assert.deepEqual(Array.from(p.run("labBounds('octave')")),[-1,1]);
 for(const mode of ['parallel','inversion','octave']){const [min,max]=Array.from(p.run(`labBounds('${mode}')`));assert.ok(min<0);assert.ok(Array.from(p.run(`transformVoicing(labSource.pitches,labSource.tones,'${mode}',${min-1})`)).some(n=>n<36));assert.ok(Array.from(p.run(`transformVoicing(labSource.pitches,labSource.tones,'${mode}',${max+1})`)).some(n=>n>84));}
 assert.equal(p.run('first'),48);assert.equal(p.run('last'),84);assert.equal(p.document.getElementById('lab-keyboard').children.filter(c=>c.tagName==='rect').length,49);
 p.run("document.getElementById('lab-mode').value='octave';document.getElementById('lab-position').value='-1';updateLab()");assert.deepEqual(Array.from(p.run('labPitches')),[36,43,48,52,55]);
 p.run("document.getElementById('lab-mode').value='parallel';document.getElementById('lab-position').value='1';updateLab()");
 p.run("mapping=[4,3,2,1,0];document.getElementById('lab-position').value='1';updateLab();document.getElementById('lab-position').value='0';updateLab()");assert.deepEqual(Array.from(p.run('labPitches')),[48,55,60,64,67]);
 p.run("document.getElementById('lab-mode').value='octave';document.getElementById('lab-position').value='-1';updateLab()");p.document.getElementById('lab-start').click();p.run("document.getElementById('lab-position').value='0';updateLab()");p.run("switchSurface('explorer')");await p.run('actionQueue');
 assert.deepEqual(p.sent.filter(x=>x.path==='/play'||x.path==='/stop').map(x=>x.path),['/play','/play','/stop']);assert.deepEqual(p.sent.find(x=>x.path==='/play').data.mapping,[4,3,2,1,0]);assert.deepEqual(p.sent.find(x=>x.path==='/play').data.voice_notes,[36,43,48,52,55]);
 assert.equal(p.run('JSON.stringify(chords.map(c=>c.pitches))'),snapshot);assert.equal(p.run('selectedKeyboard'),0);
 p.run('saveWorkspace()');const q=page(storage);await new Promise(r=>setImmediate(r));assert.equal(q.sent.length,0);assert.equal(q.run('JSON.stringify(chords.map(c=>c.pitches))'),snapshot);
 const chain=page({});await new Promise(r=>setImmediate(r));chain.run("switchSurface('lab')");chain.document.getElementById('lab-start').click();
 chain.run("document.getElementById('lab-mode').value='inversion';document.getElementById('lab-mode').change();document.getElementById('lab-position').value='1';updateLab()");
 assert.deepEqual(Array.from(chain.run('labPitches')),[60,55,60,64,67]);
 chain.run("document.getElementById('lab-mode').value='octave';document.getElementById('lab-mode').change()");
 assert.equal(chain.run("document.getElementById('lab-position').value"),'0');assert.deepEqual(Array.from(chain.run('labPitches')),[60,55,60,64,67]);
 assert.deepEqual(Array.from(chain.run("labBounds('octave')")),[-1,1]);
 chain.run("document.getElementById('lab-position').value='1';updateLab();document.getElementById('lab-mode').value='parallel';document.getElementById('lab-mode').change();document.getElementById('lab-position').value='-1';updateLab()");
 assert.deepEqual(Array.from(chain.run('labPitches')),[67,64,67,72,76]);
 chain.run("document.getElementById('lab-position').value='0';updateLab();document.getElementById('lab-position').value='-1';updateLab()");assert.deepEqual(Array.from(chain.run('labPitches')),[67,64,67,72,76]);
 chain.document.getElementById('lab-reset').click();assert.deepEqual(Array.from(chain.run('labPitches')),[48,55,60,64,67]);assert.deepEqual(Array.from(chain.run('labWorking')),[48,55,60,64,67]);
 chain.run("switchSurface('explorer')");await chain.run('actionQueue');
 const calls=chain.sent.filter(x=>x.path==='/play'||x.path==='/stop');assert.equal(calls.length,8);assert.deepEqual(calls.at(-2).data.voice_notes,[48,55,60,64,67]);assert.equal(calls.at(-1).path,'/stop');assert.equal(chain.run('JSON.stringify(chords.map(c=>c.pitches))'),snapshot);
 console.log('Lab transformations, bounds, snapshot, MIDI release and persistence passed');
})().catch(e=>{console.error(e);process.exitCode=1});
