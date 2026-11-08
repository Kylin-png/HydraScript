// Unit tests for hydra/hydra-draw.js — the shared draw passes (P2 item
// 15/12, slice 6: the shared-engine extraction continues here).
//
// Pure logic: the full frame composition (background, 3D pass, world
// objects, particles, darkness overlay, HUD pass, screen flash,
// profiler overlay) plus the per-kind draws, over a recording canvas
// context. The tests pin the frame order, the skip rules, the hook
// degradation (a missing or throwing hook never breaks the frame), the
// never-throws contract, the three divergences this slice closes
// (exports now rotate text, text boxes now measure their text when the
// object has no width, the background reads worldWidth || width), and
// the static routing that both runtimes delegate to it.

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
['hydra-draw.js', 'hydra-ui.js', 'hydra-camerafx.js', 'hydra-profile.js', 'hydra-parallax.js', 'hydra-health.js', 'hydra-damagefx.js', 'hydra-combat.js', 'hydra-boss.js', 'hydra-minimap.js', 'hydra-attach.js'].forEach(m =>
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', m), 'utf8'),
    sandbox, { filename: m }));
const D = sandbox.HydraDraw;
const Ui = sandbox.HydraUi;
const CFx = sandbox.HydraCameraFx;
const Prof = sandbox.HydraProfile;
const PX = sandbox.HydraParallax;
const HP = sandbox.HydraHealth;
const DF = sandbox.HydraDamageFx;
const CB = sandbox.HydraCombat;
const BO = sandbox.HydraBoss;
const MM = sandbox.HydraMinimap;

// --- recording canvas context ---
// Property reads return the last assigned value (so the module's
// globalAlpha reads work); every method call is logged with the
// fillStyle / globalAlpha / font / textAlign in force at the time.
function recCtx(opts) {
  const o = opts || {};
  const log = [];
  const store = {};
  let saves = 0;
  const ctx = new Proxy({}, {
    get(t, p) {
      if (p in store) return store[p];
      if (p === 'measureText' && !o.noMeasure) return () => ({ width: 42 });
      if (p === Symbol.toPrimitive) return () => 0;
      if (typeof p === 'string') {
        return (...args) => {
          log.push({ call: p, args, fillStyle: store.fillStyle, globalAlpha: store.globalAlpha, font: store.font, textAlign: store.textAlign });
          if (p === 'save') saves++;
          if (p === 'restore') saves--;
        };
      }
      return undefined;
    },
    set(t, p, v) { store[p] = v; return true; }
  });
  return { ctx, log, store, get saves() { return saves; } };
}
const calls = (log, name) => log.filter(e => e.call === name);
const fills = (log, color) => log.filter(e => e.call === 'fillRect' && e.fillStyle === color);

function baseView(over) {
  return Object.assign({
    scene: { id: 1, name: 'S', bgColor: '#ffffff', worldWidth: 800, worldHeight: 600 },
    objects: [], width: 800, height: 600,
    camera: { x: 0, y: 0, zoom: 1 },
    shake: null, flash: null, particles: null, profiler: null, camera3d: null,
    hidden: new Set(), destroyed: new Set()
  }, over || {});
}
function baseHooks(over) {
  return Object.assign({
    ui: Ui, tiles: null, anim: null, blendSpace: null, skeleton: null,
    layerFx: null, light2d: null, threeD: null, cameraFx: CFx,
    particles: null, profile: Prof, parallax: PX,
    image: () => null, modelMesh: () => null,
    getDarkCanvas: () => null,
    buttonState: () => 'normal'
  }, over || {});
}
function sprite(id, over) {
  return Object.assign({ id, name: 'o' + id, kind: 'sprite', posX: 100, posY: 100, width: 40, height: 40, color: '#ff0000' }, over || {});
}

// --- surface + factorySource ---
check('surface exposes the frame, the per-kind draws, and the helpers',
  typeof D.drawFrame === 'function' && typeof D.drawObject === 'function' &&
  typeof D.drawTextObject === 'function' && typeof D.drawPanelObject === 'function' &&
  typeof D.drawSpriteObject === 'function' && typeof D.drawTilemapObject === 'function' &&
  typeof D.normalizeCameraZoom === 'function' && typeof D.shakenCamera === 'function' &&
  typeof D.isScreenFixed === 'function' && typeof D.widgetScreenPos === 'function' &&
  typeof D.roundedRectPath === 'function' && typeof D.drawScaleOf === 'function' &&
  typeof D.applyDrawTransform === 'function' && typeof D.drawFitted === 'function',
  Object.keys(D).join(','));
check('factorySource re-instantiates an independent module',
  (() => {
    const sb2 = { window: null };
    sb2.window = sb2;
    vm.createContext(sb2);
    const fresh = vm.runInContext('(' + D.factorySource + ')()', sb2);
    return fresh !== D && typeof fresh.drawFrame === 'function' &&
      fresh.drawFrame !== D.drawFrame && typeof fresh.factorySource === 'undefined';
  })());

// --- normalizeCameraZoom + shakenCamera ---
check('normalizeCameraZoom clamps 0.25-4 and reads corrupt values as 1',
  D.normalizeCameraZoom(1) === 1 && D.normalizeCameraZoom(0.1) === 0.25 &&
  D.normalizeCameraZoom(9) === 4 && D.normalizeCameraZoom(NaN) === 1 &&
  D.normalizeCameraZoom(undefined) === 1 && D.normalizeCameraZoom('2') === 2);
check('shakenCamera adds the shake offset and carries the zoom',
  (() => {
    const cam = D.shakenCamera({ x: 10, y: 20, zoom: 2 }, { x: 1, y: 2 },
      { shakeOffset: () => ({ x: 5, y: -3 }) });
    return cam.x === 15 && cam.y === 17 && cam.zoom === 2;
  })());
check('shakenCamera with no cameraFx reads as the base camera',
  (() => {
    const cam = D.shakenCamera({ x: 10, y: 20, zoom: 1 }, {}, null);
    return cam.x === 10 && cam.y === 20 && cam.zoom === 1;
  })());
check('shakenCamera with a throwing cameraFx reads as the base camera',
  (() => {
    const cam = D.shakenCamera({ x: 10, y: 20 }, {}, { shakeOffset: () => { throw new Error('boom'); } });
    return cam.x === 10 && cam.y === 20;
  })());
check('shakenCamera with no camera reads as the origin at zoom 1',
  (() => {
    const cam = D.shakenCamera(null, null, null);
    return cam.x === 0 && cam.y === 0 && cam.zoom === 1;
  })());

// --- small helpers ---
check('roundedRectPath with r 0 is a plain rect',
  (() => {
    const r = recCtx();
    D.roundedRectPath(r.ctx, 10, 20, 30, 40, 0);
    return calls(r.log, 'rect').length === 1 && calls(r.log, 'arcTo').length === 0;
  })());
