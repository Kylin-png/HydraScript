// Unit tests for hydra/hydra-camerafeel.js — the shared camera feel
// (P4 Advanced batch 15: follow smoothing, deadzone, and camera
// bounds, beginner edition).
//
// Pure logic: config normalization (smoothing / deadzone / bounds),
// the fresh-copy rule for the run's live feel, the deadzone desire,
// the exponential smoothing glide, the bounds clamp (with the
// view-bigger-than-bounds centering), one frame of follow, the
// Camera Following read, and the action/condition routing sets.
// Nothing here touches the DOM; both runtimes delegate to this module.
// Static checks at the end pin the wiring: catalog blocks, both
// runtimes' dispatch and per-frame follow, the scene-reset hook, the
// editor Scene Settings fields, and the export inlining.

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
sandbox.window = sandbox; // hydra-camerafeel.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-camerafeel.js'), 'utf8'),
  sandbox, { filename: 'hydra-camerafeel.js' });
const CF = sandbox.HydraCameraFeel;

check('HydraCameraFeel exposed with helpers',
  !!CF && typeof CF.normalizeSmoothing === 'function' &&
  typeof CF.normalizeDeadzone === 'function' &&
  typeof CF.normalizeCameraBounds === 'function' &&
  typeof CF.normalizeCameraFeel === 'function' &&
  typeof CF.defaultCameraFeel === 'function' &&
  typeof CF.freshCameraFeel === 'function' &&
  typeof CF.desiredFollowCamera === 'function' &&
  typeof CF.smoothToward === 'function' &&
  typeof CF.clampCameraToBounds === 'function' &&
  typeof CF.updateFollowCamera === 'function' &&
  typeof CF.cameraFollowing === 'function' &&
  typeof CF.isCameraFeelAction === 'function' &&
  typeof CF.isCameraFeelCondition === 'function');
check('factorySource is a self-contained function string',
  typeof CF.factorySource === 'string' && CF.factorySource.includes('hydraCameraFeelFactory'));
check('constants are 0 smoothing default, 0.95 cap, 0 deadzone default',
  CF.DEFAULT_SMOOTHING === 0 && CF.MAX_SMOOTHING === 0.95 &&
  CF.DEFAULT_DEADZONE_W === 0 && CF.DEFAULT_DEADZONE_H === 0);

// --- value normalization ---
{
  check('normalizeSmoothing keeps 0 and 0.5, caps 1 and 2 at 0.95, floors negatives at 0',
    CF.normalizeSmoothing(0) === 0 && CF.normalizeSmoothing(0.5) === 0.5 &&
    CF.normalizeSmoothing(1) === 0.95 && CF.normalizeSmoothing(2) === 0.95 &&
    CF.normalizeSmoothing(-1) === 0);
  check('normalizeSmoothing reads non-numeric as 0 (a typo snaps, never freezes)',
    CF.normalizeSmoothing('fast') === 0 && CF.normalizeSmoothing(NaN) === 0 &&
    CF.normalizeSmoothing(undefined) === 0 && CF.normalizeSmoothing(null) === 0);
  check('normalizeDeadzone keeps 0 and 100, floors negatives at 0, reads junk as 0',
    CF.normalizeDeadzone(0) === 0 && CF.normalizeDeadzone(100) === 100 &&
    CF.normalizeDeadzone(-5) === 0 && CF.normalizeDeadzone('wide') === 0 &&
    CF.normalizeDeadzone(NaN) === 0);
  check('normalizeCameraBounds keeps a valid rectangle',
    JSON.stringify(CF.normalizeCameraBounds({ minX: 0, minY: 0, maxX: 800, maxY: 600 })) ===
    '{"minX":0,"minY":0,"maxX":800,"maxY":600}');
  check('normalizeCameraBounds reads backwards, partial, and junk rectangles as null',
    CF.normalizeCameraBounds({ minX: 800, minY: 0, maxX: 0, maxY: 600 }) === null &&
    CF.normalizeCameraBounds({ minX: 0, minY: 0, maxX: 800 }) === null &&
    CF.normalizeCameraBounds({ minX: 'a', minY: 0, maxX: 800, maxY: 600 }) === null &&
    CF.normalizeCameraBounds(null) === null && CF.normalizeCameraBounds('room') === null &&
    CF.normalizeCameraBounds([]) === null);
  check('a zero-size bounds rectangle is valid (a pinned camera)',
    JSON.stringify(CF.normalizeCameraBounds({ minX: 100, minY: 100, maxX: 100, maxY: 100 })) ===
    '{"minX":100,"minY":100,"maxX":100,"maxY":100}');
}

