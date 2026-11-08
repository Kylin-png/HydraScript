/* HydraFlow — shared execution-flow engine for logic grids.
 *
 * The puzzle-piece visual (tabs = outputs on the right, sockets = inputs on the
 * left) is a promise: when a block fires, execution FLOWS through the
 * connections. This module implements that promise once, and both runtimes
 * (the editor preview in script.js and the export player in player-runtime.js)
 * call it identically, so a game behaves the same in preview and exported.
 *
 * Concepts (Ky'lin-approved, Nov 4 2026):
 * - Chaining:        A -> B -> C runs in order; actions can feed actions.
 * - Fan-out:         one output feeding many inputs runs all of them.
 * - Fan-in:          many outputs into one input is OR; AND is explicit.
 * - Sub-conditions:  a condition fed by another condition is a gate: it is
 *                    evaluated only when its upstream fires, and flow continues
 *                    only if it is true.
 * - Cycle guard:     each block runs at most once per propagation; a visited
 *                    set stops re-entry, so feedback loops can never hang.
 * - Loop blocks:     a Repeat / While block (api.isLoopBlock) runs its body
 *                    chain itself through api.executeLoop and is never
 *                    queued. When the loop reports it ran its body, its
 *                    body actions are pulled out of the queue first,
 *                    since the trigger's rightward scan grabs the whole
 *                    row — a skipped loop (too deep to nest) reports
 *                    false and its body runs once through the normal
 *                    flow instead. A Break / Continue inside a body
 *                    sets the host's control flag, and api.shouldAbort
 *                    stops that body propagation at once.
 * - Trigger modes:   'edge'  = fire once on false->true transition (default,
 *                    except 'always'); 'level' = fire every frame while true.
 *
 * A connection (edge) from block A to block B exists when:
 *   1. A and B share a non-empty eventId (wireless link), or
 *   2. B is orthogonally adjacent to A, or
 *   3. B is part of the rightward same-row run: skipping leading empty cells,
 *      the contiguous run of actions to the right of A on its row (comments
 *      are transparent; the run stops at the first condition, empty cell, or
 *      row end). This is the legacy "row scan" rule, kept so existing
 *      projects behave exactly as before.
 * If A has an eventId, ONLY rule 1 applies (preserves legacy behavior where an
 * eventId scopes a condition to its linked blocks). Comments are never edges.
 *
 * Pure module: no DOM, no I/O. The host supplies type checks and callbacks.
 * Follows the hydra-*.js factorySource pattern for export inlining.
 */
