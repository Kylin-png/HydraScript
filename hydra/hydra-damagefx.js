/* ============================================================================
 * hydra-damagefx.js — HydraScript shared damage feedback (P4 Advanced
 * batch 22: floating damage numbers, invincibility frames, knockback,
 * beginner edition).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation
 * of the feedback a hit produces — used by:
 *   - the editor preview runtime (hydra-previewruntime.js delegates
 *     to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Idea (Unity damage numbers / invincibility frames / knockback,
 * beginner edition): batch 21 gave every object hit points, but a hit
 * that only changes a number is invisible. Three small pieces make the
 * hit land:
 *
 *   numbers — Show Damage Number pops a floating number above the
 *     object: it rises 48px a second and fades out over 0.9 seconds,
 *     white bold text with a dark outline so it reads on any
 *     background. The numbers are transient run state (a fresh list
 *     per scene load, like particles), never saved in project JSON,
 *     and capped at 100 — the oldest number drops first, so a
 *     machine-gun never grows the list without bound. Place the block
 *     right after Damage Object with the same amount; the number is a
 *     display, it never changes the health itself.
 *   invincibility — Make Invincible writes obj._invincibleUntil on the
 *     frozen game clock (HydraPause.gameNow), so a 1-second shield
 *     lasts one game second even while the tab stutters, and freezes
 *     while paused like every other world timer. Damage Object skips
 *     an invincible target (quietly — invincibility is game state,
 *     not an authoring error), so the classic "hit, flash, brief
 *     shield" loop is two blocks: Damage Object, then Make
 *     Invincible. Heal and Set Health still apply to an invincible
 *     object — the shield blocks hits, not help. 0 seconds clears the
 *     shield at once. The record lives on the live object only; a
 *     fresh run starts vulnerable, and it never travels in save slots.
 *   knockback — Knockback Object pushes the target away from a source
 *     object (or an X/Y point when the source is blank) by adding
 *     direction * force to its velocity, the same write Apply Force
 *     makes — so it moves any non-static, non-text object and leaves
 *     the rest standing, exactly like Set Velocity does. A push from
 *     the object's own center has no direction, so it pushes straight
 *     up instead of doing nothing.
 *
 * Nothing ever throws; hostile input degrades to safe defaults.
 *
 * Honest limits: numbers are plain text popups (no crit styling, no
 * per-number size); invincibility blocks Damage Object only; knockback
 * needs a non-static, non-text object to move; no `hs`
 * script-API surface yet.
 *
 * Load order (index.html): hydra-damagefx.js BEFORE player-runtime.js
 * and script.js. player-runtime.js throws a clear error if HydraDamageFx
 * is missing.
 * ========================================================================== */

