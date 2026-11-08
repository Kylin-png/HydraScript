/* ============================================================================
 * hydra-joystick.js — HydraScript shared virtual joystick (P4 Advanced
 * batch 20: on-screen touch joystick, beginner edition).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation
 * of the on-screen stick a player drags to steer — used by:
 *   - the editor preview runtime (hydra-previewruntime.js delegates
 *     to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Idea (Unity on-screen joystick / Godot TouchScreenButton + virtual
 * joystick, beginner edition): a phone game has no keyboard, so the
 * player needs a stick on the glass. The joystick is a fixed base
 * circle at a screen corner (bottom-left by default) with a knob the
 * finger drags: tilt left and the player walks left, tilt up and the
 * player jumps — without a single extra block, because the stick
 * feeds the two systems the game already has:
 *
 *   variables — every frame the stick writes its tilt into two game
 *     variables (joystickX / joystickY by default, -1..1): chain a
 *     Joystick Tilt condition, or a Move Object by joystickX block,
 *     and the character steers. Released, both read 0, so movement
 *     stops on its own.
 *   named actions — the stick can drive up to four named input
 *     actions from the Inputs tab (Move Left / Move Right / Jump /
 *     Interact): tilt past a third of the way and the action reads
 *     held, with just-pressed / released edges exactly like a key.
 *     A keyboard game becomes a phone game by naming four actions.
 *
 *   base — the stick's base circle sits at a fixed screen anchor
 *     (bottom-left, bottom-right, or a custom screen position), so
 *     the player always knows where to reach. A press only grabs the
 *     stick when it starts inside the base (plus a small slack ring);
 *     a press anywhere else is a normal click or touch, so buttons
 *     and touch zones keep working. A grabbed pointer never also
 *     clicks a button or fires a touch zone.
 *   runtime — the live stick lives in one record (enabled, the
 *     grabbed pointer id, the base center, the knob offset, the
 *     -1..1 tilt). The Joystick tab sets the project default
 *     (off until turned on); the Enable / Disable Joystick blocks
 *     flip the live stick during a run. The record is run state
 *     only — a fresh run mints a fresh stick from the project
 *     default, and it never travels in save slots.
 *   output — applyJoystickOutput runs once per frame, after the
 *     input poll and before the scripts, so a condition reading
 *     joystickX or an Action Input reading a driven action sees
 *     this frame's tilt. It runs while paused too, like the input
 *     poll, so a pause menu can still be steered.
 *   draw — drawJoystick paints the base + knob in screen space,
 *     above the HUD objects and below the scene-transition overlay.
 *     The base shows whenever the stick is on, so the player can
 *     find it; the knob follows the finger.
 *
 * A mouse drag grabs the stick too, so the same game can be
 * playtested on a desktop without a touchscreen.
 *
 * Nothing ever throws; hostile input degrades to safe defaults.
 * Old projects have no joystick blocks and no virtualJoystick
 * config, so they behave exactly as before.
 *
 * Honest limits: the base is fixed at its anchor (no floating stick
 * that appears where the finger lands); one stick only, no second
 * stick for a twin-stick shooter yet; the tilt drives actions past a
 * fixed third-of-the-way threshold, not a per-action one; a grabbed
 * pointer cannot also click a button underneath the stick; no `hs`
 * script-API surface yet.
 *
 * Load order (index.html): hydra-joystick.js BEFORE player-runtime.js
 * and script.js. player-runtime.js throws a clear error if HydraJoystick
 * is missing.
 * ========================================================================== */