// --- config normalization + the fresh copy ---
{
  check('a missing config reads as the snap / no-deadzone / no-bounds default',
    JSON.stringify(CF.normalizeCameraFeel(undefined)) === '{"smoothing":0,"deadzoneW":0,"deadzoneH":0,"bounds":null}' &&
    JSON.stringify(CF.normalizeCameraFeel(null)) === '{"smoothing":0,"deadzoneW":0,"deadzoneH":0,"bounds":null}' &&
    JSON.stringify(CF.normalizeCameraFeel('smooth')) === '{"smoothing":0,"deadzoneW":0,"deadzoneH":0,"bounds":null}' &&
    JSON.stringify(CF.normalizeCameraFeel([])) === '{"smoothing":0,"deadzoneW":0,"deadzoneH":0,"bounds":null}');
  check('a plain config keeps its smoothing, deadzone, and bounds',
    JSON.stringify(CF.normalizeCameraFeel({ smoothing: 0.5, deadzoneW: 160, deadzoneH: 100, bounds: { minX: 0, minY: 0, maxX: 800, maxY: 600 } })) ===
    '{"smoothing":0.5,"deadzoneW":160,"deadzoneH":100,"bounds":{"minX":0,"minY":0,"maxX":800,"maxY":600}}');
  check('bad values fall back per field (smoothing 0, deadzone 0, bounds null)',
    JSON.stringify(CF.normalizeCameraFeel({ smoothing: 'fast', deadzoneW: -10, deadzoneH: 'tall', bounds: { minX: 9, minY: 0, maxX: 1, maxY: 2 } })) ===
    '{"smoothing":0,"deadzoneW":0,"deadzoneH":0,"bounds":null}');
  check('normalization is in place (the same object comes back)',
    (function () { const c = { smoothing: 0.5, deadzoneW: 10, deadzoneH: 10, bounds: null }; return CF.normalizeCameraFeel(c) === c; })());
  check('defaultCameraFeel returns a fresh default every call',
    (function () {
      const a = CF.defaultCameraFeel();
      const b = CF.defaultCameraFeel();
      return a !== b && a.smoothing === 0 && a.deadzoneW === 0 && a.deadzoneH === 0 && a.bounds === null;
    })());
  check('freshCameraFeel copies the config, sharing nothing mutable with it',
    (function () {
      const authored = { smoothing: 0.5, deadzoneW: 160, deadzoneH: 100, bounds: { minX: 0, minY: 0, maxX: 800, maxY: 600 } };
      const live = CF.freshCameraFeel(authored);
      live.smoothing = 0;
      live.bounds.maxX = 1;
      return authored.smoothing === 0.5 && authored.bounds.maxX === 800 &&
        live.smoothing === 0 && live.bounds.maxX === 1 && live !== authored && live.bounds !== authored.bounds;
    })());
  check('freshCameraFeel reads a missing config as the default',
    JSON.stringify(CF.freshCameraFeel(undefined)) === '{"smoothing":0,"deadzoneW":0,"deadzoneH":0,"bounds":null}');
}

