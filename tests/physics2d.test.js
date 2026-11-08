// Unit tests for hydra/hydra-physics2d.js — the shared physics-upgrade module.
//
// Pure logic: collision-field normalization, shape-aware overlap tests
// (box/box, circle/circle, box/circle), collision resolution (cross-from-side
// for boxes, MTV push for circles, one-way platforms), trigger contacts,
// collision layers/masks, raycasts, and circle-overlap queries. Nothing here
// touches the DOM; both runtimes delegate to it.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const sandbox = {};
sandbox.window = sandbox; // hydra-physics2d.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-physics2d.js'), 'utf8'),
  sandbox, { filename: 'hydra-physics2d.js' });
const P = sandbox.HydraPhysics2D;

check('HydraPhysics2D exposed with helpers',
  !!P && typeof P.normalizePhysics2d === 'function' && typeof P.pairOverlap === 'function' &&
  typeof P.resolvePair === 'function' && typeof P.triggerContacts === 'function' &&
  typeof P.raycast === 'function' && typeof P.overlapCircle === 'function' &&
  typeof P.canCollide === 'function');
check('factorySource is a self-contained function string',
  typeof P.factorySource === 'string' && P.factorySource.includes('hydraPhysics2dFactory'));
check('layer constants', P.LAYER_COUNT === 8 && P.ALL_MASK === 255, `${P.LAYER_COUNT}/${P.ALL_MASK}`);

// --- normalization: old projects keep classic behavior ---
{
  const o = P.normalizePhysics2d({ posX: 0 });
  check('defaults: box, solid, not one-way, layer 0, mask all',
    o.collision.shape === 'box' && o.collision.mode === 'solid' && o.collision.oneWay === false &&
    o.collision.layer === 0 && o.collision.mask === 255, JSON.stringify(o.collision));
  const bad = P.normalizePhysics2d({ collision: { shape: 'triangle', mode: 'ghost', oneWay: 'yes', layer: 99, mask: -5 } });
  check('corrupt fields repair to defaults',
    bad.collision.shape === 'box' && bad.collision.mode === 'solid' && bad.collision.oneWay === false &&
    bad.collision.layer === 7 && bad.collision.mask === 0, JSON.stringify(bad.collision));
  const kept = P.normalizePhysics2d({ collision: { shape: 'circle', mode: 'trigger', oneWay: true, layer: 3, mask: 10 } });
  check('valid fields survive normalization',
    kept.collision.shape === 'circle' && kept.collision.mode === 'trigger' && kept.collision.oneWay === true &&
    kept.collision.layer === 3 && kept.collision.mask === 10, JSON.stringify(kept.collision));
  check('normalizePhysics2d never throws on hostile input',
    P.normalizePhysics2d(null) === null && P.normalizePhysics2d('x') === 'x' && P.normalizePhysics2d(42) === 42);
}

// --- shapes ---
function box(x, y, w, h, extra) {
  return Object.assign({ posX: x, posY: y, width: w, height: h, collision: { shape: 'box', mode: 'solid', layer: 0, mask: 255 } }, extra);
}
function circ(x, y, w, h, extra) {
  return Object.assign({ posX: x, posY: y, width: w, height: h, collision: { shape: 'circle', mode: 'solid', layer: 0, mask: 255 } }, extra);
}
{
  const c = P.circleOf(box(10, 20, 40, 30));
  check('circleOf centers on hitbox, radius = min side / 2',
    c.cx === 30 && c.cy === 35 && c.r === 15, JSON.stringify(c));
  check('shapeOf honors the field', P.shapeOf(box(0, 0, 1, 1)) === 'box' && P.shapeOf(circ(0, 0, 1, 1)) === 'circle');
  check('isTrigger/isOneWay', P.isTrigger({ collision: { mode: 'trigger' } }) === true &&
    P.isTrigger({}) === false && P.isOneWay({ collision: { oneWay: true } }) === true &&
    P.isOneWay({}) === false);
}

