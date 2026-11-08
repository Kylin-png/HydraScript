/* ============================================================================
 * hydra-sceneinit.js — HydraScript shared scene-load object init (P2 item
 * 15/12, slice 2: the shared-engine extraction continues here).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation of
 * the fresh-runtime-state sequence every object gets when it enters the
 * live world — at scene load and when a spawn block creates a clone — used by:
 *   - the editor preview runtime (hydra-previewruntime.js delegates to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Why this slice second: the per-object init block was the next subsystem
 * the two runtimes duplicated verbatim — same velocity resets, same fresh
 * animation / state-machine / blend / skeleton runtimes, same autoplay of
 * the play-at-start animation, same initial-state entry, same fresh tween
 * state — in three places at once (export loadScene, export spawnAt, preview
 * launchPreview), while the preview's other three entry points (scene
 * switches in loadPreviewScene, spawnObject, spawnAtObject) only did a thin
 * subset of it. Moving it into one module closes those divergences instead
 * of relocating them.
 *
 * Semantics (identical in preview and exports — changing anything here
 * changes every entry point at once, which is the point):
 *   - initSceneObjects(objects, hooks): for each object, 2D velocity to 0,
 *     3D velocity to 0, _runtimeText cleared, _alive true, a fresh sprite
 *     animation state (autoplaying startAnimation when one is set), a fresh
 *     animation state machine (entering animStateInitial when one is set —
 *     the initial state wins over play-at-start, exactly as both runtimes
 *     behaved), a fresh blend runtime, a fresh skeleton runtime, and fresh
 *     tween state (_tweens = [], _tweenFinished = []). The subsystem modules
 *     arrive through `hooks` ({ anim, stateMachine, blendSpace, skeleton,
 *     warn }) so the module never reads a global: the export passes its
 *     hard-guarded modules, the preview passes window.HydraAnim etc. (or
 *     null when a tag is missing). A missing subsystem degrades to a null
 *     runtime field — the preview's `?.` behavior — and the gameLoop's lazy
 *     init covers _anim/_blends/_skel on the next frame.
 *   - applyBoundTexts(objects, localization, language, boundTextFor): the
 *     localization pass that runs at the same points — text objects bound
 *     to a string-table key start with their translation in the run's
 *     current language. Unbound texts and keys with no translation keep
 *     their authored text. boundTextFor is HydraLocalization.boundTextFor
 *     (passed in, never read off a global); without it the pass is a no-op.
 *   - Nothing here ever throws: a null/non-array object list is a no-op, a
 *     null entry is skipped, a throwing subsystem call leaves that one
 *     runtime field null and the rest of the object still initializes, and
 *     a throwing boundTextFor leaves that object's text untouched. (The old
 *     inline code would have thrown out of loadScene on a throwing
 *     subsystem call and taken the whole scene load down; the module
 *     degrades instead, like every other shared module.)
 *
 * Behavior changes vs the old inline code (all in the direction the code
 * already documented with "(mirrors the export)" / "(mirrors the editor
 * preview)" comments — the two runtimes were supposed to agree and did not):
 *   - Preview scene switches (loadPreviewScene) now run the FULL init:
 *     start animations autoplay, initial animation states are entered, 3D
 *     velocity resets, and tween state is fresh — previously only the
 *     launch did this, so a scene switched into mid-game started its
 *     objects half-initialized while the same switch in an export started
 *     them fully.
 *   - Preview spawns (spawnObject, spawnAtObject) now run the full init:
 *     spawned clones autoplay their start animation and enter their
 *     initial state, matching the export's spawnAt. Previously preview
 *     clones only got velocity/_alive/_runtimeText, so a spawned enemy
 *     with a play-at-start animation sat on frame 0 in the preview while
 *     the exported game animated it.
 *   - Export spawns (spawnAt) now also reset 3D velocity, _runtimeText,
 *     and _alive through the same call, matching the preview's spawn
 *     fields; all three were already 0/undefined/true-equivalent on a
 *     fresh clone, so no live behavior changes there.
 *
 * Load order (index.html): hydra-sceneinit.js BEFORE player-runtime.js and
 * script.js. player-runtime.js throws a clear error if HydraSceneInit is
 * missing. The preview guards every call (window.HydraSceneInit), so the
 * editor still boots if the tag is ever dropped — objects just start with
 * no runtime state, the same degradation the other guarded modules use.
 * ========================================================================== */

