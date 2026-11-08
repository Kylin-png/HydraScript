// Unit tests for hydra/hydra-functions.js — the shared custom functions
// system (P5 core-engine track, item P5-3: Functions / custom blocks,
// slice a — the runtime core).
//
// Pure logic: the function definitions (name, up to eight parameters,
// body grid), the call stack with its 32-deep recursion guard, the
// scope keys ('function:<id>'), and the local-variable scope the call
// frames bind into the scoped-variables state. Nothing here touches
// the DOM; both runtimes delegate to this module. Static checks at
// the end pin the wiring: catalog blocks, both runtimes' dispatch and
// the local-scope reads, the function-scope grids, and the docs.

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
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-functions.js'), 'utf8'),
  sandbox, { filename: 'hydra-functions.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-variables.js'), 'utf8'),
  sandbox, { filename: 'hydra-variables.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-gridmodel.js'), 'utf8'),
  sandbox, { filename: 'hydra-gridmodel.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-execute.js'), 'utf8'),
  sandbox, { filename: 'hydra-execute.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-conditions.js'), 'utf8'),
  sandbox, { filename: 'hydra-conditions.js' });
const F = sandbox.HydraFunctions;
const V = sandbox.HydraVariables;
const G = sandbox.HydraGridModel;
const X = sandbox.HydraExecute;
const C = sandbox.HydraConditions;

check('HydraFunctions exposed with helpers',
  !!F && typeof F.normalizeFunctionId === 'function' &&
  typeof F.mintFunctionId === 'function' &&
  typeof F.normalizeFunctionName === 'function' &&
  typeof F.normalizeParams === 'function' &&
  typeof F.normalizeParamsReport === 'function' &&
  typeof F.normalizeGrid === 'function' &&
  typeof F.normalizeFunction === 'function' &&
  typeof F.normalizeFunctions === 'function' &&
  typeof F.duplicateFunction === 'function' &&
  typeof F.findFunction === 'function' &&
  typeof F.findFunctionById === 'function' &&
  typeof F.scopeKeyFor === 'function' &&
  typeof F.functionIdOfScope === 'function' &&
  typeof F.createCallState === 'function' &&
  typeof F.callDepth === 'function' &&
  typeof F.currentFrame === 'function' &&
  typeof F.call === 'function' &&
  typeof F.returnFrom === 'function' &&
  typeof F.endCall === 'function' &&
  typeof F.isFunctionAction === 'function');
check('factorySource is a non-empty string',
  typeof F.factorySource === 'string' && F.factorySource.length > 100 &&
  F.factorySource.includes('hydraFunctionsFactory'));
check('MAX_DEPTH is 32 and MAX_PARAMS is 8',
  F.MAX_DEPTH === 32 && F.MAX_PARAMS === 8);

// --- ids, names, params ---
check('normalizeFunctionId reads tokens and rejects blanks, colons, and whitespace',
  F.normalizeFunctionId('fn_abc123') === 'fn_abc123' &&
  F.normalizeFunctionId('add') === 'add' &&
  F.normalizeFunctionId('  fn_x-1_y  ') === 'fn_x-1_y' &&
  F.normalizeFunctionId('') === null && F.normalizeFunctionId('   ') === null &&
  F.normalizeFunctionId('a:b') === null && F.normalizeFunctionId('a b') === null &&
  F.normalizeFunctionId(null) === null && F.normalizeFunctionId(42) === null);
check('mintFunctionId mints distinct fn_ ids',
  (() => {
    const a = F.mintFunctionId(), b = F.mintFunctionId();
    return a !== b && a.indexOf('fn_') === 0 && F.normalizeFunctionId(a) === a;
  })());
check('normalizeFunctionName trims and rejects blanks',
  F.normalizeFunctionName('add') === 'add' && F.normalizeFunctionName('  add  ') === 'add' &&
  F.normalizeFunctionName('') === null && F.normalizeFunctionName('   ') === null &&
  F.normalizeFunctionName(null) === null && F.normalizeFunctionName(42) === null);
check('normalizeParams trims, dedupes, caps at eight, and drops blanks',
  JSON.stringify(F.normalizeParams(['a', 'b'])) === JSON.stringify(['a', 'b']) &&
  JSON.stringify(F.normalizeParams([' a ', 'b', 'a', '', 'c', 'd', 'e'])) === JSON.stringify(['a', 'b', 'c', 'd', 'e']) &&
  JSON.stringify(F.normalizeParams(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9'])) === JSON.stringify(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']) &&
  JSON.stringify(F.normalizeParams(['x', 5, null, 'y'])) === JSON.stringify(['x', 'y']) &&
  JSON.stringify(F.normalizeParams(null)) === JSON.stringify([]) &&
  JSON.stringify(F.normalizeParams('a')) === JSON.stringify([]));
check('normalizeParams returns the input array when already clean',
  (() => { const p = ['a', 'b']; return F.normalizeParams(p) === p; })());
