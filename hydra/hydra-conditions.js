/* ============================================================================
 * hydra-conditions.js — HydraScript shared per-block condition evaluation
 * (P2 item 15/12, slice 8: the shared-engine extraction).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation
 * of the condition switch both runtimes step through once per frame —
 * the part of evaluate (export) / evaluateCondition (preview) that is
 * about what each block type means — used by:
 *   - the editor preview runtime (script.js evaluateCondition delegates
 *     to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * The action switches (execute in the export, executeAction in the
 * preview) stay host-side — they are the next and final slice, not this
 * one — but every condition both runtimes can evaluate now lives here.
 * Each host only supplies a context object (ctx) describing its live
 * run state; the module never reads a host global.
 *
 * ctx contract (every field optional; a missing piece degrades to the
 * condition reading false, never to a throw):
 *   - variables — the live variables object (name -> value).
 *   - startedScopes — a Set of scope keys whose gameStart already fired.
 *   - hidden — a Set of hidden object ids (used by objectVisible's find).
 *   - keys, keysJustPressed, keysJustReleased — Sets of canonical key names.
 *   - hasKey(set, key) — the canonical key lookup (HydraInput.keySetHas).
 *   - mouse — { x, y } in screen pixels; mouseButtons, mouseJustPressed,
 *     mouseJustReleased — Sets of mouse button codes; mouseButtonCode(b).
 *   - touchCount — number of active touches.
 *   - gamepadConnected — boolean; gamepadButtons, gamepadJustPressed,
 *     gamepadJustReleased — Sets of button indexes; gamepadAxes —
 *     { lx, ly, rx, ry }.
 *   - camera — { x, y, zoom, followTarget }; canvasWidth, canvasHeight — numbers.
 *   - named(name) — live objects by name, hidden/destroyed/pending-
 *     destroy excluded (the export's named() semantics — see the
 *     divergence note below). allObjects() — every live object
 *     (destroyed/pending-destroy excluded, hidden included), for the
 *     raycast-style sweeps. hitbox(obj) — the object's hitbox rect.
 *   - isCollisionObject(obj) — the host's collision predicate.
 *   - ui — the HydraUi module (or null): isAnchored, isHudObject,
 *     resolveWidgetPosition.
 *   - expr(value) — the host's expression evaluator -> finite number.
 *   - contexts — the per-frame contexts store, keyed "scopeKey:idx".
 *   - once — a Set of fired triggerOnce keys ("scopeKey:idx").
 *   - adjacentIndexes(idx) — [up, down, left, right] cell indexes.
 *   - scopeKey(scope) — the scope's key string.
 *   - timers — a Map of timer records; timerElapsedSeconds(key, nowMs)
 *     — the host's read-only elapsed-seconds helper; nowMs() — the
 *     frozen game clock in ms (HydraPause.gameNow over performance.now);
 *     frameId — the current frame number.
 *   - isPaused() — whether the run is paused (frozen world).
 *   - worldSize() — { width, height } of the current scene, or null.
 *   - triggerEntered, triggerExited — arrays of "zoneId:targetId" keys
 *     for this frame's trigger edges.
 *   - language — the run's current language code.
 *   - dialogue — the live dialogue runtime (HydraDialogue's
 *     createDialogueRuntime shape: active, dialogue, lineIndex,
 *     revealed, waitingChoice) or null; the dialogue conditions read
 *     it directly, like languageIs reads ctx.language. Never throws
 *     when it is missing — the conditions read false.
 *   - inventory — the live backpack runtime (HydraInventory's
 *     createInventoryRuntime shape: counts, a name -> count map) or
 *     null; the inventory conditions read it directly, like the
 *     dialogue conditions read ctx.dialogue. Never throws when it is
 *     missing — the conditions read false (an unheld item reads 0).
 *   - questLog — the live quest-log runtime (HydraQuest's
 *     createQuestRuntime shape: progress, a name -> count map, and
 *     done, a name -> true set) or null; the quest conditions read
 *     it directly, like the inventory conditions read ctx.inventory.
 *     Never throws when it is missing — Quest Complete reads false
 *     and Quest Progress reads 0.
 *   - achievementLog — the live unlocked-set runtime
 *     (HydraAchievement's createAchievementRuntime shape: unlocked,
 *     a name -> true set) or null; the achievement conditions read
 *     it directly, like the quest conditions read ctx.questLog.
 *     Never throws when it is missing — Achievement Unlocked reads
 *     false and Achievement Count reads 0.
 *   - cutscene — the live cutscene runtime (HydraCutscene's
 *     createCutsceneRuntime shape: active, the playing cutscene
 *     entry or null, and lastFinished, the most recently finished
 *     cutscene name or null) or null; the cutscene conditions read
 *     it directly, like the achievement conditions read
 *     ctx.achievementLog. Never throws when it is missing — Cutscene
 *     Playing and Cutscene Finished read false (a blank name means
 *     any cutscene, so a missing runtime still reads false).
 *   - highScoreTable — the live ranked table (HydraHighScore's
 *     createHighScoreRuntime shape: entries, a best-first array of
 *     { name, score, date } records) or null, plus highScoreConfig —
 *     the project's table config ({ maxEntries, defaultName }) or
 *     null; the high-score conditions read them directly, like the
 *     cutscene conditions read ctx.cutscene. Never throws when they
 *     are missing — Is High Score reads false and High Score Count
 *     reads 0 (a missing config reads as the 10-entry default).
 *   - timeScale — the live time-scale runtime (HydraTimeScale's
 *     createTimeScaleRuntime shape: { scale }) or null; the Time
 *     Scale condition reads its scale directly, like the high-score
 *     conditions read the table. Never throws when it is missing —
 *     the scale reads as 1, so the comparison still runs.
 *   - transition — the live transition runtime (HydraTransition's
 *     createTransitionRuntime shape: phase, the 'idle' / 'out' /
 *     'in' step, pendingScene, the scene being moved to, and
 *     lastFinished, the most recently transitioned-to scene or
 *     null) or null; the transition conditions read it directly,
 *     like the cutscene conditions read ctx.cutscene. Never throws
 *     when it is missing — Transition Playing and Transition
 *     Finished read false (a blank scene means any transition, so
 *     a missing runtime still reads false).
 *   - musicCount — held Music-bus voices; musicPaused — boolean.
 *   - profilerVisible() — whether the profiler overlay shows.
 *   - random() — Math.random (injectable for tests).
 *   - actions, actionState — the HydraActions module + its per-frame
 *     state (or null).
 *   - physics2d — the HydraPhysics2D module (or null); tiles — the
 *     HydraTiles module (or null); save — the HydraSave module (or null).
 *   - anim, stateMachine, blendSpace, skeleton, tween — the animation
 *     subsystem modules (or null).
 *   - collections, math, pick, layerFx, threeD, light2d, joints,
 *     scriptApi — the subsystem modules (or null), each with its
 *     hook-builder below.
 *   - eventsModule — the HydraEvents module (or null); events — the
 *     live event state (HydraEvents.createEventState shape: counts
 *     per name, seen per listener cell) or null. The On Event
 *     condition polls it through the module: true exactly once per
 *     broadcast of its name. Never throws when it is missing — a
 *     listener with no event state reads false.
 *   - parallaxModule — the HydraParallax module (or null); the
 *     Parallax Factor condition reads factors through it, and the
 *     mouseOver / objectClicked hit test uses its parallax camera.
 *   - pathfindModule — the HydraPathfind module (or null); the Path
 *     Finished and Has Path conditions read an object's _path record
 *     through it.
 *   - aiModule — the HydraAi module (or null); the AI Behavior and
 *     Target In Range conditions read an object's _ai record and the
 *     center-to-center distance through it.
 *   - joystickModule — the HydraJoystick module (or null); the
 *     Joystick Active and Joystick Tilt conditions read the live
 *     stick through it. The ctx.joystick record is the live stick
 *     itself; a missing record reads false.
 *   - healthModule — the HydraHealth module (or null); the Health
 *     and Object Died conditions read hit points through it.
 *   - damageFxModule — the HydraDamageFx module (or null); the Is
 *     Invincible condition reads the shield through it. nowMs() is
 *     the frozen game clock in ms (HydraPause.gameNow over
 *     performance.now), so the shield reads frozen while paused.
 *   - respawnModule — the HydraRespawn module (or null); the
 *     Checkpoint Set and Respawn Count conditions read the live
 *     respawn state through it. respawn — the live respawn state (or
 *     null); a missing state reads as no checkpoint and zero
 *     respawns, and both conditions evaluate while paused like the
 *     other run-state reads.
 *   - spawnModule — the HydraSpawn module (or null); the Spawner
 *     Active and Spawned Count conditions read the live spawner state
 *     through it. spawners — the live spawner state (or null); a
 *     missing state reads as no spawner running and a zero count, and
 *     both conditions evaluate while paused like the respawn reads.
 *   - livesModule — the HydraLives module (or null); the Lives and
 *     Game Over conditions read the live lives state through it.
 *     lives — the live lives state (or null); a missing state reads
 *     as the default 3 lives, so no game over, and both conditions
 *     evaluate while paused like the spawner reads.
 *   - xpModule — the HydraXp module (or null); the XP / Level /
 *     Level Up conditions read the live XP state through it. xp —
 *     the live XP state (or null); a missing state reads as 0 XP at
 *     level 1, so no level up, and all three conditions evaluate
 *     while paused like the lives reads.
 *   - scalingModule — the HydraScaling module (or null); the Enemy
 *     Level condition reads the live scaling state through it.
 *     scaling — the live scaling state (or null); a missing state
 *     reads as level 1 for every object, and the condition evaluates
 *     while paused like the level read.
 *   - movementModule — the HydraMovement module (or null); the Jumps
 *     Left and Is Dashing conditions read the live movement state
 *     through it. movement — the live movement state (or null); a
 *     missing state reads as a full jump count and not dashing, and
 *     both conditions evaluate while paused like the lives reads.
 *     nowMs() — the frozen game clock in ms (HydraPause.gameNow over
 *     performance.now); the dash read converts it to seconds.
 *   - platformModule — the HydraPlatform module (or null); the
 *     Standing On Platform and Standing On One-Way conditions read
 *     the live platform state through it. platform — the live
 *     platform state (or null); without the module the raw platform
 *     config reads the same way, and both conditions evaluate while
 *     paused like the movement reads.
 *   - collectionHooks(), mathHooks(), pickHooks(),
 *     layerFxConditionHooks(), threeDConditionHooks(),
 *     light2dConditionHooks(), jointConditionHooks(), scriptApiHooks()
 *     — zero-argument functions returning the hooks object the matching
 *     subsystem module needs (the hosts' existing builders).
 *   - reportUnknown(type) — host reporting for an unknown condition type.
 *
 * Semantics (the export's, which is the reference):
 *   - evaluateCondition(data, ctx, scope, idx) returns
 *     { triggered, context } like both hosts' old switches; a falsy or
 *     unknown-typed block reports through reportUnknown and reads false.
 *   - World-dependent conditions (FROZEN_WHILE_PAUSED) report the pause
 *     freeze instead of stale state: they do not fire while paused, and
 *     a reversed one passes. onTimer has its own frozen early return.
 *   - Nothing here ever throws: a throwing hook, subsystem call, or
 *     corrupt field degrades to the condition reading false.
 *
 * Divergences closed by this slice (all in the direction of the export,
 * the shipped game, unless noted — the preview used to differ):
 *   - Hidden objects no longer participate in preview conditions.
 *     The export's named() excludes hidden objects, so a hidden hero was
 *     invisible to objectCount, collision, overlapTouch, onFloor,
 *     distanceCheck, the physics queries, position/velocity checks,
 *     textCheck, tile checks, edge checks, mouseOver/objectClicked, and
 *     the animation/state reads in exports — while the preview's alive
 *     lookups included hidden objects, so the same project behaved
 *     differently in the preview. ctx.named now excludes hidden in both.
 *   - Collision box/box pairs now use the shape-aware pairOverlap in
 *     both runtimes (the export's test). The preview special-cased
 *     box/box pairs through its legacy AABB contact test and reported a
 *     `side` in the context; the context now carries the export's
 *     `touching` instead (nothing downstream reads `side`).
 *   - When several objects match, the context reports the export's
 *     match: the last matching pair for distanceCheck and onFloor, the
 *     first match for positionCheck/velocityCheck (the preview reported
 *     the first pair for distanceCheck/onFloor and the last object's
 *     velocity value for velocityCheck).
 *   - distanceCheck measures raw position centers (posX + width/2),
 *     like the export — the preview measured hitbox centers, which
 *     differ when a custom hitbox offset is set.
 *   - chance reports the evaluated, clamped percent in its context
 *     (the preview's value); the export reported the raw data.percent,
 *     which can be an unevaluated expression string.
 *   - keyJustPressed reports { key } and mouseOver/objectClicked report
 *     { obj1, targetObject } (the export's contexts); the preview's
 *     extra `justPressed`, `mouseOver`, `objectClicked`, and
 *     `mouseCondition` context keys are dropped (nothing reads them).
 *   - gameStart always carries its { gameStart: true } context, even
 *     when it does not fire (the export's shape; the preview returned
 *     no context on the false branch).
 *   - Raycast Hit, Objects Overlapping, and Line of Sight ignore objects
 *     destroyed earlier in the same frame (the preview's exclusion, and
 *     the cycle-63 rule that scripts never observe a destroyed object);
 *     the export's sweeps read the raw object list, so a just-destroyed
 *     object could still be hit on that one frame.
 *   - An unknown `logic` value on the `and` block behaves as 'and'
 *     (the export's reading); the preview read it as neither, so the
 *     block never fired.
 *
 * Deliberately NOT unified (stays host-side, documented here so the
 * next slice does not "fix" it by accident):
 *   - The per-block action switches (execute in the export,
 *     executeAction in the preview) and their helpers — the next slice.
 *   - The preview's DOM work around the dispatch (the 'triggered' cell
 *     classes, the cyan 'traced' ring, the Trace feed) and the
 *     launch-time gameStart path (processGameStartConditions).
 *   - The export's per-host scriptApiHooks builders and the subsystem
 *     hook builders (collectionHooks, mathHooks, ...) — the module calls
 *     them, it does not own them.
 *   - The preview's AABB fallback for collision/overlapTouch when the
 *     physics module is missing is kept (aabbContact /
 *     aabbOverlapsTolerance below); every other physics-query condition
 *     reads false without the module, the house guarded-call degradation.
 *
 * Load order (index.html): hydra-conditions.js BEFORE player-runtime.js
 * and script.js. player-runtime.js throws a clear error if
 * HydraConditions is missing. The preview guards the evaluateCondition
 * call (window.HydraConditions), so the editor still boots if the tag
 * is ever dropped — conditions simply read false, the same guarded-call
 * degradation the other shared modules use; the tag order is pinned by
 * tests/conditions.test.js.
 * ========================================================================== */

