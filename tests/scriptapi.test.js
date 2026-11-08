// Unit tests for hydra/hydra-scriptapi.js — the text scripting API module.
//
// Pure logic: the `hs` API surface built over host hooks, the Run Script
// compile/run path, the Script Check compile/eval path, compile caching,
// and error policy (warn, never throw). Nothing here touches the DOM; both
// runtimes delegate to this module.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const sandbox = {};
sandbox.window = sandbox; // hydra-scriptapi.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-scriptapi.js'), 'utf8'),
  sandbox, { filename: 'hydra-scriptapi.js' });
const S = sandbox.HydraScriptApi;

check('HydraScriptApi exposed with helpers',
  !!S && typeof S.createScriptAPI === 'function' && typeof S.runAction === 'function' &&
  typeof S.evalCondition === 'function' && typeof S.clearCache === 'function' &&
  typeof S.wrapObject === 'function');
check('factorySource is a self-contained function string',
  typeof S.factorySource === 'string' && S.factorySource.includes('hydraScriptApiFactory'));

// --- stub hooks -----------------------------------------------------------
function makeHooks() {
  const warnings = [];
  const vars = { score: 10 };
  const objects = [
    { id: 1, name: 'hero', kind: 'sprite', posX: 100, posY: 50, width: 40, height: 30, visible: true },
    { id: 2, name: 'coin', kind: 'sprite', posX: 200, posY: 60, width: 16, height: 16, visible: true }
  ];
  const destroyed = [];
  const hidden = new Set();
  const played = [];
  const hooks = {
    warnings, vars, objects, destroyed, hidden, played,
    getVar: (n) => vars[n],
    setVar: (n, v) => { vars[n] = v; },
    hasVar: (n) => Object.prototype.hasOwnProperty.call(vars, n),
    liveObjects: (n) => objects.filter(o => o.name === n && destroyed.indexOf(o.id) < 0),
    destroyObject: (o) => { destroyed.push(o.id); },
    isHidden: (o) => hidden.has(o.id),
    setHidden: (o, hide) => { if (hide) hidden.add(o.id); else hidden.delete(o.id); },
    inputState: (n) => n === 'Jump' ? { held: true, pressed: false, released: false } : { held: false, pressed: false, released: false },
    timerElapsed: (n) => n === 'run' ? 12.5 : 0,
    timerStart: (n) => { hooks.started = n; },
    timerStop: (n) => { hooks.stopped = n; },
    playSound: (n, opts) => { played.push([n, opts]); },
    stopMusic: () => { hooks.musicStopped = true; },
    setBusVolume: (b, v) => { hooks.busVol = [b, v]; },
    setBusMuted: (b, on) => { hooks.busMuted = [b, on]; },
    musicPlaying: () => true,
    switchScene: (n) => { hooks.switched = n; },
    currentSceneName: () => 'Level 1',
    cameraRead: () => ({ x: 10, y: 20, zoom: 2 }),
    cameraMove: (x, y) => { hooks.camMoved = [x, y]; },
    cameraZoom: (z) => { hooks.camZoom = z; },
    cameraCenterOn: (n) => { hooks.camCenter = n; },
    cameraFollow: (n, ox, oy) => { hooks.camFollow = [n, ox, oy]; },
    cameraStopFollow: () => { hooks.camStop = true; },
    cameraReset: () => { hooks.camReset = true; },
    emitBurst: (p, x, y) => { hooks.burst = [p, x, y]; },
    startEmitter: (n, p, x, y) => { hooks.emitter = [n, p, x, y]; },
    stopEmitter: (n) => { hooks.emitterStopped = n; },
    clearParticles: () => { hooks.particlesCleared = true; },
    saveGame: (s) => { hooks.saved = s; },
    loadGame: (s) => { hooks.loaded = s; },
    deleteSave: (s) => { hooks.deleted = s; },
    saveExists: (s) => s === 'Slot 1',
    pause: () => { hooks.paused = true; },
    resume: () => { hooks.paused = false; },
    isPaused: () => !!hooks.paused,
    showProfiler: () => { hooks.profShown = true; },
    hideProfiler: () => { hooks.profHidden = true; },
    profilerVisible: () => !!hooks.profShown,
    setTile: (n, c, r, t) => { hooks.tile = [n, c, r, t]; },
    tileSolidAt: (n, x, y) => n === 'map' && x > 0,
    dtSeconds: () => 1 / 60,
    warn: (m) => { warnings.push(String(m)); },
    log: (m) => { hooks.logged = m; }
  };
  return hooks;
}

