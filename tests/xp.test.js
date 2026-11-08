// Unit tests for hydra/hydra-xp.js — the shared experience & leveling
// system (P4 Advanced batch 30: experience & leveling, beginner edition).
//
// Pure logic: the per-run XP total (add / set / read), the derived
// level, the consume-on-read Level Up check, and the routing sets.
// Nothing here touches the DOM; both runtimes delegate to this module.
// Static checks at the end pin the wiring: catalog blocks, both
// runtimes' dispatch, the flow trigger mode, the scene-reset survival
// (XP outlives a scene switch, like the lives count), and the docs.

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
sandbox.window = sandbox; // hydra-xp.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-xp.js'), 'utf8'),
  sandbox, { filename: 'hydra-xp.js' });
const X = sandbox.HydraXp;

check('HydraXp exposed with helpers',
  !!X && typeof X.createXpState === 'function' &&
  typeof X.normalizeXp === 'function' &&
  typeof X.normalizeXpAmount === 'function' &&
  typeof X.normalizeXpPerLevel === 'function' &&
  typeof X.xpOf === 'function' &&
  typeof X.xpPerLevelOf === 'function' &&
  typeof X.levelOf === 'function' &&
  typeof X.levelUp === 'function' &&
  typeof X.addXp === 'function' &&
  typeof X.setXp === 'function' &&
  typeof X.setXpPerLevel === 'function' &&
  typeof X.isXpAction === 'function' &&
  typeof X.isXpCondition === 'function');
check('factorySource is a non-empty string',
  typeof X.factorySource === 'string' && X.factorySource.length > 100 &&
  X.factorySource.includes('hydraXpFactory'));

// --- state + normalizers ---
check('createXpState starts with 0 XP, 100 XP per level, level 1 announced',
  JSON.stringify(X.createXpState()) === JSON.stringify({ xp: 0, xpPerLevel: 100, levelAnnounced: 1 }));
check('normalizeXp clamps to a whole 0..999999999 with a 0 default',
  X.normalizeXp(0) === 0 && X.normalizeXp(250) === 250 &&
  X.normalizeXp(-5) === 0 && X.normalizeXp(2000000000) === 999999999 &&
  X.normalizeXp(2.7) === 2 && X.normalizeXp('5') === 5 &&
  X.normalizeXp('oops') === 0 && X.normalizeXp(null) === 0 &&
  X.normalizeXp(undefined) === 0);
check('normalizeXpAmount is a whole 0..1000000 with a 10 default (0 = no-op)',
  X.normalizeXpAmount(10) === 10 && X.normalizeXpAmount(0) === 0 &&
  X.normalizeXpAmount(-2) === 0 && X.normalizeXpAmount(2000000) === 1000000 &&
  X.normalizeXpAmount(1.9) === 1 && X.normalizeXpAmount('oops') === 10 &&
  X.normalizeXpAmount(null) === 10);
check('normalizeXpPerLevel is a whole 1..100000 with a 100 default (0 reads as 1)',
  X.normalizeXpPerLevel(100) === 100 && X.normalizeXpPerLevel(0) === 1 &&
  X.normalizeXpPerLevel(-2) === 1 && X.normalizeXpPerLevel(200000) === 100000 &&
  X.normalizeXpPerLevel(50.9) === 50 && X.normalizeXpPerLevel('oops') === 100 &&
  X.normalizeXpPerLevel(null) === 100);

// --- reads ---
check('xpOf reads the total, and a missing state reads as the default 0',
  X.xpOf(X.createXpState()) === 0 &&
  X.xpOf(null) === 0 && X.xpOf('nope') === 0 &&
  X.xpOf({}) === 0 && X.xpOf({ xp: 250 }) === 250);
check('xpOf reads a negative total as 0 and a non-numeric total as 0',
  X.xpOf({ xp: -2 }) === 0 && X.xpOf({ xp: 'oops' }) === 0 &&
  X.xpOf({ xp: [] }) === 0);
check('xpPerLevelOf reads the cost, and a missing state reads as the default 100',
  X.xpPerLevelOf(X.createXpState()) === 100 &&
  X.xpPerLevelOf(null) === 100 && X.xpPerLevelOf({}) === 100 &&
  X.xpPerLevelOf({ xpPerLevel: 50 }) === 50 &&
  X.xpPerLevelOf({ xpPerLevel: 0 }) === 1 &&
  X.xpPerLevelOf({ xpPerLevel: 'oops' }) === 100);
