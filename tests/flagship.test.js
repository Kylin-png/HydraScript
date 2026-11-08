// F5 flagship template test: Hydra Quest.
//
// Builds the REAL template through HydraStarterTemplates.createProject,
// validates its structure (scenes, blocks, object references, animation
// assets), boots the REAL exported HTML, and plays the whole game start to
// finish with scripted input in the stubbed runtime: menu -> level select ->
// level 1 (pause menu, coin, enemy hit) -> level 2 -> level 3 -> win screen,
// plus the game-over -> retry path and the level-lock gating.
//
// The zero-diagnostics assertion at the end is the strong gate: every block
// type in every scene must be known and every expression must evaluate
// without warnings, or the template is not shippable.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HYDRA = path.join(__dirname, '..', 'hydra');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

// All block types the exported runtime understands (mirrors the
// isCondition/isAction lists in hydra/player-runtime.js).
const VALID_TYPES = new Set([
  'gameStart', 'always', 'keyPressed', 'keyJustPressed', 'mouseClick', 'mouseOverObject',
  'objectClicked', 'getVariable', 'collision', 'onFloor', 'overlapTouch', 'distanceCheck',
  'positionCheck', 'velocityCheck', 'objectVisible', 'objectCount', 'chance', 'onTimer',
  'onEdge', 'and', 'triggerOnce', 'animationFinished', 'tweenFinished', 'saveSlotExists',
  'gamePaused', 'comment',
  'applyForce', 'teleport', 'setVariable', 'destroyObject', 'showHide', 'playSound',
  'playAnimation', 'setAnimation', 'stopAnimation', 'switchScene', 'setText', 'setCamera',
  'followCamera', 'setSize', 'setVelocity', 'spawnObject', 'rotateObject', 'randomVariable',
  'forceToward', 'forceTowardPosition', 'moveTowardPosition', 'moveTowardObject',
  'impulseAwayObject', 'stopObject', 'setPosition', 'clampToScreen', 'wrapScreen',
  'destroyOutsideScreen', 'setGravity', 'setFriction', 'setMaxSpeed', 'setBounciness',
  'setPhysicsEnabled', 'setStatic', 'setColor', 'setOpacity', 'setLayer',
  'pointTowardObject', 'pointTowardPosition', 'faceMovement', 'timerControl',
  'screenShake', 'restartScene', 'nextScene', 'previousScene', 'spawnAtObject',
  'separateObjects', 'saveVariable', 'loadVariable', 'saveGame', 'loadGame',
  'deleteSaveSlot', 'tweenProperty', 'stopTween', 'pauseGame', 'resumeGame', 'togglePause'
]);
const OBJECT_REF_FIELDS = ['targetObject', 'object1', 'object2', 'platformObject', 'sourceObject'];

// ---------- build the template ----------
const tb = {}; tb.window = tb; vm.createContext(tb);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-universal.js'), 'utf8'), tb, { filename: 'hydra-universal.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'starter-templates.js'), 'utf8'), tb, { filename: 'starter-templates.js' });
const project = tb.HydraStarterTemplates.createProject('flagship', 'Hydra Quest', () => 'flagship-test-id');
check('flagship template registered', tb.HydraStarterTemplates.templates.some(t => t.id === 'flagship'));
check('flagship template marked featured', tb.HydraStarterTemplates.templates.some(t => t.id === 'flagship' && t.featured === true));

// ---------- Phase A: structure ----------
check('template has 8 scenes', project.scenes.length === 8, String(project.scenes.length));
const sceneIds = project.scenes.map(s => s.id);
check('scene ids are 1..8', JSON.stringify(sceneIds) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8]),
  JSON.stringify(sceneIds));
const expectedNames = ['Main Menu', 'How to Play', 'Level Select', 'Level 1 - Green Hills',
  'Level 2 - Sky Bridges', 'Level 3 - Ember Caverns', 'You Win', 'Game Over'];
check('scene names match the flagship plan',
  JSON.stringify(project.scenes.map(s => s.name)) === JSON.stringify(expectedNames),
  project.scenes.map(s => s.name).join(' | '));

