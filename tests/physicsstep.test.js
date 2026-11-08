// Unit tests for hydra/hydra-physicsstep.js — the shared per-frame 2D
// physics step (P2 item 15/12, slice 4: the shared-engine extraction
// continues here).
//
// Pure logic: velocity integration, object-vs-object collision resolution
// (via HydraPhysics2D), and tilemap collision (via HydraTiles). Nothing
// here touches the DOM; a behavior change here changes both runtimes at
// once — which is the point of the extraction. The tests pin the body
// predicate (the two divergences this slice closes: text with collision
// enabled, and light3d), the integration math, the collision + trigger
// behavior, the tile pass, the never-throws contract, and the static
// routing that both runtimes delegate to it.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const sandbox = {};
sandbox.window = sandbox; // hydra-*.js modules assign to bare `window`
vm.createContext(sandbox);
['hydra-physicsstep.js', 'hydra-physics2d.js', 'hydra-tiles.js', 'hydra-3d.js'].forEach(m =>
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', m), 'utf8'),
    sandbox, { filename: m }));
const PS = sandbox.HydraPhysicsStep;
const P2D = sandbox.HydraPhysics2D;
const T = sandbox.HydraTiles;
const H3 = sandbox.Hydra3d;

// --- the hosts' small readers, replicated here ---
function getPhysics(obj) {
  return {
    gravity: obj.physics?.gravity ?? 0,
    friction: obj.physics?.friction ?? 0.82,
    bounciness: obj.physics?.bounciness ?? 0.4,
    maxSpeed: obj.physics?.maxSpeed ?? 25
  };
}
function hitbox(obj) {
  return {
    x: (obj.posX || 0) + (Number(obj.hitboxOffsetX) || 0),
    y: (obj.posY || 0) + (Number(obj.hitboxOffsetY) || 0),
    width: Number(obj.hitboxWidth) > 0 ? Number(obj.hitboxWidth) : (obj.width || 1),
    height: Number(obj.hitboxHeight) > 0 ? Number(obj.hitboxHeight) : (obj.height || 1)
  };
}
function isCollisionObject(obj) {
  if (!obj) return false;
  if (obj.kind === 'tilemap') return false;
  if (obj.kind === 'text' || obj.uiPinned === true) return obj.collision?.enabled === true;
  if (obj.collision && obj.collision.enabled === false) return false;
  return obj.collidable !== false;
}
function fullHooks(prevPairs) {
  return {
    getPhysics: getPhysics,
    hitbox: hitbox,
    isCollisionObject: isCollisionObject,
    is3dKind: H3.is3dKind,
    isLight3d: H3.isLight3d,
    physics2d: P2D,
    tiles: T,
    prevTriggerPairs: prevPairs || {}
  };
}
function body(over) {
  return Object.assign({
    id: 1, name: 'box', kind: 'sprite', posX: 100, posY: 150, width: 40, height: 40,
    physicsEnabled: true, physics: { gravity: 20, friction: 1, bounciness: 0, maxSpeed: 100 }
  }, over || {});
}
function floorObj(over) {
  return Object.assign({
    id: 2, name: 'floor', kind: 'sprite', posX: 0, posY: 200, width: 800, height: 20,
    static: true, physicsEnabled: false
  }, over || {});
}
// 10x6 map of 32px tiles at (0, 200); solid row at map row 4 (world y 328..360).
function tileFloorObject(over) {
  const tiles = new Array(60).fill(-1);
  for (let c = 0; c < 10; c++) tiles[4 * 10 + c] = 0;
  return Object.assign({
    id: 10, name: 'ground', kind: 'tilemap', posX: 0, posY: 200, width: 320, height: 192,
    tileSize: 32, cols: 10, rows: 6, tiles: tiles, tilesetAssetId: null, tilesetCols: 8,
    solidTiles: [0], static: true, physicsEnabled: false
  }, over || {});
}

// --- surface ---
check('HydraPhysicsStep exposed with the full step surface',
  !!PS && typeof PS.isPhysicsBody === 'function' &&
  typeof PS.isVelocityBody === 'function' &&
  typeof PS.integrateBody === 'function' &&
  typeof PS.resolveObjectCollisions === 'function' &&
  typeof PS.resolveTileCollisions === 'function' &&
  typeof PS.stepPhysics2d === 'function');
