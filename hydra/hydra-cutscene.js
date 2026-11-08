/* ============================================================================
 * hydra-cutscene.js — HydraScript shared cutscene / timeline system
 * (P4 Advanced batch 11: the scripted scene a game plays by itself).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation
 * of cutscenes used by:
 *   - the editor preview runtime (hydra-previewruntime.js delegates
 *     to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Idea (Unity Timeline / Unreal Sequencer, beginner edition): a cutscene
 * is a named list of steps the engine plays in order, one step after
 * the next, so an intro, a level transition, or an ending plays itself
 * without a wall of timer blocks:
 *
 *   Game Start -> Play Cutscene "Intro"
 *   Cutscene Finished "Intro" (edge) -> Switch Scene "Level 1"
 *
 * Step kinds (each step is one plain record on the cutscene):
 *   wait  — hold for N seconds (a beat of silence, a pause for effect).
 *   text  — write text into a text object at the step start and hold
 *           it for N seconds (a caption, a line of narration). The text
 *           stays after the step ends — the module never blanks it.
 *   move  — glide an object from wherever it is to (x, y) over N
 *           seconds (a camera pan is a move on a wide backdrop; a
 *           character walking off is a move on the character).
 *   sound — play a named sound asset once; the step ends at once, so
 *           a sound never blocks the timeline.
 *   scene — switch to a named scene; the step ends at once and the
 *           cutscene KEEPS PLAYING in the new scene (the runtime
 *           survives scene switches, like the quest log and the
 *           backpack).
 *
 * Data model (stored on the project, saved in project JSON, edited in
 * the Cutscenes tab):
 *   project.cutscenes = [
 *     { id: 'cts_...', name: 'Intro', description: 'The opening crawl.',
 *       steps: [
 *         { kind: 'text', object: 'Caption', text: 'A long time ago...', seconds: 3 },
 *         { kind: 'move', object: 'Hero', x: 400, y: 300, seconds: 2 },
 *         { kind: 'sound', sound: 'Fanfare' },
 *         { kind: 'wait', seconds: 1 },
 *         { kind: 'scene', scene: 'Level 1' }
 *       ] }
 *   ];
 * `seconds` is how long a timed step holds (default 1); 0 means the
 * step finishes on the frame it starts (a move with 0 seconds teleports
 * the object to its target). Sound and scene steps always finish on
 * the frame they start.
 *
 * Runtime state (NOT saved; per run, created fresh at game start):
 *   { active: <cutscene entry or null>, stepIndex, stepElapsed,
 *     stepStarted, stepFrom: {x, y} or null, lastFinished: <name or null> }
 * The runtime survives scene switches inside a run (player state, like
 * the quest log) and resets on a fresh run. It is NOT part of the
 * save-slot payload: save slots store game variables only. A cutscene
 * freezes while the game is paused (it moves the world, so the pause
 * freeze applies — the update returns early while paused); the
 * Cutscene Playing / Cutscene Finished conditions keep evaluating
 * while paused, like the other state reads.
 *
 * Play Cutscene replaces any cutscene already playing (the new one
 * wins); Stop Cutscene counts as finished, so a skip button runs the
 * same Cutscene Finished hook as a natural ending. Blank cutscene
 * names stay quiet (the same blank-quiet convention as every other
 * block family); unknown names and missing objects/sounds/scenes warn
 * and hold (a step whose target is missing warns once and the timeline
 * moves on — a typo never stalls the cutscene). Conditions read the
 * live runtime directly and never warn: a blank name on Cutscene
 * Playing means "any cutscene", and on Cutscene Finished means "any
 * cutscene finished most recently". Nothing ever throws; hostile input
 * degrades to safe defaults.
 *
 * Honest limits: steps are a fixed list, not a track editor — there is
 * no scrubbing, no parallel tracks, and no per-step easing (a move is
 * a straight linear glide; chain moves or use a tween for curves);
 * there is one cutscene playing at a time; a cutscene has no progress
 * counter of its own (read the step by gating on Cutscene Finished,
 * or drive a variable from the steps themselves); and the runtime does
 * not travel inside save slots (replay the cutscene after Load Game,
 * or skip it with a Cutscene Finished gate). Old projects have no
 * cutscenes field and behave exactly as before.
 *
 * Load order (index.html): hydra-cutscene.js BEFORE player-runtime.js
 * and script.js. player-runtime.js throws a clear error if
 * HydraCutscene is missing.
 * ========================================================================== */

