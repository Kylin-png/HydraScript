/* HydraPreviewRuntime — the editor preview's runtime host (P2 item 14, slices 6-8).
 *
 * Slice 6 moved the keyboard / mouse / touch / gamepad input state and
 * wiring out of script.js; slice 7 moves the script-grid dispatch host
 * (processScriptGrid + dispatchHooks, the condition/action context
 * builders with their subsystem hook builders, the per-frame context
 * bookkeeping, the gameStart launch path, and the warn-once helpers);
 * slice 8 moves the frame loop and the run lifecycle (gameLoop,
 * launchPreview / loadPreviewScene / resetGame, the camera-follow and
 * UI-widget phases, and the physics-step / scene-reset hook builders).
 * script.js keeps thin delegations (normalizeKeyName / keyNameAliases /
 * keySetHas / getEventKeyAliases, processScriptGrid /
 * processGameStartConditions / resetFrameConditionContexts /
 * resetGameStartState / getAlivePreviewObjects, plus the gameLoop /
 * resetGame / launchPreview / loadPreviewScene / stopPreviewLoop /
 * updateCameraFollow / switchPreviewScene call sites) so every existing
 * call site is unchanged; this module owns the input state that used to
 * be the script.js `mouseButtons` / `keysPressed` / `previewGamepad*` /
 * `previewMouseDelta` / `previewLastClient` lets and the document key
 * listeners, the canvas mouse/touch handlers, the per-frame gamepad
 * poll, and the per-frame / per-launch / per-run input resets, the
 * dispatch host that used to be the script.js processScriptGrid /
 * dispatchHooks / conditionCtx / actionCtx code and its helpers, and
 * the frame loop + run lifecycle that used to be the script.js
 * gameLoop / launchPreview / loadPreviewScene / resetGame code and
 * its helpers (including the loop's running flag, rAF handle, and
 * last-frame time, which used to be script.js lets).
 *
 * The state object is the single source of truth: script.js aliases its
 * Set fields (mouseButtons, keysPressed, ...) so the condition/action
 * contexts and the game loop keep reading the same objects, and the
 * module always mutates those Sets in place (clear + refill) instead of
 * replacing them, so the aliases never go stale. The two scalar fields
 * (touchCount, gamepadConnected) are read off the state object at the
 * use site (conditionCtx), never aliased. The mouse position also lives
 * here (state.mouse) and is mutated in place, so the one script.js
 * alias (`previewState.mouse = previewInput.mouse`) stays valid; every
 * other previewState.mouse read is unchanged. The gamepad axes object
 * is likewise mutated field-by-field, never replaced.
 *
 * This is a DOM module, not a pure one: it attaches listeners to the
 * document and the game canvas, so the node tests drive it through a
 * vm sandbox with a fake document/canvas (tests/previewruntime.test.js).
 * The key-name helpers delegate to the shared HydraInput module and the
 * gamepad poll delegates to HydraActions, both reached only through
 * configure() providers (defaults: the globalThis modules, the
 * navigator gamepad poll) — a missing or throwing provider degrades to
 * the plain fallback (trimmed key names, empty gamepad state) instead
 * of breaking input. The document is the explicit first argument to
 * every DOM function (a missing argument falls back to the global
 * document, a missing document is a no-op) and the canvas is always
 * passed in, so the module never reads editor globals.
 *
 * Live editor state reaches the module only through configure():
 *   getHydraInput   — () => the HydraInput module; defaults to
 *                      globalThis.HydraInput.
 *   getHydraActions — () => the HydraActions module; defaults to
 *                      globalThis.HydraActions.
 *   getGamepads     — () => the navigator gamepad list; defaults to
 *                      the try/catch navigator poll (the old
 *                      pollEditorGamepads body).
 * Every provider is optional and replaced only by a function; a
 * throwing provider degrades to its safe default. The touch-zone
 * lookup is not a provider: updateTouch / attachCanvasInput take an
 * explicit `zonesAt(x, y, width, height)` function (script.js passes
 * HydraActions.zonesAt); a missing or throwing zonesAt means no zones,
 * never a crash.
 *
 * Nothing in this module ever throws: a missing state, document,
 * canvas, or event is a no-op, and a hostile (frozen / wrong-typed)
 * state degrades to the call doing nothing.
 *
 * Documented behavior deltas (all in this header):
 * - updateMouse returns early when the canvas rect is missing or has
 *   zero width/height; the old inline code divided by the rect size
 *   and could store Infinity/NaN mouse coordinates for a zero-size
 *   canvas. A live canvas that can receive a mouse event always has
 *   a size, so this changes no live behavior.
 * - updateTouch safe-calls zonesAt; the old inline code let a throwing
 *   zonesAt propagate out of the touch handler. Touch zones now
 *   degrade to empty instead of breaking the handler.
 * - attachCanvasInput's contextmenu handler guards a missing event /
 *   preventDefault; the old inline handler called e.preventDefault()
 *   unconditionally.
 * - pollGamepad copies the polled buttons/axes into the existing state
 *   Sets/axes object instead of replacing them (the old gameLoop code
 *   reassigned the script.js bindings). Observable behavior is
 *   identical through the aliases; the in-place form is what keeps
 *   the aliases valid.
 * - resetRunInput clears the gamepad/touch/mouse-delta state in place
 *   for the same reason; the old resetGame code reassigned fresh Sets
 *   and a fresh axes/delta object.
 *
 * Stays in script.js: the rest of the editor (the run state object,
 * the draw builders that the loop calls through host.drawGame, the
 * scene-init hook builder that the run lifecycle uses, and the
 * isCondition/isAction/isComment runtime-type classifiers the palette
 * code uses). The loop's pollInput phase still owns the
 * HydraActions.update call that feeds the action-input runtime; this
 * module only polls the raw gamepad state and derives the edge sets,
 * exactly as the old inline code did.
 *
 * Follows the hydra-*.js factorySource pattern. Exports never inline
 * this module (exported games have no editor preview); factorySource
 * is kept so the module stays re-instantiable and testable like the
 * rest of the family.
 */
