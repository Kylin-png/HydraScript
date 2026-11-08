// Unit tests for hydra/hydra-joints.js — the shared 2D physics joints
// module.
//
// Pure logic: scene joint-list normalization (repairs, drops, dedupe),
// joint connection queries, joint removal, the per-frame solver for
// distance rods, ropes, and springs (static anchors, split corrections,
// length capture, hostile input), and the Create Joint / Remove Joint /
// Joint Connected block dispatch through host hooks. Nothing here touches
// the DOM; both runtimes delegate to this module.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const sandbox = {};
sandbox.window = sandbox; // hydra-joints.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-joints.js'), 'utf8'),
  sandbox, { filename: 'hydra-joints.js' });
const J = sandbox.HydraJoints;

check('HydraJoints exposed with helpers',
  !!J && typeof J.objectCenter === 'function' && typeof J.distanceBetween === 'function' &&
  typeof J.normalizeJoints === 'function' && typeof J.findByName === 'function' &&
  typeof J.jointConnected === 'function' && typeof J.removeJoint === 'function' &&
  typeof J.solveOneJoint === 'function' && typeof J.solveJoints === 'function' &&
  typeof J.applyJointAction === 'function' && typeof J.evalJointCondition === 'function' &&
  typeof J.isJointAction === 'function' && typeof J.isJointCondition === 'function');
check('factorySource is a self-contained function string',
  typeof J.factorySource === 'string' && J.factorySource.includes('hydraJointsFactory'));
check('JOINT_TYPES are distance, rope, spring',
  JSON.stringify(J.JOINT_TYPES) === JSON.stringify(['distance', 'rope', 'spring']));
check('DEFAULT_STIFFNESS is 0.05', J.DEFAULT_STIFFNESS === 0.05);

// --- centers ---
check('objectCenter uses pos + half size',
  (() => { const c = J.objectCenter({ posX: 10, posY: 20, width: 40, height: 60 }); return c.x === 30 && c.y === 50; })());
check('objectCenter is hostile-safe',
  (() => { const c = J.objectCenter(null); return c.x === 0 && c.y === 0; })());
check('distanceBetween measures center distance',
  J.distanceBetween({ posX: 0, posY: 0, width: 10, height: 10 }, { posX: 100, posY: 0, width: 10, height: 10 }) === 100);

// --- normalization ---
check('normalizeJoints repairs type and stiffness, keeps valid joints',
  (() => {
    const s = { joints: [{ type: 'bogus', a: 'a', b: 'b', length: 50, stiffness: 9 }] };
    const out = J.normalizeJoints(s);
    return out.length === 1 && out[0].type === 'distance' && out[0].stiffness === 1 && out[0].length === 50;
  })());
check('normalizeJoints drops blank and self joints',
  (() => {
    const s = { joints: [{ type: 'rope', a: '', b: 'b' }, { type: 'rope', a: 'x', b: 'x' }, { type: 'rope', a: 'a', b: 'b' }] };
    return J.normalizeJoints(s).length === 1;
  })());
check('normalizeJoints turns bad lengths into null (capture later)',
  (() => {
    const s = { joints: [{ type: 'rope', a: 'a', b: 'b', length: -5 }, { type: 'rope', a: 'c', b: 'd', length: 'junk' }] };
    const out = J.normalizeJoints(s);
    return out.length === 2 && out[0].length === null && out[1].length === null;
  })());
check('normalizeJoints dedupes the same unordered pair + type',
  (() => {
    const s = { joints: [
      { type: 'rope', a: 'a', b: 'b', length: 10 },
      { type: 'rope', a: 'b', b: 'a', length: 20 },
      { type: 'spring', a: 'b', b: 'a', length: 30 }
    ] };
    const out = J.normalizeJoints(s);
    return out.length === 2 && out[0].length === 10 && out[1].type === 'spring';
  })());
check('normalizeJoints creates the list on scenes without one',
  (() => { const s = {}; J.normalizeJoints(s); return Array.isArray(s.joints) && s.joints.length === 0; })());
check('normalizeJoints is hostile-safe', J.normalizeJoints(null).length === 0);

// --- connection queries + removal ---
check('jointConnected matches either direction',
  J.jointConnected([{ type: 'rope', a: 'a', b: 'b' }], 'b', 'a') === true &&
  J.jointConnected([{ type: 'rope', a: 'a', b: 'b' }], 'a', 'c') === false);
check('jointConnected with blank B means any joint involving A',
  J.jointConnected([{ type: 'rope', a: 'a', b: 'b' }], 'b', '') === true &&
  J.jointConnected([{ type: 'rope', a: 'a', b: 'b' }], 'z', '') === false);
check('jointConnected with blank A is never connected',
  J.jointConnected([{ type: 'rope', a: 'a', b: 'b' }], '', 'b') === false);
