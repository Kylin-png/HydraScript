// Unit tests for hydra/hydra-health.js — the shared health & damage
// system (P4 Advanced batch 21: hit points, beginner edition).
//
// Pure logic: max-health / health normalization, the damage / heal /
// set / set-max writes with their clamps and the died-on-this-hit flag,
// the health-bar geometry / color / draw, and the routing sets. Nothing
// here touches the DOM; both runtimes delegate to this module. Static
// checks at the end pin the wiring: catalog blocks, both runtimes'
// dispatch, the flow trigger modes, the draw hook, and the docs.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HYDRA = path.join(__dirname, '..', 'hydra');
const REPO = path.join(__dirname, '..');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}
function near(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-9); }

// A canvas 2D context that records every call, so the bar draw can be
// pinned without a real canvas.
function recordingCtx() {
  const calls = [];
  return {
    calls,
    fillStyle: '', strokeStyle: '', lineWidth: 0,
    save() { calls.push(['save']); },
    restore() { calls.push(['restore']); },
    scale(x, y) { calls.push(['scale', x, y]); },
    translate(x, y) { calls.push(['translate', x, y]); },
    fillRect(x, y, w, h) { calls.push(['fillRect', x, y, w, h, this.fillStyle]); },
    strokeRect(x, y, w, h) { calls.push(['strokeRect', x, y, w, h, this.strokeStyle]); },
    beginPath() {}, arc() {}, fill() {}, stroke() {}
  };
}

const sandbox = {};
sandbox.window = sandbox; // hydra-health.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-health.js'), 'utf8'),
  sandbox, { filename: 'hydra-health.js' });
const H = sandbox.HydraHealth;

check('HydraHealth exposed with helpers',
  !!H && typeof H.normalizeMaxHealth === 'function' &&
  typeof H.normalizeHealthValue === 'function' &&
  typeof H.normalizeHealth === 'function' &&
  typeof H.healthOf === 'function' &&
  typeof H.healthFraction === 'function' &&
  typeof H.isDead === 'function' &&
  typeof H.damage === 'function' &&
  typeof H.heal === 'function' &&
  typeof H.setHealth === 'function' &&
  typeof H.setMaxHealth === 'function' &&
  typeof H.healthBarRect === 'function' &&
  typeof H.healthBarColor === 'function' &&
  typeof H.drawHealthBar === 'function' &&
  typeof H.isHealthAction === 'function' &&
  typeof H.isHealthCondition === 'function');
check('factorySource is a self-contained function string',
  typeof H.factorySource === 'string' && H.factorySource.includes('hydraHealthFactory'));
check('constants are 100 default max, 1..10000 range, 6px bar, 10px gap',
  H.DEFAULT_MAX_HEALTH === 100 && H.MIN_MAX_HEALTH === 1 && H.MAX_MAX_HEALTH === 10000 &&
  H.BAR_HEIGHT === 6 && H.BAR_GAP === 10 && H.BAR_MIN_WIDTH === 24);

// --- normalization ---
check('normalizeMaxHealth defaults and clamps',
  H.normalizeMaxHealth() === 100 && H.normalizeMaxHealth(null) === 100 &&
  H.normalizeMaxHealth('') === 100 && H.normalizeMaxHealth('abc') === 100 &&
  H.normalizeMaxHealth(NaN) === 100 && H.normalizeMaxHealth({}) === 100 &&
  H.normalizeMaxHealth(0) === 1 && H.normalizeMaxHealth(-5) === 1 &&
  H.normalizeMaxHealth([]) === 1 && H.normalizeMaxHealth(20000) === 10000 &&
  H.normalizeMaxHealth('250') === 250 && H.normalizeMaxHealth(50) === 50);
