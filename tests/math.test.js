// Unit tests for hydra/hydra-math.js — the shared math/random module.
//
// Pure logic: uniform integer rolls, clamping, rounding, random list picks,
// the action dispatch, and the read-only condition dispatch. Nothing here
// touches the DOM; both runtimes delegate to this module.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const sandbox = {};
sandbox.window = sandbox; // hydra-math.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-math.js'), 'utf8'),
  sandbox, { filename: 'hydra-math.js' });
const M = sandbox.HydraMath;

check('HydraMath exposed with dispatchers',
  !!M && typeof M.applyMathAction === 'function' &&
  typeof M.evalMathCondition === 'function' &&
  typeof M.isMathAction === 'function' &&
  typeof M.isMathCondition === 'function');
check('factorySource is a self-contained function string',
  typeof M.factorySource === 'string' && M.factorySource.includes('hydraMathFactory'));
check('5 block types registered (4 actions + 1 condition)',
  M.ACTION_TYPES.length === 4 && M.CONDITION_TYPES.length === 1 &&
  M.isMathAction('randomInteger') && M.isMathAction('clampNumber') &&
  M.isMathAction('roundNumber') && M.isMathAction('randomPick') &&
  M.isMathCondition('numberInRange') &&
  !M.isMathAction('setVariable') && !M.isMathCondition('getVariable'));

// Test hooks: a tiny expression evaluator (plain numbers), warnings
// collected, variable lookup.
function makeHooks(vars) {
  const warned = [];
  function num(raw) {
    const s = String(raw == null ? '' : raw).trim();
    const v = Number(s);
    return { value: v, ok: isFinite(v) };
  }
  return {
    hooks: {
      num,
      warn: (m) => warned.push(m),
      lookupVar: (n) => vars[n]
    },
    warned
  };
}

// ---------- pure helpers ----------

check('randomInteger is uniform over [1,6] after many rolls', (() => {
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, other: 0 };
  for (let i = 0; i < 6000; i++) {
    const v = M.randomInteger(1, 6);
    if (counts[v] === undefined) counts.other++;
    else counts[v]++;
  }
  return counts.other === 0 && Object.keys(counts).every(k => k === 'other' || counts[k] > 700);
})());
check('randomInteger(5,5) always returns 5', M.randomInteger(5, 5) === 5);
check('randomInteger swaps reversed bounds', (() => {
  for (let i = 0; i < 200; i++) {
    const v = M.randomInteger(10, 1);
    if (v < 1 || v > 10 || Math.floor(v) !== v) return false;
  }
  return true;
})());
check('randomInteger shrinks fractional bounds to whole range', (() => {
  for (let i = 0; i < 200; i++) {
    const v = M.randomInteger(1.5, 5.9); // [2, 5]
    if (v < 2 || v > 5 || Math.floor(v) !== v) return false;
  }
  return true;
})());
check('randomInteger works with negatives', (() => {
  for (let i = 0; i < 100; i++) {
    const v = M.randomInteger(-3, 3);
    if (v < -3 || v > 3 || Math.floor(v) !== v) return false;
  }
  return true;
})());

check('clampNumber keeps inside values', M.clampNumber(5, 0, 10) === 5);
check('clampNumber clamps above', M.clampNumber(15, 0, 10) === 10);
check('clampNumber clamps below', M.clampNumber(-5, 0, 10) === 0);
check('clampNumber swaps reversed bounds', M.clampNumber(5, 10, 0) === 5 && M.clampNumber(15, 10, 0) === 10);
check('clampNumber honors equal bounds', M.clampNumber(99, 7, 7) === 7);

check('roundValue nearest', M.roundValue(2.5, 'nearest') === 3 && M.roundValue(2.4, 'nearest') === 2);
check('roundValue down', M.roundValue(2.9, 'down') === 2 && M.roundValue(-2.1, 'down') === -3);
check('roundValue up', M.roundValue(2.1, 'up') === 3 && M.roundValue(-2.9, 'up') === -2);
check('roundValue 1 decimal', M.roundValue(2.55, 'dec1') === 2.6);
check('roundValue 2 decimals', M.roundValue(2.555, 'dec2') === 2.56);
check('roundValue unknown mode falls back to nearest', M.roundValue(2.6, 'junk') === 3);

