// Unit tests for hydra/hydra-3d.js — the shared 3D rendering foundation.
//
// Pure logic: vec3 math, Euler rotation, primitive mesh builders, camera
// normalization, perspective projection, flat shading, the built-in
// projector (renderScene on a stub context), and the action + condition
// dispatches, with hostile-input safety. Nothing here touches the DOM; both
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
sandbox.window = sandbox; // hydra-3d.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-3d.js'), 'utf8'),
  sandbox, { filename: 'hydra-3d.js' });
const H = sandbox.Hydra3d;

check('Hydra3d exposed with dispatchers',
  !!H && typeof H.apply3dAction === 'function' &&
  typeof H.eval3dCondition === 'function' &&
  typeof H.renderScene === 'function');
check('factorySource is a self-contained function string',
  typeof H.factorySource === 'string' && H.factorySource.includes('hydra3dFactory'));
check('17 action types registered',
  H.ACTION_TYPES.length === 17 &&
  ['set3dPosition', 'move3d', 'set3dRotation', 'rotate3d', 'setModelTint',
   'useModelTexture', 'set3dCamera', 'follow3dCamera', 'stop3dCameraFollow',
   'aim3dCamera', 'move3dFacing', 'captureMouse', 'releaseMouse', 'readMouseDelta',
   'set3dGravity', 'set3dVelocity', 'set3dLight']
    .every(t => H.is3dAction(t)) &&
  !H.is3dAction('setPosition') && !H.is3dAction('teleport'));
check('4 condition types registered',
  H.CONDITION_TYPES.length === 4 && H.is3dCondition('distance3d') &&
  H.is3dCondition('mousePointerCaptured') && H.is3dCondition('onGround3d') &&
  H.is3dCondition('collision3d') && !H.is3dCondition('distanceCheck'));
check('5 3D kinds registered (4 primitives + model3d)',
  H.THREE_D_KINDS.length === 5 &&
  ['box3d', 'sphere3d', 'plane3d', 'cylinder3d', 'model3d'].every(k => H.is3dKind(k)) &&
  !H.is3dKind('sprite') && !H.is3dKind('text') && !H.is3dKind(null));

// ---------- vec3 ----------
check('vdot/vcross/vlen/vnorm basics',
  H.vdot([1, 2, 3], [4, 5, 6]) === 32 &&
  JSON.stringify(H.vcross([1, 0, 0], [0, 1, 0])) === JSON.stringify([0, 0, 1]) &&
  Math.abs(H.vlen([3, 4, 0]) - 5) < 1e-9 &&
  Math.abs(H.vlen(H.vnorm([0, 0, 7])) - 1) < 1e-9);
check('vnorm of zero vector stays zero (no NaN)',
  JSON.stringify(H.vnorm([0, 0, 0])) === JSON.stringify([0, 0, 0]));
check('rotXYZ: 90 deg about Z sends +x to +y',
  (() => { const p = H.rotXYZ([10, 0, 0], 0, 0, 90);
    return Math.abs(p[0]) < 1e-9 && Math.abs(p[1] - 10) < 1e-9 && Math.abs(p[2]) < 1e-9; })());
check('rotXYZ: 90 deg about Y sends +x to -z',
  (() => { const p = H.rotXYZ([10, 0, 0], 0, 90, 0);
    return Math.abs(p[0]) < 1e-9 && Math.abs(p[1]) < 1e-9 && Math.abs(p[2] + 10) < 1e-9; })());
check('rotXYZ: 90 deg about X sends +y to +z',
  (() => { const p = H.rotXYZ([0, 10, 0], 90, 0, 0);
    return Math.abs(p[0]) < 1e-9 && Math.abs(p[1]) < 1e-9 && Math.abs(p[2] - 10) < 1e-9; })());
check('rotXYZ hostile input never throws, returns numbers',
  (() => { const p = H.rotXYZ(null, 'junk', NaN, undefined);
    return p.length === 3 && p.every(Number.isFinite); })());

// ---------- meshes ----------
check('buildBox: 8 verts, 12 tris',
  (() => { const m = H.buildBox(80, 80, 80);
    return m.verts.length === 8 && m.tris.length === 12; })());
check('buildBox hostile sizes stay finite',
  (() => { const m = H.buildBox(NaN, -5, 'junk');
    return m.verts.every(v => v.every(Number.isFinite)); })());
check('buildPlane: 4 verts, 2 tris',
  (() => { const m = H.buildPlane(160, 120);
    return m.verts.length === 4 && m.tris.length === 2; })());
check('buildSphere: grid verts and quad tris',
  (() => { const m = H.buildSphere(64, 64, 64);
    return m.verts.length === 121 && m.tris.length === 200 &&
      m.verts.every(v => v.every(Number.isFinite)); })());
check('buildCylinder: side + cap tris',
  (() => { const m = H.buildCylinder(64, 64, 64);
    return m.tris.length === 48 && m.verts.every(v => v.every(Number.isFinite)); })());

// ---------- normalization ----------
check('normalizeCamera3d fills defaults from scene size',
  (() => { const c = H.normalizeCamera3d(null, { worldWidth: 800, worldHeight: 600 });
    return c.x === 400 && c.y === 300 && Math.abs(c.z - 920) < 1e-9 &&
      c.tx === 400 && c.ty === 300 && c.tz === 0 && c.fov === 60; })());
check('normalizeCamera3d keeps explicit values, clamps fov',
  (() => { const c = H.normalizeCamera3d({ x: 1, y: 2, z: 3, tx: 4, ty: 5, tz: 6, fov: 500 }, null);
    return c.x === 1 && c.z === 3 && c.ty === 5 && c.fov === 120; })());
check('normalizeCamera3d hostile input never throws',
  (() => { const c = H.normalizeCamera3d('junk', 'junk');
    return Number.isFinite(c.x) && Number.isFinite(c.fov); })());
check('normalizeObject3d repairs fields',
  (() => { const o = H.normalizeObject3d({ kind: 'box3d', width: 80, height: 'junk', z: 'x', depth: -5, rotX: NaN });
    return o.z === 0 && o.depth === 64 && o.rotX === 0 && Number.isFinite(o.rotY); })());
check('normalizeRenderMode: 3d in, everything else 2d',
  H.normalizeRenderMode('3d') === '3d' && H.normalizeRenderMode('3D') === '3d' &&
  H.normalizeRenderMode('2d') === '2d' && H.normalizeRenderMode('junk') === '2d' &&
  H.normalizeRenderMode(null) === '2d');

// ---------- projection ----------
check('projectPoint: target centers on screen',
  (() => { const cam = H.normalizeCamera3d(null, { worldWidth: 800, worldHeight: 600 });
    const basis = H.cameraBasis(cam);
    const s = H.projectPoint(basis, cam.fov, [400, 300, 0], 800, 600);
    return s && Math.abs(s.x - 400) < 1e-6 && Math.abs(s.y - 300) < 1e-6 && s.depth > 0; })());
check('projectPoint: point right of target lands right of center',
  (() => { const cam = H.normalizeCamera3d(null, { worldWidth: 800, worldHeight: 600 });
    const basis = H.cameraBasis(cam);
    const s = H.projectPoint(basis, cam.fov, [500, 300, 0], 800, 600);
    return s && s.x > 400; })());
check('projectPoint: point below target (larger y) lands below center',
  (() => { const cam = H.normalizeCamera3d(null, { worldWidth: 800, worldHeight: 600 });
    const basis = H.cameraBasis(cam);
    const s = H.projectPoint(basis, cam.fov, [400, 400, 0], 800, 600);
    return s && s.y > 300; })());
check('projectPoint: point behind camera returns null',
  (() => { const cam = H.normalizeCamera3d(null, { worldWidth: 800, worldHeight: 600 });
    const basis = H.cameraBasis(cam);
    return H.projectPoint(basis, cam.fov, [400, 300, cam.z + 100], 800, 600) === null; })());
check('projectPoint: nearer point (larger z) projects larger',
  (() => { const cam = H.normalizeCamera3d(null, { worldWidth: 800, worldHeight: 600 });
    const basis = H.cameraBasis(cam);
    const near = H.projectPoint(basis, cam.fov, [500, 300, 100], 800, 600);
    const far = H.projectPoint(basis, cam.fov, [500, 300, -100], 800, 600);
    return near && far && (near.x - 400) > (far.x - 400); })());

