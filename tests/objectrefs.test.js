// Unit tests for object references as values (P5 core-engine track,
// item P5-5: Object primitives, slice a — pick an object into a
// variable, read its properties back out).
//
// The variables module gains a sixth value type, 'object': a handle
// { __objectRef: true, name, id } pointing at one live object. The
// pick module gains pickObject (the same pick without the condition
// wrapper). The execute switch gains the two blocks, and the dispatch
// integration at the end runs a real grid through HydraDispatch +
// HydraFlow, so the chained-context narrowing (pick nearest goblin,
// then Damage Object hits only that goblin) is pinned by behavior,
// not by reading the code. Static checks at the end pin the wiring:
// catalog blocks, both runtimes' action contexts, the export inlining
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
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-variables.js'), 'utf8'),
  sandbox, { filename: 'hydra-variables.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-pick.js'), 'utf8'),
  sandbox, { filename: 'hydra-pick.js' });
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
const V = sandbox.HydraVariables;
const P = sandbox.HydraPick;
const H = sandbox.HydraHealth;
const E = sandbox.HydraExpr;
const FL = sandbox.HydraFlow;
const D = sandbox.HydraDispatch;
const X = sandbox.HydraExecute;

// --- variables module: the object type ---

check('HydraVariables exposes the object-reference helpers',
  !!V && typeof V.isObjectRef === 'function' &&
  typeof V.emptyObjectRef === 'function' &&
  typeof V.objectRefOf === 'function' &&
  typeof V.resolveObjectRef === 'function' &&
  typeof V.isObjectRefAction === 'function');
check('TYPES carries six types including object',
  Array.isArray(V.TYPES) && V.TYPES.length === 6 && V.TYPES.indexOf('object') !== -1,
  JSON.stringify(V.TYPES));
check('isObjectRefAction names all nine object-reference blocks',
  V.isObjectRefAction('pickObjectIntoVariable') && V.isObjectRefAction('pickTaggedObjectIntoVariable') &&
  V.isObjectRefAction('readObjectProperty') &&
  V.isObjectRefAction('raycastIntoVariables') && V.isObjectRefAction('listOverlappingObjects') &&
  V.isObjectRefAction('spawnObjectIntoVariable') && V.isObjectRefAction('destroyObjectInVariable') &&
  V.isObjectRefAction('nestedStoreObject') && V.isObjectRefAction('nestedReadObject') &&
  !V.isObjectRefAction('setScopedVariable') && !V.isObjectRefAction('setVariable') &&
  !V.isObjectRefAction('damageObject'));

check('isObjectRef reads the marker, including the empty handle',
  V.isObjectRef({ __objectRef: true, name: 'goblin', id: '1' }) === true &&
  V.isObjectRef({ __objectRef: true, name: '', id: '' }) === true &&
  V.isObjectRef({ gold: 5 }) === false && V.isObjectRef({ __objectRef: false, name: 'x' }) === false &&
  V.isObjectRef(null) === false && V.isObjectRef('goblin') === false);
check('emptyObjectRef mints a fresh empty handle every call',
  (() => {
    const a = V.emptyObjectRef();
    const b = V.emptyObjectRef();
    return a.__objectRef === true && a.name === '' && a.id === '' && a !== b;
  })());
check('objectRefOf builds a handle from a live object or a handle, and null otherwise',
  (() => {
    const live = { id: 7, name: '  goblin ', posX: 0, posY: 0 };
    const fromLive = V.objectRefOf(live);
    const fromHandle = V.objectRefOf({ __objectRef: true, name: 'goblin', id: 7 });
    const byName = V.objectRefOf({ name: 'coin' });
    return fromLive && fromLive.__objectRef === true && fromLive.name === 'goblin' && fromLive.id === '7' &&
      fromHandle && fromHandle.name === 'goblin' && fromHandle.id === '7' &&
      byName && byName.name === 'coin' && byName.id === '' &&
      V.objectRefOf({ name: '   ' }) === null && V.objectRefOf({ id: 5 }) === null &&
      V.objectRefOf(null) === null && V.objectRefOf('goblin') === null;
  })());
