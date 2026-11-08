// Unit tests for hydra/hydra-spatialaudio.js — the shared positional
// / spatial audio (P4 Advanced batch 17: sounds that live somewhere,
// beginner edition).
//
// Pure logic: hear-within distance normalization (50..5000, default
// 600), pan normalization (-1..1, default 0), the listener (the center
// of the screen in world coordinates), the object center, and the
// spatial mix (linear volume falloff + left/right pan). Nothing here
// touches the DOM; both runtimes delegate to this module. Static
// checks at the end pin the wiring: catalog block, both runtimes'
// dispatch and pan math, the editor audio-asset select, and the
// export inlining.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HYDRA = path.join(__dirname, '..', 'hydra');
const REPO = path.join(__dirname, '..');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}
function near(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-9); }

const sandbox = {};
sandbox.window = sandbox; // hydra-spatialaudio.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-spatialaudio.js'), 'utf8'),
  sandbox, { filename: 'hydra-spatialaudio.js' });
const SA = sandbox.HydraSpatialAudio;

check('HydraSpatialAudio exposed with helpers',
  !!SA && typeof SA.normalizeMaxDistance === 'function' &&
  typeof SA.normalizePan === 'function' &&
  typeof SA.listenerOf === 'function' &&
  typeof SA.objectCenter === 'function' &&
  typeof SA.spatialMix === 'function' &&
  typeof SA.isSpatialAudioAction === 'function' &&
  typeof SA.isSpatialAudioCondition === 'function');
check('factorySource is a self-contained function string',
  typeof SA.factorySource === 'string' && SA.factorySource.includes('hydraSpatialAudioFactory'));
check('constants are 600 default hear-within, 50..5000 range',
  SA.DEFAULT_MAX_DISTANCE === 600 && SA.MIN_MAX_DISTANCE === 50 && SA.MAX_MAX_DISTANCE === 5000);

// --- max-distance normalization ---
{
  check('normalizeMaxDistance keeps 50, 600, and 5000, clamps past the range',
    SA.normalizeMaxDistance(50) === 50 && SA.normalizeMaxDistance(600) === 600 &&
    SA.normalizeMaxDistance(5000) === 5000 &&
    SA.normalizeMaxDistance(30) === 50 && SA.normalizeMaxDistance(6000) === 5000);
  check('normalizeMaxDistance reads non-numeric as 600 (a typo hears at the default range)',
    SA.normalizeMaxDistance('far') === 600 && SA.normalizeMaxDistance(NaN) === 600 &&
    SA.normalizeMaxDistance(undefined) === 600 && SA.normalizeMaxDistance(null) === 600 &&
    SA.normalizeMaxDistance('') === 600);
}

// --- pan normalization ---
{
  check('normalizePan keeps -1, -0.5, 0, 0.5, and 1, clamps past the rails',
    SA.normalizePan(-1) === -1 && SA.normalizePan(-0.5) === -0.5 &&
    SA.normalizePan(0) === 0 && SA.normalizePan(0.5) === 0.5 && SA.normalizePan(1) === 1 &&
    SA.normalizePan(2) === 1 && SA.normalizePan(-2) === -1);
  check('normalizePan reads non-numeric as 0 (a typo plays centered)',
    SA.normalizePan('left') === 0 && SA.normalizePan(NaN) === 0 &&
    SA.normalizePan(undefined) === 0 && SA.normalizePan(null) === 0 &&
    SA.normalizePan('') === 0);
}

// --- the listener ---
{
  check('the listener is the screen center in world coordinates',
    JSON.stringify(SA.listenerOf({ x: 200, y: 100, zoom: 1 }, 800, 600)) === '{"x":600,"y":400}');
  check('the listener halves the view when zoomed in',
    JSON.stringify(SA.listenerOf({ x: 200, y: 100, zoom: 2 }, 800, 600)) === '{"x":400,"y":250}');
  check('a missing camera reads as the origin at zoom 1',
    JSON.stringify(SA.listenerOf(null, 800, 600)) === '{"x":400,"y":300}' &&
    JSON.stringify(SA.listenerOf(undefined, 800, 600)) === '{"x":400,"y":300}');
  check('a zero or negative zoom reads as 1 (it cannot be a real zoom)',
    JSON.stringify(SA.listenerOf({ x: 200, y: 100, zoom: 0 }, 800, 600)) === '{"x":600,"y":400}' &&
    JSON.stringify(SA.listenerOf({ x: 200, y: 100, zoom: -2 }, 800, 600)) === '{"x":600,"y":400}');
  check('a missing canvas reads as a zero-size view at the camera',
    JSON.stringify(SA.listenerOf({ x: 200, y: 100, zoom: 1 }, null, null)) === '{"x":200,"y":100}');
  check('hostile inputs degrade to a safe listener, never a throw',
    (function () {
      try {
        const l = SA.listenerOf('far', 'wide', 'tall');
        return l && typeof l.x === 'number' && typeof l.y === 'number';
      } catch (e) { return false; }
    })());
}

