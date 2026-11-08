/* ============================================================================
 * hydra-expr.js — HydraScript shared expression evaluator.
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation of
 * expression evaluation used by:
 *   - the editor preview runtime (script.js delegates to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Supported: numbers, game variables, object.prop references, builtins
 * (mouseX, cameraX, dt, ...), and full Math.* expressions such as
 * "Math.floor(score / 10)" or "Math.floor(Math.random() * 690) + 40".
 *
 * Load order (index.html): hydra-expr.js BEFORE player-runtime.js and
 * script.js. player-runtime.js throws a clear error if HydraExpr is missing.
 * ========================================================================== */

function hydraExprFactory() {
  'use strict';

  var PROP_ACCESS_RE = /\b([A-Za-z_]\w*)\.(\w+)\b/g;
  var STRING_RE = /"[^"]*"|'[^']*'/g;
  var IDENT_RE = /\b[A-Za-z_]\w*\b/g;

  // Identifiers that are always legal in an expression without being
  // game variables or builtins. Math.* is resolved by the real Math object
  // at eval time (see resolvePropAccess).
  var RESERVED = {
    Math: true,
    'true': true, 'false': true, 'null': true, 'undefined': true,
    NaN: true, Infinity: true,
    floor: true, ceil: true, round: true, abs: true, sqrt: true,
    max: true, min: true, random: true, sin: true, cos: true, tan: true,
    'if': true, 'else': true, 'return': true
  };

  // Replace `name.prop` tokens with live values from lookupObject(name).
  // `Math.*` is passed through untouched so the real Math object handles it.
  // Unknown objects / missing props resolve to 0 (never throw).
  function resolvePropAccess(exprText, lookupObject) {
    return String(exprText).replace(PROP_ACCESS_RE, function (match, objName, prop) {
      if (objName === 'Math') return match;
      var obj = null;
      try { obj = lookupObject(objName); } catch (err) { obj = null; }
      return (obj && prop in obj) ? String(obj[prop] == null ? 0 : obj[prop]) : '0';
    });
  }

  // Identifiers that are neither in scope nor reserved: the caller should
  // warn and treat the expression as not-yet-evaluable.
  function unknownIdentifiers(exprText, scope) {
    var stripped = String(exprText).replace(PROP_ACCESS_RE, '').replace(STRING_RE, '');
    var ids = stripped.match(IDENT_RE) || [];
    var seen = {};
    var out = [];
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      if (seen[id] || (id in scope) || RESERVED[id]) continue;
      seen[id] = true;
      out.push(id);
    }
    return out;
  }

  // Evaluate an expression string.
  // opts: {
  //   lookupObject(name) -> object|null,
  //   builtins: {name: value},
  //   variables: {name: value},
  //   onWarning(message) -> void
  // }
  // Returns { value: number, ok: boolean, unknowns: string[] }.
  // ok === false means "could not evaluate yet" — callers should skip the
  // action rather than apply a wrong value.
  function evaluate(exprStr, opts) {
    opts = opts || {};
    if (exprStr === null || exprStr === undefined) return { value: 0, ok: true, unknowns: [] };
    if (typeof exprStr === 'number') {
      var numOk = isFinite(exprStr);
      return { value: numOk ? exprStr : 0, ok: numOk, unknowns: [] };
    }
    var s = String(exprStr).trim();
    if (s === '') return { value: 0, ok: true, unknowns: [] };
    var n = Number(s);
    if (!isNaN(n)) return { value: n, ok: true, unknowns: [] };

    var scope = {};
    var key;
    if (opts.builtins) for (key in opts.builtins) scope[key] = opts.builtins[key];
    if (opts.variables) for (key in opts.variables) scope[key] = opts.variables[key];

    var unknowns = unknownIdentifiers(s, scope);
    if (unknowns.length) {
      warn(opts, 'Unknown expression name ' + unknowns.join(', ') + ' in "' + s + '". The action will wait until it exists.');
      return { value: 0, ok: false, unknowns: unknowns };
    }

    try {
      var resolved = resolvePropAccess(s, opts.lookupObject || function () { return null; });
      var keys = Object.keys(scope);
      var vals = keys.map(function (k) { return scope[k]; });
      // eslint-disable-next-line no-new-func
      var result = new Function(...keys, '"use strict"; return (' + resolved + ');')(...vals);
      var ok = typeof result === 'number' && isFinite(result);
      return { value: ok ? result : 0, ok: ok, unknowns: [] };
    } catch (err) {
      warn(opts, 'Could not evaluate expression "' + s + '": ' + (err && err.message ? err.message : err));
      return { value: 0, ok: false, unknowns: [] };
    }
  }

  // Check only whether an expression *parses* — no unknown-identifier
  // warnings, no evaluation. A bare variable name is valid syntax even
  // when the variable does not exist yet (variables are created at
  // runtime by Set Variable), so static block validation uses this
  // instead of evaluate(): "score +" and "Math.floor(" are broken,
  // "score + 1" and "player.x" are fine. Compiles but never runs the
  // code, so a hostile string cannot do anything here.
  // Returns { ok: boolean, error: string|null }.
  function validateSyntax(exprStr) {
    if (exprStr === null || exprStr === undefined) return { ok: true, error: null };
    if (typeof exprStr === 'number') return { ok: isFinite(exprStr), error: isFinite(exprStr) ? null : 'not a finite number' };
    var s = String(exprStr).trim();
    if (s === '') return { ok: true, error: null };
    if (!isNaN(Number(s))) return { ok: true, error: null };
    try {
      // eslint-disable-next-line no-new-func
      new Function('"use strict"; return (' + s + ');');
      return { ok: true, error: null };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  }

  function warn(opts, message) {
    if (opts && typeof opts.onWarning === 'function') {
      try { opts.onWarning(message); } catch (err) { /* warning delivery must never break evaluation */ }
    }
  }

  return {
    evaluate: evaluate,
    validateSyntax: validateSyntax,
    resolvePropAccess: resolvePropAccess,
    unknownIdentifiers: unknownIdentifiers
  };
}

window.HydraExpr = hydraExprFactory();
// Self-contained source of the factory, inlined into exported playable games
// by HydraPlayer.buildPlayableHtml so exports run without editor files.
window.HydraExpr.factorySource = hydraExprFactory.toString();
