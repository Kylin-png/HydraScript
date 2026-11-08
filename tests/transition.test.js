// Unit tests for hydra/hydra-transition.js — the shared scene
// transitions (P4 Advanced batch 14: fade / wipe between scenes
// instead of an instant cut).
//
// Pure logic: config normalization (effect + duration), the per-run
// runtime (start / update / cancel), the playing / finished reads,
// progress + alpha, the overlay draw (fade alpha, wipe sweep), and
// the action/condition routing sets. Nothing here touches the DOM;
// both runtimes delegate to this module.
// Static checks at the end pin the wiring: catalog blocks, both
// runtimes' dispatch and per-frame update, the draw overlay, and the
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
sandbox.window = sandbox; // hydra-transition.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-transition.js'), 'utf8'),
  sandbox, { filename: 'hydra-transition.js' });
const T = sandbox.HydraTransition;

check('HydraTransition exposed with helpers',
  !!T && typeof T.normalizeEffect === 'function' &&
  typeof T.normalizeDuration === 'function' &&
  typeof T.normalizeTransitionConfig === 'function' &&
  typeof T.createTransitionRuntime === 'function' &&
  typeof T.startTransition === 'function' &&
  typeof T.updateTransition === 'function' &&
  typeof T.cancelTransition === 'function' &&
  typeof T.isTransitionPlaying === 'function' &&
  typeof T.isTransitionFinished === 'function' &&
  typeof T.transitionProgress === 'function' &&
  typeof T.transitionAlpha === 'function' &&
  typeof T.drawTransition === 'function' &&
  typeof T.isTransitionAction === 'function' &&
  typeof T.isTransitionCondition === 'function');
check('factorySource is a self-contained function string',
  typeof T.factorySource === 'string' && T.factorySource.includes('hydraTransitionFactory'));
check('constants are fade default, 0.5s default, 10s cap',
  T.DEFAULT_EFFECT === 'fade' && T.DEFAULT_DURATION === 0.5 && T.MAX_DURATION === 10 &&
  T.EFFECTS.length === 3 && T.EFFECTS.includes('fade') && T.EFFECTS.includes('wipe') && T.EFFECTS.includes('none'));

function makeHooks(scenes) {
  const warns = [];
  const switches = [];
  const known = scenes || ['Level 2', '1', 'Menu'];
  return {
    warns, switches,
    hooks: {
      warn: function (msg) { warns.push(msg); },
      paused: false,
      sceneExists: function (s) { return known.indexOf(String(s)) !== -1; },
      switchScene: function (s) { switches.push(s); return known.indexOf(String(s)) !== -1; }
    }
  };
}

function makeDrawCtx() {
  const calls = [];
  const ctx = {
    calls, fillStyle: '',
    save: function () { calls.push(['save']); },
    restore: function () { calls.push(['restore']); },
    fillRect: function (x, y, w, h) { calls.push(['fillRect', x, y, w, h]); }
  };
  return ctx;
}

// --- config normalization ---
{
  check('a missing config reads as the fade 0.5s default',
    JSON.stringify(T.normalizeTransitionConfig(undefined)) === '{"effect":"fade","duration":0.5}' &&
    JSON.stringify(T.normalizeTransitionConfig(null)) === '{"effect":"fade","duration":0.5}' &&
    JSON.stringify(T.normalizeTransitionConfig('fade')) === '{"effect":"fade","duration":0.5}' &&
    JSON.stringify(T.normalizeTransitionConfig([])) === '{"effect":"fade","duration":0.5}');
  check('a plain config keeps its effect and duration',
    JSON.stringify(T.normalizeTransitionConfig({ effect: 'wipe', duration: 1.2 })) === '{"effect":"wipe","duration":1.2}');
  check('a bad effect falls back to fade, a bad duration to 0.5',
    JSON.stringify(T.normalizeTransitionConfig({ effect: 'slide', duration: 'fast' })) === '{"effect":"fade","duration":0.5}');
  check('a negative duration reads as the default, a huge one caps at 10',
    T.normalizeTransitionConfig({ effect: 'fade', duration: -1 }).duration === 0.5 &&
    T.normalizeTransitionConfig({ effect: 'fade', duration: 99 }).duration === 10);
  check('normalization is in place (the same object comes back)',
    (function () { const c = { effect: 'wipe', duration: 2 }; return T.normalizeTransitionConfig(c) === c; })());
  check('normalizeEffect is case-insensitive and falls back',
    T.normalizeEffect('WIPE', 'fade') === 'wipe' && T.normalizeEffect('slide', 'fade') === 'fade' &&
    T.normalizeEffect('', 'fade') === 'fade');
  check('normalizeDuration keeps 0 (an instant cut is legal) and caps',
    T.normalizeDuration(0) === 0 && T.normalizeDuration(2) === 2 &&
    T.normalizeDuration(99) === 10 && T.normalizeDuration('fast') === 0.5);
}

