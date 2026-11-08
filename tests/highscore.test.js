// Unit tests for hydra/hydra-highscore.js — the shared local high-score
// table (P4 Advanced batch 12: the ranked leaderboard a game keeps).
//
// Pure logic: table-config normalization (repairs, defaults, caps),
// the ranked table (submit / qualify / read / count / list / clear),
// per-game storage (key, serialize/parse, load/save), and the
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
sandbox.window = sandbox; // hydra-highscore.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-highscore.js'), 'utf8'),
  sandbox, { filename: 'hydra-highscore.js' });
const H = sandbox.HydraHighScore;

check('HydraHighScore exposed with helpers',
  !!H && typeof H.normalizeHighScoreConfig === 'function' &&
  typeof H.createHighScoreRuntime === 'function' &&
  typeof H.submitScore === 'function' && typeof H.isHighScore === 'function' &&
  typeof H.readHighScore === 'function' && typeof H.highScoreCount === 'function' &&
  typeof H.highScoreList === 'function' && typeof H.clearHighScores === 'function' &&
  typeof H.highScoreKey === 'function' && typeof H.serializeEntries === 'function' &&
  typeof H.parseEntries === 'function' && typeof H.safeStorage === 'function' &&
  typeof H.loadEntries === 'function' && typeof H.saveEntries === 'function' &&
  typeof H.isHighScoreAction === 'function' && typeof H.isHighScoreCondition === 'function');
check('factorySource is a self-contained function string',
  typeof H.factorySource === 'string' && H.factorySource.includes('hydraHighScoreFactory'));
check('storage prefix is hydraHighScores:',
  H.STORAGE_PREFIX === 'hydraHighScores:');
check('defaults are max 10 entries, cap 50, default name Player',
  H.DEFAULT_MAX_ENTRIES === 10 && H.MAX_ENTRIES_CAP === 50 && H.DEFAULT_NAME === 'Player');

