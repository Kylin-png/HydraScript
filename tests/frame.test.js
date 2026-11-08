// Unit tests for hydra/hydra-frame.js — the shared per-frame update order
// (P2 item 15/12, slice 3: the shared-engine extraction continues here).
//
// Pure logic: frame-timing math plus the canonical phase sequence both
// runtimes (editor preview in script.js, export player in
// player-runtime.js) step through. Nothing here touches the DOM; a behavior
// change here changes both runtimes at once — which is the point of the
// extraction. The module only sequences host hooks, so the tests pin the
// ORDER (full frame and paused frame), the timing math, the never-throws
// contract, and the static routing that both loops delegate to it.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const sandbox = {};
sandbox.window = sandbox; // hydra-frame.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-frame.js'), 'utf8'),
  sandbox, { filename: 'hydra-frame.js' });
const FR = sandbox.HydraFrame;

// --- surface ---
check('HydraFrame exposed with computeDt + stepFrame + PHASES',
  !!FR && typeof FR.computeDt === 'function' &&
  typeof FR.stepFrame === 'function' && Array.isArray(FR.PHASES));
check('factorySource is a self-contained function string',
  typeof FR.factorySource === 'string' && FR.factorySource.includes('hydraFrameFactory'));
check('PHASES lists the canonical order (profile first, clearEdges last)',
  FR.PHASES[0] === 'profile' && FR.PHASES[FR.PHASES.length - 1] === 'clearEdges' &&
  FR.PHASES.indexOf('runScripts') > FR.PHASES.indexOf('pollInput') &&
  FR.PHASES.indexOf('applyPendingDestroy') > FR.PHASES.indexOf('runScripts') &&
  FR.PHASES.indexOf('applyPendingScene') > FR.PHASES.indexOf('applyPendingDestroy') &&
  FR.PHASES.indexOf('draw') > FR.PHASES.indexOf('applyPendingScene') &&
  FR.PHASES.indexOf('solveJoints') > FR.PHASES.indexOf('updatePhysics3d') &&
  FR.PHASES.indexOf('updatePhysics3d') > FR.PHASES.indexOf('updatePhysics2d') &&
  FR.PHASES.indexOf('updateUiWidgets') > FR.PHASES.indexOf('updateParticles') &&
  FR.PHASES.indexOf('updatePaths') > FR.PHASES.indexOf('updateParticles') &&
  FR.PHASES.indexOf('updateAI') > FR.PHASES.indexOf('updateParticles') &&
  FR.PHASES.indexOf('updateDamageNumbers') > FR.PHASES.indexOf('updateParticles') &&
  FR.PHASES.indexOf('updateAI') > FR.PHASES.indexOf('updateDamageNumbers') &&
  FR.PHASES.indexOf('updatePaths') > FR.PHASES.indexOf('updateAI') &&
  FR.PHASES.indexOf('updateSpawners') > FR.PHASES.indexOf('updatePaths') &&
  FR.PHASES.indexOf('updatePlatforms') > FR.PHASES.indexOf('updateSpawners') &&
  FR.PHASES.indexOf('updateMovement') > FR.PHASES.indexOf('updatePlatforms') &&
  FR.PHASES.indexOf('updateCombat') > FR.PHASES.indexOf('updateMovement') &&
  FR.PHASES.indexOf('updateAttachments') > FR.PHASES.indexOf('updateCombat') &&
  FR.PHASES.indexOf('updateAttachments') < FR.PHASES.indexOf('runScripts') &&
  FR.PHASES.indexOf('updateUiWidgets') > FR.PHASES.indexOf('updateCombat') &&
  FR.PHASES.indexOf('updateUiWidgets') > FR.PHASES.indexOf('updateMovement') &&
  FR.PHASES.indexOf('updateUiWidgets') > FR.PHASES.indexOf('updateSpawners') &&
  FR.PHASES.indexOf('updateJoystick') > FR.PHASES.indexOf('pollInput') &&
  FR.PHASES.indexOf('runScripts') > FR.PHASES.indexOf('updateJoystick') &&
  FR.PHASES.indexOf('updateUiWidgets') > FR.PHASES.indexOf('updatePaths') &&
  FR.PHASES.indexOf('resetContexts') > FR.PHASES.indexOf('updateUiWidgets'));