check('normalizeHealthValue defaults to the max and clamps into 0..max',
  H.normalizeHealthValue(undefined, 100) === 100 &&
  H.normalizeHealthValue(null, 50) === 50 &&
  H.normalizeHealthValue(150, 100) === 100 &&
  H.normalizeHealthValue(-5, 100) === 0 &&
  H.normalizeHealthValue(50, 100) === 50 &&
  H.normalizeHealthValue('abc', 100) === 100 &&
  H.normalizeHealthValue('', 100) === 100 &&
  H.normalizeHealthValue(0, 100) === 0);
check('normalizeHealth repairs in place and returns the same object',
  (() => {
    const o = { maxHealth: 50, health: 80 };
    const back = H.normalizeHealth(o);
    return back === o && o.maxHealth === 50 && o.health === 50 && o.showHealthBar === false;
  })() &&
  (() => {
    const o = {};
    H.normalizeHealth(o);
    return o.maxHealth === 100 && o.health === 100 && o.showHealthBar === false;
  })() &&
  (() => {
    const o = { maxHealth: 'x', health: 'y', showHealthBar: true };
    H.normalizeHealth(o);
    return o.maxHealth === 100 && o.health === 100 && o.showHealthBar === true;
  })() &&
  (() => {
    const o = { maxHealth: 200, health: 30, showHealthBar: 1 };
    H.normalizeHealth(o);
    return o.maxHealth === 200 && o.health === 30 && o.showHealthBar === false;
  })() &&
  H.normalizeHealth(null) === null && H.normalizeHealth(undefined) === null &&
  H.normalizeHealth('nope') === null);

// --- reads ---
check('healthOf returns a fresh record with clamped values',
  (() => {
    const a = H.healthOf({ maxHealth: 200, health: 30 });
    const b = H.healthOf({ health: 999 });
    const c = H.healthOf(null);
    const d = H.healthOf({ maxHealth: 50, health: 80 });
    return a.maxHealth === 200 && a.health === 30 &&
      b.maxHealth === 100 && b.health === 100 &&
      c.maxHealth === 100 && c.health === 100 &&
      d.maxHealth === 50 && d.health === 50;
  })());
check('healthFraction is 0..1 and reads full for a missing object',
  near(H.healthFraction({ maxHealth: 100, health: 25 }), 0.25) &&
  H.healthFraction({ maxHealth: 100, health: 0 }) === 0 &&
  H.healthFraction({ maxHealth: 100, health: 100 }) === 1 &&
  H.healthFraction(null) === 1 &&
  H.healthFraction({ maxHealth: 0, health: 0 }) === 0);
check('isDead reads health 0 and nothing else',
  H.isDead({ maxHealth: 100, health: 0 }) === true &&
  H.isDead({ maxHealth: 100, health: -5 }) === true &&
  H.isDead({ maxHealth: 100, health: 1 }) === false &&
  H.isDead({ maxHealth: 100, health: 100 }) === false &&
  H.isDead(null) === false && H.isDead(undefined) === false);

// --- damage ---
check('damage subtracts and clamps at 0',
  (() => {
    const o = { maxHealth: 100, health: 50 };
    const r1 = H.damage(o, 20);
    return r1.health === 30 && r1.died === false && o.health === 30;
  })() &&
  (() => {
    const o = { maxHealth: 100, health: 10 };
    const r = H.damage(o, 25);
    return r.health === 0 && r.died === true && o.health === 0;
  })());
check('damage reports died exactly on the killing hit',
  (() => {
    const o = { maxHealth: 100, health: 10 };
    const r1 = H.damage(o, 10);
    const r2 = H.damage(o, 10);
    const r3 = H.damage(o, 0);
    return r1.died === true && r2.died === false && r3.died === false &&
      r2.health === 0 && r3.health === 0;
  })());
check('damage ignores bad and negative amounts',
  (() => {
    const o = { maxHealth: 100, health: 50 };
    const r1 = H.damage(o, 'bad');
    const r2 = H.damage(o, -5);
    const r3 = H.damage(o, NaN);
    return r1.health === 50 && r1.died === false &&
      r2.health === 50 && r3.health === 50 && o.health === 50;
  })() &&
  H.damage(null, 10).health === 0 && H.damage(null, 10).died === false &&
  H.damage(undefined, 10).died === false);

