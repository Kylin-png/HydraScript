// Unit tests for hydra/hydra-minimap.js — the shared minimap system
// (P4 Advanced batch 36: minimap, beginner edition).
//
// Pure logic: the per-scene authored config, the per-scene run record,
// the map geometry (corner rect, zoomed world window, world-to-map
// mapping, viewport outline), the dot colors, and the paint. Nothing
// here touches the DOM; both runtimes delegate to this module.
// Static checks at the end pin the wiring: catalog blocks, both
// runtimes' dispatch and the Minimap Visible condition, the draw
// module's map paint, the scene-reset minting (a fresh scene gets its
// own map), and the docs.

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
function near(a, b) { return Math.abs(a - b) < 0.01; }

const sandbox = {};
sandbox.window = sandbox; // hydra-minimap.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-minimap.js'), 'utf8'),
  sandbox, { filename: 'hydra-minimap.js' });
const M = sandbox.HydraMinimap;

check('HydraMinimap exposed with helpers',
  !!M && typeof M.normalizeCorner === 'function' &&
  typeof M.normalizeSize === 'function' &&
  typeof M.normalizeZoom === 'function' &&
  typeof M.normalizeMinimapConfig === 'function' &&
  typeof M.defaultMinimapConfig === 'function' &&
  typeof M.createMinimapState === 'function' &&
  typeof M.isVisible === 'function' &&
  typeof M.setVisible === 'function' &&
  typeof M.setSize === 'function' &&
  typeof M.setZoom === 'function' &&
  typeof M.minimapRect === 'function' &&
  typeof M.worldWindow === 'function' &&
  typeof M.worldToMap === 'function' &&
  typeof M.viewportRect === 'function' &&
  typeof M.tagColor === 'function' &&
  typeof M.dotStyle === 'function' &&
  typeof M.drawMinimap === 'function' &&
  typeof M.isMinimapAction === 'function' &&
  typeof M.isMinimapCondition === 'function');
check('factorySource is a non-empty string',
  typeof M.factorySource === 'string' && M.factorySource.length > 100 &&
  M.factorySource.includes('hydraMinimapFactory'));

// --- normalizers ---
check('normalizeCorner keeps the four corners and defaults anything else to top-right',
  M.normalizeCorner('top-right') === 'top-right' &&
  M.normalizeCorner('top-left') === 'top-left' &&
  M.normalizeCorner('bottom-right') === 'bottom-right' &&
  M.normalizeCorner('bottom-left') === 'bottom-left' &&
  M.normalizeCorner('TOP-LEFT') === 'top-left' &&
  M.normalizeCorner('middle') === 'top-right' &&
  M.normalizeCorner('') === 'top-right' &&
  M.normalizeCorner(null) === 'top-right' &&
  M.normalizeCorner([]) === 'top-right');
check('normalizeSize is a whole 80..400 with a 160 default',
  M.normalizeSize(160) === 160 && M.normalizeSize(80) === 80 &&
  M.normalizeSize(400) === 400 && M.normalizeSize(79) === 80 &&
  M.normalizeSize(401) === 400 && M.normalizeSize(160.7) === 160 &&
  M.normalizeSize('oops') === 160 && M.normalizeSize(null) === 160 &&
  M.normalizeSize([]) === 160);
check('normalizeZoom is 1..4 with a 1 default (below 1 reads as 1)',
  M.normalizeZoom(1) === 1 && M.normalizeZoom(2) === 2 &&
  M.normalizeZoom(4) === 4 && M.normalizeZoom(0.5) === 1 &&
  M.normalizeZoom(5) === 4 && M.normalizeZoom('oops') === 1 &&
  M.normalizeZoom(null) === 1 && M.normalizeZoom([]) === 1);
check('defaultMinimapConfig is off, top-right, 160px, fit, viewport on',
  JSON.stringify(M.defaultMinimapConfig()) ===
    JSON.stringify({ enabled: false, corner: 'top-right', size: 160, zoom: 1, showViewport: true }));
