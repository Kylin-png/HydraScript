// Save-path regression test: saveProject must skip when clean (cheap
// beforeunload), perform a single-clone save when dirty, and store the
// alias-stripped form.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HYDRA = path.join(__dirname, '..', 'hydra');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

function makeEl() {
  return {
    textContent: 'Test Project',
    style: {},
    classList: { add() {}, remove() {} },
    addEventListener() {},
    appendChild() {},
    remove() {},
    blur() {}
  };
}

const store = new Map();
const setItemCalls = [];
const sandbox = {
  console,
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { setItemCalls.push(k); store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); }
  },
  document: {
    addEventListener: (type, fn) => { if (type === 'DOMContentLoaded') sandbox.__domReady = fn; },
    getElementById: () => makeEl(),
    createElement: () => makeEl()
  },
  setTimeout: () => 0,
  clearTimeout: () => {},
  alert: () => {}
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.addEventListener = () => {};
// live editor stores the save path references
sandbox.scenes = [];
sandbox.globalGridData = {};
sandbox.assetLibrary = {};
sandbox.commitActiveGrid = () => {};
vm.createContext(sandbox);

vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-universal.js'), 'utf8'), sandbox,
  { filename: 'hydra-universal.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'project.js'), 'utf8'), sandbox,
  { filename: 'project.js' });
sandbox.__domReady();

const pm = sandbox.projectManager;
check('projectManager exposed', !!pm && typeof pm.saveProject === 'function');
setItemCalls.length = 0;

// 1. clean project -> saveProject is a no-op (cheap beforeunload)
sandbox.hydraProjectDirty = false;
pm.saveProject({ silent: true });
check('clean saveProject does not touch localStorage',
  !setItemCalls.includes('hydraProjects'), JSON.stringify(setItemCalls));

// 2. dirty project -> saves once, alias-stripped
sandbox.scenes = [{
  id: 1, name: 'S1',
  objects: [{ id: 1, name: 'hero', kind: 'sprite', posX: 1, posY: 2, width: 10, height: 10 }],
  gridData: { 0: { type: 'always', kind: 'condition' } }
}];
sandbox.globalGridData = { 0: { type: 'gameStart', kind: 'condition' } };
sandbox.hydraProjectDirty = true;
pm.saveProject({ silent: true });
check('dirty saveProject writes hydraProjects', setItemCalls.includes('hydraProjects'));
const saved = JSON.parse(store.get('hydraProjects'));
const proj = Array.isArray(saved) ? saved.find(p => p.id === pm.getCurrentProject().id) : saved;
check('saved project found', !!proj);
check('saved form has no alias duplicates',
  proj && proj.logicGrids.global === undefined && proj.scenes[0].entities === undefined &&
  (!proj.scenes[0].logicGrids || proj.scenes[0].logicGrids.main === undefined),
  proj ? JSON.stringify(Object.keys(proj.logicGrids || {})) : 'no proj');
check('saved canonical data intact',
  proj && proj.scenes[0].objects[0].name === 'hero' && proj.globalGridData['0'].type === 'gameStart');

// 3. single live reference, not a clone: the stored snapshot is detached but
// the in-memory project tracks the live stores
check('in-memory project references live scenes (no per-save clone)',
  pm.getCurrentProject().scenes === sandbox.scenes);
const snapshotBefore = store.get('hydraProjects');
sandbox.scenes[0].objects.push({ id: 2, name: 'extra', kind: 'sprite' });
check('stored snapshot unaffected by later live edits', store.get('hydraProjects') === snapshotBefore);

// 4. dirty flag cleared after save -> second save is free
check('dirty flag cleared after save', sandbox.hydraProjectDirty === false);
setItemCalls.length = 0;
pm.saveProject({ silent: true });
check('second save after clean is a no-op', !setItemCalls.includes('hydraProjects'));

if (failures) { console.error(`${failures} assertion(s) failed`); process.exit(1); }
console.log('save.test.js: all assertions passed');