check('resolveObjectRef matches the exact id and never falls back to another object with the name',
  (() => {
    const A = { id: 1, name: 'goblin', posX: 0, posY: 0 };
    const B = { id: 2, name: 'goblin', posX: 200, posY: 0 };
    const lookup = (n) => (n === 'goblin' ? [A, B] : []);
    return V.resolveObjectRef({ __objectRef: true, name: 'goblin', id: '2' }, lookup) === B &&
      V.resolveObjectRef({ __objectRef: true, name: 'goblin', id: '9' }, lookup) === null &&
      V.resolveObjectRef({ __objectRef: true, name: 'goblin', id: '' }, lookup) === A &&
      V.resolveObjectRef({ __objectRef: true, name: '', id: '' }, lookup) === null &&
      V.resolveObjectRef({ gold: 5 }, lookup) === null &&
      V.resolveObjectRef({ __objectRef: true, name: 'ghost', id: '' }, lookup) === null &&
      V.resolveObjectRef({ __objectRef: true, name: 'goblin', id: '1' }, () => { throw new Error('boom'); }) === null;
  })());
check('an object variable stores typed, reads back, and lists with its type',
  (() => {
    const st = V.createVariablesState();
    const entry = V.set(st, 'global', 'target', { __objectRef: true, name: 'goblin', id: '2' });
    const got = V.get(st, 'global', 'target');
    const rows = V.list(st, 'global');
    return entry && entry.type === 'object' && entry.value.name === 'goblin' && entry.value.id === '2' &&
      got && got.type === 'object' && got.value.id === '2' &&
      rows.length === 1 && rows[0].type === 'object' && rows[0].value.name === 'goblin';
  })());
check('a stored handle never shares storage with the variable it came from',
  (() => {
    const st = V.createVariablesState();
    const handle = { __objectRef: true, name: 'goblin', id: '2' };
    V.set(st, 'global', 'target', handle);
    handle.name = 'coin';
    const got = V.get(st, 'global', 'target');
    return got.value.name === 'goblin';
  })());
check('serialize/deserialize round-trips an object variable with its type intact',
  (() => {
    const st = V.createVariablesState();
    V.set(st, 'global', 'target', { __objectRef: true, name: 'goblin', id: '2' });
    V.set(st, 'global', 'score', 5);
    const snap = V.serialize(st);
    const back = V.deserialize(snap);
    const got = V.get(back, 'global', 'target');
    return got && got.type === 'object' && got.value.name === 'goblin' && got.value.id === '2' &&
      V.read(back, 'global', 'score', 0) === 5;
  })());
check('an object definition normalizes to a by-name handle and seeds the run',
  (() => {
    const def = V.normalizeDefinition({ name: 'boss', scope: 'global', type: 'object', value: 'goblin' });
    const st = V.createVariablesState();
    const seeded = V.seedRun(st, [def]);
    const got = V.get(st, 'global', 'boss');
    return def && def.type === 'object' && def.value.name === 'goblin' && def.value.id === '' &&
      seeded === 1 && got && got.type === 'object' && got.value.name === 'goblin';
  })());

// --- execute integration: the real HydraExecute switch ---

// Fixtures: 40x40 objects; centers at (x+20, y+20).
function obj(id, name, posX, posY, over) {
  return Object.assign({
    id: id, name: name, kind: 'sprite', posX: posX, posY: posY, width: 40, height: 40,
    health: 100, maxHealth: 100
  }, over || {});
}
const HERO = obj(9, 'hero', 0, 200);
const GA = obj(1, 'goblin', 0, 0, { health: 70 });       // center (20, 20)
const GB = obj(2, 'goblin', 200, 0, { health: 40 });     // center (220, 20)
const GC = obj(3, 'goblin', 100, 100);                   // center (120, 120), full health
const STORE = { hero: [HERO], goblin: [GA, GB, GC] };

