// Unit tests for hydra/hydra-scenereset.js — the shared scene-load runtime
// state reset (P2 item 15/12, slice 5: the shared-engine extraction
// continues here).
//
// Pure logic: the fresh run state every scene load starts from (camera,
// 3D camera, pause, particles, per-scene collections, condition contexts,
// trigger edge state). Nothing here touches the DOM; a behavior change
// here changes both runtimes at once — which is the point of the
// extraction. The tests pin the reset itself, the hook degradation
// (a missing or throwing hook never breaks scene load), the never-throws
// contract, the two divergences this slice closes (preview scene
// switches now clear condition contexts; preview restarts now clear a
// pending scene switch), and the static routing that both runtimes
// delegate to it.

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
['hydra-scenereset.js', 'hydra-3d.js', 'hydra-particles.js', 'hydra-camerafeel.js', 'hydra-damagefx.js', 'hydra-respawn.js', 'hydra-spawn.js', 'hydra-movement.js', 'hydra-platform.js', 'hydra-combat.js', 'hydra-minimap.js', 'hydra-attach.js'].forEach(m =>
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', m), 'utf8'),
    sandbox, { filename: m }));
const SR = sandbox.HydraSceneReset;
const H3 = sandbox.Hydra3d;
const P = sandbox.HydraParticles;
const CF = sandbox.HydraCameraFeel;
const DF = sandbox.HydraDamageFx;
const RM = sandbox.HydraRespawn;
const SP = sandbox.HydraSpawn;
const MV = sandbox.HydraMovement;
const PL = sandbox.HydraPlatform;
const CB = sandbox.HydraCombat;
const MM = sandbox.HydraMinimap;
const AT = sandbox.HydraAttach;

// --- a dirtied host state, the way a live scene leaves it ---
function dirtyState() {
  return {
    pendingSceneId: 2,
    sceneId: 1,
    camera: { x: 120, y: 40, zoom: 2, followTarget: 'hero', offsetX: 5, offsetY: 6 },
    camera3d: { x: 1, y: 2, z: 3 },
    camera3dFollow: 'hero',
    particles: { particles: [{ x: 1 }], emitters: { fx: {} }, spawned: 9, recycled: 1 },
    damageNumbers: { numbers: [{ x: 1, text: '9' }] },
    respawn: { point: { x: 500, y: 100, name: 'flag' }, count: 3, initial: { hero: { x: 10, y: 20 } } },
    spawners: { spawners: { goblins: { name: 'goblins', template: 'goblin', atObject: '', x: 0, y: 0, interval: 2, maxAlive: 10, total: 0, active: true, timer: 1.5, spawned: 4 } } },
    movement: { records: { 1: { jumpsUsed: 1, dashUntil: 5 } } },
    platform: { records: { 6: { target: 1, dir: 1, crumbleAt: 5, crumbled: false } } },
    combat: { cooldowns: { 1: { meleeAt: 5, shotAt: 5 } }, projectiles: [{ obj: { id: 9 } }], slashes: [{ x: 1 }] },
    lives: { lives: 1 },
    xp: { xp: 250, xpPerLevel: 100, levelAnnounced: 3 },
    paused: true,
    pausedElapsedMs: 500,
    timeScaleDebtMs: 500,
    _triggerContacts: [{ zone: 2, obj: 1 }],
    _triggerPairs: { '2:1': true },
    _triggerEntered: ['2:1'],
    _triggerExited: ['3:1'],
    contexts: { 'global:0': { gameStart: true } },
    executionContext: { gameStart: true }
  };
}
function scene(over) {
  return Object.assign({
    id: 2, name: 'Scene 2',
    camera3d: { x: 5, y: 6, z: 7, tx: 1, ty: 2, tz: 3, fov: 70 },
    cameraFeel: { smoothing: 0.7, deadzoneW: 50, deadzoneH: 30, bounds: { minX: 0, minY: 0, maxX: 400, maxY: 300 } },
    worldWidth: 800, worldHeight: 600
  }, over || {});
}
function fullHooks() {
  const hidden = new Set([1, 2]);
  const destroyed = new Set([3]);
  const pendingDestroy = new Set([4]);
  const timers = new Map([['named:t1', { lastFiredTime: 0 }]]);
  const once = new Set(['a']);
  const startedScopes = new Set(['global', '1']);
  let contextsReset = 0;
  const hooks = {
    normalizeCamera3d: (cam, sc) => H3.normalizeCamera3d(cam, sc),
    cameraFeelOf: (sc) => CF.freshCameraFeel(sc ? sc.cameraFeel : null),
    minimapOf: (sc) => MM.createMinimapState(sc ? sc.minimap : null),
    createAttachState: () => AT.createAttachState(),
    createParticleState: () => P.createParticleState(),
    createDamageNumbers: () => DF.createDamageNumberState(),
    createRespawnState: () => RM.createRespawnState(),
    createSpawnerState: () => SP.createSpawnerState(),
    createMovementState: () => MV.createMovementState(),
    createPlatformState: () => PL.createPlatformState(),
    createCombatState: () => CB.createCombatState(),
    hidden, destroyed, pendingDestroy, timers, once, startedScopes,
    resetContexts: () => { contextsReset++; }
  };
  hooks._counts = () => contextsReset;
  return hooks;
}
function fullHooksWithoutFeel() {
  const h = fullHooks();
  delete h.cameraFeelOf;
  return h;
}

