/* ============================================================================
 * hydra-transition.js — HydraScript shared scene transitions
 * (P4 Advanced batch 14: fade / wipe between scenes, beginner edition).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation
 * of scene transitions used by:
 *   - the editor preview runtime (hydra-previewruntime.js delegates
 *     to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Idea (Unity SceneManager.LoadScene with a transition / Godot scene
 * transitions / Unreal level-streaming fades, beginner edition): a
 * scene change does not have to be an instant cut. The Transition to
 * Scene block plays a short effect — the screen fades to black (or a
 * black panel wipes across) and then fades back in on the new scene —
 * so level changes, menu entries, and game-over returns feel finished
 * instead of abrupt:
 *
 *   Player touches the door -> Transition to Scene "Level 2"
 *   Transition Finished "Level 2" (edge) -> Show "Level 2" banner
 *
 * The project default lives on `project.sceneTransition`
 * ({ effect, duration }, set in the Transitions tab); every
 * Transition to Scene block can override the effect and the duration
 * for that one switch, or leave them on Default. The plain Switch
 * Scene block stays an instant cut — transitions are the deliberate
 * on-ramp, never a change to what already worked.
 *
 * Effects:
 *   fade — the screen fades to black, the scene switches, then it
 *          fades back in. The default.
 *   wipe — a black panel sweeps across the screen left to right,
 *          the scene switches under full cover, then the panel slides
 *          off to the right.
 *   none — no effect at all; the switch is an instant cut (the same
 *          as Switch Scene). A per-call 'cut' override means the
 *          same thing for one block.
 *
 * `duration` is the TOTAL transition time in seconds (default 0.5):
 * the first half fades/wipes out, the scene switches, the second
 * half fades/wipes back in. A duration of 0 is an instant cut.
 *
 * Runtime state (NOT part of the save-slot payload; per-run state):
 *   { phase: 'idle' | 'out' | 'in', effect, duration, elapsed,
 *     pendingScene, lastFinished }
 * The runtime survives scene switches inside a run — it has to, the
 * transition IS the switch — and resets only on a fresh run. It
 * never travels in save slots (slots store game variables only).
 *
 * How the switch happens: the host's scene switch is deferred to the
 * end of the frame in both runtimes (the pending-scene phase), and
 * the draw happens after that — so when the out half ends, the module
 * calls hooks.switchScene (which queues the switch) and enters the
 * in half at once; the same frame's draw already shows the new scene
 * under the fade-in. A transition freezes while paused (it moves the
 * world, so the pause freeze applies — the update returns early while
 * paused); the Transition Playing / Transition Finished conditions
 * keep evaluating while paused, like the other state reads.
 *
 * Starting a transition replaces one already playing (the new one
 * wins, like Play Cutscene). Cancel Transition aborts an out half
 * and stays in the current scene (no finish is recorded), or finishes
 * an in half at once (the scene already switched, so the finish
 * counts). Blank scene names stay quiet; unknown scenes warn and
 * hold — a typo never leaves the game stuck on black. Nothing ever
 * throws; hostile input degrades to safe defaults.
 *
 * Honest limits: there is one transition at a time, and only the two
 * effects above (no custom colors — the overlay is always black, and
 * no per-effect easing; a wipe is a straight linear sweep); the
 * transition does not travel inside save slots (replay it after Load
 * Game, or gate on Transition Finished); and the transition follows
 * the time scale like a cutscene does, because both runtimes feed it
 * the scaled frame step — a fade at half speed takes twice as long.
 * Old projects have no sceneTransition field and behave exactly as
 * before (plain Switch Scene is still an instant cut).
 *
 * Load order (index.html): hydra-transition.js BEFORE player-runtime.js
 * and script.js. player-runtime.js throws a clear error if
 * HydraTransition is missing.
 * ========================================================================== */

