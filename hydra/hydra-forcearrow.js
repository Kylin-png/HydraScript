/* ============================================================================
 * hydra-forcearrow.js — HydraScript Apply Force arrow direction
 * (queued by Ky'lin, Nov 7, 2026 — the last of the three force-arrow /
 * device-squeeze brief items: the Apply Force block's arrow rotates to
 * the force direction).
 *
 * Pure logic, no other HydraScript dependency. Used by the editor
 * (script.js applyBlockVisualToCell / conceptBlockSVG); the exported
 * standalone game has no editor grid, so nothing here is inlined into
 * exports.
 *
 * Idea: the arrow on a placed Apply Force block points where the force
 * points, so the grid reads at a glance — right for +X, left for -X,
 * down for +Y, up for -Y, diagonally for a mix. The angle is
 * atan2(forceY, forceX) in screen coords (Y down), so the SVG rotate
 * that draws it is clockwise-positive, exactly like atan2 with Y down.
 * A force of (100, 100) points down-right at 45 degrees; (-100, 0)
 * points left at 180; (0, -100) points up at -90.
 *
 * Two honest fallbacks, both of which keep the default right-pointing
 * arrow: X or Y holding an expression instead of a number ("5 or
 * speed") cannot give a static angle, so the arrow stays generic;
 * and a zero force (0, 0) has no direction at all. The palette icon
 * has no block data behind it, so it stays generic too — only a
 * placed block with numeric X/Y rotates.
 *
 * Nothing ever throws; hostile input degrades to no angle (null).
 * ========================================================================== */

function hydraForceArrowFactory() {
  'use strict';

  // The center of the block icon in the 56x56 viewBox, which the SVG
  // rotate transform pivots around.
  var ICON_CENTER = 28;

  // Parse one force component: a number, or a string that is exactly
  // a number ("-100", " 5 "). Anything else — an expression like
  // "5 or speed", a blank, null, NaN, Infinity — reads as no number.
  function toNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
      var t = value.trim();
      if (t === '') return null;
      var n = Number(t);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  // The arrow angle in degrees for a force (forceX, forceY), screen
  // coords with Y down: +X right is 0, +Y down is 90, -X left is 180,
  // -Y up is -90, mixed X+Y is diagonal. Rounded to 2 decimals so
  // the SVG attribute stays tidy (-180 normalizes to 180, -0 to 0).
  // Returns null when there is no direction: a non-numeric component,
  // or a zero force (0, 0).
  function angleDeg(forceX, forceY) {
    var x = toNumber(forceX);
    var y = toNumber(forceY);
    if (x === null || y === null || (x === 0 && y === 0)) return null;
    var deg = Math.atan2(y, x) * 180 / Math.PI;
    deg = Math.round(deg * 100) / 100;
    if (deg === 0) deg = 0;
    if (deg === -180) deg = 180;
    return deg;
  }

  // True when the stored block data is an Apply Force block. The grid
  // block class is the legacy 'action'; the data type is 'applyForce'.
  function isForceBlock(data) {
    return !!data && data.type === 'applyForce';
  }

  // The arrow angle for one stored block's data, or null when the
  // block is not an Apply Force block or its force has no direction.
  function angleForBlock(data) {
    if (!isForceBlock(data)) return null;
    return angleDeg(data.forceX, data.forceY);
  }

  // The SVG transform that rotates the icon by `angle` degrees about
  // its center, or '' when there is no angle to apply.
  function rotateTransform(angle) {
    if (typeof angle !== 'number' || !Number.isFinite(angle)) return '';
    return 'rotate(' + angle + ' ' + ICON_CENTER + ' ' + ICON_CENTER + ')';
  }

  return {
    ICON_CENTER: ICON_CENTER,
    toNumber: toNumber,
    angleDeg: angleDeg,
    isForceBlock: isForceBlock,
    angleForBlock: angleForBlock,
    rotateTransform: rotateTransform
  };
}

if (typeof window !== 'undefined') window.HydraForceArrow = hydraForceArrowFactory();
if (typeof window !== 'undefined') window.HydraForceArrow.factorySource = hydraForceArrowFactory.toString();
if (typeof module !== 'undefined' && module.exports) module.exports = hydraForceArrowFactory;
