// Unit tests for the Apply Force arrow direction (queued by Ky'lin,
// Nov 7, 2026 — the last of the three force-arrow / device-squeeze
// brief items): the arrow on a placed Apply Force block rotates to
// the force direction, atan2(forceY, forceX) in screen coords (Y
// down), and stays generic when X or Y holds an expression.
//
// Covers the three layers: the pure helpers in hydra-forcearrow.js
// (parse / angle / block check / rotate transform), the script.js
// wiring (conceptBlockSVG takes an angle and wraps only the Apply
// Force icon, applyBlockVisualToCell reads the cell's own data, the
// property panel re-renders the cell when X/Y change, placing sets
// defaults before drawing), and the markup + docs pins.

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
const SCRIPT_JS = fs.readFileSync(
  path.join(__dirname, '..', 'hydra', 'script.js'), 'utf8');
const MODULE_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'hydra', 'hydra-forcearrow.js'), 'utf8');
const BLOCK_REF = fs.readFileSync(
  path.join(__dirname, '..', 'docs', 'block-reference.md'), 'utf8');
const factory = require(path.join(__dirname, '..', 'hydra', 'hydra-forcearrow.js'));
const M = factory();

// --- module surface -------------------------------------------------------
check('module exposes the angle API', typeof M.angleDeg === 'function' &&
  typeof M.toNumber === 'function' && typeof M.isForceBlock === 'function' &&
  typeof M.angleForBlock === 'function' && typeof M.rotateTransform === 'function');
eq('icon center is 28 (the 56x56 viewBox center)', M.ICON_CENTER, 28);
check('factorySource pin: the module carries its factory source',
  MODULE_SRC.includes('window.HydraForceArrow.factorySource = hydraForceArrowFactory.toString()'));

// --- toNumber: numbers and numeric strings count, expressions do not -----
eq('toNumber passes a plain number through', M.toNumber(5), 5);
eq('toNumber passes a negative number through', M.toNumber(-100), -100);
eq('toNumber parses a numeric string', M.toNumber(' -100 '), -100);
eq('toNumber parses a decimal string', M.toNumber('0.9'), 0.9);
eq('toNumber rejects an expression', M.toNumber('5 or speed'), null);
eq('toNumber rejects a variable name', M.toNumber('speed'), null);
eq('toNumber rejects a blank string', M.toNumber('  '), null);
eq('toNumber rejects null/undefined', M.toNumber(null), null);
check('toNumber rejects null/undefined (undefined)', M.toNumber(undefined) === null);
eq('toNumber rejects NaN', M.toNumber(NaN), null);
eq('toNumber rejects Infinity', M.toNumber(Infinity), null);
eq('toNumber rejects a boolean', M.toNumber(true), null);

// --- angleDeg: the spec examples, screen coords, Y down ------------------
eq('angleDeg: +X right is 0', M.angleDeg(100, 0), 0);
eq('angleDeg: -X left is 180', M.angleDeg(-100, 0), 180);
eq('angleDeg: +Y down is 90', M.angleDeg(0, 100), 90);
eq('angleDeg: -Y up is -90', M.angleDeg(0, -100), -90);
eq('angleDeg: +X+Y down-right is 45', M.angleDeg(100, 100), 45);
eq('angleDeg: +X-Y up-right is -45', M.angleDeg(100, -100), -45);
eq('angleDeg: -X+Y down-left is 135', M.angleDeg(-100, 100), 135);
eq('angleDeg: -X-Y up-left is -135', M.angleDeg(-100, -100), -135);
eq('angleDeg: a small diagonal rounds to 2 decimals', M.angleDeg(1, 1), 45);
eq('angleDeg: 1,2 is atan2, not a quadrant snap', M.angleDeg(1, 2), 63.43);
eq('angleDeg: string numbers work', M.angleDeg('-100', '0'), 180);
eq('angleDeg: an expression X has no angle', M.angleDeg('5 or speed', 0), null);
eq('angleDeg: an expression Y has no angle', M.angleDeg(5, '0 or -jump'), null);
eq('angleDeg: a zero force has no direction', M.angleDeg(0, 0), null);
eq('angleDeg: zero force as strings has no direction', M.angleDeg('0', '0'), null);
eq('angleDeg: a missing component has no angle', M.angleDeg(undefined, 0), null);
eq('angleDeg: NaN has no angle', M.angleDeg(NaN, 0), null);
eq('angleDeg: Infinity has no angle', M.angleDeg(Infinity, 0), null);