// --- fresh runtime + start ---
{
  const rt = T.createTransitionRuntime();
  check('a fresh runtime is idle with nothing finished',
    rt.phase === 'idle' && rt.effect === 'fade' && rt.duration === 0.5 &&
    rt.elapsed === 0 && rt.pendingScene === null && rt.lastFinished === null);
  const h = makeHooks();
  const cfg = T.normalizeTransitionConfig(undefined);
  check('starting a fade sets the out phase with the config defaults',
    T.startTransition(rt, cfg, 'Level 2', {}, h.hooks) === true &&
    rt.phase === 'out' && rt.effect === 'fade' && rt.duration === 0.5 &&
    rt.pendingScene === 'Level 2' && rt.elapsed === 0 && h.warns.length === 0);
  check('starting again replaces the running transition',
    T.startTransition(rt, cfg, 'Menu', { effect: 'wipe', duration: 1 }, h.hooks) === true &&
    rt.phase === 'out' && rt.effect === 'wipe' && rt.duration === 1 && rt.pendingScene === 'Menu');
  check('a blank scene stays quiet',
    T.startTransition(rt, cfg, '', {}, h.hooks) === false && rt.phase === 'out' && rt.pendingScene === 'Menu');
  check('an unknown scene warns and holds',
    T.startTransition(rt, cfg, 'Nope', {}, h.hooks) === false && rt.phase === 'out' &&
    rt.pendingScene === 'Menu' && h.warns.length === 1 && /no scene named/.test(h.warns[0]));
  check('a blank duration reads as the configured default, not 0',
    T.startTransition(rt, cfg, 'Level 2', { duration: '' }, h.hooks) === true && rt.duration === 0.5);
  check('a numeric scene id starts the transition to that id',
    T.startTransition(rt, cfg, 1, {}, h.hooks) === true && rt.pendingScene === '1');
  check('an unknown effect override falls back to the configured effect',
    T.startTransition(rt, cfg, 'Level 2', { effect: 'slide' }, h.hooks) === true && rt.effect === 'fade');
  check('startTransition is quiet without hooks or config',
    T.startTransition(T.createTransitionRuntime(), null, 'Level 2', {}, null) === true);
  check('startTransition returns false without a runtime',
    T.startTransition(null, cfg, 'Level 2', {}, h.hooks) === false);
}

// --- instant switches (cut / none / zero duration) ---
{
  const rt = T.createTransitionRuntime();
  const h = makeHooks();
  const cfg = T.normalizeTransitionConfig(undefined);
  check('a cut override switches at once and marks finished',
    T.startTransition(rt, cfg, 'Level 2', { effect: 'cut' }, h.hooks) === true &&
    rt.phase === 'idle' && h.switches.length === 1 && h.switches[0] === 'Level 2' &&
    T.isTransitionFinished(rt, 'Level 2') === true && T.transitionProgress(rt) === 1);
  check('a none config switches at once',
    T.startTransition(rt, { effect: 'none', duration: 0.5 }, 'Menu', {}, h.hooks) === true &&
    rt.phase === 'idle' && h.switches.length === 2);
  check('a zero duration switches at once',
    T.startTransition(rt, cfg, 'Level 2', { duration: 0 }, h.hooks) === true &&
    rt.phase === 'idle' && h.switches.length === 3);
  check('an instant switch to an unknown scene warns and holds',
    T.startTransition(rt, cfg, 'Nope', { effect: 'cut' }, h.hooks) === false &&
    h.warns.length === 1 && /no scene named/.test(h.warns[0]));
  check('an instant switch without a switchScene hook warns and holds',
    T.startTransition(rt, cfg, 'Level 2', { effect: 'cut' }, { warn: function (m) { h.warns.push(m); } }) === false);
}

