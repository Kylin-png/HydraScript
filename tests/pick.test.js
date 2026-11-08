// Unit tests for hydra/hydra-pick.js — the shared object picking module.
//
// Pure logic: nearest/farthest/random picks over plain object records, the
// read-only condition dispatch, hostile-input safety. Nothing here touches
// the DOM; both runtimes delegate to this module.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const sandbox = {};
sandbox.window = sandbox; // hydra-pick.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-pick.js'), 'utf8'),
  sandbox, { filename: 'hydra-pick.js' });
const P = sandbox.HydraPick;

check('HydraPick exposed with dispatcher',
  !!P && typeof P.evalPickCondition === 'function' &&
  typeof P.isPickCondition === 'function');
check('factorySource is a self-contained function string',
  typeof P.factorySource === 'string' && P.factorySource.includes('hydraPickFactory'));
check('3 condition types registered',
  P.CONDITION_TYPES.length === 3 &&
  P.isPickCondition('pickNearest') && P.isPickCondition('pickFarthest') &&
  P.isPickCondition('pickRandom') &&
  !P.isPickCondition('distanceCheck') && !P.isPickCondition('collision'));

// Test hooks: live objects by name, a tiny expression evaluator (plain
// numbers), warnings collected.
function makeHooks(objectsByName) {
  const warned = [];
  function num(raw) {
    const v = Number(String(raw == null ? '' : raw).trim());
    return { value: v, ok: Number.isFinite(v) };
  }
  return {
    hooks: {
      liveObjects: (name) => (objectsByName[name] || []).slice(),
      num,
      warn: (m) => warned.push(m)
    },
    warned
  };
}

// Fixtures: 40x40 objects; centers at (x+20, y+20).
function obj(id, name, posX, posY) {
  return { id, name, kind: 'sprite', posX, posY, width: 40, height: 40 };
}
const A = obj(1, 'enemy', 0, 0);       // center (20, 20)
const B = obj(2, 'enemy', 200, 0);     // center (220, 20)
const C = obj(3, 'enemy', 100, 100);   // center (120, 120)
const HERO = obj(9, 'hero', 0, 200);   // center (20, 220)

// ---------- objectCenter ----------

check('objectCenter computes the hitbox center', (() => {
  const c = P.objectCenter(A);
  return c.x === 20 && c.y === 20;
})(), JSON.stringify(P.objectCenter(A)));
check('objectCenter is null-safe', (() => {
  const c = P.objectCenter(null);
  return c.x === 0 && c.y === 0;
})());
check('objectCenter repairs corrupt fields', (() => {
  const c = P.objectCenter({ posX: 'junk', width: NaN });
  return c.x === 0 && c.y === 0;
})());

// ---------- pickNearest / pickFarthest ----------

check('pickNearest picks the closest object', P.pickNearest([A, B, C], 20, 20) === A);
check('pickNearest picks by center, not top-left', P.pickNearest([B, C], 219, 19) === B);
check('pickFarthest picks the most distant object', P.pickFarthest([A, B, C], 20, 20) === B);
check('pickNearest ties resolve to the first in order', P.pickNearest([A, B], 120, 20) === A,
  'A center (20,20), B center (220,20), ref (120,20) is equidistant');
check('pickFarthest ties resolve to the first in order', P.pickFarthest([B, A], 120, 20) === B);
check('pickNearest returns null for an empty list', P.pickNearest([], 0, 0) === null);
check('pickFarthest returns null for a non-array', P.pickFarthest(null, 0, 0) === null);
check('pickNearest skips hostile entries', P.pickNearest([null, 'x', A], 20, 20) === A);

// ---------- pickRandom ----------

