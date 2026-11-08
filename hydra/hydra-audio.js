/* ============================================================================
 * hydra-audio.js — HydraScript shared sound helpers.
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation of
 * the playSound source decision used by:
 *   - the editor preview runtime (script.js delegates to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * A playSound block plays either:
 *   - an uploaded audio asset (data.assetId names an entry in the project's
 *     assets table that actually has a dataUrl), or
 *   - a built-in synthesized tone (the legacy behavior).
 *
 * The asset wins only when it really exists; a missing/empty assetId or a
 * deleted asset falls back to the tone, so old projects and dangling
 * references never go silent and never crash.
 *
 * Load order (index.html): hydra-audio.js BEFORE player-runtime.js and
 * script.js. player-runtime.js throws a clear error if HydraAudio is missing.
 * ========================================================================== */

function hydraAudioFactory() {
  'use strict';

  // Legacy default: every existing playSound call used `data.volume || 0.3`,
  // so volume 0 (and any non-numeric junk) behaves as 0.3. Kept identical so
  // old projects sound exactly the same.
  var DEFAULT_VOLUME = 0.3;

  function normalizeVolume(v) {
    var n = Number(v);
    if (!isFinite(n) || n <= 0) return DEFAULT_VOLUME;
    return n > 1 ? 1 : n;
  }

  // assets: the project's asset table (assetId -> {name, dataUrl, kind, ...});
  // data: the playSound block's params ({assetId, frequency, waveform, ...}).
  // Returns {kind:'asset', dataUrl, name} or {kind:'tone'}. dataUrl is the
  // playable URL: an embedded data: URL in classic exports, or the relative
  // assets/<file> path in web-target exports (E1).
  function resolveSoundSource(assets, data) {
    var id = data ? data.assetId : null;
    var rec = (id && assets) ? assets[id] : null;
    var src = assetUrl(rec);
    if (src) {
      return { kind: 'asset', dataUrl: src, name: (rec && rec.name) || '' };
    }
    return { kind: 'tone' };
  }

  // Canonical playable URL for an asset record. Embedded data URLs win (the
  // classic single-file export); web-target exports (E1) rewrite records to
  // {file} and resolve to the relative assets/<file> path. Returns '' when
  // the record has no usable source.
  function assetUrl(rec) {
    if (!rec || typeof rec !== 'object') return '';
    if (typeof rec.dataUrl === 'string' && rec.dataUrl.length > 0) return rec.dataUrl;
    if (typeof rec.file === 'string' && rec.file.length > 0) {
      return 'assets/' + rec.file.replace(/^\/+/, '');
    }
    return '';
  }

  return {
    DEFAULT_VOLUME: DEFAULT_VOLUME,
    normalizeVolume: normalizeVolume,
    resolveSoundSource: resolveSoundSource,
    assetUrl: assetUrl
  };
}

window.HydraAudio = hydraAudioFactory();
// Self-contained source of the factory, inlined into exported playable games
// by HydraPlayer.buildPlayableHtml so exports run without editor files.
window.HydraAudio.factorySource = hydraAudioFactory.toString();