check('normalizeMinimapConfig repairs in place and returns the same record',
  (() => {
    const cfg = { enabled: 'yes', corner: 'nowhere', size: 999, zoom: 0, showViewport: false };
    const out = M.normalizeMinimapConfig(cfg);
    return out === cfg && cfg.enabled === false && cfg.corner === 'top-right' &&
      cfg.size === 400 && cfg.zoom === 1 && cfg.showViewport === false;
  })() &&
  JSON.stringify(M.normalizeMinimapConfig(null)) ===
    JSON.stringify({ enabled: false, corner: 'top-right', size: 160, zoom: 1, showViewport: true }) &&
  JSON.stringify(M.normalizeMinimapConfig({ enabled: true })) ===
    JSON.stringify({ enabled: true, corner: 'top-right', size: 160, zoom: 1, showViewport: true }));

// --- state ---
check('createMinimapState copies the config into a run record',
  JSON.stringify(M.createMinimapState({ enabled: true, corner: 'bottom-left', size: 200, zoom: 2, showViewport: false })) ===
    JSON.stringify({ visible: true, corner: 'bottom-left', size: 200, zoom: 2, showViewport: false }) &&
  JSON.stringify(M.createMinimapState(null)) ===
    JSON.stringify({ visible: false, corner: 'top-right', size: 160, zoom: 1, showViewport: true }));
check('createMinimapState never aliases the authored config',
  (() => {
    const cfg = { enabled: true, corner: 'top-right', size: 160, zoom: 1, showViewport: true };
    const st = M.createMinimapState(cfg);
    st.visible = false;
    st.size = 300;
    return cfg.enabled === true && cfg.size === 160;
  })());
check('isVisible reads the run record, missing reads as hidden',
  M.isVisible({ visible: true }) === true &&
  M.isVisible({ visible: false }) === false &&
  M.isVisible(null) === false &&
  M.isVisible({}) === false);
check('setVisible flips the run record and stays quiet without one',
  (() => {
    const st = M.createMinimapState({ enabled: false });
    return M.setVisible(st, true) === st && st.visible === true &&
      M.setVisible(st, false) === st && st.visible === false;
  })() && M.setVisible(null, true) === null);
check('setSize writes a clamped whole size and refuses a bad one',
  (() => {
    const st = M.createMinimapState(null);
    return M.setSize(st, 200) === true && st.size === 200 &&
      M.setSize(st, 999) === true && st.size === 400 &&
      M.setSize(st, 10) === true && st.size === 80 &&
      M.setSize(st, 'oops') === false && st.size === 80;
  })() && M.setSize(null, 200) === false);
check('setZoom writes a clamped zoom and refuses a bad one',
  (() => {
    const st = M.createMinimapState(null);
    return M.setZoom(st, 2) === true && st.zoom === 2 &&
      M.setZoom(st, 9) === true && st.zoom === 4 &&
      M.setZoom(st, 0) === true && st.zoom === 1 &&
      M.setZoom(st, 'oops') === false && st.zoom === 1;
  })() && M.setZoom(null, 2) === false);

// --- geometry ---
check('minimapRect sits 12px from the picked corner at the configured size',
  JSON.stringify(M.minimapRect(800, 600, 160, 'top-right')) ===
    JSON.stringify({ x: 628, y: 12, size: 160 }) &&
  JSON.stringify(M.minimapRect(800, 600, 160, 'bottom-left')) ===
    JSON.stringify({ x: 12, y: 428, size: 160 }) &&
  JSON.stringify(M.minimapRect(800, 600, 160, 'bottom-right')) ===
    JSON.stringify({ x: 628, y: 428, size: 160 }) &&
  JSON.stringify(M.minimapRect(800, 600, 200, 'top-left')) ===
    JSON.stringify({ x: 12, y: 12, size: 200 }));
check('minimapRect shrinks to fit a tiny view and reads a zero view as no map',
  JSON.stringify(M.minimapRect(100, 100, 160, 'top-right')) ===
    JSON.stringify({ x: 12, y: 12, size: 76 }) &&
  M.minimapRect(0, 600, 160, 'top-right').size === 0 &&
  M.minimapRect('oops', 'oops', 160, 'top-right').size === 0);
