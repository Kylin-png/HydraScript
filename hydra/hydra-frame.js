/* ============================================================================
 * hydra-frame.js — HydraScript shared per-frame update order (P2 item 15/12,
 * slice 3: the shared-engine extraction continues here).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation of
 * what happens, in what order, on one frame of a running game — used by:
 *   - the editor preview runtime (hydra-previewruntime.js gameLoop delegates to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Why this slice third: the two runtimes' loops ran the same phases in
 * nearly the same order, but "nearly" hid three real divergences, and every
 * future engine feature (a new subsystem is one more phase in one more
 * place) would have doubled them. The order itself is now shared code; each
 * host only supplies its subsystem calls as hooks.
 *
 * Canonical order (PHASES, in sequence — the export's order, which is the
 * reference; the preview's differences are listed below):
 *   1. profile — feed the frame timestamp to the profiler (every frame,
 *      paused or not, so the FPS / frame-time average stays honest).
 *   2. notePaused — only while paused: bank the real milliseconds against
 *      the frozen game clock (HydraPause.notePausedFrame).
 *   3-12. While NOT paused, the world sim, in this order:
 *      decayCameraFx — shake + flash decay (dt in ms).
 *      updateCamera — 2D camera follow, then 3D camera follow.
 *      updatePhysics2d — integrate velocities, resolve collisions + tiles.
 *      updatePhysics3d — 3D gravity, colliders, ground detection, MTV.
 *      solveJoints — rods/ropes/springs AFTER all collision response, so
 *        joints and walls agree (this is why joints come after 3D physics
 *        too: 3D physics is also collision response).
 *      updateAnimations — sprite animation clocks.
 *      updateBlendSpaces — blend-space frame clocks.
 *      updateSkeletons — skeletal animation clocks.
 *      updateTweens — tween clocks (finished records visible to scripts).
 *      updateParticles — emitter + particle simulation.
 *      updateDamageNumbers — floating damage numbers rise and fade
 *        (P4 Advanced batch 22), after the particles so a number
 *        spawned this frame is already aging next frame.
 *      updateAI — AI behaviors decide where each driven object
 *        walks next (P4 Advanced batch 19), before the follower,
 *        so a fresh plan walks the same frame.
 *      updatePaths — path followers walk their objects toward the next
 *        waypoint (P4 Advanced batch 18), so the walk is the frame's
 *        final word on a following object's position.
 *      updateSpawners — spawners clone what is due (P4 Advanced batch
 *        24), last in the sim, so a newborn never gets a half-stepped
 *        physics or AI update on its birth frame.
 *      updatePlatforms — moving platforms slide along their paths and
 *        carry their riders, and crumble timers run (P4 Advanced batch
 *        27), after the spawners so a newborn on a platform rides it
 *        from its first frame, and before the movement phase so the
 *        grounded check sees the rider on the platform's new position.
 *      updateMovement — movement abilities refresh (P4 Advanced batch
 *        26), last in the sim, so a dash steps the object after
 *        physics settled it and a buffered jump fires the frame after
 *        the object lands.
 *      updateCombat — combat refreshes (P4 Advanced batch 29), after
 *        the movement phase, so a projectile steps after the dash has
 *        had the frame's final word on positions, and a shot fired
 *        this frame is already aging next frame.
 *      updateAttachments — attached children snap to parent + offset
 *        (P4 Advanced batch 37), after the combat phase, so the
 *        attach is the frame's final word on a child's position: a
 *        dash, a path step, or a projectile can move the parent, and
 *        the child still lands exactly on it this frame.
 *   13. updateUiWidgets — button hover/press state. Runs while paused too,
 *      so pause-menu buttons stay clickable. (Preview-only phase: the
 *      export computes button state at draw time instead.)
 *   14. resetContexts — clear the per-frame condition contexts.
 *   15. pollInput — poll the raw gamepad once per frame, derive button
 *      edge sets, advance named input actions. Runs while paused too, like
 *      raw key input, so pause menus can use actions.
 *   16. updateJoystick — write this frame's stick tilt into the
 *      joystick variables and (through the pollInput above) the driven
 *      named actions, so scripts see the tilt the same frame the
 *      finger moved. Runs while paused too, like the input poll.
 *   17. runScripts — the global grid, then the current scene's grid.
 *   18. surfaceWarnings — report a fresh expression warning (export-only;
 *      the preview surfaces expression problems through its own panel).
 *   19. applyPendingDestroy — objects destroyed by this frame's scripts
 *      join the destroyed set now, so the NEXT frame's sim and scripts
 *      never see them.
 *   20. applyPendingScene — a scene change requested by a script applies
 *      AFTER all actions ran, so no old-scene action executes against the
 *      new scene's objects.
 *   21. draw — (export only; the preview draws outside its loop so the
 *      scene still renders while the game is stopped).
 *   22. clearEdges — clear the just-pressed / just-released edge sets and
 *      the per-frame mouse deltas.
 *
 * Semantics:
 *   - computeDt(lastTime, timestamp): the shared frame-timing math both
 *     loops used — realMs = max(0, timestamp - lastTime), dt =
 *     min(realMs / 16.67, 3) (so a 60fps frame is dt 1 and a long hitch
 *     caps at dt 3). A falsy or non-finite lastTime is the first frame:
 *     realMs 0, dt 0 (both hosts used `if (!lastTime)` the same way).
 *     Never throws; hostile input degrades to dt 0.
 *   - stepFrame(host): calls the host's phase hooks in canonical order.
 *     Every hook is optional — a missing or non-function hook is skipped,
 *     so a host only wires the phases it has. A non-object host is a
 *     no-op returning false; a stepped frame returns true. The host
 *     supplies dt / realMs / timestamp as plain numbers (computed via
 *     computeDt or its own equivalent) and isPaused as a function.
 *   - Nothing here ever throws: a throwing phase is caught, reported to
 *     the optional onPhaseError(phase, error) hook, and the frame
 *     continues with the next phase. (The old inline loops had no guard
 *     at all — one throwing subsystem killed the rAF chain and froze the
 *     game. A phase error is still a bug and still shows up in the test
 *     suite's outcome assertions; it just no longer takes the game down
 *     with it in front of a player.)
 *
 * Behavior changes vs the old inline code (all in the direction the code
 * already documented with "(mirrors the export)" / "(mirrors the editor
 * preview)" comments — the two runtimes were supposed to agree and did not):
 *   - Preview joints now solve AFTER 3D physics (export order), not
 *     before. Both are collision response, so joints get the final say
 *     over every collider in both runtimes. Joints only move objects
 *     listed in the scene's joints and 3D physics only moves 3D kinds,
 *     so the order only matters for a 3D object with a joint — where the
 *     export's order is the documented one.
 *   - Preview pending-destroy application now happens AFTER scripts (the
 *     export's position), not before them. The destroyed object no longer
 *     gets one extra physics step in the preview on the frame after it
 *     was destroyed. The preview's script-time lookups already excluded
 *     pending-destroy objects through getAlivePreviewObjects(); the
 *     remaining raw-list reads (the frame's live-object snapshot, the
 *     camera-follow target, expression lookups, the tilemap lookups, the
 *     include-hidden action pool, forceToward's source list) now exclude
 *     pending-destroy too, so scripts still never observe a destroyed
 *     object — exactly the export's named() semantics.
 *   - A throwing phase no longer freezes the game (see above).
 *
 * Load order (index.html): hydra-frame.js BEFORE player-runtime.js and
 * script.js. player-runtime.js throws a clear error if HydraFrame is
 * missing. The preview guards the stepFrame call (window.HydraFrame), so
 * the editor still boots if the tag is ever dropped — the scene still
 * draws, but the world does not advance, the same guarded-call
 * degradation the other shared modules use; the tag order is pinned by
 * tests/frame.test.js.
 * ========================================================================== */

