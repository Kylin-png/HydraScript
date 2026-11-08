// Unit tests for hydra/hydra-previewtoolbar.js — the preview toolbar
// (P2 item 14, slice 5: the device-frame selector, the Profiler / Trace
// toolbar buttons, the trace feed panel, and the canvas resize, as a
// DOM module).
//
// The canvas sizing math takes explicit arguments (canvas, scene, the
// container element) and is testable with no live editor; the DOM
// functions take the document explicitly (falling back to the global
// one), so the node tests drive them through a vm sandbox with a small
// fake DOM (fake document with an id registry + fake elements with
// style/classList/dataset/children, querySelector for .class, and a
// fake window for the resize listener). script.js delegates to this
// module; the `previewDevice` state and the trace-feed render cache
// that used to be the script.js `previewDevice` let and
// `previewState.traceRenderedCount` now live in the module.

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
  path.join(__dirname, '..', 'hydra', 'hydra-previewtoolbar.js'), 'utf8');
const SCRIPT_JS = fs.readFileSync(
  path.join(__dirname, '..', 'hydra', 'script.js'), 'utf8');
const INDEX_HTML = fs.readFileSync(
  path.join(__dirname, '..', 'hydra', 'index.html'), 'utf8');
const factory = require(path.join(__dirname, '..', 'hydra', 'hydra-previewtoolbar.js'));

// --- fake DOM ---------------------------------------------------------
function makeFakeElement(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    children: [],
    parentNode: null,
    className: '',
    id: '',
    value: '',
    type: '',
    checked: false,
    hidden: false,
    width: 0,
    height: 0,
    style: {},
    dataset: {},
    scrollTop: 0,
    scrollHeight: 0,
    clientWidth: 0,
    clientHeight: 0,
    _text: '',
    _listeners: {},
    _classSet: new Set(),
    _rect: { left: 0, top: 0, width: 0, height: 0 },
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
    addEventListener(type, fn) {
      (this._listeners[type] = this._listeners[type] || []).push(fn);
    },
    fire(type, event) {
      (this._listeners[type] || []).forEach(fn => fn(event || { target: this }));
    },
    getBoundingClientRect() { return this._rect; }
  };
  // Setting textContent replaces the children, like the real DOM.
  Object.defineProperty(el, 'textContent', {
    get() { return el._text; },
    set(v) { el._text = v; if (v === '') el.children.length = 0; },
    configurable: true, enumerable: true
  });
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

function makeFakeDocument() {
  const doc = {
    _byId: {},
    _byClass: {},
    created: 0,
    createElement(tag) { this.created++; return makeFakeElement(tag); },
    getElementById(id) { return this._byId[id] || null; },
    querySelector(sel) {
      if (sel.startsWith('.')) {
        const list = this._byClass[sel.slice(1)] || [];
        return list[0] || null;
      }
      if (sel.startsWith('#')) return this.getElementById(sel.slice(1));
      return null;
    },
    register(id, el) { this._byId[id] = el; el.id = id; return el; },
    registerClass(cls, el) {
      (this._byClass[cls] = this._byClass[cls] || []).push(el);
      el.className = (el.className ? el.className + ' ' : '') + cls;
      return el;
    }
  };
  return doc;
}

function makeToolbarDoc(opts) {
  const o = opts || {};
  const doc = makeFakeDocument();
  const canvas = makeFakeElement('canvas');
  canvas.style = {};
  doc.register('game-canvas', canvas);
  doc.register('preview-device-frame', makeFakeElement('div'));
  const label = doc.register('preview-device-label', makeFakeElement('div'));
  label.hidden = true;
  const select = doc.register('preview-device-select', makeFakeElement('select'));
  select.value = 'desktop';
  doc.register('preview-profiler-btn', makeFakeElement('button'));
  doc.register('preview-trace-btn', makeFakeElement('button'));
  doc.register('trace-clear-btn', makeFakeElement('button'));
  doc.register('trace-panel', makeFakeElement('div'));
  doc.register('trace-feed', makeFakeElement('div'));
  const tab = doc.register('preview-tab', makeFakeElement('div'));
  if (o.tabActive) tab.classList.add('active');
  const container = makeFakeElement('div');
  container.clientWidth = o.containerW !== undefined ? o.containerW : 800;
  container.clientHeight = o.containerH !== undefined ? o.containerH : 600;
  doc.registerClass('fullscreen-preview', container);
  return { doc, canvas, container };
}

