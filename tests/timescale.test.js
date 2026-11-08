// Unit tests for hydra/hydra-timescale.js — the shared time scale /
// slow motion (P4 Advanced batch 13: the whole game clock runs faster
// or slower).
//
// Pure logic: scale normalization (clamp 0..4, default 1), the per-run
// runtime (set / reset / read), the scaled frame step (capped at the
// engine's 3-unit dt cap), the game-clock debt banking (named timers
// slow with the world), and the action/condition routing sets.
// Nothing here touches the DOM; both runtimes delegate to this module.
// Static checks at the end pin the wiring: catalog blocks, both
// runtimes' dispatch and dt scaling, the clock-debt plumbing, and the
// export inlining.

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
sandbox.window = sandbox; // hydra-timescale.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-timescale.js'), 'utf8'),
  sandbox, { filename: 'hydra-timescale.js' });
const T = sandbox.HydraTimeScale;

check('HydraTimeScale exposed with helpers',
  !!T && typeof T.normalizeTimeScale === 'function' &&
  typeof T.createTimeScaleRuntime === 'function' &&
  typeof T.timeScaleOf === 'function' && typeof T.setTimeScale === 'function' &&
  typeof T.resetTimeScale === 'function' && typeof T.scaledDt === 'function' &&
  typeof T.noteScaledFrame === 'function' &&
  typeof T.isTimeScaleAction === 'function' && typeof T.isTimeScaleCondition === 'function');
check('factorySource is a self-contained function string',
  typeof T.factorySource === 'string' && T.factorySource.includes('hydraTimeScaleFactory'));
check('constants are default 1, range 0..4, dt cap 3',
  T.DEFAULT_SCALE === 1 && T.MIN_SCALE === 0 && T.MAX_SCALE === 4 && T.DT_CAP === 3);

function makeHooks() {
  const warns = [];
  return {
    warns,
    hooks: { warn: function (msg) { warns.push(msg); } }
  };
}

// --- normalization ---
{
  check('a plain 1 normalizes to 1', T.normalizeTimeScale(1) === 1);
  check('slow motion 0.3 keeps', T.normalizeTimeScale(0.3) === 0.3);
  check('double speed 2 keeps', T.normalizeTimeScale(2) === 2);
  check('zero keeps (a frozen world is legal)', T.normalizeTimeScale(0) === 0);
  check('below 0 clamps to 0', T.normalizeTimeScale(-1) === 0);
  check('above 4 clamps to 4', T.normalizeTimeScale(9) === 4);
  check('a non-numeric scale reads as the 1 default',
    T.normalizeTimeScale('fast') === 1 && T.normalizeTimeScale(NaN) === 1 &&
    T.normalizeTimeScale(undefined) === 1 && T.normalizeTimeScale(null) === 1);
  check('a numeric string coerces', T.normalizeTimeScale('0.5') === 0.5);
}

// --- fresh runtime + reads ---
{
  const rt = T.createTimeScaleRuntime();
  check('fresh runtime starts at normal speed',
    rt && rt.scale === 1 && T.timeScaleOf(rt) === 1);
  check('timeScaleOf reads 1 on a missing runtime',
    T.timeScaleOf(null) === 1 && T.timeScaleOf(undefined) === 1);
  check('timeScaleOf reads 1 on a corrupt scale',
    T.timeScaleOf({ scale: 'fast' }) === 1 && T.timeScaleOf({}) === 1);
  check('timeScaleOf clamps a hostile scale',
    T.timeScaleOf({ scale: 99 }) === 4 && T.timeScaleOf({ scale: -5 }) === 0);
}

// --- set / reset ---
{
  const rt = T.createTimeScaleRuntime();
  check('setTimeScale applies slow motion and returns it',
    T.setTimeScale(rt, 0.3) === 0.3 && rt.scale === 0.3);
  check('setTimeScale applies double speed',
    T.setTimeScale(rt, 2) === 2 && rt.scale === 2);
  check('setTimeScale clamps above 4', T.setTimeScale(rt, 10) === 4 && rt.scale === 4);
  check('setTimeScale clamps below 0', T.setTimeScale(rt, -2) === 0 && rt.scale === 0);
  const h = makeHooks();
  check('setTimeScale warns and holds on a non-numeric scale', (() => {
    T.setTimeScale(rt, 1);
    const before = rt.scale;
    const ret = T.setTimeScale(rt, 'fast', h.hooks);
    return ret === before && rt.scale === before && h.warns.length === 1;
  })(), JSON.stringify(h.warns));
  check('setTimeScale on a missing runtime reads as 1',
    T.setTimeScale(null, 0.5) === 1 && T.setTimeScale(undefined, 0.5) === 1);
  check('resetTimeScale returns to normal speed',
    T.setTimeScale(rt, 0.25) === 0.25 && T.resetTimeScale(rt) === 1 && rt.scale === 1);
  check('resetTimeScale on a missing runtime reads as 1',
    T.resetTimeScale(null) === 1 && T.resetTimeScale(undefined) === 1);
}

