// Unit tests for hydra/hydra-damagefx.js — the shared damage feedback
// system (P4 Advanced batch 22: floating damage numbers, invincibility
// frames, knockback, beginner edition).
//
// Pure logic: number spawn / rise-and-fade update / draw, shield writes
// and reads on the frozen game clock, knockback direction, and the
// routing sets. Nothing here touches the DOM; both runtimes delegate to
// this module. Static checks at the end pin the wiring: catalog blocks,
// both runtimes' dispatch, the flow trigger mode, the frame phase, the
// scene reset, the draw hook, and the docs.

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

// A canvas 2D context that records every call, so the number draw can be
// pinned without a real canvas.
function recordingCtx() {
  const calls = [];
  const ctx = {
    calls,
    fillStyle: '', strokeStyle: '', lineWidth: 0, globalAlpha: 1,
    font: '', textAlign: '', textBaseline: '',
    save() { calls.push(['save']); },
    restore() { calls.push(['restore']); },
    scale(x, y) { calls.push(['scale', x, y]); },
    translate(x, y) { calls.push(['translate', x, y]); },
    fillRect(x, y, w, h) { calls.push(['fillRect', x, y, w, h, this.fillStyle]); },
    fillText(text, x, y) { calls.push(['fillText', text, x, y, this.globalAlpha, this.fillStyle]); },
    strokeText(text, x, y) { calls.push(['strokeText', text, x, y, this.globalAlpha, this.strokeStyle]); },
    beginPath() {}, arc() {}, fill() {}, stroke() {}
  };
  return ctx;
}

const sandbox = {};
sandbox.window = sandbox; // hydra-damagefx.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-damagefx.js'), 'utf8'),
  sandbox, { filename: 'hydra-damagefx.js' });
const D = sandbox.HydraDamageFx;

check('HydraDamageFx exposed with helpers',
  !!D && typeof D.createDamageNumberState === 'function' &&
  typeof D.numbersOf === 'function' &&
  typeof D.normalizeNumberColor === 'function' &&
  typeof D.spawnDamageNumber === 'function' &&
  typeof D.updateDamageNumbers === 'function' &&
  typeof D.drawDamageNumbers === 'function' &&
  typeof D.normalizeInvincibleSeconds === 'function' &&
  typeof D.normalizeKnockbackForce === 'function' &&
  typeof D.makeInvincible === 'function' &&
  typeof D.isInvincible === 'function' &&
  typeof D.invincibleRemainingSeconds === 'function' &&
  typeof D.knockbackDirection === 'function' &&
  typeof D.isDamageFxAction === 'function' &&
  typeof D.isDamageFxCondition === 'function');
check('factorySource is a non-empty string',
  typeof D.factorySource === 'string' && D.factorySource.length > 100 &&
  D.factorySource.includes('hydraDamageFxFactory'));
check('constants are the documented tunables',
  D.MAX_NUMBERS === 100 && near(D.NUMBER_TTL, 0.9) && D.NUMBER_RISE === 48 &&
  near(D.NUMBER_FADE, 0.3) && D.DEFAULT_NUMBER_COLOR === '#ffffff' &&
  D.MAX_FORCE === 5000 && D.DEFAULT_FORCE === 300 && D.MAX_SECONDS === 60);

