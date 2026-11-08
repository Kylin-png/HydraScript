// Unit tests for hydra/hydra-movement.js — the shared movement
// abilities (P4 Advanced batch 26: double jump, coyote time, jump
// buffer & dash, beginner edition).
//
// Pure logic: per-object jump config, the ground / coyote / air jump
// ladder, the buffered press, the dash burst, and the per-frame
// refresh — plus the routing sets. Nothing here touches the DOM; both
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
sandbox.window = sandbox; // hydra-movement.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-movement.js'), 'utf8'),
  sandbox, { filename: 'hydra-movement.js' });
const M = sandbox.HydraMovement;

check('HydraMovement exposed with helpers',
  !!M && typeof M.createMovementState === 'function' &&
  typeof M.normalizeMaxJumps === 'function' &&
  typeof M.normalizeCoyoteSeconds === 'function' &&
  typeof M.normalizeBufferSeconds === 'function' &&
  typeof M.normalizeJumpSpeed === 'function' &&
  typeof M.normalizeDashSpeed === 'function' &&
  typeof M.normalizeDashDuration === 'function' &&
  typeof M.normalizeDashCooldown === 'function' &&
  typeof M.normalizeWallSlideMaxFall === 'function' &&
  typeof M.normalizeWallJumpSpeed === 'function' &&
  typeof M.normalizeWallJumpPush === 'function' &&
  typeof M.normalizeMovementConfig === 'function' &&
  typeof M.movementConfigOf === 'function' &&
  typeof M.recordOf === 'function' &&
  typeof M.isGrounded === 'function' &&
  typeof M.wallSides === 'function' &&
  typeof M.touchingWall === 'function' &&
  typeof M.inputDirX === 'function' &&
  typeof M.isWallSliding === 'function' &&
  typeof M.tryWallJump === 'function' &&
  typeof M.tryJump === 'function' &&
  typeof M.startDash === 'function' &&
  typeof M.isDashing === 'function' &&
  typeof M.canDash === 'function' &&
  typeof M.updateMovement === 'function' &&
  typeof M.jumpsLeft === 'function' &&
  typeof M.setMaxJumps === 'function' &&
  typeof M.setCoyoteTime === 'function' &&
  typeof M.setJumpBuffer === 'function' &&
  typeof M.setWallSlide === 'function' &&
  typeof M.setWallJump === 'function' &&
  typeof M.isMovementAction === 'function' &&
  typeof M.isMovementCondition === 'function');
check('factorySource is a non-empty string',
  typeof M.factorySource === 'string' && M.factorySource.length > 100 &&
  M.factorySource.includes('hydraMovementFactory'));

// --- normalizers ---
check('normalizeMaxJumps is a whole 1..10 with a 1 default',
  M.normalizeMaxJumps(2) === 2 && M.normalizeMaxJumps(1) === 1 &&
  M.normalizeMaxJumps(0) === 1 && M.normalizeMaxJumps(-3) === 1 &&
  M.normalizeMaxJumps(99) === 10 && M.normalizeMaxJumps(2.7) === 2 &&
  M.normalizeMaxJumps('3') === 3 && M.normalizeMaxJumps('oops') === 1 &&
  M.normalizeMaxJumps(null) === 1 && M.normalizeMaxJumps(undefined) === 1);
check('normalizeCoyoteSeconds is 0..1 with a 0 default',
  M.normalizeCoyoteSeconds(0.1) === 0.1 && M.normalizeCoyoteSeconds(0) === 0 &&
  M.normalizeCoyoteSeconds(-1) === 0 && M.normalizeCoyoteSeconds(5) === 1 &&
  M.normalizeCoyoteSeconds('0.2') === 0.2 && M.normalizeCoyoteSeconds('oops') === 0 &&
  M.normalizeCoyoteSeconds(null) === 0);
check('normalizeBufferSeconds is 0..1 with a 0 default',
  M.normalizeBufferSeconds(0.1) === 0.1 && M.normalizeBufferSeconds(0) === 0 &&
  M.normalizeBufferSeconds(-1) === 0 && M.normalizeBufferSeconds(5) === 1 &&
  M.normalizeBufferSeconds('oops') === 0 && M.normalizeBufferSeconds(null) === 0);
check('normalizeJumpSpeed is 0..100 with a 12 default',
  M.normalizeJumpSpeed(12) === 12 && M.normalizeJumpSpeed(0) === 0 &&
  M.normalizeJumpSpeed(-5) === 0 && M.normalizeJumpSpeed(500) === 100 &&
  M.normalizeJumpSpeed('14') === 14 && M.normalizeJumpSpeed('oops') === 12 &&
  M.normalizeJumpSpeed(null) === 12);
check('normalizeDashSpeed is 0..2000 with a 400 default',
  M.normalizeDashSpeed(400) === 400 && M.normalizeDashSpeed(0) === 0 &&
  M.normalizeDashSpeed(-10) === 0 && M.normalizeDashSpeed(9000) === 2000 &&
  M.normalizeDashSpeed('600') === 600 && M.normalizeDashSpeed('oops') === 400);
check('normalizeDashDuration is 0..2 with a 0.15 default',
  M.normalizeDashDuration(0.15) === 0.15 && M.normalizeDashDuration(0) === 0 &&
  M.normalizeDashDuration(-1) === 0 && M.normalizeDashDuration(9) === 2 &&
  M.normalizeDashDuration('oops') === 0.15);
check('normalizeDashCooldown is 0..10 with a 0.5 default',
  M.normalizeDashCooldown(0.5) === 0.5 && M.normalizeDashCooldown(0) === 0 &&
  M.normalizeDashCooldown(-1) === 0 && M.normalizeDashCooldown(99) === 10 &&
  M.normalizeDashCooldown('oops') === 0.5);
check('normalizeWallSlideMaxFall is 0..2000 px/s with a 0 default (no slide)',
  M.normalizeWallSlideMaxFall(60) === 60 && M.normalizeWallSlideMaxFall(0) === 0 &&
  M.normalizeWallSlideMaxFall(-5) === 0 && M.normalizeWallSlideMaxFall(9000) === 2000 &&
  M.normalizeWallSlideMaxFall('120') === 120 && M.normalizeWallSlideMaxFall('oops') === 0 &&
  M.normalizeWallSlideMaxFall(null) === 0);
check('normalizeWallJumpSpeed is 0..100 with a 0 default (no wall jump)',
  M.normalizeWallJumpSpeed(12) === 12 && M.normalizeWallJumpSpeed(0) === 0 &&
  M.normalizeWallJumpSpeed(-5) === 0 && M.normalizeWallJumpSpeed(500) === 100 &&
  M.normalizeWallJumpSpeed('14') === 14 && M.normalizeWallJumpSpeed('oops') === 0 &&
  M.normalizeWallJumpSpeed(null) === 0);
