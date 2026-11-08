/* ============================================================================
 * hydra-buses.js — HydraScript shared audio-bus logic.
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation of
 * the Music / SFX / UI audio-bus model used by:
 *   - the editor preview runtime (script.js delegates to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * The three buses:
 *   - Music: long tracks stream through an <audio> element and are never
 *     decoded into memory; one voice (playing a new track replaces the old
 *     one); loops by default.
 *   - SFX: short sounds decoded ONCE into an AudioBuffer and kept
 *     memory-resident, so rapid repeats (jump, coin, hit) never re-fetch or
 *     re-decode; 8 simultaneous voices by default.
 *   - UI: same memory-resident decoding as SFX; 4 simultaneous voices by
 *     default, for clicks, hovers, and menu bleeps.
 *
 * Per-bus volume and mute live on the project (project.audioBuses, edited in
 * the Audio inspector tab); per-sound volume, pitch, and loop live on each
 * Play Sound block. A muted bus (or one at volume 0) plays nothing at all —
 * no voice is even acquired. When a bus is over its polyphony limit the new
 * sound is dropped silently (music is the exception: it replaces).
 *
 * Load order (index.html): hydra-buses.js BEFORE player-runtime.js and
 * script.js. player-runtime.js throws a clear error if HydraAudioBuses is
 * missing.
 * ========================================================================== */