check('worldWindow at zoom 1 is the whole scene',
  JSON.stringify(M.worldWindow(800, 600, 0, 0, 800, 600, 1)) ===
    JSON.stringify({ x: 0, y: 0, w: 800, h: 600 }) &&
  JSON.stringify(M.worldWindow(800, 600, 400, 300, 800, 600, 0.5)) ===
    JSON.stringify({ x: 0, y: 0, w: 800, h: 600 }));
check('worldWindow above 1 centers on the camera and clamps to the scene',
  JSON.stringify(M.worldWindow(800, 600, 0, 0, 800, 600, 2)) ===
    JSON.stringify({ x: 200, y: 150, w: 400, h: 300 }) &&
  JSON.stringify(M.worldWindow(800, 600, 400, 0, 800, 600, 2)) ===
    JSON.stringify({ x: 400, y: 150, w: 400, h: 300 }) &&
  JSON.stringify(M.worldWindow(800, 600, 0, 0, 800, 600, 4)) ===
    JSON.stringify({ x: 300, y: 225, w: 200, h: 150 }));
check('worldToMap maps the scene into the rect and clamps past the edges',
  (() => {
    const win = { x: 0, y: 0, w: 800, h: 600 };
    const rect = { x: 628, y: 12, size: 160 };
    const c = M.worldToMap(400, 300, win, rect);
    const tl = M.worldToMap(0, 0, win, rect);
    const br = M.worldToMap(800, 600, win, rect);
    const out = M.worldToMap(-100, 900, win, rect);
    const zero = M.worldToMap(400, 300, { x: 0, y: 0, w: 0, h: 0 }, rect);
    return near(c.x, 708) && near(c.y, 92) &&
      near(tl.x, 628) && near(tl.y, 12) &&
      near(br.x, 788) && near(br.y, 172) &&
      near(out.x, 628) && near(out.y, 172) &&
      near(zero.x, 628) && near(zero.y, 12);
  })());
check('viewportRect maps the camera view into the map and clamps to it',
  (() => {
    const win = { x: 0, y: 0, w: 800, h: 600 };
    const rect = { x: 628, y: 12, size: 160 };
    const whole = M.viewportRect(win, rect, 0, 0, 800, 600);
    const half = M.viewportRect({ x: 200, y: 150, w: 400, h: 300 }, rect, 200, 150, 200, 150);
    return JSON.stringify(whole) === JSON.stringify({ x: 628, y: 12, w: 160, h: 160 }) &&
      JSON.stringify(half) === JSON.stringify({ x: 628, y: 12, w: 80, h: 80 });
  })());

// --- dots ---
check('tagColor is deterministic per tag, case-insensitive, gray when blank',
  M.tagColor('goblin') === 'hsl(168, 70%, 55%)' &&
  M.tagColor('Goblin') === 'hsl(168, 70%, 55%)' &&
  M.tagColor('coin') === 'hsl(142, 70%, 55%)' &&
  M.tagColor('goblin') !== M.tagColor('coin') &&
  M.tagColor('') === '#9ca3af' &&
  M.tagColor(null) === '#9ca3af' &&
  M.tagColor([]) === '#9ca3af');
check('dotStyle ranks boss over player over tag over untagged',
  JSON.stringify(M.dotStyle({ name: 'goblinKing', tags: [] }, 'goblinKing')) ===
    JSON.stringify({ size: 5, color: '#ef4444' }) &&
  JSON.stringify(M.dotStyle({ name: 'hero', tags: ['player'] }, '')) ===
    JSON.stringify({ size: 5, color: '#ffffff' }) &&
  JSON.stringify(M.dotStyle({ name: 'hero', tags: ['Player'] }, '')) ===
    JSON.stringify({ size: 5, color: '#ffffff' }) &&
  JSON.stringify(M.dotStyle({ name: 'goblin', tags: ['goblin'] }, '')) ===
    JSON.stringify({ size: 3, color: 'hsl(168, 70%, 55%)' }) &&
  JSON.stringify(M.dotStyle({ name: 'coin' }, '')) ===
    JSON.stringify({ size: 2, color: '#9ca3af' }) &&
  JSON.stringify(M.dotStyle({ name: 'king', tags: ['player'] }, 'king')) ===
    JSON.stringify({ size: 5, color: '#ef4444' }) &&
  JSON.stringify(M.dotStyle(null, '')) ===
    JSON.stringify({ size: 2, color: '#9ca3af' }));