function makeCtx(objectsByName, opts) {
  const o = opts || {};
  const vars = {};
  const warnings = [];
  const varScopes = V.createVariablesState();
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
    executionContext: null,
    setExecutionContext: function (c) { ctx.executionContext = c || null; },
    healthModule: H,
    sceneId: 1
  };
  if (o.noSetCtx) delete ctx.setExecutionContext;
  if (o.noHealth) delete ctx.healthModule;
  if (o.noPick) delete ctx.pick;
  if (o.noPickHooks) delete ctx.pickHooks;
  if (o.noVarScopes) delete ctx.varScopes;
  return { ctx: ctx, vars: vars, warnings: warnings, varScopes: varScopes };
}

function pick(data) {
  return Object.assign({
    type: 'pickObjectIntoVariable', objectName: 'goblin', pickMode: 'nearest',
    nearObject: 'hero', pointX: 0, pointY: 0, varName: 'target', scope: 'global', targetObject: ''
  }, data || {});
}

function readProp(data) {
  return Object.assign({
    type: 'readObjectProperty', varName: 'target', scope: 'global', targetObject: '',
    property: 'x', storeVarName: 'targetX'
  }, data || {});
}

check('execute: Pick Object Into Variable stores the nearest goblin and points the context at it',
  (() => {
    const h = makeCtx(STORE);
    X.executeAction(pick(), h.ctx, 1);
    const entry = V.get(h.varScopes, 'global', 'target');
    return entry && entry.type === 'object' && entry.value.name === 'goblin' && entry.value.id === '3' &&
      h.ctx.executionContext && h.ctx.executionContext.obj1 === GC && h.warnings.length === 0;
  })(), 'nearest to hero (20,220) is GC at (120,120)');
check('execute: Pick Object Into Variable farthest, random, and first modes pick within the set',
  (() => {
    const hf = makeCtx(STORE);
    X.executeAction(pick({ pickMode: 'farthest' }), hf.ctx, 1);
    const far = V.get(hf.varScopes, 'global', 'target');
    const hr = makeCtx(STORE);
    X.executeAction(pick({ pickMode: 'random' }), hr.ctx, 1);
    const rnd = V.get(hr.varScopes, 'global', 'target');
    const h1 = makeCtx(STORE);
    X.executeAction(pick({ pickMode: 'first' }), h1.ctx, 1);
    const first = V.get(h1.varScopes, 'global', 'target');
    return far && far.value.id === '2' &&
      rnd && rnd.value.name === 'goblin' && ['1', '2', '3'].indexOf(rnd.value.id) !== -1 &&
      first && first.value.id === '1' &&
      hf.warnings.length === 0 && hr.warnings.length === 0 && h1.warnings.length === 0;
  })(), 'farthest from hero is GB, first is GA');
check('execute: Pick Object Into Variable falls back to the X/Y point when Near is blank',
  (() => {
    const h = makeCtx(STORE);
    X.executeAction(pick({ nearObject: '', pointX: 0, pointY: 0 }), h.ctx, 1);
    const entry = V.get(h.varScopes, 'global', 'target');
    return entry && entry.value.id === '1' && h.warnings.length === 0;
  })(), 'point (0,0): GA center (20,20) is nearest');
check('execute: Pick Object Into Variable into the object scope writes per object name',
  (() => {
    const h = makeCtx(STORE);
    X.executeAction(pick({ scope: 'object', targetObject: 'hero' }), h.ctx, 1);
    const entry = V.get(h.varScopes, 'object', 'target', { objectName: 'hero' });
    const other = V.get(h.varScopes, 'object', 'target', { objectName: 'goblin' });
    return entry && entry.value.id === '3' && other === null && h.warnings.length === 0;
  })());
