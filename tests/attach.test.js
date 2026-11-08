// Attach tests (P4 Advanced batch 37: object parenting, beginner
// edition) — the shared HydraAttach module (link table, cycle guard,
// per-frame apply), the execute / conditions routing, the frame phase,
// the scene-reset minting (a fresh scene gets no links), and the docs.

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
sandbox.window = sandbox; // hydra-attach.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-attach.js'), 'utf8'),
  sandbox, { filename: 'hydra-attach.js' });
const A = sandbox.HydraAttach;

check('HydraAttach exposed with helpers',
  !!A && typeof A.createAttachState === 'function' &&
  typeof A.attachCount === 'function' &&
  typeof A.wouldCycle === 'function' &&
  typeof A.attach === 'function' &&
  typeof A.detach === 'function' &&
  typeof A.setOffset === 'function' &&
  typeof A.isAttached === 'function' &&
  typeof A.attachmentOf === 'function' &&
  typeof A.applyAttachments === 'function' &&
  typeof A.isAttachAction === 'function' &&
  typeof A.isAttachCondition === 'function');
check('factorySource is a non-empty string',
  typeof A.factorySource === 'string' && A.factorySource.length > 100 &&
  A.factorySource.includes('hydraAttachFactory'));

// --- state ---
check('createAttachState starts with an empty link table',
  JSON.stringify(A.createAttachState()) === JSON.stringify({ links: {} }));
check('attachCount counts links and reads 0 for a missing state',
  A.attachCount(A.createAttachState()) === 0 &&
  A.attachCount(null) === 0 &&
  A.attachCount({}) === 0 &&
  (() => { const s = A.createAttachState(); A.attach(s, 'hat', 'hero', 0, 0); return A.attachCount(s) === 1; })());

// --- attach / detach / offset ---
check('attach stores the link with the given offset',
  (() => {
    const s = A.createAttachState();
    const ok = A.attach(s, 'hat', 'hero', 10, -20);
    return ok === true && A.attachCount(s) === 1 &&
      JSON.stringify(A.attachmentOf(s, 'hat')) ===
        JSON.stringify({ parent: 'hero', dx: 10, dy: -20 });
  })());
check('attach trims names and coerces numeric-string offsets',
  (() => {
    const s = A.createAttachState();
    const ok = A.attach(s, '  hat  ', '  hero ', '10', '-20');
    return ok === true && A.isAttached(s, 'hat', 'hero') &&
      A.attachmentOf(s, 'hat').dx === 10 && A.attachmentOf(s, 'hat').dy === -20;
  })());
check('attach refuses a blank child, a blank parent, and a self-attach',
  (() => {
    const s = A.createAttachState();
    return A.attach(s, '', 'hero', 0, 0) === false &&
      A.attach(s, 'hat', '', 0, 0) === false &&
      A.attach(s, '  ', 'hero', 0, 0) === false &&
      A.attach(s, 'hero', 'hero', 0, 0) === false &&
      A.attach(s, null, 'hero', 0, 0) === false &&
      A.attach(null, 'hat', 'hero', 0, 0) === false &&
      A.attachCount(s) === 0;
  })());
check('attaching a child again replaces the old link',
  (() => {
    const s = A.createAttachState();
    A.attach(s, 'hat', 'hero', 10, 0);
    const ok = A.attach(s, 'hat', 'goblin', 0, 30);
    return ok === true && A.attachCount(s) === 1 &&
      A.isAttached(s, 'hat', 'goblin') && !A.isAttached(s, 'hat', 'hero');
  })());
check('detach removes the link and reports whether one existed',
  (() => {
    const s = A.createAttachState();
    A.attach(s, 'hat', 'hero', 0, 0);
    return A.detach(s, 'hat') === true && A.attachCount(s) === 0 &&
      A.detach(s, 'hat') === false && A.detach(s, '') === false &&
      A.detach(null, 'hat') === false;
  })());
check('setOffset moves the spacing without re-attaching',
  (() => {
    const s = A.createAttachState();
    A.attach(s, 'hat', 'hero', 10, 0);
    const ok = A.setOffset(s, 'hat', -5, 40);
    return ok === true &&
      JSON.stringify(A.attachmentOf(s, 'hat')) ===
        JSON.stringify({ parent: 'hero', dx: -5, dy: 40 }) &&
      A.setOffset(s, 'sword', 1, 1) === false &&
      A.setOffset(s, 'hat', 'oops', 1) === false &&
      A.attachmentOf(s, 'hat').dx === -5 &&
      A.setOffset(s, 'hat', 1, 'oops') === false &&
      A.attachmentOf(s, 'hat').dy === 40;
  })());
