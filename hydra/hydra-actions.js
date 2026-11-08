/* ============================================================================
 * hydra-actions.js — HydraScript action-based input.
 *
 * Pure logic, no DOM access. Single canonical source for named input
 * actions used by the editor preview runtime (script.js) and the exported
 * player runtime (player-runtime.js). Exported games inline factorySource
 * via HydraPlayer.buildPlayableHtml, so exports never depend on editor
 * files.
 *
 * An action is a named input ("Jump", "Move Left", "Shoot") that can be
 * driven by keyboard keys, a gamepad button, and/or a touch zone. Blocks
 * read actions instead of raw keys, so a game stays playable when a
 * player uses a gamepad or a touchscreen, and players can remap keys at
 * runtime (see remapAction / resetBindings).
 *
 * Load order (index.html): hydra-actions.js BEFORE player-runtime.js and
 * script.js. player-runtime.js throws a clear error if HydraActions is
 * missing.
 * ========================================================================== */

function hydraActionsFactory() {
  'use strict';

  // Touch zones: a point on the canvas always sits in exactly one
  // horizontal zone and one vertical zone, so a finger can drive two
  // actions at once (e.g. "Move Left" on the left half + "Jump" on the
  // right half — multi-touch works because zones are a set).
  var TOUCH_ZONES = ['left-half', 'right-half', 'top-half', 'bottom-half'];
  var TOUCH_ZONE_LABELS = {
    'left-half': 'Left half of screen',
    'right-half': 'Right half of screen',
    'top-half': 'Top half of screen',
    'bottom-half': 'Bottom half of screen'
  };

  // Standard gamepad mapping button indexes with plain-language labels.
  var GAMEPAD_BUTTONS = [
    [0, 'A / Cross'], [1, 'B / Circle'], [2, 'X / Square'], [3, 'Y / Triangle'],
    [4, 'Left bumper (LB)'], [5, 'Right bumper (RB)'],
    [6, 'Left trigger (LT)'], [7, 'Right trigger (RT)'],
    [8, 'Back / Select'], [9, 'Start'],
    [10, 'Left stick click'], [11, 'Right stick click'],
    [12, 'D-pad up'], [13, 'D-pad down'], [14, 'D-pad left'], [15, 'D-pad right']
  ];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  // Duck-type a Set: vm sandboxes and host contexts have different Set
  // constructors, so `instanceof Set` is unreliable across boundaries.
  function asSet(v) {
    return (v && typeof v.has === 'function' && typeof v.add === 'function') ? v : new Set();
  }

  function cleanName(name) {
    return String(name == null ? '' : name).trim().slice(0, 40);
  }

  // Repair a raw project.inputActions value into a clean array of
  // {name, keys[], gamepad, touch}. Never throws; corrupt entries are
  // dropped or repaired so old or hand-edited project JSON cannot crash
  // the editor or an exported game.
  function normalizeActions(raw) {
    if (!Array.isArray(raw)) return [];
    var seen = {};
    var out = [];
    raw.forEach(function (entry) {
      try {
        if (!entry || typeof entry !== 'object') return;
        var name = cleanName(entry.name);
        if (!name || seen[name]) return;
        seen[name] = true;
        var keys = [];
        var rawKeys = entry.keys == null ? [] : (Array.isArray(entry.keys) ? entry.keys : [entry.keys]);
        rawKeys.forEach(function (k) {
          var key = String(k == null ? '' : k).trim();
          if (key && keys.indexOf(key) === -1 && keys.length < 8) keys.push(key);
        });
        // Legacy single-key field ("key") still works: it becomes the
        // primary binding.
        if (!keys.length && entry.key != null) {
          var legacy = String(entry.key).trim();
          if (legacy) keys.push(legacy);
        }
        var gamepad = Math.floor(Number(entry.gamepad));
        if (!isFinite(gamepad) || gamepad < 0 || gamepad > 15) gamepad = -1;
        var touch = TOUCH_ZONES.indexOf(entry.touch) === -1 ? 'none' : entry.touch;
        out.push({ name: name, keys: keys, gamepad: gamepad, touch: touch });
      } catch (e) { /* one bad entry never breaks the list */ }
    });
    return out;
  }

  function actionNames(normalized) {
    return normalizeActions(normalized).map(function (a) { return a.name; });
  }

  // Transient per-run state. `defaults` is a private deep copy so
  // resetBindings() always restores what the project shipped with, even
  // after remapAction() calls.
  function createRuntimeState(normalized) {
    var list = normalizeActions(normalized);
    var bindings = {};
    list.forEach(function (a) { bindings[a.name] = clone(a); });
    return {
      defaults: clone(list),
      bindings: bindings,
      held: new Set(),
      justPressed: new Set(),
      justReleased: new Set(),
      _prevAux: {}
    };
  }

  function hasAction(state, name) {
    return !!state && !!state.bindings && Object.prototype.hasOwnProperty.call(state.bindings, name);
  }

  function actionHeld(state, name) {
    return !!state && asSet(state.held).has(name);
  }

  function actionJustPressed(state, name) {
    return !!state && asSet(state.justPressed).has(name);
  }

  function actionJustReleased(state, name) {
    return !!state && asSet(state.justReleased).has(name);
  }

  // Change the keyboard binding of a named action while the game runs
  // (the building block for a settings / controls menu). Returns true
  // when the action existed and the key was accepted.
  function remapAction(state, name, key) {
    if (!hasAction(state, name)) return false;
    var clean = String(key == null ? '' : key).trim();
    if (!clean) return false;
    state.bindings[name].keys = [clean];
    return true;
  }

  // Restore every action to the project's configured bindings.
  function resetBindings(state) {
    if (!state) return;
    var bindings = {};
    (state.defaults || []).forEach(function (a) { bindings[a.name] = clone(a); });
    state.bindings = bindings;
  }

  // Safely poll pressed gamepad buttons through an injected getter so
  // this module stays DOM-free and testable in node. Returns a Set of
  // button indexes (0-15) that are currently pressed.
  function pollGamepadButtons(getGamepads) {
    var pressed = new Set();
    try {
      if (typeof getGamepads !== 'function') return pressed;
      var pads = getGamepads() || [];
      for (var i = 0; i < pads.length; i++) {
        var pad = pads[i];
        if (!pad || !pad.buttons) continue;
        for (var b = 0; b < pad.buttons.length && b < 16; b++) {
          var btn = pad.buttons[b];
          if (btn && (btn.pressed || Number(btn.value) > 0.5)) pressed.add(b);
        }
      }
    } catch (e) { /* a hostile getter never breaks the frame */ }
    return pressed;
  }

  // P4 item 37 batch 7 (raw input blocks): is at least one gamepad
  // connected? True when any non-null pad exists — buttons are not
  // required (a connected pad with no buttons pressed still counts).
  // Never throws; a hostile getter reads as "no gamepad".
  function isGamepadConnected(getGamepads) {
    try {
      if (typeof getGamepads !== 'function') return false;
      var pads = getGamepads() || [];
      for (var i = 0; i < pads.length; i++) {
        if (pads[i]) return true;
      }
      return false;
    } catch (e) { return false; }
  }

  // P4 item 37 batch 7 (raw input blocks): read the analog stick axes of
  // the first connected gamepad. Returns { lx, ly, rx, ry } in -1..1
  // (lx/ly = left stick, rx/ry = right stick). Non-finite or missing
  // axes read as 0; hostile getters never throw.
  function pollGamepadAxes(getGamepads) {
    var zero = { lx: 0, ly: 0, rx: 0, ry: 0 };
    try {
      if (typeof getGamepads !== 'function') return zero;
      var pads = getGamepads() || [];
      var pad = null;
      for (var i = 0; i < pads.length; i++) {
        if (pads[i]) { pad = pads[i]; break; }
      }
      if (!pad || !pad.axes || pad.axes.length === 0) return zero;
      return {
        lx: clampAxis(pad.axes[0]),
        ly: clampAxis(pad.axes[1]),
        rx: clampAxis(pad.axes[2]),
        ry: clampAxis(pad.axes[3])
      };
    } catch (e) { return zero; }
  }

  function clampAxis(v) {
    var n = Number(v);
    if (!isFinite(n)) return 0;
    return Math.max(-1, Math.min(1, n));
  }

  // Which touch zones contain the canvas point (x, y)? A point is always
  // in one horizontal zone and one vertical zone.
  function zonesAt(x, y, width, height) {
    var w = Number(width) || 1, h = Number(height) || 1;
    var zones = [];
    zones.push(Number(x) < w / 2 ? 'left-half' : 'right-half');
    zones.push(Number(y) < h / 2 ? 'top-half' : 'bottom-half');
    return zones;
  }

  // Advance action state one frame. sources:
  //   keys / keysJustPressed / keysJustReleased — Sets of key ids
  //   gamepad — Set of pressed button indexes (see pollGamepadButtons)
  //   touchZones — Set of active touch-zone names (see zonesAt)
  //   joystick — Set of action names the virtual joystick holds
  //     (P4 Advanced batch 20): the stick drives named actions the
  //     same way a key does, so a tilted stick holds Move Left with
  //     just-pressed / released edges exactly like a key press.
  //   keySetHas(set, key) — optional alias-aware key matcher (HydraInput);
  //     falls back to a plain set lookup when not provided.
  // Edge sets (justPressed/justReleased) are cleared and recomputed here,
  // once per frame, before scripts run — the same rhythm as the raw key
  // edge sets in both runtimes.
  function update(state, sources) {
    if (!state) return;
    sources = sources || {};
    state.justPressed = asSet(state.justPressed);
    state.justReleased = asSet(state.justReleased);
    state.held = asSet(state.held);
    state.justPressed.clear();
    state.justReleased.clear();
    var setHas = typeof sources.keySetHas === 'function'
      ? sources.keySetHas
      : function (set, key) { return asSet(set).has(key); };
    var keys = asSet(sources.keys);
    var keysJP = asSet(sources.keysJustPressed);
    var keysJR = asSet(sources.keysJustReleased);
    var pad = asSet(sources.gamepad);
    var zones = asSet(sources.touchZones);
    var joy = asSet(sources.joystick);
    Object.keys(state.bindings || {}).forEach(function (name) {
      var b = state.bindings[name];
      var keyList = Array.isArray(b.keys) ? b.keys : [];
      var keyHeld = keyList.some(function (k) { return setHas(keys, k); });
      var keyJP = keyList.some(function (k) { return setHas(keysJP, k); });
      var keyJR = keyList.some(function (k) { return setHas(keysJR, k); });
      var auxHeld = (b.gamepad >= 0 && pad.has(b.gamepad)) || (b.touch !== 'none' && zones.has(b.touch)) || joy.has(name);
      var prevAux = !!state._prevAux[name];
      state._prevAux[name] = auxHeld;
      var held = keyHeld || auxHeld;
      if (held) state.held.add(name); else state.held.delete(name);
      if (keyJP || (auxHeld && !prevAux)) state.justPressed.add(name);
      if (keyJR || (!auxHeld && prevAux)) state.justReleased.add(name);
    });
  }

  // One-tap starter set for the editor's "Add platformer preset" button.
  function defaultPlatformerActions() {
    return [
      { name: 'Move Left', keys: ['ArrowLeft', 'KeyA'], gamepad: 14, touch: 'left-half' },
      { name: 'Move Right', keys: ['ArrowRight', 'KeyD'], gamepad: 15, touch: 'right-half' },
      { name: 'Jump', keys: ['Space', 'ArrowUp', 'KeyW'], gamepad: 0, touch: 'none' },
      { name: 'Shoot', keys: ['KeyF'], gamepad: 2, touch: 'none' },
      { name: 'Interact', keys: ['KeyE'], gamepad: 3, touch: 'none' }
    ];
  }

  return {
    TOUCH_ZONES: TOUCH_ZONES,
    TOUCH_ZONE_LABELS: TOUCH_ZONE_LABELS,
    GAMEPAD_BUTTONS: GAMEPAD_BUTTONS,
    normalizeActions: normalizeActions,
    actionNames: actionNames,
    createRuntimeState: createRuntimeState,
    hasAction: hasAction,
    actionHeld: actionHeld,
    actionJustPressed: actionJustPressed,
    actionJustReleased: actionJustReleased,
    remapAction: remapAction,
    resetBindings: resetBindings,
    pollGamepadButtons: pollGamepadButtons,
    isGamepadConnected: isGamepadConnected,
    pollGamepadAxes: pollGamepadAxes,
    zonesAt: zonesAt,
    update: update,
    defaultPlatformerActions: defaultPlatformerActions
  };
}

window.HydraActions = hydraActionsFactory();
// Self-contained source of the factory, inlined into exported playable games
// by HydraPlayer.buildPlayableHtml so exports run without editor files.
window.HydraActions.factorySource = hydraActionsFactory.toString();