check('normalizeParamsReport names the duplicates and the overflow it dropped',
  (() => {
    const clean = F.normalizeParamsReport(['a', 'b']);
    const dup = F.normalizeParamsReport(['a', 'b', 'a', 'c', 'b']);
    const over = F.normalizeParamsReport(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10']);
    const blanks = F.normalizeParamsReport([' a ', '', 'b', null, 5]);
    return JSON.stringify(clean) === JSON.stringify({ params: ['a', 'b'], droppedDuplicates: [], droppedOverflow: [] }) &&
      JSON.stringify(dup.params) === JSON.stringify(['a', 'b', 'c']) &&
      JSON.stringify(dup.droppedDuplicates) === JSON.stringify(['a', 'b']) &&
      JSON.stringify(dup.droppedOverflow) === JSON.stringify([]) &&
      JSON.stringify(over.params) === JSON.stringify(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']) &&
      JSON.stringify(over.droppedOverflow) === JSON.stringify(['p9', 'p10']) &&
      JSON.stringify(over.droppedDuplicates) === JSON.stringify([]) &&
      // Blanks and non-strings drop silently, exactly like
      // normalizeParams: they were never names, so they are not
      // reported.
      JSON.stringify(blanks.params) === JSON.stringify(['a', 'b']) &&
      JSON.stringify(blanks.droppedDuplicates) === JSON.stringify([]) &&
      JSON.stringify(blanks.droppedOverflow) === JSON.stringify([]) &&
      JSON.stringify(F.normalizeParamsReport(null)) === JSON.stringify({ params: [], droppedDuplicates: [], droppedOverflow: [] });
  })());
check('normalizeParamsReport agrees with normalizeParams on the kept list',
  (() => {
    const inputs = [
      ['a', 'b'], [' a ', 'b', 'a', '', 'c', 'd', 'e'],
      ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9'],
      ['x', 5, null, 'y'], [], ['a', 'a', 'a'],
      ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'one']
    ];
    return inputs.every(input =>
      JSON.stringify(F.normalizeParamsReport(input).params) === JSON.stringify(F.normalizeParams(input)));
  })());
check('normalizeGrid keeps a plain object by reference and repairs the rest to {}',
  (() => {
    const g = { 0: { type: 'always' } };
    return F.normalizeGrid(g) === g && JSON.stringify(F.normalizeGrid(null)) === '{}' &&
      JSON.stringify(F.normalizeGrid([])) === '{}' && JSON.stringify(F.normalizeGrid('x')) === '{}';
  })());

// --- definitions ---
check('normalizeFunction rejects a blank name and a non-object',
  F.normalizeFunction({ name: '' }) === null && F.normalizeFunction({ name: '   ' }) === null &&
  F.normalizeFunction(null) === null && F.normalizeFunction('add') === null);
check('normalizeFunction mints an id, trims the name, and normalizes params and grid',
  (() => {
    const n = F.normalizeFunction({ name: '  add  ', params: ['a', 'a', 'b'], grid: { 0: { type: 'always' } } });
    return !!n && F.normalizeFunctionId(n.id) === n.id && n.name === 'add' &&
      JSON.stringify(n.params) === JSON.stringify(['a', 'b']) &&
      n.grid && n.grid[0].type === 'always';
  })());
check('normalizeFunction returns the input object when already canonical',
  (() => {
    const d = { id: 'fn_add', name: 'add', params: ['a'], grid: {} };
    return F.normalizeFunction(d) === d;
  })());
check('normalizeFunctions reads a non-array as no functions',
  JSON.stringify(F.normalizeFunctions(null)) === '[]' &&
  JSON.stringify(F.normalizeFunctions('x')) === '[]');
check('normalizeFunctions dedupes by id and by name, first wins',
  (() => {
    const list = F.normalizeFunctions([
      { id: 'fn_a', name: 'add', params: [], grid: {} },
      { id: 'fn_a', name: 'other', params: [], grid: {} },
      { id: 'fn_b', name: 'add', params: [], grid: {} },
      { id: 'fn_c', name: 'mul', params: [], grid: {} }
    ]);
    return list.length === 2 && list[0].name === 'add' && list[1].name === 'mul';
  })());
check('normalizeFunctions is identity-preserving for a clean list',
  (() => {
    const a = { id: 'fn_a', name: 'add', params: ['x'], grid: {} };
    const b = { id: 'fn_b', name: 'mul', params: [], grid: {} };
    const list = [a, b];
    const out = F.normalizeFunctions(list);
    return out === list && out[0] === a && out[1] === b;
  })());
check('duplicateFunction copies params and body under a fresh id and "copy" name',
  (() => {
    const src = { id: 'fn_add', name: 'add', params: ['a', 'b'],
      grid: { 0: { type: 'always' }, 1: { type: 'setVariable', varName: 'sum', value: 'a + b' } } };
    const defs = [src];
    const copy = F.duplicateFunction(defs, src);
    return !!copy && copy.name === 'add copy' && copy.id !== src.id &&
      F.normalizeFunctionId(copy.id) === copy.id &&
      JSON.stringify(copy.params) === JSON.stringify(['a', 'b']) &&
      JSON.stringify(copy.grid) === JSON.stringify(src.grid) && copy.grid !== src.grid &&
      copy.grid[1] !== src.grid[1] && defs.length === 1;
  })());
check('duplicateFunction deep-copies the body: editing the copy never touches the original',
  (() => {
    const src = { id: 'fn_add', name: 'add', params: ['a'],
      grid: { 0: { type: 'always' }, 1: { type: 'setVariable', varName: 'sum', value: 'a' } } };
    const copy = F.duplicateFunction([], src);
    copy.grid[1].value = 'a + 1';
    copy.grid[2] = { type: 'returnFromFunction', value: 'sum' };
    copy.params.push('b');
    return src.grid[1].value === 'a' && src.grid[2] === undefined && src.params.length === 1;
  })());
check('duplicateFunction numbers the name when "copy" is taken, and returns null for a bad source',
  (() => {
    const src = { id: 'fn_add', name: 'add', params: [], grid: {} };
    const defs = [src,
      { id: 'fn_c1', name: 'add copy', params: [], grid: {} },
      { id: 'fn_c2', name: 'add copy 2', params: [], grid: {} }];
    const copy = F.duplicateFunction(defs, src);
    return !!copy && copy.name === 'add copy 3' &&
      F.duplicateFunction([], null) === null &&
      F.duplicateFunction([], { name: '' }) === null &&
      F.duplicateFunction([], 'add') === null;
  })());
check('findFunction finds by exact trimmed name, findFunctionById by id',
  (() => {
    const defs = [
      { id: 'fn_a', name: 'add', params: [], grid: {} },
      { id: 'fn_b', name: 'mul', params: [], grid: {} }
    ];
    return F.findFunction(defs, '  add ') === defs[0] &&
      F.findFunction(defs, 'missing') === null &&
      F.findFunction(defs, '') === null &&
      F.findFunctionById(defs, 'fn_b') === defs[1] &&
      F.findFunctionById(defs, 'nope') === null;
  })());

// --- scope keys ---
check('scopeKeyFor builds function:<id> and functionIdOfScope reads it back',
  F.scopeKeyFor('fn_a') === 'function:fn_a' && F.scopeKeyFor('') === null &&
  F.scopeKeyFor(null) === null &&
  F.functionIdOfScope('function:fn_a') === 'fn_a' &&
  F.functionIdOfScope('global') === null && F.functionIdOfScope('function:') === null &&
  F.functionIdOfScope('function:a:b') === null && F.functionIdOfScope(3) === null);

// --- call stack ---
check('createCallState starts empty',
  JSON.stringify(F.createCallState()) === JSON.stringify({ frames: [] }));
check('call pushes a frame, callDepth and currentFrame read it',
  (() => {
    const st = F.createCallState();
    const fn = { id: 'fn_a', name: 'add', params: [], grid: {} };
    const fr = F.call(st, fn);
    return !!fr && fr.fnId === 'fn_a' && fr.name === 'add' &&
      JSON.stringify(fr.locals) === '{}' && fr.returnValue === undefined &&
      fr.returned === false && F.callDepth(st) === 1 && F.currentFrame(st) === fr;
  })());
check('returnFrom sets the value and the returned flag; endCall pops the frame',
  (() => {
    const st = F.createCallState();
    const fn = { id: 'fn_a', name: 'add', params: [], grid: {} };
    F.call(st, fn);
    const ok = F.returnFrom(st, 42);
    const done = F.endCall(st);
    return ok === true && done.returnValue === 42 && done.returned === true &&
      F.callDepth(st) === 0 && F.currentFrame(st) === null;
  })());
check('returnFrom with no live call is false, endCall on an empty stack is null',
  (() => {
    const st = F.createCallState();
    return F.returnFrom(st, 1) === false && F.endCall(st) === null;
  })());
check('call on a missing function or a broken state never pushes',
  (() => {
    const st = F.createCallState();
    return F.call(st, null) === null && F.call(st, { name: '' }) === null &&
      F.call(null, { id: 'fn_a', name: 'add', params: [], grid: {} }) === null &&
      F.callDepth(st) === 0 && F.callDepth(null) === 0;
  })());
check('the recursion guard caps the stack at 32 and the 33rd call returns null',
  (() => {
    const st = F.createCallState();
    const fn = { id: 'fn_self', name: 'self', params: [], grid: {} };
    let pushed = 0;
    for (let i = 0; i < 40; i++) { if (F.call(st, fn)) pushed++; }
    return pushed === 32 && F.callDepth(st) === 32 && F.call(st, fn) === null;
  })());
check('nested frames are independent (each call owns its frame)',
  (() => {
    const st = F.createCallState();
    const a = { id: 'fn_a', name: 'a', params: [], grid: {} };
    const b = { id: 'fn_b', name: 'b', params: [], grid: {} };
    const fa = F.call(st, a);
    const fb = F.call(st, b);
    F.returnFrom(st, 7);
    const doneB = F.endCall(st);
    return fa !== fb && doneB === fb && doneB.returnValue === 7 &&
      F.currentFrame(st) === fa && F.callDepth(st) === 1;
  })());
check('isFunctionAction reads callFunction and returnFromFunction only',
  F.isFunctionAction('callFunction') && F.isFunctionAction('returnFromFunction') &&
  !F.isFunctionAction('setVariable') && !F.isFunctionAction(''));

// --- local scope (HydraVariables) ---
check('createVariablesState now carries the local map',
  JSON.stringify(V.createVariablesState()) ===
  JSON.stringify({ global: {}, scene: {}, object: {}, local: {} }));
check('normalizeScope reads local as the fourth scope',
  V.normalizeScope('local') === 'local' && V.normalizeScope('Local') === 'local' &&
  V.normalizeScope('global') === 'global');
check('local set/get/list read and write the bound map',
  (() => {
    const st = V.createVariablesState();
    V.set(st, 'local', 'a', 5);
    V.set(st, 'local', 'b', 'hi');
    return V.get(st, 'local', 'a').value === 5 &&
      V.read(st, 'local', 'b', '') === 'hi' &&
      V.has(st, 'local', 'a') === true && V.has(st, 'local', 'nope') === false &&
      JSON.stringify(V.list(st, 'local').map(r => r.name)) === JSON.stringify(['a', 'b']);
  })());
check('bindLocalScope swaps the map in and returns the previous one; restore puts it back',
  (() => {
    const st = V.createVariablesState();
    V.set(st, 'local', 'outer', 1);
    const inner = {};
    const prev = V.bindLocalScope(st, inner);
    V.set(st, 'local', 'a', 5);
    const back = V.restoreLocalScope(st, prev);
    return V.read(st, 'local', 'a', -1) === -1 &&
      V.read(st, 'local', 'outer', -1) === 1 &&
      back === prev && V.read(st, 'local', 'outer', -1) === 1;
  })());
check('clearScope empties the local map and resetRun clears it with the rest',
  (() => {
    const st = V.createVariablesState();
    V.set(st, 'local', 'a', 5);
    const cleared = V.clearScope(st, 'local');
    const clearedAgain = V.clearScope(st, 'local');
    V.set(st, 'local', 'b', 6);
    V.resetRun(st);
    return cleared === true && clearedAgain === false &&
      V.read(st, 'local', 'b', -1) === -1;
  })());
check('a local definition coerces to global instead of vanishing',
  (() => {
    const d = V.normalizeDefinition({ name: 'x', scope: 'local', type: 'number', value: 3 });
    return !!d && d.scope === 'global' && d.value === 3;
  })());
check('serialize round-trips the local map',
  (() => {
    const st = V.createVariablesState();
    V.set(st, 'local', 'a', 5);
    const back = V.deserialize(V.serialize(st));
    return V.read(back, 'local', 'a', -1) === 5;
  })());

// --- function scopes in the grid model ---
check('normalizeScriptScope passes function scopes through and repairs bad ids to global',
  G.normalizeScriptScope('function:fn_a') === 'function:fn_a' &&
  G.normalizeScriptScope('function:') === 'global' &&
  G.normalizeScriptScope('function:a:b') === 'global' &&
  G.normalizeScriptScope('global') === 'global' &&
  G.normalizeScriptScope(3) === 3);
check('functionIdOfScope reads the id from a function scope only',
  G.functionIdOfScope('function:fn_a') === 'fn_a' &&
  G.functionIdOfScope('global') === null && G.functionIdOfScope(3) === null);
check('getGridDataForScope returns a function body grid by reference and creates it when missing',
  (() => {
    const fn = { id: 'fn_a', name: 'add', params: [], grid: { 0: { type: 'always' } } };
    const store = { scenes: [], globalGridData: {}, functions: [fn] };
    const grid = G.getGridDataForScope(store, 'function:fn_a');
    const fresh = { id: 'fn_b', name: 'mul', params: [] };
    const store2 = { scenes: [], globalGridData: {}, functions: [fresh] };
    const created = G.getGridDataForScope(store2, 'function:fn_b');
    return grid === fn.grid && grid[0].type === 'always' &&
      created && typeof created === 'object' && fresh.grid === created;
  })());
check('getGridDataForScope returns an unstored {} for an unknown function id',
  (() => {
    const store = { scenes: [], globalGridData: {}, functions: [] };
    const g1 = G.getGridDataForScope(store, 'function:fn_nope');
    const g2 = G.getGridDataForScope(store, 'function:fn_nope');
    return JSON.stringify(g1) === '{}' && g1 !== g2;
  })());
check('saveGridToScope writes a function body grid and refuses an unknown function',
  (() => {
    const fn = { id: 'fn_a', name: 'add', params: [], grid: { 0: { type: 'always' } } };
    const store = { scenes: [], globalGridData: {}, functions: [fn] };
    const cells = new Map();
    cells.set(60, { type: 'setVariable', varName: 'x', operation: 'set', value: 1 });
    const ok = G.saveGridToScope(store, 'function:fn_a', cells);
    const no = G.saveGridToScope(store, 'function:fn_nope', cells);
    return ok === true && no === false &&
      JSON.stringify(fn.grid) === JSON.stringify({ 60: { type: 'setVariable', varName: 'x', operation: 'set', value: 1 } });
  })());
check('getScopeKey returns the function scope key unchanged',
  G.getScopeKey('function:fn_a') === 'function:fn_a' &&
  G.getScopeKey('global') === 'global' && G.getScopeKey(3) === '3');

// --- execute dispatch (Call Function / Return From Function) ---
function makeExecCtx(over) {
  const warnings = [];
  const vars = {};
  const ctx = Object.assign({
    variables: vars,
    exprInfo: function (v) {
      const n = Number(v);
      return { ok: Number.isFinite(n), value: Number.isFinite(n) ? n : 0 };
    },
    warn: function (msg) { warnings.push(msg); },
    functionsModule: F,
    callFunction: function () { return { ok: true, value: 42 }; },
    returnFromFunction: function () { return true; }
  }, over || {});
  return { ctx: ctx, vars: vars, warnings: warnings };
}
check('execute: Call Function stores the host return value into the flat variable',
  (() => {
    const h = makeExecCtx();
    X.executeAction({ type: 'callFunction', functionName: 'add', arg1: '3', arg2: '4', storeVarName: 'result' }, h.ctx, 0);
    return h.vars.result === 42 && h.warnings.length === 0;
  })());
check('execute: Call Function passes all eight arguments in order',
  (() => {
    let seen = null;
    const h = makeExecCtx({
      callFunction: function (name, args) { seen = { name: name, args: args }; return { ok: true, value: 0 }; }
    });
    X.executeAction({ type: 'callFunction', functionName: 'sum8',
      arg1: '1', arg2: '2', arg3: '3', arg4: '4', arg5: '5', arg6: '6', arg7: '7', arg8: '8',
      storeVarName: '' }, h.ctx, 0);
    return seen && seen.name === 'sum8' &&
      JSON.stringify(seen.args) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8]);
  })());
