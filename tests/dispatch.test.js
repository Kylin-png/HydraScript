// Unit tests for hydra/hydra-dispatch.js — the shared script-grid
// dispatch (P2 item 15/12, slice 7: the shared-engine extraction
// closes here).
//
// Pure logic: the two-pass traversal (ordinary conditions, then the
// deferred 'and'/'triggerOnce'), the trigger-mode gating over the
// host's edge-memory map, the trace recording, the unknown-block
// reporting, and the started-scope bookkeeping — over stub
// classifiers/evaluator/executor with the real HydraFlow and
// HydraTrace modules. The tests pin the traversal order, the edge vs
// level gating (including the closed divergence: edge memory must
// survive across frames, so a held edge condition fires once), the
// hook contracts (a trigger notes context + execution context, a
// propagate gate notes context only), the never-throws contract, the
// hostile-input degradation, and the static routing that both
// runtimes delegate to it.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const sandbox = {};
sandbox.window = sandbox; // hydra-*.js modules assign to bare `window`
vm.createContext(sandbox);
['hydra-flow.js', 'hydra-trace.js', 'hydra-dispatch.js'].forEach(m =>
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', m), 'utf8'),
    sandbox, { filename: m }));
const D = sandbox.HydraDispatch;
const Flow = sandbox.HydraFlow;
const Trace = sandbox.HydraTrace;

const COND_TYPES = ['gameStart', 'always', 'collision', 'objectVisible', 'and', 'triggerOnce'];
const ACT_TYPES = ['setVariable', 'destroyObject'];

// --- hooks builder ---
// results: idx -> { triggered, context } (or a function(idx, data) ->
// result). Every hook call is logged so the tests can pin the order
// and the exact contract.
function baseHooks(over) {
  const o = over || {};
  const log = { evalOrder: [], executed: [], triggered: [], gated: [], unknown: [] };
  const results = o.results || {};
  const hooks = {
    flow: o.flow !== undefined ? o.flow : Flow,
    trace: o.trace !== undefined ? o.trace : Trace,
    traceState: o.traceState !== undefined ? o.traceState : Trace.createTracer(),
    frameId: o.frameId !== undefined ? o.frameId : 7,
    isCondition: (t) => COND_TYPES.includes(t),
    isAction: (t) => ACT_TYPES.includes(t),
    isComment: (t) => t === 'comment',
    evaluate: (idx, data) => {
      log.evalOrder.push(idx);
      if (typeof results === 'function') return results(idx, data);
      if (Object.prototype.hasOwnProperty.call(results, idx)) return results[idx];
      return { triggered: true, context: { from: idx } };
    },
    execute: (idx, data) => { log.executed.push(idx); },
    flowTriggerStates: o.flowTriggerStates !== undefined ? o.flowTriggerStates : {},
    startedScopes: o.startedScopes !== undefined ? o.startedScopes : new Set(),
    onTriggered: (idx, result) => { log.triggered.push([idx, result && result.context]); },
    onPropagateCondition: (idx, result) => { log.gated.push([idx, result && result.context]); },
    reportUnknown: (type, idx) => { log.unknown.push([type, idx]); },
    log
  };
  if (hooks.traceState && typeof Trace.enable === 'function') Trace.enable(hooks.traceState);
  return Object.assign(hooks, o.hookOver || {});
}

// --- surface + factorySource ---
check('surface exposes processScope, buildPropagateApi, isDeferredType, and DEFERRED_TYPES',
  typeof D.processScope === 'function' && typeof D.buildPropagateApi === 'function' &&
  typeof D.isDeferredType === 'function' &&
  Array.isArray(D.DEFERRED_TYPES) && D.DEFERRED_TYPES.join(',') === 'and,triggerOnce',
  Object.keys(D).join(','));

// --- buildPropagateApi (P5-4 slice a: the preview's gameStart launch
// path fires one condition's chain through this API, not the raw
// hooks — propagate calls api.executeAction / api.evaluateCondition,
// which only the dispatch-built API provides) ---
check('buildPropagateApi returns null without an evaluator',
  D.buildPropagateApi({}, 's', {}) === null &&
  D.buildPropagateApi({ evaluate: null }, 's', {}) === null);