function loadInSandbox(extra) {
  const sandbox = {};
  sandbox.window = sandbox; // the module assigns to bare `window`
  sandbox._listeners = {};
  sandbox.addEventListener = function (type, fn) {
    (sandbox._listeners[type] = sandbox._listeners[type] || []).push(fn);
  };
  sandbox.fireWindow = function (type) {
    (sandbox._listeners[type] || []).forEach(fn => fn());
  };
  if (extra) Object.assign(sandbox, extra);
  vm.createContext(sandbox);
  vm.runInContext(MODULE_SRC, sandbox, { filename: 'hydra-previewtoolbar.js' });
  return sandbox;
}

// --- surface + factorySource ------------------------------------------
{
  const T = factory();
  check('module exposes the toolbar surface',
    typeof T.configure === 'function' && typeof T.devices === 'function' &&
    typeof T.getDevice === 'function' && typeof T.setPreviewDevice === 'function' &&
    typeof T.letterboxSize === 'function' &&
    typeof T.resizeGameCanvas === 'function' && typeof T.onWindowResize === 'function' &&
    typeof T.syncToolbarButtons === 'function' && typeof T.renderTraceFeed === 'function' &&
    typeof T.resetTraceRender === 'function' && typeof T.initToolbar === 'function');
  const viaVm = loadInSandbox();
  check('vm instance exposes the same surface via window.HydraPreviewToolbar',
    !!viaVm.HydraPreviewToolbar && typeof viaVm.HydraPreviewToolbar.setPreviewDevice === 'function');
  check('factorySource is a self-contained function string',
    typeof viaVm.HydraPreviewToolbar.factorySource === 'string' &&
    viaVm.HydraPreviewToolbar.factorySource.includes('hydraPreviewToolbarFactory'));
  const a = factory(), b = factory();
  a.setPreviewDevice('phone-portrait', makeToolbarDoc().doc, makeFakeElement('canvas'));
  check('factory instances hold independent device state',
    a.getDevice() === 'phone-portrait' && b.getDevice() === 'desktop');
  check('module never writes innerHTML (project data must not inject markup)',
    !/\.innerHTML\s*=/.test(MODULE_SRC));
}

// --- device table -------------------------------------------------------
{
  const T = factory();
  eq('devices table carries the real device sizes',
    T.devices(), {
      desktop: { label: 'Desktop', width: null, height: null },
      'phone-portrait': { label: 'Phone · portrait 390 × 844', width: 390, height: 844 },
      'phone-landscape': { label: 'Phone · landscape 844 × 390', width: 844, height: 390 },
      'tablet-portrait': { label: 'Tablet · portrait 768 × 1024', width: 768, height: 1024 }
    });
  check('devices() returns a copy (mutating it leaves the module alone)',
    (() => { const d = T.devices(); d.desktop.label = 'HACKED'; return T.devices().desktop.label === 'Desktop'; })());
  check('default device is desktop', T.getDevice() === 'desktop');
}

// --- setPreviewDevice ---------------------------------------------------
{
  const { doc, canvas } = makeToolbarDoc();
  const T = factory();
  T.configure({
    getScene: () => ({ viewportWidth: 800, viewportHeight: 600 }),
    clampCamera: () => {}
  });
  T.setPreviewDevice('phone-portrait', doc, canvas);
  const frame = doc.getElementById('preview-device-frame');
  const label = doc.getElementById('preview-device-label');
  const select = doc.getElementById('preview-device-select');
  check('setPreviewDevice records the device', T.getDevice() === 'phone-portrait');
  check('setPreviewDevice updates the frame dataset', frame.dataset.device === 'phone-portrait');
  check('setPreviewDevice shows the label with the device name',
    label.hidden === false && label.textContent === 'Phone · portrait 390 × 844');
  check('setPreviewDevice syncs the select value', select.value === 'phone-portrait');
  check('setPreviewDevice resizes the canvas to the scene viewport',
    canvas.width === 800 && canvas.height === 600);
  T.setPreviewDevice('no-such-device', doc, canvas);
  check('unknown device id falls back to desktop',
    T.getDevice() === 'desktop' && frame.dataset.device === 'desktop');
  check('desktop hides the label again', label.hidden === true && select.value === 'desktop');
  check('setPreviewDevice with no document does not throw',
    (() => { try { T.setPreviewDevice('tablet-portrait'); return true; } catch (e) { return false; } })());
}