function hydraFrameFactory() {
  'use strict';

  // The canonical phase order. notePaused only runs while paused and the
  // 3-12 world-sim phases only run while unpaused; every other phase runs
  // on every stepped frame. Hosts that lack a phase simply omit the hook.
  var PHASES = [
    'profile', 'notePaused',
    'decayCameraFx', 'updateCamera', 'updatePhysics2d', 'updatePhysics3d',
    'solveJoints', 'updateAnimations', 'updateBlendSpaces', 'updateSkeletons',
    'updateTweens', 'updateParticles', 'updateDamageNumbers', 'updateAI', 'updatePaths', 'updateSpawners', 'updatePlatforms', 'updateMovement', 'updateCombat', 'updateAttachments',
    'updateUiWidgets', 'resetContexts', 'pollInput', 'updateJoystick', 'runScripts',
    'surfaceWarnings', 'applyPendingDestroy', 'applyPendingScene',
    'draw', 'clearEdges'
  ];

  function finiteNum(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback;
  }

  // Shared frame-timing math. Returns { realMs, dt, lastTime } where dt is
  // in 60fps units (1 per 16.67ms, capped at 3). A falsy or non-finite
  // lastTime is the first frame: realMs 0, dt 0. Never throws.
  function computeDt(lastTime, timestamp) {
    var t = finiteNum(timestamp, 0);
    var prev = Number(lastTime);
    if (!lastTime || !isFinite(prev)) return { realMs: 0, dt: 0, lastTime: t };
    var realMs = Math.max(0, t - prev);
    return { realMs: realMs, dt: Math.min(realMs / 16.67, 3), lastTime: t };
  }

  // Run one frame through the canonical phase order. `host` carries the
  // frame numbers (timestamp, dt, realMs) plus one optional function per
  // phase and the optional onPhaseError(phase, error) reporter. Missing or
  // non-function hooks are skipped; a throwing phase is reported and the
  // frame continues. Returns true when a frame was stepped, false for a
  // non-object host. Never throws.
  function stepFrame(host) {
    if (!host || typeof host !== 'object') return false;
    var dt = finiteNum(host.dt, 0);
    var realMs = finiteNum(host.realMs, 0);
    function report(phase, err) {
      try {
        if (typeof host.onPhaseError === 'function') host.onPhaseError(phase, err);
      } catch (ignored) { /* the reporter must never break the frame */ }
    }
    function call(phase, fn, arg) {
      if (typeof fn !== 'function') return;
      try { fn(arg); } catch (e) { report(phase, e); }
    }
    var paused = false;
    if (typeof host.isPaused === 'function') {
      try { paused = !!host.isPaused(); } catch (e) { report('isPaused', e); paused = false; }
    }
    call('profile', host.profile, host.timestamp);
    if (paused) call('notePaused', host.notePaused, realMs);
    if (!paused) {
      call('decayCameraFx', host.decayCameraFx, dt * 16.67);
      call('updateCamera', host.updateCamera);
      call('updatePhysics2d', host.updatePhysics2d);
      call('updatePhysics3d', host.updatePhysics3d);
      call('solveJoints', host.solveJoints);
      call('updateAnimations', host.updateAnimations);
      call('updateBlendSpaces', host.updateBlendSpaces);
      call('updateSkeletons', host.updateSkeletons);
      call('updateTweens', host.updateTweens);
      call('updateParticles', host.updateParticles);
      call('updateDamageNumbers', host.updateDamageNumbers);
      call('updateAI', host.updateAI);
      call('updatePaths', host.updatePaths);
      call('updateSpawners', host.updateSpawners);
      call('updatePlatforms', host.updatePlatforms);
      call('updateMovement', host.updateMovement);
      call('updateCombat', host.updateCombat);
      call('updateAttachments', host.updateAttachments);
    }
    call('updateUiWidgets', host.updateUiWidgets);
    call('resetContexts', host.resetContexts);
    call('pollInput', host.pollInput);
    call('updateJoystick', host.updateJoystick);
    call('runScripts', host.runScripts);
    call('surfaceWarnings', host.surfaceWarnings);
    call('applyPendingDestroy', host.applyPendingDestroy);
    call('applyPendingScene', host.applyPendingScene);
    call('draw', host.draw);
    call('clearEdges', host.clearEdges);
    return true;
  }

  return {
    PHASES: PHASES,
    computeDt: computeDt,
    stepFrame: stepFrame
  };
}

window.HydraFrame = hydraFrameFactory();
// Self-contained source of the factory, inlined into exported playable games
// by HydraPlayer.buildPlayableHtml so exports run without editor files.
window.HydraFrame.factorySource = hydraFrameFactory.toString();
