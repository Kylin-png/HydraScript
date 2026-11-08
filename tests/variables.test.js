// Unit tests for hydra/hydra-variables.js — the shared scoped variables
// system (P5 core-engine track, item P5-1: Variables v2, slice a — the
// runtime core).
//
// Pure logic: the per-run global / scene / object variable stores, the
// typed values, the reads and writes, the clearing rules, the
// serialize/deserialize round trip, and the routing sets. Nothing here
// touches the DOM; both runtimes delegate to this module. Static checks
// at the end pin the wiring: catalog blocks, both runtimes' dispatch
// and the scoped conditions, the scene-load clearing (the scene scope
// resets on scene load; global and object scopes survive a scene
// switch, like growth and scaling), and the docs.

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
sandbox.window = sandbox; // hydra-variables.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-variables.js'), 'utf8'),
  sandbox, { filename: 'hydra-variables.js' });
const V = sandbox.HydraVariables;

check('HydraVariables exposed with helpers',
  !!V && typeof V.createVariablesState === 'function' &&
  typeof V.bindLocalScope === 'function' &&
  typeof V.restoreLocalScope === 'function' &&
  typeof V.normalizeScope === 'function' &&
  typeof V.normalizeVarName === 'function' &&
  typeof V.normalizeType === 'function' &&
  typeof V.typeOfValue === 'function' &&
  typeof V.normalizeValue === 'function' &&
  typeof V.objectKeyOf === 'function' &&
  typeof V.sceneKeyOf === 'function' &&
  typeof V.set === 'function' && typeof V.get === 'function' &&
  typeof V.read === 'function' && typeof V.has === 'function' &&
  typeof V.remove === 'function' && typeof V.list === 'function' &&
  typeof V.clearScene === 'function' &&
  typeof V.clearScope === 'function' &&
  typeof V.resetRun === 'function' &&
  typeof V.serialize === 'function' &&
  typeof V.deserialize === 'function' &&
  typeof V.normalizeDefinition === 'function' &&
  typeof V.normalizeDefinitions === 'function' &&
  typeof V.definitionKey === 'function' &&
  typeof V.seedRun === 'function' &&
  typeof V.seedScene === 'function' &&
  typeof V.isScopedVariableAction === 'function' &&
  typeof V.isScopedVariableCondition === 'function');
check('factorySource is a non-empty string',
  typeof V.factorySource === 'string' && V.factorySource.length > 100 &&
  V.factorySource.includes('hydraVariablesFactory'));

// --- state + names + scopes + types ---
check('createVariablesState starts with no variables anywhere',
  JSON.stringify(V.createVariablesState()) === JSON.stringify({ global: {}, scene: {}, object: {}, local: {} }));
check('normalizeScope reads global/scene/object/local and defaults anything else to global',
  V.normalizeScope('global') === 'global' && V.normalizeScope('scene') === 'scene' &&
  V.normalizeScope('object') === 'object' && V.normalizeScope('local') === 'local' &&
  V.normalizeScope('Local') === 'local' && V.normalizeScope('Scene') === 'scene' &&
  V.normalizeScope('  object  ') === 'object' && V.normalizeScope('oops') === 'global' &&
  V.normalizeScope('') === 'global' && V.normalizeScope(null) === 'global' &&
  V.normalizeScope(undefined) === 'global');
check('normalizeVarName trims and rejects blanks',
  V.normalizeVarName('coins') === 'coins' && V.normalizeVarName('  coins  ') === 'coins' &&
  V.normalizeVarName('') === null && V.normalizeVarName('   ') === null &&
  V.normalizeVarName(null) === null && V.normalizeVarName(42) === null);
check('normalizeType reads the six types and defaults anything else to number',
  V.normalizeType('number') === 'number' && V.normalizeType('text') === 'text' &&
  V.normalizeType('bool') === 'bool' && V.normalizeType('list') === 'list' &&
  V.normalizeType('dict') === 'dict' && V.normalizeType('object') === 'object' &&
  V.normalizeType('Text') === 'text' &&
  V.normalizeType('oops') === 'number' && V.normalizeType(null) === 'number');
check('typeOfValue tags numbers, text, bools, lists, dicts, and object handles, and null for nothing',
  V.typeOfValue(5) === 'number' && V.typeOfValue(0) === 'number' &&
  V.typeOfValue('hi') === 'text' && V.typeOfValue('') === 'text' &&
  V.typeOfValue(true) === 'bool' && V.typeOfValue(false) === 'bool' &&
  V.typeOfValue([1, 2]) === 'list' && V.typeOfValue([]) === 'list' &&
  V.typeOfValue({ gold: 5 }) === 'dict' && V.typeOfValue({}) === 'dict' &&
  V.typeOfValue({ __objectRef: true, name: 'goblin', id: '1' }) === 'object' &&
  V.typeOfValue({ __objectRef: true, name: '', id: '' }) === 'object' &&
  V.typeOfValue(null) === null && V.typeOfValue(undefined) === null);