(function () {
  const h = baseHooks();
  const api = D.buildPropagateApi(h, 's', {});
  check('buildPropagateApi returns the full propagate API with an evaluator',
    api !== null && typeof api.executeAction === 'function' &&
    typeof api.evaluateCondition === 'function' &&
    typeof api.onVisit === 'function' &&
    typeof api.isCondition === 'function' && typeof api.isAction === 'function',
    api === null ? 'null' : Object.keys(api).join(','));
  // The API's executeAction routes to the host's execute hook.
  h.log.executed.length = 0;
  api.executeAction(5, { type: 'setVariable' });
  check('built API executeAction calls the host execute hook',
    JSON.stringify(h.log.executed) === JSON.stringify([5]), JSON.stringify(h.log.executed));
  // The API's evaluateCondition returns the trigger verdict.
  const verdict = api.evaluateCondition(0, { type: 'gameStart' });
  check('built API evaluateCondition returns the host verdict',
    verdict === true, String(verdict));
})();
// A Repeat chain walked through the built API takes the loop branch:
// the stub executeLoop runs the body once per call, and the body
// actions execute through the API (not through the raw hooks).
(function () {
  const loopCalls = [];
  const h = baseHooks({
    hookOver: {
      isAction: (t) => [...ACT_TYPES, 'repeatTimes'].includes(t),
      isLoopBlock: (t) => t === 'repeatTimes',
      executeLoop: (idx, data, runBody) => { loopCalls.push(idx); runBody(); return true; },
      shouldAbort: () => false
    }
  });
  const grid = {
    0: { type: 'gameStart' },
    1: { type: 'repeatTimes', count: '3', counterVar: '' },
    2: { type: 'setVariable', varName: 'a', operation: 'add', value: 1 },
    3: { type: 'setVariable', varName: 'b', operation: 'add', value: 1 }
  };
  const api = D.buildPropagateApi(h, 's', grid);
  const order = Flow.propagate(grid, 0, api);
  check('built API propagate routes a Repeat through executeLoop and runs its body',
    JSON.stringify(loopCalls) === JSON.stringify([1]) &&
    JSON.stringify(h.log.executed) === JSON.stringify([2, 3]) &&
    JSON.stringify(order) === JSON.stringify([1]),
    JSON.stringify({ loopCalls, executed: h.log.executed, order }));
})();
check('isDeferredType names only and/triggerOnce',
  D.isDeferredType('and') && D.isDeferredType('triggerOnce') &&
  !D.isDeferredType('always') && !D.isDeferredType('collision') && !D.isDeferredType(null));
check('factorySource re-instantiates an independent module',
  (() => {
    const sb2 = { window: null };
    sb2.window = sb2;
    vm.createContext(sb2);
    const fresh = vm.runInContext('(' + D.factorySource + ')()', sb2);
    return fresh !== D && typeof fresh.processScope === 'function' &&
      fresh.processScope !== D.processScope && typeof fresh.factorySource === 'undefined';
  })());

// --- traversal order ---
check('deferred conditions run after ordinary ones, whatever the indexes',
  (() => {
    const h = baseHooks({ results: { 0: { triggered: true, context: {} }, 60: { triggered: true, context: {} } } });
    D.processScope({ 0: { type: 'and' }, 60: { type: 'always' } }, 'global', h);
    return h.log.evalOrder.join(',') === '60,0';
  })());
check('numeric order inside a pass is ascending',
  (() => {
    const h = baseHooks();
    D.processScope({ 120: { type: 'always' }, 0: { type: 'always' }, 60: { type: 'always' } }, 'global', h);
    return h.log.evalOrder.join(',') === '0,60,120';
  })());