function hydraConditionsFactory() {
  'use strict';

  // World-dependent conditions report the pause freeze instead of stale
  // state (F4). onTimer is not in this set: it has its own frozen early
  // return inside the timer case, with a different context shape.
  var FROZEN_WHILE_PAUSED = [
    'collision', 'overlapTouch', 'onFloor', 'lineOfSight', 'onEdge',
    'tileSolidAt', 'standingOnTile', 'triggerEnter', 'triggerExit',
    'raycastHit', 'overlapCheck'
  ];

  function isFn(f) { return typeof f === 'function'; }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function res(triggered, context) {
    return { triggered: Boolean(triggered), context: context || {} };
  }

  // The comparison operators, identical to both hosts' compare /
  // compareValues. An unknown operator never matches — corrupt data
  // stays quiet instead of throwing.
  function compare(left, op, right) {
    if (op === '>=') return left >= right;
    if (op === '<=') return left <= right;
    if (op === '==') return left == right;
    if (op === '!=') return left != right;
    if (op === '>') return left > right;
    if (op === '<') return left < right;
    return false;
  }

  function normalizeCameraZoom(value) {
    var z = Number(value);
    return Number.isFinite(z) ? Math.min(4, Math.max(0.25, z)) : 1;
  }

  // --- Safe ctx accessors. A missing or throwing host piece degrades to
  // the safe default, never to a throw out of the module. ---

  function named(ctx, name) {
    try {
      var r = ctx.named(name);
      return Array.isArray(r) ? r : [];
    } catch (e) { return []; }
  }

  // The raw scoped-variable entry for a scope, read straight from
  // the state shape ({ global, scene, object, local } of typed
  // entries) when the HydraVariables module is not wired — the
  // fallback the scoped conditions use, the way enemyLevel falls
  // back to the raw scaling record. Returns the entry { type, value }
  // or null.
  function rawScopedEntry(state, scope, name, sceneId, objectName) {
    try {
      if (!state || typeof state !== 'object') return null;
      var n = (typeof name === 'string') ? name.trim() : '';
      if (n === '') return null;
      var s = (typeof scope === 'string') ? scope.trim().toLowerCase() : 'global';
      var map = null;
      if (s === 'scene') {
        if (sceneId == null || sceneId === '') return null;
        var scenes = state.scene;
        map = (scenes && typeof scenes === 'object') ? scenes[String(sceneId)] : null;
      } else if (s === 'object') {
        var key = (typeof objectName === 'string') ? objectName.trim() : '';
        if (key === '') return null;
        var objs = state.object;
        map = (objs && typeof objs === 'object') ? objs[key] : null;
      } else if (s === 'local') {
        // P5-3: the innermost live function call's locals map, bound
        // by the functions module for the call.
        map = state.local;
      } else {
        map = state.global;
      }
      if (!map || typeof map !== 'object') return null;
      var entry = map[n];
      if (!entry || typeof entry !== 'object') return null;
      return { type: (typeof entry.type === 'string') ? entry.type : 'number', value: entry.value };
    } catch (e) { return null; }
  }

  function allObjects(ctx) {
    try {
      var r = ctx.allObjects();
      return Array.isArray(r) ? r : [];
    } catch (e) { return []; }
  }

  function expr(ctx, value) {
    try {
      var v = Number(ctx.expr(value));
      return Number.isFinite(v) ? v : 0;
    } catch (e) { return 0; }
  }

  function isPaused(ctx) {
    try { return !!(ctx.isPaused && ctx.isPaused()); } catch (e) { return false; }
  }

  function nowMs(ctx) {
    try {
      var v = Number(ctx.nowMs());
      return Number.isFinite(v) ? v : 0;
    } catch (e) { return 0; }
  }

  function scopeKeyOf(ctx, scope) {
    try {
      var k = ctx.scopeKey ? ctx.scopeKey(scope) : '';
      return (k === undefined || k === null) ? '' : String(k);
    } catch (e) { return ''; }
  }

  function hitboxOf(ctx, obj) {
    try {
      var b = ctx.hitbox(obj);
      if (b && typeof b === 'object') return b;
    } catch (e) { /* fall through to the safe default */ }
    return { x: 0, y: 0, width: 1, height: 1 };
  }

  function isCollisionObjectOf(ctx) {
    return function (obj) {
      try { return !!(ctx.isCollisionObject && ctx.isCollisionObject(obj)); } catch (e) { return false; }
    };
  }

  function adjacentContexts(ctx, scopeKey, idx) {
    var out = [];
    var list = [];
    try { list = ctx.adjacentIndexes(idx) || []; } catch (e) { list = []; }
    if (!Array.isArray(list)) return out;
    list.forEach(function (i) {
      var c = null;
      try { c = ctx.contexts ? ctx.contexts[scopeKey + ':' + i] : null; } catch (e) { c = null; }
      if (c) out.push(c);
    });
    return out;
  }

  // --- Geometry helpers (the export's aabb/aabbContact, parameterized
  // over the host's hitbox function so both runtimes share one copy). ---

  function aabb(a, b, hitbox) {
    var ab = hitbox(a), bb = hitbox(b);
    return ab.x < bb.x + bb.width && ab.x + ab.width > bb.x &&
           ab.y < bb.y + bb.height && ab.y + ab.height > bb.y;
  }

  // Full contact test, including which side the contact is on. Returns
  // null when there is no contact.
  function aabbContact(a, b, tolerance, hitbox) {
    if (!a || !b || a.id === b.id) return null;
    var ab = hitbox(a), bb = hitbox(b);
    var tol = tolerance || 0;
    var horizontal = ab.x <= bb.x + bb.width + tol && ab.x + ab.width >= bb.x - tol;
    var vertical = ab.y <= bb.y + bb.height + tol && ab.y + ab.height >= bb.y - tol;
    if (!horizontal || !vertical) return null;
    var overlap = aabb(a, b, hitbox);
    var gaps = [
      { side: 'bottom', distance: Math.abs((ab.y + ab.height) - bb.y) },
      { side: 'top', distance: Math.abs(ab.y - (bb.y + bb.height)) },
      { side: 'right', distance: Math.abs((ab.x + ab.width) - bb.x) },
      { side: 'left', distance: Math.abs(ab.x - (bb.x + bb.width)) }
    ];
    if (!overlap) {
      var touchingSide = gaps
        .filter(function (gap) { return gap.distance <= tol; })
        .sort(function (x, y) { return x.distance - y.distance; })[0];
      return touchingSide ? { touching: true, overlap: false, side: touchingSide.side } : null;
    }
    var dx = (ab.x + ab.width / 2) - (bb.x + bb.width / 2);
    var dy = (ab.y + ab.height / 2) - (bb.y + bb.height / 2);
    var ox = (ab.width / 2 + bb.width / 2) - Math.abs(dx);
    var oy = (ab.height / 2 + bb.height / 2) - Math.abs(dy);
    var side = ox < oy
      ? (dx < 0 ? 'right' : 'left')
      : (dy < 0 ? 'bottom' : 'top');
    return { touching: true, overlap: true, side: side };
  }

  // AABB overlap with an expansion tolerance — the preview's fallback
  // for overlapTouch when the physics module is missing.
  function aabbOverlapsTolerance(a, b, tol, hitbox) {
    var ab = hitbox(a), bb = hitbox(b);
    return ab.x - tol < bb.x + bb.width && ab.x + ab.width + tol > bb.x &&
           ab.y - tol < bb.y + bb.height && ab.y + ab.height + tol > bb.y;
  }

  function hitboxFn(ctx) {
    return function (obj) { return hitboxOf(ctx, obj); };
  }

  // --- Input conditions ---

  function keyCondition(ctx, data) {
    var mode = data.inputCondition || (data.trigger === 'pressed' ? 'keyJustPressed' : data.trigger === 'released' ? 'keyReleased' : 'keyPressed');
    var pass = false;
    var hasKey = function (set, key) {
      try { return !!(ctx.hasKey && ctx.hasKey(set, key)); } catch (e) { return false; }
    };
    if (mode === 'anyKeyPressed') pass = !!(ctx.keys && ctx.keys.size > 0);
    else if (mode === 'anyKeyJustPressed') pass = !!(ctx.keysJustPressed && ctx.keysJustPressed.size > 0);
    else if (mode === 'anyKeyReleased') pass = !!(ctx.keysJustReleased && ctx.keysJustReleased.size > 0);
    else if (mode === 'keyJustPressed') pass = hasKey(ctx.keysJustPressed, data.key);
    else if (mode === 'keyReleased') pass = hasKey(ctx.keysJustReleased, data.key);
    else pass = hasKey(ctx.keys, data.key);
    return res(data.reversed ? !pass : pass, { key: data.key, inputCondition: mode });
  }

  // Named input actions (P4 item 29): reads the per-frame action state
  // computed by HydraActions.update. Without the module or its state the
  // action reads as not pressed.
  function actionInputCondition(ctx, data) {
    var mode = data.inputCondition || 'actionHeld';
    var pass = false;
    var A = ctx.actions;
    var st = ctx.actionState;
    if (A && st) {
      try {
        if (mode === 'actionJustPressed') pass = A.actionJustPressed(st, data.actionName);
        else if (mode === 'actionReleased') pass = A.actionJustReleased(st, data.actionName);
        else pass = A.actionHeld(st, data.actionName);
      } catch (e) { pass = false; }
    }
    return res(data.reversed ? !pass : pass, { action: data.actionName, inputCondition: mode });
  }

  function mouseCondition(ctx, data) {
    var mode = data.mouseCondition || 'mouseButtonPressed';
    var source = mode === 'mouseButtonJustPressed' ? ctx.mouseJustPressed : mode === 'mouseButtonReleased' ? ctx.mouseJustReleased : ctx.mouseButtons;
    var button = 0;
    try { button = ctx.mouseButtonCode ? ctx.mouseButtonCode(data.button) : 0; } catch (e) { button = 0; }
    var pass = false;
    try {
      pass = data.button === 'any' ? (source && source.size > 0) : !!(source && source.has(button));
    } catch (e) { pass = false; }
    return res(data.reversed ? !pass : pass, { mouse: true });
  }

  // Mouse Over / Object Clicked: hit-test in the same space the object
  // is drawn in. Anchored objects resolve against the canvas; HUD/pinned
  // objects are screen space; everything else converts the mouse into
  // world coordinates (screen pixels shrink by the zoom).
  function pointObjectCondition(ctx, data, requireClick) {
    var button = 0;
    try { button = ctx.mouseButtonCode ? ctx.mouseButtonCode(data.button) : 0; } catch (e) { button = 0; }
    if (requireClick) {
      var pressed = false;
      try { pressed = !!(ctx.mouseJustPressed && ctx.mouseJustPressed.has(button)); } catch (e) { pressed = false; }
      if (!pressed) return res(data.reversed, { objectClicked: false });
    }
    var ui = ctx.ui || null;
    var mouse = { x: 0, y: 0 };
    try { if (ctx.mouse) { mouse.x = Number(ctx.mouse.x) || 0; mouse.y = Number(ctx.mouse.y) || 0; } } catch (e) { /* keep 0,0 */ }
    var cam = { x: 0, y: 0, zoom: 1 };
    try { if (ctx.camera) { cam.x = Number(ctx.camera.x) || 0; cam.y = Number(ctx.camera.y) || 0; cam.zoom = ctx.camera.zoom; } } catch (e) { /* keep defaults */ }
    var z = normalizeCameraZoom(cam.zoom);
    var cw = 0, ch = 0;
    try { cw = Number(ctx.canvasWidth) || 0; ch = Number(ctx.canvasHeight) || 0; } catch (e) { /* keep 0 */ }
    var matched = null;
    var pass = named(ctx, data.targetObject).some(function (obj) {
      var box = hitboxOf(ctx, obj);
      var p, bx = box.x, by = box.y;
      var anchored = false;
      try { anchored = !!(ui && isFn(ui.isAnchored) && ui.isAnchored(obj)); } catch (e) { anchored = false; }
      if (anchored) {
        var sp = { x: 0, y: 0 };
        try { sp = (ui.resolveWidgetPosition(obj, cw, ch)) || sp; } catch (e) { /* keep 0,0 */ }
        p = mouse;
        bx = (Number(sp.x) || 0) + (Number(obj.hitboxOffsetX) || 0);
        by = (Number(sp.y) || 0) + (Number(obj.hitboxOffsetY) || 0);
      } else {
        var hud = false;
        try { hud = !!(obj.uiPinned || (ui && isFn(ui.isHudObject) && ui.isHudObject(obj))); } catch (e) { hud = false; }
        if (hud) {
          p = mouse;
        } else {
          // Parallax (P4 Advanced batch 16): the object draws against
          // its parallax camera, so the hit test must use the same
          // camera or clicks land where the object used to be.
          var pc = cam;
          try {
            var PM = ctx.parallaxModule;
            if (PM && typeof PM.parallaxCamera === 'function') pc = PM.parallaxCamera(cam, obj) || cam;
          } catch (e) { pc = cam; }
          p = { x: mouse.x / z + pc.x, y: mouse.y / z + pc.y };
        }
      }
      var inside = p.x >= bx && p.x <= bx + box.width && p.y >= by && p.y <= by + box.height;
      if (inside) matched = obj;
      return inside;
    });
    return res(data.reversed ? !pass : pass, { obj1: matched, targetObject: data.targetObject });
  }

  // --- World-dependent conditions (all frozen while paused, above) ---

  // Collision: countTouchingEdges (default true) counts edges touching
  // within 3px as colliding; false requires real overlap. Shape-aware
  // (circles collide as circles) and gated by collision layers/masks.
  // The tolerance expands the shapes by tol/2 each so box/box pairs
  // match the old expand-one-box-by-tol math.
  function collisionCondition(ctx, data) {
    var countTouching = data.countTouchingEdges !== false;
    var tol = countTouching ? 3 : 0;
    var p2d = ctx.physics2d || null;
    var isCol = isCollisionObjectOf(ctx);
    var aList = named(ctx, data.object1).filter(isCol);
    var bList = named(ctx, data.object2).filter(isCol);
    var obj1 = null, obj2 = null, pass = false;
    outer:
    for (var i = 0; i < aList.length; i++) {
      for (var j = 0; j < bList.length; j++) {
        var a = aList[i], b = bList[j];
        if (a.id === b.id) continue;
        var hit = false;
        if (p2d) {
          try { hit = !!(p2d.canCollide(a, b) && p2d.pairOverlap(a, b, tol / 2)); } catch (e) { hit = false; }
        } else {
          // No physics module: the preview's legacy AABB contact test.
          try { hit = !!aabbContact(a, b, tol, hitboxFn(ctx)); } catch (e) { hit = false; }
        }
        if (hit) { obj1 = a; obj2 = b; pass = true; break outer; }
      }
    }
    return res(data.reversed ? !pass : pass, { colliding: pass, touching: pass, obj1: obj1, obj2: obj2, object1Name: data.object1, object2Name: data.object2 });
  }

  // Overlap/Touch: expanded-shape test with a configurable tolerance
  // (default 4px). Shape-aware and layer-gated; tol/2 per shape keeps
  // box/box pairs on the old expand-one-box math.
  function overlapTouchCondition(ctx, data) {
    var tol = data.tolerance == null ? 4 : data.tolerance;
    var p2d = ctx.physics2d || null;
    var isCol = isCollisionObjectOf(ctx);
    var aList = named(ctx, data.object1).filter(isCol);
    var bList = named(ctx, data.object2).filter(isCol);
    var obj1 = null, obj2 = null, pass = false;
    outer:
    for (var i = 0; i < aList.length; i++) {
      for (var j = 0; j < bList.length; j++) {
        var a = aList[i], b = bList[j];
        if (a.id === b.id) continue;
        var hit = false;
        if (p2d) {
          try { hit = !!(p2d.canCollide(a, b) && p2d.pairOverlap(a, b, tol / 2)); } catch (e) { hit = false; }
        } else {
          // No physics module: the preview's legacy expanded-AABB test.
          try { hit = aabbOverlapsTolerance(a, b, tol, hitboxFn(ctx)); } catch (e) { hit = false; }
        }
        if (hit) { obj1 = a; obj2 = b; pass = true; break outer; }
      }
    }
    return res(data.reversed ? !pass : pass, { touching: pass, obj1: obj1, obj2: obj2, object1Name: data.object1, object2Name: data.object2 });
  }

  // On Floor: tolerance 4px (0 when countTouchingEdges is explicitly
  // false) and the contact must be on the target's bottom side. Gated
  // by collision layers/masks when the physics module is present.
  function onFloorCondition(ctx, data) {
    var tol = data.countTouchingEdges === false ? 0 : 4;
    var p2d = ctx.physics2d || null;
    var isCol = isCollisionObjectOf(ctx);
    var target = null, floor = null, pass = false;
    named(ctx, data.targetObject).filter(isCol).forEach(function (a) {
      named(ctx, data.platformObject).filter(isCol).forEach(function (b) {
        if (p2d) {
          try { if (!p2d.canCollide(a, b)) return; } catch (e) { return; }
        }
        var contact = null;
        try { contact = aabbContact(a, b, tol, hitboxFn(ctx)); } catch (e) { contact = null; }
        if (contact && contact.side === 'bottom') { target = a; floor = b; pass = true; }
      });
    });
    return res(data.reversed ? !pass : pass, { onFloor: pass, obj1: target, obj2: floor, targetObject: data.targetObject, platformObject: data.platformObject });
  }

  // The platform hooks the HydraPlatform module needs, built from
  // this context's live objects + collision helpers (the same shape
  // the execute module's movementHooks builds for jumps). A throwing
  // hook degrades to the module's safe default.
  function platformHooks(ctx) {
    var list = [];
    try { list = allObjects(ctx); } catch (e) { list = []; }
    var p2d = ctx.physics2d || null;
    return {
      objects: list,
      hitbox: hitboxFn(ctx),
      isCollision: isCollisionObjectOf(ctx),
      isOneWay: function (o) {
        try {
          if (p2d && typeof p2d.isOneWay === 'function') return !!p2d.isOneWay(o);
        } catch (e) { /* fall through to the config */ }
        try {
          return !!(o && ((o.platform && o.platform.oneWay === true) ||
            (o.collision && o.collision.oneWay === true)));
        } catch (e) { return false; }
      }
    };
  }

  // The movement hooks the HydraMovement module needs, built from
  // this context's live objects + collision helpers (the same shape
  // the execute module's movementHooks builds for jumps). A throwing
  // hook degrades to the module's safe default.
  function movementHooks(ctx) {
    var list = [];
    try { list = allObjects(ctx); } catch (e) { list = []; }
    var p2d = ctx.physics2d || null;
    return {
      objects: list,
      hitbox: hitboxFn(ctx),
      isCollision: isCollisionObjectOf(ctx),
      canCollide: (p2d && typeof p2d.canCollide === 'function')
        ? function (a, b) { try { return p2d.canCollide(a, b); } catch (e) { return true; } }
        : null,
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
      keys: ctx.keys || null,
      hasKey: (typeof ctx.hasKey === 'function') ? ctx.hasKey : null
    };
  }

  // The raw wall-slide read, for a host that dropped the movement
  // module tag: the slide config straight off the object, the side
  // contact from the raw boxes, the press from the held-key set, and
  // the grounded check from the same bottom-on-top tolerance rule
  // the module uses (object floors plus the tile leg). A one-way
  // floor never blocks from the side and never counts as a floor
  // while the object rises through it.
  function rawWallSides(ctx, obj) {
    try {
      if (!obj || !obj.id) return [];
      var isCol = isCollisionObjectOf(ctx);
      if (!isCol(obj)) return [];
      var hb = hitboxFn(ctx);
      var ab = hb(obj);
      var tol = Math.max(5, Math.abs(Number(obj.velX) || 0) + 3);
      var p2d = ctx.physics2d || null;
      var sides = [];
      allObjects(ctx).forEach(function (other) {
        if (!other || other.id === obj.id || !isCol(other)) return;
        if (!(other.static || !other.physicsEnabled)) return;
        if (p2d && typeof p2d.canCollide === 'function') {
          try { if (!p2d.canCollide(obj, other)) return; } catch (e) { return; }
        }
        var oneWay = false;
        try {
          if (p2d && typeof p2d.isOneWay === 'function') oneWay = !!p2d.isOneWay(other);
          else oneWay = !!((other.platform && other.platform.oneWay === true) ||
            (other.collision && other.collision.oneWay === true));
        } catch (e) { oneWay = false; }
        if (oneWay) return;
        var bb = hb(other);
        var vertical = ab.y < bb.y + bb.height - 1 && ab.y + ab.height > bb.y + 1;
        if (!vertical) return;
        if (Math.abs(ab.x - (bb.x + bb.width)) <= tol && sides.indexOf('left') === -1) sides.push('left');
        if (Math.abs((ab.x + ab.width) - bb.x) <= tol && sides.indexOf('right') === -1) sides.push('right');
      });
      return sides;
    } catch (e) {
      return [];
    }
  }

  function rawWallSliding(ctx, obj) {
    try {
      if (!obj || !obj.id) return false;
      var maxFall = 0;
      try { if (obj.movement && isFinite(Number(obj.movement.wallSlideMaxFall))) maxFall = Number(obj.movement.wallSlideMaxFall); } catch (e) { maxFall = 0; }
      if (maxFall <= 0) return false;
      if (!(Number(obj.velY) > 0)) return false;
      var isCol = isCollisionObjectOf(ctx);
      if (!isCol(obj)) return false;
      var hb = hitboxFn(ctx);
      var ab = hb(obj);
      var bottom = ab.y + ab.height;
      var tol = Math.max(5, Math.abs(Number(obj.velY) || 0) + 3);
      var p2d = ctx.physics2d || null;
      var grounded = false;
      allObjects(ctx).some(function (other) {
        if (!other || other.id === obj.id || !isCol(other)) return false;
        if (!(other.static || !other.physicsEnabled)) return false;
        if (p2d && typeof p2d.canCollide === 'function') {
          try { if (!p2d.canCollide(obj, other)) return false; } catch (e) { return false; }
        }
        var oneWay = false;
        try {
          if (p2d && typeof p2d.isOneWay === 'function') oneWay = !!p2d.isOneWay(other);
          else oneWay = !!((other.platform && other.platform.oneWay === true) ||
            (other.collision && other.collision.oneWay === true));
        } catch (e) { oneWay = false; }
        if (oneWay && Number(obj.velY) < 0) return false;
        var bb = hb(other);
        var horizontal = ab.x < bb.x + bb.width - 1 && ab.x + ab.width > bb.x + 1;
        var vertical = bottom >= bb.y - tol && bottom <= bb.y + tol;
        if (horizontal && vertical) { grounded = true; return true; }
        return false;
      });
      if (!grounded && ctx.tiles && typeof ctx.tiles.isSolidAtPixel === 'function') {
        allObjects(ctx).some(function (tm) {
          if (!tm || tm.kind !== 'tilemap') return false;
          try {
            if (ctx.tiles.isSolidAtPixel(tm, ab.x + ab.width / 2, ab.y + ab.height + 1)) { grounded = true; return true; }
          } catch (e) { /* a throwing tile read is not a floor */ }
          return false;
        });
      }
      if (grounded) return false;
      var sides = rawWallSides(ctx, obj);
      if (!sides.length) return false;
      var hasKey = function (key) {
        try { return !!(ctx.hasKey && ctx.hasKey(ctx.keys, key)); } catch (e) { return false; }
      };
      var dir = ((hasKey('ArrowRight') || hasKey('KeyD')) ? 1 : 0) -
        ((hasKey('ArrowLeft') || hasKey('KeyA')) ? 1 : 0);
      if (dir < 0 && sides.indexOf('left') !== -1) return true;
      if (dir > 0 && sides.indexOf('right') !== -1) return true;
      return false;
    } catch (e) {
      return false;
    }
  }

  // The raw standing check, for a host that dropped the platform
  // module tag: the movement module's bottom-on-top tolerance rule,
  // read straight off the object's platform config (a moving
  // platform) or its one-way flag (a one-way floor). A parked
  // platform or a one-point path never counts, a crumbled platform
  // has its collision off so the filter excludes it, and a one-way
  // floor never counts while the object rises through it.
  function rawStandsOn(ctx, obj, floor, oneWayOnly) {
    try {
      if (!obj || !floor || obj.id === floor.id) return false;
      var isCol = isCollisionObjectOf(ctx);
      if (!isCol(obj) || !isCol(floor)) return false;
      var floorOneWay = false;
      try {
        var p2d = ctx.physics2d || null;
        if (p2d && typeof p2d.isOneWay === 'function') floorOneWay = !!p2d.isOneWay(floor);
        else floorOneWay = !!((floor.platform && floor.platform.oneWay === true) ||
          (floor.collision && floor.collision.oneWay === true));
      } catch (e) { floorOneWay = false; }
      if (oneWayOnly) {
        if (!floorOneWay) return false;
      } else {
        var cfg = null;
        try { cfg = floor.platform; } catch (e) { cfg = null; }
        if (!cfg || cfg.enabled !== true || !Array.isArray(cfg.points) || cfg.points.length < 2) return false;
        var sp = Number(cfg.speed);
        if (!isFinite(sp) || sp <= 0) return false;
      }
      var hb = hitboxFn(ctx);
      var ab = hb(obj), bb = hb(floor);
      var bottom = ab.y + ab.height;
      var tol = Math.max(5, Math.abs(Number(obj.velY) || 0) + 3);
      var horizontal = ab.x < bb.x + bb.width - 1 && ab.x + ab.width > bb.x + 1;
      var vertical = bottom >= bb.y - tol && bottom <= bb.y + tol;
      if (!horizontal || !vertical) return false;
      if (floorOneWay && (Number(obj.velY) || 0) < 0) return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  function tilemapsNamed(ctx, name) {
    return named(ctx, name).filter(function (o) { return o && o.kind === 'tilemap'; });
  }

  function tileSolidAtCondition(ctx, data) {
    var maps = tilemapsNamed(ctx, data.targetObject);
    var x = expr(ctx, data.x == null ? 0 : data.x), y = expr(ctx, data.y == null ? 0 : data.y);
    var pass = false;
    if (ctx.tiles) {
      try { pass = maps.some(function (tm) { return ctx.tiles.isSolidAtPixel(tm, x, y); }); } catch (e) { pass = false; }
    }
    return res(data.reversed ? !pass : pass, { tileSolidAt: true });
  }

  function standingOnTileCondition(ctx, data) {
    var maps = tilemapsNamed(ctx, data.tilemapName);
    var pass = false;
    if (ctx.tiles) {
      try {
        pass = named(ctx, data.targetObject).some(function (o) {
          var hb = hitboxOf(ctx, o);
          return maps.some(function (tm) { return ctx.tiles.isSolidAtPixel(tm, hb.x + hb.width / 2, hb.y + hb.height + 1); });
        });
      } catch (e) { pass = false; }
    }
    return res(data.reversed ? !pass : pass, { standingOnTile: true });
  }

  // Trigger Enter/Exit are edge-triggered: they fire only on the first
  // frame a trigger-zone/body pair starts (or stops) overlapping.
  function triggerPairCondition(ctx, data, entered) {
    var p2d = ctx.physics2d || null;
    var isCol = isCollisionObjectOf(ctx);
    var zones = named(ctx, data.zoneObject).filter(isCol);
    var targets = named(ctx, data.targetObject).filter(isCol);
    var keys = [];
    try { keys = entered ? (ctx.triggerEntered || []) : (ctx.triggerExited || []); } catch (e) { keys = []; }
    if (!Array.isArray(keys)) keys = [];
    var zone = null, obj = null, pass = false;
    if (p2d) {
      try {
        zones.some(function (z) {
          return targets.some(function (t) {
            if (z.id !== t.id && keys.indexOf(p2d.pairKey(z, t)) !== -1) {
              zone = z; obj = t; pass = true; return true;
            }
            return false;
          });
        });
      } catch (e) { pass = false; }
    }
    return res(data.reversed ? !pass : pass, { trigger: pass, zone: zone, obj: obj, zoneObject: data.zoneObject, targetObject: data.targetObject });
  }

  // Raycast Hit: cast a segment against every live collision object,
  // honoring a layer mask (default: all layers). Reports the closest hit.
  function raycastHitCondition(ctx, data) {
    var p2d = ctx.physics2d || null;
    var x1 = expr(ctx, data.fromX == null ? 0 : data.fromX), y1 = expr(ctx, data.fromY == null ? 0 : data.fromY);
    var x2 = expr(ctx, data.toX == null ? 0 : data.toX), y2 = expr(ctx, data.toY == null ? 0 : data.toY);
    var mask = data.layerMask == null ? (p2d ? p2d.ALL_MASK : 255) : Math.floor(Number(data.layerMask));
    var objects = allObjects(ctx).filter(isCollisionObjectOf(ctx));
    var hit = null;
    if (p2d) {
      try { hit = p2d.raycast(objects, x1, y1, x2, y2, mask); } catch (e) { hit = null; }
    }
    var pass = !!hit;
    return res(data.reversed ? !pass : pass, {
      raycastHit: pass,
      hitX: hit ? hit.x : null, hitY: hit ? hit.y : null,
      hitObject: hit && hit.object ? hit.object.name : null
    });
  }

  // Objects Overlapping: true when any live collision object
  // (layer-mask filtered) overlaps the probe circle at (x, y) with the
  // given radius.
  function overlapCheckCondition(ctx, data) {
    var p2d = ctx.physics2d || null;
    var x = expr(ctx, data.x == null ? 0 : data.x), y = expr(ctx, data.y == null ? 0 : data.y);
    var r = Math.max(0, expr(ctx, data.radius == null ? 24 : data.radius));
    var mask = data.layerMask == null ? (p2d ? p2d.ALL_MASK : 255) : Math.floor(Number(data.layerMask));
    var objects = allObjects(ctx).filter(isCollisionObjectOf(ctx));
    var hits = [];
    if (p2d) {
      try { hits = p2d.overlapCircle(objects, x, y, r, mask) || []; } catch (e) { hits = []; }
    }
    var pass = hits.length > 0;
    return res(data.reversed ? !pass : pass, { overlapCheck: pass, count: hits.length, obj1: hits[0] || null });
  }

  // --- Physics queries (P4 item 37 batch 8): object-to-object spatial
  // questions answered by the shared HydraPhysics2D query helpers.
  // Never throw; corrupt data stays quiet. Line of Sight excludes the
  // two endpoints' own colliders so an enemy always "sees" the object
  // it is watching from. ---

  function angleBetweenCondition(ctx, data) {
    var p2d = ctx.physics2d || null;
    var target = expr(ctx, data.value == null ? 0 : data.value);
    var pass = false, angle = 0, obj1 = null, obj2 = null;
    var list1 = named(ctx, data.object1), list2 = named(ctx, data.object2);
    outer:
    for (var i = 0; i < list1.length; i++) {
      for (var j = 0; j < list2.length; j++) {
        var a = list1[i], b = list2[j];
        if (a.id === b.id) continue;
        var next = 0;
        try { next = p2d ? p2d.angleBetweenObjects(a, b) : 0; } catch (e) { next = 0; }
        if (compare(next, data.operator || '>=', target)) { pass = true; angle = next; obj1 = a; obj2 = b; break outer; }
      }
    }
    return res(data.reversed ? !pass : pass, { angleBetween: pass, angle: angle, obj1: obj1, obj2: obj2 });
  }

  function lineOfSightCondition(ctx, data) {
    var p2d = ctx.physics2d || null;
    var mask = data.layerMask == null ? (p2d ? p2d.ALL_MASK : 255) : Math.floor(Number(data.layerMask));
    var pass = false, obj1 = null, obj2 = null, blocker = null;
    var list1 = named(ctx, data.object1), list2 = named(ctx, data.object2);
    var colliders = allObjects(ctx).filter(isCollisionObjectOf(ctx));
    outer:
    for (var i = 0; i < list1.length; i++) {
      var a = list1[i];
      var ca = { x: 0, y: 0 };
      try { ca = p2d ? p2d.objectCenter(a) : { x: 0, y: 0 }; } catch (e) { ca = { x: 0, y: 0 }; }
      for (var j = 0; j < list2.length; j++) {
        var b = list2[j];
        if (a.id === b.id) continue;
        var cb = { x: 0, y: 0 };
        try { cb = p2d ? p2d.objectCenter(b) : { x: 0, y: 0 }; } catch (e) { cb = { x: 0, y: 0 }; }
        var near = colliders.filter(function (o) { return o.id !== a.id && o.id !== b.id; });
        var hit = null;
        if (p2d) {
          try { hit = p2d.raycast(near, ca.x, ca.y, cb.x, cb.y, mask); } catch (e) { hit = null; }
        }
        if (!hit) { pass = true; obj1 = a; obj2 = b; break outer; }
        blocker = hit.object || null;
      }
    }
    return res(data.reversed ? !pass : pass, { lineOfSight: pass, obj1: obj1, obj2: obj2, blocker: blocker });
  }

  function nearestDistanceCondition(ctx, data) {
    var p2d = ctx.physics2d || null;
    var threshold = expr(ctx, data.value == null ? 0 : data.value);
    var pass = false, distance = Infinity, obj1 = null, nearest = null;
    var list1 = named(ctx, data.object1), targets = named(ctx, data.targetObject);
    for (var i = 0; i < list1.length; i++) {
      for (var j = 0; j < targets.length; j++) {
        var a = list1[i], b = targets[j];
        if (a.id === b.id) continue;
        var d = Infinity;
        try { d = p2d ? p2d.distanceBetweenObjects(a, b) : Infinity; } catch (e) { d = Infinity; }
        if (d < distance) { distance = d; obj1 = a; nearest = b; }
        if (compare(d, data.operator || '<=', threshold)) pass = true;
      }
      if (pass) break;
    }
    return res(data.reversed ? !pass : pass, { nearestDistance: pass, distance: distance, obj1: obj1, nearest: nearest });
  }

  function movingTowardsCondition(ctx, data) {
    var p2d = ctx.physics2d || null;
    var minSpeed = expr(ctx, data.minSpeed == null ? 1 : data.minSpeed);
    var pass = false, obj1 = null, obj2 = null;
    var list1 = named(ctx, data.object1), list2 = named(ctx, data.object2);
    outer:
    for (var i = 0; i < list1.length; i++) {
      for (var j = 0; j < list2.length; j++) {
        var a = list1[i], b = list2[j];
        if (a.id === b.id) continue;
        var moving = false;
        try { moving = !!(p2d && p2d.movingTowards(a, b, minSpeed)); } catch (e) { moving = false; }
        if (moving) { pass = true; obj1 = a; obj2 = b; break outer; }
      }
    }
    return res(data.reversed ? !pass : pass, { movingTowards: pass, obj1: obj1, obj2: obj2 });
  }

  // --- Text, distance, property, velocity (state reads, never
  // world-dependent in the pause sense — positions are frozen, so they
  // evaluate normally while paused) ---

  // Compares the displayed text of text objects (_runtimeText override
  // wins, like the draw path); non-text objects never match. Unknown
  // operators behave as equals — corrupt data never throws.
  function textCheckCondition(ctx, data) {
    var value = String(data.value == null ? '' : data.value);
    var pass = false, matched = null;
    named(ctx, data.targetObject).forEach(function (o) {
      if (o.kind !== 'text') return;
      var text = o._runtimeText !== undefined ? o._runtimeText : (o.text || '');
      var ok;
      switch (data.operator) {
        case 'notEquals': ok = text !== value; break;
        case 'contains': ok = text.includes(value); break;
        case 'startsWith': ok = text.startsWith(value); break;
        case 'endsWith': ok = text.endsWith(value); break;
        case 'isEmpty': ok = text.length === 0; break;
        default: ok = text === value; // 'equals' + corrupt operators
      }
      if (ok) { pass = true; matched = matched || o; }
    });
    return res(data.reversed ? !pass : pass, { obj1: matched, targetObject: data.targetObject });
  }

  // Distance between object centers (raw position centers, not hitbox
  // centers). The context reports the last passing pair.
  function distanceCondition(ctx, data) {
    var threshold = expr(ctx, data.distance == null ? 0 : data.distance);
    var pass = false, obj1 = null, obj2 = null, distance = Infinity;
    named(ctx, data.object1).forEach(function (a) {
      named(ctx, data.object2).forEach(function (b) {
        if (a.id === b.id) return;
        var d = Math.hypot((a.posX + a.width / 2) - (b.posX + b.width / 2), (a.posY + a.height / 2) - (b.posY + b.height / 2));
        if (d < distance) distance = d;
        if (compare(d, data.operator || '<=', threshold)) { pass = true; obj1 = a; obj2 = b; }
      });
    });
    return res(data.reversed ? !pass : pass, { distance: distance, obj1: obj1, obj2: obj2 });
  }

  function propertyCondition(ctx, data, prop) {
    var value = expr(ctx, data.value == null ? 0 : data.value);
    var matched = null;
    var pass = named(ctx, data.targetObject).some(function (obj) {
      // 'textLength' is a derived property — the length of the object's
      // displayed text (_runtimeText override wins, like drawing).
      var checked = prop === 'textLength'
        ? String(obj._runtimeText !== undefined ? obj._runtimeText : (obj.text || '')).length
        : (obj[prop] == null ? 0 : obj[prop]);
      var ok = compare(checked, data.operator || '>=', value);
      if (ok) matched = obj;
      return ok;
    });
    return res(data.reversed ? !pass : pass, { obj1: matched, targetObject: data.targetObject });
  }

  function velocityCondition(ctx, data) {
    var value = expr(ctx, data.value == null ? 0 : data.value);
    var matched = null, checked = 0;
    var pass = named(ctx, data.targetObject).some(function (obj) {
      checked = data.component === 'x' ? (obj.velX || 0) : data.component === 'y' ? (obj.velY || 0) : Math.hypot(obj.velX || 0, obj.velY || 0);
      var ok = compare(checked, data.operator || '>=', value);
      if (ok) matched = obj;
      return ok;
    });
    return res(data.reversed ? !pass : pass, { obj1: matched, value: checked });
  }

  // --- Timers ---

  function timerKey(scopeKey, idx, data) {
    var name = String(data.timerName || data.name || '').trim();
    return name ? 'named:' + name : 'cell:' + scopeKey + ':' + idx;
  }

  function getTimerRecord(ctx, key, now, interval) {
    var timers = ctx.timers || null;
    var existing = null;
    try { existing = timers ? timers.get(key) : null; } catch (e) { existing = null; }
    if (existing && typeof existing === 'object') return existing;
    var record = {
      // A legacy numeric record holds its last-fired time directly.
      lastFiredTime: typeof existing === 'number' ? existing : now - interval,
      paused: false,
      pausedAt: 0,
      firedFrame: -1
    };
    try { if (timers && isFn(timers.set)) timers.set(key, record); } catch (e) { /* a bad timers map never breaks the frame */ }
    return record;
  }

  function timerElapsedSeconds(ctx, key, now) {
    try {
      var v = Number(ctx.timerElapsedSeconds(key, now));
      return Number.isFinite(v) ? v : 0;
    } catch (e) { return 0; }
  }

  // F4 pause: the game clock freezes while paused, so timers hold their
  // elapsed time and resume where they left off; a timer never fires on
  // a paused frame.
  function timerCondition(ctx, data, scopeKey, idx) {
    var name = String(data.timerName || '').trim();
    var key = name ? 'named:' + name : 'cell:' + scopeKey + ':' + idx;
    if (isPaused(ctx)) return res(!!data.reversed, { timer: true, timerName: name, elapsed: 0 });
    var now = nowMs(ctx);
    var interval = Math.max(0.001, expr(ctx, data.interval == null ? 1 : data.interval)) * 1000;
    var record = getTimerRecord(ctx, key, now, interval);
    var elapsed = record.paused ? (record.pausedAt || now) - record.lastFiredTime : now - record.lastFiredTime;
    var fired = record.firedFrame === ctx.frameId;
    if (!record.paused && elapsed >= interval) {
      fired = true;
      record.lastFiredTime = now;
      record.firedFrame = ctx.frameId;
    }
    return res(data.reversed ? !fired : fired, { timer: true, timerName: name, elapsed: elapsed / 1000 });
  }

  // Timer Elapsed: state read over a named timer's elapsed seconds —
  // frozen-clock read like timerCondition, but never creates or fires
  // the timer.
  function timerElapsedCondition(ctx, data, scopeKey, idx) {
    var key = timerKey(scopeKey, idx, data);
    var elapsed = timerElapsedSeconds(ctx, key, nowMs(ctx));
    var seconds = expr(ctx, data.seconds == null ? 5 : data.seconds);
    var pass = compare(elapsed, data.operator || '>=', seconds);
    return res(data.reversed ? !pass : pass, { timerElapsed: true, timerName: String(data.timerName || data.name || '').trim(), elapsed: elapsed });
  }

  function edgeCondition(ctx, data) {
    var size = null;
    try { size = ctx.worldSize(); } catch (e) { size = null; }
    if (!size) return res(false);
    var w = Number(size.width) || 0, h = Number(size.height) || 0;
    var pass = false;
    var edge = data.edge || 'any';
    named(ctx, data.targetObject).forEach(function (obj) {
      var box = hitboxOf(ctx, obj);
      if (edge === 'left' || edge === 'any') pass = pass || box.x <= 0;
      if (edge === 'right' || edge === 'any') pass = pass || box.x + box.width >= w;
      if (edge === 'top' || edge === 'any') pass = pass || box.y <= 0;
      if (edge === 'bottom' || edge === 'any') pass = pass || box.y + box.height >= h;
    });
    return res(data.reversed ? !pass : pass, { edge: true });
  }

  // --- Deferred conditions (pass 2: they read the contexts pass 1 wrote) ---

  function onceCondition(ctx, data, scopeKey, idx) {
    var key = scopeKey + ':' + idx;
    var fired = false;
    try { fired = !!(ctx.once && ctx.once.has(key)); } catch (e) { fired = false; }
    var contexts = adjacentContexts(ctx, scopeKey, idx);
    var gated = contexts.length > 0;
    var pass = data.reversed ? fired : (!fired && (gated ? contexts.some(Boolean) : true));
    if (pass && !data.reversed) {
      try { if (ctx.once && isFn(ctx.once.add)) ctx.once.add(key); } catch (e) { /* a bad once set never breaks the frame */ }
    }
    var merged = { once: true, gated: gated };
    contexts.forEach(function (c) { Object.assign(merged, c); });
    return res(pass, merged);
  }

  function andCondition(ctx, data, scopeKey, idx) {
    var contexts = adjacentContexts(ctx, scopeKey, idx);
    var pass = (data.logic || 'and') === 'or' ? contexts.length >= 1 : contexts.length >= 2;
    var merged = { andGroup: true };
    contexts.forEach(function (c) { Object.assign(merged, c); });
    return res(pass, merged);
  }

  // --- Subsystem delegations (each returns { pass, context }; a missing
  // module or a missing hook builder reads as not passing) ---

  function subsystemHooks(ctx, name) {
    try {
      var fn = ctx[name];
      if (!isFn(fn)) return null;
      var h = fn();
      return h && typeof h === 'object' ? h : null;
    } catch (e) { return null; }
  }

  // The subsystem's eval method takes its own arguments followed by
  // the hooks object (collections: (variables, data, hooks); the rest:
  // (data, hooks)). `args` holds the method's own arguments; the hooks
  // are appended.
  function subsystemCondition(ctx, module, hooksName, method, args) {
    if (!module || !isFn(module[method])) return res(false);
    var hooks = subsystemHooks(ctx, hooksName);
    if (!hooks) return res(false);
    var r = null;
    try { r = module[method].apply(null, (args || []).concat([hooks])); } catch (e) { return res(false); }
    if (!r || typeof r !== 'object') return res(false);
    return { pass: !!r.pass, context: (r.context && typeof r.context === 'object') ? r.context : {} };
  }

  function applyReversed(data, evaluated) {
    return res(data.reversed ? !evaluated.pass : evaluated.pass, evaluated.context);
  }

  // --- Camera / cursor / touch / gamepad (state reads) ---

  function cameraPositionCondition(ctx, data) {
    var camera = { x: 0, y: 0, zoom: 1 };
    try { if (ctx.camera) { camera.x = Number(ctx.camera.x) || 0; camera.y = Number(ctx.camera.y) || 0; camera.zoom = ctx.camera.zoom; } } catch (e) { /* keep defaults */ }
    var prop = data.property || 'cameraX';
    var value = prop === 'zoom'
      ? normalizeCameraZoom(camera.zoom)
      : (camera[prop === 'cameraY' ? 'y' : 'x'] || 0);
    var pass = compare(value, data.operator || '>=', expr(ctx, data.value == null ? 0 : data.value));
    return res(data.reversed ? !pass : pass, { camera: true });
  }

  function cursorPositionCondition(ctx, data) {
    var mouse = { x: 0, y: 0 };
    try { if (ctx.mouse) { mouse.x = Number(ctx.mouse.x) || 0; mouse.y = Number(ctx.mouse.y) || 0; } } catch (e) { /* keep 0,0 */ }
    var value = (data.property || 'cursorX') === 'cursorY' ? (mouse.y || 0) : (mouse.x || 0);
    var pass = compare(value, data.operator || '>=', expr(ctx, data.value == null ? 0 : data.value));
    return res(data.reversed ? !pass : pass, { cursor: true });
  }

  function touchCountCondition(ctx, data) {
    var pass = compare(ctx.touchCount || 0, data.operator || '>=', expr(ctx, data.value == null ? 0 : data.value));
    return res(data.reversed ? !pass : pass, { touch: true });
  }

  function gamepadButtonCondition(ctx, data) {
    var when = data.when || 'held';
    var source = when === 'justPressed' ? ctx.gamepadJustPressed : when === 'released' ? ctx.gamepadJustReleased : ctx.gamepadButtons;
    var button = Math.max(0, Math.min(15, Math.floor(Number(data.button) || 0)));
    var pass = false;
    try { pass = !!(source && isFn(source.has) && source.has(button)); } catch (e) { pass = false; }
    return res(data.reversed ? !pass : pass, { gamepad: true, button: button });
  }

  function gamepadStickCondition(ctx, data) {
    var axes = ctx.gamepadAxes || { lx: 0, ly: 0, rx: 0, ry: 0 };
    var key = (data.stick === 'right' ? 'r' : 'l') + (data.axis === 'y' ? 'y' : 'x');
    var value = Number(axes[key]) || 0;
    var pass = compare(value, data.operator || '>', expr(ctx, data.value == null ? 0.2 : data.value));
    return res(data.reversed ? !pass : pass, { gamepad: true, stick: data.stick || 'left' });
  }

  // --- The switch ---

  function evaluateInner(data, ctx, scope, idx) {
    var scopeKey = scopeKeyOf(ctx, scope);
    var type = data && data.type;
    if (typeof type !== 'string') return res(false);

    // World-dependent conditions report the pause freeze instead of
    // stale state: they do not fire while paused, and a reversed one
    // passes. The context names the frozen condition.
    if (FROZEN_WHILE_PAUSED.indexOf(type) !== -1 && isPaused(ctx)) {
      var frozen = {};
      frozen[type] = false;
      return res(!!data.reversed, frozen);
    }

    switch (type) {
      case 'gameStart': {
        var started = false;
        try { started = !!(ctx.startedScopes && ctx.startedScopes.has(scopeKey)); } catch (e) { started = false; }
        return res(data.reversed ? started : !started, { gameStart: true });
      }
      // P5 core-engine track, item P5-4 (Control flow + events,
      // slice c): custom events. On Event polls the run's event
      // state through the HydraEvents module: true exactly once per
      // broadcast of its name (the poll records the count it saw,
      // so a second evaluation with no new broadcast stays quiet).
      // A blank name never fires; a missing module or state reads
      // false, never throws. The context names the event and how
      // many times it has been broadcast, so the and/once merge can
      // see it like any other condition's context.
      case 'onCustomEvent': {
        var evName = '';
        try {
          evName = (ctx.eventsModule && typeof ctx.eventsModule.normalizeEventName === 'function')
            ? ctx.eventsModule.normalizeEventName(data.eventName)
            : String(data.eventName || '').trim();
        } catch (e) { evName = ''; }
        var evFired = false;
        var evCount = 0;
        try {
          var EM = ctx.eventsModule;
          if (EM && typeof EM.pollEvent === 'function') evFired = !!EM.pollEvent(ctx.events, evName, scopeKey + ':' + idx);
          if (EM && typeof EM.eventCount === 'function') evCount = EM.eventCount(ctx.events, evName);
        } catch (e) { evFired = false; }
        return res(data.reversed ? !evFired : evFired, { event: evName, count: evCount });
      }
      case 'always': return res(true, { always: true });
      case 'keyJustPressed': {
        var pressed = false;
        try { pressed = !!(ctx.hasKey && ctx.hasKey(ctx.keysJustPressed, data.key)); } catch (e) { pressed = false; }
        return res(data.reversed ? !pressed : pressed, { key: data.key });
      }
      case 'keyPressed': return keyCondition(ctx, data);
      case 'actionInput': return actionInputCondition(ctx, data);
      case 'mouseClick': return mouseCondition(ctx, data);
      case 'mouseOverObject': return pointObjectCondition(ctx, data, false);
      case 'objectClicked': return pointObjectCondition(ctx, data, true);
      case 'getVariable': {
        var vars = ctx.variables || {};
        var val = vars[data.varName];
        if (val === undefined || val === null) val = 0;
        var passVar = compare(val, data.operator, expr(ctx, data.compareValue == null ? 0 : data.compareValue));
        return res(data.reversed ? !passVar : passVar, { variable: data.varName, value: val });
      }
      case 'collision': return collisionCondition(ctx, data);
      case 'overlapTouch': return overlapTouchCondition(ctx, data);
      case 'onFloor': return onFloorCondition(ctx, data);
      case 'distanceCheck': return distanceCondition(ctx, data);
      case 'angleBetween': return angleBetweenCondition(ctx, data);
      case 'lineOfSight': return lineOfSightCondition(ctx, data);
      case 'nearestDistance': return nearestDistanceCondition(ctx, data);
      case 'movingTowards': return movingTowardsCondition(ctx, data);
      case 'positionCheck': return propertyCondition(ctx, data, data.property || 'posY');
      case 'velocityCheck': return velocityCondition(ctx, data);
      case 'objectVisible': {
        var targets = named(ctx, data.targetObject);
        var visibleObj = null;
        try {
          visibleObj = targets.find(function (o) { return !(ctx.hidden && ctx.hidden.has(o.id)); }) || null;
        } catch (e) { visibleObj = null; }
        return res(data.reversed ? !visibleObj : Boolean(visibleObj), { obj1: visibleObj, targetObject: data.targetObject });
      }
      case 'objectCount': {
        var count = named(ctx, data.targetObject).length;
        var passCount = compare(count, data.operator || '==', expr(ctx, data.count == null ? 0 : data.count));
        return res(data.reversed ? !passCount : passCount, { count: count, targetObject: data.targetObject });
      }
      case 'chance': {
        var percent = clamp(expr(ctx, data.percent == null ? 0 : data.percent), 0, 100);
        var roll = (isFn(ctx.random) ? ctx.random() : Math.random()) * 100;
        var passChance = roll < percent;
        return res(data.reversed ? !passChance : passChance, { chance: percent });
      }
      case 'onTimer': return timerCondition(ctx, data, scopeKey, idx);
      case 'timerElapsed': return timerElapsedCondition(ctx, data, scopeKey, idx);
      case 'onEdge': return edgeCondition(ctx, data);
      case 'triggerOnce': return onceCondition(ctx, data, scopeKey, idx);
      case 'and': return andCondition(ctx, data, scopeKey, idx);
      case 'animationFinished': {
        var finishedTargets = named(ctx, data.targetObject);
        var finishedObj = null;
        if (ctx.anim) {
          try { finishedObj = finishedTargets.find(function (o) { return ctx.anim.isFinished(o._anim, data.animation); }) || null; } catch (e) { finishedObj = null; }
        }
        var passAnim = data.reversed ? !finishedObj : Boolean(finishedObj);
        return res(passAnim, { animationFinished: true, targetObject: data.targetObject, obj1: finishedObj });
      }
      case 'animStateIs': {
        var smTargets = named(ctx, data.targetObject);
        var wantSm = String(data.state || '').trim();
        var smObj = null;
        if (ctx.stateMachine && wantSm) {
          try { smObj = smTargets.find(function (o) { return ctx.stateMachine.currentState(o._sm) === wantSm; }) || null; } catch (e) { smObj = null; }
        }
        var passSm = data.reversed ? !smObj : Boolean(smObj);
        return res(passSm, { animStateIs: true, targetObject: data.targetObject, obj1: smObj });
      }
      case 'blendActive': {
        var bsTargets = named(ctx, data.targetObject);
        var wantBs = String(data.blend || '').trim();
        var bsObj = null;
        if (ctx.blendSpace && wantBs) {
          try { bsObj = bsTargets.find(function (o) { return ctx.blendSpace.isBlendActive(o._blends, wantBs); }) || null; } catch (e) { bsObj = null; }
        }
        var passBs = data.reversed ? !bsObj : Boolean(bsObj);
        return res(passBs, { blendActive: true, targetObject: data.targetObject, obj1: bsObj });
      }
      case 'tweenFinished': {
        var tweenTargets = named(ctx, data.targetObject);
        var tweenObj = null;
        if (ctx.tween) {
          try { tweenObj = tweenTargets.find(function (o) { return ctx.tween.isFinished(null, o, data.property); }) || null; } catch (e) { tweenObj = null; }
        }
        var passTween = data.reversed ? !tweenObj : Boolean(tweenObj);
        return res(passTween, { tweenFinished: true, targetObject: data.targetObject, obj1: tweenObj });
      }
      case 'saveSlotExists': {
        var passSave = false;
        if (ctx.save) {
          try { passSave = ctx.save.slotExists(ctx.save.safeStorage(), data.slotName); } catch (e) { passSave = false; }
        }
        return res(data.reversed ? !passSave : passSave, { saveSlotExists: true, slotName: data.slotName });
      }
      case 'gamePaused': {
        var passPaused = isPaused(ctx);
        return res(data.reversed ? !passPaused : passPaused, { gamePaused: true });
      }
      case 'profilerVisible': {
        var passProf = false;
        try { passProf = !!(ctx.profilerVisible && ctx.profilerVisible()); } catch (e) { passProf = false; }
        return res(data.reversed ? !passProf : passProf, { profilerVisible: true });
      }
      case 'scriptCheck': {
        var passScript = false;
        if (ctx.scriptApi && isFn(ctx.scriptApi.evalCondition)) {
          var apiHooks = subsystemHooks(ctx, 'scriptApiHooks');
          if (apiHooks) {
            try { passScript = ctx.scriptApi.evalCondition(apiHooks, data.code); } catch (e) { passScript = false; }
          }
        }
        return res(data.reversed ? !passScript : passScript, { scriptCheck: true });
      }
      case 'tileSolidAt': return tileSolidAtCondition(ctx, data);
      case 'standingOnTile': return standingOnTileCondition(ctx, data);
      case 'triggerEnter': return triggerPairCondition(ctx, data, true);
      case 'triggerExit': return triggerPairCondition(ctx, data, false);
      case 'raycastHit': return raycastHitCondition(ctx, data);
      case 'overlapCheck': return overlapCheckCondition(ctx, data);
      case 'textCheck': return textCheckCondition(ctx, data);
      case 'musicPlaying': {
        var held = (ctx.musicCount || 0) > 0;
        var passMusic = held && !ctx.musicPaused;
        return res(data.reversed ? !passMusic : passMusic, { musicPlaying: passMusic });
      }
      case 'cameraPosition': return cameraPositionCondition(ctx, data);
      case 'cursorPosition': return cursorPositionCondition(ctx, data);
      case 'anyKeyPressed': {
        var anyDown = false;
        try { anyDown = !!(ctx.keys && ctx.keys.size > 0); } catch (e) { anyDown = false; }
        return res(data.reversed ? !anyDown : anyDown, { anyKey: true });
      }
      case 'touchActive': {
        var active = (ctx.touchCount || 0) > 0;
        return res(data.reversed ? !active : active, { touch: true });
      }
      case 'touchCount': return touchCountCondition(ctx, data);
      case 'gamepadConnected':
        return res(data.reversed ? !ctx.gamepadConnected : !!ctx.gamepadConnected, { gamepad: true });
      case 'gamepadButton': return gamepadButtonCondition(ctx, data);
      case 'gamepadStick': return gamepadStickCondition(ctx, data);
      case 'arrayLength':
      case 'arrayContains':
      case 'structHasField':
        return applyReversed(data, subsystemCondition(ctx, ctx.collections, 'collectionHooks', 'evalCollectionCondition', [ctx.variables, data]));
      case 'numberInRange':
        return applyReversed(data, subsystemCondition(ctx, ctx.math, 'mathHooks', 'evalMathCondition', [data]));
      case 'pickNearest':
      case 'pickFarthest':
      case 'pickRandom':
        return applyReversed(data, subsystemCondition(ctx, ctx.pick, 'pickHooks', 'evalPickCondition', [data]));
      case 'pickNearestTagged':
      case 'pickFarthestTagged':
      case 'pickRandomTagged':
        return applyReversed(data, subsystemCondition(ctx, ctx.pick, 'pickHooks', 'evalPickTaggedCondition', [data]));
      case 'layerCheck':
        return applyReversed(data, subsystemCondition(ctx, ctx.layerFx, 'layerFxConditionHooks', 'evalLayerFxCondition', [data]));
      case 'distance3d':
      case 'mousePointerCaptured':
      case 'onGround3d':
      case 'collision3d':
        return applyReversed(data, subsystemCondition(ctx, ctx.threeD, 'threeDConditionHooks', 'eval3dCondition', [data]));
      case 'darknessLevel':
        return applyReversed(data, subsystemCondition(ctx, ctx.light2d, 'light2dConditionHooks', 'evalLight2dCondition', [data]));
      case 'jointConnected':
        return applyReversed(data, subsystemCondition(ctx, ctx.joints, 'jointConditionHooks', 'evalJointCondition', [data]));
      case 'skeletonPlaying': {
        var skTargets = named(ctx, data.object1 || '');
        var wantSk = String(data.animation || '').trim();
        var skObj = null;
        if (ctx.skeleton && wantSk) {
          try { skObj = skTargets.find(function (o) { return ctx.skeleton.isSkeletonActive(o._skel, wantSk); }) || null; } catch (e) { skObj = null; }
        }
        var passSk = data.reversed ? !skObj : Boolean(skObj);
        return res(passSk, { skeletonPlaying: true, targetObject: data.object1, obj1: skObj });
      }
      case 'languageIs': {
        var wantLang = String(data.language || '').trim();
        var passLang = wantLang ? (ctx.language === wantLang) : false;
        return res(data.reversed ? !passLang : passLang, { languageIs: true, language: ctx.language });
      }
      case 'dialogueActive': {
        var passDlg = !!(ctx.dialogue && ctx.dialogue.active);
        return res(data.reversed ? !passDlg : passDlg, { dialogueActive: passDlg });
      }
      case 'dialogueWaitingChoice': {
        var passWait = !!(ctx.dialogue && ctx.dialogue.active && ctx.dialogue.waitingChoice);
        return res(data.reversed ? !passWait : passWait, { dialogueWaitingChoice: passWait });
      }
      case 'dialogueChoiceAvailable': {
        // True while the dialogue waits for a pick AND the numbered
        // option (1-based) exists on the current line. Reads the live
        // runtime directly, like languageIs reads ctx.language — no
        // subsystem call, so a missing dialogue just reads false.
        var optNum = Number(data.option);
        var avail = false;
        try {
          var drt = ctx.dialogue;
          if (drt && drt.active && drt.waitingChoice && drt.dialogue && Array.isArray(drt.dialogue.lines)) {
            var dline = drt.dialogue.lines[drt.lineIndex];
            var dchoices = (dline && Array.isArray(dline.choices)) ? dline.choices : [];
            avail = Number.isInteger(optNum) && optNum >= 1 && optNum <= dchoices.length;
          }
        } catch (e) { avail = false; }
        return res(data.reversed ? !avail : avail, { dialogueChoiceAvailable: avail, option: optNum });
      }
      case 'hasItem': {
        // True while the backpack holds at least `count` of the named
        // item (default 1). Reads the live counts directly, like
        // languageIs reads ctx.language — no subsystem call, so a
        // missing inventory just reads false. An item the backpack
        // never held (or never defined) reads false, never warns.
        var wantItem = String(data.item || '').trim();
        var needCount = 1;
        try {
          var rawNeed = ctx.expr ? ctx.expr(data.count) : Number(data.count);
          if (isFinite(rawNeed) && Math.floor(rawNeed) >= 1) needCount = Math.floor(rawNeed);
        } catch (e) { needCount = 1; }
        var held = 0;
        try {
          var counts = ctx.inventory && ctx.inventory.counts;
          var rawHeld = counts ? counts[wantItem] : undefined;
          held = (isFinite(Number(rawHeld)) && Number(rawHeld) > 0) ? Math.floor(Number(rawHeld)) : 0;
        } catch (e) { held = 0; }
        var passHas = wantItem ? held >= needCount : false;
        return res(data.reversed ? !passHas : passHas, { hasItem: passHas, item: wantItem, count: held });
      }
      case 'itemCount': {
        // True while the named item's count compares against the value
        // (Timer Elapsed shape: operator + expression value). An item
        // the backpack never held reads as 0, like a never-started
        // timer reading 0 seconds — the comparison still runs.
        var wantItem2 = String(data.item || '').trim();
        var held2 = 0;
        try {
          var counts2 = ctx.inventory && ctx.inventory.counts;
          var rawHeld2 = counts2 ? counts2[wantItem2] : undefined;
          held2 = (isFinite(Number(rawHeld2)) && Number(rawHeld2) > 0) ? Math.floor(Number(rawHeld2)) : 0;
        } catch (e) { held2 = 0; }
        var value2 = 0;
        try { value2 = ctx.expr ? ctx.expr(data.value) : Number(data.value); } catch (e) { value2 = 0; }
        if (!isFinite(value2)) value2 = 0;
        var passCount = wantItem2 ? compare(held2, data.operator, value2) : false;
        return res(data.reversed ? !passCount : passCount, { itemCount: passCount, item: wantItem2, count: held2 });
      }
      case 'questComplete': {
        // True while the named quest is complete. Reads the done flag
        // on the live quest log directly, like hasItem reads the live
        // counts — no subsystem call, so a missing log just reads
        // false. An unknown or unfinished quest reads false, never
        // warns. The done flag is the one source of truth, maintained
        // by the quest actions (adding to the target completes it).
        var wantQuest = String(data.quest || '').trim();
        var isDone = false;
        try {
          var doneMap = ctx.questLog && ctx.questLog.done;
          isDone = !!(doneMap && doneMap[wantQuest] === true);
        } catch (e) { isDone = false; }
        var passDone = wantQuest ? isDone : false;
        return res(data.reversed ? !passDone : passDone, { questComplete: passDone, quest: wantQuest });
      }
      case 'questProgress': {
        // True while the named quest's progress compares against the
        // value (Timer Elapsed shape: operator + expression value). A
        // quest with no progress yet reads as 0 — the comparison
        // still runs.
        var wantQuest2 = String(data.quest || '').trim();
        var heldQ = 0;
        try {
          var progMap = ctx.questLog && ctx.questLog.progress;
          var rawHeldQ = progMap ? progMap[wantQuest2] : undefined;
          heldQ = (isFinite(Number(rawHeldQ)) && Number(rawHeldQ) > 0) ? Math.floor(Number(rawHeldQ)) : 0;
        } catch (e) { heldQ = 0; }
        var valueQ = 0;
        try { valueQ = ctx.expr ? ctx.expr(data.value) : Number(data.value); } catch (e) { valueQ = 0; }
        if (!isFinite(valueQ)) valueQ = 0;
        var passQ = wantQuest2 ? compare(heldQ, data.operator, valueQ) : false;
        return res(data.reversed ? !passQ : passQ, { questProgress: passQ, quest: wantQuest2, progress: heldQ });
      }
      case 'achievementUnlocked': {
        // True while the named achievement is unlocked. Reads the
        // unlocked set on the live achievement runtime directly, like
        // questComplete reads the done flag — no subsystem call, so a
        // missing runtime just reads false. An unknown or locked
        // achievement reads false, never warns.
        var wantAch = String(data.achievement || '').trim();
        var isUnlocked = false;
        try {
          var unlockedMap = ctx.achievementLog && ctx.achievementLog.unlocked;
          isUnlocked = !!(unlockedMap && unlockedMap[wantAch] === true);
        } catch (e) { isUnlocked = false; }
        var passAch = wantAch ? isUnlocked : false;
        return res(data.reversed ? !passAch : passAch, { achievementUnlocked: passAch, achievement: wantAch });
      }
      case 'achievementCount': {
        // True while the number of unlocked achievements compares
        // against the value (Timer Elapsed shape: operator +
        // expression value). A game with nothing unlocked reads as 0
        // — the comparison still runs.
        var heldAch = 0;
        try {
          var unlockedMap2 = ctx.achievementLog && ctx.achievementLog.unlocked;
          heldAch = unlockedMap2 ? Object.keys(unlockedMap2).length : 0;
        } catch (e) { heldAch = 0; }
        var valueAch = 0;
        try { valueAch = ctx.expr ? ctx.expr(data.value) : Number(data.value); } catch (e) { valueAch = 0; }
        if (!isFinite(valueAch)) valueAch = 0;
        var passCount = compare(heldAch, data.operator, valueAch);
        return res(data.reversed ? !passCount : passCount, { achievementCount: passCount, count: heldAch });
      }
      case 'cutscenePlaying': {
        // True while the named cutscene is playing. Reads the active
        // entry on the live cutscene runtime directly, like
        // achievementUnlocked reads the unlocked set — no subsystem
        // call, so a missing runtime just reads false. A blank name
        // means any cutscene: true while one is running at all. Never
        // warns.
        var wantCut = String(data.cutscene || '').trim();
        var isPlaying = false;
        try {
          var activeCut = ctx.cutscene && ctx.cutscene.active;
          isPlaying = !!(activeCut && (!wantCut || activeCut.name === wantCut));
        } catch (e) { isPlaying = false; }
        return res(data.reversed ? !isPlaying : isPlaying, { cutscenePlaying: isPlaying, cutscene: wantCut });
      }
      case 'cutsceneFinished': {
        // True while the named cutscene is the most recently finished
        // one (a natural ending or a stop both count). Reads the
        // lastFinished name on the live cutscene runtime directly —
        // no subsystem call, so a missing runtime just reads false.
        // A blank name means any cutscene finished most recently.
        // The record stays until another cutscene finishes or the
        // same one plays again; the flow system's edge trigger is
        // what fires once on the change. Never warns.
        var wantCut2 = String(data.cutscene || '').trim();
        var isFinished = false;
        try {
          var finCut = ctx.cutscene && ctx.cutscene.lastFinished;
          var finName = (typeof finCut === 'string') ? finCut.trim() : '';
          isFinished = !!(finName && (!wantCut2 || finName === wantCut2));
        } catch (e) { isFinished = false; }
        return res(data.reversed ? !isFinished : isFinished, { cutsceneFinished: isFinished, cutscene: wantCut2 });
      }
      case 'isHighScore': {
        // True while the score would make the leaderboard: the table
        // has room, or the score beats its lowest entry. Reads the
        // live table directly, like achievementUnlocked reads the
        // unlocked set — no subsystem call, so a missing runtime
        // just reads false. The lowest entry is the minimum score
        // across the table (not the last row), so an unsorted table
        // still reads right. A non-numeric score never qualifies.
        var scoreHS = NaN;
        try { scoreHS = ctx.expr ? Number(ctx.expr(data.score)) : Number(data.score); } catch (e) { scoreHS = NaN; }
        var entriesHS = [];
        var hasTableHS = false;
        try {
          var rawHS = ctx.highScoreTable && ctx.highScoreTable.entries;
          hasTableHS = Array.isArray(rawHS);
          if (hasTableHS) entriesHS = rawHS;
        } catch (e) { entriesHS = []; hasTableHS = false; }
        var maxHS = 10;
        try {
          var mHS = ctx.highScoreConfig && Number(ctx.highScoreConfig.maxEntries);
          if (isFinite(mHS) && Math.floor(mHS) >= 1) maxHS = Math.min(50, Math.floor(mHS));
        } catch (e) { maxHS = 10; }
        var lowestHS = null;
        try {
          entriesHS.forEach(function (en) {
            var s = Number(en && en.score);
            if (isFinite(s) && (lowestHS === null || s < lowestHS)) lowestHS = s;
          });
        } catch (e) { lowestHS = null; }
        var passHS = hasTableHS && isFinite(scoreHS) && (entriesHS.length < maxHS ||
          (lowestHS !== null && scoreHS > lowestHS));
        return res(data.reversed ? !passHS : passHS, { isHighScore: passHS, score: scoreHS });
      }
      case 'highScoreCount': {
        // True while the number of scores on the leaderboard compares
        // against the value (Timer Elapsed shape: operator +
        // expression value). An empty table reads as 0 — the
        // comparison still runs.
        var heldHS = 0;
        try {
          var entriesHS2 = ctx.highScoreTable && ctx.highScoreTable.entries;
          heldHS = Array.isArray(entriesHS2) ? entriesHS2.length : 0;
        } catch (e) { heldHS = 0; }
        var valueHS = 0;
        try { valueHS = ctx.expr ? ctx.expr(data.value) : Number(data.value); } catch (e) { valueHS = 0; }
        if (!isFinite(valueHS)) valueHS = 0;
        var passCountHS = compare(heldHS, data.operator, valueHS);
        return res(data.reversed ? !passCountHS : passCountHS, { highScoreCount: passCountHS, count: heldHS });
      }
      case 'timeScale': {
        // True while the current time scale compares against the
        // value (Timer Elapsed shape: operator + expression value).
        // Reads the live scale directly, like highScoreCount reads
        // the table — no subsystem call, so a missing runtime reads
        // as 1 and the comparison still runs. A non-numeric value
        // reads as 0 and stays quiet.
        var scaleTS = 1;
        try {
          var rawTS = ctx.timeScale && ctx.timeScale.scale;
          var nTS = Number(rawTS);
          scaleTS = isFinite(nTS) ? nTS : 1;
        } catch (e) { scaleTS = 1; }
        var valueTS = 0;
        try { valueTS = ctx.expr ? ctx.expr(data.value) : Number(data.value); } catch (e) { valueTS = 0; }
        if (!isFinite(valueTS)) valueTS = 0;
        var passTS = compare(scaleTS, data.operator, valueTS);
        return res(data.reversed ? !passTS : passTS, { timeScale: passTS, scale: scaleTS });
      }
      case 'transitionPlaying': {
        // True while a scene transition is playing. Reads the live
        // transition runtime directly, like cutscenePlaying reads
        // the cutscene runtime — no subsystem call, so a missing
        // runtime just reads false. A blank scene means any
        // transition: true while one is running at all. The scene
        // value is the numeric id from the scene select (or a name);
        // both match the runtime's pending scene. Never warns.
        var wantTrans = data.sceneId;
        var isPlayingTrans = false;
        try {
          var rtTrans = ctx.transition;
          if (rtTrans && (rtTrans.phase === 'out' || rtTrans.phase === 'in')) {
            var wantName = (wantTrans == null || String(wantTrans).trim() === '') ? '' : String(wantTrans).trim();
            isPlayingTrans = !wantName ||
              String(rtTrans.pendingScene == null ? '' : rtTrans.pendingScene).trim() === wantName;
          }
        } catch (e) { isPlayingTrans = false; }
        return res(data.reversed ? !isPlayingTrans : isPlayingTrans, { transitionPlaying: isPlayingTrans, sceneId: wantTrans });
      }
      case 'cameraFollowing': {
        // True while the camera is following an object (a non-blank
        // follow target). Reads the live camera record directly — no
        // subsystem call, so a missing record just reads false. A
        // state read, so it evaluates while paused like musicPlaying.
        // Never warns.
        var followingCam = false;
        try {
          var camRec = ctx.camera;
          followingCam = !!(camRec && typeof camRec === 'object' &&
            String(camRec.followTarget == null ? '' : camRec.followTarget).trim() !== '');
        } catch (e) { followingCam = false; }
        return res(data.reversed ? !followingCam : followingCam, { cameraFollowing: followingCam });
      }
      case 'parallaxFactor': {
        // True when an object's parallax factor matches the
        // comparison. Reads through the shared HydraParallax module
        // when the host wired it, so an object whose fields were never
        // normalized still reads 1 (world speed) instead of 0; without
        // the module the raw fields read the same way, defaulting to 1.
        // A state read, so it evaluates while paused like
        // cameraFollowing. Never warns.
        var axisPx = (data.axis === 'parallaxY') ? 'parallaxY' : 'parallaxX';
        var valuePx = expr(ctx, data.value == null ? 0 : data.value);
        var matchedPx = null;
        var passPx = named(ctx, data.targetObject).some(function (obj) {
          var checkedPx = 1;
          try {
            var PM = ctx.parallaxModule;
            if (PM && typeof PM.parallaxOf === 'function') {
              var fPx = PM.parallaxOf(obj);
              checkedPx = (axisPx === 'parallaxY') ? fPx.y : fPx.x;
            } else {
              var rawPx = obj[axisPx];
              checkedPx = (rawPx == null) ? 1 : (Number(rawPx) || 0);
            }
          } catch (e) { checkedPx = 1; }
          if (!isFinite(checkedPx)) checkedPx = 1;
          var okPx = compare(checkedPx, data.operator || '>=', valuePx);
          if (okPx) matchedPx = obj;
          return okPx;
        });
        return res(data.reversed ? !passPx : passPx, { obj1: matchedPx, targetObject: data.targetObject });
      }
      case 'pathFinished': {
        // True once an object's path has arrived (the record still
        // stands until a new Follow Path or Stop Path clears it).
        // Reads through the shared HydraPathfind module when the host
        // wired it; without the module the raw _path record reads the
        // same way. A state read, so it evaluates while paused like
        // cameraFollowing. Never warns.
        var finTargets = named(ctx, data.targetObject);
        var finObj = null;
        var PFf = ctx.pathfindModule;
        if (PFf && typeof PFf.pathFinished === 'function') {
          try { finObj = finTargets.find(function (o) { return PFf.pathFinished(o); }) || null; } catch (e) { finObj = null; }
        } else {
          finObj = finTargets.find(function (o) { return !!(o && o._path && o._path.done); }) || null;
        }
        var passFin = data.reversed ? !finObj : Boolean(finObj);
        return res(passFin, { pathFinished: true, targetObject: data.targetObject, obj1: finObj });
      }
      case 'hasPath': {
        // True while an object is walking a path that has not arrived
        // yet. Same read shape as Path Finished above.
        var hasTargets = named(ctx, data.targetObject);
        var hasObj = null;
        var PFh = ctx.pathfindModule;
        if (PFh && typeof PFh.hasPath === 'function') {
          try { hasObj = hasTargets.find(function (o) { return PFh.hasPath(o); }) || null; } catch (e) { hasObj = null; }
        } else {
          hasObj = hasTargets.find(function (o) { return !!(o && o._path && !o._path.done); }) || null;
        }
        var passHas = data.reversed ? !hasObj : Boolean(hasObj);
        return res(passHas, { hasPath: true, targetObject: data.targetObject, obj1: hasObj });
      }
      case 'aiBehavior': {
        // True while an object's AI behavior matches the picked one.
        // Reads through the shared HydraAi module when the host wired
        // it; without the module the raw _ai record reads the same
        // way. A state read, so it evaluates while paused like
        // pathFinished. Never warns.
        var aiTargets = named(ctx, data.targetObject);
        var aiObj = null;
        var AIm = ctx.aiModule;
        var wantAi = (typeof data.behavior === 'string') ? data.behavior.trim().toLowerCase() : 'none';
        if (AIm && typeof AIm.behaviorOf === 'function') {
          try { aiObj = aiTargets.find(function (o) { return AIm.behaviorOf(o) === wantAi; }) || null; } catch (e) { aiObj = null; }
        } else {
          aiObj = aiTargets.find(function (o) {
            return (o && o._ai && typeof o._ai.behavior === 'string' ? o._ai.behavior.toLowerCase() : 'none') === wantAi;
          }) || null;
        }
        var passAi = data.reversed ? !aiObj : Boolean(aiObj);
        return res(passAi, { aiBehavior: true, targetObject: data.targetObject, obj1: aiObj });
      }
      case 'targetInRange': {
        // True while the target object's center is within Range pixels
        // of the object's center (raw position centers, like
        // distanceCheck). A missing object or target reads false; a
        // failed range expression reads as 0 through expr(), so only
        // a target right on top of the object matches. A state read,
        // so it evaluates while paused like distanceCheck. Never warns.
        var rangeVal = expr(ctx, data.range == null ? 300 : data.range);
        var inTargets = named(ctx, data.targetObject);
        var inObj = null;
        var tgtObj = null;
        var AIt = ctx.aiModule;
        if (AIt && typeof AIt.targetInRange === 'function') {
          var namedTgt = named(ctx, data.targetName);
          tgtObj = namedTgt.length ? namedTgt[0] : null;
          try { inObj = inTargets.find(function (o) { return AIt.targetInRange(o, tgtObj, rangeVal); }) || null; } catch (e) { inObj = null; }
        } else {
          var rawTgt = named(ctx, data.targetName);
          tgtObj = rawTgt.length ? rawTgt[0] : null;
          inObj = inTargets.find(function (o) {
            if (!o || !tgtObj) return false;
            var dx = (o.posX + o.width / 2) - (tgtObj.posX + tgtObj.width / 2);
            var dy = (o.posY + o.height / 2) - (tgtObj.posY + tgtObj.height / 2);
            return Math.sqrt(dx * dx + dy * dy) <= rangeVal;
          }) || null;
        }
        var passIn = data.reversed ? !inObj : Boolean(inObj);
        return res(passIn, { targetInRange: true, targetObject: data.targetObject, obj1: inObj, obj2: tgtObj });
      }
      case 'joystickActive': {
        // True while the player is steering — the stick is grabbed
        // and tilted past the dead zone, so a held-but-centered stick
        // reads quiet. An input read, so it evaluates while paused
        // like actionInput. Never warns.
        var joyOn = false;
        var Jm = ctx.joystickModule;
        if (Jm && typeof Jm.isSteering === 'function') {
          try { joyOn = !!Jm.isSteering(ctx.joystick); } catch (e) { joyOn = false; }
        } else {
          var jr = ctx.joystick;
          joyOn = !!(jr && jr.pointerId != null && (jr.x !== 0 || jr.y !== 0));
        }
        var passJoy = data.reversed ? !joyOn : joyOn;
        return res(passJoy, { joystickActive: joyOn });
      }
      case 'joystickTilt': {
        // True while the stick tilts the picked way past the minimum
        // tilt (0..1, default 0.5; a failed expression reads as 0.5
        // through expr(), so a bad minimum still tilts at half).
        // 'up' is negative Y, like screen coordinates; 'any' reads
        // the tilt magnitude, so a diagonal counts. An input read, so
        // it evaluates while paused like actionInput. Never warns.
        var minTilt = expr(ctx, data.minTilt == null ? 0.5 : data.minTilt);
        var tiltOn = false;
        var Jt = ctx.joystickModule;
        if (Jt && typeof Jt.joystickTilt === 'function') {
          try { tiltOn = !!Jt.joystickTilt(ctx.joystick, data.direction, minTilt); } catch (e) { tiltOn = false; }
        } else {
          var rt2 = ctx.joystick;
          if (rt2 && rt2.pointerId != null) {
            var dir2 = (typeof data.direction === 'string') ? data.direction.trim().toLowerCase() : 'any';
            var mt2 = Number(minTilt);
            mt2 = isFinite(mt2) ? Math.max(0, Math.min(1, mt2)) : 0.5;
            var tx = Number(rt2.x) || 0;
            var ty = Number(rt2.y) || 0;
            if (dir2 === 'up') tiltOn = -ty >= mt2;
            else if (dir2 === 'down') tiltOn = ty >= mt2;
            else if (dir2 === 'left') tiltOn = -tx >= mt2;
            else if (dir2 === 'right') tiltOn = tx >= mt2;
            else tiltOn = Math.sqrt(tx * tx + ty * ty) >= mt2;
          }
        }
        var passTilt = data.reversed ? !tiltOn : tiltOn;
        return res(passTilt, { joystickTilt: tiltOn });
      }
      case 'healthCheck': {
        // True while an object's health compares with the value the
        // picked way. Reads through the shared HydraHealth module
        // when the host wired it; without the module the raw health
        // fields read the same way (a missing health reads as 100,
        // the fresh-object default). A state read, so it evaluates
        // while paused like getVariable. Never warns.
        var hpTargets = named(ctx, data.targetObject);
        var hpObj = null;
        var hpVal = expr(ctx, data.value == null ? 0 : data.value);
        var hpOp = (typeof data.operator === 'string') ? data.operator : '>=';
        var HMm = ctx.healthModule;
        if (HMm && typeof HMm.healthOf === 'function') {
          try { hpObj = hpTargets.find(function (o) { return compare(HMm.healthOf(o).health, hpOp, hpVal); }) || null; } catch (e) { hpObj = null; }
        } else {
          hpObj = hpTargets.find(function (o) {
            var h = (o && isFinite(Number(o.health))) ? Number(o.health) : 100;
            return compare(h, hpOp, hpVal);
          }) || null;
        }
        var passHp = data.reversed ? !hpObj : Boolean(hpObj);
        return res(passHp, { healthCheck: true, targetObject: data.targetObject, obj1: hpObj });
      }
      case 'objectDied': {
        // True while an object's health is 0 — on the killing hit and
        // every frame after, until something heals it. The flow
        // system's edge trigger is what fires once on the change, so
        // a chained explosion runs once, not every frame the corpse
        // lies there. Reads through the shared HydraHealth module
        // when the host wired it; without the module the raw health
        // field reads the same way. A state read, so it evaluates
        // while paused like healthCheck. Never warns.
        var deadTargets = named(ctx, data.targetObject);
        var deadObj = null;
        var HDm = ctx.healthModule;
        if (HDm && typeof HDm.isDead === 'function') {
          try { deadObj = deadTargets.find(function (o) { return HDm.isDead(o); }) || null; } catch (e) { deadObj = null; }
        } else {
          deadObj = deadTargets.find(function (o) { return !!(o && isFinite(Number(o.health)) && Number(o.health) <= 0); }) || null;
        }
        var passDead = data.reversed ? !deadObj : Boolean(deadObj);
        return res(passDead, { objectDied: true, targetObject: data.targetObject, obj1: deadObj });
      }
      case 'isInvincible': {
        // True while an object's shield still holds at the frozen game
        // clock — Make Invincible writes obj._invincibleUntil, and this
        // reads it through the shared HydraDamageFx module when the
        // host wired it; without the module the raw record reads the
        // same way (a missing record reads as vulnerable, never as
        // shielded). A state read, so it evaluates while paused like
        // healthCheck. Never warns.
        var invTargets = named(ctx, data.targetObject);
        var invObj = null;
        var nowInv = nowMs(ctx);
        var DMm = ctx.damageFxModule;
        if (DMm && typeof DMm.isInvincible === 'function') {
          try { invObj = invTargets.find(function (o) { return DMm.isInvincible(o, nowInv); }) || null; } catch (e) { invObj = null; }
        } else {
          invObj = invTargets.find(function (o) {
            return !!(o && isFinite(Number(o._invincibleUntil)) && Number(o._invincibleUntil) > nowInv);
          }) || null;
        }
        var passInv = data.reversed ? !invObj : Boolean(invObj);
        return res(passInv, { isInvincible: true, targetObject: data.targetObject, obj1: invObj });
      }
      case 'checkpointSet': {
        // True while a checkpoint is recorded for this scene — Set
        // Checkpoint wrote it, Clear Checkpoint forgot it, and a fresh
        // scene starts without one. Reads through the shared
        // HydraRespawn module when the host wired it; without the
        // module the raw point field reads the same way (a missing
        // point reads as no checkpoint). A state read, so it evaluates
        // while paused like healthCheck. Never warns.
        var cpSet = false;
        var RMm = ctx.respawnModule;
        if (RMm && typeof RMm.hasCheckpoint === 'function') {
          try { cpSet = RMm.hasCheckpoint(ctx.respawn); } catch (e) { cpSet = false; }
        } else {
          cpSet = !!(ctx.respawn && ctx.respawn.point && typeof ctx.respawn.point === 'object');
        }
        return res(data.reversed ? !cpSet : cpSet, { checkpointSet: cpSet });
      }
      case 'respawnCount': {
        // True while the scene's respawn count compares with the
        // value the picked way — at least 1 after the first death, at
        // least 3 for a three-lives game over. Reads through the shared
        // HydraRespawn module when the host wired it; without the
        // module the raw count field reads the same way (a missing
        // count reads as 0). A state read, so it evaluates while paused
        // like healthCheck. Never warns.
        var rcVal = expr(ctx, data.value == null ? 0 : data.value);
        var rcOp = (typeof data.operator === 'string') ? data.operator : '>=';
        var rcCount = 0;
        var RMm2 = ctx.respawnModule;
        if (RMm2 && typeof RMm2.respawnCount === 'function') {
          try { rcCount = RMm2.respawnCount(ctx.respawn); } catch (e) { rcCount = 0; }
        } else {
          rcCount = (ctx.respawn && isFinite(Number(ctx.respawn.count))) ? Number(ctx.respawn.count) : 0;
        }
        var passRc = compare(rcCount, rcOp, rcVal);
        return res(data.reversed ? !passRc : passRc, { respawnCount: true, count: rcCount });
      }
      case 'spawnerActive': {
        // True while the named spawner runs — it exists, it is active,
        // and it has not reached its total yet. Reads through the
        // shared HydraSpawn module when the host wired it; without the
        // module the raw record reads the same way (a missing spawner
        // reads as not running). A state read, so it evaluates while
        // paused like checkpointSet. Never warns.
        var spName = String(data.name || '').trim();
        var spActive = false;
        var SMm = ctx.spawnModule;
        if (SMm && typeof SMm.spawnerActive === 'function') {
          try { spActive = SMm.spawnerActive(ctx.spawners, spName); } catch (e) { spActive = false; }
        } else {
          var spRec = (ctx.spawners && ctx.spawners.spawners &&
            ctx.spawners.spawners[spName]) || null;
          if (spRec && spRec.active) {
            var spTotal = (typeof spRec.total === 'number') ? spRec.total : 0;
            var spMade = (typeof spRec.spawned === 'number') ? spRec.spawned : 0;
            spActive = !(spTotal > 0 && spMade >= spTotal);
          }
        }
        return res(data.reversed ? !spActive : spActive, { spawnerActive: spActive });
      }
      case 'spawnedCount': {
        // True while the named spawner's spawned total compares with
        // the value the picked way — at least 10 for a ten-spawn wave
        // gate, at least 1 once the first enemy has arrived. Reads
        // through the shared HydraSpawn module when the host wired it;
        // without the module the raw count field reads the same way (a
        // missing spawner reads as 0). A state read, so it evaluates
        // while paused like respawnCount. Never warns.
        var scName = String(data.name || '').trim();
        var scVal = expr(ctx, data.value == null ? 0 : data.value);
        var scOp = (typeof data.operator === 'string') ? data.operator : '>=';
        var scCount = 0;
        var SMm2 = ctx.spawnModule;
        if (SMm2 && typeof SMm2.spawnedCount === 'function') {
          try { scCount = SMm2.spawnedCount(ctx.spawners, scName); } catch (e) { scCount = 0; }
        } else {
          var scRec = (ctx.spawners && ctx.spawners.spawners &&
            ctx.spawners.spawners[scName]) || null;
          scCount = (scRec && isFinite(Number(scRec.spawned))) ? Number(scRec.spawned) : 0;
        }
        var passSc = compare(scCount, scOp, scVal);
        return res(data.reversed ? !passSc : passSc, { spawnedCount: true, count: scCount });
      }
      case 'lives': {
        // True while the lives count compares with the value the
        // picked way — at least 1 while the player still has a life
        // left, exactly 0 when the game is over. Reads through the
        // shared HydraLives module when the host wired it; without
        // the module the raw count field reads the same way (a
        // missing count reads as the default 3). A state read, so it
        // evaluates while paused like respawnCount. Never warns.
        var lvVal = expr(ctx, data.value == null ? 0 : data.value);
        var lvOp = (typeof data.operator === 'string') ? data.operator : '>=';
        var lvCount = 3;
        var LMm = ctx.livesModule;
        if (LMm && typeof LMm.livesOf === 'function') {
          try { lvCount = LMm.livesOf(ctx.lives); } catch (e) { lvCount = 3; }
        } else {
          lvCount = (ctx.lives && isFinite(Number(ctx.lives.lives))) ? Number(ctx.lives.lives) : 3;
        }
        var passLv = compare(lvCount, lvOp, lvVal);
        return res(data.reversed ? !passLv : passLv, { lives: true, count: lvCount });
      }
      case 'gameOver': {
        // True while the game is over — the lives count reads 0.
        // Game over is derived, never stored: gaining a life after
        // game over clears it, so losing the last life again fires
        // the edge again. Reads through the shared HydraLives
        // module when the host wired it; without the module the raw
        // count field reads the same way (a missing count reads as
        // the default 3, so no game over). An edge trigger (the flow
        // default) fires it once, exactly when the last life is
        // lost. A state read, so it evaluates while paused like
        // objectDied. Never warns.
        var goOver = false;
        var LMm2 = ctx.livesModule;
        if (LMm2 && typeof LMm2.isGameOver === 'function') {
          try { goOver = LMm2.isGameOver(ctx.lives); } catch (e) { goOver = false; }
        } else {
          var goCount = (ctx.lives && isFinite(Number(ctx.lives.lives))) ? Number(ctx.lives.lives) : 3;
          goOver = goCount <= 0;
        }
        return res(data.reversed ? !goOver : goOver, { gameOver: goOver });
      }
      case 'xp': {
        // True while the XP total compares with the value the picked
        // way — at least 100 once the player has earned a level's
        // worth, exactly 0 before the first kill. Reads through the
        // shared HydraXp module when the host wired it; without the
        // module the raw total field reads the same way (a missing
        // total reads as the default 0). A state read, so it evaluates
        // while paused like lives. Never warns.
        var xpVal = expr(ctx, data.value == null ? 0 : data.value);
        var xpOp = (typeof data.operator === 'string') ? data.operator : '>=';
        var xpTotal = 0;
        var XMm = ctx.xpModule;
        if (XMm && typeof XMm.xpOf === 'function') {
          try { xpTotal = XMm.xpOf(ctx.xp); } catch (e) { xpTotal = 0; }
        } else {
          xpTotal = (ctx.xp && isFinite(Number(ctx.xp.xp))) ? Math.floor(Number(ctx.xp.xp)) : 0;
          if (xpTotal < 0) xpTotal = 0;
        }
        var passXp = compare(xpTotal, xpOp, xpVal);
        return res(data.reversed ? !passXp : passXp, { xp: true, count: xpTotal });
      }
      case 'level': {
        // True while the derived level compares with the value the
        // picked way — at least 2 once the player has leveled up,
        // exactly 1 before the first level. Reads through the shared
        // HydraXp module when the host wired it; without the module
        // the level is derived from the raw total and per-level
        // fields the same way (a missing total reads as level 1). A
        // state read, so it evaluates while paused like xp. Never
        // warns.
        var lvVal = expr(ctx, data.value == null ? 0 : data.value);
        var lvOp = (typeof data.operator === 'string') ? data.operator : '>=';
        var lvLevel = 1;
        var XMm2 = ctx.xpModule;
        if (XMm2 && typeof XMm2.levelOf === 'function') {
          try { lvLevel = XMm2.levelOf(ctx.xp); } catch (e) { lvLevel = 1; }
        } else {
          var lvPer = (ctx.xp && isFinite(Number(ctx.xp.xpPerLevel)) && Number(ctx.xp.xpPerLevel) >= 1)
            ? Math.floor(Number(ctx.xp.xpPerLevel)) : 100;
          var lvTotal = (ctx.xp && isFinite(Number(ctx.xp.xp))) ? Math.floor(Number(ctx.xp.xp)) : 0;
          if (lvTotal < 0) lvTotal = 0;
          lvLevel = Math.floor(lvTotal / lvPer) + 1;
          if (lvLevel < 1) lvLevel = 1;
        }
        var passLv2 = compare(lvLevel, lvOp, lvVal);
        return res(data.reversed ? !passLv2 : passLv2, { level: true, count: lvLevel });
      }
      case 'levelUp': {
        // True once, exactly when the level rises — the check is
        // consume-on-read, so the first evaluation after a level-up
        // returns true and marks the level announced, and the next
        // evaluation reads false until a higher level arrives. Reads
        // through the shared HydraXp module when the host wired it;
        // without the module the raw announced-level field reads the
        // same way (a missing announced level treats the current
        // level as already announced, so no spurious fire). An edge
        // trigger (the flow default) fires it once, exactly when the
        // level rises. A state read, so it evaluates while paused
        // like level. Never warns.
        var luUp = false;
        var XMm3 = ctx.xpModule;
        if (XMm3 && typeof XMm3.levelUp === 'function') {
          try { luUp = XMm3.levelUp(ctx.xp); } catch (e) { luUp = false; }
        } else if (ctx.xp && typeof ctx.xp === 'object') {
          var luPer = (isFinite(Number(ctx.xp.xpPerLevel)) && Number(ctx.xp.xpPerLevel) >= 1)
            ? Math.floor(Number(ctx.xp.xpPerLevel)) : 100;
          var luTotal = isFinite(Number(ctx.xp.xp)) ? Math.floor(Number(ctx.xp.xp)) : 0;
          if (luTotal < 0) luTotal = 0;
          var luLevel = Math.floor(luTotal / luPer) + 1;
          if (luLevel < 1) luLevel = 1;
          var luAnnounced = ctx.xp.levelAnnounced;
          if (luAnnounced == null) {
            ctx.xp.levelAnnounced = luLevel;
          } else {
            var luAnn = Math.floor(Number(luAnnounced));
            if (!isFinite(luAnn)) luAnn = luLevel;
            if (luAnn < 1) luAnn = 1;
            if (luLevel > luAnn) {
              ctx.xp.levelAnnounced = luLevel;
              luUp = true;
            }
          }
        }
        return res(data.reversed ? !luUp : luUp, { levelUp: luUp });
      }
      case 'enemyLevel': {
        // True while an enemy's level compares with the value the
        // picked way — at least 3 once the enemy has scaled twice,
        // exactly 1 before it ever scaled. Reads through the shared
        // HydraScaling module when the host wired it; without the
        // module the raw level field reads the same way (a missing
        // record reads as level 1). The first matching object decides
        // the read, like jumpsLeft. A state read, so it evaluates
        // while paused like level. Never warns.
        var elTargets = named(ctx, data.targetObject);
        var elVal = expr(ctx, data.value == null ? 0 : data.value);
        var elOp = (typeof data.operator === 'string') ? data.operator : '>=';
        var elObj = null;
        var SCm = ctx.scalingModule;
        if (SCm && typeof SCm.levelOf === 'function') {
          try { elObj = elTargets.find(function (o) { return compare(SCm.levelOf(ctx.scaling, o), elOp, elVal); }) || null; } catch (e) { elObj = null; }
        } else {
          elObj = elTargets.find(function (o) {
            var rec = null;
            try {
              var byId = ctx.scaling && ctx.scaling.byId;
              rec = (byId && typeof byId === 'object') ? byId[o.name] : null;
            } catch (e) { rec = null; }
            var lv = 1;
            if (rec && rec.level != null) {
              var n = Number(rec.level);
              lv = isFinite(n) ? Math.floor(n) : 1;
              if (lv < 1) lv = 1;
              if (lv > 999) lv = 999;
            }
            return compare(lv, elOp, elVal);
          }) || null;
        }
        var passEl = !!elObj;
        return res(data.reversed ? !passEl : passEl, { enemyLevel: passEl });
      }
      case 'bossPhase': {
        // True while the boss fight's phase compares with the value
        // the picked way — at least 2 once the boss drops below two
        // thirds of its health, exactly 3 in the final slice. Reads
        // through the shared HydraBoss module when the host wired it;
        // without the module the raw state reads the same way (a
        // missing record reads as phase 0). No fight running, or a
        // boss that has not spawned yet, reads as 0. A state read, so
        // it evaluates while paused like enemyLevel. Never warns.
        var bpVal = expr(ctx, data.value == null ? 0 : data.value);
        var bpOp = (typeof data.operator === 'string') ? data.operator : '>=';
        var bpPhase = 0;
        var BOm = ctx.bossModule;
        if (BOm && typeof BOm.phaseOfState === 'function') {
          try {
            var bpState = ctx.boss;
            if (bpState && BOm.isActive(bpState)) {
              var bpObjs = named(ctx, bpState.objectName);
              var bpFrac = bpObjs.length ? BOm.fractionOf(bpObjs[0], ctx.healthModule) : null;
              bpPhase = BOm.phaseOfState(bpState, bpFrac);
            }
          } catch (e) { bpPhase = 0; }
        } else {
          try {
            var bpRaw = ctx.boss;
            if (bpRaw && bpRaw.active === true && typeof bpRaw.objectName === 'string' && bpRaw.objectName !== '') {
              var bpRawObjs = named(ctx, bpRaw.objectName);
              var bpRawFrac = null;
              if (bpRawObjs.length) {
                var bpRawObj = bpRawObjs[0];
                var bpRawMax = Number(bpRawObj.maxHealth);
                if (!isFinite(bpRawMax) || bpRawMax <= 0) bpRawMax = 100;
                var bpRawH = Number(bpRawObj.health);
                if (!isFinite(bpRawH)) bpRawH = bpRawMax;
                bpRawFrac = Math.max(0, Math.min(1, bpRawH / bpRawMax));
              }
              var bpN = 3;
              var bpRawPhases = Number(bpRaw.phases);
              if (isFinite(bpRawPhases)) { bpN = Math.floor(bpRawPhases); if (bpN < 2) bpN = 3; if (bpN > 5) bpN = 5; }
              if (bpRawFrac != null) {
                bpPhase = bpN - Math.floor(bpRawFrac * bpN);
                if (bpPhase < 1) bpPhase = 1;
                if (bpPhase > bpN) bpPhase = bpN;
              }
            }
          } catch (e) { bpPhase = 0; }
        }
        var passBp = compare(bpPhase, bpOp, bpVal);
        return res(data.reversed ? !passBp : passBp, { bossPhase: passBp });
      }
      case 'bossActive': {
        // True while a boss fight is running — from Start Boss until
        // End Boss, even before the boss spawns. Reads through the
        // shared HydraBoss module when the host wired it; without the
        // module the raw state reads the same way. A state read, so
        // it evaluates while paused like bossPhase. Never warns.
        var baPass = false;
        var BAm = ctx.bossModule;
        if (BAm && typeof BAm.isActive === 'function') {
          try { baPass = BAm.isActive(ctx.boss); } catch (e) { baPass = false; }
        } else {
          try {
            var baRaw = ctx.boss;
            baPass = !!(baRaw && baRaw.active === true && typeof baRaw.objectName === 'string' && baRaw.objectName !== '');
          } catch (e) { baPass = false; }
        }
        return res(data.reversed ? !baPass : baPass, { bossActive: baPass });
      }
      case 'minimapVisible': {
        // True while the minimap shows for the current scene. Reads
        // through the shared HydraMinimap module when the host wired
        // it; without the module the raw state reads the same way (a
        // missing record reads as hidden). A state read, so it
        // evaluates while paused like bossActive. Never warns.
        var mvPass = false;
        var MVm = ctx.minimapModule;
        if (MVm && typeof MVm.isVisible === 'function') {
          try { mvPass = MVm.isVisible(ctx.minimap); } catch (e) { mvPass = false; }
        } else {
          try {
            var mvRaw = ctx.minimap;
            mvPass = !!(mvRaw && mvRaw.visible === true);
          } catch (e) { mvPass = false; }
        }
        return res(data.reversed ? !mvPass : mvPass, { minimapVisible: mvPass });
      }
      case 'isAttached': {
        // True while the object is attached — to the named parent
        // when one is given, to any parent when it is blank. Reads
        // through the shared HydraAttach module when the host wired
        // it; without the module the raw link table reads the same
        // way (a missing record reads as not attached). A blank
        // object reads as not attached, and the case never warns. A
        // state read, so it evaluates while paused like
        // minimapVisible.
        var iaPass = false;
        var iaObj = String(data.targetObject || '').trim();
        var iaParent = String(data.parentObject || '').trim();
        if (iaObj !== '') {
          var IAm = ctx.attachModule;
          if (IAm && typeof IAm.isAttached === 'function') {
            try { iaPass = IAm.isAttached(ctx.attachments, iaObj, iaParent); } catch (e) { iaPass = false; }
          } else {
            try {
              var iaLinks = ctx.attachments && ctx.attachments.links;
              var iaLink = iaLinks && iaLinks[iaObj];
              iaPass = !!(iaLink && typeof iaLink === 'object' &&
                (iaParent === '' || String(iaLink.parent || '').trim() === iaParent));
            } catch (e) { iaPass = false; }
          }
        }
        return res(data.reversed ? !iaPass : iaPass, { isAttached: iaPass });
      }
      case 'hasTag': {
        // True while any live object with the name carries the tag —
        // the tag check the Inspector chips and Add Tag feed. Reads
        // through the shared HydraTags module when the host wired
        // it; without the module the raw tags arrays read the same
        // way (a missing record reads as no tag). A blank object or
        // tag reads as false, quietly. A state read, so it evaluates
        // while paused like bossActive. Never warns.
        var htName = (typeof data.targetObject === 'string') ? data.targetObject.trim() : '';
        var htPass = false;
        var Tm = ctx.tagsModule;
        if (Tm && typeof Tm.hasTag === 'function') {
          try {
            var htObjs = named(ctx, htName);
            for (var hti = 0; hti < htObjs.length; hti++) {
              if (Tm.hasTag(htObjs[hti], data.tag)) { htPass = true; break; }
            }
          } catch (e) { htPass = false; }
        } else {
          try {
            var htRawTag = (typeof data.tag === 'string') ? data.tag.trim().toLowerCase() : '';
            if (htRawTag !== '') {
              var htRawObjs = named(ctx, htName);
              for (var htr = 0; htr < htRawObjs.length; htr++) {
                var htRawList = htRawObjs[htr] && htRawObjs[htr].tags;
                if (Array.isArray(htRawList)) {
                  for (var htk = 0; htk < htRawList.length; htk++) {
                    if (typeof htRawList[htk] === 'string' && htRawList[htk].trim().toLowerCase() === htRawTag) {
                      htPass = true; break;
                    }
                  }
                }
                if (htPass) break;
              }
            }
          } catch (e) { htPass = false; }
        }
        return res(data.reversed ? !htPass : htPass, { hasTag: htPass });
      }
      case 'taggedCount': {
        // True while the number of live objects carrying the tag
        // compares with the value the picked way — exactly 0 once
        // every goblin is gone. Reads through the shared HydraTags
        // module when the host wired it; without the module the raw
        // tags arrays count the same way (a blank tag counts 0). A
        // state read, so it evaluates while paused like bossPhase.
        // Never warns.
        var tcVal = expr(ctx, data.value == null ? 0 : data.value);
        var tcOp = (typeof data.operator === 'string') ? data.operator : '==';
        var tcCount = 0;
        var TcM = ctx.tagsModule;
        if (TcM && typeof TcM.countTagged === 'function') {
          try { tcCount = TcM.countTagged(allObjects(ctx), data.tag); } catch (e) { tcCount = 0; }
        } else {
          try {
            var tcRawTag = (typeof data.tag === 'string') ? data.tag.trim().toLowerCase() : '';
            if (tcRawTag !== '') {
              tcCount = allObjects(ctx).filter(function (o) {
                if (!o || !Array.isArray(o.tags)) return false;
                return o.tags.some(function (t) {
                  return typeof t === 'string' && t.trim().toLowerCase() === tcRawTag;
                });
              }).length;
            }
          } catch (e) { tcCount = 0; }
        }
        var passTc = compare(tcCount, tcOp, tcVal);
        return res(data.reversed ? !passTc : passTc, { taggedCount: passTc });
      }
      case 'scopedVariableExists': {
        // True while the named variable exists in the picked scope —
        // a global "score", a scene "coins", or an object "hp" on the
        // named object. Reads through the shared HydraVariables module
        // when the host wired it; without the module the raw state
        // reads the same way (a missing record has no variables). A
        // state read, so it evaluates while paused like getVariable.
        // Never warns.
        var seScope = (typeof data.scope === 'string') ? data.scope : 'global';
        var seName = String(data.varName || '').trim();
        var seExists = false;
        var VVm = ctx.varScopesModule;
        if (seName && VVm && typeof VVm.has === 'function') {
          try { seExists = !!VVm.has(ctx.varScopes, seScope, seName, { sceneId: ctx.sceneId, objectName: data.targetObject }); } catch (e) { seExists = false; }
        } else if (seName) {
          try {
            var seEntry = rawScopedEntry(ctx.varScopes, seScope, seName, ctx.sceneId, data.targetObject);
            seExists = seEntry !== null;
          } catch (e) { seExists = false; }
        }
        return res(data.reversed ? !seExists : seExists, { scopedVariableExists: seExists });
      }
      case 'scopedVariableCheck': {
        // True while a scoped variable compares with the value the
        // picked way. Numbers compare numerically (the value is an
        // expression, like getVariable); text and true/false compare
        // as text against the raw value field; a list or dict never
        // matches ==. A missing variable reads as 0. Reads through
        // the shared HydraVariables module when the host wired it;
        // without the module the raw state reads the same way. A
        // state read, so it evaluates while paused like getVariable.
        // Never warns.
        var scScope = (typeof data.scope === 'string') ? data.scope : 'global';
        var scName = String(data.varName || '').trim();
        var scOp = (typeof data.operator === 'string') ? data.operator : '>=';
        var scEntry = null;
        var scV = ctx.varScopesModule;
        if (scName && scV && typeof scV.get === 'function') {
          try { scEntry = scV.get(ctx.varScopes, scScope, scName, { sceneId: ctx.sceneId, objectName: data.targetObject }); } catch (e) { scEntry = null; }
        } else if (scName) {
          try { scEntry = rawScopedEntry(ctx.varScopes, scScope, scName, ctx.sceneId, data.targetObject); } catch (e) { scEntry = null; }
        }
        var scVal = (scEntry && typeof scEntry === 'object') ? scEntry.value : 0;
        var scType = (scEntry && typeof scEntry === 'object' && typeof scEntry.type === 'string') ? scEntry.type : 'number';
        var passSc = false;
        if (scType === 'number') {
          passSc = compare(scVal, scOp, expr(ctx, data.compareValue == null ? 0 : data.compareValue));
        } else if (scType === 'text' || scType === 'bool') {
          var scWant = String(data.compareValue == null ? '' : data.compareValue);
          if (scOp === '==') passSc = String(scVal) === scWant;
          else if (scOp === '!=') passSc = String(scVal) !== scWant;
          else passSc = false;
        } else {
          passSc = false;
        }
        return res(data.reversed ? !passSc : passSc, { scopedVariableCheck: passSc });
      }
      case 'jumpsLeft': {
        // True while an object's jumps left compare with the value
        // the picked way — at least 1 while the player can still
        // jump, exactly 0 while every jump is spent until the next
        // landing. Reads through the shared HydraMovement module
        // when the host wired it; without the module the count is
        // Max jumps minus the jumps used in the raw record (a missing
        // record reads as the full count). A state read, so it
        // evaluates while paused like lives. Never warns.
        var jlTargets = named(ctx, data.targetObject);
        var jlVal = expr(ctx, data.value == null ? 0 : data.value);
        var jlOp = (typeof data.operator === 'string') ? data.operator : '>=';
        var jlObj = null;
        var MVm = ctx.movementModule;
        if (MVm && typeof MVm.jumpsLeft === 'function') {
          try { jlObj = jlTargets.find(function (o) { return compare(MVm.jumpsLeft(ctx.movement, o), jlOp, jlVal); }) || null; } catch (e) { jlObj = null; }
        } else {
          jlObj = jlTargets.find(function (o) {
            var max = 1;
            try { if (o && o.movement && isFinite(Number(o.movement.maxJumps))) max = Math.max(1, Math.floor(Number(o.movement.maxJumps))); } catch (e) { max = 1; }
            return compare(max, jlOp, jlVal);
          }) || null;
        }
        var passJl = data.reversed ? !jlObj : Boolean(jlObj);
        return res(passJl, { jumpsLeft: true, targetObject: data.targetObject, obj1: jlObj });
      }
      case 'isDashing': {
        // True while the object is mid-dash — inside the burst the
        // Dash block started. Reads through the shared HydraMovement
        // module when the host wired it, on the frozen game clock
        // (so the read holds while paused, like the shield read);
        // without the module the raw dash-until field reads the same
        // way (a missing record reads as not dashing). A state read,
        // so it evaluates while paused like isInvincible. Never warns.
        var idTargets = named(ctx, data.targetObject);
        var idNow = 0;
        try { idNow = Number(ctx.nowMs()) / 1000; } catch (e) { idNow = 0; }
        var idObj = null;
        var MVm2 = ctx.movementModule;
        if (MVm2 && typeof MVm2.isDashing === 'function') {
          try { idObj = idTargets.find(function (o) { return MVm2.isDashing(ctx.movement, o, idNow); }) || null; } catch (e) { idObj = null; }
        } else {
          idObj = idTargets.find(function (o) {
            try {
              var recs = (ctx.movement && ctx.movement.records) || {};
              var rec = (o && o.id != null) ? recs[o.id] : null;
              return !!(rec && isFinite(Number(rec.dashUntil)) && idNow < Number(rec.dashUntil));
            } catch (e) { return false; }
          }) || null;
        }
        var passId = data.reversed ? !idObj : Boolean(idObj);
        return res(passId, { isDashing: true, targetObject: data.targetObject, obj1: idObj });
      }
      case 'wallSliding': {
        // True while the object slides down a wall — airborne,
        // falling, pressing toward a solid wall it touches, with a
        // slide speed set. Reads through the shared HydraMovement
        // module when the host wired it; without the module the raw
        // wall config + side contact + held keys read the same way
        // (a missing config reads as no slide). A state read, so it
        // evaluates while paused like isDashing. Never warns.
        var wsTargets = named(ctx, data.targetObject);
        var wsObj = null;
        var MVm3 = ctx.movementModule;
        if (MVm3 && typeof MVm3.isWallSliding === 'function') {
          try { wsObj = wsTargets.find(function (o) { return MVm3.isWallSliding(o, movementHooks(ctx)); }) || null; } catch (e) { wsObj = null; }
        } else {
          try { wsObj = wsTargets.find(function (o) { return rawWallSliding(ctx, o); }) || null; } catch (e) { wsObj = null; }
        }
        var passWs = data.reversed ? !wsObj : Boolean(wsObj);
        return res(passWs, { wallSliding: true, targetObject: data.targetObject, obj1: wsObj });
      }
      case 'attackReady': {
        // True while the object's picked attack has cooled down — a
        // melee swing or a shot is ready to fire again. Reads through
        // the shared HydraCombat module when the host wired it; without
        // the module the raw cooldown record reads the same way (a
        // missing record reads as ready — an object that never
        // attacked). A state read, so it evaluates while paused like
        // isDashing. Never warns.
        var arTargets = named(ctx, data.targetObject);
        // the attack-kind field is attackKind, not kind: the grid
        // row itself stores kind ('condition'/'action'), so a field
        // named kind would be clobbered by the row marker. The data.kind
        // fallback keeps direct calls that pass kind working.
        var arKind = ((data.attackKind || data.kind) === 'shot') ? 'shot' : 'melee';
        var arCd = expr(ctx, data.cooldown == null ? 0.5 : data.cooldown);
        var arNow = 0;
        try { arNow = Number(ctx.nowMs()) / 1000; } catch (e) { arNow = 0; }
        var arObj = null;
        var CBm = ctx.combatModule;
        if (CBm && typeof CBm.attackReady === 'function') {
          try { arObj = arTargets.find(function (o) { return CBm.attackReady(ctx.combat, o, arKind, arCd, arNow); }) || null; } catch (e) { arObj = null; }
        } else {
          arObj = arTargets.find(function (o) {
            try {
              var recs = (ctx.combat && ctx.combat.cooldowns) || {};
              var rec = (o && o.id != null) ? recs[o.id] : null;
              if (!rec) return true;
              var last = (arKind === 'shot') ? rec.shotAt : rec.meleeAt;
              if (last == null || !isFinite(Number(last))) return true;
              return (arNow - Number(last)) >= arCd;
            } catch (e) { return false; }
          }) || null;
        }
        var passAr = data.reversed ? !arObj : Boolean(arObj);
        return res(passAr, { attackReady: true, targetObject: data.targetObject, obj1: arObj });
      }
      case 'standingOnPlatform': {
        // True while the object stands on a moving platform — the
        // ride is on. Reads through the shared HydraPlatform module
        // when the host wired it; without the module the raw platform
        // config reads the same way (a parked platform or a one-point
        // path never counts, and a crumbled platform has its
        // collision off, so the filter excludes it). A state read, so
        // it evaluates while paused. Never warns.
        var sopTargets = named(ctx, data.targetObject);
        var sopObj = null;
        var PFm = ctx.platformModule;
        if (PFm && typeof PFm.platformUnder === 'function') {
          try { sopObj = sopTargets.find(function (o) { return PFm.platformUnder(ctx.platform, o, platformHooks(ctx), false); }) || null; } catch (e) { sopObj = null; }
        } else {
          try { sopObj = sopTargets.find(function (o) { return allObjects(ctx).some(function (f) { return rawStandsOn(ctx, o, f, false); }); }) || null; } catch (e) { sopObj = null; }
        }
        var passSop = data.reversed ? !sopObj : Boolean(sopObj);
        return res(passSop, { standingOnPlatform: true, targetObject: data.targetObject, obj1: sopObj });
      }
      case 'standingOnOneWay': {
        // True while the object stands on a one-way platform — a floor
        // you jump up through and land on from above. Reads through
        // the shared HydraPlatform module when the host wired it;
        // without the module the raw one-way flag reads the same way
        // (any one-way floor counts, platform or plain). A state read,
        // so it evaluates while paused. Never warns.
        var sowTargets = named(ctx, data.targetObject);
        var sowObj = null;
        var PFm2 = ctx.platformModule;
        if (PFm2 && typeof PFm2.platformUnder === 'function') {
          try { sowObj = sowTargets.find(function (o) { return PFm2.platformUnder(ctx.platform, o, platformHooks(ctx), true); }) || null; } catch (e) { sowObj = null; }
        } else {
          try { sowObj = sowTargets.find(function (o) { return allObjects(ctx).some(function (f) { return rawStandsOn(ctx, o, f, true); }); }) || null; } catch (e) { sowObj = null; }
        }
        var passSow = data.reversed ? !sowObj : Boolean(sowObj);
        return res(passSow, { standingOnOneWay: true, targetObject: data.targetObject, obj1: sowObj });
      }
      case 'transitionFinished': {
        // True while the named scene is the most recently
        // transitioned-to one (a natural ending, an instant switch,
        // or a cancel during the in half all count). Reads the
        // lastFinished scene on the live transition runtime
        // directly — no subsystem call, so a missing runtime just
        // reads false. A blank scene means any transition finished
        // most recently. The record stays until another transition
        // finishes or a new one starts; the flow system's edge
        // trigger is what fires once on the change. Never warns.
        var wantTrans2 = data.sceneId;
        var isFinishedTrans = false;
        try {
          var finTrans = ctx.transition && ctx.transition.lastFinished;
          var finNameTrans = (finTrans == null) ? '' : String(finTrans).trim();
          var wantName2 = (wantTrans2 == null || String(wantTrans2).trim() === '') ? '' : String(wantTrans2).trim();
          isFinishedTrans = !!(finNameTrans && (!wantName2 || finNameTrans === wantName2));
        } catch (e) { isFinishedTrans = false; }
        return res(data.reversed ? !isFinishedTrans : isFinishedTrans, { transitionFinished: isFinishedTrans, sceneId: wantTrans2 });
      }
      default:
        try { if (isFn(ctx.reportUnknown)) ctx.reportUnknown(type); } catch (e) { /* reporting must never break the dispatch */ }
        return res(false);
    }
  }

  // Evaluate one condition block. Returns { triggered, context }.
  // Never throws: a bad block, a missing ctx piece, or a throwing
  // subsystem hook reads as not-triggered.
  function evaluateCondition(data, ctx, scope, idx) {
    try {
      if (!data || typeof data !== 'object') return res(false);
      return evaluateInner(data, ctx || {}, scope, idx);
    } catch (e) {
      return res(false);
    }
  }

  return {
    FROZEN_WHILE_PAUSED: FROZEN_WHILE_PAUSED,
    evaluateCondition: evaluateCondition
  };
}

if (typeof window !== 'undefined') {
  window.HydraConditions = hydraConditionsFactory();
  // Self-contained source of the factory, inlined into exported playable games
  // by buildPlayableHtml (player-runtime.js). Kept as a string, never eval'd here.
  window.HydraConditions.factorySource = hydraConditionsFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraConditionsFactory;