function hydraJoystickFactory() {
  'use strict';

  var ANCHORS = ['bottom-left', 'bottom-right', 'custom'];
  var DEFAULT_ANCHOR = 'bottom-left';
  var DEFAULT_RADIUS = 60;
  var MIN_RADIUS = 20;
  var MAX_RADIUS = 200;
  var DEFAULT_KNOB_RADIUS = 24;
  var MIN_KNOB_RADIUS = 8;
  var MAX_KNOB_RADIUS = 100;
  var DEFAULT_DEADZONE = 0.15;
  var MIN_DEADZONE = 0;
  var MAX_DEADZONE = 0.9;
  var DEFAULT_VAR_X = 'joystickX';
  var DEFAULT_VAR_Y = 'joystickY';
  var DEFAULT_X = 120;
  var DEFAULT_Y = 480;
  // Tilt past this fraction of the stick drives the named action
  // (a third of the way — far enough that a resting thumb never
  // fires it, close enough that a deliberate tilt always does).
  var ACTION_TILT = 0.35;
  // Pixels beyond the base circle that still grab the stick, so a
  // finger landing just outside the ring does not miss.
  var GRAB_SLACK = 12;
  var EDGE = 16;

  // A usable number, or the fallback when the value is not one.
  // null / undefined / '' count as missing (Number(null) is 0, which
  // would silently read as a real value instead of the fallback).
  function saneNum(v, fallback) {
    if (v == null || v === '') return fallback;
    var n = Number(v);
    return isFinite(n) ? n : fallback;
  }

  function clamp(v, lo, hi) {
    if (!isFinite(v)) return lo;
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
  }

  // --- Config normalization ------------------------------------------------

  // One anchor name, lowercased and trimmed. Anything unknown reads
  // as bottom-left, so a typo never strands the stick off-screen.
  function normalizeAnchor(value) {
    try {
      var a = String(value == null ? '' : value).trim().toLowerCase();
      return ANCHORS.indexOf(a) !== -1 ? a : DEFAULT_ANCHOR;
    } catch (e) {
      return DEFAULT_ANCHOR;
    }
  }

  // The base circle radius in screen pixels: 20..200, default 60.
  function normalizeRadius(value) {
    if (value == null || value === '') return DEFAULT_RADIUS;
    var n = Number(value);
    if (!isFinite(n)) return DEFAULT_RADIUS;
    return clamp(n, MIN_RADIUS, MAX_RADIUS);
  }

  // The knob radius in screen pixels: 8..100, default 24.
  function normalizeKnobRadius(value) {
    if (value == null || value === '') return DEFAULT_KNOB_RADIUS;
    var n = Number(value);
    if (!isFinite(n)) return DEFAULT_KNOB_RADIUS;
    return clamp(n, MIN_KNOB_RADIUS, MAX_KNOB_RADIUS);
  }

  // The dead zone as a fraction of the full tilt: 0..0.9, default
  // 0.15. Inside it the stick reads exactly 0, so a resting thumb
  // never drifts the player.
  function normalizeDeadzone(value) {
    if (value == null || value === '') return DEFAULT_DEADZONE;
    var n = Number(value);
    if (!isFinite(n)) return DEFAULT_DEADZONE;
    return clamp(n, MIN_DEADZONE, MAX_DEADZONE);
  }

  // A variable or action name: a trimmed string, or '' for anything
  // else (blank means "don't write that one" — a game that only
  // steers with actions leaves the variable names empty).
  function normalizeName(value) {
    try {
      if (typeof value !== 'string') return '';
      return value.trim();
    } catch (e) {
      return '';
    }
  }

  // A fresh project default: the stick is off until the Joystick tab
  // or an Enable Joystick block turns it on, so old projects behave
  // exactly as before.
  function defaultJoystickConfig() {
    return {
      enabled: false,
      anchor: DEFAULT_ANCHOR,
      x: DEFAULT_X,
      y: DEFAULT_Y,
      radius: DEFAULT_RADIUS,
      knobRadius: DEFAULT_KNOB_RADIUS,
      deadzone: DEFAULT_DEADZONE,
      varX: DEFAULT_VAR_X,
      varY: DEFAULT_VAR_Y,
      actionLeft: '',
      actionRight: '',
      actionUp: '',
      actionDown: ''
    };
  }

  // Repair a joystick config in place (the editor tab holds the live
  // record while it renders, so the same object must come back). A
  // non-object reads as a fresh default. Keep in sync with the
  // project default in HydraUniversal.normalizeProject.
  function normalizeJoystickConfig(cfg) {
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return defaultJoystickConfig();
    cfg.enabled = cfg.enabled === true;
    cfg.anchor = normalizeAnchor(cfg.anchor);
    cfg.x = saneNum(cfg.x, DEFAULT_X);
    cfg.y = saneNum(cfg.y, DEFAULT_Y);
    cfg.radius = normalizeRadius(cfg.radius);
    cfg.knobRadius = normalizeKnobRadius(cfg.knobRadius);
    cfg.deadzone = normalizeDeadzone(cfg.deadzone);
    cfg.varX = normalizeName(cfg.varX);
    cfg.varY = normalizeName(cfg.varY);
    cfg.actionLeft = normalizeName(cfg.actionLeft);
    cfg.actionRight = normalizeName(cfg.actionRight);
    cfg.actionUp = normalizeName(cfg.actionUp);
    cfg.actionDown = normalizeName(cfg.actionDown);
    return cfg;
  }

  // --- Runtime record ------------------------------------------------------

  // A fresh live stick: off, no pointer grabbed, centered at rest.
  // createJoystickRuntime(cfg) starts enabled when the project
  // default says so; the Enable / Disable Joystick blocks flip the
  // flag during a run.
  function createJoystickRuntime(cfg) {
    var enabled = false;
    try {
      var c = (cfg && typeof cfg === 'object') ? cfg : null;
      enabled = !!(c && c.enabled === true);
    } catch (e) { enabled = false; }
    return {
      enabled: enabled,
      pointerId: null,
      baseX: 0,
      baseY: 0,
      dx: 0,
      dy: 0,
      x: 0,
      y: 0
    };
  }

  // True while a pointer holds the stick.
  function isActive(rt) {
    try {
      return !!(rt && rt.pointerId != null);
    } catch (e) {
      return false;
    }
  }

  // True while the player is actually steering — grabbed and tilted
  // past the dead zone, so a held-but-centered stick reads quiet.
  function isSteering(rt) {
    try {
      if (!isActive(rt)) return false;
      return (rt.x !== 0 || rt.y !== 0);
    } catch (e) {
      return false;
    }
  }

  // --- Geometry ------------------------------------------------------------

  // The base circle's center in screen pixels. Bottom-left and
  // bottom-right sit one radius plus a margin in from the corner;
  // custom reads the configured X/Y, clamped so the base never hangs
  // off the screen. A missing view size reads as 800x600.
  function joystickBase(cfg, viewW, viewH) {
    try {
      var c = normalizeJoystickConfig(cfg);
      var w = saneNum(viewW, 800);
      var h = saneNum(viewH, 600);
      var r = c.radius;
      if (c.anchor === 'bottom-right') {
        return { x: Math.max(r, w - r - EDGE), y: Math.max(r, h - r - EDGE) };
      }
      if (c.anchor === 'custom') {
        return {
          x: clamp(c.x, r, Math.max(r, w - r)),
          y: clamp(c.y, r, Math.max(r, h - r))
        };
      }
      return { x: r + EDGE, y: Math.max(r, h - r - EDGE) };
    } catch (e) {
      return { x: DEFAULT_RADIUS + EDGE, y: 600 - DEFAULT_RADIUS - EDGE };
    }
  }

  // --- Pointer handling ----------------------------------------------------

  // Grab the stick: a press that starts inside the base circle (plus
  // the slack ring) claims the pointer, parks the base at its anchor,
  // and centers the knob. Returns true when the pointer was grabbed
  // (the caller then skips the click / touch-zone handling for it).
  // False when the stick is off, already held, or the press missed
  // the base — the press stays an ordinary click.
  function joystickStart(rt, cfg, pointerId, px, py, viewW, viewH) {
    try {
      if (!rt || typeof rt !== 'object') return false;
      if (rt.enabled !== true) return false;
      if (pointerId == null) return false;
      if (isActive(rt)) return false;
      var c = normalizeJoystickConfig(cfg);
      var base = joystickBase(c, viewW, viewH);
      var dx = saneNum(px, 0) - base.x;
      var dy = saneNum(py, 0) - base.y;
      if (Math.sqrt(dx * dx + dy * dy) > c.radius + GRAB_SLACK) return false;
      rt.pointerId = pointerId;
      rt.baseX = base.x;
      rt.baseY = base.y;
      rt.dx = 0;
      rt.dy = 0;
      rt.x = 0;
      rt.y = 0;
      return true;
    } catch (e) {
      return false;
    }
  }

  // Drag the grabbed stick: the knob follows the pointer, clamped to
  // the base circle, and the tilt reads -1..1 on each axis with the
  // dead zone applied (inside it the tilt is exactly 0; past it the
  // tilt rescales so full tilt still reads 1). The knob offset keeps
  // the raw clamped pointer position, so the knob shows where the
  // finger is even inside the dead zone. Returns false for a pointer
  // that does not hold the stick.
  function joystickMove(rt, cfg, pointerId, px, py) {
    try {
      if (!rt || typeof rt !== 'object') return false;
      if (!isActive(rt) || rt.pointerId !== pointerId) return false;
      var c = normalizeJoystickConfig(cfg);
      var dx = saneNum(px, rt.baseX) - saneNum(rt.baseX, 0);
      var dy = saneNum(py, rt.baseY) - saneNum(rt.baseY, 0);
      var len = Math.sqrt(dx * dx + dy * dy);
      if (len > c.radius) {
        dx = dx / len * c.radius;
        dy = dy / len * c.radius;
        len = c.radius;
      }
      rt.dx = dx;
      rt.dy = dy;
      var x = dx / c.radius;
      var y = dy / c.radius;
      var mag = Math.sqrt(x * x + y * y);
      if (mag < c.deadzone || mag === 0) {
        rt.x = 0;
        rt.y = 0;
      } else {
        var scaled = (mag - c.deadzone) / (1 - c.deadzone);
        rt.x = x / mag * scaled;
        rt.y = y / mag * scaled;
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  // Release the stick: the pointer lets go, the knob springs back to
  // center, and the tilt reads 0 again. Returns false for a pointer
  // that does not hold the stick.
  function joystickEnd(rt, pointerId) {
    try {
      if (!rt || typeof rt !== 'object') return false;
      if (!isActive(rt) || rt.pointerId !== pointerId) return false;
      rt.pointerId = null;
      rt.baseX = 0;
      rt.baseY = 0;
      rt.dx = 0;
      rt.dy = 0;
      rt.x = 0;
      rt.y = 0;
      return true;
    } catch (e) {
      return false;
    }
  }

  // --- Reads ---------------------------------------------------------------

  // True while the stick tilts the picked way past the minimum tilt
  // (0..1, default 0.5). 'up' is negative Y, like screen coordinates;
  // 'any' reads the tilt magnitude, so a diagonal counts. Quiet
  // when the stick is not held.
  function joystickTilt(rt, direction, minTilt) {
    try {
      if (!isActive(rt)) return false;
      var dir = String(direction == null ? 'any' : direction).trim().toLowerCase();
      var m = saneNum(minTilt, 0.5);
      m = clamp(m, 0, 1);
      var x = saneNum(rt.x, 0);
      var y = saneNum(rt.y, 0);
      if (dir === 'up') return -y >= m;
      if (dir === 'down') return y >= m;
      if (dir === 'left') return -x >= m;
      if (dir === 'right') return x >= m;
      return Math.sqrt(x * x + y * y) >= m;
    } catch (e) {
      return false;
    }
  }

  // The named input actions the stick holds right now: tilt past a
  // third of the way left / right / up / down holds that direction's
  // action (a diagonal holds two). Blank names are skipped, and a
  // name used twice is listed once. Empty when the stick is not
  // steering.
  function joystickHeldActions(cfg, rt) {
    var held = [];
    try {
      if (!isSteering(rt)) return held;
      var c = normalizeJoystickConfig(cfg);
      var x = saneNum(rt.x, 0);
      var y = saneNum(rt.y, 0);
      function add(name) {
        if (name && held.indexOf(name) === -1) held.push(name);
      }
      if (x <= -ACTION_TILT) add(c.actionLeft);
      if (x >= ACTION_TILT) add(c.actionRight);
      if (y <= -ACTION_TILT) add(c.actionUp);
      if (y >= ACTION_TILT) add(c.actionDown);
    } catch (e) { /* a hostile config never breaks the frame */ }
    return held;
  }

  // --- Per-frame output ----------------------------------------------------

  // Write this frame's tilt into the game's variables: varX reads
  // the horizontal tilt (-1 left, 1 right), varY the vertical tilt
  // (-1 up, 1 down); released, both read 0, so movement stops on its
  // own. Only runs while the stick is on — a game that never turns
  // it on gets no joystick variables at all. hooks.setVariable(name,
  // value) is the host's variable write. Returns how many variables
  // were written. Never throws.
  function applyJoystickOutput(rt, cfg, hooks) {
    var written = 0;
    try {
      if (!rt || rt.enabled !== true) return 0;
      if (!hooks || typeof hooks.setVariable !== 'function') return 0;
      var c = normalizeJoystickConfig(cfg);
      var x = isActive(rt) ? saneNum(rt.x, 0) : 0;
      var y = isActive(rt) ? saneNum(rt.y, 0) : 0;
      if (c.varX) {
        try { hooks.setVariable(c.varX, x); written++; } catch (e) { /* one bad write never breaks the frame */ }
      }
      if (c.varY && c.varY !== c.varX) {
        try { hooks.setVariable(c.varY, y); written++; } catch (e) { /* one bad write never breaks the frame */ }
      } else if (c.varY && c.varY === c.varX) {
        // The same name for both axes writes the horizontal tilt;
        // the vertical tilt has nowhere to go, so it stays unwritten.
      }
      return written;
    } catch (e) {
      return written;
    }
  }

  // --- Draw ----------------------------------------------------------------

  // Paint the stick in screen space: the base circle (faint fill +
  // outline, always shown while the stick is on so the player can
  // find it) and the knob at its dragged offset. Returns true when
  // something was drawn, false when the stick is off or the context
  // cannot draw. Never throws.
  function drawJoystick(ctx, rt, cfg, viewW, viewH) {
    try {
      if (!ctx || typeof ctx !== 'object') return false;
      if (!rt || rt.enabled !== true) return false;
      if (typeof ctx.beginPath !== 'function' || typeof ctx.arc !== 'function') return false;
      var c = normalizeJoystickConfig(cfg);
      var base = joystickBase(c, viewW, viewH);
      var knobX = base.x + saneNum(rt.dx, 0);
      var knobY = base.y + saneNum(rt.dy, 0);
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(base.x, base.y, c.radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(knobX, knobY, c.knobRadius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.stroke();
      ctx.restore();
      return true;
    } catch (e) {
      try { ctx.restore(); } catch (e2) { /* a throwing draw never breaks the frame */ }
      return false;
    }
  }

  // --- Routing -------------------------------------------------------------

  function isJoystickAction(type) {
    return type === 'enableJoystick' || type === 'disableJoystick';
  }

  function isJoystickCondition(type) {
    return type === 'joystickActive' || type === 'joystickTilt';
  }

  return {
    ANCHORS: ANCHORS,
    DEFAULT_ANCHOR: DEFAULT_ANCHOR,
    DEFAULT_RADIUS: DEFAULT_RADIUS,
    MIN_RADIUS: MIN_RADIUS,
    MAX_RADIUS: MAX_RADIUS,
    DEFAULT_KNOB_RADIUS: DEFAULT_KNOB_RADIUS,
    MIN_KNOB_RADIUS: MIN_KNOB_RADIUS,
    MAX_KNOB_RADIUS: MAX_KNOB_RADIUS,
    DEFAULT_DEADZONE: DEFAULT_DEADZONE,
    MIN_DEADZONE: MIN_DEADZONE,
    MAX_DEADZONE: MAX_DEADZONE,
    DEFAULT_VAR_X: DEFAULT_VAR_X,
    DEFAULT_VAR_Y: DEFAULT_VAR_Y,
    ACTION_TILT: ACTION_TILT,
    GRAB_SLACK: GRAB_SLACK,
    normalizeAnchor: normalizeAnchor,
    normalizeRadius: normalizeRadius,
    normalizeKnobRadius: normalizeKnobRadius,
    normalizeDeadzone: normalizeDeadzone,
    normalizeName: normalizeName,
    defaultJoystickConfig: defaultJoystickConfig,
    normalizeJoystickConfig: normalizeJoystickConfig,
    createJoystickRuntime: createJoystickRuntime,
    isActive: isActive,
    isSteering: isSteering,
    joystickBase: joystickBase,
    joystickStart: joystickStart,
    joystickMove: joystickMove,
    joystickEnd: joystickEnd,
    joystickTilt: joystickTilt,
    joystickHeldActions: joystickHeldActions,
    applyJoystickOutput: applyJoystickOutput,
    drawJoystick: drawJoystick,
    isJoystickAction: isJoystickAction,
    isJoystickCondition: isJoystickCondition
  };
}

if (typeof window !== 'undefined') {
  window.HydraJoystick = hydraJoystickFactory();
  // Self-contained source of the factory, inlined into exported playable games
  // by HydraPlayer.buildPlayableHtml so exports run without editor files.
  window.HydraJoystick.factorySource = hydraJoystickFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraJoystickFactory;