check('execute: Call Function passes consecutive arguments and stops at the first blank',
  (() => {
    let seen = null;
    const h = makeExecCtx({
      callFunction: function (name, args) { seen = { name: name, args: args }; return { ok: true, value: 0 }; }
    });
    X.executeAction({ type: 'callFunction', functionName: 'add', arg1: '3', arg2: '', arg3: '9', storeVarName: '' }, h.ctx, 0);
    return seen && seen.name === 'add' && JSON.stringify(seen.args) === JSON.stringify([3]);
  })());
check('execute: Call Function warns and holds on a blank name, a missing function, and a bad argument',
  (() => {
    const h1 = makeExecCtx();
    X.executeAction({ type: 'callFunction', functionName: '', arg1: '', storeVarName: 'r' }, h1.ctx, 0);
    const h2 = makeExecCtx({ callFunction: function () { return { ok: false, reason: 'missing' }; } });
    X.executeAction({ type: 'callFunction', functionName: 'nope', arg1: '', storeVarName: 'r' }, h2.ctx, 0);
    const h3 = makeExecCtx();
    X.executeAction({ type: 'callFunction', functionName: 'add', arg1: 'oops', storeVarName: 'r' }, h3.ctx, 0);
    return h1.warnings.length === 1 && /blank/.test(h1.warnings[0]) && h1.vars.r === undefined &&
      h2.warnings.length === 1 && /no function named/.test(h2.warnings[0]) &&
      h3.warnings.length === 1 && /argument 1/.test(h3.warnings[0]) && h3.vars.r === undefined;
  })());