// --- resizeGameCanvas ---------------------------------------------------
{
  const scene = { viewportWidth: 800, viewportHeight: 600 };
  let clamped = null;
  const { doc, canvas, container } = makeToolbarDoc();
  const T = factory();
  T.configure({
    getScene: () => scene,
    getViewportSize: (s) => ({ width: s.viewportWidth, height: s.viewportHeight }),
    clampCamera: (s) => { clamped = s; }
  });
  T.setPreviewDevice('phone-portrait', doc, canvas, scene);
  // Container 800x600: avail 768x544, box min(768, 390) x min(544, 844)
  // = 390x544; letterbox scale min(390/800, 544/600) = 0.4875, so the
  // 800x600 game shows 390x293 — the scene aspect, never stretched.
  eq('framed device letterboxes the canvas to the scene aspect',
    [canvas.style.width, canvas.style.height], ['390px', '293px']);
  check('framed canvas keeps the scene aspect ratio (no stretch)',
    Math.abs(parseFloat(canvas.style.width) / parseFloat(canvas.style.height) - 800 / 600) < 0.01,
    `${canvas.style.width} x ${canvas.style.height}`);
  check('framed canvas never exceeds the device size',
    parseFloat(canvas.style.width) <= 390 && parseFloat(canvas.style.height) <= 844);
  check('framed resize sets the canvas bitmap to the viewport',
    canvas.width === 800 && canvas.height === 600);
  check('resize clamps the camera to the scene', clamped === scene);

  const d2 = makeToolbarDoc({ containerW: 400, containerH: 300 });
  const T2 = factory();
  T2.configure({ getScene: () => scene, clampCamera: () => {} });
  T2.resizeGameCanvas(d2.doc, d2.canvas, scene);
  eq('desktop preview keeps the old fit-the-pane behavior',
    [d2.canvas.style.width, d2.canvas.style.height], ['400px', '300px']);

  const d3 = makeToolbarDoc();
  d3.doc._byClass = {}; // no .fullscreen-preview container
  const T3 = factory();
  T3.configure({ getScene: () => scene });
  T3.resizeGameCanvas(d3.doc, d3.canvas, scene);
  eq('no container falls back to scale 1',
    [d3.canvas.style.width, d3.canvas.style.height], ['800px', '600px']);

  check('resize with no scene and no provider sizes 800x600 without throwing',
    (() => {
      try {
        const T4 = factory();
        const c = makeFakeElement('canvas');
        T4.resizeGameCanvas(makeToolbarDoc().doc, c);
        return c.width === 800 && c.height === 600;
      } catch (e) { return false; }
    })());
  check('throwing viewport provider degrades to 800x600',
    (() => {
      try {
        const T5 = factory();
        T5.configure({ getViewportSize: () => { throw new Error('boom'); } });
        const c = makeFakeElement('canvas');
        T5.resizeGameCanvas(makeToolbarDoc().doc, c, scene);
        return c.width === 800 && c.height === 600;
      } catch (e) { return false; }
    })());
  check('throwing clamp provider does not break the resize',
    (() => {
      try {
        const T6 = factory();
        T6.configure({ clampCamera: () => { throw new Error('boom'); } });
        const c = makeFakeElement('canvas');
        T6.resizeGameCanvas(makeToolbarDoc().doc, c, scene);
        return c.width === 800;
      } catch (e) { return false; }
    })());
  check('resize with no canvas is a no-op',
    (() => {
      try { factory().resizeGameCanvas(makeToolbarDoc().doc, null, scene); return true; }
      catch (e) { return false; }
    })());
}

