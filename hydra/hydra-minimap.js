/* ============================================================================
 * hydra-minimap.js — HydraScript shared minimap (P4 Advanced batch 36:
 * minimap, beginner edition).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation
 * of how the live corner map works — used by:
 *   - the editor preview runtime (hydra-previewruntime.js delegates
 *     to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Idea (Unity / Godot minimaps, beginner edition): batch 35 let the
 * game pick and walk a whole tagged group, but the player still could
 * not *see* where the goblins are. A minimap is a small live map in a
 * screen corner: the whole level shrunk down, a dot for every live
 * object, a white rectangle showing what the camera sees, so "where
 * is the exit" and "where are the goblins left" read at a glance.
 *
 *   config — each scene authors its own map in scene.minimap:
 *     enabled (off by default, so old projects show nothing), corner
 *     (top-right by default), size in pixels (80–400, default 160),
 *     zoom (1–4, default 1 = fit the whole scene), showViewport (on
 *     by default — the camera's view as a white outline). The Scene
 *     Settings Minimap section edits it.
 *   state — a fresh run record per scene load (like camera feel):
 *     createMinimapState copies the scene's config, so a block that
 *     hides the map mid-run never rewrites the project data. Show /
 *     Hide Minimap flip the run record's visible flag; Set Minimap
 *     Size / Set Minimap Zoom write the run record's size / zoom. A
 *     fresh scene re-mints from its own config, so a scene with the
 *     map off stays off even after the last scene showed one.
 *   dots — every live world object with a position gets a dot at its
 *     center, mapped into the map rect: the boss object red and large
 *     while a fight runs, an object tagged `player` white and large,
 *     any other tagged object in a deterministic color from its first
 *     tag (the same tag always reads the same color), untagged objects
 *     gray. Hidden, destroyed, HUD, and light objects never draw.
 *   zoom — 1 fits the whole scene. Above 1 the map shows a window of
 *     the scene (worldW / zoom wide) centered on the camera, clamped
 *     to the scene edges, so a zoomed map follows the player instead
 *     of shrinking the whole level into unreadable dots.
 *   draw — the map paints in the HUD pass of the shared draw module,
 *     above the HUD objects and below the screen flash, in both
 *     runtimes. The draw module hands it the live objects; this
 *     module does the geometry and the paint.
 *
 * The minimap state is transient per-scene run state (fresh on every
 * scene load, like particles and the respawn record). It never travels
 * in save slots — persist the visibility through Minimap Visible into
 * a variable the way quests and inventory do. There is deliberately no
 * per-run survival: each scene decides for itself whether it has a map.
 *
 * Nothing ever throws; hostile input degrades to safe defaults.
 *
 * Honest limits: one minimap per scene (corner / size / zoom are
 * per-scene config; blocks change size, zoom, and visibility only);
 * dots are positions only (no health, no names); zoom centers on the
 * camera, not on the player; no `hs` script-API surface yet.
 *
 * Load order (index.html): hydra-minimap.js BEFORE player-runtime.js
 * and script.js. player-runtime.js throws a clear error if HydraMinimap
 * is missing.
 * ========================================================================== */

