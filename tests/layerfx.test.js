// Unit tests for hydra/hydra-layerfx.js — the shared layers/effects module.
//
// Pure logic: relative layer moves, blend/filter mappings, draw-time effect
// application on a stub canvas context, the action + condition dispatches,
// hostile-input safety. Nothing here touches the DOM; both runtimes delegate
// to this module.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const sandbox = {};
sandbox.window = sandbox; // hydra-layerfx.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-layerfx.js'), 'utf8'),
  sandbox, { filename: 'hydra-layerfx.js' });
const L = sandbox.HydraLayerFx;

check('HydraLayerFx exposed with dispatchers',
  !!L && typeof L.applyLayerFxAction === 'function' &&
  typeof L.evalLayerFxCondition === 'function');
check('factorySource is a self-contained function string',
  typeof L.factorySource === 'string' && L.factorySource.includes('hydraLayerFxFactory'));
check('8 action types registered',
  L.ACTION_TYPES.length === 8 &&
  ['bringToFront', 'sendToBack', 'moveLayerUp', 'moveLayerDown',
   'setBlendMode', 'setShadow', 'setVisualEffect', 'clearEffects']
    .every(t => L.isLayerFxAction(t)) &&
  !L.isLayerFxAction('setLayer') && !L.isLayerFxAction('setOpacity'));
check('1 condition type registered',
  L.CONDITION_TYPES.length === 1 && L.isLayerFxCondition('layerCheck') &&
  !L.isLayerFxCondition('positionCheck'));

// ---------- layer helpers ----------
check('layerOf reads numbers', L.layerOf({ layer: 3 }) === 3);
check('layerOf missing -> 0', L.layerOf({}) === 0);
check('layerOf hostile -> 0', L.layerOf({ layer: 'junk' }) === 0 && L.layerOf(null) === 0 &&
  L.layerOf({ layer: NaN }) === 0);

{
  const a = { layer: 1 }, b = { layer: 5 }, c = { layer: -2 };
  const o = { layer: 5 };
  L.bringToFront([a, b, c, o], o);
  check('bringToFront moves above the max', o.layer === 6, `layer=${o.layer}`);
}
{
  const o = {};
  L.bringToFront([], o);
  check('bringToFront on empty scene -> 1', o.layer === 1, `layer=${o.layer}`);
}
{
  const a = { layer: 1 }, b = { layer: 5 }, c = { layer: -2 };
  const o = { layer: -2 };
  L.sendToBack([a, b, c, o], o);
  check('sendToBack moves below the min', o.layer === -3, `layer=${o.layer}`);
}
{
  const a = { layer: -5 }, b = { layer: -3 };
  const o = { layer: -3 };
  L.bringToFront([a, b, o], o);
  check('bringToFront with all-negative layers -> max + 1', o.layer === -2, `layer=${o.layer}`);
}
{
  const a = { layer: 2 }, b = { layer: 7 };
  const o = { layer: 2 };
  L.sendToBack([a, b, o], o);
  check('sendToBack with all-positive layers -> min - 1', o.layer === 1, `layer=${o.layer}`);
}
{
  const o = {};
  L.sendToBack([], o);
  check('sendToBack on empty scene -> -1', o.layer === -1, `layer=${o.layer}`);
}
{
  const o = { layer: 4 };
  L.shiftLayer(o, 2);
  check('shiftLayer adds', o.layer === 6, `layer=${o.layer}`);
  L.shiftLayer(o, -10);
  check('shiftLayer subtracts past zero', o.layer === -4, `layer=${o.layer}`);
  L.shiftLayer(o, 'junk');
  check('shiftLayer hostile delta is a no-op', o.layer === -4, `layer=${o.layer}`);
}
check('bringToFront ignores null entries', (() => {
  const o = { layer: 2 };
  L.bringToFront([null, 'x', { layer: 9 }], o);
  return o.layer === 10;
})());
check('bringToFront with a null target never throws', (() => {
  try { L.bringToFront([{ layer: 1 }], null); return true; } catch (e) { return false; }
})());

// ---------- mappings ----------
check('blendCompositeOf maps every select value',
  L.blendCompositeOf('normal') === 'source-over' &&
  L.blendCompositeOf('add') === 'lighter' &&
  L.blendCompositeOf('multiply') === 'multiply' &&
  L.blendCompositeOf('screen') === 'screen' &&
  L.blendCompositeOf('overlay') === 'overlay' &&
  L.blendCompositeOf('difference') === 'difference');
check('blendCompositeOf unknown -> source-over',
  L.blendCompositeOf('plasma') === 'source-over' && L.blendCompositeOf() === 'source-over' &&
  L.blendCompositeOf(null) === 'source-over');
check('filterOf maps every select value',
  L.filterOf('none') === 'none' &&
  L.filterOf('grayscale') === 'grayscale(100%)' &&
  L.filterOf('sepia') === 'sepia(100%)' &&
  L.filterOf('invert') === 'invert(100%)' &&
  L.filterOf('brighten') === 'brightness(1.6)' &&
  L.filterOf('dim') === 'brightness(0.55)' &&
  L.filterOf('blur') === 'blur(3px)');
