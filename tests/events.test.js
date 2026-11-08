// Unit tests for hydra/hydra-events.js — the shared custom-event state
// machine (P5 core-engine track, item P5-4: Control flow + events,
// slice c — Broadcast Event / On Event).
//
// Pure logic: event names, the per-run broadcast counts, and the
// per-listener poll that fires exactly once per broadcast. The
// condition and dispatch integration at the end runs real grids
// through HydraConditions + HydraDispatch + HydraFlow + HydraExecute,
// so the delivery timing (same frame when the listener sits after
// the broadcaster in the grid walk, next frame when it sits before)
// is pinned by behavior, not by reading the code. Static checks at
// the end pin the wiring: catalog blocks, both runtimes' condition
// and action contexts, the export inlining list, and the docs.

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

const sandbox = {};
sandbox.window = sandbox; // hydra-*.js assign to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-events.js'), 'utf8'),
  sandbox, { filename: 'hydra-events.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-expr.js'), 'utf8'),
  sandbox, { filename: 'hydra-expr.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-flow.js'), 'utf8'),
  sandbox, { filename: 'hydra-flow.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-dispatch.js'), 'utf8'),
  sandbox, { filename: 'hydra-dispatch.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-conditions.js'), 'utf8'),
  sandbox, { filename: 'hydra-conditions.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-execute.js'), 'utf8'),
  sandbox, { filename: 'hydra-execute.js' });
const EV = sandbox.HydraEvents;
const E = sandbox.HydraExpr;
const FL = sandbox.HydraFlow;
const D = sandbox.HydraDispatch;
const C = sandbox.HydraConditions;
const X = sandbox.HydraExecute;

check('HydraEvents exposed with helpers',
  !!EV && typeof EV.isEventAction === 'function' &&
  typeof EV.isEventCondition === 'function' &&
  typeof EV.normalizeEventName === 'function' &&
  typeof EV.createEventState === 'function' &&
  typeof EV.broadcast === 'function' &&
  typeof EV.eventCount === 'function' &&
  typeof EV.pollEvent === 'function');

check('classifiers name exactly the two event blocks',
  EV.isEventAction('broadcastEvent') && !EV.isEventAction('onCustomEvent') &&
  !EV.isEventAction('setVariable') &&
  EV.isEventCondition('onCustomEvent') && !EV.isEventCondition('broadcastEvent') &&
  !EV.isEventCondition('gameStart'));

check('normalizeEventName trims, and blanks or non-strings read as blank',
  EV.normalizeEventName('  goal-scored ') === 'goal-scored' &&
  EV.normalizeEventName('') === '' && EV.normalizeEventName('   ') === '' &&
  EV.normalizeEventName(null) === '' && EV.normalizeEventName(7) === '' &&
  EV.normalizeEventName(undefined) === '');

check('createEventState starts with empty counts and seen',
  (() => {
    const s = EV.createEventState();
    return s && typeof s.counts === 'object' && typeof s.seen === 'object' &&
      Object.keys(s.counts).length === 0 && Object.keys(s.seen).length === 0;
  })());

check('broadcast bumps the count and reports it',
  (() => {
    const s = EV.createEventState();
    const first = EV.broadcast(s, 'goal');
    const second = EV.broadcast(s, 'goal');
    const other = EV.broadcast(s, 'door');
    return first.ok === true && first.name === 'goal' && first.count === 1 &&
      second.ok === true && second.count === 2 &&
      other.ok === true && other.count === 1 &&
      EV.eventCount(s, 'goal') === 2 && EV.eventCount(s, 'door') === 1 &&
      EV.eventCount(s, 'never') === 0;
  })());

check('broadcast of a blank name fails with reason blank and counts nothing',
  (() => {
    const s = EV.createEventState();
    const r = EV.broadcast(s, '   ');
    return r.ok === false && r.reason === 'blank' && EV.eventCount(s, '') === 0 &&
      Object.keys(s.counts).length === 0;
  })());

