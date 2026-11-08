// Unit tests for hydra/hydra-ai.js — the shared simple AI behaviors
// (P4 Advanced batch 19: patrol / chase / flee / wander, beginner edition).
//
// Pure logic: behavior normalization (patrol/chase/flee/wander/none),
// range + speed normalization, the per-object behavior record, the
// center-to-center range read, flee-point and wander-point picking
// over the pathfinder's walk grid, and the per-frame brain (updateAI)
// that plans each driven object's next walk through HydraPathfind.
// Nothing here touches the DOM; both runtimes delegate to this module.
// Static checks at the end pin the wiring: catalog blocks, both
// runtimes' dispatch and frame phase, the frame module's phase order,
// and the docs.

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
sandbox.window = sandbox; // hydra-ai.js + hydra-pathfind.js assign to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-tiles.js'), 'utf8'),
  sandbox, { filename: 'hydra-tiles.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-pathfind.js'), 'utf8'),
  sandbox, { filename: 'hydra-pathfind.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-ai.js'), 'utf8'),
  sandbox, { filename: 'hydra-ai.js' });
const PF = sandbox.HydraPathfind;
const Tiles = sandbox.HydraTiles;
const AI = sandbox.HydraAi;

check('HydraAi exposed with helpers',
  !!AI && typeof AI.normalizeSpeed === 'function' &&
  typeof AI.normalizeRange === 'function' &&
  typeof AI.normalizeBehavior === 'function' &&
  typeof AI.objectCenter === 'function' &&
  typeof AI.behaviorOf === 'function' &&
  typeof AI.setBehavior === 'function' &&
  typeof AI.stopBehavior === 'function' &&
  typeof AI.targetInRange === 'function' &&
  typeof AI.fleePoint === 'function' &&
  typeof AI.wanderPoint === 'function' &&
  typeof AI.updateAI === 'function' &&
  typeof AI.isAiAction === 'function' &&
  typeof AI.isAiCondition === 'function');
check('factorySource is a self-contained function string',
  typeof AI.factorySource === 'string' && AI.factorySource.includes('hydraAiFactory'));
check('constants are 100 default speed, 1..2000 range, 300 default range, 0..5000 range, 0.5s repath',
  AI.DEFAULT_SPEED === 100 && AI.MIN_SPEED === 1 && AI.MAX_SPEED === 2000 &&
  AI.DEFAULT_RANGE === 300 && AI.MIN_RANGE === 0 && AI.MAX_RANGE === 5000 &&
  AI.REPATH_SECONDS === 0.5 && AI.WANDER_TRIES === 8 &&
  AI.IDLE_MIN === 0.5 && AI.IDLE_MAX === 1.5);
check('BEHAVIORS names the five behaviors',
  JSON.stringify(AI.BEHAVIORS) === '["none","patrol","chase","flee","wander"]');

// --- speed + range normalization ---
{
  check('normalizeSpeed keeps 1, 100, and 2000, clamps past the range',
    AI.normalizeSpeed(1) === 1 && AI.normalizeSpeed(100) === 100 &&
    AI.normalizeSpeed(2000) === 2000 &&
    AI.normalizeSpeed(0) === 1 && AI.normalizeSpeed(5000) === 2000);
  check('normalizeSpeed reads non-numeric as 100 (a typo walks at the default speed)',
    AI.normalizeSpeed('fast') === 100 && AI.normalizeSpeed(NaN) === 100 &&
    AI.normalizeSpeed(undefined) === 100 && AI.normalizeSpeed(null) === 100 &&
    AI.normalizeSpeed('') === 100);
  check('normalizeRange keeps 0, 300, and 5000, clamps past the range',
    AI.normalizeRange(0) === 0 && AI.normalizeRange(300) === 300 &&
    AI.normalizeRange(5000) === 5000 &&
    AI.normalizeRange(-10) === 0 && AI.normalizeRange(99999) === 5000);
  check('normalizeRange reads non-numeric as 300',
    AI.normalizeRange('far') === 300 && AI.normalizeRange(NaN) === 300 &&
    AI.normalizeRange(undefined) === 300 && AI.normalizeRange(null) === 300 &&
    AI.normalizeRange('') === 300);
}

