// Unit tests for hydra/hydra-propinputs.js — the property-panel input
// builders (P2 item 14, slices 2 + 3: the editor's property-panel field
// builders as a DOM module, primitives first, then the editor-state
// builders — invert toggle, object / action / animation / state / blend
// name selects, key picker, target-mode select, expression input —
// reading live editor state only through configure() providers).
//
// The module builds real elements, so the node tests drive it through a
// vm sandbox with a small fake DOM (fake document + fake elements with
// className/id/value/children, addEventListener/fire, focus, an
// innerHTML setter that clears children, and a querySelector that
// understands the two selectors bindStaticPropGroupLabels uses).
// script.js delegates to this module; the name-list getters stay in
// script.js as providers.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}
function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected),
    `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

const MODULE_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'hydra', 'hydra-propinputs.js'), 'utf8');
const SCRIPT_JS = fs.readFileSync(
  path.join(__dirname, '..', 'hydra', 'script.js'), 'utf8');
const INDEX_HTML = fs.readFileSync(
  path.join(__dirname, '..', 'hydra', 'index.html'), 'utf8');

// --- fake DOM ---------------------------------------------------------
function makeFakeElement(tag) {
  const el = {
    tagName: tag.toUpperCase(),
    children: [],
    parentNode: null,
    className: '',
    id: '',
    value: '',
    textContent: '',
    placeholder: '',
    type: '',
    min: '',
    max: '',
    step: '',
    rows: 0,
    checked: false,
    hidden: false,
    htmlFor: '',
    style: {},
    _listeners: {},
    _classSet: new Set(),
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
    addEventListener(type, fn) {
      (this._listeners[type] = this._listeners[type] || []).push(fn);
    },
    fire(type, event) {
      (this._listeners[type] || []).forEach(fn => fn(event || { target: this }));
    },
    querySelector(sel) {
      const parts = sel.split(',').map(s => s.trim());
      for (const part of parts) {
        if (part === ':scope > label') {
          const found = this.children.find(c => c.tagName === 'LABEL');
          if (found) return found;
        } else if (part === 'select' || part === 'textarea' || part === 'button') {
          const found = this.children.find(c => c.tagName === part.toUpperCase());
          if (found) return found;
        } else if (part.startsWith('input')) {
          const found = this.children.find(c =>
            c.tagName === 'INPUT' && c.type !== 'hidden' &&
            !(c.style && c.style.display === 'none'));
          if (found) return found;
        }
      }
      return null;
    }
  };
  el.classList = {
    add(c) { el._classSet.add(c); },
    remove(c) { el._classSet.delete(c); },
    toggle(c, force) {
      if (force === undefined) force = !el._classSet.has(c);
      if (force) el._classSet.add(c); else el._classSet.delete(c);
    },
    contains(c) { return el._classSet.has(c); }
  };
  el.focus = function () {};
  // innerHTML assignment clears children (the module resets the
  // suggestion panel with sugg.innerHTML = '' on focus).
  var _innerHTML = '';
  Object.defineProperty(el, 'innerHTML', {
    get: function () { return _innerHTML; },
    set: function (v) { _innerHTML = String(v); if (v === '') el.children.length = 0; },
    configurable: true
  });
  return el;
}

function makeFakeDocument(groups) {
  return {
    createElement(tag) { return makeFakeElement(tag); },
    _listeners: {},
    addEventListener(type, fn) {
      (this._listeners[type] = this._listeners[type] || []).push(fn);
    },
    removeEventListener(type, fn) {
      const list = this._listeners[type] || [];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    fire(type, event) {
      (this._listeners[type] || []).forEach(fn => fn(event || {}));
    },
    querySelectorAll(sel) {
      return sel === '.prop-group' ? (groups || []) : [];
    }
  };
}

function loadInSandbox(fakeDoc, extra) {
  const sandbox = Object.assign({ document: fakeDoc, setTimeout: setTimeout }, extra || {});
  sandbox.window = sandbox; // hydra-propinputs.js assigns to bare `window`
  vm.createContext(sandbox);
  vm.runInContext(MODULE_SRC, sandbox, { filename: 'hydra-propinputs.js' });
  return sandbox.HydraPropInputs;
}

// --- load: vm sandbox (window + fake document) + plain require() -------
const doc = makeFakeDocument([]);
const M = loadInSandbox(doc);
const factory = require(path.join(__dirname, '..', 'hydra', 'hydra-propinputs.js'));
const M2 = factory();

check('module exposes the full prop-inputs surface',
  !!M && typeof M.configure === 'function' &&
  typeof M.makePropGroup === 'function' &&
  typeof M.makeSelect === 'function' &&
  typeof M.makeNumberInput === 'function' &&
  typeof M.makeTextInput === 'function' &&
  typeof M.makeCheckbox === 'function' &&
  typeof M.makeColorInput === 'function' &&
  typeof M.makeTextareaInput === 'function' &&
  typeof M.makeNote === 'function' &&
  typeof M.makeInvertToggle === 'function' &&
  typeof M.makeObjectSelect === 'function' &&
  typeof M.makeActionSelect === 'function' &&
  typeof M.makeKeyPicker === 'function' &&
  typeof M.makeTargetModeSelect === 'function' &&
  typeof M.makeAnimationNameSelect === 'function' &&
  typeof M.makeStateNameSelect === 'function' &&
  typeof M.makeBlendNameSelect === 'function' &&
  typeof M.makeExprInput === 'function' &&
  typeof M.bindStaticPropGroupLabels === 'function');
check('factorySource is a self-contained function string',
  typeof M.factorySource === 'string' && M.factorySource.includes('hydraPropInputsFactory'));
check('plain require() gives an independent instance',
  M2 !== M && typeof M2.makeSelect === 'function' &&
  typeof M2.factorySource === 'undefined');

// Two sandboxed instances mint ids from independent counters.
{
  const A = loadInSandbox(makeFakeDocument([]));
  const B = loadInSandbox(makeFakeDocument([]));
  const ga = A.makePropGroup('A:', A.makeTextInput('x', '', () => {}));
  const gb = B.makePropGroup('B:', B.makeTextInput('y', '', () => {}));
  check('independent instances mint ids from independent counters',
    ga.children[1].id === 'hydra-prop-1' && gb.children[1].id === 'hydra-prop-1');
}

// An instance with no document degrades to null instead of throwing.
{
  const sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(MODULE_SRC, sandbox, { filename: 'hydra-propinputs.js' });
  const N = sandbox.HydraPropInputs;
  check('builders return null with no document available',
    N.makeSelect([], '', () => {}) === null &&
    N.makePropGroup('L:', null) === null &&
    N.makeNote('hi') === null &&
    N.makeInvertToggle({ reversed: false }, 0) === null &&
    N.makeObjectSelect('', () => {}) === null &&
    N.makeActionSelect('', () => {}) === null &&
    N.makeKeyPicker({ key: 'a' }, 0) === null &&
    N.makeTargetModeSelect({ targetMode: 'context' }, 0) === null &&
    N.makeAnimationNameSelect({ targetObject: '' }, 0, false) === null &&
    N.makeStateNameSelect({ targetObject: '' }, 0) === null &&
    N.makeBlendNameSelect({ targetObject: '' }, 0) === null &&
    N.makeExprInput('', '', () => {}) === null);
  let threw = false;
  try { N.bindStaticPropGroupLabels(); } catch (e) { threw = true; }
  check('bindStaticPropGroupLabels no-ops with no document', !threw);
}

// --- configure / dirty callback ---------------------------------------
{
  let dirty = 0;
  let seen = null;
  const sel = M.makeSelect([['a', 'A'], ['b', 'B']], 'a', v => { seen = v; });
  // No dirty callback configured yet: firing must not throw.
  sel.value = 'b';
  sel.fire('change', { target: sel });
  check('change works with no dirty callback configured (default no-op)', seen === 'b');

  M.configure({ onDirty: () => { dirty++; } });
  const sel2 = M.makeSelect([['a', 'A'], ['b', 'B']], 'a', v => { seen = v; });
  sel2.value = 'b';
  sel2.fire('change', { target: sel2 });
  check('configured dirty callback fires once per change', dirty === 1 && seen === 'b');

  M.configure({ onDirty: 'not a function' });
  sel2.fire('change', { target: sel2 });
  check('non-function onDirty is ignored, previous callback stands', dirty === 2);

  M.configure(null);
  M.configure();
  sel2.fire('change', { target: sel2 });
  check('configure(null)/configure() are safe and keep the callback', dirty === 3);

  M.configure({ onDirty: () => { throw new Error('boom'); } });
  let threw = false;
  try { sel2.fire('change', { target: sel2 }); } catch (e) { threw = true; }
  check('a throwing dirty callback never breaks the change handler',
    !threw && seen === 'b');
  M.configure({ onDirty: () => { dirty++; } });
}

// --- makePropGroup ----------------------------------------------------
{
  const input = M.makeTextInput('v', 'ph', () => {});
  const g = M.makePropGroup('Score:', input);
  check('makePropGroup builds a labelled group', g.tagName === 'DIV' &&
    g.className === 'property-group' && g.children.length === 2 &&
    g.children[0].tagName === 'LABEL' && g.children[0].textContent === 'Score:' &&
    g.children[1] === input);
  check('makePropGroup assigns an id and binds the label to it',
    /^hydra-prop-\d+$/.test(input.id) && g.children[0].htmlFor === input.id);
  const input2 = M.makeTextInput('w', '', () => {});
  const g2 = M.makePropGroup('Lives:', input2);
  check('makePropGroup ids keep incrementing', input2.id !== input.id);
  const preset = M.makeTextInput('z', '', () => {});
  preset.id = 'my-id';
  const g3 = M.makePropGroup('Keep:', preset);
  check('makePropGroup preserves an existing input id',
    preset.id === 'my-id' && g3.children[0].htmlFor === 'my-id');
  const g4 = M.makePropGroup('No input:', null);
  check('makePropGroup with a missing input returns a label-only group',
    g4 !== null && g4.children.length === 1 && g4.children[0].tagName === 'LABEL');
}

// --- makeSelect -------------------------------------------------------
{
  let seen = null;
  let dirty = 0;
  M.configure({ onDirty: () => { dirty++; } });
  const s = M.makeSelect([['a', 'Alpha'], ['b', 'Beta']], 'b', v => { seen = v; });
  check('makeSelect renders options and sets the value',
    s.tagName === 'SELECT' && s.className === 'property-input' &&
    s.children.length === 2 && s.children[0].value === 'a' &&
    s.children[0].textContent === 'Alpha' && s.value === 'b');
  s.value = 'a';
  s.fire('change', { target: s });
  check('makeSelect change reports the new value and marks dirty',
    seen === 'a' && dirty === 1);
  const empty = M.makeSelect([], '', () => {});
  check('makeSelect with no options renders an empty select', empty.children.length === 0);
  const bad = M.makeSelect(null, '', () => {});
  check('makeSelect with a non-array options list renders an empty select, no throw',
    bad !== null && bad.children.length === 0);
  const mixed = M.makeSelect([['a', 'A'], 'junk', ['b', 'B']], 'a', () => {});
  check('makeSelect skips non-array option entries', mixed.children.length === 2);
  const noCb = M.makeSelect([['a', 'A']], 'a', null);
  let threw = false;
  try { noCb.fire('change', { target: noCb }); } catch (e) { threw = true; }
  check('makeSelect with a non-function onChange does not throw on change', !threw);
}

// --- makeNumberInput --------------------------------------------------
{
  let seen = null;
  let dirty = 0;
  M.configure({ onDirty: () => { dirty++; } });
  const n = M.makeNumberInput(5, 0, 10, 1, v => { seen = v; });
  check('makeNumberInput carries type/min/max/step/value',
    n.type === 'number' && n.className === 'property-input' &&
    n.min === 0 && n.max === 10 && n.step === 1 && n.value === 5);
  n.value = '3.5';
  n.fire('input', { target: n });
  check('makeNumberInput parses a numeric edit', seen === 3.5 && dirty === 1);
  n.value = 'abc';
  n.fire('input', { target: n });
  check('makeNumberInput falls back to 0 for non-numeric input', seen === 0);
  n.value = '';
  n.fire('input', { target: n });
  check('makeNumberInput falls back to 0 for an empty input', seen === 0);
}

// --- makeTextInput ----------------------------------------------------
{
  let seen = null;
  let dirty = 0;
  M.configure({ onDirty: () => { dirty++; } });
  const t = M.makeTextInput('hello', 'type here', v => { seen = v; });
  check('makeTextInput carries type/value/placeholder',
    t.type === 'text' && t.className === 'property-input' &&
    t.value === 'hello' && t.placeholder === 'type here');
  t.value = 'bye';
  t.fire('input', { target: t });
  check('makeTextInput reports edits and marks dirty', seen === 'bye' && dirty === 1);
}

// --- makeCheckbox -----------------------------------------------------
{
  let seen = null;
  let dirty = 0;
  M.configure({ onDirty: () => { dirty++; } });
  const c = M.makeCheckbox('Invert condition', true, v => { seen = v; });
  check('makeCheckbox builds a labelled checkbox row',
    c.tagName === 'LABEL' && c.className === 'checkbox-row' &&
    c.children.length === 2 && c.children[0].type === 'checkbox' &&
    c.children[0].checked === true && c.children[1].textContent === 'Invert condition');
  c.children[0].checked = false;
  c.children[0].fire('change', { target: c.children[0] });
  check('makeCheckbox reports the new checked state and marks dirty',
    seen === false && dirty === 1);
}

// --- makeColorInput ---------------------------------------------------
{
  let seen = null;
  let dirty = 0;
  M.configure({ onDirty: () => { dirty++; } });
  const c = M.makeColorInput('#ff0000', v => { seen = v; });
  check('makeColorInput carries type/class/height/value',
    c.type === 'color' && c.className === 'property-input' &&
    c.style.height === '36px' && c.value === '#ff0000');
  c.value = '#00ff00';
  c.fire('input', { target: c });
  check('makeColorInput reports edits and marks dirty', seen === '#00ff00' && dirty === 1);
  const fallback = M.makeColorInput('', () => {});
  check('makeColorInput falls back to white for an empty value', fallback.value === '#ffffff');
  const undef = M.makeColorInput(undefined, () => {});
  check('makeColorInput falls back to white for an undefined value', undef.value === '#ffffff');
}

// --- makeTextareaInput ------------------------------------------------
{
  let seen = null;
  let dirty = 0;
  M.configure({ onDirty: () => { dirty++; } });
  const t = M.makeTextareaInput('line1', 'write here', undefined, v => { seen = v; });
  check('makeTextareaInput defaults to 4 rows',
    t.tagName === 'TEXTAREA' && t.className === 'property-input' &&
    t.rows === 4 && t.value === 'line1' && t.placeholder === 'write here');
  const t2 = M.makeTextareaInput('x', '', 8, () => {});
  check('makeTextareaInput respects an explicit row count', t2.rows === 8);
  t.value = 'line2';
  t.fire('input', { target: t });
  check('makeTextareaInput reports edits and marks dirty', seen === 'line2' && dirty === 1);
}

// --- makeNote ---------------------------------------------------------
{
  const n = M.makeNote('Fires when the preview starts.');
  check('makeNote builds a hidden prop-note paragraph',
    n.tagName === 'P' && n.className === 'prop-note' &&
    n.textContent === 'Fires when the preview starts.' && n.hidden === true);
}

// --- bindStaticPropGroupLabels ---------------------------------------
{
  function fakeGroup(labelText, controlTag, controlType, controlId) {
    const g = makeFakeElement('div');
    g.className = 'prop-group';
    if (labelText !== null) {
      const label = makeFakeElement('label');
      label.textContent = labelText;
      g.appendChild(label);
    }
    if (controlTag) {
      const control = makeFakeElement(controlTag);
      if (controlType) control.type = controlType;
      if (controlId) control.id = controlId;
      g.appendChild(control);
    }
    return g;
  }
  const g1 = fakeGroup('Width:', 'input', 'number', '');
  const g2 = fakeGroup('Height:', 'input', 'text', 'already-there');
  const g3 = fakeGroup('Bound:', 'select', null, '');
  g3.children[0].htmlFor = 'pre-bound';
  const g4 = fakeGroup(null, 'input', 'text', '');
  const g5 = fakeGroup('No control:', null, null, null);
  const g6 = fakeGroup('Hidden only:', 'input', 'hidden', '');
  const fakeDoc = makeFakeDocument([g1, g2, g3, g4, g5, g6]);
  M.bindStaticPropGroupLabels(fakeDoc);
  check('bindStaticPropGroupLabels assigns an id and binds the label',
    /^hydra-prop-\d+$/.test(g1.children[1].id) &&
    g1.children[0].htmlFor === g1.children[1].id);
  check('bindStaticPropGroupLabels keeps an existing control id',
    g2.children[1].id === 'already-there' &&
    g2.children[0].htmlFor === 'already-there');
  check('bindStaticPropGroupLabels leaves an already-bound label alone',
    g3.children[0].htmlFor === 'pre-bound' && g3.children[1].id === '');
  check('bindStaticPropGroupLabels tolerates a group with no label', true);
  check('bindStaticPropGroupLabels tolerates a group with no control', true);
  check('bindStaticPropGroupLabels skips a hidden-only control',
    g6.children[1].id === '' && g6.children[0].htmlFor === '');
  let threw = false;
  try { M.bindStaticPropGroupLabels(null); } catch (e) { threw = true; }
  check('bindStaticPropGroupLabels(null) falls back to the global document', !threw);
}

// --- static routing checks: script.js delegates, module owns the code --
{
  // The old inline bodies are gone (the delegation one-liners contain the
  // function names, so these check the distinctive body fragments, not
  // the names — and color inputs elsewhere in the inspector are separate
  // builders, not the catalog case, so only the catalog case's own
  // value-fallback line is asserted gone).
  const inlined = ["g.className = 'property-group'", 'options.forEach(([v, t]) => {',
    "i.type = 'number'; i.className", "i.type = 'text'; i.className",
    "wrap.className = 'checkbox-row'", "n.className = 'prop-note'",
    "input.value = value || '#ffffff'", 'textarea.rows = field.rows',
    'let propInputIdCounter', 'const SHOW_PROPERTY_HELP',
    // Slice 3: the editor-state builder bodies are gone too.
    "wrap.className = 'key-picker-row'", "details.className = 'advanced-prop-details'",
    "sugg.className = 'expr-suggestions'", "badge.className = 'expr-badge'",
    "'(No named objects yet)'", "'-- Choose an action --'",
    " + ' (missing)'", 'getEventKeyAliases(e)[0]',
    "captureBtn.textContent = 'Record'", "'Target matching'"];
  inlined.forEach(snippet => check(
    `script.js keeps no inline builder body: ${snippet}`, !SCRIPT_JS.includes(snippet)));
  const delegated = ['HydraPropInputs.configure({',
    'function makePropGroup(label, input) { return HydraPropInputs.makePropGroup',
    'function makeSelect(options, value, onChange) { return HydraPropInputs.makeSelect',
    'function makeNumberInput(value, min, max, step, onChange) { return HydraPropInputs.makeNumberInput',
    'function makeTextInput(value, placeholder, onChange) { return HydraPropInputs.makeTextInput',
    'function makeCheckbox(label, checked, onChange) { return HydraPropInputs.makeCheckbox',
    'function makeColorInput(value, onChange) { return HydraPropInputs.makeColorInput',
    'function makeTextareaInput(value, placeholder, rows, onChange) { return HydraPropInputs.makeTextareaInput',
    'function makeNote(text) { return HydraPropInputs.makeNote',
    'function makeInvertToggle(data, cellIndex, label',
    'function makeObjectSelect(value, onChange, includeAll',
    'function makeActionSelect(value, onChange) { return HydraPropInputs.makeActionSelect',
    'function makeKeyPicker(data, cellIndex) { return HydraPropInputs.makeKeyPicker',
    'function makeTargetModeSelect(data, cellIndex, label',
    'function makeAnimationNameSelect(data, cellIndex, allowAny) { return HydraPropInputs.makeAnimationNameSelect',
    'function makeStateNameSelect(data, cellIndex) { return HydraPropInputs.makeStateNameSelect',
    'function makeBlendNameSelect(data, cellIndex) { return HydraPropInputs.makeBlendNameSelect',
    'function makeExprInput(value, placeholder, onChange) { return HydraPropInputs.makeExprInput',
    'function bindStaticPropGroupLabels() { return HydraPropInputs.bindStaticPropGroupLabels'];
  delegated.forEach(snippet => check(
    `script.js delegates through the module: ${snippet.slice(0, 60)}…`, SCRIPT_JS.includes(snippet)));
  check('makeCatalogFieldInput routes the color case through makeColorInput',
    SCRIPT_JS.includes("return makeColorInput(value, onChange);"));
  check('makeCatalogFieldInput routes the textarea case through makeTextareaInput',
    SCRIPT_JS.includes("return makeTextareaInput(value, field.placeholder || '', field.rows || 4, onChange);"));
  check('script.js configures the editor-state providers',
    ['getObjectNames: getAllObjectNames,', 'getInputActionNames:',
     'getAnimationNames: getObjectAnimationNames,',
     'getStateNames: getObjectStateNames,',
     'getBlendNames: getObjectBlendNames,',
     'getVariableNames: getKnownVariableNames,',
     'getKeyAliases: getEventKeyAliases,',
     'setCellData: function (cellIndex, data) { cellData.set(cellIndex, data); }']
      .every(s => SCRIPT_JS.includes(s)));
  check('module header records the provider-injection design',
    MODULE_SRC.includes('read it only through the configure() providers'));
  check('the name-list getters stay in script.js as providers',
    ['function getAllObjectNames()', 'function getObjectAnimationNames(objectName)',
     'function getObjectStateNames(objectName)', 'function getObjectBlendNames(objectName)',
     'function getKnownVariableNames()', 'function getEventKeyAliases(e)',
     'function getProjectInputActions()'].every(s => SCRIPT_JS.includes(s)));
  const propTag = INDEX_HTML.indexOf('hydra-propinputs.js');
  const scriptTag = INDEX_HTML.indexOf('"script.js');
  check('index.html loads hydra-propinputs.js before script.js',
    propTag !== -1 && scriptTag !== -1 && propTag < scriptTag);
}

// --- slice 3: editor-state builders -----------------------------------
// A fresh instance with providers wired, mirroring script.js's
// configure() call (object / action / animation / state / blend /
// variable names, key aliases, cell writes, dirty callback). The key
// picker test loads its own instance with a synchronous setTimeout so
// the Record capture arms without an async wait.
const P = loadInSandbox(makeFakeDocument([]));
function optPairs(sel) { return sel.children.map(o => [o.value, o.textContent]); }
{
  P.configure({
    onDirty: () => {},
    getObjectNames: () => ['Player', 'Coin'],
    getInputActionNames: () => ['Jump', 'Shoot'],
    getAnimationNames: (obj) => obj === 'Player' ? ['Walk', 'Idle'] : [],
    getStateNames: (obj) => obj === 'Player' ? ['Run', 'Hurt'] : [],
    getBlendNames: (obj) => obj === 'Player' ? ['Move'] : [],
    getVariableNames: () => ['score', 'lives'],
    getKeyAliases: (e) => [e.key, e.code].filter(Boolean),
    setCellData: () => {}
  });
  check('configure accepts the provider set without throwing', true);
  P.configure({ getObjectNames: 'not a function', setCellData: 42 });
  const still = P.makeObjectSelect('', () => {});
  check('non-function providers are ignored, previous providers stand',
    still.children.length === 3 && still.children[0].value === '' &&
    still.children[1].value === 'Player');
  P.configure({ getObjectNames: () => { throw new Error('boom'); } });
  let threw = false;
  let boom = null;
  try { boom = P.makeObjectSelect('', () => {}); } catch (e) { threw = true; }
  check('a throwing name provider falls back to the empty placeholder, no throw',
    !threw && boom !== null && boom.children[0].textContent === '(No named objects yet)');
  P.configure({ getObjectNames: () => ['Player', 'Coin'] });
}

// --- makeInvertToggle -------------------------------------------------
{
  let dirty = 0;
  const cells = new Map();
  P.configure({
    onDirty: () => { dirty++; },
    setCellData: (i, d) => { cells.set(i, d); }
  });
  const data = { type: 'gameStart', reversed: false };
  const t = P.makeInvertToggle(data, 7);
  check('makeInvertToggle builds a labelled checkbox row',
    t.tagName === 'LABEL' && t.className === 'checkbox-row' &&
    t.children[1].textContent === 'Invert condition' && t.children[0].checked === false);
  t.children[0].checked = true;
  t.children[0].fire('change', { target: t.children[0] });
  check('makeInvertToggle writes reversed + the cell record and marks dirty',
    data.reversed === true && cells.get(7) === data && dirty === 1);
  const custom = P.makeInvertToggle({ reversed: true }, 8, 'Flip it');
  check('makeInvertToggle honours a custom label and the stored value',
    custom.children[1].textContent === 'Flip it' && custom.children[0].checked === true);
  const nullData = P.makeInvertToggle(null, 9);
  let threw = false;
  try { nullData.children[0].fire('change', { target: nullData.children[0] }); } catch (e) { threw = true; }
  check('makeInvertToggle with null data does not throw on change', !threw);
  P.configure({
    setCellData: () => { throw new Error('boom'); },
    onDirty: () => { dirty++; }
  });
  const throwing = P.makeInvertToggle({ reversed: false }, 10);
  threw = false;
  try { throwing.children[0].fire('change', { target: throwing.children[0] }); } catch (e) { threw = true; }
  check('makeInvertToggle with a throwing cell write still flips and does not throw',
    !threw && dirty >= 2);
  P.configure({ setCellData: (i, d) => { cells.set(i, d); } });
}

// --- makeObjectSelect -------------------------------------------------
{
  let seen = null;
  let dirty = 0;
  P.configure({ onDirty: () => { dirty++; } });
  const s = P.makeObjectSelect('Coin', v => { seen = v; });
  check('makeObjectSelect lists provider object names and sets the value',
    JSON.stringify(optPairs(s)) === JSON.stringify([['', '(none)'], ['Player', 'Player'], ['Coin', 'Coin']]) &&
    s.value === 'Coin');
  const blank = P.makeObjectSelect('', () => {});
  check('makeObjectSelect shows (none) for a blank value instead of the first object',
    blank.value === '' && blank.children[0].textContent === '(none)');
  s.value = 'Player';
  s.fire('change', { target: s });
  check('makeObjectSelect reports the new object and marks dirty', seen === 'Player' && dirty === 1);
  const any = P.makeObjectSelect('', () => {}, true);
  check("makeObjectSelect includeAll leads with '-- Any --'",
    any.children[0].value === '' && any.children[0].textContent === '-- Any --' &&
    any.children.length === 3);
  P.configure({ getObjectNames: () => [] });
  const empty = P.makeObjectSelect('', () => {});
  check('makeObjectSelect with no objects offers the placeholder option',
    empty.children.length === 1 && empty.children[0].textContent === '(No named objects yet)');
  P.configure({ getObjectNames: () => ['Player', 'Coin'] });
}

// --- makeActionSelect -------------------------------------------------
{
  const s = P.makeActionSelect('Jump', () => {});
  check('makeActionSelect lists actions with a choose prompt and keeps a known value',
    JSON.stringify(optPairs(s)) === JSON.stringify(
      [['', '-- Choose an action --'], ['Jump', 'Jump'], ['Shoot', 'Shoot']]) &&
    s.value === 'Jump');
  const unknown = P.makeActionSelect('Nope', () => {});
  check('makeActionSelect resets an unknown value to the prompt', unknown.value === '');
  P.configure({ getInputActionNames: () => [] });
  const empty = P.makeActionSelect('', () => {});
  check('makeActionSelect with no actions offers the Inputs-tab placeholder',
    empty.children.length === 1 && /Inputs tab/.test(empty.children[0].textContent));
  P.configure({ getInputActionNames: () => ['Jump', 'Shoot'] });
}

// --- makeKeyPicker ----------------------------------------------------
{
  const docK = makeFakeDocument([]);
  const K = loadInSandbox(docK, { setTimeout: (fn) => { fn(); return 0; } });
  const cells = new Map();
  let dirty = 0;
  K.configure({
    onDirty: () => { dirty++; },
    getKeyAliases: (e) => [e.key, e.code].filter(Boolean),
    setCellData: (i, d) => { cells.set(i, d); }
  });
  const data = { key: 'ArrowLeft', type: 'keyPressed' };
  const wrap = K.makeKeyPicker(data, 12);
  check('makeKeyPicker builds a key row with the current key and a Record button',
    wrap.tagName === 'DIV' && wrap.className === 'key-picker-row' &&
    wrap.children[0].value === 'ArrowLeft' && wrap.children[1].textContent === 'Record');
  wrap.children[0].value = 'b';
  wrap.children[0].fire('input', { target: wrap.children[0] });
  check('makeKeyPicker typing writes the key and the cell record',
    data.key === 'b' && cells.get(12) === data);
  // Record flow: the click arms the capture synchronously (the sync
  // setTimeout in this sandbox), then a keydown on the document
  // captures the key.
  wrap.children[1].onclick();
  check('makeKeyPicker Record arms the capture prompt',
    wrap.children[1].textContent === 'Press a key');
  docK.fire('keydown', { key: 'a', code: 'KeyA', preventDefault() {} });
  check('makeKeyPicker capture takes the first alias, restores the button, marks dirty',
    data.key === 'a' && wrap.children[0].value === 'a' &&
    wrap.children[1].textContent === 'Record' && dirty === 2);
  // The listener is removed: a second keydown must not change the key.
  docK.fire('keydown', { key: 'z', code: 'KeyZ', preventDefault() {} });
  check('makeKeyPicker capture listener is removed after one key', data.key === 'a');
  const noKey = K.makeKeyPicker({}, 13);
  check('makeKeyPicker defaults a missing key to ArrowRight',
    noKey.children[0].value === 'ArrowRight');
}

// --- makeTargetModeSelect ---------------------------------------------
{
  let dirty = 0;
  const cells = new Map();
  P.configure({
    onDirty: () => { dirty++; },
    setCellData: (i, d) => { cells.set(i, d); }
  });
  const data = { type: 'setVelocity', targetObject: 'Player' };
  const d = P.makeTargetModeSelect(data, 3);
  check('makeTargetModeSelect defaults the mode to context and starts closed',
    data.targetMode === 'context' && d.tagName === 'DETAILS' &&
    d.className === 'advanced-prop-details' && d.open === false &&
    d.children[0].textContent === 'Target matching');
  const sel = d.children[1].children[1]; // group div -> [label, select]
  check('makeTargetModeSelect offers context/first/all',
    JSON.stringify(optPairs(sel)) === JSON.stringify(
      [['context', 'Matched object, otherwise first'],
       ['first', 'First matching object'],
       ['all', 'All matching objects']]) && sel.value === 'context');
  sel.value = 'all';
  sel.fire('change', { target: sel });
  check('makeTargetModeSelect writes the mode + cell record and marks dirty',
    data.targetMode === 'all' && cells.get(3) === data && dirty === 2);
  const open = P.makeTargetModeSelect({ targetMode: 'first' }, 4);
  check('makeTargetModeSelect starts open for a non-context mode', open.open === true);
  const custom = P.makeTargetModeSelect({ targetMode: 'context' }, 5, 'Targets:');
  check('makeTargetModeSelect honours a custom label',
    custom.children[1].children[0].textContent === 'Targets:');
  const nullData = P.makeTargetModeSelect(null, 6);
  check('makeTargetModeSelect with null data renders closed on context',
    nullData !== null && nullData.open === false);
}

// --- animation / state / blend name selects ---------------------------
{
  const cells = new Map();
  P.configure({ setCellData: (i, d) => { cells.set(i, d); } });
  const s = P.makeAnimationNameSelect({ targetObject: 'Player', animation: 'Jump' }, 9, false);
  check('makeAnimationNameSelect lists the object animations and flags a missing one',
    JSON.stringify(optPairs(s)) === JSON.stringify(
      [['', '-- Choose animation --'], ['Walk', 'Walk'], ['Idle', 'Idle'],
       ['Jump', 'Jump (missing)']]) && s.value === 'Jump');
  const any = P.makeAnimationNameSelect({ targetObject: 'Player', animation: '' }, 10, true);
  check("makeAnimationNameSelect allowAny leads with 'Any animation'",
    any.children[0].textContent === 'Any animation');
  const s2 = P.makeAnimationNameSelect({ targetObject: 'Player', animation: 'Walk' }, 11, false);
  s2.value = 'Idle';
  s2.fire('change', { target: s2 });
  check('makeAnimationNameSelect change writes the animation + cell record',
    cells.get(11).animation === 'Idle');
  const st = P.makeStateNameSelect({ targetObject: 'Player', state: 'Fly' }, 12);
  check('makeStateNameSelect lists states and flags a missing one',
    JSON.stringify(optPairs(st)) === JSON.stringify(
      [['', '-- Choose state --'], ['Run', 'Run'], ['Hurt', 'Hurt'],
       ['Fly', 'Fly (missing)']]));
  const bl = P.makeBlendNameSelect({ targetObject: 'Player', blend: '' }, 13);
  check('makeBlendNameSelect lists blends',
    JSON.stringify(optPairs(bl)) === JSON.stringify(
      [['', '-- Choose blend --'], ['Move', 'Move']]));
  const none = P.makeAnimationNameSelect({ targetObject: 'Coin', animation: '' }, 14, false);
  check('makeAnimationNameSelect for an object with no animations offers only the prompt',
    none.children.length === 1);
}

// --- makeExprInput ----------------------------------------------------
{
  let dirty = 0;
  let seen = null;
  P.configure({ onDirty: () => { dirty++; } });
  const w = P.makeExprInput('score + 1', 'e.g. x', v => { seen = v; });
  const input = w.children[0].children[0];
  const badge = w.children[0].children[1];
  const sugg = w.children[1];
  check('makeExprInput builds the wrap, input, badge, and suggestion panel',
    w.className === 'expr-input-wrap' && input.value === 'score + 1' &&
    input.placeholder === 'e.g. x' && badge.textContent === 'fx' &&
    sugg.className === 'expr-suggestions');
  check('makeExprInput flags a non-numeric value as an expression',
    input.classList.contains('has-expr') && badge.classList.contains('active'));
  input.value = '5';
  input.fire('input', { target: input });
  check('makeExprInput reports edits, clears the expression flag, and marks dirty',
    seen === '5' && !input.classList.contains('has-expr') && dirty === 1);
  input.value = '';
  input.fire('focus', { target: input });
  check('makeExprInput focus builds variable + object + math suggestion pills',
    sugg.children.length === 2 + 2 * 7 + 8, `got ${sugg.children.length}`);
  check('makeExprInput variable pills come first',
    sugg.children[0].className === 'expr-pill var-pill' &&
    sugg.children[0].textContent === 'score');
  check('makeExprInput object pills name the object property',
    sugg.children[2].className === 'expr-pill prop-pill' &&
    sugg.children[2].textContent === 'Player.posX');
  check('makeExprInput math pills come last',
    sugg.children[16].className === 'expr-pill math-pill' &&
    sugg.children[16].textContent === 'Math.floor(x)');
  // Var pill with an empty input fills it; with text it appends with +.
  sugg.children[0].onmousedown({ preventDefault() {} });
  check('makeExprInput variable pill fills an empty input',
    input.value === 'score' && seen === 'score');
  input.value = 'x + 1';
  input.fire('focus', { target: input });
  check('makeExprInput focus twice rebuilds the same pills (panel reset)',
    sugg.children.length === 24);
  sugg.children[0].onmousedown({ preventDefault() {} });
  check('makeExprInput variable pill appends with + to existing text',
    input.value === 'x + 1 + score');
  // Object pill replaces the whole input.
  sugg.children[2].onmousedown({ preventDefault() {} });
  check('makeExprInput object pill replaces the input with the property',
    input.value === 'Player.posX');
  // Math pill wraps the current value.
  input.value = '3';
  sugg.children[16].onmousedown({ preventDefault() {} });
  check('makeExprInput math pill wraps the current value',
    input.value === 'Math.floor(3)', input.value);
  const mathEmpty = P.makeExprInput('', '', () => {});
  const mi = mathEmpty.children[0].children[0];
  const ms = mathEmpty.children[1];
  mi.fire('focus', { target: mi });
  const mathPill = ms.children[ms.children.length - 1];
  mathPill.onmousedown({ preventDefault() {} });
  check('makeExprInput math pill with an empty input inserts the helper as-is',
    mi.value === 'Math.random()');
  const nullVal = P.makeExprInput(null, null, () => {});
  check('makeExprInput with null value/placeholder reads empty',
    nullVal.children[0].children[0].value === '' &&
    nullVal.children[0].children[0].placeholder === '0   or   score + 1');
}

if (failures > 0) { console.log(`${failures} check(s) failed`); process.exit(1); }
console.log('prop inputs: all checks passed');