check('broadcast with an unusable state fails with reason bad-state, never throws',
  (() => {
    const r1 = EV.broadcast(null, 'goal');
    const r2 = EV.broadcast({}, 'goal');
    const r3 = EV.broadcast({ counts: null, seen: {} }, 'goal');
    return r1.ok === false && r1.reason === 'bad-state' &&
      r2.ok === false && r2.reason === 'bad-state' &&
      r3.ok === false && r3.reason === 'bad-state';
  })());

check('eventCount reads 0 for a blank name or an unusable state, never throws',
  EV.eventCount(null, 'goal') === 0 && EV.eventCount({}, 'goal') === 0 &&
  EV.eventCount(EV.createEventState(), '') === 0);

check('pollEvent fires exactly once per broadcast for one listener',
  (() => {
    const s = EV.createEventState();
    EV.broadcast(s, 'goal');
    const first = EV.pollEvent(s, 'goal', 'test:60');
    const second = EV.pollEvent(s, 'goal', 'test:60');
    const third = EV.pollEvent(s, 'goal', 'test:60');
    EV.broadcast(s, 'goal');
    const afterSecond = EV.pollEvent(s, 'goal', 'test:60');
    const afterSecondAgain = EV.pollEvent(s, 'goal', 'test:60');
    return first === true && second === false && third === false &&
      afterSecond === true && afterSecondAgain === false;
  })());

check('pollEvent keeps one place per listener cell, so two listeners each fire',
  (() => {
    const s = EV.createEventState();
    EV.broadcast(s, 'goal');
    const a = EV.pollEvent(s, 'goal', 'test:60');
    const b = EV.pollEvent(s, 'goal', 'test:120');
    const aAgain = EV.pollEvent(s, 'goal', 'test:60');
    const bAgain = EV.pollEvent(s, 'goal', 'test:120');
    return a === true && b === true && aAgain === false && bAgain === false;
  })());

check('pollEvent swallows several broadcasts in one frame into one firing',
  (() => {
    const s = EV.createEventState();
    EV.broadcast(s, 'goal');
    EV.broadcast(s, 'goal');
    EV.broadcast(s, 'goal');
    const first = EV.pollEvent(s, 'goal', 'test:60');
    const second = EV.pollEvent(s, 'goal', 'test:60');
    return first === true && second === false && EV.eventCount(s, 'goal') === 3;
  })());

check('pollEvent fires every frame when the event is broadcast every frame',
  (() => {
    const s = EV.createEventState();
    let hits = 0;
    for (let f = 0; f < 3; f++) {
      EV.broadcast(s, 'tick');
      if (EV.pollEvent(s, 'tick', 'test:60')) hits++;
    }
    return hits === 3;
  })());

check('pollEvent stays quiet for a name never broadcast, a blank name, or a bad state',
  (() => {
    const s = EV.createEventState();
    return EV.pollEvent(s, 'never', 'test:60') === false &&
      EV.pollEvent(s, '', 'test:60') === false &&
      EV.pollEvent(null, 'goal', 'test:60') === false &&
      EV.pollEvent({}, 'goal', 'test:60') === false &&
      EV.pollEvent(s, 'goal', '') === false;
  })());

check('pollEvent with a missing seen map never fires (it cannot record what it saw)',
  (() => {
    const s = { counts: { goal: 1 }, seen: null };
    return EV.pollEvent(s, 'goal', 'test:60') === false;
  })());

// --- condition integration: the real HydraConditions switch ---
function condCtx(state) {
  return {
    eventsModule: EV,
    events: state,
    startedScopes: new Set(),
    scopeKey: function () { return 'test'; },
    expr: function (v) { return E.evaluate(v, { variables: {} }).value; }
  };
}

check('condition: On Event fires once per broadcast, with the event name and count in context',
  (() => {
    const s = EV.createEventState();
    const ctx = condCtx(s);
    const before = C.evaluateCondition({ type: 'onCustomEvent', eventName: 'goal' }, ctx, 'test', 60);
    EV.broadcast(s, 'goal');
    const fired = C.evaluateCondition({ type: 'onCustomEvent', eventName: 'goal' }, ctx, 'test', 60);
    const again = C.evaluateCondition({ type: 'onCustomEvent', eventName: 'goal' }, ctx, 'test', 60);
    return before.triggered === false && fired.triggered === true &&
      fired.context.event === 'goal' && fired.context.count === 1 &&
      again.triggered === false;
  })());

