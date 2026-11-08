// Unit tests for hydra/hydra-skeleton.js — the shared 2D skeletal
// animation module.
//
// Pure logic: skeleton normalization (repairs, drops, dedupe), lookups,
// the play/stop/pose runtime (restart rules, override layering, warn +
// hold), the frame clock (loop / pingpong / once, deleted-animation
// safety), current bone angles (override > track > base), local bone
// segments (parent chains, angle sums, cycle safety), and the canvas
// bone painter (limb lines, stretched images, joint dots, hostile
// contexts). Nothing here touches the DOM; both runtimes delegate to
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
sandbox.window = sandbox; // hydra-skeleton.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-skeleton.js'), 'utf8'),
  sandbox, { filename: 'hydra-skeleton.js' });
const SK = sandbox.HydraSkeleton;

check('HydraSkeleton exposed with helpers',
  !!SK && typeof SK.normalizeSkeleton === 'function' && typeof SK.getBone === 'function' &&
  typeof SK.getSkeletonAnimation === 'function' && typeof SK.createSkeletonRuntime === 'function' &&
  typeof SK.setSkeletonAnimation === 'function' && typeof SK.stopSkeletonAnimation === 'function' &&
  typeof SK.isSkeletonActive === 'function' && typeof SK.setBoneAngle === 'function' &&
  typeof SK.updateSkeleton === 'function' && typeof SK.currentBoneAngles === 'function' &&
  typeof SK.boneSegmentsLocal === 'function' && typeof SK.drawSkeleton === 'function' &&
  typeof SK.isSkeletonAction === 'function' && typeof SK.isSkeletonCondition === 'function');
check('factorySource is a self-contained function string',
  typeof SK.factorySource === 'string' && SK.factorySource.includes('hydraSkeletonFactory'));
check('defaults are fps 8, length 40, width 10',
  SK.DEFAULT_FPS === 8 && SK.DEFAULT_LENGTH === 40 && SK.DEFAULT_WIDTH === 10);
check('modes are loop, pingpong, once',
  JSON.stringify(SK.MODES) === JSON.stringify(['loop', 'pingpong', 'once']));

