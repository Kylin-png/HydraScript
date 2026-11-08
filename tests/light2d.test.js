// Unit tests for hydra/hydra-light2d.js — the shared 2D lighting +
// shadow module.
//
// Pure logic: light-record normalization, scene darkness normalization,
// light collection (centers, enabled-skip, value repair), occluder boxes,
// the silhouette-extrusion shadow polygon (including the atan2
// wraparound case), world-to-screen projection, the darkness overlay
// painter on a recording canvas context, and the Set Darkness / Set Light
// / Darkness Level block dispatch through host hooks. Nothing here touches
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
sandbox.window = sandbox; // hydra-light2d.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-light2d.js'), 'utf8'),
  sandbox, { filename: 'hydra-light2d.js' });
const L2 = sandbox.HydraLight2d;

check('HydraLight2d exposed with helpers',
  !!L2 && typeof L2.isLight2d === 'function' && typeof L2.normalizeLight2d === 'function' &&
  typeof L2.normalizeSceneDarkness === 'function' && typeof L2.collectLights2d === 'function' &&
  typeof L2.occluderBoxes === 'function' && typeof L2.shadowPolygon === 'function' &&
  typeof L2.projectLights === 'function' && typeof L2.hexToRgba === 'function' &&
  typeof L2.drawDarkness === 'function' && typeof L2.applyLight2dAction === 'function' &&
  typeof L2.evalLight2dCondition === 'function' && typeof L2.isLight2dAction === 'function' &&
  typeof L2.isLight2dCondition === 'function');
check('factorySource is a self-contained function string',
  typeof L2.factorySource === 'string' && L2.factorySource.includes('hydraLight2dFactory'));
check('LIGHT2D_KIND is light2d', L2.LIGHT2D_KIND === 'light2d');
check('DEFAULT_RADIUS is 220', L2.DEFAULT_RADIUS === 220);
check('isLight2d matches only light2d',
  L2.isLight2d('light2d') === true && L2.isLight2d('light3d') === false && L2.isLight2d('sprite') === false);

// ---------- normalizeLight2d ----------
{
  const o = { kind: 'light2d', posX: 0, posY: 0, width: 54, height: 54 };
  const l = L2.normalizeLight2d(o);
  check('normalizeLight2d creates a default record',
    !!l && l.enabled === true && l.radius === 220 && l.color === '#ffffff' && l.intensity === 1,
    JSON.stringify(l));
  check('normalizeLight2d defaults castShadow to false', o.castShadow === false);
  const bad = { light: { enabled: 'yes', radius: -5, color: 'red', intensity: 9 }, castShadow: 'maybe' };
  L2.normalizeLight2d(bad);
  check('normalizeLight2d repairs bad values',
    bad.light.enabled === true && bad.light.radius === 0 && bad.light.color === '#ffffff' &&
    bad.light.intensity === 1 && bad.castShadow === false, JSON.stringify(bad.light));
  const junk = { light: { radius: NaN, intensity: Infinity } };
  L2.normalizeLight2d(junk);
  check('normalizeLight2d repairs non-finite radius/intensity',
    junk.light.radius === 220 && junk.light.intensity === 1, JSON.stringify(junk.light));
  check('normalizeLight2d never throws on hostile input',
    L2.normalizeLight2d(null) === null && L2.normalizeLight2d('x') === null &&
    L2.normalizeLight2d(42) === null);
}

// ---------- normalizeSceneDarkness ----------
{
  const s = {};
  L2.normalizeSceneDarkness(s);
  check('normalizeSceneDarkness defaults to day',
    s.darkness === 0 && s.darknessColor === '#000000', JSON.stringify(s));
  const bad = { darkness: 2.5, darknessColor: 'blue' };
  L2.normalizeSceneDarkness(bad);
  check('normalizeSceneDarkness clamps + repairs',
    bad.darkness === 1 && bad.darknessColor === '#000000', JSON.stringify(bad));
  const neg = { darkness: -0.4 };
  L2.normalizeSceneDarkness(neg);
  check('normalizeSceneDarkness clamps negatives to 0', neg.darkness === 0);
  check('normalizeSceneDarkness never throws on hostile input',
    L2.normalizeSceneDarkness(null) === null && L2.normalizeSceneDarkness('x') === 'x');
}