check('condition: On Event with a blank name never fires',
  (() => {
    const s = EV.createEventState();
    const ctx = condCtx(s);
    EV.broadcast(s, 'goal');
    const r = C.evaluateCondition({ type: 'onCustomEvent', eventName: '   ' }, ctx, 'test', 60);
    return r.triggered === false;
  })());

check('condition: On Event with no module or no state reads false, never throws',
  (() => {
    const noModule = C.evaluateCondition(
      { type: 'onCustomEvent', eventName: 'goal' },
      { eventsModule: null, events: null, scopeKey: function () { return 'test'; } }, 'test', 60);
    const noState = C.evaluateCondition(
      { type: 'onCustomEvent', eventName: 'goal' },
      { eventsModule: EV, events: null, scopeKey: function () { return 'test'; } }, 'test', 60);
    return noModule.triggered === false && noState.triggered === false;
  })());

check('condition: On Event respects reversed (a broadcast reads as not-triggered)',
  (() => {
    const s = EV.createEventState();
    const ctx = condCtx(s);
    const quiet = C.evaluateCondition({ type: 'onCustomEvent', eventName: 'goal', reversed: true }, ctx, 'test', 60);
    EV.broadcast(s, 'goal');
    const fired = C.evaluateCondition({ type: 'onCustomEvent', eventName: 'goal', reversed: true }, ctx, 'test', 60);
    return quiet.triggered === true && fired.triggered === false;
  })());

check('condition: a listener in another scope keeps its own place',
  (() => {
    const s = EV.createEventState();
    const ctxA = condCtx(s);
    const ctxB = condCtx(s);
    ctxB.scopeKey = function () { return 'other'; };
    EV.broadcast(s, 'goal');
    const a = C.evaluateCondition({ type: 'onCustomEvent', eventName: 'goal' }, ctxA, 'test', 60);
    const b = C.evaluateCondition({ type: 'onCustomEvent', eventName: 'goal' }, ctxB, 'other', 60);
    return a.triggered === true && b.triggered === true;
  })());

// --- execute integration: the real HydraExecute switch ---
function execCtx(state, warnings) {
  return {
    variables: {},
    expr: function (v) { return E.evaluate(v, { variables: {} }).value; },
    exprInfo: function (v) { return E.evaluate(v, { variables: {} }); },
    warn: function (m) { warnings.push(m); },
    eventsModule: EV,
    eventState: state
  };
}

check('execute: Broadcast Event bumps the run count',
  (() => {
    const s = EV.createEventState();
    const warnings = [];
    X.executeAction({ type: 'broadcastEvent', eventName: 'goal' }, execCtx(s, warnings), 1);
    X.executeAction({ type: 'broadcastEvent', eventName: '  goal ' }, execCtx(s, warnings), 1);
    return EV.eventCount(s, 'goal') === 2 && warnings.length === 0;
  })());

check('execute: Broadcast Event with a blank name warns and counts nothing',
  (() => {
    const s = EV.createEventState();
    const warnings = [];
    X.executeAction({ type: 'broadcastEvent', eventName: '' }, execCtx(s, warnings), 1);
    return warnings.length === 1 && /blank/.test(warnings[0]) &&
      EV.eventCount(s, '') === 0;
  })());

check('execute: Broadcast Event with no event state stays quiet, never throws',
  (() => {
    const warnings = [];
    const ctx = execCtx(null, warnings);
    delete ctx.eventState;
    X.executeAction({ type: 'broadcastEvent', eventName: 'goal' }, ctx, 1);
    return warnings.length === 0;
  })());

