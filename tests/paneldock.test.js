// Unit tests for the P5-8 slice a dockable panels — the dock button
// in each tab's toolbar flips its side panel to the other edge, with
// the side persisted per browser in localStorage.
//
// Covers the three layers: the pure helpers in hydra-paneldock.js
// (normalize / opposite / parse / serialize / storage / apply /
// button labels), the createDockToggle DOM wiring (fake-DOM click,
// persistence callback, resizer coordination, destroy), the
// side-aware pointer math in hydra-panelresize.js, and the markup +
// styles + script.js wiring pins.

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
  path.join(__dirname, '..', 'hydra', 'hydra-paneldock.js'), 'utf8');
const GUIDE = fs.readFileSync(
  path.join(__dirname, '..', 'docs', 'user-guide.md'), 'utf8');
const factory = require(path.join(__dirname, '..', 'hydra', 'hydra-paneldock.js'));
const M = factory();
const PR = require(path.join(__dirname, '..', 'hydra', 'hydra-panelresize.js'))();

// --- constants ------------------------------------------------------------
eq('both panels default to the right side', M.DEFAULT_SIDES, { scene: 'right', logic: 'right' });
eq('panel labels name the inspector and the block panel', M.PANEL_LABELS,
  { scene: 'inspector', logic: 'block' });
check('storage key is versioned', M.STORAGE_KEY === 'hydra.panelDock.v1');

// --- normalizeSide / oppositeSide -----------------------------------------
eq("normalizeSide keeps 'left'", M.normalizeSide('left'), 'left');
eq("normalizeSide keeps 'right'", M.normalizeSide('right'), 'right');
eq('normalizeSide reads garbage as right', M.normalizeSide('top'), 'right');
eq('normalizeSide reads null as right', M.normalizeSide(null), 'right');
eq("oppositeSide of 'left' is 'right'", M.oppositeSide('left'), 'right');
eq("oppositeSide of 'right' is 'left'", M.oppositeSide('right'), 'left');
eq('oppositeSide of garbage is left', M.oppositeSide('top'), 'left');

// --- parseStoredSides -----------------------------------------------------
eq('parseStoredSides accepts a full valid pair',
  M.parseStoredSides('{"scene":"left","logic":"right"}'), { scene: 'left', logic: 'right' });
eq('parseStoredSides fills a missing panel from the default',
  M.parseStoredSides('{"scene":"left"}'), { scene: 'left', logic: 'right' });
eq('parseStoredSides reads a bad side as right',
  M.parseStoredSides('{"scene":"top","logic":"left"}'), { scene: 'right', logic: 'left' });
eq('parseStoredSides degrades garbage JSON to the defaults',
  M.parseStoredSides('not json{{'), { scene: 'right', logic: 'right' });
eq('parseStoredSides degrades an empty string to the defaults',
  M.parseStoredSides(''), { scene: 'right', logic: 'right' });
eq('parseStoredSides degrades a JSON array to the defaults',
  M.parseStoredSides('["left","right"]'), { scene: 'right', logic: 'right' });
eq('parseStoredSides degrades a JSON null to the defaults',
  M.parseStoredSides('null'), { scene: 'right', logic: 'right' });
eq('parseStoredSides drops an unknown panel key',
  M.parseStoredSides('{"scene":"left","preview":"left"}'), { scene: 'left', logic: 'right' });
eq('parseStoredSides degrades a non-string to the defaults',
  M.parseStoredSides(null), { scene: 'right', logic: 'right' });

// --- serializeSides -------------------------------------------------------
eq('serializeSides round-trips through parseStoredSides',
  M.parseStoredSides(M.serializeSides({ scene: 'left', logic: 'right' })),
  { scene: 'left', logic: 'right' });
eq('serializeSides normalizes before storing',
  M.parseStoredSides(M.serializeSides({ scene: 'top', logic: 'left' })),
  { scene: 'right', logic: 'left' });
eq('serializeSides defaults a missing panel',
  M.parseStoredSides(M.serializeSides({ scene: 'left' })),
  { scene: 'left', logic: 'right' });
eq('serializeSides degrades a null input to the defaults',
  M.parseStoredSides(M.serializeSides(null)), { scene: 'right', logic: 'right' });

