// Unit tests for hydra/hydra-camerafx.js — the shared camera-effects module
// (P2 item 15/12, slice 1: the shared-engine extraction starts here).
//
// Pure logic: screen shake + screen flash state, triggers, decay, and the
// draw-time shake offset / flash alpha. Nothing here touches the DOM; both
// runtimes (editor preview in script.js, export player in
// player-runtime.js) delegate to this module, so a behavior change here
// changes both at once — which is the point of the extraction.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const sandbox = {};
sandbox.window = sandbox; // hydra-camerafx.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-camerafx.js'), 'utf8'),
  sandbox, { filename: 'hydra-camerafx.js' });
const FX = sandbox.HydraCameraFx;

check('HydraCameraFx exposed with helpers',
  !!FX && typeof FX.isValidHexColor === 'function' &&
  typeof FX.createShake === 'function' && typeof FX.createFlash === 'function' &&
  typeof FX.normalizeShake === 'function' && typeof FX.normalizeFlash === 'function' &&
  typeof FX.triggerShake === 'function' && typeof FX.triggerFlash === 'function' &&
  typeof FX.decay === 'function' && typeof FX.shakeOffset === 'function' &&
  typeof FX.flashAlpha === 'function');
check('factorySource is a self-contained function string',
  typeof FX.factorySource === 'string' && FX.factorySource.includes('hydraCameraFxFactory'));

// --- color validation ---
{
  check('isValidHexColor accepts #rgb', FX.isValidHexColor('#fff') === true);
  check('isValidHexColor accepts #rrggbb', FX.isValidHexColor('#ff0000') === true);
  check('isValidHexColor accepts uppercase hex', FX.isValidHexColor('#FF00AA') === true);
  check('isValidHexColor trims whitespace', FX.isValidHexColor('  #00ff00  ') === true);
  check('isValidHexColor rejects a bare name', FX.isValidHexColor('red') === false);
  check('isValidHexColor rejects a missing #', FX.isValidHexColor('ff0000') === false);
  check('isValidHexColor rejects 4/5/7 digits', FX.isValidHexColor('#ffff') === false &&
    FX.isValidHexColor('#fffff') === false && FX.isValidHexColor('#fffffff') === false);
  check('isValidHexColor rejects non-hex digits', FX.isValidHexColor('#gg0000') === false);
  check('isValidHexColor rejects non-strings', FX.isValidHexColor(null) === false &&
    FX.isValidHexColor(123) === false && FX.isValidHexColor(undefined) === false);
}

// --- fresh records ---
{
  const s = FX.createShake();
  check('createShake starts idle', s.strength === 0 && s.timeLeft === 0);
  const f = FX.createFlash();
  check('createFlash starts idle (white, 0 intensity, no time)',
    f.color === '#ffffff' && f.intensity === 0 && f.timeLeft === 0 && f.maxTime === 0);
  check('fresh records are independent objects', FX.createShake() !== FX.createShake() &&
    FX.createFlash() !== FX.createFlash());
}

// --- normalization repairs corrupt records in place ---
{
  const s = FX.normalizeShake({ strength: -5, timeLeft: 'abc' });
  check('normalizeShake floors negatives and coerces NaN to 0',
    s.strength === 0 && s.timeLeft === 0);
  const s2 = FX.normalizeShake({ strength: 8, timeLeft: 120 });
  check('normalizeShake keeps valid values', s2.strength === 8 && s2.timeLeft === 120);
  check('normalizeShake(null) returns a fresh idle record',
    JSON.stringify(FX.normalizeShake(null)) === JSON.stringify({ strength: 0, timeLeft: 0 }));
  check('normalizeShake("junk") returns a fresh idle record',
    JSON.stringify(FX.normalizeShake('junk')) === JSON.stringify({ strength: 0, timeLeft: 0 }));
  const f = FX.normalizeFlash({ color: 'not-a-color', intensity: 2, timeLeft: -10, maxTime: 50 });
  check('normalizeFlash falls back a bad color to white, clamps intensity, floors time',
    f.color === '#ffffff' && f.intensity === 1 && f.timeLeft === 0 && f.maxTime === 50);
  const f2 = FX.normalizeFlash({ color: '  #0f0 ', intensity: 0.5, timeLeft: 100, maxTime: 200 });
  check('normalizeFlash keeps a valid record and trims the color',
    f2.color === '#0f0' && f2.intensity === 0.5 && f2.timeLeft === 100 && f2.maxTime === 200);
  check('normalizeFlash(null) returns a fresh idle record',
    JSON.stringify(FX.normalizeFlash(null)) === JSON.stringify(FX.createFlash()));
}