check('filterOf unknown -> none',
  L.filterOf('vhs') === 'none' && L.filterOf() === 'none');
check('shadowBlurOf clamps 0-64', L.shadowBlurOf(8) === 8 && L.shadowBlurOf(100) === 64 &&
  L.shadowBlurOf(0) === 0 && L.shadowBlurOf(-5) === 0 && L.shadowBlurOf('junk') === 0);

// ---------- applyObjectEffects ----------
function stubCtx() {
  return {
    globalCompositeOperation: 'source-over',
    shadowColor: 'rgba(0,0,0,0)', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
    filter: 'none'
  };
}
{
  const ctx = stubCtx();
  L.applyObjectEffects(ctx, {});
  check('no effect fields leaves the context untouched',
    ctx.globalCompositeOperation === 'source-over' && ctx.shadowBlur === 0 && ctx.filter === 'none');
}
{
  const ctx = stubCtx();
  L.applyObjectEffects(ctx, { blendMode: 'add' });
  check('blend add -> lighter', ctx.globalCompositeOperation === 'lighter',
    `op=${ctx.globalCompositeOperation}`);
}
{
  const ctx = stubCtx();
  L.applyObjectEffects(ctx, { shadowColor: '#ff0000', shadowBlur: 12, shadowOffsetX: 3, shadowOffsetY: -2 });
  check('shadow fields applied', ctx.shadowColor === '#ff0000' && ctx.shadowBlur === 12 &&
    ctx.shadowOffsetX === 3 && ctx.shadowOffsetY === -2, JSON.stringify(ctx));
}
{
  const ctx = stubCtx();
  L.applyObjectEffects(ctx, { shadowColor: '#ff0000', shadowBlur: 0 });
  check('blur 0 means no shadow', ctx.shadowBlur === 0 && ctx.shadowColor === 'rgba(0,0,0,0)');
}
{
  const ctx = stubCtx();
  L.applyObjectEffects(ctx, { shadowColor: '#00ff00', shadowBlur: 200 });
  check('blur clamps at 64', ctx.shadowBlur === 64, `blur=${ctx.shadowBlur}`);
}
{
  const ctx = stubCtx();
  L.applyObjectEffects(ctx, { visualEffect: 'grayscale' });
  check('grayscale filter applied', ctx.filter === 'grayscale(100%)', `filter=${ctx.filter}`);
}
{
  const ctx = stubCtx();
  L.applyObjectEffects(ctx, { visualEffect: 'sepia', blendMode: 'bogus', shadowColor: 42, shadowBlur: 'junk' });
  check('hostile fields fall back safely', ctx.filter === 'sepia(100%)' &&
    ctx.globalCompositeOperation === 'source-over' && ctx.shadowBlur === 0);
}
check('applyObjectEffects never throws on null', (() => {
  try { L.applyObjectEffects(null, null); L.applyObjectEffects(stubCtx(), null); return true; }
  catch (e) { return false; }
})());

// ---------- action dispatch ----------
function makeHooks(targets, allObjects) {
  const warned = [];
  function num(raw) {
    const v = Number(String(raw == null ? '' : raw).trim());
    return { value: v, ok: Number.isFinite(v) };
  }
  return {
    hooks: {
      targets: () => targets.slice(),
      allObjects: () => allObjects.slice(),
      num,
      warn: (m) => warned.push(m)
    },
    warned
  };
}