check('execute: Call Function warns on the recursion cap and stores nothing',
  (() => {
    const h = makeExecCtx({ callFunction: function () { return { ok: false, reason: 'depth' }; } });
    X.executeAction({ type: 'callFunction', functionName: 'self', arg1: '', storeVarName: 'r' }, h.ctx, 0);
    return h.warnings.length === 1 && /too deeply/.test(h.warnings[0]) && h.vars.r === undefined;
  })());
check('execute: Call Function with no Into variable discards the return value quietly',
  (() => {
    const h = makeExecCtx();
    X.executeAction({ type: 'callFunction', functionName: 'add', arg1: '1', storeVarName: '' }, h.ctx, 0);
    return Object.keys(h.vars).length === 0 && h.warnings.length === 0;
  })());
check('execute: Call Function with no host hook stays quiet',
  (() => {
    const h = makeExecCtx({ callFunction: undefined });
    X.executeAction({ type: 'callFunction', functionName: 'add', arg1: '1', storeVarName: 'r' }, h.ctx, 0);
    return h.vars.r === undefined && h.warnings.length === 0;
  })());
check('execute: Return From Function passes the value to the host hook',
  (() => {
    let seen = null;
    const h = makeExecCtx({ returnFromFunction: function (v) { seen = v; return true; } });
    X.executeAction({ type: 'returnFromFunction', value: '7' }, h.ctx, 0);
    return seen === 7 && h.warnings.length === 0;
  })());