check('removeJoint removes only the named pair',
  (() => {
    const list = [{ type: 'rope', a: 'a', b: 'b' }, { type: 'rope', a: 'a', b: 'c' }];
    const n = J.removeJoint(list, 'a', 'b');
    return n === 1 && list.length === 1 && list[0].b === 'c';
  })());
check('removeJoint with blank B removes every joint involving A',
  (() => {
    const list = [{ type: 'rope', a: 'a', b: 'b' }, { type: 'spring', a: 'a', b: 'c' }, { type: 'rope', a: 'x', b: 'y' }];
    const n = J.removeJoint(list, 'a', '');
    return n === 2 && list.length === 1 && list[0].a === 'x';
  })());
check('removeJoint on a missing pair removes nothing',
  (() => { const list = [{ type: 'rope', a: 'a', b: 'b' }]; return J.removeJoint(list, 'a', 'z') === 0 && list.length === 1; })());

// --- solver: distance rod ---
check('distance rod holds two moving objects at the rod length (split half)',
  (() => {
    const a = { name: 'a', posX: 0, posY: 0, width: 10, height: 10 };
    const b = { name: 'b', posX: 200, posY: 0, width: 10, height: 10 };
    J.solveJoints([a, b], [{ type: 'distance', a: 'a', b: 'b', length: 100 }], 1);
    const d = J.distanceBetween(a, b);
    return Math.abs(d - 100) < 0.001 && Math.abs(a.posX - 50) < 0.001 && Math.abs(b.posX - 150) < 0.001;
  })());
check('distance rod against a static anchor moves only the free end',
  (() => {
    const a = { name: 'a', posX: 0, posY: 0, width: 10, height: 10, static: true };
    const b = { name: 'b', posX: 200, posY: 0, width: 10, height: 10 };
    J.solveJoints([a, b], [{ type: 'distance', a: 'a', b: 'b', length: 100 }], 1);
    return a.posX === 0 && Math.abs(J.distanceBetween(a, b) - 100) < 0.001;
  })());
check('distance rod with length 0 welds the centers together',
  (() => {
    const a = { name: 'a', posX: 0, posY: 0, width: 10, height: 10 };
    const b = { name: 'b', posX: 80, posY: 60, width: 10, height: 10 };
    J.solveJoints([a, b], [{ type: 'distance', a: 'a', b: 'b', length: 0 }], 1);
    return J.distanceBetween(a, b) < 0.001;
  })());
check('distance rod does nothing when both ends are static',
  (() => {
    const a = { name: 'a', posX: 0, posY: 0, width: 10, height: 10, static: true };
    const b = { name: 'b', posX: 200, posY: 0, width: 10, height: 10, static: true };
    J.solveJoints([a, b], [{ type: 'distance', a: 'a', b: 'b', length: 100 }], 1);
    return a.posX === 0 && b.posX === 200;
  })());

// --- solver: rope ---
check('rope pulls together only when stretched past its length',
  (() => {
    const a = { name: 'a', posX: 0, posY: 0, width: 10, height: 10, static: true };
    const b = { name: 'b', posX: 300, posY: 0, width: 10, height: 10 };
    J.solveJoints([a, b], [{ type: 'rope', a: 'a', b: 'b', length: 100 }], 1);
    const stretched = Math.abs(J.distanceBetween(a, b) - 100) < 0.001;
    const c = { name: 'c', posX: 0, posY: 0, width: 10, height: 10, static: true };
    const d = { name: 'd', posX: 50, posY: 0, width: 10, height: 10 };
    J.solveJoints([c, d], [{ type: 'rope', a: 'c', b: 'd', length: 100 }], 1);
    return stretched && d.posX === 50; // slack: untouched
  })());

// --- solver: spring ---
check('spring pulls a stretched pair toward the rest length and settles',
  (() => {
    const a = { name: 'a', posX: 0, posY: 0, width: 10, height: 10, static: true, velX: 0, velY: 0 };
    const b = { name: 'b', posX: 200, posY: 0, width: 10, height: 10, velX: 0, velY: 0 };
    const joint = { type: 'spring', a: 'a', b: 'b', length: 50, stiffness: 0.05 };
    for (let f = 0; f < 120; f++) {
      J.solveJoints([a, b], [joint], 1);
      b.posX += b.velX; b.posY += b.velY;
    }
    const d = J.distanceBetween(a, b);
    return Math.abs(d - 50) < 5 && Math.abs(b.velX) < 1;
  })());
check('spring does not explode on a huge stretch',
  (() => {
    const a = { name: 'a', posX: 0, posY: 0, width: 10, height: 10, static: true, velX: 0, velY: 0 };
    const b = { name: 'b', posX: 5000, posY: 0, width: 10, height: 10, velX: 0, velY: 0 };
    J.solveJoints([a, b], [{ type: 'spring', a: 'a', b: 'b', length: 50, stiffness: 1 }], 1);
    return Math.abs(b.velX) <= 30.001;
  })());

