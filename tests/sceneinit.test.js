// Unit tests for hydra/hydra-sceneinit.js — the shared scene-load object
// init module (P2 item 15/12, slice 2: the shared-engine extraction
// continues here).
//
// Pure logic: the fresh-runtime-state sequence every object gets when it
// enters the live world (scene load + spawn), plus the localization
// bound-text pass that runs at the same points. Nothing here touches the
// DOM; both runtimes (editor preview in script.js, export player in
// player-runtime.js) delegate to this module, so a behavior change here
// changes every entry point at once — which is the point of the extraction.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const HYDRA = path.join(__dirname, '..', 'hydra');
const sandbox = {};
sandbox.window = sandbox; // the modules assign to bare `window`
vm.createContext(sandbox);
['hydra-anim.js', 'hydra-statemachine.js', 'hydra-blendspace.js',
 'hydra-skeleton.js', 'hydra-localization.js', 'hydra-sceneinit.js'
].forEach(m => vm.runInContext(fs.readFileSync(path.join(HYDRA, m), 'utf8'),
  sandbox, { filename: m }));
const SI = sandbox.HydraSceneInit;

function heroObj(over) {
  return Object.assign({
    id: 1, name: 'hero', kind: 'sprite', posX: 10, posY: 20, width: 40, height: 40,
    color: '#ff0000', velX: 5, velY: -3, vel3x: 2, vel3y: 1, vel3z: -1,
    animations: [
      { name: 'Idle', mode: 'loop', fps: 8, frames: ['a1'] },
      { name: 'Run', mode: 'loop', fps: 8, frames: ['r1', 'r2'] }
    ],
    animStates: [
      { name: 'Idle', animation: 'Idle', speed: 1 },
      { name: 'Run', animation: 'Run', speed: 1.5 },
      { name: 'Flag', animation: '', speed: 1 }
    ]
  }, over || {});
}

function fullHooks(warn) {
  return {
    anim: sandbox.HydraAnim,
    stateMachine: sandbox.HydraStateMachine,
    blendSpace: sandbox.HydraBlendSpace,
    skeleton: sandbox.HydraSkeleton,
    warn: warn || function () {}
  };
}

// --- surface + factorySource ---
check('HydraSceneInit exposed with initSceneObjects + applyBoundTexts',
  !!SI && typeof SI.initSceneObjects === 'function' &&
  typeof SI.applyBoundTexts === 'function');
check('factorySource is a self-contained function string',
  typeof SI.factorySource === 'string' && SI.factorySource.includes('hydraSceneInitFactory'));
{
  const fresh = {};
  fresh.window = fresh;
  vm.createContext(fresh);
  vm.runInContext('window.HydraSceneInit=(' + SI.factorySource + ')();', fresh);
  check('factorySource re-instantiates an independent copy',
    !!fresh.HydraSceneInit && fresh.HydraSceneInit !== SI &&
    typeof fresh.HydraSceneInit.initSceneObjects === 'function');
}