// --- letterboxSize ----------------------------------------------------
{
  const T = factory();
  const lb = T.letterboxSize;
  eq('letterbox: landscape game in a portrait phone is width-bound',
    lb(800, 600, 390, 844), { width: 390, height: 293, scale: 0.4875 });
  eq('letterbox: landscape game in a landscape phone is height-bound',
    lb(800, 600, 844, 390), { width: 520, height: 390, scale: 0.65 });
  eq('letterbox: portrait game in a portrait phone fills the device',
    lb(600, 800, 390, 844), { width: 390, height: 520, scale: 0.65 });
  eq('letterbox: same-aspect box keeps the size',
    lb(800, 600, 800, 600), { width: 800, height: 600, scale: 1 });
  eq('letterbox: a bigger box never upscales past the fit scale',
    lb(800, 600, 1600, 1200), { width: 1600, height: 1200, scale: 2 });
  eq('letterbox: a tiny pane shrinks the game but keeps its aspect',
    lb(800, 600, 200, 150), { width: 200, height: 150, scale: 0.25 });
  check('letterbox: display ratio always equals the view ratio',
    (() => {
      const cases = [[800, 600, 390, 844], [800, 600, 844, 390], [800, 600, 768, 1024],
        [1024, 768, 390, 844], [400, 400, 390, 844], [1920, 1080, 390, 844]];
      return cases.every(([vw, vh, mw, mh]) => {
        const r = lb(vw, vh, mw, mh);
        return Math.abs(r.width / r.height - vw / vh) < 0.01;
      });
    })());
  check('letterbox: the display never exceeds the box',
    (() => {
      const cases = [[800, 600, 390, 844], [800, 600, 844, 390], [800, 600, 768, 1024]];
      return cases.every(([vw, vh, mw, mh]) => {
        const r = lb(vw, vh, mw, mh);
        return r.width <= mw && r.height <= mh;
      });
    })());
  eq('letterbox: zero-size box falls back to the natural size',
    lb(800, 600, 0, 0), { width: 800, height: 600, scale: 1 });
  eq('letterbox: non-finite viewport falls back to the natural size',
    lb(NaN, 600, 390, 844), { width: NaN, height: 600, scale: 1 });

  // The framed resize routes through the same math for every device:
  // the canvas aspect is the scene aspect in all four frames.
  const scene = { viewportWidth: 800, viewportHeight: 600 };
  for (const id of ['phone-portrait', 'phone-landscape', 'tablet-portrait']) {
    const { doc, canvas } = makeToolbarDoc({ containerW: 1400, containerH: 900 });
    const Tx = factory();
    Tx.configure({ getScene: () => scene, clampCamera: () => {} });
    Tx.setPreviewDevice(id, doc, canvas, scene);
    const w = parseFloat(canvas.style.width);
    const h = parseFloat(canvas.style.height);
    const dev = Tx.devices()[id];
    check(`framed ${id} keeps the scene aspect and fits the device`,
      Math.abs(w / h - 800 / 600) < 0.01 && w <= dev.width && h <= dev.height,
      `${canvas.style.width} x ${canvas.style.height} in ${dev.width}x${dev.height}`);
  }
}

// --- initToolbar wiring -------------------------------------------------
{
  const scene = { viewportWidth: 800, viewportHeight: 600 };
  let toggles = 0;
  const profiler = { visible: false };
  const profile = {
    isVisible: (p) => p.visible,
    toggle: (p) => { p.visible = !p.visible; toggles++; }
  };
  let traceEvents = [];
  const tracer = { enabled: false, events: traceEvents };
  const trace = {
    isEnabled: (t) => t.enabled,
    toggle: (t) => { t.enabled = !t.enabled; },
    clear: (t) => { t.events.length = 0; },
    recent: (t, n) => t.events.slice(-n),
    formatEvent: (ev) => ev.text
  };
  const sb = loadInSandbox();
  const T = sb.HydraPreviewToolbar;
  const { doc, canvas, container } = makeToolbarDoc({ tabActive: true });
  T.configure({
    getScene: () => scene,
    getViewportSize: (s) => ({ width: s.viewportWidth, height: s.viewportHeight }),
    clampCamera: () => {},
    getProfiler: () => profiler,
    getTrace: () => tracer,
    getHydraProfile: () => profile,
    getHydraTrace: () => trace
  });
  T.initToolbar(doc, canvas);

  doc.getElementById('preview-device-select').fire('change', { target: { value: 'tablet-portrait' } });
  check('device select change switches the device',
    T.getDevice() === 'tablet-portrait' &&
    doc.getElementById('preview-device-frame').dataset.device === 'tablet-portrait');

  doc.getElementById('preview-profiler-btn').fire('click');
  check('profiler button click toggles the profiler', toggles === 1 && profiler.visible === true);
  doc.getElementById('preview-profiler-btn').fire('click');
  check('profiler button click toggles back', toggles === 2 && profiler.visible === false);

  traceEvents.push({ text: 'gameStart fired' });
  tracer.events = traceEvents;
  doc.getElementById('preview-trace-btn').fire('click');
  const feed = doc.getElementById('trace-feed');
  check('trace button click enables tracing and renders the feed',
    tracer.enabled === true && feed.children.length === 1 &&
    feed.children[0].className === 'trace-line' &&
    feed.children[0].textContent === 'gameStart fired');
  // The click flips the tracer; the button's active state syncs on the
  // next frame through syncToolbarButtons, exactly like drawGame does.
  T.syncToolbarButtons(doc);
  check('trace button lights up while tracing',
    doc.getElementById('preview-trace-btn').classList.contains('active'));

  doc.getElementById('trace-clear-btn').fire('click');
  check('trace clear button empties the tracer and shows the waiting line',
    tracer.events.length === 0 && feed.children.length === 1 &&
    feed.children[0].textContent === 'Tracing is on. Waiting for blocks to fire.');

  // Window resize refits only while the preview tab is active.
  T.setPreviewDevice('phone-portrait', doc, canvas, scene);
  container.clientWidth = 400;
  container.clientHeight = 300;
  canvas.style.width = 'sentinel';
  sb.fireWindow('resize');
  // Avail 368x244, box 368x244, scale min(368/800, 244/600) = 0.4067.
  check('window resize refits the canvas while the tab is active',
    canvas.style.width === '325px' && canvas.style.height === '244px');
  const doc2 = makeToolbarDoc({ tabActive: false });
  const T2 = sb.HydraPreviewToolbar;
  T2.initToolbar(doc2.doc, doc2.canvas);
  doc2.canvas.style.width = 'sentinel';
  sb.fireWindow('resize');
  check('window resize leaves the canvas alone while the tab is inactive',
    doc2.canvas.style.width === 'sentinel');

  check('initToolbar with missing elements does not throw',
    (() => { try { factory().initToolbar(makeFakeDocument(), makeFakeElement('canvas')); return true; }
      catch (e) { return false; } })());
}

