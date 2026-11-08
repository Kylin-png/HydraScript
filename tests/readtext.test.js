// Unit tests for Read Text Into Variable (P5 core-engine track, item
// P5-9 — the build-the-editor test). The block is the bridge that lets
// a game read typed input back into a variable: text objects are the
// only place typed text can land (digit keys + Append Text build it
// up), and until this block there was no way to get that text back out
// — so a player could never type a number into the Variable Inspector
// and have the game use it. Text mode stores the displayed text
// as-is; Number mode parses it (a blank reads as 0, text that is not
// a number warns and holds). The dispatch integration runs the real
// inspector chain (type digits, Set, score changes, label refreshes)
// through HydraDispatch + HydraFlow, so the flow is pinned by
// behavior, not by reading the code. Static checks at the end pin the
// wiring: catalog block, both runtimes' action routing, the export
// inlining list, and the docs.

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
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-variables.js'), 'utf8'),
  sandbox, { filename: 'hydra-variables.js' });
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
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8'),
  sandbox, { filename: 'block-catalog.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-universal.js'), 'utf8'),
  sandbox, { filename: 'hydra-universal.js' });
const V = sandbox.HydraVariables;
const E = sandbox.HydraExpr;
const FL = sandbox.HydraFlow;
const D = sandbox.HydraDispatch;
const X = sandbox.HydraExecute;
const CAT = sandbox.HydraBlockCatalog.blocks;
const U = sandbox.HydraUniversal;

function textObj(id, name, text, runtimeText) {
  const o = {
    id: id, name: name, kind: 'text', posX: 0, posY: 0, width: 120, height: 34,
    color: '#ffffff', static: false, physicsEnabled: false, text: text,
    collision: { shape: 'box', mode: 'solid', layer: 0, mask: 255 }
  };
  if (runtimeText !== undefined) o._runtimeText = runtimeText;
  return o;
}
function spriteObj(id, name) {
  return {
    id: id, name: name, kind: 'sprite', posX: 0, posY: 0, width: 40, height: 40,
    color: '#888888', static: false, physicsEnabled: false,
    collision: { shape: 'box', mode: 'solid', layer: 0, mask: 255 }
  };
}

function makeCtx(live, o) {
  o = o || {};
  const vars = {};
  const warnings = [];
  const varScopes = V.createVariablesState();
  const liveOf = function (name) {
    return live.filter(function (x) { return x.name === name; });
  };
  const ctx = {
    variables: vars,
    expr: function (v) { return E.evaluate(v, { variables: vars }).value; },
    exprInfo: function (v) { return E.evaluate(v, { variables: vars }); },
    warn: function (m) { warnings.push(m); },
    varScopesModule: V,
    varScopes: varScopes,
    named: function (name) { return liveOf(name); },
    objects: live,
    sceneId: 1
  };
  if (o.noVarScopesModule) delete ctx.varScopesModule;
  return { ctx: ctx, vars: vars, warnings: warnings, varScopes: varScopes, live: live };
}

function readText(data) {
  return Object.assign({
    type: 'readTextIntoVariable', targetObject: 'input', mode: 'text', storeVarName: 'typed'
  }, data || {});
}

// --- module surface ---

check('isScopedVariableAction names Read Text Into Variable with the other variable actions',
  V.isScopedVariableAction('readTextIntoVariable') &&
  V.isScopedVariableAction('setScopedVariable') && V.isScopedVariableAction('readScopedVariable') &&
  V.isScopedVariableAction('deleteScopedVariable') && V.isScopedVariableAction('clearScopedVariables') &&
  !V.isScopedVariableAction('setText') && !V.isScopedVariableAction('appendText') &&
  !V.isScopedVariableAction('setVariable'));
check('isObjectRefAction does not claim Read Text Into Variable (it moves text, not handles)',
  !V.isObjectRefAction('readTextIntoVariable') && V.isObjectRefAction('pickObjectIntoVariable'));
check('isScopedVariableCondition does not claim it (it is an action)',
  !V.isScopedVariableCondition('readTextIntoVariable'));

// --- text mode ---

