// Unit tests for hydra/hydra-scaling.js — the shared enemy scaling
// system (P4 Advanced batch 32: enemy scaling with the hero's level,
// beginner edition).
//
// Pure logic: the per-run per-object level record (level + HP/damage
// per level), the derived bonuses, the writes with their health-bonus
// deltas, and the routing sets. Nothing here touches the DOM; both
// runtimes delegate to this module. Static checks at the end pin the
// wiring: catalog blocks, both runtimes' dispatch and the Enemy Level
// condition, the scene-reset survival (scaling outlives a scene
// switch, like growth and XP), and the docs.

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
sandbox.window = sandbox; // hydra-scaling.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-scaling.js'), 'utf8'),
  sandbox, { filename: 'hydra-scaling.js' });
const S = sandbox.HydraScaling;

check('HydraScaling exposed with helpers',
  !!S && typeof S.createScalingState === 'function' &&
  typeof S.scalingKeyOf === 'function' &&
  typeof S.normalizeLevel === 'function' &&
  typeof S.normalizeHpPerLevel === 'function' &&
  typeof S.normalizeDmgPerLevel === 'function' &&
  typeof S.levelOf === 'function' &&
  typeof S.hpPerLevelOf === 'function' &&
  typeof S.dmgPerLevelOf === 'function' &&
  typeof S.hpBonusOf === 'function' &&
  typeof S.dmgBonusOf === 'function' &&
  typeof S.setLevel === 'function' &&
  typeof S.setRates === 'function' &&
  typeof S.isScalingAction === 'function' &&
  typeof S.isScalingCondition === 'function');
check('factorySource is a non-empty string',
  typeof S.factorySource === 'string' && S.factorySource.length > 100 &&
  S.factorySource.includes('hydraScalingFactory'));

// --- state + keys + normalizers ---
check('createScalingState starts with no levels anywhere',
  JSON.stringify(S.createScalingState()) === JSON.stringify({ byId: {} }));
check('scalingKeyOf reads the object name, falls back to the id, and rejects blanks',
  S.scalingKeyOf({ name: 'goblin', id: 1 }) === 'goblin' &&
  S.scalingKeyOf({ name: '  goblin  ', id: 1 }) === 'goblin' &&
  S.scalingKeyOf({ name: '', id: 5 }) === '5' &&
  S.scalingKeyOf({ name: '', id: null }) === null &&
  S.scalingKeyOf({}) === null &&
  S.scalingKeyOf(null) === null &&
  S.scalingKeyOf('goblin') === 'goblin' &&
  S.scalingKeyOf('  ') === null);
check('normalizeLevel is a whole 1..999 with a 1 default (below 1 reads as 1)',
  S.normalizeLevel(1) === 1 && S.normalizeLevel(3) === 3 &&
  S.normalizeLevel(0) === 1 && S.normalizeLevel(-2) === 1 &&
  S.normalizeLevel(2000) === 999 &&
  S.normalizeLevel(2.7) === 2 && S.normalizeLevel('oops') === 1 &&
  S.normalizeLevel(null) === 1);
check('normalizeHpPerLevel is a whole 0..10000 with a 10 default (0 = no-op)',
  S.normalizeHpPerLevel(10) === 10 && S.normalizeHpPerLevel(0) === 0 &&
  S.normalizeHpPerLevel(-2) === 0 && S.normalizeHpPerLevel(20000) === 10000 &&
  S.normalizeHpPerLevel(2.7) === 2 && S.normalizeHpPerLevel('oops') === 10 &&
  S.normalizeHpPerLevel(null) === 10);
check('normalizeDmgPerLevel is a whole 0..10000 with a 2 default (0 = no-op)',
  S.normalizeDmgPerLevel(2) === 2 && S.normalizeDmgPerLevel(0) === 0 &&
  S.normalizeDmgPerLevel(-2) === 0 && S.normalizeDmgPerLevel(20000) === 10000 &&
  S.normalizeDmgPerLevel(1.9) === 1 && S.normalizeDmgPerLevel('oops') === 2 &&
  S.normalizeDmgPerLevel(null) === 2);

