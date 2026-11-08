// Unit tests for hydra/hydra-achievement.js — the shared achievement system
// (P4 Advanced batch 10: permanent trophies the player earns).
//
// Pure logic: achievement-table normalization (repairs, drops, dedupe),
// name/id lookups, the unlocked set (unlock / lock / reset, count/list
// reads), per-game storage (key, serialize/parse, load/save), and the
// action/condition routing sets. Nothing here touches the DOM; both
// runtimes delegate to this module.
// Static checks at the end pin the wiring: catalog blocks, editor
// tab + panel, both runtimes' dispatch, and the export inlining.

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
sandbox.window = sandbox; // hydra-achievement.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-achievement.js'), 'utf8'),
  sandbox, { filename: 'hydra-achievement.js' });
const A = sandbox.HydraAchievement;

check('HydraAchievement exposed with helpers',
  !!A && typeof A.normalizeAchievements === 'function' && typeof A.achievementNames === 'function' &&
  typeof A.getAchievement === 'function' && typeof A.createAchievementRuntime === 'function' &&
  typeof A.isAchievementUnlocked === 'function' && typeof A.achievementCount === 'function' &&
  typeof A.unlockedAchievementNames === 'function' &&
  typeof A.unlockAchievement === 'function' && typeof A.lockAchievement === 'function' &&
  typeof A.resetAchievements === 'function' && typeof A.achievementList === 'function' &&
  typeof A.achievementKey === 'function' && typeof A.serializeUnlocked === 'function' &&
  typeof A.parseUnlocked === 'function' && typeof A.safeStorage === 'function' &&
  typeof A.loadUnlocked === 'function' && typeof A.saveUnlocked === 'function' &&
  typeof A.isAchievementAction === 'function' && typeof A.isAchievementCondition === 'function');
check('factorySource is a self-contained function string',
  typeof A.factorySource === 'string' && A.factorySource.includes('hydraAchievementFactory'));
check('storage prefix is hydraAchievements:',
  A.STORAGE_PREFIX === 'hydraAchievements:');

function guardAchievements() {
  return [
    { id: 'ach_coins', name: 'Coin hoarder', description: 'Collect 100 coins across any number of runs.' },
    { id: 'ach_flawless', name: 'Flawless', description: 'Finish a level without dying.' },
    { id: 'ach_veteran', name: 'Veteran', description: 'Beat every level.' }
  ];
}

function makeHooks() {
  const writes = [];
  const persists = [];
  return {
    writes,
    persists,
    hooks: {
      warn: function (msg) { writes.push(['warn', msg]); },
      persist: function () { persists.push('persist'); }
    }
  };
}

function makeStorage() {
  const data = {};
  return {
    data,
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem: function (k, v) { data[k] = String(v); },
    removeItem: function (k) { delete data[k]; }
  };
}

// --- normalization ---
{
  check('null normalizes to an empty list', JSON.stringify(A.normalizeAchievements(null)) === '[]');
  check('a non-array normalizes to an empty list', JSON.stringify(A.normalizeAchievements({})) === '[]');
  const list = [
    { id: 'a', name: ' Coin hoarder ', description: 7 },
    { name: 'Coin hoarder', description: 'dup' },
    { name: '  ' },
    null, 'junk',
    { name: 'Flawless', description: '' },
    { name: 'Veteran' }
  ];
  const norm = A.normalizeAchievements(list);
  check('normalization is in place (same array identity)', norm === list, 'identity changed');
  check('duplicate names collapse to the first, blank names drop, junk drops',
    JSON.stringify(A.achievementNames(list)) === '["Coin hoarder","Flawless","Veteran"]',
    JSON.stringify(A.achievementNames(list)));
  const coins = A.getAchievement(list, 'Coin hoarder');
  check('achievement names trim', coins && coins.name === 'Coin hoarder');
  check('description coerces to a string', coins.description === '7', JSON.stringify(coins));
  check('a missing description defaults to empty',
    A.getAchievement(list, 'Veteran').description === '');
  check('a missing id is minted', typeof A.getAchievement(list, 'Veteran').id === 'string' &&
    A.getAchievement(list, 'Veteran').id.length > 0);
}