check('execute: Pick Object Into Variable with no live objects stays quiet and writes nothing',
  (() => {
    const h = makeCtx({ hero: [HERO] });
    X.executeAction(pick(), h.ctx, 1);
    return V.get(h.varScopes, 'global', 'target') === null &&
      h.ctx.executionContext === null && h.warnings.length === 0;
  })());
check('execute: Pick Object Into Variable warns and holds on a blank object, a blank variable, or an object scope with no object',
  (() => {
    const h1 = makeCtx(STORE);
    X.executeAction(pick({ objectName: '  ' }), h1.ctx, 1);
    const h2 = makeCtx(STORE);
    X.executeAction(pick({ varName: '' }), h2.ctx, 1);
    const h3 = makeCtx(STORE);
    X.executeAction(pick({ scope: 'object', targetObject: '' }), h3.ctx, 1);
    return h1.warnings.length === 1 && /no object is named/.test(h1.warnings[0]) &&
      V.get(h1.varScopes, 'global', 'target') === null &&
      h2.warnings.length === 1 && /variable name is blank/.test(h2.warnings[0]) &&
      h3.warnings.length === 1 && /object scope needs an object/.test(h3.warnings[0]);
  })());
check('execute: Pick Object Into Variable without the context hook warns once and still stores the object',
  (() => {
    const h = makeCtx(STORE, { noSetCtx: true });
    X.executeAction(pick(), h.ctx, 1);
    const entry = V.get(h.varScopes, 'global', 'target');
    return entry && entry.value.id === '3' && h.warnings.length === 1 &&
      /cannot point later actions/.test(h.warnings[0]);
  })());
check('execute: Pick Object Into Variable with no pick module or no pick hooks stays quiet',
  (() => {
    const h1 = makeCtx(STORE, { noPick: true });
    X.executeAction(pick(), h1.ctx, 1);
    const h2 = makeCtx(STORE, { noPickHooks: true });
    X.executeAction(pick(), h2.ctx, 1);
    return V.get(h1.varScopes, 'global', 'target') === null && h1.warnings.length === 0 &&
      V.get(h2.varScopes, 'global', 'target') === null && h2.warnings.length === 0;
  })());

// --- execute integration: Pick Tagged Object Into Variable (batch 35) ---
function taggedPickCtx(opts) {
  const o = opts || {};
  const tagged = {
    hero: [Object.assign({}, HERO)],
    goblin: [Object.assign({}, GA, { tags: ['goblin'] }),
      Object.assign({}, GB, { tags: ['Goblin'] }),
      Object.assign({}, GC, { tags: ['goblin'] })],
    coin: [Object.assign({}, obj(4, 'coin', 300, 300), { tags: ['coin'] })]
  };
  const h = makeCtx(tagged, o);
  if (!o.noPickHooks) {
    const all = [].concat(tagged.hero, tagged.goblin, tagged.coin);
    h.ctx.pickHooks = function () {
      return {
        liveObjects: function (name) { return (tagged[name] || []).slice(); },
        liveObjectsByTag: function (tag) {
          const t = String(tag).trim().toLowerCase();
          return all.filter(function (x) {
            return Array.isArray(x.tags) && x.tags.some(function (y) {
              return typeof y === 'string' && y.trim().toLowerCase() === t;
            });
          });
        },
        num: function (raw) { return E.evaluate(raw, { variables: h.vars }); },
        warn: function (m) { h.warnings.push(m); }
      };
    };
  }
  return h;
}
function pickTagged(data) {
  return Object.assign({
    type: 'pickTaggedObjectIntoVariable', tag: 'goblin', pickMode: 'nearest',
    nearObject: 'hero', pointX: 0, pointY: 0, varName: 'target', scope: 'global', targetObject: ''
  }, data || {});
}
check('execute: Pick Tagged Object Into Variable stores the nearest tagged goblin and points the context at it',
  (() => {
    const h = taggedPickCtx();
    X.executeAction(pickTagged(), h.ctx, 1);
    const entry = V.get(h.varScopes, 'global', 'target');
    return entry && entry.type === 'object' && entry.value.name === 'goblin' && entry.value.id === '3' &&
      h.ctx.executionContext && h.ctx.executionContext.obj1 &&
      h.ctx.executionContext.obj1.id === 3 && h.warnings.length === 0;
  })(), 'nearest to hero (20,220) is GC at (120,120)');
