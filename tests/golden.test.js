// Preview-vs-export golden behavior test (P5-7 core unification).
//
// One project, run through BOTH runtimes with the same inputs, and the
// observable outputs must agree exactly: same flat variables, same
// diagnostics (none). The grid is built to catch the exact ways the
// two runtimes used to diverge:
//   - fan-out order: `always` at 0 feeds setVariable right (fanOrder=1),
//     setVariable below (fanOrder=2), and a chained setVariable further
//     right (chainScore=3). Reading order (right, down, left, up) runs
//     the right action first and the below action second, so fanOrder
//     ends at 2 in both runtimes. The preview's old up/down/left/right
//     order ended at 1.
//   - gameStart chain: gameStart at 120 sets startScore=5 once.
//   - the row-60 fix: `always` at row 61 (index 3660) feeds the action
//     directly below it (index 3720, tallScore=7). Both runtimes used
//     to cap rows at 60 and lose that link, so the action never ran.
//
// The export side boots the real HydraPlayer.start in a stubbed-DOM vm
// (the export-boot Phase C shape) and also asserts the built export
// inlines the canonical HydraFlow module. The preview side drives the
// real HydraPreviewRuntime with real shared modules through a stub
// editor host (the previewruntime.test.js fixture shape, trimmed to
// the dispatch path).

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HYDRA = path.join(__dirname, '..', 'hydra');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') {
    const out = {};
    Object.keys(value).sort().forEach(k => { out[k] = sorted(value[k]); });
    return out;
  }
  return value;
}
function eq(name, actual, expected) {
  check(name, JSON.stringify(sorted(actual)) === JSON.stringify(sorted(expected)),
    `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

// ---------- the golden project (shared by both runtimes) ----------
const GOLDEN_GRID = {
  0: { type: 'always', kind: 'condition' },
  1: { type: 'setVariable', kind: 'action', varName: 'fanOrder', operation: 'set', value: '1' },
  2: { type: 'setVariable', kind: 'action', varName: 'chainScore', operation: 'set', value: '3' },
  60: { type: 'setVariable', kind: 'action', varName: 'fanOrder', operation: 'set', value: '2' },
  120: { type: 'gameStart', kind: 'condition' },
  121: { type: 'setVariable', kind: 'action', varName: 'startScore', operation: 'set', value: '5' },
  3660: { type: 'always', kind: 'condition' },
  3720: { type: 'setVariable', kind: 'action', varName: 'tallScore', operation: 'set', value: '7' }
};
const GOLDEN_PROJECT = {
  id: 'golden-1',
  name: 'Golden',
  eventsVersion: 1,
  globalGridData: GOLDEN_GRID,
  scenes: [{
    id: 1,
    name: 'Scene 1',
    objects: [
      { id: 1, name: 'hero', kind: 'sprite', posX: 10, posY: 20, width: 40, height: 40, color: '#ff0000' }
    ],
    gridData: {},
    worldWidth: 800, worldHeight: 600,
    viewportWidth: 800, viewportHeight: 600,
    bgColor: '#ffffff'
  }],
  currentSceneId: 1,
  assets: {}
};
const EXPECTED_VARS = { fanOrder: 2, chainScore: 3, startScore: 5, tallScore: 7 };

// ---------- export side ----------
// The module load list is the export-boot Phase C order; player-runtime
// loads last because it hard-guards on every shared module at install.
const MODULE_FILES = [
  'hydra-expr.js', 'hydra-input.js', 'hydra-audio.js', 'hydra-anim.js',
  'hydra-tween.js', 'hydra-ui.js', 'hydra-save.js', 'hydra-pause.js',
  'hydra-camerafx.js', 'hydra-sceneinit.js', 'hydra-frame.js',
  'hydra-physicsstep.js', 'hydra-scenereset.js', 'hydra-draw.js',
  'hydra-dispatch.js', 'hydra-conditions.js', 'hydra-execute.js',
  'hydra-particles.js', 'hydra-actions.js', 'hydra-tiles.js',
  'hydra-physics2d.js', 'hydra-buses.js', 'hydra-flow.js',
  'hydra-collections.js', 'hydra-math.js', 'hydra-pick.js',
  'hydra-layerfx.js', 'hydra-3d.js', 'hydra-profile.js',
  'hydra-scriptapi.js', 'hydra-statemachine.js', 'hydra-blendspace.js',
  'hydra-light2d.js', 'hydra-joints.js', 'hydra-skeleton.js',
  'hydra-localization.js', 'hydra-dialogue.js', 'hydra-inventory.js',
  'hydra-quest.js', 'hydra-achievement.js', 'hydra-cutscene.js',
  'hydra-highscore.js', 'hydra-timescale.js', 'hydra-transition.js',
  'hydra-camerafeel.js', 'hydra-parallax.js', 'hydra-spatialaudio.js',
  'hydra-pathfind.js', 'hydra-ai.js', 'hydra-joystick.js',
  'hydra-health.js', 'hydra-damagefx.js', 'hydra-respawn.js',
  'hydra-spawn.js', 'hydra-lives.js', 'hydra-movement.js',
  'hydra-platform.js', 'hydra-combat.js', 'hydra-xp.js', 'hydra-growth.js',
  'hydra-scaling.js', 'hydra-boss.js', 'hydra-tags.js', 'hydra-minimap.js', 'hydra-attach.js', 'hydra-variables.js', 'hydra-functions.js',
  'hydra-loops.js', 'hydra-events.js', 'hydra-trace.js', 'hydra-gltf.js',
  'player-runtime.js'
];

function makeCtx() {
  return new Proxy({}, {
    get(t, p) {
      if (p === Symbol.toPrimitive) return () => 0;
      return () => undefined;
    },
    set() { return true; }
  });
}
function makeBrowserStubs() {
  const rafCallbacks = [];
  const warned = [];
  const canvasListeners = {};
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
    console: Object.assign(Object.create(console), {
      warn: (...a) => { warned.push(a.join(' ')); }
    }),
    document,
    canvas,
    hud,
    canvasListeners,
    warned,
    addEventListener() {},
    requestAnimationFrame: (cb) => { rafCallbacks.push(cb); return rafCallbacks.length; },
    setTimeout: () => 0,
    clearTimeout: () => {}
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return { sandbox, rafCallbacks, canvas, hud, canvasListeners, warned, documentElement };
}
function loadRuntime(env) {
  for (const file of MODULE_FILES) {
    vm.runInContext(fs.readFileSync(path.join(HYDRA, file), 'utf8'), env.sandbox, { filename: file });
  }
}

let exportVars = null;
let exportDiagnostics = null;
{
  // The built export must inline the canonical flow module (P5-7 part 3).
  const ed = makeBrowserStubs();
  loadRuntime(ed);
  check('HydraPlayer available in editor env', !!ed.sandbox.window.HydraPlayer);
  const html = ed.sandbox.window.HydraPlayer.buildPlayableHtml(GOLDEN_PROJECT);
  check('export produced non-empty HTML', typeof html === 'string' && html.length > 10000,
    `length=${html && html.length}`);
  check('export inlines the canonical flow module (no row cap)',
    html.includes('window.HydraFlow=(function hydraFlowFactory'));
  check('export does not inline a second flow copy',
    (html.match(/function adjacentIndexes/g) || []).length === 1,
    `adjacentIndexes definitions=${(html.match(/function adjacentIndexes/g) || []).length}`);

  const play = makeBrowserStubs();
  loadRuntime(play);
  const state = play.sandbox.window.HydraPlayer.start(GOLDEN_PROJECT, { canvas: play.canvas });
  check('export start() returns state', !!state && Array.isArray(state.objects));
  let t = 0;
  for (let frame = 0; frame < 3; frame++) {
    t += 16.67;
    const cbs = play.rafCallbacks.splice(0, play.rafCallbacks.length);
    cbs.forEach(cb => cb(t));
  }
  exportVars = state.variables;
  exportDiagnostics = (state.diagnostics || []).map(d => d.message);
  eq('export runs the golden grid (fan-out order, chain, gameStart, tall grid)',
    exportVars, EXPECTED_VARS);
  eq('export runs the golden grid with zero diagnostics', exportDiagnostics, []);
}

// ---------- preview side ----------
// The shared modules load in a vm sandbox (the browser shape), not via
// require: several hydra-*.js files touch `window` at load time and are
// not node-safe as CommonJS modules. The preview runtime itself IS
// node-safe and loads via require.
const previewFactory = require(path.join(HYDRA, 'hydra-previewruntime.js'));
function loadPreviewModules() {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const names = ['flow', 'dispatch', 'conditions', 'execute', 'trace',
    'loops', 'variables', 'events', 'collections', 'math', 'pick',
    'expr', 'input', 'pause'];
  for (const name of names) {
    const file = 'hydra-' + name + '.js';
    vm.runInContext(fs.readFileSync(path.join(HYDRA, file), 'utf8'), sandbox, { filename: file });
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const modules = {};
  for (const name of names) modules[cap(name)] = sandbox['Hydra' + cap(name)];
  return modules;
}
const previewModules = loadPreviewModules();

let previewVars = null;
let previewDiagnostics = null;
{
  const T = previewFactory();
  const vars = {};
  const diagnostics = [];
  const grids = { global: JSON.parse(JSON.stringify(GOLDEN_GRID)) };
  const run = {
    sceneId: 1, pendingSceneId: null, objects: [], executionContext: null,
    conditionContexts: {}, flowTriggerStates: {},
    camera: { x: 0, y: 0, zoom: 1, followTarget: '' },
    cameraShake: { strength: 0, timeLeft: 0 },
    flash: { color: '#ffffff', intensity: 0, timeLeft: 0, maxTime: 0 },
    mouse: { x: 10, y: 20 }, dt: 1, frameId: 0,
    buses: null, busVoices: null, actions: null, particles: null,
    profiler: null, language: 'en', masterVolume: 1, musicPaused: false,
    trace: { events: [] }, _triggerEntered: [], _triggerExited: [],
    camera3d: null, camera3dFollow: null, paused: false
  };
  const started = new Set(), once = new Set();
  const timers = new Map(), shakeCooldowns = new Map();
  const sceneStack = [];
  const hidden = new Set(), destroyed = new Set(), pending = new Set();
  const scenes = [{ id: 1, name: 'Scene 1', objects: [] }];
  const input = T.createInputState();
  const host = {
    getRunState: () => run,
    getStartedScopes: () => started,
    getOnce: () => once,
    getTimers: () => timers,
    getShakeCooldowns: () => shakeCooldowns,
    getSceneStack: () => sceneStack,
    getVariables: () => vars,
    getHidden: () => hidden,
    getDestroyed: () => destroyed,
    getPendingDestroy: () => pending,
    getInputState: () => input,
    getScenes: () => scenes,
    getCurrentSceneId: () => 1,
    getCanvas: () => ({ width: 800, height: 600, getContext: () => null, style: {} }),
    getCells: () => [],
    getActiveScriptScope: () => 'global',
    getAssetLibrary: () => ({}),
    getObjectsByName: (name, list) => (list || []).filter(o => o && o.name === name),
    getHitbox: (o) => ({ x: o.posX || 0, y: o.posY || 0, width: o.width || 0, height: o.height || 0 }),
    getPhysics: (o) => (o && o.physics) || {},
    isCollisionObject: (o) => !!o && o.kind !== 'tilemap' && o.collidable !== false,
    evalExpr: (s) => {
      if (typeof s === 'number') return s;
      const n = Number(s);
      if (Number.isFinite(n)) return n;
      if (typeof s === 'string' && s.trim() in vars) return vars[s.trim()];
      return 0;
    },
    evalExprInfo: (s) => {
      if (typeof s === 'number') return { value: s, ok: true, unknowns: [] };
      const n = Number(s);
      if (Number.isFinite(n)) return { value: n, ok: true, unknowns: [] };
      if (typeof s === 'string' && s.trim() in vars) return { value: vars[s.trim()], ok: true, unknowns: [] };
      return { value: 0, ok: true, unknowns: [] };
    },
    getPreviewScene: () => scenes[0],
    getSceneWorldWidth: () => 800, getSceneWorldHeight: () => 600,
    getSceneViewportWidth: () => 800, getSceneViewportHeight: () => 600,
    clampCameraToScene: () => {},
    updateCameraFollow: () => {},
    normalizeCameraZoom: (v) => {
      const z = Number(v);
      return Number.isFinite(z) ? Math.min(4, Math.max(0.25, z)) : 1;
    },
    getPreviewLanguage: () => run.language || 'en',
    getPreviewLocalization: () => null,
    applyPreviewBoundTexts: () => {},
    ensurePreviewParticleState: () => run.particles || (run.particles = { list: [] }),
    getPreviewBuses: () => ({
      sfx: { volume: 1, muted: false }, music: { volume: 1, muted: false }, ui: { volume: 1, muted: false }
    }),
    playSound: () => {},
    stopPreviewMusic: () => {},
    pausePreviewMusic: () => {},
    resumePreviewMusic: () => {},
    stopAllPreviewSounds: () => {},
    getGridDataForScope: (scope) => grids[scope] || {},
    getScopeKey: (scope) => (scope === 'global' ? 'global' : 'scene:' + scope),
    sameScriptScope: (a, b) => a === b,
    isCondition: (t) => ['always', 'gameStart'].includes(t),
    isAction: (t) => ['setVariable'].includes(t),
    isComment: (t) => t === 'comment',
    pushDiagnostic: (level, msg) => { diagnostics.push([level, msg]); },
    sceneInitHooks: () => ({ sceneInit: true }),
    renderTraceFeed: () => {},
    switchPreviewScene: () => {},
    getCurrentScene: () => scenes[0],
    getProjectInputActions: () => [],
    getProjectMasterVolume: () => 1,
    resizeGameCanvas: () => {},
    resetTraceRender: () => {},
    clearRuntimeDiagnostics: () => {},
    getSoundCooldowns: () => new Map(),
    drawGame: () => {},
    commitActiveGrid: () => {}
  };
  const modules = Object.assign({}, previewModules);
  T.configure({ host, getModule: (name) => modules[name] || null });
  T.processGameStartConditions('global');
  for (let frame = 0; frame < 3; frame++) {
    run.frameId++;
    T.processScriptGrid('global');
  }
  previewVars = vars;
  previewDiagnostics = diagnostics.map(d => d[1]);
  eq('preview runs the golden grid (fan-out order, chain, gameStart, tall grid)',
    previewVars, EXPECTED_VARS);
  eq('preview runs the golden grid with zero diagnostics', previewDiagnostics, []);
}

// ---------- the golden comparison ----------
eq('preview and export agree exactly on the golden grid',
  previewVars, exportVars);
eq('preview and export agree on diagnostics (both empty)',
  previewDiagnostics, exportDiagnostics);
check('preview and export agree on the tall-grid value (row-60 fix)',
  previewVars && previewVars.tallScore === 7 && exportVars && exportVars.tallScore === 7,
  `preview=${previewVars && previewVars.tallScore} export=${exportVars && exportVars.tallScore}`);

console.log(failures === 0 ? 'golden.test.js: all checks passed' : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
