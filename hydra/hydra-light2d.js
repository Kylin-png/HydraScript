/* ============================================================================
 * hydra-light2d.js — HydraScript shared 2D lighting + shadow helpers.
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation of
 * 2D darkness, point lights, and simple cast shadows used by:
 *   - the editor preview runtime (script.js delegates to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Idea (Godot's PointLight2D / Unity's 2D lights, beginner edition): a
 * scene has a DARKNESS level (0 = fully lit, 1 = pitch black) and a tint
 * color. Every object can EMIT LIGHT — a dedicated Light object, or any
 * sprite with "Emit light" checked in the Inspector — and each light
 * punches a soft round hole in the darkness. Objects with "Cast shadow"
 * checked block the light: a simple shadow shape stretches away from the
 * light behind them (the silhouette-extrusion trick, no raycaster).
 *
 * The Set Darkness block fades a scene to night; Set Light moves, recolors,
 * or switches a light at runtime (torch flicker is Every Frame + Set Light
 * with a wobbling radius or intensity); Darkness Level reads the current
 * darkness for gameplay gating ("when it is dark enough, the bats come
 * out"). The darkness overlay draws above the world and below the HUD, so
 * menus stay readable in the dark.
 *
 * Data model (stored on the object, saved in project JSON):
 *   obj.light = { enabled: true, radius: 220, color: '#ffffff', intensity: 1 };
 *   obj.castShadow = false;
 * Data model (stored on the scene, saved in project JSON):
 *   scene.darkness = 0;            // 0..1
 *   scene.darknessColor = '#000000';
 *
 * Rendering is a canvas composite, not a shader: the host draws the world,
 * then calls drawDarkness with a screen-space light list (projectLights
 * converts world space with the host's camera). drawDarkness fills an
 * offscreen canvas with the darkness color, erases one soft hole per light
 * (destination-out), tints each hole with the light's color, re-darkens
 * each light's shadow polygons, and stamps the result over the world.
 * Because shadows are painted per light, one light's shadow never eats
 * another light's pool.
 *
 * Honest limits: shadows use the object's unrotated bounds (rotation is
 * ignored); light color is a soft tint, not a true colored-light model;
 * HUD widgets draw above the darkness and never emit light; hidden
 * objects do not shine (hosts filter them before collecting). Darkness 0
 * means the overlay is skipped entirely, so old projects render
 * pixel-identically.
 *
 * Load order (index.html): hydra-light2d.js BEFORE player-runtime.js and
 * script.js. player-runtime.js throws a clear error if HydraLight2d is
 * missing.
 * ========================================================================== */

