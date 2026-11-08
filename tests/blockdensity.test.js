// Unit tests for the P5-8 slice c compact-density option for blocks —
// the "Compact blocks" toggle in the Logic tab's command bar shrinks
// the logic-grid cells from 56px to 44px, with the choice persisted
// per browser in localStorage.
//
// Covers the three layers: the pure helpers in hydra-blockdensity.js
// (normalize / opposite / cell size / parse / serialize / storage /
// apply / button labels), the createDensityToggle DOM wiring
// (fake-DOM click, persistence callback, destroy), and the markup +
// styles + script.js wiring + docs pins.

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
  path.join(__dirname, '..', 'hydra', 'hydra-blockdensity.js'), 'utf8');
const GUIDE = fs.readFileSync(
  path.join(__dirname, '..', 'docs', 'user-guide.md'), 'utf8');
const factory = require(path.join(__dirname, '..', 'hydra', 'hydra-blockdensity.js'));
const M = factory();

// --- constants ------------------------------------------------------------
eq('comfortable is the default density', M.DEFAULT_DENSITY, 'comfortable');
eq('cell sizes are 56px comfortable, 44px compact', M.CELL_SIZE,
  { comfortable: 56, compact: 44 });
check('storage key is versioned', M.STORAGE_KEY === 'hydra.blockDensity.v1');

// --- normalizeDensity / oppositeDensity / cellSize -------------------------
eq("normalizeDensity keeps 'compact'", M.normalizeDensity('compact'), 'compact');
eq("normalizeDensity keeps 'comfortable'", M.normalizeDensity('comfortable'), 'comfortable');
eq('normalizeDensity reads garbage as comfortable', M.normalizeDensity('dense'), 'comfortable');
eq('normalizeDensity reads null as comfortable', M.normalizeDensity(null), 'comfortable');
eq("oppositeDensity of 'compact' is 'comfortable'", M.oppositeDensity('compact'), 'comfortable');
eq("oppositeDensity of 'comfortable' is 'compact'", M.oppositeDensity('comfortable'), 'compact');
eq('oppositeDensity of garbage is compact', M.oppositeDensity('dense'), 'compact');
eq('cellSize of compact is 44', M.cellSize('compact'), 44);
eq('cellSize of comfortable is 56', M.cellSize('comfortable'), 56);
eq('cellSize of garbage is 56', M.cellSize('dense'), 56);

// --- parseStoredDensity / serializeDensity ---------------------------------
eq('parseStoredDensity accepts compact', M.parseStoredDensity('compact'), 'compact');
eq('parseStoredDensity accepts comfortable', M.parseStoredDensity('comfortable'), 'comfortable');
eq('parseStoredDensity trims surrounding whitespace',
  M.parseStoredDensity('  compact  '), 'compact');
eq('parseStoredDensity degrades garbage to the default',
  M.parseStoredDensity('dense'), 'comfortable');
eq('parseStoredDensity degrades an empty string to the default',
  M.parseStoredDensity(''), 'comfortable');
eq('parseStoredDensity degrades a non-string to the default',
  M.parseStoredDensity(null), 'comfortable');
eq('serializeDensity round-trips through parseStoredDensity',
  M.parseStoredDensity(M.serializeDensity('compact')), 'compact');
eq('serializeDensity normalizes before storing',
  M.parseStoredDensity(M.serializeDensity('dense')), 'comfortable');

// --- storage helpers ------------------------------------------------------
{
  const store = {};
  const storage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; }
  };
  eq('readStoredDensity returns the default with empty storage',
    M.readStoredDensity(storage), 'comfortable');
  check('writeStoredDensity stores the value under the versioned key',
    M.writeStoredDensity(storage, 'compact') === true &&
    store['hydra.blockDensity.v1'] === 'compact',
    store['hydra.blockDensity.v1']);
  eq('readStoredDensity reads back what was written',
    M.readStoredDensity(storage), 'compact');
  eq('readStoredDensity degrades a missing storage object to the default',
    M.readStoredDensity(null), 'comfortable');
  const throwing = {
    getItem: () => { throw new Error('denied'); },
    setItem: () => { throw new Error('denied'); }
  };
  eq('readStoredDensity degrades a throwing storage to the default',
    M.readStoredDensity(throwing), 'comfortable');
  check('writeStoredDensity reports false on a throwing storage',
    M.writeStoredDensity(throwing, 'compact') === false);
}

// --- fake DOM -------------------------------------------------------------
// Minimal stand-ins: an element records listeners, attributes, and
// classes so the test can fire clicks by hand.
function fakeElement() {
  const listeners = {};
  const classes = new Set();
  const el = {
    attrs: {},
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
    listenerCount: function (type) { return (listeners[type] || []).length; }
  };
  return el;
}

