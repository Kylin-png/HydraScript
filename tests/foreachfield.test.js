// Unit tests for iteration over structures (P5 core-engine track,
// item P5-6: Data structures, slice c — For Each Field runs the body
// once per field of a structure, handing the body the field name as
// text and the field's value each round).
//
// A structure is the dictionary the structure blocks build: fields
// are walked in the order they were set, snapshotted at the start so
// a body that adds or removes a field cannot change the run, capped
// at 1000 fields with a warning naming the real count. When a field's
// value is an object handle — the kind Store Object In Structure
// writes — the body round also points the execution context at that
// live object, the same narrowing For Each Item uses, so body actions
// hit that one object. The dispatch integration at the end runs real
// grids through HydraDispatch + HydraFlow, so the sum, the manual
// keys-list path, and the handle narrowing are pinned by behavior,
// not by reading the code. Static checks at the end pin the wiring:
// catalog blocks and the docs.

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
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-variables.js'), 'utf8'),
  sandbox, { filename: 'hydra-variables.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-collections.js'), 'utf8'),
  sandbox, { filename: 'hydra-collections.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-health.js'), 'utf8'),
  sandbox, { filename: 'hydra-health.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-expr.js'), 'utf8'),
  sandbox, { filename: 'hydra-expr.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-flow.js'), 'utf8'),
  sandbox, { filename: 'hydra-flow.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-dispatch.js'), 'utf8'),
  sandbox, { filename: 'hydra-dispatch.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-conditions.js'), 'utf8'),
  sandbox, { filename: 'hydra-conditions.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-execute.js'), 'utf8'),
  sandbox, { filename: 'hydra-execute.js' });
const L = sandbox.HydraLoops;
const V = sandbox.HydraVariables;
const C = sandbox.HydraCollections;
const H = sandbox.HydraHealth;
const E = sandbox.HydraExpr;
const FL = sandbox.HydraFlow;
const D = sandbox.HydraDispatch;
const X = sandbox.HydraExecute;

// --- module surface ---
check('HydraLoops exposes normalizeForEachFields',
  !!L && typeof L.normalizeForEachFields === 'function');
check('isLoopAction and isLoopBlock name For Each Field',
  L.isLoopAction('forEachField') && L.isLoopBlock('forEachField') &&
  !L.isLoopAction('structKeys'));

// --- normalizeForEachFields ---
check('normalizeForEachFields snapshots keys and values in order',
  (() => {
    const n = L.normalizeForEachFields({ hp: 40, mp: 30, xp: 10 });
    if (!n.ok || n.total !== 3 || n.capped || n.fields.length !== 3) return false;
    return n.fields[0].key === 'hp' && n.fields[0].value === 40 &&
      n.fields[1].key === 'mp' && n.fields[1].value === 30 &&
      n.fields[2].key === 'xp' && n.fields[2].value === 10;
  })());
check('normalizeForEachFields caps at 1000 fields and names the real total',
  (() => {
    const big = {};
    for (let i = 0; i < 1005; i++) big['f' + i] = i;
    const n = L.normalizeForEachFields(big);
    if (!n.ok || n.total !== 1005 || !n.capped || n.fields.length !== 1000) return false;
    if (n.fields[999].key !== 'f999' || n.fields[999].value !== 999) return false;
    // The snapshot is a copy: mutating the source structure after
    // normalizing leaves the snapshot alone.
    big.f1005 = 1005;
    delete big.f0;
    return n.fields.length === 1000 && n.fields[0].key === 'f0';
  })());
check('normalizeForEachFields accepts an empty structure',
  (() => {
    const n = L.normalizeForEachFields({});
    return n.ok && !n.capped && n.total === 0 && n.fields.length === 0;
  })());
check('normalizeForEachFields rejects non-structures (a list is not a structure)',
  !L.normalizeForEachFields([1, 2]).ok && !L.normalizeForEachFields(5).ok &&
  !L.normalizeForEachFields('abc').ok && !L.normalizeForEachFields(null).ok &&
  !L.normalizeForEachFields(undefined).ok);

