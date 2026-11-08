/* ============================================================================
 * hydra-camerafeel.js — HydraScript shared camera feel
 * (P4 Advanced batch 15: follow smoothing, deadzone, and camera bounds,
 * beginner edition).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation
 * of how a following camera moves — used by:
 *   - the editor preview runtime (hydra-previewruntime.js delegates
 *     to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Idea (Unity Cinemachine damping + confiner / Godot Camera2D smoothing
 * + drag margins + limits, beginner edition): a camera that snaps to
 * the player every frame feels stiff, and a camera that can wander past
 * the edge of the level shows the void. Three small settings fix both:
 *
 *   smoothing — 0..0.95, how gently the camera chases the target.
 *     0 snaps at once (the old behavior, still the default); 0.9 keeps
 *     90% of the remaining distance each frame, so the camera glides
 *     and settles instead of teleporting. The glide follows the time
 *     scale: at half speed the camera catches up half as fast.
 *   deadzone — a width x height rectangle (world pixels) around the
 *     center of the screen. While the followed object stays inside it
 *     the camera does not move at all, so small hops and idle sways
 *     never shake the view; when the object steps out, the camera
 *     moves just enough to bring it back to the edge. 0 x 0 means no
 *     deadzone (the camera centers the object, the old behavior).
 *   bounds — a world rectangle the camera view stays inside. A room
 *     with walls gets bounds exactly around the room, so the camera
 *     never shows past the level edge. No bounds means the old rule:
 *     the view stays inside the scene's world size.
 *
 * The config lives per scene (`scene.cameraFeel`: { smoothing,
 * deadzoneW, deadzoneH, bounds }), set in Scene Settings; the four
 * Camera blocks change it while the game runs. The live feel is
 * run-level state: it is copied fresh from the scene's config on
 * every scene load (a fresh scene gets its own bounds), so a block
 * that changes the bounds in one level never leaks into the next,
 * and it never travels in save slots (slots store game variables
 * only). Reset Camera restores the scene's feel along with the
 * camera position, zoom, and follow.
 *
 * How the follow works each frame (updateFollowCamera): the anchor is
 * the followed object's center plus the follow offset; the deadzone
 * picks the desired camera position (hold the axis while the anchor
 * is inside the zone, otherwise shift minimally to the zone edge);
 * smoothing glides the camera toward that desired position; the
 * bounds (or the scene edges) clamp the view last. The hosts still
 * run their own scene-edge clamp after this, so a bounds rectangle
 * bigger than the scene behaves like the scene edges.
 *
 * Nothing ever throws; hostile input degrades to safe defaults.
 * Old scenes have no cameraFeel field and behave exactly as before
 * (snap follow, no deadzone, scene-edge clamp).
 *
 * Honest limits: the deadzone is a centered rectangle only (no
 * look-ahead in the direction of movement, no per-axis follow
 * speeds); smoothing is one number for both axes; bounds are one
 * rectangle per scene (no per-room switching except through the
 * Set Camera Bounds block); there is no hs script-API surface yet.
 *
 * Load order (index.html): hydra-camerafeel.js BEFORE player-runtime.js
 * and script.js. player-runtime.js throws a clear error if
 * HydraCameraFeel is missing.
 * ========================================================================== */

