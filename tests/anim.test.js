// Unit tests for hydra/hydra-anim.js — the shared sprite-animation module.
//
// Pure playback logic: normalization of animation lists, play/set/stop,
// frame advancement for loop/ping-pong/once modes, and the finished flag
// that drives the On Animation Finished condition.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const sandbox = {};
sandbox.window = sandbox; // hydra-anim.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-anim.js'), 'utf8'),
  sandbox, { filename: 'hydra-anim.js' });
const A = sandbox.HydraAnim;

check('HydraAnim exposed with helpers',
  !!A && typeof A.normalizeAnimations === 'function' && typeof A.update === 'function' &&
  typeof A.play === 'function' && typeof A.setAnimation === 'function' &&
  typeof A.stop === 'function' && typeof A.isFinished === 'function' &&
  typeof A.currentFrameAssetId === 'function');
check('factorySource is a self-contained function string',
  typeof A.factorySource === 'string' && A.factorySource.includes('createAnimState'));

function makeObj() {
  return {
    name: 'hero',
    animations: [
      { name: 'Walk', mode: 'loop', fps: 10, frames: ['a1', 'a2', 'a3'] },
      { name: 'Jump', mode: 'once', fps: 10, frames: ['j1', 'j2'] },
      { name: 'Idle', mode: 'pingpong', fps: 10, frames: ['i1', 'i2', 'i3'] }
    ]
  };
}

// --- normalization ---
let obj = makeObj();
check('normalize keeps valid animations', A.normalizeAnimations(obj).length === 3);

obj = { name: 'plain' };
check('missing animations field normalizes to []', A.normalizeAnimations(obj).length === 0 &&
  Array.isArray(obj.animations));

obj = { name: 'messy', animations: 'nope' };
check('non-array animations normalizes to []', A.normalizeAnimations(obj).length === 0);

obj = {
  name: 'corrupt',
  animations: [
    null,
    { name: '', mode: 'sideways', fps: -5, frames: ['x', 7, ''] },
    { name: 'Walk', mode: 'loop', fps: 8, frames: ['a1'] },
    { name: 'Walk', mode: 'loop', fps: 8, frames: ['a2'] }
  ]
};
const normed = A.normalizeAnimations(obj);
check('corrupt entries repaired (null dropped, bad mode/fps fixed, frames filtered)',
  normed.length === 3 && normed[0].mode === 'loop' && normed[0].fps === 8 &&
  normed[0].frames.length === 1 && normed[0].name.length > 0,
  JSON.stringify(normed));
check('duplicate animation names made unique', normed[1].name !== normed[2].name,
  `${normed[1].name} vs ${normed[2].name}`);

check('getAnimation finds by name', A.getAnimation(makeObj(), 'Jump').fps === 10);
check('getAnimation returns null for unknown name', A.getAnimation(makeObj(), 'Fly') === null);

// --- play / current frame ---
obj = makeObj();
let st = A.createAnimState();
check('fresh state is idle', st.playing === false && A.currentFrameAssetId(st, obj) === null);
check('play returns true for a known animation', A.play(st, obj, 'Walk') === true);
check('play starts on frame 0', st.playing === true && st.name === 'Walk' &&
  st.frameIndex === 0 && A.currentFrameAssetId(st, obj) === 'a1');
check('play returns false for unknown name (state untouched)',
  A.play(st, obj, 'Fly') === false && st.name === 'Walk');

// --- update: loop mode (fps 10 -> 100ms/frame; 1 frame-unit = 16.67ms) ---
st = A.createAnimState();
A.play(st, obj, 'Walk');
A.update(st, obj, 6); // 6 frames ~= 100ms -> exactly one frame advance
check('loop advances after one frame-duration', st.frameIndex === 1 &&
  A.currentFrameAssetId(st, obj) === 'a2', `frameIndex=${st.frameIndex}`);
A.update(st, obj, 12); // ~200ms -> two more frames, wraps to 0
check('loop wraps from last frame to first', st.frameIndex === 0 &&
  A.currentFrameAssetId(st, obj) === 'a1', `frameIndex=${st.frameIndex}`);
check('loop never sets finished', A.isFinished(st) === false);

// --- update: pingpong mode ---
st = A.createAnimState();
A.play(st, obj, 'Idle'); // i1 i2 i3
A.update(st, obj, 6);
check('pingpong moves forward', st.frameIndex === 1, `frameIndex=${st.frameIndex}`);
A.update(st, obj, 6);
check('pingpong reaches last frame', st.frameIndex === 2, `frameIndex=${st.frameIndex}`);
A.update(st, obj, 6);
check('pingpong bounces back', st.frameIndex === 1 && st.dir === -1,
  `frameIndex=${st.frameIndex} dir=${st.dir}`);
A.update(st, obj, 6);
check('pingpong reaches first frame', st.frameIndex === 0, `frameIndex=${st.frameIndex}`);
A.update(st, obj, 6);
check('pingpong turns around at first frame', st.frameIndex === 1 && st.dir === 1,
  `frameIndex=${st.frameIndex} dir=${st.dir}`);

