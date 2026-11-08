// Unit tests for hydra/hydra-pause.js — the shared pause/resume module.
//
// Pure logic: pause/resume/toggle state transitions, isPaused coercion of
// missing/legacy state objects, paused-frame clock accounting (notePausedFrame),
// and the frozen game clock (gameNow). Nothing here touches the DOM; both
// runtimes delegate to this module.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const sandbox = {};
sandbox.window = sandbox; // hydra-pause.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-pause.js'), 'utf8'),
  sandbox, { filename: 'hydra-pause.js' });
const P = sandbox.HydraPause;

check('HydraPause exposed with helpers',
  !!P && typeof P.isPaused === 'function' && typeof P.pause === 'function' &&
  typeof P.resume === 'function' && typeof P.toggle === 'function' &&
  typeof P.notePausedFrame === 'function' && typeof P.gameNow === 'function');
check('factorySource is a self-contained function string',
  typeof P.factorySource === 'string' && P.factorySource.includes('hydraPauseFactory'));

// --- state transitions ---
{
  const s = {};
  check('fresh state reads as not paused', P.isPaused(s) === false);
  check('pause() freezes and returns true', P.pause(s) === true && s.paused === true);
  check('pause() is idempotent', P.pause(s) === true && s.paused === true);
  check('resume() unfreezes and returns false', P.resume(s) === false && s.paused === false);
  check('resume() is idempotent', P.resume(s) === false && s.paused === false);
  check('toggle() pauses when running', P.toggle(s) === true && s.paused === true);
  check('toggle() resumes when paused', P.toggle(s) === false && s.paused === false);
}

// --- backward compatibility: legacy states lack the new fields ---
{
  check('null state reads as not paused', P.isPaused(null) === false);
  check('undefined state reads as not paused', P.isPaused(undefined) === false);
  check('pause(null) does not throw and returns true', P.pause(null) === true);
  check('resume(null) does not throw and returns false', P.resume(null) === false);
  check('toggle(null) does not throw and returns false', P.toggle(null) === false);
  const legacy = { someOtherField: 1 };
  check('legacy state without paused field reads as not paused', P.isPaused(legacy) === false);
  P.pause(legacy);
  check('pause() writes onto legacy state', legacy.paused === true);
}

// --- frozen game clock ---
{
  const s = {};
  check('gameNow passes the clock through when never paused', P.gameNow(s, 1000) === 1000);
  P.pause(s);
  P.notePausedFrame(s, 16.67);
  P.notePausedFrame(s, 16.67);
  P.notePausedFrame(s, 16.66);
  check('paused frames accumulate pausedElapsedMs', Math.abs(s.pausedElapsedMs - 50) < 0.001, String(s.pausedElapsedMs));
  check('gameNow freezes out paused time', Math.abs(P.gameNow(s, 1050) - 1000) < 0.001, String(P.gameNow(s, 1050)));
  P.resume(s);
  check('unpaused frames do not accumulate', (() => { P.notePausedFrame(s, 100); return Math.abs(s.pausedElapsedMs - 50) < 0.001; })());
  check('gameNow keeps the offset after resume (clock resumes, never jumps back)',
    Math.abs(P.gameNow(s, 2000) - 1950) < 0.001, String(P.gameNow(s, 2000)));
  // a second pause keeps accumulating from the stored offset
  P.pause(s);
  P.notePausedFrame(s, 25);
  check('second pause accumulates on top', Math.abs(s.pausedElapsedMs - 75) < 0.001, String(s.pausedElapsedMs));
}

// --- time-scale debt in the game clock (P4 Advanced batch 13) ---
{
  check('gameNow subtracts the time-scale debt alongside paused time',
    P.gameNow({ pausedElapsedMs: 100, timeScaleDebtMs: 50 }, 1000) === 850);
  check('a negative debt runs the clock ahead (double speed)',
    P.gameNow({ timeScaleDebtMs: -50 }, 1000) === 1050);
  check('a junk debt reads as 0', P.gameNow({ timeScaleDebtMs: 'junk' }, 500) === 500);
  check('a missing debt reads as 0 (old states keep working)',
    P.gameNow({ pausedElapsedMs: 100 }, 1000) === 900);
  check('gameNow with debt only (no pause) lags the wall clock',
    P.gameNow({ timeScaleDebtMs: 250 }, 1000) === 750);
}

// --- bad-data safety: the module never throws ---
{
  const s = { paused: true };
  let threw = false;
  try {
    P.notePausedFrame(s, -5);      // negative length ignored
    P.notePausedFrame(s, NaN);
    P.notePausedFrame(s, 'junk');
    P.notePausedFrame(null, 10);
    P.gameNow(null, 500);
    P.gameNow({}, NaN);
    P.gameNow({ pausedElapsedMs: 'junk' }, 500);
  } catch (e) { threw = true; }
  check('notePausedFrame/gameNow never throw on bad input', threw === false);
  check('negative/bad frame lengths are ignored (field stays unset)',
    s.pausedElapsedMs === undefined, String(s.pausedElapsedMs));
  check('bad clock reads as 0 minus offset', P.gameNow(null, NaN) === 0);
}

if (failures) { console.error(`${failures} assertion(s) failed`); process.exit(1); }
console.log('pause.test.js: all assertions passed');