{
  const a = { layer: 2 }, b = { layer: 7 };
  const { hooks } = makeHooks([a], [a, b]);
  L.applyLayerFxAction({ type: 'bringToFront', targetObject: 'card' }, hooks);
  check('dispatch bringToFront', a.layer === 8, `layer=${a.layer}`);
}
{
  const a = { layer: 2 }, b = { layer: 7 };
  const { hooks } = makeHooks([a], [a, b]);
  L.applyLayerFxAction({ type: 'sendToBack', targetObject: 'bg' }, hooks);
  check('dispatch sendToBack', a.layer === 1, `layer=${a.layer}`);
}
{
  const a = { layer: 2 };
  const { hooks, warned } = makeHooks([a], [a]);
  L.applyLayerFxAction({ type: 'moveLayerUp', targetObject: 'card', steps: 3 }, hooks);
  check('dispatch moveLayerUp with steps', a.layer === 5, `layer=${a.layer}`);
  L.applyLayerFxAction({ type: 'moveLayerDown', targetObject: 'card', steps: 'junk' }, hooks);
  check('dispatch moveLayerDown with bad steps warns and holds', a.layer === 5 && warned.length === 1,
    `layer=${a.layer} warned=${warned.length}`);
}
{
  const a = {};
  const { hooks } = makeHooks([a], [a]);
  L.applyLayerFxAction({ type: 'setBlendMode', targetObject: 'laser', blend: 'add' }, hooks);
  check('dispatch setBlendMode writes the field', a.blendMode === 'add');
}
{
  const a = {};
  const { hooks } = makeHooks([a], [a]);
  L.applyLayerFxAction({ type: 'setShadow', targetObject: 'hero', color: '#123456', blur: 10, offsetX: 1, offsetY: 2 }, hooks);
  check('dispatch setShadow writes fields',
    a.shadowColor === '#123456' && a.shadowBlur === 10 && a.shadowOffsetX === 1 && a.shadowOffsetY === 2,
    JSON.stringify(a));
}
{
  const a = {};
  const { hooks } = makeHooks([a], [a]);
  L.applyLayerFxAction({ type: 'setVisualEffect', targetObject: 'hero', effect: 'grayscale' }, hooks);
  check('dispatch setVisualEffect writes the field', a.visualEffect === 'grayscale');
}
{
  const a = { blendMode: 'add', shadowColor: '#000', shadowBlur: 5, shadowOffsetX: 1, shadowOffsetY: 2, visualEffect: 'dim' };
  const { hooks } = makeHooks([a], [a]);
  L.applyLayerFxAction({ type: 'clearEffects', targetObject: 'hero' }, hooks);
  check('dispatch clearEffects resets every field',
    a.blendMode === undefined && a.shadowColor === undefined && a.shadowBlur === undefined &&
    a.visualEffect === undefined, JSON.stringify(a));
}
check('dispatch unknown type is a silent no-op', (() => {
  const { hooks } = makeHooks([], []);
  try { L.applyLayerFxAction({ type: 'setLayer' }, hooks); return true; } catch (e) { return false; }
})());
check('dispatch with throwing hooks never throws', (() => {
  const bad = { targets() { throw new Error('x'); }, allObjects() { throw new Error('x'); },
    num() { throw new Error('x'); }, warn() { throw new Error('x'); } };
  try {
    L.applyLayerFxAction({ type: 'bringToFront' }, bad);
    L.applyLayerFxAction({ type: 'moveLayerUp', steps: 1 }, bad);
    L.applyLayerFxAction({ type: 'setShadow' }, bad);
    return true;
  } catch (e) { return false; }
})());

// ---------- condition dispatch ----------
{
  const a = { name: 'card', layer: 5 };
  const { hooks } = makeHooks([a], [a]);
  const r = L.evalLayerFxCondition({ type: 'layerCheck', targetObject: 'card', operator: '>=', value: 5 }, hooks);
  check('layerCheck fires on match', r.pass === true && r.context.obj1 === a);
}
{
  const a = { name: 'card', layer: 5 };
  const { hooks } = makeHooks([a], [a]);
  const r = L.evalLayerFxCondition({ type: 'layerCheck', targetObject: 'card', operator: '>', value: 5 }, hooks);
  check('layerCheck quiet on miss', r.pass === false);
}
{
  const a = { name: 'card', layer: 5 };
  const { hooks } = makeHooks([a], [a]);
  const r = L.evalLayerFxCondition({ type: 'layerCheck', targetObject: 'card', operator: '==', value: 5 }, hooks);
  check('layerCheck == works', r.pass === true);
  const r2 = L.evalLayerFxCondition({ type: 'layerCheck', targetObject: 'card', operator: '!=', value: 5 }, hooks);
  check('layerCheck != works', r2.pass === false);
}
{
  const { hooks } = makeHooks([], []);
  const r = L.evalLayerFxCondition({ type: 'layerCheck', targetObject: '', operator: '>=', value: 1 }, hooks);
  check('layerCheck blank name stays quiet', r.pass === false);
}
{
  const a = { name: 'card', layer: 5 };
  const { hooks, warned } = makeHooks([a], [a]);
  const r = L.evalLayerFxCondition({ type: 'layerCheck', targetObject: 'card', operator: '>=', value: 'junk' }, hooks);
  check('layerCheck bad value stays quiet with no warning spam', r.pass === false && warned.length === 0);
}
{
  const a = { name: 'card', layer: 'junk' };
  const { hooks } = makeHooks([a], [a]);
  const r = L.evalLayerFxCondition({ type: 'layerCheck', targetObject: 'card', operator: '==', value: 0 }, hooks);
  check('layerCheck corrupt layer reads as 0', r.pass === true);
}
check('condition dispatch hostile input never throws', (() => {
  const bad = { targets() { throw new Error('x'); }, num() { throw new Error('x'); }, warn() { throw new Error('x'); } };
  try {
    const r1 = L.evalLayerFxCondition(null, bad);
    const r2 = L.evalLayerFxCondition({ type: 'layerCheck' }, bad);
    const r3 = L.evalLayerFxCondition({ type: 'distanceCheck' }, bad);
    return r1.pass === false && r2.pass === false && r3.pass === false;
  } catch (e) { return false; }
})());

process.exit(failures === 0 ? 0 : 1);