// --- triggerShake: replaces the running shake, clamps, never NaN ---
{
  const s = FX.createShake();
  const out = FX.triggerShake(s, 6, 200);
  check('triggerShake sets strength and time', s.strength === 6 && s.timeLeft === 200);
  check('triggerShake mutates in place (same record identity)', out === s);
  FX.triggerShake(s, 3, 100);
  check('triggerShake replaces the running shake outright', s.strength === 3 && s.timeLeft === 100);
  FX.triggerShake(s, -4, -50);
  check('triggerShake clamps negative strength/duration to 0', s.strength === 0 && s.timeLeft === 0);
  FX.triggerShake(s, NaN, NaN);
  check('triggerShake never stores NaN', s.strength === 0 && s.timeLeft === 0 &&
    !Number.isNaN(s.strength) && !Number.isNaN(s.timeLeft));
  FX.triggerShake(s, Infinity, Infinity);
  check('triggerShake coerces Infinity to 0', s.strength === 0 && s.timeLeft === 0);
}

// --- triggerFlash: fires, holds on a bad color, clamps, zero is a no-op ---
{
  const f = FX.createFlash();
  const fired = FX.triggerFlash(f, '#ff0000', 0.6, 200);
  check('triggerFlash fires on a valid color', fired === true &&
    f.color === '#ff0000' && f.intensity === 0.6 && f.timeLeft === 200 && f.maxTime === 200);
  const before = JSON.stringify(f);
  check('triggerFlash returns false on a bad color and holds the old flash',
    FX.triggerFlash(f, 'not-a-color', 0.9, 500) === false && JSON.stringify(f) === before);
  check('triggerFlash returns false on a blank color and holds',
    FX.triggerFlash(f, '', 0.9, 500) === false && JSON.stringify(f) === before);
  check('triggerFlash trims the color', FX.triggerFlash(f, '  #00ff00 ', 0.5, 100) === true &&
    f.color === '#00ff00');
  check('triggerFlash accepts a 3-digit hex', FX.triggerFlash(f, '#f0a', 0.5, 100) === true &&
    f.color === '#f0a');
  FX.triggerFlash(f, '#ff0000', 2, 200);
  check('triggerFlash clamps intensity above 1 down to 1', f.intensity === 1);
  FX.triggerFlash(f, '#ff0000', -0.5, 200);
  check('triggerFlash clamps negative intensity up to 0', f.intensity === 0);
  FX.triggerFlash(f, '#ff0000', 0.6, 0);
  check('triggerFlash with zero duration records timeLeft/maxTime 0 (no-op flash)',
    f.timeLeft === 0 && f.maxTime === 0 && f.color === '#ff0000' && f.intensity === 0.6);
  FX.triggerFlash(f, '#ff0000', 0.6, -100);
  check('triggerFlash with a negative duration records timeLeft/maxTime 0',
    f.timeLeft === 0 && f.maxTime === 0);
  FX.triggerFlash(f, '#ff0000', NaN, NaN);
  check('triggerFlash never stores NaN', f.intensity === 0 && f.timeLeft === 0 &&
    f.maxTime === 0 && !Number.isNaN(f.intensity));
  check('triggerFlash repairs a corrupt record before firing',
    FX.triggerFlash({ color: 'junk', intensity: 9, timeLeft: -5, maxTime: -5 },
      '#123456', 0.5, 100) === true);
}