let totalBlocks = 0;
const badTypes = [], badRefs = [], badAnims = [];
project.scenes.forEach(scene => {
  const names = new Set((scene.objects || []).map(o => o.name));
  totalBlocks += Object.keys(scene.gridData || {}).length;
  Object.entries(scene.gridData || {}).forEach(([idx, b]) => {
    if (!b || typeof b.type !== 'string') { badTypes.push(`${scene.name}#${idx}: missing type`); return; }
    if (!VALID_TYPES.has(b.type)) badTypes.push(`${scene.name}#${idx}: ${b.type}`);
    OBJECT_REF_FIELDS.forEach(f => {
      if (typeof b[f] === 'string' && b[f].length > 0 && !names.has(b[f])) {
        badRefs.push(`${scene.name}#${idx}: ${f}="${b[f]}"`);
      }
    });
    if (b.type === 'switchScene' && !sceneIds.includes(Number(b.sceneId))) {
      badRefs.push(`${scene.name}#${idx}: switchScene -> ${b.sceneId}`);
    }
    if ((b.type === 'playAnimation' || b.type === 'animationFinished') && b.targetObject && b.animation) {
      const obj = (scene.objects || []).find(o => o.name === b.targetObject);
      const anims = (obj && obj.animations || []).map(a => a.name);
      if (!anims.includes(b.animation)) badAnims.push(`${scene.name}#${idx}: ${b.animation}`);
    }
    if (['saveGame', 'loadGame', 'deleteSaveSlot', 'saveSlotExists'].includes(b.type) && b.slotName !== 'HydraQuest') {
      badRefs.push(`${scene.name}#${idx}: slot "${b.slotName}"`);
    }
  });
});
check('every scene ships blocks', project.scenes.every(s => Object.keys(s.gridData || {}).length > 0),
  `total=${totalBlocks}`);
check('every block type is understood by the runtime', badTypes.length === 0, badTypes.slice(0, 5).join('; '));
check('every object reference resolves in its scene', badRefs.length === 0, badRefs.slice(0, 5).join('; '));
check('every animation reference names a real animation', badAnims.length === 0, badAnims.slice(0, 5).join('; '));

// assets: every animation frame resolves to a real PNG data URL
const missingAssets = [];
project.scenes.forEach(scene => {
  (scene.objects || []).forEach(o => {
    (o.animations || []).forEach(a => {
      (a.frames || []).forEach(f => {
        const rec = project.assets && project.assets[f];
        if (!rec || typeof rec.dataUrl !== 'string' || !rec.dataUrl.startsWith('data:image/png;base64,')) {
          missingAssets.push(`${o.name}/${a.name}: ${f}`);
        }
      });
    });
  });
});
check('all animation frames resolve to PNG assets', missingAssets.length === 0, missingAssets.slice(0, 5).join('; '));
const pngBytes = Buffer.from(project.assets['hq-hero-run1'].dataUrl.split(',')[1], 'base64');
check('generated frames are real PNGs (magic bytes)',
  pngBytes[0] === 137 && pngBytes[1] === 80 && pngBytes[2] === 78 && pngBytes[3] === 71);

// normalization round trip (the editor does this on load)
let normalized = null, normError = null;
try {
  normalized = tb.HydraUniversal.normalizeProject(JSON.parse(JSON.stringify(project)));
} catch (e) { normError = e; }
check('normalizeProject accepts the flagship project', normError === null, normError && normError.message);
check('assets survive normalization', normalized && Object.keys(normalized.assets || {}).length === 9,
  String(normalized && Object.keys(normalized.assets || {}).length));
const normPlayer = normalized.scenes[3].objects.find(o => o.name === 'player');
check('player animations survive normalization',
  normPlayer && normPlayer.animations.length === 2 && normPlayer.startAnimation === 'Run');