check('factorySource is a self-contained function string',
  typeof PS.factorySource === 'string' && PS.factorySource.includes('hydraPhysicsStepFactory'));
check('factorySource carries the universal-velocity predicate',
  PS.factorySource.includes('isVelocityBody'));
check('factorySource re-instantiates an independent module',
  (() => {
    const sb2 = {};
    sb2.window = sb2;
    vm.createContext(sb2);
    vm.runInContext(`window.HydraPhysicsStep=(${PS.factorySource})();`, sb2, { filename: 'hydra-physicsstep.js' });
    const P2 = sb2.HydraPhysicsStep;
    const o = body();
    return P2 !== PS && typeof P2.stepPhysics2d === 'function' &&
      P2.isPhysicsBody(o, fullHooks()) === true &&
      P2.isPhysicsBody(Object.assign({}, o, { kind: 'text' }), fullHooks()) === false;
  })());

// --- isPhysicsBody ---
{
  const h = fullHooks();
  check('isPhysicsBody: a physics-enabled sprite is a body', PS.isPhysicsBody(body(), h) === true);
  check('isPhysicsBody: text is never a body, even with collision enabled (divergence 1)',
    PS.isPhysicsBody(body({ kind: 'text', collision: { enabled: true } }), h) === false);
  check('isPhysicsBody: text without collision is not a body either',
    PS.isPhysicsBody(body({ kind: 'text' }), h) === false);
  check('isPhysicsBody: a static object is not a body',
    PS.isPhysicsBody(body({ static: true }), h) === false);
  check('isPhysicsBody: physicsEnabled false is not a body',
    PS.isPhysicsBody(body({ physicsEnabled: false }), h) === false);
  check('isPhysicsBody: a 3D kind is not a body',
    PS.isPhysicsBody(body({ kind: 'box3d' }), h) === false &&
    PS.isPhysicsBody(body({ kind: 'model3d' }), h) === false);
  check('isPhysicsBody: a light3d is not a body (divergence 2)',
    PS.isPhysicsBody(body({ kind: 'light3d' }), h) === false);
  check('isPhysicsBody: without the 3D hooks a 3D kind reads as not-3D (documented contract)',
    PS.isPhysicsBody(body({ kind: 'box3d' }), {}) === true);
  check('isPhysicsBody: null / non-object is not a body',
    PS.isPhysicsBody(null, h) === false && PS.isPhysicsBody('nope', h) === false &&
    PS.isPhysicsBody(undefined, h) === false);
  check('isPhysicsBody: a throwing is3dKind hook reads as not-a-body, no throw',
    PS.isPhysicsBody(body({ kind: 'box3d' }), {
      is3dKind: () => { throw new Error('boom-3d'); }
    }) === false);
  check('isPhysicsBody: a uiPinned sprite with physics on is still a body',
    PS.isPhysicsBody(body({ uiPinned: true }), h) === true);
}

// --- isVelocityBody (cycle 25: velocity is universal, physics is not required) ---
{
  const h = fullHooks();
  check('isVelocityBody: a plain non-physics sprite IS a velocity body',
    PS.isVelocityBody(body({ physicsEnabled: false }), h) === true);
  check('isVelocityBody: a physics-enabled sprite is a velocity body too',
    PS.isVelocityBody(body(), h) === true);
  check('isVelocityBody: text is never a velocity body, even with collision enabled',
    PS.isVelocityBody(body({ kind: 'text', collision: { enabled: true }, physicsEnabled: false }), h) === false);
  check('isVelocityBody: a static object is never a velocity body',
    PS.isVelocityBody(body({ static: true, physicsEnabled: false }), h) === false);
  check('isVelocityBody: a 3D kind is never a velocity body',
    PS.isVelocityBody(body({ kind: 'box3d', physicsEnabled: false }), h) === false);
  check('isVelocityBody: a light3d is never a velocity body',
    PS.isVelocityBody(body({ kind: 'light3d', physicsEnabled: false }), h) === false);
  check('isVelocityBody: null / non-object is not a velocity body',
    PS.isVelocityBody(null, h) === false && PS.isVelocityBody('nope', h) === false);
  check('isVelocityBody: without the 3D hooks a 3D kind reads as not-3D (documented contract)',
    PS.isVelocityBody(body({ kind: 'box3d', physicsEnabled: false }), {}) === true);
  check('isVelocityBody: a throwing is3dKind hook reads as not-a-body, no throw',
    PS.isVelocityBody(body({ kind: 'box3d', physicsEnabled: false }), {
      is3dKind: () => { throw new Error('boom-3d'); }
    }) === false);
}

