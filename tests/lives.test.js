// Unit tests for hydra/hydra-lives.js — the shared lives & game over
// system (P4 Advanced batch 25: lives & game over, beginner edition).
//
// Pure logic: the per-run lives count (set / add / lose / read), the
// derived game-over read, and the routing sets. Nothing here touches
// the DOM; both runtimes delegate to this module. Static checks at the
// end pin the wiring: catalog blocks, both runtimes' dispatch, the
// flow trigger mode, the scene-reset survival (lives outlive a scene
// switch, like the quest log), and the docs.

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
sandbox.window = sandbox; // hydra-lives.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-lives.js'), 'utf8'),
  sandbox, { filename: 'hydra-lives.js' });
const L = sandbox.HydraLives;

check('HydraLives exposed with helpers',
  !!L && typeof L.createLivesState === 'function' &&
  typeof L.normalizeLives === 'function' &&
  typeof L.normalizeLivesAmount === 'function' &&
  typeof L.livesOf === 'function' &&
  typeof L.isGameOver === 'function' &&
  typeof L.setLives === 'function' &&
  typeof L.addLives === 'function' &&
  typeof L.loseLives === 'function' &&
  typeof L.isLivesAction === 'function' &&
  typeof L.isLivesCondition === 'function');
check('factorySource is a non-empty string',
  typeof L.factorySource === 'string' && L.factorySource.length > 100 &&
  L.factorySource.includes('hydraLivesFactory'));

// --- state + normalizers ---
check('createLivesState starts with the default 3 lives',
  JSON.stringify(L.createLivesState()) === JSON.stringify({ lives: 3 }));
check('normalizeLives clamps to a whole 0..99 with a 3 default',
  L.normalizeLives(3) === 3 && L.normalizeLives(0) === 0 &&
  L.normalizeLives(-5) === 0 && L.normalizeLives(150) === 99 &&
  L.normalizeLives(2.7) === 2 && L.normalizeLives('5') === 5 &&
  L.normalizeLives('oops') === 3 && L.normalizeLives(null) === 3 &&
  L.normalizeLives(undefined) === 3);
check('normalizeLivesAmount is a whole 0..99 with a 1 default (0 = no-op)',
  L.normalizeLivesAmount(1) === 1 && L.normalizeLivesAmount(0) === 0 &&
  L.normalizeLivesAmount(-2) === 0 && L.normalizeLivesAmount(200) === 99 &&
  L.normalizeLivesAmount(1.9) === 1 && L.normalizeLivesAmount('oops') === 1 &&
  L.normalizeLivesAmount(null) === 1);

// --- reads ---
check('livesOf reads the count, and a missing state reads as the default 3',
  L.livesOf(L.createLivesState()) === 3 &&
  L.livesOf(null) === 3 && L.livesOf('nope') === 3 &&
  L.livesOf({}) === 3 && L.livesOf({ lives: 1 }) === 1);
check('livesOf reads a negative count as 0 and a non-numeric count as 3',
  L.livesOf({ lives: -2 }) === 0 && L.livesOf({ lives: 'oops' }) === 3 &&
  L.livesOf({ lives: [] }) === 3);
check('isGameOver is false with lives left and true at 0',
  L.isGameOver(L.createLivesState()) === false &&
  L.isGameOver({ lives: 1 }) === false &&
  L.isGameOver({ lives: 0 }) === true &&
  L.isGameOver(null) === false &&
  L.isGameOver({ lives: -1 }) === true);