// --- dispatch integration: real grids through HydraDispatch + HydraFlow ---
function makeHost(grid) {
  const vars = {};
  const warnings = [];
  const eventState = EV.createEventState();
  const flowTriggerStates = {};
  const startedScopes = new Set();
  const ctx = {
    variables: vars,
    expr: function (v) { return E.evaluate(v, { variables: vars }).value; },
    exprInfo: function (v) { return E.evaluate(v, { variables: vars }); },
    warn: function (m) { warnings.push(m); },
    eventsModule: EV,
    eventState: eventState
  };
  const condCtx = {
    eventsModule: EV,
    events: eventState,
    startedScopes: startedScopes,
    scopeKey: function () { return 'test'; },
    expr: function (v) { return E.evaluate(v, { variables: vars }).value; }
  };
  function isCond(t) { return t === 'gameStart' || t === 'always' || EV.isEventCondition(t); }
  function isAct(t) { return t === 'setVariable' || EV.isEventAction(t); }
  const hooks = {
    flow: FL,
    trace: null, traceState: null, frameId: 0,
    isCondition: isCond, isAction: isAct, isComment: function (t) { return t === 'comment'; },
    evaluate: function (idx, data) {
      if (data.type === 'always') return { triggered: true, context: {} };
      if (data.type === 'gameStart') return { triggered: !startedScopes.has('test'), context: {} };
      if (EV.isEventCondition(data.type)) return C.evaluateCondition(data, condCtx, 'test', idx);
      return { triggered: false, context: {} };
    },
    execute: function (idx, data) { X.executeAction(data, ctx, idx); },
    flowTriggerStates: flowTriggerStates,
    startedScopes: startedScopes,
    onTriggered: function () {},
    onPropagateCondition: function () {},
    reportUnknown: function (t) { warnings.push('unknown ' + t); }
  };
  return {
    vars: vars, warnings: warnings, eventState: eventState,
    run: function () { D.processScope(grid, 'test', hooks); }
  };
}

check('dispatch: a listener after the broadcaster in the grid walk fires in the same frame',
  (() => {
    const h = makeHost({
      0: { type: 'gameStart', kind: 'condition' },
      1: { type: 'broadcastEvent', kind: 'action', eventName: 'goal' },
      60: { type: 'onCustomEvent', kind: 'condition', eventName: 'goal' },
      61: { type: 'setVariable', kind: 'action', varName: 'hits', operation: 'add', value: 1 }
    });
    h.run();
    return h.vars.hits === 1 && h.warnings.length === 0;
  })());

check('dispatch: a listener before the broadcaster fires on the next frame, exactly once',
  (() => {
    const h = makeHost({
      0: { type: 'onCustomEvent', kind: 'condition', eventName: 'goal' },
      1: { type: 'setVariable', kind: 'action', varName: 'hits', operation: 'add', value: 1 },
      60: { type: 'gameStart', kind: 'condition' },
      61: { type: 'broadcastEvent', kind: 'action', eventName: 'goal' }
    });
    h.run();
    const afterFirst = h.vars.hits;
    h.run();
    const afterSecond = h.vars.hits;
    h.run();
    return afterFirst === undefined && afterSecond === 1 && h.vars.hits === 1 &&
      h.warnings.length === 0;
  })());

check('dispatch: two broadcasts of one name in one frame fire the listener once',
  (() => {
    const h = makeHost({
      0: { type: 'gameStart', kind: 'condition' },
      1: { type: 'broadcastEvent', kind: 'action', eventName: 'goal' },
      2: { type: 'broadcastEvent', kind: 'action', eventName: 'goal' },
      60: { type: 'onCustomEvent', kind: 'condition', eventName: 'goal' },
      61: { type: 'setVariable', kind: 'action', varName: 'hits', operation: 'add', value: 1 }
    });
    h.run();
    return h.vars.hits === 1 && EV.eventCount(h.eventState, 'goal') === 2 &&
      h.warnings.length === 0;
  })());