// ---------- collectLights2d ----------
{
  const objs = [
    { name: 'torch', kind: 'light2d', posX: 100, posY: 100, width: 54, height: 54,
      light: { enabled: true, radius: 200, color: '#ffcc88', intensity: 0.8 } },
    { name: 'off', kind: 'light2d', posX: 0, posY: 0, width: 54, height: 54,
      light: { enabled: false, radius: 200, color: '#ffffff', intensity: 1 } },
    { name: 'plain', kind: 'sprite', posX: 0, posY: 0, width: 40, height: 40 },
    { name: 'bad', kind: 'sprite', posX: 50, posY: 60, width: 20, height: 20,
      light: { enabled: true, radius: 'junk', color: 'nope', intensity: -1 } },
    null, 'junk'
  ];
  const lights = L2.collectLights2d(objs);
  check('collectLights2d keeps enabled lights only',
    lights.length === 2, JSON.stringify(lights));
  check('collectLights2d centers on the object',
    lights[0].x === 127 && lights[0].y === 127 && lights[0].radius === 200 &&
    lights[0].color === '#ffcc88' && lights[0].intensity === 0.8, JSON.stringify(lights[0]));
  check('collectLights2d repairs bad light values',
    lights[1].radius === 220 && lights[1].color === '#ffffff' && lights[1].intensity === 0,
    JSON.stringify(lights[1]));
  check('collectLights2d never throws on hostile input',
    Array.isArray(L2.collectLights2d(null)) && L2.collectLights2d(null).length === 0 &&
    Array.isArray(L2.collectLights2d('x')) && L2.collectLights2d('x').length === 0);
}

// ---------- occluderBoxes ----------
{
  const objs = [
    { name: 'wall', posX: 10, posY: 20, width: 30, height: 40, castShadow: true },
    { name: 'ghost', posX: 0, posY: 0, width: 30, height: 40, castShadow: false },
    { name: 'flat', posX: 0, posY: 0, width: 0, height: 40, castShadow: true },
    { name: 'nope', posX: NaN, posY: 0, width: 30, height: 40, castShadow: true },
    null
  ];
  const boxes = L2.occluderBoxes(objs);
  check('occluderBoxes keeps real cast-shadow boxes only',
    boxes.length === 1 && boxes[0].x === 10 && boxes[0].y === 20 &&
    boxes[0].w === 30 && boxes[0].h === 40, JSON.stringify(boxes));
  check('occluderBoxes never throws on hostile input',
    L2.occluderBoxes(null).length === 0 && L2.occluderBoxes('x').length === 0);
}

