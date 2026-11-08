// Unit tests for hydra/hydra-joystick.js — the shared virtual joystick
// (P4 Advanced batch 20: on-screen touch joystick, beginner edition).
//
// Pure logic: config normalization (anchor / radius / knob / deadzone /
// variable + action names), the per-run stick record, the fixed base
// geometry, pointer grab / drag / release with dead-zone rescaling,
// the tilt reads, the driven named actions, the per-frame variable
// output, and the screen-space draw. Nothing here touches the DOM;
// both runtimes delegate to this module. Static checks at the end pin
// the wiring: catalog blocks, both runtimes' dispatch and frame phase,
// the frame module's phase order, the actions module's joystick source,
// and the docs.

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

const sandbox = {};
sandbox.window = sandbox; // hydra-joystick.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-joystick.js'), 'utf8'),
  sandbox, { filename: 'hydra-joystick.js' });
const J = sandbox.HydraJoystick;

check('HydraJoystick exposed with helpers',
  !!J && typeof J.normalizeAnchor === 'function' &&
  typeof J.normalizeRadius === 'function' &&
  typeof J.normalizeKnobRadius === 'function' &&
  typeof J.normalizeDeadzone === 'function' &&
  typeof J.normalizeName === 'function' &&
  typeof J.defaultJoystickConfig === 'function' &&
  typeof J.normalizeJoystickConfig === 'function' &&
  typeof J.createJoystickRuntime === 'function' &&
  typeof J.isActive === 'function' &&
  typeof J.isSteering === 'function' &&
  typeof J.joystickBase === 'function' &&
  typeof J.joystickStart === 'function' &&
  typeof J.joystickMove === 'function' &&
  typeof J.joystickEnd === 'function' &&
  typeof J.joystickTilt === 'function' &&
  typeof J.joystickHeldActions === 'function' &&
  typeof J.applyJoystickOutput === 'function' &&
  typeof J.drawJoystick === 'function' &&
  typeof J.isJoystickAction === 'function' &&
  typeof J.isJoystickCondition === 'function');
check('factorySource is a self-contained function string',
  typeof J.factorySource === 'string' && J.factorySource.includes('hydraJoystickFactory'));
check('constants are 60 default radius, 20..200 range, 24 default knob, 0.15 default deadzone, 0.35 action tilt',
  J.DEFAULT_RADIUS === 60 && J.MIN_RADIUS === 20 && J.MAX_RADIUS === 200 &&
  J.DEFAULT_KNOB_RADIUS === 24 && J.MIN_KNOB_RADIUS === 8 && J.MAX_KNOB_RADIUS === 100 &&
  J.DEFAULT_DEADZONE === 0.15 && J.MIN_DEADZONE === 0 && J.MAX_DEADZONE === 0.9 &&
  J.ACTION_TILT === 0.35 && J.DEFAULT_VAR_X === 'joystickX' && J.DEFAULT_VAR_Y === 'joystickY');