// --- writes ---
{
  const st = L.createLivesState();
  check('setLives writes the count and returns it',
    L.setLives(st, 5) === 5 && L.livesOf(st) === 5);
  check('setLives clamps to 0..99',
    L.setLives(st, 150) === 99 && L.setLives(st, -3) === 0 &&
    L.livesOf(st) === 0);
  check('game over is derived: setting 0 turns it on at once',
    L.isGameOver(st) === true);
  check('addLives tops the count up and clears game over (a continue)',
    L.addLives(st, 2) === 2 && L.isGameOver(st) === false);
  check('addLives clamps at 99',
    L.addLives(st, 200) === 99 && L.livesOf(st) === 99);
  check('addLives with a bad amount reads as the default 1',
    L.setLives(st, 3) === 3 && L.addLives(st, 'oops') === 4);
  check('loseLives spends lives one at a time by default',
    L.loseLives(st, 1) === 3 && L.livesOf(st) === 3);
  check('loseLives clamps at 0 and never goes negative',
    L.loseLives(st, 50) === 0 && L.livesOf(st) === 0 &&
    L.loseLives(st, 1) === 0);
  check('losing the last life turns game over on, and gaining one clears it again',
    L.isGameOver(st) === true && L.addLives(st, 1) === 1 &&
    L.isGameOver(st) === false && L.loseLives(st, 1) === 0 &&
    L.isGameOver(st) === true);
  check('setLives reads a bad value as the default 3',
    L.setLives(st, 'oops') === 3 && L.setLives(st, null) === 3);
  check('setLives with a 0 amount of nothing still writes 0 (a game that starts already over)',
    L.setLives(st, 0) === 0 && L.isGameOver(st) === true);
}
check('writes stay quiet on a missing state',
  L.setLives(null, 5) === null && L.addLives(null, 1) === null &&
  L.loseLives(null, 1) === null && L.setLives('nope', 5) === null);

// --- routing ---
check('routing sets cover the four actions and two conditions',
  L.isLivesAction('setLives') && L.isLivesAction('addLives') &&
  L.isLivesAction('loseLife') && L.isLivesAction('readLives') &&
  !L.isLivesAction('lives') && !L.isLivesAction('gameOver') &&
  !L.isLivesAction('setCheckpoint') && !L.isLivesAction(null) &&
  L.isLivesCondition('lives') && L.isLivesCondition('gameOver') &&
  !L.isLivesCondition('setLives') && !L.isLivesCondition(null));

// --- hostile input ---
check('hostile input degrades to safe defaults',
  L.normalizeLives([]) === 3 &&
  L.normalizeLivesAmount([]) === 1 &&
  L.livesOf({ lives: {} }) === 3 &&
  L.isGameOver({}) === false);

