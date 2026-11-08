// Unit tests for hydra/hydra-boss.js — the shared boss encounters
// system (P4 Advanced batch 33: boss encounters, beginner edition).
//
// Pure logic: the per-run boss fight (boss name, phase count, bar
// visibility), the phase number derived live from the health fraction,
// the writes, the boss bar geometry + paint, and the routing sets.
// Nothing here touches the DOM; both runtimes delegate to this module.
// Static checks at the end pin the wiring: catalog blocks, both
// runtimes' dispatch and the Boss Phase / Boss Active conditions, the
// draw module's bar paint, the scene-reset survival (the fight
// outlives a scene switch, like scaling and XP), and the docs.

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
sandbox.window = sandbox; // hydra-boss.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-boss.js'), 'utf8'),
  sandbox, { filename: 'hydra-boss.js' });
const B = sandbox.HydraBoss;

check('HydraBoss exposed with helpers',
  !!B && typeof B.createBossState === 'function' &&
  typeof B.normalizePhaseCount === 'function' &&
  typeof B.isActive === 'function' &&
  typeof B.fractionOf === 'function' &&
  typeof B.phaseOf === 'function' &&
  typeof B.phaseOfState === 'function' &&
  typeof B.startBoss === 'function' &&
  typeof B.endBoss === 'function' &&
  typeof B.setBarVisible === 'function' &&
  typeof B.bossBarRect === 'function' &&
  typeof B.bossBarColor === 'function' &&
  typeof B.drawBossBar === 'function' &&
  typeof B.isBossAction === 'function' &&
  typeof B.isBossCondition === 'function');
check('factorySource is a non-empty string',
  typeof B.factorySource === 'string' && B.factorySource.length > 100 &&
  B.factorySource.includes('hydraBossFactory'));

// --- state + normalizers ---
check('createBossState starts with no fight running',
  JSON.stringify(B.createBossState()) ===
    JSON.stringify({ active: false, objectName: '', phases: 3, barVisible: false }));
check('normalizePhaseCount is a whole 2..5 with a 3 default (1 reads as 3)',
  B.normalizePhaseCount(3) === 3 && B.normalizePhaseCount(2) === 2 &&
  B.normalizePhaseCount(5) === 5 && B.normalizePhaseCount(1) === 3 &&
  B.normalizePhaseCount(0) === 3 && B.normalizePhaseCount(-2) === 3 &&
  B.normalizePhaseCount(9) === 5 &&
  B.normalizePhaseCount(2.7) === 2 && B.normalizePhaseCount('oops') === 3 &&
  B.normalizePhaseCount(null) === 3);

// --- reads ---
check('isActive is true only for an active fight with a named boss',
  B.isActive(B.createBossState()) === false &&
  B.isActive(null) === false &&
  B.isActive({ active: true, objectName: 'king' }) === true &&
  B.isActive({ active: true, objectName: '' }) === false &&
  B.isActive({ active: false, objectName: 'king' }) === false);
check('fractionOf reads the live health through the health module when given one',
  (() => {
    const HM = { healthFraction: (o) => o.health / o.maxHealth };
    return B.fractionOf({ health: 75, maxHealth: 100 }, HM) === 0.75 &&
      B.fractionOf({ health: 0, maxHealth: 100 }, HM) === 0 &&
      B.fractionOf({ health: 100, maxHealth: 100 }, HM) === 1;
  })());
check('fractionOf falls back to the raw health fields without a module, and null without an object',
  B.fractionOf({ health: 30, maxHealth: 120 }, null) === 0.25 &&
  B.fractionOf({ maxHealth: 100 }, null) === 1 &&
  B.fractionOf({ health: 50, maxHealth: 0 }, null) === 0.5 &&
  B.fractionOf(null, null) === null &&
  B.fractionOf('nope', null) === null);
check('phaseOf slices the bar into equal phases (3 phases: 1 down to 2/3, 2 to 1/3, 3 to the end)',
  B.phaseOf(1, 3) === 1 && B.phaseOf(0.99, 3) === 1 &&
  B.phaseOf(2 / 3, 3) === 1 && B.phaseOf(0.66, 3) === 2 &&
  B.phaseOf(0.5, 3) === 2 && B.phaseOf(1 / 3, 3) === 2 &&
  B.phaseOf(0.33, 3) === 3 && B.phaseOf(0.01, 3) === 3 &&
  B.phaseOf(0, 3) === 3);