function hydraAudioBusesFactory() {
  'use strict';

  var BUS_IDS = ['music', 'sfx', 'ui'];
  var BUS_LABELS = { music: 'Music', sfx: 'SFX', ui: 'UI' };
  // The canonical project defaults. hydra-universal.js inlines a copy for
  // normalizeProject (it loads before this module); keep the two in sync.
  var BUS_DEFAULTS = {
    music: { volume: 0.8, muted: false, maxVoices: 1 },
    sfx:   { volume: 1.0, muted: false, maxVoices: 8 },
    ui:    { volume: 1.0, muted: false, maxVoices: 4 }
  };

  function clamp01(v) {
    var n = Number(v);
    if (!isFinite(n)) return null;
    return n < 0 ? 0 : (n > 1 ? 1 : n);
  }

  // Repairs corrupt/hand-edited project data. Never throws; unknown bus ids
  // are dropped, bad fields fall back to the shipped defaults.
  function normalizeBuses(buses) {
    var out = {};
    for (var i = 0; i < BUS_IDS.length; i++) {
      (function (id) {
        var def = BUS_DEFAULTS[id];
        var raw = (buses && typeof buses === 'object') ? buses[id] : null;
        var b = (raw && typeof raw === 'object') ? raw : {};
        var vol = clamp01(b.volume);
        if (vol === null) vol = def.volume;
        var mv = Math.floor(Number(b.maxVoices));
        if (!isFinite(mv) || mv < 1) mv = def.maxVoices;
        out[id] = { volume: vol, muted: !!b.muted, maxVoices: mv };
      })(BUS_IDS[i]);
    }
    return out;
  }

  // Unknown or blank bus ids fall back to SFX, so every old Play Sound block
  // (which has no bus field) behaves exactly as before.
  function normalizeBusId(id) {
    var s = String(id == null ? '' : id).toLowerCase();
    return BUS_IDS.indexOf(s) >= 0 ? s : 'sfx';
  }

  // 1 = original pitch; 2 = one octave up, 0.5 = one octave down.
  function normalizePitch(p) {
    var n = Number(p);
    if (!isFinite(n)) return 1;
    return n < 0.25 ? 0.25 : (n > 4 ? 4 : n);
  }

  // The master fader: a single 0-1 gain applied over every bus (the
  // Unity AudioListener.volume / Godot Master-bus equivalent). Lives on
  // project.masterVolume, editable in the Audio tab and at runtime via the
  // Set Master Volume block. Bad data falls back to 1 (full volume).
  function normalizeMasterVolume(v) {
    // null/undefined mean "missing" (not zero): fall back to full volume.
    if (v === null || v === undefined || v === '') return 1;
    var n = clamp01(v);
    return n === null ? 1 : n;
  }

  // The bus fader: 0 when muted, otherwise the bus volume (0-1).
  function busVolume(buses, id) {
    var b = buses[normalizeBusId(id)] || BUS_DEFAULTS.sfx;
    return b.muted ? 0 : b.volume;
  }

  // The final gain for one play: master fader x bus fader x the block's own
  // volume. soundVolume must already be normalized
  // (HydraAudio.normalizeVolume); masterVolume should already be normalized
  // (normalizeMasterVolume) but is clamped defensively anyway.
  function effectiveVolume(buses, id, soundVolume, masterVolume) {
    var sv = clamp01(soundVolume);
    if (sv === null) sv = 1;
    var mv = masterVolume === undefined ? 1 : clamp01(masterVolume);
    if (mv === null) mv = 1;
    return busVolume(buses, id) * sv * mv;
  }

  // --- polyphony: per-bus voice accounting --------------------------------
  function createVoices(buses) {
    var nb = normalizeBuses(buses);
    return {
      counts: { music: 0, sfx: 0, ui: 0 },
      limits: { music: nb.music.maxVoices, sfx: nb.sfx.maxVoices, ui: nb.ui.maxVoices }
    };
  }

  // Returns true and holds a voice when one is free; false when the bus is
  // at its polyphony limit (the caller drops the sound). Never throws.
  function tryAcquire(voices, id) {
    try {
      id = normalizeBusId(id);
      if (!voices || !voices.counts || !voices.limits) return false;
      if (voices.counts[id] < voices.limits[id]) { voices.counts[id]++; return true; }
      return false;
    } catch (e) { return false; }
  }

  function release(voices, id) {
    try {
      id = normalizeBusId(id);
      if (voices && voices.counts && voices.counts[id] > 0) voices.counts[id]--;
    } catch (e) {}
  }

  // Frees every held voice at once (the Stop All Sounds block). Safe when
  // individual releases fire later — release() no-ops at zero.
  function releaseAll(voices) {
    try {
      if (voices && voices.counts) {
        for (var i = 0; i < BUS_IDS.length; i++) voices.counts[BUS_IDS[i]] = 0;
      }
    } catch (e) {}
  }

  // --- base64 data-URL decoder (pure; no atob/DOM needed) ------------------
  // SFX assets are data URLs. Decoding to bytes synchronously lets the
  // runtime hand an ArrayBuffer to decodeAudioData without a fetch() round
  // trip. Returns a Uint8Array, or null when the URL is not a base64 audio
  // data URL (the runtime then falls back to <audio> element playback).
  var B64CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  function decodeDataUrl(dataUrl) {
    try {
      if (typeof dataUrl !== 'string') return null;
      var m = /^data:audio\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl.trim());
      if (!m) return null;
      var s = m[1];
      var out = [];
      var acc = 0, bits = 0;
      for (var i = 0; i < s.length; i++) {
        var c = s.charAt(i);
        if (c === '=') break;
        var v = B64CHARS.indexOf(c);
        if (v < 0) return null;
        acc = (acc << 6) | v;
        bits += 6;
        if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 255); }
      }
      return new Uint8Array(out);
    } catch (e) { return null; }
  }

  return {
    BUS_IDS: BUS_IDS,
    BUS_LABELS: BUS_LABELS,
    BUS_DEFAULTS: BUS_DEFAULTS,
    normalizeBuses: normalizeBuses,
    normalizeBusId: normalizeBusId,
    normalizePitch: normalizePitch,
    normalizeMasterVolume: normalizeMasterVolume,
    busVolume: busVolume,
    effectiveVolume: effectiveVolume,
    createVoices: createVoices,
    tryAcquire: tryAcquire,
    release: release,
    releaseAll: releaseAll,
    decodeDataUrl: decodeDataUrl
  };
}

window.HydraAudioBuses = hydraAudioBusesFactory();
// Self-contained source of the factory, inlined into exported playable games
// by HydraPlayer.buildPlayableHtml so exports run without editor files.
window.HydraAudioBuses.factorySource = hydraAudioBusesFactory.toString();
