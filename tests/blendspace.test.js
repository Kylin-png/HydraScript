// Unit tests for hydra/hydra-blendspace.js — the shared 2D animation
// blend-space module.
//
// Pure logic: blend-space list normalization, blend lookup, setting/stopping
// blends through host hooks, the shared frame clock, the weighted frame
// list for drawing (inverse-square crossfade), and the never-throw policy
// on hostile data. Nothing here touches the DOM; both runtimes delegate to
// this module.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const sandbox = {};
sandbox.window = sandbox; // hydra-blendspace.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-blendspace.js'), 'utf8'),
  sandbox, { filename: 'hydra-blendspace.js' });
const BS = sandbox.HydraBlendSpace;

check('HydraBlendSpace exposed with helpers',
  !!BS && typeof BS.normalizeBlendSpaces === 'function' && typeof BS.blendSpaceNames === 'function' &&
  typeof BS.getBlendSpace === 'function' && typeof BS.createBlendRuntime === 'function' &&
  typeof BS.activeBlendName === 'function' && typeof BS.setBlend === 'function' &&
  typeof BS.stopBlend === 'function' && typeof BS.isBlendActive === 'function' &&
  typeof BS.updateBlend === 'function' && typeof BS.blendFrameList === 'function');
check('factorySource is a self-contained function string',
  typeof BS.factorySource === 'string' && BS.factorySource.includes('hydraBlendSpaceFactory'));
check('DEFAULT_FPS is 8', BS.DEFAULT_FPS === 8);

function makeObj() {
  return {
    name: 'hero',
    animBlends: [
      {
        name: 'Move', fps: 8, points: [
          { animation: 'Idle', x: 0, y: 0 },
          { animation: 'WalkRight', x: 1, y: 0 },
          { animation: 'WalkLeft', x: -1, y: 0 }
        ]
      }
    ]
  };
}

// framesOf resolver over a fake animation table
function framesOf(table) {
  return (animName) => (table[animName] && table[animName].frames) || [];
}
const TABLE = {
  Idle: { frames: ['i1', 'i2'] },
  WalkRight: { frames: ['r1', 'r2', 'r3'] },
  WalkLeft: { frames: ['l1'] }
};

// --- normalization ---
{
  const obj = makeObj();
  const list = BS.normalizeBlendSpaces(obj);
  check('normalization keeps valid blend spaces', list.length === 1 && list[0].name === 'Move' &&
    list[0].fps === 8 && list[0].points.length === 3, JSON.stringify(list.length));
  check('blendSpaceNames lists names', JSON.stringify(BS.blendSpaceNames(obj)) === '["Move"]');
  check('getBlendSpace finds by exact name', BS.getBlendSpace(obj, 'Move').fps === 8);
  check('getBlendSpace misses unknown names', BS.getBlendSpace(obj, 'Ghost') === null);
  check('getBlendSpace blank is null', BS.getBlendSpace(obj, '') === null);
}
{
  const obj = {
    animBlends: [
      { name: '', fps: 'fast', points: [{ animation: 'Idle', x: 'a', y: null }, 'junk', null] },
      { name: 'Move', fps: 0 },
      { name: 'Move', fps: -3, points: 'nope' },
      null, 'junk'
    ]
  };
  const list = BS.normalizeBlendSpaces(obj);
  check('blank names filled', list[0].name === 'Blend 1', JSON.stringify(list[0].name));
  check('bad fps repairs to 8', list[0].fps === 8 && list[1].fps === 8 && list[2].fps === 8);
  check('duplicate names suffixed', list[1].name === 'Move' && list[2].name === 'Move 3',
    JSON.stringify(list.map(b => b.name)));
  check('bad points dropped, x/y coerced', list[0].points.length === 1 &&
    list[0].points[0].x === 0 && list[0].points[0].y === 0,
    JSON.stringify(list[0].points));
  check('non-array points become []', Array.isArray(list[2].points) && list[2].points.length === 0);
}
check('normalization on a missing field yields []', BS.normalizeBlendSpaces({}).length === 0);
check('normalization on hostile input yields []', BS.normalizeBlendSpaces(null).length === 0 &&
  BS.normalizeBlendSpaces('x').length === 0);

// --- setBlend / stopBlend / isBlendActive ---
{
  const obj = makeObj();
  const rt = BS.createBlendRuntime();
  check('fresh runtime has no active blend', BS.activeBlendName(rt) === '');
  const warns = [];
  const ok = BS.setBlend(rt, obj, 'Move', 1, 0, { warn: (m) => warns.push(m) });
  check('setBlend activates and stores values', ok === true && BS.activeBlendName(rt) === 'Move' &&
    rt.spaces.Move.x === 1 && rt.spaces.Move.y === 0, JSON.stringify(rt.active));
  check('setBlend is silent on the happy path', warns.length === 0);
  check('isBlendActive reads the active blend', BS.isBlendActive(rt, 'Move') === true &&
    BS.isBlendActive(rt, 'Idle') === false);
  check('isBlendActive blank reads false quietly', BS.isBlendActive(rt, '') === false);
  BS.setBlend(rt, obj, 'Move', 0.5, -0.25, {});
  check('setBlend updates values in place', rt.spaces.Move.x === 0.5 && rt.spaces.Move.y === -0.25);
  const bad = BS.setBlend(rt, obj, 'Ghost', 1, 1, { warn: (m) => warns.push(m) });
  check('unknown blend warns and holds', bad === false && warns.length === 1 &&
    BS.activeBlendName(rt) === 'Move', warns.join(' | '));
  const blank = BS.setBlend(rt, obj, '   ', 1, 1, { warn: (m) => warns.push(m) });
  check('blank blend is a quiet no-op', blank === false && warns.length === 1 &&
    BS.activeBlendName(rt) === 'Move');
  BS.stopBlend(rt, obj, 'Move');
  check('stopBlend deactivates', BS.activeBlendName(rt) === '' && BS.isBlendActive(rt, 'Move') === false);
  BS.setBlend(rt, obj, 'Move', 1, 0, {});
  BS.stopBlend(rt, obj, '');
  check('stopBlend with a blank name stops whatever is active', BS.activeBlendName(rt) === '');
  check('stopBlend on hostile runtime never throws', BS.stopBlend(null, obj, 'Move') === false);
  check('setBlend on hostile input never throws', BS.setBlend(null, null, 'x', 1, 1) === false &&
    BS.setBlend(rt, null, 'Move', 1, 1, { warn: () => { throw new Error('boom'); } }) === false);
}