// --- deadzone desire ---
{
  const vp = { width: 800, height: 600 };
  const plain = CF.normalizeCameraFeel(undefined);
  check('without a deadzone the camera centers the anchor',
    JSON.stringify(CF.desiredFollowCamera({ x: 0, y: 0 }, { x: 400, y: 300 }, vp, 1, plain)) === '{"x":0,"y":0}' &&
    JSON.stringify(CF.desiredFollowCamera({ x: 0, y: 0 }, { x: 500, y: 300 }, vp, 1, plain)) === '{"x":100,"y":0}');
  check('zoom shrinks the visible world, so the desired position accounts for it',
    JSON.stringify(CF.desiredFollowCamera({ x: 0, y: 0 }, { x: 400, y: 300 }, vp, 2, plain)) === '{"x":200,"y":150}');
  const zoned = CF.normalizeCameraFeel({ smoothing: 0, deadzoneW: 200, deadzoneH: 100, bounds: null });
  check('inside the deadzone the camera holds still on both axes',
    JSON.stringify(CF.desiredFollowCamera({ x: 0, y: 0 }, { x: 450, y: 320 }, vp, 1, zoned)) === '{"x":0,"y":0}');
  check('past the right edge the camera shifts just enough to bring the anchor to the edge',
    JSON.stringify(CF.desiredFollowCamera({ x: 0, y: 0 }, { x: 550, y: 300 }, vp, 1, zoned)) === '{"x":50,"y":0}');
  check('past the left edge the camera shifts the other way',
    JSON.stringify(CF.desiredFollowCamera({ x: 0, y: 0 }, { x: 250, y: 300 }, vp, 1, zoned)) === '{"x":-50,"y":0}');
  check('past the bottom edge the camera shifts down',
    JSON.stringify(CF.desiredFollowCamera({ x: 0, y: 0 }, { x: 400, y: 380 }, vp, 1, zoned)) === '{"x":0,"y":30}');
  check('the axes are independent: out on X, inside on Y',
    JSON.stringify(CF.desiredFollowCamera({ x: 0, y: 0 }, { x: 550, y: 320 }, vp, 1, zoned)) === '{"x":50,"y":0}');
  check('the deadzone follows the current view, not the world origin',
    JSON.stringify(CF.desiredFollowCamera({ x: 200, y: 100 }, { x: 650, y: 420 }, vp, 1, zoned)) === '{"x":200,"y":100}');
  check('a zero-wide zone degenerates to centering',
    JSON.stringify(CF.desiredFollowCamera({ x: 0, y: 0 }, { x: 500, y: 300 }, vp, 1, plain)) === '{"x":100,"y":0}');
  check('hostile inputs degrade to a centered desire, never a throw',
    (function () {
      try {
        const d = CF.desiredFollowCamera(null, null, null, 'zoom', null);
        return d && typeof d.x === 'number' && typeof d.y === 'number';
      } catch (e) { return false; }
    })());
}

// --- smoothing glide ---
{
  check('smoothing 0 snaps the whole remaining distance in one frame',
    CF.smoothToward(0, 100, 0, 1 / 60) === 100);
  check('smoothing 0.5 moves halfway per frame at 60fps',
    CF.smoothToward(0, 100, 0.5, 1 / 60) === 50);
  check('smoothing 0.9 moves 10% per frame at 60fps',
    Math.abs(CF.smoothToward(0, 100, 0.9, 1 / 60) - 10) < 0.0001);
  check('a double-length frame moves further (the glide follows the frame step)',
    Math.abs(CF.smoothToward(0, 100, 0.9, 2 / 60) - 19) < 0.0001);
  check('a zero or negative dt holds still',
    CF.smoothToward(50, 100, 0.9, 0) === 50 && CF.smoothToward(50, 100, 0.9, -1) === 50);
  check('smoothing above the cap clamps to 0.95, so the camera always creeps',
    Math.abs(CF.smoothToward(0, 100, 1, 1 / 60) - 5) < 0.0001 &&
    Math.abs(CF.smoothToward(0, 100, 99, 1 / 60) - 5) < 0.0001);
  check('the glide never overshoots the desired position',
    CF.smoothToward(90, 100, 0.5, 10) === 100 && CF.smoothToward(110, 100, 0.5, 10) === 100);
  check('hostile inputs degrade to safe numbers, never a throw',
    (function () {
      try {
        return CF.smoothToward('x', 100, 0.5, 1 / 60) === 50 &&
          CF.smoothToward(0, 'far', 0.5, 1 / 60) === 0 &&
          CF.smoothToward(0, 100, 'fast', 1 / 60) === 100 &&
          CF.smoothToward(0, 100, 0.5, 'soon') === 0;
      } catch (e) { return false; }
    })());
}

