// Unit tests for hydra/hydra-growth.js — the shared level-up rewards &
// stat growth system (P4 Advanced batch 31: level-up rewards & stat
// growth, beginner edition).
//
// Pure logic: the per-run per-object bonus record (max health, damage,
// speed), the Level Reward bundles, and the routing set. Nothing here
// touches the DOM; both runtimes delegate to this module. Static
// checks at the end pin the wiring: catalog blocks, both runtimes'
// dispatch, the scene-reset survival (growth outlives a scene switch,
// like the XP total), and the docs.

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
sandbox.window = sandbox; // hydra-growth.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-growth.js'), 'utf8'),
  sandbox, { filename: 'hydra-growth.js' });
const G = sandbox.HydraGrowth;

check('HydraGrowth exposed with helpers',
  !!G && typeof G.createGrowthState === 'function' &&
  typeof G.growthKeyOf === 'function' &&
  typeof G.normalizeMaxHealthAmount === 'function' &&
  typeof G.normalizeDamageAmount === 'function' &&
  typeof G.normalizeSpeedAmount === 'function' &&
  typeof G.maxHealthBonusOf === 'function' &&
  typeof G.damageBonusOf === 'function' &&
  typeof G.speedBonusOf === 'function' &&
  typeof G.addMaxHealthBonus === 'function' &&
  typeof G.addDamageBonus === 'function' &&
  typeof G.addSpeedBonus === 'function' &&
  typeof G.rewardBundle === 'function' &&
  typeof G.applyReward === 'function' &&
  typeof G.isGrowthAction === 'function');
check('factorySource is a non-empty string',
  typeof G.factorySource === 'string' && G.factorySource.length > 100 &&
  G.factorySource.includes('hydraGrowthFactory'));

// --- state + keys + normalizers ---
check('createGrowthState starts with no bonuses anywhere',
  JSON.stringify(G.createGrowthState()) === JSON.stringify({ byId: {} }));
check('growthKeyOf reads the object name, falls back to the id, and rejects blanks',
  G.growthKeyOf({ name: 'hero', id: 1 }) === 'hero' &&
  G.growthKeyOf({ name: '  hero  ', id: 1 }) === 'hero' &&
  G.growthKeyOf({ name: '', id: 5 }) === '5' &&
  G.growthKeyOf({ name: '', id: null }) === null &&
  G.growthKeyOf({}) === null &&
  G.growthKeyOf(null) === null &&
  G.growthKeyOf('hero') === 'hero' &&
  G.growthKeyOf('  ') === null);
check('normalizeMaxHealthAmount is a whole 0..10000 with a 10 default (0 = no-op)',
  G.normalizeMaxHealthAmount(10) === 10 && G.normalizeMaxHealthAmount(0) === 0 &&
  G.normalizeMaxHealthAmount(-2) === 0 && G.normalizeMaxHealthAmount(20000) === 10000 &&
  G.normalizeMaxHealthAmount(2.7) === 2 && G.normalizeMaxHealthAmount('oops') === 10 &&
  G.normalizeMaxHealthAmount(null) === 10);
check('normalizeDamageAmount is a whole 0..10000 with a 2 default (0 = no-op)',
  G.normalizeDamageAmount(2) === 2 && G.normalizeDamageAmount(0) === 0 &&
  G.normalizeDamageAmount(-2) === 0 && G.normalizeDamageAmount(20000) === 10000 &&
  G.normalizeDamageAmount(1.9) === 1 && G.normalizeDamageAmount('oops') === 2 &&
  G.normalizeDamageAmount(null) === 2);
check('normalizeSpeedAmount is a whole 0..5000 with a 50 default (0 = no-op)',
  G.normalizeSpeedAmount(50) === 50 && G.normalizeSpeedAmount(0) === 0 &&
  G.normalizeSpeedAmount(-2) === 0 && G.normalizeSpeedAmount(9000) === 5000 &&
  G.normalizeSpeedAmount(2.7) === 2 && G.normalizeSpeedAmount('oops') === 50 &&
  G.normalizeSpeedAmount(null) === 50);

// --- reads ---
check('bonuses read 0 on a fresh state, a missing state, and a blank key',
  G.maxHealthBonusOf(G.createGrowthState(), 'hero') === 0 &&
  G.damageBonusOf(G.createGrowthState(), 'hero') === 0 &&
  G.speedBonusOf(G.createGrowthState(), 'hero') === 0 &&
  G.maxHealthBonusOf(null, 'hero') === 0 &&
  G.damageBonusOf('nope', 'hero') === 0 &&
  G.speedBonusOf(G.createGrowthState(), '') === 0 &&
  G.maxHealthBonusOf({}, 'hero') === 0);
