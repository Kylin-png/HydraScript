/* ============================================================================
 * hydra-execute.js — HydraScript shared per-block action execution
 * (P2 item 15/12, slice 9: the shared-engine extraction — the final slice).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation
 * of the action switch both runtimes step through once a condition fires —
 * the part of execute (export) / executeAction (preview) that is about
 * what each block type does — used by:
 *   - the editor preview runtime (script.js executeAction delegates
 *     to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * With this slice the shared-engine extraction (P2 item 15/12) is
 * complete: the frame order, the 2D physics step, the scene-load state
 * reset, the draw passes, the script-grid dispatch, the condition
 * switches, and now the action switches all live in one place each.
 * The two runtimes are thin hosts around the shared modules.
 *
 * Each host only supplies a context object (ctx) describing its live
 * run state; the module never reads a host global.
 *
 * ctx contract (every field optional; a missing piece degrades to the
 * action being skipped, never to a throw):
 *   - variables — the live variables object (name -> value).
 *   - objects — the live object list (spawn pushes clones here).
 *   - hidden — a Set of hidden object ids; pendingDestroy — a Set of
 *     ids queued for destruction; destroyed — a Set of destroyed ids.
 *   - executionContext — the triggering condition's context ({obj1,
 *     obj2}) or null; target resolution narrows to the picked object.
 *   - dt — the frame length in seconds (moveToward's direct move).
 *   - camera — the live 2D camera record {x, y, zoom, followTarget,
 *     offsetX, offsetY}; canvasWidth, canvasHeight — numbers.
 *   - named(name, includeHidden) — live objects by name, destroyed /
 *     pending-destroy excluded, hidden excluded unless includeHidden
 *     (the export's named() semantics — see the divergence note below).
 *   - allObjects() — every live object (destroyed/pending-destroy
 *     excluded, hidden included), for the grounded scan.
 *   - hitbox(obj) — the object's hitbox rect; getPhysics(obj) — the
 *     physics record with defaults; isCollisionObject(obj) — the host's
 *     collision predicate.
 *   - expr(value) — the host's expression evaluator -> number (raw:
 *     non-finite results pass through, exactly like both hosts);
 *     exprInfo(value) — {ok, value}. random() — Math.random.
 *   - worldSize() — { width, height } of the current scene, or null.
 *   - getScene() — the live scene record, or null; sceneObjectDefs()
 *     — the authored objects of the current scene (spawn sources).
 *   - scenes — the scene records (for id lookups); sceneId — the
 *     current scene id; pendingSceneId — the deferred switch target or
 *     null; requestScene(id) — defer a scene switch; sceneStack — the
 *     push/pop stack array (module pushes/pops directly).
 *   - clampCamera() — clamp the camera to the scene; updateCameraFollow()
 *     — one frame of camera follow; resetCameraFeel() — restore the
 *     scene's follow smoothing / deadzone / bounds into the live feel
 *     record (Reset Camera's feel half; absent means the feel is left
 *     alone).
 *   - cameraFeelModule — the HydraCameraFeel module (or null);
 *     cameraFeel() — the live camera-feel record (or null when the host
 *     has none yet); the module only mutates the record the host owns.
 *   - parallaxModule — the HydraParallax module (or null); the Set
 *     Parallax action writes the live objects' factors through it.
 *   - spatialAudioModule — the HydraSpatialAudio module (or null);
 *     the Play Sound at Position action mixes its volume and pan
 *     through it (listener = the screen center, from camera +
 *     canvasWidth/canvasHeight).
 *   - pathfindModule — the HydraPathfind module (or null); the Follow
 *     Path action builds the walk grid through it (worldSize + the
 *     live tilemap objects from allObjects + the HydraTiles module),
 *     and Stop Path clears a walking path through it.
 *   - aiModule — the HydraAi module (or null); the Set AI Behavior
 *     action writes the behavior record through it (behavior, target,
 *     speed, range, patrol points), and Stop AI clears it. Either
 *     action also stops the object's walking path through
 *     pathfindModule, so the brain always plans fresh on the next
 *     frame.
 *   - joystickModule — the HydraJoystick module (or null); the
 *     Enable / Disable Joystick actions flip the live stick's
 *     enabled flag through it (Disable also lets go of a held stick,
 *     so the tilt reads 0 again). The ctx.joystick record is the
 *     live stick itself; a missing record stays quiet.
 *   - healthModule — the HydraHealth module (or null); the Damage /
 *     Heal / Set Health / Set Max Health actions write the hit points
 *     through it.
 *   - damageFxModule — the HydraDamageFx module (or null); the Show
 *     Damage Number / Make Invincible / Knockback Object actions run
 *     through it, and Damage Object skips invincible targets through
 *     it. damageNumbers — the live floating-number state (or null);
 *     ensureDamageNumbers() — return it, creating it if needed.
 *   - respawnModule — the HydraRespawn module (or null); the Set
 *     Checkpoint / Respawn Object / Clear Checkpoint actions run
 *     through it. respawn — the live respawn state (or null);
 *     ensureRespawnState() — return it, creating it if needed.
 *     healthModule — the HydraHealth module (or null), used by
 *     Respawn Object to refill the health when the block asks for it;
 *     pathfindModule — the HydraPathfind module (or null), used to
 *     stop a walking path on respawn.
 *   - spawnModule — the HydraSpawn module (or null); the Start
 *     Spawner / Stop Spawner / Read Spawned Count actions run through
 *     it. spawners — the live spawner state (or null);
 *     ensureSpawnerState() — return it, creating it if needed. The
 *     per-frame updateSpawners phase clones through spawnObjectAt
 *     below, so the module's spawn hook is the same Spawn Object
 *     action the blocks use.
 *   - livesModule — the HydraLives module (or null); the Set / Add /
 *     Lose / Read Lives actions run through it. lives — the live
 *     lives state (or null); a missing state stays quiet on writes
 *     and reads as the default 3 lives.
 *   - xpModule — the HydraXp module (or null); the Add / Set / Read
 *     XP actions run through it. xp — the live XP state (or null);
 *     a missing state stays quiet on writes and reads as 0 XP at
 *     level 1.
 *   - movementModule — the HydraMovement module (or null); the Jump /
 *     Dash / Set Max Jumps / Set Coyote Time / Set Jump Buffer actions
 *     run through it. movement — the live movement state (or null);
 *     ensureMovementState() — return it, creating it if needed. The
 *     per-frame updateMovement phase refreshes the state through the
 *     same module, so the blocks and the frame agree on what grounded
 *     means.
 *   - platformModule — the HydraPlatform module (or null); the Set
 *     Platform Path / Set One-Way Platform / Set Crumble Time actions
 *     run through it. platform — the live platform state (or null);
 *     ensurePlatformState() — return it, creating it if needed. The
 *     per-frame updatePlatforms phase moves the platforms through the
 *     same module, so the blocks and the frame agree on the path.
 *   - shake, flash — the camera shake / screen flash records;
 *     shakeCooldownOk(data, idx) — the preview-only shake cooldown
 *     (check-and-set on the per-block cooldown; absent means no
 *     cooldown, the export's behavior).
 *   - cameraFx — the HydraCameraFx module (or null).
 *   - warn(msg) — host reporting for a warning diagnostic;
 *     warnFlashColor(color) — the host's bad-flash-color warning
 *     (once per session in the preview, every time in exports);
 *     warnReadTimerBlank(which) — the host's blank-name Read Timer
 *     warning ('variable' | 'timer'); reportUnknown(type) — host
 *     reporting for an unknown action type.
 *   - playSound(data, idx) — host sound playback (the preview's
 *     per-cell 100ms cooldown lives in the host); stopMusic(),
 *     pauseMusic(), resumeMusic(), stopAllSounds() — host music controls.
 *   - buses — the audio bus record; audioBuses — the HydraAudioBuses
 *     module (or null); setMasterVolume(v) — host master fader write.
 *   - save — the HydraSave module (or null); storage — the host's
 *     localStorage (or a function returning it, or null).
 *   - pause — the HydraPause module (or null); pauseState — the host
 *     run state it acts on. profile — the HydraProfile module (or
 *     null); profilerState — the host profiler record.
 *   - particles — the HydraParticles module (or null); particleState —
 *     the live particle state or null; ensureParticles() — return the
 *     particle state, creating it if needed.
 *   - actions — the HydraActions module (or null); actionsState — the
 *     per-run action bindings. tiles — the HydraTiles module (or null).
 *   - anim, stateMachine, blendSpace, tween — the animation subsystem
 *     modules (or null). collections, math, layerFx, threeD, light2d,
 *     joints, skeleton, localization, scriptApi, sceneInit, physics2d —
 *     the subsystem modules (or null).
 *   - collectionHooks(), mathHooks(), layerFxActionHooks(data),
 *     threeDActionHooks(data), light2dActionHooks(), jointActionHooks(),
 *     scriptApiHooks(), sceneInitHooks(), stateMachineHooks(obj) —
 *     zero/one-argument functions returning the hooks object the
 *     matching subsystem module needs (the hosts' existing builders).
 *   - timers — the Map of timer records; nowMs() — performance.now();
 *     frozenNowMs() — the frozen game clock (HydraPause.gameNow);
 *     timerElapsedSeconds(key, nowMs) — the host's read-only elapsed
 *     helper (never creates a record).
 *   - localizationTable — the project string table;
 *     getLanguage() / setLanguage(code) — the run's current language;
 *     applyBoundTexts() — re-apply every bound label in the language.
 *   - dialogueModule — the HydraDialogue module (or null); dialogue —
 *     the live dialogue runtime; dialogues — the project dialogue
 *     table; dialogueHooks() — { warn, setObjectText } for the module
 *     (the per-frame typewriter update runs host-side, from the
 *     runScripts phase).
 *   - inventoryModule — the HydraInventory module (or null); inventory
 *     — the live backpack runtime; items — the project item table;
 *     inventoryHooks() — { warn } for the module (counts arrive
 *     through expr(), so a variable can feed them).
 *   - questModule — the HydraQuest module (or null); questLog — the
 *     live quest-log runtime; quests — the project quest table;
 *     questHooks() — { warn } for the module (amounts arrive through
 *     expr(), so a variable can feed them).
 *   - achievementModule — the HydraAchievement module (or null);
 *     achievementLog — the live unlocked-set runtime; achievements —
 *     the project achievement table; achievementHooks() — { warn,
 *     persist } for the module (the module persists on change through
 *     the host's persist, so the unlocked set survives restarts).
 *   - cutsceneModule — the HydraCutscene module (or null); cutscene
 *     — the live cutscene runtime; cutscenes — the project cutscene
 *     table; cutsceneHooks() — { warn, paused, getObjectPosition,
 *     setObjectPosition, setObjectText, playSound, switchScene } for
 *     the module (the per-frame update runs from the runScripts phase
 *     in both runtimes, so the hooks carry the live run state).
 *   - highScoreModule — the HydraHighScore module (or null);
 *     highScoreTable — the live ranked table; highScoreConfig — the
 *     project table config; highScoreHooks() — { warn, persist } for
 *     the module (the module persists on change through the host's
 *     persist, so the table survives restarts).
 *   - timeScaleModule — the HydraTimeScale module (or null);
 *     timeScale — the live time-scale runtime (the host owns the
 *     per-run runtime; the module only mutates it); timeScaleHooks()
 *     — { warn } for the module (the scale arrives through expr(),
 *     so a variable can feed it).
 *   - transitionModule — the HydraTransition module (or null);
 *     transition — the live transition runtime (the host owns the
 *     per-run runtime and advances it once per frame from the
 *     runScripts phase); transitionConfig — the project transition
 *     config ({ effect, duration } from the Transitions tab);
 *     transitionHooks() — { warn, paused, sceneExists, switchScene }
 *     for the module (the duration arrives through exprInfo, so a
 *     variable can feed it — and a blank duration reads as the
 *     configured default, not 0).
 *
 * Semantics (the export's, which is the reference, unless noted):
 *   - executeAction(data, ctx, idx) runs one action block. A falsy or
 *     unknown-typed block reports through reportUnknown and does
 *     nothing. Nothing here ever throws: a throwing hook, subsystem
 *     call, or corrupt field degrades to the action being skipped (the
 *     dispatch already treats a throwing action as stopping only its
 *     own propagation; the module upholds that contract directly).
 *
 * Divergences closed by this slice (all toward the export, the shipped
 * game, unless noted — the preview used to differ):
 *   - Hidden objects no longer participate in preview actions. The
 *     export's targets() excludes hidden objects, so moving, hiding,
 *     destroying, or reading a hidden object did nothing in exports —
 *     while the preview's resolveActionTargets pool included hidden
 *     objects, so the same project behaved differently in the preview.
 *     showHide keeps its includeHidden lookup in both, so hiding and
 *     unhiding still reach hidden objects.
 *   - Push Scene / Pop Scene / Set Scene Background now work in the
 *     preview. The preview had no cases for them at all, so a menu
 *     built on the scene stack silently did nothing in the preview
 *     while working in exports.
 *   - Separate Objects now works in exports. The export had no case
 *     for it at all, so two overlapping objects stayed overlapped in
 *     the exported game while the preview pushed them apart.
 *   - stopObject with no axis (or an unknown axis) now stops both axes
 *     in the preview. The preview only stopped an axis named 'x', 'y',
 *     or 'both', so a bare Stop Object block stopped nothing in the
 *     preview while stopping the object in exports.
 *   - Set Static no longer zeroes velocity in the preview. The preview
 *     zeroed velX/velY when an object went static; the export only
 *     flipped the flag, so a static object kept its velocity in the
 *     exported game.
 *   - Set Velocity on a text object now sets the velocity in the
 *     preview. The preview skipped text objects; the export assigns
 *     the velocity like any other object.
 *   - Set Gravity / Set Friction / Set Max Speed / Set Bounciness no
 *     longer clamp or default-fill in the preview. The preview clamped
 *     friction and bounciness to 0-1, max speed to >= 0, and filled a
 *     missing field with the default physics value; the export writes
 *     the raw expression value, so an out-of-range value now behaves
 *     the same in both.
 *   - Set Physics Enabled no longer creates a physics record in the
 *     preview. The preview minted a default record when enabling; the
 *     export only flips the flag (reads supply the defaults).
 *   - Spawning no longer resets the clone's rotation to 0 in the
 *     preview. The preview's spawnObject reset it; the export keeps
 *     the source's rotation, and the preview's own spawnAtObject never
 *     reset it either.
 *   - Spawn At Object now spawns at the anchor's center for every
 *     anchor in the preview. The preview centered the clone on the
 *     first anchor only; the export puts the clone's top-left at each
 *     anchor's center.
 *   - Teleport / Set Position now accept either toX/toY or x/y and
 *     require both expressions to parse, in both runtimes. The preview
 *     read only toX/toY for Teleport and only x/y for Set Position
 *     (moving to 0 on a missing field); the export reads toX ?? x.
 *   - Timer Control now also accepts the `name` field, in both
 *     runtimes (the preview's fallback, and the export's own Read
 *     Timer already read timerName || name; the export's controlTimer
 *     read timerName only).
 *   - Timer Control pause/resume on a never-started timer now starts
 *     from now in the preview. The preview seeded the record a second
 *     in the past (its getTimerRecord repair), so pausing a timer that
 *     never started made it read 1 second; the export starts fresh.
 *   - Save Variable no longer throws on a quota error in the preview
 *     (the export's try/catch); Load Variable leaves the variable
 *     unchanged on corrupt JSON (the export's behavior; the preview
 *     fell back to the raw string).
 *   - Set Tile and the toward/point source lookups now exclude hidden
 *     objects in the preview (the export's named() semantics).
 *   - Clamp To Screen now uses the hitbox-aware clamp with the
 *     catalog's bounce field in exports (the preview's behavior — the
 *     export clamped the raw position and ignored bounce entirely,
 *     even though the block ships a bounce field).
 *   - Move Toward (direct move) now uses the frame dt in the preview.
 *     The preview used dt || 1, so a move on the first frame (dt 0)
 *     ran at full speed in the preview while standing still in
 *     exports.
 *   - The jump assist inside forceToward now respects collision
 *     layers and ignores objects destroyed earlier in the same frame
 *     in exports (the preview's behavior — the documented layer rule:
 *     layers gate grounded checks too).
 *
 * Deliberately NOT unified (host-owned, called through ctx):
 *   - The preview's screen-shake cooldown (exports never had one) —
 *     the module asks ctx.shakeCooldownOk(data, idx); the export answers
 *     true, the preview enforces its 250ms-per-cell cooldown.
 *   - The preview's once-per-session warn dedupes — the module calls
 *     ctx.warnFlashColor / ctx.warnReadTimerBlank; the export warns
 *     through its deduping diagnostics instead.
 *   - Audio/music playback (playSound, stop/pause/resume/stop-all) —
 *     the hosts own the AudioContext / <audio> calls.
 *   - Scene-switch mechanics and camera clamp/follow — the hosts own
 *     the deferral and the clamping; the module owns the target
 *     validation, the relative-scene math, and the push/pop stack.
 *   - Set Language re-application — the hosts own the bound-text pass
 *     (ctx.applyBoundTexts); the module owns the language check and
 *     the switch.
 *   - Spawn ids use the export's form (Date.now + random); the
 *     preview's spawnCounter is deleted with this slice.
 */