// --- update: out -> switch -> in -> finish ---
{
  const rt = T.createTransitionRuntime();
  const h = makeHooks();
  const cfg = T.normalizeTransitionConfig({ effect: 'fade', duration: 0.5 });
  T.startTransition(rt, cfg, 'Level 2', {}, h.hooks);
  check('the out half has not switched yet',
    (function () { T.updateTransition(rt, cfg, 0.1, h.hooks); return rt.phase === 'out' && h.switches.length === 0; })());
  check('alpha ramps 0 -> 1 across the out half, progress 0 -> 0.5',
    Math.abs(T.transitionAlpha(rt) - 0.4) < 0.001 && Math.abs(T.transitionProgress(rt) - 0.2) < 0.001);
  check('the out half ending switches the scene and starts the in half',
    (function () { T.updateTransition(rt, cfg, 0.2, h.hooks); return rt.phase === 'in' && h.switches.length === 1 && h.switches[0] === 'Level 2' && rt.elapsed === 0; })());
  check('alpha is 1 at the start of the in half, progress is 0.5',
    T.transitionAlpha(rt) === 1 && T.transitionProgress(rt) === 0.5);
  check('alpha ramps 1 -> 0 across the in half',
    (function () { T.updateTransition(rt, cfg, 0.1, h.hooks); return Math.abs(T.transitionAlpha(rt) - 0.6) < 0.001 && Math.abs(T.transitionProgress(rt) - 0.7) < 0.001; })());
  check('the in half ending marks the scene finished and goes idle',
    (function () { T.updateTransition(rt, cfg, 0.2, h.hooks); return rt.phase === 'idle' && T.isTransitionFinished(rt, 'Level 2') && T.transitionProgress(rt) === 1 && T.transitionAlpha(rt) === 0; })());
  check('an update on an idle runtime is a no-op',
    (function () { T.updateTransition(rt, cfg, 1, h.hooks); return rt.phase === 'idle' && h.switches.length === 1; })());
}
{
  // A big dt jumps straight through: one frame can finish the out
  // half and the next the in half — never more than one switch.
  const rt = T.createTransitionRuntime();
  const h = makeHooks();
  const cfg = T.normalizeTransitionConfig(undefined);
  T.startTransition(rt, cfg, 'Level 2', {}, h.hooks);
  T.updateTransition(rt, cfg, 5, h.hooks);
  check('a huge dt switches once and enters the in half',
    rt.phase === 'in' && h.switches.length === 1);
  T.updateTransition(rt, cfg, 5, h.hooks);
  check('a second huge dt finishes',
    rt.phase === 'idle' && T.isTransitionFinished(rt, 'Level 2'));
}
{
  // Paused: the update returns early, the overlay holds.
  const rt = T.createTransitionRuntime();
  const h = makeHooks();
  h.hooks.paused = true;
  const cfg = T.normalizeTransitionConfig(undefined);
  T.startTransition(rt, cfg, 'Level 2', {}, h.hooks);
  T.updateTransition(rt, cfg, 1, h.hooks);
  check('a paused update freezes the out half',
    rt.phase === 'out' && rt.elapsed === 0 && h.switches.length === 0);
  h.hooks.paused = false;
  T.updateTransition(rt, cfg, 0.3, h.hooks);
  check('unpausing resumes the same transition',
    rt.phase === 'in' && h.switches.length === 1);
}
{
  // The scene vanishes mid-transition: the switch fails, the
  // transition ends without marking finished.
  const rt = T.createTransitionRuntime();
  const h = makeHooks(['Level 2']);
  const cfg = T.normalizeTransitionConfig(undefined);
  T.startTransition(rt, cfg, 'Level 2', {}, h.hooks);
  h.hooks.switchScene = function () { return false; };
  T.updateTransition(rt, cfg, 0.3, h.hooks);
  check('a failed switch warns and ends without a finish',
    rt.phase === 'idle' && rt.pendingScene === null && !T.isTransitionFinished(rt, 'Level 2') &&
    h.warns.length === 1 && /no scene named/.test(h.warns[0]));
}
{
  // Bad dt never breaks the update.
  const rt = T.createTransitionRuntime();
  const h = makeHooks();
  const cfg = T.normalizeTransitionConfig(undefined);
  T.startTransition(rt, cfg, 'Level 2', {}, h.hooks);
  T.updateTransition(rt, cfg, 'fast', h.hooks);
  T.updateTransition(rt, cfg, -1, h.hooks);
  check('a non-numeric or negative dt reads as 0',
    rt.phase === 'out' && rt.elapsed === 0);
}