// --- bounds clamp ---
{
  const vp = { width: 800, height: 600 };
  check('inside the bounds the camera stays put',
    (function () {
      const cam = { x: 100, y: 100 };
      CF.clampCameraToBounds(cam, vp, 1, { minX: 0, minY: 0, maxX: 1600, maxY: 1200 }, null);
      return cam.x === 100 && cam.y === 100;
    })());
  check('past the right edge the camera clamps to maxX minus the view width',
    (function () {
      const cam = { x: 2000, y: 0 };
      CF.clampCameraToBounds(cam, vp, 1, { minX: 0, minY: 0, maxX: 1600, maxY: 1200 }, null);
      return cam.x === 800 && cam.y === 0;
    })());
  check('past the top-left the camera clamps to the min edges',
    (function () {
      const cam = { x: -50, y: -30 };
      CF.clampCameraToBounds(cam, vp, 1, { minX: 0, minY: 0, maxX: 1600, maxY: 1200 }, null);
      return cam.x === 0 && cam.y === 0;
    })());
  check('a view wider than the bounds centers on the bounds instead of jittering',
    (function () {
      const cam = { x: 0, y: 0 };
      CF.clampCameraToBounds(cam, vp, 1, { minX: 100, minY: 100, maxX: 500, maxY: 400 }, null);
      return cam.x === -100 && cam.y === -50;
    })());
  check('no bounds means the scene edges apply',
    (function () {
      const cam = { x: 100, y: 100 };
      CF.clampCameraToBounds(cam, vp, 1, null, { width: 800, height: 600 });
      return cam.x === 0 && cam.y === 0;
    })());
  check('no bounds and no scene size leaves the camera alone',
    (function () {
      const cam = { x: 100, y: 100 };
      CF.clampCameraToBounds(cam, vp, 1, null, null);
      return cam.x === 100 && cam.y === 100;
    })());
  check('zoom shrinks the view, so the clamp uses the zoomed view size',
    (function () {
      const cam = { x: 2000, y: 0 };
      CF.clampCameraToBounds(cam, vp, 2, { minX: 0, minY: 0, maxX: 1600, maxY: 1200 }, null);
      return cam.x === 1200 && cam.y === 0;
    })());
  check('hostile inputs are a quiet no-op, never a throw',
    (function () {
      try {
        return CF.clampCameraToBounds(null, vp, 1, { minX: 0, minY: 0, maxX: 800, maxY: 600 }, null) === null &&
          CF.clampCameraToBounds({ x: 5, y: 5 }, null, 1, { minX: 0, minY: 0, maxX: 800, maxY: 600 }, null).x === 5;
      } catch (e) { return false; }
    })());
}

