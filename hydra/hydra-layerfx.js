/* ============================================================================
 * hydra-layerfx.js — HydraScript shared layers and visual effects.
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation of
 * the layer/effects block semantics used by:
 *   - the editor preview runtime (script.js delegates to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Layers (draw order): every object already has a numeric `layer` field
 * (the Set Layer block writes an absolute value). These blocks manage
 * relative ordering — the bread and butter of 2D scene composition:
 *   - Bring to Front (action): moves the targets above every other live
 *     object (layer = highest layer + 1).
 *   - Send to Back (action): moves the targets below every other live
 *     object (layer = lowest layer - 1).
 *   - Move Up a Layer / Move Down a Layer (actions): shift the targets by
 *     the Steps expression (default 1).
 *   - Layer Check (condition): true while a live object with the given
 *     name has a layer matching the comparison. A plain state read, like
 *     getVariable — defaults to 'level' trigger mode, evaluates while
 *     paused.
 *
 * Effects (drawing-only, like flip/scale — collision is untouched):
 *   - Set Blend Mode (action): how the object blends with what is under
 *     it — Normal, Add (lighten, for lasers/glows), Multiply, Screen,
 *     Overlay, Difference.
 *   - Set Shadow (action): a drop shadow under the object — color, blur
 *     (0-64), and X/Y offset.
 *   - Set Visual Effect (action): a filter over the object's pixels —
 *     Grayscale, Sepia, Invert, Brighten, Dim, Soft Blur.
 *   - Clear Effects (action): resets blend, shadow, and filter back to
 *     normal on the targets.
 *
 * Conventions (kept identical in preview and exports):
 *   - Nothing here ever throws; hostile input produces a safe fallback.
 *   - A blank target name stays quiet for the condition (no per-frame
 *     warning spam — the timer/pick convention) and does nothing for the
 *     actions.
 *   - Effects live on plain object fields (`blendMode`, `shadowColor`,
 *     `shadowBlur`, `shadowOffsetX`, `shadowOffsetY`, `visualEffect`), so
 *     they serialize with the project and draw identically everywhere.
 *     `applyObjectEffects` coerces defensively — old projects and hand-
 *     edited data never crash the draw path.
 *
 * The hooks contract: targets(data) returns the host's resolved action
 * targets for the block (already context-aware in the runtimes, so picking
 * works: Pick Nearest -> Bring to Front hits only the picked object);
 * allObjects() returns every live object for the front/back bounds;
 * num(raw) evaluates an expression like the other shared modules;
 * warn(msg) reports a runtime diagnostic.
 *
 * Load order (index.html): hydra-layerfx.js BEFORE player-runtime.js and
 * script.js. player-runtime.js throws a clear error if HydraLayerFx is
 * missing.
 * ========================================================================== */

