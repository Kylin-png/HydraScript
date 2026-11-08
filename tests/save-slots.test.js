// Unit tests for hydra/hydra-save.js — the shared save-slot module.
//
// Pure logic: slot-name normalization, versioned records, write/read/delete,
// slotExists, listSlots, and corrupt-data safety. Nothing here touches the
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
sandbox.window = sandbox; // hydra-save.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-save.js'), 'utf8'),
  sandbox, { filename: 'hydra-save.js' });
const S = sandbox.HydraSave;

check('HydraSave exposed with helpers',
  !!S && typeof S.writeSlot === 'function' && typeof S.readSlot === 'function' &&
  typeof S.deleteSlot === 'function' && typeof S.slotExists === 'function' &&
  typeof S.listSlots === 'function' && typeof S.normalizeSlotName === 'function' &&
  typeof S.slotKey === 'function' && typeof S.sanitizeVariables === 'function');
check('factorySource is a self-contained function string',
  typeof S.factorySource === 'string' && S.factorySource.includes('hydraSlot:'));

// --- slot-name normalization ---
check('normalizeSlotName trims', S.normalizeSlotName('  My Save ') === 'My Save');
check('normalizeSlotName blanks fall back to default',
  S.normalizeSlotName('') === 'Slot 1' && S.normalizeSlotName('   ') === 'Slot 1' &&
  S.normalizeSlotName(null) === 'Slot 1' && S.normalizeSlotName(undefined) === 'Slot 1' &&
  S.normalizeSlotName(42) === '42');
check('slotKey prefixes and normalizes', S.slotKey('Slot 2') === 'hydraSlot:Slot 2' &&
  S.slotKey('') === 'hydraSlot:Slot 1');

// --- a fake storage backend ---
function makeStorage(initial) {
  const map = Object.assign({}, initial);
  return {
    getItem: k => (k in map ? map[k] : null),
    setItem: (k, v) => { map[k] = String(v); },
    removeItem: k => { delete map[k]; },
    key: i => Object.keys(map)[i] || null,
    get length() { return Object.keys(map).length; },
    _map: map
  };
}
const badStorage = {
  getItem() { throw new Error('denied'); },
  setItem() { throw new Error('denied'); },
  removeItem() { throw new Error('denied'); },
  key() { throw new Error('denied'); },
  get length() { throw new Error('denied'); }
};

// --- write / read round trip ---
const st = makeStorage();
check('writeSlot succeeds', S.writeSlot(st, 'Slot 1', { score: 120, levelUnlocked: 3, lives: 2 }) === true);
const slot = S.readSlot(st, 'Slot 1');
check('readSlot returns a versioned record',
  !!slot && slot.version === S.SLOT_VERSION && typeof slot.savedAt === 'number' &&
  slot.data.score === 120 && slot.data.levelUnlocked === 3 && slot.data.lives === 2);
check('slotExists true for written slot', S.slotExists(st, 'Slot 1') === true);
check('slotExists false for missing slot', S.slotExists(st, 'Slot 9') === false);

// --- names with spaces survive ---
check('write/read with a long name', (() => {
  const okW = S.writeSlot(st, '  My Epic Run  ', { x: 1 });
  const r = S.readSlot(st, 'My Epic Run');
  return okW && r && r.data.x === 1 && S.slotExists(st, '  My Epic Run  ');
})());

// --- corrupt data never crashes ---
check('readSlot null for bad JSON',
  S.readSlot(makeStorage({ 'hydraSlot:X': '{not json' }), 'X') === null);
check('readSlot null for non-object record',
  S.readSlot(makeStorage({ 'hydraSlot:X': '42' }), 'X') === null);
check('readSlot null for missing data field',
  S.readSlot(makeStorage({ 'hydraSlot:X': JSON.stringify({ version: 1 }) }), 'X') === null);