// ---------- shading ----------
check('shadeColor: white at full light, dark at low light',
  H.shadeColor('#ffffff', 1) === 'rgb(255,255,255)' &&
  H.shadeColor('#ffffff', 0.1) === 'rgb(26,26,26)');
check('shadeColor: 3-digit hex and unknown colors',
  H.shadeColor('#f00', 1) === 'rgb(255,0,0)' &&
  H.shadeColor('junk', 1) === 'rgb(68,136,255)');

// ---------- centerOf / distance3d ----------
check('centerOf uses posX+w/2, posY+h/2, z',
  (() => { const c = H.centerOf({ posX: 0, posY: 0, z: 10, width: 80, height: 60 });
    return c[0] === 40 && c[1] === 30 && c[2] === 10; })());
check('distance3d counts all three axes',
  (() => { const d = H.distance3d(
      { posX: -40, posY: -30, z: 0, width: 80, height: 60 },
      { posX: -40, posY: -30, z: 40, width: 80, height: 60 });
    return Math.abs(d - 40) < 1e-9; })());

// ---------- renderScene on a stub context ----------
function stubCtx() {
  const calls = [];
  return {
    calls,
    save() {}, restore() {}, beginPath() {}, closePath() {},
    moveTo(x, y) { calls.push(['moveTo', x, y]); },
    lineTo(x, y) { calls.push(['lineTo', x, y]); },
    fill() { calls.push(['fill']); }, stroke() { calls.push(['stroke']); },
    clearRect() {}, fillRect() {},
    set fillStyle(v) {}, set strokeStyle(v) {}, set lineWidth(v) {}
  };
}
check('renderScene draws triangles for a box on stub ctx',
  (() => { const g = stubCtx();
    H.renderScene(g, { worldWidth: 800, worldHeight: 600, camera3d: null },
      [{ kind: 'box3d', posX: 360, posY: 260, z: 0, width: 80, height: 80, depth: 80, color: '#ff0000' }],
      800, 600);
    return g.calls.filter(c => c[0] === 'fill').length === 12; })());
check('renderScene skips non-3D objects',
  (() => { const g = stubCtx();
    H.renderScene(g, { worldWidth: 800, worldHeight: 600, camera3d: null },
      [{ kind: 'sprite', posX: 0, posY: 0, width: 80, height: 80 }],
      800, 600);
    return g.calls.filter(c => c[0] === 'fill').length === 0; })());
check('renderScene with hostile scene/objects never throws',
  (() => { const g = stubCtx();
    H.renderScene(g, null, null, 800, 600);
    H.renderScene(null, { camera3d: 'junk' }, [{ kind: 'box3d' }], 0, 0);
    H.renderScene(g, {}, [{ kind: 'box3d', width: NaN, color: 42 }], 800, 600);
    return true; })());
check('renderScene draws all four primitives',
  (() => { const g = stubCtx();
    H.renderScene(g, { worldWidth: 800, worldHeight: 600, camera3d: null }, [
      { kind: 'box3d', posX: 60, posY: 60, z: 0, width: 80, height: 80, depth: 80, color: '#ff0000' },
      { kind: 'sphere3d', posX: 260, posY: 60, z: 0, width: 64, height: 64, depth: 64, color: '#00ff00' },
      { kind: 'plane3d', posX: 460, posY: 60, z: 0, width: 120, height: 90, depth: 4, color: '#0000ff' },
      { kind: 'cylinder3d', posX: 660, posY: 60, z: 0, width: 64, height: 96, depth: 64, color: '#ffff00' }
    ], 800, 600);
    // 12 box + 200 sphere + 2 plane + 48 cylinder = 262 fills
    return g.calls.filter(c => c[0] === 'fill').length === 262; })());

// ---------- action dispatch ----------
function hooks(extra) {
  function num(raw) {
    const v = Number(String(raw == null ? '' : raw).trim());
    return { value: v, ok: Number.isFinite(v) };
  }
  return Object.assign({
    targets: (data) => [{ posX: 0, posY: 0, z: 0, width: 80, height: 60, depth: 40, rotX: 0, rotY: 0, rotZ: 0 }],
    num,
    warn: (msg) => { (hooks.warnings = hooks.warnings || []).push(msg); },
    objectsByName: (name) => [],
    camera3d: () => hooks.cam
  }, extra || {});
}
hooks.cam = { x: 0, y: 0, z: 900, tx: 0, ty: 0, tz: 0, fov: 60 };

check('set3dPosition moves the CENTER',
  (() => { const h = hooks(); let got = null;
    h.targets = () => { got = { posX: 0, posY: 0, z: 5, width: 80, height: 60 }; return [got]; };
    H.apply3dAction({ type: 'set3dPosition', x: 400, y: 300, z: 20 }, h);
    return got.posX === 360 && got.posY === 270 && got.z === 20; })());
check('move3d adds deltas',
  (() => { let got = null;
    const h = hooks({ targets: () => { got = { posX: 10, posY: 20, z: 5, width: 80, height: 60 }; return [got]; } });
    H.apply3dAction({ type: 'move3d', dX: 5, dY: -5, dZ: 10 }, h);
    return got.posX === 15 && got.posY === 15 && got.z === 15; })());
check('set3dRotation / rotate3d write and add',
  (() => { const got = { rotX: 10, rotY: 20, rotZ: 30 };
    const h = hooks({ targets: () => [got] });
    H.apply3dAction({ type: 'set3dRotation', rotX: 45, rotY: 0, rotZ: 0 }, h);
    const afterSet = got.rotX === 45 && got.rotY === 0 && got.rotZ === 0;
    H.apply3dAction({ type: 'rotate3d', rotX: 5, rotY: 5, rotZ: 5 }, h);
    return afterSet && got.rotX === 50 && got.rotY === 5 && got.rotZ === 5; })());
check('set3dCamera mutates the live camera object',
  (() => { const cam = { x: 0, y: 0, z: 900, tx: 0, ty: 0, tz: 0, fov: 60 };
    const h = hooks({ camera3d: () => cam });
    H.apply3dAction({ type: 'set3dCamera', camX: 100, camY: 200, camZ: 300, lookX: 1, lookY: 2, lookZ: 3 }, h);
    return cam.x === 100 && cam.y === 200 && cam.z === 300 && cam.tx === 1 && cam.ty === 2 && cam.tz === 3; })());
check('bad expressions warn and skip the action',
  (() => { hooks.warnings = [];
    let got = null;
    const h = hooks({ targets: () => { got = { posX: 1, posY: 2, z: 3, width: 80, height: 60 }; return [got]; } });
    H.apply3dAction({ type: 'set3dPosition', x: 400, y: 'junk', z: 20 }, h);
    return got.posX === 1 && hooks.warnings.length === 1; })());
check('unknown action type is a quiet no-op',
  (() => { H.apply3dAction({ type: 'explode3d' }, hooks()); return true; })());
check('hostile action input never throws',
  (() => { H.apply3dAction(null, hooks()); H.apply3dAction({ type: 'move3d' }, null);
    H.apply3dAction({ type: 'set3dCamera' }, hooks({ camera3d: () => null })); return true; })());

// ---------- 3D camera follow (batch 2) ----------
check('normalize3dFollow sanitizes records',
  JSON.stringify(H.normalize3dFollow({ name: ' P ', dx: 10, dy: 'x', dz: -5 })) ===
    JSON.stringify({ name: 'P', dx: 10, dy: 0, dz: -5 }) &&
  H.normalize3dFollow(null) === null &&
  H.normalize3dFollow({ name: '   ' }) === null &&
  H.normalize3dFollow('junk') === null);
check('tick3dCameraFollow parks camera at center + offset, look-at at center',
  (() => { const cam = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0 };
    const target = { posX: 100, posY: 60, width: 40, height: 40, z: 5 };
    H.tick3dCameraFollow(cam, { name: 'P', dx: 10, dy: -20, dz: 30 },
      (n) => n === 'P' ? [target] : []);
    return cam.x === 130 && cam.y === 60 && cam.z === 35 &&
           cam.tx === 120 && cam.ty === 80 && cam.tz === 5; })());
check('tick3dCameraFollow holds position when the target is gone',
  (() => { const cam = { x: 7, y: 8, z: 9, tx: 1, ty: 2, tz: 3 };
    H.tick3dCameraFollow(cam, { name: 'P', dx: 1, dy: 1, dz: 1 }, () => []);
    return cam.x === 7 && cam.y === 8 && cam.z === 9; })());