check('normalizeValue coerces into each type with the strict-number rule',
  V.normalizeValue(5, 'number') === 5 && V.normalizeValue('42', 'number') === 42 &&
  V.normalizeValue('oops', 'number') === 0 && V.normalizeValue([], 'number') === 0 &&
  V.normalizeValue(null, 'number') === 0 &&
  V.normalizeValue(5, 'text') === '5' && V.normalizeValue(null, 'text') === '' &&
  V.normalizeValue(true, 'bool') === true && V.normalizeValue('true', 'bool') === true &&
  V.normalizeValue('false', 'bool') === false && V.normalizeValue(0, 'bool') === false &&
  V.normalizeValue(2, 'bool') === true && V.normalizeValue(null, 'bool') === false &&
  JSON.stringify(V.normalizeValue([1, 2], 'list')) === '[1,2]' &&
  JSON.stringify(V.normalizeValue('x', 'list')) === '[]' &&
  JSON.stringify(V.normalizeValue({ a: 1 }, 'dict')) === '{"a":1}' &&
  JSON.stringify(V.normalizeValue([1], 'dict')) === '{}' &&
  JSON.stringify(V.normalizeValue({ __objectRef: true, name: 'goblin', id: '7' }, 'object')) === '{"__objectRef":true,"name":"goblin","id":"7"}' &&
  JSON.stringify(V.normalizeValue({ name: 'goblin', id: 7 }, 'object')) === '{"__objectRef":true,"name":"goblin","id":"7"}' &&
  JSON.stringify(V.normalizeValue('goblin', 'object')) === '{"__objectRef":true,"name":"goblin","id":""}' &&
  JSON.stringify(V.normalizeValue(null, 'object')) === '{"__objectRef":true,"name":"","id":""}' &&
  JSON.stringify(V.normalizeValue({ noName: 1 }, 'object')) === '{"__objectRef":true,"name":"","id":""}');
check('objectKeyOf reads the object name, falls back to the id, and rejects blanks',
  V.objectKeyOf({ name: 'goblin', id: 1 }) === 'goblin' &&
  V.objectKeyOf({ name: '  goblin  ', id: 1 }) === 'goblin' &&
  V.objectKeyOf({ name: '', id: 5 }) === '5' &&
  V.objectKeyOf({ name: '', id: null }) === null &&
  V.objectKeyOf({}) === null && V.objectKeyOf(null) === null &&
  V.objectKeyOf('goblin') === 'goblin' && V.objectKeyOf('  ') === null);
check('sceneKeyOf reads the scene id as a string and rejects blanks',
  V.sceneKeyOf(1) === '1' && V.sceneKeyOf('2') === '2' &&
  V.sceneKeyOf(null) === null && V.sceneKeyOf('') === null);

// --- global scope ---
check('global set/get/read/has: a number stores typed and reads back',
  (() => {
    const st = V.createVariablesState();
    const entry = V.set(st, 'global', 'score', 10);
    return entry && entry.type === 'number' && entry.value === 10 &&
      V.get(st, 'global', 'score').value === 10 &&
      V.read(st, 'global', 'score', 0) === 10 &&
      V.has(st, 'global', 'score') === true;
  })());
check('global stores text and bool with their types',
  (() => {
    const st = V.createVariablesState();
    V.set(st, 'global', 'name', 'Ky\'lin');
    V.set(st, 'global', 'won', true);
    const n = V.get(st, 'global', 'name');
    const w = V.get(st, 'global', 'won');
    return n.type === 'text' && n.value === 'Ky\'lin' &&
      w.type === 'bool' && w.value === true;
  })());
check('a missing global variable reads as not-there, never as created',
  (() => {
    const st = V.createVariablesState();
    return V.get(st, 'global', 'nope') === null &&
      V.read(st, 'global', 'nope', 7) === 7 &&
      V.has(st, 'global', 'nope') === false &&
      JSON.stringify(st) === JSON.stringify({ global: {}, scene: {}, object: {}, local: {} });
  })());
check('set with an explicit type coerces the value into it',
  (() => {
    const st = V.createVariablesState();
    V.set(st, 'global', 'n', '42', { type: 'number' });
    V.set(st, 'global', 't', 5, { type: 'text' });
    V.set(st, 'global', 'b', 'true', { type: 'bool' });
    return V.get(st, 'global', 'n').value === 42 &&
      V.get(st, 'global', 't').value === '5' &&
      V.get(st, 'global', 'b').value === true;
  })());
check('set refuses a blank name and a null value with nothing to infer',
  (() => {
    const st = V.createVariablesState();
    return V.set(st, 'global', '  ', 5) === null &&
      V.set(st, 'global', 'x', null) === null &&
      V.set(st, 'global', 'x', undefined) === null &&
      JSON.stringify(st.global) === '{}';
  })());