// --- storage helpers ------------------------------------------------------
{
  const store = {};
  const storage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; }
  };
  eq('readStoredSides returns defaults with empty storage',
    M.readStoredSides(storage), { scene: 'right', logic: 'right' });
  check('writeStoredSides stores JSON under the versioned key',
    M.writeStoredSides(storage, { scene: 'left', logic: 'right' }) === true &&
    store['hydra.panelDock.v1'] === '{"scene":"left","logic":"right"}',
    store['hydra.panelDock.v1']);
  eq('readStoredSides reads back what was written',
    M.readStoredSides(storage), { scene: 'left', logic: 'right' });
  eq('readStoredSides degrades a missing storage object to the defaults',
    M.readStoredSides(null), { scene: 'right', logic: 'right' });
  const throwing = {
    getItem: () => { throw new Error('denied'); },
    setItem: () => { throw new Error('denied'); }
  };
  eq('readStoredSides degrades a throwing storage to the defaults',
    M.readStoredSides(throwing), { scene: 'right', logic: 'right' });
  check('writeStoredSides reports false on a throwing storage',
    M.writeStoredSides(throwing, { scene: 'left', logic: 'right' }) === false);
}

// --- fake DOM -------------------------------------------------------------
// Minimal stand-ins: an element records listeners, attributes, and
// classes so the test can fire clicks by hand.
function fakeElement() {
  const listeners = {};
  const classes = new Set();
  const el = {
    attrs: {},
    style: {
      props: {},
      setProperty: function (k, v) { this.props[k] = v; }
    },
    setAttribute: function (k, v) { this.attrs[k] = String(v); },
    getAttribute: function (k) { return this.attrs[k]; },
    classList: {
      toggle: function (name, force) {
        if (force) classes.add(name); else classes.delete(name);
      },
      contains: function (name) { return classes.has(name); }
    },
    children: {},
    querySelector: function (sel) { return this.children[sel] || null; },
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
    rect: { left: 0, right: 1400 },
    getBoundingClientRect: function () { return this.rect; }
  };
  return el;
}

// --- applySide ------------------------------------------------------------
{
  const container = fakeElement();
  eq('applySide sets data-panel-side on the container',
    M.applySide(container, 'scene', 'left'), 'left');
  check('applySide wrote the attribute',
    container.attrs['data-panel-side'] === 'left');
  eq('applySide normalizes a bad side to right',
    M.applySide(container, 'scene', 'top'), 'right');
  check('applySide returns null without a container',
    M.applySide(null, 'scene', 'left') === null);
}

// --- updateDockButton -----------------------------------------------------
{
  const button = fakeElement();
  button.children.span = { textContent: 'Dock left' };
  eq('updateDockButton names the next action for a right-docked inspector',
    M.updateDockButton(button, 'scene', 'right'), 'right');
  check('button title names docking left',
    button.attrs.title === 'Dock inspector panel on the left', button.attrs.title);
  check('button aria-label matches the title',
    button.attrs['aria-label'] === 'Dock inspector panel on the left');
  check('button is not active while docked right',
    !button.classList.contains('active'));
  check('visible label says Dock left',
    button.children.span.textContent === 'Dock left');

  eq('updateDockButton names the next action for a left-docked block panel',
    M.updateDockButton(button, 'logic', 'left'), 'left');
  check('button title names docking right',
    button.attrs.title === 'Dock block panel on the right', button.attrs.title);
  check('button is active while docked left',
    button.classList.contains('active'));
  check('visible label says Dock right',
    button.children.span.textContent === 'Dock right');

  // An icon-only button (no label span) still updates cleanly.
  const iconButton = fakeElement();
  eq('updateDockButton works without a label span',
    M.updateDockButton(iconButton, 'scene', 'left'), 'left');
  check('icon button title still names the action',
    iconButton.attrs.title === 'Dock inspector panel on the right');
  check('updateDockButton returns null without a button',
    M.updateDockButton(null, 'scene', 'left') === null);
}