check('pickRandom returns null for an empty list', P.pickRandom([]) === null);
check('pickRandom returns the only object', P.pickRandom([A]) === A);
check('pickRandom stays inside the set over many picks', (() => {
  const set = [A, B, C];
  for (let i = 0; i < 500; i++) {
    if (set.indexOf(P.pickRandom(set)) < 0) return false;
  }
  return true;
})());
check('pickRandom visits every member over many picks', (() => {
  const seen = {};
  for (let i = 0; i < 2000; i++) seen[P.pickRandom([A, B, C]).id] = true;
  return seen[1] && seen[2] && seen[3];
})(), 'all three enemies picked at least once');
check('pickRandom skips hostile entries', P.pickRandom([null, undefined, B]) === B);

// ---------- evalPickCondition dispatch ----------

const store = { enemy: [A, B, C], hero: [HERO] };

check('pickNearest fires and hands the picked object in context.obj1', (() => {
  const { hooks } = makeHooks(store);
  const r = P.evalPickCondition({ type: 'pickNearest', objectName: 'enemy', nearObject: 'hero', pointX: 0, pointY: 0 }, hooks);
  // hero center (20,220): A center (20,20) d=200, B (220,20) d~283, C (120,120) d~141 -> C
  return r.pass === true && r.context.obj1 === C;
})());
check('pickFarthest fires with the furthest object in context.obj1', (() => {
  const { hooks } = makeHooks(store);
  const r = P.evalPickCondition({ type: 'pickFarthest', objectName: 'enemy', nearObject: 'hero' }, hooks);
  return r.pass === true && r.context.obj1 === B;
})(), 'farthest from hero is B');
check('pickNearest falls back to the X/Y point when Near object is blank', (() => {
  const { hooks } = makeHooks(store);
  const r = P.evalPickCondition({ type: 'pickNearest', objectName: 'enemy', nearObject: '', pointX: 400, pointY: 0 }, hooks);
  return r.pass === true && r.context.obj1 === B;
})(), 'point (400,0): B center (220,20) is nearest');
check('pickRandom fires with a member of the set in context.obj1', (() => {
  const { hooks } = makeHooks(store);
  const r = P.evalPickCondition({ type: 'pickRandom', objectName: 'enemy' }, hooks);
  return r.pass === true && store.enemy.indexOf(r.context.obj1) >= 0;
})());
check('blank object name stays quiet', (() => {
  const { hooks, warned } = makeHooks(store);
  const r = P.evalPickCondition({ type: 'pickNearest', objectName: '  ', nearObject: 'hero' }, hooks);
  return r.pass === false && warned.length === 0;
})(), 'no per-frame warning spam on blank names');
check('missing object name stays quiet', (() => {
  const { hooks, warned } = makeHooks(store);
  const r = P.evalPickCondition({ type: 'pickRandom', objectName: 'ghost' }, hooks);
  return r.pass === false && warned.length === 0;
})());
check('missing Near object stays quiet', (() => {
  const { hooks } = makeHooks(store);
  const r = P.evalPickCondition({ type: 'pickNearest', objectName: 'enemy', nearObject: 'ghost' }, hooks);
  return r.pass === false;
})());
check('bad point expressions stay quiet', (() => {
  const { hooks } = makeHooks(store);
  const r = P.evalPickCondition({ type: 'pickNearest', objectName: 'enemy', nearObject: '', pointX: 'junk', pointY: 0 }, hooks);
  return r.pass === false;
})());
check('unknown type stays quiet', (() => {
  const { hooks } = makeHooks(store);
  const r = P.evalPickCondition({ type: 'nearestDistance', object1: 'enemy', targetObject: 'hero' }, hooks);
  return r.pass === false;
})());
check('hostile data never throws', (() => {
  const { hooks } = makeHooks(store);
  try {
    P.evalPickCondition(null, hooks);
    P.evalPickCondition({ type: 'pickNearest' }, hooks);
    P.evalPickCondition({ type: 'pickNearest', objectName: 'enemy', nearObject: '', pointX: {}, pointY: [] }, hooks);
    P.evalPickCondition({ type: 'pickRandom', objectName: 'enemy' },
      { liveObjects: () => { throw new Error('boom'); }, num: () => ({ ok: false, value: 0 }), warn: () => {} });
    return true;
  } catch (e) { return false; }
})());