// --- the object center ---
{
  check('objectCenter is pos plus half the size',
    JSON.stringify(SA.objectCenter({ posX: 100, posY: 50, width: 40, height: 40 })) === '{"x":120,"y":70}');
  check('objectCenter reads missing sizes as 0',
    JSON.stringify(SA.objectCenter({ posX: 100, posY: 50 })) === '{"x":100,"y":50}');
  check('objectCenter reads a missing object as the origin',
    JSON.stringify(SA.objectCenter(undefined)) === '{"x":0,"y":0}' &&
    JSON.stringify(SA.objectCenter(null)) === '{"x":0,"y":0}' &&
    JSON.stringify(SA.objectCenter('bell')) === '{"x":0,"y":0}');
}

// --- the spatial mix ---
{
  check('a source on the listener is full volume, centered',
    JSON.stringify(SA.spatialMix({ x: 400, y: 300 }, { x: 400, y: 300 }, 600)) === '{"volume":1,"pan":0}');
  check('a source half the range left is half volume, half left',
    (function () {
      const m = SA.spatialMix({ x: 100, y: 300 }, { x: 400, y: 300 }, 600);
      return near(m.volume, 0.5) && near(m.pan, -0.5);
    })());
  check('a source half the range right is half volume, half right',
    (function () {
      const m = SA.spatialMix({ x: 700, y: 300 }, { x: 400, y: 300 }, 600);
      return near(m.volume, 0.5) && near(m.pan, 0.5);
    })());
  check('a source at the hear-within distance is silent, hard panned',
    (function () {
      const m = SA.spatialMix({ x: -200, y: 300 }, { x: 400, y: 300 }, 600);
      return m.volume === 0 && m.pan === -1;
    })());
  check('a source past the range stays silent with the pan clamped',
    (function () {
      const m = SA.spatialMix({ x: 2000, y: 300 }, { x: 400, y: 300 }, 600);
      return m.volume === 0 && m.pan === 1;
    })());
  check('distance is straight-line (a 3-4-5 offset fades by 5/6, pans by 3/6)',
    (function () {
      const m = SA.spatialMix({ x: 700, y: 700 }, { x: 400, y: 300 }, 600);
      return near(m.volume, 1 - 500 / 600) && near(m.pan, 0.5);
    })());
  check('a shorter hear-within distance fades the same source faster',
    (function () {
      const m = SA.spatialMix({ x: 100, y: 300 }, { x: 400, y: 300 }, 300);
      return m.volume === 0 && m.pan === -1;
    })());
  check('a missing source or listener reads as the origin',
    (function () {
      const m1 = SA.spatialMix(null, { x: 400, y: 300 }, 600);
      const m2 = SA.spatialMix({ x: 400, y: 300 }, null, 600);
      return near(m1.volume, 1 - 500 / 600) && near(m1.pan, -400 / 600) &&
        near(m2.volume, 1 - 500 / 600) && near(m2.pan, 400 / 600);
    })());
  check('a bad hear-within distance reads as the 600 default',
    (function () {
      const m = SA.spatialMix({ x: 100, y: 300 }, { x: 400, y: 300 }, 'far');
      return near(m.volume, 0.5) && near(m.pan, -0.5);
    })());
}

// --- routing sets ---
{
  check('isSpatialAudioAction covers Play Sound at Position and nothing else',
    SA.isSpatialAudioAction('playSoundAtPosition') === true &&
    SA.isSpatialAudioAction('playSound') === false &&
    SA.isSpatialAudioAction('setParallax') === false);
  check('isSpatialAudioCondition covers nothing (no conditions in this batch)',
    SA.isSpatialAudioCondition('playSoundAtPosition') === false &&
    SA.isSpatialAudioCondition('musicPlaying') === false);
}

