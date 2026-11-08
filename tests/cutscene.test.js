// Unit tests for hydra/hydra-cutscene.js — the shared cutscene /
// timeline system (P4 Advanced batch 11: the scripted scenes a game
// plays by itself).
//
// Pure logic: cutscene-table normalization (repairs, drops, dedupe,
// step-kind + duration coercion), name/id lookups, the per-run
// cutscene runtime (play / stop / per-frame update through wait /
// text / move / sound / scene steps, pause freeze, finished reads),
// and the action/condition routing sets. Nothing here touches the
// DOM; both runtimes delegate to this module. Static checks at the
// end pin the wiring: catalog blocks, editor tab + panel, both
// runtimes' dispatch, and the export inlining.

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
sandbox.window = sandbox; // hydra-cutscene.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-cutscene.js'), 'utf8'),
  sandbox, { filename: 'hydra-cutscene.js' });
const C = sandbox.HydraCutscene;

check('HydraCutscene exposed with helpers',
  !!C && typeof C.normalizeCutscenes === 'function' && typeof C.normalizeStep === 'function' &&
  typeof C.cutsceneNames === 'function' &&
  typeof C.getCutscene === 'function' && typeof C.createCutsceneRuntime === 'function' &&
  typeof C.playCutscene === 'function' && typeof C.stopCutscene === 'function' &&
  typeof C.updateCutscene === 'function' &&
  typeof C.isCutscenePlaying === 'function' && typeof C.isCutsceneFinished === 'function' &&
  typeof C.isCutsceneAction === 'function' && typeof C.isCutsceneCondition === 'function');
check('factorySource is a self-contained function string',
  typeof C.factorySource === 'string' && C.factorySource.includes('hydraCutsceneFactory'));
check('default step seconds is 1', C.DEFAULT_SECONDS === 1);
check('five step kinds', JSON.stringify(C.STEP_KINDS) === JSON.stringify(['wait', 'text', 'move', 'sound', 'scene']));

