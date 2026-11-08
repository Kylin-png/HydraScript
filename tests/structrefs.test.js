// Unit tests for object references inside structures (P5 core-engine
// track, item P5-6: Data structures, slice b — Store Object In
// Structure writes the handle a scoped variable holds into a list or
// dictionary at a nested path, Read Object From Structure reads the
// handle at a path back into a scoped variable).
//
// A handle is plain JSON-safe data ({ __objectRef, name, id }), so a
// list of live objects is a list of handles: the store builds the
// containers on the way down like Set Nested Value, and the read
// clears the variable to the empty handle when the step is missing or
// the value is not an object, the way a nested read of a missing step
// reads as 0. The dispatch integration at the end runs real grids
// through HydraDispatch + HydraFlow, so the store-read-damage flow
// and the manual-path agreement are pinned by behavior, not by
// reading the code. Static checks at the end pin the wiring: catalog
// blocks, both runtimes' action contexts, the export inlining list,
// and the docs.

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
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-variables.js'), 'utf8'),
  sandbox, { filename: 'hydra-variables.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-collections.js'), 'utf8'),
  sandbox, { filename: 'hydra-collections.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-pick.js'), 'utf8'),
  sandbox, { filename: 'hydra-pick.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-health.js'), 'utf8'),
  sandbox, { filename: 'hydra-health.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-sceneinit.js'), 'utf8'),
  sandbox, { filename: 'hydra-sceneinit.js' });
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
const V = sandbox.HydraVariables;
const C = sandbox.HydraCollections;
const P = sandbox.HydraPick;
const H = sandbox.HydraHealth;
const SI = sandbox.HydraSceneInit;
const E = sandbox.HydraExpr;
const FL = sandbox.HydraFlow;
const D = sandbox.HydraDispatch;
const X = sandbox.HydraExecute;

function goblinDef(id, x, y, health) {
  return {
    id: id, name: 'goblin', kind: 'sprite', posX: x, posY: y, width: 40, height: 40,
    color: '#888888', static: false, physicsEnabled: false, health: health, maxHealth: 100,
    collision: { shape: 'box', mode: 'solid', layer: 0, mask: 255 }
  };
}
function heroObj() {
  return {
    id: 9, name: 'hero', kind: 'sprite', posX: 0, posY: 200, width: 40, height: 40,
    color: '#888888', static: false, physicsEnabled: false, health: 100, maxHealth: 100,
    collision: { shape: 'box', mode: 'solid', layer: 0, mask: 255 }
  };
}

// A harness with a live object list the spawn pushes clones into, a
// separate authored-defs list the spawn clones from (the way a scene's
// objects are the templates and state.objects the live list), and a
// pendingDestroy set the destroy marks — named() excludes pending
// destroys, the way both runtimes' named() does. The collections
// module rides on the context so the nested-path blocks dispatch
// through the same executeAction as the other object-reference
// blocks.
function makeCtx(defs, live, o) {
  o = o || {};
  const vars = {};
  const warnings = [];
  const varScopes = V.createVariablesState();
  const pendingDestroy = new Set();
  const destroyed = new Set();
  const liveOf = function (name) {
    return live.filter(function (x) {
      return x.name === name && !pendingDestroy.has(x.id) && !destroyed.has(x.id);
    });
  };
  const ctx = {
    variables: vars,
    expr: function (v) { return E.evaluate(v, { variables: vars }).value; },
    exprInfo: function (v) { return E.evaluate(v, { variables: vars }); },
    warn: function (m) { warnings.push(m); },
    varScopesModule: V,
    varScopes: varScopes,
    collections: C,
    collectionHooks: function () {
      return {
        num: (raw) => E.evaluate(raw, { variables: vars }),
        warn: (m) => warnings.push(m),
        lookupVar: (n) => vars[n]
      };
    },
    pick: P,
    pickHooks: function () {
      return {
        liveObjects: function (name) { return liveOf(name); },
        num: (raw) => E.evaluate(raw, { variables: vars }),
        warn: (m) => warnings.push(m)
      };
    },
    named: function (name) { return liveOf(name); },
    allObjects: function () {
      return live.filter(function (x) { return !pendingDestroy.has(x.id) && !destroyed.has(x.id); });
    },
    objects: live,
    pendingDestroy: pendingDestroy,
    destroyed: destroyed,
    sceneObjectDefs: function () { return defs.slice(); },
    sceneInit: SI,
    sceneInitHooks: function () { return { warn: function (m) { warnings.push(m); } }; },
    executionContext: null,
    setExecutionContext: function (c) { ctx.executionContext = c || null; },
    healthModule: H,
    sceneId: 1
  };
  if (o.noSetCtx) delete ctx.setExecutionContext;
  if (o.noVarScopes) delete ctx.varScopes;
  if (o.noCollections) delete ctx.collections;
  return { ctx: ctx, vars: vars, warnings: warnings, varScopes: varScopes, live: live, pendingDestroy: pendingDestroy, destroyed: destroyed };
}

