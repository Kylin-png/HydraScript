// Unit tests for hydra/hydra-particles.js — the shared CPU particle module.
//
// Pure logic: spec normalization, burst spawning, emitter start/stop/replace,
// follow-object tracking, per-frame update (gravity, lifetime, emission
// accumulation), pooling cap, clearParticles scoping, and draw culling.
// Nothing here touches the DOM; both runtimes delegate to this module.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const sandbox = {};
sandbox.window = sandbox; // hydra-particles.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-particles.js'), 'utf8'),
  sandbox, { filename: 'hydra-particles.js' });
const P = sandbox.HydraParticles;

check('HydraParticles exposed with helpers',
  !!P && typeof P.burst === 'function' && typeof P.startEmitter === 'function' &&
  typeof P.stopEmitter === 'function' && typeof P.clearParticles === 'function' &&
  typeof P.update === 'function' && typeof P.draw === 'function' &&
  typeof P.createParticleState === 'function' && typeof P.normalizeSpec === 'function');
check('factorySource is a self-contained function string',
  typeof P.factorySource === 'string' && P.factorySource.includes('hydraParticlesFactory'));
check('MAX_PARTICLES is a sane pool cap', P.MAX_PARTICLES === 1500, String(P.MAX_PARTICLES));
check('presets exist for bursts and emitters',
  P.presetsFor('burst').length >= 5 && P.presetsFor('emitter').length >= 5,
  `burst=${P.presetsFor('burst').length} emitter=${P.presetsFor('emitter').length}`);

// ---------- spec normalization ----------
{
  const s = P.normalizeSpec({ count: 'abc', speed: -5, spread: 999, direction: 720,
    lifetime: 0, size0: 'x', color0: 'not-a-color', shape: 'triangle', additive: 'yes' });
  check('bad count falls back to 20', s.count === 20, String(s.count));
  check('negative speed clamps to 0', s.speed === 0, String(s.speed));
  check('spread clamps to 360', s.spread === 360, String(s.spread));
  check('direction wraps to 0-360', s.direction === 0, String(s.direction));
  check('zero lifetime clamps to minimum', s.lifetime >= 0.05, String(s.lifetime));
  check('bad size falls back', s.size0 === 8, String(s.size0));
  check('bad shape falls back to circle', s.shape === 'circle', s.shape);
  check('additive coerces to boolean', s.additive === false, String(s.additive));
  check('normalizeSpec(null) does not throw', P.normalizeSpec(null).count === 20);
  const c = P.parseColor('not-a-color');
  check('bad color parses to white', c.r === 255 && c.g === 255 && c.b === 255, JSON.stringify(c));
  const c3 = P.parseColor('#f80');
  check('#rgb shorthand parses', c3.r === 255 && c3.g === 136 && c3.b === 0, JSON.stringify(c3));
}

// ---------- bursts ----------
{
  const st = P.createParticleState();
  const n = P.burst(st, { x: 100, y: 200, count: 10, speed: 100, spread: 360,
    direction: 0, lifetime: 1, size0: 8, size1: 2, color0: '#ff0000',
    color1: '#0000ff', gravity: 500, shape: 'circle', additive: true });
  check('burst spawns exactly count particles', n === 10 && P.particleCount(st) === 10,
    `n=${n} count=${P.particleCount(st)}`);
  const p = st.particles[0];
  check('burst particles spawn at the burst origin', p.x === 100 && p.y === 200,
    `x=${p.x} y=${p.y}`);
  check('burst particle carries gravity + shape + additive',
    p.gravity === 500 && p.shape === 'circle' && p.additive === true);
  check('burst colors parsed from hex', p.r0 === 255 && p.g0 === 0 && p.b0 === 0 &&
    p.r1 === 0 && p.g1 === 0 && p.b1 === 255, `${p.r0},${p.g0},${p.b0} -> ${p.r1},${p.g1},${p.b1}`);
  check('burst particle speed is within the randomized band',
    Math.hypot(p.vx, p.vy) >= 40 - 1e-9 && Math.hypot(p.vx, p.vy) <= 120 + 1e-9,
    String(Math.hypot(p.vx, p.vy)));
  check('burst on a null state does not throw', P.burst(null, { count: 5 }) === 0);
}

