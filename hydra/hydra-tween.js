/* ============================================================================
 * hydra-tween.js — HydraScript shared tween helpers.
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation of
 * tween playback (animate any numeric property over time with easing) used by:
 *   - the editor preview runtime (script.js delegates to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Data model: tweens are transient runs, NOT saved in project JSON. The
 * block's spec lives on the logic-grid cell:
 *   { type: 'tweenProperty', targetObject, property, toValue, relative,
 *     duration (seconds), easing, repeat }
 *
 * Runtime state (per object, created fresh at game start / scene load):
 *   obj._tweens = [ { id, property, from, to, durationMs, elapsedMs,
 *                     easing, repeat } ]
 *   obj._tweenFinished = [ { id, property } ]  // completed once-tweens
 *
 * Semantics:
 *   - A new tween REPLACES any running tween on the same property, so a
 *     fresh "Tween" block never fights an older one over the same value.
 *   - `relative: true` means the To value is ADDED to the value the property
 *     had when the tween started ("jump up 100" = to 100, relative).
 *   - repeat 'once' parks the property on the final value and records a
 *     finished entry; the Tween Finished condition fires while it is there
 *     (same semantics as Animation Finished). 'loop' restarts forever.
 *     'pingpong' bounces from <-> to forever.
 *   - Corrupt/hand-edited specs are repaired (bad property -> no-op, bad
 *     duration -> 0.6s, bad easing -> easeOut), never a crash.
 *
 * Load order (index.html): hydra-tween.js BEFORE player-runtime.js and
 * script.js. player-runtime.js throws a clear error if HydraTween is missing.
 * ========================================================================== */

