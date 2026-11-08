// Unit tests for hydra/hydra-platform.js — the shared moving platforms
// & one-way platforms (P4 Advanced batch 27: moving platforms &
// one-way platforms, beginner edition).
//
// Pure logic: per-object platform config, the waypoint mover, the rider
// carry, the crumble timer, the one-way standing rule, and the runtime
// setters — plus the routing sets. Nothing here touches the DOM; both
// runtimes delegate to this module. Static checks at the end pin the
// wiring: catalog blocks, both runtimes' dispatch, the flow trigger
// mode, the frame phase, the scene-reset minting, and the docs.

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
sandbox.window = sandbox; // hydra-platform.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-platform.js'), 'utf8'),
  sandbox, { filename: 'hydra-platform.js' });
const P = sandbox.HydraPlatform;

check('HydraPlatform exposed with helpers',
  !!P && typeof P.createPlatformState === 'function' &&
  typeof P.normalizeSpeed === 'function' &&
  typeof P.normalizeCrumbleSeconds === 'function' &&
  typeof P.normalizeMode === 'function' &&
  typeof P.normalizePoints === 'function' &&
  typeof P.normalizePlatformConfig === 'function' &&
  typeof P.platformConfigOf === 'function' &&
  typeof P.isMovingPlatform === 'function' &&
  typeof P.isOneWayPlatform === 'function' &&
  typeof P.recordOf === 'function' &&
  typeof P.standsOn === 'function' &&
  typeof P.platformUnder === 'function' &&
  typeof P.updatePlatforms === 'function' &&
  typeof P.setPlatformPath === 'function' &&
  typeof P.setOneWay === 'function' &&
  typeof P.setCrumbleTime === 'function' &&
  typeof P.isPlatformAction === 'function' &&
  typeof P.isPlatformCondition === 'function');
check('factorySource is a non-empty string',
  typeof P.factorySource === 'string' && P.factorySource.length > 100 &&
  P.factorySource.includes('hydraPlatformFactory'));

// --- normalizers ---
check('normalizeSpeed is 0..1000 with a 60 default',
  P.normalizeSpeed(60) === 60 && P.normalizeSpeed(0) === 0 &&
  P.normalizeSpeed(-5) === 0 && P.normalizeSpeed(5000) === 1000 &&
  P.normalizeSpeed('120') === 120 && P.normalizeSpeed('oops') === 60 &&
  P.normalizeSpeed(null) === 60 && P.normalizeSpeed([]) === 60);
check('normalizeCrumbleSeconds is 0..30 with a 0 default',
  P.normalizeCrumbleSeconds(2) === 2 && P.normalizeCrumbleSeconds(0) === 0 &&
  P.normalizeCrumbleSeconds(-1) === 0 && P.normalizeCrumbleSeconds(99) === 30 &&
  P.normalizeCrumbleSeconds('1.5') === 1.5 && P.normalizeCrumbleSeconds('oops') === 0 &&
  P.normalizeCrumbleSeconds(null) === 0 && P.normalizeCrumbleSeconds([]) === 0);
check('normalizeMode is pingpong unless loop',
  P.normalizeMode('loop') === 'loop' && P.normalizeMode('pingpong') === 'pingpong' &&
  P.normalizeMode('Loop') === 'loop' && P.normalizeMode('sideways') === 'pingpong' &&
  P.normalizeMode(null) === 'pingpong' && P.normalizeMode(undefined) === 'pingpong');
check('normalizePoints keeps finite pairs, drops bad entries, caps at 16',
  JSON.stringify(P.normalizePoints([{ x: 0, y: 0 }, { x: 100, y: 50 }])) ===
    JSON.stringify([{ x: 0, y: 0 }, { x: 100, y: 50 }]) &&
  P.normalizePoints([{ x: 0, y: 0 }, { x: 'bad', y: 0 }, null, { x: 5 }]).length === 1 &&
  P.normalizePoints('nope').length === 0 && P.normalizePoints(null).length === 0 &&
  P.normalizePoints(Array.from({ length: 20 }, (_, i) => ({ x: i, y: 0 }))).length === 16 &&
  P.normalizePoints([{ x: '10', y: '20' }])[0].x === 10);
