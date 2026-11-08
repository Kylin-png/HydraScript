/* ============================================================================
 * hydra-platform.js — HydraScript shared moving platforms & one-way
 * platforms (P4 Advanced batch 27: moving platforms & one-way platforms,
 * beginner edition).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation
 * of how platforms move and carry their riders — used by:
 *   - the editor preview runtime (hydra-previewruntime.js delegates
 *     to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Idea (Unity moving platforms / Godot platforms, beginner edition):
 * batch 26 gave the hero double jumps, coyote time, a jump buffer, and
 * a dash — but the ground itself never moved. Platforms are the world
 * moving under the hero:
 *
 *   moving platforms — an object with a waypoint path (two or more
 *     points, absolute world positions) that slides along it at a
 *     fixed speed, ping-pong (there and back) or loop (around and
 *     around). Anything standing on the platform rides it: each frame
 *     the platform moves by its step and every rider moves by the
 *     same step, so the hero stays glued to a platform that drops,
 *     rises, or slides sideways. The platform moves by direct
 *     position steps (like the dash), so gravity and friction never
 *     fight it — and because the carry runs after the physics step,
 *     the rider's own velocity is untouched.
 *   one-way platforms — a platform you jump up through and land on
 *     from above. The flag is the physics engine's own one-way flag
 *     (obj.collision.oneWay, batch 32): the physics step only catches
 *     a body falling onto the top, never one rising through it — and
 *     the movement module's grounded check now agrees (it skips a
 *     one-way floor while the object rises, so jumping through one
 *     never grants a free ground jump).
 *   crumbling platforms — a platform that falls away after the player
 *     stands on it for a set time. Once a rider stands on it the
 *     timer starts and runs to the end even if the rider steps off;
 *     when it expires the platform stops being solid (collision off)
 *     and is hidden, so the rider drops through. It stays gone until
 *     the scene reloads.
 *   the config — per object, authored on the object itself
 *     (obj.platform: enabled, points, speed, mode, oneWay,
 *     crumbleSeconds) with an Inspector Platform section; objects
 *     without the config are ordinary floors, which is exactly the
 *     old behavior. The Set Platform Path / Set One-Way Platform /
 *     Set Crumble Time blocks rewrite that config at runtime (a
 *     switch that starts a platform moving is one block).
 *   the runtime — per platform, transient, keyed by object id: the
 *     next waypoint, the ping-pong direction, the crumble deadline,
 *     and whether it already crumbled. A new `updatePlatforms` frame
 *     phase refreshes it after the spawners and before the movement
 *     phase, so the movement module's grounded check sees the rider
 *     on the platform's new position and jumps refill there. The
 *     state is fresh per scene load (via the scene-reset hook), never
 *     in project JSON or save slots.
 *
 * Time is the frozen game clock in seconds (the hosts pass
 * frozenNowMs() / 1000, so crumble timers hold while paused, and the
 * frame phase only runs while unpaused).
 *
 * Nothing ever throws; hostile input degrades to safe defaults.
 *
 * Honest limits: platforms move on straight waypoint legs only (no
 * curves); the carry is positional — only objects standing directly
 * on the platform ride it, so a rider standing on another rider is
 * carried by physics, not by the platform; a platform moves by direct
 * position steps, so it can sit inside a thin wall for a frame before
 * the next physics step pushes it back out (keep paths clear of
 * walls); one-way platforms block from above only, never from the
 * side or below; a crumbled platform stays gone until the scene
 * reloads; no `hs` script-API surface yet.
 *
 * Load order (index.html): hydra-platform.js BEFORE player-runtime.js
 * and script.js. player-runtime.js throws a clear error if
 * HydraPlatform is missing.
 * ========================================================================== */