// --- applyDensity ---------------------------------------------------------
{
  const container = fakeElement();
  eq('applyDensity sets data-block-density on the container',
    M.applyDensity(container, 'compact'), 'compact');
  check('applyDensity wrote the attribute',
    container.attrs['data-block-density'] === 'compact');
  eq('applyDensity normalizes a bad density to comfortable',
    M.applyDensity(container, 'dense'), 'comfortable');
  check('applyDensity returns null without a container',
    M.applyDensity(null, 'compact') === null);
}

// --- updateDensityButton --------------------------------------------------
{
  const button = fakeElement();
  button.children.span = { textContent: 'Compact blocks' };
  eq('updateDensityButton names the next action while comfortable',
    M.updateDensityButton(button, 'comfortable'), 'comfortable');
  check('button title says Compact blocks while comfortable',
    button.attrs.title === 'Compact blocks', button.attrs.title);
  check('button aria-label matches the title',
    button.attrs['aria-label'] === 'Compact blocks');
  check('button is not active while comfortable',
    !button.classList.contains('active'));
  check('visible label says Compact blocks',
    button.children.span.textContent === 'Compact blocks');

  eq('updateDensityButton names the next action while compact',
    M.updateDensityButton(button, 'compact'), 'compact');
  check('button title says Comfortable blocks while compact',
    button.attrs.title === 'Comfortable blocks', button.attrs.title);
  check('button is active while compact',
    button.classList.contains('active'));
  check('visible label says Comfortable blocks',
    button.children.span.textContent === 'Comfortable blocks');

  // An icon-only button (no label span) still updates cleanly.
  const iconButton = fakeElement();
  eq('updateDensityButton works without a label span',
    M.updateDensityButton(iconButton, 'compact'), 'compact');
  check('icon button title still names the action',
    iconButton.attrs.title === 'Comfortable blocks');
  check('updateDensityButton returns null without a button',
    M.updateDensityButton(null, 'compact') === null);
}

// --- createDensityToggle (fake DOM) ---------------------------------------
{
  const container = fakeElement();
  const button = fakeElement();
  button.children.span = { textContent: 'Compact blocks' };
  const seen = [];
  const t = M.createDensityToggle({
    button,
    container,
    initialDensity: 'comfortable',
    onDensity: (density) => { seen.push(density); }
  });
  check('createDensityToggle returns a toggle for a valid config', t !== null);
  eq('toggle starts on the initial density', t.getDensity(), 'comfortable');
  check('toggle applies the initial density to the container',
    container.attrs['data-block-density'] === 'comfortable');
  check('toggle labels the button for the next action',
    button.attrs.title === 'Compact blocks');

  // Click: flips to compact, moves the container, relabels, notifies.
  button.fire('click', { preventDefault: () => {} });
  eq('click flips the toggle to compact', t.getDensity(), 'compact');
  check('click moves the container to compact',
    container.attrs['data-block-density'] === 'compact');
  check('click relabels the button to Comfortable blocks',
    button.attrs.title === 'Comfortable blocks');
  check('click marks the button active',
    button.classList.contains('active'));
  eq('click notifies the host once', seen, ['compact']);

  // Click again: back to comfortable.
  button.fire('click', { preventDefault: () => {} });
  eq('a second click flips back to comfortable', t.getDensity(), 'comfortable');
  eq('second click notifies the host again',
    seen, ['compact', 'comfortable']);

  // setDensity drives the density without notifying (the host's
  // silent path).
  t.setDensity('compact');
  eq('setDensity drives the toggle to compact', t.getDensity(), 'compact');
  check('setDensity moves the container',
    container.attrs['data-block-density'] === 'compact');
  eq('setDensity does not notify the host',
    seen, ['compact', 'comfortable']);

  // destroy() detaches the click listener.
  const before = button.listenerCount('click');
  t.destroy();
  check('destroy detaches the click listener',
    before === 1 && button.listenerCount('click') === 0);
  button.fire('click', { preventDefault: () => {} });
  eq('a click after destroy changes nothing', t.getDensity(), 'compact');
}
{
  check('createDensityToggle returns null without a button',
    M.createDensityToggle({ button: null, container: fakeElement() }) === null);
  check('createDensityToggle returns null without a config',
    M.createDensityToggle(null) === null);
  // No container is fine: the toggle still flips and notifies, the
  // grid just has nowhere to move (a missing tab degrades quietly).
  const button = fakeElement();
  const seen = [];
  const t = M.createDensityToggle({
    button, container: null, initialDensity: 'comfortable',
    onDensity: (density) => { seen.push(density); }
  });
  check('createDensityToggle works without a container', t !== null);
  button.fire('click', { preventDefault: () => {} });
  eq('a click without a container still notifies', seen, ['compact']);
}