// --- executeLoopAction with a fake body runner (no dispatch) ---
function fakeCtx(vars, warnings, objectsByName, o) {
  o = o || {};
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
    varScopesModule: o.noVarScopes ? null : V,
    named: function (name) {
      const pool = objectsByName && objectsByName[name];
      return Array.isArray(pool) ? pool.slice() : [];
    },
    setExecutionContext: o.noSetCtx ? undefined : function (c) {
      ctx.executionContext = c || null;
      execSeen.push(c && c.obj1 ? c.obj1.id : null);
    },
    _execSeen: execSeen
  };
  return ctx;
}

check('For Each Field runs the body once per field with key, value, and a 1-based index',
  (() => {
    const vars = { stats: { hp: 40, mp: 30, xp: 10 } }; const warnings = [];
    const ctx = fakeCtx(vars, warnings);
    let runs = 0; const keys = []; const vals = []; const idxSeen = [];
    X.executeLoopAction({ type: 'forEachField', varName: 'stats', keyVar: 'field', valueVar: 'value', indexVar: 'n' }, ctx, 0,
      function () { runs++; keys.push(vars.field); vals.push(vars.value); idxSeen.push(vars.n); return [1]; });
    return runs === 3 && keys.join(',') === 'hp,mp,xp' && vals.join(',') === '40,30,10' &&
      idxSeen.join(',') === '1,2,3' && vars.field === 'xp' && vars.value === 10 && vars.n === 3 &&
      warnings.length === 0;
  })());
check('For Each Field with no key or value variables still runs the body per field',
  (() => {
    const vars = { stats: { a: 1, b: 2 } }; const warnings = [];
    const ctx = fakeCtx(vars, warnings);
    let runs = 0;
    X.executeLoopAction({ type: 'forEachField', varName: 'stats', keyVar: '', valueVar: '', indexVar: '' }, ctx, 0,
      function () { runs++; return [1]; });
    return runs === 2 && vars.field === undefined && vars.value === undefined && warnings.length === 0;
  })());
check('For Each Field with a blank structure name warns and never runs the body',
  (() => {
    const vars = { stats: { a: 1 } }; const warnings = [];
    const ctx = fakeCtx(vars, warnings);
    let runs = 0;
    X.executeLoopAction({ type: 'forEachField', varName: '   ', keyVar: 'k', valueVar: 'v', indexVar: '' }, ctx, 0,
      function () { runs++; return [1]; });
    return runs === 0 && warnings.length === 1 && /structure variable is blank/.test(warnings[0]);
  })());
check('For Each Field over a list or a number warns and never runs the body',
  (() => {
    const vars = { deck: [1, 2], score: 5 }; const warnings = [];
    const ctx = fakeCtx(vars, warnings);
    let runs = 0;
    X.executeLoopAction({ type: 'forEachField', varName: 'deck', keyVar: 'k', valueVar: 'v', indexVar: '' }, ctx, 0,
      function () { runs++; return [1]; });
    X.executeLoopAction({ type: 'forEachField', varName: 'score', keyVar: 'k', valueVar: 'v', indexVar: '' }, ctx, 0,
      function () { runs++; return [1]; });
    return runs === 0 && warnings.length === 2 && /not a structure/.test(warnings[0]) &&
      /not a structure/.test(warnings[1]);
  })());
check('For Each Field over a missing variable warns and never runs the body',
  (() => {
    const vars = {}; const warnings = [];
    const ctx = fakeCtx(vars, warnings);
    let runs = 0;
    X.executeLoopAction({ type: 'forEachField', varName: 'nope', keyVar: 'k', valueVar: 'v', indexVar: '' }, ctx, 0,
      function () { runs++; return [1]; });
    return runs === 0 && warnings.length === 1 && /not a structure/.test(warnings[0]);
  })());