check('execute: Pick Tagged Object Into Variable farthest, random, and first modes pick within the tagged set',
  (() => {
    const hf = taggedPickCtx();
    X.executeAction(pickTagged({ pickMode: 'farthest' }), hf.ctx, 1);
    const far = V.get(hf.varScopes, 'global', 'target');
    const hr = taggedPickCtx();
    X.executeAction(pickTagged({ pickMode: 'random' }), hr.ctx, 1);
    const rnd = V.get(hr.varScopes, 'global', 'target');
    const h1 = taggedPickCtx();
    X.executeAction(pickTagged({ pickMode: 'first' }), h1.ctx, 1);
    const first = V.get(h1.varScopes, 'global', 'target');
    return far && far.value.id === '2' &&
      rnd && rnd.value.name === 'goblin' && ['1', '2', '3'].indexOf(rnd.value.id) !== -1 &&
      first && first.value.id === '1' &&
      hf.warnings.length === 0 && hr.warnings.length === 0 && h1.warnings.length === 0;
  })(), 'farthest from hero is GB, first is GA');
check('execute: Pick Tagged Object Into Variable falls back to the X/Y point when Near is blank',
  (() => {
    const h = taggedPickCtx();
    X.executeAction(pickTagged({ nearObject: '', pointX: 0, pointY: 0 }), h.ctx, 1);
    const entry = V.get(h.varScopes, 'global', 'target');
    return entry && entry.value.id === '1' && h.warnings.length === 0;
  })(), 'point (0,0): GA center (20,20) is nearest');
check('execute: Pick Tagged Object Into Variable with no live tagged objects stays quiet and writes nothing',
  (() => {
    const h = taggedPickCtx();
    X.executeAction(pickTagged({ tag: 'boss' }), h.ctx, 1);
    return V.get(h.varScopes, 'global', 'target') === null &&
      h.ctx.executionContext === null && h.warnings.length === 0;
  })());
check('execute: Pick Tagged Object Into Variable warns and holds on a blank tag, a blank variable, or an object scope with no object',
  (() => {
    const h1 = taggedPickCtx();
    X.executeAction(pickTagged({ tag: '  ' }), h1.ctx, 1);
    const h2 = taggedPickCtx();
    X.executeAction(pickTagged({ varName: '' }), h2.ctx, 1);
    const h3 = taggedPickCtx();
    X.executeAction(pickTagged({ scope: 'object', targetObject: '' }), h3.ctx, 1);
    return h1.warnings.length === 1 && /no tag is named/.test(h1.warnings[0]) &&
      V.get(h1.varScopes, 'global', 'target') === null &&
      h2.warnings.length === 1 && /variable name is blank/.test(h2.warnings[0]) &&
      h3.warnings.length === 1 && /object scope needs an object/.test(h3.warnings[0]);
  })());
check('execute: Pick Tagged Object Into Variable without the context hook warns once and still stores the object',
  (() => {
    const h = taggedPickCtx({ noSetCtx: true });
    X.executeAction(pickTagged(), h.ctx, 1);
    const entry = V.get(h.varScopes, 'global', 'target');
    return entry && entry.value.id === '3' && h.warnings.length === 1 &&
      /cannot point later actions/.test(h.warnings[0]);
  })());