// --- heal ---
check('heal adds and clamps at the ceiling',
  (() => {
    const o = { maxHealth: 100, health: 90 };
    const r = H.heal(o, 20);
    return r.health === 100 && o.health === 100;
  })() &&
  (() => {
    const o = { maxHealth: 100, health: 40 };
    const r = H.heal(o, 10);
    return r.health === 50 && o.health === 50;
  })());
check('heal ignores bad and negative amounts',
  (() => {
    const o = { maxHealth: 100, health: 50 };
    H.heal(o, 'bad'); H.heal(o, -5); H.heal(o, NaN);
    return o.health === 50;
  })() &&
  H.heal(null, 10).health === 0);

// --- setHealth / setMaxHealth ---
check('setHealth writes an exact value clamped into 0..max',
  (() => {
    const o = { maxHealth: 100, health: 50 };
    return H.setHealth(o, 30) === 30 && o.health === 30 &&
      H.setHealth(o, 500) === 100 && o.health === 100 &&
      H.setHealth(o, -10) === 0 && o.health === 0;
  })() &&
  (() => {
    const o = { maxHealth: 100, health: 50 };
    return H.setHealth(o, 'bad') === 50 && o.health === 50 &&
      H.setHealth(o, '') === 50;
  })() &&
  H.setHealth(null, 5) === 0);
check('setMaxHealth moves the ceiling and re-clamps the health',
  (() => {
    const o = { maxHealth: 100, health: 80 };
    const r1 = H.setMaxHealth(o, 50);
    return r1.maxHealth === 50 && r1.health === 50 && o.health === 50;
  })() &&
  (() => {
    const o = { maxHealth: 100, health: 50 };
    const r = H.setMaxHealth(o, 200);
    return r.maxHealth === 200 && r.health === 50;
  })() &&
  (() => {
    const o = { maxHealth: 100, health: 50 };
    const r = H.setMaxHealth(o, 'bad');
    return r.maxHealth === 100 && r.health === 50;
  })() &&
  (() => {
    const o = { maxHealth: 100, health: 80 };
    const r = H.setMaxHealth(o, 0);
    return r.maxHealth === 1 && r.health === 1;
  })() &&
  (() => {
    const r = H.setMaxHealth(null, 50);
    return r.maxHealth === 100 && r.health === 100;
  })());

// --- health bar geometry and color ---
check('healthBarRect centers on the object, 10px above the top edge',
  (() => {
    const r = H.healthBarRect({ posX: 100, posY: 200, width: 40, height: 40, maxHealth: 100, health: 25 });
    return r.x === 100 && r.y === 184 && r.w === 40 && r.h === 6 && near(r.fraction, 0.25);
  })() &&
  (() => {
    // A tiny object still gets a readable 24px bar, centered on itself.
    const r = H.healthBarRect({ posX: 100, posY: 200, width: 10, height: 10, maxHealth: 100, health: 100 });
    return r.w === 24 && r.x === 93 && r.y === 184 && r.fraction === 1;
  })() &&
  (() => {
    const r = H.healthBarRect(null);
    return r.w === 24 && r.h === 6 && r.fraction === 1;
  })());
check('healthBarColor is green over half, amber over a quarter, red below',
  H.healthBarColor(1) === '#22c55e' && H.healthBarColor(0.51) === '#22c55e' &&
  H.healthBarColor(0.5) === '#f59e0b' && H.healthBarColor(0.26) === '#f59e0b' &&
  H.healthBarColor(0.25) === '#ef4444' && H.healthBarColor(0) === '#ef4444' &&
  H.healthBarColor(null) === '#22c55e');

