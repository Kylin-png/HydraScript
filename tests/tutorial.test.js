// P3 item 21 — guided first-run tutorial: the First Game Tutorial template
// must be a complete, working mini-game (move, collect, score, preview),
// and the editor must show the guided steps panel for it until dismissed.
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
// P2 item 13/10: the core loads before the templates, as on the real
// pages — HydraStarterTemplates.createProject builds through the core
// factories, so a sandbox without it cannot create a project.
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-universal.js'), 'utf8'), sb, { filename: 'hydra-universal.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'starter-templates.js'), 'utf8'), sb, { filename: 'starter-templates.js' });
const HST = sb.HydraStarterTemplates;

const tpl = HST.templates.find(t => t.id === 'tutorial');
check('tutorial template is listed', !!tpl);
check('tutorial template description names the three steps',
  !!tpl && /move/i.test(tpl.description) && /coin/i.test(tpl.description) && /preview/i.test(tpl.description));

const project = HST.createProject('tutorial', 'My First Game', () => 'tut-1');
check('tutorial project carries the tutorial flag', project.tutorial === 'first-game');
check('tutorial project survives a JSON round trip with the flag intact',
  JSON.parse(JSON.stringify(project)).tutorial === 'first-game');
check('tutorial project has exactly one scene', project.scenes.length === 1);

const scene = project.scenes[0];
const names = new Set((scene.objects || []).map(o => o.name));
for (const n of ['player', 'coin', 'scoreText']) check(`tutorial scene has object ${n}`, names.has(n));
check('tutorial scene has a hint object', [...names].some(n => n === 'hint'));

const gd = scene.gridData || {};
const byType = (type) => Object.entries(gd).filter(([, d]) => d.type === type).map(([k]) => Number(k));
check('tutorial grid starts the score at 0', byType('gameStart').length >= 1 &&
  Object.values(gd).some(d => d.type === 'setVariable' && d.varName === 'score' && d.operation === 'set' && d.value === 0));
for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown']) {
  check(`tutorial grid moves on ${key}`, Object.values(gd).some(d => d.type === 'keyPressed' && d.key === key));
}
const collisionIdx = byType('collision');
check('tutorial grid has a player/coin collision', collisionIdx.some(i =>
  gd[i].object1 === 'player' && gd[i].object2 === 'coin'));
// The collision's row must score and respawn the coin (same-row chain,
// per the template logic audit in tests/templates.test.js).
const crow = collisionIdx.map(i => Math.floor(i / 60))[0];
const rowActions = Object.entries(gd)
  .filter(([k]) => Math.floor(Number(k) / 60) === crow)
  .map(([, d]) => d.type);
check('collision row adds score and moves the coin',
  rowActions.includes('setVariable') && rowActions.includes('setPosition'));
check('coin respawn uses a random position', Object.values(gd).some(d =>
  d.type === 'setPosition' && d.targetObject === 'coin' &&
  typeof d.x === 'string' && d.x.includes('Math.random')));
check('tutorial grid shows the score on screen', Object.values(gd).some(d =>
  d.type === 'setText' && d.targetObject === 'scoreText' && d.useVariable && d.varName === 'score'));
// Every grid block references only objects that exist in the scene.
const OBJ_FIELDS = ['targetObject', 'object1', 'object2', 'sourceObject'];
const dangling = [];
for (const [k, d] of Object.entries(gd)) {
  for (const f of OBJ_FIELDS) {
    if (typeof d[f] === 'string' && d[f] && !names.has(d[f])) dangling.push(`${k}:${d.type}.${f}=${d[f]}`);
  }
}
check('tutorial grid has no dangling object references', dangling.length === 0, dangling.join(', '));
// Non-tutorial templates must not carry the flag.
check('blank project has no tutorial flag', HST.createProject('blank', 'B', () => 'b-1').tutorial === undefined);

// Editor wiring (static checks over the shipped files).
const homeHtml = fs.readFileSync(path.join(HYDRA, 'home.html'), 'utf8');
check('home wizard offers the tutorial card',
  homeHtml.includes('data-template="tutorial"') && homeHtml.includes('First Game Tutorial'));
const indexHtml = fs.readFileSync(path.join(HYDRA, 'index.html'), 'utf8');
check('editor has the tutorial panel, hidden by default',
  indexHtml.includes('id="tutorial-panel"') && /id="tutorial-panel"[^>]*hidden/.test(indexHtml));
for (const id of ['tutorial-open-logic-btn', 'tutorial-open-preview-btn', 'tutorial-dismiss-btn']) {
  check(`editor panel has button ${id}`, indexHtml.includes(`id="${id}"`));
}
check('panel steps name Logic and Preview',
  indexHtml.includes('Open Logic') && indexHtml.includes('Open Preview'));
const css = fs.readFileSync(path.join(HYDRA, 'style.css'), 'utf8');
check('tutorial panel has CSS', css.includes('.tutorial-panel'));
const script = fs.readFileSync(path.join(HYDRA, 'script.js'), 'utf8');
check('script.js shows the panel only for tutorial projects',
  script.includes("project.tutorial !== 'first-game'"));
check('script.js dismisses per project id',
  script.includes('hydraTutorialDismissed:'));
check('script.js panel buttons switch tabs',
  script.includes("clickTab('script-tab')") && script.includes("clickTab('preview-tab')"));
check('script.js never shows the panel for other projects',
  script.includes("if (!project || project.tutorial !== 'first-game') return;"));

if (failures) { console.log(`${failures} FAILURE(S)`); process.exit(1); }
console.log('tutorial tests passed');
