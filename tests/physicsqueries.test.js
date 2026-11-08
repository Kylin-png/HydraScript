// Unit tests for physics queries that return data (P5 core-engine
// track, item P5-5: Object primitives, slice b — raycast hit object
// + distance into variables, overlap list into a flat list variable).
//
// Raycast Into Variables casts the same ray the Raycast Hit
// condition casts and stores the closest live collision object in a
// scoped object variable plus the distance in a flat variable; a
// miss writes -1 and clears the object variable. List Overlapping
// Objects runs the same circle query the Objects Overlapping
// condition runs and stores the hits as a list of object handles in
// a flat list variable, with the count in a second variable — so For
// Each Item can walk through them. The composition is pinned too:
// a For Each Item body over a handle list reads the current item's
// properties through Read Object Property's flat-variable fallback
// and its actions hit that one object through the loop's context
// narrowing. Static checks at the end pin the wiring: catalog
// blocks, both runtimes' action contexts, and the docs.

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
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-expr.js'), 'utf8'),
  sandbox, { filename: 'hydra-expr.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-physics2d.js'), 'utf8'),
  sandbox, { filename: 'hydra-physics2d.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-flow.js'), 'utf8'),
  sandbox, { filename: 'hydra-flow.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-dispatch.js'), 'utf8'),
  sandbox, { filename: 'hydra-dispatch.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-conditions.js'), 'utf8'),
  sandbox, { filename: 'hydra-conditions.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-loops.js'), 'utf8'),
  sandbox, { filename: 'hydra-loops.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-execute.js'), 'utf8'),
  sandbox, { filename: 'hydra-execute.js' });
const V = sandbox.HydraVariables;
const P = sandbox.HydraPick;
const H = sandbox.HydraHealth;
const E = sandbox.HydraExpr;
const P2D = sandbox.HydraPhysics2D;
const FL = sandbox.HydraFlow;
const D = sandbox.HydraDispatch;
const L = sandbox.HydraLoops;
const X = sandbox.HydraExecute;

// --- fixtures: a wall and two goblins on a horizontal line at y 120 ---

function obj(id, name, x, y, extra) {
  return Object.assign({
    id: id, name: name, kind: 'sprite', posX: x, posY: y, width: 40, height: 40,
    color: '#888888', static: false, physicsEnabled: false,
    health: 100, maxHealth: 100,
    collision: { shape: 'box', mode: 'solid', layer: 0, mask: 255 }
  }, extra || {});
}

const WALL = obj(9, 'wall', 200, 100);
const GA = obj(1, 'goblin', 300, 100, { health: 70 });
const GB = obj(2, 'goblin', 500, 100, {
  health: 40,
  collision: { shape: 'box', mode: 'solid', layer: 1, mask: 255 }
});
const HERO = obj(8, 'hero', 0, 200);
const ALL = [HERO, WALL, GA, GB];
const BY_NAME = { hero: [HERO], wall: [WALL], goblin: [GA, GB] };

// The export's isCollisionObject, mirrored: tilemaps never collide
// as whole boxes, text / ui-pinned objects only when their collision
// is enabled, an explicitly disabled collision never collides.
function isCol(o) {
  if (!o) return false;
  if (o.kind === 'tilemap') return false;
  if (o.kind === 'text' || o.uiPinned === true) return !!(o.collision && o.collision.enabled === true);
  if (o.collision && o.collision.enabled === false) return false;
  return o.collidable !== false;
}

function makeCtx(objectsByName, opts) {
  const o = opts || {};
  const vars = {};
  const warnings = [];
  const varScopes = V.createVariablesState();
  const loopState = L.createLoopState();
  const all = o.all || ALL;
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
        liveObjects: (name) => (objectsByName[name] || []).slice(),
        num: (raw) => E.evaluate(raw, { variables: vars }),
        warn: (m) => warnings.push(m)
      };
    },
    named: function (name) { return (objectsByName[name] || []).slice(); },
    allObjects: function () { return all.slice(); },
    isCollisionObject: isCol,
    physics2d: P2D,
    loopsModule: L,
    loopState: loopState,
    executionContext: null,
    setExecutionContext: function (c) { ctx.executionContext = c || null; },
    healthModule: H,
    sceneId: 1
  };
  if (o.noSetCtx) delete ctx.setExecutionContext;
  if (o.noPhysics2d) delete ctx.physics2d;
  if (o.noVarScopes) delete ctx.varScopes;
  return { ctx: ctx, vars: vars, warnings: warnings, varScopes: varScopes };
}

