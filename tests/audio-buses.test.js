// Unit tests for hydra/hydra-buses.js — the shared Music/SFX/UI audio-bus
// logic: normalization, bus-id/pitch coercion, volume math, polyphony
// voice accounting, and the base64 data-URL decoder.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const sandbox = {};
sandbox.window = sandbox; // hydra-buses.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-buses.js'), 'utf8'),
  sandbox, { filename: 'hydra-buses.js' });
const B = sandbox.HydraAudioBuses;

check('HydraAudioBuses exposed with the full surface',
  !!B && Array.isArray(B.BUS_IDS) && typeof B.normalizeBuses === 'function' &&
  typeof B.normalizeBusId === 'function' && typeof B.normalizePitch === 'function' &&
  typeof B.busVolume === 'function' && typeof B.effectiveVolume === 'function' &&
  typeof B.createVoices === 'function' && typeof B.tryAcquire === 'function' &&
  typeof B.release === 'function' && typeof B.decodeDataUrl === 'function');
check('factorySource is a self-contained function string',
  typeof B.factorySource === 'string' && B.factorySource.includes('normalizeBuses'));
check('three buses: music, sfx, ui',
  JSON.stringify(B.BUS_IDS) === JSON.stringify(['music', 'sfx', 'ui']));
check('shipped defaults (music 0.8/1 voice, sfx 1/8, ui 1/4)',
  B.BUS_DEFAULTS.music.volume === 0.8 && B.BUS_DEFAULTS.music.maxVoices === 1 &&
  B.BUS_DEFAULTS.sfx.volume === 1 && B.BUS_DEFAULTS.sfx.maxVoices === 8 &&
  B.BUS_DEFAULTS.ui.volume === 1 && B.BUS_DEFAULTS.ui.maxVoices === 4);

// --- normalizeBuses ---
let nb = B.normalizeBuses(null);
check('null buses normalize to the shipped defaults',
  nb.music.volume === 0.8 && nb.sfx.volume === 1 && nb.ui.muted === false);
nb = B.normalizeBuses('garbage');
check('non-object buses normalize to defaults (never throws)', nb.sfx.maxVoices === 8);
nb = B.normalizeBuses({ music: { volume: 0.5, muted: true } });
check('partial config keeps defaults for the rest',
  nb.music.volume === 0.5 && nb.music.muted === true && nb.sfx.volume === 1);
nb = B.normalizeBuses({ sfx: { volume: 2 }, ui: { volume: -3, maxVoices: 0 }, bogus: { volume: 9 } });
check('volumes clamp to 0-1 and maxVoices floors at 1',
  nb.sfx.volume === 1 && nb.ui.volume === 0 && nb.ui.maxVoices === 4);
check('unknown bus ids are dropped', nb.bogus === undefined);
nb = B.normalizeBuses({ music: { volume: 'loud', muted: 1, maxVoices: 2.7 } });
check('junk coerces safely', nb.music.volume === 0.8 && nb.music.muted === true && nb.music.maxVoices === 2);

// --- normalizeBusId ---
check("normalizeBusId('music')", B.normalizeBusId('music') === 'music');
check("normalizeBusId('MUSIC') lowercases", B.normalizeBusId('MUSIC') === 'music');
check("normalizeBusId('nope') falls back to sfx", B.normalizeBusId('nope') === 'sfx');
check('normalizeBusId blank falls back to sfx', B.normalizeBusId('') === 'sfx' && B.normalizeBusId(null) === 'sfx');

// --- normalizePitch ---
check('normalizePitch(1) is 1', B.normalizePitch(1) === 1);
check('normalizePitch(2) passes through', B.normalizePitch(2) === 2);
check('normalizePitch(0.1) clamps to 0.25', B.normalizePitch(0.1) === 0.25);
check('normalizePitch(10) clamps to 4', B.normalizePitch(10) === 4);
check("normalizePitch('x') defaults to 1", B.normalizePitch('x') === 1);
check('normalizePitch(undefined) defaults to 1', B.normalizePitch(undefined) === 1);

// --- volume math ---
nb = B.normalizeBuses({ music: { volume: 0.5 }, sfx: { volume: 1, muted: true } });
check('busVolume reads the fader', B.busVolume(nb, 'music') === 0.5);
check('busVolume is 0 when muted', B.busVolume(nb, 'sfx') === 0);
check('busVolume coerces unknown ids', B.busVolume(nb, 'nope') === 0); // sfx is muted
check('effectiveVolume multiplies bus x sound', B.effectiveVolume(nb, 'music', 0.5) === 0.25);
check('effectiveVolume is 0 on a muted bus', B.effectiveVolume(nb, 'sfx', 1) === 0);

