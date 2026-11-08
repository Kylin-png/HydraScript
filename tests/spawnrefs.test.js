// Unit tests for spawn/destroy as instantiation (P5 core-engine track,
// item P5-5: Object primitives, slice c — Spawn Object Into Variable
// hands the clone a spawn makes back in a variable, Destroy Object In
// Variable destroys exactly the object a variable holds).
//
// The spawn reuses the existing spawnClone in hydra-execute.js (the same
// clone Spawn Object makes), so the new block is Spawn Object plus an
// output variable: the clone's handle is stored like a pick's, and the
// execution context points at the clone so chained actions hit only it.
// The destroy resolves the held handle (the same resolve Read Object
// Property uses) and marks exactly that object pending-destroy, never
// every object with the name. The dispatch integration at the end runs
// real grids through HydraDispatch + HydraFlow, so the
// spawn-damage-read and spawn-destroy-read flows are pinned by
// behavior, not by reading the code. Static checks at the end pin the
// wiring: catalog blocks, both runtimes' action contexts, the export
// inlining list, and the docs.

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
// destroys, the way both runtimes' named() does.
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
  return { ctx: ctx, vars: vars, warnings: warnings, varScopes: varScopes, live: live, pendingDestroy: pendingDestroy, destroyed: destroyed };
}

function spawn(data) {
  return Object.assign({
    type: 'spawnObjectIntoVariable', sourceObject: 'goblin', spawnX: 600, spawnY: 120,
    varName: 'foe', scope: 'global', targetObject: ''
  }, data || {});
}
function destroy(data) {
  return Object.assign({
    type: 'destroyObjectInVariable', varName: 'foe', scope: 'global', targetObject: ''
  }, data || {});
}
function readProp(data) {
  return Object.assign({
    type: 'readObjectProperty', varName: 'foe', scope: 'global', targetObject: '',
    property: 'x', storeVarName: 'foeX'
  }, data || {});
}

// --- module surface ---

check('isObjectRefAction names all eight object-reference blocks',
  V.isObjectRefAction('pickObjectIntoVariable') && V.isObjectRefAction('readObjectProperty') &&
  V.isObjectRefAction('raycastIntoVariables') && V.isObjectRefAction('listOverlappingObjects') &&
  V.isObjectRefAction('spawnObjectIntoVariable') && V.isObjectRefAction('destroyObjectInVariable') &&
  V.isObjectRefAction('nestedStoreObject') && V.isObjectRefAction('nestedReadObject') &&
  !V.isObjectRefAction('setScopedVariable') && !V.isObjectRefAction('setVariable') &&
  !V.isObjectRefAction('damageObject') && !V.isObjectRefAction('spawnObject'));

// --- Spawn Object Into Variable ---

check('execute: Spawn Object Into Variable stores the clone handle, points the context at it, and the clone is a new live object at the spawn point',
  (() => {
    const defs = [goblinDef(1, 300, 100, 70)];
    const live = [goblinDef(1, 300, 100, 70), heroObj()];
    const h = makeCtx(defs, live);
    X.executeAction(spawn(), h.ctx, 1);
    const entry = V.get(h.varScopes, 'global', 'foe');
    const clones = live.filter(function (o) { return String(o.id).indexOf('spawn_') === 0; });
    return entry && entry.type === 'object' && entry.value.name === 'goblin' &&
      typeof entry.value.id === 'string' && entry.value.id.indexOf('spawn_') === 0 &&
      clones.length === 1 && clones[0].posX === 600 && clones[0].posY === 120 &&
      clones[0].health === 70 && live.length === 3 &&
      h.ctx.executionContext && h.ctx.executionContext.obj1 === clones[0] &&
      live[0].health === 70 && h.warnings.length === 0;
  })(), 'one clone at (600,120) with the def health; the original goblin is untouched');