function spawn(data) {
  return Object.assign({
    type: 'spawnObjectIntoVariable', sourceObject: 'goblin', spawnX: 600, spawnY: 120,
    varName: 'foe', scope: 'global', targetObject: ''
  }, data || {});
}
function store(data) {
  return Object.assign({
    type: 'nestedStoreObject', varName: 'squad', path: '[0]',
    objectVar: 'foe', scope: 'global', targetObject: ''
  }, data || {});
}
function readObj(data) {
  return Object.assign({
    type: 'nestedReadObject', varName: 'squad', path: '[0]',
    objectVar: 'mate', scope: 'global', targetObject: ''
  }, data || {});
}
function readProp(data) {
  return Object.assign({
    type: 'readObjectProperty', varName: 'mate', scope: 'global', targetObject: '',
    property: 'x', storeVarName: 'mateX'
  }, data || {});
}
function nestedGet(data) {
  return Object.assign({
    type: 'nestedGet', varName: 'squad', path: '[0]', storeVarName: 'flatCopy'
  }, data || {});
}
function nestedSet(data) {
  return Object.assign({
    type: 'nestedSet', varName: 'squad', path: '[0]', valueKind: 'number', value: 0
  }, data || {});
}

// --- module surface ---

check('isObjectRefAction names all eight object-reference blocks',
  V.isObjectRefAction('pickObjectIntoVariable') && V.isObjectRefAction('readObjectProperty') &&
  V.isObjectRefAction('raycastIntoVariables') && V.isObjectRefAction('listOverlappingObjects') &&
  V.isObjectRefAction('spawnObjectIntoVariable') && V.isObjectRefAction('destroyObjectInVariable') &&
  V.isObjectRefAction('nestedStoreObject') && V.isObjectRefAction('nestedReadObject') &&
  !V.isObjectRefAction('setScopedVariable') && !V.isObjectRefAction('setVariable') &&
  !V.isObjectRefAction('damageObject') && !V.isObjectRefAction('spawnObject') &&
  !V.isObjectRefAction('nestedGet') && !V.isObjectRefAction('nestedSet'));

// --- Store Object In Structure ---

check('execute: Store Object In Structure stores the spawned clone handle at the path',
  (() => {
    const defs = [goblinDef(1, 300, 100, 70)];
    const live = [goblinDef(1, 300, 100, 70), heroObj()];
    const h = makeCtx(defs, live);
    X.executeAction(spawn(), h.ctx, 1);
    X.executeAction(store(), h.ctx, 2);
    const held = V.get(h.varScopes, 'global', 'foe');
    const squad = h.vars.squad;
    return Array.isArray(squad) && squad.length === 1 &&
      squad[0] && squad[0].__objectRef === true && squad[0].name === 'goblin' &&
      squad[0].id === held.value.id && String(squad[0].id).indexOf('spawn_') === 0 &&
      h.warnings.length === 0;
  })(), 'the squad list holds the clone handle, with the spawn id');
