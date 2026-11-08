// Unit tests for hydra/hydra-loops.js — the shared loop state machine
// (P5 core-engine track, item P5-4: Control flow + events, slice a —
// Repeat, While, Break, Continue).
//
// Pure logic: the loop caps (Repeat 1000, While 1000 iterations,
// 8-deep nesting, 10,000 body actions per frame), the comparison
// operators, the loop state (depth, Break / Continue flag, budget),
// and the execute entry point that drives a body chain through the
// flow module's runBody callback. The dispatch integration at the end
// runs real grids through HydraDispatch + HydraFlow + HydraExecute,
// so the queue-pull fix (a same-row trigger must not run the body
// once more after the loop) is pinned by behavior, not by reading
// the code. Static checks at the end pin the wiring: catalog blocks,
// both runtimes' dispatch and action contexts, the export inlining
// list, and the docs.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HYDRA = path.join(__dirname, '..', 'hydra');
const REPO = path.join(__dirname, '..');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const sandbox = {};
sandbox.window = sandbox; // hydra-*.js assign to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-loops.js'), 'utf8'),
  sandbox, { filename: 'hydra-loops.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-tags.js'), 'utf8'),
  sandbox, { filename: 'hydra-tags.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-expr.js'), 'utf8'),
  sandbox, { filename: 'hydra-expr.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-flow.js'), 'utf8'),
  sandbox, { filename: 'hydra-flow.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-dispatch.js'), 'utf8'),
  sandbox, { filename: 'hydra-dispatch.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-execute.js'), 'utf8'),
  sandbox, { filename: 'hydra-execute.js' });
const L = sandbox.HydraLoops;
const T = sandbox.HydraTags;
const E = sandbox.HydraExpr;
const FL = sandbox.HydraFlow;
const D = sandbox.HydraDispatch;
const X = sandbox.HydraExecute;

check('HydraLoops exposed with helpers',
  !!L && typeof L.isLoopAction === 'function' &&
  typeof L.isLoopBlock === 'function' &&
  typeof L.compare === 'function' &&
  typeof L.normalizeCount === 'function' &&
  typeof L.normalizeForEachItems === 'function' &&
  typeof L.createLoopState === 'function' &&
  typeof L.resetLoopBudget === 'function' &&
  typeof L.loopDepth === 'function' &&
  typeof L.controlOf === 'function' &&
  typeof L.clearControl === 'function' &&
  typeof L.requestBreak === 'function' &&
  typeof L.requestContinue === 'function' &&
  typeof L.beginLoop === 'function' &&
  typeof L.endLoop === 'function' &&
  typeof L.consumeBudget === 'function' &&
  typeof L.budgetLeft === 'function');
check('factorySource is a non-empty string',
  typeof L.factorySource === 'string' && L.factorySource.length > 100 &&
  L.factorySource.includes('hydraLoopsFactory'));
check('caps are 1000 / 1000 / 8 / 10000, for-each caps at 1000 items',
  L.MAX_REPEAT === 1000 && L.MAX_WHILE_ITERATIONS === 1000 &&
  L.MAX_LOOP_DEPTH === 8 && L.MAX_LOOP_ACTIONS_PER_FRAME === 10000 &&
  L.MAX_FOR_EACH_ITEMS === 1000);

// --- classification ---
check('isLoopAction names the eight loop blocks',
  L.isLoopAction('repeatTimes') && L.isLoopAction('whileLoop') &&
  L.isLoopAction('breakLoop') && L.isLoopAction('continueLoop') &&
  L.isLoopAction('forEachList') && L.isLoopAction('forEachObject') &&
  L.isLoopAction('forEachTagged') && L.isLoopAction('forEachField') &&
  !L.isLoopAction('setVariable') && !L.isLoopAction('callFunction') &&
  !L.isLoopAction('always') && !L.isLoopAction(null));
check('isLoopBlock names only the six body-running loops',
  L.isLoopBlock('repeatTimes') && L.isLoopBlock('whileLoop') &&
  L.isLoopBlock('forEachList') && L.isLoopBlock('forEachObject') &&
  L.isLoopBlock('forEachTagged') && L.isLoopBlock('forEachField') &&
  !L.isLoopBlock('breakLoop') && !L.isLoopBlock('continueLoop') &&
  !L.isLoopBlock('setVariable'));

// --- comparison ---
check('compare covers the six operators and rejects unknown ones',
  L.compare(3, '<', 5) && !L.compare(5, '<', 3) &&
  L.compare(5, '>', 3) && !L.compare(3, '>', 5) &&
  L.compare(5, '>=', 5) && L.compare(5, '<=', 5) &&
  L.compare(5, '==', 5) && !L.compare(5, '==', 4) &&
  L.compare(5, '!=', 4) && !L.compare(5, '!=', 5) &&
  !L.compare(5, '??', 5) && !L.compare(5, '', 5) && !L.compare(5, null, 5));

// --- normalizeCount ---
check('normalizeCount floors and clamps to [0, 1000] with the original kept',
  L.normalizeCount(3).count === 3 && !L.normalizeCount(3).clamped &&
  L.normalizeCount(3.7).count === 3 && L.normalizeCount(3.7).original === 3.7 &&
  L.normalizeCount(1500).count === 1000 && L.normalizeCount(1500).clamped &&
  L.normalizeCount(1500).original === 1500 &&
  L.normalizeCount(-2).count === 0 && L.normalizeCount(-2).clamped &&
  L.normalizeCount(0).count === 0 && !L.normalizeCount(0).clamped &&
  L.normalizeCount('7').count === 7);
check('normalizeCount rejects non-finite values',
  !L.normalizeCount(NaN).ok && !L.normalizeCount(Infinity).ok &&
  !L.normalizeCount('score +').ok && !L.normalizeCount(undefined).ok);

// --- normalizeForEachItems (slice b) ---
check('normalizeForEachItems snapshots the list and caps it at 1000',
  (() => {
    const big = [];
    for (let i = 0; i < 1005; i++) big.push(i);
    const n = L.normalizeForEachItems(big);
    if (!n.ok || n.total !== 1005 || !n.capped || n.items.length !== 1000) return false;
    if (n.items[999] !== 999) return false;
    // The snapshot is a copy: mutating the source list after
    // normalizing leaves the snapshot alone.
    big.push(1005);
    if (n.items.length !== 1000) return false;
    const small = L.normalizeForEachItems(['a', 'b']);
    return small.ok && !small.capped && small.total === 2 && small.items.join(',') === 'a,b' &&
      L.normalizeForEachItems([]).ok && L.normalizeForEachItems([]).items.length === 0;
  })());
check('normalizeForEachItems rejects non-lists (a dict is not a list)',
  !L.normalizeForEachItems({ a: 1 }).ok && !L.normalizeForEachItems(5).ok &&
  !L.normalizeForEachItems('abc').ok && !L.normalizeForEachItems(null).ok &&
  !L.normalizeForEachItems(undefined).ok);

// --- loop state ---
check('createLoopState starts at depth 0, no control, full budget',
  (() => { const s = L.createLoopState(); return s.depth === 0 && s.control === null && s.budget === 10000; })());
check('begin/endLoop count depth and cap at 8',
  (() => {
    const s = L.createLoopState();
    for (let i = 0; i < 8; i++) if (!L.beginLoop(s)) return false;
    if (L.beginLoop(s)) return false;
    if (L.loopDepth(s) !== 8) return false;
    L.endLoop(s);
    if (L.loopDepth(s) !== 7) return false;
    if (!L.beginLoop(s)) return false;
    for (let i = 0; i < 9; i++) L.endLoop(s);
    return L.loopDepth(s) === 0;
  })());