check('roundedRectPath with a radius arcs four corners and clamps to half the side',
  (() => {
    const r = recCtx();
    D.roundedRectPath(r.ctx, 10, 20, 30, 40, 99);
    const arcs = calls(r.log, 'arcTo');
    return arcs.length === 4 && arcs[0].args[4] === 15 &&
      calls(r.log, 'closePath').length === 1;
  })());
check('drawScaleOf folds flips into signs and reads corrupt scales as 1',
  (() => {
    const a = D.drawScaleOf({ flipH: true, scaleX: 2, scaleY: 'junk' });
    const b = D.drawScaleOf({});
    return a[0] === -2 && a[1] === 1 && b[0] === 1 && b[1] === 1;
  })());
check('drawFitted stretches exactly and covers by default',
  (() => {
    const r = recCtx();
    const img = { naturalWidth: 200, naturalHeight: 100 };
    D.drawFitted(r.ctx, img, { width: 40, height: 40, assetFit: 'stretch' });
    D.drawFitted(r.ctx, img, { width: 40, height: 40 });
    const d = calls(r.log, 'drawImage');
    return d.length === 2 && JSON.stringify(d[0].args) === JSON.stringify([img, -20, -20, 40, 40]) &&
      JSON.stringify(d[1].args) === JSON.stringify([img, -40, -20, 80, 40]);
  })());
check('drawFitted contains by letterboxing',
  (() => {
    const r = recCtx();
    const img = { naturalWidth: 200, naturalHeight: 100 };
    D.drawFitted(r.ctx, img, { width: 40, height: 40, assetFit: 'contain' });
    const d = calls(r.log, 'drawImage');
    return d.length === 1 && JSON.stringify(d[0].args) === JSON.stringify([img, -20, -10, 40, 20]);
  })());
check('isScreenFixed follows the ui module and falls back to uiPinned',
  D.isScreenFixed({ hud: true }, Ui) === true &&
  D.isScreenFixed({ uiPinned: true }, null) === true &&
  D.isScreenFixed({ posX: 1 }, null) === false);
check('widgetScreenPos resolves anchors and falls back to the world position',
  (() => {
    const a = D.widgetScreenPos({ anchor: 'top-right', posX: 5, posY: 6 }, 800, 600, Ui);
    const b = D.widgetScreenPos({ posX: 5, posY: 6 }, 800, 600, null);
    return a.x === 805 && a.y === 6 && b.x === 5 && b.y === 6;
  })());

// --- drawFrame: hostile input ---
check('drawFrame returns false for a missing context or view',
  D.drawFrame(null, baseView(), baseHooks()) === false &&
  D.drawFrame(recCtx().ctx, null, baseHooks()) === false &&
  D.drawFrame(recCtx().ctx, 'nope', baseHooks()) === false);
check('drawFrame with an empty view draws the bg color and returns zero counts',
  (() => {
    const r = recCtx();
    const out = D.drawFrame(r.ctx, {}, {});
    return out && out.draws2d === 0 && out.tris3d === 0 &&
      fills(r.log, '#ffffff').some(e => e.args[0] === 0 && e.args[1] === 0 && e.args[2] === 0 && e.args[3] === 0);
  })());
check('drawFrame never throws on a frozen view and scene',
  (() => {
    const r = recCtx();
    const view = baseView({ scene: Object.freeze({ bgColor: '#000000', darkness: 1, worldWidth: 800, worldHeight: 600 }) });
    Object.freeze(view);
    const out = D.drawFrame(r.ctx, view, baseHooks());
    return !!out && out.draws2d === 0;
  })());
check('drawFrame never throws with a non-array objects list',
  (() => {
    const r = recCtx();
    const out = D.drawFrame(r.ctx, baseView({ objects: 'junk' }), baseHooks());
    return !!out && out.draws2d === 0;
  })());

// --- drawFrame: background ---
check('background fills the scene color when there is no bg image',
  (() => {
    const r = recCtx();
    D.drawFrame(r.ctx, baseView({ scene: { bgColor: '#112233', worldWidth: 800, worldHeight: 600 } }), baseHooks());
    return fills(r.log, '#112233').some(e => e.args[0] === 0 && e.args[1] === 0 && e.args[2] === 800 && e.args[3] === 600);
  })());
check('background draws the bg image at the world size, offset by the camera',
  (() => {
    const r = recCtx();
    const bg = { complete: true };
    const out = D.drawFrame(r.ctx, baseView({ camera: { x: 120, y: 40, zoom: 1 } }),
      baseHooks({ image: (id, isBg) => (isBg ? bg : null) }));
    const d = calls(r.log, 'drawImage');
    return d.length === 1 && d[0].args[0] === bg && d[0].args[1] === -120 && d[0].args[2] === -40 &&
      d[0].args[3] === 800 && d[0].args[4] === 600 && out.camera.x === 120 && out.camera.y === 40;
  })());
check('background falls back to width/height when the world size is missing',
  (() => {
    const r = recCtx();
    const bg = { complete: true };
    D.drawFrame(r.ctx, baseView({ scene: { bgColor: '#000000', width: 400, height: 300 } }),
      baseHooks({ image: () => bg }));
    const d = calls(r.log, 'drawImage');
    return d.length === 1 && d[0].args[3] === 400 && d[0].args[4] === 300;
  })());
check('background with an incomplete bg image falls back to the color fill',
  (() => {
    const r = recCtx();
    D.drawFrame(r.ctx, baseView({ scene: { bgColor: '#445566', worldWidth: 800, worldHeight: 600 } }),
      baseHooks({ image: () => ({ complete: false }) }));
    return calls(r.log, 'drawImage').length === 0 && fills(r.log, '#445566').length === 1;
  })());

// --- drawFrame: world sprites, skips, order ---
check('world sprite with no image draws its color rect at the centered position',
  (() => {
    const r = recCtx();
    const out = D.drawFrame(r.ctx, baseView({ objects: [sprite(1)] }), baseHooks());
    const f = fills(r.log, '#ff0000');
    const t = calls(r.log, 'translate');
    return out.draws2d === 1 && f.length === 1 &&
      JSON.stringify(f[0].args) === JSON.stringify([-20, -20, 40, 40]) &&
      t.some(e => e.args[0] === 120 && e.args[1] === 120) && r.saves === 0;
  })());
check('world sprite with a ready image draws it fitted',
  (() => {
    const r = recCtx();
    const img = { complete: true, naturalWidth: 200, naturalHeight: 100 };
    D.drawFrame(r.ctx, baseView({ objects: [sprite(1, { assetId: 'hero-img' })] }),
      baseHooks({ image: (id) => (id === 'hero-img' ? img : null) }));
    const d = calls(r.log, 'drawImage');
    return d.length === 1 && d[0].args[0] === img && fills(r.log, '#ff0000').length === 0;
  })());
check('hidden and destroyed objects never draw',
  (() => {
    const r = recCtx();
    const out = D.drawFrame(r.ctx, baseView({
      objects: [sprite(1), sprite(2, { color: '#00ff00' }), sprite(3, { color: '#0000ff' })],
      hidden: new Set([2]), destroyed: new Set([3])
    }), baseHooks());
    return out.draws2d === 1 && fills(r.log, '#ff0000').length === 1 &&
      fills(r.log, '#00ff00').length === 0 && fills(r.log, '#0000ff').length === 0;
  })());
