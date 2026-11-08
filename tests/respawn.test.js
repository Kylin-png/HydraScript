// Unit tests for hydra/hydra-respawn.js — the shared checkpoints &
// respawn system (P4 Advanced batch 23: checkpoints & respawn,
// beginner edition).
//
// Pure logic: checkpoint set / clear / read, start-position recording,
// respawn-position resolution, the respawn count, and the routing sets.
// Nothing here touches the DOM; both runtimes delegate to this module.
// Static checks at the end pin the wiring: catalog blocks, both
// runtimes' dispatch, the flow trigger mode, the scene reset, and the
// docs.

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
function near(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-9); }

const sandbox = {};
sandbox.window = sandbox; // hydra-respawn.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-respawn.js'), 'utf8'),
  sandbox, { filename: 'hydra-respawn.js' });
const R = sandbox.HydraRespawn;

check('HydraRespawn exposed with helpers',
  !!R && typeof R.createRespawnState === 'function' &&
  typeof R.setCheckpoint === 'function' &&
  typeof R.clearCheckpoint === 'function' &&
  typeof R.hasCheckpoint === 'function' &&
  typeof R.checkpointOf === 'function' &&
  typeof R.recordInitialPositions === 'function' &&
  typeof R.initialPositionOf === 'function' &&
  typeof R.respawnPosition === 'function' &&
  typeof R.noteRespawn === 'function' &&
  typeof R.respawnCount === 'function' &&
  typeof R.isRespawnAction === 'function' &&
  typeof R.isRespawnCondition === 'function');
check('factorySource is a non-empty string',
  typeof R.factorySource === 'string' && R.factorySource.length > 100 &&
  R.factorySource.includes('hydraRespawnFactory'));

// --- state + checkpoint ---
check('createRespawnState starts with no checkpoint, zero count, and no start positions',
  JSON.stringify(R.createRespawnState()) === JSON.stringify({ point: null, count: 0, initial: {} }));
{
  const st = R.createRespawnState();
  const pt = R.setCheckpoint(st, 500, 100, 'flag');
  check('setCheckpoint records the point with its name',
    !!pt && pt.x === 500 && pt.y === 100 && pt.name === 'flag' &&
    R.hasCheckpoint(st) === true && R.checkpointOf(st) === pt,
    JSON.stringify(pt));
  check('setCheckpoint reads a missing name as an empty string',
    R.setCheckpoint(st, 10, 20, null).name === '' &&
    R.setCheckpoint(st, 10, 20).name === '');
  check('a second checkpoint replaces the first (no checkpoint list)',
    R.setCheckpoint(st, 700, 300, 'door').x === 700 &&
    R.checkpointOf(st).name === 'door' && R.hasCheckpoint(st) === true);
  R.clearCheckpoint(st);
  check('clearCheckpoint forgets the point',
    R.hasCheckpoint(st) === false && R.checkpointOf(st) === null);
  R.clearCheckpoint(st);
  check('clearCheckpoint on an empty state stays quiet', R.hasCheckpoint(st) === false);
  check('setCheckpoint stays quiet on a missing state or a bad position',
    R.setCheckpoint(null, 1, 1, 'flag') === null &&
    R.setCheckpoint(st, 'oops', 1, 'flag') === null &&
    R.setCheckpoint(st, 1, null, 'flag') === null &&
    R.hasCheckpoint(st) === false);
  check('hasCheckpoint and checkpointOf read a missing state as none set',
    R.hasCheckpoint(null) === false && R.checkpointOf(null) === null &&
    R.hasCheckpoint('nope') === false && R.checkpointOf({}) === null);
}

