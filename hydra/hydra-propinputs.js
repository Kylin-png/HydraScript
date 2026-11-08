/* HydraPropInputs — property-panel input builders for the editor.
 *
 * P2 item 14 (editor becomes a DOM-only module), slices 2 + 3: the
 * small input primitives every property panel is made of — the labelled
 * group, the select, the number and text inputs, the checkbox, the
 * color and multi-line text inputs, and the one-line note — plus the
 * editor-state builders that read live editor state: the invert toggle,
 * the object / input-action / audio-asset / animation / state / blend
 * name selects, the key picker, the target-mode select, and the
 * expression input with its suggestion panel.
 *
 * This is a DOM module, not a pure one: it builds real elements, so
 * the node tests drive it through a vm sandbox with a fake document
 * (tests/propinputs.test.js). Its only editor dependencies are injected
 * through configure() — script.js passes markProjectDirty plus the
 * live-state providers at load; without them the module marks nothing
 * dirty and the name lists read empty, so it loads and runs standalone.
 *
 * Providers (all optional, all replaced only by functions):
 *   onDirty            — called after every successful edit.
 *   getObjectNames     — () => string[] of scene object names.
 *   getInputActionNames — () => string[] of named input actions.
 *   getAnimationNames  — (objectName) => string[] of animation names.
 *   getStateNames      — (objectName) => string[] of animation-state names.
 *   getBlendNames      — (objectName) => string[] of blend-space names.
 *   getVariableNames   — () => string[] of known game-variable names.
 *   getAudioAssets     — () => [assetId, name][] of uploaded audio assets.
 *   getKeyAliases      — (keyboardEvent) => string[] of key aliases.
 *   setCellData        — (cellIndex, data) => void, writes a block record
 *                        back into the editor's grid cell map.
 *
 * Conventions (per the other hydra-*.js modules): nothing ever throws —
 * hostile input degrades to safe defaults. Where this module
 * deliberately differs from the old inline code, the difference is
 * noted at the function. makeColorInput / makeTextareaInput are new
 * primitives, but their bodies are the exact code previously inlined
 * in makeCatalogFieldInput's color / textarea cases.
 *
 * Documented behavior deltas (slice 3): a throwing provider degrades
 * to its safe default (empty name list, no-op cell write, key-alias
 * fallback to the raw event key) instead of breaking the panel; a
 * missing document makes every builder return null, including the
 * key picker and expression input; makeKeyPicker listens on the
 * module's document (the global document in the editor) instead of a
 * hard-coded global, which is the same object in the browser.
 *
 * makeCatalogFieldInput stays in script.js as the catalog dispatcher —
 * it dispatches on catalog controls and editor state — but its
 * primitive cases route through this module. The name-list getters
 * (getAllObjectNames, getObjectAnimationNames, getObjectStateNames,
 * getObjectBlendNames, getKnownVariableNames, getEventKeyAliases,
 * getProjectInputActions) stay in script.js as providers: they read
 * live editor state, and this module only ever calls them through the
 * injected providers.
 *
 * Follows the hydra-*.js factorySource pattern. Exports never inline
 * this module (exported games have no property panels); factorySource
 * is kept so the module stays re-instantiable and testable like the
 * rest of the family.
 */