// --- solver: capture + chains + hostile ---
check('null length captures the current distance on first solve',
  (() => {
    const a = { name: 'a', posX: 0, posY: 0, width: 10, height: 10 };
    const b = { name: 'b', posX: 130, posY: 0, width: 10, height: 10 };
    const joint = { type: 'distance', a: 'a', b: 'b', length: null };
    J.solveJoints([a, b], [joint], 1);
    return joint.length === 130;
  })());
check('a chain of two rods settles over frames (two passes per frame)',
  (() => {
    const a = { name: 'a', posX: 0, posY: 0, width: 10, height: 10, static: true };
    const b = { name: 'b', posX: 150, posY: 0, width: 10, height: 10 };
    const c = { name: 'c', posX: 400, posY: 0, width: 10, height: 10 };
    const joints = [
      { type: 'distance', a: 'a', b: 'b', length: 100 },
      { type: 'distance', a: 'b', b: 'c', length: 100 }
    ];
    for (let f = 0; f < 12; f++) J.solveJoints([a, b, c], joints, 1);
    return Math.abs(J.distanceBetween(a, b) - 100) < 1 && Math.abs(J.distanceBetween(b, c) - 100) < 1;
  })());
check('solver skips missing endpoints and hostile records without throwing',
  (() => {
    const a = { name: 'a', posX: 0, posY: 0, width: 10, height: 10 };
    J.solveJoints([a], [{ type: 'rope', a: 'a', b: 'ghost', length: 50 }, null, 'junk'], 1);
    J.solveJoints(null, null, 1);
    J.solveJoints([a], [{ type: 'rope', a: 'a', b: 'a', length: 50 }], 1);
    return a.posX === 0;
  })());

// --- block dispatch: createJoint ---
function jointHooks(scene, live) {
  const warns = [];
  return {
    hooks: {
      scene: () => scene,
      objects: () => live,
      num: (raw) => {
        if (raw == null || String(raw).trim() === '') return { ok: false, value: 0 };
        const v = Number(raw);
        return { ok: Number.isFinite(v), value: v };
      },
      warn: (m) => warns.push(m)
    },
    warns
  };
}
check('createJoint writes a joint with explicit length + stiffness',
  (() => {
    const scene = { joints: [] };
    const live = [
      { name: 'a', posX: 0, posY: 0, width: 10, height: 10 },
      { name: 'b', posX: 90, posY: 0, width: 10, height: 10 }
    ];
    const { hooks, warns } = jointHooks(scene, live);
    J.applyJointAction({ type: 'createJoint', object1: 'a', object2: 'b', jointType: 'rope', length: '120', stiffness: '0.2' }, hooks);
    return scene.joints.length === 1 && scene.joints[0].length === 120 &&
      scene.joints[0].stiffness === 0.2 && scene.joints[0].type === 'rope' && warns.length === 0;
  })());
check('createJoint with blank length captures the current distance',
  (() => {
    const scene = { joints: [] };
    const live = [
      { name: 'a', posX: 0, posY: 0, width: 10, height: 10 },
      { name: 'b', posX: 70, posY: 0, width: 10, height: 10 }
    ];
    const { hooks } = jointHooks(scene, live);
    J.applyJointAction({ type: 'createJoint', object1: 'a', object2: 'b', jointType: 'distance', length: '', stiffness: '' }, hooks);
    return scene.joints.length === 1 && scene.joints[0].length === 70;
  })());
check('createJoint re-creating the same pair + type replaces it, other types survive',
  (() => {
    const scene = { joints: [
      { type: 'rope', a: 'a', b: 'b', length: 10, stiffness: 0.05 },
      { type: 'spring', a: 'a', b: 'b', length: 20, stiffness: 0.05 }
    ] };
    const live = [
      { name: 'a', posX: 0, posY: 0, width: 10, height: 10 },
      { name: 'b', posX: 70, posY: 0, width: 10, height: 10 }
    ];
    const { hooks } = jointHooks(scene, live);
    J.applyJointAction({ type: 'createJoint', object1: 'b', object2: 'a', jointType: 'rope', length: '55', stiffness: '' }, hooks);
    const rope = scene.joints.filter(j => j.type === 'rope');
    const spring = scene.joints.filter(j => j.type === 'spring');
    return scene.joints.length === 2 && rope.length === 1 && rope[0].length === 55 && spring.length === 1;
  })());
check('createJoint warns + holds on a bad type',
  (() => {
    const scene = { joints: [] };
    const live = [{ name: 'a' }, { name: 'b' }];
    const { hooks, warns } = jointHooks(scene, live);
    J.applyJointAction({ type: 'createJoint', object1: 'a', object2: 'b', jointType: 'chain', length: '', stiffness: '' }, hooks);
    return scene.joints.length === 0 && warns.some(w => /bad joint type/.test(w));
  })());