check('normalizePlatformConfig repairs in place and merges the one-way flag both ways',
  (() => {
    const cfg = { enabled: 'yes', points: [{ x: 0, y: 0 }], speed: 'fast', mode: 'weird', oneWay: 1, crumbleSeconds: -2 };
    const obj = { collision: { oneWay: false } };
    const out = P.normalizePlatformConfig(cfg, obj);
    return out === cfg && cfg.enabled === false && cfg.points.length === 1 &&
      cfg.speed === 60 && cfg.mode === 'pingpong' && cfg.oneWay === false &&
      cfg.crumbleSeconds === 0 && obj.collision.oneWay === false;
  })() &&
  (() => {
    // A legacy one-way floor adopted into a platform config keeps
    // working: the physics record's flag is adopted, not clobbered.
    const cfg = { enabled: true, points: [], speed: 60, mode: 'pingpong', oneWay: false, crumbleSeconds: 0 };
    const obj = { collision: { oneWay: true } };
    P.normalizePlatformConfig(cfg, obj);
    return cfg.oneWay === true && obj.collision.oneWay === true;
  })() &&
  P.normalizePlatformConfig(null) === null &&
  P.normalizePlatformConfig('nope') === null);
check('platformConfigOf reads the defaults for a missing config',
  (() => {
    const d = P.platformConfigOf(null);
    const e = P.platformConfigOf({});
    const f = P.platformConfigOf({ platform: { enabled: true, points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], speed: 90, mode: 'loop', oneWay: true, crumbleSeconds: 2 } });
    return d.enabled === false && d.points.length === 0 && d.speed === 60 && d.mode === 'pingpong' &&
      d.oneWay === false && d.crumbleSeconds === 0 &&
      e.enabled === false && e.speed === 60 &&
      f.enabled === true && f.points.length === 2 && f.speed === 90 && f.mode === 'loop' &&
      f.oneWay === true && f.crumbleSeconds === 2;
  })());
check('isMovingPlatform needs enabled, two points, and a speed',
  P.isMovingPlatform({ platform: { enabled: true, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], speed: 60 } }) === true &&
  P.isMovingPlatform({ platform: { enabled: false, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], speed: 60 } }) === false &&
  P.isMovingPlatform({ platform: { enabled: true, points: [{ x: 0, y: 0 }], speed: 60 } }) === false &&
  P.isMovingPlatform({ platform: { enabled: true, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], speed: 0 } }) === false &&
  P.isMovingPlatform({}) === false && P.isMovingPlatform(null) === false);
check('isOneWayPlatform reads the config or the physics record',
  P.isOneWayPlatform({ platform: { oneWay: true } }) === true &&
  P.isOneWayPlatform({ collision: { oneWay: true } }) === true &&
  P.isOneWayPlatform({ platform: { oneWay: false }, collision: { oneWay: false } }) === false &&
  P.isOneWayPlatform({}) === false && P.isOneWayPlatform(null) === false);

// --- fixtures ---
function platAt(x, y, w, opts) {
  const o = Object.assign({
    id: 1, name: 'plat', kind: 'sprite', posX: x, posY: y, width: w || 200, height: 20,
    static: true, physicsEnabled: false,
    collision: { shape: 'box', mode: 'solid', layer: 0, mask: 255 },
    platform: { enabled: true, points: [{ x: x, y: y }, { x: x + 200, y: y }], speed: 60, mode: 'pingpong', oneWay: false, crumbleSeconds: 0 }
  }, opts || {});
  return o;
}
function riderAt(x, y, velY) {
  return { id: 2, name: 'hero', kind: 'sprite', posX: x, posY: y, width: 24, height: 24, velX: 0, velY: velY == null ? 0 : velY, static: false, physicsEnabled: true };
}
function hooksFor(list, hidden) {
  return {
    objects: list,
    hitbox: (o) => ({ x: o.posX, y: o.posY, width: o.width, height: o.height }),
    isCollision: (o) => !(o.collision && o.collision.enabled === false),
    isOneWay: (o) => !!(o && ((o.platform && o.platform.oneWay === true) || (o.collision && o.collision.oneWay === true))),
    hide: (o) => { if (hidden) hidden.add(o.id); }
  };
}