check('execute: Return From Function with a blank value returns 0',
  (() => {
    let seen = null;
    const h = makeExecCtx({ returnFromFunction: function (v) { seen = v; return true; } });
    X.executeAction({ type: 'returnFromFunction', value: '' }, h.ctx, 0);
    return seen === 0 && h.warnings.length === 0;
  })());
check('execute: Return From Function warns on a bad value and outside a function',
  (() => {
    const h1 = makeExecCtx();
    X.executeAction({ type: 'returnFromFunction', value: 'oops' }, h1.ctx, 0);
    const h2 = makeExecCtx({ returnFromFunction: function () { return false; } });
    X.executeAction({ type: 'returnFromFunction', value: '1' }, h2.ctx, 0);
    return h1.warnings.length === 1 && /not a number/.test(h1.warnings[0]) &&
      h2.warnings.length === 1 && /only works inside a function/.test(h2.warnings[0]);
  })());

// --- conditions read the local scope ---
check('conditions: Scoped Variable Check reads a local variable through the module',
  (() => {
    const st = V.createVariablesState();
    V.set(st, 'local', 'a', 5);
    const ctx = {
      varScopesModule: V, varScopes: st, sceneId: 1,
      expr: function (v) { return Number(v); }
    };
    const r = C.evaluateCondition(
      { type: 'scopedVariableCheck', scope: 'local', varName: 'a', operator: '>=', compareValue: 5 },
      ctx, 'global', 0);
    const miss = C.evaluateCondition(
      { type: 'scopedVariableCheck', scope: 'local', varName: 'nope', operator: '>=', compareValue: 1 },
      ctx, 'global', 0);
    return r && r.triggered === true && miss && miss.triggered === false;
  })());
