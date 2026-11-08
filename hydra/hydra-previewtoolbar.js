/* HydraPreviewToolbar — the editor's preview toolbar (P2 item 14, slice 5).
 *
 * The preview tab's toolbar chrome: the device-frame selector (P3 item
 * 23), the Profiler toggle button (P4 item 34), the Flow Trace toggle
 * button + Clear button + trace feed panel (P4 item 36 phase C), and the
 * window-resize refit of the game canvas. script.js keeps thin
 * delegations (resizeGameCanvas / renderTraceFeed) so every existing
 * call site is unchanged; this module owns the `previewDevice` state
 * and the trace-feed render cache that used to be the script.js
 * `previewDevice` let and `previewState.traceRenderedCount`.
 *
 * This is a DOM module, not a pure one: it reads and writes toolbar
 * elements and the game canvas, so the node tests drive it through a
 * vm sandbox with a fake document (tests/previewtoolbar.test.js). The
 * canvas sizing math takes explicit arguments (canvas, scene, the
 * container element) and is testable with no live editor.
 *
 * Live editor state reaches the module only through configure():
 *   getScene           — () => the current preview scene, or null.
 *   getViewportSize    — (scene) => { width, height } for the canvas;
 *                        defaults to the scene's viewportWidth /
 *                        viewportHeight, 800x600 when there is none.
 *   clampCamera        — (scene) => clamps the preview camera to the
 *                        scene; defaults to a no-op.
 *   isPreviewTabActive — (doc) => true while the preview tab is the
 *                        visible tab; defaults to reading
 *                        #preview-tab's active class.
 *   getProfiler        — () => the live profiler record, or null.
 *   getTrace           — () => the live tracer record, or null.
 *   getHydraProfile    — () => the HydraProfile module; defaults to
 *                        globalThis.HydraProfile.
 *   getHydraTrace      — () => the HydraTrace module; defaults to
 *                        globalThis.HydraTrace.
 * Every provider is optional and replaced only by a function; a
 * throwing provider degrades to its safe default instead of breaking
 * the toolbar. The document is the explicit first argument to every
 * DOM function (a missing argument falls back to the global document,
 * a missing document is a no-op) and the canvas is always passed in,
 * so the module never reads editor globals.
 *
 * Documented behavior deltas (all in this header):
 * - resizeGameCanvas swallows a throwing getViewportSize / clampCamera
 *   provider and continues with 800x600 / no clamp (the old inline
 *   code would have thrown out of the game loop's resize path).
 * - A framed device letterboxes the game instead of stretching it:
 *   the canvas keeps the scene viewport's aspect ratio at one uniform
 *   scale inside the device (Nov 7, 2026: the old code showed the
 *   canvas at the device's aspect, so a portrait phone stretched
 *   circles into tall ellipses). letterboxSize is the pure helper.
 * - resizeGameCanvas with no scene and no getScene provider sizes the
 *   canvas 800x600 instead of throwing on a null scene.
 * - setPreviewDevice / initToolbar / syncToolbarButtons /
 *   renderTraceFeed are no-ops when the document or the element they
 *   need is missing (the old inline code guarded each lookup with
 *   optional chaining, same outcome).
 * - The trace-feed render cache lives in the module (resetTraceRender,
 *   called from resetGame) instead of on previewState; the toggle and
 *   clear handlers reset it to -1 so the next render rebuilds, exactly
 *   as the old code did by writing previewState.traceRenderedCount.
 *   resetTraceRender itself also sets -1, not the old 0: with 0 the
 *   first render of a fresh run could early-return when the previous
 *   run had also rendered zero events, leaving a stale feed (the
 *   waiting message surviving a restart that starts with tracing
 *   off, or vice versa). A fresh run always rebuilds the feed.
 *
 * Stays in script.js: the run state object (previewState), the drawGame
 * delegation, and the canvas element lookup; the preview runtime itself
 * (gameLoop, launchPreview, loadPreviewScene, the script-grid dispatch
 * and its hook builders) lives in hydra-previewruntime.js. The device
 * choice stays session state, never saved into project JSON, and the
 * frame stays display-only: the game still renders at the scene
 * viewport resolution.
 *
 * Follows the hydra-*.js factorySource pattern. Exports never inline
 * this module (exported games have no editor toolbar); factorySource
 * is kept so the module stays re-instantiable and testable like the
 * rest of the family.
 */