function hydraPreviewRuntimeFactory() {
  'use strict';

  var getHydraInput = function () {
    return (typeof globalThis !== 'undefined' && globalThis.HydraInput) || null;
  };
  var getHydraActions = function () {
    return (typeof globalThis !== 'undefined' && globalThis.HydraActions) || null;
  };
  var getGamepads = function () {
    try {
      return (typeof navigator !== 'undefined' && navigator.getGamepads)
        ? Array.from(navigator.getGamepads())
        : [];
    } catch (e) { return []; }
  };

  function configure(providers) {
    if (!providers || typeof providers !== 'object') return;
    if (typeof providers.getHydraInput === 'function') getHydraInput = providers.getHydraInput;
    if (typeof providers.getHydraActions === 'function') getHydraActions = providers.getHydraActions;
    if (typeof providers.getGamepads === 'function') getGamepads = providers.getGamepads;
    if (typeof providers.getModule === 'function') getModule = providers.getModule;
    if (providers.host && typeof providers.host === 'object') host = providers.host;
  }

  function docOf(doc) {
    if (doc) return doc;
    if (typeof document !== 'undefined') return document;
    return null;
  }

  function safeCall(fn, arg, fallback) {
    try {
      var v = fn(arg);
      return v === undefined ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function safeClear(set) {
    try { if (set && typeof set.clear === 'function') set.clear(); } catch (e) { /* hostile set: no-op */ }
  }

  function isSetLike(v) {
    return !!v && typeof v.has === 'function' && typeof v.add === 'function' &&
      typeof v.delete === 'function' && typeof v.clear === 'function' &&
      typeof v.forEach === 'function';
  }

  function replaceSet(target, values) {
    if (!isSetLike(target)) return;
    safeClear(target);
    try {
      if (values && typeof values.forEach === 'function') {
        values.forEach(function (v) { target.add(v); });
      }
    } catch (e) { /* hostile values: keep what was added */ }
  }

  // --- Input state ----------------------------------------------------
  // One fresh state object per preview run host. script.js aliases the
  // Set fields; the scalars (touchCount, gamepadConnected) are read off
  // the object. Every mutator below changes the Sets in place.
  function createInputState() {
    return {
      mouse: { x: 0, y: 0 },
      mouseButtons: new Set(),
      mouseJustPressed: new Set(),
      mouseJustReleased: new Set(),
      keysPressed: new Set(),
      keysJustPressed: new Set(),
      keysJustReleased: new Set(),
      touchZones: new Set(),
      touchCount: 0,
      gamepadButtons: new Set(),
      gamepadPrev: new Set(),
      gamepadJustPressed: new Set(),
      gamepadJustReleased: new Set(),
      gamepadAxes: { lx: 0, ly: 0, rx: 0, ry: 0 },
      gamepadConnected: false,
      mouseDelta: { x: 0, y: 0 },
      lastClient: null
    };
  }

  // --- Key-name helpers -------------------------------------------------
  // Thin wrappers over the shared hydra-input.js module (the single
  // canonical source, also used by exported games), with the plain
  // fallback the old script.js wrappers used when the module is
  // missing or throws.
  function normalizeKeyName(key) {
    var mod = safeCall(getHydraInput, undefined, null);
    if (mod && typeof mod.normalizeKeyName === 'function') {
      try { return mod.normalizeKeyName(key); } catch (e) { /* fall through */ }
    }
    return String(key == null ? '' : key).trim();
  }

  function keyNameAliases(key) {
    var mod = safeCall(getHydraInput, undefined, null);
    if (mod && typeof mod.keyNameAliases === 'function') {
      try {
        var a = mod.keyNameAliases(key);
        if (Array.isArray(a)) return a;
      } catch (e) { /* fall through */ }
    }
    return [normalizeKeyName(key)];
  }

  function keySetHas(set, key) {
    var mod = safeCall(getHydraInput, undefined, null);
    if (mod && typeof mod.keySetHas === 'function') {
      try { return !!mod.keySetHas(set, key); } catch (e) { /* fall through */ }
    }
    try { return !!set && typeof set.has === 'function' && set.has(normalizeKeyName(key)); } catch (e) { return false; }
  }

  function getEventKeyAliases(e) {
    if (!e || typeof e !== 'object') return [];
    var aliases = new Set();
    if (e.key) aliases.add(e.key);
    if (e.code) aliases.add(e.code);
    if (e.key === ' ') aliases.add('Space');
    if (e.code === 'Space') aliases.add('Space');
    return Array.from(aliases).filter(Boolean);
  }

  // --- Mouse / touch ----------------------------------------------------
  // P4 item 3D3 (character controllers): per-frame mouse deltas for
  // mouse-look, accumulated here (pointer-lock movementX/Y, or cursor
  // travel when uncaptured) and reset at the end of each frame by
  // clearEdges. Never throws; hostile events just add 0.
  function updateMouse(state, e, canvas, doc) {
    if (!state || !e || !canvas) return;
    var rect = null;
    try { rect = canvas.getBoundingClientRect(); } catch (err) { rect = null; }
    if (!rect || !rect.width || !rect.height) return;
    try {
      state.mouse.x = ((e.clientX - rect.left) / rect.width) * canvas.width;
      state.mouse.y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    } catch (err) { /* hostile canvas/event: mouse stays where it was */ }
    var d = docOf(doc);
    try {
      if (d && d.pointerLockElement === canvas) {
        state.mouseDelta.x += Number(e.movementX) || 0;
        state.mouseDelta.y += Number(e.movementY) || 0;
      } else if (state.lastClient && typeof e.clientX === 'number') {
        state.mouseDelta.x += (e.clientX - state.lastClient.x) || 0;
        state.mouseDelta.y += (e.clientY - state.lastClient.y) || 0;
      }
    } catch (err) { /* mouse deltas are decoration; never break input */ }
    try {
      state.lastClient = (typeof e.clientX === 'number')
        ? { x: e.clientX, y: e.clientY } : state.lastClient;
    } catch (err) { /* hostile state: no-op */ }
  }

  function pressMouseButton(state, button) {
    if (!state) return;
    try {
      if (!state.mouseButtons.has(button)) state.mouseJustPressed.add(button);
      state.mouseButtons.add(button);
    } catch (e) { /* hostile state: no-op */ }
  }

  function releaseMouseButton(state, button) {
    if (!state) return;
    try {
      if (state.mouseButtons.has(button)) state.mouseJustReleased.add(button);
      state.mouseButtons.delete(button);
    } catch (e) { /* hostile state: no-op */ }
  }

  // Touch: route screen touches through the named input actions
  // (P4 item 29). The raw touch count is set even when zonesAt is
  // missing, so the Touch Active / Touch Count conditions still read
  // it; zones degrade to empty instead of breaking the handler.
  // P4 Advanced batch 20 (virtual joystick): a new touch that lands
  // inside the stick's base grabs the stick instead of a touch zone,
  // and a grabbed touch drives the stick instead of the zones, so
  // steering never also walks the player through a touch zone. The
  // grab is attempted on touchstart (changedTouches), the release on
  // touchend / touchcancel; moves ride the e.touches loop below.
  function updateTouch(state, e, canvas, zonesAt) {
    if (!state || !e) return;
    try {
      safeClear(state.touchZones);
      state.touchCount = (e.touches && typeof e.touches.length === 'number') ? e.touches.length : 0;
    } catch (err) { return; }
    if (!e.touches || typeof zonesAt !== 'function' || !canvas) return;
    var rect = null;
    try { rect = canvas.getBoundingClientRect(); } catch (err) { rect = null; }
    if (!rect || !rect.width || !rect.height) return;
    var J = mod('Joystick');
    var joyRt = null;
    var joyCfg = null;
    var joyId = function (t) { return 'touch:' + (t && t.identifier); };
    if (J) {
      try { joyRt = joystickRuntime(); joyCfg = joystickConfig(); } catch (err) { joyRt = null; joyCfg = null; }
    }
    var type = (e && e.type) || '';
    if (joyRt && J && typeof J.joystickStart === 'function' && type === 'touchstart' && e.changedTouches) {
      for (var g = 0; g < e.changedTouches.length; g++) {
        var gt = e.changedTouches[g];
        if (!gt) continue;
        try {
          J.joystickStart(joyRt, joyCfg, joyId(gt),
            ((gt.clientX - rect.left) / rect.width) * canvas.width,
            ((gt.clientY - rect.top) / rect.height) * canvas.height,
            canvas.width, canvas.height);
        } catch (err) { /* a throwing grab never breaks the handler */ }
      }
    }
    if (joyRt && J && typeof J.joystickEnd === 'function' &&
        (type === 'touchend' || type === 'touchcancel') && e.changedTouches) {
      for (var h = 0; h < e.changedTouches.length; h++) {
        var ht = e.changedTouches[h];
        if (!ht) continue;
        try { J.joystickEnd(joyRt, joyId(ht)); } catch (err) { /* a throwing release never breaks the handler */ }
      }
    }
    for (var i = 0; i < e.touches.length; i++) {
      var t = e.touches[i];
      if (!t) continue;
      var x = ((t.clientX - rect.left) / rect.width) * canvas.width;
      var y = ((t.clientY - rect.top) / rect.height) * canvas.height;
      if (joyRt && J && typeof J.joystickMove === 'function' &&
          typeof J.isActive === 'function') {
        var grabbed = false;
        try { grabbed = J.isActive(joyRt) && joyRt.pointerId === joyId(t); } catch (err) { grabbed = false; }
        if (grabbed) {
          try { J.joystickMove(joyRt, joyCfg, joyRt.pointerId, x, y); } catch (err) { /* a throwing move never breaks the handler */ }
          continue;
        }
      }
      var zones = null;
      try { zones = zonesAt(x, y, canvas.width, canvas.height); } catch (err) { zones = null; }
      if (zones && typeof zones.forEach === 'function') {
        zones.forEach(function (z) { try { state.touchZones.add(z); } catch (err) { /* hostile set */ } });
      }
    }
  }

  // --- Wiring -----------------------------------------------------------
  // Property assignment (like the old launchPreview code) so relaunches
  // do not stack duplicate listeners.
  function attachCanvasInput(doc, canvas, state, zonesAt) {
    if (!canvas || !state) return;
    var d = docOf(doc);
    canvas.onmousemove = function (e) {
      updateMouse(state, e, canvas, d);
      // P4 Advanced batch 20 (virtual joystick): a dragged stick
      // follows the pointer; the mouse position still updates, so
      // Mouse Over keeps reading the real cursor.
      try {
        var Jm = mod('Joystick');
        var rtM = joystickRuntime();
        if (Jm && rtM && rtM.pointerId === 'mouse' && typeof Jm.joystickMove === 'function') {
          Jm.joystickMove(rtM, joystickConfig(), 'mouse', state.mouse.x, state.mouse.y);
        }
      } catch (err) { /* a throwing stick move never breaks input */ }
    };
    canvas.onmousedown = function (e) {
      updateMouse(state, e, canvas, d);
      // P4 Advanced batch 20 (virtual joystick): a left press inside
      // the stick's base grabs the stick instead of clicking — a
      // grabbed press never also clicks a button underneath it.
      var grabbed = false;
      try {
        var Jd = mod('Joystick');
        var rtD = joystickRuntime();
        if (Jd && rtD && (e ? e.button : 0) === 0 && typeof Jd.joystickStart === 'function') {
          grabbed = !!Jd.joystickStart(rtD, joystickConfig(), 'mouse', state.mouse.x, state.mouse.y, canvas.width, canvas.height);
        }
      } catch (err) { grabbed = false; }
      if (grabbed) return;
      pressMouseButton(state, e ? e.button : undefined);
    };
    canvas.onmouseup = function (e) {
      updateMouse(state, e, canvas, d);
      // P4 Advanced batch 20 (virtual joystick): releasing the
      // grabbed pointer lets go of the stick; it was never pressed
      // as a mouse button, so there is nothing to release there.
      try {
        var Ju = mod('Joystick');
        var rtU = joystickRuntime();
        if (Ju && rtU && rtU.pointerId === 'mouse' && typeof Ju.joystickEnd === 'function') {
          if (Ju.joystickEnd(rtU, 'mouse')) return;
        }
      } catch (err) { /* a throwing release never breaks input */ }
      releaseMouseButton(state, e ? e.button : undefined);
    };
    canvas.oncontextmenu = function (e) {
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
    };
    var touchHandler = function (e) {
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      updateTouch(state, e, canvas, zonesAt);
    };
    canvas.ontouchstart = touchHandler;
    canvas.ontouchmove = touchHandler;
    canvas.ontouchend = touchHandler;
    canvas.ontouchcancel = touchHandler;
  }

  function attachKeyboardInput(doc, state) {
    var d = docOf(doc);
    if (!d || !state || typeof d.addEventListener !== 'function') return;
    d.addEventListener('keydown', function (e) {
      getEventKeyAliases(e).forEach(function (key) {
        try {
          if (!state.keysPressed.has(key)) state.keysJustPressed.add(key);
          state.keysPressed.add(key);
        } catch (err) { /* hostile state: no-op */ }
      });
    });
    d.addEventListener('keyup', function (e) {
      getEventKeyAliases(e).forEach(function (key) {
        try {
          if (state.keysPressed.has(key)) state.keysJustReleased.add(key);
          state.keysPressed.delete(key);
        } catch (err) { /* hostile state: no-op */ }
      });
    });
  }

  // --- Per-frame / per-launch / per-run resets --------------------------
  // gameLoop clearEdges: the just-pressed/released edge sets and the
  // mouse deltas are per-frame — scripts have read them by now, so
  // reset for the next frame's accumulation. Held keys and held mouse
  // buttons survive.
  function clearEdges(state) {
    if (!state) return;
    safeClear(state.keysJustPressed);
    safeClear(state.keysJustReleased);
    safeClear(state.mouseJustPressed);
    safeClear(state.mouseJustReleased);
    try {
      if (state.mouseDelta) { state.mouseDelta.x = 0; state.mouseDelta.y = 0; }
    } catch (e) { /* hostile state: no-op */ }
  }

  // launchPreview: a fresh run starts with no held mouse buttons, no
  // pending edges, and no active touch zones. Held keys survive a
  // relaunch (the old code cleared only the key edge sets, not
  // keysPressed).
  function clearForLaunch(state) {
    if (!state) return;
    safeClear(state.mouseButtons);
    safeClear(state.mouseJustPressed);
    safeClear(state.mouseJustReleased);
    safeClear(state.keysJustPressed);
    safeClear(state.keysJustReleased);
    safeClear(state.touchZones);
  }

  // resetGame: fresh gamepad edge state per preview run, so a button
  // held during launch doesn't phantom-fire Just pressed on the first
  // frame; fresh touch count/zones and mouse-delta state too. All
  // in place, so the script.js aliases stay valid.
  function resetRunInput(state) {
    if (!state) return;
    safeClear(state.gamepadButtons);
    safeClear(state.gamepadPrev);
    safeClear(state.gamepadJustPressed);
    safeClear(state.gamepadJustReleased);
    try {
      if (state.gamepadAxes) {
        state.gamepadAxes.lx = 0; state.gamepadAxes.ly = 0;
        state.gamepadAxes.rx = 0; state.gamepadAxes.ry = 0;
      }
      state.gamepadConnected = false;
      state.touchCount = 0;
      if (state.mouseDelta) { state.mouseDelta.x = 0; state.mouseDelta.y = 0; }
      state.lastClient = null;
    } catch (e) { /* hostile state: no-op */ }
    safeClear(state.touchZones);
  }

  // --- Gamepad poll -----------------------------------------------------
  // P4 item 37 batch 7 (raw input blocks): poll the raw gamepad state
  // once per frame and derive button edge sets, so Gamepad Button
  // fires just-pressed/released exactly once per press. The actions
  // module takes the getGamepads function (not the pad list) and calls
  // it once per poll, exactly as the old gameLoop code did. A missing
  // actions module or a throwing poll degrades to empty gamepad state
  // for the frame. The HydraActions.update call that feeds the
  // action-input runtime stays in the gameLoop's pollInput phase.
  function pollGamepad(state, actionsModule) {
    if (!state) return;
    var actions = actionsModule || safeCall(getHydraActions, undefined, null);
    if (!actions) return;
    var getPads = getGamepads;
    var buttons = null;
    try {
      buttons = (typeof actions.pollGamepadButtons === 'function')
        ? actions.pollGamepadButtons(getPads) : null;
    } catch (e) { buttons = null; }
    if (!isSetLike(buttons)) buttons = new Set();
    var prev = isSetLike(state.gamepadPrev) ? state.gamepadPrev : new Set();
    var justPressed = new Set();
    var justReleased = new Set();
    buttons.forEach(function (b) { if (!prev.has(b)) justPressed.add(b); });
    prev.forEach(function (b) { if (!buttons.has(b)) justReleased.add(b); });
    replaceSet(state.gamepadButtons, buttons);
    replaceSet(state.gamepadJustPressed, justPressed);
    replaceSet(state.gamepadJustReleased, justReleased);
    replaceSet(state.gamepadPrev, buttons);
    var axes = null;
    try {
      axes = (typeof actions.pollGamepadAxes === 'function')
        ? actions.pollGamepadAxes(getPads) : null;
    } catch (e) { axes = null; }
    try {
      if (state.gamepadAxes) {
        state.gamepadAxes.lx = (axes && Number.isFinite(Number(axes.lx))) ? Number(axes.lx) : 0;
        state.gamepadAxes.ly = (axes && Number.isFinite(Number(axes.ly))) ? Number(axes.ly) : 0;
        state.gamepadAxes.rx = (axes && Number.isFinite(Number(axes.rx))) ? Number(axes.rx) : 0;
        state.gamepadAxes.ry = (axes && Number.isFinite(Number(axes.ry))) ? Number(axes.ry) : 0;
      }
    } catch (e) { /* hostile state: no-op */ }
    var connected = false;
    try {
      connected = (typeof actions.isGamepadConnected === 'function')
        ? !!actions.isGamepadConnected(getPads) : false;
    } catch (e) { connected = false; }
    try { state.gamepadConnected = connected; } catch (e) { /* hostile state: no-op */ }
  }

  // --- Script-grid dispatch host --------------------------------------
  // P2 item 14, slice 7: the rest of the preview runtime host — the
  // script-grid dispatch (processScriptGrid + dispatchHooks), the
  // per-block condition/action context builders (conditionCtx /
  // actionCtx) with their subsystem hook builders, the per-frame
  // context bookkeeping, the gameStart launch path, and the warn-once
  // helpers. script.js keeps thin delegations (processScriptGrid,
  // processGameStartConditions, resetFrameConditionContexts,
  // resetGameStartState, getAlivePreviewObjects) so every existing
  // call site is unchanged; everything else here is module-private.
  //
  // Live editor state reaches this section only through configure():
  // a single `host` object of getters and helper functions (see
  // hostCall below). Every host entry is optional; a missing or
  // throwing entry degrades to its safe default instead of breaking
  // the dispatch — conditions read false and actions do not run, the
  // same guarded-call degradation a dropped module tag gives. The
  // shared engine modules (HydraConditions, HydraExecute,
  // HydraDispatch, HydraFlow, HydraTrace, and the subsystem modules)
  // arrive through the `getModule(name)` provider, which defaults to
  // a globalThis lookup ('Hydra' + name), exactly like the input
  // host's getHydraInput / getHydraActions providers.
  //
  // The run state object itself is never
  // named here and never stored: host.getRunState() returns the live
  // object fresh on every read, and the module only ever mutates its
  // fields (conditionContexts / executionContext / flowTriggerStates /
  // camera / buses / ...), never replaces the object. The dispatch
  // Sets and Maps (started scopes, once states, timers, shake
  // cooldowns, the scene stack, variables, hidden / destroyed /
  // pending sets) live in the editor and arrive through host getters
  // too; when no host is configured the module falls back to
  // per-instance scratch collections so the dispatch still runs
  // standalone in tests. The warn-once Sets are module-private (one
  // warning per block type per editor session, as before).
  //
  // Documented behavior deltas (all in this section):
  // - Flow adjacency resolves through HydraFlow (P5-7): getAdjacentIndexes
  //   delegates to the Flow module's adjacentIndexes, so the preview's
  //   direct path and the dispatch walk agree on neighbour order
  //   (reading order) and on tall grids (no row cap).
  // - resolveActionTargets no longer builds two pools: the
  //   includeHidden pool (live objects minus destroyed/pending) and
  //   the default pool (getAlivePreviewObjects) were the same list,
  //   so one lookup serves both.
  // - A throwing shared-module call inside a context builder (a
  //   hostile stub in tests) degrades to that field's safe default
  //   instead of breaking the dispatch; the old inline builders let
  //   the throw propagate into the dispatch's per-condition catch,
  //   which read the whole condition as false. The dispatch outcome
  //   for a throwing module is unchanged (the condition still reads
  //   false); only the blast radius shrinks.
  // - processScriptGrid's DOM marking (the 'triggered' / 'traced'
  //   cell classes) is guarded: a hostile cells list degrades to no
  //   marking instead of breaking the frame. The dispatch itself is
  //   not guarded: a throwing HydraDispatch still propagates exactly
  //   as the old optional-chaining call did, so the frame loop's
  //   phase guard sees it.
  // - The dispatch host never reads editor globals and never queries
  //   the editor DOM by id; the document is reached only through
  //   docOf() for the pointer-lock host hooks, and the canvas only
  //   through host.getCanvas().

  var host = {};
  var getModule = function (name) {
    try {
      return (typeof globalThis !== 'undefined' && globalThis['Hydra' + name]) || null;
    } catch (e) { return null; }
  };

  // Per-instance scratch collections used only when no host is
  // configured (standalone tests); the editor always supplies the
  // live collections through host getters.
  var fallbackVariables = {};
  var fallbackHidden = new Set();
  var fallbackDestroyed = new Set();
  var fallbackPending = new Set();
  var fallbackTimers = new Map();
  var fallbackShakeCooldowns = new Map();
  var fallbackStarted = new Set();
  var fallbackOnce = new Set();
  var fallbackSceneStack = [];
  var fallbackScenes = [];
  var fallbackAssets = {};
  var fallbackFlowTriggerStates = {};
  var warnedUnknown = new Set();
  var warnedReadTimerBlank = new Set();
  var warnedFlashColor = new Set();

  // Shared read-only empty input state (never mutated: the context
  // builders only read these Sets), used when no host supplies the
  // live input state.
  var EMPTY_INPUT = {
    mouse: { x: 0, y: 0 },
    mouseButtons: new Set(), mouseJustPressed: new Set(), mouseJustReleased: new Set(),
    keysPressed: new Set(), keysJustPressed: new Set(), keysJustReleased: new Set(),
    touchZones: new Set(), touchCount: 0,
    gamepadButtons: new Set(), gamepadPrev: new Set(),
    gamepadJustPressed: new Set(), gamepadJustReleased: new Set(),
    gamepadAxes: { lx: 0, ly: 0, rx: 0, ry: 0 }, gamepadConnected: false,
    mouseDelta: { x: 0, y: 0 }, lastClient: null
  };

  // Call a host entry with an argument list; a missing, non-function,
  // throwing, or undefined-returning entry yields the fallback.
  function hostCall(name, args, fallback) {
    var f = null;
    try { f = host && host[name]; } catch (e) { f = null; }
    if (typeof f !== 'function') return fallback;
    try {
      var v = f.apply(null, args || []);
      return (v === undefined) ? fallback : v;
    } catch (e) { return fallback; }
  }

  // The shared engine module named `name` ('Conditions', 'Execute',
  // 'Dispatch', ...), or null when the provider is missing or throws.
  function mod(name) {
    var g = safeCall(getModule, name, null);
    return g || null;
  }

  function nowMs() {
    try {
      if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
    } catch (e) { /* fall through */ }
    try { return Date.now(); } catch (e) { return 0; }
  }

  // --- Host accessors (live editor state, with safe fallbacks) --------
  function runState() { return hostCall('getRunState', [], null); }
  function inputState() {
    var s = hostCall('getInputState', [], null);
    return (s && typeof s === 'object') ? s : EMPTY_INPUT;
  }
  function variables() {
    var v = hostCall('getVariables', [], null);
    return (v && typeof v === 'object') ? v : fallbackVariables;
  }
  function hiddenSet() {
    var s = hostCall('getHidden', [], null);
    return isSetLike(s) ? s : fallbackHidden;
  }
  function destroyedSet() {
    var s = hostCall('getDestroyed', [], null);
    return isSetLike(s) ? s : fallbackDestroyed;
  }
  function pendingSet() {
    var s = hostCall('getPendingDestroy', [], null);
    return isSetLike(s) ? s : fallbackPending;
  }
  function timersMap() {
    var m = hostCall('getTimers', [], null);
    return (m && typeof m.get === 'function' && typeof m.set === 'function') ? m : fallbackTimers;
  }
  function shakeCooldowns() {
    var m = hostCall('getShakeCooldowns', [], null);
    return (m && typeof m.get === 'function' && typeof m.set === 'function') ? m : fallbackShakeCooldowns;
  }
  function startedScopes() {
    var s = hostCall('getStartedScopes', [], null);
    return isSetLike(s) ? s : fallbackStarted;
  }
  function onceSet() {
    var s = hostCall('getOnce', [], null);
    return isSetLike(s) ? s : fallbackOnce;
  }
  function sceneStack() {
    var a = hostCall('getSceneStack', [], null);
    return Array.isArray(a) ? a : fallbackSceneStack;
  }
  function scenesList() {
    var a = hostCall('getScenes', [], null);
    return Array.isArray(a) ? a : fallbackScenes;
  }
  function assetLibrary() {
    var a = hostCall('getAssetLibrary', [], null);
    return (a && typeof a === 'object') ? a : fallbackAssets;
  }
  function canvasOf() { return hostCall('getCanvas', [], null); }
  function cellsOf() {
    var c = hostCall('getCells', [], null);
    return Array.isArray(c) ? c : [];
  }
  function activeScope() {
    var s = hostCall('getActiveScriptScope', [], 'global');
    return (s === undefined || s === null) ? 'global' : s;
  }
  function currentSceneIdOf() {
    var v = hostCall('getCurrentSceneId', [], 1);
    return (typeof v === 'number') ? v : 1;
  }
  function flowTriggerStatesOf() {
    var run = runState();
    var m = run ? run.flowTriggerStates : null;
    if (m && typeof m === 'object') return m;
    return fallbackFlowTriggerStates;
  }

  function evalExprOf(exprStr) { return hostCall('evalExpr', [exprStr], 0); }
  function evalExprInfoOf(exprStr) {
    var v = hostCall('evalExprInfo', [exprStr], null);
    if (v && typeof v === 'object' && 'value' in v) return v;
    return { value: 0, ok: false, unknowns: [] };
  }
  function objectsByName(name, list) {
    var v = hostCall('getObjectsByName', [name, list], null);
    return Array.isArray(v) ? v : [];
  }
  function hitboxOf(obj) {
    var v = hostCall('getHitbox', [obj], null);
    if (v && typeof v === 'object') return v;
    return {
      x: (obj && obj.posX) || 0, y: (obj && obj.posY) || 0,
      width: (obj && obj.width) || 0, height: (obj && obj.height) || 0
    };
  }
  function physicsOf(obj) {
    var v = hostCall('getPhysics', [obj], null);
    if (v && typeof v === 'object') return v;
    return (obj && obj.physics && typeof obj.physics === 'object') ? obj.physics : {};
  }
  function isCollisionObjectOf(obj) { return !!hostCall('isCollisionObject', [obj], false); }
  function scopeKeyOf(scope) {
    var v = hostCall('getScopeKey', [scope], null);
    return (typeof v === 'string') ? v : String(scope);
  }
  function sameScope(a, b) { return !!hostCall('sameScriptScope', [a, b], a === b); }
  function gridDataOf(scope) {
    var v = hostCall('getGridDataForScope', [scope], null);
    return (v && typeof v === 'object') ? v : {};
  }
  function pushDiagnostic(level, msg) { hostCall('pushDiagnostic', [level, msg], undefined); }
  function zoomOf(value) {
    var z = hostCall('normalizeCameraZoom', [value], null);
    if (typeof z === 'number' && Number.isFinite(z)) return z;
    var n = Number(value);
    return Number.isFinite(n) ? Math.min(4, Math.max(0.25, n)) : 1;
  }
  function clampOf(v, a, b) {
    var c = hostCall('clamp', [v, a, b], null);
    if (typeof c === 'number' && Number.isFinite(c)) return c;
    return Math.max(a, Math.min(b, v));
  }
  function isConditionType(type) { return !!hostCall('isCondition', [type], false); }
  function isActionType(type) { return !!hostCall('isAction', [type], false); }
  function isCommentType(type) { return !!hostCall('isComment', [type], false); }

  function setAdd(set, value) {
    try { if (set && typeof set.add === 'function') set.add(value); } catch (e) { /* hostile set */ }
  }
  function setHas(set, value) {
    try { return !!(set && typeof set.has === 'function' && set.has(value)); } catch (e) { return false; }
  }

  // --- Warn-once helpers ------------------------------------------------
  // Unknown block types are a data problem, not a crash: warn once per
  // type per editor session through the diagnostics panel instead of
  // failing silently.
  function warnUnknownBlockType(kind, type) {
    var key = String(kind) + ':' + String(type);
    try {
      if (warnedUnknown.has(key)) return;
      warnedUnknown.add(key);
    } catch (e) { return; }
    pushDiagnostic('warning',
      'Unknown ' + kind + ' block type "' + String(type) + '". The block was skipped; check the block catalog or re-add the block.');
  }

  // P4 item 37 batch 9 (timers): blank-name warnings for the Read Timer
  // action fire once per editor session, so a retriggered block cannot
  // spam the diagnostics panel.
  function warnReadTimerBlank(which) {
    try {
      if (warnedReadTimerBlank.has(which)) return;
      warnedReadTimerBlank.add(which);
    } catch (e) { return; }
    pushDiagnostic('warning', which === 'variable'
      ? 'Read Timer skipped: the variable name is blank. Name the variable that should receive the elapsed seconds.'
      : 'Read Timer: the timer name is blank, so it read 0 seconds. Name the timer you want to read.');
  }

  // Screen Flash (v4 gap, cycle 60): a bad flash color warns once per
  // editor session (a retriggered block cannot spam the panel) and the
  // flash holds its old state, mirroring the exported runtime.
  function warnFlashColor(color) {
    var key = String(color == null ? '' : color);
    try {
      if (warnedFlashColor.has(key)) return;
      warnedFlashColor.add(key);
    } catch (e) { return; }
    pushDiagnostic('warning',
      'Screen Flash: the color "' + key + '" is not a valid hex color, so the flash was skipped. Use a color like #ffffff.');
  }

  // --- Timer records ----------------------------------------------------
  // P4 item 37 batch 9 (timers): the timer-record helpers shared by the
  // script API hooks and the Timer Elapsed / Read Timer blocks. Never
  // create a record on a read — a timer that was never started reads 0.
  function getTimerRecord(key, now, interval) {
    var timers = timersMap();
    var existing = null;
    try { existing = timers.get(key); } catch (e) { existing = null; }
    if (existing && typeof existing === 'object') return existing;
    var t = (typeof now === 'number') ? now : nowMs();
    var record = {
      lastFiredTime: (typeof existing === 'number') ? existing : t - (interval || 1000),
      paused: false,
      pausedAt: 0,
      firedFrame: -1
    };
    try { timers.set(key, record); } catch (e) { /* hostile map */ }
    return record;
  }

  function resetNamedTimer(timerName) {
    var name = String(timerName || '').trim();
    if (!name) return;
    try {
      timersMap().set('named:' + name, {
        lastFiredTime: nowMs(), paused: false, pausedAt: 0, firedFrame: -1
      });
    } catch (e) { /* hostile map */ }
  }

  function setNamedTimerPaused(timerName, paused) {
    var name = String(timerName || '').trim();
    if (!name) return;
    var key = 'named:' + name;
    var now = nowMs();
    var record = getTimerRecord(key, now, 1000);
    if (paused && !record.paused) {
      record.paused = true;
      record.pausedAt = now;
    } else if (!paused && record.paused) {
      var pausedFor = now - (record.pausedAt || now);
      record.lastFiredTime += pausedFor;
      record.paused = false;
      record.pausedAt = 0;
    }
    try { timersMap().set(key, record); } catch (e) { /* hostile map */ }
  }

  // Read-only elapsed-seconds helper shared by the Timer Elapsed
  // condition and the Read Timer action. Never creates a timer record —
  // a timer that was never started reads as 0. Uses the frozen game
  // clock, so elapsed holds while paused; timerControl's per-timer
  // pause is honored through record.paused/pausedAt.
  function namedTimerElapsedSeconds(key, now) {
    var record = null;
    try { record = timersMap().get(key); } catch (e) { record = null; }
    if (!record || typeof record !== 'object') return 0;
    var t = (typeof now === 'number') ? now : nowMs();
    var elapsed = record.paused
      ? (record.pausedAt || t) - record.lastFiredTime
      : t - record.lastFiredTime;
    return Math.max(0, elapsed / 1000);
  }


  // --- Context bookkeeping ----------------------------------------------
  function getConditionContextKey(scope, idx) {
    return scopeKeyOf(scope) + ':' + idx;
  }

  function setConditionContext(scope, idx, context) {
    var run = runState();
    if (!run) return;
    try {
      if (!run.conditionContexts || typeof run.conditionContexts !== 'object') run.conditionContexts = {};
      run.conditionContexts[getConditionContextKey(scope, idx)] = context;
      run.executionContext = context;
    } catch (e) { /* hostile run state: no-op */ }
  }

  function getConditionContext(scope, idx) {
    var run = runState();
    try {
      return run && run.conditionContexts
        ? run.conditionContexts[getConditionContextKey(scope, idx)]
        : undefined;
    } catch (e) { return undefined; }
  }

  function markConditionTriggered(scope, idx) {
    if (!sameScope(scope, activeScope())) return;
    var cell = null;
    try { cell = cellsOf()[idx]; } catch (e) { cell = null; }
    try {
      if (cell && cell.classList && typeof cell.classList.add === 'function') cell.classList.add('triggered');
    } catch (e) { /* hostile cell: no-op */ }
  }

  function resetFrameConditionContexts() {
    var run = runState();
    if (!run) return;
    try {
      run.conditionContexts = {};
      // P2 item 15/12 slice 7: the edge-trigger memory
      // (flowTriggerStates) is NOT cleared here. It used to be wiped
      // every frame, so an edge condition that stayed true (a held
      // collision, a visible object) re-fired on every frame in the
      // preview while firing once per transition in exports. The
      // export keeps the map for the whole run; the preview does the
      // same, and a fresh run clears it (resetGame in script.js).
      run.executionContext = null;
    } catch (e) { /* hostile run state: no-op */ }
  }

  function resetGameStartState() {
    safeClear(startedScopes());
  }

  function getScopeGridData(scope) {
    return gridDataOf(scope);
  }

  // P5-7: flow adjacency is HydraFlow.adjacentIndexes — the ONE
  // definition. The preview used to keep its own copy here (up, down,
  // left, right order, rows capped at 60), which disagreed with the
  // dispatch's reading order AND lost every down-link past row 60,
  // the same row-60 bug the export copy had. getAdjacentIndexes below
  // is now a thin resolver through the Flow module (missing module
  // degrades to no neighbours, like every other dropped module tag);
  // the grid is 60 columns wide but rows are unbounded.
  function getAdjacentIndexes(index) {
    var F = mod('Flow');
    if (F && typeof F.adjacentIndexes === 'function') {
      try {
        var list = F.adjacentIndexes(index);
        return Array.isArray(list) ? list : [];
      } catch (e) { return []; }
    }
    return [];
  }

  function getEventActionIndexes(conditionIndex, scope) {
    var gd = getScopeGridData(scope);
    var conditionData = gd[conditionIndex];
    if (!conditionData) return [];

    if (conditionData.eventId) {
      return Object.entries(gd)
        .filter(function (entry) {
          return Number(entry[0]) !== conditionIndex && entry[1] &&
            entry[1].eventId === conditionData.eventId && isActionType(entry[1].type);
        })
        .map(function (entry) { return Number(entry[0]); })
        .sort(function (a, b) { return a - b; });
    }

    var row = Math.floor(conditionIndex / 60);
    var col = conditionIndex % 60;
    var actionIndexes = [];
    var seenActions = new Set();
    var addAction = function (idx) {
      var data = gd[idx];
      if (data && isActionType(data.type) && !seenActions.has(idx)) {
        seenActions.add(idx);
        actionIndexes.push(idx);
      }
    };

    getAdjacentIndexes(conditionIndex).forEach(addAction);

    var rightwardStarted = false;
    for (var nextCol = col + 1; nextCol < 60; nextCol++) {
      var idx = row * 60 + nextCol;
      var data = gd[idx];
      if (!data) {
        if (rightwardStarted) break;
        continue;
      }
      if (isActionType(data.type)) {
        addAction(idx);
        rightwardStarted = true;
        continue;
      }
      if (isCommentType(data.type)) {
        continue;
      }
      break;
    }
    return actionIndexes;
  }

  function applyAdjacentActionsFromScope(conditionCellOrIndex, scope) {
    var conditionIndex = (typeof conditionCellOrIndex === 'number')
      ? conditionCellOrIndex
      : parseInt(conditionCellOrIndex && conditionCellOrIndex.dataset
          ? conditionCellOrIndex.dataset.index : '', 10);
    if (!Number.isFinite(conditionIndex)) return;
    var gd = getScopeGridData(scope);

    getEventActionIndexes(conditionIndex, scope).forEach(function (adjIdx) {
      var adjData = gd[adjIdx];
      if (!adjData) return;
      if (isActionType(adjData.type)) {
        executeAction(adjData, adjIdx);
      }
    });
  }

  // P5-4 slice a (loops): a gameStart fires its chain through the
  // flow module's propagate — the same walk the dispatch uses for
  // every other triggered condition — so a Repeat / While in the
  // chain runs its body through executeLoop, exactly as an exported
  // game does. The old direct path (applyAdjacentActionsFromScope)
  // ran each adjacent action through plain executeAction, where a
  // loop block is a quiet no-op and its body ran once, so a
  // gameStart -> Repeat chain never looped in the preview while the
  // same chain looped in the export. The walk uses the dispatch's
  // buildPropagateApi (not the raw hooks — propagate calls
  // api.executeAction / api.evaluateCondition, which only the
  // dispatch-built API provides). The launch runs outside the frame
  // phase, so the loop budget is reset first (the frame phase
  // resets it again on the next frame). A gameStart with an eventId
  // (custom events, a later P5-4 slice) still takes the direct path
  // — propagate follows grid adjacency, not event links — and a
  // missing Flow or Dispatch module degrades to the direct path too.
  function fireGameStart(idx, scope) {
    var gd = getScopeGridData(scope);
    var data = gd[idx];
    var F = mod('Flow');
    var D = mod('Dispatch');
    if (data && !data.eventId && F && typeof F.propagate === 'function' &&
        D && typeof D.buildPropagateApi === 'function') {
      var api = null;
      try { api = D.buildPropagateApi(dispatchHooks(scope, null), scopeKeyOf(scope), gd); } catch (e) { api = null; }
      if (api) {
        try {
          var LB = mod('Loops');
          if (LB && typeof LB.resetLoopBudget === 'function') {
            try { LB.resetLoopBudget(loopsState()); } catch (e) { /* a throwing reset never breaks the launch */ }
          }
          F.propagate(gd, idx, api);
          return;
        } catch (e) { /* a throwing walk falls back to the direct path */ }
      }
    }
    applyAdjacentActionsFromScope(idx, scope);
  }

  function processGameStartConditions(scope) {
    var gd = getScopeGridData(scope);
    var scopeKey = scopeKeyOf(scope);
    var started = startedScopes();
    var alreadyFired = setHas(started, scopeKey);
    Object.entries(gd).forEach(function (entry) {
      var idx = parseInt(entry[0], 10);
      var data = entry[1];
      if (!data || data.type !== 'gameStart') return;
      var fired = data.reversed ? alreadyFired : !alreadyFired;
      if (fired) {
        markConditionTriggered(scope, idx);
        var execCtx = { gameStart: true };
        setConditionContext(scope, idx, execCtx);
        fireGameStart(idx, scope);
      }
    });
    setAdd(started, scopeKey);
  }

  // pendingDestroy counts as destroyed immediately: an object destroyed
  // earlier this frame must not be hittable, collidable, or targetable
  // for the rest of the frame.
  function getAlivePreviewObjects() {
    var run = runState();
    var list = (run && Array.isArray(run.objects)) ? run.objects : [];
    var destroyed = destroyedSet();
    var pending = pendingSet();
    return list.filter(function (o) {
      try { return !!o && !destroyed.has(o.id) && !pending.has(o.id); } catch (e) { return false; }
    });
  }

  function getContextObjectForName(name) {
    if (!name) return null;
    var run = runState();
    var ctx = (run && run.executionContext) || {};
    var destroyed = destroyedSet();
    var candidates = [ctx.obj1, ctx.obj2, ctx.targetObjectInstance, ctx.sourceObjectInstance].filter(Boolean);
    for (var i = 0; i < candidates.length; i++) {
      var obj = candidates[i];
      try {
        if (obj && obj.name === name && !destroyed.has(obj.id)) return obj;
      } catch (e) { /* hostile candidate: skip */ }
    }
    return null;
  }

  function resolveActionTargets(data, key, options) {
    var k = key || 'targetObject';
    var opts = options || {};
    var name = (data && data[k]) || '';
    if (!name) return [];
    // The includeHidden pool (live objects minus destroyed/pending)
    // and the default pool (getAlivePreviewObjects) are the same
    // list, so one lookup serves both.
    var pool = getAlivePreviewObjects();
    var all = objectsByName(name, pool);
    if (!all.length) return [];
    var mode = (data && data.targetMode) || 'context';
    if (mode === 'all') return all;
    if (mode === 'first') return all.slice(0, 1);
    var contextObj = getContextObjectForName(name);
    return contextObj ? [contextObj] : all.slice(0, 1);
  }

  // --- Script-grid dispatch ---------------------------------------------
  function processScriptGrid(scope, fnFrame) {
    // A fresh loop budget for this frame's script phase (not for a
    // function body, which runs inside the caller's frame and shares
    // its budget, so a function called from a loop cannot reset it).
    if (!fnFrame) {
      var LB = mod('Loops');
      if (LB && typeof LB.resetLoopBudget === 'function') {
        try { LB.resetLoopBudget(loopsState()); } catch (e) { /* a throwing reset never breaks the frame */ }
      }
    }
    var run = runState();
    if (run) {
      try {
        if (!run.conditionContexts || typeof run.conditionContexts !== 'object') run.conditionContexts = {};
      } catch (e) { /* hostile run state */ }
    }
    var gd = getScopeGridData(scope);
    var cells = cellsOf();
    if (sameScope(scope, activeScope())) {
      var scopeCells = [];
      try {
        scopeCells = cells.filter(function (c) {
          var idx = parseInt(c && c.dataset ? c.dataset.index : '', 10);
          return gd[idx] !== undefined;
        });
      } catch (e) { scopeCells = []; }
      scopeCells.forEach(function (c) {
        try { if (c && c.classList && typeof c.classList.remove === 'function') c.classList.remove('triggered'); } catch (e) { /* hostile cell */ }
      });
      // P4 item 36 phase C (flow tracer): cells that fired in the last
      // 30 frames keep the cyan 'traced' ring, so the flow is visible
      // on the grid itself while the Trace panel lists the exact
      // firing order.
      var trace = mod('Trace');
      var traceState = run ? run.trace : null;
      if (trace && traceState && typeof trace.firedRecently === 'function') {
        var key = scopeKeyOf(scope);
        var frame = (run && run.frameId) || 0;
        scopeCells.forEach(function (c) {
          var idx = parseInt(c && c.dataset ? c.dataset.index : '', 10);
          var recent = false;
          try { recent = !!trace.firedRecently(traceState, key, idx, frame, 30); } catch (e) { recent = false; }
          try {
            if (c && c.classList && typeof c.classList.toggle === 'function') c.classList.toggle('traced', recent);
          } catch (e) { /* hostile cell */ }
        });
      }
    }
    // P2 item 15/12 slice 7 (shared engine): the script-grid dispatch
    // — the two-pass traversal, trigger-mode gating, trace recording,
    // and unknown-block reporting — lives in HydraDispatch, called
    // identically by the exported runtime. A dropped module tag
    // degrades to scripts not running, the same guarded-call
    // degradation the other shared modules use.
    var dispatch = mod('Dispatch');
    if (dispatch && typeof dispatch.processScope === 'function') {
      dispatch.processScope(gd, scopeKeyOf(scope), dispatchHooks(scope, fnFrame));
    }
    hostCall('renderTraceFeed', [], undefined);
  }

  // The hooks the shared dispatch module needs from the editor preview
  // runtime: the classifiers, the per-block evaluator/executor, the
  // edge-memory map, and the bookkeeping. A condition that starts a flow
  // records its context AND the execution context; a condition evaluated
  // as a gate during propagation records only its context (for the
  // and/once merge) plus the grid cell's 'triggered' mark — never the
  // execution context, so chained actions keep seeing the triggering
  // condition's context, like the exported runtime. (Flow edges target
  // actions only, so the gate path never runs today — gating is a
  // deferred feature — but the two hosts now share one contract for it.)
  // fnFrame (P5-3) is the live call frame when this scope is a
  // function body: once Return has set frame.returned, the execute
  // hook stops running further actions in the body, so Return ends
  // the function instead of only setting its value.
  function dispatchHooks(scope, fnFrame) {
    var run = runState();
    return {
      flow: mod('Flow'),
      trace: mod('Trace'),
      traceState: run ? run.trace : null,
      frameId: (run && run.frameId) || 0,
      isCondition: isConditionType,
      isAction: isActionType,
      isComment: isCommentType,
      evaluate: function (idx, data) { return evaluateCondition(data, idx, scope); },
      execute: function (idx, data) {
        if (fnFrame && fnFrame.returned) return;
        return executeAction(data, idx);
      },
      // P5-4 slice a (loops): Repeat / While run their body through
      // executeLoop, and a Break / Continue inside a body stops that
      // body propagation through shouldAbort. The Return guard applies
      // here too: once a function body has returned, a loop inside it
      // runs no further body actions, so its runBody is wrapped to
      // return an empty run instead of executing.
      isLoopBlock: function (type) {
        var L = mod('Loops');
        return !!(L && typeof L.isLoopBlock === 'function' && L.isLoopBlock(type));
      },
      executeLoop: function (idx, data, runBody) {
        if (fnFrame && fnFrame.returned) return;
        return executeLoopAction(data, idx, function () {
          if (fnFrame && fnFrame.returned) return [];
          return runBody();
        });
      },
      shouldAbort: function () {
        var L = mod('Loops');
        var s = loopsState();
        try { return !!(L && s && typeof L.controlOf === 'function' && L.controlOf(s) !== null); } catch (e) { return false; }
      },
      flowTriggerStates: flowTriggerStatesOf(),
      startedScopes: startedScopes(),
      onTriggered: function (idx, result) {
        markConditionTriggered(scope, idx);
        setConditionContext(scope, idx, (result && result.context) || {});
      },
      onPropagateCondition: function (idx, result) {
        markConditionTriggered(scope, idx);
        var r = runState();
        if (!r) return;
        try {
          if (!r.conditionContexts || typeof r.conditionContexts !== 'object') r.conditionContexts = {};
          r.conditionContexts[getConditionContextKey(scope, idx)] =
            (result && result.context) || {};
        } catch (e) { /* hostile run state: no-op */ }
      },
      reportUnknown: function (type, idx) {
        warnUnknownBlockType('block', String(type) + ' (grid cell ' + idx + ')');
      }
    };
  }


  // --- Condition context --------------------------------------------------
  // P2 item 15/12 slice 8 (shared engine): the context the shared
  // HydraConditions module needs from the editor preview runtime — one
  // builder so the evaluate call site can never drift from the
  // dispatch's. The module owns the per-block condition switch; the
  // host only describes its live run state. A dropped module tag
  // degrades to conditions reading false, the house guarded-call
  // degradation.
  function conditionCtx() {
    var run = runState();
    var input = inputState();
    var mouse = (run && run.mouse) || { x: 0, y: 0 };
    var camera = (run && run.camera) || { x: 0, y: 0, zoom: 1 };
    var canvas = canvasOf();
    return {
      variables: variables(),
      startedScopes: startedScopes(),
      hidden: hiddenSet(),
      keys: input.keysPressed,
      keysJustPressed: input.keysJustPressed,
      keysJustReleased: input.keysJustReleased,
      hasKey: keySetHas,
      mouse: mouse,
      mouseButtons: input.mouseButtons,
      mouseJustPressed: input.mouseJustPressed,
      mouseJustReleased: input.mouseJustReleased,
      mouseButtonCode: function (b) {
        var m = mod('Input');
        try { return (m && typeof m.mouseButtonCode === 'function') ? m.mouseButtonCode(b) : 0; } catch (e) { return 0; }
      },
      touchCount: input.touchCount || 0,
      gamepadConnected: !!input.gamepadConnected,
      gamepadButtons: input.gamepadButtons,
      gamepadJustPressed: input.gamepadJustPressed,
      gamepadJustReleased: input.gamepadJustReleased,
      gamepadAxes: input.gamepadAxes,
      camera: camera,
      canvasWidth: canvas ? canvas.width : 0,
      canvasHeight: canvas ? canvas.height : 0,
      named: function (name) {
        return objectsByName(name, getAlivePreviewObjects()).filter(function (o) {
          try { return !hiddenSet().has(o.id); } catch (e) { return false; }
        });
      },
      allObjects: function () { return getAlivePreviewObjects(); },
      hitbox: hitboxOf,
      isCollisionObject: isCollisionObjectOf,
      ui: mod('Ui'),
      parallaxModule: mod('Parallax'),
      pathfindModule: mod('Pathfind'),
      aiModule: mod('Ai'),
      // P4 Advanced batch 20 (virtual joystick): the module and the
      // live stick the Joystick Active / Joystick Tilt conditions
      // read through it.
      joystickModule: mod('Joystick'),
      joystick: joystickRuntime(),
      joystickConfig: joystickConfig(),
      // P4 Advanced batch 21 (health & damage): the module the
      // Health / Object Died conditions read the hit points through.
      healthModule: mod('Health'),
      // P4 Advanced batch 22 (damage feedback): the module the Is
      // Invincible condition reads the shield through.
      damageFxModule: mod('DamageFx'),
      // P4 Advanced batch 23 (checkpoints & respawn): the module the
      // Checkpoint Set / Respawn Count conditions read through, and
      // the live respawn state they read.
      respawnModule: mod('Respawn'),
      respawn: run ? run.respawn : null,
      // P4 Advanced batch 24 (enemy spawner): the module the Spawner
      // Active / Spawned Count conditions read through, and the live
      // spawner state they read.
      spawnModule: mod('Spawn'),
      spawners: run ? run.spawners : null,
      // P4 Advanced batch 25 (lives & game over): the module the Lives /
      // Game Over conditions read through, and the live lives state they read.
      livesModule: mod('Lives'),
      lives: livesRuntime(),
      // P4 Advanced batch 30 (experience & leveling): the module the
      // XP / Level / Level Up conditions read through, and the live XP
      // state they read.
      xpModule: mod('Xp'),
      xp: xpRuntime(),
      // P4 Advanced batch 32 (enemy scaling with the hero's level):
      // the module the Enemy Level condition reads through, and the
      // live scaling state it reads.
      scalingModule: mod('Scaling'),
      scaling: scalingRuntime(),
      // P4 Advanced batch 33 (boss encounters): the module the Boss
      // Phase / Boss Active conditions read through, and the live
      // boss state they read.
      bossModule: mod('Boss'),
      boss: bossRuntime(),
      // P4 Advanced batch 36 (minimap): the module the Minimap
      // Visible condition reads through, and the live minimap run
      // record (minted per scene load by the scene-reset hook).
      minimapModule: mod('Minimap'),
      minimap: minimapState(),
      // P4 Advanced batch 37 (object parenting): the module the Is
      // Attached condition reads through, and the live link table
      // it reads (minted per scene load by the scene-reset hook).
      attachModule: mod('Attach'),
      attachments: attachState(),
      // P4 Advanced batch 34 (object tags): the module the Has Tag
      // / Tagged Count conditions read through. Tags live on the
      // objects themselves, so there is no per-run tags state.
      tagsModule: mod('Tags'),
      // P5 core-engine track, item P5-1 (Variables v2, slice a):
      // the module the Scoped Variable Exists / Scoped Variable
      // Check conditions read through, and the live scoped-variable
      // state they read.
      varScopesModule: mod('Variables'),
      varScopes: variablesRuntime(),
      // P5 core-engine track, item P5-4 (Control flow + events,
      // slice c): the module the On Event condition polls through,
      // and the live event state it reads (broadcast counts per
      // name, last-seen count per listener cell).
      eventsModule: mod('Events'),
      events: eventsState(),
      // P4 Advanced batch 26 (movement abilities): the module the Jumps
      // Left / Is Dashing conditions read through, and the live
      // movement state they read.
      movementModule: mod('Movement'),
      movement: run ? run.movement : null,
      // P4 Advanced batch 27 (moving platforms & one-way platforms):
      // the module the Standing On Platform / Standing On One-Way
      // conditions read through, and the live platform state they read.
      platformModule: mod('Platform'),
      platform: run ? run.platform : null,
      // P4 Advanced batch 29 (combat): the module the Attack Ready
      // condition reads the cooldowns through, and the live combat
      // state it reads.
      combatModule: mod('Combat'),
      combat: run ? run.combat : null,
      expr: evalExprOf,
      contexts: (run && run.conditionContexts) || {},
      once: onceSet(),
      adjacentIndexes: getAdjacentIndexes,
      scopeKey: scopeKeyOf,
      timers: timersMap(),
      timerElapsedSeconds: namedTimerElapsedSeconds,
      nowMs: function () {
        var p = mod('Pause');
        var r = runState();
        try { return (p && typeof p.gameNow === 'function') ? p.gameNow(r, nowMs()) : nowMs(); } catch (e) { return nowMs(); }
      },
      frameId: (run && run.frameId) || 0,
      isPaused: function () {
        var p = mod('Pause');
        var r = runState();
        try { return !!(p && typeof p.isPaused === 'function' && p.isPaused(r)); } catch (e) { return false; }
      },
      worldSize: function () {
        var s = hostCall('getPreviewScene', [], null);
        if (!s) return null;
        return { width: hostCall('getSceneWorldWidth', [s], 0), height: hostCall('getSceneWorldHeight', [s], 0) };
      },
      triggerEntered: (run && run._triggerEntered) || [],
      triggerExited: (run && run._triggerExited) || [],
      language: hostCall('getPreviewLanguage', [], 'en'),
      dialogue: dialogueRuntime(),
      inventory: inventoryRuntime(),
      questLog: questLogRuntime(),
      achievementLog: achievementRuntime(),
      cutscene: cutsceneRuntime(),
      highScoreTable: highScoreRuntime(),
      highScoreConfig: hostCall('getProjectHighScores', [], null),
      timeScale: timeScaleRuntime(),
      transition: transitionRuntime(),
      musicCount: (run && run.busVoices && run.busVoices.counts && run.busVoices.counts.music) || 0,
      musicPaused: !!(run && run.musicPaused),
      profilerVisible: function () {
        var p = mod('Profile');
        var r = runState();
        try { return !!(p && r && r.profiler && typeof p.isVisible === 'function' && p.isVisible(r.profiler)); } catch (e) { return false; }
      },
      random: Math.random,
      actions: mod('Actions'),
      actionState: run ? run.actions : null,
      physics2d: mod('Physics2D'),
      tiles: mod('Tiles'),
      save: mod('Save'),
      anim: mod('Anim'),
      stateMachine: mod('StateMachine'),
      blendSpace: mod('BlendSpace'),
      skeleton: mod('Skeleton'),
      tween: mod('Tween'),
      collections: mod('Collections'),
      math: mod('Math'),
      pick: mod('Pick'),
      layerFx: mod('LayerFx'),
      threeD: mod('3d'),
      light2d: mod('Light2d'),
      joints: mod('Joints'),
      scriptApi: mod('ScriptApi'),
      collectionHooks: function () { return collectionHooks(); },
      mathHooks: function () { return mathHooks(); },
      pickHooks: function () { return pickHooks(); },
      layerFxConditionHooks: function () { return layerFxConditionHooks(); },
      threeDConditionHooks: function () { return threeDConditionHooks(); },
      light2dConditionHooks: function () { return light2dConditionHooks(); },
      jointConditionHooks: function () { return jointConditionHooks(); },
      scriptApiHooks: function () { return scriptApiHooks(); },
      reportUnknown: function (type) { warnUnknownBlockType('condition', type); }
    };
  }

  function evaluateCondition(data, idx, scope) {
    var conditions = mod('Conditions');
    if (!conditions || typeof conditions.evaluateCondition !== 'function') return { triggered: false };
    return conditions.evaluateCondition(data, conditionCtx(), scope, idx);
  }


  // --- Subsystem hook builders --------------------------------------------
  // The hooks the shared subsystem modules need from the editor preview
  // runtime — one builder each, so the condition/action contexts can
  // never drift from each other. Each mirrors the exported runtime's
  // hooks exactly, so preview and exported games agree.

  // P4 item 37 batch 6 (collections): hooks the shared HydraCollections
  // module needs to evaluate expressions, warn, and read variables.
  function collectionHooks() {
    return {
      num: evalExprInfoOf,
      warn: function (msg) { pushDiagnostic('warning', msg); },
      lookupVar: function (name) { return variables()[name]; }
    };
  }

  // P4 item 37 batch 10 (math/random): hooks the shared HydraMath module
  // needs to evaluate expressions, warn, and read variables.
  function mathHooks() {
    return {
      num: evalExprInfoOf,
      warn: function (msg) { pushDiagnostic('warning', msg); },
      lookupVar: function (name) { return variables()[name]; }
    };
  }

  // P4 item 37 batch 11 (object picking and selection): hooks the shared
  // HydraPick module needs — live objects by name (destroyed /
  // pending-destroy excluded, like every other preview lookup),
  // expression evaluation, and diagnostics.
  // P4 Advanced batch 35 (pick objects by tag): liveObjectsByTag hands
  // the tag picks their candidates — the live objects carrying the tag,
  // filtered through the Tags module.
  function pickHooks() {
    return {
      liveObjects: function (name) { return objectsByName(name, getAlivePreviewObjects()); },
      liveObjectsByTag: function (tag) {
        var m = mod('Tags');
        if (!m || typeof m.objectsWithTag !== 'function') return [];
        try { return m.objectsWithTag(getAlivePreviewObjects(), tag); } catch (e) { return []; }
      },
      num: evalExprInfoOf,
      warn: function (msg) { pushDiagnostic('warning', msg); }
    };
  }

  // P4 item 37 batch 12 (layers and effects): hooks the shared
  // HydraLayerFx module needs — context-aware action targets (so
  // picking works), every live object for the front/back bounds,
  // expression evaluation, and diagnostics.
  function layerFxActionHooks(data) {
    return {
      targets: function () { return resolveActionTargets(data); },
      allObjects: function () { return getAlivePreviewObjects(); },
      num: evalExprInfoOf,
      warn: function (msg) { pushDiagnostic('warning', msg); }
    };
  }
  function layerFxConditionHooks() {
    return {
      targets: function (data) { return objectsByName((data && data.targetObject) || '', getAlivePreviewObjects()); },
      allObjects: function () { return []; },
      num: evalExprInfoOf,
      warn: function (msg) { pushDiagnostic('warning', msg); }
    };
  }

  // P4 item 31: tilemap conditions (mirror the exported runtime).
  function previewTilemapsNamed(name) {
    var T = mod('Tiles');
    if (!T) return [];
    return objectsByName(name, getAlivePreviewObjects()).filter(function (o) { return o && o.kind === 'tilemap'; });
  }

  // P4 Advanced (animation state machines): the hooks the shared
  // HydraStateMachine module needs — warnings surface in the
  // diagnostics panel, plays go through HydraAnim with the state's
  // speed multiplier.
  function stateMachineHooksFor(obj) {
    return {
      warn: function (msg) { pushDiagnostic('warning', msg); },
      play: function (animName, speed) {
        var A = mod('Anim');
        try {
          if (A && typeof A.play === 'function') A.play(obj._anim, obj, animName);
          if (A && typeof A.setSpeed === 'function') A.setSpeed(obj._anim, speed);
        } catch (e) { /* hostile anim module: no-op */ }
      }
    };
  }

  // P4 Advanced (2D lighting): the hooks the shared HydraLight2d module
  // needs — targets resolve like every other action, expressions go
  // through the shared evaluator, warnings surface in the diagnostics
  // panel, darkness reads the live scene.
  function light2dActionHooks() {
    return {
      targets: function (data) { return resolveActionTargets(data); },
      num: function (exprStr) { return evalExprInfoOf(exprStr); },
      warn: function (msg) { pushDiagnostic('warning', msg); },
      scene: function () { return hostCall('getPreviewScene', [], null); }
    };
  }

  function light2dConditionHooks() {
    return {
      num: function (exprStr) { return evalExprInfoOf(exprStr); },
      darkness: function () {
        var s = hostCall('getPreviewScene', [], null);
        if (!s) return 0;
        var L = mod('Light2d');
        try { if (L && typeof L.normalizeSceneDarkness === 'function') L.normalizeSceneDarkness(s); } catch (e) { /* hostile module */ }
        return s.darkness || 0;
      }
    };
  }

  // P4 Advanced (physics joints): the hooks the shared HydraJoints module
  // needs — the live scene's joint list, the live preview objects for
  // endpoint lookup, expressions, and the diagnostics panel.
  function jointActionHooks() {
    return {
      scene: function () { return hostCall('getPreviewScene', [], null); },
      objects: function () { return getAlivePreviewObjects(); },
      num: function (exprStr) { return evalExprInfoOf(exprStr); },
      warn: function (msg) { pushDiagnostic('warning', msg); }
    };
  }

  function jointConditionHooks() {
    return { scene: function () { return hostCall('getPreviewScene', [], null); } };
  }

  // P4 item 3D1 (3D rendering foundation): hooks the shared Hydra3d
  // module needs — context-aware action targets (so picking works),
  // named-object lookup for the distance condition, expression
  // evaluation, diagnostics, and the live 3D camera (mutated in place
  // by Set 3D Camera). Mirrors the exported runtime's hooks exactly.
  function threeDActionHooks(data) {
    return {
      targets: function () { return resolveActionTargets(data); },
      num: evalExprInfoOf,
      warn: function (msg) { pushDiagnostic('warning', msg); },
      objectsByName: function (name) { return objectsByName(name || '', getAlivePreviewObjects()); },
      camera3d: function () {
        var r = runState();
        return r ? r.camera3d : null;
      },
      // P4 item 3D1 batch 2 (3D camera follow): runtime follow state
      // lives next to the live camera, never in scene.camera3d, so it
      // cannot leak into saved project JSON.
      setFollow3d: function (follow) {
        var r = runState();
        if (!r) return;
        try { r.camera3dFollow = follow; } catch (e) { /* hostile run state */ }
      },
      // P4 item 3D3 (character controllers): pointer-lock + mouse-delta
      // host hooks. The module never touches the DOM directly; the host
      // owns the browser calls through the canvas / document.
      captureMouse: function () {
        try {
          var c = canvasOf();
          if (c && typeof c.requestPointerLock === 'function') {
            c.requestPointerLock();
            return true;
          }
        } catch (e) { /* pointer lock unavailable */ }
        return false;
      },
      releaseMouse: function () {
        try {
          var d = docOf();
          if (d && d.exitPointerLock && d.pointerLockElement) d.exitPointerLock();
        } catch (e) { /* pointer lock unavailable */ }
      },
      pointerLocked: function () {
        try {
          var d = docOf();
          return !!(d && d.pointerLockElement === canvasOf());
        } catch (e) { return false; }
      },
      readMouseDelta: function () {
        var input = inputState();
        return { x: input.mouseDelta.x, y: input.mouseDelta.y };
      },
      setVar: function (name, value) {
        try { variables()[name] = value; } catch (e) { /* hostile variables */ }
      },
      // P4 item 3D4 (3D physics): the shared module's 3D On Ground / 3D
      // Collision conditions are world-dependent, so they report the
      // paused freeze through this hook instead of stale state (the 2D
      // collision/onFloor convention).
      paused: function () {
        var p = mod('Pause');
        var r = runState();
        try { return !!(p && typeof p.isPaused === 'function' && p.isPaused(r)); } catch (e) { return false; }
      }
    };
  }
  function threeDConditionHooks() {
    return threeDActionHooks({});
  }

  // P4 item 35 (text scripting API): hooks the shared HydraScriptApi
  // module needs — variables, live objects, input actions, timers,
  // audio, scenes, camera, particles, save slots, pause, profiler,
  // tiles, frame time, and diagnostics. Mirrors the exported runtime's
  // scriptApiHooks exactly so preview and exported games run scripts
  // identically.
  function scriptApiHooks() {
    var P = mod('Particles');
    var particlePresetSpec = function (kind, name, x, y) {
      var list = (P && P.PRESETS) || [];
      var want = String(name || '').trim().toLowerCase();
      var p = list.find(function (q) {
        return (q.kind === kind || q.kind === 'both') &&
          (q.id === want || String(q.label || '').toLowerCase() === want);
      }) || null;
      var spec = { x: x, y: y };
      if (p && p.fill) Object.assign(spec, p.fill);
      return spec;
    };
    var assetIdByName = function (name) {
      var lib = assetLibrary();
      var ids = Object.keys(lib);
      for (var i = 0; i < ids.length; i++) {
        if (lib[ids[i]] && lib[ids[i]].name === name) return ids[i];
      }
      return '';
    };
    var sceneIdByName = function (name) {
      var list = scenesList();
      var s = list.find(function (q) { return q && q.name === name; });
      if (s) return s.id;
      var asNum = Number(name);
      if (Number.isFinite(asNum) && list.some(function (q) { return q && q.id === asNum; })) return asNum;
      return null;
    };
    var gameClockNow = function () {
      var p = mod('Pause');
      var r = runState();
      try { return (p && typeof p.gameNow === 'function') ? p.gameNow(r, nowMs()) : nowMs(); } catch (e) { return nowMs(); }
    };
    return {
      getVar: function (n) { return variables()[n]; },
      setVar: function (n, v) { try { variables()[n] = v; } catch (e) { /* hostile variables */ } },
      hasVar: function (n) {
        try { return Object.prototype.hasOwnProperty.call(variables(), n); } catch (e) { return false; }
      },
      liveObjects: function (n) { return objectsByName(n, getAlivePreviewObjects()); },
      destroyObject: function (o) {
        if (o && o.id !== undefined) setAdd(pendingSet(), o.id);
      },
      isHidden: function (o) {
        try { return hiddenSet().has(o.id); } catch (e) { return false; }
      },
      setHidden: function (o, hide) {
        try {
          if (hide) hiddenSet().add(o.id); else hiddenSet().delete(o.id);
        } catch (e) { /* hostile set */ }
      },
      inputState: function (n) {
        var A = mod('Actions');
        var r = runState();
        var st = r ? r.actions : null;
        try {
          return {
            held: !!(A && st && typeof A.actionHeld === 'function' && A.actionHeld(st, n)),
            pressed: !!(A && st && typeof A.actionJustPressed === 'function' && A.actionJustPressed(st, n)),
            released: !!(A && st && typeof A.actionJustReleased === 'function' && A.actionJustReleased(st, n))
          };
        } catch (e) { return { held: false, pressed: false, released: false }; }
      },
      timerElapsed: function (n) { return namedTimerElapsedSeconds('named:' + n, gameClockNow()); },
      timerStart: function (n) { resetNamedTimer(n); },
      timerStop: function (n) { setNamedTimerPaused(n, true); },
      playSound: function (n, opts) {
        var o = opts || {};
        hostCall('playSound', [{ assetId: assetIdByName(n), bus: o.bus, volume: o.volume, pitch: o.pitch, loop: o.loop }, null], undefined);
      },
      stopMusic: function () { hostCall('stopPreviewMusic', [], undefined); },
      setBusVolume: function (bus, v) {
        var B = mod('AudioBuses');
        var r = runState();
        if (B && r) {
          try {
            if (!r.buses) r.buses = hostCall('getPreviewBuses', [], null);
            if (!r.buses) return;
            var b = (typeof B.normalizeBusId === 'function') ? B.normalizeBusId(bus) : bus;
            var x = Number(v);
            if (!isFinite(x)) x = r.buses[b].volume;
            r.buses[b].volume = Math.min(1, Math.max(0, x));
          } catch (e) { /* hostile buses */ }
        }
      },
      setBusMuted: function (bus, on) {
        var B = mod('AudioBuses');
        var r = runState();
        if (B && r) {
          try {
            if (!r.buses) r.buses = hostCall('getPreviewBuses', [], null);
            if (!r.buses) return;
            var b = (typeof B.normalizeBusId === 'function') ? B.normalizeBusId(bus) : bus;
            r.buses[b].muted = on === true || on === 'true';
          } catch (e) { /* hostile buses */ }
        }
      },
      musicPlaying: function () {
        var r = runState();
        var voices = r ? r.busVoices : null;
        return !!(voices && voices.counts && voices.counts.music > 0) && !(r && r.musicPaused);
      },
      switchScene: function (n) {
        var id = sceneIdByName(n);
        if (id === null) pushDiagnostic('warning', 'Script: no scene named "' + n + '", so the scene was not switched.');
        else hostCall('switchPreviewScene', [id], undefined);
      },
      currentSceneName: function () {
        var r = runState();
        var want = r ? (r.sceneId == null ? currentSceneIdOf() : r.sceneId) : currentSceneIdOf();
        var s = scenesList().find(function (q) { return q && q.id === want; });
        return s ? s.name : '';
      },
      cameraRead: function () {
        var r = runState();
        return {
          x: (r && r.camera) ? r.camera.x || 0 : 0,
          y: (r && r.camera) ? r.camera.y || 0 : 0,
          zoom: (r && r.camera) ? r.camera.zoom || 1 : 1
        };
      },
      cameraMove: function (x, y) {
        var r = runState();
        if (!r) return;
        try {
          r.camera = r.camera || { x: 0, y: 0 };
          r.camera.x = x; r.camera.y = y;
          r.camera.followTarget = '';
        } catch (e) { /* hostile run state */ }
        hostCall('clampCameraToScene', [], undefined);
      },
      cameraZoom: function (z) {
        var r = runState();
        if (!r) return;
        try {
          r.camera = r.camera || { x: 0, y: 0 };
          r.camera.zoom = zoomOf(z);
        } catch (e) { /* hostile run state */ }
        hostCall('clampCameraToScene', [], undefined);
      },
      cameraCenterOn: function (n) {
        var r = runState();
        if (!r) return;
        var canvas = canvasOf();
        try {
          r.camera = r.camera || { x: 0, y: 0, zoom: 1 };
          var target = objectsByName(n, getAlivePreviewObjects())[0];
          if (target && canvas) {
            var z = zoomOf(r.camera.zoom);
            r.camera.x = (target.posX + target.width / 2) - canvas.width / (2 * z);
            r.camera.y = (target.posY + target.height / 2) - canvas.height / (2 * z);
          }
        } catch (e) { /* hostile run state */ }
        hostCall('clampCameraToScene', [], undefined);
      },
      cameraFollow: function (n, ox, oy) {
        var r = runState();
        if (!r) return;
        try {
          r.camera = r.camera || { x: 0, y: 0, zoom: 1 };
          r.camera.followTarget = n;
          r.camera.offsetX = ox;
          r.camera.offsetY = oy;
        } catch (e) { /* hostile run state */ }
        hostCall('updateCameraFollow', [], undefined);
      },
      cameraStopFollow: function () {
        var r = runState();
        try { if (r && r.camera) r.camera.followTarget = ''; } catch (e) { /* hostile run state */ }
      },
      cameraReset: function () {
        var r = runState();
        if (!r) return;
        try { r.camera = { x: 0, y: 0, zoom: 1, followTarget: '', offsetX: 0, offsetY: 0 }; } catch (e) { /* hostile run state */ }
        hostCall('clampCameraToScene', [], undefined);
      },
      emitBurst: function (preset, x, y) {
        if (P) {
          try { P.burst(hostCall('ensurePreviewParticleState', [], null), particlePresetSpec('burst', preset, x, y)); } catch (e) { /* hostile particles */ }
        }
      },
      startEmitter: function (n, preset, x, y) {
        if (P) {
          try { P.startEmitter(hostCall('ensurePreviewParticleState', [], null), n, particlePresetSpec('emitter', preset, x, y)); } catch (e) { /* hostile particles */ }
        }
      },
      stopEmitter: function (n) {
        var r = runState();
        if (P && r && r.particles) {
          try { P.stopEmitter(r.particles, n); } catch (e) { /* hostile particles */ }
        }
      },
      clearParticles: function () {
        var r = runState();
        if (P && r && r.particles) {
          try { P.clearParticles(r.particles, ''); } catch (e) { /* hostile particles */ }
        }
      },
      saveGame: function (slot) {
        var S = mod('Save');
        if (S && typeof S.writeSlot === 'function') {
          try { S.writeSlot(S.safeStorage(), slot, variables()); } catch (e) { /* hostile save */ }
        }
      },
      loadGame: function (slot) {
        var S = mod('Save');
        var rec = null;
        try { rec = (S && typeof S.readSlot === 'function') ? S.readSlot(S.safeStorage(), slot) : null; } catch (e) { rec = null; }
        if (rec) {
          try {
            var vars = variables();
            Object.keys(rec.data).forEach(function (k) { vars[k] = rec.data[k]; });
          } catch (e) { /* hostile save record */ }
        }
      },
      deleteSave: function (slot) {
        var S = mod('Save');
        if (S && typeof S.deleteSlot === 'function') {
          try { S.deleteSlot(S.safeStorage(), slot); } catch (e) { /* hostile save */ }
        }
      },
      saveExists: function (slot) {
        var S = mod('Save');
        try { return !!(S && typeof S.slotExists === 'function' && S.slotExists(S.safeStorage(), slot)); } catch (e) { return false; }
      },
      pause: function () {
        var p = mod('Pause');
        var r = runState();
        try { if (p && typeof p.pause === 'function') p.pause(r); } catch (e) { /* hostile pause */ }
      },
      resume: function () {
        var p = mod('Pause');
        var r = runState();
        try { if (p && typeof p.resume === 'function') p.resume(r); } catch (e) { /* hostile pause */ }
      },
      isPaused: function () {
        var p = mod('Pause');
        var r = runState();
        try { return !!(p && typeof p.isPaused === 'function' && p.isPaused(r)); } catch (e) { return false; }
      },
      showProfiler: function () {
        var p = mod('Profile');
        var r = runState();
        try { if (p && r && r.profiler && typeof p.show === 'function') p.show(r.profiler); } catch (e) { /* hostile profiler */ }
      },
      hideProfiler: function () {
        var p = mod('Profile');
        var r = runState();
        try { if (p && r && r.profiler && typeof p.hide === 'function') p.hide(r.profiler); } catch (e) { /* hostile profiler */ }
      },
      profilerVisible: function () {
        var p = mod('Profile');
        var r = runState();
        try { return !!(p && r && r.profiler && typeof p.isVisible === 'function' && p.isVisible(r.profiler)); } catch (e) { return false; }
      },
      setTile: function (n, col, row, tile) {
        var T = mod('Tiles');
        if (T) {
          try { previewTilemapsNamed(n).forEach(function (tm) { T.setTile(tm, col, row, tile); }); } catch (e) { /* hostile tiles */ }
        }
      },
      tileSolidAt: function (n, px, py) {
        var T = mod('Tiles');
        try { return !!T && previewTilemapsNamed(n).some(function (tm) { return T.isSolidAtPixel(tm, px, py); }); } catch (e) { return false; }
      },
      dtSeconds: function () {
        var r = runState();
        return ((r && r.dt) || 1) / 60;
      },
      warn: function (msg) { pushDiagnostic('warning', msg); },
      log: function (msg) { try { console.log('[HydraScript]', msg); } catch (e) { /* no console */ } }
    };
  }


  // --- Action context -----------------------------------------------------
  // P2 item 15/12 slice 9 (shared engine): the context the shared
  // HydraExecute module needs from the editor preview runtime — one
  // builder so the execute call site can never drift from the condition
  // builder's. The module owns the per-block action switch; the host
  // only describes its live run state. A dropped module tag degrades to
  // actions silently not running — the same guarded-call degradation
  // the other shared modules use.
  function actionCtx() {
    var run = runState();
    var canvas = canvasOf();
    return {
      variables: variables(),
      objects: (run && Array.isArray(run.objects)) ? run.objects : [],
      hidden: hiddenSet(),
      pendingDestroy: pendingSet(),
      destroyed: destroyedSet(),
      executionContext: run ? run.executionContext : null,
      // P5-4 slice b (for-each): the loop runner points the
      // execution context at each object in turn, so body actions
      // that target the object's name hit that one object; the
      // runner restores the previous context after every round.
      setExecutionContext: function (c) {
        var r = runState();
        if (!r) return;
        try { r.executionContext = c; } catch (e) { /* hostile run state */ }
      },
      dt: (run && run.dt) || 0,
      camera: (function () {
        var r = runState();
        if (!r) return { x: 0, y: 0, zoom: 1, followTarget: '', offsetX: 0, offsetY: 0 };
        try {
          if (!r.camera) r.camera = { x: 0, y: 0, zoom: 1, followTarget: '', offsetX: 0, offsetY: 0 };
          return r.camera;
        } catch (e) { return { x: 0, y: 0, zoom: 1, followTarget: '', offsetX: 0, offsetY: 0 }; }
      })(),
      canvasWidth: canvas ? canvas.width : 0,
      canvasHeight: canvas ? canvas.height : 0,
      named: function (name, includeHidden) {
        return objectsByName(name, getAlivePreviewObjects()).filter(function (o) {
          try { return includeHidden || !hiddenSet().has(o.id); } catch (e) { return false; }
        });
      },
      allObjects: function () { return getAlivePreviewObjects(); },
      hitbox: hitboxOf,
      getPhysics: physicsOf,
      isCollisionObject: isCollisionObjectOf,
      expr: evalExprOf,
      exprInfo: evalExprInfoOf,
      random: Math.random,
      worldSize: function () {
        var s = hostCall('getPreviewScene', [], null);
        if (!s) return null;
        return { width: hostCall('getSceneWorldWidth', [s], 0), height: hostCall('getSceneWorldHeight', [s], 0) };
      },
      getScene: function () { return hostCall('getPreviewScene', [], null); },
      sceneObjectDefs: function () {
        var s = hostCall('getPreviewScene', [], null);
        return s ? (s.objects || []) : [];
      },
      scenes: scenesList(),
      sceneId: (run && run.sceneId) || currentSceneIdOf(),
      pendingSceneId: run ? run.pendingSceneId : null,
      requestScene: function (id) {
        var r = runState();
        if (!r) return;
        try { r.pendingSceneId = id; } catch (e) { /* hostile run state */ }
      },
      sceneStack: sceneStack(),
      clampCamera: function () { hostCall('clampCameraToScene', [], undefined); },
      updateCameraFollow: function () { hostCall('updateCameraFollow', [], undefined); },
      shake: run ? run.cameraShake : null,
      flash: run ? run.flash : null,
      shakeCooldownOk: function (data, idx) {
        // Preview-only cooldown (exports never had one): a screen-shake
        // block cannot re-fire within its own cooldown window.
        var now = nowMs();
        var cd = (data && data.cooldown != null) ? data.cooldown : 0.25;
        var cooldownMs = Math.max(0, evalExprOf(cd) * 1000);
        var key = 'shake_' + idx;
        var cooldowns = shakeCooldowns();
        var last = 0;
        try { last = cooldowns.get(key) || 0; } catch (e) { last = 0; }
        if (cooldownMs && now - last < cooldownMs) return false;
        try { cooldowns.set(key, now); } catch (e) { /* hostile map */ }
        return true;
      },
      cameraFx: mod('CameraFx'),
      warn: function (msg) { pushDiagnostic('warning', msg); },
      warnFlashColor: warnFlashColor,
      warnReadTimerBlank: warnReadTimerBlank,
      reportUnknown: function (type) { warnUnknownBlockType('action', type); },
      playSound: function (data, idx) { hostCall('playSound', [data, 'sound_' + idx], undefined); },
      stopMusic: function () { hostCall('stopPreviewMusic', [], undefined); },
      pauseMusic: function () { hostCall('pausePreviewMusic', [], undefined); },
      resumeMusic: function () { hostCall('resumePreviewMusic', [], undefined); },
      stopAllSounds: function () { hostCall('stopAllPreviewSounds', [], undefined); },
      buses: (function () {
        var r = runState();
        if (!r) return null;
        try {
          if (!r.buses) r.buses = hostCall('getPreviewBuses', [], null);
          return r.buses;
        } catch (e) { return r.buses || null; }
      })(),
      audioBuses: mod('AudioBuses'),
      setMasterVolume: function (v) {
        var r = runState();
        if (!r) return;
        try { r.masterVolume = v; } catch (e) { /* hostile run state */ }
      },
      save: mod('Save'),
      storage: (function () { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; } })(),
      pause: mod('Pause'),
      pauseState: run,
      profile: mod('Profile'),
      profilerState: run ? run.profiler : null,
      particles: mod('Particles'),
      particleState: run ? run.particles : null,
      ensureParticles: function () { return hostCall('ensurePreviewParticleState', [], null); },
      actions: mod('Actions'),
      actionsState: run ? run.actions : null,
      tiles: mod('Tiles'),
      anim: mod('Anim'),
      stateMachine: mod('StateMachine'),
      blendSpace: mod('BlendSpace'),
      tween: mod('Tween'),
      collections: mod('Collections'),
      math: mod('Math'),
      layerFx: mod('LayerFx'),
      threeD: mod('3d'),
      light2d: mod('Light2d'),
      joints: mod('Joints'),
      skeleton: mod('Skeleton'),
      localization: mod('Localization'),
      scriptApi: mod('ScriptApi'),
      sceneInit: mod('SceneInit'),
      physics2d: mod('Physics2D'),
      collectionHooks: function () { return collectionHooks(); },
      mathHooks: function () { return mathHooks(); },
      layerFxActionHooks: function (data) { return layerFxActionHooks(data); },
      threeDActionHooks: function (data) { return threeDActionHooks(data); },
      light2dActionHooks: function () { return light2dActionHooks(); },
      jointActionHooks: function () { return jointActionHooks(); },
      scriptApiHooks: function () { return scriptApiHooks(); },
      sceneInitHooks: function () { return hostCall('sceneInitHooks', [], {}); },
      stateMachineHooks: function (obj) { return stateMachineHooksFor(obj); },
      timers: timersMap(),
      nowMs: nowMs,
      frozenNowMs: function () {
        var p = mod('Pause');
        var r = runState();
        try { return (p && typeof p.gameNow === 'function') ? p.gameNow(r, nowMs()) : nowMs(); } catch (e) { return nowMs(); }
      },
      timerElapsedSeconds: namedTimerElapsedSeconds,
      localizationTable: hostCall('getPreviewLocalization', [], null),
      getLanguage: function () { return hostCall('getPreviewLanguage', [], 'en'); },
      setLanguage: function (code) {
        var r = runState();
        if (!r) return;
        try { r.language = code; } catch (e) { /* hostile run state */ }
      },
      applyBoundTexts: function () { hostCall('applyPreviewBoundTexts', [], undefined); },
      dialogueModule: mod('Dialogue'),
      dialogue: dialogueRuntime(),
      dialogues: hostCall('getProjectDialogues', [], []),
      dialogueHooks: function () { return dialogueHooks(); },
      inventoryModule: mod('Inventory'),
      inventory: inventoryRuntime(),
      items: hostCall('getProjectItems', [], []),
      inventoryHooks: function () { return inventoryHooks(); },
      questModule: mod('Quest'),
      questLog: questLogRuntime(),
      quests: hostCall('getProjectQuests', [], []),
      questHooks: function () { return questHooks(); },
      achievementModule: mod('Achievement'),
      achievementLog: achievementRuntime(),
      achievements: hostCall('getProjectAchievements', [], []),
      achievementHooks: function () { return achievementHooks(); },
      cutsceneModule: mod('Cutscene'),
      cutscene: cutsceneRuntime(),
      cutscenes: hostCall('getProjectCutscenes', [], []),
      cutsceneHooks: function () { return cutsceneHooks(); },
      highScoreModule: mod('HighScore'),
      highScoreTable: highScoreRuntime(),
      highScoreConfig: hostCall('getProjectHighScores', [], null),
      highScoreHooks: function () { return highScoreHooks(); },
      timeScaleModule: mod('TimeScale'),
      timeScale: timeScaleRuntime(),
      timeScaleHooks: function () { return timeScaleHooks(); },
      transitionModule: mod('Transition'),
      transition: transitionRuntime(),
      transitionConfig: hostCall('getProjectTransitionConfig', [], null),
      transitionHooks: function () { return transitionHooks(); },
      // P4 Advanced batch 15 (camera feel): the module, the live feel
      // record (a getter — the record is replaced on every scene load,
      // so the execute module must read it fresh each call), and the
      // Reset Camera feel restore.
      cameraFeelModule: mod('CameraFeel'),
      cameraFeel: function () {
        var r = runState();
        return (r && r.cameraFeel) ? r.cameraFeel : null;
      },
      // P4 Advanced batch 16 (parallax backgrounds): the module the
      // Set Parallax action writes the live objects' factors through.
      parallaxModule: mod('Parallax'),
      // P4 Advanced batch 17 (positional audio): the module the Play
      // Sound at Position action mixes its volume and pan through.
      spatialAudioModule: mod('SpatialAudio'),
      // P4 Advanced batch 18 (pathfinding): the module the Follow Path /
      // Stop Path actions plan and walk through.
      pathfindModule: mod('Pathfind'),
      // P4 Advanced batch 19 (AI behaviors): the module the Set AI
      // Behavior / Stop AI actions write the behavior record through.
      aiModule: mod('Ai'),
      // P4 Advanced batch 20 (virtual joystick): the module and the
      // live stick the Enable / Disable Joystick actions flip.
      joystickModule: mod('Joystick'),
      joystick: joystickRuntime(),
      joystickConfig: joystickConfig(),
      // P4 Advanced batch 21 (health & damage): the module the Damage /
      // Heal / Set Health / Set Max Health actions write the hit
      // points through.
      healthModule: mod('Health'),
      // P4 Advanced batch 22 (damage feedback): the module the Show
      // Damage Number / Make Invincible / Knockback Object actions run
      // through, and the live floating-number state (created lazily, so
      // a game that never shows a number never pays for the list).
      damageFxModule: mod('DamageFx'),
      damageNumbers: run ? run.damageNumbers : null,
      ensureDamageNumbers: function () { return hostCall('ensurePreviewDamageNumberState', [], null); },
      // P4 Advanced batch 23 (checkpoints & respawn): the module the
      // Set Checkpoint / Respawn Object / Clear Checkpoint actions run
      // through, and the live respawn state (created lazily, so a game
      // that never sets a checkpoint never pays for the record).
      respawnModule: mod('Respawn'),
      respawn: run ? run.respawn : null,
      ensureRespawnState: function () { return hostCall('ensurePreviewRespawnState', [], null); },
      // P4 Advanced batch 24 (enemy spawner): the module the Start
      // Spawner / Stop Spawner / Read Spawned Count actions run
      // through, and the live spawner state (created lazily, so a game
      // that never starts a spawner never pays for the record).
      spawnModule: mod('Spawn'),
      spawners: run ? run.spawners : null,
      ensureSpawnerState: function () { return hostCall('ensurePreviewSpawnerState', [], null); },
      // P4 Advanced batch 25 (lives & game over): the module the Set /
      // Add / Lose / Read Lives actions run through, and the live lives
      // state (created lazily, so a game that never touches lives never
      // pays for the record).
      livesModule: mod('Lives'),
      lives: livesRuntime(),
      // P4 Advanced batch 30 (experience & leveling): the module the
      // Add / Set / Read XP actions run through, and the live XP state
      // (created lazily, so a game that never touches XP never pays
      // for the record).
      xpModule: mod('Xp'),
      xp: xpRuntime(),
      // P4 Advanced batch 31 (level-up rewards & stat growth): the
      // module the Grow / Level Reward / Read Bonus actions run
      // through, and the live growth state (created lazily, so a game
      // that never grows never pays for the record).
      growthModule: mod('Growth'),
      growth: growthRuntime(),
      // P4 Advanced batch 32 (enemy scaling with the hero's level):
      // the module the Set Enemy Level / Set Scaling Rates / Scale
      // to Hero Level / Read blocks run through, and the live scaling
      // state (created lazily, so a game that never scales never pays
      // for the record).
      scalingModule: mod('Scaling'),
      scaling: scalingRuntime(),
      // P4 Advanced batch 33 (boss encounters): the module the Start
      // / End / Show / Hide / Read Boss Phase blocks run through,
      // and the live boss state (created lazily, so a game that never
      // fights a boss never pays for the record).
      bossModule: mod('Boss'),
      boss: bossRuntime(),
      // P4 Advanced batch 36 (minimap): the module the Show / Hide /
      // Set Minimap Size / Set Minimap Zoom blocks run through, and
      // the live minimap run record (minted per scene load by the
      // scene-reset hook).
      minimapModule: mod('Minimap'),
      minimap: minimapState(),
      // P4 Advanced batch 37 (object parenting): the module the
      // Attach / Detach / Set Attachment Offset blocks run through,
      // and the live link table they write (minted per scene load
      // by the scene-reset hook).
      attachModule: mod('Attach'),
      attachments: attachState(),
      // P4 Advanced batch 34 (object tags): the module the Add /
      // Remove / Clear Tag / Read Tagged Count blocks run through.
      // Tags live on the objects themselves, so there is no per-run
      // tags state.
      tagsModule: mod('Tags'),
      // P5 core-engine track, item P5-1 (Variables v2, slice a):
      // the module the Set / Read / Delete / Clear Scoped Variable
      // actions run through, and the live scoped-variable state
      // (created lazily, so a game that never scopes a variable
      // never pays for the record).
      varScopesModule: mod('Variables'),
      varScopes: variablesRuntime(),
      // P5 core-engine track, item P5-3 (Functions / custom blocks,
      // slice a): the module the Call Function / Return From Function
      // actions run through, and the host hooks that push a call
      // frame, run the body, and set the return value.
      functionsModule: mod('Functions'),
      callFunction: function (name, args) { return callPreviewFunction(name, args); },
      returnFromFunction: function (value) { return returnPreviewFunction(value); },
      // P5 core-engine track, item P5-4 (Control flow + events,
      // slice a): the module the Repeat / While / Break / Continue
      // actions run through, and the live loop state (depth, Break /
      // Continue flag, per-frame budget) they share.
      loopsModule: mod('Loops'),
      loopState: loopsState(),
      // P5 core-engine track, item P5-4 (Control flow + events,
      // slice c): the module the Broadcast Event action runs through,
      // and the live event state (broadcast counts per name) it writes.
      eventsModule: mod('Events'),
      eventState: eventsState(),
      // P5 core-engine track, item P5-5 (Object primitives, slice a):
      // the module the Pick Object Into Variable action picks through,
      // and the live-object hooks it picks from.
      pick: mod('Pick'),
      pickHooks: function () { return pickHooks(); },
      // P4 Advanced batch 26 (movement abilities): the module the Jump /
      // Dash / Set Max Jumps / Set Coyote Time / Set Jump Buffer actions
      // run through, and the live movement state (created lazily, so a
      // game that never jumps never pays for the record).
      movementModule: mod('Movement'),
      movement: run ? run.movement : null,
      ensureMovementState: function () { return hostCall('ensurePreviewMovementState', [], null); },
      // P4 Advanced batch 27 (moving platforms & one-way platforms):
      // the module the Set Platform Path / Set One-Way Platform /
      // Set Crumble Time actions run through, and the live platform
      // state (created lazily, so a game that never moves a platform
      // never pays for the record).
      platformModule: mod('Platform'),
      platform: run ? run.platform : null,
      ensurePlatformState: function () { return hostCall('ensurePreviewPlatformState', [], null); },
      // P4 Advanced batch 29 (combat): the module the Melee Attack /
      // Shoot Projectile actions run through, and the live combat
      // state (created lazily, so a game that never fights never pays
      // for the record).
      combatModule: mod('Combat'),
      combat: run ? run.combat : null,
      ensureCombatState: function () { return hostCall('ensurePreviewCombatState', [], null); },
      resetCameraFeel: function () {
        var CF = mod('CameraFeel');
        var r = runState();
        if (!CF || !r) return;
        var sc = hostCall('getPreviewScene', [], null);
        try {
          r.cameraFeel = (typeof CF.freshCameraFeel === 'function')
            ? CF.freshCameraFeel(sc ? sc.cameraFeel : null) : null;
        } catch (e) { /* a throwing reset leaves the feel alone */ }
      }
    };
  }

  function executeAction(data, idx) {
    var execute = mod('Execute');
    if (!execute || typeof execute.executeAction !== 'function') return;
    execute.executeAction(data, actionCtx(), idx);
  }

  // P5-4 slice a (loops): the dispatch's executeLoop hook — a Repeat
  // / While block runs its body chain through here, with the body
  // runner the flow module built for it. A dropped module tag
  // degrades to the loop not running, the same guarded-call
  // degradation the other shared modules use.
  function executeLoopAction(data, idx, runBody) {
    var execute = mod('Execute');
    if (!execute || typeof execute.executeLoopAction !== 'function') return false;
    return execute.executeLoopAction(data, actionCtx(), idx, runBody);
  }

  // --- Dialogue runtime ---------------------------------------------------
  // (P4 Advanced batch 7: named conversations from the Dialogues tab.
  // The runtime lives in this module, like the input state: one per
  // factory instance, created lazily through the HydraDialogue module,
  // reset on a fresh run (resetGame) and ended on every scene load
  // (the sceneResetHooks resetDialogue entry). The project table
  // arrives through host.getProjectDialogues(); a dropped module tag
  // or a missing host entry degrades to dialogues quietly not running,
  // the same guarded-call degradation the other shared modules use.
  // The per-frame typewriter update runs from the runScripts phase,
  // before the grids run, so a condition reading the dialogue sees
  // this frame's text; it runs while paused too, like the pause menu —
  // dialogue is UI, the world is frozen.)
  var dialogueRt = null;

  function dialogueRuntime() {
    if (!dialogueRt) {
      var D = mod('Dialogue');
      try { dialogueRt = (D && typeof D.createDialogueRuntime === 'function') ? D.createDialogueRuntime() : null; } catch (e) { dialogueRt = null; }
    }
    return dialogueRt;
  }

  function dialogueHooks() {
    return {
      warn: function (msg) { pushDiagnostic('warning', msg); },
      setObjectText: function (name, text) {
        if (!name) return;
        var objs = getAlivePreviewObjects();
        var hidden = hiddenSet();
        objs.forEach(function (o) {
          try {
            if (o && o.name === name && o.kind === 'text' &&
              !(hidden && typeof hidden.has === 'function' && hidden.has(o.id))) o._runtimeText = text;
          } catch (e) { /* one bad object never breaks the text pass */ }
        });
      }
    };
  }

  // Advance the typewriter one frame (dt in 60fps units, like the frame
  // step: 1 per 16.67ms).
  function updatePreviewDialogue(dt) {
    var D = mod('Dialogue');
    if (!D || typeof D.updateDialogue !== 'function') return;
    try { D.updateDialogue(dialogueRuntime(), (Number(dt) || 0) / 60, dialogueHooks()); } catch (e) { /* a throwing update never breaks the frame */ }
  }

  // End any running dialogue (scene load / fresh run). The bound labels
  // keep their last line — the module stops writing, it never blanks
  // them — so this is safe to call before the new scene's bound-text
  // pass has run.
  function resetDialogueRuntime() {
    var D = mod('Dialogue');
    try {
      if (dialogueRt && D && typeof D.stopDialogue === 'function') D.stopDialogue(dialogueRt, dialogueHooks());
    } catch (e) { /* a throwing stop never breaks the reset */ }
    dialogueRt = null;
  }

  // --- Inventory runtime --------------------------------------------------
  // (P4 Advanced batch 8: named items from the Items tab, carried in a
  // per-run backpack. The runtime lives in this module, like the input
  // state and the dialogue runtime: one per factory instance, created
  // lazily through the HydraInventory module, reset on a fresh run
  // (resetGame) only — it SURVIVES scene switches inside a run, like
  // the language, so there is deliberately no sceneResetHooks entry
  // for it. The project table arrives through host.getProjectItems();
  // a dropped module tag or a missing host entry degrades to items
  // quietly not working, the same guarded-call degradation the other
  // shared modules use.)
  var inventoryRt = null;

  function inventoryRuntime() {
    if (!inventoryRt) {
      var I = mod('Inventory');
      try { inventoryRt = (I && typeof I.createInventoryRuntime === 'function') ? I.createInventoryRuntime() : null; } catch (e) { inventoryRt = null; }
    }
    return inventoryRt;
  }

  function inventoryHooks() {
    return {
      warn: function (msg) { pushDiagnostic('warning', msg); }
    };
  }

  // Empty the backpack and drop the runtime (fresh run). The next
  // access creates a new empty backpack through the module.
  function resetInventoryRuntime() {
    var I = mod('Inventory');
    try {
      if (inventoryRt && I && typeof I.clearInventory === 'function') I.clearInventory(inventoryRt);
    } catch (e) { /* a throwing clear never breaks the reset */ }
    inventoryRt = null;
  }

  // --- Quest runtime ------------------------------------------------------
  // (P4 Advanced batch 9: named objectives from the Quests tab, tracked
  // in a per-run quest log. The runtime lives in this module, like the
  // input state and the inventory runtime: one per factory instance,
  // created lazily through the HydraQuest module, reset on a fresh run
  // (resetGame) only — it SURVIVES scene switches inside a run, like
  // the backpack and the language, so there is deliberately no
  // sceneResetHooks entry for it. The project table arrives through
  // host.getProjectQuests(); a dropped module tag or a missing host
  // entry degrades to quests quietly not working, the same guarded-call
  // degradation the other shared modules use.)
  var questLogRt = null;

  function questLogRuntime() {
    if (!questLogRt) {
      var Q = mod('Quest');
      try { questLogRt = (Q && typeof Q.createQuestRuntime === 'function') ? Q.createQuestRuntime() : null; } catch (e) { questLogRt = null; }
    }
    return questLogRt;
  }

  function questHooks() {
    return {
      warn: function (msg) { pushDiagnostic('warning', msg); }
    };
  }

  // Empty the quest log and drop the runtime (fresh run). The next
  // access creates a new empty log through the module.
  function resetQuestLogRuntime() {
    var Q = mod('Quest');
    try {
      if (questLogRt && Q && typeof Q.clearQuests === 'function') Q.clearQuests(questLogRt);
    } catch (e) { /* a throwing clear never breaks the reset */ }
    questLogRt = null;
  }

  // --- Lives runtime ------------------------------------------------------
  // (P4 Advanced batch 25: how many chances the player gets, tracked
  // in a plain lives record. The runtime lives in this module, like
  // the input state and the quest-log runtime: one per factory
  // instance, created lazily through the HydraLives module, reset on
  // a fresh run (resetGame) only — it SURVIVES scene switches inside
  // a run, like the backpack and the quest log, so there is
  // deliberately no sceneResetHooks entry for it. A dropped module
  // tag degrades to lives quietly not working, the same guarded-call
  // degradation the other shared modules use.)
  var livesRt = null;

  function livesRuntime() {
    if (!livesRt) {
      var L = mod('Lives');
      try { livesRt = (L && typeof L.createLivesState === 'function') ? L.createLivesState() : null; } catch (e) { livesRt = null; }
    }
    return livesRt;
  }

  // Drop the lives runtime (fresh run). The next access creates a new
  // record with the default 3 lives through the module.
  function resetLivesRuntime() {
    livesRt = null;
  }

  // --- XP runtime ---------------------------------------------------------
  // (P4 Advanced batch 30: experience & leveling, tracked in a plain
  // XP record. The runtime lives in this module, like the input state
  // and the lives runtime: one per factory instance, created lazily
  // through the HydraXp module, reset on a fresh run (resetGame) only
  // — it SURVIVES scene switches inside a run, like the lives count,
  // so there is deliberately no sceneResetHooks entry for it. A
  // dropped module tag degrades to XP quietly not working, the same
  // guarded-call degradation the other shared modules use.)
  var xpRt = null;

  function xpRuntime() {
    if (!xpRt) {
      var X = mod('Xp');
      try { xpRt = (X && typeof X.createXpState === 'function') ? X.createXpState() : null; } catch (e) { xpRt = null; }
    }
    return xpRt;
  }

  // Drop the XP runtime (fresh run). The next access creates a new
  // record with 0 XP at level 1 through the module.
  function resetXpRuntime() {
    xpRt = null;
  }

  // --- Growth runtime -----------------------------------------------------
  // (P4 Advanced batch 31: level-up rewards & stat growth, tracked in
  // a plain per-object bonus record. The runtime lives in this module,
  // like the input state and the XP runtime: one per factory instance,
  // created lazily through the HydraGrowth module, reset on a fresh
  // run (resetGame) only — it SURVIVES scene switches inside a run,
  // like the XP total, so there is deliberately no sceneResetHooks
  // entry for it. A dropped module tag degrades to growth quietly not
  // working, the same guarded-call degradation the other shared
  // modules use.)
  var growthRt = null;

  function growthRuntime() {
    if (!growthRt) {
      var G = mod('Growth');
      try { growthRt = (G && typeof G.createGrowthState === 'function') ? G.createGrowthState() : null; } catch (e) { growthRt = null; }
    }
    return growthRt;
  }

  // Drop the growth runtime (fresh run). The next access creates a new
  // record with no bonuses anywhere through the module.
  function resetGrowthRuntime() {
    growthRt = null;
  }

  // --- Scaling runtime ----------------------------------------------------
  // (P4 Advanced batch 32: enemy scaling with the hero's level, tracked
  // in a plain per-object level record. The runtime lives in this module,
  // like the input state and the growth runtime: one per factory instance,
  // created lazily through the HydraScaling module, reset on a fresh
  // run (resetGame) only — it SURVIVES scene switches inside a run,
  // like the growth ledger, so there is deliberately no sceneResetHooks
  // entry for it. A dropped module tag degrades to scaling quietly not
  // working, the same guarded-call degradation the other shared
  // modules use.)
  var scalingRt = null;

  function scalingRuntime() {
    if (!scalingRt) {
      var S = mod('Scaling');
      try { scalingRt = (S && typeof S.createScalingState === 'function') ? S.createScalingState() : null; } catch (e) { scalingRt = null; }
    }
    return scalingRt;
  }

  // Drop the scaling runtime (fresh run). The next access creates a new
  // record with no levels anywhere through the module.
  function resetScalingRuntime() {
    scalingRt = null;
  }

  // (P4 Advanced batch 33 — boss encounters: the per-run boss fight.
  // The runtime lives in this module, like the input state and the
  // scaling runtime: one per factory instance, created lazily through
  // the HydraBoss module, reset on a fresh run (resetGame) only — it
  // SURVIVES scene switches inside a run, like the scaling ledger,
  // so there is deliberately no sceneResetHooks entry for it. A
  // dropped module tag degrades to boss fights quietly not working,
  // the same guarded-call degradation the other shared modules use.)
  var bossRt = null;

  function bossRuntime() {
    if (!bossRt) {
      var B = mod('Boss');
      try { bossRt = (B && typeof B.createBossState === 'function') ? B.createBossState() : null; } catch (e) { bossRt = null; }
    }
    return bossRt;
  }

  // Drop the boss runtime (fresh run). The next access creates a new
  // record with no fight running through the module.
  function resetBossRuntime() {
    bossRt = null;
  }

  // The run record lives in this module, like the boss runtime: one
  // per factory instance, minted per scene load by the scene-reset
  // hook (minimapOf below) from the scene's authored config, reset
  // on a fresh run (resetGame) only. The record the hook minted is
  // the record the draw hook and the condition / action contexts
  // read, so a block that hides the map mid-run and the map the
  // draw paints never disagree. A dropped module tag degrades to
  // the map quietly not showing, the same guarded-call degradation
  // the other shared modules use.
  //
  // The launch order bites here: launchPreview mints the record
  // through the scene reset and then calls resetGame, which drops
  // this module's stash — the same wipe the boss runtime survives
  // by lazy-minting on access. The minimap cannot lazy-mint (its
  // record is per scene, not per run), so this accessor falls back
  // to the run state's record, which the scene reset minted into
  // the same object the hook stashed. A run state with no minimap
  // record still reads as null.
  var minimapRt = null;

  function minimapState() {
    if (minimapRt) return minimapRt;
    try {
      var rs = runState();
      return (rs && rs.minimap) || null;
    } catch (e) { return null; }
  }

  // Drop the minimap runtime (fresh run). The next scene load mints
  // a new record from the scene's config through the hook.
  function resetMinimapRuntime() {
    minimapRt = null;
  }

  // The attachment link table lives in the run state, minted per
  // scene load by the scene-reset hook (createAttachState below).
  // There is no module-level stash to drop, so the accessor reads
  // the run state fresh on every call — the launch order that bit
  // the minimap (launchPreview mints through the scene reset, then
  // resetGame drops the stash) cannot bite here. A run state with
  // no link table still reads as null.
  function attachState() {
    try {
      var rs = runState();
      return (rs && rs.attachments) || null;
    } catch (e) { return null; }
  }

  // (P5 core-engine track, item P5-1: Variables v2, slice a — scoped
  // variables, tracked in global / scene / object maps. The runtime
  // lives in this module, like the input state and the scaling
  // runtime: one per factory instance, created lazily through the
  // HydraVariables module, reset on a fresh run (resetGame) only.
  // Global and object scopes SURVIVE scene switches inside a run,
  // like the scaling ledger; the scene scope resets on scene load
  // (clearPreviewSceneVariables below, called from the scene-load
  // paths), so there is deliberately no sceneResetHooks entry for
  // it. A dropped module tag degrades to scoped variables quietly
  // not working, the same guarded-call degradation the other shared
  // modules use.)
  var variablesRt = null;

  function variablesRuntime() {
    if (!variablesRt) {
      var V = mod('Variables');
      try { variablesRt = (V && typeof V.createVariablesState === 'function') ? V.createVariablesState() : null; } catch (e) { variablesRt = null; }
    }
    return variablesRt;
  }

  // Drop the variables runtime (fresh run). The next access creates a
  // new record with no variables anywhere through the module.
  function resetVariablesRuntime() {
    variablesRt = null;
  }

  // Clear the scene about to load's scoped variables, so a fresh
  // visit starts from zero. Global and object scopes are untouched.
  function clearPreviewSceneVariables(sceneId) {
    var V = mod('Variables');
    if (!V || typeof V.clearScene !== 'function') return;
    try { V.clearScene(variablesRuntime(), sceneId); } catch (e) { /* a throwing clear never breaks scene load */ }
  }

  // (P5 core-engine track, item P5-1: Variables v2, slice b — the
  // authored definitions from the Variables manager, seeded into
  // the run state. The table arrives through
  // host.getProjectScopedVariables(); a dropped module tag or a
  // missing host entry degrades to no definitions, the same
  // guarded-call degradation the other shared modules use.)
  // Seed the run-start definitions (global + object scopes) into a
  // fresh run state, right after the reset drops the old one.
  function seedPreviewRunVariables() {
    var V = mod('Variables');
    if (!V || typeof V.seedRun !== 'function') return;
    try { V.seedRun(variablesRuntime(), hostCall('getProjectScopedVariables', [], [])); } catch (e) { /* a throwing seed never breaks a fresh run */ }
  }

  // Seed the scene definitions for the scene about to load (one copy
  // per scene at its starting value), right after the clear above
  // wipes the scene scope — every visit to a scene starts from its
  // starting values (mirrors the exported runtime).
  function seedPreviewSceneVariables(sceneId) {
    var V = mod('Variables');
    if (!V || typeof V.seedScene !== 'function') return;
    try { V.seedScene(variablesRuntime(), hostCall('getProjectScopedVariables', [], []), sceneId); } catch (e) { /* a throwing seed never breaks scene load */ }
  }

  // --- Custom functions (P5-3) ------------------------------------------
  // (P5 core-engine track, item P5-3: Functions / custom blocks,
  // slice a — the call stack lives in this module, like the
  // variables runtime: one per factory instance, created lazily
  // through the HydraFunctions module, reset on a fresh run
  // (resetGame) only. Calls are synchronous inside one frame, so
  // the stack is always empty between frames.)
  var fnCallState = null;

  function functionsCallState() {
    if (!fnCallState) {
      var F = mod('Functions');
      try { fnCallState = (F && typeof F.createCallState === 'function') ? F.createCallState() : null; } catch (e) { fnCallState = null; }
    }
    return fnCallState;
  }

  // Drop the call stack (fresh run). The next access creates a new
  // record with no live calls through the module.
  function resetFunctionsCallState() {
    fnCallState = null;
  }

  // The loop state (P5 core-engine track, item P5-4: Control flow +
  // events, slice a — Repeat / While / Break / Continue): one per
  // factory instance, created lazily through the HydraLoops module,
  // reset on a fresh run (resetGame) only. Loops are synchronous
  // inside one frame, so the depth is always 0 between frames, and
  // the per-frame budget is reset at the start of each script phase
  // in processScriptGrid below.
  var loopState = null;

  function loopsState() {
    if (!loopState) {
      var L = mod('Loops');
      try { loopState = (L && typeof L.createLoopState === 'function') ? L.createLoopState() : null; } catch (e) { loopState = null; }
    }
    return loopState;
  }

  // Drop the loop state (fresh run). The next access creates a new
  // record with a full budget through the module.
  function resetLoopsState() {
    loopState = null;
  }

  // The custom-event state (P5 core-engine track, item P5-4:
  // Control flow + events, slice c — Broadcast Event / On Event):
  // one per factory instance, created lazily through the
  // HydraEvents module, reset on a fresh run (resetGame) only. It
  // survives scene switches inside a run, so a broadcast in one
  // scene reaches a listener in the next scene on the next frame.
  var eventState = null;

  function eventsState() {
    if (!eventState) {
      var E = mod('Events');
      try { eventState = (E && typeof E.createEventState === 'function') ? E.createEventState() : null; } catch (e) { eventState = null; }
    }
    return eventState;
  }

  // Drop the event state (fresh run). The next access creates a new
  // record with empty counts through the module.
  function resetEventsState() {
    eventState = null;
  }

  // The function definitions for this project (through
  // host.getProjectFunctions(); a dropped module tag or a missing
  // host entry degrades to no functions, the same guarded-call
  // degradation the other shared modules use).
  function projectFunctions() {
    var F = mod('Functions');
    if (!F || typeof F.normalizeFunctions !== 'function') return [];
    try { return F.normalizeFunctions(hostCall('getProjectFunctions', [], [])); } catch (e) { return []; }
  }

  // Run a named function once and hand back its return value (the
  // Call Function block's host hook — mirrors the exported runtime:
  // push a call frame, bind the parameters as local variables, run
  // the body grid, restore the locals and the execution context).
  // Returns { ok: true, value }, { ok: false, reason: 'missing' },
  // or { ok: false, reason: 'depth' }.
  function callPreviewFunction(name, args) {
    var F = mod('Functions');
    var V = mod('Variables');
    if (!F || typeof F.findFunction !== 'function') return { ok: false, reason: 'missing' };
    var fn = null;
    try { fn = F.findFunction(projectFunctions(), name); } catch (e) { fn = null; }
    if (!fn) return { ok: false, reason: 'missing' };
    var frame = null;
    try { frame = F.call(functionsCallState(), fn); } catch (e) { frame = null; }
    if (!frame) return { ok: false, reason: 'depth' };
    var scopeKey = null;
    try { scopeKey = F.scopeKeyFor(fn.id); } catch (e) { scopeKey = null; }
    var run = runState();
    var prevExec = run ? run.executionContext : null;
    var prevLocal = null;
    try {
      if (V && typeof V.bindLocalScope === 'function') prevLocal = V.bindLocalScope(variablesRuntime(), frame.locals);
      var list = Array.isArray(args) ? args : [];
      for (var i = 0; i < fn.params.length; i++) {
        if (i >= list.length) break;
        try {
          if (V && typeof V.set === 'function') V.set(variablesRuntime(), 'local', fn.params[i], list[i]);
        } catch (e) { /* a throwing seed never breaks the call */ }
      }
      if (scopeKey !== null) processScriptGrid(scopeKey, frame);
    } finally {
      try { if (V && typeof V.restoreLocalScope === 'function') V.restoreLocalScope(variablesRuntime(), prevLocal); } catch (e) { /* a throwing restore never breaks the call */ }
      if (run) { try { run.executionContext = prevExec; } catch (e) { /* hostile run state */ } }
    }
    var done = null;
    try { done = F.endCall(functionsCallState()); } catch (e) { done = null; }
    return { ok: true, value: (done && done.returnValue !== undefined) ? done.returnValue : 0 };
  }

  // Set the innermost call's return value (the Return From Function
  // block's host hook). Returns true, or false when no function is
  // running (the execute module warns on false).
  function returnPreviewFunction(value) {
    var F = mod('Functions');
    if (!F || typeof F.returnFrom !== 'function') return false;
    try { return !!F.returnFrom(functionsCallState(), value); } catch (e) { return false; }
  }

  // --- Achievement runtime ------------------------------------------------
  // (P4 Advanced batch 10: permanent trophies from the Achievements
  // tab, tracked in an unlocked set. The runtime lives in this module,
  // like the input state and the quest-log runtime: one per factory
  // instance, created lazily through the HydraAchievement module. It
  // is loaded from storage on first access (the per-project
  // `hydraAchievements:<projectId>` key, through host.getProjectId())
  // and written back on every change through the hooks' persist — and
  // it is deliberately NEVER reset: not on a fresh run (resetGame),
  // not on a scene switch (there is no sceneResetHooks entry for it).
  // Permanence is the point — only the Reset Achievements / Lock
  // Achievement blocks take trophies back. The project table arrives
  // through host.getProjectAchievements(); a dropped module tag or a
  // missing host entry degrades to achievements quietly not working,
  // the same guarded-call degradation the other shared modules use.)
  var achievementRt = null;

  function achievementRuntime() {
    if (!achievementRt) {
      var A = mod('Achievement');
      try {
        var names = (A && typeof A.loadUnlocked === 'function')
          ? A.loadUnlocked(A.safeStorage(), hostCall('getProjectId', [], ''))
          : [];
        achievementRt = (A && typeof A.createAchievementRuntime === 'function') ? A.createAchievementRuntime(names) : null;
      } catch (e) { achievementRt = null; }
    }
    return achievementRt;
  }

  function achievementHooks() {
    return {
      warn: function (msg) { pushDiagnostic('warning', msg); },
      persist: function () { persistAchievements(); }
    };
  }

  // Write the current unlocked set back into storage (per-project key).
  // A missing module, a missing runtime, or unavailable storage is a
  // quiet no-op — the game keeps playing with achievements in memory.
  function persistAchievements() {
    var A = mod('Achievement');
    try {
      if (A && achievementRt && typeof A.saveUnlocked === 'function') {
        A.saveUnlocked(A.safeStorage(), hostCall('getProjectId', [], ''),
          A.unlockedAchievementNames(achievementRt));
      }
    } catch (e) { /* a throwing persist never breaks the run */ }
  }

  // --- Cutscene runtime ---------------------------------------------------
  // (P4 Advanced batch 11: scripted scenes from the Cutscenes tab,
  // played step by step. The runtime lives in this module, like the
  // input state and the quest-log runtime: one per factory instance,
  // created lazily through the HydraCutscene module, reset on a fresh
  // run (resetGame) only — it SURVIVES scene switches inside a run,
  // like the quest log, so there is deliberately no sceneResetHooks
  // entry for it. The project table arrives through
  // host.getProjectCutscenes(); a dropped module tag or a missing host
  // entry degrades to cutscenes quietly not playing, the same
  // guarded-call degradation the other shared modules use. The
  // per-frame update runs from the runScripts phase, before the grids
  // run, so a condition reading the cutscene sees this frame's step;
  // it freezes while paused, like the world sim — the module returns
  // early on the hooks' paused flag.)
  var cutsceneRt = null;

  function cutsceneRuntime() {
    if (!cutsceneRt) {
      var C = mod('Cutscene');
      try { cutsceneRt = (C && typeof C.createCutsceneRuntime === 'function') ? C.createCutsceneRuntime() : null; } catch (e) { cutsceneRt = null; }
    }
    return cutsceneRt;
  }

  function cutsceneHooks() {
    var p = mod('Pause');
    var r = runState();
    var paused = false;
    try { paused = !!(p && r && typeof p.isPaused === 'function' && p.isPaused(r)); } catch (e) { paused = false; }
    return {
      warn: function (msg) { pushDiagnostic('warning', msg); },
      paused: paused,
      getObjectPosition: function (name) {
        var objs = getAlivePreviewObjects();
        var hidden = hiddenSet();
        for (var i = 0; i < objs.length; i++) {
          try {
            var o = objs[i];
            if (o && o.name === name &&
              !(hidden && typeof hidden.has === 'function' && hidden.has(o.id))) {
              return { x: o.posX, y: o.posY };
            }
          } catch (e) { /* one bad object never breaks the lookup */ }
        }
        return null;
      },
      setObjectPosition: function (name, x, y) {
        var objs = getAlivePreviewObjects();
        var hidden = hiddenSet();
        objs.forEach(function (o) {
          try {
            if (o && o.name === name &&
              !(hidden && typeof hidden.has === 'function' && hidden.has(o.id))) {
              o.posX = x; o.posY = y;
            }
          } catch (e) { /* one bad object never breaks the write */ }
        });
      },
      setObjectText: function (name, text) {
        if (!name) return;
        var objs = getAlivePreviewObjects();
        var hidden = hiddenSet();
        objs.forEach(function (o) {
          try {
            if (o && o.name === name && o.kind === 'text' &&
              !(hidden && typeof hidden.has === 'function' && hidden.has(o.id))) o._runtimeText = text;
          } catch (e) { /* one bad object never breaks the text pass */ }
        });
      },
      playSound: function (name) {
        var lib = assetLibrary();
        var assetId = '';
        var ids = Object.keys(lib);
        for (var i = 0; i < ids.length; i++) {
          if (lib[ids[i]] && lib[ids[i]].name === name) { assetId = ids[i]; break; }
        }
        if (!assetId) return false;
        hostCall('playSound', [{ assetId: assetId }, null], undefined);
        return true;
      },
      switchScene: function (name) {
        var list = scenesList();
        var target = null;
        for (var i = 0; i < list.length; i++) {
          if (list[i] && list[i].name === name) { target = list[i]; break; }
        }
        if (!target) {
          var asNum = Number(name);
          if (Number.isFinite(asNum)) {
            for (var j = 0; j < list.length; j++) {
              if (list[j] && list[j].id === asNum) { target = list[j]; break; }
            }
          }
        }
        if (!target) return false;
        var run = runState();
        if (!run) return false;
        try { run.pendingSceneId = target.id; } catch (e) { return false; }
        return true;
      }
    };
  }

  // Advance the running cutscene one frame (dt in 60fps units, like the
  // frame step: 1 per 16.67ms).
  function updatePreviewCutscene(dt) {
    var C = mod('Cutscene');
    if (!C || typeof C.updateCutscene !== 'function') return;
    try { C.updateCutscene(cutsceneRuntime(), hostCall('getProjectCutscenes', [], []), (Number(dt) || 0) / 60, cutsceneHooks()); } catch (e) { /* a throwing update never breaks the frame */ }
  }

  // Drop the cutscene runtime (fresh run). The next access creates a
  // new empty runtime through the module — nothing playing, nothing
  // finished — so a fresh run never starts with a stale Cutscene
  // Finished. A mid-glide object stays where it is; the fresh run's
  // scene init puts every object back at its authored spot.
  function resetCutsceneRuntime() {
    cutsceneRt = null;
  }

  // --- High-score runtime -------------------------------------------------
  // (P4 Advanced batch 12: the ranked leaderboard from the High
  // Scores tab. The runtime lives in this module, like the input
  // state and the unlocked-set runtime: one per factory instance,
  // created lazily through the HydraHighScore module. It is loaded
  // from storage on first access (the per-project
  // `hydraHighScores:<projectId>` key, through host.getProjectId())
  // and written back on every change through the hooks' persist — and
  // it is deliberately NEVER reset: not on a fresh run (resetGame),
  // not on a scene switch (there is no sceneResetHooks entry for it).
  // Permanence is the point — only the Clear High Scores block takes
  // scores back. The table config arrives through
  // host.getProjectHighScores(); a dropped module tag or a missing
  // host entry degrades to high scores quietly not working, the same
  // guarded-call degradation the other shared modules use.
  // clearHighScoreTable is the editor tab's Clear button: it empties
  // the live table (which persists the empty table) so the stored
  // board and the running preview agree at once.)
  var highScoreRt = null;

  function highScoreRuntime() {
    if (!highScoreRt) {
      var H = mod('HighScore');
      try {
        var entries = (H && typeof H.loadEntries === 'function')
          ? H.loadEntries(H.safeStorage(), hostCall('getProjectId', [], ''))
          : [];
        var config = hostCall('getProjectHighScores', [], null);
        highScoreRt = (H && typeof H.createHighScoreRuntime === 'function') ? H.createHighScoreRuntime(entries, config) : null;
      } catch (e) { highScoreRt = null; }
    }
    return highScoreRt;
  }

  function highScoreHooks() {
    return {
      warn: function (msg) { pushDiagnostic('warning', msg); },
      persist: function () { persistHighScores(); }
    };
  }

  // Write the current table back into storage (per-project key). A
  // missing module, a missing runtime, or unavailable storage is a
  // quiet no-op — the game keeps playing with scores in memory.
  function persistHighScores() {
    var H = mod('HighScore');
    try {
      if (H && highScoreRt && typeof H.saveEntries === 'function') {
        H.saveEntries(H.safeStorage(), hostCall('getProjectId', [], ''),
          H.highScoreList(highScoreRt));
      }
    } catch (e) { /* a throwing persist never breaks the run */ }
  }

  // Empty the live table (and persist the empty table). Returns true
  // only when anything was cleared; a missing module or runtime is a
  // quiet no-op.
  function clearHighScoreTable() {
    var H = mod('HighScore');
    try {
      if (H && highScoreRt && typeof H.clearHighScores === 'function') {
        return H.clearHighScores(highScoreRt, highScoreHooks());
      }
    } catch (e) { /* a throwing clear never breaks the editor */ }
    return false;
  }

  // --- Time-scale runtime -------------------------------------------------
  // (P4 Advanced batch 13: the whole game clock runs faster or
  // slower. The runtime lives in this module, like the input state
  // and the cutscene runtime: one per factory instance, created
  // lazily through the HydraTimeScale module, reset on a fresh run
  // (resetGame) only — it SURVIVES scene switches inside a run, like
  // the quest log and the language, so there is deliberately no
  // sceneResetHooks entry for it. A dropped module tag degrades to
  // the scale quietly staying 1, the same guarded-call degradation
  // the other shared modules use. The game-clock debt is NOT held
  // here: it lives on the run state (state.timeScaleDebtMs, next to
  // pausedElapsedMs), banked per frame by the gameLoop and read by
  // HydraPause.gameNow, and the scene reset clears it with the rest
  // of the clock.)
  var timeScaleRt = null;

  function timeScaleRuntime() {
    if (!timeScaleRt) {
      var T = mod('TimeScale');
      try { timeScaleRt = (T && typeof T.createTimeScaleRuntime === 'function') ? T.createTimeScaleRuntime() : null; } catch (e) { timeScaleRt = null; }
    }
    return timeScaleRt;
  }

  function timeScaleHooks() {
    return {
      warn: function (msg) { pushDiagnostic('warning', msg); }
    };
  }

  // Drop the time-scale runtime (fresh run). The next access creates
  // a new runtime at normal speed, so a fresh run never starts in
  // slow motion because the last run ended there.
  function resetTimeScaleRuntime() {
    timeScaleRt = null;
  }

  // --- Transition runtime -------------------------------------------------
  // (P4 Advanced batch 14: fade / wipe between scenes. The runtime
  // lives in this module, like the input state and the cutscene
  // runtime: one per factory instance, created lazily through the
  // HydraTransition module, reset on a fresh run (resetGame) only —
  // it SURVIVES scene switches inside a run, like the quest log and
  // the language, so there is deliberately no sceneResetHooks entry
  // for it: the transition IS the switch. The project default arrives
  // through host.getProjectTransitionConfig(); a dropped module tag
  // or a missing host entry degrades to transitions quietly not
  // playing, the same guarded-call degradation the other shared
  // modules use. The per-frame update runs from the runScripts
  // phase, before the grids run, so a condition reading the
  // transition sees this frame's phase; it freezes while paused,
  // like the world sim.)
  var transitionRt = null;

  function transitionRuntime() {
    if (!transitionRt) {
      var TR = mod('Transition');
      try { transitionRt = (TR && typeof TR.createTransitionRuntime === 'function') ? TR.createTransitionRuntime() : null; } catch (e) { transitionRt = null; }
    }
    return transitionRt;
  }

  function transitionHooks() {
    var p = mod('Pause');
    var r = runState();
    var paused = false;
    try { paused = !!(p && r && typeof p.isPaused === 'function' && p.isPaused(r)); } catch (e) { paused = false; }
    return {
      warn: function (msg) { pushDiagnostic('warning', msg); },
      paused: paused,
      sceneExists: function (target) {
        var want = (target == null) ? '' : String(target).trim();
        if (!want) return false;
        var list = scenesList();
        for (var i = 0; i < list.length; i++) {
          if (!list[i]) continue;
          if (list[i].name === want) return true;
          if (Number(list[i].id) === Number(want)) return true;
        }
        return false;
      },
      switchScene: function (name) {
        return cutsceneHooks().switchScene(name);
      }
    };
  }

  // Advance the running transition one frame (dt in 60fps units, like
  // the frame step: 1 per 16.67ms).
  function updatePreviewTransition(dt) {
    var TR = mod('Transition');
    if (!TR || typeof TR.updateTransition !== 'function') return;
    try { TR.updateTransition(transitionRuntime(), hostCall('getProjectTransitionConfig', [], null), (Number(dt) || 0) / 60, transitionHooks()); } catch (e) { /* a throwing update never breaks the frame */ }
  }

  // Drop the transition runtime (fresh run). The next access creates
  // a new empty runtime through the module — nothing playing, nothing
  // finished — so a fresh run never starts with a stale Transition
  // Finished. A mid-fade overlay vanishes with it; the fresh run's
  // scene init puts every object back at its authored spot.
  function resetTransitionRuntime() {
    transitionRt = null;
  }

  // --- Joystick runtime -----------------------------------------------------
  // (P4 Advanced batch 20: the on-screen stick a player drags to
  // steer. The runtime lives in this module, like the transition
  // runtime: one per factory instance, created lazily through the
  // HydraJoystick module, reset on a fresh run (resetGame) only — it
  // SURVIVES scene switches inside a run, like the language, so a
  // level that enables the stick keeps it across the next scene. The
  // project default arrives through host.getProjectJoystickConfig();
  // a dropped module tag or a missing host entry degrades to the
  // stick quietly not working, the same guarded-call degradation
  // the other shared modules use. The per-frame output runs from
  // the updateJoystick phase, after the input poll and before the
  // grids run, so a condition reading joystickX or a driven action
  // sees this frame's tilt; it runs while paused too, like the
  // input poll.)
  var joystickRt = null;

  function joystickConfig() {
    return hostCall('getProjectJoystickConfig', [], null);
  }

  function joystickRuntime() {
    if (!joystickRt) {
      var J = mod('Joystick');
      try {
        joystickRt = (J && typeof J.createJoystickRuntime === 'function')
          ? J.createJoystickRuntime(joystickConfig()) : null;
      } catch (e) { joystickRt = null; }
    }
    return joystickRt;
  }

  // The runtime for drawing: null while no run is active, so the
  // stopped scene view never shows a stick the game is not running.
  // (loopRunning is the module's own run flag, set by startGame and
  // cleared by resetGame / stopPreviewLoop.)
  function joystickRuntimeForDraw() {
    return loopRunning ? joystickRuntime() : null;
  }

  // Drop the joystick runtime (fresh run). The next access creates a
  // new stick from the project default — enabled or not — so a fresh
  // run never starts with a held stick or a stale tilt.
  function resetJoystickRuntime() {
    joystickRt = null;
  }

  // --- Run loop host --------------------------------------------------------
  // (P2 item 14, slice 8 — the final slice: the frame loop and the run
  // lifecycle live here now; script.js keeps thin delegations
  // (gameLoop / launchPreview / loadPreviewScene / resetGame /
  // startGame / stopPreviewLoop / initGame / updateCameraFollow /
  // switchPreviewScene) so every existing call site is unchanged.
  // With this slice the editor is a DOM-only module host: script.js
  // owns the editor UI (grid, palette, panels, scene editor) and the
  // draw builders, and this module owns the whole preview runtime.
  //
  // The loop itself is the same shape the editor preview always had:
  // gameLoop computes the frame timing, hands the subsystem calls to
  // the shared HydraFrame module in canonical order, draws through
  // the host's drawGame, and re-arms with requestAnimationFrame — so
  // the scene view keeps rendering quietly while the game is stopped,
  // exactly as the old boot loop did. launchPreview / loadPreviewScene
  // / resetGame are the run lifecycle: fresh objects through
  // HydraSceneInit, fresh run state through HydraSceneReset, fresh
  // input actions / audio buses / master fader per run, the gameStart
  // launch path, and the rAF chain.
  //
  // Live editor state reaches this section only through configure():
  // the same host object the dispatch host uses, plus the run-loop
  // entries (getCurrentScene, getProjectInputActions,
  // getProjectMasterVolume, resizeGameCanvas, resetTraceRender,
  // clearRuntimeDiagnostics, getSoundCooldowns, drawGame,
  // commitActiveGrid). Every host entry is optional; a missing or
  // throwing entry degrades to its safe default instead of breaking
  // the loop — the game still draws, the world just does not advance,
  // the same guarded-call degradation a dropped module tag gives.
  // The shared engine modules (HydraFrame, HydraSceneInit,
  // HydraSceneReset, HydraCameraFx, HydraPhysicsStep, Hydra3d,
  // HydraJoints, HydraAnim, HydraBlendSpace, HydraSkeleton,
  // HydraTween, HydraParticles, HydraUi, HydraProfile, HydraTrace,
  // HydraPause, HydraAudioBuses, HydraLocalization, HydraDialogue,
  // HydraStage)
  // arrive through the `getModule(name)` provider, which defaults to
  // a globalThis lookup ('Hydra' + name); the named input actions
  // arrive through the getHydraActions provider, like the input host.
  //
  // The loop lifecycle state (running flag, rAF handle, last frame
  // time) is module-private, like the input providers: one loop per
  // factory instance, re-armed by the module's own gameLoop, so
  // stopPreviewLoop always cancels the chain the module started.
  // The run state object itself is never named here and never stored:
  // host.getRunState() returns the live object fresh on every read,
  // and the module only ever mutates its fields, never replaces the
  // object. The dispatch Sets and Maps arrive through the same host
  // getters the dispatch host uses; the sound-cooldown Map has its
  // own getter (getSoundCooldowns) with a per-instance fallback.
  //
  // Documented behavior deltas (all in this section):
  // - A throwing phase hook no longer propagates: the old inline loop
  //   let a throwing subsystem call escape gameLoop (HydraFrame's
  //   phase guard catches it today, so the frame already continued);
  //   the module additionally guards the stepFrame call itself and
  //   every per-object update, so one bad object never skips the
  //   remaining objects in its phase. The frame outcome is unchanged
  //   (the phase is skipped, the frame continues); only the blast
  //   radius shrinks.
  // - cloneData degrades to an empty object list when the scene's
  //   objects cannot be cloned (circular / corrupt data): the old
  //   inline clone threw and broke the load. A corrupt scene now
  //   loads empty instead of breaking the preview.
  // - updateCameraFollow / updateUiWidgetStates read the canvas size
  //   through host.getCanvas() and degrade to 0 when there is no
  //   canvas; the old inline code read the editor's canvas global
  //   directly. A live editor always has the canvas, so this changes
  //   no live behavior.
  // - launchPreview resets the run language to the project's default
  //   through the HydraLocalization module, exactly as the old inline
  //   code did; loadPreviewScene keeps the run's current language
  //   through host.getPreviewLanguage(), exactly as the old code did
  //   (current language first, default when none is set).
  // - startRenderLoop only arms the chain when requestAnimationFrame
  //   exists; in a node test (no rAF) the loop runs one frame per
  //   explicit gameLoop call instead.

  var loopRunning = false;
  var loopRaf = null;
  var loopLastTime = 0;
  var fallbackSoundCooldowns = new Map();

  function soundCooldowns() {
    var m = hostCall('getSoundCooldowns', [], null);
    return (m && typeof m.get === 'function' && typeof m.set === 'function') ? m : fallbackSoundCooldowns;
  }

  // Deep-clone scene objects for a run (the old script.js cloneData):
  // a corrupt list degrades to an empty run instead of breaking the load.
  function cloneData(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch (e) { return Array.isArray(value) ? [] : value; }
  }

  // The canvas default size (the old script.js initGame): a zero-size
  // canvas starts at 800x600; a sized canvas is left alone.
  function initGame() {
    var canvas = canvasOf();
    if (canvas && canvas.width === 0) {
      try { canvas.width = 800; canvas.height = 600; } catch (e) { /* hostile canvas */ }
    }
  }

  function startGame() { loopRunning = true; }

  function stopPreviewLoop() {
    loopRunning = false;
    if (loopRaf) {
      try {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(loopRaf);
      } catch (e) { /* no rAF (node tests) */ }
      loopRaf = null;
    }
  }

  // Arm the quiet render loop the editor boots with (the scene view
  // renders while the game is stopped); the loop re-arms itself.
  function startRenderLoop() {
    try {
      if (typeof requestAnimationFrame === 'function') loopRaf = requestAnimationFrame(gameLoop);
    } catch (e) { /* no rAF (node tests): the loop never starts */ }
  }

  // 2D camera follow (the old script.js updateCameraFollow): keep the
  // zoom valid, park the viewport on the follow target's center, and
  // clamp to the scene. The target comes from the alive list, so a
  // destroyed or pending-destroy target is never followed.
  // P4 Advanced batch 15 (camera feel): the park itself runs through
  // the shared HydraCameraFeel module — deadzone desire, smoothing
  // glide, bounds clamp — so the preview glides and bounds exactly
  // like an export. rs.dt is the scaled frame step in 60fps units.
  // A dropped module tag degrades to the old snap-to-center follow.
  function updateCameraFollow() {
    var rs = runState();
    if (!rs) return;
    var camera = rs.camera;
    if (!camera) return;
    var zoom = hostCall('normalizeCameraZoom', [camera.zoom], 1);
    try { camera.zoom = zoom; } catch (e) { return; }
    if (!camera.followTarget) return;
    var alive = getAlivePreviewObjects();
    var found = hostCall('getObjectsByName', [camera.followTarget, alive], []);
    var target = (found && found[0]) || null;
    if (!target) return;
    var z = hostCall('normalizeCameraZoom', [camera.zoom], 1);
    var canvas = canvasOf();
    var cw = canvas ? canvas.width : 0;
    var ch = canvas ? canvas.height : 0;
    var CF = mod('CameraFeel');
    if (!CF || typeof CF.updateFollowCamera !== 'function') {
      try {
        camera.x = (target.posX + target.width / 2) - cw / (2 * z) + (camera.offsetX || 0);
        camera.y = (target.posY + target.height / 2) - ch / (2 * z) + (camera.offsetY || 0);
      } catch (e) { return; }
      hostCall('clampCameraToScene', [], undefined);
      return;
    }
    var sc = hostCall('getPreviewScene', [], null);
    var sceneSize = null;
    if (sc) {
      sceneSize = {
        width: hostCall('getSceneWorldWidth', [sc], 0),
        height: hostCall('getSceneWorldHeight', [sc], 0)
      };
    }
    try {
      CF.updateFollowCamera(camera,
        {
          x: (target.posX || 0) + (target.width || 0) / 2 + (camera.offsetX || 0),
          y: (target.posY || 0) + (target.height || 0) / 2 + (camera.offsetY || 0)
        },
        { width: cw, height: ch }, z, rs.cameraFeel, (Number(rs.dt) || 0) / 60, sceneSize);
    } catch (e) { return; }
    hostCall('clampCameraToScene', [], undefined);
  }

  // 3D camera follow (the old script.js update3dCameraFollow): one
  // frame of Follow 3D Object through the shared Hydra3d tick.
  function update3dCameraFollow() {
    var H3 = mod('3d');
    var rs = runState();
    if (!H3 || !rs || !rs.camera3d || !rs.camera3dFollow) return;
    if (typeof H3.tick3dCameraFollow !== 'function') return;
    try {
      H3.tick3dCameraFollow(rs.camera3d, rs.camera3dFollow, function (name) {
        return hostCall('getObjectsByName', [name, getAlivePreviewObjects()], []);
      });
    } catch (e) { /* a throwing 3D tick never breaks the frame */ }
  }

  // Button hover/press state (the old script.js updateUiWidgetStates):
  // precomputed once per frame so Object Clicked / Mouse Over
  // conditions and the button visuals agree. Runs while paused too.
  function updateUiWidgetStates(objs) {
    var Ui = mod('Ui');
    if (!Ui) return;
    var rs = runState();
    var canvas = canvasOf();
    var input = inputState();
    var cam = (rs && rs.camera) || { x: 0, y: 0 };
    var m = (input && input.mouse) || { x: 0, y: 0 };
    var cw = canvas ? canvas.width : 0;
    var ch = canvas ? canvas.height : 0;
    var list = objs || [];
    list.forEach(function (obj) {
      try {
        if (!Ui.isButton(obj)) { obj._uiState = 'normal'; return; }
        var sp = Ui.isAnchored(obj)
          ? Ui.resolveWidgetPosition(obj, cw, ch)
          : { x: obj.posX || 0, y: obj.posY || 0 };
        var fixed = Ui.isScreenFixed(obj);
        var bz = fixed ? 1 : hostCall('normalizeCameraZoom', [cam.zoom], 1);
        // Parallax (P4 Advanced batch 16): a parallax button draws
        // against its parallax camera, so its hover box must use the
        // same camera or the hover shows where the button used to be.
        var pc = { x: cam.x || 0, y: cam.y || 0 };
        if (!fixed) {
          var PX = mod('Parallax');
          if (PX && typeof PX.parallaxCamera === 'function') {
            try { var pc2 = PX.parallaxCamera(cam, obj); if (pc2) pc = pc2; } catch (e) { /* keep the raw camera */ }
          }
        }
        var sx = fixed ? sp.x : (sp.x - (pc.x || 0)) * bz;
        var sy = fixed ? sp.y : (sp.y - (pc.y || 0)) * bz;
        var w = (obj.width || 1) * bz, h = (obj.height || 1) * bz;
        var inside = m.x >= sx && m.x <= sx + w && m.y >= sy && m.y <= sy + h;
        var buttons = (input && input.mouseButtons) || EMPTY_INPUT.mouseButtons;
        obj._uiState = !inside ? 'normal' : (buttons.has(0) ? 'pressed' : 'hover');
      } catch (e) { /* one bad widget never breaks the frame */ }
    });
  }

  // The readers + subsystem modules the shared HydraPhysicsStep module
  // needs (the old script.js physicsStepHooks): one builder so the
  // physics call site can never drift apart from the export's.
  function physicsStepHooks() {
    var H3 = mod('3d');
    var rs = runState();
    return {
      getPhysics: function (o) { return hostCall('getPhysics', [o], {}); },
      hitbox: function (o) { return hostCall('getHitbox', [o], null); },
      isCollisionObject: function (o) { return hostCall('isCollisionObject', [o], false); },
      is3dKind: (H3 && typeof H3.is3dKind === 'function') ? H3.is3dKind : null,
      isLight3d: (H3 && typeof H3.isLight3d === 'function') ? H3.isLight3d : null,
      physics2d: mod('Physics2D'),
      tiles: mod('Tiles'),
      prevTriggerPairs: (rs && rs._triggerPairs) || {}
    };
  }

  // The collections + subsystem modules the shared HydraSceneReset
  // module needs (the old script.js sceneResetHooks): one builder so
  // the scene-load call sites (loadPreviewScene and launchPreview)
  // can never drift apart from each other.
  function sceneResetHooks() {
    var H3 = mod('3d');
    var Parts = mod('Particles');
    return {
      normalizeCamera3d: function (camera3d, sc) {
        if (!H3 || typeof H3.normalizeCamera3d !== 'function') return null;
        try { return H3.normalizeCamera3d(camera3d, sc); } catch (e) { return null; }
      },
      createParticleState: function () {
        if (!Parts || typeof Parts.createParticleState !== 'function') return null;
        try { return Parts.createParticleState(); } catch (e) { return null; }
      },
      // P4 Advanced batch 22 (damage feedback): a fresh floating-number
      // state per scene load, so a fresh scene never inherits the last
      // scene's numbers (mirrors the exported runtime). A dropped
      // module tag reads as null — no numbers draw.
      createDamageNumbers: function () {
        var DF = mod('DamageFx');
        if (!DF || typeof DF.createDamageNumberState !== 'function') return null;
        try { return DF.createDamageNumberState(); } catch (e) { return null; }
      },
      // P4 Advanced batch 23 (checkpoints & respawn): a fresh respawn
      // state per scene load, so a fresh scene starts with no
      // checkpoint and a zero respawn count (mirrors the exported
      // runtime). A dropped module tag reads as null — respawns fall
      // back to staying put.
      createRespawnState: function () {
        var RM = mod('Respawn');
        if (!RM || typeof RM.createRespawnState !== 'function') return null;
        try { return RM.createRespawnState(); } catch (e) { return null; }
      },
      // P4 Advanced batch 24 (enemy spawner): a fresh spawner state
      // per scene load, so a fresh scene starts with no spawners
      // running (mirrors the exported runtime). A dropped module tag
      // reads as null — spawners simply never run.
      createSpawnerState: function () {
        var SP = mod('Spawn');
        if (!SP || typeof SP.createSpawnerState !== 'function') return null;
        try { return SP.createSpawnerState(); } catch (e) { return null; }
      },
      // P4 Advanced batch 26 (movement abilities): a fresh movement
      // state per scene load, so a fresh scene starts with no dash in
      // flight, no buffered jump, and a full jump count (mirrors the
      // exported runtime). A dropped module tag reads as null —
      // jumps and dashes simply never run.
      createMovementState: function () {
        var MV = mod('Movement');
        if (!MV || typeof MV.createMovementState !== 'function') return null;
        try { return MV.createMovementState(); } catch (e) { return null; }
      },
      // P4 Advanced batch 27 (moving platforms & one-way platforms):
      // a fresh platform state per scene load, so a fresh scene starts
      // with every platform back at its first waypoint and no crumble
      // timer running (mirrors the exported runtime). A dropped module
      // tag reads as null — platforms simply never move.
      createPlatformState: function () {
        var PF = mod('Platform');
        if (!PF || typeof PF.createPlatformState !== 'function') return null;
        try { return PF.createPlatformState(); } catch (e) { return null; }
      },
      // P4 Advanced batch 29 (combat): a fresh combat state per scene
      // load, so a fresh scene starts with no cooldowns spent, no
      // projectiles flying, and no slash showing (mirrors the exported
      // runtime). A dropped module tag reads as null — attacks simply
      // never run.
      createCombatState: function () {
        var CB = mod('Combat');
        if (!CB || typeof CB.createCombatState !== 'function') return null;
        try { return CB.createCombatState(); } catch (e) { return null; }
      },
      hidden: hiddenSet(),
      destroyed: destroyedSet(),
      pendingDestroy: pendingSet(),
      timers: timersMap(),
      once: onceSet(),
      startedScopes: startedScopes(),
      resetContexts: function () { resetFrameConditionContexts(); },
      // P4 Advanced batch 15 (camera feel): a fresh copy of the scene's
      // smoothing / deadzone / bounds for this run (mirrors the exported
      // runtime). A dropped module tag reads as null — the follow then
      // runs with the defaults (snap, no deadzone, scene edges).
      cameraFeelOf: function (scene) {
        var CF = mod('CameraFeel');
        if (!CF || typeof CF.freshCameraFeel !== 'function') return null;
        try { return CF.freshCameraFeel(scene ? scene.cameraFeel : null); } catch (e) { return null; }
      },
      // P4 Advanced batch 36 (minimap): a fresh copy of the scene's
      // corner map for this run (mirrors the exported runtime). The
      // record is stashed in this module, so the draw hook and the
      // condition / action contexts read the same record the scene
      // load minted. A dropped module tag reads as null — the draw
      // shows no map, and the blocks stay quiet.
      minimapOf: function (scene) {
        var M = mod('Minimap');
        if (!M || typeof M.createMinimapState !== 'function') { minimapRt = null; return null; }
        try { minimapRt = M.createMinimapState(scene ? scene.minimap : null); } catch (e) { minimapRt = null; }
        return minimapRt;
      },
      // P4 Advanced batch 37 (object parenting): a fresh link table
      // per scene load, so a fresh scene starts with no links
      // (mirrors the exported runtime). A dropped module tag reads
      // as null — the apply phase then moves nothing.
      createAttachState: function () {
        var A = mod('Attach');
        if (!A || typeof A.createAttachState !== 'function') return null;
        try { return A.createAttachState(); } catch (e) { return null; }
      },
      // P4 Advanced batch 7 (dialogue): a scene load ends a running
      // dialogue, so a fresh scene never inherits a half-finished
      // conversation (mirrors the exported runtime).
      resetDialogue: function () { resetDialogueRuntime(); }
    };
  }

  // Fresh run state (the old script.js resetGame): stopped, fresh edge
  // memory, cleared per-run collections, fresh profiler + tracer, and
  // the canvas default size. Scene switches never reset here — only a
  // fresh run does.
  function resetGame() {
    loopRunning = false;
    resetGameStartState();
    resetDialogueRuntime();
    resetInventoryRuntime();
    resetQuestLogRuntime();
    resetLivesRuntime();
    resetXpRuntime();
    resetGrowthRuntime();
    resetScalingRuntime();
    resetBossRuntime();
    resetMinimapRuntime();
    resetVariablesRuntime();
    resetFunctionsCallState();
    resetLoopsState();
    resetEventsState();
    // P5 core-engine track, item P5-1 (Variables v2, slice b): the
    // reset above drops the run state, so seed the authored
    // definitions (global + object scopes) into the fresh one — a
    // variable created in the Variables manager exists from the
    // first frame without any block setting it. The scene definitions
    // seed per scene load (loadPreviewScene / launchPreview below).
    seedPreviewRunVariables();
    resetCutsceneRuntime();
    resetTimeScaleRuntime();
    resetTransitionRuntime();
    resetJoystickRuntime();
    loopLastTime = 0;
    var rs = runState();
    if (rs) {
      try { rs.frameId = 0; } catch (e) { /* hostile run state */ }
    }
    resetFrameConditionContexts();
    if (rs) {
      try { rs.flowTriggerStates = {}; } catch (e) { /* hostile run state */ }
    }
    try { onceSet().clear(); } catch (e) { /* hostile set */ }
    try { soundCooldowns().clear(); } catch (e) { /* hostile map */ }
    try { shakeCooldowns().clear(); } catch (e) { /* hostile map */ }
    try { timersMap().clear(); } catch (e) { /* hostile map */ }
    try { sceneStack().length = 0; } catch (e) { /* hostile stack */ }
    resetRunInput(inputState());
    var Profile = mod('Profile');
    var Trace = mod('Trace');
    if (rs) {
      try {
        rs.profiler = (Profile && typeof Profile.createProfiler === 'function') ? Profile.createProfiler() : null;
      } catch (e) { try { rs.profiler = null; } catch (ignored) { /* hostile run state */ } }
      try {
        rs.trace = (Trace && typeof Trace.createTracer === 'function') ? Trace.createTracer() : null;
      } catch (e) { try { rs.trace = null; } catch (ignored) { /* hostile run state */ } }
    }
    hostCall('resetTraceRender', [], undefined);
    initGame();
  }

  // Load a scene mid-run (the old script.js loadPreviewScene): fresh
  // objects through HydraSceneInit, bound texts in the run's current
  // language, fresh run state through HydraSceneReset, a fresh shake,
  // frameId back to 0, and the gameStart launch path for the new scene.
  function loadPreviewScene(scene) {
    if (!scene || typeof scene !== 'object') return;
    hostCall('clearRuntimeDiagnostics', [], undefined);
    var Stage = mod('Stage');
    if (Stage && typeof Stage.normalizeSceneDimensions === 'function') {
      try { Stage.normalizeSceneDimensions(scene); } catch (e) { /* a throwing stage never breaks the switch */ }
    }
    var rs = runState();
    if (!rs) return;
    try { rs.objects = cloneData(scene.objects); } catch (e) { try { rs.objects = []; } catch (ignored) { /* hostile run state */ } }
    var SceneInit = mod('SceneInit');
    var initHooks = hostCall('sceneInitHooks', [], null);
    if (SceneInit && typeof SceneInit.initSceneObjects === 'function') {
      try { SceneInit.initSceneObjects(rs.objects, initHooks); } catch (e) { /* a throwing init never breaks the switch */ }
    }
    var lang = hostCall('getPreviewLanguage', [], 'en');
    var loc = hostCall('getPreviewLocalization', [], null);
    var Localization = mod('Localization');
    var boundTextFor = (Localization && typeof Localization.boundTextFor === 'function') ? Localization.boundTextFor : null;
    if (SceneInit && typeof SceneInit.applyBoundTexts === 'function') {
      try { SceneInit.applyBoundTexts(rs.objects, loc, lang, boundTextFor); } catch (e) { /* a throwing text pass never breaks the switch */ }
    }
    var SceneReset = mod('SceneReset');
    if (SceneReset && typeof SceneReset.resetSceneRuntime === 'function') {
      try { SceneReset.resetSceneRuntime(rs, scene, sceneResetHooks()); } catch (e) { /* a throwing reset never breaks the switch */ }
    }
    // P5 core-engine track, item P5-1 (Variables v2, slice a): the
    // scene about to load starts with no scene-scoped variables
    // (mirrors the exported runtime).
    clearPreviewSceneVariables(scene && scene.id);
    // P5 core-engine track, item P5-1 (Variables v2, slice b): the
    // clear above wipes the scene scope, so re-seed this scene's
    // authored definitions right after it (mirrors the exported
    // runtime).
    seedPreviewSceneVariables(scene && scene.id);
    // P4 Advanced batch 23 (checkpoints & respawn): remember where
    // every object started this scene, so Respawn Object can send it
    // home when no checkpoint is set yet (mirrors the exported
    // runtime).
    var RM = mod('Respawn');
    if (RM && typeof RM.recordInitialPositions === 'function') {
      try { RM.recordInitialPositions(rs.respawn, rs.objects); } catch (e) { /* a throwing record never breaks the switch */ }
    }
    try { rs.cameraShake = { strength: 0, timeLeft: 0 }; } catch (e) { /* hostile run state */ }
    try { rs.frameId = 0; } catch (e) { /* hostile run state */ }
    try { shakeCooldowns().clear(); } catch (e) { /* hostile map */ }
    hostCall('resizeGameCanvas', [scene], undefined);
    processGameStartConditions('global');
    processGameStartConditions(scene.id);
  }

  // Queue a scene switch for the end of the frame (the old script.js
  // switchPreviewScene): swapping mid-frame would let the remaining
  // actions of the old scene run against the new scene's objects.
  // Called by the dispatch host through the host object.
  function switchPreviewScene(sceneId) {
    var target = null;
    var list = scenesList();
    for (var i = 0; i < list.length; i++) {
      if (list[i] && Number(list[i].id) === Number(sceneId)) { target = list[i]; break; }
    }
    if (!target) return;
    var rs = runState();
    if (!rs) return;
    var effective = (rs.pendingSceneId != null) ? rs.pendingSceneId : rs.sceneId;
    if (target.id === effective) return;
    try { rs.pendingSceneId = target.id; } catch (e) { /* hostile run state */ }
  }

  // Start (or restart) a preview run (the old script.js launchPreview):
  // stop the old loop, save the grid, clone the current scene, run the
  // full object init + bound-text pass + run-state reset, build fresh
  // input actions and the audio mix from the project tabs, clear the
  // game variables, wire the canvas, and fire gameStart.
  function launchPreview() {
    stopPreviewLoop();
    hostCall('commitActiveGrid', [], undefined);
    var scene = hostCall('getCurrentScene', [], null);
    var rs = runState();
    if (!scene || typeof scene !== 'object' || !rs) return;
    try { rs.sceneId = scene.id; } catch (e) { /* hostile run state */ }
    try { rs.objects = cloneData(scene.objects); } catch (e) { try { rs.objects = []; } catch (ignored) { /* hostile run state */ } }
    var SceneInit = mod('SceneInit');
    var initHooks = hostCall('sceneInitHooks', [], null);
    if (SceneInit && typeof SceneInit.initSceneObjects === 'function') {
      try { SceneInit.initSceneObjects(rs.objects, initHooks); } catch (e) { /* a throwing init never breaks the launch */ }
    }
    var Localization = mod('Localization');
    var loc = hostCall('getPreviewLocalization', [], null);
    var defLang = 'en';
    if (Localization && typeof Localization.defaultLanguageOf === 'function') {
      try { defLang = Localization.defaultLanguageOf(loc) || 'en'; } catch (e) { defLang = 'en'; }
    }
    try { rs.language = defLang; } catch (e) { /* hostile run state */ }
    var boundTextFor = (Localization && typeof Localization.boundTextFor === 'function') ? Localization.boundTextFor : null;
    if (SceneInit && typeof SceneInit.applyBoundTexts === 'function') {
      try { SceneInit.applyBoundTexts(rs.objects, loc, defLang, boundTextFor); } catch (e) { /* a throwing text pass never breaks the launch */ }
    }
    var SceneReset = mod('SceneReset');
    if (SceneReset && typeof SceneReset.resetSceneRuntime === 'function') {
      try { SceneReset.resetSceneRuntime(rs, scene, sceneResetHooks()); } catch (e) { /* a throwing reset never breaks the launch */ }
    }
    // P5 core-engine track, item P5-1 (Variables v2, slice a): the
    // scene about to load starts with no scene-scoped variables
    // (mirrors the exported runtime).
    clearPreviewSceneVariables(scene && scene.id);
    // P4 Advanced batch 23 (checkpoints & respawn): remember where
    // every object started this scene, so Respawn Object can send it
    // home when no checkpoint is set yet (mirrors the exported
    // runtime).
    var RM = mod('Respawn');
    if (RM && typeof RM.recordInitialPositions === 'function') {
      try { RM.recordInitialPositions(rs.respawn, rs.objects); } catch (e) { /* a throwing record never breaks the launch */ }
    }
    try { rs.cameraShake = { strength: 0, timeLeft: 0 }; } catch (e) { /* hostile run state */ }
    var Acts = safeCall(getHydraActions, undefined, null);
    var inputActions = hostCall('getProjectInputActions', [], []);
    try {
      rs.actions = (Acts && typeof Acts.createRuntimeState === 'function')
        ? Acts.createRuntimeState(inputActions) || null : null;
    } catch (e) { try { rs.actions = null; } catch (ignored) { /* hostile run state */ } }
    hostCall('stopPreviewMusic', [], undefined);
    var buses = hostCall('getPreviewBuses', [], null);
    try { rs.buses = buses; } catch (e) { /* hostile run state */ }
    var Buses = mod('AudioBuses');
    try {
      rs.busVoices = (Buses && typeof Buses.createVoices === 'function') ? Buses.createVoices(buses) || null : null;
    } catch (e) { try { rs.busVoices = null; } catch (ignored) { /* hostile run state */ } }
    var master = hostCall('getProjectMasterVolume', [], 1);
    try {
      rs.masterVolume = (Buses && typeof Buses.normalizeMasterVolume === 'function')
        ? Buses.normalizeMasterVolume(master) : 1;
    } catch (e) { try { rs.masterVolume = 1; } catch (ignored) { /* hostile run state */ } }
    try { rs.musicPaused = false; } catch (e) { /* hostile run state */ }
    try { rs.liveSoundStoppers = []; } catch (e) { /* hostile run state */ }
    var vars = variables();
    try {
      Object.keys(vars).forEach(function (k) { delete vars[k]; });
    } catch (e) { /* hostile variables */ }
    clearForLaunch(inputState());
    hostCall('resizeGameCanvas', [scene], undefined);
    resetGame();
    // P5 core-engine track, item P5-1 (Variables v2, slice b): the
    // reset above drops the run state and re-seeds the global +
    // object definitions, so seed this launch scene's definitions
    // now, before gameStart fires — the clear earlier in this
    // launch ran against the old runtime, not this fresh one.
    seedPreviewSceneVariables(scene && scene.id);
    var doc = docOf();
    var canvas = canvasOf();
    var input = inputState();
    attachCanvasInput(doc, canvas, input, function (x, y, w, h) {
      var A = safeCall(getHydraActions, undefined, null);
      if (A && typeof A.zonesAt === 'function') {
        try {
          var z = A.zonesAt(x, y, w, h);
          return Array.isArray(z) ? z : [];
        } catch (e) { return []; }
      }
      return [];
    });
    startGame();
    processGameStartConditions('global');
    processGameStartConditions(scene.id);
    try {
      if (typeof requestAnimationFrame === 'function') loopRaf = requestAnimationFrame(gameLoop);
    } catch (e) { /* no rAF (node tests): the loop runs one frame per call */ }
  }

  // One frame (the old script.js gameLoop): timing through the shared
  // HydraFrame module (with the same inline fallback when the tag is
  // dropped), the subsystem calls handed to HydraFrame.stepFrame in
  // canonical order, then the draw and the rAF re-arm — which happen
  // every frame, running or not, so the scene view keeps rendering
  // quietly while the game is stopped.
  function gameLoop(timestamp) {
    if (loopRunning) {
      var Frame = mod('Frame');
      var dt = 0, realMs = 0;
      if (Frame && typeof Frame.computeDt === 'function') {
        var timing = null;
        try { timing = Frame.computeDt(loopLastTime, timestamp); } catch (e) { timing = null; }
        if (timing) {
          dt = timing.dt; realMs = timing.realMs; loopLastTime = timing.lastTime;
        } else {
          if (!loopLastTime) loopLastTime = timestamp;
          realMs = Math.max(0, timestamp - loopLastTime);
          dt = Math.min(realMs / 16.67, 3);
          loopLastTime = timestamp;
        }
      } else {
        // No HydraFrame tag: fall back to the same timing math inline so
        // the preview still draws; the world does not advance (guarded-
        // call degradation — the tag order is pinned by tests/frame.test.js).
        if (!loopLastTime) loopLastTime = timestamp;
        realMs = Math.max(0, timestamp - loopLastTime);
        dt = Math.min(realMs / 16.67, 3);
        loopLastTime = timestamp;
      }
      // P4 Advanced batch 13 (time scale): the frame step runs at the
      // run's clock speed — the physics, animation, tween, particle,
      // cutscene, and dialogue phases all read this dt, so scaling it
      // once here slows the whole world together (mirrors the exported
      // runtime). A dropped module tag degrades to normal speed.
      // The profiler still reads real timestamps, so FPS stays honest.
      var TS = mod('TimeScale');
      if (TS && typeof TS.scaledDt === 'function') {
        try { dt = TS.scaledDt(dt, timeScaleRuntime()); } catch (e) { /* keep the raw dt */ }
      }
      // Bank this frame's un-scaled portion into the game-clock debt
      // on the run state, so the named timers slow with the world
      // (the module no-ops while paused — notePausedFrame already
      // banks the full realMs into pausedElapsedMs).
      try {
        if (TS && typeof TS.noteScaledFrame === 'function') TS.noteScaledFrame(runState(), realMs, timeScaleRuntime());
      } catch (e) { /* a throwing clock never breaks the frame */ }
      var rs = runState();
      if (rs) {
        try { rs.dt = dt; } catch (e) { /* hostile run state */ }
        try { rs.frameId = (rs.frameId || 0) + 1; } catch (e) { /* hostile run state */ }
      }
      // The live-object snapshot excludes pending-destroy objects,
      // matching the export's named() semantics.
      var objs = getAlivePreviewObjects();
      if (Frame && typeof Frame.stepFrame === 'function') {
        try {
          Frame.stepFrame({
            timestamp: timestamp,
            dt: dt,
            realMs: realMs,
            isPaused: function () {
              var Pause = mod('Pause');
              var r = runState();
              if (!Pause || typeof Pause.isPaused !== 'function' || !r) return false;
              try { return !!Pause.isPaused(r); } catch (e) { return false; }
            },
            // P4 item 34 (profiling overlay): feed every frame's real
            // timestamp so the FPS / frame-time rolling average stays
            // honest (mirrors the exported runtime).
            profile: function (t) {
              var Prof = mod('Profile');
              var r = runState();
              if (Prof && r && r.profiler && typeof Prof.frame === 'function') {
                try { Prof.frame(r.profiler, t); } catch (e) { /* a throwing profiler never breaks the frame */ }
              }
            },
            // F4 pause: while paused the world simulation freezes (no
            // physics, collisions, animations, tweens, camera motion,
            // or timer ticks), but the game keeps rendering and the
            // script grids keep running so a pause menu built from
            // plain blocks stays interactive (mirrors the exported
            // runtime).
            notePaused: function (ms) {
              var Pause = mod('Pause');
              var r = runState();
              if (Pause && r && typeof Pause.notePausedFrame === 'function') {
                try { Pause.notePausedFrame(r, ms); } catch (e) { /* a throwing pause clock never breaks the frame */ }
              }
            },
            // P2 item 15/12 slice 1: shake + flash decay lives in
            // HydraCameraFx, called identically by the exported runtime.
            decayCameraFx: function (dtMs) {
              var Fx = mod('CameraFx');
              var r = runState();
              if (Fx && r && typeof Fx.decay === 'function') {
                try { Fx.decay(r.cameraShake, r.flash, dtMs); } catch (e) { /* a throwing decay never breaks the frame */ }
              }
            },
            updateCamera: function () { updateCameraFollow(); update3dCameraFollow(); },
            updatePhysics2d: function () {
              // P2 item 15/12 slice 4: the per-frame 2D physics step
              // lives in HydraPhysicsStep, called identically by the
              // exported runtime. A dropped module tag degrades to a
              // frozen world for this frame — the scene still draws,
              // the same guarded-call degradation the other shared
              // modules use. Two preview divergences close here: text
              // objects with collision enabled no longer move under
              // physics, and light3d objects are explicitly skipped,
              // matching the export.
              var PS = mod('PhysicsStep');
              if (!PS || typeof PS.stepPhysics2d !== 'function') return;
              var trig = null;
              try { trig = PS.stepPhysics2d(objs, dt, physicsStepHooks()); } catch (e) { trig = null; }
              var r = runState();
              if (trig && r) {
                try { r._triggerContacts = trig.contacts; } catch (e) { /* hostile run state */ }
                try { r._triggerPairs = trig.nextPairs; } catch (e) { /* hostile run state */ }
                try { r._triggerEntered = trig.entered; } catch (e) { /* hostile run state */ }
                try { r._triggerExited = trig.exited; } catch (e) { /* hostile run state */ }
              }
            },
            // P4 item 3D4: 3D physics — gravity, box/sphere 3D
            // colliders, ground detection, and MTV collision response
            // for 3D objects. Inside the unpaused update so 3D physics
            // freezes while paused, like 2D physics (mirrors the
            // exported runtime).
            updatePhysics3d: function () {
              var H3 = mod('3d');
              if (!H3 || typeof H3.updatePhysics3d !== 'function') return;
              try {
                H3.updatePhysics3d(objs.filter(function (o) {
                  return (typeof H3.is3dKind === 'function') ? H3.is3dKind(o.kind) : false;
                }), dt, function (o) { return hostCall('getPhysics', [o], {}); });
              } catch (e) { /* a throwing 3D step never breaks the frame */ }
            },
            // P4 Advanced (physics joints): rods, ropes, and springs
            // solve after collisions, so joints and walls agree —
            // inside the unpaused update, so joints freeze while
            // paused like the rest of the world sim (mirrors the
            // exported runtime).
            solveJoints: function () {
              var J = mod('Joints');
              if (!J) return;
              var jointScene = hostCall('getPreviewScene', [], null);
              if (!jointScene) return;
              try {
                if (typeof J.normalizeJoints === 'function') J.normalizeJoints(jointScene);
                if (typeof J.solveJoints === 'function') {
                  J.solveJoints(objs, jointScene.joints, dt, function (o) { return !o.static; });
                }
              } catch (e) { /* a throwing joint solve never breaks the frame */ }
            },
            // Sprite animations: advance every playing animation BEFORE
            // scripts run, so On Animation Finished sees this frame's
            // finished flags.
            updateAnimations: function () {
              var Anim = mod('Anim');
              objs.forEach(function (obj) {
                try {
                  if (Anim && typeof Anim.createAnimState === 'function') obj._anim = obj._anim || Anim.createAnimState();
                  if (Anim && typeof Anim.update === 'function') Anim.update(obj._anim, obj, dt);
                } catch (e) { /* one bad object never breaks the phase */ }
              });
            },
            // P4 Advanced (blend spaces): advance the active blend
            // space's shared frame clock BEFORE scripts run, so the
            // blended frame is current when the game draws (mirrors
            // the exported runtime). Inside the unpaused update, so
            // blends freeze while paused like animations.
            updateBlendSpaces: function () {
              var Blend = mod('BlendSpace');
              objs.forEach(function (obj) {
                try {
                  if (Blend && typeof Blend.createBlendRuntime === 'function') obj._blends = obj._blends || Blend.createBlendRuntime();
                  if (Blend && typeof Blend.updateBlend === 'function') Blend.updateBlend(obj._blends, obj, dt);
                } catch (e) { /* one bad object never breaks the phase */ }
              });
            },
            // P4 Advanced (skeletal animation): advance the active
            // skeletal animation's frame clock BEFORE scripts run, so
            // the pose is current when the game draws (mirrors the
            // exported runtime). Inside the unpaused update, so poses
            // freeze while paused.
            updateSkeletons: function () {
              var Skel = mod('Skeleton');
              objs.forEach(function (obj) {
                try {
                  if (Skel && typeof Skel.createSkeletonRuntime === 'function') obj._skel = obj._skel || Skel.createSkeletonRuntime();
                  if (Skel && typeof Skel.updateSkeleton === 'function') Skel.updateSkeleton(obj._skel, obj, dt);
                } catch (e) { /* one bad object never breaks the phase */ }
              });
            },
            // Tweens: advance BEFORE scripts run, so Tween Finished
            // sees this frame's finished records (mirrors the exported
            // runtime).
            updateTweens: function () {
              var Tw = mod('Tween');
              objs.forEach(function (obj) {
                try {
                  if (Tw && typeof Tw.update === 'function') Tw.update(null, obj, dt);
                } catch (e) { /* one bad object never breaks the phase */ }
              });
            },
            // Particles: advance emitters + particles BEFORE scripts
            // run, so a burst fired this frame is already simulated
            // next frame (mirrors the exported runtime). Gated by
            // pause like the rest of the world sim.
            updateParticles: function () {
              var Parts = mod('Particles');
              var r = runState();
              if (Parts && r && r.particles && typeof Parts.update === 'function') {
                try {
                  Parts.update(r.particles, dt, function (name) {
                    var target = null;
                    try { target = hostCall('getObjectsByName', [name, objs], [])[0] || null; } catch (e) { target = null; }
                    return target ? { x: target.posX + target.width / 2, y: target.posY + target.height / 2 } : null;
                  });
                } catch (e) { /* a throwing particle update never breaks the frame */ }
              }
            },
            // P4 Advanced batch 22 (damage feedback): rise and fade the
            // floating numbers BEFORE scripts run, so a number spawned
            // this frame is already aging next frame (mirrors the
            // exported runtime). The scaled dt means numbers slow with
            // the time scale and freeze while paused.
            updateDamageNumbers: function () {
              var DF = mod('DamageFx');
              var r = runState();
              if (DF && r && r.damageNumbers && typeof DF.updateDamageNumbers === 'function') {
                try { DF.updateDamageNumbers(r.damageNumbers, dt / 60); } catch (e) { /* a throwing number update never breaks the frame */ }
              }
            },
            // P4 Advanced batch 19 (AI behaviors): decide where each
            // driven object walks next BEFORE the follower moves it, so
            // a fresh plan walks the same frame (mirrors the exported
            // runtime). The scaled dt means behaviors slow with the
            // time scale and freeze while paused.
            updateAI: function () {
              var AI = mod('Ai');
              if (!AI || typeof AI.updateAI !== 'function') return;
              try {
                AI.updateAI(objs, dt / 60, {
                  pathfind: mod('Pathfind'),
                  tiles: mod('Tiles'),
                  worldSize: function () {
                    var sc = hostCall('getPreviewScene', [], null);
                    return sc ? { width: sc.worldWidth, height: sc.worldHeight } : null;
                  },
                  findObject: function (name) {
                    try { return hostCall('getObjectsByName', [name, objs], [])[0] || null; } catch (e) { return null; }
                  }
                });
              } catch (e) { /* a throwing AI update never breaks the frame */ }
            },
            // P4 Advanced batch 18 (pathfinding): walk every following
            // object one step along its path BEFORE scripts run, so
            // Path Finished sees this frame's arrivals (mirrors the
            // exported runtime). The scaled dt means paths slow with
            // the time scale and freeze while paused.
            updatePaths: function () {
              var PF = mod('Pathfind');
              if (!PF || typeof PF.updatePaths !== 'function') return;
              try { PF.updatePaths(objs, dt / 60); } catch (e) { /* a throwing path update never breaks the frame */ }
            },
            // P4 Advanced batch 24 (enemy spawner): clone what is due
            // BEFORE scripts run, so a newborn is visible to this
            // frame's scripts (mirrors the exported runtime). Last in
            // the world sim, so a newborn never gets a half-stepped
            // physics or AI update on its birth frame; the scaled dt
            // means spawners slow with the time scale and freeze while
            // paused. Spawning runs through the same Spawn Object
            // action the blocks use, so clones get the full scene
            // init.
            updateSpawners: function () {
              var SP = mod('Spawn');
              var r = runState();
              if (!SP || !r || !r.spawners || typeof SP.updateSpawners !== 'function') return;
              try {
                SP.updateSpawners(r.spawners, dt / 60, {
                  spawn: function (template, x, y) {
                    var Ex = mod('Execute');
                    if (!Ex || typeof Ex.spawnObjectAt !== 'function') return null;
                    try { return Ex.spawnObjectAt(actionCtx(), template, x, y); } catch (e) { return null; }
                  },
                  findObject: function (name) {
                    try { return hostCall('getObjectsByName', [name, objs], [])[0] || null; } catch (e) { return null; }
                  },
                  aliveCount: function (template) {
                    try { return hostCall('getObjectsByName', [template, objs], []).length; } catch (e) { return 0; }
                  }
                });
              } catch (e) { /* a throwing spawner update never breaks the frame */ }
            },
            // P4 Advanced batch 27 (moving platforms & one-way
            // platforms): slide every platform along its path, carry
            // its riders, and run the crumble timers AFTER the physics
            // step settled this frame's positions and BEFORE the
            // movement phase, so the movement module's grounded check
            // sees the rider on the platform's new position and jumps
            // refill there (mirrors the exported runtime). The scaled
            // dt means platforms slow with the time scale and freeze
            // while paused; the frozen clock means crumble timers hold
            // while paused.
            updatePlatforms: function () {
              var PF = mod('Platform');
              var r = runState();
              if (!PF || !r || !r.platform || typeof PF.updatePlatforms !== 'function') return;
              var nowSec = 0;
              try {
                var P = mod('Pause');
                nowSec = (P && typeof P.gameNow === 'function') ? P.gameNow(r, nowMs()) / 1000 : nowMs() / 1000;
              } catch (e) { nowSec = 0; }
              var P2D = mod('Physics2D');
              try {
                PF.updatePlatforms(r.platform, objs, nowSec, dt / 60, {
                  objects: objs,
                  hitbox: hitboxOf,
                  isCollision: isCollisionObjectOf,
                  isOneWay: (P2D && typeof P2D.isOneWay === 'function')
                    ? function (o) { try { return P2D.isOneWay(o); } catch (e) { return false; } }
                    : null,
                  hide: function (o) { try { hiddenSet().add(o.id); } catch (e) { /* a throwing hide never breaks the frame */ } }
                });
              } catch (e) { /* a throwing platform update never breaks the frame */ }
            },
            // P4 Advanced batch 26 (movement abilities): refresh the
            // per-object jump / dash state AFTER the physics step
            // settled this frame's positions, so a landing refills the
            // jumps and a buffered press fires the frame after the
            // object lands, and a dash steps the object along its
            // burst (mirrors the exported runtime). Last in the world
            // sim, so the dash is the frame's final word on a dashing
            // object's position; the scaled dt means dashes slow with
            // the time scale and freeze while paused.
            updateMovement: function () {
              var MV = mod('Movement');
              var r = runState();
              if (!MV || !r || !r.movement || typeof MV.updateMovement !== 'function') return;
              var nowSec = 0;
              try {
                var P = mod('Pause');
                nowSec = (P && typeof P.gameNow === 'function') ? P.gameNow(r, nowMs()) / 1000 : nowMs() / 1000;
              } catch (e) { nowSec = 0; }
              var P2D = mod('Physics2D');
              // P4 Advanced batch 28 (wall slide & wall jump): the
              // held-key set the slide reads the press toward the
              // wall from (mirrors the exported runtime).
              var heldKeys = null;
              try { var inp = inputState(); heldKeys = inp ? inp.keysPressed : null; } catch (e) { heldKeys = null; }
              try {
                MV.updateMovement(r.movement, objs, nowSec, dt / 60, {
                  objects: objs,
                  hitbox: hitboxOf,
                  isCollision: isCollisionObjectOf,
                  canCollide: (P2D && typeof P2D.canCollide === 'function')
                    ? function (a, b) { try { return P2D.canCollide(a, b); } catch (e) { return true; } }
                    : null,
                  // P4 Advanced batch 27 (one-way platforms): the
                  // grounded check skips a one-way floor while the
                  // object rises through it, so jumping up through
                  // one never grants a free ground jump (mirrors the
                  // exported runtime).
                  isOneWay: (P2D && typeof P2D.isOneWay === 'function')
                    ? function (o) { try { return P2D.isOneWay(o); } catch (e) { return false; } }
                    : null,
                  tiles: mod('Tiles'),
                  keys: heldKeys,
                  hasKey: keySetHas
                });
              } catch (e) { /* a throwing movement update never breaks the frame */ }
            },
            // P4 Advanced batch 29 (combat): step the live projectiles
            // and fade the slash arcs AFTER the movement phase, so a
            // projectile steps after the dash has had the frame's
            // final word on positions (mirrors the exported runtime).
            // The damage hook is the Damage Object path — an invincible
            // target skips the hit — and the destroy hook queues a
            // pending destroy, the way the Destroy Object action does.
            updateCombat: function () {
              var CB = mod('Combat');
              var r = runState();
              if (!CB || !r || !r.combat || typeof CB.updateCombat !== 'function') return;
              var nowSec = 0;
              try {
                var P = mod('Pause');
                nowSec = (P && typeof P.gameNow === 'function') ? P.gameNow(r, nowMs()) / 1000 : nowMs() / 1000;
              } catch (e) { nowSec = 0; }
              try {
                CB.updateCombat(r.combat, dt / 60, {
                  objects: objs,
                  hitbox: hitboxOf,
                  isCollision: isCollisionObjectOf,
                  damage: function (target, amount) {
                    try {
                      var HM = mod('Health');
                      if (!HM || typeof HM.damage !== 'function') return;
                      var DF = mod('DamageFx');
                      if (DF && typeof DF.isInvincible === 'function') {
                        var P2 = mod('Pause');
                        var nowInv = (P2 && typeof P2.gameNow === 'function') ? P2.gameNow(r, nowMs()) : nowMs();
                        if (DF.isInvincible(target, nowInv)) return;
                      }
                      HM.damage(target, amount);
                    } catch (e) { /* a throwing hit is skipped */ }
                  },
                  destroy: function (o) { try { if (o && o.id != null) pendingSet().add(o.id); } catch (e) { /* a throwing destroy never breaks the frame */ } },
                  isAlive: function (o) {
                    try { return !!o && o.id != null && !destroyedSet().has(o.id) && !pendingSet().has(o.id); } catch (e) { return true; }
                  }
                }, nowSec);
              } catch (e) { /* a throwing combat update never breaks the frame */ }
            },
            // P4 Advanced batch 37 (object parenting): snap every
            // attached child to its parent plus the stored offset
            // AFTER the combat phase, so the attach is the frame's
            // final word on a child's position (mirrors the exported
            // runtime). The `objs` list is already the live objects
            // for this frame.
            updateAttachments: function () {
              var A = mod('Attach');
              var r = runState();
              if (A && r && r.attachments && typeof A.applyAttachments === 'function') {
                try { A.applyAttachments(r.attachments, objs); } catch (e) { /* a throwing apply never breaks the frame */ }
              }
            },
            // F2 UI widgets: hover/press state for buttons BEFORE
            // scripts run, so Object Clicked / Mouse Over conditions
            // and the button visuals agree. Runs while paused too, so
            // pause-menu buttons stay clickable. (Preview-only phase:
            // the export computes button state at draw time.)
            updateUiWidgets: function () { updateUiWidgetStates(objs); },
            resetContexts: function () { resetFrameConditionContexts(); },
            // Input actions: advance BEFORE scripts run, so Action
            // Input conditions see this frame's state (mirrors the
            // exported runtime). Runs while paused too, like raw key
            // input, so pause menus can use actions.
            pollInput: function () {
              var Acts = safeCall(getHydraActions, undefined, null);
              var r = runState();
              var input = inputState();
              if (!Acts || !r || !r.actions) return;
              // P2 item 14 slice 6: the raw gamepad poll + edge sets
              // live in this module (mutated in place, so the script.js
              // aliases stay valid); the actions-runtime update stays
              // here, feeding the same sets to the action-input runtime.
              pollGamepad(input);
              if (typeof Acts.update !== 'function') return;
              try {
                // P4 Advanced batch 20 (virtual joystick): the stick
                // holds its driven named actions like a key does, so a
                // tilted stick holds Move Left with just-pressed /
                // released edges exactly like a key press.
                var joyHeld = [];
                try {
                  var JH = mod('Joystick');
                  if (JH && typeof JH.joystickHeldActions === 'function') {
                    joyHeld = JH.joystickHeldActions(joystickConfig(), joystickRuntime()) || [];
                  }
                } catch (e) { joyHeld = []; }
                Acts.update(r.actions, {
                  keys: input.keysPressed,
                  keysJustPressed: input.keysJustPressed,
                  keysJustReleased: input.keysJustReleased,
                  gamepad: input.gamepadButtons,
                  touchZones: input.touchZones,
                  joystick: new Set(joyHeld),
                  keySetHas: function (set, key) { return keySetHas(set, key); }
                });
              } catch (e) { /* a throwing action update never breaks the frame */ }
            },
            // P4 Advanced batch 20 (virtual joystick): write this
            // frame's stick tilt into the joystick variables AFTER
            // the input poll (so the driven actions above already
            // hold) and BEFORE the scripts run, so a condition
            // reading joystickX or an action reading a driven action
            // sees this frame's tilt (mirrors the exported runtime).
            // Runs while paused too, like the input poll.
            updateJoystick: function () {
              var J = mod('Joystick');
              if (!J || typeof J.applyJoystickOutput !== 'function') return;
              try {
                J.applyJoystickOutput(joystickRuntime(), joystickConfig(), {
                  setVariable: function (name, value) {
                    var vars = variables();
                    vars[name] = value;
                  }
                });
              } catch (e) { /* a throwing stick update never breaks the frame */ }
            },
            // Process global script + current scene script
            runScripts: function () {
              var r = runState();
              // P4 Advanced batch 7 (dialogue): advance the typewriter
              // before the grids run, so a condition reading the
              // dialogue sees this frame's text (mirrors the exported
              // runtime); runs while paused too, like the pause menu.
              updatePreviewDialogue(dt);
              // P4 Advanced batch 11 (cutscenes): advance the running
              // cutscene before the grids run, so a condition reading
              // it sees this frame's step (mirrors the exported
              // runtime); it freezes while paused, like the world sim.
              updatePreviewCutscene(dt);
              // P4 Advanced batch 14 (scene transitions): advance the
              // running transition before the grids run, so a
              // condition reading it sees this frame's phase (mirrors
              // the exported runtime); it freezes while paused, like
              // the world sim.
              updatePreviewTransition(dt);
              processScriptGrid('global');
              processScriptGrid((r && r.sceneId) || hostCall('getCurrentSceneId', [], 1));
            },
            applyPendingDestroy: function () {
              var pending = pendingSet();
              var destroyed = destroyedSet();
              try {
                pending.forEach(function (id) { destroyed.add(id); });
                pending.clear();
              } catch (e) { /* hostile sets: the destroy waits a frame */ }
            },
            // Apply a scene change requested by switchScene/restartScene/
            // nextScene/previousScene AFTER all actions ran, so no
            // old-scene action executes against the new scene's objects.
            applyPendingScene: function () {
              var r = runState();
              if (!r || r.pendingSceneId == null) return;
              var target = null;
              var list = scenesList();
              for (var i = 0; i < list.length; i++) {
                if (list[i] && Number(list[i].id) === Number(r.pendingSceneId)) { target = list[i]; break; }
              }
              try { r.pendingSceneId = null; } catch (e) { /* hostile run state */ }
              if (target) loadPreviewScene(target);
            },
            clearEdges: function () {
              // P2 item 14 slice 6: the per-frame edge reset
              // (just-pressed / released sets + mouse deltas; held keys
              // and buttons survive) lives in this module.
              clearEdges(inputState());
            }
          });
        } catch (e) { /* stepFrame never throws by contract; a hostile stub still must not break the loop */ }
      }
    }
    hostCall('drawGame', [], undefined);
    try {
      if (typeof requestAnimationFrame === 'function') loopRaf = requestAnimationFrame(gameLoop);
    } catch (e) { /* no rAF (node tests): one frame per call */ }
  }

  // P5-2 slice a: the editor status bar reads the live preview FPS from
  // the profiler's rolling 60-frame average. 0 when the preview loop is
  // not running, the profiler is missing, or no frame has been recorded
  // yet — the gate on loopRunning matters, because the profiler keeps
  // its last samples after a stop and would otherwise report a stale
  // FPS forever. Never throws, so a hostile profiler or run state reads
  // as "not running".
  function previewFps() {
    try {
      if (!loopRunning) return 0;
      var Prof = mod('Profile');
      var r = runState();
      if (!Prof || typeof Prof.stats !== 'function' || !r || !r.profiler) return 0;
      var s = Prof.stats(r.profiler);
      var fps = s && typeof s.fps === 'number' ? s.fps : 0;
      return (isFinite(fps) && fps > 0) ? fps : 0;
    } catch (e) { return 0; }
  }

  return {
    configure: configure,
    createInputState: createInputState,
    normalizeKeyName: normalizeKeyName,
    keyNameAliases: keyNameAliases,
    keySetHas: keySetHas,
    getEventKeyAliases: getEventKeyAliases,
    updateMouse: updateMouse,
    pressMouseButton: pressMouseButton,
    releaseMouseButton: releaseMouseButton,
    updateTouch: updateTouch,
    attachCanvasInput: attachCanvasInput,
    attachKeyboardInput: attachKeyboardInput,
    clearEdges: clearEdges,
    clearForLaunch: clearForLaunch,
    resetRunInput: resetRunInput,
    pollGamepad: pollGamepad,
    processScriptGrid: processScriptGrid,
    dispatchHooks: dispatchHooks,
    conditionCtx: conditionCtx,
    evaluateCondition: evaluateCondition,
    actionCtx: actionCtx,
    executeAction: executeAction,
    executeLoopAction: executeLoopAction,
    getConditionContextKey: getConditionContextKey,
    setConditionContext: setConditionContext,
    getConditionContext: getConditionContext,
    markConditionTriggered: markConditionTriggered,
    resetFrameConditionContexts: resetFrameConditionContexts,
    resetGameStartState: resetGameStartState,
    processGameStartConditions: processGameStartConditions,
    getScopeGridData: getScopeGridData,
    getEventActionIndexes: getEventActionIndexes,
    applyAdjacentActionsFromScope: applyAdjacentActionsFromScope,
    getAdjacentIndexes: getAdjacentIndexes,
    getAlivePreviewObjects: getAlivePreviewObjects,
    getContextObjectForName: getContextObjectForName,
    resolveActionTargets: resolveActionTargets,
    namedTimerElapsedSeconds: namedTimerElapsedSeconds,
    getTimerRecord: getTimerRecord,
    resetNamedTimer: resetNamedTimer,
    setNamedTimerPaused: setNamedTimerPaused,
    warnUnknownBlockType: warnUnknownBlockType,
    warnReadTimerBlank: warnReadTimerBlank,
    warnFlashColor: warnFlashColor,
    collectionHooks: collectionHooks,
    mathHooks: mathHooks,
    pickHooks: pickHooks,
    layerFxActionHooks: layerFxActionHooks,
    layerFxConditionHooks: layerFxConditionHooks,
    scriptApiHooks: scriptApiHooks,
    threeDActionHooks: threeDActionHooks,
    threeDConditionHooks: threeDConditionHooks,
    light2dActionHooks: light2dActionHooks,
    light2dConditionHooks: light2dConditionHooks,
    jointActionHooks: jointActionHooks,
    jointConditionHooks: jointConditionHooks,
    stateMachineHooksFor: stateMachineHooksFor,
    previewTilemapsNamed: previewTilemapsNamed,
    initGame: initGame,
    startGame: startGame,
    stopPreviewLoop: stopPreviewLoop,
    startRenderLoop: startRenderLoop,
    gameLoop: gameLoop,
    updateCameraFollow: updateCameraFollow,
    update3dCameraFollow: update3dCameraFollow,
    updateUiWidgetStates: updateUiWidgetStates,
    physicsStepHooks: physicsStepHooks,
    sceneResetHooks: sceneResetHooks,
    dialogueRuntime: dialogueRuntime,
    dialogueHooks: dialogueHooks,
    updatePreviewDialogue: updatePreviewDialogue,
    resetDialogueRuntime: resetDialogueRuntime,
    inventoryRuntime: inventoryRuntime,
    inventoryHooks: inventoryHooks,
    resetInventoryRuntime: resetInventoryRuntime,
    questLogRuntime: questLogRuntime,
    questHooks: questHooks,
    resetQuestLogRuntime: resetQuestLogRuntime,
    livesRuntime: livesRuntime,
    resetLivesRuntime: resetLivesRuntime,
    xpRuntime: xpRuntime,
    resetXpRuntime: resetXpRuntime,
    growthRuntime: growthRuntime,
    resetGrowthRuntime: resetGrowthRuntime,
    scalingRuntime: scalingRuntime,
    resetScalingRuntime: resetScalingRuntime,
    bossRuntime: bossRuntime,
    resetBossRuntime: resetBossRuntime,
    minimapState: minimapState,
    resetMinimapRuntime: resetMinimapRuntime,
    attachState: attachState,
    variablesRuntime: variablesRuntime,
    resetVariablesRuntime: resetVariablesRuntime,
    seedPreviewRunVariables: seedPreviewRunVariables,
    seedPreviewSceneVariables: seedPreviewSceneVariables,
    functionsCallState: functionsCallState,
    resetFunctionsCallState: resetFunctionsCallState,
    loopsState: loopsState,
    resetLoopsState: resetLoopsState,
    eventsState: eventsState,
    resetEventsState: resetEventsState,
    projectFunctions: projectFunctions,
    callPreviewFunction: callPreviewFunction,
    returnPreviewFunction: returnPreviewFunction,
    isPreviewRunning: function () { return loopRunning; },
    previewFps: previewFps,
    achievementRuntime: achievementRuntime,
    achievementHooks: achievementHooks,
    persistAchievements: persistAchievements,
    cutsceneRuntime: cutsceneRuntime,
    cutsceneHooks: cutsceneHooks,
    updatePreviewCutscene: updatePreviewCutscene,
    resetCutsceneRuntime: resetCutsceneRuntime,
    highScoreRuntime: highScoreRuntime,
    highScoreHooks: highScoreHooks,
    persistHighScores: persistHighScores,
    clearHighScoreTable: clearHighScoreTable,
    timeScaleRuntime: timeScaleRuntime,
    timeScaleHooks: timeScaleHooks,
    resetTimeScaleRuntime: resetTimeScaleRuntime,
    transitionRuntime: transitionRuntime,
    joystickRuntime: joystickRuntime,
    joystickRuntimeForDraw: joystickRuntimeForDraw,
    resetJoystickRuntime: resetJoystickRuntime,
    transitionHooks: transitionHooks,
    updatePreviewTransition: updatePreviewTransition,
    resetTransitionRuntime: resetTransitionRuntime,
    resetGame: resetGame,
    loadPreviewScene: loadPreviewScene,
    switchPreviewScene: switchPreviewScene,
    launchPreview: launchPreview
  };
}

if (typeof window !== 'undefined') {
  window.HydraPreviewRuntime = hydraPreviewRuntimeFactory();
  // Self-contained source of the factory, kept as a string, never eval'd
  // here. Exports never inline this module (no editor preview in a
  // shipped game); factorySource stays so the module is re-instantiable
  // and testable like the rest of the hydra-*.js family.
  window.HydraPreviewRuntime.factorySource = hydraPreviewRuntimeFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraPreviewRuntimeFactory;
