/* ============================================================================
 * hydra-ai.js — HydraScript shared simple AI behaviors (P4 Advanced batch 19:
 * patrol / chase / flee / wander, beginner edition).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation
 * of how an object decides where to walk on its own — used by:
 *   - the editor preview runtime (hydra-previewruntime.js delegates
 *     to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Idea (Unity NavMeshAgent + simple AI states / Godot NavigationAgent2D
 * + steering, beginner edition): a guard that patrols, an enemy that
 * chases the player, a deer that flees, a villager that wanders — all
 * from one block, with no hand-built chase logic. The brain steers
 * through the pathfinder (batch 18), so every behavior walks around
 * walls instead of getting stuck on them:
 *
 *   patrol — walks between two named objects (point A, point B, point
 *     A, ...) in a loop. The points are looked up live on every plan,
 *     so a moving patrol point drags the patrol with it; a missing
 *     point holds the patrol quietly where it stands.
 *   chase — walks at the target object while it stays within Range
 *     (default 300px). The path is re-planned every half second, so a
 *     moving target stays caught; past the range the enemy stops and
 *     waits for the target to come back.
 *   flee — walks away from the target while it stays within Range,
 *     picking the first walkable point at Range distance in the away
 *     direction (fanning out over twelve angles when straight away is
 *     a wall); past the range it stops, safe for now.
 *   wander — picks a random walkable point within Range of the spot
 *     where the behavior was set (its home), walks there, idles
 *     0.5–1.5 seconds, and picks again.
 *
 *   record — the behavior lives on the live object as obj._ai
 *     (behavior, target, speed, range, patrolA, patrolB, the patrol
 *     waypoint index, the wander home, repath/idle timers). Set AI
 *     Behavior writes it; Stop AI clears it. The record is run state
 *     only — a fresh scene load mints fresh live objects, so no
 *     behavior survives a scene switch, and none travels in save
 *     slots.
 *   brain — updateAI runs once per frame, before the path follower
 *     in the world sim, in both runtimes: it decides the next
 *     destination for each driven object and hands the plan to the
 *     pathfinder, so the follower walks the fresh plan the same frame.
 *     It runs on the scaled dt, so behaviors slow with the time scale
 *     and freeze while paused. A behavior change clears the walking
 *     path (the action does that), so the brain always plans fresh.
 *
 * Nothing ever throws; hostile input degrades to safe defaults.
 * Old projects have no AI blocks and behave exactly as before.
 *
 * Honest limits: behaviors steer through the pathfinder, so walls
 * come from tilemap solid tiles only (a wall built from sprites does
 * not block a walk yet); one behavior per object (a new Set AI
 * Behavior replaces the one already running); chase and flee re-plan
 * every half second, not every frame, so a fast target can juke a
 * chaser for a moment; there is no hs script-API surface yet.
 *
 * Load order (index.html): hydra-ai.js BEFORE player-runtime.js and
 * script.js. player-runtime.js throws a clear error if HydraAi is
 * missing.
 * ========================================================================== */

