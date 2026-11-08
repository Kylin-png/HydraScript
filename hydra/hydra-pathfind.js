/* ============================================================================
 * hydra-pathfind.js — HydraScript shared pathfinding (P4 Advanced batch 18:
 * A* grid navigation, beginner edition).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation
 * of how an object walks around walls to reach a place — used by:
 *   - the editor preview runtime (hydra-previewruntime.js delegates
 *     to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Idea (Unity NavMeshAgent / Godot NavigationAgent2D, beginner edition):
 * the scene's tilemaps are the maze. Every solid tile is a wall; every
 * other cell is open floor. Follow Path runs A* from the object's cell
 * to the destination cell, smooths the zigzag with line-of-sight
 * string pulling, and then the per-frame follower walks the object
 * along the waypoints at the chosen speed until it arrives. An enemy
 * that chases the player through a maze, an NPC walking to a door, a
 * guard patrolling between waypoints — all from one block.
 *
 *   grid — one walk grid per Follow Path call, built from the live
 *     tilemaps of the current scene: cell size is the first tilemap's
 *     tileSize (32 when there is no tilemap), the grid covers the
 *     whole scene (worldWidth x worldHeight), and a cell is blocked
 *     when any solid tile overlaps it. The grid is capped at 200 x
 *     200 cells, so a huge scene grows the cell size instead of the
 *     grid. The grid is built fresh on every Follow Path, so a tile
 *     painted mid-game is a wall the next path respects — but a path
 *     already walking never re-plans (a moving target needs a fresh
 *     Follow Path).
 *   A* — 8-direction movement with the octile heuristic. Diagonals
 *     never cut corners: a diagonal step is allowed only when both
 *     orthogonal neighbours are open, so a path never slips through
 *     the seam between two wall tiles. The start cell is always
 *     walkable (the object already stands there); a blocked goal cell
 *     has no path. The search caps at 20,000 expansions and returns
 *     null past that, so a huge open map cannot hang the frame.
 *   follower — the path lives on the object as obj._path (points,
 *     index, speed, done). updatePaths runs once per frame, after the
 *     world sim, in both runtimes: it walks each following object
 *     toward its next waypoint at speed * dtSeconds, snaps to a
 *     waypoint on arrival, and marks the path done at the last one.
 *     While a path is active the object's velocity reads 0, so
 *     gravity and physics never fight the walk — path following is
 *     position movement, like moveTowardObject, and works best on
 *     objects without gravity.
 *
 * Nothing ever throws; hostile input degrades to safe defaults.
 * Old projects have no path blocks and behave exactly as before.
 *
 * Honest limits: walls come from tilemap solid tiles only — solid
 * objects are not obstacles yet, so a wall built from sprites does
 * not block a path; the path is computed once when the block runs
 * (no re-planning while it walks); one path per object (a new
 * Follow Path replaces the one already walking); there is no hs
 * script-API surface yet.
 *
 * Load order (index.html): hydra-pathfind.js BEFORE player-runtime.js
 * and script.js. player-runtime.js throws a clear error if
 * HydraPathfind is missing.
 * ========================================================================== */