// --- lookups ---
{
  const list = guardAchievements();
  check('getAchievement finds by name', A.getAchievement(list, 'Coin hoarder') === list[0]);
  check('getAchievement finds by id', A.getAchievement(list, 'ach_flawless') === list[1]);
  check('getAchievement trims the name', A.getAchievement(list, '  Flawless  ') === list[1]);
  check('getAchievement returns null for blank names', A.getAchievement(list, '  ') === null);
  check('getAchievement returns null for unknown names', A.getAchievement(list, 'Nobody') === null);
  check('getAchievement returns null for a null table', A.getAchievement(null, 'Coin hoarder') === null);
  check('achievementNames returns a copy', (() => {
    const names = A.achievementNames(list);
    names.push('bogus');
    return A.achievementNames(list).length === 3;
  })());
}

// --- fresh runtime ---
{
  const rt = A.createAchievementRuntime();
  check('fresh runtime carries nothing unlocked',
    rt && typeof rt.unlocked === 'object' && Object.keys(rt.unlocked).length === 0);
  check('isAchievementUnlocked reads false on a fresh runtime', A.isAchievementUnlocked(rt, 'Coin hoarder') === false);
  check('achievementCount reads 0 on a fresh runtime', A.achievementCount(rt) === 0);
  check('unlockedAchievementNames reads empty on a fresh runtime',
    JSON.stringify(A.unlockedAchievementNames(rt)) === '[]');
  check('achievementList reads all achievements locked on a fresh runtime',
    JSON.stringify(A.achievementList(rt, guardAchievements())) === '[{"name":"Coin hoarder","description":"Collect 100 coins across any number of runs.","unlocked":false},{"name":"Flawless","description":"Finish a level without dying.","unlocked":false},{"name":"Veteran","description":"Beat every level.","unlocked":false}]',
    JSON.stringify(A.achievementList(rt, guardAchievements())));
  check('a runtime seeded from stored names starts with those unlocked', (() => {
    const seeded = A.createAchievementRuntime(['Flawless', 'Coin hoarder']);
    return A.isAchievementUnlocked(seeded, 'Flawless') === true &&
      A.isAchievementUnlocked(seeded, 'Coin hoarder') === true &&
      A.isAchievementUnlocked(seeded, 'Veteran') === false &&
      A.achievementCount(seeded) === 2;
  })());
  check('a runtime seeded with corrupt entries ignores them', (() => {
    const seeded = A.createAchievementRuntime(['Flawless', null, 42, '  ', 'Flawless']);
    return A.achievementCount(seeded) === 1 && A.isAchievementUnlocked(seeded, 'Flawless') === true;
  })());
}

// --- unlock ---
{
  const rt = A.createAchievementRuntime();
  const h = makeHooks();
  check('unlock with a blank name stays quiet', A.unlockAchievement(rt, guardAchievements(), '  ', h.hooks) === false && A.achievementCount(rt) === 0);
  check('unlock with an unknown name warns and holds',
    A.unlockAchievement(rt, guardAchievements(), 'Nobody', h.hooks) === false && A.achievementCount(rt) === 0 &&
    h.writes.some(w => w[0] === 'warn' && /no achievement named "Nobody"/.test(w[1])),
    JSON.stringify(h.writes));
  check('unlock stores the achievement',
    A.unlockAchievement(rt, guardAchievements(), 'Coin hoarder', h.hooks) === true &&
    A.isAchievementUnlocked(rt, 'Coin hoarder') === true && A.achievementCount(rt) === 1);
  check('unlock persists on change',
    h.persists.length === 1, JSON.stringify(h.persists));
  check('unlocking an already-unlocked achievement changes nothing and does not persist again',
    A.unlockAchievement(rt, guardAchievements(), 'Coin hoarder', h.hooks) === false &&
    A.achievementCount(rt) === 1 && h.persists.length === 1);
  check('unlock is permanent across a second runtime built from the same set', (() => {
    const again = A.createAchievementRuntime(A.unlockedAchievementNames(rt));
    return A.isAchievementUnlocked(again, 'Coin hoarder') === true;
  })());
  check('unlock trims the name',
    A.unlockAchievement(rt, guardAchievements(), '  Flawless  ', h.hooks) === true &&
    A.isAchievementUnlocked(rt, 'Flawless') === true);
}