check('light3d and light2d objects never draw as 2D sprites',
  (() => {
    const r = recCtx();
    const out = D.drawFrame(r.ctx, baseView({
      objects: [sprite(1), sprite(2, { kind: 'light3d', color: '#00ff00' }), sprite(3, { kind: 'light2d', color: '#0000ff' })]
    }), baseHooks({
      threeD: { isLight3d: (k) => k === 'light3d', is3dKind: () => false },
      light2d: { isLight2d: (k) => k === 'light2d' }
    }));
    return out.draws2d === 1 && fills(r.log, '#00ff00').length === 0 && fills(r.log, '#0000ff').length === 0;
  })());
check('objects draw in layer order',
  (() => {
    const r = recCtx();
    D.drawFrame(r.ctx, baseView({
      objects: [sprite(1, { layer: 5, color: '#00ff00' }), sprite(2, { layer: 0, color: '#ff0000' })]
    }), baseHooks());
    const red = r.log.findIndex(e => e.call === 'fillRect' && e.fillStyle === '#ff0000');
    const green = r.log.findIndex(e => e.call === 'fillRect' && e.fillStyle === '#00ff00');
    return red !== -1 && green !== -1 && red < green;
  })());
check('the camera shake offset moves the world draw',
  (() => {
    const r = recCtx();
    const out = D.drawFrame(r.ctx, baseView({ objects: [sprite(1)] }),
      baseHooks({ cameraFx: { shakeOffset: () => ({ x: 5, y: -3 }), flashAlpha: () => 0 } }));
    const t = calls(r.log, 'translate');
    return out.camera.x === 5 && out.camera.y === -3 &&
      t.some(e => e.args[0] === 115 && e.args[1] === 123);
  })());

// --- drawFrame: parallax (P4 Advanced batch 16) ---
// A sprite at world (100, 100), 40x40, draws centered at (120, 120)
// with the camera at the origin. With the camera at (200, 0) the
// parallax camera scales the camera per axis, so the same sprite
// draws at 100 - 200*f + 20 on X: 20 at f 0.5, -80 at f 1, 120 at f 0.
check('a half-speed parallax sprite draws at half the camera offset',
  (() => {
    const r = recCtx();
    const out = D.drawFrame(r.ctx, baseView({
      objects: [sprite(1, { parallaxX: 0.5, parallaxY: 0.5 })],
      camera: { x: 200, y: 0, zoom: 1 }
    }), baseHooks());
    const t = calls(r.log, 'translate');
    return out.draws2d === 1 && t.some(e => e.args[0] === 20 && e.args[1] === 120);
  })());
check('a world-speed parallax sprite draws at the full camera offset',
  (() => {
    const r = recCtx();
    D.drawFrame(r.ctx, baseView({
      objects: [sprite(1, { parallaxX: 1, parallaxY: 1 })],
      camera: { x: 200, y: 0, zoom: 1 }
    }), baseHooks());
    const t = calls(r.log, 'translate');
    return t.some(e => e.args[0] === -80 && e.args[1] === 120);
  })());
check('a pinned parallax sprite (0) ignores the camera entirely',
  (() => {
    const r = recCtx();
    D.drawFrame(r.ctx, baseView({
      objects: [sprite(1, { parallaxX: 0, parallaxY: 0 })],
      camera: { x: 200, y: 100, zoom: 1 }
    }), baseHooks());
    const t = calls(r.log, 'translate');
    return t.some(e => e.args[0] === 120 && e.args[1] === 120);
  })());
check('parallax axes are independent (X half speed, Y pinned)',
  (() => {
    const r = recCtx();
    D.drawFrame(r.ctx, baseView({
      objects: [sprite(1, { parallaxX: 0.5, parallaxY: 0 })],
      camera: { x: 200, y: 100, zoom: 1 }
    }), baseHooks());
    const t = calls(r.log, 'translate');
    return t.some(e => e.args[0] === 20 && e.args[1] === 120);
  })());
check('a sprite without parallax fields draws at world speed',
  (() => {
    const r = recCtx();
    D.drawFrame(r.ctx, baseView({
      objects: [sprite(1)],
      camera: { x: 200, y: 0, zoom: 1 }
    }), baseHooks());
    const t = calls(r.log, 'translate');
    return t.some(e => e.args[0] === -80 && e.args[1] === 120);
  })());
check('a pinned (HUD) object ignores its parallax factor',
  (() => {
    const r = recCtx();
    D.drawFrame(r.ctx, baseView({
      objects: [sprite(1, { uiPinned: true, parallaxX: 0.5, parallaxY: 0.5 })],
      camera: { x: 200, y: 0, zoom: 1 }
    }), baseHooks());
    const t = calls(r.log, 'translate');
    return t.some(e => e.args[0] === 120 && e.args[1] === 120);
  })());
check('parallax applies to text too (the camera translate is halved)',
  (() => {
    const r = recCtx();
    D.drawFrame(r.ctx, baseView({
      objects: [{ id: 1, kind: 'text', text: 'Hi', posX: 200, posY: 300, width: 100, height: 24, parallaxX: 0.5, parallaxY: 1 }],
      camera: { x: 200, y: 0, zoom: 1 }
    }), baseHooks());
    const t = calls(r.log, 'translate');
    return t.some(e => e.args[0] === -100 && e.args[1] === 0);
  })());
check('a missing parallax module draws every object at world speed',
  (() => {
    const r = recCtx();
    D.drawFrame(r.ctx, baseView({
      objects: [sprite(1, { parallaxX: 0.5, parallaxY: 0.5 })],
      camera: { x: 200, y: 0, zoom: 1 }
    }), baseHooks({ parallax: null }));
    const t = calls(r.log, 'translate');
    return t.some(e => e.args[0] === -80 && e.args[1] === 120);
  })());
check('a throwing parallax module draws at world speed, never breaking the frame',
  (() => {
    const r = recCtx();
    const out = D.drawFrame(r.ctx, baseView({
      objects: [sprite(1, { parallaxX: 0.5, parallaxY: 0.5 })],
      camera: { x: 200, y: 0, zoom: 1 }
    }), baseHooks({ parallax: { parallaxCamera: () => { throw new Error('boom'); } } }));
    const t = calls(r.log, 'translate');
    return out.draws2d === 1 && t.some(e => e.args[0] === -80 && e.args[1] === 120);
  })());