check('phaseOf follows the phase count (2 phases split at half, 5 split in fifths)',
  B.phaseOf(0.75, 2) === 1 && B.phaseOf(0.49, 2) === 2 &&
  B.phaseOf(0.85, 5) === 1 && B.phaseOf(0.65, 5) === 2 &&
  B.phaseOf(0.45, 5) === 3 && B.phaseOf(0.25, 5) === 4 &&
  B.phaseOf(0.05, 5) === 5);
check('phaseOf reads 0 for a missing or non-finite fraction, and clamps out-of-range fractions',
  B.phaseOf(null, 3) === 0 && B.phaseOf(undefined, 3) === 0 &&
  B.phaseOf('oops', 3) === 0 && B.phaseOf(NaN, 3) === 0 &&
  B.phaseOf(1.5, 3) === 1 && B.phaseOf(-0.5, 3) === 3);
check('phaseOfState reads 0 with no fight running, else the slice the fraction sits in',
  (() => {
    const fresh = B.createBossState();
    const fighting = B.createBossState();
    B.startBoss(fighting, 'king', 3, true);
    return B.phaseOfState(fresh, 0.9) === 0 &&
      B.phaseOfState(null, 0.9) === 0 &&
      B.phaseOfState(fighting, 0.9) === 1 &&
      B.phaseOfState(fighting, 0.5) === 2 &&
      B.phaseOfState(fighting, 0.1) === 3 &&
      B.phaseOfState(fighting, null) === 0;
  })());

// --- writes ---
{
  const st = B.createBossState();
  check('startBoss records the name, the phase count, and shows the bar',
    JSON.stringify(B.startBoss(st, 'goblinKing', 3, true)) ===
      JSON.stringify({ active: true, objectName: 'goblinKing', phases: 3, barVisible: true }));
  check('the fight is active and reads phase 1 at full health',
    B.isActive(st) === true && B.phaseOfState(st, 1) === 1);
  check('startBoss with showBar false hides the bar but keeps the fight',
    JSON.stringify(B.startBoss(st, 'goblinKing', 3, false)) ===
      JSON.stringify({ active: true, objectName: 'goblinKing', phases: 3, barVisible: false }));
  check('setBarVisible toggles the bar without ending the fight',
    B.setBarVisible(st, true).barVisible === true &&
    B.setBarVisible(st, false).barVisible === false &&
    B.isActive(st) === true);
  check('starting a second boss replaces the first (one boss at a time)',
    JSON.stringify(B.startBoss(st, 'dragon', 5, true)) ===
      JSON.stringify({ active: true, objectName: 'dragon', phases: 5, barVisible: true }));
  check('endBoss clears the fight (bar hides, phase reads 0 again)',
    JSON.stringify(B.endBoss(st)) ===
      JSON.stringify({ active: false, objectName: '', phases: 5, barVisible: false }) &&
    B.isActive(st) === false && B.phaseOfState(st, 0.5) === 0);
  check('setBarVisible stays quiet with no fight running',
    B.setBarVisible(st, true).barVisible === false &&
    B.setBarVisible(st, true).active === false);
}
check('startBoss stays quiet on a missing state or a blank name',
  B.startBoss(null, 'king', 3, true) === null &&
  B.startBoss(B.createBossState(), '', 3, true) === null &&
  B.startBoss(B.createBossState(), '   ', 3, true) === null &&
  B.startBoss('nope', 'king', 3, true) === null);
check('startBoss trims the name and reads a bad phase count as the default 3',
  (() => {
    const st = B.createBossState();
    B.startBoss(st, '  king  ', 'oops', true);
    return st.objectName === 'king' && st.phases === 3;
  })());
check('endBoss and setBarVisible stay quiet on a missing state',
  B.endBoss(null) === null && B.setBarVisible(null, true) === null);

