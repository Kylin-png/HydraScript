/* ============================================================================
 * hydra-scriptapi.js — HydraScript text scripting API (P4 item 35).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation of
 * the JavaScript scripting API used by:
 *   - the editor preview runtime (script.js delegates to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * What it is: a small, documented `hs` object handed to user-written
 * JavaScript inside the Run Script action and the Script Check condition.
 * Every method mirrors something the visual blocks can do, so anything a
 * script does stays rebuildable from primitives (the design doctrine:
 * presets and power tools are the easy way, never the only way).
 *
 * TRUST BOUNDARY — read before touching this file. Unlike block expressions
 * (hydra-expr.js), which are filtered through an identifier allow-list,
 * script code runs as RAW JavaScript compiled with `new Function('hs', ...)`.
 * It has full access to globals (window, fetch, localStorage, ...) in
 * whichever page runs the game. That is the deliberate trade-off of a power-
 * user API: a `.hydra` project (or exported game) carrying script blocks is
 * equivalent to running its author's code in your browser. The same rule
 * applies as for expressions — only open projects from people and sources
 * you trust — and SECURITY.md says so in plain language. Nothing in this
 * module weakens that rule; the module only shapes the `hs` bridge, it does
 * not sandbox the code.
 *
 * Safety rails that ARE in place:
 *   - Compile errors warn once (cached) with the message; the block then
 *     does nothing instead of breaking the frame.
 *   - Runtime errors are caught, warned (deduped by the host's diagnostics),
 *     and never propagate — one bad script never kills the game loop.
 *   - Blank/whitespace code is a quiet no-op (action) / false (condition),
 *     matching the "blank names stay quiet" convention.
 *   - All host access goes through the hooks record; missing hooks degrade
 *     to safe defaults (0, false, null, no-op) instead of throwing.
 *   - Compiled functions are cached per code string (cap 256) so a script
 *     placed on Every Frame does not recompile every frame.
 *
 * Load order (index.html): hydra-scriptapi.js BEFORE player-runtime.js and
 * script.js. player-runtime.js throws a clear error if HydraScriptApi is
 * missing.
 * ========================================================================== */