// --- decay: both effects, floored at 0, hostile steps safe ---
{
  const s = FX.createShake(), f = FX.createFlash();
  FX.triggerShake(s, 6, 200);
  FX.triggerFlash(f, '#ff0000', 0.6, 200);
  FX.decay(s, f, 16.67);
  check('decay subtracts the step from both timeLefts',
    Math.abs(s.timeLeft - 183.33) < 0.01 && Math.abs(f.timeLeft - 183.33) < 0.01,
    `shake=${s.timeLeft} flash=${f.timeLeft}`);
  FX.decay(s, f, 500);
  check('decay floors both timeLefts at 0', s.timeLeft === 0 && f.timeLeft === 0);
  FX.triggerShake(s, 6, 100);
  FX.decay(s, f, -10);
  check('decay with a negative step decays nothing', s.timeLeft === 100);
  FX.decay(s, f, NaN);
  check('decay with a NaN step decays nothing', s.timeLeft === 100);
  check('decay tolerates null records', (() => { FX.decay(null, null, 16.67); return true; })());
  check('decay tolerates a null shake with a live flash', (() => {
    FX.decay(null, f, 16.67); return true;
  })());
}

// --- shakeOffset: idle is {0,0}, active stays inside the strength ---
{
  const s = FX.createShake();
  check('shakeOffset is {0,0} when idle', JSON.stringify(FX.shakeOffset(s)) === '{"x":0,"y":0}');
  FX.triggerShake(s, 6, 200);
  let inBounds = true, sawNonZero = false;
  for (let i = 0; i < 50; i++) {
    const o = FX.shakeOffset(s);
    if (Math.abs(o.x) > 6 || Math.abs(o.y) > 6) inBounds = false;
    if (o.x !== 0 || o.y !== 0) sawNonZero = true;
  }
  check('shakeOffset stays within +-strength on both axes', inBounds);
  check('shakeOffset actually jitters (not always zero)', sawNonZero);
  FX.triggerShake(s, 0, 200);
  check('shakeOffset is {0,0} at zero strength', JSON.stringify(FX.shakeOffset(s)) === '{"x":0,"y":0}');
  FX.triggerShake(s, 6, 0);
  check('shakeOffset is {0,0} when time has run out', JSON.stringify(FX.shakeOffset(s)) === '{"x":0,"y":0}');
  check('shakeOffset(null) is {0,0}', JSON.stringify(FX.shakeOffset(null)) === '{"x":0,"y":0}');
}

// --- flashAlpha: the linear fade, clamped, 0 when inactive ---
{
  const f = FX.createFlash();
  check('flashAlpha is 0 when idle', FX.flashAlpha(f) === 0);
  FX.triggerFlash(f, '#ff0000', 0.6, 200);
  check('flashAlpha is the full intensity at the start', FX.flashAlpha(f) === 0.6);
  f.timeLeft = 100;
  check('flashAlpha is half the intensity at half time', Math.abs(FX.flashAlpha(f) - 0.3) < 1e-9,
    String(FX.flashAlpha(f)));
  f.timeLeft = 0;
  check('flashAlpha is 0 at the end', FX.flashAlpha(f) === 0);
  check('flashAlpha clamps above 1', FX.flashAlpha({ color: '#fff', intensity: 2, timeLeft: 100, maxTime: 100 }) === 1);
  check('flashAlpha is 0 when maxTime is 0', FX.flashAlpha({ color: '#fff', intensity: 0.6, timeLeft: 100, maxTime: 0 }) === 0);
  check('flashAlpha is 0 at zero intensity', FX.flashAlpha({ color: '#fff', intensity: 0, timeLeft: 100, maxTime: 200 }) === 0);
  check('flashAlpha(null) is 0', FX.flashAlpha(null) === 0);
  check('flashAlpha never returns NaN on corrupt input',
    FX.flashAlpha({ color: '#fff', intensity: NaN, timeLeft: NaN, maxTime: NaN }) === 0);
}

