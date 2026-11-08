// Unit tests for hydra/hydra-spawn.js — the shared enemy spawner /
// wave spawning system (P4 Advanced batch 24: enemy spawner,
// beginner edition).
//
// Pure logic: spawner start / stop / read, the per-frame tick with
// its interval / max-alive / total rules, the spawn-point resolution,
// and the routing sets. Nothing here touches the DOM; both runtimes
// delegate to this module. Static checks at the end pin the wiring:
// catalog blocks, both runtimes' dispatch, the flow trigger mode, the
// frame phase, the scene reset, and the docs.

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
sandbox.window = sandbox; // hydra-spawn.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-spawn.js'), 'utf8'),
  sandbox, { filename: 'hydra-spawn.js' });
const S = sandbox.HydraSpawn;

check('HydraSpawn exposed with helpers',
  !!S && typeof S.createSpawnerState === 'function' &&
  typeof S.spawnerOf === 'function' &&
  typeof S.normalizeInterval === 'function' &&
  typeof S.normalizeMaxAlive === 'function' &&
  typeof S.normalizeTotal === 'function' &&
  typeof S.startSpawner === 'function' &&
  typeof S.stopSpawner === 'function' &&
  typeof S.stopAllSpawners === 'function' &&
  typeof S.spawnerActive === 'function' &&
  typeof S.spawnedCount === 'function' &&
  typeof S.updateSpawners === 'function' &&
  typeof S.isSpawnAction === 'function' &&
  typeof S.isSpawnCondition === 'function');
check('factorySource is a non-empty string',
  typeof S.factorySource === 'string' && S.factorySource.length > 100 &&
  S.factorySource.includes('hydraSpawnFactory'));

// --- state + normalizers ---
check('createSpawnerState starts with no spawners running',
  JSON.stringify(S.createSpawnerState()) === JSON.stringify({ spawners: {} }));
check('normalizeInterval clamps to 0.1..3600 with a 2 default',
  S.normalizeInterval(2) === 2 && S.normalizeInterval('3') === 3 &&
  S.normalizeInterval(0) === 0.1 && S.normalizeInterval(0.05) === 0.1 &&
  S.normalizeInterval(5000) === 3600 && S.normalizeInterval('oops') === 2 &&
  S.normalizeInterval(null) === 2 && S.normalizeInterval(undefined) === 2);
check('normalizeMaxAlive is a whole 0..1000 with a 10 default (0 = no cap)',
  S.normalizeMaxAlive(10) === 10 && S.normalizeMaxAlive(0) === 0 &&
  S.normalizeMaxAlive(-5) === 0 && S.normalizeMaxAlive(2000) === 1000 &&
  S.normalizeMaxAlive(2.7) === 2 && S.normalizeMaxAlive('oops') === 10 &&
  S.normalizeMaxAlive(null) === 10);
check('normalizeTotal is a whole 0..10000 with a 0 default (0 = endless)',
  S.normalizeTotal(0) === 0 && S.normalizeTotal(5) === 5 &&
  S.normalizeTotal(-1) === 0 && S.normalizeTotal(20000) === 10000 &&
  S.normalizeTotal(3.9) === 3 && S.normalizeTotal('oops') === 0 &&
  S.normalizeTotal(null) === 0);

