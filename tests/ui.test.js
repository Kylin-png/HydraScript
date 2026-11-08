// Unit tests for hydra/hydra-ui.js — the shared UI-widget helpers (F2).
//
// Pure logic: anchor normalization + resolution, HUD checks, button visual
// state, and field normalization for old/corrupt project data.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const sandbox = {};
sandbox.window = sandbox; // hydra-ui.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-ui.js'), 'utf8'),
  sandbox, { filename: 'hydra-ui.js' });
const U = sandbox.HydraUi;

check('HydraUi exposed with helpers',
  !!U && typeof U.resolveWidgetPosition === 'function' &&
  typeof U.normalizeAnchor === 'function' && typeof U.buttonFillFor === 'function' &&
  typeof U.normalizeUiFields === 'function' && Array.isArray(U.ANCHORS));
check('factorySource is a self-contained function string',
  typeof U.factorySource === 'string' && U.factorySource.includes('resolveWidgetPosition'));
check('10 anchors: none + 9 screen points', U.ANCHORS.length === 10 && U.ANCHORS[0].value === 'none');

// --- anchor normalization ---
check('normalizeAnchor keeps valid anchors', U.normalizeAnchor('top-right') === 'top-right');
check('normalizeAnchor repairs garbage to none',
  U.normalizeAnchor('bogus') === 'none' && U.normalizeAnchor(null) === 'none' &&
  U.normalizeAnchor(undefined) === 'none' && U.normalizeAnchor(42) === 'none');
check('isAnchored false for none/missing', !U.isAnchored({ anchor: 'none' }) && !U.isAnchored({}));
check('isAnchored true for real anchors', U.isAnchored({ anchor: 'bottom-center' }));
check('isHudObject reads the hud flag', U.isHudObject({ hud: true }) && !U.isHudObject({}) && !U.isHudObject({ hud: 'yes' }));
check('isScreenFixed: anchored, hud, and pinned all count',
  U.isScreenFixed({ anchor: 'center' }) && U.isScreenFixed({ hud: true }) &&
  U.isScreenFixed({ uiPinned: true }) && !U.isScreenFixed({}));

// --- anchor resolution (viewport 800x600, widget 100x50) ---
const VW = 800, VH = 600, W = 100, H = 50;
function at(anchor, x, y) {
  return U.resolveWidgetPosition({ anchor, posX: x, posY: y, width: W, height: H }, VW, VH);
}
check('none passes world position through',
  JSON.stringify(at('none', 30, 40)) === JSON.stringify({ x: 30, y: 40 }));
check('top-left with zero offset sits on the corner',
  JSON.stringify(at('top-left', 0, 0)) === JSON.stringify({ x: 0, y: 0 }));
check('top-right with zero offset puts the widget corner on the screen corner',
  JSON.stringify(at('top-right', 0, 0)) === JSON.stringify({ x: 700, y: 0 }));
check('center with zero offset centers the widget',
  JSON.stringify(at('center', 0, 0)) === JSON.stringify({ x: 350, y: 275 }));
check('bottom-left with zero offset',
  JSON.stringify(at('bottom-left', 0, 0)) === JSON.stringify({ x: 0, y: 550 }));
check('offsets shift right/down from the anchor point',
  JSON.stringify(at('top-left', 10, 20)) === JSON.stringify({ x: 10, y: 20 }) &&
  JSON.stringify(at('top-right', -20, 20)) === JSON.stringify({ x: 680, y: 20 }));
check('bottom-center: 20px up from the bottom edge',
  JSON.stringify(at('bottom-center', 0, -20)) === JSON.stringify({ x: 350, y: 530 }));
check('center-left middle',
  JSON.stringify(at('center-left', 0, 0)) === JSON.stringify({ x: 0, y: 275 }));
check('corrupt anchor behaves like none',
  JSON.stringify(U.resolveWidgetPosition({ anchor: 'junk', posX: 5, posY: 6, width: W, height: H }, VW, VH)) ===
  JSON.stringify({ x: 5, y: 6 }));
check('missing width/height treated as zero-size',
  JSON.stringify(U.resolveWidgetPosition({ anchor: 'bottom-right', posX: 0, posY: 0 }, VW, VH)) ===
  JSON.stringify({ x: 800, y: 600 }));

// --- button detection + visuals ---
const btn = { kind: 'text', archetype: 'button', components: [{ type: 'Button' }] };
check('isButton detects palette buttons', U.isButton(btn));
check('isButton rejects plain text', !U.isButton({ kind: 'text', components: [] }));
check('isButton rejects sprites', !U.isButton({ kind: 'sprite', archetype: 'button' }));
check('isPanel detects panels', U.isPanel({ kind: 'panel' }) && U.isPanel({ kind: 'sprite', archetype: 'panel' }));
check('isPanel rejects others', !U.isPanel({ kind: 'sprite' }));

const styled = { kind: 'text', components: [{ type: 'Button' }], buttonStyle: { normal: '#111111', hover: '#222222', pressed: '#333333' }, cornerRadius: 4 };
check('buttonFillFor normal', U.buttonFillFor(styled, 'normal').fill === '#111111');
check('buttonFillFor hover', U.buttonFillFor(styled, 'hover').fill === '#222222');
check('buttonFillFor pressed', U.buttonFillFor(styled, 'pressed').fill === '#333333');
check('buttonFillFor radius', U.buttonFillFor(styled, 'hover').radius === 4);
check('buttonFillFor falls back to defaults on missing style',
  U.buttonFillFor({ kind: 'text', components: [{ type: 'Button' }] }, 'hover').fill === U.DEFAULT_BUTTON_STYLE.normal);
check('buttonFillFor zero radius is honored', U.buttonFillFor({ cornerRadius: 0 }, 'normal').radius === 0);
check('buttonFillFor repairs bad radius', U.buttonFillFor({ cornerRadius: -5 }, 'normal').radius === U.DEFAULT_CORNER_RADIUS);

// --- normalization ---
const legacy = { kind: 'text', archetype: 'button', components: [{ type: 'Button' }], textColor: '#111827' };
U.normalizeUiFields(legacy);
check('normalizeUiFields fills anchor/hud defaults', legacy.anchor === 'none' && legacy.hud === false);
check('normalizeUiFields gives buttons a default style',
  legacy.buttonStyle && legacy.buttonStyle.normal === '#3b82f6' && legacy.buttonStyle.hover === '#60a5fa');
check('normalizeUiFields repairs legacy dark button text to white', legacy.textColor === '#ffffff');
check('normalizeUiFields defaults a missing button text color to white',
  U.normalizeUiFields({ kind: 'text', components: [{ type: 'Button' }] }).textColor === '#ffffff');
const custom = { kind: 'text', archetype: 'button', components: [{ type: 'Button' }], textColor: '#00ff00', anchor: 'junk', hud: 1 };
U.normalizeUiFields(custom);
check('normalizeUiFields keeps a customized button text color', custom.textColor === '#00ff00');
check('normalizeUiFields repairs anchor and coerces hud', custom.anchor === 'none' && custom.hud === false);
const panel = { kind: 'panel' };
U.normalizeUiFields(panel);
check('normalizeUiFields gives panels a corner radius default', panel.cornerRadius === 12);
check('normalizeUiFields never throws on garbage', U.normalizeUiFields(null) === null && U.normalizeUiFields(42) === 42);

if (failures) { console.log(`${failures} FAILURES`); process.exit(1); }
console.log('ui.test.js: all checks passed');
