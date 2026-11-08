/* ============================================================================
 * hydra-physicsstep.js — HydraScript shared per-frame 2D physics step
 * (P2 item 15/12, slice 4: the shared-engine extraction continues here).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation of
 * one frame of the 2D physics system — velocity integration, object-vs-
 * object collision resolution, and tilemap collision — used by:
 *   - the editor preview runtime (hydra-previewruntime.js gameLoop delegates to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Why this slice fourth: the two runtimes ran the same three passes with
 * the same subsystem calls, but "the same" hid two real divergences in the
 * integration loop, and the collision passes were ~90 lines of near-
 * identical code each. The step itself is now shared code; each host only
 * supplies its small readers as hooks (getPhysics, hitbox, the collision-
 * object predicate, the 3D-kind checks, the HydraPhysics2D / HydraTiles
 * subsystem modules, and the previous frame's trigger pairs).
 *
 * One step, in order (the export's order, which is the reference):
 *   1. integrate — snapshot _prevX/_prevY for every live object, then
 *      integrate the physics bodies (gravity, friction, max-speed clamp,
 *      position advance) and glide every other non-text, non-static
 *      object along its velocity (position advance only — no gravity,
 *      no friction, no clamp).
 *   2. resolveObjectCollisions — split the live objects into statics and
 *      dynamics (via the host's isCollisionObject), compute trigger
 *      contacts + enter/exit edges, then resolve every dynamic against
 *      every solid through HydraPhysics2D.resolvePair.
 *   3. resolveTileCollisions — resolve every dynamic against the solid
 *      tiles of every tilemap through HydraTiles.resolveTileCollision.
 *
 * Hooks (all optional except where noted):
 *   - getPhysics(obj) -> { gravity, friction, bounciness, maxSpeed }.
 *     Without one the module reads obj.physics directly with the same
 *     defaults. A throwing reader degrades to those defaults.
 *   - hitbox(obj) -> { x, y, width, height }. Without one the module
 *     computes the canonical shape itself (pos + offset, hitbox size else
 *     object size) — the same math both hosts' hitbox helpers use.
 *   - isCollisionObject(obj) -> boolean. Without one nothing collides
 *     (no statics, no dynamics, no tile targets).
 *   - is3dKind(kind) / isLight3d(kind) -> boolean. Without one the kind
 *     is treated as "not 3D" / "not a light".
 *   - physics2d — the HydraPhysics2D module (triggerContacts, pairKey,
 *     canCollide, isTrigger, resolvePair). Without it (or without
 *     triggerContacts/resolvePair) there is no object collision and no
 *     trigger contacts at all — see the deliberate delta below.
 *   - tiles — the HydraTiles module (resolveTileCollision). Without it
 *     there is no tile collision.
 *   - prevTriggerPairs — the previous frame's "zoneId:objId" map, for the
 *     enter/exit edge detection. resolveObjectCollisions returns the
 *     fresh map as nextPairs; the host stores it.
 *
 * Semantics:
 *   - isPhysicsBody(obj, hooks): true only for objects that take the
 *     full physics step — not text, not static, physicsEnabled, not a 3D
 *     kind, not a light3d. The export's rule, which is the reference.
 *   - isVelocityBody(obj, hooks): true for every object that takes the
 *     velocity step — the same exclusions as isPhysicsBody except that
 *     physicsEnabled is NOT required. Velocity is universal (the
 *     GDevelop rule): Apply Force, Set Velocity, and Knockback Object
 *     write velocity onto any non-text object, so any of them must move
 *     it. Only gravity, friction, the max-speed clamp, and collision
 *     stay physics-gated.
 *   - integrateBody(obj, dt, hooks): snapshots _prevX/_prevY for the
 *     object even when it is not a body (both hosts did this for every
 *     live object, so previous-hitbox readers stay valid for statics and
 *     text too), then integrates: a physics body exactly as the export
 *     did (velY += gravity * dt, both velocities *= friction ^ dt, both
 *     clamped to +/-maxSpeed, pos += vel * dt); a plain object by pure
 *     velocity (pos += vel * dt, velocity untouched — no gravity, no
 *     friction decay, no clamp). Returns true when the object
 *     integrated (either way), false otherwise. A non-finite dt reads
 *     as 0.
 *   - resolveObjectCollisions(objects, hooks): returns { contacts,
 *     entered, exited, nextPairs }. Dynamics are isCollisionObject
 *     objects that are not static and physicsEnabled; statics are
 *     isCollisionObject objects that are static or not physicsEnabled.
 *     Trigger zones only report contacts (never block); layer masks gate
 *     through physics2d.canCollide when it exists.
 *   - resolveTileCollisions(objects, hooks): returns true when anything
 *     collided. Tilemaps are collision sources only, never dynamics.
 *     Layer masks gate through physics2d.canCollide when it exists.
 *   - stepPhysics2d(objects, dt, hooks): the full step — integrate every
 *     object, resolve objects, resolve tiles — and returns the trigger
 *     summary from resolveObjectCollisions. A non-array list is a no-op
 *     returning the empty trigger summary. The hosts pass their
 *     pre-filtered live-object list (destroyed / pending-destroy already
 *     excluded), so the module never reads a destroyed set.
 *   - Nothing here ever throws: a throwing hook or subsystem call is
 *     caught and that one object / pair / pass degrades to a no-op, so a
 *     bad record can never kill the frame.
 *
 * Behavior changes vs the old inline code (all in the direction the code
 * already documented with "(mirrors the export)" / "(mirrors the editor
 * preview)" comments — the two runtimes were supposed to agree and did not):
 *   - Preview text objects with collision enabled no longer move under
 *     physics. The preview skipped text only when it was NOT a collision
 *     object (`!isCollisionObject(obj) && obj.kind === 'text'`), so a
 *     text object with collision.enabled === true fell under gravity in
 *     the preview while the export skipped every text object outright.
 *     Text is now always skipped, in both runtimes — a label is never a
 *     physics body, even when it is collidable.
 *   - Preview light3d objects now have the export's explicit skip. The
 *     preview only skipped 3D kinds; a light3d with physicsEnabled set
 *     (hand-edited project data) would have moved in the preview while
 *     the export held it still. Lights never move under physics.
 *   - The preview's legacy AABB fallback is gone. Its resolveCollisions
 *     fell back to a hand-rolled cross-from-side/MTV path when
 *     HydraPhysics2D was missing; the export hard-requires that module
 *     and has no fallback. With no physics2d the step now integrates
 *     velocities but resolves no collisions and reports no trigger
 *     contacts — the same guarded-call degradation the other shared
 *     modules use (a dropped tag stops the subsystem instead of silently
 *     running a second, divergent solver). The export is unaffected: it
 *     hard-guards on HydraPhysics2D at load.
 *   - Nov 7, 2026 (cycle 25): velocity is now universal. A
 *     non-physics object with velocity used to stand still — Apply
 *     Force wrote velX/velY onto it and integrateBody returned early
 *     for !physicsEnabled, so the force silently did nothing. Now a
 *     plain object integrates its velocity every frame (steady speed,
 *     no gravity, no friction, no clamp) while gravity, friction, the
 *     max-speed clamp, and all collision stay physics-gated, so it
 *     glides through solids and trigger zones instead of landing on
 *     them. Text, static objects, 3D kinds, and lights still never
 *     move. Old games are unaffected unless they set velocity on a
 *     non-physics object — and there it only ever did nothing before.
 *   - Hostile-data hardening (no live behavior change on valid data):
 *     a non-finite dt reads as 0; a getPhysics reader that returns
 *     undefined fields or throws degrades to the defaults (the export's
 *     Object.assign reader copied undefined over the defaults, so a
 *     gravity of undefined produced NaN velocities); a missing posX/posY
 *     reads as 0 instead of producing NaN positions.
 *
 * Load order (index.html): hydra-physicsstep.js BEFORE player-runtime.js
 * and script.js. player-runtime.js throws a clear error if
 * HydraPhysicsStep is missing. The preview guards the stepPhysics2d call
 * (window.HydraPhysicsStep), so the editor still boots if the tag is ever
 * dropped — the scene still draws, but physics does not advance, the same
 * guarded-call degradation the other shared modules use; the tag order is
 * pinned by tests/physicsstep.test.js.
 * ========================================================================== */