check('requestBreak / requestContinue need a live loop and set the flag',
  (() => {
    const s = L.createLoopState();
    if (L.requestBreak(s) || L.requestContinue(s)) return false;
    if (!L.beginLoop(s)) return false;
    if (!L.requestBreak(s) || L.controlOf(s) !== 'break') return false;
    L.clearControl(s);
    if (L.controlOf(s) !== null) return false;
    if (!L.requestContinue(s) || L.controlOf(s) !== 'continue') return false;
    L.endLoop(s);
    return true;
  })());
check('consumeBudget spends and reports exhaustion; reset restores it',
  (() => {
    const s = L.createLoopState();
    if (!L.consumeBudget(s, 9999) || L.budgetLeft(s) !== 1) return false;
    if (!L.consumeBudget(s, 1) || L.budgetLeft(s) !== 0) return false;
    if (L.consumeBudget(s, 1)) return false;
    if (!L.resetLoopBudget(s) || L.budgetLeft(s) !== 10000) return false;
    if (L.loopDepth(s) !== 0 || L.controlOf(s) !== null) return false;
    return true;
  })());
check('hostile state degrades to safe defaults',
  L.loopDepth(null) === 0 && L.controlOf(null) === null &&
  L.budgetLeft(null) === 10000 && !L.beginLoop(null) &&
  !L.requestBreak(null) && L.consumeBudget(null, 5) === true &&
  !L.resetLoopBudget(null) && !L.resetLoopBudget({}));

// --- executeLoopAction with a fake body runner (no dispatch) ---
function fakeCtx(vars, warnings, objectsByName) {
  const loopState = L.createLoopState();
  const execSeen = [];
  const ctx = {
    variables: vars,
    expr: function (v) { return E.evaluate(v, { variables: vars }).value; },
    exprInfo: function (v) { return E.evaluate(v, { variables: vars }); },
    warn: function (m) { warnings.push(m); },
    loopsModule: L,
    loopState: loopState,
    executionContext: null,
    // Slice b (for-each): live objects by name, and the execution
    // context the object loop points at each object in turn.
    named: function (name) {
      const pool = objectsByName && objectsByName[name];
      return Array.isArray(pool) ? pool.slice() : [];
    },
    // Batch 35 (pick objects by tag): the tag loop reads the live
    // objects through the tags module, and holds the round's object
    // in a flat handle when the Object variable is named.
    tagsModule: T,
    allObjects: function () {
      const all = [];
      if (objectsByName) Object.keys(objectsByName).forEach(function (k) {
        (objectsByName[k] || []).forEach(function (o) { all.push(o); });
      });
      return all;
    },
    varScopesModule: {
      objectRefOf: function (o) { return { __objectRef: true, name: o.name, id: String(o.id) }; }
    },
    setExecutionContext: function (c) {
      ctx.executionContext = c || null;
      execSeen.push(c && c.obj1 ? c.obj1.id : null);
    },
    _execSeen: execSeen
  };
  return ctx;
}
check('HydraExecute exposes executeLoopAction',
  typeof X.executeLoopAction === 'function');

check('Repeat runs the body N times with a 1-based counter',
  (() => {
    const vars = {}; const warnings = [];
    const ctx = fakeCtx(vars, warnings);
    let runs = 0; const seen = [];
    X.executeLoopAction({ type: 'repeatTimes', count: '3', counterVar: 'i' }, ctx, 0,
      function () { runs++; seen.push(vars.i); return [1]; });
    return runs === 3 && vars.i === 3 && seen.join(',') === '1,2,3' && warnings.length === 0;
  })());
check('Repeat with no counter variable still runs N times',
  (() => {
    const vars = {}; const warnings = [];
    const ctx = fakeCtx(vars, warnings);
    let runs = 0;
    X.executeLoopAction({ type: 'repeatTimes', count: '2', counterVar: '' }, ctx, 0,
      function () { runs++; return [1]; });
    return runs === 2 && vars.i === undefined && warnings.length === 0;
  })());
check('Repeat with a bad count warns and never runs the body',
  (() => {
    const vars = {}; const warnings = [];
    const ctx = fakeCtx(vars, warnings);
    let runs = 0;
    X.executeLoopAction({ type: 'repeatTimes', count: 'score +', counterVar: '' }, ctx, 0,
      function () { runs++; return [1]; });
    return runs === 0 && warnings.length === 1 && /not a number/.test(warnings[0]);
  })());
check('Repeat past the cap runs 1000 times and warns once',
  (() => {
    const vars = {}; const warnings = [];
    const ctx = fakeCtx(vars, warnings);
    let runs = 0;
    X.executeLoopAction({ type: 'repeatTimes', count: '1500', counterVar: '' }, ctx, 0,
      function () { runs++; return [1]; });
    return runs === 1000 && warnings.length === 1 && /1500/.test(warnings[0]) && /1000/.test(warnings[0]);
  })());
check('While runs until its test stops holding',
  (() => {
    const vars = { i: 0 }; const warnings = [];
    const ctx = fakeCtx(vars, warnings);
    let runs = 0;
    X.executeLoopAction({ type: 'whileLoop', left: 'i', operator: '<', right: '4' }, ctx, 0,
      function () { runs++; vars.i++; return [1]; });
    return runs === 4 && vars.i === 4 && warnings.length === 0;
  })());
check('While with a test that never changes stops at 1000 with a warning',
  (() => {
    const vars = { i: 0 }; const warnings = [];
    const ctx = fakeCtx(vars, warnings);
    let runs = 0;
    X.executeLoopAction({ type: 'whileLoop', left: 'i', operator: '<', right: '5' }, ctx, 0,
      function () { runs++; return [1]; });
    return runs === 1000 && warnings.length === 1 && /1000/.test(warnings[0]);
  })());
check('While with a bad test warns and never runs the body',
  (() => {
    const vars = {}; const warnings = [];
    const ctx = fakeCtx(vars, warnings);
    let runs = 0;
    X.executeLoopAction({ type: 'whileLoop', left: 'score +', operator: '<', right: '5' }, ctx, 0,
      function () { runs++; return [1]; });
    return runs === 0 && warnings.length === 1 && /could not be evaluated/.test(warnings[0]);
  })());
check('Break stops the loop after the current body run; Continue starts the next one',
  (() => {
    const vars = {}; const warnings = [];
    const ctx = fakeCtx(vars, warnings);
    let runs = 0;
    X.executeLoopAction({ type: 'repeatTimes', count: '5', counterVar: '' }, ctx, 0,
      function () { runs++; L.requestBreak(ctx.loopState); return [1, 2]; });
    if (runs !== 1) return false;
    runs = 0;
    X.executeLoopAction({ type: 'repeatTimes', count: '3', counterVar: '' }, ctx, 0,
      function () { runs++; L.requestContinue(ctx.loopState); return [1]; });
    return runs === 3 && L.loopDepth(ctx.loopState) === 0 && L.controlOf(ctx.loopState) === null;
  })());
check('Break / Continue outside a loop warn and do nothing (plain actions)',
  (() => {
    const vars = {}; const warnings = [];
    const ctx = fakeCtx(vars, warnings);
    X.executeAction({ type: 'breakLoop' }, ctx, 0);
    X.executeAction({ type: 'continueLoop' }, ctx, 1);
    return warnings.length === 2 && /only works inside/.test(warnings[0]) &&
      /only works inside/.test(warnings[1]) && L.controlOf(ctx.loopState) === null;
  })());
check('Repeat / While through plain executeAction stay quiet (no loop runner)',
  (() => {
    const vars = {}; const warnings = [];
    const ctx = fakeCtx(vars, warnings);
    X.executeAction({ type: 'repeatTimes', count: '3' }, ctx, 0);
    X.executeAction({ type: 'whileLoop', left: 'i', operator: '<', right: '5' }, ctx, 1);
    return warnings.length === 0;
  })());
