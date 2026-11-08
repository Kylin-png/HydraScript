// Unit tests for hydra/hydra-pathfind.js — the shared pathfinding
// (P4 Advanced batch 18: A* grid navigation, beginner edition).
//
// Pure logic: speed normalization (1..2000, default 100), the walk
// grid built from the scene's tilemaps, A* over that grid (8-direction
// movement, no corner cutting, octile heuristic), line-of-sight path
// smoothing, and the per-object path follower (start/stop/has/finished
// + the per-frame update). Nothing here touches the DOM; both runtimes
// delegate to this module. Static checks at the end pin the wiring:
// catalog blocks, both runtimes' dispatch and frame phase, the frame
// module's phase order, and the docs.

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
sandbox.window = sandbox; // hydra-pathfind.js + hydra-tiles.js assign to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-tiles.js'), 'utf8'),
  sandbox, { filename: 'hydra-tiles.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-pathfind.js'), 'utf8'),
  sandbox, { filename: 'hydra-pathfind.js' });
const PF = sandbox.HydraPathfind;
const Tiles = sandbox.HydraTiles;

check('HydraPathfind exposed with helpers',
  !!PF && typeof PF.normalizeSpeed === 'function' &&
  typeof PF.objectCenter === 'function' &&
  typeof PF.buildWalkGrid === 'function' &&
  typeof PF.cellOf === 'function' && typeof PF.cellCenter === 'function' &&
  typeof PF.isBlocked === 'function' &&
  typeof PF.findPath === 'function' &&
  typeof PF.hasLineOfSight === 'function' &&
  typeof PF.simplifyPath === 'function' &&
  typeof PF.startPath === 'function' && typeof PF.stopPath === 'function' &&
  typeof PF.hasPath === 'function' && typeof PF.pathFinished === 'function' &&
  typeof PF.updatePaths === 'function' &&
  typeof PF.isPathfindAction === 'function' &&
  typeof PF.isPathfindCondition === 'function');
check('factorySource is a self-contained function string',
  typeof PF.factorySource === 'string' && PF.factorySource.includes('hydraPathfindFactory'));
check('constants are 100 default speed, 1..2000 range, 32 cell, 200 cap',
  PF.DEFAULT_SPEED === 100 && PF.MIN_SPEED === 1 && PF.MAX_SPEED === 2000 &&
  PF.DEFAULT_CELL === 32 && PF.MAX_CELLS === 200 && PF.MAX_EXPANSIONS === 20000);

// --- speed normalization ---
{
  check('normalizeSpeed keeps 1, 100, and 2000, clamps past the range',
    PF.normalizeSpeed(1) === 1 && PF.normalizeSpeed(100) === 100 &&
    PF.normalizeSpeed(2000) === 2000 &&
    PF.normalizeSpeed(0) === 1 && PF.normalizeSpeed(5000) === 2000);
  check('normalizeSpeed reads non-numeric as 100 (a typo walks at the default speed)',
    PF.normalizeSpeed('fast') === 100 && PF.normalizeSpeed(NaN) === 100 &&
    PF.normalizeSpeed(undefined) === 100 && PF.normalizeSpeed(null) === 100 &&
    PF.normalizeSpeed('') === 100);
}

// --- object center ---
{
  check('objectCenter is the middle of the box',
    JSON.stringify(PF.objectCenter({ posX: 100, posY: 50, width: 40, height: 40 })) === '{"x":120,"y":70}');
  check('objectCenter reads missing fields as 0',
    JSON.stringify(PF.objectCenter(null)) === '{"x":0,"y":0}' &&
    JSON.stringify(PF.objectCenter({})) === '{"x":0,"y":0}');
}