check('createJoint warns + holds on a bad length',
  (() => {
    const scene = { joints: [] };
    const live = [{ name: 'a' }, { name: 'b' }];
    const { hooks, warns } = jointHooks(scene, live);
    J.applyJointAction({ type: 'createJoint', object1: 'a', object2: 'b', jointType: 'rope', length: '-3', stiffness: '' }, hooks);
    return scene.joints.length === 0 && warns.some(w => /bad length/.test(w));
  })());
check('createJoint warns + holds on a bad stiffness',
  (() => {
    const scene = { joints: [] };
    const live = [{ name: 'a' }, { name: 'b' }];
    const { hooks, warns } = jointHooks(scene, live);
    J.applyJointAction({ type: 'createJoint', object1: 'a', object2: 'b', jointType: 'spring', length: '', stiffness: '2' }, hooks);
    return scene.joints.length === 0 && warns.some(w => /bad stiffness/.test(w));
  })());
check('createJoint warns + holds when an endpoint is missing',
  (() => {
    const scene = { joints: [] };
    const live = [{ name: 'a' }];
    const { hooks, warns } = jointHooks(scene, live);
    J.applyJointAction({ type: 'createJoint', object1: 'a', object2: 'ghost', jointType: 'rope', length: '', stiffness: '' }, hooks);
    return scene.joints.length === 0 && warns.some(w => /not found/.test(w));
  })());
check('createJoint warns + holds on a self joint',
  (() => {
    const scene = { joints: [] };
    const live = [{ name: 'a' }];
    const { hooks, warns } = jointHooks(scene, live);
    J.applyJointAction({ type: 'createJoint', object1: 'a', object2: 'a', jointType: 'rope', length: '', stiffness: '' }, hooks);
    return scene.joints.length === 0 && warns.some(w => /itself/.test(w));
  })());
check('createJoint with a blank name stays quiet',
  (() => {
    const scene = { joints: [] };
    const { hooks, warns } = jointHooks(scene, [{ name: 'a' }]);
    J.applyJointAction({ type: 'createJoint', object1: '', object2: 'a', jointType: 'rope', length: '', stiffness: '' }, hooks);
    return scene.joints.length === 0 && warns.length === 0;
  })());

// --- block dispatch: removeJoint + condition ---
check('removeJoint removes the pair, blank B removes all involving A',
  (() => {
    const scene = { joints: [
      { type: 'rope', a: 'a', b: 'b', length: 10, stiffness: 0.05 },
      { type: 'rope', a: 'a', b: 'c', length: 10, stiffness: 0.05 }
    ] };
    const { hooks } = jointHooks(scene, []);
    J.applyJointAction({ type: 'removeJoint', object1: 'a', object2: 'b' }, hooks);
    const afterPair = scene.joints.length === 1;
    J.applyJointAction({ type: 'removeJoint', object1: 'a', object2: '' }, hooks);
    return afterPair && scene.joints.length === 0;
  })());
check('removeJoint with a blank A stays quiet',
  (() => {
    const scene = { joints: [{ type: 'rope', a: 'a', b: 'b', length: 10, stiffness: 0.05 }] };
    const { hooks, warns } = jointHooks(scene, []);
    J.applyJointAction({ type: 'removeJoint', object1: '', object2: 'b' }, hooks);
    return scene.joints.length === 1 && warns.length === 0;
  })());
check('jointConnected condition fires, reverses via host, blank stays quiet',
  (() => {
    const scene = { joints: [{ type: 'rope', a: 'a', b: 'b', length: 10, stiffness: 0.05 }] };
    const hit = J.evalJointCondition({ type: 'jointConnected', object1: 'b', object2: 'a' }, { scene: () => scene });
    const miss = J.evalJointCondition({ type: 'jointConnected', object1: 'a', object2: 'z' }, { scene: () => scene });
    const any = J.evalJointCondition({ type: 'jointConnected', object1: 'a', object2: '' }, { scene: () => scene });
    const blank = J.evalJointCondition({ type: 'jointConnected', object1: '', object2: 'b' }, { scene: () => scene });
    const hostile = J.evalJointCondition(null, null);
    return hit.pass === true && miss.pass === false && any.pass === true &&
      blank.pass === false && hostile.pass === false;
  })());
check('isJointAction / isJointCondition recognize only joint types',
  J.isJointAction('createJoint') && J.isJointAction('removeJoint') && !J.isJointAction('setLight2d') &&
  J.isJointCondition('jointConnected') && !J.isJointCondition('darknessLevel'));

if (failures) { console.error(`${failures} assertion(s) failed`); process.exit(1); }
console.log('joints.test.js: all assertions passed');