// ---------- update: gravity, lifetime, motion ----------
{
  const st = P.createParticleState();
  P.burst(st, { x: 0, y: 0, count: 1, speed: 0, spread: 0, direction: 0,
    lifetime: 10, size0: 8, size1: 8, color0: '#ffffff', color1: '#ffffff',
    gravity: 600, shape: 'circle', additive: false });
  const p = st.particles[0];
  const lifeBefore = p.life;
  for (let i = 0; i < 60; i++) P.update(st, 1); // 60 frames = 1 second
  check('gravity accelerates vy downward', Math.abs(p.vy - 600) < 1, String(p.vy));
  check('particle moved downward', Math.abs(p.y - 305) < 2, String(p.y));
  check('lifetime ticks down', p.life < lifeBefore, `${p.life} < ${lifeBefore}`);
  for (let i = 0; i < 1200; i++) P.update(st, 1);
  check('dead particles are removed', P.particleCount(st) === 0, String(P.particleCount(st)));
  check('update on null state does not throw', (P.update(null, 1), true));
  check('update with bad dt does not throw', (P.update(st, NaN), true));
}

// ---------- emitters ----------
{
  const st = P.createParticleState();
  const key = P.startEmitter(st, 'fire', { x: 50, y: 60, rate: 60, speed: 100,
    spread: 30, direction: 270, lifetime: 2, size0: 8, size1: 2,
    color0: '#ffffff', color1: '#ffffff', gravity: 0, shape: 'circle', additive: true });
  check('startEmitter returns the name', key === 'fire', String(key));
  check('emitter registered', P.emitterCount(st) === 1, String(P.emitterCount(st)));
  P.update(st, 60); // 1 second at 60 particles/sec
  const c = P.particleCount(st);
  check('emitter spawns ~rate particles per second', c >= 55 && c <= 65, String(c));
  check('emitter particles tagged with the emitter name',
    st.particles.every(p => p.emitter === 'fire'));
  // fractional accumulation: rate 30 over half a second -> 15
  const st2 = P.createParticleState();
  P.startEmitter(st2, 'half', { x: 0, y: 0, rate: 30, speed: 0, spread: 0,
    direction: 0, lifetime: 5, size0: 4, size1: 4, color0: '#fff', color1: '#fff',
    gravity: 0, shape: 'circle', additive: false });
  P.update(st2, 30);
  check('fractional emission accumulates correctly', P.particleCount(st2) === 15,
    String(P.particleCount(st2)));
  // replace rule: starting the same name replaces, never doubles
  P.startEmitter(st, 'fire', { x: 0, y: 0, rate: 600, speed: 0, spread: 0,
    direction: 0, lifetime: 5, size0: 4, size1: 4, color0: '#fff', color1: '#fff',
    gravity: 0, shape: 'circle', additive: false });
  check('re-starting an emitter replaces it (still 1 emitter)',
    P.emitterCount(st) === 1 && P.emitterNames(st)[0] === 'fire');
  check('blank emitter name normalizes to fx',
    P.startEmitter(P.createParticleState(), '  ', { rate: 10 }) === 'fx');
  check('stopEmitter removes one emitter', P.stopEmitter(st, 'fire') === 1 &&
    P.emitterCount(st) === 0);
  check('stopEmitter on a missing name returns 0', P.stopEmitter(st, 'nope') === 0);
  P.startEmitter(st, 'a', { rate: 10 });
  P.startEmitter(st, 'b', { rate: 10 });
  check('blank stopEmitter stops all', P.stopEmitter(st, '') === 2 && P.emitterCount(st) === 0);
  check('stopped emitter leaves in-flight particles alive', P.particleCount(st) > 0,
    String(P.particleCount(st)));
}

