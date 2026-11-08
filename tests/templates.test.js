// Template logic audit (P3 item 24): every starter template's grid must be
// reachable, honest flow. The lone-action / adjacency-accident class of bug
// (collector + shooter, rewritten 2026-11-04) is checked structurally here
// using the real HydraFlow edges, so it cannot creep back in:
//   - every block type is a known condition, action, or comment
//   - every action is reachable from some condition (no dead actions)
//   - every action is reachable from a condition on its OWN row, for every
//     template except flagship (flagship's few off-row actions are covered
//     instead by the end-to-end playthrough in tests/flagship.test.js)
//   - no action reads a variable that a later action in the same propagation
//     writes (the Platformer Quest coin bug: setPosition ran before the
//     randomVariable that was supposed to feed it, so coin X lagged one
//     collect behind and was undefined on the first collect)
//   - no dangling object names or scene ids
//   - golden propagate orders for the three rewritten grids
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HYDRA = path.join(__dirname, '..', 'hydra');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const sb = {}; sb.window = sb; vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-flow.js'), 'utf8'), sb, { filename: 'hydra-flow.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8'), sb, { filename: 'block-catalog.js' });
// P2 item 13/10: the core loads before the templates, as on the real
// pages — HydraStarterTemplates.createProject builds through the core
// factories, so a sandbox without it cannot create a project.
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-universal.js'), 'utf8'), sb, { filename: 'hydra-universal.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'starter-templates.js'), 'utf8'), sb, { filename: 'starter-templates.js' });
const F = sb.HydraFlow;
const HST = sb.HydraStarterTemplates;

const cond = new Set(['gameStart', 'always', 'keyPressed', 'keyJustPressed', 'mouseClick',
  'mouseOverObject', 'objectClicked', 'getVariable', 'collision', 'onFloor', 'overlapTouch',
  'distanceCheck', 'positionCheck', 'velocityCheck', 'objectVisible', 'objectCount', 'chance',
  'onTimer', 'onEdge', 'and', 'triggerOnce', 'animationFinished', 'tweenFinished',
  'animStateIs', 'blendActive', 'saveSlotExists', 'gamePaused']);
const act = new Set(['applyForce', 'teleport', 'setVariable', 'destroyObject', 'showHide',
  'playSound', 'playAnimation', 'setAnimation', 'stopAnimation', 'setAnimState', 'setBlend',
  'stopBlend', 'tweenProperty', 'stopTween', 'switchScene', 'setText', 'setCamera',
  'followCamera', 'setSize', 'setVelocity', 'spawnObject', 'rotateObject', 'randomVariable',
  'forceToward', 'restartScene', 'nextScene', 'previousScene']);
