// P3 item 18 (block validation) regression test: the static validator in
// hydra-universal.js must catch dangling object/scene references and
// broken expressions in a project's logic grids, and stay quiet on clean
// projects — including every shipped starter template. The editor surfacing
// (diagnostics dock, refresh on grid commit / load / object or scene
// delete) is covered end to end in tests/browser-smoke.js; this file
// covers the pure validator half.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HYDRA = path.join(__dirname, '..', 'hydra');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

// ---------- full sandbox: expr + catalog + universal + templates ----------
const sb = {};
sb.window = sb;
vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-expr.js'), 'utf8'), sb, { filename: 'hydra-expr.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8'), sb, { filename: 'block-catalog.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-universal.js'), 'utf8'), sb, { filename: 'hydra-universal.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'starter-templates.js'), 'utf8'), sb, { filename: 'starter-templates.js' });
const HU = sb.HydraUniversal;
const E = sb.HydraExpr;
check('HydraUniversal + HydraExpr loaded', !!HU && typeof HU.collectProjectDiagnostics === 'function' && !!E);

// ---------- validateSyntax: syntax only, never unknown-identifier noise ----------
check('validateSyntax: plain number ok', E.validateSyntax(5).ok);
check('validateSyntax: empty string ok', E.validateSyntax('').ok);
check('validateSyntax: null ok', E.validateSyntax(null).ok);
check('validateSyntax: bare variable ok', E.validateSyntax('score').ok);
check('validateSyntax: arithmetic ok', E.validateSyntax('score + 1').ok);
check('validateSyntax: Math expression ok', E.validateSyntax('Math.floor(score / 10)').ok);
check('validateSyntax: object property ok', E.validateSyntax('player.x + 40').ok);
check('validateSyntax: comparison ok', E.validateSyntax('score >= 10').ok);
check('validateSyntax: ternary ok', E.validateSyntax('lives > 0 ? 1 : 0').ok);
check('validateSyntax: trailing operator is broken', !E.validateSyntax('score +').ok);
check('validateSyntax: unclosed paren is broken', !E.validateSyntax('(5').ok);
check('validateSyntax: unclosed Math call is broken', !E.validateSyntax('Math.floor(').ok);
check('validateSyntax: two bare words are broken', !E.validateSyntax('foo bar').ok);
check('validateSyntax: doubled operator is broken', !E.validateSyntax('5 + * 3').ok);
check('validateSyntax: broken expression carries an error message',
  typeof E.validateSyntax('score +').error === 'string' && E.validateSyntax('score +').error.length > 0);
check('validateSyntax: non-finite number is broken', !E.validateSyntax(Infinity).ok);

// ---------- helpers ----------
function projectWith(sceneGrid, objects, globalGrid) {
  return {
    id: 'v1', name: 'Validation Game',
    globalGridData: globalGrid || {},
    scenes: [{
      id: 1, name: 'Level 1',
      objects: (objects || ['player', 'coin']).map((n, i) => ({ id: i + 1, name: n })),
      gridData: sceneGrid || {}
    }]
  };
}
function messages(found) { return found.map(f => f.message); }
function hasMsg(found, re) { return messages(found).some(m => re.test(m)); }

const clean = projectWith({
  0: { type: 'always' },
  1: { type: 'applyForce', targetObject: 'player', forceX: '5', forceY: '0' },
  2: { type: 'setVariable', varName: 'score', operation: 'set', value: 'Math.floor(score / 10)' }
});
check('clean project reports nothing', HU.collectProjectDiagnostics(clean).length === 0);

// ---------- dangling object references ----------
const dangling = projectWith({
  0: { type: 'always' },
  1: { type: 'applyForce', targetObject: 'ghost', forceX: '5', forceY: '0' }
});
check('dangling object is reported', hasMsg(HU.collectProjectDiagnostics(dangling), /ghost/));
check('dangling message names the block and scope',
  hasMsg(HU.collectProjectDiagnostics(dangling), /Block 1 \(applyForce\) in Level 1/));

const danglingPair = projectWith({
  0: { type: 'collision', object1: 'player', object2: 'ghost' }
});
check('dangling second object in a legacy collision block is reported',
  hasMsg(HU.collectProjectDiagnostics(danglingPair), /ghost/));