check('reads accept the object itself (keyed by its name)',
  (() => {
    const st = G.createGrowthState();
    G.addDamageBonus(st, { name: 'hero', id: 1 }, 5);
    return G.damageBonusOf(st, { name: 'hero', id: 9 }) === 5;
  })());

// --- writes ---
{
  const st = G.createGrowthState();
  check('addMaxHealthBonus grows the ledger and returns it',
    G.addMaxHealthBonus(st, 'hero', 10) === 10 && G.maxHealthBonusOf(st, 'hero') === 10);
  check('addDamageBonus grows the ledger and returns it',
    G.addDamageBonus(st, 'hero', 2) === 2 && G.damageBonusOf(st, 'hero') === 2);
  check('addSpeedBonus grows the ledger and returns it',
    G.addSpeedBonus(st, 'hero', 50) === 50 && G.speedBonusOf(st, 'hero') === 50);
  check('bonuses stack across calls (two level-ups, +2 each, is +4)',
    G.addDamageBonus(st, 'hero', 2) === 4 && G.damageBonusOf(st, 'hero') === 4);
  check('bonuses are per object name (the enemy is untouched by the hero growth)',
    G.maxHealthBonusOf(st, 'enemy') === 0 && G.damageBonusOf(st, 'enemy') === 0 &&
    G.speedBonusOf(st, 'enemy') === 0);
  check('two objects sharing a name share the bonus',
    G.addDamageBonus(st, 'enemy', 3) === 3 &&
    G.damageBonusOf(st, { name: 'enemy', id: 99 }) === 3);
  check('a bad amount reads as the default (10 / 2 / 50)',
    G.addMaxHealthBonus(st, 'hero', 'oops') === 20 &&
    G.addDamageBonus(st, 'hero', 'oops') === 6 &&
    G.addSpeedBonus(st, 'hero', 'oops') === 100);
  check('a zero amount is a no-op that still mints the record',
    G.addDamageBonus(st, 'ghost', 0) === 0 && G.damageBonusOf(st, 'ghost') === 0);
  check('the damage bonus caps at 10000',
    G.addDamageBonus(st, 'boss', 20000) === 10000 &&
    G.addDamageBonus(st, 'boss', 5) === 10000);
  check('the max-health bonus caps at 10000',
    G.addMaxHealthBonus(st, 'boss', 20000) === 10000);
  check('the speed bonus caps at 2000, the fastest dash',
    G.addSpeedBonus(st, 'boss', 5000) === 2000 &&
    G.addSpeedBonus(st, 'boss', 50) === 2000);
}
check('writes stay quiet on a missing state or a blank key',
  G.addMaxHealthBonus(null, 'hero', 10) === null &&
  G.addDamageBonus(null, 'hero', 2) === null &&
  G.addSpeedBonus(null, 'hero', 50) === null &&
  G.addMaxHealthBonus(G.createGrowthState(), '', 10) === null &&
  G.addDamageBonus('nope', 'hero', 2) === null);

// --- reward bundles ---
check('rewardBundle returns the four bundles with their amounts',
  JSON.stringify(G.rewardBundle('balanced')) === JSON.stringify({ maxHealth: 10, heal: 10, damage: 2, speed: 0 }) &&
  JSON.stringify(G.rewardBundle('tank')) === JSON.stringify({ maxHealth: 20, heal: 20, damage: 0, speed: 0 }) &&
  JSON.stringify(G.rewardBundle('striker')) === JSON.stringify({ maxHealth: 0, heal: 0, damage: 5, speed: 0 }) &&
  JSON.stringify(G.rewardBundle('swift')) === JSON.stringify({ maxHealth: 0, heal: 0, damage: 0, speed: 50 }));
check('rewardBundle matches case-insensitively and trims',
  G.rewardBundle('Balanced') !== null && G.rewardBundle('  TANK  ') !== null);
check('rewardBundle returns null for an unknown bundle',
  G.rewardBundle('mega') === null && G.rewardBundle('') === null &&
  G.rewardBundle(null) === null);
