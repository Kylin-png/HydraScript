// Unit tests for the P5-6 slice-a nested paths in hydra/hydra-collections.js:
// parsePath / getPathValue / setPathValue plus the nestedGet / nestedSet
// block dispatch, catalog entries, wiring, and docs pins.
//
// A path walks through lists and structures in one block — party[0].hp,
// player.stats.hp — building the containers it needs on the way down.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const REPO = path.join(__dirname, '..');
const HYDRA = path.join(REPO, 'hydra');

const sandbox = {};
sandbox.window = sandbox; // hydra-collections.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-collections.js'), 'utf8'),
  sandbox, { filename: 'hydra-collections.js' });
const C = sandbox.HydraCollections;

// ---------- module surface ----------
check('HydraCollections exposes the path helpers',
  !!C && typeof C.parsePath === 'function' &&
  typeof C.getPathValue === 'function' && typeof C.setPathValue === 'function');
check('nestedGet and nestedSet are registered collection actions (21 actions + 3 conditions)',
  C.ACTION_TYPES.length === 21 && C.CONDITION_TYPES.length === 3 &&
  C.isCollectionAction('nestedGet') && C.isCollectionAction('nestedSet') &&
  !C.isCollectionCondition('nestedGet'));

// ---------- parsePath ----------
check('parsePath reads a field path', (() => {
  const p = C.parsePath('player.stats.hp');
  return p.ok && p.steps.length === 3 &&
    p.steps[0].field === 'player' && p.steps[1].field === 'stats' && p.steps[2].field === 'hp';
})());
check('parsePath reads index steps', (() => {
  const p = C.parsePath('party[0].hp');
  return p.ok && p.steps.length === 3 &&
    p.steps[0].field === 'party' && p.steps[1].index === 0 && p.steps[2].field === 'hp';
})());
check('parsePath allows a list root', (() => {
  const p = C.parsePath('[0].name');
  return p.ok && p.steps.length === 2 && p.steps[0].index === 0 && p.steps[1].field === 'name';
})());
check('parsePath allows a negative index and ignores whitespace', (() => {
  const p = C.parsePath(' party [ -1 ] . name ');
  return p.ok && p.steps.length === 3 && p.steps[1].index === -1 && p.steps[2].field === 'name';
})());
check('parsePath rejects blank and malformed paths',
  !C.parsePath('').ok && !C.parsePath('   ').ok && !C.parsePath(null).ok &&
  !C.parsePath('a..b').ok && !C.parsePath('a.').ok && !C.parsePath('a[').ok &&
  !C.parsePath('a[x]').ok && !C.parsePath('a.1b').ok && !C.parsePath('[1.5]').ok &&
  !C.parsePath('a]').ok && !C.parsePath('a[1').ok);

// ---------- getPathValue ----------
{
  const root = { party: [{ name: 'Ky', hp: 30 }, { name: 'Bo', hp: 25 }], player: { stats: { hp: 10 } } };
  check('getPathValue reads a field of a list item',
    C.getPathValue(root, C.parsePath('party[0].hp').steps).value === 30);
  check('getPathValue reads a field of a field',
    C.getPathValue(root, C.parsePath('player.stats.hp').steps).value === 10);
  check('getPathValue reads text values',
    C.getPathValue(root, C.parsePath('party[1].name').steps).value === 'Bo');
  check('getPathValue counts a negative index from the end',
    C.getPathValue(root, C.parsePath('party[-1].hp').steps).value === 25);
  check('getPathValue on a missing field reads 0',
    (() => { const r = C.getPathValue(root, C.parsePath('party[0].mp').steps); return !r.ok && r.value === 0; })());
  check('getPathValue on an out-of-range index reads 0',
    (() => { const r = C.getPathValue(root, C.parsePath('party[9].hp').steps); return !r.ok && r.value === 0; })());
  check('getPathValue through a plain value reads 0',
    (() => { const r = C.getPathValue(root, C.parsePath('party[0].hp.x').steps); return !r.ok && r.value === 0; })());
  check('getPathValue through a missing root reads 0',
    (() => { const r = C.getPathValue(undefined, C.parsePath('a.b').steps); return !r.ok && r.value === 0; })());
  check('getPathValue with no steps reads 0',
    (() => { const r = C.getPathValue(root, []); return !r.ok && r.value === 0; })());
  check('getPathValue reads a whole nested value (a list)',
    (() => {
      const r = C.getPathValue(root, C.parsePath('party').steps);
      return r.ok && Array.isArray(r.value) && r.value.length === 2;
    })());
}

