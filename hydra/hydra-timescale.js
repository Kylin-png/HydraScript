/* ============================================================================
 * hydra-timescale.js — HydraScript shared time scale / slow motion
 * (P4 Advanced batch 13: the whole game clock runs faster or slower).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation
 * of time scale used by:
 *   - the editor preview runtime (hydra-previewruntime.js delegates
 *     to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Idea (Unity Time.timeScale / Unreal global time dilation / Godot
 * Engine.time_scale, beginner edition): one number, the scale, says
 * how fast the game world runs. 1 is normal speed. 0.3 is slow motion
 * (a dramatic death, a bullet-time dodge), 0.5 is half speed, 2 is
 * double speed, 0 freezes the world outright (scripts and buttons
 * keep running, so a block can always unfreeze it). Blocks set the
 * scale, reset it to 1, read it into a variable, and gate on it; the
 * condition is a plain state read, like Language Is.
 *
 * What the scale slows: everything that advances on the frame dt —
 * physics, sprite animations, blend spaces, skeletal animation,
 * tweens, particles, camera shake/flash decay, cutscene clocks, and
 * dialogue typing — plus the NAMED TIMERS, which read the game clock.
 * The game clock is the wall clock minus paused time minus the
 * time-scale debt: every unpaused frame banks realMs * (1 - scale)
 * into state.timeScaleDebtMs (noteScaledFrame), and HydraPause.gameNow
 * subtracts that debt alongside the paused time. At scale 1 the debt
 * grows by zero, so old games keep byte-identical timer behavior; at
 * scale 0.5 a 3-second timer takes 6 real seconds, the way Unity's
 * WaitForSeconds does under timeScale 0.5. Above scale 1 the debt
 * goes negative and the clock runs ahead of the wall clock (a
 * 3-second timer takes 1.5 real seconds at scale 2), the way Unity's
 * Time.time does under timeScale 2. The debt resets with the
 * per-scene game clock (HydraSceneReset, next to pausedElapsedMs).
 *
 * What the scale never slows: scripts, input, and buttons. The grids
 * run every frame at full speed whatever the scale is, keys and
 * actions still register, and a pause menu still clicks — so a
 * slow-motion death can always end in a "press R to retry" block, and
 * a freeze at scale 0 is never a dead end. The profiler's FPS stays
 * honest too: it reads real timestamps, not scaled dt.
 *
 *   Player dies -> Set Time Scale 0.3, Show "Game Over" after 2s
 *   (the timer takes 6 real seconds to fire, so the slow fall plays out)
 *   Key Just Pressed (R) -> Reset Time Scale, Restart Scene
 *   Time Scale < 1 -> Show "SLOW-MO" badge
 *
 * Runtime state (NOT part of the save-slot payload; per-run state):
 *   { scale: 1 }
 * The scale is run-level: it survives scene switches inside a run,
 * like the language, and resets only on a fresh run. It never travels
 * in save slots (slots store game variables only — read the scale into
 * a variable first if a save must remember it). The debt is NOT part
 * of this runtime: it lives on the host's run state next to
 * pausedElapsedMs, because it belongs to the game clock, and the
 * scene reset clears it with the rest of the clock.
 *
 * A non-numeric scale warns and holds (the old scale stays); a scale
 * outside 0..4 clamps (below 0 reads as 0, above 4 reads as 4). The
 * scaled frame step never exceeds the engine's 3-unit dt cap, so a
 * big hitch at 4x speed cannot tunnel physics. Nothing ever throws;
 * hostile input degrades to safe defaults.
 *
 * Honest limits: there is no hs script-API surface yet — use the
 * blocks; there is no smooth ramp, the scale changes at once (ramp it
 * yourself with repeated Set Time Scale, e.g. every frame toward the
 * target); dialogue typing slows with the world, including while
 * paused, because the typewriter reads the same scaled dt. Old
 * projects have no time-scale blocks and behave exactly as before.
 *
 * Load order (index.html): hydra-timescale.js BEFORE player-runtime.js
 * and script.js. player-runtime.js throws a clear error if
 * HydraTimeScale is missing.
 * ========================================================================== */

