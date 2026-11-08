// Unit tests for hydra/hydra-inventory.js — the shared inventory system
// (P4 Advanced batch 8: named items the player carries).
//
// Pure logic: item-table normalization (repairs, drops, dedupe,
// max-stack coercion), name/id lookups, the per-run backpack (add /
// remove / set / read / clear, has/count reads, max-stack clamping),
// and the action/condition routing sets. Nothing here touches the
// DOM; both runtimes delegate to this module. Static checks at the end
// pin the wiring: catalog blocks, editor tab + panel, both runtimes'
// dispatch, and the export inlining.

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
sandbox.window = sandbox; // hydra-inventory.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-inventory.js'), 'utf8'),
  sandbox, { filename: 'hydra-inventory.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-quest.js'), 'utf8'),
  sandbox, { filename: 'hydra-quest.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-achievement.js'), 'utf8'),
  sandbox, { filename: 'hydra-achievement.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-cutscene.js'), 'utf8'),
  sandbox, { filename: 'hydra-cutscene.js' });
const I = sandbox.HydraInventory;

check('HydraInventory exposed with helpers',
  !!I && typeof I.normalizeItems === 'function' && typeof I.itemNames === 'function' &&
  typeof I.getItem === 'function' && typeof I.createInventoryRuntime === 'function' &&
  typeof I.itemCount === 'function' && typeof I.hasItem === 'function' &&
  typeof I.addItem === 'function' && typeof I.removeItem === 'function' &&
  typeof I.setItemCount === 'function' && typeof I.readItemCount === 'function' &&
  typeof I.clearInventory === 'function' && typeof I.inventoryList === 'function' &&
  typeof I.isInventoryAction === 'function' && typeof I.isInventoryCondition === 'function');
check('factorySource is a self-contained function string',
  typeof I.factorySource === 'string' && I.factorySource.includes('hydraInventoryFactory'));
check('default max stack is 99, capped at 9999',
  I.DEFAULT_MAX_STACK === 99 && I.MAX_STACK_CAP === 9999);

function guardItems() {
  return [
    { id: 'itm_key', name: 'Brass key', maxStack: 1, description: 'Opens the cellar door.' },
    { id: 'itm_coin', name: 'Gold coin', maxStack: 99, description: 'Spend it at the shop.' },
    { id: 'itm_potion', name: 'Potion', maxStack: 5, description: 'Restores health.' }
  ];
}

function makeHooks() {
  const writes = [];
  return {
    writes,
    hooks: {
      warn: function (msg) { writes.push(['warn', msg]); }
    }
  };
}

// --- normalization ---
{
  check('null normalizes to an empty list', JSON.stringify(I.normalizeItems(null)) === '[]');
  check('a non-array normalizes to an empty list', JSON.stringify(I.normalizeItems({})) === '[]');
  const list = [
    { id: 'a', name: ' Brass key ', maxStack: 1, description: 7 },
    { name: 'Brass key', maxStack: 3, description: 'dup' },
    { name: '  ', maxStack: 5 },
    null, 'junk',
    { name: 'Gold coin', maxStack: 0 },
    { name: 'Potion', maxStack: 'five' },
    { name: 'Gem', maxStack: 2.7 },
    { name: 'Relic', maxStack: 50000 },
    { name: 'Feather', maxStack: -4 },
    { name: 'Second' }
  ];
  const norm = I.normalizeItems(list);
  check('normalization is in place (same array identity)', norm === list, 'identity changed');
  check('duplicate names collapse to the first, blank names drop, junk drops',
    JSON.stringify(I.itemNames(list)) === '["Brass key","Gold coin","Potion","Gem","Relic","Feather","Second"]',
    JSON.stringify(I.itemNames(list)));
  const key = I.getItem(list, 'Brass key');
  check('item names trim', key && key.name === 'Brass key');
  check('description coerces to a string', key.description === '7', JSON.stringify(key));
  check('max stack 0 / non-numeric / negative fall back to 99',
    I.getItem(list, 'Gold coin').maxStack === 99 &&
    I.getItem(list, 'Potion').maxStack === 99 &&
    I.getItem(list, 'Feather').maxStack === 99,
    JSON.stringify(list.map(i => [i.name, i.maxStack])));
  check('fractional max stacks floor', I.getItem(list, 'Gem').maxStack === 2);
  check('max stacks cap at 9999', I.getItem(list, 'Relic').maxStack === 9999);
  check('a missing max stack defaults to 99', I.getItem(list, 'Second').maxStack === 99);
  check('a missing id is minted', typeof I.getItem(list, 'Second').id === 'string' &&
    I.getItem(list, 'Second').id.length > 0);
}