check('For Each Field over an empty structure runs nothing and stays quiet',
  (() => {
    const vars = { stats: {} }; const warnings = [];
    const ctx = fakeCtx(vars, warnings);
    let runs = 0;
    X.executeLoopAction({ type: 'forEachField', varName: 'stats', keyVar: 'k', valueVar: 'v', indexVar: '' }, ctx, 0,
      function () { runs++; return [1]; });
    return runs === 0 && warnings.length === 0;
  })());
check('For Each Field past the cap runs 1000 fields and warns with the real total',
  (() => {
    const vars = { stats: {} };
    for (let i = 0; i < 1005; i++) vars.stats['f' + i] = i;
    const warnings = [];
    const ctx = fakeCtx(vars, warnings);
    let runs = 0;
    X.executeLoopAction({ type: 'forEachField', varName: 'stats', keyVar: 'k', valueVar: 'v', indexVar: '' }, ctx, 0,
      function () { runs++; return [1]; });
    return runs === 1000 && warnings.length === 1 && /1005/.test(warnings[0]) && /1000/.test(warnings[0]);
  })());
check('For Each Field snapshots the fields: a body that adds one does not change the run',
  (() => {
    const vars = { stats: { a: 1, b: 2, c: 3 } }; const warnings = [];
    const ctx = fakeCtx(vars, warnings);
    let runs = 0;
    X.executeLoopAction({ type: 'forEachField', varName: 'stats', keyVar: 'k', valueVar: 'v', indexVar: '' }, ctx, 0,
      function () { runs++; vars.stats.d = 4; return [1]; });
    return runs === 3 && warnings.length === 0;
  })());
check('Break inside a For Each Field body stops after the current field',
  (() => {
    const vars = { stats: { a: 1, b: 2, c: 3 } }; const warnings = [];
    const ctx = fakeCtx(vars, warnings);
    let runs = 0;
    X.executeLoopAction({ type: 'forEachField', varName: 'stats', keyVar: 'k', valueVar: 'v', indexVar: '' }, ctx, 0,
      function () { runs++; L.requestBreak(ctx.loopState); return [1]; });
    return runs === 1 && vars.k === 'a' && L.loopDepth(ctx.loopState) === 0 &&
      L.controlOf(ctx.loopState) === null && warnings.length === 0;
  })());
check('For Each Field over handle values points the body at each live object in order, then restores',
  (() => {
    const goblins = [
      { id: 11, name: 'goblin' }, { id: 12, name: 'goblin' }, { id: 13, name: 'goblin' }
    ];
    const vars = {
      squad: {
        first: V.objectRefOf(goblins[0]),
        second: V.objectRefOf(goblins[1]),
        third: V.objectRefOf(goblins[2])
      }
    };
    const warnings = [];
    const ctx = fakeCtx(vars, warnings, { goblin: goblins });
    let runs = 0;
    X.executeLoopAction({ type: 'forEachField', varName: 'squad', keyVar: 'k', valueVar: 'v', indexVar: '' }, ctx, 0,
      function () { runs++; return [1]; });
    // One narrowing per round plus one restore per round (null).
    return runs === 3 && ctx._execSeen.join(',') === '11,,12,,13,' &&
      ctx.executionContext === null && warnings.length === 0;
  })());
check('For Each Field with a stale handle narrows nothing and stays quiet',
  (() => {
    const goblins = [{ id: 11, name: 'goblin' }];
    const vars = {
      squad: {
        gone: V.objectRefOf({ name: 'goblin', id: 99 }),
        live: V.objectRefOf(goblins[0])
      }
    };
    const warnings = [];
    const ctx = fakeCtx(vars, warnings, { goblin: goblins });
    let runs = 0;
    X.executeLoopAction({ type: 'forEachField', varName: 'squad', keyVar: 'k', valueVar: 'v', indexVar: '' }, ctx, 0,
      function () { runs++; return [1]; });
    // Only the live handle narrows (and restores); the stale one
    // runs its body with no context at all.
    return runs === 2 && ctx._execSeen.join(',') === '11,' &&
      ctx.executionContext === null && warnings.length === 0;
  })());