// --- static routing: both runtimes delegate, nothing duplicated ---
{
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'index.html'), 'utf8');
  const camTag = indexHtml.indexOf('src="hydra-camerafx.js');
  const playerTag = indexHtml.indexOf('src="player-runtime.js');
  const scriptTag = indexHtml.indexOf('src="script.js');
  check('index.html loads hydra-camerafx.js before player-runtime.js and script.js',
    camTag !== -1 && playerTag !== -1 && scriptTag !== -1 && camTag < playerTag && camTag < scriptTag,
    `camTag=${camTag} playerTag=${playerTag} scriptTag=${scriptTag}`);
  const playerSrc = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'player-runtime.js'), 'utf8');
  check('player-runtime.js hard-guards on HydraCameraFx',
    /requires hydra-camerafx\.js \(window\.HydraCameraFx\)/.test(playerSrc));
  check('player-runtime.js inlines HydraCameraFx into exports',
    playerSrc.includes("['HydraCameraFx', global.HydraCameraFx && global.HydraCameraFx.factorySource, 'hydra-camerafx.js (window.HydraCameraFx)']"));
  check('player-runtime.js no longer defines its own isValidHexColor',
    !/function isValidHexColor/.test(playerSrc));
  check('player-runtime.js no longer inlines the shake decay math',
    !/state\.shake\.timeLeft = Math\.max\(0, state\.shake\.timeLeft/.test(playerSrc));
  check('player-runtime.js no longer inlines the flash decay math',
    !/state\.flash\.timeLeft = Math\.max\(0, state\.flash\.timeLeft/.test(playerSrc));
  check('player-runtime.js no longer inlines the flash alpha math',
    !/flash\.intensity \* \(flash\.timeLeft \/ flash\.maxTime\)/.test(playerSrc));
  check('player-runtime.js no longer inlines the random shake jitter',
    !/Math\.random\(\) \* 2 - 1\) \* state\.shake\.strength/.test(playerSrc));
  const scriptSrc = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'script.js'), 'utf8');
  check('script.js delegates shake/flash state to HydraCameraFx',
    scriptSrc.includes('window.HydraCameraFx.createShake()') &&
    scriptSrc.includes('window.HydraCameraFx.createFlash()'));
  // P2 item 14 slice 8: the per-frame decay lives in the preview runtime
  // module's gameLoop now (the old script.js gameLoop called it inline).
  const moduleSrc = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-previewruntime.js'), 'utf8');
  check('the preview runtime module delegates decay to HydraCameraFx',
    moduleSrc.includes('Fx.decay(r.cameraShake, r.flash, dtMs);'));
  // P2 item 15/12 slice 9: the shake/flash triggers moved into the shared
  // HydraExecute module; both runtimes pass HydraCameraFx through their
  // action context and the module triggers through ctx.cameraFx.
  const executeSrc = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-execute.js'), 'utf8');
  check('script.js passes HydraCameraFx into the shared execute module',
    scriptSrc.includes('cameraFx: window.HydraCameraFx || null'));
  check('player-runtime.js passes HydraCameraFx into the shared execute module',
    playerSrc.includes('cameraFx: HydraCameraFx,'));
  check('hydra-execute.js triggers the shake through ctx.cameraFx',
    executeSrc.includes('ctx.cameraFx.triggerShake(ctx.shake,'));
  check('hydra-execute.js triggers the flash through ctx.cameraFx',
    executeSrc.includes('ctx.cameraFx.triggerFlash(ctx.flash,'));
  check('script.js no longer inlines the shake trigger',
    !scriptSrc.includes('window.HydraCameraFx.triggerShake(previewState.cameraShake'));
  check('script.js no longer inlines the flash trigger',
    !scriptSrc.includes('window.HydraCameraFx.triggerFlash(previewState.flash'));
  check('script.js no longer inlines the shake decay math',
    !/previewState\.cameraShake\.timeLeft = Math\.max\(0, previewState\.cameraShake\.timeLeft/.test(scriptSrc));
  check('script.js no longer inlines the flash decay math',
    !/previewState\.flash\.timeLeft = Math\.max\(0, previewState\.flash\.timeLeft/.test(scriptSrc));
  check('script.js no longer inlines the flash alpha math',
    !/flash\.intensity \* \(flash\.timeLeft \/ flash\.maxTime\)/.test(scriptSrc));
  check('script.js no longer inlines the random shake jitter',
    !/Math\.random\(\) \* 2 - 1\) \* shake\.strength/.test(scriptSrc));
  check('script.js no longer inlines the hex-color regex',
    !scriptSrc.includes('/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/'));
}

if (failures) { console.error(`${failures} assertion(s) failed`); process.exit(1); }
console.log('camerafx.test.js: all assertions passed');
