/* ============================================================================
 * hydra-scenereset.js — HydraScript shared scene-load runtime state reset
 * (P2 item 15/12, slice 5: the shared-engine extraction continues here).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation of
 * the fresh runtime state every scene load starts from — the part of
 * loadScene that is about the run, not the objects — used by:
 *   - the editor preview runtime (hydra-previewruntime.js loadPreviewScene and
 *     launchPreview delegate to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Why this slice fifth: the two runtimes reset the same dozen fields on
 * every scene load (camera, 3D camera, pause, particles, the per-scene
 * collections, condition contexts, trigger edge state), but "the same"
 * hid two real divergences, and the reset block was ~50 lines of
 * near-identical code in three places (export loadScene, preview
 * loadPreviewScene, preview launchPreview). The reset itself is now
 * shared code; each host only supplies its subsystem modules and its
 * per-scene collections as hooks. The per-object fresh state (slice 2,
 * HydraSceneInit) and the bound-text pass stay where they are — this
 * module owns the run state around them, not the objects.
 *
 * One reset, in order (the export's order, which is the reference):
 *   1. pendingSceneId = null; sceneId = scene.id.
 *   2. camera = the fresh 2D camera record { x: 0, y: 0, zoom: 1,
 *      followTarget: '', offsetX: 0, offsetY: 0 }.
 *   2b. cameraFeel = cameraFeelOf(scene) via the hook (a fresh
 *      normalized copy of the scene's cameraFeel, so a fresh scene
 *      gets its own smoothing / deadzone / bounds and a block that
 *      changed them in the last scene never leaks into the next;
 *      null when the hook is missing or throws — the follow then
 *      runs with the defaults: snap, no deadzone, scene edges).
 *   2c. minimap = minimapOf(scene) via the hook (a fresh run record
 *      copied from the scene's minimap config, so a fresh scene gets
 *      its own map and a block that hid the map in the last scene
 *      never leaks into the next; null when the hook is missing or
 *      throws — the draw then shows no map).
 *   3. camera3d = normalizeCamera3d(scene.camera3d, scene) via the hook
 *      (null when the hook is missing or throws); camera3dFollow = null,
 *      so a fresh scene never inherits a follow.
 *   4. particles = createParticleState() via the hook (null when the hook
 *      is missing or throws) — a fresh transient particle state.
 *   4b. damageNumbers = createDamageNumbers() via the hook (null when
 *      the hook is missing or throws) — a fresh transient damage-number
 *      state, so a fresh scene never inherits the last scene's floating
 *      numbers (P4 Advanced batch 22).
 *   4c. respawn = createRespawnState() via the hook (null when the hook
 *      is missing or throws) — a fresh transient respawn state, so a
 *      fresh scene starts with no checkpoint and a zero respawn count
 *      (P4 Advanced batch 23). The start positions are recorded by the
 *      hosts after the objects are cloned, not here: this module never
 *      sees the object list.
 *   4c2. attachments = createAttachState() via the hook (null when the
 *      hook is missing or throws) — a fresh transient link table, so a
 *      fresh scene starts with no links (P4 Advanced batch 37). A link
 *      from the last scene never snaps a re-cloned child to a dead
 *      parent's spot.
 *   4d. spawners = createSpawnerState() via the hook (null when the
 *      hook is missing or throws) — a fresh transient spawner state,
 *      so a fresh scene starts with no spawners running (P4 Advanced
 *      batch 24). A wave from the last scene never keeps spawning
 *      into the next one.
 *   4e. movement = createMovementState() via the hook (null when the
 *      hook is missing or throws) — a fresh transient movement state,
 *      so a fresh scene starts with no dash in flight, no buffered
 *      jump, and a full jump count (P4 Advanced batch 26). A dash
 *      from the last scene never carries into the next one.
 *   4f. platform = createPlatformState() via the hook (null when the
 *      hook is missing or throws) — a fresh transient platform state,
 *      so a fresh scene starts with every platform back at its first
 *      waypoint and no crumble timer running (P4 Advanced batch 27).
 *      A platform from the last scene never carries its position or
 *      its crumble into the next one.
 *   4g. combat = createCombatState() via the hook (null when the hook
 *      is missing or throws) — a fresh transient combat state, so a
 *      fresh scene starts with no cooldowns spent, no projectiles
 *      flying, and no slash showing (P4 Advanced batch 29). A shot
 *      from the last scene never carries into the next one.
 *   5. Clear the per-scene collections via the hooks: hidden, destroyed,
 *      pendingDestroy, timers, once, startedScopes. Each is optional; a
 *      missing or non-clearable collection is simply not cleared, and a
 *      throwing clear is swallowed. The hidden set is then seeded from
 *      the scene's authored flags: every object with `hidden: true`
 *      (the outliner's eye, P5-8 slice b) starts the run hidden, so
 *      the draw module skips it and Object Visible reads it as gone
 *      until a Show block reveals it. Seeding reads only the authored
 *      flags and ids off the scene's object records — never the live
 *      objects — so the "this module never sees the object list" rule
 *      below still holds for everything the reset does with live
 *      state.
 *   6. resetContexts() via the hook — the per-frame condition-context
 *      store, fresh like the frame loop's resetContexts phase.
 *   7. paused = false; pausedElapsedMs = 0; timeScaleDebtMs = 0 — a
 *      fresh scene always starts unpaused with a fresh game clock
 *      (the time-scale debt is part of that clock: a fresh scene's
 *      timers start from zero whatever the scale was).
 *   8. Trigger edge state cleared: _triggerContacts = [],
 *      _triggerPairs = {}, _triggerEntered = [], _triggerExited = [].
 *   9. resetDialogue() via the hook — a running dialogue ends on scene
 *      load, so a fresh scene never inherits a half-finished
 *      conversation (the dialogue's bound labels keep their last line;
 *      the module stops writing, it never blanks them).
 *
 * Hooks (all optional):
 *   - cameraFeelOf(scene) -> a fresh normalized camera-feel record
 *     for the scene (HydraCameraFeel.freshCameraFeel). Without one
 *     (or when it throws) cameraFeel reads as null — the follow
 *     degrades to the defaults (snap, no deadzone, scene edges).
 *   - minimapOf(scene) -> a fresh minimap run record for the scene
 *     (HydraMinimap.createMinimapState). Without one (or when it
 *     throws) minimap reads as null — the draw shows no map.
 *   - normalizeCamera3d(camera3d, scene) -> fresh camera record. Without
 *     one (or when it throws) camera3d reads as null — the preview's
 *     degradation when Hydra3d is missing.
 *   - createParticleState() -> fresh particle state. Without one (or when
 *     it throws) particles reads as null.
 *   - createDamageNumbers() -> fresh damage-number state. Without one
 *     (or when it throws) damageNumbers reads as null.
 *   - createAttachState() -> fresh attachment link table. Without one
 *     (or when it throws) attachments reads as null — the apply phase
 *     then moves nothing.
 *   - createRespawnState() -> fresh respawn state. Without one (or when
 *     it throws) respawn reads as null.
 *   - createSpawnerState() -> fresh spawner state. Without one (or when
 *     it throws) spawners reads as null.
 *   - createMovementState() -> fresh movement state. Without one (or when
 *     it throws) movement reads as null.
 *   - createPlatformState() -> fresh platform state. Without one (or when
 *     it throws) platform reads as null.
 *   - createCombatState() -> fresh combat state. Without one (or when
 *     it throws) combat reads as null.
 *   - resetDialogue() — the host's dialogue end (both runtimes stop the
 *     running dialogue through HydraDialogue). Without one (or when it
 *     throws) the dialogue simply keeps running.
 *   - hidden / destroyed / pendingDestroy / timers / once / startedScopes
 *     — the host's per-scene collections (a Set or Map with a clear()
 *     method). The export holds them on its state object; the preview
 *     holds them as module-level sets/maps, so they arrive here through
 *     the hooks instead of the state object.
 *   - resetContexts() — the host's condition-context reset. The export
 *     clears state.contexts + state.executionContext; the preview clears
 *     previewState.conditionContexts + previewState.executionContext.
 *
 * Semantics:
 *   - resetSceneRuntime(state, scene, hooks): resets the run state above
 *     on the host's state object and returns true. A non-object state or
 *     a non-object scene is a no-op returning false. Nothing here ever
 *     throws: a throwing hook degrades to its safe default, and a frozen
 *     state object (which throws on assignment) returns false instead of
 *     breaking scene load.
 *   - The camera record is a fresh literal on every call — the hosts used
 *     to assign a fresh literal too, so no caller can alias another
 *     scene's camera through it.
 *
 * Behavior changes vs the old inline code (all in the direction the code
 * already documented with "(mirrors the export)" / "(mirrors the editor
 * preview)" comments — the two runtimes were supposed to agree and did not):
 *   - Preview scene switches now also clear the condition contexts.
 *     The export's loadScene always reset state.contexts +
 *     executionContext; the preview's loadPreviewScene did not touch
 *     previewState.conditionContexts. Condition contexts are per-frame
 *     scratch — the frame loop's resetContexts phase clears them every
 *     frame — so no live behavior changes; the two runtimes now agree.
 *   - Preview restarts now clear a pending scene switch. launchPreview
 *     delegates to the same reset, so pendingSceneId reads as null on a
 *     fresh run. Previously a switchScene queued before a restart would
 *     fire on the first frame of the restarted run and yank the player
 *     to the other scene; the export's start path always cleared it.
 *
 * Deliberately NOT unified (stays host-side, documented here so the next
 * slice does not "fix" it by accident):
 *   - frameId: the preview's loadPreviewScene resets frameId to 0; the
 *     export's loadScene leaves it counting (it drives the trace ring's
 *     30-frame window and the profiler stats). Unifying it would change
 *     trace/profiler behavior across scene switches in one runtime.
 *   - Camera shake / flash: the export's loadScene never resets the
 *     shake or the flash; the preview resets the shake (not the flash)
 *     on scene load and on restart. Resetting them in the export would
 *     cut a shake short on a scene switch; not resetting the shake in
 *     the preview would let one bleed across scenes.
 *   - Editor-only bits stay in the preview: clearRuntimeDiagnostics,
 *     normalizeSceneDimensions, cameraShakeCooldowns, spawnCounter,
 *     resizeGameCanvas, processGameStartConditions. The canvas resize
 *     stays in the export (resizeCanvas).
 *
 * Load order (index.html): hydra-scenereset.js BEFORE player-runtime.js
 * and script.js. player-runtime.js throws a clear error if
 * HydraSceneReset is missing. The preview guards the resetSceneRuntime
 * calls (window.HydraSceneReset), so the editor still boots if the tag
 * is ever dropped — the scene still loads, but the run state is not
 * reset, the same guarded-call degradation the other shared modules use;
 * the tag order is pinned by tests/scenereset.test.js.
 * ========================================================================== */

