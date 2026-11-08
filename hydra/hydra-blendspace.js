/* ============================================================================
 * hydra-blendspace.js — HydraScript shared 2D animation blend-space helpers.
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation of
 * animation blend spaces used by:
 *   - the editor preview runtime (script.js delegates to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Idea (Unity's 2D blend tree / Godot's BlendSpace2D, beginner edition): an
 * object lists named BLEND SPACES. Each blend space places the object's
 * sprite animations at points in a 2D parameter space — for example a
 * directional character:
 *
 *     WalkUp (0,-1)
 *   WalkLeft (-1,0)  Idle (0,0)  WalkRight (1,0)
 *     WalkDown (0,1)
 *
 * The Set Blend block sets the blend's X and Y every frame (usually from
 * input actions: X = right-left, Y = down-up) and activates the blend.
 * The engine then crossfades between the nearest animations: standing still
 * plays Idle, moving right plays WalkRight, moving diagonally shows a mix
 * of both frames. The Blend Active condition reads whether a blend is on.
 *
 * Blend spaces are data; the driving values are ordinary blocks. Anything
 * a blend space does can be rebuilt by hand from Play Animation blocks
 * (pick the nearest animation each frame), so this is an organizer, never
 * a cage.
 *
 * Data model (stored on the object, saved in project JSON):
 *   obj.animBlends = [
 *     { name: 'Move', fps: 8, points: [
 *       { animation: 'Idle', x: 0, y: 0 },
 *       { animation: 'WalkRight', x: 1, y: 0 }
 *     ] }
 *   ];
 *
 * Runtime state (NOT saved; per object, created fresh at game/scene start):
 *   { active: 'Move', spaces: { Move: { x, y, frameIndex, frameTimer } } }
 *
 * Only ONE blend space is active per object at a time (like one playing
 * animation). While active, the blend's frames win over the normal
 * animation at draw time; Stop Blend hands drawing back to it.
 *
 * Blending math: each point's weight is 1 / distance^2 from the current
 * (x, y) (inverse-square falloff, Godot-style). An exact hit on a point
 * plays that animation at full alpha. The top two frames are drawn: the
 * nearest at full alpha, the second at weight2 / (weight1 + weight2) —
 * a plain crossfade, never pixel-shader work. All points share one frame
 * clock advanced at the blend space's fps (loop mode), so a walk cycle
 * never restarts when the direction changes; each animation wraps at its
 * own frame count.
 *
 * Load order (index.html): hydra-blendspace.js BEFORE player-runtime.js and
 * script.js. player-runtime.js throws a clear error if HydraBlendSpace is
 * missing.
 * ========================================================================== */

