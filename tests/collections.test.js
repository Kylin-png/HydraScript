// Unit tests for hydra/hydra-collections.js — the shared arrays/structures
// module.
//
// Pure logic: array and structure operations over the game-variables store,
// block value resolution (number/text/true/false/variable kinds), the action
// dispatch, and the read-only condition dispatch. Nothing here touches the
// DOM; both runtimes delegate to this module.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const sandbox = {};
sandbox.window = sandbox; // hydra-collections.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-collections.js'), 'utf8'),
  sandbox, { filename: 'hydra-collections.js' });
const C = sandbox.HydraCollections;

check('HydraCollections exposed with dispatchers',
  !!C && typeof C.applyCollectionAction === 'function' &&
  typeof C.evalCollectionCondition === 'function' &&
  typeof C.isCollectionAction === 'function' &&
  typeof C.isCollectionCondition === 'function');
check('factorySource is a self-contained function string',
  typeof C.factorySource === 'string' && C.factorySource.includes('hydraCollectionsFactory'));
check('24 block types registered (21 actions + 3 conditions)',
  C.ACTION_TYPES.length === 21 && C.CONDITION_TYPES.length === 3 &&
  C.isCollectionAction('arrayPush') && C.isCollectionCondition('arrayLength') &&
  !C.isCollectionAction('setVariable') && !C.isCollectionCondition('getVariable'));