// --- computeDt ---
{
  const first = FR.computeDt(0, 1000);
  check('computeDt: first frame (lastTime 0) has dt 0 and realMs 0',
    first.realMs === 0 && first.dt === 0 && first.lastTime === 1000, JSON.stringify(first));
  const firstNull = FR.computeDt(null, 500);
  check('computeDt: first frame (lastTime null) has dt 0',
    firstNull.realMs === 0 && firstNull.dt === 0 && firstNull.lastTime === 500, JSON.stringify(firstNull));
  const firstUndef = FR.computeDt(undefined, 250);
  check('computeDt: first frame (lastTime undefined) has dt 0',
    firstUndef.realMs === 0 && firstUndef.dt === 0, JSON.stringify(firstUndef));
  const steady = FR.computeDt(1000, 1016.67);
  check('computeDt: a 60fps frame is dt 1',
    Math.abs(steady.dt - 1) < 0.001 && Math.abs(steady.realMs - 16.67) < 0.001, JSON.stringify(steady));
  const half = FR.computeDt(1000, 1008.335);
  check('computeDt: a half frame is dt 0.5',
    Math.abs(half.dt - 0.5) < 0.001, JSON.stringify(half));
  const hitch = FR.computeDt(1000, 1200);
  check('computeDt: a long hitch caps at dt 3',
    hitch.dt === 3 && hitch.realMs === 200, JSON.stringify(hitch));
  const backwards = FR.computeDt(1000, 900);
  check('computeDt: a backwards clock reads as dt 0, not negative',
    backwards.realMs === 0 && backwards.dt === 0 && backwards.lastTime === 900, JSON.stringify(backwards));
  const hostile = FR.computeDt('junk', 'also junk');
  check('computeDt: hostile input degrades to dt 0 without throwing',
    hostile.realMs === 0 && hostile.dt === 0 && hostile.lastTime === 0, JSON.stringify(hostile));
  const nanTs = FR.computeDt(1000, NaN);
  check('computeDt: NaN timestamp degrades to dt 0',
    nanTs.realMs === 0 && nanTs.dt === 0, JSON.stringify(nanTs));
  const infTs = FR.computeDt(1000, Infinity);
  check('computeDt: Infinity timestamp degrades to dt 0',
    infTs.realMs === 0 && infTs.dt === 0, JSON.stringify(infTs));
}

// --- stepFrame: full unpaused order ---
function recordingHost(overrides) {
  const seen = [];
  const host = { timestamp: 1016.67, dt: 1, realMs: 16.67, isPaused: () => false };
  FR.PHASES.forEach((phase) => {
    if (phase === 'notePaused') { host.notePaused = (ms) => seen.push('notePaused'); return; }
    host[phase] = (arg) => seen.push(phase);
  });
  Object.assign(host, overrides || {});
  host._seen = seen;
  return host;
}
{
  const host = recordingHost();
  const stepped = FR.stepFrame(host);
  const expected = FR.PHASES.filter(p => p !== 'notePaused');
  check('stepFrame: unpaused frame runs every phase except notePaused, in canonical order',
    stepped === true && JSON.stringify(host._seen) === JSON.stringify(expected),
    JSON.stringify(host._seen));
  check('stepFrame: decayCameraFx receives dt in ms (dt 1 -> 16.67)',
    (() => {
      let got = null;
      const h = recordingHost({ decayCameraFx: (ms) => { got = ms; } });
      FR.stepFrame(h);
      return Math.abs(got - 16.67) < 0.001;
    })(), 'decay ms was not 16.67');
  check('stepFrame: profile receives the frame timestamp',
    (() => {
      let got = null;
      const h = recordingHost({ profile: (t) => { got = t; } });
      FR.stepFrame(h);
      return got === 1016.67;
    })());
}

// --- stepFrame: paused frame ---
{
  const host = recordingHost({ isPaused: () => true });
  FR.stepFrame(host);
  const simPhases = ['decayCameraFx', 'updateCamera', 'updatePhysics2d', 'updatePhysics3d',
    'solveJoints', 'updateAnimations', 'updateBlendSpaces', 'updateSkeletons',
    'updateTweens', 'updateParticles', 'updateDamageNumbers', 'updateAI',
    'updatePaths', 'updateSpawners', 'updatePlatforms', 'updateMovement', 'updateCombat'];
  check('stepFrame: paused frame runs notePaused and skips the whole world sim',
    host._seen.includes('notePaused') && simPhases.every(p => !host._seen.includes(p)),
    JSON.stringify(host._seen));
  check('stepFrame: paused frame still runs widgets, input, scripts, destroy, scene, draw, edges',
    ['updateUiWidgets', 'resetContexts', 'pollInput', 'runScripts',
      'applyPendingDestroy', 'applyPendingScene', 'draw', 'clearEdges']
      .every(p => host._seen.includes(p)), JSON.stringify(host._seen));
  check('stepFrame: paused frame order is profile, notePaused, then the post-sim phases',
    host._seen[0] === 'profile' && host._seen[1] === 'notePaused' &&
    host._seen.indexOf('updateUiWidgets') < host._seen.indexOf('runScripts') &&
    host._seen.indexOf('runScripts') < host._seen.indexOf('applyPendingDestroy'),
    JSON.stringify(host._seen));
  check('stepFrame: notePaused receives the real milliseconds',
    (() => {
      let got = null;
      const h = recordingHost({ isPaused: () => true, notePaused: (ms) => { got = ms; } });
      FR.stepFrame(h);
      return got === 16.67;
    })());
}