// --- standing ---
check('standsOn is true on top of the platform and false beside, above, or below it',
  (() => {
    const st = P.createPlatformState();
    const plat = platAt(100, 300);
    const h = hooksFor([plat]);
    const rider = riderAt(150, 276); // feet at 300, the platform top
    if (!P.standsOn(rider, plat, st, h)) return false;
    rider.posY = 256; // 20px above
    if (P.standsOn(rider, plat, st, h)) return false;
    rider.posY = 276; rider.posX = 400; // beside the platform
    if (P.standsOn(rider, plat, st, h)) return false;
    rider.posX = 150; rider.posY = 320; // sunk below the top
    if (P.standsOn(rider, plat, st, h)) return false;
    return true;
  })());
check('standsOn ignores a one-way platform while the rider rises through it',
  (() => {
    const st = P.createPlatformState();
    const plat = platAt(100, 300);
    plat.platform.oneWay = true;
    plat.collision.oneWay = true;
    const h = hooksFor([plat]);
    const rider = riderAt(150, 276, -12); // rising through from below
    if (P.standsOn(rider, plat, st, h)) return false;
    rider.velY = 0; // standing on it counts
    if (!P.standsOn(rider, plat, st, h)) return false;
    rider.velY = 5; // falling onto it counts
    if (!P.standsOn(rider, plat, st, h)) return false;
    return true;
  })());
check('standsOn ignores a crumbled platform',
  (() => {
    const st = P.createPlatformState();
    const plat = platAt(100, 300);
    const rec = P.recordOf(st, plat, true);
    rec.crumbled = true;
    const h = hooksFor([plat]);
    return P.standsOn(riderAt(150, 276), plat, st, h) === false;
  })());
check('platformUnder finds the platform under the rider, and a one-way floor for the one-way read',
  (() => {
    const st = P.createPlatformState();
    const plat = platAt(100, 300);
    const plain = { id: 3, name: 'ledge', kind: 'sprite', posX: 400, posY: 300, width: 200, height: 20, static: true, physicsEnabled: false, collision: { oneWay: true } };
    const h = hooksFor([plat, plain]);
    const rider = riderAt(150, 276);
    if (P.platformUnder(st, rider, h, false) !== plat) return false;
    if (P.platformUnder(st, rider, h, true) !== null) return false; // the moving platform is solid
    const rider2 = riderAt(450, 276);
    if (P.platformUnder(st, rider2, h, true) !== plain) return false; // the plain one-way floor counts
    if (P.platformUnder(st, rider2, h, false) !== null) return false;
    if (P.platformUnder(st, riderAt(0, 0), h, false) !== null) return false;
    if (P.platformUnder(st, rider, null, false) !== null) return false;
    return true;
  })());

// --- per-frame update ---
check('updatePlatforms slides the platform and carries its rider by the same step',
  (() => {
    const st = P.createPlatformState();
    const plat = platAt(100, 300);
    const rider = riderAt(150, 276);
    const list = [plat, rider];
    const h = hooksFor(list);
    // 60 px/s for one second: the platform slides 60px right.
    if (!P.updatePlatforms(st, list, 0, 1, h)) return false;
    if (plat.posX !== 160 || rider.posX !== 210) return false;
    if (plat.posY !== 300 || rider.posY !== 276) return false;
    // A rider that stepped off stays put.
    rider.posX = 500;
    P.updatePlatforms(st, list, 1, 1, h);
    if (plat.posX !== 220 || rider.posX !== 500) return false;
    return true;
  })());