check('a deferred condition still triggers its chained action',
  (() => {
    const h = baseHooks({ results: { 0: { triggered: true, context: {} }, 60: { triggered: true, context: {} } } });
    D.processScope({ 0: { type: 'and' }, 1: { type: 'setVariable' }, 60: { type: 'always' } }, 'global', h);
    return h.log.executed.join(',') === '1' && h.log.triggered.map(t => t[0]).join(',') === '60,0';
  })());
check('a trigger runs its rightward action through the flow module',
  (() => {
    const h = baseHooks();
    D.processScope({ 0: { type: 'always' }, 1: { type: 'setVariable' } }, 'global', h);
    return h.log.executed.join(',') === '1' && h.log.triggered.length === 1 && h.log.triggered[0][0] === 0;
  })());

// --- trigger modes: the closed edge divergence ---
check('edge: a held condition fires once across frames sharing one map',
  (() => {
    const map = {};
    const h = baseHooks({ flowTriggerStates: map, results: { 0: { triggered: true, context: {} } } });
    D.processScope({ 0: { type: 'collision' } }, 'global', h);
    D.processScope({ 0: { type: 'collision' } }, 'global', h);
    D.processScope({ 0: { type: 'collision' } }, 'global', h);
    return h.log.triggered.length === 1;
  })());
check('edge: false resets, true after false fires again',
  (() => {
    const map = {};
    let held = true;
    const h = baseHooks({
      flowTriggerStates: map,
      results: (idx) => ({ triggered: held, context: {} })
    });
    D.processScope({ 0: { type: 'collision' } }, 'global', h);
    D.processScope({ 0: { type: 'collision' } }, 'global', h);
    held = false;
    D.processScope({ 0: { type: 'collision' } }, 'global', h);
    held = true;
    D.processScope({ 0: { type: 'collision' } }, 'global', h);
    return h.log.triggered.length === 2;
  })());
check('edge: a fresh map per call re-fires (why hosts must pass one map)',
  (() => {
    const h = baseHooks({ results: { 0: { triggered: true, context: {} } } });
    D.processScope({ 0: { type: 'collision' } }, 'global', h);
    const h2 = baseHooks({ results: { 0: { triggered: true, context: {} } } });
    D.processScope({ 0: { type: 'collision' } }, 'global', h2);
    return h.log.triggered.length === 1 && h2.log.triggered.length === 1;
  })());
check('level: fires every frame while true',
  (() => {
    const map = {};
    const h = baseHooks({ flowTriggerStates: map, results: { 0: { triggered: true, context: {} } } });
    D.processScope({ 0: { type: 'always' } }, 'global', h);
    D.processScope({ 0: { type: 'always' } }, 'global', h);
    return h.log.triggered.length === 2;
  })());
check('a false condition never triggers, in either mode',
  (() => {
    const h = baseHooks({ results: { 0: { triggered: false, context: {} }, 60: { triggered: false, context: {} } } });
    D.processScope({ 0: { type: 'collision' }, 60: { type: 'always' } }, 'global', h);
    return h.log.triggered.length === 0 && h.log.executed.length === 0;
  })());

// --- hook contracts ---
check('onTriggered receives the trigger result context',
  (() => {
    const h = baseHooks({ results: { 0: { triggered: true, context: { obj1: 'hero' } } } });
    D.processScope({ 0: { type: 'always' } }, 'global', h);
    return h.log.triggered.length === 1 && h.log.triggered[0][1] && h.log.triggered[0][1].obj1 === 'hero';
  })());
check('startedScopes gains the scope key once processed',
  (() => {
    const scopes = new Set();
    const h = baseHooks({ startedScopes: scopes });
    D.processScope({ 0: { type: 'always' } }, 'global', h);
    return scopes.has('global') && scopes.size === 1;
  })());
check('unknown block types are reported once, comments and actions are not',
  (() => {
    const h = baseHooks();
    D.processScope({
      0: { type: 'wat' }, 1: { type: 'always' }, 2: { type: 'comment' },
      3: { type: 'setVariable' }, 4: { type: 'nope' }
    }, 'global', h);
    return h.log.unknown.length === 2 &&
      h.log.unknown[0].join(':') === 'wat:0' && h.log.unknown[1].join(':') === 'nope:4';
  })());