check('execute: Store Object In Structure builds the list with 0-fill and the dictionary on the way down',
  (() => {
    const defs = [goblinDef(1, 300, 100, 70)];
    const live = [goblinDef(1, 300, 100, 70)];
    const h = makeCtx(defs, live);
    X.executeAction(spawn(), h.ctx, 1);
    X.executeAction(store({ path: '[1]' }), h.ctx, 2);
    X.executeAction(store({ varName: 'team', path: 'leader' }), h.ctx, 3);
    return Array.isArray(h.vars.squad) && h.vars.squad.length === 2 &&
      h.vars.squad[0] === 0 && h.vars.squad[1] && h.vars.squad[1].__objectRef === true &&
      h.vars.team && h.vars.team.leader && h.vars.team.leader.__objectRef === true &&
      h.vars.team.leader.id === h.vars.squad[1].id && h.warnings.length === 0;
  })(), 'index [1] grows the list with a 0 first; the field step makes the dictionary');
check('execute: Store Object In Structure replaces a plain root, like Set Nested Value',
  (() => {
    const defs = [goblinDef(1, 300, 100, 70)];
    const live = [goblinDef(1, 300, 100, 70)];
    const h = makeCtx(defs, live);
    h.vars.score = 7;
    X.executeAction(spawn(), h.ctx, 1);
    X.executeAction(store({ varName: 'score', path: 'captain' }), h.ctx, 2);
    return h.vars.score && h.vars.score.captain && h.vars.score.captain.__objectRef === true &&
      h.warnings.length === 0;
  })(), 'the number 7 becomes a dictionary holding the handle');
check('execute: Store Object In Structure stores a copy, so a later re-pick never changes the stored handle',
  (() => {
    const defs = [goblinDef(1, 300, 100, 70)];
    const live = [goblinDef(1, 300, 100, 70)];
    const h = makeCtx(defs, live);
    X.executeAction(spawn(), h.ctx, 1);
    const first = V.get(h.varScopes, 'global', 'foe').value.id;
    X.executeAction(store(), h.ctx, 2);
    X.executeAction(spawn({ spawnX: 100, spawnY: 200 }), h.ctx, 3);
    const second = V.get(h.varScopes, 'global', 'foe').value.id;
    return first !== second && h.vars.squad[0].id === first &&
      h.vars.squad[0].id !== second && h.warnings.length === 0;
  })(), 'the variable moved on to the second clone; the stored handle still names the first');
check('execute: Store Object In Structure of a variable holding no object stores the empty handle and stays quiet',
  (() => {
    const defs = [goblinDef(1, 300, 100, 70)];
    const live = [goblinDef(1, 300, 100, 70)];
    const h = makeCtx(defs, live);
    X.executeAction(spawn({ sourceObject: 'ghost' }), h.ctx, 1);
    X.executeAction(store(), h.ctx, 2);
    X.executeAction(readObj(), h.ctx, 3);
    X.executeAction(readProp({ property: 'alive', storeVarName: 'mateAlive' }), h.ctx, 4);
    return h.vars.squad[0] && h.vars.squad[0].__objectRef === true &&
      h.vars.squad[0].name === '' && h.vars.squad[0].id === '' &&
      h.vars.mateAlive === 0 && h.warnings.length === 0;
  })(), 'a missing spawn leaves an empty handle in the list, and it reads as gone');
check('execute: Store Object In Structure warns and holds on a blank variable, blank path, blank object variable, or object scope with no object',
  (() => {
    const defs = [goblinDef(1, 300, 100, 70)];
    const mk = function () {
      const h = makeCtx(defs, [goblinDef(1, 300, 100, 70)]);
      X.executeAction(spawn(), h.ctx, 1);
      return h;
    };
    const h1 = mk();
    X.executeAction(store({ varName: '' }), h1.ctx, 2);
    const h2 = mk();
    X.executeAction(store({ path: '  ' }), h2.ctx, 2);
    const h3 = mk();
    X.executeAction(store({ objectVar: '' }), h3.ctx, 2);
    const h4 = mk();
    X.executeAction(store({ scope: 'object', targetObject: '' }), h4.ctx, 2);
    return h1.warnings.length === 1 && /variable name is blank/.test(h1.warnings[0]) &&
      !('' in h1.vars) && !h1.vars.squad &&
      h2.warnings.length === 1 && /path is blank/.test(h2.warnings[0]) && !h2.vars.squad &&
      h3.warnings.length === 1 && /object variable is blank/.test(h3.warnings[0]) && !h3.vars.squad &&
      h4.warnings.length === 1 && /object scope needs an object/.test(h4.warnings[0]) && !h4.vars.squad;
  })());
