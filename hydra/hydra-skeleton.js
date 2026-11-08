/* ============================================================================
 * hydra-skeleton.js — HydraScript shared 2D skeletal animation.
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation
 * of skeletal animation used by:
 *   - the editor preview runtime (script.js delegates to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Idea (Spine / DragonBones, beginner edition): an object carries a BONE
 * RIG — a small tree of named bones — plus named skeletal ANIMATIONS,
 * which are keyframed angle tracks, one angle list per bone. A walk cycle
 * is four numbers on a leg bone, not four redrawn sprites:
 *
 *   bones: leg (root, length 40, angle 90) with child shin (length 36)
 *   animation "Walk": leg track [80, 100, 80, 100], shin track [90, 60, 90, 60]
 *
 * Bones anchor at the object's center (the root bone) and chain from
 * parent tip to child joint, so posing one bone swings everything below
 * it — a shoulder turn moves the whole arm. Angles are degrees, 0 points
 * right and 90 points down (screen coordinates, like object rotation),
 * and a bone's world angle is its own angle plus every ancestor's angle
 * plus the object's rotation (the rotation is applied by the host's draw
 * transform, so the module's segments are rotation-free local offsets).
 *
 * Data model (stored on the object, saved in project JSON):
 *   obj.skeleton = {
 *     hideSprite: false,   // true: draw bones only, skip the sprite
 *     bones: [{ name: 'arm', parent: '', length: 50, angle: 0,
 *               color: '#f59e0b', image: '', width: 10 }],
 *     animations: [{ name: 'Wave', fps: 8, mode: 'loop',
 *                    tracks: [{ bone: 'arm', angles: [0, 40, 0, -40] }] }]
 *   };
 * A bone with no image draws as a thick round-capped limb line in its
 * color; a bone with an image asset draws that image stretched along the
 * bone (draw limb art as a horizontal strip). A bone with length 0 is a
 * pivot — it draws only a joint dot, and its children hang off it.
 *
 * Runtime state (NOT saved; per object, created fresh at game/scene start):
 *   { active: 'Wave', finished: false,
 *     anims: { Wave: { frameIndex, frameTimer, dir } },
 *     overrides: { arm: 30 } }
 * Only ONE skeletal animation is active per object at a time (like one
 * playing sprite animation). Set Bone Angle writes an override, which
 * wins over a playing track — the layering on-ramp (a walk cycle plus a
 * hand-aimed arm). Starting a new skeletal animation clears overrides so
 * the new animation poses cleanly; stopping one does not clear them, so
 * a posed bone stays posed while the character idles.
 *
 * Modes: loop wraps, pingpong bounces between the first and last frame,
 * once holds the last frame and reports finished (Skeleton Playing goes
 * false, the pose stays). A track shorter than the animation wraps at
 * its own length; the animation's frame count is its longest track.
 * Bones draw over the sprite by default; hideSprite draws bones only, so
 * a pure stick figure needs no sprite art at all.
 *
 * Honest limits: bones are 2D only, they carry no collision (the object
 * keeps its normal box/circle collider), bone images stretch to the
 * bone's length and thickness rather than keeping aspect ratio, and
 * there is no inverse kinematics — the user poses angles directly.
 * Old projects have no skeleton field and behave exactly as before.
 *
 * Load order (index.html): hydra-skeleton.js BEFORE player-runtime.js and
 * script.js. player-runtime.js throws a clear error if HydraSkeleton is
 * missing.
 * ========================================================================== */