function hydraScriptApiFactory() {
  'use strict';

  // Compiled-function cache: key = 'a'|'c' + '\n' + code. Values are
  // { ok: true, fn } or { ok: false, error }. Capped so pathological
  // generated code cannot grow it without bound.
  var MAX_CACHE = 256;
  var compileCache = new Map();

  function cacheGet(key) {
    return compileCache.has(key) ? compileCache.get(key) : null;
  }

  function cacheSet(key, entry) {
    if (compileCache.size >= MAX_CACHE) {
      var first = compileCache.keys().next();
      if (!first.done) compileCache.delete(first.value);
    }
    compileCache.set(key, entry);
  }

  function clearCache() {
    compileCache.clear();
  }

  function hookFn(hooks, name) {
    return (hooks && typeof hooks[name] === 'function') ? hooks[name] : null;
  }

  function warn(hooks, msg) {
    var w = hookFn(hooks, 'warn');
    if (w) { try { w(String(msg)); } catch (e) {} }
  }

  function num(v, fallback) {
    var n = Number(v);
    if (!isFinite(n)) return (fallback === undefined ? 0 : fallback);
    return n;
  }

  function cleanName(v) {
    if (v === undefined || v === null) return '';
    return String(v).trim();
  }

  // --- Friendly object wrapper --------------------------------------------
  // A thin live view over a runtime object record. Reads/writes hit the
  // record's own fields (posX/posY/width/height/visible/rotation/opacity/
  // text via _runtimeText), so scripts and blocks always see the same world.

  function objectCenter(obj) {
    return {
      x: num(obj.posX) + num(obj.width) / 2,
      y: num(obj.posY) + num(obj.height) / 2
    };
  }

  function wrapObject(obj, hooks) {
    if (!obj || typeof obj !== 'object') return null;
    var destroyHook = hookFn(hooks, 'destroyObject');
    // Visibility lives in the host's hidden set (not obj.visible): both
    // runtimes track show/hide there, so the wrapper must go through hooks
    // to stay in sync with the blocks.
    var isHiddenHook = hookFn(hooks, 'isHidden');
    var setHiddenHook = hookFn(hooks, 'setHidden');
    function isHidden() { return isHiddenHook ? !!isHiddenHook(obj) : false; }
    function setHidden(hide) { if (setHiddenHook) { try { setHiddenHook(obj, !!hide); } catch (e) {} } }
    var w = {};
    Object.defineProperties(w, {
      name:     { enumerable: true, get: function () { return obj.name; } },
      kind:     { enumerable: true, get: function () { return obj.kind; } },
      x:        { enumerable: true,
                  get: function () { return num(obj.posX); },
                  set: function (v) { obj.posX = num(v, obj.posX); } },
      y:        { enumerable: true,
                  get: function () { return num(obj.posY); },
                  set: function (v) { obj.posY = num(v, obj.posY); } },
      w:        { enumerable: true, get: function () { return num(obj.width); } },
      h:        { enumerable: true, get: function () { return num(obj.height); } },
      cx:       { enumerable: true,
                  get: function () { return objectCenter(obj).x; },
                  set: function (v) { obj.posX = num(v, objectCenter(obj).x) - num(obj.width) / 2; } },
      cy:       { enumerable: true,
                  get: function () { return objectCenter(obj).y; },
                  set: function (v) { obj.posY = num(v, objectCenter(obj).y) - num(obj.height) / 2; } },
      visible:  { enumerable: true,
                  get: function () { return !isHidden(); },
                  set: function (v) { setHidden(!v); } },
      rotation: { enumerable: true,
                  get: function () { return num(obj.rotation); },
                  set: function (v) { obj.rotation = num(v, obj.rotation); } },
      opacity:  { enumerable: true,
                  get: function () { return obj.opacity === undefined ? 1 : num(obj.opacity, 1); },
                  set: function (v) { var n = num(v, 1); obj.opacity = n < 0 ? 0 : (n > 1 ? 1 : n); } },
      text:     { enumerable: true,
                  get: function () { return obj._runtimeText !== undefined ? obj._runtimeText : (obj.text || ''); },
                  set: function (v) { obj._runtimeText = String(v); } }
    });
    w.move = function (dx, dy) {
      obj.posX = num(obj.posX) + num(dx);
      obj.posY = num(obj.posY) + num(dy);
      return w;
    };
    w.teleport = function (x, y) {
      obj.posX = num(x, obj.posX);
      obj.posY = num(y, obj.posY);
      return w;
    };
    w.setText = function (t) { obj._runtimeText = String(t); return w; };
    w.show = function () { setHidden(false); return w; };
    w.hide = function () { setHidden(true); return w; };
    w.setColor = function (c) { if (typeof c === 'string' && c) obj.color = c; return w; };
    w.setOpacity = function (n) { var v = num(n, 1); obj.opacity = v < 0 ? 0 : (v > 1 ? 1 : v); return w; };
    w.setRotation = function (deg) { obj.rotation = num(deg, 0); return w; };
    w.destroy = function () { if (destroyHook) { try { destroyHook(obj); } catch (e) {} } return w; };
    w.dist = function (other) {
      var a = objectCenter(obj), b = null;
      if (other && typeof other === 'object' && other._obj) b = objectCenter(other._obj);
      else if (other && typeof other === 'object' && typeof other.posX !== 'undefined') b = objectCenter(other);
      if (!b) return 0;
      var dx = a.x - b.x, dy = a.y - b.y;
      return Math.sqrt(dx * dx + dy * dy);
    };
    // The raw record, for power users who know the engine's field names.
    // Documented as escape-hatch; everything common is on the wrapper.
    Object.defineProperty(w, '_obj', { value: obj, enumerable: false });
    return w;
  }

  function liveWrapped(hooks, name) {
    var fn = hookFn(hooks, 'liveObjects');
    var list = fn ? fn(name) : null;
    if (!Array.isArray(list)) return [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var w = wrapObject(list[i], hooks);
      if (w) out.push(w);
    }
    return out;
  }

  // --- The `hs` API --------------------------------------------------------
  // Built fresh per dispatch from host hooks. Every method sanitizes its
  // inputs: blank names stay quiet or warn (the block conventions), bad
  // numbers fall back safely, hostile values never throw.

  function createScriptAPI(hooks) {
    var h = hooks || {};
    var hs = {};

    // -- Variables --
    hs.get = function (name) {
      var n = cleanName(name);
      if (!n) return 0;
      var g = hookFn(h, 'getVar');
      var v = g ? g(n) : undefined;
      return (v === undefined || v === null) ? 0 : v;
    };
    hs.set = function (name, value) {
      var n = cleanName(name);
      if (!n) { warn(h, 'Script: hs.set() needs a variable name.'); return value; }
      var s = hookFn(h, 'setVar');
      if (s) { try { s(n, value); } catch (e) {} }
      return value;
    };
    hs.has = function (name) {
      var n = cleanName(name);
      if (!n) return false;
      var f = hookFn(h, 'hasVar');
      return f ? !!f(n) : false;
    };

    // -- Objects --
    hs.obj = function (name) {
      var list = liveWrapped(h, cleanName(name));
      return list.length ? list[0] : null;
    };
    hs.objs = function (name) { return liveWrapped(h, cleanName(name)); };
    hs.count = function (name) { return liveWrapped(h, cleanName(name)).length; };

    // -- Input actions (the named actions from the Inputs tab) --
    hs.input = function (name) {
      var n = cleanName(name);
      var f = hookFn(h, 'inputState');
      var st = (n && f) ? f(n) : null;
      return {
        held: !!(st && st.held),
        pressed: !!(st && st.pressed),
        released: !!(st && st.released)
      };
    };

    // -- Timers (named timers; elapsed uses the frozen game clock) --
    hs.elapsed = function (name) {
      var n = cleanName(name);
      if (!n) return 0;
      var f = hookFn(h, 'timerElapsed');
      return f ? Math.max(0, num(f(n))) : 0;
    };
    hs.startTimer = function (name) {
      var n = cleanName(name);
      if (!n) { warn(h, 'Script: hs.startTimer() needs a timer name.'); return; }
      var f = hookFn(h, 'timerStart');
      if (f) { try { f(n); } catch (e) {} }
    };
    hs.stopTimer = function (name) {
      var n = cleanName(name);
      if (!n) { warn(h, 'Script: hs.stopTimer() needs a timer name.'); return; }
      var f = hookFn(h, 'timerStop');
      if (f) { try { f(n); } catch (e) {} }
    };
    hs.resetTimer = hs.startTimer;

    // -- Audio --
    hs.play = function (soundName, opts) {
      var n = cleanName(soundName);
      if (!n) { warn(h, 'Script: hs.play() needs a sound/asset name.'); return; }
      var o = (opts && typeof opts === 'object') ? opts : {};
      var f = hookFn(h, 'playSound');
      if (f) { try { f(n, { bus: o.bus, volume: o.volume, pitch: o.pitch, loop: o.loop }); } catch (e) {} }
    };
    hs.stopMusic = function () { var f = hookFn(h, 'stopMusic'); if (f) { try { f(); } catch (e) {} } };
    hs.setBusVolume = function (bus, v) {
      var f = hookFn(h, 'setBusVolume');
      if (f) { try { f(bus, v); } catch (e) {} }
    };
    hs.setBusMuted = function (bus, on) {
      var f = hookFn(h, 'setBusMuted');
      if (f) { try { f(bus, on); } catch (e) {} }
    };
    hs.musicPlaying = function () {
      var f = hookFn(h, 'musicPlaying');
      return f ? !!f() : false;
    };

    // -- Scenes --
    hs.switchScene = function (name) {
      var n = cleanName(name);
      if (!n) { warn(h, 'Script: hs.switchScene() needs a scene name.'); return; }
      var f = hookFn(h, 'switchScene');
      if (f) { try { f(n); } catch (e) {} }
    };
    hs.scene = function () {
      var f = hookFn(h, 'currentSceneName');
      return f ? String(f() || '') : '';
    };

    // -- Camera --
    var camFns = {
      moveTo: function (x, y) { var f = hookFn(h, 'cameraMove'); if (f) { try { f(num(x), num(y)); } catch (e) {} } },
      setZoom: function (z) { var f = hookFn(h, 'cameraZoom'); if (f) { try { f(z); } catch (e) {} } },
      centerOn: function (name) {
        var n = cleanName(name);
        if (!n) { warn(h, 'Script: hs.camera.centerOn() needs an object name.'); return; }
        var f = hookFn(h, 'cameraCenterOn');
        if (f) { try { f(n); } catch (e) {} }
      },
      follow: function (name, ox, oy) {
        var n = cleanName(name);
        if (!n) { warn(h, 'Script: hs.camera.follow() needs an object name.'); return; }
        var f = hookFn(h, 'cameraFollow');
        if (f) { try { f(n, num(ox), num(oy)); } catch (e) {} }
      },
      stopFollow: function () { var f = hookFn(h, 'cameraStopFollow'); if (f) { try { f(); } catch (e) {} } },
      reset: function () { var f = hookFn(h, 'cameraReset'); if (f) { try { f(); } catch (e) {} } }
    };
    hs.camera = {};
    Object.defineProperties(hs.camera, {
      x:    { enumerable: true, get: function () { var f = hookFn(h, 'cameraRead'); var c = f ? f() : null; return c ? num(c.x) : 0; } },
      y:    { enumerable: true, get: function () { var f = hookFn(h, 'cameraRead'); var c = f ? f() : null; return c ? num(c.y) : 0; } },
      zoom: { enumerable: true, get: function () { var f = hookFn(h, 'cameraRead'); var c = f ? f() : null; return c ? num(c.zoom, 1) : 1; } }
    });
    hs.camera.moveTo = camFns.moveTo;
    hs.camera.setZoom = camFns.setZoom;
    hs.camera.centerOn = camFns.centerOn;
    hs.camera.follow = camFns.follow;
    hs.camera.stopFollow = camFns.stopFollow;
    hs.camera.reset = camFns.reset;

    // -- Particles --
    hs.burst = function (preset, x, y) {
      var f = hookFn(h, 'emitBurst');
      if (f) { try { f(cleanName(preset) || 'Explosion', num(x), num(y)); } catch (e) {} }
    };
    hs.startEmitter = function (name, preset, x, y) {
      var n = cleanName(name);
      if (!n) { warn(h, 'Script: hs.startEmitter() needs an emitter name.'); return; }
      var f = hookFn(h, 'startEmitter');
      if (f) { try { f(n, cleanName(preset) || 'Fire', num(x), num(y)); } catch (e) {} }
    };
    hs.stopEmitter = function (name) {
      var f = hookFn(h, 'stopEmitter');
      if (f) { try { f(cleanName(name)); } catch (e) {} }
    };
    hs.clearParticles = function () { var f = hookFn(h, 'clearParticles'); if (f) { try { f(); } catch (e) {} } };

    // -- Save slots --
    hs.saveGame = function (slot) {
      var s = cleanName(slot);
      if (!s) { warn(h, 'Script: hs.saveGame() needs a slot name.'); return; }
      var f = hookFn(h, 'saveGame');
      if (f) { try { f(s); } catch (e) {} }
    };
    hs.loadGame = function (slot) {
      var s = cleanName(slot);
      if (!s) { warn(h, 'Script: hs.loadGame() needs a slot name.'); return; }
      var f = hookFn(h, 'loadGame');
      if (f) { try { f(s); } catch (e) {} }
    };
    hs.deleteSave = function (slot) {
      var s = cleanName(slot);
      if (!s) { warn(h, 'Script: hs.deleteSave() needs a slot name.'); return; }
      var f = hookFn(h, 'deleteSave');
      if (f) { try { f(s); } catch (e) {} }
    };
    hs.saveExists = function (slot) {
      var s = cleanName(slot);
      if (!s) return false;
      var f = hookFn(h, 'saveExists');
      return f ? !!f(s) : false;
    };

    // -- Game flow --
    hs.pause = function () { var f = hookFn(h, 'pause'); if (f) { try { f(); } catch (e) {} } };
    hs.resume = function () { var f = hookFn(h, 'resume'); if (f) { try { f(); } catch (e) {} } };
    hs.isPaused = function () { var f = hookFn(h, 'isPaused'); return f ? !!f() : false; };
    hs.showProfiler = function () { var f = hookFn(h, 'showProfiler'); if (f) { try { f(); } catch (e) {} } };
    hs.hideProfiler = function () { var f = hookFn(h, 'hideProfiler'); if (f) { try { f(); } catch (e) {} } };
    hs.profilerVisible = function () { var f = hookFn(h, 'profilerVisible'); return f ? !!f() : false; };

    // -- Tilemaps --
    hs.setTile = function (tilemapName, col, row, tile) {
      var n = cleanName(tilemapName);
      if (!n) { warn(h, 'Script: hs.setTile() needs a tilemap name.'); return; }
      var f = hookFn(h, 'setTile');
      if (f) { try { f(n, Math.floor(num(col)), Math.floor(num(row)), Math.floor(num(tile))); } catch (e) {} }
    };
    hs.tileSolidAt = function (tilemapName, px, py) {
      var n = cleanName(tilemapName);
      if (!n) return false;
      var f = hookFn(h, 'tileSolidAt');
      return f ? !!f(n, num(px), num(py)) : false;
    };

    // -- Small math helpers (the engine's, so scripts match block math) --
    hs.rand = function (a, b) {
      var lo = num(a, 0), hi = (b === undefined ? 1 : num(b, 1));
      if (hi < lo) { var t = lo; lo = hi; hi = t; }
      return lo + Math.random() * (hi - lo);
    };
    hs.randInt = function (a, b) {
      var lo = Math.ceil(num(a, 0)), hi = Math.floor(b === undefined ? 1 : num(b, 1));
      if (hi < lo) { var t = lo; lo = hi; hi = t; }
      return lo + Math.floor(Math.random() * (hi - lo + 1));
    };
    hs.clamp = function (v, lo, hi) {
      var x = num(v), a = num(lo, 0), b = num(hi, 1);
      if (b < a) { var t = a; a = b; b = t; }
      return x < a ? a : (x > b ? b : x);
    };
    hs.round = function (v) { return Math.round(num(v)); };
    hs.dist = function (a, b) {
      function centerOf(x) {
        if (x && typeof x === 'object' && x._obj) return objectCenter(x._obj);
        if (x && typeof x === 'object' && typeof x.posX !== 'undefined') return objectCenter(x);
        if (typeof x === 'string') {
          var list = liveWrapped(h, cleanName(x));
          if (list.length) return objectCenter(list[0]._obj);
        }
        return null;
      }
      var pa = centerOf(a), pb = centerOf(b);
      if (!pa || !pb) return 0;
      var dx = pa.x - pb.x, dy = pa.y - pb.y;
      return Math.sqrt(dx * dx + dy * dy);
    };

    // -- Frame info --
    Object.defineProperty(hs, 'dt', {
      enumerable: true,
      get: function () {
        var f = hookFn(h, 'dtSeconds');
        var s = f ? num(f()) : 0;
        return s > 0 ? s : 0;
      }
    });

    // -- Console logging for script debugging --
    hs.log = function (msg) {
      var f = hookFn(h, 'log');
      if (f) { try { f(msg); } catch (e) {} }
    };

    return hs;
  }

  // --- Compile / run -------------------------------------------------------

  function compileAction(code) {
    var key = 'a\n' + code;
    var hit = cacheGet(key);
    if (hit) return hit;
    var entry;
    try {
      entry = { ok: true, fn: new Function('hs', '"use strict";\n' + code + '\n') };
    } catch (e) {
      entry = { ok: false, error: String((e && e.message) || e) };
    }
    cacheSet(key, entry);
    return entry;
  }

  function compileCondition(code) {
    var key = 'c\n' + code;
    var hit = cacheGet(key);
    if (hit) return hit;
    var entry;
    try {
      entry = { ok: true, fn: new Function('hs', '"use strict";\nreturn (\n' + code + '\n);') };
    } catch (e) {
      // Not an expression (statements instead)? Compile as a body and use
      // whatever it returns — usually undefined, which reads as false.
      try {
        entry = { ok: true, fn: new Function('hs', '"use strict";\n' + code + '\n') };
      } catch (e2) {
        entry = { ok: false, error: String((e2 && e2.message) || e2) };
      }
    }
    cacheSet(key, entry);
    return entry;
  }

  // Run a Run Script action's code. Warnings go through hooks.warn (the
  // host dedupes identical messages); nothing ever throws.
  function runAction(hooks, code) {
    if (code === undefined || code === null) return;
    if (typeof code !== 'string') {
      warn(hooks, 'Script: the code is not text, so the script was skipped.');
      return;
    }
    if (!code.trim()) return; // blank code stays quiet, like blank names
    var compiled = compileAction(code);
    if (!compiled.ok) {
      // Warn once per bad code string: the entry is cached, and both
      // runtimes also dedupe identical diagnostics per session.
      if (!compiled.warned) { compiled.warned = true; warn(hooks, 'Script error: ' + compiled.error); }
      return;
    }
    try {
      compiled.fn(createScriptAPI(hooks));
    } catch (e) {
      warn(hooks, 'Script error while running: ' + String((e && e.message) || e));
    }
  }

  // Evaluate a Script Check condition's code. Returns a boolean; errors
  // warn and read as false. Never throws.
  function evalCondition(hooks, code) {
    if (code === undefined || code === null) return false;
    if (typeof code !== 'string') {
      warn(hooks, 'Script: the code is not text, so the check read as false.');
      return false;
    }
    if (!code.trim()) return false;
    var compiled = compileCondition(code);
    if (!compiled.ok) {
      if (!compiled.warned) { compiled.warned = true; warn(hooks, 'Script error: ' + compiled.error); }
      return false;
    }
    try {
      return !!compiled.fn(createScriptAPI(hooks));
    } catch (e) {
      warn(hooks, 'Script error while running: ' + String((e && e.message) || e));
      return false;
    }
  }

  return {
    createScriptAPI: createScriptAPI,
    runAction: runAction,
    evalCondition: evalCondition,
    clearCache: clearCache,
    wrapObject: wrapObject
  };
}

window.HydraScriptApi = hydraScriptApiFactory();
// Self-contained source of the factory, inlined into exported playable games
// by HydraPlayer.buildPlayableHtml so exports run without editor files.
window.HydraScriptApi.factorySource = hydraScriptApiFactory.toString();