// --- pairOverlap ---
{
  check('box/box overlap', !!P.pairOverlap(box(0, 0, 10, 10), box(5, 5, 10, 10)));
  check('box/box miss', P.pairOverlap(box(0, 0, 10, 10), box(20, 20, 10, 10)) === null);
  check('touching edges do not overlap at tol 0',
    P.pairOverlap(box(0, 0, 10, 10), box(10, 0, 10, 10), 0) === null);
  check('touching edges overlap with tolerance',
    !!P.pairOverlap(box(0, 0, 10, 10), box(11, 0, 10, 10), 2));
  const cc = P.pairOverlap(circ(0, 0, 20, 20), circ(15, 0, 20, 20));
  check('circle/circle overlap with normal pointing from B to A',
    !!cc && cc.nx < 0 && Math.abs(cc.ny) < 1e-6, JSON.stringify(cc));
  check('circle/circle miss', P.pairOverlap(circ(0, 0, 20, 20), circ(100, 0, 20, 20)) === null);
  // circle(35,35,20,20): center (45,45), 7.07px from the box corner (40,40)
  // — inside the radius 10, so they overlap; the normal points diagonally
  // out of the corner.
  const cb = P.pairOverlap(circ(35, 35, 20, 20), box(0, 0, 40, 40));
  check('circle/box corner overlap', !!cb && cb.nx > 0.5 && cb.ny > 0.5, JSON.stringify(cb));
  const cb2 = P.pairOverlap(box(0, 0, 40, 40), circ(35, 35, 20, 20));
  check('box/circle flips the normal', !!cb2 && cb2.nx < -0.5 && cb2.ny < -0.5, JSON.stringify(cb2));
  check('circle far from box misses', P.pairOverlap(circ(200, 200, 20, 20), box(0, 0, 40, 40)) === null);
  check('circle center inside box pushes out',
    !!P.pairOverlap(circ(-5, 10, 20, 20), box(0, 0, 40, 40)));
  check('pairOverlap never throws on hostile input',
    P.pairOverlap(null, box(0, 0, 1, 1)) === null && P.pairOverlap(box(0, 0, 1, 1), null) === null &&
    typeof P.pairOverlap('x', 42) === 'object'); // duck-typed, still no throw
}

// --- layers / masks ---
{
  const a = box(0, 0, 10, 10); a.collision.layer = 1; a.collision.mask = 255;
  const b = box(0, 0, 10, 10); b.collision.layer = 2; b.collision.mask = 255;
  check('default masks: everything collides', P.canCollide(a, b) === true);
  b.collision.mask = 1 << 1; // b only hits layer 1... a is layer 1 -> still true
  check('mask including the other layer passes', P.canCollide(a, b) === true);
  b.collision.mask = 1 << 2; // b only hits layer 2, a is layer 1
  check('mask excluding the other layer blocks', P.canCollide(a, b) === false);
  check('both masks must agree',
    P.canCollide(box(0, 0, 1, 1, { collision: { layer: 0, mask: 1 } }),
                 box(0, 0, 1, 1, { collision: { layer: 0, mask: 0 } })) === false);
  check('canCollide never throws', P.canCollide(null, null) === true);
}

// --- resolvePair: box/box cross-from-side (engine semantics preserved) ---
{
  // wall at y=100..120; body 20x20 falling, previous bottom exactly at wall top
  const wall = box(0, 100, 200, 20, { static: true });
  const dyn = box(50, 105, 20, 20);
  const r = P.resolvePair(dyn, wall, { x: 50, y: 105, w: 20, h: 20, velX: 0, velY: 5, prevX: 50, prevY: 80 });
  check('box lands from top', r.collided && r.y === 80 && r.velY === 0 && r.landed && !r.hitHead,
    JSON.stringify(r));
  // one-way: from below passes straight through
  const ow = box(0, 100, 200, 20, { static: true, collision: { shape: 'box', mode: 'solid', oneWay: true, layer: 0, mask: 255 } });
  const dyn2 = box(50, 105, 20, 20);
  const r2 = P.resolvePair(dyn2, ow, { x: 50, y: 105, w: 20, h: 20, velX: 0, velY: -5, prevX: 50, prevY: 130 });
  check('one-way lets bodies jump up through', !r2.collided && r2.y === 0, JSON.stringify(r2));
  const dyn3 = box(50, 105, 20, 20);
  const r3 = P.resolvePair(dyn3, ow, { x: 50, y: 105, w: 20, h: 20, velX: 0, velY: 5, prevX: 50, prevY: 80 });
  check('one-way catches bodies falling from above', r3.collided && r3.landed && r3.y === 80, JSON.stringify(r3));
  // side push
  const wallS = box(100, 0, 20, 200, { static: true });
  const dyn4 = box(85, 50, 20, 20);
  const r4 = P.resolvePair(dyn4, wallS, { x: 85, y: 50, w: 20, h: 20, velX: 5, velY: 0, prevX: 70, prevY: 50 });
  check('box pushed out from the left', r4.collided && r4.x === 80 && r4.velX === 0, JSON.stringify(r4));
}