// --- drawFrame: health bar (P4 Advanced batch 21) ---
// A sprite at (100, 100), 40x40, with the bar on draws the bar 10px
// above its top edge: background (100, 84, 40, 6), then the colored
// fill at the health fraction. The bar draws after the sprite, so it
// sits on top; it follows the object's parallax camera like the sprite.
check('a half-health sprite draws an amber half-width bar above itself',
  (() => {
    const r = recCtx();
    const out = D.drawFrame(r.ctx, baseView({
      objects: [sprite(1, { showHealthBar: true, maxHealth: 100, health: 50 })]
    }), baseHooks({ health: HP }));
    const bg = fills(r.log, 'rgba(0,0,0,0.55)');
    const fill = fills(r.log, '#f59e0b');
    return out.draws2d === 1 &&
      bg.length === 1 && bg[0].args[0] === 100 && bg[0].args[1] === 84 &&
      bg[0].args[2] === 40 && bg[0].args[3] === 6 &&
      fill.length === 1 && fill[0].args[0] === 100 && fill[0].args[1] === 84 &&
      fill[0].args[2] === 20 && fill[0].args[3] === 6;
  })());
check('a full-health sprite draws a green full-width bar',
  (() => {
    const r = recCtx();
    D.drawFrame(r.ctx, baseView({
      objects: [sprite(1, { showHealthBar: true, maxHealth: 100, health: 100 })]
    }), baseHooks({ health: HP }));
    const fill = fills(r.log, '#22c55e');
    return fill.length === 1 && fill[0].args[2] === 40;
  })());
check('a low-health sprite draws a red bar',
  (() => {
    const r = recCtx();
    D.drawFrame(r.ctx, baseView({
      objects: [sprite(1, { showHealthBar: true, maxHealth: 100, health: 10 })]
    }), baseHooks({ health: HP }));
    const fill = fills(r.log, '#ef4444');
    return fill.length === 1 && fill[0].args[2] === 4;
  })());
check('a dead sprite draws no bar, and a bar-off sprite draws no bar',
  (() => {
    const r = recCtx();
    D.drawFrame(r.ctx, baseView({
      objects: [
        sprite(1, { showHealthBar: true, maxHealth: 100, health: 0 }),
        sprite(2, { showHealthBar: false, maxHealth: 100, health: 50, posX: 200 })
      ]
    }), baseHooks({ health: HP }));
    return fills(r.log, 'rgba(0,0,0,0.55)').length === 0 &&
      fills(r.log, '#22c55e').length === 0 && fills(r.log, '#f59e0b').length === 0;
  })());
check('a missing health module draws no bar',
  (() => {
    const r = recCtx();
    const out = D.drawFrame(r.ctx, baseView({
      objects: [sprite(1, { showHealthBar: true, maxHealth: 100, health: 50 })]
    }), baseHooks({ health: null }));
    return out.draws2d === 1 && fills(r.log, 'rgba(0,0,0,0.55)').length === 0;
  })());

// --- drawFrame: boss bar (P4 Advanced batch 33) ---
// The boss bar is a wide centered bar 24px from the top of the view
// (800 wide here: 160, 24, 480, 18), with the boss's name above it.
// It draws only while a fight runs, the bar is on, and a live object
// with the boss's name exists — and it never breaks the frame.
check('a full-health boss draws a green full-width bar with its name above it',
  (() => {
    const bossObj = sprite(1, { name: 'goblinKing', maxHealth: 300, health: 300 });
    const st = BO.createBossState();
    BO.startBoss(st, 'goblinKing', 3, true);
    const r = recCtx();
    const out = D.drawFrame(r.ctx, baseView({ objects: [bossObj] }), baseHooks({
      boss: BO, bossState: st, bossObject: (n) => bossObj.name === n ? bossObj : null,
      health: HP
    }));
    const bg = fills(r.log, 'rgba(0,0,0,0.55)');
    const fill = fills(r.log, '#22c55e');
    const name = r.log.filter(e => e.call === 'fillText' && e.args[0] === 'goblinKing' && e.fillStyle === '#ffffff');
    return out.draws2d === 1 &&
      bg.length === 1 && bg[0].args[0] === 160 && bg[0].args[1] === 24 &&
      bg[0].args[2] === 480 && bg[0].args[3] === 18 &&
      fill.length === 1 && fill[0].args[0] === 160 && fill[0].args[1] === 24 &&
      fill[0].args[2] === 480 && fill[0].args[3] === 18 &&
      name.length === 1;
  })());
check('a half-health boss draws an amber half-width bar',
  (() => {
    const bossObj = sprite(1, { name: 'goblinKing', maxHealth: 300, health: 150 });
    const st = BO.createBossState();
    BO.startBoss(st, 'goblinKing', 3, true);
    const r = recCtx();
    D.drawFrame(r.ctx, baseView({ objects: [bossObj] }), baseHooks({
      boss: BO, bossState: st, bossObject: (n) => bossObj.name === n ? bossObj : null,
      health: HP
    }));
    const fill = fills(r.log, '#f59e0b');
    return fill.length === 1 && fill[0].args[2] === 240;
  })());
check('a near-dead boss draws a red bar',
  (() => {
    const bossObj = sprite(1, { name: 'goblinKing', maxHealth: 300, health: 30 });
    const st = BO.createBossState();
    BO.startBoss(st, 'goblinKing', 3, true);
    const r = recCtx();
    D.drawFrame(r.ctx, baseView({ objects: [bossObj] }), baseHooks({
      boss: BO, bossState: st, bossObject: (n) => bossObj.name === n ? bossObj : null,
      health: HP
    }));
    const fill = fills(r.log, '#ef4444');
    return fill.length === 1 && fill[0].args[2] === 48;
  })());
check('no boss bar draws with no fight, a hidden bar, or a boss that has not spawned yet',
  (() => {
    const bossObj = sprite(1, { name: 'goblinKing', maxHealth: 300, health: 300 });
    const noFight = BO.createBossState();
    const hidden = BO.createBossState();
    BO.startBoss(hidden, 'goblinKing', 3, false);
    const unspawned = BO.createBossState();
    BO.startBoss(unspawned, 'dragon', 3, true);
    const run = (st) => {
      const r = recCtx();
      D.drawFrame(r.ctx, baseView({ objects: [bossObj] }), baseHooks({
        boss: BO, bossState: st, bossObject: (n) => bossObj.name === n ? bossObj : null,
        health: HP
      }));
      return fills(r.log, 'rgba(0,0,0,0.55)').length;
    };
    return run(noFight) === 0 && run(hidden) === 0 && run(unspawned) === 0;
  })());
check('a missing boss module draws no bar and never breaks the frame',
  (() => {
    const bossObj = sprite(1, { name: 'goblinKing', maxHealth: 300, health: 300 });
    const st = BO.createBossState();
    BO.startBoss(st, 'goblinKing', 3, true);
    const r = recCtx();
    const out = D.drawFrame(r.ctx, baseView({ objects: [bossObj] }), baseHooks({
      boss: null, bossState: st, bossObject: () => bossObj, health: HP
    }));
    return out.draws2d === 1 && fills(r.log, 'rgba(0,0,0,0.55)').length === 0;
  })());