// --- lookups ---
{
  const list = guardItems();
  check('getItem finds by name', I.getItem(list, 'Brass key') === list[0]);
  check('getItem finds by id', I.getItem(list, 'itm_coin') === list[1]);
  check('getItem trims the name', I.getItem(list, '  Gold coin  ') === list[1]);
  check('getItem returns null for blank names', I.getItem(list, '  ') === null);
  check('getItem returns null for unknown names', I.getItem(list, 'Nobody') === null);
  check('getItem returns null for a null table', I.getItem(null, 'Brass key') === null);
  check('itemNames returns a copy', (() => {
    const names = I.itemNames(list);
    names.push('bogus');
    return I.itemNames(list).length === 3;
  })());
}

// --- fresh runtime ---
{
  const rt = I.createInventoryRuntime();
  check('fresh runtime carries nothing',
    rt && typeof rt.counts === 'object' && Object.keys(rt.counts).length === 0);
  check('itemCount reads 0 on a fresh runtime', I.itemCount(rt, 'Gold coin') === 0);
  check('hasItem reads false on a fresh runtime', I.hasItem(rt, guardItems(), 'Gold coin', 1) === false);
  check('inventoryList reads [] on a fresh runtime', JSON.stringify(I.inventoryList(rt)) === '[]');
}

// --- add ---
{
  const rt = I.createInventoryRuntime();
  const h = makeHooks();
  check('add with a blank name stays quiet', I.addItem(rt, guardItems(), '  ', 1, h.hooks) === false && I.itemCount(rt, 'Gold coin') === 0);
  check('add with an unknown name warns and holds',
    I.addItem(rt, guardItems(), 'Nobody', 1, h.hooks) === false && I.itemCount(rt, 'Nobody') === 0 &&
    h.writes.some(w => w[0] === 'warn' && /no item named "Nobody"/.test(w[1])),
    JSON.stringify(h.writes));
  check('add with a bad count warns and holds',
    I.addItem(rt, guardItems(), 'Gold coin', 0, h.hooks) === false &&
    I.addItem(rt, guardItems(), 'Gold coin', -2, h.hooks) === false &&
    I.addItem(rt, guardItems(), 'Gold coin', 'lots', h.hooks) === false &&
    I.itemCount(rt, 'Gold coin') === 0,
    JSON.stringify(h.writes));
  check('add stores the count',
    I.addItem(rt, guardItems(), 'Gold coin', 5, h.hooks) === true && I.itemCount(rt, 'Gold coin') === 5);
  check('add accumulates',
    I.addItem(rt, guardItems(), 'Gold coin', 3, h.hooks) === true && I.itemCount(rt, 'Gold coin') === 8);
  check('add floors a fractional count',
    I.addItem(rt, guardItems(), 'Gold coin', 2.9, h.hooks) === true && I.itemCount(rt, 'Gold coin') === 10);
  check('add clamps at the max stack',
    I.addItem(rt, guardItems(), 'Potion', 99, h.hooks) === true && I.itemCount(rt, 'Potion') === 5);
  check('a max stack of 1 makes a unique item',
    I.addItem(rt, guardItems(), 'Brass key', 1, h.hooks) === true &&
    I.addItem(rt, guardItems(), 'Brass key', 1, h.hooks) === true &&
    I.itemCount(rt, 'Brass key') === 1);
}

// --- remove ---
{
  const rt = I.createInventoryRuntime();
  const h = makeHooks();
  I.addItem(rt, guardItems(), 'Gold coin', 5, h.hooks);
  check('remove with a blank name stays quiet', I.removeItem(rt, guardItems(), '  ', 1, h.hooks) === false && I.itemCount(rt, 'Gold coin') === 5);
  check('remove with an unknown name warns and holds',
    I.removeItem(rt, guardItems(), 'Nobody', 1, h.hooks) === false &&
    h.writes.some(w => w[0] === 'warn' && /no item named "Nobody"/.test(w[1])),
    JSON.stringify(h.writes));
  check('remove with a bad count warns and holds',
    I.removeItem(rt, guardItems(), 'Gold coin', 0, h.hooks) === false && I.itemCount(rt, 'Gold coin') === 5);
  check('remove takes the count',
    I.removeItem(rt, guardItems(), 'Gold coin', 2, h.hooks) === true && I.itemCount(rt, 'Gold coin') === 3);
  check('removing more than carried takes what is there and drops the entry',
    I.removeItem(rt, guardItems(), 'Gold coin', 99, h.hooks) === true &&
    I.itemCount(rt, 'Gold coin') === 0 && !('Gold coin' in rt.counts));
  check('removing from an empty backpack stays quiet',
    I.removeItem(rt, guardItems(), 'Potion', 1, h.hooks) === true && I.itemCount(rt, 'Potion') === 0);
}