function guardCutscenes() {
  return [
    { id: 'cts_intro', name: 'Intro', description: 'The opening crawl.',
      steps: [
        { kind: 'text', object: 'Caption', text: 'A long time ago...', seconds: 2 },
        { kind: 'move', object: 'Hero', x: 400, y: 300, seconds: 2 },
        { kind: 'sound', sound: 'Fanfare' },
        { kind: 'wait', seconds: 1 },
        { kind: 'scene', scene: 'Level 1' }
      ] },
    { id: 'cts_ending', name: 'Ending', description: 'The end.',
      steps: [{ kind: 'wait', seconds: 1 }] }
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

// A small fake world for the per-frame update: two live objects, a
// text sink, one known sound, one known scene.
function makeWorld() {
  const objects = { Hero: { x: 0, y: 0 }, Caption: { x: 100, y: 100 } };
  const texts = {};
  const sounds = [];
  const scenes = [];
  const warns = [];
  const hooks = {
    warn: function (msg) { warns.push(msg); },
    paused: false,
    getObjectPosition: function (name) {
      const o = objects[name];
      return o ? { x: o.x, y: o.y } : null;
    },
    setObjectPosition: function (name, x, y) {
      if (objects[name]) { objects[name].x = x; objects[name].y = y; }
    },
    setObjectText: function (name, text) { texts[name] = text; },
    playSound: function (name) {
      if (name === 'Fanfare') { sounds.push(name); return true; }
      return false;
    },
    switchScene: function (name) {
      if (name === 'Level 1' || name === '2') { scenes.push(name); return true; }
      return false;
    }
  };
  return { objects, texts, sounds, scenes, warns, hooks };
}

// --- normalization ---
{
  check('null normalizes to an empty list', JSON.stringify(C.normalizeCutscenes(null)) === '[]');
  check('a non-array normalizes to an empty list', JSON.stringify(C.normalizeCutscenes({})) === '[]');
  const list = [
    { id: 'a', name: ' Intro ', description: 7, steps: [
      { kind: 'wait', seconds: 2 },
      { kind: 'text', object: 'Caption', text: 'Hi', seconds: 'many' },
      { kind: 'move', object: 'Hero', x: 'far', y: null, seconds: -3 },
      { kind: 'sound', sound: 42 },
      { kind: 'scene', scene: 'Level 1' },
      { kind: 'dance', seconds: 1 },
      null, 'junk'
    ] },
    { name: 'Intro', steps: [] },
    { name: '  ', steps: [] },
    null, 'junk',
    { name: 'Ending' },
    { name: 'Zero', steps: [{ kind: 'wait', seconds: 0 }] }
  ];
  const norm = C.normalizeCutscenes(list);
  check('normalization is in place (same array identity)', norm === list, 'identity changed');
  check('duplicate names collapse to the first, blank names drop, junk drops',
    JSON.stringify(C.cutsceneNames(list)) === '["Intro","Ending","Zero"]',
    JSON.stringify(C.cutsceneNames(list)));
  const intro = C.getCutscene(list, 'Intro');
  check('cutscene names trim', intro && intro.name === 'Intro');
  check('description coerces to a string', intro.description === '7', JSON.stringify(intro));
  check('unknown step kinds and junk steps drop, known steps keep',
    intro.steps.length === 5 && intro.steps.map(s => s.kind).join(',') === 'wait,text,move,sound,scene',
    JSON.stringify(intro.steps));
  check('bad durations fall back to 1, negative durations fall back to 1',
    intro.steps[1].seconds === 1 && intro.steps[2].seconds === 1,
    JSON.stringify(intro.steps.map(s => [s.kind, s.seconds])));
  check('move coordinates coerce to numbers with a 0 fallback',
    intro.steps[2].x === 0 && intro.steps[2].y === 0,
    JSON.stringify(intro.steps[2]));
  check('sound names coerce to strings', intro.steps[3].sound === '42', JSON.stringify(intro.steps[3]));
  check('a missing steps list defaults to []',
    JSON.stringify(C.getCutscene(list, 'Ending').steps) === '[]');
  check('a zero-second wait survives normalization',
    C.getCutscene(list, 'Zero').steps[0].seconds === 0);
  check('a missing id is minted', typeof C.getCutscene(list, 'Ending').id === 'string' &&
    C.getCutscene(list, 'Ending').id.length > 0);
  check('normalizeStep rejects unknown kinds and non-objects',
    C.normalizeStep({ kind: 'dance' }) === null && C.normalizeStep(null) === null &&
    C.normalizeStep('wait') === null);
  check('normalizeStep keeps a valid step', (() => {
    const s = C.normalizeStep({ kind: 'move', object: 'Hero', x: 5, y: 6, seconds: 2 });
    return s && s.kind === 'move' && s.x === 5 && s.y === 6 && s.seconds === 2;
  })());
}

// --- lookups ---
{
  const list = guardCutscenes();
  check('getCutscene finds by name', C.getCutscene(list, 'Intro') === list[0]);
  check('getCutscene finds by id', C.getCutscene(list, 'cts_ending') === list[1]);
  check('getCutscene trims the name', C.getCutscene(list, '  Ending  ') === list[1]);
  check('getCutscene returns null for blank names', C.getCutscene(list, '  ') === null);
  check('getCutscene returns null for unknown names', C.getCutscene(list, 'Nobody') === null);
  check('getCutscene returns null for a null table', C.getCutscene(null, 'Intro') === null);
  check('cutsceneNames returns a copy', (() => {
    const names = C.cutsceneNames(list);
    names.push('bogus');
    return C.cutsceneNames(list).length === 2;
  })());
}

// --- fresh runtime ---
{
  const rt = C.createCutsceneRuntime();
  check('fresh runtime is idle with nothing finished',
    rt && rt.active === null && rt.stepIndex === 0 && rt.stepElapsed === 0 &&
    rt.stepStarted === false && rt.stepFrom === null && rt.lastFinished === null);
  check('fresh runtime reads as not playing and not finished',
    C.isCutscenePlaying(rt, 'Intro') === false && C.isCutscenePlaying(rt, '') === false &&
    C.isCutsceneFinished(rt, 'Intro') === false && C.isCutsceneFinished(rt, '') === false);
}

// --- play / stop ---
{
  const h = makeHooks();
  const list = guardCutscenes();
  const rt = C.createCutsceneRuntime();
  check('play starts the named cutscene',
    C.playCutscene(rt, list, 'Intro', h.hooks) === true && rt.active === list[0] &&
    rt.stepIndex === 0 && C.isCutscenePlaying(rt, 'Intro') === true);
  check('playing reads true for a blank name (any cutscene)',
    C.isCutscenePlaying(rt, '') === true && C.isCutscenePlaying(rt, '  ') === true);
  check('playing reads false for another cutscene',
    C.isCutscenePlaying(rt, 'Ending') === false);
  check('play replaces the running cutscene',
    C.playCutscene(rt, list, 'Ending', h.hooks) === true && rt.active === list[1]);
  check('play with a blank name stays quiet (nothing starts)',
    C.playCutscene(C.createCutsceneRuntime(), list, '  ', h.hooks) === false && h.writes.length === 0);
  check('play with an unknown name warns and holds',
    C.playCutscene(rt, list, 'Nobody', h.hooks) === false && rt.active === list[1] &&
    h.writes.some(w => /no cutscene named "Nobody"/.test(w[1])), JSON.stringify(h.writes));
  check('play on a null runtime stays quiet',
    C.playCutscene(null, list, 'Intro', h.hooks) === false);
  check('stop with a blank name stops whichever is playing and counts as finished',
    C.stopCutscene(rt, list, '', h.hooks) === true && rt.active === null &&
    C.isCutsceneFinished(rt, 'Ending') === true && C.isCutsceneFinished(rt, '') === true);
  check('stop with nothing playing stays quiet',
    C.stopCutscene(rt, list, '', h.hooks) === false);
  C.playCutscene(rt, list, 'Intro', h.hooks);
  check('stop with a non-playing name leaves the running cutscene alone',
    C.stopCutscene(rt, list, 'Ending', h.hooks) === false && C.isCutscenePlaying(rt, 'Intro') === true);
  check('stop with an unknown name warns and holds',
    C.stopCutscene(rt, list, 'Nobody', h.hooks) === false && C.isCutscenePlaying(rt, 'Intro') === true &&
    h.writes.some(w => /no cutscene named "Nobody"/.test(w[1])), JSON.stringify(h.writes));
  check('stop with the playing name finishes it',
    C.stopCutscene(rt, list, 'Intro', h.hooks) === true && C.isCutsceneFinished(rt, 'Intro') === true);
  check('replaying a finished cutscene clears the finished record',
    C.playCutscene(rt, list, 'Intro', h.hooks) === true && C.isCutsceneFinished(rt, 'Intro') === false);
  check('stop on a null runtime stays quiet',
    C.stopCutscene(null, list, '', h.hooks) === false);
}

// --- per-frame update: the full Intro, step by step ---
{
  const w = makeWorld();
  const list = guardCutscenes();
  const rt = C.createCutsceneRuntime();
  C.playCutscene(rt, list, 'Intro', w.hooks);
  C.updateCutscene(rt, list, 0, w.hooks);
  check('the text step applies its text at step start',
    w.texts.Caption === 'A long time ago...' && rt.stepIndex === 0, JSON.stringify(w.texts));
  C.updateCutscene(rt, list, 1, w.hooks);
  check('a timed step holds until its seconds elapse',
    rt.stepIndex === 0 && rt.stepElapsed === 1);
  C.updateCutscene(rt, list, 1, w.hooks);
  check('the text step ends at its duration and the move step starts',
    rt.stepIndex === 1 && rt.stepStarted === true &&
    w.objects.Hero.x === 0 && w.objects.Hero.y === 0,
    JSON.stringify({ step: rt.stepIndex, hero: w.objects.Hero }));
  C.updateCutscene(rt, list, 1, w.hooks);
  check('the move step glides halfway at half its duration',
    w.objects.Hero.x === 200 && w.objects.Hero.y === 150,
    JSON.stringify(w.objects.Hero));
  C.updateCutscene(rt, list, 1, w.hooks);
  check('the move step snaps to its target, then the sound step fires and the wait starts in the same frame',
    w.objects.Hero.x === 400 && w.objects.Hero.y === 300 &&
    w.sounds.join(',') === 'Fanfare' && rt.stepIndex === 3,
    JSON.stringify({ hero: w.objects.Hero, sounds: w.sounds, step: rt.stepIndex }));
  C.updateCutscene(rt, list, 0.5, w.hooks);
  check('the wait step holds for its seconds',
    rt.stepIndex === 3 && rt.stepElapsed === 0.5);
  C.updateCutscene(rt, list, 0.5, w.hooks);
  check('the wait ends, the scene step switches, and the cutscene finishes in the same frame',
    w.scenes.join(',') === 'Level 1' && rt.active === null &&
    C.isCutsceneFinished(rt, 'Intro') === true && C.isCutscenePlaying(rt, '') === false,
    JSON.stringify({ scenes: w.scenes, step: rt.stepIndex, finished: rt.lastFinished }));
  check('no warnings from the full clean run', w.warns.length === 0, JSON.stringify(w.warns));
}

// --- per-frame update: zero-second steps, missing targets, pause ---
{
  const w = makeWorld();
  const rt = C.createCutsceneRuntime();
  // Zero-second move teleports at once; zero-second wait ends at once.
  const instant = [{ id: 'cts_zip', name: 'Zip', description: '',
    steps: [
      { kind: 'move', object: 'Hero', x: 50, y: 60, seconds: 0 },
      { kind: 'wait', seconds: 0 },
      { kind: 'wait', seconds: 1 }
    ] }];
  C.playCutscene(rt, instant, 'Zip', w.hooks);
  C.updateCutscene(rt, instant, 0, w.hooks);
  check('zero-second steps all complete on the start frame',
    w.objects.Hero.x === 50 && w.objects.Hero.y === 60 && rt.stepIndex === 2,
    JSON.stringify({ hero: w.objects.Hero, step: rt.stepIndex }));
  // A missing object warns and the timeline moves on.
  const ghost = [{ id: 'cts_ghost', name: 'Ghost', description: '',
    steps: [
      { kind: 'text', object: 'Nobody', text: 'Boo', seconds: 2 },
      { kind: 'move', object: 'Nobody', x: 1, y: 1, seconds: 2 },
      { kind: 'wait', seconds: 1 }
    ] }];
  const rt2 = C.createCutsceneRuntime();
  C.playCutscene(rt2, ghost, 'Ghost', w.hooks);
  C.updateCutscene(rt2, ghost, 0, w.hooks);
  check('steps with a missing object warn once and skip in the same frame',
    rt2.stepIndex === 2 && w.warns.filter(m => /no object named "Nobody"/.test(m)).length === 2,
    JSON.stringify({ step: rt2.stepIndex, warns: w.warns }));
  // A missing sound / scene warns and the timeline moves on.
  const bad = [{ id: 'cts_bad', name: 'Bad', description: '',
    steps: [
      { kind: 'sound', sound: 'Nope' },
      { kind: 'scene', scene: 'Nowhere' },
      { kind: 'wait', seconds: 1 }
    ] }];
  const rt3 = C.createCutsceneRuntime();
  C.playCutscene(rt3, bad, 'Bad', w.hooks);
  C.updateCutscene(rt3, bad, 0, w.hooks);
  check('steps with a missing sound / scene warn and skip in the same frame',
    rt3.stepIndex === 2 &&
    w.warns.some(m => /no sound named "Nope"/.test(m)) &&
    w.warns.some(m => /no scene named "Nowhere"/.test(m)),
    JSON.stringify({ step: rt3.stepIndex, warns: w.warns }));
  // Pause freezes the cutscene: no start effects, no clock.
  const w2 = makeWorld();
  const rt4 = C.createCutsceneRuntime();
  C.playCutscene(rt4, guardCutscenes(), 'Intro', w2.hooks);
  w2.hooks.paused = true;
  C.updateCutscene(rt4, guardCutscenes(), 5, w2.hooks);
  check('a paused update does nothing at all',
    rt4.stepIndex === 0 && rt4.stepElapsed === 0 && rt4.stepStarted === false &&
    w2.texts.Caption === undefined, JSON.stringify({ step: rt4.stepIndex, texts: w2.texts }));
  w2.hooks.paused = false;
  C.updateCutscene(rt4, guardCutscenes(), 0, w2.hooks);
  check('unpausing resumes the cutscene from where it froze',
    w2.texts.Caption === 'A long time ago...' && rt4.stepStarted === true);
  // A deleted cutscene ends mid-run without marking finished.
  const list5 = guardCutscenes();
  const rt5 = C.createCutsceneRuntime();
  C.playCutscene(rt5, list5, 'Intro', w2.hooks);
  list5.splice(0, 1);
  C.updateCutscene(rt5, list5, 0, w2.hooks);
  check('a cutscene deleted mid-run ends without a phantom finish',
    rt5.active === null && C.isCutsceneFinished(rt5, 'Intro') === false);
  // A damaged step mid-run is dropped by normalization, never stalling
  // the show.
  const list6 = guardCutscenes();
  const rt6 = C.createCutsceneRuntime();
  C.playCutscene(rt6, list6, 'Ending', w2.hooks);
  list6[1].steps = [{ kind: 'dance' }, { kind: 'wait', seconds: 1 }];
  C.updateCutscene(rt6, list6, 0, w2.hooks);
  check('a step damaged mid-run is dropped by normalization and the cutscene plays on',
    rt6.stepIndex === 0 && rt6.stepStarted === true && C.isCutscenePlaying(rt6, 'Ending') === true,
    JSON.stringify({ step: rt6.stepIndex }));
  // Hostile input never throws.
  const h = makeHooks();
  check('update on a null runtime stays quiet',
    C.updateCutscene(null, guardCutscenes(), 1, h.hooks) === undefined);
  check('update with throwing hooks stays quiet', (() => {
    const rt7 = C.createCutsceneRuntime();
    C.playCutscene(rt7, guardCutscenes(), 'Intro', h.hooks);
    const throwing = { warn: function () { throw new Error('boom'); }, getObjectPosition: function () { throw new Error('boom'); } };
    try { C.updateCutscene(rt7, guardCutscenes(), 1, throwing); return true; } catch (e) { return false; }
  })());
  check('update with a bad dt reads as 0 seconds', (() => {
    const w3 = makeWorld();
    const rt8 = C.createCutsceneRuntime();
    C.playCutscene(rt8, guardCutscenes(), 'Intro', w3.hooks);
    C.updateCutscene(rt8, guardCutscenes(), NaN, w3.hooks);
    return rt8.stepStarted === true && rt8.stepElapsed === 0;
  })());
}

// --- finished reads ---
{
  const h = makeHooks();
  const list = guardCutscenes();
  const rt = C.createCutsceneRuntime();
  check('finished reads false before anything plays',
    C.isCutsceneFinished(rt, 'Intro') === false && C.isCutsceneFinished(rt, '') === false);
  C.playCutscene(rt, list, 'Intro', h.hooks);
  check('finished reads false while playing',
    C.isCutsceneFinished(rt, 'Intro') === false);
  C.stopCutscene(rt, list, '', h.hooks);
  check('finished reads true for a blank name (any cutscene finished)',
    C.isCutsceneFinished(rt, '') === true && C.isCutsceneFinished(rt, 'Intro') === true);
  check('finished reads false for another cutscene',
    C.isCutsceneFinished(rt, 'Ending') === false);
  check('finished reads false on a null runtime',
    C.isCutsceneFinished(null, 'Intro') === false);
}

// --- routing sets ---
{
  check('isCutsceneAction routes play + stop only',
    C.isCutsceneAction('playCutscene') === true && C.isCutsceneAction('stopCutscene') === true &&
    C.isCutsceneAction('unlockAchievement') === false && C.isCutsceneAction('always') === false);
  check('isCutsceneCondition routes playing + finished only',
    C.isCutsceneCondition('cutscenePlaying') === true && C.isCutsceneCondition('cutsceneFinished') === true &&
    C.isCutsceneCondition('questComplete') === false && C.isCutsceneCondition('always') === false);
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

  const cTag = html.indexOf('src="hydra-cutscene.js');
  check('index.html loads hydra-cutscene.js before player-runtime.js and script.js',
    cTag !== -1 && cTag < html.indexOf('src="player-runtime.js') && cTag < html.indexOf('src="script.js'));
  check('index.html loads hydra-cutscene.js after hydra-achievement.js',
    cTag > html.indexOf('src="hydra-achievement.js'));
  check('index.html has a Cutscenes inspector tab',
    html.includes('data-inspector-tab="cutscenes"') && html.includes('data-inspector-panel="cutscenes"'));
  check('index.html has the Cutscenes panel + add button',
    html.includes('id="cutscenes-panel"') && html.includes('id="cutscenes-add-btn"'));
  check('script.js exposes the Cutscenes tab panel + init + rename propagation',
    scriptJs.includes('function renderCutscenesPanel') && scriptJs.includes('function initCutscenesPanel') &&
    scriptJs.includes('function propagateCutsceneRename') && scriptJs.includes('function getMutableCutscenes') &&
    scriptJs.includes('initCutscenesPanel()'));
  check('script.js hands the project cutscene table to the preview runtime',
    scriptJs.includes('function getProjectCutscenes') && scriptJs.includes('getProjectCutscenes,'));
  check('player-runtime.js hard-guards on HydraCutscene',
    playerJs.includes("requires hydra-cutscene.js (window.HydraCutscene)"));
  check('player-runtime.js inlines HydraCutscene into exports',
    playerJs.includes("'HydraCutscene', global.HydraCutscene && global.HydraCutscene.factorySource"));
  check('player-runtime.js creates the per-run cutscene runtime + table',
    playerJs.includes('cutscene: HydraCutscene.createCutsceneRuntime()') &&
    playerJs.includes('cutscenes: HydraCutscene.normalizeCutscenes(project.cutscenes)'));
  check('player-runtime.js routes cutscene blocks through the shared modules',
    playerJs.includes('HydraCutscene.isCutsceneCondition(type)') &&
    playerJs.includes('HydraCutscene.isCutsceneAction(type)') &&
    playerJs.includes('cutscene: state.cutscene') && playerJs.includes('cutsceneModule: HydraCutscene'));
  check('player-runtime.js advances the cutscene from the runScripts phase',
    playerJs.includes('updateCutscene(state)'));
  check('preview runtime holds the cutscene runtime + fresh-run reset',
    previewJs.includes('function cutsceneRuntime') && previewJs.includes('function resetCutsceneRuntime') &&
    previewJs.includes('resetCutsceneRuntime();'));
  check('preview runtime contexts carry the cutscene runtime state',
    previewJs.includes('cutscene: cutsceneRuntime()') && previewJs.includes("cutscenes: hostCall('getProjectCutscenes'"));
  check('preview runtime does NOT reset the cutscene on scene load',
    !previewJs.includes('resetCutscene: function'));
  check('hydra-universal.js defaults project.cutscenes to []',
    universalJs.includes('if (!Array.isArray(project.cutscenes)) project.cutscenes = [];'));
  check('shared conditions module evaluates the two cutscene conditions',
    conditionsJs.includes("case 'cutscenePlaying'") && conditionsJs.includes("case 'cutsceneFinished'"));
  check('shared execute module runs the two cutscene actions',
    executeJs.includes("isType(ctx.cutsceneModule, 'isCutsceneAction', type)") &&
    executeJs.includes("type === 'playCutscene'") && executeJs.includes("type === 'stopCutscene'"));
  check('flow module defaults Cutscene Playing to a level trigger',
    flowJs.includes("t === 'cutscenePlaying'"));

  // Catalog: four Cutscene blocks, schema-clean.
  const catSb = {}; catSb.window = catSb; vm.createContext(catSb);
  vm.runInContext(fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8'), catSb,
    { filename: 'block-catalog.js' });
  const catalog = catSb.HydraBlockCatalog;
  const cBlocks = catalog.blocks.filter(b => b.category === 'Cutscene');
  check('catalog carries four Cutscene blocks',
    cBlocks.length === 4, cBlocks.map(b => b.label).join(', '));
  const labels = cBlocks.map(b => b.label).sort();
  check('Cutscene blocks are the two actions + two conditions',
    JSON.stringify(labels) === JSON.stringify(['Cutscene Finished', 'Cutscene Playing', 'Play Cutscene', 'Stop Cutscene'].sort()),
    labels.join(', '));
  const findings = catalog.validateCatalog();
  check('catalog validates clean with the Cutscene blocks', findings.length === 0,
    JSON.stringify(findings.slice(0, 3)));
  const ref = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');
  check('every Cutscene block is documented in the block reference',
    cBlocks.every(b => ref.includes(b.label)), cBlocks.filter(b => !ref.includes(b.label)).map(b => b.label).join(', '));
  const guide = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');
  check('user guide has a Cutscenes section', guide.includes('## Cutscenes'));
}

process.exit(failures === 0 ? 0 : 1);