check('inRange inside', M.inRange(5, 0, 10) === true);
check('inRange on the bounds', M.inRange(0, 0, 10) === true && M.inRange(10, 0, 10) === true);
check('inRange outside', M.inRange(-1, 0, 10) === false && M.inRange(11, 0, 10) === false);
check('inRange swaps reversed bounds', M.inRange(5, 10, 0) === true && M.inRange(15, 10, 0) === false);

// ---------- action dispatch ----------

{
  const vars = {};
  const { hooks, warned } = makeHooks(vars);
  M.applyMathAction(vars, { type: 'randomInteger', varName: 'roll', min: '1', max: '6' }, hooks);
  check('randomInteger writes an integer in range',
    Number.isInteger(vars.roll) && vars.roll >= 1 && vars.roll <= 6);
  check('no warning on clean randomInteger', warned.length === 0);
}
{
  const vars = { health: 150 };
  const { hooks, warned } = makeHooks(vars);
  M.applyMathAction(vars, { type: 'clampNumber', varName: 'health', min: '0', max: '100' }, hooks);
  check('clampNumber clamps the variable in place', vars.health === 100);
  check('no warning on clean clampNumber', warned.length === 0);
}
{
  const vars = { mana: -3 };
  const { hooks } = makeHooks(vars);
  M.applyMathAction(vars, { type: 'clampNumber', varName: 'mana', min: '0', max: '100' }, hooks);
  check('clampNumber clamps below the minimum', vars.mana === 0);
}
{
  const vars = { missing: undefined };
  const { hooks } = makeHooks(vars);
  M.applyMathAction(vars, { type: 'clampNumber', varName: 'newVar', min: '5', max: '10' }, hooks);
  check('clampNumber treats a missing variable as 0 (clamped to 5)', vars.newVar === 5);
}
{
  const vars = { score: 12.345 };
  const { hooks } = makeHooks(vars);
  M.applyMathAction(vars, { type: 'roundNumber', varName: 'score', mode: 'dec1' }, hooks);
  check('roundNumber rounds and writes back', vars.score === 12.3);
}
{
  const vars = { pi: 3.14159 };
  const { hooks } = makeHooks(vars);
  M.applyMathAction(vars, { type: 'roundNumber', varName: 'pi', mode: 'nearest' }, hooks);
  check('roundNumber nearest', vars.pi === 3);
}
{
  const vars = { deck: ['a', 'b', 'c', 'd'], drawn: '' };
  const { hooks, warned } = makeHooks(vars);
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    M.applyMathAction(vars, { type: 'randomPick', varName: 'deck', storeVarName: 'drawn' }, hooks);
    seen.add(vars.drawn);
  }
  check('randomPick copies a random list item', seen.size === 4, `seen=${[...seen]}`);
  check('randomPick never mutates the source list', vars.deck.length === 4);
  check('no warning on clean randomPick', warned.length === 0);
}
{
  const vars = { empty: [], drawn: 'x' };
  const { hooks, warned } = makeHooks(vars);
  M.applyMathAction(vars, { type: 'randomPick', varName: 'empty', storeVarName: 'drawn' }, hooks);
  check('randomPick from an empty list writes 0', vars.drawn === 0 && warned.length === 0);
  M.applyMathAction(vars, { type: 'randomPick', varName: 'noSuchList', storeVarName: 'drawn' }, hooks);
  check('randomPick from a missing list writes 0', vars.drawn === 0);
}
{
  const vars = { n: 42 };
  const { hooks, warned } = makeHooks(vars);
  M.applyMathAction(vars, { type: 'randomInteger', varName: '  ', min: '1', max: '6' }, hooks);
  check('randomInteger with a blank variable name warns and skips',
    warned.length === 1 && vars.n === 42 && Object.keys(vars).length === 1);
  M.applyMathAction(vars, { type: 'clampNumber', varName: '', min: '0', max: '10' }, hooks);
  check('clampNumber with a blank variable name warns', warned.length === 2);
  M.applyMathAction(vars, { type: 'roundNumber', varName: '   ', mode: 'nearest' }, hooks);
  check('roundNumber with a blank variable name warns', warned.length === 3);
  M.applyMathAction(vars, { type: 'randomPick', varName: '', storeVarName: 'drawn' }, hooks);
  check('randomPick with a blank list name warns', warned.length === 4);
  M.applyMathAction(vars, { type: 'randomPick', varName: 'deck', storeVarName: ' ' }, hooks);
  check('randomPick with a blank target name warns', warned.length === 5);
}
{
  const vars = { n: 7 };
  const { hooks, warned } = makeHooks(vars);
  M.applyMathAction(vars, { type: 'randomInteger', varName: 'n', min: 'junk', max: '6' }, hooks);
  check('randomInteger with a bad Min warns and skips', warned.length === 1 && vars.n === 7);
  M.applyMathAction(vars, { type: 'clampNumber', varName: 'n', min: '0', max: 'junk' }, hooks);
  check('clampNumber with a bad Max warns and skips', warned.length === 2 && vars.n === 7);
  M.applyMathAction(vars, { type: 'roundNumber', varName: 'n', mode: 'junk' }, hooks);
  check('roundNumber with a corrupt mode still rounds (nearest fallback)', vars.n === 7);
}
{
  const { hooks, warned } = makeHooks({});
  M.applyMathAction(null, { type: 'randomInteger', varName: 'n', min: '1', max: '6' }, hooks);
  check('action with a missing variable store warns and skips', warned.length === 1);
}