check('executeLoopAction reports ownership: true when it ran, false when skipped',
  (() => {
    const vars = {}; const warnings = [];
    const ctx = fakeCtx(vars, warnings);
    const ran = X.executeLoopAction({ type: 'repeatTimes', count: '2', counterVar: '' }, ctx, 0,
      function () { return [1]; });
    if (ran !== true) return false;
    const s = ctx.loopState;
    for (let i = 0; i < 8; i++) L.beginLoop(s);
    const skipped = X.executeLoopAction({ type: 'repeatTimes', count: '2', counterVar: '' }, ctx, 0,
      function () { return [1]; });
    for (let i = 0; i < 8; i++) L.endLoop(s);
    return skipped === false;
  })());
check('a loop deeper than 8 is skipped with a warning',
  (() => {
    const vars = {}; const warnings = [];
    const ctx = fakeCtx(vars, warnings);
    const s = ctx.loopState;
    for (let i = 0; i < 8; i++) L.beginLoop(s);
    let runs = 0;
    X.executeLoopAction({ type: 'repeatTimes', count: '2', counterVar: '' }, ctx, 0,
      function () { runs++; return [1]; });
    for (let i = 0; i < 8; i++) L.endLoop(s);
    return runs === 0 && warnings.length === 1 && /more than 8 deep/.test(warnings[0]) &&
      L.loopDepth(s) === 0;
  })());

// --- slice b (for-each): executeLoopAction with a fake body runner ---
check('For Each Item runs the body once per item with the item and a 1-based index',
  (() => {
    const vars = { deck: [10, 20, 30] }; const warnings = [];
    const ctx = fakeCtx(vars, warnings);
    let runs = 0; const seen = []; const idxSeen = [];
    X.executeLoopAction({ type: 'forEachList', listVar: 'deck', itemVar: 'card', indexVar: 'n' }, ctx, 0,
      function () { runs++; seen.push(vars.card); idxSeen.push(vars.n); return [1]; });
    return runs === 3 && seen.join(',') === '10,20,30' && idxSeen.join(',') === '1,2,3' &&
      vars.card === 30 && vars.n === 3 && warnings.length === 0;
  })());
check('For Each Item with no item or index variable still runs once per item',
  (() => {
    const vars = { deck: ['a', 'b'] }; const warnings = [];
    const ctx = fakeCtx(vars, warnings);
    let runs = 0;
    X.executeLoopAction({ type: 'forEachList', listVar: 'deck', itemVar: '', indexVar: '' }, ctx, 0,
      function () { runs++; return [1]; });
    return runs === 2 && warnings.length === 0;
  })());
check('For Each Item over an empty list runs nothing and warns nothing',
  (() => {
    const vars = { deck: [] }; const warnings = [];
    const ctx = fakeCtx(vars, warnings);
    let runs = 0;
    X.executeLoopAction({ type: 'forEachList', listVar: 'deck', itemVar: 'card', indexVar: '' }, ctx, 0,
      function () { runs++; return [1]; });
    return runs === 0 && warnings.length === 0 && vars.card === undefined;
  })());
check('For Each Item warns and holds on a blank list name, a missing list, or a non-list',
  (() => {
    const vars = { score: 5, player: { gold: 10 } }; const warnings = [];
    const ctx = fakeCtx(vars, warnings);
    let runs = 0;
    const run = function () { runs++; return [1]; };
    X.executeLoopAction({ type: 'forEachList', listVar: '', itemVar: 'item', indexVar: '' }, ctx, 0, run);
    X.executeLoopAction({ type: 'forEachList', listVar: 'missing', itemVar: 'item', indexVar: '' }, ctx, 0, run);
    X.executeLoopAction({ type: 'forEachList', listVar: 'score', itemVar: 'item', indexVar: '' }, ctx, 0, run);
    X.executeLoopAction({ type: 'forEachList', listVar: 'player', itemVar: 'item', indexVar: '' }, ctx, 0, run);
    return runs === 0 && warnings.length === 4 &&
      /blank/.test(warnings[0]) && /not a list/.test(warnings[1]) &&
      /not a list/.test(warnings[2]) && /not a list/.test(warnings[3]);
  })());
check('For Each Item over 1005 items runs the first 1000 and warns once',
  (() => {
    const deck = [];
    for (let i = 0; i < 1005; i++) deck.push(i);
    const vars = { deck: deck }; const warnings = [];
    const ctx = fakeCtx(vars, warnings);
    let runs = 0;
    X.executeLoopAction({ type: 'forEachList', listVar: 'deck', itemVar: 'card', indexVar: '' }, ctx, 0,
      function () { runs++; return [1]; });
    return runs === 1000 && warnings.length === 1 && /1005/.test(warnings[0]) && /first 1000/.test(warnings[0]);
  })());
check('For Each Item snapshots the list: a body that pushes does not extend the run',
  (() => {
    const vars = { deck: [1, 2, 3] }; const warnings = [];
    const ctx = fakeCtx(vars, warnings);
    let runs = 0;
    X.executeLoopAction({ type: 'forEachList', listVar: 'deck', itemVar: 'card', indexVar: '' }, ctx, 0,
      function () { runs++; vars.deck.push(99); return [1]; });
    return runs === 3 && vars.deck.length === 6 && warnings.length === 0;
  })());
check('For Each Item honors Break and the per-frame budget',
  (() => {
    const vars = { deck: [1, 2, 3, 4, 5] }; const warnings = [];
    const ctx = fakeCtx(vars, warnings);
    let runs = 0;
    X.executeLoopAction({ type: 'forEachList', listVar: 'deck', itemVar: 'card', indexVar: '' }, ctx, 0,
      function () { runs++; if (runs === 2) L.requestBreak(ctx.loopState); return [1]; });
    if (runs !== 2) return false;
    // A fresh loop with a fully spent budget stops after the first body run.
    const vars2 = { deck: [1, 2, 3] }; const warnings2 = [];
    const ctx2 = fakeCtx(vars2, warnings2);
    L.consumeBudget(ctx2.loopState, 10000);
    let runs2 = 0;
    X.executeLoopAction({ type: 'forEachList', listVar: 'deck', itemVar: 'card', indexVar: '' }, ctx2, 0,
      function () { runs2++; return [1]; });
    return runs2 === 1 && warnings2.some(function (w) { return /per-frame budget/.test(w); });
  })());
check('For Each Object runs once per live object, pointing the execution context at each in order',
  (() => {
    const vars = {}; const warnings = [];
    const coins = [{ id: 11, name: 'coin' }, { id: 12, name: 'coin' }, { id: 13, name: 'coin' }];
    const ctx = fakeCtx(vars, warnings, { coin: coins });
    ctx.executionContext = { obj1: { id: 99, name: 'player' } };
    let runs = 0; const seen = []; const idxSeen = [];
    X.executeLoopAction({ type: 'forEachObject', objectName: 'coin', indexVar: 'n' }, ctx, 0,
      function () {
        runs++;
        seen.push(ctx.executionContext && ctx.executionContext.obj1 ? ctx.executionContext.obj1.id : null);
        idxSeen.push(vars.n);
        return [1];
      });
    return runs === 3 && seen.join(',') === '11,12,13' && idxSeen.join(',') === '1,2,3' &&
      ctx._execSeen.join(',') === '11,99,12,99,13,99' &&
      ctx.executionContext && ctx.executionContext.obj1 && ctx.executionContext.obj1.id === 99 &&
      warnings.length === 0;
  })());