check('normalizeWallJumpPush is 0..100 with an 8 default',
  M.normalizeWallJumpPush(8) === 8 && M.normalizeWallJumpPush(0) === 0 &&
  M.normalizeWallJumpPush(-5) === 0 && M.normalizeWallJumpPush(500) === 100 &&
  M.normalizeWallJumpPush('10') === 10 && M.normalizeWallJumpPush('oops') === 8 &&
  M.normalizeWallJumpPush(null) === 8);
check('hostile input degrades to safe defaults',
  M.normalizeMaxJumps([]) === 1 && M.normalizeCoyoteSeconds([]) === 0 &&
  M.normalizeBufferSeconds([]) === 0 && M.normalizeJumpSpeed([]) === 12 &&
  M.normalizeDashSpeed([]) === 400 && M.normalizeDashDuration([]) === 0.15 &&
  M.normalizeDashCooldown([]) === 0.5 &&
  M.normalizeWallSlideMaxFall([]) === 0 && M.normalizeWallJumpSpeed([]) === 0 &&
  M.normalizeWallJumpPush([]) === 8);

// --- config ---
check('createMovementState starts with an empty records map',
  JSON.stringify(M.createMovementState()) === JSON.stringify({ records: {} }));
check('normalizeMovementConfig repairs in place and returns the record',
  (() => {
    const cfg = { maxJumps: 99, coyoteSeconds: -1, bufferSeconds: 'oops', wallSlideMaxFall: 9000, wallJumpSpeed: -2, wallJumpPush: 'oops' };
    const out = M.normalizeMovementConfig(cfg);
    return out === cfg && cfg.maxJumps === 10 && cfg.coyoteSeconds === 0 && cfg.bufferSeconds === 0 &&
      cfg.wallSlideMaxFall === 2000 && cfg.wallJumpSpeed === 0 && cfg.wallJumpPush === 8;
  })() &&
  M.normalizeMovementConfig(null) === null &&
  M.normalizeMovementConfig('nope') === null);
check('movementConfigOf reads the defaults for a missing config',
  JSON.stringify(M.movementConfigOf(null)) === JSON.stringify({ maxJumps: 1, coyoteSeconds: 0, bufferSeconds: 0, wallSlideMaxFall: 0, wallJumpSpeed: 0, wallJumpPush: 8 }) &&
  JSON.stringify(M.movementConfigOf({})) === JSON.stringify({ maxJumps: 1, coyoteSeconds: 0, bufferSeconds: 0, wallSlideMaxFall: 0, wallJumpSpeed: 0, wallJumpPush: 8 }) &&
  JSON.stringify(M.movementConfigOf({ movement: { maxJumps: 2, coyoteSeconds: 0.1, bufferSeconds: 0.2, wallSlideMaxFall: 60, wallJumpSpeed: 12, wallJumpPush: 8 } })) ===
    JSON.stringify({ maxJumps: 2, coyoteSeconds: 0.1, bufferSeconds: 0.2, wallSlideMaxFall: 60, wallJumpSpeed: 12, wallJumpPush: 8 }) &&
  // Old objects carry no wall fields: they read as no slide and no
  // wall jump, exactly the old behavior.
  JSON.stringify(M.movementConfigOf({ movement: { maxJumps: 2, coyoteSeconds: 0.1, bufferSeconds: 0.2 } })) ===
    JSON.stringify({ maxJumps: 2, coyoteSeconds: 0.1, bufferSeconds: 0.2, wallSlideMaxFall: 0, wallJumpSpeed: 0, wallJumpPush: 8 }));
check('movementConfigOf returns a copy, not the live record',
  (() => {
    const obj = { movement: { maxJumps: 2, coyoteSeconds: 0.1, bufferSeconds: 0.1 } };
    const cfg = M.movementConfigOf(obj);
    cfg.maxJumps = 9;
    return obj.movement.maxJumps === 2;
  })());

// --- grounded fixtures ---
function heroAt(x, y) {
  return { id: 1, name: 'hero', kind: 'sprite', posX: x, posY: y, width: 40, height: 40, velX: 0, velY: 0, static: false, physicsEnabled: true };
}
function floorAt(y) {
  return { id: 99, name: 'floor', kind: 'sprite', posX: 0, posY: y, width: 800, height: 40, static: true, physicsEnabled: false };
}
function hooksFor(hero, floor, tiles) {
  return {
    objects: [hero, floor].filter(Boolean),
    hitbox: (o) => ({ x: o.posX, y: o.posY, width: o.width, height: o.height }),
    isCollision: (o) => o.kind !== 'text',
    canCollide: null,
    tiles: tiles || null
  };
}
check('isGrounded is true standing on a floor and false in the air',
  (() => {
    const hero = heroAt(100, 360), floor = floorAt(400);
    const h = hooksFor(hero, floor);
    if (!M.isGrounded(hero, h)) return false;
    hero.posY = 340; // 20px above the floor
    if (M.isGrounded(hero, h)) return false;
    hero.posY = 360; hero.posX = 900; // beside the floor, no overlap
    if (M.isGrounded(hero, h)) return false;
    return true;
  })());
check('isGrounded is false for a non-collision object and with missing hooks',
  (() => {
    const hero = heroAt(100, 360); hero.kind = 'text';
    const floor = floorAt(400);
    if (M.isGrounded(hero, hooksFor(hero, floor))) return false;
    const hero2 = heroAt(100, 360);
    if (M.isGrounded(hero2, null)) return false;
    if (M.isGrounded(hero2, {})) return false;
    if (M.isGrounded(null, hooksFor(hero2, floor))) return false;
    return true;
  })());
check('isGrounded sees a solid tile floor (the tile-level rule)',
  (() => {
    const hero = heroAt(100, 360);
    const tm = { id: 7, name: 'map', kind: 'tilemap', posX: 0, posY: 0, width: 800, height: 600 };
    const tiles = { isSolidAtPixel: (m, x, y) => m === tm && y >= 400 };
    const h = { objects: [hero, tm], hitbox: (o) => ({ x: o.posX, y: o.posY, width: o.width, height: o.height }), isCollision: () => true, canCollide: null, tiles };
    if (!M.isGrounded(hero, h)) return false;
    hero.posY = 340; // feet at 380, the pixel below is 381 < 400
    if (M.isGrounded(hero, h)) return false;
    return true;
  })());
check('isGrounded skips a one-way floor while the hero rises through it (batch 27)',
  (() => {
    const hero = heroAt(100, 360);
    const floor = floorAt(400);
    floor.collision = { oneWay: true };
    const h = hooksFor(hero, floor);
    h.isOneWay = (o) => !!(o && o.collision && o.collision.oneWay === true);
    if (!M.isGrounded(hero, h)) return false; // standing on it counts
    hero.velY = 5; // falling onto it counts too
    if (!M.isGrounded(hero, h)) return false;
    hero.velY = -12; // rising through it does not count
    if (M.isGrounded(hero, h)) return false;
    // A solid floor still counts while rising (the old behavior).
    const solid = floorAt(400);
    const h2 = hooksFor(hero, solid);
    h2.isOneWay = (o) => !!(o && o.collision && o.collision.oneWay === true);
    if (!M.isGrounded(hero, h2)) return false;
    // Without the hook the config fallback reads the same way.
    const h3 = hooksFor(hero, floor);
    if (M.isGrounded(hero, h3)) return false;
    return true;
  })());