// --- module surface -------------------------------------------------------
check('factorySource is exposed on window for export inlining',
  MODULE_SRC.includes('window.HydraBlockDensity.factorySource = hydraBlockDensityFactory.toString()'));
check('module source carries the P5-8 slice c header',
  MODULE_SRC.includes('P5-8') && MODULE_SRC.includes('slice c'));

// --- styles ---------------------------------------------------------------
// The comfortable defaults are pinned so a later edit cannot silently
// change the grid everyone already knows.
check('comfortable default: grid background is 56px',
  STYLE_CSS.includes('background-size: 56px 56px;'));
check('comfortable default: grid template is 56px cells',
  STYLE_CSS.includes('grid-template-columns: repeat(60, 56px);') &&
  STYLE_CSS.includes('grid-template-rows: repeat(60, 56px);'));
check('comfortable default: cells are 56px',
  /\.cell \{\s*\n\s*width: 56px; height: 56px;/.test(STYLE_CSS));
// The compact overrides all move together off the one attribute.
check('compact: background grid lines shrink to 44px',
  STYLE_CSS.includes('.grid-editor[data-block-density="compact"] .grid-container') &&
  STYLE_CSS.includes('background-size: 44px 44px;'));
check('compact: grid template is 44px cells',
  STYLE_CSS.includes('.grid-editor[data-block-density="compact"] .grid') &&
  STYLE_CSS.includes('grid-template-columns: repeat(60, 44px);') &&
  STYLE_CSS.includes('grid-template-rows: repeat(60, 44px);'));
check('compact: cells are 44px',
  STYLE_CSS.includes('.grid-editor[data-block-density="compact"] .cell') &&
  STYLE_CSS.includes('width: 44px; height: 44px;'));
check('compact: block labels shrink to 8px on a 34px label',
  STYLE_CSS.includes('.grid-editor[data-block-density="compact"] .cell::after') &&
  STYLE_CSS.includes('font-size: 8px;') &&
  STYLE_CSS.includes('width: 34px;'));
check('compact: data-block-label labels also shrink to 8px',
  STYLE_CSS.includes('.grid-editor[data-block-density="compact"] .cell[data-block-label]::after'));
check('puzzle SVG fills its cell at either density (no 12px spill in compact)',
  /\.cell\.puzzle-block \.puzzle-shape \{[^}]*width: 100%; height: 100%;/s.test(STYLE_CSS));

// --- markup ---------------------------------------------------------------
check('index.html has the density toggle button in the command bar',
  INDEX_HTML.includes('id="block-density-btn"'));
check('density button starts labeled Compact blocks',
  INDEX_HTML.includes('id="block-density-btn"') &&
  /id="block-density-btn"[^>]*><i class="fas fa-compress"><\/i> <span>Compact blocks<\/span>/.test(INDEX_HTML));
check('index.html loads the block-density module after the paneldock module',
  INDEX_HTML.indexOf('hydra-paneldock.js') !== -1 &&
  INDEX_HTML.indexOf('hydra-blockdensity.js') !== -1 &&
  INDEX_HTML.indexOf('hydra-paneldock.js') < INDEX_HTML.indexOf('hydra-blockdensity.js'));

// --- script.js wiring -----------------------------------------------------
check('script.js defines initBlockDensity',
  SCRIPT_JS.includes('function initBlockDensity()'));
check('script.js calls initBlockDensity at editor load',
  SCRIPT_JS.includes("if (typeof initBlockDensity === 'function') initBlockDensity();"));
check('script.js restores the stored density from localStorage',
  SCRIPT_JS.includes('BD.readStoredDensity(window.localStorage)'));
check('script.js persists the density on change',
  SCRIPT_JS.includes('BD.writeStoredDensity(window.localStorage, blockDensity)'));
check('script.js applies the density to the grid editor',
  SCRIPT_JS.includes("BD.applyDensity(gridEditor, blockDensity)"));
check('script.js exposes initBlockDensity on window',
  SCRIPT_JS.includes('window.initBlockDensity = initBlockDensity;'));

// --- docs -----------------------------------------------------------------
check('user guide documents the Compact blocks toggle',
  GUIDE.includes('Compact blocks') && GUIDE.includes('44px'));

if (failures > 0) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
