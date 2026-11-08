// Unit tests for hydra/hydra-conditions.js — the shared per-block
// condition evaluation (P2 item 15/12, slice 8: the shared-engine
// extraction).
//
// Pure logic: every condition both runtimes can evaluate, over a stub
// context object — input/key/mouse, variables, object lookups, the
// world-dependent conditions (collision, overlap, onFloor, tiles,
// triggers, raycast, physics queries), timers, the deferred
// 'and'/'triggerOnce', the animation/state reads, and the subsystem
// delegations (collections, math, pick, layers, 3D, lighting, joints,
// script API). The tests pin the export's semantics (the reference),
// the pause freeze set, the closed divergences (raw position centers
// for distanceCheck, the evaluated percent in the chance context, the
// last matching pair for distanceCheck/onFloor, the first match for
// position/velocity checks, the trigger-edge keys), the never-throws
// contract, the hostile-input degradation, and the static routing that
// both runtimes delegate to it.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const sandbox = {};
sandbox.window = sandbox; // hydra-*.js modules assign to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-conditions.js'), 'utf8'),
  sandbox, { filename: 'hydra-conditions.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-dialogue.js'), 'utf8'),
  sandbox, { filename: 'hydra-dialogue.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-parallax.js'), 'utf8'),
  sandbox, { filename: 'hydra-parallax.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-pathfind.js'), 'utf8'),
  sandbox, { filename: 'hydra-pathfind.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-ai.js'), 'utf8'),
  sandbox, { filename: 'hydra-ai.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-joystick.js'), 'utf8'),
  sandbox, { filename: 'hydra-joystick.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-health.js'), 'utf8'),
  sandbox, { filename: 'hydra-health.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-damagefx.js'), 'utf8'),
  sandbox, { filename: 'hydra-damagefx.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-respawn.js'), 'utf8'),
  sandbox, { filename: 'hydra-respawn.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-spawn.js'), 'utf8'),
  sandbox, { filename: 'hydra-spawn.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-lives.js'), 'utf8'),
  sandbox, { filename: 'hydra-lives.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-movement.js'), 'utf8'),
  sandbox, { filename: 'hydra-movement.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-platform.js'), 'utf8'),
  sandbox, { filename: 'hydra-platform.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-combat.js'), 'utf8'),
  sandbox, { filename: 'hydra-combat.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-xp.js'), 'utf8'),
  sandbox, { filename: 'hydra-xp.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-scaling.js'), 'utf8'),
  sandbox, { filename: 'hydra-scaling.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-boss.js'), 'utf8'),
  sandbox, { filename: 'hydra-boss.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-tags.js'), 'utf8'),
  sandbox, { filename: 'hydra-tags.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-minimap.js'), 'utf8'),
  sandbox, { filename: 'hydra-minimap.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-attach.js'), 'utf8'),
  sandbox, { filename: 'hydra-attach.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-pick.js'), 'utf8'),
  sandbox, { filename: 'hydra-pick.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-variables.js'), 'utf8'),
  sandbox, { filename: 'hydra-variables.js' });
const C = sandbox.HydraConditions;
const Dlg = sandbox.HydraDialogue;
const PX = sandbox.HydraParallax;
const PF = sandbox.HydraPathfind;
const AI = sandbox.HydraAi;
const J = sandbox.HydraJoystick;
const HP = sandbox.HydraHealth;
const DF = sandbox.HydraDamageFx;
const RM = sandbox.HydraRespawn;
const SP = sandbox.HydraSpawn;
const LV = sandbox.HydraLives;
const MV = sandbox.HydraMovement;
const PL = sandbox.HydraPlatform;
const CB = sandbox.HydraCombat;
const XP = sandbox.HydraXp;
const SC = sandbox.HydraScaling;
const BO = sandbox.HydraBoss;
const TG = sandbox.HydraTags;
const MM = sandbox.HydraMinimap;
const AT = sandbox.HydraAttach;
const P = sandbox.HydraPick;
const VV = sandbox.HydraVariables;

// --- surface + factorySource ---
check('HydraConditions loads with evaluateCondition',
  !!C && typeof C.evaluateCondition === 'function');
check('FROZEN_WHILE_PAUSED lists the eleven world-dependent types',
  Array.isArray(C.FROZEN_WHILE_PAUSED) && C.FROZEN_WHILE_PAUSED.length === 11 &&
  ['collision', 'overlapTouch', 'onFloor', 'lineOfSight', 'onEdge',
   'tileSolidAt', 'standingOnTile', 'triggerEnter', 'triggerExit',
   'raycastHit', 'overlapCheck'].every(t => C.FROZEN_WHILE_PAUSED.includes(t)) &&
  !C.FROZEN_WHILE_PAUSED.includes('distanceCheck') &&
  !C.FROZEN_WHILE_PAUSED.includes('onTimer'));
{
  const sb2 = {};
  sb2.window = sb2;
  vm.createContext(sb2);
  const fresh = vm.runInContext('(' + C.factorySource + ')()', sb2);
  check('factorySource re-instantiates an independent module',
    fresh.evaluateCondition !== C.evaluateCondition &&
    typeof fresh.evaluateCondition === 'function' &&
    typeof fresh.factorySource === 'undefined');
}

// --- stub world ---
let nowValue = 1000;
const reported = [];
function hitboxOf(o) {
  return {
    x: (o.posX || 0) + (Number(o.hitboxOffsetX) || 0),
    y: (o.posY || 0) + (Number(o.hitboxOffsetY) || 0),
    width: Number(o.hitboxWidth) > 0 ? Number(o.hitboxWidth) : (o.width || 1),
    height: Number(o.hitboxHeight) > 0 ? Number(o.hitboxHeight) : (o.height || 1)
  };
}
function makePhysics2d() {
  return {
    ALL_MASK: 255,
    canCollide: () => true,
    pairOverlap: (a, b, tol) => {
      const ab = hitboxOf(a), bb = hitboxOf(b), t = tol || 0;
      return ab.x - t < bb.x + bb.width + t && ab.x + ab.width + t > bb.x - t &&
             ab.y - t < bb.y + bb.height + t && ab.y + ab.height + t > bb.y - t;
    },
    pairKey: (a, b) => a.id + ':' + b.id,
    raycast: (objects, x1, y1, x2, y2) => {
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      for (const o of objects) {
        const hb = hitboxOf(o);
        if (mx >= hb.x && mx <= hb.x + hb.width && my >= hb.y && my <= hb.y + hb.height) {
          return { x: mx, y: my, object: o };
        }
      }
      return null;
    },
    overlapCircle: (objects, x, y, r) => objects.filter(o => {
      const hb = hitboxOf(o);
      const cx = Math.max(hb.x, Math.min(x, hb.x + hb.width));
      const cy = Math.max(hb.y, Math.min(y, hb.y + hb.height));
      return Math.hypot(cx - x, cy - y) <= r;
    }),
    angleBetweenObjects: (a, b) => {
      const dx = (b.posX + b.width / 2) - (a.posX + a.width / 2);
      const dy = (b.posY + b.height / 2) - (a.posY + a.height / 2);
      return Math.atan2(dy, dx) * 180 / Math.PI;
    },
    objectCenter: (o) => ({ x: (o.posX || 0) + (o.width || 0) / 2, y: (o.posY || 0) + (o.height || 0) / 2 }),
    distanceBetweenObjects: (a, b) => Math.hypot(
      (a.posX + a.width / 2) - (b.posX + b.width / 2),
      (a.posY + a.height / 2) - (b.posY + b.height / 2)),
    movingTowards: (a, b, minSpeed) => {
      const dx = (b.posX - a.posX), dy = (b.posY - a.posY);
      const d = Math.hypot(dx, dy) || 1;
      const vx = a.velX || 0, vy = a.velY || 0;
      const speed = Math.hypot(vx, vy);
      if (speed < minSpeed) return false;
      return (vx * dx + vy * dy) / (speed * d) > 0.9;
    }
  };
}
function makeObjects() {
  return [
    { id: 1, name: 'hero', kind: 'sprite', posX: 10, posY: 20, width: 40, height: 40, velX: 0, velY: 0 },
    { id: 2, name: 'wall', kind: 'sprite', posX: 100, posY: 20, width: 40, height: 40 },
    { id: 3, name: 'hero', kind: 'sprite', posX: 200, posY: 20, width: 40, height: 40 },
    { id: 4, name: 'ghost', kind: 'sprite', posX: 300, posY: 20, width: 40, height: 40 },
    { id: 5, name: 'crate', kind: 'sprite', posX: 30, posY: 30, width: 40, height: 40 },
    { id: 6, name: 'floor', kind: 'sprite', posX: 0, posY: 60, width: 200, height: 20 },
    { id: 7, name: 'target', kind: 'sprite', posX: 90, posY: 90, width: 20, height: 20 },
    { id: 8, name: 'label', kind: 'text', text: 'hello', posX: 10, posY: 100, width: 80, height: 20 },
    { id: 9, name: 'map', kind: 'tilemap', posX: 0, posY: 0, width: 200, height: 200 },
    { id: 10, name: 'zone', kind: 'sprite', posX: 400, posY: 400, width: 60, height: 60 },
    { id: 11, name: 'runner', kind: 'sprite', posX: 10, posY: 200, width: 30, height: 30, velX: 0, velY: 5 },
    { id: 12, name: 'skel', kind: 'sprite', posX: 10, posY: 300, width: 30, height: 30, _skel: { playing: 'wave' } },
    { id: 13, name: 'touch', kind: 'sprite', posX: 52, posY: 20, width: 40, height: 40 }
  ];
}
function makeCtx(overrides) {
  const objects = makeObjects();
  const ctx = {
    variables: { score: 5 },
    startedScopes: new Set(),
    hidden: new Set(),
    keys: new Set(['ArrowRight']),
    keysJustPressed: new Set(['Space']),
    keysJustReleased: new Set(),
    hasKey: (set, key) => !!(set && set.has && set.has(key)),
    mouse: { x: 15, y: 25 },
    mouseButtons: new Set([0]),
    mouseJustPressed: new Set([0]),
    mouseJustReleased: new Set(),
    mouseButtonCode: (b) => ({ left: 0, middle: 1, right: 2 })[b] ?? 0,
    touchCount: 0,
    gamepadConnected: false,
    gamepadButtons: new Set(),
    gamepadJustPressed: new Set(),
    gamepadJustReleased: new Set(),
    gamepadAxes: { lx: 0, ly: 0, rx: 0, ry: 0 },
    camera: { x: 0, y: 0, zoom: 1 },
    canvasWidth: 800, canvasHeight: 600,
    named: (name) => objects.filter(o => o.name === name),
    allObjects: () => objects.slice(),
    hitbox: hitboxOf,
    isCollisionObject: (o) => !!o && o.kind !== 'tilemap',
    ui: null,
    expr: (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; },
    contexts: {},
    once: new Set(),
    adjacentIndexes: (idx) => {
      const row = Math.floor(idx / 60), col = idx % 60;
      return [{ r: row - 1, c: col }, { r: row + 1, c: col }, { r: row, c: col - 1 }, { r: row, c: col + 1 }]
        .filter(p => p.r >= 0 && p.r < 60 && p.c >= 0 && p.c < 60).map(p => p.r * 60 + p.c);
    },
    scopeKey: (scope) => (scope === undefined || scope === null) ? '' : String(scope),
    timers: new Map(),
    timerElapsedSeconds: (key, now) => {
      const rec = ctx.timers.get(key);
      if (!rec || typeof rec !== 'object') return 0;
      return Math.max(0, ((rec.paused ? (rec.pausedAt || now) : now) - rec.lastFiredTime) / 1000);
    },
    nowMs: () => nowValue,
    frameId: 1,
    isPaused: () => false,
    worldSize: () => ({ width: 800, height: 600 }),
    triggerEntered: [],
    triggerExited: [],
    language: 'en',
    musicCount: 0,
    musicPaused: false,
    profilerVisible: () => false,
    random: () => 0.5,
    actions: null,
    actionState: null,
    physics2d: null,
    tiles: null,
    save: null,
    anim: null, stateMachine: null, blendSpace: null, skeleton: null, tween: null,
    collections: null, math: null, pick: null, layerFx: null,
    threeD: null, light2d: null, joints: null, scriptApi: null,
    collectionHooks: () => ({}), mathHooks: () => ({}), pickHooks: () => ({}),
    layerFxConditionHooks: () => ({}), threeDConditionHooks: () => ({}),
    light2dConditionHooks: () => ({}), jointConditionHooks: () => ({}),
    scriptApiHooks: () => ({}),
    reportUnknown: (type) => { reported.push(type); }
  };
  Object.assign(ctx, overrides || {});
  return ctx;
}
function ev(ctx, data, scope, idx) {
  return C.evaluateCondition(data, ctx, scope, idx);
}

// --- gameStart / always ---
{
  const ctx = makeCtx();
  check('gameStart fires on a fresh scope',
    ev(ctx, { type: 'gameStart' }).triggered === true);
  check('gameStart carries its context',
    ev(ctx, { type: 'gameStart' }).context.gameStart === true);
  ctx.startedScopes.add('');
  check('gameStart does not fire once the scope started',
    ev(ctx, { type: 'gameStart' }).triggered === false);
  check('gameStart reversed passes once the scope started',
    ev(ctx, { type: 'gameStart', reversed: true }).triggered === true);
  check('always fires with its context',
    (() => { const r = ev(ctx, { type: 'always' }); return r.triggered === true && r.context.always === true; })());
}

// --- keyboard / named actions / mouse ---
{
  const ctx = makeCtx();
  check('keyPressed held key passes',
    ev(ctx, { type: 'keyPressed', key: 'ArrowRight' }).triggered === true);
  check('keyPressed unheld key fails',
    ev(ctx, { type: 'keyPressed', key: 'ArrowLeft' }).triggered === false);
  check('keyPressed reversed unheld key passes',
    ev(ctx, { type: 'keyPressed', key: 'ArrowLeft', reversed: true }).triggered === true);
  check('keyPressed anyKeyPressed mode reads the held set',
    ev(ctx, { type: 'keyPressed', inputCondition: 'anyKeyPressed' }).triggered === true);
  check('keyPressed keyJustPressed mode reads the just-pressed set',
    ev(ctx, { type: 'keyPressed', inputCondition: 'keyJustPressed', key: 'Space' }).triggered === true);
  check('keyPressed keyReleased mode reads the released set',
    ev(ctx, { type: 'keyPressed', inputCondition: 'keyReleased', key: 'Space' }).triggered === false);
  check('keyPressed trigger pressed maps to keyJustPressed',
    ev(ctx, { type: 'keyPressed', trigger: 'pressed', key: 'Space' }).triggered === true);
  check('keyJustPressed block reads the just-pressed set with the export context shape',
    (() => { const r = ev(ctx, { type: 'keyJustPressed', key: 'Space' });
      return r.triggered === true && r.context.key === 'Space' && !('justPressed' in r.context); })());
  check('actionInput without the actions module reads false',
    ev(ctx, { type: 'actionInput', actionName: 'jump' }).triggered === false);
  const actCtx = makeCtx({
    actions: {
      actionHeld: (st, n) => n === 'jump',
      actionJustPressed: () => false,
      actionJustReleased: () => false
    },
    actionState: {}
  });
  check('actionInput held action passes',
    ev(actCtx, { type: 'actionInput', actionName: 'jump' }).triggered === true);
  check('actionInput unheld action fails',
    ev(actCtx, { type: 'actionInput', actionName: 'run' }).triggered === false);
  check('mouseClick held button passes',
    ev(ctx, { type: 'mouseClick', button: 'left' }).triggered === true);
  check('mouseClick unheld button fails',
    ev(ctx, { type: 'mouseClick', button: 'right' }).triggered === false);
  check('mouseClick any button passes when one is held',
    ev(ctx, { type: 'mouseClick', button: 'any' }).triggered === true);
  check('mouseClick just-pressed mode reads the just-pressed set',
    ev(ctx, { type: 'mouseClick', button: 'left', mouseCondition: 'mouseButtonJustPressed' }).triggered === true);
  check('mouseOverObject hits the hero under the mouse',
    (() => { const r = ev(ctx, { type: 'mouseOverObject', targetObject: 'hero' });
      return r.triggered === true && r.context.obj1 && r.context.obj1.id === 1; })());
  check('mouseOverObject misses the wall away from the mouse',
    ev(ctx, { type: 'mouseOverObject', targetObject: 'wall' }).triggered === false);
  check('objectClicked fires on a just-pressed click over the hero',
    ev(ctx, { type: 'objectClicked', targetObject: 'hero', button: 'left' }).triggered === true);
  check('objectClicked stays quiet without a just-pressed click',
    ev(makeCtx({ mouseJustPressed: new Set() }), { type: 'objectClicked', targetObject: 'hero', button: 'left' }).triggered === false);
  check('mouseOverObject with a camera offset converts the mouse to world space',
    ev(makeCtx({ camera: { x: 100, y: 0, zoom: 1 } }), { type: 'mouseOverObject', targetObject: 'hero' }).triggered === false);
  check('mouseOverObject with zoom 2 converts the mouse through the zoom',
    ev(makeCtx({ camera: { x: 0, y: 0, zoom: 2 }, mouse: { x: 60, y: 80 } }), { type: 'mouseOverObject', targetObject: 'hero' }).triggered === true);
  const anchoredCtx = makeCtx({
    mouse: { x: 110, y: 105 },
    ui: {
      isAnchored: (o) => o.name === 'btn',
      isHudObject: () => false,
      resolveWidgetPosition: () => ({ x: 100, y: 100 })
    },
    named: (name) => name === 'btn' ? [{ id: 20, name: 'btn', kind: 'sprite', posX: 0, posY: 0, width: 50, height: 20 }] : []
  });
  check('mouseOverObject hits an anchored widget in screen space',
    ev(anchoredCtx, { type: 'mouseOverObject', targetObject: 'btn' }).triggered === true);
  const hudCtx = makeCtx({
    mouse: { x: 310, y: 310 },
    ui: {
      isAnchored: () => false,
      isHudObject: (o) => o.name === 'hud',
      resolveWidgetPosition: () => ({ x: 0, y: 0 })
    },
    named: (name) => name === 'hud' ? [{ id: 21, name: 'hud', kind: 'sprite', posX: 300, posY: 300, width: 50, height: 20 }] : []
  });
  check('mouseOverObject hits a HUD widget in screen space',
    ev(hudCtx, { type: 'mouseOverObject', targetObject: 'hud' }).triggered === true);
}

// --- variables / chance / object lookups ---
{
  const ctx = makeCtx();
  check('getVariable compares the live variable',
    ev(ctx, { type: 'getVariable', varName: 'score', operator: '>=', compareValue: 5 }).triggered === true);
  check('getVariable fails the comparison it does not meet',
    ev(ctx, { type: 'getVariable', varName: 'score', operator: '==', compareValue: 6 }).triggered === false);
  check('getVariable reversed passes the comparison it does not meet',
    ev(ctx, { type: 'getVariable', varName: 'score', operator: '==', compareValue: 6, reversed: true }).triggered === true);
  check('getVariable reads a missing variable as 0',
    ev(ctx, { type: 'getVariable', varName: 'nope', operator: '==', compareValue: 0 }).triggered === true);
  check('chance fires under the percent (roll 50 < 60)',
    ev(ctx, { type: 'chance', percent: 60 }).triggered === true);
  check('chance does not fire over the percent (roll 50 < 40 is false)',
    ev(ctx, { type: 'chance', percent: 40 }).triggered === false);
  check('chance reports the evaluated percent in its context',
    ev(ctx, { type: 'chance', percent: 40 }).context.chance === 40);
  check('objectVisible finds a visible object',
    (() => { const r = ev(ctx, { type: 'objectVisible', targetObject: 'hero' });
      return r.triggered === true && r.context.obj1 && r.context.obj1.id === 1; })());
  check('objectVisible misses a hidden object',
    ev(makeCtx({ hidden: new Set([4]) }), { type: 'objectVisible', targetObject: 'ghost' }).triggered === false);
  check('objectCount counts the named objects',
    (() => { const r = ev(ctx, { type: 'objectCount', targetObject: 'hero', operator: '==', count: 2 });
      return r.triggered === true && r.context.count === 2; })());
  check('objectCount reversed passes when the count differs',
    ev(ctx, { type: 'objectCount', targetObject: 'hero', operator: '==', count: 3, reversed: true }).triggered === true);
}

