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
 assert.equal(p.run('galleryNode.children.length'),9);assert.equal(p.run("galleryNode.children[1].children.filter(x=>x.tagName==='rect'&&(x.attrs.fill==='#e4e9e3'||x.attrs.fill==='#172235')).length"),49);assert.equal(p.run('galleryNode.children[1].children.filter(x=>x.attrs.class==="gallery-voice-line").length'),5);
 const old=Array.from(p.run('chords[1].pitches'));const priorBatch=JSON.parse(p.run('JSON.stringify(chords[1].voicings)'));
 for(let i=0;i<8;i++){assert.equal(p.key(String(i+1)),true);assert.deepEqual(Array.from(p.run('chords[1].pitches')),priorBatch[i])}
 p.key(',');assert.deepEqual(Array.from(p.run('chords[1].pitches')),priorBatch[6]);p.key('.');assert.deepEqual(Array.from(p.run('chords[1].pitches')),priorBatch[7]);
 const current=Array.from(p.run('chords[1].pitches'));const sentBefore=p.sent.length;p.key('r');assert.deepEqual(Array.from(p.run('chords[1].pitches')),current);assert.equal(p.run('chords[1].voicingIndex'),-1);
 const nextBatch=JSON.parse(p.run('JSON.stringify(chords[1].voicings)'));assert.equal(nextBatch.length,8);assert(p.run("chords[1].voicings.filter(v=>character(v)==='Experimental').length")<=1);assert(p.run("chords[1].voicings.some(v=>character(v)==='Balanced')"));assert.equal(new Set([...priorBatch,...nextBatch].map(v=>v.join(','))).size,16);
 await p.run('actionQueue');const plays=p.sent.filter(x=>x.path==='/play');assert.deepEqual(plays.at(-1).data.voice_notes,current);const count=plays.length;p.key('r');await p.run('actionQueue');assert.equal(p.sent.filter(x=>x.path==='/play').length,count);
 p.key('1');await p.run('actionQueue');assert.deepEqual(p.sent.filter(x=>x.path==='/play').at(-1).data.voice_notes,Array.from(p.run('chords[1].pitches')));
 for(const tagName of ['INPUT','TEXTAREA','SELECT'])for(const key of ['1',',','.','r'])assert.equal(p.key(key,{tagName}),false);
 const selected=Array.from(p.run('chords[1].pitches'));const restored=page(storage);await new Promise(r=>setImmediate(r));assert.deepEqual(Array.from(restored.run('chords[1].pitches')),selected);assert.equal(restored.run('chords[1].offered.length'),24);assert.equal(restored.sent.length,0);
 // Lines use the same scaled pitch positions as each colored marker.
 const g=p.run('galleryNode.children[1]');const lines=g.children.filter(x=>x.attrs.class==='gallery-voice-line'),dots=g.children.filter(x=>x.tagName==='circle');assert.equal(dots.length,5);for(let i=0;i<5;i++)assert.equal(lines[i].attrs.x2,dots[p.run(`mapping.indexOf(${i})`)].attrs.cx);
 p.run('selectKeyboard(0)');assert.equal(p.run('galleryNode.children[1].children.filter(x=>x.attrs.class==="gallery-voice-line").length'),0);
 p.run('galleryNode.children[0].click()');assert.equal(p.run('galleryNode.children.length'),1);p.run('galleryNode.children[0].click()');assert.equal(p.run('galleryNode.children.length'),9);
 let offered=[];while(true){p.run(`var testedOffered=${JSON.stringify(offered)}`);const batch=JSON.parse(p.run('JSON.stringify(generateVoicings([48,60,72,84,84],[0],testedOffered))'));if(!batch.length)break;offered.push(...batch.map(v=>v.join(',')));assert.equal(new Set(offered).size,offered.length);assert(offered.length<=126)}assert.equal(offered.length,126);
 console.log('Gallery diversity, navigation, regeneration, lines, MIDI and persistence passed');
})().catch(e=>{console.error(e);process.exitCode=1});