// ---------- followObject ----------
{
  const st = P.createParticleState();
  P.startEmitter(st, 'trail', { x: 0, y: 0, rate: 60, speed: 0, spread: 0,
    direction: 0, lifetime: 5, size0: 4, size1: 4, color0: '#fff', color1: '#fff',
    gravity: 0, shape: 'circle', additive: false, followObject: 'hero' });
  P.update(st, 60, () => ({ x: 400, y: 300 }));
  check('followObject pins the emitter position',
    st.emitters.trail.x === 400 && st.emitters.trail.y === 300,
    `${st.emitters.trail.x},${st.emitters.trail.y}`);
  check('followed emitter spawns at the followed position',
    st.particles[0].x === 400 && st.particles[0].y === 300);
  // a throwing followFn never kills the loop
  P.update(st, 1, () => { throw new Error('boom'); });
  check('throwing followFn is swallowed', P.particleCount(st) > 0);
  // null follow target keeps the last position
  P.update(st, 1, () => null);
  check('null follow target keeps position', st.emitters.trail.x === 400);
}

// ---------- pooling ----------
{
  const st = P.createParticleState();
  P.burst(st, { x: 0, y: 0, count: 500, speed: 0, spread: 0, direction: 0,
    lifetime: 10, size0: 4, size1: 4, color0: '#fff', color1: '#fff',
    gravity: 0, shape: 'circle', additive: false });
  P.burst(st, { x: 0, y: 0, count: 500, speed: 0, spread: 0, direction: 0,
    lifetime: 10, size0: 4, size1: 4, color0: '#fff', color1: '#fff',
    gravity: 0, shape: 'circle', additive: false });
  P.burst(st, { x: 0, y: 0, count: 500, speed: 0, spread: 0, direction: 0,
    lifetime: 10, size0: 4, size1: 4, color0: '#fff', color1: '#fff',
    gravity: 0, shape: 'circle', additive: false });
  P.burst(st, { x: 0, y: 0, count: 500, speed: 0, spread: 0, direction: 0,
    lifetime: 10, size0: 4, size1: 4, color0: '#fff', color1: '#fff',
    gravity: 0, shape: 'circle', additive: false });
  check('particle pool caps at MAX_PARTICLES', P.particleCount(st) === P.MAX_PARTICLES,
    String(P.particleCount(st)));
  check('recycled counter tracks overflow', st.recycled === 500, String(st.recycled));
}

// ---------- clearParticles ----------
{
  const st = P.createParticleState();
  P.startEmitter(st, 'fire', { x: 0, y: 0, rate: 60, speed: 0, spread: 0,
    direction: 0, lifetime: 5, size0: 4, size1: 4, color0: '#fff', color1: '#fff',
    gravity: 0, shape: 'circle', additive: false });
  P.update(st, 60);
  P.burst(st, { x: 0, y: 0, count: 10, speed: 0, spread: 0, direction: 0,
    lifetime: 5, size0: 4, size1: 4, color0: '#fff', color1: '#fff',
    gravity: 0, shape: 'circle', additive: false });
  const total = P.particleCount(st);
  const cleared = P.clearParticles(st, 'fire');
  check('clearParticles(name) removes only that emitter\'s particles',
    cleared === total - 10 && P.particleCount(st) === 10,
    `cleared=${cleared} remaining=${P.particleCount(st)} total=${total}`);
  check('clearing keeps the emitter running', P.emitterCount(st) === 1);
  const clearedAll = P.clearParticles(st, '');
  check('blank clearParticles removes everything', clearedAll === 10 && P.particleCount(st) === 0,
    `clearedAll=${clearedAll}`);
  check('clearParticles on null state returns 0', P.clearParticles(null, '') === 0);
}