check('remove deletes one variable and reports whether anything was there',
  (() => {
    const st = V.createVariablesState();
    V.set(st, 'global', 'a', 1);
    V.set(st, 'global', 'b', 2);
    const first = V.remove(st, 'global', 'a');
    const again = V.remove(st, 'global', 'a');
    return first === true && again === false && V.has(st, 'global', 'b') === true &&
      V.has(st, 'global', 'a') === false;
  })());
check('list returns name-sorted typed records',
  (() => {
    const st = V.createVariablesState();
    V.set(st, 'global', 'zebra', 1);
    V.set(st, 'global', 'apple', 'x');
    V.set(st, 'global', 'mid', true);
    const rows = V.list(st, 'global');
    return rows.length === 3 && rows[0].name === 'apple' && rows[0].type === 'text' &&
      rows[1].name === 'mid' && rows[1].type === 'bool' &&
      rows[2].name === 'zebra' && rows[2].type === 'number';
  })());
check('lists and dicts are deep-copied in and out, so two variables never share storage',
  (() => {
    const st = V.createVariablesState();
    const src = [1, 2];
    V.set(st, 'global', 'inv', src);
    src.push(3);
    const got = V.get(st, 'global', 'inv');
    got.value.push(4);
    const again = V.get(st, 'global', 'inv');
    const d = { gold: 5 };
    V.set(st, 'global', 'player', d);
    d.gold = 99;
    return JSON.stringify(V.read(st, 'global', 'inv', [])) === '[1,2]' &&
      JSON.stringify(again.value) === '[1,2]' &&
      V.read(st, 'global', 'player', {}).gold === 5;
  })());

// --- scene scope ---
check('scene scope keeps one map per scene id, so two scenes can share a name',
  (() => {
    const st = V.createVariablesState();
    V.set(st, 'scene', 'coins', 5, { sceneId: 1 });
    V.set(st, 'scene', 'coins', 99, { sceneId: 2 });
    return V.read(st, 'scene', 'coins', 0, { sceneId: 1 }) === 5 &&
      V.read(st, 'scene', 'coins', 0, { sceneId: 2 }) === 99 &&
      V.read(st, 'scene', 'coins', 0, { sceneId: 3 }) === 0;
  })());
check('scene scope with no scene id stores nothing and reads as missing',
  (() => {
    const st = V.createVariablesState();
    return V.set(st, 'scene', 'coins', 5) === null &&
      V.get(st, 'scene', 'coins') === null &&
      V.has(st, 'scene', 'coins') === false;
  })());
check('clearScene empties one scene only, leaving the other scene and global alone',
  (() => {
    const st = V.createVariablesState();
    V.set(st, 'global', 'score', 10);
    V.set(st, 'scene', 'coins', 5, { sceneId: 1 });
    V.set(st, 'scene', 'coins', 99, { sceneId: 2 });
    const cleared = V.clearScene(st, 1);
    const again = V.clearScene(st, 1);
    return cleared === true && again === false &&
      V.read(st, 'scene', 'coins', 0, { sceneId: 1 }) === 0 &&
      V.read(st, 'scene', 'coins', 0, { sceneId: 2 }) === 99 &&
      V.read(st, 'global', 'score', 0) === 10;
  })());
check('clearScope clears a scene map by id and reports nothing when it was empty',
  (() => {
    const st = V.createVariablesState();
    V.set(st, 'scene', 'coins', 5, { sceneId: 1 });
    const cleared = V.clearScope(st, 'scene', { sceneId: 1 });
    const missing = V.clearScope(st, 'scene', { sceneId: 9 });
    return cleared === true && missing === false &&
      V.read(st, 'scene', 'coins', 0, { sceneId: 1 }) === 0;
  })());

// --- object scope ---
check('object scope keeps one map per object name, keyed by name not by live object',
  (() => {
    const st = V.createVariablesState();
    V.set(st, 'object', 'hp', 30, { objectName: 'goblin' });
    V.set(st, 'object', 'hp', 80, { objectName: 'hero' });
    return V.read(st, 'object', 'hp', 0, { objectName: 'goblin' }) === 30 &&
      V.read(st, 'object', 'hp', 0, { objectName: 'hero' }) === 80 &&
      V.read(st, 'object', 'hp', 0, { objectName: 'ghost' }) === 0;
  })());
check('object scope accepts an object record as the key, not just a bare name',
  (() => {
    const st = V.createVariablesState();
    V.set(st, 'object', 'hp', 30, { objectName: { name: 'goblin', id: 7 } });
    return V.read(st, 'object', 'hp', 0, { objectName: 'goblin' }) === 30;
  })());
check('object scope with no object key stores nothing and reads as missing',
  (() => {
    const st = V.createVariablesState();
    return V.set(st, 'object', 'hp', 30) === null &&
      V.set(st, 'object', 'hp', 30, { objectName: '  ' }) === null &&
      V.get(st, 'object', 'hp') === null;
  })());
