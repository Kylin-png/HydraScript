// Unit tests for hydra/hydra-trace.js — the shared flow tracer module
// (P4 item 36, phase C).
//
// Pure logic: tracer lifecycle (enable/disable/toggle), capped ring
// recording, last-fired tracking, recency checks, event formatting, and
// hostile-input safety. Nothing here touches the DOM; both runtimes
// delegate to this module.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const sandbox = {};
sandbox.window = sandbox; // hydra-trace.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-trace.js'), 'utf8'),
  sandbox, { filename: 'hydra-trace.js' });
const T = sandbox.HydraTrace;

check('HydraTrace exposed with helpers',
  !!T && typeof T.createTracer === 'function' && typeof T.isEnabled === 'function' &&
  typeof T.enable === 'function' && typeof T.disable === 'function' &&
  typeof T.toggle === 'function' && typeof T.record === 'function' &&
  typeof T.recent === 'function' && typeof T.clear === 'function' &&
  typeof T.lastFiredFrame === 'function' && typeof T.firedRecently === 'function' &&
  typeof T.formatEvent === 'function');
check('factorySource is a self-contained function string',
  typeof T.factorySource === 'string' && T.factorySource.includes('hydraTraceFactory'));

// --- lifecycle: off by default, enable/disable/toggle ---
{
  const tr = T.createTracer();
  check('tracer starts disabled with an empty ring', !T.isEnabled(tr) && tr.events.length === 0);
  check('enable returns true and flips the flag', T.enable(tr) === true && T.isEnabled(tr));
  check('enable is idempotent', T.enable(tr) === true && T.isEnabled(tr));
  check('disable returns false and flips the flag', T.disable(tr) === false && !T.isEnabled(tr));
  check('toggle turns it on', T.toggle(tr) === true && T.isEnabled(tr));
  check('toggle turns it back off', T.toggle(tr) === false && !T.isEnabled(tr));
  check('enable/disable/toggle on a missing tracer stay quiet',
    T.enable(null) === false && T.disable(null) === false && T.toggle(null) === false &&
    T.isEnabled(null) === false);
  check('bad caps repair to the default (200)', T.createTracer(0).cap === 200 &&
    T.createTracer(-5).cap === 200 && T.createTracer('junk').cap === 200 &&
    T.createTracer(5).cap === 5);
}

// --- recording: disabled is a no-op, kinds validated, ring capped ---
{
  const tr = T.createTracer(3);
  check('recording while disabled is a no-op',
    T.record(tr, { frame: 0, scope: 'global', index: 0, kind: 'trigger', type: 'always' }) === false &&
    tr.events.length === 0);
  T.enable(tr);
  check('trigger records',
    T.record(tr, { frame: 1, scope: 'global', index: 0, kind: 'trigger', type: 'always' }) === true &&
    tr.events.length === 1);
  T.record(tr, { frame: 1, scope: 'global', index: 1, kind: 'action', type: 'setVariable' });
  T.record(tr, { frame: 2, scope: 'global', index: 2, kind: 'condition-pass', type: 'and' });
  check('condition-stop records too',
    T.record(tr, { frame: 2, scope: 'global', index: 3, kind: 'condition-stop', type: 'and' }) === true);
  check('ring caps at 3 with the oldest dropped first',
    tr.events.length === 3 && tr.events[0].index === 1 && tr.events[2].index === 3,
    JSON.stringify(tr.events.map(e => e.index)));
  check('unknown kinds are rejected',
    T.record(tr, { frame: 3, scope: 'global', index: 4, kind: 'explode', type: 'x' }) === false &&
    tr.events.length === 3);
  check('events without a usable scope/index are rejected',
    T.record(tr, { frame: 3, scope: '', index: 4, kind: 'action', type: 'x' }) === false &&
    T.record(tr, { frame: 3, scope: 'global', index: undefined, kind: 'action', type: 'x' }) === false &&
    T.record(tr, null) === false && T.record(null, { frame: 3, scope: 'g', index: 1, kind: 'action' }) === false);
  check('negative/bad frames repair to 0',
    T.record(tr, { frame: -9, scope: 's', index: 9, kind: 'action', type: 'x' }) === true &&
    tr.events[tr.events.length - 1].frame === 0);
}

