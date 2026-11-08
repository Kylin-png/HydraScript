/* ============================================================================
 * hydra-combat.js — HydraScript shared combat (P4 Advanced batch 29:
 * melee attacks & projectiles, beginner edition).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation
 * of how a game fights back — used by:
 *   - the editor preview runtime (hydra-previewruntime.js delegates
 *     to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Idea (Unity combat / Godot hitboxes, beginner edition): batch 21 gave
 * every object hit points, batch 22 made hits visible, batch 24 spawns
 * enemies that keep coming, and batches 26–28 gave the hero the moves
 * to survive — but hurting an enemy still meant hand-wiring a collision
 * row plus Damage Object, and a fireball still meant hand-wiring Spawn
 * Object plus Move Toward plus another collision row. Combat is the two
 * classic verbs, as plain blocks:
 *
 *   melee — one block that swings. Melee Attack hits every solid object
 *     whose center sits inside the 90-degree arc in front of the
 *     attacker, out to the picked range (60px is a sword swing). The
 *     damage runs through the host's damage hook — the same path Damage
 *     Object uses — so an invincible target skips the hit quietly and
 *     Object Died still fires on the killing blow. The swing draws a
 *     brief white arc in front of the attacker (0.15s), so the hit
 *     reads even when nothing is in range. A cooldown (0.5s) stops one
 *     press from becoming a blender: an attack pressed during the
 *     cooldown does nothing, the same refusal rule Dash uses.
 *   shoot — one block that fires. Shoot Projectile clones the picked
 *     projectile object at the shooter's edge, flying straight in the
 *     picked direction at the picked speed (300 px/s is a brisk
 *     fireball) until it touches the first solid object — damaging it
 *     through the same damage hook — or its lifetime ends (2s), when
 *     the clone is destroyed. One hit per projectile, no piercing. A
 *     cooldown (0.5s) paces the shots the same way.
 *   the cooldowns — per object, on the frozen game clock in seconds
 *     (the hosts pass frozenNowMs() / 1000, so a cooldown holds while
 *     paused, and the frame phase only runs while unpaused). The
 *     Attack Ready condition reads them: true when the picked kind
 *     (Melee or Shot) has cooled down, so a fire button can gate on
 *     it instead of spamming a refused shot every frame.
 *   the runtime — transient, fresh per scene load (via the scene-reset
 *     hook), never in project JSON or save slots: per-object last
 *     attack times, the live projectile list, and the slash visuals.
 *     A new `updateCombat` frame phase refreshes it after
 *     `updateMovement`, so a projectile steps after the dash has had
 *     the frame's final word on positions.
 *
 * A hit lands on solid objects only (the host's isCollision read) —
 * so a swing or a fireball stops at a wall, the same way a real
 * projectile does. The shooter never hits itself, and one projectile
 * never hits another. The projectile list caps at 200 (a shot at the
 * cap is refused quietly, like a dash on cooldown), so a jammed fire
 * button cannot grow the list without bound.
 *
 * Time is the frozen game clock in seconds. Nothing ever throws;
 * hostile input degrades to safe defaults.
 *
 * Honest limits: one direction per attack (left / right / up / down —
 * no diagonal, no facing-relative attacks; pick the direction on the
 * block); melee hits anything solid in the arc, walls included, so
 * keep walls out of the swing or check the target name after the
 * hit; a projectile stops at the first solid thing it touches, wall
 * included, and never pierces; projectiles move by direct position
 * steps, so one can sit inside a thin wall for a frame before the
 * hit check lands; no `hs` script-API surface yet.
 *
 * Load order (index.html): hydra-combat.js BEFORE player-runtime.js
 * and script.js. player-runtime.js throws a clear error if
 * HydraCombat is missing.
 * ========================================================================== */