// --- world-dependent conditions (with the stub physics module) ---
{
  const ctx = makeCtx({ physics2d: makePhysics2d() });
  check('collision fires on an overlapping pair',
    (() => { const r = ev(ctx, { type: 'collision', object1: 'hero', object2: 'crate' });
      return r.triggered === true && r.context.obj1.id === 1 && r.context.obj2.id === 5 && r.context.touching === true; })());
  check('collision stays quiet on a separated pair',
    ev(ctx, { type: 'collision', object1: 'hero', object2: 'wall' }).triggered === false);
  check('collision counts touching edges within 3px by default (2px gap)',
    ev(ctx, { type: 'collision', object1: 'hero', object2: 'touch' }).triggered === true);
  check('collision with countTouchingEdges false ignores the 2px gap',
    ev(ctx, { type: 'collision', object1: 'hero', object2: 'touch', countTouchingEdges: false }).triggered === false);
  check('collision with countTouchingEdges false needs real overlap',
    ev(ctx, { type: 'collision', object1: 'hero', object2: 'crate', countTouchingEdges: false }).triggered === true);
  check('collision never matches an object with itself',
    ev(ctx, { type: 'collision', object1: 'hero', object2: 'hero' }).triggered === false);
  check('collision without the physics module falls back to the AABB contact test',
    ev(makeCtx(), { type: 'collision', object1: 'hero', object2: 'crate' }).triggered === true);
  check('overlapTouch fires on an overlapping pair',
    ev(ctx, { type: 'overlapTouch', object1: 'hero', object2: 'crate' }).triggered === true);
  check('overlapTouch stays quiet on a separated pair',
    ev(ctx, { type: 'overlapTouch', object1: 'hero', object2: 'wall' }).triggered === false);
  check('overlapTouch without the physics module falls back to the expanded AABB test',
    ev(makeCtx(), { type: 'overlapTouch', object1: 'hero', object2: 'crate' }).triggered === true);
  check('onFloor fires when the hero rests on the floor (bottom side, last matching pair)',
    (() => { const r = ev(ctx, { type: 'onFloor', targetObject: 'hero', platformObject: 'floor' });
      return r.triggered === true && r.context.obj1.id === 3 && r.context.obj2.id === 6; })());
  check('onFloor stays quiet without a bottom contact',
    ev(ctx, { type: 'onFloor', targetObject: 'ghost', platformObject: 'floor' }).triggered === false);
  check('onFloor without the physics module still reads the AABB contact',
    ev(makeCtx(), { type: 'onFloor', targetObject: 'hero', platformObject: 'floor' }).triggered === true);
  check('raycastHit reports the closest hit with its object',
    (() => { const r = ev(ctx, { type: 'raycastHit', fromX: 0, fromY: 0, toX: 200, toY: 200 });
      return r.triggered === true && r.context.hitObject === 'target' && r.context.hitX === 100 && r.context.hitY === 100; })());
  check('raycastHit stays quiet on a clear segment',
    ev(ctx, { type: 'raycastHit', fromX: 0, fromY: 0, toX: 10, toY: 10 }).triggered === false);
  check('raycastHit without the physics module reads false',
    ev(makeCtx(), { type: 'raycastHit', fromX: 0, fromY: 0, toX: 200, toY: 200 }).triggered === false);
  check('overlapCheck fires inside the probe circle',
    (() => { const r = ev(ctx, { type: 'overlapCheck', x: 95, y: 95, radius: 5 });
      return r.triggered === true && r.context.count === 1 && r.context.obj1.name === 'target'; })());
  check('overlapCheck stays quiet outside the probe circle',
    ev(ctx, { type: 'overlapCheck', x: 500, y: 500, radius: 24 }).triggered === false);
  check('triggerEnter fires on the entered pair key',
    ev(makeCtx({ physics2d: makePhysics2d(), triggerEntered: ['10:1'] }), { type: 'triggerEnter', zoneObject: 'zone', targetObject: 'hero' }).triggered === true);
  check('triggerEnter stays quiet without the entered key',
    ev(makeCtx({ physics2d: makePhysics2d(), triggerEntered: [] }), { type: 'triggerEnter', zoneObject: 'zone', targetObject: 'hero' }).triggered === false);
  check('triggerExit fires on the exited pair key',
    ev(makeCtx({ physics2d: makePhysics2d(), triggerExited: ['10:1'] }), { type: 'triggerExit', zoneObject: 'zone', targetObject: 'hero' }).triggered === true);
  check('trigger pair conditions read false without the physics module',
    ev(makeCtx({ triggerEntered: ['10:1'] }), { type: 'triggerEnter', zoneObject: 'zone', targetObject: 'hero' }).triggered === false);
}

// --- physics queries ---
{
  const ctx = makeCtx({ physics2d: makePhysics2d() });
  check('angleBetween reads the object-to-object angle',
    (() => { const r = ev(ctx, { type: 'angleBetween', object1: 'hero', object2: 'wall', operator: '>=', value: 0 });
      return r.triggered === true && Math.abs(r.context.angle) < 0.001; })());
  check('angleBetween fails the angle it does not meet',
    ev(ctx, { type: 'angleBetween', object1: 'crate', object2: 'touch', operator: '>=', value: 10 }).triggered === false);
  check('angleBetween reads the diagonal angle',
    (() => { const r = ev(ctx, { type: 'angleBetween', object1: 'hero', object2: 'target', operator: '>=', value: 40 });
      return r.triggered === true && r.context.angle > 40 && r.context.angle < 41; })());
  check('lineOfSight is clear with no blocker between the pair',
    ev(ctx, { type: 'lineOfSight', object1: 'hero', object2: 'wall' }).triggered === true);
  check('lineOfSight is blocked by the crate between hero and target',
    ev(ctx, { type: 'lineOfSight', object1: 'hero', object2: 'target' }).triggered === false);
  check('lineOfSight without the physics module reads clear',
    ev(makeCtx(), { type: 'lineOfSight', object1: 'hero', object2: 'target' }).triggered === true);
  check('nearestDistance compares the closest pair',
    (() => { const r = ev(ctx, { type: 'nearestDistance', object1: 'hero', targetObject: 'crate', operator: '<=', value: 30 });
      return r.triggered === true && r.context.distance > 22 && r.context.distance < 23 && r.context.nearest.name === 'crate'; })());
  check('nearestDistance fails over the threshold',
    ev(ctx, { type: 'nearestDistance', object1: 'hero', targetObject: 'crate', operator: '<=', value: 20 }).triggered === false);
  check('movingTowards fires for the runner heading at the skeleton below it',
    ev(ctx, { type: 'movingTowards', object1: 'runner', object2: 'skel', minSpeed: 1 }).triggered === true);
  check('movingTowards stays quiet for the still hero',
    ev(ctx, { type: 'movingTowards', object1: 'hero', object2: 'wall', minSpeed: 1 }).triggered === false);
}

// --- text / distance / property / velocity ---
{
  const ctx = makeCtx();
  check('textCheck equals the displayed text',
    ev(ctx, { type: 'textCheck', targetObject: 'label', operator: 'equals', value: 'hello' }).triggered === true);
  check('textCheck contains matches a substring',
    ev(ctx, { type: 'textCheck', targetObject: 'label', operator: 'contains', value: 'ell' }).triggered === true);
  check('textCheck never matches a non-text object',
    ev(ctx, { type: 'textCheck', targetObject: 'hero', operator: 'equals', value: 'hello' }).triggered === false);
  check('textCheck treats an unknown operator as equals',
    ev(ctx, { type: 'textCheck', targetObject: 'label', operator: 'bogus', value: 'hello' }).triggered === true);
  check('distanceCheck measures raw position centers (hitbox offsets ignored)',
    (() => {
      const offCtx = makeCtx();
      offCtx.allObjects = () => [{ id: 2, name: 'wall', kind: 'sprite', posX: 100, posY: 20, width: 40, height: 40, hitboxOffsetX: 100 }];
      offCtx.named = (name) => name === 'hero'
        ? [{ id: 1, name: 'hero', kind: 'sprite', posX: 10, posY: 20, width: 40, height: 40 }]
        : offCtx.allObjects().filter(o => o.name === name);
      const r = ev(offCtx, { type: 'distanceCheck', object1: 'hero', object2: 'wall', operator: '<=', distance: 100 });
      return r.triggered === true && Math.abs(r.context.distance - 90) < 0.001;
    })());
  check('distanceCheck fails over the threshold',
    ev(ctx, { type: 'distanceCheck', object1: 'hero', object2: 'wall', operator: '<=', distance: 50 }).triggered === false);
  check('positionCheck reads the named property',
    ev(ctx, { type: 'positionCheck', targetObject: 'hero', property: 'posX', operator: '>=', value: 10 }).triggered === true);
  check('positionCheck defaults to posY',
    ev(ctx, { type: 'positionCheck', targetObject: 'hero', operator: '<', value: 25 }).triggered === true);
  check('positionCheck reads the derived textLength property',
    ev(ctx, { type: 'positionCheck', targetObject: 'label', property: 'textLength', operator: '>=', value: 5 }).triggered === true);
  check('velocityCheck reads the speed magnitude',
    ev(ctx, { type: 'velocityCheck', targetObject: 'runner', operator: '>=', value: 5 }).triggered === true);
  check('velocityCheck reads one component',
    ev(ctx, { type: 'velocityCheck', targetObject: 'runner', component: 'x', operator: '>=', value: 4 }).triggered === false);
  check('velocityCheck reports the first matching object value',
    (() => { const r = ev(ctx, { type: 'velocityCheck', targetObject: 'runner', operator: '>=', value: 5 });
      return r.triggered === true && r.context.value === 5; })());
}

// --- timers ---
{
  const ctx = makeCtx();
  nowValue = 1000;
  ctx.frameId = 1;
  check('onTimer fires on its first frame (record starts one interval back)',
    ev(ctx, { type: 'onTimer', interval: 1 }, undefined, 60).triggered === true);
  check('onTimer fires again on the same frame (firedFrame match)',
    ev(ctx, { type: 'onTimer', interval: 1 }, undefined, 60).triggered === true);
  nowValue = 1500;
  ctx.frameId = 2;
  check('onTimer holds before the interval elapses',
    ev(ctx, { type: 'onTimer', interval: 1 }, undefined, 60).triggered === false);
  nowValue = 2000;
  ctx.frameId = 3;
  check('onTimer fires again once the interval elapses',
    ev(ctx, { type: 'onTimer', interval: 1 }, undefined, 60).triggered === true);
  check('onTimer uses the named key for a named timer',
    (() => { const c2 = makeCtx(); nowValue = 1000; c2.frameId = 1;
      const r = ev(c2, { type: 'onTimer', timerName: 'tick', interval: 1 }, undefined, 60);
      return r.triggered === true && c2.timers.has('named:tick'); })());
  check('onTimer never fires while paused and creates no record',
    (() => { const c3 = makeCtx({ isPaused: () => true }); nowValue = 1000; c3.frameId = 1;
      const r = ev(c3, { type: 'onTimer', interval: 1 }, undefined, 60);
      return r.triggered === false && r.context.elapsed === 0 && c3.timers.size === 0; })());
  check('onTimer reversed passes while paused',
    ev(makeCtx({ isPaused: () => true }), { type: 'onTimer', interval: 1, reversed: true }, undefined, 60).triggered === true);
  const elapsedCtx = makeCtx();
  elapsedCtx.timers.set('named:tick', { lastFiredTime: 0, paused: false, pausedAt: 0, firedFrame: -1 });
  nowValue = 2500;
  check('timerElapsed reads the elapsed seconds without creating a timer',
    (() => { const r = ev(elapsedCtx, { type: 'timerElapsed', timerName: 'tick', operator: '>=', seconds: 2 });
      return r.triggered === true && Math.abs(r.context.elapsed - 2.5) < 0.001; })());
  check('timerElapsed fails over the threshold',
    ev(elapsedCtx, { type: 'timerElapsed', timerName: 'tick', operator: '>=', seconds: 3 }).triggered === false);
  check('timerElapsed reads a never-started timer as 0',
    ev(makeCtx(), { type: 'timerElapsed', timerName: 'nope', operator: '>=', seconds: 1 }).triggered === false);
  check('timerElapsed reads a legacy numeric timer record as 0 (the read path does not repair it)',
    (() => { const c4 = makeCtx(); c4.timers.set('named:old', 1000); nowValue = 2500;
      const r = ev(c4, { type: 'timerElapsed', timerName: 'old', operator: '>=', seconds: 1 });
      return r.triggered === false && r.context.elapsed === 0; })());
  check('onTimer repairs a legacy numeric timer record into an object record',
    (() => { const c5 = makeCtx(); c5.timers.set('named:old', 1000); nowValue = 2500; c5.frameId = 1;
      const r = ev(c5, { type: 'onTimer', timerName: 'old', interval: 1 }, undefined, 60);
      const rec = c5.timers.get('named:old');
      return r.triggered === true && rec && typeof rec === 'object' && rec.lastFiredTime === 2500; })());
}

// --- edge / deferred and / triggerOnce ---
{
  const ctx = makeCtx();
  check('onEdge fires on the left edge',
    ev(ctx, { type: 'onEdge', targetObject: 'hero', edge: 'left' }).triggered === false);
  const edgeCtx = makeCtx({
    named: (name) => name === 'edgeObj' ? [{ id: 30, name: 'edgeObj', kind: 'sprite', posX: 0, posY: 100, width: 40, height: 40 }] : []
  });
  check('onEdge fires at the left edge',
    ev(edgeCtx, { type: 'onEdge', targetObject: 'edgeObj', edge: 'left' }).triggered === true);
  check('onEdge fires at any edge',
    ev(edgeCtx, { type: 'onEdge', targetObject: 'edgeObj', edge: 'any' }).triggered === true);
  check('onEdge reads false without a scene',
    ev(makeCtx({ worldSize: () => null }), { type: 'onEdge', targetObject: 'hero' }).triggered === false);
  const andCtx = makeCtx();
  andCtx.contexts[':120'] = { collision: true };
  andCtx.contexts[':240'] = { always: true };
  check('and fires when two adjacent contexts are set',
    (() => { const r = ev(andCtx, { type: 'and' }, undefined, 180);
      return r.triggered === true && r.context.andGroup === true && r.context.collision === true; })());
  const andCtx1 = makeCtx();
  andCtx1.contexts[':120'] = { collision: true };
  check('and stays quiet with one adjacent context',
    ev(andCtx1, { type: 'and' }, undefined, 180).triggered === false);
  check('and with or logic fires on one adjacent context',
    ev(andCtx1, { type: 'and', logic: 'or' }, undefined, 180).triggered === true);
  check('and with an unknown logic value behaves as and',
    ev(andCtx1, { type: 'and', logic: 'bogus' }, undefined, 180).triggered === false);
  const onceCtx = makeCtx();
  onceCtx.contexts[':120'] = { always: true };
  check('triggerOnce fires the first time with a gate context',
    ev(onceCtx, { type: 'triggerOnce' }, undefined, 180).triggered === true);
  check('triggerOnce records its key so it never fires again',
    onceCtx.once.has(':180') && ev(onceCtx, { type: 'triggerOnce' }, undefined, 180).triggered === false);
  check('triggerOnce reversed passes only after it fired',
    ev(onceCtx, { type: 'triggerOnce', reversed: true }, undefined, 180).triggered === true);
  check('triggerOnce fires ungated when nothing is adjacent',
    ev(makeCtx(), { type: 'triggerOnce' }, undefined, 180).triggered === true);
}