// --- config normalization ---
{
  check('normalizeAnchor reads the three anchors and defaults unknown/blank to bottom-left',
    J.normalizeAnchor('bottom-right') === 'bottom-right' &&
    J.normalizeAnchor('custom') === 'custom' &&
    J.normalizeAnchor('Bottom-Left') === 'bottom-left' &&
    J.normalizeAnchor('sideways') === 'bottom-left' &&
    J.normalizeAnchor('') === 'bottom-left' &&
    J.normalizeAnchor(null) === 'bottom-left' &&
    J.normalizeAnchor(undefined) === 'bottom-left');
  check('normalizeRadius clamps 20..200 with 60 for missing/non-numeric',
    J.normalizeRadius(60) === 60 && J.normalizeRadius(10) === 20 &&
    J.normalizeRadius(500) === 200 && J.normalizeRadius('big') === 60 &&
    J.normalizeRadius(null) === 60 && J.normalizeRadius('') === 60);
  check('normalizeKnobRadius clamps 8..100 with 24 for missing/non-numeric',
    J.normalizeKnobRadius(24) === 24 && J.normalizeKnobRadius(2) === 8 &&
    J.normalizeKnobRadius(300) === 100 && J.normalizeKnobRadius('wide') === 24 &&
    J.normalizeKnobRadius(null) === 24);
  check('normalizeDeadzone clamps 0..0.9 with 0.15 for missing/non-numeric',
    J.normalizeDeadzone(0.3) === 0.3 && J.normalizeDeadzone(-1) === 0 &&
    J.normalizeDeadzone(2) === 0.9 && J.normalizeDeadzone('numb') === 0.15 &&
    J.normalizeDeadzone(null) === 0.15 && J.normalizeDeadzone(0) === 0);
  check('normalizeName trims, keeps a real name, and blanks missing ones',
    J.normalizeName('  Move Left ') === 'Move Left' &&
    J.normalizeName('') === '' && J.normalizeName(null) === '' &&
    J.normalizeName(undefined) === '');
  const def = J.defaultJoystickConfig();
  check('defaultJoystickConfig is off with the documented defaults',
    def.enabled === false && def.anchor === 'bottom-left' &&
    def.x === 120 && def.y === 480 && def.radius === 60 &&
    def.knobRadius === 24 && def.deadzone === 0.15 &&
    def.varX === 'joystickX' && def.varY === 'joystickY' &&
    def.actionLeft === '' && def.actionRight === '' &&
    def.actionUp === '' && def.actionDown === '');
  check('defaultJoystickConfig returns a fresh object every call',
    J.defaultJoystickConfig() !== J.defaultJoystickConfig());
  const partial = { enabled: true, anchor: 'sideways', radius: 5, deadzone: 3, varX: '  stickX ' };
  const repaired = J.normalizeJoystickConfig(partial);
  check('normalizeJoystickConfig repairs a partial config in place and returns it',
    repaired === partial && repaired.enabled === true &&
    repaired.anchor === 'bottom-left' && repaired.radius === 20 &&
    repaired.deadzone === 0.9 && repaired.varX === 'stickX' &&
    repaired.knobRadius === 24 && repaired.actionLeft === '');
  check('normalizeJoystickConfig reads a non-object as a fresh default',
    (function () {
      const d = J.normalizeJoystickConfig(null);
      return d.enabled === false && d.anchor === 'bottom-left' && d.radius === 60;
    })() &&
    J.normalizeJoystickConfig('nope').varX === 'joystickX' &&
    J.normalizeJoystickConfig([1, 2]).varY === 'joystickY');
}

// --- runtime record ---
{
  check('createJoystickRuntime starts off, unheld, centered',
    (function () {
      const rt = J.createJoystickRuntime();
      return rt.enabled === false && rt.pointerId === null &&
        rt.baseX === 0 && rt.baseY === 0 && rt.dx === 0 && rt.dy === 0 &&
        rt.x === 0 && rt.y === 0;
    })());
  check('createJoystickRuntime starts enabled from the project default',
    J.createJoystickRuntime({ enabled: true }).enabled === true &&
    J.createJoystickRuntime({ enabled: false }).enabled === false &&
    J.createJoystickRuntime(null).enabled === false &&
    J.createJoystickRuntime({ enabled: 'yes' }).enabled === false);
}

