/* ============================================================================
 * hydra-statemachine.js — HydraScript shared animation state machine helpers.
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation of
 * animation state machines used by:
 *   - the editor preview runtime (script.js delegates to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Idea (Unity Animator / Godot AnimationTree, beginner edition): an object
 * lists named STATES, each bound to one of its sprite animations plus a
 * playback speed. The Set Animation State block enters a state (the bound
 * animation starts playing automatically); the Animation State condition
 * reads the current state so the logic grid drives transitions with the
 * same blocks users already know:
 *
 *   Every Frame -> [Action Held "right"] -> [Set Animation State "Run"]
 *   Every Frame -> [NOT Action Held "right"] -> [Set Animation State "Idle"]
 *
 * States are data; transitions are blocks. Anything a state machine does
 * can be rebuilt by hand from Play Animation blocks, so this is an
 * organizer, never a cage.
 *
 * Data model (stored on the object, saved in project JSON):
 *   obj.animStates = [
 *     { name: 'Idle', animation: 'Idle', speed: 1 },
 *     { name: 'Run',  animation: 'Run',  speed: 1.25 }
 *   ];
 *   obj.animStateInitial = 'Idle';  // optional: entered when the game/scene starts
 *
 * A state with no animation bound (animation: '') just records the state —
 * useful as a pure logic flag. Speed multiplies the animation's fps
 * (applied through HydraAnim.setSpeed by the host runtimes).
 *
 * Runtime state (NOT saved; per object, created fresh at game/scene start):
 *   { state: 'Idle' }
 *
 * Load order (index.html): hydra-statemachine.js BEFORE player-runtime.js and
 * script.js. player-runtime.js throws a clear error if HydraStateMachine is
 * missing.
 * ========================================================================== */

function hydraStateMachineFactory() {
  'use strict';

  var DEFAULT_SPEED = 1;

  function saneName(v, fallback) {
    var s = String(v == null ? '' : v).trim();
    return s.length ? s : fallback;
  }

  function saneSpeed(v) {
    var s = Number(v);
    return (isFinite(s) && s > 0) ? s : DEFAULT_SPEED;
  }

  // Normalize an object's state list in place. Corrupt/hand-edited entries
  // are repaired (blank names filled, duplicate names suffixed, bad speeds
  // reset to 1), so old projects (no `animStates` field at all) and
  // malformed data keep working instead of crashing.
  function normalizeStates(obj) {
    if (!obj || typeof obj !== 'object') return [];
    var list = obj.animStates;
    if (!Array.isArray(list)) { obj.animStates = []; return obj.animStates; }
    var seen = {};
    obj.animStates = list.filter(function (st) {
      return st && typeof st === 'object';
    }).map(function (st, i) {
      var name = saneName(st.name, 'State ' + (i + 1));
      if (seen[name]) name = name + ' ' + (i + 1);
      seen[name] = true;
      return {
        name: name,
        animation: String(st.animation == null ? '' : st.animation),
        speed: saneSpeed(st.speed)
      };
    });
    return obj.animStates;
  }

  function stateNames(obj) {
    return normalizeStates(obj).map(function (st) { return st.name; });
  }

  // The state record with exactly this name, or null.
  function getState(obj, name) {
    var want = String(name == null ? '' : name);
    if (!want) return null;
    var list = normalizeStates(obj);
    for (var i = 0; i < list.length; i++) {
      if (list[i].name === want) return list[i];
    }
    return null;
  }

  function createRuntime() {
    return { state: '' };
  }

  function currentState(rt) {
    if (!rt || typeof rt.state !== 'string') return '';
    return rt.state;
  }

  // Enter the named state.
  // hooks = { warn(msg), play(animName, speed) } — both optional.
  // Returns true when the state was entered. Blank names are a quiet no-op
  // (no per-frame warning spam); unknown names warn and hold the old state.
  // Never throws.
  function setState(rt, obj, name, hooks) {
    try {
      if (!rt || !obj || typeof obj !== 'object') return false;
      var want = String(name == null ? '' : name).trim();
      if (!want) return false;
      var st = getState(obj, want);
      if (!st) {
        if (hooks && typeof hooks.warn === 'function') {
          hooks.warn('Set Animation State: no state named "' + want + '" on this object. The state was not changed.');
        }
        return false;
      }
      rt.state = st.name;
      if (st.animation && hooks && typeof hooks.play === 'function') {
        hooks.play(st.animation, st.speed);
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  // Enter obj.animStateInitial when one is set. Returns true when a state
  // was entered. Unknown initial names warn once (game/scene start, not
  // per frame).
  function enterInitial(rt, obj, hooks) {
    try {
      if (!rt || !obj || typeof obj !== 'object') return false;
      var initial = String(obj.animStateInitial == null ? '' : obj.animStateInitial).trim();
      if (!initial) return false;
      return setState(rt, obj, initial, hooks);
    } catch (e) {
      return false;
    }
  }

  return {
    DEFAULT_SPEED: DEFAULT_SPEED,
    normalizeStates: normalizeStates,
    stateNames: stateNames,
    getState: getState,
    createRuntime: createRuntime,
    currentState: currentState,
    setState: setState,
    enterInitial: enterInitial
  };
}

window.HydraStateMachine = hydraStateMachineFactory();
// Self-contained source of the factory, inlined into exported playable games
// by HydraPlayer.buildPlayableHtml so exports run without editor files.
window.HydraStateMachine.factorySource = hydraStateMachineFactory.toString();
