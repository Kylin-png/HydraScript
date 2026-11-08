// Unit tests for hydra/hydra-quest.js — the shared quest system
// (P4 Advanced batch 9: named objectives the player works through).
//
// Pure logic: quest-table normalization (repairs, drops, dedupe,
// target coercion), name/id lookups, the per-run quest log (add /
// set / complete / reset / read / clear, complete/progress reads,
// target clamping), and the action/condition routing sets. Nothing
// here touches the DOM; both runtimes delegate to this module.
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
sandbox.window = sandbox; // hydra-quest.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-quest.js'), 'utf8'),
  sandbox, { filename: 'hydra-quest.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-achievement.js'), 'utf8'),
  sandbox, { filename: 'hydra-achievement.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-cutscene.js'), 'utf8'),
  sandbox, { filename: 'hydra-cutscene.js' });
const Q = sandbox.HydraQuest;

check('HydraQuest exposed with helpers',
  !!Q && typeof Q.normalizeQuests === 'function' && typeof Q.questNames === 'function' &&
  typeof Q.getQuest === 'function' && typeof Q.createQuestRuntime === 'function' &&
  typeof Q.questProgress === 'function' && typeof Q.isQuestComplete === 'function' &&
  typeof Q.addQuestProgress === 'function' && typeof Q.setQuestProgress === 'function' &&
  typeof Q.completeQuest === 'function' && typeof Q.resetQuest === 'function' &&
  typeof Q.readQuestProgress === 'function' && typeof Q.clearQuests === 'function' &&
  typeof Q.questList === 'function' &&
  typeof Q.isQuestAction === 'function' && typeof Q.isQuestCondition === 'function');
check('factorySource is a self-contained function string',
  typeof Q.factorySource === 'string' && Q.factorySource.includes('hydraQuestFactory'));
check('default target is 1',
  Q.DEFAULT_TARGET === 1);

function guardQuests() {
  return [
    { id: 'qst_coins', name: 'Collect 4 coins', target: 4, description: 'Pick up every coin in Level 1.' },
    { id: 'qst_foes', name: 'Defeat 3 enemies', target: 3, description: 'Clear the level of enemies.' },
    { id: 'qst_goal', name: 'Reach the goal', target: 1, description: 'Finish the level.' }
  ];
}

function makeHooks() {
  const writes = [];
  return {
    writes,
    hooks: {
      warn: function (msg) { writes.push(['warn', msg]); }
    }
  };
}

// --- normalization ---
{
  check('null normalizes to an empty list', JSON.stringify(Q.normalizeQuests(null)) === '[]');
  check('a non-array normalizes to an empty list', JSON.stringify(Q.normalizeQuests({})) === '[]');
  const list = [
    { id: 'a', name: ' Collect 4 coins ', target: 4, description: 7 },
    { name: 'Collect 4 coins', target: 2, description: 'dup' },
    { name: '  ', target: 3 },
    null, 'junk',
    { name: 'Defeat 3 enemies', target: 0 },
    { name: 'Reach the goal', target: 'many' },
    { name: 'Find the gem', target: 2.7 },
    { name: 'Rescue the cat', target: -4 },
    { name: 'Second' }
  ];
  const norm = Q.normalizeQuests(list);
  check('normalization is in place (same array identity)', norm === list, 'identity changed');
  check('duplicate names collapse to the first, blank names drop, junk drops',
    JSON.stringify(Q.questNames(list)) === '["Collect 4 coins","Defeat 3 enemies","Reach the goal","Find the gem","Rescue the cat","Second"]',
    JSON.stringify(Q.questNames(list)));
  const coins = Q.getQuest(list, 'Collect 4 coins');
  check('quest names trim', coins && coins.name === 'Collect 4 coins');
  check('description coerces to a string', coins.description === '7', JSON.stringify(coins));
  check('target 0 / non-numeric / negative fall back to 1',
    Q.getQuest(list, 'Defeat 3 enemies').target === 1 &&
    Q.getQuest(list, 'Reach the goal').target === 1 &&
    Q.getQuest(list, 'Rescue the cat').target === 1,
    JSON.stringify(list.map(q => [q.name, q.target])));
  check('fractional targets floor', Q.getQuest(list, 'Find the gem').target === 2);
  check('a missing target defaults to 1', Q.getQuest(list, 'Second').target === 1);
  check('a missing id is minted', typeof Q.getQuest(list, 'Second').id === 'string' &&
    Q.getQuest(list, 'Second').id.length > 0);
}