// --- base geometry (800x600 view, radius 60) ---
{
  const cfg = J.defaultJoystickConfig();
  const bl = J.joystickBase(cfg, 800, 600);
  check('joystickBase bottom-left sits one radius plus a margin in from the corner',
    bl.x === 76 && bl.y === 524, JSON.stringify(bl));
  const br = J.joystickBase(Object.assign({}, cfg, { anchor: 'bottom-right' }), 800, 600);
  check('joystickBase bottom-right mirrors into the right corner',
    br.x === 724 && br.y === 524, JSON.stringify(br));
  const cu = J.joystickBase(Object.assign({}, cfg, { anchor: 'custom', x: 400, y: 300 }), 800, 600);
  check('joystickBase custom reads the configured point',
    cu.x === 400 && cu.y === 300, JSON.stringify(cu));
  const cl = J.joystickBase(Object.assign({}, cfg, { anchor: 'custom', x: 10, y: 590 }), 800, 600);
  check('joystickBase custom clamps the base on-screen',
    cl.x === 60 && cl.y === 540, JSON.stringify(cl));
  const missing = J.joystickBase(cfg, null, undefined);
  check('joystickBase reads a missing view size as 800x600',
    missing.x === 76 && missing.y === 524, JSON.stringify(missing));
  const small = J.joystickBase(Object.assign({}, cfg, { anchor: 'bottom-right' }), 100, 100);
  check('joystickBase never goes negative on a tiny view',
    small.x === 60 && small.y === 60, JSON.stringify(small));
}

// --- grab / drag / release ---
function liveStick() {
  const cfg = J.defaultJoystickConfig();
  cfg.enabled = true;
  const rt = J.createJoystickRuntime(cfg);
  return { cfg, rt };
}
{
  const { cfg, rt } = liveStick();
  check('joystickStart grabs a press on the base center',
    J.joystickStart(rt, cfg, 'mouse', 76, 524, 800, 600) === true &&
    rt.pointerId === 'mouse' && rt.baseX === 76 && rt.baseY === 524 &&
    J.isActive(rt) === true && J.isSteering(rt) === false);
  check('joystickStart refuses a second pointer while held',
    J.joystickStart(rt, cfg, 'touch:1', 76, 524, 800, 600) === false &&
    rt.pointerId === 'mouse');
  check('joystickMove to half the radius reads a deadzone-rescaled tilt',
    J.joystickMove(rt, cfg, 'mouse', 106, 524) === true &&
    rt.dx === 30 && rt.dy === 0 && near(rt.x, (0.5 - 0.15) / 0.85, 1e-9) && rt.y === 0,
    JSON.stringify({ x: rt.x, y: rt.y, dx: rt.dx }));
  check('joystickTilt reads right past 0.4 but not past 0.5 at that tilt',
    J.joystickTilt(rt, 'right', 0.4) === true &&
    J.joystickTilt(rt, 'right', 0.5) === false &&
    J.joystickTilt(rt, 'left', 0.4) === false &&
    J.joystickTilt(rt, 'any', 0.4) === true &&
    J.joystickTilt(rt, 'up', 0.4) === false);
  check('joystickEnd with the wrong pointer id leaves the stick held',
    J.joystickEnd(rt, 'touch:1') === false && J.isActive(rt) === true);
  check('joystickEnd with the right pointer releases and centers',
    J.joystickEnd(rt, 'mouse') === true && rt.pointerId === null &&
    rt.dx === 0 && rt.dy === 0 && rt.x === 0 && rt.y === 0 &&
    J.isActive(rt) === false && J.isSteering(rt) === false);
}
{
  const { cfg, rt } = liveStick();
  check('joystickStart misses a press outside the base plus slack',
    J.joystickStart(rt, cfg, 'mouse', 200, 524, 800, 600) === false &&
    J.isActive(rt) === false);
  check('joystickStart grabs a press inside the slack ring',
    J.joystickStart(rt, cfg, 'mouse', 76 + 60 + 10, 524, 800, 600) === true);
  J.joystickEnd(rt, 'mouse');
  check('joystickMove for a pointer that does not hold the stick stays quiet',
    J.joystickMove(rt, cfg, 'touch:9', 100, 524) === false && rt.x === 0);
}
{
  const { cfg, rt } = liveStick();
  check('joystickStart stays quiet while the stick is off',
    (function () {
      const off = J.createJoystickRuntime({ enabled: false });
      return J.joystickStart(off, cfg, 'mouse', 76, 524, 800, 600) === false;
    })());
  J.joystickStart(rt, cfg, 'mouse', 76, 524, 800, 600);
  check('joystickMove inside the dead zone reads exactly 0 but the knob still follows',
    J.joystickMove(rt, cfg, 'mouse', 81, 524) === true &&
    rt.dx === 5 && rt.x === 0 && rt.y === 0 && J.isSteering(rt) === false,
    JSON.stringify({ dx: rt.dx, x: rt.x }));
  check('joystickMove past the edge clamps the knob to the base circle at full tilt',
    J.joystickMove(rt, cfg, 'mouse', 276, 524) === true &&
    rt.dx === 60 && near(rt.x, 1, 1e-9) && rt.y === 0,
    JSON.stringify({ dx: rt.dx, x: rt.x }));
  check('joystickMove up reads a negative Y tilt',
    J.joystickMove(rt, cfg, 'mouse', 76, 464) === true &&
    near(rt.y, -1, 1e-9) && J.joystickTilt(rt, 'up', 0.5) === true &&
    J.joystickTilt(rt, 'down', 0.5) === false,
    JSON.stringify({ y: rt.y }));
  check('joystickTilt defaults a missing minimum to 0.5 and clamps it to 0..1',
    J.joystickTilt(rt, 'up') === true &&
    J.joystickTilt(rt, 'up', 2) === true &&
    J.joystickTilt(rt, 'up', -1) === true &&
    (function () {
      // At half tilt the clamp matters: a minimum of 2 reads as 1
      // (full tilt), so half tilt stays quiet; 0.4 fires.
      J.joystickMove(rt, cfg, 'mouse', 76, 494);
      return J.joystickTilt(rt, 'up', 2) === false &&
        J.joystickTilt(rt, 'up', 0.4) === true;
    })());
  check('joystickTilt stays quiet when the stick is not held',
    (function () {
      const idle = J.createJoystickRuntime({ enabled: true });
      return J.joystickTilt(idle, 'any', 0) === false &&
        J.joystickTilt(null, 'any', 0) === false &&
        J.joystickTilt(undefined, 'right', 0.5) === false;
    })());
  check('joystickTilt reads an unknown direction as any',
    J.joystickTilt(rt, 'sideways', 0.4) === true);
}

