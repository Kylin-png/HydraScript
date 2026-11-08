// Unit tests for hydra/hydra-parallax.js — the shared parallax
// backgrounds (P4 Advanced batch 16: depth without a 3D scene,
// beginner edition).
//
// Pure logic: factor normalization (0..2, 1 = world speed), the
// in-place object repair, the factor read, the parallax camera (the
// live camera scaled per axis), and the action/condition routing sets.
// Nothing here touches the DOM; both runtimes delegate to this module.
// Static checks at the end pin the wiring: catalog blocks, both
// runtimes' dispatch and hit-test/hover math, the draw integration,
// the editor Inspector section, and the export inlining.

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

const sandbox = {};
sandbox.window = sandbox; // hydra-parallax.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-parallax.js'), 'utf8'),
  sandbox, { filename: 'hydra-parallax.js' });
const PX = sandbox.HydraParallax;

check('HydraParallax exposed with helpers',
  !!PX && typeof PX.normalizeParallaxFactor === 'function' &&
  typeof PX.normalizeParallax === 'function' &&
  typeof PX.parallaxOf === 'function' &&
  typeof PX.parallaxCamera === 'function' &&
  typeof PX.isParallaxAction === 'function' &&
  typeof PX.isParallaxCondition === 'function');
check('factorySource is a self-contained function string',
  typeof PX.factorySource === 'string' && PX.factorySource.includes('hydraParallaxFactory'));
check('constants are 1 world-speed default, 2 foreground cap',
  PX.DEFAULT_FACTOR === 1 && PX.MAX_FACTOR === 2);

// --- factor normalization ---
{
  check('normalizeParallaxFactor keeps 0, 0.5, 1, and 2, caps 3 at 2, floors negatives at 0',
    PX.normalizeParallaxFactor(0) === 0 && PX.normalizeParallaxFactor(0.5) === 0.5 &&
    PX.normalizeParallaxFactor(1) === 1 && PX.normalizeParallaxFactor(2) === 2 &&
    PX.normalizeParallaxFactor(3) === 2 && PX.normalizeParallaxFactor(-1) === 0);
  check('normalizeParallaxFactor reads non-numeric as 1 (a typo moves with the world)',
    PX.normalizeParallaxFactor('far') === 1 && PX.normalizeParallaxFactor(NaN) === 1 &&
    PX.normalizeParallaxFactor(undefined) === 1 && PX.normalizeParallaxFactor(null) === 1);
}

// --- object normalization + the factor read ---
{
  check('a missing object reads as world speed on both axes',
    JSON.stringify(PX.normalizeParallax(undefined)) === '{"parallaxX":1,"parallaxY":1}' &&
    JSON.stringify(PX.normalizeParallax(null)) === '{"parallaxX":1,"parallaxY":1}' &&
    JSON.stringify(PX.normalizeParallax('hills')) === '{"parallaxX":1,"parallaxY":1}' &&
    JSON.stringify(PX.normalizeParallax([])) === '{"parallaxX":1,"parallaxY":1}');
  check('a plain object keeps its factors',
    JSON.stringify(PX.normalizeParallax({ parallaxX: 0.5, parallaxY: 0.25 })) ===
    '{"parallaxX":0.5,"parallaxY":0.25}');
  check('bad factors fall back to 1 per axis',
    JSON.stringify(PX.normalizeParallax({ parallaxX: 'far', parallaxY: 5 })) ===
    '{"parallaxX":1,"parallaxY":2}');
  check('normalization is in place (the same object comes back)',
    (function () { const o = { parallaxX: 0.5, parallaxY: 0.5 }; return PX.normalizeParallax(o) === o; })());
  check('parallaxOf reads the factors as a fresh record',
    (function () {
      const o = { parallaxX: 0.5, parallaxY: 0.25 };
      const f = PX.parallaxOf(o);
      return f.x === 0.5 && f.y === 0.25 && f !== o;
    })());
  check('parallaxOf reads missing fields as 1, so old objects keep world speed',
    (function () {
      const f = PX.parallaxOf({ name: 'hero' });
      return f.x === 1 && f.y === 1;
    })());
  check('parallaxOf reads a missing object as world speed',
    JSON.stringify(PX.parallaxOf(undefined)) === '{"x":1,"y":1}' &&
    JSON.stringify(PX.parallaxOf(null)) === '{"x":1,"y":1}' &&
    JSON.stringify(PX.parallaxOf('hills')) === '{"x":1,"y":1}');
}

