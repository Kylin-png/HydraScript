// Unit tests for hydra/hydra-input.js — the shared input helpers.
// Loads the module in a vm sandbox (it is pure: no DOM required).

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-input.js'), 'utf8');
const sandbox = {};
sandbox.window = sandbox; // hydra-input.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'hydra-input.js' });
const HydraInput = sandbox.HydraInput;

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

check('module loaded', !!HydraInput && typeof HydraInput.mouseButtonCode === 'function');
check("left -> 0", HydraInput.mouseButtonCode('left') === 0);
check("middle -> 1", HydraInput.mouseButtonCode('middle') === 1);
check("right -> 2", HydraInput.mouseButtonCode('right') === 2);
check("undefined -> 0 (historical fallback)", HydraInput.mouseButtonCode(undefined) === 0);
check("unknown -> 0 (historical fallback)", HydraInput.mouseButtonCode('bogus') === 0);
check('factorySource is a non-empty function source',
  typeof HydraInput.factorySource === 'string' && HydraInput.factorySource.includes('hydraInputFactory'));
{
  // the factory source must be self-contained: evaluate it standalone
  const s2 = {};
  s2.window = s2;
  vm.createContext(s2);
  vm.runInContext(`window.HydraInput=(${HydraInput.factorySource})();`, s2);
  check('factorySource re-instantiates', s2.HydraInput.mouseButtonCode('middle') === 1);
}

// --- key helpers (canonical matching shared by editor preview and exports) ---
check('normalizeKeyName Spacebar', HydraInput.normalizeKeyName('Spacebar') === 'Space');
check('normalizeKeyName Left', HydraInput.normalizeKeyName('Left') === 'ArrowLeft');
check('normalizeKeyName passthrough', HydraInput.normalizeKeyName('Enter') === 'Enter');
{
  const a = HydraInput.keyNameAliases('a');
  check("keyNameAliases('a') has a/A/KeyA", a.includes('a') && a.includes('A') && a.includes('KeyA'), a.join(','));
}
{
  const s = HydraInput.keyNameAliases('Space');
  check("keyNameAliases('Space') has Space and ' '", s.includes('Space') && s.includes(' '), JSON.stringify(s));
}
check('keySetHas matches KeyA for "a"', HydraInput.keySetHas(new Set(['KeyA']), 'a') === true);
check('keySetHas matches " " for Space', HydraInput.keySetHas(new Set([' ']), 'Space') === true);
check('keySetHas matches ArrowLeft for Left', HydraInput.keySetHas(new Set(['ArrowLeft']), 'Left') === true);
check('keySetHas rejects unrelated keys', HydraInput.keySetHas(new Set(['KeyB']), 'a') === false);

if (failures) { console.error(`${failures} assertion(s) failed`); process.exit(1); }
console.log('input.test.js: all assertions passed');