// --- map paint (recording context) ---
function makeRecordingCtx() {
  const calls = [];
  return {
    calls: calls,
    save() { calls.push(['save']); },
    restore() { calls.push(['restore']); },
    fillRect(x, y, w, h) { calls.push(['fillRect', x, y, w, h, this.fillStyle]); },
    strokeRect(x, y, w, h) { calls.push(['strokeRect', x, y, w, h, this.strokeStyle]); },
    fillStyle: '', strokeStyle: '', lineWidth: 1
  };
}
function mapObjects() {
  return [
    { name: 'hero', posX: 100, posY: 100, width: 40, height: 40, tags: ['player'] },
    { name: 'goblin', posX: 500, posY: 100, width: 60, height: 60, tags: ['goblin'] },
    { name: 'coin', posX: 400, posY: 300, width: 20, height: 20, tags: [] },
    { name: 'goblinKing', posX: 600, posY: 400, width: 60, height: 60, tags: ['boss'] },
    { name: 'ghost', posX: NaN, posY: 100, width: 20, height: 20, tags: [] }
  ];
}
{
  const ctx = makeRecordingCtx();
  const st = M.createMinimapState({ enabled: true, corner: 'top-right', size: 160, zoom: 1, showViewport: true });
  const drawn = M.drawMinimap(ctx, {
    state: st, worldW: 800, worldH: 600,
    camX: 0, camY: 0, viewW: 800, viewH: 600,
    viewPxW: 800, viewPxH: 600, objects: mapObjects(), bossName: 'goblinKing'
  });
  const fill = (x, y, w, h, style) => ctx.calls.some(c =>
    c[0] === 'fillRect' && near(c[1], x) && near(c[2], y) && near(c[3], w) && near(c[4], h) && c[5] === style);
  const stroke = (x, y, w, h, style) => ctx.calls.some(c =>
    c[0] === 'strokeRect' && near(c[1], x) && near(c[2], y) && near(c[3], w) && near(c[4], h) && c[5] === style);
  check('drawMinimap paints the panel, the four dots, the viewport outline, and the border',
    drawn === true &&
    fill(628, 12, 160, 160, 'rgba(0,0,0,0.55)') &&
    fill(649.5, 41.5, 5, 5, '#ffffff') &&
    fill(732.5, 45.17, 3, 3, 'hsl(168, 70%, 55%)') &&
    fill(709, 93.67, 2, 2, '#9ca3af') &&
    fill(751.5, 124.17, 5, 5, '#ef4444') &&
    stroke(628.5, 12.5, 159, 159, '#ffffff') &&
    stroke(628.5, 12.5, 159, 159, 'rgba(255,255,255,0.35)') &&
    !ctx.calls.some(c => c.some(v => typeof v === 'number' && !isFinite(v))));
  const zoomed = makeRecordingCtx();
  const zst = M.createMinimapState({ enabled: true, corner: 'top-right', size: 160, zoom: 2, showViewport: true });
  const zDrawn = M.drawMinimap(zoomed, {
    state: zst, worldW: 800, worldH: 600,
    camX: 400, camY: 0, viewW: 800, viewH: 600,
    viewPxW: 800, viewPxH: 600, objects: mapObjects(), bossName: ''
  });
  check('a zoomed map clamps off-window dots to the map edge',
    zDrawn === true &&
    zoomed.calls.some(c => c[0] === 'fillRect' && near(c[1], 625.5) && near(c[2], 9.5) &&
      near(c[3], 5) && near(c[4], 5) && c[5] === '#ffffff'));
  const noViewport = makeRecordingCtx();
  const nvst = M.createMinimapState({ enabled: true, corner: 'top-right', size: 160, zoom: 1, showViewport: false });
  M.drawMinimap(noViewport, {
    state: nvst, worldW: 800, worldH: 600,
    camX: 0, camY: 0, viewW: 800, viewH: 600,
    viewPxW: 800, viewPxH: 600, objects: mapObjects(), bossName: ''
  });
  check('showViewport off skips the white outline but keeps the border',
    !noViewport.calls.some(c => c[0] === 'strokeRect' && c[5] === '#ffffff') &&
    noViewport.calls.some(c => c[0] === 'strokeRect' && c[5] === 'rgba(255,255,255,0.35)'));
}
check('drawMinimap stays quiet when hidden, too small, or undrawable',
  M.drawMinimap(makeRecordingCtx(), {
    state: M.createMinimapState(null), worldW: 800, worldH: 600,
    camX: 0, camY: 0, viewW: 800, viewH: 600,
    viewPxW: 800, viewPxH: 600, objects: [], bossName: ''
  }) === false &&
  M.drawMinimap(makeRecordingCtx(), {
    state: M.createMinimapState({ enabled: true }), worldW: 800, worldH: 600,
    camX: 0, camY: 0, viewW: 800, viewH: 600,
    viewPxW: 30, viewPxH: 30, objects: [], bossName: ''
  }) === false &&
  M.drawMinimap(makeRecordingCtx(), {
    state: M.createMinimapState({ enabled: true }), worldW: 0, worldH: 0,
    camX: 0, camY: 0, viewW: 800, viewH: 600,
    viewPxW: 800, viewPxH: 600, objects: [], bossName: ''
  }) === false &&
  M.drawMinimap(null, {
    state: M.createMinimapState({ enabled: true }), worldW: 800, worldH: 600,
    camX: 0, camY: 0, viewW: 800, viewH: 600,
    viewPxW: 800, viewPxH: 600, objects: [], bossName: ''
  }) === false &&
  M.drawMinimap({}, {
    state: M.createMinimapState({ enabled: true }), worldW: 800, worldH: 600,
    camX: 0, camY: 0, viewW: 800, viewH: 600,
    viewPxW: 800, viewPxH: 600, objects: [], bossName: ''
  }) === false);