// --- scaled frame step ---
{
  const rt = T.createTimeScaleRuntime();
  check('scaledDt passes dt through at normal speed',
    T.scaledDt(1, rt) === 1 && T.scaledDt(2.5, rt) === 2.5);
  check('scaledDt halves the step at half speed',
    T.setTimeScale(rt, 0.5) === 0.5 && T.scaledDt(1, rt) === 0.5);
  check('scaledDt freezes the step at scale 0',
    T.setTimeScale(rt, 0) === 0 && T.scaledDt(1, rt) === 0);
  check('scaledDt doubles the step at double speed',
    T.setTimeScale(rt, 2) === 2 && T.scaledDt(1, rt) === 2);
  check('scaledDt never exceeds the 3-unit dt cap',
    T.setTimeScale(rt, 4) === 4 && T.scaledDt(3, rt) === 3 && T.scaledDt(2, rt) === 3);
  check('scaledDt reads 1 on a missing runtime',
    T.scaledDt(1, null) === 1 && T.scaledDt(1, undefined) === 1);
  check('scaledDt reads 0 on a bad dt',
    T.scaledDt(NaN, rt) === 0 && T.scaledDt('fast', rt) === 0 && T.scaledDt(-1, rt) === 0);
}

// --- game-clock debt banking ---
{
  const rt = T.createTimeScaleRuntime();
  function state(scale) {
    T.setTimeScale(rt, scale);
    return { paused: false, timeScale: rt, timeScaleDebtMs: 0 };
  }
  check('no debt banks at normal speed', (() => {
    const s = state(1);
    T.noteScaledFrame(s, 100);
    return s.timeScaleDebtMs === 0;
  })());
  check('half speed banks half the frame into the debt', (() => {
    const s = state(0.5);
    T.noteScaledFrame(s, 100);
    return s.timeScaleDebtMs === 50;
  })());
  check('slow motion banks most of the frame into the debt', (() => {
    const s = state(0.3);
    T.noteScaledFrame(s, 100);
    return Math.abs(s.timeScaleDebtMs - 70) < 0.001;
  })());
  check('double speed banks a negative debt (the clock runs ahead)', (() => {
    const s = state(2);
    T.noteScaledFrame(s, 100);
    return s.timeScaleDebtMs === -100;
  })());
  check('debt accumulates across frames', (() => {
    const s = state(0.5);
    T.noteScaledFrame(s, 100);
    T.noteScaledFrame(s, 100);
    T.noteScaledFrame(s, 100);
    return s.timeScaleDebtMs === 150;
  })());
  check('a paused frame banks nothing (notePausedFrame owns paused frames)', (() => {
    const s = state(0.5);
    s.paused = true;
    T.noteScaledFrame(s, 100);
    return s.timeScaleDebtMs === 0;
  })());
  check('a frozen world banks the whole frame', (() => {
    const s = state(0);
    T.noteScaledFrame(s, 100);
    return s.timeScaleDebtMs === 100;
  })());
  check('noteScaledFrame is a quiet no-op on bad input', (() => {
    const s = state(0.5);
    T.noteScaledFrame(null, 100);
    T.noteScaledFrame(undefined, 100);
    T.noteScaledFrame(s, NaN);
    T.noteScaledFrame(s, -50);
    T.noteScaledFrame(s, 0);
    T.noteScaledFrame({ paused: false }, 100);
    return s.timeScaleDebtMs === 0;
  })());
  check('a junk previous debt reads as 0, a negative one accumulates', (() => {
    const s = state(0.5);
    s.timeScaleDebtMs = 'junk';
    T.noteScaledFrame(s, 100);
    const first = s.timeScaleDebtMs === 50;
    s.timeScaleDebtMs = -20;
    T.noteScaledFrame(s, 100);
    return first && s.timeScaleDebtMs === 30;
  })());
  check('an explicit runtime banks the debt on a state with no timeScale field (the preview shape)', (() => {
    const s = { paused: false, timeScaleDebtMs: 0 };
    const rt2 = T.createTimeScaleRuntime();
    T.setTimeScale(rt2, 0.5);
    T.noteScaledFrame(s, 100, rt2);
    return s.timeScaleDebtMs === 50;
  })());
  check('an explicit null runtime reads as normal speed and banks nothing', (() => {
    const s = { paused: false, timeScaleDebtMs: 0 };
    T.noteScaledFrame(s, 100, null);
    return s.timeScaleDebtMs === 0;
  })());
}