check('tick3dCameraFollow hostile input never throws',
  (() => { H.tick3dCameraFollow(null, null, null);
    H.tick3dCameraFollow({}, { name: 'P' }, () => { throw new Error('x'); });
    H.tick3dCameraFollow({}, 'junk', 'junk'); return true; })());
check('follow3dCamera stores the follow via hooks.setFollow3d',
  (() => { let stored = 'unset';
    const h = hooks({ setFollow3d: (f) => { stored = f; } });
    H.apply3dAction({ type: 'follow3dCamera', targetObject: 'Player', offX: 0, offY: -60, offZ: 280 }, h);
    return JSON.stringify(stored) === JSON.stringify({ name: 'Player', dx: 0, dy: -60, dz: 280 }); })());
check('follow3dCamera with blank name clears the follow silently',
  (() => { let stored = 'unset'; hooks.warnings = [];
    const h = hooks({ setFollow3d: (f) => { stored = f; } });
    H.apply3dAction({ type: 'follow3dCamera', targetObject: '   ', offX: 0, offY: 0, offZ: 0 }, h);
    return stored === null && (hooks.warnings || []).length === 0; })());
check('follow3dCamera bad offset warns and keeps the old follow',
  (() => { let stored = 'unset'; hooks.warnings = [];
    const h = hooks({ setFollow3d: (f) => { stored = f; } });
    H.apply3dAction({ type: 'follow3dCamera', targetObject: 'P', offX: 0, offY: 'junk', offZ: 0 }, h);
    return stored === 'unset' && hooks.warnings.length === 1; })());
check('stop3dCameraFollow clears via hooks.setFollow3d',
  (() => { let stored = 'unset';
    const h = hooks({ setFollow3d: (f) => { stored = f; } });
    H.apply3dAction({ type: 'stop3dCameraFollow' }, h);
    return stored === null; })());
check('set3dCamera clears an active follow',
  (() => { let stored = 'unset';
    const cam = { x: 0, y: 0, z: 900, tx: 0, ty: 0, tz: 0, fov: 60 };
    const h = hooks({ camera3d: () => cam, setFollow3d: (f) => { stored = f; } });
    H.apply3dAction({ type: 'set3dCamera', camX: 1, camY: 2, camZ: 3, lookX: 4, lookY: 5, lookZ: 6 }, h);
    return stored === null && cam.x === 1; })());
check('follow actions work when the host has no setFollow3d hook (old hosts)',
  (() => { H.apply3dAction({ type: 'follow3dCamera', targetObject: 'P', offX: 1, offY: 2, offZ: 3 }, hooks());
    H.apply3dAction({ type: 'stop3dCameraFollow' }, hooks()); return true; })());

// ---------- condition dispatch ----------
function condHooks(a, b) {
  return hooks({
    objectsByName: (name) => name === 'A' ? [a] : name === 'B' ? [b] : []
  });
}
const objA = { posX: -40, posY: -30, z: 0, width: 80, height: 60 };
const objB = { posX: -40, posY: -30, z: 30, width: 80, height: 60 }; // distance 30

check('distance3d fires within range',
  H.eval3dCondition({ type: 'distance3d', object1: 'A', object2: 'B', operator: '<=', distance: 50 },
    condHooks(objA, objB)).pass === true);
check('distance3d quiet beyond range',
  H.eval3dCondition({ type: 'distance3d', object1: 'A', object2: 'B', operator: '<=', distance: 10 },
    condHooks(objA, objB)).pass === false);
check('distance3d > operator',
  H.eval3dCondition({ type: 'distance3d', object1: 'A', object2: 'B', operator: '>', distance: 10 },
    condHooks(objA, objB)).pass === true);
check('distance3d corrupt operator stays quiet',
  H.eval3dCondition({ type: 'distance3d', object1: 'A', object2: 'B', operator: 'junk', distance: 10 },
    condHooks(objA, objB)).pass === false);
check('distance3d blank/missing names stay quiet',
  H.eval3dCondition({ type: 'distance3d', object1: '', object2: 'B', operator: '<=', distance: 10 },
    condHooks(objA, objB)).pass === false &&
  H.eval3dCondition({ type: 'distance3d', object1: 'A', object2: 'Nobody', operator: '<=', distance: 10 },
    condHooks(objA, objB)).pass === false);
check('distance3d bad distance stays quiet',
  H.eval3dCondition({ type: 'distance3d', object1: 'A', object2: 'B', operator: '<=', distance: 'junk' },
    condHooks(objA, objB)).pass === false);
check('distance3d pass carries both objects in context',
  (() => { const r = H.eval3dCondition({ type: 'distance3d', object1: 'A', object2: 'B', operator: '<=', distance: 50 },
      condHooks(objA, objB));
    return r.pass && r.context.obj1 === objA && r.context.obj2 === objB; })());
check('hostile condition input never throws',
  (() => { H.eval3dCondition(null, condHooks(objA, objB));
    H.eval3dCondition({ type: 'distance3d' }, null); return true; })());

// ---------- 3D models (3D2 batch 1) ----------
check('normalizeObject3d repairs model fields',
  (() => { const o = H.normalizeObject3d({ kind: 'model3d', width: 120, height: 120, materialColor: 'junk', modelAssetId: 42 });
    return o.materialColor === '#ffffff' && o.modelAssetId === null && o.z === 0 && o.depth === 120; })());
check('normalizeObject3d keeps a valid tint and asset id',
  (() => { const o = H.normalizeObject3d({ kind: 'model3d', materialColor: '#ff0000', modelAssetId: 'asset_1' });
    return o.materialColor === '#ff0000' && o.modelAssetId === 'asset_1'; })());
check('normalizeObject3d gives primitives a white (no-op) tint',
  H.normalizeObject3d({ kind: 'box3d' }).materialColor === '#ffffff');
check('normalizeObject3d defaults useTexture to true, keeps false',
  H.normalizeObject3d({ kind: 'model3d' }).useTexture === true &&
  H.normalizeObject3d({ kind: 'model3d', useTexture: false }).useTexture === false &&
  H.normalizeObject3d({ kind: 'model3d', useTexture: 'junk' }).useTexture === true);
check('tintRGB parses hex, hostile input reads as white',
  JSON.stringify(H.tintRGB('#ff0000')) === JSON.stringify([1, 0, 0]) &&
  JSON.stringify(H.tintRGB('#0f0')) === JSON.stringify([0, 1, 0]) &&
  JSON.stringify(H.tintRGB('junk')) === JSON.stringify([1, 1, 1]) &&
  JSON.stringify(H.tintRGB(null)) === JSON.stringify([1, 1, 1]));
check('shadeRGB returns an rgb() string and never NaN',
  /^rgb\(\d+,\d+,\d+\)$/.test(H.shadeRGB(1, 0, 0, 1)) &&
  /^rgb\(\d+,\d+,\d+\)$/.test(H.shadeRGB(NaN, undefined, 'x', -5)));

function redTriMesh() {
  return {
    verts: [[-10, -10, -10], [10, -10, -10], [10, 10, -10], [-10, 10, -10]],
    tris: [[0, 1, 2], [0, 2, 3]],
    colors: [[1, 0, 0], [1, 0, 0]],
    cacheKey: 'red-quad'
  };
}
function trackingCtx() {
  const g = stubCtx();
  const fills = [];
  Object.defineProperty(g, 'fillStyle', { set(v) { fills.push(v); }, get() { return ''; } });
  g.fills = fills;
  return g;
}
check('renderScene draws a model3d through the resolveModel hook',
  (() => { const g = stubCtx();
    H.renderScene(g, { worldWidth: 800, worldHeight: 600, camera3d: null },
      [{ kind: 'model3d', posX: 340, posY: 240, z: 0, width: 120, height: 120, depth: 120, color: '#94a3b8', materialColor: '#ffffff' }],
      800, 600, () => redTriMesh());
    return g.calls.filter(c => c[0] === 'fill').length === 2; })());