function hydraLight2dFactory() {
  'use strict';

  var LIGHT2D_KIND = 'light2d';
  var DEFAULT_RADIUS = 220;
  var DEFAULT_INTENSITY = 1;

  function saneNum(v, fallback) {
    var n = Number(v);
    return isFinite(n) ? n : fallback;
  }

  function isValidHexColor(v) {
    return typeof v === 'string' && /^#([0-9a-fA-F]{6})$/.test(v.trim());
  }

  function isLight2d(kind) {
    return kind === LIGHT2D_KIND;
  }

  // Repair/complete the light fields on any object. Idempotent; objects
  // that never emit light keep no `light` record at all (the record is
  // created by the Inspector checkbox, the Light button, or Set Light).
  // Bad values repair to sane defaults; nothing ever throws.
  function normalizeLight2d(obj) {
    try {
      if (!obj || typeof obj !== 'object') return null;
      var l = obj.light;
      if (!l || typeof l !== 'object') {
        l = {};
        obj.light = l;
      }
      if (typeof l.enabled !== 'boolean') l.enabled = true;
      var r = Number(l.radius);
      l.radius = isFinite(r) ? Math.max(0, r) : DEFAULT_RADIUS;
      if (!isValidHexColor(l.color)) l.color = '#ffffff';
      var inten = Number(l.intensity);
      l.intensity = isFinite(inten) ? Math.max(0, Math.min(1, inten)) : DEFAULT_INTENSITY;
      if (typeof obj.castShadow !== 'boolean') obj.castShadow = false;
      return l;
    } catch (e) {
      return null;
    }
  }

  // Repair/complete the scene darkness fields. Idempotent; darkness 0 is
  // the old behavior (fully lit, overlay skipped).
  function normalizeSceneDarkness(scene) {
    try {
      if (!scene || typeof scene !== 'object') return scene;
      var d = Number(scene.darkness);
      scene.darkness = isFinite(d) ? Math.max(0, Math.min(1, d)) : 0;
      if (!isValidHexColor(scene.darknessColor)) scene.darknessColor = '#000000';
      return scene;
    } catch (e) {
      return scene;
    }
  }

  // The live 2D lights in world space: [{ x, y, radius, color, intensity }].
  // Hosts pass only live, visible, non-HUD objects (hidden objects and HUD
  // widgets never shine). Objects without a light record, or with
  // enabled === false, are skipped. Never throws.
  function collectLights2d(objects) {
    var out = [];
    try {
      if (!Array.isArray(objects)) return out;
      for (var i = 0; i < objects.length; i++) {
        var o = objects[i];
        if (!o || typeof o !== 'object') continue;
        var l = o.light;
        if (!l || typeof l !== 'object' || l.enabled === false) continue;
        var w = Number(o.width), h = Number(o.height);
        var x = Number(o.posX), y = Number(o.posY);
        if (!isFinite(x) || !isFinite(y)) continue;
        var r = Number(l.radius);
        r = isFinite(r) ? Math.max(0, r) : DEFAULT_RADIUS;
        var inten = Number(l.intensity);
        inten = isFinite(inten) ? Math.max(0, Math.min(1, inten)) : DEFAULT_INTENSITY;
        out.push({
          x: x + (isFinite(w) ? w / 2 : 0),
          y: y + (isFinite(h) ? h / 2 : 0),
          radius: r,
          color: isValidHexColor(l.color) ? l.color : '#ffffff',
          intensity: inten
        });
      }
    } catch (e) { /* never throws */ }
    return out;
  }

  // The shadow-casting boxes in world space: [{ x, y, w, h }]. Hosts pass
  // only live, visible, non-HUD, non-light objects; this filters to the
  // ones with castShadow checked and a real size. Never throws.
  function occluderBoxes(objects) {
    var out = [];
    try {
      if (!Array.isArray(objects)) return out;
      for (var i = 0; i < objects.length; i++) {
        var o = objects[i];
        if (!o || typeof o !== 'object' || o.castShadow !== true) continue;
        var x = Number(o.posX), y = Number(o.posY);
        var w = Number(o.width), h = Number(o.height);
        if (!isFinite(x) || !isFinite(y) || !isFinite(w) || !isFinite(h)) continue;
        if (w <= 0 || h <= 0) continue;
        out.push({ x: x, y: y, w: w, h: h });
      }
    } catch (e) { /* never throws */ }
    return out;
  }

  // The shadow polygon for one occluder box seen from one light, in the
  // same coordinate space as the inputs: [cA, cB, farB, farA] where cA/cB
  // are the silhouette corners (the extremes of the box's angular span
  // from the light — found by cutting at the LARGEST angular gap between
  // sorted corner angles, which also handles the atan2 wraparound when
  // the box sits to the left of the light) and farA/farB are those
  // corners pushed away from the light by `range` (usually the light's
  // radius). Returns null when the light is inside the box, the box is
  // degenerate, or the inputs are hostile. Never throws.
  function shadowPolygon(lx, ly, box, range) {
    try {
      if (!isFinite(lx) || !isFinite(ly) || !isFinite(range) || range <= 0) return null;
      if (!box || typeof box !== 'object') return null;
      var x = Number(box.x), y = Number(box.y);
      var w = Number(box.w), h = Number(box.h);
      if (!isFinite(x) || !isFinite(y) || !isFinite(w) || !isFinite(h)) return null;
      if (w <= 0 || h <= 0) return null;
      if (lx >= x && lx <= x + w && ly >= y && ly <= y + h) return null;
      var corners = [
        { x: x, y: y }, { x: x + w, y: y },
        { x: x + w, y: y + h }, { x: x, y: y + h }
      ];
      var scored = corners.map(function (c) {
        return { c: c, a: Math.atan2(c.y - ly, c.x - lx) };
      });
      scored.sort(function (a, b) { return a.a - b.a; });
      // Largest angular gap (including the wraparound gap) bounds the
      // occupied interval; its two neighbors are the silhouette pair.
      var bestGap = -1, bestIdx = 0;
      for (var i = 0; i < scored.length; i++) {
        var a0 = scored[i].a;
        var a1 = scored[(i + 1) % scored.length].a;
        var gap = (i === scored.length - 1) ? (scored[0].a + Math.PI * 2 - a0) : (a1 - a0);
        if (gap > bestGap) { bestGap = gap; bestIdx = i; }
      }
      var cA = scored[(bestIdx + 1) % scored.length].c;
      var cB = scored[bestIdx].c;
      function far(c) {
        var dx = c.x - lx, dy = c.y - ly;
        var d = Math.sqrt(dx * dx + dy * dy) || 1;
        return { x: c.x + dx / d * range, y: c.y + dy / d * range };
      }
      return [cA, cB, far(cB), far(cA)];
    } catch (e) {
      return null;
    }
  }

  // Convert world-space lights + occluder boxes into screen-space lights
  // with their shadow polygons attached, using the host's camera:
  // screen = (world - camera) * zoom. Returns
  // [{ x, y, radius, color, intensity, shadows: [[{x,y}...]] }].
  // Never throws.
  function projectLights(lights, boxes, camX, camY, zoom) {
    var out = [];
    try {
      if (!Array.isArray(lights)) return out;
      var cx = saneNum(camX, 0), cy = saneNum(camY, 0);
      var z = saneNum(zoom, 1);
      if (!(z > 0)) z = 1;
      var boxList = Array.isArray(boxes) ? boxes : [];
      for (var i = 0; i < lights.length; i++) {
        var l = lights[i];
        if (!l || typeof l !== 'object') continue;
        var shadows = [];
        for (var j = 0; j < boxList.length; j++) {
          var poly = shadowPolygon(l.x, l.y, boxList[j], l.radius);
          if (!poly) continue;
          shadows.push(poly.map(function (p) {
            return { x: (p.x - cx) * z, y: (p.y - cy) * z };
          }));
        }
        out.push({
          x: (l.x - cx) * z,
          y: (l.y - cy) * z,
          radius: l.radius * z,
          color: l.color,
          intensity: l.intensity,
          shadows: shadows
        });
      }
    } catch (e) { /* never throws */ }
    return out;
  }

  // '#rrggbb' + alpha -> 'rgba(r,g,b,alpha)'. Falls back to black on bad
  // input. Never throws.
  function hexToRgba(hex, alpha) {
    try {
      var h = String(hex || '').trim();
      var m = /^#([0-9a-fA-F]{6})$/.exec(h);
      if (!m) return 'rgba(0,0,0,' + alpha + ')';
      var v = m[1];
      return 'rgba(' + parseInt(v.slice(0, 2), 16) + ',' +
        parseInt(v.slice(2, 4), 16) + ',' +
        parseInt(v.slice(4, 6), 16) + ',' + alpha + ')';
    } catch (e) {
      return 'rgba(0,0,0,' + alpha + ')';
    }
  }

  // Paint the darkness overlay onto ctx (screen space). opts =
  // { width, height, darkness (0..1), color ('#rrggbb'), darkCanvas
  // (host-owned offscreen canvas, resized as needed), lights: screen-space
  // lights from projectLights }. Returns true when something was painted,
  // false when darkness is 0 or the draw failed. Never throws, and never
  // leaves the main ctx in a modified state.
  function drawDarkness(ctx, opts) {
    try {
      if (!ctx || !opts || typeof opts !== 'object') return false;
      var darkness = Number(opts.darkness);
      if (!isFinite(darkness) || darkness <= 0) return false;
      darkness = Math.min(1, darkness);
      var width = Number(opts.width), height = Number(opts.height);
      if (!isFinite(width) || !isFinite(height) || width <= 0 || height <= 0) return false;
      var dc = opts.darkCanvas;
      if (!dc || typeof dc.getContext !== 'function') return false;
      var dctx = dc.getContext('2d');
      if (!dctx) return false;
      if (dc.width !== width || dc.height !== height) {
        dc.width = width;
        dc.height = height;
      }
      var color = isValidHexColor(opts.color) ? opts.color : '#000000';
      dctx.save();
      dctx.globalCompositeOperation = 'source-over';
      dctx.globalAlpha = 1;
      dctx.fillStyle = hexToRgba(color, darkness);
      dctx.fillRect(0, 0, width, height);
      var lights = Array.isArray(opts.lights) ? opts.lights : [];
      for (var i = 0; i < lights.length; i++) {
        var l = lights[i];
        if (!l || typeof l !== 'object') continue;
        var r = Number(l.radius), inten = Number(l.intensity);
        if (!isFinite(r) || r <= 0 || !isFinite(inten) || inten <= 0) continue;
        var lx = Number(l.x), ly = Number(l.y);
        if (!isFinite(lx) || !isFinite(ly)) continue;
        var x0 = Math.max(0, lx - r), y0 = Math.max(0, ly - r);
        var bw = Math.min(width - x0, r * 2), bh = Math.min(height - y0, r * 2);
        if (bw <= 0 || bh <= 0) continue;
        // Punch the hole: the gradient's alpha erases the darkness.
        var punch = dctx.createRadialGradient(lx, ly, 0, lx, ly, r);
        punch.addColorStop(0, 'rgba(0,0,0,' + Math.min(1, inten) + ')');
        punch.addColorStop(1, 'rgba(0,0,0,0)');
        dctx.globalCompositeOperation = 'destination-out';
        dctx.fillStyle = punch;
        dctx.fillRect(x0, y0, bw, bh);
        // Soft color tint inside the pool (white = a plain warm light).
        dctx.globalCompositeOperation = 'source-over';
        var tint = dctx.createRadialGradient(lx, ly, 0, lx, ly, r);
        tint.addColorStop(0, hexToRgba(isValidHexColor(l.color) ? l.color : '#ffffff', Math.min(1, inten) * 0.25));
        tint.addColorStop(1, hexToRgba(isValidHexColor(l.color) ? l.color : '#ffffff', 0));
        dctx.fillStyle = tint;
        dctx.fillRect(x0, y0, bw, bh);
        // Re-darken this light's shadow polygons (per light, so one
        // light's shadow never eats another light's pool).
        var shadows = Array.isArray(l.shadows) ? l.shadows : [];
        if (shadows.length) {
          dctx.fillStyle = hexToRgba(color, darkness);
          for (var s = 0; s < shadows.length; s++) {
            var poly = shadows[s];
            if (!Array.isArray(poly) || poly.length < 3) continue;
            dctx.beginPath();
            dctx.moveTo(poly[0].x, poly[0].y);
            for (var p = 1; p < poly.length; p++) dctx.lineTo(poly[p].x, poly[p].y);
            dctx.closePath();
            dctx.fill();
          }
        }
      }
      dctx.restore();
      ctx.save();
      ctx.drawImage(dc, 0, 0, width, height);
      ctx.restore();
      return true;
    } catch (e) {
      try { ctx.restore(); } catch (e2) { /* never throws */ }
      return false;
    }
  }

  // ---------- block dispatch (one entry point, both runtimes) ----------
  // hooks = { targets(data) -> [objects], num(expr) -> { ok, value },
  //           warn(msg), scene() -> scene object }.
  // setDarkness: writes the LIVE scene's darkness (like Set Scene
  // Background — the scene object in memory, not the saved project).
  // setLight2d: writes the targets' light records. Bad values warn and
  // hold (validated before any write); blank names stay quiet. Never
  // throws.
  function applyLight2dAction(data, hooks) {
    try {
      if (!data || typeof data !== 'object' || !hooks) return;
      if (data.type === 'setDarkness') {
        var nv = hooks.num ? hooks.num(data.darkness) : null;
        if (!nv || !nv.ok || !isFinite(nv.value)) {
          if (hooks.warn) hooks.warn('Set Darkness: bad darkness value — skipped.');
          return;
        }
        var scene = hooks.scene ? hooks.scene() : null;
        if (!scene || typeof scene !== 'object') return;
        normalizeSceneDarkness(scene);
        scene.darkness = Math.max(0, Math.min(1, nv.value));
        return;
      }
      if (data.type === 'setLight2d') {
        var targets = hooks.targets ? hooks.targets(data) : [];
        if (!targets || targets.length === 0) return; // blank: quiet
        var rv = hooks.num ? hooks.num(data.radius == null ? 220 : data.radius) : null;
        if (!rv || !rv.ok || !isFinite(rv.value) || rv.value < 0) {
          if (hooks.warn) hooks.warn('Set Light: bad radius — skipped.');
          return;
        }
        var lc = String(data.color || '').trim();
        if (!isValidHexColor(lc)) {
          if (hooks.warn) hooks.warn('Set Light: bad color — skipped.');
          return;
        }
        var mode = String(data.mode || 'on').trim().toLowerCase();
        if (mode !== 'on' && mode !== 'off') {
          if (hooks.warn) hooks.warn('Set Light: bad on/off mode — skipped.');
          return;
        }
        targets.forEach(function (o) {
          normalizeLight2d(o);
          o.light.radius = rv.value;
          o.light.color = lc;
          o.light.enabled = (mode === 'on');
        });
        return;
      }
    } catch (e) { /* never throws */ }
  }

  // Darkness Level condition: the live scene darkness compared against an
  // expression, operators <=/>=/==/!=/</>. A state read — it evaluates
  // while paused like getVariable. Quiet (false) on bad data. Never
  // throws.
  function evalLight2dCondition(data, hooks) {
    var quiet = { pass: false, context: {} };
    try {
      if (!data || typeof data !== 'object' || data.type !== 'darknessLevel') return quiet;
      var cur = hooks && typeof hooks.darkness === 'function' ? hooks.darkness() : 0;
      cur = Number(cur);
      if (!isFinite(cur)) cur = 0;
      var nv = hooks && hooks.num ? hooks.num(data.darkness) : null;
      if (!nv || !nv.ok || !isFinite(nv.value)) return quiet;
      var op = String(data.operator || '<=');
      var v = nv.value;
      var pass = op === '<=' ? cur <= v :
        op === '>=' ? cur >= v :
        op === '==' ? cur === v :
        op === '!=' ? cur !== v :
        op === '<' ? cur < v :
        op === '>' ? cur > v : false;
      return { pass: pass, context: {} };
    } catch (e) {
      return quiet;
    }
  }

  function isLight2dAction(type) {
    return type === 'setDarkness' || type === 'setLight2d';
  }

  function isLight2dCondition(type) {
    return type === 'darknessLevel';
  }

  return {
    LIGHT2D_KIND: LIGHT2D_KIND,
    DEFAULT_RADIUS: DEFAULT_RADIUS,
    DEFAULT_INTENSITY: DEFAULT_INTENSITY,
    isLight2d: isLight2d,
    normalizeLight2d: normalizeLight2d,
    normalizeSceneDarkness: normalizeSceneDarkness,
    collectLights2d: collectLights2d,
    occluderBoxes: occluderBoxes,
    shadowPolygon: shadowPolygon,
    projectLights: projectLights,
    hexToRgba: hexToRgba,
    drawDarkness: drawDarkness,
    applyLight2dAction: applyLight2dAction,
    evalLight2dCondition: evalLight2dCondition,
    isLight2dAction: isLight2dAction,
    isLight2dCondition: isLight2dCondition
  };
}

window.HydraLight2d = hydraLight2dFactory();
// Self-contained source of the factory, inlined into exported playable games
// by HydraPlayer.buildPlayableHtml so exports run without editor files.
window.HydraLight2d.factorySource = hydraLight2dFactory.toString();