function hydraTransitionFactory() {
  'use strict';

  var EFFECTS = ['fade', 'wipe', 'none'];
  var DEFAULT_EFFECT = 'fade';
  var DEFAULT_DURATION = 0.5;
  var MAX_DURATION = 10;

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

  // An effect name, or the fallback when the value is not one of the
  // three effects. Never throws.
  function normalizeEffect(value, fallback) {
    try {
      var e = saneName(value).toLowerCase();
      if (EFFECTS.indexOf(e) !== -1) return e;
      return fallback;
    } catch (err) {
      return fallback;
    }
  }

  // A duration in seconds: a finite number >= 0 capped at 10, else
  // the default. 0 is legal — the transition is an instant cut.
  function normalizeDuration(value) {
    var n = Number(value);
    if (!isFinite(n) || n < 0) return DEFAULT_DURATION;
    return n > MAX_DURATION ? MAX_DURATION : n;
  }

  // Normalize the project's transition config IN PLACE — the record
  // keeps its identity across calls, so the Transitions tab holds the
  // live config while it renders (the high-score lesson). A missing
  // or wrong-shaped config reads as the default; a bad effect falls
  // back to fade, a bad duration to 0.5 seconds. Never throws.
  function normalizeTransitionConfig(config) {
    try {
      if (!config || typeof config !== 'object' || Array.isArray(config)) {
        return { effect: DEFAULT_EFFECT, duration: DEFAULT_DURATION };
      }
      config.effect = normalizeEffect(config.effect, DEFAULT_EFFECT);
      config.duration = normalizeDuration(config.duration);
      return config;
    } catch (err) {
      return { effect: DEFAULT_EFFECT, duration: DEFAULT_DURATION };
    }
  }

  // A fresh per-run transition runtime. Nothing is playing yet.
  function createTransitionRuntime() {
    return {
      phase: 'idle',
      effect: DEFAULT_EFFECT,
      duration: DEFAULT_DURATION,
      elapsed: 0,
      pendingScene: null,
      lastFinished: null
    };
  }

  function isRuntime(rt) {
    return !!rt && typeof rt === 'object';
  }

  function warnHook(hooks, msg) {
    try {
      if (hooks && typeof hooks.warn === 'function') hooks.warn(msg);
    } catch (e) { /* a throwing warn never breaks the transition */ }
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

  // Loose scene match: a numeric scene id and its string form are the
  // same scene, so the Transition to Scene block (which stores the
  // numeric id from the scene select) and the conditions (same select)
  // agree with a name passed in from a cutscene step or a script.
  function scenesMatch(a, b) {
    var x = saneName(a);
    var y = saneName(b);
    if (!x || !y) return false;
    return x === y;
  }

  // Half of a duration, guarded so a hostile runtime with a zero or
  // negative duration still completes instead of dividing by zero.
  function halfOf(duration) {
    var d = saneNum(duration, DEFAULT_DURATION);
    if (!isFinite(d) || d <= 0) return 0;
    return d / 2;
  }

  function clamp01(v) {
    if (!isFinite(v)) return 0;
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
  }

  // The fraction of the current half that has played (0..1). A zero
  // half reads as complete — a hostile duration never stalls the
  // transition on a half that never ends.
  function halfProgress(rt) {
    var half = halfOf(rt.duration);
    if (half <= 0) return 1;
    var e = saneNum(rt.elapsed, 0);
    if (!isFinite(e) || e < 0) e = 0;
    return clamp01(e / half);
  }

  // Start a transition to the named scene (name or numeric id).
  // `opts` carries the block's per-call overrides: effect
  // ('default' / 'fade' / 'wipe' / 'cut', missing reads as 'default')
  // and duration (a number of seconds; null / undefined / blank reads
  // as the configured default). A 'cut' effect, a 'none' effect, or a
  // 0 duration switches at once instead of fading. Blank scene names
  // stay quiet; unknown scenes warn and hold. Starting replaces a
  // transition already playing. Returns true when a transition
  // started (or an instant switch happened).
  function startTransition(rt, config, scene, opts, hooks) {
    try {
      if (!isRuntime(rt)) return false;
      var target = saneName(scene);
      if (!target) return false;
      var cfg = normalizeTransitionConfig(config);
      var o = opts && typeof opts === 'object' ? opts : {};
      var effect = saneName(o.effect).toLowerCase();
      if (!effect || effect === 'default') effect = cfg.effect;
      if (effect === 'cut') effect = 'none';
      effect = normalizeEffect(effect, cfg.effect);
      var duration = o.duration;
      if (duration == null || (typeof duration === 'string' && duration.trim() === '')) {
        duration = cfg.duration;
      }
      duration = normalizeDuration(duration);
      // The scene must exist before anything fades: check through the
      // hook when the host offers one; when it does not, the switch
      // itself is the check (an instant switch that fails warns and
      // holds; a faded switch warns and ends at the out half).
      var exists = callHook(hooks, 'sceneExists', [target]);
      if (exists === false) {
        warnHook(hooks, 'Transition to Scene: no scene named "' + target + '". Nothing changed.');
        return false;
      }
      if (effect === 'none' || duration <= 0) {
        var switched = callHook(hooks, 'switchScene', [target]);
        if (switched !== true) {
          warnHook(hooks, 'Transition to Scene: no scene named "' + target + '". Nothing changed.');
          return false;
        }
        rt.phase = 'idle';
        rt.effect = effect;
        rt.duration = duration;
        rt.elapsed = 0;
        rt.pendingScene = null;
        rt.lastFinished = target;
        return true;
      }
      rt.phase = 'out';
      rt.effect = effect;
      rt.duration = duration;
      rt.elapsed = 0;
      rt.pendingScene = target;
      // A new transition clears the finished record, so the
      // Transition Finished edge fires again when this one ends.
      rt.lastFinished = null;
      return true;
    } catch (e) {
      return false;
    }
  }

  // Advance the running transition one frame. dtSeconds is real
  // seconds (the host converts from its 60fps-unit dt — the scaled
  // step, so a transition follows the time scale like a cutscene
  // does). Frozen while paused. When the out half ends the scene
  // switches through the hook and the in half starts at once: the
  // host applies the queued switch before it draws, so the same
  // frame already shows the new scene under the fade-in. A switch
  // that fails (the scene was deleted mid-transition) warns and ends
  // the transition without marking finished. Never throws.
  function updateTransition(rt, config, dtSeconds, hooks) {
    try {
      if (!isRuntime(rt)) return;
      if (pausedHook(hooks)) return;
      if (rt.phase !== 'out' && rt.phase !== 'in') return;
      var dt = Number(dtSeconds);
      if (!isFinite(dt) || dt < 0) dt = 0;
      rt.elapsed = saneNum(rt.elapsed, 0) + dt;
      var half = halfOf(rt.duration);
      // The epsilon: a frame step is 1/60s, and fifteen of those sum
      // to 0.24999999999999997, not 0.25 — without it a 0.5-second
      // fade would take 31 frames instead of 30. A nanosecond of
      // slack never shows; a frame of delay would.
      if (rt.phase === 'out') {
        if (rt.elapsed + 1e-9 >= half) {
          var target = rt.pendingScene;
          var switched = callHook(hooks, 'switchScene', [target]);
          if (switched !== true) {
            warnHook(hooks, 'Transition to Scene: no scene named "' + target + '". The transition ended.');
            rt.phase = 'idle';
            rt.elapsed = 0;
            rt.pendingScene = null;
            return;
          }
          rt.phase = 'in';
          rt.elapsed = 0;
        }
        return;
      }
      // phase === 'in'
      if (rt.elapsed + 1e-9 >= half) {
        rt.lastFinished = rt.pendingScene;
        rt.phase = 'idle';
        rt.elapsed = 0;
        rt.pendingScene = null;
      }
    } catch (e) { /* a throwing update never breaks the frame */ }
  }

  // Cancel the running transition. An out half aborts and the game
  // stays in the current scene (no finish is recorded — a cancel is
  // not an ending). An in half finishes at once (the scene already
  // switched, so the finish counts). Returns true when one was
  // running.
  function cancelTransition(rt) {
    try {
      if (!isRuntime(rt)) return false;
      if (rt.phase === 'out') {
        rt.phase = 'idle';
        rt.elapsed = 0;
        rt.pendingScene = null;
        return true;
      }
      if (rt.phase === 'in') {
        rt.lastFinished = rt.pendingScene;
        rt.phase = 'idle';
        rt.elapsed = 0;
        rt.pendingScene = null;
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  // True while a transition is playing. A blank scene means any
  // transition — true while one is running at all; a named one is
  // true only while transitioning to that scene.
  function isTransitionPlaying(rt, scene) {
    try {
      if (!isRuntime(rt)) return false;
      if (rt.phase !== 'out' && rt.phase !== 'in') return false;
      var want = saneName(scene);
      if (!want) return true;
      return scenesMatch(rt.pendingScene, want);
    } catch (e) {
      return false;
    }
  }

  // True while the named scene is the most recently transitioned-to
  // one (a natural ending, an instant switch, or a cancel during the
  // in half all count). A blank name means any transition finished
  // most recently. The record stays until another transition finishes
  // or a new one starts — the flow system's edge trigger is what
  // fires once on the change.
  function isTransitionFinished(rt, scene) {
    try {
      if (!isRuntime(rt)) return false;
      var fin = saneName(rt.lastFinished);
      if (!fin) return false;
      var want = saneName(scene);
      if (!want) return true;
      return scenesMatch(fin, want);
    } catch (e) {
      return false;
    }
  }

  // Overall progress across the whole transition (0..1): the out
  // half covers 0..0.5, the in half 0.5..1. Idle with a finished
  // transition reads as 1; idle with nothing finished reads as 0.
  function transitionProgress(rt) {
    try {
      if (!isRuntime(rt)) return 0;
      if (rt.phase === 'out') return clamp01(0.5 * halfProgress(rt));
      if (rt.phase === 'in') return clamp01(0.5 + 0.5 * halfProgress(rt));
      return saneName(rt.lastFinished) ? 1 : 0;
    } catch (e) {
      return 0;
    }
  }

  // The overlay's opacity right now (0..1): ramping 0 -> 1 across
  // the out half, 1 -> 0 across the in half, 0 while idle.
  function transitionAlpha(rt) {
    try {
      if (!isRuntime(rt)) return 0;
      if (rt.phase === 'out') return halfProgress(rt);
      if (rt.phase === 'in') return 1 - halfProgress(rt);
      return 0;
    } catch (e) {
      return 0;
    }
  }

  // Paint the transition overlay onto a canvas 2d context, in screen
  // space (the host calls this after its draw, when the transform is
  // back to identity). Fade fills the whole canvas black at the
  // current alpha; wipe sweeps a black panel across — growing from
  // the left while fading out, sliding off to the right while fading
  // back in. Idle draws nothing. Never throws; a missing or hostile
  // context is a quiet no-op.
  function drawTransition(ctx, width, height, rt) {
    try {
      if (!ctx || typeof ctx !== 'object') return;
      if (!isRuntime(rt)) return;
      if (rt.phase !== 'out' && rt.phase !== 'in') return;
      var w = Number(width);
      var h = Number(height);
      if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return;
      var t = halfProgress(rt);
      if (typeof ctx.save === 'function') ctx.save();
      try {
        if (rt.effect === 'wipe') {
          ctx.fillStyle = '#000000';
          if (rt.phase === 'out') {
            ctx.fillRect(0, 0, w * t, h);
          } else {
            ctx.fillRect(w * t, 0, w * (1 - t), h);
          }
        } else {
          // fade (and any unknown effect, which reads as a fade)
          ctx.fillStyle = 'rgba(0,0,0,' + transitionAlpha(rt) + ')';
          ctx.fillRect(0, 0, w, h);
        }
      } finally {
        if (typeof ctx.restore === 'function') ctx.restore();
      }
    } catch (e) { /* a throwing draw never breaks the frame */ }
  }

  function isTransitionAction(type) {
    return type === 'transitionToScene' || type === 'cancelTransition';
  }

  function isTransitionCondition(type) {
    return type === 'transitionPlaying' || type === 'transitionFinished';
  }

  return {
    EFFECTS: EFFECTS.slice(),
    DEFAULT_EFFECT: DEFAULT_EFFECT,
    DEFAULT_DURATION: DEFAULT_DURATION,
    MAX_DURATION: MAX_DURATION,
    normalizeEffect: normalizeEffect,
    normalizeDuration: normalizeDuration,
    normalizeTransitionConfig: normalizeTransitionConfig,
    createTransitionRuntime: createTransitionRuntime,
    startTransition: startTransition,
    updateTransition: updateTransition,
    cancelTransition: cancelTransition,
    isTransitionPlaying: isTransitionPlaying,
    isTransitionFinished: isTransitionFinished,
    transitionProgress: transitionProgress,
    transitionAlpha: transitionAlpha,
    drawTransition: drawTransition,
    isTransitionAction: isTransitionAction,
    isTransitionCondition: isTransitionCondition
  };
}

if (typeof window !== 'undefined') {
  window.HydraTransition = hydraTransitionFactory();
  // Self-contained source of the factory, inlined into exported playable games
  // by HydraPlayer.buildPlayableHtml so exports run without editor files.
  window.HydraTransition.factorySource = hydraTransitionFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraTransitionFactory;