check('execute: text mode stores the authored text when nothing typed yet',
  (() => {
    const h = makeCtx([textObj(1, 'input', 'Ky')]);
    X.executeAction(readText(), h.ctx, 1);
    return h.vars.typed === 'Ky' && h.warnings.length === 0;
  })());
check('execute: text mode prefers the runtime text (what the player typed) over the authored text',
  (() => {
    const h = makeCtx([textObj(1, 'input', 'Ky', 'Ada')]);
    X.executeAction(readText(), h.ctx, 1);
    return h.vars.typed === 'Ada' && h.warnings.length === 0;
  })());
check('execute: text mode stores an empty string when the object shows nothing',
  (() => {
    const h = makeCtx([textObj(1, 'input', '')]);
    X.executeAction(readText(), h.ctx, 1);
    return h.vars.typed === '' && h.warnings.length === 0;
  })());
check('execute: text mode overwrites a previous value in the variable',
  (() => {
    const h = makeCtx([textObj(1, 'input', 'Bo')]);
    h.vars.typed = 'old';
    X.executeAction(readText(), h.ctx, 1);
    return h.vars.typed === 'Bo' && h.warnings.length === 0;
  })());

// --- number mode ---

check('execute: number mode parses plain digits to a number',
  (() => {
    const h = makeCtx([textObj(1, 'input', '', '42')]);
    X.executeAction(readText({ mode: 'number' }), h.ctx, 1);
    return h.vars.typed === 42 && typeof h.vars.typed === 'number' && h.warnings.length === 0;
  })());
check('execute: number mode trims surrounding spaces and parses decimals and negatives',
  (() => {
    const h = makeCtx([textObj(1, 'input', '', '  12.5 ')]);
    X.executeAction(readText({ mode: 'number' }), h.ctx, 1);
    const first = h.vars.typed === 12.5;
    h.live[0]._runtimeText = '-3';
    X.executeAction(readText({ mode: 'number' }), h.ctx, 2);
    return first && h.vars.typed === -3 && h.warnings.length === 0;
  })());
check('execute: number mode reads a blank as 0, the missing-value rule',
  (() => {
    const h = makeCtx([textObj(1, 'input', '')]);
    X.executeAction(readText({ mode: 'number' }), h.ctx, 1);
    return h.vars.typed === 0 && h.warnings.length === 0;
  })());
check('execute: number mode warns and holds on text that is not a number',
  (() => {
    const h = makeCtx([textObj(1, 'input', '', 'abc')]);
    h.vars.typed = 7;
    X.executeAction(readText({ mode: 'number' }), h.ctx, 1);
    return h.vars.typed === 7 && h.warnings.length === 1 &&
      /not a number/.test(h.warnings[0]);
  })());
check('execute: number mode warns and holds on a trailing-units read like 12px',
  (() => {
    const h = makeCtx([textObj(1, 'input', '', '12px')]);
    X.executeAction(readText({ mode: 'number' }), h.ctx, 1);
    return h.vars.typed === undefined && h.warnings.length === 1;
  })());
check('execute: number mode parses scientific notation the way Number does',
  (() => {
    const h = makeCtx([textObj(1, 'input', '', '1e3')]);
    X.executeAction(readText({ mode: 'number' }), h.ctx, 1);
    return h.vars.typed === 1000 && h.warnings.length === 0;
  })());

// --- warn and hold cases ---

check('execute: a blank variable name warns and holds',
  (() => {
    const h = makeCtx([textObj(1, 'input', 'Ky')]);
    X.executeAction(readText({ storeVarName: '  ' }), h.ctx, 1);
    return Object.keys(h.vars).length === 0 && h.warnings.length === 1 &&
      /variable name is blank/.test(h.warnings[0]);
  })());
check('execute: a blank object name warns and holds',
  (() => {
    const h = makeCtx([textObj(1, 'input', 'Ky')]);
    X.executeAction(readText({ targetObject: '' }), h.ctx, 1);
    return Object.keys(h.vars).length === 0 && h.warnings.length === 1 &&
      /no text object is named/.test(h.warnings[0]);
  })());