check('execute: Spawn Object Into Variable with blank coordinates spawns at the source position',
  (() => {
    const defs = [goblinDef(1, 300, 100, 70)];
    const live = [goblinDef(1, 300, 100, 70)];
    const h = makeCtx(defs, live);
    X.executeAction(spawn({ spawnX: '', spawnY: '' }), h.ctx, 1);
    const clones = live.filter(function (o) { return String(o.id).indexOf('spawn_') === 0; });
    return clones.length === 1 && clones[0].posX === 300 && clones[0].posY === 100 &&
      h.warnings.length === 0;
  })(), 'blank X/Y reads as the source position, like Spawn Object');
check('execute: Spawn Object Into Variable of a missing source clears the variable to the empty handle and stays quiet',
  (() => {
    const defs = [goblinDef(1, 300, 100, 70)];
    const live = [goblinDef(1, 300, 100, 70)];
    const h = makeCtx(defs, live);
    X.executeAction(spawn({ sourceObject: 'ghost' }), h.ctx, 1);
    const entry = V.get(h.varScopes, 'global', 'foe');
    X.executeAction(readProp({ property: 'alive', storeVarName: 'foeAlive' }), h.ctx, 2);
    return entry && entry.type === 'object' && entry.value.name === '' && entry.value.id === '' &&
      live.length === 1 && h.vars.foeAlive === 0 && h.warnings.length === 0;
  })(), 'no clone is made; a later Is alive read is 0');
check('execute: Spawn Object Into Variable clears a stale clone when a later spawn misses',
  (() => {
    const defs = [goblinDef(1, 300, 100, 70)];
    const live = [goblinDef(1, 300, 100, 70)];
    const h = makeCtx(defs, live);
    X.executeAction(spawn(), h.ctx, 1);
    const first = V.get(h.varScopes, 'global', 'foe');
    X.executeAction(spawn({ sourceObject: 'ghost' }), h.ctx, 1);
    const entry = V.get(h.varScopes, 'global', 'foe');
    X.executeAction(readProp({ property: 'alive', storeVarName: 'foeAlive' }), h.ctx, 2);
    return first && first.value.id.indexOf('spawn_') === 0 &&
      entry && entry.value.name === '' && h.vars.foeAlive === 0 && h.warnings.length === 0;
  })(), 'the variable never holds a clone from an earlier frame');
check('execute: Spawn Object Into Variable warns and holds on a blank source, a blank variable, or an object scope with no object',
  (() => {
    const defs = [goblinDef(1, 300, 100, 70)];
    const h1 = makeCtx(defs, [goblinDef(1, 300, 100, 70)]);
    X.executeAction(spawn({ sourceObject: '' }), h1.ctx, 1);
    const h2 = makeCtx(defs, [goblinDef(1, 300, 100, 70)]);
    X.executeAction(spawn({ varName: '' }), h2.ctx, 1);
    const h3 = makeCtx(defs, [goblinDef(1, 300, 100, 70)]);
    X.executeAction(spawn({ scope: 'object', targetObject: '' }), h3.ctx, 1);
    return h1.warnings.length === 1 && /no object is named/.test(h1.warnings[0]) &&
      h1.live.length === 1 && V.get(h1.varScopes, 'global', 'foe') === null &&
      h2.warnings.length === 1 && /variable name is blank/.test(h2.warnings[0]) &&
      h2.live.length === 1 &&
      h3.warnings.length === 1 && /object scope needs an object/.test(h3.warnings[0]) &&
      h3.live.length === 1;
  })());
check('execute: Spawn Object Into Variable without the context hook warns once and still stores the clone',
  (() => {
    const defs = [goblinDef(1, 300, 100, 70)];
    const live = [goblinDef(1, 300, 100, 70)];
    const h = makeCtx(defs, live, { noSetCtx: true });
    X.executeAction(spawn(), h.ctx, 1);
    const entry = V.get(h.varScopes, 'global', 'foe');
    return entry && entry.value.id.indexOf('spawn_') === 0 && live.length === 2 &&
      h.warnings.length === 1 && /cannot point later actions/.test(h.warnings[0]);
  })());