function hydraPropInputsFactory() {
  'use strict';

  // Notes stay hidden unless a later slice flips this on.
  var SHOW_PROPERTY_HELP = false;

  var propInputIdCounter = 0;
  var onDirty = function () {};
  var getObjectNames = function () { return []; };
  var getInputActionNames = function () { return []; };
  var getAnimationNames = function () { return []; };
  var getStateNames = function () { return []; };
  var getBlendNames = function () { return []; };
  var getVariableNames = function () { return []; };
  var getAudioAssets = function () { return []; };
  var getKeyAliases = function (e) {
    return e ? [e.key, e.code].filter(function (k) { return !!k; }) : [];
  };
  var setCellData = function () {};

  function getDocument() {
    if (typeof document !== 'undefined' && document) return document;
    return null;
  }

  function safeOnChange(onChange) {
    return typeof onChange === 'function' ? onChange : function () {};
  }

  function markDirty() {
    try { onDirty(); } catch (e) { /* a throwing dirty callback never breaks editing */ }
  }

  // Call a name-list provider and return a clean string array. A
  // throwing provider, a non-array return, or non-string entries all
  // degrade to an empty list instead of breaking the panel.
  function safeNames(provider, arg) {
    try {
      var names = provider(arg);
      if (!Array.isArray(names)) return [];
      return names.filter(function (n) { return typeof n === 'string'; });
    } catch (e) { return []; }
  }

  function safeSetCellData(cellIndex, data) {
    try { setCellData(cellIndex, data); } catch (e) { /* a throwing cell write never breaks editing */ }
  }

  // Replace the dirty callback and any of the live-state providers. A
  // missing or non-function value is ignored, so the previous callback
  // (or the default no-op) stands.
  function configure(options) {
    if (!options) return;
    if (typeof options.onDirty === 'function') onDirty = options.onDirty;
    if (typeof options.getObjectNames === 'function') getObjectNames = options.getObjectNames;
    if (typeof options.getInputActionNames === 'function') getInputActionNames = options.getInputActionNames;
    if (typeof options.getAnimationNames === 'function') getAnimationNames = options.getAnimationNames;
    if (typeof options.getStateNames === 'function') getStateNames = options.getStateNames;
    if (typeof options.getBlendNames === 'function') getBlendNames = options.getBlendNames;
    if (typeof options.getVariableNames === 'function') getVariableNames = options.getVariableNames;
    if (typeof options.getAudioAssets === 'function') getAudioAssets = options.getAudioAssets;
    if (typeof options.getKeyAliases === 'function') getKeyAliases = options.getKeyAliases;
    if (typeof options.setCellData === 'function') setCellData = options.setCellData;
  }

  // P3 item 17 (accessibility): the visible label is programmatically
  // bound to its control, so a screen reader names the input.
  // Delta: a missing input no longer throws on appendChild — the group
  // is returned with just the label.
  function makePropGroup(label, input) {
    var doc = getDocument();
    if (!doc) return null;
    var g = doc.createElement('div'); g.className = 'property-group';
    var l = doc.createElement('label'); l.textContent = label;
    if (input && !input.id) input.id = 'hydra-prop-' + (++propInputIdCounter);
    if (input && input.id) l.htmlFor = input.id;
    g.appendChild(l);
    if (input) g.appendChild(input);
    return g;
  }

  function makeSelect(options, value, onChange) {
    var doc = getDocument();
    if (!doc) return null;
    var change = safeOnChange(onChange);
    var s = doc.createElement('select'); s.className = 'property-input';
    // Delta: a non-array options list renders an empty select instead
    // of throwing on forEach.
    (Array.isArray(options) ? options : []).forEach(function (pair) {
      if (!Array.isArray(pair)) return;
      var o = doc.createElement('option'); o.value = pair[0]; o.textContent = pair[1]; s.appendChild(o);
    });
    s.value = value;
    s.addEventListener('change', function (e) { change(e.target.value); markDirty(); });
    return s;
  }

  function makeNumberInput(value, min, max, step, onChange) {
    var doc = getDocument();
    if (!doc) return null;
    var change = safeOnChange(onChange);
    var i = doc.createElement('input');
    i.type = 'number'; i.className = 'property-input';
    i.min = min; i.max = max; i.step = step; i.value = value;
    i.addEventListener('input', function (e) { change(parseFloat(e.target.value) || 0); markDirty(); });
    return i;
  }

  function makeTextInput(value, placeholder, onChange) {
    var doc = getDocument();
    if (!doc) return null;
    var change = safeOnChange(onChange);
    var i = doc.createElement('input');
    i.type = 'text'; i.className = 'property-input'; i.value = value; i.placeholder = placeholder;
    i.addEventListener('input', function (e) { change(e.target.value); markDirty(); });
    return i;
  }

  function makeCheckbox(label, checked, onChange) {
    var doc = getDocument();
    if (!doc) return null;
    var change = safeOnChange(onChange);
    var wrap = doc.createElement('label'); wrap.className = 'checkbox-row';
    var cb = doc.createElement('input'); cb.type = 'checkbox'; cb.checked = checked;
    cb.addEventListener('change', function (e) { change(e.target.checked); markDirty(); });
    wrap.appendChild(cb);
    var span = doc.createElement('span'); span.textContent = label;
    wrap.appendChild(span);
    return wrap;
  }

  // Previously inlined in makeCatalogFieldInput's color case.
  function makeColorInput(value, onChange) {
    var doc = getDocument();
    if (!doc) return null;
    var change = safeOnChange(onChange);
    var input = doc.createElement('input');
    input.type = 'color';
    input.className = 'property-input';
    input.style.height = '36px';
    input.value = value || '#ffffff';
    input.addEventListener('input', function (e) { change(e.target.value); markDirty(); });
    return input;
  }

  // Previously inlined in makeCatalogFieldInput's textarea case.
  function makeTextareaInput(value, placeholder, rows, onChange) {
    var doc = getDocument();
    if (!doc) return null;
    var change = safeOnChange(onChange);
    var textarea = doc.createElement('textarea');
    textarea.className = 'property-input';
    textarea.rows = rows || 4;
    textarea.value = value;
    textarea.placeholder = placeholder || '';
    textarea.addEventListener('input', function (e) { change(e.target.value); markDirty(); });
    return textarea;
  }

  function makeNote(text) {
    var doc = getDocument();
    if (!doc) return null;
    var n = doc.createElement('p');
    n.className = 'prop-note'; n.textContent = text;
    if (!SHOW_PROPERTY_HELP) n.hidden = true;
    return n;
  }

  // P3 item 17 (accessibility): static scene-settings groups pair a bare
  // <label> with its control by position. Bind them programmatically so a
  // screen reader names every control; dynamic panels already bind their
  // labels in makePropGroup. Takes an optional document (the node tests
  // pass a fake one); defaults to the global document; no-ops when there
  // is none, so calling it outside a browser never throws.
  function bindStaticPropGroupLabels(doc) {
    var target = doc || getDocument();
    if (!target || typeof target.querySelectorAll !== 'function') return;
    target.querySelectorAll('.prop-group').forEach(function (group) {
      var label = group.querySelector(':scope > label');
      if (!label || label.htmlFor) return;
      var control = group.querySelector(
        'input:not([type="hidden"]):not([style*="display:none"]), select, textarea, button');
      if (!control) return;
      if (!control.id) control.id = 'hydra-prop-' + (++propInputIdCounter);
      label.htmlFor = control.id;
    });
  }

  // --- Editor-state builders (slice 3) -------------------------------
  // These used to live inline in script.js and read live editor state
  // directly. They now read it only through the configure() providers,
  // so a missing provider degrades to an empty list / a no-op write.

  function makeInvertToggle(data, cellIndex, label) {
    return makeCheckbox(label || 'Invert condition', Boolean(data && data.reversed), function (v) {
      if (!data) return;
      data.reversed = v;
      safeSetCellData(cellIndex, data);
    });
  }

  // Object name dropdown populated from all scene objects. A blank
  // value shows as (none) — or (No named objects yet) when the scene
  // has no objects — instead of borrowing the first object's name,
  // which used to make an unset field look like it was already set
  // to that object. includeAll keeps its -- Any -- lead. allowBlank
  // false removes the blank row entirely (blocks that need a target,
  // like Apply Force) and, when the stored value is blank, picks the
  // first object and saves it, so the block never sits on no target.
  function makeObjectSelect(value, onChange, includeAll, allowBlank) {
    var names = safeNames(getObjectNames);
    var blank = includeAll ? '-- Any --' : (names.length ? '(none)' : '(No named objects yet)');
    var opts;
    if (allowBlank === false && names.length) {
      opts = names.map(function (n) { return [n, n]; });
      if (names.indexOf(value) < 0) {
        value = names[0];
        try { if (typeof onChange === 'function') onChange(value); } catch (e) { /* never break the picker */ }
      }
    } else {
      opts = [['', blank]];
      names.forEach(function (n) { opts.push([n, n]); });
    }
    return makeSelect(opts, value, onChange);
  }

  // Action name dropdown populated from the project's input actions.
  function makeActionSelect(value, onChange) {
    var names = safeNames(getInputActionNames);
    var opts = names.length
      ? [['', '-- Choose an action --']].concat(names.map(function (n) { return [n, n]; }))
      : [['', '(No actions yet — add one in the Inputs tab)']];
    return makeSelect(opts, names.indexOf(value) >= 0 ? value : '', onChange);
  }

  // Audio asset dropdown populated from the project's uploaded audio
  // assets. The value is the asset id (the runtime resolves it
  // against the asset table); blank means the built-in tone, so the
  // tone fields on the block still apply.
  function makeAudioAssetSelect(value, onChange) {
    var pairs = [];
    try {
      var raw = getAudioAssets();
      if (Array.isArray(raw)) {
        raw.forEach(function (p) {
          if (Array.isArray(p) && typeof p[0] === 'string' && p[0] &&
              typeof p[1] === 'string' && p[1]) pairs.push([p[0], p[1]]);
        });
      }
    } catch (e) { pairs = []; }
    var opts = [['', 'Built-in tone']].concat(pairs);
    var known = pairs.some(function (p) { return p[0] === value; });
    return makeSelect(opts, known ? value : '', onChange);
  }

  function makeKeyPicker(data, cellIndex) {
    var doc = getDocument();
    if (!doc) return null;
    var wrap = doc.createElement('div');
    wrap.className = 'key-picker-row';
    var input = makeTextInput((data && data.key) || 'ArrowRight', '"Space", "ArrowRight", "a"', function (v) {
      if (!data) return;
      data.key = v;
      safeSetCellData(cellIndex, data);
    });
    var captureBtn = doc.createElement('button');
    captureBtn.type = 'button';
    captureBtn.className = 'small-action-btn';
    captureBtn.textContent = 'Record';
    captureBtn.onclick = function () {
      captureBtn.textContent = 'Press a key';
      var capture = function (e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        var aliases = null;
        try { aliases = getKeyAliases(e); } catch (err) { aliases = null; }
        var key = (Array.isArray(aliases) && aliases[0]) || (e && e.key) || 'Space';
        if (data) data.key = key;
        input.value = key;
        safeSetCellData(cellIndex, data);
        markDirty();
        captureBtn.textContent = 'Record';
        if (doc.removeEventListener) doc.removeEventListener('keydown', capture, true);
      };
      // Delta: the capture listener is registered on the module's
      // document (the global document in the editor) rather than a
      // hard-coded global; the setTimeout deferral is unchanged.
      var arm = function () {
        if (doc.addEventListener) doc.addEventListener('keydown', capture, true);
      };
      if (typeof setTimeout === 'function') setTimeout(arm, 0); else arm();
    };
    wrap.appendChild(input);
    wrap.appendChild(captureBtn);
    return wrap;
  }

  function makeTargetModeSelect(data, cellIndex, label) {
    var doc = getDocument();
    if (!doc) return null;
    if (data && !data.targetMode) data.targetMode = 'context';
    var details = doc.createElement('details');
    details.className = 'advanced-prop-details';
    details.open = !!(data && data.targetMode && data.targetMode !== 'context');
    var summary = doc.createElement('summary');
    summary.textContent = 'Target matching';
    details.appendChild(summary);
    details.appendChild(makePropGroup(label || 'Target instances:', makeSelect(
      [
        ['context', 'Matched object, otherwise first'],
        ['first', 'First matching object'],
        ['all', 'All matching objects']
      ],
      (data && data.targetMode) || 'context',
      function (v) {
        if (!data) return;
        data.targetMode = v;
        safeSetCellData(cellIndex, data);
        markDirty();
      }
    )));
    return details;
  }

  function makeAnimationNameSelect(data, cellIndex, allowAny) {
    var names = safeNames(getAnimationNames, (data && data.targetObject) || '');
    var opts = allowAny ? [['', 'Any animation']] : [['', '-- Choose animation --']];
    names.forEach(function (n) { opts.push([n, n]); });
    if (data && data.animation && names.indexOf(data.animation) < 0) {
      opts.push([data.animation, data.animation + ' (missing)']);
    }
    return makeSelect(opts, (data && data.animation) || '', function (v) {
      if (!data) return;
      data.animation = v;
      safeSetCellData(cellIndex, data);
    });
  }

  function makeStateNameSelect(data, cellIndex) {
    var names = safeNames(getStateNames, (data && data.targetObject) || '');
    var opts = [['', '-- Choose state --']];
    names.forEach(function (n) { opts.push([n, n]); });
    if (data && data.state && names.indexOf(data.state) < 0) {
      opts.push([data.state, data.state + ' (missing)']);
    }
    return makeSelect(opts, (data && data.state) || '', function (v) {
      if (!data) return;
      data.state = v;
      safeSetCellData(cellIndex, data);
    });
  }

  function makeBlendNameSelect(data, cellIndex) {
    var names = safeNames(getBlendNames, (data && data.targetObject) || '');
    var opts = [['', '-- Choose blend --']];
    names.forEach(function (n) { opts.push([n, n]); });
    if (data && data.blend && names.indexOf(data.blend) < 0) {
      opts.push([data.blend, data.blend + ' (missing)']);
    }
    return makeSelect(opts, (data && data.blend) || '', function (v) {
      if (!data) return;
      data.blend = v;
      safeSetCellData(cellIndex, data);
    });
  }

  // Expression input — text field with live variable/property
  // suggestions, shown when the field gains focus.
  function makeExprInput(value, placeholder, onChange) {
    var doc = getDocument();
    if (!doc) return null;
    var change = safeOnChange(onChange);
    var wrap = doc.createElement('div');
    wrap.className = 'expr-input-wrap';

    var row = doc.createElement('div');
    row.style.cssText = 'position:relative;';

    var input = doc.createElement('input');
    input.type = 'text';
    input.className = 'property-input expr-input';
    input.value = String(value === null || value === undefined ? '' : value);
    input.placeholder = placeholder || '0   or   score + 1';

    var badge = doc.createElement('span');
    badge.className = 'expr-badge';
    badge.textContent = 'fx';

    var refresh = function () {
      var isExpr = input.value.trim() !== '' && isNaN(Number(input.value.trim()));
      input.classList.toggle('has-expr', isExpr);
      badge.classList.toggle('active', isExpr);
    };
    refresh();

    input.addEventListener('input', function () { refresh(); change(input.value); markDirty(); });

    // Suggestion panel shown on focus
    var sugg = doc.createElement('div');
    sugg.className = 'expr-suggestions';

    input.addEventListener('focus', function () {
      sugg.innerHTML = '';

      // Game variables
      safeNames(getVariableNames).forEach(function (vName) {
        var p = doc.createElement('button');
        p.className = 'expr-pill var-pill'; p.type = 'button'; p.textContent = vName;
        p.title = 'Variable: ' + vName;
        p.onmousedown = function (e) {
          e.preventDefault();
          input.value = input.value ? input.value + ' + ' + vName : vName;
          refresh(); change(input.value); markDirty(); input.focus();
        };
        sugg.appendChild(p);
      });

      // Object properties for each named object
      safeNames(getObjectNames).slice(0, 4).forEach(function (oName) {
        ['posX', 'posY', 'velX', 'velY', 'width', 'height', 'rotation'].forEach(function (prop) {
          var p = doc.createElement('button');
          p.className = 'expr-pill prop-pill'; p.type = 'button';
          p.textContent = oName + '.' + prop;
          p.onmousedown = function (e) {
            e.preventDefault();
            input.value = oName + '.' + prop; refresh(); change(input.value); markDirty(); input.focus();
          };
          sugg.appendChild(p);
        });
      });

      // Math helpers
      ['Math.floor(x)', 'Math.ceil(x)', 'Math.abs(x)', 'Math.sqrt(x)', 'Math.max(a,b)', 'Math.min(a,b)', 'Math.PI', 'Math.random()'].forEach(function (m) {
        var p = doc.createElement('button');
        p.className = 'expr-pill math-pill'; p.type = 'button'; p.textContent = m;
        p.onmousedown = function (e) {
          e.preventDefault();
          var cur = input.value.trim();
          var fn = m.match(/^Math\.\w+\(/);
          input.value = fn && cur ? m.replace('x', cur).replace('(x)', '(' + cur + ')') : (cur ? cur + ' * ' + m : m);
          refresh(); change(input.value); markDirty(); input.focus();
        };
        sugg.appendChild(p);
      });
    });

    row.appendChild(input);
    row.appendChild(badge);
    wrap.appendChild(row);
    wrap.appendChild(sugg);
    return wrap;
  }

  return {
    configure: configure,
    makePropGroup: makePropGroup,
    makeSelect: makeSelect,
    makeNumberInput: makeNumberInput,
    makeTextInput: makeTextInput,
    makeCheckbox: makeCheckbox,
    makeColorInput: makeColorInput,
    makeTextareaInput: makeTextareaInput,
    makeNote: makeNote,
    bindStaticPropGroupLabels: bindStaticPropGroupLabels,
    makeInvertToggle: makeInvertToggle,
    makeObjectSelect: makeObjectSelect,
    makeActionSelect: makeActionSelect,
    makeAudioAssetSelect: makeAudioAssetSelect,
    makeKeyPicker: makeKeyPicker,
    makeTargetModeSelect: makeTargetModeSelect,
    makeAnimationNameSelect: makeAnimationNameSelect,
    makeStateNameSelect: makeStateNameSelect,
    makeBlendNameSelect: makeBlendNameSelect,
    makeExprInput: makeExprInput
  };
}

if (typeof window !== 'undefined') {
  window.HydraPropInputs = hydraPropInputsFactory();
  // Self-contained source of the factory, kept as a string, never eval'd
  // here. Exports never inline this module (no property panels in a
  // shipped game); factorySource stays so the module is re-instantiable
  // and testable like the rest of the hydra-*.js family.
  window.HydraPropInputs.factorySource = hydraPropInputsFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraPropInputsFactory;
