// Unit tests for hydra/hydra-execute.js — the shared per-block action
// execution (P2 item 15/12, slice 9: the shared-engine extraction —
// the final slice).
//
// Pure logic: every action both runtimes can run, over a stub context
// object — target resolution (context narrowing, targetMode, hidden
// exclusion), movement, toward/point, camera, scenes (switch, relative,
// push/pop stack, background), spawning, timers, variables/text,
// save/load, buses/music, pause/profiler, particles/animation, tiles,
// screen bounds, runScript, separateObjects, and the subsystem
// delegations (collections, math, localization, skeleton, script API).
// The tests pin the export's semantics (the reference), the closed
// divergences (hidden objects out of preview actions, push/pop and
// setSceneBackground in the preview, separateObjects in exports, the
// stopObject/setStatic/setVelocity/setPhysics/spawn/teleport/timer/
// save-load divergences, clampToScreen bounce, moveToward dt, the
// grounded layer rule), the never-throws contract, the hostile-input
// degradation, and the static routing that both runtimes delegate to it.

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
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-execute.js'), 'utf8'),
  sandbox, { filename: 'hydra-execute.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-dialogue.js'), 'utf8'),
  sandbox, { filename: 'hydra-dialogue.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-inventory.js'), 'utf8'),
  sandbox, { filename: 'hydra-inventory.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-quest.js'), 'utf8'),
  sandbox, { filename: 'hydra-quest.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-achievement.js'), 'utf8'),
  sandbox, { filename: 'hydra-achievement.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-cutscene.js'), 'utf8'),
  sandbox, { filename: 'hydra-cutscene.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-highscore.js'), 'utf8'),
  sandbox, { filename: 'hydra-highscore.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-timescale.js'), 'utf8'),
  sandbox, { filename: 'hydra-timescale.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-transition.js'), 'utf8'),
  sandbox, { filename: 'hydra-transition.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-camerafeel.js'), 'utf8'),
  sandbox, { filename: 'hydra-camerafeel.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-parallax.js'), 'utf8'),
  sandbox, { filename: 'hydra-parallax.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-spatialaudio.js'), 'utf8'),
  sandbox, { filename: 'hydra-spatialaudio.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-tiles.js'), 'utf8'),
  sandbox, { filename: 'hydra-tiles.js' });
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
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-growth.js'), 'utf8'),
  sandbox, { filename: 'hydra-growth.js' });
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
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-variables.js'), 'utf8'),
  sandbox, { filename: 'hydra-variables.js' });
const X = sandbox.HydraExecute;
const Dlg = sandbox.HydraDialogue;
const Inv = sandbox.HydraInventory;
const Q = sandbox.HydraQuest;
const A = sandbox.HydraAchievement;
const Cut = sandbox.HydraCutscene;
const HS = sandbox.HydraHighScore;
const TS = sandbox.HydraTimeScale;
const TR = sandbox.HydraTransition;
const CF = sandbox.HydraCameraFeel;
const PX = sandbox.HydraParallax;
const SA = sandbox.HydraSpatialAudio;
const Tiles = sandbox.HydraTiles;
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
const GR = sandbox.HydraGrowth;
const SC = sandbox.HydraScaling;
const BO = sandbox.HydraBoss;
const TG = sandbox.HydraTags;
const MM = sandbox.HydraMinimap;
const AT = sandbox.HydraAttach;
const VV = sandbox.HydraVariables;

// --- surface + factorySource ---
check('HydraExecute loads with executeAction',
  !!X && typeof X.executeAction === 'function');
{
  const sb2 = {};
  sb2.window = sb2;
  vm.createContext(sb2);
  const fresh = vm.runInContext('(' + X.factorySource + ')()', sb2);
  check('factorySource re-instantiates an independent module',
    fresh.executeAction !== X.executeAction &&
    typeof fresh.executeAction === 'function' &&
    typeof fresh.factorySource === 'undefined');
}

// --- stub world ---
let nowValue = 1000;
const reported = [];
const warnings = [];
const flashWarnings = [];
const timerWarnings = [];
const calls = [];
function hitboxOf(o) {
  return {
    x: (o.posX || 0) + (Number(o.hitboxOffsetX) || 0),
    y: (o.posY || 0) + (Number(o.hitboxOffsetY) || 0),
    width: Number(o.hitboxWidth) > 0 ? Number(o.hitboxWidth) : (o.width || 1),
    height: Number(o.hitboxHeight) > 0 ? Number(o.hitboxHeight) : (o.height || 1)
  };
}
function makeObjects() {
  return [
    { id: 1, name: 'hero', kind: 'sprite', posX: 10, posY: 20, width: 40, height: 40, velX: 0, velY: 0, rotation: 0 },
    { id: 2, name: 'wall', kind: 'sprite', posX: 100, posY: 20, width: 40, height: 40, velX: 0, velY: 0 },
    { id: 3, name: 'hero', kind: 'sprite', posX: 200, posY: 20, width: 40, height: 40, velX: 0, velY: 0 },
    { id: 4, name: 'ghost', kind: 'sprite', posX: 300, posY: 20, width: 40, height: 40, velX: 0, velY: 0 },
    { id: 5, name: 'label', kind: 'text', posX: 30, posY: 30, width: 100, height: 20, text: 'hi', _runtimeText: 'hi', velX: 0, velY: 0 },
    { id: 6, name: 'floor', kind: 'sprite', posX: 0, posY: 60, width: 200, height: 20, static: true },
    { id: 7, name: 'map', kind: 'tilemap', posX: 0, posY: 0, width: 800, height: 600 },
    { id: 8, name: 'box', kind: 'sprite', posX: 30, posY: 20, width: 40, height: 40, velX: 0, velY: 0 }
  ];
}
function makeDefs() {
  return [
    { id: 101, name: 'coin', kind: 'sprite', posX: 50, posY: 60, width: 20, height: 20, rotation: 45 }
  ];
}
function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => m.has(k) ? m.get(k) : null,
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); }
  };
}
function makeCtx(overrides) {
  const objects = makeObjects();
  const defs = makeDefs();
  const hidden = new Set();
  const pendingDestroy = new Set();
  const destroyed = new Set();
  const sceneStack = [];
  const scene = { id: 1, bgColor: '#000000', objects: defs };
  const slots = new Map();
  const ctx = {
    variables: { score: 5 },
    objects: objects,
    hidden: hidden,
    pendingDestroy: pendingDestroy,
    destroyed: destroyed,
    executionContext: null,
    dt: 0.016,
    camera: { x: 0, y: 0, zoom: 1, followTarget: '', offsetX: 0, offsetY: 0 },
    canvasWidth: 800, canvasHeight: 600,
    named: (name, includeHidden) => objects.filter(o =>
      o.name === name && !destroyed.has(o.id) && !pendingDestroy.has(o.id) &&
      (includeHidden || !hidden.has(o.id))),
    allObjects: () => objects.filter(o => !destroyed.has(o.id) && !pendingDestroy.has(o.id)),
    hitbox: hitboxOf,
    getPhysics: (o) => o.physics || { gravity: 0, friction: 0, maxSpeed: 400, bounciness: 0 },
    isCollisionObject: (o) => !!o && o.kind !== 'tilemap',
    expr: (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; },
    exprInfo: (v) => {
      if (v === undefined || v === null || v === '') return { ok: false, value: 0 };
      const n = Number(v);
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, value: 0 };
    },
    random: () => 0.5,
    worldSize: () => ({ width: 800, height: 600 }),
    getScene: () => scene,
    sceneObjectDefs: () => defs,
    scenes: [
      { id: 1, bgColor: '#000000' },
      { id: 2, bgColor: '#111111' },
      { id: 3, bgColor: '#222222' }
    ],
    sceneId: 1,
    pendingSceneId: null,
    requestScene: (id) => { ctx.pendingSceneId = id; },
    sceneStack: sceneStack,
    clampCamera: () => { calls.push(['clampCamera']); },
    updateCameraFollow: () => { calls.push(['updateCameraFollow']); },
    shake: { strength: 0, timeLeft: 0 },
    flash: { color: '#ffffff', intensity: 0, timeLeft: 0, maxTime: 0 },
    shakeCooldownOk: (data, idx) => { calls.push(['shakeCooldownOk', data.cooldown, idx]); return true; },
    cameraFx: {
      isValidHexColor: (c) => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c),
      triggerShake: (shake, s, d) => { shake.strength = s; shake.timeLeft = d; },
      triggerFlash: (flash, color, i, d) => {
        if (!/^#[0-9a-fA-F]{6}$/.test(color || '')) return false;
        flash.color = color; flash.intensity = Math.max(0, Math.min(1, i));
        flash.timeLeft = d; flash.maxTime = d; return true;
      }
    },
    warn: (msg) => { warnings.push(msg); },
    warnFlashColor: (c) => { flashWarnings.push(c); },
    warnReadTimerBlank: (w) => { timerWarnings.push(w); },
    reportUnknown: (type) => { reported.push(type); },
    playSound: (data, idx) => { calls.push(['sound', data.sound || data.name, idx]); },
    stopMusic: () => { calls.push(['stopMusic']); },
    pauseMusic: () => { calls.push(['pauseMusic']); },
    resumeMusic: () => { calls.push(['resumeMusic']); },
    stopAllSounds: () => { calls.push(['stopAllSounds']); },
    buses: {
      master: { volume: 0.5, muted: false },
      music: { volume: 0.5, muted: false },
      sfx: { volume: 0.5, muted: false }
    },
    audioBuses: {
      normalizeBusId: (b) => b || 'master',
      normalizeMasterVolume: (v) => Math.max(0, Math.min(1, v))
    },
    setMasterVolume: (v) => { ctx.masterVolume = v; },
    save: {
      safeStorage: () => ({}),
      writeSlot: (st, name, vars) => { slots.set(name, JSON.parse(JSON.stringify(vars))); },
      readSlot: (st, name) => slots.has(name) ? { data: slots.get(name) } : null,
      deleteSlot: (st, name) => { slots.delete(name); }
    },
    storage: makeStorage(),
    pause: {
      pause: (s) => { s.paused = true; },
      resume: (s) => { s.paused = false; },
      toggle: (s) => { s.paused = !s.paused; }
    },
    pauseState: { paused: false },
    profile: {
      show: (s) => { s.visible = true; },
      hide: (s) => { s.visible = false; },
      toggle: (s) => { s.visible = !s.visible; }
    },
    profilerState: { visible: false },
    particles: {
      burst: (state, spec) => { calls.push(['burst', spec]); },
      startEmitter: (state, name, spec) => { calls.push(['startEmitter', name, spec]); },
      stopEmitter: (state, name) => { calls.push(['stopEmitter', name]); },
      clearParticles: (state, name) => { calls.push(['clearParticles', name]); }
    },
    particleState: {},
    ensureParticles: () => ctx.particleState,
    actions: {
      remapAction: (state, name, key) => { state[name] = key; },
      resetBindings: (state) => { Object.keys(state).forEach(k => delete state[k]); }
    },
    actionsState: {},
    tiles: {
      setTile: (tm, c, r, t) => { tm.painted = tm.painted || {}; tm.painted[c + ',' + r] = t; }
    },
    anim: {
      createAnimState: () => ({}),
      play: (s, o, n) => { if (s) s.played = n; },
      setAnimation: (s, o, n) => { if (s) s.current = n; },
      stop: (s) => { if (s) s.played = null; },
      setSpeed: (s, v) => { if (s) s.speed = v; }
    },
    stateMachine: {
      createRuntime: () => ({}),
      setState: (rt, o, state, hooks) => { rt.state = state; }
    },
    blendSpace: {
      createBlendRuntime: () => ({}),
      setBlend: (rt, o, n, x, y, hooks) => { rt.blend = n; },
      stopBlend: (rt, o, n) => { if (rt) rt.blend = null; }
    },
    tween: {
      start: (s, o, opts) => { o._tween = opts; },
      stop: (s, o, p) => { o._tween = null; }
    },
    collections: null, math: null, layerFx: null, threeD: null,
    light2d: null, joints: null, skeleton: null, localization: null,
    scriptApi: null, sceneInit: null, physics2d: null,
    collectionHooks: () => ({}), mathHooks: () => ({}),
    layerFxActionHooks: () => ({}), threeDActionHooks: () => ({}),
    light2dActionHooks: () => ({}), jointActionHooks: () => ({}),
    scriptApiHooks: () => ({}), sceneInitHooks: () => ({}),
    stateMachineHooks: (obj) => ({ warn: (m) => warnings.push(m), play: () => {} }),
    timers: new Map(),
    nowMs: () => nowValue,
    frozenNowMs: () => nowValue,
    timerElapsedSeconds: (key, now) => {
      const rec = ctx.timers.get(key);
      if (!rec || typeof rec !== 'object') return 0;
      return Math.max(0, ((rec.paused ? (rec.pausedAt || now) : now) - rec.lastFiredTime) / 1000);
    },
    localizationTable: {
      languages: ['en', 'es'],
      strings: { en: { hello: 'Hello' }, es: { hello: 'Hola' } }
    },
    language: 'en',
    getLanguage: () => ctx.language,
    setLanguage: (code) => { ctx.language = code; },
    applyBoundTexts: () => { calls.push(['applyBoundTexts']); }
  };
  Object.assign(ctx, overrides || {});
  return ctx;
}
function ex(ctx, data, idx) { X.executeAction(data, ctx, idx === undefined ? 0 : idx); }
function hero(ctx, id) { return ctx.objects.find(o => o.id === id); }

// --- target resolution ---
{
  const ctx = makeCtx();
  ex(ctx, { type: 'setVelocity', targetObject: 'hero', velX: 10, velY: 20 });
  check('default target mode hits the first live match only',
    hero(ctx, 1).velX === 10 && hero(ctx, 1).velY === 20 &&
    hero(ctx, 3).velX === 0 && hero(ctx, 3).velY === 0);
}
{
  const ctx = makeCtx();
  ex(ctx, { type: 'setVelocity', targetObject: 'hero', targetMode: 'all', velX: 7, velY: 8 });
  check("targetMode 'all' hits every live match",
    hero(ctx, 1).velX === 7 && hero(ctx, 3).velX === 7);
}
{
  const ctx = makeCtx();
  ex(ctx, { type: 'setVelocity', targetObject: 'hero', targetMode: 'first', velX: 7, velY: 8 });
  check("targetMode 'first' hits the first live match",
    hero(ctx, 1).velX === 7 && hero(ctx, 3).velX === 0);
}
{
  const ctx = makeCtx();
  ctx.executionContext = { obj1: hero(ctx, 3) };
  ex(ctx, { type: 'setVelocity', targetObject: 'hero', velX: 9, velY: 0 });
  check('context narrowing picks the triggering object over the first match',
    hero(ctx, 1).velX === 0 && hero(ctx, 3).velX === 9);
}
{
  const ctx = makeCtx();
  ctx.executionContext = { obj1: hero(ctx, 2) }; // wall is not a hero
  ex(ctx, { type: 'setVelocity', targetObject: 'hero', velX: 9, velY: 0 });
  check('context narrowing falls back to the first match when the picked object has another name',
    hero(ctx, 1).velX === 9 && hero(ctx, 3).velX === 0);
}
{
  const ctx = makeCtx();
  ctx.hidden.add(1);
  ex(ctx, { type: 'setVelocity', targetObject: 'hero', velX: 11, velY: 0 });
  check('hidden objects no longer participate in actions (first non-hidden match wins)',
    hero(ctx, 1).velX === 0 && hero(ctx, 3).velX === 11);
}
{
  const ctx = makeCtx();
  ctx.hidden.add(1);
  ex(ctx, { type: 'showHide', targetObject: 'hero', action: 'show' });
  check('showHide still reaches hidden objects (includeHidden lookup)',
    !ctx.hidden.has(1));
}
{
  const ctx = makeCtx();
  ex(ctx, { type: 'showHide', targetObject: 'hero', action: 'hide' });
  check('showHide hide adds the first match to hidden',
    ctx.hidden.has(1) && !ctx.hidden.has(3));
}
{
  const ctx = makeCtx();
  ctx.pendingDestroy.add(1);
  ex(ctx, { type: 'setVelocity', targetObject: 'hero', velX: 12, velY: 0 });
  check('pending-destroy objects are excluded from targets',
    hero(ctx, 1).velX === 0 && hero(ctx, 3).velX === 12);
}
{
  const ctx = makeCtx();
  ex(ctx, { type: 'setVelocity', targetObject: 'nobody', velX: 1, velY: 1 });
  check('unknown target name is a silent no-op',
    hero(ctx, 1).velX === 0 && reported.length === 0);
}

// --- movement / physics ---
{
  const ctx = makeCtx();
  ex(ctx, { type: 'applyForce', targetObject: 'hero', forceX: 30, forceY: 40, mode: 'add' });
  check('applyForce add mode adds velocity',
    hero(ctx, 1).velX === 30 && hero(ctx, 1).velY === 40);
  ex(ctx, { type: 'applyForce', targetObject: 'hero', forceX: 5, forceY: 5, mode: 'set' });
  check('applyForce set mode replaces velocity',
    hero(ctx, 1).velX === 5 && hero(ctx, 1).velY === 5);
  ex(ctx, { type: 'applyForce', targetObject: 'hero', forceX: 9999, forceY: 0, mode: 'set' });
  check('applyForce clamps to the physics maxSpeed',
    hero(ctx, 1).velX === 400);
}
{
  const ctx = makeCtx();
  ex(ctx, { type: 'setVelocity', targetObject: 'label', velX: 3, velY: 4 });
  check('setVelocity on a text object sets the velocity (closed divergence)',
    hero(ctx, 5).velX === 3 && hero(ctx, 5).velY === 4);
  ex(ctx, { type: 'applyForce', targetObject: 'label', forceX: 3, forceY: 4 });
  check('applyForce still skips text objects',
    hero(ctx, 5).velX === 3 && hero(ctx, 5).velY === 4);
}
{
  const ctx = makeCtx();
  ex(ctx, { type: 'teleport', targetObject: 'hero', toX: 100, toY: 200 });
  check('teleport accepts toX/toY',
    hero(ctx, 1).posX === 100 && hero(ctx, 1).posY === 200);
  ex(ctx, { type: 'setPosition', targetObject: 'hero', x: 50, y: 60 });
  check('setPosition accepts x/y',
    hero(ctx, 1).posX === 50 && hero(ctx, 1).posY === 60);
  ex(ctx, { type: 'teleport', targetObject: 'hero', toX: 'nope', toY: 70 });
  check('teleport requires both expressions to parse (bad x leaves the object put)',
    hero(ctx, 1).posX === 50 && hero(ctx, 1).posY === 60);
}
{
  const ctx = makeCtx();
  hero(ctx, 1).velX = 10; hero(ctx, 1).velY = 20;
  ex(ctx, { type: 'stopObject', targetObject: 'hero' });
  check('stopObject with no axis stops both axes (closed divergence)',
    hero(ctx, 1).velX === 0 && hero(ctx, 1).velY === 0);
  hero(ctx, 1).velX = 10; hero(ctx, 1).velY = 20;
  ex(ctx, { type: 'stopObject', targetObject: 'hero', axis: 'x' });
  check("stopObject axis 'x' stops only x",
    hero(ctx, 1).velX === 0 && hero(ctx, 1).velY === 20);
  hero(ctx, 1).velX = 10; hero(ctx, 1).velY = 20;
  ex(ctx, { type: 'stopObject', targetObject: 'hero', axis: 'weird' });
  check('stopObject with an unknown axis stops both axes',
    hero(ctx, 1).velX === 0 && hero(ctx, 1).velY === 0);
}
{
  const ctx = makeCtx();
  hero(ctx, 1).velX = 15; hero(ctx, 1).velY = 25;
  ex(ctx, { type: 'setStatic', targetObject: 'hero', static: true });
  check('setStatic flips the flag without zeroing velocity (closed divergence)',
    hero(ctx, 1).static === true && hero(ctx, 1).velX === 15 && hero(ctx, 1).velY === 25);
}
{
  const ctx = makeCtx();
  ex(ctx, { type: 'setPhysicsEnabled', targetObject: 'hero', enabled: true });
  check('setPhysicsEnabled flips the flag without creating a physics record (closed divergence)',
    hero(ctx, 1).physicsEnabled === true && !('physics' in hero(ctx, 1)));
}
{
  const ctx = makeCtx();
  ex(ctx, { type: 'setGravity', targetObject: 'hero', gravity: 2.5 });
  ex(ctx, { type: 'setFriction', targetObject: 'hero', friction: 5 });
  ex(ctx, { type: 'setMaxSpeed', targetObject: 'hero', maxSpeed: -10 });
  ex(ctx, { type: 'setBounciness', targetObject: 'hero', bounciness: 3 });
  check('setGravity/setFriction/setMaxSpeed/setBounciness write the raw expression value (closed divergence)',
    hero(ctx, 1).physics.gravity === 2.5 && hero(ctx, 1).physics.friction === 5 &&
    hero(ctx, 1).physics.maxSpeed === -10 && hero(ctx, 1).physics.bounciness === 3 &&
    hero(ctx, 1).physicsEnabled === true);
}
{
  const ctx = makeCtx();
  ex(ctx, { type: 'rotateObject', targetObject: 'hero', angle: 30, mode: 'set' });
  check('rotateObject set mode writes the angle',
    hero(ctx, 1).rotation === 30);
  ex(ctx, { type: 'rotateObject', targetObject: 'hero', angle: 30 });
  check('rotateObject add mode accumulates with a 360 wrap',
    hero(ctx, 1).rotation === 60);
}
{
  const ctx = makeCtx();
  ex(ctx, { type: 'setSize', targetObject: 'hero', width: 0, height: -5 });
  check('setSize clamps dimensions to at least 1',
    hero(ctx, 1).width === 1 && hero(ctx, 1).height === 1);
  ex(ctx, { type: 'setColor', targetObject: 'hero', color: '#ff0000' });
  check('setColor writes the color and clears the asset',
    hero(ctx, 1).color === '#ff0000' && hero(ctx, 1).assetId === null);
  ex(ctx, { type: 'setOpacity', targetObject: 'hero', opacity: 2 });
  check('setOpacity clamps to 0-1',
    hero(ctx, 1).opacity === 1);
  ex(ctx, { type: 'flipObject', targetObject: 'hero', direction: 'both' });
  check('flipObject both sets both flips',
    hero(ctx, 1).flipH === true && hero(ctx, 1).flipV === true);
  ex(ctx, { type: 'setScale', targetObject: 'hero', scaleX: 2, scaleY: 3 });
  check('setScale writes both scales',
    hero(ctx, 1).scaleX === 2 && hero(ctx, 1).scaleY === 3);
  ex(ctx, { type: 'setLayer', targetObject: 'hero', layer: 5 });
  check('setLayer writes the layer',
    hero(ctx, 1).layer === 5);
  ex(ctx, { type: 'destroyObject', targetObject: 'hero' });
  check('destroyObject queues the first match for destruction',
    ctx.pendingDestroy.has(1) && !ctx.pendingDestroy.has(3));
}

// --- toward / point / separate ---
{
  const ctx = makeCtx();
  ex(ctx, { type: 'forceTowardPosition', targetObject: 'hero', targetX: 130, targetY: 40, speed: 100 });
  check('forceTowardPosition sets velocity toward the point',
    hero(ctx, 1).velX === 100 && hero(ctx, 1).velY === 0);
}
{
  const ctx = makeCtx();
  ex(ctx, { type: 'moveTowardPosition', targetObject: 'hero', targetX: 130, targetY: 40, speed: 100 });
  check('moveTowardPosition moves by speed * dt (closed divergence)',
    Math.abs(hero(ctx, 1).posX - 11.6) < 0.0001 && hero(ctx, 1).posY === 20);
  const ctx0 = makeCtx({ dt: 0 });
  ex(ctx0, { type: 'moveTowardPosition', targetObject: 'hero', targetX: 130, targetY: 40, speed: 100 });
  check('moveTowardPosition with dt 0 stands still',
    hero(ctx0, 1).posX === 10 && hero(ctx0, 1).posY === 20);
}
{
  const ctx = makeCtx();
  ex(ctx, { type: 'forceToward', targetObject: 'hero', sourceObject: 'wall', speed: 50 });
  check('forceToward moves toward the source object center',
    hero(ctx, 1).velX === 50 && hero(ctx, 1).velY === 0);
  ex(ctx, { type: 'impulseAwayObject', targetObject: 'hero', sourceObject: 'wall', speed: 50 });
  check('impulseAwayObject pushes away from the source object',
    hero(ctx, 1).velX === 0 && hero(ctx, 1).velY === 0);
}
{
  const ctx = makeCtx();
  ex(ctx, { type: 'pointTowardObject', targetObject: 'hero', sourceObject: 'wall' });
  check('pointTowardObject rotates toward the source center',
    hero(ctx, 1).rotation === 0);
  ex(ctx, { type: 'pointTowardPosition', targetObject: 'hero', targetX: 30, targetY: 140 });
  check('pointTowardPosition rotates toward the point',
    hero(ctx, 1).rotation === 90);
  hero(ctx, 1).velX = 10; hero(ctx, 1).velY = 0;
  ex(ctx, { type: 'faceMovement', targetObject: 'hero', minSpeed: 0.05 });
  check('faceMovement rotates along the velocity',
    hero(ctx, 1).rotation === 0);
}
{
  const ctx = makeCtx();
  ex(ctx, { type: 'separateObjects', object1: 'hero', object2: 'box', move: 'object1' });
  check('separateObjects pushes the overlapping pair apart (now works in exports)',
    hero(ctx, 1).posX === -10 && hero(ctx, 8).posX === 30);
  const ctx2 = makeCtx();
  ex(ctx2, { type: 'separateObjects', object1: 'hero', object2: 'box', move: 'object2' });
  check("separateObjects move 'object2' moves only the second object",
    hero(ctx2, 1).posX === 10 && hero(ctx2, 8).posX === 50);
  const ctx3 = makeCtx();
  hero(ctx3, 1).posX = 500; hero(ctx3, 8).posX = 600;
  ex(ctx3, { type: 'separateObjects', object1: 'hero', object2: 'box' });
  check('separateObjects leaves a non-overlapping pair alone',
    hero(ctx3, 1).posX === 500 && hero(ctx3, 8).posX === 600);
}

// --- camera ---
{
  const ctx = makeCtx();
  calls.length = 0;
  ctx.camera.followTarget = 'hero';
  ex(ctx, { type: 'setCamera', cameraX: 100, cameraY: 200 });
  check('setCamera writes x/y, clears follow, and clamps',
    ctx.camera.x === 100 && ctx.camera.y === 200 && ctx.camera.followTarget === '' &&
    calls.some(c => c[0] === 'clampCamera'));
  calls.length = 0;
  ex(ctx, { type: 'followCamera', targetObject: 'hero', offsetX: 5, offsetY: 6 });
  check('followCamera sets the target and offsets and runs one follow frame',
    ctx.camera.followTarget === 'hero' && ctx.camera.offsetX === 5 && ctx.camera.offsetY === 6 &&
    calls.some(c => c[0] === 'updateCameraFollow'));
  ex(ctx, { type: 'centerCameraOn', targetObject: 'wall', offsetX: 0, offsetY: 0 });
  check('centerCameraOn centers the view on the target',
    ctx.camera.x === 120 - 400 && ctx.camera.y === 40 - 300);
  ex(ctx, { type: 'stopCameraFollow' });
  check('stopCameraFollow clears the target',
    ctx.camera.followTarget === '');
  ctx.camera.x = 50; ctx.camera.zoom = 2;
  ex(ctx, { type: 'resetCamera' });
  check('resetCamera restores the default camera',
    ctx.camera.x === 0 && ctx.camera.y === 0 && ctx.camera.zoom === 1 && ctx.camera.followTarget === '');
  ex(ctx, { type: 'setCameraZoom', zoom: 99 });
  check('setCameraZoom clamps to 0.25-4',
    ctx.camera.zoom === 4);
}
{
  const ctx = makeCtx();
  calls.length = 0;
  ex(ctx, { type: 'screenShake', strength: 6, duration: 0.2, cooldown: 0.25 }, 3);
  check('screenShake triggers through cameraFx and asks the cooldown hook with (data, idx)',
    ctx.shake.strength === 6 && ctx.shake.timeLeft === 200 &&
    calls.some(c => c[0] === 'shakeCooldownOk' && c[1] === 0.25 && c[2] === 3));
  const ctx2 = makeCtx({ shakeCooldownOk: () => false });
  ex(ctx2, { type: 'screenShake', strength: 6, duration: 0.2 });
  check('screenShake skips the trigger while the host cooldown says no',
    ctx2.shake.strength === 0 && ctx2.shake.timeLeft === 0);
  const ctx3 = makeCtx();
  delete ctx3.shakeCooldownOk;
  ex(ctx3, { type: 'screenShake', strength: 6, duration: 0.2 });
  check('screenShake fires with no cooldown hook (the export behavior)',
    ctx3.shake.strength === 6);
  const ctx4 = makeCtx();
  ex(ctx4, { type: 'screenFlash', color: '#ff0000', intensity: 0.5, duration: 0.3 });
  check('screenFlash writes the flash through cameraFx',
    ctx4.flash.color === '#ff0000' && ctx4.flash.intensity === 0.5 && ctx4.flash.timeLeft === 300);
  flashWarnings.length = 0;
  const ctx5 = makeCtx();
  ex(ctx5, { type: 'screenFlash', color: 'red', intensity: 0.5, duration: 0.3 });
  check('screenFlash with a bad color holds the old flash and warns',
    ctx5.flash.intensity === 0 && flashWarnings.length === 1 && flashWarnings[0] === 'red');
}

