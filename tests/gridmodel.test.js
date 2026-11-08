// Unit tests for hydra/hydra-gridmodel.js — the pure logic-grid data model
// (P2 item 14, slice 1: the editor's grid data layer as a headless module).
//
// Pure logic: 60x60 geometry, keyboard navigation, scope rules, stored-grid
// read/write, live cell-map ops, block-class lookup, and default data
// records for newly placed blocks. Nothing here touches the DOM; script.js
// delegates to this module and keeps only the cell elements and panels.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}
function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected),
    `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

// --- load: vm sandbox (window) + plain require() ---
const sandbox = {};
sandbox.window = sandbox; // hydra-gridmodel.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-gridmodel.js'), 'utf8'),
  sandbox, { filename: 'hydra-gridmodel.js' });
const M = sandbox.HydraGridModel;

const factory = require(path.join(__dirname, '..', 'hydra', 'hydra-gridmodel.js'));
const M2 = factory();
check('module exposes the full grid-model surface',
  !!M && typeof M.normalizeScriptScope === 'function' &&
  typeof M.sameScriptScope === 'function' && typeof M.getScopeKey === 'function' &&
  typeof M.isValidIndex === 'function' && typeof M.rowOf === 'function' &&
  typeof M.colOf === 'function' && typeof M.indexOf === 'function' &&
  typeof M.rowStartIndex === 'function' && typeof M.rowEndIndex === 'function' &&
  typeof M.adjacentIndexes === 'function' && typeof M.moveIndex === 'function' &&
  typeof M.cloneData === 'function' && typeof M.gridHasBlocks === 'function' &&
  typeof M.createGridData === 'function' &&
  typeof M.getGridDataForScope === 'function' &&
  typeof M.saveGridToScope === 'function' &&
  typeof M.loadGridEntries === 'function' &&
  typeof M.gridDataFromMap === 'function' &&
  typeof M.placeBlock === 'function' && typeof M.clearBlock === 'function' &&
  typeof M.blockClassForType === 'function' &&
  typeof M.buildBlockDefaults === 'function');
check('factorySource is a self-contained function string',
  typeof M.factorySource === 'string' && M.factorySource.includes('hydraGridModelFactory'));
check('plain require() gives an independent instance with the same constants',
  M2 !== M && M2.GRID_COLS === M.GRID_COLS && M2.GRID_CELLS === M.GRID_CELLS);
eq('constants: 60x60 grid', [M.GRID_COLS, M.GRID_ROWS, M.GRID_CELLS], [60, 60, 3600]);

// --- geometry ---
eq('rowOf/colOf center cell 61', [M.rowOf(61), M.colOf(61)], [1, 1]);
eq('rowOf/colOf first cell', [M.rowOf(0), M.colOf(0)], [0, 0]);
eq('rowOf/colOf last cell', [M.rowOf(3599), M.colOf(3599)], [59, 59]);
check('rowOf/colOf reject invalid indexes',
  M.rowOf(-1) === null && M.rowOf(3600) === null && M.rowOf(1.5) === null &&
  M.rowOf('5') === null && M.rowOf(null) === null && M.rowOf(undefined) === null &&
  M.colOf(3600) === null && M.colOf(NaN) === null);
check('isValidIndex accepts 0..3599 only',
  M.isValidIndex(0) && M.isValidIndex(3599) && !M.isValidIndex(-1) &&
  !M.isValidIndex(3600) && !M.isValidIndex(1.5) && !M.isValidIndex('5') &&
  !M.isValidIndex(NaN) && !M.isValidIndex(Infinity) && !M.isValidIndex({}));
eq('indexOf round-trips row/col', [M.indexOf(1, 1), M.indexOf(0, 0), M.indexOf(59, 59)], [61, 0, 3599]);
check('indexOf rejects out-of-range and hostile input',
  M.indexOf(-1, 0) === null && M.indexOf(60, 0) === null && M.indexOf(0, 60) === null &&
  M.indexOf(0, -1) === null && M.indexOf('1', 1) === null && M.indexOf(1.5, 1) === null);
eq('rowStartIndex/rowEndIndex', [M.rowStartIndex(0), M.rowEndIndex(0), M.rowStartIndex(59), M.rowEndIndex(59)], [0, 59, 3540, 3599]);
check('rowStartIndex/rowEndIndex reject bad rows',
  M.rowStartIndex(-1) === null && M.rowStartIndex(60) === null && M.rowEndIndex('3') === null);
eq('adjacentIndexes center uses reading order (right, down, left, up)',
  M.adjacentIndexes(61), [62, 121, 60, 1]);
eq('adjacentIndexes top-left corner', M.adjacentIndexes(0), [1, 60]);
eq('adjacentIndexes bottom-right corner', M.adjacentIndexes(3599), [3598, 3539]);
eq('adjacentIndexes right edge has no right neighbour', M.adjacentIndexes(59), [119, 58]);
eq('adjacentIndexes invalid index yields []', M.adjacentIndexes(3600), []);
eq('adjacentIndexes hostile input yields []', M.adjacentIndexes('61'), []);

// --- keyboard navigation ---
eq('moveIndex arrows from 61', [M.moveIndex(61, 'ArrowLeft'), M.moveIndex(61, 'ArrowRight'), M.moveIndex(61, 'ArrowUp'), M.moveIndex(61, 'ArrowDown')], [60, 62, 1, 121]);
check('moveIndex clamps at the edges (no wrap)',
  M.moveIndex(0, 'ArrowLeft') === null && M.moveIndex(0, 'ArrowUp') === null &&
  M.moveIndex(59, 'ArrowRight') === null && M.moveIndex(3540, 'ArrowDown') === null &&
  M.moveIndex(3599, 'ArrowRight') === null && M.moveIndex(3599, 'ArrowDown') === null);
eq('moveIndex Home/End jump to row ends', [M.moveIndex(65, 'Home'), M.moveIndex(65, 'End'), M.moveIndex(0, 'Home'), M.moveIndex(0, 'End')], [60, 119, 0, 59]);
check('moveIndex ignores other keys and invalid indexes',
  M.moveIndex(61, 'Enter') === null && M.moveIndex(61, ' ') === null &&
  M.moveIndex(61, 'a') === null && M.moveIndex(-1, 'ArrowRight') === null &&
  M.moveIndex(3600, 'Home') === null && M.moveIndex('61', 'ArrowRight') === null);

// --- scopes ---
check('normalizeScriptScope keeps global and numeric ids',
  M.normalizeScriptScope('global') === 'global' && M.normalizeScriptScope(3) === 3 &&
  M.normalizeScriptScope('3') === 3 && M.normalizeScriptScope(0) === 0);
check('normalizeScriptScope repairs anything else to global',
  M.normalizeScriptScope('abc') === 'global' && M.normalizeScriptScope(null) === 'global' &&
  M.normalizeScriptScope(undefined) === 'global' && M.normalizeScriptScope({}) === 'global' &&
  M.normalizeScriptScope('') === 'global');
check('sameScriptScope compares normalized scopes',
  M.sameScriptScope('3', 3) && M.sameScriptScope('global', 'nope') &&
  !M.sameScriptScope(3, 4) && !M.sameScriptScope('global', 3));
eq('getScopeKey stringifies the normalized scope', [M.getScopeKey(3), M.getScopeKey('global'), M.getScopeKey('7')], ['3', 'global', '7']);

// --- grid data: presence ---
check('gridHasBlocks is true only for a non-empty grid object',
  M.gridHasBlocks({ 0: { type: 'gameStart' } }) && !M.gridHasBlocks({}) &&
  !M.gridHasBlocks(null) && !M.gridHasBlocks(undefined) && !M.gridHasBlocks([]));
check('createGridData returns a fresh empty object each call',
  JSON.stringify(M.createGridData()) === '{}' && M.createGridData() !== M.createGridData());

// --- getGridDataForScope ---
{
  const store = { scenes: [{ id: 1, gridData: { 0: { type: 'gameStart' } } }, { id: 2 }], globalGridData: { 5: { type: 'and' } } };
  check('global scope returns the store global grid (same reference)',
    M.getGridDataForScope(store, 'global') === store.globalGridData);
  check('scene scope returns that scene gridData (same reference)',
    M.getGridDataForScope(store, 1) === store.scenes[0].gridData);
  const created = M.getGridDataForScope(store, 2);
  check('scene scope creates gridData when missing', JSON.stringify(created) === '{}' && store.scenes[1].gridData === created);
  const ghost1 = M.getGridDataForScope(store, 99);
  const ghost2 = M.getGridDataForScope(store, 99);
  check('unknown scene returns a fresh unstored {} (writes are lost, legacy behavior)',
    JSON.stringify(ghost1) === '{}' && ghost1 !== ghost2);
  const bare = {};
  check('missing globalGridData is created on the store',
    M.getGridDataForScope(bare, 'global') === bare.globalGridData && JSON.stringify(bare.globalGridData) === '{}');
  check('null store yields {} instead of throwing', JSON.stringify(M.getGridDataForScope(null, 'global')) === '{}');
  const damaged = { scenes: [{ id: 3, gridData: 'not-an-object' }], globalGridData: {} };
  check('wrong-type scene gridData repairs to {}',
    JSON.stringify(M.getGridDataForScope(damaged, 3)) === '{}' && JSON.stringify(damaged.scenes[0].gridData) === '{}');
}

// --- saveGridToScope ---
{
  const store = { scenes: [{ id: 1, gridData: { 9: { type: 'stale' } } }], globalGridData: { 9: { type: 'stale' } } };
  const live = new Map([[0, { type: 'gameStart' }], [61, { type: 'and' }]]);
  check('global save returns true and replaces stale entries', M.saveGridToScope(store, 'global', live) === true);
  eq('global save writes cloned records', store.globalGridData, { 0: { type: 'gameStart' }, 61: { type: 'and' } });
  live.get(0).type = 'mutated';
  check('saved records are clones (later live edits do not leak in)',
    store.globalGridData[0].type === 'gameStart');
  let hooked = null;
  const ok = M.saveGridToScope(store, 1, new Map([[2, { type: 'keyPressed' }]]), (scene) => { hooked = scene; });
  check('scene save returns true and refreshes the logicGrids.main alias',
    ok === true && store.scenes[0].logicGrids.main === store.scenes[0].gridData);
  check('normalizeScene hook runs with the scene', hooked === store.scenes[0]);
  eq('scene save writes the grid', store.scenes[0].gridData, { 2: { type: 'keyPressed' } });
  check('unknown scene save returns false and writes nothing',
    M.saveGridToScope(store, 99, live) === false);
  check('null cellData clears the target and still returns true',
    M.saveGridToScope(store, 'global', null) === true && JSON.stringify(store.globalGridData) === '{}');
  check('plain-object cellData saves the same way',
    M.saveGridToScope(store, 'global', { 3: { type: 'and' } }) === true &&
    JSON.stringify(store.globalGridData) === JSON.stringify({ 3: { type: 'and' } }));
  let threw = false;
  try {
    M.saveGridToScope(store, 1, new Map(), () => { throw new Error('boom'); });
  } catch (e) { threw = true; }
  check('a throwing normalizeScene hook never breaks the save', !threw);
  check('hostile store does not throw', M.saveGridToScope(null, 'global', live) === true);
}

// --- function scopes (P5 core-engine track, item P5-3 slice a) ---
{
  const store = {
    scenes: [{ id: 1, gridData: { 0: { type: 'gameStart' } } }],
    globalGridData: { 9: { type: 'stale' } },
    functions: [
      { id: 'fn_add', name: 'add', params: ['a'], grid: { 0: { type: 'always' } } },
      { id: 'fn_mul', name: 'mul', params: [] }
    ]
  };
  check('normalizeScriptScope passes a function scope through and repairs a bad id to global',
    M.normalizeScriptScope('function:fn_add') === 'function:fn_add' &&
    M.normalizeScriptScope('function:') === 'global' &&
    M.normalizeScriptScope('function:a:b') === 'global');
  check('functionIdOfScope reads the id from a function scope only',
    M.functionIdOfScope('function:fn_add') === 'fn_add' &&
    M.functionIdOfScope('global') === null && M.functionIdOfScope(1) === null);
  check('findFunction reads a definition by id',
    M.findFunction(store, 'fn_add') === store.functions[0] &&
    M.findFunction(store, 'fn_nope') === null);
  check('getGridDataForScope returns a function body grid by reference',
    M.getGridDataForScope(store, 'function:fn_add') === store.functions[0].grid);
  check('getGridDataForScope creates the grid when a function has none',
    (() => {
      const g = M.getGridDataForScope(store, 'function:fn_mul');
      return JSON.stringify(g) === '{}' && store.functions[1].grid === g;
    })());
  check('getGridDataForScope returns an unstored {} for an unknown function id',
    (() => {
      const g1 = M.getGridDataForScope(store, 'function:fn_nope');
      const g2 = M.getGridDataForScope(store, 'function:fn_nope');
      return JSON.stringify(g1) === '{}' && g1 !== g2;
    })());
  const live = new Map([[60, { type: 'setVariable' }]]);
  check('function save returns true and writes the body grid',
    M.saveGridToScope(store, 'function:fn_add', live) === true &&
    JSON.stringify(store.functions[0].grid) === JSON.stringify({ 60: { type: 'setVariable' } }));
  check('function save for an unknown function returns false and writes nothing',
    M.saveGridToScope(store, 'function:fn_nope', live) === false);
  check('a global save still works with functions in the store',
    M.saveGridToScope(store, 'global', new Map([[0, { type: 'gameStart' }]])) === true &&
    JSON.stringify(store.globalGridData) === JSON.stringify({ 0: { type: 'gameStart' } }));
  check('getScopeKey returns the function scope key unchanged',
    M.getScopeKey('function:fn_add') === 'function:fn_add');
}

// --- loadGridEntries ---
{
  const source = { 0: { type: 'gameStart' }, 5: { type: 'and' }, abc: { type: 'junk' }, 9999: { type: 'far' } };
  const entries = M.loadGridEntries(source);
  eq('loadGridEntries parses integer keys in order', entries.map(e => e.index), [0, 5, 9999]);
  eq('loadGridEntries keeps out-of-range indexes (legacy load behavior)',
    entries.find(e => e.index === 9999).data, { type: 'far' });
  source[0].type = 'mutated';
  check('loaded entries are clones', entries[0].data.type === 'gameStart');
  check('loadGridEntries hostile input yields []',
    JSON.stringify(M.loadGridEntries(null)) === '[]' && JSON.stringify(M.loadGridEntries('nope')) === '[]');
}

// --- gridDataFromMap / placeBlock / clearBlock ---
{
  const map = new Map([[0, { type: 'gameStart' }], [61, { type: 'and' }]]);
  eq('gridDataFromMap serializes a Map with cloned values', M.gridDataFromMap(map), { 0: { type: 'gameStart' }, 61: { type: 'and' } });
  const serialized = M.gridDataFromMap(map);
  map.get(0).type = 'mutated';
  eq('gridDataFromMap clones (source edits do not leak into the serialized copy)', serialized, { 0: { type: 'gameStart' }, 61: { type: 'and' } });
  check('gridDataFromMap accepts a plain object', JSON.stringify(M.gridDataFromMap({ 2: { type: 'and' } })) === JSON.stringify({ 2: { type: 'and' } }));
  check('gridDataFromMap drops non-integer keys', JSON.stringify(M.gridDataFromMap({ junk: { type: 'and' } })) === '{}');
  check('gridDataFromMap hostile input yields {}', JSON.stringify(M.gridDataFromMap(null)) === '{}');
  const live = new Map();
  const placed = { type: 'gameStart', reversed: false };
  check('placeBlock stores a clone and returns true', M.placeBlock(live, 7, placed) === true);
  placed.reversed = true;
  check('placed record is a clone', live.get(7).reversed === false);
  check('placeBlock rejects invalid indexes and bad maps',
    M.placeBlock(live, -1, placed) === false && M.placeBlock(live, 3600, placed) === false &&
    M.placeBlock(live, '7', placed) === false && M.placeBlock(null, 7, placed) === false);
  check('clearBlock removes and reports', M.clearBlock(live, 7) === true && !live.has(7));
  check('clearBlock reports a miss', M.clearBlock(live, 7) === false);
  check('clearBlock rejects invalid indexes', M.clearBlock(live, -1) === false);
}

// --- blockClassForType ---
{
  eq('blockClassForType legacy map spot checks',
    [M.blockClassForType('keyPressed'), M.blockClassForType('gameStart'),
     M.blockClassForType('overlapTouch'), M.blockClassForType('switchScene'),
     M.blockClassForType('tweenProperty'), M.blockClassForType('saveSlotExists')],
    ['condition', 'game-start', 'overlap-condition', 'switch-scene', 'tween-property', 'save-slot-exists-condition']);
  check('blockClassForType falls back to the catalog by runtimeType',
    M.blockClassForType('myBlock', [{ runtimeType: 'myBlock', blockType: 'my-block' }]) === 'my-block');
  check('blockClassForType returns null for unknown types and hostile input',
    M.blockClassForType('nope') === null && M.blockClassForType(null) === null &&
    M.blockClassForType('') === null && M.blockClassForType('myBlock', null) === null);
  check('legacy map wins over the catalog for core types',
    M.blockClassForType('keyPressed', [{ runtimeType: 'keyPressed', blockType: 'other' }]) === 'condition');
}

// --- buildBlockDefaults ---
{
  const catalog = { blockType: 'set-text', runtimeType: 'setText',
    defaults: { type: 'setText', targetObject: '', value: 'Hello!', useVariable: false, varName: '' } };
  const first = M.buildBlockDefaults('set-text', ['Hero', 'Coin'], catalog, 1);
  eq('catalog defaults fill the empty targetObject from the first name',
    first, { type: 'setText', targetObject: 'Hero', value: 'Hello!', useVariable: false, varName: '' });
  check('catalog defaults are cloned, never the catalog record itself',
    first !== catalog.defaults && M.buildBlockDefaults('set-text', ['Hero'], catalog, 1) !== first);
  catalog.defaults.targetObject = 'PreSet';
  eq('an already-filled object field is left alone',
    M.buildBlockDefaults('set-text', ['Hero', 'Coin'], catalog, 1).targetObject, 'PreSet');
  catalog.defaults.targetObject = '';
  const multi = M.buildBlockDefaults('x', ['Hero', 'Coin'],
    { defaults: { type: 'forceToward', targetObject: '', sourceObject: '', object1: '', object2: '', platformObject: '' } }, 1);
  eq('catalog object fields fill from first/second names',
    [multi.targetObject, multi.sourceObject, multi.object1, multi.object2, multi.platformObject],
    ['Hero', 'Coin', 'Hero', 'Coin', 'Coin']);
  const solo = M.buildBlockDefaults('x', ['Hero'],
    { defaults: { type: 'forceToward', targetObject: '', sourceObject: '', object1: '', object2: '' } }, 1);
  eq('with one name, second-object fields fall back to the first name',
    [solo.sourceObject, solo.object2], ['Hero', 'Hero']);
  check('a catalog entry without defaults falls through to the legacy table',
    M.buildBlockDefaults('condition', ['Hero'], { blockType: 'condition' }, 1).type === 'keyPressed');
  eq('legacy condition defaults', M.buildBlockDefaults('condition', ['Hero', 'Coin'], null, 1),
    { key: 'ArrowRight', type: 'keyPressed', inputCondition: 'keyPressed', trigger: 'down', reversed: false });
  eq('legacy game-start defaults', M.buildBlockDefaults('game-start', [], null, 1),
    { type: 'gameStart', reversed: false });
  eq('legacy switch-scene default uses the passed scene id',
    M.buildBlockDefaults('switch-scene', [], null, 7), { type: 'switchScene', sceneId: 7 });
  eq('legacy collision defaults use first/second names',
    M.buildBlockDefaults('advanced-condition', ['Hero', 'Coin'], null, 1),
    { type: 'collision', object1: 'Hero', object2: 'Coin', countTouchingEdges: true, reversed: false });
  eq('legacy defaults with no object names use empty strings',
    M.buildBlockDefaults('advanced-condition', [], null, 1).object1, '');
  check('unknown block type yields {}', JSON.stringify(M.buildBlockDefaults('nope', [], null, 1)) === '{}');
  check('hostile objectNames degrade to empty strings',
    M.buildBlockDefaults('advanced-condition', null, null, 1).object1 === '');
  const scoped = M.buildBlockDefaults('set-scoped-variable', ['Hero', 'Coin'],
    { defaults: { type: 'setScopedVariable', scope: 'global', targetObject: '', varName: '', value: 0 } }, 1);
  check('a scoped-variable block keeps a blank scope object when its scope is not Object',
    scoped.targetObject === '');
  const scopedObj = M.buildBlockDefaults('set-scoped-variable', ['Hero', 'Coin'],
    { defaults: { type: 'setScopedVariable', scope: 'object', targetObject: '', varName: '', value: 0 } }, 1);
  check('a scoped-variable block with Object scope fills the scope object from the first name',
    scopedObj.targetObject === 'Hero');
  const frozen = { defaults: { type: 'setText', targetObject: '', value: 'Hi' } };
  M.buildBlockDefaults('set-text', ['Hero'], frozen, 1);
  check('buildBlockDefaults never mutates its inputs',
    JSON.stringify(frozen.defaults) === JSON.stringify({ type: 'setText', targetObject: '', value: 'Hi' }));
}

// --- factorySource re-instantiates (export-inlining shape) ---
{
  const s2 = { window: null };
  s2.window = s2;
  vm.createContext(s2);
  vm.runInContext(`window.HydraGridModel=(${M.factorySource})();`, s2);
  check('factorySource re-instantiates a working module',
    s2.HydraGridModel.GRID_CELLS === 3600 && s2.HydraGridModel.moveIndex(61, 'ArrowRight') === 62);
}

// --- static wiring: script.js routes through the module ---
{
  const scriptJs = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'script.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'index.html'), 'utf8');
  const routed = ['HydraGridModel.normalizeScriptScope', 'HydraGridModel.saveGridToScope(',
    'HydraGridModel.getGridDataForScope(', 'HydraGridModel.loadGridEntries(',
    'HydraGridModel.blockClassForType(', 'HydraGridModel.buildBlockDefaults(',
    'HydraGridModel.moveIndex(', 'HydraGridModel.GRID_CELLS',
    'HydraGridModel.rowOf(', 'HydraGridModel.colOf('];
  routed.forEach((snippet) => check(`script.js routes through the module: ${snippet}`, scriptJs.includes(snippet)));
  check('script.js keeps no inline block-class map', !scriptJs.includes("keyPressed:    'condition',"));
  check('script.js keeps no inline legacy defaults table', !scriptJs.includes("'save-slot-exists-condition': { type: 'saveSlotExists'"));
  check('script.js keeps no 60x60 grid literal', !scriptJs.includes('for (let i = 0; i < 60 * 60; i++)'));
  check('script.js keeps no inline arrow-key grid math', !scriptJs.includes("case 'ArrowLeft':  if (col > 0)"));
  const gridTag = indexHtml.indexOf('hydra-gridmodel.js');
  const scriptTag = indexHtml.indexOf('"script.js');
  check('index.html loads hydra-gridmodel.js before script.js',
    gridTag !== -1 && scriptTag !== -1 && gridTag < scriptTag);
}

if (failures > 0) { console.log(`${failures} check(s) failed`); process.exit(1); }
console.log('grid model: all checks passed');