check('For Each Field without the variable-scopes module runs the body with no narrowing and no warning',
  (() => {
    const goblins = [{ id: 11, name: 'goblin' }];
    const vars = { squad: { only: V.objectRefOf(goblins[0]) } };
    const warnings = [];
    const ctx = fakeCtx(vars, warnings, { goblin: goblins }, { noVarScopes: true });
    let runs = 0;
    X.executeLoopAction({ type: 'forEachField', varName: 'squad', keyVar: 'k', valueVar: 'v', indexVar: '' }, ctx, 0,
      function () { runs++; return [1]; });
    return runs === 1 && ctx._execSeen.length === 0 && warnings.length === 0;
  })());
check('For Each Field without the setExecutionContext hook warns once and runs the body anyway',
  (() => {
    const goblins = [{ id: 11, name: 'goblin' }, { id: 12, name: 'goblin' }];
    const vars = {
      squad: { a: V.objectRefOf(goblins[0]), b: V.objectRefOf(goblins[1]) }
    };
    const warnings = [];
    const ctx = fakeCtx(vars, warnings, { goblin: goblins }, { noSetCtx: true });
    let runs = 0;
    X.executeLoopAction({ type: 'forEachField', varName: 'squad', keyVar: 'k', valueVar: 'v', indexVar: '' }, ctx, 0,
      function () { runs++; return [1]; });
    return runs === 2 && warnings.length === 1 &&
      /cannot point actions at each object/.test(warnings[0]);
  })());
check('For Each Field through plain executeAction stays quiet (no loop runner)',
  (() => {
    const vars = { stats: { a: 1 } }; const warnings = [];
    const ctx = fakeCtx(vars, warnings);
    X.executeAction({ type: 'forEachField', varName: 'stats', keyVar: 'k', valueVar: 'v' }, ctx, 0);
    return warnings.length === 0;
  })());

// --- dispatch integration: real grids through HydraDispatch + HydraFlow ---
function goblinObj(id, x, y, health) {
  return {
    id: id, name: 'goblin', kind: 'sprite', posX: x, posY: y, width: 40, height: 40,
    color: '#888888', static: false, physicsEnabled: false, health: health, maxHealth: 100,
    collision: { shape: 'box', mode: 'solid', layer: 0, mask: 255 }
  };
}
function makeHost(grid, objectsByName) {
  const vars = {};
  const warnings = [];
  const loopState = L.createLoopState();
  const flowTriggerStates = {};
  const startedScopes = new Set();
  const ctx = {
    variables: vars,
    expr: function (v) { return E.evaluate(v, { variables: vars }).value; },
    exprInfo: function (v) { return E.evaluate(v, { variables: vars }); },
    warn: function (m) { warnings.push(m); },
    loopsModule: L,
    loopState: loopState,
    executionContext: null,
    varScopesModule: V,
    collections: C,
    collectionHooks: function () {
      return {
        num: (raw) => E.evaluate(raw, { variables: vars }),
        warn: (m) => warnings.push(m),
        lookupVar: (n) => vars[n]
      };
    },
    healthModule: H,
    named: function (name) {
      const pool = objectsByName && objectsByName[name];
      return Array.isArray(pool) ? pool.slice() : [];
    },
    setExecutionContext: function (c) { ctx.executionContext = c || null; }
  };
  function isCond(t) { return t === 'gameStart' || t === 'always'; }
  function isAct(t) {
    return t === 'setVariable' || t === 'damageObject' || L.isLoopAction(t) ||
      C.isCollectionAction(t);
  }
  const hooks = {
    flow: FL,
    trace: null, traceState: null, frameId: 0,
    isCondition: isCond, isAction: isAct, isComment: function (t) { return t === 'comment'; },
    evaluate: function (idx, data) {
      if (data.type === 'always') return { triggered: true, context: {} };
      if (data.type === 'gameStart') return { triggered: !startedScopes.has('test'), context: {} };
      return { triggered: false, context: {} };
    },
    execute: function (idx, data) { X.executeAction(data, ctx, idx); },
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
    vars: vars, warnings: warnings, loopState: loopState, ctx: ctx,
    run: function () { D.processScope(grid, 'test', hooks); }
  };
}

