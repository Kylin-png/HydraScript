/* ============================================================================
 * hydra-camerafx.js — HydraScript shared camera effects (P2 item 15/12,
 * slice 1: the shared-engine extraction starts here).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation of
 * the screen-shake and screen-flash effects used by:
 *   - the editor preview runtime (script.js delegates to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Why this slice first: shake and flash were the smallest subsystem the two
 * runtimes duplicated verbatim — same state shape, same clamps, same decay
 * clock, same fade math, same draw-time alpha/offset — and the flash block
 * (cycle 60) had just been mirrored into both by hand. Moving this one
 * subsystem proves the extraction pattern (shared pure module, factorySource,
 * hard load guard in player-runtime.js, guarded calls in the preview) before
 * the larger slices (per-frame update, scene loading, draw) follow it.
 *
 * Semantics (identical in preview and exports — changing anything here
 * changes both runtimes at once, which is the point):
 *   - Shake: a strength (pixels) and a timeLeft in ms. Firing replaces the
 *     running shake outright (no stacking). The offset is a fresh random
 *     jitter in [-strength, +strength] on each axis, read at draw time, so
 *     the picture wiggles every frame while the shake runs.
 *   - Flash: a fullscreen color wash that fades linearly from full intensity
 *     to transparent over its duration (alpha = intensity * timeLeft /
 *     maxTime), drawn above the HUD and below the profiler overlay. A bad
 *     color never fires: triggerFlash returns false and the old flash is
 *     held untouched (the host warns). Intensity clamps to 0-1; a zero or
 *     negative duration still records the flash with timeLeft 0, so it
 *     draws nothing (a no-op flash, not a stale one).
 *   - Decay runs inside the unpaused update in both runtimes, so shake and
 *     flash freeze while paused exactly like the rest of the world sim.
 *     The decay clock is dt * 16.67 ms per frame, the same clock the shake
 *     has always used (dt is frames, 1 = one 60fps frame).
 *   - Triggers mutate the records in place and never replace them, so a
 *     host that aliased the record (or a test that captured it) keeps
 *     reading live state. Nothing here ever throws: corrupt records are
 *     repaired in place, null records degrade to safe defaults, and
 *     non-finite numbers read as 0.
 *
 * Load order (index.html): hydra-camerafx.js BEFORE player-runtime.js and
 * script.js. player-runtime.js throws a clear error if HydraCameraFx is
 * missing. The preview guards every call (window.HydraCameraFx), so the
 * editor still boots if the tag is ever dropped — shake/flash just stop
 * firing, the same degradation the other guarded modules use.
 * ========================================================================== */