// --- polyphony voices ---
let voices = B.createVoices(null);
check('voice limits come from the bus config',
  voices.limits.music === 1 && voices.limits.sfx === 8 && voices.limits.ui === 4);
check('counts start at zero', voices.counts.music === 0 && voices.counts.sfx === 0);
voices = B.createVoices({ sfx: { volume: 1, muted: false, maxVoices: 2 } });
let got = 0;
for (let i = 0; i < 3; i++) if (B.tryAcquire(voices, 'sfx')) got++;
check('tryAcquire grants up to the limit then refuses', got === 2 && voices.counts.sfx === 2);
B.release(voices, 'sfx');
check('release frees one voice', voices.counts.sfx === 1 && B.tryAcquire(voices, 'sfx'));
B.release(voices, 'nope'); // unknown id normalizes to sfx
check('release on an unknown id still targets a real bus', voices.counts.sfx === 1);
B.release(voices, 'sfx'); B.release(voices, 'sfx'); B.release(voices, 'sfx');
check('release never goes below zero', voices.counts.sfx === 0);
check('tryAcquire on a broken state returns false, never throws',
  B.tryAcquire(null, 'sfx') === false && B.tryAcquire({}, 'sfx') === false);
const mv = B.createVoices(null);
check('music allows exactly one voice', B.tryAcquire(mv, 'music') && !B.tryAcquire(mv, 'music'));

// --- master volume (P4 item 37 batch 3) ---
check('normalizeMasterVolume exposed', typeof B.normalizeMasterVolume === 'function');
check('normalizeMasterVolume passes 0.5 through', B.normalizeMasterVolume(0.5) === 0.5);
check('normalizeMasterVolume clamps to 0-1', B.normalizeMasterVolume(2) === 1 && B.normalizeMasterVolume(-1) === 0);
check('normalizeMasterVolume bad input defaults to 1',
  B.normalizeMasterVolume('loud') === 1 && B.normalizeMasterVolume(null) === 1 && B.normalizeMasterVolume(undefined) === 1);
check('effectiveVolume scales by the master fader',
  B.effectiveVolume(nb, 'music', 0.5, 0.5) === 0.125); // 0.5 bus x 0.5 sound x 0.5 master
check('effectiveVolume without master stays backward-compatible',
  B.effectiveVolume(nb, 'music', 0.5) === 0.25);
check('effectiveVolume treats corrupt master as full volume',
  B.effectiveVolume(nb, 'music', 0.5, 'nope') === 0.25);
check('effectiveVolume is 0 when the master is 0',
  B.effectiveVolume(nb, 'music', 0.5, 0) === 0);

// --- releaseAll (P4 item 37 batch 3) ---
check('releaseAll exposed', typeof B.releaseAll === 'function');
voices = B.createVoices(null);
B.tryAcquire(voices, 'music'); B.tryAcquire(voices, 'sfx'); B.tryAcquire(voices, 'sfx');
B.releaseAll(voices);
check('releaseAll zeroes every count',
  voices.counts.music === 0 && voices.counts.sfx === 0 && voices.counts.ui === 0);
B.releaseAll(null); B.releaseAll({});
check('releaseAll on broken state never throws', true);
check('voices free again after releaseAll',
  B.tryAcquire(voices, 'music') && B.tryAcquire(voices, 'sfx'));

// --- decodeDataUrl ---
let bytes = B.decodeDataUrl('data:audio/wav;base64,QUJD');
// NOTE: `instanceof Uint8Array` fails across the vm sandbox boundary (the
// sandbox has its own Uint8Array constructor), so duck-type the check.
check('base64 data URL decodes to bytes',
  bytes && typeof bytes.length === 'number' && bytes.length === 3 && bytes[0] === 65 && bytes[2] === 67,
  bytes && Array.from(bytes).join(','));
check('non-base64 data URL returns null',
  B.decodeDataUrl('data:audio/wav,hello') === null);
check('image data URL returns null',
  B.decodeDataUrl('data:image/png;base64,iVBORw0KGgo=') === null);
check('garbage returns null', B.decodeDataUrl('not a url') === null && B.decodeDataUrl(null) === null);
check('bad base64 chars return null',
  B.decodeDataUrl('data:audio/mp3;base64,!!!') === null);

console.log(failures === 0 ? 'audio-buses.test.js: ALL PASS' : `audio-buses.test.js: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