function hydraAiFactory() {
  'use strict';

  var BEHAVIORS = ['none', 'patrol', 'chase', 'flee', 'wander'];
  var DEFAULT_SPEED = 100;
  var MIN_SPEED = 1;
  var MAX_SPEED = 2000;
  var DEFAULT_RANGE = 300;
  var MIN_RANGE = 0;
  var MAX_RANGE = 5000;
  var REPATH_SECONDS = 0.5;
  var WANDER_TRIES = 8;
  var IDLE_MIN = 0.5;
  var IDLE_MAX = 1.5;
  var FLEE_ANGLES = [0, Math.PI / 6, -Math.PI / 6, Math.PI / 3, -Math.PI / 3,
    Math.PI / 2, -Math.PI / 2, 2 * Math.PI / 3, -2 * Math.PI / 3,
    5 * Math.PI / 6, -5 * Math.PI / 6, Math.PI];

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

  // One walk speed in world pixels per second: 1..2000, default 100 —
  // the same range as Follow Path, so a chaser and a walker agree on
  // what "fast" means. Non-numeric reads as 100.
  function normalizeSpeed(value) {
    if (value == null || value === '') return DEFAULT_SPEED;
    var n = Number(value);
    if (!isFinite(n)) return DEFAULT_SPEED;
    return clamp(n, MIN_SPEED, MAX_SPEED);
  }

  // A detection / wander / flee distance in pixels: 0..5000, default
  // 300. Non-numeric reads as 300; 0 means "right on top of me".
  function normalizeRange(value) {
    if (value == null || value === '') return DEFAULT_RANGE;
    var n = Number(value);
    if (!isFinite(n)) return DEFAULT_RANGE;
    return clamp(n, MIN_RANGE, MAX_RANGE);
  }

  // One behavior name, lowercased and trimmed. Anything unknown —
  // including blank — reads as 'none', so a typo never invents a
  // behavior the brain does not know.
  function normalizeBehavior(value) {
    try {
      var b = String(value == null ? '' : value).trim().toLowerCase();
      return BEHAVIORS.indexOf(b) !== -1 ? b : 'none';
    } catch (e) {
      return 'none';
    }
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

  // --- Behavior record ----------------------------------------------------

  // The object's current behavior, or 'none' when it has no record.
  function behaviorOf(obj) {
    try {
      if (!obj || !obj._ai || typeof obj._ai.behavior !== 'string') return 'none';
      return normalizeBehavior(obj._ai.behavior);
    } catch (e) {
      return 'none';
    }
  }

  // Give an object a behavior: a fresh _ai record on the live object
  // (never on authored project data). cfg carries behavior, target
  // (the chase/flee object name), speed, range, and the two patrol
  // point names; home is the object's center right now, the spot
  // wander roams around. 'none' clears the record instead (the same
  // as Stop AI) and returns null. A new behavior replaces the one
  // already running. Returns the record, or null on bad input.
  function setBehavior(obj, cfg) {
    try {
      if (!obj || typeof obj !== 'object') return null;
      var c = (cfg && typeof cfg === 'object') ? cfg : {};
      var behavior = normalizeBehavior(c.behavior);
      if (behavior === 'none') {
        delete obj._ai;
        return null;
      }
      var center = objectCenter(obj);
      var rec = {
        behavior: behavior,
        target: (typeof c.target === 'string') ? c.target.trim() : '',
        speed: normalizeSpeed(c.speed),
        range: normalizeRange(c.range),
        patrolA: (typeof c.patrolA === 'string') ? c.patrolA.trim() : '',
        patrolB: (typeof c.patrolB === 'string') ? c.patrolB.trim() : '',
        waypointIndex: 0,
        homeX: center.x,
        homeY: center.y,
        repathIn: 0,
        idleIn: 0,
        waiting: false
      };
      obj._ai = rec;
      return rec;
    } catch (e) {
      return null;
    }
  }

  // Clear an object's behavior at once. The record is gone, so AI
  // Behavior reads 'none' after it. (The caller also stops the
  // walking path — the brain never leaves a stale path behind.)
  function stopBehavior(obj) {
    try {
      if (obj && typeof obj === 'object') delete obj._ai;
    } catch (e) { /* a hostile object never breaks the frame */ }
  }

  // True when the target object's center is within range pixels of
  // the object's center. A missing object or target reads false.
  function targetInRange(obj, targetObj, range) {
    try {
      if (!obj || !targetObj) return false;
      var a = objectCenter(obj);
      var b = objectCenter(targetObj);
      var dx = a.x - b.x;
      var dy = a.y - b.y;
      return Math.sqrt(dx * dx + dy * dy) <= normalizeRange(range);
    } catch (e) {
      return false;
    }
  }

  // --- Planning helpers ---------------------------------------------------

  // Walk the object to a destination through the pathfinder: build the
  // walk grid from the host's live tilemaps, find the route, smooth
  // it, and start walking it. Returns true when a path started.
  function planTo(obj, dest, grid, host) {
    try {
      var PF = host && host.pathfind;
      if (!PF || typeof PF.findPath !== 'function' ||
          typeof PF.simplifyPath !== 'function' ||
          typeof PF.startPath !== 'function') return false;
      if (!grid || !dest || !isFinite(Number(dest.x)) || !isFinite(Number(dest.y))) return false;
      var from = PF.objectCenter(obj);
      var raw = PF.findPath(grid, from.x, from.y, dest.x, dest.y);
      if (!raw) return false;
      var smooth = PF.simplifyPath(grid, raw);
      var speed = (obj && obj._ai) ? obj._ai.speed : DEFAULT_SPEED;
      return !!PF.startPath(obj, smooth, speed);
    } catch (e) {
      return false;
    }
  }

  // The flee point: Range pixels away from the target, in the away
  // direction, fanning out over twelve angles when straight away is
  // a wall. Returns the first walkable candidate, or null when every
  // direction is blocked (the object stays put and retries next
  // repath).
  function fleePoint(from, targetCenter, range, grid, PF) {
    try {
      if (!grid || !PF || typeof PF.cellOf !== 'function' ||
          typeof PF.isBlocked !== 'function') return null;
      var dx = Number(from.x) - Number(targetCenter.x);
      var dy = Number(from.y) - Number(targetCenter.y);
      var len = Math.sqrt(dx * dx + dy * dy);
      if (!isFinite(len) || len < 1) { dx = 1; dy = 0; len = 1; }
      var base = Math.atan2(dy / len, dx / len);
      var dist = normalizeRange(range);
      if (dist <= 0) dist = DEFAULT_RANGE;
      var i;
      for (i = 0; i < FLEE_ANGLES.length; i++) {
        var a = base + FLEE_ANGLES[i];
        var cand = { x: from.x + Math.cos(a) * dist, y: from.y + Math.sin(a) * dist };
        var c = PF.cellOf(grid, cand.x, cand.y);
        if (!PF.isBlocked(grid, c.col, c.row)) return cand;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  // The wander point: a random walkable point within Range of home,
  // uniform over the disc, up to eight tries. Returns the first
  // walkable candidate, or null when none was found (the object
  // idles and tries again next frame).
  function wanderPoint(home, range, grid, PF) {
    try {
      if (!grid || !PF || typeof PF.cellOf !== 'function' ||
          typeof PF.isBlocked !== 'function') return null;
      var r = normalizeRange(range);
      var i;
      for (i = 0; i < WANDER_TRIES; i++) {
        var a = Math.random() * Math.PI * 2;
        var d = Math.sqrt(Math.random()) * r;
        var cand = { x: home.x + Math.cos(a) * d, y: home.y + Math.sin(a) * d };
        var c = PF.cellOf(grid, cand.x, cand.y);
        if (!PF.isBlocked(grid, c.col, c.row)) return cand;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  // --- The brain ----------------------------------------------------------

  // Decide where every AI-driven object walks next, one frame. host
  // carries pathfind (HydraPathfind), tiles (HydraTiles), worldSize()
  // ({ width, height } or null), and findObject(name) (the live
  // object or null, hidden objects included so a hidden patrol point
  // still works). dtSeconds is the scaled frame step in seconds
  // (dt / 60); a zero or negative step moves nothing. The walk grid
  // is built once per call, lazily, and shared by every object that
  // needs a plan this frame. Never throws; returns how many objects
  // hold a behavior record after the step.
  function updateAI(objects, dtSeconds, host) {
    var active = 0;
    try {
      var dt = Number(dtSeconds);
      if (!isFinite(dt) || dt <= 0) return 0;
      if (!Array.isArray(objects)) return 0;
      var PF = host && host.pathfind;
      if (!PF || typeof PF.findPath !== 'function' ||
          typeof PF.startPath !== 'function' ||
          typeof PF.stopPath !== 'function' ||
          typeof PF.hasPath !== 'function' ||
          typeof PF.pathFinished !== 'function') return 0;
      var grid = null;
      var gridBuilt = false;
      function gridFor() {
        if (gridBuilt) return grid;
        gridBuilt = true;
        try {
          var ws = (host && typeof host.worldSize === 'function') ? host.worldSize() : null;
          var tilemaps = [];
          objects.forEach(function (o) { if (o && o.kind === 'tilemap') tilemaps.push(o); });
          grid = PF.buildWalkGrid(ws ? ws.width : null, ws ? ws.height : null,
            tilemaps, host && host.tiles);
        } catch (e) { grid = null; }
        return grid;
      }
      function find(name) {
        try {
          if (!host || typeof host.findObject !== 'function') return null;
          if (typeof name !== 'string' || !name.trim()) return null;
          var o = host.findObject(name.trim());
          return (o && typeof o === 'object') ? o : null;
        } catch (e) {
          return null;
        }
      }
      function stop(obj) {
        try { PF.stopPath(obj); } catch (e) { /* a throwing stop is skipped */ }
      }
      objects.forEach(function (obj) {
        try {
          if (!obj || !obj._ai) return;
          var rec = obj._ai;
          var behavior = normalizeBehavior(rec.behavior);
          if (behavior === 'none') { delete obj._ai; return; }
          active++;
          rec.repathIn = Math.max(0, saneNum(rec.repathIn, 0) - dt);
          rec.idleIn = Math.max(0, saneNum(rec.idleIn, 0) - dt);
          if (behavior === 'patrol') {
            if (PF.hasPath(obj)) return;
            var pts = [rec.patrolA, rec.patrolB];
            if (PF.pathFinished(obj)) {
              rec.waypointIndex = ((rec.waypointIndex || 0) + 1) % 2;
            }
            var wp = find(pts[rec.waypointIndex || 0]);
            if (!wp) return; // a missing patrol point holds the patrol quietly
            planTo(obj, PF.objectCenter(wp), gridFor(), host);
          } else if (behavior === 'chase' || behavior === 'flee') {
            var target = find(rec.target);
            if (!target) { stop(obj); rec.repathIn = 0; return; }
            if (!targetInRange(obj, target, rec.range)) {
              stop(obj);
              rec.repathIn = 0;
              return;
            }
            if (PF.hasPath(obj) && rec.repathIn > 0) return;
            if (behavior === 'chase') {
              planTo(obj, PF.objectCenter(target), gridFor(), host);
            } else {
              var dest = fleePoint(PF.objectCenter(obj), PF.objectCenter(target),
                rec.range, gridFor(), PF);
              if (dest) planTo(obj, dest, gridFor(), host);
            }
            rec.repathIn = REPATH_SECONDS;
          } else if (behavior === 'wander') {
            if (PF.hasPath(obj)) return;
            if (rec.waiting) {
              if (rec.idleIn > 0) return;
              rec.waiting = false;
              var next = wanderPoint({ x: rec.homeX, y: rec.homeY },
                rec.range, gridFor(), PF);
              if (next) planTo(obj, next, gridFor(), host);
              return;
            }
            if (PF.pathFinished(obj)) {
              // Just arrived: idle a beat before picking the next spot.
              rec.waiting = true;
              rec.idleIn = IDLE_MIN + Math.random() * (IDLE_MAX - IDLE_MIN);
              return;
            }
            var first = wanderPoint({ x: rec.homeX, y: rec.homeY },
              rec.range, gridFor(), PF);
            if (first) planTo(obj, first, gridFor(), host);
          }
        } catch (e) { /* one bad object never breaks the frame */ }
      });
    } catch (e) { /* a hostile list never breaks the frame */ }
    return active;
  }

  // --- Routing -------------------------------------------------------------

  function isAiAction(type) {
    return type === 'setAiBehavior' || type === 'stopAi';
  }

  function isAiCondition(type) {
    return type === 'aiBehavior' || type === 'targetInRange';
  }

  return {
    BEHAVIORS: BEHAVIORS,
    DEFAULT_SPEED: DEFAULT_SPEED,
    MIN_SPEED: MIN_SPEED,
    MAX_SPEED: MAX_SPEED,
    DEFAULT_RANGE: DEFAULT_RANGE,
    MIN_RANGE: MIN_RANGE,
    MAX_RANGE: MAX_RANGE,
    REPATH_SECONDS: REPATH_SECONDS,
    WANDER_TRIES: WANDER_TRIES,
    IDLE_MIN: IDLE_MIN,
    IDLE_MAX: IDLE_MAX,
    normalizeSpeed: normalizeSpeed,
    normalizeRange: normalizeRange,
    normalizeBehavior: normalizeBehavior,
    objectCenter: objectCenter,
    behaviorOf: behaviorOf,
    setBehavior: setBehavior,
    stopBehavior: stopBehavior,
    targetInRange: targetInRange,
    fleePoint: fleePoint,
    wanderPoint: wanderPoint,
    updateAI: updateAI,
    isAiAction: isAiAction,
    isAiCondition: isAiCondition
  };
}

if (typeof window !== 'undefined') {
  window.HydraAi = hydraAiFactory();
  // Self-contained source of the factory, inlined into exported playable games
  // by HydraPlayer.buildPlayableHtml so exports run without editor files.
  window.HydraAi.factorySource = hydraAiFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraAiFactory;
