// P1 item 16 (resilience) regression test: corrupt saved data must
// normalize or report, never throw. Covers the wrong-type shapes a damaged
// localStorage record or a hand-edited .hydra file can carry: strings
// where arrays belong, numbers where objects belong, null entries inside
// scene/object lists, and circular references at save time.
//
// The hub/editor loader behavior (per-record isolation, corrupt-store
// backup + visible banner, editor still opening) is covered end to end in
// tests/browser-smoke.js; this file covers the pure normalizer half.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HYDRA = path.join(__dirname, '..', 'hydra');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const sandbox = {};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-universal.js'), 'utf8'), sandbox,
  { filename: 'hydra-universal.js' });
const HU = sandbox.HydraUniversal;
check('HydraUniversal loaded', !!HU && typeof HU.normalizeProject === 'function');

// normalizeProject never throws on non-object input.
check('normalizeProject(null) returns null', HU.normalizeProject(null) === null);
check('normalizeProject(undefined) returns undefined', HU.normalizeProject(undefined) === undefined);
check('normalizeProject(string) returns the string untouched', HU.normalizeProject('junk') === 'junk');

// A string where the scene list belongs repairs to an empty list.
const scenesString = HU.normalizeProject({ id: 'r1', name: 'R1', scenes: 'not-an-array' });
check('scenes as a string repairs to []', Array.isArray(scenesString.scenes) && scenesString.scenes.length === 0);
check('scenes-as-string still rebuilds the global event sheet',
  Array.isArray(scenesString.eventSheets) && scenesString.eventSheets.length === 1 &&
  scenesString.eventSheets[0].id === 'global');

// Null / string entries inside the scene list are skipped, not dereferenced.
const badEntries = HU.normalizeProject({
  id: 'r2', name: 'R2',
  scenes: [null, 'a string scene', 42, { id: 1, name: 'Good Scene', objects: [] }]
});
check('null/string/number scene entries do not throw', !!badEntries);
check('bad scene entries are dropped, the good scene survives',
  badEntries.scenes.length === 4 && badEntries.scenes[3].name === 'Good Scene');
check('event sheets skip bad scene entries',
  badEntries.eventSheets.length === 2 && badEntries.eventSheets[1].id === 'scene_1');

// A string where the object list belongs repairs to an empty list.
const objectsString = HU.normalizeProject({
  id: 'r3', name: 'R3', scenes: [{ id: 1, name: 'S1', objects: 'junk', gridData: 'junk', layers: 'junk' }]
});
const s3 = objectsString.scenes[0];
check('objects as a string repairs to []', Array.isArray(s3.objects) && s3.objects.length === 0);
check('gridData as a string repairs to {}',
  s3.gridData && typeof s3.gridData === 'object' && !Array.isArray(s3.gridData));
check('layers as a string repairs to the default layers',
  Array.isArray(s3.layers) && s3.layers.length === 3 && s3.layers[0].id === 'world2d');
check('scene logic-grid alias points at the repaired grid', s3.logicGrids.main === s3.gridData);

// Wrong-type object fields repair in place.
const badFields = HU.normalizeProject({
  id: 'r4', name: 'R4',
  scenes: [{ id: 1, name: 'S1', objects: [{ name: 'hero', kind: 'sprite', collision: 'x', variables: 'y' }] }]
});
const hero = badFields.scenes[0].objects[0];
check('collision as a string repairs to an object with an enabled flag',
  hero.collision && typeof hero.collision === 'object' && typeof hero.collision.enabled === 'boolean');
check('variables as a string repairs to {}',
  hero.variables && typeof hero.variables === 'object' && !Array.isArray(hero.variables));

// Wrong-type project-level fields repair in place.
const badTop = HU.normalizeProject({
  id: 'r5', name: 'R5', assets: 'junk', logicGrids: 'junk',
  globalGridData: { 0: { type: 'always', kind: 'condition' } }, scenes: []
});
check('assets as a string repairs to {}',
  badTop.assets && typeof badTop.assets === 'object' && !Array.isArray(badTop.assets));
check('logicGrids as a string repairs to an object', typeof badTop.logicGrids === 'object');
check('global grid survives a damaged logicGrids and the alias is restored',
  badTop.logicGrids.global === badTop.globalGridData &&
  badTop.globalGridData[0] && badTop.globalGridData[0].type === 'always');
