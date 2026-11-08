// Unit tests for hydra/hydra-actions.js — the shared action-based input
// module.
//
// Pure logic: action list normalization, runtime state creation, per-frame
// update from keyboard key sets + gamepad buttons + touch zones, remapping,
// reset to defaults, edge detection for gamepad/touch sources, and corrupt
// data safety. Nothing here touches the DOM; both runtimes delegate to
// this module.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const sandbox = {};
sandbox.window = sandbox; // hydra-actions.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-actions.js'), 'utf8'),
  sandbox, { filename: 'hydra-actions.js' });
const A = sandbox.HydraActions;

// Alias-aware matcher like HydraInput.keySetHas: 'Space' matches ' '.
function aliasHas(set, key) {
  if (set.has(key)) return true;
  if (key === 'Space' && set.has(' ')) return true;
  if (key === ' ' && set.has('Space')) return true;
  return false;
}

check('HydraActions exposed with helpers',
  !!A && typeof A.normalizeActions === 'function' && typeof A.createRuntimeState === 'function' &&
  typeof A.update === 'function' && typeof A.remapAction === 'function' &&
  typeof A.resetBindings === 'function' && typeof A.pollGamepadButtons === 'function' &&
  typeof A.zonesAt === 'function' && typeof A.defaultPlatformerActions === 'function');
check('factorySource is a self-contained function string',
  typeof A.factorySource === 'string' && A.factorySource.includes('hydraActionsFactory'));
check('16 standard gamepad buttons listed', A.GAMEPAD_BUTTONS.length === 16, String(A.GAMEPAD_BUTTONS.length));
check('4 touch zones listed', A.TOUCH_ZONES.length === 4, A.TOUCH_ZONES.join(','));

// ---------- normalization ----------
{
  check('non-array normalizes to []', A.normalizeActions(null).length === 0);
  const list = A.normalizeActions([
    { name: 'Jump', keys: ['Space', 'KeyW'], gamepad: 0, touch: 'none' },
    { name: '  Move Left  ', keys: ['ArrowLeft'], gamepad: 14, touch: 'left-half' },
    { name: '', keys: ['x'] },                       // blank name dropped
    { name: 'Jump', keys: ['z'] },                   // duplicate dropped
    { name: 'Bad', keys: 'not-an-array', gamepad: 99, touch: 'moon' },
    null, 42, 'nope',                               // junk entries dropped
    { name: 'Legacy', key: 'Enter' },                // legacy single key field
  ]);
  check('clean list has 4 actions', list.length === 4, JSON.stringify(list.map(a => a.name)));
  check('name trimmed', list[1].name === 'Move Left', list[1].name);
  check('bad gamepad coerced to -1', list[2].gamepad === -1, String(list[2].gamepad));
  check('bad touch coerced to none', list[2].touch === 'none', list[2].touch);
  check('legacy key field works', list[3].keys.join(',') === 'Enter', list[3].keys.join(','));
  check('names helper', A.actionNames(list).join(',') === 'Jump,Move Left,Bad,Legacy',
    A.actionNames(list).join(','));
}

// ---------- keyboard state ----------
{
  const st = A.createRuntimeState([
    { name: 'Jump', keys: ['Space', 'KeyW'], gamepad: -1, touch: 'none' }
  ]);
  check('hasAction true/false', A.hasAction(st, 'Jump') && !A.hasAction(st, 'Missing'));
  check('unknown action reads false', !A.actionHeld(st, 'Missing'));
  const src = { keys: new Set(), keysJustPressed: new Set(), keysJustReleased: new Set(),
    gamepad: new Set(), touchZones: new Set(), keySetHas: aliasHas };
  A.update(st, src);
  check('idle: not held', !A.actionHeld(st, 'Jump') && !A.actionJustPressed(st, 'Jump'));
  src.keys.add('Space'); src.keysJustPressed.add('Space');
  A.update(st, src);
  check('key down: held + just pressed', A.actionHeld(st, 'Jump') && A.actionJustPressed(st, 'Jump'));
  src.keysJustPressed.clear();
  A.update(st, src);
  check('held next frame, no edge', A.actionHeld(st, 'Jump') && !A.actionJustPressed(st, 'Jump'));
  src.keys.delete('Space'); src.keysJustReleased.add('Space');
  A.update(st, src);
  check('released: not held + just released', !A.actionHeld(st, 'Jump') && A.actionJustReleased(st, 'Jump'));
  src.keysJustReleased.clear();
  A.update(st, src);
  check('edge cleared next frame', !A.actionJustReleased(st, 'Jump'));
  // Alias: ' ' matches the 'Space' binding.
  src.keys.add(' '); src.keysJustPressed.add(' ');
  A.update(st, src);
  check('alias key matches binding', A.actionHeld(st, 'Jump') && A.actionJustPressed(st, 'Jump'));
}