// --- scenes ---
{
  const ctx = makeCtx();
  ex(ctx, { type: 'switchScene', sceneId: 2 });
  check('switchScene defers a valid switch through requestScene',
    ctx.pendingSceneId === 2);
  const ctx2 = makeCtx();
  ex(ctx2, { type: 'switchScene', sceneId: 99 });
  check('switchScene ignores an unknown scene id',
    ctx2.pendingSceneId === null);
  const ctx3 = makeCtx();
  ex(ctx3, { type: 'switchScene', sceneId: 1 });
  check('switchScene to the current scene is a no-op',
    ctx3.pendingSceneId === null);
  const ctx4 = makeCtx();
  ex(ctx4, { type: 'restartScene' });
  check('restartScene requests the current scene',
    ctx4.pendingSceneId === 1);
  const ctx5 = makeCtx();
  ex(ctx5, { type: 'nextScene' });
  check('nextScene steps to the next scene',
    ctx5.pendingSceneId === 2);
  const ctx6 = makeCtx({ sceneId: 3 });
  ex(ctx6, { type: 'nextScene' });
  check('nextScene wraps from the last scene to the first',
    ctx6.pendingSceneId === 1);
  const ctx7 = makeCtx();
  ex(ctx7, { type: 'previousScene' });
  check('previousScene wraps from the first scene to the last',
    ctx7.pendingSceneId === 3);
}
{
  const ctx = makeCtx();
  warnings.length = 0;
  ex(ctx, { type: 'pushScene', sceneId: 2 });
  check('pushScene pushes the current scene and requests the target (now works in the preview)',
    ctx.sceneStack.length === 1 && ctx.sceneStack[0] === 1 && ctx.pendingSceneId === 2);
  // Simulate the switch landing, then pop back.
  ctx.sceneId = 2; ctx.pendingSceneId = null;
  ex(ctx, { type: 'popScene' });
  check('popScene returns to the pushed scene',
    ctx.sceneStack.length === 0 && ctx.pendingSceneId === 1);
  warnings.length = 0;
  ex(ctx, { type: 'popScene' });
  check('popScene with an empty stack warns and does nothing',
    ctx.pendingSceneId === 1 && warnings.length === 1 && /no scene was pushed/.test(warnings[0]));
  warnings.length = 0;
  const ctx2 = makeCtx();
  ex(ctx2, { type: 'pushScene', sceneId: 99 });
  check('pushScene to an unknown scene warns and does nothing',
    ctx2.sceneStack.length === 0 && ctx2.pendingSceneId === null && warnings.length === 1);
  const ctx3 = makeCtx();
  for (let i = 0; i < 16; i++) ctx3.sceneStack.push(1);
  warnings.length = 0;
  ex(ctx3, { type: 'pushScene', sceneId: 2 });
  check('pushScene on a full stack (16) warns and does not push',
    ctx3.sceneStack.length === 16 && ctx3.pendingSceneId === null && warnings.length === 1 &&
    /stack is full/.test(warnings[0]));
  const ctx4 = makeCtx();
  ex(ctx4, { type: 'pushScene', sceneId: 1 });
  check('pushScene to the current scene is a no-op',
    ctx4.sceneStack.length === 0 && ctx4.pendingSceneId === null);
}
{
  const ctx = makeCtx();
  ex(ctx, { type: 'setSceneBackground', color: '#123abc' });
  check('setSceneBackground recolors the current scene (now works in the preview)',
    ctx.getScene().bgColor === '#123abc');
  warnings.length = 0;
  const ctx2 = makeCtx();
  ex(ctx2, { type: 'setSceneBackground', color: 'blue' });
  check('setSceneBackground with a bad color warns and holds the old color',
    ctx2.getScene().bgColor === '#000000' && warnings.length === 1);
}

// --- spawning ---
{
  const ctx = makeCtx();
  ctx.sceneInit = { initSceneObjects: (objs) => { objs.forEach(o => { o._init = true; }); } };
  ex(ctx, { type: 'spawnObject', sourceObject: 'coin', spawnX: 100, spawnY: 200 });
  const clone = ctx.objects[ctx.objects.length - 1];
  check('spawnObject clones the source def at the given coords',
    clone.name === 'coin' && clone.posX === 100 && clone.posY === 200 &&
    clone.id.startsWith('spawn_') && clone._init === true);
  check('spawnObject keeps the source rotation (closed divergence)',
    clone.rotation === 45);
  const before = ctx.objects.length;
  ex(ctx, { type: 'spawnObject', sourceObject: 'coin', spawnX: '', spawnY: '' });
  const clone2 = ctx.objects[ctx.objects.length - 1];
  check('spawnObject with blank coords spawns at the source position',
    ctx.objects.length === before + 1 && clone2.posX === 50 && clone2.posY === 60);
  const ctx2 = makeCtx();
  ex(ctx2, { type: 'spawnObject', sourceObject: 'nobody', spawnX: 0, spawnY: 0 });
  check('spawnObject with an unknown source spawns nothing',
    ctx2.objects.length === 8);
}
{
  const ctx = makeCtx();
  ex(ctx, { type: 'spawnAtObject', sourceObject: 'coin', targetObject: 'hero', targetMode: 'all' });
  const clones = ctx.objects.filter(o => o.name === 'coin');
  check("spawnAtObject spawns at every anchor's center (closed divergence)",
    clones.length === 2 && clones[0].posX === 30 && clones[0].posY === 40 &&
    clones[1].posX === 220 && clones[1].posY === 40);
}

// --- timers ---
{
  const ctx = makeCtx();
  nowValue = 5000;
  ex(ctx, { type: 'timerControl', timerName: 'egg', action: 'start' });
  check('timerControl start creates the record at now',
    ctx.timers.get('named:egg').lastFiredTime === 5000 && ctx.timers.get('named:egg').paused === false);
  nowValue = 9000;
  ex(ctx, { type: 'readTimer', timerName: 'egg', varName: 't' });
  check('readTimer copies elapsed seconds into the variable',
    ctx.variables.t === 4);
  ex(ctx, { type: 'timerControl', timerName: 'egg', action: 'pause' });
  check('timerControl pause freezes the record',
    ctx.timers.get('named:egg').paused === true && ctx.timers.get('named:egg').pausedAt === 9000);
  nowValue = 12000;
  ex(ctx, { type: 'readTimer', timerName: 'egg', varName: 't' });
  check('readTimer reads the frozen value while paused',
    ctx.variables.t === 4);
  ex(ctx, { type: 'timerControl', timerName: 'egg', action: 'resume' });
  check('timerControl resume shifts the start past the paused span',
    ctx.timers.get('named:egg').paused === false && ctx.timers.get('named:egg').lastFiredTime === 8000);
  ex(ctx, { type: 'timerControl', timerName: 'egg', action: 'clear' });
  check('timerControl clear deletes the record',
    !ctx.timers.has('named:egg'));
  ex(ctx, { type: 'timerControl', name: 'egg', action: 'start' });
  check('timerControl accepts the `name` field (closed divergence)',
    ctx.timers.has('named:egg'));
  const ctx2 = makeCtx();
  nowValue = 5000;
  ex(ctx2, { type: 'timerControl', timerName: 'fresh', action: 'pause' });
  check('timerControl pause on a never-started timer starts from now (closed divergence)',
    ctx2.timers.get('named:fresh').lastFiredTime === 5000 &&
    ctx2.timers.get('named:fresh').paused === true);
  nowValue = 6000;
  ex(ctx2, { type: 'readTimer', timerName: 'fresh', varName: 't' });
  check('a paused never-started timer reads 0, not 1',
    ctx2.variables.t === 0);
  timerWarnings.length = 0;
  const ctx3 = makeCtx();
  ex(ctx3, { type: 'readTimer', timerName: 'egg', varName: '' });
  check('readTimer with a blank variable name warns and writes nothing',
    timerWarnings.length === 1 && timerWarnings[0] === 'variable' && !('' in ctx3.variables));
  timerWarnings.length = 0;
  ex(ctx3, { type: 'readTimer', timerName: '', varName: 't' });
  check('readTimer with a blank timer name warns and writes 0',
    timerWarnings.length === 1 && timerWarnings[0] === 'timer' && ctx3.variables.t === 0);
  nowValue = 1000;
}

// --- variables / text ---
{
  const ctx = makeCtx();
  ex(ctx, { type: 'setVariable', varName: 'score', value: 10 });
  check('setVariable sets the value',
    ctx.variables.score === 10);
  ex(ctx, { type: 'setVariable', varName: 'score', value: 5, operation: 'add' });
  check('setVariable add accumulates',
    ctx.variables.score === 15);
  ex(ctx, { type: 'setVariable', varName: 'score', value: 3, operation: 'subtract' });
  check('setVariable subtract works',
    ctx.variables.score === 12);
  ex(ctx, { type: 'setVariable', varName: 'score', value: 2, operation: 'multiply' });
  check('setVariable multiply works',
    ctx.variables.score === 24);
  ex(ctx, { type: 'setVariable', varName: 'score', operation: 'toggle' });
  check('setVariable toggle flips the value',
    ctx.variables.score === false);
  ex(ctx, { type: 'setVariable', varName: 'score', value: 'nope' });
  check('setVariable with an unparsable value leaves the variable alone',
    ctx.variables.score === false);
  ex(ctx, { type: 'randomVariable', varName: 'roll', min: 10, max: 20 });
  check('randomVariable uses the host random (0.5 -> midpoint)',
    ctx.variables.roll === 15);
  ex(ctx, { type: 'randomVariable', varName: 'roll2', min: 10, max: 21, round: true });
  check('randomVariable round rounds the result',
    ctx.variables.roll2 === 16);
}
{
  const ctx = makeCtx();
  ex(ctx, { type: 'setText', targetObject: 'label', value: 'hello' });
  check('setText writes the literal text',
    hero(ctx, 5)._runtimeText === 'hello');
  ex(ctx, { type: 'setText', targetObject: 'label', useVariable: true, varName: 'score', prefix: 'S:', suffix: '!' });
  check('setText with a variable composes prefix + value + suffix',
    hero(ctx, 5)._runtimeText === 'S:5!');
  ex(ctx, { type: 'setText', targetObject: 'hero', value: 'nope' });
  check('setText skips non-text objects',
    hero(ctx, 1)._runtimeText === undefined);
  ex(ctx, { type: 'appendText', targetObject: 'label', value: ' world' });
  check('appendText appends to the runtime text',
    hero(ctx, 5)._runtimeText === 'S:5! world');
  ex(ctx, { type: 'setTextSize', targetObject: 'label', size: 300 });
  check('setTextSize clamps to 6-200',
    hero(ctx, 5).fontSize === 200);
  ex(ctx, { type: 'setTextColor', targetObject: 'label', color: '#00ff00' });
  check('setTextColor writes the color',
    hero(ctx, 5).textColor === '#00ff00');
  ex(ctx, { type: 'setTextStyle', targetObject: 'label', bold: 'on', italic: 'on' });
  check('setTextStyle sets bold and italic',
    hero(ctx, 5).bold === true && hero(ctx, 5).italic === true);
  ex(ctx, { type: 'setTextAlignment', targetObject: 'label', align: 'center' });
  check('setTextAlignment writes the alignment',
    hero(ctx, 5).textAlign === 'center');
}

// --- save / load variable ---
{
  const ctx = makeCtx();
  ex(ctx, { type: 'saveVariable', varName: 'score' });
  check('saveVariable writes the JSON value to storage',
    ctx.storage.getItem('hydraSave:score') === '5');
  ctx.variables.score = 0;
  ex(ctx, { type: 'loadVariable', varName: 'score' });
  check('loadVariable reads the saved value back',
    ctx.variables.score === 5);
  ctx.storage.setItem('hydraSave:score', '{corrupt');
  ctx.variables.score = 7;
  ex(ctx, { type: 'loadVariable', varName: 'score' });
  check('loadVariable leaves the variable unchanged on corrupt JSON (closed divergence)',
    ctx.variables.score === 7);
  const ctx2 = makeCtx();
  ctx2.storage = {
    getItem: () => null,
    setItem: () => { throw new Error('quota'); }
  };
  check('saveVariable never throws on a quota error (closed divergence)',
    (() => { ex(ctx2, { type: 'saveVariable', varName: 'score' }); return true; })());
}

// --- buses / music / pause / profiler ---
{
  const ctx = makeCtx();
  ex(ctx, { type: 'setBusVolume', bus: 'music', volume: 2 });
  check('setBusVolume clamps above 1',
    ctx.buses.music.volume === 1);
  ex(ctx, { type: 'setBusVolume', bus: 'music', volume: 'abc' });
  check('setBusVolume with a non-number keeps the current volume',
    ctx.buses.music.volume === 1);
  ex(ctx, { type: 'setBusMuted', bus: 'sfx', muted: 'true' });
  check('setBusMuted accepts the string form',
    ctx.buses.sfx.muted === true);
  ex(ctx, { type: 'setMasterVolume', volume: 0.7 });
  check('setMasterVolume writes through the host fader',
    ctx.masterVolume === 0.7);
  calls.length = 0;
  ex(ctx, { type: 'stopMusic' });
  ex(ctx, { type: 'pauseMusic' });
  ex(ctx, { type: 'resumeMusic' });
  ex(ctx, { type: 'stopAllSounds' });
  check('music controls call the host hooks in order',
    calls.map(c => c[0]).join(',') === 'stopMusic,pauseMusic,resumeMusic,stopAllSounds');
  ex(ctx, { type: 'pauseGame' });
  check('pauseGame pauses the host run state',
    ctx.pauseState.paused === true);
  ex(ctx, { type: 'resumeGame' });
  check('resumeGame resumes the host run state',
    ctx.pauseState.paused === false);
  ex(ctx, { type: 'togglePause' });
  check('togglePause flips the host run state',
    ctx.pauseState.paused === true);
  ex(ctx, { type: 'showProfiler' });
  check('showProfiler shows the host profiler',
    ctx.profilerState.visible === true);
  ex(ctx, { type: 'hideProfiler' });
  check('hideProfiler hides the host profiler',
    ctx.profilerState.visible === false);
  ex(ctx, { type: 'toggleProfiler' });
  check('toggleProfiler flips the host profiler',
    ctx.profilerState.visible === true);
  calls.length = 0;
  ex(ctx, { type: 'playSound', sound: 'jump' }, 4);
  check('playSound calls the host with (data, idx)',
    calls.some(c => c[0] === 'sound' && c[1] === 'jump' && c[2] === 4));
}

// --- particles / animation / tiles / screen bounds ---
{
  const ctx = makeCtx();
  calls.length = 0;
  ex(ctx, { type: 'emitBurst', x: 10, y: 20, count: 5 });
  check('emitBurst fires the particle burst with the evaluated position',
    calls.some(c => c[0] === 'burst' && c[1].x === 10 && c[1].y === 20 && c[1].count === 5));
  calls.length = 0;
  ex(ctx, { type: 'startEmitter', emitterName: 'fire', x: 1, y: 2 });
  ex(ctx, { type: 'stopEmitter', emitterName: 'fire' });
  ex(ctx, { type: 'clearParticles', emitterName: 'fire' });
  check('start/stop/clear emitter call the particle module',
    calls.map(c => c[0]).join(',') === 'startEmitter,stopEmitter,clearParticles');
  ex(ctx, { type: 'playAnimation', targetObject: 'hero', animation: 'walk' });
  check('playAnimation starts the animation on the target',
    hero(ctx, 1)._anim && hero(ctx, 1)._anim.played === 'walk');
  ex(ctx, { type: 'setAnimation', targetObject: 'hero', animation: 'idle' });
  check('setAnimation sets the current animation',
    hero(ctx, 1)._anim.current === 'idle');
  ex(ctx, { type: 'stopAnimation', targetObject: 'hero' });
  check('stopAnimation stops the animation',
    hero(ctx, 1)._anim.played === null);
  ex(ctx, { type: 'setAnimState', targetObject: 'hero', state: 'run' });
  check('setAnimState enters the named state',
    hero(ctx, 1)._sm && hero(ctx, 1)._sm.state === 'run');
  ex(ctx, { type: 'setBlend', targetObject: 'hero', blend: 'move', blendX: 1, blendY: 0 });
  check('setBlend activates the blend space',
    hero(ctx, 1)._blends && hero(ctx, 1)._blends.blend === 'move');
  ex(ctx, { type: 'stopBlend', targetObject: 'hero', blend: 'move' });
  check('stopBlend stops the blend space',
    hero(ctx, 1)._blends.blend === null);
  ex(ctx, { type: 'tweenProperty', targetObject: 'hero', property: 'posX', toValue: 500, duration: 1 });
  check('tweenProperty starts a tween on the target',
    hero(ctx, 1)._tween && hero(ctx, 1)._tween.property === 'posX' && hero(ctx, 1)._tween.to === 500);
  ex(ctx, { type: 'stopTween', targetObject: 'hero', property: 'posX' });
  check('stopTween stops the tween',
    hero(ctx, 1)._tween === null);
  ex(ctx, { type: 'remapAction', actionName: 'jump', newKey: 'KeyW' });
  check('remapAction remaps the action binding',
    ctx.actionsState.jump === 'KeyW');
  ex(ctx, { type: 'resetActionBindings' });
  check('resetActionBindings clears the bindings',
    Object.keys(ctx.actionsState).length === 0);
}
{
  const ctx = makeCtx();
  ex(ctx, { type: 'setTile', targetObject: 'map', col: 2, row: 3, tile: 7 });
  check('setTile paints one tilemap cell',
    hero(ctx, 7).painted && hero(ctx, 7).painted['2,3'] === 7);
  const ctx2 = makeCtx();
  ctx2.hidden.add(7);
  ex(ctx2, { type: 'setTile', targetObject: 'map', col: 2, row: 3, tile: 7 });
  check('setTile skips hidden tilemaps (closed divergence)',
    !hero(ctx2, 7).painted);
  ex(ctx, { type: 'setCollisionLayer', targetObject: 'hero', layer: 9, mask: 300 });
  check('setCollisionLayer clamps layer 0-7 and mask 0-255',
    hero(ctx, 1).collision.layer === 7 && hero(ctx, 1).collision.mask === 255);
}
{
  const ctx = makeCtx();
  hero(ctx, 1).posX = -10; hero(ctx, 1).velX = -5;
  ex(ctx, { type: 'clampToScreen', targetObject: 'hero', bounce: true });
  check('clampToScreen clamps to the edge and bounces the velocity (closed divergence)',
    hero(ctx, 1).posX === 0 && hero(ctx, 1).velX === 5);
  const ctx2 = makeCtx();
  hero(ctx2, 1).posX = -10; hero(ctx2, 1).velX = -5;
  ex(ctx2, { type: 'clampToScreen', targetObject: 'hero' });
  check('clampToScreen without bounce clamps but keeps the velocity',
    hero(ctx2, 1).posX === 0 && hero(ctx2, 1).velX === -5);
  const ctx3 = makeCtx();
  hero(ctx3, 1).posX = -50;
  ex(ctx3, { type: 'wrapScreen', targetObject: 'hero' });
  check('wrapScreen wraps a fully-off-screen object to the far edge',
    hero(ctx3, 1).posX === 800);
  hero(ctx3, 1).posX = 810;
  ex(ctx3, { type: 'wrapScreen', targetObject: 'hero' });
  check('wrapScreen wraps past the right edge to the left',
    hero(ctx3, 1).posX === -40);
  const ctx4 = makeCtx();
  hero(ctx4, 1).posX = 900;
  ex(ctx4, { type: 'destroyOutsideScreen', targetObject: 'hero' });
  check('destroyOutsideScreen queues an object outside the world',
    ctx4.pendingDestroy.has(1));
  const ctx5 = makeCtx();
  hero(ctx5, 1).posX = 900;
  ex(ctx5, { type: 'destroyOutsideScreen', targetObject: 'hero', margin: 200 });
  check('destroyOutsideScreen honors the margin',
    !ctx5.pendingDestroy.has(1));
}

// --- runScript / save slots ---
{
  const ctx = makeCtx();
  ctx.scriptApi = { runAction: (hooks, code) => { calls.push(['runScript', code]); } };
  calls.length = 0;
  ex(ctx, { type: 'runScript', code: 'hs.setVar("x", 1)' });
  check('runScript runs the user script through the script API',
    calls.some(c => c[0] === 'runScript' && c[1] === 'hs.setVar("x", 1)'));
  const ctx2 = makeCtx();
  ctx2.variables.score = 9;
  ex(ctx2, { type: 'saveGame', slotName: 'a' });
  ctx2.variables.score = 0;
  ex(ctx2, { type: 'loadGame', slotName: 'a' });
  check('saveGame/loadGame round-trips the variables through the save slot',
    ctx2.variables.score === 9);
  ex(ctx2, { type: 'deleteSaveSlot', slotName: 'a' });
  ctx2.variables.score = 3;
  ex(ctx2, { type: 'loadGame', slotName: 'a' });
  check('deleteSaveSlot removes the slot',
    ctx2.variables.score === 3);
}

// --- subsystem delegations ---
{
  const ctx = makeCtx();
  ctx.collections = {
    isCollectionAction: (t) => t === 'collectionAdd',
    applyCollectionAction: (vars, data, hooks) => { calls.push(['collections', data.item]); }
  };
  calls.length = 0;
  ex(ctx, { type: 'collectionAdd', item: 'gem' });
  check('a collections action delegates to the collections module',
    calls.some(c => c[0] === 'collections' && c[1] === 'gem') && reported.length === 0);
  const ctx2 = makeCtx();
  ctx2.collections = {
    isCollectionAction: (t) => t === 'collectionAdd',
    applyCollectionAction: () => { throw new Error('boom'); }
  };
  ctx2.collectionHooks = () => { throw new Error('boom'); };
  check('a throwing collections hook is skipped, never a throw or an unknown-type report',
    (() => { reported.length = 0; ex(ctx2, { type: 'collectionAdd' }); return reported.length === 0; })());
  const ctx3 = makeCtx();
  ctx3.math = {
    isMathAction: (t) => t === 'mathClamp',
    applyMathAction: (vars, data, hooks) => { vars.clamped = 42; }
  };
  ex(ctx3, { type: 'mathClamp' });
  check('a math action delegates to the math module',
    ctx3.variables.clamped === 42);
}
{
  const ctx = makeCtx();
  ctx.localization = {
    isLocalizationAction: (t) => ['setLanguage', 'setTextFromKey', 'setVariableFromKey'].includes(t),
    isKnownLanguage: (table, code) => table.languages.includes(code),
    resolveLocalized: (table, key, lang) =>
      (table.strings[lang] && table.strings[lang][key]) ??
      (table.strings.en && table.strings.en[key]) ?? null
  };
  calls.length = 0;
  ex(ctx, { type: 'setLanguage', language: 'es' });
  check('setLanguage switches the language and re-applies bound texts',
    ctx.language === 'es' && calls.some(c => c[0] === 'applyBoundTexts'));
  warnings.length = 0;
  ex(ctx, { type: 'setLanguage', language: 'fr' });
  check('setLanguage with an unknown language warns and holds',
    ctx.language === 'es' && warnings.length === 1);
  ex(ctx, { type: 'setTextFromKey', object1: 'label', key: 'hello' });
  check('setTextFromKey resolves the key into the text object',
    hero(ctx, 5)._runtimeText === 'Hola');
  warnings.length = 0;
  ex(ctx, { type: 'setTextFromKey', object1: 'label', key: 'nope' });
  check('setTextFromKey with an unknown key warns and holds',
    hero(ctx, 5)._runtimeText === 'Hola' && warnings.length === 1);
  ex(ctx, { type: 'setVariableFromKey', varName: 'greet', key: 'hello' });
  check('setVariableFromKey resolves the key into the variable',
    ctx.variables.greet === 'Hola');
}

// --- dialogue actions (P4 Advanced batch 7) ---
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
  function dialogueCtx() {
    const ctx = makeCtx();
    ctx.objects.push(
      { id: 9, name: 'who', kind: 'text', posX: 0, posY: 0, width: 100, height: 20, text: '' },
      { id: 10, name: 'line', kind: 'text', posX: 0, posY: 30, width: 200, height: 20, text: '' },
      { id: 11, name: 'choice1', kind: 'text', posX: 0, posY: 60, width: 200, height: 20, text: '' },
      { id: 12, name: 'choice2', kind: 'text', posX: 0, posY: 90, width: 200, height: 20, text: '' }
    );
    ctx.dialogueModule = Dlg;
    ctx.dialogue = Dlg.createDialogueRuntime();
    ctx.dialogues = guardDialogue;
    ctx.dialogueHooks = () => ({
      warn: (m) => warnings.push(m),
      setObjectText: (name, text) => {
        ctx.named(name).forEach(o => { if (o.kind === 'text') o._runtimeText = text; });
      }
    });
    return ctx;
  }
  function textObj(ctx, name) { return ctx.objects.find(o => o.name === name); }
  const ctx = dialogueCtx();
  warnings.length = 0;
  ex(ctx, { type: 'startDialogue', dialogue: 'Guard intro', speakerObject: 'who', textObject: 'line', typingSpeed: 0 });
  check('startDialogue starts the named dialogue and binds the speaker',
    ctx.dialogue.active === true && ctx.dialogue.lineIndex === 0 &&
    textObj(ctx, 'who')._runtimeText === 'Guard' && textObj(ctx, 'line')._runtimeText === '');
  check('startDialogue with instant speed reveals the line at once',
    (() => { Dlg.updateDialogue(ctx.dialogue, 1, ctx.dialogueHooks()); return textObj(ctx, 'line')._runtimeText === 'Halt! Who goes there?'; })());
  ex(ctx, { type: 'advanceDialogue' });
  check('advanceDialogue moves to the choice line',
    ctx.dialogue.lineIndex === 1 && ctx.dialogue.revealed === 0);
  Dlg.updateDialogue(ctx.dialogue, 1, ctx.dialogueHooks());
  check('choice line waits after the reveal',
    ctx.dialogue.waitingChoice === true);
  warnings.length = 0;
  ex(ctx, { type: 'advanceDialogue' });
  check('advanceDialogue stays quiet on a choice line',
    ctx.dialogue.lineIndex === 1 && ctx.dialogue.waitingChoice === true && warnings.length === 0);
  ex(ctx, { type: 'setDialogueChoiceText', object1: 'choice1', option: 1 });
  ex(ctx, { type: 'setDialogueChoiceText', object1: 'choice2', option: 2 });
  check('setDialogueChoiceText writes both choice labels',
    textObj(ctx, 'choice1')._runtimeText === 'Show the pass' &&
    textObj(ctx, 'choice2')._runtimeText === 'Run away');
  warnings.length = 0;
  ex(ctx, { type: 'setDialogueChoiceText', object1: 'choice1', option: 3 });
  check('setDialogueChoiceText out of range warns and holds',
    textObj(ctx, 'choice1')._runtimeText === 'Show the pass' && warnings.length === 1);
  warnings.length = 0;
  ex(ctx, { type: 'chooseDialogueOption', option: 3 });
  check('chooseDialogueOption out of range warns and holds',
    ctx.dialogue.lineIndex === 1 && ctx.dialogue.waitingChoice === true && warnings.length === 1);
  warnings.length = 0;
  ex(ctx, { type: 'chooseDialogueOption', option: 2 });
  check('chooseDialogueOption jumps to the picked line',
    ctx.dialogue.lineIndex === 3 && ctx.dialogue.waitingChoice === false && warnings.length === 0);
  ex(ctx, { type: 'stopDialogue' });
  check('stopDialogue ends the conversation',
    ctx.dialogue.active === false);
  warnings.length = 0;
  ex(ctx, { type: 'stopDialogue' });
  check('stopDialogue stays quiet with nothing running',
    warnings.length === 0);
  warnings.length = 0;
  ex(ctx, { type: 'setDialogueChoiceText', object1: 'choice1', option: 1 });
  check('setDialogueChoiceText stays quiet when not waiting',
    textObj(ctx, 'choice1')._runtimeText === 'Show the pass' && warnings.length === 0);
  warnings.length = 0;
  ex(ctx, { type: 'chooseDialogueOption', option: 1 });
  check('chooseDialogueOption stays quiet when not waiting',
    ctx.dialogue.active === false && warnings.length === 0);
  warnings.length = 0;
  ex(ctx, { type: 'startDialogue', dialogue: 'Nobody', speakerObject: 'who', textObject: 'line', typingSpeed: 40 });
  check('startDialogue with an unknown name warns and holds',
    ctx.dialogue.active === false && warnings.length === 1);
  warnings.length = 0;
  ex(ctx, { type: 'startDialogue', dialogue: '', speakerObject: 'who', textObject: 'line', typingSpeed: 40 });
  check('startDialogue with a blank name stays quiet',
    ctx.dialogue.active === false && warnings.length === 0);
  const noModCtx = makeCtx();
  noModCtx.dialogue = Dlg.createDialogueRuntime();
  noModCtx.dialogues = guardDialogue;
  noModCtx.dialogueHooks = () => ({ warn: (m) => warnings.push(m), setObjectText: () => {} });
  warnings.length = 0;
  ex(noModCtx, { type: 'startDialogue', dialogue: 'Guard intro', speakerObject: 'who', textObject: 'line', typingSpeed: 0 });
  check('dialogue actions stay quiet without the dialogue module',
    noModCtx.dialogue.active === false && warnings.length === 0);
}