// --- the parallax camera ---
{
  check('a 0.5 layer sees half the camera on both axes, zoom untouched',
    JSON.stringify(PX.parallaxCamera({ x: 200, y: 100, zoom: 2 }, { parallaxX: 0.5, parallaxY: 0.5 })) ===
    '{"x":100,"y":50,"zoom":2}');
  check('a factor-1 object sees the camera unchanged',
    JSON.stringify(PX.parallaxCamera({ x: 200, y: 100, zoom: 1 }, { parallaxX: 1, parallaxY: 1 })) ===
    '{"x":200,"y":100,"zoom":1}');
  check('a pinned layer (0) sees the origin on that axis only',
    JSON.stringify(PX.parallaxCamera({ x: 200, y: 100, zoom: 1 }, { parallaxX: 0, parallaxY: 1 })) ===
    '{"x":0,"y":100,"zoom":1}');
  check('a foreground layer (2) sees double the camera',
    JSON.stringify(PX.parallaxCamera({ x: 200, y: 100, zoom: 1 }, { parallaxX: 2, parallaxY: 2 })) ===
    '{"x":400,"y":200,"zoom":1}');
  check('the axes are independent',
    JSON.stringify(PX.parallaxCamera({ x: 200, y: 100, zoom: 1 }, { parallaxX: 0.5, parallaxY: 0 })) ===
    '{"x":100,"y":0,"zoom":1}');
  check('the parallax camera is a fresh record (the host camera is never aliased)',
    (function () {
      const cam = { x: 200, y: 100, zoom: 1 };
      const pc = PX.parallaxCamera(cam, { parallaxX: 0.5, parallaxY: 0.5 });
      pc.x = 999;
      return cam.x === 200 && pc !== cam;
    })());
  check('a missing camera reads as the origin, a missing object reads the camera unchanged',
    JSON.stringify(PX.parallaxCamera(null, { parallaxX: 0.5, parallaxY: 0.5 })) === '{"x":0,"y":0,"zoom":1}' &&
    JSON.stringify(PX.parallaxCamera({ x: 200, y: 100, zoom: 1 }, null)) === '{"x":200,"y":100,"zoom":1}' &&
    JSON.stringify(PX.parallaxCamera({ x: 200, y: 100, zoom: 1 }, { name: 'hero' })) === '{"x":200,"y":100,"zoom":1}');
  check('hostile inputs degrade to safe cameras, never a throw',
    (function () {
      try {
        const c = PX.parallaxCamera('far', 'hills');
        return c && typeof c.x === 'number' && typeof c.y === 'number' && c.zoom === 1;
      } catch (e) { return false; }
    })());
}

// --- routing sets ---
{
  check('isParallaxAction covers Set Parallax and nothing else',
    PX.isParallaxAction('setParallax') === true &&
    PX.isParallaxAction('setCameraSmoothing') === false &&
    PX.isParallaxAction('parallaxFactor') === false);
  check('isParallaxCondition covers Parallax Factor and nothing else',
    PX.isParallaxCondition('parallaxFactor') === true &&
    PX.isParallaxCondition('cameraPosition') === false &&
    PX.isParallaxCondition('setParallax') === false);
}