function raycast(data) {
  return Object.assign({
    type: 'raycastIntoVariables', fromX: 0, fromY: 120, toX: 800, toY: 120,
    layerMask: 255, varName: 'hit', scope: 'global', targetObject: '', distanceVar: 'hitDistance'
  }, data || {});
}

function overlap(data) {
  return Object.assign({
    type: 'listOverlappingObjects', x: 320, y: 120, radius: 60,
    layerMask: 255, listVar: 'nearby', countVar: 'nearbyCount'
  }, data || {});
}

function readProp(data) {
  return Object.assign({
    type: 'readObjectProperty', varName: 'target', scope: 'global', targetObject: '',
    property: 'x', storeVarName: 'targetX'
  }, data || {});
}

function close(a, b) { return Math.abs(a - b) < 0.001; }

// --- module surface ---

check('isObjectRefAction names all eight object-reference blocks',
  V.isObjectRefAction('pickObjectIntoVariable') && V.isObjectRefAction('readObjectProperty') &&
  V.isObjectRefAction('raycastIntoVariables') && V.isObjectRefAction('listOverlappingObjects') &&
  V.isObjectRefAction('spawnObjectIntoVariable') && V.isObjectRefAction('destroyObjectInVariable') &&
  V.isObjectRefAction('nestedStoreObject') && V.isObjectRefAction('nestedReadObject') &&
  !V.isObjectRefAction('setScopedVariable') && !V.isObjectRefAction('damageObject'));

// --- Raycast Into Variables ---

check('execute: Raycast Into Variables stores the closest hit and its distance, and points the context at it',
  (() => {
    const h = makeCtx(BY_NAME);
    X.executeAction(raycast(), h.ctx, 1);
    const entry = V.get(h.varScopes, 'global', 'hit');
    return entry && entry.type === 'object' && entry.value.name === 'wall' && entry.value.id === '9' &&
      close(h.vars.hitDistance, 200) &&
      h.ctx.executionContext && h.ctx.executionContext.obj1 === WALL && h.warnings.length === 0;
  })(), 'ray along y=120 first hits the wall at x=200, distance 200');
check('execute: Raycast Into Variables finds the goblin past the wall when it starts beyond it',
  (() => {
    const h = makeCtx(BY_NAME);
    X.executeAction(raycast({ fromX: 250, toX: 800 }), h.ctx, 1);
    const entry = V.get(h.varScopes, 'global', 'hit');
    return entry && entry.value.name === 'goblin' && entry.value.id === '1' &&
      close(h.vars.hitDistance, 50) && h.warnings.length === 0;
  })(), 'ray from x=250 hits GA at x=300, distance 50');
check('execute: Raycast Into Variables honors the layer mask',
  (() => {
    const h1 = makeCtx(BY_NAME);
    X.executeAction(raycast({ layerMask: 2 }), h1.ctx, 1);
    const one = V.get(h1.varScopes, 'global', 'hit');
    const h2 = makeCtx(BY_NAME);
    X.executeAction(raycast({ layerMask: 1 }), h2.ctx, 1);
    const two = V.get(h2.varScopes, 'global', 'hit');
    return one && one.value.name === 'goblin' && one.value.id === '2' && close(h1.vars.hitDistance, 500) &&
      two && two.value.name === 'wall' && close(h2.vars.hitDistance, 200) &&
      h1.warnings.length === 0 && h2.warnings.length === 0;
  })(), 'mask 2 (layer 1 only) reaches GB at 500; mask 1 (layer 0 only) stops at the wall');
check('execute: Raycast Into Variables on a miss writes -1 and clears the object variable, staying quiet',
  (() => {
    const h = makeCtx(BY_NAME);
    X.executeAction(raycast({ fromY: 500, toY: 500 }), h.ctx, 1);
    const entry = V.get(h.varScopes, 'global', 'hit');
    return entry && entry.type === 'object' && entry.value.name === '' && entry.value.id === '' &&
      h.vars.hitDistance === -1 && h.ctx.executionContext === null && h.warnings.length === 0;
  })(), 'ray along y=500 hits nothing');