// --- inventory actions (P4 Advanced batch 8) ---
{
  const guardItems = [
    { id: 'itm_key', name: 'Brass key', maxStack: 1, description: 'Opens the cellar door.' },
    { id: 'itm_coin', name: 'Gold coin', maxStack: 99, description: 'Spend it at the shop.' },
    { id: 'itm_potion', name: 'Potion', maxStack: 5, description: 'Restores health.' }
  ];
  function inventoryCtx() {
    const ctx = makeCtx();
    ctx.inventoryModule = Inv;
    ctx.inventory = Inv.createInventoryRuntime();
    ctx.items = guardItems;
    ctx.inventoryHooks = () => ({ warn: (m) => warnings.push(m) });
    return ctx;
  }
  const ctx = inventoryCtx();
  warnings.length = 0;
  ex(ctx, { type: 'addItem', item: 'Gold coin', count: 5 });
  check('addItem adds the count to the backpack',
    Inv.itemCount(ctx.inventory, 'Gold coin') === 5 && warnings.length === 0);
  ex(ctx, { type: 'addItem', item: 'Gold coin', count: '3' });
  check('addItem takes the count through the expression evaluator',
    Inv.itemCount(ctx.inventory, 'Gold coin') === 8);
  ex(ctx, { type: 'addItem', item: 'Potion', count: 99 });
  check('addItem clamps at the max stack',
    Inv.itemCount(ctx.inventory, 'Potion') === 5);
  ex(ctx, { type: 'addItem', item: 'Brass key', count: 2 });
  check('addItem respects a max stack of 1 for a unique item',
    Inv.itemCount(ctx.inventory, 'Brass key') === 1);
  warnings.length = 0;
  ex(ctx, { type: 'addItem', item: 'Nobody', count: 1 });
  check('addItem with an unknown name warns and holds',
    Inv.itemCount(ctx.inventory, 'Nobody') === 0 && warnings.length === 1);
  warnings.length = 0;
  ex(ctx, { type: 'addItem', item: '', count: 1 });
  check('addItem with a blank name stays quiet',
    warnings.length === 0);
  ex(ctx, { type: 'removeItem', item: 'Gold coin', count: 3 });
  check('removeItem takes the count out',
    Inv.itemCount(ctx.inventory, 'Gold coin') === 5 && warnings.length === 0);
  ex(ctx, { type: 'removeItem', item: 'Gold coin', count: 99 });
  check('removeItem past the held count empties the entry',
    Inv.itemCount(ctx.inventory, 'Gold coin') === 0);
  warnings.length = 0;
  ex(ctx, { type: 'removeItem', item: 'Nobody', count: 1 });
  check('removeItem with an unknown name warns and holds',
    warnings.length === 1);
  ex(ctx, { type: 'setItemCount', item: 'Gold coin', count: 7 });
  check('setItemCount writes the count outright',
    Inv.itemCount(ctx.inventory, 'Gold coin') === 7);
  ex(ctx, { type: 'setItemCount', item: 'Gold coin', count: 0 });
  check('setItemCount to 0 drops the entry',
    Inv.itemCount(ctx.inventory, 'Gold coin') === 0);
  ex(ctx, { type: 'readItemCount', item: 'Potion', varName: 'potions' });
  check('readItemCount copies the count into a variable',
    ctx.variables.potions === 5);
  warnings.length = 0;
  ex(ctx, { type: 'readItemCount', item: 'Nobody', varName: 'missing' });
  check('readItemCount with an unknown name warns and holds the variable',
    ctx.variables.missing === undefined && warnings.length === 1);
  warnings.length = 0;
  ex(ctx, { type: 'readItemCount', item: 'Gold coin', varName: '' });
  check('readItemCount with a blank variable stays quiet',
    warnings.length === 0);
  ex(ctx, { type: 'clearInventory' });
  check('clearInventory empties the whole backpack',
    Inv.itemCount(ctx.inventory, 'Potion') === 0 &&
    Inv.itemCount(ctx.inventory, 'Brass key') === 0 &&
    JSON.stringify(Inv.inventoryList(ctx.inventory)) === '[]');
  const noModCtx = makeCtx();
  noModCtx.inventory = Inv.createInventoryRuntime();
  noModCtx.items = guardItems;
  noModCtx.inventoryHooks = () => ({ warn: (m) => warnings.push(m) });
  warnings.length = 0;
  ex(noModCtx, { type: 'addItem', item: 'Gold coin', count: 5 });
  check('inventory actions stay quiet without the inventory module',
    Inv.itemCount(noModCtx.inventory, 'Gold coin') === 0 && warnings.length === 0);
}

// --- quest actions (P4 Advanced batch 9) ---
{
  const guardQuests = [
    { id: 'qst_coins', name: 'Collect 4 coins', target: 4, description: 'Pick up every coin in Level 1.' },
    { id: 'qst_foes', name: 'Defeat 3 enemies', target: 3, description: 'Clear the level of enemies.' },
    { id: 'qst_goal', name: 'Reach the goal', target: 1, description: 'Finish the level.' }
  ];
  function questCtx() {
    const ctx = makeCtx();
    ctx.questModule = Q;
    ctx.questLog = Q.createQuestRuntime();
    ctx.quests = guardQuests;
    ctx.questHooks = () => ({ warn: (m) => warnings.push(m) });
    return ctx;
  }
  const ctx = questCtx();
  warnings.length = 0;
  ex(ctx, { type: 'addQuestProgress', quest: 'Collect 4 coins', amount: 3 });
  check('addQuestProgress adds the progress to the quest log',
    Q.questProgress(ctx.questLog, 'Collect 4 coins') === 3 && warnings.length === 0);
  ex(ctx, { type: 'addQuestProgress', quest: 'Collect 4 coins', amount: '1' });
  check('addQuestProgress takes the amount through the expression evaluator',
    Q.questProgress(ctx.questLog, 'Collect 4 coins') === 4 && Q.isQuestComplete(ctx.questLog, guardQuests, 'Collect 4 coins') === true);
  ex(ctx, { type: 'addQuestProgress', quest: 'Reach the goal', amount: 99 });
  check('addQuestProgress clamps at the target and completes a one-shot quest',
    Q.questProgress(ctx.questLog, 'Reach the goal') === 1 && Q.isQuestComplete(ctx.questLog, guardQuests, 'Reach the goal') === true);
  warnings.length = 0;
  ex(ctx, { type: 'addQuestProgress', quest: 'Nobody', amount: 1 });
  check('addQuestProgress with an unknown name warns and holds',
    Q.questProgress(ctx.questLog, 'Nobody') === 0 && warnings.length === 1);
  warnings.length = 0;
  ex(ctx, { type: 'addQuestProgress', quest: '', amount: 1 });
  check('addQuestProgress with a blank name stays quiet',
    warnings.length === 0);
  ex(ctx, { type: 'setQuestProgress', quest: 'Defeat 3 enemies', amount: 2 });
  check('setQuestProgress writes the progress outright',
    Q.questProgress(ctx.questLog, 'Defeat 3 enemies') === 2);
  ex(ctx, { type: 'setQuestProgress', quest: 'Defeat 3 enemies', amount: 3 });
  check('setQuestProgress to the target completes the quest',
    Q.isQuestComplete(ctx.questLog, guardQuests, 'Defeat 3 enemies') === true);
  ex(ctx, { type: 'setQuestProgress', quest: 'Defeat 3 enemies', amount: 1 });
  check('setQuestProgress below the target un-completes the quest',
    Q.questProgress(ctx.questLog, 'Defeat 3 enemies') === 1 && Q.isQuestComplete(ctx.questLog, guardQuests, 'Defeat 3 enemies') === false);
  ex(ctx, { type: 'setQuestProgress', quest: 'Reach the goal', amount: 0 });
  check('setQuestProgress to 0 drops the entry and un-completes',
    Q.questProgress(ctx.questLog, 'Reach the goal') === 0 && Q.isQuestComplete(ctx.questLog, guardQuests, 'Reach the goal') === false);
  ex(ctx, { type: 'completeQuest', quest: 'Defeat 3 enemies' });
  check('completeQuest fills the progress to the target and marks done',
    Q.questProgress(ctx.questLog, 'Defeat 3 enemies') === 3 && Q.isQuestComplete(ctx.questLog, guardQuests, 'Defeat 3 enemies') === true);
  warnings.length = 0;
  ex(ctx, { type: 'completeQuest', quest: 'Nobody' });
  check('completeQuest with an unknown name warns and holds',
    warnings.length === 1);
  ex(ctx, { type: 'resetQuest', quest: 'Defeat 3 enemies' });
  check('resetQuest drops the progress and done flag',
    Q.questProgress(ctx.questLog, 'Defeat 3 enemies') === 0 && Q.isQuestComplete(ctx.questLog, guardQuests, 'Defeat 3 enemies') === false);
  ex(ctx, { type: 'readQuestProgress', quest: 'Collect 4 coins', varName: 'coinsFound' });
  check('readQuestProgress copies the progress into a variable',
    ctx.variables.coinsFound === 4);
  warnings.length = 0;
  ex(ctx, { type: 'readQuestProgress', quest: 'Nobody', varName: 'missing' });
  check('readQuestProgress with an unknown name warns and holds the variable',
    ctx.variables.missing === undefined && warnings.length === 1);
  warnings.length = 0;
  ex(ctx, { type: 'readQuestProgress', quest: 'Collect 4 coins', varName: '' });
  check('readQuestProgress with a blank variable stays quiet',
    warnings.length === 0);
  ex(ctx, { type: 'clearQuests' });
  check('clearQuests empties the whole quest log',
    Q.questProgress(ctx.questLog, 'Collect 4 coins') === 0 &&
    Q.questProgress(ctx.questLog, 'Reach the goal') === 0 &&
    JSON.stringify(Q.questList(ctx.questLog, guardQuests).map(q => q.progress)) === '[0,0,0]');
  const noModCtx = makeCtx();
  noModCtx.questLog = Q.createQuestRuntime();
  noModCtx.quests = guardQuests;
  noModCtx.questHooks = () => ({ warn: (m) => warnings.push(m) });
  warnings.length = 0;
  ex(noModCtx, { type: 'addQuestProgress', quest: 'Collect 4 coins', amount: 3 });
  check('quest actions stay quiet without the quest module',
    Q.questProgress(noModCtx.questLog, 'Collect 4 coins') === 0 && warnings.length === 0);
}

// --- achievement actions (P4 Advanced batch 10) ---
{
  const guardAchievements = [
    { id: 'ach_coins', name: 'Coin hoarder', description: 'Collect 100 coins across any number of runs.' },
    { id: 'ach_flawless', name: 'Flawless', description: 'Finish a level without dying.' },
    { id: 'ach_veteran', name: 'Veteran', description: 'Beat every level.' }
  ];
  const persists = [];
  function achievementCtx() {
    const ctx = makeCtx();
    ctx.achievementModule = A;
    ctx.achievementLog = A.createAchievementRuntime();
    ctx.achievements = guardAchievements;
    ctx.achievementHooks = () => ({ warn: (m) => warnings.push(m), persist: () => persists.push('persist') });
    return ctx;
  }
  const ctx = achievementCtx();
  warnings.length = 0;
  persists.length = 0;
  ex(ctx, { type: 'unlockAchievement', achievement: 'Coin hoarder' });
  check('unlockAchievement unlocks the achievement and persists',
    A.isAchievementUnlocked(ctx.achievementLog, 'Coin hoarder') === true &&
    A.achievementCount(ctx.achievementLog) === 1 && warnings.length === 0 && persists.length === 1);
  ex(ctx, { type: 'unlockAchievement', achievement: 'Coin hoarder' });
  check('unlockAchievement on an already-unlocked achievement changes nothing and does not persist again',
    A.achievementCount(ctx.achievementLog) === 1 && persists.length === 1);
  warnings.length = 0;
  ex(ctx, { type: 'unlockAchievement', achievement: 'Nobody' });
  check('unlockAchievement with an unknown name warns and holds',
    A.isAchievementUnlocked(ctx.achievementLog, 'Nobody') === false && warnings.length === 1);
  warnings.length = 0;
  ex(ctx, { type: 'unlockAchievement', achievement: '' });
  check('unlockAchievement with a blank name stays quiet',
    warnings.length === 0);
  ex(ctx, { type: 'lockAchievement', achievement: 'Coin hoarder' });
  check('lockAchievement locks the achievement again and persists',
    A.isAchievementUnlocked(ctx.achievementLog, 'Coin hoarder') === false &&
    A.achievementCount(ctx.achievementLog) === 0 && persists.length === 2);
  warnings.length = 0;
  ex(ctx, { type: 'lockAchievement', achievement: 'Nobody' });
  check('lockAchievement with an unknown name warns and holds',
    warnings.length === 1);
  ex(ctx, { type: 'unlockAchievement', achievement: 'Flawless' });
  ex(ctx, { type: 'unlockAchievement', achievement: 'Veteran' });
  ex(ctx, { type: 'readAchievementCount', varName: 'trophies' });
  check('readAchievementCount copies the count into a variable',
    ctx.variables.trophies === 2);
  warnings.length = 0;
  ex(ctx, { type: 'readAchievementCount', varName: '' });
  check('readAchievementCount with a blank variable stays quiet',
    warnings.length === 0);
  ex(ctx, { type: 'resetAchievements' });
  check('resetAchievements locks every achievement and persists',
    A.achievementCount(ctx.achievementLog) === 0 &&
    A.isAchievementUnlocked(ctx.achievementLog, 'Flawless') === false && persists.length === 5);
  const noModCtx = makeCtx();
  noModCtx.achievementLog = A.createAchievementRuntime();
  noModCtx.achievements = guardAchievements;
  noModCtx.achievementHooks = () => ({ warn: (m) => warnings.push(m), persist: () => persists.push('persist') });
  warnings.length = 0;
  persists.length = 0;
  ex(noModCtx, { type: 'unlockAchievement', achievement: 'Coin hoarder' });
  check('achievement actions stay quiet without the achievement module',
    A.achievementCount(noModCtx.achievementLog) === 0 && warnings.length === 0 && persists.length === 0);
}

// --- cutscene actions (P4 Advanced batch 11) ---
{
  const guardCutscenes = [
    { id: 'cts_intro', name: 'Intro', description: 'The opening crawl.',
      steps: [
        { kind: 'text', object: 'Caption', text: 'A long time ago...', seconds: 2 },
        { kind: 'move', object: 'Hero', x: 400, y: 300, seconds: 2 },
        { kind: 'sound', sound: 'Fanfare' },
        { kind: 'wait', seconds: 1 },
        { kind: 'scene', scene: 'Level 1' }
      ] },
    { id: 'cts_ending', name: 'Ending', description: 'The end.',
      steps: [{ kind: 'wait', seconds: 1 }] }
  ];
  function cutsceneCtx() {
    const ctx = makeCtx();
    ctx.cutsceneModule = Cut;
    ctx.cutscene = Cut.createCutsceneRuntime();
    ctx.cutscenes = guardCutscenes;
    ctx.cutsceneHooks = () => ({ warn: (m) => warnings.push(m) });
    return ctx;
  }
  const ctx = cutsceneCtx();
  warnings.length = 0;
  ex(ctx, { type: 'playCutscene', cutscene: 'Intro' });
  check('playCutscene starts the named cutscene',
    Cut.isCutscenePlaying(ctx.cutscene, 'Intro') === true && warnings.length === 0);
  ex(ctx, { type: 'playCutscene', cutscene: 'Ending' });
  check('playCutscene replaces the running cutscene',
    Cut.isCutscenePlaying(ctx.cutscene, 'Ending') === true &&
    Cut.isCutscenePlaying(ctx.cutscene, 'Intro') === false);
  warnings.length = 0;
  ex(ctx, { type: 'playCutscene', cutscene: 'Nobody' });
  check('playCutscene with an unknown name warns and holds',
    Cut.isCutscenePlaying(ctx.cutscene, 'Ending') === true && warnings.length === 1);
  warnings.length = 0;
  ex(ctx, { type: 'playCutscene', cutscene: '' });
  check('playCutscene with a blank name stays quiet',
    Cut.isCutscenePlaying(ctx.cutscene, 'Ending') === true && warnings.length === 0);
  ex(ctx, { type: 'stopCutscene', cutscene: 'Intro' });
  check('stopCutscene with a non-playing name leaves the running cutscene alone',
    Cut.isCutscenePlaying(ctx.cutscene, 'Ending') === true);
  ex(ctx, { type: 'stopCutscene', cutscene: '' });
  check('stopCutscene with a blank name stops whichever is playing and counts as finished',
    Cut.isCutscenePlaying(ctx.cutscene, '') === false &&
    Cut.isCutsceneFinished(ctx.cutscene, 'Ending') === true);
  warnings.length = 0;
  ex(ctx, { type: 'stopCutscene', cutscene: 'Nobody' });
  check('stopCutscene with an unknown name warns and holds',
    warnings.length === 1);
  const noModCtx = makeCtx();
  noModCtx.cutscene = Cut.createCutsceneRuntime();
  noModCtx.cutscenes = guardCutscenes;
  noModCtx.cutsceneHooks = () => ({ warn: (m) => warnings.push(m) });
  warnings.length = 0;
  ex(noModCtx, { type: 'playCutscene', cutscene: 'Intro' });
  check('cutscene actions stay quiet without the cutscene module',
    Cut.isCutscenePlaying(noModCtx.cutscene, 'Intro') === false && warnings.length === 0);
}

// --- high-score actions (P4 Advanced batch 12) ---
{
  const guardConfig = { maxEntries: 3, defaultName: 'Player' };
  const persists = [];
  function highScoreCtx() {
    const ctx = makeCtx();
    ctx.highScoreModule = HS;
    ctx.highScoreTable = HS.createHighScoreRuntime([], guardConfig);
    ctx.highScoreConfig = guardConfig;
    ctx.highScoreHooks = () => ({ warn: (m) => warnings.push(m), persist: () => persists.push('persist') });
    return ctx;
  }
  const ctx = highScoreCtx();
  warnings.length = 0;
  persists.length = 0;
  ex(ctx, { type: 'submitScore', score: 100, name: 'Alex' });
  check('submitScore submits the score and persists',
    HS.highScoreCount(ctx.highScoreTable) === 1 &&
    HS.readHighScore(ctx.highScoreTable, 1).name === 'Alex' &&
    HS.readHighScore(ctx.highScoreTable, 1).score === 100 &&
    warnings.length === 0 && persists.length === 1);
  const exprCtx = highScoreCtx();
  exprCtx.expr = (v) => (v === 'score' ? 150 : Number(v));
  ex(exprCtx, { type: 'submitScore', score: 'score', name: 'Bob' });
  check('submitScore takes the score through the expression evaluator',
    HS.highScoreCount(exprCtx.highScoreTable) === 1 &&
    HS.readHighScore(exprCtx.highScoreTable, 1).name === 'Bob' &&
    HS.readHighScore(exprCtx.highScoreTable, 1).score === 150);
  ex(ctx, { type: 'submitScore', score: 150, name: 'Bob' });
  ex(ctx, { type: 'submitScore', score: 200, name: '' });
  check('submitScore with a blank name uses the default name',
    HS.readHighScore(ctx.highScoreTable, 1).name === 'Player' &&
    HS.readHighScore(ctx.highScoreTable, 1).score === 200);
  ex(ctx, { type: 'submitScore', score: 10, name: 'Dee' });
  check('submitScore holds on a score that does not make a full table',
    HS.highScoreCount(ctx.highScoreTable) === 3 &&
    HS.readHighScore(ctx.highScoreTable, 3).name === 'Alex' && persists.length === 4);
  ex(ctx, { type: 'readHighScore', rank: 1, varName: 'topScore', nameVarName: 'topName' });
  check('readHighScore copies the rank 1 score and name into variables',
    ctx.variables.topScore === 200 && ctx.variables.topName === 'Player');
  ex(ctx, { type: 'readHighScore', rank: 3, varName: 'thirdScore', nameVarName: '' });
  check('readHighScore with a blank name variable writes only the score',
    ctx.variables.thirdScore === 100 && ctx.variables.topName === 'Player');
  warnings.length = 0;
  ex(ctx, { type: 'readHighScore', rank: 9, varName: 'noScore', nameVarName: 'noName' });
  check('readHighScore past the end of the table writes nothing',
    ctx.variables.noScore === undefined && ctx.variables.noName === undefined);
  ex(ctx, { type: 'clearHighScores' });
  check('clearHighScores empties the table and persists',
    HS.highScoreCount(ctx.highScoreTable) === 0 && persists.length === 5);
  const noModCtx = makeCtx();
  noModCtx.highScoreTable = HS.createHighScoreRuntime([], guardConfig);
  noModCtx.highScoreConfig = guardConfig;
  noModCtx.highScoreHooks = () => ({ warn: (m) => warnings.push(m), persist: () => persists.push('persist') });
  warnings.length = 0;
  persists.length = 0;
  ex(noModCtx, { type: 'submitScore', score: 100, name: 'Alex' });
  check('high-score actions stay quiet without the high-score module',
    HS.highScoreCount(noModCtx.highScoreTable) === 0 && warnings.length === 0 && persists.length === 0);
}

// --- time-scale actions (P4 Advanced batch 13) ---
{
  function timeScaleCtx() {
    const ctx = makeCtx();
    ctx.timeScaleModule = TS;
    ctx.timeScale = TS.createTimeScaleRuntime();
    ctx.timeScaleHooks = () => ({ warn: (m) => warnings.push(m) });
    return ctx;
  }
  const ctx = timeScaleCtx();
  warnings.length = 0;
  ex(ctx, { type: 'setTimeScale', scale: 0.5 });
  check('setTimeScale applies slow motion',
    ctx.timeScale.scale === 0.5, `scale=${ctx.timeScale.scale}`);
  ex(ctx, { type: 'setTimeScale', scale: '0.25' });
  check('setTimeScale takes the scale through an expression',
    ctx.timeScale.scale === 0.25, `scale=${ctx.timeScale.scale}`);
  ex(ctx, { type: 'setTimeScale', scale: 10 });
  check('setTimeScale clamps above 4', ctx.timeScale.scale === 4);
  ex(ctx, { type: 'setTimeScale', scale: -2 });
  check('setTimeScale clamps below 0', ctx.timeScale.scale === 0);
  ex(ctx, { type: 'setTimeScale', scale: 'fast' });
  check('setTimeScale warns and holds on a bad expression (no freeze on a typo)',
    ctx.timeScale.scale === 0 && warnings.length === 1 && /not a number/.test(warnings[0]),
    JSON.stringify(warnings));
  ex(ctx, { type: 'setTimeScale', scale: '' });
  check('setTimeScale warns and holds on a blank scale',
    ctx.timeScale.scale === 0 && warnings.length === 2, JSON.stringify(warnings));
  ex(ctx, { type: 'resetTimeScale' });
  check('resetTimeScale returns to normal speed',
    ctx.timeScale.scale === 1, `scale=${ctx.timeScale.scale}`);
  ex(ctx, { type: 'setTimeScale', scale: 2 });
  ex(ctx, { type: 'readTimeScale', varName: 'gameSpeed' });
  check('readTimeScale copies the scale into a variable',
    ctx.variables.gameSpeed === 2, JSON.stringify(ctx.variables));
  ex(ctx, { type: 'readTimeScale', varName: '' });
  check('readTimeScale with a blank variable writes nothing',
    ctx.variables.gameSpeed === 2 && !('' in ctx.variables));
  const noModCtx = makeCtx();
  noModCtx.timeScale = TS.createTimeScaleRuntime();
  noModCtx.timeScaleHooks = () => ({ warn: (m) => warnings.push(m) });
  warnings.length = 0;
  ex(noModCtx, { type: 'setTimeScale', scale: 0.5 });
  ex(noModCtx, { type: 'readTimeScale', varName: 'gameSpeed' });
  check('time-scale actions stay quiet without the time-scale module',
    noModCtx.timeScale.scale === 1 && noModCtx.variables.gameSpeed === undefined && warnings.length === 0);
  const noRtCtx = makeCtx();
  noRtCtx.timeScaleModule = TS;
  noRtCtx.timeScale = null;
  noRtCtx.timeScaleHooks = () => ({ warn: (m) => warnings.push(m) });
  ex(noRtCtx, { type: 'readTimeScale', varName: 'gameSpeed' });
  check('readTimeScale without a runtime reads as 1',
    noRtCtx.variables.gameSpeed === 1, JSON.stringify(noRtCtx.variables));
}

