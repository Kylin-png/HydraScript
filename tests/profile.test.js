// Unit tests for hydra/hydra-profile.js — the shared profiling-overlay module.
//
// Pure logic: visibility transitions, per-frame clock sampling, the rolling
// FPS / frame-time average, per-frame draw-count reporting, the stats
// record, and the overlay painter. Nothing here touches the DOM; both
// runtimes delegate to this module.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const sandbox = {};
sandbox.window = sandbox; // hydra-profile.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-profile.js'), 'utf8'),
  sandbox, { filename: 'hydra-profile.js' });
const P = sandbox.HydraProfile;

check('HydraProfile exposed with helpers',
  !!P && typeof P.createProfiler === 'function' && typeof P.isVisible === 'function' &&
  typeof P.show === 'function' && typeof P.hide === 'function' &&
  typeof P.toggle === 'function' && typeof P.frame === 'function' &&
  typeof P.noteDraws === 'function' && typeof P.stats === 'function' &&
  typeof P.drawOverlay === 'function');
check('factorySource is a self-contained function string',
  typeof P.factorySource === 'string' && P.factorySource.includes('hydraProfileFactory'));

// --- visibility transitions ---
{
  const s = P.createProfiler();
  check('fresh profiler reads as hidden', P.isVisible(s) === false);
  check('show() shows and returns true', P.show(s) === true && s.visible === true);
  check('show() is idempotent', P.show(s) === true && s.visible === true);
  check('hide() hides and returns false', P.hide(s) === false && s.visible === false);
  check('hide() is idempotent', P.hide(s) === false && s.visible === false);
  check('toggle() shows when hidden', P.toggle(s) === true && s.visible === true);
  check('toggle() hides when shown', P.toggle(s) === false && s.visible === false);
  check('missing record reads as hidden', P.isVisible(null) === false && P.isVisible(undefined) === false);
  check('toggle on a missing record returns false, never throws', P.toggle(null) === false);
  check('show on a missing record returns true, never throws', P.show(null) === true);
  check('hide on a missing record returns false, never throws', P.hide(undefined) === false);
  check('legacy record without visible reads as hidden', P.isVisible({}) === false);
}

// --- frame sampling / rolling stats ---
{
  const s = P.createProfiler();
  const empty = P.stats(s);
  check('no frames yet: fps and frameMs are 0', empty.fps === 0 && empty.frameMs === 0,
    JSON.stringify(empty));
  P.frame(s, 1000); // first call arms the clock; no delta yet
  check('one frame: still no average', P.stats(s).fps === 0);
  P.frame(s, 1016.67); // 16.67ms later
  let st = P.stats(s);
  check('one 16.67ms delta: ~60 fps', st.fps >= 59 && st.fps <= 61, `fps=${st.fps}`);
  check('one 16.67ms delta: frameMs ~16.7', st.frameMs >= 16.6 && st.frameMs <= 16.8, `frameMs=${st.frameMs}`);
  // Feed 59 more 16.67ms frames; the window holds 60 samples.
  for (let i = 0; i < 59; i++) P.frame(s, 1016.67 + (i + 1) * 16.67);
  st = P.stats(s);
  check('60 steady frames: fps ~60', st.fps >= 59 && st.fps <= 61, `fps=${st.fps}`);
  check('sample window capped at 60', s.samples.length === 60, `samples=${s.samples.length}`);
  // One slow frame barely moves a full 60-frame window (that's the point).
  P.frame(s, 1016.67 + 60 * 16.67 + 100);
  st = P.stats(s);
  check('window resists one spike', st.fps > 50, `fps=${st.fps}`);
  check('frame() with a bad clock never throws', (() => {
    try { P.frame(s, NaN); P.frame(s, 'junk'); P.frame(s, undefined); P.frame(null, 5); return true; }
    catch (e) { return false; }
  })());
  check('going backwards in time is ignored', (() => {
    const s2 = P.createProfiler();
    P.frame(s2, 1000); P.frame(s2, 1016.67); P.frame(s2, 500);
    return P.stats(s2).fps >= 59 && P.stats(s2).fps <= 61;
  })());
}

// --- draw counts ---
{
  const s = P.createProfiler();
  P.noteDraws(s, 12, 412, 38, 15);
  let st = P.stats(s);
  check('noteDraws records all four counts',
    st.draws2d === 12 && st.tris3d === 412 && st.particles === 38 && st.objects === 15,
    JSON.stringify(st));
  P.noteDraws(s, '7', 'junk', -3, 2.9);
  st = P.stats(s);
  check('counts sanitize: numeric string kept, junk/negative -> 0, float floored',
    st.draws2d === 7 && st.tris3d === 0 && st.particles === 0 && st.objects === 2,
    JSON.stringify(st));
  check('noteDraws on a missing record never throws', (() => {
    try { P.noteDraws(null, 1, 2, 3, 4); return true; } catch (e) { return false; }
  })());
  check('stats on a missing record returns zeros', (() => {
    const z = P.stats(null);
    return z.fps === 0 && z.frameMs === 0 && z.draws2d === 0 && z.tris3d === 0 && z.particles === 0 && z.objects === 0;
  })());
}

// --- overlay painting ---
function stubCtx() {
  const calls = [];
  return {
    calls,
    save() { calls.push('save'); }, restore() { calls.push('restore'); },
    fillRect(x, y, w, h) { calls.push(['fillRect', x, y, w, h]); },
    fillText(t, x, y) { calls.push(['fillText', String(t), x, y]); }
  };
}
{
  const s = P.createProfiler();
  const c1 = stubCtx();
  P.drawOverlay(c1, s, 800, 600);
  check('hidden overlay paints nothing', c1.calls.length === 0, `calls=${c1.calls.length}`);
  P.show(s);
  P.frame(s, 0); P.frame(s, 16.67);
  P.noteDraws(s, 12, 412, 38, 15);
  const c2 = stubCtx();
  P.drawOverlay(c2, s, 800, 600);
  const texts = c2.calls.filter(c => c[0] === 'fillText').map(c => c[1]);
  check('visible overlay paints a PROFILER title', texts.some(t => t === 'PROFILER'), texts.join(' | '));
  check('overlay shows the FPS line', texts.some(t => /FPS 6\d/.test(t)), texts.join(' | '));
  check('overlay shows the sprite/tri line', texts.some(t => /Sprites 12/.test(t) && /3D tris 412/.test(t)), texts.join(' | '));
  check('overlay shows the particle/object line', texts.some(t => /Particles 38/.test(t) && /Objects 15/.test(t)), texts.join(' | '));
  check('overlay wraps drawing in save/restore', c2.calls[0] === 'save' && c2.calls[c2.calls.length - 1] === 'restore');
  const c3 = stubCtx();
  P.drawOverlay(c3, s, 0, 0); // hostile view size falls back, never throws
  check('hostile view size still paints', c3.calls.some(c => c[0] === 'fillText'));
  check('missing ctx never throws', (() => {
    try { P.drawOverlay(null, s, 800, 600); P.drawOverlay({}, s, 800, 600); return true; }
    catch (e) { return false; }
  })());
  check('throwing ctx never breaks the frame', (() => {
    try {
      P.drawOverlay({ fillText() { throw new Error('boom'); }, fillRect() {}, save() {}, restore() {} }, s, 800, 600);
      return true;
    } catch (e) { return false; }
  })());
}

if (failures) { console.error(`${failures} assertion(s) failed`); process.exit(1); }
console.log('profile.test.js: all assertions passed');