check('For Each Object with no live objects runs nothing and warns nothing',
  (() => {
    const vars = {}; const warnings = [];
    const ctx = fakeCtx(vars, warnings, { coin: [] });
    let runs = 0;
    X.executeLoopAction({ type: 'forEachObject', objectName: 'coin', indexVar: '' }, ctx, 0,
      function () { runs++; return [1]; });
    return runs === 0 && warnings.length === 0;
  })());
check('For Each Object warns and holds on a blank object name',
  (() => {
    const vars = {}; const warnings = [];
    const ctx = fakeCtx(vars, warnings, {});
    let runs = 0;
    X.executeLoopAction({ type: 'forEachObject', objectName: '', indexVar: '' }, ctx, 0,
      function () { runs++; return [1]; });
    return runs === 0 && warnings.length === 1 && /no object is named/.test(warnings[0]);
  })());
check('For Each Object over 1005 live objects runs the first 1000 and warns once',
  (() => {
    const coins = [];
    for (let i = 0; i < 1005; i++) coins.push({ id: i, name: 'coin' });
    const vars = {}; const warnings = [];
    const ctx = fakeCtx(vars, warnings, { coin: coins });
    let runs = 0;
    X.executeLoopAction({ type: 'forEachObject', objectName: 'coin', indexVar: '' }, ctx, 0,
      function () { runs++; return [1]; });
    return runs === 1000 && warnings.length === 1 && /1005/.test(warnings[0]) && /first 1000/.test(warnings[0]);
  })());
check('For Each Object without the context hook warns once and still runs the body',
  (() => {
    const vars = {}; const warnings = [];
    const ctx = fakeCtx(vars, warnings, { coin: [{ id: 11, name: 'coin' }] });
    delete ctx.setExecutionContext;
    let runs = 0;
    X.executeLoopAction({ type: 'forEachObject', objectName: 'coin', indexVar: '' }, ctx, 0,
      function () { runs++; return [1]; });
    return runs === 1 && warnings.length === 1 && /cannot point actions/.test(warnings[0]);
  })());
check('For Each Item / Object through plain executeAction stay quiet (no loop runner)',
  (() => {
    const vars = { deck: [1, 2] }; const warnings = [];
    const ctx = fakeCtx(vars, warnings, { coin: [{ id: 1, name: 'coin' }] });
    X.executeAction({ type: 'forEachList', listVar: 'deck', itemVar: 'card' }, ctx, 0);
    X.executeAction({ type: 'forEachObject', objectName: 'coin' }, ctx, 1);
    return warnings.length === 0;
  })());
check('a For Each Object nested past 8 deep is skipped with the For Each name in the warning',
  (() => {
    const vars = {}; const warnings = [];
    const ctx = fakeCtx(vars, warnings, { coin: [{ id: 1, name: 'coin' }] });
    const s = ctx.loopState;
    for (let i = 0; i < 8; i++) L.beginLoop(s);
    let runs = 0;
    const ran = X.executeLoopAction({ type: 'forEachObject', objectName: 'coin', indexVar: '' }, ctx, 0,
      function () { runs++; return [1]; });
    for (let i = 0; i < 8; i++) L.endLoop(s);
    return ran === false && runs === 0 && warnings.length === 1 &&
      /For Each Object/.test(warnings[0]) && /more than 8 deep/.test(warnings[0]);
  })());

// --- batch 35 (pick objects by tag): For Each Tagged Object ---
function taggedCtx(vars, warnings, tagged, opts) {
  const o = opts || {};
  const ctx = fakeCtx(vars, warnings);
  if (o.noTagsModule) delete ctx.tagsModule;
  else ctx.tagsModule = T;
  ctx.allObjects = function () { return tagged.slice(); };
  if (!o.noVarScopes) {
    ctx.varScopesModule = {
      objectRefOf: function (obj) {
        return { __objectRef: true, name: obj.name, id: String(obj.id) };
      }
    };
  } else delete ctx.varScopesModule;
  if (o.noSetCtx) delete ctx.setExecutionContext;
  return ctx;
}
const tgGoblin = { id: 11, name: 'goblin', tags: ['goblin'] };
const tgGoblin2 = { id: 12, name: 'goblin2', tags: ['Goblin'] };
const tgOrc = { id: 13, name: 'orc', tags: ['enemy', 'goblin'] };
const tgCoin = { id: 14, name: 'coin', tags: ['coin'] };
check('For Each Tagged Object runs once per live tagged object, pointing the context and the object variable at each in order',
  (() => {
    const vars = {}; const warnings = [];
    const ctx = taggedCtx(vars, warnings, [tgGoblin, tgGoblin2, tgOrc, tgCoin]);
    ctx.executionContext = { obj1: { id: 99, name: 'player' } };
    let runs = 0; const seen = []; const idxSeen = []; const foeSeen = [];
    X.executeLoopAction({ type: 'forEachTagged', tag: 'goblin', objVar: 'foe', indexVar: 'n' }, ctx, 0,
      function () {
        runs++;
        seen.push(ctx.executionContext && ctx.executionContext.obj1 ? ctx.executionContext.obj1.id : null);
        idxSeen.push(vars.n);
        foeSeen.push(vars.foe && vars.foe.name);
        return [1];
      });
    return runs === 3 && seen.join(',') === '11,12,13' && idxSeen.join(',') === '1,2,3' &&
      foeSeen.join(',') === 'goblin,goblin2,orc' &&
      ctx._execSeen.join(',') === '11,99,12,99,13,99' &&
      ctx.executionContext && ctx.executionContext.obj1 && ctx.executionContext.obj1.id === 99 &&
      vars.foe && vars.foe.name === 'orc' && warnings.length === 0;
  })());
check('For Each Tagged Object with no live tagged objects runs nothing and warns nothing',
  (() => {
    const vars = {}; const warnings = [];
    const ctx = taggedCtx(vars, warnings, [tgCoin]);
    let runs = 0;
    X.executeLoopAction({ type: 'forEachTagged', tag: 'goblin', objVar: '', indexVar: '' }, ctx, 0,
      function () { runs++; return [1]; });
    return runs === 0 && warnings.length === 0;
  })());
check('For Each Tagged Object warns and holds on a blank tag',
  (() => {
    const vars = {}; const warnings = [];
    const ctx = taggedCtx(vars, warnings, [tgGoblin]);
    let runs = 0;
    X.executeLoopAction({ type: 'forEachTagged', tag: '', objVar: '', indexVar: '' }, ctx, 0,
      function () { runs++; return [1]; });
    return runs === 0 && warnings.length === 1 && /no tag is named/.test(warnings[0]);
  })());
check('For Each Tagged Object over 1005 live tagged objects runs the first 1000 and warns once',
  (() => {
    const many = [];
    for (let i = 0; i < 1005; i++) many.push({ id: i, name: 'goblin', tags: ['goblin'] });
    const vars = {}; const warnings = [];
    const ctx = taggedCtx(vars, warnings, many);
    let runs = 0;
    X.executeLoopAction({ type: 'forEachTagged', tag: 'goblin', objVar: '', indexVar: '' }, ctx, 0,
      function () { runs++; return [1]; });
    return runs === 1000 && warnings.length === 1 && /1005/.test(warnings[0]) && /first 1000/.test(warnings[0]);
  })());
check('For Each Tagged Object snapshots the group: a body that tags another object does not extend the run',
  (() => {
    const vars = {}; const warnings = [];
    const live = [Object.assign({}, tgGoblin), Object.assign({}, tgGoblin2), Object.assign({}, tgCoin)];
    const ctx = taggedCtx(vars, warnings, live);
    let runs = 0;
    X.executeLoopAction({ type: 'forEachTagged', tag: 'goblin', objVar: '', indexVar: '' }, ctx, 0,
      function () { runs++; live[2].tags = ['goblin']; return [1]; });
    return runs === 2 && warnings.length === 0;
  })());