// --- drawFrame: minimap (P4 Advanced batch 36) ---
// The map is a 160px panel in the top-right corner (800 wide here:
// 628, 12, 160, 160), with a dot per live world object and a white
// rectangle for what the camera sees. It draws only while the run
// record says visible — and it never breaks the frame.
check('a visible minimap paints its panel, a white player dot, a tag-colored goblin dot, a gray untagged dot, and the viewport outline',
  (() => {
    const hero = sprite(1, { name: 'hero', posX: 10, posY: 20, tags: ['player'] });
    const ghost = sprite(4, { name: 'ghost', posX: 300, posY: 20, tags: ['goblin'] });
    const rock = sprite(3, { name: 'rock', posX: 400, posY: 300 });
    const st = MM.createMinimapState({ enabled: true });
    const r = recCtx();
    const out = D.drawFrame(r.ctx, baseView({ objects: [hero, ghost, rock] }), baseHooks({
      minimap: MM, minimapState: st
    }));
    const panel = fills(r.log, 'rgba(0,0,0,0.55)');
    const white = fills(r.log, '#ffffff').filter(e => e.args[2] === 5);
    const goblin = fills(r.log, MM.tagColor('goblin'));
    const gray = fills(r.log, '#9ca3af');
    const strokes = calls(r.log, 'strokeRect');
    return out.draws2d === 3 &&
      panel.length === 1 && panel[0].args[0] === 628 && panel[0].args[1] === 12 &&
      panel[0].args[2] === 160 && panel[0].args[3] === 160 &&
      white.length === 1 && white[0].args[2] === 5 && white[0].args[3] === 5 &&
      goblin.length === 1 && goblin[0].args[2] === 3 && goblin[0].args[3] === 3 &&
      gray.length === 1 && gray[0].args[2] === 2 && gray[0].args[3] === 2 &&
      strokes.length === 2;
  })());
check('a hidden minimap paints no panel and no dots',
  (() => {
    const hero = sprite(1, { name: 'hero', posX: 10, posY: 20, tags: ['player'] });
    const st = MM.createMinimapState({ enabled: false });
    const r = recCtx();
    const out = D.drawFrame(r.ctx, baseView({ objects: [hero] }), baseHooks({
      minimap: MM, minimapState: st
    }));
    return out.draws2d === 1 && fills(r.log, 'rgba(0,0,0,0.55)').length === 0 &&
      fills(r.log, '#ffffff').filter(e => e.args[2] === 5).length === 0 && calls(r.log, 'strokeRect').length === 0;
  })());
check('hidden, destroyed, HUD, and light objects get no dot on the map',
  (() => {
    const hero = sprite(1, { name: 'hero', posX: 10, posY: 20, tags: ['player'] });
    const ghost = sprite(4, { name: 'ghost', posX: 300, posY: 20, tags: ['goblin'] });
    const coin = sprite(2, { name: 'coin', posX: 600, posY: 500, tags: ['coin'] });
    const hudObj = sprite(5, { name: 'score', posX: 100, posY: 100, hud: true });
    const lightObj = sprite(6, { name: 'torch', posX: 200, posY: 200, kind: 'light2d' });
    const st = MM.createMinimapState({ enabled: true });
    const r = recCtx();
    const view = baseView({ objects: [hero, ghost, coin, hudObj, lightObj] });
    view.hidden = new Set([4]);
    view.destroyed = new Set([2]);
    D.drawFrame(r.ctx, view, baseHooks({
      minimap: MM, minimapState: st,
      light2d: { isLight2d: (k) => k === 'light2d' }
    }));
    return fills(r.log, '#ffffff').filter(e => e.args[2] === 5).length === 1 &&
      fills(r.log, MM.tagColor('goblin')).length === 0 &&
      fills(r.log, MM.tagColor('coin')).length === 0 &&
      fills(r.log, '#9ca3af').length === 0;
  })());
check('the boss dot draws red and large while a fight runs, beating the boss tag color',
  (() => {
    const ghost = sprite(4, { name: 'goblinKing', posX: 300, posY: 20, tags: ['goblin'], health: 300, maxHealth: 300 });
    const st = MM.createMinimapState({ enabled: true });
    const bo = BO.createBossState();
    BO.startBoss(bo, 'goblinKing', 3, true);
    const r = recCtx();
    D.drawFrame(r.ctx, baseView({ objects: [ghost] }), baseHooks({
      minimap: MM, minimapState: st, boss: BO, bossState: bo
    }));
    const red = fills(r.log, '#ef4444');
    return red.length === 1 && red[0].args[2] === 5 && red[0].args[3] === 5 &&
      fills(r.log, MM.tagColor('goblin')).length === 0;
  })());
check('a zoomed map follows the camera, and the viewport rectangle shrinks to what the camera sees',
  (() => {
    const hero = sprite(1, { name: 'hero', posX: 500, posY: 100, tags: ['player'] });
    const st = MM.createMinimapState({ enabled: true, zoom: 2 });
    const r = recCtx();
    const view = baseView({ objects: [hero], camera: { x: 500, y: 0, zoom: 2 } });
    D.drawFrame(r.ctx, view, baseHooks({ minimap: MM, minimapState: st }));
    // Camera at x 500, zoom 2: the window clamps to the scene edge
    // (400..800) while the view runs 500..900, so the viewport rect
    // starts 40px into the map and is 120px wide; the border is full.
    const strokes = calls(r.log, 'strokeRect');
    const vp = strokes.filter(e => e.args[0] === 668.5 && e.args[2] === 119);
    const border = strokes.filter(e => e.args[0] === 628.5 && e.args[2] === 159);
    return strokes.length === 2 && vp.length === 1 && border.length === 1;
  })());
check('a missing minimap module draws no map and never breaks the frame',
  (() => {
    const hero = sprite(1, { name: 'hero', posX: 10, posY: 20, tags: ['player'] });
    const st = MM.createMinimapState({ enabled: true });
    const r = recCtx();
    const out = D.drawFrame(r.ctx, baseView({ objects: [hero] }), baseHooks({
      minimap: null, minimapState: st
    }));
    return out.draws2d === 1 && fills(r.log, 'rgba(0,0,0,0.55)').length === 0;
  })());

// --- drawFrame: damage numbers (P4 Advanced batch 22) ---
// A spawned number draws its text at the number position (camera 0,0
// here, so the world spot is the screen spot), in its own color, with
// a dark outline; a number outside the view is culled; without the
// hook or without the state nothing draws.
check('a damage number draws its text in its color at its position',
  (() => {
    const r = recCtx();
    const nums = DF.createDamageNumberState();
    DF.spawnDamageNumber(nums, { x: 120, y: 90, text: '25', color: '#ff0000' });
    D.drawFrame(r.ctx, baseView({ damageNumbers: nums }), baseHooks({ damageFx: DF }));
    const f = calls(r.log, 'fillText').filter(e => e.args[0] === '25');
    const s = calls(r.log, 'strokeText').filter(e => e.args[0] === '25');
    return f.length === 1 && f[0].args[1] === 120 && f[0].args[2] === 90 &&
      f[0].fillStyle === '#ff0000' && f[0].font === 'bold 16px sans-serif' &&
      s.length === 1 && s[0].args[1] === 120 && s[0].args[2] === 90;
  })());