check('execute: a missing object warns and holds',
  (() => {
    const h = makeCtx([textObj(1, 'input', 'Ky')]);
    X.executeAction(readText({ targetObject: 'ghost' }), h.ctx, 1);
    return Object.keys(h.vars).length === 0 && h.warnings.length === 1 &&
      /no text object named/.test(h.warnings[0]);
  })());
check('execute: a sprite is not text, so the read warns and holds',
  (() => {
    const h = makeCtx([spriteObj(2, 'hero'), textObj(1, 'input', 'Ky')]);
    X.executeAction(readText({ targetObject: 'hero' }), h.ctx, 1);
    return Object.keys(h.vars).length === 0 && h.warnings.length === 1 &&
      /no text object named/.test(h.warnings[0]);
  })());
check('execute: with no variables module the block stays quiet and writes nothing',
  (() => {
    const h = makeCtx([textObj(1, 'input', 'Ky')], { noVarScopesModule: true });
    X.executeAction(readText(), h.ctx, 1);
    return Object.keys(h.vars).length === 0 && h.warnings.length === 0;
  })(), 'like the other scoped-variable blocks without their module');
check('execute: a missing mode defaults to text',
  (() => {
    const h = makeCtx([textObj(1, 'input', '', '42')]);
    X.executeAction(readText({ mode: '' }), h.ctx, 1);
    return h.vars.typed === '42' && h.warnings.length === 0;
  })());

// --- dispatch integration: the inspector chain, typed end to end ---