// --- cancel ---
{
  const rt = T.createTransitionRuntime();
  const h = makeHooks();
  const cfg = T.normalizeTransitionConfig(undefined);
  check('cancelling an idle transition returns false',
    T.cancelTransition(rt) === false);
  T.startTransition(rt, cfg, 'Level 2', {}, h.hooks);
  check('cancelling during the out half stays in the current scene with no finish',
    T.cancelTransition(rt) === true && rt.phase === 'idle' && rt.pendingScene === null &&
    h.switches.length === 0 && !T.isTransitionFinished(rt, 'Level 2'));
  T.startTransition(rt, cfg, 'Level 2', {}, h.hooks);
  T.updateTransition(rt, cfg, 0.3, h.hooks);
  check('cancelling during the in half finishes at once (the scene already switched)',
    T.cancelTransition(rt) === true && rt.phase === 'idle' &&
    T.isTransitionFinished(rt, 'Level 2') && h.switches.length === 1);
  check('cancelling without a runtime returns false',
    T.cancelTransition(null) === false);
}

// --- playing / finished reads ---
{
  const rt = T.createTransitionRuntime();
  const h = makeHooks();
  const cfg = T.normalizeTransitionConfig(undefined);
  check('nothing plays or finished on a fresh runtime',
    !T.isTransitionPlaying(rt) && !T.isTransitionPlaying(rt, 'Level 2') &&
    !T.isTransitionFinished(rt) && !T.isTransitionFinished(rt, 'Level 2'));
  T.startTransition(rt, cfg, 'Level 2', {}, h.hooks);
  check('playing reads true for any transition and for the target scene',
    T.isTransitionPlaying(rt) === true && T.isTransitionPlaying(rt, 'Level 2') === true);
  check('playing reads false for another scene',
    T.isTransitionPlaying(rt, 'Menu') === false);
  check('a numeric scene id matches its string form both ways',
    (function () {
      T.startTransition(rt, cfg, 1, {}, h.hooks);
      return T.isTransitionPlaying(rt, '1') === true && T.isTransitionPlaying(rt, 1) === true &&
        T.isTransitionPlaying(rt, '2') === false;
    })());
  T.startTransition(rt, cfg, 'Level 2', {}, h.hooks);
  T.updateTransition(rt, cfg, 0.6, h.hooks);
  T.updateTransition(rt, cfg, 0.3, h.hooks);
  check('finished reads true for any transition and for the target scene',
    T.isTransitionFinished(rt) === true && T.isTransitionFinished(rt, 'Level 2') === true);
  check('finished reads false for another scene',
    T.isTransitionFinished(rt, 'Menu') === false);
  check('starting a new transition clears the finished record',
    (function () { T.startTransition(rt, cfg, 'Menu', {}, h.hooks); return !T.isTransitionFinished(rt, 'Level 2') && !T.isTransitionFinished(rt); })());
  check('reads are false without a runtime',
    !T.isTransitionPlaying(null) && !T.isTransitionFinished(null));
  check('reads survive a hostile runtime',
    !T.isTransitionPlaying({ phase: 'out', pendingScene: { toString: function () { throw new Error('boom'); } } }, 'Level 2') &&
    !T.isTransitionFinished({ lastFinished: { toString: function () { throw new Error('boom'); } } }));
}

// --- draw ---
{
  const rt = T.createTransitionRuntime();
  const h = makeHooks();
  const cfg = T.normalizeTransitionConfig(undefined);
  const ctx = makeDrawCtx();
  T.drawTransition(ctx, 800, 600, rt);
  check('an idle transition draws nothing',
    ctx.calls.length === 0);
  T.startTransition(rt, cfg, 'Level 2', {}, h.hooks);
  T.updateTransition(rt, cfg, 0.125, h.hooks);
  const ctx2 = makeDrawCtx();
  T.drawTransition(ctx2, 800, 600, rt);
  check('a fade mid-out fills the whole canvas black at the current alpha',
    ctx2.calls.length === 3 && ctx2.calls[1][0] === 'fillRect' &&
    ctx2.calls[1][1] === 0 && ctx2.calls[1][2] === 0 && ctx2.calls[1][3] === 800 && ctx2.calls[1][4] === 600 &&
    ctx2.fillStyle === 'rgba(0,0,0,0.5)', `fillStyle=${ctx2.fillStyle}`);
  T.startTransition(rt, cfg, 'Level 2', { effect: 'wipe', duration: 1 }, h.hooks);
  T.updateTransition(rt, cfg, 0.25, h.hooks);
  const ctx3 = makeDrawCtx();
  T.drawTransition(ctx3, 800, 600, rt);
  check('a wipe mid-out paints a panel growing from the left',
    ctx3.calls[1][0] === 'fillRect' && ctx3.calls[1][1] === 0 && ctx3.calls[1][3] === 400 &&
    ctx3.fillStyle === '#000000', JSON.stringify(ctx3.calls));
  T.updateTransition(rt, cfg, 0.3, h.hooks);
  T.updateTransition(rt, cfg, 0.25, h.hooks);
  const ctx4 = makeDrawCtx();
  T.drawTransition(ctx4, 800, 600, rt);
  check('a wipe mid-in paints a panel sliding off to the right',
    ctx4.calls[1][0] === 'fillRect' && ctx4.calls[1][1] === 400 && ctx4.calls[1][3] === 400,
    JSON.stringify(ctx4.calls));
  check('draw is a no-op for a missing context, bad size, or no runtime',
    (function () {
      T.drawTransition(null, 800, 600, rt);
      T.drawTransition(makeDrawCtx(), 0, 600, rt);
      T.drawTransition(makeDrawCtx(), 800, 600, null);
      T.drawTransition({}, 800, 600, rt);
      return true;
    })());
}