function hydraCutsceneFactory() {
  'use strict';

  var DEFAULT_SECONDS = 1;
  var STEP_KINDS = ['wait', 'text', 'move', 'sound', 'scene'];

  function saneStr(v) {
    return String(v == null ? '' : v);
  }

  function saneName(v) {
    return saneStr(v).trim();
  }

  // A usable number, or the fallback when the value is not one.
  function saneNum(v, fallback) {
    var n = Number(v);
    return isFinite(n) ? n : fallback;
  }

  // A step duration in seconds: a finite number >= 0, else the
  // 1-second default. 0 is legal — the step finishes at once.
  function saneSeconds(v) {
    var n = Number(v);
    if (!isFinite(n) || n < 0) return DEFAULT_SECONDS;
    return n;
  }

  function isStepKind(kind) {
    return STEP_KINDS.indexOf(kind) !== -1;
  }

  // Normalize one step record IN PLACE, or return null when the step
  // is not a usable step at all (unknown kind, not an object).
  function normalizeStep(step) {
    if (!step || typeof step !== 'object' || Array.isArray(step)) return null;
    var kind = saneName(step.kind);
    if (!isStepKind(kind)) return null;
    step.kind = kind;
    if (kind === 'wait') {
      step.seconds = saneSeconds(step.seconds);
    } else if (kind === 'text') {
      step.object = saneStr(step.object);
      step.text = saneStr(step.text);
      step.seconds = saneSeconds(step.seconds);
    } else if (kind === 'move') {
      step.object = saneStr(step.object);
      step.x = saneNum(step.x, 0);
      step.y = saneNum(step.y, 0);
      step.seconds = saneSeconds(step.seconds);
    } else if (kind === 'sound') {
      step.sound = saneStr(step.sound);
    } else if (kind === 'scene') {
      step.scene = saneStr(step.scene);
    }
    return step;
  }

  // Normalize a project's cutscene list IN PLACE — entries are repaired
  // on the existing array, so the record keeps its identity across
  // calls (the dialogue/localization lesson: the editor tab holds
  // entry references while it renders, and a wholesale replacement
  // would orphan them). Blank-name cutscenes drop, duplicate names
  // collapse to the first, steps normalize in place with unknown kinds
  // dropped, and descriptions coerce to strings. Never throws.
  function normalizeCutscenes(cutscenes) {
    try {
      if (!Array.isArray(cutscenes)) return [];
      var seen = {};
      for (var i = 0; i < cutscenes.length;) {
        var c = cutscenes[i];
        if (!c || typeof c !== 'object' || Array.isArray(c)) { cutscenes.splice(i, 1); continue; }
        var name = saneName(c.name);
        if (!name || seen[name]) { cutscenes.splice(i, 1); continue; }
        seen[name] = true;
        c.name = name;
        if (typeof c.id !== 'string' || !c.id) c.id = 'cts_' + (i + 1);
        c.description = saneStr(c.description);
        if (!Array.isArray(c.steps)) c.steps = [];
        for (var s = 0; s < c.steps.length;) {
          if (!normalizeStep(c.steps[s])) { c.steps.splice(s, 1); continue; }
          s++;
        }
        i++;
      }
      return cutscenes;
    } catch (err) {
      return [];
    }
  }

  // The normalized cutscene names (a copy — callers may not mutate it).
  function cutsceneNames(cutscenes) {
    try {
      return normalizeCutscenes(cutscenes).map(function (c) { return c.name; });
    } catch (e) {
      return [];
    }
  }

  // The cutscene definition with exactly this name (or id), or null.
  // Blank names read null.
  function getCutscene(cutscenes, name) {
    try {
      var want = saneName(name);
      if (!want) return null;
      var list = normalizeCutscenes(cutscenes);
      for (var i = 0; i < list.length; i++) {
        if (list[i].name === want || list[i].id === want) return list[i];
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  // A fresh per-run cutscene runtime. Nothing is playing yet.
  function createCutsceneRuntime() {
    return { active: null, stepIndex: 0, stepElapsed: 0, stepStarted: false, stepFrom: null, lastFinished: null };
  }

  function isRuntime(rt) {
    return !!rt && typeof rt === 'object';
  }

  function warnHook(hooks, msg) {
    try {
      if (hooks && typeof hooks.warn === 'function') hooks.warn(msg);
    } catch (e) { /* a throwing warn never breaks the cutscene */ }
  }

  function pausedHook(hooks) {
    try {
      if (!hooks) return false;
      if (hooks.paused === true) return true;
      if (typeof hooks.paused === 'function') return !!hooks.paused();
      return false;
    } catch (e) {
      return false;
    }
  }

  function callHook(hooks, name, args) {
    try {
      if (hooks && typeof hooks[name] === 'function') return hooks[name].apply(null, args);
    } catch (e) { /* a throwing hook reads as a miss */ }
    return undefined;
  }

  // The live position of the named object ({ x, y }), or null when no
  // live object carries that name (destroyed, hidden, or never existed
  // all read as missing — the timeline warns and moves on).
  function objectPosition(hooks, name) {
    var pos = callHook(hooks, 'getObjectPosition', [name]);
    if (!pos || typeof pos !== 'object') return null;
    var x = Number(pos.x);
    var y = Number(pos.y);
    if (!isFinite(x) || !isFinite(y)) return null;
    return { x: x, y: y };
  }

  // Finish the running cutscene: it stops being active, and its name
  // becomes the most recently finished one, so the Cutscene Finished
  // condition fires (edge trigger) until another cutscene finishes.
  function finishCutscene(rt) {
    if (rt.active) rt.lastFinished = rt.active.name;
    rt.active = null;
    rt.stepIndex = 0;
    rt.stepElapsed = 0;
    rt.stepStarted = false;
    rt.stepFrom = null;
  }

  // Advance past the current step: the next step starts fresh.
  function advanceStep(rt) {
    rt.stepIndex += 1;
    rt.stepElapsed = 0;
    rt.stepStarted = false;
    rt.stepFrom = null;
  }

  // Run a step's start effects. Returns true when the step completes
  // at once (sound, scene, a missing target, a zero-second move) and
  // the timeline should move on in the same frame; false when the step
  // is timed and the clock runs on it.
  function startStep(rt, step, hooks) {
    if (step.kind === 'wait') return false;
    if (step.kind === 'text') {
      if (!objectPosition(hooks, step.object)) {
        warnHook(hooks, 'Play Cutscene: no object named "' + step.object + '" for the Show text step. The step was skipped.');
        return true;
      }
      callHook(hooks, 'setObjectText', [step.object, step.text]);
      return false;
    }
    if (step.kind === 'move') {
      var from = objectPosition(hooks, step.object);
      if (!from) {
        warnHook(hooks, 'Play Cutscene: no object named "' + step.object + '" for the Move step. The step was skipped.');
        return true;
      }
      rt.stepFrom = from;
      if (saneSeconds(step.seconds) <= 0) {
        callHook(hooks, 'setObjectPosition', [step.object, step.x, step.y]);
        return true;
      }
      return false;
    }
    if (step.kind === 'sound') {
      var played = callHook(hooks, 'playSound', [step.sound]);
      if (played !== true) {
        warnHook(hooks, 'Play Cutscene: no sound named "' + step.sound + '" for the Play sound step. The step was skipped.');
      }
      return true;
    }
    if (step.kind === 'scene') {
      var switched = callHook(hooks, 'switchScene', [step.scene]);
      if (switched !== true) {
        warnHook(hooks, 'Play Cutscene: no scene named "' + step.scene + '" for the Switch scene step. The step was skipped.');
      }
      return true;
    }
    warnHook(hooks, 'Play Cutscene: unknown step kind "' + step.kind + '". The step was skipped.');
    return true;
  }

  // Apply one frame of a running move step (linear glide from the
  // position captured at the step start toward the target).
  function applyMove(rt, step, hooks) {
    var seconds = saneSeconds(step.seconds);
    if (seconds <= 0) return;
    var from = rt.stepFrom;
    if (!from) { callHook(hooks, 'setObjectPosition', [step.object, step.x, step.y]); return; }
    var t = Math.max(0, Math.min(1, rt.stepElapsed / seconds));
    callHook(hooks, 'setObjectPosition', [step.object,
      from.x + (step.x - from.x) * t,
      from.y + (step.y - from.y) * t]);
  }

  // Start the named cutscene, replacing any cutscene already playing
  // (the new one wins). Blank names stay quiet; unknown names warn
  // and hold. Returns true when a cutscene started.
  function playCutscene(rt, cutscenes, name, hooks) {
    try {
      if (!isRuntime(rt)) return false;
      var want = saneName(name);
      if (!want) return false;
      var def = getCutscene(cutscenes, want);
      if (!def) {
        warnHook(hooks, 'Play Cutscene: no cutscene named "' + want + '" in the Cutscenes tab. Nothing is playing.');
        return false;
      }
      rt.active = def;
      rt.stepIndex = 0;
      rt.stepElapsed = 0;
      rt.stepStarted = false;
      rt.stepFrom = null;
      // A replay clears the finished record, so the Cutscene Finished
      // edge fires again when this run ends.
      rt.lastFinished = null;
      return true;
    } catch (e) {
      return false;
    }
  }

  // Stop the running cutscene. A blank name stops whichever cutscene
  // is playing; a named one stops only that cutscene. Stopping counts
  // as finished, so a skip button runs the same Cutscene Finished
  // hook as a natural ending. Blank with nothing playing stays quiet;
  // unknown names warn and hold. Returns true when one stopped.
  function stopCutscene(rt, cutscenes, name, hooks) {
    try {
      if (!isRuntime(rt)) return false;
      var want = saneName(name);
      if (want && !getCutscene(cutscenes, want)) {
        warnHook(hooks, 'Stop Cutscene: no cutscene named "' + want + '" in the Cutscenes tab. Nothing was stopped.');
        return false;
      }
      if (!rt.active) return false;
      if (want && rt.active.name !== want) return false;
      finishCutscene(rt);
      return true;
    } catch (e) {
      return false;
    }
  }

  // Advance the running cutscene one frame. dtSeconds is real seconds
  // (the host converts from its 60fps-unit dt). Frozen while paused —
  // a cutscene moves the world, so the pause freeze applies. A run of
  // instant steps (sound, scene, zero-second) all fires in one frame;
  // a timed step's clock starts on the frame after it starts, so one
  // frame's dt is never spent twice. Never throws.
  function updateCutscene(rt, cutscenes, dtSeconds, hooks) {
    try {
      if (!isRuntime(rt)) return;
      if (pausedHook(hooks)) return;
      if (!rt.active) return;
      var dt = Number(dtSeconds);
      if (!isFinite(dt) || dt < 0) dt = 0;
      // The definition may have been edited mid-run; re-resolve by
      // name so a renamed cutscene keeps playing under its new name,
      // and a deleted one ends quietly instead of stalling.
      var def = getCutscene(cutscenes, rt.active.name);
      if (!def) {
        // The definition vanished mid-run (deleted in the tab): the
        // cutscene ends WITHOUT marking finished — no phantom finish
        // for something the author removed.
        rt.active = null;
        rt.stepIndex = 0;
        rt.stepElapsed = 0;
        rt.stepStarted = false;
        rt.stepFrom = null;
        return;
      }
      rt.active = def;
      var steps = Array.isArray(def.steps) ? def.steps : [];
      var guard = 0;
      while (rt.active && guard++ < 10000) {
        if (rt.stepIndex >= steps.length) { finishCutscene(rt); break; }
        // Steps are normalized by the getCutscene above, so every step
        // here is a known kind — a damaged step is dropped there, and
        // the timeline never stalls on one.
        var step = steps[rt.stepIndex];
        if (!rt.stepStarted) {
          var doneAtOnce = startStep(rt, step, hooks);
          rt.stepStarted = true;
          rt.stepElapsed = 0;
          if (doneAtOnce) { advanceStep(rt); continue; }
        }
        rt.stepElapsed += dt;
        if (step.kind === 'move') applyMove(rt, step, hooks);
        if (rt.stepElapsed >= saneSeconds(step.seconds)) {
          if (step.kind === 'move') {
            callHook(hooks, 'setObjectPosition', [step.object, step.x, step.y]);
          }
          advanceStep(rt);
          // The next step's start effects run in this same frame, but
          // its clock starts next frame — dt is spent, never reused.
          dt = 0;
          continue;
        }
        break;
      }
    } catch (e) { /* a throwing update never breaks the frame */ }
  }

  // True while the named cutscene is playing. A blank name means any
  // cutscene — true while one is running at all.
  function isCutscenePlaying(rt, name) {
    try {
      if (!isRuntime(rt) || !rt.active) return false;
      var want = saneName(name);
      if (!want) return true;
      return rt.active.name === want;
    } catch (e) {
      return false;
    }
  }

  // True while the named cutscene is the most recently finished one
  // (a natural ending or a stop both count). A blank name means any
  // cutscene finished most recently. Stays true until another
  // cutscene finishes or the same one plays again — the flow system's
  // edge trigger is what fires once on the change.
  function isCutsceneFinished(rt, name) {
    try {
      if (!isRuntime(rt)) return false;
      var fin = saneName(rt.lastFinished);
      if (!fin) return false;
      var want = saneName(name);
      if (!want) return true;
      return fin === want;
    } catch (e) {
      return false;
    }
  }

  function isCutsceneAction(type) {
    return type === 'playCutscene' || type === 'stopCutscene';
  }

  function isCutsceneCondition(type) {
    return type === 'cutscenePlaying' || type === 'cutsceneFinished';
  }

  return {
    DEFAULT_SECONDS: DEFAULT_SECONDS,
    STEP_KINDS: STEP_KINDS.slice(),
    normalizeCutscenes: normalizeCutscenes,
    normalizeStep: normalizeStep,
    cutsceneNames: cutsceneNames,
    getCutscene: getCutscene,
    createCutsceneRuntime: createCutsceneRuntime,
    playCutscene: playCutscene,
    stopCutscene: stopCutscene,
    updateCutscene: updateCutscene,
    isCutscenePlaying: isCutscenePlaying,
    isCutsceneFinished: isCutsceneFinished,
    isCutsceneAction: isCutsceneAction,
    isCutsceneCondition: isCutsceneCondition
  };
}

if (typeof window !== 'undefined') {
  window.HydraCutscene = hydraCutsceneFactory();
  // Self-contained source of the factory, inlined into exported playable games
  // by HydraPlayer.buildPlayableHtml so exports run without editor files.
  window.HydraCutscene.factorySource = hydraCutsceneFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraCutsceneFactory;