function hydraSceneResetFactory() {
  'use strict';

  // Clear one per-scene collection. A missing collection, a non-function
  // clear, or a throwing clear is a silent no-op — one bad collection
  // never breaks scene load.
  function clearCollection(c) {
    try {
      if (c && typeof c.clear === 'function') c.clear();
    } catch (e) { /* a bad collection never breaks scene load */ }
  }

  // Seed the hidden set from the scene's authored flags: every object
  // record with hidden === true contributes its id. A missing set, a
  // non-array object list, a record without an id, or a throwing add
  // is a quiet no-op for that entry — one bad record never breaks
  // scene load or hides the rest of the scene.
  function seedHidden(hidden, objects) {
    try {
      if (!hidden || typeof hidden.add !== 'function') return;
      if (!Array.isArray(objects)) return;
      objects.forEach(function (obj) {
        try {
          if (obj && typeof obj === 'object' && obj.hidden === true &&
              obj.id !== undefined && obj.id !== null) hidden.add(obj.id);
        } catch (e) { /* one bad record never breaks the seed */ }
      });
    } catch (e) { /* a bad seed never breaks scene load */ }
  }

  // The fresh runtime state every scene load starts from, on the host's
  // state object. Returns true on success, false when the state or the
  // scene is not an object (a no-op). Never throws.
  function resetSceneRuntime(state, scene, hooks) {
    if (!state || typeof state !== 'object') return false;
    if (!scene || typeof scene !== 'object') return false;
    var h = hooks || {};
    try {
      state.pendingSceneId = null;
      if (scene.id !== undefined) state.sceneId = scene.id;
      // 2D camera: a fresh record, so no caller can alias another scene's.
      state.camera = { x: 0, y: 0, zoom: 1, followTarget: '', offsetX: 0, offsetY: 0 };
      // P4 Advanced batch 15 (camera feel): the scene's smoothing /
      // deadzone / bounds, as a fresh copy through the hook — a fresh
      // scene gets its own feel, and the live record never aliases
      // the scene's authored config (a block that changes the bounds
      // mid-run must not rewrite the project data).
      try {
        state.cameraFeel = (typeof h.cameraFeelOf === 'function') ? h.cameraFeelOf(scene) : null;
      } catch (e) { state.cameraFeel = null; }
      // P4 Advanced batch 36 (minimap): the scene's corner map, as
      // a fresh copy through the hook — a fresh scene gets its own
      // map, and the live record never aliases the scene's authored
      // config (a block that hides the map mid-run must not rewrite
      // the project data).
      try {
        state.minimap = (typeof h.minimapOf === 'function') ? h.minimapOf(scene) : null;
      } catch (e) { state.minimap = null; }
      // 3D camera: fresh from the scene's stored camera3d; no follow.
      var cam3d = null;
      try {
        cam3d = (typeof h.normalizeCamera3d === 'function')
          ? h.normalizeCamera3d(scene.camera3d, scene) : null;
      } catch (e) { cam3d = null; }
      state.camera3d = cam3d;
      state.camera3dFollow = null;
      // Particles: fresh transient state per scene load.
      var parts = null;
      try {
        parts = (typeof h.createParticleState === 'function') ? h.createParticleState() : null;
      } catch (e) { parts = null; }
      state.particles = parts;
      // Damage numbers: fresh transient state per scene load (a fresh
      // scene never inherits the last scene's floating numbers).
      var dmgNums = null;
      try {
        dmgNums = (typeof h.createDamageNumbers === 'function') ? h.createDamageNumbers() : null;
      } catch (e) { dmgNums = null; }
      state.damageNumbers = dmgNums;
      // Attachments: fresh transient state per scene load (a fresh
      // scene starts with no links, so a link from the last scene
      // never snaps a re-cloned child back to a dead parent's spot).
      var attachSt = null;
      try {
        attachSt = (typeof h.createAttachState === 'function') ? h.createAttachState() : null;
      } catch (e) { attachSt = null; }
      state.attachments = attachSt;
      // Respawn: fresh transient state per scene load (a fresh scene
      // starts with no checkpoint and a zero respawn count, so a
      // checkpoint from the last scene never sends the player back
      // into it).
      var respawnSt = null;
      try {
        respawnSt = (typeof h.createRespawnState === 'function') ? h.createRespawnState() : null;
      } catch (e) { respawnSt = null; }
      state.respawn = respawnSt;
      // Spawners: fresh transient state per scene load (a fresh scene
      // starts with no spawners running, so a wave from the last scene
      // never keeps spawning into the next one).
      var spawnerSt = null;
      try {
        spawnerSt = (typeof h.createSpawnerState === 'function') ? h.createSpawnerState() : null;
      } catch (e) { spawnerSt = null; }
      state.spawners = spawnerSt;
      // Movement: fresh transient state per scene load (a fresh scene
      // starts with no dash in flight, no buffered jump, and a full
      // jump count, so a dash from the last scene never carries into
      // the next one).
      var movementSt = null;
      try {
        movementSt = (typeof h.createMovementState === 'function') ? h.createMovementState() : null;
      } catch (e) { movementSt = null; }
      state.movement = movementSt;
      // Platforms: fresh transient state per scene load (a fresh scene
      // starts with every platform back at its first waypoint and no
      // crumble timer running, so a platform from the last scene never
      // carries its position or its crumble into the next one).
      var platformSt = null;
      try {
        platformSt = (typeof h.createPlatformState === 'function') ? h.createPlatformState() : null;
      } catch (e) { platformSt = null; }
      state.platform = platformSt;
      // Combat: fresh transient state per scene load (a fresh scene
      // starts with no cooldowns spent, no projectiles flying, and no
      // slash showing, so a shot from the last scene never carries
      // into the next one).
      var combatSt = null;
      try {
        combatSt = (typeof h.createCombatState === 'function') ? h.createCombatState() : null;
      } catch (e) { combatSt = null; }
      state.combat = combatSt;
      // Per-scene collections.
      clearCollection(h.hidden);
      // P5-8 slice b: seed the hidden set from the scene's authored
      // flags, so an object the outliner hid starts the run hidden
      // in both runtimes (the draw module already skips hidden ids,
      // and Object Visible already reads them as gone). Only the
      // flag and the id are read, off the scene's records — never a
      // live object — and a missing or non-addable set is a quiet
      // no-op, like a missing collection above.
      seedHidden(h.hidden, scene.objects);
      clearCollection(h.destroyed);
      clearCollection(h.pendingDestroy);
      clearCollection(h.timers);
      clearCollection(h.once);
      clearCollection(h.startedScopes);
      // Per-frame condition contexts, fresh like the frame loop's
      // resetContexts phase.
      try {
        if (typeof h.resetContexts === 'function') h.resetContexts();
      } catch (e) { /* a throwing context reset never breaks scene load */ }
      // A running dialogue ends on scene load (a fresh scene never
      // inherits a half-finished conversation).
      try {
        if (typeof h.resetDialogue === 'function') h.resetDialogue();
      } catch (e) { /* a throwing dialogue end never breaks scene load */ }
      // Pause: a fresh scene always starts unpaused with a fresh clock.
      state.paused = false;
      state.pausedElapsedMs = 0;
      // P4 Advanced batch 13 (time scale): the clock debt resets with
      // the rest of the game clock — a fresh scene's timers start from
      // zero whatever the scale was. (The scale itself survives the
      // switch: it is run-level state, not clock state.)
      state.timeScaleDebtMs = 0;
      // Trigger edge state: scene switches clear it.
      state._triggerContacts = [];
      state._triggerPairs = {};
      state._triggerEntered = [];
      state._triggerExited = [];
    } catch (e) { return false; }
    return true;
  }

  return {
    resetSceneRuntime: resetSceneRuntime
  };
}

window.HydraSceneReset = hydraSceneResetFactory();
// Self-contained source of the factory, inlined into exported playable games
// by HydraPlayer.buildPlayableHtml so exports run without editor files.
window.HydraSceneReset.factorySource = hydraSceneResetFactory.toString();