// --- start positions ---
{
  const st = R.createRespawnState();
  R.recordInitialPositions(st, [
    { name: 'hero', posX: 100, posY: 100 },
    { name: 'flag', posX: 500, posY: 100 },
    { name: 'hero', posX: 200, posY: 200 },
    { name: '', posX: 9, posY: 9 },
    { name: 'ghost', posX: 'oops', posY: 5 },
    null, 'nope'
  ]);
  check('recordInitialPositions remembers the first object per name',
    JSON.stringify(R.initialPositionOf(st, 'hero')) === JSON.stringify({ x: 100, y: 100 }) &&
    JSON.stringify(R.initialPositionOf(st, 'flag')) === JSON.stringify({ x: 500, y: 100 }),
    JSON.stringify(st.initial));
  check('recordInitialPositions skips unnamed, bad-position, and non-object entries',
    R.initialPositionOf(st, '') === null && R.initialPositionOf(st, 'ghost') === null &&
    R.initialPositionOf(st, 'nobody') === null);
  check('initialPositionOf reads a missing state as no home',
    R.initialPositionOf(null, 'hero') === null &&
    R.initialPositionOf({}, 'hero') === null);
  R.recordInitialPositions(null, [{ name: 'hero', posX: 1, posY: 1 }]);
  R.recordInitialPositions(st, null);
  R.recordInitialPositions(st, 'nope');
  check('recordInitialPositions stays quiet on a missing state or list', true);
}

// --- respawn position + count ---
{
  const st = R.createRespawnState();
  R.recordInitialPositions(st, [{ name: 'hero', posX: 100, posY: 100 }]);
  check('respawnPosition falls back to the start position with no checkpoint',
    JSON.stringify(R.respawnPosition(st, 'hero')) === JSON.stringify({ x: 100, y: 100 }));
  check('respawnPosition reads null for a name with no home and no checkpoint',
    R.respawnPosition(st, 'ghost') === null &&
    R.respawnPosition(null, 'hero') === null);
  R.setCheckpoint(st, 500, 100, 'flag');
  check('respawnPosition prefers the checkpoint over the start position',
    JSON.stringify(R.respawnPosition(st, 'hero')) === JSON.stringify({ x: 500, y: 100 }));
  check('respawnPosition returns a copy, so the caller cannot mutate the checkpoint',
    (() => {
      const p = R.respawnPosition(st, 'hero');
      p.x = 999;
      return R.checkpointOf(st).x === 500;
    })());
  R.clearCheckpoint(st);
  check('respawnPosition goes home again after the checkpoint clears',
    JSON.stringify(R.respawnPosition(st, 'hero')) === JSON.stringify({ x: 100, y: 100 }));
  check('respawnCount starts at 0 and noteRespawn counts up',
    R.respawnCount(st) === 0 &&
    R.noteRespawn(st) === 1 && R.respawnCount(st) === 1 &&
    R.noteRespawn(st) === 2 && R.respawnCount(st) === 2);
  check('noteRespawn and respawnCount read a missing state as 0',
    R.noteRespawn(null) === 0 && R.respawnCount(null) === 0 &&
    R.respawnCount({}) === 0);
  check('a negative count reads as 0, and noteRespawn repairs it',
    R.respawnCount({ count: -3 }) === 0 && R.noteRespawn({ count: -3 }) === 1);
}

// --- routing ---
check('routing sets cover the three actions and two conditions',
  R.isRespawnAction('setCheckpoint') && R.isRespawnAction('respawnObject') &&
  R.isRespawnAction('clearCheckpoint') &&
  !R.isRespawnAction('checkpointSet') && !R.isRespawnAction('respawnCount') &&
  !R.isRespawnAction('damageObject') && !R.isRespawnAction(null) &&
  R.isRespawnCondition('checkpointSet') && R.isRespawnCondition('respawnCount') &&
  !R.isRespawnCondition('setCheckpoint') && !R.isRespawnCondition(null));

// --- hostile input ---
check('hostile input degrades to safe defaults',
  R.setCheckpoint('nope', 1, 1, 'flag') === null &&
  R.hasCheckpoint('nope') === false &&
  R.checkpointOf([]) === null &&
  R.respawnPosition('nope', 'hero') === null &&
  R.noteRespawn('nope') === 0 &&
  R.respawnCount('nope') === 0);