// --- reads ---
check('reads use the defaults on a fresh state, a missing state, and a blank key',
  S.levelOf(S.createScalingState(), 'goblin') === 1 &&
  S.hpPerLevelOf(S.createScalingState(), 'goblin') === 10 &&
  S.dmgPerLevelOf(S.createScalingState(), 'goblin') === 2 &&
  S.hpBonusOf(S.createScalingState(), 'goblin') === 0 &&
  S.dmgBonusOf(S.createScalingState(), 'goblin') === 0 &&
  S.levelOf(null, 'goblin') === 1 &&
  S.hpBonusOf('nope', 'goblin') === 0 &&
  S.dmgBonusOf(S.createScalingState(), '') === 0 &&
  S.levelOf({}, 'goblin') === 1);
check('reads accept the object itself (keyed by its name)',
  (() => {
    const st = S.createScalingState();
    S.setLevel(st, { name: 'goblin', id: 1 }, 3);
    return S.levelOf(st, { name: 'goblin', id: 9 }) === 3 &&
      S.hpBonusOf(st, { name: 'goblin', id: 9 }) === 20 &&
      S.dmgBonusOf(st, { name: 'goblin', id: 9 }) === 4;
  })());

// --- writes ---
{
  const st = S.createScalingState();
  check('setLevel to 3 returns the level, the bonuses, and the +20 health delta',
    JSON.stringify(S.setLevel(st, 'goblin', 3)) ===
      JSON.stringify({ level: 3, hpBonus: 20, dmgBonus: 4, hpDelta: 20 }));
  check('the bonuses follow the level (level 3 at the default rates is +20 HP, +4 damage)',
    S.levelOf(st, 'goblin') === 3 && S.hpBonusOf(st, 'goblin') === 20 &&
    S.dmgBonusOf(st, 'goblin') === 4);
  check('setting the same level again returns a zero delta',
    JSON.stringify(S.setLevel(st, 'goblin', 3)) ===
      JSON.stringify({ level: 3, hpBonus: 20, dmgBonus: 4, hpDelta: 0 }));
  check('lowering the level returns a negative delta',
    JSON.stringify(S.setLevel(st, 'goblin', 2)) ===
      JSON.stringify({ level: 2, hpBonus: 10, dmgBonus: 2, hpDelta: -10 }));
  check('setRates rewrites what one level is worth and returns the new delta',
    JSON.stringify(S.setRates(st, 'goblin', 50, 5)) ===
      JSON.stringify({ hpPerLevel: 50, dmgPerLevel: 5, hpBonus: 50, dmgBonus: 5, hpDelta: 40 }));
  check('rates are per object name (the hero is untouched by the goblin scaling)',
    S.levelOf(st, 'hero') === 1 && S.hpBonusOf(st, 'hero') === 0 &&
    S.dmgBonusOf(st, 'hero') === 0);
  check('two objects sharing a name share the level',
    S.setLevel(st, 'minion', 2).level === 2 &&
    S.levelOf(st, { name: 'minion', id: 99 }) === 2);
  check('a bad level reads as the default 1 (no scaling)',
    S.setLevel(st, 'ghost', 'oops').level === 1 &&
    S.hpBonusOf(st, 'ghost') === 0);
  check('a bad rate reads as the default (10 / 2)',
    S.setRates(st, 'ghost', 'oops', 'oops').hpPerLevel === 10 &&
    S.setRates(st, 'ghost', 'oops', 'oops').dmgPerLevel === 2);
  check('the health bonus caps at 10000 (level 999 at 50 HP per level)',
    S.setRates(st, 'boss', 50, 5) &&
    S.setLevel(st, 'boss', 999).hpBonus === 10000 &&
    S.setLevel(st, 'boss', 999).hpDelta === 0);
  check('the damage bonus caps at 10000 too',
    S.setRates(st, 'boss2', 10, 50) &&
    S.setLevel(st, 'boss2', 999).dmgBonus === 10000);
  check('zero rates are a legal no-op (a level-5 enemy with 0 rates gains nothing)',
    S.setRates(st, 'pebble', 0, 0) &&
    S.setLevel(st, 'pebble', 5).hpBonus === 0 &&
    S.dmgBonusOf(st, 'pebble') === 0);
}
check('writes stay quiet on a missing state or a blank key',
  S.setLevel(null, 'goblin', 3) === null &&
  S.setRates(null, 'goblin', 10, 2) === null &&
  S.setLevel(S.createScalingState(), '', 3) === null &&
  S.setRates('nope', 'goblin', 10, 2) === null);