function hydraPlatformFactory() {
  'use strict';

  // A usable number, or the fallback when the value is not one.
  // Only real numbers or numeric strings count — null / undefined /
  // '' count as missing, and anything else (an array, an object, a
  // boolean) reads as the fallback instead of a coerced number
  // (Number([]) is 0, which would silently read as a real value
  // instead of the fallback — the cycle-13 strict-coercion lesson).
  function saneNum(v, fallback) {
    if (v == null || v === '') return fallback;
    if (typeof v === 'number') return isFinite(v) ? v : fallback;
    if (typeof v === 'string') {
      if (v.trim() === '') return fallback;
      var n = Number(v);
      return isFinite(n) ? n : fallback;
    }
    return fallback;
  }

  function finiteNum(v, fallback) {
    var n = Number(v);
    return isFinite(n) ? n : fallback;
  }

  // The state itself, or null for a missing / non-object state — the
  // callers below degrade quietly instead of throwing, so a dropped
  // module tag reads the same as a game that never touched platforms.
  function stateOf(state) {
    return (state && typeof state === 'object') ? state : null;
  }

  // --- Normalizers ---------------------------------------------------------

  // The platform speed in px per second: 0–1000, default 60 — a
  // platform that crosses a 200px gap in about three seconds. 0 parks
  // the platform (it stays a floor, it just never moves).
  function normalizeSpeed(v) {
    var n = saneNum(v, 60);
    if (n <= 0) return 0;
    if (n > 1000) return 1000;
    return n;
  }

  // The crumble delay in seconds: 0–30, default 0 (never crumbles).
  // 1 is a quick crumble — the floor gives way almost at once; 3 is
  // a generous crossing window.
  function normalizeCrumbleSeconds(v) {
    var n = saneNum(v, 0);
    if (n <= 0) return 0;
    if (n > 30) return 30;
    return n;
  }

  // The path mode: 'pingpong' (there and back, the classic moving
  // platform) or 'loop' (around and around). Anything else reads as
  // pingpong.
  function normalizeMode(v) {
    var m = String(v == null ? '' : v).trim().toLowerCase();
    return m === 'loop' ? 'loop' : 'pingpong';
  }

  // The waypoint list: finite {x, y} pairs only, capped at 16 points
  // (a path longer than that is a level-design smell, not a platform).
  // A non-array reads as empty; bad entries are dropped, never kept
  // as a hole the mover would trip over. Returns a fresh array.
  function normalizePoints(points) {
    if (!Array.isArray(points)) return [];
    var out = [];
    var i;
    for (i = 0; i < points.length && out.length < 16; i++) {
      var p = points[i];
      if (!p || typeof p !== 'object') continue;
      var x = saneNum(p.x, null);
      var y = saneNum(p.y, null);
      if (x == null || y == null) continue;
      out.push({ x: x, y: y });
    }
    return out;
  }

  // Repair an object's platform config in place (the editor and the
  // export normalizers both call this, so old projects and hostile
  // data read the same way in both runtimes). A non-object reads as
  // null; the caller keeps its own object. When `obj` is passed, the
  // one-way flag is merged across the two places it lives: the
  // platform config and the physics record the collision step reads.
  // Either side being on turns it on — a legacy one-way floor
  // adopted into a platform config keeps working — and both
  // checkboxes write both fields, so they never disagree after that.
  function normalizePlatformConfig(cfg, obj) {
    if (!cfg || typeof cfg !== 'object') return null;
    cfg.enabled = cfg.enabled === true;
    cfg.points = normalizePoints(cfg.points);
    cfg.speed = normalizeSpeed(cfg.speed);
    cfg.mode = normalizeMode(cfg.mode);
    cfg.oneWay = cfg.oneWay === true;
    cfg.crumbleSeconds = normalizeCrumbleSeconds(cfg.crumbleSeconds);
    if (obj && typeof obj === 'object' && obj.collision && typeof obj.collision === 'object') {
      var oneWay = cfg.oneWay || obj.collision.oneWay === true;
      cfg.oneWay = oneWay;
      obj.collision.oneWay = oneWay;
    }
    return cfg;
  }

  // The platform config for an object, as a fresh normalized copy —
  // never the live record, so callers cannot mutate it. A missing
  // object or a missing config reads as the defaults (not a platform,
  // no points, 60 px/s, ping-pong, solid, never crumbles). Never
  // throws.
  function platformConfigOf(obj) {
    try {
      var cfg = (obj && typeof obj === 'object' && obj.platform &&
        typeof obj.platform === 'object') ? obj.platform : null;
      if (!cfg) return { enabled: false, points: [], speed: 60, mode: 'pingpong', oneWay: false, crumbleSeconds: 0 };
      return {
        enabled: cfg.enabled === true,
        points: normalizePoints(cfg.points),
        speed: normalizeSpeed(cfg.speed),
        mode: normalizeMode(cfg.mode),
        oneWay: cfg.oneWay === true,
        crumbleSeconds: normalizeCrumbleSeconds(cfg.crumbleSeconds)
      };
    } catch (e) {
      return { enabled: false, points: [], speed: 60, mode: 'pingpong', oneWay: false, crumbleSeconds: 0 };
    }
  }

  // True when the object is a moving platform right now: enabled,
  // at least two waypoints, and a speed above zero. A parked platform
  // (speed 0) or a one-point path is still a floor — it just never
  // moves, and nothing rides it.
  function isMovingPlatform(obj) {
    try {
      var cfg = platformConfigOf(obj);
      return cfg.enabled && cfg.points.length >= 2 && cfg.speed > 0;
    } catch (e) {
      return false;
    }
  }

  // True when the object is a one-way platform: its platform config
  // says so, or the physics record says so (a plain static floor with
  // the Collision section's One-way box ticked is a one-way platform
  // too — the Standing On One-Way condition reads both).
  function isOneWayPlatform(obj) {
    try {
      if (!obj || typeof obj !== 'object') return false;
      if (obj.platform && typeof obj.platform === 'object' && obj.platform.oneWay === true) return true;
      return !!(obj.collision && typeof obj.collision === 'object' && obj.collision.oneWay === true);
    } catch (e) {
      return false;
    }
  }

  // --- State ---------------------------------------------------------------

  // A fresh transient platform state for a scene: one per-platform
  // record, keyed by object id. The hosts mint one per scene load
  // (via the scene-reset hook), so a platform's position on its path
  // and a crumble timer never leak into the next level, and a fresh
  // run starts with every platform back at its first waypoint.
  function createPlatformState() {
    return { records: {} };
  }

  // The per-platform record for an object, created on demand when
  // `create` is true. A missing state or a missing id reads as null.
  // Never throws.
  function recordOf(state, obj, create) {
    try {
      var st = stateOf(state);
      if (!st || !obj || typeof obj !== 'object') return null;
      var id = obj.id;
      if (id == null) return null;
      if (!st.records || typeof st.records !== 'object') st.records = {};
      var rec = st.records[id] || null;
      if (!rec && create) {
        rec = { target: 1, dir: 1, crumbleAt: null, crumbled: false };
        st.records[id] = rec;
      }
      return rec;
    } catch (e) {
      return null;
    }
  }

  // --- Standing ------------------------------------------------------------

  // The hitbox of an object through the hooks, or the raw box when
  // the hook is missing or throws. Never throws.
  function boxOf(obj, hooks) {
    try {
      if (hooks && typeof hooks.hitbox === 'function') {
        var hb = hooks.hitbox(obj);
        if (hb && isFinite(Number(hb.x)) && isFinite(Number(hb.y)) &&
          isFinite(Number(hb.width)) && isFinite(Number(hb.height))) {
          return { x: Number(hb.x), y: Number(hb.y), width: Number(hb.width), height: Number(hb.height) };
        }
      }
    } catch (e) { /* fall through to the raw box */ }
    return {
      x: finiteNum(obj.posX, 0), y: finiteNum(obj.posY, 0),
      width: finiteNum(obj.width, 0), height: finiteNum(obj.height, 0)
    };
  }

  // True when the object can collide at all. A missing hook reads as
  // collidable (permissive degradation — the real hosts always pass
  // one); a throwing hook reads the same way.
  function collidesWith(hooks, obj) {
    try {
      if (hooks && typeof hooks.isCollision === 'function') return !!hooks.isCollision(obj);
    } catch (e) { /* fall through */ }
    return true;
  }

  // True when the floor is one-way for this standing check: the
  // hook knows (the hosts read the physics record), or the platform
  // config says so. A missing hook falls back to the config.
  function floorIsOneWay(hooks, floor) {
    try {
      if (hooks && typeof hooks.isOneWay === 'function') return !!hooks.isOneWay(floor);
    } catch (e) { /* fall through to the config */ }
    return isOneWayPlatform(floor);
  }

  // True while the object stands on the given platform: the bottom
  // edge within a few px of the platform's top, with horizontal
  // overlap (the movement module's grounded rule). A one-way platform
  // only counts while the object is falling or standing on it —
  // never while it rises through from below, or a jump up through
  // the platform would read as standing on it. A crumbled platform
  // never counts (its record says so, and its collision is off).
  // Never throws.
  function standsOn(obj, platform, state, hooks) {
    try {
      if (!obj || typeof obj !== 'object' || !platform || typeof platform !== 'object') return false;
      if (obj.id != null && platform.id != null && obj.id === platform.id) return false;
      if (!collidesWith(hooks, obj) || !collidesWith(hooks, platform)) return false;
      var rec = recordOf(stateOf(state), platform, false);
      if (rec && rec.crumbled) return false;
      var box = boxOf(obj, hooks);
      var floor = boxOf(platform, hooks);
      var bottom = box.y + box.height;
      var tolerance = Math.max(5, Math.abs(finiteNum(obj.velY, 0)) + 3);
      var horizontal = box.x < floor.x + floor.width - 1 && box.x + box.width > floor.x + 1;
      var vertical = bottom >= floor.y - tolerance && bottom <= floor.y + tolerance;
      if (!horizontal || !vertical) return false;
      if (floorIsOneWay(hooks, platform) && finiteNum(obj.velY, 0) < 0) return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  // The platform the object stands on, or null. With `oneWayOnly`
  // true, only one-way floors count (any one-way object, platform or
  // plain floor); otherwise only moving platforms count. A missing or
  // hostile hooks object reads as standing on nothing. Never throws.
  function platformUnder(state, obj, hooks, oneWayOnly) {
    try {
      if (!obj || typeof obj !== 'object' || !hooks || typeof hooks !== 'object') return null;
      var list = Array.isArray(hooks.objects) ? hooks.objects : [];
      var i, other;
      for (i = 0; i < list.length; i++) {
        other = list[i];
        if (!other || typeof other !== 'object') continue;
        if (oneWayOnly) {
          if (!floorIsOneWay(hooks, other)) continue;
        } else {
          if (!isMovingPlatform(other)) continue;
        }
        if (standsOn(obj, other, state, hooks)) return other;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  // --- Per-frame update ----------------------------------------------------

  // Move every platform one frame along its path, carry its riders,
  // and run the crumble timers. Runs after the physics step settled
  // this frame's positions and before the movement phase, so the
  // movement module's grounded check sees the rider on the platform's
  // new position and jumps refill there. Riders are found against the
  // platform's OLD position (where they actually stand), then moved
  // by the same step the platform took. Returns true when a state
  // existed, false when there was nothing to update. Never throws.
  function updatePlatforms(state, objects, now, dtSeconds, hooks) {
    try {
      var st = stateOf(state);
      if (!st) return false;
      var list = Array.isArray(objects) ? objects : [];
      var t = finiteNum(now, 0);
      var dt = finiteNum(dtSeconds, 0);
      if (dt < 0) dt = 0;
      if (!st.records || typeof st.records !== 'object') st.records = {};
      var byId = {};
      var i, j;
      for (i = 0; i < list.length; i++) {
        var o = list[i];
        if (o && typeof o === 'object' && o.id != null) byId[o.id] = o;
      }
      // Drop records for platforms that left the scene, so a fresh
      // scene never inherits a crumble timer from the last one.
      var ids = Object.keys(st.records);
      for (i = 0; i < ids.length; i++) {
        if (!byId[ids[i]]) delete st.records[ids[i]];
      }
      for (i = 0; i < list.length; i++) {
        var plat = list[i];
        if (!plat || typeof plat !== 'object' || plat.id == null) continue;
        var cfg = platformConfigOf(plat);
        // A platform is live when it moves (two or more waypoints
        // and a speed) or when it can crumble (a parked floor that
        // falls away after the player stands on it is a platform too).
        var moves = cfg.enabled && cfg.points.length >= 2 && cfg.speed > 0;
        var crumbles = cfg.enabled && cfg.crumbleSeconds > 0;
        if (!moves && !crumbles) continue;
        var rec = recordOf(st, plat, true);
        if (!rec || rec.crumbled) continue;
        var points = cfg.points;
        if (rec.target == null || rec.target < 0 || rec.target >= points.length) {
          rec.target = 1;
          rec.dir = 1;
        }
        if (rec.dir !== 1 && rec.dir !== -1) rec.dir = 1;
        // Riders first, against the platform's current position:
        // they stand on it now, before it moves.
        var riders = [];
        for (j = 0; j < list.length; j++) {
          var rider = list[j];
          if (!rider || typeof rider !== 'object' || rider.id === plat.id) continue;
          try { if (standsOn(rider, plat, st, hooks)) riders.push(rider); } catch (e) { /* a throwing standing check never breaks the frame */ }
        }
        // Step toward the target waypoint; snap and advance on
        // arrival. A zero dt holds the platform still (the first
        // frame), but the crumble timer below still runs on the
        // frozen clock.
        var oldX = finiteNum(plat.posX, 0);
        var oldY = finiteNum(plat.posY, 0);
        var newX = oldX, newY = oldY;
        if (moves && dt > 0 && cfg.speed > 0) {
          var target = points[rec.target];
          var dx = target.x - oldX, dy = target.y - oldY;
          var dist = Math.hypot(dx, dy);
          var step = cfg.speed * dt;
          if (dist <= step || dist === 0) {
            newX = target.x; newY = target.y;
            if (cfg.mode === 'loop') {
              rec.target = (rec.target + 1) % points.length;
            } else {
              var next = rec.target + rec.dir;
              if (next >= points.length || next < 0) {
                rec.dir = -rec.dir;
                next = rec.target + rec.dir;
              }
              rec.target = next;
            }
          } else {
            newX = oldX + (dx / dist) * step;
            newY = oldY + (dy / dist) * step;
          }
        }
        plat.posX = newX;
        plat.posY = newY;
        var dX = newX - oldX, dY = newY - oldY;
        for (j = 0; j < riders.length; j++) {
          var r = riders[j];
          r.posX = finiteNum(r.posX, 0) + dX;
          r.posY = finiteNum(r.posY, 0) + dY;
        }
        // Crumble: once a rider stands on the platform the timer
        // starts and runs to the end even if the rider steps off.
        // When it expires the platform stops being solid and is
        // hidden, so the rider drops through — and it stays gone
        // until the scene reloads (a fresh state mints fresh records).
        if (cfg.crumbleSeconds > 0) {
          if (riders.length > 0 && rec.crumbleAt == null) rec.crumbleAt = t + cfg.crumbleSeconds;
          if (rec.crumbleAt != null && t >= rec.crumbleAt) {
            rec.crumbled = true;
            try {
              if (plat.collision && typeof plat.collision === 'object') plat.collision.enabled = false;
            } catch (e) { /* a throwing collision write never breaks the frame */ }
            try {
              if (hooks && typeof hooks.hide === 'function') hooks.hide(plat);
            } catch (e) { /* a throwing hide never breaks the frame */ }
          }
        }
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  // --- Config writes -------------------------------------------------------

  // Give the object a two-point path at runtime and switch the
  // platform on: a switch that starts a platform moving is one block.
  // The first point is where the platform jumps to at once (set the
  // points to where it already is to start from there). Returns the
  // normalized points, or null for a non-object. Never throws.
  function setPlatformPath(obj, points, speed, mode) {
    try {
      if (!obj || typeof obj !== 'object') return null;
      if (!obj.platform || typeof obj.platform !== 'object') obj.platform = {};
      normalizePlatformConfig(obj.platform, obj);
      obj.platform.points = normalizePoints(points);
      obj.platform.speed = normalizeSpeed(speed);
      obj.platform.mode = normalizeMode(mode);
      obj.platform.enabled = true;
      return obj.platform.points.slice();
    } catch (e) {
      return null;
    }
  }

  // Switch the one-way flag at runtime, on the platform config and
  // on the physics record the collision step reads, so the two never
  // disagree. The panel hands a select value over as the string
  // 'true' / 'false', so both spellings count. Returns the flag
  // written, or null for a non-object. Never throws.
  function setOneWay(obj, on) {
    try {
      if (!obj || typeof obj !== 'object') return null;
      if (!obj.platform || typeof obj.platform !== 'object') obj.platform = {};
      normalizePlatformConfig(obj.platform, obj);
      var flag = on === true || on === 'true';
      obj.platform.oneWay = flag;
      if (!obj.collision || typeof obj.collision !== 'object') obj.collision = {};
      obj.collision.oneWay = flag;
      return flag;
    } catch (e) {
      return null;
    }
  }

  // Set the crumble delay at runtime: 0 never crumbles, anything
  // above 0 arms the timer the next time a rider stands on the
  // platform. Returns the normalized seconds, or null for a
  // non-object. Never throws.
  function setCrumbleTime(obj, seconds) {
    try {
      if (!obj || typeof obj !== 'object') return null;
      if (!obj.platform || typeof obj.platform !== 'object') obj.platform = {};
      normalizePlatformConfig(obj.platform, obj);
      obj.platform.crumbleSeconds = normalizeCrumbleSeconds(seconds);
      return obj.platform.crumbleSeconds;
    } catch (e) {
      return null;
    }
  }

  // --- Routing -------------------------------------------------------------

  function isPlatformAction(type) {
    return type === 'setPlatformPath' || type === 'setOneWay' ||
      type === 'setCrumbleTime';
  }

  function isPlatformCondition(type) {
    return type === 'standingOnPlatform' || type === 'standingOnOneWay';
  }

  return {
    normalizeSpeed: normalizeSpeed,
    normalizeCrumbleSeconds: normalizeCrumbleSeconds,
    normalizeMode: normalizeMode,
    normalizePoints: normalizePoints,
    normalizePlatformConfig: normalizePlatformConfig,
    platformConfigOf: platformConfigOf,
    isMovingPlatform: isMovingPlatform,
    isOneWayPlatform: isOneWayPlatform,
    createPlatformState: createPlatformState,
    recordOf: recordOf,
    standsOn: standsOn,
    platformUnder: platformUnder,
    updatePlatforms: updatePlatforms,
    setPlatformPath: setPlatformPath,
    setOneWay: setOneWay,
    setCrumbleTime: setCrumbleTime,
    isPlatformAction: isPlatformAction,
    isPlatformCondition: isPlatformCondition
  };
}

if (typeof window !== 'undefined') {
  window.HydraPlatform = hydraPlatformFactory();
  // Self-contained source of the factory, inlined into exported playable games
  // by HydraPlayer.buildPlayableHtml so exports run without editor files.
  window.HydraPlatform.factorySource = hydraPlatformFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraPlatformFactory;