// --- lookups ---
{
  const list = guardQuests();
  check('getQuest finds by name', Q.getQuest(list, 'Collect 4 coins') === list[0]);
  check('getQuest finds by id', Q.getQuest(list, 'qst_foes') === list[1]);
  check('getQuest trims the name', Q.getQuest(list, '  Defeat 3 enemies  ') === list[1]);
  check('getQuest returns null for blank names', Q.getQuest(list, '  ') === null);
  check('getQuest returns null for unknown names', Q.getQuest(list, 'Nobody') === null);
  check('getQuest returns null for a null table', Q.getQuest(null, 'Collect 4 coins') === null);
  check('questNames returns a copy', (() => {
    const names = Q.questNames(list);
    names.push('bogus');
    return Q.questNames(list).length === 3;
  })());
}

// --- fresh runtime ---
{
  const rt = Q.createQuestRuntime();
  check('fresh runtime carries no progress and nothing done',
    rt && typeof rt.progress === 'object' && typeof rt.done === 'object' &&
    Object.keys(rt.progress).length === 0 && Object.keys(rt.done).length === 0);
  check('questProgress reads 0 on a fresh runtime', Q.questProgress(rt, 'Collect 4 coins') === 0);
  check('isQuestComplete reads false on a fresh runtime', Q.isQuestComplete(rt, guardQuests(), 'Collect 4 coins') === false);
  check('questList reads all quests at 0 and not done on a fresh runtime',
    JSON.stringify(Q.questList(rt, guardQuests())) === '[{"name":"Collect 4 coins","progress":0,"target":4,"done":false},{"name":"Defeat 3 enemies","progress":0,"target":3,"done":false},{"name":"Reach the goal","progress":0,"target":1,"done":false}]',
    JSON.stringify(Q.questList(rt, guardQuests())));
}

// --- add ---
{
  const rt = Q.createQuestRuntime();
  const h = makeHooks();
  check('add with a blank name stays quiet', Q.addQuestProgress(rt, guardQuests(), '  ', 1, h.hooks) === false && Q.questProgress(rt, 'Collect 4 coins') === 0);
  check('add with an unknown name warns and holds',
    Q.addQuestProgress(rt, guardQuests(), 'Nobody', 1, h.hooks) === false && Q.questProgress(rt, 'Nobody') === 0 &&
    h.writes.some(w => w[0] === 'warn' && /no quest named "Nobody"/.test(w[1])),
    JSON.stringify(h.writes));
  check('add with a bad amount warns and holds',
    Q.addQuestProgress(rt, guardQuests(), 'Collect 4 coins', 0, h.hooks) === false &&
    Q.addQuestProgress(rt, guardQuests(), 'Collect 4 coins', -2, h.hooks) === false &&
    Q.addQuestProgress(rt, guardQuests(), 'Collect 4 coins', 'lots', h.hooks) === false &&
    Q.questProgress(rt, 'Collect 4 coins') === 0,
    JSON.stringify(h.writes));
  check('add stores the progress',
    Q.addQuestProgress(rt, guardQuests(), 'Collect 4 coins', 2, h.hooks) === true && Q.questProgress(rt, 'Collect 4 coins') === 2);
  check('add accumulates',
    Q.addQuestProgress(rt, guardQuests(), 'Collect 4 coins', 1, h.hooks) === true && Q.questProgress(rt, 'Collect 4 coins') === 3);
  check('add floors a fractional amount',
    Q.addQuestProgress(rt, guardQuests(), 'Defeat 3 enemies', 2.9, h.hooks) === true && Q.questProgress(rt, 'Defeat 3 enemies') === 2);
  check('add clamps at the target and completes the quest',
    Q.addQuestProgress(rt, guardQuests(), 'Collect 4 coins', 99, h.hooks) === true &&
    Q.questProgress(rt, 'Collect 4 coins') === 4 && Q.isQuestComplete(rt, guardQuests(), 'Collect 4 coins') === true);
  check('adding past the target changes nothing more',
    Q.addQuestProgress(rt, guardQuests(), 'Collect 4 coins', 1, h.hooks) === false &&
    Q.questProgress(rt, 'Collect 4 coins') === 4);
}