// ---------- shadowPolygon ----------
{
  // Light left of the box: shadow stretches right.
  const p1 = L2.shadowPolygon(-100, 50, { x: 0, y: 0, w: 10, h: 100 }, 200);
  check('shadowPolygon returns a 4-point polygon',
    Array.isArray(p1) && p1.length === 4, JSON.stringify(p1));
  check('shadowPolygon stretches away from the light',
    p1 && p1[2].x > 10 && p1[3].x > 10 && p1[2].x > p1[0].x && p1[3].x > p1[1].x,
    JSON.stringify(p1));
  check('shadowPolygon far points sit at range along the ray',
    p1 && Math.abs(Math.hypot(p1[2].x - p1[1].x, p1[2].y - p1[1].y) - 200) < 0.01 &&
    Math.abs(Math.hypot(p1[3].x - p1[0].x, p1[3].y - p1[0].y) - 200) < 0.01, JSON.stringify(p1));
  // Light right of the box: the atan2 wraparound case — silhouette must
  // be the RIGHT corners (10,0)/(10,100), shadow stretches left.
  const p2 = L2.shadowPolygon(100, 50, { x: 0, y: 0, w: 10, h: 100 }, 200);
  const nearXs = [p2[0].x, p2[1].x].sort((a, b) => a - b);
  check('shadowPolygon handles the left-of-light wraparound',
    p2 && nearXs[0] === 10 && nearXs[1] === 10 && p2[2].x < 10 && p2[3].x < 10,
    JSON.stringify(p2));
  // Light above the box: shadow stretches down.
  const p3 = L2.shadowPolygon(5, -100, { x: 0, y: 0, w: 10, h: 100 }, 150);
  check('shadowPolygon stretches down from a light above',
    p3 && p3[2].y > 100 && p3[3].y > 100, JSON.stringify(p3));
  check('shadowPolygon returns null for a light inside the box',
    L2.shadowPolygon(5, 50, { x: 0, y: 0, w: 10, h: 100 }, 200) === null);
  check('shadowPolygon returns null for degenerate/hostile input',
    L2.shadowPolygon(0, 0, { x: 0, y: 0, w: 0, h: 10 }, 100) === null &&
    L2.shadowPolygon(0, 0, { x: 0, y: 0, w: 10, h: 10 }, 0) === null &&
    L2.shadowPolygon(0, 0, null, 100) === null &&
    L2.shadowPolygon(NaN, 0, { x: 0, y: 0, w: 10, h: 10 }, 100) === null);
}

// ---------- projectLights ----------
{
  const lights = [{ x: 127, y: 127, radius: 200, color: '#ffffff', intensity: 1 }];
  const boxes = [{ x: 200, y: 100, w: 40, h: 40 }];
  const proj = L2.projectLights(lights, boxes, 100, 100, 2);
  check('projectLights converts to screen space with zoom',
    proj.length === 1 && proj[0].x === 54 && proj[0].y === 54 && proj[0].radius === 400,
    JSON.stringify(proj[0]));
  check('projectLights attaches shadow polygons in screen space',
    proj[0].shadows.length === 1 && proj[0].shadows[0].length === 4 &&
    proj[0].shadows[0][0].x === (200 - 100) * 2, JSON.stringify(proj[0].shadows[0][0]));
  check('projectLights never throws on hostile input',
    L2.projectLights(null, null, 0, 0, 1).length === 0 &&
    L2.projectLights([{ x: 'a', y: 0, radius: 10 }], [], 0, 0, 1).length === 1);
}

// ---------- hexToRgba ----------
{
  check('hexToRgba converts #rrggbb + alpha',
    L2.hexToRgba('#ff8000', 0.5) === 'rgba(255,128,0,0.5)');
  check('hexToRgba falls back to black on bad input',
    L2.hexToRgba('red', 0.5) === 'rgba(0,0,0,0.5)' &&
    L2.hexToRgba(null, 0.5) === 'rgba(0,0,0,0.5)');
}

