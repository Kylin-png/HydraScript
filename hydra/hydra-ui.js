/* ============================================================================
 * hydra-ui.js — HydraScript shared UI-widget helpers (F2: menus & HUD).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation of
 * UI widget layout used by:
 *   - the editor preview runtime (script.js delegates to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Data model (fields on a project object; all optional, repaired by
 * normalizeUiFields so old projects keep working):
 *   obj.anchor       'none' (default) or one of the 9 screen anchors below.
 *                    Anchored objects ignore the camera: their screen
 *                    position is resolved from the viewport size.
 *   obj.hud          true  -> drawn last, on top of everything,
 *                    camera-independent (the HUD layer).
 *   obj.buttonStyle  { normal, hover, pressed, radius } hex colors used for
 *                    button backgrounds (buttons = kind 'text' objects with
 *                    the Button component).
 *   obj.cornerRadius number, rounded-corner radius for buttons and panels.
 *   obj.borderColor / obj.borderWidth  optional outline for panels/buttons.
 *
 * Anchor semantics (the simple on-ramp, GDevelop-anchor style):
 *   The anchor picks a point on the SCREEN (e.g. 'top-right' = the screen's
 *   top-right corner) and the matching point on the widget (the widget's own
 *   top-right corner). With X=0,Y=0 those two points coincide; X/Y are a
 *   signed offset in pixels (positive = right/down). Example: anchor
 *   'top-right', X=-20, Y=20 parks the widget 20px in from the top-right
 *   corner of the screen, whatever the camera is doing.
 *
 * Load order (index.html): hydra-ui.js BEFORE player-runtime.js and
 * script.js. player-runtime.js throws a clear error if HydraUi is missing.
 * ========================================================================== */