function hydraPreviewToolbarFactory() {
  'use strict';

  var DEVICES = {
    desktop: { label: 'Desktop', width: null, height: null },
    'phone-portrait': { label: 'Phone · portrait 390 × 844', width: 390, height: 844 },
    'phone-landscape': { label: 'Phone · landscape 844 × 390', width: 844, height: 390 },
    'tablet-portrait': { label: 'Tablet · portrait 768 × 1024', width: 768, height: 1024 }
  };
  var DEFAULT_WIDTH = 800;
  var DEFAULT_HEIGHT = 600;

  var previewDevice = 'desktop';
  var traceRenderedCount = 0;

  var getScene = function () { return null; };
  var getViewportSize = function (scene) {
    if (scene && Number.isFinite(scene.viewportWidth) && Number.isFinite(scene.viewportHeight)) {
      return { width: scene.viewportWidth, height: scene.viewportHeight };
    }
    if (scene && Number.isFinite(scene.width) && Number.isFinite(scene.height)) {
      return { width: scene.width, height: scene.height };
    }
    return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
  };
  var clampCamera = function () {};
  var isPreviewTabActive = function (doc) {
    if (!doc) return false;
    var tab = doc.getElementById ? doc.getElementById('preview-tab') : null;
    return !!(tab && tab.classList && tab.classList.contains('active'));
  };
  var getProfiler = function () { return null; };
  var getTrace = function () { return null; };
  var getHydraProfile = function () {
    return (typeof globalThis !== 'undefined' && globalThis.HydraProfile) || null;
  };
  var getHydraTrace = function () {
    return (typeof globalThis !== 'undefined' && globalThis.HydraTrace) || null;
  };

  function configure(providers) {
    if (!providers || typeof providers !== 'object') return;
    if (typeof providers.getScene === 'function') getScene = providers.getScene;
    if (typeof providers.getViewportSize === 'function') getViewportSize = providers.getViewportSize;
    if (typeof providers.clampCamera === 'function') clampCamera = providers.clampCamera;
    if (typeof providers.isPreviewTabActive === 'function') isPreviewTabActive = providers.isPreviewTabActive;
    if (typeof providers.getProfiler === 'function') getProfiler = providers.getProfiler;
    if (typeof providers.getTrace === 'function') getTrace = providers.getTrace;
    if (typeof providers.getHydraProfile === 'function') getHydraProfile = providers.getHydraProfile;
    if (typeof providers.getHydraTrace === 'function') getHydraTrace = providers.getHydraTrace;
  }

  function docOf(doc) {
    if (doc) return doc;
    if (typeof document !== 'undefined') return document;
    return null;
  }

  function element(doc, id) {
    var d = docOf(doc);
    if (!d || typeof d.getElementById !== 'function') return null;
    return d.getElementById(id) || null;
  }

  function canvasOf(doc, canvas) {
    if (canvas) return canvas;
    return element(doc, 'game-canvas');
  }

  function safeCall(fn, arg, fallback) {
    try {
      var v = fn(arg);
      return v === undefined ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  // --- Device frames (P3 item 23) -------------------------------------
  // A frame only changes the DISPLAY size of the canvas, and it never
  // stretches the game: the canvas is letterboxed — scaled uniformly
  // to fit inside the device, keeping the scene viewport's aspect
  // ratio, the way a real phone letterboxes a game instead of
  // stretching circles into ellipses. The choice is session state:
  // never saved into JSON.
  function devices() {
    var out = {};
    var keys = Object.keys(DEVICES);
    for (var i = 0; i < keys.length; i++) {
      var d = DEVICES[keys[i]];
      out[keys[i]] = { label: d.label, width: d.width, height: d.height };
    }
    return out;
  }

  function getDevice() { return previewDevice; }

  function setPreviewDevice(id, doc, canvas, scene) {
    if (!DEVICES[id]) id = 'desktop';
    previewDevice = id;
    var d = docOf(doc);
    var frame = element(d, 'preview-device-frame');
    var label = element(d, 'preview-device-label');
    var select = element(d, 'preview-device-select');
    if (frame && frame.dataset) frame.dataset.device = id;
    if (label) {
      label.textContent = DEVICES[id].label;
      label.hidden = id === 'desktop';
    }
    if (select && select.value !== id) select.value = id;
    resizeGameCanvas(d, canvas, scene);
  }

  // Letterbox fit: the largest display size for a viewW x viewH
  // viewport that fits inside a maxW x maxH box at one uniform scale,
  // so the aspect ratio never changes. A zero or negative box, or a
  // non-finite viewport, falls back to the natural size (scale 1),
  // matching the old fit-1 behavior when the pane has no room.
  function letterboxSize(viewW, viewH, maxW, maxH) {
    if (!Number.isFinite(viewW) || !Number.isFinite(viewH) ||
        viewW <= 0 || viewH <= 0 ||
        !Number.isFinite(maxW) || !Number.isFinite(maxH) ||
        maxW <= 0 || maxH <= 0) {
      return { width: viewW, height: viewH, scale: 1 };
    }
    var scale = Math.min(maxW / viewW, maxH / viewH);
    return {
      width: Math.round(viewW * scale),
      height: Math.round(viewH * scale),
      scale: scale
    };
  }

  function resizeGameCanvas(doc, canvas, scene) {
    var cv = canvasOf(doc, canvas);
    if (!cv) return;
    var d = docOf(doc);
    var sc = scene || safeCall(getScene, undefined, null);
    var size = safeCall(getViewportSize, sc, null);
    var viewW = (size && Number.isFinite(size.width)) ? size.width : DEFAULT_WIDTH;
    var viewH = (size && Number.isFinite(size.height)) ? size.height : DEFAULT_HEIGHT;
    var container = null;
    if (d && typeof d.querySelector === 'function') {
      try { container = d.querySelector('.fullscreen-preview') || null; } catch (e) { container = null; }
    }
    var device = DEVICES[previewDevice] || DEVICES.desktop;
    cv.width = viewW;
    cv.height = viewH;
    if (device.width && container) {
      // Framed device: letterbox the game inside the device. The
      // display box is the smaller of the pane (32px width / 56px
      // height allowance covers the bezel padding plus the frame
      // label) and the device itself, and the canvas fills that box
      // at one uniform scale — so a landscape game on a portrait
      // phone shows as a wide strip with empty bezel above and below
      // it, never as a stretched tall ellipse.
      var availW = Math.max(0, container.clientWidth - 32);
      var availH = Math.max(0, container.clientHeight - 56);
      var fit = letterboxSize(viewW, viewH,
        Math.min(availW, device.width), Math.min(availH, device.height));
      cv.style.width = fit.width + 'px';
      cv.style.height = fit.height + 'px';
    } else {
      var scale = container
        ? Math.min(container.clientWidth / viewW, container.clientHeight / viewH)
        : 1;
      cv.style.width = Math.round(viewW * scale) + 'px';
      cv.style.height = Math.round(viewH * scale) + 'px';
    }
    if (sc) safeCall(clampCamera, sc, undefined);
  }

  function onWindowResize(doc, canvas) {
    var d = docOf(doc);
    if (!d) return;
    if (safeCall(isPreviewTabActive, d, false)) resizeGameCanvas(d, canvas);
  }

  // --- Profiler / Trace toolbar sync (P4 items 34 + 36 phase C) -------
  // Runs every frame from drawGame's onFrameEnd hook, so block-driven
  // visibility changes still show the right button state.
  function syncToolbarButtons(doc) {
    var d = docOf(doc);
    if (!d) return;
    var profile = safeCall(getHydraProfile, undefined, null);
    var profiler = safeCall(getProfiler, undefined, null);
    if (profile && profiler) {
      var btn = element(d, 'preview-profiler-btn');
      if (btn && btn.classList) {
        btn.classList.toggle('active', !!safeCall(function () { return profile.isVisible(profiler); }, undefined, false));
      }
    }
    var trace = safeCall(getHydraTrace, undefined, null);
    var tracer = safeCall(getTrace, undefined, null);
    if (trace && tracer) {
      var tracing = !!safeCall(function () { return trace.isEnabled(tracer); }, undefined, false);
      var traceBtn = element(d, 'preview-trace-btn');
      if (traceBtn && traceBtn.classList) traceBtn.classList.toggle('active', tracing);
      var panel = element(d, 'trace-panel');
      if (panel) panel.hidden = !tracing;
    }
  }

  // --- Trace feed (P4 item 36 phase C) --------------------------------
  // Renders the tracer ring (newest last, capped at the 50 most recent
  // events). Rebuilds only when the event count changed since the last
  // render, so the per-frame call stays cheap. Entries are built with
  // textContent, never innerHTML: block types and scope keys come from
  // project data and must not inject markup.
  function renderTraceFeed(doc) {
    var d = docOf(doc);
    if (!d) return;
    var panel = element(d, 'trace-panel');
    var feed = element(d, 'trace-feed');
    var Ht = safeCall(getHydraTrace, undefined, null);
    var tracer = safeCall(getTrace, undefined, null);
    if (!panel || !feed || !Ht || !tracer) return;
    var events = safeCall(function () { return Ht.recent(tracer, 50); }, undefined, []);
    if (!Array.isArray(events)) events = [];
    var total = (tracer.events && typeof tracer.events.length === 'number') ? tracer.events.length : events.length;
    if (traceRenderedCount === total && feed.dataset && feed.dataset.rendered === String(events.length)) return;
    traceRenderedCount = total;
    if (feed.dataset) feed.dataset.rendered = String(events.length);
    feed.textContent = '';
    var empty;
    if (!safeCall(function () { return Ht.isEnabled(tracer); }, undefined, false)) {
      empty = d.createElement('div');
      empty.className = 'trace-empty';
      empty.textContent = 'Tracing is off. Turn on Trace to watch blocks fire.';
      feed.appendChild(empty);
      return;
    }
    if (events.length === 0) {
      empty = d.createElement('div');
      empty.className = 'trace-empty';
      empty.textContent = 'Tracing is on. Waiting for blocks to fire.';
      feed.appendChild(empty);
      return;
    }
    for (var i = 0; i < events.length; i++) {
      var line = d.createElement('div');
      line.className = 'trace-line';
      var ev = events[i];
      line.textContent = safeCall(function () { return Ht.formatEvent(ev); }, undefined, '');
      feed.appendChild(line);
    }
    feed.scrollTop = feed.scrollHeight;
  }

  function resetTraceRender() { traceRenderedCount = -1; }

  // --- Wiring ----------------------------------------------------------
  function initToolbar(doc, canvas) {
    var d = docOf(doc);
    if (!d) return;
    var select = element(d, 'preview-device-select');
    if (select && typeof select.addEventListener === 'function') {
      select.addEventListener('change', function (e) {
        setPreviewDevice(e.target.value, d, canvas);
      });
    }
    var profilerBtn = element(d, 'preview-profiler-btn');
    if (profilerBtn && typeof profilerBtn.addEventListener === 'function') {
      // Toolbar toggle for playtesting without blocks. Flips the same
      // runtime state the Show/Hide/Toggle Profiler blocks use.
      profilerBtn.addEventListener('click', function () {
        var profile = safeCall(getHydraProfile, undefined, null);
        var profiler = safeCall(getProfiler, undefined, null);
        if (profile && profiler) safeCall(function () { profile.toggle(profiler); }, undefined, undefined);
      });
    }
    var traceBtn = element(d, 'preview-trace-btn');
    if (traceBtn && typeof traceBtn.addEventListener === 'function') {
      // Toolbar toggle for watching logic fire live, without blocks.
      // Enabling clears the feed so it starts fresh.
      traceBtn.addEventListener('click', function () {
        var trace = safeCall(getHydraTrace, undefined, null);
        var tracer = safeCall(getTrace, undefined, null);
        if (trace && tracer) {
          safeCall(function () { trace.toggle(tracer); }, undefined, undefined);
          traceRenderedCount = -1;
          renderTraceFeed(d);
        }
      });
    }
    var clearBtn = element(d, 'trace-clear-btn');
    if (clearBtn && typeof clearBtn.addEventListener === 'function') {
      clearBtn.addEventListener('click', function () {
        var trace = safeCall(getHydraTrace, undefined, null);
        var tracer = safeCall(getTrace, undefined, null);
        if (trace && tracer) {
          safeCall(function () { trace.clear(tracer); }, undefined, undefined);
          renderTraceFeed(d);
        }
      });
    }
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('resize', function () { onWindowResize(d, canvas); });
    }
  }

  return {
    configure: configure,
    devices: devices,
    getDevice: getDevice,
    setPreviewDevice: setPreviewDevice,
    letterboxSize: letterboxSize,
    resizeGameCanvas: resizeGameCanvas,
    onWindowResize: onWindowResize,
    syncToolbarButtons: syncToolbarButtons,
    renderTraceFeed: renderTraceFeed,
    resetTraceRender: resetTraceRender,
    initToolbar: initToolbar
  };
}

if (typeof window !== 'undefined') {
  window.HydraPreviewToolbar = hydraPreviewToolbarFactory();
  // Self-contained source of the factory, kept as a string, never eval'd
  // here. Exports never inline this module (no editor toolbar in a
  // shipped game); factorySource stays so the module is re-instantiable
  // and testable like the rest of the hydra-*.js family.
  window.HydraPreviewToolbar.factorySource = hydraPreviewToolbarFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraPreviewToolbarFactory;