check('slotExists false for corrupt slot',
  S.slotExists(makeStorage({ 'hydraSlot:X': '{oops' }), 'X') === false);
check('load of corrupt slot is a safe no-op (null)', (() => {
  const bad = makeStorage({ 'hydraSlot:X': '{oops' });
  return S.readSlot(bad, 'X') === null;
})());

// --- delete ---
check('deleteSlot removes the slot', (() => {
  const d = makeStorage();
  S.writeSlot(d, 'Slot 1', { a: 1 });
  return S.deleteSlot(d, 'Slot 1') === true && !S.slotExists(d, 'Slot 1');
})());
check('deleteSlot on missing slot is idempotent', S.deleteSlot(makeStorage(), 'Slot 1') === true);

// --- sanitizeVariables ---
check('sanitizeVariables drops functions and keeps JSON-safe values', (() => {
  const clean = S.sanitizeVariables({ n: 1, s: 'hi', nested: { b: true }, fn: function () {} });
  return clean.n === 1 && clean.s === 'hi' && clean.nested.b === true && !('fn' in clean);
})());
check('sanitizeVariables handles circular refs', (() => {
  const c = { a: 1 }; c.self = c;
  const clean = S.sanitizeVariables(c);
  return clean && typeof clean === 'object';
})());
check('sanitizeVariables non-object input gives {}', JSON.stringify(S.sanitizeVariables(null)) === '{}' &&
  JSON.stringify(S.sanitizeVariables(7)) === '{}');

// --- failing storage never throws ---
check('writeSlot false on failing storage', S.writeSlot(badStorage, 'Slot 1', { a: 1 }) === false);
check('readSlot null on failing storage', S.readSlot(badStorage, 'Slot 1') === null);
check('slotExists false on failing storage', S.slotExists(badStorage, 'Slot 1') === false);
check('deleteSlot false on failing storage', S.deleteSlot(badStorage, 'Slot 1') === false);
check('listSlots empty on failing storage', Array.isArray(S.listSlots(badStorage)) &&
  S.listSlots(badStorage).length === 0);

// --- listSlots ---
check('listSlots finds only valid slots', (() => {
  const l = makeStorage({
    'hydraSlot:A': JSON.stringify({ version: 1, savedAt: 5, data: { x: 1 } }),
    'hydraSlot:B': JSON.stringify({ version: 1, savedAt: 6, data: {} }),
    'hydraSlot:Bad': '{broken',
    'hydraSave:bestScore': '99',
    'other': 'nope'
  });
  const list = S.listSlots(l);
  return list.length === 2 && list[0].name === 'A' && list[1].name === 'B' &&
    list[0].version === 1 && typeof list[0].savedAt === 'number';
})());
check('listSlots on empty storage', S.listSlots(makeStorage()).length === 0);

// --- safeStorage: localStorage itself may be unreadable ---
check('safeStorage exposed', typeof S.safeStorage === 'function');
check('safeStorage returns null when no localStorage exists in scope', S.safeStorage() === null);
(function () {
  // Simulate a scope where reading localStorage throws (opaque origin).
  const throwingScope = {};
  Object.defineProperty(throwingScope, 'localStorage', {
    get() { throw new Error('Access is denied'); }, configurable: true
  });
  vm.createContext(throwingScope);
  const src = '(' + S.safeStorage.toString() + ')()';
  let result = 'threw';
  try { result = vm.runInContext(src, throwingScope); } catch (e) { result = 'threw'; }
  check('safeStorage returns null when localStorage access throws', result === null, String(result));
})();
check('slot ops degrade to safe no-ops on null storage',
  S.writeSlot(null, 'Slot 1', { a: 1 }) === false &&
  S.readSlot(null, 'Slot 1') === null &&
  S.slotExists(null, 'Slot 1') === false &&
  S.deleteSlot(null, 'Slot 1') === false &&
  S.listSlots(null).length === 0);

process.exit(failures === 0 ? 0 : 1);