check('execute: Raycast Into Variables clears a stale hit when a later ray misses',
  (() => {
    const h = makeCtx(BY_NAME);
    X.executeAction(raycast(), h.ctx, 1);
    const first = V.get(h.varScopes, 'global', 'hit');
    X.executeAction(raycast({ fromY: 500, toY: 500 }), h.ctx, 1);
    const entry = V.get(h.varScopes, 'global', 'hit');
    X.executeAction(readProp({ varName: 'hit', property: 'alive', storeVarName: 'hitAlive' }), h.ctx, 2);
    return first && first.value.id === '9' &&
      entry && entry.value.name === '' && h.vars.hitDistance === -1 &&
      h.vars.hitAlive === 0 && h.warnings.length === 0;
  })(), 'the variable never holds a hit from an earlier frame');
check('execute: Raycast Into Variables warns and holds on a blank variable, an object scope with no object, or bad coordinates',
  (() => {
    const h1 = makeCtx(BY_NAME);
    X.executeAction(raycast({ varName: '' }), h1.ctx, 1);
    const h2 = makeCtx(BY_NAME);
    X.executeAction(raycast({ scope: 'object', targetObject: '' }), h2.ctx, 1);
    const h3 = makeCtx(BY_NAME);
    X.executeAction(raycast({ fromX: '1 +' }), h3.ctx, 1);
    return h1.warnings.length === 1 && /variable name is blank/.test(h1.warnings[0]) &&
      V.get(h1.varScopes, 'global', 'hit') === null &&
      h2.warnings.length === 1 && /object scope needs an object/.test(h2.warnings[0]) &&
      h3.warnings.length === 1 && /not a number/.test(h3.warnings[0]) &&
      V.get(h3.varScopes, 'global', 'hit') === null && h3.vars.hitDistance === undefined;
  })());
check('execute: Raycast Into Variables with a blank distance variable stores the object and skips the distance',
  (() => {
    const h = makeCtx(BY_NAME);
    X.executeAction(raycast({ distanceVar: '' }), h.ctx, 1);
    const entry = V.get(h.varScopes, 'global', 'hit');
    return entry && entry.value.id === '9' && h.vars.hitDistance === undefined && h.warnings.length === 0;
  })());
check('execute: Raycast Into Variables without the context hook warns once and still stores the hit',
  (() => {
    const h = makeCtx(BY_NAME, { noSetCtx: true });
    X.executeAction(raycast(), h.ctx, 1);
    const entry = V.get(h.varScopes, 'global', 'hit');
    return entry && entry.value.id === '9' && close(h.vars.hitDistance, 200) &&
      h.warnings.length === 1 && /cannot point later actions/.test(h.warnings[0]);
  })());
check('execute: Raycast Into Variables with no physics module stays quiet and writes nothing',
  (() => {
    const h = makeCtx(BY_NAME, { noPhysics2d: true });
    X.executeAction(raycast(), h.ctx, 1);
    return V.get(h.varScopes, 'global', 'hit') === null &&
      h.vars.hitDistance === undefined && h.warnings.length === 0;
  })());

// --- List Overlapping Objects ---

check('execute: List Overlapping Objects stores the overlapping objects as handles, with the count',
  (() => {
    const h = makeCtx(BY_NAME);
    X.executeAction(overlap(), h.ctx, 1);
    const list = h.vars.nearby;
    return Array.isArray(list) && list.length === 1 &&
      V.isObjectRef(list[0]) && list[0].name === 'goblin' && list[0].id === '1' &&
      h.vars.nearbyCount === 1 && h.warnings.length === 0;
  })(), 'circle (320,120) r 60 overlaps only GA');
check('execute: List Overlapping Objects lists every hit in live order',
  (() => {
    const h = makeCtx(BY_NAME);
    X.executeAction(overlap({ x: 420, radius: 150 }), h.ctx, 1);
    const list = h.vars.nearby;
    return Array.isArray(list) && list.length === 2 &&
      list[0].name === 'goblin' && list[0].id === '1' &&
      list[1].name === 'goblin' && list[1].id === '2' &&
      h.vars.nearbyCount === 2 && h.warnings.length === 0;
  })(), 'circle (420,120) r 150 overlaps GA and GB, not the wall');