// --- static wiring ---
{
  const html = fs.readFileSync(path.join(HYDRA, 'index.html'), 'utf8');
  const scriptJs = fs.readFileSync(path.join(HYDRA, 'script.js'), 'utf8');
  const playerJs = fs.readFileSync(path.join(HYDRA, 'player-runtime.js'), 'utf8');
  const previewJs = fs.readFileSync(path.join(HYDRA, 'hydra-previewruntime.js'), 'utf8');
  const conditionsJs = fs.readFileSync(path.join(HYDRA, 'hydra-conditions.js'), 'utf8');
  const executeJs = fs.readFileSync(path.join(HYDRA, 'hydra-execute.js'), 'utf8');
  const flowJs = fs.readFileSync(path.join(HYDRA, 'hydra-flow.js'), 'utf8');
  const universalJs = fs.readFileSync(path.join(HYDRA, 'hydra-universal.js'), 'utf8');
  const catalogJs = fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8');
  const drawJs = fs.readFileSync(path.join(HYDRA, 'hydra-draw.js'), 'utf8');
  const refMd = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');
  const guideMd = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');

  const pxTag = html.indexOf('src="hydra-parallax.js');
  check('index.html loads hydra-parallax.js before player-runtime.js and script.js',
    pxTag !== -1 && pxTag < html.indexOf('src="player-runtime.js') && pxTag < html.indexOf('src="script.js'));
  check('index.html loads hydra-parallax.js after hydra-camerafeel.js',
    pxTag !== -1 && html.indexOf('src="hydra-camerafeel.js') < pxTag);
  check('player-runtime.js hard-guards on HydraParallax',
    playerJs.includes('requires hydra-parallax.js (window.HydraParallax)'));
  check('player-runtime.js inlines HydraParallax into exports',
    playerJs.includes("'HydraParallax', global.HydraParallax && global.HydraParallax.factorySource"));
  check('player-runtime.js classifies parallax blocks for the dispatch',
    playerJs.includes('HydraParallax.isParallaxCondition(type)') &&
    playerJs.includes('HydraParallax.isParallaxAction(type)'));
  check('player-runtime.js routes parallax blocks through the shared modules',
    playerJs.includes('parallaxModule: HydraParallax') &&
    playerJs.includes('parallax: HydraParallax,'));
  check('player-runtime.js normalizes object parallax factors on export boot',
    playerJs.includes('HydraParallax.normalizeParallax(obj)'));
  check('preview runtime exposes the module to both dispatch contexts',
    previewJs.includes("parallaxModule: mod('Parallax')"));
  check('preview runtime hovers parallax buttons against their parallax camera',
    previewJs.includes('parallaxCamera(cam, obj)') &&
    previewJs.includes("mod('Parallax')"));
  check('shared draw module draws non-fixed objects against their parallax camera',
    drawJs.includes('parallaxCamera(cam, obj)') &&
    drawJs.includes('hooks.parallax') &&
    drawJs.includes('!isScreenFixed(obj, hooks.ui)'));
  check('shared conditions module evaluates Parallax Factor (and never freezes it while paused)',
    conditionsJs.includes("case 'parallaxFactor'") &&
    !/FROZEN_WHILE_PAUSED = \[[^\]]*'parallaxFactor'/.test(conditionsJs));
  check('shared conditions module hit-tests through the parallax camera',
    conditionsJs.includes('parallaxCamera(cam, obj)') &&
    conditionsJs.includes('ctx.parallaxModule'));
  check('shared execute module runs Set Parallax',
    executeJs.includes("if (isType(ctx.parallaxModule, 'isParallaxAction', type))") &&
    executeJs.includes("type === 'setParallax'"));
  check('flow treats Parallax Factor as a level read',
    flowJs.includes("t === 'parallaxFactor'"));
  check('universal normalizes the object parallax factors on load',
    universalJs.includes('window.HydraParallax.normalizeParallax(obj);'));
  check('catalog carries the two parallax blocks in the Camera category',
    catalogJs.includes("blockType: 'set-parallax'") &&
    catalogJs.includes("blockType: 'parallax-factor'") &&
    catalogJs.includes("runtimeType: 'setParallax'") &&
    catalogJs.includes("runtimeType: 'parallaxFactor'"));
  check('editor wires the Inspector Parallax section',
    scriptJs.includes('appendParallaxEditor') &&
    scriptJs.includes("title.textContent = 'Parallax'") &&
    scriptJs.includes('parallax: window.HydraParallax || null'));
  check('block reference documents both parallax blocks',
    refMd.includes('Set Parallax') && refMd.includes('Parallax Factor'));
  check('user guide covers parallax backgrounds',
    guideMd.includes('Parallax'));
}

process.exit(failures === 0 ? 0 : 1);
