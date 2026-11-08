/* ============================================================================
 * hydra-particles.js — HydraScript shared CPU particle system.
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation of
 * particle effects used by:
 *   - the editor preview runtime (script.js delegates to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Data model: particles and emitters are TRANSIENT run state, NOT saved in
 * project JSON. A fresh particle state is created per scene load / preview
 * run via createParticleState(). The block's spec lives on the logic-grid
 * cell:
 *   { type: 'emitBurst', x, y, count, speed, spread, direction, lifetime,
 *     size0, size1, color0, color1, gravity, shape, additive }
 *   { type: 'startEmitter', emitterName, followObject, rate, ...same fields }
 *
 * Runtime state (per scene, created fresh at game start / scene load):
 *   pstate = { particles: [ { x, y, vx, vy, life, maxLife, size0, size1,
 *                             r0,g0,b0, r1,g1,b1, gravity, shape, additive,
 *                             emitter } ],
 *              emitters: { name: { spec, x, y, acc } },
 *              spawned, recycled }
 *
 * Semantics:
 *   - CPU particles are the right default for the web: no GPU setup, tiny
 *     memory, and a pooled cap (MAX_PARTICLES) keeps frame time bounded.
 *   - Emitters with a `rate` spawn continuously; `followObject` pins an
 *     emitter to a named object's center each frame (engine trails, rain
 *     that follows the player). Starting an emitter with an existing name
 *     REPLACES it, so a fresh Start Emitter never double-spawns.
 *   - Bursts are one-shot: `count` particles spawned immediately.
 *   - Each particle randomizes speed (0.4x-1.2x) and lifetime (0.7x-1.3x)
 *     around the spec so bursts look natural without extra fields.
 *   - Color and size interpolate start -> end over the particle's life;
 *     alpha always fades 1 -> 0 so particles dissolve instead of popping.
 *   - Direction is degrees, 0 = right, 90 = down, 180 = left, 270 = up
 *     (canvas y-down). Spread fans the directions around it.
 *   - Additive blending ('lighter') is per particle; the draw pass renders
 *     normal particles first, then additive ones, so glows layer correctly.
 *   - When the pool is full, the oldest particles are recycled first.
 *   - Corrupt/hand-edited specs are repaired (bad numbers -> defaults,
 *     bad colors -> white, bad shape -> circle), never a crash.
 *   - Pausing is the runtimes' job: they simply stop calling update() while
 *     paused, so particles freeze mid-air and resume exactly.
 *
 * Load order (index.html): hydra-particles.js BEFORE player-runtime.js and
 * script.js. player-runtime.js throws a clear error if HydraParticles is
 * missing.
 * ========================================================================== */

