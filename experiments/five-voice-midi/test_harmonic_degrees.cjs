const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(__dirname + '/harmonic-explorer.html', 'utf8');
const source = html.split('<script>')[1].split('</script>')[0];
class Element {
  constructor() { this.attrs = {}; this.children = []; this.value = '0'; this.classList = { toggle() {}, remove() {} }; }
  setAttribute(key, value) { this.attrs[key] = value; }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  replaceChildren() { this.children = []; }
  addEventListener(key, fn) { this[key] = fn; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  scrollIntoView() {}
}
const elements = {}, radios = ['normal','reverse','custom'].map(value => Object.assign(new Element(), {value}));
const document = {
  getElementById(id) { return elements[id] ??= new Element(); },
  createElement() { return new Element(); }, createElementNS() { return new Element(); },
  querySelectorAll() { return radios; }, addEventListener(key, fn) { this[key] = fn; }
};
const status = { voice_channel_mapping_supported:true, output_available:true, sensor_fresh:[true,true,true,true,true], gates:[0,0,0,0,0], live_melody:false, assigned_notes:null, chord_source:null };
const context = {document, localStorage:{getItem(){return null},setItem(){}}, fetch:async () => ({ok:true,json:async()=>status}), setTimeout(){}, requestAnimationFrame(){}};
vm.createContext(context);
vm.runInContext(source, context);
const run = code => vm.runInContext(code, context);
(async () => {
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(Array.from(run("Array.from({length:12},(_,i)=>degreeName(60+i,0))")), ['1','♭2','2','♭3','3','4','♯4/♭5','5','♭6','6','♭7','7']);
  assert.equal(run('degreeName(48,0)'), run('degreeName(60,0)'));
  const expectedRoots=[0,2,4,5,7,9,11,0,2,4,5,7,9,11];
  const all = run('[...catalog.triads,...catalog.sevenths]');
  assert.deepEqual(Array.from(all,c=>c.root), expectedRoots);
  assert.deepEqual(Array.from(run("catalog.triads[1].pitches.map(p=>degreeName(p,catalog.triads[1].root))")), ['1','♭3','5','1','♭3']);
  assert.deepEqual(Array.from(run("catalog.triads[6].pitches.map(p=>degreeName(p,catalog.triads[6].root))")), ['♭3','♯4/♭5','1','♭3','1']);
  assert.deepEqual(Array.from(run("catalog.sevenths[0].pitches.map(p=>degreeName(p,catalog.sevenths[0].root))")), ['1','3','5','7','1']);
  for (const map of [[0,1,2,3,4],[4,3,2,1,0],[2,1,4,3,0]]) {
    context.map=map;
    run("mapping=map;chords[0].pitches=[48,55,60,64,67];selectedKeyboard=0;selectedVoice=map[0];draw();setPitchMode('chromatic');editVoice(1)");
    assert.equal(run('chords[0].root'),0);
    assert.equal(run('degreeName(chords[0].pitches[0],chords[0].root)'),'♭2');
    assert.equal(run('chords[0].node.children.filter(e=>e.attrs.class==="degree-label").length'),5);
  }
  run("chords[0].pitches=[60,60,59,64,67];draw()");
  assert.equal(run('chords[0].node.children.filter(e=>e.attrs.class==="degree-label").length'),4);
  document.getElementById('triad-choices').children[1].onclick();
  assert.equal(run('chords[1].root'),2);
  document.getElementById('triad-choices').children[6].onclick();
  assert.equal(run('chords[1].root'),11);
  console.log('Harmonic-degree roots, editing, mappings and unisons passed');
})().catch(error => { console.error(error); process.exitCode=1; });