function hydraExecuteFactory() {
  'use strict';

  var MAX_SCENE_STACK = 16;

  function isFn(f) { return typeof f === 'function'; }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function normalizeZoom(value) {
    var z = Number(value);
    return Number.isFinite(z) ? Math.min(4, Math.max(0.25, z)) : 1;
  }

  function isBlankSpawnCoord(v) {
    return v === undefined || v === null || String(v).trim() === '';
  }

  // --- Safe ctx accessors. A missing or throwing host piece degrades to
  // the safe default, never to a throw out of the module. ---

  function named(ctx, name, includeHidden) {
    // A blank name matches nothing. Before this, a blank target
    // matched every nameless object, so a block set to "(none)"
    // silently moved the sprite it could not even list.
    if (!name || (typeof name === 'string' && !name.trim())) return [];
    try {
      var r = ctx.named(name, !!includeHidden);
      return Array.isArray(r) ? r : [];
    } catch (e) { return []; }
  }

  function allObjects(ctx) {
    try {
      var r = ctx.allObjects();
      return Array.isArray(r) ? r : [];
    } catch (e) { return []; }
  }

  function expr(ctx, value) {
    try { return ctx.expr(value); } catch (e) { return 0; }
  }

  function exprInfo(ctx, value) {
    try {
      var r = ctx.exprInfo(value);
      if (!r || typeof r !== 'object') return { ok: false, value: 0 };
      return { ok: !!r.ok, value: r.value };
    } catch (e) { return { ok: false, value: 0 }; }
  }

  function destroyedHas(ctx, id) {
    try { return !!(ctx.destroyed && ctx.destroyed.has(id)); } catch (e) { return false; }
  }

  function hitboxOf(ctx, obj) {
    try {
      var r = ctx.hitbox(obj);
      if (r && typeof r === 'object') return r;
    } catch (e) { /* fall through to the default */ }
    return {
      x: (obj.posX || 0) + (Number(obj.hitboxOffsetX) || 0),
      y: (obj.posY || 0) + (Number(obj.hitboxOffsetY) || 0),
      width: Number(obj.hitboxWidth) > 0 ? Number(obj.hitboxWidth) : (obj.width || 1),
      height: Number(obj.hitboxHeight) > 0 ? Number(obj.hitboxHeight) : (obj.height || 1)
    };
  }

  function physicsOf(ctx, obj) {
    try {
      var r = ctx.getPhysics(obj);
      return (r && typeof r === 'object') ? r : null;
    } catch (e) { return null; }
  }

  function isCollision(ctx, obj) {
    try { return !!(ctx.isCollisionObject && ctx.isCollisionObject(obj)); } catch (e) { return false; }
  }

  function worldSizeOf(ctx) {
    try {
      var s = ctx.worldSize ? ctx.worldSize() : null;
      return (s && typeof s === 'object') ? s : null;
    } catch (e) { return null; }
  }

  function warn(ctx, msg) {
    try { if (isFn(ctx.warn)) ctx.warn(msg); } catch (e) { /* reporting must never break the action */ }
  }

  function storageOf(ctx) {
    try {
      if (typeof ctx.storage === 'function') return ctx.storage();
      return ctx.storage || null;
    } catch (e) { return null; }
  }

  // One warning per block type per session: a block whose target is
  // blank would otherwise spam the diagnostics panel every frame it
  // runs, and the panel is where a targetless block must be visible.
  var warnedBlankTarget = new Set();

  // --- Target resolution (the export's targets()/targetsByName()).
  // Context narrowing: a picked object (obj1/obj2 from the triggering
  // condition) wins when it matches the name; otherwise the first live
  // match, or all of them for targetMode 'all'. Hidden objects are
  // excluded unless includeHidden (the export's named() semantics). ---

  function targets(ctx, data, includeHidden) {
    if (!data.targetObject || (typeof data.targetObject === 'string' && !data.targetObject.trim())) {
      if (!warnedBlankTarget.has(data.type)) {
        warnedBlankTarget.add(data.type);
        warn(ctx, 'No target object is set for "' + (data.type || 'block') + '". Pick an object in the block properties, or the block does nothing.');
      }
      return [];
    }
    var all = named(ctx, data.targetObject || '', includeHidden);
    if (!all.length) return [];
    if (data.targetMode === 'all') return all;
    if (data.targetMode === 'first') return all.slice(0, 1);
    var ectx = ctx.executionContext || {};
    var cands = [ectx.obj1, ectx.obj2];
    for (var i = 0; i < cands.length; i++) {
      var o = cands[i];
      if (o && o.name === (data.targetObject || '') && !destroyedHas(ctx, o.id)) return [o];
    }
    return all.slice(0, 1);
  }

  function targetsByName(ctx, data, name, includeHidden) {
    var all = named(ctx, name || '', includeHidden);
    if (!all.length) return [];
    if (data.targetMode === 'all') return all;
    if (data.targetMode === 'first') return all.slice(0, 1);
    var ectx = ctx.executionContext || {};
    var cands = [ectx.obj1, ectx.obj2];
    for (var i = 0; i < cands.length; i++) {
      var o = cands[i];
      if (o && o.name === (name || '') && !destroyedHas(ctx, o.id)) return [o];
    }
    return all.slice(0, 1);
  }

  // --- Velocity / toward helpers (the two runtimes' shared math). ---

  function applyVelocity(ctx, obj, x, y, mode) {
    if (!obj || obj.kind === 'text') return;
    if (mode === 'set') { obj.velX = x; obj.velY = y; }
    else { obj.velX = (obj.velX || 0) + x; obj.velY = (obj.velY || 0) + y; }
    var p = physicsOf(ctx, obj);
    if (p && Number.isFinite(p.maxSpeed)) {
      obj.velX = clamp(obj.velX, -p.maxSpeed, p.maxSpeed);
      obj.velY = clamp(obj.velY, -p.maxSpeed, p.maxSpeed);
    }
  }

  function hasGravityMovement(ctx, obj) {
    if (!obj || !obj.physicsEnabled) return false;
    var p = physicsOf(ctx, obj);
    return Math.abs((p && p.gravity) || 0) > 0.0001;
  }

  function isObjectGrounded(ctx, obj) {
    if (!obj || !isCollision(ctx, obj)) return false;
    var box = hitboxOf(ctx, obj);
    var bottom = box.y + box.height;
    var tolerance = Math.max(5, Math.abs(obj.velY || 0) + 3);
    var list = allObjects(ctx);
    for (var i = 0; i < list.length; i++) {
      var other = list[i];
      if (!other || other.id === obj.id || !isCollision(ctx, other)) continue;
      if (!(other.static || !other.physicsEnabled)) continue;
      if (ctx.physics2d) {
        try { if (!ctx.physics2d.canCollide(obj, other)) continue; } catch (e) { /* a throwing layer check reads as collidable */ }
      }
      var floor = hitboxOf(ctx, other);
      var horizontal = box.x < floor.x + floor.width - 1 && box.x + box.width > floor.x + 1;
      var vertical = bottom >= floor.y - tolerance && bottom <= floor.y + tolerance;
      if (horizontal && vertical) return true;
    }
    return false;
  }

  // The grounded-detection hooks the HydraMovement module needs, built
  // from this context's live objects + collision helpers (the same
  // shape the export and preview frame hooks build from their own live
  // lists). A throwing hook degrades to the module's safe default
  // instead of breaking the action.
  function movementHooks(ctx) {
    var list = [];
    try { list = allObjects(ctx); } catch (e) { list = []; }
    var p2d = ctx.physics2d || null;
    return {
      objects: list,
      hitbox: function (o) { try { return hitboxOf(ctx, o); } catch (e) { return null; } },
      isCollision: function (o) { try { return isCollision(ctx, o); } catch (e) { return true; } },
      canCollide: (p2d && typeof p2d.canCollide === 'function')
        ? function (a, b) { try { return p2d.canCollide(a, b); } catch (e) { return true; } }
        : null,
      // P4 Advanced batch 27 (one-way platforms): the movement
      // module's grounded check skips a one-way floor while the
      // object rises through it — the physics record is the source
      // of truth, the platform config is the fallback.
      isOneWay: function (o) {
        try {
          if (p2d && typeof p2d.isOneWay === 'function') return !!p2d.isOneWay(o);
        } catch (e) { /* fall through to the config */ }
        try {
          return !!(o && ((o.platform && o.platform.oneWay === true) ||
            (o.collision && o.collision.oneWay === true)));
        } catch (e) { return false; }
      },
      tiles: ctx.tiles || null,
      // P4 Advanced batch 28 (wall slide & wall jump): the held-key
      // set the slide reads the press toward the wall from — the
      // canonical alias-aware lookup, or a plain Set.has when the
      // host did not wire one. A missing set reads as no press.
      keys: ctx.keys || null,
      hasKey: (typeof ctx.hasKey === 'function') ? ctx.hasKey : null
    };
  }

  // The combat hooks the HydraCombat module needs, built from this
  // context's live objects + collision helpers (the same shape the
  // execute module's movementHooks builds for jumps). The damage hook
  // is the Damage Object path — an invincible target skips the hit
  // quietly — and the destroy hook queues a pending destroy, the way
  // the Destroy Object action does. A throwing hook degrades to the
  // module's safe default instead of breaking the action.
  function combatHooks(ctx) {
    var list = [];
    try { list = allObjects(ctx); } catch (e) { list = []; }
    return {
      objects: list,
      hitbox: function (o) {
        try {
          var hb = hitboxOf(ctx, o);
          return { x: hb.x, y: hb.y, w: hb.width, h: hb.height };
        } catch (e) { return null; }
      },
      isCollision: function (o) { try { return isCollision(ctx, o); } catch (e) { return false; } },
      damage: function (target, amount) {
        try {
          if (ctx.damageFxModule && typeof ctx.damageFxModule.isInvincible === 'function') {
            var nowInv = 0;
            try { nowInv = Number(ctx.frozenNowMs()); } catch (e) { nowInv = 0; }
            if (ctx.damageFxModule.isInvincible(target, nowInv)) return;
          }
          if (ctx.healthModule && typeof ctx.healthModule.damage === 'function') {
            ctx.healthModule.damage(target, amount);
          }
        } catch (e) { /* a throwing hit is skipped */ }
      },
      spawn: function (name, x, y) {
        try { return spawnClone(ctx, name, x, y); } catch (e) { return null; }
      },
      destroy: function (o) {
        try { if (o && o.id != null && ctx.pendingDestroy) ctx.pendingDestroy.add(o.id); } catch (e) { /* a throwing destroy is skipped */ }
      },
      isAlive: function (o) {
        try {
          if (!o || o.id == null) return false;
          if (destroyedHas(ctx, o.id)) return false;
          return !(ctx.pendingDestroy && ctx.pendingDestroy.has(o.id));
        } catch (e) { return true; }
      }
    };
  }

  // The Dash block's direction select ('left' / 'right' / 'up' /
  // 'down') as a unit vector; anything else reads as right.
  function dashDirection(direction) {
    var d = String(direction || '').trim().toLowerCase();
    if (d === 'left') return { x: -1, y: 0 };
    if (d === 'up') return { x: 0, y: -1 };
    if (d === 'down') return { x: 0, y: 1 };
    return { x: 1, y: 0 };
  }

  // P4 Advanced batch 31 (level-up rewards & stat growth): the
  // object's grown bonus of one kind ('damage' or 'speed') from the
  // live growth state — 0 when the module or the state is missing,
  // so the combat and dash blocks deal their plain block numbers
  // until something actually grows. Never throws.
  function growthBonusOf(ctx, kind, obj) {
    try {
      var GR = ctx.growthModule;
      if (!GR || !ctx.growth) return 0;
      if (kind === 'damage' && typeof GR.damageBonusOf === 'function') {
        return GR.damageBonusOf(ctx.growth, obj);
      }
      if (kind === 'speed' && typeof GR.speedBonusOf === 'function') {
        return GR.speedBonusOf(ctx.growth, obj);
      }
      return 0;
    } catch (e) {
      return 0;
    }
  }

  // P4 Advanced batch 32 (enemy scaling with the hero's level): the
  // object's scaled damage bonus from the live scaling state — 0
  // when the module or the state is missing, so the combat blocks
  // deal their plain block numbers until something actually scales.
  // The growth bonus and the scaling bonus stack: a grown hero that
  // is also scaled hits for block + growth + scaling. Never throws.
  function scalingBonusOf(ctx, kind, obj) {
    try {
      var SC = ctx.scalingModule;
      if (!SC || !ctx.scaling) return 0;
      if (kind === 'damage' && typeof SC.dmgBonusOf === 'function') {
        return SC.dmgBonusOf(ctx.scaling, obj);
      }
      return 0;
    } catch (e) {
      return 0;
    }
  }

  // P4 Advanced batch 32 (enemy scaling with the hero's level): the
  // hero's current level from the live XP state — 1 when the module
  // or the state is missing, so Scale to Hero Level reads level 1
  // in a game that never touched XP. Never throws.
  function heroLevelOf(ctx) {
    try {
      var XM = ctx.xpModule;
      if (XM && typeof XM.levelOf === 'function') return XM.levelOf(ctx.xp);
      var per = (ctx.xp && isFinite(Number(ctx.xp.xpPerLevel)) && Number(ctx.xp.xpPerLevel) >= 1)
        ? Math.floor(Number(ctx.xp.xpPerLevel)) : 100;
      var total = (ctx.xp && isFinite(Number(ctx.xp.xp))) ? Math.floor(Number(ctx.xp.xp)) : 0;
      if (total < 0) total = 0;
      var lv = Math.floor(total / per) + 1;
      return (lv < 1) ? 1 : lv;
    } catch (e) {
      return 1;
    }
  }

  // Raise (or lower) one live object's max health by the scaling
  // delta, healing by the same delta when it rises — the way Grow
  // Max Health does. The delta comes from the module's setLevel /
  // setRates return, so the live ceiling moves by exactly the
  // ledger's change and never by a re-read of the whole bonus.
  function applyScalingHpDelta(ctx, o, hpDelta) {
    try {
      var HM = ctx.healthModule;
      if (!HM || typeof HM.healthOf !== 'function' ||
          typeof HM.setMaxHealth !== 'function') return;
      if (!hpDelta) return;
      var curMax = HM.healthOf(o).maxHealth;
      HM.setMaxHealth(o, curMax + hpDelta);
      if (hpDelta > 0 && typeof HM.heal === 'function') HM.heal(o, hpDelta);
    } catch (e) { /* a throwing scale is skipped */ }
  }

  function applyPlatformAwareTowardVelocity(ctx, obj, dx, dy, speed, mode, n) {
    var p = physicsOf(ctx, obj) || {};
    var horizontalSpeed = Math.sign(dx || n.x || 0) * Math.min(Math.abs(n.x * speed), Math.abs(speed));
    if (mode === 'add') obj.velX = (obj.velX || 0) + horizontalSpeed;
    else obj.velX = horizontalSpeed;

    var verticalGap = -dy;
    var closeEnoughToJump = Math.abs(dx) <= Math.max(obj.width * 6, Math.abs(speed) * 18, 72);
    var needsJump = verticalGap > Math.max(10, obj.height * 0.25);
    if (needsJump && closeEnoughToJump && isObjectGrounded(ctx, obj)) {
      var jumpVelocity = Math.min(
        p.maxSpeed || 0,
        Math.max(Math.abs(speed) * 1.15, Math.sqrt(Math.max(p.gravity || 0, 0.1) * verticalGap * 2))
      );
      obj.velY = Math.min(obj.velY || 0, -jumpVelocity);
    }

    if (Number.isFinite(p.maxSpeed)) {
      obj.velX = clamp(obj.velX || 0, -p.maxSpeed, p.maxSpeed);
      obj.velY = clamp(obj.velY || 0, -p.maxSpeed, p.maxSpeed);
    }
  }

  function setVelocityToward(ctx, obj, dx, dy, speed, mode) {
    if (!obj || obj.kind === 'text') return;
    var dist = Math.hypot(dx, dy) || 1;
    var nx = dx / dist, ny = dy / dist;
    if (hasGravityMovement(ctx, obj)) {
      applyPlatformAwareTowardVelocity(ctx, obj, dx, dy, speed, mode, { x: nx, y: ny });
      return;
    }
    if (mode === 'add') {
      obj.velX = (obj.velX || 0) + nx * speed;
      obj.velY = (obj.velY || 0) + ny * speed;
    } else {
      obj.velX = nx * speed;
      obj.velY = ny * speed;
    }
    var p = physicsOf(ctx, obj);
    if (p && Number.isFinite(p.maxSpeed)) {
      obj.velX = clamp(obj.velX, -p.maxSpeed, p.maxSpeed);
      obj.velY = clamp(obj.velY, -p.maxSpeed, p.maxSpeed);
    }
  }

  function towardPoint(ctx, data, x, y, directMove) {
    targets(ctx, data).forEach(function (obj) {
      var dx = x - (obj.posX + obj.width / 2);
      var dy = y - (obj.posY + obj.height / 2);
      var dist = Math.hypot(dx, dy) || 1;
      var speed = expr(ctx, data.speed || 3);
      if (directMove) {
        var stop = expr(ctx, data.stopDistance || 1);
        if (dist <= stop) return;
        var step = Math.min(dist - stop, speed * (ctx.dt || 0));
        obj.posX += dx / dist * step;
        obj.posY += dy / dist * step;
      } else {
        setVelocityToward(ctx, obj, dx, dy, speed, data.mode || 'add');
      }
    });
  }

  function towardObject(ctx, data, directMove) {
    var source = named(ctx, data.sourceObject)[0];
    if (!source) return;
    towardPoint(ctx, data, source.posX + source.width / 2, source.posY + source.height / 2, directMove);
  }

  function awayObject(ctx, data) {
    var source = named(ctx, data.sourceObject)[0];
    if (!source) return;
    targets(ctx, data).forEach(function (obj) {
      var dx = (obj.posX + obj.width / 2) - (source.posX + source.width / 2);
      var dy = (obj.posY + obj.height / 2) - (source.posY + source.height / 2);
      setVelocityToward(ctx, obj, dx, dy, expr(ctx, data.speed || 8), data.mode || 'add');
    });
  }

  function pointTo(obj, x, y, offset) {
    obj.rotation = Math.atan2(y - (obj.posY + obj.height / 2), x - (obj.posX + obj.width / 2)) * 180 / Math.PI + offset;
  }

  // AABB minimum-translation separation (the preview's
  // getAABBOverlap + separateObjectsPair, over the ctx hitbox).
  function aabbOverlap(ctx, a, b) {
    var ab = hitboxOf(ctx, a), bb = hitboxOf(ctx, b);
    var dx = (ab.x + ab.width / 2) - (bb.x + bb.width / 2);
    var dy = (ab.y + ab.height / 2) - (bb.y + bb.height / 2);
    var ox = (ab.width / 2 + bb.width / 2) - Math.abs(dx);
    var oy = (ab.height / 2 + bb.height / 2) - Math.abs(dy);
    if (ox <= 0 || oy <= 0) return null;
    return ox < oy ? { nx: Math.sign(dx), ny: 0, depth: ox } : { nx: 0, ny: Math.sign(dy), depth: oy };
  }

  function separatePair(ctx, a, b, mode) {
    var mtv = aabbOverlap(ctx, a, b);
    if (!mtv) return;
    var moveA = mode !== 'object2';
    var moveB = mode !== 'object1';
    if (moveA && moveB) {
      a.posX += mtv.nx * mtv.depth / 2;
      a.posY += mtv.ny * mtv.depth / 2;
      b.posX -= mtv.nx * mtv.depth / 2;
      b.posY -= mtv.ny * mtv.depth / 2;
    } else if (moveA) {
      a.posX += mtv.nx * mtv.depth;
      a.posY += mtv.ny * mtv.depth;
    } else if (moveB) {
      b.posX -= mtv.nx * mtv.depth;
      b.posY -= mtv.ny * mtv.depth;
    }
    if (mtv.nx !== 0) {
      if (moveA) a.velX = 0;
      if (moveB) b.velX = 0;
    }
    if (mtv.ny !== 0) {
      if (moveA) a.velY = 0;
      if (moveB) b.velY = 0;
    }
  }

  function setVisible(ctx, obj, action) {
    if (!ctx.hidden) return;
    if (action === 'show') ctx.hidden.delete(obj.id);
    else if (action === 'toggle') {
      if (ctx.hidden.has(obj.id)) ctx.hidden.delete(obj.id);
      else ctx.hidden.add(obj.id);
    } else ctx.hidden.add(obj.id);
  }

  function setVar(ctx, data, vars) {
    var cur = vars[data.varName] ?? 0;
    var valueInfo = exprInfo(ctx, data.value);
    if (!valueInfo.ok && data.operation !== 'toggle') return;
    var val = valueInfo.value;
    if (data.operation === 'add') vars[data.varName] = cur + val;
    else if (data.operation === 'subtract') vars[data.varName] = cur - val;
    else if (data.operation === 'multiply') vars[data.varName] = cur * val;
    else if (data.operation === 'toggle') vars[data.varName] = !cur;
    else vars[data.varName] = val;
  }

  function randomValue(ctx, data) {
    var min = expr(ctx, data.min), max = expr(ctx, data.max);
    var rnd = 0;
    try { rnd = typeof ctx.random === 'function' ? ctx.random() : Math.random(); } catch (e) { rnd = 0; }
    var val = rnd * (max - min) + min;
    return data.round ? Math.round(val) : val;
  }

  // Clone every authored object with the name at (rawX, rawY) — the
  // Spawn Object / Spawn At Object actions, and the spawner phase's
  // spawn hook (spawnObjectAt below). The clone keeps the source's
  // rotation and runs the full scene init; a missing source stays
  // quiet. Returns the last clone made, or null when nothing was
  // cloned (a missing template, or a host with no object list).
  function spawnClone(ctx, sourceName, rawX, rawY) {
    var defs = [];
    try {
      var d = ctx.sceneObjectDefs ? ctx.sceneObjectDefs() : [];
      if (Array.isArray(d)) defs = d;
    } catch (e) { defs = []; }
    var rnd = '';
    try { rnd = (typeof ctx.random === 'function' ? ctx.random() : Math.random()).toString(36).slice(2); } catch (e) { rnd = 'x'; }
    var made = null;
    defs.filter(function (o) { return o && o.name === sourceName; }).forEach(function (src) {
      var cloneObj = JSON.parse(JSON.stringify(src));
      cloneObj.id = 'spawn_' + Date.now() + '_' + rnd;
      cloneObj.posX = isBlankSpawnCoord(rawX) ? src.posX : expr(ctx, rawX);
      cloneObj.posY = isBlankSpawnCoord(rawY) ? src.posY : expr(ctx, rawY);
      if (ctx.sceneInit && isFn(ctx.sceneInit.initSceneObjects)) {
        var hooks = null;
        try { hooks = isFn(ctx.sceneInitHooks) ? ctx.sceneInitHooks() : {}; } catch (e) { hooks = {}; }
        try { ctx.sceneInit.initSceneObjects([cloneObj], hooks || {}); } catch (e) { /* a throwing init leaves the clone uninitialized */ }
      }
      if (Array.isArray(ctx.objects)) ctx.objects.push(cloneObj);
      made = cloneObj;
    });
    return made;
  }

  // --- Scene helpers (the module owns the validation + the math; the
  // host owns the deferral through requestScene). ---

  function sceneIds(ctx) {
    try {
      var list = (ctx.scenes || []).slice().sort(function (a, b) { return a.id - b.id; });
      return list.map(function (s) { return s.id; });
    } catch (e) { return []; }
  }

  function effectiveSceneId(ctx) {
    return (ctx.pendingSceneId == null) ? ctx.sceneId : ctx.pendingSceneId;
  }

  function requestScene(ctx, id) {
    try { if (isFn(ctx.requestScene)) ctx.requestScene(id); } catch (e) { /* a throwing switch request is skipped */ }
  }

  function switchSceneTo(ctx, sceneId) {
    var ids = sceneIds(ctx);
    var target = null;
    for (var i = 0; i < ids.length; i++) {
      if (ids[i] === Number(sceneId)) { target = ids[i]; break; }
    }
    if (target === null) return;
    var effective = effectiveSceneId(ctx);
    if (target === effective) return;
    requestScene(ctx, target);
  }

  function changeSceneRelative(ctx, dir) {
    var ordered = sceneIds(ctx);
    if (!ordered.length) return;
    var effective = effectiveSceneId(ctx);
    var current = ordered.indexOf(effective);
    var next = ordered[(current + dir + ordered.length) % ordered.length];
    if (next !== undefined && next !== effective) requestScene(ctx, next);
  }

  function pushSceneTo(ctx, sceneId) {
    var ids = sceneIds(ctx);
    var target = null;
    for (var i = 0; i < ids.length; i++) {
      if (ids[i] === Number(sceneId)) { target = ids[i]; break; }
    }
    if (target === null) {
      warn(ctx, 'Push Scene: no scene with id ' + sceneId + '; nothing happened.');
      return;
    }
    var effective = effectiveSceneId(ctx);
    if (target === effective) return;
    if (!Array.isArray(ctx.sceneStack)) return;
    if (ctx.sceneStack.length >= MAX_SCENE_STACK) {
      warn(ctx, 'Push Scene: the scene stack is full (' + MAX_SCENE_STACK + '); Pop Scene some scenes before pushing more.');
      return;
    }
    ctx.sceneStack.push(effective);
    requestScene(ctx, target);
  }

  function popSceneBack(ctx) {
    if (!Array.isArray(ctx.sceneStack)) return;
    var backTo = ctx.sceneStack.pop();
    if (backTo == null) {
      warn(ctx, 'Pop Scene: no scene was pushed; nothing happened.');
      return;
    }
    var ids = sceneIds(ctx);
    var found = false;
    for (var i = 0; i < ids.length; i++) {
      if (ids[i] === Number(backTo)) { found = true; break; }
    }
    if (!found) return;
    var effective = effectiveSceneId(ctx);
    if (Number(backTo) !== effective) requestScene(ctx, Number(backTo));
  }

  // --- Screen-bounds helpers (the preview's hitbox-aware clamp with the
  // catalog's bounce field; the export clamped the raw position and
  // ignored bounce). ---

  function clampToScreen(ctx, data) {
    var size = worldSizeOf(ctx);
    if (!size) return;
    targets(ctx, data).forEach(function (obj) {
      var oldX = obj.posX, oldY = obj.posY;
      var box = hitboxOf(ctx, obj);
      if (box.x < 0) obj.posX += -box.x;
      if (box.y < 0) obj.posY += -box.y;
      if (box.x + box.width > size.width) obj.posX -= (box.x + box.width) - size.width;
      if (box.y + box.height > size.height) obj.posY -= (box.y + box.height) - size.height;
      if (data.bounce) {
        if (obj.posX !== oldX) obj.velX = -(obj.velX || 0);
        if (obj.posY !== oldY) obj.velY = -(obj.velY || 0);
      }
    });
  }

  function wrapScreen(ctx, data) {
    var size = worldSizeOf(ctx);
    if (!size) return;
    targets(ctx, data).forEach(function (obj) {
      if (obj.posX + obj.width < 0) obj.posX = size.width;
      if (obj.posX > size.width) obj.posX = -obj.width;
      if (obj.posY + obj.height < 0) obj.posY = size.height;
      if (obj.posY > size.height) obj.posY = -obj.height;
    });
  }

  function destroyOutside(ctx, data) {
    var size = worldSizeOf(ctx);
    if (!size) return;
    var margin = Math.max(0, expr(ctx, data.margin || 0));
    targets(ctx, data).forEach(function (obj) {
      var b = hitboxOf(ctx, obj);
      if (b.x + b.width < -margin || b.x > size.width + margin ||
          b.y + b.height < -margin || b.y > size.height + margin) {
        if (ctx.pendingDestroy) ctx.pendingDestroy.add(obj.id);
      }
    });
  }

  // --- Timers (the export's controlTimer / readTimerValue). ---

  function controlTimer(ctx, data) {
    var name = String(data.timerName || data.name || '').trim();
    if (!name) return;
    if (!ctx.timers || typeof ctx.timers.get !== 'function') return;
    var key = 'named:' + name;
    var now = 0;
    try { now = Number(ctx.nowMs()); } catch (e) { now = 0; }
    if (!Number.isFinite(now)) now = 0;
    var record = null;
    try { record = ctx.timers.get(key); } catch (e) { record = null; }
    if (!record || typeof record !== 'object') {
      record = { lastFiredTime: now, paused: false, pausedAt: 0, firedFrame: -1 };
    }
    if (data.action === 'pause') { record.paused = true; record.pausedAt = now; }
    else if (data.action === 'resume' && record.paused) {
      record.lastFiredTime += now - (record.pausedAt || now);
      record.paused = false;
    } else if (data.action === 'clear') {
      try { ctx.timers.delete(key); } catch (e) { /* a throwing map is skipped */ }
      return;
    } else {
      record = { lastFiredTime: now, paused: false, pausedAt: 0, firedFrame: -1 };
    }
    try { ctx.timers.set(key, record); } catch (e) { /* a throwing map is skipped */ }
  }

  function readTimerValue(ctx, data, vars) {
    var tName = String(data.timerName || data.name || '').trim();
    var vName = String(data.varName || '').trim();
    if (!vName) {
      try { if (isFn(ctx.warnReadTimerBlank)) ctx.warnReadTimerBlank('variable'); } catch (e) { /* reporting must never break the action */ }
      return;
    }
    if (!tName) {
      try { if (isFn(ctx.warnReadTimerBlank)) ctx.warnReadTimerBlank('timer'); } catch (e) { /* reporting must never break the action */ }
    }
    var now = 0;
    try { now = Number(ctx.frozenNowMs()); } catch (e) { now = 0; }
    if (!Number.isFinite(now)) now = 0;
    var elapsed = 0;
    if (tName) {
      try { elapsed = ctx.timerElapsedSeconds ? ctx.timerElapsedSeconds('named:' + tName, now) : 0; } catch (e) { elapsed = 0; }
      if (!Number.isFinite(elapsed)) elapsed = 0;
    }
    vars[vName] = elapsed;
  }

  function setPhysics(ctx, data, key) {
    targets(ctx, data).forEach(function (o) {
      o.physics = o.physics || {};
      o.physics[key] = expr(ctx, data[key]);
      o.physicsEnabled = true;
    });
  }

  function particleSpec(ctx, data) {
    return {
      x: expr(ctx, data.x ?? 0), y: expr(ctx, data.y ?? 0),
      count: data.count, speed: data.speed, spread: data.spread,
      direction: data.direction, lifetime: data.lifetime,
      size0: data.size0, size1: data.size1, color0: data.color0, color1: data.color1,
      gravity: data.gravity, shape: data.shape, additive: data.additive
    };
  }

  // --- Subsystem delegations (each returns true when it handled the
  // block; a missing module or a missing hook builder reads as not
  // handling it, so the switch below still sees the block). ---

  function subsystemHooks(ctx, name, data) {
    try {
      var fn = ctx[name];
      if (!isFn(fn)) return null;
      var h = fn(data);
      return (h && typeof h === 'object') ? h : null;
    } catch (e) { return null; }
  }

  function isType(mod, fnName, type) {
    try { return !!mod && isFn(mod[fnName]) && mod[fnName](type); } catch (e) { return false; }
  }

  function subsystemAction(ctx, module, hooksName, method, data, extraArgs) {
    if (!module || !isFn(module[method])) return false;
    var hooks = subsystemHooks(ctx, hooksName, data);
    if (!hooks) return false;
    try { module[method].apply(null, (extraArgs || []).concat([hooks])); } catch (e) { /* a throwing subsystem action is skipped */ }
    return true;
  }

  // Execute one action block. Never throws: a bad block, a missing ctx
  // piece, or a throwing subsystem hook degrades to the action being
  // skipped.
  function executeInner(data, ctx, idx) {
    var vars = ctx.variables || {};
    if (!data) return;
    var type = data.type;

    // Subsystem dispatches first (the export's order): each shared
    // module owns the semantics of its own block family.
    if (isType(ctx.collections, 'isCollectionAction', type)) {
      subsystemAction(ctx, ctx.collections, 'collectionHooks', 'applyCollectionAction', data, [vars, data]);
      return;
    }
    if (isType(ctx.math, 'isMathAction', type)) {
      subsystemAction(ctx, ctx.math, 'mathHooks', 'applyMathAction', data, [vars, data]);
      return;
    }
    if (isType(ctx.layerFx, 'isLayerFxAction', type)) {
      subsystemAction(ctx, ctx.layerFx, 'layerFxActionHooks', 'applyLayerFxAction', data, [data]);
      return;
    }
    if (isType(ctx.threeD, 'is3dAction', type)) {
      subsystemAction(ctx, ctx.threeD, 'threeDActionHooks', 'apply3dAction', data, [data]);
      return;
    }
    if (isType(ctx.light2d, 'isLight2dAction', type)) {
      subsystemAction(ctx, ctx.light2d, 'light2dActionHooks', 'applyLight2dAction', data, [data]);
      return;
    }
    if (isType(ctx.joints, 'isJointAction', type)) {
      subsystemAction(ctx, ctx.joints, 'jointActionHooks', 'applyJointAction', data, [data]);
      return;
    }
    // P4 Advanced (skeletal animation): play / stop / pose. Catalog
    // blocks carry the object in object1; unknown animations/bones warn
    // and hold, blank names stay quiet (the export's inline handling).
    if (isType(ctx.skeleton, 'isSkeletonAction', type)) {
      var skelTargets = targetsByName(ctx, data, data.object1 || '');
      if (type === 'playSkeletonAnimation') {
        if (!String(data.object1 || '').trim()) return;
        if (!skelTargets.length) {
          warn(ctx, 'Play Skeleton Animation: no object named "' + data.object1 + '" — skipped.');
          return;
        }
        skelTargets.forEach(function (o) {
          o._skel = o._skel || ctx.skeleton.createSkeletonRuntime();
          ctx.skeleton.setSkeletonAnimation(o._skel, o, data.animation, {
            warn: function (msg) { warn(ctx, msg); }
          });
        });
      } else if (type === 'stopSkeletonAnimation') {
        skelTargets.forEach(function (o) {
          ctx.skeleton.stopSkeletonAnimation(o._skel, o, data.animation);
        });
      } else if (type === 'setBoneAngle') {
        if (!String(data.object1 || '').trim()) return;
        if (!skelTargets.length) {
          warn(ctx, 'Set Bone Angle: no object named "' + data.object1 + '" — skipped.');
          return;
        }
        var av = exprInfo(ctx, data.angle ?? 0);
        if (!av || !av.ok) {
          warn(ctx, 'Set Bone Angle: bad angle — skipped.');
          return;
        }
        skelTargets.forEach(function (o) {
          o._skel = o._skel || ctx.skeleton.createSkeletonRuntime();
          ctx.skeleton.setBoneAngle(o._skel, o, data.bone, av.value, {
            warn: function (msg) { warn(ctx, msg); }
          });
        });
      }
      return;
    }
    // P4 Advanced (localization): switch language / read a key into a
    // text object / read a key into a variable. Unknown languages and
    // keys warn and hold; blank names stay quiet. Switching language
    // re-applies every bound text object at once (host-owned pass).
    if (isType(ctx.localization, 'isLocalizationAction', type)) {
      if (type === 'setLanguage') {
        var code = String(data.language || '').trim();
        if (!code) return;
        if (!ctx.localization.isKnownLanguage(ctx.localizationTable, code)) {
          warn(ctx, 'Set Language: no language "' + code + '" in the Localization tab. The language was not changed.');
          return;
        }
        try { if (isFn(ctx.setLanguage)) ctx.setLanguage(code); } catch (e) { /* a throwing language write is skipped */ }
        try { if (isFn(ctx.applyBoundTexts)) ctx.applyBoundTexts(); } catch (e) { /* a throwing re-apply is skipped */ }
      } else if (type === 'setTextFromKey') {
        if (!String(data.object1 || '').trim() || !String(data.key || '').trim()) return;
        var locTargets = targetsByName(ctx, data, data.object1 || '');
        if (!locTargets.length) {
          warn(ctx, 'Set Text from Key: no object named "' + data.object1 + '" — skipped.');
          return;
        }
        var lang = '';
        try { lang = isFn(ctx.getLanguage) ? ctx.getLanguage() : ''; } catch (e) { lang = ''; }
        var text = null;
        try { text = ctx.localization.resolveLocalized(ctx.localizationTable, data.key, lang); } catch (e) { text = null; }
        if (text === null) {
          warn(ctx, 'Set Text from Key: no translation for key "' + data.key + '" in "' + lang + '" or the default language. The text was not changed.');
          return;
        }
        locTargets.forEach(function (o) { if (o.kind === 'text') o._runtimeText = text; });
      } else if (type === 'setVariableFromKey') {
        if (!String(data.varName || '').trim() || !String(data.key || '').trim()) return;
        var lang2 = '';
        try { lang2 = isFn(ctx.getLanguage) ? ctx.getLanguage() : ''; } catch (e) { lang2 = ''; }
        var text2 = null;
        try { text2 = ctx.localization.resolveLocalized(ctx.localizationTable, data.key, lang2); } catch (e) { text2 = null; }
        if (text2 === null) {
          warn(ctx, 'Set Variable from Key: no translation for key "' + data.key + '" in "' + lang2 + '" or the default language. The variable was not changed.');
          return;
        }
        vars[data.varName] = text2;
      }
      return;
    }
    // P4 Advanced batch 7 (dialogue): start / advance / pick / stop a
    // named conversation, and write a choice's label into a text object
    // for home-made choice buttons. The per-frame typewriter update is
    // host-owned (both runtimes call it from their runScripts phase);
    // this section only handles the block-triggered steps. Unknown
    // dialogue names and out-of-range options warn and hold; blank
    // names stay quiet.
    if (isType(ctx.dialogueModule, 'isDialogueAction', type)) {
      var Dlg = ctx.dialogueModule;
      var drt = ctx.dialogue;
      var dhooks = null;
      try { dhooks = isFn(ctx.dialogueHooks) ? ctx.dialogueHooks() : null; } catch (e) { dhooks = null; }
      if (type === 'startDialogue') {
        if (!String(data.dialogue || '').trim()) return;
        try {
          Dlg.startDialogue(drt, ctx.dialogues, data.dialogue, {
            charsPerSec: Number(data.typingSpeed),
            speakerObject: data.speakerObject || '',
            textObject: data.textObject || ''
          }, dhooks);
        } catch (e) { /* a throwing start is skipped */ }
      } else if (type === 'advanceDialogue') {
        try { Dlg.advanceDialogue(drt, dhooks); } catch (e) { /* a throwing advance is skipped */ }
      } else if (type === 'chooseDialogueOption') {
        try { Dlg.chooseDialogue(drt, Number(data.option), dhooks); } catch (e) { /* a throwing pick is skipped */ }
      } else if (type === 'stopDialogue') {
        try { Dlg.stopDialogue(drt, dhooks); } catch (e) { /* a throwing stop is skipped */ }
      } else if (type === 'setDialogueChoiceText') {
        if (!String(data.object1 || '').trim()) return;
        var choiceLabel = null;
        try { choiceLabel = Dlg.choiceLabel(drt, Number(data.option)); } catch (e) { choiceLabel = null; }
        if (choiceLabel === null) {
          // Out of range while waiting is an authoring error (warn +
          // hold); not waiting at all is a timing state (quiet).
          var waiting = false;
          var avail = 0;
          try { waiting = !!(drt && drt.active && drt.waitingChoice); } catch (e) { waiting = false; }
          try { avail = (Dlg && isFn(Dlg.choiceCount)) ? Dlg.choiceCount(drt) : 0; } catch (e) { avail = 0; }
          if (waiting) {
            warn(ctx, 'Set Choice Text: option ' + data.option + ' is not one of the ' + avail + ' choices. The text was not changed.');
          }
          return;
        }
        targetsByName(ctx, data, data.object1 || '').forEach(function (o) { if (o.kind === 'text') o._runtimeText = choiceLabel; });
      }
      return;
    }
    // P4 Advanced batch 8 (inventory): add / remove / set / read /
    // clear the run's backpack. Counts come through the expression
    // evaluator, so a variable can feed them (Add Item "Gold coin"
    // `reward`). Unknown item names and bad counts warn and hold;
    // blank names stay quiet. The backpack itself lives on ctx (the
    // host owns the per-run runtime); the module only mutates it.
    if (isType(ctx.inventoryModule, 'isInventoryAction', type)) {
      var Inv = ctx.inventoryModule;
      var irt = ctx.inventory;
      var ihooks = null;
      try { ihooks = isFn(ctx.inventoryHooks) ? ctx.inventoryHooks() : null; } catch (e) { ihooks = null; }
      if (type === 'addItem') {
        if (!String(data.item || '').trim()) return;
        try { Inv.addItem(irt, ctx.items, data.item, expr(ctx, data.count), ihooks); } catch (e) { /* a throwing add is skipped */ }
      } else if (type === 'removeItem') {
        if (!String(data.item || '').trim()) return;
        try { Inv.removeItem(irt, ctx.items, data.item, expr(ctx, data.count), ihooks); } catch (e) { /* a throwing remove is skipped */ }
      } else if (type === 'setItemCount') {
        if (!String(data.item || '').trim()) return;
        try { Inv.setItemCount(irt, ctx.items, data.item, expr(ctx, data.count), ihooks); } catch (e) { /* a throwing set is skipped */ }
      } else if (type === 'readItemCount') {
        if (!String(data.item || '').trim() || !String(data.varName || '').trim()) return;
        var readCount = null;
        try { readCount = Inv.readItemCount(irt, ctx.items, data.item, ihooks); } catch (e) { readCount = null; }
        if (readCount !== null) vars[data.varName] = readCount;
      } else if (type === 'clearInventory') {
        try { Inv.clearInventory(irt); } catch (e) { /* a throwing clear is skipped */ }
      }
      return;
    }
    // P4 Advanced batch 9 (quests): add / set / complete / reset /
    // read / clear the run's quest log. Amounts come through the
    // expression evaluator, so a variable can feed them (Add Quest
    // Progress "Collect 4 coins" `coinsFound`). Unknown quest names
    // and bad amounts warn and hold; blank names stay quiet. The log
    // itself lives on ctx (the host owns the per-run runtime); the
    // module only mutates it.
    if (isType(ctx.questModule, 'isQuestAction', type)) {
      var Q = ctx.questModule;
      var qrt = ctx.questLog;
      var qhooks = null;
      try { qhooks = isFn(ctx.questHooks) ? ctx.questHooks() : null; } catch (e) { qhooks = null; }
      if (type === 'addQuestProgress') {
        if (!String(data.quest || '').trim()) return;
        try { Q.addQuestProgress(qrt, ctx.quests, data.quest, expr(ctx, data.amount), qhooks); } catch (e) { /* a throwing add is skipped */ }
      } else if (type === 'setQuestProgress') {
        if (!String(data.quest || '').trim()) return;
        try { Q.setQuestProgress(qrt, ctx.quests, data.quest, expr(ctx, data.amount), qhooks); } catch (e) { /* a throwing set is skipped */ }
      } else if (type === 'completeQuest') {
        if (!String(data.quest || '').trim()) return;
        try { Q.completeQuest(qrt, ctx.quests, data.quest, qhooks); } catch (e) { /* a throwing complete is skipped */ }
      } else if (type === 'resetQuest') {
        if (!String(data.quest || '').trim()) return;
        try { Q.resetQuest(qrt, ctx.quests, data.quest, qhooks); } catch (e) { /* a throwing reset is skipped */ }
      } else if (type === 'readQuestProgress') {
        if (!String(data.quest || '').trim() || !String(data.varName || '').trim()) return;
        var readProgress = null;
        try { readProgress = Q.readQuestProgress(qrt, ctx.quests, data.quest, qhooks); } catch (e) { readProgress = null; }
        if (readProgress !== null) vars[data.varName] = readProgress;
      } else if (type === 'clearQuests') {
        try { Q.clearQuests(qrt); } catch (e) { /* a throwing clear is skipped */ }
      }
      return;
    }

    // P4 Advanced batch 10 (achievements): unlock / lock / reset /
    // read the game's unlocked set. The module persists on change
    // through the hooks' persist (a host write into storage), so an
    // unlock survives a restart; a throwing persist never breaks the
    // set. Blank names stay quiet; unknown names warn and hold.
    if (isType(ctx.achievementModule, 'isAchievementAction', type)) {
      var A = ctx.achievementModule;
      var art = ctx.achievementLog;
      var ahooks = null;
      try { ahooks = isFn(ctx.achievementHooks) ? ctx.achievementHooks() : null; } catch (e) { ahooks = null; }
      if (type === 'unlockAchievement') {
        if (!String(data.achievement || '').trim()) return;
        try { A.unlockAchievement(art, ctx.achievements, data.achievement, ahooks); } catch (e) { /* a throwing unlock is skipped */ }
      } else if (type === 'lockAchievement') {
        if (!String(data.achievement || '').trim()) return;
        try { A.lockAchievement(art, ctx.achievements, data.achievement, ahooks); } catch (e) { /* a throwing lock is skipped */ }
      } else if (type === 'resetAchievements') {
        try { A.resetAchievements(art, ahooks); } catch (e) { /* a throwing reset is skipped */ }
      } else if (type === 'readAchievementCount') {
        if (!String(data.varName || '').trim()) return;
        var achCount = 0;
        try { achCount = A.achievementCount(art); } catch (e) { achCount = 0; }
        vars[data.varName] = achCount;
      }
      return;
    }

    // P4 Advanced batch 11 (cutscenes): play / stop the run's
    // cutscene. Play replaces any cutscene already playing; stop
    // counts as finished, so a skip button runs the same hook as a
    // natural ending. Blank play names stay quiet (nothing starts);
    // blank stop names stop whichever cutscene is playing. Unknown
    // names warn and hold. The runtime itself lives on ctx (the host
    // owns the per-run runtime and advances it once per frame from
    // the runScripts phase); the module only mutates it.
    if (isType(ctx.cutsceneModule, 'isCutsceneAction', type)) {
      var C = ctx.cutsceneModule;
      var crt = ctx.cutscene;
      var chooks = null;
      try { chooks = isFn(ctx.cutsceneHooks) ? ctx.cutsceneHooks() : null; } catch (e) { chooks = null; }
      if (type === 'playCutscene') {
        if (!String(data.cutscene || '').trim()) return;
        try { C.playCutscene(crt, ctx.cutscenes, data.cutscene, chooks); } catch (e) { /* a throwing play is skipped */ }
      } else if (type === 'stopCutscene') {
        try { C.stopCutscene(crt, ctx.cutscenes, data.cutscene, chooks); } catch (e) { /* a throwing stop is skipped */ }
      }
      return;
    }

    // P4 Advanced batch 12 (high scores): submit / read / clear the
    // game's ranked table. The score comes through the expression
    // evaluator, so a variable can feed it (Submit Score `score`).
    // A score that does not make a full table changes nothing; a
    // non-numeric score warns and holds. Reading a rank past the end
    // of the table writes nothing, and a blank variable field is
    // skipped, so each read writes only the variables it was given.
    // The table itself lives on ctx (the host owns the per-run
    // runtime and loads it from storage at boot); the module only
    // mutates it, and persists on change through the hooks' persist.
    if (isType(ctx.highScoreModule, 'isHighScoreAction', type)) {
      var H = ctx.highScoreModule;
      var hrt = ctx.highScoreTable;
      var hhooks = null;
      try { hhooks = isFn(ctx.highScoreHooks) ? ctx.highScoreHooks() : null; } catch (e) { hhooks = null; }
      if (type === 'submitScore') {
        try { H.submitScore(hrt, ctx.highScoreConfig, data.name, expr(ctx, data.score), hhooks); } catch (e) { /* a throwing submit is skipped */ }
      } else if (type === 'clearHighScores') {
        try { H.clearHighScores(hrt, hhooks); } catch (e) { /* a throwing clear is skipped */ }
      } else if (type === 'readHighScore') {
        var readEntry = null;
        try { readEntry = H.readHighScore(hrt, expr(ctx, data.rank)); } catch (e) { readEntry = null; }
        if (readEntry !== null) {
          if (String(data.varName || '').trim()) vars[data.varName] = readEntry.score;
          if (String(data.nameVarName || '').trim()) vars[data.nameVarName] = readEntry.name;
        }
      }
      return;
    }

    // P4 Advanced batch 13 (time scale): set / reset / read the
    // game's clock speed. The scale comes through the expression
    // evaluator, so a variable can feed it (Set Time Scale
    // `gameSpeed`) — via exprInfo, so a failed expression warns and
    // holds instead of freezing the world on a typo (the setVar
    // shape, not the bare-expr shape: a bad scale reads as 0 through
    // plain expr(), and 0 is a frozen world). A non-numeric scale
    // warns and holds; any other value clamps to 0..4. Reading the
    // scale writes it into the named variable, and a blank variable
    // field is skipped. The runtime itself lives on ctx (the host
    // owns the per-run runtime and resets it on a fresh run); the
    // module only mutates it.
    if (isType(ctx.timeScaleModule, 'isTimeScaleAction', type)) {
      var T = ctx.timeScaleModule;
      var trt = ctx.timeScale;
      var thooks = null;
      try { thooks = isFn(ctx.timeScaleHooks) ? ctx.timeScaleHooks() : null; } catch (e) { thooks = null; }
      if (type === 'setTimeScale') {
        try {
          var scaleInfo = exprInfo(ctx, data.scale);
          T.setTimeScale(trt, scaleInfo.ok ? scaleInfo.value : NaN, thooks);
        } catch (e) { /* a throwing set is skipped */ }
      } else if (type === 'resetTimeScale') {
        try { T.resetTimeScale(trt); } catch (e) { /* a throwing reset is skipped */ }
      } else if (type === 'readTimeScale') {
        var scaleVal = 1;
        try { scaleVal = T.timeScaleOf(trt); } catch (e) { scaleVal = 1; }
        if (String(data.varName || '').trim()) vars[data.varName] = scaleVal;
      }
      return;
    }

    // P4 Advanced batch 14 (scene transitions): fade / wipe to a
    // scene instead of an instant cut, or cancel one that is playing.
    // The duration comes through exprInfo, so a variable can feed it
    // — and a BLANK duration reads as the configured default, not 0
    // (the bare-expr shape would read a blank as 0, and 0 is an
    // instant cut, so a blank field must not mean "cut"). A failed
    // expression warns and holds instead of starting a transition on
    // a typo. The runtime itself lives on ctx (the host owns the
    // per-run runtime and advances it once per frame from the
    // runScripts phase); the module only mutates it.
    if (isType(ctx.transitionModule, 'isTransitionAction', type)) {
      var TR = ctx.transitionModule;
      var trt2 = ctx.transition;
      var trhooks = null;
      try { trhooks = isFn(ctx.transitionHooks) ? ctx.transitionHooks() : null; } catch (e) { trhooks = null; }
      if (type === 'transitionToScene') {
        var durRaw = data.duration;
        var durVal = null;
        var durOk = true;
        if (durRaw != null && String(durRaw).trim() !== '') {
          var durInfo = exprInfo(ctx, durRaw);
          durOk = durInfo.ok;
          durVal = durInfo.ok ? durInfo.value : null;
        }
        if (!durOk) {
          warn(ctx, 'Transition to Scene: the duration is not a number. Nothing changed.');
        } else {
          try { TR.startTransition(trt2, ctx.transitionConfig, data.sceneId, { effect: data.effect, duration: durVal }, trhooks); } catch (e) { /* a throwing start is skipped */ }
        }
      } else if (type === 'cancelTransition') {
        try { TR.cancelTransition(trt2); } catch (e) { /* a throwing cancel is skipped */ }
      }
      return;
    }

    // P4 Advanced batch 15 (camera feel): follow smoothing, deadzone,
    // and camera bounds. The values come through exprInfo, so a
    // variable can feed them — and a failed expression warns and
    // holds instead of writing a bad value on a typo. The live feel
    // record comes from ctx.cameraFeel() (the host owns it and
    // replaces it on every scene load); the module only mutates it,
    // never the scene's authored config. A missing record stays
    // quiet — the host has not loaded a scene yet.
    if (isType(ctx.cameraFeelModule, 'isCameraFeelAction', type)) {
      var CF = ctx.cameraFeelModule;
      var feel = null;
      try { feel = isFn(ctx.cameraFeel) ? ctx.cameraFeel() : null; } catch (e) { feel = null; }
      if (type === 'setCameraSmoothing') {
        var smoothInfo = exprInfo(ctx, data.smoothing);
        if (!smoothInfo.ok) {
          warn(ctx, 'Set Camera Smoothing: the smoothing is not a number. Nothing changed.');
        } else if (feel) {
          try { feel.smoothing = CF.normalizeSmoothing(smoothInfo.value); } catch (e) { /* a throwing write is skipped */ }
        }
      } else if (type === 'setCameraDeadzone') {
        var dzWInfo = exprInfo(ctx, data.width);
        var dzHInfo = exprInfo(ctx, data.height);
        if (!dzWInfo.ok || !dzHInfo.ok) {
          warn(ctx, 'Set Camera Deadzone: the width or height is not a number. Nothing changed.');
        } else if (feel) {
          try {
            feel.deadzoneW = CF.normalizeDeadzone(dzWInfo.value);
            feel.deadzoneH = CF.normalizeDeadzone(dzHInfo.value);
          } catch (e) { /* a throwing write is skipped */ }
        }
      } else if (type === 'setCameraBounds') {
        var bMinX = exprInfo(ctx, data.minX);
        var bMinY = exprInfo(ctx, data.minY);
        var bMaxX = exprInfo(ctx, data.maxX);
        var bMaxY = exprInfo(ctx, data.maxY);
        if (!bMinX.ok || !bMinY.ok || !bMaxX.ok || !bMaxY.ok) {
          warn(ctx, 'Set Camera Bounds: one of the edges is not a number. Nothing changed.');
        } else {
          var newBounds = null;
          try {
            newBounds = CF.normalizeCameraBounds({ minX: bMinX.value, minY: bMinY.value, maxX: bMaxX.value, maxY: bMaxY.value });
          } catch (e) { newBounds = null; }
          if (!newBounds) {
            warn(ctx, 'Set Camera Bounds: the bounds are not a valid rectangle (Min must be below Max). Nothing changed.');
          } else if (feel) {
            try { feel.bounds = newBounds; } catch (e) { /* a throwing write is skipped */ }
          }
        }
      } else if (type === 'clearCameraBounds') {
        if (feel) {
          try { feel.bounds = null; } catch (e) { /* a throwing write is skipped */ }
        }
      }
      return;
    }

    // P4 Advanced batch 16 (parallax backgrounds): per-object scroll
    // factors. The values come through exprInfo, so a variable can feed
    // them — and a failed expression warns and holds instead of writing
    // a bad value on a typo (the camera-feel rule). The factors live on
    // the live objects themselves, so the write lands on the run's
    // clones, never the authored project data; a missing object name
    // stays quiet.
    if (isType(ctx.parallaxModule, 'isParallaxAction', type)) {
      var PX = ctx.parallaxModule;
      if (type === 'setParallax') {
        var pxInfo = exprInfo(ctx, data.parallaxX);
        var pyInfo = exprInfo(ctx, data.parallaxY);
        if (!pxInfo.ok || !pyInfo.ok) {
          warn(ctx, 'Set Parallax: the X or Y factor is not a number. Nothing changed.');
        } else {
          targets(ctx, data).forEach(function (o) {
            try {
              o.parallaxX = PX.normalizeParallaxFactor(pxInfo.value);
              o.parallaxY = PX.normalizeParallaxFactor(pyInfo.value);
            } catch (e) { /* a throwing write is skipped */ }
          });
        }
      }
      return;
    }

    // P4 Advanced batch 17 (positional audio): a sound plays from a
    // place in the world, so it gets quieter (and pans left/right)
    // the further the listener — the center of the screen — is from
    // it. The source is an object (its center) or a bare X/Y point
    // when no object is named; a failed distance or position
    // expression warns and holds (the camera-feel rule); a missing
    // object stays quiet, like Set Parallax. Past the hear-within
    // distance the mix volume is 0, so nothing plays and no voice is
    // taken — being out of earshot is the feature working, not an
    // error. The mix rides on a copy of the block's data (volume
    // pre-scaled, pan set), so the bus math and the preview's
    // per-cell cooldown downstream see the final values, and plain
    // Play Sound calls are untouched.
    if (isType(ctx.spatialAudioModule, 'isSpatialAudioAction', type)) {
      var SA = ctx.spatialAudioModule;
      if (type === 'playSoundAtPosition') {
        var mdInfo = exprInfo(ctx, data.maxDistance);
        if (!mdInfo.ok) {
          warn(ctx, 'Play Sound at Position: the hear-within distance is not a number. Nothing played.');
        } else {
          var srcPos = null;
          var srcName = (typeof data.atObject === 'string') ? data.atObject.trim() : '';
          if (srcName) {
            var srcObj = named(ctx, srcName, true)[0];
            if (srcObj) srcPos = SA.objectCenter(srcObj);
          } else {
            var xi = exprInfo(ctx, data.posX);
            var yi = exprInfo(ctx, data.posY);
            if (!xi.ok || !yi.ok) {
              warn(ctx, 'Play Sound at Position: the X or Y position is not a number. Nothing played.');
            } else {
              srcPos = { x: xi.value, y: yi.value };
            }
          }
          if (srcPos) {
            var mix = SA.spatialMix(srcPos, SA.listenerOf(ctx.camera, ctx.canvasWidth, ctx.canvasHeight), mdInfo.value);
            if (mix.volume > 0) {
              var baseVol = Number(data.volume);
              if (!isFinite(baseVol) || baseVol <= 0) baseVol = 0.3;
              var playData = {};
              Object.keys(data).forEach(function (k) { playData[k] = data[k]; });
              playData.volume = baseVol * mix.volume;
              playData.pan = mix.pan;
              try { if (isFn(ctx.playSound)) ctx.playSound(playData, idx); } catch (e) { /* a throwing sound is skipped */ }
            }
          }
        }
      }
      return;
    }

    // P4 Advanced batch 18 (pathfinding): an object walks around the
    // tilemap's walls to a destination. The destination is an object
    // (its center, hidden objects included, so a hidden waypoint
    // marker works) or a bare X/Y point when no object is named; a
    // failed speed or position expression warns and holds (the
    // camera-feel rule); a missing mover or destination object stays
    // quiet, like Set Parallax. The grid is built fresh from the
    // live tilemaps on every call, the path is smoothed with
    // line-of-sight string pulling, and a new Follow Path replaces
    // the path already walking. An unreachable destination warns and
    // holds instead of starting a path to nowhere.
    if (isType(ctx.pathfindModule, 'isPathfindAction', type)) {
      var PF = ctx.pathfindModule;
      if (type === 'followPath') {
        var spInfo = exprInfo(ctx, data.speed);
        if (!spInfo.ok) {
          warn(ctx, 'Follow Path: the speed is not a number. Nothing moved.');
        } else {
          var destPos = null;
          var destName = (typeof data.destinationObject === 'string') ? data.destinationObject.trim() : '';
          if (destName) {
            var destObj = named(ctx, destName, true)[0];
            if (destObj) destPos = PF.objectCenter(destObj);
          } else {
            var dxInfo = exprInfo(ctx, data.posX);
            var dyInfo = exprInfo(ctx, data.posY);
            if (!dxInfo.ok || !dyInfo.ok) {
              warn(ctx, 'Follow Path: the X or Y destination is not a number. Nothing moved.');
            } else {
              destPos = { x: dxInfo.value, y: dyInfo.value };
            }
          }
          if (destPos) {
            var movers = targets(ctx, data);
            if (movers.length) {
              var ws = null;
              try { ws = (isFn(ctx.worldSize) ? ctx.worldSize() : null); } catch (e) { ws = null; }
              var tilemaps = allObjects(ctx).filter(function (o) { return o && o.kind === 'tilemap'; });
              var grid = null;
              try { grid = PF.buildWalkGrid(ws ? ws.width : null, ws ? ws.height : null, tilemaps, ctx.tiles); } catch (e) { grid = null; }
              var started = 0;
              movers.forEach(function (mover) {
                var from = PF.objectCenter(mover);
                var rawPath = null;
                try { rawPath = grid ? PF.findPath(grid, from.x, from.y, destPos.x, destPos.y) : null; } catch (e) { rawPath = null; }
                if (!rawPath) return;
                var smooth = null;
                try { smooth = PF.simplifyPath(grid, rawPath); } catch (e) { smooth = rawPath; }
                if (PF.startPath(mover, smooth, spInfo.value)) started++;
              });
              if (!started) warn(ctx, 'Follow Path: no path from ' + (data.targetObject || 'the object') + ' to the destination. Nothing moved.');
            }
          }
        }
      } else if (type === 'stopPath') {
        targets(ctx, data).forEach(function (o) {
          try { PF.stopPath(o); } catch (e) { /* a throwing stop is skipped */ }
        });
      }
      return;
    }

    // P4 Advanced batch 19 (AI behaviors): an object decides where to
    // walk on its own — patrol between two points, chase a target,
    // flee from it, or wander around home. The action only writes the
    // behavior record; the per-frame brain plans the walks. A bad
    // speed or range expression warns and holds (the camera-feel
    // rule); a missing mover stays quiet, like Set Parallax; a
    // missing target or patrol point stays quiet too — the brain
    // holds the object where it stands until the point exists. A new
    // behavior (or 'none') stops the walking path, so the brain
    // always plans fresh on the next frame.
    if (isType(ctx.aiModule, 'isAiAction', type)) {
      var AI = ctx.aiModule;
      if (type === 'setAiBehavior') {
        var aiSpInfo = exprInfo(ctx, data.speed);
        if (!aiSpInfo.ok) {
          warn(ctx, 'Set AI Behavior: the speed is not a number. Nothing changed.');
        } else {
          var aiRgInfo = exprInfo(ctx, data.range);
          if (!aiRgInfo.ok) {
            warn(ctx, 'Set AI Behavior: the range is not a number. Nothing changed.');
          } else {
            targets(ctx, data).forEach(function (o) {
              try {
                AI.setBehavior(o, {
                  behavior: data.behavior,
                  target: data.targetName,
                  speed: aiSpInfo.value,
                  range: aiRgInfo.value,
                  patrolA: data.patrolA,
                  patrolB: data.patrolB
                });
              } catch (e) { /* a throwing behavior write is skipped */ }
              try {
                if (ctx.pathfindModule && typeof ctx.pathfindModule.stopPath === 'function') ctx.pathfindModule.stopPath(o);
              } catch (e) { /* a throwing stop is skipped */ }
            });
          }
        }
      } else if (type === 'stopAi') {
        targets(ctx, data).forEach(function (o) {
          try { AI.stopBehavior(o); } catch (e) { /* a throwing stop is skipped */ }
          try {
            if (ctx.pathfindModule && typeof ctx.pathfindModule.stopPath === 'function') ctx.pathfindModule.stopPath(o);
          } catch (e) { /* a throwing stop is skipped */ }
        });
      }
      return;
    }

    // P4 Advanced batch 20 (virtual joystick): turn the on-screen
    // stick on or off for the rest of the run. Enable only flips the
    // live flag (the project default from the Joystick tab decides
    // the starting state); Disable also lets go of a held stick, so
    // the tilt reads 0 again instead of freezing mid-steer. A
    // missing live record stays quiet, like a missing module.
    if (isType(ctx.joystickModule, 'isJoystickAction', type)) {
      var JM = ctx.joystickModule;
      if (type === 'enableJoystick') {
        try { if (ctx.joystick) ctx.joystick.enabled = true; } catch (e) { /* a throwing flag flip is skipped */ }
      } else if (type === 'disableJoystick') {
        try {
          if (ctx.joystick) {
            if (JM && typeof JM.joystickEnd === 'function' && ctx.joystick.pointerId != null) JM.joystickEnd(ctx.joystick, ctx.joystick.pointerId);
            ctx.joystick.enabled = false;
          }
        } catch (e) { /* a throwing flag flip is skipped */ }
      }
      return;
    }

    // P4 Advanced batch 21 (health & damage): move an object's hit
    // points. Damage clamps at 0 (the hit that reaches 0 is the one
    // Object Died fires on), Heal clamps at the ceiling, Set Health
    // writes an exact value clamped into 0..max, Set Max Health moves
    // the ceiling and re-clamps the current health to it. A bad
    // amount or value expression warns and holds (the camera-feel
    // rule); a missing object stays quiet, like Set Parallax.
    if (isType(ctx.healthModule, 'isHealthAction', type)) {
      var HM = ctx.healthModule;
      if (type === 'damageObject') {
        var dmgInfo = exprInfo(ctx, data.amount);
        if (!dmgInfo.ok) {
          warn(ctx, 'Damage Object: the amount is not a number. Nothing changed.');
        } else {
          targets(ctx, data).forEach(function (o) {
            try {
              // P4 Advanced batch 22 (damage feedback): an invincible
              // target skips the hit quietly — the shield blocks hits,
              // not help, so Heal / Set Health still apply below. The
              // shield runs on the frozen game clock, so it holds while
              // paused and through a stutter. Without the module (or a
              // frozen clock) the hit lands as before.
              if (ctx.damageFxModule && typeof ctx.damageFxModule.isInvincible === 'function') {
                var nowInv = 0;
                try { nowInv = Number(ctx.frozenNowMs()); } catch (e) { nowInv = 0; }
                if (ctx.damageFxModule.isInvincible(o, nowInv)) return;
              }
              HM.damage(o, dmgInfo.value);
            } catch (e) { /* a throwing damage is skipped */ }
          });
        }
      } else if (type === 'healObject') {
        var healInfo = exprInfo(ctx, data.amount);
        if (!healInfo.ok) {
          warn(ctx, 'Heal Object: the amount is not a number. Nothing changed.');
        } else {
          targets(ctx, data).forEach(function (o) {
            try { HM.heal(o, healInfo.value); } catch (e) { /* a throwing heal is skipped */ }
          });
        }
      } else if (type === 'setHealth') {
        var setHpInfo = exprInfo(ctx, data.value);
        if (!setHpInfo.ok) {
          warn(ctx, 'Set Health: the value is not a number. Nothing changed.');
        } else {
          targets(ctx, data).forEach(function (o) {
            try { HM.setHealth(o, setHpInfo.value); } catch (e) { /* a throwing write is skipped */ }
          });
        }
      } else if (type === 'setMaxHealth') {
        var setMaxInfo = exprInfo(ctx, data.value);
        if (!setMaxInfo.ok) {
          warn(ctx, 'Set Max Health: the value is not a number. Nothing changed.');
        } else {
          targets(ctx, data).forEach(function (o) {
            try { HM.setMaxHealth(o, setMaxInfo.value); } catch (e) { /* a throwing write is skipped */ }
          });
        }
      }
      return;
    }

    // P4 Advanced batch 29 (combat): melee attacks & projectiles.
    // Melee Attack swings in front of the attacker and Shoot
    // Projectile fires a clone of the picked template; both run
    // through the shared HydraCombat module with the same damage path
    // Damage Object uses (invincible targets skip the hit). A bad
    // number warns and holds, a missing object or template stays
    // quiet, and a press during the cooldown does nothing (the module
    // refuses quietly, like Dash). With no combat state at all both
    // blocks stay quiet, like the movement blocks without theirs.
    if (isType(ctx.combatModule, 'isCombatAction', type)) {
      var CB = ctx.combatModule;
      var cbState = null;
      try { cbState = (typeof ctx.ensureCombatState === 'function') ? ctx.ensureCombatState() : ctx.combat; } catch (e) { cbState = null; }
      var cbNow = 0;
      try { cbNow = Number(ctx.frozenNowMs()) / 1000; } catch (e) { cbNow = 0; }
      if (type === 'meleeAttack') {
        var mav = exprInfo(ctx, data.damage);
        var mrv = exprInfo(ctx, data.range);
        var mcv = exprInfo(ctx, data.cooldown);
        if (!mav.ok) {
          warn(ctx, 'Melee Attack: the damage is not a number. Nothing changed.');
        } else if (!mrv.ok) {
          warn(ctx, 'Melee Attack: the range is not a number. Nothing changed.');
        } else if (!mcv.ok) {
          warn(ctx, 'Melee Attack: the cooldown is not a number. Nothing changed.');
        } else if (cbState) {
          var mHooks = combatHooks(ctx);
          targets(ctx, data).forEach(function (o) {
            try { CB.meleeAttack(cbState, o, { damage: mav.value + growthBonusOf(ctx, 'damage', o) + scalingBonusOf(ctx, 'damage', o), range: mrv.value, direction: data.direction, cooldown: mcv.value }, mHooks, cbNow); } catch (e) { /* a throwing swing is skipped */ }
          });
        }
      } else if (type === 'shootProjectile') {
        var spv = exprInfo(ctx, data.speed);
        var sdv = exprInfo(ctx, data.damage);
        var slv = exprInfo(ctx, data.lifetime);
        var scv = exprInfo(ctx, data.cooldown);
        if (!spv.ok) {
          warn(ctx, 'Shoot Projectile: the speed is not a number. Nothing changed.');
        } else if (!sdv.ok) {
          warn(ctx, 'Shoot Projectile: the damage is not a number. Nothing changed.');
        } else if (!slv.ok) {
          warn(ctx, 'Shoot Projectile: the lifetime is not a number. Nothing changed.');
        } else if (!scv.ok) {
          warn(ctx, 'Shoot Projectile: the cooldown is not a number. Nothing changed.');
        } else if (cbState) {
          var sHooks = combatHooks(ctx);
          targets(ctx, data).forEach(function (o) {
            try { CB.shootProjectile(cbState, o, { template: data.projectileObject, direction: data.direction, speed: spv.value, damage: sdv.value + growthBonusOf(ctx, 'damage', o) + scalingBonusOf(ctx, 'damage', o), lifetime: slv.value, cooldown: scv.value }, sHooks, cbNow); } catch (e) { /* a throwing shot is skipped */ }
          });
        }
      }
      return;
    }

    // P4 Advanced batch 30 (experience & leveling): killing things
    // should make the hero stronger. Add XP tops the total up (10 by
    // default — one coin, one defeated enemy), Set XP writes it
    // outright, Set XP Per Level rewrites what one level costs (100
    // by default), Read XP / Read Level copy the total and the
    // derived level into variables — a game that never touched XP
    // reads 0 XP at level 1, like a timer that never started reads
    // 0. A bad amount warns and holds, a blank variable name warns
    // and holds. With no XP state at all the blocks stay quiet, like
    // the spawner blocks without their module.
    if (isType(ctx.xpModule, 'isXpAction', type)) {
      var XP = ctx.xpModule;
      if (type === 'addXp') {
        var axv = exprInfo(ctx, data.amount);
        if (!axv.ok) {
          warn(ctx, 'Add XP: the amount is not a number. Nothing changed.');
        } else if (ctx.xp) {
          try { XP.addXp(ctx.xp, axv.value); } catch (e) { /* a throwing add is skipped */ }
        }
      } else if (type === 'setXp') {
        var sxv = exprInfo(ctx, data.xp);
        if (!sxv.ok) {
          warn(ctx, 'Set XP: the XP value is not a number. Nothing changed.');
        } else if (ctx.xp) {
          try { XP.setXp(ctx.xp, sxv.value); } catch (e) { /* a throwing set is skipped */ }
        }
      } else if (type === 'setXpPerLevel') {
        var spv = exprInfo(ctx, data.amount);
        if (!spv.ok) {
          warn(ctx, 'Set XP Per Level: the amount is not a number. Nothing changed.');
        } else if (ctx.xp) {
          try { XP.setXpPerLevel(ctx.xp, spv.value); } catch (e) { /* a throwing set is skipped */ }
        }
      } else if (type === 'readXp') {
        var rxVar = String(data.varName || '').trim();
        if (!rxVar) {
          warn(ctx, 'Read XP: the variable name is blank. Name the variable that should receive the XP.');
        } else {
          var rxTotal = 0;
          try { rxTotal = XP.xpOf(ctx.xp); } catch (e) { rxTotal = 0; }
          vars[rxVar] = rxTotal;
        }
      } else if (type === 'readLevel') {
        var rlVar = String(data.varName || '').trim();
        if (!rlVar) {
          warn(ctx, 'Read Level: the variable name is blank. Name the variable that should receive the level.');
        } else {
          var rlLevel = 1;
          try { rlLevel = XP.levelOf(ctx.xp); } catch (e) { rlLevel = 1; }
          vars[rlVar] = rlLevel;
        }
      }
      return;
    }

    // P4 Advanced batch 31 (level-up rewards & stat growth): leveling
    // up should make the hero stronger. Grow Max Health raises the
    // ceiling (and heals by the same amount unless Heal is Off), Grow
    // Damage adds a per-object bonus the combat blocks add to every
    // hit, Grow Speed quickens the object's dashes, Level Reward
    // applies a picked bundle through the same writers, and the three
    // Read blocks copy one object's bonuses into variables. A bad
    // amount or an unknown bundle warns and holds, a blank variable
    // name warns and holds, a missing object stays quiet. With no
    // growth state at all the blocks stay quiet, like the XP blocks
    // without theirs.
    if (isType(ctx.growthModule, 'isGrowthAction', type)) {
      var GR = ctx.growthModule;
      var HM = ctx.healthModule;
      if (type === 'growMaxHealth') {
        var gmhv = exprInfo(ctx, data.amount);
        if (!gmhv.ok) {
          warn(ctx, 'Grow Max Health: the amount is not a number. Nothing changed.');
        } else if (ctx.growth) {
          var healOn = data.heal !== false;
          targets(ctx, data).forEach(function (o) {
            try {
              GR.addMaxHealthBonus(ctx.growth, o, gmhv.value);
              if (HM && typeof HM.healthOf === 'function' &&
                  typeof HM.setMaxHealth === 'function') {
                var curMax = HM.healthOf(o).maxHealth;
                HM.setMaxHealth(o, curMax + gmhv.value);
                if (healOn && typeof HM.heal === 'function') HM.heal(o, gmhv.value);
              }
            } catch (e) { /* a throwing growth is skipped */ }
          });
        }
      } else if (type === 'growDamage') {
        var gdv = exprInfo(ctx, data.amount);
        if (!gdv.ok) {
          warn(ctx, 'Grow Damage: the amount is not a number. Nothing changed.');
        } else if (ctx.growth) {
          targets(ctx, data).forEach(function (o) {
            try { GR.addDamageBonus(ctx.growth, o, gdv.value); } catch (e) { /* a throwing growth is skipped */ }
          });
        }
      } else if (type === 'growSpeed') {
        var gsv = exprInfo(ctx, data.amount);
        if (!gsv.ok) {
          warn(ctx, 'Grow Speed: the amount is not a number. Nothing changed.');
        } else if (ctx.growth) {
          targets(ctx, data).forEach(function (o) {
            try { GR.addSpeedBonus(ctx.growth, o, gsv.value); } catch (e) { /* a throwing growth is skipped */ }
          });
        }
      } else if (type === 'levelReward') {
        var bundleName = String(data.bundle || '').trim().toLowerCase();
        var bundle = null;
        try { bundle = GR.rewardBundle(bundleName); } catch (e) { bundle = null; }
        if (!bundle) {
          warn(ctx, 'Level Reward: pick a reward bundle (Balanced, Tank, Striker, or Swift). Nothing changed.');
        } else if (ctx.growth) {
          targets(ctx, data).forEach(function (o) {
            try {
              var applied = GR.applyReward(ctx.growth, o, bundleName);
              if (HM && applied) {
                if (applied.maxHealth > 0 &&
                    typeof HM.healthOf === 'function' &&
                    typeof HM.setMaxHealth === 'function') {
                  var curMax2 = HM.healthOf(o).maxHealth;
                  HM.setMaxHealth(o, curMax2 + applied.maxHealth);
                }
                if (applied.heal > 0 && typeof HM.heal === 'function') HM.heal(o, applied.heal);
              }
            } catch (e) { /* a throwing reward is skipped */ }
          });
        }
      } else if (type === 'readMaxHealthBonus') {
        var rmVar = String(data.varName || '').trim();
        if (!rmVar) {
          warn(ctx, 'Read Max Health Bonus: the variable name is blank. Name the variable that should receive the bonus.');
        } else {
          var rmBonus = 0;
          try {
            var rmTargets = targets(ctx, data);
            if (rmTargets.length) rmBonus = GR.maxHealthBonusOf(ctx.growth, rmTargets[0]);
          } catch (e) { rmBonus = 0; }
          vars[rmVar] = rmBonus;
        }
      } else if (type === 'readDamageBonus') {
        var rdVar = String(data.varName || '').trim();
        if (!rdVar) {
          warn(ctx, 'Read Damage Bonus: the variable name is blank. Name the variable that should receive the bonus.');
        } else {
          var rdBonus = 0;
          try {
            var rdTargets = targets(ctx, data);
            if (rdTargets.length) rdBonus = GR.damageBonusOf(ctx.growth, rdTargets[0]);
          } catch (e) { rdBonus = 0; }
          vars[rdVar] = rdBonus;
        }
      } else if (type === 'readSpeedBonus') {
        var rsVar = String(data.varName || '').trim();
        if (!rsVar) {
          warn(ctx, 'Read Speed Bonus: the variable name is blank. Name the variable that should receive the bonus.');
        } else {
          var rsBonus = 0;
          try {
            var rsTargets = targets(ctx, data);
            if (rsTargets.length) rsBonus = GR.speedBonusOf(ctx.growth, rsTargets[0]);
          } catch (e) { rsBonus = 0; }
          vars[rsVar] = rsBonus;
        }
      }
      return;
    }

    // P4 Advanced batch 32 (enemy scaling with the hero's level):
    // the hero grows but the enemies do not — until now. Set Enemy
    // Level writes an enemy's level (its max health rises by the
    // level bonus and heals by the same rise, its Melee Attack and
    // Shoot Projectile hits carry the damage bonus), Set Scaling
    // Rates rewrites what one level is worth for that enemy, Scale
    // to Hero Level copies the run's current player level onto it,
    // and the three Read blocks copy its level and bonuses into
    // variables. A bad level or rate warns and holds, a blank
    // variable name warns and holds, a missing object stays quiet.
    // With no scaling state at all the blocks stay quiet, like the
    // growth blocks without theirs.
    if (isType(ctx.scalingModule, 'isScalingAction', type)) {
      var SC = ctx.scalingModule;
      if (type === 'setEnemyLevel') {
        var selv = exprInfo(ctx, data.level);
        if (!selv.ok) {
          warn(ctx, 'Set Enemy Level: the level is not a number. Nothing changed.');
        } else if (ctx.scaling) {
          targets(ctx, data).forEach(function (o) {
            try {
              var applied = SC.setLevel(ctx.scaling, o, selv.value);
              if (applied) applyScalingHpDelta(ctx, o, applied.hpDelta);
            } catch (e) { /* a throwing scale is skipped */ }
          });
        }
      } else if (type === 'setScalingRates') {
        var srhp = exprInfo(ctx, data.hpPerLevel);
        var srdmg = exprInfo(ctx, data.dmgPerLevel);
        if (!srhp.ok || !srdmg.ok) {
          warn(ctx, 'Set Scaling Rates: the HP per level or the damage per level is not a number. Nothing changed.');
        } else if (ctx.scaling) {
          targets(ctx, data).forEach(function (o) {
            try {
              var rated = SC.setRates(ctx.scaling, o, srhp.value, srdmg.value);
              if (rated) applyScalingHpDelta(ctx, o, rated.hpDelta);
            } catch (e) { /* a throwing scale is skipped */ }
          });
        }
      } else if (type === 'scaleToHeroLevel') {
        if (ctx.scaling) {
          var heroLv = heroLevelOf(ctx);
          targets(ctx, data).forEach(function (o) {
            try {
              var scaled = SC.setLevel(ctx.scaling, o, heroLv);
              if (scaled) applyScalingHpDelta(ctx, o, scaled.hpDelta);
            } catch (e) { /* a throwing scale is skipped */ }
          });
        }
      } else if (type === 'readEnemyLevel') {
        var relVar = String(data.varName || '').trim();
        if (!relVar) {
          warn(ctx, 'Read Enemy Level: the variable name is blank. Name the variable that should receive the level.');
        } else {
          var relLevel = 1;
          try {
            var relTargets = targets(ctx, data);
            if (relTargets.length) relLevel = SC.levelOf(ctx.scaling, relTargets[0]);
          } catch (e) { relLevel = 1; }
          vars[relVar] = relLevel;
        }
      } else if (type === 'readScaledHpBonus') {
        var rshVar = String(data.varName || '').trim();
        if (!rshVar) {
          warn(ctx, 'Read Scaled HP Bonus: the variable name is blank. Name the variable that should receive the bonus.');
        } else {
          var rshBonus = 0;
          try {
            var rshTargets = targets(ctx, data);
            if (rshTargets.length) rshBonus = SC.hpBonusOf(ctx.scaling, rshTargets[0]);
          } catch (e) { rshBonus = 0; }
          vars[rshVar] = rshBonus;
        }
      } else if (type === 'readScaledDmgBonus') {
        var rsdVar = String(data.varName || '').trim();
        if (!rsdVar) {
          warn(ctx, 'Read Scaled Damage Bonus: the variable name is blank. Name the variable that should receive the bonus.');
        } else {
          var rsdBonus = 0;
          try {
            var rsdTargets = targets(ctx, data);
            if (rsdTargets.length) rsdBonus = SC.dmgBonusOf(ctx.scaling, rsdTargets[0]);
          } catch (e) { rsdBonus = 0; }
          vars[rsdVar] = rsdBonus;
        }
      }
      return;
    }

    // P4 Advanced batch 33 (boss encounters): the run's big fight.
    // Start Boss names the boss object (recorded by name, so a boss
    // that spawns later still counts), picks the phase count, and
    // shows the bar; End Boss clears the fight; Show / Hide Boss Bar
    // toggle the bar without ending it; Read Boss Phase copies the
    // current phase number into a variable (0 when no fight runs, or
    // the boss has not spawned yet). A blank boss name or a bad
    // phases value warns and holds, a blank variable name warns and
    // holds, and with no boss state at all the blocks stay quiet,
    // like the scaling blocks without theirs.
    if (isType(ctx.bossModule, 'isBossAction', type)) {
      var BO = ctx.bossModule;
      if (type === 'startBoss') {
        var sbName = String(data.targetObject || '').trim();
        var sbPhases = exprInfo(ctx, data.phases);
        if (!sbName) {
          warn(ctx, 'Start Boss: the boss object is blank. Name the object that is the boss.');
        } else if (!sbPhases.ok) {
          warn(ctx, 'Start Boss: the phase count is not a number. Nothing changed.');
        } else if (ctx.boss) {
          try { BO.startBoss(ctx.boss, sbName, sbPhases.value, data.showBar !== false); } catch (e) { /* a throwing start is skipped */ }
        }
      } else if (type === 'endBoss') {
        if (ctx.boss) {
          try { BO.endBoss(ctx.boss); } catch (e) { /* a throwing end is skipped */ }
        }
      } else if (type === 'showBossBar') {
        if (ctx.boss) {
          try { BO.setBarVisible(ctx.boss, true); } catch (e) { /* a throwing show is skipped */ }
        }
      } else if (type === 'hideBossBar') {
        if (ctx.boss) {
          try { BO.setBarVisible(ctx.boss, false); } catch (e) { /* a throwing hide is skipped */ }
        }
      } else if (type === 'readBossPhase') {
        var rbpVar = String(data.varName || '').trim();
        if (!rbpVar) {
          warn(ctx, 'Read Boss Phase: the variable name is blank. Name the variable that should receive the phase.');
        } else {
          var rbpPhase = 0;
          try {
            if (ctx.boss && BO.isActive(ctx.boss)) {
              var rbpTargets = targetsByName(ctx, data, ctx.boss.objectName);
              var rbpFrac = rbpTargets.length ? BO.fractionOf(rbpTargets[0], ctx.healthModule) : null;
              rbpPhase = BO.phaseOfState(ctx.boss, rbpFrac);
            }
          } catch (e) { rbpPhase = 0; }
          vars[rbpVar] = rbpPhase;
        }
      }
      return;
    }

    // P4 Advanced batch 36 (minimap): the small live map in the
    // corner. Show / Hide Minimap flip the run record's visible flag
    // for the current scene; Set Minimap Size / Set Minimap Zoom
    // write the run record's size / zoom. A bad size or zoom warns
    // and holds, and with no minimap state at all the blocks stay
    // quiet, like the boss blocks without theirs. The scene's
    // authored config is never touched — a fresh scene re-mints its
    // own run record.
    if (isType(ctx.minimapModule, 'isMinimapAction', type)) {
      var MM = ctx.minimapModule;
      if (type === 'showMinimap') {
        if (ctx.minimap) {
          try { MM.setVisible(ctx.minimap, true); } catch (e) { /* a throwing show is skipped */ }
        }
      } else if (type === 'hideMinimap') {
        if (ctx.minimap) {
          try { MM.setVisible(ctx.minimap, false); } catch (e) { /* a throwing hide is skipped */ }
        }
      } else if (type === 'setMinimapSize') {
        var smsSize = exprInfo(ctx, data.size);
        if (!smsSize.ok) {
          warn(ctx, 'Set Minimap Size: the size is not a number. Nothing changed.');
        } else if (ctx.minimap) {
          var smsDone = false;
          try { smsDone = MM.setSize(ctx.minimap, smsSize.value); } catch (e) { smsDone = false; }
          if (!smsDone) warn(ctx, 'Set Minimap Size: the size is not a number. Nothing changed.');
        }
      } else if (type === 'setMinimapZoom') {
        var smzZoom = exprInfo(ctx, data.zoom);
        if (!smzZoom.ok) {
          warn(ctx, 'Set Minimap Zoom: the zoom is not a number. Nothing changed.');
        } else if (ctx.minimap) {
          var smzDone = false;
          try { smzDone = MM.setZoom(ctx.minimap, smzZoom.value); } catch (e) { smzDone = false; }
          if (!smzDone) warn(ctx, 'Set Minimap Zoom: the zoom is not a number. Nothing changed.');
        }
      }
      return;
    }

    // P4 Advanced batch 37 (object parenting): one object rides on
    // another at a fixed offset. Attach Object To Object links the
    // child to the parent (a blank offset keeps the spacing the
    // objects already have); Detach Object drops the link; Set
    // Attachment Offset moves the child to a new spacing without
    // re-attaching. A blank name, a self-attach, or a link that
    // would close a cycle warns and holds; a bad offset warns and
    // holds; with no attach state at all the blocks stay quiet,
    // like the minimap blocks without theirs. A link to an object
    // that has not spawned yet stays quiet and starts working the
    // frame it appears.
    if (isType(ctx.attachModule, 'isAttachAction', type)) {
      var AT = ctx.attachModule;
      if (type === 'attachObjectToObject') {
        var atChild = String(data.childObject || '').trim();
        var atParent = String(data.parentObject || '').trim();
        if (!atChild) {
          warn(ctx, 'Attach Object To Object: the child object is blank. Name the object to attach.');
        } else if (!atParent) {
          warn(ctx, 'Attach Object To Object: the parent object is blank. Name the object to attach to.');
        } else if (atChild === atParent) {
          warn(ctx, 'Attach Object To Object: an object cannot be attached to itself. Name a different parent.');
        } else if (ctx.attachments) {
          var atDx = 0, atDy = 0, atOk = true;
          var atBlankX = data.offsetX == null || String(data.offsetX).trim() === '';
          var atBlankY = data.offsetY == null || String(data.offsetY).trim() === '';
          if (atBlankX || atBlankY) {
            // Keep the current spacing: read it off the live objects.
            // A missing child or parent cannot give a spacing, so the
            // block warns and holds instead of guessing 0, 0.
            var atKid = named(ctx, atChild)[0] || null;
            var atPar = named(ctx, atParent)[0] || null;
            if (!atKid || !atPar) {
              warn(ctx, 'Attach Object To Object: the child or the parent is not in the scene yet, so the spacing cannot be read. Give the offsets instead.');
              atOk = false;
            } else {
              atDx = (atKid.posX || 0) - (atPar.posX || 0);
              atDy = (atKid.posY || 0) - (atPar.posY || 0);
              if (!atBlankX) {
                var atXi = exprInfo(ctx, data.offsetX);
                if (!atXi.ok) { warn(ctx, 'Attach Object To Object: the offset is not a number. Nothing attached.'); atOk = false; }
                else atDx = atXi.value;
              }
              if (atOk && !atBlankY) {
                var atYi = exprInfo(ctx, data.offsetY);
                if (!atYi.ok) { warn(ctx, 'Attach Object To Object: the offset is not a number. Nothing attached.'); atOk = false; }
                else atDy = atYi.value;
              }
            }
          } else {
            var atXf = exprInfo(ctx, data.offsetX);
            var atYf = exprInfo(ctx, data.offsetY);
            if (!atXf.ok || !atYf.ok) {
              warn(ctx, 'Attach Object To Object: the offset is not a number. Nothing attached.');
              atOk = false;
            } else {
              atDx = atXf.value;
              atDy = atYf.value;
            }
          }
          if (atOk) {
            var atDone = false;
            try {
              // Follow rotation / scale come from the block's
              // checkboxes. A block placed before batch 38 carries
              // neither key, and stays position-only, the way it
              // was authored; a new block defaults both on.
              var atFollowR = data.followRotation === undefined ? false : data.followRotation === true;
              var atFollowS = data.followScale === undefined ? false : data.followScale === true;
              // Capture the transform baseline while both objects
              // are live, so the follow measures from where they
              // actually are. A link to an object that has not
              // spawned yet captures lazily on its first apply
              // frame instead.
              var atCap = null;
              var atKidL = named(ctx, atChild)[0] || null;
              var atParL = named(ctx, atParent)[0] || null;
              if (atKidL && atParL && AT.captureTransform) {
                try { atCap = AT.captureTransform(atParL, atKidL); } catch (e) { atCap = null; }
              }
              atDone = AT.attach(ctx.attachments, atChild, atParent, atDx, atDy,
                { followRotation: atFollowR, followScale: atFollowS, capture: atCap });
            } catch (e) { atDone = false; }
            if (!atDone) warn(ctx, 'Attach Object To Object: attaching "' + atChild + '" to "' + atParent + '" would close a cycle. Nothing attached.');
          }
        }
      } else if (type === 'detachObject') {
        var dtName = String(data.targetObject || '').trim();
        if (!dtName) {
          warn(ctx, 'Detach Object: the object is blank. Name the object to detach.');
        } else if (ctx.attachments) {
          try { AT.detach(ctx.attachments, dtName); } catch (e) { /* a throwing detach is skipped */ }
        }
      } else if (type === 'setAttachmentOffset') {
        var soName = String(data.targetObject || '').trim();
        if (!soName) {
          warn(ctx, 'Set Attachment Offset: the object is blank. Name the attached object.');
        } else {
          var soXi = exprInfo(ctx, data.offsetX);
          var soYi = exprInfo(ctx, data.offsetY);
          if (!soXi.ok || !soYi.ok) {
            warn(ctx, 'Set Attachment Offset: the offset is not a number. Nothing changed.');
          } else if (ctx.attachments) {
            var soDone = false;
            try { soDone = AT.setOffset(ctx.attachments, soName, soXi.value, soYi.value); } catch (e) { soDone = false; }
            if (!soDone) warn(ctx, 'Set Attachment Offset: "' + soName + '" is not attached to anything. Attach it first.');
          }
        }
      } else if (type === 'setAttachmentFollow') {
        // P4 Advanced batch 38 (rotation + scale following): flip
        // either follow box on a link that already stands, without
        // moving the child. The capture is re-based to the live
        // transforms, so the child stays exactly where it is and
        // follows from there. A block placed before batch 38 cannot
        // exist (the block is new), so a missing box reads as on,
        // the block's own default.
        var sfName = String(data.targetObject || '').trim();
        if (!sfName) {
          warn(ctx, 'Set Attachment Follow: the object is blank. Name the attached object.');
        } else if (ctx.attachments) {
          var sfR = data.followRotation === undefined ? true : data.followRotation === true;
          var sfS = data.followScale === undefined ? true : data.followScale === true;
          var sfCap = null;
          var sfLink = null;
          try { sfLink = AT.attachmentOf(ctx.attachments, sfName); } catch (e) { sfLink = null; }
          if (sfLink) {
            var sfKid = named(ctx, sfName)[0] || null;
            var sfPar = named(ctx, sfLink.parent)[0] || null;
            if (sfKid && sfPar && AT.captureTransform) {
              try { sfCap = AT.captureTransform(sfPar, sfKid); } catch (e) { sfCap = null; }
            }
          }
          var sfDone = false;
          try { sfDone = AT.setFollow(ctx.attachments, sfName, sfR, sfS, sfCap); } catch (e) { sfDone = false; }
          if (!sfDone) warn(ctx, 'Set Attachment Follow: "' + sfName + '" is not attached to anything. Attach it first.');
        }
      }
      return;
    }

    // P4 Advanced batch 34 (object tags): labels a whole group of
    // objects can share. Add Tag sticks a label on a live object,
    // Remove Tag takes one off, Clear Tags takes them all off, and
    // Read Tagged Count copies how many live objects carry a tag
    // into a variable. A blank object or tag warns and holds, a
    // blank variable name warns and holds, and with no tags module
    // at all the blocks stay quiet, like the boss blocks without
    // theirs. Runtime tags last until the scene loads again; the
    // Inspector chips are the permanent ones.
    if (isType(ctx.tagsModule, 'isTagAction', type)) {
      var TG = ctx.tagsModule;
      if (type === 'addTag' || type === 'removeTag') {
        var tgVerb = (type === 'addTag') ? 'Add Tag' : 'Remove Tag';
        var tgName = String(data.targetObject || '').trim();
        var tgTag = String(data.tag || '').trim();
        if (!tgName) {
          warn(ctx, tgVerb + ': the object is blank. Name the object to tag.');
        } else if (!tgTag) {
          warn(ctx, tgVerb + ': the tag is blank. Name the tag to ' + ((type === 'addTag') ? 'add.' : 'remove.'));
        } else {
          var tgTargets = targetsByName(ctx, data, tgName);
          tgTargets.forEach(function (o) {
            try { if (type === 'addTag') TG.addTag(o, tgTag); else TG.removeTag(o, tgTag); } catch (e) { /* a throwing tag write is skipped */ }
          });
        }
      } else if (type === 'clearTags') {
        var ctName = String(data.targetObject || '').trim();
        if (!ctName) {
          warn(ctx, 'Clear Tags: the object is blank. Name the object to clear.');
        } else {
          targetsByName(ctx, data, ctName).forEach(function (o) {
            try { TG.clearTags(o); } catch (e) { /* a throwing tag write is skipped */ }
          });
        }
      } else if (type === 'readTaggedCount') {
        var rtcTag = String(data.tag || '').trim();
        var rtcVar = String(data.varName || '').trim();
        if (!rtcTag) {
          warn(ctx, 'Read Tagged Count: the tag is blank. Name the tag to count.');
        } else if (!rtcVar) {
          warn(ctx, 'Read Tagged Count: the variable name is blank. Name the variable that should receive the count.');
        } else {
          var rtcCount = 0;
          try { rtcCount = TG.countTagged(allObjects(ctx), rtcTag); } catch (e) { rtcCount = 0; }
          vars[rtcVar] = rtcCount;
        }
      }
      return;
    }

    // P5 core-engine track, item P5-1 (Variables v2, slice a): scoped
    // variables — global, scene, and object scope, each value typed.
    // Set Scoped Variable stores a value in exactly one scope (the
    // value kind follows the collections blocks: number is an
    // expression, text is raw text, true/false are booleans, variable
    // copies another flat variable); Read Scoped Variable copies one
    // back into a flat variable so expressions and labels can use it
    // (a missing variable reads as 0, like every other Read block);
    // Delete removes one; Clear empties a whole scope. A blank name
    // warns and holds; a bad number expression warns and holds; an
    // object scope with no object picked warns and holds; a missing
    // variable stays quiet on delete and read. With no variables
    // state at all the blocks stay quiet, like the growth blocks
    // without theirs. Unlike growth and scaling, the object scope
    // does NOT need a live object — the object NAME is the key, so a
    // row can set a variable for an enemy before it ever spawns.
    if (isType(ctx.varScopesModule, 'isScopedVariableAction', type)) {
      var VV = ctx.varScopesModule;
      // The scope options for a module call (the module normalizes
      // the scope itself; the scene id comes from the live run).
      var scopedOpts = function (data) {
        return { sceneId: ctx.sceneId, objectName: data.targetObject };
      };
      // A JSON-safe deep copy, so a copied list or dict never shares
      // its storage with the variable it came from.
      var deepCopyValue = function (v) {
        if (v == null || typeof v !== 'object') return v;
        try { var c = JSON.parse(JSON.stringify(v)); return (c === undefined) ? v : c; } catch (e) { return v; }
      };
      // Resolve a Set block's value the collections way: number is
      // an expression (a bad one fails the whole write), text is raw
      // text, true/false are booleans, variable copies a flat
      // variable (missing reads as 0).
      var resolveScopedValue = function (data) {
        var kind = String(data.valueKind || 'number');
        if (kind === 'text') return { ok: true, value: String(data.value == null ? '' : data.value) };
        if (kind === 'true') return { ok: true, value: true };
        if (kind === 'false') return { ok: true, value: false };
        if (kind === 'variable') {
          var srcName = String(data.value == null ? '' : data.value).trim();
          if (!srcName) {
            warn(ctx, 'Set Scoped Variable: the variable to copy from is blank. Name the variable to copy.');
            return { ok: true, value: 0 };
          }
          var src = vars[srcName];
          return { ok: true, value: deepCopyValue(src === undefined ? 0 : src) };
        }
        var info = exprInfo(ctx, data.value);
        return info && info.ok ? { ok: true, value: info.value } : { ok: false, value: 0 };
      };
      if (type === 'setScopedVariable') {
        var svName = String(data.varName || '').trim();
        if (!svName) {
          warn(ctx, 'Set Scoped Variable: the variable name is blank. Name the variable to store.');
        } else if (VV.normalizeScope(data.scope) === 'object' && !String(data.targetObject || '').trim()) {
          warn(ctx, 'Set Scoped Variable: the object scope needs an object. Pick the object whose variable this is.');
        } else if (ctx.varScopes) {
          var svVal = resolveScopedValue(data);
          if (!svVal.ok) {
            warn(ctx, 'Set Scoped Variable: the value is not a number. Nothing changed.');
          } else {
            try { VV.set(ctx.varScopes, data.scope, svName, svVal.value, scopedOpts(data)); } catch (e) { /* a throwing store is skipped */ }
          }
        }
      } else if (type === 'readScopedVariable') {
        var rvInto = String(data.storeVarName || '').trim();
        if (!rvInto) {
          warn(ctx, 'Read Scoped Variable: the variable name is blank. Name the variable that should receive the value.');
        } else {
          var rvVal = 0;
          try {
            var rvName = String(data.varName || '').trim();
            if (rvName && ctx.varScopes) rvVal = VV.read(ctx.varScopes, data.scope, rvName, 0, scopedOpts(data));
          } catch (e) { rvVal = 0; }
          vars[rvInto] = deepCopyValue(rvVal);
        }
      } else if (type === 'readTextIntoVariable') {
        // P5-9: read a text object's displayed text back into a flat
        // variable. The read is the _runtimeText override when the
        // object has one (what the player typed via Append Text), else
        // the authored text. Number mode parses with Number(): a blank
        // reads as 0 (the missing-value rule), text that is not a
        // number warns and holds so a bad keystroke never clobbers
        // the variable. A blank variable name, a blank object, or an
        // object that is not text warns and holds.
        var rtInto = String(data.storeVarName || '').trim();
        var rtName = String(data.targetObject || '').trim();
        if (!rtInto) {
          warn(ctx, 'Read Text Into Variable: the variable name is blank. Name the variable that should receive the text.');
        } else if (!rtName) {
          warn(ctx, 'Read Text Into Variable: no text object is named. Pick the text object to read.');
        } else {
          var rtObj = null;
          try { rtObj = named(ctx, rtName)[0] || null; } catch (e) { rtObj = null; }
          if (!rtObj || rtObj.kind !== 'text') {
            warn(ctx, 'Read Text Into Variable: no text object named "' + rtName + '".');
          } else {
            var rtText = String(rtObj._runtimeText !== undefined ? rtObj._runtimeText : (rtObj.text || ''));
            if (String(data.mode || 'text') === 'number') {
              var rtNum = Number(rtText.trim());
              if (!Number.isFinite(rtNum)) {
                warn(ctx, 'Read Text Into Variable: "' + rtText + '" is not a number. Nothing changed.');
              } else {
                vars[rtInto] = rtNum;
              }
            } else {
              vars[rtInto] = rtText;
            }
          }
        }
      } else if (type === 'deleteScopedVariable') {
        var dvName = String(data.varName || '').trim();
        if (!dvName) {
          warn(ctx, 'Delete Scoped Variable: the variable name is blank. Name the variable to delete.');
        } else if (ctx.varScopes) {
          try { VV.remove(ctx.varScopes, data.scope, dvName, scopedOpts(data)); } catch (e) { /* a throwing delete is skipped */ }
        }
      } else if (type === 'clearScopedVariables') {
        if (ctx.varScopes) {
          try { VV.clearScope(ctx.varScopes, data.scope, scopedOpts(data)); } catch (e) { /* a throwing clear is skipped */ }
        }
      }
      return;
    }

    // P5 core-engine track, item P5-5 (Object primitives, slice a):
    // object references as values. A variable can hold an object, not
    // just a number or text: the value is a handle ({ name, id }) the
    // variables module owns, and these blocks move handles in and
    // out. Pick Object Into Variable picks one live object (nearest /
    // farthest / random / first, the shared pick module's pickObject)
    // and stores its handle in a scoped variable — and points the
    // execution context at the picked object, so chained actions that
    // target the object's name hit that one object, the way a pick
    // condition's context narrows them (the context lives for the
    // rest of the frame's script phase, exactly like a pick
    // condition's). Read Object Property reads one property of the
    // object a scoped variable holds into an ordinary flat variable,
    // so expressions and labels can use it. Slice b adds the two
    // physics queries that return data (Raycast Into Variables, List
    // Overlapping Objects); slice c adds spawn and destroy as
    // instantiation (Spawn Object Into Variable hands the clone back
    // in a variable, Destroy Object In Variable destroys exactly the
    // object a variable holds). P5-6 slice b adds the two blocks
    // that move a handle through a nested path (Store Object In
    // Structure writes the handle a scoped variable holds into a
    // list or dictionary at a path, Read Object From Structure
    // reads the handle at a path back into a scoped variable).
    // A blank name warns and
    // holds; an object scope with no object picked warns and holds;
    // no live object to pick stays quiet and writes nothing; a
    // missing variable, a variable that holds no object, or a stale
    // handle (its object destroyed, or a clone left behind by a scene
    // switch) reads as the fallback — 0, or '' for Name — and stays
    // quiet, the way the other Read blocks read a missing value as 0.
    // 'alive' reads 1 while the held object is still live and 0 when
    // it is not, so it is the liveness test: pick, read alive into a
    // flag, and branch on the flag. With no variables state, no pick
    // module, or no pick hooks, the blocks stay quiet, like the
    // growth blocks without theirs. A host without the
    // setExecutionContext hook warns once and runs the pick anyway,
    // without the narrowing — the variable still holds the object.
    if (isType(ctx.varScopesModule, 'isObjectRefAction', type)) {
      var VO = ctx.varScopesModule;
      var objRefOpts = function (data) {
        return { sceneId: ctx.sceneId, objectName: data.targetObject };
      };
      // A finite number, or 0 for anything else — object fields are
      // host data, so a bad field reads as 0 instead of NaN.
      var finiteNum = function (v) {
        var n = Number(v);
        return Number.isFinite(n) ? n : 0;
      };
      // The live collision objects a physics query reads — the same
      // filter the Raycast Hit and Objects Overlapping conditions
      // use, so the query blocks and the conditions agree on what
      // counts as a collider.
      var collisionObjects = function (c) {
        var list = allObjects(c);
        var out = [];
        for (var i = 0; i < list.length; i++) {
          if (isCollision(c, list[i])) out.push(list[i]);
        }
        return out;
      };
      // The live object a scoped variable's handle points at, or null
      // when the variable is missing, holds no object, or is stale.
      // Slice b: when no scoped object is found, a flat variable of
      // the same name holding a handle is read instead — that is how
      // a For Each Item body reads the current item, because the
      // item variable is flat (the loop hands each list entry to the
      // body as a plain variable). A scoped object always wins over
      // a flat one of the same name.
      var resolveHeldObject = function (data) {
        var entry = null;
        try {
          if (ctx.varScopes) entry = VO.get(ctx.varScopes, data.scope, String(data.varName || '').trim(), objRefOpts(data));
        } catch (e) { entry = null; }
        if (entry && entry.type === 'object') {
          try {
            return VO.resolveObjectRef(entry.value, function (n) { return named(ctx, n); });
          } catch (e) { return null; }
        }
        var flatVal = null;
        try { flatVal = vars[String(data.varName || '').trim()]; } catch (e) { flatVal = null; }
        if (flatVal && VO.isObjectRef && VO.isObjectRef(flatVal)) {
          try {
            return VO.resolveObjectRef(flatVal, function (n) { return named(ctx, n); });
          } catch (e) { return null; }
        }
        return null;
      };
      if (type === 'pickObjectIntoVariable') {
        var pkName = String(data.objectName || '').trim();
        var pkVar = String(data.varName || '').trim();
        if (!pkName) {
          warn(ctx, 'Pick Object Into Variable: no object is named. Pick the object to choose from.');
        } else if (!pkVar) {
          warn(ctx, 'Pick Object Into Variable: the variable name is blank. Name the variable that should hold the object.');
        } else if (VO.normalizeScope(data.scope) === 'object' && !String(data.targetObject || '').trim()) {
          warn(ctx, 'Pick Object Into Variable: the object scope needs an object. Pick the object whose variable this is.');
        } else if (ctx.varScopes && ctx.pick && typeof ctx.pick.pickObject === 'function' && typeof ctx.pickHooks === 'function') {
          var pkHooks = null;
          try { pkHooks = ctx.pickHooks(); } catch (e) { pkHooks = null; }
          if (pkHooks) {
            var picked = null;
            try { picked = ctx.pick.pickObject(data, pkHooks); } catch (e) { picked = null; }
            if (picked) {
              var handle = null;
              try { handle = VO.objectRefOf(picked); } catch (e) { handle = null; }
              if (handle) {
                try {
                  VO.set(ctx.varScopes, data.scope, pkVar, handle,
                    { type: 'object', sceneId: ctx.sceneId, objectName: data.targetObject });
                } catch (e) { /* a throwing store is skipped */ }
              }
              var setPkCtx = (typeof ctx.setExecutionContext === 'function') ? ctx.setExecutionContext : null;
              if (setPkCtx) {
                try { setPkCtx({ obj1: picked, obj2: null }); } catch (e) { /* a throwing set is skipped */ }
              } else {
                warn(ctx, 'Pick Object Into Variable: this runtime cannot point later actions at the picked object, so they may hit a different one.');
              }
            }
          }
        }
      } else if (type === 'pickTaggedObjectIntoVariable') {
        // P4 Advanced batch 35 (pick objects by tag): the tag pick
        // without the condition wrapper — the same shape as Pick
        // Object Into Variable, but the candidates are the live
        // objects carrying a tag instead of the live objects with a
        // name. A blank tag or variable name warns and holds; no
        // live tagged object stays quiet and writes nothing.
        var ptTag = String(data.tag || '').trim();
        var ptVar = String(data.varName || '').trim();
        if (!ptTag) {
          warn(ctx, 'Pick Tagged Object Into Variable: no tag is named. Pick the tag to choose from.');
        } else if (!ptVar) {
          warn(ctx, 'Pick Tagged Object Into Variable: the variable name is blank. Name the variable that should hold the object.');
        } else if (VO.normalizeScope(data.scope) === 'object' && !String(data.targetObject || '').trim()) {
          warn(ctx, 'Pick Tagged Object Into Variable: the object scope needs an object. Pick the object whose variable this is.');
        } else if (ctx.varScopes && ctx.pick && typeof ctx.pick.pickTaggedObject === 'function' && typeof ctx.pickHooks === 'function') {
          var ptHooks = null;
          try { ptHooks = ctx.pickHooks(); } catch (e) { ptHooks = null; }
          if (ptHooks) {
            var ptPicked = null;
            try { ptPicked = ctx.pick.pickTaggedObject(data, ptHooks); } catch (e) { ptPicked = null; }
            if (ptPicked) {
              var ptHandle = null;
              try { ptHandle = VO.objectRefOf(ptPicked); } catch (e) { ptHandle = null; }
              if (ptHandle) {
                try {
                  VO.set(ctx.varScopes, data.scope, ptVar, ptHandle,
                    { type: 'object', sceneId: ctx.sceneId, objectName: data.targetObject });
                } catch (e) { /* a throwing store is skipped */ }
              }
              var setPtCtx = (typeof ctx.setExecutionContext === 'function') ? ctx.setExecutionContext : null;
              if (setPtCtx) {
                try { setPtCtx({ obj1: ptPicked, obj2: null }); } catch (e) { /* a throwing set is skipped */ }
              } else {
                warn(ctx, 'Pick Tagged Object Into Variable: this runtime cannot point later actions at the picked object, so they may hit a different one.');
              }
            }
          }
        }
      } else if (type === 'readObjectProperty') {
        var rpVar = String(data.varName || '').trim();
        var rpInto = String(data.storeVarName || '').trim();
        if (!rpVar) {
          warn(ctx, 'Read Object Property: the object variable is blank. Name the variable holding the object.');
        } else if (!rpInto) {
          warn(ctx, 'Read Object Property: the variable name is blank. Name the variable that should receive the property.');
        } else {
          var rpProp = String(data.property || 'x');
          var rpVal = (rpProp === 'name') ? '' : 0;
          var rpObj = resolveHeldObject(data);
          if (rpObj) {
            if (rpProp === 'alive') rpVal = 1;
            else if (rpProp === 'name') rpVal = String(rpObj.name || '');
            else if (rpProp === 'health' || rpProp === 'maxHealth') {
              var rpHM = ctx.healthModule;
              if (rpHM && typeof rpHM.healthOf === 'function') {
                try {
                  var rpH = rpHM.healthOf(rpObj);
                  rpVal = (rpProp === 'health') ? finiteNum(rpH.health) : finiteNum(rpH.maxHealth);
                } catch (e) { /* a throwing health read keeps the fallback */ }
              }
            } else {
              var rpFields = { x: 'posX', y: 'posY', width: 'width', height: 'height', rotation: 'rotation', velX: 'velX', velY: 'velY' };
              var rpField = rpFields[rpProp];
              rpVal = rpField ? finiteNum(rpObj[rpField]) : 0;
            }
          } else if (rpProp === 'alive') {
            rpVal = 0;
          }
          vars[rpInto] = rpVal;
        }
      } else if (type === 'raycastIntoVariables') {
        // P5-5 slice b (physics queries that return data): cast a
        // ray from the From point to the To point and store what it
        // hits — the closest live collision object, layer-mask
        // filtered, the same ray the Raycast Hit condition casts —
        // in a scoped object variable, and the distance to the hit
        // in an ordinary flat variable. The ray also points the
        // execution context at the hit object, like the pick, so
        // chained actions that target the object's name hit only it.
        // A miss is a result, not an error: the distance reads -1
        // and the object variable is cleared to the empty handle,
        // so a later Is alive read is 0 — the variable never holds
        // a stale hit from an earlier frame. A blank object variable
        // or an object scope with no object warns and holds; a blank
        // distance variable only skips the distance store. Bad
        // coordinates warn and hold; with no physics module the
        // block stays quiet, like the other physics blocks without
        // theirs. A host without the setExecutionContext hook warns
        // once and runs the ray anyway, without the narrowing.
        var rcVar = String(data.varName || '').trim();
        var rcDistVar = String(data.distanceVar || '').trim();
        if (!rcVar) {
          warn(ctx, 'Raycast Into Variables: the variable name is blank. Name the variable that should hold the hit object.');
        } else if (VO.normalizeScope(data.scope) === 'object' && !String(data.targetObject || '').trim()) {
          warn(ctx, 'Raycast Into Variables: the object scope needs an object. Pick the object whose variable this is.');
        } else if (!ctx.varScopes) {
          // No scoped-variable state: nothing to store the hit in.
        } else {
          var rcX1 = exprInfo(ctx, data.fromX), rcY1 = exprInfo(ctx, data.fromY);
          var rcX2 = exprInfo(ctx, data.toX), rcY2 = exprInfo(ctx, data.toY);
          if (!rcX1.ok || !rcY1.ok || !rcX2.ok || !rcY2.ok) {
            warn(ctx, 'Raycast Into Variables: the From or To point is not a number. Nothing changed.');
          } else {
            var rcP2d = ctx.physics2d || null;
            if (!rcP2d || typeof rcP2d.raycast !== 'function') {
              // No physics module: stay quiet and write nothing —
              // a miss is only reported when the ray was actually
              // cast, so no module never looks like a miss.
            } else {
              var rcMask = (data.layerMask == null) ? rcP2d.ALL_MASK : Math.floor(Number(data.layerMask));
              var rcHit = null;
              try { rcHit = rcP2d.raycast(collisionObjects(ctx), rcX1.value, rcY1.value, rcX2.value, rcY2.value, rcMask); } catch (e) { rcHit = null; }
              if (rcHit && rcHit.object) {
                var rcHandle = null;
                try { rcHandle = VO.objectRefOf(rcHit.object); } catch (e) { rcHandle = null; }
                if (rcHandle) {
                  try {
                    VO.set(ctx.varScopes, data.scope, rcVar, rcHandle,
                      { type: 'object', sceneId: ctx.sceneId, objectName: data.targetObject });
                  } catch (e) { /* a throwing store is skipped */ }
                }
                if (rcDistVar) {
                  try { vars[rcDistVar] = finiteNum(rcHit.distance); } catch (e) { /* a throwing store is skipped */ }
                }
                var setRcCtx = (typeof ctx.setExecutionContext === 'function') ? ctx.setExecutionContext : null;
                if (setRcCtx) {
                  try { setRcCtx({ obj1: rcHit.object, obj2: null }); } catch (e) { /* a throwing set is skipped */ }
                } else {
                  warn(ctx, 'Raycast Into Variables: this runtime cannot point later actions at the hit object, so they may hit a different one.');
                }
              } else {
                if (rcDistVar) {
                  try { vars[rcDistVar] = -1; } catch (e) { /* a throwing store is skipped */ }
                }
                try {
                  VO.set(ctx.varScopes, data.scope, rcVar, VO.emptyObjectRef(),
                    { type: 'object', sceneId: ctx.sceneId, objectName: data.targetObject });
                } catch (e) { /* a throwing store is skipped */ }
              }
            }
          }
        }
      } else if (type === 'listOverlappingObjects') {
        // P5-5 slice b (physics queries that return data): list every
        // live collision object overlapping the circle at (x, y) with
        // the given radius, layer-mask filtered, the same query the
        // Objects Overlapping condition runs — and store the list in
        // a flat list variable, so For Each Item can walk through it
        // one object at a time. Each entry is an object handle, the
        // same value Pick Object Into Variable stores, so a For Each
        // Item body reads the current object's properties with Read
        // Object Property (through its flat-variable fallback) and
        // its actions hit that one object (through the loop's context
        // narrowing). The list is replaced fresh on every run, never
        // appended to, so re-running the query refreshes it; an empty
        // overlap stores an empty list and a count of 0 and stays
        // quiet. A blank list variable warns and holds; a blank count
        // variable only skips the count store. Bad coordinates or a
        // bad radius warn and hold; a negative radius reads as 0;
        // with no physics module the block stays quiet.
        var ovListVar = String(data.listVar || '').trim();
        var ovCountVar = String(data.countVar || '').trim();
        if (!ovListVar) {
          warn(ctx, 'List Overlapping Objects: the list variable is blank. Name the list that should hold the objects.');
        } else {
          var ovX = exprInfo(ctx, data.x), ovY = exprInfo(ctx, data.y), ovR = exprInfo(ctx, data.radius);
          if (!ovX.ok || !ovY.ok || !ovR.ok) {
            warn(ctx, 'List Overlapping Objects: the position or radius is not a number. Nothing changed.');
          } else {
            var ovP2d = ctx.physics2d || null;
            if (!ovP2d || typeof ovP2d.overlapCircle !== 'function') {
              // No physics module: stay quiet and write nothing — an
              // empty list is only stored when the query actually ran.
            } else {
              var ovMask = (data.layerMask == null) ? ovP2d.ALL_MASK : Math.floor(Number(data.layerMask));
              var ovHits = [];
              try { ovHits = ovP2d.overlapCircle(collisionObjects(ctx), ovX.value, ovY.value, Math.max(0, ovR.value), ovMask) || []; } catch (e) { ovHits = []; }
              var ovHandles = [];
              for (var ovI = 0; ovI < ovHits.length; ovI++) {
                var ovHandle = null;
                try { ovHandle = VO.objectRefOf(ovHits[ovI]); } catch (e) { ovHandle = null; }
                if (ovHandle) ovHandles.push(ovHandle);
              }
              try { vars[ovListVar] = ovHandles; } catch (e) { /* a throwing store is skipped */ }
              if (ovCountVar) {
                try { vars[ovCountVar] = ovHandles.length; } catch (e) { /* a throwing store is skipped */ }
              }
            }
          }
        }
      } else if (type === 'spawnObjectIntoVariable') {
        // P5-5 slice c (spawn/destroy as instantiation): clone the
        // named object and hand the clone back in a scoped object
        // variable, the same handle Pick Object Into Variable
        // stores — so the game can keep track of one spawned enemy,
        // one bullet, one coin and use it later. The spawn also
        // points the execution context at the clone, like the pick,
        // so chained actions that target the source name hit only
        // the clone. A missing source is a miss, not an error: the
        // variable is cleared to the empty handle, like a raycast
        // miss, so a later Is alive read is 0. A blank source, a
        // blank variable, or an object scope with no object warns
        // and holds; with no scoped-variable state the block stays
        // quiet, like the other object-reference blocks without
        // theirs. Coordinates follow Spawn Object: a blank
        // coordinate spawns at the source's own position.
        var spSrc = String(data.sourceObject || '').trim();
        var spVar = String(data.varName || '').trim();
        if (!spSrc) {
          warn(ctx, 'Spawn Object Into Variable: no object is named. Pick the object to clone.');
        } else if (!spVar) {
          warn(ctx, 'Spawn Object Into Variable: the variable name is blank. Name the variable that should hold the clone.');
        } else if (VO.normalizeScope(data.scope) === 'object' && !String(data.targetObject || '').trim()) {
          warn(ctx, 'Spawn Object Into Variable: the object scope needs an object. Pick the object whose variable this is.');
        } else if (!ctx.varScopes) {
          // No scoped-variable state: nothing to store the clone in.
        } else {
          var spClone = null;
          try { spClone = spawnClone(ctx, spSrc, data.spawnX, data.spawnY); } catch (e) { spClone = null; }
          if (spClone) {
            var spHandle = null;
            try { spHandle = VO.objectRefOf(spClone); } catch (e) { spHandle = null; }
            if (spHandle) {
              try {
                VO.set(ctx.varScopes, data.scope, spVar, spHandle,
                  { type: 'object', sceneId: ctx.sceneId, objectName: data.targetObject });
              } catch (e) { /* a throwing store is skipped */ }
            }
            var setSpCtx = (typeof ctx.setExecutionContext === 'function') ? ctx.setExecutionContext : null;
            if (setSpCtx) {
              try { setSpCtx({ obj1: spClone, obj2: null }); } catch (e) { /* a throwing set is skipped */ }
            } else {
              warn(ctx, 'Spawn Object Into Variable: this runtime cannot point later actions at the spawned object, so they may hit a different one.');
            }
          } else {
            try {
              VO.set(ctx.varScopes, data.scope, spVar, VO.emptyObjectRef(),
                { type: 'object', sceneId: ctx.sceneId, objectName: data.targetObject });
            } catch (e) { /* a throwing store is skipped */ }
          }
        }
      } else if (type === 'destroyObjectInVariable') {
        // P5-5 slice c (spawn/destroy as instantiation): destroy
        // exactly the object a variable holds — the clone a spawn
        // handed back, or the goblin a pick chose — not every object
        // with the name. A missing variable, a variable that holds
        // no object, or a stale object stays quiet, like a Read
        // that finds nothing: the object is already gone, so there
        // is nothing to destroy. A blank variable name or an object
        // scope with no object warns and holds.
        var dvVar = String(data.varName || '').trim();
        if (!dvVar) {
          warn(ctx, 'Destroy Object In Variable: the variable name is blank. Name the variable holding the object.');
        } else if (VO.normalizeScope(data.scope) === 'object' && !String(data.targetObject || '').trim()) {
          warn(ctx, 'Destroy Object In Variable: the object scope needs an object. Pick the object whose variable this is.');
        } else {
          var dvObj = resolveHeldObject(data);
          if (dvObj && dvObj.id != null && ctx.pendingDestroy) {
            try { ctx.pendingDestroy.add(dvObj.id); } catch (e) { /* a throwing destroy is skipped */ }
          }
        }
      } else if (type === 'nestedStoreObject') {
        // P5-6 slice b (object references inside structures): store
        // the handle a scoped variable holds at a path inside a
        // flat list or dictionary — the party list of live goblins,
        // the squad dictionary of named allies. The containers are
        // built on the way down like Set Nested Value (a list step
        // grows the list with 0s up to the 10,000 cap, a field step
        // creates the dictionary, a plain root is replaced), and the
        // stored handle is a copy, so later edits to the variable
        // never change the stored one. A variable that holds no
        // object stores the empty handle, like a spawn of a missing
        // source, so a later Is alive read is 0. A blank variable
        // name, a blank path, a blank object variable, or an object
        // scope with no object warns and holds; an index past the
        // cap warns and changes nothing; with no scoped-variable
        // state or no collections module the block stays quiet.
        var soVar = String(data.varName || '').trim();
        var soObjVar = String(data.objectVar || '').trim();
        var soPaths = ctx.collections || null;
        if (!soVar) {
          warn(ctx, 'Store Object In Structure: the variable name is blank. Name the list or structure that should hold the object.');
        } else if (!soObjVar) {
          warn(ctx, 'Store Object In Structure: the object variable is blank. Name the variable holding the object.');
        } else if (VO.normalizeScope(data.scope) === 'object' && !String(data.targetObject || '').trim()) {
          warn(ctx, 'Store Object In Structure: the object scope needs an object. Pick the object whose variable this is.');
        } else if (!ctx.varScopes) {
          // No scoped-variable state: nothing to store from.
        } else if (!soPaths || typeof soPaths.parsePath !== 'function' ||
            typeof soPaths.setPathValue !== 'function' || typeof soPaths.isStructure !== 'function') {
          // No collections module: no path to write through.
        } else if (!soPaths.parsePath(data.path).ok) {
          warn(ctx, 'Store Object In Structure: the path is blank or not a path. Nothing changed.');
        } else {
          var soParsed = soPaths.parsePath(data.path);
          var soEntry = null;
          try { soEntry = VO.get(ctx.varScopes, data.scope, soObjVar, objRefOpts(data)); } catch (e) { soEntry = null; }
          var soHandle = (soEntry && soEntry.type === 'object') ? soEntry.value : VO.emptyObjectRef();
          var soRoot = vars[soVar];
          if (!Array.isArray(soRoot) && !soPaths.isStructure(soRoot)) {
            soRoot = (soParsed.steps[0].index !== undefined) ? [] : {};
            vars[soVar] = soRoot;
          }
          var soWrote = false;
          try { soWrote = soPaths.setPathValue(soRoot, soParsed.steps, soHandle).ok; } catch (e) { soWrote = false; }
          if (!soWrote) {
            warn(ctx, 'Store Object In Structure: the index is out of range. Nothing changed.');
          }
        }
      } else if (type === 'nestedReadObject') {
        // P5-6 slice b (object references inside structures): read
        // the handle at a path inside a flat list or dictionary
        // back into a scoped object variable — the other half of
        // Store Object In Structure, so a party list of live
        // goblins can be walked one member at a time and each
        // member's properties read with Read Object Property. The
        // read also points the execution context at the live
        // object, like the pick, so chained actions that target
        // the object's name hit that one object. A missing step or
        // a value that is not an object clears the variable to the
        // empty handle, like a missing step reads as 0, so a later
        // Is alive read is 0 — the variable never holds a stale
        // member from an earlier frame. A blank variable name, a
        // blank path, a blank object variable, or an object scope
        // with no object warns and holds; with no scoped-variable
        // state or no collections module the block stays quiet.
        var roVar = String(data.varName || '').trim();
        var roObjVar = String(data.objectVar || '').trim();
        var roPaths = ctx.collections || null;
        if (!roVar) {
          warn(ctx, 'Read Object From Structure: the variable name is blank. Name the list or structure holding the object.');
        } else if (!roObjVar) {
          warn(ctx, 'Read Object From Structure: the object variable is blank. Name the variable that should hold the object.');
        } else if (VO.normalizeScope(data.scope) === 'object' && !String(data.targetObject || '').trim()) {
          warn(ctx, 'Read Object From Structure: the object scope needs an object. Pick the object whose variable this is.');
        } else if (!ctx.varScopes) {
          // No scoped-variable state: nothing to store the object in.
        } else if (!roPaths || typeof roPaths.parsePath !== 'function' ||
            typeof roPaths.getPathValue !== 'function') {
          // No collections module: no path to read through.
        } else if (!roPaths.parsePath(data.path).ok) {
          warn(ctx, 'Read Object From Structure: the path is blank or not a path. Nothing stored.');
        } else {
          var roParsed = roPaths.parsePath(data.path);
          var roFound = null;
          try { roFound = roPaths.getPathValue(vars[roVar], roParsed.steps); } catch (e) { roFound = null; }
          var roHandle = (roFound && roFound.ok && VO.isObjectRef && VO.isObjectRef(roFound.value))
            ? roFound.value : VO.emptyObjectRef();
          try {
            VO.set(ctx.varScopes, data.scope, roObjVar, roHandle,
              { type: 'object', sceneId: ctx.sceneId, objectName: data.targetObject });
          } catch (e) { /* a throwing store is skipped */ }
          var roObj = null;
          if (roFound && roFound.ok && VO.isObjectRef && VO.isObjectRef(roFound.value)) {
            try { roObj = VO.resolveObjectRef(roFound.value, function (n) { return named(ctx, n); }); } catch (e) { roObj = null; }
          }
          if (roObj) {
            var setRoCtx = (typeof ctx.setExecutionContext === 'function') ? ctx.setExecutionContext : null;
            if (setRoCtx) {
              try { setRoCtx({ obj1: roObj, obj2: null }); } catch (e) { /* a throwing set is skipped */ }
            } else {
              warn(ctx, 'Read Object From Structure: this runtime cannot point later actions at the object, so they may hit a different one.');
            }
          }
        }
      }
      return;
    }

    // P5 core-engine track, item P5-3 (Functions / custom blocks,
    // slice a): Call Function runs a named function once — its body
    // grid, through the host's callFunction hook, which pushes a call
    // frame, binds the parameters as local variables, runs the body,
    // and hands back the return value. Return From Function sets the
    // innermost call's return value and stops the rest of the body.
    // A blank function name warns and holds; a missing function warns
    // and holds; a call that hits the recursion cap warns and holds
    // with 0 stored. Arguments fill the parameters in order — a blank
    // argument ends the list, so later slots are not passed — and a
    // bad argument expression warns and holds. A Return outside a
    // function warns and does nothing. With no host hook the blocks
    // stay quiet, like the growth blocks without theirs. Arguments
    // are expressions, so parameters arrive as numbers in this slice
    // (a text local is set inside the body with Set Scoped Variable).
    if (isType(ctx.functionsModule, 'isFunctionAction', type)) {
      var fnCopyValue = function (v) {
        if (v == null || typeof v !== 'object') return v;
        try { var c = JSON.parse(JSON.stringify(v)); return (c === undefined) ? v : c; } catch (e) { return v; }
      };
      if (type === 'callFunction') {
        var fnName = String(data.functionName || '').trim();
        if (!fnName) {
          warn(ctx, 'Call Function: the function name is blank. Pick the function to call.');
        } else if (typeof ctx.callFunction !== 'function') {
          // No host hook (a bare execute harness): nothing to call.
        } else {
          var fnArgs = [];
          var fnArgsOk = true;
          var fnArgKeys = ['arg1', 'arg2', 'arg3', 'arg4', 'arg5', 'arg6', 'arg7', 'arg8'];
          for (var ai = 0; ai < fnArgKeys.length; ai++) {
            var rawArg = data[fnArgKeys[ai]];
            if (rawArg == null || String(rawArg).trim() === '') break;
            var argInfo = exprInfo(ctx, rawArg);
            if (!argInfo.ok) {
              warn(ctx, 'Call Function: argument ' + (ai + 1) + ' is not a number. Nothing changed.');
              fnArgsOk = false;
              break;
            }
            fnArgs.push(argInfo.value);
          }
          if (fnArgsOk) {
            var fnResult = null;
            try { fnResult = ctx.callFunction(fnName, fnArgs); } catch (e) { fnResult = null; }
            if (fnResult && fnResult.ok === false) {
              if (fnResult.reason === 'missing') {
                warn(ctx, 'Call Function: there is no function named "' + fnName + '". Create it in the Functions manager first.');
              } else if (fnResult.reason === 'depth') {
                warn(ctx, 'Call Function: "' + fnName + '" calls itself too deeply (32 calls). The call was skipped.');
              }
            } else if (fnResult && fnResult.ok) {
              var fnInto = String(data.storeVarName || '').trim();
              if (fnInto) {
                var fnVal = fnResult.value;
                vars[fnInto] = fnCopyValue(fnVal === undefined ? 0 : fnVal);
              }
            }
          }
        }
      } else if (type === 'returnFromFunction') {
        var retVal = 0;
        var retOk = true;
        if (data.value != null && String(data.value).trim() !== '') {
          var retInfo = exprInfo(ctx, data.value);
          if (!retInfo.ok) {
            warn(ctx, 'Return From Function: the value is not a number. Nothing changed.');
            retOk = false;
          } else {
            retVal = retInfo.value;
          }
        }
        if (retOk) {
          if (typeof ctx.returnFromFunction !== 'function') {
            // No host hook: nothing to return from.
          } else {
            var retDone = false;
            try { retDone = ctx.returnFromFunction(retVal); } catch (e) { retDone = false; }
            if (!retDone) warn(ctx, 'Return From Function: this block only works inside a function body.');
          }
        }
      }
      return;
    }

    // P5 core-engine track, item P5-4 (Control flow + events,
    // slices a–b): loops. Repeat, While, For Each Item, and For Each
    // Object run their body chain themselves — the dispatch routes
    // them through executeLoopAction (below), never through this
    // plain path — so reaching one here means the host did not wire
    // the loop runner, and the block stays quiet while its body runs
    // once like any other chain (the no-hook degradation, like Call
    // Function without its hook).
    // Break and Continue are plain actions: inside a loop body they
    // set the control flag the innermost loop's handler reads after
    // the body run; outside a loop they warn and do nothing.
    if (isType(ctx.loopsModule, 'isLoopAction', type)) {
      if (type === 'breakLoop' || type === 'continueLoop') {
        var loopState = ctx.loopState || null;
        var loopDone = false;
        try {
          if (type === 'breakLoop') loopDone = ctx.loopsModule.requestBreak(loopState);
          else loopDone = ctx.loopsModule.requestContinue(loopState);
        } catch (e) { loopDone = false; }
        if (!loopDone) {
          warn(ctx, (type === 'breakLoop' ? 'Break' : 'Continue') +
            ': this block only works inside a loop.');
        }
      }
      return;
    }

    // P5 core-engine track, item P5-4 (Control flow + events,
    // slice c): custom events. Broadcast Event sends the named
    // event to every On Event listener with the same name — the
    // module bumps the run's count for the name, and each listener
    // fires once when it next polls. A blank name warns and holds;
    // with no event state at all the block stays quiet, like the
    // growth blocks without theirs.
    if (isType(ctx.eventsModule, 'isEventAction', type)) {
      if (type === 'broadcastEvent') {
        var evName = '';
        try { evName = ctx.eventsModule.normalizeEventName(data.eventName); } catch (e) { evName = ''; }
        if (!evName) {
          warn(ctx, 'Broadcast Event: the event name is blank. Name the event to send.');
        } else if (ctx.eventState) {
          try { ctx.eventsModule.broadcast(ctx.eventState, evName); } catch (e) { /* a throwing broadcast is skipped */ }
        }
      }
      return;
    }

    // P4 Advanced batch 22 (damage feedback): floating numbers,
    // invincibility frames, and knockback. Show Damage Number pops a
    // floating number above the object (place it right after Damage
    // Object with the same amount — the number is a display, it never
    // changes the health); Make Invincible writes a shield on the
    // frozen game clock (0 seconds clears it); Knockback Object pushes
    // the target away from a source object, or from the X/Y point when
    // the source is blank, by adding direction * force to its velocity
    // (so it moves any non-text, non-static object the way Apply Force does). A bad
    // amount / seconds / force / position warns and holds (the
    // camera-feel rule); a missing object stays quiet, like the health
    // blocks.
    if (isType(ctx.damageFxModule, 'isDamageFxAction', type)) {
      var DM = ctx.damageFxModule;
      if (type === 'showDamageNumber') {
        var numInfo = exprInfo(ctx, data.amount);
        if (!numInfo.ok) {
          warn(ctx, 'Show Damage Number: the amount is not a number. Nothing changed.');
        } else {
          var numState = null;
          try { numState = (typeof ctx.ensureDamageNumbers === 'function') ? ctx.ensureDamageNumbers() : ctx.damageNumbers; } catch (e) { numState = null; }
          targets(ctx, data).forEach(function (o) {
            try {
              if (numState) DM.spawnDamageNumber(numState, {
                x: (o.posX || 0) + (o.width || 0) / 2,
                y: (o.posY || 0),
                text: String(numInfo.value),
                color: data.color
              });
            } catch (e) { /* a throwing number is skipped */ }
          });
        }
      } else if (type === 'makeInvincible') {
        var invInfo = exprInfo(ctx, data.seconds);
        if (!invInfo.ok) {
          warn(ctx, 'Make Invincible: the seconds are not a number. Nothing changed.');
        } else {
          var nowShield = 0;
          try { nowShield = Number(ctx.frozenNowMs()); } catch (e) { nowShield = 0; }
          targets(ctx, data).forEach(function (o) {
            try { DM.makeInvincible(o, invInfo.value, nowShield); } catch (e) { /* a throwing shield is skipped */ }
          });
        }
      } else if (type === 'knockbackObject') {
        var forceInfo = exprInfo(ctx, data.force);
        if (!forceInfo.ok) {
          warn(ctx, 'Knockback Object: the force is not a number. Nothing changed.');
        } else {
          // The source: a named object first, else the X/Y point. A
          // named source that does not exist stays quiet; a bad X/Y
          // warns and holds.
          var srcObj = (data.fromObject ? named(ctx, data.fromObject)[0] : null) || null;
          var srcX = 0, srcY = 0, srcOk = false;
          if (srcObj) {
            srcX = (srcObj.posX || 0) + (srcObj.width || 0) / 2;
            srcY = (srcObj.posY || 0) + (srcObj.height || 0) / 2;
            srcOk = true;
          } else if (data.fromObject) {
            srcOk = false;
          } else {
            var kx = exprInfo(ctx, data.x);
            var ky = exprInfo(ctx, data.y);
            if (!kx.ok || !ky.ok) {
              warn(ctx, 'Knockback Object: the X/Y point is not a number. Nothing changed.');
            } else {
              srcX = kx.value; srcY = ky.value; srcOk = true;
            }
          }
          if (srcOk) {
            var force = DM.normalizeKnockbackForce(forceInfo.value);
            targets(ctx, data).forEach(function (o) {
              try {
                var dir = DM.knockbackDirection(srcX, srcY,
                  (o.posX || 0) + (o.width || 0) / 2,
                  (o.posY || 0) + (o.height || 0) / 2);
                applyVelocity(ctx, o, dir.x * force, dir.y * force, 'add');
              } catch (e) { /* a throwing push is skipped */ }
            });
          }
        }
      }
      return;
    }

    // P4 Advanced batch 23 (checkpoints & respawn): coming back after
    // a death. Set Checkpoint records one point for the scene — the
    // top-left corner of the named checkpoint object, or the X/Y point
    // when the object is blank (a named object that does not exist
    // stays quiet; a bad X/Y warns and holds). Respawn Object sends
    // the object back to the checkpoint, or to where it started the
    // scene when no checkpoint is set yet; the teleport zeroes the
    // velocity (a dead body should not keep sliding), stops a walking
    // path (it was planned from the old spot), and refills the health
    // to full when Restore health is ticked (the default). Clear
    // Checkpoint forgets the point, so the next respawn goes home.
    // With no respawn state at all the blocks stay quiet, like the
    // health blocks without their module.
    if (isType(ctx.respawnModule, 'isRespawnAction', type)) {
      var RM = ctx.respawnModule;
      if (type === 'setCheckpoint') {
        var cpObj = (data.checkpointObject ? named(ctx, data.checkpointObject)[0] : null) || null;
        var cpX = 0, cpY = 0, cpOk = false;
        if (cpObj) {
          cpX = cpObj.posX || 0;
          cpY = cpObj.posY || 0;
          cpOk = true;
        } else if (data.checkpointObject) {
          cpOk = false;
        } else {
          var cx = exprInfo(ctx, data.x);
          var cy = exprInfo(ctx, data.y);
          if (!cx.ok || !cy.ok) {
            warn(ctx, 'Set Checkpoint: the X/Y point is not a number. Nothing changed.');
          } else {
            cpX = cx.value; cpY = cy.value; cpOk = true;
          }
        }
        if (cpOk) {
          var cpState = null;
          try { cpState = (typeof ctx.ensureRespawnState === 'function') ? ctx.ensureRespawnState() : ctx.respawn; } catch (e) { cpState = null; }
          try { if (cpState) RM.setCheckpoint(cpState, cpX, cpY, cpObj ? cpObj.name : ''); } catch (e) { /* a throwing record is skipped */ }
        }
      } else if (type === 'respawnObject') {
        targets(ctx, data).forEach(function (o) {
          try {
            var rsState = null;
            try { rsState = (typeof ctx.ensureRespawnState === 'function') ? ctx.ensureRespawnState() : ctx.respawn; } catch (e) { rsState = null; }
            var pos = rsState ? RM.respawnPosition(rsState, o.name) : null;
            if (!pos) return;
            o.posX = pos.x;
            o.posY = pos.y;
            o.velX = 0;
            o.velY = 0;
            if (typeof o.vel3x === 'number') o.vel3x = 0;
            if (typeof o.vel3y === 'number') o.vel3y = 0;
            if (typeof o.vel3z === 'number') o.vel3z = 0;
            try {
              if (ctx.pathfindModule && typeof ctx.pathfindModule.stopPath === 'function') ctx.pathfindModule.stopPath(o);
            } catch (e) { /* a throwing stop is skipped */ }
            if (data.restoreHealth !== false && ctx.healthModule &&
                typeof ctx.healthModule.setHealth === 'function' &&
                typeof ctx.healthModule.healthOf === 'function') {
              try {
                var full = ctx.healthModule.healthOf(o).maxHealth;
                ctx.healthModule.setHealth(o, full);
              } catch (e) { /* a throwing refill is skipped */ }
            }
            RM.noteRespawn(rsState);
          } catch (e) { /* a throwing respawn is skipped */ }
        });
      } else if (type === 'clearCheckpoint') {
        var clrState = null;
        try { clrState = (typeof ctx.ensureRespawnState === 'function') ? ctx.ensureRespawnState() : ctx.respawn; } catch (e) { clrState = null; }
        try { if (clrState) RM.clearCheckpoint(clrState); } catch (e) { /* a throwing clear is skipped */ }
      }
      return;
    }

    // P4 Advanced batch 24 (enemy spawner): enemies that keep coming
    // on their own. Start Spawner names one — the template to clone,
    // the spot (the top-left corner of the named anchor object, or
    // the X/Y point when no object is named), the interval, the
    // max-alive cap, and the total. A blank name or a blank template
    // stays quiet (there is nothing to address or nothing to clone,
    // like a missing mover for Set AI Behavior); a bad interval /
    // max-alive / total / X/Y warns and holds. Stop Spawner stops one
    // by name, or all of them when the name is blank (like Stop
    // Emitter). Read Spawned Count copies the spawned total into a
    // variable — a spawner that never started reads 0, like a timer
    // that never started; a blank variable name warns and holds.
    // With no spawner state at all the blocks stay quiet, like the
    // respawn blocks without their module.
    if (isType(ctx.spawnModule, 'isSpawnAction', type)) {
      var SM = ctx.spawnModule;
      if (type === 'startSpawner') {
        var spName = String(data.name || '').trim();
        var spTemplate = String(data.templateObject || '').trim();
        if (spName && spTemplate) {
          var spState = null;
          try { spState = (typeof ctx.ensureSpawnerState === 'function') ? ctx.ensureSpawnerState() : ctx.spawners; } catch (e) { spState = null; }
          if (spState) {
            var iv = exprInfo(ctx, data.interval);
            var mv = exprInfo(ctx, data.maxAlive);
            var tv = exprInfo(ctx, data.total);
            var xv = { ok: true, value: 0 };
            var yv = { ok: true, value: 0 };
            if (!data.atObject) {
              xv = exprInfo(ctx, data.x);
              yv = exprInfo(ctx, data.y);
            }
            if (!iv.ok) {
              warn(ctx, 'Start Spawner: the interval is not a number. Nothing changed.');
            } else if (!mv.ok) {
              warn(ctx, 'Start Spawner: the max alive count is not a number. Nothing changed.');
            } else if (!tv.ok) {
              warn(ctx, 'Start Spawner: the total is not a number. Nothing changed.');
            } else if (!xv.ok || !yv.ok) {
              warn(ctx, 'Start Spawner: the X/Y point is not a number. Nothing changed.');
            } else {
              try {
                SM.startSpawner(spState, {
                  name: spName, template: spTemplate, atObject: data.atObject,
                  x: xv.value, y: yv.value,
                  interval: iv.value, maxAlive: mv.value, total: tv.value
                });
              } catch (e) { /* a throwing start is skipped */ }
            }
          }
        }
      } else if (type === 'stopSpawner') {
        var stpState = null;
        try { stpState = (typeof ctx.ensureSpawnerState === 'function') ? ctx.ensureSpawnerState() : ctx.spawners; } catch (e) { stpState = null; }
        if (stpState) {
          try {
            if (String(data.name || '').trim()) SM.stopSpawner(stpState, data.name);
            else SM.stopAllSpawners(stpState);
          } catch (e) { /* a throwing stop is skipped */ }
        }
      } else if (type === 'readSpawnedCount') {
        var rscVar = String(data.varName || '').trim();
        if (!rscVar) {
          warn(ctx, 'Read Spawned Count: the variable name is blank. Name the variable that should receive the count.');
        } else {
          var rscState = null;
          try { rscState = (typeof ctx.ensureSpawnerState === 'function') ? ctx.ensureSpawnerState() : ctx.spawners; } catch (e) { rscState = null; }
          var rscCount = 0;
          try { if (rscState) rscCount = SM.spawnedCount(rscState, data.name); } catch (e) { rscCount = 0; }
          vars[rscVar] = rscCount;
        }
      }
      return;
    }

    // P4 Advanced batch 25 (lives & game over): how many chances the
    // player gets. Set Lives writes the count outright (3 by default,
    // 0 starts the game already over), Add Lives tops it up (capped
    // at 99), Lose Life spends it (clamped at 0, so losing a life at
    // 0 stays at 0), Read Lives copies it into a variable — a game
    // that never touched lives reads the default 3, like a timer that
    // never started reads 0. A bad lives value or amount warns and
    // holds, a blank variable name warns and holds. With no lives
    // state at all the blocks stay quiet, like the spawner blocks
    // without their module.
    if (isType(ctx.livesModule, 'isLivesAction', type)) {
      var LM = ctx.livesModule;
      if (type === 'setLives') {
        var slv = exprInfo(ctx, data.lives);
        if (!slv.ok) {
          warn(ctx, 'Set Lives: the lives value is not a number. Nothing changed.');
        } else if (ctx.lives) {
          try { LM.setLives(ctx.lives, slv.value); } catch (e) { /* a throwing set is skipped */ }
        }
      } else if (type === 'addLives') {
        var alv = exprInfo(ctx, data.amount);
        if (!alv.ok) {
          warn(ctx, 'Add Lives: the amount is not a number. Nothing changed.');
        } else if (ctx.lives) {
          try { LM.addLives(ctx.lives, alv.value); } catch (e) { /* a throwing add is skipped */ }
        }
      } else if (type === 'loseLife') {
        var llv = exprInfo(ctx, data.amount);
        if (!llv.ok) {
          warn(ctx, 'Lose Life: the amount is not a number. Nothing changed.');
        } else if (ctx.lives) {
          try { LM.loseLives(ctx.lives, llv.value); } catch (e) { /* a throwing lose is skipped */ }
        }
      } else if (type === 'readLives') {
        var rlVar = String(data.varName || '').trim();
        if (!rlVar) {
          warn(ctx, 'Read Lives: the variable name is blank. Name the variable that should receive the lives.');
        } else {
          var rlCount = 3;
          try { rlCount = LM.livesOf(ctx.lives); } catch (e) { rlCount = 3; }
          vars[rlVar] = rlCount;
        }
      }
      return;
    }

    // P4 Advanced batch 26 (movement abilities): double jump, coyote
    // time, jump buffer & dash. Jump spends one jump (ground, coyote,
    // wall, or air up to Max jumps) and remembers a press with no
    // jump left for the buffer window; Dash starts a fixed burst in
    // one direction (ignored while already dashing or cooling down);
    // the Set blocks rewrite the object's authored jump config at
    // runtime. A bad number warns and holds, a missing object stays
    // quiet. With no movement state at all the Jump / Dash blocks
    // stay quiet, like the spawner blocks without their module; the
    // Set blocks need no state, so they still write.
    // P4 Advanced batch 28 (wall slide & wall jump): Set Wall Slide
    // caps the fall while the object presses toward a wall; Set Wall
    // Jump sets the push-off speeds the Jump block spends while the
    // object touches a wall.
    if (isType(ctx.movementModule, 'isMovementAction', type)) {
      var MV = ctx.movementModule;
      var mvState = null;
      try { mvState = (typeof ctx.ensureMovementState === 'function') ? ctx.ensureMovementState() : ctx.movement; } catch (e) { mvState = null; }
      var mvNow = 0;
      try { mvNow = Number(ctx.frozenNowMs()) / 1000; } catch (e) { mvNow = 0; }
      if (type === 'jump') {
        var jsv = exprInfo(ctx, data.jumpSpeed);
        if (!jsv.ok) {
          warn(ctx, 'Jump: the jump speed is not a number. Nothing changed.');
        } else if (mvState) {
          var jHooks = movementHooks(ctx);
          targets(ctx, data).forEach(function (o) {
            try { MV.tryJump(mvState, o, jsv.value, mvNow, jHooks); } catch (e) { /* a throwing jump is skipped */ }
          });
        }
      } else if (type === 'dash') {
        var dsv = exprInfo(ctx, data.speed);
        var ddv = exprInfo(ctx, data.duration);
        var dcv = exprInfo(ctx, data.cooldown);
        if (!dsv.ok) {
          warn(ctx, 'Dash: the speed is not a number. Nothing changed.');
        } else if (!ddv.ok) {
          warn(ctx, 'Dash: the duration is not a number. Nothing changed.');
        } else if (!dcv.ok) {
          warn(ctx, 'Dash: the cooldown is not a number. Nothing changed.');
        } else if (mvState) {
          var dir = dashDirection(data.direction);
          targets(ctx, data).forEach(function (o) {
            try { MV.startDash(mvState, o, dir.x, dir.y, dsv.value + growthBonusOf(ctx, 'speed', o), ddv.value, dcv.value, mvNow); } catch (e) { /* a throwing dash is skipped */ }
          });
        }
      } else if (type === 'setMaxJumps') {
        var mjv = exprInfo(ctx, data.jumps);
        if (!mjv.ok) {
          warn(ctx, 'Set Max Jumps: the jumps count is not a number. Nothing changed.');
        } else {
          targets(ctx, data).forEach(function (o) {
            try { MV.setMaxJumps(o, mjv.value); } catch (e) { /* a throwing set is skipped */ }
          });
        }
      } else if (type === 'setCoyoteTime') {
        var ctv = exprInfo(ctx, data.seconds);
        if (!ctv.ok) {
          warn(ctx, 'Set Coyote Time: the seconds are not a number. Nothing changed.');
        } else {
          targets(ctx, data).forEach(function (o) {
            try { MV.setCoyoteTime(o, ctv.value); } catch (e) { /* a throwing set is skipped */ }
          });
        }
      } else if (type === 'setJumpBuffer') {
        var jbv = exprInfo(ctx, data.seconds);
        if (!jbv.ok) {
          warn(ctx, 'Set Jump Buffer: the seconds are not a number. Nothing changed.');
        } else {
          targets(ctx, data).forEach(function (o) {
            try { MV.setJumpBuffer(o, jbv.value); } catch (e) { /* a throwing set is skipped */ }
          });
        }
      } else if (type === 'setWallSlide') {
        var wsv = exprInfo(ctx, data.maxFall);
        if (!wsv.ok) {
          warn(ctx, 'Set Wall Slide: the max fall speed is not a number. Nothing changed.');
        } else {
          targets(ctx, data).forEach(function (o) {
            try { MV.setWallSlide(o, wsv.value); } catch (e) { /* a throwing set is skipped */ }
          });
        }
      } else if (type === 'setWallJump') {
        var wjv = exprInfo(ctx, data.jumpSpeed);
        var wpv = exprInfo(ctx, data.push);
        if (!wjv.ok) {
          warn(ctx, 'Set Wall Jump: the jump speed is not a number. Nothing changed.');
        } else if (!wpv.ok) {
          warn(ctx, 'Set Wall Jump: the push is not a number. Nothing changed.');
        } else {
          targets(ctx, data).forEach(function (o) {
            try { MV.setWallJump(o, wjv.value, wpv.value); } catch (e) { /* a throwing set is skipped */ }
          });
        }
      }
      return;
    }

    // P4 Advanced batch 27 (moving platforms & one-way platforms):
    // Set Platform Path turns any object into a moving platform
    // between two points (and switches it on); Set One-Way Platform
    // flips the one-way flag on the platform config and the physics
    // record together; Set Crumble Time arms the fall-away timer.
    // A bad number warns and holds, a missing object stays quiet.
    // The Set blocks need no live state, so they still write when
    // the frame phase has not minted one yet.
    if (isType(ctx.platformModule, 'isPlatformAction', type)) {
      var PF = ctx.platformModule;
      if (type === 'setPlatformPath') {
        var ppX1 = exprInfo(ctx, data.x1);
        var ppY1 = exprInfo(ctx, data.y1);
        var ppX2 = exprInfo(ctx, data.x2);
        var ppY2 = exprInfo(ctx, data.y2);
        var ppSp = exprInfo(ctx, data.speed);
        if (!ppX1.ok) {
          warn(ctx, 'Set Platform Path: Point 1 X is not a number. Nothing changed.');
        } else if (!ppY1.ok) {
          warn(ctx, 'Set Platform Path: Point 1 Y is not a number. Nothing changed.');
        } else if (!ppX2.ok) {
          warn(ctx, 'Set Platform Path: Point 2 X is not a number. Nothing changed.');
        } else if (!ppY2.ok) {
          warn(ctx, 'Set Platform Path: Point 2 Y is not a number. Nothing changed.');
        } else if (!ppSp.ok) {
          warn(ctx, 'Set Platform Path: the speed is not a number. Nothing changed.');
        } else {
          targets(ctx, data).forEach(function (o) {
            try {
              PF.setPlatformPath(o,
                [{ x: ppX1.value, y: ppY1.value }, { x: ppX2.value, y: ppY2.value }],
                ppSp.value, data.mode);
            } catch (e) { /* a throwing set is skipped */ }
          });
        }
      } else if (type === 'setOneWay') {
        targets(ctx, data).forEach(function (o) {
          try { PF.setOneWay(o, data.enabled); } catch (e) { /* a throwing set is skipped */ }
        });
      } else if (type === 'setCrumbleTime') {
        var ctSec = exprInfo(ctx, data.seconds);
        if (!ctSec.ok) {
          warn(ctx, 'Set Crumble Time: the seconds are not a number. Nothing changed.');
        } else {
          targets(ctx, data).forEach(function (o) {
            try { PF.setCrumbleTime(o, ctSec.value); } catch (e) { /* a throwing set is skipped */ }
          });
        }
      }
      return;
    }

    switch (type) {
      case 'applyForce':
        targets(ctx, data).forEach(function (o) {
          applyVelocity(ctx, o, expr(ctx, data.forceX), expr(ctx, data.forceY), data.mode);
        });
        break;
      case 'setVelocity':
        targets(ctx, data).forEach(function (o) {
          o.velX = expr(ctx, data.velX);
          o.velY = expr(ctx, data.velY);
        });
        break;
      case 'teleport':
      case 'setPosition': {
        var xi = exprInfo(ctx, data.toX ?? data.x);
        var yi = exprInfo(ctx, data.toY ?? data.y);
        if (xi.ok && yi.ok) targets(ctx, data).forEach(function (o) { o.posX = xi.value; o.posY = yi.value; });
        break;
      }
      case 'setVariable': setVar(ctx, data, vars); break;
      case 'randomVariable': vars[data.varName] = randomValue(ctx, data); break;
      case 'destroyObject':
        targets(ctx, data).forEach(function (o) {
          if (ctx.pendingDestroy) ctx.pendingDestroy.add(o.id);
        });
        break;
      case 'showHide':
        targets(ctx, data, true).forEach(function (o) { setVisible(ctx, o, data.action); });
        break;
      case 'setText':
        targets(ctx, data).forEach(function (o) {
          if (o.kind !== 'text') return;
          o._runtimeText = data.useVariable
            ? ((data.prefix || '') + (vars[data.varName] ?? '') + (data.suffix || ''))
            : (data.value || '');
        });
        break;
      case 'setCamera':
        if (ctx.camera) {
          ctx.camera.x = expr(ctx, data.cameraX);
          ctx.camera.y = expr(ctx, data.cameraY);
          ctx.camera.followTarget = '';
        }
        try { if (isFn(ctx.clampCamera)) ctx.clampCamera(); } catch (e) { /* a throwing clamp is skipped */ }
        break;
      case 'followCamera':
        if (ctx.camera) {
          ctx.camera.followTarget = data.targetObject || '';
          ctx.camera.offsetX = expr(ctx, data.offsetX || 0);
          ctx.camera.offsetY = expr(ctx, data.offsetY || 0);
        }
        try { if (isFn(ctx.updateCameraFollow)) ctx.updateCameraFollow(); } catch (e) { /* a throwing follow is skipped */ }
        break;
      // P4 item 37 batch 5 (camera): one-shot center, follow stop, full
      // reset, and zoom.
      case 'centerCameraOn': {
        var z = normalizeZoom(ctx.camera ? ctx.camera.zoom : 1);
        var target = named(ctx, data.targetObject, true)[0];
        if (target && ctx.camera) {
          var ox = expr(ctx, data.offsetX), oy = expr(ctx, data.offsetY);
          var cw = Number(ctx.canvasWidth) || 0, ch = Number(ctx.canvasHeight) || 0;
          ctx.camera.x = (target.posX + target.width / 2) - cw / (2 * z) + (Number.isFinite(ox) ? ox : 0);
          ctx.camera.y = (target.posY + target.height / 2) - ch / (2 * z) + (Number.isFinite(oy) ? oy : 0);
        }
        try { if (isFn(ctx.clampCamera)) ctx.clampCamera(); } catch (e) { /* a throwing clamp is skipped */ }
        break;
      }
      case 'stopCameraFollow':
        if (ctx.camera) ctx.camera.followTarget = '';
        break;
      case 'resetCamera':
        if (ctx.camera) {
          ctx.camera.x = 0; ctx.camera.y = 0; ctx.camera.zoom = 1;
          ctx.camera.followTarget = ''; ctx.camera.offsetX = 0; ctx.camera.offsetY = 0;
        }
        // P4 Advanced batch 15 (camera feel): Reset Camera restores
        // the scene's smoothing / deadzone / bounds too, so a run
        // that changed them mid-level goes back to the authored feel.
        try { if (isFn(ctx.resetCameraFeel)) ctx.resetCameraFeel(); } catch (e) { /* a throwing reset is skipped */ }
        try { if (isFn(ctx.clampCamera)) ctx.clampCamera(); } catch (e) { /* a throwing clamp is skipped */ }
        break;
      case 'setCameraZoom':
        if (ctx.camera) ctx.camera.zoom = normalizeZoom(expr(ctx, data.zoom));
        try { if (isFn(ctx.clampCamera)) ctx.clampCamera(); } catch (e) { /* a throwing clamp is skipped */ }
        break;
      case 'switchScene': switchSceneTo(ctx, data.sceneId); break;
      case 'restartScene':
        if (ctx.pendingSceneId == null && ctx.sceneId != null) requestScene(ctx, ctx.sceneId);
        break;
      case 'nextScene':
      case 'previousScene': changeSceneRelative(ctx, type === 'nextScene' ? 1 : -1); break;
      // P4 item 37 batch 4 (scene management): push/pop scene stack +
      // the runtime background recolor.
      case 'pushScene': pushSceneTo(ctx, data.sceneId); break;
      case 'popScene': popSceneBack(ctx); break;
      case 'setSceneBackground': {
        var scene = null;
        try { scene = isFn(ctx.getScene) ? ctx.getScene() : null; } catch (e) { scene = null; }
        var validColor = false;
        try { validColor = !!(ctx.cameraFx && ctx.cameraFx.isValidHexColor(data.color)); } catch (e) { validColor = false; }
        if (scene && validColor) scene.bgColor = data.color;
        else warn(ctx, 'Set Scene Background: the color is not a valid hex color; nothing changed.');
        break;
      }
      case 'setSize':
        targets(ctx, data).forEach(function (o) {
          o.width = Math.max(1, expr(ctx, data.width));
          o.height = Math.max(1, expr(ctx, data.height));
        });
        break;
      case 'spawnObject': spawnClone(ctx, data.sourceObject, data.spawnX, data.spawnY); break;
      case 'spawnAtObject':
        targets(ctx, { targetObject: data.targetObject, targetMode: data.targetMode || 'context' }).forEach(function (a) {
          spawnClone(ctx, data.sourceObject,
            a.posX + a.width / 2 + expr(ctx, data.offsetX || 0),
            a.posY + a.height / 2 + expr(ctx, data.offsetY || 0));
        });
        break;
      case 'rotateObject':
        targets(ctx, data).forEach(function (o) {
          var ang = expr(ctx, data.angle);
          o.rotation = data.mode === 'set' ? ang : (((o.rotation || 0) + ang) % 360);
        });
        break;
      case 'forceToward':
      case 'moveTowardObject': towardObject(ctx, data, type === 'moveTowardObject'); break;
      case 'forceTowardPosition': {
        var ftx = exprInfo(ctx, data.targetX);
        var fty = exprInfo(ctx, data.targetY);
        if (ftx.ok && fty.ok) towardPoint(ctx, data, ftx.value, fty.value, false);
        break;
      }
      case 'moveTowardPosition': {
        var mtx = exprInfo(ctx, data.targetX);
        var mty = exprInfo(ctx, data.targetY);
        if (mtx.ok && mty.ok) towardPoint(ctx, data, mtx.value, mty.value, true);
        break;
      }
      case 'impulseAwayObject': awayObject(ctx, data); break;
      case 'stopObject':
        targets(ctx, data).forEach(function (o) {
          if (data.axis !== 'y') o.velX = 0;
          if (data.axis !== 'x') o.velY = 0;
        });
        break;
      case 'setGravity': setPhysics(ctx, data, 'gravity'); break;
      case 'setFriction': setPhysics(ctx, data, 'friction'); break;
      case 'setMaxSpeed': setPhysics(ctx, data, 'maxSpeed'); break;
      case 'setBounciness': setPhysics(ctx, data, 'bounciness'); break;
      case 'setPhysicsEnabled':
        targets(ctx, data).forEach(function (o) {
          o.physicsEnabled = data.enabled === true || data.enabled === 'true';
          if (data.resetVelocity) { o.velX = 0; o.velY = 0; }
        });
        break;
      case 'setStatic':
        targets(ctx, data).forEach(function (o) {
          o.static = data.static === true || data.static === 'true';
        });
        break;
      case 'setColor':
        targets(ctx, data).forEach(function (o) {
          o.color = data.color || o.color;
          o.assetId = null;
        });
        break;
      case 'setOpacity':
        targets(ctx, data).forEach(function (o) {
          o.opacity = clamp(expr(ctx, data.opacity ?? 1), 0, 1);
        });
        break;
      // P4 item 37 (block expansion, batch 1: sprite transforms): flip
      // mirrors the drawing; scale multiplies the drawn size.
      // Drawing-only — collision keeps using width/height.
      case 'flipObject':
        targets(ctx, data).forEach(function (o) {
          var d = data.direction || 'horizontal';
          if (d === 'horizontal') o.flipH = true;
          else if (d === 'vertical') o.flipV = true;
          else if (d === 'both') { o.flipH = true; o.flipV = true; }
          else if (d === 'off') { o.flipH = false; o.flipV = false; }
        });
        break;
      case 'setScale':
        targets(ctx, data).forEach(function (o) {
          var sx = expr(ctx, data.scaleX ?? 1), sy = expr(ctx, data.scaleY ?? 1);
          o.scaleX = Number.isFinite(sx) ? sx : 1;
          o.scaleY = Number.isFinite(sy) ? sy : 1;
        });
        break;
      // P4 item 37 (block expansion, batch 2: text manipulation):
      // restyle text objects at runtime; other object kinds are left
      // untouched (mirrors the setText guard).
      case 'setTextSize':
        targets(ctx, data).forEach(function (o) {
          if (o.kind !== 'text') return;
          o.fontSize = clamp(expr(ctx, data.size ?? 24), 6, 200);
        });
        break;
      case 'setTextColor':
        targets(ctx, data).forEach(function (o) {
          if (o.kind === 'text') o.textColor = data.color || o.textColor || '#111827';
        });
        break;
      case 'setTextStyle':
        targets(ctx, data).forEach(function (o) {
          if (o.kind !== 'text') return;
          o.bold = data.bold === 'on';
          o.italic = data.italic === 'on';
        });
        break;
      case 'setTextAlignment':
        targets(ctx, data).forEach(function (o) {
          if (o.kind !== 'text') return;
          o.textAlign = (data.align === 'center' || data.align === 'right') ? data.align : 'left';
        });
        break;
      case 'appendText':
        targets(ctx, data).forEach(function (o) {
          if (o.kind !== 'text') return;
          var current = o._runtimeText !== undefined ? o._runtimeText : (o.text || '');
          o._runtimeText = current + String(data.value ?? '');
        });
        break;
      case 'setLayer':
        targets(ctx, data).forEach(function (o) { o.layer = expr(ctx, data.layer ?? 0); });
        break;
      case 'timerControl': controlTimer(ctx, data); break;
      // P4 item 37 batch 9 (timers): copy a named timer's elapsed
      // seconds into a game variable.
      case 'readTimer': readTimerValue(ctx, data, vars); break;
      case 'playSound':
        try { if (isFn(ctx.playSound)) ctx.playSound(data, idx); } catch (e) { /* a throwing sound is skipped */ }
        break;
      case 'playAnimation':
        if (ctx.anim) targets(ctx, data).forEach(function (o) {
          o._anim = o._anim || ctx.anim.createAnimState();
          ctx.anim.play(o._anim, o, data.animation);
        });
        break;
      case 'setAnimation':
        if (ctx.anim) targets(ctx, data).forEach(function (o) {
          o._anim = o._anim || ctx.anim.createAnimState();
          ctx.anim.setAnimation(o._anim, o, data.animation);
        });
        break;
      case 'stopAnimation':
        if (ctx.anim) targets(ctx, data).forEach(function (o) {
          ctx.anim.stop(o._anim);
        });
        break;
      // P4 Advanced (animation state machines): enter the named state;
      // the state's animation starts playing at the state's speed.
      case 'setAnimState':
        if (ctx.anim && ctx.stateMachine) targets(ctx, data).forEach(function (o) {
          o._anim = o._anim || ctx.anim.createAnimState();
          o._sm = o._sm || ctx.stateMachine.createRuntime();
          var hooks = null;
          try { hooks = isFn(ctx.stateMachineHooks) ? ctx.stateMachineHooks(o) : null; } catch (e) { hooks = null; }
          ctx.stateMachine.setState(o._sm, o, data.state, hooks || {
            warn: function (msg) { warn(ctx, msg); }
          });
        });
        break;
      // P4 Advanced (blend spaces): set the blend values and activate
      // the blend space; stop it again with stopBlend. Unknown blend
      // names warn and hold, blank names stay quiet.
      case 'setBlend':
        if (ctx.blendSpace) targets(ctx, data).forEach(function (o) {
          o._blends = o._blends || ctx.blendSpace.createBlendRuntime();
          ctx.blendSpace.setBlend(o._blends, o, data.blend, expr(ctx, data.blendX ?? 0), expr(ctx, data.blendY ?? 0), {
            warn: function (msg) { warn(ctx, msg); }
          });
        });
        break;
      case 'stopBlend':
        if (ctx.blendSpace) targets(ctx, data).forEach(function (o) {
          ctx.blendSpace.stopBlend(o._blends, o, data.blend);
        });
        break;
      case 'tweenProperty':
        if (ctx.tween) targets(ctx, data).forEach(function (o) {
          ctx.tween.start(null, o, {
            property: data.property,
            to: expr(ctx, data.toValue ?? 0),
            relative: Boolean(data.relative),
            duration: data.duration,
            easing: data.easing,
            repeat: data.repeat
          });
        });
        break;
      case 'stopTween':
        if (ctx.tween) targets(ctx, data).forEach(function (o) {
          ctx.tween.stop(null, o, data.property);
        });
        break;
      case 'emitBurst': {
        if (ctx.particles) {
          var ps = null;
          try { ps = isFn(ctx.ensureParticles) ? ctx.ensureParticles() : ctx.particleState; } catch (e) { ps = null; }
          if (ps) ctx.particles.burst(ps, particleSpec(ctx, data));
        }
        break;
      }
      case 'startEmitter': {
        if (ctx.particles) {
          var ps2 = null;
          try { ps2 = isFn(ctx.ensureParticles) ? ctx.ensureParticles() : ctx.particleState; } catch (e) { ps2 = null; }
          if (ps2) {
            var spec = particleSpec(ctx, data);
            spec.rate = data.rate;
            spec.followObject = data.followObject;
            ctx.particles.startEmitter(ps2, data.emitterName, spec);
          }
        }
        break;
      }
      case 'stopEmitter':
        if (ctx.particles && ctx.particleState) ctx.particles.stopEmitter(ctx.particleState, data.emitterName);
        break;
      case 'clearParticles':
        if (ctx.particles && ctx.particleState) ctx.particles.clearParticles(ctx.particleState, data.emitterName);
        break;
      case 'remapAction':
        if (ctx.actions && ctx.actionsState) ctx.actions.remapAction(ctx.actionsState, data.actionName, data.newKey);
        break;
      case 'resetActionBindings':
        if (ctx.actions && ctx.actionsState) ctx.actions.resetBindings(ctx.actionsState);
        break;
      case 'setBusVolume': {
        if (ctx.audioBuses && ctx.buses) {
          var bus = ctx.audioBuses.normalizeBusId(data.bus);
          var rec = ctx.buses[bus];
          if (rec) {
            var v = Number(data.volume);
            if (!isFinite(v)) v = rec.volume;
            rec.volume = v < 0 ? 0 : (v > 1 ? 1 : v);
          }
        }
        break;
      }
      case 'setBusMuted':
        if (ctx.audioBuses && ctx.buses) {
          var rec2 = ctx.buses[ctx.audioBuses.normalizeBusId(data.bus)];
          if (rec2) rec2.muted = data.muted === true || data.muted === 'true';
        }
        break;
      case 'stopMusic':
        try { if (isFn(ctx.stopMusic)) ctx.stopMusic(); } catch (e) { /* a throwing stop is skipped */ }
        break;
      case 'pauseMusic':
        try { if (isFn(ctx.pauseMusic)) ctx.pauseMusic(); } catch (e) { /* a throwing pause is skipped */ }
        break;
      case 'resumeMusic':
        try { if (isFn(ctx.resumeMusic)) ctx.resumeMusic(); } catch (e) { /* a throwing resume is skipped */ }
        break;
      case 'stopAllSounds':
        try { if (isFn(ctx.stopAllSounds)) ctx.stopAllSounds(); } catch (e) { /* a throwing stop is skipped */ }
        break;
      case 'setMasterVolume':
        if (ctx.audioBuses && isFn(ctx.setMasterVolume)) {
          ctx.setMasterVolume(ctx.audioBuses.normalizeMasterVolume(Number(data.volume)));
        }
        break;
      case 'setTile': {
        // P4 item 31: paint one tilemap cell while the game runs.
        if (ctx.tiles) {
          var maps = named(ctx, data.targetObject).filter(function (o) { return o.kind === 'tilemap'; });
          var col = Math.floor(expr(ctx, data.col ?? 0));
          var row = Math.floor(expr(ctx, data.row ?? 0));
          var tile = Math.floor(expr(ctx, data.tile ?? 0));
          maps.forEach(function (tm) { ctx.tiles.setTile(tm, col, row, tile); });
        }
        break;
      }
      case 'setCollisionLayer': {
        // P4 item 32: change an object's collision layer / mask at runtime.
        var layer = Math.max(0, Math.min(7, Math.floor(expr(ctx, data.layer ?? 0))));
        var mask = Math.max(0, Math.min(255, Math.floor(expr(ctx, data.mask ?? 255))));
        targets(ctx, data).forEach(function (o) {
          o.collision = o.collision || {};
          o.collision.layer = layer;
          o.collision.mask = mask;
        });
        break;
      }
      case 'clampToScreen': clampToScreen(ctx, data); break;
      case 'wrapScreen': wrapScreen(ctx, data); break;
      case 'destroyOutsideScreen': destroyOutside(ctx, data); break;
      case 'pointTowardObject': {
        var src = named(ctx, data.sourceObject)[0];
        if (src) targets(ctx, data).forEach(function (o) {
          pointTo(o, src.posX + src.width / 2, src.posY + src.height / 2, expr(ctx, data.offsetAngle || 0));
        });
        break;
      }
      case 'pointTowardPosition': {
        var ptx = expr(ctx, data.targetX);
        var pty = expr(ctx, data.targetY);
        var poff = expr(ctx, data.offsetAngle || 0);
        targets(ctx, data).forEach(function (o) { pointTo(o, ptx, pty, poff); });
        break;
      }
      case 'faceMovement': {
        var foff = expr(ctx, data.offsetAngle || 0);
        var fmin = expr(ctx, data.minSpeed || 0.05);
        targets(ctx, data).forEach(function (o) {
          if (Math.hypot(o.velX || 0, o.velY || 0) >= fmin) {
            o.rotation = Math.atan2(o.velY || 0, o.velX || 0) * 180 / Math.PI + foff;
          }
        });
        break;
      }
      case 'screenShake':
        if (ctx.cameraFx && ctx.shake &&
            (typeof ctx.shakeCooldownOk !== 'function' || ctx.shakeCooldownOk(data, idx) !== false)) {
          ctx.cameraFx.triggerShake(ctx.shake, expr(ctx, data.strength || 6), expr(ctx, data.duration || 0.2) * 1000);
        }
        break;
      // Screen Flash (v4 gap, cycle 60): a fullscreen color wash that
      // fades from full intensity to transparent over the duration. A bad
      // color warns and holds the old flash; intensity clamps to 0-1 and
      // a zero/negative duration is a no-op flash. Freezes while paused
      // like the shake (the decay runs inside the unpaused update), and
      // draws after the HUD pass in draw(). The color check, clamps, and
      // state write live in HydraCameraFx (P2 item 15/12 slice 1).
      case 'screenFlash': {
        var color = typeof data.color === 'string' ? data.color.trim() : '';
        if (ctx.cameraFx && ctx.flash) {
          var fired = false;
          try { fired = ctx.cameraFx.triggerFlash(ctx.flash, color, expr(ctx, data.intensity ?? 0.6), expr(ctx, data.duration ?? 0.2) * 1000); } catch (e) { fired = false; }
          if (!fired) {
            try { if (isFn(ctx.warnFlashColor)) ctx.warnFlashColor(color); } catch (e) { /* reporting must never break the action */ }
          }
        }
        break;
      }
      case 'saveVariable': {
        var st = storageOf(ctx);
        if (st) {
          try { st.setItem('hydraSave:' + (data.saveKey || data.varName || 'value'), JSON.stringify(vars[data.varName] ?? 0)); } catch (e) { /* quota errors are swallowed, like the export */ }
        }
        break;
      }
      case 'loadVariable': {
        var st2 = storageOf(ctx);
        if (st2) {
          try {
            var raw = st2.getItem('hydraSave:' + (data.saveKey || data.varName || 'value'));
            if (raw !== null) vars[data.varName] = JSON.parse(raw);
          } catch (e) { /* corrupt JSON leaves the variable unchanged, like the export */ }
        }
        break;
      }
      case 'saveGame':
        if (ctx.save) ctx.save.writeSlot(ctx.save.safeStorage(), data.slotName, vars);
        break;
      case 'loadGame': {
        if (ctx.save) {
          var slot = ctx.save.readSlot(ctx.save.safeStorage(), data.slotName);
          if (slot && slot.data) {
            Object.keys(slot.data).forEach(function (k) { vars[k] = slot.data[k]; });
          }
        }
        break;
      }
      case 'deleteSaveSlot':
        if (ctx.save) ctx.save.deleteSlot(ctx.save.safeStorage(), data.slotName);
        break;
      case 'pauseGame':
        if (ctx.pause && ctx.pauseState) ctx.pause.pause(ctx.pauseState);
        break;
      case 'resumeGame':
        if (ctx.pause && ctx.pauseState) ctx.pause.resume(ctx.pauseState);
        break;
      case 'togglePause':
        if (ctx.pause && ctx.pauseState) ctx.pause.toggle(ctx.pauseState);
        break;
      // P4 item 34 (profiling overlay): show/hide/toggle the overlay.
      case 'showProfiler':
        if (ctx.profile && ctx.profilerState) ctx.profile.show(ctx.profilerState);
        break;
      case 'hideProfiler':
        if (ctx.profile && ctx.profilerState) ctx.profile.hide(ctx.profilerState);
        break;
      case 'toggleProfiler':
        if (ctx.profile && ctx.profilerState) ctx.profile.toggle(ctx.profilerState);
        break;
      // P4 item 35 (text scripting API): run the user's JavaScript with
      // the documented `hs` object. Errors warn through the host
      // diagnostics (deduped) and never break the frame.
      case 'runScript':
        if (ctx.scriptApi && isFn(ctx.scriptApiHooks)) ctx.scriptApi.runAction(ctx.scriptApiHooks(), data.code);
        break;
      case 'separateObjects': {
        var objs1 = named(ctx, data.object1);
        var objs2 = named(ctx, data.object2);
        objs1.forEach(function (a) {
          objs2.forEach(function (b) {
            if (a.id !== b.id) separatePair(ctx, a, b, data.move || 'object1');
          });
        });
        break;
      }
      default:
        try { if (isFn(ctx.reportUnknown)) ctx.reportUnknown(type); } catch (e) { /* reporting must never break the dispatch */ }
        break;
    }
  }

  // Execute one action block. Never throws: a bad block, a missing ctx
  // piece, or a throwing subsystem hook degrades to the action being
  // skipped (the dispatch treats a throwing action as stopping only its
  // own propagation; this upholds that contract for direct callers too).
  // P5 core-engine track, item P5-4 (Control flow + events,
  // slice a): the loop entry point. The dispatch routes Repeat and
  // While here (never through executeAction): runBody runs the body
  // chain once — the actions to the loop block's right on the same
  // row, through a fresh propagation — and returns the indexes it
  // executed, in order, so the budget can count them. The handler
  // drives the iterations and reads the Break / Continue flag after
  // each body run. Never throws: a bad count or test warns and holds,
  // a throwing body run is skipped, and the depth is always restored.
  function executeLoopAction(data, ctx, idx, runBody) {
    try {
      return executeLoopInner(data, ctx || {}, idx, runBody);
    } catch (e) {
      /* a throwing loop is skipped, never a frozen game */
      return false;
    }
  }

  // The display name of a loop block, for warnings (Repeat, While,
  // For Each Item, For Each Object, For Each Field).
  function loopDisplayName(type) {
    if (type === 'whileLoop') return 'While';
    if (type === 'forEachList') return 'For Each Item';
    if (type === 'forEachObject') return 'For Each Object';
    if (type === 'forEachTagged') return 'For Each Tagged Object';
    if (type === 'forEachField') return 'For Each Field';
    return 'Repeat';
  }

  function executeLoopInner(data, ctx, idx, runBody) {
    var L = ctx.loopsModule;
    var state = ctx.loopState || null;
    if (!L || typeof L.isLoopBlock !== 'function' || !data ||
        !L.isLoopBlock(data.type)) return false;
    if (!state || typeof runBody !== 'function') return false;
    if (!L.beginLoop(state)) {
      warn(ctx, loopDisplayName(data.type) +
        ': loops nested more than 8 deep are skipped. Flatten the chain instead.');
      return false;
    }
    try {
      if (data.type === 'repeatTimes') runRepeatLoop(data, ctx, state, runBody);
      else if (data.type === 'whileLoop') runWhileLoop(data, ctx, state, runBody);
      else if (data.type === 'forEachList') runForEachList(data, ctx, state, runBody);
      else if (data.type === 'forEachObject') runForEachObject(data, ctx, state, runBody);
      else if (data.type === 'forEachTagged') runForEachTagged(data, ctx, state, runBody);
      else if (data.type === 'forEachField') runForEachField(data, ctx, state, runBody);
    } finally {
      // Depth always comes back down, and a control flag set by a
      // body run that never got read (a throwing body) never leaks
      // into the outer flow — the handler that reads the flag clears
      // it first, so by here it can only be stale.
      try { L.endLoop(state); } catch (e) { /* a throwing restore is skipped */ }
      try { L.clearControl(state); } catch (e) { /* a throwing clear is skipped */ }
    }
    // The loop took ownership of its body (it entered and drove the
    // iterations, even if the count was 0 or the test failed at once),
    // so the flow must not run the body again after the loop. A loop
    // that was skipped — too deep to nest — returns false, and its
    // body runs once through the normal flow instead.
    return true;
  }

  // One body run, counted against the per-frame budget. Returns true
  // when the loop may go on, false when the budget ran out (the
  // caller warns and stops). A throwing body run counts as zero
  // actions and lets the loop go on — the dispatch already swallowed
  // the throw, so the loop is not the place that reports it.
  function runLoopBodyOnce(L, state, runBody) {
    var ran = null;
    try { ran = runBody(); } catch (e) { ran = null; }
    var n = Array.isArray(ran) ? ran.length : 0;
    try { return L.consumeBudget(state, n); } catch (e) { return true; }
  }

  // After a body run: the Break / Continue flag, read and cleared.
  // Returns 'break', 'continue', or null.
  function readLoopControl(L, state) {
    var control = null;
    try { control = L.controlOf(state); } catch (e) { control = null; }
    if (control !== null) {
      try { L.clearControl(state); } catch (e) { /* a throwing clear is skipped */ }
    }
    return (control === 'break' || control === 'continue') ? control : null;
  }

  function runRepeatLoop(data, ctx, state, runBody) {
    var L = ctx.loopsModule;
    var info = exprInfo(ctx, data.count);
    if (!info.ok) {
      warn(ctx, 'Repeat: how many times is not a number. Nothing changed.');
      return;
    }
    var norm = L.normalizeCount(info.value);
    if (!norm.ok) {
      warn(ctx, 'Repeat: how many times is not a number. Nothing changed.');
      return;
    }
    if (norm.clamped) {
      warn(ctx, 'Repeat: ' + norm.original + ' times is past the limit, so it ran ' +
        norm.count + ' times.');
    }
    // The counter variable, when named, counts the time round: 1 on
    // the first run, 2 on the second, up to the count. It is a plain
    // variable — the body reads it like any other, and it keeps its
    // last value after the loop.
    var counterName = String(data.counterVar || '').trim();
    var vars = ctx.variables || {};
    for (var i = 1; i <= norm.count; i++) {
      if (counterName) {
        try { vars[counterName] = i; } catch (e) { /* a throwing store is skipped */ }
      }
      if (!runLoopBodyOnce(L, state, runBody)) {
        warn(ctx, 'Repeat: the loop ran out of its per-frame budget, so it stopped early.');
        return;
      }
      if (readLoopControl(L, state) === 'break') return;
    }
  }

  function runWhileLoop(data, ctx, state, runBody) {
    var L = ctx.loopsModule;
    var op = (typeof data.operator === 'string') ? data.operator : '>=';
    for (var iter = 0; iter < L.MAX_WHILE_ITERATIONS; iter++) {
      var left = exprInfo(ctx, data.left);
      var right = exprInfo(ctx, data.right);
      if (!left.ok || !right.ok) {
        warn(ctx, 'While: the test could not be evaluated. The loop stopped.');
        return;
      }
      if (!L.compare(left.value, op, right.value)) return;
      if (!runLoopBodyOnce(L, state, runBody)) {
        warn(ctx, 'While: the loop ran out of its per-frame budget, so it stopped early.');
        return;
      }
      if (readLoopControl(L, state) === 'break') return;
    }
    warn(ctx, 'While: the test was still true after 1000 times, so the loop stopped. ' +
      'Check the test, or add a Break.');
  }

  // P5-4 slice b (for-each): For Each Item runs the body once per
  // item of a flat list variable — the list the array blocks build.
  // The list is snapshotted at the start (normalizeForEachItems
  // copies the first 1,000), so a body that pushes or pops cannot
  // change the run. The item variable (when named) holds the item
  // each round and the index variable (when named) counts 1, 2, 3 —
  // both are plain flat variables, so the body reads them like any
  // other. A blank list name or a variable that holds no list warns
  // and holds; an empty list runs nothing and stays quiet.
  // P5-5 slice b: when an item is an object handle — the entries
  // List Overlapping Objects stores — the body round also points
  // the execution context at that live object, the same narrowing
  // For Each Object uses, so body actions that target the object's
  // name hit that one object and Read Object Property reads the
  // item's properties through its flat-variable fallback. The
  // context is restored after every round, so the loop never leaks
  // its last object into the chain after it; a stale handle (its
  // object destroyed since the list was built) narrows nothing.
  // A host without the setExecutionContext hook warns once and runs
  // the body anyway, without the narrowing.
  function runForEachList(data, ctx, state, runBody) {
    var L = ctx.loopsModule;
    var listName = String(data.listVar || '').trim();
    if (!listName) {
      warn(ctx, 'For Each Item: the list variable is blank. Name the list to walk through.');
      return;
    }
    var vars = ctx.variables || {};
    var norm = null;
    try { norm = L.normalizeForEachItems(vars[listName]); } catch (e) { norm = null; }
    if (!norm || !norm.ok) {
      warn(ctx, 'For Each Item: "' + listName + '" is not a list. Push items into it first.');
      return;
    }
    if (norm.capped) {
      warn(ctx, 'For Each Item: "' + listName + '" holds ' + norm.total +
        ' items, so only the first 1000 ran.');
    }
    var itemName = String(data.itemVar || '').trim();
    var indexName = String(data.indexVar || '').trim();
    var setCtx = (typeof ctx.setExecutionContext === 'function') ? ctx.setExecutionContext : null;
    var VO = ctx.varScopesModule || null;
    var prevCtx = ctx.executionContext || null;
    var warnedNoCtx = false;
    for (var i = 0; i < norm.items.length; i++) {
      if (itemName) {
        try { vars[itemName] = norm.items[i]; } catch (e) { /* a throwing store is skipped */ }
      }
      if (indexName) {
        try { vars[indexName] = i + 1; } catch (e) { /* a throwing store is skipped */ }
      }
      var narrowed = false;
      if (VO && typeof VO.isObjectRef === 'function' && typeof VO.resolveObjectRef === 'function') {
        var itemObj = null;
        try {
          if (VO.isObjectRef(norm.items[i])) {
            itemObj = VO.resolveObjectRef(norm.items[i], function (n) { return named(ctx, n); });
          }
        } catch (e) { itemObj = null; }
        if (itemObj) {
          if (setCtx) {
            try { setCtx({ obj1: itemObj, obj2: null }); narrowed = true; } catch (e) { /* a throwing set is skipped */ }
          } else if (!warnedNoCtx) {
            warnedNoCtx = true;
            warn(ctx, 'For Each Item: this runtime cannot point actions at each object, ' +
              'so the body may hit the same object every time.');
          }
        }
      }
      var ok = runLoopBodyOnce(L, state, runBody);
      if (narrowed) {
        try { setCtx(prevCtx); } catch (e) { /* a throwing restore is skipped */ }
      }
      if (!ok) {
        warn(ctx, 'For Each Item: the loop ran out of its per-frame budget, so it stopped early.');
        return;
      }
      if (readLoopControl(L, state) === 'break') return;
    }
  }

  // P5-4 slice b (for-each): For Each Object runs the body once per
  // live object with the given name, in live order, snapshotted at
  // the start so a body that destroys an object cannot shift the
  // run. Each round hands the object to the body through the
  // execution context ({ obj1: the object }), the same narrowing
  // pick conditions use — body actions that target the object's name
  // hit that one object, and the context is restored after every
  // round, so the loop never leaks its last object into the chain
  // after it. The index variable (when named) counts 1, 2, 3. A
  // blank name warns and holds; no live objects runs nothing and
  // stays quiet. There is no item variable: object references as
  // values are P5-5, so the body reaches the object only through
  // action targeting. A host without the setExecutionContext hook
  // warns once and runs the body anyway, without the narrowing.
  function runForEachObject(data, ctx, state, runBody) {
    var L = ctx.loopsModule;
    var name = String(data.objectName || '').trim();
    if (!name) {
      warn(ctx, 'For Each Object: no object is named. Pick the object to walk through.');
      return;
    }
    var all = [];
    try {
      var found = (typeof ctx.named === 'function') ? ctx.named(name) : [];
      if (Array.isArray(found)) all = found.slice();
    } catch (e) { all = []; }
    if (all.length > L.MAX_FOR_EACH_ITEMS) {
      warn(ctx, 'For Each Object: there are ' + all.length + ' live "' + name +
        '" objects, so only the first 1000 ran.');
      all = all.slice(0, L.MAX_FOR_EACH_ITEMS);
    }
    var setCtx = (typeof ctx.setExecutionContext === 'function') ? ctx.setExecutionContext : null;
    if (!setCtx && all.length > 0) {
      warn(ctx, 'For Each Object: this runtime cannot point actions at each object, ' +
        'so the body may hit the same object every time.');
    }
    var indexName = String(data.indexVar || '').trim();
    var vars = ctx.variables || {};
    var prevCtx = ctx.executionContext || null;
    for (var i = 0; i < all.length; i++) {
      if (indexName) {
        try { vars[indexName] = i + 1; } catch (e) { /* a throwing store is skipped */ }
      }
      if (setCtx) {
        try { setCtx({ obj1: all[i], obj2: null }); } catch (e) { /* a throwing set is skipped */ }
      }
      var ok = runLoopBodyOnce(L, state, runBody);
      if (setCtx) {
        try { setCtx(prevCtx); } catch (e) { /* a throwing restore is skipped */ }
      }
      if (!ok) {
        warn(ctx, 'For Each Object: the loop ran out of its per-frame budget, so it stopped early.');
        return;
      }
      if (readLoopControl(L, state) === 'break') return;
    }
  }

  // P4 Advanced batch 35 (pick objects by tag): For Each Tagged
  // Object runs the body once per live object carrying a tag — the
  // group a tag names, whatever the members are called. The tagged
  // objects are snapshotted at the start (the first 1,000, with a
  // warning naming the real total), so a body that adds or removes
  // a tag cannot change the run. Each round hands the body the
  // object through the execution context, the same narrowing For
  // Each Object uses, so body actions that target the object's name
  // hit that one object — and when the Object variable is named it
  // also holds the round's object as a flat handle, so the body can
  // read it with Read Object Property or destroy it with Destroy
  // Object In Variable even when the tagged objects have different
  // names (the flat-variable fallback those blocks read). The index
  // variable (when named) counts 1, 2, 3. The context is restored
  // after every round, so the loop never leaks its last object into
  // the chain after it. A blank tag warns and holds; no live tagged
  // objects runs nothing and stays quiet. A host without the
  // setExecutionContext hook warns once and runs the body anyway,
  // without the narrowing.
  function runForEachTagged(data, ctx, state, runBody) {
    var L = ctx.loopsModule;
    var tag = String(data.tag || '').trim();
    if (!tag) {
      warn(ctx, 'For Each Tagged Object: no tag is named. Pick the tag to walk through.');
      return;
    }
    var all = [];
    try {
      var TG = ctx.tagsModule;
      if (TG && typeof TG.objectsWithTag === 'function') {
        all = TG.objectsWithTag(allObjects(ctx), tag) || [];
      } else {
        var rawTag = tag.toLowerCase();
        all = allObjects(ctx).filter(function (o) {
          if (!o || !Array.isArray(o.tags)) return false;
          return o.tags.some(function (t) {
            return typeof t === 'string' && t.trim().toLowerCase() === rawTag;
          });
        });
      }
      if (!Array.isArray(all)) all = [];
      else all = all.slice();
    } catch (e) { all = []; }
    if (all.length > L.MAX_FOR_EACH_ITEMS) {
      warn(ctx, 'For Each Tagged Object: there are ' + all.length + ' live objects tagged "' + tag +
        '", so only the first 1000 ran.');
      all = all.slice(0, L.MAX_FOR_EACH_ITEMS);
    }
    var setCtx = (typeof ctx.setExecutionContext === 'function') ? ctx.setExecutionContext : null;
    if (!setCtx && all.length > 0) {
      warn(ctx, 'For Each Tagged Object: this runtime cannot point actions at each object, ' +
        'so the body may hit the same object every time.');
    }
    var objVarName = String(data.objVar || '').trim();
    var indexName = String(data.indexVar || '').trim();
    var vars = ctx.variables || {};
    var VO = ctx.varScopesModule || null;
    var warnedNoVO = false;
    var prevCtx = ctx.executionContext || null;
    for (var i = 0; i < all.length; i++) {
      if (objVarName) {
        var handle = null;
        try {
          if (VO && typeof VO.objectRefOf === 'function') handle = VO.objectRefOf(all[i]);
        } catch (e) { handle = null; }
        if (handle) {
          try { vars[objVarName] = handle; } catch (e) { /* a throwing store is skipped */ }
        } else if (!warnedNoVO) {
          warnedNoVO = true;
          warn(ctx, 'For Each Tagged Object: this runtime cannot hold the object in a variable, ' +
            'so the object variable stays empty.');
        }
      }
      if (indexName) {
        try { vars[indexName] = i + 1; } catch (e) { /* a throwing store is skipped */ }
      }
      if (setCtx) {
        try { setCtx({ obj1: all[i], obj2: null }); } catch (e) { /* a throwing set is skipped */ }
      }
      var ok = runLoopBodyOnce(L, state, runBody);
      if (setCtx) {
        try { setCtx(prevCtx); } catch (e) { /* a throwing restore is skipped */ }
      }
      if (!ok) {
        warn(ctx, 'For Each Tagged Object: the loop ran out of its per-frame budget, so it stopped early.');
        return;
      }
      if (readLoopControl(L, state) === 'break') return;
    }
  }

  // P5-6 slice c (iteration over structures): For Each Field runs
  // the body once per field of a structure — the dictionary the
  // structure blocks build. The keys and their values are
  // snapshotted at the start (normalizeForEachFields copies the
  // first 1,000), so a body that adds or removes a field cannot
  // change the run. The key variable (when named) holds the field
  // name as text each round, the value variable (when named) holds
  // the field's value, and the index variable (when named) counts
  // 1, 2, 3 — all three are plain flat variables, so the body reads
  // them like any other. A blank structure name or a variable that
  // holds no structure warns and holds (a list is not a structure —
  // walk a list with For Each Item); an empty structure runs
  // nothing and stays quiet. When a field's value is an object
  // handle — the entries Store Object In Structure writes — the
  // body round also points the execution context at that live
  // object, the same narrowing For Each Item uses, so body actions
  // that target the object's name hit that one object and Read
  // Object Property reads the value's properties through its
  // flat-variable fallback. The context is restored after every
  // round, so the loop never leaks its last object into the chain
  // after it; a stale handle narrows nothing. A host without the
  // setExecutionContext hook warns once and runs the body anyway,
  // without the narrowing.
  function runForEachField(data, ctx, state, runBody) {
    var L = ctx.loopsModule;
    var structName = String(data.varName || '').trim();
    if (!structName) {
      warn(ctx, 'For Each Field: the structure variable is blank. Name the structure to walk through.');
      return;
    }
    var vars = ctx.variables || {};
    var norm = null;
    try { norm = L.normalizeForEachFields(vars[structName]); } catch (e) { norm = null; }
    if (!norm || !norm.ok) {
      warn(ctx, 'For Each Field: "' + structName + '" is not a structure. Set fields on it first.');
      return;
    }
    if (norm.capped) {
      warn(ctx, 'For Each Field: "' + structName + '" holds ' + norm.total +
        ' fields, so only the first 1000 ran.');
    }
    var keyName = String(data.keyVar || '').trim();
    var valueName = String(data.valueVar || '').trim();
    var indexName = String(data.indexVar || '').trim();
    var setCtx = (typeof ctx.setExecutionContext === 'function') ? ctx.setExecutionContext : null;
    var VO = ctx.varScopesModule || null;
    var prevCtx = ctx.executionContext || null;
    var warnedNoCtx = false;
    for (var i = 0; i < norm.fields.length; i++) {
      if (keyName) {
        try { vars[keyName] = norm.fields[i].key; } catch (e) { /* a throwing store is skipped */ }
      }
      if (valueName) {
        try { vars[valueName] = norm.fields[i].value; } catch (e) { /* a throwing store is skipped */ }
      }
      if (indexName) {
        try { vars[indexName] = i + 1; } catch (e) { /* a throwing store is skipped */ }
      }
      var narrowed = false;
      if (VO && typeof VO.isObjectRef === 'function' && typeof VO.resolveObjectRef === 'function') {
        var fieldObj = null;
        try {
          if (VO.isObjectRef(norm.fields[i].value)) {
            fieldObj = VO.resolveObjectRef(norm.fields[i].value, function (n) { return named(ctx, n); });
          }
        } catch (e) { fieldObj = null; }
        if (fieldObj) {
          if (setCtx) {
            try { setCtx({ obj1: fieldObj, obj2: null }); narrowed = true; } catch (e) { /* a throwing set is skipped */ }
          } else if (!warnedNoCtx) {
            warnedNoCtx = true;
            warn(ctx, 'For Each Field: this runtime cannot point actions at each object, ' +
              'so the body may hit the same object every time.');
          }
        }
      }
      var ok = runLoopBodyOnce(L, state, runBody);
      if (narrowed) {
        try { setCtx(prevCtx); } catch (e) { /* a throwing restore is skipped */ }
      }
      if (!ok) {
        warn(ctx, 'For Each Field: the loop ran out of its per-frame budget, so it stopped early.');
        return;
      }
      if (readLoopControl(L, state) === 'break') return;
    }
  }

  function executeAction(data, ctx, idx) {
    try {
      executeInner(data, ctx || {}, idx);
    } catch (e) {
      /* a throwing action is skipped, never a frozen game */
    }
  }

  return {
    executeAction: executeAction,
    // P5-4 slices a–b (loops): the loop entry point the dispatch's
    // executeLoop hook calls with the body runner — Repeat, While,
    // For Each Item, and For Each Object run their body chain through
    // it, never through executeAction.
    executeLoopAction: executeLoopAction,
    // P4 Advanced batch 24 (enemy spawner): the per-frame spawner
    // phase clones through this, so a spawner spawn is the same Spawn
    // Object action the blocks run (same clone, same init, same id
    // scheme). Returns the clone, or null when nothing was cloned.
    spawnObjectAt: spawnClone
  };
}

if (typeof window !== 'undefined') {
  window.HydraExecute = hydraExecuteFactory();
  // Self-contained source of the factory, inlined into exported playable games
  // by buildPlayableHtml (player-runtime.js). Kept as a string, never eval'd here.
  window.HydraExecute.factorySource = hydraExecuteFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraExecuteFactory;