// --- driven actions ---
{
  const cfg = J.defaultJoystickConfig();
  cfg.enabled = true;
  cfg.actionLeft = 'Move Left';
  cfg.actionRight = 'Move Right';
  cfg.actionUp = 'Jump';
  cfg.actionDown = '';
  const rt = J.createJoystickRuntime(cfg);
  check('joystickHeldActions reads empty while the stick is not steering',
    JSON.stringify(J.joystickHeldActions(cfg, rt)) === '[]');
  J.joystickStart(rt, cfg, 'mouse', 76, 524, 800, 600);
  J.joystickMove(rt, cfg, 'mouse', 46, 524);
  check('joystickHeldActions holds the left action past a third of the way',
    JSON.stringify(J.joystickHeldActions(cfg, rt)) === '["Move Left"]',
    JSON.stringify(J.joystickHeldActions(cfg, rt)));
  J.joystickMove(rt, cfg, 'mouse', 46, 494);
  check('joystickHeldActions holds two actions on a diagonal (blank down skipped)',
    JSON.stringify(J.joystickHeldActions(cfg, rt)) === '["Move Left","Jump"]',
    JSON.stringify(J.joystickHeldActions(cfg, rt)));
  J.joystickMove(rt, cfg, 'mouse', 80, 520);
  check('joystickHeldActions reads empty inside the action threshold',
    JSON.stringify(J.joystickHeldActions(cfg, rt)) === '[]');
  check('joystickHeldActions lists a name used twice only once',
    (function () {
      const dup = Object.assign({}, cfg, { actionLeft: 'Steer', actionUp: 'Steer' });
      J.joystickMove(rt, cfg, 'mouse', 46, 494);
      const held = J.joystickHeldActions(dup, rt);
      return JSON.stringify(held) === '["Steer"]';
    })());
  check('joystickHeldActions degrades to empty on hostile input',
    JSON.stringify(J.joystickHeldActions(null, null)) === '[]' &&
    JSON.stringify(J.joystickHeldActions(cfg, null)) === '[]');
}

