(function installHydraPlayer(global) {
  'use strict';

  // Shared expression evaluator (hydra-expr.js). Single canonical source for
  // expression logic; buildPlayableHtml inlines it into exported games so
  // exports never depend on editor files.
  var HydraExpr = global.HydraExpr;
  if (!HydraExpr || typeof HydraExpr.evaluate !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-expr.js (window.HydraExpr) to be loaded first.');
  }
  var HydraInput = global.HydraInput;
  if (!HydraInput || typeof HydraInput.mouseButtonCode !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-input.js (window.HydraInput) to be loaded first.');
  }
  var HydraAudio = global.HydraAudio;
  if (!HydraAudio || typeof HydraAudio.resolveSoundSource !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-audio.js (window.HydraAudio) to be loaded first.');
  }
  // Shared audio-bus logic (hydra-buses.js): Music/SFX/UI buses with
  // per-bus volume/mute and polyphony limits. buildPlayableHtml inlines it
  // into exported games so exports never depend on editor files.
  var HydraAudioBuses = global.HydraAudioBuses;
  if (!HydraAudioBuses || typeof HydraAudioBuses.normalizeBuses !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-buses.js (window.HydraAudioBuses) to be loaded first.');
  }
  // Shared sprite-animation playback (hydra-anim.js). Single canonical source
  // for animation logic; buildPlayableHtml inlines it into exported games so
  // exports never depend on editor files.
  var HydraAnim = global.HydraAnim;
  if (!HydraAnim || typeof HydraAnim.play !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-anim.js (window.HydraAnim) to be loaded first.');
  }
  // Shared tween playback (hydra-tween.js). Single canonical source for
  // tween logic; buildPlayableHtml inlines it into exported games so
  // exports never depend on editor files.
  var HydraTween = global.HydraTween;
  if (!HydraTween || typeof HydraTween.start !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-tween.js (window.HydraTween) to be loaded first.');
  }
  // Shared UI-widget layout (hydra-ui.js). Single canonical source for
  // anchor resolution, HUD-layer checks, and button visuals; buildPlayableHtml
  // inlines it into exported games so exports never depend on editor files.
  var HydraUi = global.HydraUi;
  if (!HydraUi || typeof HydraUi.resolveWidgetPosition !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-ui.js (window.HydraUi) to be loaded first.');
  }
  // Shared save-slot storage (hydra-save.js). Single canonical source for
  // versioned named save slots; buildPlayableHtml inlines it into exported
  // games so exports never depend on editor files.
  var HydraSave = global.HydraSave;
  if (!HydraSave || typeof HydraSave.writeSlot !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-save.js (window.HydraSave) to be loaded first.');
  }
  // Shared pause/resume state (hydra-pause.js). Single canonical source for
  // the engine pause flag and the frozen game clock; buildPlayableHtml
  // inlines it into exported games so exports never depend on editor files.
  var HydraPause = global.HydraPause;
  if (!HydraPause || typeof HydraPause.isPaused !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-pause.js (window.HydraPause) to be loaded first.');
  }
  // Shared camera effects (hydra-camerafx.js): screen shake + screen flash
  // state, triggers, decay, and draw-time alpha/offset. Single canonical
  // source for both runtimes; buildPlayableHtml inlines it into exported
  // games so exports never depend on editor files.
  var HydraCameraFx = global.HydraCameraFx;
  if (!HydraCameraFx || typeof HydraCameraFx.triggerFlash !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-camerafx.js (window.HydraCameraFx) to be loaded first.');
  }
  // Shared scene-load object init (hydra-sceneinit.js): the fresh runtime
  // state every object gets at scene load and on spawn (velocities, anim /
  // state-machine / blend / skeleton runtimes, play-at-start autoplay,
  // initial-state entry, fresh tweens) plus the localization bound-text
  // pass. Single canonical source for both runtimes; buildPlayableHtml
  // inlines it into exported games so exports never depend on editor files.
  var HydraSceneInit = global.HydraSceneInit;
  if (!HydraSceneInit || typeof HydraSceneInit.initSceneObjects !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-sceneinit.js (window.HydraSceneInit) to be loaded first.');
  }
  // Shared per-frame update order (hydra-frame.js): the canonical phase
  // sequence (world sim, input, scripts, destroy/scene application, draw,
  // edge clearing) both runtimes step through; buildPlayableHtml inlines
  // it into exported games so exports never depend on editor files.
  var HydraFrame = global.HydraFrame;
  if (!HydraFrame || typeof HydraFrame.stepFrame !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-frame.js (window.HydraFrame) to be loaded first.');
  }
  // Shared per-frame 2D physics step (hydra-physicsstep.js): velocity
  // integration, object-vs-object collision resolution, and tilemap
  // collision. Single canonical source for both runtimes; buildPlayableHtml
  // inlines it into exported games so exports never depend on editor files.
  var HydraPhysicsStep = global.HydraPhysicsStep;
  if (!HydraPhysicsStep || typeof HydraPhysicsStep.stepPhysics2d !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-physicsstep.js (window.HydraPhysicsStep) to be loaded first.');
  }
  // Shared scene-load runtime state reset (hydra-scenereset.js): the
  // fresh run state every scene load starts from (camera, 3D camera,
  // pause, particles, per-scene collections, condition contexts, trigger
  // edge state). Single canonical source for both runtimes;
  // buildPlayableHtml inlines it into exported games so exports never
  // depend on editor files.
  var HydraSceneReset = global.HydraSceneReset;
  if (!HydraSceneReset || typeof HydraSceneReset.resetSceneRuntime !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-scenereset.js (window.HydraSceneReset) to be loaded first.');
  }
  // Shared draw passes (hydra-draw.js): the full frame composition —
  // background, 3D pass, world objects, particles, darkness overlay,
  // HUD pass, screen flash, profiler overlay — plus the per-kind draws.
  // Single canonical source for both runtimes; buildPlayableHtml
  // inlines it into exported games so exports never depend on editor
  // files.
  var HydraDraw = global.HydraDraw;
  if (!HydraDraw || typeof HydraDraw.drawFrame !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-draw.js (window.HydraDraw) to be loaded first.');
  }
  // Shared script-grid dispatch (hydra-dispatch.js): the two-pass
  // traversal, trigger-mode gating, trace recording, unknown-block
  // reporting, and started-scope bookkeeping that drives the
  // per-block condition/action switches below. Single canonical source
  // for both runtimes; buildPlayableHtml inlines it into exported
  // games so exports never depend on editor files.
  var HydraDispatch = global.HydraDispatch;
  if (!HydraDispatch || typeof HydraDispatch.processScope !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-dispatch.js (window.HydraDispatch) to be loaded first.');
  }
  // Shared execution flow (hydra-flow.js): the ONE flow module —
  // adjacentIndexes, flowEdges, trigger modes, propagate. Both
  // runtimes resolve flow adjacency through here, so a fix lands
  // everywhere at once (P5-7: the row-60 fix — grids run taller than
  // 60 rows — used to live only in a game-arena copy while the export
  // kept its own capped duplicate). buildPlayableHtml inlines it into
  // exported games so exports never depend on editor files.
  var HydraFlow = global.HydraFlow;
  if (!HydraFlow || typeof HydraFlow.adjacentIndexes !== 'function' ||
      typeof HydraFlow.propagate !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-flow.js (window.HydraFlow) to be loaded first.');
  }
  // Shared per-block condition evaluation (hydra-conditions.js): the
  // condition switch (gameStart, collision, onTimer, ...) both
  // runtimes step through. Single canonical source; buildPlayableHtml
  // inlines it into exported games so exports never depend on editor
  // files.
  var HydraConditions = global.HydraConditions;
  if (!HydraConditions || typeof HydraConditions.evaluateCondition !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-conditions.js (window.HydraConditions) to be loaded first.');
  }
  // Shared per-block action execution (hydra-execute.js): the action
  // switch (applyForce, setVariable, spawnObject, ...) both runtimes
  // step through. Single canonical source; buildPlayableHtml inlines
  // it into exported games so exports never depend on editor files.
  var HydraExecute = global.HydraExecute;
  if (!HydraExecute || typeof HydraExecute.executeAction !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-execute.js (window.HydraExecute) to be loaded first.');
  }
  // Shared CPU particle system (hydra-particles.js). Single canonical source
  // for particle simulation and rendering; buildPlayableHtml inlines it into
  // exported games so exports never depend on editor files.
  var HydraParticles = global.HydraParticles;
  if (!HydraParticles || typeof HydraParticles.burst !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-particles.js (window.HydraParticles) to be loaded first.');
  }
  // Named input actions (hydra-actions.js). Single canonical source for
  // keyboard/gamepad/touch-through-the-same-action state; buildPlayableHtml
  // inlines it into exported games so exports never depend on editor files.
  var HydraActions = global.HydraActions;
  if (!HydraActions || typeof HydraActions.update !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-actions.js (window.HydraActions) to be loaded first.');
  }
  // Shared tilemap logic (hydra-tiles.js). Single canonical source for
  // tile data, tile collision, and tile rendering; buildPlayableHtml
  // inlines it into exported games so exports never depend on editor files.
  var HydraTiles = global.HydraTiles;
  if (!HydraTiles || typeof HydraTiles.resolveTileCollision !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-tiles.js (window.HydraTiles) to be loaded first.');
  }
  // Shared 2D collision upgrade (hydra-physics2d.js): circle shapes,
  // trigger vs solid colliders, one-way platforms, collision layers/masks,
  // raycast and overlap queries. buildPlayableHtml inlines it into exported
  // games so exports never depend on editor files.
  var HydraPhysics2D = global.HydraPhysics2D;
  if (!HydraPhysics2D || typeof HydraPhysics2D.resolvePair !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-physics2d.js (window.HydraPhysics2D) to be loaded first.');
  }
  // Shared collections (hydra-collections.js): arrays/structures on game
  // variables. buildPlayableHtml inlines it into exported games so exports
  // never depend on editor files.
  var HydraCollections = global.HydraCollections;
  if (!HydraCollections || typeof HydraCollections.applyCollectionAction !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-collections.js (window.HydraCollections) to be loaded first.');
  }
  // Shared math/random (hydra-math.js): whole-number rolls, clamping,
  // rounding, random list picks, and range checks on game variables.
  // buildPlayableHtml inlines it into exported games so exports never
  // depend on editor files.
  var HydraMath = global.HydraMath;
  if (!HydraMath || typeof HydraMath.applyMathAction !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-math.js (window.HydraMath) to be loaded first.');
  }
  // Shared object picking (hydra-pick.js): nearest/farthest/random picks
  // over live objects by name. buildPlayableHtml inlines it into exported
  // games so exports never depend on editor files.
  var HydraPick = global.HydraPick;
  if (!HydraPick || typeof HydraPick.evalPickCondition !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-pick.js (window.HydraPick) to be loaded first.');
  }
  // Shared layers and visual effects (hydra-layerfx.js): relative draw-order
  // moves plus blend-mode/shadow/filter effects. buildPlayableHtml inlines
  // it into exported games so exports never depend on editor files.
  var HydraLayerFx = global.HydraLayerFx;
  if (!HydraLayerFx || typeof HydraLayerFx.applyLayerFxAction !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-layerfx.js (window.HydraLayerFx) to be loaded first.');
  }
  // Shared glTF/GLB model loader (hydra-gltf.js): parses uploaded 3D model
  // assets into triangle meshes for the Hydra3d projector. buildPlayableHtml
  // inlines it into exported games so exports never depend on editor files.
  var HydraGltf = global.HydraGltf;
  if (!HydraGltf || typeof HydraGltf.parseGlb !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-gltf.js (window.HydraGltf) to be loaded first.');
  }
  // Shared 3D rendering foundation (hydra-3d.js): primitive meshes, the
  // perspective projector, 3D block dispatch. buildPlayableHtml inlines it
  // into exported games so exports never depend on editor files.
  var Hydra3d = global.Hydra3d;
  if (!Hydra3d || typeof Hydra3d.apply3dAction !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-3d.js (window.Hydra3d) to be loaded first.');
  }
  // Shared profiling overlay (hydra-profile.js): FPS/frame-time rolling
  // stats, per-frame draw counts, and the on-canvas overlay panel.
  // buildPlayableHtml inlines it into exported games so exports never
  // depend on editor files.
  var HydraProfile = global.HydraProfile;
  if (!HydraProfile || typeof HydraProfile.createProfiler !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-profile.js (window.HydraProfile) to be loaded first.');
  }
  // Text scripting API (hydra-scriptapi.js): the documented `hs` object for
  // user-written JavaScript in the Run Script action and Script Check
  // condition. buildPlayableHtml inlines it into exported games so exports
  // never depend on editor files.
  var HydraScriptApi = global.HydraScriptApi;
  if (!HydraScriptApi || typeof HydraScriptApi.runAction !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-scriptapi.js (window.HydraScriptApi) to be loaded first.');
  }
  // Shared animation state machines (hydra-statemachine.js): named states
  // bound to sprite animations, driven by the Set Animation State block.
  // buildPlayableHtml inlines it into exported games so exports never
  // depend on editor files.
  var HydraStateMachine = global.HydraStateMachine;
  if (!HydraStateMachine || typeof HydraStateMachine.setState !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-statemachine.js (window.HydraStateMachine) to be loaded first.');
  }
  // Shared animation blend spaces (hydra-blendspace.js): 2D directional
  // blending between sprite animations, driven by the Set Blend block.
  // buildPlayableHtml inlines it into exported games so exports never
  // depend on editor files.
  var HydraBlendSpace = global.HydraBlendSpace;
  if (!HydraBlendSpace || typeof HydraBlendSpace.setBlend !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-blendspace.js (window.HydraBlendSpace) to be loaded first.');
  }
  // Shared 2D lighting + shadows (hydra-light2d.js): scene darkness,
  // point lights, and silhouette shadows, driven by the Set Darkness /
  // Set Light blocks. buildPlayableHtml inlines it into exported games
  // so exports never depend on editor files.
  var HydraLight2d = global.HydraLight2d;
  if (!HydraLight2d || typeof HydraLight2d.drawDarkness !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-light2d.js (window.HydraLight2d) to be loaded first.');
  }
  // Shared 2D physics joints (hydra-joints.js): distance rods, ropes,
  // and springs linking two objects by name, driven by the Create Joint
  // / Remove Joint blocks. buildPlayableHtml inlines it into exported
  // games so exports never depend on editor files.
  var HydraJoints = global.HydraJoints;
  if (!HydraJoints || typeof HydraJoints.solveJoints !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-joints.js (window.HydraJoints) to be loaded first.');
  }
  // Shared 2D skeletal animation (hydra-skeleton.js): bone rigs +
  // keyframed angle tracks, driven by the Play / Stop / Set Bone Angle
  // blocks and read by Skeleton Playing. buildPlayableHtml inlines it
  // into exported games so exports never depend on editor files.
  var HydraSkeleton = global.HydraSkeleton;
  if (!HydraSkeleton || typeof HydraSkeleton.setSkeletonAnimation !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-skeleton.js (window.HydraSkeleton) to be loaded first.');
  }
  // Shared localization string tables (hydra-localization.js): one
  // project-wide key table, driven by the Set Language / Set Text from
  // Key / Set Variable from Key blocks and read by Language Is.
  // buildPlayableHtml inlines it into exported games so exports never
  // depend on editor files.
  var HydraLocalization = global.HydraLocalization;
  if (!HydraLocalization || typeof HydraLocalization.resolveLocalized !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-localization.js (window.HydraLocalization) to be loaded first.');
  }
  // Shared dialogue system (hydra-dialogue.js): named conversations
  // from the Dialogues tab, driven by the Start / Advance / Choose /
  // Stop Dialogue blocks and read by the Dialogue Active / Waiting For
  // Choice / Choice Available conditions. buildPlayableHtml inlines it
  // into exported games so exports never depend on editor files.
  var HydraDialogue = global.HydraDialogue;
  if (!HydraDialogue || typeof HydraDialogue.startDialogue !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-dialogue.js (window.HydraDialogue) to be loaded first.');
  }
  // Shared inventory system (hydra-inventory.js): named items from
  // the Items tab, carried in a per-run backpack and driven by the
  // Add / Remove / Set / Read / Clear Item blocks and read by the Has
  // Item / Item Count conditions. buildPlayableHtml inlines it into
  // exported games so exports never depend on editor files.
  var HydraInventory = global.HydraInventory;
  if (!HydraInventory || typeof HydraInventory.addItem !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-inventory.js (window.HydraInventory) to be loaded first.');
  }
  // Shared quest system (hydra-quest.js): named objectives from the
  // Quests tab, tracked in a per-run quest log and driven by the Add /
  // Set / Complete / Reset / Read / Clear Quest blocks and read by
  // the Quest Complete / Quest Progress conditions.
  // buildPlayableHtml inlines it into exported games so exports never
  // depend on editor files.
  var HydraQuest = global.HydraQuest;
  if (!HydraQuest || typeof HydraQuest.completeQuest !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-quest.js (window.HydraQuest) to be loaded first.');
  }
  // Shared achievement system (hydra-achievement.js): permanent
  // trophies from the Achievements tab, tracked in an unlocked set
  // that persists per game in storage and driven by the Unlock / Lock
  // / Reset / Read Achievement blocks and read by the Achievement
  // Unlocked / Achievement Count conditions.
  // buildPlayableHtml inlines it into exported games so exports never
  // depend on editor files.
  var HydraAchievement = global.HydraAchievement;
  if (!HydraAchievement || typeof HydraAchievement.unlockAchievement !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-achievement.js (window.HydraAchievement) to be loaded first.');
  }
  // Shared cutscene system (hydra-cutscene.js): scripted scenes from
  // the Cutscenes tab, played step by step by the Play / Stop Cutscene
  // blocks and read by the Cutscene Playing / Cutscene Finished
  // conditions. buildPlayableHtml inlines it into exported games so
  // exports never depend on editor files.
  var HydraCutscene = global.HydraCutscene;
  if (!HydraCutscene || typeof HydraCutscene.playCutscene !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-cutscene.js (window.HydraCutscene) to be loaded first.');
  }
  // Shared high-score system (hydra-highscore.js): the ranked
  // leaderboard from the High Scores tab, driven by the Submit Score
  // / Read High Score / Clear High Scores blocks and read by the Is
  // High Score / High Score Count conditions. buildPlayableHtml
  // inlines it into exported games so exports never depend on editor
  // files.
  var HydraHighScore = global.HydraHighScore;
  if (!HydraHighScore || typeof HydraHighScore.submitScore !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-highscore.js (window.HydraHighScore) to be loaded first.');
  }
  // Shared time-scale system (hydra-timescale.js): the whole game
  // clock runs faster or slower, driven by the Set / Reset / Read
  // Time Scale blocks and read by the Time Scale condition.
  // buildPlayableHtml inlines it into exported games so exports never
  // depend on editor files.
  var HydraTimeScale = global.HydraTimeScale;
  if (!HydraTimeScale || typeof HydraTimeScale.scaledDt !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-timescale.js (window.HydraTimeScale) to be loaded first.');
  }
  // Shared scene-transition system (hydra-transition.js): fade / wipe
  // between scenes, driven by the Transition to Scene / Cancel
  // Transition blocks and read by the Transition Playing / Transition
  // Finished conditions. buildPlayableHtml inlines it into exported
  // games so exports never depend on editor files.
  var HydraTransition = global.HydraTransition;
  if (!HydraTransition || typeof HydraTransition.startTransition !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-transition.js (window.HydraTransition) to be loaded first.');
  }
  // Shared camera-feel system (hydra-camerafeel.js): follow smoothing,
  // deadzone, and camera bounds, driven by the Set Camera Smoothing /
  // Set Camera Deadzone / Set Camera Bounds / Clear Camera Bounds
  // blocks and read by the Camera Following condition.
  // buildPlayableHtml inlines it into exported games so exports never
  // depend on editor files.
  var HydraCameraFeel = global.HydraCameraFeel;
  if (!HydraCameraFeel || typeof HydraCameraFeel.updateFollowCamera !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-camerafeel.js (window.HydraCameraFeel) to be loaded first.');
  }
  // Shared parallax system (hydra-parallax.js): per-object scroll
  // factors, driven by the Set Parallax block and read by the Parallax
  // Factor condition; the draw module asks it for each object's
  // parallax camera. buildPlayableHtml inlines it into exported games
  // so exports never depend on editor files.
  var HydraParallax = global.HydraParallax;
  if (!HydraParallax || typeof HydraParallax.parallaxCamera !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-parallax.js (window.HydraParallax) to be loaded first.');
  }
  // Shared positional-audio system (hydra-spatialaudio.js): a sound
  // played at an object or an X/Y point fades with distance from
  // the screen center and pans left/right with it, driven by the
  // Play Sound at Position block. buildPlayableHtml inlines it into
  // exported games so exports never depend on editor files.
  var HydraSpatialAudio = global.HydraSpatialAudio;
  if (!HydraSpatialAudio || typeof HydraSpatialAudio.spatialMix !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-spatialaudio.js (window.HydraSpatialAudio) to be loaded first.');
  }
  // Shared pathfinding system (hydra-pathfind.js): A* over the tilemap's
  // solid tiles, driven by the Follow Path / Stop Path blocks and read by
  // the Path Finished / Has Path conditions; the frame loop walks every
  // following object one step per frame. buildPlayableHtml inlines it into
  // exported games so exports never depend on editor files.
  var HydraPathfind = global.HydraPathfind;
  if (!HydraPathfind || typeof HydraPathfind.findPath !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-pathfind.js (window.HydraPathfind) to be loaded first.');
  }
  // Shared AI behaviors (hydra-ai.js): patrol / chase / flee / wander,
  // driven by the Set AI Behavior / Stop AI blocks and read by the AI
  // Behavior / Target In Range conditions; the frame loop decides where
  // each driven object walks next before the path follower moves it.
  // buildPlayableHtml inlines it into exported games so exports never
  // depend on editor files.
  var HydraAi = global.HydraAi;
  if (!HydraAi || typeof HydraAi.updateAI !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-ai.js (window.HydraAi) to be loaded first.');
  }
  // Shared virtual joystick (hydra-joystick.js): the on-screen stick
  // a player drags to steer, driven by the Enable / Disable Joystick
  // blocks and read by the Joystick Active / Joystick Tilt conditions;
  // the frame loop writes its tilt into the joystick variables and
  // the input poll feeds the driven named actions. buildPlayableHtml
  // inlines it into exported games so exports never depend on editor
  // files.
  var HydraJoystick = global.HydraJoystick;
  if (!HydraJoystick || typeof HydraJoystick.createJoystickRuntime !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-joystick.js (window.HydraJoystick) to be loaded first.');
  }
  // Shared health & damage (hydra-health.js): per-object hit points,
  // driven by the Damage / Heal / Set Health / Set Max Health blocks
  // and read by the Health / Object Died conditions; the draw pass
  // paints the health bar above objects that ask for one.
  // buildPlayableHtml inlines it into exported games so exports never
  // depend on editor files.
  var HydraHealth = global.HydraHealth;
  if (!HydraHealth || typeof HydraHealth.normalizeHealth !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-health.js (window.HydraHealth) to be loaded first.');
  }
  // Shared damage feedback (hydra-damagefx.js): floating damage
  // numbers, per-object invincibility frames, and the knockback
  // direction helper, driven by the Show Damage Number / Make
  // Invincible / Knockback Object blocks and read by the Is Invincible
  // condition; the draw pass paints the numbers above the world.
  // buildPlayableHtml inlines it into exported games so exports never
  // depend on editor files.
  var HydraDamageFx = global.HydraDamageFx;
  if (!HydraDamageFx || typeof HydraDamageFx.createDamageNumberState !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-damagefx.js (window.HydraDamageFx) to be loaded first.');
  }
  // Shared checkpoints & respawn (hydra-respawn.js): the last
  // checkpoint point, the respawn count, and every object's start
  // position, driven by the Set Checkpoint / Respawn Object / Clear
  // Checkpoint blocks and read by the Checkpoint Set / Respawn Count
  // conditions. buildPlayableHtml inlines it into exported games so
  // exports never depend on editor files.
  var HydraRespawn = global.HydraRespawn;
  if (!HydraRespawn || typeof HydraRespawn.createRespawnState !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-respawn.js (window.HydraRespawn) to be loaded first.');
  }
  // Shared enemy spawner / wave spawning (hydra-spawn.js): named
  // spawners that clone a template object at a spawn point on an
  // interval, with a max-alive cap and an optional total, driven by
  // the Start Spawner / Stop Spawner / Read Spawned Count blocks and
  // read by the Spawner Active / Spawned Count conditions.
  // buildPlayableHtml inlines it into exported games so exports never
  // depend on editor files.
  var HydraSpawn = global.HydraSpawn;
  if (!HydraSpawn || typeof HydraSpawn.createSpawnerState !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-spawn.js (window.HydraSpawn) to be loaded first.');
  }
  // Shared lives & game over (hydra-lives.js): the per-run lives
  // count, driven by the Set / Add / Lose / Read Lives blocks and
  // read by the Lives / Game Over conditions. buildPlayableHtml
  // inlines it into exported games so exports never depend on editor
  // files.
  var HydraLives = global.HydraLives;
  if (!HydraLives || typeof HydraLives.createLivesState !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-lives.js (window.HydraLives) to be loaded first.');
  }
  // Shared movement abilities (hydra-movement.js): double jump, coyote
  // time, jump buffer & dash, driven by the Jump / Dash / Set Max Jumps
  // / Set Coyote Time / Set Jump Buffer blocks and read by the Jumps
  // Left / Is Dashing conditions. buildPlayableHtml inlines it into
  // exported games so exports never depend on editor files.
  var HydraMovement = global.HydraMovement;
  if (!HydraMovement || typeof HydraMovement.createMovementState !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-movement.js (window.HydraMovement) to be loaded first.');
  }
  // Shared moving platforms & one-way platforms (hydra-platform.js):
  // waypoint paths that carry their riders, one-way floors you jump
  // up through, and crumbling floors, driven by the Set Platform Path
  // / Set One-Way Platform / Set Crumble Time blocks and read by the
  // Standing On Platform / Standing On One-Way conditions.
  // buildPlayableHtml inlines it into exported games so exports never
  // depend on editor files.
  var HydraPlatform = global.HydraPlatform;
  if (!HydraPlatform || typeof HydraPlatform.createPlatformState !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-platform.js (window.HydraPlatform) to be loaded first.');
  }
  // Shared combat (hydra-combat.js): melee attacks & projectiles,
  // driven by the Melee Attack / Shoot Projectile blocks and read by
  // the Attack Ready condition. buildPlayableHtml inlines it into
  // exported games so exports never depend on editor files.
  var HydraCombat = global.HydraCombat;
  if (!HydraCombat || typeof HydraCombat.createCombatState !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-combat.js (window.HydraCombat) to be loaded first.');
  }
  // Shared experience & leveling (hydra-xp.js): the per-run XP total
  // and the level derived from it, driven by the Add / Set / Read XP
  // blocks and read by the XP / Level / Level Up conditions.
  // buildPlayableHtml inlines it into exported games so exports never
  // depend on editor files.
  var HydraXp = global.HydraXp;
  if (!HydraXp || typeof HydraXp.createXpState !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-xp.js (window.HydraXp) to be loaded first.');
  }
  // Shared level-up rewards & stat growth (hydra-growth.js): the
  // per-run per-object bonus record (max health, damage, speed),
  // driven by the Grow / Level Reward / Read Bonus blocks and read by
  // the Melee Attack, Shoot Projectile, and Dash blocks.
  // buildPlayableHtml inlines it into exported games so exports never
  // depend on editor files.
  var HydraGrowth = global.HydraGrowth;
  if (!HydraGrowth || typeof HydraGrowth.createGrowthState !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-growth.js (window.HydraGrowth) to be loaded first.');
  }
  // Shared enemy scaling with the hero's level (hydra-scaling.js):
  // the per-run per-object level record (level + HP/damage per
  // level), driven by the Set Enemy Level / Set Scaling Rates /
  // Scale to Hero Level / Read blocks and read by the Enemy Level
  // condition and by the Melee Attack / Shoot Projectile damage.
  // buildPlayableHtml inlines it into exported games so exports never
  // depend on editor files.
  var HydraScaling = global.HydraScaling;
  if (!HydraScaling || typeof HydraScaling.createScalingState !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-scaling.js (window.HydraScaling) to be loaded first.');
  }
  // Shared boss encounters (hydra-boss.js): the per-run boss fight
  // (boss name, phase count, bar visibility), driven by the Start /
  // End / Show / Hide / Read Boss Phase blocks and read by the Boss
  // Phase / Boss Active conditions, with the bar painted by the
  // shared draw module. buildPlayableHtml inlines it into exported
  // games so exports never depend on editor files.
  var HydraBoss = global.HydraBoss;
  if (!HydraBoss || typeof HydraBoss.createBossState !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-boss.js (window.HydraBoss) to be loaded first.');
  }
  // Shared object tags (hydra-tags.js): the per-object tag lists
  // (authored in the Inspector, changed by the Add / Remove / Clear
  // Tag blocks), read by the Has Tag / Tagged Count conditions and
  // counted by Read Tagged Count. buildPlayableHtml inlines it into
  // exported games so exports never depend on editor files.
  var HydraTags = global.HydraTags;
  if (!HydraTags || typeof HydraTags.normalizeTags !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-tags.js (window.HydraTags) to be loaded first.');
  }
  // Shared minimap (hydra-minimap.js): the per-scene corner map
  // (corner, size, zoom, visibility), driven by the Show / Hide /
  // Set Minimap Size / Set Minimap Zoom blocks and read by the
  // Minimap Visible condition, with the map painted by the shared
  // draw module. buildPlayableHtml inlines it into exported games
  // so exports never depend on editor files.
  var HydraMinimap = global.HydraMinimap;
  if (!HydraMinimap || typeof HydraMinimap.createMinimapState !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-minimap.js (window.HydraMinimap) to be loaded first.');
  }
  // Shared object parenting (hydra-attach.js): the per-scene link
  // table (child name -> parent + offset), driven by the Attach /
  // Detach / Set Attachment Offset blocks and read by the Is
  // Attached condition, applied every frame by the updateAttachments
  // phase. buildPlayableHtml inlines it into exported games so
  // exports never depend on editor files.
  var HydraAttach = global.HydraAttach;
  if (!HydraAttach || typeof HydraAttach.createAttachState !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-attach.js (window.HydraAttach) to be loaded first.');
  }
  // Shared scoped variables (hydra-variables.js): the per-run
  // global / scene / object variable stores, driven by the Set /
  // Read / Delete / Clear Scoped Variable actions and read by the
  // Scoped Variable Exists / Scoped Variable Check conditions.
  // buildPlayableHtml inlines it into exported games so exports never
  // depend on editor files.
  var HydraVariables = global.HydraVariables;
  if (!HydraVariables || typeof HydraVariables.createVariablesState !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-variables.js (window.HydraVariables) to be loaded first.');
  }
  // Shared custom functions (hydra-functions.js): the named reusable
  // block chains, driven by the Call Function / Return From Function
  // blocks and the per-call local variables they bind.
  // buildPlayableHtml inlines it into exported games so exports never
  // depend on editor files.
  var HydraFunctions = global.HydraFunctions;
  if (!HydraFunctions || typeof HydraFunctions.createCallState !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-functions.js (window.HydraFunctions) to be loaded first.');
  }
  // Shared loop state machine (hydra-loops.js): the Repeat / While /
  // Break / Continue blocks and the per-frame loop budget that keeps
  // a bad loop from freezing the game. buildPlayableHtml inlines it
  // into exported games so exports never depend on editor files.
  var HydraLoops = global.HydraLoops;
  if (!HydraLoops || typeof HydraLoops.createLoopState !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-loops.js (window.HydraLoops) to be loaded first.');
  }
  // Shared custom-event state machine (hydra-events.js): the
  // Broadcast Event / On Event blocks and the per-run broadcast
  // counts that let listeners fire once per broadcast.
  // buildPlayableHtml inlines it into exported games so exports
  // never depend on editor files.
  var HydraEvents = global.HydraEvents;
  if (!HydraEvents || typeof HydraEvents.createEventState !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-events.js (window.HydraEvents) to be loaded first.');
  }
  // Shared flow tracer (hydra-trace.js): the capped ring of flow events
  // (triggers + propagate visits) behind the editor's Trace panel and the
  // exported game's ?hydraTrace=1 debug flag. buildPlayableHtml inlines
  // it into exported games so exports never depend on editor files.
  var HydraTrace = global.HydraTrace;
  if (!HydraTrace || typeof HydraTrace.createTracer !== 'function') {
    throw new Error('HydraScript player runtime requires hydra-trace.js (window.HydraTrace) to be loaded first.');
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function normalizeScene(scene) {
    if (!scene) return null;
    scene.worldWidth = Math.max(100, Number(scene.worldWidth || scene.width || 800));
    scene.worldHeight = Math.max(100, Number(scene.worldHeight || scene.height || 600));
    scene.width = scene.worldWidth;
    scene.height = scene.worldHeight;
    scene.viewportWidth = Math.max(100, Number(scene.viewportWidth || Math.min(scene.worldWidth, 800) || 800));
    scene.viewportHeight = Math.max(100, Number(scene.viewportHeight || Math.min(scene.worldHeight, 600) || 600));
    scene.logicGrids = scene.logicGrids || {};
    const hasGridData = scene.gridData && Object.keys(scene.gridData).length > 0;
    const hasLogicGrid = scene.logicGrids.main && Object.keys(scene.logicGrids.main).length > 0;
    if (!hasGridData && hasLogicGrid) scene.gridData = scene.logicGrids.main;
    scene.gridData = scene.gridData || {};
    if (!hasLogicGrid) scene.logicGrids.main = scene.gridData;
    scene.objects = scene.objects || [];
    scene.objects.forEach(normalizeObject);
    // P4 item 3D1: per-scene 2D/3D render mode + 3D camera (2d default, so
    // old exported scenes render exactly as before).
    scene.renderMode = Hydra3d.normalizeRenderMode(scene.renderMode);
    scene.camera3d = Hydra3d.normalizeCamera3d(scene.camera3d, scene);
    // P4 Advanced (2D lighting): per-scene darkness + tint (0 = fully
    // lit, so old exported scenes render exactly as before).
    HydraLight2d.normalizeSceneDarkness(scene);
    // P4 Advanced (physics joints): per-scene joint list (absent in old
    // exported scenes, which simply have no joints).
    HydraJoints.normalizeJoints(scene);
    return scene;
  }

  function normalizeObject(obj) {
    obj.components = Array.isArray(obj.components) ? obj.components : [];
    obj.variables = obj.variables || {};
    obj.effects = Array.isArray(obj.effects) ? obj.effects : [];
    obj.collision = obj.collision || {};
    if (typeof obj.collision.enabled !== 'boolean') {
      // P4 item 3D1: 3D objects are inert to the 2D physics/collision
      // system — they live in the perspective view, not the 2D world.
      // P4 item 3D5: lights are non-physical too.
      // P4 Advanced (2D lighting): 2D lights are non-physical too.
      obj.collision.enabled = obj.kind !== 'text' && obj.kind !== 'panel' && obj.uiPinned !== true &&
        !Hydra3d.is3dKind(obj.kind) && !Hydra3d.isLight3d(obj.kind) && !HydraLight2d.isLight2d(obj.kind);
    }
    // P4 item 3D1: repair z-depth, depth size, and rotation fields.
    // P4 item 3D5: legacy light placeholders promote to real lights here.
    try {
      if (typeof Hydra3d.migrateLegacyLight3d === 'function') Hydra3d.migrateLegacyLight3d(obj);
    } catch (e) { /* never break export boot */ }
    try { if (Hydra3d.is3dKind(obj.kind) || Hydra3d.isLight3d(obj.kind)) Hydra3d.normalizeObject3d(obj); }
    catch (e) { /* never break export boot */ }
    // P4 Advanced (2D lighting): repair 2D light records + shadow flags.
    // Guarded away from 3D lights: light3d objects carry their own
    // `light` record shape (type/range), which normalizeLight2d must
    // never rewrite.
    try {
      if (HydraLight2d.isLight2d(obj.kind) ||
        (obj.light && typeof obj.light === 'object' && !Hydra3d.isLight3d(obj.kind) && !Hydra3d.is3dKind(obj.kind))) HydraLight2d.normalizeLight2d(obj);
    }
    catch (e) { /* never break export boot */ }
    // F2 (menus & HUD): anchor layout, HUD layer, button/panel styling.
    try { if (HydraUi && typeof HydraUi.normalizeUiFields === 'function') HydraUi.normalizeUiFields(obj); }
    catch (e) { /* never break export boot */ }
    // P4 item 32: circle shapes, trigger/solid mode, one-way platforms,
    // collision layers + masks (old projects keep classic behavior).
    try { if (HydraPhysics2D && typeof HydraPhysics2D.normalizePhysics2d === 'function') HydraPhysics2D.normalizePhysics2d(obj); }
    catch (e) { /* never break export boot */ }
    // P4 Advanced batch 16 (parallax backgrounds): per-object scroll
    // factors (1 = world speed, so old exported objects scroll exactly
    // as before — the same repair the editor's normalizeObject runs).
    try { if (HydraParallax && typeof HydraParallax.normalizeParallax === 'function') HydraParallax.normalizeParallax(obj); }
    catch (e) { /* never break export boot */ }
    // P4 Advanced batch 21 (health & damage): per-object hit points
    // (100 / 100 with the bar off, so old exported objects behave
    // exactly as before — the same repair the editor's normalizeObject
    // runs).
    try { if (HydraHealth && typeof HydraHealth.normalizeHealth === 'function') HydraHealth.normalizeHealth(obj); }
    catch (e) { /* never break export boot */ }
    // P4 Advanced batch 26 (movement abilities): per-object jump
    // config (one jump, no coyote, no buffer, so old exported objects
    // behave exactly as before — the same repair the editor's
    // normalizeObject runs).
    try { if (HydraMovement && typeof HydraMovement.normalizeMovementConfig === 'function' && obj.movement && typeof obj.movement === 'object') HydraMovement.normalizeMovementConfig(obj.movement); }
    catch (e) { /* never break export boot */ }
    // P4 Advanced batch 27 (moving platforms & one-way platforms):
    // per-object platform config (not a platform, so old exported
    // objects behave exactly as before — the same repair the editor's
    // normalizeObject runs). The one-way flag syncs onto the physics
    // record the collision step reads.
    try { if (HydraPlatform && typeof HydraPlatform.normalizePlatformConfig === 'function' && obj.platform && typeof obj.platform === 'object') HydraPlatform.normalizePlatformConfig(obj.platform, obj); }
    catch (e) { /* never break export boot */ }
    return obj;
  }

  function start(projectInput, options = {}) {
    const project = clone(projectInput || {});
    project.eventsVersion = project.eventsVersion || 1;
    project.logicGrids = project.logicGrids || { global: project.globalGridData || {} };
    project.globalGridData = project.globalGridData || project.logicGrids.global || {};
    const scenes = (project.scenes || []).map(normalizeScene).filter(Boolean);
    const assets = project.assets || {};
    const canvas = typeof options.canvas === 'string'
      ? document.querySelector(options.canvas)
      : (options.canvas || document.getElementById(options.canvasId || 'game-canvas'));
    if (!canvas) throw new Error('Hydra player canvas not found.');
    const ctx = canvas.getContext('2d');
    const state = createState(project, scenes, assets, canvas, ctx);
    bindInput(state);
    // P5 core-engine track, item P5-1 (Variables v2, slice b): seed
    // the authored definitions into the fresh run state (global +
    // object scopes) before the first scene loads, so a variable
    // created in the Variables manager exists from the first frame
    // without any block setting it. The scene definitions seed per
    // scene load in loadScene below.
    try { if (state.varScopes) HydraVariables.seedRun(state.varScopes, state.varDefs); } catch (e) { /* a throwing seed never breaks boot */ }
    loadScene(state, Number(project.currentSceneId || scenes[0]?.id || 1));
    resizeCanvas(state);
    global.addEventListener('resize', () => resizeCanvas(state));
    state.running = true;
    state.lastTime = 0;
    requestAnimationFrame(t => loop(state, t));
    return state;
  }

  function createState(project, scenes, assets, canvas, ctx) {
    return {
      project, scenes, assets, canvas, ctx,
      sceneId: null,
      objects: [],
      variables: {},
      hidden: new Set(),
      destroyed: new Set(),
      pendingDestroy: new Set(),
      timers: new Map(),
      once: new Set(),
      contexts: {},
      executionContext: null,
      camera: { x: 0, y: 0, zoom: 1, followTarget: '', offsetX: 0, offsetY: 0 },
      // P4 item 3D1: the live 3D camera. loadScene refreshes it from the
      // scene's stored camera3d; Set 3D Camera mutates this object.
      camera3d: null,
      // P4 item 3D1 batch 2: Follow 3D Object state (null = no follow).
      // Runtime-only, never written into scene.camera3d.
      camera3dFollow: null,
      // P4 item 3D2: parsed 3D model assets (assetId -> {status, doc}) and
      // fitted meshes (cacheKey -> mesh). Entries are session-only; a
      // {file} asset (web-target exports) fetches once, async, and draws
      // a placeholder box until the bytes arrive.
      modelCache: {},
      modelMeshCache: {},
      keys: new Set(),
      keysJustPressed: new Set(),
      keysJustReleased: new Set(),
      mouseButtons: new Set(),
      mouseJustPressed: new Set(),
      mouseJustReleased: new Set(),
      mouse: { x: 0, y: 0 },
      // P4 item 3D3 (character controllers): per-frame mouse deltas for
      // mouse-look, accumulated in updateMouse (pointer-lock movementX/Y,
      // or cursor travel when uncaptured), reset at the end of each frame.
      // _lastClient tracks the previous cursor position for uncaptured
      // deltas. Mirrors the editor preview's previewMouseDelta.
      mouseDelta: { x: 0, y: 0 },
      _lastClient: null,
      frameId: 0,
      dt: 1,
      pendingSceneId: null,
      // P4 item 37 batch 4 (scene management): the push/pop scene stack.
      // Survives scene switches; fresh per exported session (createState).
      sceneStack: [],
      // Input actions (P4 item 29): named actions with keyboard/gamepad/
      // touch bindings from project.inputActions; remaps survive scene
      // switches within a session. touchZones holds the zones with active
      // fingers on the canvas.
      actions: HydraActions.createRuntimeState(HydraActions.normalizeActions(project.inputActions)),
      touchZones: new Set(),
      // P4 item 37 batch 7 (raw input blocks): raw per-frame input state for
      // the Cursor Position / Any Key Pressed / Touch Active / Touch Count /
      // Gamepad Connected / Gamepad Button / Gamepad Stick conditions.
      touchCount: 0,
      gamepadButtons: new Set(),
      gamepadPrevButtons: new Set(),
      gamepadJustPressed: new Set(),
      gamepadJustReleased: new Set(),
      gamepadAxes: { lx: 0, ly: 0, rx: 0, ry: 0 },
      gamepadConnected: false,
      // P2 item 15/12 slice 1 (shared engine): shake + flash state comes
      // from HydraCameraFx, the same module the editor preview uses.
      shake: HydraCameraFx.createShake(),
      // Screen Flash (v4 gap, cycle 60): a fullscreen color wash that
      // fades out; timeLeft/maxTime are ms so the fade matches the shake
      // clock. Mirrors the editor preview.
      flash: HydraCameraFx.createFlash(),
      running: false,
      // F4 pause: paused freezes the world simulation (physics, anims,
      // tweens, camera, timers); pausedElapsedMs freezes the timer clock.
      paused: false,
      pausedElapsedMs: 0,
      // P4 Advanced batch 13 (time scale): the clock speed for this
      // run (1 = normal) and the game-clock debt banked per frame
      // (the un-scaled portion, so named timers slow with the world).
      // The scale survives scene switches inside the run, like the
      // language, and resets only on a fresh run (a fresh state);
      // the debt resets with the rest of the clock on every scene
      // load (HydraSceneReset).
      timeScale: HydraTimeScale.createTimeScaleRuntime(),
      timeScaleDebtMs: 0,
      // P4 Advanced batch 14 (scene transitions): the project
      // default (normalized once at run start) and the per-run
      // transition runtime (fresh on boot; it survives scene
      // switches inside the run — it has to, the transition IS the
      // switch — and resets only on the next run).
      transitionConfig: HydraTransition.normalizeTransitionConfig(project.sceneTransition),
      transition: HydraTransition.createTransitionRuntime(),
      // P4 Advanced batch 20 (virtual joystick): the project default
      // (normalized once at run start) and the per-run live stick
      // (fresh on boot, enabled from the default; it survives scene
      // switches inside the run, like the language, and resets only
      // on the next run — a fresh run never starts with a held stick).
      // The literal evaluates in order, so the normalize above has
      // already repaired project.virtualJoystick in place when the
      // runtime reads its enabled flag.
      joystickConfig: HydraJoystick.normalizeJoystickConfig(project.virtualJoystick),
      joystick: HydraJoystick.createJoystickRuntime(project.virtualJoystick),
      // P4 item 34 (profiling overlay): per-run FPS/frame-time stats and
      // per-frame draw counts. Session state, never saved; survives scene
      // switches so the overlay stays up while playtesting levels.
      profiler: HydraProfile.createProfiler(),
      // P4 item 36 phase C (flow tracer): per-run event ring, off by
      // default. The editor preview flips it with the Trace button; an
      // exported game flips it with ?hydraTrace=1 in the URL (see the
      // boot script in buildPlayableHtml). Never saved; survives scene
      // switches within a run, like the profiler.
      trace: HydraTrace.createTracer(),
      startedScopes: new Set(),
      diagnostics: [],
      reportedDiagnostics: new Set(),
      surfacedWarning: '',
      imageCache: {},
      bgCache: {},
      audioCtx: null,
      // P4 item 30: audio buses — per-bus volume/mute from project.audioBuses
      // (the Audio tab); voices hold the polyphony counts for this session.
      buses: HydraAudioBuses.normalizeBuses(project.audioBuses),
      // P4 Advanced (localization): the string table (normalized once at
      // run start) and the current language, which starts at the
      // project's default and survives scene switches inside the run.
      localization: HydraLocalization.normalizeLocalization(project.localization),
      language: HydraLocalization.defaultLanguageOf(project.localization),
      // P4 Advanced batch 7 (dialogue): the conversation table
      // (normalized once at run start) and the per-run dialogue runtime
      // (fresh on boot; scene loads end a running dialogue through the
      // scene-reset hook, so a fresh scene never inherits a half-finished
      // conversation).
      dialogues: HydraDialogue.normalizeDialogues(project.dialogues),
      dialogue: HydraDialogue.createDialogueRuntime(),
      // P4 Advanced batch 8 (inventory): the item table (normalized
      // once at run start) and the per-run backpack (fresh on boot;
      // it survives scene switches inside the run, like the language,
      // and resets only on the next run).
      items: HydraInventory.normalizeItems(project.items),
      inventory: HydraInventory.createInventoryRuntime(),
      // P4 Advanced batch 9 (quests): the quest table (normalized
      // once at run start) and the per-run quest log (fresh on boot;
      // it survives scene switches inside the run, like the backpack
      // and the language, and resets only on the next run).
      quests: HydraQuest.normalizeQuests(project.quests),
      questLog: HydraQuest.createQuestRuntime(),
      // P4 Advanced batch 25 (lives & game over): the per-run lives
      // count (fresh on boot; it survives scene switches inside the
      // run, like the quest log and the backpack, and resets only on
      // the next run).
      lives: HydraLives.createLivesState(),
      // P4 Advanced batch 30 (experience & leveling): the per-run XP
      // total (fresh on boot; it survives scene switches inside the
      // run, like the lives count, and resets only on the next run).
      xp: HydraXp.createXpState(),
      // P4 Advanced batch 31 (level-up rewards & stat growth): the
      // per-run growth bonuses (fresh on boot; they survive scene
      // switches inside the run, like the XP total, and reset only
      // on the next run).
      growth: HydraGrowth.createGrowthState(),
      // P4 Advanced batch 32 (enemy scaling with the hero's level):
      // the per-run scaling levels (fresh on boot; they survive
      // scene switches inside the run, like the growth bonuses, and
      // reset only on the next run).
      scaling: HydraScaling.createScalingState(),
      // P4 Advanced batch 33 (boss encounters): the per-run boss
      // fight (fresh on boot; it survives scene switches inside the
      // run, like the scaling levels, and resets only on the next
      // run).
      boss: HydraBoss.createBossState(),
      // P4 Advanced batch 36 (minimap): the per-scene corner map
      // (fresh on boot from the defaults, then re-minted from each
      // scene's config on scene load, in loadScene below).
      minimap: HydraMinimap.createMinimapState(null),
      // P4 Advanced batch 37 (object parenting): the per-scene link
      // table (fresh on boot, then re-minted from nothing on every
      // scene load, in loadScene below — a fresh scene starts with
      // no links).
      attachments: HydraAttach.createAttachState(),
      // P5 core-engine track, item P5-1 (Variables v2, slice a): the
      // per-run scoped variables (fresh on boot; global and object
      // scopes survive scene switches inside the run, like the
      // scaling levels, and reset only on the next run — the scene
      // scope resets on scene load, in loadScene below).
      varScopes: HydraVariables.createVariablesState(),
      // P5 core-engine track, item P5-1 (Variables v2, slice b): the
      // authored variable definitions (normalized once at run start,
      // like the quest table) — the starting values the Variables
      // manager stores in the project. Seeded into varScopes at boot
      // (global + object, in start below) and at every scene load
      // (scene, in loadScene below).
      varDefs: HydraVariables.normalizeDefinitions(project.scopedVariables),
      // P5 core-engine track, item P5-3 (Functions / custom blocks,
      // slice a): the authored function definitions (normalized once
      // at run start, like the variable definitions) and the call
      // stack (fresh on boot; calls are synchronous inside one
      // frame, so the stack is always empty between frames and a
      // scene switch can never strand a frame).
      fnDefs: HydraFunctions.normalizeFunctions(project.functions),
      fnCallState: HydraFunctions.createCallState(),
      // P5 core-engine track, item P5-4 (Control flow + events,
      // slice a): the loop state (depth, Break / Continue flag, and
      // per-frame budget), fresh on boot; loops are synchronous
      // inside one frame, so the depth is always 0 between frames,
      // and the budget is reset at the start of each frame's script
      // phase in processScope below.
      loopState: HydraLoops.createLoopState(),
      // P5 core-engine track, item P5-4 (Control flow + events,
      // slice c): the custom-event state (broadcast counts per name,
      // last-seen count per listener cell), fresh on boot; it
      // survives scene switches inside the run, so a broadcast in
      // one scene reaches a listener in the next scene on the next
      // frame.
      eventState: HydraEvents.createEventState(),
      // P4 Advanced batch 10 (achievements): the achievement table
      // (normalized once at run start) and the unlocked set (loaded
      // from storage at boot, so a trophy earned in an earlier run is
      // still unlocked; it survives scene switches and restarts
      // inside and across runs, like a save slot, and resets only
      // through the Reset / Lock Achievement blocks).
      achievements: HydraAchievement.normalizeAchievements(project.achievements),
      achievementLog: HydraAchievement.createAchievementRuntime(
        HydraAchievement.loadUnlocked(HydraAchievement.safeStorage(), project.id)),
      // The storage key for this game's unlocked set (per-project id,
      // so two games never share a trophy case); the action context's
      // persist hook writes through it.
      achievementKey: HydraAchievement.achievementKey(project.id),
      // P4 Advanced batch 11 (cutscenes): the cutscene table
      // (normalized once at run start) and the per-run cutscene
      // runtime (fresh on boot; it survives scene switches inside
      // the run, like the quest log, and resets only on the next run).
      cutscenes: HydraCutscene.normalizeCutscenes(project.cutscenes),
      cutscene: HydraCutscene.createCutsceneRuntime(),
      // P4 Advanced batch 12 (high scores): the table config
      // (normalized once at run start) and the ranked table (loaded
      // from storage at boot, so a score earned in an earlier run is
      // still on the board; it survives scene switches and restarts
      // inside and across runs, like the unlocked set, and resets
      // only through the Clear High Scores block).
      highScoreConfig: HydraHighScore.normalizeHighScoreConfig(project.highScores),
      highScoreTable: HydraHighScore.createHighScoreRuntime(
        HydraHighScore.loadEntries(HydraHighScore.safeStorage(), project.id),
        project.highScores),
      // The storage key for this game's table (per-project id, so two
      // games never share a leaderboard); the action context's persist
      // hook writes through it.
      highScoreKey: HydraHighScore.highScoreKey(project.id),
      busVoices: null, // created lazily on first playSound
      musicElements: [],
      sfxBufferCache: new Map(),
      // P4 item 37 batch 3: the master fader over all buses (project master
      // volume from the Audio tab), the pause flag for streaming music, and
      // the stopper registry for the Stop All Sounds block.
      masterVolume: HydraAudioBuses.normalizeMasterVolume(project.masterVolume),
      musicPaused: false,
      liveSoundStoppers: [],
      // P4 item 32: trigger contacts computed per frame by resolveCollisions;
      // _triggerPairs tracks last frame's "zoneId:objId" keys for the
      // Trigger Enter / Trigger Exit edge detection.
      _triggerContacts: [],
      _triggerPairs: {}
    };
  }

  function getScene(state) {
    return normalizeScene(state.scenes.find(s => s.id === state.sceneId) || state.scenes[0]);
  }

  function getScopeGrid(state, scope) {
    if (scope === 'global') return state.project.globalGridData || {};
    // P5-3: a function scope ('function:<id>') reads the function's
    // body grid from the normalized definitions.
    var fnId = HydraFunctions.functionIdOfScope(scope);
    if (fnId !== null) {
      var fn = HydraFunctions.findFunctionById(state.fnDefs, fnId);
      return (fn && fn.grid && typeof fn.grid === 'object') ? fn.grid : {};
    }
    return normalizeScene(state.scenes.find(s => s.id === Number(scope)))?.gridData || {};
  }

  function getScopeKey(scope) {
    if (typeof scope === 'string' && HydraFunctions.functionIdOfScope(scope) !== null) return scope;
    return String(scope === 'global' ? 'global' : Number(scope));
  }

  // P5 core-engine track, item P5-3 (Functions / custom blocks,
  // slice a): run a named function once and hand back its return
  // value. The body grid runs through the shared dispatch with the
  // function's scope key, so its conditions evaluate and its actions
  // fire exactly like a scope's grid for one frame — with two
  // call-frame rules: the parameters seed the frame's locals (bound
  // into the run state as the 'local' scope, restored after), and
  // the execution context is saved and restored, so the function's
  // triggers never leak into the caller's chain. Returns
  // { ok: true, value } (value 0 with no Return), { ok: false,
  // reason: 'missing' } for an unknown name, or { ok: false,
  // reason: 'depth' } when the recursion cap (32) is hit.
  function callFunction(state, name, args) {
    var fn = HydraFunctions.findFunction(state.fnDefs, name);
    if (!fn) return { ok: false, reason: 'missing' };
    var frame = HydraFunctions.call(state.fnCallState, fn);
    if (!frame) return { ok: false, reason: 'depth' };
    var scopeKey = HydraFunctions.scopeKeyFor(fn.id);
    var prevLocal = null;
    var prevExec = state.executionContext;
    try {
      prevLocal = HydraVariables.bindLocalScope(state.varScopes, frame.locals);
      var list = Array.isArray(args) ? args : [];
      for (var i = 0; i < fn.params.length; i++) {
        if (i >= list.length) break;
        try { HydraVariables.set(state.varScopes, 'local', fn.params[i], list[i]); } catch (e) { /* a throwing seed never breaks the call */ }
      }
      processScope(state, scopeKey, frame);
    } finally {
      try { HydraVariables.restoreLocalScope(state.varScopes, prevLocal); } catch (e) { /* a throwing restore never breaks the call */ }
      state.executionContext = prevExec;
    }
    var done = HydraFunctions.endCall(state.fnCallState);
    return { ok: true, value: (done && done.returnValue !== undefined) ? done.returnValue : 0 };
  }

  // Set the innermost call's return value (the Return From Function
  // block). Returns true, or false when no function is running (the
  // execute module warns on false).
  function returnFromFunction(state, value) {
    var done = false;
    try { done = HydraFunctions.returnFrom(state.fnCallState, value); } catch (e) { done = false; }
    return !!done;
  }

  function loadScene(state, sceneId) {
    const scene = normalizeScene(state.scenes.find(s => s.id === Number(sceneId)) || state.scenes[0]);
    if (!scene) return;
    // P2 item 15/12 slice 5 (shared engine): the fresh run state every
    // scene load starts from (camera, 3D camera, pause, particles,
    // per-scene collections, condition contexts, trigger edge state)
    // lives in HydraSceneReset, called identically by the editor preview
    // (scene load, scene switch, and preview restart).
    HydraSceneReset.resetSceneRuntime(state, scene, {
      normalizeCamera3d: (camera3d, sc) => Hydra3d.normalizeCamera3d(camera3d, sc),
      // P4 Advanced batch 15 (camera feel): a fresh copy of the scene's
      // smoothing / deadzone / bounds for this run (mirrors the editor
      // preview).
      cameraFeelOf: (sc) => HydraCameraFeel.freshCameraFeel(sc ? sc.cameraFeel : null),
      // P4 Advanced batch 36 (minimap): a fresh copy of the scene's
      // corner map for this run (mirrors the editor preview).
      minimapOf: (sc) => HydraMinimap.createMinimapState(sc ? sc.minimap : null),
      // P4 Advanced batch 37 (object parenting): a fresh link table
      // per scene load, so a fresh scene starts with no links
      // (mirrors the editor preview).
      createAttachState: () => HydraAttach.createAttachState(),
      createParticleState: () => HydraParticles.createParticleState(),
      // P4 Advanced batch 22 (damage feedback): a fresh floating-number
      // state per scene load, so a fresh scene never inherits the last
      // scene's numbers (mirrors the editor preview).
      createDamageNumbers: () => HydraDamageFx.createDamageNumberState(),
      // P4 Advanced batch 23 (checkpoints & respawn): a fresh respawn
      // state per scene load, so a fresh scene starts with no
      // checkpoint and a zero respawn count (mirrors the editor
      // preview).
      createRespawnState: () => HydraRespawn.createRespawnState(),
      // P4 Advanced batch 24 (enemy spawner): a fresh spawner state
      // per scene load, so a fresh scene starts with no spawners
      // running (mirrors the editor preview).
      createSpawnerState: () => HydraSpawn.createSpawnerState(),
      // P4 Advanced batch 26 (movement abilities): a fresh movement
      // state per scene load, so a fresh scene starts with no dash in
      // flight, no buffered jump, and a full jump count (mirrors the
      // editor preview).
      createMovementState: () => HydraMovement.createMovementState(),
      // P4 Advanced batch 27 (moving platforms & one-way platforms):
      // a fresh platform state per scene load, so a fresh scene starts
      // with every platform back at its first waypoint and no crumble
      // timer running (mirrors the editor preview).
      createPlatformState: () => HydraPlatform.createPlatformState(),
      // P4 Advanced batch 29 (combat): a fresh combat state per scene
      // load, so a fresh scene starts with no cooldowns spent, no
      // projectiles flying, and no slash showing (mirrors the editor
      // preview).
      createCombatState: () => HydraCombat.createCombatState(),
      hidden: state.hidden,
      destroyed: state.destroyed,
      pendingDestroy: state.pendingDestroy,
      timers: state.timers,
      once: state.once,
      startedScopes: state.startedScopes,
      resetContexts: () => { state.contexts = {}; state.executionContext = null; },
      // P4 Advanced batch 7 (dialogue): a scene load ends a running
      // dialogue, so a fresh scene never inherits a half-finished
      // conversation (mirrors the editor preview).
      resetDialogue: () => {
        try { HydraDialogue.stopDialogue(state.dialogue, dialogueHooks(state)); } catch (e) { /* a throwing stop never breaks scene load */ }
      }
    });
    state.objects = clone(scene.objects || []);
    // P5 core-engine track, item P5-1 (Variables v2, slice a): a
    // scene load clears that scene's scoped variables, so a fresh
    // visit starts from zero (the scene's objects reload fresh too)
    // — global and object scopes survive the switch (mirrors the
    // editor preview).
    try { if (state.varScopes) HydraVariables.clearScene(state.varScopes, state.sceneId); } catch (e) { /* a throwing clear never breaks scene load */ }
    // P5 core-engine track, item P5-1 (Variables v2, slice b): the
    // clear above wipes the scene scope, so re-seed this scene's
    // authored definitions right after it — every visit to a scene
    // starts from its starting values (mirrors the editor preview).
    try { if (state.varScopes) HydraVariables.seedScene(state.varScopes, state.varDefs, state.sceneId); } catch (e) { /* a throwing seed never breaks scene load */ }
    // P2 item 15/12 slice 2 (shared engine): the per-object fresh runtime
    // state lives in HydraSceneInit, called identically by the editor
    // preview (scene load, scene switch, and both spawn paths).
    HydraSceneInit.initSceneObjects(state.objects, {
      anim: HydraAnim,
      stateMachine: HydraStateMachine,
      blendSpace: HydraBlendSpace,
      skeleton: HydraSkeleton,
      warn: (msg) => reportRuntimeDiagnostic(state, 'warning', msg)
    });
    // P4 Advanced batch 23 (checkpoints & respawn): remember where
    // every object started this scene, so Respawn Object can send it
    // home when no checkpoint is set yet (mirrors the editor preview).
    try {
      if (state.respawn) HydraRespawn.recordInitialPositions(state.respawn, state.objects);
    } catch (e) { /* a throwing record never breaks scene load */ }
    // P4 Advanced (localization): text objects bound to a string-table
    // key start with their translation in the run's current language
    // (mirrors the editor preview); unbound texts keep their authored
    // text, and keys with no translation keep it too.
    HydraSceneInit.applyBoundTexts(state.objects, state.localization, state.language,
      HydraLocalization && HydraLocalization.boundTextFor);
    resizeCanvas(state);
  }

  function resizeCanvas(state) {
    const scene = getScene(state);
    if (!scene) return;
    state.canvas.width = scene.viewportWidth;
    state.canvas.height = scene.viewportHeight;
    clampCamera(state);
  }

  function bindInput(state) {
    const canvas = state.canvas;
    canvas.tabIndex = 0;
    document.addEventListener('keydown', e => {
      if (!state.keys.has(e.key)) state.keysJustPressed.add(e.key);
      state.keys.add(e.key);
      if (e.code) {
        if (!state.keys.has(e.code)) state.keysJustPressed.add(e.code);
        state.keys.add(e.code);
      }
      if (e.key === ' ') state.keys.add('Space');
    });
    document.addEventListener('keyup', e => {
      [e.key, e.code, e.key === ' ' ? 'Space' : ''].filter(Boolean).forEach(key => {
        if (state.keys.has(key)) state.keysJustReleased.add(key);
        state.keys.delete(key);
      });
    });
    canvas.addEventListener('mousemove', e => {
      updateMouse(state, e);
      // P4 Advanced batch 20 (virtual joystick): a dragged stick
      // follows the pointer; the mouse position still updates, so
      // Mouse Over keeps reading the real cursor.
      if (state.joystick && state.joystick.pointerId === 'mouse') {
        HydraJoystick.joystickMove(state.joystick, state.joystickConfig, 'mouse', state.mouse.x, state.mouse.y);
      }
    });
    canvas.addEventListener('mousedown', e => {
      updateMouse(state, e);
      // P4 Advanced batch 20 (virtual joystick): a press inside the
      // stick's base grabs the stick instead of clicking — a grabbed
      // press never also clicks a button underneath it. Any other
      // press is an ordinary click, exactly as before.
      if (e.button === 0 && state.joystick &&
          HydraJoystick.joystickStart(state.joystick, state.joystickConfig, 'mouse', state.mouse.x, state.mouse.y, state.canvas.width, state.canvas.height)) {
        canvas.focus();
        return;
      }
      state.mouseButtons.add(e.button);
      state.mouseJustPressed.add(e.button);
      canvas.focus();
    });
    canvas.addEventListener('mouseup', e => {
      updateMouse(state, e);
      // P4 Advanced batch 20 (virtual joystick): releasing the
      // grabbed pointer lets go of the stick; it was never added to
      // the mouse buttons, so there is nothing to release there.
      if (state.joystick && state.joystick.pointerId === 'mouse') {
        HydraJoystick.joystickEnd(state.joystick, 'mouse');
        return;
      }
      state.mouseButtons.delete(e.button);
      state.mouseJustReleased.add(e.button);
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    // Touch: route screen touches through the named input actions (P4
    // item 29). Multi-touch works because zones are tracked as a set.
    // P4 Advanced batch 20 (virtual joystick): a new touch that lands
    // inside the stick's base grabs the stick instead of a touch zone,
    // and a grabbed touch drives the stick instead of the zones, so
    // steering never also walks the player through a touch zone.
    const touchHandler = e => {
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      const rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: canvas.width, height: canvas.height };
      const touchPoint = t => ({
        x: ((t.clientX - rect.left) / rect.width) * canvas.width,
        y: ((t.clientY - rect.top) / rect.height) * canvas.height
      });
      const type = (e && e.type) || '';
      if (type === 'touchstart' && e.changedTouches) {
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          if (!t) continue;
          const p = touchPoint(t);
          HydraJoystick.joystickStart(state.joystick, state.joystickConfig, 'touch:' + t.identifier, p.x, p.y, canvas.width, canvas.height);
        }
      }
      if ((type === 'touchend' || type === 'touchcancel') && e.changedTouches) {
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          if (!t) continue;
          HydraJoystick.joystickEnd(state.joystick, 'touch:' + t.identifier);
        }
      }
      state.touchZones.clear();
      const touches = (e && e.touches) || [];
      // P4 item 37 batch 7 (raw input blocks): raw touch count for the
      // Touch Active / Touch Count conditions (zones are derived below).
      state.touchCount = touches.length;
      for (let i = 0; i < touches.length; i++) {
        const t = touches[i];
        if (state.joystick && state.joystick.pointerId === 'touch:' + t.identifier) {
          const p = touchPoint(t);
          HydraJoystick.joystickMove(state.joystick, state.joystickConfig, state.joystick.pointerId, p.x, p.y);
          continue;
        }
        const p = touchPoint(t);
        HydraActions.zonesAt(p.x, p.y, canvas.width, canvas.height).forEach(z => state.touchZones.add(z));
      }
    };
    canvas.addEventListener('touchstart', touchHandler, { passive: false });
    canvas.addEventListener('touchmove', touchHandler, { passive: false });
    canvas.addEventListener('touchend', touchHandler, { passive: false });
    canvas.addEventListener('touchcancel', touchHandler, { passive: false });
  }

  function updateMouse(state, e) {
    const rect = state.canvas.getBoundingClientRect();
    state.mouse.x = ((e.clientX - rect.left) / rect.width) * state.canvas.width;
    state.mouse.y = ((e.clientY - rect.top) / rect.height) * state.canvas.height;
    // P4 item 3D3: accumulate this frame's mouse movement for Read Mouse
    // Delta. Pointer lock gives raw movementX/Y; otherwise derive the
    // delta from cursor travel. Never throws; hostile events just add 0.
    try {
      if (typeof document !== 'undefined' && document.pointerLockElement === state.canvas) {
        state.mouseDelta.x += Number(e.movementX) || 0;
        state.mouseDelta.y += Number(e.movementY) || 0;
      } else if (state._lastClient && typeof e.clientX === 'number') {
        state.mouseDelta.x += (e.clientX - state._lastClient.x) || 0;
        state.mouseDelta.y += (e.clientY - state._lastClient.y) || 0;
      }
    } catch (err) { /* mouse deltas are decoration; never break input */ }
    state._lastClient = (typeof e.clientX === 'number')
      ? { x: e.clientX, y: e.clientY } : state._lastClient;
  }

  function pollExportGamepads() {
    try {
      return (typeof navigator !== 'undefined' && navigator.getGamepads)
        ? Array.prototype.slice.call(navigator.getGamepads())
        : [];
    } catch (e) { return []; }
  }

  function loop(state, timestamp) {
    // P2 item 15/12 slice 3: frame timing and the per-frame update order
    // live in HydraFrame — this loop only computes timing and hands its
    // subsystem calls to the module in canonical order, exactly as the
    // editor preview does (mirrors the editor preview). The phase bodies
    // below are the loop's old inline code moved verbatim into hooks.
    const timing = HydraFrame.computeDt(state.lastTime, timestamp);
    state.lastTime = timing.lastTime;
    // P4 Advanced batch 13 (time scale): the frame step runs at the
    // run's clock speed — physics, animation, tweens, particles,
    // cutscenes, and dialogue all read state.dt, so scaling it once
    // here slows the whole world together (mirrors the editor
    // preview). The profiler still reads real timestamps, so FPS
    // stays honest.
    state.dt = HydraTimeScale.scaledDt(timing.dt, state.timeScale);
    // Bank this frame's un-scaled portion into the game-clock debt,
    // so the named timers slow with the world (the module no-ops
    // while paused — notePausedFrame already banks the full realMs
    // into pausedElapsedMs, and double-counting would freeze the
    // clock twice).
    try { HydraTimeScale.noteScaledFrame(state, timing.realMs, state.timeScale); } catch (e) { /* a throwing clock never breaks the frame */ }
    state.frameId++;
    HydraFrame.stepFrame({
      timestamp: timestamp,
      dt: state.dt,
      realMs: timing.realMs,
      isPaused: () => HydraPause.isPaused(state),
      // P4 item 34 (profiling overlay): feed every frame's real timestamp
      // so the FPS / frame-time rolling average stays honest.
      profile: (t) => HydraProfile.frame(state.profiler, t),
      // F4 pause: while paused the world simulation freezes, but the game
      // keeps rendering and the script grids keep running so a pause menu
      // built from plain blocks stays interactive.
      notePaused: (ms) => HydraPause.notePausedFrame(state, ms),
      // P2 item 15/12 slice 1: shake + flash decay lives in HydraCameraFx,
      // called identically by the editor preview.
      decayCameraFx: (dtMs) => HydraCameraFx.decay(state.shake, state.flash, dtMs),
      updateCamera: () => { updateCameraFollow(state); update3dCameraFollow(state); },
      updatePhysics2d: () => updatePhysics(state),
      // P4 item 3D4 (3D physics): gravity, box/sphere 3D colliders, ground
      // detection, and MTV collision response for 3D objects — inside the
      // unpaused update so 3D physics freezes while paused, like 2D
      // physics (mirrors the editor preview).
      updatePhysics3d: () => update3dPhysics(state),
      // P4 Advanced (physics joints): rods, ropes, and springs solve
      // after collisions, so joints and walls agree — inside the unpaused
      // update, so joints freeze while paused like the rest of the world
      // sim (mirrors the editor preview).
      solveJoints: () => {
        const liveJointObjs = state.objects.filter(o => !state.destroyed.has(o.id) && !state.pendingDestroy.has(o.id));
        const jointScene = getScene(state);
        if (jointScene) {
          HydraJoints.normalizeJoints(jointScene);
          HydraJoints.solveJoints(liveJointObjs, jointScene.joints, state.dt,
            (o) => !o.static);
        }
      },
      // Sprite animations: advance every playing animation BEFORE scripts run,
      // so Animation Finished sees this frame's finished flags (mirrors the
      // editor preview).
      updateAnimations: () => {
        state.objects.forEach(o => {
          o._anim = o._anim || HydraAnim.createAnimState();
          HydraAnim.update(o._anim, o, state.dt);
        });
      },
      // P4 Advanced (blend spaces): advance the active blend space's shared
      // frame clock BEFORE scripts run, so the blended frame is current
      // when the game draws (mirrors the editor preview). Inside the
      // unpaused update, so blends freeze while paused like animations.
      updateBlendSpaces: () => {
        state.objects.forEach(o => {
          o._blends = o._blends || HydraBlendSpace.createBlendRuntime();
          HydraBlendSpace.updateBlend(o._blends, o, state.dt);
        });
      },
      // P4 Advanced (skeletal animation): advance the active skeletal
      // animation's frame clock BEFORE scripts run, so the pose is
      // current when the game draws (mirrors the editor preview).
      // Inside the unpaused update, so poses freeze while paused.
      updateSkeletons: () => {
        state.objects.forEach(o => {
          o._skel = o._skel || HydraSkeleton.createSkeletonRuntime();
          HydraSkeleton.updateSkeleton(o._skel, o, state.dt);
        });
      },
      // Tweens: advance BEFORE scripts run so Tween Finished sees this
      // frame's finished records (mirrors the editor preview).
      updateTweens: () => {
        state.objects.forEach(o => {
          HydraTween.update(null, o, state.dt);
        });
      },
      // Particles: advance emitters + particles BEFORE scripts run
      // (mirrors the editor preview). Gated by pause like the rest of the
      // world sim, so particles freeze mid-air while paused.
      updateParticles: () => {
        if (state.particles) {
          HydraParticles.update(state.particles, state.dt, (name) => {
            const target = named(state, name)[0];
            return target ? { x: (target.posX || 0) + (target.width || 0) / 2, y: (target.posY || 0) + (target.height || 0) / 2 } : null;
          });
        }
      },
      // P4 Advanced batch 22 (damage feedback): rise and fade the
      // floating numbers BEFORE scripts run, so a number spawned this
      // frame is already aging next frame (mirrors the editor preview).
      // The scaled dt means numbers slow with the time scale and freeze
      // while paused.
      updateDamageNumbers: () => {
        if (state.damageNumbers) {
          HydraDamageFx.updateDamageNumbers(state.damageNumbers, (state.dt || 0) / 60);
        }
      },
      // P4 Advanced batch 19 (AI behaviors): decide where each driven
      // object walks next BEFORE the follower moves it, so a fresh plan
      // walks the same frame (mirrors the editor preview). The scaled
      // dt means behaviors slow with the time scale and freeze while
      // paused.
      updateAI: () => {
        const live = state.objects.filter(o => !state.destroyed.has(o.id) && !state.pendingDestroy.has(o.id));
        HydraAi.updateAI(live, (state.dt || 0) / 60, {
          pathfind: HydraPathfind,
          tiles: HydraTiles,
          worldSize: function () { var s = getScene(state); return s ? { width: s.worldWidth, height: s.worldHeight } : null; },
          findObject: function (name) { return named(state, name, true)[0] || null; }
        });
      },
      // P4 Advanced batch 18 (pathfinding): walk every following object
      // one step along its path BEFORE scripts run, so Path Finished
      // sees this frame's arrivals (mirrors the editor preview). Last
      // in the world sim, so the walk is the frame's final word on a
      // following object's position; the scaled dt means paths slow
      // with the time scale and freeze while paused.
      updatePaths: () => {
        const live = state.objects.filter(o => !state.destroyed.has(o.id) && !state.pendingDestroy.has(o.id));
        HydraPathfind.updatePaths(live, (state.dt || 0) / 60);
      },
      // P4 Advanced batch 24 (enemy spawner): clone what is due BEFORE
      // scripts run, so a newborn is visible to this frame's scripts
      // (mirrors the editor preview). Last in the world sim, so a
      // newborn never gets a half-stepped physics or AI update on its
      // birth frame; the scaled dt means spawners slow with the time
      // scale and freeze while paused. Spawning runs through the same
      // Spawn Object action the blocks use, so clones get the full
      // scene init.
      updateSpawners: () => {
        if (state.spawners) {
          HydraSpawn.updateSpawners(state.spawners, (state.dt || 0) / 60, {
            spawn: function (template, x, y) {
              try {
                return HydraExecute.spawnObjectAt(actionCtx(state), template, x, y);
              } catch (e) { return null; }
            },
            findObject: function (name) { return named(state, name, true)[0] || null; },
            aliveCount: function (template) { return named(state, template, true).length; }
          });
        }
      },
      // P4 Advanced batch 27 (moving platforms & one-way platforms):
      // slide every platform along its path, carry its riders, and
      // run the crumble timers AFTER the physics step settled this
      // frame's positions and BEFORE the movement phase, so the
      // movement module's grounded check sees the rider on the
      // platform's new position and jumps refill there (mirrors the
      // editor preview). The scaled dt means platforms slow with the
      // time scale and freeze while paused; the frozen clock means
      // crumble timers hold while paused.
      updatePlatforms: () => {
        if (state.platform) {
          const live = state.objects.filter(o => !state.destroyed.has(o.id) && !state.pendingDestroy.has(o.id));
          HydraPlatform.updatePlatforms(state.platform, live, HydraPause.gameNow(state, performance.now()) / 1000, (state.dt || 0) / 60, {
            objects: live,
            hitbox: hitbox,
            isCollision: isCollisionObject,
            isOneWay: (o) => { try { return HydraPhysics2D.isOneWay(o); } catch (e) { return false; } },
            hide: (o) => { try { state.hidden.add(o.id); } catch (e) { /* a throwing hide never breaks the frame */ } }
          });
        }
      },
      // P4 Advanced batch 26 (movement abilities): refresh the
      // per-object jump / dash state AFTER the physics step settled
      // this frame's positions, so a landing refills the jumps and a
      // buffered press fires the frame after the object lands, and a
      // dash steps the object along its burst (mirrors the editor
      // preview). Last in the world sim, so the dash is the frame's
      // final word on a dashing object's position; the scaled dt
      // means dashes slow with the time scale and freeze while paused.
      updateMovement: () => {
        if (state.movement) {
          const live = state.objects.filter(o => !state.destroyed.has(o.id) && !state.pendingDestroy.has(o.id));
          HydraMovement.updateMovement(state.movement, live, HydraPause.gameNow(state, performance.now()) / 1000, (state.dt || 0) / 60, {
            objects: live,
            hitbox: hitbox,
            isCollision: isCollisionObject,
            canCollide: (a, b) => { try { return HydraPhysics2D.canCollide(a, b); } catch (e) { return true; } },
            // P4 Advanced batch 27 (one-way platforms): the grounded
            // check skips a one-way floor while the object rises
            // through it, so jumping up through one never grants a
            // free ground jump (mirrors the editor preview).
            isOneWay: (o) => { try { return HydraPhysics2D.isOneWay(o); } catch (e) { return false; } },
            tiles: HydraTiles,
            // P4 Advanced batch 28 (wall slide & wall jump): the
            // held-key set the slide reads the press toward the wall
            // from (mirrors the editor preview).
            keys: state.keys,
            hasKey: (set, key) => HydraInput.keySetHas(set, key)
          });
        }
      },
      // P4 Advanced batch 29 (combat): step the live projectiles and
      // fade the slash arcs AFTER the movement phase, so a projectile
      // steps after the dash has had the frame's final word on
      // positions (mirrors the editor preview).
      updateCombat: () => {
        if (state.combat) {
          const live = state.objects.filter(o => !state.destroyed.has(o.id) && !state.pendingDestroy.has(o.id));
          HydraCombat.updateCombat(state.combat, (state.dt || 0) / 60, {
            objects: live,
            hitbox: hitbox,
            isCollision: isCollisionObject,
            damage: (target, amount) => {
              if (HydraDamageFx.isInvincible(target, HydraPause.gameNow(state, performance.now()))) return;
              HydraHealth.damage(target, amount);
            },
            destroy: (o) => { if (o && o.id != null) state.pendingDestroy.add(o.id); },
            isAlive: (o) => !!o && o.id != null && !state.destroyed.has(o.id) && !state.pendingDestroy.has(o.id)
          }, HydraPause.gameNow(state, performance.now()) / 1000);
        }
      },
      // P4 Advanced batch 37 (object parenting): snap every attached
      // child to its parent plus the stored offset AFTER the combat
      // phase, so the attach is the frame's final word on a child's
      // position (mirrors the editor preview). A dash, a path step,
      // or a projectile can move the parent, and the child still
      // lands exactly on it this frame.
      updateAttachments: () => {
        if (state.attachments) {
          const live = state.objects.filter(o => !state.destroyed.has(o.id) && !state.pendingDestroy.has(o.id));
          HydraAttach.applyAttachments(state.attachments, live);
        }
      },
      resetContexts: () => { state.contexts = {}; state.executionContext = null; },
      // Input actions (P4 item 29): advance BEFORE scripts run, so Action
      // Input conditions see this frame's state (mirrors the editor preview).
      // Runs while paused too, like raw key input, so pause menus can use
      // actions. HydraActions.update clears and recomputes the edge sets.
      // P4 item 37 batch 7 (raw input blocks): poll the raw gamepad state
      // once per frame and derive button edge sets, so Gamepad Button fires
      // just-pressed/released exactly once per press.
      pollInput: () => {
        const rawGamepadButtons = HydraActions.pollGamepadButtons(pollExportGamepads);
        state.gamepadButtons = rawGamepadButtons;
        state.gamepadJustPressed = new Set([...rawGamepadButtons].filter(b => !state.gamepadPrevButtons.has(b)));
        state.gamepadJustReleased = new Set([...state.gamepadPrevButtons].filter(b => !rawGamepadButtons.has(b)));
        state.gamepadPrevButtons = rawGamepadButtons;
        state.gamepadAxes = HydraActions.pollGamepadAxes(pollExportGamepads);
        state.gamepadConnected = HydraActions.isGamepadConnected(pollExportGamepads);
        HydraActions.update(state.actions, {
          keys: state.keys,
          keysJustPressed: state.keysJustPressed,
          keysJustReleased: state.keysJustReleased,
          gamepad: rawGamepadButtons,
          touchZones: state.touchZones,
          // P4 Advanced batch 20 (virtual joystick): the stick holds
          // its driven named actions like a key does, so a tilted
          // stick holds Move Left with just-pressed / released edges
          // exactly like a key press.
          joystick: new Set(HydraJoystick.joystickHeldActions(state.joystickConfig, state.joystick)),
          keySetHas: (set, key) => HydraInput.keySetHas(set, key)
        });
      },
      // P4 Advanced batch 20 (virtual joystick): write this frame's
      // stick tilt into the joystick variables AFTER the input poll
      // (so the driven actions above already hold) and BEFORE the
      // scripts run, so a condition reading joystickX or an action
      // reading a driven action sees this frame's tilt. Runs while
      // paused too, like the input poll.
      updateJoystick: () => {
        HydraJoystick.applyJoystickOutput(state.joystick, state.joystickConfig, {
          setVariable: (name, value) => { state.variables[name] = value; }
        });
      },
      runScripts: () => { updateTransition(state); updateCutscene(state); updateDialogue(state); processScope(state, 'global'); processScope(state, state.sceneId); },
      // Surface expression warnings (unknown names, eval failures) instead of
      // letting actions silently misbehave.
      surfaceWarnings: () => {
        if (state.lastExpressionWarning && state.lastExpressionWarning !== state.surfacedWarning) {
          state.surfacedWarning = state.lastExpressionWarning;
          reportRuntimeDiagnostic(state, 'warning', state.lastExpressionWarning);
        }
      },
      applyPendingDestroy: () => {
        state.pendingDestroy.forEach(id => state.destroyed.add(id));
        state.pendingDestroy.clear();
      },
      // Apply a scene change requested by switchScene/restartScene/nextScene/
      // previousScene AFTER all actions ran, so no old-scene action executes
      // against the new scene's objects.
      applyPendingScene: () => {
        if (state.pendingSceneId != null) {
          const targetId = state.pendingSceneId;
          state.pendingSceneId = null;
          loadScene(state, targetId);
        }
      },
      draw: () => draw(state),
      clearEdges: () => {
        state.keysJustPressed.clear();
        state.keysJustReleased.clear();
        state.mouseJustPressed.clear();
        state.mouseJustReleased.clear();
        // P4 item 3D3: mouse deltas are per-frame — scripts have read them by
        // now, so reset for the next frame's accumulation.
        state.mouseDelta.x = 0;
        state.mouseDelta.y = 0;
      }
    });
    if (state.running) requestAnimationFrame(t => loop(state, t));
  }
  // P2 item 15/12 slice 4 (shared engine): the per-frame 2D physics step
  // lives in HydraPhysicsStep, called identically by the editor preview
  // (the integration loop, the collision pass, and the tile pass all used
  // to be inlined here). The trigger summary it returns is the state the
  // old inline resolveCollisions wrote directly.
  function updatePhysics(state) {
    const live = state.objects.filter(o => !state.destroyed.has(o.id));
    const trig = HydraPhysicsStep.stepPhysics2d(live, state.dt, {
      getPhysics: getPhysics,
      hitbox: hitbox,
      isCollisionObject: isCollisionObject,
      is3dKind: Hydra3d.is3dKind,
      isLight3d: Hydra3d.isLight3d,
      physics2d: HydraPhysics2D,
      tiles: HydraTiles,
      prevTriggerPairs: state._triggerPairs || {}
    });
    state._triggerContacts = trig.contacts;
    state._triggerPairs = trig.nextPairs;
    state._triggerEntered = trig.entered;
    state._triggerExited = trig.exited;
  }

  function getPhysics(obj) {
    const defaults = { gravity: 0, friction: 0.82, bounciness: 0.4, maxSpeed: 25 };
    return Object.assign(defaults, obj.physics || {});
  }

  // P4 item 3D4 (3D physics): one frame of the shared Hydra3d physics step
  // for 3D objects — gravity, box/sphere colliders, ground detection, MTV
  // collision response (mirrors the editor preview). 3D objects stay
  // inert to the 2D step above.
  function update3dPhysics(state) {
    if (!Hydra3d || typeof Hydra3d.updatePhysics3d !== 'function') return;
    const live3d = state.objects.filter(o => !state.destroyed.has(o.id) && Hydra3d.is3dKind(o.kind));
    Hydra3d.updatePhysics3d(live3d, state.dt, getPhysics);
  }

  function hitbox(obj) {
    return {
      x: (obj.posX || 0) + (Number(obj.hitboxOffsetX) || 0),
      y: (obj.posY || 0) + (Number(obj.hitboxOffsetY) || 0),
      width: Number(obj.hitboxWidth) > 0 ? Number(obj.hitboxWidth) : (obj.width || 1),
      height: Number(obj.hitboxHeight) > 0 ? Number(obj.hitboxHeight) : (obj.height || 1)
    };
  }

  function isCollisionObject(obj) {
    if (!obj) return false;
    // P4 item 31: tilemaps collide per-tile, never as whole-object AABBs
    // (a whole-map box would make the entire map solid).
    if (obj.kind === 'tilemap') return false;
    if (obj.kind === 'text' || obj.uiPinned === true) return obj.collision?.enabled === true;
    if (obj.collision && obj.collision.enabled === false) return false;
    return obj.collidable !== false;
  }

  // P2 item 15/12 slice 7 (shared engine): the script-grid dispatch —
  // the two-pass traversal, trigger-mode gating, trace recording, and
  // unknown-block reporting — lives in HydraDispatch, called identically
  // by the editor preview. The per-block condition switch (evaluate
  // below) lives in the shared HydraConditions module and the per-block
  // action switch (execute below) in the shared HydraExecute module —
  // slice 9 closes the shared-engine extraction, so the two runtimes
  // are thin hosts around the shared modules.
  function processScope(state, scope, fnFrame) {
    // A fresh loop budget for this frame's script phase (not for a
    // function body, which runs inside the caller's frame and shares
    // its budget, so a function called from a loop cannot reset it).
    if (!fnFrame) {
      try { HydraLoops.resetLoopBudget(state.loopState); } catch (e) { /* a throwing reset never breaks the frame */ }
    }
    HydraDispatch.processScope(getScopeGrid(state, scope), getScopeKey(scope), dispatchHooks(state, scope, fnFrame));
  }

  // The hooks the shared dispatch module needs from the exported
  // runtime: the classifiers, the per-block evaluator/executor, the
  // edge-memory map, and the bookkeeping. A condition that starts a
  // flow records its context AND the execution context; a condition
  // evaluated as a gate during propagation records only its context
  // (for the and/once merge) — chained actions keep seeing the
  // triggering condition's context.
  // fnFrame (P5-3) is the live call frame when this scope is a
  // function body: once Return has set frame.returned, the execute
  // hook stops running further actions in the body, so Return ends
  // the function instead of only setting its value.
  function dispatchHooks(state, scope, fnFrame) {
    return {
      flow: HydraFlow,
      trace: HydraTrace,
      traceState: state.trace,
      frameId: state.frameId || 0,
      isCondition: isCondition,
      isAction: isAction,
      isComment: (type) => type === 'comment',
      evaluate: (idx, data) => evaluate(state, scope, idx, data),
      execute: (idx, data) => {
        if (fnFrame && fnFrame.returned) return;
        execute(state, data, idx);
      },
      // P5-4 slice a (loops): Repeat / While run their body through
      // executeLoop, and a Break / Continue inside a body stops that
      // body propagation through shouldAbort. The Return guard
      // applies here too: once a function body has returned, a loop
      // inside it runs no further body actions, so its runBody is
      // wrapped to return an empty run instead of executing.
      isLoopBlock: (type) => HydraLoops.isLoopBlock(type),
      executeLoop: (idx, data, runBody) => {
        if (fnFrame && fnFrame.returned) return;
        return executeLoop(state, data, idx, function () {
          if (fnFrame && fnFrame.returned) return [];
          return runBody();
        });
      },
      shouldAbort: () => {
        try { return HydraLoops.controlOf(state.loopState) !== null; } catch (e) { return false; }
      },
      flowTriggerStates: state.flowTriggerStates || (state.flowTriggerStates = {}),
      startedScopes: state.startedScopes,
      onTriggered: (idx, result) => {
        const key = `${getScopeKey(scope)}:${idx}`;
        state.contexts[key] = result.context || {};
        state.executionContext = result.context || {};
      },
      onPropagateCondition: (idx, result) => {
        state.contexts[`${getScopeKey(scope)}:${idx}`] = result.context || {};
      },
      reportUnknown: (type, idx) => {
        reportRuntimeDiagnostic(state, 'warning', `Unknown block type "${type}" at grid cell ${idx} — skipping.`);
      }
    };
  }

  function isCondition(type) {
    return ['gameStart','always','keyPressed','keyJustPressed','mouseClick','mouseOverObject','objectClicked','getVariable','collision','onFloor','overlapTouch','distanceCheck','positionCheck','velocityCheck','objectVisible','objectCount','chance','onTimer','onEdge','and','triggerOnce','animationFinished','tweenFinished','saveSlotExists','gamePaused','actionInput','tileSolidAt','standingOnTile','triggerEnter','triggerExit','raycastHit','overlapCheck','textCheck','musicPlaying','cameraPosition','cursorPosition','anyKeyPressed','touchActive','touchCount','gamepadConnected','gamepadButton','gamepadStick','angleBetween','lineOfSight','nearestDistance','movingTowards','timerElapsed','profilerVisible','scriptCheck','animStateIs','blendActive'].includes(type) ||
      HydraCollections.isCollectionCondition(type) ||
      HydraMath.isMathCondition(type) ||
      HydraPick.isPickCondition(type) ||
      HydraLayerFx.isLayerFxCondition(type) ||
      HydraLight2d.isLight2dCondition(type) ||
      HydraJoints.isJointCondition(type) ||
      HydraSkeleton.isSkeletonCondition(type) ||
      HydraLocalization.isLocalizationCondition(type) ||
      HydraDialogue.isDialogueCondition(type) ||
      HydraInventory.isInventoryCondition(type) ||
      HydraQuest.isQuestCondition(type) ||
      HydraAchievement.isAchievementCondition(type) ||
      HydraCutscene.isCutsceneCondition(type) ||
      HydraHighScore.isHighScoreCondition(type) ||
      HydraTimeScale.isTimeScaleCondition(type) ||
      HydraTransition.isTransitionCondition(type) ||
      HydraCameraFeel.isCameraFeelCondition(type) ||
      HydraParallax.isParallaxCondition(type) ||
      HydraSpatialAudio.isSpatialAudioCondition(type) ||
      HydraPathfind.isPathfindCondition(type) ||
      HydraAi.isAiCondition(type) ||
      HydraJoystick.isJoystickCondition(type) ||
      HydraHealth.isHealthCondition(type) ||
      HydraDamageFx.isDamageFxCondition(type) ||
      HydraRespawn.isRespawnCondition(type) ||
      HydraSpawn.isSpawnCondition(type) ||
      HydraLives.isLivesCondition(type) ||
      HydraMovement.isMovementCondition(type) ||
      HydraPlatform.isPlatformCondition(type) ||
      HydraCombat.isCombatCondition(type) ||
      HydraXp.isXpCondition(type) ||
      HydraScaling.isScalingCondition(type) ||
      HydraBoss.isBossCondition(type) ||
      HydraTags.isTagCondition(type) ||
      HydraMinimap.isMinimapCondition(type) ||
      HydraAttach.isAttachCondition(type) ||
      HydraVariables.isScopedVariableCondition(type) ||
      HydraEvents.isEventCondition(type) ||
      Hydra3d.is3dCondition(type);
  }

  function isAction(type) {
    return ['applyForce','teleport','setVariable','destroyObject','showHide','playSound','playAnimation','setAnimation','stopAnimation','switchScene','setText','setCamera','followCamera','setSize','setVelocity','spawnObject','rotateObject','randomVariable','forceToward','forceTowardPosition','moveTowardPosition','moveTowardObject','impulseAwayObject','stopObject','setPosition','clampToScreen','wrapScreen','destroyOutsideScreen','setGravity','setFriction','setMaxSpeed','setBounciness','setPhysicsEnabled','setStatic','setColor','setOpacity','setLayer','pointTowardObject','pointTowardPosition','faceMovement','timerControl','screenShake','screenFlash','restartScene','nextScene','previousScene','spawnAtObject','separateObjects','saveVariable','loadVariable','saveGame','loadGame','deleteSaveSlot','tweenProperty','stopTween','pauseGame','resumeGame','togglePause','showProfiler','hideProfiler','toggleProfiler','runScript','emitBurst','startEmitter','stopEmitter','clearParticles','remapAction','resetActionBindings','setBusVolume','setBusMuted','stopMusic','pauseMusic','resumeMusic','stopAllSounds','setMasterVolume','setTile','setCollisionLayer','flipObject','setScale','setTextSize','setTextColor','setTextStyle','setTextAlignment','appendText','pushScene','popScene','setSceneBackground','centerCameraOn','stopCameraFollow','resetCamera','setCameraZoom','readTimer','setAnimState','setBlend','stopBlend'].includes(type) ||
      HydraCollections.isCollectionAction(type) ||
      HydraMath.isMathAction(type) ||
      HydraLayerFx.isLayerFxAction(type) ||
      HydraLight2d.isLight2dAction(type) ||
      HydraJoints.isJointAction(type) ||
      HydraSkeleton.isSkeletonAction(type) ||
      HydraLocalization.isLocalizationAction(type) ||
      HydraDialogue.isDialogueAction(type) ||
      HydraInventory.isInventoryAction(type) ||
      HydraQuest.isQuestAction(type) ||
      HydraAchievement.isAchievementAction(type) ||
      HydraCutscene.isCutsceneAction(type) ||
      HydraHighScore.isHighScoreAction(type) ||
      HydraTimeScale.isTimeScaleAction(type) ||
      HydraTransition.isTransitionAction(type) ||
      HydraCameraFeel.isCameraFeelAction(type) ||
      HydraParallax.isParallaxAction(type) ||
      HydraSpatialAudio.isSpatialAudioAction(type) ||
      HydraPathfind.isPathfindAction(type) ||
      HydraAi.isAiAction(type) ||
      HydraJoystick.isJoystickAction(type) ||
      HydraHealth.isHealthAction(type) ||
      HydraDamageFx.isDamageFxAction(type) ||
      HydraRespawn.isRespawnAction(type) ||
      HydraSpawn.isSpawnAction(type) ||
      HydraLives.isLivesAction(type) ||
      HydraMovement.isMovementAction(type) ||
      HydraPlatform.isPlatformAction(type) ||
      HydraCombat.isCombatAction(type) ||
      HydraXp.isXpAction(type) ||
      HydraGrowth.isGrowthAction(type) ||
      HydraScaling.isScalingAction(type) ||
      HydraBoss.isBossAction(type) ||
      HydraTags.isTagAction(type) ||
      HydraMinimap.isMinimapAction(type) ||
      HydraAttach.isAttachAction(type) ||
      HydraVariables.isScopedVariableAction(type) ||
      HydraVariables.isObjectRefAction(type) ||
      HydraFunctions.isFunctionAction(type) ||
      HydraLoops.isLoopAction(type) ||
      HydraEvents.isEventAction(type) ||
      Hydra3d.is3dAction(type);
  }

  // P2 item 15/12 slice 8 (shared engine): the context the shared
  // HydraConditions module needs from the exported runtime — one
  // builder so the evaluate call site can never drift from the
  // dispatch's. The module owns the per-block condition switch; the
  // host only describes its live run state.
  function conditionCtx(state) {
    return {
      variables: state.variables,
      startedScopes: state.startedScopes,
      hidden: state.hidden,
      keys: state.keys,
      keysJustPressed: state.keysJustPressed,
      keysJustReleased: state.keysJustReleased,
      hasKey: function (set, key) { return HydraInput.keySetHas(set, key); },
      mouse: state.mouse,
      mouseButtons: state.mouseButtons,
      mouseJustPressed: state.mouseJustPressed,
      mouseJustReleased: state.mouseJustReleased,
      mouseButtonCode: function (b) { return HydraInput.mouseButtonCode(b); },
      touchCount: state.touchCount || 0,
      gamepadConnected: !!state.gamepadConnected,
      gamepadButtons: state.gamepadButtons,
      gamepadJustPressed: state.gamepadJustPressed,
      gamepadJustReleased: state.gamepadJustReleased,
      gamepadAxes: state.gamepadAxes,
      camera: state.camera,
      canvasWidth: state.canvas ? state.canvas.width : 0,
      canvasHeight: state.canvas ? state.canvas.height : 0,
      named: function (name) { return named(state, name); },
      allObjects: function () { return state.objects.filter(function (o) { return !state.destroyed.has(o.id) && !state.pendingDestroy.has(o.id); }); },
      hitbox: hitbox,
      isCollisionObject: isCollisionObject,
      ui: HydraUi,
      parallaxModule: HydraParallax,
      pathfindModule: HydraPathfind,
      aiModule: HydraAi,
      joystickModule: HydraJoystick,
      joystick: state.joystick,
      joystickConfig: state.joystickConfig,
      // P4 Advanced batch 21 (health & damage): the module the Health /
      // Object Died conditions read the hit points through.
      healthModule: HydraHealth,
      // P4 Advanced batch 22 (damage feedback): the module the Is
      // Invincible condition reads the shield through.
      damageFxModule: HydraDamageFx,
      // P4 Advanced batch 23 (checkpoints & respawn): the module the
      // Checkpoint Set / Respawn Count conditions read through, and
      // the live respawn state they read.
      respawnModule: HydraRespawn,
      respawn: state.respawn,
      // P4 Advanced batch 24 (enemy spawner): the module the Spawner
      // Active / Spawned Count conditions read through, and the live
      // spawner state they read.
      spawnModule: HydraSpawn,
      spawners: state.spawners,
      // P4 Advanced batch 25 (lives & game over): the module the Lives /
      // Game Over conditions read through, and the live lives state they read.
      livesModule: HydraLives,
      lives: state.lives,
      // P4 Advanced batch 26 (movement abilities): the module the Jumps
      // Left / Is Dashing conditions read through, and the live
      // movement state they read.
      movementModule: HydraMovement,
      movement: state.movement,
      // P4 Advanced batch 27 (moving platforms & one-way platforms):
      // the module the Standing On Platform / Standing On One-Way
      // conditions read through, and the live platform state they read.
      platformModule: HydraPlatform,
      platform: state.platform,
      // P4 Advanced batch 29 (combat): the module the Attack Ready
      // condition reads the cooldowns through, and the live combat
      // state it reads.
      combatModule: HydraCombat,
      combat: state.combat,
      // P4 Advanced batch 30 (experience & leveling): the module the
      // XP / Level / Level Up conditions read through, and the live XP
      // state they read.
      xpModule: HydraXp,
      xp: state.xp,
      // P4 Advanced batch 32 (enemy scaling with the hero's level):
      // the module the Enemy Level condition reads through, and the
      // live scaling state it reads.
      scalingModule: HydraScaling,
      scaling: state.scaling,
      // P4 Advanced batch 33 (boss encounters): the module the Boss
      // Phase / Boss Active conditions read through, and the live
      // boss state they read.
      bossModule: HydraBoss,
      boss: state.boss,
      // P4 Advanced batch 34 (object tags): the module the Has Tag
      // / Tagged Count conditions read through. Tags live on the
      // objects themselves, so there is no per-run tags state.
      tagsModule: HydraTags,
      // P4 Advanced batch 36 (minimap): the module the Minimap
      // Visible condition reads through, and the live minimap run
      // record (fresh per scene load, re-minted from the scene's
      // config in loadScene).
      minimapModule: HydraMinimap,
      minimap: state.minimap,
      // P4 Advanced batch 37 (object parenting): the module the Is
      // Attached condition reads through, and the live link table
      // it reads (fresh per scene load, re-minted in loadScene).
      attachModule: HydraAttach,
      attachments: state.attachments,
      // P5 core-engine track, item P5-1 (Variables v2, slice a):
      // the module the Scoped Variable Exists / Scoped Variable
      // Check conditions read through, and the live scoped-variable
      // state they read.
      varScopesModule: HydraVariables,
      varScopes: state.varScopes,
      // P5 core-engine track, item P5-4 (Control flow + events,
      // slice c): the module the On Event condition polls through,
      // and the live event state it reads (broadcast counts per
      // name, last-seen count per listener cell).
      eventsModule: HydraEvents,
      events: state.eventState,
      expr: function (value) { return expr(state, value); },
      contexts: state.contexts,
      once: state.once,
      adjacentIndexes: HydraFlow.adjacentIndexes,
      scopeKey: getScopeKey,
      timers: state.timers,
      timerElapsedSeconds: function (key, now) { return namedTimerElapsedSeconds(state, key, now); },
      nowMs: function () { return HydraPause.gameNow(state, performance.now()); },
      frameId: state.frameId || 0,
      isPaused: function () { return HydraPause.isPaused(state); },
      worldSize: function () { var s = getScene(state); return s ? { width: s.worldWidth, height: s.worldHeight } : null; },
      triggerEntered: state._triggerEntered || [],
      triggerExited: state._triggerExited || [],
      language: state.language,
      dialogue: state.dialogue,
      inventory: state.inventory,
      questLog: state.questLog,
      achievementLog: state.achievementLog,
      cutscene: state.cutscene,
      highScoreTable: state.highScoreTable,
      highScoreConfig: state.highScoreConfig,
      timeScale: state.timeScale,
      transition: state.transition,
      musicCount: (state.busVoices && state.busVoices.counts && state.busVoices.counts.music) || 0,
      musicPaused: !!state.musicPaused,
      profilerVisible: function () { return HydraProfile.isVisible(state.profiler); },
      random: Math.random,
      actions: HydraActions,
      actionState: state.actions,
      physics2d: HydraPhysics2D,
      tiles: HydraTiles,
      save: HydraSave,
      anim: HydraAnim,
      stateMachine: HydraStateMachine,
      blendSpace: HydraBlendSpace,
      skeleton: HydraSkeleton,
      tween: HydraTween,
      collections: HydraCollections,
      math: HydraMath,
      pick: HydraPick,
      layerFx: HydraLayerFx,
      threeD: Hydra3d,
      light2d: HydraLight2d,
      joints: HydraJoints,
      scriptApi: HydraScriptApi,
      collectionHooks: function () { return collectionHooks(state); },
      mathHooks: function () { return mathHooks(state); },
      pickHooks: function () { return pickHooks(state); },
      layerFxConditionHooks: function () { return layerFxConditionHooks(state); },
      threeDConditionHooks: function () { return threeDConditionHooks(state); },
      light2dConditionHooks: function () { return light2dConditionHooks(state); },
      jointConditionHooks: function () { return jointConditionHooks(state); },
      scriptApiHooks: function () { return scriptApiHooks(state); },
      reportUnknown: function (type) { reportRuntimeDiagnostic(state, 'warning', 'Unknown condition block type "' + type + '" — skipping.'); }
    };
  }

  function evaluate(state, scope, idx, data) {
    return HydraConditions.evaluateCondition(data, conditionCtx(state), scope, idx);
  }

  // P4 item 35 (text scripting API): the hooks the shared HydraScriptApi
  // module needs — variables, live objects, input actions, timers, audio,
  // scenes, camera, particles, save slots, pause, profiler, tiles, frame
  // time, and diagnostics. Mirrors the editor preview's scriptApiHooks
  // exactly so preview and exported games run scripts identically.
  function scriptApiHooks(state) {
    const particlePresetSpec = (kind, name, x, y) => {
      const list = (HydraParticles && HydraParticles.PRESETS) || [];
      const want = String(name || '').trim().toLowerCase();
      const p = list.find(q => (q.kind === kind || q.kind === 'both') &&
        (q.id === want || String(q.label || '').toLowerCase() === want)) || null;
      const spec = { x, y };
      if (p && p.fill) Object.assign(spec, p.fill);
      return spec;
    };
    const assetIdByName = (name) => {
      const assets = state.assets || {};
      for (const id of Object.keys(assets)) {
        if (assets[id] && assets[id].name === name) return id;
      }
      return '';
    };
    const sceneIdByName = (name) => {
      const s = (state.scenes || []).find(q => q && q.name === name);
      if (s) return s.id;
      const asNum = Number(name);
      if (Number.isFinite(asNum) && (state.scenes || []).some(q => q && q.id === asNum)) return asNum;
      return null;
    };
    return {
      getVar: (n) => state.variables[n],
      setVar: (n, v) => { state.variables[n] = v; },
      hasVar: (n) => Object.prototype.hasOwnProperty.call(state.variables, n),
      liveObjects: (n) => named(state, n, true),
      destroyObject: (o) => { if (o && o.id !== undefined) state.pendingDestroy.add(o.id); },
      isHidden: (o) => state.hidden.has(o.id),
      setHidden: (o, hide) => { if (hide) state.hidden.add(o.id); else state.hidden.delete(o.id); },
      inputState: (n) => ({
        held: HydraActions.actionHeld(state.actions, n),
        pressed: HydraActions.actionJustPressed(state.actions, n),
        released: HydraActions.actionJustReleased(state.actions, n)
      }),
      timerElapsed: (n) => namedTimerElapsedSeconds(state, `named:${n}`, HydraPause.gameNow(state, performance.now())),
      timerStart: (n) => {
        const now = performance.now();
        state.timers.set(`named:${n}`, { lastFiredTime: now, paused: false, pausedAt: 0, firedFrame: -1 });
      },
      timerStop: (n) => {
        const rec = state.timers.get(`named:${n}`);
        if (rec && typeof rec === 'object' && !rec.paused) {
          rec.paused = true; rec.pausedAt = performance.now();
        }
      },
      playSound: (n, opts) => {
        const o = opts || {};
        playSound(state, { assetId: assetIdByName(n), bus: o.bus, volume: o.volume, pitch: o.pitch, loop: o.loop });
      },
      stopMusic: () => stopExportMusic(state),
      setBusVolume: (bus, v) => {
        const b = HydraAudioBuses.normalizeBusId(bus);
        let x = Number(v);
        if (!isFinite(x)) x = state.buses[b].volume;
        state.buses[b].volume = x < 0 ? 0 : (x > 1 ? 1 : x);
      },
      setBusMuted: (bus, on) => { state.buses[HydraAudioBuses.normalizeBusId(bus)].muted = on === true || on === 'true'; },
      musicPlaying: () => !!(state.busVoices && state.busVoices.counts && state.busVoices.counts.music > 0) && !state.musicPaused,
      switchScene: (n) => {
        const id = sceneIdByName(n);
        if (id === null) reportRuntimeDiagnostic(state, 'warning', `Script: no scene named "${n}", so the scene was not switched.`);
        else requestSceneChange(state, id);
      },
      currentSceneName: () => {
        const s = (state.scenes || []).find(q => q && q.id === state.sceneId);
        return s ? s.name : '';
      },
      cameraRead: () => ({ x: state.camera.x, y: state.camera.y, zoom: state.camera.zoom }),
      cameraMove: (x, y) => {
        state.camera.x = x; state.camera.y = y; state.camera.followTarget = ''; clampCamera(state);
      },
      cameraZoom: (z) => { state.camera.zoom = normalizeCameraZoom(z); clampCamera(state); },
      cameraCenterOn: (n) => {
        const z = normalizeCameraZoom(state.camera.zoom);
        const target = named(state, n, true)[0];
        if (target) {
          state.camera.x = (target.posX + target.width / 2) - state.canvas.width / (2 * z);
          state.camera.y = (target.posY + target.height / 2) - state.canvas.height / (2 * z);
        }
        clampCamera(state);
      },
      cameraFollow: (n, ox, oy) => {
        state.camera.followTarget = n; state.camera.offsetX = ox; state.camera.offsetY = oy;
        updateCameraFollow(state);
      },
      cameraStopFollow: () => { state.camera.followTarget = ''; },
      cameraReset: () => { state.camera = { x: 0, y: 0, zoom: 1, followTarget: '', offsetX: 0, offsetY: 0 }; clampCamera(state); },
      emitBurst: (preset, x, y) => {
        HydraParticles.burst(state.particles || (state.particles = HydraParticles.createParticleState()),
          particlePresetSpec('burst', preset, x, y));
      },
      startEmitter: (n, preset, x, y) => {
        HydraParticles.startEmitter(state.particles || (state.particles = HydraParticles.createParticleState()),
          n, particlePresetSpec('emitter', preset, x, y));
      },
      stopEmitter: (n) => { if (state.particles) HydraParticles.stopEmitter(state.particles, n); },
      clearParticles: () => { if (state.particles) HydraParticles.clearParticles(state.particles, ''); },
      saveGame: (slot) => HydraSave.writeSlot(HydraSave.safeStorage(), slot, state.variables),
      loadGame: (slot) => {
        const rec = HydraSave.readSlot(HydraSave.safeStorage(), slot);
        if (rec) for (const k of Object.keys(rec.data)) state.variables[k] = rec.data[k];
      },
      deleteSave: (slot) => HydraSave.deleteSlot(HydraSave.safeStorage(), slot),
      saveExists: (slot) => HydraSave.slotExists(HydraSave.safeStorage(), slot),
      pause: () => HydraPause.pause(state),
      resume: () => HydraPause.resume(state),
      isPaused: () => HydraPause.isPaused(state),
      showProfiler: () => HydraProfile.show(state.profiler),
      hideProfiler: () => HydraProfile.hide(state.profiler),
      profilerVisible: () => HydraProfile.isVisible(state.profiler),
      setTile: (n, col, row, tile) => {
        named(state, n).filter(o => o.kind === 'tilemap')
          .forEach(tm => HydraTiles.setTile(tm, col, row, tile));
      },
      tileSolidAt: (n, px, py) => tilemapsNamed(state, n).some(tm => HydraTiles.isSolidAtPixel(tm, px, py)),
      dtSeconds: () => (state.dt || 1) / 60,
      warn: (msg) => reportRuntimeDiagnostic(state, 'warning', msg),
      log: (msg) => { if (typeof console !== 'undefined' && console.log) console.log('[HydraScript]', msg); }
    };
  }

  // P4 Advanced batch 7 (dialogue): the hooks the shared HydraDialogue
  // module needs — warnings through the run diagnostics, and the
  // typewriter's text writes into live text objects by name (hidden
  // objects excluded, like named(); a bound label that is shown later
  // picks the text up on the next frame, since the update runs every
  // frame while a dialogue is active). Mirrors the editor preview's
  // dialogueHooks exactly so preview and exported games agree.
  function dialogueHooks(state) {
    return {
      warn: (msg) => reportRuntimeDiagnostic(state, 'warning', msg),
      setObjectText: (name, text) => {
        named(state, name).forEach(o => { if (o.kind === 'text') o._runtimeText = text; });
      }
    };
  }

  // P4 Advanced batch 7 (dialogue): advance the typewriter one frame.
  // Called from the runScripts phase (before the grids run, so a
  // condition reading the dialogue sees this frame's text); it runs
  // while paused too, like the pause menu — dialogue is UI, the world
  // is frozen. state.dt is in 60fps units (1 per 16.67ms).
  function updateDialogue(state) {
    try {
      HydraDialogue.updateDialogue(state.dialogue, (state.dt || 0) / 60, dialogueHooks(state));
    } catch (e) { /* a throwing dialogue update never breaks the frame */ }
  }

  // P4 Advanced batch 11 (cutscenes): the hooks the shared
  // HydraCutscene module needs — warnings through the run
  // diagnostics, the pause freeze (a cutscene moves the world, so it
  // holds while paused), live object positions/text by name (hidden
  // objects excluded, like named()), sound playback by asset name
  // (false when no asset carries that name, so the module warns
  // instead of playing the fallback tone), and scene switches by
  // name or id through the same deferred switch the blocks use.
  // Mirrors the editor preview's cutsceneHooks exactly so preview
  // and exported games agree.
  function cutsceneHooks(state) {
    return {
      warn: (msg) => reportRuntimeDiagnostic(state, 'warning', msg),
      paused: HydraPause.isPaused(state),
      getObjectPosition: (name) => {
        const o = named(state, name)[0];
        return o ? { x: o.posX, y: o.posY } : null;
      },
      setObjectPosition: (name, x, y) => {
        named(state, name).forEach(o => { o.posX = x; o.posY = y; });
      },
      setObjectText: (name, text) => {
        named(state, name).forEach(o => { if (o.kind === 'text') o._runtimeText = text; });
      },
      playSound: (name) => {
        const assets = state.assets || {};
        let assetId = '';
        for (const id of Object.keys(assets)) {
          if (assets[id] && assets[id].name === name) { assetId = id; break; }
        }
        if (!assetId) return false;
        playSound(state, { assetId: assetId });
        return true;
      },
      switchScene: (name) => {
        const scenes = state.scenes || [];
        const byName = scenes.find(s => s && s.name === name);
        if (byName) { requestSceneChange(state, byName.id); return true; }
        const asNum = Number(name);
        if (Number.isFinite(asNum) && scenes.some(s => s && s.id === asNum)) {
          requestSceneChange(state, asNum);
          return true;
        }
        return false;
      }
    };
  }

  // P4 Advanced batch 11 (cutscenes): advance the running cutscene
  // one frame. Called from the runScripts phase (before the grids run,
  // so a condition reading the cutscene sees this frame's step); it
  // freezes while paused — the module returns early on the hooks'
  // paused flag, like the world sim. state.dt is in 60fps units
  // (1 per 16.67ms).
  function updateCutscene(state) {
    try {
      HydraCutscene.updateCutscene(state.cutscene, state.cutscenes, (state.dt || 0) / 60, cutsceneHooks(state));
    } catch (e) { /* a throwing cutscene update never breaks the frame */ }
  }

  // P4 Advanced batch 14 (scene transitions): the hooks the shared
  // HydraTransition module needs — warnings through the run
  // diagnostics, the pause freeze (a transition moves the world, so
  // it holds while paused), scene existence by name or id (so a typo
  // warns at the block instead of fading to nowhere), and scene
  // switches by name or id through the same deferred switch the
  // cutscene step uses (the switch applies at the end of the frame,
  // before the draw, so the fade-in starts over the new scene).
  // Mirrors the editor preview's transitionHooks exactly so preview
  // and exported games agree.
  function transitionHooks(state) {
    return {
      warn: (msg) => reportRuntimeDiagnostic(state, 'warning', msg),
      paused: HydraPause.isPaused(state),
      sceneExists: (target) => {
        const scenes = state.scenes || [];
        const want = String(target == null ? '' : target).trim();
        if (!want) return false;
        if (scenes.some(s => s && s.name === want)) return true;
        const asNum = Number(want);
        return Number.isFinite(asNum) && scenes.some(s => s && s.id === asNum);
      },
      switchScene: (name) => cutsceneHooks(state).switchScene(name)
    };
  }

  // P4 Advanced batch 14 (scene transitions): advance the running
  // transition one frame. Called from the runScripts phase before
  // the cutscene update (before the grids run, so a condition
  // reading the transition sees this frame's phase); it freezes
  // while paused — the module returns early on the hooks' paused
  // flag, like the world sim. state.dt is in 60fps units
  // (1 per 16.67ms), already scaled by the time scale, so a
  // transition slows with the world like a cutscene does.
  function updateTransition(state) {
    try {
      HydraTransition.updateTransition(state.transition, state.transitionConfig, (state.dt || 0) / 60, transitionHooks(state));
    } catch (e) { /* a throwing transition update never breaks the frame */ }
  }

  // Runtime diagnostics: unknown block types, bad expressions, and other
  // data problems are reported once per message instead of failing silently.
  // Visible via console.warn and a badge on the exported game's HUD.
  function reportRuntimeDiagnostic(state, kind, message) {
    if (state.reportedDiagnostics.has(message)) return;
    state.reportedDiagnostics.add(message);
    state.diagnostics.push({ kind, message, frame: state.frameId });
    if (typeof console !== 'undefined' && console.warn) console.warn('[HydraScript ' + kind + ']', message);
    updateHudBadge(state);
  }

  function updateHudBadge(state) {
    try {
      if (typeof document === 'undefined' || !document.getElementById) return;
      const hud = document.getElementById('hydra-hud');
      if (!hud) return;
      const n = state.diagnostics.length;
      const title = (state.project && state.project.name) ? state.project.name : 'Hydra Game';
      hud.textContent = title + '  —  ⚠ ' + n + ' warning' + (n === 1 ? '' : 's') + ' (see console)';
    } catch (e) { /* HUD badge is best-effort */ }
  }

  // P4 item 31: tilemap conditions (mirror the editor preview).
  function tilemapsNamed(state, name) {
    return named(state, name).filter(o => o.kind === 'tilemap' && !state.destroyed.has(o.id));
  }

  // P4 item 37 (block expansion, batch 5: camera). Zoom lives on the camera
  // state. 1 is normal; the Set Camera Zoom block clamps to 0.25-4 and bad
  // values fall back to 1, so rendering math never sees 0/NaN/negative.
  function normalizeCameraZoom(value) {
    const z = Number(value);
    return Number.isFinite(z) ? Math.min(4, Math.max(0.25, z)) : 1;
  }

  // P4 item 37 batch 9 (timers): read-only elapsed-seconds helper shared by
  // evalTimerElapsed and the shared HydraExecute module's readTimer.
  // Never creates a timer record — a timer that was never started reads
  // as 0. Frozen game clock, so elapsed holds while paused (mirrors
  // evalTimer); the module's controlTimer honors per-timer pause through
  // record.paused/pausedAt.
  function namedTimerElapsedSeconds(state, key, now) {
    const record = state.timers.get(key);
    if (!record || typeof record !== 'object') return 0;
    const elapsed = record.paused
      ? (record.pausedAt || now) - record.lastFiredTime
      : now - record.lastFiredTime;
    return Math.max(0, elapsed / 1000);
  }

  // P2 item 15/12 slice 9 (shared engine): the context the shared
  // HydraExecute module needs from the exported runtime — one builder so
  // the execute call site can never drift from the condition builder's.
  // The module owns the per-block action switch; the host only describes
  // its live run state. The export hard-guards on the module at load.
  function actionCtx(state) {
    return {
      variables: state.variables,
      objects: state.objects,
      hidden: state.hidden,
      pendingDestroy: state.pendingDestroy,
      destroyed: state.destroyed,
      executionContext: state.executionContext,
      // P5-4 slice b (for-each): the loop runner points the
      // execution context at each object in turn, so body actions
      // that target the object's name hit that one object; the
      // runner restores the previous context after every round.
      setExecutionContext: function (c) { state.executionContext = c; },
      dt: state.dt,
      camera: state.camera,
      canvasWidth: state.canvas ? state.canvas.width : 0,
      canvasHeight: state.canvas ? state.canvas.height : 0,
      named: function (name, includeHidden) { return named(state, name, includeHidden); },
      allObjects: function () { return state.objects.filter(function (o) { return !state.destroyed.has(o.id) && !state.pendingDestroy.has(o.id); }); },
      hitbox: hitbox,
      getPhysics: getPhysics,
      isCollisionObject: isCollisionObject,
      expr: function (value) { return expr(state, value); },
      exprInfo: function (value) { return exprInfo(state, value); },
      random: Math.random,
      worldSize: function () { var s = getScene(state); return s ? { width: s.worldWidth, height: s.worldHeight } : null; },
      getScene: function () { return getScene(state); },
      sceneObjectDefs: function () { var s = getScene(state); return s ? (s.objects || []) : []; },
      scenes: state.scenes,
      sceneId: state.sceneId,
      pendingSceneId: state.pendingSceneId,
      requestScene: function (id) { state.pendingSceneId = id; },
      sceneStack: state.sceneStack,
      clampCamera: function () { clampCamera(state); },
      updateCameraFollow: function () { updateCameraFollow(state); },
      shake: state.shake,
      flash: state.flash,
      cameraFx: HydraCameraFx,
      warn: function (msg) { reportRuntimeDiagnostic(state, 'warning', msg); },
      warnFlashColor: function (color) { reportRuntimeDiagnostic(state, 'warning', 'Screen Flash: the color "' + color + '" is not a valid hex color, so the flash was skipped. Use a color like #ffffff.'); },
      warnReadTimerBlank: function (which) {
        reportRuntimeDiagnostic(state, 'warning', which === 'variable'
          ? 'Read Timer skipped: the variable name is blank. Name the variable that should receive the elapsed seconds.'
          : 'Read Timer: the timer name is blank, so it read 0 seconds. Name the timer you want to read.');
      },
      reportUnknown: function (type) { reportRuntimeDiagnostic(state, 'warning', 'Unknown action block type "' + type + '" — skipping.'); },
      playSound: function (data, idx) { playSound(state, data); },
      stopMusic: function () { stopExportMusic(state); },
      pauseMusic: function () { pauseExportMusic(state); },
      resumeMusic: function () { resumeExportMusic(state); },
      stopAllSounds: function () { stopAllExportSounds(state); },
      buses: state.buses,
      audioBuses: HydraAudioBuses,
      setMasterVolume: function (v) { state.masterVolume = v; },
      save: HydraSave,
      storage: (function () { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; } })(),
      pause: HydraPause,
      pauseState: state,
      profile: HydraProfile,
      profilerState: state.profiler,
      particles: HydraParticles,
      particleState: state.particles,
      ensureParticles: function () { return state.particles || (state.particles = HydraParticles.createParticleState()); },
      actions: HydraActions,
      actionsState: state.actions,
      tiles: HydraTiles,
      anim: HydraAnim,
      stateMachine: HydraStateMachine,
      blendSpace: HydraBlendSpace,
      tween: HydraTween,
      collections: HydraCollections,
      math: HydraMath,
      layerFx: HydraLayerFx,
      threeD: Hydra3d,
      light2d: HydraLight2d,
      joints: HydraJoints,
      skeleton: HydraSkeleton,
      localization: HydraLocalization,
      scriptApi: HydraScriptApi,
      sceneInit: HydraSceneInit,
      physics2d: HydraPhysics2D,
      collectionHooks: function () { return collectionHooks(state); },
      mathHooks: function () { return mathHooks(state); },
      layerFxActionHooks: function (data) { return layerFxActionHooks(state, data); },
      threeDActionHooks: function (data) { return threeDActionHooks(state, data); },
      light2dActionHooks: function (data) { return light2dActionHooks(state, data); },
      jointActionHooks: function (data) { return jointActionHooks(state, data); },
      scriptApiHooks: function () { return scriptApiHooks(state); },
      sceneInitHooks: function () {
        return {
          anim: HydraAnim,
          stateMachine: HydraStateMachine,
          blendSpace: HydraBlendSpace,
          skeleton: HydraSkeleton,
          warn: function (msg) { reportRuntimeDiagnostic(state, 'warning', msg); }
        };
      },
      stateMachineHooks: function (obj) {
        return {
          warn: function (msg) { reportRuntimeDiagnostic(state, 'warning', msg); },
          play: function (animName, speed) { HydraAnim.play(obj._anim, obj, animName); HydraAnim.setSpeed(obj._anim, speed); }
        };
      },
      timers: state.timers,
      nowMs: function () { return performance.now(); },
      frozenNowMs: function () { return HydraPause.gameNow(state, performance.now()); },
      timerElapsedSeconds: function (key, now) { return namedTimerElapsedSeconds(state, key, now); },
      localizationTable: state.localization,
      getLanguage: function () { return state.language; },
      setLanguage: function (code) { state.language = code; },
      applyBoundTexts: function () {
        (state.objects || []).forEach(function (o) {
          var bound = HydraLocalization.boundTextFor(o, state.localization, state.language);
          if (bound !== null) o._runtimeText = bound;
        });
      },
      dialogueModule: HydraDialogue,
      dialogue: state.dialogue,
      dialogues: state.dialogues,
      dialogueHooks: function () { return dialogueHooks(state); },
      inventoryModule: HydraInventory,
      inventory: state.inventory,
      items: state.items,
      inventoryHooks: function () { return { warn: function (msg) { reportRuntimeDiagnostic(state, 'warning', msg); } }; },
      questModule: HydraQuest,
      questLog: state.questLog,
      quests: state.quests,
      questHooks: function () { return { warn: function (msg) { reportRuntimeDiagnostic(state, 'warning', msg); } }; },
      achievementModule: HydraAchievement,
      achievementLog: state.achievementLog,
      achievements: state.achievements,
      achievementHooks: function () {
        return {
          warn: function (msg) { reportRuntimeDiagnostic(state, 'warning', msg); },
          persist: function () {
            try {
              var storage = HydraAchievement.safeStorage();
              if (storage && typeof storage.setItem === 'function') {
                storage.setItem(state.achievementKey,
                  HydraAchievement.serializeUnlocked(state.achievementLog));
              }
            } catch (e) { /* a throwing persist never breaks the run */ }
          }
        };
      },
      cutsceneModule: HydraCutscene,
      cutscene: state.cutscene,
      cutscenes: state.cutscenes,
      cutsceneHooks: function () { return cutsceneHooks(state); },
      highScoreModule: HydraHighScore,
      highScoreTable: state.highScoreTable,
      highScoreConfig: state.highScoreConfig,
      highScoreHooks: function () {
        return {
          warn: function (msg) { reportRuntimeDiagnostic(state, 'warning', msg); },
          persist: function () {
            try {
              var storage = HydraHighScore.safeStorage();
              if (storage && typeof storage.setItem === 'function') {
                storage.setItem(state.highScoreKey,
                  HydraHighScore.serializeEntries(state.highScoreTable));
              }
            } catch (e) { /* a throwing persist never breaks the run */ }
          }
        };
      },
      timeScaleModule: HydraTimeScale,
      timeScale: state.timeScale,
      timeScaleHooks: function () {
        return {
          warn: function (msg) { reportRuntimeDiagnostic(state, 'warning', msg); }
        };
      },
      transitionModule: HydraTransition,
      transition: state.transition,
      transitionConfig: state.transitionConfig,
      transitionHooks: function () { return transitionHooks(state); },
      // P4 Advanced batch 15 (camera feel): the module, the live feel
      // record (a getter — the record is replaced on every scene load,
      // so the execute module must read it fresh each call), and the
      // Reset Camera feel restore.
      cameraFeelModule: HydraCameraFeel,
      cameraFeel: function () { return state.cameraFeel || null; },
      // P4 Advanced batch 16 (parallax backgrounds): the module the
      // Set Parallax action writes the live objects' factors through.
      parallaxModule: HydraParallax,
      // P4 Advanced batch 17 (positional audio): the module the Play
      // Sound at Position action mixes its volume and pan through.
      spatialAudioModule: HydraSpatialAudio,
      // P4 Advanced batch 18 (pathfinding): the module the Follow Path /
      // Stop Path actions plan and walk through.
      pathfindModule: HydraPathfind,
      // P4 Advanced batch 19 (AI behaviors): the module the Set AI
      // Behavior / Stop AI actions write the behavior record through.
      aiModule: HydraAi,
      // P4 Advanced batch 20 (virtual joystick): the module the
      // Enable / Disable Joystick actions flip the live stick through.
      joystickModule: HydraJoystick,
      joystick: state.joystick,
      joystickConfig: state.joystickConfig,
      // P4 Advanced batch 21 (health & damage): the module the Damage /
      // Heal / Set Health / Set Max Health actions write the hit
      // points through.
      healthModule: HydraHealth,
      // P4 Advanced batch 22 (damage feedback): the module the Show
      // Damage Number / Make Invincible / Knockback Object actions run
      // through, and the live floating-number state (created lazily, so
      // a game that never shows a number never pays for the list).
      damageFxModule: HydraDamageFx,
      damageNumbers: state.damageNumbers,
      ensureDamageNumbers: function () { return state.damageNumbers || (state.damageNumbers = HydraDamageFx.createDamageNumberState()); },
      // P4 Advanced batch 23 (checkpoints & respawn): the module the
      // Set Checkpoint / Respawn Object / Clear Checkpoint actions
      // run through, and the live respawn state (created lazily, so a
      // game that never sets a checkpoint never pays for the record).
      respawnModule: HydraRespawn,
      respawn: state.respawn,
      ensureRespawnState: function () { return state.respawn || (state.respawn = HydraRespawn.createRespawnState()); },
      // P4 Advanced batch 24 (enemy spawner): the module the Start
      // Spawner / Stop Spawner / Read Spawned Count actions run
      // through, and the live spawner state (created lazily, so a game
      // that never starts a spawner never pays for the record).
      spawnModule: HydraSpawn,
      spawners: state.spawners,
      ensureSpawnerState: function () { return state.spawners || (state.spawners = HydraSpawn.createSpawnerState()); },
      // P4 Advanced batch 25 (lives & game over): the module the Set /
      // Add / Lose / Read Lives actions run through, and the live lives
      // state (a fresh count on boot; it survives scene switches
      // inside the run).
      livesModule: HydraLives,
      lives: state.lives,
      // P4 Advanced batch 26 (movement abilities): the module the Jump /
      // Dash / Set Max Jumps / Set Coyote Time / Set Jump Buffer actions
      // run through, and the live movement state (fresh per scene load).
      movementModule: HydraMovement,
      movement: state.movement,
      ensureMovementState: function () { return state.movement || (state.movement = HydraMovement.createMovementState()); },
      // P4 Advanced batch 27 (moving platforms & one-way platforms):
      // the module the Set Platform Path / Set One-Way Platform /
      // Set Crumble Time actions run through, and the live platform
      // state (fresh per scene load).
      platformModule: HydraPlatform,
      platform: state.platform,
      ensurePlatformState: function () { return state.platform || (state.platform = HydraPlatform.createPlatformState()); },
      // P4 Advanced batch 29 (combat): the module the Melee Attack /
      // Shoot Projectile actions run through, and the live combat
      // state (fresh per scene load).
      combatModule: HydraCombat,
      combat: state.combat,
      ensureCombatState: function () { return state.combat || (state.combat = HydraCombat.createCombatState()); },
      // P4 Advanced batch 30 (experience & leveling): the module the
      // Add / Set / Read XP blocks run through, and the live XP state
      // (a fresh total on boot; it survives scene switches inside the
      // run).
      xpModule: HydraXp,
      xp: state.xp,
      // P4 Advanced batch 31 (level-up rewards & stat growth): the
      // module the Grow / Level Reward / Read Bonus blocks run
      // through, and the live growth state (fresh bonuses on boot;
      // they survive scene switches inside the run).
      growthModule: HydraGrowth,
      growth: state.growth,
      // P4 Advanced batch 32 (enemy scaling with the hero's level):
      // the module the Set Enemy Level / Set Scaling Rates / Scale
      // to Hero Level / Read blocks run through, and the live scaling
      // state (fresh levels on boot; they survive scene switches
      // inside the run).
      scalingModule: HydraScaling,
      scaling: state.scaling,
      // P4 Advanced batch 33 (boss encounters): the module the Start
      // / End / Show / Hide / Read Boss Phase blocks run through,
      // and the live boss state (fresh on boot; it survives scene
      // switches inside the run).
      bossModule: HydraBoss,
      boss: state.boss,
      // P4 Advanced batch 34 (object tags): the module the Add /
      // Remove / Clear Tag / Read Tagged Count blocks run through.
      // Tags live on the objects themselves, so there is no per-run
      // tags state.
      tagsModule: HydraTags,
      // P4 Advanced batch 36 (minimap): the module the Show / Hide /
      // Set Minimap Size / Set Minimap Zoom blocks run through, and
      // the live minimap run record (fresh per scene load, re-minted
      // from the scene's config in loadScene).
      minimapModule: HydraMinimap,
      minimap: state.minimap,
      // P4 Advanced batch 37 (object parenting): the module the
      // Attach / Detach / Set Attachment Offset blocks run through,
      // and the live link table they write (fresh per scene load,
      // re-minted in loadScene).
      attachModule: HydraAttach,
      attachments: state.attachments,
      // P5 core-engine track, item P5-1 (Variables v2, slice a):
      // the module the Set / Read / Delete / Clear Scoped Variable
      // actions run through, and the live scoped-variable state.
      varScopesModule: HydraVariables,
      varScopes: state.varScopes,
      // P5 core-engine track, item P5-3 (Functions / custom blocks,
      // slice a): the module the Call Function / Return From Function
      // actions run through, and the host hooks that push a call
      // frame, run the body, and set the return value.
      functionsModule: HydraFunctions,
      callFunction: function (name, args) { return callFunction(state, name, args); },
      returnFromFunction: function (value) { return returnFromFunction(state, value); },
      // P5 core-engine track, item P5-4 (Control flow + events,
      // slice a): the module the Repeat / While / Break / Continue
      // actions run through, and the live loop state (depth, Break /
      // Continue flag, per-frame budget) they share.
      loopsModule: HydraLoops,
      loopState: state.loopState,
      // P5 core-engine track, item P5-4 (Control flow + events,
      // slice c): the module the Broadcast Event action runs through,
      // and the live event state (broadcast counts per name) it writes.
      eventsModule: HydraEvents,
      eventState: state.eventState,
      // P5 core-engine track, item P5-5 (Object primitives, slice a):
      // the module the Pick Object Into Variable action picks through,
      // and the live-object hooks it picks from.
      pick: HydraPick,
      pickHooks: function () { return pickHooks(state); },
      resetCameraFeel: function () {
        const s = getScene(state);
        state.cameraFeel = HydraCameraFeel.freshCameraFeel(s ? s.cameraFeel : null);
      }
    };
  }

  function execute(state, data, idx) {
    HydraExecute.executeAction(data, actionCtx(state), idx);
  }

  // P5-4 slice a (loops): the dispatch's executeLoop hook — a Repeat
  // / While block runs its body chain through here, with the body
  // runner the flow module built for it.
  function executeLoop(state, data, idx, runBody) {
    return HydraExecute.executeLoopAction(data, actionCtx(state), idx, runBody);
  }

  function targets(state, data, includeHidden = false) {
    const all = named(state, data.targetObject || '', includeHidden);
    if (!all.length) return [];
    if (data.targetMode === 'all') return all;
    if (data.targetMode === 'first') return all.slice(0, 1);
    const ctx = state.executionContext || {};
    const match = [ctx.obj1, ctx.obj2].find(o => o && o.name === (data.targetObject || '') && !state.destroyed.has(o.id));
    return match ? [match] : all.slice(0, 1);
  }

  function named(state, name, includeHidden = false) {
    // pendingDestroy counts as destroyed immediately: an object destroyed
    // earlier this frame must not be hittable, collidable, or targetable for
    // the rest of the frame.
    return state.objects.filter(o => o.name === name && !state.destroyed.has(o.id) && !state.pendingDestroy.has(o.id) && (includeHidden || !state.hidden.has(o.id)));
  }

  // P4 item 37 batch 6 (collections): hooks the shared HydraCollections
  // module needs to evaluate expressions, warn, and read variables — the
  // same contract the editor preview supplies, so preview and export agree.
  function collectionHooks(state) {
    return {
      num: (raw) => exprInfo(state, raw),
      warn: (msg) => reportRuntimeDiagnostic(state, 'warning', msg),
      lookupVar: (name) => state.variables[name]
    };
  }

  // P4 item 37 batch 10 (math/random): hooks the shared HydraMath module
  // needs to evaluate expressions, warn, and read variables — the same
  // contract the editor preview supplies, so preview and export agree.
  function mathHooks(state) {
    return {
      num: (raw) => exprInfo(state, raw),
      warn: (msg) => reportRuntimeDiagnostic(state, 'warning', msg),
      lookupVar: (name) => state.variables[name]
    };
  }

  // P4 item 37 batch 11 (object picking and selection): hooks the shared
  // HydraPick module needs — live objects by name (destroyed/pending-destroy
  // excluded, like every other export lookup), expression evaluation, and
  // diagnostics. Mirrors the editor preview's pickHooks exactly.
  // P4 Advanced batch 35 (pick objects by tag): liveObjectsByTag hands
  // the tag picks their candidates — the live objects carrying the tag,
  // filtered through HydraTags.
  function pickHooks(state) {
    return {
      liveObjects: (name) => named(state, name),
      liveObjectsByTag: (tag) => {
        try {
          return HydraTags.objectsWithTag(state.objects.filter(o => o && typeof o === 'object' &&
            !state.destroyed.has(o.id) && !state.pendingDestroy.has(o.id)), tag);
        } catch (e) { return []; }
      },
      num: (raw) => exprInfo(state, raw),
      warn: (msg) => reportRuntimeDiagnostic(state, 'warning', msg)
    };
  }

  // P4 item 37 batch 12 (layers and effects): hooks the shared HydraLayerFx
  // module needs. Actions resolve targets through the normal context-aware
  // lookup, so picking works (Pick Nearest -> Bring to Front hits only the
  // picked object); front/back bounds read every live object. Mirrors the
  // editor preview's hooks exactly.
  function layerFxActionHooks(state, data) {
    return {
      targets: () => targets(state, data),
      allObjects: () => state.objects.filter(o => o && typeof o === 'object' &&
        !state.destroyed.has(o.id) && !state.pendingDestroy.has(o.id)),
      num: (raw) => exprInfo(state, raw),
      warn: (msg) => reportRuntimeDiagnostic(state, 'warning', msg)
    };
  }
  function layerFxConditionHooks(state) {
    return {
      targets: (data) => named(state, data.targetObject || ''),
      allObjects: () => [],
      num: (raw) => exprInfo(state, raw),
      warn: (msg) => reportRuntimeDiagnostic(state, 'warning', msg)
    };
  }
  // P4 item 3D1 (3D rendering foundation): hooks the shared Hydra3d module
  // needs — context-aware action targets (so picking works), named-object
  // lookup for the distance condition, expression evaluation, diagnostics,
  // and the live 3D camera (mutated in place by Set 3D Camera). Mirrors the
  // editor preview's hooks exactly.
  // P4 Advanced (2D lighting): the hooks the shared HydraLight2d module
  // needs — targets resolve like every other action, expressions go
  // through the shared evaluator, warnings surface as runtime
  // diagnostics, darkness reads the live scene.
  function light2dActionHooks(state, data) {
    return {
      targets: () => targets(state, data),
      num: (raw) => exprInfo(state, raw),
      warn: (msg) => reportRuntimeDiagnostic(state, 'warning', msg),
      scene: () => getScene(state)
    };
  }

  function light2dConditionHooks(state) {
    return {
      num: (raw) => exprInfo(state, raw),
      darkness: () => {
        const s = getScene(state);
        if (!s) return 0;
        HydraLight2d.normalizeSceneDarkness(s);
        return s.darkness || 0;
      }
    };
  }

  // P4 Advanced (physics joints): the hooks the shared HydraJoints
  // module needs — the live scene's joint list, the live objects for
  // endpoint lookup, expressions, and runtime diagnostics. Mirrors the
  // editor preview's hooks exactly.
  function jointActionHooks(state, data) {
    return {
      scene: () => getScene(state),
      objects: () => state.objects.filter(o => !state.destroyed.has(o.id) && !state.pendingDestroy.has(o.id)),
      num: (raw) => exprInfo(state, raw),
      warn: (msg) => reportRuntimeDiagnostic(state, 'warning', msg)
    };
  }

  function jointConditionHooks(state) {
    return { scene: () => getScene(state) };
  }

  function threeDActionHooks(state, data) {
    return {
      targets: () => targets(state, data),
      num: (raw) => exprInfo(state, raw),
      warn: (msg) => reportRuntimeDiagnostic(state, 'warning', msg),
      objectsByName: (name) => named(state, name || ''),
      camera3d: () => state.camera3d,
      // P4 item 3D1 batch 2 (3D camera follow): runtime follow state lives
      // next to the live camera, never in scene.camera3d, so it cannot
      // leak into saved project JSON. Mirrors the editor preview's hooks.
      setFollow3d: (follow) => { state.camera3dFollow = follow; },
      // P4 item 3D3 (character controllers): pointer-lock + mouse-delta
      // host hooks. The module never touches the DOM; the host owns the
      // browser calls. Mirrors the editor preview's hooks.
      captureMouse: () => {
        try {
          const c = state.canvas;
          if (c && typeof c.requestPointerLock === 'function') {
            c.requestPointerLock();
            return true;
          }
        } catch (e) {}
        return false;
      },
      releaseMouse: () => {
        try { if (document.exitPointerLock && document.pointerLockElement) document.exitPointerLock(); } catch (e) {}
      },
      pointerLocked: () => {
        try { return document.pointerLockElement === state.canvas; } catch (e) { return false; }
      },
      readMouseDelta: () => ({ x: state.mouseDelta.x, y: state.mouseDelta.y }),
      setVar: (name, value) => { state.variables[name] = value; },
      // P4 item 3D4 (3D physics): the shared module's 3D On Ground / 3D
      // Collision conditions are world-dependent, so they report the
      // paused freeze through this hook instead of stale state (the
      // 2D collision/onFloor convention).
      paused: () => HydraPause.isPaused(state)
    };
  }
  function threeDConditionHooks(state) {
    return threeDActionHooks(state, {});
  }

  // P4 item 30: audio-bus playback helpers for exported games.
  // Same semantics as the editor preview: music streams through an <audio>
  // element (never decoded into memory); SFX/UI assets are decoded once
  // into an AudioBuffer and kept memory-resident; tones use an oscillator.
  function busReleaseOnce(releaseFn) {
    let released = false;
    return () => { if (!released) { released = true; try { releaseFn(); } catch (e) {} } };
  }

  // P4 Advanced batch 17 (positional audio): a StereoPannerNode for
  // one positioned sound, or null when there is nothing to pan (pan 0
  // is centered, and an old browser without createStereoPanner just
  // plays centered). The caller wires gain -> panner -> destination,
  // or gain -> destination when this returns null.
  function exportPanner(state, rawPan) {
    try {
      const pan = HydraSpatialAudio.normalizePan(rawPan);
      if (!pan) return null;
      const actx = state.audioCtx;
      if (!actx || typeof actx.createStereoPanner !== 'function') return null;
      const panner = actx.createStereoPanner();
      panner.pan.value = pan;
      return panner;
    } catch (e) { return null; }
  }

  function exportTone(state, data, volume, pitch, onDone) {
    const done = busReleaseOnce(onDone);
    try {
      state.audioCtx = state.audioCtx || new (global.AudioContext || global.webkitAudioContext)();
      const osc = state.audioCtx.createOscillator();
      const gain = state.audioCtx.createGain();
      osc.type = data.waveform || 'square';
      osc.frequency.value = (data.frequency || 440) * pitch;
      gain.gain.value = volume;
      const dur = data.duration || 0.2;
      gain.gain.exponentialRampToValueAtTime(0.001, state.audioCtx.currentTime + dur);
      const panner = exportPanner(state, data.pan);
      osc.connect(gain);
      if (panner) { gain.connect(panner); panner.connect(state.audioCtx.destination); }
      else gain.connect(state.audioCtx.destination);
      try { osc.onended = done; } catch (e) {}
      osc.start(); osc.stop(state.audioCtx.currentTime + dur);
      // P4 item 37 batch 3: register a stopper for the Stop All Sounds block.
      (state.liveSoundStoppers = state.liveSoundStoppers || []).push({ stop() { try { osc.stop(); } catch (e) {} } });
      setTimeout(done, dur * 1000 + 50);
    } catch (e) { done(); }
  }

  function exportSfxBuffer(state, dataUrl, volume, pitch, onDone, pan) {
    const done = busReleaseOnce(onDone);
    const playBuf = (buf) => {
      try {
        const src = state.audioCtx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = pitch;
        const gain = state.audioCtx.createGain();
        gain.gain.value = volume;
        const panner = exportPanner(state, pan);
        src.connect(gain);
        if (panner) { gain.connect(panner); panner.connect(state.audioCtx.destination); }
        else gain.connect(state.audioCtx.destination);
        try { src.onended = done; } catch (e) {}
        src.start();
        // P4 item 37 batch 3: stopper for the Stop All Sounds block.
        (state.liveSoundStoppers = state.liveSoundStoppers || []).push({ stop() { try { src.stop(); } catch (e) {} } });
        setTimeout(done, 60000);
      } catch (e) { done(); }
    };
    try {
      const cached = state.sfxBufferCache.get(dataUrl);
      if (cached) { playBuf(cached); return; }
      const bytes = HydraAudioBuses.decodeDataUrl(dataUrl);
      if (!bytes) {
        const el = new global.Audio(dataUrl);
        el.volume = volume; el.playbackRate = pitch;
        el.addEventListener('ended', done);
        const playResult = el.play();
        if (playResult && typeof playResult.catch === 'function') playResult.catch(function () {});
        // P4 item 37 batch 3: stopper for the Stop All Sounds block.
        (state.liveSoundStoppers = state.liveSoundStoppers || []).push({ stop() { try { el.pause(); } catch (e) {} } });
        setTimeout(done, 60000);
        return;
      }
      state.audioCtx = state.audioCtx || new (global.AudioContext || global.webkitAudioContext)();
      state.audioCtx.decodeAudioData(bytes.buffer, function (buf) {
        if (buf) { state.sfxBufferCache.set(dataUrl, buf); playBuf(buf); } else done();
      }, function () { done(); });
    } catch (e) { done(); }
  }

  function stopExportMusic(state) {
    try {
      const els = state.musicElements || [];
      state.musicElements = [];
      els.forEach(el => { try { el.pause(); } catch (e) {} });
      state.musicPaused = false;
      if (state.busVoices) {
        while (state.busVoices.counts.music > 0) HydraAudioBuses.release(state.busVoices, 'music');
      }
    } catch (e) {}
  }

  // P4 item 37 batch 3: pause/resume keep the track's position
  // (element-only; a tone played on the music bus cannot pause).
  function pauseExportMusic(state) {
    try {
      (state.musicElements || []).forEach(el => { try { el.pause(); } catch (e) {} });
      state.musicPaused = true;
    } catch (e) {}
  }

  function resumeExportMusic(state) {
    try {
      (state.musicElements || []).forEach(el => {
        try {
          const playResult = el.play();
          if (playResult && typeof playResult.catch === 'function') playResult.catch(function () {});
        } catch (e) {}
      });
      state.musicPaused = false;
    } catch (e) {}
  }

  // P4 item 37 batch 3: silences everything currently playing — the music
  // track plus every live SFX/UI voice — and frees all voices at once.
  function stopAllExportSounds(state) {
    stopExportMusic(state);
    try {
      const stoppers = state.liveSoundStoppers || [];
      state.liveSoundStoppers = [];
      stoppers.forEach(s => { try { s.stop(); } catch (e) {} });
      if (state.busVoices) HydraAudioBuses.releaseAll(state.busVoices);
    } catch (e) {}
  }

  function playSound(state, data) {
    try {
      const busId = HydraAudioBuses.normalizeBusId(data.bus);
      if (!state.busVoices) state.busVoices = HydraAudioBuses.createVoices(state.buses);
      const volume = HydraAudioBuses.effectiveVolume(state.buses, busId, HydraAudio.normalizeVolume(data.volume), state.masterVolume);
      if (volume <= 0) return; // muted bus (or bus at 0): stay silent, take no voice
      const pitch = HydraAudioBuses.normalizePitch(data.pitch);
      const loop = data.loop === undefined ? busId === 'music' : !!data.loop;
      const source = HydraAudio.resolveSoundSource(state.assets, data);
      if (busId === 'music') {
        // Music bus: one voice; a new track replaces the running one.
        stopExportMusic(state);
        if (!HydraAudioBuses.tryAcquire(state.busVoices, 'music')) return;
        state.musicPaused = false;
        const releaseMusic = busReleaseOnce(() => HydraAudioBuses.release(state.busVoices, 'music'));
        if (source.kind === 'asset') {
          // Uploaded audio asset (bundled into the export as a data URL):
          // streams through an <audio> element, never decoded into memory.
          const el = new global.Audio(source.dataUrl);
          el.volume = volume; el.playbackRate = pitch; el.loop = loop;
          el.addEventListener('ended', releaseMusic);
          state.musicElements.push(el);
          const playResult = el.play();
          if (playResult && typeof playResult.catch === 'function') playResult.catch(function () {});
        } else {
          exportTone(state, data, volume, pitch, releaseMusic);
        }
        return;
      }
      if (!HydraAudioBuses.tryAcquire(state.busVoices, busId)) return; // polyphony cap: drop the sound
      const releaseVoice = busReleaseOnce(() => HydraAudioBuses.release(state.busVoices, busId));
      // P4 Advanced batch 17 (positional audio): data.pan rides in
      // from Play Sound at Position (the execute module sets it from
      // the spatial mix); a plain Play Sound has no pan and plays
      // centered, exactly as before. A streamed <audio> element has
      // no panner node, so an element-fallback asset gets the distance
      // volume only — the pan is a WebAudio-graph feature.
      if (source.kind === 'asset') exportSfxBuffer(state, source.dataUrl, volume, pitch, releaseVoice, data.pan);
      else exportTone(state, data, volume, pitch, releaseVoice);
    } catch {}
  }

  // Scene changes are deferred to end of frame (see loop): swapping mid-frame
  // would let the remaining actions of the old scene run against the new
  // scene's objects.
  function requestSceneChange(state, sceneId) {
    const target = state.scenes.find(s => s.id === Number(sceneId));
    if (!target) return;
    const effective = state.pendingSceneId ?? state.sceneId;
    if (target.id === effective) return;
    state.pendingSceneId = target.id;
  }

  // P5-7: the export runtime's old local getActionIndexes /
  // adjacentIndexes are deleted. getActionIndexes was dead (no caller —
  // the dispatch runs through HydraDispatch + HydraFlow) and its local
  // adjacentIndexes capped rows at 60, so a tall grid lost every
  // down-link past row 60 in the export while the preview had already
  // fixed it elsewhere. Both runtimes now resolve flow adjacency
  // through HydraFlow.adjacentIndexes only.

  function expr(state, value) {
    return exprInfo(state, value).value;
  }

  function exprInfo(state, value) {
    var scene = getScene(state);
    return HydraExpr.evaluate(value, {
      lookupObject: function (name) { return named(state, name, true)[0] || null; },
      builtins: {
        mouseX: state.mouse.x,
        mouseY: state.mouse.y,
        // P4 item 37 batch 5 (camera): screen pixels shrink by the zoom.
        mouseWorldX: state.mouse.x / normalizeCameraZoom(state.camera.zoom) + state.camera.x,
        mouseWorldY: state.mouse.y / normalizeCameraZoom(state.camera.zoom) + state.camera.y,
        canvasWidth: state.canvas.width,
        canvasHeight: state.canvas.height,
        viewportWidth: scene.viewportWidth,
        viewportHeight: scene.viewportHeight,
        sceneWidth: scene.worldWidth,
        sceneHeight: scene.worldHeight,
        worldWidth: scene.worldWidth,
        worldHeight: scene.worldHeight,
        cameraX: state.camera.x,
        cameraY: state.camera.y,
        cameraZoom: normalizeCameraZoom(state.camera.zoom),
        dt: state.dt
      },
      variables: state.variables,
      onWarning: function (msg) { state.lastExpressionWarning = msg; }
    });
  }

  function updateCameraFollow(state) {
    // P4 item 37 batch 5 (camera): keep the zoom valid even if the live
    // state was corrupted by hand — the Set Camera Zoom block itself can
    // only ever produce 0.25-4 (expressions never evaluate to NaN).
    state.camera.zoom = normalizeCameraZoom(state.camera.zoom);
    if (!state.camera.followTarget) return;
    const target = named(state, state.camera.followTarget, true)[0];
    if (!target) return;
    // P4 Advanced batch 15 (camera feel): the shared HydraCameraFeel
    // module parks the viewport — deadzone desire, smoothing glide,
    // bounds clamp — so the follow glides instead of snapping and
    // never shows past the room's bounds. dt is in 60fps units (1 per
    // 16.67ms), already scaled by the time scale, so a smoothed
    // follow slows with the world like a cutscene does. The scene
    // edges still clamp last (the module's no-bounds fallback), so a
    // bounds rectangle bigger than the scene behaves like the scene.
    const z = normalizeCameraZoom(state.camera.zoom);
    const scene = getScene(state);
    HydraCameraFeel.updateFollowCamera(state.camera,
      {
        x: target.posX + target.width / 2 + (state.camera.offsetX || 0),
        y: target.posY + target.height / 2 + (state.camera.offsetY || 0)
      },
      { width: state.canvas.width, height: state.canvas.height },
      z, state.cameraFeel, (state.dt || 0) / 60,
      scene ? { width: scene.worldWidth, height: scene.worldHeight } : null);
    clampCamera(state);
  }

  // P4 item 3D1 batch 2 (3D camera follow): one frame of Follow 3D Object
  // — the shared Hydra3d tick parks the live camera at the target's 3D
  // center + offset and aims it at the center. Called inside the unpaused
  // update so the follow freezes while paused, like 2D camera motion (F4).
  function update3dCameraFollow(state) {
    if (!Hydra3d || !state.camera3d || !state.camera3dFollow) return;
    Hydra3d.tick3dCameraFollow(
      state.camera3d,
      state.camera3dFollow,
      (name) => named(state, name, true)
    );
  }

  function clampCamera(state) {
    const scene = getScene(state);
    if (!scene) return;
    // P4 item 37 batch 5 (camera): the visible world shrinks as you zoom in.
    const z = normalizeCameraZoom(state.camera.zoom);
    state.camera.x = clamp(state.camera.x || 0, 0, Math.max(0, scene.worldWidth - scene.viewportWidth / z));
    state.camera.y = clamp(state.camera.y || 0, 0, Math.max(0, scene.worldHeight - scene.viewportHeight / z));
  }

  function image(state, assetId, bg) {
    if (!assetId || !state.assets[assetId]) return null;
    const cache = bg ? state.bgCache : state.imageCache;
    if (cache[assetId]) return cache[assetId];
    const img = new Image();
    // E1 web targets: records rewritten to {file} resolve to the relative
    // assets/<file> path; classic exports keep embedded data URLs.
    img.src = HydraAudio.assetUrl(state.assets[assetId]) || '';
    cache[assetId] = img;
    return img;
  }

  // P4 item 3D2 batch 2 (texture mapping): decode a parsed model's texture
  // images once per asset and hand the ready ones back as
  // { texIndex: Image }. Async — until an image lands the model draws with
  // flat colors; onload drops the fitted-mesh cache so the next frame
  // re-fits with the texture attached. Never throws.
  function modelTextures(state, id, doc) {
    const out = {};
    try {
      if (!state || !id || !doc || !Array.isArray(doc.textures) || !doc.textures.length) return out;
      if (typeof Image === 'undefined') return out;
      if (!state.modelTexCache) state.modelTexCache = {};
      let entry = state.modelTexCache[id];
      if (!entry) { entry = { images: {} }; state.modelTexCache[id] = entry; }
      doc.textures.forEach(function (tex, i) {
        if (!tex || !tex.bytes || !tex.bytes.length) return;
        const have = entry.images[i];
        if (have === 'failed') return;
        if (have && have.complete && have.naturalWidth > 0) { out[i] = have; return; }
        if (have) return; // decoding in flight
        try {
          const img = new Image();
          entry.images[i] = img;
          img.onload = function () {
            if (state.modelMeshCache) {
              Object.keys(state.modelMeshCache).forEach(function (k) {
                if (k.indexOf(id + '|') === 0) delete state.modelMeshCache[k];
              });
            }
          };
          img.onerror = function () { entry.images[i] = 'failed'; };
          img.src = 'data:' + (tex.mimeType || 'image/png') + ';base64,' +
            HydraGltf.bytesToBase64(tex.bytes);
        } catch (e) { entry.images[i] = 'failed'; }
      });
    } catch (e) { /* flat colors are the honest fallback */ }
    return out;
  }

  // P4 item 3D2: resolve a model3d object to a fitted hydra-3d mesh
  // { verts, tris, colors, cacheKey }, or null when the model is not ready
  // (missing asset, failed parse, or a {file} asset still downloading).
  // The 3D pass draws a placeholder box for null, so a missing model never
  // breaks the frame. Never throws.
  function modelMesh(state, obj) {
    try {
      if (!obj || obj.kind !== 'model3d' || !HydraGltf) return null;
      const id = obj.modelAssetId;
      if (!id || typeof id !== 'string') return null;
      const rec = state.assets && state.assets[id];
      if (!rec || typeof rec !== 'object') return null;
      const w = Math.max(1, Number(obj.width) || 120);
      const h = Math.max(1, Number(obj.height) || 120);
      const d = Math.max(1, Number(obj.depth) || 120);
      const entry = state.modelCache[id];
      if (entry && entry.status === 'ready' && entry.doc) {
        const key = id + '|' + w + '|' + h + '|' + d;
        let mesh = state.modelMeshCache[key];
        if (!mesh || mesh.doc !== entry.doc) {
          mesh = HydraGltf.fitModelToBox(entry.doc, w, h, d) || null;
          if (mesh) { mesh.cacheKey = key; mesh.doc = entry.doc; state.modelMeshCache[key] = mesh; }
        }
        // P4 item 3D2 batch 2: attach the decoded texture images (ready
        // ones only — the rest paint flat until their onload clears the
        // mesh cache and the next frame re-fits with them attached).
        if (mesh) { try { mesh.texImages = modelTextures(state, id, entry.doc); } catch (e) { mesh.texImages = {}; } }
        return mesh || null;
      }
      if (entry && (entry.status === 'loading' || entry.status === 'error')) return null;
      // Embedded data URL (classic single-file export): parse synchronously.
      const bytes = HydraGltf.modelAssetBytes(rec);
      if (bytes) {
        const parsed = HydraGltf.parseGlb(bytes);
        state.modelCache[id] = parsed && parsed.ok
          ? { status: 'ready', doc: parsed.model }
          : { status: 'error' };
        return modelMesh(state, obj); // re-enter: the ready branch fits + caches
      }
      // Web-target export: the record was rewritten to {file}; fetch the
      // bytes once, then parse. Until they arrive, the placeholder shows.
      const url = (typeof HydraAudio !== 'undefined' && HydraAudio.assetUrl)
        ? HydraAudio.assetUrl(rec) : '';
      if (url && typeof fetch === 'function') {
        state.modelCache[id] = { status: 'loading' };
        fetch(url).then(r => r.arrayBuffer()).then(buf => {
          let parsed = null;
          try { parsed = HydraGltf.parseGlb(new Uint8Array(buf)); } catch (e) { parsed = null; }
          state.modelCache[id] = parsed && parsed.ok
            ? { status: 'ready', doc: parsed.model }
            : { status: 'error' };
        }).catch(() => { state.modelCache[id] = { status: 'error' }; });
      } else {
        state.modelCache[id] = { status: 'error' };
      }
      return null;
    } catch (e) { return null; }
  }

  // P2 item 15/12 slice 6: the draw passes live in the shared
  // HydraDraw module (hydra-draw.js) — the full frame composition plus
  // the per-kind draws, used identically by the editor preview. This
  // wrapper only builds the host's view + hooks and keeps the shaken
  // render camera on state.renderCamera, exactly as the old inline
  // draw did; stepFrame calls draw(state) as a phase hook.
  function draw(state) {
    const result = HydraDraw.drawFrame(state.ctx, drawView(state), drawHooks(state));
    if (result && result.camera) state.renderCamera = result.camera;
    if (result && result.camera3d) state.camera3d = result.camera3d;
    // P4 Advanced batch 20 (virtual joystick): the stick paints in
    // screen space above the HUD objects, below the transition
    // overlay — it is a HUD control, so it sits on top of the game
    // but under the fade that covers a scene change.
    try { HydraJoystick.drawJoystick(state.ctx, state.joystick, state.joystickConfig, state.canvas.width, state.canvas.height); } catch (e) { /* a throwing stick never breaks the frame */ }
    // P4 Advanced batch 14 (scene transitions): the fade / wipe
    // overlay paints last, in screen space over the whole canvas
    // (the draw module leaves the transform at identity, and the
    // profiler overlay is the only thing drawn after — the overlay
    // is the transition, so it belongs on top of the game).
    try { HydraTransition.drawTransition(state.ctx, state.canvas.width, state.canvas.height, state.transition); } catch (e) { /* a throwing overlay never breaks the frame */ }
  }

  function drawView(state) {
    return {
      scene: getScene(state),
      objects: state.objects,
      width: state.canvas.width,
      height: state.canvas.height,
      camera: state.camera,
      shake: state.shake,
      flash: state.flash,
      particles: state.particles,
      damageNumbers: state.damageNumbers,
      combat: state.combat,
      profiler: state.profiler,
      camera3d: state.camera3d,
      hidden: state.hidden,
      destroyed: state.destroyed
    };
  }

  function drawHooks(state) {
    return {
      ui: HydraUi, tiles: HydraTiles, anim: HydraAnim, blendSpace: HydraBlendSpace,
      skeleton: HydraSkeleton, layerFx: HydraLayerFx, light2d: HydraLight2d,
      threeD: Hydra3d, cameraFx: HydraCameraFx, particles: HydraParticles, profile: HydraProfile,
      parallax: HydraParallax,
      health: HydraHealth,
      damageFx: HydraDamageFx,
      combat: HydraCombat,
      // P4 Advanced batch 33 (boss encounters): the boss bar's
      // module, live fight state, and the live boss object (the
      // first live object with the boss's name, or null when it has
      // not spawned yet — the draw module hides the bar then).
      boss: HydraBoss,
      bossState: state.boss,
      bossObject: (name) => named(state, name)[0] || null,
      // P4 Advanced batch 36 (minimap): the map's module and the
      // live minimap run record (fresh per scene load). The draw
      // module reads the boss state above for the red boss dot.
      minimap: HydraMinimap,
      minimapState: state.minimap,
      image: (assetId, isBackground) => image(state, assetId, isBackground),
      modelMesh: (obj) => modelMesh(state, obj),
      // The darkness overlay's offscreen canvas, created lazily and
      // guarded: vm-stubbed hosts (tests) return a context-less object
      // from createElement, so a failed creation skips the overlay
      // instead of breaking the frame.
      getDarkCanvas: () => {
        if (state.darkCanvas === undefined) {
          let dc = null;
          try {
            dc = (typeof document !== 'undefined' && document.createElement) ? document.createElement('canvas') : null;
            if (!dc || typeof dc.getContext !== 'function') dc = null;
          } catch (e) { dc = null; }
          state.darkCanvas = dc;
        }
        return state.darkCanvas;
      },
      // Button hover/press state from the live mouse (button 0 = left),
      // computed at draw time from the button's screen-space box.
      buttonState: (obj, sx, sy, scale) => buttonUiState(state, obj, sx, sy, scale)
    };
  }

  // F2: button hover/press state from the live mouse (button 0 = left).
  // sx/sy are the button's top-left in SCREEN pixels.
  function buttonUiState(state, obj, sx, sy, s) {
    const m = state.mouse || { x: 0, y: 0 };
    // P4 item 37 batch 5 (camera): the hit box scales with the zoomed draw.
    const w = (obj.width || 1) * (s || 1), h = (obj.height || 1) * (s || 1);
    const inside = m.x >= sx && m.x <= sx + w && m.y >= sy && m.y <= sy + h;
    if (!inside) return 'normal';
    return state.mouseButtons.has(0) ? 'pressed' : 'hover';
  }

  function buildPlayableHtml(project) {
    if (project?.playableRuntime === 'retroFps') return buildRetroFpsHtml(project);
    const safeProject = JSON.stringify(project).replace(/</g, '\\u003c');
    // Inline the shared modules FIRST: the player IIFE requires window.HydraExpr,
    // window.HydraInput, window.HydraAudio, window.HydraAudioBuses,
    // window.HydraAnim, window.HydraTween, window.HydraUi, window.HydraSave,
    // window.HydraPause, window.HydraCameraFx, window.HydraParticles, window.HydraActions,
    // window.HydraTiles, window.HydraPhysics2D, window.HydraPhysicsStep, window.HydraSceneReset, window.HydraDraw, window.HydraFlow,
    // window.HydraCollections and window.HydraMath at load time, and
    // exported games must not depend on editor files.
    // factorySource is the self-contained factory function.
    const sharedSources = [
      ['HydraInput', global.HydraInput && global.HydraInput.factorySource, 'hydra-input.js (window.HydraInput)'],
      ['HydraExpr', global.HydraExpr && global.HydraExpr.factorySource, 'hydra-expr.js (window.HydraExpr)'],
      ['HydraAudio', global.HydraAudio && global.HydraAudio.factorySource, 'hydra-audio.js (window.HydraAudio)'],
      ['HydraAnim', global.HydraAnim && global.HydraAnim.factorySource, 'hydra-anim.js (window.HydraAnim)'],
      ['HydraTween', global.HydraTween && global.HydraTween.factorySource, 'hydra-tween.js (window.HydraTween)'],
      ['HydraUi', global.HydraUi && global.HydraUi.factorySource, 'hydra-ui.js (window.HydraUi)'],
      ['HydraSave', global.HydraSave && global.HydraSave.factorySource, 'hydra-save.js (window.HydraSave)'],
      ['HydraPause', global.HydraPause && global.HydraPause.factorySource, 'hydra-pause.js (window.HydraPause)'],
      ['HydraCameraFx', global.HydraCameraFx && global.HydraCameraFx.factorySource, 'hydra-camerafx.js (window.HydraCameraFx)'],
      ['HydraSceneInit', global.HydraSceneInit && global.HydraSceneInit.factorySource, 'hydra-sceneinit.js (window.HydraSceneInit)'],
      ['HydraFrame', global.HydraFrame && global.HydraFrame.factorySource, 'hydra-frame.js (window.HydraFrame)'],
      ['HydraPhysicsStep', global.HydraPhysicsStep && global.HydraPhysicsStep.factorySource, 'hydra-physicsstep.js (window.HydraPhysicsStep)'],
      ['HydraSceneReset', global.HydraSceneReset && global.HydraSceneReset.factorySource, 'hydra-scenereset.js (window.HydraSceneReset)'],
      ['HydraDraw', global.HydraDraw && global.HydraDraw.factorySource, 'hydra-draw.js (window.HydraDraw)'],
      ['HydraDispatch', global.HydraDispatch && global.HydraDispatch.factorySource, 'hydra-dispatch.js (window.HydraDispatch)'],
      ['HydraConditions', global.HydraConditions && global.HydraConditions.factorySource, 'hydra-conditions.js (window.HydraConditions)'],
      ['HydraExecute', global.HydraExecute && global.HydraExecute.factorySource, 'hydra-execute.js (window.HydraExecute)'],
      ['HydraParticles', global.HydraParticles && global.HydraParticles.factorySource, 'hydra-particles.js (window.HydraParticles)'],
      ['HydraActions', global.HydraActions && global.HydraActions.factorySource, 'hydra-actions.js (window.HydraActions)'],
      ['HydraAudioBuses', global.HydraAudioBuses && global.HydraAudioBuses.factorySource, 'hydra-buses.js (window.HydraAudioBuses)'],
      ['HydraTiles', global.HydraTiles && global.HydraTiles.factorySource, 'hydra-tiles.js (window.HydraTiles)'],
      ['HydraPhysics2D', global.HydraPhysics2D && global.HydraPhysics2D.factorySource, 'hydra-physics2d.js (window.HydraPhysics2D)'],
      ['HydraFlow', global.HydraFlow && global.HydraFlow.factorySource, 'hydra-flow.js (window.HydraFlow)'],
      ['HydraCollections', global.HydraCollections && global.HydraCollections.factorySource, 'hydra-collections.js (window.HydraCollections)'],
      ['HydraMath', global.HydraMath && global.HydraMath.factorySource, 'hydra-math.js (window.HydraMath)'],
      ['HydraPick', global.HydraPick && global.HydraPick.factorySource, 'hydra-pick.js (window.HydraPick)'],
      ['HydraLayerFx', global.HydraLayerFx && global.HydraLayerFx.factorySource, 'hydra-layerfx.js (window.HydraLayerFx)'],
      ['HydraGltf', global.HydraGltf && global.HydraGltf.factorySource, 'hydra-gltf.js (window.HydraGltf)'],
      ['Hydra3d', global.Hydra3d && global.Hydra3d.factorySource, 'hydra-3d.js (window.Hydra3d)'],
      ['HydraProfile', global.HydraProfile && global.HydraProfile.factorySource, 'hydra-profile.js (window.HydraProfile)'],
      ['HydraScriptApi', global.HydraScriptApi && global.HydraScriptApi.factorySource, 'hydra-scriptapi.js (window.HydraScriptApi)'],
      ['HydraStateMachine', global.HydraStateMachine && global.HydraStateMachine.factorySource, 'hydra-statemachine.js (window.HydraStateMachine)'],
      ['HydraBlendSpace', global.HydraBlendSpace && global.HydraBlendSpace.factorySource, 'hydra-blendspace.js (window.HydraBlendSpace)'],
      ['HydraLight2d', global.HydraLight2d && global.HydraLight2d.factorySource, 'hydra-light2d.js (window.HydraLight2d)'],
      ['HydraJoints', global.HydraJoints && global.HydraJoints.factorySource, 'hydra-joints.js (window.HydraJoints)'],
      ['HydraSkeleton', global.HydraSkeleton && global.HydraSkeleton.factorySource, 'hydra-skeleton.js (window.HydraSkeleton)'],
      ['HydraLocalization', global.HydraLocalization && global.HydraLocalization.factorySource, 'hydra-localization.js (window.HydraLocalization)'],
      ['HydraDialogue', global.HydraDialogue && global.HydraDialogue.factorySource, 'hydra-dialogue.js (window.HydraDialogue)'],
      ['HydraInventory', global.HydraInventory && global.HydraInventory.factorySource, 'hydra-inventory.js (window.HydraInventory)'],
      ['HydraQuest', global.HydraQuest && global.HydraQuest.factorySource, 'hydra-quest.js (window.HydraQuest)'],
      ['HydraAchievement', global.HydraAchievement && global.HydraAchievement.factorySource, 'hydra-achievement.js (window.HydraAchievement)'],
      ['HydraCutscene', global.HydraCutscene && global.HydraCutscene.factorySource, 'hydra-cutscene.js (window.HydraCutscene)'],
      ['HydraHighScore', global.HydraHighScore && global.HydraHighScore.factorySource, 'hydra-highscore.js (window.HydraHighScore)'],
      ['HydraTimeScale', global.HydraTimeScale && global.HydraTimeScale.factorySource, 'hydra-timescale.js (window.HydraTimeScale)'],
      ['HydraTransition', global.HydraTransition && global.HydraTransition.factorySource, 'hydra-transition.js (window.HydraTransition)'],
      ['HydraCameraFeel', global.HydraCameraFeel && global.HydraCameraFeel.factorySource, 'hydra-camerafeel.js (window.HydraCameraFeel)'],
      ['HydraParallax', global.HydraParallax && global.HydraParallax.factorySource, 'hydra-parallax.js (window.HydraParallax)'],
      ['HydraSpatialAudio', global.HydraSpatialAudio && global.HydraSpatialAudio.factorySource, 'hydra-spatialaudio.js (window.HydraSpatialAudio)'],
      ['HydraPathfind', global.HydraPathfind && global.HydraPathfind.factorySource, 'hydra-pathfind.js (window.HydraPathfind)'],
      ['HydraAi', global.HydraAi && global.HydraAi.factorySource, 'hydra-ai.js (window.HydraAi)'],
      ['HydraJoystick', global.HydraJoystick && global.HydraJoystick.factorySource, 'hydra-joystick.js (window.HydraJoystick)'],
      ['HydraHealth', global.HydraHealth && global.HydraHealth.factorySource, 'hydra-health.js (window.HydraHealth)'],
      ['HydraDamageFx', global.HydraDamageFx && global.HydraDamageFx.factorySource, 'hydra-damagefx.js (window.HydraDamageFx)'],
      ['HydraRespawn', global.HydraRespawn && global.HydraRespawn.factorySource, 'hydra-respawn.js (window.HydraRespawn)'],
      ['HydraSpawn', global.HydraSpawn && global.HydraSpawn.factorySource, 'hydra-spawn.js (window.HydraSpawn)'],
      ['HydraLives', global.HydraLives && global.HydraLives.factorySource, 'hydra-lives.js (window.HydraLives)'],
      ['HydraMovement', global.HydraMovement && global.HydraMovement.factorySource, 'hydra-movement.js (window.HydraMovement)'],
      ['HydraPlatform', global.HydraPlatform && global.HydraPlatform.factorySource, 'hydra-platform.js (window.HydraPlatform)'],
      ['HydraCombat', global.HydraCombat && global.HydraCombat.factorySource, 'hydra-combat.js (window.HydraCombat)'],
      ['HydraXp', global.HydraXp && global.HydraXp.factorySource, 'hydra-xp.js (window.HydraXp)'],
      ['HydraGrowth', global.HydraGrowth && global.HydraGrowth.factorySource, 'hydra-growth.js (window.HydraGrowth)'],
      ['HydraScaling', global.HydraScaling && global.HydraScaling.factorySource, 'hydra-scaling.js (window.HydraScaling)'],
      ['HydraBoss', global.HydraBoss && global.HydraBoss.factorySource, 'hydra-boss.js (window.HydraBoss)'],
      ['HydraTags', global.HydraTags && global.HydraTags.factorySource, 'hydra-tags.js (window.HydraTags)'],
      ['HydraMinimap', global.HydraMinimap && global.HydraMinimap.factorySource, 'hydra-minimap.js (window.HydraMinimap)'],
      ['HydraAttach', global.HydraAttach && global.HydraAttach.factorySource, 'hydra-attach.js (window.HydraAttach)'],
      ['HydraVariables', global.HydraVariables && global.HydraVariables.factorySource, 'hydra-variables.js (window.HydraVariables)'],
      ['HydraFunctions', global.HydraFunctions && global.HydraFunctions.factorySource, 'hydra-functions.js (window.HydraFunctions)'],
      ['HydraLoops', global.HydraLoops && global.HydraLoops.factorySource, 'hydra-loops.js (window.HydraLoops)'],
      ['HydraEvents', global.HydraEvents && global.HydraEvents.factorySource, 'hydra-events.js (window.HydraEvents)'],
      ['HydraTrace', global.HydraTrace && global.HydraTrace.factorySource, 'hydra-trace.js (window.HydraTrace)']
    ];
    let sharedRuntime = '';
    for (const [name, source, label] of sharedSources) {
      if (!source) throw new Error(`Cannot export a playable game: ${label} is not loaded in the editor.`);
      sharedRuntime += `window.${name}=(${source})();\n`;
    }
    const runtime = (sharedRuntime + `(${installHydraPlayer.toString()})(window);`).replace(/<\/script/gi, '<\\/script');
    const title = escapeHtml(project?.name || 'Hydra Game');
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
:root{color-scheme:dark;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#020617;color:#e5edf8}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at top,#172554 0,#020617 52%,#020617 100%);overflow:hidden}
.shell{position:relative;display:grid;place-items:center;width:100vw;height:100vh}
canvas{max-width:100vw;max-height:100vh;box-shadow:0 24px 80px rgba(0,0,0,.45);background:#000;outline:none}
.hud{position:fixed;left:14px;top:12px;padding:8px 10px;border:1px solid rgba(148,163,184,.25);border-radius:8px;background:rgba(15,23,42,.68);backdrop-filter:blur(10px);font-size:12px;color:#dbeafe}
</style>
</head>
<body>
<div class="shell"><canvas id="game-canvas" aria-label="Hydra playable game"></canvas><div class="hud" id="hydra-hud">${title}</div></div>
<script>${runtime}</script>
<script>
try {
  var __hydraState = window.HydraPlayer.start(${safeProject},{canvasId:"game-canvas"});
  // P4 item 36 phase C (flow tracer): ?hydraTrace=1 enables the tracer
  // in an exported game and exposes its ring as window.__hydraTrace,
  // so a playtester can watch blocks fire from devtools.
  try {
    if (window.location && /hydraTrace=1/.test(window.location.search || '') &&
        window.HydraTrace && __hydraState && __hydraState.trace) {
      window.HydraTrace.enable(__hydraState.trace);
      window.__hydraTrace = __hydraState.trace;
    }
  } catch (traceError) { /* tracing is best-effort; never break the boot */ }
  document.documentElement.dataset.hydraPlayer = "ready";
} catch (error) {
  document.documentElement.dataset.hydraPlayer = "error";
  const message = document.createElement("pre");
  message.textContent = "Hydra export failed to start: " + (error && error.message ? error.message : error);
  message.style.cssText = "position:fixed;left:16px;right:16px;bottom:16px;z-index:10;padding:12px;border-radius:8px;background:#7f1d1d;color:#fee2e2;white-space:pre-wrap";
  document.body.appendChild(message);
  console.error(error);
}
</script>
</body>
</html>`;
  }

  // P4 E1 — web targets (itch.io ZIP + PWA). Builds the multi-file variant
  // of the export: index.html referencing external assets/ files plus the
  // optional PWA pieces. The editor (project.js) zips the result.
  //
  // opts: { pwa?: { name, shortName, themeColor, backgroundColor,
  //                  icons: [{path, sizes}] } }
  // Returns { indexHtml, files: [{path, bytes, mime}], manifest|null,
  //           serviceWorker|null }.
  // The HydraWebExport guard is LAZY: it only throws when this function is
  // called, so existing single-file export paths never need the module.
  function buildWebTarget(project, opts) {
    opts = opts || {};
    const WE = global.HydraWebExport;
    if (!WE || typeof WE.extractAssets !== 'function' || typeof WE.buildManifest !== 'function') {
      throw new Error('Cannot export a web target: hydra-webexport.js (window.HydraWebExport) is not loaded in the editor.');
    }
    const extracted = WE.extractAssets(project);
    const pwa = opts.pwa || null;
    const iconPaths = (pwa && Array.isArray(pwa.icons)) ? pwa.icons : [];
    let html = buildPlayableHtml(extracted.project);
    let manifest = null;
    let serviceWorker = null;
    if (pwa) {
      const gameName = (project && project.name) || 'Hydra Game';
      const cacheName = WE.pwaCacheName(gameName);
      const cachePaths = ['index.html']
        .concat(extracted.files.map(f => f.path))
        .concat(iconPaths.map(ic => String(ic.path)));
      manifest = WE.buildManifest({
        name: pwa.name || gameName,
        shortName: pwa.shortName || gameName,
        themeColor: pwa.themeColor,
        backgroundColor: pwa.backgroundColor,
        icons: iconPaths
      });
      serviceWorker = WE.buildServiceWorker({ cacheName, paths: cachePaths });
      html = WE.injectPwa(html, {
        manifestPath: 'manifest.webmanifest',
        swPath: 'sw.js',
        themeColor: pwa.themeColor
      });
    }
    return { indexHtml: html, files: extracted.files, manifest, serviceWorker };
  }

  // P4 E2 — desktop wrapper export (Windows/macOS/Linux via Electron).
  // Composes the multi-file web target (game/index.html + game/assets/) into
  // a complete, buildable Electron project: package.json, main.js window
  // shell, README.md guided checklist, game/ payload, and build/icon.png
  // when iconPngBytes is supplied. Returns { files: [{path, bytes}],
  // gameName, packageName, appId }.
  // The HydraDesktopExport guard is LAZY: it only throws when this function
  // is called, so existing single-file and web-target exports never need
  // the module.
  function buildDesktopTarget(project, opts) {
    opts = opts || {};
    const DE = global.HydraDesktopExport;
    if (!DE || typeof DE.buildDesktopFiles !== 'function') {
      throw new Error('Cannot export a desktop target: hydra-desktopexport.js (window.HydraDesktopExport) is not loaded in the editor.');
    }
    const web = buildWebTarget(project, {}); // own lazy guard names hydra-webexport.js
    const scene = (project && project.scenes && project.scenes[0]) || {};
    return DE.buildDesktopFiles({
      gameName: (project && project.name) || 'Hydra Game',
      appId: opts.appId,
      width: scene.viewportWidth,
      height: scene.viewportHeight,
      gameHtml: web.indexHtml,
      assetFiles: web.files,
      iconBytes: opts.iconPngBytes
    });
  }

  // E3: mobile wrapper export — a complete, buildable Capacitor project:
  // package.json, capacitor.config.json, README.md guided checklist, the
  // www/ payload, and resources/icon.png + resources/splash.png when PNG
  // bytes are supplied. Returns { files: [{path, bytes}],
  // gameName, packageName, appId }.
  // The HydraMobileExport guard is LAZY: it only throws when this function
  // is called, so existing single-file, web-target, and desktop exports
  // never need the module.
  function buildMobileTarget(project, opts) {
    opts = opts || {};
    const ME = global.HydraMobileExport;
    if (!ME || typeof ME.buildMobileFiles !== 'function') {
      throw new Error('Cannot export a mobile target: hydra-mobileexport.js (window.HydraMobileExport) is not loaded in the editor.');
    }
    const web = buildWebTarget(project, {}); // own lazy guard names hydra-webexport.js
    return ME.buildMobileFiles({
      gameName: (project && project.name) || 'Hydra Game',
      appId: opts.appId,
      gameHtml: web.indexHtml,
      assetFiles: web.files,
      iconBytes: opts.iconPngBytes,
      splashBytes: opts.splashPngBytes
    });
  }

  function fpsLevelFromScene(project) {
    const scenes = project?.scenes || [];
    const scene = scenes.find(s => s.id === Number(project?.currentSceneId)) || scenes[0];
    const objs = (scene?.objects || []).filter(o => o && o.kind !== 'text');
    const cx = o => Math.round((((Number(o.posX) || 0) + (Number(o.width) || 40) / 2) / 50) * 10) / 10;
    const cy = o => Math.round((((Number(o.posY) || 0) + (Number(o.height) || 40) / 2) / 50) * 10) / 10;
    const hasComp = (o, t) => (o.components || []).some(c => c.type === t);
    const byName = re => objs.filter(o => re.test(String(o.name || '')));
    const playerObj = objs.find(o => hasComp(o, 'FirstPersonController')) || byName(/previewplayer/i)[0];
    const drones = byName(/drone/i);
    const triggerDrones = objs.filter(o => hasComp(o, 'TriggerZone') && !drones.includes(o));
    const level = {};
    if (playerObj) level.playerStart = { x: cx(playerObj), y: cy(playerObj) };
    const enemies = drones.concat(triggerDrones).map(o => ({ x: cx(o), y: cy(o), hp: 2 }));
    if (enemies.length) level.enemies = enemies;
    const pickups = [];
    byName(/reactorcore/i).forEach(o => pickups.push({ x: cx(o), y: cy(o), type: 'core' }));
    byName(/ammobox/i).forEach(o => pickups.push({ x: cx(o), y: cy(o), type: 'ammo' }));
    byName(/medkit/i).forEach(o => pickups.push({ x: cx(o), y: cy(o), type: 'med' }));
    if (pickups.length) level.pickups = pickups;
    return level;
  }

  function buildRetroFpsHtml(project) {
    const title = escapeHtml(project?.name || 'Hydra FPS');
    const fpsCfg = project?.fpsConfig || {};
    // The FPS arena is driven by the project's scene: objects named Drone
    // become enemies, ReactorCore/AmmoBox/Medkit become pickups, and the
    // player spawns at the FirstPersonController object (or PreviewPlayer).
    // Falls back to the built-in layout when the scene defines none.
    const level = fpsLevelFromScene(project);
    const cfg = JSON.stringify(Object.assign({}, fpsCfg, { level })).replace(/</g, '\\u003c');
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
:root{color-scheme:dark;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#080912;color:#f8fafc}
body{margin:0;overflow:hidden;background:#080912}
canvas{display:block;width:100vw;height:100vh;background:#090b12;cursor:crosshair}
.hud{position:fixed;inset:0;pointer-events:none;color:#f8fafc;text-shadow:0 2px 8px #000}
.top{position:absolute;left:16px;top:14px;display:flex;gap:10px;align-items:center;font-size:13px;font-weight:900}
.chip{padding:8px 10px;border:1px solid rgba(255,255,255,.18);border-radius:8px;background:rgba(12,16,28,.62);backdrop-filter:blur(10px)}
.objective{position:absolute;right:16px;top:14px;max-width:340px;padding:10px 12px;border-radius:8px;background:rgba(12,16,28,.72);border:1px solid rgba(255,255,255,.16);font-size:13px;font-weight:800}
.reticle{position:absolute;left:50%;top:50%;width:18px;height:18px;margin:-9px 0 0 -9px}
.reticle:before,.reticle:after{content:"";position:absolute;background:#e2e8f0;box-shadow:0 0 8px rgba(255,255,255,.7)}
.reticle:before{left:8px;top:0;width:2px;height:18px}.reticle:after{left:0;top:8px;width:18px;height:2px}
.weapon{position:absolute;left:50%;bottom:0;width:280px;height:190px;margin-left:-140px;border-radius:120px 120px 0 0;background:linear-gradient(135deg,#172033,#0f172a 42%,#334155);box-shadow:0 -18px 50px rgba(0,0,0,.5),inset 0 0 0 3px rgba(255,255,255,.08)}
.bar{position:absolute;left:16px;bottom:16px;display:flex;gap:12px;align-items:end}
.meter{width:180px;height:12px;border:1px solid rgba(255,255,255,.2);background:#111827;border-radius:999px;overflow:hidden}
.meter span{display:block;height:100%;background:linear-gradient(90deg,#22c55e,#facc15,#ef4444)}
.center-msg{position:absolute;left:50%;top:18%;transform:translateX(-50%);padding:10px 14px;border-radius:8px;background:rgba(2,6,23,.75);border:1px solid rgba(255,255,255,.18);font-weight:900;letter-spacing:.02em}
.help{position:absolute;left:50%;bottom:22px;transform:translateX(-50%);font-size:12px;color:#cbd5e1;background:rgba(2,6,23,.52);padding:7px 10px;border-radius:999px}
</style>
</head>
<body>
<canvas id="game"></canvas>
<div class="hud">
  <div class="top"><div class="chip" id="score">Score 0</div><div class="chip" id="ammo">Ammo 24</div><div class="chip" id="wave">Wave 1</div></div>
  <div class="objective" id="objective">Collect reactor cores and clear the arena.</div>
  <div class="reticle"></div><div class="weapon" id="weapon"></div>
  <div class="bar"><div><div style="font-size:12px;font-weight:900;margin-bottom:6px">HEALTH</div><div class="meter"><span id="health"></span></div></div></div>
  <div class="center-msg" id="message">Click to lock pointer and start</div>
  <div class="help">WASD move · mouse/arrow keys look · click/space shoot · R reload · Shift dash</div>
</div>
<script>
(() => {
const cfg=${cfg};
const canvas=document.getElementById('game'),ctx=canvas.getContext('2d');
const ui={score:document.getElementById('score'),ammo:document.getElementById('ammo'),wave:document.getElementById('wave'),health:document.getElementById('health'),objective:document.getElementById('objective'),msg:document.getElementById('message'),weapon:document.getElementById('weapon')};
const map=(cfg.map||[
"1111111111111111",
"1000000002000001",
"1011110101110101",
"1000010100010101",
"1011010111010101",
"1001000000010001",
"1101011111010111",
"1001000001010001",
"1011110101011101",
"1000000100000001",
"1011111111011101",
"1000000001000001",
"1010111101110101",
"1000100000000301",
"1000000000000001",
"1111111111111111"]).map(r=>r.split('').map(Number));
const colors={1:'#6b7280',2:'#7c3aed',3:'#10b981'};
const keys=new Set(),shots=[];let W=0,H=0,last=0,flash=0,shake=0,won=false,over=false;
const level=cfg.level||{};
const player={x:level.playerStart?.x??2.4,y:level.playerStart?.y??2.5,a:0,hp:100,ammo:24,maxAmmo:24,score:0,cores:0,wave:1,cool:0,reload:0,dash:0};
const DEFAULT_ENEMIES=[
 {x:8.5,y:2.5,hp:2,t:0,kind:0},{x:12.5,y:5.5,hp:2,t:0,kind:1},{x:6.5,y:9.5,hp:2,t:0,kind:0},
 {x:13.5,y:12.5,hp:3,t:0,kind:1},{x:3.5,y:13.5,hp:2,t:0,kind:0},{x:10.5,y:13.5,hp:3,t:0,kind:1}
];
const enemies=(level.enemies&&level.enemies.length?level.enemies:DEFAULT_ENEMIES).map((e,i)=>({x:e.x,y:e.y,hp:e.hp||2,t:0,kind:i%2}));
const DEFAULT_PICKUPS=[{x:4.5,y:4.5,type:'core'},{x:13.5,y:3.5,type:'ammo'},{x:3.5,y:10.5,type:'med'},{x:11.5,y:11.5,type:'core'},{x:6.5,y:13.5,type:'core'},{x:14.5,y:8.5,type:'ammo'}];
const pickups=(level.pickups&&level.pickups.length?level.pickups:DEFAULT_PICKUPS).map(p=>({x:p.x,y:p.y,type:p.type,done:false}));
const coresNeeded=Math.max(1,pickups.filter(p=>p.type==='core').length);
function resize(){W=canvas.width=innerWidth*devicePixelRatio;H=canvas.height=innerHeight*devicePixelRatio;ctx.imageSmoothingEnabled=false} addEventListener('resize',resize);resize();
addEventListener('keydown',e=>{keys.add(e.code);if(e.code==='Space')shoot();if(e.code==='KeyR')reload()});
addEventListener('keyup',e=>keys.delete(e.code));
canvas.addEventListener('click',()=>{canvas.requestPointerLock?.();shoot();ui.msg.style.display='none'});
addEventListener('mousemove',e=>{if(document.pointerLockElement===canvas)player.a+=e.movementX*0.0025});
function cell(x,y){return map[Math.floor(y)]?.[Math.floor(x)]||1}
function solid(x,y){const c=cell(x,y);return c===1||c===2}
function move(dx,dy){const nx=player.x+dx,ny=player.y+dy;if(!solid(nx,player.y))player.x=nx;if(!solid(player.x,ny))player.y=ny}
function cast(a){let x=player.x,y=player.y,dx=Math.cos(a)*0.035,dy=Math.sin(a)*0.035,d=0,c=0;while(d<20){x+=dx;y+=dy;d+=0.035;c=cell(x,y);if(c)break}return{d,c,x,y}}
function reload(){if(player.reload<=0&&player.ammo<player.maxAmmo){player.reload=.8;ui.msg.textContent='Reloading';ui.msg.style.display='block';setTimeout(()=>ui.msg.style.display='none',650)}}
function shoot(){if(over||won||player.cool>0||player.reload>0)return;if(player.ammo<=0){reload();return}player.ammo--;player.cool=.16;flash=.09;shake=.14;ui.weapon.style.transform='translateY(12px) scale(1.04)';setTimeout(()=>ui.weapon.style.transform='',90);let best=null,bestDot=.985;for(const e of enemies){if(e.hp<=0)continue;const ang=Math.atan2(e.y-player.y,e.x-player.x);const dot=Math.cos(norm(ang-player.a));const dist=Math.hypot(e.x-player.x,e.y-player.y);if(dot>bestDot&&dist<10&&!wallBetween(e.x,e.y)){best=e;bestDot=dot}}if(best){best.hp--;player.score+=best.hp<=0?150:35;ui.msg.textContent=best.hp<=0?'Drone down':'+ hit';ui.msg.style.display='block';setTimeout(()=>ui.msg.style.display='none',260)}}
function wallBetween(x,y){const steps=Math.ceil(Math.hypot(x-player.x,y-player.y)*12);for(let i=1;i<steps;i++){const t=i/steps;if(solid(player.x+(x-player.x)*t,player.y+(y-player.y)*t))return true}return false}
function norm(a){while(a>Math.PI)a-=Math.PI*2;while(a<-Math.PI)a+=Math.PI*2;return a}
function update(dt){if(over||won)return;player.cool=Math.max(0,player.cool-dt);player.reload=Math.max(0,player.reload-dt);if(player.reload===0&&ui.msg.textContent==='Reloading')player.ammo=player.maxAmmo;const speed=(keys.has('ShiftLeft')&&player.dash<=0)?0.09:0.045;if(keys.has('ShiftLeft')&&player.dash<=0)player.dash=.9;player.dash=Math.max(0,player.dash-dt);if(keys.has('ArrowLeft'))player.a-=2.4*dt;if(keys.has('ArrowRight'))player.a+=2.4*dt;let mx=0,my=0;if(keys.has('KeyW')){mx+=Math.cos(player.a);my+=Math.sin(player.a)}if(keys.has('KeyS')){mx-=Math.cos(player.a);my-=Math.sin(player.a)}if(keys.has('KeyA')){mx+=Math.cos(player.a-Math.PI/2);my+=Math.sin(player.a-Math.PI/2)}if(keys.has('KeyD')){mx+=Math.cos(player.a+Math.PI/2);my+=Math.sin(player.a+Math.PI/2)}const m=Math.hypot(mx,my)||1;move(mx/m*speed*dt*60,my/m*speed*dt*60);for(const e of enemies){if(e.hp<=0)continue;const dist=Math.hypot(e.x-player.x,e.y-player.y);if(dist<8&&!wallBetween(e.x,e.y)){const vx=(player.x-e.x)/dist,vy=(player.y-e.y)/dist;if(dist>.75&&!solid(e.x+vx*.018*dt*60,e.y))e.x+=vx*.018*dt*60;if(dist>.75&&!solid(e.x,e.y+vy*.018*dt*60))e.y+=vy*.018*dt*60;if(dist<.85){player.hp-=18*dt;shake=.08}}else{e.t+=dt;e.x+=Math.cos(e.t+e.kind)*.004*dt*60;e.y+=Math.sin(e.t*.7+e.kind)*.004*dt*60}}for(const p of pickups){if(p.done)continue;if(Math.hypot(p.x-player.x,p.y-player.y)<.55){p.done=true;if(p.type==='core'){player.cores++;player.score+=250}else if(p.type==='ammo')player.ammo=player.maxAmmo;else player.hp=Math.min(100,player.hp+35)}}if(player.cores>=coresNeeded)map[13][13]=0;if(player.cores>=coresNeeded&&player.x>13&&player.y>13){won=true;ui.msg.textContent='Arena cleared';ui.msg.style.display='block'}if(player.hp<=0){over=true;ui.msg.textContent='Simulation failed - press refresh';ui.msg.style.display='block'}}
function draw(){ctx.fillStyle='#111827';ctx.fillRect(0,0,W,H/2);ctx.fillStyle='#1f2937';ctx.fillRect(0,H/2,W,H/2);const cols=Math.floor(W/4),fov=Math.PI/3;for(let i=0;i<cols;i++){const a=player.a-fov/2+fov*i/cols,r=cast(a),dist=r.d*Math.cos(a-player.a),h=Math.min(H,H/(dist*.8)),x=i*4,y=(H-h)/2;const shade=Math.max(.22,1-dist/14);ctx.fillStyle=shadeColor(colors[r.c]||'#475569',shade);ctx.fillRect(x,y,5,h)}const sprites=[];for(const e of enemies)if(e.hp>0)sprites.push({...e,type:'enemy',d:Math.hypot(e.x-player.x,e.y-player.y)});for(const p of pickups)if(!p.done)sprites.push({...p,d:Math.hypot(p.x-player.x,p.y-player.y)});sprites.sort((a,b)=>b.d-a.d).forEach(s=>drawSprite(s));if(flash>0){ctx.fillStyle='rgba(250,204,21,.35)';ctx.beginPath();ctx.arc(W/2,H*.62,90*devicePixelRatio,0,7);ctx.fill()}drawMini();ui.score.textContent='Score '+player.score;ui.ammo.textContent='Ammo '+(player.reload>0?'...':player.ammo);ui.wave.textContent='Wave '+player.wave;ui.health.style.width=Math.max(0,player.hp)+'%';ui.objective.textContent=player.cores<coresNeeded?'Collect reactor cores: '+player.cores+'/'+coresNeeded · Drones left: '+enemies.filter(e=>e.hp>0).length:'Exit opened - reach the green gate';}
function drawSprite(s){const ang=norm(Math.atan2(s.y-player.y,s.x-player.x)-player.a),dist=s.d;if(Math.abs(ang)>Math.PI/2||dist<.1)return;const size=H/(dist*1.2),x=W/2+Math.tan(ang)*(W*.78)-size/2,y=H/2-size*.42;ctx.fillStyle=s.type==='enemy'?'#ef4444':s.type==='core'?'#a78bfa':s.type==='ammo'?'#facc15':'#22c55e';ctx.fillRect(x,y,size,size);ctx.fillStyle='rgba(255,255,255,.28)';ctx.fillRect(x+size*.18,y+size*.18,size*.22,size*.22)}
function drawMini(){const S=7*devicePixelRatio,ox=W-130*devicePixelRatio,oy=H-130*devicePixelRatio;ctx.globalAlpha=.82;for(let y=0;y<map.length;y++)for(let x=0;x<map[y].length;x++){ctx.fillStyle=cell(x,y)?'#475569':'#0f172a';ctx.fillRect(ox+x*S,oy+y*S,S-1,S-1)}ctx.fillStyle='#38bdf8';ctx.fillRect(ox+player.x*S-2,oy+player.y*S-2,4,4);ctx.globalAlpha=1}
function shadeColor(hex,s){const n=parseInt(hex.slice(1),16),r=(n>>16)*s,g=((n>>8)&255)*s,b=(n&255)*s;return 'rgb('+r+','+g+','+b+')'}
function loop(t){const dt=Math.min(.05,(t-last)/1000||.016);last=t;flash=Math.max(0,flash-dt);shake=Math.max(0,shake-dt);update(dt);draw();requestAnimationFrame(loop)}requestAnimationFrame(loop);
})();
</script>
</body>
</html>`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  global.HydraPlayer = { start, buildPlayableHtml, buildWebTarget, buildDesktopTarget, buildMobileTarget };
})(typeof window !== 'undefined' ? window : globalThis);