check('tryJump through a one-way platform is an air jump, not a ground jump (batch 27)',
  (() => {
    const st = M.createMovementState();
    const hero = heroAt(100, 360); hero.movement = { maxJumps: 1, coyoteSeconds: 0, bufferSeconds: 0 };
    hero.velY = -12; // rising through the platform from below
    const floor = floorAt(400);
    floor.collision = { oneWay: true };
    const h = hooksFor(hero, floor);
    h.isOneWay = (o) => !!(o && o.collision && o.collision.oneWay === true);
    if (M.tryJump(st, hero, 12, 0, h) !== 'air') return false;
    if (M.jumpsLeft(st, hero) !== 0) return false;
    // Landing on it, then jumping, is a ground jump again.
    hero.velY = 0;
    if (M.tryJump(st, hero, 12, 0.1, h) !== 'ground') return false;
    return M.jumpsLeft(st, hero) === 0;
  })());

// --- walls (batch 28) ---
function wallAt(x, y, w, h) {
  return { id: 50, name: 'wall', kind: 'sprite', posX: x, posY: y, width: w == null ? 40 : w, height: h == null ? 400 : h, static: true, physicsEnabled: false };
}
function wallHooks(hero, wall, keys) {
  const set = new Set(keys || []);
  return {
    objects: [hero, wall].filter(Boolean),
    hitbox: (o) => ({ x: o.posX, y: o.posY, width: o.width, height: o.height }),
    isCollision: (o) => o.kind !== 'text',
    canCollide: null,
    tiles: null,
    keys: set,
    hasKey: (s, k) => s.has(k)
  };
}
check('wallSides reads the touched side, and a floor underfoot is not a wall',
  (() => {
    const hero = heroAt(100, 100);
    const right = wallAt(140, 0); // hero right edge 140 meets the wall left edge
    const left = wallAt(60, 0); // hero left edge 100 meets the wall right edge
    if (JSON.stringify(M.wallSides(hero, wallHooks(hero, right))) !== JSON.stringify(['right'])) return false;
    if (M.touchingWall(hero, wallHooks(hero, right)) !== 'right') return false;
    if (JSON.stringify(M.wallSides(hero, wallHooks(hero, left))) !== JSON.stringify(['left'])) return false;
    if (M.touchingWall(hero, wallHooks(hero, left)) !== 'left') return false;
    const far = wallAt(400, 0);
    if (M.wallSides(hero, wallHooks(hero, far)).length !== 0) return false;
    if (M.touchingWall(hero, wallHooks(hero, far)) !== null) return false;
    // A floor underfoot: the hero stands on it, its top at the
    // hero's bottom, outside the vertical overlap — not a wall.
    const floorHero = heroAt(100, 360);
    if (M.wallSides(floorHero, hooksFor(floorHero, floorAt(400))).length !== 0) return false;
    // A hero 20px above the floor, beside a wall that starts at the
    // floor line: still a wall (vertical overlap holds).
    const high = heroAt(100, 340);
    if (JSON.stringify(M.wallSides(high, wallHooks(high, right))) !== JSON.stringify(['right'])) return false;
    return true;
  })());
check('wallSides skips one-way floors and non-collision objects, and stays quiet without hooks',
  (() => {
    const hero = heroAt(100, 100);
    const oneWay = wallAt(140, 0);
    oneWay.collision = { oneWay: true };
    const h = wallHooks(hero, oneWay);
    h.isOneWay = (o) => !!(o && o.collision && o.collision.oneWay === true);
    if (M.wallSides(hero, h).length !== 0) return false;
    // A solid wall still counts (the old behavior).
    const solid = wallAt(140, 0);
    const h2 = wallHooks(hero, solid);
    h2.isOneWay = (o) => !!(o && o.collision && o.collision.oneWay === true);
    if (JSON.stringify(M.wallSides(hero, h2)) !== JSON.stringify(['right'])) return false;
    const ghost = heroAt(100, 100); ghost.kind = 'text';
    if (M.wallSides(ghost, wallHooks(ghost, wallAt(140, 0))).length !== 0) return false;
    if (M.wallSides(hero, null).length !== 0) return false;
    if (M.wallSides(null, wallHooks(hero, wallAt(140, 0))).length !== 0) return false;
    return true;
  })());
check('inputDirX reads the arrow keys and A/D, both or neither reads 0',
  (() => {
    const hero = heroAt(100, 100);
    const wall = wallAt(140, 0);
    if (M.inputDirX(wallHooks(hero, wall, ['ArrowRight'])) !== 1) return false;
    if (M.inputDirX(wallHooks(hero, wall, ['KeyD'])) !== 1) return false;
    if (M.inputDirX(wallHooks(hero, wall, ['ArrowLeft'])) !== -1) return false;
    if (M.inputDirX(wallHooks(hero, wall, ['KeyA'])) !== -1) return false;
    if (M.inputDirX(wallHooks(hero, wall, [])) !== 0) return false;
    if (M.inputDirX(wallHooks(hero, wall, ['ArrowLeft', 'ArrowRight'])) !== 0) return false;
    if (M.inputDirX(wallHooks(hero, wall, ['Space'])) !== 0) return false;
    if (M.inputDirX(null) !== 0) return false;
    if (M.inputDirX({}) !== 0) return false;
    // No hasKey wired: a plain Set.has is the fallback.
    if (M.inputDirX({ keys: new Set(['KeyD']) }) !== 1) return false;
    return true;
  })());
check('isWallSliding needs the slide configured, a fall, air, a wall, and the press toward it',
  (() => {
    const hero = heroAt(100, 100);
    hero.movement = { wallSlideMaxFall: 60, wallJumpSpeed: 0, wallJumpPush: 8 };
    hero.velY = 5; // falling
    const wall = wallAt(140, 0);
    if (!M.isWallSliding(hero, wallHooks(hero, wall, ['ArrowRight']))) return false;
    if (!M.isWallSliding(hero, wallHooks(hero, wall, ['KeyD']))) return false;
    // No press, or the press away from the wall: no slide.
    if (M.isWallSliding(hero, wallHooks(hero, wall, []))) return false;
    if (M.isWallSliding(hero, wallHooks(hero, wall, ['ArrowLeft']))) return false;
    // Rising, not falling: no slide.
    const rising = heroAt(100, 100);
    rising.movement = { wallSlideMaxFall: 60 };
    rising.velY = -5;
    if (M.isWallSliding(rising, wallHooks(rising, wall, ['ArrowRight']))) return false;
    // No slide configured: no slide.
    const plain = heroAt(100, 100);
    plain.velY = 5;
    if (M.isWallSliding(plain, wallHooks(plain, wall, ['ArrowRight']))) return false;
    // Standing on the floor next to the wall: no slide.
    const grounded = heroAt(100, 360);
    grounded.movement = { wallSlideMaxFall: 60 };
    grounded.velY = 5;
    const h = wallHooks(grounded, wall);
    h.objects = [grounded, wall, floorAt(400)];
    h.keys = new Set(['ArrowRight']);
    if (M.isWallSliding(grounded, h)) return false;
    // No wall at all: no slide.
    if (M.isWallSliding(hero, wallHooks(hero, wallAt(400, 0), ['ArrowRight']))) return false;
    return true;
  })());