check('For Each Tagged Object without the context hook warns once and still runs the body',
  (() => {
    const vars = {}; const warnings = [];
    const ctx = taggedCtx(vars, warnings, [tgGoblin], { noSetCtx: true });
    let runs = 0;
    X.executeLoopAction({ type: 'forEachTagged', tag: 'goblin', objVar: '', indexVar: '' }, ctx, 0,
      function () { runs++; return [1]; });
    return runs === 1 && warnings.length === 1 && /cannot point actions/.test(warnings[0]);
  })());
check('For Each Tagged Object with an object variable but no variables module warns once and still runs',
  (() => {
    const vars = {}; const warnings = [];
    const ctx = taggedCtx(vars, warnings, [tgGoblin], { noVarScopes: true });
    let runs = 0;
    X.executeLoopAction({ type: 'forEachTagged', tag: 'goblin', objVar: 'foe', indexVar: '' }, ctx, 0,
      function () { runs++; return [1]; });
    return runs === 1 && warnings.length === 1 && /cannot hold the object in a variable/.test(warnings[0]) &&
      vars.foe === undefined;
  })());
check('For Each Tagged Object without the tags module reads the raw tags arrays the same way',
  (() => {
    const vars = {}; const warnings = [];
    const ctx = taggedCtx(vars, warnings, [tgGoblin, tgGoblin2, tgCoin], { noTagsModule: true });
    let runs = 0; const seen = [];
    X.executeLoopAction({ type: 'forEachTagged', tag: 'GOBLIN', objVar: '', indexVar: '' }, ctx, 0,
      function () {
        runs++;
        seen.push(ctx.executionContext && ctx.executionContext.obj1 ? ctx.executionContext.obj1.id : null);
        return [1];
      });
    return runs === 2 && seen.join(',') === '11,12' && warnings.length === 0;
  })());
check('For Each Tagged Object honors Break and the per-frame budget',
  (() => {
    const vars = {}; const warnings = [];
    const ctx = taggedCtx(vars, warnings, [tgGoblin, tgGoblin2, tgOrc]);
    let runs = 0;
    X.executeLoopAction({ type: 'forEachTagged', tag: 'goblin', objVar: '', indexVar: '' }, ctx, 0,
      function () { runs++; if (runs === 2) L.requestBreak(ctx.loopState); return [1]; });
    if (runs !== 2) return false;
    const vars2 = {}; const warnings2 = [];
    const ctx2 = taggedCtx(vars2, warnings2, [tgGoblin, tgGoblin2, tgOrc]);
    L.consumeBudget(ctx2.loopState, 10000);
    let runs2 = 0;
    X.executeLoopAction({ type: 'forEachTagged', tag: 'goblin', objVar: '', indexVar: '' }, ctx2, 0,
      function () { runs2++; return [1]; });
    return runs2 === 1 && warnings2.some(function (w) { return /per-frame budget/.test(w); });
  })());
check('For Each Tagged Object through plain executeAction stays quiet (no loop runner)',
  (() => {
    const vars = {}; const warnings = [];
    const ctx = taggedCtx(vars, warnings, [tgGoblin]);
    X.executeAction({ type: 'forEachTagged', tag: 'goblin' }, ctx, 0);
    return warnings.length === 0;
  })());
check('a For Each Tagged Object nested past 8 deep is skipped with the For Each name in the warning',
  (() => {
    const vars = {}; const warnings = [];
    const ctx = taggedCtx(vars, warnings, [tgGoblin]);
    const s = ctx.loopState;
    for (let i = 0; i < 8; i++) L.beginLoop(s);
    let runs = 0;
    const ran = X.executeLoopAction({ type: 'forEachTagged', tag: 'goblin', objVar: '', indexVar: '' }, ctx, 0,
      function () { runs++; return [1]; });
    for (let i = 0; i < 8; i++) L.endLoop(s);
    return ran === false && runs === 0 && warnings.length === 1 &&
      /For Each Tagged Object/.test(warnings[0]) && /more than 8 deep/.test(warnings[0]);
  })());

// --- dispatch integration: real grids through HydraDispatch + HydraFlow ---
function makeHost(grid, objectsByName) {
  const vars = {};
  const warnings = [];
  const loopState = L.createLoopState();
  const flowTriggerStates = {};
  const startedScopes = new Set();
  const execSeen = [];
  const ctx = {
    variables: vars,
    expr: function (v) { return E.evaluate(v, { variables: vars }).value; },
    exprInfo: function (v) { return E.evaluate(v, { variables: vars }); },
    warn: function (m) { warnings.push(m); },
    loopsModule: L,
    loopState: loopState,
    executionContext: null,
    // Slice b (for-each): live objects by name, and the execution
    // context the object loop points at each object in turn.
    named: function (name) {
      const pool = objectsByName && objectsByName[name];
      return Array.isArray(pool) ? pool.slice() : [];
    },
    // Batch 35 (pick objects by tag): the tag loop reads the live
    // objects through the tags module, and holds the round's object
    // in a flat handle when the Object variable is named.
    tagsModule: T,
    allObjects: function () {
      const all = [];
      if (objectsByName) Object.keys(objectsByName).forEach(function (k) {
        (objectsByName[k] || []).forEach(function (o) { all.push(o); });
      });
      return all;
    },
    varScopesModule: {
      objectRefOf: function (o) { return { __objectRef: true, name: o.name, id: String(o.id) }; }
    },
    setExecutionContext: function (c) {
      ctx.executionContext = c || null;
      execSeen.push(c && c.obj1 ? c.obj1.id : null);
    }
  };
  function isCond(t) { return t === 'gameStart' || t === 'always'; }
  function isAct(t) { return t === 'setVariable' || t === 'probeCurrentObject' || L.isLoopAction(t); }
  const hooks = {
    flow: FL,
    trace: null, traceState: null, frameId: 0,
    isCondition: isCond, isAction: isAct, isComment: function (t) { return t === 'comment'; },
    evaluate: function (idx, data) {
      if (data.type === 'always') return { triggered: true, context: {} };
      if (data.type === 'gameStart') return { triggered: !startedScopes.has('test'), context: {} };
      return { triggered: false, context: {} };
    },
    // probeCurrentObject is a harness-only action: it records the id
    // of the object the execution context currently points at, so a
    // dispatch test can see which object a For Each Object body run
    // acted on.
    execute: function (idx, data) {
      if (data.type === 'probeCurrentObject') {
        const o = ctx.executionContext && ctx.executionContext.obj1;
        vars.probed = (vars.probed || []).concat(o ? o.id : null);
        return;
      }
      X.executeAction(data, ctx, idx);
    },
    isLoopBlock: function (t) { return L.isLoopBlock(t); },
    executeLoop: function (idx, data, runBody) { return X.executeLoopAction(data, ctx, idx, runBody); },
    shouldAbort: function () { return L.controlOf(loopState) !== null; },
    flowTriggerStates: flowTriggerStates,
    startedScopes: startedScopes,
    onTriggered: function () {},
    onPropagateCondition: function () {},
    reportUnknown: function (t) { warnings.push('unknown ' + t); }
  };
  return {
    vars: vars, warnings: warnings, loopState: loopState, execSeen: execSeen,
    run: function () { D.processScope(grid, 'test', hooks); }
  };
}

check('dispatch: Repeat on one row with its trigger runs the body exactly N times (no +1)',
  (() => {
    const h = makeHost({
      0: { type: 'always', kind: 'condition' },
      1: { type: 'repeatTimes', kind: 'action', count: '3', counterVar: '' },
      2: { type: 'setVariable', kind: 'action', varName: 'total', operation: 'add', value: 1 }
    });
    h.run();
    return h.vars.total === 3 && h.warnings.length === 0;
  })());