function hydraDamageFxFactory() {
  'use strict';

  var MAX_NUMBERS = 100;
  // Seconds a number lives, px per second it rises, and the last
  // seconds spent fading out — short enough to keep up with a fight,
  // long enough to read.
  var NUMBER_TTL = 0.9;
  var NUMBER_RISE = 48;
  var NUMBER_FADE = 0.3;
  var NUMBER_FONT = 'bold 16px sans-serif';
  var NUMBER_OUTLINE = 'rgba(0,0,0,0.8)';
  var DEFAULT_NUMBER_COLOR = '#ffffff';
  // Knockback force is a velocity in px/s: 300 shoves a body across a
  // room, 5000 is the cap so a typo never launches it off the map.
  var MAX_FORCE = 5000;
  var DEFAULT_FORCE = 300;
  // An invincibility shield longer than a minute is a design bug, not
  // a shield — clamp it.
  var MAX_SECONDS = 60;

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

  // A usable number, or the fallback when the value is not one — and
  // only a real number or a numeric string counts. An array, an
  // object, or a boolean is hostile input, not a number (Number([])
  // is 0 and Number(true) is 1, which would silently read as real
  // values instead of the fallback).
  function strictNum(v, fallback) {
    if (typeof v === 'number') return isFinite(v) ? v : fallback;
    if (typeof v === 'string' && v.trim() !== '') {
      var n = Number(v);
      return isFinite(n) ? n : fallback;
    }
    return fallback;
  }

  // --- Damage numbers ------------------------------------------------------

  // A fresh transient number list for a run / scene load. The list is
  // the whole state — numbers are display-only, so nothing else needs
  // to remember them.
  function createDamageNumberState() {
    return { numbers: [] };
  }

  function numbersOf(state) {
    if (!state || !Array.isArray(state.numbers)) return [];
    return state.numbers;
  }

  // A color string the canvas can paint, or the white default when the
  // value is not one. Any non-empty string passes through (named
  // colors work); an empty or non-string value reads as white.
  function normalizeNumberColor(value) {
    if (typeof value === 'string' && value.trim() !== '') return value;
    return DEFAULT_NUMBER_COLOR;
  }

  // Pop one number into the list at a world position: { x, y, text,
  // color }. The text is stored as a string, so an amount of 25 and
  // the word "MISS" both paint. A missing state or a missing position
  // reads as null (nothing spawned); a full list drops its oldest
  // number first, so a machine-gun never grows the list without
  // bound. Returns the record, or null. Never throws.
  function spawnDamageNumber(state, spec) {
    try {
      if (!state || typeof state !== 'object') return null;
      if (!Array.isArray(state.numbers)) state.numbers = [];
      if (!spec || typeof spec !== 'object') return null;
      var x = saneNum(spec.x, NaN);
      var y = saneNum(spec.y, NaN);
      if (!isFinite(x) || !isFinite(y)) return null;
      var text = (spec.text == null) ? '' : String(spec.text);
      if (text === '') return null;
      var rec = {
        x: x,
        y: y,
        text: text,
        color: normalizeNumberColor(spec.color),
        age: 0,
        ttl: NUMBER_TTL
      };
      if (state.numbers.length >= MAX_NUMBERS) state.numbers.shift();
      state.numbers.push(rec);
      return rec;
    } catch (e) {
      return null;
    }
  }

  // Advance every number by dt seconds: age grows, the number rises
  // NUMBER_RISE px a second, and numbers past their lifetime drop out
  // of the list. A dt of 0 or less holds still (the first frame, a
  // stalled tab); a missing state is a no-op. Never throws.
  function updateDamageNumbers(state, dtSeconds) {
    try {
      if (!state || !Array.isArray(state.numbers)) return;
      var dt = saneNum(dtSeconds, 0);
      if (dt <= 0) return;
      var list = state.numbers;
      for (var i = list.length - 1; i >= 0; i--) {
        var n = list[i];
        if (!n || typeof n !== 'object') { list.splice(i, 1); continue; }
        n.age = saneNum(n.age, 0) + dt;
        n.y = saneNum(n.y, 0) - NUMBER_RISE * dt;
        if (n.age >= saneNum(n.ttl, NUMBER_TTL)) list.splice(i, 1);
      }
    } catch (e) { /* a throwing number update never breaks the frame */ }
  }

  // Paint every live number in screen space, in the same translated
  // space as the particle pass: the caller scales by the zoom, and
  // this draws at x - camX, y - camY. Numbers outside the view (plus
  // a 40px margin, so a rising number is not cut mid-word) are
  // skipped. Each number is bold 16px text centered on its position,
  // with a dark outline so it reads on any background, fading out
  // over its last NUMBER_FADE seconds. Returns how many numbers were
  // drawn. Never throws.
  function drawDamageNumbers(ctx, state, camX, camY, viewW, viewH) {
    try {
      if (!ctx || typeof ctx !== 'object') return 0;
      if (typeof ctx.fillText !== 'function') return 0;
      var list = numbersOf(state);
      if (list.length === 0) return 0;
      var cx = saneNum(camX, 0);
      var cy = saneNum(camY, 0);
      var vw = saneNum(viewW, 0);
      var vh = saneNum(viewH, 0);
      var MARGIN = 40;
      var left = cx - MARGIN, top = cy - MARGIN;
      var right = cx + vw + MARGIN, bottom = cy + vh + MARGIN;
      var drawn = 0;
      ctx.save();
      try {
        ctx.font = NUMBER_FONT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (var i = 0; i < list.length; i++) {
          var n = list[i];
          if (!n || typeof n !== 'object') continue;
          var x = saneNum(n.x, NaN);
          var y = saneNum(n.y, NaN);
          if (!isFinite(x) || !isFinite(y)) continue;
          if (x < left || x > right || y < top || y > bottom) continue;
          var age = saneNum(n.age, 0);
          var ttl = saneNum(n.ttl, NUMBER_TTL);
          var remain = ttl - age;
          var alpha = 1;
          if (remain < NUMBER_FADE) alpha = clamp(remain / NUMBER_FADE, 0, 1);
          if (alpha <= 0) continue;
          ctx.globalAlpha = alpha;
          var sx = x - cx, sy = y - cy;
          if (typeof ctx.strokeText === 'function') {
            ctx.strokeStyle = NUMBER_OUTLINE;
            ctx.lineWidth = 3;
            ctx.strokeText(n.text, sx, sy);
          }
          ctx.fillStyle = normalizeNumberColor(n.color);
          ctx.fillText(n.text, sx, sy);
          drawn++;
        }
      } finally {
        try { ctx.globalAlpha = 1; } catch (e2) { /* a throwing reset never breaks the frame */ }
        ctx.restore();
      }
      return drawn;
    } catch (e) {
      try { ctx.restore(); } catch (e2) { /* a throwing draw never breaks the frame */ }
      return 0;
    }
  }

  // --- Invincibility frames ------------------------------------------------

  // The shield length in seconds: 0..60, default 1. A missing or
  // non-numeric value reads as the default; a negative reads as 0
  // (clear the shield, never a shield that already ended).
  function normalizeInvincibleSeconds(value) {
    return clamp(strictNum(value, 1), 0, MAX_SECONDS);
  }

  // The knockback push in px/s: 0..5000, default 300. A missing or
  // non-numeric value reads as the default; a negative reads as 0 (no
  // push, never a pull toward the source).
  function normalizeKnockbackForce(value) {
    return clamp(strictNum(value, DEFAULT_FORCE), 0, MAX_FORCE);
  }

  // Write the shield onto the live object: _invincibleUntil is the
  // frozen-game-clock ms the shield ends at (nowMs + seconds * 1000).
  // 0 seconds clears it at once (the record reads 0, so the object is
  // vulnerable again). Returns the until value, or 0 for a missing
  // object. Never throws.
  function makeInvincible(obj, seconds, nowMs) {
    try {
      if (!obj || typeof obj !== 'object') return 0;
      var secs = normalizeInvincibleSeconds(seconds);
      var now = saneNum(nowMs, 0);
      if (secs <= 0) { obj._invincibleUntil = 0; return 0; }
      obj._invincibleUntil = now + secs * 1000;
      return obj._invincibleUntil;
    } catch (e) {
      return 0;
    }
  }

  // True while the shield still holds at this frozen-game-clock ms.
  // A missing object, a missing record, or a non-numeric record reads
  // as vulnerable — a fresh object is never accidentally shielded.
  // Never throws.
  function isInvincible(obj, nowMs) {
    try {
      if (!obj || typeof obj !== 'object') return false;
      var until = obj._invincibleUntil;
      if (!isFinite(Number(until))) return false;
      return Number(until) > saneNum(nowMs, 0);
    } catch (e) {
      return false;
    }
  }

  // Seconds of shield left at this frozen-game-clock ms, 0 when the
  // object is vulnerable. Never throws.
  function invincibleRemainingSeconds(obj, nowMs) {
    try {
      if (!isInvincible(obj, nowMs)) return 0;
      var now = saneNum(nowMs, 0);
      return Math.max(0, (Number(obj._invincibleUntil) - now) / 1000);
    } catch (e) {
      return 0;
    }
  }

  // --- Knockback -----------------------------------------------------------

  // The push direction from a source point to a target point: a unit
  // vector, so the force is the same at any distance. A push from the
  // target's own center has no direction, so it pushes straight up
  // (0, -1) instead of doing nothing — an explosion under the player's
  // feet still launches them. Non-finite inputs read the same way.
  // Never throws.
  function knockbackDirection(fromX, fromY, toX, toY) {
    try {
      var fx = saneNum(fromX, NaN);
      var fy = saneNum(fromY, NaN);
      var tx = saneNum(toX, NaN);
      var ty = saneNum(toY, NaN);
      if (!isFinite(fx) || !isFinite(fy) || !isFinite(tx) || !isFinite(ty)) {
        return { x: 0, y: -1 };
      }
      var dx = tx - fx;
      var dy = ty - fy;
      var len = Math.sqrt(dx * dx + dy * dy);
      if (!(len > 0.001)) return { x: 0, y: -1 };
      return { x: dx / len, y: dy / len };
    } catch (e) {
      return { x: 0, y: -1 };
    }
  }

  // --- Routing -------------------------------------------------------------

  function isDamageFxAction(type) {
    return type === 'showDamageNumber' || type === 'makeInvincible' ||
      type === 'knockbackObject';
  }

  function isDamageFxCondition(type) {
    return type === 'isInvincible';
  }

  return {
    MAX_NUMBERS: MAX_NUMBERS,
    NUMBER_TTL: NUMBER_TTL,
    NUMBER_RISE: NUMBER_RISE,
    NUMBER_FADE: NUMBER_FADE,
    DEFAULT_NUMBER_COLOR: DEFAULT_NUMBER_COLOR,
    MAX_FORCE: MAX_FORCE,
    DEFAULT_FORCE: DEFAULT_FORCE,
    MAX_SECONDS: MAX_SECONDS,
    createDamageNumberState: createDamageNumberState,
    numbersOf: numbersOf,
    normalizeNumberColor: normalizeNumberColor,
    spawnDamageNumber: spawnDamageNumber,
    updateDamageNumbers: updateDamageNumbers,
    drawDamageNumbers: drawDamageNumbers,
    normalizeInvincibleSeconds: normalizeInvincibleSeconds,
    normalizeKnockbackForce: normalizeKnockbackForce,
    makeInvincible: makeInvincible,
    isInvincible: isInvincible,
    invincibleRemainingSeconds: invincibleRemainingSeconds,
    knockbackDirection: knockbackDirection,
    isDamageFxAction: isDamageFxAction,
    isDamageFxCondition: isDamageFxCondition
  };
}

if (typeof window !== 'undefined') {
  window.HydraDamageFx = hydraDamageFxFactory();
  // Self-contained source of the factory, inlined into exported playable games
  // by HydraPlayer.buildPlayableHtml so exports run without editor files.
  window.HydraDamageFx.factorySource = hydraDamageFxFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraDamageFxFactory;