// --- start / stop / reads ---
{
  const st = S.createSpawnerState();
  const rec = S.startSpawner(st, {
    name: 'goblins', template: 'goblin', atObject: 'pad',
    x: 10, y: 20, interval: 2, maxAlive: 3, total: 5
  });
  check('startSpawner records the spawner with normalized fields',
    !!rec && rec.name === 'goblins' && rec.template === 'goblin' &&
    rec.atObject === 'pad' && rec.x === 10 && rec.y === 20 &&
    rec.interval === 2 && rec.maxAlive === 3 && rec.total === 5 &&
    rec.active === true && rec.timer === 0 && rec.spawned === 0 &&
    S.spawnerOf(st, 'goblins') === rec,
    JSON.stringify(rec));
  check('startSpawner trims the name and template',
    S.startSpawner(st, { name: '  bats  ', template: '  bat ', interval: 1 }).name === 'bats' &&
    S.spawnerOf(st, 'bats').template === 'bat');
  check('startSpawner reads a missing anchor as a blank and bad numbers as defaults',
    (() => {
      const r = S.startSpawner(st, { name: 'w', template: 'wisp', interval: 'oops', maxAlive: 'oops', total: 'oops', x: 'oops', y: null });
      return r.interval === 2 && r.maxAlive === 10 && r.total === 0 && r.x === 0 && r.y === 0 && r.atObject === '';
    })());
  check('spawnerActive reads true while the spawner runs',
    S.spawnerActive(st, 'goblins') === true);
  check('spawnedCount starts at 0',
    S.spawnedCount(st, 'goblins') === 0);
  S.startSpawner(st, { name: 'goblins', template: 'goblin', interval: 1 });
  check('restarting a spawner replaces it with a fresh timer and count',
    S.spawnerOf(st, 'goblins').interval === 1 &&
    S.spawnerOf(st, 'goblins').timer === 0 &&
    S.spawnerOf(st, 'goblins').spawned === 0 &&
    S.spawnerOf(st, 'goblins').active === true);
  S.stopSpawner(st, 'goblins');
  check('stopSpawner stops one spawner by name',
    S.spawnerActive(st, 'goblins') === false &&
    S.spawnerOf(st, 'goblins').active === false);
  S.stopSpawner(st, 'nobody');
  check('stopSpawner on an unknown name stays quiet', S.spawnerActive(st, 'bats') === true);
  S.stopAllSpawners(st);
  check('stopAllSpawners stops every spawner',
    S.spawnerActive(st, 'bats') === false && S.spawnerActive(st, 'w') === false);
  check('startSpawner stays quiet on a blank name, a blank template, or a missing state',
    S.startSpawner(st, { name: '', template: 'goblin' }) === null &&
    S.startSpawner(st, { name: 'x', template: '' }) === null &&
    S.startSpawner(st, { name: '  ', template: 'goblin' }) === null &&
    S.startSpawner(null, { name: 'x', template: 'goblin' }) === null &&
    S.spawnerActive(st, 'x') === false);
  check('spawnerActive and spawnedCount read a missing state or name as stopped and 0',
    S.spawnerActive(null, 'goblins') === false &&
    S.spawnedCount(null, 'goblins') === 0 &&
    S.spawnerActive(st, 'nobody') === false &&
    S.spawnedCount(st, 'nobody') === 0 &&
    S.spawnerOf(null, 'goblins') === null &&
    S.spawnerOf(st, 'nobody') === null);
  check('a negative spawned count reads as 0',
    S.spawnedCount({ spawners: { g: { spawned: -3 } } }, 'g') === 0);
  check('a spawner that reached its total reads as stopped even before the next tick',
    (() => {
      const s2 = S.createSpawnerState();
      const r2 = S.startSpawner(s2, { name: 'w', template: 'wisp', total: 2 });
      r2.spawned = 2;
      return S.spawnerActive(s2, 'w') === false;
    })());
  S.stopSpawner(null, 'goblins');
  S.stopAllSpawners(null);
  check('stopSpawner and stopAllSpawners stay quiet on a missing state', true);
}