function hydraCameraFeelFactory() {
  'use strict';

  var DEFAULT_SMOOTHING = 0;
  var MAX_SMOOTHING = 0.95;
  var DEFAULT_DEADZONE_W = 0;
  var DEFAULT_DEADZONE_H = 0;

  function saneStr(v) {
    return String(v == null ? '' : v);
  }

  function saneName(v) {
    return saneStr(v).trim();
  }

  // A usable number, or the fallback when the value is not one.
  function saneNum(v, fallback) {
    var n = Number(v);
    return isFinite(n) ? n : fallback;
  }

  function clamp(v, lo, hi) {
    if (!isFinite(v)) return lo;
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
  }

  // Follow smoothing: 0..0.95. 0 snaps at once; 0.95 is the slowest
  // glide. 1 would freeze the camera (it would keep 100% of the
  // distance every frame), so it clamps to 0.95. Non-numeric reads
  // as 0 — a typo snaps instead of freezing the view.
  function normalizeSmoothing(value) {
    var n = Number(value);
    if (!isFinite(n)) return DEFAULT_SMOOTHING;
    return clamp(n, 0, MAX_SMOOTHING);
  }

  // A deadzone side in world pixels: a finite number >= 0, else 0
  // (no deadzone on that axis). No upper cap — a zone bigger than
  // the screen simply holds the camera until the object leaves it.
  function normalizeDeadzone(value) {
    var n = Number(value);
    if (!isFinite(n) || n < 0) return 0;
    return n;
  }

  // A bounds rectangle: all four edges finite numbers with min <= max
  // on both axes, else null (no bounds — the scene edges apply).
  // A missing or wrong-shaped value reads as null; a rectangle with
  // its edges backwards reads as null too, so a typo never pins the
  // camera to a zero-width strip.
  function normalizeCameraBounds(bounds) {
    try {
      if (!bounds || typeof bounds !== 'object' || Array.isArray(bounds)) return null;
      var minX = Number(bounds.minX);
      var minY = Number(bounds.minY);
      var maxX = Number(bounds.maxX);
      var maxY = Number(bounds.maxY);
      if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return null;
      if (minX > maxX || minY > maxY) return null;
      return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
    } catch (err) {
      return null;
    }
  }

  // Normalize a scene's camera-feel config IN PLACE — the record keeps
  // its identity across calls, so Scene Settings holds the live config
  // while it renders (the high-score lesson). A missing or
  // wrong-shaped config reads as the default; a bad smoothing falls
  // back to 0 (snap), bad deadzone sides to 0 (off), bad bounds to
  // null (scene edges). Never throws.
  function normalizeCameraFeel(feel) {
    try {
      if (!feel || typeof feel !== 'object' || Array.isArray(feel)) {
        return { smoothing: DEFAULT_SMOOTHING, deadzoneW: DEFAULT_DEADZONE_W, deadzoneH: DEFAULT_DEADZONE_H, bounds: null };
      }
      feel.smoothing = normalizeSmoothing(feel.smoothing);
      feel.deadzoneW = normalizeDeadzone(feel.deadzoneW);
      feel.deadzoneH = normalizeDeadzone(feel.deadzoneH);
      feel.bounds = normalizeCameraBounds(feel.bounds);
      return feel;
    } catch (err) {
      return { smoothing: DEFAULT_SMOOTHING, deadzoneW: DEFAULT_DEADZONE_W, deadzoneH: DEFAULT_DEADZONE_H, bounds: null };
    }
  }

  // A fresh default config (a new record every call).
  function defaultCameraFeel() {
    return { smoothing: DEFAULT_SMOOTHING, deadzoneW: DEFAULT_DEADZONE_W, deadzoneH: DEFAULT_DEADZONE_H, bounds: null };
  }

  // A fresh normalized COPY of a config — the record the run owns.
  // The copy matters: the live feel must never alias the scene's
  // authored config, or a Set Camera Bounds block would rewrite the
  // project data in the editor preview. The bounds rectangle is
  // copied too, so the two records share nothing mutable.
  function freshCameraFeel(feel) {
    var base = normalizeCameraFeel(feel);
    var b = base.bounds;
    return {
      smoothing: base.smoothing,
      deadzoneW: base.deadzoneW,
      deadzoneH: base.deadzoneH,
      bounds: b ? { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY } : null
    };
  }

  function saneZoom(z) {
    var n = Number(z);
    return isFinite(n) ? Math.min(4, Math.max(0.25, n)) : 1;
  }

  // The camera position the follow wants this frame, before smoothing
  // and clamping. `camera` is the live camera record { x, y } (the
  // top-left of the view in world pixels); `anchor` is the followed
  // point in world pixels (the object's center plus the follow
  // offset); `viewport` is the canvas size in screen pixels; `zoom`
  // is the camera zoom; `feel` is the normalized config.
  //
  // Without a deadzone the camera centers the anchor. With one, each
  // axis is decided on its own: while the anchor sits inside the
  // zone (a rectangle around the current view center) that axis
  // holds still; when the anchor steps out, the camera shifts just
  // enough to bring the anchor back to the zone's edge. A zero-wide
  // zone degenerates to centering, so the two rules are one rule.
  function desiredFollowCamera(camera, anchor, viewport, zoom, feel) {
    var camX = 0;
    var camY = 0;
    try { camX = saneNum(camera && camera.x, 0); } catch (e) { camX = 0; }
    try { camY = saneNum(camera && camera.y, 0); } catch (e) { camY = 0; }
    var ax = 0;
    var ay = 0;
    try { ax = saneNum(anchor && anchor.x, 0); } catch (e) { ax = 0; }
    try { ay = saneNum(anchor && anchor.y, 0); } catch (e) { ay = 0; }
    var vw = 0;
    var vh = 0;
    try { vw = saneNum(viewport && viewport.width, 0); } catch (e) { vw = 0; }
    try { vh = saneNum(viewport && viewport.height, 0); } catch (e) { vh = 0; }
    var z = saneZoom(zoom);
    var viewW = vw / z;
    var viewH = vh / z;
    var f = normalizeCameraFeel(feel);
    var out = { x: ax - viewW / 2, y: ay - viewH / 2 };
    // Deadzone, one axis at a time. The zone is centered on the
    // current view center, so the hold check compares the anchor
    // against the view center plus/minus the half zone.
    var cx = camX + viewW / 2;
    var cy = camY + viewH / 2;
    var hw = (f.deadzoneW || 0) / 2;
    var hh = (f.deadzoneH || 0) / 2;
    if (ax > cx - hw && ax < cx + hw) out.x = camX;
    else if (ax <= cx - hw) out.x = ax + hw - viewW / 2;
    else out.x = ax - hw - viewW / 2;
    if (ay > cy - hh && ay < cy + hh) out.y = camY;
    else if (ay <= cy - hh) out.y = ay + hh - viewH / 2;
    else out.y = ay - hh - viewH / 2;
    return out;
  }

  // One exponential glide step toward the desired position. smoothing
  // 0 snaps (the whole remaining distance in one frame); 0.9 keeps
  // 90% of the distance per frame at 60fps. dtSeconds scales the
  // step, so the glide follows the time scale and a zero or negative
  // dt holds still. The factor never leaves 0..1, so the camera can
  // never overshoot the desired position. Never throws.
  function smoothToward(current, desired, smoothing, dtSeconds) {
    try {
      var c = saneNum(current, 0);
      var d = saneNum(desired, 0);
      var s = normalizeSmoothing(smoothing);
      if (s <= 0) return d;
      var dt = Number(dtSeconds);
      if (!isFinite(dt) || dt <= 0) return c;
      var k = 1 - Math.pow(s, dt * 60);
      if (!isFinite(k)) return d;
      if (k < 0) k = 0;
      if (k > 1) k = 1;
      return c + (d - c) * k;
    } catch (err) {
      return saneNum(desired, 0);
    }
  }

  // Clamp the camera view inside a rectangle. `bounds` is a world
  // rectangle { minX, minY, maxX, maxY } or null; `sceneSize` is the
  // scene's { width, height } and applies when bounds is null. One
  // axis at a time: when the view fits inside the rectangle it is
  // clamped to it; when the view is wider than the rectangle (a tiny
  // room, or a zoomed-out camera) the view centers on the rectangle
  // instead, so the camera never jitters between two clamps. A
  // missing rectangle and a missing scene size leave the camera
  // alone. Mutates `camera` in place and returns it. Never throws.
  function clampCameraToBounds(camera, viewport, zoom, bounds, sceneSize) {
    try {
      if (!camera || typeof camera !== 'object') return camera;
      var rect = normalizeCameraBounds(bounds);
      if (!rect) {
        // A missing scene size is NaN, not 0: Number(null) is 0, and
        // a 0-size scene would pin the camera to -viewW/2 instead of
        // leaving it alone.
        var sw = NaN;
        var sh = NaN;
        try { sw = (sceneSize && typeof sceneSize === 'object') ? Number(sceneSize.width) : NaN; } catch (e) { sw = NaN; }
        try { sh = (sceneSize && typeof sceneSize === 'object') ? Number(sceneSize.height) : NaN; } catch (e) { sh = NaN; }
        if (!isFinite(sw) || !isFinite(sh) || sw < 0 || sh < 0) return camera;
        rect = { minX: 0, minY: 0, maxX: sw, maxY: sh };
      }
      var vw = 0;
      var vh = 0;
      try { vw = saneNum(viewport && viewport.width, 0); } catch (e) { vw = 0; }
      try { vh = saneNum(viewport && viewport.height, 0); } catch (e) { vh = 0; }
      var z = saneZoom(zoom);
      var viewW = vw / z;
      var viewH = vh / z;
      var cx = saneNum(camera.x, 0);
      var cy = saneNum(camera.y, 0);
      var spanX = rect.maxX - rect.minX;
      var spanY = rect.maxY - rect.minY;
      if (viewW >= spanX) cx = rect.minX + spanX / 2 - viewW / 2;
      else cx = clamp(cx, rect.minX, rect.maxX - viewW);
      if (viewH >= spanY) cy = rect.minY + spanY / 2 - viewH / 2;
      else cy = clamp(cy, rect.minY, rect.maxY - viewH);
      camera.x = cx;
      camera.y = cy;
      return camera;
    } catch (err) {
      return camera;
    }
  }

  // One frame of camera follow: deadzone desire, smoothing glide,
  // bounds clamp. `camera` is the live camera record (mutated in
  // place and returned); `anchor` is the followed point in world
  // pixels; `viewport` is the canvas size in screen pixels; `zoom`
  // is the camera zoom; `feel` is the live feel record (null reads
  // as the default: snap, no deadzone, scene edges); `dtSeconds` is
  // the scaled frame step in seconds; `sceneSize` is the scene's
  // { width, height } for the no-bounds clamp. Never throws.
  function updateFollowCamera(camera, anchor, viewport, zoom, feel, dtSeconds, sceneSize) {
    try {
      if (!camera || typeof camera !== 'object') return camera;
      var f = normalizeCameraFeel(feel);
      var desired = desiredFollowCamera(camera, anchor, viewport, zoom, f);
      camera.x = smoothToward(camera.x, desired.x, f.smoothing, dtSeconds);
      camera.y = smoothToward(camera.y, desired.y, f.smoothing, dtSeconds);
      clampCameraToBounds(camera, viewport, zoom, f.bounds, sceneSize);
      return camera;
    } catch (err) {
      return camera;
    }
  }

  // True while the camera is following an object (a non-blank follow
  // target). The Camera Following condition reads this directly off
  // the live camera record — no subsystem call, so a missing record
  // just reads false. Never throws.
  function cameraFollowing(camera) {
    try {
      if (!camera || typeof camera !== 'object') return false;
      return saneName(camera.followTarget) !== '';
    } catch (err) {
      return false;
    }
  }

  function isCameraFeelAction(type) {
    return type === 'setCameraSmoothing' || type === 'setCameraDeadzone' ||
      type === 'setCameraBounds' || type === 'clearCameraBounds';
  }

  function isCameraFeelCondition(type) {
    return type === 'cameraFollowing';
  }

  return {
    DEFAULT_SMOOTHING: DEFAULT_SMOOTHING,
    MAX_SMOOTHING: MAX_SMOOTHING,
    DEFAULT_DEADZONE_W: DEFAULT_DEADZONE_W,
    DEFAULT_DEADZONE_H: DEFAULT_DEADZONE_H,
    normalizeSmoothing: normalizeSmoothing,
    normalizeDeadzone: normalizeDeadzone,
    normalizeCameraBounds: normalizeCameraBounds,
    normalizeCameraFeel: normalizeCameraFeel,
    defaultCameraFeel: defaultCameraFeel,
    freshCameraFeel: freshCameraFeel,
    desiredFollowCamera: desiredFollowCamera,
    smoothToward: smoothToward,
    clampCameraToBounds: clampCameraToBounds,
    updateFollowCamera: updateFollowCamera,
    cameraFollowing: cameraFollowing,
    isCameraFeelAction: isCameraFeelAction,
    isCameraFeelCondition: isCameraFeelCondition
  };
}

if (typeof window !== 'undefined') {
  window.HydraCameraFeel = hydraCameraFeelFactory();
  // Self-contained source of the factory, inlined into exported playable games
  // by HydraPlayer.buildPlayableHtml so exports run without editor files.
  window.HydraCameraFeel.factorySource = hydraCameraFeelFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraCameraFeelFactory;