function hydraBlendSpaceFactory() {
  'use strict';

  var DEFAULT_FPS = 8;

  function saneName(v, fallback) {
    var s = String(v == null ? '' : v).trim();
    return s.length ? s : fallback;
  }

  function saneFps(v) {
    var f = Number(v);
    return (isFinite(f) && f > 0) ? f : DEFAULT_FPS;
  }

  function saneNum(v) {
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }

  // Normalize an object's blend-space list in place. Corrupt/hand-edited
  // entries are repaired (blank names filled, duplicate names suffixed,
  // bad fps reset to 8, non-object points dropped, x/y coerced to 0), so
  // old projects (no `animBlends` field at all) and malformed data keep
  // working instead of crashing.
  function normalizeBlendSpaces(obj) {
    if (!obj || typeof obj !== 'object') return [];
    var list = obj.animBlends;
    if (!Array.isArray(list)) { obj.animBlends = []; return obj.animBlends; }
    var seen = {};
    obj.animBlends = list.filter(function (b) {
      return b && typeof b === 'object';
    }).map(function (b, i) {
      var name = saneName(b.name, 'Blend ' + (i + 1));
      if (seen[name]) name = name + ' ' + (i + 1);
      seen[name] = true;
      var pts = Array.isArray(b.points) ? b.points : [];
      return {
        name: name,
        fps: saneFps(b.fps),
        points: pts.filter(function (p) {
          return p && typeof p === 'object';
        }).map(function (p) {
          return {
            animation: String(p.animation == null ? '' : p.animation),
            x: saneNum(p.x),
            y: saneNum(p.y)
          };
        })
      };
    });
    return obj.animBlends;
  }

  function blendSpaceNames(obj) {
    return normalizeBlendSpaces(obj).map(function (b) { return b.name; });
  }

  // The blend-space record with exactly this name, or null.
  function getBlendSpace(obj, name) {
    var want = String(name == null ? '' : name);
    if (!want) return null;
    var list = normalizeBlendSpaces(obj);
    for (var i = 0; i < list.length; i++) {
      if (list[i].name === want) return list[i];
    }
    return null;
  }

  function createBlendRuntime() {
    return { active: '', spaces: {} };
  }

  function activeBlendName(rt) {
    if (!rt || typeof rt.active !== 'string') return '';
    return rt.active;
  }

  function spaceRuntime(rt, name) {
    if (!rt || typeof rt !== 'object') return null;
    if (!rt.spaces || typeof rt.spaces !== 'object') rt.spaces = {};
    var s = rt.spaces[name];
    if (!s || typeof s !== 'object') {
      s = { x: 0, y: 0, frameIndex: 0, frameTimer: 0 };
      rt.spaces[name] = s;
    }
    return s;
  }

  // Set the blend values and activate the named blend space.
  // hooks = { warn(msg) } — optional.
  // Returns true when the blend was set. Blank names are a quiet no-op
  // (no per-frame warning spam); unknown names warn and hold the old
  // blend. Never throws.
  function setBlend(rt, obj, name, x, y, hooks) {
    try {
      if (!rt || !obj || typeof obj !== 'object') return false;
      var want = String(name == null ? '' : name).trim();
      if (!want) return false;
      var bs = getBlendSpace(obj, want);
      if (!bs) {
        if (hooks && typeof hooks.warn === 'function') {
          hooks.warn('Set Blend: no blend space named "' + want + '" on this object. The blend was not changed.');
        }
        return false;
      }
      var s = spaceRuntime(rt, bs.name);
      s.x = saneNum(x);
      s.y = saneNum(y);
      rt.active = bs.name;
      return true;
    } catch (e) {
      return false;
    }
  }

  // Stop the named blend space. A blank name stops whichever blend is
  // active. Quiet by design: stopping an inactive blend is not an error.
  function stopBlend(rt, obj, name) {
    try {
      if (!rt || typeof rt !== 'object') return false;
      var want = String(name == null ? '' : name).trim();
      if (!want) { rt.active = ''; return true; }
      if (rt.active === want) rt.active = '';
      return true;
    } catch (e) {
      return false;
    }
  }

  // True while the named blend space is the active one. Blank names read
  // false (quiet, like the other state reads).
  function isBlendActive(rt, name) {
    try {
      var want = String(name == null ? '' : name).trim();
      if (!want) return false;
      return activeBlendName(rt) === want;
    } catch (e) {
      return false;
    }
  }

  // Advance the active blend's shared frame clock (loop mode) by dtFrames
  // (in 60fps-frame units, the unit both runtimes use). If the blend was
  // deleted mid-run, it quietly deactivates. Never throws.
  function updateBlend(rt, obj, dtFrames) {
    try {
      var name = activeBlendName(rt);
      if (!name || !obj || typeof obj !== 'object') return;
      var bs = getBlendSpace(obj, name);
      if (!bs) { rt.active = ''; return; }
      var s = spaceRuntime(rt, bs.name);
      var dt = Number(dtFrames);
      if (!isFinite(dt) || dt <= 0) dt = 1;
      var msPerFrame = 1000 / bs.fps;
      s.frameTimer += dt * (1000 / 60);
      var guard = 0;
      while (s.frameTimer >= msPerFrame && guard++ < 64) {
        s.frameTimer -= msPerFrame;
        s.frameIndex++;
      }
    } catch (e) { /* never throws */ }
  }

  // The weighted frame list for drawing: [{ assetId, alpha }, ...].
  // The first entry draws at full alpha; a second entry (when present)
  // draws at its alpha — the crossfade. framesOf(animationName) must
  // return the animation's frame asset-id array ([] when missing).
  // Returns [] when no blend is active, the blend has no drawable points,
  // or the inputs are hostile.
  function blendFrameList(rt, obj, framesOf) {
    try {
      var name = activeBlendName(rt);
      if (!name || !obj || typeof obj !== 'object') return [];
      var bs = getBlendSpace(obj, name);
      if (!bs || bs.points.length === 0) return [];
      var s = spaceRuntime(rt, bs.name);
      var resolve = (typeof framesOf === 'function') ? framesOf : function () { return []; };
      var scored = [];
      for (var i = 0; i < bs.points.length; i++) {
        var p = bs.points[i];
        var frames = resolve(p.animation);
        if (!frames || frames.length === 0) continue;
        var dx = s.x - p.x, dy = s.y - p.y;
        var d2 = dx * dx + dy * dy;
        // Exact hit: infinite weight, wins outright.
        var w = (d2 < 1e-12) ? Infinity : 1 / d2;
        var fi = ((s.frameIndex || 0) % frames.length + frames.length) % frames.length;
        scored.push({ w: w, assetId: frames[fi] });
      }
      if (scored.length === 0) return [];
      scored.sort(function (a, b) { return b.w - a.w; });
      var out = [{ assetId: scored[0].assetId, alpha: 1 }];
      // A finite top weight means the runner-up is finite too (sorted
      // descending), so this division is always safe.
      if (scored.length > 1 && isFinite(scored[0].w)) {
        var alpha2 = scored[1].w / (scored[0].w + scored[1].w);
        if (alpha2 > 0.001) out.push({ assetId: scored[1].assetId, alpha: alpha2 });
      }
      return out;
    } catch (e) {
      return [];
    }
  }

  return {
    DEFAULT_FPS: DEFAULT_FPS,
    normalizeBlendSpaces: normalizeBlendSpaces,
    blendSpaceNames: blendSpaceNames,
    getBlendSpace: getBlendSpace,
    createBlendRuntime: createBlendRuntime,
    activeBlendName: activeBlendName,
    setBlend: setBlend,
    stopBlend: stopBlend,
    isBlendActive: isBlendActive,
    updateBlend: updateBlend,
    blendFrameList: blendFrameList
  };
}

window.HydraBlendSpace = hydraBlendSpaceFactory();
// Self-contained source of the factory, inlined into exported playable games
// by HydraPlayer.buildPlayableHtml so exports run without editor files.
window.HydraBlendSpace.factorySource = hydraBlendSpaceFactory.toString();
