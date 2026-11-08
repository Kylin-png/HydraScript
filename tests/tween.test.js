// Unit tests for hydra/hydra-tween.js — the shared tween module.
//
// Pure logic: easing curves, spec normalization, start/stop/update, the
// replace-on-same-property rule, relative targets, loop/ping-pong repeats,
// and the finished flag that drives the Tween Finished condition.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const sandbox = {};
sandbox.window = sandbox; // hydra-tween.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-tween.js'), 'utf8'),
  sandbox, { filename: 'hydra-tween.js' });
const T = sandbox.HydraTween;

check('HydraTween exposed with helpers',
  !!T && typeof T.start === 'function' && typeof T.update === 'function' &&
  typeof T.stop === 'function' && typeof T.isFinished === 'function' &&
  typeof T.ease === 'function' && typeof T.normalizeSpec === 'function');
check('factorySource is a self-contained function string',
  typeof T.factorySource === 'string' && T.factorySource.includes('easeOutBounce'));

// --- easing curves ---
check('linear endpoints', T.ease('linear', 0) === 0 && T.ease('linear', 1) === 1);
check('easeOut is ahead of linear mid-way', T.ease('easeOut', 0.5) > 0.5);
check('easeIn is behind linear mid-way', T.ease('easeIn', 0.5) < 0.5);
check('easeInOut midpoints', Math.abs(T.ease('easeInOut', 0.5) - 0.5) < 1e-9);
check('easeOutBack overshoots above 1', T.ease('easeOutBack', 0.6) > 1);
check('easeOutBounce stays in [0,1] and ends at 1',
  T.ease('easeOutBounce', 0) === 0 && T.ease('easeOutBounce', 1) === 1 &&
  T.ease('easeOutBounce', 0.5) >= 0 && T.ease('easeOutBounce', 0.5) <= 1);
check('unknown easing falls back to easeOut',
  T.ease('nonsense', 0.5) === T.ease('easeOut', 0.5));
check('t clamped to [0,1]', T.ease('linear', -2) === 0 && T.ease('linear', 9) === 1);

// --- property access ---
const o0 = { posX: 10, rotation: 0 };
check('readProperty returns numbers', T.readProperty(o0, 'posX') === 10);
check('readProperty defaults opacity to 1', T.readProperty(o0, 'opacity') === 1);
check('readProperty of missing field is 0', T.readProperty(o0, 'height') === 0);
const o1 = {};
T.writeProperty(o1, 'opacity', 1.7);
check('writeProperty clamps opacity to 1', o1.opacity === 1);
T.writeProperty(o1, 'opacity', -0.2);
check('writeProperty clamps opacity to 0', o1.opacity === 0);
T.writeProperty(o1, 'posY', 42);
check('writeProperty sets plain fields', o1.posY === 42);
T.writeProperty(o1, 'posY', NaN);
check('writeProperty ignores NaN', o1.posY === 42);

// --- spec normalization ---
check('valid spec normalizes', T.normalizeSpec({ property: 'posX', duration: 1, easing: 'linear', repeat: 'loop' }) === true);
const bad = { property: 'sideways', duration: -3, easing: 'nope', repeat: 'nope' };
check('bad property is a no-op spec', T.normalizeSpec(bad) === false);
const fix = { property: 'posY', duration: NaN, easing: 'nope', repeat: 'nope' };
T.normalizeSpec(fix);
check('bad duration/easing/repeat are repaired',
  fix.duration === T.DEFAULT_DURATION_S && fix.easing === 'easeOut' && fix.repeat === 'once');
check('null spec is a no-op', T.normalizeSpec(null) === false);

// --- start/update ---
function makeObj() { return { name: 'hero', posX: 10, posY: 20, width: 40, opacity: 1 }; }
let obj = makeObj();
const tw = T.start(null, obj, { property: 'posX', to: 110, relative: false, duration: 0.6, easing: 'linear', repeat: 'once' });
check('start returns a tween and captures from', !!tw && tw.from === 10 && tw.to === 110);
check('one active tween', T.activeCount(null, obj) === 1);
T.update(null, obj, 18); // half of 36 frames (0.6s)
check('mid-tween value is interpolated (linear)', Math.abs(obj.posX - 60) < 1e-9, String(obj.posX));
T.update(null, obj, 18);
check('tween parks on final value', obj.posX === 110, String(obj.posX));
check('tween removed after once completes', T.activeCount(null, obj) === 0);
check('finished record armed for the property', T.isFinished(null, obj, 'posX') === true);
check('isFinished(any) is true', T.isFinished(null, obj) === true);
check('isFinished(other property) is false', T.isFinished(null, obj, 'opacity') === false);

