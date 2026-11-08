/* ============================================================================
 * hydra-dispatch.js — HydraScript shared script-grid dispatch
 * (P2 item 15/12, slice 7: the shared-engine extraction closes here).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation
 * of the dispatch both runtimes step through once per frame — the part of
 * processScope (export) / processDeterministicConditions (preview) that
 * is about the traversal, not the blocks — used by:
 *   - the editor preview runtime (script.js processScriptGrid delegates
 *     to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Why this slice last: the dispatch is the last duplicated subsystem of
 * the two runtimes. The per-block condition/action switches
 * (evaluate/execute in the export, evaluateCondition/executeAction in
 * the preview) stay host-side — they are the next extraction, not this
 * one — but the traversal that drives them is now shared code: the
 * two-pass ordering, the trigger-mode gating, the trace recording, the
 * unknown-block reporting, and the started-scope bookkeeping. Each host
 * only supplies its classifiers, its evaluator/executor, and its
 * bookkeeping hooks.
 *
 * One scope, in order (the export's order, which is the reference):
 *   1. The grid entries are walked in ascending numeric cell order.
 *   2. Pass 1 runs every non-deferred condition: 'and' and 'triggerOnce'
 *      are skipped (they read the contexts pass 1 just wrote, so they
 *      must run after it). A block whose type is not a condition, an
 *      action, or a comment is reported once through reportUnknown.
 *   3. Pass 2 runs only 'and' / 'triggerOnce'.
 *   4. A condition that evaluates true is gated by the flow module's
 *      shouldTrigger over the host's flowTriggerStates map: 'edge'
 *      fires once on a false->true transition, 'level' fires every
 *      frame while true. Whether or not it fires, a true condition
 *      notes its context through onPropagateCondition: the and/once
 *      merge (pass 2) reads the contexts pass 1 wrote, so a condition
 *      that is TRUE this frame must leave its context here — an
 *      edge-triggered condition that stays true (standing on the
 *      floor) fires only on its false->true transition, and if its
 *      context were recorded only on that one frame, a neighbouring
 *      `and` could pass only when both inputs happened to transition
 *      on the same frame. Recording on every true frame makes the
 *      merge read current truth, while the fire decision below
 *      (shouldTrigger + execution context) stays unchanged.
 *   5. A gated-through condition is noted through onTriggered (the
 *      host records the context and the execution context), recorded
 *      in the trace ring as a 'trigger' event, and propagated through
 *      the flow module: chained actions execute, passing sub-conditions
 *      are noted through onPropagateCondition and keep the flow going.
 *   6. The scope is marked started (startedScopes.add), so a
 *      gameStart condition in it fires only on the run's first frame.
 *
 * Hooks (all optional except flow and evaluate):
 *   - flow — the HydraFlow module (shouldTrigger, propagate). Without
 *     a usable flow module the scope is not processed at all and
 *     processScope returns false.
 *   - trace — the HydraTrace module (record); traceState — the trace
 *     ring; frameId — the frame number stamped on trace events.
 *     Without a trace module or a trace state nothing is recorded.
 *   - isCondition(type), isAction(type), isComment(type) — the host's
 *     block classifiers. isComment defaults to type === 'comment'.
 *   - evaluate(idx, data) -> { triggered, context } (or a falsy value).
 *     Without it the scope is not processed and processScope returns
 *     false.
 *   - execute(idx, data) — the host's action executor, called by the
 *     flow module during propagation. Without it actions silently do
 *     nothing (a no-op is passed to propagate).
 *   - isLoopBlock(type), executeLoop(idx, data, runBody), shouldAbort()
 *     — the host's loop hooks, passed through to the flow module's
 *     propagate (P5-4 slice a): a Repeat / While block runs its body
 *     through executeLoop instead of the ordinary action path, and a
 *     Break / Continue inside a body stops that body propagation
 *     through shouldAbort. Without them loop blocks run as ordinary
 *     actions and their bodies run once, like any other chain.
 *     buildPropagateApi(hooks, scopeKey, grid) builds the same
 *     propagate API processScope builds, for a caller that fires one
 *     condition's chain itself (the preview's gameStart launch path):
 *     the raw hooks object is NOT a propagate API — propagate calls
 *     api.executeAction / api.evaluateCondition, which only the
 *     dispatch-built API provides.
 *   - flowTriggerStates — the host's edge-memory map (scopeKey:index ->
 *     boolean). It must survive across frames within a run: wiping it
 *     per frame turns every edge condition into a level one. Without
 *     one a throwaway map is used for the call, so edge memory does
 *     not persist — the hosts always pass the real map.
 *   - startedScopes — a Set with an add() method; the scope key is
 *     added when the scope has been processed.
 *   - onTriggered(idx, result) — host bookkeeping for the condition
 *     that started a flow (the trigger's context + execution context).
 *   - onPropagateCondition(idx, result) — host bookkeeping for a
 *     condition that evaluated true (its context, for the and/once
 *     merge — NOT the execution context). Fires for every true
 *     top-level condition in pass 1 AND for a condition evaluated
 *     during propagation, so the same cell can be noted twice in one
 *     frame (once as a gate, once as its own evaluation); the host
 *     just overwrites the same context key, so the duplicate is
 *     harmless.
 *   - reportUnknown(type, idx) — host reporting for an unknown block
 *     type found in pass 1.
 *
 * Semantics:
 *   - processScope(grid, scopeKey, hooks): processes one scope's grid
 *     and returns true; returns false when the grid is not an object,
 *     when the flow module is unusable, or when evaluate is not a
 *     function (nothing runs). Nothing here ever throws: a throwing
 *     evaluate reads as not-triggered, a throwing bookkeeping or
 *     trace hook is swallowed, a throwing action stops that one
 *     propagation (the rest of the scope still runs), and a frozen
 *     flowTriggerStates map skips the trigger instead of breaking
 *     the frame.
 *   - DEFERRED_TYPES lists the pass-2 condition types ('and',
 *     'triggerOnce'), exported so hosts and tests share the set.
 *
 * Behavior changes vs the old inline code (both in the direction the
 * code already documented with "(mirrors the export)" / "(mirrors the
 * editor preview)" comments — the two runtimes were supposed to agree
 * and did not):
 *   - Preview edge conditions now fire once per false->true transition.
 *     The preview's per-frame context reset wiped flowTriggerStates
 *     every frame, so an edge condition that stayed true (a held
 *     collision, a visible object) re-fired on every frame in the
 *     preview while firing once in exports. The map is now cleared
 *     only when a run restarts, like the export's fresh state per
 *     session; the preview's resetGame owns that clear.
 *   - The two hosts' propagate contracts now agree. The old inline
 *     code differed in what a condition evaluated during propagation
 *     recorded: the export wrote only the per-frame contexts store,
 *     the preview wrote the contexts store AND the execution context
 *     (through the same context setter as the trigger path). In
 *     practice this changes no live behavior — flow edges target
 *     actions only, so propagation never evaluates a condition today
 *     (condition-to-condition gating is a deferred feature) — but the
 *     shared dispatch now defines one contract for whenever gating
 *     lands: a gate notes its context for the and/once merge and
 *     never the execution context, so chained actions keep seeing
 *     the triggering condition's context.
 *   - A throwing condition no longer aborts the rest of its scope:
 *     the old inline loops let one throwing evaluate kill the whole
 *     runScripts phase for the frame. The dispatch now reads it as
 *     not-triggered and keeps walking, in the direction of the frame
 *     slice's throwing-phase resilience.
 *
 * Deliberately NOT unified (stays host-side, documented here so the
 * next slice does not "fix" it by accident):
 *   - The per-block condition/action switches (evaluate/execute in
 *     the export, evaluateCondition/executeAction in the preview)
 *     and their dozens of helpers — the next extraction.
 *   - The preview's DOM work around the dispatch (the 'triggered'
 *     cell classes, the cyan 'traced' ring, the Trace feed) and the
 *     launch-time gameStart path (processGameStartConditions).
 *   - The export's unknown-condition/action defaults inside evaluate
 *     / execute (they only fire for types the classifiers already
 *     accept, so the traversal never reaches them for unknown types).
 *
 * Load order (index.html): hydra-dispatch.js BEFORE player-runtime.js
 * and script.js. player-runtime.js throws a clear error if
 * HydraDispatch is missing. The preview guards the processScope call
 * (window.HydraDispatch), so the editor still boots if the tag is
 * ever dropped — scripts simply do not run, the same guarded-call
 * degradation the other shared modules use; the tag order is pinned
 * by tests/dispatch.test.js.
 * ========================================================================== */