// --- surface + factorySource ---
{
  check('HydraSceneReset is loaded with resetSceneRuntime',
    !!SR && typeof SR.resetSceneRuntime === 'function');
  check('factorySource is a string naming the factory',
    typeof SR.factorySource === 'string' && SR.factorySource.includes('hydraSceneResetFactory'));
  check('factorySource re-instantiation gives a working module',
    (() => {
      const sb2 = {};
      sb2.window = sb2;
      vm.createContext(sb2);
      vm.runInContext('window.HydraSceneReset=(' + SR.factorySource + ')();', sb2);
      const st = dirtyState();
      return typeof sb2.HydraSceneReset.resetSceneRuntime === 'function' &&
        sb2.HydraSceneReset.resetSceneRuntime(st, scene(), {}) === true &&
        st.sceneId === 2 && st.camera.x === 0;
    })());
}

// --- the reset itself, with full hooks ---
{
  const st = dirtyState();
  const h = fullHooks();
  const sc = scene();
  const ok = SR.resetSceneRuntime(st, sc, h);
  check('resetSceneRuntime returns true', ok === true);
  check('pendingSceneId is cleared', st.pendingSceneId === null, `pendingSceneId=${st.pendingSceneId}`);
  check('sceneId is set from the scene', st.sceneId === 2, `sceneId=${st.sceneId}`);
  check('camera is the fresh record',
    JSON.stringify(st.camera) === JSON.stringify({ x: 0, y: 0, zoom: 1, followTarget: '', offsetX: 0, offsetY: 0 }),
    JSON.stringify(st.camera));
  check('camera3d comes from the hook (scene 2 values kept)',
    st.camera3d.x === 5 && st.camera3d.y === 6 && st.camera3d.z === 7 &&
    st.camera3d.tx === 1 && st.camera3d.fov === 70, JSON.stringify(st.camera3d));
  check('camera3dFollow is cleared', st.camera3dFollow === null);
  check('cameraFeel comes from the hook as a fresh copy of the scene feel',
    st.cameraFeel && st.cameraFeel.smoothing === 0.7 && st.cameraFeel.deadzoneW === 50 &&
    st.cameraFeel.deadzoneH === 30 &&
    JSON.stringify(st.cameraFeel.bounds) === JSON.stringify({ minX: 0, minY: 0, maxX: 400, maxY: 300 }) &&
    st.cameraFeel !== sc.cameraFeel && st.cameraFeel.bounds !== sc.cameraFeel.bounds,
    JSON.stringify(st.cameraFeel));
  check('particles is a fresh empty state',
    st.particles && Array.isArray(st.particles.particles) && st.particles.particles.length === 0 &&
    st.particles.spawned === 0, JSON.stringify(st.particles));
  check('damageNumbers is a fresh empty state (last scene\'s numbers never carry over)',
    st.damageNumbers && Array.isArray(st.damageNumbers.numbers) && st.damageNumbers.numbers.length === 0,
    JSON.stringify(st.damageNumbers));
  check('respawn is a fresh empty state (last scene\'s checkpoint and count never carry over)',
    st.respawn && st.respawn.point === null && st.respawn.count === 0 &&
    JSON.stringify(st.respawn.initial) === '{}',
    JSON.stringify(st.respawn));
  check('spawners is a fresh empty state (last scene\'s running waves never carry over)',
    st.spawners && JSON.stringify(st.spawners.spawners) === '{}',
    JSON.stringify(st.spawners));
  check('movement is a fresh empty state (last scene\'s dash and jumps never carry over)',
    st.movement && JSON.stringify(st.movement.records) === '{}',
    JSON.stringify(st.movement));
  check('platform is a fresh empty state (last scene\'s rides and crumble timers never carry over)',
    st.platform && JSON.stringify(st.platform.records) === '{}',
    JSON.stringify(st.platform));
  check('combat is a fresh empty state (last scene\'s cooldowns, shots, and slashes never carry over)',
    st.combat && JSON.stringify(st.combat) === JSON.stringify({ cooldowns: {}, projectiles: [], slashes: [] }),
    JSON.stringify(st.combat));
  check('lives is untouched by the reset (the count survives a scene switch, like the quest log)',
    st.lives && st.lives.lives === 1,
    JSON.stringify(st.lives));
  check('xp is untouched by the reset (the total survives a scene switch, like the lives count)',
    st.xp && st.xp.xp === 250 && st.xp.levelAnnounced === 3,
    JSON.stringify(st.xp));
  check('paused is cleared with a fresh clock',
    st.paused === false && st.pausedElapsedMs === 0, `paused=${st.paused} elapsed=${st.pausedElapsedMs}`);
  check('time-scale debt is cleared with the fresh clock',
    st.timeScaleDebtMs === 0, `debt=${st.timeScaleDebtMs}`);
  check('trigger edge state is cleared',
    Array.isArray(st._triggerContacts) && st._triggerContacts.length === 0 &&
    Object.keys(st._triggerPairs).length === 0 &&
    st._triggerEntered.length === 0 && st._triggerExited.length === 0,
    JSON.stringify({ c: st._triggerContacts, p: st._triggerPairs }));
  check('hidden/destroyed/pendingDestroy are cleared',
    h.hidden.size === 0 && h.destroyed.size === 0 && h.pendingDestroy.size === 0);
  check('timers/once/startedScopes are cleared',
    h.timers.size === 0 && h.once.size === 0 && h.startedScopes.size === 0);
  check('resetContexts hook ran exactly once', h._counts() === 1, `calls=${h._counts()}`);
}
// --- P5-8 slice b: the hidden seed --------------------------------------
// The outliner's eye writes hidden: true onto the object record; the
// reset seeds the run's hidden set from those flags, so the object
// starts the run hidden in BOTH runtimes (they share this reset).
// A Show block can still reveal it mid-run, and the next scene load
// re-seeds from the flags.
{
  const st = dirtyState();
  const h = fullHooks(); // hidden starts as Set([1, 2])
  const sc = scene({ objects: [
    { id: 1, name: 'hero', hidden: false },
    { id: 2, name: 'coin', hidden: true },
    { id: 3, name: 'ghost', hidden: true },
    { id: 4, name: 'wall' },
    { id: 5, name: 'almost', hidden: 'yes' },
    { name: 'noid', hidden: true },
    null, 'junk'
  ] });
  SR.resetSceneRuntime(st, sc, h);
  check('reset seeds hidden from the scene flags (old ids cleared, flagged ids in)',
    h.hidden.size === 2 && h.hidden.has(2) && h.hidden.has(3) && !h.hidden.has(1),
    JSON.stringify([...h.hidden]));
  check('a non-true flag is not hidden (only hidden === true seeds)',
    !h.hidden.has(5), JSON.stringify([...h.hidden]));
  // A second reset with no flags clears the seed again, so a scene
  // switch back to an unhidden scene never inherits the last one.
  SR.resetSceneRuntime(st, scene(), h);
  check('a reset with no hidden flags leaves the hidden set empty',
    h.hidden.size === 0, JSON.stringify([...h.hidden]));
  // A missing hidden hook never breaks the reset.
  const st2 = dirtyState();
  check('reset with no hidden hook still returns true',
    SR.resetSceneRuntime(st2, scene({ objects: [{ id: 9, hidden: true }] }), {}) === true);
  // A hidden set whose add throws degrades to a clear, not a crash.
  const st3 = dirtyState();
  const throwing = { clear() {}, add() { throw new Error('denied'); } };
  check('reset with a throwing hidden add still returns true',
    SR.resetSceneRuntime(st3, scene({ objects: [{ id: 9, hidden: true }] }), { hidden: throwing }) === true);
}
{
  // Fresh records every call: no aliasing between scene loads.
  const st1 = dirtyState();
  const st2 = dirtyState();
  SR.resetSceneRuntime(st1, scene(), fullHooks());
  SR.resetSceneRuntime(st2, scene(), fullHooks());
  check('each reset mints a fresh camera record (no aliasing)',
    st1.camera !== st2.camera && st1.particles !== st2.particles &&
    st1.damageNumbers !== st2.damageNumbers &&
    st1.respawn !== st2.respawn && st1.spawners !== st2.spawners &&
    st1.movement !== st2.movement &&
    st1.platform !== st2.platform &&
    st1.combat !== st2.combat &&
    st1._triggerPairs !== st2._triggerPairs);
  check('each reset mints a fresh camera-feel record (no aliasing)',
    st1.cameraFeel !== st2.cameraFeel && st1.cameraFeel.bounds !== st2.cameraFeel.bounds);
  st1.camera.x = 999;
  check('mutating one reset camera does not affect the next',
    st2.camera.x === 0, `st2.camera.x=${st2.camera.x}`);
  st1.cameraFeel.smoothing = 0.1;
  check('mutating one reset camera feel does not affect the next',
    st2.cameraFeel.smoothing === 0.7, `st2.cameraFeel.smoothing=${st2.cameraFeel.smoothing}`);
}
{
  // A scene with no id leaves the host sceneId alone.
  const st = dirtyState();
  const ok = SR.resetSceneRuntime(st, { name: 'No Id' }, fullHooks());
  check('a scene without an id leaves sceneId unchanged (still resets the rest)',
    ok === true && st.sceneId === 1 && st.camera.x === 0 && st.paused === false,
    `sceneId=${st.sceneId}`);
}