// --- runAction ------------------------------------------------------------
{
  S.clearCache();
  const hooks = makeHooks();
  S.runAction(hooks, "hs.set('score', hs.get('score') + 5);");
  check('runAction runs statements against hooks', hooks.vars.score === 15);
  check('runAction with no errors warns nothing', hooks.warnings.length === 0);

  S.runAction(hooks, '   \n  ');
  check('blank code is a quiet no-op', hooks.warnings.length === 0 && hooks.vars.score === 15);

  S.runAction(hooks, null);
  check('null code is a quiet no-op', hooks.warnings.length === 0);

  S.runAction(hooks, 42);
  check('non-string code warns and skips', hooks.warnings.length === 1 && /not text/.test(hooks.warnings[0]));

  const w0 = hooks.warnings.length;
  S.runAction(hooks, 'hs.set( = broken');
  check('syntax error warns with the message', hooks.warnings.length === w0 + 1 && /Script error/.test(hooks.warnings[w0]));
  S.runAction(hooks, 'hs.set( = broken');
  check('compile failure is cached (one warning for two runs)', hooks.warnings.length === w0 + 1);

  const w1 = hooks.warnings.length;
  S.runAction(hooks, 'hs.get("score").nope();');
  check('runtime error warns and never throws', hooks.warnings.length === w1 + 1 && /while running/.test(hooks.warnings[w1]));
  check('game state survives the runtime error', hooks.vars.score === 15);

  const w2 = hooks.warnings.length;
  S.runAction(null, 'hs.set("x", 1);');
  check('missing hooks never throws (runAction)', hooks.warnings.length === w2);
}

// --- evalCondition --------------------------------------------------------
{
  S.clearCache();
  const hooks = makeHooks();
  check('expression true reads true', S.evalCondition(hooks, "hs.get('score') > 5") === true);
  check('expression false reads false', S.evalCondition(hooks, "hs.get('score') > 50") === false);
  check('statement mode with return works', S.evalCondition(hooks, "var s = hs.get('score');\nreturn s === 10;") === true);
  check('statement mode without return reads false', S.evalCondition(hooks, "hs.get('score');") === false);
  check('blank code reads false quietly', S.evalCondition(hooks, '  ') === false && hooks.warnings.length === 0);
  check('null code reads false quietly', S.evalCondition(hooks, null) === false && hooks.warnings.length === 0);
  const w0 = hooks.warnings.length;
  check('syntax error reads false and warns', S.evalCondition(hooks, 'hs.get( = nope') === false && hooks.warnings.length === w0 + 1);
  check('runtime error reads false and warns', S.evalCondition(hooks, 'missingFn() > 1') === false && hooks.warnings.length === w0 + 2);
  check('non-string code reads false and warns', S.evalCondition(hooks, {}) === false && hooks.warnings.length === w0 + 3);
  check('missing hooks reads false without throwing', S.evalCondition(undefined, "1 === 1") === true);
}

// --- hs variables / objects ------------------------------------------------
{
  const hooks = makeHooks();
  const hs = S.createScriptAPI(hooks);
  check('hs.get returns the variable', hs.get('score') === 10);
  check('hs.get missing reads 0', hs.get('nope') === 0);
  check('hs.get blank reads 0', hs.get('  ') === 0);
  check('hs.set returns the value and writes', hs.set('score', 99) === 99 && hooks.vars.score === 99);
  const w0 = hooks.warnings.length;
  hs.set('   ', 1);
  check('hs.set blank name warns', hooks.warnings.length === w0 + 1);
  check('hs.has true/false', hs.has('score') === true && hs.has('nope') === false);

  const hero = hs.obj('hero');
  check('hs.obj wraps the first live object', !!hero && hero.name === 'hero' && hero.x === 100 && hero.y === 50);
  check('hs.obj missing returns null', hs.obj('ghost') === null);
  check('hs.objs returns all matches', hs.objs('coin').length === 1);
  check('hs.count counts live objects', hs.count('hero') === 1 && hs.count('ghost') === 0);

  hero.move(10, -5);
  check('wrapper move() shifts posX/posY', hooks.objects[0].posX === 110 && hooks.objects[0].posY === 45);
  hero.teleport(1, 2);
  check('wrapper teleport() sets posX/posY', hooks.objects[0].posX === 1 && hooks.objects[0].posY === 2);
  check('wrapper cx/cy read center', hero.cx === 21 && hero.cy === 17);
  hero.cx = 100;
  check('wrapper cx setter moves by center', hooks.objects[0].posX === 80);
  hero.hide();
  check('wrapper hide() hides via the hidden hook', hooks.hidden.has(1) && hero.visible === false);
  hero.show();
  check('wrapper show() restores via the hidden hook', !hooks.hidden.has(1) && hero.visible === true);
  hero.visible = false;
  check('wrapper visible setter hides', hooks.hidden.has(1));
  hero.setText('hi');
  check('wrapper setText writes _runtimeText', hooks.objects[0]._runtimeText === 'hi' && hero.text === 'hi');
  hero.setOpacity(0.5);
  check('wrapper setOpacity clamps 0..1', hooks.objects[0].opacity === 0.5);
  hero.setOpacity(9);
  check('wrapper setOpacity clamps high', hooks.objects[0].opacity === 1);
  hero.destroy();
  check('wrapper destroy() calls the destroy hook', hooks.destroyed.indexOf(1) >= 0);
  check('destroyed object no longer listed', hs.count('hero') === 0);

  const d = S.createScriptAPI(makeHooks()).dist('hero', 'coin');
  check('hs.dist measures center distance by names', Math.abs(d - Math.sqrt(88 * 88 + 3 * 3)) < 0.001);
  check('hs.dist unknown names reads 0', S.createScriptAPI(makeHooks()).dist('hero', 'ghost') === 0);
}