// --- lock ---
{
  const rt = A.createAchievementRuntime();
  const h = makeHooks();
  A.unlockAchievement(rt, guardAchievements(), 'Coin hoarder', h.hooks);
  A.unlockAchievement(rt, guardAchievements(), 'Flawless', h.hooks);
  check('lock with a blank name stays quiet', A.lockAchievement(rt, guardAchievements(), '  ', h.hooks) === false);
  check('lock with an unknown name warns and holds',
    A.lockAchievement(rt, guardAchievements(), 'Nobody', h.hooks) === false &&
    h.writes.some(w => w[0] === 'warn' && /no achievement named "Nobody"/.test(w[1])),
    JSON.stringify(h.writes));
  check('lock drops the achievement and persists',
    A.lockAchievement(rt, guardAchievements(), 'Coin hoarder', h.hooks) === true &&
    A.isAchievementUnlocked(rt, 'Coin hoarder') === false && A.achievementCount(rt) === 1 &&
    h.persists.length === 3, JSON.stringify(h.persists));
  check('locking a locked achievement changes nothing and does not persist again',
    A.lockAchievement(rt, guardAchievements(), 'Coin hoarder', h.hooks) === false &&
    h.persists.length === 3);
}

// --- reset ---
{
  const rt = A.createAchievementRuntime();
  const h = makeHooks();
  A.unlockAchievement(rt, guardAchievements(), 'Coin hoarder', h.hooks);
  A.unlockAchievement(rt, guardAchievements(), 'Veteran', h.hooks);
  check('reset locks every achievement and persists',
    A.resetAchievements(rt, h.hooks) === true && A.achievementCount(rt) === 0 &&
    A.isAchievementUnlocked(rt, 'Coin hoarder') === false &&
    JSON.stringify(A.unlockedAchievementNames(rt)) === '[]' &&
    h.persists.length === 3, JSON.stringify(h.persists));
  check('resetting an empty set changes nothing and does not persist again',
    A.resetAchievements(rt, h.hooks) === false && h.persists.length === 3);
  check('reset on a null runtime stays quiet', A.resetAchievements(null) === false);
}

// --- count / list ---
{
  const rt = A.createAchievementRuntime();
  const h = makeHooks();
  A.unlockAchievement(rt, guardAchievements(), 'Veteran', h.hooks);
  A.unlockAchievement(rt, guardAchievements(), 'Coin hoarder', h.hooks);
  check('achievementCount counts the unlocked set', A.achievementCount(rt) === 2);
  check('unlockedAchievementNames lists them sorted',
    JSON.stringify(A.unlockedAchievementNames(rt)) === '["Coin hoarder","Veteran"]',
    JSON.stringify(A.unlockedAchievementNames(rt)));
  check('unlockedAchievementNames returns a copy', (() => {
    const names = A.unlockedAchievementNames(rt);
    names.push('bogus');
    return A.unlockedAchievementNames(rt).length === 2;
  })());
  check('achievementList marks unlocked ones',
    JSON.stringify(A.achievementList(rt, guardAchievements())) === '[{"name":"Coin hoarder","description":"Collect 100 coins across any number of runs.","unlocked":true},{"name":"Flawless","description":"Finish a level without dying.","unlocked":false},{"name":"Veteran","description":"Beat every level.","unlocked":true}]',
    JSON.stringify(A.achievementList(rt, guardAchievements())));
  check('isAchievementUnlocked reads false for blank and unknown names',
    A.isAchievementUnlocked(rt, '  ') === false && A.isAchievementUnlocked(rt, 'Nobody') === false);
  check('achievementCount on a null runtime reads 0', A.achievementCount(null) === 0);
}