// --- walk grid ---
function mazeTilemap() {
  // 10x10, tile 0 solid, wall down column 4 rows 0..7 (gap at rows 8,9).
  const tiles = new Array(100).fill(-1);
  for (let r = 0; r < 8; r++) tiles[r * 10 + 4] = 0;
  return { kind: 'tilemap', posX: 0, posY: 0, tileSize: 32, cols: 10, rows: 10, tiles: tiles, solidTiles: [0] };
}
{
  const open = PF.buildWalkGrid(800, 600, [], Tiles);
  check('a scene with no tilemap is all open floor',
    open.cell === 32 && open.cols === 25 && open.rows === 19 &&
    open.blocked.every(function (b) { return b === 0; }));
  const maze = PF.buildWalkGrid(320, 320, [mazeTilemap()], Tiles);
  check('solid tiles become walls in the grid',
    maze.cell === 32 && maze.cols === 10 && maze.rows === 10 &&
    PF.isBlocked(maze, 4, 0) && PF.isBlocked(maze, 4, 7) &&
    !PF.isBlocked(maze, 4, 8) && !PF.isBlocked(maze, 4, 9) &&
    !PF.isBlocked(maze, 0, 0) && !PF.isBlocked(maze, 9, 9));
  check('out of bounds counts as a wall, so paths stay inside the world',
    PF.isBlocked(maze, -1, 0) && PF.isBlocked(maze, 10, 0) &&
    PF.isBlocked(maze, 0, -1) && PF.isBlocked(maze, 0, 10));
  check('a tilemap offset in the world offsets its walls',
    (function () {
      const shifted = mazeTilemap();
      shifted.posX = 320; shifted.posY = 0;
      const g = PF.buildWalkGrid(640, 320, [shifted], Tiles);
      return g.cols === 20 && PF.isBlocked(g, 14, 0) && !PF.isBlocked(g, 4, 0);
    })());
  check('two tilemaps merge their walls',
    (function () {
      const a = mazeTilemap();
      const b = { kind: 'tilemap', posX: 0, posY: 0, tileSize: 32, cols: 10, rows: 10, tiles: (function () { const t = new Array(100).fill(-1); t[9] = 0; return t; })(), solidTiles: [0] };
      const g = PF.buildWalkGrid(320, 320, [a, b], Tiles);
      return PF.isBlocked(g, 4, 0) && PF.isBlocked(g, 9, 0) && !PF.isBlocked(g, 0, 0);
    })());
  check('a missing tiles module degrades to an all-open grid, never a throw',
    (function () {
      const g = PF.buildWalkGrid(320, 320, [mazeTilemap()], null);
      return g.cols === 10 && g.blocked.every(function (b) { return b === 0; });
    })());
  check('a huge scene grows the cell instead of the grid (200-cell cap)',
    (function () {
      const g = PF.buildWalkGrid(8000, 6000, [], Tiles);
      return g.cols <= 200 && g.rows <= 200 && g.cell >= 32 && g.cols === 200 && g.rows === 150;
    })());
  check('cellOf and cellCenter round-trip through the grid',
    JSON.stringify(PF.cellOf(maze, 100, 70)) === '{"col":3,"row":2}' &&
    JSON.stringify(PF.cellCenter(maze, 3, 2)) === '{"x":112,"y":80}');
}

// --- A* ---
function openGrid(cols, rows) {
  return { cell: 32, cols: cols, rows: rows, blocked: new Array(cols * rows).fill(0) };
}
{
  const open = openGrid(5, 5);
  const diag = PF.findPath(open, 16, 16, 144, 144);
  check('an open field paths straight down the diagonal',
    Array.isArray(diag) && diag.length === 5 &&
    JSON.stringify(diag[0]) === '{"x":16,"y":16}' &&
    JSON.stringify(diag[4]) === '{"x":144,"y":144}');
  const maze = PF.buildWalkGrid(320, 320, [mazeTilemap()], Tiles);
  const around = PF.findPath(maze, 16, 16, 304, 304);
  check('a path routes around a wall through the gap',
    Array.isArray(around) && around.length > 5 &&
    JSON.stringify(around[0]) === '{"x":16,"y":16}' &&
    JSON.stringify(around[around.length - 1]) === '{"x":304,"y":304}' &&
    around.every(function (p) {
      const c = PF.cellOf(maze, p.x, p.y);
      return !PF.isBlocked(maze, c.col, c.row);
    }) &&
    around.some(function (p) {
      const c = PF.cellOf(maze, p.x, p.y);
      return c.col === 4 && c.row >= 8;
    }));
  check('start and goal in the same cell is a one-point path',
    (function () {
      const p = PF.findPath(open, 16, 16, 20, 20);
      return Array.isArray(p) && p.length === 1 && p[0].x === 16 && p[0].y === 16;
    })());
  check('a blocked goal cell has no path',
    PF.findPath(maze, 16, 16, 144, 16) === null);
  check('an enclosed start has no path',
    (function () {
      const g = { cell: 32, cols: 3, rows: 3, blocked: [0, 1, 0, 1, 0, 0, 0, 0, 0] };
      return PF.findPath(g, 16, 16, 80, 80) === null;
    })());
  check('a diagonal never cuts the corner between two wall tiles',
    (function () {
      // Only (1,0) is a wall: the direct (0,0)->(1,1) diagonal is
      // forbidden, so the path must go around with 4 points.
      const g = { cell: 32, cols: 3, rows: 3, blocked: [0, 1, 0, 0, 0, 0, 0, 0, 0] };
      const p = PF.findPath(g, 16, 16, 80, 48);
      if (!Array.isArray(p) || p.length !== 4) return false;
      for (let i = 0; i < p.length - 1; i++) {
        if (p[i].x === 16 && p[i].y === 16 && p[i + 1].x === 48 && p[i + 1].y === 48) return false;
      }
      return true;
    })());
  check('a walled-off goal across a sealed map has no path',
    (function () {
      const g = { cell: 32, cols: 3, rows: 3, blocked: [0, 1, 0, 1, 1, 1, 0, 1, 0] };
      return PF.findPath(g, 16, 16, 80, 80) === null;
    })());
  check('a big open map still finds a path inside the expansion cap',
    (function () {
      const g = openGrid(100, 100);
      const p = PF.findPath(g, 16, 16, 3168, 3168);
      return Array.isArray(p) && p.length === 100;
    })());
  check('a start cell inside a wall still paths out (the object already stands there)',
    (function () {
      const g = openGrid(3, 3);
      g.blocked[0] = 1; // start cell (0,0) is a wall
      const p = PF.findPath(g, 16, 16, 80, 80);
      return Array.isArray(p) && p.length > 0 && p[p.length - 1].x === 80;
    })());
  check('hostile input reads as no path, never a throw',
    PF.findPath(null, 0, 0, 10, 10) === null &&
    PF.findPath({}, 0, 0, 10, 10) === null &&
    PF.findPath(openGrid(2, 2), NaN, 0, 10, 10) === null);
}