// --- set ---
{
  const rt = Q.createQuestRuntime();
  const h = makeHooks();
  check('set with a blank name stays quiet', Q.setQuestProgress(rt, guardQuests(), '  ', 3, h.hooks) === false);
  check('set with an unknown name warns and holds',
    Q.setQuestProgress(rt, guardQuests(), 'Nobody', 3, h.hooks) === false &&
    h.writes.some(w => w[0] === 'warn' && /no quest named "Nobody"/.test(w[1])),
    JSON.stringify(h.writes));
  check('set with a non-numeric amount warns and holds',
    Q.setQuestProgress(rt, guardQuests(), 'Collect 4 coins', 'lots', h.hooks) === false && Q.questProgress(rt, 'Collect 4 coins') === 0);
  check('set writes the progress outright',
    Q.setQuestProgress(rt, guardQuests(), 'Collect 4 coins', 3, h.hooks) === true && Q.questProgress(rt, 'Collect 4 coins') === 3);
  check('set clamps at the target and completes the quest',
    Q.setQuestProgress(rt, guardQuests(), 'Defeat 3 enemies', 99, h.hooks) === true &&
    Q.questProgress(rt, 'Defeat 3 enemies') === 3 && Q.isQuestComplete(rt, guardQuests(), 'Defeat 3 enemies') === true);
  check('set floors a fractional amount',
    Q.setQuestProgress(rt, guardQuests(), 'Collect 4 coins', 2.8, h.hooks) === true && Q.questProgress(rt, 'Collect 4 coins') === 2);
  check('set below the target un-completes the quest',
    Q.setQuestProgress(rt, guardQuests(), 'Defeat 3 enemies', 1, h.hooks) === true &&
    Q.questProgress(rt, 'Defeat 3 enemies') === 1 && Q.isQuestComplete(rt, guardQuests(), 'Defeat 3 enemies') === false);
  check('set to 0 drops the entry',
    Q.setQuestProgress(rt, guardQuests(), 'Collect 4 coins', 0, h.hooks) === true &&
    Q.questProgress(rt, 'Collect 4 coins') === 0 && !('Collect 4 coins' in rt.progress));
  check('set to a negative amount clamps to 0 and drops the entry',
    Q.setQuestProgress(rt, guardQuests(), 'Defeat 3 enemies', -3, h.hooks) === true && Q.questProgress(rt, 'Defeat 3 enemies') === 0);
}

