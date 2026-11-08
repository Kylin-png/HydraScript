// FPS export test: buildRetroFpsHtml must drive the arena from the project's
// scene (player spawn, Drone enemies, ReactorCore/AmmoBox/Medkit pickups),
// falling back to the built-in layout when the scene defines none.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HYDRA = path.join(__dirname, '..', 'hydra');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-expr.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-input.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-audio.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-anim.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-tween.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-ui.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-save.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-pause.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-camerafx.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-sceneinit.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-frame.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-physicsstep.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-scenereset.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-draw.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-dispatch.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-conditions.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-execute.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-particles.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-actions.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-buses.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-tiles.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-physics2d.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-flow.js'), 'utf8'), sandbox);
    vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-collections.js'), 'utf8'), sandbox, { filename: 'hydra-collections.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-math.js'), 'utf8'), sandbox, { filename: 'hydra-math.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-pick.js'), 'utf8'), sandbox, { filename: 'hydra-pick.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-layerfx.js'), 'utf8'), sandbox, { filename: 'hydra-layerfx.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-gltf.js'), 'utf8'), sandbox, { filename: 'hydra-gltf.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-3d.js'), 'utf8'), sandbox, { filename: 'hydra-3d.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-profile.js'), 'utf8'), sandbox, { filename: 'hydra-profile.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-scriptapi.js'), 'utf8'), sandbox, { filename: 'hydra-scriptapi.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-statemachine.js'), 'utf8'), sandbox, { filename: 'hydra-statemachine.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-blendspace.js'), 'utf8'), sandbox, { filename: 'hydra-blendspace.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-light2d.js'), 'utf8'), sandbox, { filename: 'hydra-light2d.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-joints.js'), 'utf8'), sandbox, { filename: 'hydra-joints.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-skeleton.js'), 'utf8'), sandbox, { filename: 'hydra-skeleton.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-localization.js'), 'utf8'), sandbox, { filename: 'hydra-localization.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-dialogue.js'), 'utf8'), sandbox, { filename: 'hydra-dialogue.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-inventory.js'), 'utf8'), sandbox, { filename: 'hydra-inventory.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-quest.js'), 'utf8'), sandbox, { filename: 'hydra-quest.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-achievement.js'), 'utf8'), sandbox, { filename: 'hydra-achievement.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-cutscene.js'), 'utf8'), sandbox, { filename: 'hydra-cutscene.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-highscore.js'), 'utf8'), sandbox, { filename: 'hydra-highscore.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-timescale.js'), 'utf8'), sandbox, { filename: 'hydra-timescale.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-transition.js'), 'utf8'), sandbox, { filename: 'hydra-transition.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-camerafeel.js'), 'utf8'), sandbox, { filename: 'hydra-camerafeel.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-parallax.js'), 'utf8'), sandbox, { filename: 'hydra-parallax.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-spatialaudio.js'), 'utf8'), sandbox, { filename: 'hydra-spatialaudio.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-pathfind.js'), 'utf8'), sandbox, { filename: 'hydra-pathfind.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-ai.js'), 'utf8'), sandbox, { filename: 'hydra-ai.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-joystick.js'), 'utf8'), sandbox, { filename: 'hydra-joystick.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-health.js'), 'utf8'), sandbox, { filename: 'hydra-health.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-damagefx.js'), 'utf8'), sandbox, { filename: 'hydra-damagefx.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-respawn.js'), 'utf8'), sandbox, { filename: 'hydra-respawn.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-spawn.js'), 'utf8'), sandbox, { filename: 'hydra-spawn.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-lives.js'), 'utf8'), sandbox, { filename: 'hydra-lives.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-movement.js'), 'utf8'), sandbox, { filename: 'hydra-movement.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-platform.js'), 'utf8'), sandbox, { filename: 'hydra-platform.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-combat.js'), 'utf8'), sandbox, { filename: 'hydra-combat.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-xp.js'), 'utf8'), sandbox, { filename: 'hydra-xp.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-growth.js'), 'utf8'), sandbox, { filename: 'hydra-growth.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-scaling.js'), 'utf8'), sandbox, { filename: 'hydra-scaling.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-boss.js'), 'utf8'), sandbox, { filename: 'hydra-boss.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-tags.js'), 'utf8'), sandbox, { filename: 'hydra-tags.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-minimap.js'), 'utf8'), sandbox, { filename: 'hydra-minimap.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-attach.js'), 'utf8'), sandbox, { filename: 'hydra-attach.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-variables.js'), 'utf8'), sandbox, { filename: 'hydra-variables.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-functions.js'), 'utf8'), sandbox, { filename: 'hydra-functions.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-loops.js'), 'utf8'), sandbox, { filename: 'hydra-loops.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-events.js'), 'utf8'), sandbox, { filename: 'hydra-events.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-trace.js'), 'utf8'), sandbox, { filename: 'hydra-trace.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'player-runtime.js'), 'utf8'), sandbox);