const badGlobal = HU.normalizeProject({ id: 'r6', name: 'R6', globalGridData: 'junk', scenes: [] });
check('globalGridData as a string repairs to {} and the alias follows',
  badGlobal.globalGridData && typeof badGlobal.globalGridData === 'object' &&
  badGlobal.logicGrids.global === badGlobal.globalGridData);

// The asset-usage scanners tolerate the same damage.
check('collectAssetUsage on a damaged project does not throw', (() => {
  try { HU.collectAssetUsage({ scenes: 'junk' }); HU.collectAssetUsage({ scenes: [null, { id: 1, objects: 'junk' }] }); return true; }
  catch (e) { return false; }
})());
check('findUnusedAssets on a damaged project does not throw', (() => {
  try { return HU.findUnusedAssets({ assets: { a: { name: 'a' } }, scenes: [null] }).length === 1; }
  catch (e) { return false; }
})());
check('removeAssetReferences on a damaged project does not throw', (() => {
  try { return HU.removeAssetReferences({ scenes: 'junk' }, 'a') === 0; }
  catch (e) { return false; }
})());
check('collectProjectDiagnostics on a damaged project does not throw', (() => {
  try { HU.collectProjectDiagnostics({ globalGridData: 'junk', scenes: 'junk' }); return true; }
  catch (e) { return false; }
})());
check('rebuildProjectEventSheets on a damaged project does not throw', (() => {
  try {
    const sheets = HU.rebuildProjectEventSheets({ globalGridData: {}, scenes: 'junk' });
    return Array.isArray(sheets) && sheets.length === 1;
  } catch (e) { return false; }
})());

// A circular project cannot be cloned for saving; serializeProject returns
// it unchanged so the save path can report the failure instead of dying.
const circular = { id: 'r7', name: 'Circular' };
circular.self = circular;
check('serializeProject on a circular project returns it unchanged, no throw',
  HU.serializeProject(circular) === circular);

// A normal project still serializes with aliases stripped (no regression
// on the save-fidelity path).
const normal = HU.normalizeProject({
  id: 'r8', name: 'Normal', globalGridData: { 0: { type: 'always', kind: 'condition' } },
  scenes: [{ id: 1, name: 'S1', objects: [{ name: 'hero', kind: 'sprite' }], gridData: {} }]
});
const serialized = HU.serializeProject(normal);
check('normal project still strips the eventSheets alias on save',
  Array.isArray(serialized.eventSheets) && serialized.eventSheets.length === 0);
check('normal project keeps its scenes and global grid on save',
  serialized.scenes.length === 1 && serialized.globalGridData[0].type === 'always');

// The #grid / #game-canvas load-time guards are present in script.js.
const scriptSrc = fs.readFileSync(path.join(HYDRA, 'script.js'), 'utf8');
check('script.js guards the #grid lookup with a fallback',
  /getElementById\('grid'\) \|\| fallbackElement\('grid', 'div'\)/.test(scriptSrc));
check('script.js guards the #game-canvas lookup with a fallback',
  /getElementById\('game-canvas'\) \|\| fallbackElement\('game-canvas', 'canvas'\)/.test(scriptSrc));
check('script.js defines the fallbackElement helper before use',
  scriptSrc.indexOf('function fallbackElement(') !== -1 &&
  scriptSrc.indexOf('function fallbackElement(') < scriptSrc.indexOf("getElementById('grid')"));

// The hub and editor loaders isolate records and back up damaged stores.
const homeSrc = fs.readFileSync(path.join(HYDRA, 'home.js'), 'utf8');
check('home.js loadProjects backs up a damaged store', /backupCorruptStore\(raw\)/.test(homeSrc));
check('home.js loadProjects repairs records one at a time', /Skipping a saved project that could not be repaired/.test(homeSrc));
check('home.js shows a visible banner for a damaged store', /hydra-store-notice/.test(homeSrc));
check('home.js saveProjects refuses to overwrite an un-backed-up damaged store',
  /storeCorrupt && !storeBackupOk/.test(homeSrc));
const projectSrc = fs.readFileSync(path.join(HYDRA, 'project.js'), 'utf8');
check('project.js loadProjects backs up a damaged store', /backupCorruptStore\(raw\)/.test(projectSrc));
check('project.js loadProjects repairs records one at a time', /Skipping a saved project that could not be repaired/.test(projectSrc));
check('project.js guards initProject so a bad load cannot kill the editor',
  /Error starting project, opening a fresh project instead/.test(projectSrc));
check('project.js save button wiring tolerates a missing button', /saveBtn\?\.addEventListener/.test(projectSrc));

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log('resilience.test.js: all checks passed');