// --- routing ---
check('routing sets cover the six scaling actions and the one scaling condition',
  S.isScalingAction('setEnemyLevel') && S.isScalingAction('setScalingRates') &&
  S.isScalingAction('scaleToHeroLevel') && S.isScalingAction('readEnemyLevel') &&
  S.isScalingAction('readScaledHpBonus') && S.isScalingAction('readScaledDmgBonus') &&
  !S.isScalingAction('growDamage') && !S.isScalingAction('meleeAttack') &&
  !S.isScalingAction('damageObject') && !S.isScalingAction(null) &&
  S.isScalingCondition('enemyLevel') && !S.isScalingCondition('level') &&
  !S.isScalingCondition('xp') && !S.isScalingCondition(null));

// --- hostile input ---
check('hostile input degrades to safe defaults',
  S.normalizeLevel([]) === 1 &&
  S.normalizeHpPerLevel([]) === 10 &&
  S.normalizeDmgPerLevel([]) === 2 &&
  S.levelOf({ byId: { goblin: { level: {} } } }, 'goblin') === 1 &&
  S.hpBonusOf({ byId: { goblin: { level: 3, hpPerLevel: [] } } }, 'goblin') === 20 &&
  S.dmgBonusOf({ byId: { goblin: { level: 3, dmgPerLevel: [] } } }, 'goblin') === 4 &&
  S.scalingKeyOf(42) === null &&
  S.setLevel({ byId: null }, 'goblin', 3) !== null);

