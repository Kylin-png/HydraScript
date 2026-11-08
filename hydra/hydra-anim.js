/* ============================================================================
 * hydra-anim.js — HydraScript shared sprite-animation helpers.
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation of
 * sprite animation playback used by:
 *   - the editor preview runtime (script.js delegates to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Data model (stored on the object, saved in project JSON):
 *   obj.animations = [
 *     { name: 'Walk', mode: 'loop'|'pingpong'|'once', fps: 8,
 *       frames: ['<assetId>', '<assetId>'] }
 *   ];
 *   obj.startAnimation = 'Walk';  // optional: plays when the game starts
 *
 * Runtime state (NOT saved; per object, created fresh at game start):
 *   { playing, name, frameIndex, frameTimer, dir, finished, speed }
 * (speed is the playback-speed multiplier, 1 = normal; set via setSpeed(),
 * used by animation state machines.)
 *
 * Modes:
 *   loop     — wraps from the last frame back to the first, forever.
 *   pingpong — bounces first->last->first, forever.
 *   once     — plays through a single time, then stops on the last frame
 *              and sets finished=true (the On Animation Finished condition
 *              fires exactly once per finished run).
 *
 * Load order (index.html): hydra-anim.js BEFORE player-runtime.js and
 * script.js. player-runtime.js throws a clear error if HydraAnim is missing.
 * ========================================================================== */