check('execute: Store Object In Structure past the list cap warns and the list stays empty',
  (() => {
    const defs = [goblinDef(1, 300, 100, 70)];
    const live = [goblinDef(1, 300, 100, 70)];
    const h = makeCtx(defs, live);
    X.executeAction(spawn(), h.ctx, 1);
    X.executeAction(store({ path: '[10000]' }), h.ctx, 2);
    return h.warnings.length === 1 && /out of range/.test(h.warnings[0]) &&
      Array.isArray(h.vars.squad) && h.vars.squad.length === 0;
  })(), 'the write never lands; the empty list is the root Set Nested Value would have built first');
check('execute: Store Object In Structure with no scoped-variable state stays quiet and writes nothing',
  (() => {
    const defs = [goblinDef(1, 300, 100, 70)];
    const live = [goblinDef(1, 300, 100, 70)];
    const h = makeCtx(defs, live, { noVarScopes: true });
    X.executeAction(store(), h.ctx, 1);
    return !h.vars.squad && h.warnings.length === 0;
  })());
check('execute: Store Object In Structure with no collections module stays quiet and writes nothing',
  (() => {
    const defs = [goblinDef(1, 300, 100, 70)];
    const live = [goblinDef(1, 300, 100, 70)];
    const h = makeCtx(defs, live, { noCollections: true });
    X.executeAction(spawn(), h.ctx, 1);
    X.executeAction(store(), h.ctx, 2);
    return !h.vars.squad && h.warnings.length === 0;
  })());

// --- Read Object From Structure ---

check('execute: Read Object From Structure reads the stored handle back and points the context at it',
  (() => {
    const defs = [goblinDef(1, 300, 100, 70)];
    const live = [goblinDef(1, 300, 100, 70), heroObj()];
    const h = makeCtx(defs, live);
    X.executeAction(spawn({ varName: 'foeA' }), h.ctx, 1);
    X.executeAction(spawn({ varName: 'foeB', spawnX: 100, spawnY: 200 }), h.ctx, 2);
    X.executeAction(store({ objectVar: 'foeA', path: '[0]' }), h.ctx, 3);
    X.executeAction(store({ objectVar: 'foeB', path: '[1]' }), h.ctx, 4);
    X.executeAction(readObj({ path: '[1]' }), h.ctx, 5);
    const mate = V.get(h.varScopes, 'global', 'mate');
    const foeB = V.get(h.varScopes, 'global', 'foeB');
    const cloneB = live.find(function (o) { return o.id === foeB.value.id; });
    X.executeAction(readProp({ property: 'x', storeVarName: 'mateX' }), h.ctx, 6);
    return mate && mate.type === 'object' && mate.value.id === foeB.value.id &&
      h.vars.mateX === 100 &&
      h.ctx.executionContext && h.ctx.executionContext.obj1 === cloneB &&
      h.warnings.length === 0;
  })(), 'the second member reads back as the second clone at X 100, and the context narrows to it');
check('execute: Read Object From Structure of a missing step clears the variable to the empty handle and stays quiet',
  (() => {
    const defs = [goblinDef(1, 300, 100, 70)];
    const live = [goblinDef(1, 300, 100, 70)];
    const h = makeCtx(defs, live);
    X.executeAction(spawn(), h.ctx, 1);
    X.executeAction(store(), h.ctx, 2);
    X.executeAction(readObj({ path: '[9]' }), h.ctx, 3);
    X.executeAction(readProp({ property: 'alive', storeVarName: 'mateAlive' }), h.ctx, 4);
    const mate = V.get(h.varScopes, 'global', 'mate');
    return mate && mate.type === 'object' && mate.value.name === '' && mate.value.id === '' &&
      h.vars.mateAlive === 0 && h.warnings.length === 0;
  })(), 'no step, no object — the variable never holds a stale member');