// --- health bar draw ---
check('drawHealthBar paints the background, the colored fill, and a border',
  (() => {
    const ctx = recordingCtx();
    const obj = { posX: 100, posY: 200, width: 40, height: 40, maxHealth: 100, health: 80, showHealthBar: true };
    const ok = H.drawHealthBar(ctx, obj, { cx: 120, cy: 220, camX: 0, camY: 0, zoom: 1, fixed: false });
    const fills = ctx.calls.filter(c => c[0] === 'fillRect');
    const strokes = ctx.calls.filter(c => c[0] === 'strokeRect');
    return ok === true &&
      fills.length === 2 &&
      fills[0][1] === 100 && fills[0][2] === 184 && fills[0][3] === 40 && fills[0][4] === 6 &&
      fills[0][5] === 'rgba(0,0,0,0.55)' &&
      fills[1][1] === 100 && fills[1][2] === 184 && fills[1][3] === 32 && fills[1][4] === 6 &&
      fills[1][5] === '#22c55e' &&
      strokes.length === 1 && strokes[0][1] === 100.5 && strokes[0][2] === 184.5;
  })());
check('drawHealthBar follows the camera and the zoom, and stays put when fixed',
  (() => {
    const ctx = recordingCtx();
    const obj = { posX: 100, posY: 200, width: 40, height: 40, maxHealth: 100, health: 100, showHealthBar: true };
    H.drawHealthBar(ctx, obj, { cx: 120, cy: 220, camX: 50, camY: 30, zoom: 1, fixed: false });
    const tr = ctx.calls.filter(c => c[0] === 'translate');
    return tr.length === 1 && tr[0][1] === -50 && tr[0][2] === -30 &&
      ctx.calls.filter(c => c[0] === 'scale').length === 0;
  })() &&
  (() => {
    const ctx = recordingCtx();
    const obj = { posX: 100, posY: 200, width: 40, height: 40, maxHealth: 100, health: 100, showHealthBar: true };
    H.drawHealthBar(ctx, obj, { cx: 120, cy: 220, camX: 50, camY: 30, zoom: 2, fixed: false });
    const sc = ctx.calls.filter(c => c[0] === 'scale');
    return sc.length === 1 && sc[0][1] === 2 && sc[0][2] === 2;
  })() &&
  (() => {
    const ctx = recordingCtx();
    const obj = { posX: 100, posY: 200, width: 40, height: 40, maxHealth: 100, health: 100, showHealthBar: true };
    H.drawHealthBar(ctx, obj, { cx: 120, cy: 220, camX: 50, camY: 30, zoom: 2, fixed: true });
    return ctx.calls.filter(c => c[0] === 'scale').length === 0 &&
      ctx.calls.filter(c => c[0] === 'translate').length === 0;
  })());
check('drawHealthBar stays quiet when the bar is off, the object is dead, or the context cannot draw',
  (() => {
    const off = { posX: 0, posY: 0, width: 40, height: 40, maxHealth: 100, health: 100, showHealthBar: false };
    const dead = { posX: 0, posY: 0, width: 40, height: 40, maxHealth: 100, health: 0, showHealthBar: true };
    const ctx = recordingCtx();
    return H.drawHealthBar(ctx, off, {}) === false &&
      H.drawHealthBar(ctx, dead, {}) === false &&
      H.drawHealthBar(null, off, {}) === false &&
      H.drawHealthBar({}, off, {}) === false &&
      H.drawHealthBar(ctx, null, {}) === false &&
      ctx.calls.filter(c => c[0] === 'fillRect').length === 0;
  })());
check('drawHealthBar reads a missing info record as a centered bar at the origin',
  (() => {
    const ctx = recordingCtx();
    const obj = { posX: 100, posY: 200, width: 40, height: 40, maxHealth: 100, health: 100, showHealthBar: true };
    return H.drawHealthBar(ctx, obj, null) === true &&
      ctx.calls.filter(c => c[0] === 'fillRect').length === 2;
  })());