check('execute: List Overlapping Objects honors the layer mask',
  (() => {
    const h = makeCtx(BY_NAME);
    X.executeAction(overlap({ x: 420, radius: 150, layerMask: 2 }), h.ctx, 1);
    const list = h.vars.nearby;
    return Array.isArray(list) && list.length === 1 && list[0].id === '2' &&
      h.vars.nearbyCount === 1 && h.warnings.length === 0;
  })(), 'mask 2 (layer 1 only) lists only GB');
check('execute: List Overlapping Objects on an empty overlap stores an empty list and a count of 0, staying quiet',
  (() => {
    const h = makeCtx(BY_NAME);
    X.executeAction(overlap({ x: 0, y: 500, radius: 10 }), h.ctx, 1);
    return Array.isArray(h.vars.nearby) && h.vars.nearby.length === 0 &&
      h.vars.nearbyCount === 0 && h.warnings.length === 0;
  })());
check('execute: List Overlapping Objects replaces the list on every run, never appends',
  (() => {
    const h = makeCtx(BY_NAME);
    X.executeAction(overlap({ x: 420, radius: 150 }), h.ctx, 1);
    const first = h.vars.nearby.length;
    X.executeAction(overlap(), h.ctx, 1);
    return first === 2 && h.vars.nearby.length === 1 &&
      h.vars.nearby[0].id === '1' && h.vars.nearbyCount === 1 && h.warnings.length === 0;
  })());
check('execute: List Overlapping Objects warns and holds on a blank list variable or bad coordinates',
  (() => {
    const h1 = makeCtx(BY_NAME);
    X.executeAction(overlap({ listVar: '' }), h1.ctx, 1);
    const h2 = makeCtx(BY_NAME);
    X.executeAction(overlap({ radius: '1 +' }), h2.ctx, 1);
    return h1.warnings.length === 1 && /list variable is blank/.test(h1.warnings[0]) &&
      h1.vars.nearby === undefined &&
      h2.warnings.length === 1 && /not a number/.test(h2.warnings[0]) &&
      h2.vars.nearby === undefined;
  })());
check('execute: List Overlapping Objects with a blank count variable stores the list and skips the count',
  (() => {
    const h = makeCtx(BY_NAME);
    X.executeAction(overlap({ countVar: '' }), h.ctx, 1);
    return Array.isArray(h.vars.nearby) && h.vars.nearby.length === 1 &&
      h.vars.nearbyCount === undefined && h.warnings.length === 0;
  })());
check('execute: List Overlapping Objects reads a negative radius as 0, and stays quiet with no physics module',
  (() => {
    const h1 = makeCtx(BY_NAME);
    X.executeAction(overlap({ radius: 0 }), h1.ctx, 1);
    const h2 = makeCtx(BY_NAME);
    X.executeAction(overlap({ radius: -5 }), h2.ctx, 1);
    const h3 = makeCtx(BY_NAME, { noPhysics2d: true });
    X.executeAction(overlap(), h3.ctx, 1);
    return h1.vars.nearbyCount === h2.vars.nearbyCount &&
      h1.warnings.length === 0 && h2.warnings.length === 0 &&
      h3.vars.nearby === undefined && h3.warnings.length === 0;
  })(), 'radius 0 and -5 agree (the point inside GA either way)');

// --- Read Object Property: flat-variable fallback ---

check('execute: Read Object Property reads a handle held in a flat variable',
  (() => {
    const h = makeCtx(BY_NAME);
    h.vars.item = V.objectRefOf(GB);
    X.executeAction(readProp({ varName: 'item', property: 'x', storeVarName: 'itemX' }), h.ctx, 1);
    return h.vars.itemX === 500 && h.warnings.length === 0;
  })(), 'the For Each Item item variable holds the handle');
check('execute: Read Object Property prefers the scoped object over a flat handle of the same name',
  (() => {
    const h = makeCtx(BY_NAME);
    V.set(h.varScopes, 'global', 'item', V.objectRefOf(GA), { type: 'object' });
    h.vars.item = V.objectRefOf(GB);
    X.executeAction(readProp({ varName: 'item', property: 'x', storeVarName: 'itemX' }), h.ctx, 1);
    return h.vars.itemX === 300 && h.warnings.length === 0;
  })(), 'scoped GA (x 300) wins over flat GB (x 500)');