// ---------- normalization ----------
{
  const obj = {};
  const sk = SK.normalizeSkeleton(obj);
  check('old project without a skeleton normalizes to empty',
    sk && sk.bones.length === 0 && sk.animations.length === 0 && sk.hideSprite === false,
    JSON.stringify(sk));
  check('normalization writes the skeleton onto the object', obj.skeleton === sk);
}
{
  const obj = { skeleton: {
    hideSprite: 'yes',
    bones: [
      { name: '', parent: 'ghost', length: -5, angle: '30', color: '  #ff0000 ', image: ' img1 ', width: 0 },
      { name: 'arm', parent: 'arm', length: 'abc', angle: null, width: 999 },
      { name: 'arm', parent: 'Bone 1', length: 50, angle: 90 },
      null, 'junk'
    ],
    animations: [
      { name: '', fps: 0, mode: 'swing', tracks: [
        { bone: '', angles: [1, 2] },
        { bone: 'arm', angles: [] },
        { bone: 'arm', angles: ['10', 'x', 30] },
        { bone: 'arm', angles: [99] },
        null
      ] },
      { name: 'Walk', fps: 12, mode: 'once', tracks: [] },
      { name: 'Walk', fps: 12, mode: 'loop', tracks: [] }
    ]
  } };
  const sk = SK.normalizeSkeleton(obj);
  check('blank bone name is filled', sk.bones[0].name === 'Bone 1', JSON.stringify(sk.bones.map(b => b.name)));
  check('missing parent repairs to root', sk.bones[0].parent === '');
  check('self parent repairs to root', sk.bones[1].parent === '');
  check('duplicate bone names are suffixed', sk.bones[2].name === 'arm 3', JSON.stringify(sk.bones.map(b => b.name)));
  check('bad length repairs to 40, bad width caps at 64', sk.bones[0].length === 40 && sk.bones[1].width === 64,
    JSON.stringify(sk.bones.map(b => [b.length, b.width])));
  check('angle coerces from string', sk.bones[0].angle === 30);
  check('color and image are trimmed', sk.bones[0].color === '#ff0000' && sk.bones[0].image === 'img1');
  check('non-object bones are dropped', sk.bones.length === 3, String(sk.bones.length));
  check('hideSprite coerces to boolean', sk.hideSprite === false);
  check('blank animation name is filled', sk.animations[0].name === 'Pose 1');
  check('bad fps repairs to 8, bad mode repairs to loop', sk.animations[0].fps === 8 && sk.animations[0].mode === 'loop');
  check('blank-bone and empty-angle tracks are dropped, first track per bone wins',
    sk.animations[0].tracks.length === 1 && sk.animations[0].tracks[0].bone === 'arm' &&
    JSON.stringify(sk.animations[0].tracks[0].angles) === JSON.stringify([10, 0, 30]),
    JSON.stringify(sk.animations[0].tracks));
  check('duplicate animation names are suffixed', sk.animations[2].name === 'Walk 3',
    JSON.stringify(sk.animations.map(a => a.name)));
}
{
  const obj = { skeleton: { bones: [{ name: 'leg', parent: '', length: 40, angle: 90 }] } };
  check('skeletonBoneNames lists bones', JSON.stringify(SK.skeletonBoneNames(obj)) === JSON.stringify(['leg']));
  check('getBone finds by exact name', SK.getBone(obj, 'leg') && SK.getBone(obj, 'leg').length === 40);
  check('getBone is null on blank and missing names', SK.getBone(obj, '') === null && SK.getBone(obj, 'toe') === null);
  check('getSkeletonAnimation is null when none exist', SK.getSkeletonAnimation(obj, 'Walk') === null);
  check('normalizeSkeleton never throws on hostile input',
    JSON.stringify(SK.normalizeSkeleton(null)) === JSON.stringify({ hideSprite: false, bones: [], animations: [] }) &&
    JSON.stringify(SK.normalizeSkeleton(42)) === JSON.stringify({ hideSprite: false, bones: [], animations: [] }));
}
{
  // Regression (cycle 41 smoke failure): the Inspector section holds bone
  // references while it renders, and its mini preview re-normalizes
  // mid-build — normalization must not orphan those references, or every
  // section edit vanishes on the next refresh.
  const obj = { skeleton: { bones: [{ name: 'arm', parent: '', length: 50, angle: 0 }], animations: [] } };
  const sk1 = SK.normalizeSkeleton(obj);
  const boneRef = sk1.bones[0];
  const sk2 = SK.normalizeSkeleton(obj);
  check('normalizeSkeleton preserves skeleton identity across calls',
    sk1 === sk2 && sk1 === obj.skeleton && boneRef === obj.skeleton.bones[0]);
  boneRef.length = 60;
  SK.normalizeSkeleton(obj);
  check('edits to held bone references survive re-normalization',
    obj.skeleton.bones[0].length === 60, String(obj.skeleton.bones[0].length));
  sk1.bones.push({ name: 'hand', parent: 'arm', length: 20, angle: 0 });
  SK.normalizeSkeleton(obj);
  check('bones pushed through a held reference survive re-normalization',
    obj.skeleton.bones.length === 2 && obj.skeleton.bones[1].name === 'hand',
    JSON.stringify(obj.skeleton.bones.map(b => b.name)));
}