// --- boss bar geometry + color ---
check('bossBarRect centers a 60%-wide bar (capped at 560px) 24px from the top',
  JSON.stringify(B.bossBarRect(800, 600)) ===
    JSON.stringify({ x: 160, y: 24, w: 480, h: 18, labelY: 16 }) &&
  JSON.stringify(B.bossBarRect(1200, 600)) ===
    JSON.stringify({ x: 320, y: 24, w: 560, h: 18, labelY: 16 }) &&
  JSON.stringify(B.bossBarRect(400, 600)) ===
    JSON.stringify({ x: 80, y: 24, w: 240, h: 18, labelY: 16 }));
check('bossBarRect reads a zero-width view as no bar at all',
  B.bossBarRect(0, 600).w === 0 && B.bossBarRect(-50, 600).w === 0);
check('bossBarColor is green over half, amber over a quarter, red below',
  B.bossBarColor(1) === '#22c55e' && B.bossBarColor(0.51) === '#22c55e' &&
  B.bossBarColor(0.5) === '#f59e0b' && B.bossBarColor(0.26) === '#f59e0b' &&
  B.bossBarColor(0.25) === '#ef4444' && B.bossBarColor(0) === '#ef4444');

// --- boss bar paint (recording context) ---
function makeRecordingCtx() {
  const calls = [];
  return {
    calls: calls,
    save() { calls.push(['save']); },
    restore() { calls.push(['restore']); },
    fillRect(x, y, w, h) { calls.push(['fillRect', x, y, w, h, this.fillStyle]); },
    strokeRect(x, y, w, h) { calls.push(['strokeRect', x, y, w, h, this.strokeStyle]); },
    fillText(t, x, y) { calls.push(['fillText', t, x, y, this.fillStyle]); },
    fillStyle: '', strokeStyle: '', font: '', textAlign: ''
  };
}
{
  const ctx = makeRecordingCtx();
  check('drawBossBar paints the name, the dark background, the colored fill, and the border',
    B.drawBossBar(ctx, 'goblinKing', 0.5, 800, 600) === true &&
    ctx.calls.some(c => c[0] === 'fillText' && c[1] === 'goblinKing' && c[4] === '#ffffff') &&
    ctx.calls.some(c => c[0] === 'fillRect' && c[1] === 160 && c[2] === 24 && c[3] === 480 && c[5] === 'rgba(0,0,0,0.55)') &&
    ctx.calls.some(c => c[0] === 'fillRect' && c[3] === 240 && c[5] === '#f59e0b') &&
    ctx.calls.some(c => c[0] === 'strokeRect'));
  const full = makeRecordingCtx();
  B.drawBossBar(full, 'king', 1, 800, 600);
  check('a full-health boss fills the whole bar green',
    full.calls.some(c => c[0] === 'fillRect' && c[3] === 480 && c[5] === '#22c55e'));
  const hurt = makeRecordingCtx();
  B.drawBossBar(hurt, 'king', 0.1, 800, 600);
  check('a near-dead boss fills a tenth of the bar red',
    hurt.calls.some(c => c[0] === 'fillRect' && c[3] === 48 && c[5] === '#ef4444'));
}
check('drawBossBar stays quiet on a blank name, a missing fraction, or a view too narrow for a bar',
  B.drawBossBar(makeRecordingCtx(), '', 0.5, 800, 600) === false &&
  B.drawBossBar(makeRecordingCtx(), 'king', null, 800, 600) === false &&
  B.drawBossBar(makeRecordingCtx(), 'king', 0.5, 0, 600) === false &&
  B.drawBossBar(null, 'king', 0.5, 800, 600) === false &&
  B.drawBossBar({}, 'king', 0.5, 800, 600) === false);

// --- routing ---
check('routing sets cover the five boss actions and the two boss conditions',
  B.isBossAction('startBoss') && B.isBossAction('endBoss') &&
  B.isBossAction('showBossBar') && B.isBossAction('hideBossBar') &&
  B.isBossAction('readBossPhase') &&
  !B.isBossAction('damageObject') && !B.isBossAction('setEnemyLevel') &&
  !B.isBossAction(null) &&
  B.isBossCondition('bossPhase') && B.isBossCondition('bossActive') &&
  !B.isBossCondition('enemyLevel') && !B.isBossCondition('healthCheck') &&
  !B.isBossCondition(null));