// --- routing ---
check('routing sets cover the four minimap actions and the one condition',
  M.isMinimapAction('showMinimap') && M.isMinimapAction('hideMinimap') &&
  M.isMinimapAction('setMinimapSize') && M.isMinimapAction('setMinimapZoom') &&
  !M.isMinimapAction('showBossBar') && !M.isMinimapAction('setCameraZoom') &&
  !M.isMinimapAction(null) &&
  M.isMinimapCondition('minimapVisible') &&
  !M.isMinimapCondition('bossActive') && !M.isMinimapCondition('minimap') &&
  !M.isMinimapCondition(null));

// --- hostile input ---
check('hostile input degrades to safe defaults',
  M.normalizeCorner([]) === 'top-right' &&
  M.normalizeSize([]) === 160 &&
  M.normalizeZoom([]) === 1 &&
  M.tagColor([]) === '#9ca3af' &&
  M.dotStyle([], '') !== null &&
  JSON.stringify(M.worldWindow('oops', 'oops', 0, 0, 800, 600, 2)) ===
    JSON.stringify({ x: 0, y: 0, w: 0, h: 0 }) &&
  M.minimapRect('oops', 'oops', 160, 'top-right').size === 0 &&
  JSON.stringify(M.createMinimapState('oops')) ===
    JSON.stringify({ visible: false, corner: 'top-right', size: 160, zoom: 1, showViewport: true }));