// ---------- drawDarkness (recording fake ctx) ----------
function makeRecordingCtx() {
  const ops = [];
  const grads = [];
  const ctx = {
    ops, grads,
    save() { ops.push('save'); },
    restore() { ops.push('restore'); },
    fillRect(x, y, w, h) { ops.push(['fillRect', x, y, w, h]); },
    drawImage() { ops.push('drawImage'); },
    beginPath() { ops.push('beginPath'); },
    moveTo(x, y) { ops.push(['moveTo', x, y]); },
    lineTo(x, y) { ops.push(['lineTo', x, y]); },
    closePath() { ops.push('closePath'); },
    fill() { ops.push('fill'); },
    createRadialGradient(x0, y0, r0, x1, y1, r1) {
      const g = { stops: [], addColorStop(o, c) { this.stops.push([o, c]); } };
      grads.push(['gradient', x0, y0, r0, x1, y1, r1, g]);
      return g;
    }
  };
  return new Proxy(ctx, {
    set(t, p, v) { t[p] = v; ops.push(['set', p, v]); return true; },
    get(t, p) { return t[p]; }
  });
}
function makeDarkCanvas(recCtx) {
  return {
    width: 0, height: 0,
    getContext: () => recCtx
  };
}
{
  const main = makeRecordingCtx();
  const dark = makeRecordingCtx();
  const dc = makeDarkCanvas(dark);
  const ok = L2.drawDarkness(main, {
    width: 800, height: 600, darkness: 0.8, color: '#000000',
    darkCanvas: dc,
    lights: [{ x: 400, y: 300, radius: 200, color: '#ffcc88', intensity: 1,
      shadows: [[{ x: 500, y: 280 }, { x: 500, y: 320 }, { x: 700, y: 330 }, { x: 700, y: 270 }]] }]
  });
  check('drawDarkness paints and returns true', ok === true);
  check('drawDarkness resizes the offscreen canvas',
    dc.width === 800 && dc.height === 600);
  check('drawDarkness fills the darkness first',
    dark.ops.some(o => Array.isArray(o) && o[0] === 'fillRect' && o[1] === 0 && o[2] === 0 &&
      o[3] === 800 && o[4] === 600), JSON.stringify(dark.ops.slice(0, 6)));
  check('drawDarkness erases with destination-out',
    dark.ops.some(o => Array.isArray(o) && o[0] === 'set' && o[1] === 'globalCompositeOperation' &&
      o[2] === 'destination-out'), JSON.stringify(dark.ops));
  check('drawDarkness punches one gradient per light',
    dark.grads.length === 2, JSON.stringify(dark.grads.map(g => g.slice(0, 7))));
  check('drawDarkness fills shadow polygons',
    dark.ops.filter(o => o === 'fill').length >= 1, JSON.stringify(dark.ops));
  check('drawDarkness stamps the offscreen canvas onto the main ctx',
    main.ops.includes('drawImage'), JSON.stringify(main.ops));
  check('drawDarkness skips when darkness is 0',
    L2.drawDarkness(makeRecordingCtx(), {
      width: 800, height: 600, darkness: 0, color: '#000000',
      darkCanvas: makeDarkCanvas(makeRecordingCtx()), lights: []
    }) === false);
  check('drawDarkness skips without a usable offscreen canvas',
    L2.drawDarkness(makeRecordingCtx(), {
      width: 800, height: 600, darkness: 0.8, color: '#000000',
      darkCanvas: null, lights: []
    }) === false);
  check('drawDarkness never throws on hostile input',
    L2.drawDarkness(null, null) === false &&
    L2.drawDarkness(makeRecordingCtx(), 'junk') === false &&
    L2.drawDarkness(makeRecordingCtx(), { width: -1, height: 0, darkness: 0.5 }) === false);
}