check('tryWallJump pushes off the wall, costs one air jump, and remembers the wall',
  (() => {
    const st = M.createMovementState();
    const hero = heroAt(100, 100);
    hero.movement = { maxJumps: 2, wallSlideMaxFall: 60, wallJumpSpeed: 12, wallJumpPush: 8 };
    hero.velY = 5;
    const wall = wallAt(140, 0);
    const h = wallHooks(hero, wall, ['ArrowRight']);
    if (M.tryWallJump(st, hero, 0, h) !== 'wall') return false;
    if (hero.velY !== -12 || hero.velX !== -8) return false;
    if (M.jumpsLeft(st, hero) !== 1) return false;
    const rec = M.recordOf(st, hero, false);
    if (!rec || rec.lastWallSide !== 'right') return false;
    // The same wall again: refused.
    hero.velY = 5; hero.velX = 0;
    if (M.tryWallJump(st, hero, 0.1, h) !== null) return false;
    if (hero.velY !== 5) return false; // nothing changed
    // The other wall: allowed (one wall jump per wall).
    const left = wallAt(60, 0);
    const hLeft = wallHooks(hero, left, ['ArrowLeft']);
    if (M.tryWallJump(st, hero, 0.2, hLeft) !== 'wall') return false;
    if (hero.velY !== -12 || hero.velX !== 8) return false;
    return M.jumpsLeft(st, hero) === 0;
  })());
check('tryWallJump stays quiet with no config, no jumps left, or no state',
  (() => {
    const st = M.createMovementState();
    const hero = heroAt(100, 100);
    hero.movement = { maxJumps: 2, wallSlideMaxFall: 60, wallJumpSpeed: 0, wallJumpPush: 8 };
    hero.velY = 5;
    const h = wallHooks(hero, wallAt(140, 0), ['ArrowRight']);
    if (M.tryWallJump(st, hero, 0, h) !== null) return false; // wall jump speed 0
    hero.movement.wallJumpSpeed = 12;
    hero.movement.maxJumps = 1;
    const st2 = M.createMovementState();
    const h2 = wallHooks(hero, wallAt(140, 0), ['ArrowRight']);
    // Spend the one jump as an air jump first — away from any wall,
    // so the wall branch cannot fire instead.
    if (M.tryJump(st2, hero, 12, 0, hooksFor(hero, floorAt(400))) !== 'air') return false;
    // Now the wall jump has no jump left to spend.
    hero.velY = 5;
    if (M.tryWallJump(st2, hero, 0.1, h2) !== null) return false;
    if (M.tryWallJump(null, hero, 0, h) !== null) return false;
    if (M.tryWallJump(st, null, 0, h) !== null) return false;
    return true;
  })());
check('tryJump wall-jumps while touching a wall instead of air-jumping',
  (() => {
    const st = M.createMovementState();
    const hero = heroAt(100, 100);
    hero.movement = { maxJumps: 2, wallSlideMaxFall: 60, wallJumpSpeed: 12, wallJumpPush: 8 };
    hero.velY = 5;
    const h = wallHooks(hero, wallAt(140, 0), ['ArrowRight']);
    if (M.tryJump(st, hero, 12, 0, h) !== 'wall') return false;
    if (hero.velY !== -12 || hero.velX !== -8) return false;
    if (M.jumpsLeft(st, hero) !== 1) return false;
    // Same wall again: the wall branch refuses, the air jump fires
    // instead (one jump left, straight up, no push).
    hero.velY = 5; hero.velX = 0;
    if (M.tryJump(st, hero, 12, 0.1, h) !== 'air') return false;
    if (hero.velY !== -12 || hero.velX !== 0) return false;
    return M.jumpsLeft(st, hero) === 0;
  })());
check('landing clears the wall-jump memory, so the same wall works again',
  (() => {
    const st = M.createMovementState();
    const hero = heroAt(100, 100);
    hero.movement = { maxJumps: 2, wallSlideMaxFall: 60, wallJumpSpeed: 12, wallJumpPush: 8 };
    const wall = wallAt(140, 0);
    const floor = floorAt(400);
    const h = wallHooks(hero, wall, ['ArrowRight']);
    h.objects = [hero, wall, floor];
    hero.velY = 5;
    if (M.tryJump(st, hero, 12, 0, h) !== 'wall') return false;
    if (M.tryWallJump(st, hero, 0.1, h) !== null) return false; // same wall, still refused
    // Land on the floor next to the wall: the memory clears.
    hero.posY = 360; hero.velY = 0;
    M.updateMovement(st, [hero, wall, floor], 0.2, 1 / 60, h);
    const rec = M.recordOf(st, hero, false);
    if (!rec || rec.lastWallSide !== null) return false;
    // Back in the air against the same wall: the wall jump works.
    hero.posY = 100; hero.velY = 5;
    return M.tryWallJump(st, hero, 0.3, h) === 'wall';
  })());

// --- jumps ---
check('tryJump on the ground sets the upward speed and spends one jump',
  (() => {
    const st = M.createMovementState();
    const hero = heroAt(100, 360); hero.movement = { maxJumps: 2, coyoteSeconds: 0, bufferSeconds: 0 };
    const h = hooksFor(hero, floorAt(400));
    const r = M.tryJump(st, hero, 12, 0, h);
    return r === 'ground' && hero.velY === -12 && M.jumpsLeft(st, hero) === 1;
  })());
check('tryJump spends air jumps up to Max jumps, then buffers the press',
  (() => {
    const st = M.createMovementState();
    const hero = heroAt(100, 200); hero.movement = { maxJumps: 2, coyoteSeconds: 0, bufferSeconds: 0 };
    const h = hooksFor(hero, floorAt(400)); // airborne
    if (M.tryJump(st, hero, 12, 0, h) !== 'air') return false;
    if (hero.velY !== -12 || M.jumpsLeft(st, hero) !== 1) return false;
    if (M.tryJump(st, hero, 12, 0.1, h) !== 'air') return false;
    if (M.jumpsLeft(st, hero) !== 0) return false;
    hero.velY = 0;
    if (M.tryJump(st, hero, 12, 0.2, h) !== 'buffered') return false;
    if (hero.velY !== 0) return false; // buffered: no velocity yet
    const rec = M.recordOf(st, hero, false);
    return rec && rec.bufferedAt === 0.2 && rec.bufferedJumpSpeed === 12;
  })());