function hydraLayerFxFactory() {
  'use strict';

  var ACTION_TYPES = ['bringToFront', 'sendToBack', 'moveLayerUp', 'moveLayerDown',
    'setBlendMode', 'setShadow', 'setVisualEffect', 'clearEffects'];
  var CONDITION_TYPES = ['layerCheck'];

  var BLEND_MAP = {
    normal: 'source-over',
    add: 'lighter',
    multiply: 'multiply',
    screen: 'screen',
    overlay: 'overlay',
    difference: 'difference'
  };

  var FILTER_MAP = {
    none: 'none',
    grayscale: 'grayscale(100%)',
    sepia: 'sepia(100%)',
    invert: 'invert(100%)',
    brighten: 'brightness(1.6)',
    dim: 'brightness(0.55)',
    blur: 'blur(3px)'
  };

  function isLayerFxAction(t) { return ACTION_TYPES.indexOf(t) >= 0; }
  function isLayerFxCondition(t) { return CONDITION_TYPES.indexOf(t) >= 0; }

  // Numeric draw layer, defensive: hostile or missing fields collapse to 0.
  function layerOf(obj) {
    if (!obj || typeof obj !== 'object') return 0;
    var l = Number(obj.layer);
    return Number.isFinite(l) ? l : 0;
  }

  function finiteList(objects) {
    var out = [];
    for (var i = 0; i < (objects || []).length; i++) {
      var o = objects[i];
      if (o && typeof o === 'object') out.push(o);
    }
    return out;
  }

  function bringToFront(objects, obj) {
    if (!obj || typeof obj !== 'object') return;
    var live = finiteList(objects);
    var top = -Infinity;
    for (var i = 0; i < live.length; i++) {
      var l = layerOf(live[i]);
      if (l > top) top = l;
    }
    // An empty scene has no highest layer; 0 is the neutral base.
    obj.layer = (top === -Infinity ? 0 : top) + 1;
  }

  function sendToBack(objects, obj) {
    if (!obj || typeof obj !== 'object') return;
    var live = finiteList(objects);
    var bottom = Infinity;
    for (var i = 0; i < live.length; i++) {
      var l = layerOf(live[i]);
      if (l < bottom) bottom = l;
    }
    // An empty scene has no lowest layer; 0 is the neutral base.
    obj.layer = (bottom === Infinity ? 0 : bottom) - 1;
  }

  function shiftLayer(obj, delta) {
    if (!obj || typeof obj !== 'object') return;
    var d = Number(delta);
    obj.layer = layerOf(obj) + (Number.isFinite(d) ? d : 0);
  }

  // Canonical blend select value -> canvas composite op. Unknown values fall
  // back to normal drawing, never throw.
  function blendCompositeOf(mode) {
    var key = String(mode == null ? 'normal' : mode).toLowerCase().trim();
    return BLEND_MAP[key] || 'source-over';
  }

  // Canonical effect select value -> canvas filter string. 'none' (or
  // anything unknown) means no filter.
  function filterOf(effect) {
    var key = String(effect == null ? 'none' : effect).toLowerCase().trim();
    return FILTER_MAP[key] || 'none';
  }

  function shadowBlurOf(raw) {
    var b = Number(raw);
    if (!Number.isFinite(b) || b <= 0) return 0;
    return Math.min(64, b);
  }

  // Draw-time application. Call inside the object's save/restore pair (every
  // draw path already wraps in ctx.save()/restore(), which resets these).
  // Never throws; hostile fields collapse to "no effect".
  function applyObjectEffects(ctx, obj) {
    if (!ctx || !obj || typeof obj !== 'object') return;
    try {
      var blend = blendCompositeOf(obj.blendMode);
      if (blend !== 'source-over') ctx.globalCompositeOperation = blend;
      var blur = shadowBlurOf(obj.shadowBlur);
      if (blur > 0 && typeof obj.shadowColor === 'string' && obj.shadowColor) {
        ctx.shadowColor = obj.shadowColor;
        ctx.shadowBlur = blur;
        var ox = Number(obj.shadowOffsetX), oy = Number(obj.shadowOffsetY);
        ctx.shadowOffsetX = Number.isFinite(ox) ? ox : 0;
        ctx.shadowOffsetY = Number.isFinite(oy) ? oy : 0;
      }
      var filter = filterOf(obj.visualEffect);
      if (filter !== 'none' && typeof ctx.filter === 'string') ctx.filter = filter;
    } catch (e) { /* effects are cosmetic; never break the draw */ }
  }

  function numValue(hooks, raw) {
    try {
      var r = hooks.num(raw);
      if (r && typeof r.value !== 'undefined' && Number.isFinite(Number(r.value))) {
        return { ok: true, value: Number(r.value) };
      }
      // naive hooks (unit tests) may return a bare number
      if (typeof r === 'number' && Number.isFinite(r)) return { ok: true, value: r };
    } catch (e) { /* fall through */ }
    return { ok: false, value: 0 };
  }

  function safeTargets(hooks, data) {
    try {
      var list = hooks.targets(data);
      return finiteList(list);
    } catch (e) { return []; }
  }

  function safeAllObjects(hooks) {
    try {
      return finiteList(hooks.allObjects());
    } catch (e) { return []; }
  }

  // ---------- action dispatch ----------
  function applyLayerFxAction(data, hooks) {
    if (!data || typeof data !== 'object') return;
    var type = data.type;
    if (ACTION_TYPES.indexOf(type) < 0) return;
    var targets = safeTargets(hooks, data);

    if (type === 'bringToFront') {
      var all = safeAllObjects(hooks);
      targets.forEach(function (o) { bringToFront(all, o); });
      return;
    }
    if (type === 'sendToBack') {
      var all2 = safeAllObjects(hooks);
      targets.forEach(function (o) { sendToBack(all2, o); });
      return;
    }
    if (type === 'moveLayerUp' || type === 'moveLayerDown') {
      var sv = numValue(hooks, data.steps == null ? 1 : data.steps);
      var delta = sv.ok ? sv.value : 0;
      if (!sv.ok) {
        try { hooks.warn('Move Layer ' + (type === 'moveLayerUp' ? 'Up' : 'Down') + ': bad Steps expression — object not moved.'); } catch (e) {}
      }
      if (type === 'moveLayerDown') delta = -delta;
      targets.forEach(function (o) { shiftLayer(o, delta); });
      return;
    }
    if (type === 'setBlendMode') {
      var mode = String(data.blend == null ? 'normal' : data.blend);
      targets.forEach(function (o) { o.blendMode = mode; });
      return;
    }
    if (type === 'setShadow') {
      var color = typeof data.color === 'string' ? data.color : '#000000';
      var bv = numValue(hooks, data.blur == null ? 8 : data.blur);
      var oxv = numValue(hooks, data.offsetX == null ? 0 : data.offsetX);
      var oyv = numValue(hooks, data.offsetY == null ? 0 : data.offsetY);
      targets.forEach(function (o) {
        o.shadowColor = color;
        o.shadowBlur = bv.ok ? shadowBlurOf(bv.value) : 0;
        o.shadowOffsetX = oxv.ok ? oxv.value : 0;
        o.shadowOffsetY = oyv.ok ? oyv.value : 0;
      });
      return;
    }
    if (type === 'setVisualEffect') {
      var effect = String(data.effect == null ? 'none' : data.effect);
      targets.forEach(function (o) { o.visualEffect = effect; });
      return;
    }
    if (type === 'clearEffects') {
      targets.forEach(function (o) {
        delete o.blendMode;
        delete o.shadowColor;
        delete o.shadowBlur;
        delete o.shadowOffsetX;
        delete o.shadowOffsetY;
        delete o.visualEffect;
      });
    }
  }

  // ---------- condition dispatch (read-only) ----------
  //
  // Returns { pass, context }. Quiet (no per-frame warning spam) when the
  // target name is blank or no live object matches — the timer/pick
  // convention. On a pass, context.obj1 is the first matching object.
  function evalLayerFxCondition(data, hooks) {
    var ctx = {};
    function quiet() { return { pass: false, context: ctx }; }
    if (!data || typeof data !== 'object') return quiet();
    if (CONDITION_TYPES.indexOf(data.type) < 0) return quiet();
    var targets = safeTargets(hooks, data);
    if (targets.length === 0) return quiet();
    var cv = numValue(hooks, data.value == null ? 0 : data.value);
    if (!cv.ok) return quiet();
    var op = typeof data.operator === 'string' ? data.operator : '>=';
    var pass = false, matched = null;
    for (var i = 0; i < targets.length; i++) {
      if (compareLayer(layerOf(targets[i]), op, cv.value)) {
        pass = true;
        matched = targets[i];
        break;
      }
    }
    if (matched) ctx.obj1 = matched;
    return { pass: pass, context: ctx };
  }

  function compareLayer(a, op, b) {
    switch (op) {
      case '>=': return a >= b;
      case '<=': return a <= b;
      case '==': return a === b;
      case '!=': return a !== b;
      case '>': return a > b;
      case '<': return a < b;
      default: return false;
    }
  }

  return {
    ACTION_TYPES: ACTION_TYPES,
    CONDITION_TYPES: CONDITION_TYPES,
    isLayerFxAction: isLayerFxAction,
    isLayerFxCondition: isLayerFxCondition,
    layerOf: layerOf,
    bringToFront: bringToFront,
    sendToBack: sendToBack,
    shiftLayer: shiftLayer,
    blendCompositeOf: blendCompositeOf,
    filterOf: filterOf,
    shadowBlurOf: shadowBlurOf,
    applyObjectEffects: applyObjectEffects,
    applyLayerFxAction: applyLayerFxAction,
    evalLayerFxCondition: evalLayerFxCondition,
    compareLayer: compareLayer
  };
}

window.HydraLayerFx = hydraLayerFxFactory();
// Self-contained source of the factory, inlined into exported playable games
// by HydraPlayer.buildPlayableHtml so exports run without editor files.
window.HydraLayerFx.factorySource = hydraLayerFxFactory.toString();