check('updatePlatforms ping-pongs at the ends and loops around',
  (() => {
    // Ping-pong: 0 -> 200 -> 0.
    const st = P.createPlatformState();
    const plat = platAt(0, 0);
    plat.platform.points = [{ x: 0, y: 0 }, { x: 200, y: 0 }];
    plat.platform.speed = 200;
    const h = hooksFor([plat]);
    P.updatePlatforms(st, [plat], 0, 1, h); // arrives at 200
    if (plat.posX !== 200) return false;
    P.updatePlatforms(st, [plat], 1, 1, h); // back at 0
    if (plat.posX !== 0) return false;
    P.updatePlatforms(st, [plat], 2, 1, h); // off again toward 200
    if (plat.posX !== 200) return false;
    // Loop: 0 -> 200 -> 0 (jump) -> 200.
    const st2 = P.createPlatformState();
    const loop = platAt(0, 0);
    loop.platform.points = [{ x: 0, y: 0 }, { x: 200, y: 0 }];
    loop.platform.speed = 200;
    loop.platform.mode = 'loop';
    const h2 = hooksFor([loop]);
    P.updatePlatforms(st2, [loop], 0, 1, h2);
    if (loop.posX !== 200) return false;
    P.updatePlatforms(st2, [loop], 1, 1, h2); // snaps back to 0, then steps toward 200
    if (loop.posX !== 0) return 'loop did not snap back, posX=' + loop.posX;
    return true;
  })());
check('updatePlatforms carries a rider down and up, not just sideways',
  (() => {
    const st = P.createPlatformState();
    const plat = platAt(100, 300);
    plat.platform.points = [{ x: 100, y: 300 }, { x: 100, y: 500 }];
    const rider = riderAt(150, 276);
    const list = [plat, rider];
    const h = hooksFor(list);
    P.updatePlatforms(st, list, 0, 1, h); // 60px down
    if (plat.posY !== 360 || rider.posY !== 336) return false;
    return true;
  })());
check('updatePlatforms holds still on a zero dt and with no state',
  (() => {
    const st = P.createPlatformState();
    const plat = platAt(100, 300);
    const h = hooksFor([plat]);
    P.updatePlatforms(st, [plat], 0, 0, h);
    if (plat.posX !== 100) return false;
    return P.updatePlatforms(null, [plat], 0, 1, h) === false;
  })());
check('updatePlatforms drops records for platforms that left the scene',
  (() => {
    const st = P.createPlatformState();
    const plat = platAt(100, 300);
    P.recordOf(st, plat, true);
    P.updatePlatforms(st, [], 0, 1, hooksFor([]));
    return Object.keys(st.records).length === 0;
  })());
check('a parked platform never moves but still crumbles under a rider',
  (() => {
    const st = P.createPlatformState();
    const plat = platAt(100, 300);
    plat.platform.speed = 0; // parked
    plat.platform.crumbleSeconds = 1;
    const rider = riderAt(150, 276);
    const hidden = new Set();
    const list = [plat, rider];
    const h = hooksFor(list, hidden);
    P.updatePlatforms(st, list, 0, 1 / 60, h);
    if (plat.posX !== 100) return false; // never moves
    const rec = P.recordOf(st, plat, false);
    if (!rec || rec.crumbleAt !== 1) return 'timer did not start, crumbleAt=' + (rec && rec.crumbleAt);
    P.updatePlatforms(st, list, 0.5, 1 / 60, h);
    if (rec.crumbled) return 'crumbled too early';
    P.updatePlatforms(st, list, 1, 1 / 60, h);
    if (!rec.crumbled) return 'did not crumble at the deadline';
    if (plat.collision.enabled !== false) return 'collision still on after the crumble';
    if (!hidden.has(plat.id)) return 'not hidden after the crumble';
    // A crumbled platform never carries again.
    P.updatePlatforms(st, list, 2, 1, h);
    if (rider.posY !== 276) return 'rider moved after the crumble';
    return true;
  })());
check('the crumble timer runs to the end even if the rider steps off',
  (() => {
    const st = P.createPlatformState();
    const plat = platAt(100, 300);
    plat.platform.crumbleSeconds = 1;
    const rider = riderAt(150, 276);
    const list = [plat, rider];
    const h = hooksFor(list);
    P.updatePlatforms(st, list, 0, 1 / 60, h);
    rider.posX = 500; // stepped off
    P.updatePlatforms(st, list, 1, 1 / 60, h);
    const rec = P.recordOf(st, plat, false);
    return !!(rec && rec.crumbled);
  })());