check('a damage number outside the view is culled',
  (() => {
    const r = recCtx();
    const nums = DF.createDamageNumberState();
    DF.spawnDamageNumber(nums, { x: 900, y: 90, text: '25', color: '#ff0000' });
    D.drawFrame(r.ctx, baseView({ damageNumbers: nums }), baseHooks({ damageFx: DF }));
    return calls(r.log, 'fillText').filter(e => e.args[0] === '25').length === 0;
  })());
check('no damage number draws without the hook or without the state',
  (() => {
    const r = recCtx();
    const nums = DF.createDamageNumberState();
    DF.spawnDamageNumber(nums, { x: 120, y: 90, text: '25', color: '#ff0000' });
    D.drawFrame(r.ctx, baseView({ damageNumbers: nums }), baseHooks());
    const noHook = calls(r.log, 'fillText').filter(e => e.args[0] === '25').length === 0;
    const r2 = recCtx();
    D.drawFrame(r2.ctx, baseView({}), baseHooks({ damageFx: DF }));
    return noHook && calls(r2.log, 'fillText').filter(e => e.args[0] === '25').length === 0;
  })());

// --- drawFrame: combat slash arcs (P4 Advanced batch 29) ---
// A melee swing draws a white sector in front of the attacker (the
// slash arc), above the world and below the HUD; without the hook or
// without the state nothing draws.
check('a melee slash draws its arc at the swing position',
  (() => {
    const r = recCtx();
    const st = CB.createCombatState();
    st.slashes.push({ x: 120, y: 120, dirX: 1, dirY: 0, range: 60, remain: 0.15 });
    D.drawFrame(r.ctx, baseView({ combat: st }), baseHooks({ combat: CB }));
    const arcs = calls(r.log, 'arc');
    return arcs.length === 1 && arcs[0].args[0] === 120 && arcs[0].args[1] === 120 &&
      arcs[0].args[2] === 60 &&
      Math.abs(arcs[0].args[3] + Math.PI / 4) < 1e-9 &&
      Math.abs(arcs[0].args[4] - Math.PI / 4) < 1e-9 &&
      calls(r.log, 'fill').length === 1 && calls(r.log, 'stroke').length === 1;
  })());
check('no slash arc draws without the hook or without the state',
  (() => {
    const r = recCtx();
    const st = CB.createCombatState();
    st.slashes.push({ x: 120, y: 120, dirX: 1, dirY: 0, range: 60, remain: 0.15 });
    D.drawFrame(r.ctx, baseView({ combat: st }), baseHooks());
    const noHook = calls(r.log, 'arc').length === 0;
    const r2 = recCtx();
    D.drawFrame(r2.ctx, baseView({}), baseHooks({ combat: CB }));
    return noHook && calls(r2.log, 'arc').length === 0;
  })());
check('the bar follows the object parallax camera',
  (() => {
    const r = recCtx();
    D.drawFrame(r.ctx, baseView({
      objects: [sprite(1, { showHealthBar: true, maxHealth: 100, health: 50, parallaxX: 0.5, parallaxY: 0.5 })],
      camera: { x: 200, y: 0, zoom: 1 }
    }), baseHooks({ health: HP }));
    const t = calls(r.log, 'translate');
    // The bar translates by the parallax camera (-100, 0); the sprite
    // itself translates to (20, 120).
    return t.some(e => e.args[0] === -100 && e.args[1] === 0) &&
      t.some(e => e.args[0] === 20 && e.args[1] === 120);
  })());

// --- drawFrame: text (incl. the rotation divergence) ---
check('text draws its label at the object position',
  (() => {
    const r = recCtx();
    const out = D.drawFrame(r.ctx, baseView({
      objects: [{ id: 1, kind: 'text', text: 'Hi', posX: 200, posY: 300, width: 100, height: 24, textColor: '#111111' }]
    }), baseHooks());
    const f = calls(r.log, 'fillText');
    return out.draws2d === 1 && f.length === 1 && f[0].args[0] === 'Hi' &&
      f[0].args[1] === 200 && f[0].args[2] === 300 && f[0].fillStyle === '#111111';
  })());
check('rotated text rotates about the text-box center (the export gains the preview behavior)',
  (() => {
    const r = recCtx();
    D.drawFrame(r.ctx, baseView({
      objects: [{ id: 1, kind: 'text', text: 'Hi', posX: 200, posY: 300, width: 100, height: 24, rotation: 30 }]
    }), baseHooks());
    const rot = calls(r.log, 'rotate');
    const tr = calls(r.log, 'translate');
    return rot.length === 1 && Math.abs(rot[0].args[0] - Math.PI / 6) < 1e-9 &&
      tr.some(e => e.args[0] === 250 && e.args[1] === 312);
  })());
check('unrotated text issues no rotate call',
  (() => {
    const r = recCtx();
    D.drawFrame(r.ctx, baseView({
      objects: [{ id: 1, kind: 'text', text: 'Hi', posX: 200, posY: 300, width: 100, height: 24 }]
    }), baseHooks());
    return calls(r.log, 'rotate').length === 0;
  })());
check('text without a width centers on the measured text width',
  (() => {
    const r = recCtx();
    D.drawFrame(r.ctx, baseView({
      objects: [{ id: 1, kind: 'text', text: 'Hi', posX: 200, posY: 300, textAlign: 'center' }]
    }), baseHooks());
    const f = calls(r.log, 'fillText');
    // measureText reads 42, so the box is 42 wide and center is 200 + 21.
    return f.length === 1 && f[0].args[1] === 221;
  })());
check('text without a width or measureText centers on width 1 (the old export behavior)',
  (() => {
    const r = recCtx({ noMeasure: true });
    D.drawFrame(r.ctx, baseView({
      objects: [{ id: 1, kind: 'text', text: 'Hi', posX: 200, posY: 300, textAlign: 'center' }]
    }), baseHooks());
    const f = calls(r.log, 'fillText');
    return f.length === 1 && f[0].args[1] === 200.5;
  })());
check('button text asks the host for its state at the screen box and draws the state fill',
  (() => {
    const r = recCtx();
    let asked = null;
    const btn = { id: 1, kind: 'text', archetype: 'button', text: 'Play', posX: 10, posY: 10, width: 100, height: 30 };
    const expected = Ui.buttonFillFor(btn, 'hover');
    D.drawFrame(r.ctx, baseView({ objects: [btn] }),
      baseHooks({ buttonState: (obj, sx, sy, s) => { asked = [obj, sx, sy, s]; return 'hover'; } }));
    return asked && asked[0] === btn && asked[1] === 10 && asked[2] === 10 && asked[3] === 1 &&
      calls(r.log, 'fill').filter(e => e.fillStyle === expected.fill).length === 1;
  })());