// --- hostile input ---
check('hostile input degrades to safe defaults',
  B.normalizePhaseCount([]) === 3 &&
  B.phaseOf([], 3) === 0 &&
  B.fractionOf({ health: [], maxHealth: [] }, null) === 0 &&
  B.bossBarRect('oops', 'oops').w === 0 &&
  B.bossBarColor([]) === '#22c55e' &&
  B.startBoss({ active: 'yes', objectName: 42, phases: 'oops', barVisible: 'yes' }, 'king', 'oops', 'yes') !== null &&
  B.isActive({ active: 'yes', objectName: 'king' }) === false);

// --- static wiring ---
{
  const html = fs.readFileSync(path.join(HYDRA, 'index.html'), 'utf8');
  const bossTag = html.indexOf('src="hydra-boss.js');
  check('index.html loads hydra-boss.js before player-runtime.js and script.js',
    bossTag !== -1 && bossTag < html.indexOf('src="player-runtime.js') && bossTag < html.indexOf('src="script.js'));
  check('index.html loads hydra-boss.js after hydra-scaling.js',
    bossTag > html.indexOf('src="hydra-scaling.js'));
  const playerJs = fs.readFileSync(path.join(HYDRA, 'player-runtime.js'), 'utf8');
  check('player-runtime.js hard-guards on HydraBoss',
    playerJs.includes("if (!HydraBoss || typeof HydraBoss.createBossState !== 'function')") &&
    playerJs.includes('HydraScript player runtime requires hydra-boss.js'));
  check('player-runtime.js inlines HydraBoss into exports',
    playerJs.includes("'HydraBoss', global.HydraBoss && global.HydraBoss.factorySource"));
  check('player-runtime.js classifies boss blocks for the dispatch',
    playerJs.includes('HydraBoss.isBossAction(type)') &&
    playerJs.includes('HydraBoss.isBossCondition(type)'));
  check('player-runtime.js mints the boss state at boot and exposes the module to both contexts',
    playerJs.includes('boss: HydraBoss.createBossState()') &&
    playerJs.includes('bossModule: HydraBoss') &&
    playerJs.includes('boss: state.boss'));
  check('player-runtime.js passes the boss bar to the draw hooks',
    playerJs.includes('boss: HydraBoss,') &&
    playerJs.includes('bossState: state.boss,') &&
    playerJs.includes('bossObject: (name) => named(state, name)[0] || null'));
  const previewJs = fs.readFileSync(path.join(HYDRA, 'hydra-previewruntime.js'), 'utf8');
  check('preview runtime exposes the module to both contexts',
    previewJs.includes("bossModule: mod('Boss')") &&
    previewJs.includes('boss: bossRuntime()'));
  check('preview runtime mints the boss state lazily and resets it on a fresh run only',
    previewJs.includes('function bossRuntime()') &&
    previewJs.includes('function resetBossRuntime()') &&
    previewJs.includes('resetBossRuntime();'));
  check('preview runtime never resets the boss on a scene switch (no scene-reset entry)',
    !previewJs.includes('createBossState: function'));
  const scriptJs = fs.readFileSync(path.join(HYDRA, 'script.js'), 'utf8');
  check('editor draw hooks pass the boss module, live fight state, and live boss object',
    scriptJs.includes('boss: window.HydraBoss || null,') &&
    scriptJs.includes('bossRuntime') &&
    scriptJs.includes('bossObject: (name) => {'));
  const executeJs = fs.readFileSync(path.join(HYDRA, 'hydra-execute.js'), 'utf8');
  check('shared execute module runs the five boss actions',
    executeJs.includes("if (isType(ctx.bossModule, 'isBossAction', type))") &&
    executeJs.includes("type === 'startBoss'") &&
    executeJs.includes("type === 'endBoss'") &&
    executeJs.includes("type === 'showBossBar'") &&
    executeJs.includes("type === 'hideBossBar'") &&
    executeJs.includes("type === 'readBossPhase'") &&
    executeJs.includes('BO.startBoss(ctx.boss, sbName, sbPhases.value, data.showBar !== false)') &&
    executeJs.includes('BO.endBoss(ctx.boss)') &&
    executeJs.includes('BO.setBarVisible(ctx.boss, true)') &&
    executeJs.includes('BO.setBarVisible(ctx.boss, false)') &&
    executeJs.includes('BO.phaseOfState(ctx.boss, rbpFrac)'));
  const condJs = fs.readFileSync(path.join(HYDRA, 'hydra-conditions.js'), 'utf8');
  check('shared conditions module evaluates the Boss Phase and Boss Active conditions',
    condJs.includes("case 'bossPhase':") &&
    condJs.includes("case 'bossActive':") &&
    condJs.includes('BOm.phaseOfState(bpState, bpFrac)') &&
    condJs.includes('BAm.isActive(ctx.boss)'));
  const flowJs = fs.readFileSync(path.join(HYDRA, 'hydra-flow.js'), 'utf8');
  check('flow module defaults Boss Phase and Boss Active to the level trigger',
    flowJs.includes("t === 'bossPhase'") && flowJs.includes("t === 'bossActive'"));
  const drawJs = fs.readFileSync(path.join(HYDRA, 'hydra-draw.js'), 'utf8');
  check('shared draw module paints the boss bar above the HUD when the fight runs',
    drawJs.includes('bossMod.drawBossBar(ctx, bossState.objectName, bossFrac, width, height)') &&
    drawJs.includes('bossState.barVisible === true'));
  const resetSb = {};
  resetSb.window = resetSb;
  vm.createContext(resetSb);
  vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-scenereset.js'), 'utf8'),
    resetSb, { filename: 'hydra-scenereset.js' });
  const SR = resetSb.HydraSceneReset;
  check('scene reset leaves the boss fight untouched (the fight survives a scene switch)',
    (() => {
      const boss = { active: true, objectName: 'king', phases: 3, barVisible: true };
      const state = { boss: boss };
      const ok = SR.resetSceneRuntime(state, { id: 1 }, {});
      return ok === true && state.boss === boss &&
        state.boss.active === true && state.boss.objectName === 'king';
    })());
  const catalogJs = fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8');
  check('catalog carries the seven boss blocks in the Boss category',
    catalogJs.includes("blockType: 'start-boss'") &&
    catalogJs.includes("runtimeType: 'startBoss'") &&
    catalogJs.includes("blockType: 'end-boss'") &&
    catalogJs.includes("runtimeType: 'endBoss'") &&
    catalogJs.includes("blockType: 'show-boss-bar'") &&
    catalogJs.includes("runtimeType: 'showBossBar'") &&
    catalogJs.includes("blockType: 'hide-boss-bar'") &&
    catalogJs.includes("runtimeType: 'hideBossBar'") &&
    catalogJs.includes("blockType: 'read-boss-phase'") &&
    catalogJs.includes("runtimeType: 'readBossPhase'") &&
    catalogJs.includes("blockType: 'boss-phase'") &&
    catalogJs.includes("runtimeType: 'bossPhase'") &&
    catalogJs.includes("blockType: 'boss-active'") &&
    catalogJs.includes("runtimeType: 'bossActive'") &&
    catalogJs.includes("key: 'phases', label: 'Phases'") &&
    catalogJs.includes("key: 'showBar', label: 'Show bar'") &&
    catalogJs.includes("key: 'varName', label: 'Into variable'"));
  const refMd = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');
  check('block reference documents all seven boss blocks',
    refMd.includes('Start Boss') && refMd.includes('End Boss') &&
    refMd.includes('Show Boss Bar') && refMd.includes('Hide Boss Bar') &&
    refMd.includes('Read Boss Phase') && refMd.includes('Boss Phase') &&
    refMd.includes('Boss Active') &&
    refMd.includes('### Boss (7)'));
  const guideMd = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');
  check('user guide covers boss encounters',
    guideMd.includes('Boss encounters') && guideMd.includes('Start Boss') &&
    guideMd.includes('Boss Phase'));
}

process.exit(failures === 0 ? 0 : 1);