// --- createDockToggle (fake DOM) ------------------------------------------
{
  const container = fakeElement();
  const button = fakeElement();
  button.children.span = { textContent: 'Dock left' };
  const seen = [];
  const t = M.createDockToggle({
    panel: 'scene',
    button,
    container,
    initialSide: 'right',
    onSide: (panel, side) => { seen.push([panel, side]); }
  });
  check('createDockToggle returns a toggle for a valid config', t !== null);
  eq('toggle starts on the initial side', t.getSide(), 'right');
  check('toggle applies the initial side to the container',
    container.attrs['data-panel-side'] === 'right');
  check('toggle labels the button for the next action',
    button.attrs.title === 'Dock inspector panel on the left');

  // Click: flips to the left, moves the container, relabels, notifies.
  button.fire('click', { preventDefault: () => {} });
  eq('click flips the toggle to the left', t.getSide(), 'left');
  check('click moves the container to the left',
    container.attrs['data-panel-side'] === 'left');
  check('click relabels the button to dock right',
    button.attrs.title === 'Dock inspector panel on the right');
  check('click marks the button active',
    button.classList.contains('active'));
  eq('click notifies the host once', seen, [['scene', 'left']]);

  // Click again: back to the right.
  button.fire('click', { preventDefault: () => {} });
  eq('a second click flips back to the right', t.getSide(), 'right');
  eq('second click notifies the host again',
    seen, [['scene', 'left'], ['scene', 'right']]);

  // setSide drives the side without notifying (the host's silent path).
  t.setSide('left');
  eq('setSide drives the toggle to the left', t.getSide(), 'left');
  check('setSide moves the container', container.attrs['data-panel-side'] === 'left');
  eq('setSide does not notify the host',
    seen, [['scene', 'left'], ['scene', 'right']]);

  // destroy() detaches the click listener.
  const before = button.listenerCount('click');
  t.destroy();
  check('destroy detaches the click listener',
    before === 1 && button.listenerCount('click') === 0);
  button.fire('click', { preventDefault: () => {} });
  eq('a click after destroy changes nothing', t.getSide(), 'left');
}
{
  check('createDockToggle returns null for an unknown panel',
    M.createDockToggle({ panel: 'preview', button: fakeElement(), container: fakeElement() }) === null);
  check('createDockToggle returns null without a button',
    M.createDockToggle({ panel: 'scene', button: null, container: fakeElement() }) === null);
  check('createDockToggle returns null without a config',
    M.createDockToggle(null) === null);
  // No container is fine: the toggle still flips and notifies, the
  // panel just has nowhere to move (a missing tab degrades quietly).
  const button = fakeElement();
  const seen = [];
  const t = M.createDockToggle({
    panel: 'logic', button, container: null, initialSide: 'right',
    onSide: (panel, side) => { seen.push([panel, side]); }
  });
  check('createDockToggle works without a container', t !== null);
  button.fire('click', { preventDefault: () => {} });
  eq('a click without a container still notifies',
    seen, [['logic', 'left']]);
}