// --- input / timers / audio / scenes --------------------------------------
{
  const hooks = makeHooks();
  const hs = S.createScriptAPI(hooks);
  const jump = hs.input('Jump');
  check('hs.input reads held/pressed/released', jump.held === true && jump.pressed === false && jump.released === false);
  const other = hs.input('Crouch');
  check('hs.input unknown action reads zeros', other.held === false && other.pressed === false && other.released === false);
  check('hs.input blank reads zeros', hs.input('').held === false);

  check('hs.elapsed reads the timer', hs.elapsed('run') === 12.5);
  check('hs.elapsed unstarted reads 0', hs.elapsed('new') === 0);
  hs.startTimer('run');
  check('hs.startTimer calls the hook', hooks.started === 'run');
  const w0 = hooks.warnings.length;
  hs.startTimer('  ');
  check('hs.startTimer blank warns', hooks.warnings.length === w0 + 1);
  hs.stopTimer('run');
  check('hs.stopTimer calls the hook', hooks.stopped === 'run');
  check('hs.resetTimer is an alias of startTimer', (() => { hs.resetTimer('r2'); return hooks.started === 'r2'; })());

  hs.play('coin');
  check('hs.play calls the hook with defaults', hooks.played.length === 1 && hooks.played[0][0] === 'coin');
  hs.play('theme', { bus: 'music', volume: 0.5, pitch: 1.2 });
  check('hs.play passes options through', hooks.played[1][1].bus === 'music' && hooks.played[1][1].volume === 0.5 && hooks.played[1][1].pitch === 1.2);
  const w1 = hooks.warnings.length;
  hs.play('  ');
  check('hs.play blank warns', hooks.warnings.length === w1 + 1);
  hs.stopMusic();
  check('hs.stopMusic calls the hook', hooks.musicStopped === true);
  hs.setBusVolume('music', 0.3);
  check('hs.setBusVolume passes through', hooks.busVol[0] === 'music' && hooks.busVol[1] === 0.3);
  hs.setBusMuted('sfx', true);
  check('hs.setBusMuted passes through', hooks.busMuted[0] === 'sfx' && hooks.busMuted[1] === true);
  check('hs.musicPlaying reads the hook', hs.musicPlaying() === true);

  hs.switchScene('Level 2');
  check('hs.switchScene calls the hook', hooks.switched === 'Level 2');
  const w2 = hooks.warnings.length;
  hs.switchScene('');
  check('hs.switchScene blank warns', hooks.warnings.length === w2 + 1);
  check('hs.scene reads the current scene', hs.scene() === 'Level 1');
}