// --- line of sight + smoothing ---
{
  const open = openGrid(10, 10);
  const maze = PF.buildWalkGrid(320, 320, [mazeTilemap()], Tiles);
  check('line of sight is clear across open floor',
    PF.hasLineOfSight(open, { x: 16, y: 16 }, { x: 304, y: 304 }) === true);
  check('line of sight is blocked by a wall',
    PF.hasLineOfSight(maze, { x: 16, y: 16 }, { x: 304, y: 16 }) === false);
  check('line of sight passes through the gap',
    PF.hasLineOfSight(maze, { x: 16, y: 16 }, { x: 112, y: 272 }) === true);
  check('smoothing turns a staircase into one clean diagonal on open floor',
    (function () {
      const raw = PF.findPath(open, 16, 16, 304, 304);
      const smooth = PF.simplifyPath(open, raw);
      return raw.length === 10 && smooth.length === 2 &&
        smooth[0].x === 16 && smooth[1].x === 304;
    })());
  check('smoothing keeps the detour around a wall (first, gap, last)',
    (function () {
      const raw = PF.findPath(maze, 16, 16, 304, 304);
      const smooth = PF.simplifyPath(maze, raw);
      return smooth.length === 3 && smooth[0].x === 16 &&
        smooth[1].x === 112 && smooth[1].y === 272 &&
        smooth[2].x === 304 && smooth[2].y === 304;
    })());
  check('smoothing a short path or a missing grid returns a copy unchanged',
    (function () {
      const two = [{ x: 0, y: 0 }, { x: 32, y: 0 }];
      const a = PF.simplifyPath(open, two);
      const b = PF.simplifyPath(null, [{ x: 0, y: 0 }, { x: 32, y: 0 }, { x: 64, y: 0 }]);
      return a.length === 2 && a !== two && b.length === 3;
    })());
}

