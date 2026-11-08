/* ============================================================================
 * hydra-pause.js — HydraScript shared pause/resume helpers (F4: pause).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation of
 * the engine pause state used by:
 *   - the editor preview runtime (script.js delegates to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Pause semantics (identical in preview and exports):
 *   - While paused, the world simulation freezes: physics integration,
 *     collision resolution, sprite animations, tweens, camera follow/shake,
 *     and named timers all stop advancing. The game keeps rendering every
 *     frame and buttons keep their hover/press states, so a pause menu
 *     built from Panel/Button objects stays alive and clickable.
 *   - Script grids KEEP running while paused (conditions and actions both
 *     execute), so the pause menu itself is plain blocks:
 *       Key Just Pressed (P)            -> Pause Game
 *       Game Paused                     -> Show pausePanel, Show resumeBtn
 *       Object Clicked (resumeBtn)      -> Resume Game, Hide pausePanel
 *     World-dependent conditions report the frozen world while paused:
 *     Collision, Overlap/Touch, On Floor, On Screen Edge do not fire, and
 *     On Timer does not tick (its clock is frozen, not reset).
 *   - Use the Game Paused condition (invertible) to gate your own gameplay
 *     actions while paused, e.g. "Game Paused (inverted) + Collision ->
 *     lives - 1" so nothing bad happens during the freeze.
 *   - Switching scenes always unpauses (a fresh scene starts running).
 *
 * Timer freezing: timers run on performance.now(), which keeps flowing
 * while paused. Each paused frame the runtime reports its real length via
 * notePausedFrame(); gameNow() subtracts the accumulated paused time, so
 * timer math sees a frozen clock and resumes exactly where it left off.
 *
 * Time scale (P4 Advanced batch 13): the same clock also subtracts the
 * time-scale debt (state.timeScaleDebtMs), banked per frame by
 * HydraTimeScale.noteScaledFrame — the un-scaled portion of each
 * unpaused frame. At scale 1 the debt grows by zero, so old games keep
 * byte-identical timer behavior; at scale 0.5 a 3-second timer takes 6
 * real seconds. The debt resets with the rest of the clock on a scene
 * load (HydraSceneReset, next to pausedElapsedMs).
 *
 * Load order (index.html): hydra-pause.js BEFORE player-runtime.js and
 * script.js. player-runtime.js throws a clear error if HydraPause is missing.
 * ========================================================================== */

function hydraPauseFactory() {
  'use strict';

  // True when the game's world simulation is currently frozen.
  // Coerces missing/old state objects (backward compatible: pre-pause
  // projects never set these fields, and they read as "not paused").
  function isPaused(state) {
    return !!(state && state.paused);
  }

  // Freeze the world. Idempotent; returns the new paused value (true).
  function pause(state) {
    if (state) state.paused = true;
    return true;
  }

  // Unfreeze the world. Idempotent; returns the new paused value (false).
  function resume(state) {
    if (state) state.paused = false;
    return false;
  }

  // Flip the pause state. Returns the new paused value.
  function toggle(state) {
    if (!state) return false;
    state.paused = !state.paused;
    return !!state.paused;
  }

  // Record one frame's real length (ms) while paused. The runtime calls
  // this every paused frame so the game clock can be frozen for timers.
  // Never throws on bad input; negative lengths are ignored.
  function notePausedFrame(state, realMs) {
    if (!state || !state.paused) return;
    var ms = Number(realMs);
    if (!isFinite(ms) || ms < 0) return;
    state.pausedElapsedMs = (Number(state.pausedElapsedMs) || 0) + ms;
  }

  // The game clock: the wall clock minus all time spent paused, minus
  // the time-scale debt (banked per frame by HydraTimeScale, so the
  // named timers slow with the world). Pass the same clock source the
  // timers use (performance.now in the runtimes).
  function gameNow(state, clockNow) {
    var now = Number(clockNow);
    if (!isFinite(now)) now = 0;
    var frozen = (state && Number(state.pausedElapsedMs)) || 0;
    if (!isFinite(frozen) || frozen < 0) frozen = 0;
    var debt = (state && Number(state.timeScaleDebtMs)) || 0;
    // The debt may go NEGATIVE (above scale 1 the clock runs ahead
    // of the wall clock, Unity Time.time behavior at timeScale > 1),
    // so only a non-finite debt reads as 0 — never clamp it at 0.
    if (!isFinite(debt)) debt = 0;
    return now - frozen - debt;
  }

  return {
    isPaused: isPaused,
    pause: pause,
    resume: resume,
    toggle: toggle,
    notePausedFrame: notePausedFrame,
    gameNow: gameNow
  };
}

window.HydraPause = hydraPauseFactory();
// Self-contained source of the factory, inlined into exported playable games
// by HydraPlayer.buildPlayableHtml so exports run without editor files.
window.HydraPause.factorySource = hydraPauseFactory.toString();