check('dispatch: a broadcast every frame fires the listener every frame',
  (() => {
    const h = makeHost({
      0: { type: 'always', kind: 'condition' },
      1: { type: 'broadcastEvent', kind: 'action', eventName: 'tick' },
      60: { type: 'onCustomEvent', kind: 'condition', eventName: 'tick' },
      61: { type: 'setVariable', kind: 'action', varName: 'hits', operation: 'add', value: 1 }
    });
    h.run(); h.run(); h.run();
    return h.vars.hits === 3 && h.warnings.length === 0;
  })());

check('dispatch: a listener for an event that is never broadcast stays quiet',
  (() => {
    const h = makeHost({
      0: { type: 'gameStart', kind: 'condition' },
      1: { type: 'setVariable', kind: 'action', varName: 'setup', operation: 'set', value: 1 },
      60: { type: 'onCustomEvent', kind: 'condition', eventName: 'goal' },
      61: { type: 'setVariable', kind: 'action', varName: 'hits', operation: 'add', value: 1 }
    });
    h.run(); h.run(); h.run();
    return h.vars.setup === 1 && h.vars.hits === undefined && h.warnings.length === 0;
  })());

check('dispatch: a broadcast under one name does not fire a listener for another name',
  (() => {
    const h = makeHost({
      0: { type: 'gameStart', kind: 'condition' },
      1: { type: 'broadcastEvent', kind: 'action', eventName: 'door' },
      60: { type: 'onCustomEvent', kind: 'condition', eventName: 'goal' },
      61: { type: 'setVariable', kind: 'action', varName: 'hits', operation: 'add', value: 1 },
      120: { type: 'onCustomEvent', kind: 'condition', eventName: 'door' },
      121: { type: 'setVariable', kind: 'action', varName: 'doorHits', operation: 'add', value: 1 }
    });
    h.run();
    return h.vars.hits === undefined && h.vars.doorHits === 1 && h.warnings.length === 0;
  })());

check('dispatch: a blank broadcast warns and no listener fires',
  (() => {
    const h = makeHost({
      0: { type: 'gameStart', kind: 'condition' },
      1: { type: 'broadcastEvent', kind: 'action', eventName: '' },
      60: { type: 'onCustomEvent', kind: 'condition', eventName: 'goal' },
      61: { type: 'setVariable', kind: 'action', varName: 'hits', operation: 'add', value: 1 }
    });
    h.run();
    return h.vars.hits === undefined && h.warnings.length === 1 &&
      /blank/.test(h.warnings[0]);
  })());

check('dispatch: two listeners for one broadcast both fire, each once',
  (() => {
    const h = makeHost({
      0: { type: 'gameStart', kind: 'condition' },
      1: { type: 'broadcastEvent', kind: 'action', eventName: 'goal' },
      60: { type: 'onCustomEvent', kind: 'condition', eventName: 'goal' },
      61: { type: 'setVariable', kind: 'action', varName: 'a', operation: 'add', value: 1 },
      120: { type: 'onCustomEvent', kind: 'condition', eventName: 'goal' },
      121: { type: 'setVariable', kind: 'action', varName: 'b', operation: 'add', value: 1 }
    });
    h.run();
    h.run();
    return h.vars.a === 1 && h.vars.b === 1 && h.warnings.length === 0;
  })());

// --- flow: the listener is level-triggered by default, so a
// broadcast every frame fires it every frame ---
// On Event's poll is true for exactly one evaluation per broadcast,
// so level fires once per broadcast; edge would collapse consecutive
// broadcasts (true on consecutive frames) into a single firing.
check('flow: On Event is level-triggered by default (once per broadcast, every frame when broadcast every frame)',
  FL.defaultTriggerMode('onCustomEvent') === 'level' &&
  FL.defaultTriggerMode({ type: 'onCustomEvent' }) === 'level');

// --- static pins: catalog, wiring, docs ---
const catalogSb = {};
catalogSb.window = catalogSb;
vm.createContext(catalogSb);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8'),
  catalogSb, { filename: 'block-catalog.js' });
const catalog = catalogSb.HydraBlockCatalog.blocks;
check('catalog holds 556 blocks (was 552, +4 attach)',
  catalog.length === 556, `got ${catalog.length}`);