// --- set ---
{
  const rt = I.createInventoryRuntime();
  const h = makeHooks();
  check('set with a blank name stays quiet', I.setItemCount(rt, guardItems(), '  ', 3, h.hooks) === false);
  check('set with an unknown name warns and holds',
    I.setItemCount(rt, guardItems(), 'Nobody', 3, h.hooks) === false &&
    h.writes.some(w => w[0] === 'warn' && /no item named "Nobody"/.test(w[1])),
    JSON.stringify(h.writes));
  check('set with a non-numeric count warns and holds',
    I.setItemCount(rt, guardItems(), 'Gold coin', 'lots', h.hooks) === false && I.itemCount(rt, 'Gold coin') === 0);
  check('set writes the count outright',
    I.setItemCount(rt, guardItems(), 'Gold coin', 7, h.hooks) === true && I.itemCount(rt, 'Gold coin') === 7);
  check('set clamps at the max stack',
    I.setItemCount(rt, guardItems(), 'Potion', 99, h.hooks) === true && I.itemCount(rt, 'Potion') === 5);
  check('set floors a fractional count',
    I.setItemCount(rt, guardItems(), 'Gold coin', 4.8, h.hooks) === true && I.itemCount(rt, 'Gold coin') === 4);
  check('set to 0 drops the entry',
    I.setItemCount(rt, guardItems(), 'Gold coin', 0, h.hooks) === true &&
    I.itemCount(rt, 'Gold coin') === 0 && !('Gold coin' in rt.counts));
  check('set to a negative count clamps to 0 and drops the entry',
    I.setItemCount(rt, guardItems(), 'Potion', -3, h.hooks) === true && I.itemCount(rt, 'Potion') === 0);
}

// --- read / has / list ---
{
  const rt = I.createInventoryRuntime();
  const h = makeHooks();
  I.addItem(rt, guardItems(), 'Gold coin', 5, h.hooks);
  I.addItem(rt, guardItems(), 'Brass key', 1, h.hooks);
  check('read returns the carried count', I.readItemCount(rt, guardItems(), 'Gold coin', h.hooks) === 5);
  check('read returns 0 for a defined item with nothing carried',
    I.readItemCount(rt, guardItems(), 'Potion', h.hooks) === 0);
  check('read returns null for a blank name', I.readItemCount(rt, guardItems(), '  ', h.hooks) === null);
  check('read warns and returns null for an unknown item',
    I.readItemCount(rt, guardItems(), 'Nobody', h.hooks) === null &&
    h.writes.some(w => w[0] === 'warn' && /no item named "Nobody"/.test(w[1])),
    JSON.stringify(h.writes));
  check('hasItem passes at the carried count and fails above it',
    I.hasItem(rt, guardItems(), 'Gold coin', 5) === true &&
    I.hasItem(rt, guardItems(), 'Gold coin', 6) === false);
  check('hasItem defaults to needing 1',
    I.hasItem(rt, guardItems(), 'Gold coin') === true && I.hasItem(rt, guardItems(), 'Potion') === false);
  check('hasItem with a bad count needs 1',
    I.hasItem(rt, guardItems(), 'Gold coin', 0) === true &&
    I.hasItem(rt, guardItems(), 'Gold coin', 'lots') === true);
  check('hasItem reads false for an unknown item',
    I.hasItem(rt, guardItems(), 'Nobody', 1) === false);
  check('itemCount reads the carried count, 0 when absent',
    I.itemCount(rt, 'Gold coin') === 5 && I.itemCount(rt, 'Potion') === 0 &&
    I.itemCount(rt, '  ') === 0 && I.itemCount(null, 'Gold coin') === 0);
  check('inventoryList lists carried items sorted by name',
    JSON.stringify(I.inventoryList(rt)) === '[{"name":"Brass key","count":1},{"name":"Gold coin","count":5}]',
    JSON.stringify(I.inventoryList(rt)));
}