// --- resolvePair: circles ---
{
  const wall = box(0, 100, 200, 20, { static: true });
  const dyn = circ(50, 95, 24, 24); // circle center (62,107) r=12 -> overlaps wall top
  const r = P.resolvePair(dyn, wall, { x: 50, y: 95, w: 24, h: 24, velX: 0, velY: 5, prevX: 50, prevY: 90 });
  check('circle lands on a box floor', r.collided && r.landed && r.velY === 0,
    JSON.stringify(r));
  check('circle rests with its bottom on the wall top',
    Math.abs((r.y + 24) - 100) < 1e-6, `y=${r.y}`);
  const c1 = circ(0, 0, 20, 20), c2 = circ(15, 0, 20, 20, { static: true });
  const r2 = P.resolvePair(c1, c2, { x: 0, y: 0, w: 20, h: 20, velX: 3, velY: 0, prevX: -2, prevY: 0 });
  check('circle/circle pushes apart horizontally', r2.collided && Math.abs(r2.velX) === 0 && r2.x < 0,
    JSON.stringify(r2));
  check('resolvePair never throws on hostile input',
    P.resolvePair(null, null, null).collided === false &&
    P.resolvePair({}, {}, {}).collided === false);
}

// --- trigger contacts ---
{
  const zone = box(0, 0, 100, 100, { static: true, collision: { shape: 'box', mode: 'trigger', layer: 0, mask: 255 } });
  zone.id = 'zone';
  const body = box(50, 50, 20, 20); body.id = 'body';
  const far = box(500, 500, 20, 20); far.id = 'far';
  const contacts = P.triggerContacts([body, far], [zone]);
  check('trigger contact reported for the overlapping body only',
    contacts.length === 1 && contacts[0].zone === zone && contacts[0].obj === body,
    String(contacts.length));
  check('solid walls are not contacts',
    P.triggerContacts([body], [box(0, 0, 100, 100, { static: true })]).length === 0);
  check('layer gating applies to trigger contacts',
    P.triggerContacts([Object.assign(box(50, 50, 20, 20), { collision: { shape: 'box', mode: 'solid', layer: 3, mask: 255 } })],
      [Object.assign(box(0, 0, 100, 100, { static: true }), { collision: { shape: 'box', mode: 'trigger', layer: 0, mask: 1 } })]).length === 0);
  check('pairKey is stable', P.pairKey(zone, body) === P.pairKey(zone, body) &&
    P.pairKey(zone, body) !== P.pairKey(zone, far));
}

// --- raycast ---
{
  const wall = box(100, 0, 20, 200, { static: true }); wall.id = 1;
  const circWall = circ(300, 300, 40, 40, { static: true }); circWall.id = 2;
  const hit = P.raycast([wall, circWall], 0, 100, 500, 100, 255);
  check('raycast hits the closest box', !!hit && hit.object === wall && Math.abs(hit.x - 100) < 1e-6,
    JSON.stringify(hit && { x: hit.x, d: hit.distance }));
  const miss = P.raycast([wall], 0, 500, 500, 500, 255);
  check('raycast misses when nothing is in the way', miss === null);
  const chit = P.raycast([circWall], 0, 320, 500, 320, 255);
  check('raycast hits a circle collider', !!chit && chit.object === circWall, JSON.stringify(chit && chit.x));
  const layered = box(100, 0, 20, 200, { static: true, collision: { shape: 'box', mode: 'solid', layer: 4, mask: 255 } });
  layered.id = 3;
  check('raycast mask excludes other layers', P.raycast([layered], 0, 100, 500, 100, 1) === null);
  check('raycast mask includes the layer', !!P.raycast([layered], 0, 100, 500, 100, 1 << 4));
  check('raycast never throws on hostile input',
    P.raycast(null, 0, 0, 1, 1) === null && P.raycast([], NaN, 0, 1, 1) === null);
}