check('execute: Pick Tagged Object Into Variable with no pick module or no pick hooks stays quiet',
  (() => {
    const h1 = taggedPickCtx({ noPick: true });
    X.executeAction(pickTagged(), h1.ctx, 1);
    const h2 = taggedPickCtx({ noPickHooks: true });
    X.executeAction(pickTagged(), h2.ctx, 1);
    return V.get(h1.varScopes, 'global', 'target') === null && h1.warnings.length === 0 &&
      V.get(h2.varScopes, 'global', 'target') === null && h2.warnings.length === 0;
  })());

// Seed a held object, then read each property out of it.
function heldCtx() {
  const h = makeCtx(STORE);
  X.executeAction(pick(), h.ctx, 1); // GC, the nearest to hero
  return h;
}

check('execute: Read Object Property reads X, Y, width, height, rotation, and velocity',
  (() => {
    const h = heldCtx();
    const props = { x: 100, y: 100, width: 40, height: 40, rotation: 0, velX: 0, velY: 0 };
    GC.velX = 30; GC.velY = -15; GC.rotation = 45;
    props.velX = 30; props.velY = -15; props.rotation = 45;
    let ok = true;
    Object.keys(props).forEach(function (p) {
      X.executeAction(readProp({ property: p, storeVarName: 'v_' + p }), h.ctx, 2);
      if (h.vars['v_' + p] !== props[p]) ok = false;
    });
    delete GC.velX; delete GC.velY; delete GC.rotation;
    return ok && h.warnings.length === 0;
  })(), 'GC sits at (100,100), 40x40');
check('execute: Read Object Property reads health, max health, name, and alive',
  (() => {
    const h = heldCtx();
    X.executeAction(readProp({ property: 'health', storeVarName: 'hp' }), h.ctx, 2);
    X.executeAction(readProp({ property: 'maxHealth', storeVarName: 'maxHp' }), h.ctx, 2);
    X.executeAction(readProp({ property: 'name', storeVarName: 'nm' }), h.ctx, 2);
    X.executeAction(readProp({ property: 'alive', storeVarName: 'live' }), h.ctx, 2);
    return h.vars.hp === 100 && h.vars.maxHp === 100 && h.vars.nm === 'goblin' &&
      h.vars.live === 1 && h.warnings.length === 0;
  })());
check('execute: Read Object Property of a stale handle reads the fallback and stays quiet',
  (() => {
    const h = makeCtx(STORE);
    // A handle to a goblin that no longer lives: destroy GC in the pool.
    const gone = { hero: [HERO], goblin: [GA, GB] };
    const h2 = makeCtx(gone);
    V.set(h2.varScopes, 'global', 'target',
      { __objectRef: true, name: 'goblin', id: '3' }, { type: 'object' });
    X.executeAction(readProp({ property: 'x', storeVarName: 'x' }), h2.ctx, 2);
    X.executeAction(readProp({ property: 'name', storeVarName: 'nm' }), h2.ctx, 2);
    X.executeAction(readProp({ property: 'alive', storeVarName: 'live' }), h2.ctx, 2);
    return h.vars && h2.vars.x === 0 && h2.vars.nm === '' && h2.vars.live === 0 &&
      h2.warnings.length === 0;
  })());
check('execute: Read Object Property of a missing variable or a variable that holds no object reads the fallback',
  (() => {
    const h = makeCtx(STORE);
    X.executeAction(readProp({ property: 'x', storeVarName: 'x' }), h.ctx, 2);
    V.set(h.varScopes, 'global', 'target', 42);
    X.executeAction(readProp({ property: 'health', storeVarName: 'hp' }), h.ctx, 2);
    return h.vars.x === 0 && h.vars.hp === 0 && h.warnings.length === 0;
  })());
check('execute: Read Object Property warns and holds on a blank object variable or a blank target',
  (() => {
    const h1 = heldCtx();
    X.executeAction(readProp({ varName: '' }), h1.ctx, 2);
    const h2 = heldCtx();
    X.executeAction(readProp({ storeVarName: '' }), h2.ctx, 2);
    return h1.warnings.length === 1 && /object variable is blank/.test(h1.warnings[0]) &&
      h2.warnings.length === 1 && /variable name is blank/.test(h2.warnings[0]) &&
      h1.vars.targetX === undefined && h2.vars.targetX === undefined;
  })());