check('conditions: Scoped Variable Exists reads a local variable through the module',
  (() => {
    const st = V.createVariablesState();
    V.set(st, 'local', 'a', 5);
    const ctx = { varScopesModule: V, varScopes: st, sceneId: 1, expr: function (v) { return Number(v); } };
    const yes = C.evaluateCondition(
      { type: 'scopedVariableExists', scope: 'local', varName: 'a' }, ctx, 'global', 0);
    const no = C.evaluateCondition(
      { type: 'scopedVariableExists', scope: 'local', varName: 'nope' }, ctx, 'global', 0);
    return yes && yes.triggered === true && no && no.triggered === false;
  })());
check('conditions: Scoped Variable Check reads a local variable through the raw fallback without the module',
  (() => {
    const st = { global: {}, scene: {}, object: {}, local: { a: { type: 'number', value: 5 } } };
    const ctx = { varScopesModule: null, varScopes: st, sceneId: 1, expr: function (v) { return Number(v); } };
    const r = C.evaluateCondition(
      { type: 'scopedVariableCheck', scope: 'local', varName: 'a', operator: '==', compareValue: 5 },
      ctx, 'global', 0);
    return r && r.triggered === true;
  })());

// --- static wiring pins ---
const CATALOG_SRC = fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8');
const INDEX_HTML = fs.readFileSync(path.join(HYDRA, 'index.html'), 'utf8');
const PLAYER_RUNTIME = fs.readFileSync(path.join(HYDRA, 'player-runtime.js'), 'utf8');
const PREVIEWRUNTIME = fs.readFileSync(path.join(HYDRA, 'hydra-previewruntime.js'), 'utf8');
const EXECUTE_SRC = fs.readFileSync(path.join(HYDRA, 'hydra-execute.js'), 'utf8');
const CONDITIONS_SRC = fs.readFileSync(path.join(HYDRA, 'hydra-conditions.js'), 'utf8');
const UNIVERSAL_SRC = fs.readFileSync(path.join(HYDRA, 'hydra-universal.js'), 'utf8');
const SCRIPT_JS = fs.readFileSync(path.join(HYDRA, 'script.js'), 'utf8');
const STYLE_CSS = fs.readFileSync(path.join(HYDRA, 'style.css'), 'utf8');
const GUIDE = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');
const REF = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');

const sb2 = {}; sb2.window = sb2; vm.createContext(sb2);
vm.runInContext(CATALOG_SRC, sb2, { filename: 'block-catalog.js' });
const catalog = sb2.HydraBlockCatalog.blocks;
check('catalog holds 556 blocks (was 552, +4 attach)',
  catalog.length === 556, `got ${catalog.length}`);
check('catalog validates clean',
  JSON.stringify(sb2.HydraBlockCatalog.validateCatalog()) === '[]');
const fnBlocks = catalog.filter(b => b.category === 'Functions');
check('Functions category holds Call Function then Return From Function',
  fnBlocks.length === 2 &&
  fnBlocks[0].blockType === 'call-function' && fnBlocks[0].runtimeType === 'callFunction' &&
  fnBlocks[1].blockType === 'return-from-function' && fnBlocks[1].runtimeType === 'returnFromFunction');
check('Call Function block fields: Function picker, eight arguments, Into variable',
  (() => {
    const b = fnBlocks[0];
    const keys = b.fields.map(f => f.key);
    return JSON.stringify(keys) === JSON.stringify(['functionName', 'arg1', 'arg2', 'arg3', 'arg4', 'arg5', 'arg6', 'arg7', 'arg8', 'storeVarName']) &&
      b.fields[0].control === 'function' &&
      b.fields.slice(1, 9).every(f => f.control === 'expr') &&
      b.defaults.functionName === '' && b.defaults.storeVarName === '' &&
      b.defaults.arg8 === '';
  })());
