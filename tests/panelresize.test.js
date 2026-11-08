// Unit tests for the P5-2 slice d resizable panels — the drag handles on
// the Scene inspector's and the Logic panel's left edge, with widths
// persisted per browser in localStorage.
//
// Covers the three layers: the pure helpers in hydra-panelresize.js
// (clamp / parse / serialize / pointer math / keyboard steps), the
// createResizer DOM wiring (fake-DOM drag, double-click reset,
// keyboard resize, persistence), and the markup + styles + script.js
// wiring pins.

const fs = require('fs');
const path = require('path');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}
function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected),
    `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

const INDEX_HTML = fs.readFileSync(
  path.join(__dirname, '..', 'hydra', 'index.html'), 'utf8');
const STYLE_CSS = fs.readFileSync(
  path.join(__dirname, '..', 'hydra', 'style.css'), 'utf8');
const SCRIPT_JS = fs.readFileSync(
  path.join(__dirname, '..', 'hydra', 'script.js'), 'utf8');
const MODULE_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'hydra', 'hydra-panelresize.js'), 'utf8');
const GUIDE = fs.readFileSync(
  path.join(__dirname, '..', 'docs', 'user-guide.md'), 'utf8');
const factory = require(path.join(__dirname, '..', 'hydra', 'hydra-panelresize.js'));
const M = factory();

// --- constants ------------------------------------------------------------
eq('scene default width is 340', M.DEFAULT_WIDTHS.scene, 340);
eq('logic default width is 320', M.DEFAULT_WIDTHS.logic, 320);
eq('scene limits are 240-560', M.LIMITS.scene, { min: 240, max: 560 });
eq('logic limits are 240-520', M.LIMITS.logic, { min: 240, max: 520 });
eq('CSS vars are named per panel', M.CSS_VARS,
  { scene: '--scene-panel-width', logic: '--logic-panel-width' });
check('storage key is versioned', M.STORAGE_KEY === 'hydra.panelWidths.v1');

// --- clampWidth -----------------------------------------------------------
eq('clampWidth keeps an in-range scene width', M.clampWidth('scene', 400), 400);
eq('clampWidth floors a scene width at 240', M.clampWidth('scene', 100), 240);
eq('clampWidth caps a scene width at 560', M.clampWidth('scene', 9999), 560);
eq('clampWidth floors a logic width at 240', M.clampWidth('logic', 0), 240);
eq('clampWidth caps a logic width at 520', M.clampWidth('logic', 900), 520);
eq('clampWidth rounds to whole pixels', M.clampWidth('scene', 400.6), 401);
eq('clampWidth falls back to the default on NaN', M.clampWidth('scene', NaN), 340);
eq('clampWidth falls back to the default on a non-number', M.clampWidth('logic', 'wide'), 320);
eq('clampWidth falls back to the default on Infinity', M.clampWidth('scene', Infinity), 340);
eq('clampWidth falls back to the scene default on an unknown panel',
  M.clampWidth('preview', 400), 340);

// --- parseStoredWidths ----------------------------------------------------
eq('parseStoredWidths accepts a full valid pair',
  M.parseStoredWidths('{"scene":400,"logic":280}'), { scene: 400, logic: 280 });
eq('parseStoredWidths fills a missing panel from the default',
  M.parseStoredWidths('{"scene":400}'), { scene: 400, logic: 320 });
eq('parseStoredWidths clamps an out-of-range stored width',
  M.parseStoredWidths('{"scene":100,"logic":9999}'), { scene: 240, logic: 520 });
eq('parseStoredWidths degrades garbage JSON to the defaults',
  M.parseStoredWidths('not json{{'), { scene: 340, logic: 320 });
eq('parseStoredWidths degrades an empty string to the defaults',
  M.parseStoredWidths(''), { scene: 340, logic: 320 });
eq('parseStoredWidths degrades a JSON array to the defaults',
  M.parseStoredWidths('[400,280]'), { scene: 340, logic: 320 });
eq('parseStoredWidths degrades a JSON null to the defaults',
  M.parseStoredWidths('null'), { scene: 340, logic: 320 });
eq('parseStoredWidths drops an unknown panel key',
  M.parseStoredWidths('{"scene":400,"preview":500}'), { scene: 400, logic: 320 });
eq('parseStoredWidths degrades a non-string to the defaults',
  M.parseStoredWidths(null), { scene: 340, logic: 320 });

// --- serializeWidths ------------------------------------------------------
eq('serializeWidths round-trips through parseStoredWidths',
  M.parseStoredWidths(M.serializeWidths({ scene: 400, logic: 280 })),
  { scene: 400, logic: 280 });
eq('serializeWidths clamps before storing',
  M.parseStoredWidths(M.serializeWidths({ scene: 100, logic: 9999 })),
  { scene: 240, logic: 520 });
eq('serializeWidths defaults a missing panel',
  M.parseStoredWidths(M.serializeWidths({ scene: 400 })),
  { scene: 400, logic: 320 });
eq('serializeWidths degrades a null input to the defaults',
  M.parseStoredWidths(M.serializeWidths(null)), { scene: 340, logic: 320 });

// --- widthFromPointer -----------------------------------------------------
eq('widthFromPointer is container right minus pointer x',
  M.widthFromPointer({ right: 1400 }, 1000), 400);
eq('widthFromPointer rounds to whole pixels',
  M.widthFromPointer({ right: 1400 }, 1000.4), 400);
eq('widthFromPointer returns null without a rect',
  M.widthFromPointer(null, 1000), null);
eq('widthFromPointer returns null without a right edge',
  M.widthFromPointer({}, 1000), null);
eq('widthFromPointer returns null for a non-finite x',
  M.widthFromPointer({ right: 1400 }, NaN), null);

// --- widthFromPointerLeft / widthFromPointerForSide (P5-8 slice a) --------
eq('widthFromPointerLeft is pointer x minus container left',
  M.widthFromPointerLeft({ left: 0, right: 1400 }, 400), 400);
eq('widthFromPointerLeft rounds to whole pixels',
  M.widthFromPointerLeft({ left: 100, right: 1400 }, 500.4), 400);
eq('widthFromPointerLeft returns null without a rect',
  M.widthFromPointerLeft(null, 400), null);
eq('widthFromPointerLeft returns null without a left edge',
  M.widthFromPointerLeft({}, 400), null);
eq('widthFromPointerLeft returns null for a non-finite x',
  M.widthFromPointerLeft({ left: 0, right: 1400 }, NaN), null);
eq('widthFromPointerForSide measures from the left when docked left',
  M.widthFromPointerForSide({ left: 0, right: 1400 }, 400, 'left'), 400);
eq('widthFromPointerForSide measures from the right when docked right',
  M.widthFromPointerForSide({ left: 0, right: 1400 }, 1000, 'right'), 400);
eq('widthFromPointerForSide defaults a bad side to the right rule',
  M.widthFromPointerForSide({ left: 0, right: 1400 }, 1000, 'top'), 400);
eq('normalizeSide keeps left', M.normalizeSide('left'), 'left');
eq('normalizeSide reads garbage as right', M.normalizeSide('top'), 'right');

// --- keyboardDelta --------------------------------------------------------
eq('keyboardDelta ArrowLeft steps -10', M.keyboardDelta('ArrowLeft', false), { delta: -10 });
eq('keyboardDelta ArrowRight steps +10', M.keyboardDelta('ArrowRight', false), { delta: 10 });
eq('keyboardDelta Shift+ArrowLeft steps -40', M.keyboardDelta('ArrowLeft', true), { delta: -40 });
eq('keyboardDelta Shift+ArrowRight steps +40', M.keyboardDelta('ArrowRight', true), { delta: 40 });
eq('keyboardDelta Home is a reset', M.keyboardDelta('Home', false), { reset: true });
eq('keyboardDelta ignores other keys', M.keyboardDelta('a', false), null);
eq('keyboardDelta ignores Enter', M.keyboardDelta('Enter', false), null);

// --- storage helpers ------------------------------------------------------
{
  const store = {};
  const storage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; }
  };
  eq('readStoredWidths returns defaults with empty storage',
    M.readStoredWidths(storage), { scene: 340, logic: 320 });
  check('writeStoredWidths stores JSON under the versioned key',
    M.writeStoredWidths(storage, { scene: 400, logic: 280 }) === true &&
    store['hydra.panelWidths.v1'] === '{"scene":400,"logic":280}',
    store['hydra.panelWidths.v1']);
  eq('readStoredWidths reads back what was written',
    M.readStoredWidths(storage), { scene: 400, logic: 280 });
  eq('readStoredWidths degrades a missing storage object to the defaults',
    M.readStoredWidths(null), { scene: 340, logic: 320 });
  const throwing = {
    getItem: () => { throw new Error('denied'); },
    setItem: () => { throw new Error('denied'); }
  };
  eq('readStoredWidths degrades a throwing storage to the defaults',
    M.readStoredWidths(throwing), { scene: 340, logic: 320 });
  check('writeStoredWidths reports false on a throwing storage',
    M.writeStoredWidths(throwing, { scene: 400, logic: 280 }) === false);
}

// --- createResizer (fake DOM) --------------------------------------------
// Minimal stand-ins: an element records listeners and style writes so
// the test can fire pointer/keyboard events by hand.
function fakeElement() {
  const listeners = {};
  const el = {
    style: {
      props: {},
      setProperty: function (k, v) { this.props[k] = v; }
    },
    attrs: {},
    setAttribute: function (k, v) { this.attrs[k] = String(v); },
    addEventListener: function (type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    removeEventListener: function (type, fn) {
      listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
    },
    fire: function (type, ev) {
      (listeners[type] || []).slice().forEach((fn) => fn(ev || {}));
    },
    listenerCount: function (type) { return (listeners[type] || []).length; },
    rect: { right: 1400 },
    getBoundingClientRect: function () { return this.rect; }
  };
  return el;
}
function fakeDocument() {
  const listeners = {};
  return {
    addEventListener: function (type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    removeEventListener: function (type, fn) {
      listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
    },
    fire: function (type, ev) {
      (listeners[type] || []).slice().forEach((fn) => fn(ev || {}));
    }
  };
}

{
  const store = {};
  const storage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; }
  };
  const handle = fakeElement();
  const container = fakeElement();
  const widths = { scene: 340, logic: 320 };
  const seen = [];
  global.document = fakeDocument();
  const r = M.createResizer({
    panel: 'scene',
    handle,
    container,
    storage,
    getWidths: () => ({ ...widths }),
    onWidth: (panel, w) => { widths[panel] = w; seen.push([panel, w]); }
  });
  check('createResizer returns a resizer for a valid config', r !== null);
  eq('resizer starts at the stored width', r.getWidth(), 340);
  check('resizer defaults to the right side (P5-8 slice a)',
    r.getSide() === 'right');
  r.setSide('left');
  check('setSide flips the resizer side without touching the width',
    r.getSide() === 'left' && r.getWidth() === 340);
  r.setSide('right');
  check('resizer announces its width for assistive tech',
    handle.attrs['aria-valuenow'] === '340');

  // Drag: pointerdown at x=1060 (width 340), move to x=900 (width
  // 500), release — the var follows live, storage writes on release.
  handle.fire('pointerdown', { button: 0, pointerId: 1, preventDefault: () => {} });
  global.document.fire('pointermove', { clientX: 900 });
  eq('drag applies the new width live to the CSS var',
    container.style.props['--scene-panel-width'], '500px');
  eq('drag reports the width through onWidth', seen[seen.length - 1], ['scene', 500]);
  check('drag does not persist until release', !('hydra.panelWidths.v1' in store));
  global.document.fire('pointerup', {});
  check('release persists both panels',
    store['hydra.panelWidths.v1'] === '{"scene":500,"logic":320}',
    store['hydra.panelWidths.v1']);
  eq('resizer reports the dragged width', r.getWidth(), 500);

  // Drag past the max clamps at 560 (container right 1400, x=700).
  handle.fire('pointerdown', { button: 0, pointerId: 1, preventDefault: () => {} });
  global.document.fire('pointermove', { clientX: 700 });
  eq('drag clamps at the panel max', container.style.props['--scene-panel-width'], '560px');
  global.document.fire('pointerup', {});

  // Double-click resets to the default and persists.
  handle.fire('dblclick', { preventDefault: () => {} });
  eq('double-click resets to the default width',
    container.style.props['--scene-panel-width'], '340px');
  check('double-click persists the reset',
    store['hydra.panelWidths.v1'] === '{"scene":340,"logic":320}',
    store['hydra.panelWidths.v1']);

  // Keyboard: ArrowRight widens 10px, Shift+ArrowLeft narrows 40px,
  // Home resets — each persists at once.
  handle.fire('keydown', { key: 'ArrowRight', shiftKey: false, preventDefault: () => {} });
  eq('ArrowRight widens by 10px', container.style.props['--scene-panel-width'], '350px');
  handle.fire('keydown', { key: 'ArrowLeft', shiftKey: true, preventDefault: () => {} });
  eq('Shift+ArrowLeft narrows by 40px', container.style.props['--scene-panel-width'], '310px');
  handle.fire('keydown', { key: 'Home', shiftKey: false, preventDefault: () => {} });
  eq('Home resets to the default width', container.style.props['--scene-panel-width'], '340px');
  check('keyboard resize updates aria-valuenow', handle.attrs['aria-valuenow'] === '340');
  handle.fire('keydown', { key: 'a', shiftKey: false, preventDefault: () => {} });
  eq('an unrelated key leaves the width alone',
    container.style.props['--scene-panel-width'], '340px');

  // Non-primary buttons never start a drag.
  handle.fire('pointerdown', { button: 2, pointerId: 1, preventDefault: () => {} });
  global.document.fire('pointermove', { clientX: 900 });
  eq('a right-button press does not drag',
    container.style.props['--scene-panel-width'], '340px');

  // destroy() detaches the listeners.
  const before = handle.listenerCount('pointerdown');
  r.destroy();
  check('destroy detaches the handle listeners',
    before === 1 && handle.listenerCount('pointerdown') === 0);
  delete global.document;
}
{
  check('createResizer returns null for an unknown panel',
    M.createResizer({ panel: 'preview', handle: fakeElement(), container: fakeElement() }) === null);
  check('createResizer returns null without a handle',
    M.createResizer({ panel: 'scene', handle: null, container: fakeElement() }) === null);
  check('createResizer returns null without a container',
    M.createResizer({ panel: 'scene', handle: fakeElement(), container: null }) === null);
  check('createResizer returns null without a config',
    M.createResizer(null) === null);
}

// --- markup ---------------------------------------------------------------
{
  check('index.html loads the panel-resize module before script.js',
    INDEX_HTML.indexOf('hydra-panelresize.js') > 0 &&
    INDEX_HTML.indexOf('hydra-panelresize.js') < INDEX_HTML.indexOf('script.js?'));
  check('scene resizer handle exists with separator semantics',
    INDEX_HTML.includes('id="scene-panel-resizer"') &&
    INDEX_HTML.includes('role="separator"') &&
    INDEX_HTML.includes('aria-label="Resize inspector panel"') &&
    INDEX_HTML.includes('tabindex="0"'));
  check('logic resizer handle exists with separator semantics',
    INDEX_HTML.includes('id="logic-panel-resizer"') &&
    INDEX_HTML.includes('aria-label="Resize logic panel"'));
  check('scene resizer sits inside the scene editor before the side panel',
    INDEX_HTML.indexOf('id="scene-panel-resizer"') < INDEX_HTML.indexOf('class="scene-side-panel"'));
  check('logic resizer sits between the grid and the side panel',
    INDEX_HTML.indexOf('id="logic-panel-resizer"') > INDEX_HTML.indexOf('id="grid"') &&
    INDEX_HTML.indexOf('id="logic-panel-resizer"') < INDEX_HTML.indexOf('class="side-panel"'));
  check('resizer handles carry their min/max/default values for assistive tech',
    INDEX_HTML.includes('aria-valuemin="240"') &&
    INDEX_HTML.includes('aria-valuemax="560"') &&
    INDEX_HTML.includes('aria-valuemax="520"') &&
    INDEX_HTML.includes('aria-valuenow="340"') &&
    INDEX_HTML.includes('aria-valuenow="320"'));
}

// --- styles ---------------------------------------------------------------
{
  check('scene editor carries the panel-width variable at its default',
    /\.scene-editor\s*\{[^}]*--scene-panel-width:\s*340px;/s.test(STYLE_CSS));
  check('scene container right inset follows the variable',
    /\.scene-container\s*\{[^}]*inset:\s*44px var\(--scene-panel-width\) 0 0;/s.test(STYLE_CSS));
  check('scene toolbar right edge follows the variable',
    /\.scene-toolbar\s*\{[^}]*right:\s*var\(--scene-panel-width\);/s.test(STYLE_CSS));
  check('scene side panel width follows the variable',
    /\.scene-side-panel\s*\{[^}]*width:\s*var\(--scene-panel-width\);/s.test(STYLE_CSS));
  check('grid editor carries the logic panel-width variable at its default',
    /\.grid-editor\s*\{[^}]*--logic-panel-width:\s*320px;/s.test(STYLE_CSS));
  check('logic side panel width and min-width follow the variable',
    /\.side-panel\s*\{[^}]*width:\s*var\(--logic-panel-width\);[^}]*min-width:\s*var\(--logic-panel-width\);/s.test(STYLE_CSS));
  check('resizer is a 6px ew-resize handle with no touch scrolling',
    /\.panel-resizer\s*\{[^}]*cursor:\s*ew-resize;[^}]*touch-action:\s*none;/s.test(STYLE_CSS));
  check('scene resizer straddles the panel seam via the variable',
    /#scene-panel-resizer\s*\{[^}]*right:\s*calc\(var\(--scene-panel-width\) - 3px\);/s.test(STYLE_CSS));
  check('resizer grip lights in the muted shell blue on hover',
    /\.panel-resizer:hover::after,\s*\.panel-resizer:active::after\s*\{[^}]*background:\s*#4e7bc4;/s.test(STYLE_CSS));
  check('resizer has a visible keyboard focus ring',
    /\.panel-resizer:focus-visible\s*\{[^}]*outline:\s*2px solid #4e7bc4;/s.test(STYLE_CSS));
  check('resizers hide below the 900px breakpoint',
    /@media \(max-width: 900px\)[\s\S]*?\.panel-resizer\s*\{\s*display:\s*none;\s*\}/.test(STYLE_CSS));
  check('no hardcoded 340px inset survives in the scene layout',
    !/\.scene-container\s*\{[^}]*inset:\s*44px 340px 0 0;/s.test(STYLE_CSS) &&
    !/\.scene-toolbar\s*\{[^}]*right:\s*340px;/s.test(STYLE_CSS) &&
    !/\.scene-side-panel\s*\{[^}]*width:\s*340px;/s.test(STYLE_CSS));
  check('no hardcoded 320px width survives on the logic panel',
    !/\.side-panel\s*\{[^}]*width:\s*320px;/s.test(STYLE_CSS));
}

// --- script.js wiring ------------------------------------------------------
{
  check('script.js defines initPanelResizers',
    /function initPanelResizers\(\)/.test(SCRIPT_JS));
  check('initPanelResizers reads stored widths through the module',
    /readStoredWidths\(window\.localStorage\)/.test(SCRIPT_JS));
  check('initPanelResizers wires both panels through createResizer',
    /createResizer\(\{\s*panel: 'scene'/.test(SCRIPT_JS) &&
    /createResizer\(\{\s*panel: 'logic'/.test(SCRIPT_JS));
  check('panel widths apply through the CSS variables',
    /setProperty\('--scene-panel-width'/.test(SCRIPT_JS) &&
    /setProperty\('--logic-panel-width'/.test(SCRIPT_JS));
  check('initPanelResizers runs at editor load next to the status bar',
    /if \(typeof initPanelResizers === 'function'\) initPanelResizers\(\);/.test(SCRIPT_JS));
  check('initPanelResizers is exposed on window like initStatusBar',
    /window\.initPanelResizers = initPanelResizers;/.test(SCRIPT_JS));
  check('panel-resize wiring never throws out of its own try block',
    /function initPanelResizers\(\) \{\s*try \{/.test(SCRIPT_JS));
}

// --- docs ------------------------------------------------------------------
{
  check('user guide documents resizable panels (drag, persist, reset, keys)',
    GUIDE.includes('**Resizable panels:**') &&
    GUIDE.includes('saved in your browser') &&
    GUIDE.includes('Double-click a handle') &&
    GUIDE.includes('arrow keys'));
}

if (failures) { console.log(`${failures} check(s) failed`); process.exit(1); }
console.log('panelresize.test.js: all checks passed');