// --- complete / reset ---
{
  const rt = Q.createQuestRuntime();
  const h = makeHooks();
  check('complete with a blank name stays quiet', Q.completeQuest(rt, guardQuests(), '  ', h.hooks) === false);
  check('complete with an unknown name warns and holds',
    Q.completeQuest(rt, guardQuests(), 'Nobody', h.hooks) === false &&
    h.writes.some(w => w[0] === 'warn' && /no quest named "Nobody"/.test(w[1])),
    JSON.stringify(h.writes));
  check('complete fills progress to the target and marks done',
    Q.completeQuest(rt, guardQuests(), 'Collect 4 coins', h.hooks) === true &&
    Q.questProgress(rt, 'Collect 4 coins') === 4 && Q.isQuestComplete(rt, guardQuests(), 'Collect 4 coins') === true);
  check('completing an already-complete quest changes nothing',
    Q.completeQuest(rt, guardQuests(), 'Collect 4 coins', h.hooks) === false);
  check('a one-shot quest completes with one add',
    Q.addQuestProgress(rt, guardQuests(), 'Reach the goal', 1, h.hooks) === true &&
    Q.isQuestComplete(rt, guardQuests(), 'Reach the goal') === true);
  check('reset with a blank name stays quiet', Q.resetQuest(rt, guardQuests(), '  ', h.hooks) === false);
  check('reset with an unknown name warns and holds',
    Q.resetQuest(rt, guardQuests(), 'Nobody', h.hooks) === false &&
    h.writes.some(w => w[0] === 'warn' && /no quest named "Nobody"/.test(w[1])),
    JSON.stringify(h.writes));
  check('reset drops progress and done',
    Q.resetQuest(rt, guardQuests(), 'Collect 4 coins', h.hooks) === true &&
    Q.questProgress(rt, 'Collect 4 coins') === 0 && Q.isQuestComplete(rt, guardQuests(), 'Collect 4 coins') === false &&
    !('Collect 4 coins' in rt.progress) && !('Collect 4 coins' in rt.done));
  check('resetting a never-started quest changes nothing',
    Q.resetQuest(rt, guardQuests(), 'Defeat 3 enemies', h.hooks) === false);
}

// --- read / list ---
{
  const rt = Q.createQuestRuntime();
  const h = makeHooks();
  Q.addQuestProgress(rt, guardQuests(), 'Collect 4 coins', 3, h.hooks);
  Q.completeQuest(rt, guardQuests(), 'Reach the goal', h.hooks);
  check('read returns the progress', Q.readQuestProgress(rt, guardQuests(), 'Collect 4 coins', h.hooks) === 3);
  check('read returns 0 for a defined quest with no progress yet',
    Q.readQuestProgress(rt, guardQuests(), 'Defeat 3 enemies', h.hooks) === 0);
  check('read returns null for a blank name', Q.readQuestProgress(rt, guardQuests(), '  ', h.hooks) === null);
  check('read warns and returns null for an unknown quest',
    Q.readQuestProgress(rt, guardQuests(), 'Nobody', h.hooks) === null &&
    h.writes.some(w => w[0] === 'warn' && /no quest named "Nobody"/.test(w[1])),
    JSON.stringify(h.writes));
  check('isQuestComplete reads the done flag, not the progress alone',
    Q.isQuestComplete(rt, guardQuests(), 'Collect 4 coins') === false &&
    Q.isQuestComplete(rt, guardQuests(), 'Reach the goal') === true);
  check('isQuestComplete reads false for an unknown quest',
    Q.isQuestComplete(rt, guardQuests(), 'Nobody') === false);
  check('questProgress reads the progress, 0 when absent',
    Q.questProgress(rt, 'Collect 4 coins') === 3 && Q.questProgress(rt, 'Defeat 3 enemies') === 0 &&
    Q.questProgress(rt, '  ') === 0 && Q.questProgress(null, 'Collect 4 coins') === 0);
  check('questList lists defined quests sorted by name',
    JSON.stringify(Q.questList(rt, guardQuests())) === '[{"name":"Collect 4 coins","progress":3,"target":4,"done":false},{"name":"Defeat 3 enemies","progress":0,"target":3,"done":false},{"name":"Reach the goal","progress":1,"target":1,"done":true}]',
    JSON.stringify(Q.questList(rt, guardQuests())));
}

// --- clear ---
{
  const rt = Q.createQuestRuntime();
  const h = makeHooks();
  Q.addQuestProgress(rt, guardQuests(), 'Collect 4 coins', 3, h.hooks);
  Q.completeQuest(rt, guardQuests(), 'Reach the goal', h.hooks);
  check('clear empties the whole quest log',
    Q.clearQuests(rt) === true && Object.keys(rt.progress).length === 0 && Object.keys(rt.done).length === 0 &&
    Q.questProgress(rt, 'Collect 4 coins') === 0 && Q.isQuestComplete(rt, guardQuests(), 'Reach the goal') === false &&
    JSON.stringify(Q.questList(rt, guardQuests()).map(q => q.progress)) === '[0,0,0]');
  check('clear on a null runtime stays quiet', Q.clearQuests(null) === false);
}