function hydraPhysicsStepFactory() {
  'use strict';

  var DEFAULT_PHYSICS = { gravity: 0, friction: 0.82, bounciness: 0.4, maxSpeed: 25 };

  function finiteNum(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback;
  }

  function clampNum(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  // The host's physics reader, repaired: undefined / non-finite fields
  // fall back to the defaults (the export's Object.assign reader copied
  // undefined over them, so a gravity of undefined produced NaN
  // velocities). Without a reader, or when it throws, the object's own
  // physics record is read the same way.
  function safeGetPhysics(obj, getPhysics) {
    var raw = null;
    try {
      if (typeof getPhysics === 'function') raw = getPhysics(obj) || {};
    } catch (e) { raw = null; }
    if (!raw) {
      try { raw = (obj && obj.physics) || {}; } catch (e2) { raw = {}; }
    }
    return {
      gravity: finiteNum(raw.gravity, DEFAULT_PHYSICS.gravity),
      friction: finiteNum(raw.friction, DEFAULT_PHYSICS.friction),
      bounciness: finiteNum(raw.bounciness, DEFAULT_PHYSICS.bounciness),
      maxSpeed: finiteNum(raw.maxSpeed, DEFAULT_PHYSICS.maxSpeed)
    };
  }

  // The canonical hitbox shape (pos + offset, hitbox size else object
  // size) — the same math both hosts' hitbox helpers use. Used when the
  // host passes no hitbox hook, and as the fallback when its hook throws.
  function canonicalHitbox(obj) {
    var width = Number(obj.hitboxWidth) > 0 ? Number(obj.hitboxWidth) : (obj.width || 1);
    var height = Number(obj.hitboxHeight) > 0 ? Number(obj.hitboxHeight) : (obj.height || 1);
    return {
      x: (obj.posX || 0) + (Number(obj.hitboxOffsetX) || 0),
      y: (obj.posY || 0) + (Number(obj.hitboxOffsetY) || 0),
      width: width,
      height: height
    };
  }

  function safeHitbox(obj, hooks) {
    try {
      if (hooks && typeof hooks.hitbox === 'function') {
        var hb = hooks.hitbox(obj) || {};
        return {
          x: finiteNum(hb.x, 0),
          y: finiteNum(hb.y, 0),
          width: finiteNum(hb.width, 1),
          height: finiteNum(hb.height, 1)
        };
      }
    } catch (e) { /* fall through to the canonical shape */ }
    try { return canonicalHitbox(obj); }
    catch (e2) { return { x: 0, y: 0, width: 1, height: 1 }; }
  }

  // The hitbox at the object's previous position (_prevX/_prevY, falling
  // back to the current position) — what the cross-from-side resolution
  // needs. Computed through the host's hitbox hook over a shifted copy,
  // exactly as the preview's getPreviousHitbox did; the canonical shape
  // is the fallback.
  function prevHitbox(obj, hooks) {
    try {
      if (hooks && typeof hooks.hitbox === 'function') {
        var shifted = {};
        var k;
        for (k in obj) shifted[k] = obj[k];
        shifted.posX = (obj._prevX !== undefined && obj._prevX !== null) ? obj._prevX : obj.posX;
        shifted.posY = (obj._prevY !== undefined && obj._prevY !== null) ? obj._prevY : obj.posY;
        var hb = hooks.hitbox(shifted) || {};
        return { x: finiteNum(hb.x, 0), y: finiteNum(hb.y, 0) };
      }
    } catch (e) { /* fall through to the raw fields */ }
    var px = (obj._prevX !== undefined && obj._prevX !== null) ? obj._prevX : obj.posX;
    var py = (obj._prevY !== undefined && obj._prevY !== null) ? obj._prevY : obj.posY;
    return {
      x: finiteNum(px, 0) + finiteNum(obj.hitboxOffsetX, 0),
      y: finiteNum(py, 0) + finiteNum(obj.hitboxOffsetY, 0)
    };
  }

  function safeIsCollisionObject(obj, hooks) {
    try {
      if (hooks && typeof hooks.isCollisionObject === 'function') return !!hooks.isCollisionObject(obj);
    } catch (e) { return false; }
    return false;
  }

  // True only for objects that take the integration step: not text, not
  // static, physicsEnabled, not a 3D kind, not a light3d. The export's
  // rule, which is the reference — the preview's text check (skip only a
  // text object that is NOT a collision object) and its missing light3d
  // check are the two divergences this module closes.
  function isPhysicsBody(obj, hooks) {
    if (!obj || typeof obj !== 'object') return false;
    try {
      if (obj.kind === 'text') return false;
      if (obj.static) return false;
      if (!obj.physicsEnabled) return false;
      var h = hooks || {};
      if (typeof h.is3dKind === 'function' && h.is3dKind(obj.kind)) return false;
      if (typeof h.isLight3d === 'function' && h.isLight3d(obj.kind)) return false;
      return true;
    } catch (e) { return false; }
  }

  // True only for objects that take the velocity step: not text, not
  // static, not a 3D kind, not a light3d. Physics is NOT required —
  // velocity is universal (the GDevelop rule), so a plain object with
  // a velocity glides; only gravity, friction, the max-speed clamp,
  // and collision stay physics-gated (see isPhysicsBody).
  function isVelocityBody(obj, hooks) {
    if (!obj || typeof obj !== 'object') return false;
    try {
      if (obj.kind === 'text') return false;
      if (obj.static) return false;
      var h = hooks || {};
      if (typeof h.is3dKind === 'function' && h.is3dKind(obj.kind)) return false;
      if (typeof h.isLight3d === 'function' && h.isLight3d(obj.kind)) return false;
      return true;
    } catch (e) { return false; }
  }

  // One object's integration step. Snapshots _prevX/_prevY even for
  // non-bodies (both hosts did this for every live object, so the
  // previous-hitbox readers stay valid for statics and text too), then
  // integrates. A physics body integrates exactly as the export did:
  // velY += gravity * dt, both velocities *= friction ^ dt, both
  // clamped to +/-maxSpeed, pos += vel * dt. A plain (non-physics)
  // object takes the pure velocity step instead: pos += vel * dt with
  // the velocity untouched — no gravity, no friction decay, no clamp —
  // so a forced object glides at a steady speed and through solids.
  // Returns true when the object integrated (either way), false when
  // it is not a velocity body at all. Never throws.
  function integrateBody(obj, dt, hooks) {
    if (!obj || typeof obj !== 'object') return false;
    try { obj._prevX = obj.posX; obj._prevY = obj.posY; } catch (e) { return false; }
    if (!isVelocityBody(obj, hooks)) return false;
    var stepDt = finiteNum(dt, 0);
    if (!isPhysicsBody(obj, hooks)) {
      // Plain object: pure velocity. Non-finite velocity reads as 0 and
      // is written back repaired, so a bad record can never NaN the
      // position or leave a poisoned velocity behind.
      var pVelX = finiteNum(obj.velX, 0);
      var pVelY = finiteNum(obj.velY, 0);
      try {
        obj.velX = pVelX;
        obj.velY = pVelY;
        obj.posX = finiteNum(obj.posX, 0) + pVelX * stepDt;
        obj.posY = finiteNum(obj.posY, 0) + pVelY * stepDt;
      } catch (e) { return false; }
      return true;
    }
    var p = safeGetPhysics(obj, hooks && hooks.getPhysics);
    var velX = finiteNum(obj.velX, 0) * Math.pow(p.friction, stepDt);
    var velY = finiteNum(obj.velY, 0) + p.gravity * stepDt;
    velY = velY * Math.pow(p.friction, stepDt);
    velX = clampNum(velX, -p.maxSpeed, p.maxSpeed);
    velY = clampNum(velY, -p.maxSpeed, p.maxSpeed);
    try {
      obj.velX = velX;
      obj.velY = velY;
      obj.posX = finiteNum(obj.posX, 0) + velX * stepDt;
      obj.posY = finiteNum(obj.posY, 0) + velY * stepDt;
    } catch (e) { return false; }
    return true;
  }

  // Object-vs-object collision resolution. Statics are collision objects
  // that are static or not physicsEnabled; dynamics are collision objects
  // that are neither. Trigger contacts + enter/exit edges are computed
  // first (triggers never block), then every dynamic resolves against
  // every solid through physics2d.resolvePair. Returns the trigger
  // summary { contacts, entered, exited, nextPairs }; the host stores
  // nextPairs for the next frame's edge detection. With no physics2d
  // (or without its triggerContacts/resolvePair) nothing blocks and no
  // contacts are reported — the guarded-call degradation. Never throws.
  function resolveObjectCollisions(objects, hooks) {
    var h = hooks || {};
    var list = Array.isArray(objects) ? objects : [];
    var p2d = h.physics2d || null;
    if (!p2d || typeof p2d.triggerContacts !== 'function' || typeof p2d.resolvePair !== 'function') {
      return { contacts: [], entered: [], exited: [], nextPairs: {} };
    }
    var prevPairs = (h.prevTriggerPairs && typeof h.prevTriggerPairs === 'object') ? h.prevTriggerPairs : {};
    var solids = [];
    var dynamics = [];
    try {
      solids = list.filter(function (o) {
        try { return safeIsCollisionObject(o, h) && (o.static || !o.physicsEnabled); }
        catch (e) { return false; }
      });
      dynamics = list.filter(function (o) {
        try { return safeIsCollisionObject(o, h) && !o.static && o.physicsEnabled; }
        catch (e) { return false; }
      });
    } catch (e) { return { contacts: [], entered: [], exited: [], nextPairs: {} }; }
    var contacts = [];
    try { contacts = p2d.triggerContacts(dynamics, solids) || []; } catch (e) { contacts = []; }
    var nextPairs = {};
    contacts.forEach(function (c) {
      try { nextPairs[p2d.pairKey(c.zone, c.obj)] = true; } catch (e) { /* a bad contact never breaks the frame */ }
    });
    var entered = Object.keys(nextPairs).filter(function (k) { return !prevPairs[k]; });
    var exited = Object.keys(prevPairs).filter(function (k) { return !nextPairs[k]; });
    dynamics.forEach(function (obj) {
      solids.forEach(function (wall) {
        if (wall === obj) return;
        try {
          if (typeof p2d.canCollide === 'function' && !p2d.canCollide(obj, wall)) return;
          if (typeof p2d.isTrigger === 'function' && p2d.isTrigger(wall)) return;
          var hb = safeHitbox(obj, h);
          var prev = prevHitbox(obj, h);
          var res = p2d.resolvePair(obj, wall, {
            x: hb.x, y: hb.y, w: hb.width, h: hb.height,
            velX: finiteNum(obj.velX, 0), velY: finiteNum(obj.velY, 0),
            prevX: prev.x, prevY: prev.y
          });
          if (!res || !res.collided) return;
          var ox = finiteNum(obj.hitboxOffsetX, 0);
          var oy = finiteNum(obj.hitboxOffsetY, 0);
          obj.posX = finiteNum(res.x, hb.x) - ox;
          obj.posY = finiteNum(res.y, hb.y) - oy;
          obj.velX = finiteNum(res.velX, 0);
          obj.velY = finiteNum(res.velY, 0);
        } catch (e) { /* one bad pair never breaks the frame */ }
      });
    });
    return { contacts: contacts, entered: entered, exited: exited, nextPairs: nextPairs };
  }

  // Tilemap collision resolution. Tilemaps are collision sources only,
  // never dynamics. Layer masks gate through physics2d.canCollide when
  // it exists. Returns true when anything collided. With no tiles
  // module there is no tile collision. Never throws.
  function resolveTileCollisions(objects, hooks) {
    var h = hooks || {};
    var list = Array.isArray(objects) ? objects : [];
    var tiles = h.tiles || null;
    if (!tiles || typeof tiles.resolveTileCollision !== 'function') return false;
    var p2d = h.physics2d || null;
    var maps = [];
    try {
      maps = list.filter(function (o) {
        try { return !!o && o.kind === 'tilemap' && o.collision?.enabled !== false; }
        catch (e) { return false; }
      });
    } catch (e) { return false; }
    if (!maps.length) return false;
    var collidedAny = false;
    list.forEach(function (obj) {
      try {
        if (!obj || obj.kind === 'tilemap' || obj.static || !obj.physicsEnabled) return;
        if (!safeIsCollisionObject(obj, h)) return;
        var hb = safeHitbox(obj, h);
        var prev = prevHitbox(obj, h);
        maps.forEach(function (tm) {
          try {
            if (p2d && typeof p2d.canCollide === 'function' && !p2d.canCollide(obj, tm)) return;
            var res = tiles.resolveTileCollision(tm, {
              x: hb.x, y: hb.y, w: hb.width, h: hb.height,
              velX: finiteNum(obj.velX, 0), velY: finiteNum(obj.velY, 0),
              prevX: prev.x, prevY: prev.y
            });
            if (!res || !res.collided) return;
            var ox = finiteNum(obj.hitboxOffsetX, 0);
            var oy = finiteNum(obj.hitboxOffsetY, 0);
            obj.posX = finiteNum(res.x, hb.x) - ox;
            obj.posY = finiteNum(res.y, hb.y) - oy;
            obj.velX = finiteNum(res.velX, 0);
            obj.velY = finiteNum(res.velY, 0);
            collidedAny = true;
          } catch (e) { /* one bad tile pair never breaks the frame */ }
        });
      } catch (e) { /* one bad object never breaks the frame */ }
    });
    return collidedAny;
  }

  // The full 2D physics step for one frame: integrate every object,
  // resolve objects, resolve tiles. Returns the trigger summary from
  // resolveObjectCollisions. The hosts pass their pre-filtered
  // live-object list (destroyed / pending-destroy already excluded).
  // Never throws.
  function stepPhysics2d(objects, dt, hooks) {
    var list = Array.isArray(objects) ? objects : [];
    var stepDt = finiteNum(dt, 0);
    var h = hooks || {};
    list.forEach(function (obj) { integrateBody(obj, stepDt, h); });
    var trig = resolveObjectCollisions(list, h);
    resolveTileCollisions(list, h);
    return trig;
  }

  return {
    isPhysicsBody: isPhysicsBody,
    isVelocityBody: isVelocityBody,
    integrateBody: integrateBody,
    resolveObjectCollisions: resolveObjectCollisions,
    resolveTileCollisions: resolveTileCollisions,
    stepPhysics2d: stepPhysics2d
  };
}

window.HydraPhysicsStep = hydraPhysicsStepFactory();
// Self-contained source of the factory, inlined into exported playable games
// by HydraPlayer.buildPlayableHtml so exports run without editor files.
window.HydraPhysicsStep.factorySource = hydraPhysicsStepFactory.toString();