function guardConfig() {
  return { maxEntries: 3, defaultName: 'Player' };
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

// --- config normalization ---
{
  check('null config normalizes to the default object',
    JSON.stringify(H.normalizeHighScoreConfig(null)) === '{"maxEntries":10,"defaultName":"Player"}');
  check('a non-object config normalizes to the default object',
    JSON.stringify(H.normalizeHighScoreConfig('junk')) === '{"maxEntries":10,"defaultName":"Player"}');
  const cfg = { maxEntries: 3, defaultName: ' Alex ' };
  const norm = H.normalizeHighScoreConfig(cfg);
  check('normalization is in place (same object identity)', norm === cfg, 'identity changed');
  check('maxEntries keeps a valid integer', cfg.maxEntries === 3);
  check('defaultName trims', cfg.defaultName === 'Alex');
  check('maxEntries below 1 reads as the 10 default',
    H.normalizeHighScoreConfig({ maxEntries: 0, defaultName: 'Player' }).maxEntries === 10 &&
    H.normalizeHighScoreConfig({ maxEntries: -5, defaultName: 'Player' }).maxEntries === 10);
  check('maxEntries above the 50 cap reads as 50',
    H.normalizeHighScoreConfig({ maxEntries: 99, defaultName: 'Player' }).maxEntries === 50);
  check('a fractional maxEntries floors',
    H.normalizeHighScoreConfig({ maxEntries: 7.8, defaultName: 'Player' }).maxEntries === 7);
  check('a non-numeric maxEntries reads as the 10 default',
    H.normalizeHighScoreConfig({ maxEntries: 'many', defaultName: 'Player' }).maxEntries === 10);
  check('a blank defaultName falls back to Player',
    H.normalizeHighScoreConfig({ maxEntries: 10, defaultName: '  ' }).defaultName === 'Player');
  check('a missing defaultName falls back to Player',
    H.normalizeHighScoreConfig({ maxEntries: 10 }).defaultName === 'Player');
  check('a long defaultName caps at 32 characters',
    H.normalizeHighScoreConfig({ maxEntries: 10, defaultName: 'x'.repeat(40) }).defaultName.length === 32);
}

// --- fresh runtime ---
{
  const rt = H.createHighScoreRuntime();
  check('fresh runtime carries no entries',
    rt && Array.isArray(rt.entries) && rt.entries.length === 0);
  check('highScoreCount reads 0 on a fresh runtime', H.highScoreCount(rt) === 0);
  check('highScoreList reads empty on a fresh runtime',
    JSON.stringify(H.highScoreList(rt)) === '[]');
  check('readHighScore reads null on a fresh runtime', H.readHighScore(rt, 1) === null);
  check('isHighScore reads true on a fresh runtime (the table has room)',
    H.isHighScore(rt, guardConfig(), 0) === true);
  check('a runtime seeded from stored entries keeps them best first', (() => {
    const seeded = H.createHighScoreRuntime([
      { name: 'Bob', score: 50, date: 100 },
      { name: 'Alex', score: 200, date: 200 },
      { name: 'Cid', score: 50, date: 50 }
    ], guardConfig());
    const list = H.highScoreList(seeded);
    return list.length === 3 && list[0].name === 'Alex' && list[0].score === 200 &&
      list[1].name === 'Cid' && list[2].name === 'Bob';
  })());
  check('ties go to the earlier date (first to reach a score ranks higher)', (() => {
    const seeded = H.createHighScoreRuntime([
      { name: 'Late', score: 100, date: 200 },
      { name: 'Early', score: 100, date: 100 }
    ], guardConfig());
    return H.highScoreList(seeded)[0].name === 'Early';
  })());
  check('a runtime seeded with corrupt entries ignores them', (() => {
    const seeded = H.createHighScoreRuntime([
      { name: 'Alex', score: 100, date: 1 },
      null, 'junk',
      { name: '  ', score: 500, date: 2 },
      { name: 'Bob', score: 'lots', date: 3 },
      { name: 'Cid', score: NaN, date: 4 }
    ], guardConfig());
    return H.highScoreCount(seeded) === 1 && H.readHighScore(seeded, 1).name === 'Alex';
  })());
  check('a seeded runtime caps at the config maxEntries', (() => {
    const seeded = H.createHighScoreRuntime([
      { name: 'A', score: 300, date: 1 },
      { name: 'B', score: 200, date: 2 },
      { name: 'C', score: 100, date: 3 },
      { name: 'D', score: 50, date: 4 }
    ], guardConfig());
    return H.highScoreCount(seeded) === 3 &&
      JSON.stringify(H.highScoreList(seeded).map(e => e.name)) === '["A","B","C"]';
  })());
  check('highScoreList returns copies (mutating one leaves the table alone)', (() => {
    const rt2 = H.createHighScoreRuntime([{ name: 'Alex', score: 100, date: 1 }], guardConfig());
    const list = H.highScoreList(rt2);
    list[0].score = 999;
    return H.readHighScore(rt2, 1).score === 100;
  })());
}

// --- submit ---
{
  const rt = H.createHighScoreRuntime([], guardConfig());
  const h = makeHooks();
  check('submit on a null runtime stays quiet', H.submitScore(null, guardConfig(), 'Alex', 100, h.hooks) === 0);
  check('submit with a non-numeric score warns and holds',
    H.submitScore(rt, guardConfig(), 'Alex', 'lots', h.hooks) === 0 && H.highScoreCount(rt) === 0 &&
    h.writes.some(w => w[0] === 'warn' && /not a number/.test(w[1])),
    JSON.stringify(h.writes));
  check('submit with a NaN score warns and holds',
    H.submitScore(rt, guardConfig(), 'Alex', NaN, h.hooks) === 0 && H.highScoreCount(rt) === 0);
  check('submit stores the score and returns rank 1',
    H.submitScore(rt, guardConfig(), 'Alex', 100, h.hooks) === 1 &&
    H.readHighScore(rt, 1).name === 'Alex' && H.readHighScore(rt, 1).score === 100);
  check('submit persists on change', h.persists.length === 1, JSON.stringify(h.persists));
  check('a better score takes rank 1 and pushes the old one down',
    H.submitScore(rt, guardConfig(), 'Bob', 200, h.hooks) === 1 &&
    H.readHighScore(rt, 1).name === 'Bob' && H.readHighScore(rt, 2).name === 'Alex' &&
    h.persists.length === 2);
  check('a worse score takes the last rank',
    H.submitScore(rt, guardConfig(), 'Cid', 50, h.hooks) === 3 &&
    H.readHighScore(rt, 3).name === 'Cid' && h.persists.length === 3);
  check('a score below the lowest entry on a full table returns 0 and does not persist',
    H.submitScore(rt, guardConfig(), 'Dee', 10, h.hooks) === 0 &&
    H.highScoreCount(rt) === 3 && h.persists.length === 3);
  check('a score tied with the lowest entry on a full table does not displace it',
    H.submitScore(rt, guardConfig(), 'Eli', 50, h.hooks) === 0 &&
    H.highScoreCount(rt) === 3 && H.readHighScore(rt, 3).name === 'Cid');
  check('a score beating the lowest entry on a full table bumps it and returns the rank',
    H.submitScore(rt, guardConfig(), 'Fay', 75, h.hooks) === 3 &&
    H.readHighScore(rt, 3).name === 'Fay' && H.highScoreCount(rt) === 3 &&
    H.readHighScore(rt, 4) === null && h.persists.length === 4);
  check('a blank name falls back to the config default name', (() => {
    const rt2 = H.createHighScoreRuntime([], guardConfig());
    return H.submitScore(rt2, guardConfig(), '  ', 10, h.hooks) === 1 &&
      H.readHighScore(rt2, 1).name === 'Player';
  })());
  check('a long name caps at 32 characters on submit', (() => {
    const rt2 = H.createHighScoreRuntime([], guardConfig());
    H.submitScore(rt2, guardConfig(), 'x'.repeat(40), 10, h.hooks);
    return H.readHighScore(rt2, 1).name.length === 32;
  })());
  check('a zero score submits (0 is a score, not a blank)', (() => {
    const rt2 = H.createHighScoreRuntime([], guardConfig());
    return H.submitScore(rt2, guardConfig(), 'Alex', 0, h.hooks) === 1 &&
      H.readHighScore(rt2, 1).score === 0;
  })());
  check('a negative score submits at the bottom', (() => {
    const rt2 = H.createHighScoreRuntime([{ name: 'Alex', score: 10, date: 1 }], guardConfig());
    return H.submitScore(rt2, guardConfig(), 'Bob', -5, h.hooks) === 2 &&
      H.readHighScore(rt2, 2).score === -5;
  })());
}

// --- qualify / read / count ---
{
  const rt = H.createHighScoreRuntime([
    { name: 'Alex', score: 200, date: 1 },
    { name: 'Bob', score: 100, date: 2 },
    { name: 'Cid', score: 50, date: 3 }
  ], guardConfig());
  check('isHighScore reads true while the table has room',
    H.isHighScore(H.createHighScoreRuntime([], guardConfig()), guardConfig(), 0) === true);
  check('isHighScore reads true for a score beating the lowest entry',
    H.isHighScore(rt, guardConfig(), 75) === true);
  check('isHighScore reads false for a score below the lowest entry on a full table',
    H.isHighScore(rt, guardConfig(), 10) === false);
  check('isHighScore reads false for a score tied with the lowest entry on a full table',
    H.isHighScore(rt, guardConfig(), 50) === false);
  check('isHighScore reads false for a non-numeric score',
    H.isHighScore(rt, guardConfig(), 'lots') === false);
  check('isHighScore reads false on a null runtime',
    H.isHighScore(null, guardConfig(), 999) === false);
  check('readHighScore reads the rank 1 entry',
    JSON.stringify(H.readHighScore(rt, 1)) === '{"name":"Alex","score":200,"date":1}');
  check('readHighScore reads a middle rank',
    H.readHighScore(rt, 2).name === 'Bob' && H.readHighScore(rt, 2).score === 100);
  check('readHighScore reads null past the end of the table',
    H.readHighScore(rt, 4) === null && H.readHighScore(rt, 99) === null);
  check('readHighScore reads null for rank 0 and negative ranks',
    H.readHighScore(rt, 0) === null && H.readHighScore(rt, -2) === null);
  check('readHighScore floors a fractional rank',
    H.readHighScore(rt, 1.9).name === 'Alex');
  check('readHighScore reads null for a non-numeric rank',
    H.readHighScore(rt, 'first') === null);
  check('highScoreCount counts the table', H.highScoreCount(rt) === 3);
  check('highScoreCount on a null runtime reads 0', H.highScoreCount(null) === 0);
  check('highScoreList stays sorted best first',
    JSON.stringify(H.highScoreList(rt).map(e => e.score)) === '[200,100,50]');
}

// --- clear ---
{
  const rt = H.createHighScoreRuntime([{ name: 'Alex', score: 100, date: 1 }], guardConfig());
  const h = makeHooks();
  check('clear empties the table and persists',
    H.clearHighScores(rt, h.hooks) === true && H.highScoreCount(rt) === 0 &&
    h.persists.length === 1, JSON.stringify(h.persists));
  check('clearing an empty table changes nothing and does not persist again',
    H.clearHighScores(rt, h.hooks) === false && h.persists.length === 1);
  check('clear on a null runtime stays quiet', H.clearHighScores(null) === false);
}

// --- storage ---
{
  check('highScoreKey carries the project id',
    H.highScoreKey('my-game') === 'hydraHighScores:my-game');
  check('highScoreKey sanitizes hostile ids',
    H.highScoreKey('My Game! 1/2') === 'hydraHighScores:My_Game__1_2',
    H.highScoreKey('My Game! 1/2'));
  check('highScoreKey caps long ids at 64 chars',
    H.highScoreKey('x'.repeat(100)).length === 'hydraHighScores:'.length + 64);
  check('highScoreKey falls back to default for blank ids',
    H.highScoreKey('') === 'hydraHighScores:default' &&
    H.highScoreKey(null) === 'hydraHighScores:default');
  check('serialize/parse round-trips the table', (() => {
    const rt = H.createHighScoreRuntime([
      { name: 'Alex', score: 200, date: 5 },
      { name: 'Bob', score: 100, date: 6 }
    ], guardConfig());
    const s = H.serializeEntries(rt);
    return s === '[{"name":"Alex","score":200,"date":5},{"name":"Bob","score":100,"date":6}]' &&
      JSON.stringify(H.parseEntries(s)) === s;
  })());
  check('parseEntries reads corrupt bytes as empty',
    JSON.stringify(H.parseEntries('not json')) === '[]' &&
    JSON.stringify(H.parseEntries('{"a":1}')) === '[]' &&
    JSON.stringify(H.parseEntries(null)) === '[]' &&
    JSON.stringify(H.parseEntries('[{"name":"Alex","score":100,"date":1},{"name":"Bob","score":"lots","date":2}]')) === '[{"name":"Alex","score":100,"date":1}]');
  check('load/save round-trips through a stub storage', (() => {
    const st = makeStorage();
    const rt = H.createHighScoreRuntime([{ name: 'Alex', score: 200, date: 5 }], guardConfig());
    const saved = H.saveEntries(st, 'game-1', H.highScoreList(rt));
    const loaded = H.loadEntries(st, 'game-1');
    return saved === true &&
      JSON.stringify(loaded) === '[{"name":"Alex","score":200,"date":5}]' &&
      st.data['hydraHighScores:game-1'] === '[{"name":"Alex","score":200,"date":5}]';
  })());
  check('two games never share a leaderboard', (() => {
    const st = makeStorage();
    H.saveEntries(st, 'game-1', [{ name: 'Alex', score: 200, date: 1 }]);
    H.saveEntries(st, 'game-2', [{ name: 'Bob', score: 100, date: 2 }]);
    return JSON.stringify(H.loadEntries(st, 'game-1')) === '[{"name":"Alex","score":200,"date":1}]' &&
      JSON.stringify(H.loadEntries(st, 'game-2')) === '[{"name":"Bob","score":100,"date":2}]';
  })());
  check('load reads empty for a missing key and a missing storage',
    JSON.stringify(H.loadEntries(makeStorage(), 'no-such-game')) === '[]' &&
    JSON.stringify(H.loadEntries(null, 'game-1')) === '[]');
  check('save returns false without storage', H.saveEntries(null, 'game-1', []) === false);
  check('save returns false for a non-array entry list',
    H.saveEntries(makeStorage(), 'game-1', 'Alex') === false);
  check('a throwing storage never breaks load or save', (() => {
    const bad = {
      getItem: function () { throw new Error('boom'); },
      setItem: function () { throw new Error('boom'); }
    };
    return JSON.stringify(H.loadEntries(bad, 'game-1')) === '[]' &&
      H.saveEntries(bad, 'game-1', []) === false;
  })());
  check('safeStorage returns null when localStorage is absent',
    H.safeStorage() === null);
}

// --- routing sets ---
{
  check('isHighScoreAction matches the three action blocks',
    H.isHighScoreAction('submitScore') && H.isHighScoreAction('clearHighScores') &&
    H.isHighScoreAction('readHighScore') &&
    !H.isHighScoreAction('submitAchievement') && !H.isHighScoreAction('isHighScore'));
  check('isHighScoreCondition matches the two condition blocks',
    H.isHighScoreCondition('isHighScore') && H.isHighScoreCondition('highScoreCount') &&
    !H.isHighScoreCondition('achievementCount') && !H.isHighScoreCondition('submitScore'));
}

// --- hostile input ---
{
  const h = makeHooks();
  check('a frozen runtime reads without throwing', (() => {
    const rt = H.createHighScoreRuntime([{ name: 'Alex', score: 100, date: 1 }], guardConfig());
    Object.freeze(rt.entries);
    return H.isHighScore(rt, guardConfig(), 200) === true;
  })());
  check('a throwing warn hook never breaks the submit', (() => {
    const rt = H.createHighScoreRuntime([], guardConfig());
    const bad = { warn: function () { throw new Error('boom'); } };
    return H.submitScore(rt, guardConfig(), 'Alex', 'lots', bad) === 0 && H.highScoreCount(rt) === 0;
  })());
  check('a throwing persist hook never breaks the submit', (() => {
    const rt = H.createHighScoreRuntime([], guardConfig());
    const bad = { warn: function () {}, persist: function () { throw new Error('boom'); } };
    return H.submitScore(rt, guardConfig(), 'Alex', 100, bad) === 1 &&
      H.highScoreCount(rt) === 1;
  })());
  check('a hostile table repairs to empty (count 0, room for any score)', (() => {
    const rt = { entries: 'not an array' };
    return H.isHighScore(rt, guardConfig(), 999) === true && H.highScoreCount(rt) === 0;
  })());
  check('readHighScore on a hostile runtime reads null',
    H.readHighScore({ entries: null }, 1) === null);
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

  const hsTag = html.indexOf('src="hydra-highscore.js');
  check('index.html loads hydra-highscore.js before player-runtime.js and script.js',
    hsTag !== -1 && hsTag < html.indexOf('src="player-runtime.js') && hsTag < html.indexOf('src="script.js'));
  check('index.html loads hydra-highscore.js after hydra-cutscene.js',
    hsTag !== -1 && html.indexOf('src="hydra-cutscene.js') < hsTag);
  check('index.html has a High Scores inspector tab',
    html.includes('data-inspector-tab="highscores"') && html.includes('data-inspector-panel="highscores"'));
  check('index.html has the High Scores panel',
    html.includes('id="highscores-panel"'));
  check('script.js exposes the High Scores tab panel + init + config accessors',
    scriptJs.includes('function renderHighScoresPanel') && scriptJs.includes('function initHighScoresPanel') &&
    scriptJs.includes('function getMutableHighScoreConfig') && scriptJs.includes('initHighScoresPanel()'));
  check('script.js hands the project high-score config + id to the preview runtime',
    scriptJs.includes('function getProjectHighScores') && scriptJs.includes('getProjectHighScores,') &&
    scriptJs.includes('function getProjectId') && scriptJs.includes('getProjectId,'));
  check('player-runtime.js hard-guards on HydraHighScore',
    playerJs.includes("requires hydra-highscore.js (window.HydraHighScore)"));
  check('player-runtime.js inlines HydraHighScore into exports',
    playerJs.includes("'HydraHighScore', global.HydraHighScore && global.HydraHighScore.factorySource"));
  check('player-runtime.js creates the ranked table from storage + config',
    playerJs.includes('highScoreTable: HydraHighScore.createHighScoreRuntime(') &&
    playerJs.includes('highScoreConfig: HydraHighScore.normalizeHighScoreConfig(project.highScores)') &&
    playerJs.includes('HydraHighScore.loadEntries(HydraHighScore.safeStorage(), project.id)'));
  check('player-runtime.js routes high-score blocks through the shared modules',
    playerJs.includes('HydraHighScore.isHighScoreCondition(type)') &&
    playerJs.includes('HydraHighScore.isHighScoreAction(type)') &&
    playerJs.includes('highScoreTable: state.highScoreTable') && playerJs.includes('highScoreModule: HydraHighScore'));
  check('preview runtime loads the ranked table from storage on first access',
    previewJs.includes('function highScoreRuntime') &&
    previewJs.includes('H.loadEntries(H.safeStorage()') &&
    previewJs.includes("hostCall('getProjectId'"));
  check('preview runtime persists on change and never resets high scores',
    previewJs.includes('function persistHighScores') &&
    previewJs.includes('highScoreHooks') &&
    !previewJs.includes('resetHighScore'));
  check('preview runtime contexts carry the ranked table state',
    previewJs.includes('highScoreTable: highScoreRuntime()') && previewJs.includes("highScoreConfig: hostCall('getProjectHighScores'"));
  check('preview runtime exposes a clear-table entry for the editor tab',
    previewJs.includes('clearHighScoreTable: clearHighScoreTable') &&
    previewJs.includes('function clearHighScoreTable'));
  check('hydra-universal.js defaults project.highScores to the 10-entry table',
    universalJs.includes("project.highScores = { maxEntries: 10, defaultName: 'Player' };"));
  check('shared conditions module evaluates the two high-score conditions',
    conditionsJs.includes("case 'isHighScore'") && conditionsJs.includes("case 'highScoreCount'"));
  check('shared execute module runs the three high-score actions',
    executeJs.includes("isType(ctx.highScoreModule, 'isHighScoreAction', type)") &&
    executeJs.includes("type === 'submitScore'") && executeJs.includes("type === 'readHighScore'"));
  check('flow module defaults the high-score conditions to level triggers',
    flowJs.includes("t === 'isHighScore'") && flowJs.includes("t === 'highScoreCount'"));

  // Catalog: five High Score blocks, schema-clean.
  const catSb = {}; catSb.window = catSb; vm.createContext(catSb);
  vm.runInContext(fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8'), catSb,
    { filename: 'block-catalog.js' });
  const catalog = catSb.HydraBlockCatalog;
  const hsBlocks = catalog.blocks.filter(b => b.category === 'High Score');
  check('catalog carries five High Score blocks',
    hsBlocks.length === 5, hsBlocks.map(b => b.label).join(', '));
  const labels = hsBlocks.map(b => b.label).sort();
  check('High Score blocks are the three actions + two conditions',
    JSON.stringify(labels) === JSON.stringify(['Clear High Scores', 'High Score Count', 'Is High Score', 'Read High Score', 'Submit Score'].sort()),
    labels.join(', '));
  const findings = catalog.validateCatalog();
  check('catalog validates clean with the High Score blocks', findings.length === 0,
    JSON.stringify(findings.slice(0, 3)));
  const ref = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');
  check('every High Score block is documented in the block reference',
    hsBlocks.every(b => ref.includes(b.label)), hsBlocks.filter(b => !ref.includes(b.label)).map(b => b.label).join(', '));
  const guide = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');
  check('user guide has a High Scores section', guide.includes('## High Scores'));
}

process.exit(failures === 0 ? 0 : 1);