check('dispatch: For Each Field sums a structure through a real grid (no +1)',
  (() => {
    const h = makeHost({
      0: { type: 'gameStart', kind: 'condition' },
      1: { type: 'varFromJson', kind: 'action', varName: 'stats', jsonText: '{"hp":40,"mp":30,"xp":10}' },
      2: { type: 'forEachField', kind: 'action', varName: 'stats', keyVar: 'field', valueVar: 'value', indexVar: 'n' },
      3: { type: 'setVariable', kind: 'action', varName: 'total', operation: 'add', value: 'value' },
      4: { type: 'setVariable', kind: 'action', varName: 'idxSum', operation: 'add', value: 'n' }
    });
    h.run();
    // The key variable itself ends on the last field ('xp'): a
    // text value cannot travel through an expression, so the last
    // key is read from the loop variable, not copied by Set
    // Variable (expressions are numeric — see hydra-expr.js).
    return h.vars.total === 80 && h.vars.field === 'xp' && h.vars.idxSum === 6 &&
      h.vars.n === 3 && h.warnings.length === 0;
  })());
check('dispatch: the keys-list path walks the names (List Structure Keys + For Each Item), and a literal field read agrees',
  (() => {
    const h = makeHost({
      0: { type: 'gameStart', kind: 'condition' },
      1: { type: 'varFromJson', kind: 'action', varName: 'stats', jsonText: '{"hp":40,"mp":30,"xp":10}' },
      2: { type: 'structKeys', kind: 'action', varName: 'stats', storeVarName: 'keys' },
      3: { type: 'forEachList', kind: 'action', listVar: 'keys', itemVar: 'k', indexVar: '' },
      4: { type: 'setVariable', kind: 'action', varName: 'keyCount', operation: 'add', value: 1 },
      5: { type: 'structGetField', kind: 'action', varName: 'stats', field: 'hp', storeVarName: 'hpVal' }
    });
    // The keys list walks the names only: Get Structure Field
    // takes a fixed field name, so a per-key value read from the
    // loop's item variable is exactly what For Each Field is for.
    // The literal read of the known key agrees with the loop.
    h.run();
    return Array.isArray(h.vars.keys) && h.vars.keys.join(',') === 'hp,mp,xp' &&
      h.vars.keyCount === 3 && h.vars.hpVal === 40 && h.warnings.length === 0;
  })());
check('dispatch: For Each Field over a dict of handles damages each goblin exactly once',
  (() => {
    const g1 = goblinObj(11, 100, 100, 70);
    const g2 = goblinObj(12, 200, 100, 70);
    const g3 = goblinObj(13, 300, 100, 70);
    const h = makeHost({
      0: { type: 'gameStart', kind: 'condition' },
      1: { type: 'forEachField', kind: 'action', varName: 'squad', keyVar: 'k', valueVar: 'v', indexVar: '' },
      2: { type: 'damageObject', kind: 'action', targetObject: 'goblin', amount: 10 },
      3: { type: 'setVariable', kind: 'action', varName: 'hits', operation: 'add', value: 1 }
    }, { goblin: [g1, g2, g3] });
    // The dict is seeded from handles directly, the way the store
    // block would build it — a JSON block cannot hold handles, and
    // a varFromJson in the grid would overwrite the seed.
    h.vars.squad = {
      first: V.objectRefOf(g1), second: V.objectRefOf(g2), third: V.objectRefOf(g3)
    };
    h.run();
    return h.vars.hits === 3 && g1.health === 60 && g2.health === 60 && g3.health === 60 &&
      h.warnings.length === 0;
  })());