// --- syncToolbarButtons -------------------------------------------------
{
  const profiler = { visible: true };
  const profile = { isVisible: (p) => p.visible };
  const tracer = { enabled: true, events: [] };
  const trace = { isEnabled: (t) => t.enabled };
  const { doc } = makeToolbarDoc();
  const T = factory();
  T.configure({
    getProfiler: () => profiler, getTrace: () => tracer,
    getHydraProfile: () => profile, getHydraTrace: () => trace
  });
  T.syncToolbarButtons(doc);
  check('profiler button shows active while the profiler is visible',
    doc.getElementById('preview-profiler-btn').classList.contains('active'));
  check('trace button shows active and the panel shows while tracing',
    doc.getElementById('preview-trace-btn').classList.contains('active') &&
    doc.getElementById('trace-panel').hidden === false);
  profiler.visible = false;
  tracer.enabled = false;
  T.syncToolbarButtons(doc);
  check('both buttons go inactive and the panel hides when off',
    !doc.getElementById('preview-profiler-btn').classList.contains('active') &&
    !doc.getElementById('preview-trace-btn').classList.contains('active') &&
    doc.getElementById('trace-panel').hidden === true);
  check('sync with no modules and no state does not throw',
    (() => { try { factory().syncToolbarButtons(makeToolbarDoc().doc); return true; }
      catch (e) { return false; } })());
}

