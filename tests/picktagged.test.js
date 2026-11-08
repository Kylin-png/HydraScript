// Unit tests for pick objects by tag (P4 Advanced batch 35: pick
// objects by tag, beginner edition).
//
// Pure logic: the tag matcher (trimmed, case-insensitive, a blank tag
// never matches), the tag pickers (nearest / farthest / random over
// the live objects carrying a tag), the condition dispatch (the same
// shape as the name picks, through the pickHooks' liveObjectsByTag
// hook with an allLiveObjects fallback), and the action pick
// (pickTaggedObject: one live tagged object by mode). Static checks
// at the end pin the wiring: catalog blocks, both runtimes' pick
// hooks, the object-reference routing, the conditions dispatch, and
// the docs.

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
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-pick.js'), 'utf8'),
  sandbox, { filename: 'hydra-pick.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-variables.js'), 'utf8'),
  sandbox, { filename: 'hydra-variables.js' });
const P = sandbox.HydraPick;
const V = sandbox.HydraVariables;

check('HydraPick exposes the tag-pick helpers',
  !!P && typeof P.isPickTaggedCondition === 'function' &&
  typeof P.tagMatches === 'function' &&
  typeof P.objectsWithTagValue === 'function' &&
  typeof P.pickNearestTagged === 'function' &&
  typeof P.pickFarthestTagged === 'function' &&
  typeof P.pickRandomTagged === 'function' &&
  typeof P.evalPickTaggedCondition === 'function' &&
  typeof P.pickTaggedObject === 'function' &&
  Array.isArray(P.TAG_PICK_CONDITION_TYPES) && P.TAG_PICK_CONDITION_TYPES.length === 3);
check('factorySource is a non-empty string carrying the tag pickers',
  typeof P.factorySource === 'string' && P.factorySource.length > 100 &&
  P.factorySource.includes('evalPickTaggedCondition') &&
  P.factorySource.includes('pickTaggedObject'));

// --- the tag matcher ---
const goblin = { id: 2, name: 'goblin', posX: 500, posY: 100, width: 40, height: 40, tags: ['goblin'] };
const goblin2 = { id: 3, name: 'goblin2', posX: 600, posY: 100, width: 40, height: 40, tags: ['Goblin'] };
const coin = { id: 4, name: 'coin', posX: 300, posY: 300, width: 30, height: 30, tags: ['coin'] };
const hero = { id: 1, name: 'hero', posX: 100, posY: 100, width: 40, height: 40, tags: [] };
const plain = { id: 5, name: 'rock', posX: 0, posY: 0, width: 20, height: 20 };
const objects = [hero, goblin, goblin2, coin, plain];

check('tagMatches ignores case and space, and a blank tag never matches',
  P.tagMatches(goblin, 'GOBLIN') && P.tagMatches(goblin2, ' goblin ') &&
  P.tagMatches(goblin, 'goblin') && !P.tagMatches(goblin, 'coin') &&
  !P.tagMatches(goblin, '') && !P.tagMatches(goblin, '   ') &&
  !P.tagMatches(goblin, null) && !P.tagMatches(plain, 'goblin') &&
  !P.tagMatches(null, 'goblin') && !P.tagMatches('goblin', 'goblin'));
check('objectsWithTagValue filters in list order and reads a blank tag as none',
  (() => {
    const gs = P.objectsWithTagValue(objects, 'goblin');
    return gs.length === 2 && gs[0] === goblin && gs[1] === goblin2 &&
      P.objectsWithTagValue(objects, 'GOBLIN').length === 2 &&
      P.objectsWithTagValue(objects, 'coin').length === 1 &&
      P.objectsWithTagValue(objects, '').length === 0 &&
      P.objectsWithTagValue(objects, 'boss').length === 0 &&
      P.objectsWithTagValue(null, 'goblin').length === 0 &&
      P.objectsWithTagValue('nope', 'goblin').length === 0;
  })());

// --- the tag pickers over a list ---
check('pickNearestTagged picks the closest tagged object to the point',
  P.pickNearestTagged(objects, 'goblin', 120, 120) === goblin &&
  P.pickNearestTagged(objects, 'goblin', 640, 120) === goblin2);
check('pickFarthestTagged picks the furthest tagged object from the point',
  P.pickFarthestTagged(objects, 'goblin', 120, 120) === goblin2 &&
  P.pickFarthestTagged(objects, 'goblin', 640, 120) === goblin);