// --- routing sets ---
{
  check('isTransitionAction matches only the two transition actions',
    T.isTransitionAction('transitionToScene') === true &&
    T.isTransitionAction('cancelTransition') === true &&
    T.isTransitionAction('switchScene') === false &&
    T.isTransitionAction('transitionPlaying') === false);
  check('isTransitionCondition matches only the two transition conditions',
    T.isTransitionCondition('transitionPlaying') === true &&
    T.isTransitionCondition('transitionFinished') === true &&
    T.isTransitionCondition('cutscenePlaying') === false &&
    T.isTransitionCondition('transitionToScene') === false);
}

// --- hostile input ---
{
  check('hostile inputs degrade to safe defaults, never throw',
    (function () {
      try {
        T.normalizeTransitionConfig({ effect: { toString: function () { throw new Error('boom'); } } });
        T.normalizeEffect({ toString: function () { throw new Error('boom'); } }, 'fade');
        T.createTransitionRuntime();
        const rt = T.createTransitionRuntime();
        T.startTransition(rt, null, { toString: function () { throw new Error('boom'); } }, null, null);
        T.updateTransition(rt, null, 'fast', null);
        T.cancelTransition(rt);
        T.isTransitionPlaying(rt, null);
        T.isTransitionFinished(rt, undefined);
        T.transitionProgress(rt);
        T.transitionAlpha(rt);
        T.drawTransition(null, 'wide', 'tall', rt);
        return true;
      } catch (e) { return false; }
    })());
}

