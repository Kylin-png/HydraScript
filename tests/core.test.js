// P2 item 13/10 — core factories behind the firewall: HydraUniversal
// is the ONLY place that builds project/scene/object records from
// scratch, and every factory returns its record through the matching
// normalizer, so nothing unnormalized can enter the store. The editor
// (New Scene, Add Object, New Project), the hub fallback, and the
// starter templates all route through these three functions; the
// firewall half (every construction site routed) is checked statically
// at the bottom, and the live editor half in tests/browser-smoke.js.
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
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-universal.js'), 'utf8'), sb, { filename: 'hydra-universal.js' });
// The 3D module loads too, so the 3D-kind factory checks below exercise
// the real 3D path (names, depth, z/rotation fields) instead of the
// no-Hydra3d fallback.
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-3d.js'), 'utf8'), sb, { filename: 'hydra-3d.js' });
const HU = sb.HydraUniversal;

check('factories are exposed on HydraUniversal',
  typeof HU.createScene === 'function' && typeof HU.createObject === 'function' &&
  typeof HU.createProject === 'function');

// ---------- createScene ----------
{
  const s = HU.createScene({ id: 7, name: 'Level 1' });
  check('createScene: explicit id/name honored', s.id === 7 && s.name === 'Level 1');
  check('createScene: default size 800x600', s.width === 800 && s.height === 600);
  check('createScene: default white background', s.bgColor === '#ffffff');
  check('createScene: empty objects + grids', Array.isArray(s.objects) && s.objects.length === 0 &&
    typeof s.gridData === 'object' && typeof s.logicGrids.main === 'object');
  check('createScene: normalized (renderMode + layers + entities alias)',
    s.renderMode === '2d' && Array.isArray(s.layers) && s.layers.length === 3 &&
    s.entities === s.objects);
  const d = HU.createScene();
  check('createScene: defaults when nothing passed', d.name === 'New Scene' && d.bgColor === '#ffffff');
  check('createScene: minted ids are unique', HU.createScene().id !== HU.createScene().id);
  const u = HU.createScene({ id: 9, name: undefined, bgColor: undefined });
  check('createScene: explicit undefined never clobbers a default',
    u.id === 9 && u.name === 'New Scene' && u.bgColor === '#ffffff');
  const h = HU.createScene('not-an-object');
  check('createScene: hostile input degrades to defaults without throwing',
    h && h.name === 'New Scene' && Array.isArray(h.objects));
  const withObj = HU.createScene({ id: 11, objects: [{ id: 1, name: 'hero', kind: 'sprite' }] });
  const tf = withObj.objects[0].components && withObj.objects[0].components.find(c => c.type === 'Transform');
  check('createScene: objects passed in are normalized', !!tf && tf.props.width === 1);
}

// ---------- createObject ----------
// Hydra3d is loaded in this sandbox, so the 3D-kind checks below
// exercise the real 3D path (names, depth, z/rotation fields).
{
  const o = HU.createObject('sprite', { id: 5, posX: 10, posY: 20 });
  check('createObject sprite: id/position honored', o.id === 5 && o.posX === 10 && o.posY === 20);
  check('createObject sprite: 60x60 default', o.width === 60 && o.height === 60);
  check('createObject sprite: default color + physics',
    o.color === '#4488ff' && o.physics && o.physics.friction === 0.82 && o.physics.maxSpeed === 25);
  check('createObject sprite: unnamed sprite keeps blank name', o.name === '');
  check('createObject sprite: kind/archetype agree', o.kind === 'sprite' && o.archetype === 'sprite');
  check('createObject sprite: normalized with Transform component',
    !!o.components.find(c => c.type === 'Transform') &&
    o.components.find(c => c.type === 'Transform').props.x === 10);
  check('createObject sprite: hitbox matches size', o.hitboxWidth === 60 && o.hitboxHeight === 60);

  const t = HU.createObject('text');
  check('createObject text: 160x32, text kind, Text content',
    t.width === 160 && t.height === 32 && t.kind === 'text' && t.text === 'Text');
  check('createObject text: pinned + dark text color', t.uiPinned === true && t.textColor === '#111827');

  const b = HU.createObject('button');
  check('createObject button: 160x42, stored as text kind, Button name',
    b.width === 160 && b.height === 42 && b.kind === 'text' && b.archetype === 'button' && b.name === 'Button');
  check('createObject button: rounded corners + white centered label',
    b.cornerRadius === 8 && b.textColor === '#ffffff' && b.textAlign === 'center');

  const p = HU.createObject('panel');
  check('createObject panel: 320x200, HUD, rounded',
    p.width === 320 && p.height === 200 && p.hud === true && p.cornerRadius === 12);

  const tm = HU.createObject('tilemap');
  check('createObject tilemap: 320x320', tm.width === 320 && tm.height === 320);

  const e = HU.createObject('empty');
  check('createObject empty: 34x34, Entity, stored as sprite',
    e.width === 34 && e.height === 34 && e.name === 'Entity' && e.kind === 'sprite');

  const box = HU.createObject('box3d');
  check('createObject box3d: 80 cube from the size table, Box3D name, z 0',
    box.width === 80 && box.height === 80 && box.depth === 80 &&
    box.name === 'Box3D' && box.z === 0 && box.rotX === 0);
  const plane = HU.createObject('plane3d');
  check('createObject plane3d: thin 160x120 slab',
    plane.width === 160 && plane.height === 120 && plane.depth === 4 && plane.name === 'Plane3D');

  const over = HU.createObject('sprite', { id: 3, name: 'hero', color: '#ff0000', width: 99, posX: undefined });
  check('createObject: overrides win, undefined does not clobber',
    over.id === 3 && over.name === 'hero' && over.color === '#ff0000' &&
    over.width === 99 && over.hitboxWidth === 99 && over.posX === 0);
  check('createObject: minted ids are unique', HU.createObject('sprite').id !== HU.createObject('sprite').id);
  const weird = HU.createObject('nope-kind');
  check('createObject: unknown kind keeps its archetype, sprite defaults',
    weird.archetype === 'nope-kind' && weird.kind === 'nope-kind' && weird.width === 60);
  const hostile = HU.createObject(null);
  check('createObject: hostile kind degrades to sprite without throwing',
    hostile && hostile.kind === 'sprite' && hostile.width === 60);
  const hostile2 = HU.createObject('sprite', 'not-an-object');
  check('createObject: hostile options degrade to defaults without throwing',
    hostile2 && hostile2.kind === 'sprite' && hostile2.width === 60);
}