check('pickRandomTagged picks one of the tagged objects, and none when the tag is empty',
  (() => {
    const one = P.pickRandomTagged(objects, 'goblin');
    return (one === goblin || one === goblin2) &&
      P.pickRandomTagged(objects, 'coin') === coin &&
      P.pickRandomTagged(objects, 'boss') === null &&
      P.pickRandomTagged(objects, '') === null &&
      P.pickRandomTagged([], 'goblin') === null;
  })());
check('the tag pickers read a blank tag as no candidates',
  P.pickNearestTagged(objects, '', 0, 0) === null &&
  P.pickFarthestTagged(objects, '  ', 0, 0) === null);

// --- the condition dispatch ---
function pickHooksFor(list) {
  return {
    liveObjects: function (name) { return list.filter(function (o) { return o.name === name; }); },
    liveObjectsByTag: function (tag) {
      var t = String(tag).trim().toLowerCase();
      return list.filter(function (o) {
        return Array.isArray(o.tags) && o.tags.some(function (x) {
          return typeof x === 'string' && x.trim().toLowerCase() === t;
        });
      });
    },
    num: function (raw) { var n = Number(raw); return { ok: Number.isFinite(n), value: n }; },
    warn: function () {}
  };
}
const hooks = pickHooksFor(objects);

check('isPickTaggedCondition names the three tag-pick conditions',
  P.isPickTaggedCondition('pickNearestTagged') && P.isPickTaggedCondition('pickFarthestTagged') &&
  P.isPickTaggedCondition('pickRandomTagged') &&
  !P.isPickTaggedCondition('pickNearest') && !P.isPickTaggedCondition('hasTag'));
check('isPickCondition covers the tag picks too, so dispatch knows them (cycle 7 fix)',
  P.isPickCondition('pickNearestTagged') && P.isPickCondition('pickFarthestTagged') &&
  P.isPickCondition('pickRandomTagged') && P.isPickCondition('pickNearest') &&
  !P.isPickCondition('hasTag') && !P.isPickCondition('damageObject'));
check('evalPickTaggedCondition picks the nearest tagged goblin to the Near object',
  (() => {
    const r = P.evalPickTaggedCondition(
      { type: 'pickNearestTagged', tag: 'goblin', nearObject: 'hero' }, hooks);
    return r.pass === true && r.context.obj1 === goblin;
  })());
check('evalPickTaggedCondition picks the farthest tagged goblin from the Near object',
  (() => {
    const r = P.evalPickTaggedCondition(
      { type: 'pickFarthestTagged', tag: 'goblin', nearObject: 'hero' }, hooks);
    return r.pass === true && r.context.obj1 === goblin2;
  })());
check('evalPickTaggedCondition falls back to the X/Y point when Near is blank',
  (() => {
    const r = P.evalPickTaggedCondition(
      { type: 'pickNearestTagged', tag: 'goblin', nearObject: '', pointX: 640, pointY: 120 }, hooks);
    return r.pass === true && r.context.obj1 === goblin2;
  })());
check('evalPickTaggedCondition picks one random tagged goblin',
  (() => {
    const r = P.evalPickTaggedCondition({ type: 'pickRandomTagged', tag: 'goblin' }, hooks);
    return r.pass === true && (r.context.obj1 === goblin || r.context.obj1 === goblin2);
  })());
check('evalPickTaggedCondition stays quiet on a blank tag and on a tag nobody carries',
  P.evalPickTaggedCondition({ type: 'pickNearestTagged', tag: '', nearObject: 'hero' }, hooks).pass === false &&
  P.evalPickTaggedCondition({ type: 'pickNearestTagged', tag: 'boss', nearObject: 'hero' }, hooks).pass === false &&
  P.evalPickTaggedCondition({ type: 'pickRandomTagged', tag: '' }, hooks).pass === false);
check('evalPickTaggedCondition stays quiet on a missing Near object and a bad point',
  P.evalPickTaggedCondition({ type: 'pickNearestTagged', tag: 'goblin', nearObject: 'nobody' }, hooks).pass === false &&
  P.evalPickTaggedCondition({ type: 'pickNearestTagged', tag: 'goblin', nearObject: '', pointX: 'xx', pointY: 120 }, hooks).pass === false);
check('evalPickTaggedCondition falls back to allLiveObjects when liveObjectsByTag is missing',
  (() => {
    const fallback = {
      liveObjects: hooks.liveObjects,
      allLiveObjects: function () { return objects.slice(); },
      num: hooks.num, warn: function () {}
    };
    const r = P.evalPickTaggedCondition(
      { type: 'pickNearestTagged', tag: 'goblin', nearObject: 'hero' }, fallback);
    return r.pass === true && r.context.obj1 === goblin;
  })());