check('execute: Read Object From Structure of a value that is not an object clears the variable and stays quiet',
  (() => {
    const defs = [goblinDef(1, 300, 100, 70)];
    const live = [goblinDef(1, 300, 100, 70)];
    const h = makeCtx(defs, live);
    X.executeAction(nestedSet({ varName: 'squad', path: '[0].hp', valueKind: 'number', value: '30' }), h.ctx, 1);
    X.executeAction(readObj({ path: '[0].hp' }), h.ctx, 2);
    X.executeAction(readProp({ property: 'alive', storeVarName: 'mateAlive' }), h.ctx, 3);
    const mate = V.get(h.varScopes, 'global', 'mate');
    return mate && mate.type === 'object' && mate.value.name === '' &&
      h.vars.mateAlive === 0 && h.warnings.length === 0;
  })(), 'a number at the path is not an object, so the read stores "no object"');
check('execute: Read Object From Structure of a destroyed member stores the handle but reads as gone and points at nothing',
  (() => {
    const defs = [goblinDef(1, 300, 100, 70)];
    const live = [goblinDef(1, 300, 100, 70)];
    const h = makeCtx(defs, live);
    X.executeAction(spawn(), h.ctx, 1);
    const cloneId = V.get(h.varScopes, 'global', 'foe').value.id;
    X.executeAction(store(), h.ctx, 2);
    X.executeAction({ type: 'destroyObjectInVariable', varName: 'foe', scope: 'global', targetObject: '' }, h.ctx, 3);
    X.executeAction(readObj(), h.ctx, 4);
    X.executeAction(readProp({ property: 'alive', storeVarName: 'mateAlive' }), h.ctx, 5);
    const mate = V.get(h.varScopes, 'global', 'mate');
    return mate && mate.value.id === cloneId && h.pendingDestroy.has(cloneId) &&
      h.vars.mateAlive === 0 && h.warnings.length === 0;
  })(), 'the handle survives the destroy, but the object is gone');
check('execute: Read Object From Structure warns and holds on a blank variable, blank path, blank object variable, or object scope with no object',
  (() => {
    const defs = [goblinDef(1, 300, 100, 70)];
    const mk = function () {
      const h = makeCtx(defs, [goblinDef(1, 300, 100, 70)]);
      X.executeAction(spawn(), h.ctx, 1);
      X.executeAction(store(), h.ctx, 2);
      return h;
    };
    const h1 = mk();
    X.executeAction(readObj({ varName: '' }), h1.ctx, 3);
    const h2 = mk();
    X.executeAction(readObj({ path: 'nope[' }), h2.ctx, 3);
    const h3 = mk();
    X.executeAction(readObj({ objectVar: '' }), h3.ctx, 3);
    const h4 = mk();
    X.executeAction(readObj({ scope: 'object', targetObject: '' }), h4.ctx, 3);
    return h1.warnings.length === 1 && /variable name is blank/.test(h1.warnings[0]) &&
      V.get(h1.varScopes, 'global', 'mate') === null &&
      h2.warnings.length === 1 && /path is blank/.test(h2.warnings[0]) &&
      V.get(h2.varScopes, 'global', 'mate') === null &&
      h3.warnings.length === 1 && /object variable is blank/.test(h3.warnings[0]) &&
      h4.warnings.length === 1 && /object scope needs an object/.test(h4.warnings[0]);
  })());
