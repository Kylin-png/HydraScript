/* ============================================================================
 * hydra-profile.js — HydraScript shared profiling-overlay helpers (P4 item 34).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation of
 * the engine profiling overlay used by:
 *   - the editor preview runtime (script.js delegates to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Profiling overlay (identical in preview and exports):
 *   - Tracks FPS + frame time from a rolling 60-frame window of real frame
 *     deltas (the host passes its clock each frame — performance.now /
 *     rAF timestamp — so the module itself never touches a clock).
 *   - The host reports per-frame render counts via noteDraws(): 2D sprites
 *     drawn, 3D triangles drawn, live particles, live objects.
 *   - When visible, drawOverlay() paints a small dark panel in the corner
 *     with the numbers. It draws last, on top of the HUD pass.
 *   - Visibility is runtime state (state.profiler), toggled by the
 *     Show Profiler / Hide Profiler / Toggle Profiler blocks and the
 *     Profiler Visible condition, plus the preview toolbar's Profiler
 *     button. It is never saved into project JSON, and it survives scene
 *     switches (a debug overlay is session state, like the diagnostics
 *     panel — not game state).
 *
 * Nothing here ever throws; hostile input produces safe fallbacks. The
 * overlay draw is best-effort: a stub or broken canvas context simply
 * skips the panel instead of breaking the frame.
 *
 * Load order (index.html): hydra-profile.js BEFORE player-runtime.js and
 * script.js. player-runtime.js throws a clear error if HydraProfile is
 * missing.
 * ========================================================================== */

function hydraProfileFactory() {
  'use strict';

  // Rolling window for the FPS / frame-time average.
  var MAX_SAMPLES = 60;

  // Fresh profiler record. The runtime owns one per run
  // (preview: previewState.profiler; export: state.profiler).
  function createProfiler() {
    return {
      visible: false,
      samples: [],
      lastT: null,
      draws2d: 0,
      tris3d: 0,
      particles: 0,
      objects: 0
    };
  }

  function isVisible(prof) {
    return !!(prof && prof.visible);
  }

  // Show the overlay. Idempotent; returns the new visibility (true).
  function show(prof) {
    if (prof) prof.visible = true;
    return true;
  }

  // Hide the overlay. Idempotent; returns the new visibility (false).
  function hide(prof) {
    if (prof) prof.visible = false;
    return false;
  }

  // Flip the overlay. Returns the new visibility.
  function toggle(prof) {
    if (!prof) return false;
    prof.visible = !prof.visible;
    return !!prof.visible;
  }

  // Record one rendered frame's wall-clock time. The host passes its own
  // clock (rAF timestamp / performance.now) so this module stays DOM-free.
  // The first call only arms the clock; later calls push real deltas.
  // Never throws; bad timestamps are ignored.
  function frame(prof, nowMs) {
    if (!prof) return;
    var now = Number(nowMs);
    if (!isFinite(now)) return;
    if (prof.lastT === null || prof.lastT === undefined) {
      prof.lastT = now;
      return;
    }
    var dt = now - Number(prof.lastT);
    prof.lastT = now;
    if (!isFinite(dt) || dt < 0) return;
    if (!Array.isArray(prof.samples)) prof.samples = [];
    prof.samples.push(dt);
    if (prof.samples.length > MAX_SAMPLES) prof.samples.shift();
  }

  function saneCount(v) {
    var n = Number(v);
    if (!isFinite(n) || n < 0) return 0;
    return Math.floor(n);
  }

  // Per-frame render counts reported by the host after its draw pass:
  // 2D sprites drawn, 3D triangles drawn, live particles, live objects.
  // Bad values collapse to 0; never throws.
  function noteDraws(prof, draws2d, tris3d, particles, objects) {
    if (!prof) return;
    prof.draws2d = saneCount(draws2d);
    prof.tris3d = saneCount(tris3d);
    prof.particles = saneCount(particles);
    prof.objects = saneCount(objects);
  }

  // Plain stats record for the overlay (and for tests). fps/frameMs are 0
  // until at least one real frame delta has been recorded.
  function stats(prof) {
    var out = { fps: 0, frameMs: 0, draws2d: 0, tris3d: 0, particles: 0, objects: 0 };
    if (!prof) return out;
    out.draws2d = saneCount(prof.draws2d);
    out.tris3d = saneCount(prof.tris3d);
    out.particles = saneCount(prof.particles);
    out.objects = saneCount(prof.objects);
    var s = Array.isArray(prof.samples) ? prof.samples : [];
    var sum = 0, n = 0;
    for (var i = 0; i < s.length; i++) {
      var d = Number(s[i]);
      if (isFinite(d) && d >= 0) { sum += d; n++; }
    }
    if (n > 0) {
      var avg = sum / n;
      out.frameMs = Math.round(avg * 10) / 10;
      out.fps = avg > 0 ? Math.round((1000 / avg) * 10) / 10 : 0;
    }
    return out;
  }

  // Paint the overlay panel. No-op when hidden or when the context cannot
  // draw text; hostile contexts never break the frame.
  function drawOverlay(ctx, prof, viewW, viewH) {
    if (!isVisible(prof)) return;
    if (!ctx || typeof ctx.fillText !== 'function' || typeof ctx.fillRect !== 'function') return;
    try {
      var s = stats(prof);
      var lines = [
        'FPS ' + s.fps + '   (' + s.frameMs + ' ms)',
        'Sprites ' + s.draws2d + '   3D tris ' + s.tris3d,
        'Particles ' + s.particles + '   Objects ' + s.objects
      ];
      var w = Number(viewW), h = Number(viewH);
      if (!isFinite(w) || w <= 0) w = 800;
      if (!isFinite(h) || h <= 0) h = 600;
      var pad = 8, titleH = 20, lh = 16;
      var pw = 212, ph = pad * 2 + titleH + lh * lines.length;
      if (pw > w - pad * 2) pw = Math.max(60, w - pad * 2);
      var px = pad, py = pad;
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#0b1220';
      ctx.fillRect(px, py, pw, ph);
      ctx.globalAlpha = 1;
      ctx.font = '12px monospace';
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#fbbf24';
      ctx.fillText('PROFILER', px + pad, py + pad);
      ctx.fillStyle = '#e5e7eb';
      for (var i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], px + pad, py + pad + titleH + i * lh);
      }
      ctx.restore();
    } catch (e) { /* overlay is best-effort; never break the frame */ }
  }

  return {
    createProfiler: createProfiler,
    isVisible: isVisible,
    show: show,
    hide: hide,
    toggle: toggle,
    frame: frame,
    noteDraws: noteDraws,
    stats: stats,
    drawOverlay: drawOverlay
  };
}

window.HydraProfile = hydraProfileFactory();
// Self-contained source of the factory, inlined into exported playable games
// by HydraPlayer.buildPlayableHtml so exports run without editor files.
window.HydraProfile.factorySource = hydraProfileFactory.toString();