check('rewardBundle returns a fresh copy (mutating it never changes the next read)',
  (() => {
    const b = G.rewardBundle('balanced');
    b.damage = 99;
    return G.rewardBundle('balanced').damage === 2;
  })());
{
  const st = G.createGrowthState();
  check('applyReward applies the Balanced bundle through the writers and returns the applied amounts',
    JSON.stringify(G.applyReward(st, 'hero', 'balanced')) === JSON.stringify({ maxHealth: 10, heal: 10, damage: 2, speed: 0 }) &&
    G.maxHealthBonusOf(st, 'hero') === 10 && G.damageBonusOf(st, 'hero') === 2 &&
    G.speedBonusOf(st, 'hero') === 0);
  check('applyReward stacks a second bundle on top of the first',
    JSON.stringify(G.applyReward(st, 'hero', 'tank')) === JSON.stringify({ maxHealth: 20, heal: 20, damage: 0, speed: 0 }) &&
    G.maxHealthBonusOf(st, 'hero') === 30 && G.damageBonusOf(st, 'hero') === 2);
  check('applyReward applies Striker (damage only) and Swift (speed only)',
    G.applyReward(st, 'hero', 'striker').damage === 5 &&
    G.damageBonusOf(st, 'hero') === 7 &&
    G.applyReward(st, 'hero', 'swift').speed === 50 &&
    G.speedBonusOf(st, 'hero') === 50);
  check('applyReward returns null for an unknown bundle and changes nothing',
    G.applyReward(st, 'hero', 'mega') === null &&
    G.maxHealthBonusOf(st, 'hero') === 30 && G.damageBonusOf(st, 'hero') === 7);
  check('applyReward stays quiet on a missing state or a blank key',
    G.applyReward(null, 'hero', 'balanced') === null &&
    G.applyReward(st, '', 'balanced') === null);
}

// --- routing ---
check('routing set covers the seven growth actions',
  G.isGrowthAction('growMaxHealth') && G.isGrowthAction('growDamage') &&
  G.isGrowthAction('growSpeed') && G.isGrowthAction('levelReward') &&
  G.isGrowthAction('readMaxHealthBonus') && G.isGrowthAction('readDamageBonus') &&
  G.isGrowthAction('readSpeedBonus') &&
  !G.isGrowthAction('addXp') && !G.isGrowthAction('meleeAttack') &&
  !G.isGrowthAction('damageObject') && !G.isGrowthAction(null));

// --- hostile input ---
check('hostile input degrades to safe defaults',
  G.normalizeMaxHealthAmount([]) === 10 &&
  G.normalizeDamageAmount([]) === 2 &&
  G.normalizeSpeedAmount([]) === 50 &&
  G.maxHealthBonusOf({ byId: { hero: { maxHealth: {} } } }, 'hero') === 0 &&
  G.damageBonusOf({ byId: { hero: { damage: [] } } }, 'hero') === 0 &&
  G.growthKeyOf(42) === null &&
  G.rewardBundle({}) === null);