// --- initSceneObjects: fresh runtime state ---
{
  const o = heroObj();
  const list = [o];
  const out = SI.initSceneObjects(list, fullHooks());
  check('initSceneObjects returns the same list', out === list);
  check('initSceneObjects resets 2D + 3D velocity to 0',
    o.velX === 0 && o.velY === 0 && o.vel3x === 0 && o.vel3y === 0 && o.vel3z === 0,
    JSON.stringify({ v: [o.velX, o.velY, o.vel3x, o.vel3y, o.vel3z] }));
  check('initSceneObjects marks the object alive with cleared runtime text',
    o._alive === true && o._runtimeText === undefined);
  check('initSceneObjects creates a fresh idle animation state',
    o._anim && o._anim.playing === false && o._anim.name === '' && o._anim.frameIndex === 0,
    JSON.stringify(o._anim));
  check('initSceneObjects creates a fresh state machine with no state',
    o._sm && o._sm.state === '', JSON.stringify(o._sm));
  check('initSceneObjects creates fresh blend + skeleton runtimes',
    o._blends && o._blends.active === '' && o._skel && o._skel.active === '',
    JSON.stringify({ b: o._blends, s: o._skel }));
  check('initSceneObjects resets tween state',
    Array.isArray(o._tweens) && o._tweens.length === 0 &&
    Array.isArray(o._tweenFinished) && o._tweenFinished.length === 0);
}
{
  const o = heroObj({ startAnimation: 'Run' });
  SI.initSceneObjects([o], fullHooks());
  check('play-at-start animation autoplays on init',
    o._anim && o._anim.playing === true && o._anim.name === 'Run' && o._anim.frameIndex === 0,
    JSON.stringify(o._anim));
}
{
  const o = heroObj({ startAnimation: 'Nope' });
  SI.initSceneObjects([o], fullHooks());
  check('unknown play-at-start animation stays idle without throwing',
    o._anim && o._anim.playing === false && o._anim.name === '',
    JSON.stringify(o._anim));
}
{
  const o = heroObj({ startAnimation: 'Run', animStateInitial: 'Idle' });
  SI.initSceneObjects([o], fullHooks());
  check('initial state wins over play-at-start',
    o._sm && o._sm.state === 'Idle' && o._anim && o._anim.name === 'Idle' && o._anim.playing === true,
    JSON.stringify({ sm: o._sm, anim: o._anim }));
}
{
  const o = heroObj({ animStateInitial: 'Run' });
  SI.initSceneObjects([o], fullHooks());
  check('initial state plays its animation at the state speed',
    o._sm && o._sm.state === 'Run' && o._anim && o._anim.name === 'Run' && o._anim.speed === 1.5,
    JSON.stringify({ sm: o._sm, anim: o._anim }));
}
{
  const o = heroObj({ animStateInitial: 'Flag' });
  SI.initSceneObjects([o], fullHooks());
  check('initial state with no animation enters without playing anything',
    o._sm && o._sm.state === 'Flag' && o._anim && o._anim.playing === false,
    JSON.stringify({ sm: o._sm, anim: o._anim }));
}
{
  const warns = [];
  const o = heroObj({ startAnimation: 'Run', animStateInitial: 'Ghost' });
  SI.initSceneObjects([o], fullHooks(m => warns.push(m)));
  check('unknown initial state warns and holds the old state',
    warns.length === 1 && /Ghost/.test(warns[0]) && o._sm && o._sm.state === '',
    JSON.stringify(warns));
  check('unknown initial state still autoplays play-at-start',
    o._anim && o._anim.playing === true && o._anim.name === 'Run',
    JSON.stringify(o._anim));
}