// --- follower records ---
{
  const obj = { posX: 0, posY: 0, width: 32, height: 32 };
  check('a fresh object has no path and is not finished',
    PF.hasPath(obj) === false && PF.pathFinished(obj) === false);
  const rec = PF.startPath(obj, [{ x: 16, y: 16 }, { x: 304, y: 16 }], 100);
  check('startPath records the walk and reads as walking',
    !!rec && rec.speed === 100 && rec.index === 1 && rec.done === false &&
    PF.hasPath(obj) === true && PF.pathFinished(obj) === false);
  check('a one-point path is already done',
    (function () {
      const o2 = { posX: 0, posY: 0, width: 32, height: 32 };
      const r2 = PF.startPath(o2, [{ x: 16, y: 16 }], 100);
      return !!r2 && r2.done === true && PF.hasPath(o2) === false && PF.pathFinished(o2) === true;
    })());
  check('startPath clamps a bad speed to the default and drops bad points',
    (function () {
      const o3 = { posX: 0, posY: 0, width: 32, height: 32 };
      const r3 = PF.startPath(o3, [{ x: 16, y: 16 }, { x: NaN, y: 0 }, { x: 100, y: 16 }], 'fast');
      return !!r3 && r3.speed === 100 && r3.points.length === 2;
    })());
  check('startPath rejects bad input instead of recording a broken path',
    PF.startPath(null, [{ x: 0, y: 0 }], 100) === null &&
    PF.startPath(obj, [], 100) === null &&
    PF.startPath(obj, 'nope', 100) === null);
  PF.stopPath(obj);
  check('stopPath clears the record, so both reads go false',
    PF.hasPath(obj) === false && PF.pathFinished(obj) === false && !obj._path);
  check('stopPath on a pathless or hostile object never throws',
    (function () {
      try { PF.stopPath({}); PF.stopPath(null); PF.stopPath(undefined); return true; }
      catch (e) { return false; }
    })());
}

// --- per-frame follower ---
{
  const obj = { posX: 0, posY: 0, width: 32, height: 32, velX: 50, velY: -30 };
  PF.startPath(obj, [{ x: 16, y: 16 }, { x: 304, y: 16 }], 100);
  PF.updatePaths([obj], 1 / 60);
  check('one 60fps frame walks speed/60 pixels toward the waypoint',
    near(obj.posX, 100 / 60) && near(obj.posY, 0));
  check('walking zeroes the velocity, so physics never fights the walk',
    obj.velX === 0 && obj.velY === 0);
  check('a zero step moves nothing',
    (function () {
      const before = obj.posX;
      PF.updatePaths([obj], 0);
      return obj.posX === before;
    })());
  let frames = 0;
  while (!obj._path.done && frames < 10000) { PF.updatePaths([obj], 1 / 60); frames++; }
  check('the walk arrives centered on the last waypoint',
    obj._path.done === true && near(obj.posX, 304 - 16) && near(obj.posY, 0) &&
    PF.hasPath(obj) === false && PF.pathFinished(obj) === true);
  check('the walk took about distance/speed seconds of frames',
    frames >= 170 && frames <= 180);
  check('a finished path stays finished and stops moving',
    (function () {
      const x = obj.posX;
      PF.updatePaths([obj], 1 / 60);
      return obj.posX === x && obj._path.done === true;
    })());
  check('one step can snap through several waypoints at once',
    (function () {
      const o2 = { posX: 0, posY: 0, width: 32, height: 32 };
      PF.startPath(o2, [{ x: 16, y: 16 }, { x: 48, y: 16 }, { x: 80, y: 16 }, { x: 112, y: 16 }], 100);
      PF.updatePaths([o2], 5); // 500px of step: the whole path is 96px
      return o2._path.done === true && near(o2.posX, 112 - 16);
    })());
  check('updatePaths walks several objects and counts the ones still walking',
    (function () {
      const a = { posX: 0, posY: 0, width: 32, height: 32 };
      const b = { posX: 0, posY: 0, width: 32, height: 32 };
      PF.startPath(a, [{ x: 16, y: 16 }, { x: 100, y: 16 }], 100);
      PF.startPath(b, [{ x: 16, y: 16 }], 100); // already done
      const walking = PF.updatePaths([a, b], 1 / 60);
      return walking === 1 && a.posX > 0 && b.posX === 0;
    })());
  check('updatePaths ignores hostile lists and pathless objects',
    PF.updatePaths(null, 1 / 60) === 0 &&
    PF.updatePaths([null, {}, { posX: 0, posY: 0 }], 1 / 60) === 0);
}

// --- routing sets ---
{
  check('routing sets name the two actions and the two conditions',
    PF.isPathfindAction('followPath') === true &&
    PF.isPathfindAction('stopPath') === true &&
    PF.isPathfindAction('playSound') === false &&
    PF.isPathfindCondition('pathFinished') === true &&
    PF.isPathfindCondition('hasPath') === true &&
    PF.isPathfindCondition('pathFinished'.toUpperCase()) === false &&
    PF.isPathfindCondition('followPath') === false);
}