const HP = sandbox.HydraPlayer;
check('HydraPlayer loaded', !!HP && typeof HP.buildPlayableHtml === 'function');

function fpsProject(objects) {
  return {
    id: 'fps-1', name: 'FPS Test', eventsVersion: 1,
    playableRuntime: 'retroFps',
    fpsConfig: { theme: 'test' },
    globalGridData: {},
    scenes: [{
      id: 1, name: 'Arena', objects,
      gridData: {}, worldWidth: 800, worldHeight: 600,
      viewportWidth: 800, viewportHeight: 600, bgColor: '#111827'
    }],
    currentSceneId: 1,
    assets: {}
  };
}

// extract the cfg JSON embedded in the generated script
function getCfg(html) {
  const m = html.match(/const cfg=(\{.*?\});\n/);
  check('cfg embedded in export', !!m);
  return m ? JSON.parse(m[1].replace(/\\u003c/g, '<')) : {};
}

{
  const html = HP.buildPlayableHtml(fpsProject([
    { id: 1, name: 'PreviewPlayer', kind: 'sprite', posX: 110, posY: 230, width: 52, height: 52,
      components: [{ type: 'FirstPersonController', props: {} }] },
    { id: 2, name: 'Drone', kind: 'sprite', posX: 260, posY: 232, width: 48, height: 48 },
    { id: 3, name: 'ReactorCore', kind: 'sprite', posX: 410, posY: 236, width: 38, height: 38 },
    { id: 4, name: 'AmmoBox', kind: 'sprite', posX: 600, posY: 100, width: 30, height: 30 }
  ]));
  const cfg = getCfg(html);
  const level = cfg.level || {};
  check('player spawn comes from the scene',
    level.playerStart && Math.abs(level.playerStart.x - 2.7) < 0.01 && Math.abs(level.playerStart.y - 5.1) < 0.01,
    JSON.stringify(level.playerStart));
  check('Drone becomes an enemy at scene position',
    Array.isArray(level.enemies) && level.enemies.length === 1 &&
    Math.abs(level.enemies[0].x - 5.7) < 0.01 && Math.abs(level.enemies[0].y - 5.1) < 0.01,
    JSON.stringify(level.enemies));
  check('ReactorCore/AmmoBox become pickups',
    Array.isArray(level.pickups) && level.pickups.length === 2 &&
    level.pickups.some(p => p.type === 'core') && level.pickups.some(p => p.type === 'ammo'),
    JSON.stringify(level.pickups));
  check('export boots the raycaster (not the 2D runtime)',
    html.includes('requestPointerLock') && !html.includes('hydraPlayer'));
}

{
  // no scene objects -> built-in fallback layout, unchanged behavior
  const html = HP.buildPlayableHtml(fpsProject([]));
  const cfg = getCfg(html);
  check('empty scene falls back to built-in layout',
    cfg.level && !cfg.level.enemies && !cfg.level.pickups && !cfg.level.playerStart,
    JSON.stringify(cfg.level));
  check('fallback HTML still contains the default arena',
    html.includes('1000000002000001'));
}

if (failures) { console.error(`${failures} assertion(s) failed`); process.exit(1); }
console.log('fps-export.test.js: all assertions passed');