// --- number state + spawn ---
check('createDamageNumberState starts empty',
  JSON.stringify(D.createDamageNumberState()) === JSON.stringify({ numbers: [] }));
{
  const st = D.createDamageNumberState();
  const rec = D.spawnDamageNumber(st, { x: 120, y: 220, text: 25, color: '#ff0000' });
  check('spawnDamageNumber stores the record with age 0 and the 0.9s lifetime',
    !!rec && rec.x === 120 && rec.y === 220 && rec.text === '25' &&
    rec.color === '#ff0000' && rec.age === 0 && near(rec.ttl, 0.9) &&
    st.numbers.length === 1 && st.numbers[0] === rec,
    JSON.stringify(rec));
  check('spawnDamageNumber reads a missing color as white and a missing text as nothing',
    D.spawnDamageNumber(st, { x: 10, y: 10, text: 'MISS' }).color === '#ffffff' &&
    D.spawnDamageNumber(st, { x: 10, y: 10, text: '' }) === null &&
    D.spawnDamageNumber(st, { x: 10, y: 10 }) === null &&
    st.numbers.length === 2);
  check('spawnDamageNumber reads a zero amount as the text "0"',
    D.spawnDamageNumber(st, { x: 10, y: 10, text: 0 }).text === '0');
  check('spawnDamageNumber stays quiet on a missing state, spec, or position',
    D.spawnDamageNumber(null, { x: 1, y: 1, text: '5' }) === null &&
    D.spawnDamageNumber(st, null) === null &&
    D.spawnDamageNumber(st, { x: 'oops', y: 1, text: '5' }) === null &&
    D.spawnDamageNumber(st, { y: 1, text: '5' }) === null);
}
check('spawnDamageNumber caps the list at 100, dropping the oldest first', (() => {
  const st = D.createDamageNumberState();
  for (let i = 0; i < 101; i++) D.spawnDamageNumber(st, { x: i, y: 0, text: String(i) });
  return st.numbers.length === 100 && st.numbers[0].text === '1' && st.numbers[99].text === '100';
})());
check('normalizeNumberColor reads blank and non-string values as white',
  D.normalizeNumberColor('') === '#ffffff' &&
  D.normalizeNumberColor(null) === '#ffffff' &&
  D.normalizeNumberColor(42) === '#ffffff' &&
  D.normalizeNumberColor('#ff0000') === '#ff0000' &&
  D.normalizeNumberColor('red') === 'red');
check('numbersOf reads a missing or damaged state as an empty list',
  D.numbersOf(null).length === 0 && D.numbersOf({}).length === 0 &&
  D.numbersOf({ numbers: 'nope' }).length === 0);

// --- number update ---
{
  const st = D.createDamageNumberState();
  D.spawnDamageNumber(st, { x: 100, y: 200, text: '25' });
  D.updateDamageNumbers(st, 0.5);
  check('updateDamageNumbers ages the number and lifts it 48px a second',
    st.numbers.length === 1 && near(st.numbers[0].age, 0.5) && near(st.numbers[0].y, 200 - 24),
    JSON.stringify(st.numbers[0]));
  D.updateDamageNumbers(st, 0.4);
  check('updateDamageNumbers drops the number at the end of its lifetime',
    st.numbers.length === 0);
  const st2 = D.createDamageNumberState();
  D.spawnDamageNumber(st2, { x: 100, y: 200, text: '25' });
  D.updateDamageNumbers(st2, 0);
  D.updateDamageNumbers(st2, -1);
  check('updateDamageNumbers holds still on a zero or negative dt (first frame, stalled tab)',
    st2.numbers.length === 1 && st2.numbers[0].age === 0 && st2.numbers[0].y === 200);
  D.updateDamageNumbers(null, 1);
  D.updateDamageNumbers({}, 1);
  check('updateDamageNumbers is a no-op on a missing state', true);
  const st3 = D.createDamageNumberState();
  st3.numbers.push('hostile');
  D.spawnDamageNumber(st3, { x: 100, y: 200, text: '25' });
  D.updateDamageNumbers(st3, 0.1);
  check('updateDamageNumbers drops a hostile non-object record instead of throwing',
    st3.numbers.length === 1 && st3.numbers[0].text === '25');
}