// --- the tick ---
function stubHooks(opts) {
  const o = opts || {};
  const spawned = [];
  let alive = (typeof o.alive === 'number') ? o.alive : null;
  return {
    spawned: spawned,
    setAlive: function (n) { alive = n; },
    hooks: {
      spawn: function (template, x, y) {
        if (o.spawnNull) return null;
        const born = { name: template, posX: x, posY: y };
        spawned.push(born);
        return born;
      },
      findObject: function (name) {
        return (name === 'pad') ? { name: 'pad', posX: 400, posY: 300, width: 40, height: 40 } : null;
      },
      aliveCount: function (template) {
        if (alive !== null) return alive;
        return spawned.filter(function (s) { return s.name === template; }).length;
      }
    }
  };
}
{
  const st = S.createSpawnerState();
  S.startSpawner(st, { name: 'g', template: 'goblin', x: 100, y: 200, interval: 2, maxAlive: 0, total: 0 });
  const t = stubHooks();
  S.updateSpawners(st, 0, t.hooks);
  check('a tick with dt 0 ages nothing (the first frame spawns nothing)',
    t.spawned.length === 0 && S.spawnedCount(st, 'g') === 0);
  S.updateSpawners(st, 1, t.hooks);
  check('a tick short of the interval spawns nothing yet',
    t.spawned.length === 0 && S.spawnedCount(st, 'g') === 0);
  S.updateSpawners(st, 1, t.hooks);
  check('a tick that reaches the interval spawns once at the X/Y point',
    t.spawned.length === 1 && t.spawned[0].posX === 100 && t.spawned[0].posY === 200 &&
    S.spawnedCount(st, 'g') === 1 && S.spawnerActive(st, 'g') === true,
    JSON.stringify(t.spawned));
  S.updateSpawners(st, 2.5, t.hooks);
  check('a tick past one interval spawns once and banks the remainder',
    t.spawned.length === 2 && near(S.spawnerOf(st, 'g').timer, 0.5),
    JSON.stringify(S.spawnerOf(st, 'g')));
}
{
  const st = S.createSpawnerState();
  S.startSpawner(st, { name: 'g', template: 'goblin', atObject: 'pad', interval: 1, maxAlive: 0, total: 0 });
  const t = stubHooks();
  S.updateSpawners(st, 1, t.hooks);
  check('a tick with a named anchor spawns at the anchor top-left corner',
    t.spawned.length === 1 && t.spawned[0].posX === 400 && t.spawned[0].posY === 300,
    JSON.stringify(t.spawned));
}
{
  const st = S.createSpawnerState();
  S.startSpawner(st, { name: 'g', template: 'goblin', atObject: 'ghost-pad', x: 50, y: 60, interval: 1, maxAlive: 0, total: 0 });
  const t = stubHooks();
  S.updateSpawners(st, 1, t.hooks);
  check('a tick with a missing anchor spawns nothing and does not fall back to X/Y',
    t.spawned.length === 0 && S.spawnedCount(st, 'g') === 0);
  S.updateSpawners(st, 1, t.hooks);
  check('a missing anchor retries on the next interval, still quiet',
    t.spawned.length === 0);
}
{
  const st = S.createSpawnerState();
  S.startSpawner(st, { name: 'g', template: 'goblin', x: 0, y: 0, interval: 1, maxAlive: 2, total: 0 });
  const t = stubHooks();
  t.setAlive(2);
  S.updateSpawners(st, 1, t.hooks);
  check('a tick at the max-alive cap spawns nothing and waits',
    t.spawned.length === 0 && S.spawnedCount(st, 'g') === 0);
  t.setAlive(1);
  S.updateSpawners(st, 1, t.hooks);
  check('a freed slot lets the next interval spawn again',
    t.spawned.length === 1 && S.spawnedCount(st, 'g') === 1);
}
{
  const st = S.createSpawnerState();
  S.startSpawner(st, { name: 'g', template: 'goblin', x: 0, y: 0, interval: 1, maxAlive: 0, total: 2 });
  const t = stubHooks();
  S.updateSpawners(st, 1, t.hooks);
  S.updateSpawners(st, 1, t.hooks);
  check('a tick stops spawning once the total is reached',
    t.spawned.length === 2 && S.spawnedCount(st, 'g') === 2 &&
    S.spawnerActive(st, 'g') === false);
  check('reaching the total deactivates the record on the same tick the last one lands',
    S.spawnerOf(st, 'g').active === false,
    JSON.stringify(S.spawnerOf(st, 'g')));
  S.updateSpawners(st, 5, t.hooks);
  check('a finished spawner stays stopped on later ticks',
    t.spawned.length === 2);
}
{
  const st = S.createSpawnerState();
  S.startSpawner(st, { name: 'g', template: 'goblin', x: 0, y: 0, interval: 1, maxAlive: 0, total: 0 });
  const t = stubHooks({ spawnNull: true });
  S.updateSpawners(st, 1, t.hooks);
  check('a missing template spawns nothing and counts nothing, but retries next interval',
    t.spawned.length === 0 && S.spawnedCount(st, 'g') === 0);
  S.updateSpawners(st, 1, t.hooks);
  check('a missing template stays quiet on the retry too',
    t.spawned.length === 0);
}
{
  const st = S.createSpawnerState();
  S.startSpawner(st, { name: 'g', template: 'goblin', x: 0, y: 0, interval: 0.1, maxAlive: 0, total: 0 });
  const t = stubHooks();
  S.updateSpawners(st, 100, t.hooks);
  check('a long hitch spawns at most 25 per frame and banks the rest instead of a burst',
    t.spawned.length === 25 && S.spawnedCount(st, 'g') === 25 &&
    S.spawnerOf(st, 'g').timer > 0,
    JSON.stringify({ n: t.spawned.length, timer: S.spawnerOf(st, 'g').timer }));
}
{
  const st = S.createSpawnerState();
  S.startSpawner(st, { name: 'g', template: 'goblin', x: 0, y: 0, interval: 1 });
  S.updateSpawners(st, 1, null);
  S.updateSpawners(st, 1, {});
  S.updateSpawners(st, 1, { spawn: 'nope', findObject: 42, aliveCount: null });
  check('a tick with missing or hostile hooks stays quiet and never throws',
    S.spawnedCount(st, 'g') === 0);
  S.updateSpawners(st, -1, stubHooks().hooks);
  check('a tick with a negative dt ages nothing', S.spawnedCount(st, 'g') === 0);
  S.updateSpawners(null, 1, stubHooks().hooks);
  S.updateSpawners('nope', 1, stubHooks().hooks);
  check('a tick with a missing state stays quiet', true);
  const stopped = S.createSpawnerState();
  S.startSpawner(stopped, { name: 'g', template: 'goblin', interval: 1 });
  S.stopSpawner(stopped, 'g');
  const t2 = stubHooks();
  S.updateSpawners(stopped, 5, t2.hooks);
  check('a stopped spawner never ticks', t2.spawned.length === 0);
}