// --- per-frame output ---
{
  function writtenOut(cfgOverrides, moves) {
    const cfg = J.defaultJoystickConfig();
    cfg.enabled = true;
    Object.assign(cfg, cfgOverrides || {});
    const rt = J.createJoystickRuntime(cfg);
    const seen = {};
    const hooks = { setVariable: function (n, v) { seen[n] = v; } };
    const out = { cfg, rt, seen, hooks };
    if (moves) {
      J.joystickStart(rt, cfg, 'mouse', 76, 524, 800, 600);
      moves.forEach(function (m) { J.joystickMove(rt, cfg, 'mouse', m[0], m[1]); });
    }
    out.written = J.applyJoystickOutput(rt, cfg, hooks);
    return out;
  }
  const held = writtenOut({}, [[136, 524]]);
  check('applyJoystickOutput writes full right tilt into both variables',
    held.written === 2 && near(held.seen.joystickX, 1, 1e-9) && held.seen.joystickY === 0,
    JSON.stringify(held.seen));
  const released = writtenOut({}, [[136, 524]]);
  J.joystickEnd(released.rt, 'mouse');
  const w2 = J.applyJoystickOutput(released.rt, released.cfg, released.hooks);
  check('applyJoystickOutput writes 0 for both axes after release',
    w2 === 2 && released.seen.joystickX === 0 && released.seen.joystickY === 0,
    JSON.stringify(released.seen));
  const idle = writtenOut({});
  check('applyJoystickOutput writes 0 for both axes while held at rest',
    idle.written === 2 && idle.seen.joystickX === 0 && idle.seen.joystickY === 0);
  const off = (function () {
    const cfg = J.defaultJoystickConfig();
    const rt = J.createJoystickRuntime(cfg);
    const seen = {};
    const w = J.applyJoystickOutput(rt, cfg, { setVariable: function (n, v) { seen[n] = v; } });
    return { w, seen };
  })();
  check('applyJoystickOutput writes nothing while the stick is off',
    off.w === 0 && Object.keys(off.seen).length === 0);
  const blankX = writtenOut({ varX: '' }, [[136, 524]]);
  check('applyJoystickOutput skips a blank variable name',
    blankX.written === 1 && blankX.seen.joystickX === undefined && near(blankX.seen.joystickY, 0, 1e-9));
  const blankBoth = writtenOut({ varX: '', varY: '' }, [[136, 524]]);
  check('applyJoystickOutput writes nothing when both names are blank',
    blankBoth.written === 0);
  const renamed = writtenOut({ varX: 'stickX', varY: 'stickY' }, [[76, 464]]);
  check('applyJoystickOutput writes the renamed variables (up reads -1)',
    renamed.written === 2 && near(renamed.seen.stickY, -1, 1e-9) && renamed.seen.stickX === 0,
    JSON.stringify(renamed.seen));
  const sameName = writtenOut({ varX: 'stick', varY: 'stick' }, [[136, 524]]);
  check('applyJoystickOutput writes once when both axes share one name',
    sameName.written === 1 && near(sameName.seen.stick, 1, 1e-9));
  check('applyJoystickOutput degrades to 0 on a missing or throwing hook',
    J.applyJoystickOutput(J.createJoystickRuntime({ enabled: true }), J.defaultJoystickConfig(), null) === 0 &&
    J.applyJoystickOutput(J.createJoystickRuntime({ enabled: true }), J.defaultJoystickConfig(), {}) === 0 &&
    J.applyJoystickOutput(null, null, { setVariable: function () { throw new Error('boom'); } }) === 0);
}