check('dispatch: trigger above, loop below, body to the right runs N times',
  (() => {
    const h = makeHost({
      0: { type: 'always', kind: 'condition' },
      60: { type: 'repeatTimes', kind: 'action', count: '4', counterVar: 'i' },
      61: { type: 'setVariable', kind: 'action', varName: 'seen', operation: 'set', value: 'i' },
      62: { type: 'setVariable', kind: 'action', varName: 'total', operation: 'add', value: 1 }
    });
    h.run();
    return h.vars.total === 4 && h.vars.seen === 4 && h.vars.i === 4 && h.warnings.length === 0;
  })());
check('dispatch: While with a body that changes the test stops at the right value',
  (() => {
    const h = makeHost({
      0: { type: 'always', kind: 'condition' },
      60: { type: 'whileLoop', kind: 'action', left: 'i', operator: '<', right: '5' },
      61: { type: 'setVariable', kind: 'action', varName: 'i', operation: 'add', value: 1 },
      62: { type: 'setVariable', kind: 'action', varName: 'hits', operation: 'add', value: 1 }
    });
    h.vars.i = 0;
    h.run();
    return h.vars.i === 5 && h.vars.hits === 5 && h.warnings.length === 0;
  })());
check('dispatch: Break inside the body stops the loop and skips the rest of the round',
  (() => {
    const h = makeHost({
      0: { type: 'always', kind: 'condition' },
      60: { type: 'repeatTimes', kind: 'action', count: '5', counterVar: '' },
      61: { type: 'setVariable', kind: 'action', varName: 'hits', operation: 'add', value: 1 },
      62: { type: 'breakLoop', kind: 'action' },
      63: { type: 'setVariable', kind: 'action', varName: 'after', operation: 'add', value: 1 }
    });
    h.run();
    return h.vars.hits === 1 && h.vars.after === undefined && h.warnings.length === 0;
  })());
check('dispatch: Continue skips the rest of the round and starts the next one',
  (() => {
    const h = makeHost({
      0: { type: 'always', kind: 'condition' },
      60: { type: 'repeatTimes', kind: 'action', count: '3', counterVar: '' },
      61: { type: 'setVariable', kind: 'action', varName: 'hits', operation: 'add', value: 1 },
      62: { type: 'continueLoop', kind: 'action' },
      63: { type: 'setVariable', kind: 'action', varName: 'skipped', operation: 'add', value: 1 }
    });
    h.run();
    return h.vars.hits === 3 && h.vars.skipped === undefined && h.warnings.length === 0;
  })());
check('dispatch: nested loops multiply (outer 3 x inner 2 is 6)',
  (() => {
    const h = makeHost({
      0: { type: 'always', kind: 'condition' },
      60: { type: 'repeatTimes', kind: 'action', count: '3', counterVar: '' },
      61: { type: 'repeatTimes', kind: 'action', count: '2', counterVar: '' },
      62: { type: 'setVariable', kind: 'action', varName: 'total', operation: 'add', value: 1 }
    });
    h.run();
    return h.vars.total === 6 && h.warnings.length === 0;
  })());
check('dispatch: Break inside an inner loop breaks only the inner loop',
  (() => {
    const h = makeHost({
      0: { type: 'always', kind: 'condition' },
      60: { type: 'repeatTimes', kind: 'action', count: '3', counterVar: '' },
      61: { type: 'repeatTimes', kind: 'action', count: '5', counterVar: '' },
      62: { type: 'breakLoop', kind: 'action' },
      63: { type: 'setVariable', kind: 'action', varName: 'total', operation: 'add', value: 1 }
    });
    h.run();
    // The inner loop breaks on its first round every time, so the
    // action after the Break never runs — but the outer loop still
    // runs all three of its rounds.
    return h.vars.total === undefined && h.warnings.length === 0 &&
      L.loopDepth(h.loopState) === 0;
  })());
check('dispatch: a loop with an empty body runs nothing and warns nothing',
  (() => {
    const h = makeHost({
      0: { type: 'always', kind: 'condition' },
      60: { type: 'repeatTimes', kind: 'action', count: '3', counterVar: 'i' }
    });
    h.run();
    return h.vars.i === 3 && h.warnings.length === 0;
  })());
check('dispatch: a condition after the loop block stops the body there',
  (() => {
    const h = makeHost({
      0: { type: 'always', kind: 'condition' },
      60: { type: 'repeatTimes', kind: 'action', count: '3', counterVar: '' },
      61: { type: 'setVariable', kind: 'action', varName: 'hits', operation: 'add', value: 1 },
      62: { type: 'always', kind: 'condition' },
      63: { type: 'setVariable', kind: 'action', varName: 'other', operation: 'add', value: 1 }
    });
    h.run();
    // The body stopped at the condition: `other` ran once (from its
    // own trigger), not 3 times as part of the loop. `hits` is 4,
    // not 3, because the always at 62 also fires its left neighbor
    // through the legacy adjacency rule (a condition fires the
    // actions around it) — that is pre-existing engine behavior,
    // not the loop running the body once more.
    return h.vars.hits === 4 && h.vars.other === 1 && h.warnings.length === 0;
  })());
check('dispatch: 9 nested loops stop at the 8-deep cap (256 body runs, one warning kind)',
  (() => {
    const grid = { 0: { type: 'always', kind: 'condition' } };
    for (let k = 1; k <= 9; k++) grid[k] = { type: 'repeatTimes', kind: 'action', count: '2', counterVar: '' };
    grid[10] = { type: 'setVariable', kind: 'action', varName: 'total', operation: 'add', value: 1 };
    const h = makeHost(grid);
    h.run();
    // Level k is entered 2^(k-1) times and each entry runs its body
    // twice, so level 8 is entered 128 times and runs its body 256
    // times — each one executing the action once, since the ninth
    // loop is skipped at the depth cap and its body falls through to
    // the normal flow. The ninth loop is attempted 256 times, once
    // per level-8 body run.
    return h.vars.total === 256 && h.warnings.some(function (w) { return /more than 8 deep/.test(w); });
  })());
check('dispatch: nested 1000 x 1000 stops at the per-frame budget (9992 runs, no hang)',
  (() => {
    const h = makeHost({
      0: { type: 'always', kind: 'condition' },
      60: { type: 'repeatTimes', kind: 'action', count: '1000', counterVar: '' },
      61: { type: 'repeatTimes', kind: 'action', count: '1000', counterVar: '' },
      62: { type: 'setVariable', kind: 'action', varName: 'total', operation: 'add', value: 1 }
    });
    h.run();
    // The budget counts body actions: each outer round costs 1001
    // (1000 inner body runs plus the inner loop block itself in the
    // outer run). Nine full rounds spend 9009, leaving 991; the
    // tenth round runs 992 inner body actions (the 992nd spends the
    // budget below zero, so the inner loop stops and the outer loop
    // stops on its own budget check right after). 9 * 1000 + 992
    // is 9992 — far short of the unbounded million, and the game
    // never hangs.
    return h.vars.total === 9992 &&
      h.warnings.some(function (w) { return /per-frame budget/.test(w); });
  })());
check('dispatch: For Each Item sums a list through a real grid (no +1)',
  (() => {
    const h = makeHost({
      0: { type: 'always', kind: 'condition' },
      60: { type: 'forEachList', kind: 'action', listVar: 'deck', itemVar: 'card', indexVar: 'n' },
      61: { type: 'setVariable', kind: 'action', varName: 'total', operation: 'add', value: 'card' },
      62: { type: 'setVariable', kind: 'action', varName: 'idxSum', operation: 'add', value: 'n' }
    });
    h.vars.deck = [10, 20, 30];
    h.run();
    return h.vars.total === 60 && h.vars.idxSum === 6 && h.vars.card === 30 &&
      h.vars.n === 3 && h.warnings.length === 0;
  })());
