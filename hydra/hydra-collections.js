/* ============================================================================
 * hydra-collections.js — HydraScript shared collections (arrays/structures).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation of
 * list and dictionary (structure) operations used by:
 *   - the editor preview runtime (script.js delegates to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Model: any game variable can hold an array (a list) or a structure (a set
 * of named fields, like a dictionary). The collection blocks create the
 * container on first write — a variable that held a number becomes an empty
 * list/structure the first time a collection block writes to it (documented
 * on the blocks). Conditions never create variables: they see a missing
 * variable as an empty list / empty structure.
 *
 * Conventions (kept identical in preview and exports):
 *   - Indexes are 0-based; a negative index counts back from the end
 *     (-1 is the last item), like many scripting languages.
 *   - Out-of-range reads give 0 (never throw, never undefined).
 *   - Set Array Item auto-grows the list, filling gaps with 0, up to
 *     MAX_ARRAY_LENGTH (10000) — past that the write is dropped.
 *   - Block "value" inputs carry a kind: number (an expression), text
 *     (literal text), true/false, or variable (deep-copies another
 *     variable's value, so editing one list never edits the other).
 *   - Nothing here ever throws; bad input produces a safe fallback and,
 *     where the block would silently do nothing surprising, a warning
 *     through hooks.warn (the runtimes dedupe repeat warnings).
 *
 * Nested paths (P5-6, data structures): a path walks through lists and
 * structures in one block — `party[0].hp` reads the hp field of the
 * first dictionary in the party list, `player.stats.hp` reads a field
 * of a field. parsePath turns the text into steps ({ field } or
 * { index }); getPathValue reads (a missing step reads as 0, like every
 * other out-of-range read here); setPathValue writes, building the
 * containers it needs on the way down (a list step grows the list with
 * 0s, a field step creates the dictionary) and capping lists at
 * MAX_ARRAY_LENGTH. A nested write is the easy way to grow a list of
 * dictionaries one step at a time; the manual way — Get Array Item into
 * a temp variable, Set Structure Field on it, Set Array Item back — still
 * works and means the same thing. Object handles travel the same paths:
 * Store Object In Structure writes a handle at a path and Read Object
 * From Structure reads it back (their dispatch lives in
 * hydra-execute.js, next to the other object-reference blocks, because
 * only it sees both the flat variables and the scoped ones).
 *
 * Load order (index.html): hydra-collections.js BEFORE player-runtime.js and
 * script.js. player-runtime.js throws a clear error if HydraCollections is
 * missing.
 * ========================================================================== */