check('isAttached reads any parent, or only the named one',
  (() => {
    const s = A.createAttachState();
    A.attach(s, 'hat', 'hero', 0, 0);
    return A.isAttached(s, 'hat') === true &&
      A.isAttached(s, 'hat', '') === true &&
      A.isAttached(s, 'hat', 'hero') === true &&
      A.isAttached(s, 'hat', 'goblin') === false &&
      A.isAttached(s, 'sword') === false &&
      A.isAttached(s, '') === false &&
      A.isAttached(null, 'hat') === false;
  })());
check('attachmentOf returns a copy, or null when unattached',
  (() => {
    const s = A.createAttachState();
    A.attach(s, 'hat', 'hero', 10, 0);
    const got = A.attachmentOf(s, 'hat');
    got.dx = 999;
    return A.attachmentOf(s, 'hat').dx === 10 &&
      A.attachmentOf(s, 'sword') === null &&
      A.attachmentOf(s, '') === null &&
      A.attachmentOf(null, 'hat') === null;
  })());

// --- cycles ---
check('wouldCycle catches direct and chained cycles',
  (() => {
    const s = A.createAttachState();
    A.attach(s, 'a', 'b', 0, 0);
    A.attach(s, 'b', 'c', 0, 0);
    return A.wouldCycle(s, 'c', 'a') === true &&
      A.wouldCycle(s, 'c', 'b') === true &&
      A.wouldCycle(s, 'a', 'b') === false &&
      A.wouldCycle(s, 'd', 'a') === false &&
      A.wouldCycle(s, 'x', 'x') === true &&
      A.wouldCycle(s, '', 'a') === false &&
      A.wouldCycle(null, 'a', 'b') === false;
  })());
check('attach refuses a link that would close a cycle',
  (() => {
    const s = A.createAttachState();
    A.attach(s, 'a', 'b', 0, 0);
    A.attach(s, 'b', 'c', 0, 0);
    return A.attach(s, 'c', 'a', 0, 0) === false &&
      A.attach(s, 'c', 'b', 0, 0) === false &&
      A.attachCount(s) === 2 &&
      A.isAttached(s, 'c') === false;
  })());

// --- per-frame apply ---
function sceneObjects() {
  return [
    { id: 1, name: 'hero', posX: 100, posY: 100, width: 40, height: 40 },
    { id: 2, name: 'hat', posX: 110, posY: 80, width: 20, height: 20 },
    { id: 3, name: 'sword', posX: 140, posY: 100, width: 30, height: 10 },
    { id: 4, name: 'goblin', posX: 500, posY: 100, width: 40, height: 40 }
  ];
}
check('applyAttachments sets the child to parent plus offset',
  (() => {
    const s = A.createAttachState();
    A.attach(s, 'hat', 'hero', 10, -20);
    const objs = sceneObjects();
    const moved = A.applyAttachments(s, objs);
    return moved === 1 && objs[1].posX === 110 && objs[1].posY === 80;
  })());
check('applyAttachments follows the parent when it moves',
  (() => {
    const s = A.createAttachState();
    A.attach(s, 'hat', 'hero', 10, -20);
    A.attach(s, 'sword', 'hero', 40, 0);
    const objs = sceneObjects();
    objs[0].posX = 300; objs[0].posY = 200;
    const moved = A.applyAttachments(s, objs);
    return moved === 2 && objs[1].posX === 310 && objs[1].posY === 180 &&
      objs[2].posX === 340 && objs[2].posY === 200;
  })());
check('applyAttachments chains: a child of a child rides along',
  (() => {
    const s = A.createAttachState();
    A.attach(s, 'hat', 'hero', 10, -20);
    A.attach(s, 'sword', 'hat', 5, 5);
    const objs = sceneObjects();
    objs[0].posX = 200; objs[0].posY = 200;
    A.applyAttachments(s, objs);
    return objs[1].posX === 210 && objs[1].posY === 180 &&
      objs[2].posX === 215 && objs[2].posY === 185;
  })());
check('applyAttachments stays quiet for a missing child or parent',
  (() => {
    const s = A.createAttachState();
    A.attach(s, 'cloak', 'hero', 0, 0);
    A.attach(s, 'hat', 'ghost', 0, 0);
    const objs = sceneObjects();
    const moved = A.applyAttachments(s, objs);
    return moved === 0 && objs[1].posX === 110 && objs[1].posY === 80;
  })());
check('applyAttachments holds the child when the parent position is not finite',
  (() => {
    const s = A.createAttachState();
    A.attach(s, 'hat', 'hero', 10, -20);
    const objs = sceneObjects();
    objs[0].posX = NaN;
    const moved = A.applyAttachments(s, objs);
    return moved === 0 && objs[1].posX === 110 && objs[1].posY === 80;
  })());