// --- update: once mode ---
st = A.createAnimState();
A.play(st, obj, 'Jump'); // j1 j2
check('once is not finished at start', A.isFinished(st) === false);
A.update(st, obj, 6);
check('once advances to last frame', st.frameIndex === 1 && st.playing === true,
  `frameIndex=${st.frameIndex}`);
A.update(st, obj, 6);
check('once stops on the last frame and reports finished',
  st.playing === false && st.finished === true && st.frameIndex === 1 &&
  A.currentFrameAssetId(st, obj) === null, // stopped -> no frame
  JSON.stringify(st));
check('isFinished matches with the animation name', A.isFinished(st, 'Jump') === true);
check('isFinished does not match a different name', A.isFinished(st, 'Walk') === false);

// --- setAnimation keeps the frame index ---
st = A.createAnimState();
A.play(st, obj, 'Walk');
A.update(st, obj, 6); // frame 1
check('setAnimation switches without restarting', A.setAnimation(st, obj, 'Idle') === true &&
  st.name === 'Idle' && st.frameIndex === 1 &&
  A.currentFrameAssetId(st, obj) === 'i2', `frame=${A.currentFrameAssetId(st, obj)}`);
check('setAnimation clears the finished flag', (function () {
  const s2 = A.createAnimState();
  A.play(s2, obj, 'Jump');
  A.update(s2, obj, 12); // finishes
  A.setAnimation(s2, obj, 'Walk');
  return A.isFinished(s2) === false && s2.playing === true;
})());
check('setAnimation clamps the frame index to the shorter animation',
  (function () {
    const s3 = A.createAnimState();
    A.play(s3, obj, 'Walk');
    A.update(s3, obj, 12); // frame 2
    A.setAnimation(s3, obj, 'Jump'); // only 2 frames
    return s3.frameIndex === 1;
  })());
check('setAnimation returns false for unknown name', A.setAnimation(st, obj, 'Fly') === false);

// --- stop ---
st = A.createAnimState();
A.play(st, obj, 'Walk');
A.stop(st);
check('stop halts playback and clears finished', st.playing === false &&
  A.isFinished(st) === false && A.currentFrameAssetId(st, obj) === null);

// --- edge cases ---
st = A.createAnimState();
const emptyObj = { name: 'ghost', animations: [{ name: 'Empty', mode: 'loop', fps: 8, frames: [] }] };
check('play on a frameless animation reports false-ish (not playing)',
  A.play(st, emptyObj, 'Empty') === true && st.playing === false);
A.update(st, emptyObj, 6);
check('update on frameless animation stays stopped', st.playing === false);

st = A.createAnimState();
A.play(st, makeObj(), 'Walk');
A.update(st, makeObj(), 0);
A.update(st, makeObj(), -3);
A.update(st, makeObj(), NaN);
check('update tolerates bad dt (falls back to 1 frame)',
  typeof st.frameIndex === 'number' && st.playing === true, `frameIndex=${st.frameIndex}`);

st = A.createAnimState();
check('update on idle state is a no-op', (A.update(st, makeObj(), 10), st.playing === false));

// --- playback speed (animation state machines) ---
st = A.createAnimState();
check('fresh state defaults to speed 1', st.speed === 1);
A.setSpeed(st, 2);
check('setSpeed stores a valid multiplier', st.speed === 2);
A.setSpeed(st, 0);
check('setSpeed repairs 0 to 1', st.speed === 1);
A.setSpeed(st, -4);
check('setSpeed repairs negatives to 1', st.speed === 1);
A.setSpeed(st, NaN);
check('setSpeed repairs NaN to 1', st.speed === 1);
A.setSpeed(st, 'fast');
check('setSpeed repairs non-numbers to 1', st.speed === 1);
check('setSpeed on a missing state never throws', (A.setSpeed(null, 2), true));
A.play(st, obj, 'Walk');
check('play() resets speed to 1', st.speed === 1);
A.setAnimation(st, obj, 'Jump');
check('setAnimation() resets speed to 1', st.speed === 1);

// Walk is fps 10 -> 100ms/frame at speed 1; at speed 2 one update(6)
// (~100ms) advances two frames.
st = A.createAnimState();
A.play(st, obj, 'Walk');
A.setSpeed(st, 2);
A.update(st, obj, 6);
check('2x speed advances two frames per frame-duration', st.frameIndex === 2,
  `frameIndex=${st.frameIndex}`);
st = A.createAnimState();
A.play(st, obj, 'Walk');
st.speed = -9; // hostile direct write repairs inside update
A.update(st, obj, 6);
check('hostile speed falls back to 1x inside update', st.frameIndex === 1,
  `frameIndex=${st.frameIndex}`);

console.log(failures === 0 ? 'anim.test.js: ALL PASS' : `anim.test.js: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