// --- integrateBody ---
{
  const h = fullHooks();
  const falling = body();
  check('integrateBody: gravity accelerates and moves the body (dt 1, g 20)',
    PS.integrateBody(falling, 1, h) === true && falling.velY === 20 && falling.posY === 170,
    `velY=${falling.velY} posY=${falling.posY}`);
  check('integrateBody: _prevX/_prevY snapshot the pre-step position',
    falling._prevX === 100 && falling._prevY === 150,
    `_prevX=${falling._prevX} _prevY=${falling._prevY}`);
  const sliding = body({ physics: { gravity: 0, friction: 0.5, bounciness: 0, maxSpeed: 100 }, velX: 10, velY: 0 });
  check('integrateBody: friction decays velocity (0.5 ^ dt 1)',
    PS.integrateBody(sliding, 1, h) === true && sliding.velX === 5 && sliding.posX === 105,
    `velX=${sliding.velX} posX=${sliding.posX}`);
  const fast = body({ physics: { gravity: 0, friction: 1, bounciness: 0, maxSpeed: 25 }, velX: 1000, velY: -1000 });
  check('integrateBody: velocity clamps to +/-maxSpeed',
    PS.integrateBody(fast, 1, h) === true && fast.velX === 25 && fast.velY === -25,
    `velX=${fast.velX} velY=${fast.velY}`);
  const text = body({ kind: 'text', collision: { enabled: true } });
  check('integrateBody: a collision-enabled text object does NOT move (divergence 1)',
    PS.integrateBody(text, 1, h) === false && text.posY === 150 && text.velY === undefined,
    `posY=${text.posY} velY=${text.velY}`);
  check('integrateBody: _prev is still snapshotted for the skipped text object',
    text._prevX === 100 && text._prevY === 150);
  const light = body({ kind: 'light3d' });
  check('integrateBody: a light3d does NOT move (divergence 2)',
    PS.integrateBody(light, 1, h) === false && light.posY === 150);
  const noDt = body();
  check('integrateBody: a non-finite dt reads as 0 (no movement, no throw)',
    PS.integrateBody(noDt, NaN, h) === true && noDt.posY === 150 && noDt.velY === 0,
    `posY=${noDt.posY} velY=${noDt.velY}`);
  const noReader = body();
  check('integrateBody: no getPhysics hook reads obj.physics directly',
    PS.integrateBody(noReader, 1, Object.assign({}, h, { getPhysics: undefined })) === true &&
    noReader.velY === 20 && noReader.posY === 170);
  const throwingReader = body();
  check('integrateBody: a throwing getPhysics degrades to the object record, no throw',
    PS.integrateBody(throwingReader, 1, Object.assign({}, h, {
      getPhysics: () => { throw new Error('boom-physics'); }
    })) === true && throwingReader.velY === 20 && throwingReader.posY === 170);
  const undefFields = body({ physics: { gravity: undefined, friction: undefined, maxSpeed: undefined } });
  check('integrateBody: undefined physics fields fall back to defaults (no NaN velocities)',
    PS.integrateBody(undefFields, 1, Object.assign({}, h, {
      getPhysics: (o) => o.physics
    })) === true && undefFields.velY === 0 && undefFields.posY === 150 &&
    isFinite(undefFields.velX) && isFinite(undefFields.velY),
    `velY=${undefFields.velY} posY=${undefFields.posY}`);
  const frozen = Object.freeze(body());
  check('integrateBody: a frozen object returns false without throwing',
    PS.integrateBody(frozen, 1, h) === false);
  check('integrateBody: null / non-object returns false without throwing',
    PS.integrateBody(null, 1, h) === false && PS.integrateBody('nope', 1, h) === false);
  const noPos = { id: 9, kind: 'sprite', physicsEnabled: true, physics: { gravity: 10, friction: 1, maxSpeed: 100 } };
  check('integrateBody: a missing posX/posY reads as 0 instead of NaN',
    PS.integrateBody(noPos, 1, h) === true && noPos.posX === 0 && noPos.posY === 10,
    `posX=${noPos.posX} posY=${noPos.posY}`);
  // --- cycle 25: plain (non-physics) objects take the pure velocity step ---
  const glider = body({
    physicsEnabled: false,
    physics: { gravity: 20, friction: 0.5, bounciness: 0, maxSpeed: 100 },
    velX: 10, velY: 5
  });
  check('integrateBody: a non-physics object glides on its velocity (dt 1, +10/+5)',
    PS.integrateBody(glider, 1, h) === true && glider.posX === 110 && glider.posY === 155,
    `posX=${glider.posX} posY=${glider.posY}`);
  check('integrateBody: the glider ignores its physics record — no gravity, no friction decay',
    glider.velX === 10 && glider.velY === 5, `velX=${glider.velX} velY=${glider.velY}`);
  const runaway = body({ physicsEnabled: false, velX: 1000, velY: -1000 });
  check('integrateBody: a plain object is NOT clamped to maxSpeed (no clamp off physics)',
    PS.integrateBody(runaway, 1, h) === true && runaway.posX === 1100 && runaway.posY === -850 &&
    runaway.velX === 1000 && runaway.velY === -1000,
    `posX=${runaway.posX} posY=${runaway.posY} velX=${runaway.velX}`);
  const badVel = body({ physicsEnabled: false, velX: NaN, velY: undefined });
  check('integrateBody: a non-finite velocity on a plain object repairs to 0, no NaN position',
    PS.integrateBody(badVel, 1, h) === true && badVel.posX === 100 && badVel.posY === 150 &&
    badVel.velX === 0 && badVel.velY === 0,
    `posX=${badVel.posX} velX=${badVel.velX} velY=${badVel.velY}`);
  const stillText = body({ kind: 'text', physicsEnabled: false, velX: 10, velY: 10 });
  check('integrateBody: a non-physics text object still does NOT move',
    PS.integrateBody(stillText, 1, h) === false && stillText.posX === 100 && stillText.posY === 150);
  const stillStatic = body({ static: true, physicsEnabled: false, velX: 10 });
  check('integrateBody: a non-physics static object still does NOT move',
    PS.integrateBody(stillStatic, 1, h) === false && stillStatic.posX === 100);
  const still3d = body({ kind: 'box3d', physicsEnabled: false, velX: 10 });
  check('integrateBody: a non-physics 3D object still does NOT move',
    PS.integrateBody(still3d, 1, h) === false && still3d.posX === 100);
  const stillFrozen = Object.freeze(body({ physicsEnabled: false, velX: 10 }));
  check('integrateBody: a frozen plain object returns false without throwing',
    PS.integrateBody(stillFrozen, 1, h) === false);
}

