// Unit tests for hydra/hydra-statemachine.js — the shared animation state
// machine module.
//
// Pure logic: state-list normalization, state lookup, entering states
// through host hooks (warn + play), the initial-state entry, and the
// never-throw policy on hostile data. Nothing here touches the DOM; both
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
sandbox.window = sandbox; // hydra-statemachine.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-statemachine.js'), 'utf8'),
  sandbox, { filename: 'hydra-statemachine.js' });
const SM = sandbox.HydraStateMachine;

check('HydraStateMachine exposed with helpers',
  !!SM && typeof SM.normalizeStates === 'function' && typeof SM.stateNames === 'function' &&
  typeof SM.getState === 'function' && typeof SM.createRuntime === 'function' &&
  typeof SM.currentState === 'function' && typeof SM.setState === 'function' &&
  typeof SM.enterInitial === 'function');
check('factorySource is a self-contained function string',
  typeof SM.factorySource === 'string' && SM.factorySource.includes('hydraStateMachineFactory'));
check('DEFAULT_SPEED is 1', SM.DEFAULT_SPEED === 1);

function makeObj() {
  return {
    name: 'hero',
    animStates: [
      { name: 'Idle', animation: 'Idle', speed: 1 },
      { name: 'Run', animation: 'Run', speed: 1.5 },
      { name: 'Flag', animation: '', speed: 2 }
    ]
  };
}
function hooks() {
  const h = { warns: [], plays: [] };
  h.warn = (m) => h.warns.push(m);
  h.play = (a, s) => h.plays.push([a, s]);
  return h;
}

// --- normalization ---
{
  const o = {};
  const out = SM.normalizeStates(o);
  check('missing animStates normalizes to []', Array.isArray(out) && out.length === 0 && Array.isArray(o.animStates));
  check('non-object input returns []', Array.isArray(SM.normalizeStates(null)) && Array.isArray(SM.normalizeStates('x')));
}
{
  const o = {
    animStates: [
      { name: '  ', animation: 'A', speed: 2 },          // blank name -> State 1
      { name: 'Run', animation: 'R', speed: 0 },         // bad speed -> 1
      { name: 'Run', animation: 'R2', speed: -3 },       // duplicate name suffixed, bad speed -> 1
      { name: 'Hop', animation: 'H', speed: 'fast' },    // non-numeric speed -> 1
      null, 'junk',                                      // dropped
      { name: 'Zoom', animation: null, speed: 2.5 }      // null animation -> ''
    ]
  };
  const list = SM.normalizeStates(o);
  check('corrupt entries repaired (5 kept of 7 inputs)', list.length === 5, JSON.stringify(list.map(s => s.name)));
  check('blank name becomes State 1', list[0].name === 'State 1');
  check('bad speeds repair to 1', list[1].speed === 1 && list[2].speed === 1 && list[3].speed === 1);
  check('duplicate names are suffixed', list[1].name === 'Run' && list[2].name === 'Run 3');
  check('null animation becomes empty string', list[4].animation === '');
  check('good speed survives', list[0].speed === 2);
}
{
  const o = makeObj();
  check('stateNames lists names in order', JSON.stringify(SM.stateNames(o)) === JSON.stringify(['Idle', 'Run', 'Flag']));
  check('getState finds an exact match', SM.getState(o, 'Run').animation === 'Run');
  check('getState returns null for missing names', SM.getState(o, 'Nope') === null);
  check('getState returns null for blank names', SM.getState(o, '') === null && SM.getState(o, null) === null);
  check('state names are case-sensitive', SM.getState(o, 'idle') === null);
}

// --- runtime ---
{
  const rt = SM.createRuntime();
  check('fresh runtime reads as no state', SM.currentState(rt) === '');
  check('currentState on hostile records reads blank', SM.currentState(null) === '' && SM.currentState({}) === '' && SM.currentState({ state: 42 }) === '');
}

// --- setState ---
{
  const o = makeObj(); const rt = SM.createRuntime(); const h = hooks();
  check('setState enters a known state', SM.setState(rt, o, 'Run', h) === true);
  check('runtime records the state name', SM.currentState(rt) === 'Run');
  check('play hook gets the bound animation + speed', h.plays.length === 1 && h.plays[0][0] === 'Run' && h.plays[0][1] === 1.5);
  check('entering a state is idempotent', SM.setState(rt, o, 'Run', h) === true && SM.currentState(rt) === 'Run');
}
{
  const o = makeObj(); const rt = SM.createRuntime(); const h = hooks();
  check('a state with no animation still records the state', SM.setState(rt, o, 'Flag', h) === true && SM.currentState(rt) === 'Flag');
  check('no-animation state never calls the play hook', h.plays.length === 0 && h.warns.length === 0);
}
{
  const o = makeObj(); const rt = SM.createRuntime(); const h = hooks();
  check('blank state name is a quiet no-op', SM.setState(rt, o, '   ', h) === false && h.warns.length === 0 && SM.currentState(rt) === '');
  check('null state name is a quiet no-op', SM.setState(rt, o, null, h) === false && h.warns.length === 0);
}
{
  const o = makeObj(); const rt = SM.createRuntime(); const h = hooks();
  SM.setState(rt, o, 'Idle', h);
  check('unknown state warns and holds the old state',
    SM.setState(rt, o, 'Nope', h) === false && h.warns.length === 1 && SM.currentState(rt) === 'Idle');
  check('warning names the missing state', /Nope/.test(h.warns[0]), h.warns[0]);
}
{
  const o = makeObj(); const rt = SM.createRuntime();
  check('setState works with no hooks at all', SM.setState(rt, o, 'Idle') === true && SM.currentState(rt) === 'Idle');
  check('setState on hostile runtime/object never throws',
    SM.setState(null, o, 'Idle', hooks()) === false &&
    SM.setState(rt, null, 'Idle', hooks()) === false &&
    SM.setState(rt, 'junk', 'Idle', hooks()) === false);
}
{
  const o = makeObj();
  let threw = false;
  try {
    SM.setState(SM.createRuntime(), o, 'Run', { warn: () => {}, play: () => { throw new Error('boom'); } });
  } catch (e) { threw = true; }
  check('a throwing play hook never escapes setState', threw === false);
}

// --- enterInitial ---
{
  const o = makeObj(); o.animStateInitial = 'Idle';
  const rt = SM.createRuntime(); const h = hooks();
  check('enterInitial enters the configured initial state',
    SM.enterInitial(rt, o, h) === true && SM.currentState(rt) === 'Idle' && h.plays.length === 1 && h.plays[0][0] === 'Idle');
}
{
  const o = makeObj(); const rt = SM.createRuntime(); const h = hooks();
  check('blank initial state is a quiet no-op', SM.enterInitial(rt, o, h) === false && h.warns.length === 0);
  o.animStateInitial = '   ';
  check('whitespace initial state is a quiet no-op', SM.enterInitial(rt, o, h) === false && h.warns.length === 0);
}
{
  const o = makeObj(); o.animStateInitial = 'Ghost';
  const rt = SM.createRuntime(); const h = hooks();
  check('unknown initial state warns once and enters nothing',
    SM.enterInitial(rt, o, h) === false && h.warns.length === 1 && SM.currentState(rt) === '');
}
{
  check('enterInitial on hostile input never throws',
    SM.enterInitial(null, makeObj(), hooks()) === false && SM.enterInitial(SM.createRuntime(), null, hooks()) === false);
}

if (failures) { console.log(`${failures} FAILURES`); process.exit(1); }
console.log('all statemachine checks passed');