check('a platform with no crumble time never crumbles',
  (() => {
    const st = P.createPlatformState();
    const plat = platAt(100, 300);
    const rider = riderAt(150, 276);
    const list = [plat, rider];
    const h = hooksFor(list);
    for (let t = 0; t <= 30; t++) P.updatePlatforms(st, list, t, 1 / 60, h);
    const rec = P.recordOf(st, plat, false);
    return !!(rec && !rec.crumbled && plat.collision.enabled !== false);
  })());

// --- config writes ---
check('setPlatformPath writes the path, speed, and mode, and switches the platform on',
  (() => {
    const obj = { id: 9, name: 'floor', kind: 'sprite', posX: 50, posY: 50, width: 100, height: 20 };
    const pts = P.setPlatformPath(obj, [{ x: 50, y: 50 }, { x: 250, y: 50 }], 80, 'loop');
    return Array.isArray(pts) && pts.length === 2 && pts[0].x === 50 && pts[1].x === 250 &&
      obj.platform.enabled === true && obj.platform.speed === 80 && obj.platform.mode === 'loop' &&
      P.isMovingPlatform(obj) === true;
  })() &&
  P.setPlatformPath(null, [], 60, 'pingpong') === null &&
  (() => {
    const obj = { id: 9, name: 'floor', kind: 'sprite' };
    P.setPlatformPath(obj, [{ x: 0, y: 0 }, { x: 'bad', y: 0 }], 'fast', 'weird');
    return obj.platform.points.length === 1 && obj.platform.speed === 60 && obj.platform.mode === 'pingpong';
  })());
check('setOneWay flips both the config and the physics record, and reads string values',
  P.setOneWay({ platform: {}, collision: {} }, true) === true &&
  (() => {
    const obj = { platform: { oneWay: false }, collision: { oneWay: false } };
    if (P.setOneWay(obj, 'true') !== true) return false;
    if (obj.platform.oneWay !== true || obj.collision.oneWay !== true) return false;
    if (P.setOneWay(obj, 'false') !== false) return false;
    return obj.platform.oneWay === false && obj.collision.oneWay === false;
  })() &&
  P.setOneWay(null, true) === null);
check('setCrumbleTime normalizes and clamps the delay',
  (() => {
    const obj = { platform: {} };
    return P.setCrumbleTime(obj, 2) === 2 && obj.platform.crumbleSeconds === 2 &&
      P.setCrumbleTime(obj, 99) === 30 && P.setCrumbleTime(obj, 'oops') === 0;
  })() && P.setCrumbleTime(null, 2) === null);

// --- routing ---
check('routing sets classify the platform blocks',
  P.isPlatformAction('setPlatformPath') && P.isPlatformAction('setOneWay') &&
  P.isPlatformAction('setCrumbleTime') && !P.isPlatformAction('jump') &&
  !P.isPlatformAction('standingOnPlatform') &&
  P.isPlatformCondition('standingOnPlatform') && P.isPlatformCondition('standingOnOneWay') &&
  !P.isPlatformCondition('setPlatformPath') && !P.isPlatformCondition('jumpsLeft'));