// --- resolveObjectCollisions ---
{
  const h = fullHooks();
  // resolveObjectCollisions resolves an existing overlap — the bodies
  // below start already intersecting the floor (integration already ran).
  const box = body({ posY: 170, velY: 20, _prevY: 150 });
  const fl = floorObj();
  const trig = PS.resolveObjectCollisions([box, fl], h);
  check('resolveObjectCollisions: a falling box lands on the floor (posY 160, velY 0)',
    box.posY === 160 && box.velY === 0, `posY=${box.posY} velY=${box.velY}`);
  check('resolveObjectCollisions: no contacts without a trigger zone',
    trig.contacts.length === 0 && trig.entered.length === 0 && trig.exited.length === 0 &&
    JSON.stringify(trig.nextPairs) === '{}', JSON.stringify(trig));

  // Trigger zones: contacts only, never blocking, with enter/exit edges.
  const zone = Object.assign(floorObj(), {
    id: 3, name: 'zone', posX: 100, posY: 150, width: 40, height: 40,
    collision: { mode: 'trigger' }
  });
  const inZone = body();
  const t1 = PS.resolveObjectCollisions([inZone, zone], h);
  check('resolveObjectCollisions: a trigger zone reports the contact but never blocks',
    t1.contacts.length === 1 && t1.contacts[0].zone === zone && t1.contacts[0].obj === inZone &&
    inZone.posY === 150, `contacts=${t1.contacts.length} posY=${inZone.posY}`);
  check('resolveObjectCollisions: entering a zone reports entered ["3:1"]',
    JSON.stringify(t1.entered) === '["3:1"]' && t1.exited.length === 0, JSON.stringify(t1));
  const t2 = PS.resolveObjectCollisions([inZone, zone], fullHooks(t1.nextPairs));
  check('resolveObjectCollisions: staying in a zone reports neither entered nor exited',
    t2.entered.length === 0 && t2.exited.length === 0, JSON.stringify(t2));
  const outZone = body({ posX: 500 });
  const t3 = PS.resolveObjectCollisions([outZone, zone], fullHooks(t2.nextPairs));
  check('resolveObjectCollisions: leaving a zone reports exited ["3:1"]',
    t3.entered.length === 0 && JSON.stringify(t3.exited) === '["3:1"]', JSON.stringify(t3));

  // Collision layers gate object collision too.
  const layered = body({ posY: 170, velY: 20, _prevY: 150, collision: { layer: 1, mask: 255 } });
  const gatedFloor = floorObj({ collision: { layer: 0, mask: 253 } });
  PS.resolveObjectCollisions([layered, gatedFloor], h);
  check('resolveObjectCollisions: a layer-excluded floor does not block (stays overlapped)',
    layered.posY === 170 && layered.velY === 20, `posY=${layered.posY} velY=${layered.velY}`);
  const openFloor = floorObj({ collision: { layer: 0, mask: 255 } });
  const layered2 = body({ posY: 170, velY: 20, _prevY: 150, collision: { layer: 1, mask: 255 } });
  PS.resolveObjectCollisions([layered2, openFloor], h);
  check('resolveObjectCollisions: a layer-included floor still blocks',
    layered2.posY === 160 && layered2.velY === 0, `posY=${layered2.posY}`);

  // Degradation: no physics2d means no blocking and no contacts.
  const noP2d = body();
  const noP2dTrig = PS.resolveObjectCollisions([noP2d, floorObj()], Object.assign({}, h, { physics2d: null }));
  check('resolveObjectCollisions: no physics2d degrades to no blocking, empty triggers',
    noP2d.posY === 150 && noP2dTrig.contacts.length === 0 &&
    JSON.stringify(noP2dTrig.nextPairs) === '{}', `posY=${noP2d.posY}`);
  check('resolveObjectCollisions: a non-array list is a no-op returning empty triggers',
    (() => {
      const r = PS.resolveObjectCollisions(null, h);
      return r.contacts.length === 0 && r.entered.length === 0 && r.exited.length === 0;
    })());
  check('resolveObjectCollisions: a throwing resolvePair never breaks the frame',
    (() => {
      const throwingP2d = {
        triggerContacts: () => [], pairKey: P2D.pairKey, canCollide: P2D.canCollide,
        isTrigger: P2D.isTrigger, resolvePair: () => { throw new Error('boom-pair'); }
      };
      let threw = false;
      let out = null;
      try { out = PS.resolveObjectCollisions([body(), floorObj()], Object.assign({}, h, { physics2d: throwingP2d })); }
      catch (e) { threw = true; }
      return !threw && out !== null && out.contacts.length === 0;
    })());
}