// --- animation / state reads ---
{
  const animCtx = makeCtx({
    anim: { isFinished: (a, name) => !!(a && a.done === name) },
    stateMachine: { currentState: (sm) => (sm && sm.state) || '' },
    blendSpace: { isBlendActive: (b, name) => !!(b && b.active === name) },
    skeleton: { isSkeletonActive: (sk, name) => !!(sk && sk.playing === name) },
    tween: { isFinished: (s, o, prop) => !!(o && o._tweenDone === prop) }
  });
  animCtx.named = (name) => {
    if (name === 'hero') return [{ id: 1, name: 'hero', kind: 'sprite', posX: 10, posY: 20, width: 40, height: 40, _anim: { done: 'walk' }, _sm: { state: 'idle' }, _blends: { active: 'run' }, _tweenDone: 'posX' }];
    if (name === 'skel') return [{ id: 12, name: 'skel', kind: 'sprite', posX: 10, posY: 300, width: 30, height: 30, _skel: { playing: 'wave' } }];
    return [];
  };
  check('animationFinished fires for the finished animation',
    ev(animCtx, { type: 'animationFinished', targetObject: 'hero', animation: 'walk' }).triggered === true);
  check('animationFinished stays quiet for another animation',
    ev(animCtx, { type: 'animationFinished', targetObject: 'hero', animation: 'run' }).triggered === false);
  check('animStateIs fires while the object is in the named state',
    ev(animCtx, { type: 'animStateIs', targetObject: 'hero', state: 'idle' }).triggered === true);
  check('animStateIs stays quiet on a blank state name',
    ev(animCtx, { type: 'animStateIs', targetObject: 'hero', state: '' }).triggered === false);
  check('blendActive fires while the named blend is active',
    ev(animCtx, { type: 'blendActive', targetObject: 'hero', blend: 'run' }).triggered === true);
  check('tweenFinished fires for the finished property',
    ev(animCtx, { type: 'tweenFinished', targetObject: 'hero', property: 'posX' }).triggered === true);
  check('skeletonPlaying fires while the skeletal animation plays',
    ev(animCtx, { type: 'skeletonPlaying', object1: 'skel', animation: 'wave' }).triggered === true);
  check('animation reads stay quiet without their modules',
    ev(makeCtx(), { type: 'animationFinished', targetObject: 'hero', animation: 'walk' }).triggered === false &&
    ev(makeCtx(), { type: 'animStateIs', targetObject: 'hero', state: 'idle' }).triggered === false);
  check('languageIs fires for the run language',
    ev(makeCtx(), { type: 'languageIs', language: 'en' }).triggered === true);
  check('languageIs fails for another language and for a blank code',
    ev(makeCtx(), { type: 'languageIs', language: 'fr' }).triggered === false &&
    ev(makeCtx(), { type: 'languageIs', language: '' }).triggered === false);
  // --- dialogue conditions (P4 Advanced batch 7) ---
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
    const hooks = { warn: () => {}, setObjectText: () => {} };
    const drt = Dlg.createDialogueRuntime();
    const ctx = makeCtx({ dialogue: drt });
    check('dialogue conditions read false with no conversation running',
      ev(ctx, { type: 'dialogueActive' }).triggered === false &&
      ev(ctx, { type: 'dialogueWaitingChoice' }).triggered === false &&
      ev(ctx, { type: 'dialogueChoiceAvailable', option: 1 }).triggered === false);
    check('dialogueActive reversed fires with no conversation running',
      ev(ctx, { type: 'dialogueActive', reversed: true }).triggered === true);
    Dlg.startDialogue(drt, guardDialogue, 'Guard intro',
      { charsPerSec: 0, speakerObject: '', textObject: '' }, hooks);
    check('dialogueActive fires while the conversation runs',
      ev(ctx, { type: 'dialogueActive' }).triggered === true);
    check('dialogueActive reversed stays quiet while the conversation runs',
      ev(ctx, { type: 'dialogueActive', reversed: true }).triggered === false);
    check('dialogueWaitingChoice stays quiet on a plain line',
      ev(ctx, { type: 'dialogueWaitingChoice' }).triggered === false);
    Dlg.advanceDialogue(drt, hooks); // completes line 0 typing
    Dlg.advanceDialogue(drt, hooks); // moves to the choice line
    Dlg.updateDialogue(drt, 1, hooks); // reveals it, sets waitingChoice
    check('dialogueWaitingChoice fires once the choice line is revealed',
      ev(ctx, { type: 'dialogueWaitingChoice' }).triggered === true);
    check('dialogueChoiceAvailable fires for each offered option',
      ev(ctx, { type: 'dialogueChoiceAvailable', option: 1 }).triggered === true &&
      ev(ctx, { type: 'dialogueChoiceAvailable', option: 2 }).triggered === true);
    check('dialogueChoiceAvailable stays quiet past the last option',
      ev(ctx, { type: 'dialogueChoiceAvailable', option: 3 }).triggered === false &&
      ev(ctx, { type: 'dialogueChoiceAvailable', option: 0 }).triggered === false &&
      ev(ctx, { type: 'dialogueChoiceAvailable', option: 'nope' }).triggered === false);
    check('dialogueChoiceAvailable reversed fires for a missing option',
      ev(ctx, { type: 'dialogueChoiceAvailable', option: 3, reversed: true }).triggered === true);
    check('dialogueWaitingChoice reversed stays quiet while waiting',
      ev(ctx, { type: 'dialogueWaitingChoice', reversed: true }).triggered === false);
    Dlg.stopDialogue(drt, hooks);
    check('dialogue conditions all read false after the conversation ends',
      ev(ctx, { type: 'dialogueActive' }).triggered === false &&
      ev(ctx, { type: 'dialogueWaitingChoice' }).triggered === false &&
      ev(ctx, { type: 'dialogueChoiceAvailable', option: 1 }).triggered === false);
    const noDlgCtx = makeCtx();
    check('dialogue conditions read false with no dialogue runtime at all',
      ev(noDlgCtx, { type: 'dialogueActive' }).triggered === false &&
      ev(noDlgCtx, { type: 'dialogueWaitingChoice' }).triggered === false &&
      ev(noDlgCtx, { type: 'dialogueChoiceAvailable', option: 1 }).triggered === false);
    check('dialogue conditions are not frozen while paused (they are UI)',
      !C.FROZEN_WHILE_PAUSED.includes('dialogueActive') &&
      !C.FROZEN_WHILE_PAUSED.includes('dialogueWaitingChoice') &&
      !C.FROZEN_WHILE_PAUSED.includes('dialogueChoiceAvailable'));
  }
  // --- inventory conditions (P4 Advanced batch 8) ---
  {
    const inv = { counts: { 'Gold coin': 5, 'Brass key': 1 } };
    const ctx = makeCtx({ inventory: inv });
    check('hasItem fires at the carried count and fails above it',
      ev(ctx, { type: 'hasItem', item: 'Gold coin', count: 5 }).triggered === true &&
      ev(ctx, { type: 'hasItem', item: 'Gold coin', count: 6 }).triggered === false);
    check('hasItem defaults to needing 1',
      ev(ctx, { type: 'hasItem', item: 'Gold coin' }).triggered === true &&
      ev(ctx, { type: 'hasItem', item: 'Potion' }).triggered === false);
    check('hasItem reads false for a blank item and reversed fires without the item',
      ev(ctx, { type: 'hasItem', item: '' }).triggered === false &&
      ev(ctx, { type: 'hasItem', item: 'Potion', reversed: true }).triggered === true);
    check('hasItem reports the held count in its context',
      ev(ctx, { type: 'hasItem', item: 'Gold coin', count: 1 }).context.count === 5);
    check('itemCount compares against the value with every operator',
      ev(ctx, { type: 'itemCount', item: 'Gold coin', operator: '>=', value: 5 }).triggered === true &&
      ev(ctx, { type: 'itemCount', item: 'Gold coin', operator: '>', value: 5 }).triggered === false &&
      ev(ctx, { type: 'itemCount', item: 'Gold coin', operator: '==', value: 5 }).triggered === true &&
      ev(ctx, { type: 'itemCount', item: 'Gold coin', operator: '!=', value: 5 }).triggered === false &&
      ev(ctx, { type: 'itemCount', item: 'Gold coin', operator: '<=', value: 5 }).triggered === true &&
      ev(ctx, { type: 'itemCount', item: 'Gold coin', operator: '<', value: 5 }).triggered === false);
    check('itemCount reads an unheld item as 0 and still compares',
      ev(ctx, { type: 'itemCount', item: 'Potion', operator: '==', value: 0 }).triggered === true &&
      ev(ctx, { type: 'itemCount', item: 'Potion', operator: '>=', value: 1 }).triggered === false);
    check('itemCount reversed fires when the comparison fails',
      ev(ctx, { type: 'itemCount', item: 'Gold coin', operator: '>', value: 5, reversed: true }).triggered === true);
    check('itemCount reads false for a blank item',
      ev(ctx, { type: 'itemCount', item: '', operator: '==', value: 0 }).triggered === false);
    check('inventory conditions read false with no backpack at all',
      ev(makeCtx(), { type: 'hasItem', item: 'Gold coin', count: 1 }).triggered === false &&
      ev(makeCtx(), { type: 'itemCount', item: 'Gold coin', operator: '>', value: 0 }).triggered === false);
    check('inventory conditions are not frozen while paused (they are state reads)',
      !C.FROZEN_WHILE_PAUSED.includes('hasItem') &&
      !C.FROZEN_WHILE_PAUSED.includes('itemCount'));
  }
  // --- quest conditions (P4 Advanced batch 9) ---
  {
    const qlog = { progress: { 'Collect 4 coins': 3, 'Defeat 3 enemies': 3 }, done: { 'Defeat 3 enemies': true } };
    const ctx = makeCtx({ questLog: qlog });
    check('questComplete fires for a finished quest and stays quiet otherwise',
      ev(ctx, { type: 'questComplete', quest: 'Defeat 3 enemies' }).triggered === true &&
      ev(ctx, { type: 'questComplete', quest: 'Collect 4 coins' }).triggered === false &&
      ev(ctx, { type: 'questComplete', quest: 'Reach the goal' }).triggered === false);
    check('questComplete reads the done flag, not the progress alone',
      ev(ctx, { type: 'questComplete', quest: 'Defeat 3 enemies' }).context.questComplete === true &&
      ev(ctx, { type: 'questComplete', quest: 'Collect 4 coins' }).context.questComplete === false);
    check('questComplete reads false for a blank quest and reversed fires for an unfinished one',
      ev(ctx, { type: 'questComplete', quest: '' }).triggered === false &&
      ev(ctx, { type: 'questComplete', quest: 'Collect 4 coins', reversed: true }).triggered === true &&
      ev(ctx, { type: 'questComplete', quest: 'Defeat 3 enemies', reversed: true }).triggered === false);
    check('questComplete reports the quest name in its context',
      ev(ctx, { type: 'questComplete', quest: 'Defeat 3 enemies' }).context.quest === 'Defeat 3 enemies');
    check('questProgress compares against the value with every operator',
      ev(ctx, { type: 'questProgress', quest: 'Collect 4 coins', operator: '>=', value: 3 }).triggered === true &&
      ev(ctx, { type: 'questProgress', quest: 'Collect 4 coins', operator: '>', value: 3 }).triggered === false &&
      ev(ctx, { type: 'questProgress', quest: 'Collect 4 coins', operator: '==', value: 3 }).triggered === true &&
      ev(ctx, { type: 'questProgress', quest: 'Collect 4 coins', operator: '!=', value: 3 }).triggered === false &&
      ev(ctx, { type: 'questProgress', quest: 'Collect 4 coins', operator: '<=', value: 3 }).triggered === true &&
      ev(ctx, { type: 'questProgress', quest: 'Collect 4 coins', operator: '<', value: 3 }).triggered === false);
    check('questProgress reads an unstarted quest as 0 and still compares',
      ev(ctx, { type: 'questProgress', quest: 'Reach the goal', operator: '==', value: 0 }).triggered === true &&
      ev(ctx, { type: 'questProgress', quest: 'Reach the goal', operator: '>=', value: 1 }).triggered === false);
    check('questProgress reversed fires when the comparison fails',
      ev(ctx, { type: 'questProgress', quest: 'Collect 4 coins', operator: '>', value: 3, reversed: true }).triggered === true);
    check('questProgress reads false for a blank quest',
      ev(ctx, { type: 'questProgress', quest: '', operator: '==', value: 0 }).triggered === false);
    check('questProgress reports the held progress in its context',
      ev(ctx, { type: 'questProgress', quest: 'Collect 4 coins', operator: '>=', value: 1 }).context.progress === 3 &&
      ev(ctx, { type: 'questProgress', quest: 'Reach the goal', operator: '==', value: 0 }).context.progress === 0);
    check('quest conditions read false with no quest log at all',
      ev(makeCtx(), { type: 'questComplete', quest: 'Defeat 3 enemies' }).triggered === false &&
      ev(makeCtx(), { type: 'questProgress', quest: 'Collect 4 coins', operator: '>', value: 0 }).triggered === false);
    check('quest conditions are not frozen while paused (they are state reads)',
      !C.FROZEN_WHILE_PAUSED.includes('questComplete') &&
      !C.FROZEN_WHILE_PAUSED.includes('questProgress'));
  }
  // --- achievement conditions (P4 Advanced batch 10) ---
  {
    const alog = { unlocked: { 'Coin hoarder': true, 'Flawless': true } };
    const ctx = makeCtx({ achievementLog: alog });
    check('achievementUnlocked fires for an unlocked achievement and stays quiet otherwise',
      ev(ctx, { type: 'achievementUnlocked', achievement: 'Coin hoarder' }).triggered === true &&
      ev(ctx, { type: 'achievementUnlocked', achievement: 'Flawless' }).triggered === true &&
      ev(ctx, { type: 'achievementUnlocked', achievement: 'Veteran' }).triggered === false);
    check('achievementUnlocked reads the set, not the count alone',
      ev(ctx, { type: 'achievementUnlocked', achievement: 'Coin hoarder' }).context.achievementUnlocked === true &&
      ev(ctx, { type: 'achievementUnlocked', achievement: 'Veteran' }).context.achievementUnlocked === false);
    check('achievementUnlocked reads false for a blank achievement and reversed fires for a locked one',
      ev(ctx, { type: 'achievementUnlocked', achievement: '' }).triggered === false &&
      ev(ctx, { type: 'achievementUnlocked', achievement: 'Veteran', reversed: true }).triggered === true &&
      ev(ctx, { type: 'achievementUnlocked', achievement: 'Coin hoarder', reversed: true }).triggered === false);
    check('achievementUnlocked reports the achievement name in its context',
      ev(ctx, { type: 'achievementUnlocked', achievement: 'Flawless' }).context.achievement === 'Flawless');
    check('achievementCount compares against the value with every operator',
      ev(ctx, { type: 'achievementCount', operator: '>=', value: 2 }).triggered === true &&
      ev(ctx, { type: 'achievementCount', operator: '>', value: 2 }).triggered === false &&
      ev(ctx, { type: 'achievementCount', operator: '==', value: 2 }).triggered === true &&
      ev(ctx, { type: 'achievementCount', operator: '!=', value: 2 }).triggered === false &&
      ev(ctx, { type: 'achievementCount', operator: '<=', value: 2 }).triggered === true &&
      ev(ctx, { type: 'achievementCount', operator: '<', value: 2 }).triggered === false);
    check('achievementCount reads an empty set as 0 and still compares',
      ev(makeCtx({ achievementLog: { unlocked: {} } }), { type: 'achievementCount', operator: '==', value: 0 }).triggered === true &&
      ev(makeCtx({ achievementLog: { unlocked: {} } }), { type: 'achievementCount', operator: '>=', value: 1 }).triggered === false);
    check('achievementCount reversed fires when the comparison fails',
      ev(ctx, { type: 'achievementCount', operator: '>', value: 2, reversed: true }).triggered === true);
    check('achievementCount reports the held count in its context',
      ev(ctx, { type: 'achievementCount', operator: '>=', value: 1 }).context.count === 2 &&
      ev(makeCtx({ achievementLog: { unlocked: {} } }), { type: 'achievementCount', operator: '==', value: 0 }).context.count === 0);
    check('achievement conditions read false with no unlocked set at all',
      ev(makeCtx(), { type: 'achievementUnlocked', achievement: 'Coin hoarder' }).triggered === false &&
      ev(makeCtx(), { type: 'achievementCount', operator: '>', value: 0 }).triggered === false);
    check('achievement conditions are not frozen while paused (they are state reads)',
      !C.FROZEN_WHILE_PAUSED.includes('achievementUnlocked') &&
      !C.FROZEN_WHILE_PAUSED.includes('achievementCount'));
  }
  // --- high-score conditions (P4 Advanced batch 12) ---
  {
    const table = { entries: [
      { name: 'Alex', score: 200, date: 1 },
      { name: 'Bob', score: 100, date: 2 },
      { name: 'Cid', score: 50, date: 3 }
    ] };
    const cfg = { maxEntries: 3, defaultName: 'Player' };
    const ctx = makeCtx({ highScoreTable: table, highScoreConfig: cfg });
    check('isHighScore fires while the table has room',
      ev(makeCtx({ highScoreTable: { entries: [] }, highScoreConfig: cfg }), { type: 'isHighScore', score: 0 }).triggered === true);
    check('isHighScore fires for a score beating the lowest entry on a full table',
      ev(ctx, { type: 'isHighScore', score: 75 }).triggered === true);
    check('isHighScore stays quiet for a score below the lowest entry on a full table',
      ev(ctx, { type: 'isHighScore', score: 10 }).triggered === false);
    check('isHighScore stays quiet for a score tied with the lowest entry on a full table',
      ev(ctx, { type: 'isHighScore', score: 50 }).triggered === false);
    check('isHighScore reads the minimum score, not the last row, on an unsorted table',
      ev(makeCtx({ highScoreTable: { entries: [{ name: 'A', score: 50, date: 1 }, { name: 'B', score: 200, date: 2 }, { name: 'C', score: 100, date: 3 }] }, highScoreConfig: cfg }), { type: 'isHighScore', score: 75 }).triggered === true &&
      ev(makeCtx({ highScoreTable: { entries: [{ name: 'A', score: 50, date: 1 }, { name: 'B', score: 200, date: 2 }, { name: 'C', score: 100, date: 3 }] }, highScoreConfig: cfg }), { type: 'isHighScore', score: 40 }).triggered === false);
    check('isHighScore reads false for a non-numeric score',
      ev(makeCtx({ highScoreTable: table, highScoreConfig: cfg, expr: (v) => Number(v) }), { type: 'isHighScore', score: 'lots' }).triggered === false);
    check('isHighScore reversed fires when the score would not make the table',
      ev(ctx, { type: 'isHighScore', score: 10, reversed: true }).triggered === true &&
      ev(ctx, { type: 'isHighScore', score: 75, reversed: true }).triggered === false);
    check('isHighScore reports the score in its context',
      ev(ctx, { type: 'isHighScore', score: 75 }).context.score === 75 &&
      ev(ctx, { type: 'isHighScore', score: 75 }).context.isHighScore === true);
    check('isHighScore reads false with no table at all',
      ev(makeCtx(), { type: 'isHighScore', score: 999 }).triggered === false);
    check('isHighScore reads the 10-entry default with no config',
      ev(makeCtx({ highScoreTable: { entries: [{ name: 'A', score: 100, date: 1 }] } }), { type: 'isHighScore', score: 0 }).triggered === true);
    check('highScoreCount compares against the value with every operator',
      ev(ctx, { type: 'highScoreCount', operator: '>=', value: 3 }).triggered === true &&
      ev(ctx, { type: 'highScoreCount', operator: '>', value: 3 }).triggered === false &&
      ev(ctx, { type: 'highScoreCount', operator: '==', value: 3 }).triggered === true &&
      ev(ctx, { type: 'highScoreCount', operator: '!=', value: 3 }).triggered === false &&
      ev(ctx, { type: 'highScoreCount', operator: '<=', value: 3 }).triggered === true &&
      ev(ctx, { type: 'highScoreCount', operator: '<', value: 3 }).triggered === false);
    check('highScoreCount reads an empty table as 0 and still compares',
      ev(makeCtx({ highScoreTable: { entries: [] } }), { type: 'highScoreCount', operator: '==', value: 0 }).triggered === true &&
      ev(makeCtx({ highScoreTable: { entries: [] } }), { type: 'highScoreCount', operator: '>=', value: 1 }).triggered === false);
    check('highScoreCount reversed fires when the comparison fails',
      ev(ctx, { type: 'highScoreCount', operator: '>', value: 3, reversed: true }).triggered === true);
    check('highScoreCount reports the held count in its context',
      ev(ctx, { type: 'highScoreCount', operator: '>=', value: 1 }).context.count === 3 &&
      ev(makeCtx({ highScoreTable: { entries: [] } }), { type: 'highScoreCount', operator: '==', value: 0 }).context.count === 0);
    check('high-score conditions read false with no table at all',
      ev(makeCtx(), { type: 'isHighScore', score: 999 }).triggered === false &&
      ev(makeCtx(), { type: 'highScoreCount', operator: '>', value: 0 }).triggered === false);
    check('high-score conditions are not frozen while paused (they are state reads)',
      !C.FROZEN_WHILE_PAUSED.includes('isHighScore') &&
      !C.FROZEN_WHILE_PAUSED.includes('highScoreCount'));
  }
  // --- time-scale conditions (P4 Advanced batch 13) ---
  {
    const ctx = makeCtx({ timeScale: { scale: 0.5 } });
    check('timeScale compares against the value with every operator',
      ev(ctx, { type: 'timeScale', operator: '<', value: 1 }).triggered === true &&
      ev(ctx, { type: 'timeScale', operator: '>=', value: 0.5 }).triggered === true &&
      ev(ctx, { type: 'timeScale', operator: '==', value: 0.5 }).triggered === true &&
      ev(ctx, { type: 'timeScale', operator: '!=', value: 0.5 }).triggered === false &&
      ev(ctx, { type: 'timeScale', operator: '>', value: 0.5 }).triggered === false &&
      ev(ctx, { type: 'timeScale', operator: '<=', value: 0.5 }).triggered === true);
    check('timeScale stays quiet at normal speed for a slow-motion gate',
      ev(makeCtx({ timeScale: { scale: 1 } }), { type: 'timeScale', operator: '<', value: 1 }).triggered === false &&
      ev(makeCtx({ timeScale: { scale: 2 } }), { type: 'timeScale', operator: '>', value: 1 }).triggered === true);
    check('timeScale reversed fires when the comparison fails',
      ev(ctx, { type: 'timeScale', operator: '==', value: 1, reversed: true }).triggered === true &&
      ev(ctx, { type: 'timeScale', operator: '<', value: 1, reversed: true }).triggered === false);
    check('timeScale reports the live scale in its context',
      ev(ctx, { type: 'timeScale', operator: '<', value: 1 }).context.scale === 0.5 &&
      ev(ctx, { type: 'timeScale', operator: '<', value: 1 }).context.timeScale === true);
    check('timeScale reads 1 with no runtime at all (the comparison still runs)',
      ev(makeCtx(), { type: 'timeScale', operator: '==', value: 1 }).triggered === true &&
      ev(makeCtx(), { type: 'timeScale', operator: '<', value: 1 }).triggered === false);
    check('timeScale reads 1 on a corrupt scale',
      ev(makeCtx({ timeScale: { scale: 'fast' } }), { type: 'timeScale', operator: '==', value: 1 }).triggered === true);
    check('timeScale with a non-numeric value reads as 0',
      ev(makeCtx({ timeScale: { scale: 0 } }), { type: 'timeScale', operator: '==', value: 'lots' }).triggered === true);
    check('timeScale is not frozen while paused (it is a state read)',
      !C.FROZEN_WHILE_PAUSED.includes('timeScale'));
  }
  // --- transition conditions (P4 Advanced batch 14) ---
  {
    const playing = { phase: 'out', effect: 'fade', duration: 0.5, elapsed: 0.1, pendingScene: 'Level 2', lastFinished: null };
    const ctx = makeCtx({ transition: playing });
    check('transitionPlaying fires while a transition runs, for any scene or the target',
      ev(ctx, { type: 'transitionPlaying' }).triggered === true &&
      ev(ctx, { type: 'transitionPlaying', sceneId: 'Level 2' }).triggered === true &&
      ev(ctx, { type: 'transitionPlaying', sceneId: 2 }).triggered === false);
    check('transitionPlaying stays quiet for another scene',
      ev(ctx, { type: 'transitionPlaying', sceneId: 'Menu' }).triggered === false);
    check('transitionPlaying reads the numeric scene id from the scene select',
      ev(makeCtx({ transition: { phase: 'in', effect: 'wipe', duration: 1, elapsed: 0.2, pendingScene: '2', lastFinished: null } }),
        { type: 'transitionPlaying', sceneId: 2 }).triggered === true);
    check('transitionPlaying reversed fires when no transition runs',
      ev(ctx, { type: 'transitionPlaying', sceneId: 'Menu', reversed: true }).triggered === true &&
      ev(ctx, { type: 'transitionPlaying', reversed: true }).triggered === false);
    check('transitionPlaying reports the playing state in its context',
      ev(ctx, { type: 'transitionPlaying' }).context.transitionPlaying === true &&
      ev(ctx, { type: 'transitionPlaying', sceneId: 'Menu' }).context.transitionPlaying === false);
    check('transitionPlaying reads false with no runtime at all',
      ev(makeCtx(), { type: 'transitionPlaying' }).triggered === false &&
      ev(makeCtx(), { type: 'transitionPlaying', sceneId: 'Level 2' }).triggered === false);
    const done = { phase: 'idle', effect: 'fade', duration: 0.5, elapsed: 0, pendingScene: null, lastFinished: 'Level 2' };
    const ctx2 = makeCtx({ transition: done });
    check('transitionFinished fires for the most recently finished scene, or any scene when blank',
      ev(ctx2, { type: 'transitionFinished' }).triggered === true &&
      ev(ctx2, { type: 'transitionFinished', sceneId: 'Level 2' }).triggered === true);
    check('transitionFinished stays quiet for another scene',
      ev(ctx2, { type: 'transitionFinished', sceneId: 'Menu' }).triggered === false);
    check('transitionFinished reversed fires when a different scene finished',
      ev(ctx2, { type: 'transitionFinished', sceneId: 'Menu', reversed: true }).triggered === true &&
      ev(ctx2, { type: 'transitionFinished', reversed: true }).triggered === false);
    check('transitionFinished reads false while a transition is still playing',
      ev(ctx, { type: 'transitionFinished' }).triggered === false);
    check('transitionFinished reads false with no runtime at all',
      ev(makeCtx(), { type: 'transitionFinished' }).triggered === false);
    check('transition conditions are not frozen while paused (they are state reads)',
      !C.FROZEN_WHILE_PAUSED.includes('transitionPlaying') &&
      !C.FROZEN_WHILE_PAUSED.includes('transitionFinished'));
  }
  // --- camera-feel conditions (P4 Advanced batch 15) ---
  {
    const following = makeCtx({ camera: { x: 0, y: 0, zoom: 1, followTarget: 'hero' } });
    const idle = makeCtx({ camera: { x: 0, y: 0, zoom: 1, followTarget: '' } });
    check('cameraFollowing fires while the camera follows a target',
      ev(following, { type: 'cameraFollowing' }).triggered === true);
    check('cameraFollowing stays quiet once the follow is cleared',
      ev(idle, { type: 'cameraFollowing' }).triggered === false);
    check('cameraFollowing reversed fires while nothing is followed',
      ev(idle, { type: 'cameraFollowing', reversed: true }).triggered === true &&
      ev(following, { type: 'cameraFollowing', reversed: true }).triggered === false);
    check('cameraFollowing reads a whitespace-only target as not following',
      ev(makeCtx({ camera: { x: 0, y: 0, zoom: 1, followTarget: '   ' } }),
        { type: 'cameraFollowing' }).triggered === false);
    check('cameraFollowing reads false with no camera record at all',
      ev(makeCtx({ camera: null }), { type: 'cameraFollowing' }).triggered === false &&
      ev(makeCtx({ camera: undefined }), { type: 'cameraFollowing' }).triggered === false);
    check('cameraFollowing reports the following state in its context',
      ev(following, { type: 'cameraFollowing' }).context.cameraFollowing === true &&
      ev(idle, { type: 'cameraFollowing' }).context.cameraFollowing === false);
    check('cameraFollowing is not frozen while paused (it is a state read)',
      !C.FROZEN_WHILE_PAUSED.includes('cameraFollowing'));
  }
  // --- parallax conditions (P4 Advanced batch 16) ---
  {
    const ctx = makeCtx({ parallaxModule: PX });
    const wall0 = ctx.named('wall')[0];
    wall0.parallaxX = 0.5; wall0.parallaxY = 0.25;
    check('parallaxFactor fires when the factor matches (X axis)',
      ev(ctx, { type: 'parallaxFactor', targetObject: 'wall', axis: 'parallaxX', operator: '==', value: 0.5 }).triggered === true);
    check('parallaxFactor fires on the Y axis too',
      ev(ctx, { type: 'parallaxFactor', targetObject: 'wall', axis: 'parallaxY', operator: '==', value: 0.25 }).triggered === true);
    check('parallaxFactor stays quiet on a different factor',
      ev(ctx, { type: 'parallaxFactor', targetObject: 'wall', axis: 'parallaxX', operator: '==', value: 1 }).triggered === false);
    check('parallaxFactor compares with operators (>=, <)',
      ev(ctx, { type: 'parallaxFactor', targetObject: 'wall', axis: 'parallaxX', operator: '>=', value: 0.5 }).triggered === true &&
      ev(ctx, { type: 'parallaxFactor', targetObject: 'wall', axis: 'parallaxX', operator: '<', value: 0.5 }).triggered === false);
    check('parallaxFactor reversed fires when the factor does not match',
      ev(ctx, { type: 'parallaxFactor', targetObject: 'wall', axis: 'parallaxX', operator: '==', value: 1, reversed: true }).triggered === true &&
      ev(ctx, { type: 'parallaxFactor', targetObject: 'wall', axis: 'parallaxX', operator: '==', value: 0.5, reversed: true }).triggered === false);
    check('parallaxFactor reads an un-normalized object as world speed (1)',
      ev(ctx, { type: 'parallaxFactor', targetObject: 'crate', axis: 'parallaxX', operator: '==', value: 1 }).triggered === true);
    check('parallaxFactor stays quiet for a missing object',
      ev(ctx, { type: 'parallaxFactor', targetObject: 'ghost2', axis: 'parallaxX', operator: '==', value: 1 }).triggered === false);
    check('parallaxFactor reports the matched object in its context',
      ev(ctx, { type: 'parallaxFactor', targetObject: 'wall', axis: 'parallaxX', operator: '==', value: 0.5 }).context.obj1 === wall0);
    const noModCtx = makeCtx();
    const hero2 = noModCtx.named('hero')[0];
    hero2.parallaxX = 0.5;
    check('parallaxFactor reads the raw fields without the module (same answer)',
      ev(noModCtx, { type: 'parallaxFactor', targetObject: 'hero', axis: 'parallaxX', operator: '==', value: 0.5 }).triggered === true);
    const noModCtx2 = makeCtx();
    check('parallaxFactor reads a missing field as 1 without the module',
      ev(noModCtx2, { type: 'parallaxFactor', targetObject: 'wall', axis: 'parallaxX', operator: '==', value: 1 }).triggered === true);
    check('parallaxFactor is not frozen while paused (it is a state read)',
      !C.FROZEN_WHILE_PAUSED.includes('parallaxFactor'));
    // Mouse Over uses the parallax camera: the wall sits at world
    // 100..140, the camera at 200, the factor 0.5, so it draws at
    // screen 0..40 — a mouse at screen (20, 25) is over it, and the
    // same mouse misses it at world speed.
    const hitCtx = makeCtx({
      parallaxModule: PX,
      camera: { x: 200, y: 0, zoom: 1 },
      mouse: { x: 20, y: 25 }
    });
    const wall = hitCtx.named('wall')[0];
    wall.parallaxX = 0.5; wall.parallaxY = 1;
    check('mouseOver hits a parallax object at its drawn position',
      ev(hitCtx, { type: 'mouseOverObject', targetObject: 'wall' }).triggered === true);
    wall.parallaxX = 1;
    check('mouseOver misses the same object at world speed (drawn off-screen)',
      ev(hitCtx, { type: 'mouseOverObject', targetObject: 'wall' }).triggered === false);
  }
  // --- pathfinding conditions (P4 Advanced batch 18) ---
  {
    const ctx = makeCtx({ pathfindModule: PF });
    const hero0 = ctx.named('hero')[0];
    check('pathFinished and hasPath both stay quiet with no path',
      ev(ctx, { type: 'pathFinished', targetObject: 'hero' }).triggered === false &&
      ev(ctx, { type: 'hasPath', targetObject: 'hero' }).triggered === false);
    hero0._path = { points: [{ x: 30, y: 40 }, { x: 120, y: 40 }], index: 1, speed: 100, done: false };
    check('hasPath fires while the path is walking, pathFinished stays quiet',
      ev(ctx, { type: 'hasPath', targetObject: 'hero' }).triggered === true &&
      ev(ctx, { type: 'pathFinished', targetObject: 'hero' }).triggered === false);
    hero0._path.done = true;
    check('pathFinished fires once the path has arrived, hasPath goes quiet',
      ev(ctx, { type: 'pathFinished', targetObject: 'hero' }).triggered === true &&
      ev(ctx, { type: 'hasPath', targetObject: 'hero' }).triggered === false);
    check('pathFinished reports the arrived object in its context',
      ev(ctx, { type: 'pathFinished', targetObject: 'hero' }).context.obj1 === hero0);
    check('hasPath reports the walking object in its context',
      (function () {
        hero0._path.done = false;
        return ev(ctx, { type: 'hasPath', targetObject: 'hero' }).context.obj1 === hero0;
      })());
    check('pathFinished reversed fires while the path is still walking',
      (function () {
        hero0._path.done = false;
        return ev(ctx, { type: 'pathFinished', targetObject: 'hero', reversed: true }).triggered === true &&
          ev(ctx, { type: 'hasPath', targetObject: 'hero', reversed: true }).triggered === false;
      })());
    check('both path conditions stay quiet for a missing object',
      ev(ctx, { type: 'pathFinished', targetObject: 'ghost2' }).triggered === false &&
      ev(ctx, { type: 'hasPath', targetObject: 'ghost2' }).triggered === false);
    check('pathFinished and hasPath are not frozen while paused (they are state reads)',
      !C.FROZEN_WHILE_PAUSED.includes('pathFinished') &&
      !C.FROZEN_WHILE_PAUSED.includes('hasPath'));
    const noModCtx = makeCtx();
    const hero2 = noModCtx.named('hero')[0];
    hero2._path = { points: [{ x: 30, y: 40 }], index: 0, speed: 100, done: true };
    check('pathFinished reads the raw record without the module (same answer)',
      ev(noModCtx, { type: 'pathFinished', targetObject: 'hero' }).triggered === true &&
      ev(noModCtx, { type: 'hasPath', targetObject: 'hero' }).triggered === false);
  }
  // --- AI behavior conditions (P4 Advanced batch 19) ---
  // hero id 1 sits at (10, 20) 40x40, center (30, 40); wall at
  // (100, 20), center (120, 40), 90 away; target at (90, 90) 20x20,
  // center (100, 100), ~92 away.
  {
    const ctx = makeCtx({ aiModule: AI });
    const hero0 = ctx.named('hero')[0];
    check('aiBehavior stays quiet with no behavior record',
      ev(ctx, { type: 'aiBehavior', targetObject: 'hero', behavior: 'chase' }).triggered === false);
    hero0._ai = { behavior: 'chase', target: 'wall', speed: 100, range: 300 };
    check('aiBehavior fires for the running behavior and stays quiet otherwise',
      ev(ctx, { type: 'aiBehavior', targetObject: 'hero', behavior: 'chase' }).triggered === true &&
      ev(ctx, { type: 'aiBehavior', targetObject: 'hero', behavior: 'patrol' }).triggered === false &&
      // 'wall' has no record at all, so only 'none' fires for it.
      ev(ctx, { type: 'aiBehavior', targetObject: 'wall', behavior: 'chase' }).triggered === false &&
      ev(ctx, { type: 'aiBehavior', targetObject: 'wall', behavior: 'none' }).triggered === true);
    check('aiBehavior reports the driven object in its context',
      ev(ctx, { type: 'aiBehavior', targetObject: 'hero', behavior: 'chase' }).context.obj1 === hero0);
    check('aiBehavior reversed fires while the object runs another behavior',
      ev(ctx, { type: 'aiBehavior', targetObject: 'hero', behavior: 'patrol', reversed: true }).triggered === true &&
      ev(ctx, { type: 'aiBehavior', targetObject: 'hero', behavior: 'chase', reversed: true }).triggered === false);
    check('aiBehavior stays quiet for a missing object',
      ev(ctx, { type: 'aiBehavior', targetObject: 'ghost2', behavior: 'chase' }).triggered === false);
    check('aiBehavior is not frozen while paused (it is a state read)',
      !C.FROZEN_WHILE_PAUSED.includes('aiBehavior'));
    const noModCtx = makeCtx();
    const hero2 = noModCtx.named('hero')[0];
    hero2._ai = { behavior: 'wander', target: '', speed: 100, range: 200 };
    check('aiBehavior reads the raw record without the module (same answer)',
      ev(noModCtx, { type: 'aiBehavior', targetObject: 'hero', behavior: 'wander' }).triggered === true &&
      ev(noModCtx, { type: 'aiBehavior', targetObject: 'hero', behavior: 'chase' }).triggered === false);
  }
  {
    const ctx = makeCtx({ aiModule: AI });
    check('targetInRange fires inside the range and stays quiet past it',
      ev(ctx, { type: 'targetInRange', targetObject: 'hero', targetName: 'wall', range: 100 }).triggered === true &&
      ev(ctx, { type: 'targetInRange', targetObject: 'hero', targetName: 'wall', range: 50 }).triggered === false);
    check('targetInRange reads the second named object too (hero to target, ~92 away)',
      ev(ctx, { type: 'targetInRange', targetObject: 'hero', targetName: 'target', range: 100 }).triggered === true &&
      ev(ctx, { type: 'targetInRange', targetObject: 'hero', targetName: 'target', range: 90 }).triggered === false);
    check('targetInRange reports both objects in its context',
      (function () {
        const c = ev(ctx, { type: 'targetInRange', targetObject: 'hero', targetName: 'wall', range: 100 }).context;
        return c.obj1 === ctx.named('hero')[0] && c.obj2 === ctx.named('wall')[0];
      })());
    check('targetInRange reversed fires while the target is out of range',
      ev(ctx, { type: 'targetInRange', targetObject: 'hero', targetName: 'wall', range: 50, reversed: true }).triggered === true &&
      ev(ctx, { type: 'targetInRange', targetObject: 'hero', targetName: 'wall', range: 100, reversed: true }).triggered === false);
    check('targetInRange stays quiet for a missing object or target',
      ev(ctx, { type: 'targetInRange', targetObject: 'ghost2', targetName: 'wall', range: 100 }).triggered === false &&
      ev(ctx, { type: 'targetInRange', targetObject: 'hero', targetName: 'ghost2', range: 100 }).triggered === false);
    check('targetInRange with a failed range reads as 0 (only a target on top matches)',
      ev(ctx, { type: 'targetInRange', targetObject: 'hero', targetName: 'wall', range: 'far' }).triggered === false &&
      ev(ctx, { type: 'targetInRange', targetObject: 'hero', targetName: 'hero', range: 'far' }).triggered === true);
    check('targetInRange is not frozen while paused (it is a state read)',
      !C.FROZEN_WHILE_PAUSED.includes('targetInRange'));
    const noModCtx = makeCtx();
    check('targetInRange reads the raw centers without the module (same answer)',
      ev(noModCtx, { type: 'targetInRange', targetObject: 'hero', targetName: 'wall', range: 100 }).triggered === true &&
      ev(noModCtx, { type: 'targetInRange', targetObject: 'hero', targetName: 'wall', range: 50 }).triggered === false);
  }
  // --- Joystick conditions (P4 Advanced batch 20) ---
  // The stick is run state on the ctx: a live record driven through
  // the module (grab at the bottom-left base (76, 524) on an 800x600
  // view, drag to tilt). A held-but-centered stick reads quiet.
  function joyCtx() {
    const cfg = J.defaultJoystickConfig();
    cfg.enabled = true;
    const ctx = makeCtx({ joystickModule: J });
    ctx.joystick = J.createJoystickRuntime(cfg);
    ctx.joystickConfig = cfg;
    return ctx;
  }
  function tiltCtx(px, py) {
    const ctx = joyCtx();
    J.joystickStart(ctx.joystick, ctx.joystickConfig, 'mouse', 76, 524, 800, 600);
    J.joystickMove(ctx.joystick, ctx.joystickConfig, 'mouse', px, py);
    return ctx;
  }
  {
    const ctx = joyCtx();
    check('joystickActive stays quiet with no grab',
      ev(ctx, { type: 'joystickActive' }).triggered === false);
    J.joystickStart(ctx.joystick, ctx.joystickConfig, 'mouse', 76, 524, 800, 600);
    check('joystickActive stays quiet for a held-but-centered stick',
      ev(ctx, { type: 'joystickActive' }).triggered === false);
    J.joystickMove(ctx.joystick, ctx.joystickConfig, 'mouse', 136, 524);
    check('joystickActive fires while the stick is tilted',
      ev(ctx, { type: 'joystickActive' }).triggered === true);
    check('joystickActive reports the steering state in its context',
      ev(ctx, { type: 'joystickActive' }).context.joystickActive === true);
    check('joystickActive reversed fires while the stick is at rest',
      ev(ctx, { type: 'joystickActive', reversed: true }).triggered === false &&
      ev(joyCtx(), { type: 'joystickActive', reversed: true }).triggered === true);
    check('joystickActive is not frozen while paused (it is an input read)',
      !C.FROZEN_WHILE_PAUSED.includes('joystickActive'));
    const noModCtx = makeCtx();
    noModCtx.joystick = J.createJoystickRuntime({ enabled: true });
    J.joystickStart(noModCtx.joystick, J.defaultJoystickConfig(), 'mouse', 76, 524, 800, 600);
    J.joystickMove(noModCtx.joystick, J.defaultJoystickConfig(), 'mouse', 136, 524);
    check('joystickActive reads the raw record without the module (same answer)',
      ev(noModCtx, { type: 'joystickActive' }).triggered === true);
  }
  {
    const right = tiltCtx(136, 524);
    const up = tiltCtx(76, 464);
    const half = tiltCtx(106, 524);
    check('joystickTilt fires for the tilted direction and stays quiet otherwise',
      ev(right, { type: 'joystickTilt', direction: 'right', minTilt: 0.5 }).triggered === true &&
      ev(right, { type: 'joystickTilt', direction: 'left', minTilt: 0.5 }).triggered === false &&
      ev(right, { type: 'joystickTilt', direction: 'any', minTilt: 0.5 }).triggered === true &&
      ev(up, { type: 'joystickTilt', direction: 'up', minTilt: 0.5 }).triggered === true &&
      ev(up, { type: 'joystickTilt', direction: 'down', minTilt: 0.5 }).triggered === false);
    check('joystickTilt honors the minimum tilt (half tilt fires at 0.4, not 0.5)',
      ev(half, { type: 'joystickTilt', direction: 'right', minTilt: 0.4 }).triggered === true &&
      ev(half, { type: 'joystickTilt', direction: 'right', minTilt: 0.5 }).triggered === false);
    check('joystickTilt defaults a missing minimum to 0.5',
      ev(right, { type: 'joystickTilt', direction: 'right' }).triggered === true &&
      ev(half, { type: 'joystickTilt', direction: 'right' }).triggered === false);
    check('joystickTilt reports the tilt in its context',
      ev(right, { type: 'joystickTilt', direction: 'right', minTilt: 0.5 }).context.joystickTilt === true);
    check('joystickTilt reversed fires while the stick tilts the other way',
      ev(right, { type: 'joystickTilt', direction: 'left', minTilt: 0.5, reversed: true }).triggered === true &&
      ev(right, { type: 'joystickTilt', direction: 'right', minTilt: 0.5, reversed: true }).triggered === false);
    check('joystickTilt stays quiet with no grab or no stick',
      ev(joyCtx(), { type: 'joystickTilt', direction: 'any', minTilt: 0.5 }).triggered === false &&
      ev(makeCtx({ joystickModule: J }), { type: 'joystickTilt', direction: 'any', minTilt: 0.5 }).triggered === false);
    check('joystickTilt is not frozen while paused (it is an input read)',
      !C.FROZEN_WHILE_PAUSED.includes('joystickTilt'));
    const noModCtx = makeCtx();
    noModCtx.joystick = J.createJoystickRuntime({ enabled: true });
    J.joystickStart(noModCtx.joystick, J.defaultJoystickConfig(), 'mouse', 76, 524, 800, 600);
    J.joystickMove(noModCtx.joystick, J.defaultJoystickConfig(), 'mouse', 136, 524);
    check('joystickTilt reads the raw record without the module (same answer)',
      ev(noModCtx, { type: 'joystickTilt', direction: 'right', minTilt: 0.5 }).triggered === true &&
      ev(noModCtx, { type: 'joystickTilt', direction: 'left', minTilt: 0.5 }).triggered === false);
  }
  // --- Health conditions (P4 Advanced batch 21) ---
  // The wall is the unique named object here (makeObjects has two
  // heroes), so its health is the one the conditions read.
  {
    function hpCtx(health, maxHealth) {
      const ctx = makeCtx({ healthModule: HP });
      const wall = ctx.named('wall')[0];
      wall.maxHealth = maxHealth === undefined ? 100 : maxHealth;
      wall.health = health;
      return ctx;
    }
    check('healthCheck fires while the health compares the picked way',
      ev(hpCtx(50), { type: 'healthCheck', targetObject: 'wall', operator: '>=', value: 50 }).triggered === true &&
      ev(hpCtx(50), { type: 'healthCheck', targetObject: 'wall', operator: '>', value: 50 }).triggered === false &&
      ev(hpCtx(50), { type: 'healthCheck', targetObject: 'wall', operator: '<=', value: 50 }).triggered === true &&
      ev(hpCtx(50), { type: 'healthCheck', targetObject: 'wall', operator: '<', value: 50 }).triggered === false &&
      ev(hpCtx(50), { type: 'healthCheck', targetObject: 'wall', operator: '==', value: 50 }).triggered === true &&
      ev(hpCtx(50), { type: 'healthCheck', targetObject: 'wall', operator: '!=', value: 50 }).triggered === false &&
      ev(hpCtx(25), { type: 'healthCheck', targetObject: 'wall', operator: '<', value: 50 }).triggered === true &&
      ev(hpCtx(25, 50), { type: 'healthCheck', targetObject: 'wall', operator: '>=', value: 50 }).triggered === false);
    check('healthCheck defaults the operator to >= and the value to 0',
      ev(hpCtx(50), { type: 'healthCheck', targetObject: 'wall' }).triggered === true &&
      ev(hpCtx(0), { type: 'healthCheck', targetObject: 'wall' }).triggered === true);
    check('healthCheck reports the health read in its context',
      ev(hpCtx(50), { type: 'healthCheck', targetObject: 'wall', operator: '>=', value: 50 }).context.healthCheck === true &&
      ev(hpCtx(50), { type: 'healthCheck', targetObject: 'wall', operator: '>=', value: 50 }).context.obj1.name === 'wall');
    check('healthCheck reversed fires while the health misses the comparison',
      ev(hpCtx(50), { type: 'healthCheck', targetObject: 'wall', operator: '>', value: 50, reversed: true }).triggered === true &&
      ev(hpCtx(50), { type: 'healthCheck', targetObject: 'wall', operator: '>=', value: 50, reversed: true }).triggered === false);
    check('healthCheck stays quiet for a missing object and is not frozen while paused',
      ev(hpCtx(50), { type: 'healthCheck', targetObject: 'ghost2', operator: '>=', value: 0 }).triggered === false &&
      ev(hpCtx(50), { type: 'healthCheck', targetObject: 'ghost2', operator: '>=', value: 0, reversed: true }).triggered === true &&
      !C.FROZEN_WHILE_PAUSED.includes('healthCheck'));
    check('healthCheck reads the raw fields without the module (same answer)',
      (() => {
        const ctx = makeCtx();
        ctx.named('wall')[0].health = 30;
        return ev(ctx, { type: 'healthCheck', targetObject: 'wall', operator: '>=', value: 30 }).triggered === true &&
          ev(ctx, { type: 'healthCheck', targetObject: 'wall', operator: '>', value: 30 }).triggered === false;
      })());
    check('objectDied fires at 0 health and stays quiet above it',
      ev(hpCtx(0), { type: 'objectDied', targetObject: 'wall' }).triggered === true &&
      ev(hpCtx(1), { type: 'objectDied', targetObject: 'wall' }).triggered === false &&
      ev(hpCtx(100), { type: 'objectDied', targetObject: 'wall' }).triggered === false);
    check('objectDied reports the dead object in its context',
      ev(hpCtx(0), { type: 'objectDied', targetObject: 'wall' }).context.objectDied === true &&
      ev(hpCtx(0), { type: 'objectDied', targetObject: 'wall' }).context.obj1.name === 'wall');
    check('objectDied reversed fires while the object lives, and is not frozen while paused',
      ev(hpCtx(50), { type: 'objectDied', targetObject: 'wall', reversed: true }).triggered === true &&
      ev(hpCtx(0), { type: 'objectDied', targetObject: 'wall', reversed: true }).triggered === false &&
      !C.FROZEN_WHILE_PAUSED.includes('objectDied'));
    check('objectDied stays quiet for a missing object',
      ev(hpCtx(0), { type: 'objectDied', targetObject: 'ghost2' }).triggered === false);
    check('objectDied reads the raw field without the module (same answer)',
      (() => {
        const ctx = makeCtx();
        ctx.named('wall')[0].health = 0;
        return ev(ctx, { type: 'objectDied', targetObject: 'wall' }).triggered === true;
      })());
  }
  // --- Is Invincible condition (P4 Advanced batch 22) ---
  // The wall is the unique named object here (makeObjects has two
  // heroes), so its shield is the one the condition reads. nowValue is
  // the frozen game clock: 1000ms for this block.
  {
    nowValue = 1000;
    function invCtx(until) {
      const ctx = makeCtx({ damageFxModule: DF });
      ctx.named('wall')[0]._invincibleUntil = until;
      return ctx;
    }
    check('isInvincible fires while the shield holds and goes quiet at expiry',
      ev(invCtx(2000), { type: 'isInvincible', targetObject: 'wall' }).triggered === true &&
      ev(invCtx(1001), { type: 'isInvincible', targetObject: 'wall' }).triggered === true &&
      ev(invCtx(1000), { type: 'isInvincible', targetObject: 'wall' }).triggered === false &&
      ev(invCtx(0), { type: 'isInvincible', targetObject: 'wall' }).triggered === false);
    check('isInvincible stays quiet for an object with no shield record',
      (() => {
        const ctx = makeCtx({ damageFxModule: DF });
        return ev(ctx, { type: 'isInvincible', targetObject: 'wall' }).triggered === false;
      })());
    check('isInvincible reports the shielded object in its context',
      ev(invCtx(2000), { type: 'isInvincible', targetObject: 'wall' }).context.isInvincible === true &&
      ev(invCtx(2000), { type: 'isInvincible', targetObject: 'wall' }).context.obj1.name === 'wall');
    check('isInvincible reversed fires while the object is vulnerable, and is not frozen while paused',
      ev(invCtx(2000), { type: 'isInvincible', targetObject: 'wall', reversed: true }).triggered === false &&
      ev(invCtx(0), { type: 'isInvincible', targetObject: 'wall', reversed: true }).triggered === true &&
      !C.FROZEN_WHILE_PAUSED.includes('isInvincible'));
    check('isInvincible stays quiet for a missing object',
      ev(invCtx(2000), { type: 'isInvincible', targetObject: 'ghost2' }).triggered === false);
    check('isInvincible reads the raw record without the module (same answer)',
      (() => {
        const ctx = makeCtx();
        ctx.named('wall')[0]._invincibleUntil = 2000;
        return ev(ctx, { type: 'isInvincible', targetObject: 'wall' }).triggered === true &&
          ev(ctx, { type: 'isInvincible', targetObject: 'wall', reversed: true }).triggered === false;
      })());
    check('isInvincible reads a non-numeric shield record as vulnerable',
      (() => {
        const ctx = makeCtx({ damageFxModule: DF });
        ctx.named('wall')[0]._invincibleUntil = 'soon';
        return ev(ctx, { type: 'isInvincible', targetObject: 'wall' }).triggered === false;
      })());
  }
  // --- Checkpoint Set / Respawn Count conditions (P4 Advanced batch 23) ---
  {
    function rspCtx(point, count) {
      const st = RM.createRespawnState();
      if (point) st.point = point;
      if (count) st.count = count;
      return makeCtx({ respawnModule: RM, respawn: st });
    }
    check('checkpointSet fires while a checkpoint is recorded and stays quiet without one',
      ev(rspCtx({ x: 500, y: 100, name: 'flag' }), { type: 'checkpointSet' }).triggered === true &&
      ev(rspCtx(null), { type: 'checkpointSet' }).triggered === false);
    check('checkpointSet reports the state in its context',
      ev(rspCtx({ x: 500, y: 100, name: 'flag' }), { type: 'checkpointSet' }).context.checkpointSet === true &&
      ev(rspCtx(null), { type: 'checkpointSet' }).context.checkpointSet === false);
    check('checkpointSet reversed fires while no checkpoint is set, and is not frozen while paused',
      ev(rspCtx({ x: 500, y: 100, name: 'flag' }), { type: 'checkpointSet', reversed: true }).triggered === false &&
      ev(rspCtx(null), { type: 'checkpointSet', reversed: true }).triggered === true &&
      !C.FROZEN_WHILE_PAUSED.includes('checkpointSet'));
    check('checkpointSet reads the raw point field without the module (same answer)',
      (() => {
        const st = { point: { x: 500, y: 100, name: 'flag' }, count: 0, initial: {} };
        const ctx = makeCtx({ respawn: st });
        return ev(ctx, { type: 'checkpointSet' }).triggered === true &&
          ev(makeCtx({ respawn: { point: null, count: 0, initial: {} } }), { type: 'checkpointSet' }).triggered === false;
      })());
    check('respawnCount compares the count with every operator',
      ev(rspCtx(null, 2), { type: 'respawnCount', operator: '>=', value: 1 }).triggered === true &&
      ev(rspCtx(null, 2), { type: 'respawnCount', operator: '>=', value: 3 }).triggered === false &&
      ev(rspCtx(null, 2), { type: 'respawnCount', operator: '==', value: 2 }).triggered === true &&
      ev(rspCtx(null, 2), { type: 'respawnCount', operator: '<', value: 2 }).triggered === false &&
      ev(rspCtx(null, 0), { type: 'respawnCount', operator: '>=', value: 1 }).triggered === false);
    check('respawnCount reports the count in its context',
      ev(rspCtx(null, 2), { type: 'respawnCount', operator: '>=', value: 1 }).context.count === 2);
    check('respawnCount reversed fires below the threshold, and is not frozen while paused',
      ev(rspCtx(null, 1), { type: 'respawnCount', operator: '>=', value: 3, reversed: true }).triggered === true &&
      ev(rspCtx(null, 3), { type: 'respawnCount', operator: '>=', value: 3, reversed: true }).triggered === false &&
      !C.FROZEN_WHILE_PAUSED.includes('respawnCount'));
    check('respawn conditions stay quiet with no respawn state at all',
      ev(makeCtx({ respawnModule: RM }), { type: 'checkpointSet' }).triggered === false &&
      ev(makeCtx({ respawnModule: RM }), { type: 'respawnCount', operator: '>=', value: 1 }).triggered === false);
  }
  // --- Spawner Active / Spawned Count conditions (P4 Advanced batch 24) ---
  {
    function spwCtx(name, spawned, active, total) {
      const st = SP.createSpawnerState();
      if (name) {
        st.spawners[name] = {
          name: name, template: 'goblin', atObject: '', x: 0, y: 0,
          interval: 2, maxAlive: 10, total: total || 0,
          active: active !== false, timer: 0, spawned: spawned || 0
        };
      }
      return makeCtx({ spawnModule: SP, spawners: st });
    }
    check('spawnerActive fires while a spawner runs and stays quiet once it stops',
      ev(spwCtx('g', 0, true), { type: 'spawnerActive', name: 'g' }).triggered === true &&
      ev(spwCtx('g', 2, false, 2), { type: 'spawnerActive', name: 'g' }).triggered === false &&
      ev(spwCtx(null), { type: 'spawnerActive', name: 'g' }).triggered === false);
    check('spawnerActive reads a finished wave as stopped even while the record still says active',
      ev(spwCtx('g', 2, true, 2), { type: 'spawnerActive', name: 'g' }).triggered === false);
    check('spawnerActive reports the state in its context',
      ev(spwCtx('g', 0, true), { type: 'spawnerActive', name: 'g' }).context.spawnerActive === true &&
      ev(spwCtx(null), { type: 'spawnerActive', name: 'g' }).context.spawnerActive === false);
    check('spawnerActive reversed fires while no spawner runs, and is not frozen while paused',
      ev(spwCtx('g', 0, true), { type: 'spawnerActive', name: 'g', reversed: true }).triggered === false &&
      ev(spwCtx(null), { type: 'spawnerActive', name: 'g', reversed: true }).triggered === true &&
      !C.FROZEN_WHILE_PAUSED.includes('spawnerActive'));
    check('spawnedCount compares the count with every operator',
      ev(spwCtx('g', 2, true), { type: 'spawnedCount', name: 'g', operator: '>=', value: 1 }).triggered === true &&
      ev(spwCtx('g', 2, true), { type: 'spawnedCount', name: 'g', operator: '>=', value: 3 }).triggered === false &&
      ev(spwCtx('g', 2, true), { type: 'spawnedCount', name: 'g', operator: '==', value: 2 }).triggered === true &&
      ev(spwCtx('g', 2, true), { type: 'spawnedCount', name: 'g', operator: '<', value: 2 }).triggered === false &&
      ev(spwCtx(null), { type: 'spawnedCount', name: 'g', operator: '>=', value: 1 }).triggered === false);
    check('spawnedCount reports the count in its context',
      ev(spwCtx('g', 2, true), { type: 'spawnedCount', name: 'g', operator: '>=', value: 1 }).context.count === 2);
    check('spawnedCount reversed fires below the threshold, and is not frozen while paused',
      ev(spwCtx('g', 1, true), { type: 'spawnedCount', name: 'g', operator: '>=', value: 3, reversed: true }).triggered === true &&
      ev(spwCtx('g', 3, true), { type: 'spawnedCount', name: 'g', operator: '>=', value: 3, reversed: true }).triggered === false &&
      !C.FROZEN_WHILE_PAUSED.includes('spawnedCount'));
    check('spawner conditions read the raw record without the module (same answer)',
      (() => {
        const st = { spawners: { g: { name: 'g', template: 'goblin', interval: 2, maxAlive: 10, total: 0, active: true, timer: 0, spawned: 2 } } };
        const ctx = makeCtx({ spawners: st });
        return ev(ctx, { type: 'spawnerActive', name: 'g' }).triggered === true &&
          ev(ctx, { type: 'spawnedCount', name: 'g', operator: '>=', value: 2 }).triggered === true;
      })());
    check('spawner conditions stay quiet with no spawner state at all',
      ev(makeCtx({ spawnModule: SP }), { type: 'spawnerActive', name: 'g' }).triggered === false &&
      ev(makeCtx({ spawnModule: SP }), { type: 'spawnedCount', name: 'g', operator: '>=', value: 1 }).triggered === false);
  }
  // --- Lives / Game Over conditions (P4 Advanced batch 25) ---
  {
    function lvCtx(n) {
      const st = LV.createLivesState();
      if (typeof n === 'number') st.lives = n;
      return makeCtx({ livesModule: LV, lives: st });
    }
    check('lives compares the count with every operator',
      ev(lvCtx(3), { type: 'lives', operator: '>=', value: 1 }).triggered === true &&
      ev(lvCtx(3), { type: 'lives', operator: '>=', value: 4 }).triggered === false &&
      ev(lvCtx(3), { type: 'lives', operator: '==', value: 3 }).triggered === true &&
      ev(lvCtx(3), { type: 'lives', operator: '<', value: 3 }).triggered === false &&
      ev(lvCtx(0), { type: 'lives', operator: '==', value: 0 }).triggered === true);
    check('lives reports the count in its context',
      ev(lvCtx(2), { type: 'lives', operator: '>=', value: 1 }).context.count === 2);
    check('lives reversed fires below the threshold, and is not frozen while paused',
      ev(lvCtx(1), { type: 'lives', operator: '>=', value: 3, reversed: true }).triggered === true &&
      ev(lvCtx(3), { type: 'lives', operator: '>=', value: 3, reversed: true }).triggered === false &&
      !C.FROZEN_WHILE_PAUSED.includes('lives'));
    check('gameOver fires at 0 and stays quiet with lives left',
      ev(lvCtx(0), { type: 'gameOver' }).triggered === true &&
      ev(lvCtx(1), { type: 'gameOver' }).triggered === false &&
      ev(lvCtx(3), { type: 'gameOver' }).triggered === false);
    check('gameOver reports the state in its context',
      ev(lvCtx(0), { type: 'gameOver' }).context.gameOver === true &&
      ev(lvCtx(1), { type: 'gameOver' }).context.gameOver === false);
    check('gameOver reversed fires while the game runs, and is not frozen while paused',
      ev(lvCtx(0), { type: 'gameOver', reversed: true }).triggered === false &&
      ev(lvCtx(1), { type: 'gameOver', reversed: true }).triggered === true &&
      !C.FROZEN_WHILE_PAUSED.includes('gameOver'));
    check('lives conditions read the raw count without the module (same answer)',
      (() => {
        const ctx = makeCtx({ lives: { lives: 2 } });
        return ev(ctx, { type: 'lives', operator: '>=', value: 2 }).triggered === true &&
          ev(ctx, { type: 'gameOver' }).triggered === false;
      })());
    check('lives conditions read a missing state as the default 3 (no game over)',
      ev(makeCtx({ livesModule: LV }), { type: 'lives', operator: '>=', value: 1 }).triggered === true &&
      ev(makeCtx({ livesModule: LV }), { type: 'gameOver' }).triggered === false &&
      ev(makeCtx({}), { type: 'gameOver' }).triggered === false);
  }
  // --- XP / Level / Level Up conditions (P4 Advanced batch 30) ---
  {
    function xpCtx(total, per) {
      const st = XP.createXpState();
      if (typeof total === 'number') st.xp = total;
      if (typeof per === 'number') st.xpPerLevel = per;
      return makeCtx({ xpModule: XP, xp: st });
    }
    check('xp compares the total with every operator',
      ev(xpCtx(250), { type: 'xp', operator: '>=', value: 100 }).triggered === true &&
      ev(xpCtx(250), { type: 'xp', operator: '>=', value: 300 }).triggered === false &&
      ev(xpCtx(250), { type: 'xp', operator: '==', value: 250 }).triggered === true &&
      ev(xpCtx(250), { type: 'xp', operator: '<', value: 250 }).triggered === false &&
      ev(xpCtx(0), { type: 'xp', operator: '==', value: 0 }).triggered === true);
    check('xp reports the total in its context',
      ev(xpCtx(250), { type: 'xp', operator: '>=', value: 100 }).context.count === 250);
    check('xp reversed fires below the threshold, and is not frozen while paused',
      ev(xpCtx(10), { type: 'xp', operator: '>=', value: 100, reversed: true }).triggered === true &&
      ev(xpCtx(250), { type: 'xp', operator: '>=', value: 100, reversed: true }).triggered === false &&
      !C.FROZEN_WHILE_PAUSED.includes('xp'));
    check('level compares the derived level with every operator',
      ev(xpCtx(250), { type: 'level', operator: '>=', value: 2 }).triggered === true &&
      ev(xpCtx(250), { type: 'level', operator: '>=', value: 4 }).triggered === false &&
      ev(xpCtx(250), { type: 'level', operator: '==', value: 3 }).triggered === true &&
      ev(xpCtx(99), { type: 'level', operator: '==', value: 1 }).triggered === true &&
      ev(xpCtx(250, 50), { type: 'level', operator: '==', value: 6 }).triggered === true);
    check('level reports the level in its context',
      ev(xpCtx(250), { type: 'level', operator: '>=', value: 2 }).context.count === 3);
    check('level reversed fires below the threshold, and is not frozen while paused',
      ev(xpCtx(0), { type: 'level', operator: '>=', value: 2, reversed: true }).triggered === true &&
      ev(xpCtx(250), { type: 'level', operator: '>=', value: 2, reversed: true }).triggered === false &&
      !C.FROZEN_WHILE_PAUSED.includes('level'));
    check('levelUp fires once per level increase and is consumed on read',
      (() => {
        const st = XP.createXpState();
        const ctx = makeCtx({ xpModule: XP, xp: st });
        const before = ev(ctx, { type: 'levelUp' }).triggered;
        XP.addXp(st, 100);
        const first = ev(ctx, { type: 'levelUp' }).triggered;
        const second = ev(ctx, { type: 'levelUp' }).triggered;
        XP.addXp(st, 100);
        const third = ev(ctx, { type: 'levelUp' }).triggered;
        return before === false && first === true && second === false && third === true;
      })());
    check('levelUp reports the state in its context',
      (() => {
        const st = XP.createXpState();
        const ctx = makeCtx({ xpModule: XP, xp: st });
        XP.addXp(st, 100);
        return ev(ctx, { type: 'levelUp' }).context.levelUp === true;
      })());
    check('levelUp reversed fires while no level-up is pending, and is not frozen while paused',
      ev(xpCtx(0), { type: 'levelUp', reversed: true }).triggered === true &&
      !C.FROZEN_WHILE_PAUSED.includes('levelUp'));
    check('XP conditions read the raw fields without the module (same answer)',
      (() => {
        const ctx = makeCtx({ xp: { xp: 250, xpPerLevel: 100, levelAnnounced: 3 } });
        return ev(ctx, { type: 'xp', operator: '>=', value: 100 }).triggered === true &&
          ev(ctx, { type: 'level', operator: '==', value: 3 }).triggered === true &&
          ev(ctx, { type: 'levelUp' }).triggered === false;
      })());
    check('XP conditions read a raw level-up without the module (consume-on-read fallback)',
      (() => {
        const st = { xp: 0, xpPerLevel: 100, levelAnnounced: 1 };
        const ctx = makeCtx({ xp: st });
        st.xp = 100;
        const first = ev(ctx, { type: 'levelUp' }).triggered;
        const second = ev(ctx, { type: 'levelUp' }).triggered;
        return first === true && second === false;
      })());
    check('XP conditions read a missing state as 0 XP at level 1 (no level up)',
      ev(makeCtx({ xpModule: XP }), { type: 'xp', operator: '>=', value: 1 }).triggered === false &&
      ev(makeCtx({ xpModule: XP }), { type: 'level', operator: '==', value: 1 }).triggered === true &&
      ev(makeCtx({ xpModule: XP }), { type: 'levelUp' }).triggered === false &&
      ev(makeCtx({}), { type: 'levelUp' }).triggered === false);
  }
  // --- Enemy Level condition (P4 Advanced batch 32) ---
  {
    // The fixture has two heroes, so the subject is the single-instance
    // ghost (id 4) — the same fixture rule the movement section uses.
    function scCtx(level) {
      const st = SC.createScalingState();
      if (typeof level === 'number') SC.setLevel(st, 'ghost', level);
      return makeCtx({ scalingModule: SC, scaling: st });
    }
    check('enemyLevel compares the enemy level with every operator',
      ev(scCtx(3), { type: 'enemyLevel', targetObject: 'ghost', operator: '>=', value: 2 }).triggered === true &&
      ev(scCtx(3), { type: 'enemyLevel', targetObject: 'ghost', operator: '>=', value: 4 }).triggered === false &&
      ev(scCtx(3), { type: 'enemyLevel', targetObject: 'ghost', operator: '==', value: 3 }).triggered === true &&
      ev(scCtx(1), { type: 'enemyLevel', targetObject: 'ghost', operator: '==', value: 1 }).triggered === true &&
      ev(scCtx(3), { type: 'enemyLevel', targetObject: 'ghost', operator: '<', value: 3 }).triggered === false);
    check('enemyLevel reports the read in its context',
      ev(scCtx(3), { type: 'enemyLevel', targetObject: 'ghost', operator: '>=', value: 2 }).context.enemyLevel === true);
    check('enemyLevel reversed fires below the threshold, and is not frozen while paused',
      ev(scCtx(1), { type: 'enemyLevel', targetObject: 'ghost', operator: '>=', value: 2, reversed: true }).triggered === true &&
      ev(scCtx(3), { type: 'enemyLevel', targetObject: 'ghost', operator: '>=', value: 2, reversed: true }).triggered === false &&
      !C.FROZEN_WHILE_PAUSED.includes('enemyLevel'));
    check('enemyLevel reads the raw record without the module (same answer)',
      (() => {
        const ctx = makeCtx({ scaling: { byId: { ghost: { level: 3, hpPerLevel: 10, dmgPerLevel: 2 } } } });
        return ev(ctx, { type: 'enemyLevel', targetObject: 'ghost', operator: '==', value: 3 }).triggered === true &&
          ev(ctx, { type: 'enemyLevel', targetObject: 'ghost', operator: '>=', value: 4 }).triggered === false;
      })());
    check('enemyLevel reads a missing state and a missing object as level 1',
      ev(makeCtx({ scalingModule: SC }), { type: 'enemyLevel', targetObject: 'ghost', operator: '==', value: 1 }).triggered === true &&
      ev(makeCtx({}), { type: 'enemyLevel', targetObject: 'ghost', operator: '==', value: 1 }).triggered === true &&
      ev(scCtx(3), { type: 'enemyLevel', targetObject: 'nobody', operator: '>=', value: 1 }).triggered === false);
  }
  // --- Boss Phase / Boss Active conditions (P4 Advanced batch 33) ---
  {
    // The fixture has two heroes, so the boss is the single-instance
    // ghost (id 4) — the same fixture rule the movement section uses.
    // Its health is set on the context so the phase reads move.
    function boCtx(health, maxHealth, phases) {
      const st = BO.createBossState();
      BO.startBoss(st, 'ghost', phases || 3, true);
      const ctx = makeCtx({ bossModule: BO, boss: st, healthModule: HP });
      const g = ctx.named('ghost')[0];
      g.health = health; g.maxHealth = maxHealth;
      return ctx;
    }
    check('bossPhase reads the phase from the boss health fraction (300/300 phase 1, 150/300 phase 2, 50/300 phase 3)',
      ev(boCtx(300, 300), { type: 'bossPhase', operator: '==', value: 1 }).triggered === true &&
      ev(boCtx(150, 300), { type: 'bossPhase', operator: '>=', value: 2 }).triggered === true &&
      ev(boCtx(150, 300), { type: 'bossPhase', operator: '==', value: 1 }).triggered === false &&
      ev(boCtx(50, 300), { type: 'bossPhase', operator: '==', value: 3 }).triggered === true &&
      ev(boCtx(50, 300), { type: 'bossPhase', operator: '<', value: 3 }).triggered === false);
    check('bossPhase reports the read in its context',
      ev(boCtx(150, 300), { type: 'bossPhase', operator: '>=', value: 2 }).context.bossPhase === true);
    check('bossPhase reversed fires below the threshold, and is not frozen while paused',
      ev(boCtx(300, 300), { type: 'bossPhase', operator: '>=', value: 2, reversed: true }).triggered === true &&
      ev(boCtx(50, 300), { type: 'bossPhase', operator: '>=', value: 2, reversed: true }).triggered === false &&
      !C.FROZEN_WHILE_PAUSED.includes('bossPhase'));
    check('bossPhase reads the raw state without the module (same answer)',
      (() => {
        const st = BO.createBossState();
        BO.startBoss(st, 'ghost', 3, true);
        const ctx = makeCtx({ boss: st });
        const g = ctx.named('ghost')[0];
        g.health = 150; g.maxHealth = 300;
        return ev(ctx, { type: 'bossPhase', operator: '==', value: 2 }).triggered === true &&
          ev(ctx, { type: 'bossPhase', operator: '==', value: 1 }).triggered === false;
      })());
    check('bossPhase reads phase 0 with no fight running, and a boss that has not spawned yet',
      ev(makeCtx({ bossModule: BO }), { type: 'bossPhase', operator: '==', value: 0 }).triggered === true &&
      ev(makeCtx({}), { type: 'bossPhase', operator: '==', value: 0 }).triggered === true &&
      (() => {
        const st = BO.createBossState();
        BO.startBoss(st, 'nobody', 3, true);
        return ev(makeCtx({ bossModule: BO, boss: st }), { type: 'bossPhase', operator: '==', value: 0 }).triggered === true;
      })());
    check('bossActive is true while a fight runs, false with no fight, and is not frozen while paused',
      ev(boCtx(300, 300), { type: 'bossActive' }).triggered === true &&
      ev(makeCtx({ bossModule: BO }), { type: 'bossActive' }).triggered === false &&
      ev(makeCtx({}), { type: 'bossActive' }).triggered === false &&
      ev(boCtx(300, 300), { type: 'bossActive', reversed: true }).triggered === false &&
      !C.FROZEN_WHILE_PAUSED.includes('bossActive'));
  }
  // --- Minimap Visible condition (P4 Advanced batch 36) ---
  {
    function mmCtx(enabled) {
      const st = MM.createMinimapState({ enabled: enabled });
      return makeCtx({ minimapModule: MM, minimap: st });
    }
    check('minimapVisible is true while the map shows, false while hidden, and is not frozen while paused',
      ev(mmCtx(true), { type: 'minimapVisible' }).triggered === true &&
      ev(mmCtx(false), { type: 'minimapVisible' }).triggered === false &&
      ev(mmCtx(true), { type: 'minimapVisible', reversed: true }).triggered === false &&
      ev(mmCtx(false), { type: 'minimapVisible', reversed: true }).triggered === true &&
      !C.FROZEN_WHILE_PAUSED.includes('minimapVisible'));
    check('minimapVisible reports the read in its context',
      ev(mmCtx(true), { type: 'minimapVisible' }).context.minimapVisible === true &&
      ev(mmCtx(false), { type: 'minimapVisible' }).context.minimapVisible === false);
    check('minimapVisible reads the raw state without the module (same answer)',
      ev(makeCtx({ minimap: { visible: true } }), { type: 'minimapVisible' }).triggered === true &&
      ev(makeCtx({ minimap: { visible: false } }), { type: 'minimapVisible' }).triggered === false &&
      ev(makeCtx({}), { type: 'minimapVisible' }).triggered === false);
  }
  // --- Is Attached condition (P4 Advanced batch 37) ---
  {
    function atCtx() {
      const st = AT.createAttachState();
      AT.attach(st, 'hat', 'hero', 10, -20);
      return makeCtx({ attachModule: AT, attachments: st });
    }
    check('isAttached is true while attached, false otherwise, and is not frozen while paused',
      ev(atCtx(), { type: 'isAttached', targetObject: 'hat' }).triggered === true &&
      ev(atCtx(), { type: 'isAttached', targetObject: 'hat', parentObject: 'hero' }).triggered === true &&
      ev(atCtx(), { type: 'isAttached', targetObject: 'hat', parentObject: 'goblin' }).triggered === false &&
      ev(atCtx(), { type: 'isAttached', targetObject: 'sword' }).triggered === false &&
      ev(atCtx(), { type: 'isAttached', targetObject: 'hat', reversed: true }).triggered === false &&
      ev(atCtx(), { type: 'isAttached', targetObject: '' }).triggered === false &&
      !C.FROZEN_WHILE_PAUSED.includes('isAttached'));
    check('isAttached reports the read in its context',
      ev(atCtx(), { type: 'isAttached', targetObject: 'hat' }).context.isAttached === true &&
      ev(atCtx(), { type: 'isAttached', targetObject: 'sword' }).context.isAttached === false);
    check('isAttached reads the raw link table without the module (same answer)',
      ev(makeCtx({ attachments: { links: { hat: { parent: 'hero', dx: 10, dy: -20 } } } }), { type: 'isAttached', targetObject: 'hat' }).triggered === true &&
      ev(makeCtx({ attachments: { links: { hat: { parent: 'hero', dx: 10, dy: -20 } } } }), { type: 'isAttached', targetObject: 'hat', parentObject: 'goblin' }).triggered === false &&
      ev(makeCtx({}), { type: 'isAttached', targetObject: 'hat' }).triggered === false);
  }
  // --- Has Tag / Tagged Count conditions (P4 Advanced batch 34) ---
  {
    // The fixture's ghost is the tagged goblin; the first hero is a
    // second goblin, the second hero a coin — the count reads 2.
    function tgCtx() {
      const ctx = makeCtx({ tagsModule: TG });
      ctx.named('ghost')[0].tags = ['goblin', 'elite'];
      ctx.named('hero')[0].tags = ['Goblin'];
      ctx.named('hero')[1].tags = ['coin'];
      return ctx;
    }
    check('hasTag is true while any live object with the name carries the tag, any case',
      ev(tgCtx(), { type: 'hasTag', targetObject: 'ghost', tag: 'GOBLIN' }).triggered === true &&
      ev(tgCtx(), { type: 'hasTag', targetObject: 'ghost', tag: 'elite' }).triggered === true &&
      ev(tgCtx(), { type: 'hasTag', targetObject: 'hero', tag: 'goblin' }).triggered === true &&
      ev(tgCtx(), { type: 'hasTag', targetObject: 'hero', tag: 'coin' }).triggered === true);
    check('hasTag reads false for a missing tag, a blank tag, and a missing object',
      ev(tgCtx(), { type: 'hasTag', targetObject: 'ghost', tag: 'coin' }).triggered === false &&
      ev(tgCtx(), { type: 'hasTag', targetObject: 'ghost', tag: '' }).triggered === false &&
      ev(tgCtx(), { type: 'hasTag', targetObject: '', tag: 'goblin' }).triggered === false &&
      ev(tgCtx(), { type: 'hasTag', targetObject: 'nobody', tag: 'goblin' }).triggered === false);
    check('hasTag reports the read in its context, reverses, and is not frozen while paused',
      ev(tgCtx(), { type: 'hasTag', targetObject: 'ghost', tag: 'goblin' }).context.hasTag === true &&
      ev(tgCtx(), { type: 'hasTag', targetObject: 'ghost', tag: 'coin', reversed: true }).triggered === true &&
      ev(tgCtx(), { type: 'hasTag', targetObject: 'ghost', tag: 'goblin', reversed: true }).triggered === false &&
      !C.FROZEN_WHILE_PAUSED.includes('hasTag'));
    check('taggedCount counts the live objects carrying the tag (2 goblins, 1 coin)',
      ev(tgCtx(), { type: 'taggedCount', tag: 'goblin', operator: '==', value: 2 }).triggered === true &&
      ev(tgCtx(), { type: 'taggedCount', tag: 'goblin', operator: '>=', value: 3 }).triggered === false &&
      ev(tgCtx(), { type: 'taggedCount', tag: 'coin', operator: '==', value: 1 }).triggered === true &&
      ev(tgCtx(), { type: 'taggedCount', tag: 'boss', operator: '==', value: 0 }).triggered === true &&
      ev(tgCtx(), { type: 'taggedCount', tag: '', operator: '==', value: 0 }).triggered === true);
    check('taggedCount reports the read in its context, reverses, and is not frozen while paused',
      ev(tgCtx(), { type: 'taggedCount', tag: 'goblin', operator: '==', value: 2 }).context.taggedCount === true &&
      ev(tgCtx(), { type: 'taggedCount', tag: 'goblin', operator: '==', value: 2, reversed: true }).triggered === false &&
      !C.FROZEN_WHILE_PAUSED.includes('taggedCount'));
    check('hasTag and taggedCount read the raw tags arrays without the module (same answers)',
      (() => {
        const ctx = makeCtx({});
        ctx.named('ghost')[0].tags = ['goblin'];
        ctx.named('hero')[0].tags = ['Goblin'];
        return ev(ctx, { type: 'hasTag', targetObject: 'ghost', tag: 'goblin' }).triggered === true &&
          ev(ctx, { type: 'hasTag', targetObject: 'ghost', tag: 'coin' }).triggered === false &&
          ev(ctx, { type: 'taggedCount', tag: 'goblin', operator: '==', value: 2 }).triggered === true &&
          ev(ctx, { type: 'taggedCount', tag: 'goblin', operator: '==', value: 1 }).triggered === false;
      })());
    check('hasTag and taggedCount stay quiet with no tags at all',
      ev(makeCtx({ tagsModule: TG }), { type: 'hasTag', targetObject: 'ghost', tag: 'goblin' }).triggered === false &&
      ev(makeCtx({ tagsModule: TG }), { type: 'taggedCount', tag: 'goblin', operator: '==', value: 0 }).triggered === true);
  }
  // --- Pick by tag conditions (P4 Advanced batch 35) ---
  {
    // The same fixture as the tag section: the ghost is a goblin at
    // (300, 20), the first hero is a goblin at (10, 20), the second
    // hero is a coin — so near the hero the nearest goblin is the
    // first hero (id 1, center 30, 40) and the farthest is the ghost
    // (id 4, center 320, 40).
    function pkCtx() {
      const ctx = makeCtx({ tagsModule: TG });
      ctx.named('ghost')[0].tags = ['goblin', 'elite'];
      ctx.named('hero')[0].tags = ['Goblin'];
      ctx.named('hero')[1].tags = ['coin'];
      ctx.pick = P;
      ctx.pickHooks = function () {
        return {
          liveObjects: function (name) { return ctx.named(name); },
          liveObjectsByTag: function (tag) { return TG.objectsWithTag(ctx.allObjects(), tag); },
          num: function (raw) { const n = Number(raw); return { ok: Number.isFinite(n), value: n }; },
          warn: function () {}
        };
      };
      return ctx;
    }
    check('pickNearestTagged picks the nearest tagged object to the Near object',
      (() => {
        const r = ev(pkCtx(), { type: 'pickNearestTagged', tag: 'goblin', nearObject: 'hero' });
        return r.triggered === true && r.context.obj1 && r.context.obj1.id === 1;
      })());
    check('pickFarthestTagged picks the furthest tagged object from the Near object',
      (() => {
        const r = ev(pkCtx(), { type: 'pickFarthestTagged', tag: 'goblin', nearObject: 'hero' });
        return r.triggered === true && r.context.obj1 && r.context.obj1.id === 4;
      })());
    check('pickNearestTagged falls back to the X/Y point when Near is blank',
      (() => {
        const r = ev(pkCtx(), { type: 'pickNearestTagged', tag: 'goblin', nearObject: '', pointX: 320, pointY: 40 });
        return r.triggered === true && r.context.obj1 && r.context.obj1.id === 4;
      })());
    check('pickRandomTagged picks one of the tagged objects',
      (() => {
        const r = ev(pkCtx(), { type: 'pickRandomTagged', tag: 'goblin' });
        return r.triggered === true && r.context.obj1 &&
          (r.context.obj1.id === 1 || r.context.obj1.id === 4);
      })());
    check('tag picks stay quiet on a blank tag, a tag nobody carries, and a missing Near object',
      ev(pkCtx(), { type: 'pickNearestTagged', tag: '', nearObject: 'hero' }).triggered === false &&
      ev(pkCtx(), { type: 'pickNearestTagged', tag: 'boss', nearObject: 'hero' }).triggered === false &&
      ev(pkCtx(), { type: 'pickFarthestTagged', tag: 'goblin', nearObject: 'nobody' }).triggered === false &&
      ev(pkCtx(), { type: 'pickRandomTagged', tag: '' }).triggered === false);
    check('tag picks reverse and are not frozen while paused',
      ev(pkCtx(), { type: 'pickNearestTagged', tag: 'boss', nearObject: 'hero', reversed: true }).triggered === true &&
      ev(pkCtx(), { type: 'pickNearestTagged', tag: 'goblin', nearObject: 'hero', reversed: true }).triggered === false &&
      !C.FROZEN_WHILE_PAUSED.includes('pickNearestTagged') &&
      !C.FROZEN_WHILE_PAUSED.includes('pickFarthestTagged') &&
      !C.FROZEN_WHILE_PAUSED.includes('pickRandomTagged'));
  }
  // --- Scoped variable conditions (P5 core-engine track, item P5-1 slice a) ---
  {
    function vvCtx(setup) {
      const st = VV.createVariablesState();
      if (setup) setup(st);
      return makeCtx({ varScopesModule: VV, varScopes: st, sceneId: 1 });
    }
    check('scopedVariableExists is true only while the variable exists in the picked scope',
      ev(vvCtx(st => VV.set(st, 'global', 'score', 10)), { type: 'scopedVariableExists', scope: 'global', varName: 'score' }).triggered === true &&
      ev(vvCtx(st => VV.set(st, 'global', 'score', 10)), { type: 'scopedVariableExists', scope: 'scene', varName: 'score' }).triggered === false &&
      ev(vvCtx(), { type: 'scopedVariableExists', scope: 'global', varName: 'score' }).triggered === false &&
      ev(vvCtx(st => VV.set(st, 'scene', 'coins', 5, { sceneId: 1 })), { type: 'scopedVariableExists', scope: 'scene', varName: 'coins' }).triggered === true &&
      ev(vvCtx(st => VV.set(st, 'scene', 'coins', 5, { sceneId: 2 })), { type: 'scopedVariableExists', scope: 'scene', varName: 'coins' }).triggered === false &&
      ev(vvCtx(st => VV.set(st, 'object', 'hp', 30, { objectName: 'goblin' })), { type: 'scopedVariableExists', scope: 'object', targetObject: 'goblin', varName: 'hp' }).triggered === true &&
      ev(vvCtx(st => VV.set(st, 'object', 'hp', 30, { objectName: 'goblin' })), { type: 'scopedVariableExists', scope: 'object', targetObject: 'hero', varName: 'hp' }).triggered === false);
    check('scopedVariableExists reports the read in its context, reverses, and is not frozen while paused',
      ev(vvCtx(st => VV.set(st, 'global', 'score', 10)), { type: 'scopedVariableExists', scope: 'global', varName: 'score' }).context.scopedVariableExists === true &&
      ev(vvCtx(), { type: 'scopedVariableExists', scope: 'global', varName: 'score', reversed: true }).triggered === true &&
      ev(vvCtx(st => VV.set(st, 'global', 'score', 10)), { type: 'scopedVariableExists', scope: 'global', varName: 'score', reversed: true }).triggered === false &&
      !C.FROZEN_WHILE_PAUSED.includes('scopedVariableExists'));
    check('scopedVariableExists reads the raw record without the module (same answer)',
      (() => {
        const st = VV.createVariablesState();
        VV.set(st, 'global', 'score', 10);
        const ctx = makeCtx({ varScopes: st, sceneId: 1 });
        return ev(ctx, { type: 'scopedVariableExists', scope: 'global', varName: 'score' }).triggered === true &&
          ev(ctx, { type: 'scopedVariableExists', scope: 'global', varName: 'nope' }).triggered === false;
      })());
    check('scopedVariableCheck compares a number with every operator',
      ev(vvCtx(st => VV.set(st, 'global', 'score', 10)), { type: 'scopedVariableCheck', scope: 'global', varName: 'score', operator: '>=', compareValue: 10 }).triggered === true &&
      ev(vvCtx(st => VV.set(st, 'global', 'score', 10)), { type: 'scopedVariableCheck', scope: 'global', varName: 'score', operator: '>', compareValue: 10 }).triggered === false &&
      ev(vvCtx(st => VV.set(st, 'global', 'score', 10)), { type: 'scopedVariableCheck', scope: 'global', varName: 'score', operator: '==', compareValue: 10 }).triggered === true &&
      ev(vvCtx(st => VV.set(st, 'global', 'score', 10)), { type: 'scopedVariableCheck', scope: 'global', varName: 'score', operator: '!=', compareValue: 10 }).triggered === false &&
      ev(vvCtx(st => VV.set(st, 'global', 'score', 10)), { type: 'scopedVariableCheck', scope: 'global', varName: 'score', operator: '<', compareValue: 11 }).triggered === true &&
      ev(vvCtx(st => VV.set(st, 'global', 'score', 10)), { type: 'scopedVariableCheck', scope: 'global', varName: 'score', operator: '<=', compareValue: 9 }).triggered === false);
    check('scopedVariableCheck reads a missing variable as 0',
      ev(vvCtx(), { type: 'scopedVariableCheck', scope: 'global', varName: 'missing', operator: '==', compareValue: 0 }).triggered === true &&
      ev(vvCtx(), { type: 'scopedVariableCheck', scope: 'global', varName: 'missing', operator: '>=', compareValue: 1 }).triggered === false);
    check('scopedVariableCheck compares text and bool as text, and never matches a list with ==',
      ev(vvCtx(st => VV.set(st, 'global', 'title', 'hero')), { type: 'scopedVariableCheck', scope: 'global', varName: 'title', operator: '==', compareValue: 'hero' }).triggered === true &&
      ev(vvCtx(st => VV.set(st, 'global', 'title', 'hero')), { type: 'scopedVariableCheck', scope: 'global', varName: 'title', operator: '!=', compareValue: 'hero' }).triggered === false &&
      ev(vvCtx(st => VV.set(st, 'global', 'title', 'hero')), { type: 'scopedVariableCheck', scope: 'global', varName: 'title', operator: '>', compareValue: 'hero' }).triggered === false &&
      ev(vvCtx(st => VV.set(st, 'global', 'won', true)), { type: 'scopedVariableCheck', scope: 'global', varName: 'won', operator: '==', compareValue: 'true' }).triggered === true &&
      ev(vvCtx(st => VV.set(st, 'global', 'inv', [1, 2])), { type: 'scopedVariableCheck', scope: 'global', varName: 'inv', operator: '==', compareValue: '[1,2]' }).triggered === false);
    check('scopedVariableCheck reads scene and object scopes, reports the read, reverses, and is not frozen while paused',
      ev(vvCtx(st => VV.set(st, 'scene', 'coins', 5, { sceneId: 1 })), { type: 'scopedVariableCheck', scope: 'scene', varName: 'coins', operator: '>=', compareValue: 5 }).triggered === true &&
      ev(vvCtx(st => VV.set(st, 'scene', 'coins', 5, { sceneId: 2 })), { type: 'scopedVariableCheck', scope: 'scene', varName: 'coins', operator: '>=', compareValue: 1 }).triggered === false &&
      ev(vvCtx(st => VV.set(st, 'object', 'hp', 30, { objectName: 'goblin' })), { type: 'scopedVariableCheck', scope: 'object', targetObject: 'goblin', varName: 'hp', operator: '==', compareValue: 30 }).triggered === true &&
      ev(vvCtx(st => VV.set(st, 'global', 'score', 10)), { type: 'scopedVariableCheck', scope: 'global', varName: 'score', operator: '>=', compareValue: 5 }).context.scopedVariableCheck === true &&
      ev(vvCtx(st => VV.set(st, 'global', 'score', 10)), { type: 'scopedVariableCheck', scope: 'global', varName: 'score', operator: '>=', compareValue: 5, reversed: true }).triggered === false &&
      !C.FROZEN_WHILE_PAUSED.includes('scopedVariableCheck'));
    check('scopedVariableCheck reads the raw record without the module (same answer)',
      (() => {
        const st = VV.createVariablesState();
        VV.set(st, 'object', 'hp', 30, { objectName: 'goblin' });
        const ctx = makeCtx({ varScopes: st, sceneId: 1 });
        return ev(ctx, { type: 'scopedVariableCheck', scope: 'object', targetObject: 'goblin', varName: 'hp', operator: '==', compareValue: 30 }).triggered === true &&
          ev(ctx, { type: 'scopedVariableCheck', scope: 'object', targetObject: 'goblin', varName: 'hp', operator: '==', compareValue: 31 }).triggered === false;
      })());
    check('scoped-variable conditions read a missing state as no variable (exists false, check against 0)',
      ev(makeCtx({ varScopesModule: VV }), { type: 'scopedVariableExists', scope: 'global', varName: 'score' }).triggered === false &&
      ev(makeCtx({ varScopesModule: VV }), { type: 'scopedVariableCheck', scope: 'global', varName: 'score', operator: '==', compareValue: 0 }).triggered === true &&
      ev(makeCtx({}), { type: 'scopedVariableExists', scope: 'global', varName: 'score' }).triggered === false);
  }
  // --- Movement conditions (P4 Advanced batch 26) ---
  {
    // The fixture has two heroes, and the condition finds ANY matching
    // object — so the subject is the single-instance ghost (id 4),
    // never 'hero', or the spare hero's default 1 jump would answer
    // every '== 1' check by itself.
    function mvCtx(used, maxJumps) {
      const st = MV.createMovementState();
      const ctx = makeCtx({ movementModule: MV, movement: st });
      const h = ctx.allObjects().find(o => o.id === 4);
      if (maxJumps != null) h.movement = { maxJumps: maxJumps, coyoteSeconds: 0, bufferSeconds: 0 };
      if (used) MV.recordOf(st, h, true).jumpsUsed = used;
      ctx._st = st;
      ctx._hero = h;
      return ctx;
    }
    check('jumpsLeft compares the count with every operator',
      ev(mvCtx(0, 2), { type: 'jumpsLeft', targetObject: 'ghost', operator: '>=', value: 2 }).triggered === true &&
      ev(mvCtx(0, 2), { type: 'jumpsLeft', targetObject: 'ghost', operator: '==', value: 1 }).triggered === false &&
      ev(mvCtx(1, 2), { type: 'jumpsLeft', targetObject: 'ghost', operator: '==', value: 1 }).triggered === true &&
      ev(mvCtx(1, 2), { type: 'jumpsLeft', targetObject: 'ghost', operator: '<', value: 1 }).triggered === false &&
      ev(mvCtx(2, 2), { type: 'jumpsLeft', targetObject: 'ghost', operator: '==', value: 0 }).triggered === true);
    check('jumpsLeft reports the check in its context',
      ev(mvCtx(1, 2), { type: 'jumpsLeft', targetObject: 'ghost', operator: '>=', value: 1 }).context.jumpsLeft === true);
    check('jumpsLeft reversed fires when the jumps run out, and is not frozen while paused',
      ev(mvCtx(2, 2), { type: 'jumpsLeft', targetObject: 'ghost', operator: '>=', value: 1, reversed: true }).triggered === true &&
      ev(mvCtx(0, 2), { type: 'jumpsLeft', targetObject: 'ghost', operator: '>=', value: 1, reversed: true }).triggered === false &&
      !C.FROZEN_WHILE_PAUSED.includes('jumpsLeft'));
    check('isDashing fires mid-dash and stays quiet before and after',
      (() => {
        const c1 = mvCtx(0, 2);
        const before = ev(c1, { type: 'isDashing', targetObject: 'ghost' }).triggered;
        MV.startDash(c1._st, c1._hero, 1, 0, 400, 0.15, 0.5, 1.0);
        const during = ev(c1, { type: 'isDashing', targetObject: 'ghost' }).triggered;
        const c2 = mvCtx(0, 2);
        MV.startDash(c2._st, c2._hero, 1, 0, 400, 0.15, 0.5, 0.5);
        const after = ev(c2, { type: 'isDashing', targetObject: 'ghost' }).triggered;
        return before === false && during === true && after === false;
      })());
    check('isDashing reports the state in its context',
      (() => {
        const c = mvCtx(0, 2);
        MV.startDash(c._st, c._hero, 1, 0, 400, 0.15, 0.5, 1.0);
        return ev(c, { type: 'isDashing', targetObject: 'ghost' }).context.isDashing === true;
      })());
    check('isDashing reversed fires while the object is not dashing, and is not frozen while paused',
      (() => {
        const c = mvCtx(0, 2);
        const idle = ev(c, { type: 'isDashing', targetObject: 'ghost', reversed: true }).triggered;
        MV.startDash(c._st, c._hero, 1, 0, 400, 0.15, 0.5, 1.0);
        const mid = ev(c, { type: 'isDashing', targetObject: 'ghost', reversed: true }).triggered;
        return idle === true && mid === false && !C.FROZEN_WHILE_PAUSED.includes('isDashing');
      })());
    check('movement conditions read the raw fields without the module (same answer)',
      (() => {
        const st = MV.createMovementState();
        const ctx = makeCtx({ movement: st });
        const h = ctx.allObjects().find(o => o.id === 4);
        h.movement = { maxJumps: 2, coyoteSeconds: 0, bufferSeconds: 0 };
        MV.recordOf(st, h, true).dashUntil = 1.15;
        return ev(ctx, { type: 'jumpsLeft', targetObject: 'ghost', operator: '>=', value: 2 }).triggered === true &&
          ev(ctx, { type: 'isDashing', targetObject: 'ghost' }).triggered === true;
      })());
    check('movement conditions stay quiet on a missing object',
      ev(mvCtx(0, 2), { type: 'jumpsLeft', targetObject: 'nobody', operator: '>=', value: 1 }).triggered === false &&
      ev(mvCtx(0, 2), { type: 'isDashing', targetObject: 'nobody' }).triggered === false &&
      ev(mvCtx(0, 2), { type: 'wallSliding', targetObject: 'nobody' }).triggered === false);
    check('jumpsLeft reads a missing record as the full count',
      ev(mvCtx(0, 1), { type: 'jumpsLeft', targetObject: 'ghost', operator: '>=', value: 1 }).triggered === true);
    // P4 Advanced batch 28 (wall slide & wall jump): the ghost falls
    // beside the wall (id 2 at x 100) — right edge 100 meets the
    // wall's left edge, bottom 40 clears the floor top 60, and
    // ArrowRight is already held in the ctx keys.
    check('wallSliding fires while the ghost slides down the wall',
      (() => {
        function wsCtx(slide) {
          const ctx = mvCtx(0, 2);
          const g = ctx._hero;
          g.posX = 60; g.posY = 0; g.velX = 0; g.velY = 5;
          g.movement = { maxJumps: 2, coyoteSeconds: 0, bufferSeconds: 0, wallSlideMaxFall: slide, wallJumpSpeed: 12, wallJumpPush: 8 };
          return ctx;
        }
        if (ev(wsCtx(60), { type: 'wallSliding', targetObject: 'ghost' }).triggered !== true) return false;
        if (ev(wsCtx(0), { type: 'wallSliding', targetObject: 'ghost' }).triggered !== false) return false;
        // Rising, not falling: no slide.
        const rising = wsCtx(60);
        rising._hero.velY = -5;
        if (ev(rising, { type: 'wallSliding', targetObject: 'ghost' }).triggered !== false) return false;
        // No press toward the wall: no slide.
        const noPress = wsCtx(60);
        noPress.keys = new Set();
        if (ev(noPress, { type: 'wallSliding', targetObject: 'ghost' }).triggered !== false) return false;
        // On the floor next to the wall: no slide.
        const grounded = wsCtx(60);
        grounded._hero.posY = 20; // bottom 60 meets the floor top 60
        grounded._hero.velY = 5;
        if (ev(grounded, { type: 'wallSliding', targetObject: 'ghost' }).triggered !== false) return false;
        return true;
      })());
    check('wallSliding reports the check in its context, reverses, and is not frozen while paused',
      (() => {
        const ctx = mvCtx(0, 2);
        const g = ctx._hero;
        g.posX = 60; g.posY = 0; g.velY = 5;
        g.movement = { maxJumps: 2, wallSlideMaxFall: 60 };
        if (ev(ctx, { type: 'wallSliding', targetObject: 'ghost' }).context.wallSliding !== true) return false;
        if (ev(ctx, { type: 'wallSliding', targetObject: 'ghost', reversed: true }).triggered !== false) return false;
        return !C.FROZEN_WHILE_PAUSED.includes('wallSliding');
      })());
    check('wallSliding reads the raw fields without the module (same answer)',
      (() => {
        const ctx = makeCtx({});
        const g = ctx.allObjects().find(o => o.id === 4);
        g.posX = 60; g.posY = 0; g.velY = 5;
        g.movement = { maxJumps: 2, wallSlideMaxFall: 60 };
        if (ev(ctx, { type: 'wallSliding', targetObject: 'ghost' }).triggered !== true) return false;
        g.movement.wallSlideMaxFall = 0;
        return ev(ctx, { type: 'wallSliding', targetObject: 'ghost' }).triggered === false;
      })());
  }
  // --- Platform conditions (P4 Advanced batch 27) ---
  {
    // The ghost (id 4) stands on the fixture floor (id 6): move it
    // over the floor so its bottom (60) meets the floor top (60).
    // The floor is a moving platform between (0, 60) and (200, 60).
    function pfCtx(oneWay, crumbleSeconds) {
      const st = PL.createPlatformState();
      const ctx = makeCtx({ platformModule: PL, platform: st });
      const g = ctx.allObjects().find(o => o.id === 4);
      g.posX = 10; g.posY = 20; g.velX = 0; g.velY = 0;
      const f = ctx.allObjects().find(o => o.id === 6);
      f.collision = { enabled: true };
      f.platform = {
        enabled: true,
        points: [{ x: 0, y: 60 }, { x: 200, y: 60 }],
        speed: 60, mode: 'pingpong',
        oneWay: !!oneWay, crumbleSeconds: crumbleSeconds || 0
      };
      ctx._st = st;
      ctx._ghost = g;
      ctx._floor = f;
      return ctx;
    }
    function pfHooks(ctx) {
      return {
        objects: ctx.allObjects(),
        hitboxOf: hitboxOf,
        isCollisionObjectOf: ctx.isCollisionObject,
        isOneWay: (o) => !!((o.platform && o.platform.oneWay === true) ||
          (o.collision && o.collision.oneWay === true)),
        hide: (o) => ctx.hidden.add(o.id)
      };
    }
    check('standingOnPlatform fires while the object rides the moving platform',
      ev(pfCtx(false), { type: 'standingOnPlatform', targetObject: 'ghost' }).triggered === true);
    check('standingOnPlatform reports the state in its context',
      ev(pfCtx(false), { type: 'standingOnPlatform', targetObject: 'ghost' }).context.standingOnPlatform === true);
    check('standingOnPlatform stays quiet in the air and off the platform',
      (() => {
        const c1 = pfCtx(false);
        c1._ghost.posY = 0;
        const inAir = ev(c1, { type: 'standingOnPlatform', targetObject: 'ghost' }).triggered;
        const c2 = pfCtx(false);
        c2._ghost.posX = 500;
        const offFloor = ev(c2, { type: 'standingOnPlatform', targetObject: 'ghost' }).triggered;
        return inAir === false && offFloor === false;
      })());
    check('standingOnPlatform reversed fires while the object is not riding, and is not frozen while paused',
      (() => {
        const c = pfCtx(false);
        const on = ev(c, { type: 'standingOnPlatform', targetObject: 'ghost', reversed: true }).triggered;
        c._ghost.posY = 0;
        const off = ev(c, { type: 'standingOnPlatform', targetObject: 'ghost', reversed: true }).triggered;
        return on === false && off === true && !C.FROZEN_WHILE_PAUSED.includes('standingOnPlatform');
      })());
    check('standingOnPlatform stays quiet on a parked platform',
      (() => {
        const c = pfCtx(false);
        c._floor.platform.speed = 0;
        return ev(c, { type: 'standingOnPlatform', targetObject: 'ghost' }).triggered === false;
      })());
    check('standingOnOneWay fires on a one-way platform and stays quiet on a solid one',
      ev(pfCtx(true), { type: 'standingOnOneWay', targetObject: 'ghost' }).triggered === true &&
      ev(pfCtx(false), { type: 'standingOnOneWay', targetObject: 'ghost' }).triggered === false);
    check('standingOnOneWay fires on a plain one-way floor (no platform config)',
      (() => {
        const c = pfCtx(false);
        delete c._floor.platform;
        c._floor.collision = { oneWay: true };
        return ev(c, { type: 'standingOnOneWay', targetObject: 'ghost' }).triggered === true;
      })());
    check('standingOnOneWay never fires while the object rises through the floor',
      (() => {
        const c = pfCtx(true);
        c._ghost.velY = -12;
        return ev(c, { type: 'standingOnOneWay', targetObject: 'ghost' }).triggered === false;
      })());
    check('standingOnOneWay reversed fires while the object is not on a one-way floor, and is not frozen while paused',
      (() => {
        const c = pfCtx(true);
        const on = ev(c, { type: 'standingOnOneWay', targetObject: 'ghost', reversed: true }).triggered;
        c._ghost.posY = 0;
        const off = ev(c, { type: 'standingOnOneWay', targetObject: 'ghost', reversed: true }).triggered;
        return on === false && off === true && !C.FROZEN_WHILE_PAUSED.includes('standingOnOneWay');
      })());
    check('platform conditions read the raw config without the module (same answer)',
      (() => {
        const st = PL.createPlatformState();
        const ctx = makeCtx({ platform: st });
        const g = ctx.allObjects().find(o => o.id === 4);
        g.posX = 10; g.posY = 20; g.velX = 0; g.velY = 0;
        const f = ctx.allObjects().find(o => o.id === 6);
        f.platform = {
          enabled: true,
          points: [{ x: 0, y: 60 }, { x: 200, y: 60 }],
          speed: 60, mode: 'pingpong', oneWay: true, crumbleSeconds: 0
        };
        return ev(ctx, { type: 'standingOnPlatform', targetObject: 'ghost' }).triggered === true &&
          ev(ctx, { type: 'standingOnOneWay', targetObject: 'ghost' }).triggered === true;
      })());
    check('platform conditions stay quiet on a missing object',
      ev(pfCtx(false), { type: 'standingOnPlatform', targetObject: 'nobody' }).triggered === false &&
      ev(pfCtx(false), { type: 'standingOnOneWay', targetObject: 'nobody' }).triggered === false);
    check('standingOnPlatform reads false once the platform crumbles away',
      (() => {
        const c = pfCtx(false, 1);
        const before = ev(c, { type: 'standingOnPlatform', targetObject: 'ghost' }).triggered;
        PL.updatePlatforms(c._st, c.allObjects(), 0, 1 / 60, pfHooks(c));
        PL.updatePlatforms(c._st, c.allObjects(), 2, 1 / 60, pfHooks(c));
        const after = ev(c, { type: 'standingOnPlatform', targetObject: 'ghost' }).triggered;
        return before === true && after === false && c._floor.collision.enabled === false;
      })());
  }
  // --- Combat conditions (P4 Advanced batch 29) ---
  {
    // The ghost (id 4) is the single-instance subject, never 'hero',
    // so the spare hero cannot answer a check by itself.
    function cbCtx() {
      const savedNow = nowValue;
      nowValue = 1000;
      const st = CB.createCombatState();
      const ctx = makeCtx({ combatModule: CB, combat: st });
      const g = ctx.allObjects().find(o => o.id === 4);
      ctx._st = st;
      ctx._ghost = g;
      ctx._hooks = {
        objects: ctx.allObjects(),
        hitbox: (o) => ({ x: o.posX, y: o.posY, w: o.width, h: o.height }),
        isCollision: (o) => o.kind !== 'tilemap',
        damage: () => {}
      };
      ctx._restoreNow = () => { nowValue = savedNow; };
      return ctx;
    }
    check('attackReady fires for an object that never attacked, and is not frozen while paused',
      (() => {
        const ctx = cbCtx();
        const r = ev(ctx, { type: 'attackReady', targetObject: 'ghost' }).triggered === true &&
          ev(ctx, { type: 'attackReady', targetObject: 'ghost', attackKind: 'shot' }).triggered === true &&
          ev(ctx, { type: 'attackReady', targetObject: 'ghost' }).context.attackReady === true &&
          !C.FROZEN_WHILE_PAUSED.includes('attackReady');
        ctx._restoreNow();
        return r;
      })());
    check('attackReady stays quiet during the cooldown and fires again after it, per kind',
      (() => {
        const ctx = cbCtx();
        const g = ctx._ghost;
        CB.meleeAttack(ctx._st, g, { damage: 10, range: 60, direction: 'right', cooldown: 0.5 }, ctx._hooks, 1);
        if (ev(ctx, { type: 'attackReady', targetObject: 'ghost' }).triggered !== false) return false;
        if (ev(ctx, { type: 'attackReady', targetObject: 'ghost', attackKind: 'shot' }).triggered !== true) return false;
        nowValue = 1200; // 0.2s in: still cooling down
        if (ev(ctx, { type: 'attackReady', targetObject: 'ghost' }).triggered !== false) return false;
        nowValue = 1600; // 0.6s in: cooled down
        if (ev(ctx, { type: 'attackReady', targetObject: 'ghost' }).triggered !== true) return false;
        ctx._restoreNow();
        return true;
      })());
    check('attackReady reversed fires while the object is cooling down',
      (() => {
        const ctx = cbCtx();
        CB.meleeAttack(ctx._st, ctx._ghost, { damage: 10, range: 60, direction: 'right', cooldown: 0.5 }, ctx._hooks, 1);
        const cooling = ev(ctx, { type: 'attackReady', targetObject: 'ghost', reversed: true }).triggered;
        nowValue = 1600;
        const ready = ev(ctx, { type: 'attackReady', targetObject: 'ghost', reversed: true }).triggered;
        ctx._restoreNow();
        return cooling === true && ready === false;
      })());
    check('attackReady reads the raw cooldown record without the module (same answer)',
      (() => {
        const ctx = makeCtx({ combat: { cooldowns: { 4: { meleeAt: 1, shotAt: null } } } });
        const savedNow = nowValue;
        nowValue = 1000;
        if (ev(ctx, { type: 'attackReady', targetObject: 'ghost' }).triggered !== false) return false;
        if (ev(ctx, { type: 'attackReady', targetObject: 'ghost', attackKind: 'shot' }).triggered !== true) return false;
        nowValue = 1600;
        if (ev(ctx, { type: 'attackReady', targetObject: 'ghost' }).triggered !== true) return false;
        nowValue = savedNow;
        return true;
      })());
    check('attackReady still honors the legacy kind field (direct calls that pass kind)',
      (() => {
        const ctx = cbCtx();
        CB.meleeAttack(ctx._st, ctx._ghost, { damage: 10, range: 60, direction: 'right', cooldown: 0.5 }, ctx._hooks, 1);
        const r = ev(ctx, { type: 'attackReady', targetObject: 'ghost', kind: 'shot' }).triggered === true &&
          ev(ctx, { type: 'attackReady', targetObject: 'ghost', kind: 'melee' }).triggered === false;
        ctx._restoreNow();
        return r;
      })());
    check('attackReady reads a missing record as ready, and stays quiet on a missing object',
      ev(cbCtx(), { type: 'attackReady', targetObject: 'ghost' }).triggered === true &&
      ev(cbCtx(), { type: 'attackReady', targetObject: 'nobody' }).triggered === false);
  }
  // --- cutscene conditions (P4 Advanced batch 11) ---
  {
    const cut = { active: { id: 'cts_intro', name: 'Intro' }, stepIndex: 1, stepElapsed: 0.5, stepStarted: true, stepFrom: null, lastFinished: null };
    const ctx = makeCtx({ cutscene: cut });
    check('cutscenePlaying fires for the running cutscene and stays quiet otherwise',
      ev(ctx, { type: 'cutscenePlaying', cutscene: 'Intro' }).triggered === true &&
      ev(ctx, { type: 'cutscenePlaying', cutscene: 'Ending' }).triggered === false);
    check('cutscenePlaying reads true for a blank name (any cutscene)',
      ev(ctx, { type: 'cutscenePlaying', cutscene: '' }).triggered === true);
    check('cutscenePlaying reads false when nothing is playing',
      ev(makeCtx({ cutscene: { active: null, lastFinished: null } }), { type: 'cutscenePlaying', cutscene: 'Intro' }).triggered === false &&
      ev(makeCtx({ cutscene: { active: null, lastFinished: null } }), { type: 'cutscenePlaying', cutscene: '' }).triggered === false);
    check('cutscenePlaying reversed fires when the named cutscene is not playing',
      ev(ctx, { type: 'cutscenePlaying', cutscene: 'Ending', reversed: true }).triggered === true &&
      ev(ctx, { type: 'cutscenePlaying', cutscene: 'Intro', reversed: true }).triggered === false);
    check('cutscenePlaying reports the cutscene name in its context',
      ev(ctx, { type: 'cutscenePlaying', cutscene: 'Intro' }).context.cutscenePlaying === true &&
      ev(ctx, { type: 'cutscenePlaying', cutscene: 'Intro' }).context.cutscene === 'Intro');
    const done = { active: null, stepIndex: 0, stepElapsed: 0, stepStarted: false, stepFrom: null, lastFinished: 'Intro' };
    const ctx2 = makeCtx({ cutscene: done });
    check('cutsceneFinished fires for the most recently finished cutscene',
      ev(ctx2, { type: 'cutsceneFinished', cutscene: 'Intro' }).triggered === true &&
      ev(ctx2, { type: 'cutsceneFinished', cutscene: 'Ending' }).triggered === false);
    check('cutsceneFinished reads true for a blank name (any cutscene finished)',
      ev(ctx2, { type: 'cutsceneFinished', cutscene: '' }).triggered === true);
    check('cutsceneFinished reads false while a cutscene is still playing',
      ev(ctx, { type: 'cutsceneFinished', cutscene: 'Intro' }).triggered === false &&
      ev(ctx, { type: 'cutsceneFinished', cutscene: '' }).triggered === false);
    check('cutsceneFinished reversed fires when the named cutscene has not finished',
      ev(ctx2, { type: 'cutsceneFinished', cutscene: 'Ending', reversed: true }).triggered === true &&
      ev(ctx2, { type: 'cutsceneFinished', cutscene: 'Intro', reversed: true }).triggered === false);
    check('cutsceneFinished reports the cutscene name in its context',
      ev(ctx2, { type: 'cutsceneFinished', cutscene: 'Intro' }).context.cutsceneFinished === true &&
      ev(ctx2, { type: 'cutsceneFinished', cutscene: 'Intro' }).context.cutscene === 'Intro');
    check('cutscene conditions read false with no cutscene runtime at all',
      ev(makeCtx(), { type: 'cutscenePlaying', cutscene: 'Intro' }).triggered === false &&
      ev(makeCtx(), { type: 'cutsceneFinished', cutscene: 'Intro' }).triggered === false);
    check('cutscene conditions are not frozen while paused (they are state reads)',
      !C.FROZEN_WHILE_PAUSED.includes('cutscenePlaying') &&
      !C.FROZEN_WHILE_PAUSED.includes('cutsceneFinished'));
  }
  check('saveSlotExists reads the slot store',
    ev(makeCtx({ save: { safeStorage: () => ({}), slotExists: (s, n) => n === 'slot1' } }),
      { type: 'saveSlotExists', slotName: 'slot1' }).triggered === true);
  check('saveSlotExists fails for a missing slot and without the module',
    ev(makeCtx({ save: { safeStorage: () => ({}), slotExists: () => false } }),
      { type: 'saveSlotExists', slotName: 'slot1' }).triggered === false &&
    ev(makeCtx(), { type: 'saveSlotExists', slotName: 'slot1' }).triggered === false);
  check('gamePaused reads the pause state',
    ev(makeCtx({ isPaused: () => true }), { type: 'gamePaused' }).triggered === true);
  check('profilerVisible reads the overlay state',
    ev(makeCtx({ profilerVisible: () => true }), { type: 'profilerVisible' }).triggered === true);
  check('scriptCheck evaluates the user script',
    ev(makeCtx({ scriptApi: { evalCondition: (h, code) => code === 'return true;' } }),
      { type: 'scriptCheck', code: 'return true;' }).triggered === true);
  check('scriptCheck reads false without the module',
    ev(makeCtx(), { type: 'scriptCheck', code: 'return true;' }).triggered === false);
  check('musicPlaying fires while a music voice is held and unpaused',
    ev(makeCtx({ musicCount: 1 }), { type: 'musicPlaying' }).triggered === true);
  check('musicPlaying stays quiet while paused or voiceless',
    ev(makeCtx({ musicCount: 1, musicPaused: true }), { type: 'musicPlaying' }).triggered === false &&
    ev(makeCtx({ musicCount: 0 }), { type: 'musicPlaying' }).triggered === false);
}