// --- transition actions (P4 Advanced batch 14) ---
{
  function transitionCtx() {
    const ctx = makeCtx();
    const switches = [];
    ctx.transitionModule = TR;
    ctx.transition = TR.createTransitionRuntime();
    ctx.transitionConfig = { effect: 'fade', duration: 0.5 };
    ctx.transitionSwitches = switches;
    ctx.transitionHooks = () => ({
      warn: (m) => warnings.push(m),
      paused: false,
      sceneExists: (s) => ['Level 2', 'Menu', '1'].indexOf(String(s)) !== -1,
      switchScene: (s) => { switches.push(s); return ['Level 2', 'Menu', '1'].indexOf(String(s)) !== -1; }
    });
    return ctx;
  }
  const ctx = transitionCtx();
  warnings.length = 0;
  ex(ctx, { type: 'transitionToScene', sceneId: 1, effect: 'default', duration: '' });
  check('transitionToScene starts a fade with the configured defaults on a blank duration',
    ctx.transition.phase === 'out' && ctx.transition.effect === 'fade' &&
    ctx.transition.duration === 0.5 && ctx.transition.pendingScene === '1',
    JSON.stringify(ctx.transition));
  ex(ctx, { type: 'transitionToScene', sceneId: 'Level 2', effect: 'wipe', duration: 1.2 });
  check('transitionToScene takes the effect + duration overrides (a variable can feed the duration)',
    ctx.transition.phase === 'out' && ctx.transition.effect === 'wipe' &&
    ctx.transition.duration === 1.2 && ctx.transition.pendingScene === 'Level 2',
    JSON.stringify(ctx.transition));
  ex(ctx, { type: 'transitionToScene', sceneId: 'Level 2', effect: 'cut', duration: '' });
  check('transitionToScene with a cut effect switches at once and marks finished',
    ctx.transition.phase === 'idle' && ctx.transitionSwitches.length === 1 &&
    ctx.transitionSwitches[0] === 'Level 2' && TR.isTransitionFinished(ctx.transition, 'Level 2'));
  ex(ctx, { type: 'transitionToScene', sceneId: 'Level 2', effect: 'default', duration: 0 });
  check('transitionToScene with an explicit 0 duration switches at once',
    ctx.transition.phase === 'idle' && ctx.transitionSwitches.length === 2);
  ex(ctx, { type: 'transitionToScene', sceneId: 'Nope', effect: 'default', duration: '' });
  check('transitionToScene warns and holds on an unknown scene',
    ctx.transition.phase === 'idle' && warnings.length === 1 && /no scene named/.test(warnings[0]),
    JSON.stringify(warnings));
  ex(ctx, { type: 'transitionToScene', sceneId: 'Level 2', effect: 'default', duration: 'fast' });
  check('transitionToScene warns and holds on a bad duration expression',
    ctx.transition.phase === 'idle' && warnings.length === 2 && /duration is not a number/.test(warnings[1]),
    JSON.stringify(warnings));
  ex(ctx, { type: 'transitionToScene', sceneId: '', effect: 'default', duration: '' });
  check('transitionToScene with a blank scene stays quiet',
    ctx.transition.phase === 'idle' && warnings.length === 2);
  ex(ctx, { type: 'transitionToScene', sceneId: 'Level 2', effect: 'default', duration: '' });
  ex(ctx, { type: 'cancelTransition' });
  check('cancelTransition aborts the out half and stays in the current scene',
    ctx.transition.phase === 'idle' && ctx.transitionSwitches.length === 2 &&
    !TR.isTransitionFinished(ctx.transition, 'Level 2'));
  ex(ctx, { type: 'cancelTransition' });
  check('cancelTransition with nothing playing does nothing',
    ctx.transition.phase === 'idle' && warnings.length === 2);
  const noModCtx = makeCtx();
  noModCtx.transition = TR.createTransitionRuntime();
  noModCtx.transitionConfig = { effect: 'fade', duration: 0.5 };
  noModCtx.transitionHooks = () => ({ warn: (m) => warnings.push(m) });
  warnings.length = 0;
  ex(noModCtx, { type: 'transitionToScene', sceneId: 'Level 2', effect: 'default', duration: '' });
  ex(noModCtx, { type: 'cancelTransition' });
  check('transition actions stay quiet without the transition module',
    noModCtx.transition.phase === 'idle' && warnings.length === 0);
  const noRtCtx = makeCtx();
  noRtCtx.transitionModule = TR;
  noRtCtx.transition = null;
  noRtCtx.transitionConfig = { effect: 'fade', duration: 0.5 };
  noRtCtx.transitionHooks = () => ({ warn: (m) => warnings.push(m) });
  ex(noRtCtx, { type: 'transitionToScene', sceneId: 'Level 2', effect: 'default', duration: '' });
  check('transitionToScene without a runtime stays quiet',
    warnings.length === 0);
}

// --- camera-feel actions (P4 Advanced batch 15) ---
{
  function camerafeelCtx() {
    const ctx = makeCtx();
    const sceneFeel = { smoothing: 0.5, deadzoneW: 0, deadzoneH: 0, bounds: null };
    let feel = CF.freshCameraFeel(sceneFeel);
    ctx.cameraFeelModule = CF;
    ctx.cameraFeel = () => feel;
    ctx.resetCameraFeel = () => { feel = CF.freshCameraFeel(sceneFeel); };
    return ctx;
  }
  const ctx = camerafeelCtx();
  warnings.length = 0;
  ex(ctx, { type: 'setCameraSmoothing', smoothing: 0.9 });
  check('setCameraSmoothing writes the smoothing onto the live feel record',
    ctx.cameraFeel().smoothing === 0.9, JSON.stringify(ctx.cameraFeel()));
  ex(ctx, { type: 'setCameraSmoothing', smoothing: 2 });
  check('setCameraSmoothing clamps past the 0.95 ceiling',
    ctx.cameraFeel().smoothing === 0.95, JSON.stringify(ctx.cameraFeel()));
  ex(ctx, { type: 'setCameraSmoothing', smoothing: 'fast' });
  check('setCameraSmoothing warns and holds on a bad expression',
    ctx.cameraFeel().smoothing === 0.95 && warnings.length === 1 && /not a number/.test(warnings[0]),
    JSON.stringify(warnings));
  ex(ctx, { type: 'setCameraDeadzone', width: 200, height: 100 });
  check('setCameraDeadzone writes the deadzone size',
    ctx.cameraFeel().deadzoneW === 200 && ctx.cameraFeel().deadzoneH === 100,
    JSON.stringify(ctx.cameraFeel()));
  ex(ctx, { type: 'setCameraDeadzone', width: -10, height: 'big' });
  check('setCameraDeadzone warns and holds on a bad size',
    ctx.cameraFeel().deadzoneW === 200 && ctx.cameraFeel().deadzoneH === 100 &&
    warnings.length === 2 && /not a number/.test(warnings[1]),
    JSON.stringify(warnings));
  ex(ctx, { type: 'setCameraBounds', minX: 0, minY: 0, maxX: 1200, maxY: 900 });
  check('setCameraBounds writes the bounds rect',
    JSON.stringify(ctx.cameraFeel().bounds) === JSON.stringify({ minX: 0, minY: 0, maxX: 1200, maxY: 900 }),
    JSON.stringify(ctx.cameraFeel()));
  ex(ctx, { type: 'setCameraBounds', minX: 500, minY: 0, maxX: 100, maxY: 900 });
  check('setCameraBounds warns and holds on a backwards rect',
    JSON.stringify(ctx.cameraFeel().bounds) === JSON.stringify({ minX: 0, minY: 0, maxX: 1200, maxY: 900 }) &&
    warnings.length === 3 && /not a valid rectangle/.test(warnings[2]),
    JSON.stringify(warnings));
  ex(ctx, { type: 'clearCameraBounds' });
  check('clearCameraBounds drops the bounds rect',
    ctx.cameraFeel().bounds === null, JSON.stringify(ctx.cameraFeel()));
  ex(ctx, { type: 'resetCamera' });
  check('resetCamera restores the scene feel (smoothing 0.5, no bounds, no deadzone)',
    ctx.cameraFeel().smoothing === 0.5 && ctx.cameraFeel().deadzoneW === 0 &&
    ctx.cameraFeel().bounds === null && ctx.camera.followTarget === '',
    JSON.stringify(ctx.cameraFeel()));
  const noModCtx = makeCtx();
  noModCtx.cameraFeel = () => ({ smoothing: 0.5, deadzoneW: 0, deadzoneH: 0, bounds: null });
  warnings.length = 0;
  ex(noModCtx, { type: 'setCameraSmoothing', smoothing: 0.9 });
  ex(noModCtx, { type: 'setCameraDeadzone', width: 100, height: 50 });
  ex(noModCtx, { type: 'setCameraBounds', minX: 0, minY: 0, maxX: 100, maxY: 100 });
  ex(noModCtx, { type: 'clearCameraBounds' });
  check('camera-feel actions stay quiet without the camera-feel module',
    noModCtx.cameraFeel().smoothing === 0.5 && noModCtx.cameraFeel().bounds === null &&
    warnings.length === 0);
  const noFeelCtx = makeCtx();
  noFeelCtx.cameraFeelModule = CF;
  noFeelCtx.cameraFeel = () => null;
  warnings.length = 0;
  ex(noFeelCtx, { type: 'setCameraSmoothing', smoothing: 0.9 });
  ex(noFeelCtx, { type: 'clearCameraBounds' });
  check('camera-feel actions stay quiet without a live feel record',
    warnings.length === 0);
}

// --- parallax actions (P4 Advanced batch 16) ---
{
  function parallaxCtx() {
    const ctx = makeCtx();
    ctx.parallaxModule = PX;
    return ctx;
  }
  const ctx = parallaxCtx();
  const wall = ctx.named('wall')[0];
  warnings.length = 0;
  ex(ctx, { type: 'setParallax', targetObject: 'wall', parallaxX: 0.5, parallaxY: 0.25 });
  check('setParallax writes the factors onto the live object',
    wall.parallaxX === 0.5 && wall.parallaxY === 0.25, JSON.stringify(wall));
  ex(ctx, { type: 'setParallax', targetObject: 'wall', parallaxX: 3, parallaxY: -1 });
  check('setParallax clamps past the 0..2 range',
    wall.parallaxX === 2 && wall.parallaxY === 0, JSON.stringify(wall));
  ex(ctx, { type: 'setParallax', targetObject: 'wall', parallaxX: 'far', parallaxY: 0.5 });
  check('setParallax warns and holds on a bad expression',
    wall.parallaxX === 2 && wall.parallaxY === 0 &&
    warnings.length === 1 && /not a number/.test(warnings[0]),
    JSON.stringify(warnings));
  ex(ctx, { type: 'setParallax', targetObject: 'wall', parallaxX: 0, parallaxY: 0 });
  check('setParallax pins the object to the camera at 0/0',
    wall.parallaxX === 0 && wall.parallaxY === 0, JSON.stringify(wall));
  const box = ctx.named('box')[0];
  ex(ctx, { type: 'setParallax', targetObject: 'box', parallaxX: 0.75, parallaxY: 0.75 });
  check('setParallax writes a second object without touching the first',
    box.parallaxX === 0.75 && box.parallaxY === 0.75 && wall.parallaxX === 0,
    JSON.stringify({ wall, box }));
  warnings.length = 0;
  ex(ctx, { type: 'setParallax', targetObject: 'ghost2', parallaxX: 0.5, parallaxY: 0.5 });
  check('setParallax on a missing object stays quiet',
    warnings.length === 0);
  const noModCtx = makeCtx();
  warnings.length = 0;
  ex(noModCtx, { type: 'setParallax', targetObject: 'wall', parallaxX: 0.5, parallaxY: 0.5 });
  check('setParallax stays quiet without the parallax module',
    noModCtx.named('wall')[0].parallaxX === undefined && warnings.length === 0);
}

// --- positional audio actions (P4 Advanced batch 17) ---
// The stub world puts the listener at the screen center (400, 300):
// camera (0, 0, zoom 1) over an 800x600 canvas.
{
  function near(a, b) { return Math.abs(a - b) < 1e-9; }
  function spatialCtx() {
    const ctx = makeCtx();
    ctx.spatialAudioModule = SA;
    return ctx;
  }
  // wall center (120, 40) against listener (400, 300): dx -280, dy -260.
  const wallDist = Math.sqrt(280 * 280 + 260 * 260);
  const wallMix = 1 - wallDist / 600;
  {
    const ctx = spatialCtx();
    const played = [];
    ctx.playSound = (data) => { played.push(data); };
    const block = { type: 'playSoundAtPosition', atObject: 'wall', maxDistance: 600, volume: 0.5, frequency: 440, duration: 0.2, waveform: 'square', bus: 'sfx', pitch: 1 };
    ex(ctx, block);
    check('playSoundAtPosition mixes an object source by distance and pan',
      played.length === 1 && near(played[0].volume, 0.5 * wallMix) && near(played[0].pan, -280 / 600),
      JSON.stringify(played[0]));
    check('playSoundAtPosition passes the sound fields through untouched',
      played[0].frequency === 440 && played[0].duration === 0.2 &&
      played[0].waveform === 'square' && played[0].bus === 'sfx' && played[0].pitch === 1,
      JSON.stringify(played[0]));
    check('playSoundAtPosition never mutates the block record',
      block.volume === 0.5 && block.pan === undefined, JSON.stringify(block));
  }
  {
    const ctx = spatialCtx();
    const played = [];
    ctx.playSound = (data) => { played.push(data); };
    ex(ctx, { type: 'playSoundAtPosition', atObject: '', posX: 400, posY: 300, maxDistance: 600, volume: 0.5 });
    check('playSoundAtPosition at the listener plays full volume, centered',
      played.length === 1 && played[0].volume === 0.5 && played[0].pan === 0,
      JSON.stringify(played[0]));
  }
  {
    const ctx = spatialCtx();
    const played = [];
    ctx.playSound = (data) => { played.push(data); };
    ex(ctx, { type: 'playSoundAtPosition', atObject: '', posX: 2000, posY: 300, maxDistance: 600, volume: 0.5 });
    check('playSoundAtPosition past the hear-within distance plays nothing (no voice taken)',
      played.length === 0);
  }
  {
    const ctx = spatialCtx();
    const played = [];
    ctx.playSound = (data) => { played.push(data); };
    warnings.length = 0;
    ex(ctx, { type: 'playSoundAtPosition', atObject: 'wall', maxDistance: 'far', volume: 0.5 });
    check('playSoundAtPosition warns and holds on a bad distance',
      played.length === 0 && warnings.length === 1 && /not a number/.test(warnings[0]),
      JSON.stringify(warnings));
  }
  {
    const ctx = spatialCtx();
    const played = [];
    ctx.playSound = (data) => { played.push(data); };
    warnings.length = 0;
    ex(ctx, { type: 'playSoundAtPosition', atObject: '', posX: 'far', posY: 300, maxDistance: 600, volume: 0.5 });
    check('playSoundAtPosition warns and holds on a bad position',
      played.length === 0 && warnings.length === 1 && /not a number/.test(warnings[0]),
      JSON.stringify(warnings));
  }
  {
    const ctx = spatialCtx();
    const played = [];
    ctx.playSound = (data) => { played.push(data); };
    warnings.length = 0;
    ex(ctx, { type: 'playSoundAtPosition', atObject: 'ghost2', maxDistance: 600, volume: 0.5 });
    check('playSoundAtPosition on a missing object stays quiet',
      played.length === 0 && warnings.length === 0);
  }
  {
    const ctx = spatialCtx();
    const played = [];
    ctx.playSound = (data) => { played.push(data); };
    ex(ctx, { type: 'playSoundAtPosition', atObject: 'wall', maxDistance: 400, volume: 0.4 });
    check('playSoundAtPosition respects a shorter hear-within distance',
      played.length === 1 && near(played[0].volume, 0.4 * (1 - wallDist / 400)) &&
      near(played[0].pan, -280 / 400), JSON.stringify(played[0]));
  }
  {
    const ctx = spatialCtx();
    const played = [];
    ctx.playSound = (data) => { played.push(data); };
    ex(ctx, { type: 'playSoundAtPosition', atObject: '', posX: 400, posY: 300, maxDistance: 600 });
    check('playSoundAtPosition without a volume reads the 0.3 default',
      played.length === 1 && played[0].volume === 0.3, JSON.stringify(played[0]));
  }
  {
    const ctx = makeCtx();
    const played = [];
    ctx.playSound = (data) => { played.push(data); };
    warnings.length = 0;
    ex(ctx, { type: 'playSoundAtPosition', atObject: 'wall', maxDistance: 600, volume: 0.5 });
    check('playSoundAtPosition stays quiet without the spatial module',
      played.length === 0 && warnings.length === 0);
  }
}

// --- pathfinding actions (P4 Advanced batch 18) ---
// The stub world is 800x600 with an empty tilemap named 'map'; the
// hero (id 1) sits at (10, 20) 40x40, center (30, 40) in cell (0, 1).
{
  function pathCtx() {
    const ctx = makeCtx();
    ctx.tiles = Tiles;
    ctx.pathfindModule = PF;
    return ctx;
  }
  function mazeMap(ctx) {
    // 10x10 wall down column 4, rows 0..7 (gap at rows 8, 9).
    const map = ctx.named('map')[0];
    const tiles = new Array(100).fill(-1);
    for (let r = 0; r < 8; r++) tiles[r * 10 + 4] = 0;
    map.tileSize = 32; map.cols = 10; map.rows = 10;
    map.tiles = tiles; map.solidTiles = [0];
    return map;
  }
  {
    const ctx = pathCtx();
    const hero = ctx.named('hero')[0];
    ex(ctx, { type: 'followPath', targetObject: 'hero', destinationObject: 'wall', posX: 0, posY: 0, speed: 100 });
    check('followPath plans a path to the destination object center',
      !!hero._path && hero._path.points.length >= 2 &&
      JSON.stringify(hero._path.points[0]) === '{"x":16,"y":48}' &&
      JSON.stringify(hero._path.points[hero._path.points.length - 1]) === '{"x":112,"y":48}' &&
      hero._path.speed === 100 && hero._path.done === false,
      JSON.stringify(hero._path));
  }
  {
    const ctx = pathCtx();
    const hero = ctx.named('hero')[0];
    ex(ctx, { type: 'followPath', targetObject: 'hero', destinationObject: '', posX: 400, posY: 300, speed: 100 });
    check('followPath plans a path to an X/Y point when no object is named',
      !!hero._path &&
      JSON.stringify(hero._path.points[hero._path.points.length - 1]) === '{"x":400,"y":304}',
      JSON.stringify(hero._path && hero._path.points));
  }
  {
    const ctx = pathCtx();
    const map = mazeMap(ctx);
    const hero = ctx.named('hero')[0];
    ex(ctx, { type: 'followPath', targetObject: 'hero', destinationObject: '', posX: 304, posY: 304, speed: 100 });
    const grid = PF.buildWalkGrid(800, 600, [map], Tiles);
    check('followPath routes around a tilemap wall through the gap',
      !!hero._path && hero._path.points.length === 3 &&
      JSON.stringify(hero._path.points[0]) === '{"x":16,"y":48}' &&
      JSON.stringify(hero._path.points[1]) === '{"x":112,"y":272}' &&
      JSON.stringify(hero._path.points[2]) === '{"x":304,"y":304}' &&
      hero._path.points.every(function (p) {
        const c = PF.cellOf(grid, p.x, p.y);
        return !PF.isBlocked(grid, c.col, c.row);
      }) &&
      hero._path.points.slice(0, -1).every(function (p, i) {
        return PF.hasLineOfSight(grid, p, hero._path.points[i + 1]);
      }),
      JSON.stringify(hero._path && hero._path.points));
  }
  {
    const ctx = pathCtx();
    const hero = ctx.named('hero')[0];
    warnings.length = 0;
    ex(ctx, { type: 'followPath', targetObject: 'hero', destinationObject: 'wall', speed: 'fast' });
    check('followPath warns and holds on a bad speed',
      !hero._path && warnings.length === 1 && /not a number/.test(warnings[0]),
      JSON.stringify(warnings));
  }
  {
    const ctx = pathCtx();
    const hero = ctx.named('hero')[0];
    warnings.length = 0;
    ex(ctx, { type: 'followPath', targetObject: 'hero', destinationObject: '', posX: 'far', posY: 300, speed: 100 });
    check('followPath warns and holds on a bad destination',
      !hero._path && warnings.length === 1 && /not a number/.test(warnings[0]),
      JSON.stringify(warnings));
  }
  {
    const ctx = pathCtx();
    mazeMap(ctx);
    const hero = ctx.named('hero')[0];
    warnings.length = 0;
    ex(ctx, { type: 'followPath', targetObject: 'hero', destinationObject: '', posX: 144, posY: 16, speed: 100 });
    check('followPath warns and holds when the destination is inside a wall',
      !hero._path && warnings.length === 1 && /no path/.test(warnings[0]),
      JSON.stringify(warnings));
  }
  {
    const ctx = pathCtx();
    warnings.length = 0;
    ex(ctx, { type: 'followPath', targetObject: 'ghost2', destinationObject: 'wall', speed: 100 });
    check('followPath on a missing mover stays quiet',
      warnings.length === 0);
  }
  {
    const ctx = pathCtx();
    const hero = ctx.named('hero')[0];
    warnings.length = 0;
    ex(ctx, { type: 'followPath', targetObject: 'hero', destinationObject: 'ghost2', speed: 100 });
    check('followPath on a missing destination object stays quiet',
      !hero._path && warnings.length === 0);
  }
  {
    const ctx = pathCtx();
    const hero = ctx.named('hero')[0];
    ex(ctx, { type: 'followPath', targetObject: 'hero', destinationObject: 'wall', speed: 100 });
    check('followPath starts a walking path', PF.hasPath(hero) === true);
    ex(ctx, { type: 'stopPath', targetObject: 'hero' });
    check('stopPath clears the walking path',
      !hero._path && PF.hasPath(hero) === false && PF.pathFinished(hero) === false);
  }
  {
    const ctx = pathCtx();
    const hero = ctx.named('hero')[0];
    ex(ctx, { type: 'followPath', targetObject: 'hero', destinationObject: 'wall', speed: 100 });
    const firstEnd = hero._path.points[hero._path.points.length - 1];
    ex(ctx, { type: 'followPath', targetObject: 'hero', destinationObject: '', posX: 700, posY: 500, speed: 200 });
    const secondEnd = hero._path.points[hero._path.points.length - 1];
    check('a new followPath replaces the path already walking',
      hero._path.speed === 200 && JSON.stringify(secondEnd) !== JSON.stringify(firstEnd),
      JSON.stringify({ firstEnd, secondEnd }));
  }
  {
    const ctx = makeCtx();
    const hero = ctx.named('hero')[0];
    warnings.length = 0;
    ex(ctx, { type: 'followPath', targetObject: 'hero', destinationObject: 'wall', speed: 100 });
    check('followPath stays quiet without the pathfind module',
      !hero._path && warnings.length === 0);
    ex(ctx, { type: 'stopPath', targetObject: 'hero' });
    check('stopPath stays quiet without the pathfind module', warnings.length === 0);
  }
}

// --- AI behavior actions (P4 Advanced batch 19) ---
// The stub world is 800x600; the hero (id 1) sits at (10, 20) 40x40,
// center (30, 40); 'wall' is the chase target.
{
  function aiCtx() {
    const ctx = makeCtx();
    ctx.tiles = Tiles;
    ctx.pathfindModule = PF;
    ctx.aiModule = AI;
    return ctx;
  }
  {
    const ctx = aiCtx();
    const hero = ctx.named('hero')[0];
    ex(ctx, { type: 'followPath', targetObject: 'hero', destinationObject: 'wall', speed: 100 });
    check('setAiBehavior starts from a walking path', PF.hasPath(hero) === true);
    ex(ctx, { type: 'setAiBehavior', targetObject: 'hero', behavior: 'chase', targetName: 'wall', speed: 200, range: 400, patrolA: '', patrolB: '' });
    check('setAiBehavior writes the behavior record and stops the walking path',
      !!hero._ai && hero._ai.behavior === 'chase' && hero._ai.target === 'wall' &&
      hero._ai.speed === 200 && hero._ai.range === 400 &&
      hero._ai.homeX === 30 && hero._ai.homeY === 40 && !hero._path,
      JSON.stringify(hero._ai));
  }
  {
    const ctx = aiCtx();
    const hero = ctx.named('hero')[0];
    ex(ctx, { type: 'setAiBehavior', targetObject: 'hero', behavior: 'patrol', targetName: '', speed: 150, range: 300, patrolA: 'wall', patrolB: 'hero' });
    check('setAiBehavior patrol records both patrol points',
      !!hero._ai && hero._ai.behavior === 'patrol' && hero._ai.patrolA === 'wall' &&
      hero._ai.patrolB === 'hero' && hero._ai.speed === 150);
  }
  {
    const ctx = aiCtx();
    const hero = ctx.named('hero')[0];
    ex(ctx, { type: 'setAiBehavior', targetObject: 'hero', behavior: 'wander', targetName: '', speed: 100, range: 200, patrolA: '', patrolB: '' });
    ex(ctx, { type: 'followPath', targetObject: 'hero', destinationObject: 'wall', speed: 100 });
    check('a wander record survives a followPath (the brain keeps the behavior)',
      !!hero._ai && hero._ai.behavior === 'wander' && PF.hasPath(hero) === true);
    ex(ctx, { type: 'setAiBehavior', targetObject: 'hero', behavior: 'none', targetName: '', speed: 100, range: 300, patrolA: '', patrolB: '' });
    check("setAiBehavior 'none' clears the record and stops the walking path",
      !hero._ai && !hero._path);
  }
  {
    const ctx = aiCtx();
    const hero = ctx.named('hero')[0];
    warnings.length = 0;
    ex(ctx, { type: 'setAiBehavior', targetObject: 'hero', behavior: 'chase', targetName: 'wall', speed: 'fast', range: 300, patrolA: '', patrolB: '' });
    check('setAiBehavior warns and holds on a bad speed',
      !hero._ai && warnings.length === 1 && /not a number/.test(warnings[0]),
      JSON.stringify(warnings));
  }
  {
    const ctx = aiCtx();
    const hero = ctx.named('hero')[0];
    warnings.length = 0;
    ex(ctx, { type: 'setAiBehavior', targetObject: 'hero', behavior: 'chase', targetName: 'wall', speed: 100, range: 'far', patrolA: '', patrolB: '' });
    check('setAiBehavior warns and holds on a bad range',
      !hero._ai && warnings.length === 1 && /not a number/.test(warnings[0]),
      JSON.stringify(warnings));
  }
  {
    const ctx = aiCtx();
    warnings.length = 0;
    ex(ctx, { type: 'setAiBehavior', targetObject: 'ghost2', behavior: 'chase', targetName: 'wall', speed: 100, range: 300, patrolA: '', patrolB: '' });
    check('setAiBehavior on a missing mover stays quiet',
      warnings.length === 0);
  }
  {
    const ctx = aiCtx();
    const hero = ctx.named('hero')[0];
    warnings.length = 0;
    ex(ctx, { type: 'setAiBehavior', targetObject: 'hero', behavior: 'chase', targetName: 'ghost2', speed: 100, range: 300, patrolA: '', patrolB: '' });
    check('setAiBehavior on a missing target records the behavior quietly (the brain holds)',
      !!hero._ai && hero._ai.behavior === 'chase' && hero._ai.target === 'ghost2' && warnings.length === 0);
  }
  {
    const ctx = aiCtx();
    const hero = ctx.named('hero')[0];
    ex(ctx, { type: 'setAiBehavior', targetObject: 'hero', behavior: 'flee', targetName: 'wall', speed: 100, range: 300, patrolA: '', patrolB: '' });
    ex(ctx, { type: 'followPath', targetObject: 'hero', destinationObject: 'wall', speed: 100 });
    ex(ctx, { type: 'stopAi', targetObject: 'hero' });
    check('stopAi clears the behavior record and the walking path',
      !hero._ai && !hero._path && AI.behaviorOf(hero) === 'none');
  }
  {
    const ctx = aiCtx();
    const hero = ctx.named('hero')[0];
    ex(ctx, { type: 'setAiBehavior', targetObject: 'hero', behavior: 'chase', targetName: 'wall', speed: 100, range: 300, patrolA: '', patrolB: '' });
    ex(ctx, { type: 'setAiBehavior', targetObject: 'hero', behavior: 'wander', targetName: '', speed: 150, range: 200, patrolA: '', patrolB: '' });
    check('a new setAiBehavior replaces the behavior already running',
      !!hero._ai && hero._ai.behavior === 'wander' && hero._ai.speed === 150);
  }
  {
    const ctx = makeCtx();
    const hero = ctx.named('hero')[0];
    warnings.length = 0;
    ex(ctx, { type: 'setAiBehavior', targetObject: 'hero', behavior: 'chase', targetName: 'wall', speed: 100, range: 300, patrolA: '', patrolB: '' });
    check('setAiBehavior stays quiet without the AI module',
      !hero._ai && warnings.length === 0);
    ex(ctx, { type: 'stopAi', targetObject: 'hero' });
    check('stopAi stays quiet without the AI module', warnings.length === 0);
  }
}