function hydraSceneInitFactory() {
  'use strict';

  // Call a subsystem's no-arg factory (createAnimState, createRuntime,
  // createBlendRuntime, createSkeletonRuntime). A missing module or method
  // degrades to null (the preview's `?.` behavior); a throwing factory
  // degrades to null too, so one bad subsystem never breaks scene load.
  // An undefined return is also null — the preview's `|| null` behavior.
  function createRuntime(mod, method) {
    if (!mod || typeof mod[method] !== 'function') return null;
    try {
      var r = mod[method]();
      return (r === undefined || r === null) ? null : r;
    } catch (e) {
      return null;
    }
  }

  // Fresh runtime state for every object in the list: the sequence a scene
  // load and a spawn both run when an object enters the live world.
  // hooks: { anim, stateMachine, blendSpace, skeleton, warn } — each
  // subsystem module or null, warn a function (default no-op). Returns the
  // list (or [] for a non-array input). Never throws.
  function initSceneObjects(objects, hooks) {
    var list = Array.isArray(objects) ? objects : [];
    hooks = hooks || {};
    var anim = hooks.anim || null;
    var sm = hooks.stateMachine || null;
    var blends = hooks.blendSpace || null;
    var skel = hooks.skeleton || null;
    var warn = typeof hooks.warn === 'function' ? hooks.warn : function () {};
    var canPlay = anim && typeof anim.play === 'function';
    var canSetSpeed = anim && typeof anim.setSpeed === 'function';
    list.forEach(function (o) {
      if (!o || typeof o !== 'object') return;
      try {
        o.velX = 0;
        o.velY = 0;
        // P4 item 3D4: 3D velocity starts at rest per scene load / spawn.
        o.vel3x = 0;
        o.vel3y = 0;
        o.vel3z = 0;
        o._runtimeText = undefined;
        o._alive = true;
        // Sprite animations: fresh playback state; autoplay the object's
        // "play at start" animation when one is set.
        o._anim = createRuntime(anim, 'createAnimState');
        if (o.startAnimation && canPlay && o._anim) {
          try { anim.play(o._anim, o, o.startAnimation); } catch (e) { /* a bad play never breaks scene load */ }
        }
        // P4 Advanced (animation state machines): fresh machine state; the
        // initial state wins over play-at-start when set.
        o._sm = createRuntime(sm, 'createRuntime');
        if (o.animStateInitial && sm && typeof sm.enterInitial === 'function' && o._sm) {
          try {
            sm.enterInitial(o._sm, o, {
              warn: warn,
              play: function (animName, speed) {
                if (!o._anim || !canPlay) return;
                try { anim.play(o._anim, o, animName); } catch (e) { /* never break scene load */ }
                if (canSetSpeed) {
                  try { anim.setSpeed(o._anim, speed); } catch (e) { /* never break scene load */ }
                }
              }
            });
          } catch (e) { /* a bad initial state never breaks scene load */ }
        }
        // P4 Advanced (blend spaces): fresh blend runtime; nothing is
        // active until the Set Blend block runs.
        o._blends = createRuntime(blends, 'createBlendRuntime');
        // P4 Advanced (skeletal animation): fresh skeleton runtime; nothing
        // plays until Play Skeleton Animation runs.
        o._skel = createRuntime(skel, 'createSkeletonRuntime');
        // Tweens: fresh transient run state.
        o._tweens = [];
        o._tweenFinished = [];
      } catch (e) { /* one bad object never breaks scene load */ }
    });
    return list;
  }

  // The localization pass that runs at the same points as initSceneObjects:
  // text objects bound to a string-table key start with their translation
  // in the run's current language. Unbound texts and keys with no
  // translation keep their authored text. boundTextFor is
  // HydraLocalization.boundTextFor (passed in, never read off a global);
  // without it the pass is a no-op. Returns the list (or [] for a non-array
  // input). Never throws.
  function applyBoundTexts(objects, localization, language, boundTextFor) {
    var list = Array.isArray(objects) ? objects : [];
    if (typeof boundTextFor !== 'function') return list;
    list.forEach(function (o) {
      if (!o || typeof o !== 'object') return;
      try {
        var bound = boundTextFor(o, localization, language);
        if (bound !== null && bound !== undefined) o._runtimeText = bound;
      } catch (e) { /* a bad lookup leaves the authored text untouched */ }
    });
    return list;
  }

  return {
    initSceneObjects: initSceneObjects,
    applyBoundTexts: applyBoundTexts
  };
}

window.HydraSceneInit = hydraSceneInitFactory();
// Self-contained source of the factory, inlined into exported playable games
// by HydraPlayer.buildPlayableHtml so exports run without editor files.
window.HydraSceneInit.factorySource = hydraSceneInitFactory.toString();