// ---------- setPathValue ----------
{
  const root = {};
  check('setPathValue builds dictionaries on the way down',
    C.setPathValue(root, C.parsePath('player.stats.hp').steps, 42).ok &&
    root.player.stats.hp === 42);
  check('setPathValue builds lists on the way down',
    C.setPathValue(root, C.parsePath('party[1].name').steps, 'Bo').ok &&
    root.party.length === 2 && root.party[0] === 0 && root.party[1].name === 'Bo');
  check('setPathValue replaces a plain intermediate with a container',
    C.setPathValue(root, C.parsePath('player.stats.hp.max').steps, 99).ok &&
    root.player.stats.hp.max === 99);
  check('setPathValue writes a negative index from the end',
    C.setPathValue(root, C.parsePath('party[-1].hp').steps, 25).ok &&
    root.party[1].hp === 25);
  check('setPathValue on a non-container root fails',
    !C.setPathValue(5, C.parsePath('a.b').steps, 1).ok &&
    !C.setPathValue(null, C.parsePath('a.b').steps, 1).ok);
  check('setPathValue with no steps fails',
    !C.setPathValue(root, [], 1).ok);
  check('setPathValue past the list cap fails',
    !C.setPathValue(root, C.parsePath('party[10000].hp').steps, 1).ok);
  check('setPathValue with a negative index past the start fails',
    !C.setPathValue(root, C.parsePath('party[-99].hp').steps, 1).ok);
  check('setPathValue leaves siblings alone',
    root.party[0] === 0 && root.player.stats.hp.max === 99);
}

// ---------- dispatch ----------
function makeHooks(vars) {
  const warned = [];
  function num(raw) {
    const s = String(raw == null ? '' : raw).trim();
    const m = /^([+-]?\d+(?:\.\d+)?)\s*([+-])\s*([+-]?\d+(?:\.\d+)?)$/.exec(s);
    let v;
    if (m) v = m[2] === '+' ? Number(m[1]) + Number(m[3]) : Number(m[1]) - Number(m[3]);
    else v = Number(s);
    return { value: v, ok: isFinite(v) };
  }
  return {
    hooks: { num, warn: (m) => warned.push(m), lookupVar: (n) => vars[n] },
    warned
  };
}

{
  const vars = {};
  const { hooks, warned } = makeHooks(vars);
  const act = (type, extra) => C.applyCollectionAction(vars, Object.assign({ type }, extra), hooks);

  act('nestedSet', { varName: 'party', path: '[0].name', valueKind: 'text', value: 'Ky' });
  act('nestedSet', { varName: 'party', path: '[0].hp', valueKind: 'number', value: '30' });
  act('nestedSet', { varName: 'party', path: '[1].name', valueKind: 'text', value: 'Bo' });
  act('nestedSet', { varName: 'party', path: '[1].hp', valueKind: 'number', value: '20 + 5' });
  check('nestedSet creates the list root from an index first step',
    Array.isArray(vars.party) && vars.party.length === 2 &&
    vars.party[0].name === 'Ky' && vars.party[0].hp === 30 &&
    vars.party[1].name === 'Bo' && vars.party[1].hp === 25);
  act('nestedGet', { varName: 'party', path: '[1].hp', storeVarName: 'secondHp' });
  check('nestedGet copies the nested value into a variable', vars.secondHp === 25);
  act('nestedGet', { varName: 'party', path: '[9].hp', storeVarName: 'missingHp' });
  check('nestedGet on a missing step stores 0', vars.missingHp === 0);

  act('nestedSet', { varName: 'player', path: 'stats.hp', valueKind: 'number', value: '10' });
  check('nestedSet creates the dictionary root from a field first step',
    vars.player && vars.player.stats && vars.player.stats.hp === 10);
  act('nestedSet', { varName: 'player', path: 'stats.hp', valueKind: 'number', value: '5 + 5' });
  check('nestedSet overwrites a nested value', vars.player.stats.hp === 10);

  const w1 = warned.length;
  act('nestedSet', { varName: 'party', path: '  ', valueKind: 'number', value: 1 });
  check('nestedSet with a blank path warns and changes nothing',
    warned.length === w1 + 1 && vars.party.length === 2);
  const w2 = warned.length;
  act('nestedGet', { varName: 'party', path: 'nope[', storeVarName: 'bad' });
  check('nestedGet with a malformed path warns and stores nothing',
    warned.length === w2 + 1 && !('bad' in vars));
  const w3 = warned.length;
  act('nestedGet', { varName: 'party', path: '[0].name' });
  check('nestedGet with no target variable warns and stores nothing',
    warned.length === w3 + 1);
  const w4 = warned.length;
  act('nestedSet', { varName: 'party', path: '[10000].hp', valueKind: 'number', value: 1 });
  check('nestedSet past the list cap warns and changes nothing',
    warned.length === w4 + 1 && vars.party.length === 2);
  const w5 = warned.length;
  act('nestedSet', { varName: '   ', path: '[0].hp', valueKind: 'number', value: 1 });
  check('nestedSet with a blank variable name warns and does nothing', warned.length === w5 + 1);

  // valueKind 'variable' deep-copies, so later edits to the source never
  // change the stored copy.
  vars.template = { name: 'goblin', hp: 40 };
  act('nestedSet', { varName: 'party', path: '[2]', valueKind: 'variable', value: 'template' });
  vars.template.hp = 1;
  check('nestedSet with a variable value stores a deep copy',
    vars.party[2].hp === 40 && vars.party.length === 3);
  act('nestedGet', { varName: 'party', path: '[2].hp', storeVarName: 'thirdHp' });
  check('nestedGet reads a whole copied structure field', vars.thirdHp === 40);

  // A nested write into a variable that held a plain number replaces it.
  vars.score = 7;
  act('nestedSet', { varName: 'score', path: 'bonus', valueKind: 'number', value: 3 });
  check('nestedSet replaces a non-container root with a dictionary',
    vars.score && vars.score.bonus === 3);
  check('no other warnings fired', warned.length === w5 + 1);
}

