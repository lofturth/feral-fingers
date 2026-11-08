const test = require('node:test');
const assert = require('node:assert/strict');
const GravityEstimator = require('./gravity.js');
const {gravityGate} = GravityEstimator;

test('gate maps nail-normal alignment continuously and clamps rounding', () => {
  assert.equal(gravityGate([0,0,1]),1);
  assert.equal(gravityGate([1,0,0]),0);
  assert.equal(gravityGate([0,0,-1]),0);
  assert.equal(gravityGate([Math.sin(Math.PI/3),0,-Math.cos(Math.PI/3)]),0);
  assert.ok(Math.abs(gravityGate([Math.sin(Math.PI/3),0,Math.cos(Math.PI/3)])-.5)<1e-12);
  assert.equal(gravityGate([0,0,1.000001]),1);
  assert.equal(gravityGate(null),null);
});
test('five gravity estimators and gates remain independent', () => {
  const estimators=Array.from({length:5},()=>new GravityEstimator());
  const input=[[0,0,1],[1,0,0],[0,0,-1],[Math.sqrt(3)/2,0,.5],[0,1,0]];
  const gates=estimators.map((estimator,i)=>gravityGate(estimator.update(input[i],[0,0,0],1000)));
  assert.deepEqual(gates,[1,0,0,.5,0]);
  estimators[0].update([0,1,0],[0,0,0],300000);
  assert.equal(gravityGate(estimators[0].gravity),0);
  assert.equal(gravityGate(estimators[2].gravity),0);
});