check('execute: Read Object Property still falls back to 0 when neither store holds an object',
  (() => {
    const h = makeCtx(BY_NAME);
    h.vars.item = 42;
    X.executeAction(readProp({ varName: 'item', property: 'x', storeVarName: 'itemX' }), h.ctx, 1);
    return h.vars.itemX === 0 && h.warnings.length === 0;
  })());

// --- For Each Item: handle narrowing ---

function loopCtx(vars, warnings, objectsByName, opts) {
  const o = opts || {};
  const loopState = L.createLoopState();
  const ctx = {
    variables: vars,
    expr: function (v) { return E.evaluate(v, { variables: vars }).value; },
    exprInfo: function (v) { return E.evaluate(v, { variables: vars }); },
    warn: function (m) { warnings.push(m); },
    varScopesModule: V,
    loopsModule: L,
    loopState: loopState,
    executionContext: null,
    named: function (name) { return (objectsByName[name] || []).slice(); },
    setExecutionContext: function (c) { ctx.executionContext = c || null; }
  };
  if (o.noSetCtx) delete ctx.setExecutionContext;
  return ctx;
}

check('executeLoopAction: For Each Item over a handle list points the context at each object in turn and restores it after',
  (() => {
    const vars = { nearby: [V.objectRefOf(GA), V.objectRefOf(GB)] };
    const warnings = [];
    const ctx = loopCtx(vars, warnings, BY_NAME);
    const seen = [];
    let runs = 0;
    X.executeLoopAction({ type: 'forEachList', listVar: 'nearby', itemVar: 'foe', indexVar: 'n' }, ctx, 0,
      function () {
        runs++;
        seen.push(ctx.executionContext && ctx.executionContext.obj1 ? ctx.executionContext.obj1.id : null);
        return [1];
      });
    return runs === 2 && seen.join(',') === '1,2' &&
      ctx.executionContext === null && warnings.length === 0;
  })(), 'GA then GB, context back to null after the loop');
check('executeLoopAction: For Each Item over a plain list narrows nothing and warns nothing',
  (() => {
    const vars = { deck: [10, 20, 30] };
    const warnings = [];
    const ctx = loopCtx(vars, warnings, BY_NAME);
    let runs = 0;
    X.executeLoopAction({ type: 'forEachList', listVar: 'deck', itemVar: 'card', indexVar: '' }, ctx, 0,
      function () { runs++; return [1]; });
    return runs === 3 && ctx.executionContext === null && warnings.length === 0;
  })());
check('executeLoopAction: For Each Item over a handle list without the context hook warns once and still runs the body',
  (() => {
    const vars = { nearby: [V.objectRefOf(GA), V.objectRefOf(GB)] };
    const warnings = [];
    const ctx = loopCtx(vars, warnings, BY_NAME, { noSetCtx: true });
    let runs = 0;
    X.executeLoopAction({ type: 'forEachList', listVar: 'nearby', itemVar: 'foe', indexVar: '' }, ctx, 0,
      function () { runs++; return [1]; });
    return runs === 2 && warnings.length === 1 && /cannot point actions/.test(warnings[0]);
  })());
check('executeLoopAction: For Each Item skips the narrowing for a stale handle and keeps the loop going',
  (() => {
    const vars = { nearby: [V.objectRefOf({ __objectRef: true, name: 'goblin', id: '99' }), V.objectRefOf(GB)] };
    const warnings = [];
    const ctx = loopCtx(vars, warnings, BY_NAME);
    const seen = [];
    let runs = 0;
    X.executeLoopAction({ type: 'forEachList', listVar: 'nearby', itemVar: 'foe', indexVar: '' }, ctx, 0,
      function () {
        runs++;
        seen.push(ctx.executionContext && ctx.executionContext.obj1 ? ctx.executionContext.obj1.id : null);
        return [1];
      });
    return runs === 2 && seen.join(',') === ',' + '2' && warnings.length === 0;
  })(), 'the destroyed goblin narrows nothing; GB still narrows');

// --- dispatch integration: a real grid through HydraDispatch + HydraFlow ---