// --- initSceneObjects: hooks degradation ---
{
  const o = heroObj({ startAnimation: 'Run', animStateInitial: 'Idle' });
  SI.initSceneObjects([o]);
  check('no hooks: velocities still reset, runtimes null, no throw',
    o.velX === 0 && o.velY === 0 && o.vel3x === 0 && o._anim === null && o._sm === null &&
    o._blends === null && o._skel === null && Array.isArray(o._tweens),
    JSON.stringify({ a: o._anim, s: o._sm }));
}
{
  const o = heroObj({ startAnimation: 'Run', animStateInitial: 'Idle' });
  SI.initSceneObjects([o], {});
  check('empty hooks object degrades like no hooks',
    o._anim === null && o._sm === null && o.velX === 0 && o._alive === true);
}
{
  const o = heroObj({ startAnimation: 'Run', animStateInitial: 'Idle' });
  SI.initSceneObjects([o], Object.assign(fullHooks(), { anim: null }));
  check('null anim module: no autoplay, state machine still entered',
    o._anim === null && o._sm && o._sm.state === 'Idle',
    JSON.stringify({ a: o._anim, s: o._sm }));
}
{
  const o = heroObj({ startAnimation: 'Run', animStateInitial: 'Idle' });
  SI.initSceneObjects([o], Object.assign(fullHooks(), { stateMachine: null }));
  check('null state-machine module: autoplay still runs, no machine',
    o._anim && o._anim.playing === true && o._anim.name === 'Run' && o._sm === null,
    JSON.stringify({ a: o._anim, s: o._sm }));
}
{
  const o = heroObj({ startAnimation: 'Run', animStateInitial: 'Idle' });
  SI.initSceneObjects([o], Object.assign(fullHooks(), { blendSpace: null, skeleton: null }));
  check('null blend/skeleton modules: runtimes null, rest intact',
    o._blends === null && o._skel === null && o._anim && o._anim.playing === true &&
    o._sm && o._sm.state === 'Idle');
}
{
  const o = heroObj({ animStateInitial: 'Ghost' });
  SI.initSceneObjects([o], Object.assign(fullHooks(), { warn: 'not-a-function' }));
  check('non-function warn never throws on an unknown initial state',
    o._sm && o._sm.state === '');
}
{
  const throwingAnim = {
    createAnimState: () => { throw new Error('boom'); },
    play: sandbox.HydraAnim.play,
    setSpeed: sandbox.HydraAnim.setSpeed
  };
  const o = heroObj({ startAnimation: 'Run', animStateInitial: 'Idle' });
  SI.initSceneObjects([o], Object.assign(fullHooks(), { anim: throwingAnim }));
  check('throwing createAnimState degrades to null, rest still initializes',
    o._anim === null && o._sm && o._sm.state === 'Idle' && o.velX === 0 &&
    Array.isArray(o._tweens), JSON.stringify({ a: o._anim, s: o._sm }));
}
{
  const throwingPlay = {
    createAnimState: sandbox.HydraAnim.createAnimState,
    play: () => { throw new Error('boom'); },
    setSpeed: sandbox.HydraAnim.setSpeed
  };
  const o = heroObj({ startAnimation: 'Run', animStateInitial: 'Idle' });
  SI.initSceneObjects([o], Object.assign(fullHooks(), { anim: throwingPlay }));
  check('throwing play is swallowed, initial state still entered',
    o._anim && o._anim.playing === false && o._sm && o._sm.state === 'Idle',
    JSON.stringify({ a: o._anim, s: o._sm }));
}
{
  const throwingSM = {
    createRuntime: () => { throw new Error('boom'); },
    enterInitial: sandbox.HydraStateMachine.enterInitial
  };
  const o = heroObj({ startAnimation: 'Run', animStateInitial: 'Idle' });
  SI.initSceneObjects([o], Object.assign(fullHooks(), { stateMachine: throwingSM }));
  check('throwing createRuntime degrades to null, rest still initializes',
    o._sm === null && o._anim && o._anim.playing === true && o._blends !== null &&
    Array.isArray(o._tweens));
}
{
  const throwingEnter = {
    createRuntime: sandbox.HydraStateMachine.createRuntime,
    enterInitial: () => { throw new Error('boom'); }
  };
  const o = heroObj({ startAnimation: 'Run', animStateInitial: 'Idle' });
  SI.initSceneObjects([o], Object.assign(fullHooks(), { stateMachine: throwingEnter }));
  check('throwing enterInitial is swallowed, blend/skeleton/tweens still set',
    o._sm && o._sm.state === '' && o._blends !== null && o._skel !== null &&
    Array.isArray(o._tweens) && o._anim && o._anim.playing === true);
}

// --- initSceneObjects: hostile input ---
{
  check('initSceneObjects(null) returns []', JSON.stringify(SI.initSceneObjects(null, fullHooks())) === '[]');
  check('initSceneObjects(undefined) returns []', JSON.stringify(SI.initSceneObjects(undefined, fullHooks())) === '[]');
  check('initSceneObjects("nope") returns []', JSON.stringify(SI.initSceneObjects('nope', fullHooks())) === '[]');
  check('initSceneObjects(42) returns []', JSON.stringify(SI.initSceneObjects(42, fullHooks())) === '[]');
}
{
  const good = heroObj();
  const list = [null, 'x', undefined, good, 42];
  SI.initSceneObjects(list, fullHooks());
  check('null/non-object entries are skipped, real objects still initialize',
    good._anim !== null && good._sm !== null && good.velX === 0);
}
{
  const frozen = Object.freeze(heroObj());
  const good = heroObj();
  SI.initSceneObjects([frozen, good], fullHooks());
  check('a frozen object never breaks init for its siblings',
    good._anim !== null && good._sm !== null && good.velX === 0);
}