check('a throwing buttonState hook reads as normal, never breaking the frame',
  (() => {
    const r = recCtx();
    const btn = { id: 1, kind: 'text', archetype: 'button', text: 'Play', posX: 10, posY: 10, width: 100, height: 30 };
    const out = D.drawFrame(r.ctx, baseView({ objects: [btn, sprite(2)] }),
      baseHooks({ buttonState: () => { throw new Error('boom'); } }));
    return out.draws2d === 2 && fills(r.log, '#ff0000').length === 1;
  })());

// --- drawFrame: panel + tilemap ---
check('panel draws its rounded rect in its color',
  (() => {
    const r = recCtx();
    const out = D.drawFrame(r.ctx, baseView({
      objects: [{ id: 1, kind: 'panel', posX: 50, posY: 60, width: 200, height: 100, color: '#1e293b', cornerRadius: 12 }]
    }), baseHooks());
    return out.draws2d === 1 && calls(r.log, 'arcTo').length === 4 &&
      calls(r.log, 'fill').filter(e => e.fillStyle === '#1e293b').length === 1;
  })());
check('tilemap draws through the tiles module with the camera cull window',
  (() => {
    const r = recCtx();
    let seen = null;
    const tiles = { drawTilemap: (c, o, opts) => { seen = opts; } };
    const out = D.drawFrame(r.ctx, baseView({
      camera: { x: 10, y: 20, zoom: 2 },
      objects: [{ id: 1, kind: 'tilemap', tilesetAssetId: 'ts', posX: 0, posY: 0, width: 320, height: 320 }]
    }), baseHooks({ tiles, image: (id) => (id === 'ts' ? { complete: true } : null) }));
    return out.draws2d === 1 && seen && seen.camX === 10 && seen.camY === 20 &&
      seen.viewW === 400 && seen.viewH === 300 && seen.showGrid === false;
  })());
check('tilemap with no tiles module still counts as drawn and never throws',
  (() => {
    const r = recCtx();
    const out = D.drawFrame(r.ctx, baseView({
      objects: [{ id: 1, kind: 'tilemap', posX: 0, posY: 0, width: 320, height: 320 }]
    }), baseHooks({ tiles: null }));
    return out.draws2d === 1;
  })());
check('a throwing tilemap draw skips only that object',
  (() => {
    const r = recCtx();
    const out = D.drawFrame(r.ctx, baseView({
      objects: [
        { id: 1, kind: 'tilemap', posX: 0, posY: 0, width: 320, height: 320 },
        sprite(2)
      ]
    }), baseHooks({ tiles: { drawTilemap: () => { throw new Error('boom'); } } }));
    return out.draws2d === 1 && fills(r.log, '#ff0000').length === 1;
  })());

// --- drawFrame: 3D pass ---
check('3D scenes render through the projector and skip 3D kinds in the world pass',
  (() => {
    const r = recCtx();
    const seen = [];
    const meshCalls = [];
    const threeD = {
      normalizeCamera3d: (c, s) => ({ x: 1, y: 2, z: 3 }),
      is3dKind: (k) => k === 'box',
      isLight3d: (k) => k === 'light3d',
      renderScene: (c, opts, list, w, h, meshFor) => {
        seen.push({ list: list.map(o => o.id), w, h, mesh: typeof meshFor });
        meshFor(list[0]);
        return 7;
      }
    };
    const out = D.drawFrame(r.ctx, baseView({
      scene: { bgColor: '#ffffff', worldWidth: 800, worldHeight: 600, renderMode: '3d' },
      objects: [
        sprite(1, { kind: 'box', color: '#00ff00' }),
        sprite(2, { kind: 'light3d', color: '#0000ff' }),
        sprite(3, { color: '#ff0000' }),
        sprite(4, { kind: 'box', color: '#ffff00' })
      ],
      hidden: new Set([4]),
      camera3d: { x: 9, y: 9, z: 9 }
    }), baseHooks({ threeD, modelMesh: (o) => { meshCalls.push(o.id); return { mesh: 1 }; } }));
    return out.tris3d === 7 && out.camera3d && out.camera3d.x === 1 &&
      seen.length === 1 && JSON.stringify(seen[0].list) === '[1,2]' &&
      seen[0].w === 800 && seen[0].h === 600 && seen[0].mesh === 'function' &&
      meshCalls.length === 1 && meshCalls[0] === 1 &&
      out.draws2d === 1 && fills(r.log, '#ff0000').length === 1 &&
      fills(r.log, '#00ff00').length === 0 && fills(r.log, '#ffff00').length === 0;
  })());
check('a 2D scene never calls the projector even with a 3D module present',
  (() => {
    const r = recCtx();
    let rendered = 0;
    const threeD = {
      normalizeCamera3d: () => ({}),
      is3dKind: (k) => k === 'box',
      isLight3d: () => false,
      renderScene: () => { rendered++; return 1; }
    };
    const out = D.drawFrame(r.ctx, baseView({
      objects: [sprite(1, { kind: 'box', color: '#00ff00' })]
    }), baseHooks({ threeD }));
    return rendered === 0 && out.tris3d === 0 && fills(r.log, '#00ff00').length === 1;
  })());

// --- drawFrame: particles, darkness, HUD, flash, profiler ---
check('particles draw world-space with the zoom-widened cull window',
  (() => {
    const r = recCtx();
    let seen = null;
    const out = D.drawFrame(r.ctx, baseView({
      camera: { x: 10, y: 20, zoom: 2 },
      particles: { particles: [{ x: 1 }] }
    }), baseHooks({ particles: { draw: (c, st, x, y, w, h) => { seen = { x, y, w, h }; } } }));
    return !!out && seen && seen.x === 10 && seen.y === 20 && seen.w === 400 && seen.h === 300;
  })());
check('darkness overlay draws through the light module when darkness is set',
  (() => {
    const r = recCtx();
    let drawn = null;
    const light2d = {
      normalizeSceneDarkness: () => {},
      collectLights2d: (objs) => [{ x: 1 }],
      occluderBoxes: () => [],
      projectLights: () => [{ x: 1 }],
      isLight2d: (k) => k === 'light2d',
      drawDarkness: (c, opts) => { drawn = opts; }
    };
    const out = D.drawFrame(r.ctx, baseView({
      scene: { bgColor: '#000000', worldWidth: 800, worldHeight: 600, darkness: 0.5, darknessColor: '#000000' }
    }), baseHooks({ light2d, getDarkCanvas: () => ({ getContext: () => ({}) }) }));
    return !!out && drawn && drawn.darkness === 0.5 && drawn.width === 800 && drawn.height === 600;
  })());
check('darkness 0 skips the overlay and never asks for a dark canvas',
  (() => {
    const r = recCtx();
    let asked = 0;
    let drawn = 0;
    const light2d = {
      normalizeSceneDarkness: () => {},
      collectLights2d: () => [], occluderBoxes: () => [], projectLights: () => [],
      isLight2d: () => false,
      drawDarkness: () => { drawn++; }
    };
    D.drawFrame(r.ctx, baseView({
      scene: { bgColor: '#000000', worldWidth: 800, worldHeight: 600, darkness: 0 }
    }), baseHooks({ light2d, getDarkCanvas: () => { asked++; return {}; } }));
    return asked === 0 && drawn === 0;
  })());