// ---------- Phase B: export boot ----------
function makeCtx() {
  return new Proxy({}, {
    get(t, p) { if (p === Symbol.toPrimitive) return () => 0; return () => undefined; },
    set() { return true; }
  });
}
function makeLocalStorage() {
  const d = {};
  return {
    getItem: k => (k in d ? d[k] : null),
    setItem: (k, v) => { d[k] = String(v); },
    removeItem: k => { delete d[k]; },
    _dump: () => d
  };
}
function makeBrowserStubs() {
  const rafCallbacks = [];
  const warned = [];
  const canvasListeners = {};
  const clock = { now: 0 };
  const canvas = {
    width: 300, height: 150, tabIndex: 0, style: {},
    getContext: () => makeCtx(),
    addEventListener(type, fn) { (canvasListeners[type] = canvasListeners[type] || []).push(fn); },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    focus() {}
  };
  const hud = { textContent: '' };
  const documentElement = { dataset: {} };
  const document = {
    documentElement,
    body: { appendChild() {} },
    querySelector: () => canvas,
    getElementById: (id) => (id === 'hydra-hud' ? hud : canvas),
    addEventListener() {},
    createElement: () => ({ style: {}, textContent: '' })
  };
  const sandbox = {
    console: Object.assign(Object.create(console), { warn: (...a) => { warned.push(a.join(' ')); } }),
    document, canvas, hud, canvasListeners, warned,
    localStorage: makeLocalStorage(),
    performance: { now: () => clock.now }, // deterministic clock for onTimer
    Image: function () { this.complete = false; this.naturalWidth = 0; }, // sprite frames: draw falls back to color rects
    addEventListener() {},
    requestAnimationFrame: (cb) => { rafCallbacks.push(cb); return rafCallbacks.length; },
    setTimeout: () => 0,
    clearTimeout: () => {}
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return { sandbox, rafCallbacks, canvas, hud, canvasListeners, warned, documentElement, clock };
}
function loadRuntime(sb) {
  for (const f of ['hydra-expr.js', 'hydra-input.js', 'hydra-audio.js', 'hydra-anim.js',
    'hydra-tween.js', 'hydra-ui.js', 'hydra-save.js', 'hydra-pause.js', 'hydra-camerafx.js', 'hydra-sceneinit.js', 'hydra-frame.js', 'hydra-physicsstep.js', 'hydra-scenereset.js', 'hydra-draw.js', 'hydra-dispatch.js', 'hydra-conditions.js', 'hydra-execute.js', 'hydra-particles.js', 'hydra-actions.js', 'hydra-buses.js', 'hydra-tiles.js', 'hydra-physics2d.js', 'hydra-flow.js', 'hydra-collections.js', 'hydra-math.js', 'hydra-pick.js', 'hydra-layerfx.js', 'hydra-gltf.js', 'hydra-3d.js', 'hydra-profile.js', 'hydra-scriptapi.js', 'hydra-statemachine.js', 'hydra-blendspace.js', 'hydra-light2d.js', 'hydra-joints.js', 'hydra-skeleton.js', 'hydra-localization.js', 'hydra-dialogue.js', 'hydra-inventory.js', 'hydra-quest.js', 'hydra-achievement.js', 'hydra-cutscene.js', 'hydra-highscore.js', 'hydra-timescale.js', 'hydra-transition.js', 'hydra-camerafeel.js', 'hydra-parallax.js', 'hydra-spatialaudio.js', 'hydra-pathfind.js', 'hydra-ai.js', 'hydra-joystick.js', 'hydra-health.js', 'hydra-damagefx.js', 'hydra-respawn.js', 'hydra-spawn.js', 'hydra-lives.js', 'hydra-movement.js', 'hydra-platform.js', 'hydra-combat.js', 'hydra-xp.js', 'hydra-growth.js', 'hydra-scaling.js', 'hydra-boss.js', 'hydra-tags.js', 'hydra-minimap.js', 'hydra-attach.js', 'hydra-variables.js', 'hydra-functions.js', 'hydra-loops.js', 'hydra-events.js', 'hydra-trace.js', 'player-runtime.js']) {
    vm.runInContext(fs.readFileSync(path.join(HYDRA, f), 'utf8'), sb, { filename: f });
  }
}
const ed = makeBrowserStubs();
loadRuntime(ed.sandbox);
const html = ed.sandbox.window.HydraPlayer.buildPlayableHtml(project);
check('flagship export produced HTML', typeof html === 'string' && html.length > 50000, `length=${html && html.length}`);
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const boot = makeBrowserStubs();
let bootError = null;
try {
  vm.runInContext(scripts[0], boot.sandbox, { filename: 'export-runtime.js' });
  vm.runInContext(scripts[1], boot.sandbox, { filename: 'export-boot.js' });
} catch (e) { bootError = e; }
check('flagship export boots (hydraPlayer=ready)', bootError === null &&
  boot.documentElement.dataset.hydraPlayer === 'ready',
  bootError ? bootError.stack : boot.documentElement.dataset.hydraPlayer);

// ---------- Phase C: scripted playthrough ----------
const play = makeBrowserStubs();
loadRuntime(play.sandbox);
// HydraPause/HydraSave in the test context for assertions (same object refs cross the vm boundary)
const libSb = {}; libSb.window = libSb; vm.createContext(libSb);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-pause.js'), 'utf8'), libSb, { filename: 'hydra-pause.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-save.js'), 'utf8'), libSb, { filename: 'hydra-save.js' });
const HydraPause = libSb.HydraPause, HydraSave = libSb.HydraSave;

const state = play.sandbox.window.HydraPlayer.start(project, { canvas: play.canvas });
let t = 0;
function pump(n) {
  for (let i = 0; i < n; i++) {
    t += 16.67;
    play.clock.now = t;
    play.rafCallbacks.splice(0, play.rafCallbacks.length).forEach(cb => cb(t));
  }
}
function named(name) {
  return state.objects.find(o => o.name === name);
}
function clickScreen(sx, sy) {
  // canvas pixels -> client coords through the stub rect
  const clientX = (sx / play.canvas.width) * 800;
  const clientY = (sy / play.canvas.height) * 600;
  (play.canvasListeners.mousedown || []).forEach(fn => fn({ button: 0, clientX, clientY }));
}
function clickObject(name) {
  const o = named(name);
  if (!o) throw new Error('no such object: ' + name);
  clickScreen(o.posX + o.width / 2, o.posY + o.height / 2);
}
function teleport(name, x, y) {
  const o = named(name);
  o.posX = x; o.posY = y; o.velX = 0; o.velY = 0;
}
function teleportOntoObject(mover, targetName) {
  const tgt = named(targetName);
  teleport(mover, tgt.posX + tgt.width / 2 - named(mover).width / 2,
    tgt.posY + tgt.height / 2 - named(mover).height / 2);
}

pump(90); // menu: music timers, animations, loadGame (empty slot)
check('menu has no physics hero falling in the background', !named('player'));
check('menu coin spin animation advanced frames', (() => {
  const c = named('decoCoin1');
  return !!(c && c._anim && c._anim.playing);
})());

// menu -> level select
clickObject('playBtn');
pump(3);
check('Play button goes to Level Select', state.sceneId === 3, `sceneId=${state.sceneId}`);
check('score reset when starting from the menu', state.variables.score === 0);

// locked level 2 cannot be entered yet
clickObject('l2Btn'); // hidden: the click must not fire
pump(3);
check('locked Level 2 button does nothing', state.sceneId === 3, `sceneId=${state.sceneId}`);
check('level 2 lock label is shown', !state.hidden.has(named('l2Lock').id));
check('level 2 button is hidden', state.hidden.has(named('l2Btn').id));

// level 1
clickObject('l1Btn');
pump(3);
check('Level 1 button starts Level 1', state.sceneId === 4, `sceneId=${state.sceneId}`);
check('level init set lives=3 and retryScene=4',
  state.variables.lives === 3 && state.variables.retryScene === 4,
  JSON.stringify({ lives: state.variables.lives, retryScene: state.variables.retryScene }));
check('pause menu starts hidden', state.hidden.has(named('pausePanel').id));

// pause menu: button -> pause -> menu visible -> resume
clickScreen(703, 34); // pauseBtn: anchor top-right
pump(2);
check('pause button pauses the world', HydraPause.isPaused(state));
check('pause menu shown while paused', !state.hidden.has(named('pausePanel').id) &&
  !state.hidden.has(named('resumeBtn').id));
// resumeBtn: anchor center, posX 0, posY -40, 220x48 -> screen (370,236); centered
clickScreen(480, 260);
pump(2);
check('resume button unpauses', !HydraPause.isPaused(state));
check('pause menu hidden after resume', state.hidden.has(named('pausePanel').id));

// coin collection
const scoreBefore = state.variables.score;
teleportOntoObject('player', 'coin1');
pump(3);
check('coin collected: score increased', state.variables.score === scoreBefore + 1,
  `score=${state.variables.score}`);
check('coin destroyed after collection', state.destroyed.has(named('coin1').id) ||
  !state.objects.some(o => o.name === 'coin1' && !state.destroyed.has(o.id)));

// enemy hit: lose a life, respawn at spawn
teleportOntoObject('player', 'enemy1');
pump(3);
check('enemy hit costs one life', state.variables.lives === 2, `lives=${state.variables.lives}`);
check('player respawned at level spawn', Math.abs(named('player').posX - 80) < 60,
  `posX=${named('player').posX}`);

// goal: unlock + save + advance to level 2
teleportOntoObject('player', 'goal');
pump(3);
check('goal advances to Level 2', state.sceneId === 5, `sceneId=${state.sceneId}`);
check('level 2 unlocked in variables', state.variables.unlockedLevel === 2,
  `unlockedLevel=${state.variables.unlockedLevel}`);
check('progress saved to the HydraQuest slot',
  HydraSave.slotExists(play.sandbox.localStorage, 'HydraQuest'));

// level 2 -> level 3 -> win
teleportOntoObject('player', 'goal');
pump(3);
check('level 2 goal advances to Level 3', state.sceneId === 6, `sceneId=${state.sceneId}`);
teleportOntoObject('player', 'goal');
pump(3);
check('level 3 goal reaches the win screen', state.sceneId === 7, `sceneId=${state.sceneId}`);
check('best score recorded at win', (state.variables.bestScore || 0) > 0,
  `bestScore=${state.variables.bestScore}`);
check('win screen shows the final score', /Final score:/.test(named('finalScoreText')._runtimeText || ''),
  named('finalScoreText')._runtimeText);

// game over path: play again -> level 1 -> force lives to 0 -> game over -> retry
clickObject('againBtn');
pump(3);
check('Play Again returns to Level Select', state.sceneId === 3, `sceneId=${state.sceneId}`);
check('level 2 unlocked on the select screen after progress',
  !state.hidden.has(named('l2Btn').id) && state.hidden.has(named('l2Lock').id));
clickObject('l1Btn');
pump(3);
check('back in Level 1', state.sceneId === 4, `sceneId=${state.sceneId}`);
state.variables.lives = 0;
pump(2);
check('lives=0 goes to Game Over', state.sceneId === 8, `sceneId=${state.sceneId}`);
check('retryScene remembered Level 1', state.variables.retryScene === 4);
clickObject('retryBtn');
pump(3);
check('Retry returns to Level 1', state.sceneId === 4, `sceneId=${state.sceneId}`);
check('retry restores 3 lives', state.variables.lives === 3, `lives=${state.variables.lives}`);

// the strong gate: no unknown blocks, no expression warnings, no crashes anywhere
const diags = state.diagnostics.map(d => d.message);
check('zero runtime diagnostics across the whole playthrough', diags.length === 0,
  diags.slice(0, 5).join(' | '));
check('no console warnings from the exported game', play.warned.length === 0,
  play.warned.slice(0, 3).join(' | '));

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log('flagship.test.js: all checks passed');