// ---------- play / stop / active ----------
function rigObj() {
  return {
    color: '#111111',
    skeleton: {
      bones: [
        { name: 'leg', parent: '', length: 40, angle: 90, color: '', image: '', width: 10 },
        { name: 'shin', parent: 'leg', length: 36, angle: 0, color: '', image: '', width: 8 }
      ],
      animations: [
        { name: 'Walk', fps: 8, mode: 'loop', tracks: [
          { bone: 'leg', angles: [80, 100, 80, 100] },
          { bone: 'shin', angles: [0, 30] }
        ] },
        { name: 'Jump', fps: 8, mode: 'once', tracks: [{ bone: 'leg', angles: [70, 60, 50] }] },
        { name: 'Sway', fps: 8, mode: 'pingpong', tracks: [{ bone: 'leg', angles: [80, 90, 100] }] }
      ]
    }
  };
}
{
  const obj = rigObj();
  const rt = SK.createSkeletonRuntime();
  const warns = [];
  const hooks = { warn: (m) => warns.push(m) };
  check('fresh runtime is inactive', SK.activeSkeletonName(rt) === '' && !SK.isSkeletonActive(rt, 'Walk'));
  check('blank play name is a quiet no-op', SK.setSkeletonAnimation(rt, obj, '', hooks) === false && warns.length === 0 && rt.active === '');
  check('unknown play name warns and holds', SK.setSkeletonAnimation(rt, obj, 'Nope', hooks) === false &&
    warns.length === 1 && /no skeletal animation named/.test(warns[0]) && rt.active === '');
  check('known play name activates', SK.setSkeletonAnimation(rt, obj, 'Walk', hooks) === true &&
    rt.active === 'Walk' && SK.isSkeletonActive(rt, 'Walk'));
  check('blank animation reads inactive', !SK.isSkeletonActive(rt, ''));
  check('other animation reads inactive', !SK.isSkeletonActive(rt, 'Jump'));
  check('stop of a non-active animation is quiet', SK.stopSkeletonAnimation(rt, obj, 'Jump') === true && rt.active === 'Walk');
  check('blank stop clears the active animation', SK.stopSkeletonAnimation(rt, obj, '') === true && rt.active === '');
  check('named stop clears only its animation', SK.setSkeletonAnimation(rt, obj, 'Walk', hooks) === true &&
    SK.stopSkeletonAnimation(rt, obj, 'Walk') === true && rt.active === '');
  check('stop on a null runtime does not throw', SK.stopSkeletonAnimation(null, obj, 'Walk') === false);
  check('play on a null runtime does not throw', SK.setSkeletonAnimation(null, obj, 'Walk', hooks) === false);
}

// ---------- frame clock ----------
{
  const obj = rigObj();
  const rt = SK.createSkeletonRuntime();
  SK.setSkeletonAnimation(rt, obj, 'Walk', {});
  SK.updateSkeleton(rt, obj, 7.5); // 7.5 frames at 60fps = 125ms = 1 frame at 8fps
  check('loop clock advances one frame per fps interval', rt.anims.Walk.frameIndex === 1, String(rt.anims.Walk.frameIndex));
  SK.updateSkeleton(rt, obj, 60); // 1000ms = 8 frames: 1 -> 1 (wraps at 4)
  check('loop clock wraps at the longest track', rt.anims.Walk.frameIndex === 1, String(rt.anims.Walk.frameIndex));
  SK.updateSkeleton(rt, obj, 7.5);
  check('loop clock keeps stepping after wrap', rt.anims.Walk.frameIndex === 2, String(rt.anims.Walk.frameIndex));
}
{
  const obj = rigObj();
  const rt = SK.createSkeletonRuntime();
  SK.setSkeletonAnimation(rt, obj, 'Sway', {});
  SK.updateSkeleton(rt, obj, 15); // 2 frames: 0 -> 1 -> 2 (end, dir flips)
  check('pingpong reaches the last frame', rt.anims.Sway.frameIndex === 2 && rt.anims.Sway.dir === -1,
    JSON.stringify(rt.anims.Sway));
  SK.updateSkeleton(rt, obj, 7.5);
  check('pingpong bounces back down', rt.anims.Sway.frameIndex === 1 && rt.anims.Sway.dir === -1,
    JSON.stringify(rt.anims.Sway));
  SK.updateSkeleton(rt, obj, 7.5);
  check('pingpong bounces back up from the first frame', rt.anims.Sway.frameIndex === 0 && rt.anims.Sway.dir === 1,
    JSON.stringify(rt.anims.Sway));
}
{
  const obj = rigObj();
  const rt = SK.createSkeletonRuntime();
  SK.setSkeletonAnimation(rt, obj, 'Jump', {});
  SK.updateSkeleton(rt, obj, 30); // 4 frames: 0 -> 1 -> 2 -> finished
  check('once clock finishes at the last frame', rt.anims.Jump.frameIndex === 2 && rt.finished === true,
    JSON.stringify(rt.anims.Jump) + ' finished=' + rt.finished);
  check('finished once animation reads inactive', !SK.isSkeletonActive(rt, 'Jump'));
  check('finished once pose holds its last track angle', SK.currentBoneAngles(rt, obj).leg === 50,
    JSON.stringify(SK.currentBoneAngles(rt, obj)));
  SK.updateSkeleton(rt, obj, 60);
  check('finished once clock does not advance further', rt.anims.Jump.frameIndex === 2);
  check('re-playing a finished once animation restarts it',
    SK.setSkeletonAnimation(rt, obj, 'Jump', {}) === true && rt.anims.Jump.frameIndex === 0 && !rt.finished);
}
{
  const obj = rigObj();
  const rt = SK.createSkeletonRuntime();
  SK.setSkeletonAnimation(rt, obj, 'Walk', {});
  SK.updateSkeleton(rt, obj, 7.5);
  check('re-playing the same loop animation keeps its clock',
    SK.setSkeletonAnimation(rt, obj, 'Walk', {}) === true && rt.anims.Walk.frameIndex === 1,
    String(rt.anims.Walk.frameIndex));
  obj.skeleton.animations = obj.skeleton.animations.filter(a => a.name !== 'Walk');
  SK.updateSkeleton(rt, obj, 7.5);
  check('deleted animation deactivates quietly', rt.active === '' && !SK.isSkeletonActive(rt, 'Walk'));
  check('updateSkeleton never throws on hostile input',
    (() => { try { SK.updateSkeleton(null, null, 'junk'); SK.updateSkeleton({}, {}, -3); return true; } catch (e) { return false; } })());
}