check('levelOf derives the level from the total and the per-level cost',
  X.levelOf(X.createXpState()) === 1 &&
  X.levelOf({ xp: 99, xpPerLevel: 100, levelAnnounced: 1 }) === 1 &&
  X.levelOf({ xp: 100, xpPerLevel: 100, levelAnnounced: 1 }) === 2 &&
  X.levelOf({ xp: 250, xpPerLevel: 100, levelAnnounced: 1 }) === 3 &&
  X.levelOf({ xp: 49, xpPerLevel: 50, levelAnnounced: 1 }) === 1 &&
  X.levelOf({ xp: 50, xpPerLevel: 50, levelAnnounced: 1 }) === 2 &&
  X.levelOf(null) === 1 && X.levelOf({}) === 1);

// --- level up (consume-on-read) ---
{
  const st = X.createXpState();
  check('levelUp is false on a fresh state',
    X.levelUp(st) === false);
  check('levelUp fires once when Add XP crosses the threshold',
    X.addXp(st, 100) === 100 && X.levelUp(st) === true);
  check('levelUp reads false right after it fires (consumed)',
    X.levelUp(st) === false);
  check('levelUp fires again on the next level',
    X.addXp(st, 100) === 200 && X.levelUp(st) === true &&
    X.levelUp(st) === false);
  check('levelUp fires once for a multi-level jump, not once per level',
    X.addXp(st, 500) === 700 && X.levelUp(st) === true &&
    X.levelUp(st) === false && X.levelOf(st) === 8);
  check('lowering XP below the announced level never re-fires',
    X.setXp(st, 0) === 0 && X.levelUp(st) === false &&
    X.setXp(st, 650) === 650 && X.levelUp(st) === false);
  check('climbing past the announced level fires again',
    // Announced is 8 after the multi-level jump; 750 XP is level 8,
    // merely equal to it, so it stays quiet — climbing PAST it means
    // level 9, which starts at 800 XP.
    X.setXp(st, 750) === 750 && X.levelUp(st) === false &&
    X.setXp(st, 800) === 800 && X.levelUp(st) === true);
  check('a state with no announced level treats its level as announced (no spurious fire)',
    X.levelUp({ xp: 250, xpPerLevel: 100 }) === false);
  check('levelUp stays quiet on a missing state',
    X.levelUp(null) === false && X.levelUp('nope') === false);
}

// --- writes ---
{
  const st = X.createXpState();
  check('addXp tops the total up and returns it',
    X.addXp(st, 10) === 10 && X.xpOf(st) === 10);
  check('addXp clamps at 999999999',
    // One call can add at most 1000000 (the amount cap), so the
    // total clamp only bites near the cap: seed just below it.
    X.setXp(st, 999500000) === 999500000 &&
    X.addXp(st, 1000000) === 999999999 && X.xpOf(st) === 999999999);
  check('addXp with a bad amount reads as the default 10',
    X.setXp(st, 0) === 0 && X.addXp(st, 'oops') === 10);
  check('setXp writes the total and returns it',
    X.setXp(st, 250) === 250 && X.xpOf(st) === 250 &&
    X.levelOf(st) === 3);
  check('setXp clamps to 0..999999999',
    X.setXp(st, 2000000000) === 999999999 && X.setXp(st, -3) === 0 &&
    X.xpOf(st) === 0);
  check('setXp reads a bad value as the default 0',
    X.setXp(st, 'oops') === 0 && X.setXp(st, null) === 0);
  check('setXpPerLevel rewrites the cost and re-levels at once',
    X.setXp(st, 250) === 250 && X.setXpPerLevel(st, 50) === 50 &&
    X.levelOf(st) === 6);
  check('setXpPerLevel clamps to 1..100000',
    X.setXpPerLevel(st, 0) === 1 && X.setXpPerLevel(st, 200000) === 100000);
}
check('writes stay quiet on a missing state',
  X.addXp(null, 10) === null && X.setXp(null, 5) === null &&
  X.setXpPerLevel(null, 50) === null && X.addXp('nope', 10) === null);

