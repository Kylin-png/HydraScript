/* ============================================================================
 * hydra-boss.js — HydraScript shared boss encounters (P4 Advanced
 * batch 33: boss encounters, beginner edition).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation
 * of how a run's big fight works — used by:
 *   - the editor preview runtime (hydra-previewruntime.js delegates
 *     to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Idea (Unity boss fights / Godot boss patterns, beginner edition):
 * batch 32 let the enemies scale with the hero, but there was still
 * no big fight at the end of a run. A boss is one named object with
 * health phases and a wide health bar across the top of the screen:
 *
 *   start — Start Boss names the boss object (by name, so a boss that
 *     spawns later still counts), picks how many phases the fight has
 *     (2–5, default 3), and shows the bar. Starting a second boss
 *     replaces the first: one boss at a time.
 *   phases — equal slices of the boss's health bar, derived live from
 *     the health fraction, never stored: with 3 phases, phase 1 runs
 *     from full health down to two thirds, phase 2 to one third,
 *     phase 3 to the end. The phase number is the hook the author
 *     hangs behavior on — Boss Phase == 2 → Set AI Behavior faster,
 *     Set Scaling Rates harder, Start Spawner for minions. A boss
 *     that has not spawned yet reads phase 0 and shows no bar until
 *     a live object with its name exists.
 *   bar — a wide centered bar across the top of the screen with the
 *     boss's name above it, green over half, amber over a quarter,
 *     red below (the per-object health bar's colors). It draws only
 *     while a boss is active, the bar is on, and a live object with
 *     the boss's name exists — the draw module asks the module for
 *     the bar's geometry and paints it in the HUD pass.
 *   end — End Boss clears the fight (the bar hides). Nothing ends it
 *     on its own: the killing blow fires Object Died like any other
 *     death, so the author chains End Boss after it — and can show
 *     the win screen, hand out XP, or unlock the next level on the
 *     same row.
 *
 * The boss state is transient per-run run state (fresh on boot, like
 * the XP total and the lives count; it survives scene switches inside
 * a run, and resets only on the next run). It never travels in save
 * slots — persist the phase through Read Boss Phase into a variable
 * the way quests and inventory do. There is deliberately no
 * scene-reset hook for it.
 *
 * Nothing ever throws; hostile input degrades to safe defaults.
 *
 * Honest limits: one boss at a time; phases are equal health slices,
 * not custom thresholds — the author picks the behavior per phase
 * with ordinary blocks; the bar shows the first live object with the
 * boss's name; a boss that has not spawned yet reads phase 0 and
 * shows no bar until it exists; no `hs` script-API surface yet.
 *
 * Load order (index.html): hydra-boss.js BEFORE player-runtime.js
 * and script.js. player-runtime.js throws a clear error if HydraBoss
 * is missing.
 * ========================================================================== */