// --- stepFrame: degradation ---
{
  check('stepFrame: a null host is a no-op returning false', FR.stepFrame(null) === false);
  check('stepFrame: a non-object host is a no-op returning false', FR.stepFrame('nope') === false);
  check('stepFrame: an empty host steps with no phases and returns true',
    FR.stepFrame({}) === true);
  check('stepFrame: non-function hooks are skipped, not called',
    (() => {
      const h = recordingHost({ runScripts: 'not a function', draw: 42 });
      FR.stepFrame(h);
      return !h._seen.includes('runScripts') && !h._seen.includes('draw') &&
        h._seen.includes('pollInput') && h._seen.includes('clearEdges');
    })());
  check('stepFrame: a missing isPaused reads as unpaused',
    (() => {
      const h = recordingHost({ isPaused: undefined });
      FR.stepFrame(h);
      return h._seen.includes('updatePhysics2d') && !h._seen.includes('notePaused');
    })());
  check('stepFrame: a throwing phase is reported and the frame continues',
    (() => {
      const errors = [];
      const h = recordingHost({
        updatePhysics2d: () => { throw new Error('boom-physics'); },
        onPhaseError: (phase, err) => errors.push([phase, String(err && err.message || err)])
      });
      let threw = false;
      try { FR.stepFrame(h); } catch (e) { threw = true; }
      return !threw && errors.length === 1 && errors[0][0] === 'updatePhysics2d' &&
        errors[0][1] === 'boom-physics' &&
        h._seen.includes('updatePhysics3d') && h._seen.includes('runScripts') &&
        h._seen.includes('draw') && h._seen.includes('clearEdges');
    })());
  check('stepFrame: a throwing phase with no reporter is swallowed, frame continues',
    (() => {
      const h = recordingHost({ runScripts: () => { throw new Error('boom-scripts'); } });
      let threw = false;
      try { FR.stepFrame(h); } catch (e) { threw = true; }
      return !threw && h._seen.includes('applyPendingDestroy') && h._seen.includes('draw');
    })());
  check('stepFrame: a throwing isPaused reports and reads as unpaused',
    (() => {
      const errors = [];
      const h = recordingHost({
        isPaused: () => { throw new Error('boom-pause'); },
        onPhaseError: (phase) => errors.push(phase)
      });
      FR.stepFrame(h);
      return errors.length === 1 && errors[0] === 'isPaused' && h._seen.includes('updatePhysics2d');
    })());
  check('stepFrame: a throwing onPhaseError never breaks the frame',
    (() => {
      const h = recordingHost({
        updateTweens: () => { throw new Error('boom-tween'); },
        onPhaseError: () => { throw new Error('boom-reporter'); }
      });
      let threw = false;
      try { FR.stepFrame(h); } catch (e) { threw = true; }
      return !threw && h._seen.includes('draw');
    })());
  check('stepFrame: factorySource re-instantiates an independent module',
    (() => {
      const sb2 = {};
      sb2.window = sb2;
      vm.createContext(sb2);
      vm.runInContext(`window.HydraFrame=(${FR.factorySource})();`, sb2, { filename: 'hydra-frame.js' });
      const F2 = sb2.HydraFrame;
      return F2 !== FR && typeof F2.stepFrame === 'function' &&
        F2.computeDt(0, 100).dt === 0 && JSON.stringify(F2.PHASES) === JSON.stringify(FR.PHASES);
    })());
}