function makeHost(grid, objectsByName) {
  const vars = {};
  const warnings = [];
  const varScopes = V.createVariablesState();
  const startedScopes = new Set();
  const flowTriggerStates = {};
  const loopState = L.createLoopState();
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
        liveObjects: (name) => (objectsByName[name] || []).slice(),
        num: (raw) => E.evaluate(raw, { variables: vars }),
        warn: (m) => warnings.push(m)
      };
    },
    named: function (name) { return (objectsByName[name] || []).slice(); },
    // The live objects are the ones this host was built with — never
    // the module-level fixtures, so a raycast or overlap in a
    // dispatch test hits (and damages) the test's own objects.
    allObjects: function () {
      const out = [];
      Object.keys(objectsByName).forEach(function (k) {
        (objectsByName[k] || []).forEach(function (o) { out.push(o); });
      });
      return out;
    },
    isCollisionObject: isCol,
    physics2d: P2D,
    loopsModule: L,
    loopState: loopState,
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
    // Loop blocks are actions too: the flow only routes a loop
    // through executeLoop when isAction names it first.
    return t === 'setVariable' || t === 'damageObject' || V.isObjectRefAction(t) ||
      L.isLoopBlock(t);
  }
  const hooks = {
    flow: FL,
    trace: null, traceState: null, frameId: 0,
    isCondition: isCond, isAction: isAct, isComment: function (t) { return t === 'comment'; },
    isLoopBlock: function (t) { return L.isLoopBlock(t); },
    executeLoop: function (idx, data, runBody) { return X.executeLoopAction(data, ctx, idx, runBody); },
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
    vars: vars, warnings: warnings, varScopes: varScopes, ctx: ctx,
    run: function () { D.processScope(grid, 'test', hooks); }
  };
}

check('dispatch: raycast, then Damage Object hits only the hit goblin, then its distance and health read out',
  (() => {
    const goblins = [
      obj(1, 'goblin', 300, 100, { health: 70 }),
      obj(2, 'goblin', 500, 100, { health: 40 })
    ];
    const h = makeHost({
      0: { type: 'gameStart', kind: 'condition' },
      1: raycast({ fromX: 250, toX: 800 }),
      2: { type: 'damageObject', kind: 'action', targetObject: 'goblin', amount: 10 },
      3: readProp({ varName: 'hit', property: 'health', storeVarName: 'hitHp' })
    }, { hero: [HERO], goblin: goblins });
    h.run();
    const entry = V.get(h.varScopes, 'global', 'hit');
    return entry && entry.value.id === '1' &&
      goblins[0].health === 60 && goblins[1].health === 40 &&
      close(h.vars.hitDistance, 50) && h.vars.hitHp === 60 && h.warnings.length === 0;
  })(), 'the ray from x=250 hits GA; only GA takes the 10 damage');
check('dispatch: overlap list, then For Each Item damages each overlapped goblin exactly once',
  (() => {
    const goblins = [
      obj(1, 'goblin', 300, 100, { health: 70 }),
      obj(2, 'goblin', 500, 100, { health: 40 })
    ];
    const h = makeHost({
      0: { type: 'gameStart', kind: 'condition' },
      1: overlap({ x: 420, radius: 150 }),
      2: { type: 'forEachList', listVar: 'nearby', itemVar: 'foe', indexVar: '' },
      3: { type: 'damageObject', kind: 'action', targetObject: 'goblin', amount: 10 }
    }, { hero: [HERO], goblin: goblins });
    h.run();
    return goblins[0].health === 60 && goblins[1].health === 30 &&
      h.vars.nearbyCount === 2 && h.warnings.length === 0;
  })(), 'without the narrowing GA would take 20 and GB 0; with it each takes 10');
check('dispatch: overlap list, then For Each Item reads each object\'s X through the flat-variable fallback',
  (() => {
    const goblins = [
      obj(1, 'goblin', 300, 100, { health: 70 }),
      obj(2, 'goblin', 500, 100, { health: 40 })
    ];
    const h = makeHost({
      0: { type: 'gameStart', kind: 'condition' },
      1: overlap({ x: 420, radius: 150 }),
      2: { type: 'forEachList', listVar: 'nearby', itemVar: 'foe', indexVar: 'n' },
      3: readProp({ varName: 'foe', property: 'x', storeVarName: 'foeX' }),
      4: { type: 'setVariable', kind: 'action', varName: 'sumX', operation: 'add', value: 'foeX' }
    }, { hero: [HERO], goblin: goblins });
    h.run();
    return h.vars.sumX === 800 && h.warnings.length === 0;
  })(), '300 + 500 across the two rounds');

