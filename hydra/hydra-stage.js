/* HydraStage — the editor's scene stage (P2 item 14, slice 4).
 *
 * The scene stage is the Layout view: scene dimensions, the snap grid,
 * the zoom transform, the camera viewport frame, the scene background
 * and size, and the in-editor 3D viewport with its Scene Settings
 * camera / shadow / darkness field sync. script.js keeps thin
 * delegations so every call site is unchanged; this module owns the
 * 3D-view flag that used to be the script.js `sceneEditor3dView` let.
 *
 * This is a DOM module, not a pure one: it reads and writes stage
 * elements, so the node tests drive it through a vm sandbox with a
 * fake document (tests/stage.test.js). The pure geometry (dimensions,
 * snap, zoom clamp, 3D kind names) takes explicit arguments and is
 * testable with no document at all.
 *
 * Live editor state reaches the module only through configure():
 *   onDirty            — called after a camera/darkness field edit.
 *   normalizeScene     — the core scene normalizer (script.js passes
 *                        HydraUniversal.normalizeScene); without one
 *                        the module resolves it from
 *                        globalThis.HydraUniversal, and without that
 *                        the local math still runs.
 *   getBgDataUrl       — (assetId) => data URL string or null, for the
 *                        scene background image.
 *   getImage           — (assetId) => an Image (or null) for the 3D
 *                        viewport background.
 *   resolveModelMeshFor — (object) => fitted model mesh (or null).
 *   getHydra3d         — () => the Hydra3d module; defaults to
 *                        globalThis.Hydra3d.
 *   getHydraLight2d    — () => the HydraLight2d module; defaults to
 *                        globalThis.HydraLight2d.
 * Every provider is optional and replaced only by a function; a
 * throwing provider degrades to its safe default instead of breaking
 * the stage. The document is the explicit first argument to every
 * DOM function (a missing argument falls back to the global document,
 * a missing document is a no-op) and the scene is always passed in,
 * so the module never reads editor globals.
 *
 * Documented behavior deltas (all in this header):
 * - normalizeSceneDimensions swallows a throwing normalizer and
 *   continues with the local math (the old inline code would have
 *   thrown out of getCurrentScene).
 * - snapValue coerces a non-finite value to 0 instead of producing
 *   NaN positions (the old snapSceneValue passed NaN straight
 *   through to posX/posY).
 * - getScenePointFromEvent returns {x: 0, y: 0} when the stage
 *   element is missing (the old code threw on null's
 *   getBoundingClientRect) and treats a zero / non-finite zoom as 1;
 *   with a stage element the math is exact.
 * - render3dView keeps the old try/catch around the projector, so a
 *   throwing draw still cannot break the editor.
 *
 * Stays in script.js: initSceneEditor (the wiring that calls these
 * functions), renderSceneObjects / renderGameObject (the draggable
 * Layout divs and their drag handling), updateSceneToolState (the
 * toolbar buttons + selection state), and the scene CRUD (create /
 * delete / rename) and object-list rendering. The zoom level itself
 * stays a script.js let — the drag code reads it directly — and
 * script.js passes it into applySceneZoom / getScenePointFromEvent.
 * kindName3d is currently unused in the editor (kept: the 3D kind
 * display names belong with the stage, not the property panels).
 *
 * Follows the hydra-*.js factorySource pattern. Exports never inline
 * this module (exported games have no editor stage); factorySource is
 * kept so the module stays re-instantiable and testable like the rest
 * of the family.
 */
