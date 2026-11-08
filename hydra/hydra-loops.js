/* ============================================================================
 * hydra-loops.js — HydraScript shared loop state machine (P5 core-engine
 * track, item P5-4: Control flow + events, slices a–b — Repeat, While,
 * Break, Continue, For Each Item, For Each Object — and item P5-6,
 * slice c: For Each Field, the iteration over structure fields).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation
 * of loop bookkeeping — used by:
 *   - the editor preview runtime (hydra-previewruntime.js delegates
 *     to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Idea (the for/while loops of real engines, beginner edition): a loop
 * block sits at the head of a row and the actions to its right on the
 * same row are its body. When the loop block runs, it runs that body
 * chain itself — Repeat runs it a set number of times, While runs it
 * until its test stops being true, For Each Item runs it once per item
 * of a list, For Each Object runs it once per live object with a name,
 * For Each Tagged Object runs it once per live object carrying a tag,
 * For Each Field runs it once per field of a structure, handing the
 * body the key and the value each round — and Break / Continue steer
 * the innermost loop from inside the body. The body is the rightward
 * same-row run the flow module already computes (flowEdges), so a loop
 * body is an ordinary chain the user could have written by hand, and
 * the loop block is the only new piece: the body actions stay plain
 * blocks, never hidden inside the loop.
 *
 * How it fits the flow: the shared dispatch routes a loop block
 * through the host's executeLoop hook instead of the ordinary action
 * path, and the flow module's propagate pulls the body actions out of
 * the outer propagation's queue first — the trigger condition's
 * rightward scan grabs the whole row, loop block and body alike, so
 * without that the body would run once more after the loop. The loop
 * handler (hydra-execute.js executeLoopAction) drives the iterations
 * and calls the runBody callback the flow module hands it, which runs
 * the body once through a fresh propagation, so nested loops and
 * chained actions work the same way they do outside a loop.
 *
 * Safety (loops run synchronously inside one frame, so a bad loop
 * could freeze the game):
 *   - Repeat clamps to 1,000 iterations; While stops after 1,000
 *     iterations with a warning when its test is still true.
 *   - For Each Item and For Each Object and For Each Tagged Object run
 *     at most the first 1,000 items / objects, with a warning when the
 *     list or the scene holds more; the list is snapshotted at the
 *     start, so a body that pushes or pops does not change the run.
 *     For Each Tagged Object snapshots the tagged objects the same
 *     way, so a body that adds or removes a tag cannot change the run.
 *   - For Each Field runs at most the first 1,000 fields of a
 *     structure, with the same warning; the keys and their values
 *     are snapshotted at the start, so a body that adds or removes
 *     a field does not change the run.
 *   - Loops nest at most 8 deep; a deeper loop is skipped with a
 *     warning.
 *   - A per-frame budget (10,000 body-action executions, reset by the
 *     host at the start of each frame's script phase) bounds nested
 *     loops: an outer Repeat of 1,000 around an inner Repeat of 1,000
 *     stops at the budget instead of running a million body actions.
 *   - Break / Continue outside a loop warn and do nothing; a Break
 *     sets the control flag the innermost loop's handler reads after
 *     each body run, and the flow module's shouldAbort hook stops the
 *     body propagation at once.
 *   - For Each Object hands each object to the body through the
 *     execution context (the same narrowing pick conditions use), so
 *     body actions that target the object's name hit that one object
 *     — never a reference value, which lands with P5-5. The context
 *     is restored after every body run, so the loop never leaks its
 *     last object into the chain after it. For Each Tagged Object
 *     narrows the same way, and it also hands the body the object
 *     itself in its Object variable when one is named, so the body
 *     can read it with Read Object Property even when the tagged
 *     objects have different names.
 *
 * The loop state is host-owned run state ({ depth, control, budget }),
 * minted fresh on a fresh run and reset per frame by the host. Loops
 * are synchronous inside one frame, so the depth is always 0 between
 * frames; the per-frame reset is a safety net, not the mechanism.
 *
 * Nothing ever throws; hostile input degrades to safe defaults.
 *
 * Honest limits: the loop body is the rightward same-row run after
 * the loop block — a condition, an empty cell, or the row end stops
 * it, and actions below the loop block are NOT the body (put the
 * trigger condition above the loop block, the body to its right).
 * Repeat counts from 1: its counter variable (when named) reads 1 on
 * the first time round, 2 on the second, up to the count. While has
 * no counter of its own — change a variable inside the body and test
 * that variable, the way real while loops work. A loop body runs
 * synchronously, so a While that waits on a key press or a timer
 * will never see it change mid-loop; test a variable the body itself
 * changes instead. For Each Item reads a flat list variable (the one
 * the array blocks build); a scoped-variable list does not reach it
 * yet — that is P5-6. A dict is not a list: For Each Item over a
 * dict warns and holds instead of walking its keys — walk a dict
 * with For Each Field, which hands the body the key and the value
 * each round. For Each Object hands the body the current object
 * only through action targeting — the body cannot read the object's
 * position or health into a variable yet; object references as
 * values are P5-5.
 *
 * Load order (index.html): hydra-loops.js BEFORE player-runtime.js
 * and script.js. player-runtime.js throws a clear error if
 * HydraLoops is missing.
 * ========================================================================== */