check('renderScene tints model triangles by materialColor',
  (() => { const g = trackingCtx();
    H.renderScene(g, { worldWidth: 800, worldHeight: 600, camera3d: null },
      [{ kind: 'model3d', posX: 340, posY: 240, z: 0, width: 120, height: 120, depth: 120, materialColor: '#0000ff' }],
      800, 600, () => redTriMesh());
    // red triangles x blue tint -> blue channel dominates
    return g.fills.length === 2 && g.fills.every(f => /^rgb\(0,0,/.test(f));
  })(), 'tint did not apply');
check('renderScene draws a placeholder box when the model hook returns null',
  (() => { const g = stubCtx();
    H.renderScene(g, { worldWidth: 800, worldHeight: 600, camera3d: null },
      [{ kind: 'model3d', posX: 340, posY: 240, z: 0, width: 120, height: 120, depth: 120, color: '#94a3b8' }],
      800, 600, () => null);
    return g.calls.filter(c => c[0] === 'fill').length === 12; })());
check('renderScene model3d with no hook at all still draws the placeholder',
  (() => { const g = stubCtx();
    H.renderScene(g, { worldWidth: 800, worldHeight: 600, camera3d: null },
      [{ kind: 'model3d', posX: 340, posY: 240, z: 0, width: 120, height: 120, depth: 120 }],
      800, 600);
    return g.calls.filter(c => c[0] === 'fill').length === 12; })());
check('renderScene survives a throwing model hook and hostile meshes',
  (() => { const g = stubCtx();
    H.renderScene(g, { worldWidth: 800, worldHeight: 600, camera3d: null }, [
      { kind: 'model3d', posX: 340, posY: 240, z: 0, width: 120, height: 120, depth: 120 }
    ], 800, 600, () => { throw new Error('boom'); });
    const g2 = stubCtx();
    H.renderScene(g2, { worldWidth: 800, worldHeight: 600, camera3d: null }, [
      { kind: 'model3d', posX: 340, posY: 240, z: 0, width: 120, height: 120, depth: 120 }
    ], 800, 600, () => ({ verts: [], tris: 'junk' }));
    return g.calls.filter(c => c[0] === 'fill').length === 12 &&
      g2.calls.filter(c => c[0] === 'fill').length === 12; })());
check('setModelTint writes materialColor on targets',
  (() => { let got = null;
    const h = hooks({ targets: () => { got = { kind: 'model3d', materialColor: '#ffffff' }; return [got]; } });
    H.apply3dAction({ type: 'setModelTint', color: '#ff0000' }, h);
    return got.materialColor === '#ff0000'; })());
check('setModelTint warns and skips on a bad color',
  (() => { hooks.warnings = [];
    let got = null;
    const h = hooks({ targets: () => { got = { materialColor: '#ffffff' }; return [got]; } });
    H.apply3dAction({ type: 'setModelTint', color: 'not-a-color' }, h);
    return got.materialColor === '#ffffff' && hooks.warnings.length === 1; })());

check('useModelTexture switches the texture flag on targets',
  (() => { let got = null;
    const h = hooks({ targets: () => { got = { kind: 'model3d', useTexture: true }; return [got]; } });
    H.apply3dAction({ type: 'useModelTexture', mode: 'off' }, h);
    const offOk = got.useTexture === false;
    H.apply3dAction({ type: 'useModelTexture', mode: 'on' }, h);
    return offOk && got.useTexture === true; })());
check('useModelTexture warns and skips on a bad mode',
  (() => { hooks.warnings = [];
    let got = null;
    const h = hooks({ targets: () => { got = { useTexture: true }; return [got]; } });
    H.apply3dAction({ type: 'useModelTexture', mode: 'blurry' }, h);
    return got.useTexture === true && hooks.warnings.length === 1; })());

// ---------- texture mapping (3D2 batch 2) ----------
// A stub context that also records the texture-path calls (drawImage,
// transform, clip, globalAlpha).
function texCtx() {
  const base = stubCtx();
  base.clip = function () { base.calls.push(['clip']); };
  base.transform = function (a, b, c, d, e, f) { base.calls.push(['transform', a, b, c, d, e, f]); };
  base.drawImage = function (img, x, y) { base.calls.push(['drawImage', img, x, y]); };
  let alpha = 1;
  Object.defineProperty(base, 'globalAlpha', {
    get() { return alpha; }, set(v) { alpha = v; base.calls.push(['globalAlpha', v]); }
  });
  return base;
}
// One-triangle textured model mesh (a flat quad facing the camera).
function texMesh(img, uv, texIdx) {
  return {
    verts: [[-50, -50, 0], [50, -50, 0], [50, 50, 0]],
    tris: [[0, 1, 2]],
    colors: [[1, 1, 1]],
    uvs: [uv || [[0, 0], [1, 0], [1, 1]]],
    tex: [texIdx == null ? 0 : texIdx],
    texImages: img ? { 0: img } : {},
    cacheKey: 'tex-test'
  };
}
function texObj(mesh) {
  return { kind: 'model3d', posX: 350, posY: 250, z: 200, width: 100, height: 100, depth: 100,
    color: '#ff0000', materialColor: '#ffffff', useTexture: true };
}
const FAKE_IMG = { width: 4, height: 4 };
check('renderScene paints textured triangles with drawImage',
  (() => { const g = texCtx();
    const mesh = texMesh(FAKE_IMG);
    H.renderScene(g, { worldWidth: 800, worldHeight: 600, camera3d: null },
      [texObj(mesh)], 800, 600, () => mesh);
    return g.calls.filter(c => c[0] === 'drawImage').length === 1 &&
      g.calls.filter(c => c[0] === 'transform').length === 1; })());
check('renderScene skips textures when useTexture is false (flat colors)',
  (() => { const g = texCtx();
    const mesh = texMesh(FAKE_IMG);
    const obj = texObj(mesh); obj.useTexture = false;
    H.renderScene(g, { worldWidth: 800, worldHeight: 600, camera3d: null },
      [obj], 800, 600, () => mesh);
    return g.calls.filter(c => c[0] === 'drawImage').length === 0 &&
      g.calls.filter(c => c[0] === 'fill').length === 1; })());
check('renderScene falls back to flat colors when the image is missing',
  (() => { const g = texCtx();
    const mesh = texMesh(null); // tex index 0, but no decoded image
    H.renderScene(g, { worldWidth: 800, worldHeight: 600, camera3d: null },
      [texObj(mesh)], 800, 600, () => mesh);
    return g.calls.filter(c => c[0] === 'drawImage').length === 0 &&
      g.calls.filter(c => c[0] === 'fill').length === 1; })());
check('renderScene falls back to flat colors on degenerate UVs',
  (() => { const g = texCtx();
    const mesh = texMesh(FAKE_IMG, [[0.5, 0.5], [0.5, 0.5], [0.5, 0.5]]);
    H.renderScene(g, { worldWidth: 800, worldHeight: 600, camera3d: null },
      [texObj(mesh)], 800, 600, () => mesh);
    return g.calls.filter(c => c[0] === 'drawImage').length === 0 &&
      g.calls.filter(c => c[0] === 'fill').length === 1; })());
check('renderScene falls back to flat colors when the image is undecoded',
  (() => { const g = texCtx();
    const mesh = texMesh({ width: 0, height: 0 });
    H.renderScene(g, { worldWidth: 800, worldHeight: 600, camera3d: null },
      [texObj(mesh)], 800, 600, () => mesh);
    return g.calls.filter(c => c[0] === 'drawImage').length === 0; })());
check('renderScene textures only the textured triangle in a mixed mesh',
  (() => { const g = texCtx();
    const mesh = {
      verts: [[-50, -50, 0], [50, -50, 0], [50, 50, 0], [-50, 50, 0]],
      tris: [[0, 1, 2], [0, 2, 3]],
      colors: [[1, 1, 1], [1, 1, 1]],
      uvs: [[[0, 0], [1, 0], [1, 1]], null],
      tex: [0, -1],
      texImages: { 0: FAKE_IMG },
      cacheKey: 'mixed-tex'
    };
    H.renderScene(g, { worldWidth: 800, worldHeight: 600, camera3d: null },
      [texObj(mesh)], 800, 600, () => mesh);
    return g.calls.filter(c => c[0] === 'drawImage').length === 1 &&
      // 2 fills: the lighting wash on the textured triangle + the flat
      // fill on the untextured one
      g.calls.filter(c => c[0] === 'fill').length === 2; })());
check('renderScene texture path never throws on hostile meshes',
  (() => { const g = texCtx();
    H.renderScene(g, { worldWidth: 800, worldHeight: 600, camera3d: null },
      [{ kind: 'model3d', posX: 350, posY: 250, z: 200, width: 100, height: 100, depth: 100 }],
      800, 600, () => ({ verts: [], tris: [[0, 0, 0]], colors: [], uvs: ['junk'], tex: [0], texImages: { 0: null } }));
    return true; })());

// ---------- 3D3: character-controller primitives ----------
// yawPitchLookAt: yaw 0 = into the screen (-Z), positive yaw turns right
// (+X); pitch 0 = level, positive pitch looks down (+Y, screen-down).
check('yawPitchLookAt: yaw 0 faces into the screen',
  (() => { const l = H.yawPitchLookAt([0, 0, 900], 0, 0, 500);
    return Math.abs(l[0]) < 1e-9 && Math.abs(l[1]) < 1e-9 && Math.abs(l[2] - 400) < 1e-9; })());
check('yawPitchLookAt: yaw 90 faces right, pitch 90 looks down',
  (() => { const r = H.yawPitchLookAt([0, 0, 900], 90, 0, 500);
    const d = H.yawPitchLookAt([0, 0, 900], 0, 90, 500);
    return Math.abs(r[0] - 500) < 1e-9 && Math.abs(r[2] - 900) < 1e-9 &&
           Math.abs(d[1] - 500) < 1e-9 && Math.abs(d[2] - 900) < 1e-9; })());
check('yawPitchLookAt: non-positive distance falls back to 500, hostile safe',
  (() => { const l = H.yawPitchLookAt([1, 2, 3], 0, 0, 0);
    const h = H.yawPitchLookAt(null, 'junk', NaN, -5);
    return Math.abs(l[2] + 497) < 1e-9 && h.every(v => Number.isFinite(v)); })());
// facingDelta: forward = (sin yaw, -cos yaw) in XZ, right = (cos, sin).
check('facingDelta: yaw 0 forward steps into the screen',
  (() => { const d = H.facingDelta(4, 0, 0);
    return Math.abs(d[0]) < 1e-9 && Math.abs(d[1] + 4) < 1e-9; })());
check('facingDelta: yaw 90 forward steps right, strafe steps toward viewer',
  (() => { const f = H.facingDelta(4, 0, 90), s = H.facingDelta(0, 4, 90);
    return Math.abs(f[0] - 4) < 1e-9 && Math.abs(f[1]) < 1e-9 &&
           Math.abs(s[0]) < 1e-9 && Math.abs(s[1] - 4) < 1e-9; })());
check('facingDelta: strafe at yaw 0 steps right, hostile never throws',
  (() => { const s = H.facingDelta(0, 3, 0);
    const h = H.facingDelta('junk', null, undefined);
    return Math.abs(s[0] - 3) < 1e-9 && Math.abs(s[1]) < 1e-9 &&
           h.every(v => Number.isFinite(v)); })());

check('aim3dCamera re-aims the look-at from yaw/pitch',
  (() => { const cam = { x: 100, y: 200, z: 900, tx: 0, ty: 0, tz: 0, fov: 60 };
    const h = hooks({ camera3d: () => cam });
    H.apply3dAction({ type: 'aim3dCamera', yaw: 90, pitch: 0, dist: 500 }, h);
    return cam.x === 100 && cam.y === 200 && cam.z === 900 &&
           Math.abs(cam.tx - 600) < 1e-9 && Math.abs(cam.ty - 200) < 1e-9 &&
           Math.abs(cam.tz - 900) < 1e-9; })());
check('aim3dCamera never ends a follow (the FPS composition)',
  (() => { const cam = { x: 0, y: 0, z: 900, tx: 0, ty: 0, tz: 0, fov: 60 };
    let followCalls = 0;
    const h = hooks({ camera3d: () => cam, setFollow3d: () => { followCalls++; } });
    H.apply3dAction({ type: 'aim3dCamera', yaw: 0, pitch: 0, dist: 500 }, h);
    return followCalls === 0 && Math.abs(cam.tz - 400) < 1e-9; })());
check('aim3dCamera bad yaw warns and holds the camera',
  (() => { hooks.warnings = [];
    const cam = { x: 0, y: 0, z: 900, tx: 1, ty: 2, tz: 3, fov: 60 };
    H.apply3dAction({ type: 'aim3dCamera', yaw: 'junk', pitch: 0, dist: 500 }, hooks({ camera3d: () => cam }));
    return cam.tx === 1 && cam.tz === 3 && hooks.warnings.length === 1; })());
check('move3dFacing steps along the yaw heading',
  (() => { let got = null;
    const h = hooks({ targets: () => { got = { posX: 100, posY: 50, z: 10, width: 80, height: 60 }; return [got]; } });
    H.apply3dAction({ type: 'move3dFacing', forward: 4, strafe: 2, yaw: 90 }, h);
    return Math.abs(got.posX - 104) < 1e-9 && got.posY === 50 && Math.abs(got.z - 12) < 1e-9; })());
check('move3dFacing bad forward warns and holds position',
  (() => { hooks.warnings = [];
    let got = null;
    const h = hooks({ targets: () => { got = { posX: 1, posY: 2, z: 3, width: 80, height: 60 }; return [got]; } });
    H.apply3dAction({ type: 'move3dFacing', forward: 'junk', strafe: 0, yaw: 0 }, h);
    return got.posX === 1 && got.z === 3 && hooks.warnings.length === 1; })());

check('captureMouse success is silent, failure warns with the click fix',
  (() => { hooks.warnings = [];
    H.apply3dAction({ type: 'captureMouse' }, hooks({ captureMouse: () => true }));
    const silent = hooks.warnings.length === 0;
    hooks.warnings = [];
    H.apply3dAction({ type: 'captureMouse' }, hooks({ captureMouse: () => false }));
    const warned = hooks.warnings.length === 1 && /click/i.test(hooks.warnings[0]);
    hooks.warnings = [];
    H.apply3dAction({ type: 'captureMouse' }, hooks({ captureMouse: () => { throw new Error('denied'); } }));
    return silent && warned && hooks.warnings.length === 1; })());
check('releaseMouse calls the host hook, never throws',
  (() => { let released = 0;
    H.apply3dAction({ type: 'releaseMouse' }, hooks({ releaseMouse: () => { released++; } }));
    H.apply3dAction({ type: 'releaseMouse' }, hooks({ releaseMouse: () => { throw new Error('x'); } }));
    H.apply3dAction({ type: 'releaseMouse' }, hooks());
    return released === 1; })());
check('readMouseDelta writes both variables through setVar',
  (() => { const vars = {};
    const h = hooks({ readMouseDelta: () => ({ x: 12, y: -7 }), setVar: (n, v) => { vars[n] = v; } });
    H.apply3dAction({ type: 'readMouseDelta', dxVar: 'mdx', dyVar: 'mdy' }, h);
    return vars.mdx === 12 && vars.mdy === -7; })());
check('readMouseDelta blank names warn and skip, missing hooks never throw',
  (() => { hooks.warnings = [];
    H.apply3dAction({ type: 'readMouseDelta', dxVar: '  ', dyVar: '' }, hooks());
    const warned = hooks.warnings.length === 1;
    H.apply3dAction({ type: 'readMouseDelta', dxVar: 'mdx', dyVar: 'mdy' }, hooks());
    H.apply3dAction({ type: 'readMouseDelta' }, null);
    return warned; })());
check('mousePointerCaptured passes only while the host is locked',
  (() => { const on = H.eval3dCondition({ type: 'mousePointerCaptured' }, hooks({ pointerLocked: () => true }));
    const off = H.eval3dCondition({ type: 'mousePointerCaptured' }, hooks({ pointerLocked: () => false }));
    const hostile = H.eval3dCondition({ type: 'mousePointerCaptured' }, hooks({ pointerLocked: () => { throw new Error('x'); } }));
    const noHook = H.eval3dCondition({ type: 'mousePointerCaptured' }, hooks());
    return on.pass === true && off.pass === false && hostile.pass === false && noHook.pass === false; })());

// ---------- P4 item 3D4: 3D physics ----------
function phys3dHooks(extra) {
  return Object.assign({
    num: (raw) => {
      const v = Number(String(raw == null ? '' : raw).trim());
      return { value: v, ok: Number.isFinite(v) };
    },
    warn: (msg) => { (hooks.warnings = hooks.warnings || []).push(msg); },
    targets: () => [],
    objectsByName: (name) => [],
    paused: () => false
  }, extra || {});
}
function box3d(extra) {
  return Object.assign({
    posX: 0, posY: 0, z: 0, width: 40, height: 40, depth: 40,
    physicsEnabled: true, static: false, physics: { gravity: 0, friction: 1, maxSpeed: 100 },
    vel3x: 0, vel3y: 0, vel3z: 0
  }, extra || {});
}

check('normalizePhysics3d defaults box/solid, repairs hostile',
  (() => { const a = H.normalizePhysics3d({});
    const b = H.normalizePhysics3d({ physics3d: { shape: 'sphere', solid: false } });
    const c = H.normalizePhysics3d({ physics3d: { shape: 'banana', solid: 'yes' } });
    return a.physics3d.shape === 'box' && a.physics3d.solid === true &&
      b.physics3d.shape === 'sphere' && b.physics3d.solid === false &&
      c.physics3d.shape === 'box' && c.physics3d.solid === true &&
      H.normalizePhysics3d(null) === null; })());
check('normalizeObject3d now includes the 3D collider record',
  (() => { const o = H.normalizeObject3d({ kind: 'box3d' });
    return o.physics3d && o.physics3d.shape === 'box' && o.physics3d.solid === true; })());
check('collider3dOf box extents and sphere radius',
  (() => { const b = H.collider3dOf(box3d({ posX: 100, posY: 100, z: 10, width: 60, height: 40, depth: 20 }));
    const s = H.collider3dOf(box3d({ physics3d: { shape: 'sphere', solid: true }, width: 60, height: 40, depth: 20 }));
    return b.shape === 'box' && b.cx === 130 && b.cy === 120 && b.cz === 10 &&
      b.hx === 30 && b.hy === 20 && b.hz === 10 &&
      s.shape === 'sphere' && s.r === 10; })());
check('pairOverlap3d box/box picks the minimum-penetration axis',
  (() => { const a = box3d({ posX: 0, posY: 0, z: 0 });
    const b = box3d({ posX: 35, posY: 0, z: 0 }); // 5px overlap on X
    const miss = box3d({ posX: 100, posY: 0, z: 0 });
    const top = box3d({ posX: 0, posY: -35, z: 0 }); // b above a: normal points down (+y)
    const ov = H.pairOverlap3d(a, b);
    const ot = H.pairOverlap3d(a, top);
    return ov && ov.nx === -1 && ov.ny === 0 && ov.nz === 0 && ov.depth === 5 &&
      H.pairOverlap3d(a, miss) === null &&
      ot && ot.ny === 1 && ot.depth === 5 &&
      H.pairOverlap3d(a, a) === null; })());
check('pairOverlap3d sphere/sphere and box/sphere',
  (() => { const s1 = box3d({ posX: 0, posY: 0, z: 0, physics3d: { shape: 'sphere', solid: true } });
    const s2 = box3d({ posX: 30, posY: 0, z: 0, physics3d: { shape: 'sphere', solid: true } });
    const b = box3d({ posX: 30, posY: 0, z: 0 });
    const far = box3d({ posX: 300, posY: 0, z: 0, physics3d: { shape: 'sphere', solid: true } });
    const ss = H.pairOverlap3d(s1, s2); // r 20 + 20, centers 30 apart -> depth 10
    const bs = H.pairOverlap3d(s1, b);
    const sb = H.pairOverlap3d(b, s1); // flipped normal
    return ss && Math.abs(ss.depth - 10) < 1e-9 && ss.nx === -1 &&
      bs && bs.nx === -1 && bs.depth > 0 &&
      sb && sb.nx === 1 && Math.abs(sb.depth - bs.depth) < 1e-9 &&
      H.pairOverlap3d(s1, far) === null &&
      H.pairOverlap3d(null, b) === null && H.pairOverlap3d('x', b) === null; })());
check('updatePhysics3d integrates gravity, friction, and maxSpeed',
  (() => { const o = box3d({ physics: { gravity: 2, friction: 1, maxSpeed: 100 } });
    H.updatePhysics3d([o], 1, (x) => x.physics);
    const after1 = o.vel3y === 2 && o.posY === 2;
    o.physics.friction = 0.5;
    H.updatePhysics3d([o], 1, (x) => x.physics); // v=(2+2)*0.5=2, y=4
    const after2 = o.vel3y === 2 && o.posY === 4;
    o.physics = { gravity: 0, friction: 1, maxSpeed: 1 };
    o.vel3x = 50;
    H.updatePhysics3d([o], 1, (x) => x.physics);
    return after1 && after2 && o.vel3x === 1 && o.posX === 1; })());
check('updatePhysics3d lands a falling box on a solid floor',
  (() => { const floor = box3d({ posX: 0, posY: 200, width: 400, height: 40, static: true, physicsEnabled: false });
    const hero = box3d({ posX: 180, posY: 100, physics: { gravity: 2, friction: 1, maxSpeed: 100 } });
    for (let f = 0; f < 15; f++) H.updatePhysics3d([hero, floor], 1, (x) => x.physics);
    return hero._onGround3d === true && hero.vel3y === 0 && hero.posY === 160 &&
      hero.posY + hero.height === floor.posY; })());
check('updatePhysics3d lands a sphere on a floor and pushes a box off a wall',
  (() => { const floor = box3d({ posX: 0, posY: 200, width: 400, height: 40, static: true, physicsEnabled: false });
    const ball = box3d({ posX: 180, posY: 100, physics3d: { shape: 'sphere', solid: true },
      physics: { gravity: 2, friction: 1, maxSpeed: 100 } });
    for (let f = 0; f < 15; f++) H.updatePhysics3d([ball, floor], 1, (x) => x.physics);
    const ballLanded = ball._onGround3d === true && ball.vel3y === 0 && ball.posY + ball.height === floor.posY;
    const wall = box3d({ posX: 300, posY: 0, width: 40, height: 400, static: true, physicsEnabled: false });
    const runner = box3d({ posX: 200, posY: 50, vel3x: 10, physics: { gravity: 0, friction: 1, maxSpeed: 100 } });
    for (let f = 0; f < 10; f++) H.updatePhysics3d([runner, wall], 1, (x) => x.physics);
    const pushed = runner.vel3x === 0 && runner.posX + runner.width === wall.posX;
    return ballLanded && pushed; })());
check('updatePhysics3d non-solid walls and ghosts pass through; dynamics ignore each other',
  (() => { const ghost = box3d({ posX: 0, posY: 200, width: 400, height: 40, static: true, physicsEnabled: false,
      physics3d: { shape: 'box', solid: false } });
    const hero = box3d({ posX: 180, posY: 100, physics: { gravity: 2, friction: 1, maxSpeed: 100 } });
    for (let f = 0; f < 10; f++) H.updatePhysics3d([hero, ghost], 1, (x) => x.physics);
    const fellThrough = hero._onGround3d !== true && hero.posY > 200;
    const a = box3d({ posX: 0, posY: 0, physics: { gravity: 0, friction: 1, maxSpeed: 100 } });
    const b = box3d({ posX: 10, posY: 0, physics: { gravity: 0, friction: 1, maxSpeed: 100 } });
    H.updatePhysics3d([a, b], 1, (x) => x.physics);
    return fellThrough && a.posX === 0 && b.posX === 10; })());
check('updatePhysics3d never throws on hostile input',
  (() => { H.updatePhysics3d(null, 1, () => ({}));
    H.updatePhysics3d([], 0, () => ({}));
    H.updatePhysics3d([null, 'x', 42], NaN, null);
    H.updatePhysics3d([{ posX: 'junk' }], 1, () => 'junk');
    return true; })());
check('set3dGravity writes the shared gravity field and enables physics; bad expr warns and holds',
  (() => { hooks.warnings = [];
    const o = box3d({ physicsEnabled: false, physics: { gravity: 0, friction: 1, maxSpeed: 100 } });
    H.apply3dAction({ type: 'set3dGravity', gravity: 0.8 },
      phys3dHooks({ targets: () => [o] }));
    const wrote = o.physics.gravity === 0.8 && o.physicsEnabled === true;
    H.apply3dAction({ type: 'set3dGravity', gravity: 'junk' },
      phys3dHooks({ targets: () => [o] }));
    return wrote && o.physics.gravity === 0.8 && hooks.warnings.length === 1; })());
check('set3dVelocity writes vel3x/vel3y/vel3z; bad expr warns and holds',
  (() => { hooks.warnings = [];
    const o = box3d();
    H.apply3dAction({ type: 'set3dVelocity', vx: 3, vy: -6, vz: 1.5 },
      phys3dHooks({ targets: () => [o] }));
    const wrote = o.vel3x === 3 && o.vel3y === -6 && o.vel3z === 1.5;
    H.apply3dAction({ type: 'set3dVelocity', vx: 'junk', vy: 0, vz: 0 },
      phys3dHooks({ targets: () => [o] }));
    return wrote && o.vel3x === 3 && hooks.warnings.length === 1; })());
check('onGround3d fires only for grounded objects, quiet on blank names, reports the paused freeze',
  (() => { const grounded = box3d(); grounded._onGround3d = true;
    const air = box3d();
    const byName = { hero: [grounded], bird: [air] };
    const fire = H.eval3dCondition({ type: 'onGround3d', targetObject: 'hero' },
      phys3dHooks({ objectsByName: (n) => byName[n] || [] }));
    const quiet = H.eval3dCondition({ type: 'onGround3d', targetObject: 'bird' },
      phys3dHooks({ objectsByName: (n) => byName[n] || [] }));
    const blank = H.eval3dCondition({ type: 'onGround3d', targetObject: '  ' }, phys3dHooks());
    const frozen = H.eval3dCondition({ type: 'onGround3d', targetObject: 'hero' },
      phys3dHooks({ objectsByName: (n) => byName[n] || [], paused: () => true }));
    return fire.pass === true && fire.context.obj1 === grounded &&
      quiet.pass === false && blank.pass === false && frozen.pass === false; })());
check('collision3d fires on collider overlap, quiet on miss, skips self-pairs, reports the paused freeze',
  (() => { const a = box3d({ posX: 0, posY: 0 });
    const b = box3d({ posX: 30, posY: 0 });
    const far = box3d({ posX: 500, posY: 0 });
    const byName = { a: [a], b: [b], far: [far] };
    const fire = H.eval3dCondition({ type: 'collision3d', object1: 'a', object2: 'b' },
      phys3dHooks({ objectsByName: (n) => byName[n] || [] }));
    const miss = H.eval3dCondition({ type: 'collision3d', object1: 'a', object2: 'far' },
      phys3dHooks({ objectsByName: (n) => byName[n] || [] }));
    const self = H.eval3dCondition({ type: 'collision3d', object1: 'a', object2: 'a' },
      phys3dHooks({ objectsByName: (n) => byName[n] || [] }));
    const blank = H.eval3dCondition({ type: 'collision3d', object1: 'a', object2: '' }, phys3dHooks());
    const frozen = H.eval3dCondition({ type: 'collision3d', object1: 'a', object2: 'b' },
      phys3dHooks({ objectsByName: (n) => byName[n] || [], paused: () => true }));
    const throwing = H.eval3dCondition({ type: 'collision3d', object1: 'a', object2: 'b' },
      phys3dHooks({ objectsByName: () => { throw new Error('x'); } }));
    return fire.pass === true && fire.context.obj1 === a && fire.context.obj2 === b &&
      miss.pass === false && self.pass === false && blank.pass === false &&
      frozen.pass === false && throwing.pass === false; })());


// ---------- P4 item 3D5: 3D lighting ----------
// Recording stub context: captures fillStyle writes and ellipse calls so
// the lighting + shadow passes can be asserted without a real canvas.
function recCtx() {
  const ctx = {
    fills: [], ellipses: [], composites: [],
    save() {}, restore() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, fill() {}, stroke() {},
    clearRect() {}, fillRect() {}, clip() {}, transform() {}, drawImage() {},
    ellipse(x, y, rx, ry) { ctx.ellipses.push([x, y, rx, ry]); }
  };
  Object.defineProperty(ctx, 'fillStyle', { set(v) { ctx.fills.push(v); }, get() { return ''; } });
  Object.defineProperty(ctx, 'strokeStyle', { set(v) {}, get() { return ''; } });
  Object.defineProperty(ctx, 'lineWidth', { set(v) {}, get() { return 1; } });
  Object.defineProperty(ctx, 'globalCompositeOperation',
    { set(v) { ctx.composites.push(v); }, get() { return 'source-over'; } });
  return ctx;
}
function lightObj(extra) {
  return Object.assign({
    kind: 'light3d', posX: 0, posY: 0, z: 0, width: 54, height: 54,
    rotX: 0, rotY: 0, rotZ: 0,
    light: { type: 'point', color: '#ffffff', intensity: 1, range: 600, enabled: true }
  }, extra || {});
}

check('isLight3d identifies the light kind only',
  H.isLight3d('light3d') === true && H.isLight3d('box3d') === false &&
  H.isLight3d('sprite') === false && H.isLight3d(null) === false &&
  H.is3dKind('light3d') === false);
check('normalizeLight3d defaults and repairs',
  (() => { const a = H.normalizeLight3d({});
    const b = H.normalizeLight3d({ light: { type: 'ambient', color: '#123abc', intensity: 2.5, range: 100, enabled: false } });
    const c = H.normalizeLight3d({ light: { type: 'BANANA', color: 'red', intensity: 'x', range: -5, enabled: 'yes' } });
    return a.light.type === 'point' && a.light.color === '#ffffff' && a.light.intensity === 1 &&
      a.light.range === 600 && a.light.enabled === true &&
      b.light.type === 'ambient' && b.light.color === '#123abc' && b.light.intensity === 2.5 &&
      b.light.range === 100 && b.light.enabled === false &&
      c.light.type === 'point' && c.light.color === '#ffffff' && c.light.intensity === 1 &&
      c.light.range === 600 && c.light.enabled === true &&
      H.normalizeLight3d(null) === null; })());
check('normalizeObject3d normalizes light fields for light3d objects',
  (() => { const o = H.normalizeObject3d({ kind: 'light3d' });
    return o.light && o.light.type === 'point' && o.z === 0; })());
check('migrateLegacyLight3d promotes old sprite placeholders',
  (() => { const o = H.migrateLegacyLight3d({ kind: 'sprite', archetype: 'light3d',
      components: [{ type: 'Light', props: { lightType: 'ambient', color: '#ff0000', intensity: 2 } }] });
    const plain = H.migrateLegacyLight3d({ kind: 'sprite', archetype: 'light3d' });
    const untouched = H.migrateLegacyLight3d({ kind: 'sprite', archetype: 'empty' });
    const badType = H.migrateLegacyLight3d({ kind: 'sprite', archetype: 'light3d',
      components: [{ type: 'Light', props: { lightType: 'laser' } }] });
    return o.kind === 'light3d' && o.light.type === 'ambient' && o.light.color === '#ff0000' &&
      o.light.intensity === 2 && o.light.range === 600 && o.light.enabled === true &&
      plain.kind === 'light3d' && plain.light.type === 'directional' &&
      untouched.kind === 'sprite' && !untouched.light &&
      badType.light.type === 'directional' &&
      H.migrateLegacyLight3d(null) === null; })());
check('collectLights3d gathers enabled lights, skips the disabled and non-lights',
  (() => { const lights = H.collectLights3d([
      lightObj(), lightObj({ light: { type: 'ambient', enabled: false } }),
      { kind: 'box3d' }, null, 'junk']);
    return lights.length === 1 && lights[0].type === 'point' &&
      lights[0].color[0] === 1 && lights[0].intensity === 1; })());
check('collectLights3d aims directional lights with Rot X / Rot Y, defaulting to the key light',
  (() => { const def = H.collectLights3d([lightObj({ light: { type: 'directional' } })])[0];
    // Default direction matches the legacy fixed key light (-0.45,-0.75,0.55) normalized.
    const dotSelf = def.dir[0] * -0.45 + def.dir[1] * -0.75 + def.dir[2] * 0.55;
    const aimed = H.collectLights3d([lightObj({ light: { type: 'directional' }, rotX: 90, rotY: 0 })])[0];
    return dotSelf > 0.999 &&
      Math.abs(aimed.dir[0] - def.dir[0]) + Math.abs(aimed.dir[1] - def.dir[1]) + Math.abs(aimed.dir[2] - def.dir[2]) > 0.1; })());
check('computeLightRGB: no ambient light keeps the dim 0.25 base',
  (() => { const v = H.computeLightRGB([0, -1, 0], [0, 0, 0], []);
    return v[0] === 0.25 && v[1] === 0.25 && v[2] === 0.25; })());
check('computeLightRGB: an ambient light replaces the base',
  (() => { const lights = H.collectLights3d([lightObj({ light: { type: 'ambient', color: '#ff0000', intensity: 0.5 } })]);
    const v = H.computeLightRGB([0, -1, 0], [0, 0, 0], lights);
    return v[0] === 0.5 && v[1] === 0 && v[2] === 0; })());
check('computeLightRGB: directional light follows N.L, dark on back faces',
  (() => { const lights = H.collectLights3d([lightObj({ light: { type: 'directional', color: '#ffffff', intensity: 0.5 } })]);
    const keyDir = H.vnorm([-0.45, -0.75, 0.55]); // the default key-light direction
    const facing = H.computeLightRGB(keyDir, [0, 0, 0], lights);
    const away = H.computeLightRGB([-keyDir[0], -keyDir[1], -keyDir[2]], [0, 0, 0], lights);
    // N.L = 1 for the facing normal: 0.25 base + 0.5 = 0.75.
    return Math.abs(facing[0] - 0.75) < 1e-9 && away[0] === 0.25; })());
check('computeLightRGB: point light fades linearly to range, dark beyond it, flat at range 0',
  (() => { const near = H.collectLights3d([lightObj({ posX: -22, posY: -22, z: 200, light: { type: 'point', color: '#ffffff', intensity: 1, range: 600 } })]);
    const v = H.computeLightRGB([0, 0, 1], [5, 5, 100], near);
    // Light center (5,5,200), surface (5,5,100): dist 100, att 5/6, N.L 1 -> 0.25 + 0.8333.
    const far = H.computeLightRGB([0, 0, 1], [5, 5, -1000], near);
    const flat = H.collectLights3d([lightObj({ posX: -22, posY: -22, z: 200, light: { type: 'point', color: '#ffffff', intensity: 0.5, range: 0 } })]);
    const vf = H.computeLightRGB([0, 0, 1], [5, 5, 100], flat);
    return Math.abs(v[0] - (0.25 + 5 / 6)) < 1e-9 && far[0] === 0.25 &&
      Math.abs(vf[0] - 0.75) < 1e-9; })());
check('computeLightRGB: hostile input never throws',
  (() => { H.computeLightRGB(null, null, null);
    H.computeLightRGB('junk', 42, [{ type: 'weird' }]);
    H.computeLightRGB([0, 0, 0], [0, 0, 0], [{ type: 'point' }]);
    return true; })());
check('shadowParams3d: ellipse above the ground, null below, null for lights and non-3D',
  (() => { const above = H.shadowParams3d({ kind: 'box3d', posX: 0, posY: 0, z: 0, width: 80, height: 80, depth: 80 }, 600);
    const below = H.shadowParams3d({ kind: 'box3d', posX: 0, posY: 700, z: 0, width: 80, height: 80 }, 600);
    return above && above.cx === 40 && above.cz === 0 && above.rx === 40 && above.rz === 40 &&
      above.groundY === 600 && above.alpha > 0 && above.alpha <= 0.32 &&
      below === null &&
      H.shadowParams3d({ kind: 'light3d' }, 600) === null &&
      H.shadowParams3d({ kind: 'sprite' }, 600) === null &&
      H.shadowParams3d(null, 600) === null &&
      H.shadowParams3d({ kind: 'box3d' }, 'junk') === null; })());
check('renderScene with a red ambient light paints red, legacy path does not',
  (() => { const box = [{ kind: 'box3d', posX: 360, posY: 260, z: 0, width: 80, height: 80, depth: 80, color: '#ff0000' }];
    const scene = { worldWidth: 800, worldHeight: 600, camera3d: null };
    const g1 = recCtx();
    H.renderScene(g1, scene, box, 800, 600);
    const g2 = recCtx();
    H.renderScene(g2, scene, box.concat([lightObj({ light: { type: 'ambient', color: '#ff0000', intensity: 1 } })]), 800, 600);
    const triFills1 = g1.fills.filter(f => f.indexOf('rgb(255,0,0)') === 0);
    const triFills2 = g2.fills.filter(f => f === 'rgb(255,0,0)');
    return triFills1.length === 0 && triFills2.length === 12; })());
check('renderScene shades the camera-facing side of double-sided triangles',
  (() => { const box = [{ kind: 'box3d', posX: 360, posY: 260, z: 0, width: 80, height: 80, depth: 80, color: '#ffffff' }];
    const scene = { worldWidth: 800, worldHeight: 600, camera3d: null };
    // Point light between the box and the default camera (camera looks
    // down -z from z ~920): the winding normals of the camera-facing
    // tris point -z, so without the camera-side flip they would read
    // N.L < 0 and stay at the 0.25 base.
    const lamp = lightObj({ posX: 373, posY: 273, z: 800,
      light: { type: 'point', color: '#ffffff', intensity: 2, range: 2000 } });
    const g = recCtx();
    H.renderScene(g, scene, box.concat([lamp]), 800, 600);
    const bright = g.fills.filter(f => f === 'rgb(255,255,255)').length;
    const base = g.fills.filter(f => f === 'rgb(64,64,64)').length;
    // Front + back faces catch the light head-on (white); the four side
    // faces graze it. Zero faces may sit at the unlit 0.25 base.
    return bright === 4 && base === 0; })());
check('renderScene shadow pass draws ellipses only when enabled, safe without ellipse support',
  (() => { const box = [{ kind: 'box3d', posX: 360, posY: 100, z: 0, width: 80, height: 80, depth: 80, color: '#38bdf8' }];
    const base = { worldWidth: 800, worldHeight: 600, camera3d: null };
    const g1 = recCtx();
    H.renderScene(g1, Object.assign({ shadows3d: true, shadowGroundY: 600 }, base), box, 800, 600);
    const g2 = recCtx();
    H.renderScene(g2, base, box, 800, 600);
    const g3 = stubCtx(); // no ellipse(): the guard must keep the frame safe
    H.renderScene(g3, Object.assign({ shadows3d: true }, base), box, 800, 600);
    const low = [{ kind: 'box3d', posX: 360, posY: 700, z: 0, width: 80, height: 80, depth: 80 }];
    const g4 = recCtx();
    H.renderScene(g4, Object.assign({ shadows3d: true, shadowGroundY: 600 }, base), low, 800, 600);
    return g1.ellipses.length > 0 && g2.ellipses.length === 0 && g4.ellipses.length === 0; })());
check('set3dLight writes type/color/intensity/range/enabled onto light targets',
  (() => { const o = lightObj();
    const warns = [];
    const h = hooks({ targets: () => [o], warn: (m) => warns.push(m) });
    H.apply3dAction({ type: 'set3dLight', targetObject: 'L', lightType: 'directional', color: '#ff0000', intensity: 2, range: 300, mode: 'off' }, h);
    return o.light.type === 'directional' && o.light.color === '#ff0000' &&
      o.light.intensity === 2 && o.light.range === 300 && o.light.enabled === false &&
      warns.length === 0; })());
check('set3dLight warns and holds on bad type/color/intensity/range/mode',
  (() => { function attempt(data) {
      const o = lightObj();
      const warns = [];
      const h = hooks({ targets: () => [o], warn: (m) => warns.push(m) });
      H.apply3dAction(Object.assign({ type: 'set3dLight', targetObject: 'L', lightType: 'point', color: '#ffffff', intensity: 1, range: 600, mode: 'on' }, data), h);
      return { held: o.light.type === 'point' && o.light.color === '#ffffff' && o.light.intensity === 1 && o.light.range === 600 && o.light.enabled === true,
        warned: warns.length === 1 };
    }
    const a = attempt({ lightType: 'laser' });
    const b = attempt({ color: 'red' });
    const c = attempt({ intensity: 'junk' });
    const d = attempt({ range: -5 });
    const e = attempt({ mode: 'maybe' });
    return a.held && a.warned && b.held && b.warned && c.held && c.warned && d.held && d.warned && e.held && e.warned; })());
check('set3dLight warns when the named object is not a light, quiet on blank names',
  (() => { const notLight = { kind: 'box3d' };
    const warns = [];
    const h = hooks({ targets: () => [notLight], warn: (m) => warns.push(m) });
    H.apply3dAction({ type: 'set3dLight', targetObject: 'boxy', lightType: 'point', color: '#ffffff', intensity: 1, range: 600, mode: 'on' }, h);
    const warns2 = [];
    const h2 = hooks({ targets: () => [], warn: (m) => warns2.push(m) });
    H.apply3dAction({ type: 'set3dLight', targetObject: '', lightType: 'point', color: '#ffffff', intensity: 1, range: 600, mode: 'on' }, h2);
    return warns.length === 1 && /not a light/.test(warns[0]) && warns2.length === 0; })());
check('set3dLight hostile input never throws',
  (() => { H.apply3dAction({ type: 'set3dLight' }, hooks());
    H.apply3dAction({ type: 'set3dLight', targetObject: 'L' }, {});
    H.apply3dAction(null, hooks());
    return true; })());

if (failures > 0) { console.log(`\n${failures} FAILURES`); process.exit(1); }
else { console.log('\nAll 3d checks passed.'); }