function makeHost(grid, live) {
  const vars = {};
  const warnings = [];
  const varScopes = V.createVariablesState();
  const startedScopes = new Set();
  const flowTriggerStates = {};
  const liveOf = function (name) {
    return live.filter(function (x) { return x.name === name; });
  };
  const ctx = {
    variables: vars,
    expr: function (v) { return E.evaluate(v, { variables: vars }).value; },
    exprInfo: function (v) { return E.evaluate(v, { variables: vars }); },
    warn: function (m) { warnings.push(m); },
    varScopesModule: V,
    varScopes: varScopes,
    named: function (name) { return liveOf(name); },
    objects: live,
    sceneId: 1
  };
  const hooks = {
    flow: FL,
    trace: null, traceState: null, frameId: 0,
    isCondition: function (t) { return t === 'gameStart' || t === 'always'; },
    isAction: function (t) {
      return t === 'setVariable' || t === 'appendText' || t === 'setText' ||
        V.isScopedVariableAction(t);
    },
    isComment: function (t) { return t === 'comment'; },
    evaluate: function (idx, data) {
      if (data.type === 'always') return { triggered: true, context: {} };
      if (data.type === 'gameStart') return { triggered: !startedScopes.has('test'), context: {} };
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
    vars: vars, warnings: warnings, varScopes: varScopes, ctx: ctx, live: live,
    run: function () { D.processScope(grid, 'test', hooks); }
  };
}

check('dispatch: type 4 then 2, Set copies 42 into the scoped score, the label shows 42',
  (() => {
    const live = [textObj(1, 'input', ''), textObj(2, 'scoreText', '0')];
    const grid = {
      0: { type: 'gameStart' },
      1: { type: 'appendText', targetObject: 'input', value: '4' },
      2: { type: 'appendText', targetObject: 'input', value: '2' },
      3: { type: 'readTextIntoVariable', targetObject: 'input', mode: 'number', storeVarName: 'typedValue' },
      4: { type: 'setScopedVariable', scope: 'global', varName: 'score', valueKind: 'variable', value: 'typedValue' },
      5: { type: 'readScopedVariable', scope: 'global', varName: 'score', storeVarName: 'scoreNow' },
      6: { type: 'setText', targetObject: 'scoreText', useVariable: true, varName: 'scoreNow' }
    };
    const h = makeHost(grid, live);
    h.run();
    const scoreText = live.find(function (o) { return o.name === 'scoreText'; });
    return h.vars.typedValue === 42 && h.vars.scoreNow === 42 &&
      scoreText._runtimeText === '42' && h.warnings.length === 0;
  })());
check('dispatch: a bad typed value warns once, the flat var stays unset, and the later copy reads the missing var as 0',
  (() => {
    const live = [textObj(1, 'input', '', 'xx')];
    const grid = {
      0: { type: 'gameStart' },
      1: { type: 'readTextIntoVariable', targetObject: 'input', mode: 'number', storeVarName: 'typedValue' },
      2: { type: 'setScopedVariable', scope: 'global', varName: 'score', valueKind: 'variable', value: 'typedValue' }
    };
    const h = makeHost(grid, live);
    V.set(h.varScopes, 'global', 'score', 9, { type: 'number' });
    h.run();
    return h.vars.typedValue === undefined && V.read(h.varScopes, 'global', 'score', 0) === 0 &&
      h.warnings.length === 1 && /not a number/.test(h.warnings[0]);
  })(), 'the read holds the flat var (it does not stop the chain): the copy step still runs and reads a missing flat variable as 0, the documented copy rule. After a good Set, a bad one re-applies the last good value, so the score reads as unchanged and the warning names the bad text. The inspector clears the input field after every Set so the next number starts fresh.');
check('dispatch: text mode reads a typed name straight into a scoped text variable',
  (() => {
    const live = [textObj(1, 'input', '', 'Ada')];
    const grid = {
      0: { type: 'gameStart' },
      1: { type: 'readTextIntoVariable', targetObject: 'input', mode: 'text', storeVarName: 'typedName' },
      2: { type: 'setScopedVariable', scope: 'global', varName: 'playerName', valueKind: 'variable', value: 'typedName' },
      3: { type: 'readScopedVariable', scope: 'global', varName: 'playerName', storeVarName: 'nameNow' }
    };
    const h = makeHost(grid, live);
    h.run();
    return h.vars.typedName === 'Ada' && h.vars.nameNow === 'Ada' && h.warnings.length === 0;
  })());

// --- catalog, wiring, docs ---

const block = CAT.find(function (b) { return b && b.runtimeType === 'readTextIntoVariable'; });
check('catalog holds the Read Text Into Variable block in Variables, as an action',
  !!block && block.category === 'Variables' && block.kind === 'action' &&
  block.blockType === 'read-text-into-variable' && block.label === 'Read Text Into Variable');
check('catalog block carries the object, mode, and into-variable fields',
  !!block && JSON.stringify(block.fields.map(function (f) { return f.key; })) === '["targetObject","mode","storeVarName"]' &&
  JSON.stringify(block.fields[1].options) === '[["text","Text (as shown)"],["number","Number (parse digits)"]]');
check('catalog block defaults read as text into a blank variable',
  !!block && block.defaults.targetObject === '' && block.defaults.mode === 'text' &&
  block.defaults.storeVarName === '');
check('catalog holds 556 blocks (was 552, +4 attach)',
  CAT.length === 556, `got ${CAT.length}`);
check('hydra-universal formats the block as a readable instruction',
  typeof U.formatInstruction === 'function' &&
  U.formatInstruction({ type: 'readTextIntoVariable', targetObject: 'input', storeVarName: 'typed' }) ===
  'Read text of input into typed');
const refMd = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');
check('block reference lists the block under Variables (44)',
  refMd.includes('### Variables (44)') && refMd.includes('Read Text Into Variable'),
  'heading or block entry missing');
const guideMd = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');
check('user guide documents typed input with Read Text Into Variable',
  guideMd.includes('Read Text Into Variable'),
  'guide paragraph missing');
const playerSrc = fs.readFileSync(path.join(HYDRA, 'player-runtime.js'), 'utf8');
check('export player routes the block through the scoped-variable classifier',
  playerSrc.includes('HydraVariables.isScopedVariableAction(type)'));
const varsSrc = fs.readFileSync(path.join(HYDRA, 'hydra-variables.js'), 'utf8');
check('variables module classifier names the block',
  /isScopedVariableAction[\s\S]*readTextIntoVariable/.test(varsSrc));

if (failures) { console.log(`${failures} FAILURES`); process.exit(1); }
console.log('all read-text checks passed');