// --- routing ---
check('routing sets cover the four actions and two conditions',
  H.isHealthAction('damageObject') && H.isHealthAction('healObject') &&
  H.isHealthAction('setHealth') && H.isHealthAction('setMaxHealth') &&
  !H.isHealthAction('healthCheck') && !H.isHealthAction('objectDied') &&
  !H.isHealthAction('damage') && !H.isHealthAction(null) &&
  H.isHealthCondition('healthCheck') && H.isHealthCondition('objectDied') &&
  !H.isHealthCondition('damageObject') && !H.isHealthCondition('setHealth') &&
  !H.isHealthCondition(null));

// --- hostile input ---
check('hostile input degrades to safe defaults',
  H.normalizeMaxHealth([]) === 1 &&
  H.normalizeHealthValue([], 100) === 0 &&
  H.healthOf('nope').health === 100 &&
  H.healthFraction('nope') === 1 &&
  H.isDead('nope') === false &&
  H.damage('nope', 10).died === false &&
  H.heal('nope', 10).health === 0 &&
  H.setHealth('nope', 5) === 0 &&
  H.setMaxHealth('nope', 50).maxHealth === 100 &&
  H.healthBarRect('nope').fraction === 1 &&
  H.healthBarColor('nope') === '#22c55e' &&
  H.drawHealthBar(null, null, null) === false);