// Test hooks: a tiny expression evaluator (plain numbers plus a+b/a-b),
// warnings collected, variable lookup.
function makeHooks(vars) {
  const warned = [];
  function num(raw) {
    const s = String(raw == null ? '' : raw).trim();
    let m = /^([+-]?\d+(?:\.\d+)?)\s*([+-])\s*([+-]?\d+(?:\.\d+)?)$/.exec(s);
    let v;
    if (m) v = m[2] === '+' ? Number(m[1]) + Number(m[3]) : Number(m[1]) - Number(m[3]);
    else v = Number(s);
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

// ---------- type helpers ----------
check('isArray / isStructure classify values',
  C.isArray([]) && !C.isArray({}) && !C.isArray(0) && !C.isArray(null) &&
  C.isStructure({}) && !C.isStructure([]) && !C.isStructure('x') && !C.isStructure(null));
{
  const vars = { list: [1], num: 5 };
  check('ensureArray returns the stored array untouched', C.ensureArray(vars, 'list') === vars.list);
  const created = C.ensureArray(vars, 'fresh');
  check('ensureArray creates an empty list for a missing variable',
    Array.isArray(created) && created.length === 0 && vars.fresh === created);
  C.ensureArray(vars, 'num');
  check('ensureArray replaces a non-array variable with an empty list', Array.isArray(vars.num));
  const so = C.ensureStructure(vars, 'obj');
  check('ensureStructure creates an empty structure', C.isStructure(so) && vars.obj === so);
  check('readArray returns null for a missing variable', C.readArray(vars, 'nope') === null);
  check('readArray does not create the variable', !('nope' in vars));
  check('readStructure returns null for an array variable', C.readStructure(vars, 'list') === null);
}

// ---------- indexes ----------
{
  const arr = ['a', 'b', 'c'];
  check('normalizeIndex resolves a plain index', C.normalizeIndex(arr, 1).ok && C.normalizeIndex(arr, 1).index === 1);
  check('normalizeIndex truncates fractions', C.normalizeIndex(arr, 1.9).index === 1);
  check('normalizeIndex: -1 is the last item', C.normalizeIndex(arr, -1).index === 2);
  check('normalizeIndex: -3 is the first item', C.normalizeIndex(arr, -3).index === 0);
  check('normalizeIndex rejects out-of-range', !C.normalizeIndex(arr, 3).ok && !C.normalizeIndex(arr, -4).ok);
  check('normalizeIndex treats NaN as 0', C.normalizeIndex(arr, NaN).index === 0);
}

// ---------- array operations ----------
{
  const arr = [];
  C.pushItem(arr, 1); C.pushItem(arr, 'two'); C.pushItem(arr, true);
  check('pushItem appends mixed values', arr.length === 3 && arr[1] === 'two' && arr[2] === true);
  const p = C.popItem(arr);
  check('popItem returns the last value', p.ok && p.value === true && arr.length === 2);
  check('popItem on an empty list fails with 0', !C.popItem([]).ok && C.popItem([]).value === 0);
  check('getItem reads by index', C.getItem(arr, 0).value === 1 && C.getItem(arr, -1).value === 'two');
  check('getItem out of range gives 0', !C.getItem(arr, 9).ok && C.getItem(arr, 9).value === 0);
  C.setItem(arr, 0, 42);
  check('setItem replaces in place', arr[0] === 42);
  C.setItem(arr, 4, 'x');
  check('setItem past the end grows with 0-fill', arr.length === 5 && arr[2] === 0 && arr[3] === 0 && arr[4] === 'x');
  check('setItem rejects a negative out-of-range index', !C.setItem(arr, -99, 1).ok);
  check('setItem rejects an index past the 10000 cap', !C.setItem(arr, 10000, 1).ok);
  C.insertItem(arr, 1, 'in');
  check('insertItem shifts later items right', arr[0] === 42 && arr[1] === 'in' && arr[2] === 'two' && arr.length === 6);
  const r = C.removeAt(arr, 1);
  check('removeAt returns the removed item', r.ok && r.value === 'in' && arr.length === 5);
  check('removeAt out of range fails', !C.removeAt(arr, 99).ok);
  C.pushItem(arr, 42);
  check('removeValue removes the first exact match', C.removeValue(arr, 42).ok && C.indexOfValue(arr, 42) === 4);
  check('removeValue on a missing value fails', !C.removeValue(arr, 'zzz').ok);
  check('containsValue / indexOfValue', C.containsValue(arr, 'x') && C.indexOfValue(arr, 'x') === 3 && C.indexOfValue(arr, 'zzz') === -1);
  check('sameValue is strict (1 !== "1")', !C.sameValue(1, '1') && C.sameValue(2, 2));
  C.clearArray(arr);
  check('clearArray empties in place', arr.length === 0);
  check('arrayLengthOf', C.arrayLengthOf([1, 2, 3]) === 3);
}
{
  check('joinArray with a custom separator', C.joinArray(['a', 'b', 'c'], ', ') === 'a, b, c');
  check('joinArray stringifies nested structures as JSON', C.joinArray([{ a: 1 }], '|') === '{"a":1}');
  check('joinArray treats null as empty', C.joinArray([1, null], '-') === '1-');
  const nums = [3, 1, 2];
  C.sortArray(nums, 'num-asc');
  check('sortArray num-asc', nums.join(',') === '1,2,3');
  C.sortArray(nums, 'num-desc');
  check('sortArray num-desc', nums.join(',') === '3,2,1');
  const words = ['pear', 'apple', 'fig'];
  C.sortArray(words, 'text-asc');
  check('sortArray text-asc', words.join(',') === 'apple,fig,pear');
  C.sortArray(words, 'text-desc');
  check('sortArray text-desc', words.join(',') === 'pear,fig,apple');
  const mixed = ['b', 10, 'a', 2];
  C.sortArray(mixed, 'num-asc');
  check('sortArray num-asc treats text as 0', mixed[0] === 'b' || mixed[0] === 'a');
  const deck = [1, 2, 3, 4, 5, 6, 7, 8];
  C.shuffleArray(deck);
  check('shuffleArray keeps every item', deck.slice().sort((a, b) => a - b).join(',') === '1,2,3,4,5,6,7,8');
  check('arrayMath sum', C.arrayMath([1, 2, 3], 'sum').value === 6);
  check('arrayMath average', C.arrayMath([1, 2, 3], 'average').value === 2);
  check('arrayMath min/max', C.arrayMath([4, 1, 9], 'min').value === 1 && C.arrayMath([4, 1, 9], 'max').value === 9);
  check('arrayMath counts non-numbers as 0', C.arrayMath(['x', 4], 'sum').value === 4);
  check('arrayMath on an empty list gives 0', C.arrayMath([], 'sum').value === 0 && C.arrayMath([], 'max').value === 0);
  check('arrayMath defaults a corrupt op to sum', C.arrayMath([1, 2], 'bogus').value === 3);
}

// ---------- structure operations ----------
{
  const o = {};
  check('setField writes a field', C.setField(o, 'gold', 50).ok && o.gold === 50);
  check('setField rejects a blank field name', !C.setField(o, '  ', 1).ok);
  check('getField reads a field', C.getField(o, 'gold').value === 50);
  check('getField on a missing field fails with 0', !C.getField(o, 'nope').ok && C.getField(o, 'nope').value === 0);
  check('hasField', C.hasField(o, 'gold') && !C.hasField(o, 'nope') && !C.hasField(o, ''));
  check('removeField deletes', C.removeField(o, 'gold').ok && !('gold' in o));
  check('removeField on a missing field fails', !C.removeField(o, 'gold').ok);
  o.a = 1; o.b = 2;
  check('structKeys lists field names', C.structKeys(o).join(',') === 'a,b');
  C.clearStructure(o);
  check('clearStructure removes every field', Object.keys(o).length === 0);
}

// ---------- JSON bridge ----------
{
  const good = C.parseJson('{"gold": 50, "items": [1, 2]}');
  check('parseJson parses valid JSON', good.ok && good.value.gold === 50 && good.value.items.length === 2);
  const bad = C.parseJson('{not json');
  check('parseJson fails cleanly on invalid JSON', !bad.ok && bad.value === null);
  check('parseJson never throws on hostile input', C.parseJson(null).ok === false || true);
  const s = C.stringifyJson({ a: [1, 2] });
  check('stringifyJson round-trips', s.ok && s.text === '{"a":[1,2]}');
  const circ = {}; circ.self = circ;
  check('stringifyJson survives circular values', C.stringifyJson(circ).ok === false && C.stringifyJson(circ).text === 'null');
}

// ---------- value resolution ----------
{
  const vars = { score: 10, list: [7, 8] };
  const { hooks, warned } = makeHooks(vars);
  check('number kind evaluates the expression', C.resolveBlockValue({ valueKind: 'number', value: '40 + 2' }, hooks).value === 42);
  check('number kind fails on a bad expression', !C.resolveBlockValue({ valueKind: 'number', value: 'nope' }, hooks).ok);
  check('text kind uses the raw text literally', C.resolveBlockValue({ valueKind: 'text', value: 'hello' }, hooks).value === 'hello');
  check('true/false kinds', C.resolveBlockValue({ valueKind: 'true' }, hooks).value === true && C.resolveBlockValue({ valueKind: 'false' }, hooks).value === false);
  const copied = C.resolveBlockValue({ valueKind: 'variable', value: 'list' }, hooks).value;
  check('variable kind deep-copies (editing the copy never edits the source)',
    Array.isArray(copied) && (copied.push(9), vars.list.length === 2));
  check('variable kind on a missing variable gives 0',
    C.resolveBlockValue({ valueKind: 'variable', value: 'nope' }, hooks).value === 0);
  C.resolveBlockValue({ valueKind: 'variable', value: '  ' }, hooks);
  check('variable kind with a blank name warns and gives 0', warned.length === 1);
  check('missing kind defaults to number',
    C.resolveBlockValue({ value: '5' }, hooks).value === 5);
  check('corrupt kind defaults to number',
    C.resolveBlockValue({ valueKind: 'bogus', value: '6' }, hooks).value === 6);
  check('deepCopy of a primitive is the primitive', C.deepCopy(5) === 5 && C.deepCopy('x') === 'x');
}

// ---------- action dispatch ----------
{
  const vars = {};
  const { hooks, warned } = makeHooks(vars);
  const act = (type, extra) => C.applyCollectionAction(vars, Object.assign({ type }, extra), hooks);

  act('arrayPush', { varName: 'inv', valueKind: 'text', value: 'sword' });
  act('arrayPush', { varName: 'inv', valueKind: 'text', value: 'shield' });
  act('arrayPush', { varName: 'inv', valueKind: 'number', value: '40 + 2' });
  check('arrayPush builds the list', JSON.stringify(vars.inv) === '["sword","shield",42]');

  act('arrayGetItem', { varName: 'inv', index: 1, storeVarName: 'picked' });
  check('arrayGetItem copies into the target variable', vars.picked === 'shield');
  act('arrayGetItem', { varName: 'inv', index: 99, storeVarName: 'picked' });
  check('arrayGetItem out of range stores 0', vars.picked === 0);
  const w0 = warned.length;
  act('arrayGetItem', { varName: 'inv', index: 0, storeVarName: '  ' });
  check('arrayGetItem with no target warns and stores nothing', warned.length === w0 + 1 && !('' in vars));

  act('arraySetItem', { varName: 'inv', index: 0, valueKind: 'text', value: 'axe' });
  check('arraySetItem replaces', vars.inv[0] === 'axe');
  act('arraySetItem', { varName: 'inv', index: -1, valueKind: 'text', value: 'bow' });
  check('arraySetItem supports negative indexes', vars.inv[2] === 'bow');

  act('arrayInsert', { varName: 'inv', index: 1, valueKind: 'text', value: 'potion' });
  check('arrayInsert shifts right', vars.inv[1] === 'potion' && vars.inv.length === 4);

  act('arrayPop', { varName: 'inv', storeVarName: 'last' });
  check('arrayPop stores the popped value', vars.last === 'bow' && vars.inv.length === 3);
  act('arrayPop', { varName: 'empty' });
  check('arrayPop on a fresh variable creates an empty list', Array.isArray(vars.empty) && vars.empty.length === 0);

  act('arrayRemoveAt', { varName: 'inv', index: 0, storeVarName: 'gone' });
  check('arrayRemoveAt removes and optionally stores', vars.gone === 'axe' && vars.inv.length === 2);
  act('arrayRemoveValue', { varName: 'inv', valueKind: 'text', value: 'shield' });
  check('arrayRemoveValue removes the first match', JSON.stringify(vars.inv) === '["potion"]');

  act('arrayPush', { varName: 'scores', valueKind: 'number', value: '30' });
  act('arrayPush', { varName: 'scores', valueKind: 'number', value: '10' });
  act('arrayPush', { varName: 'scores', valueKind: 'number', value: '20' });
  act('arraySort', { varName: 'scores', sortMode: 'num-asc' });
  check('arraySort orders the list', vars.scores.join(',') === '10,20,30');
  act('arrayMath', { varName: 'scores', mathOp: 'sum', storeVarName: 'total' });
  check('arrayMath stores the sum', vars.total === 60);
  act('arrayMath', { varName: 'scores', mathOp: 'average', storeVarName: 'avg' });
  check('arrayMath stores the average', vars.avg === 20);

  act('arrayJoin', { varName: 'scores', separator: '+', storeVarName: 'joined' });
  check('arrayJoin glues with the separator', vars.joined === '10+20+30');
  act('arrayClear', { varName: 'scores' });
  check('arrayClear empties the list', vars.scores.length === 0);

  act('arrayShuffle', { varName: 'inv' });
  check('arrayShuffle keeps items', vars.inv.length === 1);

  // structures
  act('structSetField', { varName: 'player', field: 'gold', valueKind: 'number', value: '50' });
  act('structSetField', { varName: 'player', field: 'name', valueKind: 'text', value: 'Ky' });
  check('structSetField writes fields', vars.player.gold === 50 && vars.player.name === 'Ky');
  act('structGetField', { varName: 'player', field: 'gold', storeVarName: 'gold' });
  check('structGetField copies into the target variable', vars.gold === 50);
  act('structGetField', { varName: 'player', field: 'nope', storeVarName: 'gold' });
  check('structGetField on a missing field stores 0', vars.gold === 0);
  const w1 = warned.length;
  act('structSetField', { varName: 'player', field: '  ', valueKind: 'number', value: 1 });
  check('structSetField with a blank field warns and changes nothing', warned.length === w1 + 1 && !('' in vars.player));
  act('structKeys', { varName: 'player', storeVarName: 'keys' });
  check('structKeys stores the field-name list', JSON.stringify(vars.keys) === '["gold","name"]');
  act('structRemoveField', { varName: 'player', field: 'name' });
  check('structRemoveField deletes the field', !('name' in vars.player));
  act('structClear', { varName: 'player' });
  check('structClear empties the structure', Object.keys(vars.player).length === 0);

  // JSON bridge
  vars.cfg = { vol: 8, keys: ['a'] };
  act('varToJson', { varName: 'cfg', storeVarName: 'cfgJson' });
  check('varToJson stringifies', vars.cfgJson === '{"vol":8,"keys":["a"]}');
  act('varFromJson', { varName: 'restored', jsonText: '{"hp": 3}' });
  check('varFromJson rebuilds the value', vars.restored.hp === 3);
  const w2 = warned.length;
  act('varFromJson', { varName: 'restored', jsonText: 'nope{' });
  check('varFromJson on invalid JSON warns and leaves the variable unchanged',
    warned.length === w2 + 1 && vars.restored.hp === 3);

  // blank variable name
  const w3 = warned.length;
  act('arrayPush', { varName: '   ', valueKind: 'number', value: 1 });
  check('a blank variable name warns and does nothing', warned.length === w3 + 1);

  // unknown action type
  const w4 = warned.length;
  C.applyCollectionAction(vars, { type: 'arrayBogus', varName: 'x' }, hooks);
  check('an unknown collection action warns instead of throwing', warned.length === w4 + 1);
}

// ---------- condition dispatch (read-only) ----------
{
  const vars = { inv: ['sword', 'shield'], player: { gold: 50 }, num: 5 };
  const { hooks } = makeHooks(vars);
  const cond = (type, extra) => C.evalCollectionCondition(vars, Object.assign({ type }, extra), hooks).pass;

  check('arrayLength compares the item count',
    cond('arrayLength', { varName: 'inv', operator: '>=', compareValue: 2 }) === true &&
    cond('arrayLength', { varName: 'inv', operator: '==', compareValue: 5 }) === false);
  check('arrayLength on a missing variable reads 0',
    cond('arrayLength', { varName: 'nope', operator: '==', compareValue: 0 }) === true);
  check('arrayLength on a number variable reads 0',
    cond('arrayLength', { varName: 'num', operator: '==', compareValue: 0 }) === true);
  check('arrayLength with a bad expression does not pass',
    cond('arrayLength', { varName: 'inv', operator: '>=', compareValue: 'nope' }) === false);
  check('arrayContains finds an exact match',
    cond('arrayContains', { varName: 'inv', valueKind: 'text', value: 'sword' }) === true &&
    cond('arrayContains', { varName: 'inv', valueKind: 'text', value: 'axe' }) === false);
  check('arrayContains is strict about types',
    cond('arrayContains', { varName: 'inv', valueKind: 'number', value: '0' }) === false);
  check('arrayContains on a missing variable is false',
    cond('arrayContains', { varName: 'nope', valueKind: 'text', value: 'x' }) === false);
  check('structHasField',
    cond('structHasField', { varName: 'player', field: 'gold' }) === true &&
    cond('structHasField', { varName: 'player', field: 'nope' }) === false);
  check('structHasField on a missing variable is false',
    cond('structHasField', { varName: 'nope', field: 'gold' }) === false);
  check('conditions never create variables',
    !('nope' in vars) && C.evalCollectionCondition(vars, { type: 'bogus' }, hooks).pass === false);
}

// ---------- compareValues ----------
check('compareValues covers all six operators',
  C.compareValues(2, '>=', 2) && C.compareValues(1, '<=', 2) && C.compareValues(2, '==', '2') &&
  C.compareValues(2, '!=', 3) && C.compareValues(3, '>', 2) && C.compareValues(1, '<', 2) &&
  !C.compareValues(1, '>=', 2) && C.compareValues(1, 'bogus', 1) === false);

// ---------- hostile input: nothing throws ----------
{
  const vars = {};
  const { hooks } = makeHooks(vars);
  let threw = false;
  try {
    C.applyCollectionAction(vars, { type: 'arrayPush' }, hooks);
    C.applyCollectionAction(vars, { type: 'arraySetItem', varName: 'a', index: null }, hooks);
    C.applyCollectionAction(vars, { type: 'structSetField', varName: 's', field: null }, hooks);
    C.applyCollectionAction(null, { type: 'arrayClear', varName: 'x' }, hooks);
    C.evalCollectionCondition(null, { type: 'arrayLength', varName: 'x' }, hooks);
    C.evalCollectionCondition(vars, { type: 'arrayContains' }, hooks);
    C.joinArray(null, ',');
    C.sortArray(null, 'num-asc');
  } catch (err) { threw = true; }
  check('hostile input never throws', !threw);
}

if (failures > 0) { console.log(`\n${failures} collection test(s) failed`); process.exit(1); }
console.log('\ncollections: all checks passed');