check('dispatch: a For Each Field nested in a Repeat re-reads the structure every outer round',
  (() => {
    const h = makeHost({
      0: { type: 'always', kind: 'condition' },
      60: { type: 'repeatTimes', kind: 'action', count: '2', counterVar: '' },
      61: { type: 'forEachField', kind: 'action', varName: 'stats', keyVar: 'k', valueVar: 'v', indexVar: '' },
      62: { type: 'setVariable', kind: 'action', varName: 'total', operation: 'add', value: 'v' }
    });
    h.vars.stats = { a: 1, b: 2 };
    h.run();
    return h.vars.total === 6 && h.warnings.length === 0;
  })());
check('dispatch: For Each Field with a non-structure warns and the body never runs',
  (() => {
    const h = makeHost({
      0: { type: 'always', kind: 'condition' },
      60: { type: 'forEachField', kind: 'action', varName: 'deck', keyVar: 'k', valueVar: 'v', indexVar: '' },
      61: { type: 'setVariable', kind: 'action', varName: 'total', operation: 'add', value: 1 }
    });
    h.vars.deck = [10, 20];
    h.run();
    return h.vars.total === undefined && h.warnings.length === 1 && /not a structure/.test(h.warnings[0]);
  })());

// --- static pins: catalog, wiring, docs ---
const catSb = {};
catSb.window = catSb;
vm.createContext(catSb);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8'),
  catSb, { filename: 'block-catalog.js' });
const catalog = catSb.window.HydraBlockCatalog.blocks;
check('catalog holds 556 blocks (was 552, +4 attach)',
  catalog.length === 556, `got ${catalog.length}`);
const flowBlocks = catalog.filter(function (b) { return b.category === 'Control Flow'; });
check('the Control Flow category holds For Each Field right after For Each Object',
  flowBlocks.map(function (b) { return b.label; }).join(',') ===
    'Repeat,While,Break,Continue,For Each Item,For Each Object,For Each Field,For Each Tagged Object,Broadcast Event,On Event',
  flowBlocks.map(function (b) { return b.label; }).join(','));
check('For Each Field declares structure, key, value, and optional index variables',
  (() => {
    const b = flowBlocks[6];
    const fields = {};
    (b.fields || []).forEach(function (f) { fields[f.key] = f; });
    return b.blockType === 'for-each-field' && b.runtimeType === 'forEachField' &&
      b.kind === 'action' && b.defaults.varName === 'stats' &&
      b.defaults.keyVar === 'field' && b.defaults.valueVar === 'value' &&
      b.defaults.indexVar === '' &&
      fields.varName && fields.varName.control === 'text' &&
      fields.keyVar && fields.keyVar.control === 'text' &&
      fields.valueVar && fields.valueVar.control === 'text' &&
      fields.indexVar && fields.indexVar.control === 'text';
  })());
check('catalog validates clean with the For Each Field block',
  catSb.window.HydraBlockCatalog.validateCatalog(catalog).length === 0);
const executeSrc = fs.readFileSync(path.join(HYDRA, 'hydra-execute.js'), 'utf8');
check('execute routes For Each Field through the loop handler with handle narrowing',
  executeSrc.includes("data.type === 'forEachField'") &&
  executeSrc.includes('runForEachField(data, ctx, state, runBody)') &&
  executeSrc.includes('For Each Field: the structure variable is blank'));
const ref = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');
check('block reference documents For Each Field in the Control Flow (10) section',
  ref.includes('### Control Flow (10)') && ref.includes('#### For Each Field') &&
  ref.includes('Runs the blocks to its right once per field of a structure'));
const guide = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');
check('user guide covers For Each Field and drops the iteration-is-next-step line',
  guide.includes('For Each Field') && guide.includes('walks a structure one field at a time') &&
  !guide.includes('iteration over structure fields is the next data-structures step'));

process.exit(failures === 0 ? 0 : 1);