// --- side-aware pointer math (hydra-panelresize.js) -----------------------
{
  eq('widthFromPointerLeft is pointer x minus container left',
    PR.widthFromPointerLeft({ left: 0, right: 1400 }, 400), 400);
  eq('widthFromPointerLeft rounds to whole pixels',
    PR.widthFromPointerLeft({ left: 100, right: 1400 }, 500.4), 400);
  eq('widthFromPointerLeft returns null without a rect',
    PR.widthFromPointerLeft(null, 400), null);
  eq('widthFromPointerLeft returns null without a left edge',
    PR.widthFromPointerLeft({}, 400), null);
  eq('widthFromPointerLeft returns null for a non-finite x',
    PR.widthFromPointerLeft({ left: 0, right: 1400 }, NaN), null);
  eq('widthFromPointerForSide measures from the left when docked left',
    PR.widthFromPointerForSide({ left: 0, right: 1400 }, 400, 'left'), 400);
  eq('widthFromPointerForSide measures from the right when docked right',
    PR.widthFromPointerForSide({ left: 0, right: 1400 }, 1000, 'right'), 400);
  eq('widthFromPointerForSide defaults a bad side to the right rule',
    PR.widthFromPointerForSide({ left: 0, right: 1400 }, 1000, 'top'), 400);
  eq('normalizeSide keeps left', PR.normalizeSide('left'), 'left');
  eq('normalizeSide reads garbage as right', PR.normalizeSide('top'), 'right');
}
{
  // A resizer created with side 'left' drags from the left edge, and
  // setSide flips the math live without rebuilding the resizer.
  const store = {};
  const storage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; }
  };
  const handle = fakeElement();
  const container = fakeElement();
  const widths = { scene: 340, logic: 320 };
  // Reuse the panelresize fake-document shape: the resizer listens
  // for pointermove/pointerup on document, so give it a firing one.
  const docListeners = {};
  global.document = {
    addEventListener: function (type, fn) {
      (docListeners[type] = docListeners[type] || []).push(fn);
    },
    removeEventListener: function (type, fn) {
      docListeners[type] = (docListeners[type] || []).filter((f) => f !== fn);
    },
    fire: function (type, ev) {
      (docListeners[type] || []).slice().forEach((fn) => fn(ev || {}));
    }
  };
  const r = PR.createResizer({
    panel: 'scene',
    handle,
    container,
    storage,
    getWidths: () => ({ ...widths }),
    onWidth: (panel, w) => { widths[panel] = w; },
    side: 'left'
  });
  check('createResizer accepts a left side', r !== null && r.getSide() === 'left');
  // Drag the left-docked handle rightward: pointer at x=500 means a
  // 500px panel (left edge 0), from the 340 default.
  handle.fire('pointerdown', { button: 0, pointerId: 1, preventDefault: () => {} });
  global.document.fire('pointermove', { clientX: 500 });
  eq('a left-docked drag widens from the left edge',
    container.style.props['--scene-panel-width'], '500px');
  global.document.fire('pointerup', {});
  // Flip to the right mid-life: the same pointer x now measures from
  // the right edge (1400 - 500 = 900, clamped to the 560 max).
  r.setSide('right');
  eq('setSide flips the resizer to the right', r.getSide(), 'right');
  handle.fire('pointerdown', { button: 0, pointerId: 1, preventDefault: () => {} });
  global.document.fire('pointermove', { clientX: 500 });
  eq('after setSide the same pointer measures from the right edge',
    container.style.props['--scene-panel-width'], '560px');
  global.document.fire('pointerup', {});
  r.destroy();
  delete global.document;
}

// --- markup ---------------------------------------------------------------
{
  check('index.html loads the panel-dock module after panel-resize and before script.js',
    INDEX_HTML.indexOf('hydra-paneldock.js') > INDEX_HTML.indexOf('hydra-panelresize.js') &&
    INDEX_HTML.indexOf('hydra-paneldock.js') < INDEX_HTML.indexOf('script.js?'));
  check('scene dock button exists in the scene toolbar with a named action',
    INDEX_HTML.includes('id="scene-panel-dock-btn"') &&
    INDEX_HTML.includes('title="Dock inspector panel on the left"') &&
    INDEX_HTML.includes('aria-label="Dock inspector panel on the left"'));
  check('scene dock button sits in the toolbar after the delete button',
    INDEX_HTML.indexOf('id="scene-panel-dock-btn"') > INDEX_HTML.indexOf('id="scene-delete-btn"') &&
    INDEX_HTML.indexOf('id="scene-panel-dock-btn"') < INDEX_HTML.indexOf('id="scene-panel-resizer"'));
  check('logic dock button exists in the command bar with a named action and visible label',
    INDEX_HTML.includes('id="logic-panel-dock-btn"') &&
    INDEX_HTML.includes('title="Dock block panel on the left"') &&
    INDEX_HTML.includes('aria-label="Dock block panel on the left"') &&
    INDEX_HTML.includes('<span>Dock left</span>'));
  check('logic dock button sits after the block search',
    INDEX_HTML.indexOf('id="logic-panel-dock-btn"') > INDEX_HTML.indexOf('id="block-search"') &&
    INDEX_HTML.indexOf('id="logic-panel-dock-btn"') < INDEX_HTML.indexOf('id="grid"'));
}