// --- static wiring ---
{
  const html = fs.readFileSync(path.join(HYDRA, 'index.html'), 'utf8');
  const growthTag = html.indexOf('src="hydra-growth.js');
  check('index.html loads hydra-growth.js before player-runtime.js and script.js',
    growthTag !== -1 && growthTag < html.indexOf('src="player-runtime.js') && growthTag < html.indexOf('src="script.js'));
  check('index.html loads hydra-growth.js after hydra-xp.js',
    growthTag > html.indexOf('src="hydra-xp.js'));
  const playerJs = fs.readFileSync(path.join(HYDRA, 'player-runtime.js'), 'utf8');
  check('player-runtime.js hard-guards on HydraGrowth',
    playerJs.includes("if (!HydraGrowth || typeof HydraGrowth.createGrowthState !== 'function')") &&
    playerJs.includes('HydraScript player runtime requires hydra-growth.js'));
  check('player-runtime.js inlines HydraGrowth into exports',
    playerJs.includes("'HydraGrowth', global.HydraGrowth && global.HydraGrowth.factorySource"));
  check('player-runtime.js classifies growth blocks for the dispatch',
    playerJs.includes('HydraGrowth.isGrowthAction(type)'));
  check('player-runtime.js mints the growth state at boot and exposes the module to the action context',
    playerJs.includes('growth: HydraGrowth.createGrowthState()') &&
    playerJs.includes('growthModule: HydraGrowth') &&
    playerJs.includes('growth: state.growth'));
  const previewJs = fs.readFileSync(path.join(HYDRA, 'hydra-previewruntime.js'), 'utf8');
  check('preview runtime exposes the module to the action context',
    previewJs.includes('growthModule: mod(\'Growth\')') &&
    previewJs.includes('growth: growthRuntime()'));
  check('preview runtime mints the growth state lazily and resets it on a fresh run only',
    previewJs.includes('function growthRuntime()') &&
    previewJs.includes('function resetGrowthRuntime()') &&
    previewJs.includes('resetGrowthRuntime();'));
  check('preview runtime never resets growth on a scene switch (no scene-reset entry)',
    !previewJs.includes('createGrowthState: function'));
  const executeJs = fs.readFileSync(path.join(HYDRA, 'hydra-execute.js'), 'utf8');
  check('shared execute module runs the seven growth actions',
    executeJs.includes("if (isType(ctx.growthModule, 'isGrowthAction', type))") &&
    executeJs.includes("type === 'growMaxHealth'") &&
    executeJs.includes("type === 'growDamage'") &&
    executeJs.includes("type === 'growSpeed'") &&
    executeJs.includes("type === 'levelReward'") &&
    executeJs.includes("type === 'readMaxHealthBonus'") &&
    executeJs.includes("type === 'readDamageBonus'") &&
    executeJs.includes("type === 'readSpeedBonus'") &&
    executeJs.includes('GR.addMaxHealthBonus(ctx.growth, o, gmhv.value)') &&
    executeJs.includes('GR.addDamageBonus(ctx.growth, o, gdv.value)') &&
    executeJs.includes('GR.addSpeedBonus(ctx.growth, o, gsv.value)') &&
    executeJs.includes('GR.applyReward(ctx.growth, o, bundleName)') &&
    executeJs.includes('GR.maxHealthBonusOf(ctx.growth, rmTargets[0])') &&
    executeJs.includes('GR.damageBonusOf(ctx.growth, rdTargets[0])') &&
    executeJs.includes('GR.speedBonusOf(ctx.growth, rsTargets[0])'));
  check('shared execute module adds the damage bonus to melee and shots, and the speed bonus to dashes',
    executeJs.includes('mav.value + growthBonusOf(ctx, \'damage\', o)') &&
    executeJs.includes('sdv.value + growthBonusOf(ctx, \'damage\', o)') &&
    executeJs.includes('dsv.value + growthBonusOf(ctx, \'speed\', o)'));
  const resetSb = {};
  resetSb.window = resetSb;
  vm.createContext(resetSb);
  vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-scenereset.js'), 'utf8'),
    resetSb, { filename: 'hydra-scenereset.js' });
  const SR = resetSb.HydraSceneReset;
  check('scene reset leaves the growth record untouched (growth survives a scene switch)',
    (() => {
      const growth = { byId: { hero: { maxHealth: 10, damage: 2, speed: 50 } } };
      const state = { growth: growth };
      const ok = SR.resetSceneRuntime(state, { id: 1 }, {});
      return ok === true && state.growth === growth &&
        state.growth.byId.hero.damage === 2;
    })());
  const catalogJs = fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8');
  check('catalog carries the seven growth blocks in the Growth category',
    catalogJs.includes("blockType: 'grow-max-health'") &&
    catalogJs.includes("runtimeType: 'growMaxHealth'") &&
    catalogJs.includes("blockType: 'grow-damage'") &&
    catalogJs.includes("runtimeType: 'growDamage'") &&
    catalogJs.includes("blockType: 'grow-speed'") &&
    catalogJs.includes("runtimeType: 'growSpeed'") &&
    catalogJs.includes("blockType: 'level-reward'") &&
    catalogJs.includes("runtimeType: 'levelReward'") &&
    catalogJs.includes("blockType: 'read-max-health-bonus'") &&
    catalogJs.includes("runtimeType: 'readMaxHealthBonus'") &&
    catalogJs.includes("blockType: 'read-damage-bonus'") &&
    catalogJs.includes("runtimeType: 'readDamageBonus'") &&
    catalogJs.includes("blockType: 'read-speed-bonus'") &&
    catalogJs.includes("runtimeType: 'readSpeedBonus'") &&
    catalogJs.includes("key: 'bundle', label: 'Reward'") &&
    catalogJs.includes("key: 'heal', label: 'Heal too'") &&
    catalogJs.includes("key: 'varName', label: 'Into variable'"));
  const refMd = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');
  check('block reference documents all seven growth blocks',
    refMd.includes('Grow Max Health') && refMd.includes('Grow Damage') &&
    refMd.includes('Grow Speed') && refMd.includes('Level Reward') &&
    refMd.includes('Read Max Health Bonus') && refMd.includes('Read Damage Bonus') &&
    refMd.includes('Read Speed Bonus') &&
    refMd.includes('### Growth (7)'));
  const guideMd = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');
  check('user guide covers level-up rewards and stat growth',
    guideMd.includes('Level-up rewards') && guideMd.includes('Grow Max Health') &&
    guideMd.includes('Level Reward'));
}

process.exit(failures === 0 ? 0 : 1);