check('evalPickTaggedCondition stays quiet when both list hooks are missing, and when the hook throws',
  P.evalPickTaggedCondition({ type: 'pickNearestTagged', tag: 'goblin', nearObject: 'hero' },
    { liveObjects: hooks.liveObjects, num: hooks.num, warn: function () {} }).pass === false &&
  P.evalPickTaggedCondition({ type: 'pickNearestTagged', tag: 'goblin', nearObject: 'hero' },
    { liveObjects: hooks.liveObjects,
      liveObjectsByTag: function () { throw new Error('boom'); },
      num: hooks.num, warn: function () {} }).pass === false);
check('evalPickTaggedCondition stays quiet on an unknown type and hostile data',
  P.evalPickTaggedCondition({ type: 'pickNearest' }, hooks).pass === false &&
  P.evalPickTaggedCondition(null, hooks).pass === false &&
  P.evalPickTaggedCondition({ type: 'pickNearestTagged', tag: 'goblin', nearObject: 'hero' }, null).pass === false);

// --- the action pick ---
check('pickTaggedObject picks nearest / farthest / random / first by mode',
  P.pickTaggedObject({ tag: 'goblin', pickMode: 'nearest', nearObject: 'hero' }, hooks) === goblin &&
  P.pickTaggedObject({ tag: 'goblin', pickMode: 'farthest', nearObject: 'hero' }, hooks) === goblin2 &&
  P.pickTaggedObject({ tag: 'goblin', pickMode: 'first' }, hooks) === goblin &&
  (function () {
    const one = P.pickTaggedObject({ tag: 'goblin', pickMode: 'random' }, hooks);
    return one === goblin || one === goblin2;
  })());
check('pickTaggedObject reads an unknown mode as nearest and falls back to the point',
  P.pickTaggedObject({ tag: 'goblin', pickMode: 'sideways', nearObject: 'hero' }, hooks) === goblin &&
  P.pickTaggedObject({ tag: 'goblin', pickMode: 'nearest', nearObject: '', pointX: 640, pointY: 120 }, hooks) === goblin2);
check('pickTaggedObject returns null on a blank tag, no live tagged object, and a bad reference',
  P.pickTaggedObject({ tag: '', pickMode: 'nearest', nearObject: 'hero' }, hooks) === null &&
  P.pickTaggedObject({ tag: 'boss', pickMode: 'nearest', nearObject: 'hero' }, hooks) === null &&
  P.pickTaggedObject({ tag: 'goblin', pickMode: 'nearest', nearObject: 'nobody' }, hooks) === null &&
  P.pickTaggedObject({ tag: 'goblin', pickMode: 'nearest', nearObject: '', pointX: 'xx', pointY: 0 }, hooks) === null &&
  P.pickTaggedObject(null, hooks) === null);