check('execute: Read Object From Structure without the context hook warns once and still stores the object',
  (() => {
    const defs = [goblinDef(1, 300, 100, 70)];
    const live = [goblinDef(1, 300, 100, 70)];
    const h = makeCtx(defs, live, { noSetCtx: true });
    // Plant the live goblin's handle directly, so no spawn runs and
    // the read is the only block that wants the context hook.
    V.set(h.varScopes, 'global', 'foe',
      { __objectRef: true, name: 'goblin', id: '1' }, { type: 'object' });
    X.executeAction(store(), h.ctx, 1);
    X.executeAction(readObj(), h.ctx, 2);
    const mate = V.get(h.varScopes, 'global', 'mate');
    return mate && mate.value.id === '1' &&
      h.warnings.length === 1 && /cannot point later actions/.test(h.warnings[0]);
  })());
check('execute: Read Object From Structure with no scoped-variable state stays quiet and stores nothing',
  (() => {
    const defs = [goblinDef(1, 300, 100, 70)];
    const live = [goblinDef(1, 300, 100, 70)];
    const h = makeCtx(defs, live, { noVarScopes: true });
    X.executeAction(readObj(), h.ctx, 1);
    return h.warnings.length === 0;
  })());
check('execute: Read Object From Structure with no collections module stays quiet and stores nothing',
  (() => {
    const defs = [goblinDef(1, 300, 100, 70)];
    const live = [goblinDef(1, 300, 100, 70)];
    const h = makeCtx(defs, live, { noCollections: true });
    X.executeAction(readObj(), h.ctx, 1);
    return V.get(h.varScopes, 'global', 'mate') === null && h.warnings.length === 0;
  })());

// --- dispatch integration: real grids through HydraDispatch + HydraFlow ---

function makeHost(grid, defs, live) {
  const vars = {};
  const warnings = [];
  const varScopes = V.createVariablesState();
  const startedScopes = new Set();
  const flowTriggerStates = {};
  const pendingDestroy = new Set();
  const destroyed = new Set();
  const liveOf = function (name) {
    return live.filter(function (x) {
      return x.name === name && !pendingDestroy.has(x.id) && !destroyed.has(x.id);
    });
  };
  const ctx = {
    variables: vars,
    expr: function (v) { return E.evaluate(v, { variables: vars }).value; },
    exprInfo: function (v) { return E.evaluate(v, { variables: vars }); },
    warn: function (m) { warnings.push(m); },
    varScopesModule: V,
    varScopes: varScopes,
    collections: C,
    collectionHooks: function () {
      return {
        num: (raw) => E.evaluate(raw, { variables: vars }),
        warn: (m) => warnings.push(m),
        lookupVar: (n) => vars[n]
      };
    },
    pick: P,
    pickHooks: function () {
      return {
        liveObjects: function (name) { return liveOf(name); },
        num: (raw) => E.evaluate(raw, { variables: vars }),
        warn: (m) => warnings.push(m)
      };
    },
    named: function (name) { return liveOf(name); },
    objects: live,
    pendingDestroy: pendingDestroy,
    destroyed: destroyed,
    sceneObjectDefs: function () { return defs.slice(); },
    sceneInit: SI,
    sceneInitHooks: function () { return { warn: function (m) { warnings.push(m); } }; },
    executionContext: null,
    setExecutionContext: function (c) { ctx.executionContext = c || null; },
    healthModule: H,
    sceneId: 1
  };
  const condCtx = {
    startedScopes: startedScopes,
    scopeKey: function () { return 'test'; },
    expr: function (v) { return E.evaluate(v, { variables: vars }).value; }
  };
  function isCond(t) { return t === 'gameStart' || t === 'always'; }
  function isAct(t) {
    return t === 'setVariable' || t === 'damageObject' || V.isObjectRefAction(t) ||
      V.isScopedVariableAction(t) || C.isCollectionAction(t);
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
    flowTriggerStates: flowTriggerStates,
    startedScopes: startedScopes,
    onTriggered: function () {},
    onPropagateCondition: function () {},
    reportUnknown: function (t) { warnings.push('unknown ' + t); }
  };
  return {
    vars: vars, warnings: warnings, varScopes: varScopes, ctx: ctx, live: live,
    pendingDestroy: pendingDestroy,
    run: function () { D.processScope(grid, 'test', hooks); }
  };
}

