// Unit tests for hydra/hydra-flow.js — the shared execution-flow engine.
//
// Pure logic: edge definitions (eventId, adjacency), propagation order,
// chaining, fan-out, fan-in, sub-condition gates, cycle guard, trigger modes.
// Both runtimes (editor preview + export player) delegate to this module.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}
function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected),
    `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

const sandbox = {};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-flow.js'), 'utf8'),
  sandbox, { filename: 'hydra-flow.js' });
const F = sandbox.HydraFlow;

// condition types start with 'c' (except 'comment'), actions with 'a'
const api = {
  isCondition: t => typeof t === 'string' && t[0] === 'c' && t !== 'comment',
  isAction: t => typeof t === 'string' && t[0] === 'a',
  evaluateCondition: () => true,
  executeAction: () => {}
};
function runApi(log, condResult) {
  return {
    isCondition: api.isCondition,
    isAction: api.isAction,
    evaluateCondition: (idx) => { log.push('eval:' + idx); return condResult !== false; },
    executeAction: (idx) => { log.push('exec:' + idx); }
  };
}
// grid index for row r, col c on the 60-wide grid
const at = (r, c) => r * 60 + c;

// ---- adjacentIndexes: the ONE flow geometry (P5-7) ----
(function () {
  // Reading order: right, down, left, up — the deterministic fan-out order.
  eq('adjacentIndexes center uses reading order (right, down, left, up)',
    F.adjacentIndexes(at(1, 1)), [at(1, 2), at(2, 1), at(1, 0), at(0, 1)]);
  eq('adjacentIndexes top-left corner',
    F.adjacentIndexes(at(0, 0)), [at(0, 1), at(1, 0)]);
  eq('adjacentIndexes right edge has no right neighbour',
    F.adjacentIndexes(at(0, 59)), [at(1, 59), at(0, 58)]);
  // Row-60 fix (P5-7): the grid is 60 columns wide but has NO row
  // limit, so the down-neighbour is always linked — a condition at
  // row 61 still reaches the action below it.
  eq('adjacentIndexes past row 60 still links down (row-60 fix)',
    F.adjacentIndexes(at(61, 0)), [at(61, 1), at(62, 0), at(60, 0)]);
  eq('adjacentIndexes at row 59 links down past the editor grid',
    F.adjacentIndexes(at(59, 59)), [at(60, 59), at(59, 58), at(58, 59)]);
  // The real bug, end to end through flowEdges: a condition at row 61
  // with an action below it used to see zero neighbours.
  const gdTall = { [at(61, 0)]: { type: 'c1' }, [at(62, 0)]: { type: 'a1' } };
  eq('flowEdges past row 60 reaches the action below',
    F.flowEdges(gdTall, at(61, 0), api), [at(62, 0)]);
})();

// ---- edge definitions ----
(function () {
  // adjacency: right neighbor is downstream
  const gd = { [at(0, 0)]: { type: 'c1' }, [at(0, 1)]: { type: 'a1' } };
  check('adjacent right block is downstream', F.flowEdges(gd, at(0, 0), api).join() === String(at(0, 1)));
  // adjacency: left neighbor is also downstream (undirected, matches legacy)
  const gd2 = { [at(0, 1)]: { type: 'c1' }, [at(0, 0)]: { type: 'a1' } };
  check('adjacent left block is downstream', F.flowEdges(gd2, at(0, 1), api).join() === String(at(0, 0)));
  // comments are never edges
  const gd3 = { [at(0, 0)]: { type: 'c1' }, [at(0, 1)]: { type: 'comment' } };
  check('comments are not edges', F.flowEdges(gd3, at(0, 0), api).length === 0);
  // eventId scopes: only linked blocks, not adjacent ones
  const gd4 = {
    [at(0, 0)]: { type: 'c1', eventId: 'e1' },
    [at(0, 1)]: { type: 'a1' },
    [at(5, 5)]: { type: 'a2', eventId: 'e1' }
  };
  check('eventId scopes to linked blocks only',
    F.flowEdges(gd4, at(0, 0), api).join() === String(at(5, 5)));
})();

// ---- chaining (left-to-right only) ----
(function () {
  const log = [];
  // c -> a -> a -> a : the chain runs in order
  const gd = {
    [at(1, 1)]: { type: 'c1' },
    [at(1, 2)]: { type: 'a1' },
    [at(1, 3)]: { type: 'a2' },
    [at(1, 4)]: { type: 'a3' }
  };
  F.propagate(gd, at(1, 1), runApi(log));
  check('chain executes in order',
    log.join(',') === `exec:${at(1, 2)},exec:${at(1, 3)},exec:${at(1, 4)}`, log.join(','));
  // vertical chaining does NOT happen: an action below another action is
  // independent (avoids unintended triggers)
  const logV = [];
  const gdV = {
    [at(2, 1)]: { type: 'c1' },
    [at(2, 2)]: { type: 'a1' },
    [at(3, 2)]: { type: 'a2' }
  };
  F.propagate(gdV, at(2, 1), runApi(logV));
  check('no vertical chaining from actions',
    logV.join(',') === 'exec:' + at(2, 2), logV.join(','));
})();

// ---- fan-out ----
(function () {
  const log = [];
  // c with actions right, down, and left: all fire
  const gd = {
    [at(2, 2)]: { type: 'c1' },
    [at(2, 3)]: { type: 'a1' },
    [at(3, 2)]: { type: 'a2' },
    [at(2, 1)]: { type: 'a3' }
  };
  F.propagate(gd, at(2, 2), runApi(log));
  const fired = log.filter(x => x.startsWith('exec:')).sort().join(',');
  const want = [at(2, 3), at(3, 2), at(2, 1)].map(i => 'exec:' + i).sort().join(',');
  check('fan-out fires all adjacent actions', fired === want, fired);
})();

// ---- fan-in (OR) ----
(function () {
  const log = [];
  // two conditions both adjacent to one action: each propagation fires it
  const gd = {
    [at(3, 1)]: { type: 'c1' },
    [at(3, 3)]: { type: 'c2' },
    [at(3, 2)]: { type: 'a1' }
  };
  F.propagate(gd, at(3, 1), runApi(log));
  F.propagate(gd, at(3, 3), runApi(log));
  check('fan-in fires the shared action from either condition',
    log.filter(x => x === 'exec:' + at(3, 2)).length === 2, log.join(','));
})();

// ---- conditions are NOT implicit gates via adjacency ----
// Adjacent conditions stay independent (legacy behavior); flow edges target
// actions only. Gating is a future explicit feature, not automatic.
(function () {
  const log = [];
  const gd = {
    [at(4, 1)]: { type: 'c1' },
    [at(4, 2)]: { type: 'c2' },
    [at(4, 3)]: { type: 'a1' }
  };
  const edges = F.flowEdges(gd, at(4, 1), api);
  check('adjacent condition is not a flow edge', !edges.includes(at(4, 2)), edges.join(','));
  // c1 adjacent to a1: direct edge works
  const gd2 = {
    [at(5, 1)]: { type: 'c1' },
    [at(5, 2)]: { type: 'a1' }
  };
  const log2 = [];
  F.propagate(gd2, at(5, 1), runApi(log2));
  check('condition fires adjacent action', log2.join(',') === 'exec:' + at(5, 2), log2.join(','));
})();

// ---- cycle guard ----
(function () {
  const log = [];
  // a1 -> a2 -> a1 (via adjacency both ways): each runs once, no hang
  const gd = {
    [at(5, 1)]: { type: 'c1' },
    [at(5, 2)]: { type: 'a1' },
    [at(5, 3)]: { type: 'a2' }
  };
  // make a2 adjacent back to a1 (it is, via left) and a1 adjacent to c1;
  // c1 is visited already so flow cannot re-enter it.
  F.propagate(gd, at(5, 1), runApi(log));
  const counts = {};
  log.forEach(x => { counts[x] = (counts[x] || 0) + 1; });
  const once = Object.values(counts).every(n => n === 1);
  check('cycle guard: each block runs at most once', once, log.join(','));
  // explicit loop: a2's downstream includes a1 which is already visited
  const log3 = [];
  const gdLoop = {
    [at(6, 1)]: { type: 'c1' },
    [at(6, 2)]: { type: 'a1' },
    [at(7, 2)]: { type: 'a2' }
  };
  F.propagate(gdLoop, at(6, 1), runApi(log3));
  check('vertical action is independent (no auto-chain)',
    log3.length === 1 && log3[0] === 'exec:' + at(6, 2), log3.join(','));
})();

// ---- trigger modes ----
(function () {
  const st = {};
  const edge = { type: 'c1' };
  check('edge: first true fires', F.shouldTrigger(st, 'k', true, edge) === true);
  check('edge: staying true does not refire', F.shouldTrigger(st, 'k', true, edge) === false);
  check('edge: false resets', F.shouldTrigger(st, 'k', false, edge) === false);
  check('edge: true after false fires again', F.shouldTrigger(st, 'k', true, edge) === true);
  const st2 = {};
  const level = { type: 'c1', triggerMode: 'level' };
  check('level: fires every true frame',
    F.shouldTrigger(st2, 'k', true, level) && F.shouldTrigger(st2, 'k', true, level));
  const st3 = {};
  check('always defaults to level', F.shouldTrigger(st3, 'k', true, { type: 'always' }) &&
    F.shouldTrigger(st3, 'k', true, { type: 'always' }));
  const st4 = {};
  check('keyPressed defaults to level (held-key movement)',
    F.shouldTrigger(st4, 'k', true, { type: 'keyPressed' }) &&
    F.shouldTrigger(st4, 'k', true, { type: 'keyPressed' }));
  check('defaultTriggerMode', F.defaultTriggerMode('always') === 'level' &&
    F.defaultTriggerMode('keyPressed') === 'level' && F.defaultTriggerMode('c1') === 'edge' &&
    F.defaultTriggerMode({ type: 'actionInput', inputCondition: 'actionHeld' }) === 'level' &&
    F.defaultTriggerMode({ type: 'actionInput', inputCondition: 'actionJustPressed' }) === 'edge' &&
    F.defaultTriggerMode('getVariable') === 'level' && F.defaultTriggerMode('and') === 'level' &&
    F.defaultTriggerMode('cameraPosition') === 'level' &&
    F.defaultTriggerMode('arrayLength') === 'level' &&
    F.defaultTriggerMode('arrayContains') === 'level' &&
    F.defaultTriggerMode('structHasField') === 'level' &&
    // P4 item 37 batch 7 (raw input blocks): input-state reads default to
    // level; the raw gamepad button mirrors actionInput.
    F.defaultTriggerMode('cursorPosition') === 'level' &&
    F.defaultTriggerMode('anyKeyPressed') === 'level' &&
    F.defaultTriggerMode('touchActive') === 'level' &&
    F.defaultTriggerMode('touchCount') === 'level' &&
    F.defaultTriggerMode('gamepadConnected') === 'level' &&
    F.defaultTriggerMode('gamepadStick') === 'level' &&
    F.defaultTriggerMode({ type: 'gamepadButton', when: 'held' }) === 'level' &&
    F.defaultTriggerMode({ type: 'gamepadButton', when: 'justPressed' }) === 'edge' &&
    F.defaultTriggerMode({ type: 'gamepadButton', when: 'released' }) === 'edge' &&
    // P4 item 37 batch 8 (physics queries): spatial-state reads default to
    // level, like the other state reads.
    F.defaultTriggerMode('angleBetween') === 'level' &&
    F.defaultTriggerMode('lineOfSight') === 'level' &&
    F.defaultTriggerMode('nearestDistance') === 'level' &&
    F.defaultTriggerMode('movingTowards') === 'level' &&
    // P4 item 37 batch 9 (timers): timer-elapsed state read defaults to
    // level; onTimer stays edge (fires once per tick).
    F.defaultTriggerMode('timerElapsed') === 'level' &&
    F.defaultTriggerMode('onTimer') === 'edge' &&
    // P4 item 37 batch 10 (math/random): numeric range state read defaults
    // to level, like the other variable-state reads.
    F.defaultTriggerMode('numberInRange') === 'level' &&
    // P4 item 37 batch 11 (object picking): nearest/farthest are spatial
    // state reads (level — the pick can change as objects move); pickRandom
    // stays edge on purpose (fires once per appearance).
    F.defaultTriggerMode('pickNearest') === 'level' &&
    F.defaultTriggerMode('pickFarthest') === 'level' &&
    F.defaultTriggerMode('pickRandom') === 'edge' &&
    // P4 Advanced batch 35 (pick objects by tag): the tag picks
    // follow the name picks — nearest/farthest are spatial state
    // reads (level), the random tag pick stays edge on purpose.
    F.defaultTriggerMode('pickNearestTagged') === 'level' &&
    F.defaultTriggerMode('pickFarthestTagged') === 'level' &&
    F.defaultTriggerMode('pickRandomTagged') === 'edge' &&
    // P4 item 37 batch 12 (layers and effects): draw-layer state read
    // defaults to level, like the other state reads.
    F.defaultTriggerMode('layerCheck') === 'level' &&
    // P4 item 3D1 (3D rendering foundation): 3D-distance state read
    // defaults to level, like distanceCheck's cousins.
    F.defaultTriggerMode('distance3d') === 'level' &&
    // P4 item 3D3 (character controllers): pointer-lock state read
    // defaults to level, like cursorPosition.
    F.defaultTriggerMode('mousePointerCaptured') === 'level' &&
    // P4 item 3D4 (3D physics): ground + touch state reads default to
    // level, like onFloor's/collision's cousins.
    F.defaultTriggerMode('onGround3d') === 'level' &&
    F.defaultTriggerMode('collision3d') === 'level' &&
    // P4 Advanced (animation state machines): a state read, like
    // getVariable — true every frame while the state holds.
    F.defaultTriggerMode('animStateIs') === 'level' &&
    // P4 Advanced (blend spaces): a blend read, like animStateIs — true
    // every frame while the blend space is active.
    F.defaultTriggerMode('blendActive') === 'level' &&
    // P4 Advanced (2D lighting): a darkness read, like getVariable —
    // true every frame while the darkness holds.
    F.defaultTriggerMode('darknessLevel') === 'level' &&
    // P4 Advanced (physics joints): a joint read, like getVariable —
    // true every frame while the joint links the objects.
    F.defaultTriggerMode('jointConnected') === 'level' &&
    // P4 Advanced (skeletal animation): an animation read, like
    // blendActive — true every frame while the animation plays.
    F.defaultTriggerMode('skeletonPlaying') === 'level' &&
    // P4 Advanced (localization): a language read, like getVariable —
    // true every frame while the current language matches.
    F.defaultTriggerMode('languageIs') === 'level' &&
    // P4 Advanced batch 7 (dialogue): dialogue-state reads, like
    // languageIs — true every frame while the dialogue is in that
    // state; the typewriter keeps revealing while paused.
    F.defaultTriggerMode('dialogueActive') === 'level' &&
    F.defaultTriggerMode('dialogueWaitingChoice') === 'level' &&
    F.defaultTriggerMode('dialogueChoiceAvailable') === 'level' &&
    // P4 Advanced batch 8 (inventory): backpack reads, like
    // languageIs — true every frame while the count holds.
    F.defaultTriggerMode('hasItem') === 'level' &&
    F.defaultTriggerMode('itemCount') === 'level' &&
    // P4 Advanced batch 9 (quests): quest reads, like
    // hasItem — true every frame while the progress holds.
    F.defaultTriggerMode('questComplete') === 'level' &&
    F.defaultTriggerMode('questProgress') === 'level' &&
    // P4 Advanced batch 10 (achievements): unlocked-set reads, like
    // questComplete — true every frame while the achievement holds.
    F.defaultTriggerMode('achievementUnlocked') === 'level' &&
    F.defaultTriggerMode('achievementCount') === 'level' &&
    // P4 Advanced batch 11 (cutscenes): Cutscene Playing is a state
    // read, like achievementUnlocked — true every frame while a
    // cutscene runs. Cutscene Finished stays edge: it fires once,
    // exactly when the cutscene ends.
    F.defaultTriggerMode('cutscenePlaying') === 'level' &&
    F.defaultTriggerMode('cutsceneFinished') === 'edge' &&
    // P4 Advanced batch 12 (high scores): ranked-table reads, like
    // achievementCount — true every frame while the score would make
    // the table, or while the count holds.
    F.defaultTriggerMode('isHighScore') === 'level' &&
    F.defaultTriggerMode('highScoreCount') === 'level' &&
    // P4 Advanced batch 13 (time scale): a scale read, like
    // languageIs — true every frame while the scale compares.
    F.defaultTriggerMode('timeScale') === 'level' &&
    // P4 Advanced batch 14 (scene transitions): a transition read,
    // like cutscenePlaying — true every frame while a transition
    // runs. Transition Finished stays edge: it fires once, exactly
    // when the transition ends.
    F.defaultTriggerMode('transitionPlaying') === 'level' &&
    F.defaultTriggerMode('transitionFinished') === 'edge' &&
    // P4 Advanced batch 15 (camera feel): a following read, like
    // transitionPlaying — true every frame while the camera follows.
    F.defaultTriggerMode('cameraFollowing') === 'level' &&
    // P4 Advanced batch 16 (parallax backgrounds): a factor read,
    // like cameraFollowing — true every frame while the factor
    // matches.
    F.defaultTriggerMode('parallaxFactor') === 'level' &&
    // P4 Advanced batch 18 (pathfinding): path-state reads, like
    // parallaxFactor — true every frame while the path is walking
    // (Has Path) or has arrived (Path Finished).
    F.defaultTriggerMode('pathFinished') === 'level' &&
    F.defaultTriggerMode('hasPath') === 'level' &&
    // P4 Advanced batch 19 (AI behaviors): behavior and range reads,
    // like pathFinished — true every frame while the object runs that
    // behavior, or while the target stays in range.
    F.defaultTriggerMode('aiBehavior') === 'level' &&
    F.defaultTriggerMode('targetInRange') === 'level' &&
    // P4 Advanced batch 20 (virtual joystick): stick reads, like
    // aiBehavior — true every frame while the player steers, or
    // while the stick tilts the picked way.
    F.defaultTriggerMode('joystickActive') === 'level' &&
    F.defaultTriggerMode('joystickTilt') === 'level' &&
    // P4 Advanced batch 21 (health & damage): a hit-point read, like
    // getVariable — true every frame while the health compares.
    // Object Died stays edge: it fires once, exactly when the health
    // reaches 0.
    F.defaultTriggerMode('healthCheck') === 'level' &&
    F.defaultTriggerMode('objectDied') === 'edge' &&
    // P4 Advanced batch 22 (damage feedback): a shield read, like
    // healthCheck — true every frame while the shield holds.
    F.defaultTriggerMode('isInvincible') === 'level' &&
    // P4 Advanced batch 23 (checkpoints & respawn): run-state reads,
    // like healthCheck — true every frame while a checkpoint is set,
    // or while the respawn count compares.
    F.defaultTriggerMode('checkpointSet') === 'level' &&
    F.defaultTriggerMode('respawnCount') === 'level' &&
    // P4 Advanced batch 24 (enemy spawner): run-state reads, like
    // healthCheck — true every frame while a spawner runs, or while
    // the spawned count compares.
    F.defaultTriggerMode('spawnerActive') === 'level' &&
    F.defaultTriggerMode('spawnedCount') === 'level' &&
    // P4 Advanced batch 25 (lives & game over): a lives read, like
    // checkpointSet — true every frame while the count compares.
    // Game Over stays edge: it fires once, exactly when the last
    // life is lost.
    F.defaultTriggerMode('lives') === 'level' &&
    F.defaultTriggerMode('gameOver') === 'edge' &&
    // P4 Advanced batch 30 (experience & leveling): XP and level
    // reads, like lives — true every frame while the total or the
    // derived level compares. Level Up stays edge: it fires once,
    // exactly when the level rises.
    F.defaultTriggerMode('xp') === 'level' &&
    F.defaultTriggerMode('level') === 'level' &&
    F.defaultTriggerMode('levelUp') === 'edge' &&
    // P4 Advanced batch 32 (enemy scaling with the hero's level):
    // an enemy-level read, like level — true every frame while the
    // enemy's level compares.
    F.defaultTriggerMode('enemyLevel') === 'level' &&
    // P4 Advanced batch 33 (boss encounters): both boss reads are
    // true every frame while they hold — the phase compares, the
    // fight runs.
    F.defaultTriggerMode('bossPhase') === 'level' &&
    F.defaultTriggerMode('bossActive') === 'level' &&
    // P4 Advanced batch 34 (object tags): both tag reads are true
    // every frame while they hold — the object carries the tag, the
    // live count compares.
    F.defaultTriggerMode('hasTag') === 'level' &&
    F.defaultTriggerMode('taggedCount') === 'level' &&
    // P4 Advanced batch 36 (minimap): the map visibility read is
    // true every frame while the map shows.
    F.defaultTriggerMode('minimapVisible') === 'level' &&
    // P4 Advanced batch 37 (object parenting): an attach read is
    // true every frame while the object is attached.
    F.defaultTriggerMode('isAttached') === 'level' &&
    // P5 core-engine track, item P5-1 (Variables v2, slice a):
    // scoped-variable reads, like level — true every frame while
    // the variable exists or compares.
    F.defaultTriggerMode('scopedVariableExists') === 'level' &&
    F.defaultTriggerMode('scopedVariableCheck') === 'level' &&
    // P4 Advanced batch 26 (movement): both reads are true every
    // frame while they hold — jumps left while the player can still
    // jump, dashing while the burst runs.
    F.defaultTriggerMode('jumpsLeft') === 'level' &&
    F.defaultTriggerMode('isDashing') === 'level' &&
    // P4 Advanced batch 28 (wall slide): the slide read is true
    // every frame while the object slides down a wall.
    F.defaultTriggerMode('wallSliding') === 'level' &&
    // P4 Advanced batch 29 (combat): the cooldown read is true every
    // frame while the object's picked attack has cooled down.
    F.defaultTriggerMode('attackReady') === 'level' &&
    // P4 Advanced batch 27 (platforms): both reads are true every
    // frame while they hold — standing on a moving platform, standing
    // on a one-way floor.
    F.defaultTriggerMode('standingOnPlatform') === 'level' &&
    F.defaultTriggerMode('standingOnOneWay') === 'level');
  check('explicit mode wins', F.triggerModeOf({ type: 'always', triggerMode: 'edge' }) === 'edge');
})();

// ---- factorySource for export inlining ----
check('factorySource is a non-empty string',
  typeof sandbox.HydraFlow.factorySource === 'string' &&
  sandbox.HydraFlow.factorySource.length > 500);

console.log(failures === 0 ? 'flow.test.js: all checks passed' : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