function hydraUiFactory() {
  'use strict';

  var ANCHORS = [
    { value: 'none',          label: 'None — use world position' },
    { value: 'top-left',      label: 'Top left' },
    { value: 'top-center',    label: 'Top center' },
    { value: 'top-right',     label: 'Top right' },
    { value: 'center-left',   label: 'Middle left' },
    { value: 'center',        label: 'Center' },
    { value: 'center-right',  label: 'Middle right' },
    { value: 'bottom-left',   label: 'Bottom left' },
    { value: 'bottom-center',  label: 'Bottom center' },
    { value: 'bottom-right',   label: 'Bottom right' }
  ];

  // Maps an anchor value to [screen point fraction, widget point fraction].
  // Screen point = (fx * vw, fy * vh); widget point = (fx * w, fy * h).
  var ANCHOR_POINTS = {
    'top-left':     [0,   0  ],
    'top-center':   [0.5, 0  ],
    'top-right':    [1,   0  ],
    'center-left':  [0,   0.5],
    'center':       [0.5, 0.5],
    'center-right': [1,   0.5],
    'bottom-left':  [0,   1  ],
    'bottom-center':[0.5, 1  ],
    'bottom-right': [1,   1  ]
  };

  var DEFAULT_BUTTON_STYLE = {
    normal: '#3b82f6',
    hover: '#60a5fa',
    pressed: '#1d4ed8'
  };
  var DEFAULT_CORNER_RADIUS = 8;
  // Legacy default text color given to buttons before F2 drew button
  // backgrounds. Bumped to white so old-project buttons stay readable on
  // the new default blue fill. Projects that customized the color keep it.
  var LEGACY_BUTTON_TEXT_COLOR = '#111827';
  var BUTTON_TEXT_COLOR = '#ffffff';

  function normalizeAnchor(a) {
    return Object.prototype.hasOwnProperty.call(ANCHOR_POINTS, a) ? a : 'none';
  }

  function isAnchored(obj) {
    return normalizeAnchor(obj && obj.anchor) !== 'none';
  }

  function isHudObject(obj) {
    return !!(obj && obj.hud === true);
  }

  // Camera-independent by construction: anchored objects and HUD objects
  // never move with the camera.
  function isScreenFixed(obj) {
    if (!obj) return false;
    return isAnchored(obj) || isHudObject(obj) || obj.uiPinned === true;
  }

  function hasButtonComponent(obj) {
    if (!obj) return false;
    if (obj.archetype === 'button') return true;
    var comps = obj.components;
    if (!Array.isArray(comps)) return false;
    for (var i = 0; i < comps.length; i++) {
      var c = comps[i];
      if (c === 'Button' || (c && c.type === 'Button')) return true;
    }
    return false;
  }

  function isButton(obj) {
    return !!obj && obj.kind === 'text' && hasButtonComponent(obj);
  }

  function isPanel(obj) {
    return !!obj && (obj.kind === 'panel' || obj.archetype === 'panel');
  }

  // Resolve the object's top-left corner in SCREEN pixels for the given
  // viewport size. 'none' returns the world position untouched (the caller
  // applies the camera transform); any real anchor returns screen coords.
  function resolveWidgetPosition(obj, vw, vh) {
    var x = Number(obj && obj.posX) || 0;
    var y = Number(obj && obj.posY) || 0;
    var anchor = normalizeAnchor(obj && obj.anchor);
    if (anchor === 'none') return { x: x, y: y };
    var w = Math.max(0, Number(obj.width) || 0);
    var h = Math.max(0, Number(obj.height) || 0);
    var pt = ANCHOR_POINTS[anchor];
    var ax = pt[0] * vw;
    var ay = pt[1] * vh;
    var ox = pt[0] * w;
    var oy = pt[1] * h;
    return { x: ax + x - ox, y: ay + y - oy };
  }

  function cleanColor(v, fallback) {
    return (typeof v === 'string' && v.length > 0) ? v : fallback;
  }

  // Which background fill a button should draw right now.
  // uiState: 'normal' | 'hover' | 'pressed'.
  function buttonFillFor(obj, uiState) {
    var style = (obj && obj.buttonStyle) || {};
    var fill = style.normal;
    if (uiState === 'hover') fill = style.hover !== undefined ? style.hover : style.normal;
    else if (uiState === 'pressed') fill = style.pressed !== undefined ? style.pressed : style.normal;
    var r = Number(obj && obj.cornerRadius);
    if (!isFinite(r) || r < 0) r = DEFAULT_CORNER_RADIUS;
    return {
      fill: cleanColor(fill, DEFAULT_BUTTON_STYLE.normal),
      radius: r
    };
  }

  function normalizeButtonStyle(obj) {
    var style = (obj.buttonStyle && typeof obj.buttonStyle === 'object') ? obj.buttonStyle : {};
    obj.buttonStyle = {
      normal: cleanColor(style.normal, DEFAULT_BUTTON_STYLE.normal),
      hover: cleanColor(style.hover, DEFAULT_BUTTON_STYLE.hover),
      pressed: cleanColor(style.pressed, DEFAULT_BUTTON_STYLE.pressed)
    };
    // Old projects: buttons were text-only with the legacy dark text color.
    // They now get a filled background, so repair readability. Buttons with
    // no text color at all also default to white on the colored fill.
    if (obj.textColor === LEGACY_BUTTON_TEXT_COLOR || obj.textColor == null) obj.textColor = BUTTON_TEXT_COLOR;
    if (obj.cornerRadius === undefined || obj.cornerRadius === null) obj.cornerRadius = DEFAULT_CORNER_RADIUS;
  }

  // Repair/normalize every UI field on an object. Safe to call on any
  // object (widgets or not); never throws on corrupt data.
  function normalizeUiFields(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    try {
      obj.anchor = normalizeAnchor(obj.anchor);
      obj.hud = obj.hud === true;
      if (isButton(obj)) normalizeButtonStyle(obj);
      if (isPanel(obj)) {
        if (obj.cornerRadius === undefined || obj.cornerRadius === null) obj.cornerRadius = 12;
        if (obj.borderWidth === undefined || obj.borderWidth === null) obj.borderWidth = 0;
      }
    } catch (e) { /* normalize must never crash the editor */ }
    return obj;
  }

  return {
    ANCHORS: ANCHORS,
    DEFAULT_BUTTON_STYLE: DEFAULT_BUTTON_STYLE,
    DEFAULT_CORNER_RADIUS: DEFAULT_CORNER_RADIUS,
    normalizeAnchor: normalizeAnchor,
    isAnchored: isAnchored,
    isHudObject: isHudObject,
    isScreenFixed: isScreenFixed,
    isButton: isButton,
    isPanel: isPanel,
    resolveWidgetPosition: resolveWidgetPosition,
    buttonFillFor: buttonFillFor,
    normalizeUiFields: normalizeUiFields
  };
}

window.HydraUi = hydraUiFactory();
// Self-contained source of the factory, inlined into exported playable games
// by HydraPlayer.buildPlayableHtml so exports run without editor files.
window.HydraUi.factorySource = hydraUiFactory.toString();