// --- number draw ---
{
  const st = D.createDamageNumberState();
  D.spawnDamageNumber(st, { x: 120, y: 220, text: '25', color: '#ff0000' });
  const ctx = recordingCtx();
  const drawn = D.drawDamageNumbers(ctx, st, 0, 0, 800, 600);
  const fills = ctx.calls.filter(c => c[0] === 'fillText');
  const strokes = ctx.calls.filter(c => c[0] === 'strokeText');
  check('drawDamageNumbers paints the number centered on its position in full color',
    drawn === 1 && fills.length === 1 && fills[0][1] === '25' &&
    fills[0][2] === 120 && fills[0][3] === 220 && fills[0][4] === 1 &&
    fills[0][5] === '#ff0000' &&
    strokes.length === 1 && strokes[0][1] === '25' && strokes[0][2] === 120 &&
    strokes[0][3] === 220 && strokes[0][5] === 'rgba(0,0,0,0.8)',
    JSON.stringify(ctx.calls));
  check('drawDamageNumbers restores the alpha it borrowed',
    ctx.globalAlpha === 1);
}
check('drawDamageNumbers follows the camera (world minus camera is screen)', (() => {
  const st = D.createDamageNumberState();
  D.spawnDamageNumber(st, { x: 220, y: 320, text: '10' });
  const ctx = recordingCtx();
  const drawn = D.drawDamageNumbers(ctx, st, 100, 100, 800, 600);
  const fills = ctx.calls.filter(c => c[0] === 'fillText');
  return drawn === 1 && fills.length === 1 && fills[0][2] === 120 && fills[0][3] === 220;
})());
check('drawDamageNumbers fades the number over its last 0.3 seconds', (() => {
  const st = D.createDamageNumberState();
  const rec = D.spawnDamageNumber(st, { x: 120, y: 220, text: '25' });
  rec.age = 0.8; // 0.1s left of the 0.9s life: alpha 0.1/0.3
  const ctx = recordingCtx();
  const drawn = D.drawDamageNumbers(ctx, st, 0, 0, 800, 600);
  const fills = ctx.calls.filter(c => c[0] === 'fillText');
  return drawn === 1 && fills.length === 1 && near(fills[0][4], 1 / 3, 1e-9);
})());
check('drawDamageNumbers culls numbers outside the view', (() => {
  const st = D.createDamageNumberState();
  D.spawnDamageNumber(st, { x: 2000, y: 2000, text: '25' });
  D.spawnDamageNumber(st, { x: 120, y: 220, text: '10' });
  const ctx = recordingCtx();
  const drawn = D.drawDamageNumbers(ctx, st, 0, 0, 800, 600);
  return drawn === 1 && ctx.calls.filter(c => c[0] === 'fillText').length === 1;
})());
check('drawDamageNumbers stays quiet on a missing context, state, or list',
  D.drawDamageNumbers(null, D.createDamageNumberState(), 0, 0, 800, 600) === 0 &&
  D.drawDamageNumbers(recordingCtx(), null, 0, 0, 800, 600) === 0 &&
  D.drawDamageNumbers(recordingCtx(), { numbers: [] }, 0, 0, 800, 600) === 0 &&
  D.drawDamageNumbers({}, D.createDamageNumberState(), 0, 0, 800, 600) === 0);

// --- invincibility ---
check('normalizeInvincibleSeconds clamps 0..60 with a 1-second default',
  D.normalizeInvincibleSeconds(null) === 1 &&
  D.normalizeInvincibleSeconds('') === 1 &&
  D.normalizeInvincibleSeconds('oops') === 1 &&
  D.normalizeInvincibleSeconds(-5) === 0 &&
  D.normalizeInvincibleSeconds(0) === 0 &&
  D.normalizeInvincibleSeconds(2.5) === 2.5 &&
  D.normalizeInvincibleSeconds(120) === 60);