check('clearScope on the object scope clears one object, or every object when no name is given',
  (() => {
    const st = V.createVariablesState();
    V.set(st, 'object', 'hp', 30, { objectName: 'goblin' });
    V.set(st, 'object', 'hp', 80, { objectName: 'hero' });
    const one = V.clearScope(st, 'object', { objectName: 'goblin' });
    const oneAgain = V.clearScope(st, 'object', { objectName: 'goblin' });
    const goblinGone = V.read(st, 'object', 'hp', 0, { objectName: 'goblin' }) === 0;
    const heroKept = V.read(st, 'object', 'hp', 0, { objectName: 'hero' }) === 80;
    const all = V.clearScope(st, 'object', {});
    const allAgain = V.clearScope(st, 'object', {});
    return one === true && oneAgain === false && goblinGone && heroKept &&
      all === true && allAgain === false &&
      V.read(st, 'object', 'hp', 0, { objectName: 'hero' }) === 0;
  })());
check('clearScope on the global scope reports nothing on a second clear of an empty map',
  (() => {
    const st = V.createVariablesState();
    V.set(st, 'global', 'score', 10);
    const first = V.clearScope(st, 'global');
    const second = V.clearScope(st, 'global');
    return first === true && second === false &&
      V.read(st, 'global', 'score', 0) === 0;
  })());
check('list on the object scope with no name lists every object, with the object name attached',
  (() => {
    const st = V.createVariablesState();
    V.set(st, 'object', 'hp', 30, { objectName: 'goblin' });
    V.set(st, 'object', 'hp', 80, { objectName: 'hero' });
    const rows = V.list(st, 'object');
    return rows.length === 2 && rows[0].objectName === 'goblin' &&
      rows[1].objectName === 'hero';
  })());
check('resetRun clears every scope at once',
  (() => {
    const st = V.createVariablesState();
    V.set(st, 'global', 'score', 10);
    V.set(st, 'scene', 'coins', 5, { sceneId: 1 });
    V.set(st, 'object', 'hp', 30, { objectName: 'goblin' });
    V.resetRun(st);
    return JSON.stringify(st) === JSON.stringify({ global: {}, scene: {}, object: {}, local: {} });
  })());

// --- serialize / deserialize ---
check('serialize/deserialize round-trips every scope with types intact',
  (() => {
    const st = V.createVariablesState();
    V.set(st, 'global', 'score', 10);
    V.set(st, 'global', 'name', 'hero');
    V.set(st, 'scene', 'coins', 5, { sceneId: 1 });
    V.set(st, 'object', 'hp', 30, { objectName: 'goblin' });
    const back = V.deserialize(V.serialize(st));
    return V.read(back, 'global', 'score', 0) === 10 &&
      V.get(back, 'global', 'name').type === 'text' &&
      V.read(back, 'scene', 'coins', 0, { sceneId: 1 }) === 5 &&
      V.read(back, 'object', 'hp', 0, { objectName: 'goblin' }) === 30 &&
      JSON.stringify(V.serialize(back)) === JSON.stringify(V.serialize(st));
  })());
check('deserialize degrades a hostile snapshot to the fresh-game default',
  (() => {
    const a = V.deserialize(null);
    const b = V.deserialize({ global: { x: { type: 'number', value: 'oops' } }, scene: 'nope', object: null });
    return JSON.stringify(a) === JSON.stringify({ global: {}, scene: {}, object: {}, local: {} }) &&
      V.read(b, 'global', 'x', -1) === 0;
  })());

// --- local scope (P5-3: the innermost function call's locals map) ---
check('local set/get/list/clear read and write the bound map',
  (() => {
    const st = V.createVariablesState();
    V.set(st, 'local', 'a', 5);
    return V.get(st, 'local', 'a').value === 5 &&
      V.list(st, 'local').length === 1 &&
      V.clearScope(st, 'local') === true &&
      V.clearScope(st, 'local') === false;
  })());
check('bindLocalScope swaps the map in and restore puts the previous one back',
  (() => {
    const st = V.createVariablesState();
    V.set(st, 'local', 'outer', 1);
    const inner = {};
    const prev = V.bindLocalScope(st, inner);
    V.set(st, 'local', 'a', 5);
    V.restoreLocalScope(st, prev);
    return V.read(st, 'local', 'a', -1) === -1 && V.read(st, 'local', 'outer', -1) === 1;
  })());
check('a local definition coerces to global instead of vanishing',
  (() => {
    const d = V.normalizeDefinition({ name: 'x', scope: 'local', type: 'number', value: 3 });
    return !!d && d.scope === 'global' && d.value === 3;
  })());