function hydraTimeScaleFactory() {
  'use strict';

  var DEFAULT_SCALE = 1;
  var MIN_SCALE = 0;
  var MAX_SCALE = 4;
  // The engine's per-frame dt cap (HydraFrame.computeDt caps dt at 3):
  // the scaled step never exceeds it, so a hitch at 4x speed cannot
  // tunnel physics any further than a hitch at normal speed.
  var DT_CAP = 3;

  // The scale as a number: finite values clamp to 0..4, anything else
  // reads as the 1 default. A missing value (null / undefined / an
  // empty string) is not a 0 — it means "no scale given" and reads
  // as the default. (A blank editor field still evaluates to 0
  // through the expression evaluator, the engine-wide blank-means-0
  // rule, so clearing the Scale field really does freeze the world.)
  // Never throws.
  function normalizeTimeScale(value) {
    try {
      if (value == null) return DEFAULT_SCALE;
      if (typeof value === 'string' && value.trim() === '') return DEFAULT_SCALE;
      var n = Number(value);
      if (!isFinite(n)) return DEFAULT_SCALE;
      if (n < MIN_SCALE) return MIN_SCALE;
      if (n > MAX_SCALE) return MAX_SCALE;
      return n;
    } catch (e) {
      return DEFAULT_SCALE;
    }
  }

  // A fresh time-scale runtime: normal speed.
  function createTimeScaleRuntime() {
    return { scale: DEFAULT_SCALE };
  }

  function isRuntime(rt) {
    return !!rt && typeof rt === 'object';
  }

  // The current scale: the runtime's scale, normalized, or 1 when the
  // runtime is missing or corrupt. Never throws.
  function timeScaleOf(rt) {
    try {
      if (!isRuntime(rt)) return DEFAULT_SCALE;
      return normalizeTimeScale(rt.scale);
    } catch (e) {
      return DEFAULT_SCALE;
    }
  }

  function warnHook(hooks, msg) {
    try {
      if (hooks && typeof hooks.warn === 'function') hooks.warn(msg);
    } catch (e) { /* a throwing warn never breaks the clock */ }
  }

  // Set the scale. A non-numeric value warns and holds (the old scale
  // stays); any other value clamps to 0..4. Returns the scale that is
  // now in effect (1 when the runtime itself is missing).
  function setTimeScale(rt, value, hooks) {
    try {
      if (!isRuntime(rt)) return DEFAULT_SCALE;
      var n = Number(value);
      if (!isFinite(n)) {
        warnHook(hooks, 'Set Time Scale: the scale is not a number. Nothing changed.');
        return timeScaleOf(rt);
      }
      rt.scale = normalizeTimeScale(n);
      return rt.scale;
    } catch (e) {
      return DEFAULT_SCALE;
    }
  }

  // Back to normal speed. Returns 1 (or 1 when the runtime is missing).
  function resetTimeScale(rt) {
    try {
      if (!isRuntime(rt)) return DEFAULT_SCALE;
      rt.scale = DEFAULT_SCALE;
      return DEFAULT_SCALE;
    } catch (e) {
      return DEFAULT_SCALE;
    }
  }

  // The frame step at the current scale: dt * scale, capped at the
  // engine's 3-unit dt cap. A non-finite or negative dt reads as 0.
  // Never throws.
  function scaledDt(dt, rt) {
    try {
      var d = Number(dt);
      if (!isFinite(d) || d < 0) return 0;
      var scaled = d * timeScaleOf(rt);
      return scaled > DT_CAP ? DT_CAP : scaled;
    } catch (e) {
      return 0;
    }
  }

  // Bank one unpaused frame's un-scaled portion into the game-clock
  // debt (state.timeScaleDebtMs), so HydraPause.gameNow — the clock
  // the named timers read — lags the wall clock exactly as much as
  // the world slowed. At scale 1 the banked amount is zero. A paused
  // frame banks nothing here: notePausedFrame already banks the full
  // realMs into pausedElapsedMs, and double-counting would freeze
  // the clock twice. The runtime may be passed explicitly as the
  // third argument (the preview's run state carries no timeScale
  // field — its runtime lives in the module closure); when it is
  // omitted, the scale is read off state.timeScale, which is how the
  // exported runtime carries it. A missing state, a missing scale,
  // or bad input is a quiet no-op. Never throws.
  function noteScaledFrame(state, realMs, rt) {
    try {
      if (!state || typeof state !== 'object') return;
      if (state.paused) return;
      var ms = Number(realMs);
      if (!isFinite(ms) || ms <= 0) return;
      var scale = timeScaleOf(rt === undefined ? state.timeScale : rt);
      var debt = ms * (1 - scale);
      if (debt === 0) return;
      var prev = Number(state.timeScaleDebtMs);
      // The debt may go negative (above scale 1 the clock runs ahead
      // of the wall clock), so only a non-finite previous debt reads
      // as 0 — never clamp it at 0.
      if (!isFinite(prev)) prev = 0;
      state.timeScaleDebtMs = prev + debt;
    } catch (e) { /* a throwing clock never breaks the frame */ }
  }

  function isTimeScaleAction(type) {
    return type === 'setTimeScale' || type === 'resetTimeScale' ||
      type === 'readTimeScale';
  }

  function isTimeScaleCondition(type) {
    return type === 'timeScale';
  }

  return {
    DEFAULT_SCALE: DEFAULT_SCALE,
    MIN_SCALE: MIN_SCALE,
    MAX_SCALE: MAX_SCALE,
    DT_CAP: DT_CAP,
    normalizeTimeScale: normalizeTimeScale,
    createTimeScaleRuntime: createTimeScaleRuntime,
    timeScaleOf: timeScaleOf,
    setTimeScale: setTimeScale,
    resetTimeScale: resetTimeScale,
    scaledDt: scaledDt,
    noteScaledFrame: noteScaledFrame,
    isTimeScaleAction: isTimeScaleAction,
    isTimeScaleCondition: isTimeScaleCondition
  };
}

if (typeof window !== 'undefined') {
  window.HydraTimeScale = hydraTimeScaleFactory();
  // Self-contained source of the factory, inlined into exported playable games
  // by HydraPlayer.buildPlayableHtml so exports run without editor files.
  window.HydraTimeScale.factorySource = hydraTimeScaleFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraTimeScaleFactory;