// --- camera / particles / save / flow / tiles / math ----------------------
{
  const hooks = makeHooks();
  const hs = S.createScriptAPI(hooks);
  check('hs.camera reads x/y/zoom', hs.camera.x === 10 && hs.camera.y === 20 && hs.camera.zoom === 2);
  hs.camera.moveTo(5, 6);
  check('hs.camera.moveTo calls the hook', hooks.camMoved[0] === 5 && hooks.camMoved[1] === 6);
  hs.camera.setZoom(1.5);
  check('hs.camera.setZoom calls the hook', hooks.camZoom === 1.5);
  hs.camera.centerOn('hero');
  check('hs.camera.centerOn calls the hook', hooks.camCenter === 'hero');
  hs.camera.follow('hero', 0, -40);
  check('hs.camera.follow calls the hook', hooks.camFollow[0] === 'hero' && hooks.camFollow[2] === -40);
  hs.camera.stopFollow();
  check('hs.camera.stopFollow calls the hook', hooks.camStop === true);
  hs.camera.reset();
  check('hs.camera.reset calls the hook', hooks.camReset === true);

  hs.burst('Explosion', 10, 20);
  check('hs.burst calls the hook', hooks.burst[0] === 'Explosion' && hooks.burst[1] === 10 && hooks.burst[2] === 20);
  hs.startEmitter('fire1', 'Fire', 1, 2);
  check('hs.startEmitter calls the hook', hooks.emitter[0] === 'fire1' && hooks.emitter[1] === 'Fire');
  const w0 = hooks.warnings.length;
  hs.startEmitter('  ', 'Fire', 1, 2);
  check('hs.startEmitter blank warns', hooks.warnings.length === w0 + 1);
  hs.stopEmitter('fire1');
  check('hs.stopEmitter calls the hook', hooks.emitterStopped === 'fire1');
  hs.clearParticles();
  check('hs.clearParticles calls the hook', hooks.particlesCleared === true);

  hs.saveGame('Slot 1');
  check('hs.saveGame calls the hook', hooks.saved === 'Slot 1');
  hs.loadGame('Slot 1');
  check('hs.loadGame calls the hook', hooks.loaded === 'Slot 1');
  hs.deleteSave('Slot 1');
  check('hs.deleteSave calls the hook', hooks.deleted === 'Slot 1');
  check('hs.saveExists reads the hook', hs.saveExists('Slot 1') === true && hs.saveExists('Slot 9') === false);

  check('hs.isPaused starts false', hs.isPaused() === false);
  hs.pause();
  check('hs.pause/isPaused round-trip', hs.isPaused() === true);
  hs.resume();
  check('hs.resume clears pause', hs.isPaused() === false);
  hs.showProfiler();
  check('hs.showProfiler calls the hook', hooks.profShown === true);
  hs.hideProfiler();
  check('hs.hideProfiler calls the hook', hooks.profHidden === true);
  check('hs.profilerVisible reads the hook', hs.profilerVisible() === true);

  hs.setTile('map', 1, 2, 3);
  check('hs.setTile calls the hook', hooks.tile.join(',') === 'map,1,2,3');
  check('hs.tileSolidAt reads the hook', hs.tileSolidAt('map', 10, 10) === true && hs.tileSolidAt('map', -1, 10) === false);

  check('hs.rand stays in range', (() => { for (let i = 0; i < 50; i++) { const r = hs.rand(5, 10); if (r < 5 || r >= 10) return false; } return true; })());
  check('hs.randInt stays inclusive', (() => { for (let i = 0; i < 50; i++) { const r = hs.randInt(1, 3); if (r < 1 || r > 3 || Math.floor(r) !== r) return false; } return true; })());
  check('hs.clamp clamps', hs.clamp(9, 0, 5) === 5 && hs.clamp(-1, 0, 5) === 0 && hs.clamp(3, 0, 5) === 3);
  check('hs.round rounds', hs.round(2.6) === 3);
  check('hs.dt reads frame seconds', Math.abs(hs.dt - 1 / 60) < 1e-9);
  hs.log('hello');
  check('hs.log calls the hook', hooks.logged === 'hello');
}

// --- hostile hooks: everything degrades, nothing throws --------------------
{
  const hs = S.createScriptAPI(null);
  const fns = ['get', 'set', 'has', 'obj', 'objs', 'count', 'input', 'elapsed',
    'startTimer', 'stopTimer', 'play', 'stopMusic', 'setBusVolume', 'setBusMuted',
    'musicPlaying', 'switchScene', 'scene', 'burst', 'startEmitter', 'stopEmitter',
    'clearParticles', 'saveGame', 'loadGame', 'deleteSave', 'saveExists',
    'pause', 'resume', 'isPaused', 'showProfiler', 'hideProfiler', 'profilerVisible',
    'setTile', 'tileSolidAt', 'rand', 'randInt', 'clamp', 'round', 'dist', 'log'];
  let threw = false;
  try {
    for (const k of fns) {
      if (k === 'scene' || k === 'musicPlaying' || k === 'isPaused' || k === 'saveExists' ||
          k === 'tileSolidAt' || k === 'profilerVisible' || k === 'has' || k === 'count') hs[k]('x');
      else if (k === 'get' || k === 'obj' || k === 'objs' || k === 'input' || k === 'elapsed') hs[k]('x');
      else if (k === 'clamp') hs[k](1, 0, 2);
      else if (k === 'rand' || k === 'randInt' || k === 'round') hs[k](1);
      else if (k === 'dist') hs[k]('a', 'b');
      else if (k === 'set') hs[k]('x', 1);
      else if (k === 'play') hs[k]('x', {});
      else hs[k]();
    }
    hs.camera.moveTo(1, 2); hs.camera.setZoom(1); hs.camera.centerOn('x');
    hs.camera.follow('x', 0, 0); hs.camera.stopFollow(); hs.camera.reset();
    const _ = hs.camera.x + hs.camera.y + hs.camera.zoom + hs.dt;
  } catch (e) { threw = true; }
  check('hostile (null) hooks never throw', threw === false);
  check('hostile hooks give safe defaults', hs.get('x') === 0 && hs.obj('x') === null && hs.isPaused() === false);
}

process.exit(failures === 0 ? 0 : 1);