// --- isForceBlock / angleForBlock -----------------------------------------
check('isForceBlock: applyForce data is a force block',
  M.isForceBlock({ type: 'applyForce', forceX: 5, forceY: 0 }));
check('isForceBlock: another type is not', !M.isForceBlock({ type: 'teleport' }));
check('isForceBlock: no data is not', !M.isForceBlock(null));
eq('angleForBlock: a force block reads its angle',
  M.angleForBlock({ type: 'applyForce', forceX: -100, forceY: 100 }), 135);
eq('angleForBlock: a non-force block has no angle',
  M.angleForBlock({ type: 'teleport', forceX: -100, forceY: 100 }), null);
eq('angleForBlock: an expression force has no angle',
  M.angleForBlock({ type: 'applyForce', forceX: 'speed', forceY: 0 }), null);
eq('angleForBlock: the default force (5, 0) points right',
  M.angleForBlock({ type: 'applyForce', forceX: 5, forceY: 0 }), 0);

// --- rotateTransform --------------------------------------------------------
eq('rotateTransform pivots on the icon center', M.rotateTransform(45), 'rotate(45 28 28)');
eq('rotateTransform keeps a negative angle', M.rotateTransform(-90), 'rotate(-90 28 28)');
eq('rotateTransform keeps 180', M.rotateTransform(180), 'rotate(180 28 28)');
eq('rotateTransform is empty without an angle', M.rotateTransform(null), '');
eq('rotateTransform is empty for undefined', M.rotateTransform(undefined), '');
eq('rotateTransform is empty for NaN', M.rotateTransform(NaN), '');

// --- script.js wiring -------------------------------------------------------
check('conceptBlockSVG takes the optional angle parameter',
  /function conceptBlockSVG\(blockType, color, label, sides, iconAngleDeg\)/.test(SCRIPT_JS));
check('conceptBlockSVG wraps only the Apply Force icon in a rotate group',
  SCRIPT_JS.includes('<g transform="rotate(${iconAngleDeg} 28 28)">${icon}</g>') &&
  /trim\(\)\.toLowerCase\(\) === 'apply force'/.test(SCRIPT_JS));
check('conceptBlockSVG still falls back to the default arrow without an angle',
  SCRIPT_JS.includes('Number.isFinite(iconAngleDeg)'));
check('applyBlockVisualToCell reads the angle from the cell data via HydraForceArrow',
  SCRIPT_JS.includes('FA.angleForBlock(cellData.get(idx))') &&
  SCRIPT_JS.includes('conceptBlockSVG(blockType, color, label, conceptSidesForCell(cell), forceAngle)'));
check('applyBlockVisualToCell guards a missing HydraForceArrow module',
  /window\.HydraForceArrow/.test(SCRIPT_JS) && SCRIPT_JS.includes('forceAngle = null'));
check('placing a block sets its defaults before drawing (the arrow reads them)',
  (() => {
    const i = SCRIPT_JS.indexOf("if (!cellData.has(i)) initCellDefaults(i, selectedBlockType);");
    const j = SCRIPT_JS.indexOf('applyBlockVisualToCell(cell, selectedBlockType);', i);
    return i !== -1 && j !== -1 && j > i;
  })());
check('the Apply Force panel re-renders the cell when X changes',
  SCRIPT_JS.includes("data.forceX = v; cellData.set(cellIndex, data); refreshForceArrow(cellIndex);"));
check('the Apply Force panel re-renders the cell when Y changes',
  SCRIPT_JS.includes("data.forceY = v; cellData.set(cellIndex, data); refreshForceArrow(cellIndex);"));
check('refreshForceArrow re-renders only a placed cell',
  /function refreshForceArrow\(cellIndex\) \{\s*const cell = cells\[cellIndex\];\s*if \(cell && cell\.dataset\.blockType\) applyBlockVisualToCell\(cell, cell\.dataset\.blockType\);\s*\}/.test(SCRIPT_JS));

// --- markup -----------------------------------------------------------------
check('index.html loads hydra-forcearrow.js',
  INDEX_HTML.includes('<script src="hydra-forcearrow.js?v=20261107-forcearrow1"></script>'));
check('index.html loads it after the other editor modules',
  INDEX_HTML.indexOf('hydra-forcearrow.js') > INDEX_HTML.indexOf('hydra-outliner.js'));

// --- docs -------------------------------------------------------------------
check('block reference says the arrow points in the force direction',
  BLOCK_REF.includes('the block\'s arrow points in the force\'s direction') &&
  BLOCK_REF.includes('When X or Y holds an expression instead of a number, the arrow stays pointing right'));

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log('forcearrow.test.js: all checks passed');