function hydraTweenFactory() {
  'use strict';

  var MS_PER_60FPS_FRAME = 1000 / 60;
  var DEFAULT_DURATION_S = 0.6;

  var PROPERTIES = [
    { id: 'posX',     label: 'X position' },
    { id: 'posY',     label: 'Y position' },
    { id: 'width',    label: 'Width' },
    { id: 'height',   label: 'Height' },
    { id: 'rotation', label: 'Rotation (degrees)' },
    { id: 'opacity',  label: 'Opacity (0-1)' }
  ];

  var EASINGS = [
    { id: 'linear',      label: 'Linear (steady)' },
    { id: 'easeIn',      label: 'Ease in (slow start)' },
    { id: 'easeOut',     label: 'Ease out (slow end)' },
    { id: 'easeInOut',   label: 'Ease in-out (smooth)' },
    { id: 'easeOutBack', label: 'Pop (overshoots)' },
    { id: 'easeOutBounce', label: 'Bounce (like a ball)' }
  ];

  var REPEATS = [
    { id: 'once',     label: 'Once' },
    { id: 'loop',     label: 'Loop' },
    { id: 'pingpong', label: 'Ping-pong' }
  ];

  var nextTweenId = 1;

  function isValidProperty(p) {
    for (var i = 0; i < PROPERTIES.length; i++) {
      if (PROPERTIES[i].id === p) return true;
    }
    return false;
  }

  function isValidEasing(e) {
    for (var i = 0; i < EASINGS.length; i++) {
      if (EASINGS[i].id === e) return true;
    }
    return false;
  }

  function isValidRepeat(r) {
    for (var i = 0; i < REPEATS.length; i++) {
      if (REPEATS[i].id === r) return true;
    }
    return false;
  }

  // Canonical property access: one read/write path so the editor preview
  // and the exported runtime apply tweens identically.
  function readProperty(obj, property) {
    if (!obj) return 0;
    if (property === 'opacity') return typeof obj.opacity === 'number' ? obj.opacity : 1;
    var v = obj[property];
    return typeof v === 'number' && isFinite(v) ? v : 0;
  }

  function writeProperty(obj, property, value) {
    if (!obj || !isFinite(value)) return;
    if (property === 'opacity') obj.opacity = Math.max(0, Math.min(1, value));
    else obj[property] = value;
  }

  // The easing curve: t in [0,1] -> progress in [0,1].
  function ease(easingId, t) {
    t = Math.max(0, Math.min(1, t));
    switch (easingId) {
      case 'linear': return t;
      case 'easeIn': return t * t;
      case 'easeOut': return 1 - (1 - t) * (1 - t);
      case 'easeInOut': return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      case 'easeOutBack': {
        var c1 = 1.70158, c3 = c1 + 1;
        return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
      }
      case 'easeOutBounce': {
        var n1 = 7.5625, d1 = 2.75;
        if (t < 1 / d1) return n1 * t * t;
        if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
        if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
        return n1 * (t -= 2.625 / d1) * t + 0.984375;
      }
      default: return 1 - (1 - t) * (1 - t); // easeOut fallback
    }
  }

  function getTweens(obj) {
    if (!obj) return [];
    if (!Array.isArray(obj._tweens)) obj._tweens = [];
    return obj._tweens;
  }

  function getFinished(obj) {
    if (!obj) return [];
    if (!Array.isArray(obj._tweenFinished)) obj._tweenFinished = [];
    return obj._tweenFinished;
  }

  // Repair a block spec in place; returns true when the tween is runnable.
  // A bad property makes the whole tween a no-op (reported by the caller's
  // unknown-block diagnostics when the type itself is unknown).
  function normalizeSpec(spec) {
    if (!spec || typeof spec !== 'object') return false;
    if (!isValidProperty(spec.property)) return false;
    if (!isValidEasing(spec.easing)) spec.easing = 'easeOut';
    if (!isValidRepeat(spec.repeat)) spec.repeat = 'once';
    var d = Number(spec.duration);
    spec.duration = (isFinite(d) && d >= 0) ? d : DEFAULT_DURATION_S;
    return true;
  }

  // Start a tween on the object. spec: { property, to (number), relative,
  // duration (seconds), easing, repeat }. Returns the tween, or null when
  // the spec is unusable (the caller leaves everything untouched).
  function start(state, obj, spec) {
    if (!obj || !spec || typeof spec.to !== 'number' || !isFinite(spec.to)) return null;
    if (!normalizeSpec(spec)) return null;
    var list = getTweens(obj);
    // A fresh tween on a property replaces the running one: no two tweens
    // ever fight over the same value.
    for (var i = list.length - 1; i >= 0; i--) {
      if (list[i].property === spec.property) list.splice(i, 1);
    }
    // Clear any finished record for this property: a new run re-arms the
    // Tween Finished condition.
    var fin = getFinished(obj);
    for (var j = fin.length - 1; j >= 0; j--) {
      if (fin[j].property === spec.property) fin.splice(j, 1);
    }
    var from = readProperty(obj, spec.property);
    var to = spec.relative ? from + spec.to : spec.to;
    var tween = {
      id: nextTweenId++,
      property: spec.property,
      from: from,
      to: to,
      durationMs: spec.duration * 1000,
      elapsedMs: 0,
      easing: spec.easing,
      repeat: spec.repeat
    };
    list.push(tween);
    return tween;
  }

  // Stop tweens. property blank/omitted stops ALL tweens on the object and
  // clears finished records (mirrors HydraAnim.stop clearing finished).
  function stop(state, obj, property) {
    if (!obj) return;
    var list = getTweens(obj);
    var fin = getFinished(obj);
    if (property && isValidProperty(property)) {
      for (var i = list.length - 1; i >= 0; i--) {
        if (list[i].property === property) list.splice(i, 1);
      }
      for (var j = fin.length - 1; j >= 0; j--) {
        if (fin[j].property === property) fin.splice(j, 1);
      }
    } else {
      list.length = 0;
      fin.length = 0;
    }
  }

  // Advance every tween on the object by dtFrames (in 60fps-frame units,
  // the unit both runtimes use). Mutates the object. Never throws on bad
  // data.
  function update(state, obj, dtFrames) {
    var list = getTweens(obj);
    if (list.length === 0) return;
    var dt = Number(dtFrames);
    if (!isFinite(dt) || dt <= 0) dt = 1;
    var dtMs = dt * MS_PER_60FPS_FRAME;
    var fin = getFinished(obj);
    for (var i = list.length - 1; i >= 0; i--) {
      var tw = list[i];
      tw.elapsedMs += dtMs;
      var t = tw.durationMs <= 0 ? 1 : Math.min(1, tw.elapsedMs / tw.durationMs);
      writeProperty(obj, tw.property, tw.from + (tw.to - tw.from) * ease(tw.easing, t));
      if (t >= 1) {
        if (tw.repeat === 'loop') {
          tw.elapsedMs = 0;
          writeProperty(obj, tw.property, tw.from);
        } else if (tw.repeat === 'pingpong') {
          tw.elapsedMs = 0;
          var swap = tw.from; tw.from = tw.to; tw.to = swap;
        } else {
          // once: park on the final value; the finished record stays until
          // start() or stop() runs again (drives Tween Finished).
          writeProperty(obj, tw.property, tw.to);
          fin.push({ id: tw.id, property: tw.property });
          list.splice(i, 1);
        }
      }
    }
  }

  // True when a once-tween completed and its finished record is still armed.
  // property blank/omitted matches any property.
  function isFinished(state, obj, property) {
    var fin = getFinished(obj);
    if (fin.length === 0) return false;
    if (!property) return true;
    for (var i = 0; i < fin.length; i++) {
      if (fin[i].property === property) return true;
    }
    return false;
  }

  function activeCount(state, obj) {
    return getTweens(obj).length;
  }

  return {
    PROPERTIES: PROPERTIES,
    EASINGS: EASINGS,
    REPEATS: REPEATS,
    DEFAULT_DURATION_S: DEFAULT_DURATION_S,
    isValidProperty: isValidProperty,
    isValidEasing: isValidEasing,
    isValidRepeat: isValidRepeat,
    readProperty: readProperty,
    writeProperty: writeProperty,
    ease: ease,
    normalizeSpec: normalizeSpec,
    start: start,
    stop: stop,
    update: update,
    isFinished: isFinished,
    activeCount: activeCount
  };
}

window.HydraTween = hydraTweenFactory();
// Self-contained source of the factory, inlined into exported playable games
// by HydraPlayer.buildPlayableHtml so exports run without editor files.
window.HydraTween.factorySource = hydraTweenFactory.toString();
