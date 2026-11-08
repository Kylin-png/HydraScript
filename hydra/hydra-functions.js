/* ============================================================================
 * hydra-functions.js — HydraScript shared custom functions (P5 core-engine
 * track, item P5-3: Functions / custom blocks, slice a — the runtime core).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation
 * of user-defined functions — used by:
 *   - the editor preview runtime (hydra-previewruntime.js delegates
 *     to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Idea (Godot / Unity / Unreal functions, beginner edition): until now
 * every block row lived in the global grid or one scene's grid, so a
 * useful chain (add two numbers, flash a coin and count it) had to be
 * copied into every place it was needed, and a fix meant fixing every
 * copy. A function is a named, reusable block chain with its own grid:
 *
 *   - define it once in the Functions manager (a name, up to eight
 *     parameters, and a body grid like any other scope), then call it
 *     from any row with the Call Function block;
 *   - calling a function runs its body grid once, the way one frame
 *     runs a scope's grid: every condition in the body evaluates, and
 *     the actions its true conditions reach run in flow order;
 *   - the parameters arrive as local variables (the 'local' scope of
 *     the scoped-variables system): a Set Scoped Variable block with
 *     scope Local writes this call's copy, so two calls running at
 *     once (a function calling itself, or calling another function)
 *     never see each other's locals — each call frame owns its own
 *     locals map, bound into the run state for the call and restored
 *     after;
 *   - the Return block sets the call's return value and stops the rest
 *     of the body; Call Function copies it into a flat variable (or
 *     discards it when Into variable is blank). A function with no
 *     Return returns 0, the way a missing variable reads as 0.
 *
 * A function definition is project data (project.functions), one record
 * per function: { id, name, params, grid }. The id is the stable key
 * (the body grid lives under the scope key 'function:<id>'); the name
 * is what Call Function picks (names are unique — the first definition
 * wins a duplicate). The body grid is an ordinary grid object
 * (cell index -> block record), the same shape as a scene's gridData,
 * so the shared dispatch runs it unchanged. duplicateFunction copies
 * one definition — same parameters, a deep copy of the body, a fresh
 * id, a non-colliding 'copy' name — so a variant starts from a
 * working body instead of an empty grid; normalizeParamsReport is
 * normalizeParams with a list of the names it dropped, so the panel
 * can say so instead of trimming silently.
 *
 * The call stack is transient run state, minted fresh on a fresh run:
 * { frames: [] }, one frame per live call. The recursion guard caps
 * the stack at 32 frames — a function calling itself (directly, or
 * through another function) stops at 32 deep instead of hanging the
 * game, and the capped call warns once (the runtimes dedupe the
 * warning) and returns 0. Calls are synchronous: a call runs its
 * whole body inside the frame that called it, so the stack is always
 * empty between frames and a scene switch can never strand a frame.
 *
 * Nothing ever throws; hostile input degrades to safe defaults.
 *
 * Honest limits: a function takes at most eight parameters (the Call
 * Function block shows one argument field per parameter, labeled with
 * the parameter name — slice b's dynamic argument editor); there is no Return-type
 * checking (a function returns whatever its Return block passes, or 0
 * with no Return); a function's body never runs on its own — only a
 * Call Function block runs it, never the per-frame script pass; edge
 * conditions inside a body remember their last state across calls
 * (the edge memory is keyed by the function's scope, like a scene's);
 * a gameStart condition in a body fires on the function's first call
 * of the run; the function's locals are not in save slots yet (read
 * them into flat variables first, the way scoped variables work).
 *
 * Load order (index.html): hydra-functions.js BEFORE player-runtime.js
 * and script.js. player-runtime.js throws a clear error if
 * HydraFunctions is missing.
 * ========================================================================== */