// --- storage ---
{
  check('achievementKey carries the project id',
    A.achievementKey('my-game') === 'hydraAchievements:my-game');
  check('achievementKey sanitizes hostile ids',
    A.achievementKey('My Game! 1/2') === 'hydraAchievements:My_Game__1_2',
    A.achievementKey('My Game! 1/2'));
  check('achievementKey caps long ids at 64 chars',
    A.achievementKey('x'.repeat(100)).length === 'hydraAchievements:'.length + 64);
  check('achievementKey falls back to default for blank ids',
    A.achievementKey('') === 'hydraAchievements:default' &&
    A.achievementKey(null) === 'hydraAchievements:default');
  check('serialize/parse round-trips the unlocked set', (() => {
    const rt = A.createAchievementRuntime(['Veteran', 'Coin hoarder']);
    const s = A.serializeUnlocked(rt);
    return s === '["Coin hoarder","Veteran"]' &&
      JSON.stringify(A.parseUnlocked(s)) === '["Coin hoarder","Veteran"]';
  })());
  check('parseUnlocked reads corrupt bytes as empty',
    JSON.stringify(A.parseUnlocked('not json')) === '[]' &&
    JSON.stringify(A.parseUnlocked('{"a":1}')) === '[]' &&
    JSON.stringify(A.parseUnlocked(null)) === '[]' &&
    JSON.stringify(A.parseUnlocked('[1, null, "Flawless"]')) === '["Flawless"]');
  check('load/save round-trips through a stub storage', (() => {
    const st = makeStorage();
    const rt = A.createAchievementRuntime(['Coin hoarder']);
    const saved = A.saveUnlocked(st, 'game-1', A.unlockedAchievementNames(rt));
    const loaded = A.loadUnlocked(st, 'game-1');
    return saved === true && JSON.stringify(loaded) === '["Coin hoarder"]' &&
      st.data['hydraAchievements:game-1'] === '["Coin hoarder"]';
  })());
  check('two games never share a trophy case', (() => {
    const st = makeStorage();
    A.saveUnlocked(st, 'game-1', ['Coin hoarder']);
    A.saveUnlocked(st, 'game-2', ['Flawless']);
    return JSON.stringify(A.loadUnlocked(st, 'game-1')) === '["Coin hoarder"]' &&
      JSON.stringify(A.loadUnlocked(st, 'game-2')) === '["Flawless"]';
  })());
  check('load reads empty for a missing key and a missing storage',
    JSON.stringify(A.loadUnlocked(makeStorage(), 'no-such-game')) === '[]' &&
    JSON.stringify(A.loadUnlocked(null, 'game-1')) === '[]');
  check('save returns false without storage', A.saveUnlocked(null, 'game-1', ['Coin hoarder']) === false);
  check('save returns false for a non-array name list',
    A.saveUnlocked(makeStorage(), 'game-1', 'Coin hoarder') === false);
  check('a throwing storage never breaks load or save', (() => {
    const bad = {
      getItem: function () { throw new Error('boom'); },
      setItem: function () { throw new Error('boom'); }
    };
    return JSON.stringify(A.loadUnlocked(bad, 'game-1')) === '[]' &&
      A.saveUnlocked(bad, 'game-1', ['Coin hoarder']) === false;
  })());
  check('safeStorage returns null when localStorage is absent',
    A.safeStorage() === null);
}

// --- routing sets ---
{
  check('isAchievementAction matches the four action blocks',
    A.isAchievementAction('unlockAchievement') && A.isAchievementAction('lockAchievement') &&
    A.isAchievementAction('resetAchievements') && A.isAchievementAction('readAchievementCount') &&
    !A.isAchievementAction('unlockItem') && !A.isAchievementAction('achievementUnlocked'));
  check('isAchievementCondition matches the two condition blocks',
    A.isAchievementCondition('achievementUnlocked') && A.isAchievementCondition('achievementCount') &&
    !A.isAchievementCondition('questComplete') && !A.isAchievementCondition('unlockAchievement'));
}

