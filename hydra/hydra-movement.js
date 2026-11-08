/* ============================================================================
 * hydra-movement.js — HydraScript shared movement abilities (P4 Advanced
 * batch 26: double jump, coyote time, jump buffer & dash, beginner
 * edition; P4 Advanced batch 28: wall slide & wall jump, beginner
 * edition).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation
 * of how a platformer hero moves — used by:
 *   - the editor preview runtime (hydra-previewruntime.js delegates
 *     to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Idea (Unity character controllers / Godot platformer movement /
 * Celeste game feel, beginner edition): batch 21 gave every object hit
 * points and batch 25 gave the player a limited number of comebacks —
 * but the player still jumped the way the engine shipped: an Apply
 * Force preset or Set Velocity plus an On Floor gate the user wired by
 * hand, with no second jump, no grace after walking off a ledge, and
 * no dash at all. Movement abilities are the four classic platformer
 * verbs, as plain blocks:
 *
 *   jump — one block that does the right thing. On the ground it
 *     jumps (velY = -jumpSpeed). Just after walking off a ledge it
 *     still jumps, while the coyote window holds (the grace period
 *     every good platformer grants, so a jump pressed a frame late
 *     still counts). In the air it jumps again, up to Max jumps — 2
 *     is the classic double jump. A press that arrives with no jump
 *     left is remembered for the buffer window and fires the moment
 *     the object lands, so a jump pressed just before landing still
 *     counts. Jump speed is in the engine's velocity units (px per
 *     60fps frame): 12 is a solid platformer jump, near the -14 of
 *     the old jump-high Apply Force preset.
 *   dash — a fixed burst in one direction (left / right / up / down)
 *     at an exact speed in px per second, for a fixed duration, then
 *     a cooldown before the next one. The dash moves the object
 *     directly (pos += dir * speed * dt), so it is exact — gravity
 *     and friction cannot droop or decay it mid-burst — and the
 *     object's velocity is zeroed for the burst, so gravity resumes
 *     cleanly when it ends.
 *   wall slide — a hero pressing toward a solid wall while airborne
 *     and falling slides down it slowly instead of dropping: the
 *     fall speed is capped at the configured px/s while the press
 *     holds. Walls are solid objects (a one-way floor never blocks
 *     from the side, batch 27), and the press is the arrow keys or
 *     A / D. The slide needs no record of its own — it is a live
 *     geometric read, like the grounded check.
 *   wall jump — jumping while touching a wall pushes off it: up at
 *     the configured jump speed and away at the configured push.
 *     The Jump block performs it (no separate block): while the
 *     hero touches a wall, Jump wall-jumps instead of air-jumping.
 *     It costs one air jump, so Max jumps still bounds the climb,
 *     and one wall jump per wall until the hero lands or reaches
 *     another wall — the record remembers which wall it last jumped
 *     from, and landing clears it.
 *   the config — per object, authored on the object itself
 *     (obj.movement: maxJumps 1–10, coyoteSeconds 0–1, bufferSeconds
 *     0–1, wallSlideMaxFall 0–2000 px/s, wallJumpSpeed 0–100,
 *     wallJumpPush 0–100) with an Inspector Movement section; old
 *     objects default to a single jump with no coyote or buffer and
 *     no slide and no wall jump, which is exactly the old behavior.
 *     The Set Wall Slide / Set Wall Jump blocks rewrite that config
 *     at runtime (a power-up that grants wall climbing is two
 *     blocks).
 *   the runtime — per object, transient, keyed by object id: jumps
 *     used, the last time the object stood on the ground, a buffered
 *     press with its jump speed, and the dash state (direction,
 *     speed, end time, cooldown end). A new `updateMovement` frame
 *     phase refreshes it after the physics step: landing refills the
 *     jumps and fires a buffered press, a dash steps the object along
 *     and holds its velocity at zero. The state is fresh per scene
 *     load (via the scene-reset hook), never in project JSON or save
 *     slots.
 *
 * Grounded means standing on a solid object floor (the same
 * tolerance test the shared execute module's isObjectGrounded runs:
 * the bottom edge within a few px of a static floor's top, with
 * horizontal overlap and collision layers respected) OR standing on
 * a solid tilemap tile (the bottom-center pixel one below the feet
 * is solid, the standingOnTile rule) — so the moves work on tile
 * levels too, not just object floors. A one-way floor only counts
 * while the object falls or stands on it, never while it rises
 * through from below (P4 Advanced batch 27), so jumping up through
 * a one-way platform never grants a free ground jump.
 *
 * Time is the frozen game clock in seconds (the hosts pass
 * frozenNowMs() / 1000, so coyote / buffer / dash windows hold
 * while paused, and the frame phase only runs while unpaused).
 *
 * Nothing ever throws; hostile input degrades to safe defaults.
 *
 * Honest limits: one dash direction per Dash block (left / right /
 * up / down — no diagonal, no facing-relative dash); the dash moves
 * the object directly, so it can sit inside a thin wall for a frame
 * before the next physics step pushes it back out; jumps never
 * refill on an object that cannot be grounded (collision off) — use
 * Set Velocity for flying objects; walls are solid objects only —
 * tilemap walls do not slide or wall-jump yet; the slide reads the
 * arrow keys / A / D directly, not remapped action bindings; the
 * wall-jump push is a velocity set once, so if the game sets
 * horizontal velocity from held keys every frame, the push lasts
 * until the next frame's movement row — steer away from the wall
 * after jumping; pressing jump against the same wall again spends a
 * normal air jump if one is left, instead of pushing off twice;
 * no `hs` script-API surface yet.
 *
 * Load order (index.html): hydra-movement.js BEFORE player-runtime.js
 * and script.js. player-runtime.js throws a clear error if
 * HydraMovement is missing.
 * ========================================================================== */

