// Save-fidelity regression test: serializeProject must strip the in-memory
// alias duplicates (logicGrids.global, per-scene logicGrids entries,
// scene.logicGrids.main, scene.entities) without losing data, and
// normalizeProject must restore them on load.

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
check('HydraUniversal loaded', !!HU && typeof HU.serializeProject === 'function');

// Build a project and run the real normalizer so all aliases are live,
// exactly as the editor holds them in memory.
const gridData = {};
for (let i = 0; i < 200; i++) {
  gridData[i] = { type: 'setVariable', kind: 'action', varName: 'v' + i, operation: 'set', value: String(i) };
}
const project = {
  id: 'ser-1', name: 'Serialize Test', eventsVersion: 1,
  globalGridData: gridData,
  scenes: [{
    id: 1, name: 'Scene 1',
    objects: [{ id: 1, name: 'hero', kind: 'sprite', posX: 5, posY: 5, width: 10, height: 10 }],
    gridData: { 0: { type: 'always', kind: 'condition' }, 1: { type: 'setVariable', kind: 'action', varName: 'x', operation: 'set', value: '1' } }
  }],
  currentSceneId: 1,
  assets: {}
};
HU.normalizeProject(project);
check('aliases live in memory before save',
  project.logicGrids.global === project.globalGridData &&
  project.scenes[0].logicGrids.main === project.scenes[0].gridData &&
  project.scenes[0].entities === project.scenes[0].objects &&
  project.logicGrids['1'] === project.scenes[0].gridData);

const rawSize = JSON.stringify(project).length;
const clean = HU.serializeProject(project);
const cleanSize = JSON.stringify(clean).length;

check('aliases stripped from serialized copy',
  clean.logicGrids.global === undefined &&
  clean.logicGrids['1'] === undefined &&
  clean.scenes[0].entities === undefined &&
  (!clean.scenes[0].logicGrids || clean.scenes[0].logicGrids.main === undefined));
check('derived eventSheets stripped from serialized copy',
  Array.isArray(clean.eventSheets) && clean.eventSheets.length === 0 &&
  Array.isArray(clean.scenes[0].eventSheets) && clean.scenes[0].eventSheets.length === 0);
check('canonical data intact in serialized copy',
  JSON.stringify(clean.globalGridData) === JSON.stringify(gridData) &&
  clean.scenes[0].objects.length === 1 && clean.scenes[0].objects[0].name === 'hero' &&
  JSON.stringify(clean.scenes[0].gridData) === JSON.stringify(project.scenes[0].gridData));
check('serialized copy is much smaller than aliased original',
  cleanSize < rawSize * 0.6, `raw=${rawSize} clean=${cleanSize}`);
check('in-memory project untouched by serialize',
  project.logicGrids.global === project.globalGridData && project.scenes[0].entities === project.scenes[0].objects);

// Round trip: normalizeProject restores every alias from the stripped copy.
const reloaded = JSON.parse(JSON.stringify(clean));
HU.normalizeProject(reloaded);
check('aliases restored on load',
  reloaded.logicGrids.global === reloaded.globalGridData &&
  reloaded.scenes[0].logicGrids.main === reloaded.scenes[0].gridData &&
  reloaded.scenes[0].entities === reloaded.scenes[0].objects &&
  reloaded.logicGrids['1'] === reloaded.scenes[0].gridData);
check('data survives the round trip',
  reloaded.scenes[0].objects[0].name === 'hero' &&
  Object.keys(reloaded.globalGridData).length === 200 &&
  reloaded.scenes[0].gridData['1'].varName === 'x');

if (failures) { console.error(`${failures} assertion(s) failed`); process.exit(1); }
console.log('serialize.test.js: all assertions passed');
