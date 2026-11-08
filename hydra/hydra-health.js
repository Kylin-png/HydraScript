/* ============================================================================
 * hydra-health.js — HydraScript shared health & damage (P4 Advanced
 * batch 21: hit points, beginner edition).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation
 * of hit points — used by:
 *   - the editor preview runtime (hydra-previewruntime.js delegates
 *     to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Idea (Unity health systems / Godot health components, beginner
 * edition): every action game needs something that can take a hit. An
 * object carries two numbers — maxHealth (how much it can take) and
 * health (how much is left) — and four blocks move them:
 *
 *   damage — subtracts, clamping at 0, so an enemy at 10 hit points
 *     hit for 25 reads 0, not -15. The returned `died` flag is true
 *     exactly on the hit that reaches 0, so a game-over or explosion
 *     can fire once.
 *   heal — adds, clamping at maxHealth, so a potion never overfills
 *     the bar.
 *   set health — writes an exact value, clamped into 0..maxHealth.
 *   set max health — raises or lowers the ceiling (a level-up, a
 *     curse); the current health re-clamps to the new ceiling, so a
 *     lowered max never leaves health above it.
 *
 *   death — derived, never stored: an object is dead while health is
 *     0. The Object Died condition reads that state with the flow
 *     system's edge trigger, so it fires once when health reaches 0
 *     instead of every frame while the corpse lies there. Nothing
 *     destroys the object on its own — the game decides what death
 *     means (destroy it, hide it, play the animation) with ordinary
 *     blocks chained after Object Died.
 *   bar — an object with Show health bar draws a small bar above
 *     itself (green over half, amber over a quarter, red below),
 *     so the player can see the hit land without a single extra
 *     block. The bar is drawing-only: it never moves the object or
 *     changes collision, and it follows the object's parallax camera
 *     like the sprite does.
 *
 * Health lives on the live object (obj.health / obj.maxHealth), so a
 * fresh run starts at the authored values and damage during a run
 * never rewrites the project. Old projects have no health fields and
 * normalize to 100 / 100 with the bar off, so they behave exactly as
 * before. Health never travels in save slots — persist it through a
 * variable (Read it with the Health condition into Set Variable on
 * save, Set Health on load) the way quests and inventory do.
 *
 * Nothing ever throws; hostile input degrades to safe defaults.
 *
 * Honest limits: no floating damage numbers, no invincibility frames
 * (a second hit lands the next frame — gate it with a timer if the
 * game needs one), no knockback on damage (push the object with an
 * impulse block after Damage Object); no `hs` script-API surface yet.
 *
 * Load order (index.html): hydra-health.js BEFORE player-runtime.js
 * and script.js. player-runtime.js throws a clear error if HydraHealth
 * is missing.
 * ========================================================================== */

