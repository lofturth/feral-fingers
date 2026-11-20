'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('../card-lab/node_modules/typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
const { createSession } = require('../../../core/physics.ts');
const { DEFAULT_PHYSICS_SETTINGS, physicsPatch, loadPhysicsSettings, savePhysicsSettings, validPhysicsSettings } = require('../physicsSettings.ts');

test('physics settings persist, validate against the core and apply live', () => {
  const storage = new Map();
  global.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  try {
    assert.deepEqual(loadPhysicsSettings(), { fallingSpeed: 1, rewardStrength: 25, unlockThreshold: 50, completionThreshold: 90 });
    const next = { fallingSpeed: 2, rewardStrength: 40, unlockThreshold: 30, completionThreshold: 80 };
    assert.equal(validPhysicsSettings(next), true);
    savePhysicsSettings(next);
    assert.deepEqual(loadPhysicsSettings(), next);
    const session = createSession({ cards: ['a'] });
    session.configure(physicsPatch(next));
    assert.equal(session.getState().config.motion.topFallingSpeed, 2);
    assert.equal(session.getState().config.motion.kickHeightPercent, 40);
    assert.equal(session.getState().config.unlock.threshold, 30);
    assert.equal(session.getState().config.finish.threshold, 80);
    assert.equal(validPhysicsSettings({ ...next, unlockThreshold: 80 }), false);
    assert.equal(validPhysicsSettings({ ...next, fallingSpeed: 0 }), false);
    storage.set('piano-trainer.physics-settings', '{broken');
    assert.deepEqual(loadPhysicsSettings(), DEFAULT_PHYSICS_SETTINGS);
    savePhysicsSettings({ ...DEFAULT_PHYSICS_SETTINGS });
    assert.deepEqual(loadPhysicsSettings(), DEFAULT_PHYSICS_SETTINGS);
  } finally { delete global.localStorage; }
});