function hydraBossFactory() {
  'use strict';

  var DEFAULT_PHASES = 3;
  var MIN_PHASES = 2;
  var MAX_PHASES = 5;
  var BAR_HEIGHT = 18;
  var BAR_MAX_WIDTH = 560;
  var BAR_WIDTH_FRACTION = 0.6;
  var BAR_TOP = 24;
  var BAR_BG = 'rgba(0,0,0,0.55)';
  var BAR_BORDER = 'rgba(0,0,0,0.6)';
  var BAR_GREEN = '#22c55e';
  var BAR_AMBER = '#f59e0b';
  var BAR_RED = '#ef4444';

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

  function clamp(v, lo, hi) {
    if (!isFinite(v)) return lo;
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
  }

  // The state itself, or null for a missing / non-object state — the
  // callers below degrade to "no boss fight" instead of throwing, so
  // a dropped module tag reads the same as a game that never started
  // a boss.
  function stateOf(state) {
    return (state && typeof state === 'object') ? state : null;
  }

  // --- Normalizers ---------------------------------------------------------

  // How many phases the fight has: a whole number 2–5, default 3.
  // 1 would make the whole fight one phase (no phase change to hook
  // behavior on), so it reads as the default instead.
  function normalizePhaseCount(v) {
    var n = saneNum(v, DEFAULT_PHASES);
    if (n < MIN_PHASES) return DEFAULT_PHASES;
    if (n > MAX_PHASES) return MAX_PHASES;
    return Math.floor(n);
  }

  // --- State ---------------------------------------------------------------

  // A fresh transient boss state for a run: no boss fight anywhere.
  // The hosts mint one per run (the export at state creation, the
  // preview lazily through bossRuntime) — never per scene, so the
  // fight survives scene switches inside the run.
  function createBossState() {
    return { active: false, objectName: '', phases: DEFAULT_PHASES, barVisible: false };
  }

  // --- Reads ---------------------------------------------------------------

  // True while a boss fight is running. A missing state reads as no
  // fight, never as an error.
  function isActive(state) {
    try {
      var st = stateOf(state);
      return !!st && st.active === true && typeof st.objectName === 'string' && st.objectName !== '';
    } catch (e) {
      return false;
    }
  }

  // The boss's health fraction, 0..1, from a live object — through
  // the shared HydraHealth module when the caller passes it, or from
  // the raw health fields when it does not. A missing object reads as
  // null (no boss to measure), never as full health: a boss that has
  // not spawned yet must read as absent, not as unhurt. Never throws.
  function fractionOf(obj, healthModule) {
    try {
      if (!obj || typeof obj !== 'object') return null;
      if (healthModule && typeof healthModule.healthFraction === 'function') {
        var f = healthModule.healthFraction(obj);
        if (isFinite(f)) return clamp(f, 0, 1);
      }
      var max = Number(obj.maxHealth);
      if (!isFinite(max) || max <= 0) max = 100;
      var h = Number(obj.health);
      if (!isFinite(h)) h = max;
      return clamp(h / max, 0, 1);
    } catch (e) {
      return null;
    }
  }

  // The phase number for a health fraction with a phase count: equal
  // slices of the bar, phase 1 at full health, the last phase in the
  // final slice. A missing or non-finite fraction reads as 0 — no
  // boss to phase. Never throws.
  function phaseOf(fraction, phases) {
    try {
      // Only real numbers or numeric strings count as a fraction —
      // an array, an object, or a boolean is not a health reading
      // (Number([]) is 0, which would silently read as a dead boss
      // instead of no reading — the cycle-13 strict-coercion lesson).
      var f;
      if (typeof fraction === 'number') f = fraction;
      else if (typeof fraction === 'string' && fraction.trim() !== '') f = Number(fraction);
      else return 0;
      if (!isFinite(f)) return 0;
      var n = normalizePhaseCount(phases);
      f = clamp(f, 0, 1);
      var p = n - Math.floor(f * n);
      if (p < 1) p = 1;
      if (p > n) p = n;
      return p;
    } catch (e) {
      return 0;
    }
  }

  // The current phase number for a boss state and a live health
  // fraction: 0 when no fight is running, else the slice the fraction
  // sits in. Never throws.
  function phaseOfState(state, fraction) {
    try {
      var st = stateOf(state);
      if (!st || !isActive(st)) return 0;
      return phaseOf(fraction, st.phases);
    } catch (e) {
      return 0;
    }
  }

  // --- Writes --------------------------------------------------------------

  // Start a boss fight: the named object is the boss, the fight has
  // this many phases, and the bar shows unless the caller says not
  // to. The name is recorded even when no live object matches it yet
  // — a boss that spawns later still counts, and the bar appears
  // when it does. A blank name changes nothing and returns null, so
  // the caller can warn and hold. Returns the state. Never throws.
  function startBoss(state, objectName, phases, showBar) {
    try {
      var st = stateOf(state);
      if (!st) return null;
      var name = (objectName == null) ? '' : String(objectName).trim();
      if (name === '') return null;
      st.active = true;
      st.objectName = name;
      st.phases = normalizePhaseCount(phases);
      st.barVisible = showBar !== false;
      return st;
    } catch (e) {
      return null;
    }
  }

  // End the boss fight: the bar hides and the phase reads 0 again.
  // Returns the state, or null when there is no state. Never throws.
  function endBoss(state) {
    try {
      var st = stateOf(state);
      if (!st) return null;
      st.active = false;
      st.objectName = '';
      st.barVisible = false;
      return st;
    } catch (e) {
      return null;
    }
  }

  // Show or hide the bar without ending the fight (a cutscene can
  // hide it, the boss intro can bring it back). Quiet when no fight
  // is running. Returns the state, or null when there is no state.
  // Never throws.
  function setBarVisible(state, visible) {
    try {
      var st = stateOf(state);
      if (!st) return null;
      if (st.active === true) st.barVisible = visible === true;
      return st;
    } catch (e) {
      return null;
    }
  }

  // --- Boss bar ------------------------------------------------------------

  // The bar's rectangle in screen coordinates: as wide as 60% of the
  // view (at most 560px, so a wide monitor still reads as one bar),
  // 18px tall, centered, 24px from the top edge, with the boss's
  // name above it. Returns { x, y, w, h, labelY } — the draw reads
  // the same rect, so a test can pin the geometry without a canvas.
  function bossBarRect(viewW, viewH) {
    try {
      var vw = saneNum(viewW, 0);
      if (vw < 0) vw = 0;
      var w = Math.min(vw * BAR_WIDTH_FRACTION, BAR_MAX_WIDTH);
      if (w < 0) w = 0;
      return {
        x: (vw - w) / 2,
        y: BAR_TOP,
        w: w,
        h: BAR_HEIGHT,
        labelY: BAR_TOP - 8
      };
    } catch (e) {
      return { x: 0, y: BAR_TOP, w: 0, h: BAR_HEIGHT, labelY: BAR_TOP - 8 };
    }
  }

  // The fill color for a fraction: green while over half, amber while
  // over a quarter, red below — the per-object health bar's colors,
  // so a boss at a glance reads the same as any enemy.
  function bossBarColor(fraction) {
    var f = saneNum(fraction, 1);
    if (f > 0.5) return BAR_GREEN;
    if (f > 0.25) return BAR_AMBER;
    return BAR_RED;
  }

  // Paint the bar in screen space: the boss's name centered above
  // it (white over a dark offset copy, so it reads on any scene),
  // then a dark background, the colored fill, and a thin border.
  // Returns true when something was drawn, false when the name is
  // blank, the fraction is missing, the view is too narrow for a
  // bar, or the context cannot draw. Never throws.
  function drawBossBar(ctx, name, fraction, viewW, viewH) {
    try {
      if (!ctx || typeof ctx !== 'object') return false;
      if (typeof ctx.fillRect !== 'function') return false;
      var label = (name == null) ? '' : String(name).trim();
      if (label === '') return false;
      if (fraction == null || !isFinite(Number(fraction))) return false;
      var rect = bossBarRect(viewW, viewH);
      if (rect.w <= 0) return false;
      var f = clamp(Number(fraction), 0, 1);
      ctx.save();
      if (typeof ctx.fillText === 'function') {
        try { ctx.font = 'bold 13px sans-serif'; } catch (e) { /* a recording context may not take a font */ }
        try { ctx.textAlign = 'center'; } catch (e) { /* same */ }
        try {
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillText(label, rect.x + rect.w / 2, rect.labelY + 1);
          ctx.fillStyle = '#ffffff';
          ctx.fillText(label, rect.x + rect.w / 2, rect.labelY);
        } catch (e) { /* a throwing text draw never breaks the frame */ }
      }
      ctx.fillStyle = BAR_BG;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.fillStyle = bossBarColor(f);
      ctx.fillRect(rect.x, rect.y, Math.max(0, rect.w * f), rect.h);
      if (typeof ctx.strokeRect === 'function') {
        ctx.strokeStyle = BAR_BORDER;
        ctx.lineWidth = 1;
        ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
      }
      ctx.restore();
      return true;
    } catch (e) {
      try { ctx.restore(); } catch (e2) { /* a throwing draw never breaks the frame */ }
      return false;
    }
  }

  // --- Routing -------------------------------------------------------------

  function isBossAction(type) {
    return type === 'startBoss' || type === 'endBoss' ||
      type === 'showBossBar' || type === 'hideBossBar' ||
      type === 'readBossPhase';
  }

  function isBossCondition(type) {
    return type === 'bossPhase' || type === 'bossActive';
  }

  return {
    DEFAULT_PHASES: DEFAULT_PHASES,
    MIN_PHASES: MIN_PHASES,
    MAX_PHASES: MAX_PHASES,
    BAR_HEIGHT: BAR_HEIGHT,
    BAR_MAX_WIDTH: BAR_MAX_WIDTH,
    BAR_WIDTH_FRACTION: BAR_WIDTH_FRACTION,
    BAR_TOP: BAR_TOP,
    normalizePhaseCount: normalizePhaseCount,
    createBossState: createBossState,
    isActive: isActive,
    fractionOf: fractionOf,
    phaseOf: phaseOf,
    phaseOfState: phaseOfState,
    startBoss: startBoss,
    endBoss: endBoss,
    setBarVisible: setBarVisible,
    bossBarRect: bossBarRect,
    bossBarColor: bossBarColor,
    drawBossBar: drawBossBar,
    isBossAction: isBossAction,
    isBossCondition: isBossCondition
  };
}

if (typeof window !== 'undefined') {
  window.HydraBoss = hydraBossFactory();
  // Self-contained source of the factory, inlined into exported playable games
  // by HydraPlayer.buildPlayableHtml so exports run without editor files.
  window.HydraBoss.factorySource = hydraBossFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraBossFactory;