// --- static wiring ---
{
  const html = fs.readFileSync(path.join(HYDRA, 'index.html'), 'utf8');
  const healthTag = html.indexOf('src="hydra-health.js');
  check('index.html loads hydra-health.js before player-runtime.js and script.js',
    healthTag !== -1 && healthTag < html.indexOf('src="player-runtime.js') && healthTag < html.indexOf('src="script.js'));
  check('index.html loads hydra-health.js after hydra-joystick.js',
    healthTag > html.indexOf('src="hydra-joystick.js'));
  const playerJs = fs.readFileSync(path.join(HYDRA, 'player-runtime.js'), 'utf8');
  check('player-runtime.js hard-guards on HydraHealth',
    playerJs.includes("if (!HydraHealth || typeof HydraHealth.normalizeHealth !== 'function')") &&
    playerJs.includes('HydraScript player runtime requires hydra-health.js'));
  check('player-runtime.js inlines HydraHealth into exports',
    playerJs.includes("'HydraHealth', global.HydraHealth && global.HydraHealth.factorySource"));
  check('player-runtime.js classifies health blocks for the dispatch',
    playerJs.includes('HydraHealth.isHealthCondition(type)') &&
    playerJs.includes('HydraHealth.isHealthAction(type)'));
  check('player-runtime.js exposes the module to both contexts and draws the bar',
    playerJs.includes('healthModule: HydraHealth') &&
    playerJs.includes('health: HydraHealth'));
  check('player-runtime.js repairs health fields in the export normalizer',
    playerJs.includes("if (HydraHealth && typeof HydraHealth.normalizeHealth === 'function') HydraHealth.normalizeHealth(obj);"));
  const previewJs = fs.readFileSync(path.join(HYDRA, 'hydra-previewruntime.js'), 'utf8');
  check('preview runtime exposes the module to both contexts',
    (previewJs.match(/healthModule: mod\('Health'\)/g) || []).length === 2);
  const executeJs = fs.readFileSync(path.join(HYDRA, 'hydra-execute.js'), 'utf8');
  check('shared execute module runs the four health actions',
    executeJs.includes("if (isType(ctx.healthModule, 'isHealthAction', type))") &&
    executeJs.includes("type === 'damageObject'") &&
    executeJs.includes("type === 'healObject'") &&
    executeJs.includes("type === 'setHealth'") &&
    executeJs.includes("type === 'setMaxHealth'") &&
    executeJs.includes('HM.damage(o, dmgInfo.value)') &&
    executeJs.includes('HM.heal(o, healInfo.value)') &&
    executeJs.includes('HM.setHealth(o, setHpInfo.value)') &&
    executeJs.includes('HM.setMaxHealth(o, setMaxInfo.value)'));
  const conditionsJs = fs.readFileSync(path.join(HYDRA, 'hydra-conditions.js'), 'utf8');
  check('shared conditions module reads Health and Object Died',
    conditionsJs.includes("case 'healthCheck':") &&
    conditionsJs.includes("case 'objectDied':") &&
    conditionsJs.includes('HMm.healthOf(o).health') &&
    conditionsJs.includes('HDm.isDead(o)'));
  check('shared conditions module does not freeze the health reads while paused',
    !conditionsJs.split('FROZEN_WHILE_PAUSED = [')[1].split('];')[0].includes('healthCheck') &&
    !conditionsJs.split('FROZEN_WHILE_PAUSED = [')[1].split('];')[0].includes('objectDied'));
  const flowSb = {};
  flowSb.window = flowSb;
  vm.createContext(flowSb);
  vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-flow.js'), 'utf8'),
    flowSb, { filename: 'hydra-flow.js' });
  const F = flowSb.HydraFlow;
  check('flow module reads Health as a level trigger and Object Died as an edge trigger',
    F.defaultTriggerMode('healthCheck') === 'level' &&
    F.defaultTriggerMode('objectDied') === 'edge');
  const drawJs = fs.readFileSync(path.join(HYDRA, 'hydra-draw.js'), 'utf8');
  check('draw module paints the health bar after the per-kind draw',
    drawJs.includes('hooks.health.drawHealthBar(ctx, obj, {') &&
    drawJs.includes("cx: spHb.x + obj.width / 2, cy: spHb.y + obj.height / 2,"));
  const catalogJs = fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8');
  check('catalog carries the six health blocks in the Health category',
    catalogJs.includes("blockType: 'damage-object'") &&
    catalogJs.includes("runtimeType: 'damageObject'") &&
    catalogJs.includes("blockType: 'heal-object'") &&
    catalogJs.includes("runtimeType: 'healObject'") &&
    catalogJs.includes("blockType: 'set-health'") &&
    catalogJs.includes("runtimeType: 'setHealth'") &&
    catalogJs.includes("blockType: 'set-max-health'") &&
    catalogJs.includes("runtimeType: 'setMaxHealth'") &&
    catalogJs.includes("blockType: 'health-check'") &&
    catalogJs.includes("runtimeType: 'healthCheck'") &&
    catalogJs.includes("blockType: 'object-died'") &&
    catalogJs.includes("runtimeType: 'objectDied'") &&
    catalogJs.includes("key: 'amount', label: 'Amount'") &&
    catalogJs.includes("key: 'operator', label: 'Compare'"));
  const universalJs = fs.readFileSync(path.join(HYDRA, 'hydra-universal.js'), 'utf8');
  check('universal normalizer repairs health fields',
    universalJs.includes("window.HydraHealth.normalizeHealth(obj)"));
  const scriptJs = fs.readFileSync(path.join(HYDRA, 'script.js'), 'utf8');
  check('editor wires the Inspector Health section and the preview draw hook',
    scriptJs.includes('function appendHealthEditor(root, obj)') &&
    scriptJs.includes('appendHealthEditor(root, obj);') &&
    scriptJs.includes("makePropGroup('Max health:'") &&
    scriptJs.includes("makePropGroup('Health:'") &&
    scriptJs.includes("makeCheckbox('Show health bar'") &&
    scriptJs.includes('health: window.HydraHealth || null'));
  const refMd = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');
  check('block reference documents all six health blocks',
    refMd.includes('Damage Object') && refMd.includes('Heal Object') &&
    refMd.includes('Set Health') && refMd.includes('Set Max Health') &&
    refMd.includes('Object Died'));
  const guideMd = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');
  check('user guide covers health and damage',
    guideMd.includes('## Health and damage') && guideMd.includes('Damage Object'));
}

process.exit(failures === 0 ? 0 : 1);