check('execute: Spawn Object Into Variable with no scoped-variable state stays quiet and spawns nothing',
  (() => {
    const defs = [goblinDef(1, 300, 100, 70)];
    const live = [goblinDef(1, 300, 100, 70)];
    const h = makeCtx(defs, live, { noVarScopes: true });
    X.executeAction(spawn(), h.ctx, 1);
    return live.length === 1 && h.ctx.executionContext === null && h.warnings.length === 0;
  })());
check('execute: two spawns give two distinct clones with distinct ids, each variable pointing at its own',
  (() => {
    const defs = [goblinDef(1, 300, 100, 70)];
    const live = [goblinDef(1, 300, 100, 70)];
    const h = makeCtx(defs, live);
    X.executeAction(spawn({ varName: 'foeA' }), h.ctx, 1);
    X.executeAction(spawn({ varName: 'foeB', spawnX: 100, spawnY: 200 }), h.ctx, 2);
    const a = V.get(h.varScopes, 'global', 'foeA');
    const b = V.get(h.varScopes, 'global', 'foeB');
    const clones = live.filter(function (o) { return String(o.id).indexOf('spawn_') === 0; });
    return clones.length === 2 && a && b && a.value.id !== b.value.id &&
      clones.some(function (o) { return o.id === a.value.id && o.posX === 600; }) &&
      clones.some(function (o) { return o.id === b.value.id && o.posX === 100 && o.posY === 200; }) &&
      h.warnings.length === 0;
  })(), 'each spawn mints its own clone id');

// --- Destroy Object In Variable ---

check('execute: Destroy Object In Variable destroys exactly the held clone, not the original or the other clone',
  (() => {
    const defs = [goblinDef(1, 300, 100, 70)];
    const live = [goblinDef(1, 300, 100, 70)];
    const h = makeCtx(defs, live);
    X.executeAction(spawn({ varName: 'foeA' }), h.ctx, 1);
    X.executeAction(spawn({ varName: 'foeB', spawnX: 100, spawnY: 200 }), h.ctx, 2);
    const a = V.get(h.varScopes, 'global', 'foeA');
    const b = V.get(h.varScopes, 'global', 'foeB');
    X.executeAction(destroy({ varName: 'foeA' }), h.ctx, 3);
    X.executeAction(readProp({ varName: 'foeA', property: 'alive', storeVarName: 'aAlive' }), h.ctx, 4);
    X.executeAction(readProp({ varName: 'foeB', property: 'alive', storeVarName: 'bAlive' }), h.ctx, 5);
    return h.pendingDestroy.has(a.value.id) && !h.pendingDestroy.has(b.value.id) &&
      !h.pendingDestroy.has(1) && h.vars.aAlive === 0 && h.vars.bAlive === 1 &&
      h.warnings.length === 0;
  })(), 'only the first clone is marked; the original and the second clone read alive');
check('execute: Destroy Object In Variable of a missing, empty, or stale variable stays quiet',
  (() => {
    const defs = [goblinDef(1, 300, 100, 70)];
    const live = [goblinDef(1, 300, 100, 70)];
    const h1 = makeCtx(defs, live);
    X.executeAction(destroy({ varName: 'neverSet' }), h1.ctx, 1);
    const h2 = makeCtx(defs, [goblinDef(1, 300, 100, 70)]);
    X.executeAction(spawn({ sourceObject: 'ghost', varName: 'foe' }), h2.ctx, 1);
    X.executeAction(destroy({ varName: 'foe' }), h2.ctx, 2);
    const h3 = makeCtx(defs, [goblinDef(1, 300, 100, 70)]);
    V.set(h3.varScopes, 'global', 'foe', { __objectRef: true, name: 'goblin', id: '999' }, { type: 'object' });
    X.executeAction(destroy({ varName: 'foe' }), h3.ctx, 1);
    return h1.pendingDestroy.size === 0 && h1.warnings.length === 0 &&
      h2.pendingDestroy.size === 0 && h2.warnings.length === 0 &&
      h3.pendingDestroy.size === 0 && h3.warnings.length === 0;
  })(), 'nothing to destroy is not an error');