// --- routing + hostile input ---
check('routing sets name the four actions and two conditions, and nothing else',
  V.isScopedVariableAction('setScopedVariable') === true &&
  V.isScopedVariableAction('readScopedVariable') === true &&
  V.isScopedVariableAction('deleteScopedVariable') === true &&
  V.isScopedVariableAction('clearScopedVariables') === true &&
  V.isScopedVariableAction('setVariable') === false &&
  V.isScopedVariableAction('enemyLevel') === false &&
  V.isScopedVariableCondition('scopedVariableExists') === true &&
  V.isScopedVariableCondition('scopedVariableCheck') === true &&
  V.isScopedVariableCondition('getVariable') === false &&
  V.isScopedVariableCondition('setScopedVariable') === false);
check('every public function degrades to a safe default on a missing or hostile state',
  (() => {
    const bad = null;
    return V.get(bad, 'global', 'x') === null &&
      V.read(bad, 'global', 'x', 9) === 9 &&
      V.has(bad, 'global', 'x') === false &&
      V.remove(bad, 'global', 'x') === false &&
      JSON.stringify(V.list(bad, 'global')) === '[]' &&
      V.clearScene(bad, 1) === false &&
      V.clearScope(bad, 'global') === false &&
      V.resetRun(bad) === false &&
      V.set(bad, 'global', 'x', 1) === null &&
      V.set('nope', 'global', 'x', 1) === null;
  })());

// --- static wiring pins ---
{
  const playerJs = fs.readFileSync(path.join(HYDRA, 'player-runtime.js'), 'utf8');
  check('player-runtime.js throws a clear error without hydra-variables.js',
    playerJs.includes("if (!HydraVariables || typeof HydraVariables.createVariablesState !== 'function')") &&
    playerJs.includes('HydraScript player runtime requires hydra-variables.js'));
  check('player-runtime.js inlines HydraVariables into exports',
    playerJs.includes("'HydraVariables', global.HydraVariables && global.HydraVariables.factorySource"));
  check('player-runtime.js classifies scoped-variable blocks for the dispatch',
    playerJs.includes('HydraVariables.isScopedVariableAction(type)') &&
    playerJs.includes('HydraVariables.isScopedVariableCondition(type)'));
  check('player-runtime.js mints the scoped-variable state at boot and exposes the module to both contexts',
    playerJs.includes('varScopes: HydraVariables.createVariablesState()') &&
    playerJs.includes('varScopesModule: HydraVariables') &&
    playerJs.includes('varScopes: state.varScopes'));
  check('player-runtime.js clears the scene scope on scene load (global and object scopes survive)',
    playerJs.includes('HydraVariables.clearScene(state.varScopes, state.sceneId)'));
  const previewJs = fs.readFileSync(path.join(HYDRA, 'hydra-previewruntime.js'), 'utf8');
  check('preview runtime exposes the module to both contexts',
    previewJs.includes("varScopesModule: mod('Variables')") &&
    previewJs.includes('varScopes: variablesRuntime()'));
  check('preview runtime mints the scoped-variable state lazily and resets it on a fresh run only',
    previewJs.includes('function variablesRuntime()') &&
    previewJs.includes('function resetVariablesRuntime()') &&
    previewJs.includes('resetVariablesRuntime();'));
  check('preview runtime clears the scene scope on scene load (both scene-load paths)',
    previewJs.includes('clearPreviewSceneVariables(scene && scene.id)') &&
    (previewJs.match(/clearPreviewSceneVariables\(scene && scene\.id\)/g) || []).length === 2);
  check('preview runtime never resets scoped variables through the scene-reset hooks',
    !previewJs.includes('createVariablesState: function'));
  const executeJs = fs.readFileSync(path.join(HYDRA, 'hydra-execute.js'), 'utf8');
  check('shared execute module runs the four scoped-variable actions',
    executeJs.includes("if (isType(ctx.varScopesModule, 'isScopedVariableAction', type))") &&
    executeJs.includes("type === 'setScopedVariable'") &&
    executeJs.includes("type === 'readScopedVariable'") &&
    executeJs.includes("type === 'deleteScopedVariable'") &&
    executeJs.includes("type === 'clearScopedVariables'") &&
    executeJs.includes('VV.set(ctx.varScopes, data.scope, svName, svVal.value, scopedOpts(data))') &&
    executeJs.includes('VV.read(ctx.varScopes, data.scope, rvName, 0, scopedOpts(data))') &&
    executeJs.includes('VV.remove(ctx.varScopes, data.scope, dvName, scopedOpts(data))') &&
    executeJs.includes('VV.clearScope(ctx.varScopes, data.scope, scopedOpts(data))'));
  const condJs = fs.readFileSync(path.join(HYDRA, 'hydra-conditions.js'), 'utf8');
  check('shared conditions module evaluates both scoped-variable conditions',
    condJs.includes("case 'scopedVariableExists':") &&
    condJs.includes("case 'scopedVariableCheck':") &&
    condJs.includes('VVm.has(ctx.varScopes, seScope, seName') &&
    condJs.includes('scV.get(ctx.varScopes, scScope, scName') &&
    condJs.includes('function rawScopedEntry('));
  const flowJs = fs.readFileSync(path.join(HYDRA, 'hydra-flow.js'), 'utf8');
  check('flow module defaults both scoped-variable conditions to the level trigger',
    flowJs.includes("t === 'scopedVariableExists'") &&
    flowJs.includes("t === 'scopedVariableCheck'"));
  const resetSb = {};
  resetSb.window = resetSb;
  vm.createContext(resetSb);
  vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-scenereset.js'), 'utf8'),
    resetSb, { filename: 'hydra-scenereset.js' });
  const SR = resetSb.HydraSceneReset;
  check('scene reset leaves the scoped-variable record untouched (the host clears the scene scope, not the reset)',
    (() => {
      const varScopes = V.createVariablesState();
      V.set(varScopes, 'global', 'score', 10);
      V.set(varScopes, 'scene', 'coins', 5, { sceneId: 1 });
      const state = { varScopes: varScopes };
      const ok = SR.resetSceneRuntime(state, { id: 1 }, {});
      return ok === true && state.varScopes === varScopes &&
        V.read(state.varScopes, 'global', 'score', 0) === 10 &&
        V.read(state.varScopes, 'scene', 'coins', 0, { sceneId: 1 }) === 5;
    })());
  const catalogJs = fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8');
  check('catalog carries the six scoped-variable blocks in the Variables category',
    catalogJs.includes("blockType: 'set-scoped-variable'") &&
    catalogJs.includes("runtimeType: 'setScopedVariable'") &&
    catalogJs.includes("blockType: 'read-scoped-variable'") &&
    catalogJs.includes("runtimeType: 'readScopedVariable'") &&
    catalogJs.includes("blockType: 'delete-scoped-variable'") &&
    catalogJs.includes("runtimeType: 'deleteScopedVariable'") &&
    catalogJs.includes("blockType: 'clear-scoped-variables'") &&
    catalogJs.includes("runtimeType: 'clearScopedVariables'") &&
    catalogJs.includes("blockType: 'scoped-variable-exists-condition'") &&
    catalogJs.includes("runtimeType: 'scopedVariableExists'") &&
    catalogJs.includes("blockType: 'scoped-variable-check-condition'") &&
    catalogJs.includes("runtimeType: 'scopedVariableCheck'") &&
    catalogJs.includes("key: 'scope', label: 'Scope'") &&
    catalogJs.includes("key: 'valueKind', label: 'Value is'") &&
    catalogJs.includes("key: 'storeVarName', label: 'Into variable'"));
  const refMd = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');
  check('block reference documents all six scoped-variable blocks',
    refMd.includes('Set Scoped Variable') && refMd.includes('Read Scoped Variable') &&
    refMd.includes('Delete Scoped Variable') && refMd.includes('Clear Scoped Variables') &&
    refMd.includes('Scoped Variable Exists') && refMd.includes('Scoped Variable Check') &&
    refMd.includes('### Variables (44)'));