check('unknown blocks report again on the next call (hosts dedupe, the module reports)',
  (() => {
    const h = baseHooks();
    D.processScope({ 0: { type: 'wat' } }, 'global', h);
    D.processScope({ 0: { type: 'wat' } }, 'global', h);
    return h.log.unknown.length === 2;
  })());

// --- trace recording ---
check('trigger and chained action land in the trace ring in order',
  (() => {
    const h = baseHooks();
    D.processScope({ 0: { type: 'always' }, 1: { type: 'setVariable' } }, '1', h);
    const ev = h.traceState.events;
    return ev.length === 2 && ev[0].kind === 'trigger' && ev[0].type === 'always' &&
      ev[0].index === 0 && ev[0].scope === '1' && ev[0].frame === 7 &&
      ev[1].kind === 'action' && ev[1].type === 'setVariable' && ev[1].index === 1;
  })());
check('no trace module means no recording and no throw',
  (() => {
    const h = baseHooks({ trace: null, traceState: null });
    return D.processScope({ 0: { type: 'always' }, 1: { type: 'setVariable' } }, 'global', h) === true &&
      h.log.triggered.length === 1 && h.log.executed.join(',') === '1';
  })());

// --- propagate gates: the shared contract for the deferred gating feature ---
// Flow edges target actions only today, so the real flow module never
// evaluates a condition during propagation. A stub flow that does
// exercises the contract: a passing gate notes its context through
// onPropagateCondition only — onTriggered is for the trigger alone.
// (Post-5b649da contract: onPropagateCondition ALSO fires for every
// true top-level condition in pass 1, so the and/once merge reads
// current truth — see hydra-dispatch.js step 4. The same cell is
// therefore noted twice when it is both a gate and its own trigger;
// the host overwrites one context key, so the duplicate is harmless.)
check('a passing gate notes its context, never the trigger hook',
  (() => {
    const h = baseHooks({
      flow: {
        shouldTrigger: Flow.shouldTrigger,
        propagate: (grid, idx, api) => {
          // Only the trigger at 0 fans out through the gate at 5; the
          // gate's own top-level firing propagates nowhere.
          if (idx !== 0) return [];
          const pass = api.evaluateCondition(5, grid[5]);
          if (pass) api.executeAction(6, grid[6]);
          return [];
        }
      },
      results: { 0: { triggered: true, context: { obj1: 'hero' } }, 5: { triggered: true, context: { obj1: 'coin' } } }
    });
    D.processScope({ 0: { type: 'always' }, 5: { type: 'collision' }, 6: { type: 'setVariable' } }, 'global', h);
    // Both top-level conditions fire (triggered 0 and 5); the gate is
    // noted during trigger 0's propagation with the coin context —
    // onTriggered never sees the gate — and each true top-level
    // condition notes its own context too, so gated reads 0,5,5
    // (trigger 0, the gate, trigger 5's own evaluation).
    return h.log.triggered.map(t => t[0]).join(',') === '0,5' &&
      h.log.gated.map(g => g[0]).join(',') === '0,5,5' &&
      h.log.gated[1][1].obj1 === 'coin' && h.log.executed.join(',') === '6';
  })());
check('a failing gate notes no gate context and runs no action',
  (() => {
    const h = baseHooks({
      flow: {
        shouldTrigger: Flow.shouldTrigger,
        propagate: (grid, idx, api) => {
          const pass = api.evaluateCondition(5, grid[5]);
          if (pass) api.executeAction(6, grid[6]);
          return [];
        }
      },
      results: { 0: { triggered: true, context: {} }, 5: { triggered: false, context: {} } }
    });
    D.processScope({ 0: { type: 'always' }, 5: { type: 'collision' }, 6: { type: 'setVariable' } }, 'global', h);
    // The gate (5) is false, so nothing is noted for it and no action
    // runs; the only gate note is the trigger 0's own true-context note.
    return h.log.gated.length === 1 && h.log.gated[0][0] === 0 && h.log.executed.length === 0;
  })());