// ---------- gamepad routing ----------
{
  const st = A.createRuntimeState([
    { name: 'Jump', keys: [], gamepad: 0, touch: 'none' },
    { name: 'Shoot', keys: ['KeyF'], gamepad: -1, touch: 'none' }
  ]);
  const src = { keys: new Set(), keysJustPressed: new Set(), keysJustReleased: new Set(),
    gamepad: new Set(), touchZones: new Set(), keySetHas: aliasHas };
  A.update(st, src);
  check('gamepad idle: not held', !A.actionHeld(st, 'Jump'));
  src.gamepad.add(0);
  A.update(st, src);
  check('gamepad button 0: held + just pressed', A.actionHeld(st, 'Jump') && A.actionJustPressed(st, 'Jump'));
  A.update(st, src);
  check('gamepad held next frame, no edge', A.actionHeld(st, 'Jump') && !A.actionJustPressed(st, 'Jump'));
  src.gamepad.clear();
  A.update(st, src);
  check('gamepad release: just released', !A.actionHeld(st, 'Jump') && A.actionJustReleased(st, 'Jump'));
  // pollGamepadButtons through an injected getter
  const pads = A.pollGamepadButtons(() => ([
    { buttons: [{ pressed: true }, { pressed: false, value: 0.7 }, { pressed: false, value: 0.1 }] }
  ]));
  check('pollGamepadButtons reads pressed + value>0.5', pads.has(0) && pads.has(1) && !pads.has(2),
    [...pads].join(','));
  check('pollGamepadButtons survives throwing getter', A.pollGamepadButtons(() => { throw new Error('x'); }).size === 0);
  check('pollGamepadButtons survives missing getter', A.pollGamepadButtons().size === 0);
}

// ---------- batch 7: gamepad connection + stick axes (raw input blocks) ----------
{
  check('isGamepadConnected exposed', typeof A.isGamepadConnected === 'function');
  check('isGamepadConnected true with one pad', A.isGamepadConnected(() => [null, { buttons: [] }]) === true);
  check('isGamepadConnected false with no pads', A.isGamepadConnected(() => [null, null]) === false);
  check('isGamepadConnected false with empty list', A.isGamepadConnected(() => []) === false);
  check('isGamepadConnected survives throwing getter', A.isGamepadConnected(() => { throw new Error('x'); }) === false);
  check('isGamepadConnected survives missing getter', A.isGamepadConnected() === false);

  check('pollGamepadAxes exposed', typeof A.pollGamepadAxes === 'function');
  const axes = A.pollGamepadAxes(() => [{ axes: [0.5, -0.75, 0, 1] }]);
  check('pollGamepadAxes reads all four axes', axes.lx === 0.5 && axes.ly === -0.75 && axes.rx === 0 && axes.ry === 1,
    JSON.stringify(axes));
  const clamped = A.pollGamepadAxes(() => [{ axes: [2, -3, NaN, Infinity] }]);
  check('pollGamepadAxes clamps + repairs', clamped.lx === 1 && clamped.ly === -1 && clamped.rx === 0 && clamped.ry === 0,
    JSON.stringify(clamped));
  const firstPad = A.pollGamepadAxes(() => [null, { axes: [0.1, 0.2, 0.3, 0.4] }]);
  check('pollGamepadAxes skips null pads', firstPad.lx === 0.1 && firstPad.ry === 0.4, JSON.stringify(firstPad));
  const noPad = A.pollGamepadAxes(() => []);
  check('pollGamepadAxes zero when no pads', noPad.lx === 0 && noPad.ly === 0 && noPad.rx === 0 && noPad.ry === 0);
  const noAxes = A.pollGamepadAxes(() => [{ buttons: [] }]);
  check('pollGamepadAxes zero when pad has no axes', noAxes.lx === 0 && noAxes.ry === 0);
  const hostile = A.pollGamepadAxes(() => { throw new Error('x'); });
  check('pollGamepadAxes survives throwing getter', hostile.lx === 0 && hostile.ry === 0);
}