// --- behavior normalization ---
{
  check('normalizeBehavior lowercases and trims',
    AI.normalizeBehavior('Patrol') === 'patrol' &&
    AI.normalizeBehavior('  CHASE ') === 'chase' &&
    AI.normalizeBehavior('Flee') === 'flee' &&
    AI.normalizeBehavior('wander') === 'wander' &&
    AI.normalizeBehavior('none') === 'none');
  check('normalizeBehavior reads unknown, blank, and hostile values as none',
    AI.normalizeBehavior('fly') === 'none' && AI.normalizeBehavior('') === 'none' &&
    AI.normalizeBehavior(null) === 'none' && AI.normalizeBehavior(undefined) === 'none' &&
    AI.normalizeBehavior(123) === 'none' && AI.normalizeBehavior({}) === 'none');
}

// --- object center ---
{
  check('objectCenter is the middle of the box',
    JSON.stringify(AI.objectCenter({ posX: 100, posY: 50, width: 40, height: 40 })) === '{"x":120,"y":70}');
  check('objectCenter reads missing fields as 0',
    JSON.stringify(AI.objectCenter(null)) === '{"x":0,"y":0}' &&
    JSON.stringify(AI.objectCenter({})) === '{"x":0,"y":0}');
}

// --- behavior record ---
{
  const guard = { name: 'guard', posX: 100, posY: 50, width: 40, height: 40 };
  check('a fresh object has no behavior',
    AI.behaviorOf(guard) === 'none' && AI.behaviorOf(null) === 'none' &&
    AI.behaviorOf({}) === 'none');
  const rec = AI.setBehavior(guard, { behavior: 'patrol', target: ' player ', speed: 200, range: 400, patrolA: 'a', patrolB: 'b' });
  check('setBehavior records the behavior with normalized fields and the home spot',
    !!rec && rec.behavior === 'patrol' && rec.target === 'player' &&
    rec.speed === 200 && rec.range === 400 && rec.patrolA === 'a' && rec.patrolB === 'b' &&
    rec.waypointIndex === 0 && rec.homeX === 120 && rec.homeY === 70 &&
    rec.repathIn === 0 && rec.idleIn === 0 && rec.waiting === false &&
    guard._ai === rec && AI.behaviorOf(guard) === 'patrol');
  check('setBehavior clamps a wild speed and range into the module ranges',
    (function () {
      const o = {};
      AI.setBehavior(o, { behavior: 'chase', speed: 5000, range: -5 });
      return o._ai.speed === 2000 && o._ai.range === 0;
    })());
  check('setBehavior reads a bad speed and range as the defaults',
    (function () {
      const o = {};
      AI.setBehavior(o, { behavior: 'flee', speed: 'fast', range: 'far' });
      return o._ai.speed === 100 && o._ai.range === 300;
    })());
  check('behaviorOf normalizes a hand-built record (mixed case)',
    AI.behaviorOf({ _ai: { behavior: 'Chase' } }) === 'chase' &&
    AI.behaviorOf({ _ai: { behavior: 'fly' } }) === 'none');
  check("setBehavior with 'none' clears the record (the same as Stop AI)",
    (function () {
      const o = { _ai: { behavior: 'patrol' } };
      const out = AI.setBehavior(o, { behavior: 'none' });
      return out === null && !o._ai && AI.behaviorOf(o) === 'none';
    })());
  check('setBehavior with an unknown behavior clears the record too',
    (function () {
      const o = { _ai: { behavior: 'patrol' } };
      AI.setBehavior(o, { behavior: 'fly' });
      return !o._ai;
    })());
  check('stopBehavior clears the record, so the behavior reads none',
    (function () {
      const o = {};
      AI.setBehavior(o, { behavior: 'wander', speed: 150, range: 200 });
      AI.stopBehavior(o);
      return !o._ai && AI.behaviorOf(o) === 'none';
    })());
  check('stopBehavior on a behaviorless or hostile object never throws',
    (function () {
      AI.stopBehavior({});
      AI.stopBehavior(null);
      AI.stopBehavior('nope');
      return true;
    })());
  check('setBehavior rejects bad input instead of recording a broken behavior',
    AI.setBehavior(null, { behavior: 'chase' }) === null &&
    AI.setBehavior('nope', { behavior: 'chase' }) === null &&
    AI.setBehavior({}, null) === null);
}