function hydraAnimFactory() {
  'use strict';

  var MODES = ['loop', 'pingpong', 'once'];
  var DEFAULT_FPS = 8;
  var MS_PER_60FPS_FRAME = 1000 / 60;

  // Normalize an animation list in place. Corrupt/hand-edited entries are
  // repaired (bad mode -> 'loop', bad fps -> 8, non-array frames -> []),
  // so old projects (no `animations` field at all) and malformed data keep
  // working instead of crashing playback.
  function normalizeAnimations(obj) {
    if (!obj || typeof obj !== 'object') return [];
    var list = obj.animations;
    if (!Array.isArray(list)) { obj.animations = []; return obj.animations; }
    var seen = {};
    obj.animations = list.filter(function (a) {
      return a && typeof a === 'object';
    }).map(function (a, i) {
      var name = String(a.name || '').trim() || ('Animation ' + (i + 1));
      if (seen[name]) name = name + ' ' + (i + 1);
      seen[name] = true;
      var mode = MODES.indexOf(a.mode) >= 0 ? a.mode : 'loop';
      var fps = Number(a.fps);
      if (!isFinite(fps) || fps <= 0) fps = DEFAULT_FPS;
      var frames = Array.isArray(a.frames)
        ? a.frames.filter(function (f) { return typeof f === 'string' && f.length > 0; })
        : [];
      return { name: name, mode: mode, fps: fps, frames: frames };
    });
    return obj.animations;
  }

  function getAnimation(obj, name) {
    var list = normalizeAnimations(obj);
    var want = String(name || '');
    for (var i = 0; i < list.length; i++) {
      if (list[i].name === want) return list[i];
    }
    return null;
  }

  function createAnimState() {
    return {
      playing: false,
      name: '',
      frameIndex: 0,
      frameTimer: 0, // milliseconds accumulated toward the next frame
      dir: 1,        // ping-pong direction: 1 forward, -1 backward
      finished: false,
      speed: 1       // playback-speed multiplier (animation state machines)
    };
  }

  // Start (or restart) the named animation from its first frame.
  // Returns true when the animation exists; false leaves state untouched.
  // Resets the playback speed to 1 — callers that want a different speed
  // (the state machine) call setSpeed() right after.
  function play(state, obj, name) {
    var anim = getAnimation(obj, name);
    if (!anim || !state) return false;
    state.playing = anim.frames.length > 0;
    state.name = anim.name;
    state.frameIndex = 0;
    state.frameTimer = 0;
    state.dir = 1;
    state.finished = false;
    state.speed = 1;
    return true;
  }

  // Switch to the named animation WITHOUT restarting: keeps the current
  // frame index (clamped to the new animation's length). Useful for swapping
  // variants (e.g. Walk -> WalkHurt) seamlessly.
  // Returns true when the animation exists; false leaves state untouched.
  // Resets the playback speed to 1 (see play()).
  function setAnimation(state, obj, name) {
    var anim = getAnimation(obj, name);
    if (!anim || !state) return false;
    state.playing = anim.frames.length > 0;
    state.name = anim.name;
    state.frameIndex = Math.min(state.frameIndex || 0, Math.max(0, anim.frames.length - 1));
    state.frameTimer = 0;
    state.dir = 1;
    state.finished = false;
    state.speed = 1;
    return true;
  }

  // Set the playback-speed multiplier (1 = normal). Corrupt values repair
  // to 1. Never throws.
  function setSpeed(state, speed) {
    if (!state) return;
    var s = Number(speed);
    state.speed = (isFinite(s) && s > 0) ? s : 1;
  }

  function stop(state) {
    if (!state) return;
    state.playing = false;
    state.finished = false;
  }

  // Advance playback by dtFrames (in 60fps-frame units, the unit both
  // runtimes use). Mutates state. Never throws on bad data.
  function update(state, obj, dtFrames) {
    if (!state || !state.playing) return;
    var anim = getAnimation(obj, state.name);
    if (!anim || anim.frames.length === 0) { state.playing = false; return; }
    var spd = Number(state.speed);
    if (!isFinite(spd) || spd <= 0) spd = 1;
    var msPerFrame = 1000 / (anim.fps * spd);
    var dt = Number(dtFrames);
    if (!isFinite(dt) || dt <= 0) dt = 1;
    state.frameTimer += dt * MS_PER_60FPS_FRAME;
    var guard = 0;
    while (state.frameTimer >= msPerFrame && guard++ < 64) {
      state.frameTimer -= msPerFrame;
      advance(state, anim);
      if (!state.playing) break; // 'once' finished mid-burst
    }
  }

  function advance(state, anim) {
    var last = anim.frames.length - 1;
    if (anim.mode === 'pingpong' && anim.frames.length > 1) {
      var next = state.frameIndex + state.dir;
      if (next > last) { state.dir = -1; next = last - 1; }
      else if (next < 0) { state.dir = 1; next = 1; }
      state.frameIndex = next;
      return;
    }
    if (anim.mode === 'once') {
      if (state.frameIndex >= last) {
        // Finished: park on the last frame; the finished flag stays true
        // until play()/setAnimation()/stop() is called again.
        state.playing = false;
        state.finished = true;
        return;
      }
      state.frameIndex++;
      return;
    }
    // loop
    state.frameIndex = state.frameIndex >= last ? 0 : state.frameIndex + 1;
  }

  // The assetId of the currently displayed frame, or null when no animation
  // is playing. The caller decides the fallback (usually obj.assetId).
  function currentFrameAssetId(state, obj) {
    if (!state || !state.playing) return null;
    var anim = getAnimation(obj, state.name);
    if (!anim || anim.frames.length === 0) return null;
    var idx = Math.max(0, Math.min(state.frameIndex || 0, anim.frames.length - 1));
    return anim.frames[idx] || null;
  }

  // True when a 'once' animation run has completed. With a name, only when
  // that specific animation is the finished one.
  function isFinished(state, name) {
    if (!state || !state.finished) return false;
    if (name && String(name).length > 0) return state.name === String(name);
    return true;
  }

  return {
    MODES: MODES,
    DEFAULT_FPS: DEFAULT_FPS,
    normalizeAnimations: normalizeAnimations,
    getAnimation: getAnimation,
    createAnimState: createAnimState,
    play: play,
    setAnimation: setAnimation,
    setSpeed: setSpeed,
    stop: stop,
    update: update,
    currentFrameAssetId: currentFrameAssetId,
    isFinished: isFinished
  };
}

window.HydraAnim = hydraAnimFactory();
// Self-contained source of the factory, inlined into exported playable games
// by HydraPlayer.buildPlayableHtml so exports run without editor files.
window.HydraAnim.factorySource = hydraAnimFactory.toString();