// --- routing sets ---
{
  check('isTimeScaleAction routes the three actions',
    T.isTimeScaleAction('setTimeScale') && T.isTimeScaleAction('resetTimeScale') &&
    T.isTimeScaleAction('readTimeScale') && !T.isTimeScaleAction('timeScale') &&
    !T.isTimeScaleAction('setVariable'));
  check('isTimeScaleCondition routes the one condition',
    T.isTimeScaleCondition('timeScale') && !T.isTimeScaleCondition('setTimeScale') &&
    !T.isTimeScaleCondition('gamePaused'));
}

// --- hostile input ---
{
  check('a frozen runtime reads without throwing', (() => {
    const rt = T.createTimeScaleRuntime();
    Object.freeze(rt);
    return T.timeScaleOf(rt) === 1 && T.scaledDt(1, rt) === 1;
  })());
  check('a throwing warn hook never breaks the set', (() => {
    const rt = T.createTimeScaleRuntime();
    const bad = { warn: function () { throw new Error('boom'); } };
    return T.setTimeScale(rt, 'fast', bad) === 1 && rt.scale === 1;
  })());
  check('a throwing state never breaks the debt banking', (() => {
    const hostile = {};
    Object.defineProperty(hostile, 'paused', { get: function () { throw new Error('boom'); } });
    T.noteScaledFrame(hostile, 100);
    return true;
  })());
  check('setTimeScale on a hostile runtime reads as 1',
    T.setTimeScale({ scale: 1 }, 'fast') === 1);
}