// ---------- bone angles: override > track > base ----------
{
  const obj = rigObj();
  const rt = SK.createSkeletonRuntime();
  check('rest pose reads base angles', SK.currentBoneAngles(rt, obj).leg === 90 && SK.currentBoneAngles(rt, obj).shin === 0,
    JSON.stringify(SK.currentBoneAngles(rt, obj)));
  SK.setSkeletonAnimation(rt, obj, 'Walk', {});
  check('track angle wins over base at frame 0', SK.currentBoneAngles(rt, obj).leg === 80);
  SK.updateSkeleton(rt, obj, 7.5);
  check('track angle steps with the frame', SK.currentBoneAngles(rt, obj).leg === 100);
  check('short track wraps at its own length (shin 2-frame track at frame 1)',
    SK.currentBoneAngles(rt, obj).shin === 30, JSON.stringify(SK.currentBoneAngles(rt, obj)));
  SK.setBoneAngle(rt, obj, 'leg', 45, {});
  check('override wins over a playing track', SK.currentBoneAngles(rt, obj).leg === 45);
  check('override leaves other bones alone', SK.currentBoneAngles(rt, obj).shin === 30);
  check('starting a new animation clears overrides',
    SK.setSkeletonAnimation(rt, obj, 'Jump', {}) === true && SK.currentBoneAngles(rt, obj).leg === 70,
    JSON.stringify(SK.currentBoneAngles(rt, obj)));
  check('stopping keeps overrides', SK.setBoneAngle(rt, obj, 'leg', 20, {}) === true &&
    SK.stopSkeletonAnimation(rt, obj, '') === true && SK.currentBoneAngles(rt, obj).leg === 20);
}
{
  const obj = rigObj();
  const rt = SK.createSkeletonRuntime();
  const warns = [];
  const hooks = { warn: (m) => warns.push(m) };
  check('blank bone pose is quiet', SK.setBoneAngle(rt, obj, '', 10, hooks) === false && warns.length === 0);
  check('unknown bone pose warns and holds', SK.setBoneAngle(rt, obj, 'toe', 10, hooks) === false &&
    warns.length === 1 && /no bone named/.test(warns[0]));
  check('bad angle pose warns and holds', SK.setBoneAngle(rt, obj, 'leg', NaN, hooks) === false &&
    warns.length === 2 && /bad angle/.test(warns[1]));
  check('null-runtime pose does not throw', SK.setBoneAngle(null, obj, 'leg', 10, hooks) === false);
  check('null-runtime angles read base pose', SK.currentBoneAngles(null, obj).leg === 90);
}