// ---------- createProject ----------
{
  const blank = HU.createProject();
  check('createProject: blank project has one Scene 1',
    blank.scenes.length === 1 && blank.scenes[0].name === 'Scene 1' && blank.scenes[0].id === 1);
  check('createProject: blank project ids/counters',
    blank.currentSceneId === 1 && blank.nextSceneId === 2 && blank.sceneCount === 1);
  check('createProject: blank project defaults',
    blank.name === 'Untitled Project' && blank.eventsVersion === 1 &&
    typeof blank.globalGridData === 'object' && typeof blank.logicGrids.global === 'object' &&
    typeof blank.assets === 'object');
  check('createProject: generated id is a non-empty string',
    typeof blank.id === 'string' && blank.id.length > 0);
  check('createProject: normalized (input actions, buses, localization)',
    Array.isArray(blank.inputActions) && blank.audioBuses && blank.audioBuses.music &&
    blank.localization && blank.localization.defaultLanguage === 'en');
  check('createProject: blank project has no variable definitions',
    Array.isArray(blank.scopedVariables) && blank.scopedVariables.length === 0);
  check('createProject: blank project has no functions',
    Array.isArray(blank.functions) && blank.functions.length === 0);
  check('createProject: a function list survives the factory (the Functions manager owns it)',
    (() => {
      const p = HU.createProject({ functions: [
        { id: 'fn_add', name: 'add', params: ['a', 'b'], grid: {} }
      ] });
      return Array.isArray(p.functions) && p.functions.length === 1 &&
        p.functions[0].name === 'add' &&
        JSON.stringify(p.functions[0].params) === JSON.stringify(['a', 'b']);
    })());
  check('createProject: a definition list survives the factory (the Variables manager owns it)',
    (() => {
      const p = HU.createProject({ scopedVariables: [
        { name: 'score', scope: 'global', type: 'number', value: 0 },
        { name: 'hp', scope: 'object', objectName: 'goblin', type: 'number', value: 30 }
      ] });
      return Array.isArray(p.scopedVariables) && p.scopedVariables.length === 2 &&
        p.scopedVariables[0].name === 'score' && p.scopedVariables[1].objectName === 'goblin';
    })());
  check('createProject: two blanks get different ids', HU.createProject().id !== HU.createProject().id);

  const withFactory = HU.createProject({ name: 'Made', idFactory: () => 'abc-1' });
  check('createProject: idFactory supplies the id', withFactory.id === 'abc-1' && withFactory.name === 'Made');
  const withId = HU.createProject({ id: 'fixed', idFactory: () => 'ignored' });
  check('createProject: explicit id wins over idFactory', withId.id === 'fixed');

  const s1 = HU.createScene({ id: 4, name: 'A' });
  const s2 = HU.createScene({ id: 9, name: 'B' });
  const multi = HU.createProject({ id: 'm1', name: 'Multi', scenes: [s1, s2] });
  check('createProject: scenes honored, counters derived from them',
    multi.scenes.length === 2 && multi.currentSceneId === 4 &&
    multi.nextSceneId === 10 && multi.sceneCount === 2);

  const flagged = HU.createProject({ id: 't1', tutorial: 'first-game' });
  check('createProject: extra fields pass through', flagged.tutorial === 'first-game');
  const damaged = HU.createProject({ id: 'd1', scenes: 'nope', assets: [] });
  check('createProject: damaged scenes repair to a blank Scene 1',
    damaged.scenes.length === 1 && damaged.scenes[0].name === 'Scene 1');
  const hostile = HU.createProject('not-an-object');
  check('createProject: hostile input degrades to a blank project without throwing',
    hostile && hostile.scenes.length === 1 && hostile.name === 'Untitled Project');
  const round = JSON.parse(JSON.stringify(HU.createProject({ id: 'r1', name: 'Round' })));
  HU.normalizeProject(round);
  check('createProject: survives a JSON round trip with aliases restored',
    round.logicGrids.global === round.globalGridData &&
    round.logicGrids[String(round.scenes[0].id)] === round.scenes[0].gridData);
}