function hydraFlowFactory() {
  'use strict';

  var GRID_W = 60;

  function rowOf(idx) { return Math.floor(idx / GRID_W); }
  function colOf(idx) { return idx % GRID_W; }

  function adjacentIndexes(index) {
    var row = rowOf(index), col = colOf(index);
    var out = [];
    // Reading-order bias: right, down, left, up. Deterministic fan-out order.
    // The grid is 60 columns wide but has NO row limit, so the
    // down-neighbour is always linked (a missing cell just holds no
    // block). Capping it at row 60 cut the link for every row past 60 —
    // the row-60 bug: a logic grid taller than 60 rows (Neon Arena's
    // arena grid is ~244 rows) lost every down-link past that line, so
    // an `and` at row 60+ saw zero neighbours and never passed. This
    // is the ONE definition of flow adjacency: the preview runtime,
    // the export runtime, and the diagnostics view all resolve through
    // here (directly or through the hosts' adjacentIndexes hook), and
    // the editor's HydraGridModel keeps its own bounded 60x60 copy
    // for the visible grid only.
    if (col + 1 < GRID_W) out.push(index + 1);
    out.push(index + GRID_W);
    if (col - 1 >= 0) out.push(index - 1);
    if (row - 1 >= 0) out.push(index - GRID_W);
    return out;
  }

  function isUsable(data, api) {
    // Flow edges target ACTIONS only. Conditions are independent event sources
    // evaluated by the host's main loop; they are never implicitly gated by
    // adjacency (preserves legacy behavior where adjacent conditions are
    // independent). Chaining (action->action) and fan-out work through this.
    return !!data && api.isAction(data.type);
  }

  // Downstream edges from block `index`, in deterministic execution order.
  //
  // Direction follows the puzzle visual (sockets left = inputs, tabs right =
  // outputs): flow moves LEFT-to-RIGHT.
  // - From a CONDITION: all orthogonally adjacent actions (legacy behavior:
  //   an action below/above/left of its condition still fires) plus the
  //   rightward same-row scan.
  // - From an ACTION (chaining): ONLY the rightward same-row scan. Vertical
  //   chaining is deliberately excluded: an action placed under another
  //   action is usually meant for a different condition below, and automatic
  //   vertical flow would trigger unintended blocks (e.g. a destroy action
  //   firing a setVariable meant for the collision condition beneath it).
  // - eventId (either kind): only the linked actions (legacy scoping).
  function flowEdges(gridData, index, api) {
    var data = gridData[index];
    if (!data) return [];
    var out = [];
    var seen = {};
    function add(idx) {
      if (idx === index || seen[idx]) return;
      var d = gridData[idx];
      if (!isUsable(d, api)) return;
      seen[idx] = true;
      out.push(idx);
    }
    // Rule 1: eventId link scopes the block to its linked peers.
    if (data.eventId) {
      Object.keys(gridData).forEach(function (k) {
        var idx = Number(k);
        var d = gridData[idx];
        if (d && d.eventId === data.eventId) add(idx);
      });
      out.sort(function (a, b) { return a - b; });
      return out;
    }
    var isCond = api.isCondition(data.type);
    // Rule 2: orthogonal adjacency — but ONLY for conditions (legacy: an
    // action in any direction from its condition fires). Actions do not
    // chain vertically (see above).
    if (isCond) adjacentIndexes(index).forEach(add);
    // Rule 3: rightward same-row scan (legacy for conditions; the chaining
    // rule for actions): actions to the right, skipping empty cells and
    // comments, stopping at any other block.
    var row = rowOf(index), col = colOf(index);
    var started = false;
    for (var c = col + 1; c < GRID_W; c++) {
      var sIdx = row * GRID_W + c;
      var sData = gridData[sIdx];
      if (!sData) { if (started) break; continue; }
      if (api.isAction(sData.type)) { add(sIdx); started = true; continue; }
      if (sData.type === 'comment') continue;
      break;
    }
    return out;
  }

  // Default trigger mode for a condition.
  // Level-triggered (fire every frame while true): state-like conditions.
  //   'always', 'keyPressed', 'actionInput' with 'actionHeld',
  //   'gamepadButton' with 'held', 'getVariable' (variable state),
  //   'cameraPosition'/'cursorPosition'/touch/gamepad-state reads,
  //   'and'/'or' (logic combinators).
  // Edge-triggered (fire once on false->true): event-like conditions
  //   (collision, clicks, timers) so they don't spam actions.
  function defaultTriggerMode(data) {
    var t = typeof data === 'string' ? data : data && data.type;
    if (t === 'always' || t === 'keyPressed' || t === 'getVariable' ||
        t === 'cameraPosition' ||
        // P4 item 37 batch 6 (collections): variable-state reads, like
        // getVariable — true every frame while the state holds.
        t === 'arrayLength' || t === 'arrayContains' || t === 'structHasField' ||
        // P4 item 37 batch 7 (raw input blocks): input-state reads, like
        // keyPressed — true every frame while the state holds.
        t === 'cursorPosition' || t === 'anyKeyPressed' || t === 'touchActive' ||
        t === 'touchCount' || t === 'gamepadConnected' || t === 'gamepadStick' ||
        // P4 item 3D3 (character controllers): pointer-lock state read,
        // like cursorPosition — true every frame while the lock holds.
        t === 'mousePointerCaptured' ||
        // P4 item 37 batch 8 (physics queries): spatial-state reads, like
        // distanceCheck's cousins — true every frame while the state holds.
        t === 'angleBetween' || t === 'lineOfSight' || t === 'nearestDistance' ||
        t === 'movingTowards' ||
        // P4 item 37 batch 9 (timers): timer-elapsed state read, like
        // getVariable — true every frame while the state holds. (onTimer
        // stays edge: it fires once per tick.)
        t === 'timerElapsed' ||
        // P4 item 37 batch 10 (math/random): numeric range state read,
        // like getVariable — true every frame while the value is in range.
        t === 'numberInRange' ||
        // P4 item 37 batch 11 (object picking and selection): spatial state
        // reads — the pick can change as objects move, so nearest/farthest
        // re-evaluate every frame like distanceCheck's cousins. pickRandom
        // stays edge on purpose (fires once per appearance; flip it to
        // level for a fresh random pick every frame).
        t === 'pickNearest' || t === 'pickFarthest' ||
        // P4 Advanced batch 35 (pick objects by tag): the tag picks
        // are spatial state reads the same way — nearest/farthest
        // re-evaluate every frame as tagged objects move; the
        // random tag pick stays edge on purpose, like pickRandom.
        t === 'pickNearestTagged' || t === 'pickFarthestTagged' ||
        // P4 item 37 batch 12 (layers and effects): draw-layer state read,
        // like getVariable — true every frame while the layer holds.
        t === 'layerCheck' ||
        // P4 item 3D1 (3D rendering foundation): 3D-distance state read,
        // like distanceCheck's cousins — true every frame while the
        // distance holds. Evaluates while paused (positions are frozen).
        t === 'distance3d' ||
        // P4 item 3D4 (3D physics): ground + touch state reads, like
        // onFloor's/collision's cousins — true every frame while the
        // state holds. World-dependent: they report the paused freeze
        // instead of stale state.
        t === 'onGround3d' || t === 'collision3d' ||
        // P4 Advanced (animation state machines): a state read, like
        // getVariable — true every frame while the state holds. Evaluates
        // while paused (the state is frozen).
        t === 'animStateIs' ||
        // P4 Advanced (blend spaces): a blend read, like animStateIs —
        // true every frame while the blend space is active. Evaluates
        // while paused (the blend is frozen).
        t === 'blendActive' ||
        // P4 Advanced (2D lighting): a darkness read, like getVariable —
        // true every frame while the darkness holds. Evaluates while
        // paused (the scene darkness is frozen).
        t === 'darknessLevel' ||
        // P4 Advanced (physics joints): a joint read, like getVariable —
        // true every frame while the joint links the objects. Evaluates
        // while paused (joints and positions are frozen).
        t === 'jointConnected' ||
        // P4 Advanced (skeletal animation): an animation read, like
        // blendActive — true every frame while the skeletal animation
        // plays. Evaluates while paused (the pose is frozen).
        t === 'skeletonPlaying' ||
        // P4 Advanced (localization): a language read, like getVariable —
        // true every frame while the current language matches. Evaluates
        // while paused (the language is frozen).
        t === 'languageIs' ||
        // P4 Advanced batch 7 (dialogue): dialogue-state reads, like
        // languageIs — true every frame while the dialogue is in that
        // state. Evaluates while paused (dialogue is UI, the world is
        // frozen, and the typewriter keeps revealing).
        t === 'dialogueActive' || t === 'dialogueWaitingChoice' ||
        t === 'dialogueChoiceAvailable' ||
        // P4 Advanced batch 8 (inventory): backpack reads, like
        // languageIs — true every frame while the count holds.
        // Evaluates while paused (the backpack is frozen with the
        // world, and counts are plain state, not physics).
        t === 'hasItem' || t === 'itemCount' ||
        // P4 Advanced batch 9 (quests): quest-log reads, like
        // languageIs — true every frame while the quest is in that
        // state. Evaluates while paused (the log is frozen with the
        // world, and progress is plain state, not physics).
        t === 'questComplete' || t === 'questProgress' ||
        // P4 Advanced batch 10 (achievements): unlocked-set reads,
        // like questComplete — true every frame while the achievement
        // is in that state. Evaluates while paused (the set is plain
        // state, not physics, and it never resets on a fresh run).
        t === 'achievementUnlocked' || t === 'achievementCount' ||
        // P4 Advanced batch 11 (cutscenes): cutscene-state reads, like
        // achievementUnlocked — Cutscene Playing is true every frame
        // while a cutscene runs. Evaluates while paused (the runtime
        // is plain state, and the update freezes with the world).
        // Cutscene Finished stays edge: it fires once, exactly when
        // the cutscene ends.
        t === 'cutscenePlaying' ||
        // P4 Advanced batch 12 (high scores): ranked-table reads, like
        // achievementCount — true every frame while the score would
        // make the table, or while the count holds. Evaluates while
        // paused (the table is plain state, not physics, and it never
        // resets on a fresh run).
        t === 'isHighScore' || t === 'highScoreCount' ||
        // P4 Advanced batch 13 (time scale): a scale read, like
        // languageIs — true every frame while the scale compares.
        // Evaluates while paused (the scale is plain run state, and
        // scripts can still change it while the world is frozen).
        t === 'timeScale' ||
        // P4 Advanced batch 14 (scene transitions): a transition
        // read, like cutscenePlaying — true every frame while a
        // transition runs. Evaluates while paused (the runtime is
        // plain state, and the update freezes with the world).
        // Transition Finished stays edge: it fires once, exactly
        // when the transition ends.
        // P4 Advanced batch 15 (camera feel): a follow read, like
        // timeScale — true every frame while the camera follows.
        // Evaluates while paused (the follow target is plain run
        // state, and scripts can still change it while the world is
        // frozen).
        t === 'cameraFollowing' ||
        // P4 Advanced batch 16 (parallax backgrounds): a factor read,
        // like cameraFollowing — true every frame while the factor
        // matches. Evaluates while paused (the factor is plain object
        // state, and scripts can still change it while the world is
        // frozen).
        t === 'parallaxFactor' ||
        // P4 Advanced batch 18 (pathfinding): path-state reads, like
        // parallaxFactor — true every frame while the path is walking
        // (Has Path) or has arrived (Path Finished). Evaluates while
        // paused (the path record is plain object state, frozen with
        // the world).
        t === 'pathFinished' || t === 'hasPath' ||
        // P4 Advanced batch 19 (AI behaviors): behavior and range
        // reads, like pathFinished — true every frame while the object
        // runs that behavior, or while the target stays in range.
        // Evaluates while paused (the behavior record is plain object
        // state, frozen with the world).
        t === 'aiBehavior' || t === 'targetInRange' ||
        // P4 Advanced batch 20 (virtual joystick): stick reads, like
        // aiBehavior — true every frame while the player steers, or
        // while the stick tilts the picked way. Evaluates while paused
        // (the stick is input, like actionInput, and the runtime is
        // plain state).
        t === 'joystickActive' || t === 'joystickTilt' ||
        // P4 Advanced batch 21 (health & damage): a hit-point read,
        // like getVariable — true every frame while the health
        // compares. Evaluates while paused (health is plain object
        // state, frozen with the world). Object Died stays edge: it
        // fires once, exactly when the health reaches 0.
        t === 'healthCheck' ||
        // P4 Advanced batch 22 (damage feedback): a shield read, like
        // healthCheck — true every frame while the shield holds.
        // Evaluates while paused (the record is plain object state,
        // frozen with the world).
        t === 'isInvincible' ||
        // P4 Advanced batch 23 (checkpoints & respawn): run-state
        // reads, like healthCheck — true every frame while a
        // checkpoint is set, or while the respawn count compares.
        // Evaluates while paused (the state is plain run state,
        // frozen with the world).
        t === 'checkpointSet' || t === 'respawnCount' ||
        // P4 Advanced batch 24 (enemy spawner): run-state reads, like
        // checkpointSet — true every frame while a spawner runs, or
        // while its spawned total compares. Evaluates while paused
        // (the state is plain run state, frozen with the world).
        t === 'spawnerActive' || t === 'spawnedCount' ||
        // P4 Advanced batch 25 (lives & game over): a lives read, like
        // checkpointSet — true every frame while the count compares.
        // Evaluates while paused (the count is plain run state, frozen
        // with the world). Game Over stays edge: it fires once,
        // exactly when the last life is lost.
        t === 'lives' ||
        // P4 Advanced batch 30 (experience & leveling): XP and level
        // reads, like lives — true every frame while the total or
        // the derived level compares. Evaluates while paused (the
        // record is plain run state, frozen with the world). Level
        // Up stays edge: it fires once, exactly when the level
        // rises.
        t === 'xp' || t === 'level' ||
        // P4 Advanced batch 32 (enemy scaling with the hero's level):
        // an enemy-level read, like level — true every frame while
        // the enemy's level compares. Evaluates while paused (the
        // record is plain run state, frozen with the world).
        t === 'enemyLevel' ||
        // P4 Advanced batch 33 (boss encounters): boss reads, like
        // enemyLevel — true every frame while the fight runs, or
        // while its phase compares. Evaluates while paused (the
        // record is plain run state, frozen with the world).
        t === 'bossPhase' || t === 'bossActive' ||
        // P4 Advanced batch 34 (object tags): tag reads, like
        // bossPhase — true every frame while the object carries the
        // tag, or while the live count compares. Evaluates while
        // paused (tags are plain object fields, frozen with the
        // world).
        t === 'hasTag' || t === 'taggedCount' ||
        // P4 Advanced batch 36 (minimap): the map visibility read,
        // like bossActive — true every frame while the map shows.
        // Evaluates while paused (the record is plain run state,
        // frozen with the world).
        t === 'minimapVisible' ||
        // P4 Advanced batch 37 (object parenting): an attach read,
        // like hasTag — true every frame while the object is
        // attached. Evaluates while paused (the links are plain run
        // state, frozen with the world).
        t === 'isAttached' ||
        // P5 core-engine track, item P5-1 (Variables v2, slice a):
        // scoped-variable reads, like level — true every frame while
        // the variable exists or compares. Evaluates while paused
        // (the record is plain run state, frozen with the world).
        t === 'scopedVariableExists' || t === 'scopedVariableCheck' ||
        // P4 Advanced batch 26 (movement abilities): jump and dash
        // reads, like lives — true every frame while the jumps compare,
        // or while the object is mid-dash. Evaluates while paused (the
        // records are plain run state, frozen with the world).
        t === 'jumpsLeft' || t === 'isDashing' ||
        // P4 Advanced batch 28 (wall slide & wall jump): a slide
        // read, like isDashing — true every frame while the object
        // slides down a wall. Evaluates while paused (the check is
        // geometric run state, frozen with the world).
        t === 'wallSliding' ||
        // P4 Advanced batch 29 (combat): a cooldown read, like
        // isDashing — true every frame while the object's picked
        // attack has cooled down. Evaluates while paused (the record
        // is plain run state, frozen with the world).
        t === 'attackReady' ||
        // P4 Advanced batch 27 (moving platforms & one-way platforms):
        // standing reads, like lives — true every frame while the
        // object stands on the platform. Evaluates while paused (the
        // check is geometric run state, frozen with the world).
        t === 'standingOnPlatform' || t === 'standingOnOneWay' ||
        t === 'transitionPlaying' ||
        // P5 core-engine track, item P5-4 (Control flow + events,
        // slice c): custom events. On Event is level-triggered on
        // purpose, not edge: its poll is true for exactly one
        // evaluation per broadcast, so level fires once per
        // broadcast — including a broadcast every frame, where the
        // condition is true on consecutive frames for consecutive
        // broadcasts and edge would collapse them into one firing.
        t === 'onCustomEvent' ||
        t === 'and' || t === 'or') return 'level';
    if (t === 'actionInput') {
      var ic = typeof data === 'object' && data ? data.inputCondition : null;
      if (ic === 'actionHeld') return 'level';
    }
    // P4 item 37 batch 7: the raw gamepad button mirrors actionInput —
    // 'held' is a state read (level); just-pressed/released are events.
    if (t === 'gamepadButton') {
      var gb = typeof data === 'object' && data ? data.when : null;
      if (gb === 'held' || gb == null) return 'level';
    }
    return 'edge';
  }

  function triggerModeOf(data) {
    if (data && (data.triggerMode === 'edge' || data.triggerMode === 'level')) return data.triggerMode;
    return defaultTriggerMode(data);
  }

  // Propagate execution flow starting from a triggered condition.
  //
  // api = {
  //   isCondition(type), isAction(type),
  //   evaluateCondition(idx, data) -> truthy (for sub-condition gates),
  //   executeAction(idx, data),
  //   isLoopBlock(type)              // optional: Repeat / While blocks
  //   executeLoop(idx, data, runBody) // optional: runs a loop block's
  //                                  // body through runBody, which runs
  //                                  // the body chain once and returns
  //                                  // the executed indexes in order
  //   shouldAbort() -> truthy        // optional: a Break / Continue
  //                                  // inside a loop body stops this
  //                                  // propagation at once
  //   onVisit(idx, kind)            // optional: 'action' | 'condition-pass' | 'condition-stop'
  // }
  //
  // The start block itself is NOT executed/evaluated here; the caller already
  // determined it triggered. Returns the list of visited indexes in order.
  function propagate(gridData, startIndex, api) {
    var visited = {};
    var order = [];
    var queue = [startIndex];
    visited[startIndex] = true;

    // A Break / Continue inside a loop body asks this propagation to
    // stop at once — the loop handler reads the flag after the body
    // run and clears it, so the check only ever fires inside a body
    // run, never in the outer flow. A missing hook never aborts.
    function abortRequested() {
      try { return !!(api.shouldAbort && api.shouldAbort()); } catch (e) { return false; }
    }

    while (queue.length > 0) {
      if (abortRequested()) return order;
      var idx = queue.shift();
      var edges = flowEdges(gridData, idx, api);
      for (var i = 0; i < edges.length; i++) {
        if (abortRequested()) return order;
        var nIdx = edges[i];
        if (visited[nIdx]) continue;
        visited[nIdx] = true;
        var data = gridData[nIdx];
        if (!data) continue;
        if (api.isAction(data.type)) {
          order.push(nIdx);
          if (api.onVisit) { try { api.onVisit(nIdx, 'action'); } catch (e) {} }
          if (api.isLoopBlock && api.isLoopBlock(data.type) &&
              typeof api.executeLoop === 'function') {
            // P5-4 slice a (loops): a loop block runs its body chain
            // itself, so this propagation must not run it again — but
            // only when the loop actually took ownership of the body.
            // The trigger's rightward scan grabs the whole row — loop
            // block and body alike — so the body actions may already
            // be queued: when the loop reports it ran, pull them out
            // of the queue and mark them visited for this
            // propagation, so the outer flow never runs them once
            // more after the loop. A loop that was skipped (too deep
            // to nest) reports false, and its body runs once through
            // the normal flow instead. runBody runs the body once
            // through a fresh propagation, so nested loops and
            // chained actions work the same way they do outside a
            // loop, and the fresh visited set keeps the loop block
            // itself from re-entering. The loop block is NOT queued,
            // so the outer flow never continues into the body on its
            // own.
            var runBody = function () { return propagate(gridData, nIdx, api); };
            var loopRan = false;
            try { loopRan = !!api.executeLoop(nIdx, data, runBody); } catch (e) { loopRan = false; }
            if (loopRan) {
              var bodyEdges = flowEdges(gridData, nIdx, api);
              for (var bi = 0; bi < bodyEdges.length; bi++) {
                visited[bodyEdges[bi]] = true;
                var qi = queue.indexOf(bodyEdges[bi]);
                if (qi !== -1) queue.splice(qi, 1);
              }
            }
          } else {
            api.executeAction(nIdx, data);
            queue.push(nIdx);
          }
        } else if (api.isCondition(data.type)) {
          var pass = false;
          try { pass = !!api.evaluateCondition(nIdx, data); } catch (e) { pass = false; }
          if (api.onVisit) { try { api.onVisit(nIdx, pass ? 'condition-pass' : 'condition-stop'); } catch (e) {} }
          if (pass) {
            order.push(nIdx);
            queue.push(nIdx);
          }
        }
      }
    }
    return order;
  }

  // Should a condition that is currently true initiate flow this frame?
  // state: host-owned map; key: host-chosen (e.g. scope + ':' + index).
  function shouldTrigger(prevStates, key, currentlyTrue, data) {
    var mode = triggerModeOf(data);
    var was = prevStates[key] === true;
    prevStates[key] = !!currentlyTrue;
    if (!currentlyTrue) return false;
    if (mode === 'level') return true;
    return !was;
  }

  return {
    GRID_W: GRID_W,
    adjacentIndexes: adjacentIndexes,
    flowEdges: flowEdges,
    defaultTriggerMode: defaultTriggerMode,
    triggerModeOf: triggerModeOf,
    propagate: propagate,
    shouldTrigger: shouldTrigger
  };
}

if (typeof window !== 'undefined') {
  window.HydraFlow = hydraFlowFactory();
  // Self-contained source of the factory, inlined into exported playable games
  // by buildPlayableHtml (player-runtime.js). Kept as a string, never eval'd here.
  window.HydraFlow.factorySource = hydraFlowFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraFlowFactory;