check('execute: Read Object Property health reads 0 with no health module, never throws',
  (() => {
    const h = makeCtx(STORE, { noHealth: true });
    X.executeAction(pick(), h.ctx, 1);
    X.executeAction(readProp({ property: 'health', storeVarName: 'hp' }), h.ctx, 2);
    return h.vars.hp === 0 && h.warnings.length === 0;
  })());
check('execute: an unknown property reads as 0, never throws',
  (() => {
    const h = heldCtx();
    X.executeAction(readProp({ property: 'wingspan', storeVarName: 'w' }), h.ctx, 2);
    return h.vars.w === 0 && h.warnings.length === 0;
  })());

// --- dispatch integration: a real grid through HydraDispatch + HydraFlow ---

function makeHost(grid, objectsByName) {
  const vars = {};
  const warnings = [];
  const varScopes = V.createVariablesState();
  const startedScopes = new Set();
  const flowTriggerStates = {};
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
    vars: vars, warnings: warnings, varScopes: varScopes, ctx: ctx,
    run: function () { D.processScope(grid, 'test', hooks); }
  };
}

check('dispatch: pick nearest goblin, then Damage Object hits only that goblin, then its health reads out',
  (() => {
    const goblins = [
      obj(1, 'goblin', 0, 0, { health: 70 }),
      obj(2, 'goblin', 200, 0, { health: 40 }),
      obj(3, 'goblin', 100, 100, { health: 100 })
    ];
    const h = makeHost({
      0: { type: 'gameStart', kind: 'condition' },
      1: pick({ nearObject: 'hero' }),
      2: { type: 'damageObject', kind: 'action', targetObject: 'goblin', amount: 10 },
      3: readProp({ property: 'health', storeVarName: 'targetHp' })
    }, { hero: [HERO], goblin: goblins });
    h.run();
    const entry = V.get(h.varScopes, 'global', 'target');
    return entry && entry.value.id === '3' &&
      goblins[0].health === 70 && goblins[1].health === 40 && goblins[2].health === 90 &&
      h.vars.targetHp === 90 && h.warnings.length === 0;
  })(), 'GC nearest to hero takes the 10 damage; GA and GB are untouched');
check('dispatch: the pick runs again on a fresh run and finds the new nearest goblin',
  (() => {
    const goblins = [
      obj(1, 'goblin', 0, 0, { health: 70 }),
      obj(2, 'goblin', 200, 0, { health: 40 })
    ];
    const h = makeHost({
      0: { type: 'gameStart', kind: 'condition' },
      1: pick({ nearObject: 'hero' }),
      2: readProp({ property: 'x', storeVarName: 'targetX' })
    }, { hero: [HERO], goblin: goblins });
    h.run();
    const first = h.vars.targetX;
    // Move the nearest goblin away: GB is now the nearest to the hero.
    goblins[0].posX = 500; goblins[0].posY = 500;
    const h2 = makeHost({
      0: { type: 'gameStart', kind: 'condition' },
      1: pick({ nearObject: 'hero' }),
      2: readProp({ property: 'x', storeVarName: 'targetX' })
    }, { hero: [HERO], goblin: goblins });
    h2.run();
    return first === 0 && h2.vars.targetX === 200 && h2.warnings.length === 0;
  })(), 'GA at (0,0) first, then GB at (200,0) after GA moves away');

// --- catalog + wiring + docs pins ---

const catSb = {};
catSb.window = catSb;
vm.createContext(catSb);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8'),
  catSb, { filename: 'block-catalog.js' });
const catalog = catSb.window.HydraBlockCatalog.blocks;

check('catalog holds 556 blocks (was 552, +4 attach)',
  catalog.length === 556, `got ${catalog.length}`);