function hydraParticlesFactory() {
  'use strict';

  var MS_PER_60FPS_FRAME = 1000 / 60;
  var MAX_PARTICLES = 1500;

  var SHAPES = [
    { id: 'circle', label: 'Circle' },
    { id: 'square',  label: 'Square' }
  ];

  // One-tap starting points for the editor's property panels. Burst presets
  // fill Emit Burst; emitter presets fill Start Emitter. Hand-editing any
  // field flips the panel back to Custom (same pattern as tween presets).
  var PRESETS = [
    { id: 'custom', label: 'Custom (set the fields below)', kind: 'both', fill: null },
    // ---- bursts ----
    { id: 'explosion', label: 'Explosion', kind: 'burst',
      fill: { count: 40, speed: 320, spread: 360, direction: 0, lifetime: 0.7,
              size0: 10, size1: 2, color0: '#fbbf24', color1: '#ef4444',
              gravity: 500, shape: 'circle', additive: true } },
    { id: 'sparkle', label: 'Sparkle', kind: 'burst',
      fill: { count: 25, speed: 120, spread: 360, direction: 0, lifetime: 0.9,
              size0: 6, size1: 1, color0: '#fef9c3', color1: '#facc15',
              gravity: 60, shape: 'circle', additive: true } },
    { id: 'smoke', label: 'Smoke puff', kind: 'burst',
      fill: { count: 20, speed: 40, spread: 60, direction: 270, lifetime: 2.2,
              size0: 12, size1: 40, color0: '#9ca3af', color1: '#6b7280',
              gravity: -60, shape: 'circle', additive: false } },
    { id: 'confetti', label: 'Confetti', kind: 'burst',
      fill: { count: 50, speed: 260, spread: 90, direction: 270, lifetime: 1.6,
              size0: 7, size1: 5, color0: '#f472b6', color1: '#3b82f6',
              gravity: 700, shape: 'square', additive: false } },
    { id: 'splash', label: 'Splash', kind: 'burst',
      fill: { count: 30, speed: 380, spread: 70, direction: 270, lifetime: 0.8,
              size0: 6, size1: 2, color0: '#7dd3fc', color1: '#0284c7',
              gravity: 900, shape: 'circle', additive: false } },
    // ---- emitters ----
    { id: 'fire', label: 'Fire', kind: 'emitter',
      fill: { rate: 60, speed: 90, spread: 25, direction: 270, lifetime: 1.1,
              size0: 14, size1: 4, color0: '#fb923c', color1: '#ef4444',
              gravity: -80, shape: 'circle', additive: true } },
    { id: 'trail', label: 'Magic trail', kind: 'emitter',
      fill: { rate: 50, speed: 30, spread: 360, direction: 0, lifetime: 0.5,
              size0: 8, size1: 1, color0: '#c4b5fd', color1: '#8b5cf6',
              gravity: -40, shape: 'circle', additive: true } },
    { id: 'rain', label: 'Rain', kind: 'emitter',
      fill: { rate: 120, speed: 700, spread: 8, direction: 90, lifetime: 1.2,
              size0: 4, size1: 3, color0: '#7dd3fc', color1: '#0284c7',
              gravity: 0, shape: 'circle', additive: false } },
    { id: 'snow', label: 'Snow', kind: 'emitter',
      fill: { rate: 40, speed: 60, spread: 30, direction: 90, lifetime: 6,
              size0: 5, size1: 4, color0: '#f8fafc', color1: '#cbd5e1',
              gravity: 20, shape: 'circle', additive: false } },
    { id: 'fountain', label: 'Fountain', kind: 'emitter',
      fill: { rate: 80, speed: 420, spread: 30, direction: 270, lifetime: 1.4,
              size0: 6, size1: 3, color0: '#7dd3fc', color1: '#0369a1',
              gravity: 800, shape: 'circle', additive: false } }
  ];

  function num(v, fallback, min, max) {
    var n = Number(v);
    if (!isFinite(n)) n = fallback;
    if (min !== undefined && n < min) n = min;
    if (max !== undefined && n > max) n = max;
    return n;
  }

  function isValidShape(s) {
    for (var i = 0; i < SHAPES.length; i++) {
      if (SHAPES[i].id === s) return true;
    }
    return false;
  }

  // Parse '#rgb' / '#rrggbb' (anything else -> white). Alpha always comes
  // from the lifetime fade, not the color string.
  function parseColor(c) {
    var fallback = { r: 255, g: 255, b: 255 };
    if (typeof c !== 'string') return fallback;
    var h = c.charAt(0) === '#' ? c.slice(1) : c;
    if (/^[0-9a-fA-F]{3}$/.test(h)) {
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return fallback;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16)
    };
  }

  // Fresh transient particle state. Runtimes create one per scene load /
  // preview run; it is never serialized into project JSON.
  function createParticleState() {
    return { particles: [], emitters: {}, spawned: 0, recycled: 0 };
  }

  function getParticles(pstate) {
    if (!pstate || !Array.isArray(pstate.particles)) return [];
    return pstate.particles;
  }

  // Repair a block spec in place; returns the repaired spec. Bad values get
  // sensible defaults — a hand-edited project can never crash the loop.
  function normalizeSpec(spec) {
    if (!spec || typeof spec !== 'object') spec = {};
    spec.x = num(spec.x, 0);
    spec.y = num(spec.y, 0);
    spec.count = Math.round(num(spec.count, 20, 1, 500));
    spec.rate = num(spec.rate, 30, 0, 600);
    spec.speed = num(spec.speed, 200, 0, 3000);
    spec.spread = num(spec.spread, 360, 0, 360);
    spec.direction = num(spec.direction, 0) % 360;
    if (spec.direction < 0) spec.direction += 360;
    spec.lifetime = num(spec.lifetime, 1, 0.05, 30);
    spec.size0 = num(spec.size0, 8, 0, 200);
    spec.size1 = num(spec.size1, 2, 0, 200);
    spec.color0 = typeof spec.color0 === 'string' ? spec.color0 : '#ffffff';
    spec.color1 = typeof spec.color1 === 'string' ? spec.color1 : '#ffffff';
    spec.gravity = num(spec.gravity, 0, -5000, 5000);
    if (!isValidShape(spec.shape)) spec.shape = 'circle';
    spec.additive = spec.additive === true;
    spec.emitterName = String(spec.emitterName == null ? '' : spec.emitterName).slice(0, 60);
    spec.followObject = String(spec.followObject == null ? '' : spec.followObject).slice(0, 120);
    return spec;
  }

  function spawnOne(pstate, spec, x, y, emitterName) {
    var list = getParticles(pstate);
    // Pool cap: recycle the oldest particle first so frame time stays
    // bounded no matter how many emitters are running.
    if (list.length >= MAX_PARTICLES) {
      list.shift();
      pstate.recycled = (pstate.recycled || 0) + 1;
    }
    var dirDeg = spec.direction + (Math.random() - 0.5) * spec.spread;
    var dirRad = dirDeg * Math.PI / 180;
    var spd = spec.speed * (0.4 + Math.random() * 0.8);
    var life = Math.max(0.05, spec.lifetime * (0.7 + Math.random() * 0.6));
    var c0 = parseColor(spec.color0);
    var c1 = parseColor(spec.color1);
    list.push({
      x: x, y: y,
      vx: Math.cos(dirRad) * spd,
      vy: Math.sin(dirRad) * spd,
      life: life, maxLife: life,
      size0: spec.size0, size1: spec.size1,
      r0: c0.r, g0: c0.g, b0: c0.b,
      r1: c1.r, g1: c1.g, b1: c1.b,
      gravity: spec.gravity,
      shape: spec.shape,
      additive: spec.additive,
      emitter: emitterName || ''
    });
    pstate.spawned = (pstate.spawned || 0) + 1;
  }

  // One-shot burst of spec.count particles at (spec.x, spec.y).
  function burst(pstate, spec) {
    if (!pstate) return 0;
    spec = normalizeSpec(spec);
    var n = 0;
    for (var i = 0; i < spec.count; i++) {
      spawnOne(pstate, spec, spec.x, spec.y, '');
      n++;
    }
    return n;
  }

  // Start (or replace) a named continuous emitter. Blank name -> 'fx'.
  function startEmitter(pstate, name, spec) {
    if (!pstate) return null;
    spec = normalizeSpec(spec);
    var key = String(name == null ? '' : name).trim().slice(0, 60) || 'fx';
    if (!pstate.emitters || typeof pstate.emitters !== 'object') pstate.emitters = {};
    pstate.emitters[key] = { spec: spec, x: spec.x, y: spec.y, acc: 0 };
    return key;
  }

  // Stop one emitter, or all of them when name is blank. Particles already
  // in flight keep living out their lifetimes.
  function stopEmitter(pstate, name) {
    if (!pstate || !pstate.emitters) return 0;
    var key = String(name == null ? '' : name).trim();
    if (!key) {
      var n = Object.keys(pstate.emitters).length;
      pstate.emitters = {};
      return n;
    }
    if (pstate.emitters[key]) { delete pstate.emitters[key]; return 1; }
    return 0;
  }

  // Remove live particles: one emitter's (by name), or everything when
  // blank. Emitters keep running unless stopEmitter is also called.
  function clearParticles(pstate, name) {
    if (!pstate) return 0;
    var list = getParticles(pstate);
    var key = String(name == null ? '' : name).trim();
    if (!key) {
      var all = list.length;
      list.length = 0;
      return all;
    }
    var removed = 0;
    for (var i = list.length - 1; i >= 0; i--) {
      if (list[i].emitter === key) { list.splice(i, 1); removed++; }
    }
    return removed;
  }

  // Advance emitters and particles by dtFrames (in 60fps-frame units, the
  // unit both runtimes use). followFn(name) -> {x, y} | null lets emitters
  // track a named object; the runtimes supply it. Never throws on bad data.
  function update(pstate, dtFrames, followFn) {
    if (!pstate) return;
    var dt = Number(dtFrames);
    if (!isFinite(dt) || dt <= 0) dt = 1;
    var dtS = dt * MS_PER_60FPS_FRAME / 1000;
    var emitters = pstate.emitters && typeof pstate.emitters === 'object' ? pstate.emitters : {};
    var names = Object.keys(emitters);
    for (var i = 0; i < names.length; i++) {
      var e = emitters[names[i]];
      if (!e || !e.spec) continue;
      if (e.spec.followObject && typeof followFn === 'function') {
        try {
          var pos = followFn(e.spec.followObject);
          if (pos && isFinite(Number(pos.x)) && isFinite(Number(pos.y))) {
            e.x = Number(pos.x);
            e.y = Number(pos.y);
          }
        } catch (err) { /* a bad follow target never kills the loop */ }
      }
      e.acc = (Number(e.acc) || 0) + e.spec.rate * dtS;
      var n = Math.floor(e.acc);
      e.acc -= n;
      for (var k = 0; k < n; k++) spawnOne(pstate, e.spec, e.x, e.y, names[i]);
    }
    var list = getParticles(pstate);
    for (var j = list.length - 1; j >= 0; j--) {
      var p = list[j];
      p.life -= dtS;
      if (p.life <= 0) { list.splice(j, 1); continue; }
      p.vy += (Number(p.gravity) || 0) * dtS;
      p.x += (Number(p.vx) || 0) * dtS;
      p.y += (Number(p.vy) || 0) * dtS;
    }
  }

  // Render every live particle in world space. Two passes (normal, then
  // additive) so glows layer over the scene correctly. Offscreen particles
  // are culled. Takes the raw 2d context — the one drawing path both
  // runtimes share, so preview and export look identical.
  function draw(ctx, pstate, camX, camY, viewW, viewH) {
    if (!ctx || !pstate) return;
    var list = getParticles(pstate);
    if (list.length === 0) return;
    camX = Number(camX) || 0;
    camY = Number(camY) || 0;
    viewW = Number(viewW) || 0;
    viewH = Number(viewH) || 0;
    var MARGIN = 64;
    var left = camX - MARGIN, top = camY - MARGIN;
    var right = camX + viewW + MARGIN, bottom = camY + viewH + MARGIN;
    ctx.save();
    for (var pass = 0; pass < 2; pass++) {
      var wantAdditive = pass === 1;
      if (wantAdditive) ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        if (!!p.additive !== wantAdditive) continue;
        if (p.x < left || p.x > right || p.y < top || p.y > bottom) continue;
        var t = 1 - p.life / p.maxLife; // 0 (birth) -> 1 (death)
        if (t < 0) t = 0;
        if (t > 1) t = 1;
        var size = p.size0 + (p.size1 - p.size0) * t;
        if (size <= 0) continue;
        var r = Math.round(p.r0 + (p.r1 - p.r0) * t);
        var g = Math.round(p.g0 + (p.g1 - p.g0) * t);
        var b = Math.round(p.b0 + (p.b1 - p.b0) * t);
        var x = p.x - camX, y = p.y - camY;
        ctx.globalAlpha = 1 - t;
        ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
        if (p.shape === 'square') {
          ctx.fillRect(x - size / 2, y - size / 2, size, size);
        } else {
          ctx.beginPath();
          ctx.arc(x, y, size / 2, 0, 6.283185307179586);
          ctx.fill();
        }
      }
      if (wantAdditive) ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }

  function particleCount(pstate) {
    return getParticles(pstate).length;
  }

  function emitterCount(pstate) {
    if (!pstate || !pstate.emitters || typeof pstate.emitters !== 'object') return 0;
    return Object.keys(pstate.emitters).length;
  }

  function emitterNames(pstate) {
    if (!pstate || !pstate.emitters || typeof pstate.emitters !== 'object') return [];
    return Object.keys(pstate.emitters);
  }

  function presetsFor(kind) {
    return PRESETS.filter(function (p) {
      return p.kind === 'both' || p.kind === kind;
    });
  }

  return {
    MAX_PARTICLES: MAX_PARTICLES,
    SHAPES: SHAPES,
    PRESETS: PRESETS,
    createParticleState: createParticleState,
    normalizeSpec: normalizeSpec,
    parseColor: parseColor,
    burst: burst,
    startEmitter: startEmitter,
    stopEmitter: stopEmitter,
    clearParticles: clearParticles,
    update: update,
    draw: draw,
    particleCount: particleCount,
    emitterCount: emitterCount,
    emitterNames: emitterNames,
    presetsFor: presetsFor
  };
}

window.HydraParticles = hydraParticlesFactory();
// Self-contained source of the factory, inlined into exported playable games
// by HydraPlayer.buildPlayableHtml so exports run without editor files.
window.HydraParticles.factorySource = hydraParticlesFactory.toString();