// --- resolveTileCollisions ---
{
  const h = fullHooks();
  // resolveTileCollisions resolves an existing overlap — the heroes below
  // start already intersecting the solid tile row (integration already ran).
  const hero = { id: 1, name: 'hero', kind: 'sprite', posX: 100, posY: 310, width: 24, height: 24,
    static: false, physicsEnabled: true, velX: 0, velY: 20, _prevY: 300,
    physics: { gravity: 0, friction: 1, bounciness: 0, maxSpeed: 25 } };
  const map = tileFloorObject();
  const hit = PS.resolveTileCollisions([hero, map], h);
  check('resolveTileCollisions: a falling body lands on the solid tile row (posY 304, velY 0)',
    hit === true && hero.posY === 304 && hero.velY === 0, `hit=${hit} posY=${hero.posY} velY=${hero.velY}`);
  const above = { id: 1, name: 'hero', kind: 'sprite', posX: 100, posY: 100, width: 24, height: 24,
    static: false, physicsEnabled: true, velX: 0, velY: 20,
    physics: { gravity: 0, friction: 1, bounciness: 0, maxSpeed: 25 } };
  check('resolveTileCollisions: a body clear of the map does not collide',
    PS.resolveTileCollisions([above, map], h) === false && above.posY === 100);
  const noRecord = tileFloorObject();
  delete noRecord.collision;
  const hero2 = { id: 1, name: 'hero', kind: 'sprite', posX: 100, posY: 310, width: 24, height: 24,
    static: false, physicsEnabled: true, velX: 0, velY: 20, _prevY: 300,
    physics: { gravity: 0, friction: 1, bounciness: 0, maxSpeed: 25 } };
  check('resolveTileCollisions: a tilemap with no collision record still collides',
    PS.resolveTileCollisions([hero2, noRecord], h) === true && hero2.posY === 304,
    `posY=${hero2.posY}`);
  const disabled = tileFloorObject({ collision: { enabled: false } });
  const hero3 = { id: 1, name: 'hero', kind: 'sprite', posX: 100, posY: 310, width: 24, height: 24,
    static: false, physicsEnabled: true, velX: 0, velY: 20, _prevY: 300,
    physics: { gravity: 0, friction: 1, bounciness: 0, maxSpeed: 25 } };
  check('resolveTileCollisions: a collision-disabled tilemap does not collide',
    PS.resolveTileCollisions([hero3, disabled], h) === false && hero3.posY === 310);
  check('resolveTileCollisions: no tiles module is a no-op returning false',
    PS.resolveTileCollisions([hero, map], Object.assign({}, h, { tiles: null })) === false);
  const layeredHero = { id: 1, name: 'hero', kind: 'sprite', posX: 100, posY: 310, width: 24, height: 24,
    static: false, physicsEnabled: true, velX: 0, velY: 20, _prevY: 300, collision: { layer: 1, mask: 255 },
    physics: { gravity: 0, friction: 1, bounciness: 0, maxSpeed: 25 } };
  const gatedMap = tileFloorObject({ collision: { layer: 0, mask: 253 } });
  check('resolveTileCollisions: a layer-excluded tilemap does not block',
    PS.resolveTileCollisions([layeredHero, gatedMap], h) === false && layeredHero.posY === 310);
  check('resolveTileCollisions: a tilemap is never a dynamic (it never moves)',
    (() => {
      const m = tileFloorObject();
      PS.resolveTileCollisions([m], h);
      return m.posX === 0 && m.posY === 200;
    })());
}