// --- applyBoundTexts ---
const LOC = {
  defaultLanguage: 'en',
  languages: ['en', 'fr'],
  entries: [
    { key: 'greeting', values: { en: 'Hello', fr: 'Bonjour' } },
    { key: 'only-en', values: { en: 'English only' } }
  ]
};
const boundTextFor = sandbox.HydraLocalization.boundTextFor;
{
  const o = { id: 2, name: 'label', kind: 'text', posX: 0, posY: 0, localeKey: 'greeting' };
  SI.applyBoundTexts([o], LOC, 'fr', boundTextFor);
  check('bound text applies the run language translation', o._runtimeText === 'Bonjour',
    JSON.stringify(o._runtimeText));
}
{
  const o = { id: 2, name: 'label', kind: 'text', posX: 0, posY: 0, localeKey: 'only-en', _runtimeText: 'Authored' };
  SI.applyBoundTexts([o], LOC, 'fr', boundTextFor);
  check('missing translation falls back to the default language', o._runtimeText === 'English only',
    JSON.stringify(o._runtimeText));
}
{
  const o = { id: 2, name: 'label', kind: 'text', posX: 0, posY: 0, _runtimeText: 'Authored' };
  SI.applyBoundTexts([o], LOC, 'fr', boundTextFor);
  check('unbound text keeps its authored text', o._runtimeText === 'Authored');
}
{
  const o = { id: 2, name: 'label', kind: 'text', posX: 0, posY: 0, localeKey: 'missing-key', _runtimeText: 'Authored' };
  SI.applyBoundTexts([o], LOC, 'fr', boundTextFor);
  check('unknown key keeps the authored text', o._runtimeText === 'Authored');
}
{
  const o = { id: 2, name: 'box', kind: 'sprite', posX: 0, posY: 0, localeKey: 'greeting', _runtimeText: 'Authored' };
  SI.applyBoundTexts([o], LOC, 'fr', boundTextFor);
  check('non-text objects are untouched by the bound-text pass', o._runtimeText === 'Authored');
}
{
  const o = { id: 2, name: 'label', kind: 'text', posX: 0, posY: 0, localeKey: 'greeting', _runtimeText: 'Authored' };
  SI.applyBoundTexts([o], LOC, 'fr', undefined);
  check('missing boundTextFor is a no-op, never throws', o._runtimeText === 'Authored');
  SI.applyBoundTexts([o], LOC, 'fr', null);
  check('null boundTextFor is a no-op too', o._runtimeText === 'Authored');
}
{
  const good = { id: 2, name: 'label', kind: 'text', posX: 0, posY: 0, localeKey: 'greeting' };
  const throwing = () => { throw new Error('boom'); };
  SI.applyBoundTexts([good], LOC, 'fr', throwing);
  check('a throwing boundTextFor leaves the text untouched', good._runtimeText === undefined);
  const list = [{ id: 3, name: 'a', kind: 'text', localeKey: 'greeting' }, null, 'x'];
  SI.applyBoundTexts(list, LOC, 'fr', boundTextFor);
  check('null entries skipped in the bound-text pass', list[0]._runtimeText === 'Bonjour');
}
{
  check('applyBoundTexts(null) returns []', JSON.stringify(SI.applyBoundTexts(null, LOC, 'en', boundTextFor)) === '[]');
  check('applyBoundTexts("nope") returns []', JSON.stringify(SI.applyBoundTexts('nope', LOC, 'en', boundTextFor)) === '[]');
  const list = [heroObj()];
  check('applyBoundTexts returns the same list', SI.applyBoundTexts(list, LOC, 'en', boundTextFor) === list);
}

