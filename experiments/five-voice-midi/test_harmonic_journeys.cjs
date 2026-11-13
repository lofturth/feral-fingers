const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(__dirname + '/harmonic-explorer.html', 'utf8');
class Element {
  constructor() { this.attrs={}; this.children=[]; this.value='0'; this.classList={toggle(){},remove(){}}; }
  setAttribute(k,v){this.attrs[k]=v}
  append(...children){for(const child of children){child.parent=this;this.children.push(child)}}
  replaceChildren(){this.children=[]}
  addEventListener(k,fn){this[k]=fn}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this)}
  scrollIntoView(){this.scrolled=true}
}
const elements={},radios=['normal','reverse','custom'].map(value=>Object.assign(new Element(),{value}));
const document={getElementById(id){return elements[id]??=new Element()},createElement(){return new Element()},createElementNS(){return new Element()},querySelectorAll(){return radios},addEventListener(k,fn){this[k]=fn}};
const sent=[];
let status={voice_channel_mapping_supported:true,output_available:true,sensor_fresh:[true,true,true,true,true],gates:[0,0,0,0,0],live_melody:false,assigned_notes:null,chord_source:null};
const context={document,localStorage:{getItem(){return null},setItem(){}},fetch:async(path,opts)=>{if(opts?.method==='POST'){const data=JSON.parse(opts.body);sent.push({path,data});if(path==='/play')status={...status,chord_source:'explorer',voice_notes:data.voice_notes,assigned_notes:[...data.voice_notes].sort((a,b)=>a-b)}}return {ok:true,json:async()=>opts?.method==='POST'?{ok:true}:status}},setTimeout(){},requestAnimationFrame(){}};
vm.createContext(context);vm.runInContext(html.split('<script>')[1].split('</script>')[0],context);
const run=code=>vm.runInContext(code,context);
function key(key,tagName='BODY',extra={}){let prevented=false;document.keydown({key,target:{tagName,...extra},preventDefault(){prevented=true}});return prevented}
(async()=>{
 await new Promise(r=>setImmediate(r));
 assert.equal(run('chords.length'),2);assert.equal(run('selectedKeyboard'),0);assert.equal(sent.length,0);
 const original=Array.from(run('chords[0].pitches'));const firstNode=run('chords[0].node');
 for(let i=0;i<3;i++)assert.equal(key('Enter'),true);
 assert.equal(run('chords.length'),5);assert.equal(run('selectedKeyboard'),4);assert.equal(run('chords[4].root'),0);assert(run('chords[4].node.scrolled'));assert.equal(run('lines.children.length'),20);
 assert.equal(run('chords[0].node'),firstNode);assert.deepEqual(Array.from(run('chords[4].pitches')),original);
 run("setPitchMode('chromatic');selectedVoice=4");key('ArrowRight');
 assert.equal(run('chords[4].pitches[4]'),68);assert.deepEqual(Array.from(run('chords[0].pitches')),original);assert.equal(run('chords[0].node'),firstNode);
 assert.equal(run('degreeName(chords[4].pitches[4],chords[4].root)'),'♭6');
 for(let i=0;i<4;i++)key('ArrowUp');assert.equal(run('selectedKeyboard'),0);
 for(let i=0;i<4;i++)key('ArrowDown');assert.equal(run('selectedKeyboard'),4);
 const earlier=Array.from(run('chords[3].pitches'));
 document.getElementById('triad-choices').children[1].onclick();
 assert.equal(run('chords.length'),5);assert.equal(run('chords[4].root'),2);assert.deepEqual(Array.from(run('chords[3].pitches')),earlier);
 for(const map of [[0,1,2,3,4],[4,3,2,1,0],[2,1,4,3,0]]){context.map=map;run('mapping=map;draw();selectedVoice=map[0]');const before=run('chords[4].pitches[0]');key('ArrowRight');assert.equal(run('chords[4].pitches[0]'),before+1)}
 run("mapping=[0,1,2,3,4];chords[4].pitches=[59,60,64,67,69];selectedVoice=0;draw();editVoice(1)");assert.deepEqual(Array.from(run('chords[4].pitches')),[60,60,64,67,69]);key('ArrowRight');assert.deepEqual(Array.from(run('chords[4].pitches')),[61,60,64,67,69]);
 for(const tag of ['INPUT','BUTTON','SELECT','TEXTAREA','A'])assert.equal(key('Enter',tag),false);
 assert.equal(key('Enter','DIV',{isContentEditable:true}),false);assert.equal(key('Enter','SPAN',{closest:()=>({})}),false);assert.equal(run('chords.length'),5);
 await run('actionQueue');assert(sent.some(x=>x.path==='/play'&&x.data.voice_notes[0]===61));
 console.log('Journey duplication, editing, navigation, roots, mappings, unisons and controls passed');
})().catch(e=>{console.error(e);process.exitCode=1});