function hydraFunctionsFactory() {
  'use strict';

  var MAX_DEPTH = 32;
  var MAX_PARAMS = 8;
  var FUNCTION_SCOPE_PREFIX = 'function:';
  var ID_PATTERN = /^[A-Za-z0-9_-]+$/;

  // --- Ids, names, params ---------------------------------------------------

  // A usable function id, or null for anything unusable. An id is a
  // short token with no ':' in it (the scope key is 'function:' + id,
  // so a ':' would break scope parsing) and no whitespace.
  function normalizeFunctionId(id) {
    if (typeof id !== 'string') return null;
    var s = id.trim();
    return (s !== '' && ID_PATTERN.test(s)) ? s : null;
  }

  // A fresh id for a function the editor just created. The 'fn_'
  // prefix keeps hand-authored ids (any token) apart from minted ones.
  function mintFunctionId() {
    return 'fn_' + Math.random().toString(36).slice(2, 10);
  }

  // The function name, trimmed, or null for a blank / non-string
  // name. Names are case-sensitive and kept exactly as typed, the
  // way variable names are.
  function normalizeFunctionName(name) {
    if (typeof name !== 'string') return null;
    var n = name.trim();
    return n === '' ? null : n;
  }

  // The parameter list: up to eight unique trimmed names, in order.
  // A non-array reads as no parameters; blanks, non-strings, and
  // repeats are dropped, and anything past the eighth is dropped.
  // Returns the input array itself when it is already clean, so the
  // identity-preserving normalize below can keep the caller's list.
  // (normalizeParamsReport below is the reporting twin: the panel
  // uses it to say WHICH names were dropped, and a unit test pins
  // the two to agree on the kept list for the same input.)
  function normalizeParams(params) {
    if (!Array.isArray(params)) return [];
    var seen = {};
    var out = [];
    var clean = true;
    params.forEach(function (p) {
      if (typeof p !== 'string') { clean = false; return; }
      var n = p.trim();
      if (n === '' || seen[n]) { clean = false; return; }
      seen[n] = true;
      if (out.length >= MAX_PARAMS) { clean = false; return; }
      out.push(n);
    });
    if (clean && out.length === params.length) return params;
    return out;
  }

  // The same parameter normalization, but reporting what it dropped:
  // { params, droppedDuplicates, droppedOverflow }. Blanks and
  // non-strings still drop silently (they were never names); a
  // repeated name lands in droppedDuplicates, a ninth-or-later name
  // in droppedOverflow. The panel (slice c) turns the report into
  // one plain line — 'Kept a, b — dropped duplicate "a".' — so a
  // typed list is never trimmed without the user being told.
  function normalizeParamsReport(params) {
    var report = { params: [], droppedDuplicates: [], droppedOverflow: [] };
    if (!Array.isArray(params)) return report;
    var seen = {};
    params.forEach(function (p) {
      if (typeof p !== 'string') return;
      var n = p.trim();
      if (n === '') return;
      if (seen[n]) { report.droppedDuplicates.push(n); return; }
      seen[n] = true;
      if (report.params.length >= MAX_PARAMS) { report.droppedOverflow.push(n); return; }
      report.params.push(n);
    });
    return report;
  }

  // The body grid: a plain object (cell index -> block record), or
  // {} for anything else. The grid is kept by reference — a body
  // grid is big, and the editor holds the live object (the scope
  // tabs write straight into it), so copying it here would orphan
  // edits the way the old variables normalizer once did.
  function normalizeGrid(grid) {
    if (!grid || typeof grid !== 'object' || Array.isArray(grid)) return {};
    return grid;
  }

  // --- Definitions ----------------------------------------------------------

  // The definition, normalized, or null for anything unusable (a
  // blank name, a non-object). A missing id is minted, so a
  // hand-authored definition without one still gets a scope key.
  // Returns the input object itself when it is already canonical, so
  // the identity-preserving list normalize below can keep the
  // caller's records (the editor's Functions panel closes over them,
  // and the autosave's normalizeProject reassigns them).
  function normalizeFunction(def) {
    if (!def || typeof def !== 'object') return null;
    var name = normalizeFunctionName(def.name);
    if (name === null) return null;
    var id = normalizeFunctionId(def.id);
    if (id === null) id = mintFunctionId();
    var params = normalizeParams(def.params);
    var grid = normalizeGrid(def.grid);
    if (def.id === id && def.name === name && def.params === params && def.grid === grid) return def;
    return { id: id, name: name, params: params, grid: grid };
  }

  // The definition list, normalized and deduplicated (first entry
  // wins, by id and by name — two functions cannot share a scope key
  // or a call name). A non-array reads as no functions.
  // Identity-preserving: when the input is already clean, the SAME
  // array comes back with the SAME definition objects.
  function normalizeFunctions(list) {
    if (!Array.isArray(list)) return [];
    var seenIds = {};
    var seenNames = {};
    var out = [];
    var changed = false;
    list.forEach(function (d) {
      var n = normalizeFunction(d);
      if (!n) { changed = true; return; }
      if (seenIds[n.id] || seenNames[n.name]) { changed = true; return; }
      seenIds[n.id] = true;
      seenNames[n.name] = true;
      if (n !== d) changed = true;
      out.push(n);
    });
    if (!changed && out.length === list.length) return list;
    return out;
  }

  // A copy of the definition (slice c): the same parameters and a
  // deep copy of the body grid, a fresh id, and a name that does not
  // collide with any definition in `defs` ('add copy', then
  // 'add copy 2', 'add copy 3', ...). Returns null for an unusable
  // source. The copy is NOT added to `defs` — the caller pushes it —
  // so the name check reads the list as it stands. Editing the
  // copy's body never touches the original: the grid is copied
  // through JSON, the way the codebase deep-copies grids elsewhere.
  function duplicateFunction(defs, def) {
    var src = normalizeFunction(def);
    if (!src) return null;
    var grid = {};
    try { grid = JSON.parse(JSON.stringify(src.grid || {})); } catch (e) { grid = {}; }
    if (!grid || typeof grid !== 'object' || Array.isArray(grid)) grid = {};
    var base = src.name + ' copy';
    var name = base;
    var n = 2;
    var list = normalizeFunctions(defs);
    while (findFunction(list, name)) { name = base + ' ' + n; n++; }
    return { id: mintFunctionId(), name: name, params: src.params.slice(), grid: grid };
  }

  // The function with the name (exact, trimmed), or null. Calls
  // resolve by name, so the name is the lookup key.
  function findFunction(defs, name) {
    var n = normalizeFunctionName(name);
    if (n === null) return null;
    var list = normalizeFunctions(defs);
    for (var i = 0; i < list.length; i++) {
      if (list[i].name === n) return list[i];
    }
    return null;
  }

  // The function with the id, or null. Body grids resolve by id.
  function findFunctionById(defs, id) {
    var clean = normalizeFunctionId(id);
    if (clean === null) return null;
    var list = normalizeFunctions(defs);
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === clean) return list[i];
    }
    return null;
  }

  // --- Scope keys -----------------------------------------------------------

  // The scope key for a function id ('function:<id>'), or null for
  // an unusable id. Body grids live under this key, so the dispatch
  // and the edge memory treat a function like any other scope.
  function scopeKeyFor(id) {
    var clean = normalizeFunctionId(id);
    return clean === null ? null : FUNCTION_SCOPE_PREFIX + clean;
  }

  // The function id for a scope key, or null when the scope is not a
  // function scope. A scope key with a bad id reads as no function.
  function functionIdOfScope(scope) {
    if (typeof scope !== 'string') return null;
    if (scope.indexOf(FUNCTION_SCOPE_PREFIX) !== 0) return null;
    return normalizeFunctionId(scope.slice(FUNCTION_SCOPE_PREFIX.length));
  }

  // --- Call stack -----------------------------------------------------------
  // One frame per live call: { fnId, name, locals, returnValue,
  // returned }. locals is the call's own locals map (name -> typed
  // entry, the shape the scoped-variables module stores) — the host
  // binds it into the run state as the 'local' scope for the call
  // and seeds the parameters into it, so a Set Scoped Variable with
  // scope Local writes this call's copy and nothing else.

  function createCallState() {
    return { frames: [] };
  }

  function stateOf(state) {
    return (state && typeof state === 'object' && Array.isArray(state.frames)) ? state : null;
  }

  // How many calls are live right now (0 outside a function).
  function callDepth(state) {
    var st = stateOf(state);
    return st ? st.frames.length : 0;
  }

  // The innermost live frame, or null outside a function.
  function currentFrame(state) {
    var st = stateOf(state);
    if (!st || st.frames.length === 0) return null;
    return st.frames[st.frames.length - 1];
  }

  // Push a frame for the function, or null when the stack is at the
  // recursion cap (the caller warns and returns 0 instead of
  // running the body). A missing function never pushes.
  function call(state, fn) {
    var st = stateOf(state);
    if (!st) return null;
    var n = normalizeFunction(fn);
    if (!n) return null;
    if (st.frames.length >= MAX_DEPTH) return null;
    var frame = {
      fnId: n.id,
      name: n.name,
      locals: {},
      returnValue: undefined,
      returned: false
    };
    st.frames.push(frame);
    return frame;
  }

  // Set the innermost call's return value and mark it returned, so
  // the host stops running the rest of the body. Returns false with
  // no live call (a Return block outside a function).
  function returnFrom(state, value) {
    var frame = currentFrame(state);
    if (!frame) return false;
    frame.returnValue = value;
    frame.returned = true;
    return true;
  }

  // Pop the innermost frame and hand it back (the host reads its
  // returnValue), or null with no live call.
  function endCall(state) {
    var st = stateOf(state);
    if (!st || st.frames.length === 0) return null;
    return st.frames.pop();
  }

  // --- Routing ----------------------------------------------------------------

  function isFunctionAction(type) {
    return type === 'callFunction' || type === 'returnFromFunction';
  }

  return {
    MAX_DEPTH: MAX_DEPTH,
    MAX_PARAMS: MAX_PARAMS,
    FUNCTION_SCOPE_PREFIX: FUNCTION_SCOPE_PREFIX,
    normalizeFunctionId: normalizeFunctionId,
    mintFunctionId: mintFunctionId,
    normalizeFunctionName: normalizeFunctionName,
    normalizeParams: normalizeParams,
    normalizeParamsReport: normalizeParamsReport,
    normalizeGrid: normalizeGrid,
    normalizeFunction: normalizeFunction,
    normalizeFunctions: normalizeFunctions,
    duplicateFunction: duplicateFunction,
    findFunction: findFunction,
    findFunctionById: findFunctionById,
    scopeKeyFor: scopeKeyFor,
    functionIdOfScope: functionIdOfScope,
    createCallState: createCallState,
    callDepth: callDepth,
    currentFrame: currentFrame,
    call: call,
    returnFrom: returnFrom,
    endCall: endCall,
    isFunctionAction: isFunctionAction
  };
}

if (typeof window !== 'undefined') {
  window.HydraFunctions = hydraFunctionsFactory();
  // Self-contained source of the factory, inlined into exported playable games
  // by HydraPlayer.buildPlayableHtml so exports run without editor files.
  window.HydraFunctions.factorySource = hydraFunctionsFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraFunctionsFactory;