// --- relative targets ---
obj = makeObj();
T.start(null, obj, { property: 'posY', to: -100, relative: true, duration: 1, easing: 'linear', repeat: 'once' });
check('relative target = start value + delta', obj._tweens[0].to === -80);
T.update(null, obj, 60);
check('relative tween completes to the delta', obj.posY === -80, String(obj.posY));

// --- replace-on-same-property ---
obj = makeObj();
T.start(null, obj, { property: 'posX', to: 500, relative: false, duration: 5, easing: 'linear', repeat: 'once' });
T.update(null, obj, 30);
T.start(null, obj, { property: 'posX', to: 50, relative: false, duration: 0.6, easing: 'linear', repeat: 'once' });
check('second tween on same property replaces the first', T.activeCount(null, obj) === 1);
T.update(null, obj, 36);
check('replacement tween wins', obj.posX === 50, String(obj.posX));
obj = makeObj();
T.start(null, obj, { property: 'posX', to: 50, relative: false, duration: 0.6, easing: 'linear', repeat: 'once' });
T.start(null, obj, { property: 'opacity', to: 0, relative: false, duration: 0.6, easing: 'linear', repeat: 'once' });
check('different properties run side by side', T.activeCount(null, obj) === 2);

// --- repeats ---
obj = makeObj();
T.start(null, obj, { property: 'posX', to: 110, relative: false, duration: 0.6, easing: 'linear', repeat: 'loop' });
T.update(null, obj, 36);
check('loop tween restarts and stays active', T.activeCount(null, obj) === 1 && obj.posX === 10, String(obj.posX));
check('loop tween never records finished', T.isFinished(null, obj, 'posX') === false);
obj = makeObj();
T.start(null, obj, { property: 'posX', to: 110, relative: false, duration: 0.6, easing: 'linear', repeat: 'pingpong' });
T.update(null, obj, 36);
check('pingpong tween stays active after one leg', T.activeCount(null, obj) === 1);
T.update(null, obj, 36);
check('pingpong returns to start', Math.abs(obj.posX - 10) < 1e-9, String(obj.posX));

// --- stop ---
obj = makeObj();
T.start(null, obj, { property: 'posX', to: 110, relative: false, duration: 0.6, easing: 'linear', repeat: 'once' });
T.update(null, obj, 36); // finishes -> record armed
check('finished record armed', T.isFinished(null, obj, 'posX') === true);
T.start(null, obj, { property: 'posX', to: 200, relative: false, duration: 0.6, easing: 'linear', repeat: 'once' });
check('starting a new run re-arms (clears) the finished record', T.isFinished(null, obj, 'posX') === false);
T.stop(null, obj, 'posX');
check('stop(property) removes the tween', T.activeCount(null, obj) === 0);
obj = makeObj();
T.start(null, obj, { property: 'posX', to: 110, relative: false, duration: 5, easing: 'linear', repeat: 'once' });
T.start(null, obj, { property: 'opacity', to: 0, relative: false, duration: 5, easing: 'linear', repeat: 'once' });
T.stop(null, obj);
check('stop() with no property stops everything', T.activeCount(null, obj) === 0);

// --- bad data never crashes ---
obj = makeObj();
check('start with bad property returns null', T.start(null, obj, { property: 'nope', to: 5, duration: 1, easing: 'linear', repeat: 'once' }) === null);
check('start with non-numeric to returns null', T.start(null, obj, { property: 'posX', to: NaN, duration: 1, easing: 'linear', repeat: 'once' }) === null);
check('no tweens after no-op starts', T.activeCount(null, obj) === 0);
T.update(null, null, 10);
T.update(null, { _tweens: 'corrupt' }, 10);
check('update tolerates missing/corrupt state', true);
check('isFinished on missing state is false', T.isFinished(null, null, 'posX') === false);
check('zero-duration tween completes immediately',
  (() => {
    const o = makeObj();
    T.start(null, o, { property: 'posX', to: 77, relative: false, duration: 0, easing: 'linear', repeat: 'once' });
    T.update(null, o, 1);
    return o.posX === 77 && T.isFinished(null, o, 'posX');
  })());

if (failures > 0) { console.log(`${failures} FAILURE(S)`); process.exit(1); }
console.log('tween tests complete');