// --- hostile input ---
{
  const h = makeHooks();
  check('unlock on a null runtime stays quiet', A.unlockAchievement(null, guardAchievements(), 'Coin hoarder', h.hooks) === false);
  check('lock on a null runtime stays quiet', A.lockAchievement(null, guardAchievements(), 'Coin hoarder', h.hooks) === false);
  check('isAchievementUnlocked on a null runtime reads false', A.isAchievementUnlocked(null, 'Coin hoarder') === false);
  check('achievementList on a null runtime reads all locked',
    JSON.stringify(A.achievementList(null, guardAchievements()).map(a => a.unlocked)) === '[false,false,false]');
  check('a throwing warn hook never breaks the unlock', (() => {
    const rt = A.createAchievementRuntime();
    const bad = { warn: function () { throw new Error('boom'); } };
    return A.unlockAchievement(rt, guardAchievements(), 'Nobody', bad) === false && A.achievementCount(rt) === 0;
  })());
  check('a throwing persist hook never breaks the unlock', (() => {
    const rt = A.createAchievementRuntime();
    const bad = { warn: function () {}, persist: function () { throw new Error('boom'); } };
    return A.unlockAchievement(rt, guardAchievements(), 'Coin hoarder', bad) === true &&
      A.isAchievementUnlocked(rt, 'Coin hoarder') === true;
  })());
  check('a hostile achievement table degrades to no achievement', (() => {
    const rt = A.createAchievementRuntime();
    return A.unlockAchievement(rt, 'not a table', 'Coin hoarder', h.hooks) === false && A.achievementCount(rt) === 0;
  })());
  check('isAchievementUnlocked on a frozen runtime reads without throwing', (() => {
    const rt = A.createAchievementRuntime(['Flawless']);
    Object.freeze(rt);
    return A.isAchievementUnlocked(rt, 'Flawless') === true;
  })());
  check('unlock with corrupt unlocked values stays quiet', (() => {
    const rt = { unlocked: { 'Coin hoarder': 'yes' } };
    return A.isAchievementUnlocked(rt, 'Coin hoarder') === false;
  })());
}