// --- recent(): copies, newest-window, all when n is bad ---
{
  const tr = T.createTracer();
  T.enable(tr);
  for (let i = 0; i < 5; i++) T.record(tr, { frame: i, scope: 'g', index: i, kind: 'action', type: 'a' });
  const last2 = T.recent(tr, 2);
  check('recent(2) returns the last two, oldest first',
    last2.length === 2 && last2[0].index === 3 && last2[1].index === 4);
  last2.push({ bogus: true });
  check('recent() returns a copy, not the ring itself', tr.events.length === 5);
  check('recent() with no n returns everything', T.recent(tr).length === 5);
  check('recent() on a missing tracer is empty', T.recent(null).length === 0);
}

// --- clear(): empties events + marks, keeps enabled + cap ---
{
  const tr = T.createTracer(10);
  T.enable(tr);
  T.record(tr, { frame: 1, scope: 'g', index: 0, kind: 'trigger', type: 'always' });
  T.clear(tr);
  check('clear empties the ring and the last-fired marks',
    tr.events.length === 0 && T.lastFiredFrame(tr, 'g', 0) === null);
  check('clear keeps tracing enabled', T.isEnabled(tr) === true);
  check('clear on a missing tracer stays quiet', (() => { try { T.clear(null); return true; } catch (e) { return false; } })());
}

// --- last-fired + recency ---
{
  const tr = T.createTracer();
  T.enable(tr);
  T.record(tr, { frame: 10, scope: 'global', index: 5, kind: 'trigger', type: 'always' });
  T.record(tr, { frame: 12, scope: 'global', index: 5, kind: 'action', type: 'setVariable' });
  check('lastFiredFrame tracks the latest firing frame', T.lastFiredFrame(tr, 'global', 5) === 12);
  check('lastFiredFrame is null for never-fired blocks', T.lastFiredFrame(tr, 'global', 99) === null);
  check('lastFiredFrame is null for bad scope/index',
    T.lastFiredFrame(tr, '', 5) === null && T.lastFiredFrame(tr, 'global', 'x') === null &&
    T.lastFiredFrame(null, 'global', 5) === null);
  check('firedRecently is true within the window, inclusive',
    T.firedRecently(tr, 'global', 5, 12, 30) === true &&
    T.firedRecently(tr, 'global', 5, 42, 30) === true);
  check('firedRecently is false past the window or before the firing',
    T.firedRecently(tr, 'global', 5, 43, 30) === false &&
    T.firedRecently(tr, 'global', 5, 11, 30) === false);
  check('firedRecently is false for bad input',
    T.firedRecently(tr, 'global', 99, 12, 30) === false &&
    T.firedRecently(tr, 'global', 5, 12, -1) === false &&
    T.firedRecently(null, 'global', 5, 12, 30) === false);
  // Enabling clears, so a re-enabled tracer forgets old firings.
  T.enable(tr);
  check('re-enabling clears last-fired marks', T.lastFiredFrame(tr, 'global', 5) === null);
  // Disabling keeps the events readable (the last trace stays on screen).
  T.record(tr, { frame: 1, scope: 'g', index: 1, kind: 'action', type: 'a' });
  T.disable(tr);
  check('disabling keeps the recorded events', tr.events.length === 1 && !T.isEnabled(tr));
}

// --- formatEvent ---
{
  check('formatEvent renders a plain line',
    T.formatEvent({ frame: 12, scope: 'global', index: 0, kind: 'trigger', type: 'always' }) ===
    'frame 12 · global cell 0 · trigger always');
  check('formatEvent falls back for missing type',
    T.formatEvent({ frame: 0, scope: 's', index: 3, kind: 'action' }) === 'frame 0 · s cell 3 · action block');
  check('formatEvent is safe for hostile input',
    T.formatEvent(null) === '' && T.formatEvent('junk') === '' &&
    T.formatEvent({ frame: 'x', scope: {}, index: 'y', kind: 5 }) === 'frame 0 · [object Object] cell 0 ·  block');
}

// --- hostile tracer objects never throw ---
{
  const weird = { enabled: true, events: 'not-an-array', cap: 'junk', lastFired: null };
  let threw = false;
  try {
    T.record(weird, { frame: 1, scope: 'g', index: 1, kind: 'action', type: 'a' });
    T.recent(weird, 2);
    T.firedRecently(weird, 'g', 1, 1, 30);
  } catch (e) { threw = true; }
  check('hostile tracer shapes never throw', !threw && Array.isArray(weird.events));
}

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log('trace.test.js: all checks passed');