// ---------- templates through the factory are normalized ----------
{
  const tplSb = {}; tplSb.window = tplSb; vm.createContext(tplSb);
  vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-universal.js'), 'utf8'), tplSb, { filename: 'hydra-universal.js' });
  vm.runInContext(fs.readFileSync(path.join(HYDRA, 'starter-templates.js'), 'utf8'), tplSb, { filename: 'starter-templates.js' });
  const HST = tplSb.HydraStarterTemplates;
  let allOk = true;
  HST.templates.forEach(t => {
    try {
      const p = HST.createProject(t.id, 'T', () => 'x-' + t.id);
      if (!p || !Array.isArray(p.scenes) || !p.scenes.length) allOk = false;
      if (!Array.isArray(p.inputActions) || !p.audioBuses || !p.localization) allOk = false;
      p.scenes.forEach(s => { if (s.renderMode !== '2d' && s.renderMode !== '3d') allOk = false; });
    } catch (e) { allOk = false; }
  });
  check('every template builds through the factory, normalized', allOk);
  const tut = HST.createProject('tutorial', 'Tut', () => 'tut-1');
  check('tutorial template still carries its flag through the factory', tut.tutorial === 'first-game');
  const arena = HST.createProject('arenafps', 'Arena', () => 'a-1');
  check('arenafps template still carries its runtime config through the factory',
    arena.playableRuntime === 'retroFps' && arena.fpsConfig && arena.fpsConfig.theme === 'neon-reactor');
}

// ---------- firewall: no second construction literal survives ----------
const scriptJs = fs.readFileSync(path.join(HYDRA, 'script.js'), 'utf8');
const projectJs = fs.readFileSync(path.join(HYDRA, 'project.js'), 'utf8');
const templatesJs = fs.readFileSync(path.join(HYDRA, 'starter-templates.js'), 'utf8');
const homeJs = fs.readFileSync(path.join(HYDRA, 'home.js'), 'utf8');
check('firewall: script.js createScene routes through the factory',
  /function createScene\(\) \{\n\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*const newScene = window\.HydraUniversal\.createScene\(\{/.test(scriptJs));
check('firewall: script.js keeps no hand-built scene literal',
  !scriptJs.includes("id: nextSceneId++, name: `Scene ${scenes.length + 1}`,"));
check('firewall: script.js addGameObject routes through the factory',
  scriptJs.includes('window.HydraUniversal.createObject(kind, {'));
check('firewall: script.js keeps no kind-defaults size table',
  !scriptJs.includes('let width = 60, height = 60;'));
check('firewall: project.js createNewProject routes through the factory',
  projectJs.includes('window.HydraUniversal.createProject({'));
check('firewall: project.js keeps no hand-built project literal',
  !projectJs.includes('assets: {} // assetId -> {name, dataUrl}'));
check('firewall: starter-templates createProject routes through the factory',
  templatesJs.includes('U.createProject({') && templatesJs.includes('globalThis.HydraUniversal') && !templatesJs.includes('window.HydraUniversal'));
check('firewall: starter-templates keeps no hand-built project literal',
  !templatesJs.includes('sceneCount: templateScenes.length,'));
check('firewall: home.js fallback routes through the factory',
  homeJs.includes('window.HydraUniversal.createProject({'));
check('firewall: home.js keeps no hand-built fallback project literal',
  !homeJs.includes('sceneCount: 1,'));

if (failures > 0) { console.log(`${failures} check(s) failed`); process.exit(1); }
console.log('core factories: all checks passed');