const danglingCatalog = projectWith({
  0: { type: 'always' },
  1: { type: 'setBlend', targetObject: 'ghost', blend: 'walk', blendX: '0', blendY: '0' }
});
check('dangling object in a catalog-driven block is reported',
  hasMsg(HU.collectProjectDiagnostics(danglingCatalog), /ghost/));

check('blank object names stay quiet',
  HU.collectProjectDiagnostics(projectWith({ 0: { type: 'applyForce', targetObject: '', forceX: '5' } })).length === 0);

// A scene grid only sees its own objects; the global grid sees the union.
const twoScene = {
  id: 'v2', name: 'Two Scenes', globalGridData: {},
  scenes: [
    { id: 1, name: 'One', objects: [{ id: 1, name: 'player' }], gridData: { 0: { type: 'applyForce', targetObject: 'coin', forceX: '5' } } },
    { id: 2, name: 'Two', objects: [{ id: 2, name: 'coin' }], gridData: {} }
  ]
};
check('scene grid naming an object from another scene is reported',
  hasMsg(HU.collectProjectDiagnostics(twoScene), /coin/));
const twoSceneGlobal = {
  id: 'v3', name: 'Two Scenes Global',
  globalGridData: { 0: { type: 'applyForce', targetObject: 'coin', forceX: '5' } },
  scenes: [
    { id: 1, name: 'One', objects: [{ id: 1, name: 'player' }], gridData: {} },
    { id: 2, name: 'Two', objects: [{ id: 2, name: 'coin' }], gridData: {} }
  ]
};
check('global grid naming an object that exists in some scene stays quiet',
  HU.collectProjectDiagnostics(twoSceneGlobal).length === 0);
const twoSceneGlobalGhost = JSON.parse(JSON.stringify(twoSceneGlobal));
twoSceneGlobalGhost.globalGridData[0].targetObject = 'ghost';
check('global grid naming an object in no scene is reported',
  hasMsg(HU.collectProjectDiagnostics(twoSceneGlobalGhost), /ghost/));

// ---------- dangling scene references ----------
const danglingScene = projectWith({
  0: { type: 'switchScene', sceneId: 999 }
});
check('switchScene to a missing scene is reported',
  hasMsg(HU.collectProjectDiagnostics(danglingScene), /999/));
const goodScene = projectWith({
  0: { type: 'switchScene', sceneId: 1 }
});
check('switchScene to an existing scene stays quiet',
  HU.collectProjectDiagnostics(goodScene).length === 0);
const pushDangling = projectWith({
  0: { type: 'pushScene', sceneId: 999 }
});
check('pushScene to a missing scene is reported (catalog scene control)',
  hasMsg(HU.collectProjectDiagnostics(pushDangling), /999/));

// ---------- invalid expressions ----------
const badExprLegacy = projectWith({
  0: { type: 'applyForce', targetObject: 'player', forceX: '5 +', forceY: '0' }
});
check('broken expression in a legacy block is reported',
  hasMsg(HU.collectProjectDiagnostics(badExprLegacy), /5 \+/));
const badExprCatalog = projectWith({
  0: { type: 'setVariable', varName: 'score', operation: 'set', value: 'score +' }
});
check('broken expression in a catalog block is reported',
  hasMsg(HU.collectProjectDiagnostics(badExprCatalog), /score \+/));
check('expression message names the block and scope',
  hasMsg(HU.collectProjectDiagnostics(badExprCatalog), /Block 0 \(setVariable\) in Level 1/));
check('number-valued expression fields stay quiet',
  HU.collectProjectDiagnostics(projectWith({ 0: { type: 'setVariable', varName: 'score', operation: 'set', value: 5 } })).length === 0);

// Collections blocks: valueKind text/variable holds plain text, not an
// expression — "Iron Sword" must not be flagged as broken syntax.
const textValue = projectWith({
  0: { type: 'arrayPush', varName: 'inventory', valueKind: 'text', value: 'Iron Sword' }
});
check('text valueKind is not syntax-checked', HU.collectProjectDiagnostics(textValue).length === 0);
const varValue = projectWith({
  0: { type: 'arrayPush', varName: 'inventory', valueKind: 'variable', value: 'sword' }
});
check('variable valueKind is not syntax-checked', HU.collectProjectDiagnostics(varValue).length === 0);
const numberValueBad = projectWith({
  0: { type: 'arrayPush', varName: 'inventory', valueKind: 'number', value: '1 +' }
});
check('number valueKind is syntax-checked',
  hasMsg(HU.collectProjectDiagnostics(numberValueBad), /1 \+/));