// --- one frame of follow ---
{
  const vp = { width: 800, height: 600 };
  const big = { width: 1600, height: 1200 };
  check('the default feel snaps to center, like the old follow',
    (function () {
      const cam = { x: 0, y: 0, zoom: 1, followTarget: 'hero', offsetX: 0, offsetY: 0 };
      CF.updateFollowCamera(cam, { x: 500, y: 300 }, vp, 1, null, 1 / 60, big);
      return cam.x === 100 && cam.y === 0;
    })());
  check('smoothing 0.5 glides halfway per frame toward the centered desire',
    (function () {
      const cam = { x: 0, y: 0, zoom: 1, followTarget: 'hero', offsetX: 0, offsetY: 0 };
      const feel = CF.normalizeCameraFeel({ smoothing: 0.5, deadzoneW: 0, deadzoneH: 0, bounds: null });
      CF.updateFollowCamera(cam, { x: 500, y: 300 }, vp, 1, feel, 1 / 60, big);
      const first = cam.x;
      CF.updateFollowCamera(cam, { x: 500, y: 300 }, vp, 1, feel, 1 / 60, big);
      return first === 50 && cam.x === 75;
    })());
  check('a deadzone holds the camera while the anchor stays inside it',
    (function () {
      const cam = { x: 0, y: 0, zoom: 1, followTarget: 'hero', offsetX: 0, offsetY: 0 };
      const feel = CF.normalizeCameraFeel({ smoothing: 0, deadzoneW: 200, deadzoneH: 100, bounds: null });
      CF.updateFollowCamera(cam, { x: 450, y: 320 }, vp, 1, feel, 1 / 60, big);
      return cam.x === 0 && cam.y === 0;
    })());
  check('bounds clamp the glide at the room edge',
    (function () {
      const cam = { x: 0, y: 0, zoom: 1, followTarget: 'hero', offsetX: 0, offsetY: 0 };
      const feel = CF.normalizeCameraFeel({ smoothing: 0, deadzoneW: 0, deadzoneH: 0, bounds: { minX: 0, minY: 0, maxX: 1600, maxY: 1200 } });
      CF.updateFollowCamera(cam, { x: 1500, y: 300 }, vp, 1, feel, 1 / 60, big);
      return cam.x === 800 && cam.y === 0;
    })());
  check('the follow respects the zoom when centering',
    (function () {
      const cam = { x: 0, y: 0, zoom: 2, followTarget: 'hero', offsetX: 0, offsetY: 0 };
      CF.updateFollowCamera(cam, { x: 400, y: 300 }, vp, 2, null, 1 / 60, big);
      return cam.x === 200 && cam.y === 150;
    })());
  check('a zero dt holds the camera still even with smoothing',
    (function () {
      const cam = { x: 0, y: 0, zoom: 1, followTarget: 'hero', offsetX: 0, offsetY: 0 };
      const feel = CF.normalizeCameraFeel({ smoothing: 0.9, deadzoneW: 0, deadzoneH: 0, bounds: null });
      CF.updateFollowCamera(cam, { x: 500, y: 300 }, vp, 1, feel, 0, big);
      return cam.x === 0 && cam.y === 0;
    })());
  check('updateFollowCamera mutates the camera in place and returns it',
    (function () {
      const cam = { x: 0, y: 0, zoom: 1, followTarget: 'hero', offsetX: 0, offsetY: 0 };
      return CF.updateFollowCamera(cam, { x: 500, y: 300 }, vp, 1, null, 1 / 60, big) === cam;
    })());
  check('a missing camera is a quiet no-op, never a throw',
    (function () {
      try { return CF.updateFollowCamera(null, { x: 500, y: 300 }, vp, 1, null, 1 / 60, big) === null; }
      catch (e) { return false; }
    })());
}

// --- Camera Following read + routing sets ---
{
  check('cameraFollowing is true with a follow target, false without one',
    CF.cameraFollowing({ followTarget: 'hero' }) === true &&
    CF.cameraFollowing({ followTarget: '' }) === false &&
    CF.cameraFollowing({ followTarget: '   ' }) === false &&
    CF.cameraFollowing({}) === false &&
    CF.cameraFollowing(null) === false &&
    CF.cameraFollowing('hero') === false);
  check('isCameraFeelAction covers the four actions and nothing else',
    CF.isCameraFeelAction('setCameraSmoothing') === true &&
    CF.isCameraFeelAction('setCameraDeadzone') === true &&
    CF.isCameraFeelAction('setCameraBounds') === true &&
    CF.isCameraFeelAction('clearCameraBounds') === true &&
    CF.isCameraFeelAction('setCameraZoom') === false &&
    CF.isCameraFeelAction('followCamera') === false &&
    CF.isCameraFeelAction('cameraFollowing') === false);
  check('isCameraFeelCondition covers Camera Following and nothing else',
    CF.isCameraFeelCondition('cameraFollowing') === true &&
    CF.isCameraFeelCondition('cameraPosition') === false &&
    CF.isCameraFeelCondition('setCameraSmoothing') === false);
}