// --- routing ---
check('routing sets cover the three actions and two conditions',
  S.isSpawnAction('startSpawner') && S.isSpawnAction('stopSpawner') &&
  S.isSpawnAction('readSpawnedCount') &&
  !S.isSpawnAction('spawnerActive') && !S.isSpawnAction('spawnedCount') &&
  !S.isSpawnAction('setCheckpoint') && !S.isSpawnAction(null) &&
  S.isSpawnCondition('spawnerActive') && S.isSpawnCondition('spawnedCount') &&
  !S.isSpawnCondition('startSpawner') && !S.isSpawnCondition(null));

// --- hostile input ---
check('hostile input degrades to safe defaults',
  S.startSpawner('nope', { name: 'g', template: 'goblin' }) === null &&
  S.spawnerOf('nope', 'g') === null &&
  S.spawnerActive('nope', 'g') === false &&
  S.spawnedCount('nope', 'g') === 0 &&
  S.normalizeInterval([]) === 2 &&
  S.normalizeMaxAlive([]) === 10 &&
  S.normalizeTotal([]) === 0);

// --- static wiring ---
{
  const html = fs.readFileSync(path.join(HYDRA, 'index.html'), 'utf8');
  const spTag = html.indexOf('src="hydra-spawn.js');
  check('index.html loads hydra-spawn.js before player-runtime.js and script.js',
    spTag !== -1 && spTag < html.indexOf('src="player-runtime.js') && spTag < html.indexOf('src="script.js'));
  check('index.html loads hydra-spawn.js after hydra-respawn.js',
    spTag > html.indexOf('src="hydra-respawn.js'));
  const playerJs = fs.readFileSync(path.join(HYDRA, 'player-runtime.js'), 'utf8');
  check('player-runtime.js hard-guards on HydraSpawn',
    playerJs.includes("if (!HydraSpawn || typeof HydraSpawn.createSpawnerState !== 'function')") &&
    playerJs.includes('HydraScript player runtime requires hydra-spawn.js'));
  check('player-runtime.js inlines HydraSpawn into exports',
    playerJs.includes("'HydraSpawn', global.HydraSpawn && global.HydraSpawn.factorySource"));
  check('player-runtime.js classifies spawner blocks for the dispatch',
    playerJs.includes('HydraSpawn.isSpawnCondition(type)') &&
    playerJs.includes('HydraSpawn.isSpawnAction(type)'));
  check('player-runtime.js exposes the module to both contexts and ticks the spawners per frame',
    playerJs.includes('spawnModule: HydraSpawn') &&
    playerJs.includes('spawners: state.spawners') &&
    playerJs.includes('ensureSpawnerState: function ()') &&
    playerJs.includes('createSpawnerState: () => HydraSpawn.createSpawnerState()') &&
    playerJs.includes('HydraSpawn.updateSpawners(state.spawners, (state.dt || 0) / 60') &&
    playerJs.includes('HydraExecute.spawnObjectAt(actionCtx(state), template, x, y)'));
  const previewJs = fs.readFileSync(path.join(HYDRA, 'hydra-previewruntime.js'), 'utf8');
  check('preview runtime exposes the module to both contexts',
    (previewJs.match(/spawnModule: mod\('Spawn'\)/g) || []).length === 2 &&
    previewJs.includes('spawners: run ? run.spawners : null'));
  check('preview runtime resets the state per scene and ticks the spawners per frame',
    previewJs.includes('createSpawnerState: function () {') &&
    previewJs.includes("ensureSpawnerState: function () { return hostCall('ensurePreviewSpawnerState', [], null); }") &&
    previewJs.includes('SP.updateSpawners(r.spawners, dt / 60, {') &&
    previewJs.includes('Ex.spawnObjectAt(actionCtx(), template, x, y)'));
  const executeJs = fs.readFileSync(path.join(HYDRA, 'hydra-execute.js'), 'utf8');
  check('shared execute module runs the three spawner actions',
    executeJs.includes("if (isType(ctx.spawnModule, 'isSpawnAction', type))") &&
    executeJs.includes("type === 'startSpawner'") &&
    executeJs.includes("type === 'stopSpawner'") &&
    executeJs.includes("type === 'readSpawnedCount'") &&
    executeJs.includes('SM.startSpawner(spState, {') &&
    executeJs.includes('SM.stopAllSpawners(stpState)') &&
    executeJs.includes('SM.spawnedCount(rscState, data.name)') &&
    executeJs.includes('spawnObjectAt: spawnClone'));
  check('shared execute module returns the clone from spawnClone',
    executeJs.includes('var made = null;') &&
    executeJs.includes('made = cloneObj;') &&
    executeJs.includes('return made;'));
  const conditionsJs = fs.readFileSync(path.join(HYDRA, 'hydra-conditions.js'), 'utf8');
  check('shared conditions module reads Spawner Active and Spawned Count',
    conditionsJs.includes("case 'spawnerActive':") &&
    conditionsJs.includes("case 'spawnedCount':") &&
    conditionsJs.includes('SMm.spawnerActive(ctx.spawners, spName)') &&
    conditionsJs.includes('SMm2.spawnedCount(ctx.spawners, scName)'));
  check('shared conditions module does not freeze the spawner reads while paused',
    !conditionsJs.split('FROZEN_WHILE_PAUSED = [')[1].split('];')[0].includes('spawnerActive') &&
    !conditionsJs.split('FROZEN_WHILE_PAUSED = [')[1].split('];')[0].includes('spawnedCount'));
  const flowSb = {};
  flowSb.window = flowSb;
  vm.createContext(flowSb);
  vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-flow.js'), 'utf8'),
    flowSb, { filename: 'hydra-flow.js' });
  const F = flowSb.HydraFlow;
  check('flow module reads Spawner Active and Spawned Count as level triggers',
    F.defaultTriggerMode('spawnerActive') === 'level' &&
    F.defaultTriggerMode('spawnedCount') === 'level');
  const frameSb = {};
  frameSb.window = frameSb;
  vm.createContext(frameSb);
  vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-frame.js'), 'utf8'),
    frameSb, { filename: 'hydra-frame.js' });
  const FR = frameSb.HydraFrame;
  check('frame module runs updateSpawners last in the world sim, after updatePaths',
    FR.PHASES.indexOf('updateSpawners') > FR.PHASES.indexOf('updatePaths') &&
    FR.PHASES.indexOf('updateUiWidgets') > FR.PHASES.indexOf('updateSpawners'));
  const resetSb = {};
  resetSb.window = resetSb;
  vm.createContext(resetSb);
  vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-scenereset.js'), 'utf8'),
    resetSb, { filename: 'hydra-scenereset.js' });
  const SR = resetSb.HydraSceneReset;
  check('scene reset mints a fresh spawner state per scene load',
    (() => {
      const state = { spawners: { g: { name: 'g', active: true, spawned: 9 } } };
      let created = 0;
      const ok = SR.resetSceneRuntime(state, { id: 1 },
        { createSpawnerState: () => { created++; return { spawners: {} }; } });
      return ok === true && created === 1 && JSON.stringify(state.spawners) === JSON.stringify({ spawners: {} });
    })() &&
    (() => {
      const state = {};
      const ok = SR.resetSceneRuntime(state, { id: 1 }, {});
      return ok === true && state.spawners === null;
    })());
  const catalogJs = fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8');
  check('catalog carries the five spawner blocks in the Spawner category',
    catalogJs.includes("blockType: 'start-spawner'") &&
    catalogJs.includes("runtimeType: 'startSpawner'") &&
    catalogJs.includes("blockType: 'stop-spawner'") &&
    catalogJs.includes("runtimeType: 'stopSpawner'") &&
    catalogJs.includes("blockType: 'read-spawned-count'") &&
    catalogJs.includes("runtimeType: 'readSpawnedCount'") &&
    catalogJs.includes("blockType: 'spawner-active'") &&
    catalogJs.includes("runtimeType: 'spawnerActive'") &&
    catalogJs.includes("blockType: 'spawned-count'") &&
    catalogJs.includes("runtimeType: 'spawnedCount'") &&
    catalogJs.includes("key: 'templateObject', label: 'Spawn object'") &&
    catalogJs.includes("key: 'atObject', label: 'At object'") &&
    catalogJs.includes("key: 'interval', label: 'Every (seconds)'") &&
    catalogJs.includes("key: 'maxAlive', label: 'Max alive'") &&
    catalogJs.includes("key: 'total', label: 'Total to spawn'"));
  const scriptJs = fs.readFileSync(path.join(HYDRA, 'script.js'), 'utf8');
  check('editor wires the preview spawner state and hands its maker to the preview runtime host',
    scriptJs.includes('function ensurePreviewSpawnerState()') &&
    scriptJs.includes('ensurePreviewParticleState, ensurePreviewDamageNumberState, ensurePreviewRespawnState, ensurePreviewSpawnerState, ensurePreviewMovementState, ensurePreviewPlatformState, ensurePreviewCombatState, getPreviewBuses'));
  const refMd = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');
  check('block reference documents all five spawner blocks',
    refMd.includes('Start Spawner') && refMd.includes('Stop Spawner') &&
    refMd.includes('Read Spawned Count') && refMd.includes('Spawner Active') &&
    refMd.includes('Spawned Count'));
  const guideMd = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');
  check('user guide covers the enemy spawner',
    guideMd.includes('Spawner') && guideMd.includes('Start Spawner'));
}

process.exit(failures === 0 ? 0 : 1);
