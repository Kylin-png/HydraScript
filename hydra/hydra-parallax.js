/* ============================================================================
 * hydra-parallax.js — HydraScript shared parallax backgrounds
 * (P4 Advanced batch 16: depth without a 3D scene, beginner edition).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation
 * of how an object scrolls relative to the camera — used by:
 *   - the editor preview runtime (hydra-previewruntime.js delegates
 *     to it, and script.js draws through it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Idea (Unity ParallaxBackground / Godot ParallaxBackground +
 * ParallaxLayer, beginner edition): a flat scene looks flat because
 * everything moves with the camera at the same speed. Give each object
 * a scroll factor and the layers separate: a sky that never scrolls, hills
 * that drift at half speed, a foreground that rushes past.
 *
 *   parallaxX / parallaxY — 0..2 per axis, 1 is the old behavior.
 *     0 pins the object to the camera (it never scrolls, like a sky or
 *     a far mountain range); 0.5 moves at half speed (distant hills);
 *     1 moves with the world (the player, the ground); above 1 moves
 *     faster than the world (a foreground bush rushing past). The two
 *     axes are independent, so a layer can scroll sideways only.
 *
 * The factors live on the object (`obj.parallaxX`, `obj.parallaxY`),
 * set in the Inspector Parallax section; the Set Parallax block changes
 * them while the game runs, and Parallax Factor reads them back. The
 * draw module asks this module for the camera to draw each object
 * against (parallaxCamera): the object's screen position is its world
 * position minus the camera times its factor, so the object itself
 * never moves — only where it draws. That is the whole design, and it
 * is deliberately the same shape as the sprite-transform batch
 * (flip/scale): a drawing-only transform.
 *
 * Because only the drawing moves, physics, collision, and the object's
 * world position never change — a parallax hill cannot be collided with
 * where it appears on screen, so keep parallax on decoration layers.
 * Clicks and button hover DO follow the drawn position: the hit test
 * and the preview's per-frame hover math ask this module for the same
 * parallax camera, so a parallax button still clicks where it shows.
 * Screen-fixed objects (HUD, anchored widgets) skip the camera
 * entirely, so the factor never applies to them — the draw module only
 * asks for a parallax camera when the object is not screen-fixed.
 * 3D kinds and lights ignore the factors (the 3D pass and the light
 * projection use world positions).
 *
 * Nothing ever throws; hostile input degrades to safe defaults.
 * Old objects have no parallax fields and behave exactly as before
 * (factor 1 on both axes — the world speed they always had).
 *
 * Honest limits: drawing-only (collision and physics keep the world
 * position); 2D objects only; no repeating or tiled background fill —
 * a layer is a wide sprite you place yourself; there is no hs
 * script-API surface yet.
 *
 * Load order (index.html): hydra-parallax.js BEFORE player-runtime.js
 * and script.js. player-runtime.js throws a clear error if
 * HydraParallax is missing.
 * ========================================================================== */

function hydraParallaxFactory() {
  'use strict';

  var DEFAULT_FACTOR = 1;
  var MAX_FACTOR = 2;

  // A usable number, or the fallback when the value is not one.
  // null / undefined / '' count as missing (Number(null) is 0, which
  // would silently read as a real value instead of the fallback).
  function saneNum(v, fallback) {
    if (v == null || v === '') return fallback;
    var n = Number(v);
    return isFinite(n) ? n : fallback;
  }

  function clamp(v, lo, hi) {
    if (!isFinite(v)) return lo;
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
  }

  // One parallax factor: 0..2. 0 pins to the camera, 1 is world speed,
  // 2 is the fastest foreground. Non-numeric reads as 1 — a typo moves
  // with the world instead of pinning or vanishing off-screen. A
  // missing value (null / undefined / '') reads as 1 too: Number(null)
  // is 0, which would silently pin the layer instead of leaving it at
  // world speed.
  function normalizeParallaxFactor(value) {
    if (value == null || value === '') return DEFAULT_FACTOR;
    var n = Number(value);
    if (!isFinite(n)) return DEFAULT_FACTOR;
    return clamp(n, 0, MAX_FACTOR);
  }

  // Normalize an object's parallax factors IN PLACE — the record keeps
  // its identity across calls, so the Inspector holds the live object
  // while it renders (the high-score lesson). A missing or wrong-shaped
  // object reads as the default; a bad factor falls back to 1 (world
  // speed). Never throws.
  function normalizeParallax(obj) {
    try {
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        return { parallaxX: DEFAULT_FACTOR, parallaxY: DEFAULT_FACTOR };
      }
      obj.parallaxX = normalizeParallaxFactor(obj.parallaxX);
      obj.parallaxY = normalizeParallaxFactor(obj.parallaxY);
      return obj;
    } catch (err) {
      return { parallaxX: DEFAULT_FACTOR, parallaxY: DEFAULT_FACTOR };
    }
  }

  // The factors of an object, as a fresh { x, y } record. A missing
  // factor reads as 1 (world speed), so old objects and objects whose
  // fields were never normalized read exactly as before. Never throws.
  function parallaxOf(obj) {
    try {
      if (!obj || typeof obj !== 'object') {
        return { x: DEFAULT_FACTOR, y: DEFAULT_FACTOR };
      }
      return {
        x: normalizeParallaxFactor(obj.parallaxX),
        y: normalizeParallaxFactor(obj.parallaxY)
      };
    } catch (err) {
      return { x: DEFAULT_FACTOR, y: DEFAULT_FACTOR };
    }
  }

  // The camera an object draws (and clicks) against: the live camera
  // with each axis scaled by the object's factor, zoom untouched. A
  // fresh record every call — no caller can alias the host's camera.
  // A missing camera reads as the origin; a missing object reads the
  // camera unchanged. Never throws.
  function parallaxCamera(cam, obj) {
    try {
      var cx = 0;
      var cy = 0;
      var z = 1;
      try { cx = saneNum(cam && cam.x, 0); } catch (e) { cx = 0; }
      try { cy = saneNum(cam && cam.y, 0); } catch (e) { cy = 0; }
      try { z = saneNum(cam && cam.zoom, 1); } catch (e) { z = 1; }
      var f = parallaxOf(obj);
      return { x: cx * f.x, y: cy * f.y, zoom: z };
    } catch (err) {
      return { x: 0, y: 0, zoom: 1 };
    }
  }

  function isParallaxAction(type) {
    return type === 'setParallax';
  }

  function isParallaxCondition(type) {
    return type === 'parallaxFactor';
  }

  return {
    DEFAULT_FACTOR: DEFAULT_FACTOR,
    MAX_FACTOR: MAX_FACTOR,
    normalizeParallaxFactor: normalizeParallaxFactor,
    normalizeParallax: normalizeParallax,
    parallaxOf: parallaxOf,
    parallaxCamera: parallaxCamera,
    isParallaxAction: isParallaxAction,
    isParallaxCondition: isParallaxCondition
  };
}

if (typeof window !== 'undefined') {
  window.HydraParallax = hydraParallaxFactory();
  // Self-contained source of the factory, inlined into exported playable games
  // by HydraPlayer.buildPlayableHtml so exports run without editor files.
  window.HydraParallax.factorySource = hydraParallaxFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraParallaxFactory;