// --- static wiring ---
{
  const html = fs.readFileSync(path.join(HYDRA, 'index.html'), 'utf8');
  const lvTag = html.indexOf('src="hydra-lives.js');
  check('index.html loads hydra-lives.js before player-runtime.js and script.js',
    lvTag !== -1 && lvTag < html.indexOf('src="player-runtime.js') && lvTag < html.indexOf('src="script.js'));
  check('index.html loads hydra-lives.js after hydra-spawn.js',
    lvTag > html.indexOf('src="hydra-spawn.js'));
  const playerJs = fs.readFileSync(path.join(HYDRA, 'player-runtime.js'), 'utf8');
  check('player-runtime.js hard-guards on HydraLives',
    playerJs.includes("if (!HydraLives || typeof HydraLives.createLivesState !== 'function')") &&
    playerJs.includes('HydraScript player runtime requires hydra-lives.js'));
  check('player-runtime.js inlines HydraLives into exports',
    playerJs.includes("'HydraLives', global.HydraLives && global.HydraLives.factorySource"));
  check('player-runtime.js classifies lives blocks for the dispatch',
    playerJs.includes('HydraLives.isLivesCondition(type)') &&
    playerJs.includes('HydraLives.isLivesAction(type)'));
  check('player-runtime.js mints the lives state at boot and exposes the module to both contexts',
    playerJs.includes('lives: HydraLives.createLivesState()') &&
    playerJs.includes('livesModule: HydraLives') &&
    playerJs.includes('lives: state.lives'));
  const previewJs = fs.readFileSync(path.join(HYDRA, 'hydra-previewruntime.js'), 'utf8');
  check('preview runtime exposes the module to both contexts',
    (previewJs.match(/livesModule: mod\('Lives'\)/g) || []).length === 2 &&
    previewJs.includes('lives: livesRuntime()'));
  check('preview runtime mints the lives state lazily and resets it on a fresh run only',
    previewJs.includes('function livesRuntime()') &&
    previewJs.includes('function resetLivesRuntime()') &&
    previewJs.includes('resetLivesRuntime();'));
  check('preview runtime never resets lives on a scene switch (no scene-reset entry)',
    !previewJs.includes('createLivesState: function'));
  const executeJs = fs.readFileSync(path.join(HYDRA, 'hydra-execute.js'), 'utf8');
  check('shared execute module runs the four lives actions',
    executeJs.includes("if (isType(ctx.livesModule, 'isLivesAction', type))") &&
    executeJs.includes("type === 'setLives'") &&
    executeJs.includes("type === 'addLives'") &&
    executeJs.includes("type === 'loseLife'") &&
    executeJs.includes("type === 'readLives'") &&
    executeJs.includes('LM.setLives(ctx.lives, slv.value)') &&
    executeJs.includes('LM.addLives(ctx.lives, alv.value)') &&
    executeJs.includes('LM.loseLives(ctx.lives, llv.value)') &&
    executeJs.includes('LM.livesOf(ctx.lives)'));
  const conditionsJs = fs.readFileSync(path.join(HYDRA, 'hydra-conditions.js'), 'utf8');
  check('shared conditions module reads Lives and Game Over',
    conditionsJs.includes("case 'lives':") &&
    conditionsJs.includes("case 'gameOver':") &&
    conditionsJs.includes('LMm.livesOf(ctx.lives)') &&
    conditionsJs.includes('LMm2.isGameOver(ctx.lives)'));
  check('shared conditions module does not freeze the lives reads while paused',
    !conditionsJs.split('FROZEN_WHILE_PAUSED = [')[1].split('];')[0].includes("'lives'") &&
    !conditionsJs.split('FROZEN_WHILE_PAUSED = [')[1].split('];')[0].includes('gameOver'));
  const flowSb = {};
  flowSb.window = flowSb;
  vm.createContext(flowSb);
  vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-flow.js'), 'utf8'),
    flowSb, { filename: 'hydra-flow.js' });
  const F = flowSb.HydraFlow;
  check('flow module reads Lives as a level trigger and Game Over as an edge trigger',
    F.defaultTriggerMode('lives') === 'level' &&
    F.defaultTriggerMode('gameOver') === 'edge');
  const resetSb = {};
  resetSb.window = resetSb;
  vm.createContext(resetSb);
  vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-scenereset.js'), 'utf8'),
    resetSb, { filename: 'hydra-scenereset.js' });
  const SR = resetSb.HydraSceneReset;
  check('scene reset leaves the lives record untouched (lives survive a scene switch)',
    (() => {
      const lv = { lives: 1 };
      const state = { lives: lv };
      const ok = SR.resetSceneRuntime(state, { id: 1 }, {});
      return ok === true && state.lives === lv && state.lives.lives === 1;
    })() &&
    (() => {
      // Even with every hook wired, no hook rewrites the lives record.
      const lv = { lives: 2 };
      const state = { lives: lv };
      const ok = SR.resetSceneRuntime(state, { id: 2 }, {
        createParticleState: () => ({ particles: [] }),
        createDamageNumbers: () => ({ numbers: [] }),
        createRespawnState: () => ({ point: null, count: 0 }),
        createSpawnerState: () => ({ spawners: {} })
      });
      return ok === true && state.lives === lv && state.lives.lives === 2;
    })());
  const catalogJs = fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8');
  check('catalog carries the six lives blocks in the Lives category',
    catalogJs.includes("blockType: 'set-lives'") &&
    catalogJs.includes("runtimeType: 'setLives'") &&
    catalogJs.includes("blockType: 'add-lives'") &&
    catalogJs.includes("runtimeType: 'addLives'") &&
    catalogJs.includes("blockType: 'lose-life'") &&
    catalogJs.includes("runtimeType: 'loseLife'") &&
    catalogJs.includes("blockType: 'read-lives'") &&
    catalogJs.includes("runtimeType: 'readLives'") &&
    catalogJs.includes("blockType: 'lives'") &&
    catalogJs.includes("runtimeType: 'lives'") &&
    catalogJs.includes("blockType: 'game-over'") &&
    catalogJs.includes("runtimeType: 'gameOver'") &&
    catalogJs.includes("key: 'lives', label: 'Lives'") &&
    catalogJs.includes("key: 'amount', label: 'Amount'") &&
    catalogJs.includes("key: 'varName', label: 'Into variable'"));
  const refMd = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');
  check('block reference documents all six lives blocks',
    refMd.includes('Set Lives') && refMd.includes('Add Lives') &&
    refMd.includes('Lose Life') && refMd.includes('Read Lives') &&
    refMd.includes('Game Over') && refMd.includes('### Lives (6)'));
  const guideMd = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');
  check('user guide covers lives and game over',
    guideMd.includes('Lives and game over') && guideMd.includes('Game Over') &&
    guideMd.includes('Lose Life'));
}

process.exit(failures === 0 ? 0 : 1);