// --- static wiring ---
{
  const html = fs.readFileSync(path.join(HYDRA, 'index.html'), 'utf8');
  const scalingTag = html.indexOf('src="hydra-scaling.js');
  check('index.html loads hydra-scaling.js before player-runtime.js and script.js',
    scalingTag !== -1 && scalingTag < html.indexOf('src="player-runtime.js') && scalingTag < html.indexOf('src="script.js'));
  check('index.html loads hydra-scaling.js after hydra-growth.js',
    scalingTag > html.indexOf('src="hydra-growth.js'));
  const playerJs = fs.readFileSync(path.join(HYDRA, 'player-runtime.js'), 'utf8');
  check('player-runtime.js hard-guards on HydraScaling',
    playerJs.includes("if (!HydraScaling || typeof HydraScaling.createScalingState !== 'function')") &&
    playerJs.includes('HydraScript player runtime requires hydra-scaling.js'));
  check('player-runtime.js inlines HydraScaling into exports',
    playerJs.includes("'HydraScaling', global.HydraScaling && global.HydraScaling.factorySource"));
  check('player-runtime.js classifies scaling blocks for the dispatch',
    playerJs.includes('HydraScaling.isScalingAction(type)') &&
    playerJs.includes('HydraScaling.isScalingCondition(type)'));
  check('player-runtime.js mints the scaling state at boot and exposes the module to both contexts',
    playerJs.includes('scaling: HydraScaling.createScalingState()') &&
    playerJs.includes('scalingModule: HydraScaling') &&
    playerJs.includes('scaling: state.scaling'));
  const previewJs = fs.readFileSync(path.join(HYDRA, 'hydra-previewruntime.js'), 'utf8');
  check('preview runtime exposes the module to both contexts',
    previewJs.includes("scalingModule: mod('Scaling')") &&
    previewJs.includes('scaling: scalingRuntime()'));
  check('preview runtime mints the scaling state lazily and resets it on a fresh run only',
    previewJs.includes('function scalingRuntime()') &&
    previewJs.includes('function resetScalingRuntime()') &&
    previewJs.includes('resetScalingRuntime();'));
  check('preview runtime never resets scaling on a scene switch (no scene-reset entry)',
    !previewJs.includes('createScalingState: function'));
  const executeJs = fs.readFileSync(path.join(HYDRA, 'hydra-execute.js'), 'utf8');
  check('shared execute module runs the six scaling actions',
    executeJs.includes("if (isType(ctx.scalingModule, 'isScalingAction', type))") &&
    executeJs.includes("type === 'setEnemyLevel'") &&
    executeJs.includes("type === 'setScalingRates'") &&
    executeJs.includes("type === 'scaleToHeroLevel'") &&
    executeJs.includes("type === 'readEnemyLevel'") &&
    executeJs.includes("type === 'readScaledHpBonus'") &&
    executeJs.includes("type === 'readScaledDmgBonus'") &&
    executeJs.includes('SC.setLevel(ctx.scaling, o, selv.value)') &&
    executeJs.includes('SC.setRates(ctx.scaling, o, srhp.value, srdmg.value)') &&
    executeJs.includes('SC.setLevel(ctx.scaling, o, heroLv)') &&
    executeJs.includes('SC.levelOf(ctx.scaling, relTargets[0])') &&
    executeJs.includes('SC.hpBonusOf(ctx.scaling, rshTargets[0])') &&
    executeJs.includes('SC.dmgBonusOf(ctx.scaling, rsdTargets[0])'));
  check('shared execute module adds the scaling damage bonus to melee and shots, stacked with growth',
    executeJs.includes("mav.value + growthBonusOf(ctx, 'damage', o) + scalingBonusOf(ctx, 'damage', o)") &&
    executeJs.includes("sdv.value + growthBonusOf(ctx, 'damage', o) + scalingBonusOf(ctx, 'damage', o)"));
  const condJs = fs.readFileSync(path.join(HYDRA, 'hydra-conditions.js'), 'utf8');
  check('shared conditions module evaluates the Enemy Level condition',
    condJs.includes("case 'enemyLevel':") &&
    condJs.includes('SCm.levelOf(ctx.scaling, o)'));
  const flowJs = fs.readFileSync(path.join(HYDRA, 'hydra-flow.js'), 'utf8');
  check('flow module defaults Enemy Level to the level trigger',
    flowJs.includes("t === 'enemyLevel'"));
  const resetSb = {};
  resetSb.window = resetSb;
  vm.createContext(resetSb);
  vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-scenereset.js'), 'utf8'),
    resetSb, { filename: 'hydra-scenereset.js' });
  const SR = resetSb.HydraSceneReset;
  check('scene reset leaves the scaling record untouched (scaling survives a scene switch)',
    (() => {
      const scaling = { byId: { goblin: { level: 3, hpPerLevel: 10, dmgPerLevel: 2 } } };
      const state = { scaling: scaling };
      const ok = SR.resetSceneRuntime(state, { id: 1 }, {});
      return ok === true && state.scaling === scaling &&
        state.scaling.byId.goblin.level === 3;
    })());
  const catalogJs = fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8');
  check('catalog carries the seven scaling blocks in the Scaling category',
    catalogJs.includes("blockType: 'set-enemy-level'") &&
    catalogJs.includes("runtimeType: 'setEnemyLevel'") &&
    catalogJs.includes("blockType: 'set-scaling-rates'") &&
    catalogJs.includes("runtimeType: 'setScalingRates'") &&
    catalogJs.includes("blockType: 'scale-to-hero-level'") &&
    catalogJs.includes("runtimeType: 'scaleToHeroLevel'") &&
    catalogJs.includes("blockType: 'read-enemy-level'") &&
    catalogJs.includes("runtimeType: 'readEnemyLevel'") &&
    catalogJs.includes("blockType: 'read-scaled-hp-bonus'") &&
    catalogJs.includes("runtimeType: 'readScaledHpBonus'") &&
    catalogJs.includes("blockType: 'read-scaled-dmg-bonus'") &&
    catalogJs.includes("runtimeType: 'readScaledDmgBonus'") &&
    catalogJs.includes("blockType: 'enemy-level'") &&
    catalogJs.includes("runtimeType: 'enemyLevel'") &&
    catalogJs.includes("key: 'level', label: 'Level'") &&
    catalogJs.includes("key: 'hpPerLevel', label: 'HP per level'") &&
    catalogJs.includes("key: 'dmgPerLevel', label: 'Damage per level'") &&
    catalogJs.includes("key: 'varName', label: 'Into variable'"));
  const refMd = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');
  check('block reference documents all seven scaling blocks',
    refMd.includes('Set Enemy Level') && refMd.includes('Set Scaling Rates') &&
    refMd.includes('Scale to Hero Level') && refMd.includes('Read Enemy Level') &&
    refMd.includes('Read Scaled HP Bonus') && refMd.includes('Read Scaled Damage Bonus') &&
    refMd.includes('Enemy Level') &&
    refMd.includes('### Scaling (7)'));
  const guideMd = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');
  check('user guide covers enemy scaling with the hero level',
    guideMd.includes('Enemy scaling') && guideMd.includes('Set Enemy Level') &&
    guideMd.includes('Scale to Hero Level'));
}

process.exit(failures === 0 ? 0 : 1);
