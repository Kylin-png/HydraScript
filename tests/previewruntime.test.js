// Unit tests for hydra/hydra-previewruntime.js — the preview runtime
// host (P2 item 14, slices 6-8: keyboard / mouse / touch / gamepad
// input state and wiring as a DOM module, the script-grid dispatch host
// — processScriptGrid, dispatchHooks, the condition/action context
// builders with their subsystem hook builders, the per-frame context
// bookkeeping, the gameStart launch path, and the warn-once helpers —
// plus the frame loop and the run lifecycle — gameLoop, launchPreview /
// loadPreviewScene / resetGame, the camera-follow and UI-widget phases,
// and the physics-step / scene-reset hook builders).
//
// The module owns the input state that used to be the script.js
// `mouseButtons` / `keysPressed` / `previewGamepad*` /
// `previewMouseDelta` / `previewLastClient` lets, the document key
// listeners, the canvas mouse/touch handlers, the per-frame gamepad
// poll, and the per-frame / per-launch / per-run input resets, the
// dispatch host that used to be the script.js processScriptGrid /
// dispatchHooks / conditionCtx / actionCtx code and its helpers, and
// the frame loop + run lifecycle that used to be the script.js
// gameLoop / launchPreview / loadPreviewScene / resetGame code and its
// helpers (including the loop's running flag, rAF handle, and last-frame
// time, which used to be script.js lets).
// script.js aliases the state's Set fields and keeps thin delegations,
// so the condition/action contexts and the game loop read the same
// objects; the module always mutates those Sets in place, never
// replacing them. The node tests drive it through a vm sandbox with a
// fake document/canvas, following tests/previewtoolbar.test.js.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}
function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected),
    `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function noThrow(name, fn) {
  try { fn(); check(name, true); }
  catch (e) { check(name, false, String(e && e.message || e)); }
}

const MODULE_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'hydra', 'hydra-previewruntime.js'), 'utf8');
const SCRIPT_JS = fs.readFileSync(
  path.join(__dirname, '..', 'hydra', 'script.js'), 'utf8');
const INDEX_HTML = fs.readFileSync(
  path.join(__dirname, '..', 'hydra', 'index.html'), 'utf8');
const factory = require(path.join(__dirname, '..', 'hydra', 'hydra-previewruntime.js'));
const Dlg = require(path.join(__dirname, '..', 'hydra', 'hydra-dialogue.js'))();
const Inv = require(path.join(__dirname, '..', 'hydra', 'hydra-inventory.js'))();
const Qst = require(path.join(__dirname, '..', 'hydra', 'hydra-quest.js'))();
const Ach = require(path.join(__dirname, '..', 'hydra', 'hydra-achievement.js'))();
const Cut = require(path.join(__dirname, '..', 'hydra', 'hydra-cutscene.js'))();
const HS = require(path.join(__dirname, '..', 'hydra', 'hydra-highscore.js'))();
const TS = require(path.join(__dirname, '..', 'hydra', 'hydra-timescale.js'))();
const TR = require(path.join(__dirname, '..', 'hydra', 'hydra-transition.js'))();
const Flow = require(path.join(__dirname, '..', 'hydra', 'hydra-flow.js'))();
const CF = require(path.join(__dirname, '..', 'hydra', 'hydra-camerafeel.js'))();
const PX = require(path.join(__dirname, '..', 'hydra', 'hydra-parallax.js'))();
const SA = require(path.join(__dirname, '..', 'hydra', 'hydra-spatialaudio.js'))();
const PF = require(path.join(__dirname, '..', 'hydra', 'hydra-pathfind.js'))();
const AI = require(path.join(__dirname, '..', 'hydra', 'hydra-ai.js'))();
const J = require(path.join(__dirname, '..', 'hydra', 'hydra-joystick.js'))();
const HP = require(path.join(__dirname, '..', 'hydra', 'hydra-health.js'))();
const DF = require(path.join(__dirname, '..', 'hydra', 'hydra-damagefx.js'))();
const RM = require(path.join(__dirname, '..', 'hydra', 'hydra-respawn.js'))();
const SP = require(path.join(__dirname, '..', 'hydra', 'hydra-spawn.js'))();
const LV = require(path.join(__dirname, '..', 'hydra', 'hydra-lives.js'))();
const MV = require(path.join(__dirname, '..', 'hydra', 'hydra-movement.js'))();
const PL = require(path.join(__dirname, '..', 'hydra', 'hydra-platform.js'))();
const CB = require(path.join(__dirname, '..', 'hydra', 'hydra-combat.js'))();
const XP = require(path.join(__dirname, '..', 'hydra', 'hydra-xp.js'))();
const GR = require(path.join(__dirname, '..', 'hydra', 'hydra-growth.js'))();
const SC = require(path.join(__dirname, '..', 'hydra', 'hydra-scaling.js'))();
const BO = require(path.join(__dirname, '..', 'hydra', 'hydra-boss.js'))();
const TG = require(path.join(__dirname, '..', 'hydra', 'hydra-tags.js'))();
const MM = require(path.join(__dirname, '..', 'hydra', 'hydra-minimap.js'))();
const AT = require(path.join(__dirname, '..', 'hydra', 'hydra-attach.js'))();
const VV = require(path.join(__dirname, '..', 'hydra', 'hydra-variables.js'))();
const FF = require(path.join(__dirname, '..', 'hydra', 'hydra-functions.js'))();

// --- fake DOM ---------------------------------------------------------
function makeFakeCanvas() {
  return {
    width: 800,
    height: 600,
    _rect: { left: 10, top: 20, width: 200, height: 100 },
    getBoundingClientRect() { return this._rect; },
    onmousemove: null, onmousedown: null, onmouseup: null, oncontextmenu: null,
    ontouchstart: null, ontouchmove: null, ontouchend: null, ontouchcancel: null
  };
}

function makeFakeDocument() {
  const doc = {
    _listeners: {},
    pointerLockElement: null,
    addEventListener(type, fn) {
      (this._listeners[type] = this._listeners[type] || []).push(fn);
    },
    fire(type, event) {
      (this._listeners[type] || []).forEach(fn => fn(event));
    }
  };
  return doc;
}

function loadInSandbox(extra) {
  const sandbox = {};
  sandbox.window = sandbox; // the module assigns to bare `window`
  if (extra) Object.assign(sandbox, extra);
  vm.createContext(sandbox);
  vm.runInContext(MODULE_SRC, sandbox, { filename: 'hydra-previewruntime.js' });
  return sandbox;
}

function setOf(s) { return [...s].sort(); }

// --- surface + factorySource ------------------------------------------
{
  const T = factory();
  check('module exposes the preview runtime input surface',
    typeof T.configure === 'function' && typeof T.createInputState === 'function' &&
    typeof T.normalizeKeyName === 'function' && typeof T.keyNameAliases === 'function' &&
    typeof T.keySetHas === 'function' && typeof T.getEventKeyAliases === 'function' &&
    typeof T.updateMouse === 'function' && typeof T.pressMouseButton === 'function' &&
    typeof T.releaseMouseButton === 'function' && typeof T.updateTouch === 'function' &&
    typeof T.attachCanvasInput === 'function' && typeof T.attachKeyboardInput === 'function' &&
    typeof T.clearEdges === 'function' && typeof T.clearForLaunch === 'function' &&
    typeof T.resetRunInput === 'function' && typeof T.pollGamepad === 'function');
  const viaVm = loadInSandbox();
  check('vm instance exposes the same surface via window.HydraPreviewRuntime',
    !!viaVm.HydraPreviewRuntime && typeof viaVm.HydraPreviewRuntime.createInputState === 'function');
  check('factorySource is a self-contained function string',
    typeof viaVm.HydraPreviewRuntime.factorySource === 'string' &&
    viaVm.HydraPreviewRuntime.factorySource.includes('hydraPreviewRuntimeFactory'));
  const a = factory(), b = factory();
  const sa = a.createInputState(), sb = b.createInputState();
  sa.keysPressed.add('ArrowRight');
  check('factory instances hold independent input state',
    sa.keysPressed.has('ArrowRight') && !sb.keysPressed.has('ArrowRight'));
  const stubInput = { normalizeKeyName: (k) => 'stub:' + String(k).trim() };
  a.configure({ getHydraInput: () => stubInput });
  check('configure on one instance does not affect another',
    a.normalizeKeyName('  X ') === 'stub:X' && b.normalizeKeyName('  X ') === 'X');
}

// --- createInputState ---------------------------------------------------
{
  const T = factory();
  const s = T.createInputState();
  check('fresh state starts empty (sets, mouse, touch, gamepad, deltas)',
    s.mouse.x === 0 && s.mouse.y === 0 &&
    s.mouseButtons.size === 0 && s.mouseJustPressed.size === 0 && s.mouseJustReleased.size === 0 &&
    s.keysPressed.size === 0 && s.keysJustPressed.size === 0 && s.keysJustReleased.size === 0 &&
    s.touchZones.size === 0 && s.touchCount === 0 &&
    s.gamepadButtons.size === 0 && s.gamepadPrev.size === 0 &&
    s.gamepadJustPressed.size === 0 && s.gamepadJustReleased.size === 0 &&
    s.gamepadAxes.lx === 0 && s.gamepadAxes.ly === 0 && s.gamepadAxes.rx === 0 && s.gamepadAxes.ry === 0 &&
    s.gamepadConnected === false && s.mouseDelta.x === 0 && s.mouseDelta.y === 0 &&
    s.lastClient === null);
  const s2 = T.createInputState();
  s2.mouse.x = 99;
  check('two states from one factory are independent',
    s.mouse.x === 0 && s2.mouse.x === 99 && s.mouseButtons !== s2.mouseButtons);
}

// --- key helpers --------------------------------------------------------
{
  const T = factory();
  const stub = {
    normalizeKeyName: (k) => 'stub:' + String(k).trim().toLowerCase(),
    keyNameAliases: () => ['a', 'A'],
    keySetHas: (set) => set.has('a')
  };
  T.configure({ getHydraInput: () => stub });
  check('normalizeKeyName delegates to the HydraInput provider',
    T.normalizeKeyName('  X ') === 'stub:x');
  eq('keyNameAliases delegates to the HydraInput provider', T.keyNameAliases('a'), ['a', 'A']);
  check('keySetHas delegates to the HydraInput provider',
    T.keySetHas(new Set(['a']), 'A') === true && T.keySetHas(new Set(['b']), 'A') === false);

  const T2 = factory();
  T2.configure({ getHydraInput: () => { throw new Error('boom'); } });
  check('throwing HydraInput provider degrades to the trim fallback',
    T2.normalizeKeyName('  ArrowRight ') === 'ArrowRight' &&
    JSON.stringify(T2.keyNameAliases('a')) === JSON.stringify(['a']) &&
    T2.keySetHas(new Set(['a']), ' a ') === true);

  const T3 = factory();
  check('no provider falls back to trimmed key names',
    T3.normalizeKeyName('  ArrowRight ') === 'ArrowRight' &&
    JSON.stringify(T3.keyNameAliases('a')) === JSON.stringify(['a']) &&
    T3.keySetHas(new Set(['a']), ' a ') === true &&
    T3.keySetHas(new Set(['a']), 'b') === false &&
    T3.keySetHas(null, 'a') === false);

  eq('getEventKeyAliases collects key + code',
    T3.getEventKeyAliases({ key: 'a', code: 'KeyA' }), ['a', 'KeyA']);
  eq('getEventKeyAliases maps a space key to Space (deduped)',
    T3.getEventKeyAliases({ key: ' ', code: 'Space' }), [' ', 'Space']);
  eq('getEventKeyAliases keeps a bare Space key',
    T3.getEventKeyAliases({ key: 'Space', code: '' }), ['Space']);
  eq('getEventKeyAliases with no event or no fields is empty',
    [T3.getEventKeyAliases(null), T3.getEventKeyAliases(undefined), T3.getEventKeyAliases({})]
      .map(a => a.length), [0, 0, 0]);
}

// --- updateMouse ----------------------------------------------------------
{
  const T = factory();
  const doc = makeFakeDocument();
  const canvas = makeFakeCanvas();
  const s = T.createInputState();
  const mouseBefore = s.mouse;
  T.updateMouse(s, { clientX: 110, clientY: 70 }, canvas, doc);
  eq('updateMouse maps client coords into canvas pixels', [s.mouse.x, s.mouse.y], [400, 300]);
  check('updateMouse mutates the mouse object in place (alias stays valid)',
    s.mouse === mouseBefore);
  check('first move with no last client leaves the delta at zero and records the client',
    s.mouseDelta.x === 0 && s.mouseDelta.y === 0 &&
    s.lastClient && s.lastClient.x === 110 && s.lastClient.y === 70);
  T.updateMouse(s, { clientX: 120, clientY: 75 }, canvas, doc);
  eq('cursor travel accumulates the mouse delta', [s.mouseDelta.x, s.mouseDelta.y], [10, 5]);
  doc.pointerLockElement = canvas;
  T.updateMouse(s, { clientX: 130, clientY: 80, movementX: 5, movementY: -3 }, canvas, doc);
  eq('pointer lock uses raw movement deltas', [s.mouseDelta.x, s.mouseDelta.y], [15, 2]);
  const frozen = Object.freeze(T.createInputState());
  noThrow('updateMouse with a frozen state does not throw', () => {
    T.updateMouse(frozen, { clientX: 50, clientY: 50 }, canvas, doc);
  });
  const zeroCanvas = makeFakeCanvas();
  zeroCanvas._rect = { left: 0, top: 0, width: 0, height: 0 };
  const s2 = T.createInputState();
  T.updateMouse(s2, { clientX: 50, clientY: 50 }, zeroCanvas, doc);
  check('zero-size canvas rect leaves the mouse unchanged',
    s2.mouse.x === 0 && s2.mouse.y === 0);
  noThrow('updateMouse with missing state/event/canvas does not throw', () => {
    T.updateMouse(null, { clientX: 1, clientY: 1 }, canvas, doc);
    T.updateMouse(s, null, canvas, doc);
    T.updateMouse(s, { clientX: 1, clientY: 1 }, null, doc);
  });
}

// --- press / release mouse button ----------------------------------------
{
  const T = factory();
  const s = T.createInputState();
  T.pressMouseButton(s, 0);
  check('press records the held button and the just-pressed edge',
    s.mouseButtons.has(0) && s.mouseJustPressed.has(0));
  T.pressMouseButton(s, 0);
  check('a repeated press does not duplicate the edge', s.mouseJustPressed.size === 1);
  T.releaseMouseButton(s, 0);
  check('release records the just-released edge and clears the hold',
    s.mouseJustReleased.has(0) && !s.mouseButtons.has(0));
  T.releaseMouseButton(s, 2);
  check('releasing an unheld button adds no edge', !s.mouseJustReleased.has(2));
  noThrow('press/release with no state does not throw', () => {
    T.pressMouseButton(null, 0);
    T.releaseMouseButton(null, 0);
  });
}

// --- updateTouch -----------------------------------------------------------
{
  const T = factory();
  const canvas = makeFakeCanvas();
  const seen = [];
  const zonesAt = (x, y, w, h) => {
    seen.push([x, y, w, h]);
    return x < 400 ? ['left'] : ['right'];
  };
  const s = T.createInputState();
  T.updateTouch(s, {
    touches: [
      { clientX: 60, clientY: 45 },
      { clientX: 160, clientY: 45 }
    ]
  }, canvas, zonesAt);
  check('updateTouch sets the raw touch count', s.touchCount === 2);
  eq('updateTouch maps touches into canvas pixels for the zone lookup',
    seen, [[200, 150, 800, 600], [600, 150, 800, 600]]);
  eq('updateTouch collects zones from every touch', setOf(s.touchZones), ['left', 'right']);
  const s2 = T.createInputState();
  T.updateTouch(s2, { touches: [{ clientX: 60, clientY: 45 }] }, canvas, null);
  check('updateTouch with no zonesAt still sets the count and leaves zones empty',
    s2.touchCount === 1 && s2.touchZones.size === 0);
  const s3 = T.createInputState();
  T.updateTouch(s3, {}, canvas, zonesAt);
  check('updateTouch with no touches reads a count of zero', s3.touchCount === 0);
  const s4 = T.createInputState();
  T.updateTouch(s4, { touches: [{ clientX: 60, clientY: 45 }] }, canvas, () => { throw new Error('boom'); });
  check('throwing zonesAt degrades to empty zones instead of breaking the handler',
    s4.touchCount === 1 && s4.touchZones.size === 0);
  const s5 = T.createInputState();
  T.updateTouch(s5, { touches: [null, { clientX: 160, clientY: 45 }] }, canvas, zonesAt);
  check('a null touch entry is skipped', s5.touchCount === 2 && setOf(s5.touchZones).join() === 'right');
  noThrow('updateTouch with missing state/event does not throw', () => {
    T.updateTouch(null, { touches: [] }, canvas, zonesAt);
    T.updateTouch(s, null, canvas, zonesAt);
  });
}

// --- attachCanvasInput -----------------------------------------------------
{
  const T = factory();
  const doc = makeFakeDocument();
  const canvas = makeFakeCanvas();
  const s = T.createInputState();
  const zonesAt = (x) => (x < 400 ? ['left'] : ['right']);
  T.attachCanvasInput(doc, canvas, s, zonesAt);
  check('attachCanvasInput assigns all mouse + touch handlers',
    typeof canvas.onmousemove === 'function' && typeof canvas.onmousedown === 'function' &&
    typeof canvas.onmouseup === 'function' && typeof canvas.oncontextmenu === 'function' &&
    typeof canvas.ontouchstart === 'function' && typeof canvas.ontouchmove === 'function' &&
    typeof canvas.ontouchend === 'function' && typeof canvas.ontouchcancel === 'function');
  canvas.onmousedown({ clientX: 110, clientY: 70, button: 0 });
  check('canvas mousedown tracks the mouse and presses the button',
    s.mouse.x === 400 && s.mouse.y === 300 && s.mouseButtons.has(0) && s.mouseJustPressed.has(0));
  canvas.onmousedown({ clientX: 110, clientY: 70, button: 0 });
  check('a repeated mousedown does not duplicate the edge', s.mouseJustPressed.size === 1);
  canvas.onmouseup({ clientX: 110, clientY: 70, button: 0 });
  check('canvas mouseup releases the button with an edge',
    !s.mouseButtons.has(0) && s.mouseJustReleased.has(0));
  let prevented = 0;
  canvas.oncontextmenu({ preventDefault() { prevented++; } });
  check('canvas contextmenu is prevented', prevented === 1);
  canvas.ontouchstart({
    preventDefault() { prevented++; },
    touches: [{ clientX: 60, clientY: 45 }]
  });
  check('canvas touch handler prevents default and routes the touch',
    prevented === 2 && s.touchCount === 1 && s.touchZones.has('left'));
  T.attachCanvasInput(doc, canvas, s, zonesAt);
  canvas.onmousedown({ clientX: 110, clientY: 70, button: 0 });
  check('re-attaching replaces the handlers instead of stacking them',
    s.mouseButtons.size === 1 && s.mouseJustPressed.size === 1);
  noThrow('attachCanvasInput with no canvas or state does not throw', () => {
    T.attachCanvasInput(doc, null, s, zonesAt);
    T.attachCanvasInput(doc, canvas, null, zonesAt);
  });
}

// --- attachKeyboardInput ---------------------------------------------------
{
  const T = factory();
  const doc = makeFakeDocument();
  const s = T.createInputState();
  T.attachKeyboardInput(doc, s);
  doc.fire('keydown', { key: 'ArrowRight', code: 'ArrowRight' });
  check('keydown records the held key and the just-pressed edge',
    s.keysPressed.has('ArrowRight') && s.keysJustPressed.has('ArrowRight'));
  doc.fire('keydown', { key: 'ArrowRight', code: 'ArrowRight' });
  check('a held key does not re-add the just-pressed edge',
    s.keysPressed.size === 1 && s.keysJustPressed.size === 1);
  doc.fire('keyup', { key: 'ArrowRight', code: 'ArrowRight' });
  check('keyup records the just-released edge and clears the hold',
    s.keysJustReleased.has('ArrowRight') && !s.keysPressed.has('ArrowRight'));
  doc.fire('keydown', { key: ' ', code: 'Space' });
  check('a space keydown records both the space and Space aliases',
    s.keysPressed.has(' ') && s.keysPressed.has('Space'));
  noThrow('keydown with a null event does not throw', () => doc.fire('keydown', null));
  noThrow('attachKeyboardInput with no document or no listener support does not throw', () => {
    T.attachKeyboardInput(null, s);
    T.attachKeyboardInput({}, s);
  });
}

// --- clearEdges / clearForLaunch / resetRunInput ---------------------------
{
  const T = factory();
  const s = T.createInputState();
  s.keysPressed.add('a');
  s.keysJustPressed.add('a');
  s.keysJustReleased.add('b');
  s.mouseButtons.add(0);
  s.mouseJustPressed.add(0);
  s.mouseJustReleased.add(1);
  s.mouseDelta.x = 3; s.mouseDelta.y = 4;
  s.touchZones.add('left');
  T.clearEdges(s);
  check('clearEdges clears only the edge sets and the mouse delta',
    s.keysJustPressed.size === 0 && s.keysJustReleased.size === 0 &&
    s.mouseJustPressed.size === 0 && s.mouseJustReleased.size === 0 &&
    s.mouseDelta.x === 0 && s.mouseDelta.y === 0 &&
    s.keysPressed.has('a') && s.mouseButtons.has(0) && s.touchZones.has('left'));
  T.clearForLaunch(s);
  check('clearForLaunch clears held buttons, edges, and touch zones but keeps held keys',
    s.mouseButtons.size === 0 && s.mouseJustPressed.size === 0 && s.mouseJustReleased.size === 0 &&
    s.keysJustPressed.size === 0 && s.keysJustReleased.size === 0 &&
    s.touchZones.size === 0 && s.keysPressed.has('a'));

  const s2 = T.createInputState();
  const axesBefore = s2.gamepadAxes;
  const buttonsBefore = s2.gamepadButtons;
  s2.gamepadButtons.add(0);
  s2.gamepadPrev.add(0);
  s2.gamepadJustPressed.add(0);
  s2.gamepadJustReleased.add(1);
  s2.gamepadAxes.lx = 0.5; s2.gamepadAxes.ly = -0.5; s2.gamepadAxes.rx = 0.25; s2.gamepadAxes.ry = 1;
  s2.gamepadConnected = true;
  s2.touchCount = 3;
  s2.touchZones.add('up');
  s2.mouseDelta.x = 7; s2.mouseDelta.y = 8;
  s2.lastClient = { x: 1, y: 2 };
  T.resetRunInput(s2);
  check('resetRunInput freshens the whole gamepad/touch/delta state',
    s2.gamepadButtons.size === 0 && s2.gamepadPrev.size === 0 &&
    s2.gamepadJustPressed.size === 0 && s2.gamepadJustReleased.size === 0 &&
    s2.gamepadAxes.lx === 0 && s2.gamepadAxes.ly === 0 &&
    s2.gamepadAxes.rx === 0 && s2.gamepadAxes.ry === 0 &&
    s2.gamepadConnected === false && s2.touchCount === 0 && s2.touchZones.size === 0 &&
    s2.mouseDelta.x === 0 && s2.mouseDelta.y === 0 && s2.lastClient === null);
  check('resetRunInput mutates the axes object and button set in place (aliases stay valid)',
    s2.gamepadAxes === axesBefore && s2.gamepadButtons === buttonsBefore);
  noThrow('the resets with no state do not throw', () => {
    T.clearEdges(null);
    T.clearForLaunch(null);
    T.resetRunInput(null);
  });
  const frozen = Object.freeze(T.createInputState());
  noThrow('resetRunInput with a frozen state does not throw', () => T.resetRunInput(frozen));
}

// --- pollGamepad -------------------------------------------------------------
{
  const fakePads = [{ buttons: [{ pressed: true }, { pressed: false }], axes: [0.5, -0.5, 0, 1] }];
  let receivedFn = null;
  const stubActions = {
    pollGamepadButtons(getPads) {
      receivedFn = getPads;
      return new Set(getPads().length ? [0, 2] : []);
    },
    pollGamepadAxes: () => ({ lx: 0.5, ly: -0.5, rx: 0, ry: 1 }),
    isGamepadConnected: () => true
  };
  const T = factory();
  T.configure({
    getGamepads: () => fakePads,
    getHydraActions: () => stubActions
  });
  const s = T.createInputState();
  const buttonsBefore = s.gamepadButtons;
  const axesBefore = s.gamepadAxes;
  T.pollGamepad(s);
  check('pollGamepad hands the actions module the getGamepads function',
    typeof receivedFn === 'function' && receivedFn() === fakePads);
  eq('first poll records the pressed buttons and the just-pressed edges',
    [setOf(s.gamepadButtons), setOf(s.gamepadJustPressed), setOf(s.gamepadJustReleased)],
    [[0, 2], [0, 2], []]);
  eq('pollGamepad copies the axes into the state object',
    [s.gamepadAxes.lx, s.gamepadAxes.ly, s.gamepadAxes.rx, s.gamepadAxes.ry],
    [0.5, -0.5, 0, 1]);
  check('pollGamepad marks the gamepad connected', s.gamepadConnected === true);
  check('pollGamepad mutates the button set and axes in place (aliases stay valid)',
    s.gamepadButtons === buttonsBefore && s.gamepadAxes === axesBefore);
  stubActions.pollGamepadButtons = () => new Set([2]);
  T.pollGamepad(s);
  eq('second poll derives the edge sets from the previous buttons',
    [setOf(s.gamepadButtons), setOf(s.gamepadJustPressed), setOf(s.gamepadJustReleased), setOf(s.gamepadPrev)],
    [[2], [], [0], [2]]);

  const T2 = factory();
  T2.configure({ getHydraActions: () => null });
  const s2 = T2.createInputState();
  s2.gamepadButtons.add(9);
  noThrow('pollGamepad with no actions module does not throw', () => T2.pollGamepad(s2));
  check('pollGamepad with no actions module leaves the state alone',
    s2.gamepadButtons.has(9) && s2.gamepadConnected === false);

  const throwing = {
    pollGamepadButtons: () => { throw new Error('boom'); },
    pollGamepadAxes: () => { throw new Error('boom'); },
    isGamepadConnected: () => { throw new Error('boom'); }
  };
  const T3 = factory();
  const s3 = T3.createInputState();
  s3.gamepadButtons.add(0);
  noThrow('pollGamepad with throwing poll functions does not throw', () => T3.pollGamepad(s3, throwing));
  check('throwing polls degrade to empty gamepad state',
    s3.gamepadButtons.size === 0 && s3.gamepadAxes.lx === 0 && s3.gamepadConnected === false);

  const arrayActions = {
    pollGamepadButtons: () => [0],
    pollGamepadAxes: () => ({ lx: Infinity, ly: NaN }),
    isGamepadConnected: () => true
  };
  const T4 = factory();
  const s4 = T4.createInputState();
  T4.pollGamepad(s4, arrayActions);
  check('a non-Set button result degrades to empty buttons',
    s4.gamepadButtons.size === 0 && s4.gamepadJustPressed.size === 0);
  check('non-finite axes degrade to zero', s4.gamepadAxes.lx === 0 && s4.gamepadAxes.ly === 0);
  check('the actions module can be passed directly as the second argument',
    s4.gamepadConnected === true);
  noThrow('pollGamepad with no state does not throw', () => T.pollGamepad(null));
}


// --- dispatch host (P2 item 14, slice 7) ------------------------------------
// The script-grid dispatch host lives in this module now: processScriptGrid
// + dispatchHooks, the condition/action context builders with their
// subsystem hook builders, the per-frame context bookkeeping, the gameStart
// launch path, and the warn-once helpers. The tests drive it through a
// stub editor host (the configure() host object) plus stub shared modules
// (the getModule provider), following the input-host sections above.

function makeCell(idx) {
  const classes = new Set();
  return {
    dataset: { index: String(idx) },
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, force) => { if (force) classes.add(c); else classes.delete(c); },
      has: (c) => classes.has(c)
    },
    _classes: classes
  };
}

function makeRun() {
  return {
    sceneId: 1, pendingSceneId: null, objects: [], executionContext: null,
    conditionContexts: {}, flowTriggerStates: {},
    camera: { x: 0, y: 0, zoom: 1, followTarget: '' },
    cameraShake: { strength: 0, timeLeft: 0 },
    flash: { color: '#ffffff', intensity: 0, timeLeft: 0, maxTime: 0 },
    mouse: { x: 10, y: 20 }, dt: 1, frameId: 7,
    buses: null, busVoices: null, actions: null, particles: null,
    profiler: null, language: 'en', masterVolume: 1, musicPaused: false,
    trace: null, _triggerEntered: [], _triggerExited: [],
    camera3d: null, camera3dFollow: null, paused: false
  };
}

function makeDispatchHost(T, overrides) {
  const run = makeRun();
  const input = T.createInputState();
  const vars = {};
  const hidden = new Set(), destroyed = new Set(), pending = new Set();
  const started = new Set(), once = new Set();
  const timers = new Map(), shakeCooldowns = new Map();
  const sceneStack = [];
  const soundCooldowns = new Map();
  const inputActions = [{ name: 'Jump', bindings: [] }];
  const scenes = [{ id: 1, name: 'Main', objects: [] }, { id: 2, name: 'Level 2', objects: [] }];
  const canvas = makeFakeCanvas();
  const cells = [];
  const grids = {};
  const diagnostics = [];
  const scope = { active: 'global' };
  const calls = {
    dispatch: [], conditions: [], execute: [], renderTraceFeed: 0,
    playSound: [], stopMusic: 0, pauseMusic: 0, resumeMusic: 0, stopAll: 0,
    switchScene: [], applyBoundTexts: 0, clampCamera: 0, updateFollow: 0,
    animPlay: [], animSpeed: [], setTile: [], burst: [], startEmitter: [],
    stopEmitter: [], clearParticles: [], fired: new Set(),
    drawGame: 0, commitGrid: 0, resizeCanvas: [], resetTrace: 0,
    clearDiagnostics: 0, frameOrder: [], sceneReset: [], sceneInit: [],
    applyTexts: [], normalizeScene: 0, raf: [], cancelled: [],
    physicsStep: [], physics3d: [], tick3d: [], cameraDecay: [],
    createActions: [], actionsUpdate: [], zonesAt: []
  };
  const saveStore = {};
  const modules = {
    // P5-7: the Flow stub keeps its shouldTrigger/propagate doubles
    // (tests drive trigger behaviour through them), but its
    // adjacentIndexes is the REAL canonical one — the preview resolves
    // flow adjacency through HydraFlow, and the pins below prove it.
    Flow: { shouldTrigger: () => true, propagate: () => {}, adjacentIndexes: Flow.adjacentIndexes },
    Trace: {
      createTracer: () => ({ events: [] }),
      firedRecently: (tracer, scopeKey, idx, frameId, window) => calls.fired.has(scopeKey + ':' + idx)
    },
    Dispatch: {
      processScope(gd, scopeKey, hooks) {
        calls.dispatch.push([gd, scopeKey, hooks]);
      }
    },
    Conditions: {
      evaluateCondition(data, ctx, scope, idx) {
        calls.conditions.push([data, ctx, scope, idx]);
        return { triggered: data.type === 'always', context: { from: data.type } };
      }
    },
    Execute: {
      executeAction(data, ctx, idx) { calls.execute.push([data, ctx, idx]); }
    },
    Pause: {
      gameNow: (state, now) => now,
      isPaused: (state) => !!(state && state.paused),
      pause: (state) => { if (state) state.paused = true; },
      resume: (state) => { if (state) state.paused = false; }
    },
    Profile: {
      isVisible: (p) => !!(p && p.visible),
      show: (p) => { if (p) p.visible = true; },
      hide: (p) => { if (p) p.visible = false; }
    },
    Save: {
      safeStorage: () => saveStore,
      writeSlot: (store, slot, data) => { store[slot] = JSON.parse(JSON.stringify({ version: 1, data })); },
      readSlot: (store, slot) => store[slot] || null,
      deleteSlot: (store, slot) => { delete store[slot]; },
      slotExists: (store, slot) => !!store[slot]
    },
    Tiles: {
      setTile: (tm, c, r, t) => { calls.setTile.push([tm, c, r, t]); },
      isSolidAtPixel: (tm, x, y) => tm.solid === true
    },
    Particles: {
      burst: (...a) => calls.burst.push(a),
      startEmitter: (...a) => calls.startEmitter.push(a),
      stopEmitter: (...a) => calls.stopEmitter.push(a),
      clearParticles: (...a) => calls.clearParticles.push(a),
      PRESETS: [{ kind: 'burst', id: 'explosion', label: 'Explosion', fill: { count: 5 } }]
    },
    AudioBuses: {
      normalizeBusId: (b) => b || 'sfx',
      normalizeMasterVolume: (v) => v,
      createVoices: () => ({ counts: { music: 0 } })
    },
    Actions: {
      actionHeld: (st, n) => st.held.has(n),
      actionJustPressed: (st, n) => st.pressed.has(n),
      actionJustReleased: (st, n) => st.released.has(n)
    },
    Anim: {
      play: (...a) => calls.animPlay.push(a),
      setSpeed: (...a) => calls.animSpeed.push(a)
    },
    Input: { mouseButtonCode: (b) => (b === 'left' ? 0 : 1) },
    Light2d: { normalizeSceneDarkness: (s) => { s.darkness = s.darkness || 0; } },
    '3d': {}, CameraFx: {}, Ui: {}, Physics2D: {}, Collections: {}, Math: {},
    Pick: {}, LayerFx: {}, Joints: {}, Skeleton: {}, Tween: {},
    BlendSpace: {}, StateMachine: {}, ScriptApi: {}, Localization: {}, Dialogue: Dlg,
    Inventory: Inv, Quest: Qst, Achievement: Ach, Cutscene: Cut, HighScore: HS, TimeScale: TS, Transition: TR, SceneInit: {}
  };
  const host = {
    getRunState: () => run,
    getStartedScopes: () => started,
    getOnce: () => once,
    getTimers: () => timers,
    getShakeCooldowns: () => shakeCooldowns,
    getSceneStack: () => sceneStack,
    getVariables: () => vars,
    getHidden: () => hidden,
    getDestroyed: () => destroyed,
    getPendingDestroy: () => pending,
    getInputState: () => input,
    getScenes: () => scenes,
    getCurrentSceneId: () => 1,
    getCanvas: () => canvas,
    getCells: () => cells,
    getActiveScriptScope: () => scope.active,
    getAssetLibrary: () => ({}),
    getObjectsByName: (name, list) => (list || []).filter(o => o && o.name === name),
    getHitbox: (o) => ({ x: o.posX || 0, y: o.posY || 0, width: o.width || 0, height: o.height || 0 }),
    getPhysics: (o) => (o && o.physics) || {},
    isCollisionObject: (o) => !!o && o.kind !== 'tilemap' && o.collidable !== false,
    evalExpr: (s) => {
      if (typeof s === 'number') return s;
      const n = Number(s);
      if (Number.isFinite(n)) return n;
      if (typeof s === 'string' && s.trim() in vars) return vars[s.trim()];
      return 0;
    },
    evalExprInfo: (s) => {
      if (typeof s === 'number') return { value: s, ok: true, unknowns: [] };
      const n = Number(s);
      if (Number.isFinite(n)) return { value: n, ok: true, unknowns: [] };
      if (typeof s === 'string' && s.trim() in vars) return { value: vars[s.trim()], ok: true, unknowns: [] };
      return { value: 0, ok: true, unknowns: [] };
    },
    getPreviewScene: () => scenes[0],
    getSceneWorldWidth: () => 800, getSceneWorldHeight: () => 600,
    getSceneViewportWidth: () => 800, getSceneViewportHeight: () => 600,
    clampCameraToScene: () => { calls.clampCamera++; },
    updateCameraFollow: () => { calls.updateFollow++; },
    normalizeCameraZoom: (v) => {
      const z = Number(v);
      return Number.isFinite(z) ? Math.min(4, Math.max(0.25, z)) : 1;
    },
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
    getPreviewLanguage: () => run.language || 'en',
    getPreviewLocalization: () => null,
    applyPreviewBoundTexts: () => { calls.applyBoundTexts++; },
    ensurePreviewParticleState: () => run.particles || (run.particles = { list: [] }),
    getPreviewBuses: () => ({
      sfx: { volume: 1, muted: false }, music: { volume: 1, muted: false }, ui: { volume: 1, muted: false }
    }),
    playSound: (data, key) => { calls.playSound.push([data, key]); },
    stopPreviewMusic: () => { calls.stopMusic++; },
    pausePreviewMusic: () => { calls.pauseMusic++; },
    resumePreviewMusic: () => { calls.resumeMusic++; },
    stopAllPreviewSounds: () => { calls.stopAll++; },
    getGridDataForScope: (scope) => grids[scope] || {},
    getScopeKey: (scope) => (scope === 'global' ? 'global' : 'scene:' + scope),
    sameScriptScope: (a, b) => a === b,
    isCondition: (t) => ['always', 'gameStart', 'keyPressed', 'objectVisible', 'getVariable'].includes(t),
    isAction: (t) => ['setVariable', 'setText', 'playSound'].includes(t),
    isComment: (t) => t === 'comment',
    pushDiagnostic: (level, msg) => { diagnostics.push([level, msg]); },
    sceneInitHooks: () => ({ sceneInit: true }),
    renderTraceFeed: () => { calls.renderTraceFeed++; },
    switchPreviewScene: (id) => { calls.switchScene.push(id); },
    // P2 item 14 slice 8: the run-loop host entries.
    getCurrentScene: () => scenes[0],
    getProjectInputActions: () => inputActions,
    getProjectMasterVolume: () => 0.5,
    resizeGameCanvas: (scene) => { calls.resizeCanvas.push(scene); },
    resetTraceRender: () => { calls.resetTrace++; },
    clearRuntimeDiagnostics: () => { calls.clearDiagnostics++; },
    getSoundCooldowns: () => soundCooldowns,
    drawGame: () => { calls.drawGame++; },
    commitActiveGrid: () => { calls.commitGrid++; }
  };
  if (overrides) Object.assign(host, overrides);
  const fixture = {
    run, input, vars, hidden, destroyed, pending, started, once,
    timers, shakeCooldowns, sceneStack, soundCooldowns, inputActions,
    scenes, canvas, cells, grids,
    diagnostics, scope, calls, modules, saveStore, host
  };
  T.configure({ host, getModule: (name) => modules[name] || null });
  return fixture;
}

// --- dispatch surface -----------------------------------------------------
{
  const T = factory();
  check('module exposes the dispatch host surface',
    typeof T.processScriptGrid === 'function' && typeof T.dispatchHooks === 'function' &&
    typeof T.conditionCtx === 'function' && typeof T.evaluateCondition === 'function' &&
    typeof T.actionCtx === 'function' && typeof T.executeAction === 'function' &&
    typeof T.getConditionContextKey === 'function' &&
    typeof T.setConditionContext === 'function' &&
    typeof T.getConditionContext === 'function' &&
    typeof T.markConditionTriggered === 'function' &&
    typeof T.resetFrameConditionContexts === 'function' &&
    typeof T.resetGameStartState === 'function' &&
    typeof T.processGameStartConditions === 'function' &&
    typeof T.getScopeGridData === 'function' &&
    typeof T.getEventActionIndexes === 'function' &&
    typeof T.applyAdjacentActionsFromScope === 'function' &&
    typeof T.getAdjacentIndexes === 'function' &&
    typeof T.getAlivePreviewObjects === 'function' &&
    typeof T.getContextObjectForName === 'function' &&
    typeof T.resolveActionTargets === 'function' &&
    typeof T.namedTimerElapsedSeconds === 'function' &&
    typeof T.getTimerRecord === 'function' &&
    typeof T.resetNamedTimer === 'function' &&
    typeof T.setNamedTimerPaused === 'function' &&
    typeof T.warnUnknownBlockType === 'function' &&
    typeof T.warnReadTimerBlank === 'function' &&
    typeof T.warnFlashColor === 'function' &&
    typeof T.collectionHooks === 'function' && typeof T.mathHooks === 'function' &&
    typeof T.pickHooks === 'function' && typeof T.layerFxActionHooks === 'function' &&
    typeof T.layerFxConditionHooks === 'function' && typeof T.scriptApiHooks === 'function' &&
    typeof T.threeDActionHooks === 'function' && typeof T.threeDConditionHooks === 'function' &&
    typeof T.light2dActionHooks === 'function' && typeof T.light2dConditionHooks === 'function' &&
    typeof T.jointActionHooks === 'function' && typeof T.jointConditionHooks === 'function' &&
    typeof T.stateMachineHooksFor === 'function' &&
    typeof T.previewTilemapsNamed === 'function');
  const viaVm = loadInSandbox();
  check('vm instance exposes the dispatch surface via window.HydraPreviewRuntime',
    !!viaVm.HydraPreviewRuntime && typeof viaVm.HydraPreviewRuntime.processScriptGrid === 'function');
}

// --- run loop surface -------------------------------------------------------
{
  const T = factory();
  check('module exposes the run loop host surface',
    typeof T.initGame === 'function' && typeof T.startGame === 'function' &&
    typeof T.stopPreviewLoop === 'function' && typeof T.startRenderLoop === 'function' &&
    typeof T.gameLoop === 'function' && typeof T.updateCameraFollow === 'function' &&
    typeof T.update3dCameraFollow === 'function' &&
    typeof T.updateUiWidgetStates === 'function' &&
    typeof T.physicsStepHooks === 'function' && typeof T.sceneResetHooks === 'function' &&
    typeof T.resetGame === 'function' && typeof T.loadPreviewScene === 'function' &&
    typeof T.switchPreviewScene === 'function' && typeof T.launchPreview === 'function');
  const viaVm = loadInSandbox();
  check('vm instance exposes the run loop surface via window.HydraPreviewRuntime',
    !!viaVm.HydraPreviewRuntime && typeof viaVm.HydraPreviewRuntime.gameLoop === 'function' &&
    typeof viaVm.HydraPreviewRuntime.launchPreview === 'function' &&
    typeof viaVm.HydraPreviewRuntime.resetGame === 'function');
}

// --- context bookkeeping ----------------------------------------------------
{
  const T = factory();
  const f = makeDispatchHost(T);
  check('getConditionContextKey joins the scope key and index',
    T.getConditionContextKey('global', 5) === 'global:5' &&
    T.getConditionContextKey(1, 12) === 'scene:1:12');
  T.setConditionContext('global', 5, { obj1: { name: 'hero' } });
  check('set/getConditionContext round-trips, and the execution context follows',
    T.getConditionContext('global', 5).obj1.name === 'hero' &&
    f.run.executionContext.obj1.name === 'hero');
  check('getConditionContext reads undefined for an unset cell',
    T.getConditionContext('global', 6) === undefined);
  T.resetFrameConditionContexts();
  check('resetFrameConditionContexts clears the contexts and the execution context',
    T.getConditionContext('global', 5) === undefined && f.run.executionContext === null);
  f.run.flowTriggerStates = { 'global:5': true };
  T.resetFrameConditionContexts();
  check('resetFrameConditionContexts does NOT wipe the edge memory',
    f.run.flowTriggerStates['global:5'] === true);
  T.setConditionContext('global', 5, { x: 1 });
  f.started.add('global');
  T.resetGameStartState();
  check('resetGameStartState clears the started scopes only',
    f.started.size === 0 && T.getConditionContext('global', 5).x === 1);
  noThrow('bookkeeping with no host does not throw', () => {
    const T2 = factory();
    T2.setConditionContext('global', 1, { a: 1 });
    T2.getConditionContext('global', 1);
    T2.resetFrameConditionContexts();
    T2.resetGameStartState();
  });
}

// --- markConditionTriggered ---------------------------------------------------
{
  const T = factory();
  const f = makeDispatchHost(T);
  const cell = makeCell(5);
  f.cells.push(cell);
  // cells array order is the grid order: index 5 must sit at position 5.
  while (f.cells.length < 6) f.cells.push(makeCell(f.cells.length));
  f.cells[5] = cell;
  T.markConditionTriggered('global', 5);
  check('markConditionTriggered marks the cell when the scope is active',
    cell._classes.has('triggered'));
  f.scope.active = 1;
  const cell2 = makeCell(6);
  f.cells[6] = cell2;
  T.markConditionTriggered('global', 6);
  check('markConditionTriggered skips the mark when the scope is not active',
    !cell2._classes.has('triggered'));
  noThrow('markConditionTriggered with no host does not throw', () => {
    const T2 = factory();
    T2.markConditionTriggered('global', 3);
  });
}

// --- getAdjacentIndexes -------------------------------------------------------
// P5-7: the preview resolves flow adjacency through HydraFlow, so the
// order is the dispatch's reading order (right, down, left, up) and
// rows past 60 still link down. The module is configured with the
// real Flow here, exactly like the editor page loads hydra-flow.js.
{
  const T = factory();
  T.configure({ getModule: (name) => (name === 'Flow' ? Flow : null) });
  eq('getAdjacentIndexes at the top-left corner has two neighbors',
    T.getAdjacentIndexes(0), [1, 60]);
  eq('getAdjacentIndexes in the middle has four neighbors',
    T.getAdjacentIndexes(61), [62, 121, 60, 1]);
  eq('getAdjacentIndexes at the bottom-right corner links down past the editor grid',
    T.getAdjacentIndexes(3599), [3659, 3598, 3539]);
  eq('getAdjacentIndexes past row 60 still links down (row-60 fix)',
    T.getAdjacentIndexes(3660), [3661, 3720, 3600]);
  const TNoFlow = factory();
  TNoFlow.configure({ getModule: () => null });
  eq('getAdjacentIndexes with no Flow module degrades to no neighbours',
    TNoFlow.getAdjacentIndexes(61), []);
  noThrow('getAdjacentIndexes with a throwing getModule provider does not throw',
    () => {
      const TThrow = factory();
      TThrow.configure({ getModule: () => { throw new Error('boom'); } });
      TThrow.getAdjacentIndexes(61);
    });
}

// --- getAlivePreviewObjects / resolveActionTargets ------------------------------
{
  const T = factory();
  const f = makeDispatchHost(T);
  const hero = { id: 1, name: 'hero', posX: 0, posY: 0, width: 10, height: 10 };
  const ghost = { id: 2, name: 'ghost', posX: 50, posY: 0, width: 10, height: 10 };
  const coin = { id: 3, name: 'coin', posX: 100, posY: 0, width: 10, height: 10 };
  f.run.objects = [hero, ghost, coin];
  f.destroyed.add(2);
  f.pending.add(3);
  eq('getAlivePreviewObjects excludes destroyed and pending-destroy objects',
    T.getAlivePreviewObjects().map(o => o.id), [1]);
  check('resolveActionTargets with a blank name is empty',
    T.resolveActionTargets({}) .length === 0);
  eq('resolveActionTargets default mode takes the first match',
    T.resolveActionTargets({ targetObject: 'hero' }).map(o => o.id), [1]);
  f.run.objects.push({ id: 4, name: 'hero', posX: 200, posY: 0, width: 10, height: 10 });
  eq('resolveActionTargets all mode returns every live match',
    T.resolveActionTargets({ targetObject: 'hero', targetMode: 'all' }).map(o => o.id), [1, 4]);
  eq('resolveActionTargets first mode returns one',
    T.resolveActionTargets({ targetObject: 'hero', targetMode: 'first' }).map(o => o.id), [1]);
  f.run.executionContext = { obj1: { id: 4, name: 'hero' } };
  eq('resolveActionTargets context mode follows the execution context pick',
    T.resolveActionTargets({ targetObject: 'hero' }).map(o => o.id), [4]);
  check('getContextObjectForName ignores a destroyed context pick', (() => {
    f.run.executionContext = { obj1: { id: 2, name: 'ghost' } };
    return T.getContextObjectForName('ghost') === null;
  })());
  check('getContextObjectForName with no name is null',
    T.getContextObjectForName('') === null && T.getContextObjectForName(null) === null);
  noThrow('alive/target lookups with no host do not throw', () => {
    const T2 = factory();
    T2.getAlivePreviewObjects();
    T2.resolveActionTargets({ targetObject: 'hero' });
    T2.getContextObjectForName('hero');
  });
}

// --- timers ---------------------------------------------------------------------
{
  const T = factory();
  const f = makeDispatchHost(T);
  check('namedTimerElapsedSeconds reads 0 for a never-started timer',
    T.namedTimerElapsedSeconds('named:jump', 5000) === 0);
  const rec = T.getTimerRecord('named:jump', 1000, 1000);
  check('getTimerRecord creates a record with the given start',
    rec.lastFiredTime === 0 && rec.paused === false);
  check('getTimerRecord returns the same record on a second read',
    T.getTimerRecord('named:jump', 9000, 1000) === rec);
  check('namedTimerElapsedSeconds reads the elapsed seconds',
    T.namedTimerElapsedSeconds('named:jump', 6000) === 6);
  T.setNamedTimerPaused('jump', true);
  // Pausing at nowMs() (~real clock) shifts lastFiredTime only on resume;
  // the elapsed read while paused holds at pausedAt - lastFiredTime.
  const held = T.namedTimerElapsedSeconds('named:jump', 60000);
  check('a paused timer holds its elapsed time', held === T.namedTimerElapsedSeconds('named:jump', 90000));
  T.resetNamedTimer('jump');
  const rec2 = T.getTimerRecord('named:jump', 0, 1000);
  check('resetNamedTimer restarts the timer unpaused',
    rec2.paused === false && rec2.lastFiredTime > 0);
  // Legacy numeric record: the elapsed read repairs it through getTimerRecord.
  f.timers.set('named:legacy', 4000);
  check('a legacy numeric timer record reads through getTimerRecord',
    T.getTimerRecord('named:legacy', 5000, 1000).lastFiredTime === 4000);
  check('namedTimerElapsedSeconds reads 0 for a legacy numeric record until repaired',
    T.namedTimerElapsedSeconds('named:other', 5000) === 0);
  noThrow('timer helpers with no host do not throw', () => {
    const T2 = factory();
    T2.namedTimerElapsedSeconds('named:x', 100);
    T2.getTimerRecord('named:x', 100, 1000);
    T2.resetNamedTimer('x');
    T2.setNamedTimerPaused('x', true);
  });
}

// --- warn-once helpers ------------------------------------------------------------
{
  const T = factory();
  const f = makeDispatchHost(T);
  T.warnUnknownBlockType('condition', 'mystery');
  T.warnUnknownBlockType('condition', 'mystery');
  T.warnUnknownBlockType('action', 'mystery');
  T.warnReadTimerBlank('variable');
  T.warnReadTimerBlank('variable');
  T.warnReadTimerBlank('timer');
  T.warnFlashColor('#zzz');
  T.warnFlashColor('#zzz');
  T.warnFlashColor('#yyy');
  eq('warn-once helpers report each key once through the diagnostics host',
    f.diagnostics.map(d => d[1]), [
      'Unknown condition block type "mystery". The block was skipped; check the block catalog or re-add the block.',
      'Unknown action block type "mystery". The block was skipped; check the block catalog or re-add the block.',
      'Read Timer skipped: the variable name is blank. Name the variable that should receive the elapsed seconds.',
      'Read Timer: the timer name is blank, so it read 0 seconds. Name the timer you want to read.',
      'Screen Flash: the color "#zzz" is not a valid hex color, so the flash was skipped. Use a color like #ffffff.',
      'Screen Flash: the color "#yyy" is not a valid hex color, so the flash was skipped. Use a color like #ffffff.'
    ]);
  noThrow('warn helpers with no host do not throw', () => {
    const T2 = factory();
    T2.warnUnknownBlockType('condition', 'x');
    T2.warnReadTimerBlank('variable');
    T2.warnFlashColor('#zzz');
  });
}

// --- processScriptGrid ------------------------------------------------------
{
  const T = factory();
  const f = makeDispatchHost(T);
  const cell0 = makeCell(0);
  const cell1 = makeCell(1);
  f.cells.push(cell0, cell1);
  cell0._classes.add('triggered');
  f.grids.global = {
    0: { type: 'always', kind: 'condition' },
    1: { type: 'setVariable', kind: 'action', varName: 'x', operation: 'set', value: '1' }
  };
  f.run.trace = { events: [] };
  f.calls.fired.add('global:1');
  T.processScriptGrid('global');
  check('processScriptGrid hands the grid, scope key, and hooks to HydraDispatch',
    f.calls.dispatch.length === 1 &&
    f.calls.dispatch[0][0] === f.grids.global &&
    f.calls.dispatch[0][1] === 'global' &&
    typeof f.calls.dispatch[0][2].evaluate === 'function' &&
    typeof f.calls.dispatch[0][2].execute === 'function');
  check('processScriptGrid clears the triggered marks before dispatch',
    !cell0._classes.has('triggered'));
  check('processScriptGrid keeps the traced ring on cells the tracer reports',
    cell1._classes.has('traced') && !cell0._classes.has('traced'));
  check('processScriptGrid renders the trace feed after dispatch',
    f.calls.renderTraceFeed === 1);
  cell0._classes.add('triggered');
  f.scope.active = 1;
  T.processScriptGrid('global');
  check('processScriptGrid skips the DOM marking when the scope is not active',
    cell0._classes.has('triggered') && f.calls.dispatch.length === 2 &&
    f.calls.renderTraceFeed === 2);

  const T2 = factory();
  const f2 = makeDispatchHost(T2);
  delete f2.modules.Dispatch;
  noThrow('processScriptGrid with no Dispatch module does not throw', () => T2.processScriptGrid('global'));
  check('processScriptGrid with no Dispatch module still renders the trace feed',
    f2.calls.renderTraceFeed === 1);
  noThrow('processScriptGrid with no host does not throw', () => {
    const T3 = factory();
    T3.processScriptGrid('global');
  });
}

// --- dispatchHooks ------------------------------------------------------------
{
  const T = factory();
  const f = makeDispatchHost(T);
  const hooks = T.dispatchHooks('global');
  check('dispatchHooks carries the modules, trace state, frame id, and edge memory',
    hooks.flow === f.modules.Flow && hooks.trace === f.modules.Trace &&
    hooks.traceState === null && hooks.frameId === 7 &&
    hooks.flowTriggerStates === f.run.flowTriggerStates &&
    hooks.startedScopes === f.started);
  check('dispatchHooks classifiers route through the host',
    hooks.isCondition('always') === true && hooks.isAction('setVariable') === true &&
    hooks.isComment('comment') === true && hooks.isCondition('setVariable') === false);
  const res = hooks.evaluate(0, { type: 'always' });
  check('dispatchHooks evaluate reaches the Conditions stub with data, scope, and index',
    res.triggered === true && f.calls.conditions.length === 1 &&
    f.calls.conditions[0][0].type === 'always' && f.calls.conditions[0][2] === 'global' &&
    f.calls.conditions[0][3] === 0);
  hooks.execute(1, { type: 'setVariable' });
  check('dispatchHooks execute reaches the Execute stub with data and index',
    f.calls.execute.length === 1 && f.calls.execute[0][0].type === 'setVariable' &&
    f.calls.execute[0][2] === 1);
  const cell = makeCell(0);
  f.cells[0] = cell;
  hooks.onTriggered(0, { triggered: true, context: { picked: 1 } });
  check('onTriggered records the context and the execution context and marks the cell',
    T.getConditionContext('global', 0).picked === 1 &&
    f.run.executionContext.picked === 1 && cell._classes.has('triggered'));
  f.run.executionContext = { picked: 1 };
  hooks.onPropagateCondition(0, { triggered: true, context: { picked: 2 } });
  check('onPropagateCondition records the context but keeps the trigger execution context',
    T.getConditionContext('global', 0).picked === 2 && f.run.executionContext.picked === 1);
  hooks.reportUnknown('mystery', 9);
  check('reportUnknown warns once through the diagnostics host',
    f.diagnostics.length === 1 && f.diagnostics[0][1].includes('mystery (grid cell 9)'));
  hooks.reportUnknown('mystery', 9);
  check('a repeated unknown block does not re-warn', f.diagnostics.length === 1);
}

// --- conditionCtx / evaluateCondition -------------------------------------------
{
  const T = factory();
  const f = makeDispatchHost(T);
  const hero = { id: 1, name: 'hero', posX: 0, posY: 0, width: 10, height: 10 };
  const ghost = { id: 2, name: 'ghost', posX: 50, posY: 0, width: 10, height: 10 };
  f.run.objects = [hero, ghost];
  f.hidden.add(2);
  f.input.keysPressed.add('ArrowRight');
  f.input.touchCount = 2;
  f.input.gamepadConnected = true;
  f.run.busVoices = { counts: { music: 1 } };
  const ctx = T.conditionCtx();
  check('conditionCtx describes the live run state',
    ctx.variables === f.vars && ctx.hidden === f.hidden &&
    ctx.keys === f.input.keysPressed &&
    ctx.mouse === f.run.mouse && ctx.mouse.x === 10 && ctx.mouse.y === 20 &&
    ctx.touchCount === 2 && ctx.gamepadConnected === true &&
    ctx.camera === f.run.camera && ctx.canvasWidth === 800 && ctx.canvasHeight === 600 &&
    ctx.contexts === f.run.conditionContexts && ctx.once === f.once &&
    ctx.timers === f.timers && ctx.frameId === 7 &&
    ctx.language === 'en' && ctx.musicCount === 1 && ctx.musicPaused === false &&
    ctx.actions === f.modules.Actions && ctx.actionState === null &&
    ctx.physics2d === f.modules.Physics2D && ctx.tiles === f.modules.Tiles &&
    ctx.save === f.modules.Save && ctx.scriptApi === f.modules.ScriptApi &&
    ctx.threeD === f.modules['3d'] && ctx.light2d === f.modules.Light2d &&
    ctx.joints === f.modules.Joints && ctx.random === Math.random);
  eq('conditionCtx named filters hidden objects out of the alive list',
    ctx.named('ghost').map(o => o.id), []);
  eq('conditionCtx named finds the visible object',
    ctx.named('hero').map(o => o.id), [1]);
  eq('conditionCtx allObjects are the alive list (hidden included)',
    ctx.allObjects().map(o => o.id), [1, 2]);
  check('conditionCtx hitbox reads through the host',
    ctx.hitbox(hero).width === 10 && ctx.hitbox(hero).x === 0);
  check('conditionCtx mouseButtonCode routes through the HydraInput module',
    ctx.mouseButtonCode('left') === 0 && ctx.mouseButtonCode('right') === 1);
  check('conditionCtx expr evaluates through the host',
    ctx.expr('score') === 0 && ctx.expr('42') === 42);
  check('conditionCtx adjacentIndexes and scopeKey route through the module and host',
    JSON.stringify(ctx.adjacentIndexes(61)) === JSON.stringify([62, 121, 60, 1]) &&
    ctx.scopeKey('global') === 'global');
  check('conditionCtx nowMs and isPaused read the pause module',
    typeof ctx.nowMs() === 'number' && ctx.isPaused() === false);
  check('conditionCtx worldSize reads the preview scene through the host',
    ctx.worldSize().width === 800 && ctx.worldSize().height === 600);
  check('conditionCtx profilerVisible reads the profiler module',
    ctx.profilerVisible() === false);
  check('conditionCtx hook builders return the subsystem hooks',
    typeof ctx.collectionHooks().num === 'function' &&
    typeof ctx.mathHooks().num === 'function' &&
    typeof ctx.pickHooks().liveObjects === 'function' &&
    typeof ctx.layerFxConditionHooks().targets === 'function' &&
    typeof ctx.threeDConditionHooks().targets === 'function' &&
    typeof ctx.light2dConditionHooks().darkness === 'function' &&
    typeof ctx.jointConditionHooks().scene === 'function' &&
    typeof ctx.scriptApiHooks().getVar === 'function');
  ctx.reportUnknown('nope');
  check('conditionCtx reportUnknown warns through the module',
    f.diagnostics.length === 1 && f.diagnostics[0][1].includes('Unknown condition block type "nope"'));

  const res = T.evaluateCondition({ type: 'always' }, 3, 'global');
  check('evaluateCondition delegates to the Conditions stub with data, ctx, scope, idx',
    res.triggered === true && f.calls.conditions.length === 1 &&
    f.calls.conditions[0][0].type === 'always' &&
    typeof f.calls.conditions[0][1] === 'object' &&
    f.calls.conditions[0][1].variables === f.vars &&
    f.calls.conditions[0][2] === 'global' && f.calls.conditions[0][3] === 3);
  const T2 = factory();
  const f2 = makeDispatchHost(T2);
  delete f2.modules.Conditions;
  check('evaluateCondition with no Conditions module reads false',
    T2.evaluateCondition({ type: 'always' }, 0, 'global').triggered === false);
  const T3 = factory();
  T3.configure({ getModule: () => { throw new Error('boom'); } });
  check('evaluateCondition with a throwing module provider reads false',
    T3.evaluateCondition({ type: 'always' }, 0, 'global').triggered === false);
}

// --- actionCtx / executeAction -----------------------------------------------------
{
  const T = factory();
  const f = makeDispatchHost(T);
  const hero = { id: 1, name: 'hero', posX: 0, posY: 0, width: 10, height: 10 };
  f.run.objects = [hero];
  f.run.executionContext = { obj1: hero };
  const ctx = T.actionCtx();
  check('actionCtx describes the live run state',
    ctx.variables === f.vars && ctx.objects === f.run.objects &&
    ctx.hidden === f.hidden && ctx.pendingDestroy === f.pending && ctx.destroyed === f.destroyed &&
    ctx.executionContext.obj1 === hero && ctx.dt === 1 &&
    ctx.canvasWidth === 800 && ctx.canvasHeight === 600 &&
    ctx.sceneId === 1 && ctx.pendingSceneId === null &&
    ctx.sceneStack === f.sceneStack && ctx.pauseState === f.run &&
    ctx.timers === f.timers && ctx.shake === f.run.cameraShake && ctx.flash === f.run.flash &&
    ctx.cameraFx === f.modules.CameraFx && ctx.save === f.modules.Save &&
    ctx.pause === f.modules.Pause && ctx.profile === f.modules.Profile &&
    ctx.particles === f.modules.Particles && ctx.particleState === null &&
    ctx.actions === f.modules.Actions && ctx.actionsState === null &&
    ctx.sceneInit === f.modules.SceneInit && ctx.physics2d === f.modules.Physics2D);
  check('actionCtx camera is the live run camera', ctx.camera === f.run.camera);
  delete f.run.camera;
  const ctx2 = T.actionCtx();
  check('actionCtx creates a default camera when the run has none',
    ctx2.camera.followTarget === '' && ctx2.camera.zoom === 1 && f.run.camera === ctx2.camera);
  check('actionCtx shakeCooldownOk allows the first shake and blocks inside the cooldown',
    // A 1ms cooldown: the first shake is long past the epoch baseline,
    // the immediate re-fire is inside the window, a new cell is free.
    ctx.shakeCooldownOk({ cooldown: 0.001 }, 3) === true &&
    ctx.shakeCooldownOk({ cooldown: 0.001 }, 3) === false &&
    ctx.shakeCooldownOk({ cooldown: 0.001 }, 4) === true);
  f.hidden.add(1);
  check('actionCtx named without includeHidden skips hidden objects',
    ctx.named('hero').length === 0);
  check('actionCtx named with includeHidden keeps them',
    ctx.named('hero', true).length === 1);
  ctx.requestScene(2);
  check('requestScene queues the pending scene on the run state', f.run.pendingSceneId === 2);
  check('actionCtx buses lazily resolve from the host',
    ctx.buses && ctx.buses.sfx.volume === 1 && f.run.buses === ctx.buses);
  ctx.setMasterVolume(0.5);
  check('setMasterVolume writes the run state', f.run.masterVolume === 0.5);
  check('actionCtx storage is null without a localStorage', ctx.storage === null);
  check('actionCtx nowMs and frozenNowMs read the clock',
    typeof ctx.nowMs() === 'number' && typeof ctx.frozenNowMs() === 'number');
  check('actionCtx language round-trips through the run state',
    ctx.getLanguage() === 'en');
  ctx.setLanguage('fr');
  check('actionCtx setLanguage writes the run language',
    f.run.language === 'fr' && ctx.getLanguage() === 'fr');
  ctx.playSound({ assetId: 'a' }, 4);
  check('actionCtx playSound routes through the host with the cell key',
    f.calls.playSound.length === 1 && f.calls.playSound[0][1] === 'sound_4');
  ctx.stopMusic(); ctx.pauseMusic(); ctx.resumeMusic(); ctx.stopAllSounds();
  check('actionCtx music controls route through the host',
    f.calls.stopMusic === 1 && f.calls.pauseMusic === 1 &&
    f.calls.resumeMusic === 1 && f.calls.stopAll === 1);
  check('actionCtx sceneInitHooks come from the host',
    ctx.sceneInitHooks().sceneInit === true);
  ctx.warn('hello');
  ctx.reportUnknown('nope');
  ctx.warnFlashColor('#bad');
  ctx.warnReadTimerBlank('timer');
  eq('actionCtx warn and reportUnknown reach diagnostics once each',
    f.diagnostics.map(d => d[1]), [
      'hello',
      'Unknown action block type "nope". The block was skipped; check the block catalog or re-add the block.',
      'Screen Flash: the color "#bad" is not a valid hex color, so the flash was skipped. Use a color like #ffffff.',
      'Read Timer: the timer name is blank, so it read 0 seconds. Name the timer you want to read.'
    ]);
  check('actionCtx worldSize and scene helpers read through the host',
    ctx.worldSize().width === 800 && ctx.getScene() === f.scenes[0] &&
    ctx.sceneObjectDefs().length === 0 && ctx.scenes === f.scenes);
  ctx.clampCamera();
  ctx.updateCameraFollow();
  check('actionCtx camera helpers route through the host',
    f.calls.clampCamera === 1 && f.calls.updateFollow === 1);
  ctx.applyBoundTexts();
  check('actionCtx applyBoundTexts routes through the host', f.calls.applyBoundTexts === 1);

  T.executeAction({ type: 'setVariable' }, 2);
  check('executeAction delegates to the Execute stub with data, ctx, idx',
    f.calls.execute.length === 1 && f.calls.execute[0][0].type === 'setVariable' &&
    f.calls.execute[0][2] === 2 && typeof f.calls.execute[0][1] === 'object');
  const T2 = factory();
  const f2 = makeDispatchHost(T2);
  delete f2.modules.Execute;
  noThrow('executeAction with no Execute module does not throw', () => T2.executeAction({ type: 'setVariable' }, 0));
  check('executeAction with no Execute module runs nothing', f2.calls.execute.length === 0);
}

// --- dialogue runtime (P4 Advanced batch 7) ------------------------------------------
{
  const guardDialogue = [{
    id: 'dlg_guard', name: 'Guard intro',
    lines: [
      { speaker: 'Guard', text: 'Halt! Who goes there?' },
      { speaker: 'Hero', text: 'Just a traveler.',
        choices: [
          { label: 'Show the pass', goto: 2 },
          { label: 'Run away', goto: 3 }
        ] },
      { speaker: 'Guard', text: 'Pass accepted. Move along.' },
      { speaker: 'Guard', text: 'Guards! Seize them!' }
    ]
  }];
  const T = factory();
  const f = makeDispatchHost(T, { getProjectDialogues: () => guardDialogue });
  const who = { id: 11, name: 'who', kind: 'text', posX: 0, posY: 0, width: 100, height: 20, text: '' };
  const line = { id: 12, name: 'line', kind: 'text', posX: 0, posY: 30, width: 200, height: 20, text: '' };
  f.run.objects = [who, line];

  // The Frame stub calls the runScripts hook (the only phase the
  // dialogue typewriter needs), mirroring the real HydraFrame order
  // where scripts run whether the game is paused or not.
  f.modules.Frame = {
    stepFrame: (h) => { if (typeof h.runScripts === 'function') h.runScripts(); return true; }
  };
  const rt = T.dialogueRuntime();
  check('dialogueRuntime returns a fresh inactive runtime',
    !!rt && rt.active === false && rt.lineIndex === 0 && rt.revealed === 0);
  check('dialogueRuntime returns the same runtime on repeat calls',
    T.dialogueRuntime() === rt);
  const T2 = factory();
  const f2 = makeDispatchHost(T2, { getProjectDialogues: () => guardDialogue });
  check('each preview runtime holds an independent dialogue runtime',
    T2.dialogueRuntime() !== rt && T2.dialogueRuntime().active === false);

  check('conditionCtx carries the live dialogue runtime',
    T.conditionCtx().dialogue === rt);
  const actx = T.actionCtx();
  check('actionCtx carries the dialogue module, runtime, table, and hooks',
    actx.dialogueModule === Dlg && actx.dialogue === rt &&
    actx.dialogues === guardDialogue && typeof actx.dialogueHooks === 'function');

  Dlg.startDialogue(rt, guardDialogue, 'Guard intro',
    { charsPerSec: 400, speakerObject: 'who', textObject: 'line' }, T.dialogueHooks());
  check('starting a dialogue through the preview hooks binds the speaker',
    rt.active === true && who._runtimeText === 'Guard' && line._runtimeText === '');
  T.updatePreviewDialogue(1);
  check('updatePreviewDialogue advances the typewriter into the bound line',
    (line._runtimeText || '').length > 0 && (line._runtimeText || '').length < 21,
    JSON.stringify(line._runtimeText));
  T.updatePreviewDialogue(60);
  check('updatePreviewDialogue finishes the line over more frames',
    line._runtimeText === 'Halt! Who goes there?', JSON.stringify(line._runtimeText));
  f.hidden.add(12);
  Dlg.advanceDialogue(rt, T.dialogueHooks());
  Dlg.advanceDialogue(rt, T.dialogueHooks());
  T.updatePreviewDialogue(60);
  check('dialogue hooks skip hidden text objects',
    line._runtimeText === 'Halt! Who goes there?' && rt.waitingChoice === true);
  f.hidden.delete(12);
  T.updatePreviewDialogue(1);
  check('a visible line object receives the choice line once unhidden',
    line._runtimeText === 'Just a traveler.', JSON.stringify(line._runtimeText));

  // The frame loop advances the typewriter through its runScripts phase,
  // and keeps doing so while the game is paused (dialogue is UI).
  Dlg.stopDialogue(rt, T.dialogueHooks());
  Dlg.startDialogue(rt, guardDialogue, 'Guard intro',
    { charsPerSec: 400, speakerObject: 'who', textObject: 'line' }, T.dialogueHooks());
  T.startGame();
  T.gameLoop(1000);
  check('the first loop frame reveals nothing (dt 0)',
    line._runtimeText === '');
  T.gameLoop(1016.67);
  check('the loop advances the typewriter on the second frame',
    (line._runtimeText || '').length > 0 && (line._runtimeText || '').length < 21,
    JSON.stringify(line._runtimeText));
  const beforePause = line._runtimeText;
  f.run.paused = true;
  T.gameLoop(1033.34);
  check('the typewriter still advances while the game is paused',
    (line._runtimeText || '').length > (beforePause || '').length,
    JSON.stringify({ before: beforePause, after: line._runtimeText }));
  f.run.paused = false;

  T.sceneResetHooks().resetDialogue();
  check('sceneResetHooks resetDialogue ends a running dialogue',
    rt.active === false);
  check('ending a dialogue leaves the last line on the bound label',
    line._runtimeText === 'Halt! Who goes there?' || (line._runtimeText || '').length > 0,
    JSON.stringify(line._runtimeText));
  const oldRt = T.dialogueRuntime();
  Dlg.startDialogue(oldRt, guardDialogue, 'Guard intro',
    { charsPerSec: 400, speakerObject: 'who', textObject: 'line' }, T.dialogueHooks());
  T.resetGame();
  check('resetGame replaces the dialogue runtime with a fresh inactive one',
    T.dialogueRuntime() !== oldRt && T.dialogueRuntime().active === false);

  // No Dialogue module: everything degrades quietly.
  const T3 = factory();
  const f3 = makeDispatchHost(T3);
  delete f3.modules.Dialogue;
  check('dialogueRuntime is null without the Dialogue module',
    T3.dialogueRuntime() === null);
  check('conditionCtx dialogue is null without the Dialogue module',
    T3.conditionCtx().dialogue === null);
  check('actionCtx dialogue fields are null without the Dialogue module',
    T3.actionCtx().dialogueModule === null && T3.actionCtx().dialogue === null &&
    Array.isArray(T3.actionCtx().dialogues) && T3.actionCtx().dialogues.length === 0);
  noThrow('updatePreviewDialogue without the module does not throw',
    () => T3.updatePreviewDialogue(1));
  noThrow('sceneResetHooks resetDialogue without the module does not throw',
    () => T3.sceneResetHooks().resetDialogue());
  noThrow('resetGame without the module does not throw', () => T3.resetGame());
}

// --- inventory runtime (P4 Advanced batch 8) ------------------------------------------
{
  const guardItems = [
    { id: 'itm_key', name: 'Brass key', maxStack: 1, description: 'Opens the cellar door.' },
    { id: 'itm_coin', name: 'Gold coin', maxStack: 99, description: 'Spend it at the shop.' }
  ];
  const T = factory();
  const f = makeDispatchHost(T, { getProjectItems: () => guardItems });
  const rt = T.inventoryRuntime();
  check('inventoryRuntime returns a fresh empty backpack',
    !!rt && typeof rt.counts === 'object' && Object.keys(rt.counts).length === 0);
  check('inventoryRuntime returns the same runtime on repeat calls',
    T.inventoryRuntime() === rt);
  const T2 = factory();
  const f2 = makeDispatchHost(T2, { getProjectItems: () => guardItems });
  check('each preview runtime holds an independent backpack',
    T2.inventoryRuntime() !== rt && Object.keys(T2.inventoryRuntime().counts).length === 0);

  check('conditionCtx carries the live backpack runtime',
    T.conditionCtx().inventory === rt);
  const actx = T.actionCtx();
  check('actionCtx carries the inventory module, runtime, table, and hooks',
    actx.inventoryModule === Inv && actx.inventory === rt &&
    actx.items === guardItems && typeof actx.inventoryHooks === 'function');

  Inv.addItem(rt, guardItems, 'Gold coin', 5, T.inventoryHooks());
  check('adding through the preview hooks fills the backpack',
    Inv.itemCount(rt, 'Gold coin') === 5);
  Inv.addItem(rt, guardItems, 'Brass key', 2, T.inventoryHooks());
  check('the preview backpack respects a max stack of 1',
    Inv.itemCount(rt, 'Brass key') === 1);
  check('a warning through the preview hooks lands in the diagnostics',
    (() => {
      const before = f.diagnostics.length;
      Inv.addItem(rt, guardItems, 'Nobody', 1, T.inventoryHooks());
      return f.diagnostics.length === before + 1 &&
        /no item named "Nobody"/.test(f.diagnostics[f.diagnostics.length - 1][1]);
    })());
  check('sceneResetHooks offers no resetInventory entry (the backpack survives scene switches)',
    T.sceneResetHooks().resetInventory === undefined);
  Inv.addItem(rt, guardItems, 'Gold coin', 3, T.inventoryHooks());
  check('the backpack still holds its items after the scene-reset hooks are built',
    Inv.itemCount(rt, 'Gold coin') === 8);
  const oldRt = T.inventoryRuntime();
  T.resetGame();
  check('resetGame replaces the backpack with a fresh empty one',
    T.inventoryRuntime() !== oldRt && Object.keys(T.inventoryRuntime().counts).length === 0);

  // No Inventory module: everything degrades quietly.
  const T3 = factory();
  const f3 = makeDispatchHost(T3);
  delete f3.modules.Inventory;
  check('inventoryRuntime is null without the Inventory module',
    T3.inventoryRuntime() === null);
  check('conditionCtx inventory is null without the Inventory module',
    T3.conditionCtx().inventory === null);
  check('actionCtx inventory fields are null without the Inventory module',
    T3.actionCtx().inventoryModule === null && T3.actionCtx().inventory === null &&
    Array.isArray(T3.actionCtx().items) && T3.actionCtx().items.length === 0);
  noThrow('resetGame without the module does not throw', () => T3.resetGame());
}

// --- quest runtime (P4 Advanced batch 9) ----------------------------------------------
{
  const guardQuests = [
    { id: 'qst_coins', name: 'Collect 4 coins', target: 4, description: 'Pick up every coin in Level 1.' },
    { id: 'qst_foes', name: 'Defeat 3 enemies', target: 3, description: 'Clear the level of enemies.' },
    { id: 'qst_goal', name: 'Reach the goal', target: 1, description: 'Finish the level.' }
  ];
  const T = factory();
  const f = makeDispatchHost(T, { getProjectQuests: () => guardQuests });
  const rt = T.questLogRuntime();
  check('questLogRuntime returns a fresh empty quest log',
    !!rt && typeof rt.progress === 'object' && typeof rt.done === 'object' &&
    Object.keys(rt.progress).length === 0 && Object.keys(rt.done).length === 0);
  check('questLogRuntime returns the same runtime on repeat calls',
    T.questLogRuntime() === rt);
  const T2 = factory();
  const f2 = makeDispatchHost(T2, { getProjectQuests: () => guardQuests });
  check('each preview runtime holds an independent quest log',
    T2.questLogRuntime() !== rt && Object.keys(T2.questLogRuntime().progress).length === 0);

  check('conditionCtx carries the live quest log runtime',
    T.conditionCtx().questLog === rt);
  const actx = T.actionCtx();
  check('actionCtx carries the quest module, log, table, and hooks',
    actx.questModule === Qst && actx.questLog === rt &&
    actx.quests === guardQuests && typeof actx.questHooks === 'function');

  Qst.addQuestProgress(rt, guardQuests, 'Collect 4 coins', 3, T.questHooks());
  check('adding through the preview hooks fills the quest log',
    Qst.questProgress(rt, 'Collect 4 coins') === 3);
  Qst.addQuestProgress(rt, guardQuests, 'Reach the goal', 99, T.questHooks());
  check('the preview quest log clamps at the target and completes',
    Qst.questProgress(rt, 'Reach the goal') === 1 && Qst.isQuestComplete(rt, guardQuests, 'Reach the goal') === true);
  check('a warning through the preview hooks lands in the diagnostics',
    (() => {
      const before = f.diagnostics.length;
      Qst.addQuestProgress(rt, guardQuests, 'Nobody', 1, T.questHooks());
      return f.diagnostics.length === before + 1 &&
        /no quest named "Nobody"/.test(f.diagnostics[f.diagnostics.length - 1][1]);
    })());
  check('sceneResetHooks offers no resetQuestLog entry (the log survives scene switches)',
    T.sceneResetHooks().resetQuestLog === undefined);
  Qst.addQuestProgress(rt, guardQuests, 'Collect 4 coins', 1, T.questHooks());
  check('the quest log still holds its progress after the scene-reset hooks are built',
    Qst.questProgress(rt, 'Collect 4 coins') === 4 && Qst.isQuestComplete(rt, guardQuests, 'Collect 4 coins') === true);
  const oldRt = T.questLogRuntime();
  T.resetGame();
  check('resetGame replaces the quest log with a fresh empty one',
    T.questLogRuntime() !== oldRt && Object.keys(T.questLogRuntime().progress).length === 0 &&
    Object.keys(T.questLogRuntime().done).length === 0);

  // No Quest module: everything degrades quietly.
  const T3 = factory();
  const f3 = makeDispatchHost(T3);
  delete f3.modules.Quest;
  check('questLogRuntime is null without the Quest module',
    T3.questLogRuntime() === null);
  check('conditionCtx questLog is null without the Quest module',
    T3.conditionCtx().questLog === null);
  check('actionCtx quest fields are null without the Quest module',
    T3.actionCtx().questModule === null && T3.actionCtx().questLog === null &&
    Array.isArray(T3.actionCtx().quests) && T3.actionCtx().quests.length === 0);
  noThrow('resetGame without the module does not throw', () => T3.resetGame());
}

// --- achievement runtime (P4 Advanced batch 10) --------------------------------------
{
  const guardAchievements = [
    { id: 'ach_coins', name: 'Coin hoarder', description: 'Collect 100 coins across any number of runs.' },
    { id: 'ach_flawless', name: 'Flawless', description: 'Finish a level without dying.' },
    { id: 'ach_veteran', name: 'Veteran', description: 'Beat every level.' }
  ];
  const T = factory();
  const f = makeDispatchHost(T, { getProjectAchievements: () => guardAchievements, getProjectId: () => 'preview-game' });
  const rt = T.achievementRuntime();
  check('achievementRuntime returns a fresh empty unlocked set',
    !!rt && typeof rt.unlocked === 'object' && Object.keys(rt.unlocked).length === 0);
  check('achievementRuntime returns the same runtime on repeat calls',
    T.achievementRuntime() === rt);
  const T2 = factory();
  const f2 = makeDispatchHost(T2, { getProjectAchievements: () => guardAchievements, getProjectId: () => 'preview-game' });
  check('each preview runtime holds an independent unlocked set',
    T2.achievementRuntime() !== rt && Object.keys(T2.achievementRuntime().unlocked).length === 0);

  check('conditionCtx carries the live unlocked set',
    T.conditionCtx().achievementLog === rt);
  const actx = T.actionCtx();
  check('actionCtx carries the achievement module, set, table, and hooks',
    actx.achievementModule === Ach && actx.achievementLog === rt &&
    actx.achievements === guardAchievements && typeof actx.achievementHooks === 'function');

  Ach.unlockAchievement(rt, guardAchievements, 'Coin hoarder', T.achievementHooks());
  check('unlocking through the preview hooks marks the achievement',
    Ach.isAchievementUnlocked(rt, 'Coin hoarder') === true && Ach.achievementCount(rt) === 1);
  check('a warning through the preview hooks lands in the diagnostics',
    (() => {
      const before = f.diagnostics.length;
      Ach.unlockAchievement(rt, guardAchievements, 'Nobody', T.achievementHooks());
      return f.diagnostics.length === before + 1 &&
        /no achievement named "Nobody"/.test(f.diagnostics[f.diagnostics.length - 1][1]);
    })());
  check('sceneResetHooks offers no achievement reset entry (the set survives scene switches)',
    T.sceneResetHooks().resetAchievements === undefined &&
    T.sceneResetHooks().resetAchievementLog === undefined);
  check('the unlocked set still holds after the scene-reset hooks are built',
    Ach.isAchievementUnlocked(rt, 'Coin hoarder') === true);
  const oldRt = T.achievementRuntime();
  T.resetGame();
  check('resetGame does NOT clear the unlocked set (permanence is the point)',
    T.achievementRuntime() === oldRt && Ach.isAchievementUnlocked(T.achievementRuntime(), 'Coin hoarder') === true);
  noThrow('persistAchievements without storage does not throw', () => T.persistAchievements());

  // No Achievement module: everything degrades quietly.
  const T3 = factory();
  const f3 = makeDispatchHost(T3);
  delete f3.modules.Achievement;
  check('achievementRuntime is null without the Achievement module',
    T3.achievementRuntime() === null);
  check('conditionCtx achievementLog is null without the Achievement module',
    T3.conditionCtx().achievementLog === null);
  check('actionCtx achievement fields are null without the Achievement module',
    T3.actionCtx().achievementModule === null && T3.actionCtx().achievementLog === null &&
    Array.isArray(T3.actionCtx().achievements) && T3.actionCtx().achievements.length === 0);
  noThrow('resetGame without the module does not throw', () => T3.resetGame());
}

// --- cutscene runtime (P4 Advanced batch 11) ---------------------------------------
{
  const guardCutscenes = [
    { id: 'cts_intro', name: 'Intro', description: 'The opening crawl.',
      steps: [
        { kind: 'text', object: 'Caption', text: 'A long time ago...', seconds: 2 },
        { kind: 'move', object: 'Hero', x: 400, y: 300, seconds: 2 },
        { kind: 'sound', sound: 'Fanfare' },
        { kind: 'wait', seconds: 1 },
        { kind: 'scene', scene: 'Level 2' }
      ] },
    { id: 'cts_ending', name: 'Ending', description: 'The end.',
      steps: [{ kind: 'wait', seconds: 1 }] }
  ];
  const T = factory();
  const f = makeDispatchHost(T, {
    getProjectCutscenes: () => guardCutscenes,
    getAssetLibrary: () => ({ snd1: { name: 'Fanfare' } })
  });
  f.run.objects.push(
    { id: 1, name: 'Hero', kind: 'sprite', posX: 0, posY: 0, width: 40, height: 40 },
    { id: 2, name: 'Caption', kind: 'text', posX: 100, posY: 100, width: 200, height: 30, text: '' }
  );
  const hero = () => f.run.objects.find(o => o.name === 'Hero');
  const caption = () => f.run.objects.find(o => o.name === 'Caption');
  const rt = T.cutsceneRuntime();
  check('cutsceneRuntime returns a fresh idle runtime',
    !!rt && rt.active === null && rt.stepIndex === 0 && rt.lastFinished === null);
  check('cutsceneRuntime returns the same runtime on repeat calls',
    T.cutsceneRuntime() === rt);
  const T2 = factory();
  const f2 = makeDispatchHost(T2, { getProjectCutscenes: () => guardCutscenes });
  check('each preview runtime holds an independent cutscene runtime',
    T2.cutsceneRuntime() !== rt && T2.cutsceneRuntime().active === null);

  check('conditionCtx carries the live cutscene runtime',
    T.conditionCtx().cutscene === rt);
  const actx = T.actionCtx();
  check('actionCtx carries the cutscene module, runtime, table, and hooks',
    actx.cutsceneModule === Cut && actx.cutscene === rt &&
    actx.cutscenes === guardCutscenes && typeof actx.cutsceneHooks === 'function');

  // Drive the full Intro through the preview hooks (dt is in 60fps
  // units: 60 is one second).
  Cut.playCutscene(rt, guardCutscenes, 'Intro', T.cutsceneHooks());
  T.updatePreviewCutscene(0);
  check('the preview text step applies its text at step start',
    caption()._runtimeText === 'A long time ago...' && rt.stepIndex === 0);
  T.updatePreviewCutscene(60);
  check('the preview text step holds until its seconds elapse',
    rt.stepIndex === 0 && rt.stepElapsed === 1);
  T.updatePreviewCutscene(60);
  check('the preview text step ends and the move step starts from the live position',
    rt.stepIndex === 1 && rt.stepStarted === true && hero().posX === 0 && hero().posY === 0);
  T.updatePreviewCutscene(60);
  check('the preview move step glides the live object halfway',
    hero().posX === 200 && hero().posY === 150, JSON.stringify(hero()));
  T.updatePreviewCutscene(60);
  check('the preview move step snaps to its target, then the sound step plays and the wait starts in the same frame',
    hero().posX === 400 && hero().posY === 300 && rt.stepIndex === 3 &&
    f.calls.playSound.length === 1 && f.calls.playSound[0][0].assetId === 'snd1',
    JSON.stringify({ hero: hero(), step: rt.stepIndex, sounds: f.calls.playSound }));
  T.updatePreviewCutscene(60);
  check('the preview scene step queues the scene switch and the cutscene finishes in the same frame',
    f.run.pendingSceneId === 2 && rt.active === null &&
    Cut.isCutsceneFinished(rt, 'Intro') === true && Cut.isCutscenePlaying(rt, '') === false,
    JSON.stringify({ pending: f.run.pendingSceneId, step: rt.stepIndex }));
  check('a warning through the preview hooks lands in the diagnostics',
    (() => {
      const before = f.diagnostics.length;
      Cut.playCutscene(rt, guardCutscenes, 'Nobody', T.cutsceneHooks());
      return f.diagnostics.length === before + 1 &&
        /no cutscene named "Nobody"/.test(f.diagnostics[f.diagnostics.length - 1][1]);
    })());
  check('sceneResetHooks offers no cutscene reset entry (the runtime survives scene switches)',
    T.sceneResetHooks().resetCutscene === undefined &&
    T.sceneResetHooks().resetCutsceneRuntime === undefined);
  check('the cutscene still holds its finished record after the scene-reset hooks are built',
    Cut.isCutsceneFinished(rt, 'Intro') === true);
  const oldRt = T.cutsceneRuntime();
  T.resetGame();
  check('resetGame replaces the cutscene runtime with a fresh idle one',
    T.cutsceneRuntime() !== oldRt && T.cutsceneRuntime().active === null &&
    T.cutsceneRuntime().lastFinished === null);

  // Pause freezes the preview cutscene.
  const T4 = factory();
  const f4 = makeDispatchHost(T4, { getProjectCutscenes: () => guardCutscenes });
  f4.run.objects.push(
    { id: 2, name: 'Caption', kind: 'text', posX: 100, posY: 100, width: 200, height: 30, text: '' }
  );
  const rt4 = T4.cutsceneRuntime();
  Cut.playCutscene(rt4, guardCutscenes, 'Intro', T4.cutsceneHooks());
  f4.run.paused = true;
  T4.updatePreviewCutscene(600);
  check('the preview cutscene freezes while paused',
    rt4.stepIndex === 0 && rt4.stepStarted === false &&
    f4.run.objects[0]._runtimeText === undefined);

  // No Cutscene module: everything degrades quietly.
  const T3 = factory();
  const f3 = makeDispatchHost(T3);
  delete f3.modules.Cutscene;
  check('cutsceneRuntime is null without the Cutscene module',
    T3.cutsceneRuntime() === null);
  check('conditionCtx cutscene is null without the Cutscene module',
    T3.conditionCtx().cutscene === null);
  check('actionCtx cutscene fields are null without the Cutscene module',
    T3.actionCtx().cutsceneModule === null && T3.actionCtx().cutscene === null &&
    Array.isArray(T3.actionCtx().cutscenes) && T3.actionCtx().cutscenes.length === 0);
  noThrow('resetGame without the module does not throw', () => T3.resetGame());
  noThrow('updatePreviewCutscene without the module does not throw', () => T3.updatePreviewCutscene(60));
}

// --- high-score runtime (P4 Advanced batch 12) --------------------------------------
{
  const guardConfig = { maxEntries: 3, defaultName: 'Player' };
  const T = factory();
  const f = makeDispatchHost(T, { getProjectHighScores: () => guardConfig, getProjectId: () => 'preview-game' });
  const rt = T.highScoreRuntime();
  check('highScoreRuntime returns a fresh empty table',
    !!rt && Array.isArray(rt.entries) && rt.entries.length === 0);
  check('highScoreRuntime returns the same runtime on repeat calls',
    T.highScoreRuntime() === rt);
  const T2 = factory();
  const f2 = makeDispatchHost(T2, { getProjectHighScores: () => guardConfig, getProjectId: () => 'preview-game' });
  check('each preview runtime holds an independent table',
    T2.highScoreRuntime() !== rt && T2.highScoreRuntime().entries.length === 0);

  check('conditionCtx carries the live table and config',
    T.conditionCtx().highScoreTable === rt && T.conditionCtx().highScoreConfig === guardConfig);
  const actx = T.actionCtx();
  check('actionCtx carries the high-score module, table, config, and hooks',
    actx.highScoreModule === HS && actx.highScoreTable === rt &&
    actx.highScoreConfig === guardConfig && typeof actx.highScoreHooks === 'function');

  HS.submitScore(rt, guardConfig, 'Alex', 100, T.highScoreHooks());
  check('submitting through the preview hooks lands on the table',
    HS.highScoreCount(rt) === 1 && HS.readHighScore(rt, 1).name === 'Alex');
  check('a warning through the preview hooks lands in the diagnostics',
    (() => {
      const before = f.diagnostics.length;
      HS.submitScore(rt, guardConfig, 'Alex', 'lots', T.highScoreHooks());
      return f.diagnostics.length === before + 1 &&
        /not a number/.test(f.diagnostics[f.diagnostics.length - 1][1]);
    })());
  check('sceneResetHooks offers no high-score reset entry (the table survives scene switches)',
    T.sceneResetHooks().resetHighScores === undefined &&
    T.sceneResetHooks().resetHighScoreTable === undefined);
  check('the table still holds after the scene-reset hooks are built',
    HS.highScoreCount(rt) === 1);
  const oldRt = T.highScoreRuntime();
  T.resetGame();
  check('resetGame does NOT clear the table (permanence is the point)',
    T.highScoreRuntime() === oldRt && HS.highScoreCount(T.highScoreRuntime()) === 1);
  check('clearHighScoreTable empties the live table',
    T.clearHighScoreTable() === true && HS.highScoreCount(rt) === 0);
  check('clearHighScoreTable on an empty table changes nothing',
    T.clearHighScoreTable() === false);
  noThrow('persistHighScores without storage does not throw', () => T.persistHighScores());

  // No HighScore module: everything degrades quietly.
  const T3 = factory();
  const f3 = makeDispatchHost(T3);
  delete f3.modules.HighScore;
  check('highScoreRuntime is null without the HighScore module',
    T3.highScoreRuntime() === null);
  check('conditionCtx highScoreTable is null without the HighScore module',
    T3.conditionCtx().highScoreTable === null);
  check('actionCtx high-score fields are null without the HighScore module',
    T3.actionCtx().highScoreModule === null && T3.actionCtx().highScoreTable === null &&
    T3.actionCtx().highScoreConfig === null);
  check('clearHighScoreTable without the module stays quiet',
    T3.clearHighScoreTable() === false);
  noThrow('resetGame without the module does not throw', () => T3.resetGame());
}

// --- time-scale runtime (P4 Advanced batch 13) --------------------------------------
{
  const T = factory();
  const f = makeDispatchHost(T, {});
  const rt = T.timeScaleRuntime();
  check('timeScaleRuntime returns a fresh normal-speed runtime',
    !!rt && rt.scale === 1);
  check('timeScaleRuntime returns the same runtime on repeat calls',
    T.timeScaleRuntime() === rt);
  const T2 = factory();
  const f2 = makeDispatchHost(T2, {});
  check('each preview runtime holds an independent time-scale runtime',
    T2.timeScaleRuntime() !== rt && T2.timeScaleRuntime().scale === 1);

  check('conditionCtx carries the live time-scale runtime',
    T.conditionCtx().timeScale === rt);
  const actx = T.actionCtx();
  check('actionCtx carries the time-scale module, runtime, and hooks',
    actx.timeScaleModule === TS && actx.timeScale === rt &&
    typeof actx.timeScaleHooks === 'function');

  TS.setTimeScale(rt, 0.5, T.timeScaleHooks());
  check('setting through the preview hooks slows the runtime',
    TS.timeScaleOf(rt) === 0.5);
  check('a warning through the preview hooks lands in the diagnostics',
    (() => {
      const before = f.diagnostics.length;
      TS.setTimeScale(rt, 'lots', T.timeScaleHooks());
      return f.diagnostics.length === before + 1 &&
        /not a number/.test(f.diagnostics[f.diagnostics.length - 1][1]);
    })());
  check('sceneResetHooks offers no time-scale reset entry (the scale survives scene switches)',
    T.sceneResetHooks().resetTimeScale === undefined &&
    T.sceneResetHooks().resetTimeScaleRuntime === undefined);
  check('the scale still holds after the scene-reset hooks are built',
    TS.timeScaleOf(rt) === 0.5);
  const oldRt = T.timeScaleRuntime();
  T.resetGame();
  check('resetGame replaces the time-scale runtime with a fresh normal-speed one',
    T.timeScaleRuntime() !== oldRt && T.timeScaleRuntime().scale === 1);

  // The frame loop scales dt and banks the clock debt.
  const T4 = factory();
  const f4 = makeDispatchHost(T4, {});
  const rt4 = T4.timeScaleRuntime();
  T4.startGame();
  T4.gameLoop(1000);
  check('first running frame writes dt 0',
    f4.run.dt === 0, `dt=${f4.run.dt}`);
  TS.setTimeScale(rt4, 0.5, T4.timeScaleHooks());
  T4.gameLoop(1016.67);
  check('gameLoop scales the frame step at half speed',
    Math.abs(f4.run.dt - 0.5) < 1e-9, `dt=${f4.run.dt}`);
  check('gameLoop banks the un-scaled portion into the clock debt',
    Math.abs(f4.run.timeScaleDebtMs - 8.335) < 0.01, `debt=${f4.run.timeScaleDebtMs}`);
  f4.run.paused = true;
  T4.gameLoop(1033.34);
  check('a paused frame banks no clock debt',
    Math.abs(f4.run.timeScaleDebtMs - 8.335) < 0.01, `debt=${f4.run.timeScaleDebtMs}`);
  f4.run.paused = false;

  // No TimeScale module: everything degrades quietly.
  const T3 = factory();
  const f3 = makeDispatchHost(T3);
  delete f3.modules.TimeScale;
  check('timeScaleRuntime is null without the TimeScale module',
    T3.timeScaleRuntime() === null);
  check('conditionCtx timeScale is null without the TimeScale module',
    T3.conditionCtx().timeScale === null);
  check('actionCtx time-scale fields are null without the TimeScale module',
    T3.actionCtx().timeScaleModule === null && T3.actionCtx().timeScale === null);
  noThrow('resetGame without the module does not throw', () => T3.resetGame());
  noThrow('gameLoop without the module does not throw', () => { T3.startGame(); T3.gameLoop(1000); });
}

// --- transition runtime (P4 Advanced batch 14) ---------------------------------------
{
  const guardConfig = { effect: 'fade', duration: 0.5 };
  const T = factory();
  const f = makeDispatchHost(T, { getProjectTransitionConfig: () => guardConfig });
  const rt = T.transitionRuntime();
  check('transitionRuntime returns a fresh idle runtime',
    !!rt && rt.phase === 'idle' && rt.effect === 'fade' && rt.pendingScene === null && rt.lastFinished === null);
  check('transitionRuntime returns the same runtime on repeat calls',
    T.transitionRuntime() === rt);
  const T2 = factory();
  const f2 = makeDispatchHost(T2, { getProjectTransitionConfig: () => guardConfig });
  check('each preview runtime holds an independent transition runtime',
    T2.transitionRuntime() !== rt && T2.transitionRuntime().phase === 'idle');

  check('conditionCtx carries the live transition runtime',
    T.conditionCtx().transition === rt);
  const actx = T.actionCtx();
  check('actionCtx carries the transition module, runtime, config, and hooks',
    actx.transitionModule === TR && actx.transition === rt &&
    actx.transitionConfig === guardConfig && typeof actx.transitionHooks === 'function');

  // Drive a full fade through the preview hooks (dt is in 60fps
  // units: 15 is a quarter second, half of the 0.5s default).
  check('starting through the preview hooks begins the out half',
    TR.startTransition(rt, guardConfig, 'Level 2', {}, T.transitionHooks()) === true &&
    rt.phase === 'out' && rt.pendingScene === 'Level 2');
  T.updatePreviewTransition(7.5);
  check('the preview transition is still fading out halfway through the out half',
    rt.phase === 'out' && f.run.pendingSceneId == null &&
    Math.abs(TR.transitionAlpha(rt) - 0.5) < 0.001, `alpha=${TR.transitionAlpha(rt)}`);
  T.updatePreviewTransition(7.5);
  check('the preview out half ending queues the scene switch and starts the in half',
    rt.phase === 'in' && f.run.pendingSceneId === 2 && rt.elapsed === 0,
    JSON.stringify({ pending: f.run.pendingSceneId, phase: rt.phase }));
  T.updatePreviewTransition(15);
  check('the preview in half ending marks the scene finished',
    rt.phase === 'idle' && TR.isTransitionFinished(rt, 'Level 2') === true);
  check('a warning through the preview hooks lands in the diagnostics',
    (() => {
      const before = f.diagnostics.length;
      TR.startTransition(rt, guardConfig, 'Nope', {}, T.transitionHooks());
      return f.diagnostics.length === before + 1 &&
        /no scene named "Nope"/.test(f.diagnostics[f.diagnostics.length - 1][1]);
    })());
  check('sceneResetHooks offers no transition reset entry (the transition survives scene switches)',
    T.sceneResetHooks().resetTransition === undefined &&
    T.sceneResetHooks().resetTransitionRuntime === undefined);
  check('the transition still holds its finished record after the scene-reset hooks are built',
    TR.isTransitionFinished(rt, 'Level 2') === true);
  const oldRt = T.transitionRuntime();
  T.resetGame();
  check('resetGame replaces the transition runtime with a fresh idle one',
    T.transitionRuntime() !== oldRt && T.transitionRuntime().phase === 'idle' &&
    T.transitionRuntime().lastFinished === null);

  // Pause freezes the preview transition.
  const T4 = factory();
  const f4 = makeDispatchHost(T4, { getProjectTransitionConfig: () => guardConfig });
  const rt4 = T4.transitionRuntime();
  TR.startTransition(rt4, guardConfig, 'Level 2', {}, T4.transitionHooks());
  f4.run.paused = true;
  T4.updatePreviewTransition(600);
  check('the preview transition freezes while paused',
    rt4.phase === 'out' && rt4.elapsed === 0 && f4.run.pendingSceneId == null);

  // No Transition module: everything degrades quietly.
  const T3 = factory();
  const f3 = makeDispatchHost(T3);
  delete f3.modules.Transition;
  check('transitionRuntime is null without the Transition module',
    T3.transitionRuntime() === null);
  check('conditionCtx transition is null without the Transition module',
    T3.conditionCtx().transition === null);
  check('actionCtx transition fields are null without the Transition module',
    T3.actionCtx().transitionModule === null && T3.actionCtx().transition === null);
  noThrow('resetGame without the module does not throw', () => T3.resetGame());
  noThrow('updatePreviewTransition without the module does not throw', () => T3.updatePreviewTransition(15));
}

// --- camera-feel runtime (P4 Advanced batch 15) ---------------------------------------
{
  const T = factory();
  const f = makeDispatchHost(T);
  f.modules.CameraFeel = CF;
  const actx = T.actionCtx();
  check('actionCtx carries the camera-feel module, getter, and reset',
    actx.cameraFeelModule === CF && typeof actx.cameraFeel === 'function' &&
    typeof actx.resetCameraFeel === 'function');
  check('actionCtx cameraFeel reads null before any scene feel is set',
    actx.cameraFeel() === null);
  const feelScene = { cameraFeel: { smoothing: 0.7, deadzoneW: 50, deadzoneH: 30, bounds: { minX: 0, minY: 0, maxX: 400, maxY: 300 } } };
  const minted = T.sceneResetHooks().cameraFeelOf(feelScene);
  check('sceneResetHooks cameraFeelOf returns a fresh copy of the scene feel',
    minted && minted.smoothing === 0.7 && minted.deadzoneW === 50 && minted.deadzoneH === 30 &&
    JSON.stringify(minted.bounds) === JSON.stringify({ minX: 0, minY: 0, maxX: 400, maxY: 300 }) &&
    minted !== feelScene.cameraFeel && minted.bounds !== feelScene.cameraFeel.bounds,
    JSON.stringify(minted));
  // Drive the follow: hero at (400, 300) 50x40, canvas 800x600, zoom 2
  // (desired camera (225, 170), scene 800x600 so the internal scene-edge
  // clamp leaves it alone).
  f.canvas.width = 800; f.canvas.height = 600;
  f.run.objects = [{ id: 1, name: 'hero', posX: 400, posY: 300, width: 50, height: 40 }];
  f.run.dt = 1;
  f.run.cameraFeel = { smoothing: 0.5, deadzoneW: 0, deadzoneH: 0, bounds: null };
  f.run.camera = { x: 0, y: 0, zoom: 2, followTarget: 'hero' };
  T.updateCameraFollow();
  check('updateCameraFollow glides halfway at smoothing 0.5 in the preview',
    Math.abs(f.run.camera.x - 112.5) < 0.01 && Math.abs(f.run.camera.y - 85) < 0.01,
    JSON.stringify(f.run.camera));
  f.run.cameraFeel = { smoothing: 0.5, deadzoneW: 200, deadzoneH: 100, bounds: null };
  f.run.camera = { x: 225, y: 170, zoom: 2, followTarget: 'hero' };
  T.updateCameraFollow();
  check('updateCameraFollow holds inside the deadzone in the preview',
    f.run.camera.x === 225 && f.run.camera.y === 170, JSON.stringify(f.run.camera));
  f.run.cameraFeel = { smoothing: 0, deadzoneW: 0, deadzoneH: 0, bounds: { minX: 0, minY: 0, maxX: 800, maxY: 600 } };
  f.run.camera = { x: 0, y: 0, zoom: 2, followTarget: 'hero' };
  T.updateCameraFollow();
  check('updateCameraFollow snaps inside wide bounds in the preview',
    f.run.camera.x === 225 && f.run.camera.y === 170, JSON.stringify(f.run.camera));
  f.run.cameraFeel = { smoothing: 0, deadzoneW: 0, deadzoneH: 0, bounds: { minX: 0, minY: 0, maxX: 600, maxY: 450 } };
  f.run.objects = [{ id: 1, name: 'hero', posX: 700, posY: 500, width: 50, height: 40 }];
  T.updateCameraFollow();
  check('updateCameraFollow clamps the view inside tight bounds in the preview',
    f.run.camera.x === 200 && f.run.camera.y === 150, JSON.stringify(f.run.camera));
  // Reset Camera restores the scene feel (the harness scene has none, so
  // the defaults come back) as a fresh record.
  const beforeReset = f.run.cameraFeel;
  T.actionCtx().resetCameraFeel();
  check('resetCameraFeel restores the scene feel as a fresh record in the preview',
    f.run.cameraFeel && f.run.cameraFeel.smoothing === 0 && f.run.cameraFeel.bounds === null &&
    f.run.cameraFeel !== beforeReset, JSON.stringify(f.run.cameraFeel));
  // A dropped module tag falls back to the old snap, and the hooks read null.
  delete f.modules.CameraFeel;
  f.run.camera = { x: 0, y: 0, zoom: 2, followTarget: 'hero' };
  T.updateCameraFollow();
  check('updateCameraFollow snaps when the camera-feel module is dropped',
    f.run.camera.x === 525 && f.run.camera.y === 370, JSON.stringify(f.run.camera));
  check('sceneResetHooks cameraFeelOf reads null without the module',
    T.sceneResetHooks().cameraFeelOf(feelScene) === null);
  check('actionCtx cameraFeelModule reads null without the module (the live record still reads)',
    T.actionCtx().cameraFeelModule === null && T.actionCtx().cameraFeel() !== null);
}

// --- parallax wiring (P4 Advanced batch 16) ---------------------------------------------
{
  const T = factory();
  const f = makeDispatchHost(T);
  f.modules.Parallax = PX;
  check('conditionCtx carries the parallax module',
    T.conditionCtx().parallaxModule === PX);
  check('actionCtx carries the parallax module',
    T.actionCtx().parallaxModule === PX);
  delete f.modules.Parallax;
  check('conditionCtx parallaxModule reads null without the module',
    T.conditionCtx().parallaxModule === null);
  check('actionCtx parallaxModule reads null without the module',
    T.actionCtx().parallaxModule === null);
}

// --- spatial-audio wiring (P4 Advanced batch 17) ----------------------------------------
{
  const T = factory();
  const f = makeDispatchHost(T);
  f.modules.SpatialAudio = SA;
  check('actionCtx carries the spatial-audio module',
    T.actionCtx().spatialAudioModule === SA);
  delete f.modules.SpatialAudio;
  check('actionCtx spatialAudioModule reads null without the module',
    T.actionCtx().spatialAudioModule === null);
}

// --- pathfinding wiring (P4 Advanced batch 18) -------------------------------------------
{
  const T = factory();
  const f = makeDispatchHost(T);
  f.modules.Pathfind = PF;
  check('actionCtx carries the pathfind module',
    T.actionCtx().pathfindModule === PF);
  check('conditionCtx carries the pathfind module',
    T.conditionCtx().pathfindModule === PF);
  delete f.modules.Pathfind;
  check('actionCtx pathfindModule reads null without the module',
    T.actionCtx().pathfindModule === null);
  check('conditionCtx pathfindModule reads null without the module',
    T.conditionCtx().pathfindModule === null);
}

// --- AI behaviors wiring (P4 Advanced batch 19) -------------------------------------------
{
  const T = factory();
  const f = makeDispatchHost(T);
  f.modules.Ai = AI;
  check('actionCtx carries the AI module',
    T.actionCtx().aiModule === AI);
  check('conditionCtx carries the AI module',
    T.conditionCtx().aiModule === AI);
  delete f.modules.Ai;
  check('actionCtx aiModule reads null without the module',
    T.actionCtx().aiModule === null);
  check('conditionCtx aiModule reads null without the module',
    T.conditionCtx().aiModule === null);
}

// --- Health wiring (P4 Advanced batch 21) -------------------------------------------
{
  const T = factory();
  const f = makeDispatchHost(T);
  f.modules.Health = HP;
  check('actionCtx carries the health module',
    T.actionCtx().healthModule === HP);
  check('conditionCtx carries the health module',
    T.conditionCtx().healthModule === HP);
  delete f.modules.Health;
  check('actionCtx healthModule reads null without the module',
    T.actionCtx().healthModule === null);
  check('conditionCtx healthModule reads null without the module',
    T.conditionCtx().healthModule === null);
}

// --- Damage feedback wiring (P4 Advanced batch 22) ---
{
  const T = factory();
  const f = makeDispatchHost(T);
  f.host.ensurePreviewDamageNumberState = () =>
    f.run.damageNumbers || (f.run.damageNumbers = DF.createDamageNumberState());
  f.modules.DamageFx = DF;
  check('actionCtx carries the damage-feedback module',
    T.actionCtx().damageFxModule === DF);
  check('conditionCtx carries the damage-feedback module',
    T.conditionCtx().damageFxModule === DF);
  check('actionCtx damageNumbers starts empty (no state minted yet)',
    T.actionCtx().damageNumbers == null);
  const nums = T.actionCtx().ensureDamageNumbers();
  check('actionCtx ensureDamageNumbers mints a fresh empty number state',
    nums && Array.isArray(nums.numbers) && nums.numbers.length === 0);
  check('actionCtx damageNumbers reads the minted state afterwards',
    T.actionCtx().damageNumbers === nums);
  delete f.modules.DamageFx;
  check('actionCtx damageFxModule reads null without the module',
    T.actionCtx().damageFxModule === null);
  check('conditionCtx damageFxModule reads null without the module',
    T.conditionCtx().damageFxModule === null);
  delete f.host.ensurePreviewDamageNumberState;
  check('actionCtx ensureDamageNumbers reads null without the host entry',
    T.actionCtx().ensureDamageNumbers() === null);
}

// --- Respawn wiring (P4 Advanced batch 23) ---
{
  const T = factory();
  const f = makeDispatchHost(T);
  f.host.ensurePreviewRespawnState = () =>
    f.run.respawn || (f.run.respawn = RM.createRespawnState());
  f.modules.Respawn = RM;
  check('actionCtx carries the respawn module',
    T.actionCtx().respawnModule === RM);
  check('conditionCtx carries the respawn module',
    T.conditionCtx().respawnModule === RM);
  check('actionCtx respawn starts empty (no state minted yet)',
    T.actionCtx().respawn == null);
  const st = T.actionCtx().ensureRespawnState();
  check('actionCtx ensureRespawnState mints a fresh empty respawn state',
    st && st.point === null && st.count === 0 && JSON.stringify(st.initial) === '{}');
  check('actionCtx respawn reads the minted state afterwards',
    T.actionCtx().respawn === st);
  check('conditionCtx respawn reads the minted state too',
    T.conditionCtx().respawn === st);
  delete f.modules.Respawn;
  check('actionCtx respawnModule reads null without the module',
    T.actionCtx().respawnModule === null);
  check('conditionCtx respawnModule reads null without the module',
    T.conditionCtx().respawnModule === null);
  delete f.host.ensurePreviewRespawnState;
  check('actionCtx ensureRespawnState reads null without the host entry',
    T.actionCtx().ensureRespawnState() === null);
}

// --- Spawner wiring (P4 Advanced batch 24) ---
{
  const T = factory();
  const f = makeDispatchHost(T);
  f.host.ensurePreviewSpawnerState = () =>
    f.run.spawners || (f.run.spawners = SP.createSpawnerState());
  f.modules.Spawn = SP;
  check('actionCtx carries the spawn module',
    T.actionCtx().spawnModule === SP);
  check('conditionCtx carries the spawn module',
    T.conditionCtx().spawnModule === SP);
  check('actionCtx spawners starts empty (no state minted yet)',
    T.actionCtx().spawners == null);
  const st = T.actionCtx().ensureSpawnerState();
  check('actionCtx ensureSpawnerState mints a fresh empty spawner state',
    st && JSON.stringify(st.spawners) === '{}');
  check('actionCtx spawners reads the minted state afterwards',
    T.actionCtx().spawners === st);
  check('conditionCtx spawners reads the minted state too',
    T.conditionCtx().spawners === st);
  delete f.modules.Spawn;
  check('actionCtx spawnModule reads null without the module',
    T.actionCtx().spawnModule === null);
  check('conditionCtx spawnModule reads null without the module',
    T.conditionCtx().spawnModule === null);
  delete f.host.ensurePreviewSpawnerState;
  check('actionCtx ensureSpawnerState reads null without the host entry',
    T.actionCtx().ensureSpawnerState() === null);
}

// --- Lives wiring (P4 Advanced batch 25) ---
{
  const T = factory();
  const f = makeDispatchHost(T);
  f.modules.Lives = LV;
  check('actionCtx carries the lives module',
    T.actionCtx().livesModule === LV);
  check('conditionCtx carries the lives module',
    T.conditionCtx().livesModule === LV);
  check('actionCtx lives mints a fresh record at the default 3',
    T.actionCtx().lives && T.actionCtx().lives.lives === 3);
  check('conditionCtx lives reads the same record',
    T.conditionCtx().lives === T.actionCtx().lives &&
    T.conditionCtx().lives === T.livesRuntime());
  const first = T.livesRuntime();
  LV.loseLives(first, 2);
  check('the live record tracks losses (3 down to 1)',
    T.livesRuntime().lives === 1);
  T.resetLivesRuntime();
  check('resetLivesRuntime drops the record, and the next access mints a fresh 3',
    T.livesRuntime() !== first && T.livesRuntime().lives === 3);
  delete f.modules.Lives;
  check('actionCtx livesModule reads null without the module',
    T.actionCtx().livesModule === null);
  check('conditionCtx livesModule reads null without the module',
    T.conditionCtx().livesModule === null);
}

// --- XP wiring (P4 Advanced batch 30) ---
{
  const T = factory();
  const f = makeDispatchHost(T);
  f.modules.Xp = XP;
  check('actionCtx carries the XP module',
    T.actionCtx().xpModule === XP);
  check('conditionCtx carries the XP module',
    T.conditionCtx().xpModule === XP);
  check('actionCtx xp mints a fresh record at 0 XP at level 1',
    T.actionCtx().xp && T.actionCtx().xp.xp === 0 &&
    T.actionCtx().xp.xpPerLevel === 100);
  check('conditionCtx xp reads the same record',
    T.conditionCtx().xp === T.actionCtx().xp &&
    T.conditionCtx().xp === T.xpRuntime());
  const first = T.xpRuntime();
  XP.addXp(first, 100);
  check('the live record tracks gains (0 up to 100, level 2)',
    T.xpRuntime().xp === 100 && XP.levelOf(T.xpRuntime()) === 2);
  T.resetXpRuntime();
  check('resetXpRuntime drops the record, and the next access mints a fresh 0 at level 1',
    T.xpRuntime() !== first && T.xpRuntime().xp === 0 &&
    XP.levelOf(T.xpRuntime()) === 1);
  delete f.modules.Xp;
  check('actionCtx xpModule reads null without the module',
    T.actionCtx().xpModule === null);
  check('conditionCtx xpModule reads null without the module',
    T.conditionCtx().xpModule === null);
}

// --- Growth wiring (P4 Advanced batch 31) ---
{
  const T = factory();
  const f = makeDispatchHost(T);
  f.modules.Growth = GR;
  check('actionCtx carries the growth module',
    T.actionCtx().growthModule === GR);
  check('actionCtx growth mints a fresh record with no bonuses anywhere',
    T.actionCtx().growth && JSON.stringify(T.actionCtx().growth) === JSON.stringify({ byId: {} }));
  const first = T.growthRuntime();
  GR.addDamageBonus(first, 'hero', 5);
  check('the live record tracks growth (hero damage bonus 0 up to 5)',
    T.growthRuntime().byId.hero.damage === 5 &&
    GR.damageBonusOf(T.growthRuntime(), 'hero') === 5);
  T.resetGrowthRuntime();
  check('resetGrowthRuntime drops the record, and the next access mints a fresh empty record',
    T.growthRuntime() !== first && GR.damageBonusOf(T.growthRuntime(), 'hero') === 0 &&
    JSON.stringify(T.growthRuntime()) === JSON.stringify({ byId: {} }));
  delete f.modules.Growth;
  check('actionCtx growthModule reads null without the module',
    T.actionCtx().growthModule === null);
}

// --- Scaling wiring (P4 Advanced batch 32) ---
{
  const T = factory();
  const f = makeDispatchHost(T);
  f.modules.Scaling = SC;
  check('actionCtx carries the scaling module',
    T.actionCtx().scalingModule === SC);
  check('conditionCtx carries the scaling module',
    T.conditionCtx().scalingModule === SC);
  check('actionCtx scaling mints a fresh record with no levels anywhere',
    T.actionCtx().scaling && JSON.stringify(T.actionCtx().scaling) === JSON.stringify({ byId: {} }));
  const first = T.scalingRuntime();
  SC.setLevel(first, 'goblin', 3);
  check('the live record tracks scaling (goblin level 1 up to 3, +20 HP, +4 damage)',
    T.scalingRuntime().byId.goblin.level === 3 &&
    SC.levelOf(T.scalingRuntime(), 'goblin') === 3 &&
    SC.hpBonusOf(T.scalingRuntime(), 'goblin') === 20 &&
    SC.dmgBonusOf(T.scalingRuntime(), 'goblin') === 4);
  T.resetScalingRuntime();
  check('resetScalingRuntime drops the record, and the next access mints a fresh empty record',
    T.scalingRuntime() !== first && SC.levelOf(T.scalingRuntime(), 'goblin') === 1 &&
    JSON.stringify(T.scalingRuntime()) === JSON.stringify({ byId: {} }));
  delete f.modules.Scaling;
  check('actionCtx scalingModule reads null without the module',
    T.actionCtx().scalingModule === null);
  check('conditionCtx scalingModule reads null without the module',
    T.conditionCtx().scalingModule === null);
}

// --- Boss wiring (P4 Advanced batch 33) ---
{
  const T = factory();
  const f = makeDispatchHost(T);
  f.modules.Boss = BO;
  check('actionCtx carries the boss module',
    T.actionCtx().bossModule === BO);
  check('conditionCtx carries the boss module',
    T.conditionCtx().bossModule === BO);
  check('actionCtx boss mints a fresh record with no fight running',
    T.actionCtx().boss && JSON.stringify(T.actionCtx().boss) === JSON.stringify({ active: false, objectName: '', phases: 3, barVisible: false }));
  const first = T.bossRuntime();
  BO.startBoss(first, 'goblinKing', 3, true);
  check('the live record tracks the fight (goblinKing, 3 phases, bar showing)',
    T.bossRuntime().objectName === 'goblinKing' &&
    BO.isActive(T.bossRuntime()) === true &&
    BO.phaseOfState(T.bossRuntime(), 0.5) === 2);
  T.resetBossRuntime();
  check('resetBossRuntime drops the record, and the next access mints a fresh record with no fight',
    T.bossRuntime() !== first && BO.isActive(T.bossRuntime()) === false &&
    JSON.stringify(T.bossRuntime()) === JSON.stringify({ active: false, objectName: '', phases: 3, barVisible: false }));
  delete f.modules.Boss;
  check('actionCtx bossModule reads null without the module',
    T.actionCtx().bossModule === null);
  check('conditionCtx bossModule reads null without the module',
    T.conditionCtx().bossModule === null);
}

// --- Minimap wiring (P4 Advanced batch 36) ---
{
  const T = factory();
  const f = makeDispatchHost(T);
  f.modules.Minimap = MM;
  check('actionCtx carries the minimap module',
    T.actionCtx().minimapModule === MM);
  check('conditionCtx carries the minimap module',
    T.conditionCtx().minimapModule === MM);
  check('minimapState reads null before any scene load',
    T.minimapState() === null);
  const minted = T.sceneResetHooks().minimapOf({ minimap: { enabled: true, corner: 'bottom-left', size: 200, zoom: 2, showViewport: false } });
  check('sceneResetHooks minimapOf mints a fresh run record from the scene config',
    minted !== null && minted.visible === true && minted.corner === 'bottom-left' &&
    minted.size === 200 && minted.zoom === 2 && minted.showViewport === false);
  check('the live record is the record the contexts read',
    T.minimapState() === minted &&
    T.actionCtx().minimap === minted &&
    T.conditionCtx().minimap === minted);
  MM.setVisible(minted, false);
  check('a block hiding the map flips the same record the draw reads',
    T.minimapState().visible === false);
  T.sceneResetHooks().minimapOf({ minimap: { enabled: true } });
  check('a fresh scene re-mints from its own config (no leak from the last scene)',
    T.minimapState().visible === true && T.minimapState().size === 160);
  // Launch order: the scene reset mints the record into the run
  // state, then resetGame drops the module stash — the accessor
  // still reads the run state's record, which is the same object
  // the hook minted.
  f.run.minimap = T.minimapState();
  T.resetMinimapRuntime();
  check('minimapState survives the launch-order reset through the run state record',
    T.minimapState() === f.run.minimap && T.minimapState().visible === true && T.minimapState().size === 160);
  delete f.run.minimap;
  T.resetMinimapRuntime();
  check('resetMinimapRuntime drops the record, and the next scene load mints a fresh one',
    T.minimapState() === null);
  delete f.modules.Minimap;
  check('actionCtx minimapModule reads null without the module',
    T.actionCtx().minimapModule === null);
  check('conditionCtx minimapModule reads null without the module',
    T.conditionCtx().minimapModule === null);
  check('sceneResetHooks minimapOf reads null without the module',
    T.sceneResetHooks().minimapOf({ minimap: { enabled: true } }) === null);
}

// --- Attach wiring (P4 Advanced batch 37) ---
{
  const T = factory();
  const f = makeDispatchHost(T);
  f.modules.Attach = AT;
  check('actionCtx carries the attach module',
    T.actionCtx().attachModule === AT);
  check('conditionCtx carries the attach module',
    T.conditionCtx().attachModule === AT);
  check('attachState reads null before any scene load',
    T.attachState() === null &&
    T.actionCtx().attachments === null &&
    T.conditionCtx().attachments === null);
  const minted = T.sceneResetHooks().createAttachState();
  check('sceneResetHooks createAttachState mints a fresh empty link table',
    minted !== null && AT.attachCount(minted) === 0);
  // The real scene reset stores the hook's return on the run state;
  // the test host stands in for that assignment here.
  f.run.attachments = minted;
  check('the live record is the record the contexts read',
    T.attachState() === minted &&
    T.actionCtx().attachments === minted &&
    T.conditionCtx().attachments === minted);
  AT.attach(minted, 'hat', 'hero', 10, -20);
  check('a block attaching through the live record is visible to the contexts',
    T.attachState() !== null && AT.isAttached(T.attachState(), 'hat', 'hero') &&
    AT.isAttached(T.actionCtx().attachments, 'hat', 'hero'));
  const second = T.sceneResetHooks().createAttachState();
  f.run.attachments = second;
  check('a fresh scene re-mints an empty table (no leak from the last scene)',
    second !== minted && AT.attachCount(second) === 0 &&
    T.attachState() === second && AT.isAttached(T.attachState(), 'hat') === false);
  delete f.run.attachments;
  check('attachState reads null when the run state carries no table',
    T.attachState() === null);
  delete f.modules.Attach;
  check('actionCtx attachModule reads null without the module',
    T.actionCtx().attachModule === null);
  check('conditionCtx attachModule reads null without the module',
    T.conditionCtx().attachModule === null);
  check('sceneResetHooks createAttachState reads null without the module',
    T.sceneResetHooks().createAttachState() === null);
}

// --- Tags wiring (P4 Advanced batch 34) ---
{
  const T = factory();
  const f = makeDispatchHost(T);
  f.modules.Tags = TG;
  check('actionCtx carries the tags module',
    T.actionCtx().tagsModule === TG);
  check('conditionCtx carries the tags module',
    T.conditionCtx().tagsModule === TG);
  check('the tags module carries the tag reads and writes the blocks use',
    typeof T.actionCtx().tagsModule.hasTag === 'function' &&
    typeof T.actionCtx().tagsModule.countTagged === 'function' &&
    typeof T.actionCtx().tagsModule.addTag === 'function' &&
    typeof T.actionCtx().tagsModule.removeTag === 'function' &&
    typeof T.actionCtx().tagsModule.clearTags === 'function');
  delete f.modules.Tags;
  check('actionCtx tagsModule reads null without the module',
    T.actionCtx().tagsModule === null);
  check('conditionCtx tagsModule reads null without the module',
    T.conditionCtx().tagsModule === null);
  f.modules.Tags = TG;
  f.run.objects = [
    { id: 1, name: 'hero', posX: 0, posY: 0, width: 10, height: 10 },
    { id: 2, name: 'goblin', posX: 100, posY: 0, width: 10, height: 10, tags: ['goblin'] },
    { id: 3, name: 'goblin2', posX: 200, posY: 0, width: 10, height: 10, tags: ['Goblin'] }
  ];
  const ph = T.pickHooks();
  check('pickHooks liveObjectsByTag resolve by tag from the alive list',
    ph.liveObjectsByTag('goblin').map(o => o.id).join(',') === '2,3' &&
    ph.liveObjectsByTag('GOBLIN').length === 2 &&
    ph.liveObjectsByTag('boss').length === 0 &&
    ph.liveObjectsByTag('').length === 0);
  delete f.modules.Tags;
  check('pickHooks liveObjectsByTag read none without the Tags module',
    T.pickHooks().liveObjectsByTag('goblin').length === 0);
}

// --- Scoped variables wiring (P5 core-engine track, item P5-1 slice a) ---
{
  const T = factory();
  const f = makeDispatchHost(T);
  f.modules.Variables = VV;
  check('actionCtx carries the scoped-variables module',
    T.actionCtx().varScopesModule === VV);
  check('conditionCtx carries the scoped-variables module',
    T.conditionCtx().varScopesModule === VV);
  check('actionCtx varScopes mints a fresh record with no variables anywhere',
    T.actionCtx().varScopes && JSON.stringify(T.actionCtx().varScopes) === JSON.stringify({ global: {}, scene: {}, object: {}, local: {} }));
  const first = T.variablesRuntime();
  VV.set(first, 'global', 'score', 10);
  VV.set(first, 'scene', 'coins', 5, { sceneId: 1 });
  VV.set(first, 'object', 'hp', 30, { objectName: 'goblin' });
  check('the live record tracks scoped variables across all three scopes',
    VV.read(T.variablesRuntime(), 'global', 'score', 0) === 10 &&
    VV.read(T.variablesRuntime(), 'scene', 'coins', 0, { sceneId: 1 }) === 5 &&
    VV.read(T.variablesRuntime(), 'object', 'hp', 0, { objectName: 'goblin' }) === 30);
  T.resetVariablesRuntime();
  check('resetVariablesRuntime drops the record, and the next access mints a fresh empty record',
    T.variablesRuntime() !== first && VV.read(T.variablesRuntime(), 'global', 'score', 0) === 0 &&
    JSON.stringify(T.variablesRuntime()) === JSON.stringify({ global: {}, scene: {}, object: {}, local: {} }));
  delete f.modules.Variables;
  check('actionCtx varScopesModule reads null without the module',
    T.actionCtx().varScopesModule === null);
  check('conditionCtx varScopesModule reads null without the module',
    T.conditionCtx().varScopesModule === null);
}

// --- Functions wiring (P5 core-engine track, item P5-3 slice a) ---
{
  const T = factory();
  const f = makeDispatchHost(T);
  f.modules.Variables = VV;
  f.modules.Functions = FF;
  check('actionCtx carries the functions module and the call/return hooks',
    T.actionCtx().functionsModule === FF &&
    typeof T.actionCtx().callFunction === 'function' &&
    typeof T.actionCtx().returnFromFunction === 'function');
  check('the preview module exposes the function call helpers',
    typeof T.callPreviewFunction === 'function' &&
    typeof T.returnPreviewFunction === 'function' &&
    typeof T.projectFunctions === 'function' &&
    typeof T.functionsCallState === 'function' &&
    typeof T.resetFunctionsCallState === 'function');
  check('functionsCallState mints a fresh empty call state',
    JSON.stringify(T.functionsCallState()) === JSON.stringify({ frames: [] }));
  check('resetFunctionsCallState drops the call state, and the next access mints a fresh empty one',
    (() => {
      const first = T.functionsCallState();
      FF.call(first, { id: 'fn_a', name: 'a', params: [], grid: {} });
      T.resetFunctionsCallState();
      return T.functionsCallState() !== first &&
        JSON.stringify(T.functionsCallState()) === JSON.stringify({ frames: [] });
    })());
  check('resetGame resets the function call state',
    (() => {
      const first = T.functionsCallState();
      FF.call(first, { id: 'fn_a', name: 'a', params: [], grid: {} });
      T.resetGame();
      return T.functionsCallState() !== first &&
        JSON.stringify(T.functionsCallState()) === JSON.stringify({ frames: [] });
    })());
  check('projectFunctions reads the definitions from the host',
    (() => {
      const defs = [{ id: 'fn_add', name: 'add', params: ['a', 'b'], grid: {} }];
      f.host.getProjectFunctions = () => defs;
      return T.projectFunctions() === defs;
    })());
  check('projectFunctions reads [] without a host entry',
    (() => {
      delete f.host.getProjectFunctions;
      return JSON.stringify(T.projectFunctions()) === '[]';
    })());
  delete f.modules.Functions;
  check('actionCtx functionsModule reads null without the module',
    T.actionCtx().functionsModule === null);
}

// --- Scoped variable definitions (P5 core-engine track, item P5-1 slice b) ---
{
  const T = factory();
  const f = makeDispatchHost(T);
  f.modules.Variables = VV;
  const defs = [
    { name: 'score', scope: 'global', type: 'number', value: 0 },
    { name: 'coins', scope: 'scene', type: 'number', value: 0 },
    { name: 'hp', scope: 'object', objectName: 'goblin', type: 'number', value: 30 }
  ];
  f.host.getProjectScopedVariables = () => defs;
  check('the preview module exposes the definition seeders and the running flag',
    typeof T.seedPreviewRunVariables === 'function' &&
    typeof T.seedPreviewSceneVariables === 'function' &&
    typeof T.isPreviewRunning === 'function');
  check('isPreviewRunning is false before the loop starts and true after startGame',
    T.isPreviewRunning() === false &&
    (T.startGame(), T.isPreviewRunning() === true) &&
    (T.stopPreviewLoop(), T.isPreviewRunning() === false));
  T.resetGame();
  check('resetGame seeds the run definitions (global + object) from the host',
    VV.read(T.variablesRuntime(), 'global', 'score', -1) === 0 &&
    VV.read(T.variablesRuntime(), 'object', 'hp', -1, { objectName: 'goblin' }) === 30 &&
    VV.read(T.variablesRuntime(), 'scene', 'coins', -1, { sceneId: 1 }) === -1);
  check('a second resetGame re-seeds the run definitions from scratch',
    (VV.set(T.variablesRuntime(), 'global', 'score', 99), true) &&
    (T.resetGame(), true) &&
    VV.read(T.variablesRuntime(), 'global', 'score', -1) === 0);
  // A scene load seeds that scene's definitions and keeps the rest.
  VV.set(T.variablesRuntime(), 'scene', 'coins', 5, { sceneId: 1 });
  T.loadPreviewScene(f.scenes[1]);
  check('loadPreviewScene seeds the new scene definitions and keeps the global and object scopes',
    VV.read(T.variablesRuntime(), 'scene', 'coins', -1, { sceneId: 2 }) === 0 &&
    VV.read(T.variablesRuntime(), 'global', 'score', -1) === 0 &&
    VV.read(T.variablesRuntime(), 'object', 'hp', -1, { objectName: 'goblin' }) === 30);
  check('loadPreviewScene leaves the old scene coins alone (each scene keeps its own map)',
    VV.read(T.variablesRuntime(), 'scene', 'coins', -1, { sceneId: 1 }) === 5);
  // A launch seeds everything for the launch scene.
  T.resetVariablesRuntime();
  T.launchPreview();
  check('launchPreview seeds the run definitions and the launch scene definitions',
    VV.read(T.variablesRuntime(), 'global', 'score', -1) === 0 &&
    VV.read(T.variablesRuntime(), 'object', 'hp', -1, { objectName: 'goblin' }) === 30 &&
    VV.read(T.variablesRuntime(), 'scene', 'coins', -1, { sceneId: 1 }) === 0);
  check('launchPreview leaves the loop running (the panel reads live values while it runs)',
    T.isPreviewRunning() === true);
  T.stopPreviewLoop();
  // Without the host entry, a fresh run seeds nothing (and never throws).
  const T2 = factory();
  const f2 = makeDispatchHost(T2);
  f2.modules.Variables = VV;
  T2.resetGame();
  check('resetGame without the host entry seeds nothing and never throws',
    JSON.stringify(T2.variablesRuntime()) === JSON.stringify({ global: {}, scene: {}, object: {}, local: {} }));
  // Without the module, the seeders degrade to no-ops (and never throw).
  const T3 = factory();
  const f3 = makeDispatchHost(T3);
  f3.host.getProjectScopedVariables = () => defs;
  noThrow('seedPreviewRunVariables without the module does not throw', () => T3.seedPreviewRunVariables());
  noThrow('seedPreviewSceneVariables without the module does not throw', () => T3.seedPreviewSceneVariables(1));
  noThrow('resetGame without the module does not throw', () => T3.resetGame());
  check('variablesRuntime reads null without the module', T3.variablesRuntime() === null);
  check('isPreviewRunning still reports the loop flag without the module',
    T3.isPreviewRunning() === false && (T3.startGame(), T3.isPreviewRunning() === true));
}

// --- Movement wiring (P4 Advanced batch 26) ---
{
  const T = factory();
  const f = makeDispatchHost(T);
  f.host.ensurePreviewMovementState = () =>
    f.run.movement || (f.run.movement = MV.createMovementState());
  f.modules.Movement = MV;
  check('actionCtx carries the movement module',
    T.actionCtx().movementModule === MV);
  check('conditionCtx carries the movement module',
    T.conditionCtx().movementModule === MV);
  check('actionCtx movement starts empty (no state minted yet)',
    T.actionCtx().movement == null);
  const st = T.actionCtx().ensureMovementState();
  check('actionCtx ensureMovementState mints a fresh empty movement state',
    st && JSON.stringify(st.records) === '{}');
  check('actionCtx movement reads the minted state afterwards',
    T.actionCtx().movement === st);
  check('conditionCtx movement reads the minted state too',
    T.conditionCtx().movement === st);
  delete f.modules.Movement;
  check('actionCtx movementModule reads null without the module',
    T.actionCtx().movementModule === null);
  check('conditionCtx movementModule reads null without the module',
    T.conditionCtx().movementModule === null);
  delete f.host.ensurePreviewMovementState;
  check('actionCtx ensureMovementState reads null without the host entry',
    T.actionCtx().ensureMovementState() === null);
  check('the preview module wires updateMovement into the frame hooks',
    /updateMovement: function \(\) \{[\s\S]*?MV\.updateMovement\(r\.movement, objs, nowSec, dt \/ 60/.test(MODULE_SRC));
  check('the preview movement frame phase passes the held keys (wall slide press)',
    /updateMovement: function \(\) \{[\s\S]*?keys: heldKeys,[\s\S]*?hasKey: keySetHas/.test(MODULE_SRC));
  check('the preview module mints a fresh movement state on scene reset',
    /createMovementState: function \(\) \{[\s\S]*?MV\.createMovementState\(\)/.test(MODULE_SRC));
  check('script.js defines the preview movement host entry and lists it',
    /function ensurePreviewMovementState\(\)/.test(SCRIPT_JS) &&
    /ensurePreviewMovementState, ensurePreviewPlatformState, ensurePreviewCombatState, getPreviewBuses/.test(SCRIPT_JS));
}

// --- Platform wiring (P4 Advanced batch 27) ---
{
  const T = factory();
  const f = makeDispatchHost(T);
  f.host.ensurePreviewPlatformState = () =>
    f.run.platform || (f.run.platform = PL.createPlatformState());
  f.modules.Platform = PL;
  check('actionCtx carries the platform module',
    T.actionCtx().platformModule === PL);
  check('conditionCtx carries the platform module',
    T.conditionCtx().platformModule === PL);
  check('actionCtx platform starts empty (no state minted yet)',
    T.actionCtx().platform == null);
  const st = T.actionCtx().ensurePlatformState();
  check('actionCtx ensurePlatformState mints a fresh empty platform state',
    st && JSON.stringify(st.records) === '{}');
  check('actionCtx platform reads the minted state afterwards',
    T.actionCtx().platform === st);
  check('conditionCtx platform reads the minted state too',
    T.conditionCtx().platform === st);
  delete f.modules.Platform;
  check('actionCtx platformModule reads null without the module',
    T.actionCtx().platformModule === null);
  check('conditionCtx platformModule reads null without the module',
    T.conditionCtx().platformModule === null);
  delete f.host.ensurePreviewPlatformState;
  check('actionCtx ensurePlatformState reads null without the host entry',
    T.actionCtx().ensurePlatformState() === null);
  check('the preview module wires updatePlatforms into the frame hooks',
    /updatePlatforms: function \(\) \{[\s\S]*?PF\.updatePlatforms\(r\.platform, objs, nowSec, dt \/ 60/.test(MODULE_SRC));
  check('the preview module mints a fresh platform state on scene reset',
    /createPlatformState: function \(\) \{[\s\S]*?PF\.createPlatformState\(\)/.test(MODULE_SRC));
  check('script.js defines the preview platform host entry and lists it',
    /function ensurePreviewPlatformState\(\)/.test(SCRIPT_JS) &&
    /ensurePreviewPlatformState, ensurePreviewCombatState, getPreviewBuses/.test(SCRIPT_JS));
}

// --- Combat wiring (P4 Advanced batch 29) ---
{
  const T = factory();
  const f = makeDispatchHost(T);
  f.host.ensurePreviewCombatState = () =>
    f.run.combat || (f.run.combat = CB.createCombatState());
  f.modules.Combat = CB;
  check('actionCtx carries the combat module',
    T.actionCtx().combatModule === CB);
  check('conditionCtx carries the combat module',
    T.conditionCtx().combatModule === CB);
  check('actionCtx combat starts empty (no state minted yet)',
    T.actionCtx().combat == null);
  const st = T.actionCtx().ensureCombatState();
  check('actionCtx ensureCombatState mints a fresh empty combat state',
    st && JSON.stringify(st) === JSON.stringify({ cooldowns: {}, projectiles: [], slashes: [] }));
  check('actionCtx combat reads the minted state afterwards',
    T.actionCtx().combat === st);
  check('conditionCtx combat reads the minted state too',
    T.conditionCtx().combat === st);
  delete f.modules.Combat;
  check('actionCtx combatModule reads null without the module',
    T.actionCtx().combatModule === null);
  check('conditionCtx combatModule reads null without the module',
    T.conditionCtx().combatModule === null);
  delete f.host.ensurePreviewCombatState;
  check('actionCtx ensureCombatState reads null without the host entry',
    T.actionCtx().ensureCombatState() === null);
  check('the preview module wires updateCombat into the frame hooks',
    /updateCombat: function \(\) \{[\s\S]*?CB\.updateCombat\(r\.combat, dt \/ 60,/.test(MODULE_SRC));
  check('the preview module mints a fresh combat state on scene reset',
    /createCombatState: function \(\) \{[\s\S]*?CB\.createCombatState\(\)/.test(MODULE_SRC));
  check('script.js defines the preview combat host entry and lists it',
    /function ensurePreviewCombatState\(\)/.test(SCRIPT_JS) &&
    /ensurePreviewCombatState, getPreviewBuses/.test(SCRIPT_JS));
}

// --- Joystick wiring (P4 Advanced batch 20) -------------------------------------------
{
  const joyCfg = J.defaultJoystickConfig();
  joyCfg.enabled = true;
  joyCfg.actionLeft = 'Move Left';
  joyCfg.actionRight = 'Move Right';
  joyCfg.actionUp = 'Jump';
  const T = factory();
  const f = makeDispatchHost(T, { getProjectJoystickConfig: () => joyCfg });
  f.modules.Joystick = J;
  check('actionCtx carries the joystick module, the live stick, and the config',
    T.actionCtx().joystickModule === J &&
    T.actionCtx().joystick === T.joystickRuntime() &&
    T.actionCtx().joystickConfig === joyCfg);
  check('conditionCtx carries the joystick module, the live stick, and the config',
    T.conditionCtx().joystickModule === J &&
    T.conditionCtx().joystick === T.joystickRuntime() &&
    T.conditionCtx().joystickConfig === joyCfg);
  check('the live stick starts enabled from the project default',
    T.joystickRuntime().enabled === true);
  delete f.modules.Joystick;
  check('actionCtx joystickModule reads null without the module',
    T.actionCtx().joystickModule === null);
  check('conditionCtx joystickModule reads null without the module',
    T.conditionCtx().joystickModule === null);
  f.modules.Joystick = J;
  check('joystickRuntimeForDraw reads null while no run is active',
    T.joystickRuntimeForDraw() === null);
  T.startGame();
  check('joystickRuntimeForDraw reads the live stick once a run starts',
    T.joystickRuntimeForDraw() === T.joystickRuntime());
  T.resetGame();
  check('resetGame replaces the joystick runtime with a fresh unheld one',
    T.joystickRuntime() !== null && T.joystickRuntime().enabled === true &&
    T.joystickRuntime().pointerId === null);
}

// --- Joystick canvas input (P4 Advanced batch 20) -------------------------------------------
{
  const joyCfg = J.defaultJoystickConfig();
  joyCfg.enabled = true;
  const T = factory();
  const f = makeDispatchHost(T, { getProjectJoystickConfig: () => joyCfg });
  f.modules.Joystick = J;
  const doc = makeFakeDocument();
  const canvas = f.canvas;
  canvas._rect = { left: 0, top: 0, width: 800, height: 600 };
  const s = f.input;
  const zonesAt = (x) => (x < 400 ? ['left-half'] : ['right-half']);
  T.attachCanvasInput(doc, canvas, s, zonesAt);
  canvas.onmousedown({ clientX: 76, clientY: 524, button: 0 });
  const rt = T.joystickRuntime();
  check('canvas mousedown inside the base grabs the stick instead of clicking',
    J.isActive(rt) === true && !s.mouseButtons.has(0) && !s.mouseJustPressed.has(0));
  canvas.onmousemove({ clientX: 136, clientY: 524 });
  check('canvas mousemove drags the grabbed stick to full right tilt',
    rt.x === 1 && rt.y === 0, JSON.stringify({ x: rt.x, y: rt.y }));
  canvas.onmouseup({ clientX: 136, clientY: 524, button: 0 });
  check('canvas mouseup releases the stick without a button edge',
    J.isActive(rt) === false && !s.mouseButtons.has(0) && !s.mouseJustReleased.has(0));
  canvas.onmousedown({ clientX: 400, clientY: 300, button: 0 });
  check('canvas mousedown outside the base is an ordinary click',
    s.mouseButtons.has(0) && s.mouseJustPressed.has(0) && J.isActive(rt) === false);
  canvas.onmouseup({ clientX: 400, clientY: 300, button: 0 });
  canvas.ontouchstart({
    type: 'touchstart', preventDefault() {},
    touches: [{ identifier: 1, clientX: 76, clientY: 524 }],
    changedTouches: [{ identifier: 1, clientX: 76, clientY: 524 }]
  });
  check('canvas touchstart inside the base grabs the stick instead of a touch zone',
    J.isActive(rt) === true && s.touchCount === 1 && !s.touchZones.has('left-half'),
    JSON.stringify({ zones: Array.from(s.touchZones) }));
  canvas.ontouchmove({
    type: 'touchmove', preventDefault() {},
    touches: [{ identifier: 1, clientX: 76, clientY: 464 }],
    changedTouches: [{ identifier: 1, clientX: 76, clientY: 464 }]
  });
  check('canvas touchmove drags the grabbed stick to full up tilt',
    rt.y === -1, JSON.stringify({ y: rt.y }));
  canvas.ontouchend({
    type: 'touchend', preventDefault() {},
    touches: [],
    changedTouches: [{ identifier: 1, clientX: 76, clientY: 464 }]
  });
  check('canvas touchend releases the stick',
    J.isActive(rt) === false && s.touchCount === 0);
}

// --- Joystick frame phase (P4 Advanced batch 20) -------------------------------------------
{
  const joyCfg = J.defaultJoystickConfig();
  joyCfg.enabled = true;
  const T = factory();
  const f = makeDispatchHost(T, { getProjectJoystickConfig: () => joyCfg });
  f.modules.Joystick = J;
  // The real frame module, loaded through a vm sandbox like
  // frame.test.js does (it assigns window.HydraFrame at load), so the
  // loop runs the canonical phase order including updateJoystick (the
  // run-loop host's Frame stub predates it).
  const frameSandbox = {};
  frameSandbox.window = frameSandbox;
  vm.createContext(frameSandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-frame.js'), 'utf8'),
    frameSandbox, { filename: 'hydra-frame.js' });
  f.modules.Frame = frameSandbox.HydraFrame;
  const rt = T.joystickRuntime();
  J.joystickStart(rt, joyCfg, 'mouse', 76, 524, 800, 600);
  J.joystickMove(rt, joyCfg, 'mouse', 136, 524);
  T.startGame();
  T.gameLoop(1000);
  T.gameLoop(1016.67);
  check('the loop writes the tilt into joystickX / joystickY every frame',
    f.vars.joystickX === 1 && f.vars.joystickY === 0,
    JSON.stringify({ x: f.vars.joystickX, y: f.vars.joystickY }));
  J.joystickEnd(rt, 'mouse');
  T.gameLoop(1033.34);
  check('the loop writes 0 for both axes after release',
    f.vars.joystickX === 0 && f.vars.joystickY === 0,
    JSON.stringify({ x: f.vars.joystickX, y: f.vars.joystickY }));
}

// --- event indexes / adjacent actions / gameStart -------------------------------------
{
  const T = factory();
  const f = makeDispatchHost(T);
  f.grids.global = {
    0: { type: 'always', kind: 'condition', eventId: 'e1' },
    1: { type: 'setVariable', kind: 'action', eventId: 'e1' },
    2: { type: 'setVariable', kind: 'action', eventId: 'e1' },
    3: { type: 'setVariable', kind: 'action', eventId: 'e2' }
  };
  eq('getEventActionIndexes follows the eventId link',
    T.getEventActionIndexes(0, 'global'), [1, 2]);
  f.grids.global = {
    1: { type: 'setVariable', kind: 'action' },
    61: { type: 'always', kind: 'condition' },
    62: { type: 'setVariable', kind: 'action' },
    63: { type: 'comment', kind: 'comment' },
    64: { type: 'setVariable', kind: 'action' },
    65: { type: 'keyPressed', kind: 'condition' }
  };
  eq('getEventActionIndexes collects adjacent + rightward actions, skipping comments, stopping at a condition',
    T.getEventActionIndexes(61, 'global'), [62, 1, 64]);
  f.grids.global = {
    3660: { type: 'always', kind: 'condition' },
    3720: { type: 'setVariable', kind: 'action' }
  };
  eq('getEventActionIndexes past row 60 still reaches the action below (row-60 fix)',
    T.getEventActionIndexes(3660, 'global'), [3720]);
  f.grids.global = {
    61: { type: 'always', kind: 'condition' },
    63: { type: 'setVariable', kind: 'action' }
  };
  eq('getEventActionIndexes skips leading empty cells',
    T.getEventActionIndexes(61, 'global'), [63]);
  f.grids.global = {
    61: { type: 'always', kind: 'condition' },
    62: { type: 'setVariable', kind: 'action' },
    64: { type: 'setVariable', kind: 'action' }
  };
  eq('getEventActionIndexes stops the rightward scan at an empty cell after actions started',
    T.getEventActionIndexes(61, 'global'), [62]);
  T.applyAdjacentActionsFromScope(61, 'global');
  check('applyAdjacentActionsFromScope executes the adjacent actions',
    f.calls.execute.length === 1 && f.calls.execute[0][0].type === 'setVariable');
  f.grids.global = {
    0: { type: 'gameStart', kind: 'condition' },
    1: { type: 'setVariable', kind: 'action', varName: 'started', operation: 'set', value: '1' }
  };
  f.calls.execute.length = 0;
  T.processGameStartConditions('global');
  check('processGameStartConditions fires the gameStart chain once',
    f.calls.execute.length === 1 && f.started.has('global') &&
    f.run.executionContext && f.run.executionContext.gameStart === true);
  T.processGameStartConditions('global');
  check('processGameStartConditions does not re-fire a fired scope', f.calls.execute.length === 1);
  f.grids.global = {
    0: { type: 'gameStart', kind: 'condition', reversed: true },
    1: { type: 'setVariable', kind: 'action' }
  };
  f.calls.execute.length = 0;
  T.processGameStartConditions('global');
  check('a reversed gameStart fires on the second pass for an already-fired scope',
    f.calls.execute.length === 1);
  noThrow('gameStart handling with no host does not throw', () => {
    const T2 = factory();
    T2.processGameStartConditions('global');
    T2.applyAdjacentActionsFromScope(0, 'global');
  });
}

// --- subsystem hook builders ---------------------------------------------------------
{
  const T = factory();
  const f = makeDispatchHost(T);
  f.vars.score = 5;
  const ch = T.collectionHooks();
  check('collectionHooks evaluate, warn, and read variables',
    ch.num('score').value === 5 && ch.lookupVar('score') === 5);
  ch.warn('w');
  check('collectionHooks warn reaches diagnostics', f.diagnostics.length === 1);
  const mh = T.mathHooks();
  check('mathHooks share the same contract',
    mh.num('2').value === 2 && mh.lookupVar('score') === 5);
  const hero = { id: 1, name: 'hero', posX: 0, posY: 0, width: 10, height: 10 };
  f.run.objects = [hero];
  const ph = T.pickHooks();
  eq('pickHooks liveObjects resolve by name from the alive list',
    ph.liveObjects('hero').map(o => o.id), [1]);
  const tm = { id: 9, name: 'map', kind: 'tilemap', solid: true };
  f.run.objects.push(tm);
  eq('previewTilemapsNamed filters the alive list to tilemaps',
    T.previewTilemapsNamed('map').map(o => o.id), [9]);
  const lh = T.layerFxActionHooks({ targetObject: 'hero' });
  eq('layerFxActionHooks targets resolve context-aware',
    lh.targets().map(o => o.id), [1]);
  eq('layerFxActionHooks allObjects are the alive list',
    lh.allObjects().map(o => o.id), [1, 9]);
  const lc = T.layerFxConditionHooks();
  eq('layerFxConditionHooks targets resolve by name',
    lc.targets({ targetObject: 'hero' }).map(o => o.id), [1]);
  check('layerFxConditionHooks allObjects are empty by design', lc.allObjects().length === 0);
  const sm = T.stateMachineHooksFor(hero);
  sm.play('run', 2);
  check('stateMachineHooks play goes through HydraAnim with the speed',
    f.calls.animPlay.length === 1 && f.calls.animSpeed.length === 1 && f.calls.animSpeed[0][1] === 2);
  const l2 = T.light2dConditionHooks();
  f.scenes[0].darkness = 0.4;
  check('light2dConditionHooks darkness reads the live scene', l2.darkness() === 0.4);
  const l2a = T.light2dActionHooks();
  check('light2dActionHooks scene is the preview scene', l2a.scene() === f.scenes[0]);
  const jh = T.jointActionHooks();
  check('jointActionHooks expose the scene, objects, and evaluator',
    jh.scene() === f.scenes[0] && jh.objects().length === 2 && jh.num('3').value === 3);
  const jc = T.jointConditionHooks();
  check('jointConditionHooks expose the scene', jc.scene() === f.scenes[0]);
  const td = T.threeDActionHooks({ targetObject: 'hero' });
  eq('threeDActionHooks targets resolve context-aware', td.targets().map(o => o.id), [1]);
  check('threeDActionHooks camera3d reads the live camera', td.camera3d() === null);
  f.run.camera3d = { x: 1 };
  check('threeDActionHooks camera3d follows the run state', td.camera3d().x === 1);
  td.setFollow3d({ target: 'hero' });
  check('threeDActionHooks setFollow3d parks the follow on the run state',
    f.run.camera3dFollow.target === 'hero');
  f.canvas.requestPointerLock = () => { f.canvas._locked = true; };
  check('threeDActionHooks captureMouse locks the canvas',
    td.captureMouse() === true && f.canvas._locked === true);
  f.input.mouseDelta.x = 4; f.input.mouseDelta.y = -2;
  eq('threeDActionHooks readMouseDelta reads the input state',
    [td.readMouseDelta().x, td.readMouseDelta().y], [4, -2]);
  check('threeDActionHooks paused reads the pause state', td.paused() === false);
  td.setVar('speed', 9);
  check('threeDActionHooks setVar writes the variables', f.vars.speed === 9);
  check('threeDConditionHooks are the action hooks with no data',
    typeof T.threeDConditionHooks().targets === 'function');
}

// --- scriptApiHooks ---------------------------------------------------------------------
{
  const T = factory();
  const f = makeDispatchHost(T);
  const api = T.scriptApiHooks();
  f.vars.score = 3;
  check('scriptApiHooks variables round-trip', api.getVar('score') === 3);
  api.setVar('score', 8);
  check('scriptApiHooks setVar writes', f.vars.score === 8);
  check('scriptApiHooks hasVar', api.hasVar('score') === true && api.hasVar('nope') === false);
  const hero = { id: 1, name: 'hero', posX: 0, posY: 0, width: 10, height: 10 };
  f.run.objects = [hero];
  eq('scriptApiHooks liveObjects resolve by name', api.liveObjects('hero').map(o => o.id), [1]);
  api.destroyObject(hero);
  check('scriptApiHooks destroyObject queues the pending destroy', f.pending.has(1));
  f.hidden.add(1);
  check('scriptApiHooks isHidden/setHidden use the hidden set',
    api.isHidden(hero) === true);
  api.setHidden(hero, false);
  check('scriptApiHooks setHidden unhides', !f.hidden.has(1));
  f.run.actions = { held: new Set(['jump']), pressed: new Set(), released: new Set() };
  const st = api.inputState('jump');
  check('scriptApiHooks inputState reads the action runtime',
    st.held === true && st.pressed === false && st.released === false);
  api.timerStart('run');
  check('scriptApiHooks timerStart starts the named timer', f.timers.has('named:run'));
  check('scriptApiHooks timerElapsed reads the named timer', api.timerElapsed('run') >= 0);
  api.timerStop('run');
  check('scriptApiHooks timerStop pauses the named timer',
    f.timers.get('named:run').paused === true);
  check('scriptApiHooks cameraRead reflects the run camera',
    api.cameraRead().x === 0 && api.cameraRead().zoom === 1);
  api.cameraMove(30, 40);
  check('scriptApiHooks cameraMove writes the camera and clears follow',
    f.run.camera.x === 30 && f.run.camera.y === 40 && f.run.camera.followTarget === '' &&
    f.calls.clampCamera === 1);
  api.cameraZoom(2);
  check('scriptApiHooks cameraZoom clamps through the host', f.run.camera.zoom === 2);
  api.cameraZoom(99);
  check('scriptApiHooks cameraZoom clamps to the 0.25-4 range', f.run.camera.zoom === 4);
  api.cameraFollow('hero', 5, 6);
  check('scriptApiHooks cameraFollow parks the follow and ticks the host',
    f.run.camera.followTarget === 'hero' && f.calls.updateFollow === 1);
  api.cameraStopFollow();
  check('scriptApiHooks cameraStopFollow clears the target', f.run.camera.followTarget === '');
  api.cameraReset();
  check('scriptApiHooks cameraReset restores the default camera',
    f.run.camera.x === 0 && f.run.camera.zoom === 1);
  f.pending.delete(1);
  api.cameraCenterOn('hero');
  check('scriptApiHooks cameraCenterOn centers on the object',
    f.run.camera.x === (0 + 5) - 800 / 2 && f.run.camera.y === (0 + 5) - 600 / 2);
  api.emitBurst('Explosion', 10, 20);
  check('scriptApiHooks emitBurst resolves the preset and bursts',
    f.calls.burst.length === 1 && f.calls.burst[0][1].count === 5);
  api.startEmitter('fire', 'Fire', 0, 0);
  check('scriptApiHooks startEmitter starts the named emitter', f.calls.startEmitter.length === 1);
  f.run.particles = { list: [] };
  api.stopEmitter('fire');
  api.clearParticles();
  check('scriptApiHooks stop/clear route to the particle state',
    f.calls.stopEmitter.length === 1 && f.calls.clearParticles.length === 1);
  api.saveGame('slot1');
  check('scriptApiHooks saveGame writes the slot', f.saveStore.slot1.data.score === 8);
  api.setVar('score', 0);
  api.loadGame('slot1');
  check('scriptApiHooks loadGame restores the variables', f.vars.score === 8);
  check('scriptApiHooks saveExists reads the slot', api.saveExists('slot1') === true);
  api.deleteSave('slot1');
  check('scriptApiHooks deleteSave clears the slot', api.saveExists('slot1') === false);
  api.pause();
  check('scriptApiHooks pause freezes the run state', f.run.paused === true);
  check('scriptApiHooks isPaused reads the pause state', api.isPaused() === true);
  api.resume();
  check('scriptApiHooks resume unfreezes', f.run.paused === false);
  f.run.profiler = { visible: false };
  api.showProfiler();
  check('scriptApiHooks showProfiler flips the profiler', f.run.profiler.visible === true);
  check('scriptApiHooks profilerVisible reads it', api.profilerVisible() === true);
  api.hideProfiler();
  check('scriptApiHooks hideProfiler flips it back', api.profilerVisible() === false);
  const tm = { id: 9, name: 'map', kind: 'tilemap', solid: true };
  f.run.objects.push(tm);
  api.setTile('map', 1, 2, 3);
  check('scriptApiHooks setTile paints the named tilemap',
    f.calls.setTile.length === 1 && f.calls.setTile[0][1] === 1);
  check('scriptApiHooks tileSolidAt reads the tilemap', api.tileSolidAt('map', 0, 0) === true);
  check('scriptApiHooks dtSeconds reads the frame time', api.dtSeconds() === 1 / 60);
  api.switchScene('Level 2');
  check('scriptApiHooks switchScene resolves the name and defers through the host',
    f.calls.switchScene.length === 1 && f.calls.switchScene[0] === 2);
  api.switchScene('Nope');
  check('scriptApiHooks switchScene warns on an unknown scene',
    f.calls.switchScene.length === 1 && f.diagnostics.length === 1);
  check('scriptApiHooks currentSceneName reads the live scene',
    api.currentSceneName() === 'Main');
  noThrow('scriptApiHooks log does not throw', () => api.log('hi'));
  api.warn('w2');
  check('scriptApiHooks warn reaches diagnostics', f.diagnostics.length === 2);
}

// --- hostile dispatch host ---------------------------------------------------------------
{
  const T = factory();
  noThrow('dispatch functions with no host configured do not throw', () => {
    T.processScriptGrid('global');
    T.evaluateCondition({ type: 'always' }, 0, 'global');
    T.executeAction({ type: 'setVariable' }, 0);
    T.conditionCtx();
    T.actionCtx();
    T.processGameStartConditions('global');
    T.getEventActionIndexes(0, 'global');
    T.applyAdjacentActionsFromScope(0, 'global');
    T.collectionHooks();
    T.scriptApiHooks();
  });
  check('evaluateCondition with no host reads false',
    T.evaluateCondition({ type: 'always' }, 0, 'global').triggered === false);
  const T2 = factory();
  T2.configure({ host: { getRunState: () => { throw new Error('boom'); } } });
  noThrow('a throwing host getter degrades instead of breaking dispatch', () => {
    T2.processScriptGrid('global');
    T2.conditionCtx();
    T2.actionCtx();
  });
  const T3 = factory();
  T3.configure({ getModule: () => { throw new Error('boom'); } });
  noThrow('a throwing getModule provider degrades to no modules', () => {
    T3.evaluateCondition({ type: 'always' }, 0, 'global');
    T3.executeAction({ type: 'setVariable' }, 0);
  });
  check('a throwing getModule provider reads conditions as false',
    T3.evaluateCondition({ type: 'always' }, 0, 'global').triggered === false);
}

// --- run loop host ----------------------------------------------------------
// (P2 item 14, slice 8: gameLoop, launchPreview / loadPreviewScene /
// resetGame, the camera-follow and UI-widget phases, and the physics-step
// / scene-reset hook builders.)
function makeRunLoopHost(T) {
  const f = makeDispatchHost(T);
  const calls = f.calls;
  // Recording stand-ins for the shared engine modules the loop calls.
  // The Frame stub calls the hooks in canonical order, like the real
  // HydraFrame; the SceneReset stub performs the real reset's observable
  // mutations (fresh camera, cleared collections, contexts reset).
  f.modules.Frame = {
    computeDt: (last, ts) => {
      if (!last) return { realMs: 0, dt: 0, lastTime: ts };
      const realMs = Math.max(0, ts - last);
      return { realMs, dt: Math.min(realMs / 16.67, 3), lastTime: ts };
    },
    stepFrame: (h) => {
      calls.frameOrder.push('step');
      const order = ['profile', 'notePaused', 'decayCameraFx', 'updateCamera',
        'updatePhysics2d', 'updatePhysics3d', 'solveJoints', 'updateAnimations',
        'updateBlendSpaces', 'updateSkeletons', 'updateTweens', 'updateParticles',
        'updateUiWidgets', 'resetContexts', 'pollInput', 'runScripts',
        'surfaceWarnings', 'applyPendingDestroy', 'applyPendingScene', 'draw', 'clearEdges'];
      const world = ['decayCameraFx', 'updateCamera', 'updatePhysics2d', 'updatePhysics3d',
        'solveJoints', 'updateAnimations', 'updateBlendSpaces', 'updateSkeletons',
        'updateTweens', 'updateParticles'];
      const paused = typeof h.isPaused === 'function' ? !!h.isPaused() : false;
      order.forEach((phase) => {
        if (paused && world.includes(phase)) return;
        if (!paused && phase === 'notePaused') return;
        if (typeof h[phase] !== 'function') return;
        calls.frameOrder.push(phase);
        if (phase === 'profile') h[phase](h.timestamp);
        else if (phase === 'notePaused') h[phase](h.realMs);
        else if (phase === 'decayCameraFx') h[phase](h.dt * 16.67);
        else h[phase]();
      });
      return true;
    }
  };
  f.modules.SceneReset = {
    resetSceneRuntime: (state, scene, hooks) => {
      calls.sceneReset.push([state, scene, hooks]);
      if (!state || !scene) return false;
      state.pendingSceneId = null;
      state.sceneId = scene.id;
      state.camera = { x: 0, y: 0, zoom: 1, followTarget: '', offsetX: 0, offsetY: 0 };
      state.camera3d = hooks && typeof hooks.normalizeCamera3d === 'function'
        ? hooks.normalizeCamera3d(scene.camera3d, scene) : null;
      state.camera3dFollow = null;
      state.particles = hooks && typeof hooks.createParticleState === 'function'
        ? hooks.createParticleState() : null;
      [hooks.hidden, hooks.destroyed, hooks.pendingDestroy, hooks.timers, hooks.once, hooks.startedScopes]
        .forEach((c) => { try { if (c) c.clear(); } catch (e) { /* hostile collection */ } });
      if (hooks.resetContexts) hooks.resetContexts();
      state.paused = false; state.pausedElapsedMs = 0;
      state._triggerContacts = []; state._triggerPairs = {}; state._triggerEntered = []; state._triggerExited = [];
      return true;
    }
  };
  f.modules.SceneInit = {
    initSceneObjects: (objs, hooks) => { calls.sceneInit.push([objs, hooks]); },
    applyBoundTexts: (objs, loc, lang, fn) => {
      calls.applyTexts.push([objs, loc, lang]);
      (objs || []).forEach((o) => { if (o && o.textKey) o._runtimeText = '[' + lang + ':' + o.textKey + ']'; });
    }
  };
  f.modules.Stage = { normalizeSceneDimensions: (s) => { calls.normalizeScene++; } };
  f.modules.Localization = {
    defaultLanguageOf: (loc) => (loc && loc.default) || 'en',
    boundTextFor: (o, loc, lang) => (o && o.textKey) ? '[' + lang + ':' + o.textKey + ']' : null
  };
  f.modules.Profile = Object.assign({}, f.modules.Profile, {
    createProfiler: () => ({ frames: 0 }),
    frame: (p, t) => { if (p) p.frames = (p.frames || 0) + 1; calls.profileFrame++; }
  });
  calls.profileFrame = 0;
  f.modules.Pause.notePausedFrame = (state, ms) => { calls.pauseNoted.push(ms); };
  calls.pauseNoted = [];
  f.modules.CameraFx = {
    decay: (shake, flash, dtMs) => { calls.cameraDecay.push([shake, flash, dtMs]); }
  };
  f.modules.PhysicsStep = {
    stepPhysics2d: (objs, dt, hooks) => {
      calls.physicsStep.push([objs, dt, hooks]);
      return { contacts: ['c'], nextPairs: { p: 1 }, entered: ['e'], exited: ['x'] };
    }
  };
  f.modules.Joints = {
    normalizeJoints: (s) => { calls.joints.push(['norm', s]); },
    solveJoints: (...a) => { calls.joints.push(['solve', ...a]); }
  };
  calls.joints = [];
  f.modules.Anim = {
    createAnimState: () => ({ anim: true }),
    update: (...a) => { calls.animUpdate.push(a); }
  };
  calls.animUpdate = [];
  f.modules.BlendSpace = {
    createBlendRuntime: () => ({ blend: true }),
    updateBlend: (...a) => { calls.blendUpdate.push(a); }
  };
  calls.blendUpdate = [];
  f.modules.Skeleton = {
    createSkeletonRuntime: () => ({ skel: true }),
    updateSkeleton: (...a) => { calls.skelUpdate.push(a); }
  };
  calls.skelUpdate = [];
  f.modules.Tween = { update: (...a) => { calls.tweenUpdate.push(a); } };
  calls.tweenUpdate = [];
  f.modules.Particles = Object.assign({}, f.modules.Particles, {
    createParticleState: () => ({ list: [] }),
    update: (...a) => { calls.particlesUpdate.push(a); }
  });
  calls.particlesUpdate = [];
  f.modules.Ui = {
    isButton: (o) => !!o && !!o.isButton,
    isAnchored: (o) => !!o && !!o.anchored,
    resolveWidgetPosition: (o) => ({ x: o.posX || 0, y: o.posY || 0 }),
    isScreenFixed: (o) => !!o && !!o.uiPinned
  };
  f.modules['3d'] = {
    is3dKind: (k) => k === 'box3d',
    updatePhysics3d: (...a) => { calls.physics3d.push(a); },
    tick3dCameraFollow: (...a) => { calls.tick3d.push(a); },
    normalizeCamera3d: () => ({ from: 'scene' })
  };
  f.modules.Actions = Object.assign({}, f.modules.Actions, {
    createRuntimeState: (list) => {
      calls.createActions.push(list);
      return { held: new Set(), pressed: new Set(), released: new Set() };
    },
    update: (st, input) => { calls.actionsUpdate.push([st, input]); },
    zonesAt: (x, y, w, h) => { calls.zonesAt.push([x, y, w, h]); return []; }
  });
  T.configure({ getHydraActions: () => f.modules.Actions });
  const savedRaf = global.requestAnimationFrame;
  const savedCancel = global.cancelAnimationFrame;
  const savedDocument = global.document;
  global.requestAnimationFrame = (fn) => { calls.raf.push(fn); return 42; };
  global.cancelAnimationFrame = (id) => { calls.cancelled.push(id); };
  global.document = makeFakeDocument();
  const restore = () => {
    if (savedRaf === undefined) delete global.requestAnimationFrame; else global.requestAnimationFrame = savedRaf;
    if (savedCancel === undefined) delete global.cancelAnimationFrame; else global.cancelAnimationFrame = savedCancel;
    if (savedDocument === undefined) delete global.document; else global.document = savedDocument;
  };
  return { fixture: f, restore };
}

{
  const T = factory();
  const { fixture: f, restore } = makeRunLoopHost(T);
  const calls = f.calls;
  const run = f.run;

  // --- initGame -----------------------------------------------------------
  f.canvas.width = 0; f.canvas.height = 0;
  T.initGame();
  check('initGame sizes a zero-size canvas to 800x600',
    f.canvas.width === 800 && f.canvas.height === 600);
  f.canvas.width = 500; f.canvas.height = 300;
  T.initGame();
  check('initGame leaves a sized canvas alone',
    f.canvas.width === 500 && f.canvas.height === 300);

  // --- gameLoop while stopped ----------------------------------------------
  T.gameLoop(100);
  check('gameLoop while stopped still draws and re-arms without stepping',
    calls.drawGame === 1 && calls.raf.length === 1 && calls.frameOrder.length === 0 &&
    run.dt === 1 && run.frameId === 7,
    JSON.stringify({ draws: calls.drawGame, raf: calls.raf.length, order: calls.frameOrder }));

  // --- gameLoop while running ----------------------------------------------
  run.profiler = { frames: 0 };
  T.startGame();
  T.gameLoop(1000);
  check('first running frame writes dt 0 and bumps frameId',
    run.dt === 0 && run.frameId === 8, `dt=${run.dt} frameId=${run.frameId}`);
  check('running frame steps through every phase in canonical order',
    JSON.stringify(calls.frameOrder) === JSON.stringify(['step', 'profile', 'decayCameraFx',
      'updateCamera', 'updatePhysics2d', 'updatePhysics3d', 'solveJoints', 'updateAnimations',
      'updateBlendSpaces', 'updateSkeletons', 'updateTweens', 'updateParticles', 'updateUiWidgets',
      'resetContexts', 'pollInput', 'runScripts', 'applyPendingDestroy', 'applyPendingScene',
      'clearEdges']), JSON.stringify(calls.frameOrder));
  check('running frame draws and re-arms', calls.drawGame === 2 && calls.raf.length === 2);
  check('the profiler sees every frame', calls.profileFrame === 1);
  T.gameLoop(1016);
  check('second frame dt follows the 16.67ms unit',
    Math.abs(run.dt - 16 / 16.67) < 1e-9 && run.frameId === 9, `dt=${run.dt}`);

  // --- pause -----------------------------------------------------------------
  run.paused = true;
  calls.frameOrder.length = 0;
  calls.dispatch.length = 0;
  calls.pauseNoted.length = 0;
  T.gameLoop(1032);
  check('paused frame banks the pause note and skips the world sim but still runs scripts',
    calls.frameOrder.includes('notePaused') && calls.pauseNoted.join(',') === '16' &&
    !calls.frameOrder.includes('updatePhysics2d') && !calls.frameOrder.includes('updateCamera') &&
    calls.frameOrder.includes('runScripts') && calls.dispatch.length === 2,
    JSON.stringify(calls.frameOrder));
  run.paused = false;

  // --- pollInput ---------------------------------------------------------------
  run.actions = { held: new Set(), pressed: new Set(), released: new Set() };
  f.input.keysPressed.add('ArrowRight');
  calls.actionsUpdate.length = 0;
  T.gameLoop(1048);
  check('pollInput feeds the held keys to the action runtime',
    calls.actionsUpdate.length === 1 && calls.actionsUpdate[0][1].keys.has('ArrowRight') &&
    calls.actionsUpdate[0][1].gamepad === f.input.gamepadButtons &&
    calls.actionsUpdate[0][1].touchZones === f.input.touchZones);

  // --- runScripts --------------------------------------------------------------
  check('runScripts processes the global grid then the scene grid',
    calls.dispatch.slice(-2).map((d) => d[1]).join(',') === 'global,scene:1',
    JSON.stringify(calls.dispatch.map((d) => d[1])));

  // --- pending destroy + physics snapshot ---------------------------------------
  run.objects = [{ id: 1, name: 'hero' }, { id: 2, name: 'ghost' }, { id: 3, name: 'coin' }];
  f.destroyed.add(2);
  f.pending.add(3);
  calls.physicsStep.length = 0;
  T.gameLoop(1064);
  check('pending-destroy objects join the destroyed set after scripts',
    f.destroyed.has(3) && f.pending.size === 0);
  check('the physics phase sees only the alive snapshot',
    calls.physicsStep.length === 1 &&
    calls.physicsStep[0][0].map((o) => o.id).join(',') === '1',
    JSON.stringify(calls.physicsStep.map((p) => p[0].map((o) => o.id))));
  check('the physics phase writes the trigger summary back to the run state',
    JSON.stringify(run._triggerContacts) === '["c"]' && run._triggerPairs.p === 1 &&
    JSON.stringify(run._triggerEntered) === '["e"]' && JSON.stringify(run._triggerExited) === '["x"]');
  check('the physics-step hooks carry the host readers and the previous trigger pairs',
    typeof calls.physicsStep[0][2].getPhysics === 'function' &&
    typeof calls.physicsStep[0][2].hitbox === 'function' &&
    typeof calls.physicsStep[0][2].isCollisionObject === 'function' &&
    calls.physicsStep[0][2].physics2d === f.modules.Physics2D &&
    calls.physicsStep[0][2].tiles === f.modules.Tiles &&
    JSON.stringify(calls.physicsStep[0][2].prevTriggerPairs) === '{"p":1}');

  // --- pending scene -------------------------------------------------------------
  run.pendingSceneId = 2;
  const resizeBefore = calls.resizeCanvas.length;
  T.gameLoop(1080);
  check('a pending scene switch applies after scripts and loads the new scene',
    run.sceneId === 2 && calls.resizeCanvas.length === resizeBefore + 1, `sceneId=${run.sceneId}`);

  // --- updateCameraFollow ----------------------------------------------------------
  f.canvas.width = 800; f.canvas.height = 600;
  run.sceneId = 1;
  run.objects = [{ id: 1, name: 'hero', posX: 100, posY: 50, width: 50, height: 40 }];
  run.camera = { x: 0, y: 0, zoom: 99, followTarget: 'hero' };
  calls.clampCamera = 0;
  T.updateCameraFollow();
  check('updateCameraFollow centers the viewport on the follow target with a clamped zoom',
    run.camera.zoom === 4 && run.camera.x === 25 && run.camera.y === -5 && calls.clampCamera === 1,
    JSON.stringify(run.camera));
  run.camera.followTarget = '';
  run.camera.x = 7; run.camera.y = 8;
  T.updateCameraFollow();
  check('updateCameraFollow without a target only heals the zoom',
    run.camera.zoom === 4 && run.camera.x === 7 && run.camera.y === 8);
  run.camera.followTarget = 'ghost';
  T.updateCameraFollow();
  check('updateCameraFollow with a missing target is a no-op',
    run.camera.x === 7 && run.camera.y === 8);

  // --- update3dCameraFollow ---------------------------------------------------------
  run.camera3d = { pos: [0, 0, 0] };
  run.camera3dFollow = { target: 'hero' };
  calls.tick3d.length = 0;
  T.update3dCameraFollow();
  check('update3dCameraFollow ticks the shared 3D follow with an alive lookup',
    calls.tick3d.length === 1 && calls.tick3d[0][0] === run.camera3d &&
    calls.tick3d[0][1] === run.camera3dFollow &&
    calls.tick3d[0][2]('hero').map((o) => o.id).join(',') === '1');
  run.camera3d = null;
  calls.tick3d.length = 0;
  T.update3dCameraFollow();
  check('update3dCameraFollow without a 3D camera is a no-op', calls.tick3d.length === 0);

  // --- updateUiWidgetStates ------------------------------------------------------------
  run.camera = { x: 0, y: 0, zoom: 1 };
  const btn = { id: 1, name: 'play', kind: 'text', isButton: true, posX: 10, posY: 10, width: 100, height: 50 };
  const label = { id: 2, name: 'title', kind: 'text', posX: 0, posY: 0, width: 50, height: 20 };
  f.input.mouse.x = 50; f.input.mouse.y = 30;
  f.input.mouseButtons.clear();
  T.updateUiWidgetStates([btn, label]);
  check('updateUiWidgetStates marks a hovered button hover and a label normal',
    btn._uiState === 'hover' && label._uiState === 'normal', `${btn._uiState}/${label._uiState}`);
  f.input.mouseButtons.add(0);
  T.updateUiWidgetStates([btn]);
  check('updateUiWidgetStates marks a held button pressed', btn._uiState === 'pressed');
  f.input.mouseButtons.clear();
  f.input.mouse.x = 500; f.input.mouse.y = 400;
  T.updateUiWidgetStates([btn]);
  check('updateUiWidgetStates marks an untouched button normal', btn._uiState === 'normal');
  const pinned = { id: 3, name: 'pause', kind: 'text', isButton: true, uiPinned: true, posX: 700, posY: 10, width: 60, height: 30 };
  f.input.mouse.x = 710; f.input.mouse.y = 20;
  T.updateUiWidgetStates([pinned]);
  check('updateUiWidgetStates hit-tests a pinned widget in screen space', pinned._uiState === 'hover');
  // Parallax (P4 Advanced batch 16): the button sits at world x 100
  // with factor 0.5 and the camera at 200, so it draws at screen x 0
  // — a mouse at screen (50, 30) hovers it. Without the module the
  // hover math uses the raw camera and the same mouse misses.
  f.modules.Parallax = PX;
  run.camera = { x: 200, y: 0, zoom: 1 };
  const pxBtn = { id: 4, name: 'parabtn', kind: 'text', isButton: true, posX: 100, posY: 10, width: 100, height: 50, parallaxX: 0.5, parallaxY: 1 };
  f.input.mouse.x = 50; f.input.mouse.y = 30;
  f.input.mouseButtons.clear();
  T.updateUiWidgetStates([pxBtn]);
  check('updateUiWidgetStates hovers a parallax button at its drawn position',
    pxBtn._uiState === 'hover', pxBtn._uiState);
  delete f.modules.Parallax;
  T.updateUiWidgetStates([pxBtn]);
  check('updateUiWidgetStates misses the same button without the parallax module',
    pxBtn._uiState === 'normal', pxBtn._uiState);

  // --- resetGame -------------------------------------------------------------------------
  T.startGame();
  run.frameId = 9;
  run.flowTriggerStates = { 'global:5': true };
  f.started.add('global');
  f.once.add('x'); f.timers.set('t', {}); f.shakeCooldowns.set('s', 1);
  f.soundCooldowns.set('snd', 1);
  f.sceneStack.push(1);
  run.profiler = { old: true }; run.trace = { old: true };
  f.canvas.width = 0; f.canvas.height = 0;
  calls.resetTrace = 0;
  T.resetGame();
  check('resetGame clears the edge memory and the per-run collections',
    JSON.stringify(run.flowTriggerStates) === '{}' && f.started.size === 0 &&
    f.once.size === 0 && f.timers.size === 0 && f.shakeCooldowns.size === 0 &&
    f.soundCooldowns.size === 0 && f.sceneStack.length === 0);
  check('resetGame zeroes the frame id and builds a fresh profiler and tracer',
    run.frameId === 0 && run.profiler && !run.profiler.old && run.trace && !run.trace.old);
  check('resetGame resets the trace feed and restores the canvas default size',
    calls.resetTrace === 1 && f.canvas.width === 800 && f.canvas.height === 600);
  const orderBefore = calls.frameOrder.length;
  const drawsBefore = calls.drawGame;
  T.gameLoop(2000);
  check('resetGame stops the loop (a later frame steps nothing but still draws)',
    calls.frameOrder.length === orderBefore && calls.drawGame === drawsBefore + 1);

  // --- loadPreviewScene ----------------------------------------------------------------------
  f.scenes[1].objects = [{ id: 5, name: 'coin', posX: 1, posY: 2, width: 10, height: 10 }];
  f.grids.global = {
    0: { type: 'gameStart', kind: 'condition' },
    1: { type: 'setVariable', kind: 'action', varName: 'started' }
  };
  f.grids[2] = {
    0: { type: 'gameStart', kind: 'condition' },
    1: { type: 'setVariable', kind: 'action', varName: 'started2' }
  };
  run.language = 'de';
  run.frameId = 12;
  f.shakeCooldowns.set('s', 1);
  calls.execute.length = 0;
  calls.clearDiagnostics = 0; calls.normalizeScene = 0;
  calls.resizeCanvas.length = 0; calls.sceneInit.length = 0; calls.sceneReset.length = 0;
  calls.applyTexts.length = 0;
  T.loadPreviewScene(f.scenes[1]);
  check('loadPreviewScene clears diagnostics, normalizes, inits, and resets',
    calls.clearDiagnostics === 1 && calls.normalizeScene === 1 &&
    calls.sceneInit.length === 1 && calls.sceneReset.length === 1);
  check('loadPreviewScene keeps the run language and applies bound texts in it',
    run.language === 'de' && calls.applyTexts.length === 1 && calls.applyTexts[0][2] === 'de');
  check('loadPreviewScene resets the shake, the frame id, and the shake cooldowns',
    run.cameraShake.strength === 0 && run.cameraShake.timeLeft === 0 &&
    run.frameId === 0 && f.shakeCooldowns.size === 0);
  check('loadPreviewScene resizes and fires gameStart for the global grid and the new scene',
    calls.resizeCanvas.length === 1 && calls.resizeCanvas[0] === f.scenes[1] &&
    calls.execute.map((e) => e[0].varName).join(',') === 'started,started2',
    JSON.stringify(calls.execute.map((e) => e[0].varName)));
  run.objects[0].posX = 99;
  check('loadPreviewScene clones the scene objects instead of aliasing them',
    f.scenes[1].objects[0].posX === 1);
  check('the scene-reset hooks carry the preview collections',
    calls.sceneReset[0][2].hidden === f.hidden &&
    calls.sceneReset[0][2].timers === f.timers &&
    calls.sceneReset[0][2].once === f.once &&
    calls.sceneReset[0][2].startedScopes === f.started &&
    typeof calls.sceneReset[0][2].resetContexts === 'function' &&
    typeof calls.sceneReset[0][2].normalizeCamera3d === 'function' &&
    typeof calls.sceneReset[0][2].createParticleState === 'function');
  noThrow('loadPreviewScene with a null scene is a no-op', () => { T.loadPreviewScene(null); });

  // --- switchPreviewScene -------------------------------------------------------------------------
  run.sceneId = 1;
  run.pendingSceneId = null;
  T.switchPreviewScene(2);
  check('switchPreviewScene queues the switch for the end of the frame',
    run.pendingSceneId === 2);
  T.switchPreviewScene(2);
  check('switchPreviewScene to the already-queued scene is a no-op',
    run.pendingSceneId === 2);
  T.switchPreviewScene(99);
  check('switchPreviewScene to an unknown scene is a no-op',
    run.pendingSceneId === 2);
  run.pendingSceneId = null;
  T.switchPreviewScene(1);
  check('switchPreviewScene to the current scene is a no-op',
    run.pendingSceneId === null);

  // --- launchPreview ----------------------------------------------------------------------------------
  f.scenes[0].objects = [
    { id: 1, name: 'hero', posX: 10, posY: 20, width: 40, height: 40 },
    { id: 2, name: 'coin', posX: 100, posY: 100, width: 20, height: 20 }
  ];
  f.grids[1] = {
    0: { type: 'gameStart', kind: 'condition' },
    1: { type: 'setVariable', kind: 'action', varName: 'started1' }
  };
  f.vars.score = 5;
  run.language = 'de';
  run.frameId = 9;
  run.flowTriggerStates = { 'global:5': true };
  f.started.add('global');
  f.input.keysPressed.add('ArrowRight');
  f.input.mouseButtons.add(0);
  f.soundCooldowns.set('snd', 1);
  calls.commitGrid = 0; calls.createActions.length = 0; calls.stopMusic = 0;
  calls.execute.length = 0; calls.resizeCanvas.length = 0;
  const rafBefore = calls.raf.length;
  T.launchPreview();
  check('launchPreview saves the grid and clones the current scene',
    calls.commitGrid === 1 && run.sceneId === 1 && run.objects.length === 2 &&
    run.objects[0] !== f.scenes[0].objects[0]);
  check('launchPreview resets the run language to the project default',
    run.language === 'en', `language=${run.language}`);
  check('launchPreview builds fresh input actions and the audio mix from the project tabs',
    calls.createActions.length === 1 && calls.createActions[0] === f.inputActions &&
    run.actions !== null && calls.stopMusic === 1 && run.buses !== null &&
    run.busVoices !== null && run.masterVolume === 0.5 && run.musicPaused === false &&
    Array.isArray(run.liveSoundStoppers));
  check('launchPreview clears the game variables and the per-launch input edges',
    Object.keys(f.vars).length === 0 && f.input.mouseButtons.size === 0 &&
    f.input.keysPressed.has('ArrowRight'));
  check('launchPreview resets the run and fires gameStart for the global grid and the scene',
    run.frameId === 0 && JSON.stringify(run.flowTriggerStates) === '{}' &&
    calls.resizeCanvas.length === 1 &&
    calls.execute.map((e) => e[0].varName).join(',') === 'started,started1',
    JSON.stringify(calls.execute.map((e) => e[0].varName)));
  check('launchPreview wires the canvas and arms the loop',
    typeof f.canvas.onmousedown === 'function' && calls.raf.length === rafBefore + 1);
  const orderAfterLaunch = calls.frameOrder.length;
  T.gameLoop(3000);
  check('the launched loop steps frames', calls.frameOrder.length > orderAfterLaunch);

  // --- no-Frame degradation ----------------------------------------------------------------------------
  const T2 = factory();
  const f2 = makeDispatchHost(T2);
  f2.modules.Frame = undefined;
  noThrow('gameLoop with no Frame module still draws and re-arms', () => {
    T2.startGame();
    T2.gameLoop(100);
  });

  // --- hostile / no-host ----------------------------------------------------------------------------------
  noThrow('run loop functions with no host do not throw', () => {
    const T3 = factory();
    T3.initGame();
    T3.startGame();
    T3.gameLoop(100);
    T3.updateCameraFollow();
    T3.update3dCameraFollow();
    T3.updateUiWidgetStates([{ id: 1 }]);
    T3.physicsStepHooks();
    T3.sceneResetHooks();
    T3.resetGame();
    T3.loadPreviewScene({ id: 1, objects: [] });
    T3.switchPreviewScene(2);
    T3.launchPreview();
    T3.stopPreviewLoop();
    T3.startRenderLoop();
  });
  noThrow('run loop functions with a throwing getModule provider do not throw', () => {
    const T4 = factory();
    const f4 = makeDispatchHost(T4);
    T4.configure({ host: f4.host, getModule: () => { throw new Error('hostile'); } });
    T4.startGame();
    T4.gameLoop(100);
    T4.resetGame();
    T4.loadPreviewScene({ id: 1, objects: [] });
    T4.launchPreview();
  });
  noThrow('run loop functions with a throwing host do not throw', () => {
    const T5 = factory();
    const throwingHost = {};
    Object.keys(f.host).forEach((k) => { throwingHost[k] = () => { throw new Error('hostile'); }; });
    T5.configure({ host: throwingHost, getModule: () => null });
    T5.startGame();
    T5.gameLoop(100);
    T5.resetGame();
    T5.loadPreviewScene({ id: 1, objects: [] });
    T5.launchPreview();
  });

  restore();
}

// --- static routing -----------------------------------------------------------
{
  check('script.js no longer declares the inline input sets',
    !/const mouseButtons\s*=\s*new Set/.test(SCRIPT_JS) &&
    !/let\s+previewGamepadButtons/.test(SCRIPT_JS) &&
    !/let\s+previewLastClient/.test(SCRIPT_JS) &&
    !/let\s+previewTouchCount/.test(SCRIPT_JS));
  check('script.js no longer defines the mouse/touch/gamepad helpers inline',
    !/function updatePreviewMouse\(/.test(SCRIPT_JS) &&
    !/function updatePreviewTouch\(/.test(SCRIPT_JS) &&
    !/function pollEditorGamepads\(/.test(SCRIPT_JS));
  check('script.js no longer registers the document key listeners inline',
    !/document\.addEventListener\('keydown', e => \{\n  getEventKeyAliases/.test(SCRIPT_JS) &&
    /attachKeyboardInput\(document, previewInput\)/.test(SCRIPT_JS));
  check('script.js creates the input state through the module',
    /HydraPreviewRuntime\.createInputState\(\)/.test(SCRIPT_JS));
  check('script.js aliases previewState.mouse to the module state mouse',
    /previewState\.mouse = previewInput\.mouse/.test(SCRIPT_JS));
  check('script.js delegates the key helpers to the module',
    /HydraPreviewRuntime\.normalizeKeyName/.test(SCRIPT_JS) &&
    /HydraPreviewRuntime\.keyNameAliases/.test(SCRIPT_JS) &&
    /HydraPreviewRuntime\.keySetHas/.test(SCRIPT_JS) &&
    /HydraPreviewRuntime\.getEventKeyAliases/.test(SCRIPT_JS));
  check('the module gameLoop polls the gamepad and clears edges through the module',
    /pollGamepad\(input\)/.test(MODULE_SRC) &&
    /clearEdges\(inputState\(\)\)/.test(MODULE_SRC));
  check('the module resetGame and launchPreview reset/wire input through the module',
    /resetRunInput\(inputState\(\)\)/.test(MODULE_SRC) &&
    /clearForLaunch\(inputState\(\)\)/.test(MODULE_SRC) &&
    /attachCanvasInput\(doc, canvas, input,/.test(MODULE_SRC));
  check('conditionCtx reads the scalar input fields off the input state',
    /touchCount: input\.touchCount/.test(MODULE_SRC) &&
    /gamepadConnected: !!input\.gamepadConnected/.test(MODULE_SRC));
  check('script.js configures the dispatch host with the live editor state',
    /HydraPreviewRuntime\.configure\(\{\n  host: \{/.test(SCRIPT_JS) &&
    /getRunState: \(\) => previewState/.test(SCRIPT_JS) &&
    /getInputState: \(\) => previewInput/.test(SCRIPT_JS) &&
    /getGridDataForScope, getScopeKey, sameScriptScope,/.test(SCRIPT_JS));
  check('script.js configures the run loop host with the live editor state',
    /getCurrentScene, getProjectInputActions, getProjectMasterVolume,/.test(SCRIPT_JS) &&
    /resizeGameCanvas, resetTraceRender, drawGame, commitActiveGrid,/.test(SCRIPT_JS) &&
    /clearRuntimeDiagnostics: \(\) => window\.HydraUniversal\?\.clearRuntimeDiagnostics/.test(SCRIPT_JS) &&
    /getSoundCooldowns: \(\) => soundCooldowns/.test(SCRIPT_JS));
  check('script.js delegates the frame loop and run lifecycle to the module',
    /HydraPreviewRuntime\.gameLoop\(timestamp\)/.test(SCRIPT_JS) &&
    /HydraPreviewRuntime\.launchPreview\(\)/.test(SCRIPT_JS) &&
    /HydraPreviewRuntime\.loadPreviewScene\(scene\)/.test(SCRIPT_JS) &&
    /HydraPreviewRuntime\.resetGame\(\)/.test(SCRIPT_JS) &&
    /HydraPreviewRuntime\.stopPreviewLoop\(\)/.test(SCRIPT_JS) &&
    /HydraPreviewRuntime\.updateCameraFollow\(\)/.test(SCRIPT_JS) &&
    /HydraPreviewRuntime\.switchPreviewScene\(sceneId\)/.test(SCRIPT_JS) &&
    /HydraPreviewRuntime\.startRenderLoop\(\)/.test(SCRIPT_JS));
  check('script.js no longer defines the frame loop or run lifecycle inline',
    !/function gameLoop\(timestamp\) \{[\s\S]*?HydraFrame\.stepFrame/.test(SCRIPT_JS) &&
    !/function launchPreview\(\) \{[\s\S]*?cloneData\(scene\.objects\)/.test(SCRIPT_JS) &&
    !/function loadPreviewScene\(scene\) \{[\s\S]*?normalizeSceneDimensions\(scene\)/.test(SCRIPT_JS) &&
    !/function resetGame\(\) \{[\s\S]*?previewState\.flowTriggerStates = \{\};/.test(SCRIPT_JS) &&
    !/function updateUiWidgetStates\(/.test(SCRIPT_JS) &&
    !/function update3dCameraFollow\(/.test(SCRIPT_JS) &&
    !/function startGame\(\)/.test(SCRIPT_JS) &&
    !/function physicsStepHooks\(/.test(SCRIPT_JS) &&
    !/function sceneResetHooks\(/.test(SCRIPT_JS) &&
    !/let\s+gameRunning/.test(SCRIPT_JS) &&
    !/let\s+rafHandle/.test(SCRIPT_JS) &&
    !/let\s+lastTime/.test(SCRIPT_JS));
  check('script.js delegates the dispatch entry points to the module',
    /HydraPreviewRuntime\.processScriptGrid\(scope\)/.test(SCRIPT_JS) &&
    /HydraPreviewRuntime\.processGameStartConditions\(scope\)/.test(SCRIPT_JS) &&
    /HydraPreviewRuntime\.resetFrameConditionContexts\(\)/.test(SCRIPT_JS) &&
    /HydraPreviewRuntime\.resetGameStartState\(\)/.test(SCRIPT_JS) &&
    /HydraPreviewRuntime\.getAlivePreviewObjects\(\)/.test(SCRIPT_JS));
  check('script.js no longer defines the dispatch host inline',
    !/previewState\.conditionContexts = previewState\.conditionContexts/.test(SCRIPT_JS) &&
    !/function dispatchHooks\(scope\)/.test(SCRIPT_JS) &&
    !/function conditionCtx\(\)/.test(SCRIPT_JS) &&
    !/function actionCtx\(\)/.test(SCRIPT_JS) &&
    !/function evaluateCondition\(data, idx, scope\)/.test(SCRIPT_JS) &&
    !/function executeAction\(data, idx\)/.test(SCRIPT_JS) &&
    !/function collectionHooks\(\)/.test(SCRIPT_JS) &&
    !/function scriptApiHooks\(\)/.test(SCRIPT_JS) &&
    !/function getEventActionIndexes\(/.test(SCRIPT_JS) &&
    !/function resolveActionTargets\(/.test(SCRIPT_JS) &&
    !/function getAdjacentIndexes\(index\)/.test(SCRIPT_JS));
  check('index.html loads the runtime module after the toolbar and before script.js',
    INDEX_HTML.indexOf('src="hydra-previewruntime.js') > 0 &&
    INDEX_HTML.indexOf('src="hydra-previewruntime.js') > INDEX_HTML.indexOf('src="hydra-previewtoolbar.js') &&
    INDEX_HTML.indexOf('src="hydra-previewruntime.js') < INDEX_HTML.indexOf('src="script.js'));
  // The module's header documents the previewState aliasing, so the
  // no-editor-globals pin runs against the code with comments stripped.
  const MODULE_CODE = MODULE_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  check('the module never reads editor globals or queries the editor DOM by id',
    !/previewState/.test(MODULE_CODE) && !/getElementById/.test(MODULE_CODE));
}

if (failures) { console.log(`${failures} check(s) failed`); process.exit(1); }
console.log('previewruntime.test.js: all checks passed');
