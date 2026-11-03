const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const root = path.join(__dirname, '..');

console.log('[build] Running tsc...');
execSync('npx tsc', { cwd: root, stdio: 'inherit' });

console.log('[build] Generating UMD physics.js...');
const distJsPath = path.join(root, 'dist', 'physics.js');
let distJs = fs.readFileSync(distJsPath, 'utf8');

// Strip source mapping URL and "use strict"
distJs = distJs.replace(/"use strict";\s*/g, '');
distJs = distJs.replace(/\/\/# sourceMappingURL=.*$/m, '');

const banner = `/* DOM-free, deterministic session model. Classic browser script + CommonJS
 * export keep index.html usable directly via file:// without a build/server.
 *
 * Generated from physics.ts. Do not edit directly.
 */
`;

const umd = `${banner}(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MunduPhysics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const exports = {};
${distJs
  .split('\n')
  .map(line => '  ' + line)
  .join('\n')}
  return exports.MunduPhysics;
});
`;

const outPath = path.join(root, 'core', 'physics.js');
fs.writeFileSync(outPath, umd);
console.log('[build] Successfully generated physics.js from physics.ts');