// --- definitions (slice b): the authored starting values ----------
// A definition is the editor's record of a variable — name, scope,
// object, type, starting value — stored in the project and seeded
// into the run state at run start (global + object) and at scene
// load (scene, one copy per scene).
check('normalizeDefinition normalizes a clean definition',
  JSON.stringify(V.normalizeDefinition({ name: ' coins ', scope: 'SCENE', type: 'NUMBER', value: '5' })) ===
  JSON.stringify({ name: 'coins', scope: 'scene', objectName: '', type: 'number', value: 5 }));
check('normalizeDefinition keeps an object definition with its object name',
  JSON.stringify(V.normalizeDefinition({ name: 'hp', scope: 'object', objectName: ' goblin ', type: 'number', value: 30 })) ===
  JSON.stringify({ name: 'hp', scope: 'object', objectName: 'goblin', type: 'number', value: 30 }));
check('normalizeDefinition drops a blank name, an object scope with no object, and a non-object',
  V.normalizeDefinition({ name: '  ', scope: 'global', type: 'number', value: 1 }) === null &&
  V.normalizeDefinition({ name: 'hp', scope: 'object', objectName: ' ', type: 'number', value: 30 }) === null &&
  V.normalizeDefinition({ name: 'hp', scope: 'object', type: 'number', value: 30 }) === null &&
  V.normalizeDefinition('hp') === null && V.normalizeDefinition(null) === null);
check('normalizeDefinition coerces the value into the named type',
  V.normalizeDefinition({ name: 'n', scope: 'global', type: 'number', value: '7' }).value === 7 &&
  V.normalizeDefinition({ name: 't', scope: 'global', type: 'text', value: 7 }).value === '7' &&
  V.normalizeDefinition({ name: 'b', scope: 'global', type: 'bool', value: 'true' }).value === true &&
  V.normalizeDefinition({ name: 'b2', scope: 'global', type: 'bool', value: 0 }).value === false);