// --- tiles ---
{
  const tilesCtx = makeCtx({
    tiles: { isSolidAtPixel: (tm, x, y) => tm && tm.name === 'map' && x >= 0 && x < 100 && y >= 0 && y < 100 }
  });
  check('tileSolidAt fires inside the solid region',
    ev(tilesCtx, { type: 'tileSolidAt', targetObject: 'map', x: 50, y: 50 }).triggered === true);
  check('tileSolidAt stays quiet outside the solid region',
    ev(tilesCtx, { type: 'tileSolidAt', targetObject: 'map', x: 500, y: 50 }).triggered === false);
  check('standingOnTile fires when the hero stands over solid tiles',
    ev(tilesCtx, { type: 'standingOnTile', targetObject: 'hero', tilemapName: 'map' }).triggered === true);
  check('tile conditions read false without the tiles module',
    ev(makeCtx(), { type: 'tileSolidAt', targetObject: 'map', x: 50, y: 50 }).triggered === false);
}

// --- camera / cursor / touch / gamepad ---
{
  const ctx = makeCtx({ camera: { x: 10, y: 20, zoom: 1 } });
  check('cameraPosition compares the camera axes',
    ev(ctx, { type: 'cameraPosition', property: 'cameraX', operator: '>=', value: 10 }).triggered === true);
  check('cameraPosition compares the zoom',
    ev(ctx, { type: 'cameraPosition', property: 'zoom', operator: '>=', value: 2 }).triggered === false);
  check('cursorPosition compares the mouse position',
    ev(ctx, { type: 'cursorPosition', property: 'cursorX', operator: '>=', value: 15 }).triggered === true);
  check('anyKeyPressed fires while a key is held',
    ev(ctx, { type: 'anyKeyPressed' }).triggered === true);
  check('touchActive stays quiet with no touches',
    ev(ctx, { type: 'touchActive' }).triggered === false);
  check('touchCount compares the active touch count',
    ev(makeCtx({ touchCount: 2 }), { type: 'touchCount', operator: '>=', value: 2 }).triggered === true);
  check('gamepadConnected reads the gamepad state',
    ev(makeCtx({ gamepadConnected: true }), { type: 'gamepadConnected' }).triggered === true);
  check('gamepadButton reads the held button set',
    ev(makeCtx({ gamepadButtons: new Set([3]) }), { type: 'gamepadButton', button: 3 }).triggered === true);
  check('gamepadButton clamps the button index',
    ev(makeCtx({ gamepadButtons: new Set([15]) }), { type: 'gamepadButton', button: 99 }).triggered === true);
  check('gamepadStick compares the stick axis',
    ev(makeCtx({ gamepadAxes: { lx: 0.5, ly: 0, rx: 0, ry: 0 } }),
      { type: 'gamepadStick', stick: 'left', axis: 'x', operator: '>', value: 0.2 }).triggered === true);
}