check('normalizeKnockbackForce clamps 0..5000 with a 300 default',
  D.normalizeKnockbackForce(null) === 300 &&
  D.normalizeKnockbackForce('') === 300 &&
  D.normalizeKnockbackForce('oops') === 300 &&
  D.normalizeKnockbackForce(-10) === 0 &&
  D.normalizeKnockbackForce(0) === 0 &&
  D.normalizeKnockbackForce(250) === 250 &&
  D.normalizeKnockbackForce(99999) === 5000);
{
  const obj = {};
  check('a fresh object is vulnerable',
    D.isInvincible(obj, 1000) === false && D.invincibleRemainingSeconds(obj, 1000) === 0);
  const until = D.makeInvincible(obj, 1, 1000);
  check('makeInvincible writes the shield end on the frozen clock',
    until === 2000 && obj._invincibleUntil === 2000 &&
    D.isInvincible(obj, 1500) === true && D.isInvincible(obj, 2000) === false &&
    near(D.invincibleRemainingSeconds(obj, 1500), 0.5),
    JSON.stringify({ until, rec: obj._invincibleUntil }));
  check('makeInvincible with 0 seconds clears the shield at once',
    D.makeInvincible(obj, 0, 1500) === 0 && obj._invincibleUntil === 0 &&
    D.isInvincible(obj, 1500) === false);
  D.makeInvincible(obj, 2, 5000);
  check('a second shield replaces the first (no stacking)',
    obj._invincibleUntil === 7000 && D.isInvincible(obj, 6999) === true);
  check('makeInvincible stays quiet on a missing object',
    D.makeInvincible(null, 1, 1000) === 0 &&
    D.makeInvincible('nope', 1, 1000) === 0);
  const bad = { _invincibleUntil: 'soon' };
  check('a non-numeric shield record reads as vulnerable',
    D.isInvincible(bad, 1000) === false && D.invincibleRemainingSeconds(bad, 1000) === 0);
}

// --- knockback direction ---
check('knockbackDirection is the unit vector away from the source',
  (() => {
    const r = D.knockbackDirection(0, 0, 100, 0);
    return near(r.x, 1) && near(r.y, 0);
  })() &&
  (() => {
    const d = D.knockbackDirection(100, 100, 0, 0);
    return near(d.x, -Math.SQRT1_2) && near(d.y, -Math.SQRT1_2);
  })());
check('knockbackDirection pushes straight up from the object\'s own center',
  (() => {
    const r = D.knockbackDirection(50, 50, 50, 50);
    return r.x === 0 && r.y === -1;
  })());
check('knockbackDirection reads non-finite inputs as straight up',
  (() => {
    const r = D.knockbackDirection('oops', 0, 10, 10);
    return r.x === 0 && r.y === -1;
  })());

// --- routing ---
check('routing sets cover the three actions and one condition',
  D.isDamageFxAction('showDamageNumber') && D.isDamageFxAction('makeInvincible') &&
  D.isDamageFxAction('knockbackObject') &&
  !D.isDamageFxAction('isInvincible') && !D.isDamageFxAction('damageObject') &&
  !D.isDamageFxAction(null) &&
  D.isDamageFxCondition('isInvincible') &&
  !D.isDamageFxCondition('showDamageNumber') && !D.isDamageFxCondition(null));

// --- hostile input ---
check('hostile input degrades to safe defaults',
  D.normalizeInvincibleSeconds([]) === 1 &&
  D.normalizeKnockbackForce([]) === 300 &&
  D.knockbackDirection('nope', 'nope', 'nope', 'nope').y === -1 &&
  D.isInvincible('nope', 1000) === false &&
  D.invincibleRemainingSeconds('nope', 1000) === 0 &&
  D.spawnDamageNumber('nope', { x: 1, y: 1, text: '5' }) === null &&
  D.drawDamageNumbers(null, null, 0, 0, 0, 0) === 0);