// --- Joystick actions (P4 Advanced batch 20) ---
// The stick is run state on the ctx: enable/disable flip its flag,
// and disable lets go of a held stick so the tilt reads 0 again.
{
  function joyCtx(enabled) {
    const ctx = makeCtx();
    ctx.joystickModule = J;
    ctx.joystick = J.createJoystickRuntime({ enabled: !!enabled });
    ctx.joystickConfig = J.defaultJoystickConfig();
    ctx.joystickConfig.enabled = !!enabled;
    return ctx;
  }
  {
    const ctx = joyCtx(false);
    ex(ctx, { type: 'enableJoystick' });
    check('enableJoystick turns the live stick on',
      ctx.joystick.enabled === true);
    ex(ctx, { type: 'disableJoystick' });
    check('disableJoystick turns the live stick off',
      ctx.joystick.enabled === false);
  }
  {
    const ctx = joyCtx(true);
    const cfg = ctx.joystickConfig;
    J.joystickStart(ctx.joystick, cfg, 'mouse', 76, 524, 800, 600);
    J.joystickMove(ctx.joystick, cfg, 'mouse', 136, 524);
    check('the test stick is tilted before Disable Joystick',
      ctx.joystick.x === 1 && J.isActive(ctx.joystick) === true);
    ex(ctx, { type: 'disableJoystick' });
    check('disableJoystick lets go of a held stick and centers the tilt',
      ctx.joystick.enabled === false && ctx.joystick.pointerId === null &&
      ctx.joystick.x === 0 && ctx.joystick.y === 0 && J.isActive(ctx.joystick) === false);
  }
  {
    const ctx = makeCtx();
    warnings.length = 0;
    ex(ctx, { type: 'enableJoystick' });
    check('enableJoystick stays quiet without a live stick record',
      warnings.length === 0);
    ex(ctx, { type: 'disableJoystick' });
    check('disableJoystick stays quiet without a live stick record',
      warnings.length === 0);
  }
}

// --- Health actions (P4 Advanced batch 21) ---
// The stub heroes carry no health fields, so the first write normalizes
// them to 100 / 100. targets() resolves to the first live match by
// default, so only hero id 1 takes each hit; id 3 stays untouched.
{
  function healthCtx() {
    return makeCtx({ healthModule: HP });
  }
  function heroById(ctx, id) { return ctx.objects.find(o => o.id === id); }
  {
    const ctx = healthCtx();
    ex(ctx, { type: 'damageObject', targetObject: 'hero', amount: 30 });
    check('damageObject subtracts from the first named object',
      heroById(ctx, 1).health === 70 && heroById(ctx, 3).health === undefined);
    ex(ctx, { type: 'healObject', targetObject: 'hero', amount: 15 });
    check('healObject adds back toward the ceiling',
      heroById(ctx, 1).health === 85);
    ex(ctx, { type: 'setHealth', targetObject: 'hero', value: 40 });
    check('setHealth writes an exact value',
      heroById(ctx, 1).health === 40);
    ex(ctx, { type: 'damageObject', targetObject: 'hero', amount: 100 });
    check('damageObject clamps at 0 on the killing hit',
      heroById(ctx, 1).health === 0);
    ex(ctx, { type: 'setMaxHealth', targetObject: 'hero', value: 50 });
    check('setMaxHealth moves the ceiling (health stays 0)',
      heroById(ctx, 1).maxHealth === 50 && heroById(ctx, 1).health === 0);
    ex(ctx, { type: 'healObject', targetObject: 'hero', amount: 500 });
    check('healObject clamps at the new ceiling',
      heroById(ctx, 1).health === 50);
  }
  {
    const ctx = healthCtx();
    warnings.length = 0;
    ex(ctx, { type: 'damageObject', targetObject: 'hero', amount: 'fast' });
    check('damageObject warns and holds on a bad amount',
      warnings.length === 1 && /not a number/.test(warnings[0]) &&
      heroById(ctx, 1).health === undefined,
      JSON.stringify(warnings));
    warnings.length = 0;
    ex(ctx, { type: 'healObject', targetObject: 'hero', amount: 'fast' });
    check('healObject warns and holds on a bad amount',
      warnings.length === 1 && /not a number/.test(warnings[0]) &&
      heroById(ctx, 1).health === undefined);
    warnings.length = 0;
    ex(ctx, { type: 'setHealth', targetObject: 'hero', value: 'fast' });
    check('setHealth warns and holds on a bad value',
      warnings.length === 1 && /not a number/.test(warnings[0]) &&
      heroById(ctx, 1).health === undefined);
    warnings.length = 0;
    ex(ctx, { type: 'setMaxHealth', targetObject: 'hero', value: 'fast' });
    check('setMaxHealth warns and holds on a bad value',
      warnings.length === 1 && /not a number/.test(warnings[0]) &&
      heroById(ctx, 1).maxHealth === undefined);
  }
  {
    const ctx = healthCtx();
    warnings.length = 0;
    ex(ctx, { type: 'damageObject', targetObject: 'ghost2', amount: 10 });
    ex(ctx, { type: 'healObject', targetObject: 'ghost2', amount: 10 });
    ex(ctx, { type: 'setHealth', targetObject: 'ghost2', value: 10 });
    ex(ctx, { type: 'setMaxHealth', targetObject: 'ghost2', value: 10 });
    check('health actions on a missing object stay quiet',
      warnings.length === 0);
  }
  {
    const ctx = makeCtx();
    const hero = ctx.named('hero')[0];
    warnings.length = 0;
    ex(ctx, { type: 'damageObject', targetObject: 'hero', amount: 10 });
    check('damageObject stays quiet without the health module',
      hero.health === undefined && warnings.length === 0);
    ex(ctx, { type: 'healObject', targetObject: 'hero', amount: 10 });
    check('healObject stays quiet without the health module',
      hero.health === undefined && warnings.length === 0);
  }
}

// --- Damage feedback actions (P4 Advanced batch 22) ---
// The stub heroes carry no health fields and no shield, so the first
// write normalizes them. The frozen clock is a local 1000ms so the
// shield math is exact; targets() resolves to the first live match,
// so only hero id 1 takes each hit.
{
  let nowMs = 1000;
  function dmgCtx(over) {
    const nums = DF.createDamageNumberState();
    const ctx = makeCtx(Object.assign({
      healthModule: HP, damageFxModule: DF,
      frozenNowMs: () => nowMs,
      damageNumbers: nums, ensureDamageNumbers: () => nums
    }, over || {}));
    ctx._nums = nums;
    return ctx;
  }
  function heroById(ctx, id) { return ctx.objects.find(o => o.id === id); }
  {
    const ctx = dmgCtx();
    ex(ctx, { type: 'showDamageNumber', targetObject: 'hero', amount: 25, color: '#ff0000' });
    check('showDamageNumber spawns one number above the first named object',
      ctx._nums.numbers.length === 1 && ctx._nums.numbers[0].text === '25' &&
      ctx._nums.numbers[0].x === 30 && ctx._nums.numbers[0].y === 20 &&
      ctx._nums.numbers[0].color === '#ff0000',
      JSON.stringify(ctx._nums.numbers));
  }
  {
    const ctx = dmgCtx();
    ex(ctx, { type: 'makeInvincible', targetObject: 'hero', seconds: 2 });
    check('makeInvincible writes the shield end on the frozen clock',
      heroById(ctx, 1)._invincibleUntil === 3000,
      JSON.stringify({ until: heroById(ctx, 1)._invincibleUntil }));
    ex(ctx, { type: 'damageObject', targetObject: 'hero', amount: 30 });
    check('damageObject is blocked while the shield holds (health untouched)',
      heroById(ctx, 1).health === undefined);
    ex(ctx, { type: 'healObject', targetObject: 'hero', amount: 10 });
    check('healObject still applies to a shielded object',
      heroById(ctx, 1).health === 100);
    ex(ctx, { type: 'setHealth', targetObject: 'hero', value: 40 });
    check('setHealth still applies to a shielded object',
      heroById(ctx, 1).health === 40);
    ex(ctx, { type: 'makeInvincible', targetObject: 'hero', seconds: 0 });
    check('makeInvincible with 0 seconds clears the shield at once',
      heroById(ctx, 1)._invincibleUntil === 0);
    ex(ctx, { type: 'damageObject', targetObject: 'hero', amount: 10 });
    check('damageObject lands again once the shield clears',
      heroById(ctx, 1).health === 30);
  }
  {
    const ctx = dmgCtx();
    ex(ctx, { type: 'makeInvincible', targetObject: 'hero', seconds: 2 });
    nowMs = 3000;
    ex(ctx, { type: 'damageObject', targetObject: 'hero', amount: 10 });
    check('damageObject lands once the shield time passes',
      heroById(ctx, 1).health === 90);
    nowMs = 1000;
  }
  {
    // hero center (30, 40); wall center (120, 40): the push runs left.
    const ctx = dmgCtx();
    ex(ctx, { type: 'knockbackObject', targetObject: 'hero', fromObject: 'wall', x: 0, y: 0, force: 300 });
    check('knockbackObject from a named object pushes away from it',
      heroById(ctx, 1).velX === -300 && heroById(ctx, 1).velY === 0,
      JSON.stringify({ velX: heroById(ctx, 1).velX, velY: heroById(ctx, 1).velY }));
  }
  {
    // From the hero's own center (30, 40): no direction, so straight up.
    const ctx = dmgCtx();
    ex(ctx, { type: 'knockbackObject', targetObject: 'hero', fromObject: '', x: 30, y: 40, force: 240 });
    check('knockbackObject from the object\'s own center pushes straight up',
      heroById(ctx, 1).velX === 0 && heroById(ctx, 1).velY === -240,
      JSON.stringify({ velX: heroById(ctx, 1).velX, velY: heroById(ctx, 1).velY }));
  }
  {
    const ctx = dmgCtx();
    ex(ctx, { type: 'knockbackObject', targetObject: 'hero', fromObject: 'ghost2', x: 0, y: 0, force: 300 });
    check('knockbackObject stays quiet when the source object is missing',
      heroById(ctx, 1).velX === 0 && heroById(ctx, 1).velY === 0);
  }
  {
    const ctx = dmgCtx();
    warnings.length = 0;
    ex(ctx, { type: 'showDamageNumber', targetObject: 'hero', amount: 'fast', color: '#ffffff' });
    check('showDamageNumber warns and holds on a bad amount',
      warnings.length === 1 && /not a number/.test(warnings[0]) && ctx._nums.numbers.length === 0,
      JSON.stringify(warnings));
    warnings.length = 0;
    ex(ctx, { type: 'makeInvincible', targetObject: 'hero', seconds: 'fast' });
    check('makeInvincible warns and holds on bad seconds',
      warnings.length === 1 && /not a number/.test(warnings[0]) &&
      heroById(ctx, 1)._invincibleUntil === undefined);
    warnings.length = 0;
    ex(ctx, { type: 'knockbackObject', targetObject: 'hero', fromObject: 'wall', x: 0, y: 0, force: 'fast' });
    check('knockbackObject warns and holds on a bad force',
      warnings.length === 1 && /not a number/.test(warnings[0]) &&
      heroById(ctx, 1).velX === 0 && heroById(ctx, 1).velY === 0);
    warnings.length = 0;
    ex(ctx, { type: 'knockbackObject', targetObject: 'hero', fromObject: '', x: 'fast', y: 40, force: 300 });
    check('knockbackObject warns and holds on a bad X/Y point',
      warnings.length === 1 && /not a number/.test(warnings[0]) &&
      heroById(ctx, 1).velX === 0 && heroById(ctx, 1).velY === 0);
  }
  {
    const ctx = dmgCtx();
    warnings.length = 0;
    ex(ctx, { type: 'showDamageNumber', targetObject: 'ghost2', amount: 10, color: '#ffffff' });
    ex(ctx, { type: 'makeInvincible', targetObject: 'ghost2', seconds: 1 });
    ex(ctx, { type: 'knockbackObject', targetObject: 'ghost2', fromObject: 'wall', x: 0, y: 0, force: 300 });
    check('damage-feedback actions on a missing object stay quiet',
      warnings.length === 0 && ctx._nums.numbers.length === 0);
  }
  {
    const ctx = makeCtx({ healthModule: HP });
    const hero = ctx.named('hero')[0];
    warnings.length = 0;
    ex(ctx, { type: 'showDamageNumber', targetObject: 'hero', amount: 10, color: '#ffffff' });
    ex(ctx, { type: 'makeInvincible', targetObject: 'hero', seconds: 1 });
    ex(ctx, { type: 'knockbackObject', targetObject: 'hero', fromObject: 'wall', x: 0, y: 0, force: 300 });
    check('damage-feedback actions stay quiet without the module',
      warnings.length === 0 && hero._invincibleUntil === undefined &&
      hero.velX === 0 && hero.velY === 0);
    ex(ctx, { type: 'damageObject', targetObject: 'hero', amount: 10 });
    check('damageObject still lands without the damage-feedback module (no gate)',
      hero.health === 90);
  }
  {
    // No frozen clock: the gate reads now as 0, so a shielded object
    // stays shielded (the safe default) while an unshielded one still
    // takes the hit.
    const ctx = makeCtx({ healthModule: HP, damageFxModule: DF });
    const hero = ctx.named('hero')[0];
    DF.makeInvincible(hero, 2, 1000);
    ex(ctx, { type: 'damageObject', targetObject: 'hero', amount: 10 });
    check('damageObject stays blocked without a frozen clock (now reads 0)',
      hero.health === undefined);
    const ctx2 = makeCtx({ healthModule: HP, damageFxModule: DF });
    const hero2 = ctx2.named('hero')[0];
    ex(ctx2, { type: 'damageObject', targetObject: 'hero', amount: 10 });
    check('damageObject lands on an unshielded object without a frozen clock',
      hero2.health === 90);
  }
}

// --- Respawn actions (P4 Advanced batch 23) ---
// The stub heroes start at (10, 20) and (200, 20); the wall sits at
// (100, 20), so a checkpoint on the wall reads (100, 20). targets()
// resolves to the first live match, so only hero id 1 respawns.
{
  function rspCtx(over) {
    const st = RM.createRespawnState();
    const ctx = makeCtx(Object.assign({
      healthModule: HP, respawnModule: RM,
      respawn: st, ensureRespawnState: () => st,
      pathfindModule: { stopPath: (o) => { calls.push(['stopPath', o.id]); } }
    }, over || {}));
    RM.recordInitialPositions(st, ctx.objects);
    ctx._rsp = st;
    return ctx;
  }
  function heroById(ctx, id) { return ctx.objects.find(o => o.id === id); }
  {
    const ctx = rspCtx();
    ex(ctx, { type: 'setCheckpoint', checkpointObject: 'wall', x: 0, y: 0 });
    check('setCheckpoint records the checkpoint object\'s top-left corner',
      ctx._rsp.point && ctx._rsp.point.x === 100 && ctx._rsp.point.y === 20 &&
      ctx._rsp.point.name === 'wall',
      JSON.stringify(ctx._rsp.point));
    ex(ctx, { type: 'setCheckpoint', checkpointObject: '', x: 300, y: 400 });
    check('setCheckpoint with a blank object records the X/Y point instead',
      ctx._rsp.point && ctx._rsp.point.x === 300 && ctx._rsp.point.y === 400 &&
      ctx._rsp.point.name === '',
      JSON.stringify(ctx._rsp.point));
  }
  {
    const ctx = rspCtx();
    ex(ctx, { type: 'setCheckpoint', checkpointObject: 'wall', x: 0, y: 0 });
    heroById(ctx, 1).posX = 555;
    heroById(ctx, 1).posY = 444;
    heroById(ctx, 1).velX = 50;
    heroById(ctx, 1).velY = -60;
    heroById(ctx, 1).health = 20;
    heroById(ctx, 1).maxHealth = 100;
    calls.length = 0;
    ex(ctx, { type: 'respawnObject', targetObject: 'hero', restoreHealth: true });
    check('respawnObject sends the hero to the checkpoint with a full refill',
      heroById(ctx, 1).posX === 100 && heroById(ctx, 1).posY === 20 &&
      heroById(ctx, 1).health === 100,
      JSON.stringify({ posX: heroById(ctx, 1).posX, posY: heroById(ctx, 1).posY, health: heroById(ctx, 1).health }));
    check('respawnObject zeroes the velocity and stops the walking path',
      heroById(ctx, 1).velX === 0 && heroById(ctx, 1).velY === 0 &&
      calls.some(c => c[0] === 'stopPath' && c[1] === 1),
      JSON.stringify(calls));
    check('respawnObject counts the respawn',
      ctx._rsp.count === 1);
  }
  {
    const ctx = rspCtx();
    heroById(ctx, 1).posX = 555;
    heroById(ctx, 1).posY = 444;
    heroById(ctx, 1).health = 30;
    heroById(ctx, 1).maxHealth = 100;
    ex(ctx, { type: 'respawnObject', targetObject: 'hero', restoreHealth: true });
    check('respawnObject with no checkpoint sends the hero home to its start position',
      heroById(ctx, 1).posX === 10 && heroById(ctx, 1).posY === 20 &&
      heroById(ctx, 1).health === 100,
      JSON.stringify({ posX: heroById(ctx, 1).posX, posY: heroById(ctx, 1).posY }));
  }
  {
    const ctx = rspCtx();
    ex(ctx, { type: 'setCheckpoint', checkpointObject: 'wall', x: 0, y: 0 });
    heroById(ctx, 1).posX = 555;
    heroById(ctx, 1).health = 30;
    heroById(ctx, 1).maxHealth = 100;
    ex(ctx, { type: 'respawnObject', targetObject: 'hero', restoreHealth: false });
    check('respawnObject with Restore health off moves the hero but leaves the health alone',
      heroById(ctx, 1).posX === 100 && heroById(ctx, 1).posY === 20 &&
      heroById(ctx, 1).health === 30,
      JSON.stringify({ posX: heroById(ctx, 1).posX, health: heroById(ctx, 1).health }));
  }
  {
    const ctx = rspCtx();
    ex(ctx, { type: 'setCheckpoint', checkpointObject: 'wall', x: 0, y: 0 });
    ex(ctx, { type: 'clearCheckpoint' });
    check('clearCheckpoint forgets the point (the next respawn goes home)',
      ctx._rsp.point === null);
    heroById(ctx, 1).posX = 555;
    ex(ctx, { type: 'respawnObject', targetObject: 'hero', restoreHealth: true });
    check('respawnObject after Clear Checkpoint lands at the start position',
      heroById(ctx, 1).posX === 10 && heroById(ctx, 1).posY === 20);
  }
  {
    const ctx = rspCtx();
    warnings.length = 0;
    ex(ctx, { type: 'setCheckpoint', checkpointObject: '', x: 'fast', y: 40 });
    check('setCheckpoint warns and holds on a bad X/Y point',
      warnings.length === 1 && /not a number/.test(warnings[0]) &&
      ctx._rsp.point === null,
      JSON.stringify(warnings));
  }
  {
    const ctx = rspCtx();
    warnings.length = 0;
    ex(ctx, { type: 'setCheckpoint', checkpointObject: 'ghost2', x: 0, y: 0 });
    ex(ctx, { type: 'respawnObject', targetObject: 'ghost2', restoreHealth: true });
    ex(ctx, { type: 'clearCheckpoint' });
    check('respawn actions on a missing object stay quiet',
      warnings.length === 0 && ctx._rsp.point === null && ctx._rsp.count === 0);
  }
  {
    const ctx = makeCtx({ healthModule: HP });
    const hero = ctx.named('hero')[0];
    warnings.length = 0;
    hero.posX = 555;
    ex(ctx, { type: 'setCheckpoint', checkpointObject: 'wall', x: 0, y: 0 });
    ex(ctx, { type: 'respawnObject', targetObject: 'hero', restoreHealth: true });
    ex(ctx, { type: 'clearCheckpoint' });
    check('respawn actions stay quiet without the module (the hero never moves)',
      warnings.length === 0 && hero.posX === 555);
  }
  {
    // No respawn state at all (and no ensure hook): the blocks stay
    // quiet instead of throwing — the same degradation as a dropped
    // module tag in the preview.
    const ctx = makeCtx({ healthModule: HP, respawnModule: RM });
    const hero = ctx.named('hero')[0];
    warnings.length = 0;
    hero.posX = 555;
    ex(ctx, { type: 'setCheckpoint', checkpointObject: 'wall', x: 0, y: 0 });
    ex(ctx, { type: 'respawnObject', targetObject: 'hero', restoreHealth: true });
    check('respawn actions stay quiet without a live respawn state',
      warnings.length === 0 && hero.posX === 555);
  }
}

// --- Spawner actions (P4 Advanced batch 24) ---
// The stub defs carry one 'coin' template; the wall at (100, 20) is
// the anchor object. Spawning itself is the frame phase's job — these
// checks cover the blocks: start / restart / stop / read.
{
  function spwCtx(over) {
    const st = SP.createSpawnerState();
    const ctx = makeCtx(Object.assign({
      spawnModule: SP,
      spawners: st, ensureSpawnerState: () => st
    }, over || {}));
    ctx._spw = st;
    return ctx;
  }
  {
    const ctx = spwCtx();
    ex(ctx, { type: 'startSpawner', name: 'coins', templateObject: 'coin', atObject: 'wall', x: 0, y: 0, interval: 2, maxAlive: 10, total: 0 });
    const rec = ctx._spw.spawners.coins;
    check('startSpawner records the spawner with the anchor and normalized fields',
      !!rec && rec.template === 'coin' && rec.atObject === 'wall' &&
      rec.interval === 2 && rec.maxAlive === 10 && rec.total === 0 &&
      rec.active === true && rec.timer === 0 && rec.spawned === 0,
      JSON.stringify(rec));
    ex(ctx, { type: 'startSpawner', name: 'coins', templateObject: 'coin', atObject: '', x: 300, y: 400, interval: 1, maxAlive: 5, total: 3 });
    const rec2 = ctx._spw.spawners.coins;
    check('restarting a spawner replaces it with a fresh timer and count',
      rec2.interval === 1 && rec2.maxAlive === 5 && rec2.total === 3 &&
      rec2.atObject === '' && rec2.x === 300 && rec2.y === 400 &&
      rec2.timer === 0 && rec2.spawned === 0,
      JSON.stringify(rec2));
  }
  {
    const ctx = spwCtx();
    warnings.length = 0;
    ex(ctx, { type: 'startSpawner', name: 'bad', templateObject: 'coin', atObject: '', x: 0, y: 0, interval: 'oops', maxAlive: 10, total: 0 });
    check('startSpawner warns and holds on a bad interval',
      warnings.length === 1 && /not a number/.test(warnings[0]) &&
      !ctx._spw.spawners.bad,
      JSON.stringify(warnings));
  }
  {
    const ctx = spwCtx();
    warnings.length = 0;
    ex(ctx, { type: 'startSpawner', name: 'bad', templateObject: 'coin', atObject: '', x: 'fast', y: 40, interval: 2, maxAlive: 10, total: 0 });
    check('startSpawner warns and holds on a bad X/Y point',
      warnings.length === 1 && /not a number/.test(warnings[0]) &&
      !ctx._spw.spawners.bad,
      JSON.stringify(warnings));
  }
  {
    const ctx = spwCtx();
    warnings.length = 0;
    ex(ctx, { type: 'startSpawner', name: 'ok', templateObject: 'coin', atObject: 'wall', x: 'fast', y: 40, interval: 2, maxAlive: 10, total: 0 });
    check('startSpawner skips the X/Y check when an anchor object is named',
      warnings.length === 0 && !!ctx._spw.spawners.ok,
      JSON.stringify(warnings));
  }
  {
    const ctx = spwCtx();
    warnings.length = 0;
    ex(ctx, { type: 'startSpawner', name: '', templateObject: 'coin', atObject: '', x: 0, y: 0, interval: 2, maxAlive: 10, total: 0 });
    ex(ctx, { type: 'startSpawner', name: 'x', templateObject: '', atObject: '', x: 0, y: 0, interval: 2, maxAlive: 10, total: 0 });
    check('startSpawner stays quiet on a blank name or template',
      warnings.length === 0 && Object.keys(ctx._spw.spawners).length === 0);
  }
  {
    const ctx = spwCtx();
    ex(ctx, { type: 'startSpawner', name: 'a', templateObject: 'coin', atObject: '', x: 0, y: 0, interval: 2, maxAlive: 10, total: 0 });
    ex(ctx, { type: 'startSpawner', name: 'b', templateObject: 'coin', atObject: '', x: 0, y: 0, interval: 2, maxAlive: 10, total: 0 });
    ex(ctx, { type: 'stopSpawner', name: 'a' });
    check('stopSpawner stops one spawner by name',
      SP.spawnerActive(ctx._spw, 'a') === false && SP.spawnerActive(ctx._spw, 'b') === true);
    ex(ctx, { type: 'stopSpawner', name: '' });
    check('stopSpawner with a blank name stops every spawner',
      SP.spawnerActive(ctx._spw, 'b') === false);
    warnings.length = 0;
    ex(ctx, { type: 'stopSpawner', name: 'nobody' });
    check('stopSpawner on an unknown name stays quiet', warnings.length === 0);
  }
  {
    const ctx = spwCtx();
    ex(ctx, { type: 'startSpawner', name: 'coins', templateObject: 'coin', atObject: '', x: 0, y: 0, interval: 2, maxAlive: 10, total: 0 });
    ctx._spw.spawners.coins.spawned = 7;
    ex(ctx, { type: 'readSpawnedCount', name: 'coins', varName: 'made' });
    check('readSpawnedCount copies the spawned total into a variable',
      ctx.variables.made === 7, `made=${ctx.variables.made}`);
    ex(ctx, { type: 'readSpawnedCount', name: 'nope', varName: 'never' });
    check('readSpawnedCount for a never-started spawner reads 0',
      ctx.variables.never === 0, `never=${ctx.variables.never}`);
    warnings.length = 0;
    ex(ctx, { type: 'readSpawnedCount', name: 'coins', varName: '' });
    check('readSpawnedCount warns and holds on a blank variable name',
      warnings.length === 1 && /blank/.test(warnings[0]),
      JSON.stringify(warnings));
  }
  {
    const ctx = makeCtx({});
    warnings.length = 0;
    ex(ctx, { type: 'startSpawner', name: 'coins', templateObject: 'coin', atObject: '', x: 0, y: 0, interval: 2, maxAlive: 10, total: 0 });
    ex(ctx, { type: 'stopSpawner', name: 'coins' });
    ex(ctx, { type: 'readSpawnedCount', name: 'coins', varName: 'made' });
    check('spawner actions stay quiet without the module',
      warnings.length === 0 && ctx.variables.made === undefined);
    const ctx2 = makeCtx({ spawnModule: SP });
    warnings.length = 0;
    ex(ctx2, { type: 'startSpawner', name: 'coins', templateObject: 'coin', atObject: '', x: 0, y: 0, interval: 2, maxAlive: 10, total: 0 });
    check('spawner actions stay quiet without a live spawner state',
      warnings.length === 0);
  }
}

