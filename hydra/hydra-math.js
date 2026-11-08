/* ============================================================================
 * hydra-math.js — HydraScript shared math/random blocks.
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation of
 * the math/random block semantics used by:
 *   - the editor preview runtime (script.js delegates to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Blocks (all in the Variables palette category):
 *   - Random Integer (action): uniform whole number between Min and Max,
 *     inclusive on both ends.
 *   - Clamp Number (action): forces the named variable into [Minimum,
 *     Maximum], writing the result back into the same variable.
 *   - Round Number (action): rounds the named variable (whole / down / up /
 *     1 decimal / 2 decimals), writing the result back.
 *   - Random Pick (action): copies a uniformly random item from a list
 *     variable into another variable (0 when the list is empty/missing).
 *   - Number In Range (condition): true while an expression sits between
 *     Minimum and Maximum, inclusive; a state read, so it defaults to the
 *     'level' trigger mode and evaluates while paused.
 *
 * Conventions (kept identical in preview and exports):
 *   - Nothing here ever throws; hostile input produces a safe fallback and
 *     a warning through hooks.warn (the runtimes dedupe repeat warnings).
 *   - Blank variable/list names warn instead of silently misbehaving.
 *   - Bad expressions (non-numeric results) warn and skip the action; the
 *     condition stays quiet. Expression warnings themselves surface through
 *     hooks.num, like every other block.
 *   - Min/Max are swapped automatically when Min > Max — no silent
 *     empty-range trap.
 *   - Non-numeric variable contents are treated as 0.
 *
 * Load order (index.html): hydra-math.js BEFORE player-runtime.js and
 * script.js. player-runtime.js throws a clear error if HydraMath is missing.
 * ========================================================================== */

function hydraMathFactory() {
  'use strict';

  var ACTION_TYPES = ['randomInteger', 'clampNumber', 'roundNumber', 'randomPick'];
  var CONDITION_TYPES = ['numberInRange'];

  function isMathAction(t) { return ACTION_TYPES.indexOf(t) >= 0; }
  function isMathCondition(t) { return CONDITION_TYPES.indexOf(t) >= 0; }

  // Finite-number read of an expression result: returns { ok, value }.
  function numOf(hooks, raw) {
    var info = hooks.num(raw);
    if (info && info.ok && Number.isFinite(info.value)) {
      return { ok: true, value: info.value };
    }
    return { ok: false, value: 0 };
  }

  function nameOf(data, key) {
    return String(data[key] || '').trim();
  }

  function varValueOf(hooks, name) {
    var v = hooks.lookupVar(name);
    var n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  // Uniform integer in [min, max], inclusive on both ends. Fractional bounds
  // shrink to the nearest whole range; reversed bounds are swapped.
  function randomInteger(min, max) {
    var lo = Math.ceil(min), hi = Math.floor(max);
    if (lo > hi) { var t = lo; lo = hi; hi = t; }
    return Math.floor(Math.random() * (hi - lo + 1)) + lo;
  }

  function clampNumber(value, min, max) {
    var lo = min, hi = max;
    if (lo > hi) { var t = lo; lo = hi; hi = t; }
    if (value < lo) return lo;
    if (value > hi) return hi;
    return value;
  }

  // mode: 'nearest' (default), 'down', 'up', 'dec1', 'dec2'. Unknown modes
  // behave as 'nearest' — never throw.
  function roundValue(value, mode) {
    if (mode === 'down') return Math.floor(value);
    if (mode === 'up') return Math.ceil(value);
    if (mode === 'dec1') return Math.round(value * 10) / 10;
    if (mode === 'dec2') return Math.round(value * 100) / 100;
    return Math.round(value);
  }

  function inRange(value, min, max) {
    var lo = min, hi = max;
    if (lo > hi) { var t = lo; lo = hi; hi = t; }
    return value >= lo && value <= hi;
  }

  // ---------- action dispatch ----------

  function applyMathAction(vars, data, hooks) {
    if (!vars || typeof vars !== 'object') {
      hooks.warn('Math block: the variable store is unavailable; nothing happened.');
      return;
    }
    switch (data.type) {
      case 'randomInteger': {
        var riName = nameOf(data, 'varName');
        if (!riName) {
          hooks.warn('Random Integer: the variable name is blank; nothing happened.');
          return;
        }
        var riMin = numOf(hooks, data.min), riMax = numOf(hooks, data.max);
        if (!riMin.ok || !riMax.ok) {
          hooks.warn('Random Integer: Min/Max did not evaluate to numbers; nothing happened.');
          return;
        }
        vars[riName] = randomInteger(riMin.value, riMax.value);
        return;
      }
      case 'clampNumber': {
        var clName = nameOf(data, 'varName');
        if (!clName) {
          hooks.warn('Clamp Number: the variable name is blank; nothing happened.');
          return;
        }
        var clMin = numOf(hooks, data.min), clMax = numOf(hooks, data.max);
        if (!clMin.ok || !clMax.ok) {
          hooks.warn('Clamp Number: Minimum/Maximum did not evaluate to numbers; nothing happened.');
          return;
        }
        vars[clName] = clampNumber(varValueOf(hooks, clName), clMin.value, clMax.value);
        return;
      }
      case 'roundNumber': {
        var roName = nameOf(data, 'varName');
        if (!roName) {
          hooks.warn('Round Number: the variable name is blank; nothing happened.');
          return;
        }
        vars[roName] = roundValue(varValueOf(hooks, roName), data.mode);
        return;
      }
      case 'randomPick': {
        var rpFrom = nameOf(data, 'varName');
        var rpInto = nameOf(data, 'storeVarName');
        if (!rpFrom) {
          hooks.warn('Random Pick: the list name is blank; nothing happened.');
          return;
        }
        if (!rpInto) {
          hooks.warn('Random Pick: the "Into variable" name is blank; nothing happened.');
          return;
        }
        var list = hooks.lookupVar(rpFrom);
        // Empty or missing lists write 0 — the same read convention as
        // Get Array Item (out-of-range reads give 0).
        if (!Array.isArray(list) || list.length === 0) { vars[rpInto] = 0; return; }
        vars[rpInto] = list[Math.floor(Math.random() * list.length)];
        return;
      }
      default:
        return;
    }
  }

  // ---------- condition dispatch (read-only; never creates variables) ----------

  function evalMathCondition(data, hooks) {
    var ctx = { value: 0 };
    if (!data || typeof data !== 'object' || data.type !== 'numberInRange') {
      return { pass: false, context: ctx };
    }
    var v = numOf(hooks, data.value);
    var lo = numOf(hooks, data.min);
    var hi = numOf(hooks, data.max);
    if (!v.ok || !lo.ok || !hi.ok) return { pass: false, context: ctx };
    return { pass: inRange(v.value, lo.value, hi.value), context: { value: v.value } };
  }

  return {
    ACTION_TYPES: ACTION_TYPES,
    CONDITION_TYPES: CONDITION_TYPES,
    isMathAction: isMathAction,
    isMathCondition: isMathCondition,
    randomInteger: randomInteger,
    clampNumber: clampNumber,
    roundValue: roundValue,
    inRange: inRange,
    applyMathAction: applyMathAction,
    evalMathCondition: evalMathCondition
  };
}

window.HydraMath = hydraMathFactory();
// Self-contained source of the factory, inlined into exported playable games
// by HydraPlayer.buildPlayableHtml so exports run without editor files.
window.HydraMath.factorySource = hydraMathFactory.toString();