const flowBlocks = catalog.filter(function (b) { return b.category === 'Control Flow'; });
check('the Control Flow category holds the eight loop blocks plus the two event blocks, in order',
  flowBlocks.map(function (b) { return b.label; }).join(',') ===
  'Repeat,While,Break,Continue,For Each Item,For Each Object,For Each Field,For Each Tagged Object,Broadcast Event,On Event',
  flowBlocks.map(function (b) { return b.label; }).join(','));
check('Broadcast Event is an action and On Event is a condition, with the right runtime types',
  flowBlocks[8].kind === 'action' && flowBlocks[8].runtimeType === 'broadcastEvent' &&
  flowBlocks[9].kind === 'condition' && flowBlocks[9].runtimeType === 'onCustomEvent');
check('both event blocks declare one Event name text field',
  (() => {
    const b = flowBlocks[8];
    const fields = {};
    (b.fields || []).forEach(function (f) { fields[f.key] = f; });
    const o = flowBlocks[9];
    const ofields = {};
    (o.fields || []).forEach(function (f) { ofields[f.key] = f; });
    return b.defaults.eventName === '' && fields.eventName &&
      fields.eventName.control === 'text' && fields.eventName.label === 'Event name' &&
      o.defaults.eventName === '' && ofields.eventName &&
      ofields.eventName.control === 'text' && ofields.eventName.label === 'Event name';
  })());
check('catalog validates clean with the event blocks',
  catalogSb.HydraBlockCatalog.validateCatalog(catalog).length === 0);

const indexHtml = fs.readFileSync(path.join(HYDRA, 'index.html'), 'utf8');
check('index.html loads hydra-events.js after hydra-loops.js',
  indexHtml.indexOf('hydra-events.js') > indexHtml.indexOf('hydra-loops.js') &&
  indexHtml.indexOf('hydra-events.js') > 0);
check('index.html loads hydra-events.js before player-runtime.js',
  indexHtml.indexOf('hydra-events.js') < indexHtml.indexOf('player-runtime.js'));

const playerSrc = fs.readFileSync(path.join(HYDRA, 'player-runtime.js'), 'utf8');
check('export hard-guards on the events module',
  /requires hydra-events\.js \(window\.HydraEvents\)/.test(playerSrc));
check('export creates the event state at run start',
  playerSrc.includes('eventState: HydraEvents.createEventState()'));
check('export classifies the event blocks through the module',
  playerSrc.includes('HydraEvents.isEventCondition(type)') &&
  playerSrc.includes('HydraEvents.isEventAction(type)'));
check('export condition context carries the events module and state',
  playerSrc.includes('eventsModule: HydraEvents') &&
  playerSrc.includes('events: state.eventState'));
check('export action context carries the events module and state',
  playerSrc.includes('eventsModule: HydraEvents') &&
  playerSrc.includes('eventState: state.eventState'));
check('export inlines the events module into playable games',
  playerSrc.includes("'hydra-events.js (window.HydraEvents)'"));

const previewSrc = fs.readFileSync(path.join(HYDRA, 'hydra-previewruntime.js'), 'utf8');
check('preview hosts the event state lazily and resets it on a fresh run',
  previewSrc.includes('function eventsState()') &&
  previewSrc.includes('resetEventsState();'));
check('preview condition context carries the events module and state',
  previewSrc.includes("eventsModule: mod('Events')") &&
  previewSrc.includes('events: eventsState()'));
check('preview action context carries the events module and state',
  previewSrc.includes("eventsModule: mod('Events')") &&
  previewSrc.includes('eventState: eventsState()'));

const guide = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');
check('user guide documents custom events (Broadcast Event / On Event)',
  /Custom events/.test(guide) && /Broadcast Event/.test(guide) && /On Event/.test(guide));
const reference = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');
check('block reference lists the two event blocks in the Control Flow section',
  /### Control Flow \(10\)/.test(reference) &&
  /\| Broadcast Event \| Action \|/.test(reference) &&
  /\| On Event \| Condition \|/.test(reference));

if (failures) { console.log(`${failures} check(s) failed`); process.exit(1); }
console.log('events: all checks passed');