function hydraDispatchFactory() {
  'use strict';

  // The pass-2 condition types: they read the contexts pass 1 wrote
  // (the and/once merge over adjacent cells), so they must run after
  // every ordinary condition has been evaluated this frame.
  var DEFERRED_TYPES = ['and', 'triggerOnce'];

  function isDeferredType(type) {
    return type === 'and' || type === 'triggerOnce';
  }

  function isFn(f) { return typeof f === 'function'; }

  // The grid entries in ascending numeric cell order, like both hosts'
  // old inline walks. A non-numeric key reads as NaN and sorts with
  // the numbers exactly as the old walks did (no filtering added).
  function sortedEntries(grid) {
    var entries = Object.entries(grid).map(function (pair) {
      return [Number(pair[0]), pair[1]];
    });
    entries.sort(function (a, b) { return a[0] - b[0]; });
    return entries;
  }

  // One trace event, guarded: no trace module, no trace state, or a
  // throwing record never breaks the dispatch (recording is a no-op
  // while tracing is off, so a guarded record behaves exactly like
  // the hosts' old direct calls).
  function recordTrace(trace, traceState, frameId, scopeKey, idx, kind, type) {
    try {
      if (trace && isFn(trace.record) && traceState) {
        trace.record(traceState, {
          frame: frameId || 0,
          scope: scopeKey,
          index: idx,
          kind: kind,
          type: type || ''
        });
      }
    } catch (e) { /* tracing is best-effort; never break the dispatch */ }
  }

  // One condition evaluation, guarded: a throwing evaluate reads as
  // not-triggered, so one broken condition never aborts its scope.
  function safeEvaluate(evaluate, idx, data) {
    try {
      return evaluate(idx, data);
    } catch (e) { return null; }
  }

  // One host bookkeeping hook, guarded: bookkeeping never breaks the
  // dispatch.
  function safeHook(fn, idx, result) {
    try {
      if (isFn(fn)) fn(idx, result);
    } catch (e) { /* bookkeeping must never break the dispatch */ }
  }

  function safeReport(fn, type, idx) {
    try {
      if (isFn(fn)) fn(type, idx);
    } catch (e) { /* reporting must never break the dispatch */ }
  }

  // The propagate API for one scope's grid, built from the host hooks:
  // the flow walk's view of the same classifiers, evaluator, executor,
  // loop hooks, and trace recording processScope uses, so any caller
  // that fires a single condition's chain (the preview's gameStart
  // launch path) walks exactly like the dispatch's own trigger walk
  // instead of drifting from it. Returns null when the hooks cannot
  // build a usable API (no evaluator) — the caller degrades to its
  // own direct path, the same guarded-call degradation the hosts use.
  function buildPropagateApi(hooks, scopeKey, grid) {
    var h = hooks || {};
    if (!isFn(h.evaluate)) return null;
    var key = (scopeKey === undefined || scopeKey === null) ? '' : String(scopeKey);
    var isCondition = isFn(h.isCondition) ? h.isCondition : function () { return false; };
    var isAction = isFn(h.isAction) ? h.isAction : function () { return false; };
    var execute = isFn(h.execute) ? h.execute : function () {};
    var trace = h.trace || null;
    var traceState = h.traceState || null;
    var frameId = h.frameId || 0;
    return {
      isCondition: isCondition,
      isAction: isAction,
      isLoopBlock: h.isLoopBlock,
      executeLoop: h.executeLoop,
      shouldAbort: h.shouldAbort,
      evaluateCondition: function (i, d) {
        var r = safeEvaluate(h.evaluate, i, d);
        if (r && r.triggered) safeHook(h.onPropagateCondition, i, r);
        return !!(r && r.triggered);
      },
      executeAction: function (i, d) { execute(i, d); },
      onVisit: function (vIdx, kind) {
        var vData = grid[vIdx];
        recordTrace(trace, traceState, frameId, key, vIdx, kind, vData && vData.type);
      }
    };
  }

  // Process one scope's grid. Returns true when the scope was walked,
  // false when nothing ran (no grid, no usable flow module, or no
  // evaluator). Never throws.
  function processScope(grid, scopeKey, hooks) {
    if (!grid || typeof grid !== 'object') return false;
    var h = hooks || {};
    var flow = h.flow;
    if (!flow || !isFn(flow.shouldTrigger) || !isFn(flow.propagate)) return false;
    if (!isFn(h.evaluate)) return false;
    var key = (scopeKey === undefined || scopeKey === null) ? '' : String(scopeKey);
    var isCondition = isFn(h.isCondition) ? h.isCondition : function () { return false; };
    var isAction = isFn(h.isAction) ? h.isAction : function () { return false; };
    var isComment = isFn(h.isComment) ? h.isComment : function (t) { return t === 'comment'; };
    var triggerStates = (h.flowTriggerStates && typeof h.flowTriggerStates === 'object')
      ? h.flowTriggerStates : {};
    var trace = h.trace || null;
    var traceState = h.traceState || null;
    var frameId = h.frameId || 0;
    var entries = sortedEntries(grid);

    var api = buildPropagateApi(h, key, grid);
    if (!api) return false;

    function runCondition(idx, data) {
      var result = safeEvaluate(h.evaluate, idx, data);
      // The and/once merge (pass 2) reads the contexts pass 1 wrote,
      // so a condition that is TRUE this frame must leave its context
      // here whether or not it fires: an edge-triggered condition
      // that stays true (standing on the floor) fires only on its
      // false->true transition, and if its context were recorded only
      // on that one frame, a neighbouring `and` could pass only when
      // both inputs happened to transition on the same frame — in
      // practice never. Recording the context on every true frame
      // makes the merge read current truth, while the fire decision
      // below (shouldTrigger + execution context) stays unchanged.
      // onPropagateCondition is the hook that records a context
      // without touching the execution context, which is exactly
      // what this needs.
      if (result && result.triggered) safeHook(h.onPropagateCondition, idx, result);
      var fire = false;
      try {
        fire = !!flow.shouldTrigger(triggerStates, key + ':' + idx, !!(result && result.triggered), data);
      } catch (e) { fire = false; }
      if (!fire) return;
      safeHook(h.onTriggered, idx, result);
      recordTrace(trace, traceState, frameId, key, idx, 'trigger', data && data.type);
      try {
        flow.propagate(grid, idx, api);
      } catch (e) { /* a throwing action stops this propagation, not the scope */ }
    }

    // Pass 1: every ordinary condition. Deferred types are skipped
    // (they run in pass 2); unknown block types are reported once.
    entries.forEach(function (entry) {
      var idx = entry[0], data = entry[1];
      if (!data || isDeferredType(data.type) || !isCondition(data.type)) {
        if (data && typeof data.type === 'string' && !isCondition(data.type) &&
            !isAction(data.type) && !isComment(data.type)) {
          safeReport(h.reportUnknown, data.type, idx);
        }
        return;
      }
      runCondition(idx, data);
    });
    // Pass 2: only the deferred conditions, reading the contexts
    // pass 1 just wrote.
    entries.forEach(function (entry) {
      var idx = entry[0], data = entry[1];
      if (!data || !isDeferredType(data.type)) return;
      runCondition(idx, data);
    });

    try {
      if (h.startedScopes && isFn(h.startedScopes.add)) h.startedScopes.add(key);
    } catch (e) { /* a bad started-scopes set never breaks the dispatch */ }
    return true;
  }

  return {
    DEFERRED_TYPES: DEFERRED_TYPES,
    isDeferredType: isDeferredType,
    buildPropagateApi: buildPropagateApi,
    processScope: processScope
  };
}

if (typeof window !== 'undefined') {
  window.HydraDispatch = hydraDispatchFactory();
  // Self-contained source of the factory, inlined into exported playable games
  // by buildPlayableHtml (player-runtime.js). Kept as a string, never eval'd here.
  window.HydraDispatch.factorySource = hydraDispatchFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraDispatchFactory;