// --- routing ---
check('routing sets cover the five actions and three conditions',
  X.isXpAction('addXp') && X.isXpAction('setXp') &&
  X.isXpAction('setXpPerLevel') && X.isXpAction('readXp') &&
  X.isXpAction('readLevel') &&
  !X.isXpAction('xp') && !X.isXpAction('level') && !X.isXpAction('levelUp') &&
  !X.isXpAction('setLives') && !X.isXpAction(null) &&
  X.isXpCondition('xp') && X.isXpCondition('level') &&
  X.isXpCondition('levelUp') &&
  !X.isXpCondition('addXp') && !X.isXpCondition(null));

// --- hostile input ---
check('hostile input degrades to safe defaults',
  X.normalizeXp([]) === 0 &&
  X.normalizeXpAmount([]) === 10 &&
  X.normalizeXpPerLevel([]) === 100 &&
  X.xpOf({ xp: {} }) === 0 &&
  X.levelOf({}) === 1 &&
  X.levelUp({}) === false);

// --- static wiring ---
{
  const html = fs.readFileSync(path.join(HYDRA, 'index.html'), 'utf8');
  const xpTag = html.indexOf('src="hydra-xp.js');
  check('index.html loads hydra-xp.js before player-runtime.js and script.js',
    xpTag !== -1 && xpTag < html.indexOf('src="player-runtime.js') && xpTag < html.indexOf('src="script.js'));
  check('index.html loads hydra-xp.js after hydra-combat.js',
    xpTag > html.indexOf('src="hydra-combat.js'));
  const playerJs = fs.readFileSync(path.join(HYDRA, 'player-runtime.js'), 'utf8');
  check('player-runtime.js hard-guards on HydraXp',
    playerJs.includes("if (!HydraXp || typeof HydraXp.createXpState !== 'function')") &&
    playerJs.includes('HydraScript player runtime requires hydra-xp.js'));
  check('player-runtime.js inlines HydraXp into exports',
    playerJs.includes("'HydraXp', global.HydraXp && global.HydraXp.factorySource"));
  check('player-runtime.js classifies XP blocks for the dispatch',
    playerJs.includes('HydraXp.isXpCondition(type)') &&
    playerJs.includes('HydraXp.isXpAction(type)'));
  check('player-runtime.js mints the XP state at boot and exposes the module to both contexts',
    playerJs.includes('xp: HydraXp.createXpState()') &&
    playerJs.includes('xpModule: HydraXp') &&
    playerJs.includes('xp: state.xp'));
  const previewJs = fs.readFileSync(path.join(HYDRA, 'hydra-previewruntime.js'), 'utf8');
  check('preview runtime exposes the module to both contexts',
    (previewJs.match(/xpModule: mod\('Xp'\)/g) || []).length === 2 &&
    previewJs.includes('xp: xpRuntime()'));
  check('preview runtime mints the XP state lazily and resets it on a fresh run only',
    previewJs.includes('function xpRuntime()') &&
    previewJs.includes('function resetXpRuntime()') &&
    previewJs.includes('resetXpRuntime();'));
  check('preview runtime never resets XP on a scene switch (no scene-reset entry)',
    !previewJs.includes('createXpState: function'));
  const executeJs = fs.readFileSync(path.join(HYDRA, 'hydra-execute.js'), 'utf8');
  check('shared execute module runs the five XP actions',
    executeJs.includes("if (isType(ctx.xpModule, 'isXpAction', type))") &&
    executeJs.includes("type === 'addXp'") &&
    executeJs.includes("type === 'setXp'") &&
    executeJs.includes("type === 'setXpPerLevel'") &&
    executeJs.includes("type === 'readXp'") &&
    executeJs.includes("type === 'readLevel'") &&
    executeJs.includes('XP.addXp(ctx.xp, axv.value)') &&
    executeJs.includes('XP.setXp(ctx.xp, sxv.value)') &&
    executeJs.includes('XP.setXpPerLevel(ctx.xp, spv.value)') &&
    executeJs.includes('XP.xpOf(ctx.xp)') &&
    executeJs.includes('XP.levelOf(ctx.xp)'));
  const conditionsJs = fs.readFileSync(path.join(HYDRA, 'hydra-conditions.js'), 'utf8');
  check('shared conditions module reads XP, Level, and Level Up',
    conditionsJs.includes("case 'xp':") &&
    conditionsJs.includes("case 'level':") &&
    conditionsJs.includes("case 'levelUp':") &&
    conditionsJs.includes('XMm.xpOf(ctx.xp)') &&
    conditionsJs.includes('XMm2.levelOf(ctx.xp)') &&
    conditionsJs.includes('XMm3.levelUp(ctx.xp)'));
  check('shared conditions module does not freeze the XP reads while paused',
    !conditionsJs.split('FROZEN_WHILE_PAUSED = [')[1].split('];')[0].includes("'xp'") &&
    !conditionsJs.split('FROZEN_WHILE_PAUSED = [')[1].split('];')[0].includes('level'));
  const flowSb = {};
  flowSb.window = flowSb;
  vm.createContext(flowSb);
  vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-flow.js'), 'utf8'),
    flowSb, { filename: 'hydra-flow.js' });
  const F = flowSb.HydraFlow;
  check('flow module reads XP and Level as level triggers and Level Up as an edge trigger',
    F.defaultTriggerMode('xp') === 'level' &&
    F.defaultTriggerMode('level') === 'level' &&
    F.defaultTriggerMode('levelUp') === 'edge');
  const resetSb = {};
  resetSb.window = resetSb;
  vm.createContext(resetSb);
  vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-scenereset.js'), 'utf8'),
    resetSb, { filename: 'hydra-scenereset.js' });
  const SR = resetSb.HydraSceneReset;
  check('scene reset leaves the XP record untouched (XP survives a scene switch)',
    (() => {
      const xp = { xp: 250, xpPerLevel: 100, levelAnnounced: 3 };
      const state = { xp: xp };
      const ok = SR.resetSceneRuntime(state, { id: 1 }, {});
      return ok === true && state.xp === xp && state.xp.xp === 250;
    })() &&
    (() => {
      // Even with every hook wired, no hook rewrites the XP record.
      const xp = { xp: 10, xpPerLevel: 100, levelAnnounced: 1 };
      const state = { xp: xp };
      const ok = SR.resetSceneRuntime(state, { id: 2 }, {
        createParticleState: () => ({ particles: [] }),
        createDamageNumbers: () => ({ numbers: [] }),
        createRespawnState: () => ({ point: null, count: 0 }),
        createSpawnerState: () => ({ spawners: {} })
      });
      return ok === true && state.xp === xp && state.xp.xp === 10;
    })());
  const catalogJs = fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8');
  check('catalog carries the eight XP blocks in the XP category',
    catalogJs.includes("blockType: 'add-xp'") &&
    catalogJs.includes("runtimeType: 'addXp'") &&
    catalogJs.includes("blockType: 'set-xp'") &&
    catalogJs.includes("runtimeType: 'setXp'") &&
    catalogJs.includes("blockType: 'set-xp-per-level'") &&
    catalogJs.includes("runtimeType: 'setXpPerLevel'") &&
    catalogJs.includes("blockType: 'read-xp'") &&
    catalogJs.includes("runtimeType: 'readXp'") &&
    catalogJs.includes("blockType: 'read-level'") &&
    catalogJs.includes("runtimeType: 'readLevel'") &&
    catalogJs.includes("blockType: 'xp'") &&
    catalogJs.includes("runtimeType: 'xp'") &&
    catalogJs.includes("blockType: 'level'") &&
    catalogJs.includes("runtimeType: 'level'") &&
    catalogJs.includes("blockType: 'level-up'") &&
    catalogJs.includes("runtimeType: 'levelUp'") &&
    catalogJs.includes("key: 'xp', label: 'XP'") &&
    catalogJs.includes("key: 'amount', label: 'Amount'") &&
    catalogJs.includes("key: 'varName', label: 'Into variable'"));
  const refMd = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');
  check('block reference documents all eight XP blocks',
    refMd.includes('Add XP') && refMd.includes('Set XP') &&
    refMd.includes('Set XP Per Level') && refMd.includes('Read XP') &&
    refMd.includes('Read Level') && refMd.includes('Level Up') &&
    refMd.includes('### XP (8)'));
  const guideMd = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');
  check('user guide covers experience and leveling',
    guideMd.includes('Experience and leveling') && guideMd.includes('Level Up') &&
    guideMd.includes('Add XP'));
}

process.exit(failures === 0 ? 0 : 1);