check('applyAttachments reads nothing and moves nothing without a list',
  A.applyAttachments(A.createAttachState(), null) === 0 &&
  A.applyAttachments(null, sceneObjects()) === 0 &&
  A.applyAttachments(A.createAttachState(), []) === 0);

// --- routing ---
check('routing sets cover the three attach actions and the one condition',
  A.isAttachAction('attachObjectToObject') && A.isAttachAction('detachObject') &&
  A.isAttachAction('setAttachmentOffset') &&
  !A.isAttachAction('attachObject') && !A.isAttachAction('showMinimap') &&
  !A.isAttachAction(null) &&
  A.isAttachCondition('isAttached') &&
  !A.isAttachCondition('minimapVisible') && !A.isAttachCondition('attached') &&
  !A.isAttachCondition(null));

// --- hostile input ---
check('hostile input degrades to safe defaults',
  A.attach('oops', 'hat', 'hero', 0, 0) === false &&
  A.attach(A.createAttachState(), [], {}, 0, 0) === false &&
  A.detach('oops', 'hat') === false &&
  A.setOffset('oops', 'hat', 0, 0) === false &&
  A.isAttached('oops', 'hat') === false &&
  A.attachmentOf('oops', 'hat') === null &&
  A.attachCount('oops') === 0 &&
  A.wouldCycle('oops', 'a', 'b') === false &&
  A.applyAttachments('oops', sceneObjects()) === 0 &&
  JSON.stringify(A.createAttachState()) === JSON.stringify({ links: {} }));