check('tryJump grants the coyote jump just after walking off a ledge, then the air jump',
  (() => {
    const st = M.createMovementState();
    const hero = heroAt(100, 360); hero.movement = { maxJumps: 2, coyoteSeconds: 0.1, bufferSeconds: 0 };
    const h = hooksFor(hero, floorAt(400));
    // Stand on the floor for a frame so the record knows when it was
    // last grounded — then walk off without jumping.
    M.updateMovement(st, [hero, floorAt(400)], 0, 1 / 60, h);
    hero.posY = 340; // walked off the ledge, airborne now, no jump taken
    if (M.tryJump(st, hero, 12, 0.05, h) !== 'coyote') return false;
    if (hero.velY !== -12 || M.jumpsLeft(st, hero) !== 1) return false;
    if (M.tryJump(st, hero, 12, 0.2, h) !== 'air') return false;
    return M.jumpsLeft(st, hero) === 0;
  })());
check('tryJump does not grant a coyote refresh after a jump is already spent (no triple jump)',
  (() => {
    const st = M.createMovementState();
    const hero = heroAt(100, 360); hero.movement = { maxJumps: 2, coyoteSeconds: 0.1, bufferSeconds: 0 };
    const h = hooksFor(hero, floorAt(400));
    if (M.tryJump(st, hero, 12, 0, h) !== 'ground') return false;
    hero.posY = 340; // still rising off the jump, inside the coyote window
    // The second press is the air jump, not a coyote refresh: ground
    // + coyote + air would be three boosts on two jumps.
    if (M.tryJump(st, hero, 12, 0.05, h) !== 'air') return false;
    return M.jumpsLeft(st, hero) === 0;
  })());
check('tryJump past the coyote window is an air jump, not a coyote jump',
  (() => {
    const st = M.createMovementState();
    const hero = heroAt(100, 360); hero.movement = { maxJumps: 2, coyoteSeconds: 0.1, bufferSeconds: 0 };
    const h = hooksFor(hero, floorAt(400));
    if (M.tryJump(st, hero, 12, 0, h) !== 'ground') return false;
    hero.posY = 340;
    return M.tryJump(st, hero, 12, 0.2, h) === 'air';
  })());
check('tryJump stays quiet with no state or no object',
  M.tryJump(null, heroAt(0, 0), 12, 0, hooksFor(heroAt(0, 0), null)) === null &&
  M.tryJump(M.createMovementState(), null, 12, 0, {}) === null);
check('jumpsLeft reads the full count with no state and clamps at 0',
  M.jumpsLeft(null, { movement: { maxJumps: 2 } }) === 2 &&
  M.jumpsLeft(null, null) === 1 &&
  (() => {
    const st = M.createMovementState();
    const hero = heroAt(100, 200); hero.movement = { maxJumps: 1, coyoteSeconds: 0, bufferSeconds: 0 };
    const h = hooksFor(hero, floorAt(400));
    M.tryJump(st, hero, 12, 0, h);
    return M.jumpsLeft(st, hero) === 0;
  })());

// --- dash ---
check('startDash starts the burst, zeroes velocity, and reports dashing',
  (() => {
    const st = M.createMovementState();
    const hero = heroAt(100, 360); hero.velX = 5; hero.velY = 3;
    if (!M.startDash(st, hero, 1, 0, 400, 0.15, 0.5, 0)) return false;
    if (hero.velX !== 0 || hero.velY !== 0) return false;
    if (!M.isDashing(st, hero, 0.1)) return false;
    if (M.isDashing(st, hero, 0.2)) return false;
    return M.canDash(st, hero, 0.1) === false && M.canDash(st, hero, 0.7) === true;
  })());
check('startDash refuses a second dash while dashing or cooling down',
  (() => {
    const st = M.createMovementState();
    const hero = heroAt(100, 360);
    if (!M.startDash(st, hero, 1, 0, 400, 0.15, 0.5, 0)) return false;
    if (M.startDash(st, hero, 1, 0, 400, 0.15, 0.5, 0.1)) return false;
    if (M.startDash(st, hero, 1, 0, 400, 0.15, 0.5, 0.3)) return false;
    return M.startDash(st, hero, -1, 0, 400, 0.15, 0.5, 0.7) === true;
  })());
check('startDash refuses an empty burst and defaults a missing direction to right',
  (() => {
    const st = M.createMovementState();
    const hero = heroAt(100, 360);
    if (M.startDash(st, hero, 1, 0, 0, 0.15, 0.5, 0)) return false;
    if (M.startDash(st, hero, 1, 0, 400, 0, 0.5, 0)) return false;
    if (!M.startDash(st, hero, 0, 0, 400, 0.15, 0.5, 0)) return false;
    const rec = M.recordOf(st, hero, false);
    return rec && rec.dashDirX === 1 && rec.dashDirY === 0;
  })());
check('startDash stays quiet with no state or no object',
  M.startDash(null, heroAt(0, 0), 1, 0, 400, 0.15, 0.5, 0) === false &&
  M.startDash(M.createMovementState(), null, 1, 0, 400, 0.15, 0.5, 0) === false &&
  M.isDashing(null, heroAt(0, 0), 0) === false &&
  M.canDash(null, heroAt(0, 0), 0) === true);

// --- per-frame update ---
check('updateMovement steps a dash at the exact speed and ends it on time',
  (() => {
    const st = M.createMovementState();
    const hero = heroAt(100, 360);
    const h = hooksFor(hero, floorAt(400));
    M.startDash(st, hero, 1, 0, 400, 0.15, 0.5, 0);
    for (let f = 1; f <= 9; f++) {
      if (!M.updateMovement(st, [hero, floorAt(400)], f / 100, 1 / 60, h)) return false;
    }
    if (Math.abs(hero.posX - 160) > 1e-9) return false; // 9 frames * 400/60 = 60px
    if (hero.velX !== 0 || hero.velY !== 0) return false;
    M.updateMovement(st, [hero, floorAt(400)], 0.16, 1 / 60, h);
    if (Math.abs(hero.posX - 160) > 1e-9) return false; // ended: no more movement
    return M.isDashing(st, hero, 0.16) === false;
  })());
check('updateMovement refills jumps on landing and fires a buffered press',
  (() => {
    const st = M.createMovementState();
    const hero = heroAt(100, 200); hero.movement = { maxJumps: 1, coyoteSeconds: 0, bufferSeconds: 0.1 };
    const floor = floorAt(400);
    const h = hooksFor(hero, floor);
    M.tryJump(st, hero, 12, 0, h); // the one air jump
    if (M.jumpsLeft(st, hero) !== 0) return false;
    if (M.tryJump(st, hero, 12, 0.1, h) !== 'buffered') return false;
    hero.posY = 360; // landed on the floor
    hero.velY = 0;
    M.updateMovement(st, [hero, floor], 0.15, 1 / 60, h);
    return hero.velY === -12 && M.jumpsLeft(st, hero) === 0; // buffered jump fired, one jump spent again
  })());