// --- updateBlend (shared frame clock) ---
{
  const obj = makeObj();
  const rt = BS.createBlendRuntime();
  BS.updateBlend(rt, obj, 1); // nothing active: no-op
  check('updateBlend with no active blend is a quiet no-op', BS.activeBlendName(rt) === '');
  BS.setBlend(rt, obj, 'Move', 1, 0, {});
  BS.updateBlend(rt, obj, 1); // 1 frame at 60fps, 8fps blend => no full frame yet
  check('updateBlend accumulates partial frames', rt.spaces.Move.frameIndex === 0 &&
    rt.spaces.Move.frameTimer > 0, JSON.stringify(rt.spaces.Move));
  BS.updateBlend(rt, obj, 8); // 8 more 60fps frames > 1 blend frame (7.5)
  check('updateBlend advances the shared frame clock', rt.spaces.Move.frameIndex >= 1,
    JSON.stringify(rt.spaces.Move.frameIndex));
  check('updateBlend never throws on hostile input',
    (BS.updateBlend(null, obj, 1), BS.updateBlend(rt, null, 1), BS.updateBlend(rt, obj, NaN), true));
  // blend deleted mid-run quietly deactivates
  obj.animBlends = [];
  BS.updateBlend(rt, obj, 1);
  check('updateBlend deactivates a deleted blend quietly', BS.activeBlendName(rt) === '');
}

// --- blendFrameList (weighted crossfade) ---
{
  const obj = makeObj();
  const rt = BS.createBlendRuntime();
  check('no active blend draws nothing', BS.blendFrameList(rt, obj, framesOf(TABLE)).length === 0);
  BS.setBlend(rt, obj, 'Move', 0, 0, {}); // exact hit on Idle
  const exact = BS.blendFrameList(rt, obj, framesOf(TABLE));
  check('exact hit plays that animation at full alpha', exact.length === 1 &&
    exact[0].assetId === 'i1' && exact[0].alpha === 1, JSON.stringify(exact));
  BS.setBlend(rt, obj, 'Move', 1, 0, {}); // exact hit on WalkRight
  const exactR = BS.blendFrameList(rt, obj, framesOf(TABLE));
  check('exact hit on another point plays it', exactR.length === 1 && exactR[0].assetId === 'r1',
    JSON.stringify(exactR));
  BS.setBlend(rt, obj, 'Move', 0.5, 0, {}); // midway: Idle <-> WalkRight
  const mid = BS.blendFrameList(rt, obj, framesOf(TABLE));
  check('midway blends the two nearest frames', mid.length === 2 &&
    mid[0].assetId === 'i1' && mid[0].alpha === 1 &&
    mid[1].assetId === 'r1' && Math.abs(mid[1].alpha - 0.5) < 0.001,
    JSON.stringify(mid));
  BS.setBlend(rt, obj, 'Move', 0.75, 0, {}); // closer to WalkRight
  const near = BS.blendFrameList(rt, obj, framesOf(TABLE));
  const wIdle = 1 / 0.5625, wR = 1 / 0.0625;
  check('nearer animation gets the stronger ghost', near.length === 2 && near[0].assetId === 'r1' &&
    Math.abs(near[1].alpha - wIdle / (wIdle + wR)) < 0.001, JSON.stringify(near));
  // frame clock wraps per animation length
  rt.spaces.Move.frameIndex = 5;
  BS.setBlend(rt, obj, 'Move', 0, 0, {});
  const wrap = BS.blendFrameList(rt, obj, framesOf(TABLE));
  check('frame index wraps per animation length', wrap.length === 1 && wrap[0].assetId === 'i2',
    JSON.stringify(wrap)); // Idle has 2 frames: 5 % 2 = 1
}
{
  // single point: always that animation
  const obj = { animBlends: [{ name: 'Solo', fps: 8, points: [{ animation: 'Idle', x: 3, y: 4 }] }] };
  const rt = BS.createBlendRuntime();
  BS.setBlend(rt, obj, 'Solo', -9, 42, {});
  const one = BS.blendFrameList(rt, obj, framesOf(TABLE));
  check('a single point always plays its animation', one.length === 1 && one[0].assetId === 'i1',
    JSON.stringify(one));
}
{
  // points with missing animations are skipped
  const obj = { animBlends: [{ name: 'Gap', fps: 8, points: [{ animation: 'Missing', x: 0, y: 0 }] }] };
  const rt = BS.createBlendRuntime();
  BS.setBlend(rt, obj, 'Gap', 0, 0, {});
  check('missing animations draw nothing', BS.blendFrameList(rt, obj, framesOf(TABLE)).length === 0);
  check('blendFrameList without a resolver is safe', BS.blendFrameList(rt, obj, null).length === 0);
  check('blendFrameList on hostile input never throws', BS.blendFrameList(null, null).length === 0 &&
    BS.blendFrameList({}, 'x', framesOf(TABLE)).length === 0);
}

process.exit(failures === 0 ? 0 : 1);