for (const b of sb.HydraBlockCatalog.blocks) {
  if (b.kind === 'condition') cond.add(b.runtimeType);
  if (b.kind === 'action') act.add(b.runtimeType);
}
const api = { isCondition: t => cond.has(t), isAction: t => act.has(t) };
const OBJ_FIELDS = ['targetObject', 'object1', 'object2', 'platformObject', 'sourceObject'];
const BARE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Variables an action reads (bare-identifier setPosition coords, setText's
// variable) and writes (setVariable / randomVariable varName).
function readsOf(d) {
  const out = [];
  if (d.type === 'setPosition') {
    for (const f of ['x', 'y']) if (typeof d[f] === 'string' && BARE_IDENT.test(d[f])) out.push(d[f]);
  }
  if (d.type === 'setText' && d.useVariable && typeof d.varName === 'string' && d.varName) out.push(d.varName);
  return out;
}
function writesOf(d) {
  if ((d.type === 'setVariable' || d.type === 'randomVariable') && typeof d.varName === 'string' && d.varName) return [d.varName];
  return [];
}
function propagateOrder(gd, startIdx) {
  const log = [];
  const runApi = { ...api, evaluateCondition: () => true, executeAction: idx => log.push(idx) };
  F.propagate(gd, startIdx, runApi);
  return log;
}

let id = 0;
for (const tpl of HST.templates) {
  const project = HST.createProject(tpl.id, 'Audit', () => 'audit-' + (++id));
  const sceneIds = new Set(project.scenes.map(s => s.id));
  for (const scene of project.scenes) {
    const gd = scene.gridData || {};
    const tag = `${tpl.id}/${scene.name}`;
    const names = new Set((scene.objects || []).map(o => o.name));
    const unknown = [], dead = [], offRow = [], dangling = [], staleReads = [], crossRow = [];
    // Reachability from every condition, and same-row reachability.
    const reached = new Set();
    const sameRowReach = new Set();
    const queue = [];
    for (const [k, d] of Object.entries(gd)) if (d && cond.has(d.type)) queue.push(Number(k));
    const seenNodes = new Set(queue);
    while (queue.length) {
      const idx = queue.shift();
      const row = Math.floor(idx / 60);
      for (const e of F.flowEdges(gd, idx, api)) {
        reached.add(e);
        // Same row, or the documented and-pattern: the action sits directly
        // below its and block (the platformer jump velocity), with the two
        // gating conditions beside / above the and block.
        if (Math.floor(e / 60) === row || (gd[idx] && gd[idx].type === 'and' && e === idx + 60)) sameRowReach.add(e);
        if (!seenNodes.has(e)) { seenNodes.add(e); queue.push(e); }
      }
    }
    for (const [k, d] of Object.entries(gd)) {
      const idx = Number(k);
      if (!d || !d.type || d.type === 'comment') continue;
      if (!cond.has(d.type) && !act.has(d.type)) unknown.push(`${idx}:${d.type}`);
      if (act.has(d.type) && !reached.has(idx)) dead.push(`${idx}:${d.type}`);
      if (act.has(d.type) && tpl.id !== 'flagship' && !sameRowReach.has(idx)) offRow.push(`${idx}:${d.type}`);
      // Cross-row trigger: a plain condition directly above or below
      // an action fires it (conditions fire all four neighbours), so
      // a button row parked under another row's actions hijacks them.
      // Nov 7, 2026: the inspector's scoreMinus at 661 fired the
      // kill chain's destroyObject at 601 above it (+50 and a dead
      // goblin on every minus click). The only legitimate cross-row
      // trigger is an and/or combinator above its actions (the
      // vertical-and pattern); a plain condition above or below an
      // action is always an accident.
      if (act.has(d.type) && tpl.id !== 'flagship') {
        for (const n of [idx - 60, idx + 60]) {
          const nb = gd[n];
          if (nb && cond.has(nb.type) && nb.type !== 'and' && nb.type !== 'or') {
            crossRow.push(`${idx}:${d.type} fired by ${n}:${nb.type} on another row`);
          }
        }
      }
      for (const f of OBJ_FIELDS) {
        if (typeof d[f] === 'string' && d[f] && !names.has(d[f])) dangling.push(`${idx}:${d.type}.${f}=${d[f]}`);
      }
      if (d.type === 'switchScene' && d.sceneId != null && !sceneIds.has(d.sceneId)) dangling.push(`${idx}:switchScene->${d.sceneId}`);
    }
    // Read-before-write within one propagation.
    for (const [k, d] of Object.entries(gd)) {
      if (!d || !cond.has(d.type)) continue;
      const order = propagateOrder(gd, Number(k));
      const writtenLater = new Set();
      for (let i = order.length - 1; i >= 0; i--) {
        const a = gd[order[i]];
        for (const v of readsOf(a)) if (writtenLater.has(v)) staleReads.push(`cond ${k} action ${order[i]}:${a.type} reads ${v} before it is written later in the chain`);
        for (const v of writesOf(a)) writtenLater.add(v);
      }
    }
    check(`${tag}: all block types known`, unknown.length === 0, unknown.join(', '));
    check(`${tag}: no dead actions`, dead.length === 0, dead.join(', '));
    if (tpl.id !== 'flagship') check(`${tag}: every action on its condition's row`, offRow.length === 0, offRow.join(', '));
    if (tpl.id !== 'flagship') check(`${tag}: no condition on another row fires an action`, crossRow.length === 0, crossRow.join('; '));
    check(`${tag}: no dangling references`, dangling.length === 0, dangling.join(', '));
    check(`${tag}: no read-before-write in a chain`, staleReads.length === 0, staleReads.join('; '));
  }
}

// ---------- golden propagate orders for the rewritten grids ----------
function sceneGrid(tid, sceneName) {
  const p = HST.createProject(tid, 'Golden', () => 'golden-' + (++id));
  const scene = p.scenes.find(s => s.name === sceneName);
  return scene ? scene.gridData : null;
}
{
  const gd = sceneGrid('platformer', 'Platformer Quest');
  check('platformer coin chain order', JSON.stringify(propagateOrder(gd, 901)) === JSON.stringify([902, 903, 904, 905]),
    propagateOrder(gd, 901).join(','));
  check('platformer coin setPosition is last in its chain', gd[905] && gd[905].type === 'setPosition' && gd[905].x === 'coinX' && gd[905].y === 'coinY');
  check('platformer enemy-hit chain is one row', JSON.stringify(propagateOrder(gd, 1081)) === JSON.stringify([1082, 1083, 1084, 1085]),
    propagateOrder(gd, 1081).join(','));
}
{
  const l1 = sceneGrid('fullgame', 'Level 1 - Forest Gate');
  check('fullgame L1 jump fires only the jump velocity', JSON.stringify(propagateOrder(l1, 242)) === JSON.stringify([243]),
    propagateOrder(l1, 242).join(','));
  check('fullgame L1 enemy hit fires only its own row', JSON.stringify(propagateOrder(l1, 602)) === JSON.stringify([603, 604, 605]),
    propagateOrder(l1, 602).join(','));
  check('fullgame L1 key check fires nothing by itself', propagateOrder(l1, 1082).length === 0,
    propagateOrder(l1, 1082).join(','));
  check('fullgame L1 door fires only the scene switch', JSON.stringify(propagateOrder(l1, 1142)) === JSON.stringify([1143]),
    propagateOrder(l1, 1142).join(','));
  const l2 = sceneGrid('fullgame', 'Level 2 - Sky Ruins');
  check('fullgame L2 jump fires only the jump velocity', JSON.stringify(propagateOrder(l2, 242)) === JSON.stringify([243]),
    propagateOrder(l2, 242).join(','));
  check('fullgame L2 enemy hit fires only its own row', JSON.stringify(propagateOrder(l2, 842)) === JSON.stringify([843, 844]),
    propagateOrder(l2, 842).join(','));
  check('fullgame L2 gem fires only score + win switch', JSON.stringify(propagateOrder(l2, 961)) === JSON.stringify([962, 963]),
    propagateOrder(l2, 961).join(','));
}

if (failures) { console.log(`${failures} FAILURES`); process.exit(1); }
console.log('all template audit checks passed');
