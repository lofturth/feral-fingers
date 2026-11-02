// White-box fixture setup only: never loaded by the browser.
// Instrument the actual source in memory; no state-writing API exists in physics.js.
const fs=require('node:fs');
const path=require('node:path');
function instrumentPhysics(source){
 const anchor='    return api;';
 if(source.split(anchor).length!==2)throw new Error('Session inspection anchor changed');
 return source.replace(anchor,'    __testStates.set(api,state);\n'+anchor);
}
function testPhysics(){
 const states=new WeakMap(),module={exports:{}};
 new Function('module','__testStates',instrumentPhysics(fs.readFileSync(path.join(__dirname,'../physics.js'),'utf8')))(module,states);
 return {Physics:module.exports,stateOf:session=>states.get(session)};
}
module.exports={instrumentPhysics,testPhysics};