// ---------- local segments ----------
{
  const obj = rigObj();
  const segs = SK.boneSegmentsLocal(obj, SK.currentBoneAngles(null, obj));
  check('two bones give two segments', segs.length === 2, String(segs.length));
  const leg = segs[0], shin = segs[1];
  check('root bone starts at the object center', leg.x1 === 0 && leg.y1 === 0);
  check('root bone at 90 degrees points straight down', Math.abs(leg.x2 - 0) < 1e-9 && Math.abs(leg.y2 - 40) < 1e-9,
    JSON.stringify([leg.x2, leg.y2]));
  check('child starts at the parent tip', Math.abs(shin.x1 - leg.x2) < 1e-9 && Math.abs(shin.y1 - leg.y2) < 1e-9);
  check('child world angle sums the chain (90 + 0)', Math.abs(shin.angle - 90) < 1e-9, String(shin.angle));
  check('child tip extends along the summed angle', Math.abs(shin.x2 - 0) < 1e-9 && Math.abs(shin.y2 - 76) < 1e-9,
    JSON.stringify([shin.x2, shin.y2]));
  check('segment color falls back to the object color', leg.color === '#111111', leg.color);
}
{
  const obj = {
    color: '#222222',
    skeleton: { bones: [
      { name: 'hips', parent: '', length: 0, angle: 0, color: '#ff0000', image: '', width: 12 },
      { name: 'torso', parent: 'hips', length: 50, angle: -90, color: '', image: '', width: 10 },
      { name: 'head', parent: 'torso', length: 20, angle: 0, color: '', image: '', width: 10 }
    ], animations: [] }
  };
  const segs = SK.boneSegmentsLocal(obj, SK.currentBoneAngles(null, obj));
  check('zero-length pivot still anchors its child', segs[1].x1 === 0 && segs[1].y1 === 0);
  check('torso at -90 points straight up', Math.abs(segs[1].x2 - 0) < 1e-9 && Math.abs(segs[1].y2 + 50) < 1e-9,
    JSON.stringify([segs[1].x2, segs[1].y2]));
  check('head inherits the torso angle', Math.abs(segs[2].angle + 90) < 1e-9, String(segs[2].angle));
  check('explicit bone color wins over object color', segs[0].color === '#ff0000');
}
{
  // Parent listed after its child + a self-parent cycle (normalize kills
  // the self-parent, but a hand-built cycle through the raw list must
  // still terminate).
  const obj = { skeleton: { bones: [
    { name: 'child', parent: 'root', length: 10, angle: 0 },
    { name: 'root', parent: '', length: 10, angle: 0 }
  ], animations: [] } };
  const segs = SK.boneSegmentsLocal(obj, {});
  check('child listed before its parent still chains from the parent tip',
    Math.abs(segs[0].x1 - 10) < 1e-9 && segs[0].y1 === 0, JSON.stringify(segs[0]));
  check('segments never throw on hostile input', Array.isArray(SK.boneSegmentsLocal(null, null)) &&
    SK.boneSegmentsLocal(null, null).length === 0);
}