check('dispatch: spawn a goblin, store it, read it back, damage hits only that clone',
  (() => {
    const defs = [goblinDef(1, 300, 100, 70)];
    const live = [goblinDef(1, 300, 100, 70), heroObj()];
    const h = makeHost({
      0: { type: 'gameStart', kind: 'condition' },
      1: spawn(),
      2: store(),
      3: readObj(),
      4: { type: 'damageObject', kind: 'action', targetObject: 'goblin', amount: 10 },
      5: readProp({ property: 'health', storeVarName: 'mateHp' })
    }, defs, live);
    h.run();
    const mate = V.get(h.varScopes, 'global', 'mate');
    const clone = live.find(function (o) { return o.id === (mate && mate.value.id); });
    return mate && String(mate.value.id).indexOf('spawn_') === 0 &&
      clone && clone.health === 60 && live[0].health === 70 &&
      h.vars.mateHp === 60 && h.warnings.length === 0;
  })(), 'the stored-and-read-back clone takes the 10 damage; the original goblin is untouched');
check('dispatch: two clones in the squad, the second read back takes the damage, the first is untouched',
  (() => {
    const defs = [goblinDef(1, 300, 100, 70)];
    const live = [goblinDef(1, 300, 100, 70)];
    const h = makeHost({
      0: { type: 'gameStart', kind: 'condition' },
      1: spawn({ varName: 'foeA' }),
      2: spawn({ varName: 'foeB', spawnX: 100, spawnY: 200 }),
      3: store({ objectVar: 'foeA', path: '[0]' }),
      4: store({ objectVar: 'foeB', path: '[1]' }),
      5: readObj({ path: '[1]' }),
      6: { type: 'damageObject', kind: 'action', targetObject: 'goblin', amount: 10 },
      7: readProp({ property: 'health', storeVarName: 'mateHp' }),
      8: readProp({ varName: 'foeA', property: 'health', storeVarName: 'firstHp' })
    }, defs, live);
    h.run();
    return h.vars.mateHp === 60 && h.vars.firstHp === 70 && h.warnings.length === 0;
  })(), 'the read-back second clone is the damage target; the first clone keeps full health');
check('dispatch: the manual path agrees with the new blocks (nestedGet into a flat variable, then Read Object Property)',
  (() => {
    const defs = [goblinDef(1, 300, 100, 70)];
    const live = [goblinDef(1, 300, 100, 70)];
    const h = makeHost({
      0: { type: 'gameStart', kind: 'condition' },
      1: spawn(),
      2: store(),
      3: nestedGet(),
      4: readProp({ varName: 'flatCopy', property: 'x', storeVarName: 'copyX' }),
      5: readObj(),
      6: readProp({ property: 'x', storeVarName: 'mateX' })
    }, defs, live);
    h.run();
    return h.vars.copyX === 600 && h.vars.mateX === 600 && h.warnings.length === 0;
  })(), 'Get Nested Value hands the handle to a flat variable and Read Object Property reads X 600 from it, same as the read block');
check('dispatch: the manual store path agrees with the new store block (Read Scoped Variable, then Set Nested Value)',
  (() => {
    const defs = [goblinDef(1, 300, 100, 70)];
    const live = [goblinDef(1, 300, 100, 70)];
    const h = makeHost({
      0: { type: 'gameStart', kind: 'condition' },
      1: spawn(),
      2: { type: 'readScopedVariable', kind: 'action', varName: 'foe', scope: 'global', targetObject: '', storeVarName: 'foeFlat' },
      3: nestedSet({ varName: 'squad', path: '[0]', valueKind: 'variable', value: 'foeFlat' }),
      4: readObj(),
      5: readProp({ property: 'x', storeVarName: 'mateX' })
    }, defs, live);
    h.run();
    return h.vars.mateX === 600 && h.warnings.length === 0;
  })(), 'copying the handle through a flat variable stores the same clone the store block would');

// --- catalog + wiring + docs pins ---

const catSb = {};
catSb.window = catSb;
vm.createContext(catSb);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8'),
  catSb, { filename: 'block-catalog.js' });
const catalog = catSb.window.HydraBlockCatalog.blocks;