// --- clear ---
{
  const rt = I.createInventoryRuntime();
  const h = makeHooks();
  I.addItem(rt, guardItems(), 'Gold coin', 5, h.hooks);
  I.addItem(rt, guardItems(), 'Potion', 2, h.hooks);
  check('clear empties the whole backpack',
    I.clearInventory(rt) === true && Object.keys(rt.counts).length === 0 &&
    I.itemCount(rt, 'Gold coin') === 0 && JSON.stringify(I.inventoryList(rt)) === '[]');
  check('clear on a null runtime stays quiet', I.clearInventory(null) === false);
}

// --- routing sets ---
{
  check('isInventoryAction matches the five action blocks',
    I.isInventoryAction('addItem') && I.isInventoryAction('removeItem') &&
    I.isInventoryAction('setItemCount') && I.isInventoryAction('readItemCount') &&
    I.isInventoryAction('clearInventory') && !I.isInventoryAction('startDialogue') &&
    !I.isInventoryAction('hasItem'));
  check('isInventoryCondition matches the two condition blocks',
    I.isInventoryCondition('hasItem') && I.isInventoryCondition('itemCount') &&
    !I.isInventoryCondition('dialogueActive') && !I.isInventoryCondition('addItem'));
}

// --- hostile input ---
{
  const h = makeHooks();
  check('add on a null runtime stays quiet', I.addItem(null, guardItems(), 'Gold coin', 1, h.hooks) === false);
  check('remove on a null runtime stays quiet', I.removeItem(null, guardItems(), 'Gold coin', 1, h.hooks) === false);
  check('set on a null runtime stays quiet', I.setItemCount(null, guardItems(), 'Gold coin', 1, h.hooks) === false);
  check('read on a null runtime returns null', I.readItemCount(null, guardItems(), 'Gold coin', h.hooks) === null);
  check('hasItem on a null runtime reads false', I.hasItem(null, guardItems(), 'Gold coin', 1) === false);
  check('itemCount on a null runtime reads 0', I.itemCount(null, 'Gold coin') === 0);
  check('a throwing warn hook never breaks the add', (() => {
    const rt = I.createInventoryRuntime();
    const bad = { warn: function () { throw new Error('boom'); } };
    return I.addItem(rt, guardItems(), 'Nobody', 1, bad) === false && I.itemCount(rt, 'Gold coin') === 0;
  })());
  check('a hostile item table degrades to no item', (() => {
    const rt = I.createInventoryRuntime();
    return I.addItem(rt, 'not a table', 'Gold coin', 1, h.hooks) === false && rt.counts && Object.keys(rt.counts).length === 0;
  })());
  check('itemCount on a frozen runtime reads without throwing', (() => {
    const rt = I.createInventoryRuntime();
    I.addItem(rt, guardItems(), 'Gold coin', 3, h.hooks);
    Object.freeze(rt);
    return I.itemCount(rt, 'Gold coin') === 3;
  })());
  check('counts with corrupt values read as 0', (() => {
    const rt = { counts: { 'Gold coin': 'lots', 'Potion': -4, 'Gem': NaN } };
    return I.itemCount(rt, 'Gold coin') === 0 && I.itemCount(rt, 'Potion') === 0 && I.itemCount(rt, 'Gem') === 0;
  })());
}

