/* ============================================================================
 * hydra-panelresize.js — HydraScript resizable editor panels (P5 core-engine
 * track, item P5-2: pro editor shell, pass 1 — slice d, the last pass-1
 * slice: resizable panels).
 *
 * Pure logic plus one thin DOM wiring helper, no other HydraScript
 * dependency. Used by the editor (script.js initPanelResizers); the
 * exported standalone game has no editor panels, so nothing here is
 * inlined into exports.
 *
 * Idea (Unreal / Godot / VS Code, beginner edition): the Scene tab's
 * inspector and the Logic tab's block palette sit in side panels with
 * fixed widths (340px / 320px), so a wide Hierarchy list or a long
 * property form either fits or it does not — the user cannot trade
 * stage space for panel space. A drag handle on each panel's left edge
 * lets the user widen or narrow it, and the width sticks: it is saved
 * in localStorage and restored on the next load. Double-click a handle
 * (or press Home on it) to snap back to the default width.
 *
 * How it works: the layout reads a CSS variable off the tab's
 * container — --scene-panel-width on .scene-editor, --logic-panel-width
 * on .grid-editor — so the stage, the toolbar, and the panel all move
 * together from one value. The drag is pointer-based (mouse and touch
 * alike): the new width is the container's right edge minus the
 * pointer's x, clamped to the panel's limits. A left-docked panel
 * (P5-8 slice a, hydra-paneldock.js) measures from the container's
 * left edge instead — the resizer takes a side, and setSide flips it
 * live when the panel docks to the other edge. The handle is also a
 * keyboard control (role="separator", arrow keys step 10px, Shift
 * steps 40px) so the panels resize without a mouse, matching the P3
 * accessibility pass; the arrows keep their meaning on both sides
 * (Right widens, Left narrows), so only the pointer math is
 * side-aware.
 *
 * Nothing ever throws; hostile input degrades to safe defaults. A
 * missing handle, container, or storage object simply means that
 * panel stays at its default width.
 *
 * Honest limits: below the 900px breakpoint the panels dock below
 * their main area (the P3 responsive rule), so the handles hide there
 * and dragging does nothing — resizing is a wide-screen feature. The
 * widths are per browser (localStorage), not per project, so they
 * follow the machine, not the .hydra file.
 * ========================================================================== */