function hydraStageFactory() {
  'use strict';

  var ZOOM_MIN = 0.35;
  var ZOOM_MAX = 2;
  var DEFAULT_WORLD_WIDTH = 800;
  var DEFAULT_WORLD_HEIGHT = 600;

  var scene3dView = false;
  var onDirty = function () {};
  var normalizeSceneProvider = null;
  var getBgDataUrl = function () { return null; };
  var getImage = function () { return null; };
  var resolveModelMeshFor = null;
  var getHydra3dProvider = null;
  var getHydraLight2dProvider = null;
  var getHydraCameraFeelProvider = null;
  var getHydraMinimapProvider = null;

  function getDocument(doc) {
    if (doc) return doc;
    if (typeof document !== 'undefined' && document) return document;
    return null;
  }

  function markDirty() {
    try { onDirty(); } catch (e) { /* a throwing dirty callback never breaks editing */ }
  }

  function safeProvider(fn) {
    return typeof fn === 'function' ? fn : null;
  }

  // Replace the dirty callback and any of the live-state providers. A
  // missing or non-function value is ignored, so the previous callback
  // (or the default no-op) stands.
  function configure(options) {
    if (!options) return;
    if (typeof options.onDirty === 'function') onDirty = options.onDirty;
    if (typeof options.normalizeScene === 'function') normalizeSceneProvider = options.normalizeScene;
    if (typeof options.getBgDataUrl === 'function') getBgDataUrl = options.getBgDataUrl;
    if (typeof options.getImage === 'function') getImage = options.getImage;
    if (typeof options.resolveModelMeshFor === 'function') resolveModelMeshFor = options.resolveModelMeshFor;
    if (typeof options.getHydra3d === 'function') getHydra3dProvider = options.getHydra3d;
    if (typeof options.getHydraLight2d === 'function') getHydraLight2dProvider = options.getHydraLight2d;
    if (typeof options.getHydraCameraFeel === 'function') getHydraCameraFeelProvider = options.getHydraCameraFeel;
    if (typeof options.getHydraMinimap === 'function') getHydraMinimapProvider = options.getHydraMinimap;
  }

  function resolveNormalizeScene() {
    if (normalizeSceneProvider) return normalizeSceneProvider;
    try {
      var core = typeof globalThis !== 'undefined' ? globalThis.HydraUniversal : null;
      if (core && typeof core.normalizeScene === 'function') return core.normalizeScene;
    } catch (e) { /* fall through: the local math still runs */ }
    return null;
  }

  function resolveHydra3d() {
    var provider = safeProvider(getHydra3dProvider);
    if (provider) {
      try { return provider() || null; } catch (e) { return null; }
    }
    try {
      var H3 = typeof globalThis !== 'undefined' ? globalThis.Hydra3d : null;
      return H3 || null;
    } catch (e) { return null; }
  }

  function resolveHydraLight2d() {
    var provider = safeProvider(getHydraLight2dProvider);
    if (provider) {
      try { return provider() || null; } catch (e) { return null; }
    }
    try {
      var L2 = typeof globalThis !== 'undefined' ? globalThis.HydraLight2d : null;
      return L2 || null;
    } catch (e) { return null; }
  }

  function resolveHydraCameraFeel() {
    var provider = safeProvider(getHydraCameraFeelProvider);
    if (provider) {
      try { return provider() || null; } catch (e) { return null; }
    }
    try {
      var CF = typeof globalThis !== 'undefined' ? globalThis.HydraCameraFeel : null;
      return CF || null;
    } catch (e) { return null; }
  }

  function resolveHydraMinimap() {
    var provider = safeProvider(getHydraMinimapProvider);
    if (provider) {
      try { return provider() || null; } catch (e) { return null; }
    }
    try {
      var MM = typeof globalThis !== 'undefined' ? globalThis.HydraMinimap : null;
      return MM || null;
    } catch (e) { return null; }
  }

  function safeBgDataUrl(assetId) {
    try {
      var url = getBgDataUrl(assetId);
      return typeof url === 'string' && url ? url : null;
    } catch (e) { return null; }
  }

  function safeGetImage(assetId) {
    try { return getImage(assetId) || null; } catch (e) { return null; }
  }

  function safeResolveModelMesh(obj) {
    if (!resolveModelMeshFor) return null;
    try { return resolveModelMeshFor(obj) || null; } catch (e) { return null; }
  }

  function stageElement(doc) {
    var d = getDocument(doc);
    if (!d || typeof d.getElementById !== 'function') return null;
    try { return d.getElementById('scene-canvas') || null; } catch (e) { return null; }
  }

  function fieldElement(doc, id) {
    var d = getDocument(doc);
    if (!d || typeof d.getElementById !== 'function') return null;
    try { return d.getElementById(id) || null; } catch (e) { return null; }
  }

  // --- scene dimensions (pure) --------------------------------------

  function normalizeSceneDimensions(scene) {
    if (!scene) return null;
    var normalize = resolveNormalizeScene();
    if (normalize) {
      try { normalize(scene); } catch (e) { /* a throwing normalizer never breaks the stage */ }
    }
    var worldW = Number(scene.worldWidth || scene.width || DEFAULT_WORLD_WIDTH);
    var worldH = Number(scene.worldHeight || scene.height || DEFAULT_WORLD_HEIGHT);
    scene.worldWidth = Math.max(100, worldW);
    scene.worldHeight = Math.max(100, worldH);
    scene.width = scene.worldWidth;
    scene.height = scene.worldHeight;
    scene.viewportWidth = Math.max(100, Number(scene.viewportWidth || Math.min(scene.worldWidth, DEFAULT_WORLD_WIDTH) || DEFAULT_WORLD_WIDTH));
    scene.viewportHeight = Math.max(100, Number(scene.viewportHeight || Math.min(scene.worldHeight, DEFAULT_WORLD_HEIGHT) || DEFAULT_WORLD_HEIGHT));
    return scene;
  }

  function getSceneWorldWidth(scene) {
    return normalizeSceneDimensions(scene)?.worldWidth || DEFAULT_WORLD_WIDTH;
  }

  function getSceneWorldHeight(scene) {
    return normalizeSceneDimensions(scene)?.worldHeight || DEFAULT_WORLD_HEIGHT;
  }

  function getSceneViewportWidth(scene) {
    return normalizeSceneDimensions(scene)?.viewportWidth || DEFAULT_WORLD_WIDTH;
  }

  function getSceneViewportHeight(scene) {
    return normalizeSceneDimensions(scene)?.viewportHeight || DEFAULT_WORLD_HEIGHT;
  }

  // --- stage geometry (pure) -----------------------------------------

  // Snap a scene coordinate to the grid when snapping is on, else round
  // it. A non-finite value degrades to 0 instead of a NaN position.
  function snapValue(value, snapEnabled, gridSize) {
    var v = Number(value);
    if (!Number.isFinite(v)) return 0;
    var size = Number(gridSize);
    if (!Number.isFinite(size) || size <= 0) size = 20;
    return snapEnabled ? Math.round(v / size) * size : Math.round(v);
  }

  function clampZoom(value) {
    var v = Number(value);
    if (!Number.isFinite(v)) return 1;
    return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v));
  }

  // P4 item 3D1: display names for the 3D primitive kinds.
  function kindName3d(kind) {
    return kind === 'box3d' ? 'Box3D' : kind === 'sphere3d' ? 'Sphere3D' :
      kind === 'plane3d' ? 'Plane3D' : kind === 'cylinder3d' ? 'Cylinder3D' :
      kind === 'model3d' ? 'Model3D' : '';
  }

  // --- stage view (DOM) -----------------------------------------------

  function applySceneZoom(doc, zoom) {
    var sceneEl = stageElement(doc);
    if (!sceneEl) return;
    sceneEl.style.transform = 'scale(' + zoom + ')';
  }

  // Pointer position in scene coordinates, undoing the zoom transform.
  function getScenePointFromEvent(event, zoom, doc) {
    var sceneEl = stageElement(doc);
    if (!sceneEl || !event || typeof sceneEl.getBoundingClientRect !== 'function') {
      return { x: 0, y: 0 };
    }
    var rect = sceneEl.getBoundingClientRect();
    var z = Number(zoom);
    if (!Number.isFinite(z) || z === 0) z = 1;
    return {
      x: (event.clientX - rect.left) / z,
      y: (event.clientY - rect.top) / z
    };
  }

  function updateCameraFrame(doc, scene) {
    var sceneEl = stageElement(doc);
    if (!sceneEl) return;
    var frame = null;
    try { frame = sceneEl.querySelector('.scene-camera-frame'); } catch (e) { frame = null; }
    if (!frame) {
      var d = getDocument(doc);
      if (!d || typeof d.createElement !== 'function') return;
      frame = d.createElement('div');
      frame.className = 'scene-camera-frame';
      sceneEl.appendChild(frame);
    }
    frame.style.width = Math.min(getSceneViewportWidth(scene), getSceneWorldWidth(scene)) + 'px';
    frame.style.height = Math.min(getSceneViewportHeight(scene), getSceneWorldHeight(scene)) + 'px';
    frame.style.left = '0px';
    frame.style.top = '0px';
  }

  function updateSceneBg(doc, scene) {
    var sceneEl = stageElement(doc);
    if (!sceneEl || !scene) return;
    var dataUrl = scene.bgAssetId ? safeBgDataUrl(scene.bgAssetId) : null;
    if (dataUrl) {
      sceneEl.style.backgroundImage = "url('" + dataUrl + "')";
      sceneEl.style.backgroundSize = 'cover';
      sceneEl.style.backgroundPosition = 'center';
      sceneEl.style.backgroundColor = '';
    } else {
      sceneEl.style.backgroundImage = '';
      sceneEl.style.backgroundColor = scene.bgColor || '#ffffff';
    }
  }

  function applySceneSize(doc, scene) {
    var sceneEl = stageElement(doc);
    if (!sceneEl) return;
    sceneEl.style.width = getSceneWorldWidth(scene) + 'px';
    sceneEl.style.height = getSceneWorldHeight(scene) + 'px';
    updateCameraFrame(doc, scene);
  }

  // --- in-editor 3D viewport (P4 item 3D1, batch 2) --------------------
  // 3D scenes get a Layout / 3D view toggle in the scene toolbar. The 3D
  // view renders the stage with the same Hydra3d projector Preview and
  // exported games use, with the scene's actual camera3d — the true
  // perspective render, right in the editor. Layout stays the place-and-
  // drag view; the 3D view refreshes after every scene edit.

  function isScene3dScene(scene) {
    var H3 = resolveHydra3d();
    if (!H3 || !scene) return false;
    try {
      return typeof H3.normalizeRenderMode === 'function' &&
        H3.normalizeRenderMode(scene.renderMode) === '3d';
    } catch (e) { return false; }
  }

  function get3dView() {
    return scene3dView;
  }

  function set3dView(doc, on, scene) {
    scene3dView = !!on && isScene3dScene(scene);
    var d = getDocument(doc);
    if (d && typeof d.getElementById === 'function') {
      var layoutBtn = fieldElement(d, 'scene-view-layout-btn');
      var view3dBtn = fieldElement(d, 'scene-view-3d-btn');
      if (layoutBtn && layoutBtn.classList) layoutBtn.classList.toggle('active', !scene3dView);
      if (view3dBtn && view3dBtn.classList) view3dBtn.classList.toggle('active', scene3dView);
    }
    render3dView(doc, scene);
  }

  function update3dViewToggle(doc, scene) {
    var show = isScene3dScene(scene);
    var d = getDocument(doc);
    if (d && typeof d.getElementById === 'function') {
      var toggle = fieldElement(d, 'scene-3d-view-toggle');
      var divider = fieldElement(d, 'scene-3d-view-divider');
      if (toggle) toggle.style.display = show ? '' : 'none';
      if (divider) divider.style.display = show ? '' : 'none';
      var wrap = fieldElement(d, 'scene-3d-camera-wrap');
      if (wrap) wrap.style.display = show ? '' : 'none';
    }
    if (!show && scene3dView) set3dView(doc, false, scene);
    else if (d && typeof d.getElementById === 'function') {
      var layoutBtn = fieldElement(d, 'scene-view-layout-btn');
      var view3dBtn = fieldElement(d, 'scene-view-3d-btn');
      if (layoutBtn && layoutBtn.classList) layoutBtn.classList.toggle('active', !scene3dView);
      if (view3dBtn && view3dBtn.classList) view3dBtn.classList.toggle('active', scene3dView);
    }
  }

  function render3dView(doc, scene) {
    var sceneEl = stageElement(doc);
    if (!sceneEl || !scene) return;
    var H3 = resolveHydra3d();
    var active = scene3dView && !!(H3 && typeof H3.normalizeRenderMode === 'function' &&
      H3.normalizeRenderMode(scene.renderMode) === '3d');
    if (sceneEl.classList) sceneEl.classList.toggle('scene-3d-view', active);
    if (!active) return; // renderSceneObjects() wiped any stale canvas/hint
    var d = getDocument(doc);
    if (!d || typeof d.createElement !== 'function') return;
    var cv = null;
    try { cv = sceneEl.querySelector('#scene-3d-canvas'); } catch (e) { cv = null; }
    if (!cv) {
      cv = d.createElement('canvas');
      cv.id = 'scene-3d-canvas';
      sceneEl.appendChild(cv);
    }
    var hint = null;
    try { hint = sceneEl.querySelector('.scene-3d-hint'); } catch (e) { hint = null; }
    if (!hint) {
      hint = d.createElement('div');
      hint.className = 'scene-3d-hint';
      hint.textContent = '3D view — the true perspective render (same engine as Preview). Switch to Layout to move objects; frame the camera in Scene Settings.';
      sceneEl.appendChild(hint);
    }
    var w = Math.max(1, Math.round(getSceneWorldWidth(scene)));
    var h = Math.max(1, Math.round(getSceneWorldHeight(scene)));
    cv.width = w; cv.height = h;
    var g = null;
    try { g = cv.getContext('2d'); } catch (e) { g = null; }
    if (!g) return;
    try {
      var img = scene.bgAssetId ? safeGetImage(scene.bgAssetId) : null;
      if (img && img.complete && img.naturalWidth > 0) {
        g.drawImage(img, 0, 0, w, h);
      } else {
        g.fillStyle = scene.bgColor || '#ffffff';
        g.fillRect(0, 0, w, h);
      }
      var cam = H3.normalizeCamera3d(scene.camera3d, scene);
      scene.camera3d = cam;
      // P5-8 slice b: the outliner's eye hides the object here too —
      // a hidden 3D object or light leaves the editor viewport, the
      // same way the 2D stage drops its element.
      H3.renderScene(g, { camera3d: cam, worldWidth: w, worldHeight: h, shadows3d: scene.shadows3d === true, shadowGroundY: scene.shadowGroundY },
        (scene.objects || []).filter(function (o) { return o.hidden !== true && (H3.is3dKind(o.kind) || H3.isLight3d(o.kind)); }), w, h,
        // P4 item 3D2: model3d objects resolve through the asset cache.
        resolveModelMeshFor ? function (obj) { return safeResolveModelMesh(obj); } : null);
    } catch (e) { /* the editor viewport must never break the editor */ }
  }

  // --- Scene Settings 3D camera fields (P4 item 3D1, batch 2) ---------
  // Clearing a field drops back to the default framing for that axis
  // (normalizeCamera3d fills it in); Reset wipes the whole camera back
  // to "frame the scene".
  var CAM3D_FIELDS = [
    ['scene-cam3d-x', 'x'], ['scene-cam3d-y', 'y'], ['scene-cam3d-z', 'z'],
    ['scene-cam3d-tx', 'tx'], ['scene-cam3d-ty', 'ty'], ['scene-cam3d-tz', 'tz'],
    ['scene-cam3d-fov', 'fov']
  ];

  function syncScene3dCameraFields(doc, scene) {
    var H3 = resolveHydra3d();
    if (!H3 || !scene) return;
    var cam = H3.normalizeCamera3d(scene.camera3d, scene);
    scene.camera3d = cam;
    CAM3D_FIELDS.forEach(function (pair) {
      var el = fieldElement(doc, pair[0]);
      if (el) el.value = Math.round(cam[pair[1]] * 10) / 10;
    });
    // P4 item 3D5: shadow switch + ground plane.
    var shEl = fieldElement(doc, 'scene-shadows3d');
    if (shEl) shEl.checked = scene.shadows3d === true;
    var gyEl = fieldElement(doc, 'scene-shadow-ground-y');
    if (gyEl) gyEl.value = Number.isFinite(Number(scene.shadowGroundY)) ? Number(scene.shadowGroundY) : '';
  }

  function onScene3dCameraInput(doc, scene) {
    var H3 = resolveHydra3d();
    if (!H3 || !scene) return;
    var cam = H3.normalizeCamera3d(scene.camera3d, scene);
    CAM3D_FIELDS.forEach(function (pair) {
      var el = fieldElement(doc, pair[0]);
      if (!el) return;
      var raw = String(el.value == null ? '' : el.value).trim();
      if (raw === '' || !Number.isFinite(Number(raw))) delete cam[pair[1]];
      else cam[pair[1]] = Number(raw);
    });
    scene.camera3d = H3.normalizeCamera3d(cam, scene);
    // P4 item 3D5: shadow switch + ground plane (blank ground Y = bottom
    // of the world, the renderScene default).
    var shEl = fieldElement(doc, 'scene-shadows3d');
    if (shEl) scene.shadows3d = shEl.checked === true;
    var gyEl = fieldElement(doc, 'scene-shadow-ground-y');
    if (gyEl) {
      var rawGy = String(gyEl.value == null ? '' : gyEl.value).trim();
      if (rawGy === '' || !Number.isFinite(Number(rawGy))) delete scene.shadowGroundY;
      else scene.shadowGroundY = Number(rawGy);
    }
    markDirty();
    render3dView(doc, scene);
  }

  // --- Scene Settings darkness fields (P4 Advanced, 2D lighting) ------
  // The 2D lighting fields only exist for 2D scenes (3D scenes have
  // their own lighting); switching render modes hides/shows the wrap.
  function syncSceneDarknessFields(doc, scene) {
    var L2 = resolveHydraLight2d();
    if (!L2 || !scene) return;
    L2.normalizeSceneDarkness(scene);
    var wrap = fieldElement(doc, 'scene-2d-lighting-wrap');
    if (wrap) wrap.style.display = scene.renderMode === '3d' ? 'none' : '';
    var dEl = fieldElement(doc, 'scene-darkness');
    if (dEl) dEl.value = Math.round(scene.darkness * 100);
    var cEl = fieldElement(doc, 'scene-darkness-color');
    if (cEl) cEl.value = /^#([0-9a-fA-F]{6})$/.test(scene.darknessColor || '') ? scene.darknessColor : '#000000';
  }

  function onSceneDarknessInput(doc, scene) {
    var L2 = resolveHydraLight2d();
    if (!L2 || !scene) return;
    L2.normalizeSceneDarkness(scene);
    var dEl = fieldElement(doc, 'scene-darkness');
    if (dEl) {
      var v = Number(dEl.value);
      scene.darkness = Number.isFinite(v) ? Math.max(0, Math.min(1, v / 100)) : 0;
    }
    var cEl = fieldElement(doc, 'scene-darkness-color');
    if (cEl && /^#([0-9a-fA-F]{6})$/.test(cEl.value || '')) scene.darknessColor = cEl.value;
    markDirty();
  }

  // --- Scene Settings camera-feel fields (P4 Advanced batch 15) ------
  // The 2D camera-feel fields only exist for 2D scenes (3D scenes have
  // their own camera); switching render modes hides/shows the wrap.
  // Blank bounds fields mean no bounds (the scene edges apply); a
  // half-filled rectangle does not take effect until all four edges
  // are numbers with Min below Max, so editing one edge never wipes
  // the rectangle mid-edit.
  var CAMFEEL_BOUNDS_FIELDS = [
    ['scene-cam-bounds-minx', 'minX'], ['scene-cam-bounds-miny', 'minY'],
    ['scene-cam-bounds-maxx', 'maxX'], ['scene-cam-bounds-maxy', 'maxY']
  ];

  function syncSceneCameraFeelFields(doc, scene) {
    var CF = resolveHydraCameraFeel();
    if (!CF || !scene) return;
    CF.normalizeCameraFeel(scene.cameraFeel);
    var wrap = fieldElement(doc, 'scene-camera-feel-wrap');
    if (wrap) wrap.style.display = scene.renderMode === '3d' ? 'none' : '';
    var sEl = fieldElement(doc, 'scene-cam-smoothing');
    if (sEl) sEl.value = scene.cameraFeel.smoothing;
    var wEl = fieldElement(doc, 'scene-cam-deadzone-w');
    if (wEl) wEl.value = scene.cameraFeel.deadzoneW;
    var hEl = fieldElement(doc, 'scene-cam-deadzone-h');
    if (hEl) hEl.value = scene.cameraFeel.deadzoneH;
    CAMFEEL_BOUNDS_FIELDS.forEach(function (pair) {
      var el = fieldElement(doc, pair[0]);
      if (!el) return;
      var b = scene.cameraFeel.bounds;
      el.value = (b && Number.isFinite(Number(b[pair[1]]))) ? Number(b[pair[1]]) : '';
    });
  }

  function onSceneCameraFeelInput(doc, scene) {
    var CF = resolveHydraCameraFeel();
    if (!CF || !scene) return;
    CF.normalizeCameraFeel(scene.cameraFeel);
    var sEl = fieldElement(doc, 'scene-cam-smoothing');
    if (sEl) {
      var sv = Number(sEl.value);
      scene.cameraFeel.smoothing = Number.isFinite(sv) ? CF.normalizeSmoothing(sv) : 0;
    }
    [['scene-cam-deadzone-w', 'deadzoneW'], ['scene-cam-deadzone-h', 'deadzoneH']].forEach(function (pair) {
      var el = fieldElement(doc, pair[0]);
      if (!el) return;
      var v = Number(el.value);
      scene.cameraFeel[pair[1]] = Number.isFinite(v) ? CF.normalizeDeadzone(v) : 0;
    });
    var raw = {};
    var allBlank = true;
    var allNums = true;
    CAMFEEL_BOUNDS_FIELDS.forEach(function (pair) {
      var el = fieldElement(doc, pair[0]);
      var text = el ? String(el.value == null ? '' : el.value).trim() : '';
      if (text !== '') allBlank = false;
      var n = Number(text);
      if (text === '' || !Number.isFinite(n)) allNums = false;
      else raw[pair[1]] = n;
    });
    if (allBlank) scene.cameraFeel.bounds = null;
    else if (allNums) scene.cameraFeel.bounds = CF.normalizeCameraBounds(raw);
    scene.cameraFeel = CF.normalizeCameraFeel(scene.cameraFeel);
    markDirty();
  }

  function syncSceneMinimapFields(doc, scene) {
    var MM = resolveHydraMinimap();
    if (!MM || !scene) return;
    MM.normalizeMinimapConfig(scene.minimap);
    var enEl = fieldElement(doc, 'scene-minimap-enabled');
    if (enEl) enEl.checked = scene.minimap.enabled === true;
    var cEl = fieldElement(doc, 'scene-minimap-corner');
    if (cEl) cEl.value = scene.minimap.corner;
    var sEl = fieldElement(doc, 'scene-minimap-size');
    if (sEl) sEl.value = scene.minimap.size;
    var zEl = fieldElement(doc, 'scene-minimap-zoom');
    if (zEl) zEl.value = scene.minimap.zoom;
    var vEl = fieldElement(doc, 'scene-minimap-viewport');
    if (vEl) vEl.checked = scene.minimap.showViewport !== false;
  }

  function onSceneMinimapInput(doc, scene) {
    var MM = resolveHydraMinimap();
    if (!MM || !scene) return;
    MM.normalizeMinimapConfig(scene.minimap);
    var enEl = fieldElement(doc, 'scene-minimap-enabled');
    if (enEl) scene.minimap.enabled = enEl.checked === true;
    var cEl = fieldElement(doc, 'scene-minimap-corner');
    if (cEl) scene.minimap.corner = MM.normalizeCorner(cEl.value);
    var sEl = fieldElement(doc, 'scene-minimap-size');
    if (sEl) {
      var sv = Number(sEl.value);
      scene.minimap.size = Number.isFinite(sv) ? MM.normalizeSize(sv) : 160;
    }
    var zEl = fieldElement(doc, 'scene-minimap-zoom');
    if (zEl) {
      var zv = Number(zEl.value);
      scene.minimap.zoom = Number.isFinite(zv) ? MM.normalizeZoom(zv) : 1;
    }
    var vEl = fieldElement(doc, 'scene-minimap-viewport');
    if (vEl) scene.minimap.showViewport = vEl.checked === true;
    scene.minimap = MM.normalizeMinimapConfig(scene.minimap);
    markDirty();
  }

  return {
    configure: configure,
    normalizeSceneDimensions: normalizeSceneDimensions,
    getSceneWorldWidth: getSceneWorldWidth,
    getSceneWorldHeight: getSceneWorldHeight,
    getSceneViewportWidth: getSceneViewportWidth,
    getSceneViewportHeight: getSceneViewportHeight,
    snapValue: snapValue,
    clampZoom: clampZoom,
    kindName3d: kindName3d,
    applySceneZoom: applySceneZoom,
    getScenePointFromEvent: getScenePointFromEvent,
    updateCameraFrame: updateCameraFrame,
    updateSceneBg: updateSceneBg,
    applySceneSize: applySceneSize,
    isScene3dScene: isScene3dScene,
    get3dView: get3dView,
    set3dView: set3dView,
    update3dViewToggle: update3dViewToggle,
    render3dView: render3dView,
    syncScene3dCameraFields: syncScene3dCameraFields,
    onScene3dCameraInput: onScene3dCameraInput,
    syncSceneDarknessFields: syncSceneDarknessFields,
    onSceneDarknessInput: onSceneDarknessInput,
    syncSceneCameraFeelFields: syncSceneCameraFeelFields,
    onSceneCameraFeelInput: onSceneCameraFeelInput,
    syncSceneMinimapFields: syncSceneMinimapFields,
    onSceneMinimapInput: onSceneMinimapInput
  };
}

if (typeof window !== 'undefined') {
  window.HydraStage = hydraStageFactory();
  // Self-contained source of the factory, kept as a string, never eval'd
  // here. Exports never inline this module (no editor stage in a shipped
  // game); factorySource stays so the module is re-instantiable and
  // testable like the rest of the hydra-*.js family.
  window.HydraStage.factorySource = hydraStageFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraStageFactory;