function hydraMinimapFactory() {
  'use strict';

  var DEFAULT_SIZE = 160;
  var MIN_SIZE = 80;
  var MAX_SIZE = 400;
  var DEFAULT_ZOOM = 1;
  var MIN_ZOOM = 1;
  var MAX_ZOOM = 4;
  var DEFAULT_CORNER = 'top-right';
  var CORNERS = ['top-right', 'top-left', 'bottom-right', 'bottom-left'];
  var MARGIN = 12;
  var MIN_DRAW_SIZE = 40;
  var MAP_BG = 'rgba(0,0,0,0.55)';
  var MAP_BORDER = 'rgba(255,255,255,0.35)';
  var DOT_DEFAULT = '#9ca3af';
  var DOT_PLAYER = '#ffffff';
  var DOT_BOSS = '#ef4444';
  var VIEWPORT_STROKE = '#ffffff';

  // A usable number, or the fallback when the value is not one.
  // Only real numbers or numeric strings count — null / undefined /
  // '' count as missing, and anything else (an array, an object, a
  // boolean) reads as the fallback instead of a coerced number
  // (Number([]) is 0, which would silently read as a real value
  // instead of the fallback — the cycle-13 strict-coercion lesson).
  function saneNum(v, fallback) {
    if (v == null || v === '') return fallback;
    if (typeof v === 'number') return isFinite(v) ? v : fallback;
    if (typeof v === 'string') {
      if (v.trim() === '') return fallback;
      var n = Number(v);
      return isFinite(n) ? n : fallback;
    }
    return fallback;
  }

  function clamp(v, lo, hi) {
    if (!isFinite(v)) return lo;
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
  }

  // The record itself, or null for a missing / non-object record — the
  // callers below degrade to "no map" instead of throwing, so a
  // dropped module tag reads the same as a scene with the map off.
  function recordOf(rec) {
    return (rec && typeof rec === 'object') ? rec : null;
  }

  // --- Normalizers ---------------------------------------------------------

  // Which corner the map sits in: one of the four, default top-right.
  // Anything else reads as the default instead of a broken corner.
  function normalizeCorner(v) {
    var c = (v == null) ? '' : String(v).trim().toLowerCase();
    for (var i = 0; i < CORNERS.length; i++) {
      if (c === CORNERS[i]) return c;
    }
    return DEFAULT_CORNER;
  }

  // The map's size in pixels: a whole 80–400, default 160.
  function normalizeSize(v) {
    var n = Math.floor(saneNum(v, DEFAULT_SIZE));
    return clamp(n, MIN_SIZE, MAX_SIZE);
  }

  // The map's zoom: 1–4, default 1 (fit the whole scene). Below 1
  // would show more than the scene, so it reads as 1.
  function normalizeZoom(v) {
    var n = saneNum(v, DEFAULT_ZOOM);
    return clamp(n, MIN_ZOOM, MAX_ZOOM);
  }

  // The authored per-scene config, normalized in place so an
  // editor-held reference survives the repair (the localization
  // pattern). A missing or non-object config reads as the defaults.
  // Returns the config. Never throws.
  function normalizeMinimapConfig(cfg) {
    try {
      var c = recordOf(cfg);
      if (!c) return defaultMinimapConfig();
      c.enabled = c.enabled === true;
      c.corner = normalizeCorner(c.corner);
      c.size = normalizeSize(c.size);
      c.zoom = normalizeZoom(c.zoom);
      c.showViewport = c.showViewport !== false;
      return c;
    } catch (e) {
      return defaultMinimapConfig();
    }
  }

  // The literal defaults: off, top-right, 160px, fit, viewport on.
  function defaultMinimapConfig() {
    return {
      enabled: false,
      corner: DEFAULT_CORNER,
      size: DEFAULT_SIZE,
      zoom: DEFAULT_ZOOM,
      showViewport: true
    };
  }

  // --- State ---------------------------------------------------------------

  // A fresh run record for a scene: the visible flag starts at the
  // scene's enabled switch, and the corner / size / zoom / viewport
  // flag copy the config, so a block that changes the run record
  // never rewrites the authored config. The hosts mint one per scene
  // load (the export and the preview both mint through the
  // scene-reset hook), never per run, so a fresh scene gets its own
  // map. Never throws.
  function createMinimapState(cfg) {
    try {
      var c = normalizeMinimapConfig(cfg);
      return {
        visible: c.enabled,
        corner: c.corner,
        size: c.size,
        zoom: c.zoom,
        showViewport: c.showViewport
      };
    } catch (e) {
      return { visible: false, corner: DEFAULT_CORNER, size: DEFAULT_SIZE, zoom: DEFAULT_ZOOM, showViewport: true };
    }
  }

  // --- Reads ---------------------------------------------------------------

  // True while the map shows. A missing state reads as hidden, never
  // as an error.
  function isVisible(state) {
    try {
      var st = recordOf(state);
      return !!st && st.visible === true;
    } catch (e) {
      return false;
    }
  }

  // --- Writes --------------------------------------------------------------

  // Show or hide the map for the current scene without touching the
  // authored config. Quiet when there is no state. Returns the state,
  // or null when there is none. Never throws.
  function setVisible(state, visible) {
    try {
      var st = recordOf(state);
      if (!st) return null;
      st.visible = visible === true;
      return st;
    } catch (e) {
      return null;
    }
  }

  // Set the run record's size: a whole 80–400. A bad size changes
  // nothing and returns false, so the caller can warn and hold.
  // Returns true when the size changed. Never throws.
  function setSize(state, size) {
    try {
      var st = recordOf(state);
      if (!st) return false;
      var n = saneNum(size, NaN);
      if (!isFinite(n)) return false;
      st.size = clamp(Math.floor(n), MIN_SIZE, MAX_SIZE);
      return true;
    } catch (e) {
      return false;
    }
  }

  // Set the run record's zoom: 1–4. A bad zoom changes nothing and
  // returns false, so the caller can warn and hold. Returns true when
  // the zoom changed. Never throws.
  function setZoom(state, zoom) {
    try {
      var st = recordOf(state);
      if (!st) return false;
      var n = saneNum(zoom, NaN);
      if (!isFinite(n)) return false;
      st.zoom = clamp(n, MIN_ZOOM, MAX_ZOOM);
      return true;
    } catch (e) {
      return false;
    }
  }

  // --- Geometry ------------------------------------------------------------

  // The map's square rect in screen pixels: `size` on a side, 12px
  // from the picked corner's edges. A view too small for the map
  // shrinks it to fit (never below zero); a rect under 40px on a side
  // is too small to read, and the draw skips it. Never throws.
  function minimapRect(viewW, viewH, size, corner) {
    try {
      var vw = saneNum(viewW, 0);
      var vh = saneNum(viewH, 0);
      if (vw < 0) vw = 0;
      if (vh < 0) vh = 0;
      var s = normalizeSize(size);
      var avail = Math.max(0, Math.min(vw, vh) - MARGIN * 2);
      if (s > avail) s = avail;
      var c = normalizeCorner(corner);
      var x = MARGIN;
      var y = MARGIN;
      if (c === 'top-right' || c === 'bottom-right') x = vw - MARGIN - s;
      if (c === 'bottom-left' || c === 'bottom-right') y = vh - MARGIN - s;
      return { x: x, y: y, size: s };
    } catch (e) {
      return { x: MARGIN, y: MARGIN, size: 0 };
    }
  }

  // The world rect the map shows: at zoom 1 the whole scene; above 1
  // a window (worldW / zoom wide) centered on the camera's center,
  // clamped inside the scene edges. The camera center is the view's
  // top-left plus half the visible world size. Never throws.
  function worldWindow(worldW, worldH, camX, camY, viewW, viewH, zoom) {
    try {
      var ww = saneNum(worldW, 0);
      var wh = saneNum(worldH, 0);
      if (ww < 0) ww = 0;
      if (wh < 0) wh = 0;
      var z = normalizeZoom(zoom);
      if (z <= 1 || ww === 0 || wh === 0) {
        return { x: 0, y: 0, w: ww, h: wh };
      }
      var w = ww / z;
      var h = wh / z;
      var cx = saneNum(camX, 0) + saneNum(viewW, 0) / 2;
      var cy = saneNum(camY, 0) + saneNum(viewH, 0) / 2;
      var x = clamp(cx - w / 2, 0, Math.max(0, ww - w));
      var y = clamp(cy - h / 2, 0, Math.max(0, wh - h));
      return { x: x, y: y, w: w, h: h };
    } catch (e) {
      return { x: 0, y: 0, w: 0, h: 0 };
    }
  }

  // A world point mapped into the map rect, clamped to the rect so a
  // dot past the world's edge still reads as an edge dot. A zero-size
  // window or rect reads as the rect's top-left corner. Never throws.
  function worldToMap(wx, wy, win, rect) {
    try {
      var w = recordOf(win);
      var r = recordOf(rect);
      if (!w || !r || !isFinite(w.w) || !isFinite(w.h) || w.w <= 0 || w.h <= 0 ||
          !isFinite(r.size) || r.size <= 0) {
        return { x: (r && isFinite(r.x)) ? r.x : 0, y: (r && isFinite(r.y)) ? r.y : 0 };
      }
      var fx = clamp((saneNum(wx, w.x) - w.x) / w.w, 0, 1);
      var fy = clamp((saneNum(wy, w.y) - w.y) / w.h, 0, 1);
      return { x: r.x + fx * r.size, y: r.y + fy * r.size };
    } catch (e) {
      return { x: 0, y: 0 };
    }
  }

  // The camera's view as a rect inside the map: the view's world
  // rect mapped through the same window, clamped to the map rect so
  // a view wider than the window still reads as a frame. Never
  // throws.
  function viewportRect(win, rect, camX, camY, viewW, viewH) {
    try {
      var tl = worldToMap(camX, camY, win, rect);
      var br = worldToMap(
        saneNum(camX, 0) + saneNum(viewW, 0),
        saneNum(camY, 0) + saneNum(viewH, 0), win, rect);
      var x = Math.min(tl.x, br.x);
      var y = Math.min(tl.y, br.y);
      var w = Math.max(0, Math.abs(br.x - tl.x));
      var h = Math.max(0, Math.abs(br.y - tl.y));
      var r = recordOf(rect);
      if (r && isFinite(r.size) && r.size > 0) {
        if (x < r.x) { w -= (r.x - x); x = r.x; }
        if (y < r.y) { h -= (r.y - y); y = r.y; }
        if (x + w > r.x + r.size) w = r.x + r.size - x;
        if (y + h > r.y + r.size) h = r.y + r.size - y;
        if (w < 0) w = 0;
        if (h < 0) h = 0;
      }
      return { x: x, y: y, w: w, h: h };
    } catch (e) {
      return { x: 0, y: 0, w: 0, h: 0 };
    }
  }

  // --- Dots ----------------------------------------------------------------

  // A deterministic color for a tag: the lowercased tag hashed to a
  // hue, so the same tag always reads the same color in every scene.
  // A blank tag reads as the default gray. Never throws.
  function tagColor(tag) {
    try {
      var t = (tag == null) ? '' : String(tag).trim().toLowerCase();
      if (t === '') return DOT_DEFAULT;
      var hash = 5381;
      for (var i = 0; i < t.length; i++) {
        hash = ((hash * 33) + t.charCodeAt(i)) >>> 0;
      }
      return 'hsl(' + (hash % 360) + ', 70%, 55%)';
    } catch (e) {
      return DOT_DEFAULT;
    }
  }

  // The dot for an object: the boss red and large while a fight runs
  // (the boss's name is the fight's object name), an object tagged
  // `player` white and large, any other tagged object in its first
  // tag's color, untagged objects gray. The tag match ignores
  // capitals, like the tag blocks. Never throws.
  function dotStyle(obj, bossName) {
    try {
      if (!obj || typeof obj !== 'object') return { size: 2, color: DOT_DEFAULT };
      var name = (obj.name == null) ? '' : String(obj.name);
      var boss = (bossName == null) ? '' : String(bossName);
      if (boss !== '' && name === boss) return { size: 5, color: DOT_BOSS };
      var tags = Array.isArray(obj.tags) ? obj.tags : [];
      var firstTag = '';
      for (var i = 0; i < tags.length; i++) {
        var t = (tags[i] == null) ? '' : String(tags[i]).trim();
        if (t === '') continue;
        if (firstTag === '') firstTag = t;
        if (t.toLowerCase() === 'player') return { size: 5, color: DOT_PLAYER };
      }
      if (firstTag !== '') return { size: 3, color: tagColor(firstTag) };
      return { size: 2, color: DOT_DEFAULT };
    } catch (e) {
      return { size: 2, color: DOT_DEFAULT };
    }
  }

  // --- Paint ---------------------------------------------------------------

  // Paint the map in screen space: a dark panel with a light border,
  // one dot per live object at its center, and the camera's view as
  // a white outline when the state asks for it. The caller passes
  // the run state, the world size, the camera (world top-left +
  // visible world size), the view's pixel size, the live objects,
  // and the boss's name ('' when no fight runs). Returns true when
  // something was drawn, false when the map is hidden, the view is
  // too small for a readable map, or the context cannot draw. Never
  // throws.
  function drawMinimap(ctx, opts) {
    try {
      if (!ctx || typeof ctx !== 'object') return false;
      if (typeof ctx.fillRect !== 'function') return false;
      var o = recordOf(opts);
      if (!o) return false;
      var st = recordOf(o.state);
      if (!st || st.visible !== true) return false;
      var viewPxW = saneNum(o.viewPxW, 0);
      var viewPxH = saneNum(o.viewPxH, 0);
      var rect = minimapRect(viewPxW, viewPxH, st.size, st.corner);
      if (rect.size < MIN_DRAW_SIZE) return false;
      var worldW = saneNum(o.worldW, 0);
      var worldH = saneNum(o.worldH, 0);
      if (worldW <= 0 || worldH <= 0) return false;
      var win = worldWindow(worldW, worldH, o.camX, o.camY, o.viewW, o.viewH, st.zoom);
      if (win.w <= 0 || win.h <= 0) return false;
      var bossName = (o.bossName == null) ? '' : String(o.bossName);
      ctx.save();
      ctx.fillStyle = MAP_BG;
      ctx.fillRect(rect.x, rect.y, rect.size, rect.size);
      var list = Array.isArray(o.objects) ? o.objects : [];
      for (var i = 0; i < list.length; i++) {
        var obj = list[i];
        if (!obj || typeof obj !== 'object') continue;
        var px = Number(obj.posX);
        var py = Number(obj.posY);
        if (!isFinite(px) || !isFinite(py)) continue;
        var w = Number(obj.width);
        var h = Number(obj.height);
        if (!isFinite(w)) w = 0;
        if (!isFinite(h)) h = 0;
        var pt = worldToMap(px + w / 2, py + h / 2, win, rect);
        var dot = dotStyle(obj, bossName);
        ctx.fillStyle = dot.color;
        ctx.fillRect(pt.x - dot.size / 2, pt.y - dot.size / 2, dot.size, dot.size);
      }
      if (st.showViewport !== false) {
        var vr = viewportRect(win, rect, o.camX, o.camY, o.viewW, o.viewH);
        if (vr.w > 0 && vr.h > 0 && typeof ctx.strokeRect === 'function') {
          ctx.strokeStyle = VIEWPORT_STROKE;
          ctx.lineWidth = 1;
          ctx.strokeRect(vr.x + 0.5, vr.y + 0.5, vr.w - 1, vr.h - 1);
        }
      }
      if (typeof ctx.strokeRect === 'function') {
        ctx.strokeStyle = MAP_BORDER;
        ctx.lineWidth = 1;
        ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.size - 1, rect.size - 1);
      }
      ctx.restore();
      return true;
    } catch (e) {
      try { ctx.restore(); } catch (e2) { /* a throwing draw never breaks the frame */ }
      return false;
    }
  }

  // --- Routing -------------------------------------------------------------

  function isMinimapAction(type) {
    return type === 'showMinimap' || type === 'hideMinimap' ||
      type === 'setMinimapSize' || type === 'setMinimapZoom';
  }

  function isMinimapCondition(type) {
    return type === 'minimapVisible';
  }

  return {
    DEFAULT_SIZE: DEFAULT_SIZE,
    MIN_SIZE: MIN_SIZE,
    MAX_SIZE: MAX_SIZE,
    DEFAULT_ZOOM: DEFAULT_ZOOM,
    MIN_ZOOM: MIN_ZOOM,
    MAX_ZOOM: MAX_ZOOM,
    DEFAULT_CORNER: DEFAULT_CORNER,
    CORNERS: CORNERS,
    MARGIN: MARGIN,
    normalizeCorner: normalizeCorner,
    normalizeSize: normalizeSize,
    normalizeZoom: normalizeZoom,
    normalizeMinimapConfig: normalizeMinimapConfig,
    defaultMinimapConfig: defaultMinimapConfig,
    createMinimapState: createMinimapState,
    isVisible: isVisible,
    setVisible: setVisible,
    setSize: setSize,
    setZoom: setZoom,
    minimapRect: minimapRect,
    worldWindow: worldWindow,
    worldToMap: worldToMap,
    viewportRect: viewportRect,
    tagColor: tagColor,
    dotStyle: dotStyle,
    drawMinimap: drawMinimap,
    isMinimapAction: isMinimapAction,
    isMinimapCondition: isMinimapCondition
  };
}

if (typeof window !== 'undefined') {
  window.HydraMinimap = hydraMinimapFactory();
  // Self-contained source of the factory, inlined into exported playable games
  // by HydraPlayer.buildPlayableHtml so exports run without editor files.
  window.HydraMinimap.factorySource = hydraMinimapFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraMinimapFactory;
