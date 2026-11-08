// Regression tests for the nameless-sprite fix (Nov 8, 2026, Ky'lin):
// a new sprite was born with name '' (createObject named every other
// kind but not a plain sprite), so it never appeared in any object
// picker (pickers list names only) while a blank target secretly
// matched it at runtime. Plain objects deliberately keep whatever
// velocity they are set to (no clamp in integration, so Set Velocity
// is exact) — that is pinned here too, so the fix never reintroduces
// a cap. Also pins the toolbar grouping (Logic command bar +
// Preview sidebar) that came with the same fix.
//
// Pure logic + a minimal fake DOM for the picker. Nothing here touches
// a real browser; the browser smoke test covers the layout visually.

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
function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected),
    `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

function loadModule(sandbox, file) {
  vm.runInContext(fs.readFileSync(path.join(HYDRA, file), 'utf8'),
    sandbox, { filename: file });
}

// --- 1. hydra-universal.js: every kind is born named -------------------
{
  const sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  loadModule(sandbox, 'hydra-universal.js');
  const U = sandbox.HydraUniversal;

  const kinds = ['sprite', 'empty', 'button', 'panel', 'tilemap', 'camera3d',
    'light3d', 'light2d', 'box3d', 'sphere3d', 'plane3d', 'cylinder3d',
    'model3d', 'text'];
  let unnamed = [];
  kinds.forEach(k => {
    let o = null;
    try { o = U.createObject(k, { id: 9000 + kinds.indexOf(k) }); } catch (e) { o = null; }
    if (!o || typeof o.name !== 'string' || !o.name.trim()) unnamed.push(k);
  });
  check('createObject: every kind is born with a non-empty name', unnamed.length === 0,
    unnamed.length ? `unnamed: ${unnamed.join(', ')}` : '');
  check('createObject: a plain sprite is named Sprite',
    U.createObject('sprite', { id: 9101 }).name === 'Sprite');
  check('createObject: a text object is named Text, not Sprite',
    U.createObject('text', { id: 9102 }).name === 'Text');

  const blank = { kind: 'sprite', name: '' };
  U.normalizeObject(blank);
  check('normalizeObject: a blank name repairs to Sprite on load', blank.name === 'Sprite');
  const spaces = { kind: 'sprite', name: '   ' };
  U.normalizeObject(spaces);
  check('normalizeObject: a whitespace-only name repairs to Sprite', spaces.name === 'Sprite');
  const named = { kind: 'sprite', name: 'player' };
  U.normalizeObject(named);
  check('normalizeObject: an existing name is left alone', named.name === 'player');

  const scene = {
    id: 1, objects: [
      { kind: 'sprite', name: '' },
      { kind: 'sprite', name: '' },
      { kind: 'sprite', name: 'Sprite' },
      { kind: 'sprite', name: 'player' }
    ]
  };
  U.normalizeScene(scene);
  eq('normalizeScene: blank names repair to Sprite, siblings are NOT renumbered',
    scene.objects.map(o => o.name), ['Sprite', 'Sprite', 'Sprite', 'player']);
  // Same-name groups are a supported engine pattern (every goblin
  // 'goblin', every coin 'coin'): objectCount, the tag picks and the
  // for-each loops address the whole group by that one name, so load
  // must leave them exactly as authored. (Cycle 15: the first version
  // of this fix renumbered duplicates on load, which broke the
  // conditions and pick-by-tag smoke sections — the count read 1
  // instead of 2 and the loop damaged one coin three times.)
  const grouped = {
    id: 2, objects: [
      { kind: 'sprite', name: 'coin' },
      { kind: 'sprite', name: 'coin' },
      { kind: 'sprite', name: 'coin' },
      { kind: 'sprite', name: 'goblin' },
      { kind: 'sprite', name: 'goblin' }
    ]
  };
  U.normalizeScene(grouped);
  eq('normalizeScene: an authored same-name group survives load unchanged',
    grouped.objects.map(o => o.name), ['coin', 'coin', 'coin', 'goblin', 'goblin']);
}

// --- 2. hydra-execute.js: a blank target matches nothing ---------------
{
  const sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  loadModule(sandbox, 'hydra-execute.js');
  const X = sandbox.HydraExecute;

  const warnings = [];
  const destroyed = new Set();
  const objects = [
    { id: 1, name: '', kind: 'sprite', posX: 100, posY: 100, velX: 0, velY: 0, width: 60, height: 60 },
    { id: 2, name: 'player', kind: 'sprite', posX: 100, posY: 100, velX: 0, velY: 0, width: 60, height: 60 }
  ];
  const ctx = {
    variables: {}, objects: objects,
    hidden: new Set(), pendingDestroy: new Set(), destroyed: destroyed,
    executionContext: null, dt: 0.016,
    camera: { x: 0, y: 0, zoom: 1, followTarget: '', offsetX: 0, offsetY: 0 },
    canvasWidth: 800, canvasHeight: 600,
    named: (name, includeHidden) => objects.filter(o => o.name === name && !destroyed.has(o.id)),
    allObjects: () => objects.slice(),
    expr: (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; },
    exprInfo: (v) => { const n = Number(v); return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, value: 0 }; },
    warn: (msg) => { warnings.push(msg); },
    getPhysics: (o) => o.physics || { gravity: 0, friction: 0, maxSpeed: 400, bounciness: 0 },
    isCollisionObject: (o) => !!o && o.kind !== 'tilemap'
  };

  X.executeAction({ type: 'applyForce', targetObject: '', forceX: 5, forceY: 0, mode: 'add' }, ctx, 0);
  check('applyForce with a blank target moves nothing (not even the nameless object)',
    objects[0].velX === 0 && objects[1].velX === 0);
  check('applyForce with a blank target warns once, naming the block',
    warnings.length === 1 && warnings[0].indexOf('applyForce') >= 0,
    `warnings: ${JSON.stringify(warnings)}`);
  X.executeAction({ type: 'applyForce', targetObject: '', forceX: 5, forceY: 0, mode: 'add' }, ctx, 0);
  check('the blank-target warning does not repeat every frame', warnings.length === 1);

  X.executeAction({ type: 'applyForce', targetObject: 'player', forceX: 5, forceY: 0, mode: 'add' }, ctx, 0);
  check('applyForce with a named target moves that object',
    objects[1].velX === 5 && objects[0].velX === 0);
}

// --- 3. hydra-physicsstep.js: plain objects keep their velocity -------
{
  const sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  ['hydra-physicsstep.js', 'hydra-physics2d.js', 'hydra-tiles.js', 'hydra-3d.js'].forEach(m => loadModule(sandbox, m));
  const PS = sandbox.HydraPhysicsStep;
  const H3 = sandbox.Hydra3d;
  const P2D = sandbox.HydraPhysics2D;
  const T = sandbox.HydraTiles;

  function getPhysics(obj) {
    return {
      gravity: obj.physics?.gravity ?? 0,
      friction: obj.physics?.friction ?? 0.82,
      bounciness: obj.physics?.bounciness ?? 0.4,
      maxSpeed: obj.physics?.maxSpeed ?? 25
    };
  }
  function hitbox(obj) {
    return {
      x: (obj.posX || 0) + (Number(obj.hitboxOffsetX) || 0),
      y: (obj.posY || 0) + (Number(obj.hitboxOffsetY) || 0),
      width: Number(obj.hitboxWidth) > 0 ? Number(obj.hitboxWidth) : (obj.width || 1),
      height: Number(obj.hitboxHeight) > 0 ? Number(obj.hitboxHeight) : (obj.height || 1)
    };
  }
  const hooks = {
    getPhysics: getPhysics, hitbox: hitbox,
    isCollisionObject: (o) => !!o && o.kind !== 'tilemap',
    is3dKind: H3.is3dKind, isLight3d: H3.isLight3d,
    physics2d: P2D, tiles: T, prevTriggerPairs: {}
  };
  function body(over) {
    return Object.assign({
      id: 1, name: 'box', kind: 'sprite', posX: 100, posY: 150, width: 40, height: 40,
      physicsEnabled: false, physics: { gravity: 0, friction: 1, bounciness: 0, maxSpeed: 25 }
    }, over || {});
  }

  const fast = body({ velX: 100, velY: 0 });
  check('integrateBody: a plain object keeps a velocity above maxSpeed (no clamp, by design)',
    PS.integrateBody(fast, 1, hooks) === true && fast.velX === 100 && fast.posX === 200,
    `velX=${fast.velX} posX=${fast.posX}`);
  const slow = body({ velX: 5, velY: 0 });
  check('integrateBody: a plain object under the cap still glides at a steady speed',
    PS.integrateBody(slow, 1, hooks) === true && slow.velX === 5 && slow.posX === 105);
  const neg = body({ velX: -100, velY: 0 });
  check('integrateBody: a negative plain-object velocity is kept exactly too',
    PS.integrateBody(neg, 1, hooks) === true && neg.velX === -100 && neg.posX === 0);
  const bad = body({ velX: NaN, velY: 0 });
  check('integrateBody: a non-finite plain-object velocity still repairs to 0',
    PS.integrateBody(bad, 1, hooks) === true && bad.velX === 0 && bad.posX === 100);
}

// --- 4. hydra-propinputs.js: no (none) on a required target ------------
{
  const sandbox = {};
  sandbox.window = sandbox;
  function makeFakeElement(tag) {
    const el = {
      tagName: tag.toUpperCase(), value: '', textContent: '', className: '',
      children: [], appendChild(c) { this.children.push(c); return c; },
      addEventListener() {}, setAttribute() {}, focus() {}
    };
    return el;
  }
  sandbox.document = { createElement: (tag) => makeFakeElement(tag) };
  vm.createContext(sandbox);
  loadModule(sandbox, 'hydra-propinputs.js');
  const P = sandbox.HydraPropInputs;
  P.configure({ onDirty: () => {}, getObjectNames: () => ['Player', 'Coin'] });
  function optPairs(sel) { return sel.children.map(o => [o.value, o.textContent]); }

  let saved = null;
  const noBlank = P.makeObjectSelect('', (v) => { saved = v; }, false, false);
  eq('makeObjectSelect allowBlank=false: no blank row is offered',
    optPairs(noBlank), [['Player', 'Player'], ['Coin', 'Coin']]);
  check('makeObjectSelect allowBlank=false: a blank stored value is fixed to the first object',
    saved === 'Player' && noBlank.value === 'Player');

  saved = null;
  const named = P.makeObjectSelect('Coin', (v) => { saved = v; }, false, false);
  check('makeObjectSelect allowBlank=false: a valid stored value is left alone',
    saved === null && named.value === 'Coin');

  const withBlank = P.makeObjectSelect('', () => {}, false, true);
  check('makeObjectSelect allowBlank=true (catalog path): the (none) row is kept',
    optPairs(withBlank)[0][0] === '' && optPairs(withBlank)[0][1] === '(none)');
}

// --- 5. Static pins: the toolbar grouping -------------------------------
{
  const indexHtml = fs.readFileSync(path.join(HYDRA, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(HYDRA, 'style.css'), 'utf8');
  check('Logic bar: Dock left and Compact blocks sit in one right-hand group',
    indexHtml.includes('class="script-command-right"') &&
    indexHtml.indexOf('script-command-right') < indexHtml.indexOf('logic-panel-dock-btn') &&
    indexHtml.indexOf('block-density-btn') < indexHtml.indexOf('</div>', indexHtml.indexOf('script-command-right')));
  check('Logic bar CSS: the bar groups tightly instead of spreading with space-between',
    /\.script-command-bar\s*\{[^}]*justify-content:\s*flex-start/.test(css) &&
    /\.script-command-right\s*\{[^}]*margin-left:\s*auto/.test(css));
  const sb = indexHtml.indexOf('class="preview-sidebar"');
  const sbClose = indexHtml.lastIndexOf('</div>', indexHtml.indexOf('id="trace-panel"'));
  check('Preview: device controls and Live variables sit in one sidebar',
    sb >= 0 && sb < indexHtml.indexOf('preview-device-select') &&
    indexHtml.indexOf('preview-variables-panel') > sb &&
    indexHtml.indexOf('preview-variables-panel') < sbClose);
  check('Preview sidebar CSS: pinned top-right, stacked, controls static inside it',
    /\.preview-sidebar\s*\{[^}]*position:\s*absolute[^}]*top:\s*12px[^}]*right:\s*12px/.test(css) &&
    /\.preview-sidebar\s+\.preview-controls\s*\{[^}]*position:\s*static/.test(css));
}

console.log(failures === 0 ? 'ALL TESTS PASSED' : failures + ' FAILURES');
process.exit(failures ? 1 : 0);