// ---------- draw ----------
{
  const calls = [];
  const ctx = new Proxy({}, {
    get(t, prop) {
      if (prop === 'save') return () => calls.push(['save']);
      if (prop === 'restore') return () => calls.push(['restore']);
      if (prop === 'beginPath') return () => calls.push(['beginPath']);
      if (prop === 'arc') return (...a) => calls.push(['arc', ...a]);
      if (prop === 'fill') return () => calls.push(['fill']);
      if (prop === 'fillRect') return (...a) => calls.push(['fillRect', ...a]);
      return undefined;
    },
    set(t, prop, v) { calls.push(['set', prop, v]); return true; }
  });
  const st = P.createParticleState();
  P.burst(st, { x: 100, y: 100, count: 3, speed: 0, spread: 0, direction: 0,
    lifetime: 5, size0: 10, size1: 10, color0: '#ff0000', color1: '#0000ff',
    gravity: 0, shape: 'circle', additive: false });
  P.draw(ctx, st, 0, 0, 800, 600);
  const arcs = calls.filter(c => c[0] === 'arc');
  check('draw renders one arc per circle particle', arcs.length === 3, String(arcs.length));
  check('draw centers arcs on the particle (camera applied)',
    arcs.every(a => a[1] === 100 && a[2] === 100), JSON.stringify(arcs[0]));
  const alphas = calls.filter(c => c[0] === 'set' && c[1] === 'globalAlpha').map(c => c[2]);
  check('fresh particles draw fully opaque', alphas.every(a => a === 1), JSON.stringify(alphas));
  // culling: far-offscreen particles are skipped
  const st2 = P.createParticleState();
  P.burst(st2, { x: 5000, y: 5000, count: 5, speed: 0, spread: 0, direction: 0,
    lifetime: 5, size0: 10, size1: 10, color0: '#fff', color1: '#fff',
    gravity: 0, shape: 'circle', additive: false });
  const calls2 = [];
  const ctx2 = new Proxy({}, {
    get(t, prop) {
      if (prop === 'arc') return () => calls2.push('arc');
      if (prop === 'beginPath' || prop === 'fill' || prop === 'save' || prop === 'restore') return () => {};
      return undefined;
    },
    set() { return true; }
  });
  P.draw(ctx2, st2, 0, 0, 800, 600);
  check('offscreen particles are culled', calls2.length === 0, String(calls2.length));
  // additive particles switch the composite op
  const st3 = P.createParticleState();
  P.burst(st3, { x: 100, y: 100, count: 2, speed: 0, spread: 0, direction: 0,
    lifetime: 5, size0: 10, size1: 10, color0: '#fff', color1: '#fff',
    gravity: 0, shape: 'square', additive: true });
  const calls3 = [];
  const ctx3 = new Proxy({}, {
    get(t, prop) {
      if (prop === 'fillRect') return () => calls3.push('fillRect');
      if (prop === 'beginPath' || prop === 'fill' || prop === 'save' || prop === 'restore' || prop === 'arc') return () => {};
      return undefined;
    },
    set(t, prop, v) { calls3.push(['set', prop, v]); return true; }
  });
  P.draw(ctx3, st3, 0, 0, 800, 600);
  check('square particles draw as rects', calls3.filter(c => c === 'fillRect').length === 2,
    JSON.stringify(calls3.length));
  check('additive pass switches composite op to lighter and back',
    JSON.stringify(calls3).includes('lighter') && JSON.stringify(calls3).includes('source-over'));
  check('draw with null ctx does not throw', (P.draw(null, st, 0, 0, 800, 600), true));
  check('draw with empty state does not throw', (P.draw(ctx, P.createParticleState(), 0, 0, 800, 600), true));
}

if (failures) { console.error(`${failures} assertion(s) failed`); process.exit(1); }
console.log('particles.test.js: all assertions passed');
