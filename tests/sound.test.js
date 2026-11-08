// Unit tests for hydra/hydra-audio.js — the shared playSound source decision.
//
// Asset wins when data.assetId names a real asset with a dataUrl; anything
// else falls back to the built-in tone (backward compatible with every
// existing playSound block, which has no assetId).

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const sandbox = {};
sandbox.window = sandbox; // hydra-audio.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-audio.js'), 'utf8'),
  sandbox, { filename: 'hydra-audio.js' });
const A = sandbox.HydraAudio;

check('HydraAudio exposed with helpers', !!A &&
  typeof A.resolveSoundSource === 'function' && typeof A.normalizeVolume === 'function');
check('factorySource is a self-contained function string',
  typeof A.factorySource === 'string' && A.factorySource.includes('resolveSoundSource'));

const ASSETS = {
  sfx1: { name: 'jump.mp3', kind: 'audio', dataUrl: 'data:audio/mpeg;base64,//uQxAAAA' },
  img1: { name: 'hero.png', kind: 'image', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' },
  broken: { name: 'gone.mp3', kind: 'audio' } // no dataUrl
};

// --- resolveSoundSource ---
let s = A.resolveSoundSource(ASSETS, { type: 'playSound', assetId: 'sfx1' });
check('asset wins when assetId names a real audio asset',
  s.kind === 'asset' && s.dataUrl === ASSETS.sfx1.dataUrl && s.name === 'jump.mp3');

s = A.resolveSoundSource(ASSETS, { type: 'playSound' });
check('legacy block with no assetId falls back to tone', s.kind === 'tone');

s = A.resolveSoundSource(ASSETS, { type: 'playSound', assetId: '' });
check('empty assetId falls back to tone', s.kind === 'tone');

s = A.resolveSoundSource(ASSETS, { type: 'playSound', assetId: 'nope' });
check('deleted/missing asset falls back to tone', s.kind === 'tone');

s = A.resolveSoundSource(ASSETS, { type: 'playSound', assetId: 'broken' });
check('asset without dataUrl falls back to tone', s.kind === 'tone');

s = A.resolveSoundSource(ASSETS, { type: 'playSound', assetId: 'img1' });
check('image asset resolves as asset (dataUrl plays via <audio> too)',
  s.kind === 'asset' && s.dataUrl === ASSETS.img1.dataUrl);

s = A.resolveSoundSource(null, { type: 'playSound', assetId: 'sfx1' });
check('missing asset table falls back to tone (no crash)', s.kind === 'tone');

s = A.resolveSoundSource(ASSETS, null);
check('null block data falls back to tone (no crash)', s.kind === 'tone');

// --- normalizeVolume ---
check('undefined volume keeps legacy 0.3 default', A.normalizeVolume(undefined) === 0.3);
check('volume 0 keeps legacy 0.3 (matches old `|| 0.3` semantics)', A.normalizeVolume(0) === 0.3);
check('volume 0.7 passes through', A.normalizeVolume(0.7) === 0.7);
check('volume 1 passes through', A.normalizeVolume(1) === 1);
check('volume 2 clamps to 1', A.normalizeVolume(2) === 1);
check('negative volume keeps legacy 0.3', A.normalizeVolume(-0.5) === 0.3);
check('non-numeric volume keeps legacy 0.3', A.normalizeVolume('loud') === 0.3);
check('numeric string volume coerces', A.normalizeVolume('0.5') === 0.5);

console.log(failures === 0 ? 'sound.test.js: ALL PASS' : `sound.test.js: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