// ---------- trigger-mode sanity (the flow module decides) ----------

check('pick conditions are exposed for flow trigger defaults',
  ['pickNearest', 'pickFarthest', 'pickRandom'].every(t => P.CONDITION_TYPES.indexOf(t) >= 0));

// ---------- pickObject (P5-5 slice a: object references as values) ----------

check('PICK_MODES names nearest, farthest, random, first',
  P.PICK_MODES.length === 4 && P.PICK_MODES.indexOf('nearest') === 0 &&
  P.PICK_MODES.indexOf('farthest') === 1 && P.PICK_MODES.indexOf('random') === 2 &&
  P.PICK_MODES.indexOf('first') === 3);
check('normalizePickMode reads the four modes and defaults anything else to nearest',
  P.normalizePickMode('nearest') === 'nearest' && P.normalizePickMode('Farthest') === 'farthest' &&
  P.normalizePickMode('random') === 'random' && P.normalizePickMode('first') === 'first' &&
  P.normalizePickMode('oops') === 'nearest' && P.normalizePickMode('') === 'nearest' &&
  P.normalizePickMode(null) === 'nearest');
check('pickObject nearest uses the Near object when named', (() => {
  const { hooks } = makeHooks(store);
  // hero center (20,220): C (120,120) d~141 is nearest
  return P.pickObject({ objectName: 'enemy', pickMode: 'nearest', nearObject: 'hero' }, hooks) === C;
})());
check('pickObject farthest uses the Near object when named', (() => {
  const { hooks } = makeHooks(store);
  return P.pickObject({ objectName: 'enemy', pickMode: 'farthest', nearObject: 'hero' }, hooks) === B;
})());
check('pickObject nearest falls back to the X/Y point when Near is blank', (() => {
  const { hooks } = makeHooks(store);
  return P.pickObject({ objectName: 'enemy', pickMode: 'nearest', nearObject: '', pointX: 400, pointY: 0 }, hooks) === B;
})());
check('pickObject first takes the first live object in order', (() => {
  const { hooks } = makeHooks(store);
  return P.pickObject({ objectName: 'enemy', pickMode: 'first' }, hooks) === A;
})());
check('pickObject random returns a member of the set', (() => {
  const { hooks } = makeHooks(store);
  return store.enemy.indexOf(P.pickObject({ objectName: 'enemy', pickMode: 'random' }, hooks)) >= 0;
})());
check('pickObject returns null for a blank name, a missing name, a missing Near object, or a bad point', (() => {
  const { hooks } = makeHooks(store);
  return P.pickObject({ objectName: '  ', pickMode: 'nearest' }, hooks) === null &&
    P.pickObject({ objectName: 'ghost', pickMode: 'first' }, hooks) === null &&
    P.pickObject({ objectName: 'enemy', pickMode: 'nearest', nearObject: 'ghost' }, hooks) === null &&
    P.pickObject({ objectName: 'enemy', pickMode: 'nearest', nearObject: '', pointX: 'junk', pointY: 0 }, hooks) === null;
})());
check('pickObject never throws on hostile data', (() => {
  const { hooks } = makeHooks(store);
  try {
    P.pickObject(null, hooks);
    P.pickObject({ objectName: 'enemy' }, hooks);
    P.pickObject({ objectName: 'enemy', pickMode: 'nearest', nearObject: '', pointX: {}, pointY: [] }, hooks);
    P.pickObject({ objectName: 'enemy', pickMode: 'first' },
      { liveObjects: () => { throw new Error('boom'); }, num: () => ({ ok: false, value: 0 }), warn: () => {} });
    return true;
  } catch (e) { return false; }
})());

if (failures > 0) { console.log(`${failures} pick.test.js checks FAILED`); process.exit(1); }
else { console.log('pick.test.js: all checks passed'); }