// ---------- drawing ----------
function recordingCtx() {
  const ops = [];
  return { ops,
    save() { ops.push('save'); }, restore() { ops.push('restore'); },
    translate(x, y) { ops.push(['translate', x, y]); },
    rotate(a) { ops.push(['rotate', a]); },
    beginPath() { ops.push('beginPath'); },
    moveTo(x, y) { ops.push(['moveTo', x, y]); },
    lineTo(x, y) { ops.push(['lineTo', x, y]); },
    stroke() { ops.push('stroke'); },
    arc(x, y, r, a0, a1) { ops.push(['arc', x, y, r]); },
    fill() { ops.push('fill'); },
    drawImage(img, x, y, w, h) { ops.push(['drawImage', x, y, w, h]); }
  };
}
{
  const obj = rigObj();
  const segs = SK.boneSegmentsLocal(obj, SK.currentBoneAngles(null, obj));
  const ctx = recordingCtx();
  SK.drawSkeleton(ctx, segs, () => null);
  check('limb lines draw from joint to tip',
    ctx.ops.some(o => Array.isArray(o) && o[0] === 'moveTo' && o[1] === 0 && o[2] === 0) &&
    ctx.ops.some(o => Array.isArray(o) && o[0] === 'lineTo' && Math.abs(o[2] - 40) < 1e-9),
    JSON.stringify(ctx.ops.slice(0, 8)));
  check('joint dots draw at every segment start',
    ctx.ops.filter(o => Array.isArray(o) && o[0] === 'arc').length === 2,
    JSON.stringify(ctx.ops.filter(o => Array.isArray(o) && o[0] === 'arc')));
  check('save/restore balance on the line path',
    ctx.ops.filter(o => o === 'save').length === ctx.ops.filter(o => o === 'restore').length);
}
{
  const obj = rigObj();
  obj.skeleton.bones[0].image = 'armImg';
  const segs = SK.boneSegmentsLocal(obj, SK.currentBoneAngles(null, obj));
  const fakeImg = { complete: true, naturalWidth: 20, naturalHeight: 10 };
  const ctx = recordingCtx();
  SK.drawSkeleton(ctx, segs, (id) => (id === 'armImg' ? fakeImg : null));
  check('image bones draw stretched along the bone',
    ctx.ops.some(o => Array.isArray(o) && o[0] === 'drawImage' && o[1] === 0 && o[3] === 40 && o[4] === 10),
    JSON.stringify(ctx.ops.filter(o => Array.isArray(o) && o[0] === 'drawImage')));
  check('unresolved images fall back to limb lines',
    ctx.ops.some(o => o === 'stroke'), JSON.stringify(ctx.ops.slice(0, 10)));
}
{
  const throwing = { save() { throw new Error('boom'); } };
  let threw = false;
  try { SK.drawSkeleton(throwing, [{ x1: 0, y1: 0, x2: 10, y2: 0, length: 10, angle: 0, color: '#000', width: 8 }], () => null); }
  catch (e) { threw = true; }
  check('drawSkeleton never throws on a hostile context', !threw);
  check('drawSkeleton ignores empty segment lists',
    (() => { try { SK.drawSkeleton(recordingCtx(), [], () => null); SK.drawSkeleton(null, null, null); return true; } catch (e) { return false; } })());
  const pivotOnly = [{ name: 'hips', x1: 5, y1: 6, x2: 5, y2: 6, angle: 0, length: 0, color: '#000', width: 12 }];
  const ctx = recordingCtx();
  SK.drawSkeleton(ctx, pivotOnly, () => null);
  check('zero-length bones draw a dot but no line',
    ctx.ops.some(o => Array.isArray(o) && o[0] === 'arc' && o[1] === 5 && o[2] === 6) &&
    !ctx.ops.some(o => o === 'stroke'));
}

// ---------- block type predicates ----------
check('skeleton actions are play/stop/setBoneAngle',
  SK.isSkeletonAction('playSkeletonAnimation') && SK.isSkeletonAction('stopSkeletonAnimation') &&
  SK.isSkeletonAction('setBoneAngle') && !SK.isSkeletonAction('skeletonPlaying') && !SK.isSkeletonAction('setBlend'));
check('skeleton condition is skeletonPlaying',
  SK.isSkeletonCondition('skeletonPlaying') && !SK.isSkeletonCondition('playSkeletonAnimation'));

if (failures) { console.error(`${failures} assertion(s) failed`); process.exit(1); }
console.log('skeleton.test.js: all assertions passed');