// --- static wiring ---
{
  const html = fs.readFileSync(path.join(HYDRA, 'index.html'), 'utf8');
  check('index.html loads hydra-attach.js after hydra-minimap.js',
    html.includes('hydra-attach.js') &&
    html.indexOf('hydra-attach.js') > html.indexOf('hydra-minimap.js'));
  const playerJs = fs.readFileSync(path.join(HYDRA, 'player-runtime.js'), 'utf8');
  check('export player runtime hard-guards the attach module',
    playerJs.includes("var HydraAttach = global.HydraAttach;") &&
    playerJs.includes("typeof HydraAttach.createAttachState !== 'function'") &&
    playerJs.includes('requires hydra-attach.js'));
  check('export player runtime inlines the attach module into exports',
    playerJs.includes("['HydraAttach', global.HydraAttach && global.HydraAttach.factorySource, 'hydra-attach.js (window.HydraAttach)']"));
  check('export player runtime mints the link table and wires the phase and contexts',
    playerJs.includes('attachments: HydraAttach.createAttachState(),') &&
    playerJs.includes('createAttachState: () => HydraAttach.createAttachState(),') &&
    playerJs.includes('updateAttachments: () => {') &&
    playerJs.includes('HydraAttach.applyAttachments(state.attachments, live)') &&
    playerJs.includes('HydraAttach.isAttachCondition(type)') &&
    playerJs.includes('HydraAttach.isAttachAction(type)') &&
    playerJs.includes('attachModule: HydraAttach,') &&
    playerJs.includes('attachments: state.attachments,'));
  const previewJs = fs.readFileSync(path.join(HYDRA, 'hydra-previewruntime.js'), 'utf8');
  check('editor preview runtime wires the attach contexts, hook, and phase',
    previewJs.includes("attachModule: mod('Attach'),") &&
    previewJs.includes('attachments: attachState(),') &&
    previewJs.includes('createAttachState: function () {') &&
    previewJs.includes("var A = mod('Attach');") &&
    previewJs.includes('A.applyAttachments(r.attachments, objs)') &&
    previewJs.includes('attachState: attachState,'));
  const frameJs = fs.readFileSync(path.join(HYDRA, 'hydra-frame.js'), 'utf8');
  check('shared frame module runs updateAttachments after updateCombat',
    frameJs.includes("'updateAttachments'") &&
    frameJs.indexOf("'updateAttachments'") > frameJs.indexOf("'updateCombat'") &&
    frameJs.indexOf('updateAttachments') > frameJs.indexOf('updateCombat') &&
    frameJs.includes("call('updateAttachments', host.updateAttachments);"));
  const executeJs = fs.readFileSync(path.join(HYDRA, 'hydra-execute.js'), 'utf8');
  check('shared execute module runs the three attach actions',
    executeJs.includes("if (isType(ctx.attachModule, 'isAttachAction', type))") &&
    executeJs.includes("type === 'attachObjectToObject'") &&
    executeJs.includes("type === 'detachObject'") &&
    executeJs.includes("type === 'setAttachmentOffset'") &&
    executeJs.includes('AT.attach(ctx.attachments, atChild, atParent, atDx, atDy)') &&
    executeJs.includes('AT.detach(ctx.attachments, dtName)') &&
    executeJs.includes('AT.setOffset(ctx.attachments, soName, soXi.value, soYi.value)'));
  const condJs = fs.readFileSync(path.join(HYDRA, 'hydra-conditions.js'), 'utf8');
  check('shared conditions module evaluates the Is Attached condition',
    condJs.includes("case 'isAttached':") &&
    condJs.includes('IAm.isAttached(ctx.attachments, iaObj, iaParent)'));
  const flowJs = fs.readFileSync(path.join(HYDRA, 'hydra-flow.js'), 'utf8');
  check('flow module defaults Is Attached to the level trigger',
    flowJs.includes("t === 'isAttached'"));
  const scriptJs = fs.readFileSync(path.join(HYDRA, 'script.js'), 'utf8');
  check('editor gives each attach block a unique icon (no text-label fallback on the grid)',
    scriptJs.includes("'attach-object-to-object': picChain(),") &&
    scriptJs.includes("'detach-object': picUnlink(),") &&
    scriptJs.includes("'set-attachment-offset': picOffsetLink(),") &&
    scriptJs.includes("'is-attached': mod(picChain(), SM.q),"));
  check('attach icons are symmetric about the block center (28, 28)',
    scriptJs.includes('function picChain()') &&
    scriptJs.includes('cx="23.5" cy="23.5"') && scriptJs.includes('cx="32.5" cy="32.5"') &&
    scriptJs.includes('function picUnlink()') &&
    scriptJs.includes('cx="22" cy="28"') && scriptJs.includes('cx="34" cy="28"') &&
    scriptJs.includes('M 25 22 L 31 34') &&
    scriptJs.includes('function picOffsetLink()') &&
    scriptJs.includes('cx="28" cy="24"') && scriptJs.includes('M 20 35 L 36 35'));
  check('attach icon helpers are used nowhere else (each icon stays unique)',
    (scriptJs.match(/picChain\(\)/g) || []).length === 3 &&
    (scriptJs.match(/picUnlink\(\)/g) || []).length === 2 &&
    (scriptJs.match(/picOffsetLink\(\)/g) || []).length === 2);
  const resetSb = {};
  resetSb.window = resetSb;
  vm.createContext(resetSb);
  vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-scenereset.js'), 'utf8'),
    resetSb, { filename: 'hydra-scenereset.js' });
  const SR = resetSb.HydraSceneReset;
  check('scene reset mints a fresh link table per scene (no leak from the last scene)',
    (() => {
      const hooks = { createAttachState: () => A.createAttachState() };
      const state = {};
      const ok1 = SR.resetSceneRuntime(state, { id: 1 }, hooks);
      const first = state.attachments;
      A.attach(first, 'hat', 'hero', 10, 0);
      const ok2 = SR.resetSceneRuntime(state, { id: 2 }, hooks);
      return ok1 === true && ok2 === true &&
        first !== null && A.attachCount(first) === 1 &&
        state.attachments !== first && state.attachments !== null &&
        A.attachCount(state.attachments) === 0;
    })());
  check('scene reset reads no links when the attach hook is missing',
    (() => {
      const state = {};
      const ok = SR.resetSceneRuntime(state, { id: 1 }, {});
      return ok === true && state.attachments === null;
    })());
  const catalogJs = fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8');
  check('catalog carries the four attach blocks in the Attach category',
    catalogJs.includes("blockType: 'attach-object-to-object'") &&
    catalogJs.includes("runtimeType: 'attachObjectToObject'") &&
    catalogJs.includes("blockType: 'detach-object'") &&
    catalogJs.includes("runtimeType: 'detachObject'") &&
    catalogJs.includes("blockType: 'set-attachment-offset'") &&
    catalogJs.includes("runtimeType: 'setAttachmentOffset'") &&
    catalogJs.includes("blockType: 'is-attached'") &&
    catalogJs.includes("runtimeType: 'isAttached'") &&
    catalogJs.includes("key: 'childObject', label: 'Child object'") &&
    catalogJs.includes("key: 'parentObject', label: 'Parent object'") &&
    catalogJs.includes("key: 'offsetX', label: 'Offset X'") &&
    catalogJs.includes("key: 'offsetY', label: 'Offset Y'"));
  const refMd = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');
  check('block reference documents all four attach blocks',
    refMd.includes('Attach Object To Object') && refMd.includes('Detach Object') &&
    refMd.includes('Set Attachment Offset') && refMd.includes('Is Attached') &&
    refMd.includes('### Attach (4)'));
  const guideMd = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');
  check('user guide covers attach',
    guideMd.includes('Attach') && guideMd.includes('Attach Object To Object') &&
    guideMd.includes('Is Attached'));
}

if (failures > 0) { console.log(`FAILURES: ${failures}`); process.exit(1); }
console.log('attach.test.js: all checks passed');