// --- static wiring ---
{
  const html = fs.readFileSync(path.join(HYDRA, 'index.html'), 'utf8');
  const pfTag = html.indexOf('src="hydra-pathfind.js');
  check('index.html loads hydra-pathfind.js before player-runtime.js and script.js',
    pfTag !== -1 && pfTag < html.indexOf('src="player-runtime.js') && pfTag < html.indexOf('src="script.js'));
  check('index.html loads hydra-pathfind.js after hydra-spatialaudio.js',
    pfTag > html.indexOf('src="hydra-spatialaudio.js'));
  const playerJs = fs.readFileSync(path.join(HYDRA, 'player-runtime.js'), 'utf8');
  check('player-runtime.js hard-guards on HydraPathfind',
    playerJs.includes("if (!HydraPathfind || typeof HydraPathfind.findPath !== 'function')") &&
    playerJs.includes('HydraScript player runtime requires hydra-pathfind.js'));
  check('player-runtime.js inlines HydraPathfind into exports',
    playerJs.includes("'HydraPathfind', global.HydraPathfind && global.HydraPathfind.factorySource"));
  check('player-runtime.js classifies pathfinding blocks for the dispatch',
    playerJs.includes('HydraPathfind.isPathfindCondition(type)') &&
    playerJs.includes('HydraPathfind.isPathfindAction(type)'));
  check('player-runtime.js walks paths as a frame phase after particles',
    playerJs.includes('updatePaths: () => {') &&
    playerJs.includes('HydraPathfind.updatePaths(live, (state.dt || 0) / 60)'));
  check('player-runtime.js exposes the module to both contexts',
    playerJs.includes('pathfindModule: HydraPathfind'));
  const previewJs = fs.readFileSync(path.join(HYDRA, 'hydra-previewruntime.js'), 'utf8');
  check('preview runtime exposes the module to both contexts and walks paths',
    previewJs.includes("pathfindModule: mod('Pathfind')") &&
    previewJs.includes("PF.updatePaths(objs, dt / 60)"));
  const executeJs = fs.readFileSync(path.join(HYDRA, 'hydra-execute.js'), 'utf8');
  check('shared execute module runs Follow Path and Stop Path',
    executeJs.includes("if (isType(ctx.pathfindModule, 'isPathfindAction', type))") &&
    executeJs.includes("type === 'followPath'") &&
    executeJs.includes("type === 'stopPath'") &&
    executeJs.includes('PF.findPath(grid, from.x, from.y, destPos.x, destPos.y)'));
  const conditionsJs = fs.readFileSync(path.join(HYDRA, 'hydra-conditions.js'), 'utf8');
  check('shared conditions module reads Path Finished and Has Path',
    conditionsJs.includes("case 'pathFinished':") &&
    conditionsJs.includes("case 'hasPath':") &&
    conditionsJs.includes('PFf.pathFinished(o)') &&
    conditionsJs.includes('PFh.hasPath(o)'));
  const flowJs = fs.readFileSync(path.join(HYDRA, 'hydra-flow.js'), 'utf8');
  check('flow module reads both path conditions as level triggers',
    flowJs.includes("t === 'pathFinished' || t === 'hasPath'"));
  const frameJs = fs.readFileSync(path.join(HYDRA, 'hydra-frame.js'), 'utf8');
  check('frame module runs updatePaths after updateParticles in the sim',
    frameJs.includes("'updateTweens', 'updateParticles', 'updateDamageNumbers', 'updateAI', 'updatePaths', 'updateSpawners', 'updatePlatforms', 'updateMovement',") &&
    frameJs.includes("call('updatePaths', host.updatePaths);"));
  const catalogJs = fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8');
  check('catalog carries the four Pathfinding blocks',
    catalogJs.includes("category: 'Pathfinding'") &&
    catalogJs.includes("blockType: 'follow-path'") &&
    catalogJs.includes("runtimeType: 'followPath'") &&
    catalogJs.includes("blockType: 'stop-path'") &&
    catalogJs.includes("runtimeType: 'stopPath'") &&
    catalogJs.includes("blockType: 'path-finished'") &&
    catalogJs.includes("runtimeType: 'pathFinished'") &&
    catalogJs.includes("blockType: 'has-path'") &&
    catalogJs.includes("runtimeType: 'hasPath'") &&
    catalogJs.includes("key: 'destinationObject', label: 'Destination object'") &&
    catalogJs.includes("key: 'speed', label: 'Speed (px/s)'"));
  const refMd = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');
  check('block reference documents all four Pathfinding blocks',
    refMd.includes('Follow Path') && refMd.includes('Stop Path') &&
    refMd.includes('Path Finished') && refMd.includes('Has Path'));
  const guideMd = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');
  check('user guide covers pathfinding',
    guideMd.includes('Pathfinding'));
}

process.exit(failures === 0 ? 0 : 1);