function hydraSkeletonFactory() {
  'use strict';

  var DEFAULT_FPS = 8;
  var DEFAULT_LENGTH = 40;
  var DEFAULT_WIDTH = 10;
  var MODES = ['loop', 'pingpong', 'once'];

  function saneName(v, fallback) {
    var s = String(v == null ? '' : v).trim();
    return s.length ? s : fallback;
  }

  function saneNum(v, fallback) {
    var n = Number(v);
    return isFinite(n) ? n : (fallback || 0);
  }

  function saneFps(v) {
    var f = Number(v);
    return (isFinite(f) && f > 0) ? f : DEFAULT_FPS;
  }

  function saneLen(v) {
    var n = Number(v);
    return (isFinite(n) && n >= 0) ? n : DEFAULT_LENGTH;
  }

  function saneWidth(v) {
    var n = Number(v);
    return (isFinite(n) && n > 0) ? Math.min(64, n) : DEFAULT_WIDTH;
  }

  function isMode(m) {
    return MODES.indexOf(m) !== -1;
  }

  // Normalize an object's skeleton IN PLACE — fields are repaired on the
  // existing bone/animation/track objects and corrupt entries are
  // spliced out, so the skeleton object and its arrays keep their
  // identity across calls. That identity matters: the Inspector section
  // holds bone and animation references while it renders, and a
  // wholesale replacement (the first version of this function) orphaned
  // them — the section's mini preview re-normalizes mid-build, so every
  // later edit landed on a detached object and vanished on refresh.
  // Corrupt/hand-edited entries are repaired (blank bone/animation
  // names filled, duplicate names suffixed, parents that name no bone —
  // or the bone itself — reset to the root, bad lengths/widths/fps
  // repaired, tracks with blank bones or no angles dropped, duplicate
  // tracks per bone collapsed to the first), so old projects (no
  // `skeleton` field at all) and malformed data keep working instead of
  // crashing. Never throws.
  function normalizeSkeleton(obj) {
    try {
      if (!obj || typeof obj !== 'object') {
        return { hideSprite: false, bones: [], animations: [] };
      }
      var sk = obj.skeleton;
      if (!sk || typeof sk !== 'object') {
        obj.skeleton = { hideSprite: false, bones: [], animations: [] };
        return obj.skeleton;
      }
      if (!Array.isArray(sk.bones)) sk.bones = [];
      if (!Array.isArray(sk.animations)) sk.animations = [];
      sk.hideSprite = sk.hideSprite === true;
      for (var i = sk.bones.length - 1; i >= 0; i--) {
        if (!sk.bones[i] || typeof sk.bones[i] !== 'object') sk.bones.splice(i, 1);
      }
      var seen = {};
      for (var j = 0; j < sk.bones.length; j++) {
        var b = sk.bones[j];
        var name = saneName(b.name, 'Bone ' + (j + 1));
        if (seen[name]) name = name + ' ' + (j + 1);
        seen[name] = true;
        b.name = name;
        b.parent = String(b.parent == null ? '' : b.parent).trim();
        b.length = saneLen(b.length);
        b.angle = saneNum(b.angle, 0);
        b.color = String(b.color == null ? '' : b.color).trim();
        b.image = String(b.image == null ? '' : b.image).trim();
        b.width = saneWidth(b.width);
      }
      var names = {};
      for (var k = 0; k < sk.bones.length; k++) names[sk.bones[k].name] = true;
      for (var m = 0; m < sk.bones.length; m++) {
        if (!names[sk.bones[m].parent] || sk.bones[m].parent === sk.bones[m].name) sk.bones[m].parent = '';
      }
      for (var a = sk.animations.length - 1; a >= 0; a--) {
        if (!sk.animations[a] || typeof sk.animations[a] !== 'object') sk.animations.splice(a, 1);
      }
      var seenA = {};
      for (var x = 0; x < sk.animations.length; x++) {
        var an = sk.animations[x];
        var aname = saneName(an.name, 'Pose ' + (x + 1));
        if (seenA[aname]) aname = aname + ' ' + (x + 1);
        seenA[aname] = true;
        an.name = aname;
        an.fps = saneFps(an.fps);
        an.mode = isMode(an.mode) ? an.mode : 'loop';
        if (!Array.isArray(an.tracks)) an.tracks = [];
        for (var t = an.tracks.length - 1; t >= 0; t--) {
          if (!an.tracks[t] || typeof an.tracks[t] !== 'object') an.tracks.splice(t, 1);
        }
        // Forward scan with a held index: the FIRST track per bone wins,
        // later duplicates and invalid tracks are spliced out.
        var seenT = {};
        for (var y = 0; y < an.tracks.length;) {
          var tr = an.tracks[y];
          var bn = String(tr.bone == null ? '' : tr.bone).trim();
          var angs = Array.isArray(tr.angles) ? tr.angles : [];
          var nums = [];
          for (var q = 0; q < angs.length; q++) nums.push(saneNum(angs[q], 0));
          if (!bn || seenT[bn] || nums.length === 0) { an.tracks.splice(y, 1); continue; }
          seenT[bn] = true;
          tr.bone = bn;
          tr.angles = nums;
          y++;
        }
      }
      return sk;
    } catch (e) {
      return { hideSprite: false, bones: [], animations: [] };
    }
  }

  function skeletonBoneNames(obj) {
    return normalizeSkeleton(obj).bones.map(function (b) { return b.name; });
  }

  function skeletonAnimationNames(obj) {
    return normalizeSkeleton(obj).animations.map(function (a) { return a.name; });
  }

  // The bone with exactly this name, or null.
  function getBone(obj, name) {
    try {
      var want = String(name == null ? '' : name).trim();
      if (!want) return null;
      var bones = normalizeSkeleton(obj).bones;
      for (var i = 0; i < bones.length; i++) {
        if (bones[i].name === want) return bones[i];
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  // The skeletal animation with exactly this name, or null.
  function getSkeletonAnimation(obj, name) {
    try {
      var want = String(name == null ? '' : name).trim();
      if (!want) return null;
      var anims = normalizeSkeleton(obj).animations;
      for (var i = 0; i < anims.length; i++) {
        if (anims[i].name === want) return anims[i];
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  function createSkeletonRuntime() {
    return { active: '', finished: false, anims: {}, overrides: {} };
  }

  function activeSkeletonName(rt) {
    if (!rt || typeof rt.active !== 'string') return '';
    return rt.active;
  }

  // The animation's frame count: its longest track, at least 1.
  function maxTrackFrames(anim) {
    try {
      if (!anim || !Array.isArray(anim.tracks)) return 1;
      var max = 1;
      for (var i = 0; i < anim.tracks.length; i++) {
        var t = anim.tracks[i];
        if (t && Array.isArray(t.angles) && t.angles.length > max) max = t.angles.length;
      }
      return max;
    } catch (e) {
      return 1;
    }
  }

  function animState(rt, name) {
    if (!rt || typeof rt !== 'object') return null;
    if (!rt.anims || typeof rt.anims !== 'object') rt.anims = {};
    var s = rt.anims[name];
    if (!s || typeof s !== 'object') {
      s = { frameIndex: 0, frameTimer: 0, dir: 1 };
      rt.anims[name] = s;
    }
    return s;
  }

  // Play the named skeletal animation. hooks = { warn(msg) } — optional.
  // Returns true when the animation started. Blank names are a quiet
  // no-op; unknown names warn and hold the old animation. Re-playing the
  // same animation keeps its clock (so an Every Frame play does not
  // restart the cycle), unless it finished a once run — then it replays
  // from the first frame. Starting a new animation clears bone overrides
  // so the new animation poses cleanly. Never throws.
  function setSkeletonAnimation(rt, obj, name, hooks) {
    try {
      if (!rt || !obj || typeof obj !== 'object') return false;
      var want = String(name == null ? '' : name).trim();
      if (!want) return false;
      var anim = getSkeletonAnimation(obj, want);
      if (!anim) {
        if (hooks && typeof hooks.warn === 'function') {
          hooks.warn('Play Skeleton Animation: no skeletal animation named "' + want + '" on this object. The animation was not changed.');
        }
        return false;
      }
      var restart = (rt.active !== anim.name) || !!rt.finished;
      rt.active = anim.name;
      rt.finished = false;
      rt.overrides = {};
      if (restart) {
        if (!rt.anims || typeof rt.anims !== 'object') rt.anims = {};
        rt.anims[anim.name] = { frameIndex: 0, frameTimer: 0, dir: 1 };
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  // Stop the named skeletal animation. A blank name stops whichever
  // animation is active. Quiet by design: stopping an inactive animation
  // is not an error, and overrides are left alone so a posed bone stays
  // posed while the character idles.
  function stopSkeletonAnimation(rt, obj, name) {
    try {
      if (!rt || typeof rt !== 'object') return false;
      var want = String(name == null ? '' : name).trim();
      if (!want) { rt.active = ''; rt.finished = false; return true; }
      if (rt.active === want) { rt.active = ''; rt.finished = false; }
      return true;
    } catch (e) {
      return false;
    }
  }

  // True while the named skeletal animation is playing (a finished once
  // run reports false — the pose holds, the playing stops). Blank names
  // read false (quiet, like the other state reads).
  function isSkeletonActive(rt, name) {
    try {
      var want = String(name == null ? '' : name).trim();
      if (!want) return false;
      return activeSkeletonName(rt) === want && !rt.finished;
    } catch (e) {
      return false;
    }
  }

  // Pose one bone by hand. hooks = { warn(msg) } — optional. Blank bone
  // names stay quiet; unknown bones and bad angles warn and hold. The
  // override wins over a playing track until a new skeletal animation
  // starts (which clears overrides). Never throws.
  function setBoneAngle(rt, obj, boneName, angle, hooks) {
    try {
      if (!rt || !obj || typeof obj !== 'object') return false;
      var want = String(boneName == null ? '' : boneName).trim();
      if (!want) return false;
      var bone = getBone(obj, want);
      if (!bone) {
        if (hooks && typeof hooks.warn === 'function') {
          hooks.warn('Set Bone Angle: no bone named "' + want + '" on this object. The pose was not changed.');
        }
        return false;
      }
      var a = Number(angle);
      if (!isFinite(a)) {
        if (hooks && typeof hooks.warn === 'function') {
          hooks.warn('Set Bone Angle: bad angle — skipped.');
        }
        return false;
      }
      if (!rt.overrides || typeof rt.overrides !== 'object') rt.overrides = {};
      rt.overrides[bone.name] = a;
      return true;
    } catch (e) {
      return false;
    }
  }

  // Advance the active animation's frame clock (loop / pingpong / once)
  // by dtFrames (in 60fps-frame units, the unit both runtimes use). If
  // the animation was deleted mid-run, it quietly deactivates. A
  // finished once run stays finished until played again. Never throws.
  function updateSkeleton(rt, obj, dtFrames) {
    try {
      if (!rt || typeof rt !== 'object') return;
      var name = activeSkeletonName(rt);
      if (!name || rt.finished) return;
      var anim = getSkeletonAnimation(obj, name);
      if (!anim) { rt.active = ''; rt.finished = false; return; }
      var st = animState(rt, name);
      var frames = maxTrackFrames(anim);
      var dt = Number(dtFrames);
      if (!isFinite(dt) || dt <= 0) dt = 1;
      var msPerFrame = 1000 / anim.fps;
      st.frameTimer += dt * (1000 / 60);
      var guard = 0;
      while (st.frameTimer >= msPerFrame && guard++ < 64) {
        st.frameTimer -= msPerFrame;
        if (anim.mode === 'pingpong') {
          if (frames <= 1) { st.frameTimer = 0; break; }
          st.frameIndex += (st.dir || 1);
          if (st.frameIndex >= frames - 1) { st.frameIndex = frames - 1; st.dir = -1; }
          else if (st.frameIndex <= 0) { st.frameIndex = 0; st.dir = 1; }
        } else if (anim.mode === 'once') {
          if (st.frameIndex < frames - 1) st.frameIndex++;
          else { rt.finished = true; st.frameTimer = 0; break; }
        } else {
          st.frameIndex = (st.frameIndex + 1) % frames;
        }
      }
    } catch (e) { /* never throws */ }
  }

  // Every bone's current LOCAL angle: override wins, then the playing
  // track's angle at the current frame (each track wraps at its own
  // length), then the bone's base angle. A null runtime reads base
  // angles only (the rest pose the Inspector preview draws). Never throws.
  function currentBoneAngles(rt, obj) {
    try {
      var sk = normalizeSkeleton(obj);
      var out = {};
      var active = activeSkeletonName(rt);
      var anim = active ? getSkeletonAnimation(obj, active) : null;
      var st = (rt && rt.anims && rt.anims[active]) || null;
      var fi = st ? (st.frameIndex || 0) : 0;
      var trackByBone = {};
      if (anim) {
        for (var i = 0; i < anim.tracks.length; i++) {
          trackByBone[anim.tracks[i].bone] = anim.tracks[i].angles;
        }
      }
      for (var b = 0; b < sk.bones.length; b++) {
        var bone = sk.bones[b];
        var a = bone.angle;
        var ov = rt && rt.overrides ? rt.overrides[bone.name] : undefined;
        if (typeof ov === 'number' && isFinite(ov)) {
          a = ov;
        } else if (trackByBone[bone.name] && trackByBone[bone.name].length > 0) {
          var arr = trackByBone[bone.name];
          a = arr[((fi % arr.length) + arr.length) % arr.length];
        }
        out[bone.name] = a;
      }
      return out;
    } catch (e) {
      return {};
    }
  }

  // Bone segments in OBJECT-LOCAL coordinates, origin at the object
  // center: [{ name, x1, y1, x2, y2, angle, length, color, image, width }].
  // The root bone starts at (0, 0); each child starts at its parent's
  // tip; a bone's world angle is its local angle plus every ancestor's.
  // The host draws these inside its sprite transform (which already
  // applies the object's rotation, flip, scale, camera, and zoom), so the
  // segments carry no object rotation. Parent cycles fall back to the
  // root instead of looping forever. Never throws.
  function boneSegmentsLocal(obj, angles) {
    try {
      var sk = normalizeSkeleton(obj);
      var map = {};
      for (var i = 0; i < sk.bones.length; i++) map[sk.bones[i].name] = sk.bones[i];
      var memo = {};
      function resolve(bone, guard) {
        if (memo[bone.name]) return memo[bone.name];
        if (guard[bone.name]) return { x: 0, y: 0, angle: 0 };
        guard[bone.name] = true;
        var local = (angles && isFinite(Number(angles[bone.name])))
          ? Number(angles[bone.name]) : bone.angle;
        var res;
        if (!bone.parent || !map[bone.parent]) {
          res = { x: 0, y: 0, angle: local };
        } else {
          var p = resolve(map[bone.parent], guard);
          var pr = p.angle * Math.PI / 180;
          res = {
            x: p.x + Math.cos(pr) * map[bone.parent].length,
            y: p.y + Math.sin(pr) * map[bone.parent].length,
            angle: p.angle + local
          };
        }
        guard[bone.name] = false;
        memo[bone.name] = res;
        return res;
      }
      var segs = [];
      for (var s = 0; s < sk.bones.length; s++) {
        var b = sk.bones[s];
        var joint = resolve(b, {});
        var rad = joint.angle * Math.PI / 180;
        segs.push({
          name: b.name,
          x1: joint.x,
          y1: joint.y,
          x2: joint.x + Math.cos(rad) * b.length,
          y2: joint.y + Math.sin(rad) * b.length,
          angle: joint.angle,
          length: b.length,
          color: b.color || (obj && obj.color) || '#334155',
          image: b.image,
          width: b.width
        });
      }
      return segs;
    } catch (e) {
      return [];
    }
  }

  // Draw bone segments on a canvas context (the host has already applied
  // its sprite transform, so segments are local to the object center).
  // Bones with a resolvable complete image draw it stretched along the
  // bone; the rest draw as thick round-capped lines; every joint gets a
  // dot on top so the rig reads at a glance. resolveImage(assetId) must
  // return an image-like object or null. A hostile context never breaks
  // the frame. Never throws.
  function drawSkeleton(ctx, segments, resolveImage) {
    try {
      if (!ctx || !Array.isArray(segments) || segments.length === 0) return;
      var resolve = (typeof resolveImage === 'function') ? resolveImage : function () { return null; };
      ctx.save();
      try {
        for (var i = 0; i < segments.length; i++) {
          var s = segments[i];
          if (!s || typeof s !== 'object') continue;
          var len = Number(s.length);
          if (!(len > 0)) continue; // zero-length bones are pivots: dot only
          var w = Number(s.width) || DEFAULT_WIDTH;
          var img = null;
          try { img = s.image ? resolve(s.image) : null; } catch (e) { img = null; }
          if (img && img.complete && img.naturalWidth > 0) {
            ctx.save();
            ctx.translate(s.x1, s.y1);
            ctx.rotate((Number(s.angle) || 0) * Math.PI / 180);
            try { ctx.drawImage(img, 0, -w / 2, len, w); } catch (e) { /* broken image: skip */ }
            ctx.restore();
          } else {
            ctx.save();
            ctx.strokeStyle = s.color || '#334155';
            ctx.lineWidth = w;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(s.x1, s.y1);
            ctx.lineTo(s.x2, s.y2);
            ctx.stroke();
            ctx.restore();
          }
        }
        for (var j = 0; j < segments.length; j++) {
          var d = segments[j];
          if (!d || typeof d !== 'object') continue;
          var dw = Number(d.width) || DEFAULT_WIDTH;
          ctx.save();
          ctx.fillStyle = d.color || '#334155';
          ctx.beginPath();
          ctx.arc(d.x1, d.y1, Math.max(2, dw / 2), 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      } finally {
        try { ctx.restore(); } catch (e) { /* hostile context */ }
      }
    } catch (e) { /* never throws */ }
  }

  function isSkeletonAction(type) {
    return type === 'playSkeletonAnimation' || type === 'stopSkeletonAnimation' ||
      type === 'setBoneAngle';
  }

  function isSkeletonCondition(type) {
    return type === 'skeletonPlaying';
  }

  return {
    DEFAULT_FPS: DEFAULT_FPS,
    DEFAULT_LENGTH: DEFAULT_LENGTH,
    DEFAULT_WIDTH: DEFAULT_WIDTH,
    MODES: MODES,
    normalizeSkeleton: normalizeSkeleton,
    skeletonBoneNames: skeletonBoneNames,
    skeletonAnimationNames: skeletonAnimationNames,
    getBone: getBone,
    getSkeletonAnimation: getSkeletonAnimation,
    createSkeletonRuntime: createSkeletonRuntime,
    activeSkeletonName: activeSkeletonName,
    maxTrackFrames: maxTrackFrames,
    setSkeletonAnimation: setSkeletonAnimation,
    stopSkeletonAnimation: stopSkeletonAnimation,
    isSkeletonActive: isSkeletonActive,
    setBoneAngle: setBoneAngle,
    updateSkeleton: updateSkeleton,
    currentBoneAngles: currentBoneAngles,
    boneSegmentsLocal: boneSegmentsLocal,
    drawSkeleton: drawSkeleton,
    isSkeletonAction: isSkeletonAction,
    isSkeletonCondition: isSkeletonCondition
  };
}

window.HydraSkeleton = hydraSkeletonFactory();
// Self-contained source of the factory, inlined into exported playable games
// by HydraPlayer.buildPlayableHtml so exports run without editor files.
window.HydraSkeleton.factorySource = hydraSkeletonFactory.toString();