function hydraHealthFactory() {
  'use strict';

  var DEFAULT_MAX_HEALTH = 100;
  var MIN_MAX_HEALTH = 1;
  var MAX_MAX_HEALTH = 10000;
  var BAR_HEIGHT = 6;
  // Pixels above the object's top edge where the bar sits, so it never
  // covers the sprite it belongs to.
  var BAR_GAP = 10;
  var BAR_MIN_WIDTH = 24;
  var BAR_BG = 'rgba(0,0,0,0.55)';
  var BAR_BORDER = 'rgba(0,0,0,0.6)';
  var BAR_GREEN = '#22c55e';
  var BAR_AMBER = '#f59e0b';
  var BAR_RED = '#ef4444';

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

  // --- Normalization -------------------------------------------------------

  // The health ceiling: 1..10000, default 100. A boss at 1000 and a
  // pebble at 5 both fit; 0 or a negative ceiling can never hold a
  // living object, so it reads as the default instead.
  function normalizeMaxHealth(value) {
    if (value == null || value === '') return DEFAULT_MAX_HEALTH;
    var n = Number(value);
    if (!isFinite(n)) return DEFAULT_MAX_HEALTH;
    return clamp(n, MIN_MAX_HEALTH, MAX_MAX_HEALTH);
  }

  // Current health: 0..maxHealth, default the max (a fresh object
  // starts full). A value past the ceiling reads as the ceiling, so
  // an authored health above a lowered max never overfills the bar.
  function normalizeHealthValue(value, maxHealth) {
    var max = normalizeMaxHealth(maxHealth);
    if (value == null || value === '') return max;
    var n = Number(value);
    if (!isFinite(n)) return max;
    return clamp(n, 0, max);
  }

  // Repair an object's health fields in place (the editor and the
  // export normalizers both call this, so old projects and hostile
  // data read the same way in both runtimes). A non-object reads as
  // null; the caller keeps its own object.
  function normalizeHealth(obj) {
    if (!obj || typeof obj !== 'object') return null;
    obj.maxHealth = normalizeMaxHealth(obj.maxHealth);
    obj.health = normalizeHealthValue(obj.health, obj.maxHealth);
    obj.showHealthBar = obj.showHealthBar === true;
    return obj;
  }

  // --- Reads ---------------------------------------------------------------

  // A fresh { maxHealth, health } record for an object — the shape the
  // Health condition compares against. Missing objects read as a
  // fresh full-health record, never as an error.
  function healthOf(obj) {
    try {
      if (!obj || typeof obj !== 'object') {
        return { maxHealth: DEFAULT_MAX_HEALTH, health: DEFAULT_MAX_HEALTH };
      }
      var max = normalizeMaxHealth(obj.maxHealth);
      return { maxHealth: max, health: normalizeHealthValue(obj.health, max) };
    } catch (e) {
      return { maxHealth: DEFAULT_MAX_HEALTH, health: DEFAULT_MAX_HEALTH };
    }
  }

  // The health fraction, 0..1 — what the bar fills. A missing object
  // reads as full, so a bar never draws empty for a typo.
  function healthFraction(obj) {
    try {
      var h = healthOf(obj);
      if (h.maxHealth <= 0) return 0;
      return clamp(h.health / h.maxHealth, 0, 1);
    } catch (e) {
      return 1;
    }
  }

  // True while the object has no health left. Death is derived, never
  // stored — nothing has to remember that an object died, the number
  // says it.
  function isDead(obj) {
    try {
      return healthOf(obj).health <= 0;
    } catch (e) {
      return false;
    }
  }

  // --- Writes --------------------------------------------------------------

  // Subtract damage, clamping at 0. A bad or negative amount reads as
  // 0 (no change), so a broken expression never heals or harms by
  // accident. Returns { health, died }: died is true exactly on the
  // hit that reaches 0 — hitting an already-dead object again reads
  // died false, so a chained explosion fires once. Never throws.
  function damage(obj, amount) {
    try {
      if (!obj || typeof obj !== 'object') return { health: 0, died: false };
      normalizeHealth(obj);
      var amt = saneNum(amount, 0);
      if (amt < 0) amt = 0;
      var before = obj.health;
      obj.health = clamp(obj.health - amt, 0, obj.maxHealth);
      return { health: obj.health, died: before > 0 && obj.health <= 0 };
    } catch (e) {
      return { health: 0, died: false };
    }
  }

  // Add health, clamping at the ceiling. A bad or negative amount
  // reads as 0 (no change). Returns { health }. Never throws.
  function heal(obj, amount) {
    try {
      if (!obj || typeof obj !== 'object') return { health: 0 };
      normalizeHealth(obj);
      var amt = saneNum(amount, 0);
      if (amt < 0) amt = 0;
      obj.health = clamp(obj.health + amt, 0, obj.maxHealth);
      return { health: obj.health };
    } catch (e) {
      return { health: 0 };
    }
  }

  // Write an exact health value, clamped into 0..maxHealth. A bad
  // value reads as the current health (no change). Returns the new
  // health. Never throws.
  function setHealth(obj, value) {
    try {
      if (!obj || typeof obj !== 'object') return 0;
      normalizeHealth(obj);
      if (value == null || value === '' || !isFinite(Number(value))) return obj.health;
      obj.health = clamp(Number(value), 0, obj.maxHealth);
      return obj.health;
    } catch (e) {
      return 0;
    }
  }

  // Write a new ceiling (1..10000, default 100 on a bad value) and
  // re-clamp the current health to it, so a lowered max never leaves
  // health above the bar. Returns { maxHealth, health }. Never throws.
  function setMaxHealth(obj, value) {
    try {
      if (!obj || typeof obj !== 'object') {
        return { maxHealth: DEFAULT_MAX_HEALTH, health: DEFAULT_MAX_HEALTH };
      }
      normalizeHealth(obj);
      obj.maxHealth = normalizeMaxHealth(value);
      obj.health = clamp(obj.health, 0, obj.maxHealth);
      return { maxHealth: obj.maxHealth, health: obj.health };
    } catch (e) {
      return { maxHealth: DEFAULT_MAX_HEALTH, health: DEFAULT_MAX_HEALTH };
    }
  }

  // --- Health bar ----------------------------------------------------------

  // The bar's rectangle in world coordinates: as wide as the object
  // (at least 24px, so a tiny coin still shows a readable bar), 6px
  // tall, centered on the object's center, 10px above its top edge.
  // Returns { x, y, w, h, fraction } — the draw reads the same rect,
  // so a test can pin the geometry without a canvas.
  function healthBarRect(obj) {
    try {
      var w = BAR_MIN_WIDTH, h = 0, cx = 0, top = 0;
      if (obj && typeof obj === 'object') {
        w = Math.max(BAR_MIN_WIDTH, saneNum(obj.width, 0));
        h = saneNum(obj.height, 0);
        // The bar centers on the object's own width, not the min
        // width: a 40px sprite gets a 40px bar centered on itself.
        cx = saneNum(obj.posX, 0) + saneNum(obj.width, 0) / 2;
        top = saneNum(obj.posY, 0);
      }
      return {
        x: cx - w / 2,
        y: top - BAR_GAP - BAR_HEIGHT,
        w: w,
        h: BAR_HEIGHT,
        fraction: healthFraction(obj)
      };
    } catch (e) {
      return { x: 0, y: -BAR_GAP - BAR_HEIGHT, w: BAR_MIN_WIDTH, h: BAR_HEIGHT, fraction: 1 };
    }
  }

  // The fill color for a fraction: green while over half, amber while
  // over a quarter, red below — the player reads the danger at a
  // glance without reading a number.
  function healthBarColor(fraction) {
    var f = saneNum(fraction, 1);
    if (f > 0.5) return BAR_GREEN;
    if (f > 0.25) return BAR_AMBER;
    return BAR_RED;
  }

  // Paint the bar in screen space, in the same translated space as
  // the preview's name label: info is { cx, cy, camX, camY, zoom,
  // fixed } for the object (center, camera, zoom, screen-fixed flag),
  // so the bar follows the camera, the zoom, and the parallax camera
  // exactly like the sprite it belongs to, and stays put for a
  // screen-fixed widget. Draws a dark background, the colored fill,
  // and a thin border. Returns true when something was drawn, false
  // when the bar is off, the object is dead (nothing left to show),
  // or the context cannot draw. Never throws.
  function drawHealthBar(ctx, obj, info) {
    try {
      if (!ctx || typeof ctx !== 'object') return false;
      if (!obj || typeof obj !== 'object') return false;
      if (obj.showHealthBar !== true) return false;
      if (typeof ctx.fillRect !== 'function') return false;
      var rect = healthBarRect(obj);
      var fraction = rect.fraction;
      if (fraction <= 0) return false;
      var inf = (info && typeof info === 'object') ? info : {};
      var cx = saneNum(inf.cx, 0);
      var cy = saneNum(inf.cy, 0);
      var camX = saneNum(inf.camX, 0);
      var camY = saneNum(inf.camY, 0);
      var zoom = saneNum(inf.zoom, 1);
      var fixed = inf.fixed === true;
      // The bar's world position: centered on the object center, above
      // its top edge. The same translate/scale the name label uses.
      var barW = rect.w;
      var barH = rect.h;
      var barX = cx - barW / 2;
      var barY = cy - saneNum(obj.height, 0) / 2 - BAR_GAP - BAR_HEIGHT;
      ctx.save();
      if (!fixed && zoom !== 1) ctx.scale(zoom, zoom);
      if (!fixed) ctx.translate(-camX, -camY);
      ctx.fillStyle = BAR_BG;
      ctx.fillRect(barX, barY, barW, barH);
      ctx.fillStyle = healthBarColor(fraction);
      ctx.fillRect(barX, barY, Math.max(0, barW * fraction), barH);
      if (typeof ctx.strokeRect === 'function') {
        ctx.strokeStyle = BAR_BORDER;
        ctx.lineWidth = 1;
        ctx.strokeRect(barX + 0.5, barY + 0.5, barW - 1, barH - 1);
      }
      ctx.restore();
      return true;
    } catch (e) {
      try { ctx.restore(); } catch (e2) { /* a throwing draw never breaks the frame */ }
      return false;
    }
  }

  // --- Routing -------------------------------------------------------------

  function isHealthAction(type) {
    return type === 'damageObject' || type === 'healObject' ||
      type === 'setHealth' || type === 'setMaxHealth';
  }

  function isHealthCondition(type) {
    return type === 'healthCheck' || type === 'objectDied';
  }

  return {
    DEFAULT_MAX_HEALTH: DEFAULT_MAX_HEALTH,
    MIN_MAX_HEALTH: MIN_MAX_HEALTH,
    MAX_MAX_HEALTH: MAX_MAX_HEALTH,
    BAR_HEIGHT: BAR_HEIGHT,
    BAR_GAP: BAR_GAP,
    BAR_MIN_WIDTH: BAR_MIN_WIDTH,
    normalizeMaxHealth: normalizeMaxHealth,
    normalizeHealthValue: normalizeHealthValue,
    normalizeHealth: normalizeHealth,
    healthOf: healthOf,
    healthFraction: healthFraction,
    isDead: isDead,
    damage: damage,
    heal: heal,
    setHealth: setHealth,
    setMaxHealth: setMaxHealth,
    healthBarRect: healthBarRect,
    healthBarColor: healthBarColor,
    drawHealthBar: drawHealthBar,
    isHealthAction: isHealthAction,
    isHealthCondition: isHealthCondition
  };
}

if (typeof window !== 'undefined') {
  window.HydraHealth = hydraHealthFactory();
  // Self-contained source of the factory, inlined into exported playable games
  // by HydraPlayer.buildPlayableHtml so exports run without editor files.
  window.HydraHealth.factorySource = hydraHealthFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraHealthFactory;