// --- Lives actions (P4 Advanced batch 25) ---
{
  function lvCtx(over) {
    const st = LV.createLivesState();
    const ctx = makeCtx(Object.assign({
      livesModule: LV,
      lives: st
    }, over || {}));
    ctx._lv = st;
    return ctx;
  }
  {
    const ctx = lvCtx();
    check('a fresh lives state starts at the default 3',
      LV.livesOf(ctx._lv) === 3);
    ex(ctx, { type: 'setLives', lives: 5 });
    check('setLives writes the count',
      ctx._lv.lives === 5, JSON.stringify(ctx._lv));
    ex(ctx, { type: 'addLives', amount: 2 });
    check('addLives tops the count up',
      ctx._lv.lives === 7, JSON.stringify(ctx._lv));
    ex(ctx, { type: 'loseLife', amount: 3 });
    check('loseLife spends lives',
      ctx._lv.lives === 4, JSON.stringify(ctx._lv));
    ex(ctx, { type: 'readLives', varName: 'left' });
    check('readLives copies the count into a variable',
      ctx.variables.left === 4, `left=${ctx.variables.left}`);
  }
  {
    const ctx = lvCtx();
    ex(ctx, { type: 'setLives', lives: 1 });
    ex(ctx, { type: 'loseLife', amount: 1 });
    check('losing the last life leaves the count at 0',
      ctx._lv.lives === 0 && LV.isGameOver(ctx._lv) === true);
    ex(ctx, { type: 'loseLife', amount: 5 });
    check('losing a life at 0 stays at 0',
      ctx._lv.lives === 0);
    ex(ctx, { type: 'addLives', amount: 1 });
    check('adding a life after game over clears it (a continue)',
      ctx._lv.lives === 1 && LV.isGameOver(ctx._lv) === false);
  }
  {
    const ctx = lvCtx();
    warnings.length = 0;
    ex(ctx, { type: 'setLives', lives: 'oops' });
    check('setLives warns and holds on a bad value',
      warnings.length === 1 && /not a number/.test(warnings[0]) &&
      ctx._lv.lives === 3,
      JSON.stringify(warnings));
    warnings.length = 0;
    ex(ctx, { type: 'addLives', amount: 'oops' });
    check('addLives warns and holds on a bad amount',
      warnings.length === 1 && /not a number/.test(warnings[0]) &&
      ctx._lv.lives === 3,
      JSON.stringify(warnings));
    warnings.length = 0;
    ex(ctx, { type: 'loseLife', amount: 'oops' });
    check('loseLife warns and holds on a bad amount',
      warnings.length === 1 && /not a number/.test(warnings[0]) &&
      ctx._lv.lives === 3,
      JSON.stringify(warnings));
  }
  {
    const ctx = lvCtx();
    warnings.length = 0;
    ex(ctx, { type: 'readLives', varName: '' });
    check('readLives warns and holds on a blank variable name',
      warnings.length === 1 && /blank/.test(warnings[0]),
      JSON.stringify(warnings));
  }
  {
    const ctx = makeCtx({});
    warnings.length = 0;
    ex(ctx, { type: 'setLives', lives: 5 });
    ex(ctx, { type: 'addLives', amount: 1 });
    ex(ctx, { type: 'loseLife', amount: 1 });
    ex(ctx, { type: 'readLives', varName: 'left' });
    check('lives actions stay quiet without the module',
      warnings.length === 0 && ctx.variables.left === undefined);
    const ctx2 = makeCtx({ livesModule: LV });
    warnings.length = 0;
    ex(ctx2, { type: 'setLives', lives: 5 });
    ex(ctx2, { type: 'addLives', amount: 1 });
    ex(ctx2, { type: 'loseLife', amount: 1 });
    check('lives writes stay quiet without a live lives state',
      warnings.length === 0);
    ex(ctx2, { type: 'readLives', varName: 'left' });
    check('readLives without a live lives state reads the default 3',
      ctx2.variables.left === 3, `left=${ctx2.variables.left}`);
  }
}

// --- XP actions (P4 Advanced batch 30) ---
{
  function xpCtx(over) {
    const st = XP.createXpState();
    const ctx = makeCtx(Object.assign({
      xpModule: XP,
      xp: st
    }, over || {}));
    ctx._xp = st;
    return ctx;
  }
  {
    const ctx = xpCtx();
    check('a fresh XP state starts at 0 XP at level 1',
      XP.xpOf(ctx._xp) === 0 && XP.levelOf(ctx._xp) === 1);
    ex(ctx, { type: 'addXp', amount: 10 });
    check('addXp tops the total up',
      ctx._xp.xp === 10, JSON.stringify(ctx._xp));
    ex(ctx, { type: 'addXp', amount: 90 });
    check('addXp across the threshold levels the player up',
      ctx._xp.xp === 100 && XP.levelOf(ctx._xp) === 2, JSON.stringify(ctx._xp));
    ex(ctx, { type: 'setXpPerLevel', amount: 50 });
    check('setXpPerLevel rewrites the cost and re-levels at once',
      ctx._xp.xpPerLevel === 50 && XP.levelOf(ctx._xp) === 3, JSON.stringify(ctx._xp));
    ex(ctx, { type: 'readXp', varName: 'xpNow' });
    check('readXp copies the total into a variable',
      ctx.variables.xpNow === 100, `xpNow=${ctx.variables.xpNow}`);
    ex(ctx, { type: 'readLevel', varName: 'lvlNow' });
    check('readLevel copies the level into a variable',
      ctx.variables.lvlNow === 3, `lvlNow=${ctx.variables.lvlNow}`);
    ex(ctx, { type: 'setXp', xp: 250 });
    check('setXp writes the total outright',
      ctx._xp.xp === 250 && XP.levelOf(ctx._xp) === 6, JSON.stringify(ctx._xp));
  }
  {
    const ctx = xpCtx();
    warnings.length = 0;
    ex(ctx, { type: 'addXp', amount: 'oops' });
    check('addXp warns and holds on a bad amount',
      warnings.length === 1 && /not a number/.test(warnings[0]) &&
      ctx._xp.xp === 0,
      JSON.stringify(warnings));
    warnings.length = 0;
    ex(ctx, { type: 'setXp', xp: 'oops' });
    check('setXp warns and holds on a bad value',
      warnings.length === 1 && /not a number/.test(warnings[0]) &&
      ctx._xp.xp === 0,
      JSON.stringify(warnings));
    warnings.length = 0;
    ex(ctx, { type: 'setXpPerLevel', amount: 'oops' });
    check('setXpPerLevel warns and holds on a bad amount',
      warnings.length === 1 && /not a number/.test(warnings[0]) &&
      ctx._xp.xpPerLevel === 100,
      JSON.stringify(warnings));
  }
  {
    const ctx = xpCtx();
    warnings.length = 0;
    ex(ctx, { type: 'readXp', varName: '' });
    check('readXp warns and holds on a blank variable name',
      warnings.length === 1 && /blank/.test(warnings[0]),
      JSON.stringify(warnings));
    warnings.length = 0;
    ex(ctx, { type: 'readLevel', varName: '' });
    check('readLevel warns and holds on a blank variable name',
      warnings.length === 1 && /blank/.test(warnings[0]),
      JSON.stringify(warnings));
  }
  {
    const ctx = makeCtx({});
    warnings.length = 0;
    ex(ctx, { type: 'addXp', amount: 10 });
    ex(ctx, { type: 'setXp', xp: 5 });
    ex(ctx, { type: 'setXpPerLevel', amount: 50 });
    ex(ctx, { type: 'readXp', varName: 'xpNow' });
    ex(ctx, { type: 'readLevel', varName: 'lvlNow' });
    check('XP actions stay quiet without the module',
      warnings.length === 0 && ctx.variables.xpNow === undefined &&
      ctx.variables.lvlNow === undefined);
    const ctx2 = makeCtx({ xpModule: XP });
    warnings.length = 0;
    ex(ctx2, { type: 'addXp', amount: 10 });
    ex(ctx2, { type: 'setXp', xp: 5 });
    ex(ctx2, { type: 'setXpPerLevel', amount: 50 });
    check('XP writes stay quiet without a live XP state',
      warnings.length === 0);
    ex(ctx2, { type: 'readXp', varName: 'xpNow' });
    check('readXp without a live XP state reads the default 0',
      ctx2.variables.xpNow === 0, `xpNow=${ctx2.variables.xpNow}`);
    ex(ctx2, { type: 'readLevel', varName: 'lvlNow' });
    check('readLevel without a live XP state reads the default 1',
      ctx2.variables.lvlNow === 1, `lvlNow=${ctx2.variables.lvlNow}`);
  }
}

// --- Growth actions (P4 Advanced batch 31) ---
{
  function grCtx(over) {
    const st = GR.createGrowthState();
    const ctx = makeCtx(Object.assign({
      growthModule: GR,
      growth: st,
      healthModule: HP,
      damageFxModule: DF
    }, over || {}));
    ctx._gr = st;
    return ctx;
  }
  {
    const ctx = grCtx();
    const h = hero(ctx, 1);
    check('a fresh growth state has no bonuses anywhere',
      GR.maxHealthBonusOf(ctx._gr, 'hero') === 0 &&
      GR.damageBonusOf(ctx._gr, 'hero') === 0 &&
      GR.speedBonusOf(ctx._gr, 'hero') === 0);
    ex(ctx, { type: 'growMaxHealth', targetObject: 'hero', amount: 10, heal: true });
    check('growMaxHealth raises the ceiling and heals by the same amount',
      h.maxHealth === 110 && h.health === 110 &&
      GR.maxHealthBonusOf(ctx._gr, 'hero') === 10,
      JSON.stringify({ maxHealth: h.maxHealth, health: h.health }));
    ex(ctx, { type: 'growDamage', targetObject: 'hero', amount: 2 });
    check('growDamage grows the damage ledger',
      GR.damageBonusOf(ctx._gr, 'hero') === 2);
    ex(ctx, { type: 'growSpeed', targetObject: 'hero', amount: 50 });
    check('growSpeed grows the speed ledger',
      GR.speedBonusOf(ctx._gr, 'hero') === 50);
    ex(ctx, { type: 'readMaxHealthBonus', targetObject: 'hero', varName: 'hpBonus' });
    check('readMaxHealthBonus copies the bonus into a variable',
      ctx.variables.hpBonus === 10, `hpBonus=${ctx.variables.hpBonus}`);
    ex(ctx, { type: 'readDamageBonus', targetObject: 'hero', varName: 'dmgBonus' });
    check('readDamageBonus copies the bonus into a variable',
      ctx.variables.dmgBonus === 2, `dmgBonus=${ctx.variables.dmgBonus}`);
    ex(ctx, { type: 'readSpeedBonus', targetObject: 'hero', varName: 'spdBonus' });
    check('readSpeedBonus copies the bonus into a variable',
      ctx.variables.spdBonus === 50, `spdBonus=${ctx.variables.spdBonus}`);
  }
  {
    const ctx = grCtx();
    const h = hero(ctx, 1);
    ex(ctx, { type: 'damageObject', targetObject: 'hero', amount: 30 });
    check('damageObject hurts the hero first (70 of 100 left)',
      h.health === 70, `health=${h.health}`);
    ex(ctx, { type: 'growMaxHealth', targetObject: 'hero', amount: 10, heal: false });
    check('growMaxHealth with Heal Off raises the ceiling but does not heal',
      h.maxHealth === 110 && h.health === 70 &&
      GR.maxHealthBonusOf(ctx._gr, 'hero') === 10,
      JSON.stringify({ maxHealth: h.maxHealth, health: h.health }));
  }
  {
    const ctx = grCtx();
    const h = hero(ctx, 1);
    ex(ctx, { type: 'levelReward', targetObject: 'hero', bundle: 'balanced' });
    check('Level Reward Balanced raises max health, heals, and grows damage',
      h.maxHealth === 110 && h.health === 110 &&
      GR.maxHealthBonusOf(ctx._gr, 'hero') === 10 &&
      GR.damageBonusOf(ctx._gr, 'hero') === 2,
      JSON.stringify({ maxHealth: h.maxHealth, health: h.health }));
    ex(ctx, { type: 'levelReward', targetObject: 'hero', bundle: 'tank' });
    check('Level Reward Tank stacks the health growth',
      h.maxHealth === 130 && h.health === 130 &&
      GR.maxHealthBonusOf(ctx._gr, 'hero') === 30,
      JSON.stringify({ maxHealth: h.maxHealth, health: h.health }));
    ex(ctx, { type: 'levelReward', targetObject: 'hero', bundle: 'striker' });
    check('Level Reward Striker grows damage only',
      GR.damageBonusOf(ctx._gr, 'hero') === 7 &&
      GR.maxHealthBonusOf(ctx._gr, 'hero') === 30);
    ex(ctx, { type: 'levelReward', targetObject: 'hero', bundle: 'swift' });
    check('Level Reward Swift grows speed only',
      GR.speedBonusOf(ctx._gr, 'hero') === 50 &&
      GR.damageBonusOf(ctx._gr, 'hero') === 7);
  }
  {
    const ctx = grCtx();
    const h = hero(ctx, 1);
    warnings.length = 0;
    ex(ctx, { type: 'growMaxHealth', targetObject: 'hero', amount: 'oops', heal: true });
    check('growMaxHealth warns and holds on a bad amount',
      warnings.length === 1 && /not a number/.test(warnings[0]) &&
      h.maxHealth === undefined && GR.maxHealthBonusOf(ctx._gr, 'hero') === 0,
      JSON.stringify(warnings));
    warnings.length = 0;
    ex(ctx, { type: 'growDamage', targetObject: 'hero', amount: 'oops' });
    check('growDamage warns and holds on a bad amount',
      warnings.length === 1 && /not a number/.test(warnings[0]) &&
      GR.damageBonusOf(ctx._gr, 'hero') === 0,
      JSON.stringify(warnings));
    warnings.length = 0;
    ex(ctx, { type: 'growSpeed', targetObject: 'hero', amount: 'oops' });
    check('growSpeed warns and holds on a bad amount',
      warnings.length === 1 && /not a number/.test(warnings[0]) &&
      GR.speedBonusOf(ctx._gr, 'hero') === 0,
      JSON.stringify(warnings));
    warnings.length = 0;
    ex(ctx, { type: 'levelReward', targetObject: 'hero', bundle: 'mega' });
    check('levelReward warns and holds on an unknown bundle',
      warnings.length === 1 && /pick a reward bundle/.test(warnings[0]) &&
      GR.maxHealthBonusOf(ctx._gr, 'hero') === 0,
      JSON.stringify(warnings));
    warnings.length = 0;
    ex(ctx, { type: 'readDamageBonus', targetObject: 'hero', varName: '' });
    check('readDamageBonus warns and holds on a blank variable name',
      warnings.length === 1 && /blank/.test(warnings[0]),
      JSON.stringify(warnings));
    warnings.length = 0;
    ex(ctx, { type: 'growDamage', targetObject: 'nobody', amount: 2 });
    check('growDamage stays quiet on a missing object',
      warnings.length === 0 && GR.damageBonusOf(ctx._gr, 'hero') === 0);
  }
  {
    // The grown damage bonus rides into melee swings and shots.
    nowValue = 1000;
    const cbSt = CB.createCombatState();
    const grSt = GR.createGrowthState();
    const ctx = makeCtx({
      combatModule: CB, combat: cbSt,
      healthModule: HP, damageFxModule: DF,
      growthModule: GR, growth: grSt
    });
    ctx._cb = cbSt; ctx._gr = grSt;
    warnings.length = 0;
    ex(ctx, { type: 'growDamage', targetObject: 'hero', amount: 5 });
    ex(ctx, { type: 'meleeAttack', targetObject: 'hero', damage: 10, range: 100, direction: 'right', cooldown: 0.5 });
    check('meleeAttack adds the attacker damage bonus (10 + 5)',
      hero(ctx, 2).health === 85 && hero(ctx, 8).health === 85,
      JSON.stringify({ wall: hero(ctx, 2).health, box: hero(ctx, 8).health }));
    ex(ctx, { type: 'shootProjectile', targetObject: 'hero', projectileObject: 'coin', direction: 'right', speed: 300, damage: 10, lifetime: 2, cooldown: 0.5 });
    check('shootProjectile carries the boosted damage on the projectile',
      ctx._cb.projectiles.length === 1 && ctx._cb.projectiles[0].damage === 15,
      JSON.stringify(ctx._cb.projectiles.map(p => p.damage)));
  }
  {
    // The grown speed bonus rides into dashes.
    nowValue = 1000;
    const mvSt = MV.createMovementState();
    const grSt = GR.createGrowthState();
    const ctx = makeCtx({
      movementModule: MV, movement: mvSt,
      growthModule: GR, growth: grSt
    });
    ctx._mv = mvSt; ctx._gr = grSt;
    ex(ctx, { type: 'growSpeed', targetObject: 'hero', amount: 50 });
    ex(ctx, { type: 'dash', targetObject: 'hero', direction: 'right', speed: 400, duration: 0.15, cooldown: 0.5 });
    check('dash adds the grown speed bonus (400 + 50)',
      ctx._mv.records[1] && ctx._mv.records[1].dashSpeed === 450,
      JSON.stringify(ctx._mv.records[1]));
  }
  {
    const ctx = makeCtx({});
    warnings.length = 0;
    ex(ctx, { type: 'growMaxHealth', targetObject: 'hero', amount: 10, heal: true });
    ex(ctx, { type: 'growDamage', targetObject: 'hero', amount: 2 });
    ex(ctx, { type: 'growSpeed', targetObject: 'hero', amount: 50 });
    ex(ctx, { type: 'levelReward', targetObject: 'hero', bundle: 'balanced' });
    ex(ctx, { type: 'readDamageBonus', targetObject: 'hero', varName: 'dmg' });
    check('growth actions stay quiet without the module',
      warnings.length === 0 && ctx.variables.dmg === undefined);
    const ctx2 = makeCtx({ growthModule: GR, healthModule: HP });
    warnings.length = 0;
    ex(ctx2, { type: 'growDamage', targetObject: 'hero', amount: 2 });
    ex(ctx2, { type: 'levelReward', targetObject: 'hero', bundle: 'balanced' });
    check('growth writes stay quiet without a live growth state',
      warnings.length === 0);
    ex(ctx2, { type: 'readDamageBonus', targetObject: 'hero', varName: 'dmg' });
    check('readDamageBonus without a live growth state reads the default 0',
      ctx2.variables.dmg === 0, `dmg=${ctx2.variables.dmg}`);
  }
}

// --- Scaling actions (P4 Advanced batch 32) ---
{
  function scCtx(over) {
    const st = SC.createScalingState();
    const ctx = makeCtx(Object.assign({
      scalingModule: SC,
      scaling: st,
      healthModule: HP,
      damageFxModule: DF
    }, over || {}));
    ctx._sc = st;
    return ctx;
  }
  {
    const ctx = scCtx();
    const h = hero(ctx, 1);
    check('a fresh scaling state starts every enemy at level 1 with no bonuses',
      SC.levelOf(ctx._sc, 'hero') === 1 &&
      SC.hpBonusOf(ctx._sc, 'hero') === 0 &&
      SC.dmgBonusOf(ctx._sc, 'hero') === 0);
    ex(ctx, { type: 'setEnemyLevel', targetObject: 'hero', level: 3 });
    check('setEnemyLevel to 3 raises the ceiling and heals by the +20 bonus',
      h.maxHealth === 120 && h.health === 120 &&
      SC.levelOf(ctx._sc, 'hero') === 3 &&
      SC.hpBonusOf(ctx._sc, 'hero') === 20 &&
      SC.dmgBonusOf(ctx._sc, 'hero') === 4,
      JSON.stringify({ maxHealth: h.maxHealth, health: h.health }));
    ex(ctx, { type: 'readEnemyLevel', targetObject: 'hero', varName: 'eLvl' });
    check('readEnemyLevel copies the level into a variable',
      ctx.variables.eLvl === 3, `eLvl=${ctx.variables.eLvl}`);
    ex(ctx, { type: 'readScaledHpBonus', targetObject: 'hero', varName: 'sHp' });
    check('readScaledHpBonus copies the health bonus into a variable',
      ctx.variables.sHp === 20, `sHp=${ctx.variables.sHp}`);
    ex(ctx, { type: 'readScaledDmgBonus', targetObject: 'hero', varName: 'sDmg' });
    check('readScaledDmgBonus copies the damage bonus into a variable',
      ctx.variables.sDmg === 4, `sDmg=${ctx.variables.sDmg}`);
  }
  {
    const ctx = scCtx();
    const h = hero(ctx, 1);
    ex(ctx, { type: 'damageObject', targetObject: 'hero', amount: 30 });
    check('damageObject hurts the hero first (70 of 100 left)',
      h.health === 70, `health=${h.health}`);
    ex(ctx, { type: 'setEnemyLevel', targetObject: 'hero', level: 3 });
    check('setEnemyLevel heals by the bonus delta only (70 + 20, not a full heal)',
      h.maxHealth === 120 && h.health === 90 &&
      SC.hpBonusOf(ctx._sc, 'hero') === 20,
      JSON.stringify({ maxHealth: h.maxHealth, health: h.health }));
  }
  {
    const ctx = scCtx();
    const h = hero(ctx, 1);
    ex(ctx, { type: 'setScalingRates', targetObject: 'hero', hpPerLevel: 50, dmgPerLevel: 5 });
    check('setScalingRates at level 1 changes nothing live (the bonus is still 0)',
      SC.hpPerLevelOf(ctx._sc, 'hero') === 50 &&
      SC.dmgPerLevelOf(ctx._sc, 'hero') === 5 &&
      SC.hpBonusOf(ctx._sc, 'hero') === 0 &&
      h.maxHealth === undefined,
      JSON.stringify({ maxHealth: h.maxHealth }));
    ex(ctx, { type: 'setEnemyLevel', targetObject: 'hero', level: 2 });
    check('the new rates apply at once once the level rises (level 2 is +50 HP, +5 damage)',
      h.maxHealth === 150 && h.health === 150 &&
      SC.hpBonusOf(ctx._sc, 'hero') === 50 &&
      SC.dmgBonusOf(ctx._sc, 'hero') === 5,
      JSON.stringify({ maxHealth: h.maxHealth, health: h.health }));
    ex(ctx, { type: 'setEnemyLevel', targetObject: 'hero', level: 1 });
    check('lowering the level back to 1 drops the ceiling and clamps the health',
      h.maxHealth === 100 && h.health === 100 &&
      SC.hpBonusOf(ctx._sc, 'hero') === 0,
      JSON.stringify({ maxHealth: h.maxHealth, health: h.health }));
  }
  {
    // Scale to Hero Level copies the run's current player level.
    nowValue = 1000;
    const xpSt = XP.createXpState();
    const ctx = scCtx({ xpModule: XP, xp: xpSt });
    const h = hero(ctx, 1);
    ex(ctx, { type: 'addXp', amount: 250 });
    check('the hero sits at level 3 after 250 XP',
      XP.levelOf(xpSt) === 3, `level=${XP.levelOf(xpSt)}`);
    ex(ctx, { type: 'scaleToHeroLevel', targetObject: 'hero' });
    check('scaleToHeroLevel copies the hero level onto the enemy (+20 HP, +4 damage)',
      SC.levelOf(ctx._sc, 'hero') === 3 &&
      SC.hpBonusOf(ctx._sc, 'hero') === 20 &&
      h.maxHealth === 120 && h.health === 120,
      JSON.stringify({ maxHealth: h.maxHealth, health: h.health }));
    const ctx2 = scCtx();
    const h2 = hero(ctx2, 1);
    ex(ctx2, { type: 'scaleToHeroLevel', targetObject: 'hero' });
    check('scaleToHeroLevel reads level 1 in a game that never touched XP (a no-op)',
      SC.levelOf(ctx2._sc, 'hero') === 1 &&
      SC.hpBonusOf(ctx2._sc, 'hero') === 0 && h2.maxHealth === undefined);
  }
  {
    const ctx = scCtx();
    const h = hero(ctx, 1);
    warnings.length = 0;
    ex(ctx, { type: 'setEnemyLevel', targetObject: 'hero', level: 'oops' });
    check('setEnemyLevel warns and holds on a bad level',
      warnings.length === 1 && /not a number/.test(warnings[0]) &&
      h.maxHealth === undefined && SC.levelOf(ctx._sc, 'hero') === 1,
      JSON.stringify(warnings));
    warnings.length = 0;
    ex(ctx, { type: 'setScalingRates', targetObject: 'hero', hpPerLevel: 'oops', dmgPerLevel: 2 });
    check('setScalingRates warns and holds on a bad rate',
      warnings.length === 1 && /not a number/.test(warnings[0]) &&
      SC.hpPerLevelOf(ctx._sc, 'hero') === 10,
      JSON.stringify(warnings));
    warnings.length = 0;
    ex(ctx, { type: 'readScaledDmgBonus', targetObject: 'hero', varName: '' });
    check('readScaledDmgBonus warns and holds on a blank variable name',
      warnings.length === 1 && /blank/.test(warnings[0]),
      JSON.stringify(warnings));
    warnings.length = 0;
    ex(ctx, { type: 'setEnemyLevel', targetObject: 'nobody', level: 3 });
    check('setEnemyLevel stays quiet on a missing object',
      warnings.length === 0 && SC.levelOf(ctx._sc, 'hero') === 1);
    warnings.length = 0;
    ex(ctx, { type: 'readEnemyLevel', targetObject: 'nobody', varName: 'eLvl' });
    check('readEnemyLevel on a missing object reads the default 1',
      warnings.length === 0 && ctx.variables.eLvl === 1, `eLvl=${ctx.variables.eLvl}`);
  }
  {
    // The scaled damage bonus rides into melee swings and shots.
    nowValue = 1000;
    const cbSt = CB.createCombatState();
    const scSt = SC.createScalingState();
    const ctx = makeCtx({
      combatModule: CB, combat: cbSt,
      healthModule: HP, damageFxModule: DF,
      scalingModule: SC, scaling: scSt
    });
    ctx._cb = cbSt; ctx._sc = scSt;
    warnings.length = 0;
    ex(ctx, { type: 'setEnemyLevel', targetObject: 'hero', level: 3 });
    ex(ctx, { type: 'meleeAttack', targetObject: 'hero', damage: 10, range: 100, direction: 'right', cooldown: 0.5 });
    check('meleeAttack adds the scaled damage bonus (10 + 4)',
      hero(ctx, 2).health === 86 && hero(ctx, 8).health === 86,
      JSON.stringify({ wall: hero(ctx, 2).health, box: hero(ctx, 8).health }));
    ex(ctx, { type: 'shootProjectile', targetObject: 'hero', projectileObject: 'coin', direction: 'right', speed: 300, damage: 10, lifetime: 2, cooldown: 0.5 });
    check('shootProjectile carries the scaled damage on the projectile',
      ctx._cb.projectiles.length === 1 && ctx._cb.projectiles[0].damage === 14,
      JSON.stringify(ctx._cb.projectiles.map(p => p.damage)));
  }
  {
    // Growth and scaling stack: a grown hero that is also scaled hits
    // for block + growth + scaling.
    nowValue = 1000;
    const cbSt = CB.createCombatState();
    const grSt = GR.createGrowthState();
    const scSt = SC.createScalingState();
    const ctx = makeCtx({
      combatModule: CB, combat: cbSt,
      healthModule: HP, damageFxModule: DF,
      growthModule: GR, growth: grSt,
      scalingModule: SC, scaling: scSt
    });
    ctx._cb = cbSt; ctx._gr = grSt; ctx._sc = scSt;
    ex(ctx, { type: 'growDamage', targetObject: 'hero', amount: 5 });
    ex(ctx, { type: 'setEnemyLevel', targetObject: 'hero', level: 3 });
    ex(ctx, { type: 'meleeAttack', targetObject: 'hero', damage: 10, range: 100, direction: 'right', cooldown: 0.5 });
    check('meleeAttack stacks growth and scaling (10 + 5 + 4)',
      hero(ctx, 2).health === 81,
      JSON.stringify({ wall: hero(ctx, 2).health }));
  }
  {
    const ctx = makeCtx({});
    warnings.length = 0;
    ex(ctx, { type: 'setEnemyLevel', targetObject: 'hero', level: 3 });
    ex(ctx, { type: 'setScalingRates', targetObject: 'hero', hpPerLevel: 10, dmgPerLevel: 2 });
    ex(ctx, { type: 'scaleToHeroLevel', targetObject: 'hero' });
    ex(ctx, { type: 'readScaledDmgBonus', targetObject: 'hero', varName: 'sDmg' });
    check('scaling actions stay quiet without the module',
      warnings.length === 0 && ctx.variables.sDmg === undefined);
    const ctx2 = makeCtx({ scalingModule: SC, healthModule: HP });
    warnings.length = 0;
    ex(ctx2, { type: 'setEnemyLevel', targetObject: 'hero', level: 3 });
    check('scaling writes stay quiet without a live scaling state',
      warnings.length === 0);
    ex(ctx2, { type: 'readEnemyLevel', targetObject: 'hero', varName: 'eLvl' });
    check('readEnemyLevel without a live scaling state reads the default 1',
      ctx2.variables.eLvl === 1, `eLvl=${ctx2.variables.eLvl}`);
    ex(ctx2, { type: 'readScaledHpBonus', targetObject: 'hero', varName: 'sHp' });
    check('readScaledHpBonus without a live scaling state reads the default 0',
      ctx2.variables.sHp === 0, `sHp=${ctx2.variables.sHp}`);
  }
}