// --- catalog + wiring + docs pins ---

const catSb = {};
catSb.window = catSb;
vm.createContext(catSb);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8'),
  catSb, { filename: 'block-catalog.js' });
const catalog = catSb.window.HydraBlockCatalog.blocks;

check('catalog holds 556 blocks (was 552, +4 attach)',
  catalog.length === 556, `got ${catalog.length}`);
check('Variables category holds the two physics-query blocks after Read Object Property',
  (() => {
    const vars = catalog.filter(b => b.category === 'Variables');
    const types = vars.map(b => b.blockType);
    const at = types.indexOf('read-object-property');
    return at !== -1 &&
      types[at + 1] === 'raycast-into-variables' &&
      types[at + 2] === 'list-overlapping-objects';
  })());
check('Raycast Into Variables declares the ray, variable, scope, and distance fields',
  (() => {
    const b = catalog.find(b => b.blockType === 'raycast-into-variables');
    if (!b) return false;
    const keys = (b.fields || []).map(f => f.key);
    return b.kind === 'action' && b.runtimeType === 'raycastIntoVariables' &&
      JSON.stringify(keys) === JSON.stringify(['fromX', 'fromY', 'toX', 'toY', 'layerMask', 'varName', 'scope', 'targetObject', 'distanceVar']) &&
      b.defaults.fromX === 0 && b.defaults.fromY === 0 && b.defaults.toX === 400 && b.defaults.toY === 300 &&
      b.defaults.varName === 'hit' && b.defaults.scope === 'global' && b.defaults.distanceVar === 'hitDistance';
  })());
check('List Overlapping Objects declares the circle, list, and count fields',
  (() => {
    const b = catalog.find(b => b.blockType === 'list-overlapping-objects');
    if (!b) return false;
    const keys = (b.fields || []).map(f => f.key);
    return b.kind === 'action' && b.runtimeType === 'listOverlappingObjects' &&
      JSON.stringify(keys) === JSON.stringify(['x', 'y', 'radius', 'layerMask', 'listVar', 'countVar']) &&
      b.defaults.x === 400 && b.defaults.y === 300 && b.defaults.radius === 48 &&
      b.defaults.listVar === 'nearby' && b.defaults.countVar === 'nearbyCount';
  })());
check('the two new catalog notes carry no em dashes',
  (() => {
    const notes = catalog.filter(b => b.blockType === 'raycast-into-variables' ||
      b.blockType === 'list-overlapping-objects').map(b => b.note || '');
    return notes.length === 2 && notes.every(n => n.indexOf('\u2014') === -1);
  })());

const exportSrc = fs.readFileSync(path.join(HYDRA, 'player-runtime.js'), 'utf8');
const previewSrc = fs.readFileSync(path.join(HYDRA, 'hydra-previewruntime.js'), 'utf8');
check('export isAction names the object-reference classifier',
  /HydraVariables\.isObjectRefAction\(type\)/.test(exportSrc));
check('both runtimes pass physics2d and the collision check to the execute context',
  /physics2d: HydraPhysics2D/.test(exportSrc) &&
  /physics2d: mod\('Physics2D'\)/.test(previewSrc) &&
  /isCollisionObject: isCollisionObject/.test(exportSrc) &&
  /isCollisionObject: isCollisionObjectOf/.test(previewSrc));
check('block reference lists both query blocks under Variables (44)',
  (() => {
    const refMd = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');
    return refMd.includes('### Variables (44)') &&
      refMd.includes('| Raycast Into Variables | Action | Casts a ray and stores the hit object and the distance to it |') &&
      refMd.includes('| List Overlapping Objects | Action | Lists every live collision object inside a circle into a list variable |') &&
      refMd.includes('#### Raycast Into Variables') &&
      refMd.includes('#### List Overlapping Objects');
  })());
check('user guide documents the raycast and the overlap list',
  (() => {
    const guide = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');
    return guide.includes('**Raycast Into Variables** casts a ray from one point to another') &&
      guide.includes('**List Overlapping Objects** lists every live collision object inside a circle');
  })());

if (failures > 0) { console.log(`${failures} FAILURES`); process.exitCode = 1; }
else { console.log('ALL PHYSICS-QUERY TESTS PASSED'); }