// --- target in range ---
{
  const a = { posX: 10, posY: 20, width: 40, height: 40 }; // center (30, 40)
  const b = { posX: 280, posY: 280, width: 40, height: 40 }; // center (300, 300), ~375 away
  check('targetInRange is true inside the range and false past it',
    AI.targetInRange(a, b, 400) === true && AI.targetInRange(a, b, 300) === false);
  check('targetInRange at range 0 is true only right on top of the object',
    AI.targetInRange(a, a, 0) === true && AI.targetInRange(a, b, 0) === false);
  check('targetInRange reads a bad range as the 300 default',
    (function () {
      // (30,40) to (300,300) is ~375 away: past the 300 default.
      // A close pair (~92 away) is inside it.
      const c = { posX: 80, posY: 80, width: 40, height: 40 }; // center (100, 100)
      return AI.targetInRange(a, b, 'far') === false && AI.targetInRange(a, b, null) === false &&
        AI.targetInRange(a, c, 'far') === true && AI.targetInRange(a, c, undefined) === true;
    })());
  check('targetInRange reads a missing object or target as false',
    AI.targetInRange(null, b, 500) === false && AI.targetInRange(a, null, 500) === false &&
    AI.targetInRange(a, undefined, 500) === false);
}

// --- flee + wander points ---
function mazeTilemap() {
  // 10x10, tile 0 solid, wall down column 4 rows 0..7 (gap at rows 8,9).
  const tiles = new Array(100).fill(-1);
  for (let r = 0; r < 8; r++) tiles[r * 10 + 4] = 0;
  return { kind: 'tilemap', posX: 0, posY: 0, tileSize: 32, cols: 10, rows: 10, tiles: tiles, solidTiles: [0] };
}
{
  const open = { cell: 32, cols: 25, rows: 19, blocked: new Array(25 * 19).fill(0) };
  const maze = PF.buildWalkGrid(800, 600, [mazeTilemap()], Tiles);
  check('fleePoint walks straight away from the target on open floor',
    (function () {
      const p = AI.fleePoint({ x: 300, y: 300 }, { x: 280, y: 280 }, 300, open, PF);
      return !!p && near(p.x, 300 + 300 / Math.SQRT2, 0.01) && near(p.y, 300 + 300 / Math.SQRT2, 0.01);
    })());
  check('fleePoint fans out when straight away is a wall or out of bounds',
    (function () {
      // Away is due west, out of the world; the fan reaches south first.
      const p = AI.fleePoint({ x: 100, y: 40 }, { x: 140, y: 40 }, 300, maze, PF);
      return !!p && near(p.x, 100, 1e-9) && near(p.y, 340, 1e-9);
    })());
  check('fleePoint reads a zero range as the 300 default',
    (function () {
      const p = AI.fleePoint({ x: 300, y: 300 }, { x: 280, y: 280 }, 0, open, PF);
      return !!p && near(p.x, 300 + 300 / Math.SQRT2, 0.01);
    })());
  check('fleePoint returns null when every direction is blocked or the grid is missing',
    (function () {
      const sealed = { cell: 32, cols: 3, rows: 3, blocked: new Array(9).fill(1) };
      return AI.fleePoint({ x: 48, y: 48 }, { x: 16, y: 48 }, 300, sealed, PF) === null &&
        AI.fleePoint({ x: 300, y: 300 }, { x: 280, y: 280 }, 300, null, PF) === null &&
        AI.fleePoint({ x: 300, y: 300 }, { x: 280, y: 280 }, 300, open, null) === null;
    })());
  check('wanderPoint stays within range of home on a walkable cell',
    (function () {
      for (let i = 0; i < 20; i++) {
        const p = AI.wanderPoint({ x: 300, y: 300 }, 200, maze, PF);
        if (!p) return false;
        const d = Math.hypot(p.x - 300, p.y - 300);
        if (d > 200 + 1e-9) return false;
        const c = PF.cellOf(maze, p.x, p.y);
        if (PF.isBlocked(maze, c.col, c.row)) return false;
      }
      return true;
    })());
  check('wanderPoint at range 0 returns home exactly',
    (function () {
      const p = AI.wanderPoint({ x: 300, y: 300 }, 0, open, PF);
      return !!p && p.x === 300 && p.y === 300;
    })());
  check('wanderPoint returns null when no walkable point exists or the grid is missing',
    (function () {
      const sealed = { cell: 32, cols: 3, rows: 3, blocked: new Array(9).fill(1) };
      return AI.wanderPoint({ x: 48, y: 48 }, 300, sealed, PF) === null &&
        AI.wanderPoint({ x: 300, y: 300 }, 200, null, PF) === null;
    })());
}