function hydraPathfindFactory() {
  'use strict';

  var DEFAULT_SPEED = 100;
  var MIN_SPEED = 1;
  var MAX_SPEED = 2000;
  var DEFAULT_CELL = 32;
  var MAX_CELLS = 200;
  var MAX_EXPANSIONS = 20000;
  var SQRT2 = Math.SQRT2 || 1.4142135623730951;

  // A usable number, or the fallback when the value is not one.
  // null / undefined / '' count as missing (Number(null) is 0, which
  // would silently read as a real value instead of the fallback).
  function saneNum(v, fallback) {
    if (v == null || v === '') return fallback;
    var n = Number(v);
    return isFinite(n) ? n : fallback;
  }

  function clamp(v, lo, hi) {
    if (!isFinite(v)) return lo;
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
  }

  // One walk speed in world pixels per second: 1..2000, default 100.
  // Non-numeric reads as 100 — a typo walks at the default speed
  // instead of freezing the object or teleporting it.
  function normalizeSpeed(value) {
    if (value == null || value === '') return DEFAULT_SPEED;
    var n = Number(value);
    if (!isFinite(n)) return DEFAULT_SPEED;
    return clamp(n, MIN_SPEED, MAX_SPEED);
  }

  // The center of an object in world coordinates. A missing position
  // or size reads as 0, so a half-authored object still has a center.
  function objectCenter(obj) {
    try {
      return {
        x: saneNum(obj && obj.posX, 0) + saneNum(obj && obj.width, 0) / 2,
        y: saneNum(obj && obj.posY, 0) + saneNum(obj && obj.height, 0) / 2
      };
    } catch (err) {
      return { x: 0, y: 0 };
    }
  }

  // --- Walk grid ----------------------------------------------------------

  // One walk grid over the whole scene. worldWidth/worldHeight come
  // from the scene (800x600 when missing); tilemaps is the scene's
  // live tilemap objects; tilesModule is HydraTiles or null (a dropped
  // tag degrades to an all-open grid, never to a throw). Returns a
  // fresh grid: { cell, cols, rows, blocked } where blocked is a flat
  // row-major array of 0 (open) / 1 (wall). Never throws.
  function buildWalkGrid(worldWidth, worldHeight, tilemaps, tilesModule) {
    var w = saneNum(worldWidth, 800);
    var h = saneNum(worldHeight, 600);
    if (w <= 0) w = 800;
    if (h <= 0) h = 600;
    var maps = Array.isArray(tilemaps) ? tilemaps : [];
    var cell = DEFAULT_CELL;
    try {
      if (maps.length && tilesModule && typeof tilesModule.normalizeTilemap === 'function') {
        var first = tilesModule.normalizeTilemap(maps[0]);
        if (first && isFinite(Number(first.tileSize)) && Number(first.tileSize) > 0) {
          cell = clamp(Math.floor(Number(first.tileSize)), 8, 256);
        }
      } else if (maps.length) {
        var rawCell = Number(maps[0] && maps[0].tileSize);
        if (isFinite(rawCell) && rawCell > 0) cell = clamp(Math.floor(rawCell), 8, 256);
      }
    } catch (e) { cell = DEFAULT_CELL; }
    // A huge scene grows the cell instead of the grid: at most 200
    // cells per side, so the grid never passes 40,000 cells.
    cell = Math.max(cell, Math.ceil(w / MAX_CELLS), Math.ceil(h / MAX_CELLS));
    var cols = Math.max(1, Math.ceil(w / cell));
    var rows = Math.max(1, Math.ceil(h / cell));
    var blocked = new Array(cols * rows);
    var i;
    for (i = 0; i < blocked.length; i++) blocked[i] = 0;
    var grid = { cell: cell, cols: cols, rows: rows, blocked: blocked };
    if (!tilesModule || typeof tilesModule.normalizeTilemap !== 'function' ||
        typeof tilesModule.solidTilesOf !== 'function' ||
        typeof tilesModule.tileIndexAt !== 'function') {
      return grid;
    }
    maps.forEach(function (tm) {
      try {
        if (!tm || tm.kind !== 'tilemap') return;
        var spec = tilesModule.normalizeTilemap(tm);
        if (!spec) return;
        var solid = tilesModule.solidTilesOf(spec);
        if (!solid || !solid.length) return;
        var ts = spec.tileSize || cell;
        var ox = saneNum(tm.posX, 0);
        var oy = saneNum(tm.posY, 0);
        var c, r;
        for (r = 0; r < spec.rows; r++) {
          for (c = 0; c < spec.cols; c++) {
            var idx = tilesModule.tileIndexAt(spec, c, r);
            if (idx < 0 || solid.indexOf(idx) === -1) continue;
            var wx = ox + c * ts;
            var wy = oy + r * ts;
            var gc = Math.floor(wx / cell);
            var gr = Math.floor(wy / cell);
            if (gc >= 0 && gc < cols && gr >= 0 && gr < rows) blocked[gr * cols + gc] = 1;
          }
        }
      } catch (e) { /* one bad tilemap never breaks the grid */ }
    });
    return grid;
  }

  function cellOf(grid, x, y) {
    try {
      var cell = (grid && isFinite(Number(grid.cell)) && Number(grid.cell) > 0) ? Number(grid.cell) : DEFAULT_CELL;
      return { col: Math.floor(Number(x) / cell), row: Math.floor(Number(y) / cell) };
    } catch (e) {
      return { col: 0, row: 0 };
    }
  }

  function cellCenter(grid, col, row) {
    var cell = (grid && isFinite(Number(grid.cell)) && Number(grid.cell) > 0) ? Number(grid.cell) : DEFAULT_CELL;
    return { x: (col + 0.5) * cell, y: (row + 0.5) * cell };
  }

  // Is the cell a wall? Out of bounds counts as a wall, so paths stay
  // inside the world. A missing grid reads as all open.
  function isBlocked(grid, col, row) {
    try {
      if (!grid || !Array.isArray(grid.blocked)) return false;
      var cols = Number(grid.cols) || 0;
      var rows = Number(grid.rows) || 0;
      if (col < 0 || row < 0 || col >= cols || row >= rows) return true;
      return grid.blocked[row * cols + col] === 1;
    } catch (e) {
      return false;
    }
  }

  // --- A* -----------------------------------------------------------------

  // A small binary heap of { f, key } for the open list, so a big map
  // stays fast: push/pop are logarithmic, not a linear scan.
  function heapPush(heap, item) {
    heap.push(item);
    var i = heap.length - 1;
    while (i > 0) {
      var parent = (i - 1) >> 1;
      if (heap[parent].f <= heap[i].f) break;
      var tmp = heap[parent]; heap[parent] = heap[i]; heap[i] = tmp;
      i = parent;
    }
  }

  function heapPop(heap) {
    var top = heap[0];
    var last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      var i = 0;
      for (;;) {
        var left = i * 2 + 1;
        var right = left + 1;
        var smallest = i;
        if (left < heap.length && heap[left].f < heap[smallest].f) smallest = left;
        if (right < heap.length && heap[right].f < heap[smallest].f) smallest = right;
        if (smallest === i) break;
        var tmp = heap[smallest]; heap[smallest] = heap[i]; heap[i] = tmp;
        i = smallest;
      }
    }
    return top;
  }

  // Octile heuristic: the cheapest possible cost on an open 8-direction
  // grid, so A* never overestimates and the path stays shortest.
  function heuristic(dc, dr) {
    var a = Math.abs(dc);
    var b = Math.abs(dr);
    var min = Math.min(a, b);
    var max = Math.max(a, b);
    return max + (SQRT2 - 1) * min;
  }

  // A path from (startX, startY) to (goalX, goalY) in world pixels:
  // an array of { x, y } cell centers from the start cell to the goal
  // cell, or null when no path exists. The start cell is always
  // walkable (the object already stands there); a blocked goal cell
  // has no path. Never throws.
  function findPath(grid, startX, startY, goalX, goalY) {
    try {
      if (!grid || !Array.isArray(grid.blocked)) return null;
      var cols = Number(grid.cols) || 0;
      var rows = Number(grid.rows) || 0;
      if (cols < 1 || rows < 1) return null;
      var start = cellOf(grid, startX, startY);
      var goal = cellOf(grid, goalX, goalY);
      if (start.col === goal.col && start.row === goal.row) {
        return [cellCenter(grid, start.col, start.row)];
      }
      if (isBlocked(grid, goal.col, goal.row)) return null;
      var size = cols * rows;
      var gScore = new Array(size);
      var cameFrom = new Array(size);
      var closed = new Array(size);
      var i;
      for (i = 0; i < size; i++) { gScore[i] = Infinity; cameFrom[i] = -1; closed[i] = 0; }
      var startKey = start.row * cols + start.col;
      var goalKey = goal.row * cols + goal.col;
      gScore[startKey] = 0;
      var open = [];
      heapPush(open, { f: heuristic(goal.col - start.col, goal.row - start.row), key: startKey });
      var expansions = 0;
      var DIRS = [
        [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
        [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2]
      ];
      while (open.length) {
        var current = heapPop(open);
        var key = current.key;
        if (closed[key]) continue;
        closed[key] = 1;
        if (key === goalKey) {
          var path = [];
          var walk = goalKey;
          while (walk !== -1) {
            path.push(cellCenter(grid, walk % cols, Math.floor(walk / cols)));
            walk = cameFrom[walk];
          }
          path.reverse();
          return path;
        }
        if (++expansions > MAX_EXPANSIONS) return null;
        var cc = key % cols;
        var cr = Math.floor(key / cols);
        for (var d = 0; d < DIRS.length; d++) {
          var nc = cc + DIRS[d][0];
          var nr = cr + DIRS[d][1];
          if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
          if (isBlocked(grid, nc, nr)) continue;
          // No corner cutting: a diagonal step needs both orthogonal
          // neighbours open, so a path never slips through the seam
          // between two wall tiles.
          if (DIRS[d][0] !== 0 && DIRS[d][1] !== 0) {
            if (isBlocked(grid, cc + DIRS[d][0], cr) || isBlocked(grid, cc, cr + DIRS[d][1])) continue;
          }
          var nKey = nr * cols + nc;
          if (closed[nKey]) continue;
          var tentative = gScore[key] + DIRS[d][2];
          if (tentative < gScore[nKey]) {
            gScore[nKey] = tentative;
            cameFrom[nKey] = key;
            heapPush(open, { f: tentative + heuristic(goal.col - nc, goal.row - nr), key: nKey });
          }
        }
      }
      return null;
    } catch (err) {
      return null;
    }
  }

  // --- Line of sight + smoothing ------------------------------------------

  // Is the straight segment between two world points clear of walls?
  // Steps along the segment at half-cell intervals and checks each
  // sample's cell, so a wall the line grazes still blocks it.
  function hasLineOfSight(grid, from, to) {
    try {
      if (!grid || !Array.isArray(grid.blocked)) return true;
      var cell = (isFinite(Number(grid.cell)) && Number(grid.cell) > 0) ? Number(grid.cell) : DEFAULT_CELL;
      var dx = Number(to.x) - Number(from.x);
      var dy = Number(to.y) - Number(from.y);
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (!isFinite(dist) || dist <= 0) return true;
      var step = Math.max(1, cell / 2);
      var n = Math.ceil(dist / step);
      var i;
      for (i = 1; i < n; i++) {
        var t = i / n;
        var c = cellOf(grid, Number(from.x) + dx * t, Number(from.y) + dy * t);
        if (isBlocked(grid, c.col, c.row)) return false;
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  // String pulling: from each waypoint, keep the furthest later
  // waypoint still visible in a straight line, so a staircase of
  // diagonal steps becomes one clean diagonal. The first and last
  // points always survive. Returns a fresh array; a short path or a
  // missing grid returns a copy unchanged.
  function simplifyPath(grid, points) {
    try {
      if (!Array.isArray(points) || points.length <= 2) return (points || []).slice();
      if (!grid || !Array.isArray(grid.blocked)) return points.slice();
      var out = [points[0]];
      var anchor = 0;
      while (anchor < points.length - 1) {
        var furthest = anchor + 1;
        var j;
        for (j = points.length - 1; j > anchor + 1; j--) {
          if (hasLineOfSight(grid, points[anchor], points[j])) { furthest = j; break; }
        }
        out.push(points[furthest]);
        anchor = furthest;
      }
      return out;
    } catch (e) {
      return Array.isArray(points) ? points.slice() : [];
    }
  }

  // --- Follower -----------------------------------------------------------

  // Start an object walking a path: a fresh _path record on the live
  // object (never on authored project data). A one-point path is
  // already done. A new path replaces the one already walking.
  // Returns the record, or null on bad input.
  function startPath(obj, points, speed) {
    try {
      if (!obj || typeof obj !== 'object' || !Array.isArray(points) || !points.length) return null;
      var clean = [];
      points.forEach(function (p) {
        if (p && isFinite(Number(p.x)) && isFinite(Number(p.y))) {
          clean.push({ x: Number(p.x), y: Number(p.y) });
        }
      });
      if (!clean.length) return null;
      var rec = {
        points: clean,
        index: clean.length > 1 ? 1 : 0,
        speed: normalizeSpeed(speed),
        done: clean.length <= 1
      };
      obj._path = rec;
      return rec;
    } catch (e) {
      return null;
    }
  }

  // Stop an object's path at once. The record is gone, so Path
  // Finished and Has Path both read false after it.
  function stopPath(obj) {
    try {
      if (obj && typeof obj === 'object') delete obj._path;
    } catch (e) { /* a hostile object never breaks the frame */ }
  }

  // True while the object is walking a path that has not arrived yet.
  function hasPath(obj) {
    try {
      return !!(obj && obj._path && !obj._path.done);
    } catch (e) {
      return false;
    }
  }

  // True once the object's path has arrived (and the record still
  // stands — a new Follow Path or Stop Path clears it). An object
  // that never started a path reads false.
  function pathFinished(obj) {
    try {
      return !!(obj && obj._path && obj._path.done);
    } catch (e) {
      return false;
    }
  }

  // Walk every following object one frame toward its next waypoint.
  // dtSeconds is the scaled frame step in seconds (dt / 60); a zero
  // or negative step moves nothing. Positions move by center, so the
  // object arrives centered on each waypoint; velocity reads 0 while
  // a path is active, so physics never fights the walk. Never throws;
  // returns how many objects are still walking after the step.
  function updatePaths(objects, dtSeconds) {
    var walking = 0;
    try {
      var dt = Number(dtSeconds);
      if (!isFinite(dt) || dt <= 0) return 0;
      if (!Array.isArray(objects)) return 0;
      objects.forEach(function (obj) {
        try {
          if (!obj || !obj._path || obj._path.done) return;
          var rec = obj._path;
          var points = Array.isArray(rec.points) ? rec.points : [];
          if (!points.length || rec.index >= points.length) { rec.done = true; return; }
          var step = normalizeSpeed(rec.speed) * dt;
          var w = saneNum(obj.width, 0);
          var h = saneNum(obj.height, 0);
          while (step > 0 && !rec.done) {
            var wp = points[rec.index];
            if (!wp) { rec.done = true; break; }
            var cx = saneNum(obj.posX, 0) + w / 2;
            var cy = saneNum(obj.posY, 0) + h / 2;
            var dx = wp.x - cx;
            var dy = wp.y - cy;
            var dist = Math.sqrt(dx * dx + dy * dy);
            if (dist <= step || dist < 0.5) {
              obj.posX = wp.x - w / 2;
              obj.posY = wp.y - h / 2;
              step -= dist;
              rec.index++;
              if (rec.index >= points.length) rec.done = true;
            } else {
              obj.posX = saneNum(obj.posX, 0) + (dx / dist) * step;
              obj.posY = saneNum(obj.posY, 0) + (dy / dist) * step;
              step = 0;
            }
          }
          obj.velX = 0;
          obj.velY = 0;
          if (!rec.done) walking++;
        } catch (e) { /* one bad object never breaks the frame */ }
      });
    } catch (e) { /* a hostile list never breaks the frame */ }
    return walking;
  }

  // --- Routing -------------------------------------------------------------

  function isPathfindAction(type) {
    return type === 'followPath' || type === 'stopPath';
  }

  function isPathfindCondition(type) {
    return type === 'pathFinished' || type === 'hasPath';
  }

  return {
    DEFAULT_SPEED: DEFAULT_SPEED,
    MIN_SPEED: MIN_SPEED,
    MAX_SPEED: MAX_SPEED,
    DEFAULT_CELL: DEFAULT_CELL,
    MAX_CELLS: MAX_CELLS,
    MAX_EXPANSIONS: MAX_EXPANSIONS,
    normalizeSpeed: normalizeSpeed,
    objectCenter: objectCenter,
    buildWalkGrid: buildWalkGrid,
    cellOf: cellOf,
    cellCenter: cellCenter,
    isBlocked: isBlocked,
    findPath: findPath,
    hasLineOfSight: hasLineOfSight,
    simplifyPath: simplifyPath,
    startPath: startPath,
    stopPath: stopPath,
    hasPath: hasPath,
    pathFinished: pathFinished,
    updatePaths: updatePaths,
    isPathfindAction: isPathfindAction,
    isPathfindCondition: isPathfindCondition
  };
}

if (typeof window !== 'undefined') {
  window.HydraPathfind = hydraPathfindFactory();
  // Self-contained source of the factory, inlined into exported playable games
  // by HydraPlayer.buildPlayableHtml so exports run without editor files.
  window.HydraPathfind.factorySource = hydraPathfindFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraPathfindFactory;