// --- static wiring pins ---
check('isObjectRefAction routes Pick Tagged Object Into Variable',
  V.isObjectRefAction('pickTaggedObjectIntoVariable') &&
  !V.isObjectRefAction('pickNearestTagged'));
{
  const condSrc = fs.readFileSync(path.join(HYDRA, 'hydra-conditions.js'), 'utf8');
  check('hydra-conditions.js routes the three tag picks through the pick module',
    condSrc.includes("case 'pickNearestTagged':") &&
    condSrc.includes("case 'pickFarthestTagged':") &&
    condSrc.includes("case 'pickRandomTagged':") &&
    condSrc.includes("'evalPickTaggedCondition'"));
  const exportSrc = fs.readFileSync(path.join(HYDRA, 'player-runtime.js'), 'utf8');
  check('the export pickHooks supply liveObjectsByTag through HydraTags',
    exportSrc.includes('liveObjectsByTag') &&
    exportSrc.includes('HydraTags.objectsWithTag'));
  const previewSrc = fs.readFileSync(path.join(HYDRA, 'hydra-previewruntime.js'), 'utf8');
  check('the preview pickHooks supply liveObjectsByTag through the Tags module',
    previewSrc.includes('liveObjectsByTag') &&
    previewSrc.includes("mod('Tags')"));
  const flowSrc = fs.readFileSync(path.join(HYDRA, 'hydra-flow.js'), 'utf8');
  check('hydra-flow.js defaults the nearest/farthest tag picks to level',
    flowSrc.includes("t === 'pickNearestTagged'") &&
    flowSrc.includes("t === 'pickFarthestTagged'"));
  const loopsSrc = fs.readFileSync(path.join(HYDRA, 'hydra-loops.js'), 'utf8');
  check('hydra-loops.js classifies For Each Tagged Object as a loop block',
    loopsSrc.includes("type === 'forEachTagged'"));
  const execSrc = fs.readFileSync(path.join(HYDRA, 'hydra-execute.js'), 'utf8');
  check('hydra-execute.js runs For Each Tagged Object and the tag pick action',
    execSrc.includes('runForEachTagged') &&
    execSrc.includes("type === 'pickTaggedObjectIntoVariable'"));
}
{
  const catalogSb = {}; catalogSb.window = catalogSb; vm.createContext(catalogSb);
  vm.runInContext(fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8'),
    catalogSb, { filename: 'block-catalog.js' });
  const catalog = catalogSb.HydraBlockCatalog.blocks;
  const byRuntime = {};
  catalog.forEach(function (b) { byRuntime[b.runtimeType] = b; });
  check('catalog holds 556 blocks (was 552, +4 attach)',
    catalog.length === 556, `got ${catalog.length}`);
  check('the Tags category holds 10 blocks in order',
    catalog.filter(function (b) { return b.category === 'Tags'; })
      .map(function (b) { return b.label; }).join(',') ===
      'Add Tag,Remove Tag,Clear Tags,Read Tagged Count,Has Tag,Tagged Count,' +
      'Pick Nearest Tagged,Pick Farthest Tagged,Pick Random Tagged,Pick Tagged Object Into Variable');
  check('the three tag picks are conditions with tag + reference fields',
    byRuntime.pickNearestTagged && byRuntime.pickNearestTagged.kind === 'condition' &&
    byRuntime.pickNearestTagged.fields.some(function (f) { return f.key === 'tag'; }) &&
    byRuntime.pickNearestTagged.fields.some(function (f) { return f.key === 'nearObject'; }) &&
    byRuntime.pickNearestTagged.fields.some(function (f) { return f.key === 'pointX'; }) &&
    byRuntime.pickFarthestTagged && byRuntime.pickFarthestTagged.kind === 'condition' &&
    byRuntime.pickRandomTagged && byRuntime.pickRandomTagged.kind === 'condition' &&
    byRuntime.pickRandomTagged.fields.length === 2 &&
    byRuntime.pickRandomTagged.defaults.tag === '');
  check('Pick Tagged Object Into Variable declares tag, mode, point, variable, and scope',
    (() => {
      const b = byRuntime.pickTaggedObjectIntoVariable;
      if (!b || b.kind !== 'action') return false;
      const fields = {};
      (b.fields || []).forEach(function (f) { fields[f.key] = f; });
      return b.defaults.tag === '' && b.defaults.pickMode === 'nearest' &&
        b.defaults.varName === 'target' && b.defaults.scope === 'global' &&
        fields.tag && fields.tag.control === 'text' &&
        fields.pickMode && fields.pickMode.control === 'select' &&
        fields.varName && fields.varName.control === 'text' &&
        fields.scope && fields.scope.control === 'select';
    })());
  check('For Each Tagged Object is a Control Flow action with tag, object, and index fields',
    (() => {
      const b = byRuntime.forEachTagged;
      if (!b || b.kind !== 'action' || b.category !== 'Control Flow') return false;
      const fields = {};
      (b.fields || []).forEach(function (f) { fields[f.key] = f; });
      return b.defaults.tag === '' && b.defaults.objVar === '' && b.defaults.indexVar === '' &&
        fields.tag && fields.tag.control === 'text' &&
        fields.objVar && fields.objVar.control === 'text' &&
        fields.indexVar && fields.indexVar.control === 'text';
    })());
}
{
  const ref = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');
  check('the block reference documents all five new blocks',
    ref.includes('Pick Nearest Tagged') && ref.includes('Pick Farthest Tagged') &&
    ref.includes('Pick Random Tagged') && ref.includes('Pick Tagged Object Into Variable') &&
    ref.includes('For Each Tagged Object') && ref.includes('### Tags (10)') &&
    ref.includes('### Control Flow (10)'));
  const guide = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');
  check('the user guide covers picking and walking by tag',
    guide.includes('Pick Nearest Tagged') && guide.includes('For Each Tagged Object') &&
    !guide.includes('there is no pick-by-tag yet'));
}

if (failures) { console.error(`${failures} assertion(s) failed`); process.exit(1); }
console.log('picktagged.test.js: all assertions passed');
