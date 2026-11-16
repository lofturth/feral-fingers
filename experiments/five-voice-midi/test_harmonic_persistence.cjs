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
 // Both keyboard and pointer chord selection return focus to the active keyboard.
 const button=p.document.getElementById('triad-choices').children[2];button.focus();button.onclick({detail:0});assert.equal(p.document.activeElement,p.run('chords[selectedKeyboard].node'));
 p.key('v');p.key('.');assert.equal(p.document.activeElement,p.run('chords[selectedKeyboard].node'));
 const before=JSON.parse(JSON.stringify(p.run("chords.map(({name,referenceName,root,roman,quality,edited,pitches,tones})=>({name,referenceName,root,roman,quality,edited,pitches,tones}))")));
 assert.equal(p.key('Enter',p.document.activeElement,{shiftKey:true}),true);assert.equal(p.run('selectedKeyboard'),1);
 let after=JSON.parse(JSON.stringify(p.run("chords.map(({name,referenceName,root,roman,quality,edited,pitches,tones})=>({name,referenceName,root,roman,quality,edited,pitches,tones}))")));
 assert.deepEqual(after,[before[0],before[1],before[1]]);assert.equal(p.run('lines.children.length'),10);
 for(let row=0;row<2;row++)for(let voice=0;voice<5;voice++){p.run(`var checkRow=${row}, checkVoice=${voice}`);assert.equal(p.run('lines.children[checkRow*5+checkVoice].attrs.x1'),p.run('voiceX(chords[checkRow],checkVoice)'));assert.equal(p.run('lines.children[checkRow*5+checkVoice].attrs.x2'),p.run('voiceX(chords[checkRow+1],checkVoice)'))}
 const reloaded=page(storage);assert.equal(reloaded.run('selectedKeyboard'),1);assert.deepEqual(JSON.parse(JSON.stringify(reloaded.run("chords.map(({name,referenceName,root,roman,quality,edited,pitches,tones})=>({name,referenceName,root,roman,quality,edited,pitches,tones}))"))),after);
 for(const tagName of ['INPUT','TEXTAREA','SELECT']){assert.equal(p.key('Enter',{tagName},{shiftKey:true}),false);assert.equal(p.key('Enter',{tagName}),false)}
 assert.equal(p.key('Enter',{tagName:'DIV',isContentEditable:true},{shiftKey:true}),false);
 // Visible controls insert above at the beginning, below at the end, and delete.
 p.run('selectKeyboard(0)');p.key('Enter',p.document.activeElement,{shiftKey:true});assert.equal(p.run('selectedKeyboard'),0);assert.equal(p.run('chords[0].name'),p.run('chords[1].name'));
 p.run('selectKeyboard(chords.length-1)');const last=p.run('chords[selectedKeyboard]');p.key('Enter');assert.equal(p.run('selectedKeyboard'),p.run('chords.length-1'));assert.equal(p.run('chords[chords.length-2]'),last);
 p.key('Backspace');assert.equal(p.run('chords.length'),4);
 // Shift+Enter inserts before the first, middle and last selections without reordering.
 for(const index of [0,1,2]){
  const trial=page({});trial.key('Enter');trial.key('Enter');trial.run(`selectKeyboard(${index});chords[0].name='First';chords[1].name='Middle';chords[2].name='Last'`);
  const original=JSON.parse(JSON.stringify(trial.run('chords.map(c=>({name:c.name,pitches:c.pitches,root:c.root,tones:c.tones}))')));
  assert.equal(trial.key('Enter',trial.document.activeElement,{shiftKey:true}),true);assert.equal(trial.run('selectedKeyboard'),index);
  const expected=[...original];expected.splice(index,0,original[index]);assert.deepEqual(JSON.parse(JSON.stringify(trial.run('chords.map(c=>({name:c.name,pitches:c.pitches,root:c.root,tones:c.tones}))'))),expected);
  assert.equal(trial.run('lines.children.length'),15);
 }
 // Command+D uses the same duplicate path, survives reload, and supports undo.
 const dupStore={},d=page(dupStore);d.run("chords[0].pitches=[36,48,55,60,84];scheduleSave(true)");
 assert.equal(d.key('d',d.document.activeElement,{metaKey:true}),true);assert.equal(d.run('selectedKeyboard'),1);assert.deepEqual(Array.from(d.run('chords[1].pitches')),[36,48,55,60,84]);
 assert.equal(page(dupStore).run('chords[1].pitches[0]'),36);d.key('z',d.document.activeElement,{metaKey:true});assert.equal(d.run('chords.length'),1);
 for(const tagName of ['INPUT','TEXTAREA','SELECT'])assert.equal(d.key('d',{tagName},{metaKey:true}),false);assert.equal(d.key('d',{tagName:'DIV',isContentEditable:true},{metaKey:true}),false);
 // The gallery defaults closed and preserves its preference independently of journey history.
 const uiStore={},ui=page(uiStore);await new Promise(r=>setImmediate(r));assert.equal(ui.run('galleryOpen'),false);assert.equal(ui.run('galleryNode.children.length'),2);
 assert.equal(ui.key('1'),true);assert.equal(ui.key('r'),true);assert.equal(ui.key('v'),true);assert.equal(ui.run('galleryOpen'),true);
 const candidate=JSON.stringify(ui.run('chords[0].voicings'));ui.key('Enter');assert.equal(ui.run('galleryOpen'),true);assert.equal(page(uiStore).run('galleryOpen'),true);
 ui.run('selectKeyboard(0)');assert.equal(JSON.stringify(ui.run('chords[0].voicings')),candidate);assert.equal(ui.key('v'),true);assert.equal(page(uiStore).run('galleryOpen'),false);
 for(const tagName of ['INPUT','TEXTAREA','SELECT']){assert.equal(ui.key('v',{tagName}),false);assert.equal(ui.key('?',{tagName}),false)}assert.equal(ui.key('v',{tagName:'DIV',isContentEditable:true}),false);
 // Removed toolbar controls are absent, and help opens from the button and ? and closes with Escape.
 for(const id of ['voicing-prev','voicing-next','voicing-count','duplicate-above','duplicate-below','delete-keyboard'])assert(!html.includes(`id="${id}"`));
 assert(html.includes('⌨ Shortcuts'));for(const heading of ['Chord navigation','Editing and clipboard','Voicing exploration','Playback'])assert(html.includes(heading));
 const panel=ui.document.getElementById('shortcuts-panel'),help=ui.document.getElementById('shortcuts-button');assert.equal(panel.hidden,true);help.click();assert.equal(panel.hidden,false);assert.equal(help.attrs['aria-expanded'],'true');
 assert.equal(ui.key('Escape'),true);assert.equal(panel.hidden,true);assert.equal(ui.document.activeElement,help);assert.equal(ui.key('?'),true);assert.equal(panel.hidden,false);assert.equal(ui.key('?'),true);assert.equal(panel.hidden,true);
 ui.key('v');assert.equal(ui.run('galleryOpen'),true);const beforePreview=ui.run('chords[0].voicingIndex');assert.equal(ui.key('2'),true);assert.notEqual(ui.run('chords[0].voicingIndex'),beforePreview);
 // Copy, replace, insertion, deletion and undo use distinct brief flashes.
 ui.run('var recorded=[];motion=(node,frames)=>{recorded.push(frames);return {finished:{then(){}}}}');
 ui.key('c',ui.document.activeElement,{metaKey:true});assert(ui.run("recorded.some(f=>f[0].stroke==='#00bfff')"));
 ui.run('recorded=[]');ui.key('v',ui.document.activeElement,{metaKey:true});assert(ui.run("recorded.some(f=>f[0].stroke==='#00ff83')"));
 ui.run('recorded=[]');ui.key('Enter');assert(ui.run("recorded.some(f=>f[0].stroke==='#00bfff')"));
 ui.run("recorded=[];chords[selectedKeyboard].node.cloneNode=()=>({children:[{}],setAttribute(){}})");ui.key('Backspace');assert(ui.run("recorded.some(f=>f[0].stroke==='#ff354b')"));
 ui.run('recorded=[]');ui.key('z',ui.document.activeElement,{metaKey:true});assert(ui.run("recorded.some(f=>f[0].stroke==='#00bfff')"));
 // Internal clipboard and undo/redo preserve identity, pitches, selection and saved state.
 const histStorage={},h=page(histStorage);await new Promise(r=>setImmediate(r));
 h.document.getElementById('triad-choices').children[1].onclick({detail:0});const copied=JSON.parse(JSON.stringify(h.run('copyChord(chords[0])')));
 assert.equal(h.key('c',h.document.activeElement,{metaKey:true}),true);assert(h.document.getElementById('clipboard-indicator').textContent.includes(copied.name));
 h.key('Enter');h.document.getElementById('seventh-choices').children[0].onclick({detail:0});const changed=h.run('chords[1].name');
 h.key('v',h.document.activeElement,{metaKey:true});assert.deepEqual(JSON.parse(JSON.stringify(h.run('copyChord(chords[1])'))),copied);
 h.key('z',h.document.activeElement,{metaKey:true});assert.equal(h.run('chords[1].name'),changed);
 h.key('z',h.document.activeElement,{metaKey:true,shiftKey:true});assert.deepEqual(JSON.parse(JSON.stringify(h.run('copyChord(chords[1])'))),copied);
 h.key('v',h.document.activeElement,{metaKey:true,shiftKey:true});assert.equal(h.run('chords.length'),3);assert.equal(h.run('selectedKeyboard'),2);
 h.key('z',h.document.activeElement,{metaKey:true});assert.equal(h.run('chords.length'),2);h.key('z',h.document.activeElement,{metaKey:true,shiftKey:true});assert.equal(h.run('chords.length'),3);
 h.key('Backspace');assert.equal(h.run('chords.length'),2);h.key('z',h.document.activeElement,{metaKey:true});assert.equal(h.run('chords.length'),3);
 // Animations are interruptible and disabled under reduced motion.
 const animations=[];h.run('var animated={getAnimations(){return [{cancel(){animationCancelled=true}}]},animate(frames,options){animationFrames=frames;animationOptions=options;return {}}};var animationCancelled=false,animationFrames=null,animationOptions=null');
 h.run("motion(animated,[{opacity:0},{opacity:1}])");assert.equal(h.run('animationCancelled'),true);assert.equal(h.run('animationOptions.duration'),150);
 h.run("flash({node:{children:[animated]}},'#00bfff')");assert.equal(h.run('animationFrames[0].stroke'),'#00bfff');assert.equal(h.run('animationFrames[0].strokeWidth'),'12px');assert(h.run('animationFrames[0].fillOpacity')>h.run('animationFrames[1].fillOpacity'));
 h.run("window.matchMedia=()=>({matches:true});animationFrames=null;motion(animated,[{opacity:0},{opacity:1}])");assert.equal(h.run('animationFrames'),null);h.run('window.matchMedia=()=>({matches:false})');
 const hp=page(histStorage);assert.equal(hp.run('chords.length'),3);assert.equal(hp.run('selectedKeyboard'),2);assert.deepEqual(JSON.parse(JSON.stringify(hp.run('chords[2].pitches'))),copied.pitches);
 for(const tagName of ['INPUT','TEXTAREA','SELECT'])for(const key of ['c','v','z'])assert.equal(h.key(key,{tagName},{metaKey:true}),false);
 assert.equal(h.key('v',{tagName:'DIV',isContentEditable:true},{metaKey:true}),false);
 // New edits clear redo; undo restores chord and voicing edits.
 h.document.getElementById('triad-choices').children[2].onclick({detail:0});const selected=h.run('chords[2].name');h.key('v');h.key('.');const voice=h.run('chords[2].voicingIndex');assert.equal(voice,1);
 h.key('z',h.document.activeElement,{metaKey:true});assert.equal(h.run('chords[2].voicingIndex'),0);h.key('z',h.document.activeElement,{metaKey:true});assert.notEqual(h.run('chords[2].name'),selected);
 h.key('z',h.document.activeElement,{metaKey:true,shiftKey:true});assert.equal(h.run('chords[2].name'),selected);h.key('Enter');assert.equal(h.run('redoStack.length'),0);
 for(const bad of ['{',JSON.stringify({version:2}),JSON.stringify({version:1,chords:[],active:0})]){const q=page({[keyName]:bad});await new Promise(r=>setImmediate(r));assert.equal(q.run('chords.length'),1);assert.equal(q.run('chords[0].name'),'C major');assert.equal(q.sent.length,0)}
 const legacy=page({'feral-fingers.harmonic-explorer.mapping.v1':JSON.stringify({mode:'reverse',mapping:[4,3,2,1,0]}),'feral-fingers.harmonic-explorer.pitch-mode.v1':'chromatic'});await new Promise(r=>setImmediate(r));assert.equal(legacy.run('mappingMode'),'reverse');assert.equal(legacy.run('pitchMode'),'chromatic');assert.equal(legacy.sent.length,0);
 const q=page({},true);await new Promise(r=>setImmediate(r));assert.doesNotThrow(()=>q.key('Enter'));assert.equal(q.run('chords.length'),2);
 console.log('Workspace save, restore, fallback, no-play and pointer focus passed');
})().catch(e=>{console.error(e);process.exitCode=1});