// --- hostile input: never throws, degrades to a safe default ---
check('null or non-object grid returns false',
  D.processScope(null, 'global', baseHooks()) === false &&
  D.processScope('nope', 'global', baseHooks()) === false &&
  D.processScope(42, 'global', baseHooks()) === false);
check('missing flow module returns false and runs nothing',
  (() => {
    const h = baseHooks({ flow: null });
    return D.processScope({ 0: { type: 'always' } }, 'global', h) === false && h.log.evalOrder.length === 0;
  })());
check('flow without shouldTrigger/propagate returns false',
  (() => {
    const h = baseHooks({ flow: {} });
    return D.processScope({ 0: { type: 'always' } }, 'global', h) === false;
  })());
check('missing evaluate returns false and runs nothing',
  (() => {
    const h = baseHooks();
    delete h.evaluate;
    return D.processScope({ 0: { type: 'always' } }, 'global', h) === false && h.log.executed.length === 0;
  })());
check('missing execute still triggers conditions, actions silently do nothing',
  (() => {
    const h = baseHooks();
    delete h.execute;
    return D.processScope({ 0: { type: 'always' }, 1: { type: 'setVariable' } }, 'global', h) === true &&
      h.log.triggered.length === 1;
  })());
check('a throwing evaluate reads as not-triggered and the scope continues',
  (() => {
    const h = baseHooks({
      results: (idx) => {
        if (idx === 0) throw new Error('boom');
        return { triggered: true, context: {} };
      }
    });
    const ok = D.processScope({ 0: { type: 'always' }, 60: { type: 'always' }, 61: { type: 'setVariable' } }, 'global', h);
    return ok === true && h.log.triggered.length === 1 && h.log.triggered[0][0] === 60 &&
      h.log.executed.join(',') === '61';
  })());
check('a throwing action stops its propagation, not the scope',
  (() => {
    const h = baseHooks({
      results: { 0: { triggered: true, context: {} }, 60: { triggered: true, context: {} } }
    });
    h.execute = (idx) => {
      if (idx === 1) throw new Error('action boom');
      h.log.executed.push(idx);
    };
    const ok = D.processScope({ 0: { type: 'always' }, 1: { type: 'setVariable' }, 60: { type: 'always' }, 61: { type: 'setVariable' } }, 'global', h);
    return ok === true && h.log.triggered.map(t => t[0]).join(',') === '0,60' && h.log.executed.join(',') === '61';
  })());
check('throwing bookkeeping hooks never break the dispatch',
  (() => {
    const h = baseHooks({
      hookOver: {
        onTriggered: () => { throw new Error('hook boom'); },
        onPropagateCondition: () => { throw new Error('gate boom'); },
        reportUnknown: () => { throw new Error('report boom'); }
      }
    });
    const ok = D.processScope({ 0: { type: 'wat' }, 1: { type: 'always' }, 2: { type: 'setVariable' } }, 'global', h);
    return ok === true && h.log.executed.join(',') === '2';
  })());
check('a frozen edge-memory map skips the trigger instead of throwing',
  (() => {
    const h = baseHooks({ flowTriggerStates: Object.freeze({}) });
    return D.processScope({ 0: { type: 'collision' } }, 'global', h) === true && h.log.triggered.length === 0;
  })());
check('a throwing startedScopes add still returns true',
  (() => {
    const bad = { add: () => { throw new Error('nope'); } };
    const h = baseHooks({ startedScopes: bad });
    return D.processScope({ 0: { type: 'always' } }, 'global', h) === true;
  })());
check('non-function classifiers mean nothing runs, but the scope still returns true',
  (() => {
    const h = baseHooks();
    h.isCondition = 'not a function';
    h.isAction = null;
    return D.processScope({ 0: { type: 'always' } }, 'global', h) === true && h.log.evalOrder.length === 0;
  })());
check('null hooks object returns false (no flow, no evaluate)',
  D.processScope({ 0: { type: 'always' } }, 'global', null) === false);