// --- the brain: updateAI ---
function aiWorld() {
  // The same maze as the pathfinding tests: a 320x320 tilemap with a
  // wall down column 4 rows 0..7, in an 800x600 world.
  const objects = [
    { id: 1, name: 'map', kind: 'tilemap', posX: 0, posY: 0, width: 320, height: 320, tileSize: 32, cols: 10, rows: 10, tiles: mazeTilemap().tiles, solidTiles: [0] },
    { id: 2, name: 'enemy', kind: 'sprite', posX: 10, posY: 20, width: 40, height: 40, color: '#ff0000', static: false, physicsEnabled: false },
    { id: 3, name: 'player', kind: 'sprite', posX: 280, posY: 280, width: 40, height: 40, color: '#00ff00', static: false, physicsEnabled: false },
    { id: 4, name: 'pointA', kind: 'sprite', posX: 280, posY: 20, width: 40, height: 40, color: '#0000ff', static: false, physicsEnabled: false },
    { id: 5, name: 'pointB', kind: 'sprite', posX: 280, posY: 280, width: 40, height: 40, color: '#ffff00', static: false, physicsEnabled: false }
  ];
  const host = {
    pathfind: PF,
    tiles: Tiles,
    worldSize: function () { return { width: 800, height: 600 }; },
    findObject: function (name) { return objects.find(function (o) { return o.name === name; }) || null; }
  };
  return { objects: objects, host: host };
}
function aiEnemy(world) { return world.objects.find(function (o) { return o.name === 'enemy'; }); }
function aiCenter(o) { return { x: o.posX + o.width / 2, y: o.posY + o.height / 2 }; }
// One frame of the world sim, brain first, follower second — the
// frame module's phase order.
function aiPump(world, n) {
  for (let f = 0; f < n; f++) {
    AI.updateAI(world.objects, 1 / 60, world.host);
    PF.updatePaths(world.objects, 1 / 60);
  }
}
function aiNear(a, b, eps) { return Math.abs(a - b) <= (eps || 1); }
{
  // Patrol: around the wall to A, then straight down to B.
  const world = aiWorld();
  const enemy = aiEnemy(world);
  AI.setBehavior(enemy, { behavior: 'patrol', speed: 200, range: 300, patrolA: 'pointA', patrolB: 'pointB' });
  let arrivedA = false;
  for (let f = 0; f < 400 && !arrivedA; f++) {
    aiPump(world, 1);
    arrivedA = PF.pathFinished(enemy);
  }
  check('patrol walks around the wall and arrives at point A',
    // The follower arrives centered on the goal cell (304, 48), not on
    // the marker's own center (300, 40) — the pathfinder's contract.
    arrivedA && aiNear(aiCenter(enemy).x, 304, 2) && aiNear(aiCenter(enemy).y, 48, 2),
    `center=${JSON.stringify(aiCenter(enemy))}`);
  check('patrol still holds the behavior after arriving',
    AI.behaviorOf(enemy) === 'patrol');
  AI.updateAI(world.objects, 1 / 60, world.host);
  check('patrol advances to point B on the next brain tick after arriving',
    enemy._ai.waypointIndex === 1 && PF.hasPath(enemy));
  let arrivedB = false;
  for (let f = 0; f < 200 && !arrivedB; f++) {
    aiPump(world, 1);
    arrivedB = PF.pathFinished(enemy);
  }
  check('patrol walks on to point B',
    arrivedB && aiNear(aiCenter(enemy).x, 304, 2) && aiNear(aiCenter(enemy).y, 304, 2),
    `center=${JSON.stringify(aiCenter(enemy))}`);
}
{
  // Patrol with a missing point holds quietly where it stands.
  const world = aiWorld();
  const enemy = aiEnemy(world);
  AI.setBehavior(enemy, { behavior: 'patrol', speed: 200, range: 300, patrolA: 'ghostA', patrolB: 'pointB' });
  aiPump(world, 30);
  check('patrol with a missing point stays put and keeps its behavior',
    !PF.hasPath(enemy) && aiNear(aiCenter(enemy).x, 30, 1) && aiNear(aiCenter(enemy).y, 40, 1) &&
    AI.behaviorOf(enemy) === 'patrol');
}
{
  // Chase: around the wall to the player, then re-plans when the
  // player moves, then stops when the player leaves the range.
  const world = aiWorld();
  const enemy = aiEnemy(world);
  AI.setBehavior(enemy, { behavior: 'chase', target: 'player', speed: 200, range: 1000 });
  let arrived = false;
  for (let f = 0; f < 600 && !arrived; f++) {
    aiPump(world, 1);
    arrived = PF.pathFinished(enemy);
  }
  check('chase walks around the wall and catches the player',
    // The chase re-plans every half second, so when the enemy enters
    // the player's cell the re-plan is a one-point path and the walk
    // ends there: caught means within one cell, not pixel-exact.
    arrived && Math.hypot(aiCenter(enemy).x - 300, aiCenter(enemy).y - 300) <= 32,
    `center=${JSON.stringify(aiCenter(enemy))}`);
  const player = world.objects.find(function (o) { return o.name === 'player'; });
  player.posX = 680; player.posY = 480; // center (700, 500), still in range
  let caught = false;
  for (let f = 0; f < 600 && !caught; f++) {
    aiPump(world, 1);
    caught = PF.pathFinished(enemy) && Math.hypot(aiCenter(enemy).x - 700, aiCenter(enemy).y - 500) <= 32;
  }
  check('chase re-plans and catches the moved player',
    caught && Math.hypot(aiCenter(enemy).x - 700, aiCenter(enemy).y - 500) <= 32,
    `center=${JSON.stringify(aiCenter(enemy))}`);
  AI.setBehavior(enemy, { behavior: 'chase', target: 'player', speed: 200, range: 50 });
  AI.updateAI(world.objects, 1 / 60, world.host);
  check('chase stops when the player leaves the range',
    !PF.hasPath(enemy) && AI.behaviorOf(enemy) === 'chase');
  const still = aiCenter(enemy);
  aiPump(world, 30);
  check('a stopped chaser stays put',
    aiNear(aiCenter(enemy).x, still.x, 1) && aiNear(aiCenter(enemy).y, still.y, 1));
}
{
  // Chase with a missing target stays put and keeps its behavior.
  const world = aiWorld();
  const enemy = aiEnemy(world);
  AI.setBehavior(enemy, { behavior: 'chase', target: 'ghost', speed: 200, range: 1000 });
  aiPump(world, 30);
  check('chase with a missing target stays put and keeps its behavior',
    !PF.hasPath(enemy) && AI.behaviorOf(enemy) === 'chase');
}
{
  // Flee: away from the player, then stops when the player is far.
  const world = aiWorld();
  const enemy = aiEnemy(world);
  const player = world.objects.find(function (o) { return o.name === 'player'; });
  enemy.posX = 280; enemy.posY = 280; // center (300, 300)
  player.posX = 240; player.posY = 240; // center (260, 260), 57 away
  const startDist = Math.hypot(aiCenter(enemy).x - aiCenter(player).x, aiCenter(enemy).y - aiCenter(player).y);
  AI.setBehavior(enemy, { behavior: 'flee', target: 'player', speed: 200, range: 300 });
  AI.updateAI(world.objects, 1 / 60, world.host);
  check('flee plans away from the player (last waypoint is the flee cell)',
    (function () {
      const pts = enemy._path && enemy._path.points;
      return !!pts && pts.length >= 1 &&
        pts[pts.length - 1].x === 528 && pts[pts.length - 1].y === 528;
    })());
  aiPump(world, 60);
  const fledDist = Math.hypot(aiCenter(enemy).x - aiCenter(player).x, aiCenter(enemy).y - aiCenter(player).y);
  check('flee walks away from the player',
    fledDist > startDist + 100, `start=${startDist.toFixed(1)} fled=${fledDist.toFixed(1)}`);
  player.posX = 10; player.posY = 500; // center (30, 520), far away
  AI.updateAI(world.objects, 1 / 60, world.host);
  check('flee stops when the player is out of range',
    !PF.hasPath(enemy) && AI.behaviorOf(enemy) === 'flee');
}
{
  // Wander: picks a spot near home, walks there, idles, picks again.
  const world = aiWorld();
  const enemy = aiEnemy(world);
  enemy.posX = 280; enemy.posY = 280; // center (300, 300), the home spot
  AI.setBehavior(enemy, { behavior: 'wander', speed: 200, range: 200 });
  AI.updateAI(world.objects, 1 / 60, world.host);
  check('wander plans a walkable spot within range of home',
    (function () {
      const pts = enemy._path && enemy._path.points;
      if (!pts || !pts.length) return false;
      const last = pts[pts.length - 1];
      if (Math.hypot(last.x - 300, last.y - 300) > 200 + 1e-9) return false;
      const maze = PF.buildWalkGrid(800, 600, [mazeTilemap()], Tiles);
      const c = PF.cellOf(maze, last.x, last.y);
      return !PF.isBlocked(maze, c.col, c.row);
    })());
  let arrived = false;
  for (let f = 0; f < 200 && !arrived; f++) {
    aiPump(world, 1);
    arrived = PF.pathFinished(enemy);
  }
  check('wander walks to the picked spot', arrived);
  const firstSpot = aiCenter(enemy);
  AI.updateAI(world.objects, 1 / 60, world.host);
  check('wander idles after arriving (waiting, with an idle timer)',
    enemy._ai.waiting === true && enemy._ai.idleIn > 0 && enemy._ai.idleIn <= 1.5 + 1e-9);
  aiPump(world, 120);
  check('wander picks a new spot after the idle and walks to it',
    // The enemy moved off the first spot, which only a fresh plan
    // does: it may be mid-walk or already arrived and idling again.
    (Math.abs(aiCenter(enemy).x - firstSpot.x) > 5 || Math.abs(aiCenter(enemy).y - firstSpot.y) > 5) &&
    AI.behaviorOf(enemy) === 'wander',
    `first=${JSON.stringify(firstSpot)} now=${JSON.stringify(aiCenter(enemy))}`);
}
{
  // A zero or negative step moves nothing; a missing pathfind module
  // is a quiet no-op; hostile lists never throw.
  const world = aiWorld();
  const enemy = aiEnemy(world);
  AI.setBehavior(enemy, { behavior: 'patrol', speed: 200, range: 300, patrolA: 'pointA', patrolB: 'pointB' });
  check('updateAI with a zero step plans nothing and reports zero active',
    AI.updateAI(world.objects, 0, world.host) === 0 && !PF.hasPath(enemy));
  check('updateAI with a negative step plans nothing',
    AI.updateAI(world.objects, -1, world.host) === 0 && !PF.hasPath(enemy));
  check('updateAI without the pathfind module is a quiet no-op',
    AI.updateAI(world.objects, 1 / 60, { tiles: Tiles, worldSize: world.host.worldSize, findObject: world.host.findObject }) === 0 &&
    !PF.hasPath(enemy));
  check('updateAI counts the driven objects it stepped',
    AI.updateAI(world.objects, 1 / 60, world.host) === 1 && PF.hasPath(enemy));
  check('updateAI ignores hostile lists and records, never throws',
    AI.updateAI(null, 1 / 60, world.host) === 0 &&
    AI.updateAI('nope', 1 / 60, world.host) === 0 &&
    AI.updateAI([null, {}, { _ai: 'junk' }], 1 / 60, world.host) === 0);
}