// ---------- applyLight2dAction ----------
{
  const scene = {};
  const torch = { name: 'torch', kind: 'light2d', posX: 0, posY: 0, width: 54, height: 54 };
  const warns = [];
  const hooks = {
    targets: () => [torch],
    num: (raw) => {
      const v = Number(raw);
      return { ok: isFinite(v), value: v };
    },
    warn: (m) => warns.push(m),
    scene: () => scene
  };
  L2.applyLight2dAction({ type: 'setDarkness', darkness: '0.7' }, hooks);
  check('setDarkness writes the live scene darkness', scene.darkness === 0.7,
    JSON.stringify(scene));
  L2.applyLight2dAction({ type: 'setDarkness', darkness: '2' }, hooks);
  check('setDarkness clamps above 1', scene.darkness === 1);
  warns.length = 0;
  L2.applyLight2dAction({ type: 'setDarkness', darkness: 'junk' }, hooks);
  check('setDarkness warns and holds on bad values',
    warns.length === 1 && scene.darkness === 1, JSON.stringify(warns));
  L2.applyLight2dAction({ type: 'setLight2d', radius: '150', color: '#ff0000', mode: 'on' }, hooks);
  check('setLight2d writes the light record',
    torch.light && torch.light.radius === 150 && torch.light.color === '#ff0000' &&
    torch.light.enabled === true, JSON.stringify(torch.light));
  warns.length = 0;
  L2.applyLight2dAction({ type: 'setLight2d', radius: '-3', color: '#ff0000', mode: 'on' }, hooks);
  check('setLight2d warns and holds on bad radius',
    warns.length === 1 && torch.light.radius === 150, JSON.stringify(warns));
  warns.length = 0;
  L2.applyLight2dAction({ type: 'setLight2d', radius: '150', color: 'red', mode: 'on' }, hooks);
  check('setLight2d warns and holds on bad color',
    warns.length === 1 && torch.light.color === '#ff0000', JSON.stringify(warns));
  warns.length = 0;
  L2.applyLight2dAction({ type: 'setLight2d', radius: '150', color: '#ff0000', mode: 'blink' }, hooks);
  check('setLight2d warns and holds on bad mode',
    warns.length === 1 && torch.light.enabled === true, JSON.stringify(warns));
  L2.applyLight2dAction({ type: 'setLight2d', radius: '150', color: '#00ff00', mode: 'off' }, hooks);
  check('setLight2d off disables the light',
    torch.light.enabled === false && torch.light.color === '#00ff00');
  const quietHooks = { targets: () => [], num: hooks.num, warn: (m) => warns.push(m), scene: () => scene };
  warns.length = 0;
  L2.applyLight2dAction({ type: 'setLight2d', radius: '150', color: '#ffffff', mode: 'on' }, quietHooks);
  check('setLight2d stays quiet with no targets', warns.length === 0);
  check('applyLight2dAction never throws on hostile input',
    (() => { try { L2.applyLight2dAction(null, null); L2.applyLight2dAction({ type: 'setDarkness' }, null); return true; } catch (e) { return false; } })());
  check('isLight2dAction / isLight2dCondition match the block types',
    L2.isLight2dAction('setDarkness') === true && L2.isLight2dAction('setLight2d') === true &&
    L2.isLight2dAction('setBlend') === false &&
    L2.isLight2dCondition('darknessLevel') === true && L2.isLight2dCondition('blendActive') === false);
}

// ---------- evalLight2dCondition ----------
{
  const hooks = {
    num: (raw) => {
      const v = Number(raw);
      return { ok: isFinite(v), value: v };
    },
    darkness: () => 0.8
  };
  check('darknessLevel >= fires when dark enough',
    L2.evalLight2dCondition({ type: 'darknessLevel', darkness: '0.5', operator: '>=' }, hooks).pass === true);
  check('darknessLevel <= stays quiet when too dark',
    L2.evalLight2dCondition({ type: 'darknessLevel', darkness: '0.5', operator: '<=' }, hooks).pass === false);
  check('darknessLevel == / != / < / > operators',
    L2.evalLight2dCondition({ type: 'darknessLevel', darkness: '0.8', operator: '==' }, hooks).pass === true &&
    L2.evalLight2dCondition({ type: 'darknessLevel', darkness: '0.8', operator: '!=' }, hooks).pass === false &&
    L2.evalLight2dCondition({ type: 'darknessLevel', darkness: '0.9', operator: '<' }, hooks).pass === true &&
    L2.evalLight2dCondition({ type: 'darknessLevel', darkness: '0.9', operator: '>' }, hooks).pass === false);
  check('darknessLevel stays quiet on bad data',
    L2.evalLight2dCondition({ type: 'darknessLevel', darkness: 'junk', operator: '>=' }, hooks).pass === false &&
    L2.evalLight2dCondition({ type: 'darknessLevel', darkness: '0.5', operator: 'near' }, hooks).pass === false &&
    L2.evalLight2dCondition({ type: 'other' }, hooks).pass === false);
  check('evalLight2dCondition never throws on hostile input',
    L2.evalLight2dCondition(null, null).pass === false &&
    L2.evalLight2dCondition({ type: 'darknessLevel' }, null).pass === false);
}

if (failures) { console.error(`${failures} assertion(s) failed`); process.exit(1); }
console.log('light2d.test.js: all assertions passed');