check('numeric scope keys stringify, null scope keys read as empty',
  (() => {
    const scopes = new Set();
    const h = baseHooks({ startedScopes: scopes });
    D.processScope({ 0: { type: 'always' } }, 3, h);
    const h2 = baseHooks({ startedScopes: scopes });
    D.processScope({ 0: { type: 'always' } }, null, h2);
    return scopes.has('3') && scopes.has('');
  })());

// --- static routing: both runtimes delegate, the inline dispatch is gone ---
const playerSrc = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'player-runtime.js'), 'utf8');
const scriptSrc = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'script.js'), 'utf8');
const moduleSrc = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-previewruntime.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'index.html'), 'utf8');
check('player-runtime.js hard-guards on HydraDispatch',
  /requires hydra-dispatch\.js \(window\.HydraDispatch\)/.test(playerSrc) &&
  /typeof HydraDispatch\.processScope !== 'function'/.test(playerSrc));
check('player-runtime.js inlines HydraDispatch into exports (sharedSources)',
  playerSrc.includes("['HydraDispatch', global.HydraDispatch && global.HydraDispatch.factorySource, 'hydra-dispatch.js (window.HydraDispatch)']"));
check('player-runtime.js processScope delegates to HydraDispatch.processScope',
  /function processScope\(state, scope, fnFrame\) \{[\s\S]*?HydraDispatch\.processScope\(getScopeGrid\(state, scope\), getScopeKey\(scope\), dispatchHooks\(state, scope, fnFrame\)\);/.test(playerSrc));
check('player-runtime.js runCondition is gone (no inline trigger gating or propagate)',
  !/function runCondition/.test(playerSrc) &&
  // Call-aware: the HydraFlow load guard legitimately *names* propagate
  // in a typeof check (P5-7) — what is banned is calling it inline,
  // which would bypass HydraDispatch.
  !/HydraFlow\.(shouldTrigger|propagate)\s*\(/.test(playerSrc));
check('the preview runtime module dispatches through HydraDispatch.processScope',
  /dispatch\.processScope\(gd, scopeKeyOf\(scope\), dispatchHooks\(scope, fnFrame\)\)/.test(moduleSrc) &&
  /function dispatchHooks\(scope, fnFrame\)/.test(moduleSrc));
check('script.js processScriptGrid is a thin delegation to the module',
  /HydraPreviewRuntime\.processScriptGrid\(scope\)/.test(scriptSrc) &&
  !/function processScriptGrid\(scope\) \{[\s\S]*?HydraDispatch\.processScope/.test(scriptSrc));
check('script.js deterministic-condition traversal is gone',
  !scriptSrc.includes('processDeterministicConditions') && !scriptSrc.includes('DEFERRED_CONDITION_TYPES'));
check('the module per-frame context reset no longer wipes edge memory',
  (() => {
    const fn = moduleSrc.match(/function resetFrameConditionContexts\(\) \{[\s\S]*?\n  \}/);
    // The body keeps a comment naming flowTriggerStates; the wipe itself
    // must not be there.
    return !!fn && !/flowTriggerStates\s*=/.test(fn[0]);
  })());
check('the preview runtime module resetGame clears edge memory for a fresh run',
  (() => {
    // P2 item 14 slice 8: resetGame moved from script.js into
    // HydraPreviewRuntime; the pin matches the module function body
    // (two-space indent, like the dispatch host's own pins).
    const fn = moduleSrc.match(/function resetGame\(\) \{[\s\S]*?\n  \}/);
    return !!fn && fn[0].includes('rs.flowTriggerStates = {};');
  })());
check('index.html loads hydra-dispatch.js before player-runtime.js and script.js',
  indexSrc.indexOf('src="hydra-dispatch.js') !== -1 &&
  indexSrc.indexOf('src="hydra-dispatch.js') < indexSrc.indexOf('src="player-runtime.js') &&
  indexSrc.indexOf('src="hydra-dispatch.js') < indexSrc.indexOf('src="script.js'));

if (failures) { console.error(`${failures} assertion(s) failed`); process.exit(1); }
console.log('dispatch.test.js: all assertions passed');