// --- routing sets ---
{
  check('routing sets name the two actions and the two conditions',
    AI.isAiAction('setAiBehavior') && AI.isAiAction('stopAi') &&
    !AI.isAiAction('followPath') && !AI.isAiAction('aiBehavior') &&
    AI.isAiCondition('aiBehavior') && AI.isAiCondition('targetInRange') &&
    !AI.isAiCondition('setAiBehavior') && !AI.isAiCondition('pathFinished') &&
    !AI.isAiAction(null) && !AI.isAiCondition(undefined));
}

// --- static wiring ---
{
  const html = fs.readFileSync(path.join(HYDRA, 'index.html'), 'utf8');
  const aiTag = html.indexOf('src="hydra-ai.js');
  check('index.html loads hydra-ai.js before player-runtime.js and script.js',
    aiTag !== -1 && aiTag < html.indexOf('src="player-runtime.js') && aiTag < html.indexOf('src="script.js'));
  check('index.html loads hydra-ai.js after hydra-pathfind.js',
    aiTag > html.indexOf('src="hydra-pathfind.js'));
  const playerJs = fs.readFileSync(path.join(HYDRA, 'player-runtime.js'), 'utf8');
  check('player-runtime.js hard-guards on HydraAi',
    playerJs.includes("if (!HydraAi || typeof HydraAi.updateAI !== 'function')") &&
    playerJs.includes('HydraScript player runtime requires hydra-ai.js'));
  check('player-runtime.js inlines HydraAi into exports',
    playerJs.includes("'HydraAi', global.HydraAi && global.HydraAi.factorySource"));
  check('player-runtime.js classifies AI blocks for the dispatch',
    playerJs.includes('HydraAi.isAiCondition(type)') &&
    playerJs.includes('HydraAi.isAiAction(type)'));
  check('player-runtime.js decides AI walks as a frame phase before the follower',
    playerJs.includes('updateAI: () => {') &&
    playerJs.includes('HydraAi.updateAI(live, (state.dt || 0) / 60, {'));
  check('player-runtime.js exposes the module to both contexts',
    playerJs.includes('aiModule: HydraAi'));
  const previewJs = fs.readFileSync(path.join(HYDRA, 'hydra-previewruntime.js'), 'utf8');
  check('preview runtime exposes the module to both contexts and decides AI walks',
    previewJs.includes("aiModule: mod('Ai')") &&
    previewJs.includes('AI.updateAI(objs, dt / 60, {'));
  const executeJs = fs.readFileSync(path.join(HYDRA, 'hydra-execute.js'), 'utf8');
  check('shared execute module runs Set AI Behavior and Stop AI',
    executeJs.includes("if (isType(ctx.aiModule, 'isAiAction', type))") &&
    executeJs.includes("type === 'setAiBehavior'") &&
    executeJs.includes("type === 'stopAi'") &&
    executeJs.includes('AI.setBehavior(o, {'));
  const conditionsJs = fs.readFileSync(path.join(HYDRA, 'hydra-conditions.js'), 'utf8');
  check('shared conditions module reads AI Behavior and Target In Range',
    conditionsJs.includes("case 'aiBehavior':") &&
    conditionsJs.includes("case 'targetInRange':") &&
    conditionsJs.includes('AIm.behaviorOf(o)') &&
    conditionsJs.includes('AIt.targetInRange(o, tgtObj, rangeVal)'));
  const flowJs = fs.readFileSync(path.join(HYDRA, 'hydra-flow.js'), 'utf8');
  check('flow module reads both AI conditions as level triggers',
    flowJs.includes("t === 'aiBehavior' || t === 'targetInRange'"));
  const frameJs = fs.readFileSync(path.join(HYDRA, 'hydra-frame.js'), 'utf8');
  check('frame module runs updateAI after updateParticles and before updatePaths in the sim',
    frameJs.includes("'updateTweens', 'updateParticles', 'updateDamageNumbers', 'updateAI', 'updatePaths', 'updateSpawners', 'updatePlatforms', 'updateMovement',") &&
    frameJs.includes("call('updateAI', host.updateAI);"));
  const catalogJs = fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8');
  check('catalog carries the four AI blocks',
    catalogJs.includes("category: 'AI'") &&
    catalogJs.includes("blockType: 'set-ai-behavior'") &&
    catalogJs.includes("runtimeType: 'setAiBehavior'") &&
    catalogJs.includes("blockType: 'stop-ai'") &&
    catalogJs.includes("runtimeType: 'stopAi'") &&
    catalogJs.includes("blockType: 'ai-behavior'") &&
    catalogJs.includes("runtimeType: 'aiBehavior'") &&
    catalogJs.includes("blockType: 'target-in-range'") &&
    catalogJs.includes("runtimeType: 'targetInRange'") &&
    catalogJs.includes("key: 'behavior', label: 'Behavior'") &&
    catalogJs.includes("key: 'patrolA', label: 'Patrol point A'") &&
    catalogJs.includes("key: 'targetName', label: 'Target object'"));
  const refMd = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');
  check('block reference documents all four AI blocks',
    refMd.includes('Set AI Behavior') && refMd.includes('Stop AI') &&
    refMd.includes('AI Behavior') && refMd.includes('Target In Range'));
  const guideMd = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');
  check('user guide covers AI behaviors',
    guideMd.includes('## AI behaviors') && guideMd.includes('Set AI Behavior'));
}

process.exit(failures === 0 ? 0 : 1);