check('execute: Destroy Object In Variable warns and holds on a blank variable or an object scope with no object',
  (() => {
    const defs = [goblinDef(1, 300, 100, 70)];
    const h1 = makeCtx(defs, [goblinDef(1, 300, 100, 70)]);
    X.executeAction(destroy({ varName: '' }), h1.ctx, 1);
    const h2 = makeCtx(defs, [goblinDef(1, 300, 100, 70)]);
    X.executeAction(destroy({ scope: 'object', targetObject: '' }), h2.ctx, 1);
    return h1.warnings.length === 1 && /variable name is blank/.test(h1.warnings[0]) &&
      h1.pendingDestroy.size === 0 &&
      h2.warnings.length === 1 && /object scope needs an object/.test(h2.warnings[0]) &&
      h2.pendingDestroy.size === 0;
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
    return t === 'setVariable' || t === 'damageObject' || V.isObjectRefAction(t);
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

check('dispatch: spawn a goblin, damage hits only the clone, its health reads out',
  (() => {
    const defs = [goblinDef(1, 300, 100, 70)];
    const live = [goblinDef(1, 300, 100, 70), heroObj()];
    const h = makeHost({
      0: { type: 'gameStart', kind: 'condition' },
      1: spawn(),
      2: { type: 'damageObject', kind: 'action', targetObject: 'goblin', amount: 10 },
      3: readProp({ property: 'health', storeVarName: 'foeHp' })
    }, defs, live);
    h.run();
    const entry = V.get(h.varScopes, 'global', 'foe');
    const clone = live.find(function (o) { return o.id === (entry && entry.value.id); });
    return entry && String(entry.value.id).indexOf('spawn_') === 0 &&
      clone && clone.health === 60 && live[0].health === 70 &&
      h.vars.foeHp === 60 && h.warnings.length === 0;
  })(), 'the clone takes the 10 damage; the original goblin is untouched');
check('dispatch: spawn a goblin, destroy it through the variable, it reads as gone',
  (() => {
    const defs = [goblinDef(1, 300, 100, 70)];
    const live = [goblinDef(1, 300, 100, 70), heroObj()];
    const h = makeHost({
      0: { type: 'gameStart', kind: 'condition' },
      1: spawn(),
      2: destroy(),
      3: readProp({ property: 'alive', storeVarName: 'foeAlive' })
    }, defs, live);
    h.run();
    const entry = V.get(h.varScopes, 'global', 'foe');
    return entry && h.pendingDestroy.has(entry.value.id) &&
      h.vars.foeAlive === 0 && live[0].health === 70 && h.warnings.length === 0;
  })(), 'the held clone is marked destroyed in the same frame it was spawned');
check('dispatch: spawn two goblins, destroy only the first, the second still reads alive',
  (() => {
    const defs = [goblinDef(1, 300, 100, 70)];
    const live = [goblinDef(1, 300, 100, 70)];
    const h = makeHost({
      0: { type: 'gameStart', kind: 'condition' },
      1: spawn({ varName: 'foeA' }),
      2: spawn({ varName: 'foeB', spawnX: 100, spawnY: 200 }),
      3: destroy({ varName: 'foeA' }),
      4: readProp({ varName: 'foeA', property: 'alive', storeVarName: 'aAlive' }),
      5: readProp({ varName: 'foeB', property: 'alive', storeVarName: 'bAlive' })
    }, defs, live);
    h.run();
    return h.vars.aAlive === 0 && h.vars.bAlive === 1 && h.warnings.length === 0;
  })(), 'a handle destroys exactly its own clone');

// --- catalog + wiring + docs pins ---

const catSb = {};
catSb.window = catSb;
vm.createContext(catSb);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8'),
  catSb, { filename: 'block-catalog.js' });
const catalog = catSb.window.HydraBlockCatalog.blocks;

check('catalog holds 556 blocks (was 552, +4 attach)',
  catalog.length === 556, `got ${catalog.length}`);
check('Variables category holds the two spawn/destroy blocks after List Overlapping Objects',
  (() => {
    const vars = catalog.filter(b => b.category === 'Variables');
    const types = vars.map(b => b.blockType);
    const at = types.indexOf('list-overlapping-objects');
    return at !== -1 &&
      types[at + 1] === 'spawn-object-into-variable' &&
      types[at + 2] === 'destroy-object-in-variable';
  })());
check('Spawn Object Into Variable declares the source, position, variable, and scope fields',
  (() => {
    const b = catalog.find(b => b.blockType === 'spawn-object-into-variable');
    if (!b) return false;
    const keys = (b.fields || []).map(f => f.key);
    return b.kind === 'action' && b.runtimeType === 'spawnObjectIntoVariable' &&
      JSON.stringify(keys) === JSON.stringify(['sourceObject', 'spawnX', 'spawnY', 'varName', 'scope', 'targetObject']) &&
      b.defaults.spawnX === 400 && b.defaults.spawnY === 300 && b.defaults.varName === 'spawned' &&
      b.defaults.scope === 'global';
  })());
check('Destroy Object In Variable declares the variable and scope fields',
  (() => {
    const b = catalog.find(b => b.blockType === 'destroy-object-in-variable');
    if (!b) return false;
    const keys = (b.fields || []).map(f => f.key);
    return b.kind === 'action' && b.runtimeType === 'destroyObjectInVariable' &&
      JSON.stringify(keys) === JSON.stringify(['varName', 'scope', 'targetObject']) &&
      b.defaults.varName === 'spawned' && b.defaults.scope === 'global';
  })());
check('the two new catalog notes carry no em dashes',
  (() => {
    const notes = catalog.filter(b => b.blockType === 'spawn-object-into-variable' ||
      b.blockType === 'destroy-object-in-variable').map(b => b.note || '');
    return notes.length === 2 && notes.every(n => n.indexOf('\u2014') === -1);
  })());

const executeSrc = fs.readFileSync(path.join(HYDRA, 'hydra-execute.js'), 'utf8');
const exportSrc = fs.readFileSync(path.join(HYDRA, 'player-runtime.js'), 'utf8');
const previewSrc = fs.readFileSync(path.join(HYDRA, 'hydra-previewruntime.js'), 'utf8');
check('execute dispatches both new blocks in the object-reference branch',
  /type === 'spawnObjectIntoVariable'/.test(executeSrc) &&
  /type === 'destroyObjectInVariable'/.test(executeSrc) &&
  /spawnClone\(ctx, spSrc, data\.spawnX, data\.spawnY\)/.test(executeSrc));
check('export isAction names the object-reference classifier',
  /HydraVariables\.isObjectRefAction\(type\)/.test(exportSrc));
check('both runtimes pass the spawn and destroy hooks to the execute context',
  /sceneObjectDefs: function/.test(exportSrc) && /pendingDestroy: state\.pendingDestroy/.test(exportSrc) &&
  /sceneObjectDefs: function/.test(previewSrc) && /pendingDestroy: pendingSet\(\)/.test(previewSrc));
check('block reference lists both spawn/destroy blocks under Variables (44)',
  (() => {
    const refMd = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');
    return refMd.includes('### Variables (44)') &&
      refMd.includes('| Spawn Object Into Variable | Action | Spawns a copy of the object and stores the clone in a scoped variable |') &&
      refMd.includes('| Destroy Object In Variable | Action | Destroys exactly the object a variable holds |') &&
      refMd.includes('#### Spawn Object Into Variable') &&
      refMd.includes('#### Destroy Object In Variable');
  })());
check('user guide documents the spawn and the destroy',
  (() => {
    const guide = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');
    return guide.includes('**Spawn Object Into Variable** spawns a copy of an object') &&
      guide.includes('**Destroy Object In Variable** destroys exactly the object a variable holds');
  })());

if (failures > 0) { console.log(`${failures} FAILURES`); process.exitCode = 1; }
else { console.log('ALL SPAWN-REFERENCE TESTS PASSED'); }