// --- overlapCircle ---
{
  const a = box(90, 90, 20, 20); a.id = 'a';
  const b = box(500, 500, 20, 20); b.id = 'b';
  const hits = P.overlapCircle([a, b], 100, 100, 30, 255);
  check('overlapCircle finds the nearby object only',
    hits.length === 1 && hits[0] === a, String(hits.length));
  check('overlapCircle mask filters', P.overlapCircle([a], 100, 100, 30, 0).length === 0);
  const c = circ(100, 100, 10, 10); c.id = 'c';
  check('overlapCircle sees circle colliders', P.overlapCircle([c], 200, 100, 120, 255).length === 1);
  check('overlapCircle never throws on hostile input', P.overlapCircle(null, 0, 0, 1).length === 0);
}
// --- batch 8 (physics queries): spatial-query helpers ---
{
  const bx = (x, y, w, h, vx, vy) => ({ id: `q-${x}-${y}`, posX: x, posY: y, width: w, height: h, velX: vx || 0, velY: vy || 0 });
  const a = bx(0, 0, 10, 10);       // center (5, 5)
  const right = bx(30, 0, 10, 10);  // center (35, 5)
  const down = bx(0, 30, 10, 10);   // center (5, 35)
  const up = bx(0, -30, 10, 10);    // center (5, -25)
  check('objectCenter of 10x10 at 0,0 is (5,5)',
    JSON.stringify(P.objectCenter(a)) === '{"x":5,"y":5}');
  check('objectCenter null-safe', JSON.stringify(P.objectCenter(null)) === '{"x":0.5,"y":0.5}');
  check('distanceBetweenObjects horizontal', P.distanceBetweenObjects(a, right) === 30);
  check('distanceBetweenObjects vertical', P.distanceBetweenObjects(a, down) === 30);
  check('distanceBetweenObjects bad object stays finite', Number.isFinite(P.distanceBetweenObjects(a, null)));
  check('angleBetweenObjects right is 0', P.angleBetweenObjects(a, right) === 0);
  check('angleBetweenObjects down is 90', P.angleBetweenObjects(a, down) === 90);
  check('angleBetweenObjects up is -90', P.angleBetweenObjects(a, up) === -90);
  const diag = bx(30, 30, 10, 10);
  check('angleBetweenObjects diagonal is 45', P.angleBetweenObjects(a, diag) === 45);
  check('angleBetweenObjects same center is 0', P.angleBetweenObjects(a, { posX: 0, posY: 0, width: 10, height: 10 }) === 0);
  check('angleBetweenObjects never throws', P.angleBetweenObjects(null, {}) === 0);
  const fast = bx(0, 0, 10, 10, 3, 4);
  check('speedOf 3-4-5 triangle', P.speedOf(fast) === 5);
  check('speedOf stationary is 0', P.speedOf(a) === 0);
  check('speedOf corrupt velocity is 0', P.speedOf({ velX: NaN, velY: Infinity }) === 0);
  check('movingTowards approaching target', P.movingTowards(fast, right, 1) === true);
  check('movingTowards away from target', P.movingTowards(fast, bx(-30, 0, 10, 10), 1) === false);
  check('movingTowards stationary object', P.movingTowards(a, right, 1) === false);
  check('movingTowards below min speed', P.movingTowards(fast, right, 100) === false);
  check('movingTowards min speed default', P.movingTowards(fast, right) === true);
  check('movingTowards same center is false', P.movingTowards(a, { posX: 0, posY: 0, width: 10, height: 10 }) === false);
  check('movingTowards never throws', P.movingTowards(null, null, 1) === false);
}

if (failures) { console.error(`${failures} assertion(s) failed`); process.exit(1); }