// ---------- existing checks still fire, comments are skipped ----------
const mixed = projectWith({
  0: { type: 'comment', text: 'note' },
  1: { },
  2: { type: 'onTimer', timerName: '', interval: 1 }
});
const mixedFound = HU.collectProjectDiagnostics(mixed);
check('empty block still reported', hasMsg(mixedFound, /Empty logic block at Level 1:1/));
check('unnamed timer still reported', hasMsg(mixedFound, /unnamed/));
check('comment blocks are not validated', mixedFound.length === 2);
check('findings carry scope and index', mixedFound.every(f => typeof f.scope === 'string' && f.index !== ''));

// ---------- every shipped template is clean ----------
let id = 0;
let templateProblems = [];
for (const tpl of sb.HydraStarterTemplates.templates) {
  const p = sb.HydraStarterTemplates.createProject(tpl.id, 'Audit', () => 'audit-' + (++id));
  const found = HU.collectProjectDiagnostics(p);
  if (found.length) templateProblems.push(`${tpl.id}: ${messages(found).join(' | ')}`);
}
check('all starter templates pass block validation', templateProblems.length === 0, templateProblems.join('; '));

// ---------- runBlockValidation: feed refresh semantics ----------
HU.clearRuntimeDiagnostics();
const bad = projectWith({ 0: { type: 'applyForce', targetObject: 'ghost', forceX: '5 +' } });
const first = HU.runBlockValidation(bad);
check('runBlockValidation returns the findings', first.length === 2);
check('runBlockValidation pushes validation entries to the feed',
  HU.diagnostics.length === 2 && HU.diagnostics.every(d => d.source.kind === 'validation'));
const fixed = projectWith({ 0: { type: 'applyForce', targetObject: 'player', forceX: '5' } });
const second = HU.runBlockValidation(fixed);
check('re-running after a fix clears the old validation entries',
  second.length === 0 && HU.diagnostics.length === 0);
HU.pushDiagnostic('warning', 'a runtime warning', {});
HU.runBlockValidation(bad);
check('validation refresh leaves runtime diagnostics alone',
  HU.diagnostics.length === 3 && HU.diagnostics.some(d => d.message === 'a runtime warning'));
HU.clearRuntimeDiagnostics();

// ---------- output cap ----------
const many = {};
for (let i = 0; i < 150; i++) many[i] = { type: 'applyForce', targetObject: 'ghost' + i, forceX: '5' };
check('findings are capped instead of flooding the dock',
  HU.collectProjectDiagnostics(projectWith(many)).length <= 100);

// ---------- bare sandbox: no catalog, no HydraExpr — still safe ----------
const sb2 = {};
sb2.window = sb2;
vm.createContext(sb2);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-universal.js'), 'utf8'), sb2, { filename: 'hydra-universal.js' });
const HU2 = sb2.HydraUniversal;
check('no catalog + no HydraExpr: dangling legacy object still reported',
  HU2.collectProjectDiagnostics(projectWith({ 0: { type: 'collision', object1: 'player', object2: 'ghost' } })).length === 1);
check('no catalog + no HydraExpr: broken expressions are skipped, not thrown',
  HU2.collectProjectDiagnostics(projectWith({ 0: { type: 'applyForce', targetObject: 'player', forceX: '5 +' } })).length === 0);
check('damaged project never throws', (() => {
  try { HU2.collectProjectDiagnostics({ globalGridData: 'junk', scenes: 'junk' }); return true; }
  catch (e) { return false; }
})());

// ---------- P5-3 slice b: function bodies are validated too ----------
function projectWithFunctions(globalGrid, fnDefs) {
  const p = projectWith({}, ['player', 'coin'], globalGrid || {});
  p.functions = fnDefs || [];
  return p;
}
const fnClean = projectWithFunctions(
  { 0: { type: 'callFunction', functionName: 'add', arg1: '3', arg2: '4', storeVarName: 'result' } },
  [{ id: 'fn_add', name: 'add', params: ['a', 'b'],
     grid: { 0: { type: 'always' }, 1: { type: 'returnFromFunction', value: 'a + b' } } }]);