function hydraPanelResizeFactory() {
  'use strict';

  // The two resizable panels, their defaults, and their limits. The
  // scene inspector needs room for the 5-column inspector-tab grid and
  // the wide property forms (240px would squeeze the tabs to 44px
  // columns; 560px still leaves a usable stage at 1400px wide). The
  // logic panel holds the block palette and the property panel (240px
  // keeps block labels readable; 520px still leaves grid room).
  var DEFAULT_WIDTHS = { scene: 340, logic: 320 };
  var LIMITS = {
    scene: { min: 240, max: 560 },
    logic: { min: 240, max: 520 }
  };
  var CSS_VARS = {
    scene: '--scene-panel-width',
    logic: '--logic-panel-width'
  };
  var STORAGE_KEY = 'hydra.panelWidths.v1';

  function isPanelKey(key) {
    return key === 'scene' || key === 'logic';
  }

  function toFiniteNumber(value, fallback) {
    var n = (typeof value === 'number') ? value : Number(value);
    return (typeof n === 'number' && isFinite(n)) ? n : fallback;
  }

  // Clamp a width to a panel's limits. Non-finite input (a broken
  // stored value, a NaN drag) falls back to the panel's default, so a
  // bad value can never collapse or explode a panel.
  function clampWidth(panel, value) {
    if (!isPanelKey(panel)) return DEFAULT_WIDTHS.scene;
    var limits = LIMITS[panel];
    var n = toFiniteNumber(value, DEFAULT_WIDTHS[panel]);
    if (n < limits.min) return limits.min;
    if (n > limits.max) return limits.max;
    return Math.round(n);
  }

  // Parse the stored widths JSON. Anything unparseable, wrong-shaped,
  // or out of range degrades to the defaults for that panel — one bad
  // entry never takes the other panel's width down with it.
  function parseStoredWidths(raw) {
    var out = { scene: DEFAULT_WIDTHS.scene, logic: DEFAULT_WIDTHS.logic };
    if (typeof raw !== 'string' || !raw) return out;
    var parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { return out; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
    if (isPanelKey('scene') && parsed.scene !== undefined) out.scene = clampWidth('scene', parsed.scene);
    if (isPanelKey('logic') && parsed.logic !== undefined) out.logic = clampWidth('logic', parsed.logic);
    return out;
  }

  // Serialize widths for storage: both panels, clamped, so a stored
  // value is always one parseStoredWidths would accept back.
  function serializeWidths(widths) {
    var out = { scene: DEFAULT_WIDTHS.scene, logic: DEFAULT_WIDTHS.logic };
    if (widths && typeof widths === 'object') {
      if (widths.scene !== undefined) out.scene = clampWidth('scene', widths.scene);
      if (widths.logic !== undefined) out.logic = clampWidth('logic', widths.logic);
    }
    try { return JSON.stringify(out); } catch (e) { return JSON.stringify(DEFAULT_WIDTHS); }
  }

  // The width a pointer position implies: both panels hang off their
  // container's right edge, and the drag edge is the panel's left
  // edge, so width = container right edge minus pointer x. The
  // caller clamps the result with clampWidth.
  function widthFromPointer(containerRect, clientX) {
    if (!containerRect || typeof containerRect.right !== 'number') return null;
    var x = toFiniteNumber(clientX, NaN);
    if (typeof x !== 'number' || !isFinite(x)) return null;
    return Math.round(containerRect.right - x);
  }

  // The same width for a left-docked panel (P5-8 slice a): the panel
  // hangs off the container's left edge and the drag edge is its
  // right edge, so width = pointer x minus container left edge.
  function widthFromPointerLeft(containerRect, clientX) {
    if (!containerRect || typeof containerRect.left !== 'number') return null;
    var x = toFiniteNumber(clientX, NaN);
    if (typeof x !== 'number' || !isFinite(x)) return null;
    return Math.round(x - containerRect.left);
  }

  // Side-aware pointer math: 'left' measures from the left edge,
  // anything else reads as the default right-side rule.
  function widthFromPointerForSide(containerRect, clientX, side) {
    return side === 'left'
      ? widthFromPointerLeft(containerRect, clientX)
      : widthFromPointer(containerRect, clientX);
  }

  // Normalize a dock side for the drag math: only 'left' is special.
  function normalizeSide(side) {
    return side === 'left' ? 'left' : 'right';
  }

  // Keyboard resize: Left/Right arrows step 10px (40px with Shift);
  // Home resets to the default. Returns { delta } or { reset: true },
  // or null for any other key so the caller ignores it.
  function keyboardDelta(key, shiftKey) {
    if (key === 'Home') return { reset: true };
    if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null;
    var step = shiftKey ? 40 : 10;
    // Left narrows the panel (its left edge moves right), Right widens.
    return { delta: key === 'ArrowLeft' ? -step : step };
  }

  // Read the stored widths through a localStorage-shaped object
  // (getItem / setItem). A missing or throwing storage degrades to
  // the defaults instead of breaking the editor load.
  function readStoredWidths(storage) {
    try {
      if (!storage || typeof storage.getItem !== 'function') {
        return { scene: DEFAULT_WIDTHS.scene, logic: DEFAULT_WIDTHS.logic };
      }
      return parseStoredWidths(storage.getItem(STORAGE_KEY));
    } catch (e) {
      return { scene: DEFAULT_WIDTHS.scene, logic: DEFAULT_WIDTHS.logic };
    }
  }

  function writeStoredWidths(storage, widths) {
    try {
      if (!storage || typeof storage.setItem !== 'function') return false;
      storage.setItem(STORAGE_KEY, serializeWidths(widths));
      return true;
    } catch (e) { return false; }
  }

  // Wire one drag handle to one panel. cfg:
  //   panel ('scene' | 'logic'), handle (the .panel-resizer element),
  //   container (the element carrying the CSS var: .scene-editor or
  //   .grid-editor), storage (localStorage-shaped), getWidths (reads the
  //   host's current { scene, logic } so a drag writes both panels
  //   back, keeping the stored pair in sync), onWidth (host callback
  //   fired with (panel, width) whenever the width changes — the host
  //   applies it to the CSS var), side ('left' | 'right', default
  //   'right': which edge the panel hangs off — the dock toggle flips
  //   it live through the returned setSide).
  // Returns a { destroy, getWidth, getSide, setSide, apply } handle,
  // or null when the wiring cannot run.
  function createResizer(cfg) {
    try {
      if (!cfg || !isPanelKey(cfg.panel)) return null;
      var handle = cfg.handle || null;
      var container = cfg.container || null;
      if (!handle || !container) return null;
      if (typeof handle.addEventListener !== 'function') return null;
      if (!container.style || typeof container.style.setProperty !== 'function') return null;

      var panel = cfg.panel;
      var cssVar = CSS_VARS[panel];
      var side = normalizeSide(cfg.side);
      var current = clampWidth(panel, (cfg.getWidths && cfg.getWidths()[panel]) || DEFAULT_WIDTHS[panel]);

      function apply(width, persist) {
        current = clampWidth(panel, width);
        try { container.style.setProperty(cssVar, current + 'px'); } catch (e) { /* var write never breaks the editor */ }
        try { if (typeof handle.setAttribute === 'function') handle.setAttribute('aria-valuenow', String(current)); } catch (e) {}
        if (typeof cfg.onWidth === 'function') {
          try { cfg.onWidth(panel, current); } catch (e) {}
        }
        if (persist) {
          var widths = { scene: DEFAULT_WIDTHS.scene, logic: DEFAULT_WIDTHS.logic };
          try {
            if (typeof cfg.getWidths === 'function') {
              var got = cfg.getWidths() || {};
              if (got.scene !== undefined) widths.scene = got.scene;
              if (got.logic !== undefined) widths.logic = got.logic;
            }
          } catch (e) {}
          widths[panel] = current;
          writeStoredWidths(cfg.storage, widths);
        }
      }

      function containerRect() {
        try {
          if (typeof container.getBoundingClientRect !== 'function') return null;
          return container.getBoundingClientRect();
        } catch (e) { return null; }
      }

      var dragging = false;
      var moveListener = null;
      var upListener = null;

      function stopDrag(persist) {
        if (!dragging) return;
        dragging = false;
        try {
          if (typeof document !== 'undefined' && document.removeEventListener) {
            if (moveListener) document.removeEventListener('pointermove', moveListener);
            if (upListener) document.removeEventListener('pointerup', upListener);
          }
        } catch (e) {}
        moveListener = null;
        upListener = null;
        if (persist) apply(current, true);
      }

      function onPointerDown(ev) {
        if (!ev || typeof ev.preventDefault !== 'function') return;
        // Only the primary button starts a drag.
        if (typeof ev.button === 'number' && ev.button !== 0) return;
        ev.preventDefault();
        dragging = true;
        try {
          if (typeof handle.setPointerCapture === 'function' && ev.pointerId !== undefined) {
            handle.setPointerCapture(ev.pointerId);
          }
        } catch (e) { /* capture is best-effort; the document listeners still track */ }
        moveListener = function (moveEv) {
          if (!dragging) return;
          var w = widthFromPointerForSide(containerRect(), moveEv && moveEv.clientX, side);
          if (w !== null) apply(clampWidth(panel, w), false);
        };
        upListener = function () { stopDrag(true); };
        try {
          if (typeof document !== 'undefined' && document.addEventListener) {
            document.addEventListener('pointermove', moveListener);
            document.addEventListener('pointerup', upListener);
          }
        } catch (e) {}
      }

      function onDoubleClick(ev) {
        if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
        apply(DEFAULT_WIDTHS[panel], true);
      }

      function onKeyDown(ev) {
        if (!ev || typeof ev.key !== 'string') return;
        var action = keyboardDelta(ev.key, !!ev.shiftKey);
        if (!action) return;
        if (typeof ev.preventDefault === 'function') ev.preventDefault();
        if (action.reset) apply(DEFAULT_WIDTHS[panel], true);
        else apply(current + action.delta, true);
      }

      handle.addEventListener('pointerdown', onPointerDown);
      handle.addEventListener('dblclick', onDoubleClick);
      handle.addEventListener('keydown', onKeyDown);
      // The starting width (from storage, applied by the host before
      // wiring) is announced to assistive tech from the first render.
      try { if (typeof handle.setAttribute === 'function') handle.setAttribute('aria-valuenow', String(current)); } catch (e) {}

      return {
        destroy: function () {
          stopDrag(false);
          try {
            if (typeof handle.removeEventListener === 'function') {
              handle.removeEventListener('pointerdown', onPointerDown);
              handle.removeEventListener('dblclick', onDoubleClick);
              handle.removeEventListener('keydown', onKeyDown);
            }
          } catch (e) {}
        },
        getWidth: function () { return current; },
        getSide: function () { return side; },
        setSide: function (newSide) { side = normalizeSide(newSide); },
        apply: apply
      };
    } catch (e) { return null; }
  }

  return {
    DEFAULT_WIDTHS: DEFAULT_WIDTHS,
    LIMITS: LIMITS,
    CSS_VARS: CSS_VARS,
    STORAGE_KEY: STORAGE_KEY,
    clampWidth: clampWidth,
    parseStoredWidths: parseStoredWidths,
    serializeWidths: serializeWidths,
    widthFromPointer: widthFromPointer,
    widthFromPointerLeft: widthFromPointerLeft,
    widthFromPointerForSide: widthFromPointerForSide,
    normalizeSide: normalizeSide,
    keyboardDelta: keyboardDelta,
    readStoredWidths: readStoredWidths,
    writeStoredWidths: writeStoredWidths,
    createResizer: createResizer
  };
}

if (typeof window !== 'undefined') window.HydraPanelResize = hydraPanelResizeFactory();
if (typeof window !== 'undefined') window.HydraPanelResize.factorySource = hydraPanelResizeFactory.toString();
if (typeof module !== 'undefined' && module.exports) module.exports = hydraPanelResizeFactory;