// ---------- catalog + wiring + docs pins ----------

const catSb = {};
catSb.window = catSb;
vm.createContext(catSb);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8'),
  catSb, { filename: 'block-catalog.js' });
const catalog = catSb.window.HydraBlockCatalog.blocks;

check('catalog holds 556 blocks (was 552, +4 attach)',
  catalog.length === 556, `got ${catalog.length}`);
check('Variables category holds the two nested blocks after Variable From JSON',
  (() => {
    const vars = catalog.filter(b => b.category === 'Variables');
    const types = vars.map(b => b.blockType);
    const at = types.indexOf('var-from-json');
    return at !== -1 &&
      types[at + 1] === 'nested-get' &&
      types[at + 2] === 'nested-set';
  })());
check('Get Nested Value declares the variable, path, and target fields',
  (() => {
    const b = catalog.find(b => b.blockType === 'nested-get');
    if (!b) return false;
    const keys = (b.fields || []).map(f => f.key);
    return b.kind === 'action' && b.runtimeType === 'nestedGet' &&
      JSON.stringify(keys) === JSON.stringify(['varName', 'path', 'storeVarName']) &&
      b.defaults.varName === 'party' && b.defaults.path === '[0].name' &&
      b.defaults.storeVarName === 'firstName';
  })());
check('Set Nested Value declares the variable, path, value kind, and value fields',
  (() => {
    const b = catalog.find(b => b.blockType === 'nested-set');
    if (!b) return false;
    const keys = (b.fields || []).map(f => f.key);
    return b.kind === 'action' && b.runtimeType === 'nestedSet' &&
      JSON.stringify(keys) === JSON.stringify(['varName', 'path', 'valueKind', 'value']) &&
      b.defaults.varName === 'party' && b.defaults.path === '[0].hp' &&
      b.defaults.valueKind === 'number' && b.defaults.value === 10;
  })());
check('the two new catalog notes carry no em dashes',
  (() => {
    const notes = catalog.filter(b => b.blockType === 'nested-get' ||
      b.blockType === 'nested-set').map(b => b.note || '');
    return notes.length === 2 && notes.every(n => n.indexOf('\u2014') === -1);
  })());

const exportSrc = fs.readFileSync(path.join(HYDRA, 'player-runtime.js'), 'utf8');
check('export isAction names the collection classifier (covers the new types)',
  /HydraCollections\.isCollectionAction\(type\)/.test(exportSrc));
check('export inlines the collections module (the path helpers travel with it)',
  /HydraCollections/.test(exportSrc) &&
  /hydra-collections\.js \(window\.HydraCollections\)/.test(exportSrc));
const executeSrc = fs.readFileSync(path.join(HYDRA, 'hydra-execute.js'), 'utf8');
check('execute dispatches collection actions through the shared module',
  /isCollectionAction/.test(executeSrc) &&
  /applyCollectionAction/.test(executeSrc));
check('block reference lists both nested blocks under Variables (44)',
  (() => {
    const refMd = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');
    return refMd.includes('### Variables (44)') &&
      refMd.includes('| Get Nested Value | Action | Reads a value deep inside a list or structure into another variable |') &&
      refMd.includes('| Set Nested Value | Action | Writes a value deep inside a list or structure |') &&
      refMd.includes('#### Get Nested Value') &&
      refMd.includes('#### Set Nested Value');
  })());
check('user guide documents the nested paths',
  (() => {
    const guide = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');
    return guide.includes('**Get Nested Value**') && guide.includes('party[0].hp') &&
      guide.includes('**Set Nested Value**');
  })());

if (failures > 0) { console.log(`${failures} FAILURES`); process.exitCode = 1; }
else { console.log('ALL NESTED-PATH TESTS PASSED'); }