// --- hook degradation: nothing here ever throws ---
{
  const st = dirtyState();
  check('empty hooks still reset the state fields',
    SR.resetSceneRuntime(st, scene(), {}) === true &&
    st.sceneId === 2 && st.camera.x === 0 && st.paused === false &&
    st.camera3d === null && st.cameraFeel === null && st.particles === null && st.damageNumbers === null &&
    st.respawn === null && st.spawners === null &&
    st._triggerPairs && Object.keys(st._triggerPairs).length === 0);
  check('null hooks still reset the state fields',
    SR.resetSceneRuntime(dirtyState(), scene(), null) === true);
  check('a non-object hooks value still resets the state fields',
    SR.resetSceneRuntime(dirtyState(), scene(), 'nope') === true);
  check('a missing normalizeCamera3d reads camera3d as null',
    (() => { const s = dirtyState(); SR.resetSceneRuntime(s, scene(), { createParticleState: () => P.createParticleState() }); return s.camera3d === null; })());
  check('a missing cameraFeelOf reads cameraFeel as null',
    (() => { const s = dirtyState(); SR.resetSceneRuntime(s, scene(), fullHooksWithoutFeel()); return s.cameraFeel === null; })());
  check('a throwing cameraFeelOf reads cameraFeel as null',
    (() => { const s = dirtyState(); SR.resetSceneRuntime(s, scene(), { cameraFeelOf: () => { throw new Error('boom'); } }); return s.cameraFeel === null; })());
  check('minimapOf mints a fresh run record from the scene config on every scene load',
    (() => {
      const s = dirtyState();
      SR.resetSceneRuntime(s, scene({ minimap: { enabled: true, corner: 'bottom-left', size: 200, zoom: 2, showViewport: false } }), fullHooks());
      return s.minimap !== null && s.minimap.visible === true && s.minimap.corner === 'bottom-left' &&
        s.minimap.size === 200 && s.minimap.zoom === 2 && s.minimap.showViewport === false;
    })());
  check('a second scene load re-mints the minimap record (no leak from the last scene)',
    (() => {
      const s = dirtyState();
      SR.resetSceneRuntime(s, scene({ minimap: { enabled: true, size: 200 } }), fullHooks());
      MM.setVisible(s.minimap, false);
      SR.resetSceneRuntime(s, scene({ minimap: { enabled: false } }), fullHooks());
      return s.minimap.visible === false && s.minimap.size === 160;
    })());
  check('a missing minimapOf reads minimap as null',
    (() => {
      const s = dirtyState();
      const h = fullHooks();
      delete h.minimapOf;
      SR.resetSceneRuntime(s, scene(), h);
      return s.minimap === null;
    })());
  check('createAttachState mints a fresh empty link table on every scene load',
    (() => {
      const s = dirtyState();
      SR.resetSceneRuntime(s, scene(), fullHooks());
      return s.attachments !== null && AT.attachCount(s.attachments) === 0;
    })());
  check('a second scene load re-mints the link table (no leak from the last scene)',
    (() => {
      const s = dirtyState();
      SR.resetSceneRuntime(s, scene(), fullHooks());
      AT.attach(s.attachments, 'hat', 'hero', 10, 0);
      const first = s.attachments;
      SR.resetSceneRuntime(s, scene(), fullHooks());
      return s.attachments !== first && AT.attachCount(s.attachments) === 0 &&
        AT.attachCount(first) === 1;
    })());
  check('a missing createAttachState reads attachments as null',
    (() => {
      const s = dirtyState();
      const h = fullHooks();
      delete h.createAttachState;
      SR.resetSceneRuntime(s, scene(), h);
      return s.attachments === null;
    })());
  check('a throwing createAttachState reads attachments as null',
    (() => {
      const s = dirtyState();
      SR.resetSceneRuntime(s, scene(), { createAttachState: () => { throw new Error('boom'); } });
      return s.attachments === null;
    })());
  check('a throwing minimapOf reads minimap as null',
    (() => { const s = dirtyState(); SR.resetSceneRuntime(s, scene(), { minimapOf: () => { throw new Error('boom'); } }); return s.minimap === null; })());
  check('a throwing normalizeCamera3d reads camera3d as null',
    (() => { const s = dirtyState(); SR.resetSceneRuntime(s, scene(), { normalizeCamera3d: () => { throw new Error('boom'); } }); return s.camera3d === null; })());
  check('a missing createParticleState reads particles as null',
    (() => { const s = dirtyState(); SR.resetSceneRuntime(s, scene(), { normalizeCamera3d: (c, sc) => H3.normalizeCamera3d(c, sc) }); return s.particles === null; })());
  check('a throwing createParticleState reads particles as null',
    (() => { const s = dirtyState(); SR.resetSceneRuntime(s, scene(), { createParticleState: () => { throw new Error('boom'); } }); return s.particles === null; })());
  check('a missing createDamageNumbers reads damageNumbers as null',
    (() => { const s = dirtyState(); SR.resetSceneRuntime(s, scene(), { createParticleState: () => P.createParticleState() }); return s.damageNumbers === null; })());
  check('a throwing createDamageNumbers reads damageNumbers as null',
    (() => { const s = dirtyState(); SR.resetSceneRuntime(s, scene(), { createDamageNumbers: () => { throw new Error('boom'); } }); return s.damageNumbers === null; })());
  check('a missing createRespawnState reads respawn as null',
    (() => { const s = dirtyState(); SR.resetSceneRuntime(s, scene(), { createParticleState: () => P.createParticleState() }); return s.respawn === null; })());
  check('a throwing createRespawnState reads respawn as null',
    (() => { const s = dirtyState(); SR.resetSceneRuntime(s, scene(), { createRespawnState: () => { throw new Error('boom'); } }); return s.respawn === null; })());
  check('a missing createSpawnerState reads spawners as null',
    (() => { const s = dirtyState(); SR.resetSceneRuntime(s, scene(), { createParticleState: () => P.createParticleState() }); return s.spawners === null; })());
  check('a throwing createSpawnerState reads spawners as null',
    (() => { const s = dirtyState(); SR.resetSceneRuntime(s, scene(), { createSpawnerState: () => { throw new Error('boom'); } }); return s.spawners === null; })());
  check('a missing createMovementState reads movement as null',
    (() => { const s = dirtyState(); SR.resetSceneRuntime(s, scene(), { createParticleState: () => P.createParticleState() }); return s.movement === null; })());
  check('a throwing createMovementState reads movement as null',
    (() => { const s = dirtyState(); SR.resetSceneRuntime(s, scene(), { createMovementState: () => { throw new Error('boom'); } }); return s.movement === null; })());
  check('a missing createPlatformState reads platform as null',
    (() => { const s = dirtyState(); SR.resetSceneRuntime(s, scene(), { createParticleState: () => P.createParticleState() }); return s.platform === null; })());
  check('a throwing createPlatformState reads platform as null',
    (() => { const s = dirtyState(); SR.resetSceneRuntime(s, scene(), { createPlatformState: () => { throw new Error('boom'); } }); return s.platform === null; })());
  check('a missing createCombatState reads combat as null',
    (() => { const s = dirtyState(); SR.resetSceneRuntime(s, scene(), { createParticleState: () => P.createParticleState() }); return s.combat === null; })());
  check('a throwing createCombatState reads combat as null',
    (() => { const s = dirtyState(); SR.resetSceneRuntime(s, scene(), { createCombatState: () => { throw new Error('boom'); } }); return s.combat === null; })());
  check('a scene with no camera3d normalizes to the scene defaults through the real hook',
    (() => {
      const s = dirtyState();
      SR.resetSceneRuntime(s, scene({ camera3d: undefined }), fullHooks());
      return s.camera3d.x === 400 && s.camera3d.y === 300 && s.camera3d.fov === 60;
    })());
  check('a throwing collection clear is swallowed and the rest still clear',
    (() => {
      const bad = { clear() { throw new Error('boom'); } };
      const good = new Set([1]);
      const s = dirtyState();
      const ok = SR.resetSceneRuntime(s, scene(), { hidden: bad, destroyed: good });
      return ok === true && good.size === 0;
    })());
  check('a non-function clear is skipped, no throw',
    (() => { const s = dirtyState(); return SR.resetSceneRuntime(s, scene(), { hidden: { clear: 'no' } }) === true; })());
  check('a throwing resetContexts is swallowed',
    (() => { const s = dirtyState(); return SR.resetSceneRuntime(s, scene(), { resetContexts: () => { throw new Error('boom'); } }) === true; })());
  check('a non-function resetContexts is skipped, no throw',
    (() => { const s = dirtyState(); return SR.resetSceneRuntime(s, scene(), { resetContexts: 42 }) === true; })());
  check('a resetDialogue hook runs on scene load (P4 Advanced batch 7)',
    (() => {
      let calls = 0;
      const s = dirtyState();
      const ok = SR.resetSceneRuntime(s, scene(), { resetDialogue: () => { calls++; } });
      return ok === true && calls === 1;
    })());
  check('a missing resetDialogue hook is fine',
    (() => { const s = dirtyState(); return SR.resetSceneRuntime(s, scene(), {}) === true; })());
  check('a throwing resetDialogue is swallowed',
    (() => { const s = dirtyState(); return SR.resetSceneRuntime(s, scene(), { resetDialogue: () => { throw new Error('boom'); } }) === true; })());
  check('a non-function resetDialogue is skipped, no throw',
    (() => { const s = dirtyState(); return SR.resetSceneRuntime(s, scene(), { resetDialogue: 42 }) === true; })());
  check('a frozen state object returns false instead of throwing',
    (() => {
      let threw = false;
      let r = null;
      try { r = SR.resetSceneRuntime(Object.freeze(dirtyState()), scene(), fullHooks()); }
      catch (e) { threw = true; }
      return !threw && r === false;
    })());
  check('a frozen collection (clear throws) is swallowed, reset still returns true',
    (() => {
      const frozen = Object.freeze(new Set([1]));
      const s = dirtyState();
      return SR.resetSceneRuntime(s, scene(), { hidden: frozen }) === true && s.camera.x === 0;
    })());
}