check('dispatch: For Each Item with a non-list warns and the body never runs',
  (() => {
    const h = makeHost({
      0: { type: 'always', kind: 'condition' },
      60: { type: 'forEachList', kind: 'action', listVar: 'score', itemVar: 'card', indexVar: '' },
      61: { type: 'setVariable', kind: 'action', varName: 'total', operation: 'add', value: 1 }
    });
    h.vars.score = 5;
    h.run();
    return h.vars.total === undefined && h.warnings.length === 1 && /not a list/.test(h.warnings[0]);
  })());
check('dispatch: For Each Object points the body at each live object in order',
  (() => {
    const coins = [{ id: 11, name: 'coin' }, { id: 12, name: 'coin' }, { id: 13, name: 'coin' }];
    const h = makeHost({
      0: { type: 'always', kind: 'condition' },
      60: { type: 'forEachObject', kind: 'action', objectName: 'coin', indexVar: 'n' },
      61: { type: 'probeCurrentObject', kind: 'action' },
      62: { type: 'setVariable', kind: 'action', varName: 'hits', operation: 'add', value: 1 }
    }, { coin: coins });
    h.run();
    return h.vars.hits === 3 && (h.vars.probed || []).join(',') === '11,12,13' &&
      h.execSeen.join(',') === '11,,12,,13,' && h.warnings.length === 0;
  })());
check('dispatch: For Each Tagged Object points the body at each live tagged object in order, whatever the names',
  (() => {
    const goblins = [{ id: 11, name: 'goblin', tags: ['goblin'] },
      { id: 12, name: 'goblin2', tags: ['Goblin'] },
      { id: 13, name: 'orc', tags: ['goblin'] }];
    const h = makeHost({
      0: { type: 'always', kind: 'condition' },
      60: { type: 'forEachTagged', kind: 'action', tag: 'goblin', objVar: 'foe', indexVar: 'n' },
      61: { type: 'probeCurrentObject', kind: 'action' },
      62: { type: 'setVariable', kind: 'action', varName: 'idxSum', operation: 'add', value: 'n' }
    }, { goblin: [goblins[0]], goblin2: [goblins[1]], orc: [goblins[2]] });
    h.run();
    return (h.vars.probed || []).join(',') === '11,12,13' && h.vars.idxSum === 6 &&
      h.vars.foe && h.vars.foe.name === 'orc' && h.vars.n === 3 && h.warnings.length === 0;
  })());
check('dispatch: For Each Object with a Break in the body stops after the current object',
  (() => {
    const coins = [{ id: 11, name: 'coin' }, { id: 12, name: 'coin' }, { id: 13, name: 'coin' }];
    const h = makeHost({
      0: { type: 'always', kind: 'condition' },
      60: { type: 'forEachObject', kind: 'action', objectName: 'coin', indexVar: '' },
      61: { type: 'probeCurrentObject', kind: 'action' },
      62: { type: 'breakLoop', kind: 'action' },
      63: { type: 'setVariable', kind: 'action', varName: 'after', operation: 'add', value: 1 }
    }, { coin: coins });
    h.run();
    return (h.vars.probed || []).join(',') === '11' && h.vars.after === undefined &&
      h.warnings.length === 0 && L.loopDepth(h.loopState) === 0;
  })());
check('dispatch: a For Each Item nested in a Repeat re-reads the list every outer round',
  (() => {
    const h = makeHost({
      0: { type: 'always', kind: 'condition' },
      60: { type: 'repeatTimes', kind: 'action', count: '2', counterVar: '' },
      61: { type: 'forEachList', kind: 'action', listVar: 'deck', itemVar: 'card', indexVar: '' },
      62: { type: 'setVariable', kind: 'action', varName: 'total', operation: 'add', value: 'card' }
    });
    h.vars.deck = [1, 2];
    h.run();
    return h.vars.total === 6 && h.warnings.length === 0;
  })());
check('dispatch: without the loop hooks a loop block degrades to running its body once',
  (() => {
    const vars = {};
    const warnings = [];
    const ctx = {
      variables: vars,
      expr: function (v) { return E.evaluate(v, { variables: vars }).value; },
      exprInfo: function (v) { return E.evaluate(v, { variables: vars }); },
      warn: function (m) { warnings.push(m); },
      loopsModule: L,
      loopState: L.createLoopState()
    };
    const grid = {
      0: { type: 'always', kind: 'condition' },
      1: { type: 'repeatTimes', kind: 'action', count: '3', counterVar: '' },
      2: { type: 'setVariable', kind: 'action', varName: 'total', operation: 'add', value: 1 }
    };
    // No isLoopBlock / executeLoop / shouldAbort on the hooks: the
    // flow treats the loop block as an ordinary action, so the body
    // runs once through the normal chain.
    D.processScope(grid, 'test', {
      flow: FL, trace: null, traceState: null, frameId: 0,
      isCondition: function (t) { return t === 'always'; },
      isAction: function (t) { return t === 'setVariable' || L.isLoopAction(t); },
      isComment: function (t) { return t === 'comment'; },
      evaluate: function () { return { triggered: true, context: {} }; },
      execute: function (idx, data) { X.executeAction(data, ctx, idx); },
      flowTriggerStates: {}, startedScopes: new Set(),
      onTriggered: function () {}, onPropagateCondition: function () {},
      reportUnknown: function (t) { warnings.push('unknown ' + t); }
    });
    return vars.total === 1 && warnings.length === 0;
  })());

// --- static pins: catalog, wiring, docs ---
const catalogSb = {};
catalogSb.window = catalogSb;
vm.createContext(catalogSb);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8'),
  catalogSb, { filename: 'block-catalog.js' });
const catalog = catalogSb.HydraBlockCatalog.blocks;
check('catalog holds 556 blocks (was 552, +4 attach)',
  catalog.length === 556, `got ${catalog.length}`);
const loopBlocks = catalog.filter(function (b) { return b.category === 'Control Flow'; });
check('the Control Flow category holds exactly the eight loop blocks plus the two event blocks, in order',
  loopBlocks.map(function (b) { return b.label; }).join(',') === 'Repeat,While,Break,Continue,For Each Item,For Each Object,For Each Field,For Each Tagged Object,Broadcast Event,On Event',
  loopBlocks.map(function (b) { return b.label; }).join(','));
check('the eight loop blocks and Broadcast Event are actions, On Event is a condition, with the right runtime types',
  loopBlocks.slice(0, 9).every(function (b) { return b.kind === 'action'; }) &&
  loopBlocks[9].kind === 'condition' &&
  loopBlocks[0].runtimeType === 'repeatTimes' && loopBlocks[1].runtimeType === 'whileLoop' &&
  loopBlocks[2].runtimeType === 'breakLoop' && loopBlocks[3].runtimeType === 'continueLoop' &&
  loopBlocks[4].runtimeType === 'forEachList' && loopBlocks[5].runtimeType === 'forEachObject' &&
  loopBlocks[6].runtimeType === 'forEachField' && loopBlocks[7].runtimeType === 'forEachTagged' &&
  loopBlocks[8].runtimeType === 'broadcastEvent' && loopBlocks[9].runtimeType === 'onCustomEvent');
check('For Each Item declares list, item, and optional index variables',
  (() => {
    const b = loopBlocks[4];
    const fields = {};
    (b.fields || []).forEach(function (f) { fields[f.key] = f; });
    return b.defaults.listVar === 'inventory' && b.defaults.itemVar === 'item' &&
      b.defaults.indexVar === '' &&
      fields.listVar && fields.listVar.control === 'text' &&
      fields.itemVar && fields.itemVar.control === 'text' &&
      fields.indexVar && fields.indexVar.control === 'text';
  })());