// --- static routing: both loops delegate to the module ---
{
  const runtimeSrc = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'player-runtime.js'), 'utf8');
  const scriptSrc = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'script.js'), 'utf8');
  const moduleSrc = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-previewruntime.js'), 'utf8');
  const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'index.html'), 'utf8');
  const conditionsSrc = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-conditions.js'), 'utf8');
  check('player-runtime.js hard-guards on HydraFrame',
    runtimeSrc.includes("throw new Error('HydraScript player runtime requires hydra-frame.js (window.HydraFrame) to be loaded first.');"));
  check('player-runtime.js inlines HydraFrame into exports (sharedSources)',
    runtimeSrc.includes("['HydraFrame', global.HydraFrame && global.HydraFrame.factorySource, 'hydra-frame.js (window.HydraFrame)']"));
  check('player-runtime.js loop computes timing through HydraFrame.computeDt',
    runtimeSrc.includes('HydraFrame.computeDt(state.lastTime, timestamp)'));
  check('player-runtime.js loop steps through HydraFrame.stepFrame',
    runtimeSrc.includes('HydraFrame.stepFrame({'));
  check('player-runtime.js loop no longer inlines the dt math',
    !/state\.dt = Math\.min\(realMs \/ 16\.67, 3\)/.test(runtimeSrc));
  check('player-runtime.js loop no longer inlines the old phase sequence',
    !/HydraCameraFx\.decay\(state\.shake, state\.flash, state\.dt \* 16\.67\)/.test(runtimeSrc));
  check('script.js gameLoop delegates the frame timing to the module',
    scriptSrc.includes('window.HydraPreviewRuntime.gameLoop(timestamp)'));
  check('the preview runtime module gameLoop computes timing through HydraFrame.computeDt',
    moduleSrc.includes('Frame.computeDt(loopLastTime, timestamp)'));
  check('the preview runtime module gameLoop steps through HydraFrame.stepFrame',
    moduleSrc.includes('Frame.stepFrame({'));
  check('the preview runtime module gameLoop keeps the inline dt fallback for a missing Frame tag',
    /if \(!loopLastTime\) loopLastTime = timestamp;\n\s*realMs = Math\.max\(0, timestamp - loopLastTime\);\n\s*dt = Math\.min\(realMs \/ 16\.67, 3\);/.test(moduleSrc));
  check('script.js gameLoop no longer inlines the dt math',
    !/const dt = Math\.min\(realMs \/ 16\.67, 3\);/.test(scriptSrc));
  check('the preview runtime module gameLoop no longer applies pendingDestroy before scripts',
    moduleSrc.indexOf('runScripts: function ()') !== -1 &&
    moduleSrc.indexOf('runScripts: function ()') < moduleSrc.indexOf('applyPendingDestroy: function ()'));
  check('the preview runtime module gameLoop runs 3D physics before joints (export order)',
    moduleSrc.indexOf('updatePhysics3d: function ()') !== -1 &&
    moduleSrc.indexOf('updatePhysics3d: function ()') < moduleSrc.indexOf('solveJoints: function ()'));
  check('the preview runtime module live-object snapshot excludes pending-destroy objects',
    moduleSrc.includes('var objs = getAlivePreviewObjects();'));
  check('the preview runtime module camera-follow target excludes pending-destroy objects',
    moduleSrc.includes('var alive = getAlivePreviewObjects();') &&
    moduleSrc.includes("hostCall('getObjectsByName', [camera.followTarget, alive], [])"));
  check('script.js expression lookups exclude pending-destroy objects',
    scriptSrc.includes('alive = previewState.objects.filter(o => !destroyedObjects.has(o.id) && !pendingDestroy.has(o.id));'));
  // Cycle 68 (slice 8): the tile conditions moved out of script.js into
  // the shared HydraConditions module — the alive-list lookup now lives
  // in the preview runtime module's conditionCtx named() (the alive
  // list from getAlivePreviewObjects, hidden filtered out), and the
  // module's tilemapsNamed filters that list to tilemaps for both
  // tileSolidAt and standingOnTile. Cycle 72: conditionCtx moved from
  // script.js into hydra-previewruntime.js.
  check('the preview runtime module tilemap lookups use the alive list, not the raw object list',
    moduleSrc.includes('return objectsByName(name, getAlivePreviewObjects())') &&
    moduleSrc.includes('return !hiddenSet().has(o.id);') &&
    conditionsSrc.includes("return named(ctx, name).filter(function (o) { return o && o.kind === 'tilemap'; });") &&
    conditionsSrc.includes('var maps = tilemapsNamed(ctx, data.targetObject);') &&
    conditionsSrc.includes('var maps = tilemapsNamed(ctx, data.tilemapName);') &&
    conditionsSrc.includes('pass = named(ctx, data.targetObject).some(function (o) {'));
  check('index.html loads hydra-frame.js before player-runtime.js and script.js',
    indexSrc.indexOf('src="hydra-frame.js') !== -1 &&
    indexSrc.indexOf('src="hydra-frame.js') < indexSrc.indexOf('src="player-runtime.js') &&
    indexSrc.indexOf('src="hydra-frame.js') < indexSrc.indexOf('src="script.js'));
}

if (failures) { console.error(`${failures} assertion(s) failed`); process.exit(1); }
console.log('frame.test.js: all assertions passed');