check('normalizeDefinition defaults an unknown scope to global and an unknown type to number',
  V.normalizeDefinition({ name: 'x', scope: 'sideways', type: 'weird', value: '3' }).scope === 'global' &&
  V.normalizeDefinition({ name: 'x', scope: 'sideways', type: 'weird', value: '3' }).type === 'number');
check('normalizeDefinitions dedupes by scope + object + name, first entry wins',
  (() => {
    const out = V.normalizeDefinitions([
      { name: 'score', scope: 'global', type: 'number', value: 0 },
      { name: 'score', scope: 'global', type: 'number', value: 99 },
      { name: 'score', scope: 'scene', type: 'number', value: 5 },
      { name: 'hp', scope: 'object', objectName: 'goblin', type: 'number', value: 30 },
      { name: 'hp', scope: 'object', objectName: 'goblin', type: 'number', value: 1 },
      { name: '  ', scope: 'global', type: 'number', value: 1 },
      null
    ]);
    return out.length === 3 && out[0].value === 0 && out[1].value === 5 && out[2].value === 30;
  })());
check('normalizeDefinitions reads a non-array as no definitions',
  JSON.stringify(V.normalizeDefinitions('nope')) === '[]' &&
  JSON.stringify(V.normalizeDefinitions(null)) === '[]' &&
  JSON.stringify(V.normalizeDefinitions(undefined)) === '[]');
check('normalizeDefinitions keeps the same array and objects when the list is already clean',
  (() => {
    // The editor regression: the panel closes over this list and the
    // autosave's normalizeProject reassigns it — a fresh array every
    // call orphaned panel edits (an add pushed into the old array
    // and the next read saw the new one without it). Canonical
    // entries come back as the same objects, so rows holding them
    // keep writing to the live record.
    const defs = [
      { name: 'score', scope: 'global', objectName: '', type: 'number', value: 0 },
      { name: 'hp', scope: 'object', objectName: 'goblin', type: 'number', value: 30 }
    ];
    const out = V.normalizeDefinitions(defs);
    const again = V.normalizeDefinitions(out);
    return out === defs && out[0] === defs[0] && out[1] === defs[1] && again === defs;
  })());
check('normalizeDefinitions replaces a dirty entry once, then the list is stable',
  (() => {
    const defs = [
      { name: 'score', scope: 'global', type: 'number', value: 0 },
      { name: 'hp', scope: 'object', objectName: 'goblin', type: 'number', value: 30 }
    ];
    const once = V.normalizeDefinitions(defs);
    const twice = V.normalizeDefinitions(once);
    return once !== defs && once.length === 2 && once[0].objectName === '' &&
      twice === once && twice[0] === once[0];
  })());
check('definitionKey identifies scope + object + name',
  V.definitionKey({ name: 'hp', scope: 'object', objectName: 'goblin', type: 'number', value: 30 }) === 'object:goblin:hp' &&
  V.definitionKey({ name: 'score', scope: 'global', type: 'number', value: 0 }) === 'global::score' &&
  V.definitionKey({ name: ' ', scope: 'global' }) === null);
check('seedRun seeds global + object definitions and skips scene definitions',
  (() => {
    const st = V.createVariablesState();
    const n = V.seedRun(st, [
      { name: 'score', scope: 'global', type: 'number', value: 0 },
      { name: 'coins', scope: 'scene', type: 'number', value: 0 },
      { name: 'hp', scope: 'object', objectName: 'goblin', type: 'number', value: 30 },
      { name: 'bad', scope: 'object', type: 'number', value: 1 }
    ]);
    return n === 2 &&
      V.read(st, 'global', 'score', -1) === 0 &&
      V.read(st, 'object', 'hp', -1, { objectName: 'goblin' }) === 30 &&
      V.read(st, 'scene', 'coins', -1, { sceneId: 1 }) === -1;
  })());
check('seedScene seeds only the scene definitions, one copy per scene at its starting value',
  (() => {
    const st = V.createVariablesState();
    const n = V.seedScene(st, [
      { name: 'score', scope: 'global', type: 'number', value: 0 },
      { name: 'coins', scope: 'scene', type: 'number', value: 0 }
    ], 2);
    return n === 1 &&
      V.read(st, 'scene', 'coins', -1, { sceneId: 2 }) === 0 &&
      V.read(st, 'scene', 'coins', -1, { sceneId: 1 }) === -1 &&
      V.read(st, 'global', 'score', -1) === -1;
  })());
check('seedRun and seedScene never throw and count nothing without a state or scene id',
  V.seedRun(null, [{ name: 'x', scope: 'global', type: 'number', value: 1 }]) === 0 &&
  V.seedScene(V.createVariablesState(), [{ name: 'x', scope: 'scene', type: 'number', value: 1 }], null) === 0 &&
  V.seedScene(null, [{ name: 'x', scope: 'scene', type: 'number', value: 1 }], 1) === 0);