// --- static wiring ---
{
  const html = fs.readFileSync(path.join(HYDRA, 'index.html'), 'utf8');
  const rspTag = html.indexOf('src="hydra-respawn.js');
  check('index.html loads hydra-respawn.js before player-runtime.js and script.js',
    rspTag !== -1 && rspTag < html.indexOf('src="player-runtime.js') && rspTag < html.indexOf('src="script.js'));
  check('index.html loads hydra-respawn.js after hydra-damagefx.js',
    rspTag > html.indexOf('src="hydra-damagefx.js'));
  const playerJs = fs.readFileSync(path.join(HYDRA, 'player-runtime.js'), 'utf8');
  check('player-runtime.js hard-guards on HydraRespawn',
    playerJs.includes("if (!HydraRespawn || typeof HydraRespawn.createRespawnState !== 'function')") &&
    playerJs.includes('HydraScript player runtime requires hydra-respawn.js'));
  check('player-runtime.js inlines HydraRespawn into exports',
    playerJs.includes("'HydraRespawn', global.HydraRespawn && global.HydraRespawn.factorySource"));
  check('player-runtime.js classifies respawn blocks for the dispatch',
    playerJs.includes('HydraRespawn.isRespawnCondition(type)') &&
    playerJs.includes('HydraRespawn.isRespawnAction(type)'));
  check('player-runtime.js exposes the module to both contexts and records start positions',
    playerJs.includes('respawnModule: HydraRespawn') &&
    playerJs.includes('respawn: state.respawn') &&
    playerJs.includes('ensureRespawnState: function ()') &&
    playerJs.includes('createRespawnState: () => HydraRespawn.createRespawnState()') &&
    playerJs.includes('HydraRespawn.recordInitialPositions(state.respawn, state.objects)'));
  const previewJs = fs.readFileSync(path.join(HYDRA, 'hydra-previewruntime.js'), 'utf8');
  check('preview runtime exposes the module to both contexts',
    (previewJs.match(/respawnModule: mod\('Respawn'\)/g) || []).length === 2 &&
    previewJs.includes('respawn: run ? run.respawn : null'));
  check('preview runtime resets the state per scene and records start positions on load and launch',
    previewJs.includes('createRespawnState: function () {') &&
    previewJs.includes("ensureRespawnState: function () { return hostCall('ensurePreviewRespawnState', [], null); }") &&
    (previewJs.match(/RM\.recordInitialPositions\(rs\.respawn, rs\.objects\)/g) || []).length === 2);
  const executeJs = fs.readFileSync(path.join(HYDRA, 'hydra-execute.js'), 'utf8');
  check('shared execute module runs the three respawn actions',
    executeJs.includes("if (isType(ctx.respawnModule, 'isRespawnAction', type))") &&
    executeJs.includes("type === 'setCheckpoint'") &&
    executeJs.includes("type === 'respawnObject'") &&
    executeJs.includes("type === 'clearCheckpoint'") &&
    executeJs.includes('RM.setCheckpoint(cpState, cpX, cpY,') &&
    executeJs.includes('RM.respawnPosition(rsState, o.name)') &&
    executeJs.includes('RM.noteRespawn(rsState)') &&
    executeJs.includes('RM.clearCheckpoint(clrState)') &&
    executeJs.includes('ctx.healthModule.setHealth(o, full)') &&
    executeJs.includes('ctx.pathfindModule.stopPath(o)'));
  const conditionsJs = fs.readFileSync(path.join(HYDRA, 'hydra-conditions.js'), 'utf8');
  check('shared conditions module reads Checkpoint Set and Respawn Count',
    conditionsJs.includes("case 'checkpointSet':") &&
    conditionsJs.includes("case 'respawnCount':") &&
    conditionsJs.includes('RMm.hasCheckpoint(ctx.respawn)') &&
    conditionsJs.includes('RMm2.respawnCount(ctx.respawn)'));
  check('shared conditions module does not freeze the respawn reads while paused',
    !conditionsJs.split('FROZEN_WHILE_PAUSED = [')[1].split('];')[0].includes('checkpointSet') &&
    !conditionsJs.split('FROZEN_WHILE_PAUSED = [')[1].split('];')[0].includes('respawnCount'));
  const flowSb = {};
  flowSb.window = flowSb;
  vm.createContext(flowSb);
  vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-flow.js'), 'utf8'),
    flowSb, { filename: 'hydra-flow.js' });
  const F = flowSb.HydraFlow;
  check('flow module reads Checkpoint Set and Respawn Count as level triggers',
    F.defaultTriggerMode('checkpointSet') === 'level' &&
    F.defaultTriggerMode('respawnCount') === 'level');
  const resetSb = {};
  resetSb.window = resetSb;
  vm.createContext(resetSb);
  vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-scenereset.js'), 'utf8'),
    resetSb, { filename: 'hydra-scenereset.js' });
  const SR = resetSb.HydraSceneReset;
  check('scene reset mints a fresh respawn state per scene load',
    (() => {
      const state = { respawn: { point: { x: 1, y: 2 }, count: 3, initial: { hero: { x: 0, y: 0 } } } };
      let created = 0;
      const ok = SR.resetSceneRuntime(state, { id: 1 },
        { createRespawnState: () => { created++; return { point: null, count: 0, initial: {} }; } });
      return ok === true && created === 1 && state.respawn.point === null &&
        state.respawn.count === 0 && JSON.stringify(state.respawn.initial) === '{}';
    })() &&
    (() => {
      const state = {};
      const ok = SR.resetSceneRuntime(state, { id: 1 }, {});
      return ok === true && state.respawn === null;
    })());
  const catalogJs = fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8');
  check('catalog carries the five respawn blocks in the Respawn category',
    catalogJs.includes("blockType: 'set-checkpoint'") &&
    catalogJs.includes("runtimeType: 'setCheckpoint'") &&
    catalogJs.includes("blockType: 'respawn-object'") &&
    catalogJs.includes("runtimeType: 'respawnObject'") &&
    catalogJs.includes("blockType: 'clear-checkpoint'") &&
    catalogJs.includes("runtimeType: 'clearCheckpoint'") &&
    catalogJs.includes("blockType: 'checkpoint-set'") &&
    catalogJs.includes("runtimeType: 'checkpointSet'") &&
    catalogJs.includes("blockType: 'respawn-count'") &&
    catalogJs.includes("runtimeType: 'respawnCount'") &&
    catalogJs.includes("key: 'checkpointObject', label: 'Checkpoint object'") &&
    catalogJs.includes("key: 'restoreHealth', label: 'Restore health'"));
  const scriptJs = fs.readFileSync(path.join(HYDRA, 'script.js'), 'utf8');
  check('editor wires the preview respawn state and hands its maker to the preview runtime host',
    scriptJs.includes('function ensurePreviewRespawnState()') &&
    scriptJs.includes('ensurePreviewParticleState, ensurePreviewDamageNumberState, ensurePreviewRespawnState, ensurePreviewSpawnerState, ensurePreviewMovementState, ensurePreviewPlatformState, ensurePreviewCombatState, getPreviewBuses'));
  const refMd = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');
  check('block reference documents all five respawn blocks',
    refMd.includes('Set Checkpoint') && refMd.includes('Respawn Object') &&
    refMd.includes('Clear Checkpoint') && refMd.includes('Checkpoint Set') &&
    refMd.includes('Respawn Count'));
  const guideMd = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');
  check('user guide covers checkpoints and respawn',
    guideMd.includes('Checkpoint') && guideMd.includes('Respawn Object'));
}

process.exit(failures === 0 ? 0 : 1);