check('catalog holds 556 blocks (was 552, +4 attach)',
  catalog.length === 556, `got ${catalog.length}`);
check('Variables category holds the two object-in-structure blocks after Set Nested Value',
  (() => {
    const vars = catalog.filter(b => b.category === 'Variables');
    const types = vars.map(b => b.blockType);
    const at = types.indexOf('nested-set');
    return at !== -1 &&
      types[at + 1] === 'nested-store-object' &&
      types[at + 2] === 'nested-read-object';
  })());
check('Store Object In Structure declares the variable, path, object variable, and scope fields',
  (() => {
    const b = catalog.find(b => b.blockType === 'nested-store-object');
    if (!b) return false;
    const keys = (b.fields || []).map(f => f.key);
    return b.kind === 'action' && b.runtimeType === 'nestedStoreObject' &&
      JSON.stringify(keys) === JSON.stringify(['varName', 'path', 'objectVar', 'scope', 'targetObject']) &&
      b.defaults.varName === 'squad' && b.defaults.path === '[0]' &&
      b.defaults.objectVar === 'member' && b.defaults.scope === 'global';
  })());
check('Read Object From Structure declares the variable, path, object variable, and scope fields',
  (() => {
    const b = catalog.find(b => b.blockType === 'nested-read-object');
    if (!b) return false;
    const keys = (b.fields || []).map(f => f.key);
    return b.kind === 'action' && b.runtimeType === 'nestedReadObject' &&
      JSON.stringify(keys) === JSON.stringify(['varName', 'path', 'objectVar', 'scope', 'targetObject']) &&
      b.defaults.varName === 'squad' && b.defaults.path === '[0]' &&
      b.defaults.objectVar === 'member' && b.defaults.scope === 'global';
  })());
check('the two new catalog notes carry no em dashes',
  (() => {
    const notes = catalog.filter(b => b.blockType === 'nested-store-object' ||
      b.blockType === 'nested-read-object').map(b => b.note || '');
    return notes.length === 2 && notes.every(n => n.indexOf('\u2014') === -1);
  })());

const executeSrc = fs.readFileSync(path.join(HYDRA, 'hydra-execute.js'), 'utf8');
const exportSrc = fs.readFileSync(path.join(HYDRA, 'player-runtime.js'), 'utf8');
const previewSrc = fs.readFileSync(path.join(HYDRA, 'hydra-previewruntime.js'), 'utf8');
check('execute dispatches both new blocks in the object-reference branch',
  /type === 'nestedStoreObject'/.test(executeSrc) &&
  /type === 'nestedReadObject'/.test(executeSrc) &&
  /setPathValue\(soRoot, soParsed\.steps, soHandle\)/.test(executeSrc) &&
  /getPathValue\(vars\[roVar\], roParsed\.steps\)/.test(executeSrc));
check('export isAction names the object-reference classifier (covers the new types)',
  /HydraVariables\.isObjectRefAction\(type\)/.test(exportSrc));
check('both runtimes pass the collections module to the execute context',
  /collections: HydraCollections/.test(exportSrc) &&
  /collections: mod\('Collections'\)/.test(previewSrc));
check('block reference lists both object-in-structure blocks under Variables (44)',
  (() => {
    const refMd = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');
    return refMd.includes('### Variables (44)') &&
      refMd.includes('| Store Object In Structure | Action | Stores the object a scoped variable holds inside a list or structure at a path |') &&
      refMd.includes('| Read Object From Structure | Action | Reads the object at a path inside a list or structure back into a scoped variable |') &&
      refMd.includes('#### Store Object In Structure') &&
      refMd.includes('#### Read Object From Structure');
  })());
check('user guide documents the store and the read',
  (() => {
    const guide = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');
    return guide.includes('**Store Object In Structure**') &&
      guide.includes('**Read Object From Structure**');
  })());

if (failures > 0) { console.log(`${failures} FAILURES`); process.exitCode = 1; }
else { console.log('ALL STRUCTURE-REFERENCE TESTS PASSED'); }