// --- static wiring ---
{
  const html = fs.readFileSync(path.join(HYDRA, 'index.html'), 'utf8');
  const scriptJs = fs.readFileSync(path.join(HYDRA, 'script.js'), 'utf8');
  const playerJs = fs.readFileSync(path.join(HYDRA, 'player-runtime.js'), 'utf8');
  const previewJs = fs.readFileSync(path.join(HYDRA, 'hydra-previewruntime.js'), 'utf8');
  const pauseJs = fs.readFileSync(path.join(HYDRA, 'hydra-pause.js'), 'utf8');
  const resetJs = fs.readFileSync(path.join(HYDRA, 'hydra-scenereset.js'), 'utf8');
  const conditionsJs = fs.readFileSync(path.join(HYDRA, 'hydra-conditions.js'), 'utf8');
  const executeJs = fs.readFileSync(path.join(HYDRA, 'hydra-execute.js'), 'utf8');
  const flowJs = fs.readFileSync(path.join(HYDRA, 'hydra-flow.js'), 'utf8');

  const tsTag = html.indexOf('src="hydra-timescale.js');
  check('index.html loads hydra-timescale.js before player-runtime.js and script.js',
    tsTag !== -1 && tsTag < html.indexOf('src="player-runtime.js') && tsTag < html.indexOf('src="script.js'));
  check('index.html loads hydra-timescale.js after hydra-highscore.js',
    tsTag !== -1 && html.indexOf('src="hydra-highscore.js') < tsTag);
  check('player-runtime.js hard-guards on HydraTimeScale',
    playerJs.includes("requires hydra-timescale.js (window.HydraTimeScale)"));
  check('player-runtime.js inlines HydraTimeScale into exports',
    playerJs.includes("'HydraTimeScale', global.HydraTimeScale && global.HydraTimeScale.factorySource"));
  check('player-runtime.js creates the per-run time-scale runtime + clock debt',
    playerJs.includes('timeScale: HydraTimeScale.createTimeScaleRuntime(),') &&
    playerJs.includes('timeScaleDebtMs: 0,'));
  check('player-runtime.js scales the frame step once per frame',
    playerJs.includes('state.dt = HydraTimeScale.scaledDt(timing.dt, state.timeScale);'));
  check('player-runtime.js banks the clock debt every frame',
    playerJs.includes('HydraTimeScale.noteScaledFrame(state, timing.realMs, state.timeScale)'));
  check('player-runtime.js routes time-scale blocks through the shared modules',
    playerJs.includes('HydraTimeScale.isTimeScaleCondition(type)') &&
    playerJs.includes('HydraTimeScale.isTimeScaleAction(type)') &&
    playerJs.includes('timeScale: state.timeScale') && playerJs.includes('timeScaleModule: HydraTimeScale'));
  check('preview runtime holds the time-scale runtime per factory instance',
    previewJs.includes('function timeScaleRuntime') &&
    previewJs.includes("mod('TimeScale')") &&
    previewJs.includes('T.createTimeScaleRuntime'));
  const rgStart = previewJs.indexOf('function resetGame()');
  const rgEnd = previewJs.indexOf('function loadPreviewScene', rgStart);
  const rgBody = rgStart !== -1 ? previewJs.slice(rgStart, rgEnd) : '';
  check('preview runtime resets the scale on a fresh run (resetGame)',
    rgStart !== -1 && rgBody.includes('resetTimeScaleRuntime()'));
  const srStart = previewJs.indexOf('function sceneResetHooks()');
  const srEnd = previewJs.indexOf('function resetGame', srStart);
  const srBody = srStart !== -1 ? previewJs.slice(srStart, srEnd) : '';
  check('preview runtime has no scene-reset entry for the scale (it survives scene switches)',
    srStart !== -1 && !srBody.includes('timeScale'));
  check('preview runtime contexts carry the time-scale state',
    previewJs.includes('timeScale: timeScaleRuntime()') &&
    previewJs.includes('timeScaleModule: mod('));
  check('preview runtime scales the frame step and banks the debt in gameLoop',
    previewJs.includes('dt = TS.scaledDt(dt, timeScaleRuntime())') &&
    previewJs.includes('TS.noteScaledFrame(runState(), realMs, timeScaleRuntime())'));
  check('preview run state carries the clock debt',
    scriptJs.includes('timeScaleDebtMs: 0'));
  check('pause gameNow subtracts the time-scale debt',
    pauseJs.includes('timeScaleDebtMs') && pauseJs.includes('return now - frozen - debt;'));
  check('scene reset clears the clock debt with the rest of the clock',
    resetJs.includes('state.timeScaleDebtMs = 0;'));
  check('shared conditions module evaluates the Time Scale condition',
    conditionsJs.includes("case 'timeScale'"));
  check('shared execute module runs the three time-scale actions',
    executeJs.includes("isType(ctx.timeScaleModule, 'isTimeScaleAction', type)") &&
    executeJs.includes("type === 'setTimeScale'") && executeJs.includes("type === 'readTimeScale'"));
  check('flow module defaults the Time Scale condition to a level trigger',
    flowJs.includes("t === 'timeScale'"));

  // Catalog: four Time blocks, schema-clean.
  const catSb = {}; catSb.window = catSb; vm.createContext(catSb);
  vm.runInContext(fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8'), catSb,
    { filename: 'block-catalog.js' });
  const catalog = catSb.HydraBlockCatalog;
  const tsBlocks = catalog.blocks.filter(b => b.category === 'Time');
  check('catalog carries four Time blocks',
    tsBlocks.length === 4, tsBlocks.map(b => b.label).join(', '));
  const labels = tsBlocks.map(b => b.label).sort();
  check('Time blocks are the three actions + one condition',
    JSON.stringify(labels) === JSON.stringify(['Read Time Scale', 'Reset Time Scale', 'Set Time Scale', 'Time Scale'].sort()),
    labels.join(', '));
  const findings = catalog.validateCatalog();
  check('catalog validates clean with the Time blocks', findings.length === 0,
    JSON.stringify(findings.slice(0, 3)));
  const ref = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');
  check('every Time block is documented in the block reference',
    tsBlocks.every(b => ref.includes(b.label)), tsBlocks.filter(b => !ref.includes(b.label)).map(b => b.label).join(', '));
  const guide = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');
  check('user guide has a Time scale section', guide.includes('## Time scale'));
}

process.exit(failures === 0 ? 0 : 1);