check('Return From Function block fields: one expression value',
  (() => {
    const b = fnBlocks[1];
    return b.fields.length === 1 && b.fields[0].key === 'value' && b.fields[0].control === 'expr';
  })());
check('FIELD_CONTROLS names the function picker',
  !!sb2.HydraBlockCatalog.FIELD_CONTROLS.function);
check('all six scoped-variable blocks offer the Local scope',
  catalog.filter(b => ['setScopedVariable', 'readScopedVariable', 'deleteScopedVariable',
    'clearScopedVariables', 'scopedVariableExists', 'scopedVariableCheck'].includes(b.runtimeType))
    .every(b => {
      const scopeField = (b.fields || []).find(f => f.key === 'scope');
      return scopeField && scopeField.options.some(o => o[0] === 'local');
    }));
check('index.html loads hydra-functions.js before player-runtime.js',
  INDEX_HTML.indexOf('hydra-functions.js') !== -1 &&
  INDEX_HTML.indexOf('hydra-functions.js') < INDEX_HTML.indexOf('player-runtime.js'));
check('index.html has the Functions inspector tab and panel',
  INDEX_HTML.includes('data-inspector-tab="functions"') &&
  INDEX_HTML.includes('data-inspector-panel="functions"') &&
  INDEX_HTML.includes('id="functions-panel"'));
check('player-runtime throws a clear error without hydra-functions.js',
  /HydraScript player runtime requires hydra-functions\.js/.test(PLAYER_RUNTIME));
check('player-runtime inlines the functions module into exports',
  PLAYER_RUNTIME.includes("'HydraFunctions', global.HydraFunctions && global.HydraFunctions.factorySource"));
check('player-runtime routes the function blocks and reads function body grids',
  PLAYER_RUNTIME.includes('HydraFunctions.isFunctionAction(type)') &&
  PLAYER_RUNTIME.includes('function callFunction(state, name, args)') &&
  PLAYER_RUNTIME.includes('function returnFromFunction(state, value)') &&
  PLAYER_RUNTIME.includes("HydraFunctions.functionIdOfScope(scope)"));
check('player-runtime gates the body on Return through the dispatch hooks',
  PLAYER_RUNTIME.includes('fnFrame && fnFrame.returned'));
check('preview runtime runs functions through the same hooks and resets the stack on a fresh run',
  PREVIEWRUNTIME.includes('function callPreviewFunction(name, args)') &&
  PREVIEWRUNTIME.includes('function returnPreviewFunction(value)') &&
  PREVIEWRUNTIME.includes('resetFunctionsCallState();') &&
  PREVIEWRUNTIME.includes('processScriptGrid(scope, fnFrame)') &&
  PREVIEWRUNTIME.includes("functionsModule: mod('Functions')"));
check('execute dispatches Call Function and Return From Function',
  EXECUTE_SRC.includes("isType(ctx.functionsModule, 'isFunctionAction', type)") &&
  EXECUTE_SRC.includes("type === 'callFunction'") &&
  EXECUTE_SRC.includes("type === 'returnFromFunction'"));
check('conditions raw fallback reads the local map',
  CONDITIONS_SRC.includes("} else if (s === 'local') {") &&
  CONDITIONS_SRC.includes('map = state.local;'));
check('universal normalizer stores project.functions',
  UNIVERSAL_SRC.includes('project.functions = window.HydraFunctions.normalizeFunctions(project.functions)'));
check('editor exposes the function list to the preview host',
  SCRIPT_JS.includes('function getMutableFunctions()') &&
  SCRIPT_JS.includes('function getProjectFunctions()') &&
  SCRIPT_JS.includes('getProjectId, getProjectScopedVariables, getProjectFunctions,'));
check('editor renders the Functions manager panel',
  SCRIPT_JS.includes('function renderFunctionsPanel()') &&
  SCRIPT_JS.includes('function initFunctionsPanel()') &&
  SCRIPT_JS.includes("document.getElementById('functions-panel')") &&
  SCRIPT_JS.includes("nameInput.id = 'fn-add-name'") &&
  SCRIPT_JS.includes("addBtn.id = 'fn-add-btn'"));
check('the function row badge keeps parameter case (its own class, no uppercase transform)',
  SCRIPT_JS.includes("badge.className = 'fn-params';") &&
  STYLE_CSS.includes('.var-row .fn-params {') &&
  !/\.var-row \.fn-params \{[^}]*text-transform/s.test(STYLE_CSS));
check('function rows wrap so a long parameter list cannot squeeze the name away',
  SCRIPT_JS.includes("row.className = 'input-action-row var-row fn-row';") &&
  SCRIPT_JS.includes("if (fn.params.length) badge.title = fn.params.join(', ');") &&
  STYLE_CSS.includes('.fn-row .var-top {') &&
  /\.fn-row \.var-top \{[^}]*flex-wrap: wrap/s.test(STYLE_CSS) &&
  /\.fn-row \.var-name \{[^}]*min-width: 48px/s.test(STYLE_CSS) &&
  /\.fn-row \.var-value \{[^}]*flex: 0 1 72px/s.test(STYLE_CSS) &&
  /\.fn-row \.fn-params \{[^}]*max-width: 180px/s.test(STYLE_CSS) &&
  /\.fn-row \.fn-params \{[^}]*text-overflow: ellipsis/s.test(STYLE_CSS));