// --- Boss actions (P4 Advanced batch 33) ---
{
  function boCtx(over) {
    const st = BO.createBossState();
    const ctx = makeCtx(Object.assign({
      bossModule: BO,
      boss: st,
      healthModule: HP
    }, over || {}));
    ctx._bo = st;
    return ctx;
  }
  {
    const ctx = boCtx();
    const h = hero(ctx, 1);
    h.health = 300; h.maxHealth = 300;
    check('a fresh boss state has no fight running',
      BO.isActive(ctx._bo) === false);
    ex(ctx, { type: 'startBoss', targetObject: 'hero', phases: 3, showBar: true });
    check('startBoss starts the fight with the named boss, 3 phases, bar showing',
      BO.isActive(ctx._bo) === true && ctx._bo.objectName === 'hero' &&
      ctx._bo.phases === 3 && ctx._bo.barVisible === true);
    ex(ctx, { type: 'readBossPhase', varName: 'bPhase' });
    check('readBossPhase reads 1 at full health',
      ctx.variables.bPhase === 1, `bPhase=${ctx.variables.bPhase}`);
    h.health = 150;
    ex(ctx, { type: 'readBossPhase', varName: 'bPhase' });
    check('readBossPhase reads 2 at half health',
      ctx.variables.bPhase === 2, `bPhase=${ctx.variables.bPhase}`);
    h.health = 50;
    ex(ctx, { type: 'readBossPhase', varName: 'bPhase' });
    check('readBossPhase reads 3 in the final slice',
      ctx.variables.bPhase === 3, `bPhase=${ctx.variables.bPhase}`);
    ex(ctx, { type: 'hideBossBar' });
    check('hideBossBar hides the bar without ending the fight',
      ctx._bo.barVisible === false && BO.isActive(ctx._bo) === true);
    ex(ctx, { type: 'showBossBar' });
    check('showBossBar brings the bar back',
      ctx._bo.barVisible === true);
    ex(ctx, { type: 'endBoss' });
    check('endBoss clears the fight (bar hides, phase reads 0 again)',
      BO.isActive(ctx._bo) === false && ctx._bo.barVisible === false);
    ex(ctx, { type: 'readBossPhase', varName: 'bPhase' });
    check('readBossPhase reads 0 with no fight running',
      ctx.variables.bPhase === 0, `bPhase=${ctx.variables.bPhase}`);
  }
  {
    const ctx = boCtx();
    warnings.length = 0;
    ex(ctx, { type: 'startBoss', targetObject: '', phases: 3, showBar: true });
    check('startBoss with a blank object name warns and holds (no fight starts)',
      warnings.length === 1 && BO.isActive(ctx._bo) === false,
      `warnings=${JSON.stringify(warnings)}`);
    ex(ctx, { type: 'startBoss', targetObject: 'hero', phases: 'oops', showBar: true });
    check('startBoss with a bad phase count warns and holds',
      warnings.length === 2 && BO.isActive(ctx._bo) === false);
    ex(ctx, { type: 'startBoss', targetObject: 'hero', phases: 3, showBar: true });
    check('a good startBoss after the bad ones starts the fight',
      BO.isActive(ctx._bo) === true && warnings.length === 2);
    ex(ctx, { type: 'readBossPhase', varName: '' });
    check('readBossPhase with a blank variable name warns and holds',
      warnings.length === 3 && ctx.variables[''] === undefined);
  }
  {
    const ctx = makeCtx({});
    warnings.length = 0;
    ex(ctx, { type: 'startBoss', targetObject: 'hero', phases: 3, showBar: true });
    ex(ctx, { type: 'endBoss' });
    ex(ctx, { type: 'showBossBar' });
    ex(ctx, { type: 'hideBossBar' });
    ex(ctx, { type: 'readBossPhase', varName: 'bPhase' });
    check('boss actions stay quiet without the module',
      warnings.length === 0 && ctx.variables.bPhase === undefined);
    const ctx2 = makeCtx({ bossModule: BO, healthModule: HP });
    warnings.length = 0;
    ex(ctx2, { type: 'startBoss', targetObject: 'hero', phases: 3, showBar: true });
    check('boss writes stay quiet without a live boss state',
      warnings.length === 0);
    ex(ctx2, { type: 'readBossPhase', varName: 'bPhase' });
    check('readBossPhase without a live boss state reads 0',
      ctx2.variables.bPhase === 0, `bPhase=${ctx2.variables.bPhase}`);
  }
}

// --- Minimap actions (P4 Advanced batch 36) ---
{
  function mmCtx(over) {
    const st = MM.createMinimapState({ enabled: true, corner: 'top-right', size: 160, zoom: 1, showViewport: true });
    const ctx = makeCtx(Object.assign({
      minimapModule: MM,
      minimap: st
    }, over || {}));
    ctx._mm = st;
    return ctx;
  }
  {
    const ctx = mmCtx();
    check('a fresh minimap state shows (the scene enabled it)',
      MM.isVisible(ctx._mm) === true);
    ex(ctx, { type: 'hideMinimap' });
    check('hideMinimap hides the map without touching the authored config',
      MM.isVisible(ctx._mm) === false);
    ex(ctx, { type: 'showMinimap' });
    check('showMinimap brings the map back',
      MM.isVisible(ctx._mm) === true);
    ex(ctx, { type: 'setMinimapSize', size: 240 });
    check('setMinimapSize writes the run record size',
      ctx._mm.size === 240, `size=${ctx._mm.size}`);
    ex(ctx, { type: 'setMinimapZoom', zoom: 2 });
    check('setMinimapZoom writes the run record zoom',
      ctx._mm.zoom === 2, `zoom=${ctx._mm.zoom}`);
    ex(ctx, { type: 'setMinimapSize', size: 999 });
    check('setMinimapSize clamps past the cap instead of warning',
      ctx._mm.size === 400, `size=${ctx._mm.size}`);
  }
  {
    const ctx = mmCtx();
    warnings.length = 0;
    ex(ctx, { type: 'setMinimapSize', size: 'oops' });
    check('setMinimapSize with a bad size warns and holds',
      warnings.length === 1 && ctx._mm.size === 160,
      `warnings=${JSON.stringify(warnings)}`);
    ex(ctx, { type: 'setMinimapZoom', zoom: 'oops' });
    check('setMinimapZoom with a bad zoom warns and holds',
      warnings.length === 2 && ctx._mm.zoom === 1);
  }
  {
    const ctx = makeCtx({});
    warnings.length = 0;
    ex(ctx, { type: 'showMinimap' });
    ex(ctx, { type: 'hideMinimap' });
    ex(ctx, { type: 'setMinimapSize', size: 200 });
    ex(ctx, { type: 'setMinimapZoom', zoom: 2 });
    check('minimap actions stay quiet without the module',
      warnings.length === 0);
    const ctx2 = makeCtx({ minimapModule: MM });
    warnings.length = 0;
    ex(ctx2, { type: 'showMinimap' });
    ex(ctx2, { type: 'setMinimapSize', size: 200 });
    check('minimap writes stay quiet without a live minimap state',
      warnings.length === 0);
  }
}

// --- Attach actions (P4 Advanced batch 37) ---
{
  function atCtx(over) {
    const st = AT.createAttachState();
    const ctx = makeCtx(Object.assign({
      attachModule: AT,
      attachments: st
    }, over || {}));
    ctx._at = st;
    return ctx;
  }
  {
    const ctx = atCtx();
    warnings.length = 0;
    // Blank offsets keep the spacing the objects already have:
    // ghost (300,20) on hero (10,20) reads dx 290, dy 0.
    ex(ctx, { type: 'attachObjectToObject', childObject: 'ghost', parentObject: 'hero', offsetX: '', offsetY: '' });
    check('attachObjectToObject with blank offsets keeps the current spacing',
      AT.isAttached(ctx._at, 'ghost', 'hero') &&
      AT.attachmentOf(ctx._at, 'ghost').dx === 290 &&
      AT.attachmentOf(ctx._at, 'ghost').dy === 0,
      JSON.stringify(AT.attachmentOf(ctx._at, 'ghost')));
    ex(ctx, { type: 'setAttachmentOffset', targetObject: 'ghost', offsetX: 10, offsetY: -20 });
    check('setAttachmentOffset moves the spacing without re-attaching',
      AT.attachmentOf(ctx._at, 'ghost').dx === 10 &&
      AT.attachmentOf(ctx._at, 'ghost').dy === -20 &&
      AT.isAttached(ctx._at, 'ghost', 'hero'));
    ex(ctx, { type: 'attachObjectToObject', childObject: 'box', parentObject: 'hero', offsetX: 5, offsetY: 6 });
    check('attachObjectToObject with given offsets stores them',
      AT.attachmentOf(ctx._at, 'box').dx === 5 &&
      AT.attachmentOf(ctx._at, 'box').dy === 6);
    ex(ctx, { type: 'detachObject', targetObject: 'ghost' });
    check('detachObject drops the link',
      !AT.isAttached(ctx._at, 'ghost') && AT.attachCount(ctx._at) === 1);
    ex(ctx, { type: 'detachObject', targetObject: 'ghost' });
    check('detachObject stays quiet when the object is not attached',
      warnings.length === 0);
  }
  {
    const ctx = atCtx();
    warnings.length = 0;
    ex(ctx, { type: 'attachObjectToObject', childObject: '', parentObject: 'hero', offsetX: '', offsetY: '' });
    check('attachObjectToObject with a blank child warns and holds',
      warnings.length === 1 && AT.attachCount(ctx._at) === 0);
    ex(ctx, { type: 'attachObjectToObject', childObject: 'ghost', parentObject: '', offsetX: '', offsetY: '' });
    check('attachObjectToObject with a blank parent warns and holds',
      warnings.length === 2 && AT.attachCount(ctx._at) === 0);
    ex(ctx, { type: 'attachObjectToObject', childObject: 'hero', parentObject: 'hero', offsetX: '', offsetY: '' });
    check('attachObjectToObject with a self-attach warns and holds',
      warnings.length === 3 && AT.attachCount(ctx._at) === 0);
    ex(ctx, { type: 'attachObjectToObject', childObject: 'ghost', parentObject: 'hero', offsetX: 'oops', offsetY: '' });
    check('attachObjectToObject with a bad offset warns and holds',
      warnings.length === 4 && AT.attachCount(ctx._at) === 0);
    ex(ctx, { type: 'attachObjectToObject', childObject: 'ghost', parentObject: 'cloak', offsetX: '', offsetY: '' });
    check('attachObjectToObject with a missing parent warns instead of guessing the spacing',
      warnings.length === 5 && AT.attachCount(ctx._at) === 0);
    ex(ctx, { type: 'detachObject', targetObject: '' });
    check('detachObject with a blank object warns',
      warnings.length === 6);
    ex(ctx, { type: 'setAttachmentOffset', targetObject: '', offsetX: 0, offsetY: 0 });
    check('setAttachmentOffset with a blank object warns',
      warnings.length === 7);
    ex(ctx, { type: 'setAttachmentOffset', targetObject: 'ghost', offsetX: 'oops', offsetY: 0 });
    check('setAttachmentOffset with a bad offset warns and holds',
      warnings.length === 8);
    ex(ctx, { type: 'setAttachmentOffset', targetObject: 'ghost', offsetX: 0, offsetY: 0 });
    check('setAttachmentOffset on an unattached object warns and holds',
      warnings.length === 9);
    // The cycle: ghost on hero, then hero on ghost is refused.
    ex(ctx, { type: 'attachObjectToObject', childObject: 'ghost', parentObject: 'hero', offsetX: 0, offsetY: 0 });
    ex(ctx, { type: 'attachObjectToObject', childObject: 'hero', parentObject: 'ghost', offsetX: 0, offsetY: 0 });
    check('attachObjectToObject refusing a cycle warns and holds',
      warnings.length === 10 && AT.attachCount(ctx._at) === 1 &&
      !AT.isAttached(ctx._at, 'hero'));
  }
  {
    const ctx = makeCtx({});
    warnings.length = 0;
    ex(ctx, { type: 'attachObjectToObject', childObject: 'ghost', parentObject: 'hero', offsetX: 0, offsetY: 0 });
    ex(ctx, { type: 'detachObject', targetObject: 'ghost' });
    ex(ctx, { type: 'setAttachmentOffset', targetObject: 'ghost', offsetX: 0, offsetY: 0 });
    check('attach actions stay quiet without the module',
      warnings.length === 0);
    const ctx2 = makeCtx({ attachModule: AT });
    warnings.length = 0;
    ex(ctx2, { type: 'attachObjectToObject', childObject: 'ghost', parentObject: 'hero', offsetX: 0, offsetY: 0 });
    check('attach writes stay quiet without a live link table',
      warnings.length === 0);
  }
}

// --- Tag actions (P4 Advanced batch 34) ---
{
  function tgCtx(over) {
    return makeCtx(Object.assign({ tagsModule: TG }, over || {}));
  }
  {
    const ctx = tgCtx();
    const g = hero(ctx, 4);
    ex(ctx, { type: 'addTag', targetObject: 'ghost', tag: 'goblin' });
    check('addTag sticks the tag on the live object',
      JSON.stringify(g.tags) === JSON.stringify(['goblin']), JSON.stringify(g.tags));
    ex(ctx, { type: 'addTag', targetObject: 'ghost', tag: 'GOBLIN' });
    check('addTag refuses the same tag in another case (one goblin, first spelling kept)',
      JSON.stringify(g.tags) === JSON.stringify(['goblin']), JSON.stringify(g.tags));
    ex(ctx, { type: 'addTag', targetObject: 'ghost', tag: 'elite' });
    check('addTag adds a second tag beside the first',
      JSON.stringify(g.tags) === JSON.stringify(['goblin', 'elite']), JSON.stringify(g.tags));
    ex(ctx, { type: 'readTaggedCount', tag: 'goblin', varName: 'gLeft' });
    check('readTaggedCount copies the live count into a variable',
      ctx.variables.gLeft === 1, `gLeft=${ctx.variables.gLeft}`);
    ex(ctx, { type: 'addTag', targetObject: 'hero', tag: 'goblin' });
    ex(ctx, { type: 'readTaggedCount', tag: 'goblin', varName: 'gLeft' });
    check('readTaggedCount counts every live object carrying the tag (ghost + first hero)',
      ctx.variables.gLeft === 2, `gLeft=${ctx.variables.gLeft}`);
    ex(ctx, { type: 'removeTag', targetObject: 'ghost', tag: 'ELITE' });
    check('removeTag takes the tag off in any case',
      JSON.stringify(g.tags) === JSON.stringify(['goblin']), JSON.stringify(g.tags));
    ex(ctx, { type: 'removeTag', targetObject: 'ghost', tag: 'coin' });
    check('removeTag stays quiet when the tag was never there',
      JSON.stringify(g.tags) === JSON.stringify(['goblin']), JSON.stringify(g.tags));
    ex(ctx, { type: 'clearTags', targetObject: 'ghost' });
    check('clearTags takes every tag off at once',
      g.tags.length === 0, JSON.stringify(g.tags));
    ex(ctx, { type: 'readTaggedCount', tag: 'goblin', varName: 'gLeft' });
    check('readTaggedCount drops to 1 after the clear (only the hero still carries it)',
      ctx.variables.gLeft === 1, `gLeft=${ctx.variables.gLeft}`);
  }
  {
    const ctx = tgCtx();
    warnings.length = 0;
    ex(ctx, { type: 'addTag', targetObject: '', tag: 'goblin' });
    check('addTag with a blank object warns and holds',
      warnings.length === 1 && hero(ctx, 4).tags === undefined,
      `warnings=${JSON.stringify(warnings)}`);
    ex(ctx, { type: 'addTag', targetObject: 'ghost', tag: '' });
    check('addTag with a blank tag warns and holds',
      warnings.length === 2 && hero(ctx, 4).tags === undefined);
    ex(ctx, { type: 'removeTag', targetObject: 'ghost', tag: '' });
    check('removeTag with a blank tag warns and holds',
      warnings.length === 3);
    ex(ctx, { type: 'clearTags', targetObject: '' });
    check('clearTags with a blank object warns and holds',
      warnings.length === 4);
    ex(ctx, { type: 'readTaggedCount', tag: '', varName: 'gLeft' });
    check('readTaggedCount with a blank tag warns and holds',
      warnings.length === 5 && ctx.variables.gLeft === undefined);
    ex(ctx, { type: 'readTaggedCount', tag: 'goblin', varName: '' });
    check('readTaggedCount with a blank variable name warns and holds',
      warnings.length === 6 && ctx.variables[''] === undefined);
  }
  {
    const ctx = makeCtx({});
    warnings.length = 0;
    ex(ctx, { type: 'addTag', targetObject: 'ghost', tag: 'goblin' });
    ex(ctx, { type: 'removeTag', targetObject: 'ghost', tag: 'goblin' });
    ex(ctx, { type: 'clearTags', targetObject: 'ghost' });
    ex(ctx, { type: 'readTaggedCount', tag: 'goblin', varName: 'gLeft' });
    check('tag actions stay quiet without the module',
      warnings.length === 0 && ctx.variables.gLeft === undefined &&
      hero(ctx, 4).tags === undefined);
  }
}

// --- Scoped variable actions (P5 core-engine track, item P5-1 slice a) ---
{
  function vvCtx(over) {
    const st = VV.createVariablesState();
    const ctx = makeCtx(Object.assign({
      varScopesModule: VV,
      varScopes: st
    }, over || {}));
    ctx._vv = st;
    return ctx;
  }
  {
    const ctx = vvCtx();
    check('a fresh scoped-variable state holds nothing anywhere',
      JSON.stringify(ctx._vv) === JSON.stringify({ global: {}, scene: {}, object: {}, local: {} }));
    ex(ctx, { type: 'setScopedVariable', scope: 'global', varName: 'score', valueKind: 'number', value: 10 });
    check('setScopedVariable stores a typed global number',
      VV.get(ctx._vv, 'global', 'score').type === 'number' &&
      VV.read(ctx._vv, 'global', 'score', 0) === 10);
    ex(ctx, { type: 'readScopedVariable', scope: 'global', varName: 'score', storeVarName: 'shown' });
    check('readScopedVariable copies the value into a flat variable',
      ctx.variables.shown === 10);
  }
  {
    // One name, three scopes, three values — the acceptance shape.
    const ctx = vvCtx();
    ex(ctx, { type: 'setScopedVariable', scope: 'global', varName: 'coins', valueKind: 'number', value: 100 });
    ex(ctx, { type: 'setScopedVariable', scope: 'scene', varName: 'coins', valueKind: 'number', value: 5 });
    ex(ctx, { type: 'setScopedVariable', scope: 'object', targetObject: 'goblin', varName: 'coins', valueKind: 'number', value: 7 });
    ex(ctx, { type: 'readScopedVariable', scope: 'global', varName: 'coins', storeVarName: 'gCoins' });
    ex(ctx, { type: 'readScopedVariable', scope: 'scene', varName: 'coins', storeVarName: 'sCoins' });
    ex(ctx, { type: 'readScopedVariable', scope: 'object', targetObject: 'goblin', varName: 'coins', storeVarName: 'oCoins' });
    check('global, scene, and object scopes keep the same name apart',
      ctx.variables.gCoins === 100 && ctx.variables.sCoins === 5 && ctx.variables.oCoins === 7,
      JSON.stringify(ctx.variables));
    // A second scene sees its own map, not scene 1's.
    ctx.sceneId = 2;
    ex(ctx, { type: 'readScopedVariable', scope: 'scene', varName: 'coins', storeVarName: 'sCoins2' });
    check('a scene variable from scene 1 is missing in scene 2 (reads as 0)',
      ctx.variables.sCoins2 === 0);
    ex(ctx, { type: 'setScopedVariable', scope: 'scene', varName: 'coins', valueKind: 'number', value: 99 });
    ex(ctx, { type: 'readScopedVariable', scope: 'scene', varName: 'coins', storeVarName: 'sCoins2' });
    check('scene 2 keeps its own value for the same name',
      ctx.variables.sCoins2 === 99);
    // Back in scene 1 the first value is still there (the host clears
    // it on load; the execute layer never clears on its own).
    ctx.sceneId = 1;
    ex(ctx, { type: 'readScopedVariable', scope: 'scene', varName: 'coins', storeVarName: 'sCoins' });
    check('returning to scene 1 still reads its own value',
      ctx.variables.sCoins === 5);
    // Global and object scopes survive the scene hops untouched.
    ex(ctx, { type: 'readScopedVariable', scope: 'global', varName: 'coins', storeVarName: 'gCoins' });
    ex(ctx, { type: 'readScopedVariable', scope: 'object', targetObject: 'goblin', varName: 'coins', storeVarName: 'oCoins' });
    check('global and object scopes survive scene switches',
      ctx.variables.gCoins === 100 && ctx.variables.oCoins === 7);
  }
  {
    // The object scope needs a name, not a live object: 'dragon' is
    // not in the fixture world, and the variable still stores.
    const ctx = vvCtx();
    warnings.length = 0;
    ex(ctx, { type: 'setScopedVariable', scope: 'object', targetObject: 'dragon', varName: 'hp', valueKind: 'number', value: 30 });
    ex(ctx, { type: 'readScopedVariable', scope: 'object', targetObject: 'dragon', varName: 'hp', storeVarName: 'dHp' });
    check('an object-scope variable stores for a name with no live object',
      ctx.variables.dHp === 30 && warnings.length === 0);
  }
  {
    // Value kinds: text, true/false, and a copy of another variable.
    const ctx = vvCtx();
    ex(ctx, { type: 'setScopedVariable', scope: 'global', varName: 'title', valueKind: 'text', value: 'hero' });
    ex(ctx, { type: 'setScopedVariable', scope: 'global', varName: 'won', valueKind: 'true', value: '' });
    ex(ctx, { type: 'setScopedVariable', scope: 'global', varName: 'lost', valueKind: 'false', value: '' });
    ex(ctx, { type: 'setScopedVariable', scope: 'global', varName: 'copied', valueKind: 'variable', value: 'score' });
    check('text, true, and false store with their types, and variable copies the flat value (score is 5)',
      VV.get(ctx._vv, 'global', 'title').type === 'text' &&
      VV.read(ctx._vv, 'global', 'title', '') === 'hero' &&
      VV.read(ctx._vv, 'global', 'won', false) === true &&
      VV.read(ctx._vv, 'global', 'lost', true) === false &&
      VV.read(ctx._vv, 'global', 'copied', 0) === 5);
    ex(ctx, { type: 'readScopedVariable', scope: 'global', varName: 'title', storeVarName: 'shownTitle' });
    check('reading a text variable back gives the text, not a number',
      ctx.variables.shownTitle === 'hero');
  }
  {
    const ctx = vvCtx();
    ex(ctx, { type: 'setScopedVariable', scope: 'global', varName: 'score', valueKind: 'number', value: 10 });
    warnings.length = 0;
    ex(ctx, { type: 'setScopedVariable', scope: 'global', varName: 'score', valueKind: 'number', value: 'score + 1' });
    check('setScopedVariable warns and holds on a bad number expression',
      warnings.length === 1 && /not a number/.test(warnings[0]) &&
      VV.read(ctx._vv, 'global', 'score', 0) === 10,
      warnings.join(' | '));
    warnings.length = 0;
    ex(ctx, { type: 'setScopedVariable', scope: 'global', varName: '  ', valueKind: 'number', value: 1 });
    check('setScopedVariable warns and holds on a blank name',
      warnings.length === 1 && /blank/.test(warnings[0]) &&
      JSON.stringify(ctx._vv.global) === JSON.stringify({ score: { type: 'number', value: 10 } }),
      warnings.join(' | '));
    warnings.length = 0;
    ex(ctx, { type: 'setScopedVariable', scope: 'object', targetObject: '', varName: 'hp', valueKind: 'number', value: 3 });
    check('setScopedVariable warns and holds when the object scope has no object',
      warnings.length === 1 && /needs an object/.test(warnings[0]) &&
      VV.read(ctx._vv, 'object', 'hp', 0, { objectName: 'goblin' }) === 0,
      warnings.join(' | '));
    warnings.length = 0;
    ex(ctx, { type: 'readScopedVariable', scope: 'global', varName: 'score', storeVarName: '  ' });
    check('readScopedVariable warns and holds on a blank target variable',
      warnings.length === 1 && /blank/.test(warnings[0]) &&
      ctx.variables['  '] === undefined,
      warnings.join(' | '));
  }
  {
    const ctx = vvCtx();
    ex(ctx, { type: 'readScopedVariable', scope: 'global', varName: 'missing', storeVarName: 'm' });
    check('reading a missing variable writes the 0 default',
      ctx.variables.m === 0);
    warnings.length = 0;
    ex(ctx, { type: 'deleteScopedVariable', scope: 'global', varName: 'missing' });
    check('deleting a missing variable stays quiet',
      warnings.length === 0);
    ex(ctx, { type: 'setScopedVariable', scope: 'global', varName: 'gone', valueKind: 'number', value: 4 });
    ex(ctx, { type: 'deleteScopedVariable', scope: 'global', varName: 'gone' });
    check('deleteScopedVariable removes the variable',
      VV.has(ctx._vv, 'global', 'gone') === false);
    warnings.length = 0;
    ex(ctx, { type: 'deleteScopedVariable', scope: 'global', varName: '  ' });
    check('deleteScopedVariable warns and holds on a blank name',
      warnings.length === 1 && /blank/.test(warnings[0]),
      warnings.join(' | '));
  }
  {
    const ctx = vvCtx();
    ex(ctx, { type: 'setScopedVariable', scope: 'global', varName: 'a', valueKind: 'number', value: 1 });
    ex(ctx, { type: 'setScopedVariable', scope: 'scene', varName: 'b', valueKind: 'number', value: 2 });
    ex(ctx, { type: 'setScopedVariable', scope: 'object', targetObject: 'goblin', varName: 'c', valueKind: 'number', value: 3 });
    ex(ctx, { type: 'setScopedVariable', scope: 'object', targetObject: 'hero', varName: 'd', valueKind: 'number', value: 4 });
    ex(ctx, { type: 'clearScopedVariables', scope: 'scene' });
    check('clearing the scene scope leaves global and object scopes alone',
      VV.read(ctx._vv, 'scene', 'b', 0, { sceneId: 1 }) === 0 &&
      VV.read(ctx._vv, 'global', 'a', 0) === 1 &&
      VV.read(ctx._vv, 'object', 'c', 0, { objectName: 'goblin' }) === 3);
    ex(ctx, { type: 'clearScopedVariables', scope: 'object', targetObject: 'goblin' });
    check('clearing the object scope for one object leaves the other object alone',
      VV.read(ctx._vv, 'object', 'c', 0, { objectName: 'goblin' }) === 0 &&
      VV.read(ctx._vv, 'object', 'd', 0, { objectName: 'hero' }) === 4);
    ex(ctx, { type: 'clearScopedVariables', scope: 'object', targetObject: '' });
    check('clearing the object scope with no object clears every object',
      VV.read(ctx._vv, 'object', 'd', 0, { objectName: 'hero' }) === 0);
    ex(ctx, { type: 'clearScopedVariables', scope: 'global' });
    check('clearing the global scope empties it',
      VV.read(ctx._vv, 'global', 'a', 0) === 0);
  }
  {
    const ctx = makeCtx({});
    warnings.length = 0;
    ex(ctx, { type: 'setScopedVariable', scope: 'global', varName: 'x', valueKind: 'number', value: 1 });
    ex(ctx, { type: 'readScopedVariable', scope: 'global', varName: 'x', storeVarName: 'rx' });
    ex(ctx, { type: 'deleteScopedVariable', scope: 'global', varName: 'x' });
    ex(ctx, { type: 'clearScopedVariables', scope: 'global' });
    check('scoped-variable actions stay quiet without the module',
      warnings.length === 0 && ctx.variables.rx === undefined);
    const ctx2 = makeCtx({ varScopesModule: VV });
    warnings.length = 0;
    ex(ctx2, { type: 'setScopedVariable', scope: 'global', varName: 'x', valueKind: 'number', value: 1 });
    check('scoped-variable writes stay quiet without a live state',
      warnings.length === 0);
    ex(ctx2, { type: 'readScopedVariable', scope: 'global', varName: 'x', storeVarName: 'rx' });
    check('readScopedVariable without a live state reads the default 0',
      ctx2.variables.rx === 0);
  }
}