// --- renderTraceFeed ----------------------------------------------------
{
  const tracer = { enabled: false, events: [] };
  const trace = {
    isEnabled: (t) => t.enabled,
    recent: (t, n) => t.events.slice(-n),
    formatEvent: (ev) => ev.text,
    clear: (t) => { t.events.length = 0; },
    toggle: (t) => { t.enabled = !t.enabled; }
  };
  const { doc } = makeToolbarDoc();
  const feed = doc.getElementById('trace-feed');
  const T = factory();
  T.configure({ getTrace: () => tracer, getHydraTrace: () => trace });

  tracer.enabled = true;
  T.renderTraceFeed(doc);
  check('tracing on with no events shows the waiting message',
    feed.children.length === 1 && /Waiting for blocks/.test(feed.children[0].textContent));

  tracer.enabled = false;
  T.resetTraceRender();
  T.renderTraceFeed(doc);
  check('tracing off shows the off message',
    feed.children.length === 1 && feed.children[0].className === 'trace-empty' &&
    /Tracing is off/.test(feed.children[0].textContent));

  tracer.enabled = true;
  T.resetTraceRender();
  tracer.events.push({ text: 'always fired' }, { text: 'score set to 5' });
  T.renderTraceFeed(doc);
  check('events render as lines in order',
    feed.children.length === 2 &&
    feed.children[0].textContent === 'always fired' &&
    feed.children[1].textContent === 'score set to 5');
  const createdAfterFirst = doc.created;
  T.renderTraceFeed(doc);
  check('unchanged event count does not rebuild the feed',
    doc.created === createdAfterFirst && feed.children.length === 2);
  tracer.events.push({ text: 'coin collected' });
  T.renderTraceFeed(doc);
  check('a new event rebuilds the feed with the new line',
    feed.children.length === 3 && feed.children[2].textContent === 'coin collected');

  // Toggle resets the cache: the same count rebuilds after a toggle.
  const sb = loadInSandbox();
  const T2 = sb.HydraPreviewToolbar;
  const d2 = makeToolbarDoc();
  T2.configure({ getTrace: () => tracer, getHydraTrace: () => trace });
  T2.initToolbar(d2.doc, d2.canvas);
  tracer.enabled = true;
  T2.renderTraceFeed(d2.doc);
  const f2 = d2.doc.getElementById('trace-feed');
  const n2 = d2.doc.created;
  d2.doc.getElementById('preview-trace-btn').fire('click'); // disables
  d2.doc.getElementById('preview-trace-btn').fire('click'); // re-enables
  check('toggle resets the render cache so the feed rebuilds',
    d2.doc.created > n2 && f2.children.length === 3);

  T.resetTraceRender();
  const createdBeforeReset = doc.created;
  T.renderTraceFeed(doc);
  check('resetTraceRender forces a rebuild on the next render',
    doc.created > createdBeforeReset);

  check('render with missing panel/feed/trace does not throw',
    (() => { try { factory().renderTraceFeed(makeFakeDocument()); return true; }
      catch (e) { return false; } })());
  check('throwing recent() degrades to the waiting line instead of throwing',
    (() => {
      try {
        const bad = { isEnabled: () => true, recent: () => { throw new Error('boom'); }, formatEvent: (e) => e.text };
        const t3 = { enabled: true, events: [{ text: 'x' }] };
        const T3 = factory();
        T3.configure({ getTrace: () => t3, getHydraTrace: () => bad });
        const d3 = makeToolbarDoc();
        T3.renderTraceFeed(d3.doc);
        const f3 = d3.doc.getElementById('trace-feed');
        return f3.children.length === 1 && /Waiting for blocks/.test(f3.children[0].textContent);
      } catch (e) { return false; }
    })());
  check('feed entries use textContent, never innerHTML',
    feed.innerHTML === undefined && !/\.innerHTML\s*=/.test(MODULE_SRC));
}

// --- static routing: script.js delegates, the module owns the work -----
{
  check('script.js no longer defines the device table or setPreviewDevice inline',
    !/const PREVIEW_DEVICES/.test(SCRIPT_JS) && !/function setPreviewDevice/.test(SCRIPT_JS) &&
    !/let previewDevice/.test(SCRIPT_JS));
  check('script.js no longer defines renderTraceFeed inline',
    !/function renderTraceFeed\(\) \{\n  const panel/.test(SCRIPT_JS));
  check('script.js no longer keeps traceRenderedCount on previewState',
    !/traceRenderedCount/.test(SCRIPT_JS));
  check('script.js delegates resizeGameCanvas to the toolbar module',
    /function resizeGameCanvas[\s\S]{0,300}HydraPreviewToolbar\.resizeGameCanvas/.test(SCRIPT_JS));
  check('script.js delegates renderTraceFeed to the toolbar module',
    /function renderTraceFeed[\s\S]{0,200}HydraPreviewToolbar\.renderTraceFeed/.test(SCRIPT_JS));
  check('script.js delegates the frame-end button sync to the toolbar module',
    /onFrameEnd[\s\S]{0,300}HydraPreviewToolbar\.syncToolbarButtons/.test(SCRIPT_JS));
  check('script.js configures the toolbar module with live editor state',
    /HydraPreviewToolbar\.configure\(\{/.test(SCRIPT_JS) &&
    /getScene: \(\) => getPreviewScene\(\)/.test(SCRIPT_JS) &&
    /getProfiler: \(\) => previewState\.profiler/.test(SCRIPT_JS) &&
    /getTrace: \(\) => previewState\.trace/.test(SCRIPT_JS));
  check('script.js wires the toolbar init after the canvas exists',
    /HydraPreviewToolbar\.initToolbar\(document, canvas\)/.test(SCRIPT_JS));
  check('resetGame resets the trace render cache through the module',
    /HydraPreviewToolbar\.resetTraceRender\(\)/.test(SCRIPT_JS));
  check('index.html loads the toolbar module before script.js',
    INDEX_HTML.indexOf('src="hydra-previewtoolbar.js') > 0 &&
    INDEX_HTML.indexOf('src="hydra-previewtoolbar.js') < INDEX_HTML.indexOf('src="script.js'));
}

if (failures) { console.log(`${failures} check(s) failed`); process.exit(1); }
console.log('previewtoolbar.test.js: all checks passed');