// --- subsystem delegations ---
{
  const calls = [];
  const subCtx = makeCtx({
    collections: { evalCollectionCondition: (vars, data, hooks) => { calls.push(['collections', vars, data, hooks]); return { pass: true, context: { collection: true } }; } },
    math: { evalMathCondition: (data, hooks) => { calls.push(['math', data, hooks]); return { pass: true, context: { math: true } }; } },
    pick: { evalPickCondition: (data, hooks) => { calls.push(['pick', data, hooks]); return { pass: false, context: { pick: true } }; },
      evalPickTaggedCondition: (data, hooks) => { calls.push(['pickTagged', data, hooks]); return { pass: true, context: { pickTagged: true } }; } },
    layerFx: { evalLayerFxCondition: (data, hooks) => { calls.push(['layerFx', data, hooks]); return { pass: true, context: { layer: true } }; } },
    threeD: { eval3dCondition: (data, hooks) => { calls.push(['threeD', data, hooks]); return { pass: true, context: { d3: true } }; } },
    light2d: { evalLight2dCondition: (data, hooks) => { calls.push(['light2d', data, hooks]); return { pass: true, context: { dark: true } }; } },
    joints: { evalJointCondition: (data, hooks) => { calls.push(['joints', data, hooks]); return { pass: true, context: { joint: true } }; } },
    collectionHooks: () => ({ coll: 1 }),
    mathHooks: () => ({ m: 1 }),
    pickHooks: () => ({ p: 1 }),
    layerFxConditionHooks: () => ({ l: 1 }),
    threeDConditionHooks: () => ({ t: 1 }),
    light2dConditionHooks: () => ({ li: 1 }),
    jointConditionHooks: () => ({ j: 1 })
  });
  check('arrayLength delegates to the collections module with variables first',
    (() => { const r = ev(subCtx, { type: 'arrayLength', varName: 'xs' });
      const c = calls.find(x => x[0] === 'collections');
      return r.triggered === true && r.context.collection === true && c && c[1] === subCtx.variables && c[2].type === 'arrayLength' && c[3].coll === 1; })());
  check('numberInRange delegates to the math module',
    (() => { const r = ev(subCtx, { type: 'numberInRange' });
      return r.triggered === true && r.context.math === true && calls.some(x => x[0] === 'math'); })());
  check('pickNearest delegates to the pick module and honors a false pass',
    (() => { const r = ev(subCtx, { type: 'pickNearest', targetObject: 'hero' });
      return r.triggered === false && r.context.pick === true; })());
  check('pickNearest reversed passes on a false pass',
    ev(subCtx, { type: 'pickNearest', targetObject: 'hero', reversed: true }).triggered === true);
  check('pickNearestTagged delegates to the pick module and honors a true pass',
    (() => { const r = ev(subCtx, { type: 'pickNearestTagged', tag: 'goblin' });
      return r.triggered === true && r.context.pickTagged === true &&
        calls.some(x => x[0] === 'pickTagged'); })());
  check('pickFarthestTagged and pickRandomTagged share the tag-pick delegation',
    ev(subCtx, { type: 'pickFarthestTagged', tag: 'goblin' }).triggered === true &&
    ev(subCtx, { type: 'pickRandomTagged', tag: 'goblin' }).triggered === true &&
    ev(subCtx, { type: 'pickNearestTagged', tag: 'goblin', reversed: true }).triggered === false);
  check('layerCheck delegates to the layer module',
    ev(subCtx, { type: 'layerCheck' }).triggered === true);
  check('distance3d delegates to the 3D module',
    ev(subCtx, { type: 'distance3d' }).triggered === true);
  check('mousePointerCaptured and onGround3d share the 3D delegation',
    ev(subCtx, { type: 'mousePointerCaptured' }).triggered === true &&
    ev(subCtx, { type: 'onGround3d' }).triggered === true);
  check('darknessLevel delegates to the lighting module',
    ev(subCtx, { type: 'darknessLevel' }).triggered === true);
  check('jointConnected delegates to the joints module',
    ev(subCtx, { type: 'jointConnected' }).triggered === true);
  check('subsystem conditions read false without their module',
    ev(makeCtx(), { type: 'arrayLength' }).triggered === false &&
    ev(makeCtx(), { type: 'numberInRange' }).triggered === false &&
    ev(makeCtx(), { type: 'pickNearest' }).triggered === false &&
    ev(makeCtx(), { type: 'pickNearestTagged' }).triggered === false &&
    ev(makeCtx(), { type: 'pickRandomTagged' }).triggered === false &&
    ev(makeCtx(), { type: 'distance3d' }).triggered === false);
  check('a throwing subsystem reads as not-triggered',
    ev(makeCtx({ collections: { evalCollectionCondition: () => { throw new Error('boom'); } } }),
      { type: 'arrayLength' }).triggered === false);
}