check('updateMovement does not refill while the hero is still rising inside the grounded tolerance',
  (() => {
    const st = M.createMovementState();
    const hero = heroAt(100, 360); hero.movement = { maxJumps: 2, coyoteSeconds: 0, bufferSeconds: 0 };
    const floor = floorAt(400);
    const h = hooksFor(hero, floor);
    if (M.tryJump(st, hero, 12, 0, h) !== 'ground') return false;
    if (M.jumpsLeft(st, hero) !== 1) return false;
    // Still at the floor line but rising: inside the tolerance (which
    // grows with |velY|), yet the jump must NOT be refunded.
    hero.velY = -10;
    M.updateMovement(st, [hero, floor], 0.05, 1 / 60, h);
    if (M.jumpsLeft(st, hero) !== 1) return false;
    // Falling back onto the floor refills for real.
    hero.velY = 5;
    M.updateMovement(st, [hero, floor], 0.1, 1 / 60, h);
    return M.jumpsLeft(st, hero) === 2;
  })());
check('updateMovement lets a stale buffer expire without jumping',
  (() => {
    const st = M.createMovementState();
    const hero = heroAt(100, 200); hero.movement = { maxJumps: 1, coyoteSeconds: 0, bufferSeconds: 0.1 };
    const floor = floorAt(400);
    const h = hooksFor(hero, floor);
    M.tryJump(st, hero, 12, 0, h);
    M.tryJump(st, hero, 12, 0.1, h); // buffered at 0.1
    hero.posY = 360; hero.velY = 0;
    M.updateMovement(st, [hero, floor], 0.3, 1 / 60, h); // 0.2s later: past the 0.1s window
    return hero.velY === 0 && M.jumpsLeft(st, hero) === 1; // landed, refilled, no jump fired
  })());
check('updateMovement drops records for objects that left the scene',
  (() => {
    const st = M.createMovementState();
    const hero = heroAt(100, 360);
    const floor = floorAt(400);
    const h = hooksFor(hero, floor);
    M.tryJump(st, hero, 12, 0, h);
    if (!M.recordOf(st, hero, false)) return false;
    M.updateMovement(st, [floor], 0.1, 1 / 60, h);
    return M.recordOf(st, hero, false) === null;
  })());
check('updateMovement stays quiet with no state',
  M.updateMovement(null, [], 0, 1 / 60, {}) === false &&
  M.updateMovement('nope', [], 0, 1 / 60, {}) === false);

// --- wall slide in the frame phase (batch 28) ---
check('updateMovement caps the fall while sliding, even with no record yet',
  (() => {
    const st = M.createMovementState();
    const hero = heroAt(100, 100);
    hero.movement = { wallSlideMaxFall: 60, wallJumpSpeed: 12, wallJumpPush: 8 };
    hero.velY = 5; // falling fast beside the wall
    const wall = wallAt(140, 0);
    const h = wallHooks(hero, wall, ['ArrowRight']);
    // A hero dropped into a shaft at scene start has no record yet
    // (it never jumped or landed) — the slide is a live read, so it
    // still caps on the first frame.
    if (M.recordOf(st, hero, false) !== null) return false;
    M.updateMovement(st, [hero, wall], 0, 1 / 60, h);
    return hero.velY === 1; // 60 px/s is 1 px per 60fps frame
  })());
check('updateMovement holds the slide speed across frames while the press holds',
  (() => {
    const st = M.createMovementState();
    const hero = heroAt(100, 100);
    hero.movement = { wallSlideMaxFall: 60 };
    const wall = wallAt(140, 0);
    const h = wallHooks(hero, wall, ['ArrowRight']);
    for (let f = 0; f < 5; f++) {
      hero.velY = 5; // gravity re-adds each frame, the cap re-applies
      hero.posY += hero.velY;
      M.updateMovement(st, [hero, wall], f / 60, 1 / 60, h);
      if (hero.velY !== 1) return false;
    }
    return true;
  })());
check('updateMovement does not cap the fall without the press, away from the wall, or unconfigured',
  (() => {
    const wall = wallAt(140, 0);
    // No press held.
    const st1 = M.createMovementState();
    const h1 = heroAt(100, 100); h1.movement = { wallSlideMaxFall: 60 }; h1.velY = 5;
    M.updateMovement(st1, [h1, wall], 0, 1 / 60, wallHooks(h1, wall, []));
    if (h1.velY !== 5) return false;
    // Pressing away from the wall.
    const st2 = M.createMovementState();
    const h2 = heroAt(100, 100); h2.movement = { wallSlideMaxFall: 60 }; h2.velY = 5;
    M.updateMovement(st2, [h2, wall], 0, 1 / 60, wallHooks(h2, wall, ['ArrowLeft']));
    if (h2.velY !== 5) return false;
    // No slide configured.
    const st3 = M.createMovementState();
    const h3 = heroAt(100, 100); h3.velY = 5;
    M.updateMovement(st3, [h3, wall], 0, 1 / 60, wallHooks(h3, wall, ['ArrowRight']));
    if (h3.velY !== 5) return false;
    // No wall touched.
    const st4 = M.createMovementState();
    const h4 = heroAt(100, 100); h4.movement = { wallSlideMaxFall: 60 }; h4.velY = 5;
    const far = wallAt(400, 0);
    M.updateMovement(st4, [h4, far], 0, 1 / 60, wallHooks(h4, far, ['ArrowRight']));
    if (h4.velY !== 5) return false;
    // Rising beside the wall: no cap.
    const st5 = M.createMovementState();
    const h5 = heroAt(100, 100); h5.movement = { wallSlideMaxFall: 60 }; h5.velY = -5;
    M.updateMovement(st5, [h5, wall], 0, 1 / 60, wallHooks(h5, wall, ['ArrowRight']));
    if (h5.velY !== -5) return false;
    // Standing on the floor beside the wall: no cap.
    const st6 = M.createMovementState();
    const h6 = heroAt(100, 360); h6.movement = { wallSlideMaxFall: 60 }; h6.velY = 5;
    const floor = floorAt(400);
    const h6hooks = wallHooks(h6, wall, ['ArrowRight']);
    h6hooks.objects = [h6, wall, floor];
    M.updateMovement(st6, [h6, wall, floor], 0, 1 / 60, h6hooks);
    if (h6.velY !== 5) return false;
    // A faster cap (120 px/s) caps at 2 px per frame.
    const st7 = M.createMovementState();
    const h7 = heroAt(100, 100); h7.movement = { wallSlideMaxFall: 120 }; h7.velY = 5;
    M.updateMovement(st7, [h7, wall], 0, 1 / 60, wallHooks(h7, wall, ['ArrowRight']));
    return h7.velY === 2;
  })());

