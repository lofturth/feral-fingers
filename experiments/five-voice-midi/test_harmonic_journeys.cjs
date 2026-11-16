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
  focus(){this.focused=true}
  getBoundingClientRect(){return {top:300,height:100}}
}
const elements={},radios=['normal','reverse','custom'].map(value=>Object.assign(new Element(),{value}));
const document={getElementById(id){return elements[id]??=new Element()},createElement(){return new Element()},createElementNS(){return new Element()},querySelectorAll(){return radios},addEventListener(k,fn){this[k]=fn}};
const sent=[];
const scrolls=[],navigationFrames=new Map();let frameId=0,scheduledNavigation=0;
let status={voice_channel_mapping_supported:true,output_available:true,sensor_fresh:[true,true,true,true,true],gates:[0,0,0,0,0],live_melody:false,assigned_notes:null,chord_source:null};
const context={document,window:{innerHeight:800,scrollY:200,scrollTo(options){scrolls.push(options)}},performance:{now(){return 0}},localStorage:{getItem(){return null},setItem(){}},fetch:async(path,opts)=>{if(opts?.method==='POST'){const data=JSON.parse(opts.body);sent.push({path,data});if(path==='/play')status={...status,chord_source:'explorer',voice_notes:data.voice_notes,assigned_notes:[...data.voice_notes].sort((a,b)=>a-b)}}return {ok:true,json:async()=>opts?.method==='POST'?{ok:true}:status}},setTimeout(){return 1},clearTimeout(){},requestAnimationFrame(fn){if(fn.name!=='step')return 0;const id=++frameId;navigationFrames.set(id,fn);scheduledNavigation++;return id},cancelAnimationFrame(id){navigationFrames.delete(id)}};
vm.createContext(context);vm.runInContext(html.split('<script>')[1].split('</script>')[0],context);
const run=code=>vm.runInContext(code,context);
function key(key,tagName='BODY',extra={}){let prevented=false;document.keydown({key,target:{tagName,...extra},preventDefault(){prevented=true}});return prevented}
(async()=>{
 await new Promise(r=>setImmediate(r));
 assert.equal(run('chords.length'),1);assert.equal(run('selectedKeyboard'),0);assert.equal(run('lines.children.length'),0);assert.equal(sent.length,0);
 assert.equal(run('last-first+1'),49);assert.equal(run('first'),36);assert.equal(run('last'),84);
 assert.equal(run('chords[0].content.children.filter(e=>e.attrs.class==="white").length'),29);
 assert.equal(run('chords[0].content.children.filter(e=>e.attrs.class==="black").length'),20);
 assert(run('xFor(last)+whiteWidth/2<=900'));assert.equal(run('whitePitches.length'),29);assert.equal(run('noteName(first)'),'C2');
 assert.equal(run('xFor(first)-whiteWidth/2'),run('startX'));
 run("chords[0].pitches[0]=36;draw()");assert(run('chords[0].content.children.some(e=>e.attrs.class==="key-label"&&e.textContent==="C2")'));assert.equal(run('voiceX(chords[0],mapping[0])'),run('xFor(36)'));run("selectedVoice=mapping[0];pitchMode='chromatic';editVoice(-1)");assert.equal(run('chords[0].pitches[0]'),36);
 run("chords[0].pitches[0]=48;draw()");
 assert(html.includes('.workspace-toolbar{position:sticky;'));assert(html.indexOf('<section class="chooser"')<html.indexOf('<section class="landscape"'));
 assert(html.includes('<details class="settings"><summary>Settings &amp; Info</summary>'));
 assert(!html.includes('<details class="settings" open'));
 assert.equal(document.getElementById('triad-choices').children.length,7);assert.equal(document.getElementById('seventh-choices').children.length,7);
 assert(document.getElementById('triad-choices').children.every(button=>button.children.length===1));
 assert.equal(document.getElementById('triad-choices').children[0].attrs['aria-pressed'],'true');
 assert.deepEqual(Array.from(run('chords[0].tones')),[0,4,7]);
 assert.deepEqual(Array.from(run('catalog.triads[1].tones')).sort((a,b)=>a-b),[2,5,9]);
 assert.deepEqual(Array.from(run('catalog.triads[6].tones')).sort((a,b)=>a-b),[2,5,11]);
 assert.deepEqual(Array.from(run('catalog.sevenths[0].tones')).sort((a,b)=>a-b),[0,4,7,11]);
 assert.equal(run('isChordTone(48,chords[0].tones)'),true);assert.equal(run('isChordTone(72,chords[0].tones)'),true);
 assert.equal(run('isChordTone(50,chords[0].tones)'),false);assert.equal(run('isChordTone(49,chords[0].tones)'),false);
 assert.equal(run('chords[0].content.children.filter(e=>e.attrs.class==="tone-indicator chord-tone").length'),5);
 const original=Array.from(run('chords[0].pitches'));
 for(let i=0;i<4;i++)assert.equal(key('Enter'),true);
 assert.equal(run('chords.length'),5);assert.equal(run('selectedKeyboard'),4);assert.equal(run('chords[4].root'),0);assert.equal(navigationFrames.size,1);assert.equal(run('lines.children.length'),20);
 let [frame,step]=[...navigationFrames.entries()][0];navigationFrames.delete(frame);step(90);assert.equal(scrolls.at(-1).behavior,'auto');assert.equal(scrolls.at(-1).top,109);assert.equal(navigationFrames.size,1);
 [frame,step]=[...navigationFrames.entries()][0];navigationFrames.delete(frame);step(180);assert.equal(scrolls.at(-1).top,96);assert.equal(navigationFrames.size,0);assert.equal(run('navigationFrame'),null);
 assert.deepEqual(Array.from(run('chords.map(c=>c.node.children.find(e=>e.attrs.class==="chord-number").textContent)')),['1','2','3','4','5']);
 const firstNode=run('chords[0].node');assert.deepEqual(Array.from(run('chords[4].pitches')),original);
 run("setPitchMode('chromatic');selectedVoice=4");const beforeEditScrolls=scrolls.length;key('ArrowRight');assert.equal(scrolls.length,beforeEditScrolls);
 assert.equal(run('chords[4].pitches[4]'),68);assert.deepEqual(Array.from(run('chords[0].pitches')),original);assert.equal(run('chords[0].node'),firstNode);
 assert.equal(run('chords[4].content.children.filter(e=>e.attrs.class==="tone-indicator non-chord-tone").length'),1);
 assert.deepEqual(Array.from(run('chords[4].tones')),[0,4,7]);
 assert.equal(run('degreeName(chords[4].pitches[4],chords[4].root)'),'♭6');
 const beforeNavigation=scheduledNavigation;for(let i=0;i<4;i++)key('ArrowUp');assert.equal(run('selectedKeyboard'),0);assert.equal(scheduledNavigation,beforeNavigation+4);assert.equal(navigationFrames.size,1);
 for(let i=0;i<4;i++)key('ArrowDown');assert.equal(run('selectedKeyboard'),4);
 const earlier=Array.from(run('chords[3].pitches'));
 document.getElementById('triad-choices').children[1].onclick();
 assert.equal(run('chords.length'),5);assert.equal(run('chords[4].root'),2);assert.deepEqual(Array.from(run('chords[3].pitches')),earlier);
 assert.deepEqual(Array.from(run('chords[4].tones')).sort((a,b)=>a-b),[2,5,9]);assert.deepEqual(Array.from(run('chords[3].tones')),[0,4,7]);
 for(const map of [[0,1,2,3,4],[4,3,2,1,0],[2,1,4,3,0]]){context.map=map;run('mapping=map;draw();selectedVoice=map[0]');const before=run('chords[4].pitches[0]');key('ArrowRight');assert.equal(run('chords[4].pitches[0]'),before+1)}
 run("mapping=[0,1,2,3,4];chords[4].pitches=[59,60,64,67,69];selectedVoice=0;draw();editVoice(1)");assert.deepEqual(Array.from(run('chords[4].pitches')),[60,60,64,67,69]);assert.equal(run('chords[4].content.children.filter(e=>e.attrs.class?.startsWith("tone-indicator")).length'),4);key('ArrowRight');assert.deepEqual(Array.from(run('chords[4].pitches')),[61,60,64,67,69]);
 for(const tag of ['INPUT','BUTTON','SELECT','TEXTAREA','A'])assert.equal(key('Enter',tag),false);
 assert.equal(key('Enter','DIV',{isContentEditable:true}),false);assert.equal(key('Enter','SPAN',{closest:()=>({})}),false);assert.equal(run('chords.length'),5);
 run('selectedKeyboard=4;appendKeyboard()');assert.equal(run('chords.length'),6);
 assert.deepEqual(Array.from(run('chords[5].tones')).sort((a,b)=>a-b),[2,5,9]);
 assert.notEqual(run('chords[5].tones'),run('chords[4].tones'));
 document.getElementById('seventh-choices').children[0].onclick();
 assert.deepEqual(Array.from(run('chords[5].tones')).sort((a,b)=>a-b),[0,4,7,11]);
 assert.deepEqual(Array.from(run('chords[4].tones')).sort((a,b)=>a-b),[2,5,9]);
 run("chords[5]={name:'Fmaj9',root:5,tones:[0,4,5,7,9],role:'DESTINATION CHORD',pitches:[60,65,69,64,71]};selectedKeyboard=5;mapping=[0,1,2,3,4];selectedVoice=4;draw()");
 for(const pitch of [60,65,69,64]){context.pitch=pitch;assert.equal(run('isChordTone(pitch,chords[5].tones)'),true)}
 assert.equal(run('isChordTone(71,chords[5].tones)'),false);
 assert.equal(run('chords[5].content.children.filter(e=>e.attrs.class==="tone-indicator chord-tone").length'),4);
 assert.equal(run('chords[5].content.children.filter(e=>e.attrs.class==="tone-indicator non-chord-tone").length'),1);
 assert(run('chords[5].content.children.filter(e=>e.attrs.class?.startsWith("tone-indicator")).every(e=>e.attrs.y1+2.5<172)'));
 run("setPitchMode('chromatic');editVoice(-1);editVoice(-1)");
 assert.equal(run('chords[5].content.children.filter(e=>e.attrs.class==="tone-indicator non-chord-tone").length'),0);
 const snapshot=Array.from(run('chords.map(c=>({pitches:[...c.pitches],root:c.root,tones:[...c.tones]}))'),c=>({pitches:Array.from(c.pitches),root:c.root,tones:Array.from(c.tones)}));
 run('selectKeyboard(2)');assert.equal(key('Backspace'),true);assert.equal(run('selectedKeyboard'),1);assert.equal(run('chords.length'),5);assert.equal(run('lines.children.length'),20);
 assert.deepEqual(Array.from(run('chords.map(c=>c.node.children.find(e=>e.attrs.class==="chord-number").textContent)')),['1','2','3','4','5']);
 assert.deepEqual(Array.from(run('chords.map(c=>({pitches:[...c.pitches],root:c.root,tones:[...c.tones]}))'),c=>({pitches:Array.from(c.pitches),root:c.root,tones:Array.from(c.tones)})),snapshot.filter((_,i)=>i!==2));
 await run('actionQueue');assert.deepEqual(sent.at(-1).data.voice_notes,Array.from(run('chords[1].pitches')));
 run('selectKeyboard(0)');key('Backspace');assert.equal(run('selectedKeyboard'),0);assert.equal(run('chords.length'),4);
 run('selectKeyboard(chords.length-1)');key('Backspace');assert.equal(run('selectedKeyboard'),2);assert.equal(run('chords.length'),3);
 for(const tag of ['INPUT','BUTTON','SELECT','TEXTAREA','A'])assert.equal(key('Backspace',tag),false);
 assert.equal(key('Backspace','DIV',{isContentEditable:true}),false);assert.equal(run('chords.length'),3);
 key('ArrowUp');assert.equal(run('selectedKeyboard'),1);key('ArrowDown');assert.equal(run('selectedKeyboard'),2);
 key('Backspace');key('Backspace');assert.equal(run('chords.length'),1);assert.equal(run('selectedKeyboard'),0);
 await run('actionQueue');const sentBefore=sent.length;assert.equal(key('Backspace'),true);await run('actionQueue');assert.equal(run('chords.length'),1);assert.equal(sent.length,sentBefore);
 // The selector follows the active keyboard, including edited voicings.
 document.getElementById('triad-choices').children[0].onclick();
 key('Enter');key('Enter');assert.equal(run('chords.length'),3);
 document.getElementById('triad-choices').children[6].onclick();assert.equal(run('chords[2].root'),11);
 key('ArrowUp');document.getElementById('triad-choices').children[1].onclick();assert.equal(run('chords[1].root'),2);assert.equal(run('chords[2].root'),11);
 key('ArrowUp');document.getElementById('seventh-choices').children[0].onclick();assert.equal(run('chords[0].root'),0);assert.equal(run('chords[1].root'),2);
 assert.equal(document.getElementById('seventh-choices').children[0].attrs['aria-pressed'],'true');
 key('ArrowDown');assert.equal(document.getElementById('triad-choices').children[1].attrs['aria-pressed'],'true');
 run("selectedVoice=0;setPitchMode('chromatic')");key('ArrowRight');assert.equal(run('chords[1].edited'),true);
 assert.equal(document.getElementById('triad-choices').children[1].attrs['aria-pressed'],'true');assert(document.getElementById('selected-chord-label').textContent.includes('edited'));
 key('ArrowDown');assert.equal(document.getElementById('triad-choices').children[6].attrs['aria-pressed'],'true');
 key('ArrowUp');assert.equal(run('chords[1].edited'),true);assert.equal(document.getElementById('triad-choices').children[1].attrs['aria-pressed'],'true');
 await run('actionQueue');assert.deepEqual(sent.at(-1).data.voice_notes,Array.from(run('chords[1].pitches')));
 // Insert after the first, then the middle, then the end without changing later chords.
 const originalMiddle=run('chords[1]'),originalLast=run('chords[2]');
 run('selectKeyboard(0)');key('Enter');assert.equal(run('selectedKeyboard'),1);assert.equal(run('chords.length'),4);
 assert.equal(run('chords[2]'),originalMiddle);assert.equal(run('chords[3]'),originalLast);
 assert.deepEqual(Array.from(run('chords[1].pitches')),Array.from(run('chords[0].pitches')));assert.notEqual(run('chords[1].pitches'),run('chords[0].pitches'));
 assert.deepEqual(Array.from(run('chords[1].tones')),Array.from(run('chords[0].tones')));assert.equal(run('chords[1].root'),run('chords[0].root'));
 key('Enter');assert.equal(run('selectedKeyboard'),2);assert.equal(run('chords[3]'),originalMiddle);assert.equal(run('chords[4]'),originalLast);assert.equal(run('lines.children.length'),20);
 run('selectKeyboard(chords.length-1)');key('Enter');assert.equal(run('selectedKeyboard'),5);assert.equal(run('chords.length'),6);assert.equal(navigationFrames.size,1);
 await run('actionQueue');assert.deepEqual(sent.at(-1).data.voice_notes,Array.from(run('chords[5].pitches')));
 run("mapping=[0,1,2,3,4];selectedVoice=0;setPitchMode('chromatic');chords[selectedKeyboard].pitches[0]=83;draw();editVoice(1)");
 assert.equal(run('chords[selectedKeyboard].pitches[0]'),84);assert.equal(run('noteName(84)'),'C6');
 assert(run('chords[selectedKeyboard].content.children.some(e=>e.attrs.class==="key-label"&&e.textContent==="C6")'));
 assert(run('chords[selectedKeyboard].content.children.some(e=>e.attrs.class?.startsWith("tone-indicator")&&e.attrs.x1===xFor(84)-11)'));
 assert.equal(run('lines.children[(selectedKeyboard-1)*5].attrs.x2'),run('voiceX(chords[selectedKeyboard],0)'));
 run('editVoice(1)');assert.equal(run('chords[selectedKeyboard].pitches[0]'),84);
 assert.equal(run("nextPitch(84,-1,'diatonic',scalePitchClasses)"),83);
 assert.equal(run("nextPitch(36,-1,'diatonic',scalePitchClasses)"),35);
 run('chords[selectedKeyboard].pitches[0]=83;draw()');
 // Ordinary button and Settings focus retain musical arrows; form fields do not.
 assert.equal(key('ArrowUp','BUTTON'),true);assert.equal(run('selectedKeyboard'),4);
 assert.equal(key('ArrowDown','SUMMARY'),true);assert.equal(run('selectedKeyboard'),5);
 const beforeButtonEdit=Array.from(run('chords[5].pitches'));const beforeButtonScroll=scrolls.length;
 run("selectedVoice=0;setPitchMode('chromatic')");assert.equal(key('ArrowRight','BUTTON'),true);
 assert.notDeepEqual(Array.from(run('chords[5].pitches')),beforeButtonEdit);assert.equal(scrolls.length,beforeButtonScroll);
 assert.equal(key('ArrowUp','SELECT'),false);assert.equal(key('ArrowLeft','INPUT'),false);
 assert.equal(key('Enter','SUMMARY'),false);assert.equal(run('selectedKeyboard'),5);
 assert.equal(run('chords.filter(c=>c.node.attrs["aria-pressed"]==="true").length'),1);
 await run('actionQueue');assert(sent.some(x=>x.path==='/play'&&x.data.voice_notes[0]===61));
 console.log('Journey duplication, editing, navigation, roots, mappings, unisons and controls passed');
})().catch(e=>{console.error(e);process.exitCode=1});