// ---------- touch zones ----------
{
  const z1 = A.zonesAt(100, 100, 800, 600);
  check('top-left point is in left-half + top-half', z1.includes('left-half') && z1.includes('top-half'), z1.join(','));
  const z2 = A.zonesAt(700, 500, 800, 600);
  check('bottom-right point is in right-half + bottom-half', z2.includes('right-half') && z2.includes('bottom-half'), z2.join(','));
  const st = A.createRuntimeState([
    { name: 'Move Left', keys: [], gamepad: -1, touch: 'left-half' }
  ]);
  const src = { keys: new Set(), keysJustPressed: new Set(), keysJustReleased: new Set(),
    gamepad: new Set(), touchZones: new Set(), keySetHas: aliasHas };
  src.touchZones.add('right-half');
  A.update(st, src);
  check('wrong zone: not held', !A.actionHeld(st, 'Move Left'));
  src.touchZones.add('left-half');
  A.update(st, src);
  check('zone active: held + just pressed', A.actionHeld(st, 'Move Left') && A.actionJustPressed(st, 'Move Left'));
  // Multi-touch: both zones active at once (two fingers).
  const st2 = A.createRuntimeState([
    { name: 'Move Left', keys: [], gamepad: -1, touch: 'left-half' },
    { name: 'Jump', keys: [], gamepad: -1, touch: 'right-half' }
  ]);
  const src2 = { keys: new Set(), keysJustPressed: new Set(), keysJustReleased: new Set(),
    gamepad: new Set(), touchZones: new Set(['left-half', 'right-half']), keySetHas: aliasHas };
  A.update(st2, src2);
  check('multi-touch: both actions held', A.actionHeld(st2, 'Move Left') && A.actionHeld(st2, 'Jump'));
  src2.touchZones.clear();
  A.update(st2, src2);
  check('touch release: both just released',
    A.actionJustReleased(st2, 'Move Left') && A.actionJustReleased(st2, 'Jump'));
}

// ---------- remap / reset ----------
{
  const st = A.createRuntimeState([
    { name: 'Jump', keys: ['Space'], gamepad: 0, touch: 'none' }
  ]);
  const src = { keys: new Set(), keysJustPressed: new Set(), keysJustReleased: new Set(),
    gamepad: new Set(), touchZones: new Set(), keySetHas: aliasHas };
  check('remap unknown action fails', !A.remapAction(st, 'Missing', 'KeyJ'));
  check('remap blank key fails', !A.remapAction(st, 'Jump', '   '));
  check('remap works', A.remapAction(st, 'Jump', 'KeyJ'));
  src.keys.add('Space'); src.keysJustPressed.add('Space');
  A.update(st, src);
  check('old key no longer fires', !A.actionHeld(st, 'Jump'));
  src.keys.clear(); src.keysJustPressed.clear();
  src.keys.add('KeyJ'); src.keysJustPressed.add('KeyJ');
  A.update(st, src);
  check('new key fires', A.actionHeld(st, 'Jump') && A.actionJustPressed(st, 'Jump'));
  A.resetBindings(st);
  src.keys.clear(); src.keysJustPressed.clear();
  src.keys.add('Space'); src.keysJustPressed.add('Space');
  A.update(st, src);
  check('reset restores Space binding', A.actionHeld(st, 'Jump') && A.actionJustPressed(st, 'Jump'));
  check('reset restores gamepad binding', st.bindings.Jump.gamepad === 0, String(st.bindings.Jump.gamepad));
}

// ---------- corrupt data never throws ----------
{
  const st = A.createRuntimeState(null);
  A.update(st, null);
  A.update(st, { keys: 'nope' });
  check('null state reads false', !A.actionHeld(null, 'Jump') && !A.actionJustPressed(null, 'Jump'));
  check('remap on null state fails', !A.remapAction(null, 'Jump', 'KeyJ'));
  A.resetBindings(null);
  check('normalize never throws on junk', A.normalizeActions([{ name: {}, keys: [{}], gamepad: 'x' }]).length >= 0);
}

// ---------- platformer preset ----------
{
  const preset = A.defaultPlatformerActions();
  const names = preset.map(a => a.name);
  check('preset has 5 actions', names.length === 5, names.join(','));
  check('preset jump binds Space + gamepad A', preset[2].keys.includes('Space') && preset[2].gamepad === 0);
  check('preset move left binds left-half touch', preset[0].touch === 'left-half');
  check('preset normalizes cleanly', A.normalizeActions(preset).length === 5);
}

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nAll action tests passed.');