// --- config writes ---
check('setMaxJumps / setCoyoteTime / setJumpBuffer write the authored config',
  (() => {
    const hero = heroAt(0, 0);
    if (M.setMaxJumps(hero, 3) !== 3) return false;
    if (M.setCoyoteTime(hero, 0.2) !== 0.2) return false;
    if (M.setJumpBuffer(hero, 0.15) !== 0.15) return false;
    if (hero.movement.maxJumps !== 3 || hero.movement.coyoteSeconds !== 0.2 || hero.movement.bufferSeconds !== 0.15) return false;
    if (M.setMaxJumps(hero, 99) !== 10) return false;
    if (M.setCoyoteTime(hero, 'oops') !== 0) return false;
    return M.setMaxJumps(null, 2) === null && M.setCoyoteTime(null, 0.1) === null && M.setJumpBuffer(null, 0.1) === null;
  })());
check('setWallSlide / setWallJump write the authored wall config',
  (() => {
    const hero = heroAt(0, 0);
    if (M.setWallSlide(hero, 60) !== 60) return false;
    const pair = M.setWallJump(hero, 12, 8);
    if (!pair || pair.wallJumpSpeed !== 12 || pair.wallJumpPush !== 8) return false;
    if (hero.movement.wallSlideMaxFall !== 60 || hero.movement.wallJumpSpeed !== 12 || hero.movement.wallJumpPush !== 8) return false;
    if (M.setWallSlide(hero, 0) !== 0) return false; // 0 turns the slide off
    if (M.setWallSlide(hero, 9000) !== 2000) return false;
    if (M.setWallSlide(hero, 'oops') !== 0) return false;
    if (M.setWallJump(hero, 500, 'oops').wallJumpSpeed !== 100) return false;
    if (M.setWallJump(hero, 12, 'oops').wallJumpPush !== 8) return false;
    return M.setWallSlide(null, 60) === null && M.setWallJump(null, 12, 8) === null;
  })());

// --- routing ---
check('routing sets cover the seven actions and three conditions',
  M.isMovementAction('jump') && M.isMovementAction('dash') &&
  M.isMovementAction('setMaxJumps') && M.isMovementAction('setCoyoteTime') &&
  M.isMovementAction('setJumpBuffer') &&
  M.isMovementAction('setWallSlide') && M.isMovementAction('setWallJump') &&
  !M.isMovementAction('jumpsLeft') && !M.isMovementAction('isDashing') &&
  !M.isMovementAction('wallSliding') &&
  !M.isMovementAction('setLives') && !M.isMovementAction(null) &&
  M.isMovementCondition('jumpsLeft') && M.isMovementCondition('isDashing') &&
  M.isMovementCondition('wallSliding') &&
  !M.isMovementCondition('jump') && !M.isMovementCondition(null));