function hydraCombatFactory() {
  'use strict';

  // A sword swing reaches 60px; a fireball flies 300 px/s for 2s; an
  // attack every half second is a brisk fight. The slash arc shows for
  // 0.15s — long enough to read, short enough to keep up with a fight.
  var DEFAULT_DAMAGE = 10;
  var DEFAULT_MELEE_RANGE = 60;
  var DEFAULT_COOLDOWN = 0.5;
  var DEFAULT_SPEED = 300;
  var DEFAULT_LIFETIME = 2;
  var MAX_DAMAGE = 10000;
  var MAX_RANGE = 2000;
  var MAX_COOLDOWN = 60;
  var MAX_SPEED = 5000;
  var MAX_LIFETIME = 60;
  var SLASH_TTL = 0.15;
  var MAX_PROJECTILES = 200;
  var MAX_SLASHES = 20;
  // Half the swing arc: a 90-degree arc in front of the attacker.
  var MELEE_HALF_ARC = Math.PI / 4;

  // A usable number, or the fallback when the value is not one — and
  // only a real number or a numeric string counts. An array, an
  // object, or a boolean is hostile input, not a number (Number([]) is
  // 0 and Number(true) is 1, which would silently read as real values
  // instead of the fallback). The spawn / lives / movement modules use
  // the same strict rule.
  function strictNum(v, fallback) {
    if (typeof v === 'number') return isFinite(v) ? v : fallback;
    if (typeof v === 'string' && v.trim() !== '') {
      var n = Number(v);
      return isFinite(n) ? n : fallback;
    }
    return fallback;
  }

  function clamp(v, lo, hi) {
    if (!isFinite(v)) return lo;
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
  }

  function normalizeDamage(v) {
    return clamp(strictNum(v, DEFAULT_DAMAGE), 0, MAX_DAMAGE);
  }

  function normalizeMeleeRange(v) {
    return clamp(strictNum(v, DEFAULT_MELEE_RANGE), 0, MAX_RANGE);
  }

  function normalizeCooldown(v) {
    return clamp(strictNum(v, DEFAULT_COOLDOWN), 0, MAX_COOLDOWN);
  }

  function normalizeSpeed(v) {
    return clamp(strictNum(v, DEFAULT_SPEED), 0, MAX_SPEED);
  }

  function normalizeLifetime(v) {
    return clamp(strictNum(v, DEFAULT_LIFETIME), 0, MAX_LIFETIME);
  }

  // The Dash block's direction select ('left' / 'right' / 'up' /
  // 'down') as a unit vector; anything else reads as right.
  function directionVector(direction) {
    var d = String(direction || '').trim().toLowerCase();
    if (d === 'left') return { x: -1, y: 0 };
    if (d === 'up') return { x: 0, y: -1 };
    if (d === 'down') return { x: 0, y: 1 };
    return { x: 1, y: 0 };
  }

  // --- State ----------------------------------------------------------------

  // A fresh transient combat state for a run / scene load. Cooldowns
  // are keyed by object id ({ meleeAt, shotAt } in frozen-game
  // seconds, null when the object never attacked); projectiles are the
  // live shots; slashes are the swing visuals waiting to be drawn.
  function createCombatState() {
    return { cooldowns: {}, projectiles: [], slashes: [] };
  }

  function cooldownsOf(state) {
    if (!state || typeof state !== 'object') return {};
    if (!state.cooldowns || typeof state.cooldowns !== 'object') state.cooldowns = {};
    return state.cooldowns;
  }

  function recordOf(state, obj) {
    if (!obj || obj.id == null) return null;
    var cds = cooldownsOf(state);
    var rec = cds[obj.id];
    if (!rec || typeof rec !== 'object') {
      rec = { meleeAt: null, shotAt: null };
      cds[obj.id] = rec;
    }
    return rec;
  }

  // True when the object's picked kind has cooled down — never
  // attacked reads as ready. `kind` is 'melee' or 'shot'; anything
  // else reads as melee. Never throws.
  function attackReady(state, obj, kind, cooldownSec, nowSec) {
    try {
      if (!obj || obj.id == null) return false;
      var cds = cooldownsOf(state);
      var rec = cds[obj.id];
      if (!rec || typeof rec !== 'object') return true;
      var last = (String(kind) === 'shot') ? rec.shotAt : rec.meleeAt;
      if (last == null || !isFinite(Number(last))) return true;
      var cd = clamp(strictNum(cooldownSec, DEFAULT_COOLDOWN), 0, MAX_COOLDOWN);
      var now = isFinite(Number(nowSec)) ? Number(nowSec) : 0;
      return (now - Number(last)) >= cd;
    } catch (e) {
      return false;
    }
  }

  function markAttack(state, obj, kind, nowSec) {
    try {
      var rec = recordOf(state, obj);
      if (!rec) return;
      var now = isFinite(Number(nowSec)) ? Number(nowSec) : 0;
      if (String(kind) === 'shot') rec.shotAt = now;
      else rec.meleeAt = now;
    } catch (e) { /* a throwing mark never breaks the attack */ }
  }

  // --- Geometry ---------------------------------------------------------------

  function centerOf(o) {
    return {
      x: (Number(o.posX) || 0) + (Number(o.width) || 0) / 2,
      y: (Number(o.posY) || 0) + (Number(o.height) || 0) / 2
    };
  }

  // The host's hitbox for the object ({x, y, w, h} or {x, y, width,
  // height} — both shapes the engine's hitbox helpers return), or the
  // raw object box when the hook is missing or unusable.
  function boxOf(o, hooks) {
    try {
      if (hooks && typeof hooks.hitbox === 'function') {
        var hb = hooks.hitbox(o);
        if (hb && typeof hb === 'object' &&
            isFinite(Number(hb.x)) && isFinite(Number(hb.y)) &&
            (isFinite(Number(hb.w)) || isFinite(Number(hb.width))) &&
            (isFinite(Number(hb.h)) || isFinite(Number(hb.height)))) {
          return {
            x: Number(hb.x), y: Number(hb.y),
            w: isFinite(Number(hb.w)) ? Number(hb.w) : Number(hb.width),
            h: isFinite(Number(hb.h)) ? Number(hb.h) : Number(hb.height)
          };
        }
      }
    } catch (e) { /* fall through to the raw box */ }
    return {
      x: Number(o.posX) || 0,
      y: Number(o.posY) || 0,
      w: Number(o.width) || 0,
      h: Number(o.height) || 0
    };
  }

  function boxesOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x &&
           a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function isSolid(o, hooks) {
    try {
      if (hooks && typeof hooks.isCollision === 'function') return !!hooks.isCollision(o);
    } catch (e) { return true; }
    return true;
  }

  function liveObjects(hooks) {
    try {
      if (hooks && Array.isArray(hooks.objects)) return hooks.objects;
    } catch (e) { return []; }
    return [];
  }

  function isProjectileObject(state, o) {
    try {
      if (!state || !Array.isArray(state.projectiles) || !o) return false;
      for (var i = 0; i < state.projectiles.length; i++) {
        if (state.projectiles[i] && state.projectiles[i].obj === o) return true;
      }
    } catch (e) { return false; }
    return false;
  }

  // Every solid live object in the 90-degree arc in front of the
  // attacker, out to the range (center-to-center). The attacker never
  // hits itself. (The melee entry point filters live projectiles out
  // of this list — a fireball is not a wall.) Never throws.
  function meleeTargets(attacker, range, direction, hooks) {
    var out = [];
    try {
      if (!attacker || typeof attacker !== 'object') return out;
      var dir = directionVector(direction);
      var c = centerOf(attacker);
      var dirAngle = Math.atan2(dir.y, dir.x);
      var list = liveObjects(hooks);
      for (var i = 0; i < list.length; i++) {
        var o = list[i];
        if (!o || typeof o !== 'object' || o === attacker) continue;
        if (!isSolid(o, hooks)) continue;
        var oc = centerOf(o);
        var dx = oc.x - c.x;
        var dy = oc.y - c.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > range) continue;
        // A target exactly on top of the attacker is in every arc.
        if (dist > 0.001) {
          var ang = Math.atan2(dy, dx) - dirAngle;
          while (ang > Math.PI) ang -= 2 * Math.PI;
          while (ang < -Math.PI) ang += 2 * Math.PI;
          if (Math.abs(ang) > MELEE_HALF_ARC) continue;
        }
        out.push(o);
      }
    } catch (e) { return out; }
    return out;
  }

  // --- Melee ------------------------------------------------------------------

  // Swing in front of the attacker. Returns { hit, hits, reason } —
  // hits is the list of objects the swing landed on (by name where the
  // object has one). A press during the cooldown returns hit false
  // with reason 'cooldown' and changes nothing; a missing attacker
  // returns reason 'no-attacker'. The damage runs through the host's
  // damage hook (the same path Damage Object uses), so an invincible
  // target skips the hit and the host decides what a dead target
  // means. The swing always draws, even with nothing in range.
  // Never throws.
  function meleeAttack(state, attacker, opts, hooks, nowSec) {
    try {
      if (!attacker || typeof attacker !== 'object') {
        return { hit: false, hits: [], reason: 'no-attacker' };
      }
      var o = opts || {};
      var damage = normalizeDamage(o.damage);
      var range = normalizeMeleeRange(o.range);
      var cooldown = normalizeCooldown(o.cooldown);
      if (!attackReady(state, attacker, 'melee', cooldown, nowSec)) {
        return { hit: false, hits: [], reason: 'cooldown' };
      }
      markAttack(state, attacker, 'melee', nowSec);
      var c = centerOf(attacker);
      var dir = directionVector(o.direction);
      if (state && typeof state === 'object') {
        if (!Array.isArray(state.slashes)) state.slashes = [];
        state.slashes.push({
          x: c.x, y: c.y, dirX: dir.x, dirY: dir.y,
          range: range, remain: SLASH_TTL
        });
        while (state.slashes.length > MAX_SLASHES) state.slashes.shift();
      }
      var targets = meleeTargets(attacker, range, o.direction, hooks);
      // A fireball is not a wall: another projectile in the arc is
      // never a melee target (the same rule the projectile flight
      // uses for its own hit list).
      targets = targets.filter(function (t) { return !isProjectileObject(state, t); });
      var hits = [];
      for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        try {
          if (hooks && typeof hooks.damage === 'function') hooks.damage(t, damage);
        } catch (e) { /* a throwing hit never breaks the swing */ }
        hits.push((t && t.name != null) ? String(t.name) : '');
      }
      return { hit: true, hits: hits, reason: null };
    } catch (e) {
      return { hit: false, hits: [], reason: 'error' };
    }
  }

  // --- Projectiles ------------------------------------------------------------

  // Fire one projectile. Returns { fired, reason } — fired false with
  // reason 'no-shooter' / 'no-template' / 'cooldown' / 'cap' changes
  // nothing (a refused shot never consumes the cooldown, so a missing
  // template does not eat the next real shot). The clone spawns at
  // the shooter's edge in the picked direction, centered on that
  // point, and flies straight at the picked speed until it hits the
  // first solid object or its lifetime ends. Never throws.
  function shootProjectile(state, shooter, opts, hooks, nowSec) {
    try {
      if (!shooter || typeof shooter !== 'object') {
        return { fired: false, reason: 'no-shooter' };
      }
      var o = opts || {};
      var template = (o.template == null) ? '' : String(o.template);
      if (template.trim() === '') return { fired: false, reason: 'no-template' };
      var speed = normalizeSpeed(o.speed);
      var damage = normalizeDamage(o.damage);
      var lifetime = normalizeLifetime(o.lifetime);
      var cooldown = normalizeCooldown(o.cooldown);
      if (!attackReady(state, shooter, 'shot', cooldown, nowSec)) {
        return { fired: false, reason: 'cooldown' };
      }
      if (!state || typeof state !== 'object') return { fired: false, reason: 'no-state' };
      if (!Array.isArray(state.projectiles)) state.projectiles = [];
      if (state.projectiles.length >= MAX_PROJECTILES) {
        return { fired: false, reason: 'cap' };
      }
      if (!hooks || typeof hooks.spawn !== 'function') {
        return { fired: false, reason: 'no-spawn' };
      }
      var dir = directionVector(o.direction);
      var c = centerOf(shooter);
      var half = Math.max(Number(shooter.width) || 0, Number(shooter.height) || 0) / 2;
      var ex = c.x + dir.x * (half + 4);
      var ey = c.y + dir.y * (half + 4);
      var clone = null;
      try { clone = hooks.spawn(template, ex, ey); } catch (e) { clone = null; }
      if (!clone || typeof clone !== 'object') {
        return { fired: false, reason: 'no-template' };
      }
      // The spawn hook lands the clone's top-left corner on the point;
      // center it on the edge point instead, so the shot leaves from
      // the shooter's edge instead of its corner.
      try {
        clone.posX = ex - (Number(clone.width) || 0) / 2;
        clone.posY = ey - (Number(clone.height) || 0) / 2;
      } catch (e) { /* a throwing recenter keeps the spawn point */ }
      var now = isFinite(Number(nowSec)) ? Number(nowSec) : 0;
      markAttack(state, shooter, 'shot', now);
      state.projectiles.push({
        obj: clone,
        vx: dir.x * speed,
        vy: dir.y * speed,
        damage: damage,
        bornAt: now,
        lifetime: lifetime,
        shooterId: (shooter.id != null) ? shooter.id : null
      });
      return { fired: true, reason: null };
    } catch (e) {
      return { fired: false, reason: 'error' };
    }
  }

  // --- Frame phase ------------------------------------------------------------

  // Step every live projectile one frame: move it by its velocity,
  // damage the first solid object it overlaps (never the shooter,
  // never another projectile), then destroy it; destroy it too when
  // its lifetime ends. Expired slash visuals are pruned here as well.
  // `dtSec` is seconds (hosts pass dt / 60, the 60fps-unit frame
  // time). A projectile whose clone vanished by other means drops
  // quietly. Never throws.
  function updateCombat(state, dtSec, hooks, nowSec) {
    try {
      if (!state || typeof state !== 'object') return;
      var now = isFinite(Number(nowSec)) ? Number(nowSec) : 0;
      var dt = isFinite(Number(dtSec)) ? Number(dtSec) : 0;
      if (Array.isArray(state.slashes)) {
        // The slash arc fades on its own clock: each frame shaves the
        // frame time off the time left, so the arc freezes while
        // paused (the phase only runs while unpaused) and never needs
        // the draw pass to know the game clock.
        for (var s = 0; s < state.slashes.length; s++) {
          if (state.slashes[s]) {
            state.slashes[s].remain = (Number(state.slashes[s].remain) || 0) - dt;
          }
        }
        state.slashes = state.slashes.filter(function (sl) {
          return sl && isFinite(Number(sl.remain)) && Number(sl.remain) > 0;
        });
      }
      if (!Array.isArray(state.projectiles)) { state.projectiles = []; return; }
      if (dt <= 0) return;
      var alive = [];
      var list = liveObjects(hooks);
      for (var i = 0; i < state.projectiles.length; i++) {
        var p = state.projectiles[i];
        try {
          if (!p || !p.obj || typeof p.obj !== 'object') continue;
          var stillThere = true;
          try {
            if (hooks && typeof hooks.isAlive === 'function') stillThere = !!hooks.isAlive(p.obj);
          } catch (e) { stillThere = true; }
          if (!stillThere) continue;
          if ((now - Number(p.bornAt || 0)) >= Number(p.lifetime || 0)) {
            try { if (hooks && typeof hooks.destroy === 'function') hooks.destroy(p.obj); } catch (e) { /* a throwing destroy is skipped */ }
            continue;
          }
          p.obj.posX = (Number(p.obj.posX) || 0) + (Number(p.vx) || 0) * dt;
          p.obj.posY = (Number(p.obj.posY) || 0) + (Number(p.vy) || 0) * dt;
          var pb = boxOf(p.obj, hooks);
          var hit = null;
          for (var j = 0; j < list.length; j++) {
            var o = list[j];
            if (!o || typeof o !== 'object' || o === p.obj) continue;
            if (p.shooterId != null && o.id === p.shooterId) continue;
            if (isProjectileObject(state, o)) continue;
            if (!isSolid(o, hooks)) continue;
            if (boxesOverlap(pb, boxOf(o, hooks))) { hit = o; break; }
          }
          if (hit) {
            try {
              if (hooks && typeof hooks.damage === 'function') hooks.damage(hit, p.damage);
            } catch (e) { /* a throwing hit never breaks the flight */ }
            try { if (hooks && typeof hooks.destroy === 'function') hooks.destroy(p.obj); } catch (e) { /* a throwing destroy is skipped */ }
            continue;
          }
          alive.push(p);
        } catch (e) { /* one bad projectile never breaks the frame */ }
      }
      state.projectiles = alive;
    } catch (e) { /* a throwing combat update never breaks the frame */ }
  }

  // --- Draw -------------------------------------------------------------------

  // Draw the live slash arcs: a white sector in front of the attacker
  // that fades as its 0.15s runs out. The arc carries its own time
  // left (the frame phase shaves it down), so the draw needs no game
  // clock and freezes with the world while paused. World-space, drawn
  // by the host's draw pass above the world and below the HUD (the
  // same pass as the damage numbers). Never throws.
  function drawCombatEffects(ctx2d, state, camX, camY) {
    try {
      if (!ctx2d || !state || !Array.isArray(state.slashes)) return;
      var cx = isFinite(Number(camX)) ? Number(camX) : 0;
      var cy = isFinite(Number(camY)) ? Number(camY) : 0;
      for (var i = 0; i < state.slashes.length; i++) {
        var s = state.slashes[i];
        if (!s) continue;
        var remain = Number(s.remain);
        if (!isFinite(remain) || remain <= 0) continue;
        var alpha = Math.max(0, Math.min(1, remain / SLASH_TTL));
        var x = (Number(s.x) || 0) - cx;
        var y = (Number(s.y) || 0) - cy;
        var r = Math.max(4, Number(s.range) || 0);
        var ang = Math.atan2(Number(s.dirY) || 0, Number(s.dirX) || 1);
        try {
          ctx2d.save();
          ctx2d.globalAlpha = alpha * 0.85;
          ctx2d.strokeStyle = '#ffffff';
          ctx2d.fillStyle = 'rgba(255,255,255,0.25)';
          ctx2d.lineWidth = 6;
          ctx2d.beginPath();
          ctx2d.moveTo(x, y);
          ctx2d.arc(x, y, r, ang - MELEE_HALF_ARC, ang + MELEE_HALF_ARC);
          ctx2d.closePath();
          ctx2d.fill();
          ctx2d.stroke();
          ctx2d.restore();
        } catch (e) {
          try { ctx2d.restore(); } catch (e2) { /* one bad slash never breaks the draw */ }
        }
      }
    } catch (e) { /* a throwing slash draw never breaks the frame */ }
  }

  // --- Routing ---------------------------------------------------------------

  function isCombatAction(type) {
    return type === 'meleeAttack' || type === 'shootProjectile';
  }

  function isCombatCondition(type) {
    return type === 'attackReady';
  }

  return {
    normalizeDamage: normalizeDamage,
    normalizeMeleeRange: normalizeMeleeRange,
    normalizeCooldown: normalizeCooldown,
    normalizeSpeed: normalizeSpeed,
    normalizeLifetime: normalizeLifetime,
    directionVector: directionVector,
    createCombatState: createCombatState,
    attackReady: attackReady,
    meleeTargets: meleeTargets,
    meleeAttack: meleeAttack,
    shootProjectile: shootProjectile,
    updateCombat: updateCombat,
    drawCombatEffects: drawCombatEffects,
    isCombatAction: isCombatAction,
    isCombatCondition: isCombatCondition
  };
}

if (typeof window !== 'undefined') {
  window.HydraCombat = hydraCombatFactory();
  // Self-contained source of the factory, inlined into exported playable games
  // by HydraPlayer.buildPlayableHtml so exports run without editor files.
  window.HydraCombat.factorySource = hydraCombatFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraCombatFactory;