// --- static wiring ---
{
  const html = fs.readFileSync(path.join(HYDRA, 'index.html'), 'utf8');
  const scriptJs = fs.readFileSync(path.join(HYDRA, 'script.js'), 'utf8');
  const stageJs = fs.readFileSync(path.join(HYDRA, 'hydra-stage.js'), 'utf8');
  const playerJs = fs.readFileSync(path.join(HYDRA, 'player-runtime.js'), 'utf8');
  const previewJs = fs.readFileSync(path.join(HYDRA, 'hydra-previewruntime.js'), 'utf8');
  const conditionsJs = fs.readFileSync(path.join(HYDRA, 'hydra-conditions.js'), 'utf8');
  const executeJs = fs.readFileSync(path.join(HYDRA, 'hydra-execute.js'), 'utf8');
  const flowJs = fs.readFileSync(path.join(HYDRA, 'hydra-flow.js'), 'utf8');
  const universalJs = fs.readFileSync(path.join(HYDRA, 'hydra-universal.js'), 'utf8');
  const catalogJs = fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8');
  const sceneResetJs = fs.readFileSync(path.join(HYDRA, 'hydra-scenereset.js'), 'utf8');
  const refMd = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');
  const guideMd = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');

  const cfTag = html.indexOf('src="hydra-camerafeel.js');
  check('index.html loads hydra-camerafeel.js before player-runtime.js and script.js',
    cfTag !== -1 && cfTag < html.indexOf('src="player-runtime.js') && cfTag < html.indexOf('src="script.js'));
  check('index.html loads hydra-camerafeel.js after hydra-transition.js',
    cfTag !== -1 && html.indexOf('src="hydra-transition.js') < cfTag);
  check('index.html has the Scene Settings camera-feel fields',
    html.includes('id="scene-camera-feel-wrap"') && html.includes('id="scene-cam-smoothing"') &&
    html.includes('id="scene-cam-deadzone-w"') && html.includes('id="scene-cam-deadzone-h"') &&
    html.includes('id="scene-cam-bounds-minx"') && html.includes('id="scene-cam-bounds-miny"') &&
    html.includes('id="scene-cam-bounds-maxx"') && html.includes('id="scene-cam-bounds-maxy"') &&
    html.includes('id="scene-cam-bounds-clear-btn"'));
  check('player-runtime.js hard-guards on HydraCameraFeel',
    playerJs.includes('requires hydra-camerafeel.js (window.HydraCameraFeel)'));
  check('player-runtime.js inlines HydraCameraFeel into exports',
    playerJs.includes("'HydraCameraFeel', global.HydraCameraFeel && global.HydraCameraFeel.factorySource"));
  check('player-runtime.js loads a fresh feel copy on every scene load',
    playerJs.includes('cameraFeelOf: (sc) => HydraCameraFeel.freshCameraFeel(sc ? sc.cameraFeel : null),'));
  check('player-runtime.js follows through the shared module',
    playerJs.includes('HydraCameraFeel.updateFollowCamera(state.camera,'));
  check('player-runtime.js classifies camera-feel blocks for the dispatch',
    playerJs.includes('HydraCameraFeel.isCameraFeelCondition(type)') &&
    playerJs.includes('HydraCameraFeel.isCameraFeelAction(type)'));
  check('player-runtime.js routes camera-feel blocks through the shared modules',
    playerJs.includes('cameraFeelModule: HydraCameraFeel') &&
    playerJs.includes('cameraFeel: function () { return state.cameraFeel || null; }') &&
    playerJs.includes('resetCameraFeel: function () {'));
  check('scene reset copies the feel per scene load (cameraFeelOf hook)',
    sceneResetJs.includes('cameraFeelOf') &&
    sceneResetJs.includes('state.cameraFeel = (typeof h.cameraFeelOf === \'function\') ? h.cameraFeelOf(scene) : null;'));
  check('preview runtime follows through the shared module (with the snap fallback)',
    previewJs.includes('CF.updateFollowCamera(camera,') &&
    previewJs.includes("mod('CameraFeel')"));
  check('preview runtime loads a fresh feel copy on every scene load',
    previewJs.includes('cameraFeelOf: function (scene)') &&
    previewJs.includes('CF.freshCameraFeel(scene ? scene.cameraFeel : null)'));
  check('preview runtime exposes the feel to the execute module',
    previewJs.includes('cameraFeelModule: mod(') &&
    previewJs.includes('cameraFeel: function () {'));
  check('shared conditions module evaluates Camera Following (and never freezes it while paused)',
    conditionsJs.includes("case 'cameraFollowing'") &&
    !/FROZEN_WHILE_PAUSED = \[[^\]]*'cameraFollowing'/.test(conditionsJs));
  check('shared execute module runs the four camera-feel actions',
    executeJs.includes("if (isType(ctx.cameraFeelModule, 'isCameraFeelAction', type))") &&
    executeJs.includes("type === 'setCameraSmoothing'") &&
    executeJs.includes("type === 'setCameraDeadzone'") &&
    executeJs.includes("type === 'setCameraBounds'") &&
    executeJs.includes("type === 'clearCameraBounds'"));
  check('shared execute module restores the feel on Reset Camera',
    executeJs.includes('resetCameraFeel'));
  check('flow treats Camera Following as a level read',
    flowJs.includes("t === 'cameraFollowing'"));
  check('universal normalizes the scene cameraFeel on load',
    universalJs.includes('scene.cameraFeel = window.HydraCameraFeel.normalizeCameraFeel(scene.cameraFeel);'));
  check('catalog carries the five camera-feel blocks in the Camera category',
    catalogJs.includes("blockType: 'set-camera-smoothing'") &&
    catalogJs.includes("blockType: 'set-camera-deadzone'") &&
    catalogJs.includes("blockType: 'set-camera-bounds'") &&
    catalogJs.includes("blockType: 'clear-camera-bounds'") &&
    catalogJs.includes("blockType: 'camera-following'") &&
    catalogJs.includes("runtimeType: 'setCameraSmoothing'") &&
    catalogJs.includes("runtimeType: 'setCameraDeadzone'") &&
    catalogJs.includes("runtimeType: 'setCameraBounds'") &&
    catalogJs.includes("runtimeType: 'clearCameraBounds'") &&
    catalogJs.includes("runtimeType: 'cameraFollowing'"));
  check('stage module syncs the Scene Settings camera-feel fields',
    stageJs.includes('syncSceneCameraFeelFields') &&
    stageJs.includes('onSceneCameraFeelInput'));
  check('editor wires the Scene Settings camera-feel fields + clear button',
    scriptJs.includes('scene-cam-smoothing') &&
    scriptJs.includes('scene-cam-bounds-clear-btn') &&
    scriptJs.includes('syncSceneCameraFeelFields()'));
  check('block reference documents all five camera-feel blocks',
    refMd.includes('Set Camera Smoothing') && refMd.includes('Set Camera Deadzone') &&
    refMd.includes('Set Camera Bounds') && refMd.includes('Clear Camera Bounds') &&
    refMd.includes('Camera Following'));
  check('user guide covers camera feel',
    guideMd.includes('Camera feel'));
}

process.exit(failures === 0 ? 0 : 1);