// --- static wiring ---
{
  const html = fs.readFileSync(path.join(HYDRA, 'index.html'), 'utf8');
  const mmTag = html.indexOf('src="hydra-minimap.js');
  check('index.html loads hydra-minimap.js before player-runtime.js and script.js',
    mmTag !== -1 && mmTag < html.indexOf('src="player-runtime.js') && mmTag < html.indexOf('src="script.js'));
  check('index.html loads hydra-minimap.js after hydra-tags.js',
    mmTag > html.indexOf('src="hydra-tags.js'));
  check('index.html carries the Scene Settings Minimap fields',
    html.includes('id="scene-minimap-wrap"') &&
    html.includes('id="scene-minimap-enabled"') &&
    html.includes('id="scene-minimap-corner"') &&
    html.includes('id="scene-minimap-size"') &&
    html.includes('id="scene-minimap-zoom"') &&
    html.includes('id="scene-minimap-viewport"'));
  const playerJs = fs.readFileSync(path.join(HYDRA, 'player-runtime.js'), 'utf8');
  check('player-runtime.js hard-guards on HydraMinimap',
    playerJs.includes("if (!HydraMinimap || typeof HydraMinimap.createMinimapState !== 'function')") &&
    playerJs.includes('HydraScript player runtime requires hydra-minimap.js'));
  check('player-runtime.js inlines HydraMinimap into exports',
    playerJs.includes("'HydraMinimap', global.HydraMinimap && global.HydraMinimap.factorySource"));
  check('player-runtime.js classifies minimap blocks for the dispatch',
    playerJs.includes('HydraMinimap.isMinimapAction(type)') &&
    playerJs.includes('HydraMinimap.isMinimapCondition(type)'));
  check('player-runtime.js mints the minimap state at boot and exposes the module to both contexts',
    playerJs.includes('minimap: HydraMinimap.createMinimapState(null)') &&
    playerJs.includes('minimapModule: HydraMinimap') &&
    playerJs.includes('minimap: state.minimap'));
  check('player-runtime.js mints the minimap per scene load and passes it to the draw hooks',
    playerJs.includes('minimapOf: (sc) => HydraMinimap.createMinimapState(sc ? sc.minimap : null)') &&
    playerJs.includes('minimap: HydraMinimap,') &&
    playerJs.includes('minimapState: state.minimap,'));
  const previewJs = fs.readFileSync(path.join(HYDRA, 'hydra-previewruntime.js'), 'utf8');
  check('preview runtime exposes the module to both contexts',
    previewJs.includes("minimapModule: mod('Minimap')") &&
    previewJs.includes('minimap: minimapState()'));
  check('preview runtime mints the minimap per scene load and resets it on a fresh run',
    previewJs.includes('function minimapState()') &&
    previewJs.includes('function resetMinimapRuntime()') &&
    previewJs.includes('resetMinimapRuntime();') &&
    previewJs.includes('minimapOf: function (scene)') &&
    previewJs.includes('M.createMinimapState'));
  const scriptJs = fs.readFileSync(path.join(HYDRA, 'script.js'), 'utf8');
  check('editor draw hooks pass the minimap module and the live run record',
    scriptJs.includes('minimap: window.HydraMinimap || null,') &&
    scriptJs.includes('minimapState:') &&
    scriptJs.includes('minimapState()'));
  check('editor wires the Scene Settings Minimap fields',
    scriptJs.includes('syncSceneMinimapFields') &&
    scriptJs.includes('onSceneMinimapInput') &&
    scriptJs.includes('scene-minimap-enabled') &&
    scriptJs.includes('scene-minimap-corner') &&
    scriptJs.includes('scene-minimap-size') &&
    scriptJs.includes('scene-minimap-zoom') &&
    scriptJs.includes('scene-minimap-viewport'));
  const stageJs = fs.readFileSync(path.join(HYDRA, 'hydra-stage.js'), 'utf8');
  check('stage module syncs and writes the Scene Settings Minimap fields',
    stageJs.includes('syncSceneMinimapFields: syncSceneMinimapFields') &&
    stageJs.includes('onSceneMinimapInput: onSceneMinimapInput') &&
    stageJs.includes('resolveHydraMinimap'));
  const executeJs = fs.readFileSync(path.join(HYDRA, 'hydra-execute.js'), 'utf8');
  check('shared execute module runs the four minimap actions',
    executeJs.includes("if (isType(ctx.minimapModule, 'isMinimapAction', type))") &&
    executeJs.includes("type === 'showMinimap'") &&
    executeJs.includes("type === 'hideMinimap'") &&
    executeJs.includes("type === 'setMinimapSize'") &&
    executeJs.includes("type === 'setMinimapZoom'") &&
    executeJs.includes('MM.setVisible(ctx.minimap, true)') &&
    executeJs.includes('MM.setVisible(ctx.minimap, false)') &&
    executeJs.includes('MM.setSize(ctx.minimap, smsSize.value)') &&
    executeJs.includes('MM.setZoom(ctx.minimap, smzZoom.value)'));
  const condJs = fs.readFileSync(path.join(HYDRA, 'hydra-conditions.js'), 'utf8');
  check('shared conditions module evaluates the Minimap Visible condition',
    condJs.includes("case 'minimapVisible':") &&
    condJs.includes('MVm.isVisible(ctx.minimap)'));
  const flowJs = fs.readFileSync(path.join(HYDRA, 'hydra-flow.js'), 'utf8');
  check('flow module defaults Minimap Visible to the level trigger',
    flowJs.includes("t === 'minimapVisible'"));
  const drawJs = fs.readFileSync(path.join(HYDRA, 'hydra-draw.js'), 'utf8');
  check('shared draw module paints the minimap above the HUD when the map shows',
    drawJs.includes('mmMod.drawMinimap(ctx, {') &&
    drawJs.includes('mmState && mmMod.isVisible(mmState)') &&
    drawJs.includes('bossName: mmBossName'));
  const resetSb = {};
  resetSb.window = resetSb;
  vm.createContext(resetSb);
  vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-scenereset.js'), 'utf8'),
    resetSb, { filename: 'hydra-scenereset.js' });
  const SR = resetSb.HydraSceneReset;
  check('scene reset mints a fresh minimap per scene (no leak from the last scene)',
    (() => {
      const hooks = { minimapOf: (sc) => M.createMinimapState(sc ? sc.minimap : null) };
      const state = {};
      const ok1 = SR.resetSceneRuntime(state, { id: 1, minimap: { enabled: true, size: 200 } }, hooks);
      const first = state.minimap;
      const ok2 = SR.resetSceneRuntime(state, { id: 2, minimap: { enabled: false } }, hooks);
      return ok1 === true && ok2 === true &&
        first.visible === true && first.size === 200 &&
        state.minimap !== first && state.minimap.visible === false &&
        state.minimap.size === 160;
    })());
  check('scene reset reads no map when the minimap hook is missing',
    (() => {
      const state = {};
      const ok = SR.resetSceneRuntime(state, { id: 1 }, {});
      return ok === true && state.minimap === null;
    })());
  const universalJs = fs.readFileSync(path.join(HYDRA, 'hydra-universal.js'), 'utf8');
  check('universal normalizer defaults the scene minimap config',
    universalJs.includes('normalizeMinimapConfig') &&
    universalJs.includes('scene.minimap'));
  const catalogJs = fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8');
  check('catalog carries the five minimap blocks in the Minimap category',
    catalogJs.includes("blockType: 'show-minimap'") &&
    catalogJs.includes("runtimeType: 'showMinimap'") &&
    catalogJs.includes("blockType: 'hide-minimap'") &&
    catalogJs.includes("runtimeType: 'hideMinimap'") &&
    catalogJs.includes("blockType: 'set-minimap-size'") &&
    catalogJs.includes("runtimeType: 'setMinimapSize'") &&
    catalogJs.includes("blockType: 'set-minimap-zoom'") &&
    catalogJs.includes("runtimeType: 'setMinimapZoom'") &&
    catalogJs.includes("blockType: 'minimap-visible'") &&
    catalogJs.includes("runtimeType: 'minimapVisible'") &&
    catalogJs.includes("key: 'size', label: 'Size (px)'") &&
    catalogJs.includes("key: 'zoom', label: 'Zoom'"));
  const refMd = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');
  check('block reference documents all five minimap blocks',
    refMd.includes('Show Minimap') && refMd.includes('Hide Minimap') &&
    refMd.includes('Set Minimap Size') && refMd.includes('Set Minimap Zoom') &&
    refMd.includes('Minimap Visible') &&
    refMd.includes('### Minimap (5)'));
  const guideMd = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');
  check('user guide covers the minimap',
    guideMd.includes('Minimap') && guideMd.includes('Show Minimap') &&
    guideMd.includes('Minimap Visible'));
}

if (failures > 0) { console.log(`FAILURES: ${failures}`); process.exit(1); }
console.log('minimap.test.js: all checks passed');