// --- styles ---------------------------------------------------------------
{
  check('left-docked scene stage insets from the left',
    /\.scene-editor\[data-panel-side="left"\] \.scene-container\s*\{[^}]*inset:\s*44px 0 0 var\(--scene-panel-width\);/s.test(STYLE_CSS));
  check('left-docked scene toolbar insets from the left',
    /\.scene-editor\[data-panel-side="left"\] \.scene-toolbar\s*\{[^}]*left:\s*var\(--scene-panel-width\);[^}]*right:\s*0;/s.test(STYLE_CSS));
  check('left-docked scene panel hangs off the left edge with a right border',
    /\.scene-editor\[data-panel-side="left"\] \.scene-side-panel\s*\{[^}]*left:\s*0;[^}]*right:\s*auto;[^}]*border-right:\s*1px solid var\(--border-color\);/s.test(STYLE_CSS));
  check('left-docked scene resizer sits on the panel right edge',
    /\.scene-editor\[data-panel-side="left"\] #scene-panel-resizer\s*\{[^}]*left:\s*calc\(var\(--scene-panel-width\) - 3px\);[^}]*right:\s*auto;/s.test(STYLE_CSS));
  check('left-docked logic grid moves after the panel',
    /\.grid-editor\[data-panel-side="left"\] \.grid-container\s*\{[^}]*order:\s*2;/s.test(STYLE_CSS));
  check('left-docked logic resizer sits between panel and grid',
    /\.grid-editor\[data-panel-side="left"\] #logic-panel-resizer\s*\{[^}]*order:\s*1;/s.test(STYLE_CSS));
  check('left-docked logic panel leads the flex row with a right border',
    /\.grid-editor\[data-panel-side="left"\] \.side-panel\s*\{[^}]*order:\s*0;[^}]*border-right:\s*1px solid #1e293b;/s.test(STYLE_CSS));
  check('logic dock button has an active state',
    /\.logic-tool-btn\.active\s*\{[^}]*background:\s*#4762ae;/s.test(STYLE_CSS));
  check('narrow screens re-assert the stacked layout for a left-docked scene panel',
    /@media \(max-width: 900px\)[\s\S]*?\.scene-editor\[data-panel-side="left"\] \.scene-side-panel\s*\{[^}]*left:\s*0;[^}]*right:\s*0;[^}]*width:\s*auto;/s.test(STYLE_CSS));
  check('narrow screens reset the left-docked logic flex order',
    /@media \(max-width: 900px\)[\s\S]*?\.grid-editor\[data-panel-side="left"\] \.grid-container\s*\{[^}]*order:\s*0;/s.test(STYLE_CSS));
}

// --- script.js wiring ------------------------------------------------------
{
  check('script.js defines initPanelDock',
    /function initPanelDock\(\)/.test(SCRIPT_JS));
  check('initPanelDock reads stored sides through the module',
    /readStoredSides\(window\.localStorage\)/.test(SCRIPT_JS));
  check('initPanelDock applies both sides to their containers',
    /applySide\(sceneEditor, 'scene', panelSides\.scene\)/.test(SCRIPT_JS) &&
    /applySide\(gridEditor, 'logic', panelSides\.logic\)/.test(SCRIPT_JS));
  check('initPanelDock wires both dock buttons through createDockToggle',
    /createDockToggle\(\{\s*panel: 'scene'/.test(SCRIPT_JS) &&
    /createDockToggle\(\{\s*panel: 'logic'/.test(SCRIPT_JS));
  check('the side change flips the resizer drag math and persists',
    /setSide\(side\)/.test(SCRIPT_JS) &&
    /writeStoredSides\(window\.localStorage, panelSides\)/.test(SCRIPT_JS));
  check('initPanelDock runs at editor load before the resizers',
    SCRIPT_JS.indexOf('initPanelDock();') > 0 &&
    SCRIPT_JS.indexOf('initPanelDock();') < SCRIPT_JS.indexOf('initPanelResizers();'));
  check('initPanelDock is exposed on window like initPanelResizers',
    /window\.initPanelDock = initPanelDock;/.test(SCRIPT_JS));
  check('resizers start with the stored side and their handles are kept',
    /panelResizers\.scene = PR\.createResizer/.test(SCRIPT_JS) &&
    /panelResizers\.logic = PR\.createResizer/.test(SCRIPT_JS) &&
    /side: panelSides\.scene/.test(SCRIPT_JS) &&
    /side: panelSides\.logic/.test(SCRIPT_JS));
  check('panel-dock wiring never throws out of its own try block',
    /function initPanelDock\(\) \{\s*try \{/.test(SCRIPT_JS));
}

// --- docs ------------------------------------------------------------------
{
  check('user guide documents dockable panels (button, persist, handle follows)',
    GUIDE.includes('**Dockable panels:**') &&
    GUIDE.includes('Dock button') &&
    GUIDE.includes('saved in your browser') &&
    GUIDE.includes('resize handle moves with it'));
}

if (failures) { console.log(`${failures} check(s) failed`); process.exit(1); }
console.log('paneldock.test.js: all checks passed');