check('For Each Object declares an object picker and an optional index variable',
  (() => {
    const b = loopBlocks[5];
    const fields = {};
    (b.fields || []).forEach(function (f) { fields[f.key] = f; });
    return b.defaults.objectName === '' && b.defaults.indexVar === '' &&
      fields.objectName && fields.objectName.control === 'object' &&
      fields.indexVar && fields.indexVar.control === 'text';
  })());
check('For Each Tagged Object declares a tag and optional object and index variables',
  (() => {
    const b = loopBlocks[7];
    const fields = {};
    (b.fields || []).forEach(function (f) { fields[f.key] = f; });
    return b.defaults.tag === '' && b.defaults.objVar === '' && b.defaults.indexVar === '' &&
      fields.tag && fields.tag.control === 'text' &&
      fields.objVar && fields.objVar.control === 'text' &&
      fields.indexVar && fields.indexVar.control === 'text';
  })());
check('Repeat declares a count expression and an optional counter variable',
  (() => {
    const b = loopBlocks[0];
    const fields = {};
    (b.fields || []).forEach(function (f) { fields[f.key] = f; });
    return b.defaults.count === '3' && b.defaults.counterVar === '' &&
      fields.count && fields.count.control === 'expr' &&
      fields.counterVar && fields.counterVar.control === 'text';
  })());
check('While declares two expressions around a comparison select',
  (() => {
    const b = loopBlocks[1];
    const fields = {};
    (b.fields || []).forEach(function (f) { fields[f.key] = f; });
    return b.defaults.operator === '<' &&
      fields.left && fields.left.control === 'expr' &&
      fields.right && fields.right.control === 'expr' &&
      fields.operator && fields.operator.control === 'select' &&
      Array.isArray(fields.operator.options) && fields.operator.options.length === 6;
  })());
check('Break and Continue declare no fields',
  (loopBlocks[2].fields || []).length === 0 && (loopBlocks[3].fields || []).length === 0);
check('catalog validates clean with the loop blocks',
  catalogSb.HydraBlockCatalog.validateCatalog(catalog).length === 0);

const indexHtml = fs.readFileSync(path.join(HYDRA, 'index.html'), 'utf8');
check('index.html loads hydra-loops.js after hydra-functions.js',
  indexHtml.indexOf('hydra-loops.js') > indexHtml.indexOf('hydra-functions.js') &&
  indexHtml.indexOf('hydra-loops.js') > 0);
check('index.html loads hydra-loops.js before player-runtime.js',
  indexHtml.indexOf('hydra-loops.js') < indexHtml.indexOf('player-runtime.js'));

const playerSrc = fs.readFileSync(path.join(HYDRA, 'player-runtime.js'), 'utf8');
check('export hard-guards on the loops module',
  /requires hydra-loops\.js \(window\.HydraLoops\)/.test(playerSrc));
check('export creates the loop state at run start',
  playerSrc.includes('loopState: HydraLoops.createLoopState()'));
check('export classifies loop blocks as actions',
  playerSrc.includes('HydraLoops.isLoopAction(type)'));
check('export dispatch hooks wire the loop runner and the abort flag',
  playerSrc.includes('isLoopBlock: (type) => HydraLoops.isLoopBlock(type)') &&
  playerSrc.includes('executeLoop: (idx, data, runBody)') &&
  playerSrc.includes('HydraLoops.controlOf(state.loopState)'));
check('export action context carries the loops module and state',
  playerSrc.includes('loopsModule: HydraLoops') &&
  playerSrc.includes('loopState: state.loopState'));
check('export action context lets the loop runner point the execution context at each object',
  playerSrc.includes('setExecutionContext: function (c) { state.executionContext = c; }'));
check('export inlines the loops module into playable games',
  playerSrc.includes("'hydra-loops.js (window.HydraLoops)'"));
check('export resets the loop budget per script phase, not inside function bodies',
  playerSrc.includes('HydraLoops.resetLoopBudget(state.loopState)') &&
  playerSrc.includes('if (!fnFrame)'));

const previewSrc = fs.readFileSync(path.join(HYDRA, 'hydra-previewruntime.js'), 'utf8');
check('preview hosts the loop state lazily and resets it on a fresh run',
  previewSrc.includes('function loopsState()') &&
  previewSrc.includes('resetLoopsState();'));
check('preview dispatch hooks wire the loop runner and the abort flag',
  previewSrc.includes('isLoopBlock: function (type)') &&
  previewSrc.includes('executeLoop: function (idx, data, runBody)') &&
  previewSrc.includes('L.controlOf(s) !== null'));
check('preview action context carries the loops module and state',
  previewSrc.includes("loopsModule: mod('Loops')") &&
  previewSrc.includes('loopState: loopsState()'));
check('preview action context lets the loop runner point the execution context at each object',
  previewSrc.includes('setExecutionContext: function (c)') &&
  previewSrc.includes('r.executionContext = c;'));
check('preview resets the loop budget per script phase, not inside function bodies',
  previewSrc.includes('LB.resetLoopBudget(loopsState())'));

const flowSrc = fs.readFileSync(path.join(HYDRA, 'hydra-flow.js'), 'utf8');
check('flow propagate routes loop blocks through executeLoop and pulls the body out of the queue',
  flowSrc.includes('api.isLoopBlock') && flowSrc.includes('api.executeLoop(nIdx, data, runBody)') &&
  flowSrc.includes('queue.splice(qi, 1)'));
check('flow propagate stops a body run when shouldAbort asks',
  flowSrc.includes('abortRequested()'));
const dispatchSrc = fs.readFileSync(path.join(HYDRA, 'hydra-dispatch.js'), 'utf8');
check('dispatch forwards the loop hooks to the flow module',
  dispatchSrc.includes('isLoopBlock: h.isLoopBlock') &&
  dispatchSrc.includes('executeLoop: h.executeLoop') &&
  dispatchSrc.includes('shouldAbort: h.shouldAbort'));
const executeSrc = fs.readFileSync(path.join(HYDRA, 'hydra-execute.js'), 'utf8');
check('execute exposes executeLoopAction and routes Break / Continue through the loop state',
  executeSrc.includes('executeLoopAction: executeLoopAction') &&
  executeSrc.includes('requestBreak(loopState)') &&
  executeSrc.includes('requestContinue(loopState)'));

const ref = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');
check('For Each Field declares structure, key, value, and optional index variables',
  (() => {
    const b = loopBlocks[6];
    const fields = {};
    (b.fields || []).forEach(function (f) { fields[f.key] = f; });
    return b.defaults.varName === 'stats' && b.defaults.keyVar === 'field' &&
      b.defaults.valueVar === 'value' && b.defaults.indexVar === '' &&
      fields.varName && fields.varName.control === 'text' &&
      fields.keyVar && fields.keyVar.control === 'text' &&
      fields.valueVar && fields.valueVar.control === 'text' &&
      fields.indexVar && fields.indexVar.control === 'text';
  })());
check('block reference documents all eight loop blocks',
  ['Repeat', 'While', 'Break', 'Continue', 'For Each Item', 'For Each Object', 'For Each Field']
    .every(function (label) { return ref.includes(label); }));
const guide = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');
check('user guide covers loops (Repeat, While, Break, Continue, the body rule)',
  guide.includes('Loops') && guide.includes('Repeat') && guide.includes('While') &&
  guide.includes('Break') && guide.includes('Continue'));
check('user guide covers for-each over a list and over objects',
  guide.includes('For Each Item') && guide.includes('For Each Object'));

process.exit(failures === 0 ? 0 : 1);