function hydraCameraFxFactory() {
  'use strict';

  // #rgb or #rrggbb, after trimming. The same test both runtimes used
  // inline before this module existed.
  function isValidHexColor(v) {
    return typeof v === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v.trim());
  }

  // A finite number, or 0 for anything else (NaN, Infinity, strings,
  // null). Negative values are floored at 0 when `floorZero` is set.
  function num(v, floorZero) {
    var n = Number(v);
    if (!isFinite(n)) return 0;
    return floorZero && n < 0 ? 0 : n;
  }

  // Fresh shake record: { strength, timeLeft }. Both start at 0, so a
  // fresh game never shakes.
  function createShake() {
    return { strength: 0, timeLeft: 0 };
  }

  // Fresh flash record: { color, intensity, timeLeft, maxTime }. Intensity
  // and both times start at 0, so a fresh game draws no wash.
  function createFlash() {
    return { color: '#ffffff', intensity: 0, timeLeft: 0, maxTime: 0 };
  }

  // Repair a shake record in place (a saved/corrupt record, or a legacy
  // state that never had one). A null/non-object record becomes a fresh
  // one. Returns the record.
  function normalizeShake(shake) {
    if (!shake || typeof shake !== 'object') return createShake();
    shake.strength = num(shake.strength, true);
    shake.timeLeft = num(shake.timeLeft, true);
    return shake;
  }

  // Repair a flash record in place. A bad color falls back to white (the
  // old behavior for a corrupt record was to keep drawing with whatever
  // string was there; white is the documented default). Intensity clamps
  // to 0-1. Returns the record.
  function normalizeFlash(flash) {
    if (!flash || typeof flash !== 'object') return createFlash();
    var color = typeof flash.color === 'string' ? flash.color.trim() : '';
    flash.color = isValidHexColor(color) ? color : '#ffffff';
    var intensity = num(flash.intensity, false);
    flash.intensity = Math.min(1, Math.max(0, intensity));
    flash.timeLeft = num(flash.timeLeft, true);
    flash.maxTime = num(flash.maxTime, true);
    return flash;
  }

  // Fire a shake: replaces any running shake outright. Strength and
  // duration clamp at 0 (a negative strength or duration can never put
  // the record into a state the draw pass misreads). Mutates in place
  // and returns the record.
  function triggerShake(shake, strength, durationMs) {
    shake = normalizeShake(shake);
    shake.strength = num(strength, true);
    shake.timeLeft = num(durationMs, true);
    return shake;
  }

  // Fire a flash. Returns true when it fired, false when the color is not
  // a valid hex color — in that case the record is left completely
  // untouched (the old flash holds, exactly as both runtimes behaved
  // before). Intensity clamps to 0-1; a zero/negative duration records a
  // flash with timeLeft 0, which draws nothing.
  function triggerFlash(flash, color, intensity, durationMs) {
    flash = normalizeFlash(flash);
    var c = typeof color === 'string' ? color.trim() : '';
    if (!isValidHexColor(c)) return false;
    var ms = num(durationMs, true);
    var inten = num(intensity, false);
    flash.color = c;
    flash.intensity = Math.min(1, Math.max(0, inten));
    flash.timeLeft = ms;
    flash.maxTime = ms;
    return true;
  }

  // Decay both effects by dtMs (ms per frame, dt * 16.67 in the runtimes).
  // A non-finite or negative step decays nothing. Null records are safe.
  // Time never goes below 0.
  function decay(shake, flash, dtMs) {
    var ms = num(dtMs, true);
    if (ms === 0) return;
    if (shake && typeof shake === 'object') {
      shake.timeLeft = Math.max(0, num(shake.timeLeft, true) - ms);
    }
    if (flash && typeof flash === 'object') {
      flash.timeLeft = Math.max(0, num(flash.timeLeft, true) - ms);
    }
  }

  // The draw-time shake offset: {0, 0} when no shake is running (or the
  // strength is 0), else a fresh random jitter in [-strength, +strength]
  // on each axis. Read once per frame by the draw pass.
  function shakeOffset(shake) {
    if (!shake || typeof shake !== 'object') return { x: 0, y: 0 };
    var strength = num(shake.strength, true);
    if (strength <= 0 || num(shake.timeLeft, true) <= 0) return { x: 0, y: 0 };
    return {
      x: (Math.random() * 2 - 1) * strength,
      y: (Math.random() * 2 - 1) * strength
    };
  }

  // The draw-time flash alpha: 0 when no flash is running (or the
  // intensity is 0, or maxTime is 0), else the linear fade
  // intensity * timeLeft / maxTime, clamped to 0-1.
  function flashAlpha(flash) {
    if (!flash || typeof flash !== 'object') return 0;
    var intensity = num(flash.intensity, false);
    var timeLeft = num(flash.timeLeft, true);
    var maxTime = num(flash.maxTime, true);
    if (intensity <= 0 || timeLeft <= 0 || maxTime <= 0) return 0;
    return Math.min(1, Math.max(0, intensity * (timeLeft / maxTime)));
  }

  return {
    isValidHexColor: isValidHexColor,
    createShake: createShake,
    createFlash: createFlash,
    normalizeShake: normalizeShake,
    normalizeFlash: normalizeFlash,
    triggerShake: triggerShake,
    triggerFlash: triggerFlash,
    decay: decay,
    shakeOffset: shakeOffset,
    flashAlpha: flashAlpha
  };
}

window.HydraCameraFx = hydraCameraFxFactory();
// Self-contained source of the factory, inlined into exported playable games
// by HydraPlayer.buildPlayableHtml so exports run without editor files.
window.HydraCameraFx.factorySource = hydraCameraFxFactory.toString();