// --- static wiring ---
{
  const html = fs.readFileSync(path.join(HYDRA, 'index.html'), 'utf8');
  const scriptJs = fs.readFileSync(path.join(HYDRA, 'script.js'), 'utf8');
  const playerJs = fs.readFileSync(path.join(HYDRA, 'player-runtime.js'), 'utf8');
  const previewJs = fs.readFileSync(path.join(HYDRA, 'hydra-previewruntime.js'), 'utf8');
  const conditionsJs = fs.readFileSync(path.join(HYDRA, 'hydra-conditions.js'), 'utf8');
  const executeJs = fs.readFileSync(path.join(HYDRA, 'hydra-execute.js'), 'utf8');
  const flowJs = fs.readFileSync(path.join(HYDRA, 'hydra-flow.js'), 'utf8');
  const universalJs = fs.readFileSync(path.join(HYDRA, 'hydra-universal.js'), 'utf8');
  const catalogJs = fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8');
  const refMd = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');
  const guideMd = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');

  const trTag = html.indexOf('src="hydra-transition.js');
  check('index.html loads hydra-transition.js before player-runtime.js and script.js',
    trTag !== -1 && trTag < html.indexOf('src="player-runtime.js') && trTag < html.indexOf('src="script.js'));
  check('index.html loads hydra-transition.js after hydra-timescale.js',
    trTag !== -1 && html.indexOf('src="hydra-timescale.js') < trTag);
  check('index.html has the Transitions tab + panel',
    html.includes('data-inspector-tab="transitions"') && html.includes('id="transitions-panel"'));
  check('player-runtime.js hard-guards on HydraTransition',
    playerJs.includes('requires hydra-transition.js (window.HydraTransition)'));
  check('player-runtime.js inlines HydraTransition into exports',
    playerJs.includes("'HydraTransition', global.HydraTransition && global.HydraTransition.factorySource"));
  check('player-runtime.js creates the per-run transition runtime + config',
    playerJs.includes('transitionConfig: HydraTransition.normalizeTransitionConfig(project.sceneTransition),') &&
    playerJs.includes('transition: HydraTransition.createTransitionRuntime(),'));
  check('player-runtime.js advances the transition before the grids run',
    playerJs.includes('updateTransition(state); updateCutscene(state);'));
  check('player-runtime.js draws the transition overlay after the frame',
    playerJs.includes('HydraTransition.drawTransition(state.ctx, state.canvas.width, state.canvas.height, state.transition)'));
  check('player-runtime.js routes transition blocks through the shared modules',
    playerJs.includes('HydraTransition.isTransitionCondition(type)') &&
    playerJs.includes('HydraTransition.isTransitionAction(type)') &&
    playerJs.includes('transition: state.transition') && playerJs.includes('transitionModule: HydraTransition'));
  check('preview runtime holds the transition runtime per factory instance',
    previewJs.includes('function transitionRuntime') &&
    previewJs.includes("mod('Transition')") &&
    previewJs.includes('TR.createTransitionRuntime'));
  const rgStart = previewJs.indexOf('function resetGame()');
  const rgEnd = previewJs.indexOf('function loadPreviewScene', rgStart);
  const rgBody = rgStart !== -1 ? previewJs.slice(rgStart, rgEnd) : '';
  check('preview runtime resets the transition on a fresh run (resetGame)',
    rgStart !== -1 && rgBody.includes('resetTransitionRuntime()'));
  const srStart = previewJs.indexOf('function sceneResetHooks()');
  const srEnd = previewJs.indexOf('function resetGame', srStart);
  const srBody = srStart !== -1 ? previewJs.slice(srStart, srEnd) : '';
  check('preview runtime has no scene-reset entry for the transition (it survives scene switches)',
    srStart !== -1 && !srBody.includes('transition'));
  check('preview runtime contexts carry the transition state',
    previewJs.includes('transition: transitionRuntime()') &&
    previewJs.includes('transitionModule: mod('));
  check('preview runtime advances the transition in the runScripts phase',
    previewJs.includes('updatePreviewTransition(dt)'));
  check('preview runtime exposes the transition for the editor overlay draw',
    previewJs.includes('transitionRuntime: transitionRuntime,'));
  check('editor draws the transition overlay after the preview frame',
    scriptJs.includes('TR.drawTransition(ctx, canvas.width, canvas.height, PR.transitionRuntime())'));
  check('editor has the Transitions tab panel + config getters',
    scriptJs.includes('function renderTransitionsPanel') &&
    scriptJs.includes('function getProjectTransitionConfig') &&
    scriptJs.includes('function getMutableTransitionConfig'));
  check('shared conditions module evaluates both transition conditions (and never freezes them while paused)',
    conditionsJs.includes("case 'transitionPlaying'") &&
    conditionsJs.includes("case 'transitionFinished'") &&
    !/FROZEN_WHILE_PAUSED = \[[^\]]*'transitionPlaying'/.test(conditionsJs) &&
    !/FROZEN_WHILE_PAUSED = \[[^\]]*'transitionFinished'/.test(conditionsJs));
  check('shared execute module runs the two transition actions',
    executeJs.includes("if (isType(ctx.transitionModule, 'isTransitionAction', type))") &&
    executeJs.includes("type === 'transitionToScene'") &&
    executeJs.includes("type === 'cancelTransition'"));
  check('flow treats Transition Playing as a level read',
    flowJs.includes("t === 'transitionPlaying'"));
  check('universal defaults the project transition config',
    universalJs.includes("project.sceneTransition = { effect: 'fade', duration: 0.5 };"));
  check('catalog carries the four transition blocks in the Scene category',
    catalogJs.includes("blockType: 'transition-to-scene'") &&
    catalogJs.includes("blockType: 'cancel-transition'") &&
    catalogJs.includes("blockType: 'transition-playing'") &&
    catalogJs.includes("blockType: 'transition-finished'") &&
    catalogJs.includes("runtimeType: 'transitionToScene'") &&
    catalogJs.includes("runtimeType: 'cancelTransition'") &&
    catalogJs.includes("runtimeType: 'transitionPlaying'") &&
    catalogJs.includes("runtimeType: 'transitionFinished'"));
  check('block reference documents all four transition blocks',
    refMd.includes('Transition to Scene') && refMd.includes('Cancel Transition') &&
    refMd.includes('Transition Playing') && refMd.includes('Transition Finished'));
  check('user guide covers scene transitions',
    guideMd.includes('Scene Transitions'));
}

process.exit(failures === 0 ? 0 : 1);
