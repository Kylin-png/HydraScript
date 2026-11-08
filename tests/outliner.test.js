// Unit tests for the P5-8 slice b outliner + details polish — the
// Hierarchy tab as a real outliner: collapsible layer groups, eye
// (hide) and lock toggles per row, inline rename, keyboard
// navigation, and the Inspector's details summary + Visible /
// Locked checkboxes mirroring the row toggles.
//
// Covers the three layers: the pure helpers in hydra-outliner.js
// (grouping, search, collapsed-layer storage, flags, rename,
// selection movement, labels), the shared scene-reset seed that
// makes a hidden object start the run hidden (pinned in
// tests/scenereset.test.js and export-boot Phase CS), and the
// markup + styles + script.js wiring pins.

const fs = require('fs');
const path = require('path');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}
function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected),
    `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

const INDEX_HTML = fs.readFileSync(
  path.join(__dirname, '..', 'hydra', 'index.html'), 'utf8');
const STYLE_CSS = fs.readFileSync(
  path.join(__dirname, '..', 'hydra', 'style.css'), 'utf8');
const SCRIPT_JS = fs.readFileSync(
  path.join(__dirname, '..', 'hydra', 'script.js'), 'utf8');
const MODULE_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'hydra', 'hydra-outliner.js'), 'utf8');
const STAGE_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'hydra', 'hydra-stage.js'), 'utf8');
const RESET_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'hydra', 'hydra-scenereset.js'), 'utf8');
const GUIDE = fs.readFileSync(
  path.join(__dirname, '..', 'docs', 'user-guide.md'), 'utf8');
const factory = require(path.join(__dirname, '..', 'hydra', 'hydra-outliner.js'));
const M = factory();

function obj(id, name, layer, extra) {
  return Object.assign({ id: id, name: name, kind: 'sprite', archetype: 'sprite',
    layer: layer, posX: 10, posY: 20, components: [], tags: [] }, extra || {});
}

// --- constants ------------------------------------------------------------
check('storage key is versioned', M.STORAGE_KEY === 'hydra.outlinerLayers.v1');

// --- groupByLayer ---------------------------------------------------------
eq('groupByLayer sorts groups highest layer first',
  M.groupByLayer([obj(1, 'a', 0), obj(2, 'b', 2), obj(3, 'c', 1), obj(4, 'd', 2)])
    .map(g => g.layer), [2, 1, 0]);
eq('groupByLayer keeps scene order inside a group',
  M.groupByLayer([obj(1, 'a', 0), obj(2, 'b', 2), obj(3, 'c', 1), obj(4, 'd', 2)])
    .map(g => g.objects.map(o => o.id)), [[2, 4], [3], [1]]);
eq('groupByLayer reads a missing layer as 0',
  M.groupByLayer([{ id: 1, name: 'a' }, obj(2, 'b', 1)]).map(g => g.layer), [1, 0]);
eq('groupByLayer skips non-objects', M.groupByLayer([null, obj(1, 'a', 0), 'x']).length, 1);
eq('groupByLayer degrades a non-array to no groups', M.groupByLayer(null), []);
eq('groupByLayer of an empty list is empty', M.groupByLayer([]), []);

// --- filterObjects --------------------------------------------------------
{
  const list = [
    obj(1, 'hero', 0, { tags: ['player'] }),
    obj(2, 'goblin', 1, { components: [{ type: 'Health' }] }),
    obj(3, 'Coin', 0, { archetype: 'coin' })
  ];
  eq('filterObjects passes everything on a blank query',
    M.filterObjects(list, '   ').map(o => o.id), [1, 2, 3]);
  eq('filterObjects matches by name, case-insensitive',
    M.filterObjects(list, 'HERO').map(o => o.id), [1]);
  eq('filterObjects matches by tag', M.filterObjects(list, 'player').map(o => o.id), [1]);
  eq('filterObjects matches by component type',
    M.filterObjects(list, 'health').map(o => o.id), [2]);
  eq('filterObjects matches by archetype', M.filterObjects(list, 'coin').map(o => o.id), [3]);
  eq('filterObjects matches by layer word', M.filterObjects(list, 'sprite').map(o => o.id), [1, 2, 3]);
  eq('filterObjects finds nothing for a miss', M.filterObjects(list, 'zzz'), []);
  eq('filterObjects degrades a non-array to empty', M.filterObjects(null, 'hero'), []);
  eq('filterObjects degrades a non-string query to pass-through',
    M.filterObjects(list, null).map(o => o.id), [1, 2, 3]);
}

// --- parseStoredCollapsed / serializeCollapsed ----------------------------
eq('parseStoredCollapsed accepts a valid map',
  M.parseStoredCollapsed('{"2":true,"0":true}'), { 2: true, 0: true });
eq('parseStoredCollapsed drops a false entry',
  M.parseStoredCollapsed('{"2":true,"1":false}'), { 2: true });
eq('parseStoredCollapsed drops a non-boolean entry',
  M.parseStoredCollapsed('{"2":"yes"}'), {});
eq('parseStoredCollapsed drops a non-numeric key',
  M.parseStoredCollapsed('{"top":true,"2":true}'), { 2: true });
eq('parseStoredCollapsed degrades garbage JSON to empty',
  M.parseStoredCollapsed('not json{{'), {});
eq('parseStoredCollapsed degrades an empty string to empty',
  M.parseStoredCollapsed(''), {});
eq('parseStoredCollapsed degrades a JSON array to empty',
  M.parseStoredCollapsed('[2]'), {});
eq('parseStoredCollapsed degrades a JSON null to empty',
  M.parseStoredCollapsed('null'), {});
eq('parseStoredCollapsed degrades a non-string to empty',
  M.parseStoredCollapsed(null), {});
eq('serializeCollapsed round-trips through parseStoredCollapsed',
  M.parseStoredCollapsed(M.serializeCollapsed({ 2: true, 0: true })), { 2: true, 0: true });
eq('serializeCollapsed normalizes keys and drops false entries',
  M.parseStoredCollapsed(M.serializeCollapsed({ '02': true, 1: false })), { 2: true });
eq('serializeCollapsed degrades a null input to an empty map',
  M.parseStoredCollapsed(M.serializeCollapsed(null)), {});
eq('serializeCollapsed degrades an array input to an empty map',
  M.parseStoredCollapsed(M.serializeCollapsed([2])), {});

// --- storage helpers ------------------------------------------------------
{
  const store = {};
  const storage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; }
  };
  eq('readStoredCollapsed returns empty with empty storage',
    M.readStoredCollapsed(storage), {});
  check('writeStoredCollapsed stores JSON under the versioned key',
    M.writeStoredCollapsed(storage, { 2: true }) === true &&
    store['hydra.outlinerLayers.v1'] === '{"2":true}',
    store['hydra.outlinerLayers.v1']);
  eq('readStoredCollapsed reads back what was written',
    M.readStoredCollapsed(storage), { 2: true });
  eq('readStoredCollapsed degrades a missing storage object to empty',
    M.readStoredCollapsed(null), {});
  const throwing = {
    getItem: () => { throw new Error('denied'); },
    setItem: () => { throw new Error('denied'); }
  };
  eq('readStoredCollapsed degrades a throwing storage to empty',
    M.readStoredCollapsed(throwing), {});
  check('writeStoredCollapsed reports false on a throwing storage',
    M.writeStoredCollapsed(throwing, { 2: true }) === false);
}

// --- toggleCollapsed / isCollapsed ----------------------------------------
eq('toggleCollapsed collapses an expanded layer',
  M.toggleCollapsed({}, 2), { 2: true });
eq('toggleCollapsed expands a collapsed layer',
  M.toggleCollapsed({ 2: true, 0: true }, 2), { 0: true });
eq('toggleCollapsed returns a new map (the old one is untouched)',
  (() => { const before = { 0: true }; const after = M.toggleCollapsed(before, 2);
    return before; })(), { 0: true });
eq('toggleCollapsed reads a bad layer as 0',
  M.toggleCollapsed({}, 'top'), { 0: true });
check('isCollapsed reads a collapsed layer as true',
  M.isCollapsed({ 2: true }, 2) === true);
check('isCollapsed reads an expanded layer as false',
  M.isCollapsed({ 2: true }, 1) === false);
check('isCollapsed reads a missing map as false',
  M.isCollapsed(null, 2) === false);

// --- hidden / locked flags ------------------------------------------------
check('isHidden reads hidden === true', M.isHidden(obj(1, 'a', 0, { hidden: true })) === true);
check('isHidden reads a missing flag as visible',
  M.isHidden(obj(1, 'a', 0)) === false);
check('isHidden reads a non-true flag as visible',
  M.isHidden(obj(1, 'a', 0, { hidden: 'yes' })) === false);
check('isHidden reads null as visible', M.isHidden(null) === false);
check('isLocked reads locked === true', M.isLocked(obj(1, 'a', 0, { locked: true })) === true);
check('isLocked reads a missing flag as unlocked',
  M.isLocked(obj(1, 'a', 0)) === false);
{
  const o = obj(1, 'a', 0);
  check('setHidden writes true and reports it', M.setHidden(o, true) === true && o.hidden === true);
  check('setHidden writes false and reports it', M.setHidden(o, false) === false && o.hidden === false);
  check('setHidden on null reports false', M.setHidden(null, true) === false);
  check('setLocked writes true and reports it', M.setLocked(o, true) === true && o.locked === true);
  check('setLocked writes false and reports it', M.setLocked(o, false) === false && o.locked === false);
  check('setLocked on null reports false', M.setLocked(null, true) === false);
}

// --- renameObject ---------------------------------------------------------
{
  const o = obj(1, 'hero', 0);
  eq('renameObject trims and writes the new name',
    M.renameObject(o, '  player  '), { ok: true, name: 'player' });
  check('renameObject wrote the name onto the object', o.name === 'player');
  eq('renameObject rejects a blank name and keeps the old one',
    M.renameObject(o, '   '), { ok: false, name: 'player' });
  check('renameObject left the name untouched on a blank rename', o.name === 'player');
  eq('renameObject rejects a non-string name',
    M.renameObject(o, null), { ok: false, name: 'player' });
  eq('renameObject on null reports not ok', M.renameObject(null, 'x'), { ok: false, name: '' });
}

// --- moveSelection --------------------------------------------------------
eq('moveSelection steps down', M.moveSelection([1, 2, 3], 1, 1), 2);
eq('moveSelection steps up', M.moveSelection([1, 2, 3], 3, -1), 2);
eq('moveSelection stays on the last row at the bottom',
  M.moveSelection([1, 2, 3], 3, 1), 3);
eq('moveSelection stays on the first row at the top',
  M.moveSelection([1, 2, 3], 1, -1), 1);
eq('moveSelection starts at the first row for an unknown selection',
  M.moveSelection([1, 2, 3], 99, 1), 1);
eq('moveSelection starts at the last row going up from an unknown selection',
  M.moveSelection([1, 2, 3], 99, -1), 3);
eq('moveSelection of an empty list is null', M.moveSelection([], 1, 1), null);
eq('moveSelection degrades a non-array to null', M.moveSelection(null, 1, 1), null);

// --- layerLabel -----------------------------------------------------------
check('layerLabel names the layer and the count',
  M.layerLabel(2, 3) === 'Layer 2 · 3 objects');
check('layerLabel uses the singular for one object',
  M.layerLabel(0, 1) === 'Layer 0 · 1 object');
check('layerLabel reads a missing count as 0',
  M.layerLabel(1) === 'Layer 1 · 0 objects');

// --- module surface -------------------------------------------------------
// In node the module exports the factory itself; factorySource is the
// factory's own source text (the browser branch attaches the same
// string to window.HydraOutliner.factorySource for export inlining).
const FACTORY_SRC = factory.toString();
check('factorySource is a string naming the factory',
  typeof FACTORY_SRC === 'string' && FACTORY_SRC.includes('hydraOutlinerFactory'));
check('the module attaches factorySource for the browser',
  MODULE_SRC.includes('window.HydraOutliner.factorySource = hydraOutlinerFactory.toString()'));
check('factorySource re-instantiation gives a working module',
  (() => {
    const again = eval('(' + FACTORY_SRC + ')()');
    return typeof again.groupByLayer === 'function' &&
      again.groupByLayer([obj(1, 'a', 1)]).length === 1;
  })());

// --- markup pins (index.html) ---------------------------------------------
check('index.html loads hydra-outliner.js after paneldock and before script.js',
  INDEX_HTML.indexOf('hydra-outliner.js') > INDEX_HTML.indexOf('hydra-paneldock.js') &&
  INDEX_HTML.indexOf('hydra-outliner.js') < INDEX_HTML.indexOf('script.js?'));
check('the hierarchy list is keyboard-focusable with a plain-language label',
  INDEX_HTML.includes('id="scene-object-list"') &&
  INDEX_HTML.includes('tabindex="0"') &&
  INDEX_HTML.includes('arrow keys move the selection'));

// --- style pins (style.css) -----------------------------------------------
check('style.css has the layer-group header rule',
  STYLE_CSS.includes('.object-list-group'));
check('style.css lays the row out with eye and lock columns',
  /\.object-list-item\s*\{[^}]*grid-template-columns:\s*24px minmax\(0,\s*1fr\) auto auto auto;/.test(STYLE_CSS));
check('style.css dims a hidden row without dimming its buttons',
  STYLE_CSS.includes('.object-list-item.is-hidden .object-list-name'));
check('style.css styles the eye and lock icon buttons',
  STYLE_CSS.includes('.object-list-eye') && STYLE_CSS.includes('.object-list-lock'));
check('style.css styles the inline rename input',
  STYLE_CSS.includes('.object-list-rename'));
check('style.css hides a hidden object on the stage',
  /\.game-object\.object-hidden\s*\{[^}]*display:\s*none;/.test(STYLE_CSS));
check('style.css outlines a locked object on the stage',
  /\.game-object\.object-locked\s*\{[^}]*outline:\s*1px dashed/.test(STYLE_CSS));
check('style.css has the details summary line',
  STYLE_CSS.includes('.object-details-summary'));
check('style.css keeps the pinned list density (gap 4px, row padding 6px 8px)',
  /\.scene-object-list\s*\{[^}]*gap:\s*4px;/.test(STYLE_CSS) &&
  /\.object-list-item\s*\{[^}]*padding:\s*6px 8px;/.test(STYLE_CSS));

// --- wiring pins (script.js) ----------------------------------------------
check('script.js loads the collapsed map at editor start',
  SCRIPT_JS.includes('initOutliner()') && SCRIPT_JS.includes('readStoredCollapsed'));
check('script.js renders layer groups when there is no search query',
  SCRIPT_JS.includes('buildObjectListGroupHeader') && SCRIPT_JS.includes('groupByLayer(objects)'));
check('script.js builds rows through the shared row builder',
  SCRIPT_JS.includes('buildObjectListItem(obj, selectedId)'));
check('script.js wires the eye toggle through the outliner module',
  SCRIPT_JS.includes('setHidden(obj, !O.isHidden(obj))'));
check('script.js wires the lock toggle through the outliner module',
  SCRIPT_JS.includes('setLocked(obj, !O.isLocked(obj))'));
check('script.js wires double-click rename on the row name',
  SCRIPT_JS.includes("addEventListener('dblclick'") && SCRIPT_JS.includes('startObjectListRename'));
check('script.js wires arrow-key navigation on the list',
  SCRIPT_JS.includes("sceneObjectList?.addEventListener('keydown'") &&
  SCRIPT_JS.includes('moveSelection(ids, selectedId'));
check('selectGameObjectById takes the stay-in-tab option for arrow keys',
  SCRIPT_JS.includes('selectGameObjectById(nextId, { switchTab: false })') &&
  SCRIPT_JS.includes('opts.switchTab !== false'));
check('script.js marks hidden and locked stage elements at render',
  SCRIPT_JS.includes("el.classList.add('object-hidden')") &&
  SCRIPT_JS.includes("el.classList.add('object-locked')"));
check('script.js refuses to drag or paint a locked object on the canvas',
  SCRIPT_JS.includes('if (objectData.locked === true) return;'));
check('script.js does not deselect on a press that started on an object',
  SCRIPT_JS.includes('sceneMouseDownTarget') &&
  SCRIPT_JS.includes('if (sceneMouseDownTarget !== newScene) return;'));
check('row click keeps the list DOM stable so double-click rename fires',
  SCRIPT_JS.includes('keepListDom: true') &&
  SCRIPT_JS.includes('opts.keepListDom') &&
  SCRIPT_JS.includes("r.classList.toggle('active', r.dataset.objectId === String(id))"));
check('a click on the row name stays in the list instead of opening the Inspector',
  SCRIPT_JS.includes("e.target.closest('.object-list-name')") &&
  SCRIPT_JS.includes('switchTab: onName ? false : undefined'));
check('script.js shows the details summary in the Inspector',
  SCRIPT_JS.includes('object-details-summary') &&
  SCRIPT_JS.includes(' · Layer ${obj.layer || 0} · #${obj.id}'));
check('script.js mirrors Visible and Locked in the Inspector',
  SCRIPT_JS.includes("makeCheckbox('Visible'") &&
  SCRIPT_JS.includes("makeCheckbox('Locked (cannot drag on canvas)'"));

// --- runtime pins ---------------------------------------------------------
check('the 3D editor view skips hidden objects',
  STAGE_SRC.includes('o.hidden !== true') &&
  STAGE_SRC.includes('is3dKind(o.kind) || H3.isLight3d(o.kind)'));
check('the shared scene reset seeds hidden from the scene flags',
  RESET_SRC.includes('seedHidden(h.hidden, scene.objects)'));

// --- docs pins ------------------------------------------------------------
check('the user guide documents the outliner groups, eye, lock, rename, and keys',
  GUIDE.includes('Layer groups') && GUIDE.includes('eye') &&
  GUIDE.includes('Lock') && GUIDE.includes('Double-click') &&
  GUIDE.includes('arrow keys'));
check('the user guide says hidden is a starting state a Show block can undo',
  GUIDE.includes('starts the game hidden') && GUIDE.includes('Show'));

if (failures) { console.error(`${failures} assertion(s) failed`); process.exit(1); }
console.log('outliner.test.js: all assertions passed');