check('clean function project reports nothing',
  HU.collectProjectDiagnostics(fnClean).length === 0);
const fnBadExpr = projectWithFunctions({}, [
  { id: 'fn_add', name: 'add', params: ['a', 'b'],
    grid: { 0: { type: 'returnFromFunction', value: 'a +' } } }]);
check('broken expression inside a function body is reported with the function label',
  hasMsg(HU.collectProjectDiagnostics(fnBadExpr), /a \+/) &&
  hasMsg(HU.collectProjectDiagnostics(fnBadExpr), /in Function add/));
const fnDangling = projectWithFunctions({}, [
  { id: 'fn_add', name: 'add', params: ['a'],
    grid: { 0: { type: 'applyForce', targetObject: 'ghost', forceX: '5' } } }]);
check('dangling object inside a function body is reported with the function label',
  hasMsg(HU.collectProjectDiagnostics(fnDangling), /ghost/) &&
  hasMsg(HU.collectProjectDiagnostics(fnDangling), /in Function add/));
check('function body naming an object that exists in some scene stays quiet',
  HU.collectProjectDiagnostics(projectWithFunctions({}, [
    { id: 'fn_add', name: 'add', params: ['a'],
      grid: { 0: { type: 'applyForce', targetObject: 'coin', forceX: '5' } } }])).length === 0);
const fnMissingCall = projectWithFunctions(
  { 0: { type: 'callFunction', functionName: 'nope', arg1: '1', storeVarName: '' } }, []);
check('calling a function that does not exist is reported',
  hasMsg(HU.collectProjectDiagnostics(fnMissingCall), /calls function "nope"/));
const fnBlankCall = projectWithFunctions(
  { 0: { type: 'callFunction', functionName: '', arg1: '', storeVarName: '' } }, []);
check('a Call Function with no function picked is an info finding, not a warning',
  (() => {
    const found = HU.collectProjectDiagnostics(fnBlankCall);
    return found.length === 1 && found[0].level === 'info' && /no function picked/.test(found[0].message);
  })());
const fnReturnOutside = projectWithFunctions({}, [
  { id: 'fn_add', name: 'add', params: [], grid: {} }]);
fnReturnOutside.scenes[0].gridData = { 0: { type: 'returnFromFunction', value: '1' } };
check('Return From Function outside a function body is reported',
  hasMsg(HU.collectProjectDiagnostics(fnReturnOutside), /only works inside a function body/));
const fnReturnInside = projectWithFunctions({}, [
  { id: 'fn_add', name: 'add', params: [],
    grid: { 0: { type: 'returnFromFunction', value: '1' } } }]);
check('Return From Function inside a function body stays quiet',
  HU.collectProjectDiagnostics(fnReturnInside).length === 0);
check('damaged functions list never throws', (() => {
  try {
    const p = projectWith({});
    p.functions = 'junk';
    HU.collectProjectDiagnostics(p);
    const p2 = projectWith({});
    p2.functions = [{ name: 'add', grid: 'junk' }, null, { id: 'fn_x', name: 'mul', params: [], grid: { 0: { type: 'always' } } }];
    return HU.collectProjectDiagnostics(p2).length === 0;
  } catch (e) { return false; }
})());

// P5-7: the diagnostics event-sheet rebuild sees tall grids too —
// its adjacentIndexes mirrors HydraFlow (no row cap), so a condition
// at row 61 still lists the action below it in its row instead of
// reporting the action as a loose action with no trigger.
{
  const tall = projectWith({}, undefined, {
    3660: { type: 'always', kind: 'condition' },
    3720: { type: 'setVariable', kind: 'action', varName: 'x', operation: 'set', value: '1' }
  });
  const sheets = HU.rebuildProjectEventSheets(tall);
  const rows = (sheets[0] && sheets[0].events) || [];
  const condRow = rows.find(r => r.sourceIndexes && r.sourceIndexes.includes(3660));
  check('diagnostics row past row 60 includes the action below (row-60 fix)',
    !!condRow && condRow.sourceIndexes.includes(3720),
    JSON.stringify(rows.map(r => r.sourceIndexes)));
  check('diagnostics row past row 60 leaves no loose action behind',
    !rows.some(r => r.type === 'loose-action'),
    JSON.stringify(rows.map(r => [r.type, r.sourceIndexes])));
}

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log('validation.test.js: all checks passed');