function hydraLoopsFactory() {
  'use strict';

  var MAX_REPEAT = 1000;
  var MAX_WHILE_ITERATIONS = 1000;
  var MAX_LOOP_DEPTH = 8;
  var MAX_LOOP_ACTIONS_PER_FRAME = 10000;
  var MAX_FOR_EACH_ITEMS = 1000;

  // --- Classification -------------------------------------------------------

  // Every loop block (Repeat, While, Break, Continue, For Each Item,
  // For Each Object, For Each Tagged Object, For Each Field) is an
  // action for the classifiers, so the flow reaches it like any other
  // action.
  function isLoopAction(type) {
    return type === 'repeatTimes' || type === 'whileLoop' ||
      type === 'breakLoop' || type === 'continueLoop' ||
      type === 'forEachList' || type === 'forEachObject' ||
      type === 'forEachTagged' || type === 'forEachField';
  }

  // Only Repeat, While, For Each Item, For Each Object, For Each
  // Tagged Object, and For Each Field run a body chain: Break and
  // Continue are plain actions that set the control flag from inside
  // a body.
  function isLoopBlock(type) {
    return type === 'repeatTimes' || type === 'whileLoop' ||
      type === 'forEachList' || type === 'forEachObject' ||
      type === 'forEachTagged' || type === 'forEachField';
  }

  // --- Comparison -----------------------------------------------------------
  // The comparison operators, identical to the conditions module's
  // compare. An unknown operator never matches — corrupt data stays
  // quiet instead of looping forever.

  function compare(left, op, right) {
    if (op === '>=') return left >= right;
    if (op === '<=') return left <= right;
    if (op === '==') return left == right;
    if (op === '!=') return left != right;
    if (op === '>') return left > right;
    if (op === '<') return left < right;
    return false;
  }

  // --- The count ------------------------------------------------------------
  // A Repeat count, normalized: a finite number, floored, clamped to
  // [0, MAX_REPEAT]. Returns { ok, count, clamped, original } — ok is
  // false for a non-finite value (the caller warns and holds), clamped
  // is true when the count was changed (the caller says so), and
  // original is the number as typed for the message.

  function normalizeCount(value) {
    var n = Number(value);
    if (!isFinite(n)) return { ok: false, count: 0, clamped: false, original: n };
    var c = Math.floor(n);
    var clamped = false;
    if (c > MAX_REPEAT) { c = MAX_REPEAT; clamped = true; }
    if (c < 0) { c = 0; clamped = true; }
    return { ok: true, count: c, clamped: clamped, original: n };
  }

  // --- The for-each list --------------------------------------------------
  // A For Each Item list, normalized: the value must be an array (a
  // dict is not a list, and neither is a number or text). Returns
  // { ok, items, total, capped } — ok is false for a non-list (the
  // caller warns and holds), items is a snapshot of the first 1,000
  // entries (so a body that pushes or pops cannot change the run),
  // total is the list's real length, and capped is true when entries
  // past 1,000 were left out (the caller says so).

  function normalizeForEachItems(value) {
    if (!Array.isArray(value)) return { ok: false, items: [], total: 0, capped: false };
    var total = value.length;
    var capped = total > MAX_FOR_EACH_ITEMS;
    return {
      ok: true,
      items: value.slice(0, MAX_FOR_EACH_ITEMS),
      total: total,
      capped: capped
    };
  }

  // --- The for-each field (P5-6 slice c) -------------------------------
  // A For Each Field structure, normalized: the value must be a
  // dictionary (a list is not a dict, and neither is a number or
  // text). Returns { ok, fields, total, capped } — ok is false for a
  // non-dict (the caller warns and holds), fields is a snapshot of
  // the first 1,000 key/value pairs in insertion order (so a body
  // that adds or removes a field cannot change the run), total is
  // the structure's real field count, and capped is true when
  // fields past 1,000 were left out (the caller says so). A value
  // is snapshotted as stored — the same rule as For Each Item,
  // which snapshots the list but not the items inside it.

  function normalizeForEachFields(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, fields: [], total: 0, capped: false };
    }
    var keys = Object.keys(value);
    var total = keys.length;
    var capped = total > MAX_FOR_EACH_ITEMS;
    var fields = [];
    var limit = Math.min(total, MAX_FOR_EACH_ITEMS);
    for (var i = 0; i < limit; i++) {
      fields.push({ key: keys[i], value: value[keys[i]] });
    }
    return { ok: true, fields: fields, total: total, capped: capped };
  }

  // --- Loop state -----------------------------------------------------------
  // Host-owned run state: { depth, control, budget }. depth counts the
  // live loop handlers (Break / Continue only work while it is above
  // 0); control is null, 'break', or 'continue', set by a Break /
  // Continue action inside the innermost body run; budget counts down
  // one per body-action execution and stops the loop when it runs out.

  function createLoopState() {
    return { depth: 0, control: null, budget: MAX_LOOP_ACTIONS_PER_FRAME };
  }

  function stateOf(state) {
    return (state && typeof state === 'object' &&
      typeof state.depth === 'number' && typeof state.budget === 'number') ? state : null;
  }

  // Fresh budget for a frame's script phase (also clears depth and
  // control, so a loop interrupted mid-frame by a throwing action
  // never leaves stale state behind). Returns false for an unusable
  // state, so a missing host record degrades quietly.
  function resetLoopBudget(state) {
    var s = stateOf(state);
    if (!s) return false;
    s.budget = MAX_LOOP_ACTIONS_PER_FRAME;
    s.depth = 0;
    s.control = null;
    return true;
  }

  function loopDepth(state) {
    var s = stateOf(state);
    return s ? s.depth : 0;
  }

  function controlOf(state) {
    var s = stateOf(state);
    return s ? s.control : null;
  }

  function clearControl(state) {
    var s = stateOf(state);
    if (s) s.control = null;
  }

  // A Break inside a body run: set the flag when a loop is live, so
  // the innermost handler stops after this body run. Returns false
  // outside a loop (the caller warns and does nothing).
  function requestBreak(state) {
    var s = stateOf(state);
    if (!s || s.depth <= 0) return false;
    s.control = 'break';
    return true;
  }

  // A Continue inside a body run: same shape as Break, for the next
  // time round instead of stopping.
  function requestContinue(state) {
    var s = stateOf(state);
    if (!s || s.depth <= 0) return false;
    s.control = 'continue';
    return true;
  }

  // Enter a loop body: depth rises by one. Returns false at the
  // nesting cap (the caller warns and skips the loop) or for an
  // unusable state.
  function beginLoop(state) {
    var s = stateOf(state);
    if (!s) return false;
    if (s.depth >= MAX_LOOP_DEPTH) return false;
    s.depth++;
    return true;
  }

  // Leave a loop body: depth falls by one, never below zero.
  function endLoop(state) {
    var s = stateOf(state);
    if (s && s.depth > 0) s.depth--;
  }

  // Spend `n` budget on the body actions just run. Returns false
  // when the budget is spent (the caller warns and stops the loop).
  // A missing state never blocks a loop — the host always supplies
  // one, and a bare harness without it degrades to uncapped.
  function consumeBudget(state, n) {
    var s = stateOf(state);
    if (!s) return true;
    s.budget -= (n || 0);
    return s.budget >= 0;
  }

  function budgetLeft(state) {
    var s = stateOf(state);
    return s ? s.budget : MAX_LOOP_ACTIONS_PER_FRAME;
  }

  return {
    MAX_REPEAT: MAX_REPEAT,
    MAX_WHILE_ITERATIONS: MAX_WHILE_ITERATIONS,
    MAX_LOOP_DEPTH: MAX_LOOP_DEPTH,
    MAX_LOOP_ACTIONS_PER_FRAME: MAX_LOOP_ACTIONS_PER_FRAME,
    MAX_FOR_EACH_ITEMS: MAX_FOR_EACH_ITEMS,
    isLoopAction: isLoopAction,
    isLoopBlock: isLoopBlock,
    compare: compare,
    normalizeCount: normalizeCount,
    normalizeForEachItems: normalizeForEachItems,
    normalizeForEachFields: normalizeForEachFields,
    createLoopState: createLoopState,
    resetLoopBudget: resetLoopBudget,
    loopDepth: loopDepth,
    controlOf: controlOf,
    clearControl: clearControl,
    requestBreak: requestBreak,
    requestContinue: requestContinue,
    beginLoop: beginLoop,
    endLoop: endLoop,
    consumeBudget: consumeBudget,
    budgetLeft: budgetLeft
  };
}

if (typeof window !== 'undefined') {
  window.HydraLoops = hydraLoopsFactory();
  // Self-contained source of the factory, inlined into exported playable games
  // by HydraPlayer.buildPlayableHtml so exports run without editor files.
  window.HydraLoops.factorySource = hydraLoopsFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraLoopsFactory;
