const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(__dirname + '/harmonic-explorer.html','utf8');
const keyName='feral-fingers.harmonic-explorer.workspace.v1';
function page(storage, unavailable=false){
 const elements={}, radios=['normal','reverse','custom'].map(value=>Object.assign(new Element('INPUT'),{value})),handlers={},timers=new Map(),sent=[],animations=[];let timerId=0;
 function Element(tag='DIV'){this.tagName=tag;this.attrs={};this.children=[];this.value='0';this.classList={toggle(){},remove(){}}}
 Element.prototype.setAttribute=function(k,v){this.attrs[k]=v};
 Element.prototype.getAttribute=function(k){return this.attrs[k]};
 Element.prototype.cloneNode=function(deep){const copy=new Element(this.tagName);copy.attrs={...this.attrs};if(deep)for(const child of this.children)copy.append(child.cloneNode(true));return copy};
 Element.prototype.animate=function(frames,options){const animation={node:this,frames,options,cancelled:false,cancel(){this.cancelled=true},finished:{then(){}}};(this.animations??=[]).push(animation);animations.push(animation);return animation};
 Element.prototype.getAnimations=function(){return this.animations||[]};
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
 return {document,handlers,sent,run,key,timers,animations};
}
(async()=>{
 const storage={},p=page(storage);await new Promise(r=>setImmediate(r));
 // Closed-gallery browsing uses the same selection path and coalesces rapid auditions.
 const c=page({});await new Promise(r=>setImmediate(r));assert.equal(c.run('galleryOpen'),false);
 const batch=JSON.parse(c.run('JSON.stringify(chords[0].voicings)'));const originalIndex=c.run('chords[0].voicingIndex');
 assert.equal(c.key('n'),true);let index=originalIndex<0?0:(originalIndex+1)%batch.length;assert.equal(c.run('chords[0].voicingIndex'),index);assert.equal(c.run('galleryOpen'),false);
 assert.equal(c.run('carouselIndicator.textContent'),`${index+1} / 8`);let incoming=c.animations.filter(a=>a.node.attrs.class==='voicing-content').at(-1);assert.equal(incoming.frames[0].transform,'translateX(100px)');assert.equal(incoming.options.duration,150);
 const outgoing=c.run('carouselGhost');assert(outgoing);const outAnim=c.animations.find(a=>a.node===outgoing);assert.equal(outAnim.frames[1].transform,'translateX(-100px)');assert.equal(c.run('chords[0].content.children.filter(e=>e.attrs.class==="white").length'),29);
 assert.equal(c.key('p'),true);assert(outAnim.cancelled);index=(index+7)%8;assert.equal(c.run('chords[0].voicingIndex'),index);incoming=c.animations.filter(a=>a.node.attrs.class==='voicing-content').at(-1);assert.equal(incoming.frames[0].transform,'translateX(-100px)');assert.equal(c.run('carouselIndicator.textContent'),`${index+1} / 8`);
 c.key('n');c.key('n');c.key('p');index=(index+1)%8;assert.equal(c.run('chords[0].voicingIndex'),index);assert.equal(c.run('galleryOpen'),false);await c.run('actionQueue');assert.deepEqual(c.sent.filter(x=>x.path==='/play').at(-1).data.voice_notes,batch[index]);assert.equal(c.sent.filter(x=>x.path==='/play').length,1);
 assert.equal(JSON.parse(c.run('localStorage.getItem(workspaceKey)')).chords[0].voicingIndex,index);const timer=c.run('carouselTimer');c.timers.get(timer).fn();assert.equal(c.run('carouselIndicator'),null);
 c.run('window.matchMedia=()=>({matches:true})');const beforeReduced=c.animations.length;c.key('n');assert.equal(c.animations.length,beforeReduced);assert.equal(c.run('carouselGhost'),null);assert(c.run('carouselIndicator.textContent').endsWith('/ 8'));
 c.key(',');assert.equal(c.run('galleryOpen'),false);c.key('.');assert.equal(c.run('galleryOpen'),false);assert.equal(c.key('n',{tagName:'INPUT'}),false);assert.equal(c.key('p',{tagName:'DIV',isContentEditable:true}),false);
 // Wrap at both ends while closed, keeping neighboring keyboards and lines stable.
 const journey=page({});await new Promise(r=>setImmediate(r));journey.key('Enter');const neighbor=journey.run('chords[0].node');journey.run('selectVoicing(7)');journey.key('n');assert.equal(journey.run('chords[1].voicingIndex'),0);journey.key('p');assert.equal(journey.run('chords[1].voicingIndex'),7);assert.equal(journey.run('chords[0].node'),neighbor);assert.equal(journey.run('lines.children.length'),5);for(let i=0;i<5;i++){journey.run(`var voiceIndex=${i}`);assert.equal(journey.run('lines.children[voiceIndex].attrs.x2'),journey.run('voiceX(chords[1],voiceIndex)'))}assert.equal(journey.run('carouselIndicator.textContent'),'8 / 8');assert.equal(journey.run('galleryOpen'),false);
 // Batch generation and navigation persist without changing pitches or sending MIDI.
 const batchesStore={},b=page(batchesStore);await new Promise(r=>setImmediate(r));assert.equal(b.run('chords[0].batches.length'),1);assert.equal(b.run('chords[0].batchIndex'),0);assert.equal(b.run('galleryNode.children.at(-1).children[1].textContent'),'Batch 1 / 1');
 const firstBatch=JSON.parse(b.run('JSON.stringify(chords[0].voicings)')),initialPitches=Array.from(b.run('chords[0].pitches'));const sentCount=b.sent.length;
 assert.equal(b.key('g'),true);assert.equal(b.run('chords[0].batchIndex'),1);assert.equal(b.run('chords[0].batches.length'),2);assert.equal(b.run('galleryNode.children.at(-1).children[1].textContent'),'Batch 2 / 2');assert.deepEqual(Array.from(b.run('chords[0].pitches')),initialPitches);await b.run('actionQueue');assert.equal(b.sent.length,sentCount);
 assert(b.animations.some(x=>x.frames[0]?.opacity===.45));const secondBatch=JSON.parse(b.run('JSON.stringify(chords[0].voicings)'));assert.equal(new Set([...firstBatch,...secondBatch].map(v=>v.join(','))).size,16);
 b.key('[');assert.equal(b.run('chords[0].batchIndex'),0);assert.deepEqual(JSON.parse(b.run('JSON.stringify(chords[0].voicings)')),firstBatch);b.key(']');assert.equal(b.run('chords[0].batchIndex'),1);b.run('galleryNode.children.at(-1).children[0].click()');assert.equal(b.run('chords[0].batchIndex'),0);b.run('galleryNode.children.at(-1).children[2].click()');assert.equal(b.run('chords[0].batchIndex'),1);
 b.key('r');assert.equal(b.run('chords[0].batches.length'),3);assert.deepEqual(Array.from(b.run('chords[0].pitches')),initialPitches);b.key('[');const reloadBatches=page(batchesStore);assert.equal(reloadBatches.run('chords[0].batchIndex'),1);assert.equal(reloadBatches.run('chords[0].batches.length'),3);assert.deepEqual(JSON.parse(reloadBatches.run('JSON.stringify(chords[0].voicings)')),secondBatch);
 const oldWorkspace=JSON.parse(batchesStore[keyName]);delete oldWorkspace.chords[0].batches;delete oldWorkspace.chords[0].batchIndex;const legacyBatch=page({[keyName]:JSON.stringify(oldWorkspace)});assert.equal(legacyBatch.run('chords[0].batches.length'),1);assert.deepEqual(JSON.parse(legacyBatch.run('JSON.stringify(chords[0].voicings)')),secondBatch);
 b.key('1');assert.deepEqual(Array.from(b.run('chords[0].pitches')),secondBatch[0]);b.key('n');assert.deepEqual(Array.from(b.run('chords[0].pitches')),secondBatch[1]);assert.equal(b.run('galleryOpen'),false);
 b.run('generateVoicings=()=>[]');const existingBatches=b.run('chords[0].batches.length');b.key('g');assert.equal(b.run('chords[0].batches.length'),existingBatches);assert(b.document.getElementById('error').textContent.includes('No more distinct'));
 for(const tagName of ['INPUT','TEXTAREA','SELECT'])for(const key of ['g','r','[',']','0'])assert.equal(b.key(key,{tagName}),false);for(const key of ['g','[','0'])assert.equal(b.key(key,{tagName:'DIV',isContentEditable:true}),false);
 // Context audition stops all sounding voices, retains selection, then does the same before the candidate.
 const auditionStore={},a=page(auditionStore);await new Promise(r=>setImmediate(r));const noPrevious=a.sent.length;a.key('0');await a.run('actionQueue');assert.equal(a.sent.length,noPrevious);
 a.key('Enter');await a.run('actionQueue');a.run("chords[0].pitches=[36,48,55,60,64];mapping=[4,3,2,1,0];mappingMode='reverse';draw();scheduleSave(true)");
 const savedBefore=auditionStore[keyName],selectionBefore=a.run('selectedKeyboard'),voicingBefore=a.run('chords[1].voicingIndex');let beforeMessages=a.sent.length;
 a.key('0');assert.equal(a.run('selectedKeyboard'),selectionBefore);assert.equal(a.run('chords[1].voicingIndex'),voicingBefore);assert.equal(auditionStore[keyName],savedBefore);assert.equal(a.run('carouselIndicator.textContent'),'Previous chord');await a.run('actionQueue');let events=a.sent.slice(beforeMessages);assert.deepEqual(events.map(x=>x.path),['/stop','/play']);assert.deepEqual(events[1].data.voice_notes,[36,48,55,60,64]);assert.deepEqual(events[1].data.mapping,[4,3,2,1,0]);
 beforeMessages=a.sent.length;a.key('5');await a.run('actionQueue');events=a.sent.slice(beforeMessages);assert.deepEqual(events.map(x=>x.path),['/stop','/play']);assert.deepEqual(events[1].data.voice_notes,Array.from(a.run('chords[1].pitches')));assert.deepEqual(events[1].data.mapping,[4,3,2,1,0]);assert.equal(a.run('selectedKeyboard'),selectionBefore);
 // A failed stop prevents the following note-on request.
 const failure=page({});await new Promise(r=>setImmediate(r));failure.key('Enter');await failure.run('actionQueue');failure.run("var failedCalls=[];fetch=async(path,opts)=>{failedCalls.push(path);return {ok:false,json:async()=>({error:'stop failed'})}}");failure.key('0');await failure.run('actionQueue');assert.deepEqual(Array.from(failure.run('failedCalls')),['/stop']);assert(failure.document.getElementById('error').textContent.includes('stop failed'));
 const cases=[['triads',0],['triads',1],['triads',6],['sevenths',1],['sevenths',6]];
 for(const [category,index] of cases){
  const result=JSON.parse(p.run(`JSON.stringify(generateVoicings(catalog.${category}[${index}].pitches,catalog.${category}[${index}].tones))`));
  const tones=Array.from(p.run(`catalog.${category}[${index}].tones`));assert.equal(result.length,8);assert.equal(new Set(result.map(x=>x.join(','))).size,8);
  for(const v of result){assert(v.every(n=>n>=36&&n<=84&&tones.includes(n%12)));assert(tones.every(t=>v.some(n=>n%12===t)))}
  assert(result.some(v=>v[4]-v[0]>=24));assert(result.some(v=>v.reduce((a,b)=>a+b,0)<260));
  const labels=JSON.parse(p.run(`JSON.stringify(generateVoicings(catalog.${category}[${index}].pitches,catalog.${category}[${index}].tones).map(character))`));
  assert(labels.includes('Balanced'));assert(labels.includes('Close'));assert(labels.includes('Open'));assert(labels.filter(x=>x==='Experimental').length<=1);assert(new Set(labels).size>=5);assert(new Set(result.map(v=>tones.map(t=>v.filter(n=>n%12===t).length).join(','))).size>=2);
  result.forEach((v,i)=>{const gaps=v.slice(1).map((n,j)=>n-v[j]),span=v[4]-v[0],mean=v.reduce((a,b)=>a+b,0)/5;if(labels[i]==='Balanced'){assert(span>=18&&span<=26);assert(Math.max(...gaps)<=9);assert(mean>=51&&mean<=70)}if(labels[i]!=='Experimental')assert(Math.max(...gaps)<16&&span<=34)});
 }
 // Chord selection uses the chord's own reference, independent of the preceding chord.
 p.key('Enter');p.run('chords[0].pitches=[72,73,74,75,76]');p.document.getElementById('seventh-choices').children[1].onclick({detail:0});
 assert.deepEqual(Array.from(p.run('chords[1].pitches')),Array.from(p.run('generateVoicings(catalog.sevenths[1].pitches,catalog.sevenths[1].tones)[0]')));
 assert.equal(p.run('galleryOpen'),false);assert.equal(p.key('v'),true);assert.equal(p.run('galleryNode.children.length'),10);assert.equal(p.run("galleryNode.children[1].children.filter(x=>x.tagName==='rect'&&(x.attrs.fill==='#e4e9e3'||x.attrs.fill==='#172235')).length"),49);assert.equal(p.run('galleryNode.children[1].children.filter(x=>x.attrs.class==="gallery-voice-line").length'),5);
 const old=Array.from(p.run('chords[1].pitches'));const priorBatch=JSON.parse(p.run('JSON.stringify(chords[1].voicings)'));
 for(let i=0;i<8;i++){assert.equal(p.key(String(i+1)),true);assert.deepEqual(Array.from(p.run('chords[1].pitches')),priorBatch[i])}
 assert.equal(p.key('n'),true);assert.deepEqual(Array.from(p.run('chords[1].pitches')),priorBatch[0]);assert.equal(p.key('p'),true);assert.deepEqual(Array.from(p.run('chords[1].pitches')),priorBatch[7]);
 await p.run('actionQueue');assert.deepEqual(p.sent.filter(x=>x.path==='/play').at(-1).data.voice_notes,priorBatch[7]);
 p.key(',');assert.deepEqual(Array.from(p.run('chords[1].pitches')),priorBatch[6]);p.key('.');assert.deepEqual(Array.from(p.run('chords[1].pitches')),priorBatch[7]);
 const current=Array.from(p.run('chords[1].pitches'));const sentBefore=p.sent.length;p.key('r');assert.deepEqual(Array.from(p.run('chords[1].pitches')),current);assert.equal(p.run('chords[1].voicingIndex'),-1);
 const nextBatch=JSON.parse(p.run('JSON.stringify(chords[1].voicings)'));assert.equal(nextBatch.length,8);assert(p.run("chords[1].voicings.filter(v=>character(v)==='Experimental').length")<=1);assert(p.run("chords[1].voicings.some(v=>character(v)==='Balanced')"));assert.equal(new Set([...priorBatch,...nextBatch].map(v=>v.join(','))).size,16);
 await p.run('actionQueue');const plays=p.sent.filter(x=>x.path==='/play');assert.deepEqual(plays.at(-1).data.voice_notes,current);const count=plays.length;p.key('r');await p.run('actionQueue');assert.equal(p.sent.filter(x=>x.path==='/play').length,count);
 p.key('1');await p.run('actionQueue');assert.deepEqual(p.sent.filter(x=>x.path==='/play').at(-1).data.voice_notes,Array.from(p.run('chords[1].pitches')));
 for(const tagName of ['INPUT','TEXTAREA','SELECT'])for(const key of ['1',',','.','r','n','p'])assert.equal(p.key(key,{tagName}),false);
 assert.equal(p.key('n',{tagName:'DIV',isContentEditable:true}),false);assert.equal(p.key('p',{tagName:'DIV',isContentEditable:true}),false);assert(html.includes('P / N · Previous / next (wrap)'));
 const selected=Array.from(p.run('chords[1].pitches'));const restored=page(storage);await new Promise(r=>setImmediate(r));assert.deepEqual(Array.from(restored.run('chords[1].pitches')),selected);assert.equal(restored.run('chords[1].offered.length'),24);assert.equal(restored.sent.length,0);
 // Lines use the same scaled pitch positions as each colored marker.
 const g=p.run('galleryNode.children[1]');const lines=g.children.filter(x=>x.attrs.class==='gallery-voice-line'),dots=g.children.filter(x=>x.tagName==='circle');assert.equal(dots.length,5);for(let i=0;i<5;i++){const dot=dots[p.run(`mapping.indexOf(${i})`)];assert.equal(lines[i].attrs.x2,dot.attrs.cx);assert.equal(lines[i].attrs.y2,dot.attrs.cy);assert.equal(lines[i].attrs.y1,14);assert.equal(lines[i].attrs.y2-lines[i].attrs.y1,67)}
 // Crossing and stationary voices retain their own color and stay visible above the keys.
 p.run("mapping=[0,1,2,3,4];chords[0].pitches=[36,48,60,72,84];chords[1].voicings=[[36,72,60,48,84]];chords[1].voicingIndex=0;draw()");
 const cross=p.run('galleryNode.children[1]'),crossLines=cross.children.filter(x=>x.attrs.class==='gallery-voice-line'),crossDots=cross.children.filter(x=>x.tagName==='circle');
 assert.equal(crossLines.length,5);assert.equal(crossLines[0].attrs.x1,crossLines[0].attrs.x2);assert.equal(crossLines[2].attrs.x1,crossLines[2].attrs.x2);assert(crossLines[1].attrs.x1<crossLines[3].attrs.x1&&crossLines[1].attrs.x2>crossLines[3].attrs.x2);
 for(let i=0;i<5;i++){assert.equal(crossLines[i].attrs.stroke,crossDots[i].attrs.fill);assert.equal(crossLines[i].attrs.x2,crossDots[i].attrs.cx);assert.equal(crossLines[i].attrs.y2,crossDots[i].attrs.cy)}
 const keyRects=cross.children.filter(x=>x.tagName==='rect'&&(x.attrs.fill==='#e4e9e3'||x.attrs.fill==='#172235'));assert.equal(keyRects[0].attrs.y-14,35);assert(cross.children.indexOf(crossLines[0])>cross.children.indexOf(keyRects.at(-1)));assert(crossLines.every(l=>l.attrs.y1>=0&&l.attrs.y2<cross.children[0].attrs.height));assert.equal(cross.attrs['clip-path'],undefined);assert.equal(p.run('galleryHeight()'),416);
 p.run('selectKeyboard(0)');assert.equal(p.run('galleryNode.children[1].children.filter(x=>x.attrs.class==="gallery-voice-line").length'),0);assert.equal(p.run('galleryHeight()'),320);assert.equal(p.run('galleryNode.children[1].children[0].attrs.height'),68);
 p.run('galleryNode.children[0].click()');assert.equal(p.run('galleryNode.children.length'),2);p.run('galleryNode.children[0].click()');assert.equal(p.run('galleryNode.children.length'),10);
 let offered=[];while(true){p.run(`var testedOffered=${JSON.stringify(offered)}`);const batch=JSON.parse(p.run('JSON.stringify(generateVoicings([48,60,72,84,84],[0],testedOffered))'));if(!batch.length)break;offered.push(...batch.map(v=>v.join(',')));assert.equal(new Set(offered).size,offered.length);assert(offered.length<=126)}assert.equal(offered.length,126);
 console.log('Gallery diversity, navigation, regeneration, lines, MIDI and persistence passed');
})().catch(e=>{console.error(e);process.exitCode=1});