// --- static wiring ---
{
  const html = fs.readFileSync(path.join(HYDRA, 'index.html'), 'utf8');
  const scriptJs = fs.readFileSync(path.join(HYDRA, 'script.js'), 'utf8');
  const playerJs = fs.readFileSync(path.join(HYDRA, 'player-runtime.js'), 'utf8');
  const previewJs = fs.readFileSync(path.join(HYDRA, 'hydra-previewruntime.js'), 'utf8');
  const executeJs = fs.readFileSync(path.join(HYDRA, 'hydra-execute.js'), 'utf8');
  const catalogJs = fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8');
  const propinputsJs = fs.readFileSync(path.join(HYDRA, 'hydra-propinputs.js'), 'utf8');
  const refMd = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');
  const guideMd = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');

  const saTag = html.indexOf('src="hydra-spatialaudio.js');
  check('index.html loads hydra-spatialaudio.js before player-runtime.js and script.js',
    saTag !== -1 && saTag < html.indexOf('src="player-runtime.js') && saTag < html.indexOf('src="script.js'));
  check('index.html loads hydra-spatialaudio.js after hydra-parallax.js',
    saTag !== -1 && html.indexOf('src="hydra-parallax.js') < saTag);
  check('player-runtime.js hard-guards on HydraSpatialAudio',
    playerJs.includes('requires hydra-spatialaudio.js (window.HydraSpatialAudio)'));
  check('player-runtime.js inlines HydraSpatialAudio into exports',
    playerJs.includes("'HydraSpatialAudio', global.HydraSpatialAudio && global.HydraSpatialAudio.factorySource"));
  check('player-runtime.js classifies spatial blocks for the dispatch',
    playerJs.includes('HydraSpatialAudio.isSpatialAudioAction(type)'));
  check('player-runtime.js routes spatial blocks through the shared module',
    playerJs.includes('spatialAudioModule: HydraSpatialAudio'));
  check('player-runtime.js pans positioned sounds through a StereoPannerNode',
    playerJs.includes('function exportPanner(state, rawPan)') &&
    playerJs.includes('createStereoPanner') &&
    playerJs.includes('exportSfxBuffer(state, source.dataUrl, volume, pitch, releaseVoice, data.pan)'));
  check('preview runtime exposes the module to the action context',
    previewJs.includes("spatialAudioModule: mod('SpatialAudio')"));
  check('shared execute module runs Play Sound at Position',
    executeJs.includes("if (isType(ctx.spatialAudioModule, 'isSpatialAudioAction', type))") &&
    executeJs.includes("type === 'playSoundAtPosition'"));
  check('catalog carries Play Sound at Position in the Audio category',
    catalogJs.includes("blockType: 'play-sound-at-position'") &&
    catalogJs.includes("runtimeType: 'playSoundAtPosition'") &&
    catalogJs.includes("control: 'audio'"));
  check('catalog declares the audio field control',
    catalogJs.includes("audio:    { extras: [], desc: 'Select of the uploaded audio assets"));
  check('editor renders the audio-asset select for the Sound field',
    propinputsJs.includes('function makeAudioAssetSelect') &&
    propinputsJs.includes('Built-in tone') &&
    propinputsJs.includes('getAudioAssets') &&
    scriptJs.includes("case 'audio':") &&
    scriptJs.includes('makeAudioAssetSelect(value, onChange)') &&
    scriptJs.includes('getAudioAssets: function ()'));
  check('preview pans positioned tones and SFX through a StereoPannerNode',
    scriptJs.includes('function previewPanner(ctx, rawPan)') &&
    scriptJs.includes('createStereoPanner') &&
    scriptJs.includes('playSfxBuffer(source.dataUrl, volume, pitch, releaseVoice, data.pan)') &&
    scriptJs.includes('playToneBuffer(data, volume, pitch, releaseVoice, data.pan)'));
  check('block reference documents Play Sound at Position',
    refMd.includes('Play Sound at Position'));
  check('user guide covers positional audio',
    guideMd.includes('Positional audio'));
}

process.exit(failures === 0 ? 0 : 1);