// --- stepPhysics2d: the full step ---
{
  const h = fullHooks();
  const box = body();
  const fl = floorObj();
  const trig = PS.stepPhysics2d([box, fl], 1, h);
  check('stepPhysics2d: one step falls the box onto the floor (posY 160, velY 0)',
    box.posY === 160 && box.velY === 0, `posY=${box.posY} velY=${box.velY}`);
  PS.stepPhysics2d([box, fl], 1, h);
  PS.stepPhysics2d([box, fl], 1, h);
  PS.stepPhysics2d([box, fl], 1, h);
  check('stepPhysics2d: a landed box stays put over later steps (no jitter, no sinking)',
    box.posY === 160 && box.velY === 0, `posY=${box.posY} velY=${box.velY}`);
  check('stepPhysics2d: returns the trigger summary',
    trig && Array.isArray(trig.contacts) && Array.isArray(trig.entered) &&
    Array.isArray(trig.exited) && typeof trig.nextPairs === 'object', JSON.stringify(trig));
  const label = body({ id: 5, name: 'label', kind: 'text', posX: 300, posY: 100,
    collision: { enabled: true } });
  const box2 = body();
  PS.stepPhysics2d([label, box2, floorObj()], 1, h);
  check('stepPhysics2d: a collision-enabled text label never falls (divergence 1)',
    label.posY === 100, `posY=${label.posY}`);
  check('stepPhysics2d: the box in the same step still lands',
    box2.posY === 160 && box2.velY === 0, `posY=${box2.posY}`);
  const light = body({ id: 6, name: 'lamp', kind: 'light3d', posX: 400, posY: 100 });
  PS.stepPhysics2d([light], 1, h);
  check('stepPhysics2d: a light3d never falls (divergence 2)',
    light.posY === 100, `posY=${light.posY}`);
  const tileHero = { id: 1, name: 'hero', kind: 'sprite', posX: 100, posY: 300, width: 24, height: 24,
    static: false, physicsEnabled: true,
    physics: { gravity: 20, friction: 1, bounciness: 0, maxSpeed: 25 } };
  PS.stepPhysics2d([tileHero, tileFloorObject()], 1, h);
  check('stepPhysics2d: the tile pass runs in the same step (hero lands on tiles at 304)',
    tileHero.posY === 304 && tileHero.velY === 0, `posY=${tileHero.posY} velY=${tileHero.velY}`);
  // Cycle 25: a plain object glides through the same step — it moves,
  // but it never lands on the floor (collision stays physics-gated)
  // and never trips a trigger zone.
  const glider2 = body({ id: 8, name: 'glider', physicsEnabled: false, velX: 60, velY: 0,
    physics: { gravity: 20, friction: 0.5, bounciness: 0, maxSpeed: 25 } });
  const faller = body({ id: 9, name: 'faller', posX: 500, posY: 170, physicsEnabled: false, velX: 0, velY: 20 });
  const box3 = body({ posY: 150, velY: 20, _prevY: 130 });
  const fl3 = floorObj();
  PS.stepPhysics2d([glider2, faller, box3, fl3], 1, h);
  check('stepPhysics2d: a non-physics object glides at a steady speed (no friction, no clamp)',
    glider2.posX === 160 && glider2.posY === 150 && glider2.velX === 60,
    `posX=${glider2.posX} posY=${glider2.posY} velX=${glider2.velX}`);
  check('stepPhysics2d: a non-physics object falls THROUGH the floor (no collision off physics)',
    faller.posY === 190 && faller.velY === 20, `posY=${faller.posY} velY=${faller.velY}`);
  check('stepPhysics2d: the physics body in the same step still lands on the floor',
    box3.posY === 160 && box3.velY === 0, `posY=${box3.posY} velY=${box3.velY}`);
  const plainZone = Object.assign(floorObj(), {
    id: 3, name: 'zone', posX: 100, posY: 150, width: 40, height: 40,
    collision: { mode: 'trigger' }
  });
  const plainInZone = body({ physicsEnabled: false });
  const plainTrig = PS.stepPhysics2d([plainInZone, plainZone], 1, h);
  check('stepPhysics2d: a non-physics object inside a trigger zone reports no contact',
    plainTrig.contacts.length === 0 && plainTrig.entered.length === 0,
    JSON.stringify(plainTrig));
  const zone = Object.assign(floorObj(), {
    id: 3, name: 'zone', posX: 100, posY: 150, width: 40, height: 40,
    collision: { mode: 'trigger' }
  });
  const inZone = body();
  const zoneTrig = PS.stepPhysics2d([inZone, zone], 1, h);
  check('stepPhysics2d: trigger entry is reported in the returned summary',
    JSON.stringify(zoneTrig.entered) === '["3:1"]' && zoneTrig.contacts.length === 1,
    JSON.stringify(zoneTrig));
  check('stepPhysics2d: empty hooks integrate but resolve nothing (degradation)',
    (() => {
      const b = body();
      const r = PS.stepPhysics2d([b, floorObj()], 1, {});
      return b.posY === 170 && b.velY === 20 && r.contacts.length === 0;
    })());
  check('stepPhysics2d: a non-array list is a no-op returning empty triggers, no throw',
    (() => {
      const r = PS.stepPhysics2d(null, 1, h);
      return r.contacts.length === 0 && r.entered.length === 0 && r.exited.length === 0;
    })());
  check('stepPhysics2d: a frozen object in the list never breaks the step',
    (() => {
      const frozen = Object.freeze(body());
      const live = body({ id: 7, posX: 200 });
      let threw = false;
      let r = null;
      try { r = PS.stepPhysics2d([frozen, live, floorObj()], 1, h); }
      catch (e) { threw = true; }
      return !threw && r !== null && live.posY === 160;
    })());
}