// --- the return contract on bad input ---
{
  check('a null state is a no-op returning false', SR.resetSceneRuntime(null, scene(), fullHooks()) === false);
  check('a null scene is a no-op returning false', SR.resetSceneRuntime(dirtyState(), null, fullHooks()) === false);
  check('a non-object state is a no-op returning false', SR.resetSceneRuntime('nope', scene(), fullHooks()) === false);
  check('a non-object scene is a no-op returning false', SR.resetSceneRuntime(dirtyState(), 42, fullHooks()) === false);
  check('a missing scene is a no-op returning false', SR.resetSceneRuntime(dirtyState(), undefined, fullHooks()) === false);
}

// --- static routing: both runtimes delegate to the module ---
{
  const runtimeSrc = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'player-runtime.js'), 'utf8');
  const scriptSrc = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'script.js'), 'utf8');
  const moduleSrc = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-previewruntime.js'), 'utf8');
  const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'index.html'), 'utf8');
  check('player-runtime.js hard-guards on HydraSceneReset',
    runtimeSrc.includes("throw new Error('HydraScript player runtime requires hydra-scenereset.js (window.HydraSceneReset) to be loaded first.');"));
  check('player-runtime.js inlines HydraSceneReset into exports (sharedSources)',
    runtimeSrc.includes("['HydraSceneReset', global.HydraSceneReset && global.HydraSceneReset.factorySource, 'hydra-scenereset.js (window.HydraSceneReset)']"));
  check('player-runtime.js loadScene delegates to HydraSceneReset.resetSceneRuntime',
    runtimeSrc.includes('HydraSceneReset.resetSceneRuntime(state, scene, {'));
  const loadScene = runtimeSrc.slice(
    runtimeSrc.indexOf('function loadScene(state, sceneId) {'),
    runtimeSrc.indexOf('function resizeCanvas(state) {'));
  check('player-runtime.js loadScene no longer inlines the camera reset',
    !loadScene.includes("state.camera = { x: 0, y: 0, zoom: 1, followTarget: '', offsetX: 0, offsetY: 0 };"));
  check('player-runtime.js loadScene no longer calls normalizeCamera3d directly',
    !loadScene.includes('Hydra3d.normalizeCamera3d(scene.camera3d, scene)'));
  check('player-runtime.js loadScene no longer creates particles directly',
    !loadScene.includes('state.particles = HydraParticles.createParticleState();'));
  check('player-runtime.js loadScene no longer clears the collections inline',
    !loadScene.includes('state.hidden.clear();') && !loadScene.includes('state.timers.clear();') &&
    !loadScene.includes('state.startedScopes.clear();'));
  check('player-runtime.js loadScene no longer resets pause/trigger inline',
    !loadScene.includes('state.paused = false;') && !loadScene.includes('state._triggerPairs = {};'));
  check('player-runtime.js loadScene still clones the objects + runs the object init',
    loadScene.includes('state.objects = clone(scene.objects || []);') &&
    loadScene.includes('HydraSceneInit.initSceneObjects(state.objects, {'));
  check('the preview runtime module defines the sceneResetHooks helper with the preview collections',
    moduleSrc.includes('function sceneResetHooks() {') &&
    moduleSrc.includes('hidden: hiddenSet(),') &&
    moduleSrc.includes('timers: timersMap(),') &&
    moduleSrc.includes('once: onceSet(),') &&
    moduleSrc.includes('startedScopes: startedScopes(),'));
  const resetCalls = (moduleSrc.match(/resetSceneRuntime\(rs, scene, sceneResetHooks\(\)\)/g) || []).length;
  check('the preview runtime module delegates exactly twice (launchPreview + loadPreviewScene)',
    resetCalls === 2, `calls=${resetCalls}`);
  const loadPreview = moduleSrc.slice(
    moduleSrc.indexOf('function loadPreviewScene(scene) {'),
    moduleSrc.indexOf('function switchPreviewScene(sceneId) {'));
  check('the module loadPreviewScene no longer inlines the camera/3D-camera reset',
    !loadPreview.includes("camera = { x: 0, y: 0, zoom: 1, followTarget:") &&
    !loadPreview.includes('normalizeCamera3d(scene.camera3d, scene)'));
  check('the module loadPreviewScene no longer clears timers/once/startedScopes inline',
    !loadPreview.includes('timersMap().clear();') && !loadPreview.includes('onceSet().clear();') &&
    !loadPreview.includes('resetGameStartState();'));
  check('the module loadPreviewScene no longer resets pause/trigger inline',
    !loadPreview.includes('paused = false;') && !loadPreview.includes('_triggerPairs = {};'));
  check('the module loadPreviewScene still resets frameId (deliberately host-side)',
    loadPreview.includes('rs.frameId = 0;'));
  const launch = moduleSrc.slice(
    moduleSrc.indexOf('function launchPreview() {'),
    moduleSrc.indexOf('function gameLoop(timestamp) {'));
  check('the module launchPreview no longer inlines the camera/trigger reset',
    !launch.includes("camera = { x: 0, y: 0, zoom: 1, followTarget:") &&
    !launch.includes('_triggerContacts = [];'));
  check('the module launchPreview no longer clears hidden/destroyed/once inline',
    !launch.includes('hiddenSet().clear();') && !launch.includes('onceSet().clear();'));
  check('the module launchPreview still resets the camera shake (deliberately host-side)',
    launch.includes('rs.cameraShake = { strength: 0, timeLeft: 0 };'));
  check('index.html loads hydra-scenereset.js before player-runtime.js and script.js',
    indexSrc.indexOf('src="hydra-scenereset.js') !== -1 &&
    indexSrc.indexOf('src="hydra-scenereset.js') < indexSrc.indexOf('src="player-runtime.js') &&
    indexSrc.indexOf('src="hydra-scenereset.js') < indexSrc.indexOf('src="script.js'));
}

if (failures) { console.error(`${failures} assertion(s) failed`); process.exit(1); }
console.log('scenereset.test.js: all assertions passed');