// --- static wiring ---
{
  const html = fs.readFileSync(path.join(HYDRA, 'index.html'), 'utf8');
  const mvTag = html.indexOf('src="hydra-movement.js');
  check('index.html loads hydra-movement.js before player-runtime.js and script.js',
    mvTag !== -1 && mvTag < html.indexOf('src="player-runtime.js') && mvTag < html.indexOf('src="script.js'));
  check('index.html loads hydra-movement.js after hydra-lives.js',
    mvTag > html.indexOf('src="hydra-lives.js'));
  const playerJs = fs.readFileSync(path.join(HYDRA, 'player-runtime.js'), 'utf8');
  check('player-runtime.js hard-guards on HydraMovement',
    playerJs.includes("if (!HydraMovement || typeof HydraMovement.createMovementState !== 'function')") &&
    playerJs.includes('HydraScript player runtime requires hydra-movement.js'));
  check('player-runtime.js inlines HydraMovement into exports',
    playerJs.includes("'HydraMovement', global.HydraMovement && global.HydraMovement.factorySource"));
  check('player-runtime.js classifies movement blocks for the dispatch',
    playerJs.includes('HydraMovement.isMovementCondition(type)') &&
    playerJs.includes('HydraMovement.isMovementAction(type)'));
  check('player-runtime.js exposes the module to both contexts and runs the frame phase',
    playerJs.includes('movementModule: HydraMovement') &&
    playerJs.includes('movement: state.movement') &&
    playerJs.includes('updateMovement: () => {') &&
    playerJs.includes('HydraMovement.updateMovement(state.movement, live,'));
  check('player-runtime.js mints fresh movement state per scene load',
    playerJs.includes('createMovementState: () => HydraMovement.createMovementState()'));
  const frameJs = fs.readFileSync(path.join(HYDRA, 'hydra-frame.js'), 'utf8');
  check('frame module runs updateMovement last in the world sim',
    frameJs.includes("'updatePaths', 'updateSpawners', 'updatePlatforms', 'updateMovement',") &&
    frameJs.includes("call('updateMovement', host.updateMovement);"));
  const resetJs = fs.readFileSync(path.join(HYDRA, 'hydra-scenereset.js'), 'utf8');
  check('scene reset mints fresh movement state per scene load',
    resetJs.includes("typeof h.createMovementState === 'function'") &&
    resetJs.includes('state.movement = movementSt;'));
  const previewJs = fs.readFileSync(path.join(HYDRA, 'hydra-previewruntime.js'), 'utf8');
  check('preview runtime exposes the module to both contexts',
    (previewJs.match(/movementModule: mod\('Movement'\)/g) || []).length === 2 &&
    previewJs.includes('movement: run ? run.movement : null') &&
    previewJs.includes("ensureMovementState: function () { return hostCall('ensurePreviewMovementState', [], null); }"));
  check('preview runtime runs the movement frame phase and mints state per scene',
    previewJs.includes('updateMovement: function () {') &&
    previewJs.includes('MV.updateMovement(r.movement, objs, nowSec, dt / 60,') &&
    previewJs.includes('createMovementState: function () {') &&
    previewJs.includes("mod('Movement')"));
  const scriptJs = fs.readFileSync(path.join(HYDRA, 'script.js'), 'utf8');
  check('editor hands the movement-state maker to the preview runtime host',
    scriptJs.includes('function ensurePreviewMovementState()') &&
    scriptJs.includes('ensurePreviewMovementState, ensurePreviewPlatformState, ensurePreviewCombatState, getPreviewBuses'));
  check('editor Inspector carries the Movement section',
    scriptJs.includes('function appendMovementEditor(root, obj)') &&
    scriptJs.includes("title.textContent = 'Movement'") &&
    scriptJs.includes('appendMovementEditor(root, obj)') &&
    scriptJs.includes("makePropGroup('Max jumps:'") &&
    scriptJs.includes("makePropGroup('Coyote time (s):'") &&
    scriptJs.includes("makePropGroup('Jump buffer (s):'") &&
    scriptJs.includes("makePropGroup('Wall slide max fall (px/s):'") &&
    scriptJs.includes("makePropGroup('Wall jump speed:'") &&
    scriptJs.includes("makePropGroup('Wall jump push:'"));
  const executeJs = fs.readFileSync(path.join(HYDRA, 'hydra-execute.js'), 'utf8');
  check('shared execute module runs the seven movement actions',
    executeJs.includes("if (isType(ctx.movementModule, 'isMovementAction', type))") &&
    executeJs.includes("type === 'jump'") &&
    executeJs.includes("type === 'dash'") &&
    executeJs.includes("type === 'setMaxJumps'") &&
    executeJs.includes("type === 'setCoyoteTime'") &&
    executeJs.includes("type === 'setJumpBuffer'") &&
    executeJs.includes("type === 'setWallSlide'") &&
    executeJs.includes("type === 'setWallJump'") &&
    executeJs.includes('MV.tryJump(mvState, o, jsv.value, mvNow, jHooks)') &&
    executeJs.includes('MV.startDash(mvState, o, dir.x, dir.y, dsv.value + growthBonusOf(ctx, \'speed\', o), ddv.value, dcv.value, mvNow)') &&
    executeJs.includes('MV.setMaxJumps(o, mjv.value)') &&
    executeJs.includes('MV.setCoyoteTime(o, ctv.value)') &&
    executeJs.includes('MV.setJumpBuffer(o, jbv.value)') &&
    executeJs.includes('MV.setWallSlide(o, wsv.value)') &&
    executeJs.includes('MV.setWallJump(o, wjv.value, wpv.value)') &&
    executeJs.includes('keys: ctx.keys || null'));
  const conditionsJs = fs.readFileSync(path.join(HYDRA, 'hydra-conditions.js'), 'utf8');
  check('shared conditions module reads Jumps Left, Is Dashing, and Wall Sliding',
    conditionsJs.includes("case 'jumpsLeft':") &&
    conditionsJs.includes("case 'isDashing':") &&
    conditionsJs.includes("case 'wallSliding':") &&
    conditionsJs.includes('MVm.jumpsLeft(ctx.movement, o)') &&
    conditionsJs.includes('MVm2.isDashing(ctx.movement, o, idNow)') &&
    conditionsJs.includes('MVm3.isWallSliding(o, movementHooks(ctx))') &&
    conditionsJs.includes('rawWallSliding(ctx, o)'));
  check('shared conditions module does not freeze the movement reads while paused',
    !conditionsJs.split('FROZEN_WHILE_PAUSED = [')[1].split('];')[0].includes("'jumpsLeft'") &&
    !conditionsJs.split('FROZEN_WHILE_PAUSED = [')[1].split('];')[0].includes('isDashing') &&
    !conditionsJs.split('FROZEN_WHILE_PAUSED = [')[1].split('];')[0].includes('wallSliding'));
  const flowSb = {};
  flowSb.window = flowSb;
  vm.createContext(flowSb);
  vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-flow.js'), 'utf8'),
    flowSb, { filename: 'hydra-flow.js' });
  const F = flowSb.HydraFlow;
  check('flow module reads Jumps Left, Is Dashing, and Wall Sliding as level triggers',
    F.defaultTriggerMode('jumpsLeft') === 'level' &&
    F.defaultTriggerMode('isDashing') === 'level' &&
    F.defaultTriggerMode('wallSliding') === 'level');
  const resetSb = {};
  resetSb.window = resetSb;
  vm.createContext(resetSb);
  vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-scenereset.js'), 'utf8'),
    resetSb, { filename: 'hydra-scenereset.js' });
  const SR = resetSb.HydraSceneReset;
  check('scene reset mints a fresh movement state (a dash never leaks into the next scene)',
    (() => {
      const mv = { records: { 1: { jumpsUsed: 1 } } };
      const state = { movement: mv };
      const ok = SR.resetSceneRuntime(state, { id: 1 }, {
        createMovementState: () => ({ records: {} })
      });
      return ok === true && state.movement !== mv && JSON.stringify(state.movement) === JSON.stringify({ records: {} });
    })() &&
    (() => {
      const state = {};
      const ok = SR.resetSceneRuntime(state, { id: 2 }, {});
      return ok === true && state.movement === null;
    })());
  const catalogJs = fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8');
  check('catalog carries the ten movement blocks in the Movement category',
    catalogJs.includes("category: 'Movement'") &&
    catalogJs.includes("blockType: 'jump'") &&
    catalogJs.includes("runtimeType: 'jump'") &&
    catalogJs.includes("blockType: 'dash'") &&
    catalogJs.includes("runtimeType: 'dash'") &&
    catalogJs.includes("blockType: 'set-max-jumps'") &&
    catalogJs.includes("runtimeType: 'setMaxJumps'") &&
    catalogJs.includes("blockType: 'set-coyote-time'") &&
    catalogJs.includes("runtimeType: 'setCoyoteTime'") &&
    catalogJs.includes("blockType: 'set-jump-buffer'") &&
    catalogJs.includes("runtimeType: 'setJumpBuffer'") &&
    catalogJs.includes("blockType: 'set-wall-slide'") &&
    catalogJs.includes("runtimeType: 'setWallSlide'") &&
    catalogJs.includes("blockType: 'set-wall-jump'") &&
    catalogJs.includes("runtimeType: 'setWallJump'") &&
    catalogJs.includes("blockType: 'wall-sliding'") &&
    catalogJs.includes("runtimeType: 'wallSliding'") &&
    catalogJs.includes("blockType: 'jumps-left'") &&
    catalogJs.includes("runtimeType: 'jumpsLeft'") &&
    catalogJs.includes("blockType: 'is-dashing'") &&
    catalogJs.includes("runtimeType: 'isDashing'") &&
    catalogJs.includes("key: 'jumpSpeed', label: 'Jump speed'") &&
    catalogJs.includes("key: 'direction', label: 'Direction'") &&
    catalogJs.includes("key: 'jumps', label: 'Jumps'") &&
    catalogJs.includes("key: 'maxFall', label: 'Max fall speed (px/s)'") &&
    catalogJs.includes("key: 'push', label: 'Push away'"));
  const refMd = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');
  check('block reference documents all ten movement blocks',
    refMd.includes('Jump') && refMd.includes('Dash') &&
    refMd.includes('Set Max Jumps') && refMd.includes('Set Coyote Time') &&
    refMd.includes('Set Jump Buffer') && refMd.includes('Jumps Left') &&
    refMd.includes('Is Dashing') && refMd.includes('Set Wall Slide') &&
    refMd.includes('Set Wall Jump') && refMd.includes('Wall Sliding') &&
    refMd.includes('### Movement (10)'));
  const guideMd = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');
  check('user guide covers movement abilities and wall slide / wall jump',
    guideMd.includes('Movement abilities') && guideMd.includes('double jump') &&
    guideMd.includes('Dash') && guideMd.includes('Wall slide') &&
    guideMd.includes('Wall jump'));
}

process.exit(failures === 0 ? 0 : 1);