function hydraCollectionsFactory() {
  'use strict';

  var MAX_ARRAY_LENGTH = 10000;

  var ACTION_TYPES = [
    'arrayPush', 'arrayPop', 'arraySetItem', 'arrayGetItem', 'arrayInsert',
    'arrayRemoveAt', 'arrayRemoveValue', 'arrayClear', 'arraySort',
    'arrayShuffle', 'arrayJoin', 'arrayMath',
    'structSetField', 'structGetField', 'structRemoveField', 'structClear',
    'structKeys', 'varToJson', 'varFromJson',
    'nestedGet', 'nestedSet'
  ];
  var CONDITION_TYPES = ['arrayLength', 'arrayContains', 'structHasField'];

  function isCollectionAction(t) { return ACTION_TYPES.indexOf(t) >= 0; }
  function isCollectionCondition(t) { return CONDITION_TYPES.indexOf(t) >= 0; }

  // ---------- type helpers ----------

  function isArray(v) { return Array.isArray(v); }
  function isStructure(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  // Read-only coercions for conditions/getters: never mutate the store.
  function readArray(vars, name) {
    var v = vars ? vars[name] : undefined;
    return Array.isArray(v) ? v : null;
  }
  function readStructure(vars, name) {
    var v = vars ? vars[name] : undefined;
    return isStructure(v) ? v : null;
  }

  // Write coercions: create the container when it is missing or the wrong
  // kind. Replacing a non-container is documented on the blocks.
  function ensureArray(vars, name) {
    var v = vars[name];
    if (!Array.isArray(v)) { v = []; vars[name] = v; }
    return v;
  }
  function ensureStructure(vars, name) {
    var v = vars[name];
    if (!isStructure(v)) { v = {}; vars[name] = v; }
    return v;
  }

  function varNameOf(data) {
    return String(data.varName == null ? '' : data.varName).trim();
  }
  function storeNameOf(data) {
    return String(data.storeVarName == null ? '' : data.storeVarName).trim();
  }
  function fieldNameOf(data) {
    return String(data.field == null ? '' : data.field).trim();
  }

  function truncIndex(raw) {
    var i = Math.trunc(Number(raw));
    return isFinite(i) ? i : 0;
  }

  // Normalizes an index into 0..len-1 (negative counts from the end).
  function normalizeIndex(arr, rawIndex) {
    if (!Array.isArray(arr)) return { ok: false, index: 0 };
    var len = arr.length;
    var i = truncIndex(rawIndex);
    if (i < 0) i = len + i;
    if (i < 0 || i >= len) return { ok: false, index: i };
    return { ok: true, index: i };
  }

  function numOf(v) {
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }
  function strOf(v) {
    return v === null || v === undefined ? '' : String(v);
  }

  function sameValue(a, b) {
    if (a === b) return true;
    return typeof a === 'number' && typeof b === 'number' && isNaN(a) && isNaN(b);
  }

  function deepCopy(v) {
    if (v === null || typeof v !== 'object') return v;
    try { return JSON.parse(JSON.stringify(v)); } catch (err) { return v; }
  }

  function safeStringify(v) {
    try {
      var t = JSON.stringify(v);
      return t === undefined ? 'null' : t;
    } catch (err) { return 'null'; }
  }

  // Mirrors the engines' compareValues/compare helpers (loose == / !=).
  function compareValues(left, operator, right) {
    switch (operator) {
      case '>=': return left >= right;
      case '<=': return left <= right;
      case '==': return left == right; // eslint-disable-line eqeqeq
      case '!=': return left != right; // eslint-disable-line eqeqeq
      case '>':  return left > right;
      case '<':  return left < right;
      default:   return false;
    }
  }

  // ---------- array operations (mutate in place) ----------

  function pushItem(arr, value) { if (!Array.isArray(arr)) return { ok: false }; arr.push(value); return { ok: true }; }

  function popItem(arr) {
    if (!Array.isArray(arr)) return { ok: false, value: 0 };
    return arr.length ? { ok: true, value: arr.pop() } : { ok: false, value: 0 };
  }

  function getItem(arr, rawIndex) {
    if (!Array.isArray(arr)) return { ok: false, value: 0 };
    var n = normalizeIndex(arr, rawIndex);
    if (!n.ok) return { ok: false, value: 0 };
    var v = arr[n.index];
    return { ok: true, value: v === undefined ? 0 : v };
  }

  function setItem(arr, rawIndex, value) {
    if (!Array.isArray(arr)) return { ok: false };
    var i = truncIndex(rawIndex);
    if (i < 0) i = arr.length + i;
    if (i < 0 || i >= MAX_ARRAY_LENGTH) return { ok: false };
    while (arr.length < i) arr.push(0);
    arr[i] = value;
    return { ok: true };
  }

  function insertItem(arr, rawIndex, value) {
    if (!Array.isArray(arr)) return { ok: false };
    if (arr.length >= MAX_ARRAY_LENGTH) return { ok: false };
    var i = truncIndex(rawIndex);
    if (i < 0) i = arr.length + i;
    if (i < 0) i = 0;
    if (i > arr.length) i = arr.length;
    arr.splice(i, 0, value);
    return { ok: true };
  }

  function removeAt(arr, rawIndex) {
    if (!Array.isArray(arr)) return { ok: false, value: 0 };
    var n = normalizeIndex(arr, rawIndex);
    if (!n.ok) return { ok: false, value: 0 };
    return { ok: true, value: arr.splice(n.index, 1)[0] };
  }

  function indexOfValue(arr, value) {
    if (!Array.isArray(arr)) return -1;
    for (var i = 0; i < arr.length; i++) if (sameValue(arr[i], value)) return i;
    return -1;
  }

  function removeValue(arr, value) {
    if (!Array.isArray(arr)) return { ok: false };
    var i = indexOfValue(arr, value);
    if (i < 0) return { ok: false };
    arr.splice(i, 1);
    return { ok: true };
  }

  function clearArray(arr) { if (!Array.isArray(arr)) return { ok: false }; arr.length = 0; return { ok: true }; }

  function arrayLengthOf(arr) { if (!Array.isArray(arr)) return 0; return arr.length; }

  function containsValue(arr, value) { if (!Array.isArray(arr)) return false; return indexOfValue(arr, value) >= 0; }

  function joinArray(arr, sep) {
    if (!Array.isArray(arr)) return '';
    var s = sep == null ? ',' : String(sep);
    return arr.map(function (v) {
      if (v === null || v === undefined) return '';
      if (typeof v === 'object') return safeStringify(v);
      return String(v);
    }).join(s);
  }

  function sortArray(arr, mode) {
    if (!Array.isArray(arr)) return { ok: false };
    var m = String(mode || 'num-asc');
    var cmp;
    if (m === 'num-desc') {
      cmp = function (a, b) { return numOf(b) - numOf(a); };
    } else if (m === 'text-asc') {
      cmp = function (a, b) { var x = strOf(a), y = strOf(b); return x < y ? -1 : x > y ? 1 : 0; };
    } else if (m === 'text-desc') {
      cmp = function (a, b) { var x = strOf(a), y = strOf(b); return x < y ? 1 : x > y ? -1 : 0; };
    } else {
      cmp = function (a, b) { return numOf(a) - numOf(b); };
    }
    arr.sort(cmp);
    return { ok: true };
  }

  function shuffleArray(arr) {
    if (!Array.isArray(arr)) return { ok: false };
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return { ok: true };
  }

  // op: 'sum' | 'average' | 'min' | 'max'. Non-numbers count as 0.
  function arrayMath(arr, op) {
    if (!Array.isArray(arr)) return { ok: true, value: 0 };
    var o = String(op || 'sum');
    if (!arr.length) return { ok: true, value: 0 };
    var nums = arr.map(numOf);
    var i, total;
    if (o === 'average') {
      total = 0;
      for (i = 0; i < nums.length; i++) total += nums[i];
      return { ok: true, value: total / nums.length };
    }
    if (o === 'min') return { ok: true, value: Math.min.apply(null, nums) };
    if (o === 'max') return { ok: true, value: Math.max.apply(null, nums) };
    total = 0;
    for (i = 0; i < nums.length; i++) total += nums[i];
    return { ok: true, value: total };
  }

  // ---------- structure operations (mutate in place) ----------

  function getField(obj, key) {
    if (!isStructure(obj)) return { ok: false, value: 0 };
    var k = String(key == null ? '' : key).trim();
    if (!k || !Object.prototype.hasOwnProperty.call(obj, k)) return { ok: false, value: 0 };
    var v = obj[k];
    return { ok: true, value: v === undefined ? 0 : v };
  }

  function setField(obj, key, value) {
    if (!isStructure(obj)) return { ok: false };
    var k = String(key == null ? '' : key).trim();
    if (!k) return { ok: false };
    obj[k] = value;
    return { ok: true };
  }

  function hasField(obj, key) {
    if (!isStructure(obj)) return false;
    var k = String(key == null ? '' : key).trim();
    return !!k && Object.prototype.hasOwnProperty.call(obj, k);
  }

  function removeField(obj, key) {
    if (!isStructure(obj)) return { ok: false };
    var k = String(key == null ? '' : key).trim();
    if (!k || !Object.prototype.hasOwnProperty.call(obj, k)) return { ok: false };
    delete obj[k];
    return { ok: true };
  }

  function clearStructure(obj) {
    if (!isStructure(obj)) return { ok: true };
    Object.keys(obj).forEach(function (k) { delete obj[k]; });
    return { ok: true };
  }

  function structKeys(obj) { if (!isStructure(obj)) return []; return Object.keys(obj); }

  // ---------- nested paths (P5-6) ----------
  // A path is dot-separated field names with [n] index steps, e.g.
  // `party[0].hp`, `player.stats.hp`, `[0].name` (the root itself is a
  // list). Whitespace around a step is ignored; a step is a field name
  // (letters, digits, underscore, never starting with a digit) or a
  // whole-number index in brackets. Anything else — a blank path, an
  // empty segment, an unclosed bracket, a non-number index — is not a
  // path and parses to { ok: false }.

  function parsePath(text) {
    var raw = (text == null) ? '' : String(text).trim();
    if (!raw) return { ok: false, steps: [] };
    var steps = [];
    var i = 0;
    var n = raw.length;
    var readField = function () {
      var start = i;
      while (i < n && /[A-Za-z0-9_]/.test(raw[i])) i++;
      return raw.slice(start, i);
    };
    while (i < n) {
      var ch = raw[i];
      if (ch === '.') {
        i++;
        while (i < n && (raw[i] === ' ' || raw[i] === '\t')) i++;
        if (i >= n) return { ok: false, steps: [] };
        var f = readField();
        if (!f || /^[0-9]/.test(f)) return { ok: false, steps: [] };
        steps.push({ field: f });
      } else if (ch === '[') {
        i++;
        var start = i;
        while (i < n && raw[i] !== ']') i++;
        if (i >= n) return { ok: false, steps: [] };
        var num = raw.slice(start, i).trim();
        i++;
        if (!/^-?\d+$/.test(num)) return { ok: false, steps: [] };
        steps.push({ index: parseInt(num, 10) });
      } else if (/[A-Za-z_]/.test(ch)) {
        var f2 = readField();
        if (!f2) return { ok: false, steps: [] };
        steps.push({ field: f2 });
      } else if (ch === ' ' || ch === '\t') {
        i++;
      } else {
        return { ok: false, steps: [] };
      }
    }
    if (!steps.length) return { ok: false, steps: [] };
    return { ok: true, steps: steps };
  }

  // The value at the end of a path, or { ok: false, value: 0 } when a
  // step is missing: the root is not a container, a field is absent, an
  // index is out of range, or a step walks through a plain value. The
  // value itself is returned as stored (like getField / getItem).
  function getPathValue(root, steps) {
    if (!Array.isArray(steps) || !steps.length) return { ok: false, value: 0 };
    var cur = root;
    for (var s = 0; s < steps.length; s++) {
      var step = steps[s];
      if (step.field !== undefined) {
        if (!isStructure(cur)) return { ok: false, value: 0 };
        if (!Object.prototype.hasOwnProperty.call(cur, step.field)) return { ok: false, value: 0 };
        cur = cur[step.field];
      } else {
        if (!Array.isArray(cur)) return { ok: false, value: 0 };
        var ni = normalizeIndex(cur, step.index);
        if (!ni.ok) return { ok: false, value: 0 };
        cur = cur[ni.index];
      }
      if (cur === undefined) return { ok: false, value: 0 };
    }
    return { ok: true, value: cur };
  }

  // Write a value at the end of a path, building the containers it needs
  // on the way down: a field step through a missing or plain value makes
  // a dictionary, an index step makes a list (grown with 0s like
  // setItem, capped at MAX_ARRAY_LENGTH). The root must already be a
  // list or a structure — the dispatch replaces a non-container root
  // first (a list when the first step is an index, a dictionary when it
  // is a field). Returns { ok: true } or { ok: false } when the write
  // cannot land (an index past the cap, a negative index past the start,
  // a step through a plain number or text that is not the last step's
  // parent — those parents are rebuilt, so only the cap and the range
  // fail). Never throws.
  function setPathValue(root, steps, value) {
    if ((!Array.isArray(root) && !isStructure(root)) || !Array.isArray(steps) || !steps.length) {
      return { ok: false };
    }
    var cur = root;
    for (var s = 0; s < steps.length - 1; s++) {
      var step = steps[s];
      var next = steps[s + 1];
      if (step.field !== undefined) {
        if (!isStructure(cur)) return { ok: false };
        var child = cur[step.field];
        if (next.field !== undefined) {
          if (!isStructure(child)) { child = {}; cur[step.field] = child; }
        } else {
          if (!Array.isArray(child)) { child = []; cur[step.field] = child; }
        }
        cur = child;
      } else {
        if (!Array.isArray(cur)) return { ok: false };
        var idx = truncIndex(step.index);
        if (idx < 0) idx = cur.length + idx;
        if (idx < 0 || idx >= MAX_ARRAY_LENGTH) return { ok: false };
        while (cur.length <= idx) cur.push(0);
        var item = cur[idx];
        if (next.field !== undefined) {
          if (!isStructure(item)) { item = {}; cur[idx] = item; }
        } else {
          if (!Array.isArray(item)) { item = []; cur[idx] = item; }
        }
        cur = item;
      }
    }
    var last = steps[steps.length - 1];
    if (last.field !== undefined) {
      if (!isStructure(cur)) return { ok: false };
      cur[last.field] = value;
      return { ok: true };
    }
    if (!Array.isArray(cur)) return { ok: false };
    return setItem(cur, last.index, value);
  }

  // ---------- JSON bridge ----------

  function parseJson(text) {
    try {
      var v = JSON.parse(String(text));
      return { ok: true, value: v === undefined ? null : v };
    } catch (err) {
      return { ok: false, value: null };
    }
  }

  function stringifyJson(value) {
    try {
      var t = JSON.stringify(value);
      return { ok: true, text: t === undefined ? 'null' : t };
    } catch (err) {
      return { ok: false, text: 'null' };
    }
  }

  // ---------- block value resolution ----------
  // data.valueKind: 'number' | 'text' | 'true' | 'false' | 'variable'.
  // hooks: { num(raw) -> { value, ok }, warn(msg), lookupVar(name) -> value }.

  function resolveBlockValue(data, hooks) {
    var kind = String(data.valueKind || 'number');
    if (kind === 'text') return { ok: true, value: String(data.value == null ? '' : data.value) };
    if (kind === 'true') return { ok: true, value: true };
    if (kind === 'false') return { ok: true, value: false };
    if (kind === 'variable') {
      var nm = String(data.value == null ? '' : data.value).trim();
      if (!nm) {
        hooks.warn('Copy variable: the variable name is blank; using 0.');
        return { ok: true, value: 0 };
      }
      var src = hooks.lookupVar(nm);
      return { ok: true, value: deepCopy(src === undefined ? 0 : src) };
    }
    var info = hooks.num(data.value);
    return info && info.ok ? { ok: true, value: info.value } : { ok: false, value: 0 };
  }

  function resolveIndex(data, hooks) {
    var info = hooks.num(data.index);
    return info && info.ok ? { ok: true, value: info.value } : { ok: false, value: 0 };
  }

  // ---------- action dispatch ----------

  function applyCollectionAction(vars, data, hooks) {
    if (!vars || typeof vars !== 'object') {
      hooks.warn('Collection block: the variable store is unavailable; nothing happened.');
      return;
    }
    var name = varNameOf(data);
    if (!name) {
      hooks.warn('Collection block: the variable name is blank; nothing happened.');
      return;
    }
    var store = storeNameOf(data);
    var v, r, idx;
    switch (data.type) {
      case 'arrayPush':
        v = resolveBlockValue(data, hooks);
        if (!v.ok) return;
        pushItem(ensureArray(vars, name), v.value);
        break;
      case 'arrayPop': {
        r = popItem(ensureArray(vars, name));
        if (store) vars[store] = r.ok ? r.value : 0;
        break;
      }
      case 'arraySetItem':
        idx = resolveIndex(data, hooks);
        if (!idx.ok) return;
        v = resolveBlockValue(data, hooks);
        if (!v.ok) return;
        if (!setItem(ensureArray(vars, name), idx.value, v.value).ok) {
          hooks.warn('Set Array Item: the index is out of range; nothing changed.');
        }
        break;
      case 'arrayGetItem':
        idx = resolveIndex(data, hooks);
        if (!idx.ok) return;
        r = getItem(ensureArray(vars, name), idx.value);
        if (!store) { hooks.warn('Get Array Item: no target variable; nothing stored.'); break; }
        vars[store] = r.ok ? r.value : 0;
        break;
      case 'arrayInsert':
        idx = resolveIndex(data, hooks);
        if (!idx.ok) return;
        v = resolveBlockValue(data, hooks);
        if (!v.ok) return;
        insertItem(ensureArray(vars, name), idx.value, v.value);
        break;
      case 'arrayRemoveAt':
        idx = resolveIndex(data, hooks);
        if (!idx.ok) return;
        r = removeAt(ensureArray(vars, name), idx.value);
        if (store) vars[store] = r.ok ? r.value : 0;
        break;
      case 'arrayRemoveValue':
        v = resolveBlockValue(data, hooks);
        if (!v.ok) return;
        removeValue(ensureArray(vars, name), v.value);
        break;
      case 'arrayClear':
        clearArray(ensureArray(vars, name));
        break;
      case 'arraySort':
        sortArray(ensureArray(vars, name), data.sortMode);
        break;
      case 'arrayShuffle':
        shuffleArray(ensureArray(vars, name));
        break;
      case 'arrayJoin':
        if (!store) { hooks.warn('Join Array: no target variable; nothing stored.'); break; }
        vars[store] = joinArray(ensureArray(vars, name), data.separator);
        break;
      case 'arrayMath':
        if (!store) { hooks.warn('Array Total: no target variable; nothing stored.'); break; }
        vars[store] = arrayMath(ensureArray(vars, name), data.mathOp).value;
        break;
      case 'structSetField': {
        var field = fieldNameOf(data);
        if (!field) { hooks.warn('Set Structure Field: the field name is blank; nothing changed.'); break; }
        v = resolveBlockValue(data, hooks);
        if (!v.ok) return;
        setField(ensureStructure(vars, name), field, v.value);
        break;
      }
      case 'structGetField': {
        var gfield = fieldNameOf(data);
        r = getField(ensureStructure(vars, name), gfield);
        if (!store) { hooks.warn('Get Structure Field: no target variable; nothing stored.'); break; }
        vars[store] = r.ok ? r.value : 0;
        break;
      }
      case 'structRemoveField':
        removeField(ensureStructure(vars, name), fieldNameOf(data));
        break;
      case 'structClear':
        clearStructure(ensureStructure(vars, name));
        break;
      case 'structKeys':
        if (!store) { hooks.warn('List Structure Keys: no target variable; nothing stored.'); break; }
        vars[store] = structKeys(ensureStructure(vars, name));
        break;
      case 'varToJson':
        if (!store) { hooks.warn('Variable To JSON: no target variable; nothing stored.'); break; }
        vars[store] = stringifyJson(vars[name]).text;
        break;
      case 'varFromJson': {
        var parsed = parseJson(data.jsonText);
        if (!parsed.ok) {
          hooks.warn('Variable From JSON: the text is not valid JSON; the variable was left unchanged.');
          break;
        }
        vars[name] = parsed.value;
        break;
      }
      case 'nestedGet': {
        var gpath = parsePath(data.path);
        if (!gpath.ok) { hooks.warn('Get Nested Value: the path is blank or not a path; nothing stored.'); break; }
        if (!store) { hooks.warn('Get Nested Value: no target variable; nothing stored.'); break; }
        var gval = getPathValue(vars[name], gpath.steps);
        vars[store] = gval.ok ? gval.value : 0;
        break;
      }
      case 'nestedSet': {
        var spath = parsePath(data.path);
        if (!spath.ok) { hooks.warn('Set Nested Value: the path is blank or not a path; nothing changed.'); break; }
        var sroot = vars[name];
        if (!Array.isArray(sroot) && !isStructure(sroot)) {
          sroot = (spath.steps[0].index !== undefined) ? [] : {};
          vars[name] = sroot;
        }
        v = resolveBlockValue(data, hooks);
        if (!v.ok) return;
        if (!setPathValue(sroot, spath.steps, v.value).ok) {
          hooks.warn('Set Nested Value: the index is out of range; nothing changed.');
        }
        break;
      }
      default:
        hooks.warn('Unknown collection block type "' + data.type + '" — skipping.');
        break;
    }
  }

  // ---------- condition dispatch (read-only; never creates variables) ----------

  function evalCollectionCondition(vars, data, hooks) {
    var name = varNameOf(data);
    var ctx = { variable: name };
    if (!name) return { pass: false, context: ctx };
    switch (data.type) {
      case 'arrayLength': {
        var arr = readArray(vars, name);
        var len = arr ? arr.length : 0;
        var cmp = hooks.num(data.compareValue == null ? 0 : data.compareValue);
        var pass = cmp.ok && compareValues(len, data.operator, cmp.value);
        return { pass: pass, context: { variable: name, length: len } };
      }
      case 'arrayContains': {
        var carr = readArray(vars, name);
        var needle = resolveBlockValue(data, hooks);
        var found = needle.ok && !!carr && containsValue(carr, needle.value);
        return { pass: found, context: { variable: name } };
      }
      case 'structHasField': {
        var sobj = readStructure(vars, name);
        var has = !!sobj && hasField(sobj, data.field);
        return { pass: has, context: { variable: name, field: fieldNameOf(data) } };
      }
      default:
        return { pass: false, context: ctx };
    }
  }

  return {
    MAX_ARRAY_LENGTH: MAX_ARRAY_LENGTH,
    ACTION_TYPES: ACTION_TYPES,
    CONDITION_TYPES: CONDITION_TYPES,
    isCollectionAction: isCollectionAction,
    isCollectionCondition: isCollectionCondition,
    isArray: isArray,
    isStructure: isStructure,
    readArray: readArray,
    readStructure: readStructure,
    ensureArray: ensureArray,
    ensureStructure: ensureStructure,
    normalizeIndex: normalizeIndex,
    sameValue: sameValue,
    deepCopy: deepCopy,
    compareValues: compareValues,
    pushItem: pushItem,
    popItem: popItem,
    getItem: getItem,
    setItem: setItem,
    insertItem: insertItem,
    removeAt: removeAt,
    indexOfValue: indexOfValue,
    removeValue: removeValue,
    clearArray: clearArray,
    arrayLengthOf: arrayLengthOf,
    containsValue: containsValue,
    joinArray: joinArray,
    sortArray: sortArray,
    shuffleArray: shuffleArray,
    arrayMath: arrayMath,
    getField: getField,
    setField: setField,
    hasField: hasField,
    removeField: removeField,
    clearStructure: clearStructure,
    structKeys: structKeys,
    parseJson: parseJson,
    stringifyJson: stringifyJson,
    parsePath: parsePath,
    getPathValue: getPathValue,
    setPathValue: setPathValue,
    resolveBlockValue: resolveBlockValue,
    applyCollectionAction: applyCollectionAction,
    evalCollectionCondition: evalCollectionCondition
  };
}

window.HydraCollections = hydraCollectionsFactory();
// Self-contained source of the factory, inlined into exported playable games
// by HydraPlayer.buildPlayableHtml so exports run without editor files.
window.HydraCollections.factorySource = hydraCollectionsFactory.toString();