// --- pause freeze ---
{
  const pausedCtx = makeCtx({ isPaused: () => true, physics2d: makePhysics2d() });
  ['collision', 'overlapTouch', 'onFloor', 'lineOfSight', 'onEdge',
   'tileSolidAt', 'standingOnTile', 'triggerEnter', 'triggerExit',
   'raycastHit', 'overlapCheck'].forEach(t => {
    const data = { type: t, object1: 'hero', object2: 'crate', targetObject: 'hero',
      platformObject: 'floor', zoneObject: 'zone', fromX: 0, fromY: 0, toX: 200, toY: 200,
      x: 50, y: 50, radius: 24, tilemapName: 'map', edge: 'any' };
    check('frozen while paused: ' + t + ' does not fire',
      ev(pausedCtx, data).triggered === false);
    check('frozen while paused: reversed ' + t + ' passes',
      ev(pausedCtx, Object.assign({}, data, { reversed: true })).triggered === true);
  });
  check('state reads still evaluate while paused (distanceCheck, getVariable)',
    ev(pausedCtx, { type: 'distanceCheck', object1: 'hero', object2: 'wall', operator: '<=', distance: 100 }).triggered === true &&
    ev(pausedCtx, { type: 'getVariable', varName: 'score', operator: '>=', compareValue: 5 }).triggered === true);
}