// --- static routing: both runtimes delegate to the module ---
{
  const runtimeSrc = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'player-runtime.js'), 'utf8');
  const scriptSrc = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'script.js'), 'utf8');
  const moduleSrc = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-previewruntime.js'), 'utf8');
  const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'index.html'), 'utf8');
  check('player-runtime.js hard-guards on HydraPhysicsStep',
    runtimeSrc.includes("throw new Error('HydraScript player runtime requires hydra-physicsstep.js (window.HydraPhysicsStep) to be loaded first.');"));
  check('player-runtime.js inlines HydraPhysicsStep into exports (sharedSources)',
    runtimeSrc.includes("['HydraPhysicsStep', global.HydraPhysicsStep && global.HydraPhysicsStep.factorySource, 'hydra-physicsstep.js (window.HydraPhysicsStep)']"));
  check('player-runtime.js updatePhysics delegates to HydraPhysicsStep.stepPhysics2d',
    runtimeSrc.includes('HydraPhysicsStep.stepPhysics2d(live, state.dt, {'));
  check('player-runtime.js updatePhysics writes the trigger summary back to state',
    runtimeSrc.includes('state._triggerContacts = trig.contacts;') &&
    runtimeSrc.includes('state._triggerPairs = trig.nextPairs;') &&
    runtimeSrc.includes('state._triggerEntered = trig.entered;') &&
    runtimeSrc.includes('state._triggerExited = trig.exited;'));
  check('player-runtime.js no longer inlines the integration math',
    !/obj\.velY = \(obj\.velY \|\| 0\) \+ p\.gravity \* state\.dt/.test(runtimeSrc));
  check('player-runtime.js no longer defines its own resolveCollisions',
    !/function resolveCollisions\(state, objects\)/.test(runtimeSrc));
  check('player-runtime.js no longer defines its own resolveTileCollisions',
    !/function resolveTileCollisions\(state, objects\)/.test(runtimeSrc));
  check('player-runtime.js still keeps isCollisionObject (used by conditions)',
    runtimeSrc.includes('function isCollisionObject(obj) {'));
  check('the preview runtime module gameLoop delegates the physics phase to HydraPhysicsStep',
    moduleSrc.includes('trig = PS.stepPhysics2d(objs, dt, physicsStepHooks());'));
  check('the preview runtime module gameLoop writes the trigger summary back to the run state',
    moduleSrc.includes('r._triggerContacts = trig.contacts;') &&
    moduleSrc.includes('r._triggerPairs = trig.nextPairs;') &&
    moduleSrc.includes('r._triggerEntered = trig.entered;') &&
    moduleSrc.includes('r._triggerExited = trig.exited;'));
  check('script.js no longer inlines the preview text skip',
    !/if \(!isCollisionObject\(obj\) && obj\.kind === 'text'\) return;/.test(scriptSrc));
  check('script.js no longer inlines the preview integration loop',
    !/obj\.velY \+= p\.gravity \* dt;/.test(scriptSrc));
  check('script.js no longer defines its own resolveCollisions',
    !/function resolveCollisions\(objects, canvas\)/.test(scriptSrc));
  check('script.js no longer defines its own resolveTilemapCollisions',
    !/function resolveTilemapCollisions\(objs\)/.test(scriptSrc));
  check('script.js no longer defines getPreviousHitbox (only the removed resolvers used it)',
    !/function getPreviousHitbox\(obj\)/.test(scriptSrc));
  check('script.js keeps getAABBOverlap (separateObjectsPair still uses it)',
    scriptSrc.includes('function getAABBOverlap(a, b) {'));
  check('index.html loads hydra-physicsstep.js before player-runtime.js and script.js',
    indexSrc.indexOf('src="hydra-physicsstep.js') !== -1 &&
    indexSrc.indexOf('src="hydra-physicsstep.js') < indexSrc.indexOf('src="player-runtime.js') &&
    indexSrc.indexOf('src="hydra-physicsstep.js') < indexSrc.indexOf('src="script.js'));
}

if (failures) { console.error(`${failures} assertion(s) failed`); process.exit(1); }
console.log('physicsstep.test.js: all assertions passed');