// ---------- condition dispatch (read-only) ----------

{
  const vars = { score: 42 };
  const { hooks } = makeHooks(vars);
  // note: the test hook only understands plain numbers, so literal values
  // stand in for real expression results here.
  let r = M.evalMathCondition({ type: 'numberInRange', value: '42', min: '0', max: '100' }, hooks);
  check('numberInRange fires inside the range', r.pass === true && r.context.value === 42);
  r = M.evalMathCondition({ type: 'numberInRange', value: '150', min: '0', max: '100' }, hooks);
  check('numberInRange stays quiet outside the range', r.pass === false);
  r = M.evalMathCondition({ type: 'numberInRange', value: '50', min: '100', max: '0' }, hooks);
  check('numberInRange swaps reversed bounds', r.pass === true);
  r = M.evalMathCondition({ type: 'numberInRange', value: 'junk', min: '0', max: '100' }, hooks);
  check('numberInRange stays quiet on a bad value (no throw)', r.pass === false);
  r = M.evalMathCondition({ type: 'setVariable' }, hooks);
  check('condition dispatch ignores unknown types', r.pass === false);
  check('condition never creates variables', Object.keys(vars).length === 1);
}

// ---------- hostile input: nothing ever throws ----------

{
  const { hooks, warned } = makeHooks({});
  let threw = false;
  try {
    M.applyMathAction({}, { type: 'randomInteger', varName: 'x', min: null, max: undefined }, hooks);
    M.applyMathAction({}, { type: 'clampNumber', varName: 'x', min: NaN, max: Infinity }, hooks);
    M.applyMathAction({}, { type: 'roundNumber', varName: 'x', mode: null }, hooks);
    M.applyMathAction({}, { type: 'randomPick', varName: 'x', storeVarName: 'y' }, hooks);
    M.evalMathCondition({ type: 'numberInRange', value: null, min: {}, max: [] }, hooks);
    M.applyMathAction({}, { type: 'junkType' }, hooks);
    M.evalMathCondition(null, hooks);
  } catch (e) { threw = true; }
  check('hostile input never throws', !threw);
}

if (failures > 0) { console.log(`${failures} check(s) failed`); process.exit(1); }
console.log('math.test.js: all checks passed');