// --- unknown types + hostile input ---
{
  const ctx = makeCtx();
  reported.length = 0;
  check('unknown block type reports once through reportUnknown and reads false',
    (() => { const r = ev(ctx, { type: 'wat' });
      return r.triggered === false && reported.includes('wat'); })());
  check('unknown type with reversed still reads false',
    ev(ctx, { type: 'wat', reversed: true }).triggered === false);
  check('non-string type reads false without reporting',
    (() => { const before = reported.length;
      const r = ev(ctx, { type: 42 });
      return r.triggered === false && reported.length === before; })());
  check('null data reads false',
    ev(ctx, null).triggered === false);
  check('missing ctx degrades to false, never throws',
    C.evaluateCondition({ type: 'collision', object1: 'a', object2: 'b' }, undefined).triggered === false);
  check('throwing named lookup reads false',
    ev(makeCtx({ named: () => { throw new Error('boom'); } }), { type: 'objectCount', targetObject: 'hero', operator: '==', count: 2 }).triggered === false);
  check('a throwing expression degrades to 0 and never throws (score <= 5 reads false)',
    ev(makeCtx({ expr: () => { throw new Error('boom'); } }), { type: 'getVariable', varName: 'score', operator: '<=', compareValue: 5 }).triggered === false);
  check('throwing hook builder reads false',
    ev(makeCtx({ collections: { evalCollectionCondition: () => ({ pass: true, context: {} }) },
      collectionHooks: () => { throw new Error('boom'); } }), { type: 'arrayLength' }).triggered === false);
  check('throwing reportUnknown is swallowed',
    ev(makeCtx({ reportUnknown: () => { throw new Error('boom'); } }), { type: 'wat' }).triggered === false);
  check('frozen ctx objects do not break evaluation',
    (() => { const frozen = makeCtx(); Object.freeze(frozen); Object.freeze(frozen.variables);
      return ev(frozen, { type: 'getVariable', varName: 'score', operator: '>=', compareValue: 5 }).triggered === true; })());
}