check('seeded definitions keep their types (text and bool survive the round trip)',
  (() => {
    const st = V.createVariablesState();
    V.seedRun(st, [
      { name: 'title', scope: 'global', type: 'text', value: 'hero' },
      { name: 'won', scope: 'global', type: 'bool', value: true }
    ]);
    return V.get(st, 'global', 'title').type === 'text' &&
      V.get(st, 'global', 'title').value === 'hero' &&
      V.get(st, 'global', 'won').type === 'bool' &&
      V.get(st, 'global', 'won').value === true;
  })());

// --- slice b static wiring pins ---
{
  const playerJs = fs.readFileSync(path.join(HYDRA, 'player-runtime.js'), 'utf8');
  check('player-runtime.js normalizes the definition list once at run start',
    playerJs.includes('varDefs: HydraVariables.normalizeDefinitions(project.scopedVariables)'));
  check('player-runtime.js seeds the run definitions at boot and the scene definitions on scene load',
    playerJs.includes('HydraVariables.seedRun(state.varScopes, state.varDefs)') &&
    playerJs.includes('HydraVariables.seedScene(state.varScopes, state.varDefs, state.sceneId)'));
  const previewJs = fs.readFileSync(path.join(HYDRA, 'hydra-previewruntime.js'), 'utf8');
  check('preview runtime seeds the run definitions on a fresh run and the scene definitions on scene load',
    previewJs.includes('function seedPreviewRunVariables()') &&
    previewJs.includes('function seedPreviewSceneVariables(sceneId)') &&
    previewJs.includes('seedPreviewRunVariables();') &&
    (previewJs.match(/seedPreviewSceneVariables\(scene && scene\.id\)/g) || []).length === 2);
  check('preview runtime reads the definitions through host.getProjectScopedVariables and reports whether it is running',
    previewJs.includes("hostCall('getProjectScopedVariables', [], [])") &&
    previewJs.includes('isPreviewRunning: function () { return loopRunning; }'));
  const universalJs = fs.readFileSync(path.join(HYDRA, 'hydra-universal.js'), 'utf8');
  check('normalizeProject normalizes the definition list (old projects get none)',
    universalJs.includes('project.scopedVariables = window.HydraVariables.normalizeDefinitions(project.scopedVariables)') &&
    universalJs.includes("} else if (!Array.isArray(project.scopedVariables)) {") &&
    universalJs.includes('project.scopedVariables = [];'));
  const scriptJs = fs.readFileSync(path.join(HYDRA, 'script.js'), 'utf8');
  check('editor hosts the definition list for the preview runtime',
    scriptJs.includes('function getProjectScopedVariables()') &&
    scriptJs.includes('getProjectScopedVariables,'));
  check('editor renders the Variables manager panel and the preview live readout',
    scriptJs.includes('function renderVariablesPanel()') &&
    scriptJs.includes('function renderPreviewVariables()') &&
    scriptJs.includes('function previewVarRow(') &&
    scriptJs.includes('function initVariablesPanel()') &&
    scriptJs.includes('function getMutableScopedVariables()') &&
    scriptJs.includes('function variablesLiveState()') &&
    scriptJs.includes('cur.length = 0;') &&
    scriptJs.includes('initVariablesPanel();'));
  const indexHtml = fs.readFileSync(path.join(HYDRA, 'index.html'), 'utf8');
  check('editor has a Variables inspector tab and panel',
    indexHtml.includes('data-inspector-tab="variables"') &&
    indexHtml.includes('data-inspector-panel="variables"') &&
    indexHtml.includes('id="variables-panel"'));
  check('editor has a Live variables readout in the Preview tab',
    indexHtml.includes('id="preview-variables"') &&
    indexHtml.includes('id="preview-variables-toggle"') &&
    indexHtml.includes('id="preview-variables-count"'));
  const styleCss = fs.readFileSync(path.join(HYDRA, 'style.css'), 'utf8');
  check('stylesheet carries the Variables row styles',
    styleCss.includes('.var-row') && styleCss.includes('.var-type') &&
    styleCss.includes('.var-live-dot') && styleCss.includes('.var-group-title'));
  const templatesJs = fs.readFileSync(path.join(HYDRA, 'starter-templates.js'), 'utf8');
  check('starter templates ship the Scoped Variables Demo with its definitions',
    templatesJs.includes("id: 'variables-demo'") &&
    templatesJs.includes('function variablesDemoScenes()') &&
    templatesJs.includes("scopedVariables: [") &&
    templatesJs.includes("{ name: 'score', scope: 'global', type: 'number', value: 0 }") &&
    templatesJs.includes("{ name: 'coins', scope: 'scene', type: 'number', value: 0 }") &&
    templatesJs.includes("{ name: 'hp', scope: 'object', objectName: 'goblin', type: 'number', value: 30 }"));
  const guideMd = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');
  check('user guide covers the Variables manager and definitions',
    guideMd.includes('Variables manager') && guideMd.includes('starting value') &&
    guideMd.includes('Scoped Variables Demo'));
}
}

process.exit(failures === 0 ? 0 : 1);