// --- static wiring pins ---
{
  const indexHtml = fs.readFileSync(path.join(HYDRA, 'index.html'), 'utf8');
  check('index.html loads hydra-platform.js after hydra-movement.js and before player-runtime.js',
    indexHtml.indexOf('hydra-platform.js') > indexHtml.indexOf('hydra-movement.js') &&
    indexHtml.indexOf('hydra-platform.js') < indexHtml.indexOf('player-runtime.js'));
  const playerJs = fs.readFileSync(path.join(HYDRA, 'player-runtime.js'), 'utf8');
  check('player-runtime.js throws a clear error without HydraPlatform',
    playerJs.includes("if (!HydraPlatform || typeof HydraPlatform.createPlatformState !== 'function')") &&
    playerJs.includes('HydraScript player runtime requires hydra-platform.js'));
  check('player-runtime.js inlines HydraPlatform into exports',
    playerJs.includes("'HydraPlatform', global.HydraPlatform && global.HydraPlatform.factorySource"));
  check('player-runtime.js classifies platform blocks for the dispatch',
    playerJs.includes('HydraPlatform.isPlatformCondition(type)') &&
    playerJs.includes('HydraPlatform.isPlatformAction(type)'));
  check('player-runtime.js exposes the module to both contexts and runs the frame phase',
    playerJs.includes('platformModule: HydraPlatform') &&
    playerJs.includes('platform: state.platform') &&
    playerJs.includes('updatePlatforms: () => {') &&
    playerJs.includes('HydraPlatform.updatePlatforms(state.platform, live,'));
  check('player-runtime.js mints fresh platform state per scene load',
    playerJs.includes('createPlatformState: () => HydraPlatform.createPlatformState()'));
  const frameJs = fs.readFileSync(path.join(HYDRA, 'hydra-frame.js'), 'utf8');
  check('frame module runs updatePlatforms after the spawners and before the movement phase',
    frameJs.includes("'updatePaths', 'updateSpawners', 'updatePlatforms', 'updateMovement',") &&
    frameJs.includes("call('updatePlatforms', host.updatePlatforms);") &&
    frameJs.includes("call('updateMovement', host.updateMovement);"));
  const resetJs = fs.readFileSync(path.join(HYDRA, 'hydra-scenereset.js'), 'utf8');
  check('scene reset mints fresh platform state per scene load',
    resetJs.includes("typeof h.createPlatformState === 'function'") &&
    resetJs.includes('state.platform = platformSt;'));
  const previewJs = fs.readFileSync(path.join(HYDRA, 'hydra-previewruntime.js'), 'utf8');
  check('preview runtime exposes the module to both contexts',
    (previewJs.match(/platformModule: mod\('Platform'\)/g) || []).length === 2 &&
    previewJs.includes('platform: run ? run.platform : null') &&
    previewJs.includes("ensurePlatformState: function () { return hostCall('ensurePreviewPlatformState', [], null); }"));
  check('preview runtime runs the platform frame phase and mints state per scene',
    previewJs.includes('updatePlatforms: function () {') &&
    previewJs.includes('PF.updatePlatforms(r.platform, objs, nowSec, dt / 60,') &&
    previewJs.includes('createPlatformState: function () {') &&
    previewJs.includes("mod('Platform')"));
  const scriptJs = fs.readFileSync(path.join(HYDRA, 'script.js'), 'utf8');
  check('editor hands the platform-state maker to the preview runtime host',
    scriptJs.includes('function ensurePreviewPlatformState()') &&
    scriptJs.includes('ensurePreviewPlatformState, ensurePreviewCombatState, getPreviewBuses'));
  check('editor Inspector carries the Platform section',
    scriptJs.includes('function appendPlatformEditor(root, obj)') &&
    scriptJs.includes("title.textContent = 'Platform'") &&
    scriptJs.includes('appendPlatformEditor(root, obj)') &&
    scriptJs.includes("makePropGroup('Point 1 X:'") &&
    scriptJs.includes("makePropGroup('Speed (px/s):'") &&
    scriptJs.includes("makePropGroup('Crumble after (s):'"));
  const executeJs = fs.readFileSync(path.join(HYDRA, 'hydra-execute.js'), 'utf8');
  check('shared execute module runs the three platform actions',
    executeJs.includes("if (isType(ctx.platformModule, 'isPlatformAction', type))") &&
    executeJs.includes("type === 'setPlatformPath'") &&
    executeJs.includes("type === 'setOneWay'") &&
    executeJs.includes("type === 'setCrumbleTime'") &&
    executeJs.includes('PF.setPlatformPath(o,') &&
    executeJs.includes('PF.setOneWay(o, data.enabled)') &&
    executeJs.includes('PF.setCrumbleTime(o, ctSec.value)'));
  const conditionsJs = fs.readFileSync(path.join(HYDRA, 'hydra-conditions.js'), 'utf8');
  check('shared conditions module reads Standing On Platform and Standing On One-Way',
    conditionsJs.includes("case 'standingOnPlatform':") &&
    conditionsJs.includes("case 'standingOnOneWay':") &&
    conditionsJs.includes('PFm.platformUnder(ctx.platform, o, platformHooks(ctx), false)') &&
    conditionsJs.includes('PFm2.platformUnder(ctx.platform, o, platformHooks(ctx), true)'));
  check('shared conditions module does not freeze the platform reads while paused',
    !conditionsJs.split('FROZEN_WHILE_PAUSED = [')[1].split('];')[0].includes("'standingOnPlatform'") &&
    !conditionsJs.split('FROZEN_WHILE_PAUSED = [')[1].split('];')[0].includes('standingOnOneWay'));
  const flowSb = {};
  flowSb.window = flowSb;
  vm.createContext(flowSb);
  vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-flow.js'), 'utf8'),
    flowSb, { filename: 'hydra-flow.js' });
  const F = flowSb.HydraFlow;
  check('flow module reads Standing On Platform and Standing On One-Way as level triggers',
    F.defaultTriggerMode('standingOnPlatform') === 'level' &&
    F.defaultTriggerMode('standingOnOneWay') === 'level');
  const resetSb = {};
  resetSb.window = resetSb;
  vm.createContext(resetSb);
  vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-scenereset.js'), 'utf8'),
    resetSb, { filename: 'hydra-scenereset.js' });
  const SR = resetSb.HydraSceneReset;
  check('scene reset mints a fresh platform state (a platform never carries its position into the next scene)',
    (() => {
      const pf = { records: { 1: { target: 0, dir: -1, crumbleAt: 5, crumbled: true } } };
      const state = { platform: pf };
      const ok = SR.resetSceneRuntime(state, { id: 1 }, {
        createPlatformState: () => ({ records: {} })
      });
      return ok === true && state.platform !== pf && JSON.stringify(state.platform) === JSON.stringify({ records: {} });
    })() &&
    (() => {
      const state = {};
      const ok = SR.resetSceneRuntime(state, { id: 2 }, {});
      return ok === true && state.platform === null;
    })());
  const catalogJs = fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8');
  check('catalog carries the five platform blocks in the Platform category',
    catalogJs.includes("category: 'Platform'") &&
    catalogJs.includes("blockType: 'set-platform-path'") &&
    catalogJs.includes("runtimeType: 'setPlatformPath'") &&
    catalogJs.includes("blockType: 'set-one-way'") &&
    catalogJs.includes("runtimeType: 'setOneWay'") &&
    catalogJs.includes("blockType: 'set-crumble-time'") &&
    catalogJs.includes("runtimeType: 'setCrumbleTime'") &&
    catalogJs.includes("blockType: 'standing-on-platform'") &&
    catalogJs.includes("runtimeType: 'standingOnPlatform'") &&
    catalogJs.includes("blockType: 'standing-on-oneway'") &&
    catalogJs.includes("runtimeType: 'standingOnOneWay'") &&
    catalogJs.includes("key: 'x1', label: 'Point 1 X'") &&
    catalogJs.includes("key: 'speed', label: 'Speed (px/s)'") &&
    catalogJs.includes("key: 'mode', label: 'Mode'"));
  const refMd = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');
  check('block reference documents all five platform blocks',
    refMd.includes('Set Platform Path') && refMd.includes('Set One-Way Platform') &&
    refMd.includes('Set Crumble Time') && refMd.includes('Standing On Platform') &&
    refMd.includes('Standing On One-Way') && refMd.includes('### Platform (5)'));
  const guideMd = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');
  check('user guide covers moving platforms',
    guideMd.includes('Moving platforms') && guideMd.includes('one-way') &&
    guideMd.includes('crumble'));
}

process.exit(failures === 0 ? 0 : 1);