// --- static routing: both runtimes delegate to the shared module ---
{
  const playerSrc = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'player-runtime.js'), 'utf8');
  const scriptSrc = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'script.js'), 'utf8');
  const moduleSrc = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-previewruntime.js'), 'utf8');
  const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'index.html'), 'utf8');
  check('export delegates evaluate to HydraConditions via one conditionCtx builder',
    playerSrc.includes('HydraConditions.evaluateCondition(data, conditionCtx(state), scope, idx)') &&
    playerSrc.includes('function conditionCtx(state)'));
  check('export hard-guards on HydraConditions at load',
    playerSrc.includes("HydraScript player runtime requires hydra-conditions.js (window.HydraConditions) to be loaded first."));
  check('export inlines the shared conditions module',
    playerSrc.includes("['HydraConditions', global.HydraConditions && global.HydraConditions.factorySource, 'hydra-conditions.js (window.HydraConditions)']"));
  check('export inline condition switches are gone',
    !playerSrc.includes('function evalKey(') && !playerSrc.includes('function evalCollision(') &&
    !playerSrc.includes('function evalTimer(') && !playerSrc.includes('function evalAnd(') &&
    !playerSrc.includes('function evalPointObject(') && !playerSrc.includes('function evalRaycastHit(') &&
    !playerSrc.includes('function res(') && !playerSrc.includes('function compare('));
  check('the preview runtime module delegates evaluateCondition to HydraConditions via one conditionCtx builder',
    moduleSrc.includes('conditions.evaluateCondition(data, conditionCtx(), scope, idx)') &&
    moduleSrc.includes('function conditionCtx()'));
  check('the preview runtime module guards the call (a dropped tag degrades to false)',
    moduleSrc.includes("if (!conditions || typeof conditions.evaluateCondition !== 'function') return { triggered: false };"));
  check('script.js no longer defines evaluateCondition inline',
    !/function evaluateCondition\(data, idx, scope\)/.test(scriptSrc) &&
    !scriptSrc.includes('window.HydraConditions.evaluateCondition'));
  check('preview inline condition switches are gone',
    !scriptSrc.includes('function evaluateCollisionCondition(') &&
    !scriptSrc.includes('function evaluateTimerCondition(') &&
    !scriptSrc.includes('function evaluateKeyboardCondition(') &&
    !scriptSrc.includes('function evaluateAndCondition(') &&
    !scriptSrc.includes('function conditionResult('));
  check('index.html loads hydra-conditions.js before player-runtime.js and script.js',
    indexSrc.indexOf('src="hydra-conditions.js') !== -1 &&
    indexSrc.indexOf('src="hydra-conditions.js') < indexSrc.indexOf('src="player-runtime.js') &&
    indexSrc.indexOf('src="hydra-conditions.js') < indexSrc.indexOf('src="script.js'));
  check('module file carries the factorySource export',
    fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-conditions.js'), 'utf8')
      .includes('window.HydraConditions.factorySource = hydraConditionsFactory.toString();'));
}

if (failures) { console.error(`${failures} assertion(s) failed`); process.exit(1); }
console.log('conditions.test.js: all assertions passed');