// --- draw ---
function stubCtx() {
  const calls = [];
  return {
    calls,
    save: function () { calls.push('save'); },
    restore: function () { calls.push('restore'); },
    beginPath: function () { calls.push('beginPath'); },
    arc: function (x, y, r) { calls.push('arc:' + Math.round(x) + ',' + Math.round(y) + ',' + Math.round(r)); },
    fill: function () { calls.push('fill'); },
    stroke: function () { calls.push('stroke'); },
    set globalAlpha(v) {},
    set fillStyle(v) {},
    set strokeStyle(v) {},
    set lineWidth(v) {}
  };
}
{
  const cfg = J.defaultJoystickConfig();
  cfg.enabled = true;
  const rt = J.createJoystickRuntime(cfg);
  const ctx = stubCtx();
  check('drawJoystick paints the base at the anchor and the knob at rest',
    J.drawJoystick(ctx, rt, cfg, 800, 600) === true &&
    ctx.calls.indexOf('arc:76,524,60') !== -1 &&
    ctx.calls.indexOf('arc:76,524,24') !== -1,
    JSON.stringify(ctx.calls));
  const ctx2 = stubCtx();
  J.joystickStart(rt, cfg, 'mouse', 76, 524, 800, 600);
  J.joystickMove(rt, cfg, 'mouse', 106, 524);
  check('drawJoystick paints the knob at the dragged offset',
    J.drawJoystick(ctx2, rt, cfg, 800, 600) === true &&
    ctx2.calls.indexOf('arc:106,524,24') !== -1,
    JSON.stringify(ctx2.calls));
  const offCtx = stubCtx();
  const offRt = J.createJoystickRuntime({ enabled: false });
  check('drawJoystick draws nothing while the stick is off',
    J.drawJoystick(offCtx, offRt, cfg, 800, 600) === false &&
    offCtx.calls.length === 0);
  check('drawJoystick draws nothing without a context or a runtime',
    J.drawJoystick(null, rt, cfg, 800, 600) === false &&
    J.drawJoystick(stubCtx(), null, cfg, 800, 600) === false &&
    J.drawJoystick({}, rt, cfg, 800, 600) === false);
  check('drawJoystick never throws on a throwing context',
    (function () {
      const bad = { save: function () { throw new Error('boom'); } };
      try { return J.drawJoystick(bad, rt, cfg, 800, 600) === false; }
      catch (e) { return false; }
    })());
}

// --- routing sets ---
{
  check('routing sets name the two actions and the two conditions',
    J.isJoystickAction('enableJoystick') && J.isJoystickAction('disableJoystick') &&
    !J.isJoystickAction('joystickActive') && !J.isJoystickAction('setAiBehavior') &&
    J.isJoystickCondition('joystickActive') && J.isJoystickCondition('joystickTilt') &&
    !J.isJoystickCondition('enableJoystick') && !J.isJoystickCondition('aiBehavior') &&
    !J.isJoystickAction(null) && !J.isJoystickCondition(undefined));
}

// --- hostile input ---
{
  check('hostile input degrades instead of throwing',
    J.normalizeAnchor({}) === 'bottom-left' &&
    J.normalizeRadius({}) === 60 &&
    J.normalizeKnobRadius([]) === 8 &&
    J.normalizeDeadzone({}) === 0.15 &&
    J.normalizeName({}) === '' &&
    J.createJoystickRuntime('nope').enabled === false &&
    J.isActive(null) === false && J.isSteering(undefined) === false &&
    J.joystickBase(null, 'wide', 'tall').x === 76 &&
    J.joystickStart(null, null, null, null, null) === false &&
    J.joystickMove(null, null, null, null, null) === false &&
    J.joystickEnd(null, null) === false &&
    J.joystickTilt(null, null, null) === false &&
    J.applyJoystickOutput(null, null, null) === 0 &&
    J.drawJoystick(null, null, null) === false);
}