// --- routing sets ---
{
  check('isQuestAction matches the six action blocks',
    Q.isQuestAction('addQuestProgress') && Q.isQuestAction('setQuestProgress') &&
    Q.isQuestAction('completeQuest') && Q.isQuestAction('resetQuest') &&
    Q.isQuestAction('readQuestProgress') && Q.isQuestAction('clearQuests') &&
    !Q.isQuestAction('addItem') && !Q.isQuestAction('questComplete'));
  check('isQuestCondition matches the two condition blocks',
    Q.isQuestCondition('questComplete') && Q.isQuestCondition('questProgress') &&
    !Q.isQuestCondition('hasItem') && !Q.isQuestCondition('addQuestProgress'));
}

// --- hostile input ---
{
  const h = makeHooks();
  check('add on a null runtime stays quiet', Q.addQuestProgress(null, guardQuests(), 'Collect 4 coins', 1, h.hooks) === false);
  check('set on a null runtime stays quiet', Q.setQuestProgress(null, guardQuests(), 'Collect 4 coins', 1, h.hooks) === false);
  check('complete on a null runtime stays quiet', Q.completeQuest(null, guardQuests(), 'Collect 4 coins', h.hooks) === false);
  check('reset on a null runtime stays quiet', Q.resetQuest(null, guardQuests(), 'Collect 4 coins', h.hooks) === false);
  check('read on a null runtime returns null', Q.readQuestProgress(null, guardQuests(), 'Collect 4 coins', h.hooks) === null);
  check('isQuestComplete on a null runtime reads false', Q.isQuestComplete(null, guardQuests(), 'Collect 4 coins') === false);
  check('questProgress on a null runtime reads 0', Q.questProgress(null, 'Collect 4 coins') === 0);
  check('a throwing warn hook never breaks the add', (() => {
    const rt = Q.createQuestRuntime();
    const bad = { warn: function () { throw new Error('boom'); } };
    return Q.addQuestProgress(rt, guardQuests(), 'Nobody', 1, bad) === false && Q.questProgress(rt, 'Collect 4 coins') === 0;
  })());
  check('a hostile quest table degrades to no quest', (() => {
    const rt = Q.createQuestRuntime();
    return Q.addQuestProgress(rt, 'not a table', 'Collect 4 coins', 1, h.hooks) === false && rt.progress && Object.keys(rt.progress).length === 0;
  })());
  check('questProgress on a frozen runtime reads without throwing', (() => {
    const rt = Q.createQuestRuntime();
    Q.addQuestProgress(rt, guardQuests(), 'Collect 4 coins', 3, h.hooks);
    Object.freeze(rt);
    return Q.questProgress(rt, 'Collect 4 coins') === 3;
  })());
  check('progress with corrupt values reads as 0', (() => {
    const rt = { progress: { 'Collect 4 coins': 'lots', 'Defeat 3 enemies': -4, 'Reach the goal': NaN }, done: {} };
    return Q.questProgress(rt, 'Collect 4 coins') === 0 && Q.questProgress(rt, 'Defeat 3 enemies') === 0 && Q.questProgress(rt, 'Reach the goal') === 0;
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

  const qTag = html.indexOf('src="hydra-quest.js');
  check('index.html loads hydra-quest.js before player-runtime.js and script.js',
    qTag !== -1 && qTag < html.indexOf('src="player-runtime.js') && qTag < html.indexOf('src="script.js'));
  check('index.html has a Quests inspector tab',
    html.includes('data-inspector-tab="quests"') && html.includes('data-inspector-panel="quests"'));
  check('index.html has the Quests panel + add button',
    html.includes('id="quests-panel"') && html.includes('id="quests-add-btn"'));
  check('script.js exposes the Quests tab panel + init + rename propagation',
    scriptJs.includes('function renderQuestsPanel') && scriptJs.includes('function initQuestsPanel') &&
    scriptJs.includes('function propagateQuestRename') && scriptJs.includes('function getMutableQuests') &&
    scriptJs.includes('initQuestsPanel()'));
  check('script.js hands the project quest table to the preview runtime',
    scriptJs.includes('function getProjectQuests') && scriptJs.includes('getProjectQuests,'));
  check('player-runtime.js hard-guards on HydraQuest',
    playerJs.includes("requires hydra-quest.js (window.HydraQuest)"));
  check('player-runtime.js inlines HydraQuest into exports',
    playerJs.includes("'HydraQuest', global.HydraQuest && global.HydraQuest.factorySource"));
  check('player-runtime.js creates the per-run quest log + table',
    playerJs.includes('questLog: HydraQuest.createQuestRuntime()') &&
    playerJs.includes('quests: HydraQuest.normalizeQuests(project.quests)'));
  check('player-runtime.js routes quest blocks through the shared modules',
    playerJs.includes('HydraQuest.isQuestCondition(type)') &&
    playerJs.includes('HydraQuest.isQuestAction(type)') &&
    playerJs.includes('questLog: state.questLog') && playerJs.includes('questModule: HydraQuest'));
  check('preview runtime holds the quest log runtime + fresh-run reset',
    previewJs.includes('function questLogRuntime') && previewJs.includes('function resetQuestLogRuntime') &&
    previewJs.includes('resetQuestLogRuntime();'));
  check('preview runtime contexts carry the quest log state',
    previewJs.includes('questLog: questLogRuntime()') && previewJs.includes("quests: hostCall('getProjectQuests'"));
  check('preview runtime does NOT reset the quest log on scene load',
    !previewJs.includes('resetQuestLog: function'));
  check('hydra-universal.js defaults project.quests to []',
    universalJs.includes('if (!Array.isArray(project.quests)) project.quests = [];'));
  check('shared conditions module evaluates the two quest conditions',
    conditionsJs.includes("case 'questComplete'") && conditionsJs.includes("case 'questProgress'"));
  check('shared execute module runs the six quest actions',
    executeJs.includes("isType(ctx.questModule, 'isQuestAction', type)") &&
    executeJs.includes("type === 'addQuestProgress'") && executeJs.includes("type === 'clearQuests'"));
  check('flow module defaults the quest conditions to level triggers',
    flowJs.includes("t === 'questComplete'") && flowJs.includes("t === 'questProgress'"));

  // Catalog: eight Quest blocks, schema-clean.
  const catSb = {}; catSb.window = catSb; vm.createContext(catSb);
  vm.runInContext(fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8'), catSb,
    { filename: 'block-catalog.js' });
  const catalog = catSb.HydraBlockCatalog;
  const qBlocks = catalog.blocks.filter(b => b.category === 'Quest');
  check('catalog carries eight Quest blocks',
    qBlocks.length === 8, qBlocks.map(b => b.label).join(', '));
  const labels = qBlocks.map(b => b.label).sort();
  check('Quest blocks are the six actions + two conditions',
    JSON.stringify(labels) === JSON.stringify(['Add Quest Progress', 'Clear Quests', 'Complete Quest', 'Quest Complete', 'Quest Progress', 'Read Quest Progress', 'Reset Quest', 'Set Quest Progress'].sort()),
    labels.join(', '));
  const findings = catalog.validateCatalog();
  check('catalog validates clean with the Quest blocks', findings.length === 0,
    JSON.stringify(findings.slice(0, 3)));
  const ref = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');
  check('every Quest block is documented in the block reference',
    qBlocks.every(b => ref.includes(b.label)), qBlocks.filter(b => !ref.includes(b.label)).map(b => b.label).join(', '));
  const guide = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');
  check('user guide has a Quests section', guide.includes('## Quests'));
}

process.exit(failures === 0 ? 0 : 1);