check('darkness with no dark canvas degrades silently',
  (() => {
    const r = recCtx();
    const light2d = {
      normalizeSceneDarkness: () => {},
      collectLights2d: () => { throw new Error('boom'); },
      occluderBoxes: () => [], projectLights: () => [],
      isLight2d: () => false, drawDarkness: () => {}
    };
    const out = D.drawFrame(r.ctx, baseView({
      scene: { bgColor: '#000000', worldWidth: 800, worldHeight: 600, darkness: 0.5 }
    }), baseHooks({ light2d, getDarkCanvas: () => null }));
    return !!out;
  })());
check('HUD objects draw after world objects and ignore the camera',
  (() => {
    const r = recCtx();
    const out = D.drawFrame(r.ctx, baseView({
      camera: { x: 100, y: 0, zoom: 1 },
      objects: [sprite(1), sprite(2, { hud: true, color: '#0000ff' })]
    }), baseHooks());
    const red = r.log.findIndex(e => e.call === 'fillRect' && e.fillStyle === '#ff0000');
    const blue = r.log.findIndex(e => e.call === 'fillRect' && e.fillStyle === '#0000ff');
    const tr = calls(r.log, 'translate');
    return out.draws2d === 2 && red !== -1 && blue !== -1 && red < blue &&
      tr.some(e => e.args[0] === 20 && e.args[1] === 120) &&
      tr.some(e => e.args[0] === 120 && e.args[1] === 120);
  })());
check('screen flash draws the fullscreen wash at the module alpha',
  (() => {
    const r = recCtx();
    const out = D.drawFrame(r.ctx, baseView({
      flash: { a: 0.5, color: '#00ff00' }
    }), baseHooks({ cameraFx: { shakeOffset: () => ({ x: 0, y: 0 }), flashAlpha: (f) => (f && f.a) || 0 } }));
    const wash = fills(r.log, '#00ff00');
    return !!out && wash.length === 1 && wash[0].globalAlpha === 0.5 &&
      JSON.stringify(wash[0].args) === JSON.stringify([0, 0, 800, 600]);
  })());
check('no flash means no wash on top of the background',
  (() => {
    const r = recCtx();
    D.drawFrame(r.ctx, baseView({ scene: { bgColor: '#000000', worldWidth: 800, worldHeight: 600 } }), baseHooks());
    // The only fullscreen fillRect is the black background; no wash
    // ever sets a globalAlpha above 0 on a fullscreen rect.
    return calls(r.log, 'fillRect').every(e => e.globalAlpha === undefined || e.globalAlpha === 1);
  })());
check('profiler records the frame counts and paints the overlay',
  (() => {
    const r = recCtx();
    let noted = null;
    let overlaid = 0;
    const prof = {};
    D.drawFrame(r.ctx, baseView({
      objects: [sprite(1), sprite(2, { color: '#00ff00' })],
      particles: { particles: [{}, {}] },
      profiler: prof
    }), baseHooks({ profile: {
      noteDraws: (p, d2, t3, lp, lo) => { noted = { p, d2, t3, lp, lo }; },
      drawOverlay: () => { overlaid++; }
    } }));
    return noted && noted.p === prof && noted.d2 === 2 && noted.t3 === 0 &&
      noted.lp === 2 && noted.lo === 2 && overlaid === 1;
  })());
check('onFrameEnd receives the frame result',
  (() => {
    const r = recCtx();
    let got = null;
    const out = D.drawFrame(r.ctx, baseView({ objects: [sprite(1)] }),
      baseHooks({ onFrameEnd: (res) => { got = res; } }));
    return got && got.draws2d === 1 && got.tris3d === 0 && got.camera && out === got;
  })());
check('drawLabel fires for a labelled sprite with its center',
  (() => {
    const r = recCtx();
    let got = null;
    D.drawFrame(r.ctx, baseView({
      objects: [sprite(1, { showLabel: true, name: 'Hero' })]
    }), baseHooks({ drawLabel: (c, o, info) => { got = { o, info }; } }));
    return got && got.o.name === 'Hero' && got.info.cx === 120 && got.info.cy === 120;
  })());
check('a throwing image hook falls back to the color rect',
  (() => {
    const r = recCtx();
    const out = D.drawFrame(r.ctx, baseView({ objects: [sprite(1)] }),
      baseHooks({ image: () => { throw new Error('boom'); } }));
    return out.draws2d === 1 && fills(r.log, '#ff0000').length === 1;
  })());

// --- static routing: both runtimes delegate, the module loads first ---
const prSrc = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'player-runtime.js'), 'utf8');
const scSrc = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'script.js'), 'utf8');
const ixSrc = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'index.html'), 'utf8');
for (const gone of ['function drawAny(', 'function drawTilemap(state', 'function drawPanel(state',
    'function drawText(state', 'function drawObject(state', 'function drawFitted(',
    'function renderCamera(state', 'function widgetScreenPos(', 'function isScreenFixedObj(',
    'function roundedRectPath(', 'function drawScaleOf(', 'function applyDrawTransform(']) {
  check(`export no longer carries its own ${gone}`, !prSrc.includes(gone));
}
check('export delegates its draw to HydraDraw', prSrc.includes('HydraDraw.drawFrame(state.ctx'));
check('export keeps the thin draw wrapper + view/hooks builders',
  prSrc.includes('function draw(state)') && prSrc.includes('function drawView(state)') &&
  prSrc.includes('function drawHooks(state)') && prSrc.includes('function buttonUiState('));
check('export hard-guards on HydraDraw', prSrc.includes('requires hydra-draw.js'));
check('export inlines HydraDraw via sharedSources', prSrc.includes("['HydraDraw',"));
for (const gone of ['function drawPreviewTilemap(', 'function drawPreviewText(',
    'function drawPreviewPanel(', 'function drawPreviewSprite(',
    'function previewRoundedRectPath(', 'function drawImageInObject(', 'function drawScaleOf(']) {
  check(`preview no longer carries its own ${gone}`, !scSrc.includes(gone));
}
check('preview delegates drawGame to HydraDraw', scSrc.includes('window.HydraDraw.drawFrame(ctx'));
check('preview keeps the thin drawGame view/hooks builders',
  scSrc.includes('function drawGameView()') && scSrc.includes('function drawGameHooks()'));
check('preview keeps the label + toolbar-sync hooks',
  scSrc.includes('drawLabel:') && scSrc.includes('onFrameEnd:'));
check('index.html loads hydra-draw.js before player-runtime.js and script.js',
  ixSrc.includes('src="hydra-draw.js') &&
  ixSrc.indexOf('src="hydra-draw.js') < ixSrc.indexOf('src="player-runtime.js') &&
  ixSrc.indexOf('src="hydra-draw.js') < ixSrc.indexOf('src="script.js'));

if (failures) { console.error(`${failures} assertion(s) failed`); process.exit(1); }
console.log('draw.test.js: all assertions passed');