// --- static wiring ---
{
  const html = fs.readFileSync(path.join(HYDRA, 'index.html'), 'utf8');
  const dmgTag = html.indexOf('src="hydra-damagefx.js');
  check('index.html loads hydra-damagefx.js before player-runtime.js and script.js',
    dmgTag !== -1 && dmgTag < html.indexOf('src="player-runtime.js') && dmgTag < html.indexOf('src="script.js'));
  check('index.html loads hydra-damagefx.js after hydra-health.js',
    dmgTag > html.indexOf('src="hydra-health.js'));
  const playerJs = fs.readFileSync(path.join(HYDRA, 'player-runtime.js'), 'utf8');
  check('player-runtime.js hard-guards on HydraDamageFx',
    playerJs.includes("if (!HydraDamageFx || typeof HydraDamageFx.createDamageNumberState !== 'function')") &&
    playerJs.includes('HydraScript player runtime requires hydra-damagefx.js'));
  check('player-runtime.js inlines HydraDamageFx into exports',
    playerJs.includes("'HydraDamageFx', global.HydraDamageFx && global.HydraDamageFx.factorySource"));
  check('player-runtime.js classifies damage-feedback blocks for the dispatch',
    playerJs.includes('HydraDamageFx.isDamageFxCondition(type)') &&
    playerJs.includes('HydraDamageFx.isDamageFxAction(type)'));
  check('player-runtime.js exposes the module to both contexts and draws the numbers',
    playerJs.includes('damageFxModule: HydraDamageFx') &&
    playerJs.includes('damageFx: HydraDamageFx') &&
    playerJs.includes('damageNumbers: state.damageNumbers') &&
    playerJs.includes('ensureDamageNumbers: function ()'));
  check('player-runtime.js advances the numbers as a frame phase and resets them per scene',
    playerJs.includes('updateDamageNumbers: () => {') &&
    playerJs.includes('HydraDamageFx.updateDamageNumbers(state.damageNumbers, (state.dt || 0) / 60)') &&
    playerJs.includes('createDamageNumbers: () => HydraDamageFx.createDamageNumberState()'));
  const previewJs = fs.readFileSync(path.join(HYDRA, 'hydra-previewruntime.js'), 'utf8');
  check('preview runtime exposes the module to both contexts',
    (previewJs.match(/damageFxModule: mod\('DamageFx'\)/g) || []).length === 2);
  check('preview runtime advances the numbers and resets them per scene',
    previewJs.includes('updateDamageNumbers: function () {') &&
    previewJs.includes('DF.updateDamageNumbers(r.damageNumbers, dt / 60)') &&
    previewJs.includes('createDamageNumbers: function () {') &&
    previewJs.includes("ensureDamageNumbers: function () { return hostCall('ensurePreviewDamageNumberState', [], null); }"));
  const executeJs = fs.readFileSync(path.join(HYDRA, 'hydra-execute.js'), 'utf8');
  check('shared execute module runs the three damage-feedback actions',
    executeJs.includes("if (isType(ctx.damageFxModule, 'isDamageFxAction', type))") &&
    executeJs.includes("type === 'showDamageNumber'") &&
    executeJs.includes("type === 'makeInvincible'") &&
    executeJs.includes("type === 'knockbackObject'") &&
    executeJs.includes('DM.spawnDamageNumber(numState, {') &&
    executeJs.includes('DM.makeInvincible(o, invInfo.value, nowShield)') &&
    executeJs.includes('DM.knockbackDirection(srcX, srcY,') &&
    executeJs.includes("applyVelocity(ctx, o, dir.x * force, dir.y * force, 'add')"));
  check('shared execute module gates Damage Object on the shield',
    executeJs.includes('ctx.damageFxModule.isInvincible(o, nowInv)'));
  const conditionsJs = fs.readFileSync(path.join(HYDRA, 'hydra-conditions.js'), 'utf8');
  check('shared conditions module reads Is Invincible',
    conditionsJs.includes("case 'isInvincible':") &&
    conditionsJs.includes('DMm.isInvincible(o, nowInv)'));
  check('shared conditions module does not freeze the shield read while paused',
    !conditionsJs.split('FROZEN_WHILE_PAUSED = [')[1].split('];')[0].includes('isInvincible'));
  const flowSb = {};
  flowSb.window = flowSb;
  vm.createContext(flowSb);
  vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-flow.js'), 'utf8'),
    flowSb, { filename: 'hydra-flow.js' });
  const F = flowSb.HydraFlow;
  check('flow module reads Is Invincible as a level trigger',
    F.defaultTriggerMode('isInvincible') === 'level');
  const frameSb = {};
  frameSb.window = frameSb;
  vm.createContext(frameSb);
  vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-frame.js'), 'utf8'),
    frameSb, { filename: 'hydra-frame.js' });
  const FR = frameSb.HydraFrame;
  check('frame module runs updateDamageNumbers after updateParticles and before updateAI',
    FR.PHASES.indexOf('updateDamageNumbers') > FR.PHASES.indexOf('updateParticles') &&
    FR.PHASES.indexOf('updateDamageNumbers') < FR.PHASES.indexOf('updateAI'));
  const resetSb = {};
  resetSb.window = resetSb;
  vm.createContext(resetSb);
  vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-scenereset.js'), 'utf8'),
    resetSb, { filename: 'hydra-scenereset.js' });
  const SR = resetSb.HydraSceneReset;
  check('scene reset mints a fresh damage-number state per scene load',
    (() => {
      const state = { damageNumbers: { numbers: [{ text: 'old' }] } };
      let created = 0;
      const ok = SR.resetSceneRuntime(state, { id: 1 },
        { createDamageNumbers: () => { created++; return { numbers: [] }; } });
      return ok === true && created === 1 && state.damageNumbers.numbers.length === 0;
    })() &&
    (() => {
      const state = {};
      const ok = SR.resetSceneRuntime(state, { id: 1 }, {});
      return ok === true && state.damageNumbers === null;
    })());
  const drawJs = fs.readFileSync(path.join(HYDRA, 'hydra-draw.js'), 'utf8');
  check('draw module paints the damage numbers after the particles pass',
    drawJs.includes('h.damageFx.drawDamageNumbers(ctx, view.damageNumbers, cam.x, cam.y, width / z, height / z)') &&
    drawJs.indexOf('h.damageFx.drawDamageNumbers') > drawJs.indexOf('h.particles.draw(ctx, view.particles'));
  const catalogJs = fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8');
  check('catalog carries the four damage-feedback blocks in the Health category',
    catalogJs.includes("blockType: 'show-damage-number'") &&
    catalogJs.includes("runtimeType: 'showDamageNumber'") &&
    catalogJs.includes("blockType: 'make-invincible'") &&
    catalogJs.includes("runtimeType: 'makeInvincible'") &&
    catalogJs.includes("blockType: 'knockback-object'") &&
    catalogJs.includes("runtimeType: 'knockbackObject'") &&
    catalogJs.includes("blockType: 'is-invincible'") &&
    catalogJs.includes("runtimeType: 'isInvincible'") &&
    catalogJs.includes("key: 'fromObject', label: 'From object'") &&
    catalogJs.includes("key: 'seconds', label: 'Seconds'") &&
    catalogJs.includes("key: 'force', label: 'Force'"));
  const scriptJs = fs.readFileSync(path.join(HYDRA, 'script.js'), 'utf8');
  check('editor wires the preview number state and the preview draw hook',
    scriptJs.includes('function ensurePreviewDamageNumberState()') &&
    scriptJs.includes('damageNumbers: previewState.damageNumbers') &&
    scriptJs.includes('damageFx: window.HydraDamageFx || null'));
  check('editor hands the number-state maker to the preview runtime host (cycle 13: the host entry was missing, so Show Damage Number silently did nothing in the preview)',
    scriptJs.includes('ensurePreviewParticleState, ensurePreviewDamageNumberState, ensurePreviewRespawnState, ensurePreviewSpawnerState, ensurePreviewMovementState, ensurePreviewPlatformState, ensurePreviewCombatState, getPreviewBuses'));
  const refMd = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');
  check('block reference documents all four damage-feedback blocks',
    refMd.includes('Show Damage Number') && refMd.includes('Make Invincible') &&
    refMd.includes('Knockback Object') && refMd.includes('Is Invincible'));
  const guideMd = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');
  check('user guide covers damage feedback',
    guideMd.includes('Damage feedback') && guideMd.includes('Show Damage Number'));
}

process.exit(failures === 0 ? 0 : 1);