// --- static wiring ---
{
  const html = fs.readFileSync(path.join(HYDRA, 'index.html'), 'utf8');
  const scriptJs = fs.readFileSync(path.join(HYDRA, 'script.js'), 'utf8');
  const playerJs = fs.readFileSync(path.join(HYDRA, 'player-runtime.js'), 'utf8');
  const previewJs = fs.readFileSync(path.join(HYDRA, 'hydra-previewruntime.js'), 'utf8');
  const universalJs = fs.readFileSync(path.join(HYDRA, 'hydra-universal.js'), 'utf8');
  const conditionsJs = fs.readFileSync(path.join(HYDRA, 'hydra-conditions.js'), 'utf8');
  const executeJs = fs.readFileSync(path.join(HYDRA, 'hydra-execute.js'), 'utf8');
  const flowJs = fs.readFileSync(path.join(HYDRA, 'hydra-flow.js'), 'utf8');

  const invTag = html.indexOf('src="hydra-inventory.js');
  check('index.html loads hydra-inventory.js before player-runtime.js and script.js',
    invTag !== -1 && invTag < html.indexOf('src="player-runtime.js') && invTag < html.indexOf('src="script.js'));
  check('index.html has an Items inspector tab',
    html.includes('data-inspector-tab="items"') && html.includes('data-inspector-panel="items"'));
  check('index.html has the Items panel + add button',
    html.includes('id="items-panel"') && html.includes('id="items-add-btn"'));
  check('script.js exposes the Items tab panel + init + rename propagation',
    scriptJs.includes('function renderItemsPanel') && scriptJs.includes('function initItemsPanel') &&
    scriptJs.includes('function propagateItemRename') && scriptJs.includes('function getMutableItems') &&
    scriptJs.includes('initItemsPanel()'));
  check('script.js hands the project item table to the preview runtime',
    scriptJs.includes('function getProjectItems') && scriptJs.includes('getProjectItems,'));
  check('player-runtime.js hard-guards on HydraInventory',
    playerJs.includes("requires hydra-inventory.js (window.HydraInventory)"));
  check('player-runtime.js inlines HydraInventory into exports',
    playerJs.includes("'HydraInventory', global.HydraInventory && global.HydraInventory.factorySource"));
  check('player-runtime.js creates the per-run backpack + table',
    playerJs.includes('inventory: HydraInventory.createInventoryRuntime()') &&
    playerJs.includes('items: HydraInventory.normalizeItems(project.items)'));
  check('player-runtime.js routes inventory blocks through the shared modules',
    playerJs.includes('HydraInventory.isInventoryCondition(type)') &&
    playerJs.includes('HydraInventory.isInventoryAction(type)') &&
    playerJs.includes('inventory: state.inventory') && playerJs.includes('inventoryModule: HydraInventory'));
  check('preview runtime holds the inventory runtime + fresh-run reset',
    previewJs.includes('function inventoryRuntime') && previewJs.includes('function resetInventoryRuntime') &&
    previewJs.includes('resetInventoryRuntime();'));
  check('preview runtime contexts carry the inventory state',
    previewJs.includes('inventory: inventoryRuntime()') && previewJs.includes("items: hostCall('getProjectItems'"));
  check('preview runtime does NOT reset the backpack on scene load',
    !previewJs.includes('resetInventory: function'));
  check('hydra-universal.js defaults project.items to []',
    universalJs.includes('if (!Array.isArray(project.items)) project.items = [];'));
  check('shared conditions module evaluates the two inventory conditions',
    conditionsJs.includes("case 'hasItem'") && conditionsJs.includes("case 'itemCount'"));
  check('shared execute module runs the five inventory actions',
    executeJs.includes("isType(ctx.inventoryModule, 'isInventoryAction', type)") &&
    executeJs.includes("type === 'addItem'") && executeJs.includes("type === 'clearInventory'"));
  check('flow module defaults the inventory conditions to level triggers',
    flowJs.includes("t === 'hasItem'") && flowJs.includes("t === 'itemCount'"));

  // Catalog: seven Inventory blocks, schema-clean.
  const catSb = {}; catSb.window = catSb; vm.createContext(catSb);
  vm.runInContext(fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8'), catSb,
    { filename: 'block-catalog.js' });
  const catalog = catSb.HydraBlockCatalog;
  const invBlocks = catalog.blocks.filter(b => b.category === 'Inventory');
  check('catalog carries seven Inventory blocks',
    invBlocks.length === 7, invBlocks.map(b => b.label).join(', '));
  const labels = invBlocks.map(b => b.label).sort();
  check('Inventory blocks are the five actions + two conditions',
    JSON.stringify(labels) === JSON.stringify(['Add Item', 'Clear Inventory', 'Has Item', 'Item Count', 'Read Item Count', 'Remove Item', 'Set Item Count'].sort()),
    labels.join(', '));
  const findings = catalog.validateCatalog();
  check('catalog validates clean with the Inventory blocks', findings.length === 0,
    JSON.stringify(findings.slice(0, 3)));
  const ref = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');
  check('every Inventory block is documented in the block reference',
    invBlocks.every(b => ref.includes(b.label)), invBlocks.filter(b => !ref.includes(b.label)).map(b => b.label).join(', '));
  const guide = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');
  check('user guide has an Inventory section', guide.includes('## Inventory'));
}

process.exit(failures === 0 ? 0 : 1);