function hydraMovementFactory() {
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

  function clampNum(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  // The state itself, or null for a missing / non-object state — the
  // callers below degrade quietly instead of throwing, so a dropped
  // module tag reads the same as a game that never touched movement.
  function stateOf(state) {
    return (state && typeof state === 'object') ? state : null;
  }

  // --- Normalizers ---------------------------------------------------------

  // How many jumps the object gets before it must land again: a
  // whole number 1–10, default 1 (a single jump — the old behavior).
  // 2 is the classic double jump.
  function normalizeMaxJumps(v) {
    var n = saneNum(v, 1);
    if (n <= 1) return 1;
    if (n > 10) return 10;
    return Math.floor(n);
  }

  // Coyote time: the grace window in seconds after walking off a
  // ledge during which a jump still counts as a ground jump.
  // 0–1, default 0 (no grace — the old behavior).
  function normalizeCoyoteSeconds(v) {
    var n = saneNum(v, 0);
    if (n <= 0) return 0;
    if (n > 1) return 1;
    return n;
  }

  // Jump buffer: the window in seconds a jump press is remembered
  // for when no jump is available, so it fires on landing. 0–1,
  // default 0 (no remembering — the old behavior).
  function normalizeBufferSeconds(v) {
    var n = saneNum(v, 0);
    if (n <= 0) return 0;
    if (n > 1) return 1;
    return n;
  }

  // The jump speed: the upward velocity in the engine's velocity
  // units (px per 60fps frame), 0–100, default 12 — a solid
  // platformer jump, near the -14 of the old jump-high preset.
  function normalizeJumpSpeed(v) {
    var n = saneNum(v, 12);
    if (n <= 0) return 0;
    if (n > 100) return 100;
    return n;
  }

  // The dash speed in px per second, 0–2000, default 400 — a burst
  // that crosses a 60px gap in about a tenth of a second.
  function normalizeDashSpeed(v) {
    var n = saneNum(v, 400);
    if (n <= 0) return 0;
    if (n > 2000) return 2000;
    return n;
  }

  // The dash duration in seconds, 0–2, default 0.15 — about nine
  // frames at 60fps, the classic snappy dash.
  function normalizeDashDuration(v) {
    var n = saneNum(v, 0.15);
    if (n <= 0) return 0;
    if (n > 2) return 2;
    return n;
  }

  // The dash cooldown in seconds, 0–10, default 0.5 — how long
  // after a dash ends before the next one can start.
  function normalizeDashCooldown(v) {
    var n = saneNum(v, 0.5);
    if (n <= 0) return 0;
    if (n > 10) return 10;
    return n;
  }

  // The wall-slide cap: the fastest the object may fall while
  // sliding down a wall, in px per second, 0–2000, default 0 (no
  // slide — the old behavior). 60 px/s is a slow slide: the cap in
  // the engine's velocity units (px per 60fps frame) is the px/s
  // value over 60, so 60 caps the fall at 1 px per frame.
  function normalizeWallSlideMaxFall(v) {
    var n = saneNum(v, 0);
    if (n <= 0) return 0;
    if (n > 2000) return 2000;
    return n;
  }

  // The wall-jump speed: the upward velocity in the engine's
  // velocity units (px per 60fps frame), 0–100, default 0 (no wall
  // jump — the old behavior). 12 matches the Jump block's default.
  function normalizeWallJumpSpeed(v) {
    var n = saneNum(v, 0);
    if (n <= 0) return 0;
    if (n > 100) return 100;
    return n;
  }

  // The wall-jump push: the sideways velocity away from the wall in
  // the engine's velocity units, 0–100, default 8 — a clear outward
  // arc without throwing the hero across the room.
  function normalizeWallJumpPush(v) {
    var n = saneNum(v, 8);
    if (n <= 0) return 0;
    if (n > 100) return 100;
    return n;
  }

  // Repair an object's movement config in place (the editor and the
  // export normalizers both call this, so old projects and hostile
  // data read the same way in both runtimes). A non-object reads as
  // null; the caller keeps its own object.
  function normalizeMovementConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return null;
    cfg.maxJumps = normalizeMaxJumps(cfg.maxJumps);
    cfg.coyoteSeconds = normalizeCoyoteSeconds(cfg.coyoteSeconds);
    cfg.bufferSeconds = normalizeBufferSeconds(cfg.bufferSeconds);
    cfg.wallSlideMaxFall = normalizeWallSlideMaxFall(cfg.wallSlideMaxFall);
    cfg.wallJumpSpeed = normalizeWallJumpSpeed(cfg.wallJumpSpeed);
    cfg.wallJumpPush = normalizeWallJumpPush(cfg.wallJumpPush);
    return cfg;
  }

  // The movement config for an object, as a fresh normalized copy —
  // never the live record, so callers cannot mutate it. A missing
  // object or a missing config reads as the defaults (one jump, no
  // coyote, no buffer, no slide, no wall jump). Never throws.
  function movementConfigOf(obj) {
    try {
      var cfg = (obj && typeof obj === 'object' && obj.movement &&
        typeof obj.movement === 'object') ? obj.movement : null;
      if (!cfg) return { maxJumps: 1, coyoteSeconds: 0, bufferSeconds: 0, wallSlideMaxFall: 0, wallJumpSpeed: 0, wallJumpPush: 8 };
      return {
        maxJumps: normalizeMaxJumps(cfg.maxJumps),
        coyoteSeconds: normalizeCoyoteSeconds(cfg.coyoteSeconds),
        bufferSeconds: normalizeBufferSeconds(cfg.bufferSeconds),
        wallSlideMaxFall: normalizeWallSlideMaxFall(cfg.wallSlideMaxFall),
        wallJumpSpeed: normalizeWallJumpSpeed(cfg.wallJumpSpeed),
        wallJumpPush: normalizeWallJumpPush(cfg.wallJumpPush)
      };
    } catch (e) {
      return { maxJumps: 1, coyoteSeconds: 0, bufferSeconds: 0, wallSlideMaxFall: 0, wallJumpSpeed: 0, wallJumpPush: 8 };
    }
  }

  // --- State ---------------------------------------------------------------

  // A fresh transient movement state for a scene: one per-object
  // record, keyed by object id. The hosts mint one per scene load
  // (via the scene-reset hook), so a dash or a buffered jump never
  // leaks into the next level, and a fresh run starts clean.
  function createMovementState() {
    return { records: {} };
  }

  // The per-object record for an object, created on demand when
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
        rec = {
          jumpsUsed: 0,
          lastGroundedAt: null,
          bufferedAt: null,
          bufferedJumpSpeed: 12,
          dashDirX: 0,
          dashDirY: 0,
          dashSpeed: 0,
          dashUntil: 0,
          dashCooldownUntil: 0,
          // The side of the wall the object last wall-jumped from
          // ('left' | 'right' | null) — one wall jump per wall until
          // the hero lands or reaches another wall (P4 Advanced
          // batch 28). Landing clears it in updateMovement.
          lastWallSide: null
        };
        st.records[id] = rec;
      }
      return rec;
    } catch (e) {
      return null;
    }
  }

  // --- Grounded ------------------------------------------------------------

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

  // True when two objects may collide (layers / masks). A missing
  // hook reads as collidable; a throwing hook reads the same way.
  function mayCollide(hooks, a, b) {
    try {
      if (hooks && typeof hooks.canCollide === 'function') return !!hooks.canCollide(a, b);
    } catch (e) { /* fall through */ }
    return true;
  }

  // True when the floor is one-way. The hook knows (the hosts read
  // the physics record); without it, the platform config or the
  // physics record is the fallback. A missing or throwing hook reads
  // as a solid floor. (P4 Advanced batch 27: one-way platforms.)
  function isOneWayFloor(hooks, obj) {
    try {
      if (hooks && typeof hooks.isOneWay === 'function') return !!hooks.isOneWay(obj);
    } catch (e) { /* fall through to the config */ }
    try {
      return !!(obj && ((obj.platform && obj.platform.oneWay === true) ||
        (obj.collision && obj.collision.oneWay === true)));
    } catch (e) { return false; }
  }

  // True while the object stands on something: a solid object floor
  // (the shared execute module's isObjectGrounded rule — the bottom
  // edge within a few px of a static floor's top, with horizontal
  // overlap) or a solid tilemap tile (the bottom-center pixel one
  // below the feet is solid, the standingOnTile rule). A missing or
  // hostile hooks object reads as not grounded. Never throws.
  function isGrounded(obj, hooks) {
    try {
      if (!obj || typeof obj !== 'object' || !hooks || typeof hooks !== 'object') return false;
      if (!collidesWith(hooks, obj)) return false;
      var box = boxOf(obj, hooks);
      var bottom = box.y + box.height;
      var tolerance = Math.max(5, Math.abs(finiteNum(obj.velY, 0)) + 3);
      var list = Array.isArray(hooks.objects) ? hooks.objects : [];
      var i, other, floor;
      for (i = 0; i < list.length; i++) {
        other = list[i];
        if (!other || other.id === obj.id || !collidesWith(hooks, other)) continue;
        if (!(other.static || !other.physicsEnabled)) continue;
        if (!mayCollide(hooks, obj, other)) continue;
        // One-way floors only count while the object falls or stands
        // on them — never while it rises through from below (P4
        // Advanced batch 27), or jumping up through a one-way
        // platform would grant a free ground jump.
        if (isOneWayFloor(hooks, other) && finiteNum(obj.velY, 0) < 0) continue;
        floor = boxOf(other, hooks);
        var horizontal = box.x < floor.x + floor.width - 1 && box.x + box.width > floor.x + 1;
        var vertical = bottom >= floor.y - tolerance && bottom <= floor.y + tolerance;
        if (horizontal && vertical) return true;
      }
      // Tile floors: the bottom-center pixel one below the feet.
      var tiles = hooks.tiles || null;
      if (tiles && typeof tiles.isSolidAtPixel === 'function') {
        for (i = 0; i < list.length; i++) {
          var tm = list[i];
          if (!tm || tm.kind !== 'tilemap') continue;
          try {
            if (tiles.isSolidAtPixel(tm, box.x + box.width / 2, box.y + box.height + 1)) return true;
          } catch (e) { /* a throwing tile read is not a floor */ }
        }
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  // --- Walls (P4 Advanced batch 28) --------------------------------------

  // The horizontal input direction: -1 while the player presses
  // left (ArrowLeft or A), 1 while pressing right (ArrowRight or
  // D), 0 otherwise (both or neither). The hosts pass the held-key
  // set plus the canonical alias-aware lookup; a missing keys set
  // reads as no press, so a host that never wires input never
  // slides. Never throws.
  function inputDirX(hooks) {
    try {
      if (!hooks || typeof hooks !== 'object' || !hooks.keys) return 0;
      var has = null;
      if (typeof hooks.hasKey === 'function') has = hooks.hasKey;
      else if (hooks.keys && typeof hooks.keys.has === 'function') {
        has = function (set, k) { try { return set.has(k); } catch (e) { return false; } };
      }
      if (!has) return 0;
      var left = false, right = false;
      try { left = !!(has(hooks.keys, 'ArrowLeft') || has(hooks.keys, 'KeyA')); } catch (e) { left = false; }
      try { right = !!(has(hooks.keys, 'ArrowRight') || has(hooks.keys, 'KeyD')); } catch (e) { right = false; }
      return (right ? 1 : 0) - (left ? 1 : 0);
    } catch (e) {
      return 0;
    }
  }

  // The sides of the solid walls the object touches right now:
  // 'left' when a solid object stands immediately to the object's
  // left (the object's left edge within tolerance of the wall's
  // right edge), 'right' for the mirror case. The rule is the
  // grounded check turned sideways: a side edge within a few px of
  // a static floor's side, with vertical overlap and collision
  // layers respected. A floor underfoot never counts (its top sits
  // at the hero's bottom, outside the vertical overlap), a one-way
  // floor never blocks from the side (batch 27), and tilemap walls
  // do not count yet. A missing or hostile hooks object reads as no
  // walls. Never throws.
  function wallSides(obj, hooks) {
    try {
      if (!obj || typeof obj !== 'object' || !hooks || typeof hooks !== 'object') return [];
      if (!collidesWith(hooks, obj)) return [];
      var box = boxOf(obj, hooks);
      var tolerance = Math.max(5, Math.abs(finiteNum(obj.velX, 0)) + 3);
      var list = Array.isArray(hooks.objects) ? hooks.objects : [];
      var sides = [];
      var i, other, wall;
      for (i = 0; i < list.length; i++) {
        other = list[i];
        if (!other || other.id === obj.id || !collidesWith(hooks, other)) continue;
        if (!(other.static || !other.physicsEnabled)) continue;
        if (!mayCollide(hooks, obj, other)) continue;
        if (isOneWayFloor(hooks, other)) continue;
        wall = boxOf(other, hooks);
        var vertical = box.y < wall.y + wall.height - 1 && box.y + box.height > wall.y + 1;
        if (!vertical) continue;
        if (Math.abs(box.x - (wall.x + wall.width)) <= tolerance) {
          if (sides.indexOf('left') === -1) sides.push('left');
        }
        if (Math.abs((box.x + box.width) - wall.x) <= tolerance) {
          if (sides.indexOf('right') === -1) sides.push('right');
        }
      }
      return sides;
    } catch (e) {
      return [];
    }
  }

  // The first wall side the object touches, or null when it touches
  // none. Never throws.
  function touchingWall(obj, hooks) {
    try {
      var sides = wallSides(obj, hooks);
      return sides.length ? sides[0] : null;
    } catch (e) {
      return null;
    }
  }

  // Which wall to jump from: the wall the player presses toward
  // when both sides touch (a narrow shaft), else the only wall
  // touched, else null. Never throws.
  function jumpWallSide(obj, hooks) {
    try {
      var sides = wallSides(obj, hooks);
      if (!sides.length) return null;
      var dir = inputDirX(hooks);
      if (dir < 0 && sides.indexOf('left') !== -1) return 'left';
      if (dir > 0 && sides.indexOf('right') !== -1) return 'right';
      return sides[0];
    } catch (e) {
      return null;
    }
  }

  // True while the object slides down a wall: the slide is
  // configured, the object falls (velY > 0) without standing on
  // anything, it touches a solid wall, and the player keeps
  // pressing toward that wall. A live geometric read — no record
  // needed. Never throws.
  function isWallSliding(obj, hooks) {
    try {
      if (!obj || typeof obj !== 'object') return false;
      var cfg = movementConfigOf(obj);
      if (cfg.wallSlideMaxFall <= 0) return false;
      if (finiteNum(obj.velY, 0) <= 0) return false;
      var grounded = false;
      try { grounded = isGrounded(obj, hooks); } catch (e) { grounded = false; }
      if (grounded) return false;
      var sides = wallSides(obj, hooks);
      if (!sides.length) return false;
      var dir = inputDirX(hooks);
      if (dir < 0 && sides.indexOf('left') !== -1) return true;
      if (dir > 0 && sides.indexOf('right') !== -1) return true;
      return false;
    } catch (e) {
      return false;
    }
  }

  // Push off the wall the object touches: up at the configured
  // jump speed, away at the configured push. Costs one air jump,
  // so Max jumps still bounds the climb, and one wall jump per wall
  // until the hero lands or reaches another wall. Returns 'wall'
  // when the jump happened, null when there is no state, no wall
  // jump configured, no wall touched, no jump left, or the same
  // wall again. Never throws.
  function tryWallJump(state, obj, now, hooks) {
    try {
      var st = stateOf(state);
      if (!st || !obj || typeof obj !== 'object') return null;
      var cfg = movementConfigOf(obj);
      if (cfg.wallJumpSpeed <= 0) return null;
      var rec = recordOf(st, obj, true);
      if (!rec) return null;
      if (rec.jumpsUsed >= cfg.maxJumps) return null;
      var side = jumpWallSide(obj, hooks);
      if (!side) return null;
      if (rec.lastWallSide === side) return null;
      obj.velY = -normalizeWallJumpSpeed(cfg.wallJumpSpeed);
      obj.velX = (side === 'left' ? 1 : -1) * normalizeWallJumpPush(cfg.wallJumpPush);
      rec.jumpsUsed += 1;
      rec.lastWallSide = side;
      rec.bufferedAt = null;
      return 'wall';
    } catch (e) {
      return null;
    }
  }

  // --- Jumps ---------------------------------------------------------------

  // Try to jump: ground jump, coyote jump, wall jump, or an air
  // jump up to Max jumps — or remember the press for the buffer
  // window when nothing is left. Sets velY on the object (and velX
  // for a wall jump, away from the wall) and updates its record.
  // Returns 'ground' | 'coyote' | 'wall' | 'air' | 'buffered', or
  // null when there is no state or no object to jump. Never throws.
  function tryJump(state, obj, jumpSpeed, now, hooks) {
    try {
      var st = stateOf(state);
      if (!st || !obj || typeof obj !== 'object') return null;
      var cfg = movementConfigOf(obj);
      var rec = recordOf(st, obj, true);
      if (!rec) return null;
      var speed = normalizeJumpSpeed(jumpSpeed);
      var t = finiteNum(now, 0);
      var grounded = false;
      try { grounded = isGrounded(obj, hooks); } catch (e) { grounded = false; }
      if (grounded) {
        obj.velY = -speed;
        rec.jumpsUsed = 1;
        rec.lastGroundedAt = t;
        rec.bufferedAt = null;
        return 'ground';
      }
      if (cfg.coyoteSeconds > 0 && rec.jumpsUsed === 0 && rec.lastGroundedAt != null &&
        t - rec.lastGroundedAt <= cfg.coyoteSeconds) {
        // Coyote time is the grace for leaving the ground WITHOUT
        // jumping (walked off a ledge): once a jump is spent, the
        // next press is the air jump, or the player would get a free
        // refresh — ground jump, coyote refresh, air jump is three
        // boosts on two jumps.
        obj.velY = -speed;
        rec.jumpsUsed = 1;
        rec.lastGroundedAt = null;
        rec.bufferedAt = null;
        return 'coyote';
      }
      // Wall jump (P4 Advanced batch 28): touching a wall, the wall
      // jump configured, a jump left, and a wall the hero has not
      // already jumped from since landing. It runs before the air
      // jump, so Jump pushes off the wall instead of jumping straight
      // up beside it; when it refuses (same wall again), the air
      // jump below still fires if one is left.
      var wall = null;
      try { wall = tryWallJump(st, obj, t, hooks); } catch (e) { wall = null; }
      if (wall) return wall;
      if (rec.jumpsUsed < cfg.maxJumps) {
        obj.velY = -speed;
        rec.jumpsUsed += 1;
        return 'air';
      }
      rec.bufferedAt = t;
      rec.bufferedJumpSpeed = speed;
      return 'buffered';
    } catch (e) {
      return null;
    }
  }

  // --- Dash ----------------------------------------------------------------

  // Start a dash: a fixed burst in one direction at an exact speed.
  // Returns true when the dash started, false when the object is
  // already dashing, still cooling down, or the burst is empty (a
  // zero speed or duration). The velocity is zeroed at once, so no
  // old momentum stacks onto the burst. Never throws.
  function startDash(state, obj, dirX, dirY, speed, duration, cooldown, now) {
    try {
      var st = stateOf(state);
      if (!st || !obj || typeof obj !== 'object') return false;
      var rec = recordOf(st, obj, true);
      if (!rec) return false;
      var t = finiteNum(now, 0);
      if (t < rec.dashUntil) return false;
      if (t < rec.dashCooldownUntil) return false;
      var sp = normalizeDashSpeed(speed);
      var dur = normalizeDashDuration(duration);
      var cd = normalizeDashCooldown(cooldown);
      if (sp <= 0 || dur <= 0) return false;
      var dx = finiteNum(dirX, 0), dy = finiteNum(dirY, 0);
      var len = Math.hypot(dx, dy);
      if (!isFinite(len) || len === 0) { dx = 1; dy = 0; len = 1; }
      rec.dashDirX = dx / len;
      rec.dashDirY = dy / len;
      rec.dashSpeed = sp;
      rec.dashUntil = t + dur;
      rec.dashCooldownUntil = t + dur + cd;
      obj.velX = 0;
      obj.velY = 0;
      return true;
    } catch (e) {
      return false;
    }
  }

  // True while the object is mid-dash at time `now` (frozen-clock
  // seconds). A missing state or record reads as not dashing. Never
  // throws.
  function isDashing(state, obj, now) {
    try {
      var rec = recordOf(stateOf(state), obj, false);
      if (!rec) return false;
      return finiteNum(now, 0) < rec.dashUntil;
    } catch (e) {
      return false;
    }
  }

  // True when a dash could start right now: not mid-dash and past
  // the cooldown. A missing state or record reads as ready (an
  // object that never dashed has nothing cooling down). Never throws.
  function canDash(state, obj, now) {
    try {
      var rec = recordOf(stateOf(state), obj, false);
      if (!rec) return true;
      var t = finiteNum(now, 0);
      return t >= rec.dashUntil && t >= rec.dashCooldownUntil;
    } catch (e) {
      return true;
    }
  }

  // --- Per-frame update ----------------------------------------------------

  // Refresh every moving object for one frame: a dash steps the
  // object along its burst and holds its velocity at zero (so
  // gravity cannot droop it); landing refills the jumps, clears the
  // wall-jump memory, and fires a buffered press; a wall slide caps
  // the fall while the object presses toward a wall it touches;
  // records for objects that left the scene are dropped. Runs after
  // the physics step (the last world-sim phase), so grounded reads
  // the positions physics just settled and a buffered jump lands the
  // frame after the object does. Returns true when a state existed,
  // false when there was nothing to update. Never throws.
  function updateMovement(state, objects, now, dtSeconds, hooks) {
    try {
      var st = stateOf(state);
      if (!st) return false;
      var list = Array.isArray(objects) ? objects : [];
      var t = finiteNum(now, 0);
      var dt = finiteNum(dtSeconds, 0);
      if (dt < 0) dt = 0;
      if (!st.records || typeof st.records !== 'object') st.records = {};
      var byId = {};
      var i;
      for (i = 0; i < list.length; i++) {
        var o = list[i];
        if (o && typeof o === 'object' && o.id != null) byId[o.id] = o;
      }
      // Mint a record for each object standing on the floor, so the
      // last-grounded time is tracked even for a hero that never
      // jumped: without it, walking off a ledge could never grant a
      // coyote jump, because no record would exist to hold the time
      // it left the ground. (Only grounded objects mint: an object
      // that spawns mid-air gets its record on its first landing, and
      // a fresh scene still reads as an empty movement state.)
      for (i = 0; i < list.length; i++) {
        var mo = list[i];
        if (!mo || typeof mo !== 'object' || mo.id == null) continue;
        try { if (isGrounded(mo, hooks)) recordOf(st, mo, true); } catch (e) { /* a throwing grounded read never breaks the frame */ }
      }
      var ids = Object.keys(st.records);
      for (i = 0; i < ids.length; i++) {
        var id = ids[i];
        var obj = byId[id] || null;
        var rec = st.records[id];
        if (!obj || !rec || typeof rec !== 'object') { delete st.records[id]; continue; }
        var cfg = movementConfigOf(obj);
        var dashing = t < rec.dashUntil;
        if (dashing) {
          if (dt > 0 && rec.dashSpeed > 0) {
            obj.posX = finiteNum(obj.posX, 0) + rec.dashDirX * rec.dashSpeed * dt;
            obj.posY = finiteNum(obj.posY, 0) + rec.dashDirY * rec.dashSpeed * dt;
          }
          obj.velX = 0;
          obj.velY = 0;
        } else if (rec.dashUntil) {
          // The burst ended: clear the dash fields so the next
          // frame's physics and jumps read a clean record.
          rec.dashDirX = 0; rec.dashDirY = 0; rec.dashSpeed = 0;
          rec.dashUntil = 0;
        }
        var grounded = false;
        try { grounded = isGrounded(obj, hooks); } catch (e) { grounded = false; }
        // A rising hero is still inside the grounded tolerance for a
        // frame or two after takeoff (the tolerance grows with |velY|),
        // but it already left the floor: refilling here would refund
        // the jump it just spent, and firing a buffered press here
        // would double-jump mid-rise. Only a hero standing on the
        // floor or falling onto it counts as landed.
        if (grounded && finiteNum(obj.velY, 0) >= 0) {
          rec.jumpsUsed = 0;
          rec.lastGroundedAt = t;
          // Landing clears the wall-jump memory: the next wall is a
          // fresh wall, so the hero can wall-jump from it again
          // (P4 Advanced batch 28).
          rec.lastWallSide = null;
          if (rec.bufferedAt != null && cfg.bufferSeconds > 0 &&
            t - rec.bufferedAt <= cfg.bufferSeconds) {
            obj.velY = -normalizeJumpSpeed(rec.bufferedJumpSpeed);
            rec.jumpsUsed = 1;
            rec.bufferedAt = null;
          }
        }
      }
      // Wall slide (P4 Advanced batch 28): a live geometric read,
      // not a record read — a hero dropped into a shaft at scene
      // start slides on its first frame, before it ever jumps or
      // lands. Airborne, falling, pressing toward a wall the object
      // touches: cap the fall at the configured px/s (over 60, into
      // the engine's velocity units), so the hero slides down slowly
      // instead of dropping. Gravity keeps adding each frame, so the
      // cap is re-applied every frame and the fall holds at the slide
      // speed. A dashing object never reaches this (its velY is held
      // at zero), and a grounded object never reaches it either (the
      // landing branch above refilled it first).
      for (i = 0; i < list.length; i++) {
        var so = list[i];
        if (!so || typeof so !== 'object') continue;
        var scfg = movementConfigOf(so);
        if (scfg.wallSlideMaxFall <= 0) continue;
        if (finiteNum(so.velY, 0) <= 0) continue;
        var sgrounded = false;
        try { sgrounded = isGrounded(so, hooks); } catch (e) { sgrounded = false; }
        if (sgrounded) continue;
        var scap = scfg.wallSlideMaxFall / 60;
        var ssides = [];
        try { ssides = wallSides(so, hooks); } catch (e) { ssides = []; }
        if (!ssides.length) continue;
        var sdir = 0;
        try { sdir = inputDirX(hooks); } catch (e) { sdir = 0; }
        if ((sdir < 0 && ssides.indexOf('left') !== -1) ||
          (sdir > 0 && ssides.indexOf('right') !== -1)) {
          if (finiteNum(so.velY, 0) > scap) so.velY = scap;
        }
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  // --- Reads ---------------------------------------------------------------

  // How many jumps the object has left before it must land again:
  // Max jumps minus the jumps used since the last landing. A missing
  // state or record reads as the full count (an object that never
  // jumped has all of them). Never throws.
  function jumpsLeft(state, obj) {
    try {
      var cfg = movementConfigOf(obj);
      var rec = recordOf(stateOf(state), obj, false);
      var used = rec ? finiteNum(rec.jumpsUsed, 0) : 0;
      var left = cfg.maxJumps - used;
      return left < 0 ? 0 : Math.floor(left);
    } catch (e) {
      return 1;
    }
  }

  // --- Config writes -------------------------------------------------------

  // Rewrite the object's authored movement config at runtime (a
  // power-up that grants a double jump is one block). Returns the
  // normalized value written, or null for a non-object. Never throws.
  function setMaxJumps(obj, v) {
    try {
      if (!obj || typeof obj !== 'object') return null;
      if (!obj.movement || typeof obj.movement !== 'object') obj.movement = {};
      normalizeMovementConfig(obj.movement);
      obj.movement.maxJumps = normalizeMaxJumps(v);
      return obj.movement.maxJumps;
    } catch (e) {
      return null;
    }
  }

  function setCoyoteTime(obj, v) {
    try {
      if (!obj || typeof obj !== 'object') return null;
      if (!obj.movement || typeof obj.movement !== 'object') obj.movement = {};
      normalizeMovementConfig(obj.movement);
      obj.movement.coyoteSeconds = normalizeCoyoteSeconds(v);
      return obj.movement.coyoteSeconds;
    } catch (e) {
      return null;
    }
  }

  function setJumpBuffer(obj, v) {
    try {
      if (!obj || typeof obj !== 'object') return null;
      if (!obj.movement || typeof obj.movement !== 'object') obj.movement = {};
      normalizeMovementConfig(obj.movement);
      obj.movement.bufferSeconds = normalizeBufferSeconds(v);
      return obj.movement.bufferSeconds;
    } catch (e) {
      return null;
    }
  }

  // Rewrite the object's wall-slide cap at runtime (a power-up that
  // grants wall climbing is one block; 0 turns the slide off).
  // Returns the normalized value written, or null for a non-object.
  // Never throws.
  function setWallSlide(obj, v) {
    try {
      if (!obj || typeof obj !== 'object') return null;
      if (!obj.movement || typeof obj.movement !== 'object') obj.movement = {};
      normalizeMovementConfig(obj.movement);
      obj.movement.wallSlideMaxFall = normalizeWallSlideMaxFall(v);
      return obj.movement.wallSlideMaxFall;
    } catch (e) {
      return null;
    }
  }

  // Rewrite the object's wall-jump speeds at runtime. Returns the
  // normalized pair written, or null for a non-object. Never throws.
  function setWallJump(obj, speed, push) {
    try {
      if (!obj || typeof obj !== 'object') return null;
      if (!obj.movement || typeof obj.movement !== 'object') obj.movement = {};
      normalizeMovementConfig(obj.movement);
      obj.movement.wallJumpSpeed = normalizeWallJumpSpeed(speed);
      obj.movement.wallJumpPush = normalizeWallJumpPush(push);
      return { wallJumpSpeed: obj.movement.wallJumpSpeed, wallJumpPush: obj.movement.wallJumpPush };
    } catch (e) {
      return null;
    }
  }

  // --- Routing -------------------------------------------------------------

  function isMovementAction(type) {
    return type === 'jump' || type === 'dash' ||
      type === 'setMaxJumps' || type === 'setCoyoteTime' ||
      type === 'setJumpBuffer' || type === 'setWallSlide' ||
      type === 'setWallJump';
  }

  function isMovementCondition(type) {
    return type === 'jumpsLeft' || type === 'isDashing' ||
      type === 'wallSliding';
  }

  return {
    normalizeMaxJumps: normalizeMaxJumps,
    normalizeCoyoteSeconds: normalizeCoyoteSeconds,
    normalizeBufferSeconds: normalizeBufferSeconds,
    normalizeJumpSpeed: normalizeJumpSpeed,
    normalizeDashSpeed: normalizeDashSpeed,
    normalizeDashDuration: normalizeDashDuration,
    normalizeDashCooldown: normalizeDashCooldown,
    normalizeWallSlideMaxFall: normalizeWallSlideMaxFall,
    normalizeWallJumpSpeed: normalizeWallJumpSpeed,
    normalizeWallJumpPush: normalizeWallJumpPush,
    normalizeMovementConfig: normalizeMovementConfig,
    movementConfigOf: movementConfigOf,
    createMovementState: createMovementState,
    recordOf: recordOf,
    isGrounded: isGrounded,
    wallSides: wallSides,
    touchingWall: touchingWall,
    inputDirX: inputDirX,
    isWallSliding: isWallSliding,
    tryWallJump: tryWallJump,
    tryJump: tryJump,
    startDash: startDash,
    isDashing: isDashing,
    canDash: canDash,
    updateMovement: updateMovement,
    jumpsLeft: jumpsLeft,
    setMaxJumps: setMaxJumps,
    setCoyoteTime: setCoyoteTime,
    setJumpBuffer: setJumpBuffer,
    setWallSlide: setWallSlide,
    setWallJump: setWallJump,
    isMovementAction: isMovementAction,
    isMovementCondition: isMovementCondition
  };
}

if (typeof window !== 'undefined') {
  window.HydraMovement = hydraMovementFactory();
  // Self-contained source of the factory, inlined into exported playable games
  // by HydraPlayer.buildPlayableHtml so exports run without editor files.
  window.HydraMovement.factorySource = hydraMovementFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraMovementFactory;