// --- static wiring ---
{
  const html = fs.readFileSync(path.join(HYDRA, 'index.html'), 'utf8');
  const joyTag = html.indexOf('src="hydra-joystick.js');
  check('index.html loads hydra-joystick.js before player-runtime.js and script.js',
    joyTag !== -1 && joyTag < html.indexOf('src="player-runtime.js') && joyTag < html.indexOf('src="script.js'));
  check('index.html loads hydra-joystick.js after hydra-ai.js',
    joyTag > html.indexOf('src="hydra-ai.js'));
  check('index.html has the Joystick inspector tab and panel',
    html.includes('data-inspector-tab="joystick"') &&
    html.includes('data-inspector-panel="joystick"') &&
    html.includes('id="joystick-panel"'));
  const playerJs = fs.readFileSync(path.join(HYDRA, 'player-runtime.js'), 'utf8');
  check('player-runtime.js hard-guards on HydraJoystick',
    playerJs.includes("if (!HydraJoystick || typeof HydraJoystick.createJoystickRuntime !== 'function')") &&
    playerJs.includes('HydraScript player runtime requires hydra-joystick.js'));
  check('player-runtime.js inlines HydraJoystick into exports',
    playerJs.includes("'HydraJoystick', global.HydraJoystick && global.HydraJoystick.factorySource"));
  check('player-runtime.js classifies joystick blocks for the dispatch',
    playerJs.includes('HydraJoystick.isJoystickCondition(type)') &&
    playerJs.includes('HydraJoystick.isJoystickAction(type)'));
  check('player-runtime.js exposes the module and the live stick to both contexts',
    playerJs.includes('joystickModule: HydraJoystick') &&
    playerJs.includes('joystick: state.joystick'));
  check('player-runtime.js feeds driven actions into the input poll and writes tilt in updateJoystick',
    playerJs.includes('joystick: new Set(HydraJoystick.joystickHeldActions(state.joystickConfig, state.joystick))') &&
    playerJs.includes('updateJoystick: () => {') &&
    playerJs.includes('HydraJoystick.applyJoystickOutput(state.joystick, state.joystickConfig, {'));
  check('player-runtime.js grabs the stick on pointer down and draws it before the transition overlay',
    playerJs.includes("HydraJoystick.joystickStart(state.joystick, state.joystickConfig, 'mouse'") &&
    playerJs.includes("HydraJoystick.joystickEnd(state.joystick, 'mouse')") &&
    playerJs.includes('HydraJoystick.drawJoystick(state.ctx, state.joystick, state.joystickConfig, state.canvas.width, state.canvas.height)'));
  const previewJs = fs.readFileSync(path.join(HYDRA, 'hydra-previewruntime.js'), 'utf8');
  check('preview runtime exposes the module and the live stick to both contexts and writes tilt',
    previewJs.includes("joystickModule: mod('Joystick')") &&
    previewJs.includes('joystick: joystickRuntime()') &&
    previewJs.includes('J.applyJoystickOutput(joystickRuntime(), joystickConfig(), {'));
  check('preview runtime feeds driven actions into the input poll',
    previewJs.includes('JH.joystickHeldActions(joystickConfig(), joystickRuntime())') &&
    previewJs.includes('joystick: new Set(joyHeld)'));
  check('preview runtime grabs the stick on canvas press and resets it on a fresh run',
    previewJs.includes("Jd.joystickStart(rtD, joystickConfig(), 'mouse'") &&
    previewJs.includes('resetJoystickRuntime();') &&
    previewJs.includes('joystickRuntimeForDraw: joystickRuntimeForDraw'));
  const executeJs = fs.readFileSync(path.join(HYDRA, 'hydra-execute.js'), 'utf8');
  check('shared execute module runs Enable / Disable Joystick',
    executeJs.includes("if (isType(ctx.joystickModule, 'isJoystickAction', type))") &&
    executeJs.includes("type === 'enableJoystick'") &&
    executeJs.includes("type === 'disableJoystick'") &&
    executeJs.includes('JM.joystickEnd(ctx.joystick, ctx.joystick.pointerId)'));
  const conditionsJs = fs.readFileSync(path.join(HYDRA, 'hydra-conditions.js'), 'utf8');
  check('shared conditions module reads Joystick Active and Joystick Tilt',
    conditionsJs.includes("case 'joystickActive':") &&
    conditionsJs.includes("case 'joystickTilt':") &&
    conditionsJs.includes('Jm.isSteering(ctx.joystick)') &&
    conditionsJs.includes('Jt.joystickTilt(ctx.joystick, data.direction, minTilt)'));
  check('shared conditions module does not freeze the joystick reads while paused',
    !fs.readFileSync(path.join(HYDRA, 'hydra-conditions.js'), 'utf8')
      .split('FROZEN_WHILE_PAUSED = [')[1].split('];')[0]
      .includes('joystickActive'));
  const flowJs = fs.readFileSync(path.join(HYDRA, 'hydra-flow.js'), 'utf8');
  check('flow module reads both joystick conditions as level triggers',
    flowJs.includes("t === 'joystickActive' || t === 'joystickTilt'"));
  const frameJs = fs.readFileSync(path.join(HYDRA, 'hydra-frame.js'), 'utf8');
  check('frame module runs updateJoystick after pollInput and before runScripts',
    frameJs.includes("'updateUiWidgets', 'resetContexts', 'pollInput', 'updateJoystick', 'runScripts',") &&
    frameJs.includes("call('updateJoystick', host.updateJoystick);"));
  const actionsJs = fs.readFileSync(path.join(HYDRA, 'hydra-actions.js'), 'utf8');
  check('actions module holds joystick-driven actions like a key',
    actionsJs.includes('var joy = asSet(sources.joystick);') &&
    actionsJs.includes("|| joy.has(name)"));
  const catalogJs = fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8');
  check('catalog carries the four joystick blocks in the Input category',
    catalogJs.includes("blockType: 'enable-joystick'") &&
    catalogJs.includes("runtimeType: 'enableJoystick'") &&
    catalogJs.includes("blockType: 'disable-joystick'") &&
    catalogJs.includes("runtimeType: 'disableJoystick'") &&
    catalogJs.includes("blockType: 'joystick-active'") &&
    catalogJs.includes("runtimeType: 'joystickActive'") &&
    catalogJs.includes("blockType: 'joystick-tilt'") &&
    catalogJs.includes("runtimeType: 'joystickTilt'") &&
    catalogJs.includes("key: 'direction', label: 'Direction'") &&
    catalogJs.includes("key: 'minTilt', label: 'Min tilt (0-1)'"));
  const universalJs = fs.readFileSync(path.join(HYDRA, 'hydra-universal.js'), 'utf8');
  check('universal normalizer defaults the joystick config off',
    universalJs.includes('project.virtualJoystick') &&
    universalJs.includes("anchor: 'bottom-left', x: 120, y: 480, radius: 60"));
  const scriptJs = fs.readFileSync(path.join(HYDRA, 'script.js'), 'utf8');
  check('editor wires the Joystick tab and draws the stick in the preview',
    scriptJs.includes('function getProjectJoystickConfig()') &&
    scriptJs.includes('function getMutableJoystickConfig()') &&
    scriptJs.includes('function renderJoystickPanel()') &&
    scriptJs.includes('function initJoystickPanel()') &&
    scriptJs.includes('getProjectJoystickConfig, getProjectId') &&
    scriptJs.includes('J.drawJoystick(ctx, PR.joystickRuntimeForDraw(), getProjectJoystickConfig(), canvas.width, canvas.height)'));
  const refMd = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');
  check('block reference documents all four joystick blocks',
    refMd.includes('Enable Joystick') && refMd.includes('Disable Joystick') &&
    refMd.includes('Joystick Active') && refMd.includes('Joystick Tilt'));
  const guideMd = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');
  check('user guide covers the virtual joystick',
    guideMd.includes('## Virtual joystick') && guideMd.includes('Enable Joystick'));
}

process.exit(failures === 0 ? 0 : 1);