// --- static routing: both runtimes delegate, nothing duplicated ---
{
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'index.html'), 'utf8');
  const siTag = indexHtml.indexOf('src="hydra-sceneinit.js');
  const playerTag = indexHtml.indexOf('src="player-runtime.js');
  const scriptTag = indexHtml.indexOf('src="script.js');
  check('index.html loads hydra-sceneinit.js before player-runtime.js and script.js',
    siTag !== -1 && playerTag !== -1 && scriptTag !== -1 && siTag < playerTag && siTag < scriptTag,
    `siTag=${siTag} playerTag=${playerTag} scriptTag=${scriptTag}`);
  const playerSrc = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'player-runtime.js'), 'utf8');
  check('player-runtime.js hard-guards on HydraSceneInit',
    /requires hydra-sceneinit\.js \(window\.HydraSceneInit\)/.test(playerSrc));
  check('player-runtime.js inlines HydraSceneInit into exports',
    playerSrc.includes("['HydraSceneInit', global.HydraSceneInit && global.HydraSceneInit.factorySource, 'hydra-sceneinit.js (window.HydraSceneInit)']"));
  check('player-runtime.js loadScene delegates object init to HydraSceneInit',
    playerSrc.includes('HydraSceneInit.initSceneObjects(state.objects, {') &&
    playerSrc.includes('HydraSceneInit.applyBoundTexts(state.objects, state.localization, state.language,'));
  // P2 item 15/12 slice 9: clone init moved into the shared HydraExecute
  // module's spawnClone (one site serving both spawn paths); both
  // runtimes pass HydraSceneInit through their action context.
  const executeSrc = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-execute.js'), 'utf8');
  check('hydra-execute.js spawnClone delegates clone init to HydraSceneInit',
    executeSrc.includes('ctx.sceneInit.initSceneObjects([cloneObj], hooks || {})'));
  check('player-runtime.js passes HydraSceneInit into the shared execute module',
    playerSrc.includes('sceneInit: HydraSceneInit,'));
  // P2 item 14 slice 7: actionCtx moved from script.js into the preview
  // runtime module — the module passes HydraSceneInit through its
  // action context via the getModule provider and the sceneInitHooks
  // through the host.
  const moduleSrc = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-previewruntime.js'), 'utf8');
  check('the preview runtime module passes HydraSceneInit into the shared execute module',
    moduleSrc.includes("sceneInit: mod('SceneInit'),"));
  check('the preview runtime module passes sceneInitHooks into the shared execute module',
    moduleSrc.includes("sceneInitHooks: function () { return hostCall('sceneInitHooks', [], {}); }"));
  check('player-runtime.js no longer inlines the spawn clone init',
    !playerSrc.includes('HydraSceneInit.initSceneObjects([cloneObj], {'));
  check('player-runtime.js no longer inlines the per-object init',
    !playerSrc.includes('o._anim = HydraAnim.createAnimState();') &&
    !playerSrc.includes('o._sm = HydraStateMachine.createRuntime();') &&
    !playerSrc.includes('o._blends = HydraBlendSpace.createBlendRuntime();') &&
    !playerSrc.includes('o._skel = HydraSkeleton.createSkeletonRuntime();') &&
    !playerSrc.includes('cloneObj._tweens = [];'));
  const scriptSrc = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'script.js'), 'utf8');
  // P2 item 14 slice 8: launchPreview / loadPreviewScene moved from
  // script.js into HydraPreviewRuntime; the two init sites live there now.
  const sceneInits = (moduleSrc.match(/SceneInit\.initSceneObjects\(rs\.objects, initHooks\)/g) || []).length;
  const cloneInits = (scriptSrc.match(/window\.HydraSceneInit\?\.initSceneObjects\?\.\(\[clone\], sceneInitHooks\(\)\)/g) || []).length;
  const boundTexts = (moduleSrc.match(/SceneInit\.applyBoundTexts\(rs\.objects,/g) || []).length;
  check('the preview runtime module delegates scene init at launch + scene switch (2 sites)',
    sceneInits === 2, `found ${sceneInits}`);
  // P2 item 15/12 slice 9: the two preview spawn paths now share one
  // init site in the module's spawnClone; the preview passes its hooks
  // through actionCtx instead of calling init at each spawn site.
  check('script.js no longer inits clones at the spawn sites (0 sites)',
    cloneInits === 0, `found ${cloneInits}`);
  check('the preview runtime module delegates the bound-text pass at launch + scene switch (2 sites)',
    boundTexts === 2, `found ${boundTexts}`);
  check('script.js no longer inlines the launch object init',
    !scriptSrc.includes('o._anim = window.HydraAnim?.createAnimState?.() || null') &&
    !scriptSrc.includes('enterInitial(o._sm, o, previewStateMachineHooks(o))') &&
    !scriptSrc.includes('clone._alive = true; clone._runtimeText = undefined; clone.rotation = 0;'));
}

if (failures > 0) { console.log(`sceneinit.test.js: ${failures} FAILURE(S)`); process.exit(1); }
console.log('sceneinit.test.js: all assertions passed');