check('Functions panel hint names the eight-parameter cap',
  INDEX_HTML.includes('up to eight parameters') && !INDEX_HTML.includes('up to four parameters'));
check('the Variables type badge still uses the uppercasing var-type class',
  SCRIPT_JS.includes("badge.className = 'var-type';"));
check('normalizeFunction keeps all eight parameters',
  (() => {
    const n = F.normalizeFunction({ name: 'sum8', params: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], grid: {} });
    return !!n && JSON.stringify(n.params) === JSON.stringify(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  })());
check('editor scope tabs list functions and the Function picker reads them',
  SCRIPT_JS.includes("t.textContent = 'ƒ ' + fn.name;") &&
  SCRIPT_JS.includes("case 'function':") &&
  SCRIPT_JS.includes("info.textContent = `Function body: ${fn ? fn.name : '?'} — only runs when Call Function names it`"));
check('Call Function panel is a dynamic argument editor: one field per parameter, labeled with the parameter name',
  SCRIPT_JS.includes('function showCallFunctionProperties(cellIndex, block, data, root)') &&
  SCRIPT_JS.includes("if (block.blockType === 'call-function') {") &&
  SCRIPT_JS.includes("fnInput.addEventListener('change', () => showCatalogBlockProperties(cellIndex, block))") &&
  SCRIPT_JS.includes("const fn = (F && fnName) ? F.findFunction(fns, fnName) : null;") &&
  SCRIPT_JS.includes("fn.params.forEach((param, i) => {") &&
  SCRIPT_JS.includes("const key = 'arg' + (i + 1);") &&
  SCRIPT_JS.includes("root.appendChild(makePropGroup(param, makeExprInput(") &&
  SCRIPT_JS.includes('Pick a function first — one argument field appears per parameter') &&
  SCRIPT_JS.includes('takes no arguments.'));
check('Functions manager placeholders name the eight-parameter cap',
  (SCRIPT_JS.match(/Parameters, comma-separated \(up to 8\)/g) || []).length === 2 &&
  !SCRIPT_JS.includes('Parameters, comma-separated (up to 4)'));
check('block reference documents both function blocks and the eight-parameter cap',
  REF.includes('Call Function') && REF.includes('Return From Function') &&
  REF.includes('up to eight parameters') && REF.includes('one argument field per parameter'));
check('user guide documents functions and the eight-parameter cap',
  GUIDE.includes('**Functions.**') && GUIDE.includes('Call Function') &&
  GUIDE.includes('Return From Function') &&
  GUIDE.includes('up to eight parameters') &&
  GUIDE.includes('one argument field per parameter') &&
  !GUIDE.includes('up to four parameters'));
check('slice c: the Functions manager offers Duplicate on every row',
  SCRIPT_JS.includes("dupBtn.textContent = 'Duplicate';") &&
  SCRIPT_JS.includes("dupBtn.setAttribute('aria-label', 'Duplicate function ' + fn.name);") &&
  SCRIPT_JS.includes('const copy = F.duplicateFunction(fns, fn);') &&
  SCRIPT_JS.includes('fns.push(copy);'));
check('slice c: each function row says how many times it is called',
  SCRIPT_JS.includes('const refs = countFunctionReferences(fn.name);') &&
  SCRIPT_JS.includes("' Not called yet.'") &&
  SCRIPT_JS.includes("' Called once.'") &&
  SCRIPT_JS.includes("' Called ' + refs + ' times.'"));
check('slice c: a dropped parameter is reported in the panel, not trimmed silently',
  SCRIPT_JS.includes('function fnParamsDropNote(report)') &&
  SCRIPT_JS.includes("paramsNote.id = 'fn-params-note';") &&
  SCRIPT_JS.includes('lastFnParamsNote = fnParamsDropNote(report);') &&
  SCRIPT_JS.includes('const report = F.normalizeParamsReport(') &&
  (SCRIPT_JS.match(/const report = F\.normalizeParamsReport\(/g) || []).length === 2 &&
  SCRIPT_JS.includes("'Dropped duplicate ' + names + '.'") &&
  SCRIPT_JS.includes("'Dropped ' + names + ' past the 8-parameter cap.'") &&
  !/Kept ' \+ kept \+ ' —/.test(SCRIPT_JS));
check('slice c: user guide documents Duplicate, the call count, and the dropped-parameter note',
  GUIDE.includes('Duplicate copies a function under a new name like add copy') &&
  GUIDE.includes('how many times the function is called') &&
  GUIDE.includes('tells you which ones it dropped instead of trimming the list silently'));

if (failures > 0) { console.log(`\n${failures} FAILURE(S)`); process.exit(1); }