// --- Movement actions (P4 Advanced batch 26) ---
{
  function mvCtx(over) {
    const st = MV.createMovementState();
    const ctx = makeCtx(Object.assign({
      movementModule: MV,
      movement: st
    }, over || {}));
    ctx._mv = st;
    return ctx;
  }
  {
    // The fixture hero (id 1) stands on the fixture floor (id 6): hero
    // bottom 60 meets floor top 60, so Jump reads grounded.
    const ctx = mvCtx();
    const h = hero(ctx, 1);
    ex(ctx, { type: 'jump', targetObject: 'hero', jumpSpeed: 12 });
    check('jump on the ground sets the upward speed',
      h.velY === -12, `velY=${h.velY}`);
    check('a single-jump hero has no jumps left after the ground jump',
      MV.jumpsLeft(ctx._mv, h) === 0, `left=${MV.jumpsLeft(ctx._mv, h)}`);
  }
  {
    const ctx = mvCtx();
    const h = hero(ctx, 1);
    ex(ctx, { type: 'setMaxJumps', targetObject: 'hero', jumps: 2 });
    check('setMaxJumps writes the authored jump count',
      h.movement && h.movement.maxJumps === 2, JSON.stringify(h.movement));
    ex(ctx, { type: 'jump', targetObject: 'hero', jumpSpeed: 12 });
    // No physics step runs in this unit ctx, so the hero never leaves
    // the floor on its own — move it into empty air for the air jump.
    // (posX 500 clears the label and box, which the shared grounded
    // rule would also read as floors.)
    h.posX = 500; h.posY = 0;
    ex(ctx, { type: 'jump', targetObject: 'hero', jumpSpeed: 12 });
    check('the second jump is the air jump (double jump)',
      h.velY === -12 && MV.jumpsLeft(ctx._mv, h) === 0, `velY=${h.velY}`);
    h.velY = 0;
    ex(ctx, { type: 'jump', targetObject: 'hero', jumpSpeed: 12 });
    check('a third jump with no jumps left buffers instead of moving',
      h.velY === 0, `velY=${h.velY}`);
  }
  {
    const ctx = mvCtx();
    const h = hero(ctx, 1);
    h.velX = 5; h.velY = 3;
    ex(ctx, { type: 'dash', targetObject: 'hero', direction: 'right', speed: 400, duration: 0.15, cooldown: 0.5 });
    check('dash zeroes the velocity at once',
      h.velX === 0 && h.velY === 0, `velX=${h.velX} velY=${h.velY}`);
    check('dash reports dashing on the frozen clock',
      MV.isDashing(ctx._mv, h, nowValue / 1000) === true);
    ex(ctx, { type: 'dash', targetObject: 'hero', direction: 'left', speed: 400, duration: 0.15, cooldown: 0.5 });
    check('a second dash while dashing is ignored',
      MV.isDashing(ctx._mv, h, nowValue / 1000) === true);
  }
  {
    const ctx = mvCtx();
    const h = hero(ctx, 1);
    ex(ctx, { type: 'setCoyoteTime', targetObject: 'hero', seconds: 0.2 });
    ex(ctx, { type: 'setJumpBuffer', targetObject: 'hero', seconds: 0.15 });
    check('setCoyoteTime and setJumpBuffer write the authored windows',
      h.movement && h.movement.coyoteSeconds === 0.2 && h.movement.bufferSeconds === 0.15,
      JSON.stringify(h.movement));
  }
  {
    // P4 Advanced batch 28 (wall slide & wall jump): the fixture
    // hero stands on the floor; move it into the air against the
    // wall (id 2 at x 100) — right edge 100 meets the wall's left
    // edge, bottom 40 clears the floor top 60.
    const ctx = mvCtx();
    const h = hero(ctx, 1);
    ex(ctx, { type: 'setMaxJumps', targetObject: 'hero', jumps: 2 });
    ex(ctx, { type: 'setWallSlide', targetObject: 'hero', maxFall: 60 });
    ex(ctx, { type: 'setWallJump', targetObject: 'hero', jumpSpeed: 12, push: 8 });
    check('setWallSlide and setWallJump write the authored wall config',
      h.movement && h.movement.wallSlideMaxFall === 60 &&
      h.movement.wallJumpSpeed === 12 && h.movement.wallJumpPush === 8,
      JSON.stringify(h.movement));
    h.posX = 60; h.posY = 0; h.velY = 5;
    ex(ctx, { type: 'jump', targetObject: 'hero', jumpSpeed: 12 });
    check('jump against a wall is the wall jump (up and away)',
      h.velY === -12 && h.velX === -8, `velY=${h.velY} velX=${h.velX}`);
    check('the wall jump spends one jump',
      MV.jumpsLeft(ctx._mv, h) === 1, `left=${MV.jumpsLeft(ctx._mv, h)}`);
  }
  {
    const ctx = mvCtx();
    warnings.length = 0;
    ex(ctx, { type: 'jump', targetObject: 'hero', jumpSpeed: 'oops' });
    check('jump warns and holds on a bad speed',
      warnings.length === 1 && /not a number/.test(warnings[0]) &&
      hero(ctx, 1).velY === 0,
      JSON.stringify(warnings));
    warnings.length = 0;
    ex(ctx, { type: 'dash', targetObject: 'hero', direction: 'right', speed: 'oops', duration: 0.15, cooldown: 0.5 });
    check('dash warns and holds on a bad speed',
      warnings.length === 1 && /not a number/.test(warnings[0]),
      JSON.stringify(warnings));
    warnings.length = 0;
    ex(ctx, { type: 'dash', targetObject: 'hero', direction: 'right', speed: 400, duration: 'oops', cooldown: 0.5 });
    check('dash warns and holds on a bad duration',
      warnings.length === 1 && /not a number/.test(warnings[0]),
      JSON.stringify(warnings));
    warnings.length = 0;
    ex(ctx, { type: 'dash', targetObject: 'hero', direction: 'right', speed: 400, duration: 0.15, cooldown: 'oops' });
    check('dash warns and holds on a bad cooldown',
      warnings.length === 1 && /not a number/.test(warnings[0]),
      JSON.stringify(warnings));
    warnings.length = 0;
    ex(ctx, { type: 'setMaxJumps', targetObject: 'hero', jumps: 'oops' });
    check('setMaxJumps warns and holds on a bad count',
      warnings.length === 1 && /not a number/.test(warnings[0]),
      JSON.stringify(warnings));
    warnings.length = 0;
    ex(ctx, { type: 'setCoyoteTime', targetObject: 'hero', seconds: 'oops' });
    check('setCoyoteTime warns and holds on a bad value',
      warnings.length === 1 && /not a number/.test(warnings[0]),
      JSON.stringify(warnings));
    warnings.length = 0;
    ex(ctx, { type: 'setJumpBuffer', targetObject: 'hero', seconds: 'oops' });
    check('setJumpBuffer warns and holds on a bad value',
      warnings.length === 1 && /not a number/.test(warnings[0]),
      JSON.stringify(warnings));
    warnings.length = 0;
    ex(ctx, { type: 'setWallSlide', targetObject: 'hero', maxFall: 'oops' });
    check('setWallSlide warns and holds on a bad speed',
      warnings.length === 1 && /not a number/.test(warnings[0]),
      JSON.stringify(warnings));
    warnings.length = 0;
    ex(ctx, { type: 'setWallJump', targetObject: 'hero', jumpSpeed: 'oops', push: 8 });
    check('setWallJump warns and holds on a bad jump speed',
      warnings.length === 1 && /not a number/.test(warnings[0]),
      JSON.stringify(warnings));
    warnings.length = 0;
    ex(ctx, { type: 'setWallJump', targetObject: 'hero', jumpSpeed: 12, push: 'oops' });
    check('setWallJump warns and holds on a bad push',
      warnings.length === 1 && /not a number/.test(warnings[0]),
      JSON.stringify(warnings));
  }
  {
    const ctx = mvCtx();
    warnings.length = 0;
    ex(ctx, { type: 'jump', targetObject: 'nobody', jumpSpeed: 12 });
    ex(ctx, { type: 'dash', targetObject: 'nobody', direction: 'right', speed: 400, duration: 0.15, cooldown: 0.5 });
    ex(ctx, { type: 'setMaxJumps', targetObject: 'nobody', jumps: 2 });
    ex(ctx, { type: 'setWallSlide', targetObject: 'nobody', maxFall: 60 });
    ex(ctx, { type: 'setWallJump', targetObject: 'nobody', jumpSpeed: 12, push: 8 });
    check('movement actions stay quiet on a missing object',
      warnings.length === 0);
  }
  {
    const ctx = makeCtx({});
    warnings.length = 0;
    ex(ctx, { type: 'jump', targetObject: 'hero', jumpSpeed: 12 });
    ex(ctx, { type: 'dash', targetObject: 'hero', direction: 'right', speed: 400, duration: 0.15, cooldown: 0.5 });
    ex(ctx, { type: 'setMaxJumps', targetObject: 'hero', jumps: 2 });
    check('movement actions stay quiet without the module',
      warnings.length === 0 && hero(ctx, 1).velY === 0);
    const ctx2 = makeCtx({ movementModule: MV });
    warnings.length = 0;
    ex(ctx2, { type: 'jump', targetObject: 'hero', jumpSpeed: 12 });
    ex(ctx2, { type: 'dash', targetObject: 'hero', direction: 'right', speed: 400, duration: 0.15, cooldown: 0.5 });
    check('jump and dash stay quiet without a live movement state',
      warnings.length === 0 && hero(ctx2, 1).velY === 0);
    ex(ctx2, { type: 'setMaxJumps', targetObject: 'hero', jumps: 2 });
    check('setMaxJumps still writes without a live movement state (it needs no state)',
      hero(ctx2, 1).movement && hero(ctx2, 1).movement.maxJumps === 2,
      JSON.stringify(hero(ctx2, 1).movement));
    ex(ctx2, { type: 'setWallSlide', targetObject: 'hero', maxFall: 60 });
    ex(ctx2, { type: 'setWallJump', targetObject: 'hero', jumpSpeed: 12, push: 8 });
    check('setWallSlide and setWallJump still write without a live movement state (they need no state)',
      hero(ctx2, 1).movement && hero(ctx2, 1).movement.wallSlideMaxFall === 60 &&
      hero(ctx2, 1).movement.wallJumpSpeed === 12 && hero(ctx2, 1).movement.wallJumpPush === 8,
      JSON.stringify(hero(ctx2, 1).movement));
  }
}

// --- Platform actions (P4 Advanced batch 27) ---
{
  function pfCtx(over) {
    const st = PL.createPlatformState();
    const ctx = makeCtx(Object.assign({
      platformModule: PL,
      platform: st
    }, over || {}));
    ctx._pf = st;
    return ctx;
  }
  {
    // The fixture floor (id 6) becomes a moving platform between
    // (0, 60) and (200, 60) at 60 px/s, ping-pong.
    const ctx = pfCtx();
    const f = hero(ctx, 6);
    ex(ctx, { type: 'setPlatformPath', targetObject: 'floor', x1: 0, y1: 60, x2: 200, y2: 60, speed: 60, mode: 'pingpong' });
    check('setPlatformPath writes the path and switches the platform on',
      f.platform && f.platform.enabled === true &&
      f.platform.points.length === 2 && f.platform.points[0].x === 0 &&
      f.platform.points[1].x === 200 && f.platform.speed === 60 &&
      f.platform.mode === 'pingpong' && PL.isMovingPlatform(f) === true,
      JSON.stringify(f.platform));
  }
  {
    const ctx = pfCtx();
    const f = hero(ctx, 6);
    ex(ctx, { type: 'setOneWay', targetObject: 'floor', enabled: true });
    check('setOneWay flips both the platform config and the physics record',
      f.platform && f.platform.oneWay === true &&
      f.collision && f.collision.oneWay === true,
      JSON.stringify({ platform: f.platform, collision: f.collision }));
    ex(ctx, { type: 'setOneWay', targetObject: 'floor', enabled: false });
    check('setOneWay off clears both records',
      f.platform.oneWay === false && f.collision.oneWay === false);
  }
  {
    const ctx = pfCtx();
    const f = hero(ctx, 6);
    ex(ctx, { type: 'setCrumbleTime', targetObject: 'floor', seconds: 2 });
    check('setCrumbleTime writes the delay',
      f.platform && f.platform.crumbleSeconds === 2, JSON.stringify(f.platform));
  }
  {
    const ctx = pfCtx();
    warnings.length = 0;
    ex(ctx, { type: 'setPlatformPath', targetObject: 'floor', x1: 'oops', y1: 60, x2: 200, y2: 60, speed: 60, mode: 'pingpong' });
    check('setPlatformPath warns and holds on a bad Point 1 X',
      warnings.length === 1 && /not a number/.test(warnings[0]) &&
      !hero(ctx, 6).platform,
      JSON.stringify(warnings));
    warnings.length = 0;
    ex(ctx, { type: 'setPlatformPath', targetObject: 'floor', x1: 0, y1: 60, x2: 200, y2: 60, speed: 'oops', mode: 'pingpong' });
    check('setPlatformPath warns and holds on a bad speed',
      warnings.length === 1 && /not a number/.test(warnings[0]) &&
      !hero(ctx, 6).platform,
      JSON.stringify(warnings));
    warnings.length = 0;
    ex(ctx, { type: 'setCrumbleTime', targetObject: 'floor', seconds: 'oops' });
    check('setCrumbleTime warns and holds on a bad value',
      warnings.length === 1 && /not a number/.test(warnings[0]),
      JSON.stringify(warnings));
  }
  {
    const ctx = pfCtx();
    warnings.length = 0;
    ex(ctx, { type: 'setPlatformPath', targetObject: 'nobody', x1: 0, y1: 0, x2: 200, y2: 0, speed: 60, mode: 'pingpong' });
    ex(ctx, { type: 'setOneWay', targetObject: 'nobody', enabled: true });
    ex(ctx, { type: 'setCrumbleTime', targetObject: 'nobody', seconds: 2 });
    check('platform actions stay quiet on a missing object',
      warnings.length === 0);
  }
  {
    const ctx = makeCtx({});
    warnings.length = 0;
    ex(ctx, { type: 'setPlatformPath', targetObject: 'floor', x1: 0, y1: 60, x2: 200, y2: 60, speed: 60, mode: 'pingpong' });
    ex(ctx, { type: 'setOneWay', targetObject: 'floor', enabled: true });
    ex(ctx, { type: 'setCrumbleTime', targetObject: 'floor', seconds: 2 });
    check('platform actions stay quiet without the module',
      warnings.length === 0 && !hero(ctx, 6).platform);
    const ctx2 = makeCtx({ platformModule: PL });
    warnings.length = 0;
    ex(ctx2, { type: 'setPlatformPath', targetObject: 'floor', x1: 0, y1: 60, x2: 200, y2: 60, speed: 60, mode: 'pingpong' });
    check('setPlatformPath still writes without a live platform state (it needs no state)',
      hero(ctx2, 6).platform && hero(ctx2, 6).platform.enabled === true,
      JSON.stringify(hero(ctx2, 6).platform));
  }
}

// --- Combat actions (P4 Advanced batch 29) ---
{
  function cbCtx(over) {
    const st = CB.createCombatState();
    const ctx = makeCtx(Object.assign({
      combatModule: CB,
      combat: st,
      healthModule: HP,
      damageFxModule: DF
    }, over || {}));
    ctx._cb = st;
    return ctx;
  }
  // The fixture hero (id 1) stands at (10, 20), center (30, 40): a
  // right-facing swing at range 100 reaches the box (center 50, 40),
  // the label (80, 40), the wall (120, 40), and the floor (100, 70,
  // 23 degrees down) — but not the second hero at (200, 20).
  {
    nowValue = 1000;
    const ctx = cbCtx();
    warnings.length = 0;
    ex(ctx, { type: 'meleeAttack', targetObject: 'hero', damage: 10, range: 100, direction: 'right', cooldown: 0.5 });
    check('meleeAttack damages every solid object in the arc',
      hero(ctx, 8).health === 90 && hero(ctx, 2).health === 90 &&
      hero(ctx, 6).health === 90 && hero(ctx, 5).health === 90 &&
      hero(ctx, 3).health === undefined,
      JSON.stringify({ box: hero(ctx, 8).health, wall: hero(ctx, 2).health, floor: hero(ctx, 6).health, secondHero: hero(ctx, 3).health }));
    check('meleeAttack draws one slash and warns nothing',
      warnings.length === 0 && ctx._cb.slashes.length === 1 &&
      ctx._cb.slashes[0].range === 100);
    // A second swing inside the cooldown changes nothing.
    ex(ctx, { type: 'meleeAttack', targetObject: 'hero', damage: 10, range: 100, direction: 'right', cooldown: 0.5 });
    check('meleeAttack during the cooldown is refused quietly',
      warnings.length === 0 && hero(ctx, 2).health === 90 && ctx._cb.slashes.length === 1);
    // After the cooldown the swing lands again.
    nowValue = 1600;
    ex(ctx, { type: 'meleeAttack', targetObject: 'hero', damage: 10, range: 100, direction: 'right', cooldown: 0.5 });
    check('meleeAttack lands again after the cooldown',
      hero(ctx, 2).health === 80 && ctx._cb.slashes.length === 2);
  }
  {
    nowValue = 1000;
    const ctx = cbCtx();
    warnings.length = 0;
    ex(ctx, { type: 'meleeAttack', targetObject: 'hero', damage: 'oops', range: 100, direction: 'right', cooldown: 0.5 });
    check('meleeAttack warns and holds on a bad damage',
      warnings.length === 1 && /not a number/.test(warnings[0]) && hero(ctx, 2).health === undefined);
    warnings.length = 0;
    ex(ctx, { type: 'meleeAttack', targetObject: 'hero', damage: 10, range: 'oops', direction: 'right', cooldown: 0.5 });
    check('meleeAttack warns and holds on a bad range',
      warnings.length === 1 && /not a number/.test(warnings[0]) && hero(ctx, 2).health === undefined);
    warnings.length = 0;
    ex(ctx, { type: 'meleeAttack', targetObject: 'hero', damage: 10, range: 100, direction: 'right', cooldown: 'oops' });
    check('meleeAttack warns and holds on a bad cooldown',
      warnings.length === 1 && /not a number/.test(warnings[0]) && hero(ctx, 2).health === undefined);
    warnings.length = 0;
    ex(ctx, { type: 'meleeAttack', targetObject: 'nobody', damage: 10, range: 100, direction: 'right', cooldown: 0.5 });
    check('meleeAttack stays quiet on a missing object',
      warnings.length === 0);
  }
  {
    nowValue = 1000;
    const ctx = cbCtx();
    warnings.length = 0;
    ex(ctx, { type: 'makeInvincible', targetObject: 'wall', seconds: 5 });
    ex(ctx, { type: 'meleeAttack', targetObject: 'hero', damage: 10, range: 100, direction: 'right', cooldown: 0.5 });
    check('meleeAttack skips an invincible target but still swings at the rest',
      hero(ctx, 2).health === undefined && hero(ctx, 8).health === 90 &&
      ctx._cb.slashes.length === 1,
      JSON.stringify({ wall: hero(ctx, 2).health, box: hero(ctx, 8).health }));
  }
  {
    nowValue = 1000;
    const ctx = cbCtx();
    warnings.length = 0;
    ex(ctx, { type: 'shootProjectile', targetObject: 'hero', projectileObject: 'coin', direction: 'right', speed: 300, damage: 10, lifetime: 2, cooldown: 0.5 });
    const coins = ctx.objects.filter(o => o.name === 'coin');
    check('shootProjectile spawns the clone at the shooter edge, centered',
      coins.length === 1 && coins[0].posX === 44 && coins[0].posY === 30,
      JSON.stringify(coins.map(c => [c.posX, c.posY])));
    check('shootProjectile registers the flight with its velocity',
      ctx._cb.projectiles.length === 1 && ctx._cb.projectiles[0].vx === 300 &&
      ctx._cb.projectiles[0].vy === 0 && ctx._cb.projectiles[0].obj === coins[0]);
    // A second shot inside the cooldown spawns nothing.
    ex(ctx, { type: 'shootProjectile', targetObject: 'hero', projectileObject: 'coin', direction: 'right', speed: 300, damage: 10, lifetime: 2, cooldown: 0.5 });
    check('shootProjectile during the cooldown is refused quietly',
      warnings.length === 0 && ctx.objects.filter(o => o.name === 'coin').length === 1);
    // A missing template stays quiet and never spends the cooldown.
    ex(ctx, { type: 'shootProjectile', targetObject: 'hero', projectileObject: 'nope', direction: 'right', speed: 300, damage: 10, lifetime: 2, cooldown: 0.5 });
    check('shootProjectile stays quiet on a missing template',
      warnings.length === 0 && ctx.objects.filter(o => o.name === 'coin').length === 1);
    nowValue = 1600;
    ex(ctx, { type: 'shootProjectile', targetObject: 'hero', projectileObject: 'coin', direction: 'up', speed: 300, damage: 10, lifetime: 2, cooldown: 0.5 });
    check('shootProjectile fires again after the cooldown (the miss never spent it)',
      ctx.objects.filter(o => o.name === 'coin').length === 2 &&
      ctx._cb.projectiles[1].vy === -300);
  }
  {
    nowValue = 1000;
    const ctx = cbCtx();
    warnings.length = 0;
    ex(ctx, { type: 'shootProjectile', targetObject: 'hero', projectileObject: 'coin', direction: 'right', speed: 'oops', damage: 10, lifetime: 2, cooldown: 0.5 });
    check('shootProjectile warns and holds on a bad speed',
      warnings.length === 1 && /not a number/.test(warnings[0]) &&
      ctx.objects.filter(o => o.name === 'coin').length === 0);
    warnings.length = 0;
    ex(ctx, { type: 'shootProjectile', targetObject: 'hero', projectileObject: 'coin', direction: 'right', speed: 300, damage: 10, lifetime: 'oops', cooldown: 0.5 });
    check('shootProjectile warns and holds on a bad lifetime',
      warnings.length === 1 && /not a number/.test(warnings[0]) &&
      ctx.objects.filter(o => o.name === 'coin').length === 0);
    warnings.length = 0;
    ex(ctx, { type: 'shootProjectile', targetObject: 'nobody', projectileObject: 'coin', direction: 'right', speed: 300, damage: 10, lifetime: 2, cooldown: 0.5 });
    check('shootProjectile stays quiet on a missing shooter',
      warnings.length === 0 && ctx.objects.filter(o => o.name === 'coin').length === 0);
  }
  {
    const ctx = makeCtx({});
    warnings.length = 0;
    ex(ctx, { type: 'meleeAttack', targetObject: 'hero', damage: 10, range: 100, direction: 'right', cooldown: 0.5 });
    ex(ctx, { type: 'shootProjectile', targetObject: 'hero', projectileObject: 'coin', direction: 'right', speed: 300, damage: 10, lifetime: 2, cooldown: 0.5 });
    check('combat actions stay quiet without the module',
      warnings.length === 0 && ctx.objects.filter(o => o.name === 'coin').length === 0);
    const ctx2 = makeCtx({ combatModule: CB, healthModule: HP, damageFxModule: DF });
    warnings.length = 0;
    ex(ctx2, { type: 'meleeAttack', targetObject: 'hero', damage: 10, range: 100, direction: 'right', cooldown: 0.5 });
    ex(ctx2, { type: 'shootProjectile', targetObject: 'hero', projectileObject: 'coin', direction: 'right', speed: 300, damage: 10, lifetime: 2, cooldown: 0.5 });
    check('combat actions stay quiet without a live combat state',
      warnings.length === 0 && ctx2.objects.filter(o => o.name === 'coin').length === 0);
  }
}

// --- unknown types + hostile input ---
{
  const ctx = makeCtx();
  reported.length = 0;
  ex(ctx, { type: 'wat' });
  check('unknown block type reports through reportUnknown and does nothing',
    reported.includes('wat'));
  check('a non-string type still reports (the export reported any unknown type)',
    (() => { const before = reported.length; ex(ctx, { type: 42 }); return reported.length === before + 1; })());
  check('null data returns silently without reporting',
    (() => { const before = reported.length; ex(ctx, null); return reported.length === before; })());
  check('missing ctx degrades to a no-op, never throws',
    (() => { ex(undefined, { type: 'setVelocity', targetObject: 'hero', velX: 1 }); return true; })());
  check('throwing named lookup is skipped, never throws',
    (() => { ex(makeCtx({ named: () => { throw new Error('boom'); } }),
      { type: 'setVelocity', targetObject: 'hero', velX: 1 }); return true; })());
  check('a throwing expression degrades to 0 and never throws',
    (() => { const c = makeCtx({ expr: () => { throw new Error('boom'); } });
      ex(c, { type: 'setVelocity', targetObject: 'hero', velX: 5 }); return hero(c, 1).velX === 0; })());
  check('throwing reportUnknown is swallowed',
    (() => { ex(makeCtx({ reportUnknown: () => { throw new Error('boom'); } }), { type: 'wat' }); return true; })());
  check('frozen ctx objects do not break a read-only action',
    (() => { const c = makeCtx(); Object.freeze(c); Object.freeze(c.variables);
      ex(c, { type: 'setCamera', cameraX: 5, cameraY: 6 }); return c.camera.x === 5; })());
  check('a throwing subsystem isType reads as not handling the block',
    (() => { const c = makeCtx();
      c.collections = { isCollectionAction: () => { throw new Error('boom'); } };
      reported.length = 0; ex(c, { type: 'collectionAdd' }); return reported.includes('collectionAdd'); })());
}

// --- static routing: both runtimes delegate to the shared module ---
{
  const playerSrc = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'player-runtime.js'), 'utf8');
  const scriptSrc = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'script.js'), 'utf8');
  const moduleSrc = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-previewruntime.js'), 'utf8');
  const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'index.html'), 'utf8');
  check('export delegates execute to HydraExecute via one actionCtx builder',
    playerSrc.includes('HydraExecute.executeAction(data, actionCtx(state), idx)') &&
    playerSrc.includes('function actionCtx(state)'));
  check('export hard-guards on HydraExecute at load',
    playerSrc.includes("HydraScript player runtime requires hydra-execute.js (window.HydraExecute) to be loaded first."));
  check('export inlines the shared execute module',
    playerSrc.includes("['HydraExecute', global.HydraExecute && global.HydraExecute.factorySource, 'hydra-execute.js (window.HydraExecute)']"));
  check('export inline action switch and its helpers are gone',
    !playerSrc.includes("case 'applyForce': targets(state, data)") &&
    !playerSrc.includes('function velocity(') && !playerSrc.includes('function setVar(') &&
    !playerSrc.includes('function spawnAt(') && !playerSrc.includes('function controlTimer(') &&
    !playerSrc.includes('function targetsByName(') && !playerSrc.includes('function setPhysics(') &&
    !playerSrc.includes('function pushSceneChange(') && !playerSrc.includes('function popSceneChange('));
  check('the preview runtime module delegates executeAction to HydraExecute via one actionCtx builder',
    moduleSrc.includes('execute.executeAction(data, actionCtx(), idx)') &&
    moduleSrc.includes('function actionCtx()'));
  check('the preview runtime module guards the call (a dropped tag degrades to actions not running)',
    moduleSrc.includes("if (!execute || typeof execute.executeAction !== 'function') return;"));
  check('script.js no longer defines executeAction inline',
    !/function executeAction\(data, idx\)/.test(scriptSrc) &&
    !scriptSrc.includes('window.HydraExecute.executeAction'));
  check('preview inline action switch and its helpers are gone',
    !scriptSrc.includes("case 'applyForce'") && !scriptSrc.includes("case 'runScript'") &&
    !scriptSrc.includes('function setVelocityToward(') && !scriptSrc.includes('function separateObjectsPair(') &&
    !scriptSrc.includes('function particleSpecFromData(') && !scriptSrc.includes('function clearNamedTimer(') &&
    !scriptSrc.includes('spawnCounter'));
  check('index.html loads hydra-execute.js after hydra-conditions.js and before player-runtime.js and script.js',
    indexSrc.indexOf('src="hydra-execute.js') !== -1 &&
    indexSrc.indexOf('src="hydra-conditions.js') < indexSrc.indexOf('src="hydra-execute.js') &&
    indexSrc.indexOf('src="hydra-execute.js') < indexSrc.indexOf('src="player-runtime.js') &&
    indexSrc.indexOf('src="hydra-execute.js') < indexSrc.indexOf('src="script.js'));
  check('module file carries the factorySource export',
    fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-execute.js'), 'utf8')
      .includes('window.HydraExecute.factorySource = hydraExecuteFactory.toString();'));
}

if (failures) { console.error(`${failures} assertion(s) failed`); process.exit(1); }
console.log('execute.test.js: all assertions passed');
