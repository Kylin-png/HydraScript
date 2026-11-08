/* ============================================================================
 * hydra-spatialaudio.js — HydraScript shared positional / spatial audio
 * (P4 Advanced batch 17: sounds that live somewhere, beginner edition).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation
 * of how a sound's loudness and stereo position follow its place in the
 * world — used by:
 *   - the editor preview runtime (hydra-previewruntime.js delegates
 *     to it, and script.js pans through it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Idea (Unity AudioSource spatial blend / Godot AudioStreamPlayer2D,
 * beginner edition): a sound is played AT something — an object, or a
 * bare X/Y point — and the listener is the center of the screen. The
 * further the source is from the listener, the quieter it gets; the
 * further left or right it sits, the more it pans that way. A coin
 * jingles as you walk up to it, an enemy growls from the left, a
 * waterfall fades as you leave the room — all from one block.
 *
 *   maxDistance — the hear-within distance in world pixels (default
 *     600, clamped 50..5000). At the listener the sound is full
 *     volume; at maxDistance it is silent; past it nothing plays at
 *     all (no voice is taken — being out of earshot is the feature
 *     working, not an error). The falloff is linear: half the
 *     distance is half the volume, so the numbers stay easy to
 *     reason about.
 *   pan — -1 (hard left) .. 0 (center) .. 1 (hard right), from how
 *     far left or right the source sits relative to the listener,
 *     divided by maxDistance. A source at the listener pans center.
 *
 * The mix rides on the playSound data record: the execute module
 * pre-scales data.volume by the mix volume and sets data.pan, then
 * calls the host's playSound as usual — so the bus math, the master
 * fader, and the per-cell cooldowns downstream all see the final
 * values, and plain Play Sound calls are untouched (no pan field
 * means centered, full volume, exactly as before).
 *
 * Nothing ever throws; hostile input degrades to safe defaults.
 * Old projects have no spatial blocks and sound exactly as before.
 *
 * Honest limits: linear falloff only (no inverse / logarithmic
 * curves); the listener is always the center of the screen (no
 * follow-an-object listener, no Doppler); stereo pan only reaches
 * sounds played through the WebAudio graph (built-in tones and
 * decoded SFX/UI assets) — a streamed track (a Music-bus asset,
 * or any asset the runtime falls back to an <audio> element for)
 * still gets the distance volume, but no left/right pan, because
 * an <audio> element has no panner node; there is no hs
 * script-API surface yet.
 *
 * Load order (index.html): hydra-spatialaudio.js BEFORE
 * player-runtime.js and script.js. player-runtime.js throws a clear
 * error if HydraSpatialAudio is missing.
 * ========================================================================== */

function hydraSpatialAudioFactory() {
  'use strict';

  var DEFAULT_MAX_DISTANCE = 600;
  var MIN_MAX_DISTANCE = 50;
  var MAX_MAX_DISTANCE = 5000;

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

  // One hear-within distance: 50..5000 world pixels, default 600.
  // Non-numeric reads as 600 — a typo hears at the default range
  // instead of silencing the world or hearing across it.
  function normalizeMaxDistance(value) {
    if (value == null || value === '') return DEFAULT_MAX_DISTANCE;
    var n = Number(value);
    if (!isFinite(n)) return DEFAULT_MAX_DISTANCE;
    return clamp(n, MIN_MAX_DISTANCE, MAX_MAX_DISTANCE);
  }

  // One stereo pan: -1 (hard left) .. 1 (hard right), 0 centered.
  // Non-numeric reads as 0 — a typo plays centered instead of
  // throwing the sound to one ear.
  function normalizePan(value) {
    if (value == null || value === '') return 0;
    var n = Number(value);
    if (!isFinite(n)) return 0;
    return clamp(n, -1, 1);
  }

  // The listener: the center of the screen, in world coordinates.
  // The camera record holds the top-left of the view (camera.x/y)
  // and the zoom; the canvas size is in screen pixels, so half the
  // canvas divided by the zoom is half the view in world pixels. A
  // missing camera reads as the origin at zoom 1; a zero or negative
  // zoom reads as 1 (it cannot be a real zoom). Never throws.
  function listenerOf(camera, canvasWidth, canvasHeight) {
    try {
      var z = saneNum(camera && camera.zoom, 1);
      if (z <= 0) z = 1;
      var cw = saneNum(canvasWidth, 0);
      var ch = saneNum(canvasHeight, 0);
      return {
        x: saneNum(camera && camera.x, 0) + cw / (2 * z),
        y: saneNum(camera && camera.y, 0) + ch / (2 * z)
      };
    } catch (err) {
      return { x: 0, y: 0 };
    }
  }

  // The center of an object, in world coordinates — the same center
  // Center Camera On uses (pos + half the size). A missing object
  // reads as the origin. Never throws.
  function objectCenter(obj) {
    try {
      if (!obj || typeof obj !== 'object') return { x: 0, y: 0 };
      return {
        x: saneNum(obj.posX, 0) + saneNum(obj.width, 0) / 2,
        y: saneNum(obj.posY, 0) + saneNum(obj.height, 0) / 2
      };
    } catch (err) {
      return { x: 0, y: 0 };
    }
  }

  // The mix for one source against one listener: { volume, pan }.
  // Volume falls off linearly with distance — full at the listener,
  // silent at maxDistance, clamped to 0 past it. Pan follows how
  // far left or right the source sits, divided by maxDistance and
  // clamped to the hard-left / hard-right rails. A missing source
  // or listener reads as the origin, like every other reader in
  // this module. Never throws.
  function spatialMix(source, listener, maxDistance) {
    try {
      var md = normalizeMaxDistance(maxDistance);
      var dx = saneNum(source && source.x, 0) - saneNum(listener && listener.x, 0);
      var dy = saneNum(source && source.y, 0) - saneNum(listener && listener.y, 0);
      var dist = Math.sqrt(dx * dx + dy * dy);
      return {
        volume: clamp(1 - dist / md, 0, 1),
        pan: clamp(dx / md, -1, 1)
      };
    } catch (err) {
      return { volume: 1, pan: 0 };
    }
  }

  function isSpatialAudioAction(type) {
    return type === 'playSoundAtPosition';
  }

  function isSpatialAudioCondition(type) {
    return false;
  }

  return {
    DEFAULT_MAX_DISTANCE: DEFAULT_MAX_DISTANCE,
    MIN_MAX_DISTANCE: MIN_MAX_DISTANCE,
    MAX_MAX_DISTANCE: MAX_MAX_DISTANCE,
    normalizeMaxDistance: normalizeMaxDistance,
    normalizePan: normalizePan,
    listenerOf: listenerOf,
    objectCenter: objectCenter,
    spatialMix: spatialMix,
    isSpatialAudioAction: isSpatialAudioAction,
    isSpatialAudioCondition: isSpatialAudioCondition
  };
}

if (typeof window !== 'undefined') {
  window.HydraSpatialAudio = hydraSpatialAudioFactory();
  // Self-contained source of the factory, inlined into exported playable games
  // by HydraPlayer.buildPlayableHtml so exports run without editor files.
  window.HydraSpatialAudio.factorySource = hydraSpatialAudioFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraSpatialAudioFactory;