// --- static wiring ---
{
  const html = fs.readFileSync(path.join(HYDRA, 'index.html'), 'utf8');
  const scriptJs = fs.readFileSync(path.join(HYDRA, 'script.js'), 'utf8');
  const playerJs = fs.readFileSync(path.join(HYDRA, 'player-runtime.js'), 'utf8');
  const previewJs = fs.readFileSync(path.join(HYDRA, 'hydra-previewruntime.js'), 'utf8');
  const universalJs = fs.readFileSync(path.join(HYDRA, 'hydra-universal.js'), 'utf8');
  const conditionsJs = fs.readFileSync(path.join(HYDRA, 'hydra-conditions.js'), 'utf8');
  const executeJs = fs.readFileSync(path.join(HYDRA, 'hydra-execute.js'), 'utf8');
  const flowJs = fs.readFileSync(path.join(HYDRA, 'hydra-flow.js'), 'utf8');

  const aTag = html.indexOf('src="hydra-achievement.js');
  check('index.html loads hydra-achievement.js before player-runtime.js and script.js',
    aTag !== -1 && aTag < html.indexOf('src="player-runtime.js') && aTag < html.indexOf('src="script.js'));
  check('index.html loads hydra-achievement.js after hydra-quest.js',
    aTag !== -1 && html.indexOf('src="hydra-quest.js') < aTag);
  check('index.html has an Achievements inspector tab',
    html.includes('data-inspector-tab="achievements"') && html.includes('data-inspector-panel="achievements"'));
  check('index.html has the Achievements panel + add button',
    html.includes('id="achievements-panel"') && html.includes('id="achievements-add-btn"'));
  check('script.js exposes the Achievements tab panel + init + rename propagation',
    scriptJs.includes('function renderAchievementsPanel') && scriptJs.includes('function initAchievementsPanel') &&
    scriptJs.includes('function propagateAchievementRename') && scriptJs.includes('function getMutableAchievements') &&
    scriptJs.includes('initAchievementsPanel()'));
  check('script.js hands the project achievement table + id to the preview runtime',
    scriptJs.includes('function getProjectAchievements') && scriptJs.includes('getProjectAchievements,') &&
    scriptJs.includes('function getProjectId') && scriptJs.includes('getProjectId,'));
  check('player-runtime.js hard-guards on HydraAchievement',
    playerJs.includes("requires hydra-achievement.js (window.HydraAchievement)"));
  check('player-runtime.js inlines HydraAchievement into exports',
    playerJs.includes("'HydraAchievement', global.HydraAchievement && global.HydraAchievement.factorySource"));
  check('player-runtime.js creates the unlocked set from storage + table',
    playerJs.includes('achievementLog: HydraAchievement.createAchievementRuntime(') &&
    playerJs.includes('achievements: HydraAchievement.normalizeAchievements(project.achievements)') &&
    playerJs.includes('HydraAchievement.loadUnlocked(HydraAchievement.safeStorage(), project.id)'));
  check('player-runtime.js routes achievement blocks through the shared modules',
    playerJs.includes('HydraAchievement.isAchievementCondition(type)') &&
    playerJs.includes('HydraAchievement.isAchievementAction(type)') &&
    playerJs.includes('achievementLog: state.achievementLog') && playerJs.includes('achievementModule: HydraAchievement'));
  check('preview runtime loads the unlocked set from storage on first access',
    previewJs.includes('function achievementRuntime') &&
    previewJs.includes('A.loadUnlocked(A.safeStorage()') &&
    previewJs.includes("hostCall('getProjectId'"));
  check('preview runtime persists on change and never resets achievements',
    previewJs.includes('function persistAchievements') &&
    previewJs.includes('achievementHooks') &&
    !previewJs.includes('resetAchievement'));
  check('preview runtime contexts carry the unlocked set state',
    previewJs.includes('achievementLog: achievementRuntime()') && previewJs.includes("achievements: hostCall('getProjectAchievements'"));
  check('hydra-universal.js defaults project.achievements to []',
    universalJs.includes('if (!Array.isArray(project.achievements)) project.achievements = [];'));
  check('shared conditions module evaluates the two achievement conditions',
    conditionsJs.includes("case 'achievementUnlocked'") && conditionsJs.includes("case 'achievementCount'"));
  check('shared execute module runs the four achievement actions',
    executeJs.includes("isType(ctx.achievementModule, 'isAchievementAction', type)") &&
    executeJs.includes("type === 'unlockAchievement'") && executeJs.includes("type === 'readAchievementCount'"));
  check('flow module defaults the achievement conditions to level triggers',
    flowJs.includes("t === 'achievementUnlocked'") && flowJs.includes("t === 'achievementCount'"));

  // Catalog: six Achievement blocks, schema-clean.
  const catSb = {}; catSb.window = catSb; vm.createContext(catSb);
  vm.runInContext(fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8'), catSb,
    { filename: 'block-catalog.js' });
  const catalog = catSb.HydraBlockCatalog;
  const aBlocks = catalog.blocks.filter(b => b.category === 'Achievement');
  check('catalog carries six Achievement blocks',
    aBlocks.length === 6, aBlocks.map(b => b.label).join(', '));
  const labels = aBlocks.map(b => b.label).sort();
  check('Achievement blocks are the four actions + two conditions',
    JSON.stringify(labels) === JSON.stringify(['Achievement Count', 'Achievement Unlocked', 'Lock Achievement', 'Read Achievement Count', 'Reset Achievements', 'Unlock Achievement'].sort()),
    labels.join(', '));
  const findings = catalog.validateCatalog();
  check('catalog validates clean with the Achievement blocks', findings.length === 0,
    JSON.stringify(findings.slice(0, 3)));
  const ref = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');
  check('every Achievement block is documented in the block reference',
    aBlocks.every(b => ref.includes(b.label)), aBlocks.filter(b => !ref.includes(b.label)).map(b => b.label).join(', '));
  const guide = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');
  check('user guide has an Achievements section', guide.includes('## Achievements'));
}

process.exit(failures === 0 ? 0 : 1);
