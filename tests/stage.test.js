// Unit tests for hydra/hydra-stage.js — the scene stage (P2 item 14,
// slice 4: scene dimensions, snap/zoom geometry, camera frame, scene
// background/size, and the in-editor 3D viewport with its Scene
// Settings camera / shadow / darkness field sync, as a DOM module).
//
// The pure geometry takes explicit arguments and needs no document;
// the DOM functions take the document explicitly (falling back to the
// global one), so the node tests drive them through a vm sandbox with
// a small fake DOM (fake document with an id registry + fake elements
// with style/classList/children, querySelector for .class/#id, a
// canvas getContext stub, and getBoundingClientRect).
// script.js delegates to this module; the 3D-view flag that used to
// be its `sceneEditor3dView` let now lives in the module.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}
function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected),
    `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

const MODULE_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'hydra', 'hydra-stage.js'), 'utf8');
const SCRIPT_JS = fs.readFileSync(
  path.join(__dirname, '..', 'hydra', 'script.js'), 'utf8');
const INDEX_HTML = fs.readFileSync(
  path.join(__dirname, '..', 'hydra', 'index.html'), 'utf8');
const factory = require(path.join(__dirname, '..', 'hydra', 'hydra-stage.js'));

// --- fake DOM ---------------------------------------------------------
function makeCtx() {
  return {
    calls: [],
    fillStyle: '',
    drawImage() { this.calls.push(['drawImage', ...arguments]); },
    fillRect() { this.calls.push(['fillRect', ...arguments]); }
  };
}

function makeFakeElement(tag) {
  const el = {
    tagName: tag.toUpperCase(),
    children: [],
    parentNode: null,
    className: '',
    id: '',
    value: '',
    textContent: '',
    type: '',
    checked: false,
    width: 0,
    height: 0,
    style: {},
    _listeners: {},
    _classSet: new Set(),
    _rect: { left: 0, top: 0, width: 0, height: 0 },
    _ctx: null,
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i >= 0) this.children.splice(i, 1);
      return child;
    },
    addEventListener(type, fn) {
      (this._listeners[type] = this._listeners[type] || []).push(fn);
    },
    fire(type, event) {
      (this._listeners[type] || []).forEach(fn => fn(event || { target: this }));
    },
    querySelector(sel) {
      const match = (c) => {
        if (sel.startsWith('.')) return c.className.split(' ').includes(sel.slice(1));
        if (sel.startsWith('#')) return c.id === sel.slice(1);
        return false;
      };
      const walk = (node) => {
        for (const c of node.children) {
          if (match(c)) return c;
          const found = walk(c);
          if (found) return found;
        }
        return null;
      };
      return walk(this);
    },
    getContext(kind) {
      if (kind !== '2d') return null;
      if (!this._ctx) this._ctx = makeCtx();
      return this._ctx;
    },
    getBoundingClientRect() { return this._rect; }
  };
  el.classList = {
    add(c) { el._classSet.add(c); el.className = [...el._classSet].join(' '); },
    remove(c) { el._classSet.delete(c); el.className = [...el._classSet].join(' '); },
    toggle(c, force) {
      if (force === undefined) force = !el._classSet.has(c);
      if (force) el._classSet.add(c); else el._classSet.delete(c);
      el.className = [...el._classSet].join(' ');
      return force;
    },
    contains(c) { return el._classSet.has(c); }
  };
  return el;
}

function makeFakeDocument(byId) {
  return {
    _byId: byId || {},
    createElement(tag) { return makeFakeElement(tag); },
    getElementById(id) { return this._byId[id] || null; },
    register(id, el) { this._byId[id] = el; }
  };
}

// A stage document: #scene-canvas plus the toolbar / settings fields
// the 3D viewport and field sync touch.
function makeStageDoc() {
  const doc = makeFakeDocument({});
  const stage = makeFakeElement('div');
  stage.id = 'scene-canvas';
  doc.register('scene-canvas', stage);
  ['scene-3d-view-toggle', 'scene-3d-view-divider', 'scene-3d-camera-wrap',
   'scene-view-layout-btn', 'scene-view-3d-btn',
   'scene-cam3d-x', 'scene-cam3d-y', 'scene-cam3d-z',
   'scene-cam3d-tx', 'scene-cam3d-ty', 'scene-cam3d-tz', 'scene-cam3d-fov',
   'scene-shadows3d', 'scene-shadow-ground-y',
   'scene-2d-lighting-wrap', 'scene-darkness', 'scene-darkness-color'
  ].forEach(id => {
    const el = makeFakeElement(id.includes('btn') ? 'button' : 'input');
    el.id = id;
    doc.register(id, el);
  });
  doc._stage = stage;
  return doc;
}

function loadInSandbox(fakeDoc, extra) {
  const sandbox = Object.assign({ document: fakeDoc, setTimeout: setTimeout }, extra || {});
  sandbox.window = sandbox; // hydra-stage.js assigns to bare `window`
  vm.createContext(sandbox);
  vm.runInContext(MODULE_SRC, sandbox, { filename: 'hydra-stage.js' });
  return sandbox.HydraStage;
}

function stubH3() {
  return {
    calls: [],
    normalizeRenderMode(m) { return m === '3d' ? '3d' : '2d'; },
    normalizeCamera3d(cam) {
      return Object.assign(
        { x: 0, y: 100, z: 200, tx: 0, ty: 0, tz: 0, fov: 60 }, cam || {});
    },
    is3dKind(k) { return ['box3d', 'sphere3d', 'plane3d', 'cylinder3d', 'model3d'].includes(k); },
    isLight3d(k) { return k === 'light3d'; },
    renderScene(g, opts, objs, w, h, resolveMesh) {
      this.calls.push({ opts, kinds: objs.map(o => o.kind), w, h, hasResolver: typeof resolveMesh === 'function' });
    }
  };
}

function stubL2() {
  return {
    normalizeSceneDarkness(scene) {
      if (typeof scene.darkness !== 'number' || !Number.isFinite(scene.darkness)) scene.darkness = 0;
      if (typeof scene.darknessColor !== 'string') scene.darknessColor = '#000000';
      return scene;
    }
  };
}

// --- load: vm sandbox (window + fake document) + plain require() -------
const doc = makeStageDoc();
const M = loadInSandbox(doc);
const M2 = factory();

check('module exposes the full stage surface',
  !!M && typeof M.configure === 'function' &&
  typeof M.normalizeSceneDimensions === 'function' &&
  typeof M.getSceneWorldWidth === 'function' &&
  typeof M.getSceneWorldHeight === 'function' &&
  typeof M.getSceneViewportWidth === 'function' &&
  typeof M.getSceneViewportHeight === 'function' &&
  typeof M.snapValue === 'function' &&
  typeof M.clampZoom === 'function' &&
  typeof M.kindName3d === 'function' &&
  typeof M.applySceneZoom === 'function' &&
  typeof M.getScenePointFromEvent === 'function' &&
  typeof M.updateCameraFrame === 'function' &&
  typeof M.updateSceneBg === 'function' &&
  typeof M.applySceneSize === 'function' &&
  typeof M.isScene3dScene === 'function' &&
  typeof M.get3dView === 'function' &&
  typeof M.set3dView === 'function' &&
  typeof M.update3dViewToggle === 'function' &&
  typeof M.render3dView === 'function' &&
  typeof M.syncScene3dCameraFields === 'function' &&
  typeof M.onScene3dCameraInput === 'function' &&
  typeof M.syncSceneDarknessFields === 'function' &&
  typeof M.onSceneDarknessInput === 'function');
check('factorySource is a self-contained function string',
  typeof M.factorySource === 'string' && M.factorySource.includes('hydraStageFactory'));
check('plain require() gives an independent instance',
  M2 !== M && typeof M2.normalizeSceneDimensions === 'function' &&
  typeof M2.factorySource === 'undefined');
check('independent instances own independent 3D-view flags',
  (() => {
    const A = factory(); const B = factory();
    const h3 = stubH3();
    A.configure({ getHydra3d: () => h3 });
    B.configure({ getHydra3d: () => h3 });
    const dA = makeStageDoc(); const dB = makeStageDoc();
    A.set3dView(dA, true, { renderMode: '3d', objects: [] });
    return A.get3dView() === true && B.get3dView() === false;
  })());

// An instance with no document degrades instead of throwing.
{
  const N = factory(); // plain node require: no document global
  let threw = false;
  try {
    N.applySceneZoom(null, 1.5);
    N.updateCameraFrame(null, { worldWidth: 800, worldHeight: 600 });
    N.updateSceneBg(null, { bgColor: '#fff' });
    N.applySceneSize(null, { worldWidth: 800, worldHeight: 600 });
    N.update3dViewToggle(null, { renderMode: '2d' });
    N.render3dView(null, { renderMode: '2d', objects: [] });
    N.syncScene3dCameraFields(null, {});
    N.onScene3dCameraInput(null, {});
    N.syncSceneDarknessFields(null, {});
    N.onSceneDarknessInput(null, {});
  } catch (e) { threw = true; }
  check('DOM functions no-op with no document instead of throwing', !threw);
  eq('getScenePointFromEvent degrades to {0,0} with no stage element',
    N.getScenePointFromEvent({ clientX: 5, clientY: 6 }, 1, null), { x: 0, y: 0 });
  eq('pure geometry still works with no document',
    N.getSceneWorldWidth({ worldWidth: 400 }), 400);
}

// --- configure ----------------------------------------------------------
{
  const C = factory();
  const h3 = stubH3();
  let dirty = 0;
  C.configure({ onDirty: () => { dirty++; }, getHydra3d: () => h3 });
  const d = makeStageDoc();
  const scene = { renderMode: '2d', darkness: 0.5, darknessColor: '#112233' };
  C.configure({ getHydraLight2d: () => stubL2() });
  C.onSceneDarknessInput(d, scene);
  check('configured dirty callback fires on a darkness edit', dirty === 1);
  C.configure({ onDirty: 'not a function' });
  C.onSceneDarknessInput(d, scene);
  check('non-function onDirty is ignored, previous callback stands', dirty === 2);
  C.configure(null);
  C.configure();
  C.onSceneDarknessInput(d, scene);
  check('configure(null)/configure() are safe and keep the callback', dirty === 3);
  C.configure({ onDirty: () => { throw new Error('boom'); } });
  let threw = false;
  try { C.onSceneDarknessInput(d, scene); } catch (e) { threw = true; }
  check('a throwing dirty callback never breaks the field handler', !threw);
  C.configure({ onDirty: () => { dirty++; }, getHydra3d: () => { throw new Error('boom'); } });
  check('a throwing Hydra3d provider degrades to no 3D module',
    C.isScene3dScene({ renderMode: '3d' }) === false);
  C.configure({ getBgDataUrl: () => { throw new Error('boom'); } });
  const d2 = makeStageDoc();
  let threw2 = false;
  try { C.updateSceneBg(d2, { bgAssetId: 'a1', bgColor: '#123456' }); } catch (e) { threw2 = true; }
  check('a throwing bg provider falls back to the bg color',
    !threw2 && d2._stage.style.backgroundColor === '#123456' &&
    d2._stage.style.backgroundImage === '');
}

// --- scene dimensions ----------------------------------------------------
{
  eq('normalizeSceneDimensions(null) is null', M.normalizeSceneDimensions(null), null);
  eq('normalizeSceneDimensions repairs a bare scene to 800x600',
    M.normalizeSceneDimensions({}), {
      worldWidth: 800, worldHeight: 600, width: 800, height: 600,
      viewportWidth: 800, viewportHeight: 600
    });
  const big = M.normalizeSceneDimensions({ worldWidth: 1600, worldHeight: 1200 });
  check('wide worlds keep a 800x600 viewport',
    big.viewportWidth === 800 && big.viewportHeight === 600,
    JSON.stringify(big));
  const small = M.normalizeSceneDimensions({ worldWidth: 400, worldHeight: 300 });
  check('small worlds shrink the viewport to the world',
    small.viewportWidth === 400 && small.viewportHeight === 300,
    JSON.stringify(small));
  const tiny = M.normalizeSceneDimensions({ worldWidth: 5, worldHeight: 20 });
  check('dimensions clamp to a 100 minimum',
    tiny.worldWidth === 100 && tiny.worldHeight === 100 &&
    tiny.viewportWidth === 100 && tiny.viewportHeight === 100,
    JSON.stringify(tiny));
  const kept = M.normalizeSceneDimensions(
    { worldWidth: 1000, worldHeight: 700, viewportWidth: 500, viewportHeight: 400 });
  check('explicit viewport values are kept',
    kept.viewportWidth === 500 && kept.viewportHeight === 400, JSON.stringify(kept));
  const str = M.normalizeSceneDimensions({ width: '640', height: '480' });
  check('string dimensions coerce to numbers',
    str.worldWidth === 640 && str.worldHeight === 480, JSON.stringify(str));
  eq('getters fall back to 800/600 for a null scene',
    [M.getSceneWorldWidth(null), M.getSceneWorldHeight(null),
     M.getSceneViewportWidth(null), M.getSceneViewportHeight(null)],
    [800, 600, 800, 600]);
  eq('getters read a normalized scene',
    [M.getSceneWorldWidth({ worldWidth: 900, viewportWidth: 700 }),
     M.getSceneViewportHeight({ worldHeight: 500 })],
    [900, 500]);
  // Custom normalizer provider runs and a throwing one is swallowed.
  const P = factory();
  let normalized = null;
  P.configure({ normalizeScene: (s) => { normalized = s; s.worldWidth = 1234; } });
  const viaProvider = P.normalizeSceneDimensions({ worldWidth: 100 });
  check('configured normalizer provider runs before the local math',
    normalized === viaProvider && viaProvider.worldWidth === 1234,
    JSON.stringify(viaProvider));
  const T = factory();
  T.configure({ normalizeScene: () => { throw new Error('boom'); } });
  let threw = false;
  let out = null;
  try { out = T.normalizeSceneDimensions({}); } catch (e) { threw = true; }
  check('a throwing normalizer is swallowed and the local math still runs',
    !threw && out !== null && out.worldWidth === 800, JSON.stringify(out));
  // globalThis.HydraUniversal resolution (the browser path).
  const G = loadInSandbox(makeStageDoc(), {
    HydraUniversal: { normalizeScene: (s) => { s.fromCore = true; } }
  });
  const viaCore = G.normalizeSceneDimensions({});
  check('normalizer resolves from globalThis.HydraUniversal when unconfigured',
    viaCore.fromCore === true, JSON.stringify(viaCore));
}

// --- snap / zoom / kind names (pure) --------------------------------------
eq('snapValue snaps to the grid when on', M.snapValue(41, true, 20), 40);
eq('snapValue rounds up at the half grid', M.snapValue(50, true, 20), 60);
eq('snapValue rounds without snapping when off', M.snapValue(41.6, false, 20), 42);
eq('snapValue honors a custom grid size', M.snapValue(47, true, 10), 50);
eq('snapValue degrades a non-finite value to 0', M.snapValue(NaN, true, 20), 0);
eq('snapValue degrades a bad grid size to 20', M.snapValue(41, true, 0), 40);
eq('clampZoom clamps low', M.clampZoom(0.1), 0.35);
eq('clampZoom clamps high', M.clampZoom(5), 2);
eq('clampZoom keeps an in-range zoom', M.clampZoom(1.5), 1.5);
eq('clampZoom degrades a non-finite zoom to 1', M.clampZoom(NaN), 1);
eq('clampZoom coerces a string zoom', M.clampZoom('1.2'), 1.2);
eq('kindName3d names every 3D primitive',
  ['box3d', 'sphere3d', 'plane3d', 'cylinder3d', 'model3d'].map(k => M.kindName3d(k)),
  ['Box3D', 'Sphere3D', 'Plane3D', 'Cylinder3D', 'Model3D']);
eq('kindName3d returns empty for other kinds',
  [M.kindName3d('sprite'), M.kindName3d(''), M.kindName3d(null)], ['', '', '']);

// --- stage view: zoom + pointer -------------------------------------------
{
  const d = makeStageDoc();
  M.applySceneZoom(d, 1.5);
  check('applySceneZoom scales the stage element',
    d._stage.style.transform === 'scale(1.5)', d._stage.style.transform);
  M.applySceneZoom(d, 0.5);
  check('applySceneZoom follows the zoom value',
    d._stage.style.transform === 'scale(0.5)', d._stage.style.transform);
  const empty = makeFakeDocument({});
  let threw = false;
  try { M.applySceneZoom(empty, 2); } catch (e) { threw = true; }
  check('applySceneZoom no-ops when the stage element is missing', !threw);

  d._stage._rect = { left: 10, top: 20, width: 800, height: 600 };
  eq('getScenePointFromEvent undoes the zoom',
    M.getScenePointFromEvent({ clientX: 110, clientY: 120 }, 2, d), { x: 50, y: 50 });
  eq('getScenePointFromEvent treats zoom 0 as 1',
    M.getScenePointFromEvent({ clientX: 110, clientY: 120 }, 0, d), { x: 100, y: 100 });
  eq('getScenePointFromEvent degrades to {0,0} with no stage element',
    M.getScenePointFromEvent({ clientX: 110, clientY: 120 }, 2, empty), { x: 0, y: 0 });
}

// --- camera frame + size + background ---------------------------------------
{
  const d = makeStageDoc();
  const scene = { worldWidth: 1000, worldHeight: 700, viewportWidth: 800, viewportHeight: 600 };
  M.updateCameraFrame(d, scene);
  const frame = d._stage.querySelector('.scene-camera-frame');
  check('updateCameraFrame creates the frame',
    frame !== null && frame.className === 'scene-camera-frame');
  check('camera frame uses the viewport size',
    frame.style.width === '800px' && frame.style.height === '600px',
    `${frame.style.width}x${frame.style.height}`);
  check('camera frame sits at the top-left',
    frame.style.left === '0px' && frame.style.top === '0px');
  const wide = { worldWidth: 400, worldHeight: 300, viewportWidth: 800, viewportHeight: 600 };
  M.updateCameraFrame(d, wide);
  const frame2 = d._stage.querySelector('.scene-camera-frame');
  check('camera frame clamps to the world when the viewport is bigger',
    frame2 === frame && frame.style.width === '400px' && frame.style.height === '300px',
    `${frame.style.width}x${frame.style.height}`);
  M.applySceneSize(d, scene);
  check('applySceneSize sizes the stage to the world',
    d._stage.style.width === '1000px' && d._stage.style.height === '700px',
    `${d._stage.style.width}x${d._stage.style.height}`);
  check('applySceneSize refreshes the camera frame',
    frame.style.width === '800px' && frame.style.height === '600px');

  M.updateSceneBg(d, { bgColor: '#aabbcc' });
  check('updateSceneBg paints the bg color with no asset',
    d._stage.style.backgroundColor === '#aabbcc' && d._stage.style.backgroundImage === '',
    JSON.stringify(d._stage.style));
  const B = factory();
  B.configure({ getBgDataUrl: (id) => (id === 'bg1' ? 'data:image/png;base64,AAA' : null) });
  B.updateSceneBg(d, { bgAssetId: 'bg1', bgColor: '#aabbcc' });
  check('updateSceneBg paints the bg image when the asset resolves',
    d._stage.style.backgroundImage === "url('data:image/png;base64,AAA')" &&
    d._stage.style.backgroundSize === 'cover' &&
    d._stage.style.backgroundPosition === 'center' &&
    d._stage.style.backgroundColor === '',
    JSON.stringify(d._stage.style));
  B.updateSceneBg(d, { bgAssetId: 'missing', bgColor: '#aabbcc' });
  check('updateSceneBg falls back to the bg color for an unknown asset',
    d._stage.style.backgroundColor === '#aabbcc' && d._stage.style.backgroundImage === '');
  B.updateSceneBg(d, {});
  check('updateSceneBg defaults to white with no color at all',
    d._stage.style.backgroundColor === '#ffffff');
  let threw = false;
  try { M.updateSceneBg(makeFakeDocument({}), { bgColor: '#fff' }); } catch (e) { threw = true; }
  check('updateSceneBg no-ops when the stage element is missing', !threw);
}

// --- 3D viewport ------------------------------------------------------------
{
  const h3 = stubH3();
  const S = factory();
  S.configure({ getHydra3d: () => h3 });
  const d = makeStageDoc();
  check('isScene3dScene is false with no 3D module',
    factory().isScene3dScene({ renderMode: '3d' }) === false);
  check('isScene3dScene reads the render mode',
    S.isScene3dScene({ renderMode: '3d' }) === true &&
    S.isScene3dScene({ renderMode: '2d' }) === false &&
    S.isScene3dScene(null) === false);
  check('3D view starts off', S.get3dView() === false);

  const scene3d = {
    renderMode: '3d', worldWidth: 800, worldHeight: 600, bgColor: '#ffffff',
    objects: [{ kind: 'box3d' }, { kind: 'sprite' }, { kind: 'light3d' }, { kind: 'plane3d' }]
  };
  S.set3dView(d, true, scene3d);
  check('set3dView(true) turns the 3D view on for a 3D scene', S.get3dView() === true);
  check('set3dView marks the 3D button active and Layout inactive',
    d.getElementById('scene-view-3d-btn').classList.contains('active') &&
    !d.getElementById('scene-view-layout-btn').classList.contains('active'));
  check('render3dView marks the stage as a 3D view',
    d._stage.classList.contains('scene-3d-view'));
  const cv = d._stage.querySelector('#scene-3d-canvas');
  check('render3dView creates the 3D canvas at world size',
    cv !== null && cv.width === 800 && cv.height === 600);
  const hint = d._stage.querySelector('.scene-3d-hint');
  check('render3dView creates the 3D hint',
    hint !== null && /true perspective render/.test(hint.textContent));
  check('render3dView draws only the 3D objects',
    h3.calls.length === 1 && JSON.stringify(h3.calls[0].kinds) === '["box3d","light3d","plane3d"]',
    JSON.stringify(h3.calls));
  check('render3dView normalizes the camera back onto the scene',
    scene3d.camera3d !== null && scene3d.camera3d.fov === 60,
    JSON.stringify(scene3d.camera3d));
  check('render3dView fills the bg color when no bg image is ready',
    cv._ctx.calls.some(c => c[0] === 'fillRect'));
  const callsBefore = h3.calls.length;
  S.render3dView(d, scene3d);
  check('render3dView reuses the canvas and hint on repaint',
    d._stage.querySelector('#scene-3d-canvas') === cv &&
    d._stage.querySelector('.scene-3d-hint') === hint &&
    h3.calls.length === callsBefore + 1);

  // Bg image path: a complete image is drawn instead of the fill.
  const withImg = factory();
  withImg.configure({
    getHydra3d: () => h3,
    getImage: () => ({ complete: true, naturalWidth: 64 })
  });
  const dImg = makeStageDoc();
  withImg.set3dView(dImg, true, Object.assign({}, scene3d, { bgAssetId: 'bg1', objects: [] }));
  const cvImg = dImg._stage.querySelector('#scene-3d-canvas');
  check('render3dView draws the bg image when it is ready',
    cvImg._ctx.calls.some(c => c[0] === 'drawImage'));

  // Turning the view off, and the 2D-scene reset.
  S.set3dView(d, false, scene3d);
  check('set3dView(false) turns the 3D view off', S.get3dView() === false);
  check('render3dView clears the stage class when off',
    !d._stage.classList.contains('scene-3d-view'));
  S.set3dView(d, true, scene3d);
  S.update3dViewToggle(d, { renderMode: '2d', objects: [] });
  check('update3dViewToggle resets to Layout for a 2D scene', S.get3dView() === false);
  check('update3dViewToggle hides the 3D toggle, divider, and camera wrap for 2D',
    d.getElementById('scene-3d-view-toggle').style.display === 'none' &&
    d.getElementById('scene-3d-view-divider').style.display === 'none' &&
    d.getElementById('scene-3d-camera-wrap').style.display === 'none');
  S.update3dViewToggle(d, scene3d);
  check('update3dViewToggle shows the 3D toggle, divider, and camera wrap for 3D',
    d.getElementById('scene-3d-view-toggle').style.display === '' &&
    d.getElementById('scene-3d-view-divider').style.display === '' &&
    d.getElementById('scene-3d-camera-wrap').style.display === '');
  check('set3dView(true) stays off for a 2D scene',
    (() => { S.set3dView(d, true, { renderMode: '2d', objects: [] }); return S.get3dView() === false; })());

  // A throwing projector never breaks the editor.
  const throwing = stubH3();
  throwing.renderScene = () => { throw new Error('projector boom'); };
  const T3 = factory();
  T3.configure({ getHydra3d: () => throwing });
  const dThrow = makeStageDoc();
  let threw = false;
  try { T3.set3dView(dThrow, true, { renderMode: '3d', objects: [] }); } catch (e) { threw = true; }
  check('a throwing projector is swallowed by render3dView', !threw && T3.get3dView() === true);
}

// --- 3D camera field sync -----------------------------------------------------
{
  const h3 = stubH3();
  const S = factory();
  let dirty = 0;
  S.configure({ getHydra3d: () => h3, onDirty: () => { dirty++; } });
  const d = makeStageDoc();
  const scene = { renderMode: '3d', camera3d: { x: 10, y: 20 }, shadows3d: true, shadowGroundY: 42 };
  S.syncScene3dCameraFields(d, scene);
  check('syncScene3dCameraFields writes the camera into the fields',
    d.getElementById('scene-cam3d-x').value === 10 &&
    d.getElementById('scene-cam3d-y').value === 20 &&
    d.getElementById('scene-cam3d-z').value === 200 &&
    d.getElementById('scene-cam3d-fov').value === 60,
    [d.getElementById('scene-cam3d-x').value, d.getElementById('scene-cam3d-y').value,
     d.getElementById('scene-cam3d-z').value, d.getElementById('scene-cam3d-fov').value].join(','));
  check('syncScene3dCameraFields writes the shadow switch and ground Y',
    d.getElementById('scene-shadows3d').checked === true &&
    d.getElementById('scene-shadow-ground-y').value === 42);
  check('syncScene3dCameraFields normalizes the camera onto the scene',
    scene.camera3d !== null && scene.camera3d.tx === 0 && scene.camera3d.fov === 60);
  // No Hydra3d: a quiet no-op.
  const N = factory();
  let threw = false;
  try { N.syncScene3dCameraFields(d, scene); } catch (e) { threw = true; }
  check('syncScene3dCameraFields no-ops with no 3D module', !threw);

  // Edit path: blank clears to the default, invalid is ignored.
  d.getElementById('scene-cam3d-x').value = '15';
  d.getElementById('scene-cam3d-y').value = '';
  d.getElementById('scene-cam3d-z').value = 'abc';
  d.getElementById('scene-cam3d-fov').value = '70';
  d.getElementById('scene-shadows3d').checked = false;
  d.getElementById('scene-shadow-ground-y').value = '';
  const renderCalls = h3.calls.length;
  S.onScene3dCameraInput(d, scene);
  check('onScene3dCameraInput applies typed values and clears blanks to defaults',
    scene.camera3d.x === 15 && scene.camera3d.y === 100 &&
    scene.camera3d.z === 200 && scene.camera3d.fov === 70,
    JSON.stringify(scene.camera3d));
  check('onScene3dCameraInput applies the shadow switch and clears a blank ground Y',
    scene.shadows3d === false && !('shadowGroundY' in scene),
    JSON.stringify(scene));
  check('onScene3dCameraInput marks the project dirty', dirty === 1);
  S.set3dView(d, true, scene);
  const afterOn = h3.calls.length;
  S.onScene3dCameraInput(d, scene);
  check('onScene3dCameraInput repaints the 3D viewport',
    h3.calls.length === afterOn + 1);
  check('onScene3dCameraInput keeps the ground Y when typed',
    (() => {
      d.getElementById('scene-shadow-ground-y').value = '33';
      S.onScene3dCameraInput(d, scene);
      return scene.shadowGroundY === 33;
    })());
}

// --- darkness field sync --------------------------------------------------------
{
  const S = factory();
  let dirty = 0;
  S.configure({ getHydraLight2d: () => stubL2(), onDirty: () => { dirty++; } });
  const d = makeStageDoc();
  const scene = { renderMode: '2d', darkness: 0.5, darknessColor: '#112233' };
  S.syncSceneDarknessFields(d, scene);
  check('syncSceneDarknessFields shows the wrap for a 2D scene',
    d.getElementById('scene-2d-lighting-wrap').style.display === '');
  check('syncSceneDarknessFields writes the slider as a percent',
    d.getElementById('scene-darkness').value === 50);
  check('syncSceneDarknessFields writes a valid tint',
    d.getElementById('scene-darkness-color').value === '#112233');
  scene.darknessColor = 'not-a-color';
  S.syncSceneDarknessFields(d, scene);
  check('syncSceneDarknessFields falls back to black for a bad tint',
    d.getElementById('scene-darkness-color').value === '#000000');
  const scene3d = { renderMode: '3d', darkness: 0.5, darknessColor: '#112233' };
  S.syncSceneDarknessFields(d, scene3d);
  check('syncSceneDarknessFields hides the wrap for a 3D scene',
    d.getElementById('scene-2d-lighting-wrap').style.display === 'none');
  const N = factory();
  let threw = false;
  try { N.syncSceneDarknessFields(d, scene); N.onSceneDarknessInput(d, scene); } catch (e) { threw = true; }
  check('darkness field sync no-ops with no lighting module', !threw);

  d.getElementById('scene-darkness').value = '75';
  d.getElementById('scene-darkness-color').value = '#445566';
  S.onSceneDarknessInput(d, scene);
  check('onSceneDarknessInput applies the slider and tint',
    scene.darkness === 0.75 && scene.darknessColor === '#445566' && dirty === 1,
    JSON.stringify(scene));
  d.getElementById('scene-darkness').value = '250';
  S.onSceneDarknessInput(d, scene);
  check('onSceneDarknessInput clamps darkness to 1', scene.darkness === 1);
  d.getElementById('scene-darkness').value = 'nope';
  S.onSceneDarknessInput(d, scene);
  check('onSceneDarknessInput degrades a bad slider to 0', scene.darkness === 0);
  d.getElementById('scene-darkness-color').value = 'junk';
  S.onSceneDarknessInput(d, scene);
  check('onSceneDarknessInput keeps the old tint for a bad color',
    scene.darknessColor === '#445566');
}

// --- static routing: script.js delegates, old bodies are gone --------------
{
  const delegations = [
    'return HydraStage.normalizeSceneDimensions(scene);',
    'return HydraStage.getSceneWorldWidth(scene);',
    'return HydraStage.getSceneWorldHeight(scene);',
    'return HydraStage.getSceneViewportWidth(scene);',
    'return HydraStage.getSceneViewportHeight(scene);',
    'return HydraStage.snapValue(value, sceneSnapEnabled, SCENE_GRID_SIZE);',
    'HydraStage.applySceneZoom(document, sceneZoom);',
    'sceneZoom = HydraStage.clampZoom(nextZoom);',
    'return HydraStage.getScenePointFromEvent(event, sceneZoom, document);',
    'HydraStage.updateCameraFrame(document, getCurrentScene());',
    'HydraStage.applySceneSize(document, getCurrentScene());',
    'HydraStage.updateSceneBg(document, getCurrentScene());',
    'return HydraStage.isScene3dScene(getCurrentScene());',
    'HydraStage.update3dViewToggle(document, getCurrentScene());',
    'HydraStage.set3dView(document, on, getCurrentScene());',
    'HydraStage.render3dView(document, getCurrentScene());',
    'HydraStage.syncScene3dCameraFields(document, getCurrentScene());',
    'HydraStage.onScene3dCameraInput(document, getCurrentScene());',
    'HydraStage.syncSceneDarknessFields(document, getCurrentScene());',
    'HydraStage.onSceneDarknessInput(document, getCurrentScene());',
    'return HydraStage.kindName3d(kind);',
    'HydraStage.configure({'
  ];
  check('script.js delegates every stage function to HydraStage',
    delegations.every(s => SCRIPT_JS.includes(s)),
    delegations.filter(s => !SCRIPT_JS.includes(s)).join(' | '));
  const gone = [
    'scene.worldWidth = Math.max(100, worldW)',
    "frame = document.createElement('div')",
    "cv.id = 'scene-3d-canvas'",
    "hint.textContent = '3D view",
    'shEl.checked = scene.shadows3d === true',
    'scene.darkness = Number.isFinite(v) ? Math.max(0, Math.min(1, v / 100)) : 0',
    'let sceneEditor3dView = false;'
  ];
  check('script.js no longer carries the old stage bodies',
    gone.every(s => !SCRIPT_JS.includes(s)),
    gone.filter(s => SCRIPT_JS.includes(s)).join(' | '));
  const stageTag = INDEX_HTML.indexOf('src="hydra-stage.js');
  const scriptTag = INDEX_HTML.indexOf('src="script.js');
  check('index.html loads hydra-stage.js before script.js',
    stageTag > 0 && scriptTag > stageTag, `stage@${stageTag} script@${scriptTag}`);
  check('script.js wires the stage providers',
    SCRIPT_JS.includes('getBgDataUrl: function (id)') &&
    SCRIPT_JS.includes('resolveModelMeshFor: resolveModelMeshFor') &&
    SCRIPT_JS.includes('normalizeScene: function (scene)'));
}

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log('stage.test.js: all checks passed');