check('Variables category holds the two object-reference blocks after Scoped Variable Check',
  (() => {
    const vars = catalog.filter(b => b.category === 'Variables');
    const types = vars.map(b => b.blockType);
    const at = types.indexOf('scoped-variable-check-condition');
    return at !== -1 &&
      types[at + 1] === 'pick-object-into-variable' &&
      types[at + 2] === 'read-object-property';
  })());
check('Pick Object Into Variable declares the pick, point, variable, and scope fields',
  (() => {
    const b = catalog.find(b => b.blockType === 'pick-object-into-variable');
    if (!b) return false;
    const keys = (b.fields || []).map(f => f.key);
    return b.kind === 'action' && b.runtimeType === 'pickObjectIntoVariable' &&
      JSON.stringify(keys) === JSON.stringify(['objectName', 'pickMode', 'nearObject', 'pointX', 'pointY', 'varName', 'scope', 'targetObject']) &&
      b.defaults.pickMode === 'nearest' && b.defaults.varName === 'target' &&
      b.defaults.scope === 'global' && b.defaults.pointX === 0 && b.defaults.pointY === 0;
  })());
check('Read Object Property declares the variable, scope, property, and target fields',
  (() => {
    const b = catalog.find(b => b.blockType === 'read-object-property');
    if (!b) return false;
    const keys = (b.fields || []).map(f => f.key);
    const props = (b.fields.find(f => f.key === 'property') || {}).options || [];
    return b.kind === 'action' && b.runtimeType === 'readObjectProperty' &&
      JSON.stringify(keys) === JSON.stringify(['varName', 'scope', 'targetObject', 'property', 'storeVarName']) &&
      props.map(p => p[0]).join(',') === 'x,y,width,height,rotation,velX,velY,health,maxHealth,name,alive' &&
      b.defaults.property === 'x' && b.defaults.storeVarName === 'targetX';
  })());
check('the two new catalog notes carry no em dashes',
  (() => {
    const notes = catalog.filter(b => b.blockType === 'pick-object-into-variable' ||
      b.blockType === 'read-object-property').map(b => b.note || '');
    return notes.length === 2 && notes.every(n => n.indexOf('\u2014') === -1);
  })());

const exportSrc = fs.readFileSync(path.join(HYDRA, 'player-runtime.js'), 'utf8');
const previewSrc = fs.readFileSync(path.join(HYDRA, 'hydra-previewruntime.js'), 'utf8');
check('export isAction names the object-reference classifier',
  /HydraVariables\.isObjectRefAction\(type\)/.test(exportSrc));
check('both runtimes pass the pick module and its hooks to the execute context',
  /pick: HydraPick/.test(exportSrc) && /pickHooks: function \(\) \{ return pickHooks\(state\); \}/.test(exportSrc) &&
  /pick: mod\('Pick'\)/.test(previewSrc) && /pickHooks: function \(\) \{ return pickHooks\(\); \}/.test(previewSrc));
check('no new module file: the object type lives in hydra-variables.js, the pick in hydra-pick.js',
  !fs.existsSync(path.join(HYDRA, 'hydra-objectrefs.js')));
check('editor formats an object value as its name, never as a number',
  (() => {
    const scriptSrc = fs.readFileSync(path.join(HYDRA, 'script.js'), 'utf8');
    return /if \(type === 'object'\)/.test(scriptSrc) &&
      /object \(' \+ refName \+ '\)'/.test(scriptSrc) &&
      /def\.type === 'object'/.test(scriptSrc);
  })());

const guide = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');
const ref = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');
check('user guide documents object references',
  guide.includes('Pick Object Into Variable') && guide.includes('Read Object Property') &&
  guide.includes('Object references'));
check('block reference documents both blocks',
  ref.includes('Pick Object Into Variable') && ref.includes('Read Object Property'));

if (failures > 0) { console.log(`${failures} objectrefs.test.js checks FAILED`); process.exit(1); }
else { console.log('objectrefs.test.js: all checks passed'); }
