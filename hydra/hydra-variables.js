/* ============================================================================
 * hydra-variables.js — HydraScript shared scoped variables (P5 core-engine
 * track, item P5-1: Variables v2, slice a — the runtime core).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation
 * of scoped variables — used by:
 *   - the editor preview runtime (hydra-previewruntime.js delegates
 *     to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Idea (Godot / Unity / Unreal variables, beginner edition): until now
 * every game variable lived in one flat global dict (vars[data.varName]
 * in hydra-execute.js), so a "coins" counter in level 1 and a "coins"
 * counter in level 2 were the same variable, and two goblins could not
 * each keep their own health. Scoped variables fix that with three
 * scopes, and every value carries a type tag so the editor's Variables
 * manager (P5-1 slice b) can show what each variable holds:
 *
 *   global — one map for the whole run. A global "score" is the same
 *     variable in every scene, and it survives scene switches.
 *   scene — one map per scene id. A scene "coins" in level 1 and a
 *     scene "coins" in level 2 are different variables, and a scene's
 *     map is cleared when that scene loads, so a fresh visit starts
 *     from zero (the scene's objects reload fresh too).
 *   object — one map per object NAME (the same name the blocks address
 *     objects by, the way the growth and scaling ledgers key by name).
 *     An object "hp" on "goblin" is per goblin-name, survives scene
 *     switches, and — unlike growth and scaling — does NOT need a live
 *     object to exist: the name is the key, so a row can set a
 *     variable for an enemy before it ever spawns.
 *   local — one map for the innermost live function call (P5-3:
 *     functions / custom blocks). The functions module owns the call
 *     stack and binds each call frame's locals map here for the call,
 *     then restores the previous map — so a Set Scoped Variable with
 *     scope Local writes this call's copy, and two calls running at
 *     once never see each other's locals. Outside a function the map
 *     is the run's empty scratch map; reading it then reads as
 *     missing, the way any empty scope does.
 *
 * The state is transient run state, minted fresh on a fresh run (like
 * the XP total and the growth ledger), never in project JSON or save
 * slots — persist a value through the Read Scoped Variable block into
 * a flat variable the way growth does. What IS in project JSON is the
 * definition list (project.scopedVariables, slice b): the editor's
 * record of a variable — its name, scope, object, type, and starting
 * value — which the hosts seed into the run state at run start
 * (global + object scopes) and at scene load (scene scope, one copy
 * per scene). A variable created in the Variables manager therefore
 * exists the next time the game starts without any block setting it.
 * The scene scope resets on scene load (the host calls clearScene in
 * loadScene, both runtimes, then seeds the scene definitions);
 * global and object scopes survive scene switches inside a run.
 *
 * Typed values: every entry is { type, value } with type one of
 * 'number' | 'text' | 'bool' | 'list' | 'dict' | 'object'. A write
 * infers the type from the value it is given (a number stays a
 * number, a string stays text, true/false stays bool, an array stays
 * a list, a plain object stays a dict, an object handle stays an
 * object); set() also takes an explicit type and coerces into it.
 * Lists and dicts are deep-copied on the way in and on the way out,
 * so two variables never share one list by accident. Reads never
 * create variables: a missing variable reads as "not there"
 * (has() false, get() null, read() the caller's fallback).
 *
 * An object reference (P5-5, slice a) is a JSON-safe handle,
 * { __objectRef: true, name, id }, pointing at one live object by
 * name and id. A handle with an id tracks that exact object (a
 * spawned clone keeps its own id); a handle with an empty id is a
 * by-name reference and resolves to the first live object with the
 * name. A handle whose object is gone (destroyed, or a clone left
 * behind by a scene switch) is stale and resolves to null — it never
 * silently retargets a different object with the same name. The
 * handle itself is plain data, so it deep-copies, serializes, and
 * seeds like any other value; only the resolution step needs the
 * live objects, through resolveObjectRef. An empty handle
 * ({ __objectRef: true, name: '', id: '' }) is the "no object"
 * value, the way 0 is the "no number" value.
 *
 * Nothing ever throws; hostile input degrades to safe defaults.
 *
 * Honest limits: scoped variables are not in save slots yet — the
 * Save / Load Variable blocks still move only the flat global dict,
 * so read a scoped value into a flat variable first if it must
 * survive after the game closes (the module's serialize/deserialize
 * round-trips the whole state for that future wiring). A scene
 * definition applies to every scene — there is no per-scene
 * definition yet. There is no `hs` script-API surface yet. List and
 * dict values can be stored (by copying another variable that
 * already holds one) and built with the nested-path blocks (P5-6
 * slice a: a Set Nested Value builds the lists and structures it needs
 * on the way down; slice b: Store Object In Structure writes a handle
 * at a path and Read Object From Structure reads it back, so a list
 * of live objects is a list of handles). An object handle never
 * stores the live object itself, only its name and id, so a handle
 * saved into a definition seeds as a by-name reference and a handle
 * to a spawned clone goes stale when the clone is destroyed or the
 * scene switches. The scoped check condition compares numbers
 * numerically and text/bool as text; a list or dict never matches ==
 * (read it into a flat variable and use the array blocks). Local
 * variables exist only inside a function call (P5-3):
 * a Set Scoped Variable with scope Local outside a function writes
 * the run's scratch map, which no later call ever sees.
 *
 * Load order (index.html): hydra-variables.js BEFORE player-runtime.js
 * and script.js. player-runtime.js throws a clear error if
 * HydraVariables is missing.
 * ========================================================================== */

function hydraVariablesFactory() {
  'use strict';

  var SCOPES = ['global', 'scene', 'object', 'local'];
  var TYPES = ['number', 'text', 'bool', 'list', 'dict', 'object'];

  // A usable number, or the fallback when the value is not one.
  // Only real numbers or numeric strings count — null / undefined /
  // '' count as missing, and anything else (an array, an object, a
  // boolean) reads as the fallback instead of a coerced number
  // (Number([]) is 0, which would silently read as a real value
  // instead of the fallback — the cycle-13 strict-coercion lesson).
  function saneNum(v, fallback) {
    if (v == null || v === '') return fallback;
    if (typeof v === 'number') return isFinite(v) ? v : fallback;
    if (typeof v === 'string') {
      if (v.trim() === '') return fallback;
      var n = Number(v);
      return isFinite(n) ? n : fallback;
    }
    return fallback;
  }

  // The state itself, or null for a missing / non-object state — the
  // callers below degrade to the fresh-game default instead of
  // throwing, so a dropped module tag reads the same as a game that
  // never set a variable.
  function stateOf(state) {
    return (state && typeof state === 'object') ? state : null;
  }

  function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v) &&
      Object.prototype.toString.call(v) === '[object Object]';
  }

  // A JSON-safe deep copy (lists and dicts only — the values this
  // module stores). A value that cannot survive JSON comes back as
  // the fallback, never as a throw.
  function deepCopy(v, fallback) {
    if (v == null) return v;
    if (typeof v !== 'object') return v;
    try {
      var c = JSON.parse(JSON.stringify(v));
      return (c === undefined) ? fallback : c;
    } catch (e) { return fallback; }
  }

  // --- Names, scopes, types -------------------------------------------------

  // The variable name, trimmed, or null for a blank / non-string
  // name. Names are case-sensitive and kept exactly as typed.
  function normalizeVarName(name) {
    if (typeof name !== 'string') return null;
    var n = name.trim();
    return n === '' ? null : n;
  }

  // The scope, or 'global' for anything unrecognized — the flat
  // global dict is the historical default, so an unknown scope reads
  // as global rather than as nowhere. 'local' is the fourth scope
  // (P5-3): the innermost live function call's locals map.
  function normalizeScope(scope) {
    var s = (typeof scope === 'string') ? scope.trim().toLowerCase() : '';
    if (s === 'scene' || s === 'object' || s === 'local') return s;
    return 'global';
  }

  // The type tag for a value, or null for null / undefined (no value
  // to tag). Numbers stay numbers, strings stay text, booleans stay
  // bool, arrays stay lists, object handles stay objects (checked
  // before the plain-object rule, or a handle would read as a dict),
  // plain objects stay dicts.
  function typeOfValue(v) {
    if (v == null) return null;
    if (typeof v === 'number') return 'number';
    if (typeof v === 'string') return 'text';
    if (typeof v === 'boolean') return 'bool';
    if (Array.isArray(v)) return 'list';
    if (isObjectRef(v)) return 'object';
    if (isPlainObject(v)) return 'dict';
    return null;
  }

  // The type tag, or 'number' for anything unrecognized — the
  // expression evaluator only ever produces numbers, so number is
  // the historical default.
  function normalizeType(type) {
    var t = (typeof type === 'string') ? type.trim().toLowerCase() : '';
    return TYPES.indexOf(t) !== -1 ? t : 'number';
  }

  // Coerce a value into the named type, with the strict-number rule
  // for numbers and a plain-object rule for dicts. A null / undefined
  // value coerces to the type's empty value (0, '', false, [], {},
  // or the empty object handle). An object value comes from a live
  // object (name + id), from a handle, or from a non-empty string,
  // which names the object to track; anything else is the empty
  // handle, never a throw.
  function normalizeValue(value, type) {
    var t = normalizeType(type);
    if (t === 'number') return saneNum(value, 0);
    if (t === 'text') return (value == null) ? '' : String(value);
    if (t === 'bool') {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number') return value !== 0;
      if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
      return !!value;
    }
    if (t === 'list') return Array.isArray(value) ? deepCopy(value, []) : [];
    if (t === 'object') {
      var ref = objectRefOf(value);
      if (ref) return ref;
      if (typeof value === 'string' && value.trim() !== '') {
        return { __objectRef: true, name: value.trim(), id: '' };
      }
      return emptyObjectRef();
    }
    return isPlainObject(value) ? deepCopy(value, {}) : {};
  }

  // --- Object references (P5-5, slice a) -----------------------------------
  //
  // A variable can hold an object, not just a number or text: the
  // value is a handle, { __objectRef: true, name, id }, naming one
  // live object. The handle is plain JSON-safe data, so it stores,
  // copies, serializes, and seeds exactly like a list or a dict;
  // only resolving it back to the live object needs the host's live
  // objects, through resolveObjectRef below.

  // True when the value is an object handle (the marker is what
  // makes a handle, so an empty handle still counts).
  function isObjectRef(v) {
    return !!v && typeof v === 'object' && v.__objectRef === true &&
      typeof v.name === 'string';
  }

  // The empty handle: the "no object" value, the way 0 is the "no
  // number" value. A fresh handle, every call, so callers never
  // share one.
  function emptyObjectRef() {
    return { __objectRef: true, name: '', id: '' };
  }

  // The handle for a live object record or an existing handle, or
  // null when the value names no object. A handle passes through
  // normalized (a copy with a trimmed name and a string id); a live
  // object becomes a handle from its name and id. The name is the
  // lookup key, so a nameless value has no handle — an id alone
  // cannot be found again. An id-less object becomes a by-name
  // handle (id ''), which resolves to the first live object with
  // the name.
  function objectRefOf(obj) {
    if (isObjectRef(obj)) {
      return {
        __objectRef: true,
        name: obj.name.trim(),
        id: (obj.id == null || obj.id === '') ? '' : String(obj.id)
      };
    }
    if (!obj || typeof obj !== 'object') return null;
    var name = (typeof obj.name === 'string') ? obj.name.trim() : '';
    if (name === '') return null;
    var id = (obj.id == null || obj.id === '') ? '' : String(obj.id);
    return { __objectRef: true, name: name, id: id };
  }

  // The live object a handle points at, or null when it points at
  // nothing. lookup(name) is the host's live-objects-by-name read
  // (an array, destroyed and hidden excluded, like ctx.named). An
  // id-bearing handle matches that exact id and never falls back to
  // another object with the same name — a destroyed goblin stays
  // gone even while a second goblin lives. A by-name handle (empty
  // id) takes the first live object with the name. An empty handle,
  // a non-handle, or a throwing lookup resolves to null.
  function resolveObjectRef(ref, lookup) {
    if (!isObjectRef(ref)) return null;
    if (ref.name.trim() === '') return null;
    var list = null;
    try { list = (typeof lookup === 'function') ? lookup(ref.name) : null; } catch (e) { list = null; }
    if (!Array.isArray(list)) return null;
    var i;
    if (ref.id !== '') {
      for (i = 0; i < list.length; i++) {
        var o = list[i];
        if (o && typeof o === 'object' && o.id != null && String(o.id) === String(ref.id)) return o;
      }
      return null;
    }
    for (i = 0; i < list.length; i++) {
      if (list[i] && typeof list[i] === 'object') return list[i];
    }
    return null;
  }

  // The object-scope key for an object: its name, so the variable
  // follows the name across scenes (the level-1 goblin and the
  // level-2 goblin share the name "goblin" even though their ids
  // differ). An unnamed object falls back to its id; a nameless,
  // id-less value has no key and never stores. A bare string is
  // already a key.
  function objectKeyOf(obj) {
    if (obj == null) return null;
    if (typeof obj === 'string') {
      var s = obj.trim();
      return s === '' ? null : s;
    }
    if (typeof obj !== 'object') return null;
    if (typeof obj.name === 'string' && obj.name.trim() !== '') return obj.name.trim();
    if (obj.id != null && obj.id !== '') return String(obj.id);
    return null;
  }

  // The scene-scope key for a scene id: the id as a string. A
  // missing id has no key and never stores.
  function sceneKeyOf(sceneId) {
    if (sceneId == null || sceneId === '') return null;
    return String(sceneId);
  }

  // --- State ----------------------------------------------------------------

  function createVariablesState() {
    return { global: {}, scene: {}, object: {}, local: {} };
  }

  // Bind a function call frame's locals map as the local scope (P5-3:
  // the functions module calls this on call and restores the previous
  // map on return, so nested calls never see each other's locals).
  // Returns the map that was bound before (or {} when there was none),
  // so the host can restore it. A non-object map binds {}.
  function bindLocalScope(state, map) {
    var st = stateOf(state);
    if (!st) return {};
    var prev = (st.local && typeof st.local === 'object') ? st.local : {};
    st.local = (map && typeof map === 'object') ? map : {};
    return prev;
  }

  // Restore a previously bound locals map (the return half of
  // bindLocalScope). A non-object map restores {}.
  function restoreLocalScope(state, map) {
    var st = stateOf(state);
    if (!st) return {};
    st.local = (map && typeof map === 'object') ? map : {};
    return st.local;
  }

  // The map a scope reads and writes, or null when the scope cannot
  // resolve (a scene scope with no scene id, an object scope with no
  // object key). `create` mints the map when it is missing.
  // opts: { sceneId, objectName }.
  function scopeMapOf(state, scope, opts, create) {
    var st = stateOf(state);
    if (!st) return null;
    var s = normalizeScope(scope);
    var o = (opts && typeof opts === 'object') ? opts : {};
    if (s === 'global') {
      if (!st.global || typeof st.global !== 'object') {
        if (!create) return null;
        st.global = {};
      }
      return st.global;
    }
    if (s === 'scene') {
      var sk = sceneKeyOf(o.sceneId);
      if (sk === null) return null;
      if (!st.scene || typeof st.scene !== 'object') {
        if (!create) return null;
        st.scene = {};
      }
      if (!st.scene[sk] || typeof st.scene[sk] !== 'object') {
        if (!create) return null;
        st.scene[sk] = {};
      }
      return st.scene[sk];
    }
    if (s === 'local') {
      // P5-3: the innermost live function call's locals map, bound
      // by the functions module for the call. Outside a function it
      // is the run's scratch map (reads as missing).
      if (!st.local || typeof st.local !== 'object') {
        if (!create) return null;
        st.local = {};
      }
      return st.local;
    }
    var ok = objectKeyOf(o.objectName);
    if (ok === null) return null;
    if (!st.object || typeof st.object !== 'object') {
      if (!create) return null;
      st.object = {};
    }
    if (!st.object[ok] || typeof st.object[ok] !== 'object') {
      if (!create) return null;
      st.object[ok] = {};
    }
    return st.object[ok];
  }

  // --- Reads and writes ------------------------------------------------------

  // Store a value under a name in a scope. The type is inferred from
  // the value unless opts.type names one (then the value is coerced
  // into it). Lists and dicts are deep-copied on the way in. Returns
  // the stored entry { type, value } (a copy), or null when nothing
  // was stored (no state, a blank name, no scene id, no object key,
  // or a null / undefined value with no type to infer from).
  // opts: { sceneId, objectName, type }.
  function set(state, scope, name, value, opts) {
    var n = normalizeVarName(name);
    if (n === null) return null;
    var o = (opts && typeof opts === 'object') ? opts : {};
    var type = (o.type != null) ? normalizeType(o.type) : typeOfValue(value);
    if (type === null) return null;
    var map = scopeMapOf(state, scope, o, true);
    if (!map) return null;
    var stored = normalizeValue(value, type);
    map[n] = { type: type, value: stored };
    return { type: type, value: deepCopy(stored, stored) };
  }

  // The entry { type, value } under a name in a scope (a copy, so
  // the caller cannot mutate the stored list or dict in place), or
  // null when there is no such variable.
  // opts: { sceneId, objectName }.
  function get(state, scope, name, opts) {
    var n = normalizeVarName(name);
    if (n === null) return null;
    var map = scopeMapOf(state, scope, opts, false);
    if (!map) return null;
    var entry = map[n];
    if (!entry || typeof entry !== 'object') return null;
    var type = normalizeType(entry.type);
    return { type: type, value: deepCopy(entry.value, normalizeValue(entry.value, type)) };
  }

  // The raw value under a name in a scope (a copy for lists and
  // dicts), or the fallback when there is no such variable.
  // opts: { sceneId, objectName }.
  function read(state, scope, name, fallback, opts) {
    var entry = get(state, scope, name, opts);
    return entry ? entry.value : fallback;
  }

  // True when the scope holds a variable under the name.
  // opts: { sceneId, objectName }.
  function has(state, scope, name, opts) {
    return get(state, scope, name, opts) !== null;
  }

  // Delete a variable from a scope. Returns true when something was
  // deleted, false when there was nothing there.
  // opts: { sceneId, objectName }.
  function remove(state, scope, name, opts) {
    var n = normalizeVarName(name);
    if (n === null) return false;
    var map = scopeMapOf(state, scope, opts, false);
    if (!map || !Object.prototype.hasOwnProperty.call(map, n)) return false;
    delete map[n];
    return true;
  }

  // Every variable in a scope, name-sorted, as { name, type, value }
  // records (values deep-copied). For the scene scope this is the
  // current scene's map; for the object scope, the named object's
  // map (or every object's variables, with the object name attached,
  // when no objectName is given). An unresolvable scope lists
  // nothing.
  // opts: { sceneId, objectName }.
  function list(state, scope, opts) {
    var o = (opts && typeof opts === 'object') ? opts : {};
    var s = normalizeScope(scope);
    var st = stateOf(state);
    if (!st) return [];
    var out = [];
    var pushMap = function (map, objectName) {
      if (!map || typeof map !== 'object') return;
      Object.keys(map).sort().forEach(function (n) {
        var entry = map[n];
        if (!entry || typeof entry !== 'object') return;
        var type = normalizeType(entry.type);
        var rec = { name: n, type: type, value: deepCopy(entry.value, normalizeValue(entry.value, type)) };
        if (objectName != null) rec.objectName = objectName;
        out.push(rec);
      });
    };
    if (s === 'object' && objectKeyOf(o.objectName) === null) {
      var all = st.object;
      if (all && typeof all === 'object') {
        Object.keys(all).sort().forEach(function (k) { pushMap(all[k], k); });
      }
      return out;
    }
    var map = scopeMapOf(state, scope, o, false);
    pushMap(map, null);
    return out;
  }

  // --- Definitions (authored starting values) -------------------------
  // Slice b: a definition is the editor's record of a variable —
  // { name, scope, objectName, type, value } — stored in the project
  // (project.scopedVariables) and seeded into the run state at run
  // start (global + object scopes) and at scene load (scene scope,
  // one copy per scene at its starting value). The state itself
  // stays transient run state, minted fresh on a fresh run; only
  // the definitions are saved, so a variable created in the
  // Variables manager exists the next time the game starts without
  // any block having to set it. A scene definition applies to every
  // scene (each scene gets its own copy); an object definition needs
  // an object name. Nothing ever throws; hostile input degrades to
  // safe defaults, and a duplicate (same scope + object + name)
  // keeps the first entry.

  // The definition, normalized, or null for anything unusable (a
  // blank name, an object scope with no object, a non-object).
  function normalizeDefinition(def) {
    if (!def || typeof def !== 'object') return null;
    var name = normalizeVarName(def.name);
    if (name === null) return null;
    var scope = normalizeScope(def.scope);
    // A definition cannot be local: locals belong to a call frame,
    // not to the project. A hand-authored local definition keeps its
    // value as a global one instead of vanishing.
    if (scope === 'local') scope = 'global';
    var objectName = '';
    if (scope === 'object') {
      objectName = objectKeyOf(def.objectName);
      if (objectName === null) return null;
    }
    var type = normalizeType(def.type);
    return {
      name: name,
      scope: scope,
      objectName: objectName,
      type: type,
      value: normalizeValue(def.value, type)
    };
  }

  // The definition list, normalized and deduplicated (first entry
  // wins). A non-array reads as no definitions. Identity-preserving:
  // when the input is already clean, the SAME array comes back with
  // the SAME definition objects — editors hold references to this
  // list (the Variables panel closes over it, and the autosave's
  // normalizeProject reassigns it), so handing back a fresh array
  // every call would orphan edits made between renders: an add
  // would push into the old array and the next read would see the
  // new one without it. A dirty entry is replaced once, then the
  // list is stable.
  function normalizeDefinitions(list) {
    if (!Array.isArray(list)) return [];
    var seen = {};
    var out = [];
    var changed = false;
    list.forEach(function (d) {
      var n = normalizeDefinition(d);
      if (!n) { changed = true; return; }
      var key = n.scope + ':' + n.objectName + ':' + n.name;
      if (seen[key]) { changed = true; return; }
      seen[key] = true;
      // Keep the caller's object when it is already canonical, so
      // a row holding that object keeps writing to the live record.
      var same = !!d && typeof d === 'object' &&
        JSON.stringify(d) === JSON.stringify(n);
      if (!same) changed = true;
      out.push(same ? d : n);
    });
    if (!changed && out.length === list.length) return list;
    return out;
  }

  // The identity of a definition (scope + object + name), for the
  // editor panel's dedupe and live-value matching.
  function definitionKey(def) {
    var n = normalizeDefinition(def);
    if (!n) return null;
    return n.scope + ':' + n.objectName + ':' + n.name;
  }

  // Seed the run-start definitions (global + object scopes) into a
  // fresh run state. Returns how many were seeded. Scene definitions
  // are not seeded here — they seed per scene load (seedScene),
  // so every visit to a scene starts from its starting value.
  function seedRun(state, defs) {
    var st = stateOf(state);
    if (!st) return 0;
    var count = 0;
    normalizeDefinitions(defs).forEach(function (d) {
      if (d.scope === 'scene') return;
      if (set(st, d.scope, d.name, d.value, { type: d.type, objectName: d.objectName })) count++;
    });
    return count;
  }

  // Seed the scene definitions for the scene about to load (one copy
  // per scene at its starting value). Returns how many were seeded,
  // or 0 without a scene id.
  function seedScene(state, defs, sceneId) {
    var st = stateOf(state);
    if (!st) return 0;
    var sk = sceneKeyOf(sceneId);
    if (sk === null) return 0;
    var count = 0;
    normalizeDefinitions(defs).forEach(function (d) {
      if (d.scope !== 'scene') return;
      if (set(st, 'scene', d.name, d.value, { type: d.type, sceneId: sk })) count++;
    });
    return count;
  }

  // --- Clearing ---------------------------------------------------------------

  // Clear one scene's map (the scene-load reset: a fresh visit to a
  // scene starts with no scene variables). Returns true when a map
  // was cleared, false when there was nothing there.
  function clearScene(state, sceneId) {
    var st = stateOf(state);
    if (!st) return false;
    var sk = sceneKeyOf(sceneId);
    if (sk === null) return false;
    if (!st.scene || typeof st.scene !== 'object' || !st.scene[sk]) return false;
    if (Object.keys(st.scene[sk]).length === 0) return false;
    st.scene[sk] = {};
    return true;
  }

  // Clear a whole scope: the global map, one scene's map (opts.sceneId),
  // one object's map (opts.objectName — or every object's map when
  // no objectName is given), or the innermost call's locals map
  // ('local'). Returns true when at least one variable was cleared,
  // false when the scope was already empty.
  // opts: { sceneId, objectName }.
  function clearScope(state, scope, opts) {
    var st = stateOf(state);
    if (!st) return false;
    var o = (opts && typeof opts === 'object') ? opts : {};
    var s = normalizeScope(scope);
    if (s === 'global') {
      if (!st.global || typeof st.global !== 'object') return false;
      if (Object.keys(st.global).length === 0) return false;
      st.global = {};
      return true;
    }
    if (s === 'scene') return clearScene(state, o.sceneId);
    if (s === 'local') {
      if (!st.local || typeof st.local !== 'object') return false;
      if (Object.keys(st.local).length === 0) return false;
      st.local = {};
      return true;
    }
    var ok = objectKeyOf(o.objectName);
    if (ok === null) {
      if (!st.object || typeof st.object !== 'object') return false;
      var any = Object.keys(st.object).some(function (k) {
        return st.object[k] && typeof st.object[k] === 'object' &&
          Object.keys(st.object[k]).length > 0;
      });
      if (!any) return false;
      st.object = {};
      return true;
    }
    if (!st.object || typeof st.object !== 'object' || !st.object[ok]) return false;
    if (Object.keys(st.object[ok]).length === 0) return false;
    st.object[ok] = {};
    return true;
  }

  // Clear every scope (a fresh run). Returns true when the state was
  // usable, false for a missing state.
  function resetRun(state) {
    var st = stateOf(state);
    if (!st) return false;
    st.global = {};
    st.scene = {};
    st.object = {};
    st.local = {};
    return true;
  }

  // --- Persistence ------------------------------------------------------------

  // A JSON-safe snapshot of the whole state (typed entries already
  // are), for a future save-slot wiring. Never throws. The local map
  // snapshots the innermost call's locals at the time, if any.
  function serialize(state) {
    var st = stateOf(state);
    if (!st) return { global: {}, scene: {}, object: {}, local: {} };
    try {
      return JSON.parse(JSON.stringify({
        global: st.global || {},
        scene: st.scene || {},
        object: st.object || {},
        local: st.local || {}
      }));
    } catch (e) { return { global: {}, scene: {}, object: {}, local: {} }; }
  }

  // Rebuild state from a snapshot (a hostile or partial snapshot
  // degrades to the fresh-game default for the parts it cannot read).
  function deserialize(data) {
    var fresh = createVariablesState();
    if (!data || typeof data !== 'object') return fresh;
    var copyMap = function (src) {
      var out = {};
      if (!src || typeof src !== 'object') return out;
      Object.keys(src).forEach(function (n) {
        var entry = src[n];
        if (!entry || typeof entry !== 'object') return;
        var name = normalizeVarName(n);
        if (name === null) return;
        var type = normalizeType(entry.type);
        out[name] = { type: type, value: normalizeValue(entry.value, type) };
      });
      return out;
    };
    fresh.global = copyMap(data.global);
    fresh.local = copyMap(data.local);
    if (data.scene && typeof data.scene === 'object') {
      Object.keys(data.scene).forEach(function (k) { fresh.scene[k] = copyMap(data.scene[k]); });
    }
    if (data.object && typeof data.object === 'object') {
      Object.keys(data.object).forEach(function (k) { fresh.object[k] = copyMap(data.object[k]); });
    }
    return fresh;
  }

  // --- Routing ----------------------------------------------------------------

  // P5-9 adds Read Text Into Variable: it reads a text object's
  // displayed text into a flat variable, so it routes with the other
  // variable actions even though it reads an object, not a scope.
  function isScopedVariableAction(type) {
    return type === 'setScopedVariable' || type === 'readScopedVariable' ||
      type === 'deleteScopedVariable' || type === 'clearScopedVariables' ||
      type === 'readTextIntoVariable';
  }

  function isScopedVariableCondition(type) {
    return type === 'scopedVariableExists' || type === 'scopedVariableCheck';
  }

  // P5-5 slice a (object references as values): the two blocks that
  // move objects through variables — Pick Object Into Variable
  // stores a handle, Read Object Property reads one back out.
  // Slice b (physics queries that return data) adds the two query
  // blocks: Raycast Into Variables stores the hit object the same
  // way a pick does, and List Overlapping Objects stores a list of
  // handles in a flat list variable. Slice c (spawn/destroy as
  // instantiation) adds the two blocks that hand objects back and
  // take them away: Spawn Object Into Variable stores the clone a
  // spawn makes, and Destroy Object In Variable destroys exactly
  // the object a variable holds. P5-6 slice b (object references
  // inside structures) adds the two blocks that move a handle
  // through a nested path: Store Object In Structure writes the
  // handle a scoped variable holds into a list or dictionary at a
  // path, and Read Object From Structure reads the handle at a
  // path back into a scoped variable.
  function isObjectRefAction(type) {
    return type === 'pickObjectIntoVariable' || type === 'pickTaggedObjectIntoVariable' ||
      type === 'readObjectProperty' ||
      type === 'raycastIntoVariables' || type === 'listOverlappingObjects' ||
      type === 'spawnObjectIntoVariable' || type === 'destroyObjectInVariable' ||
      type === 'nestedStoreObject' || type === 'nestedReadObject';
  }

  return {
    SCOPES: SCOPES,
    TYPES: TYPES,
    createVariablesState: createVariablesState,
    bindLocalScope: bindLocalScope,
    restoreLocalScope: restoreLocalScope,
    normalizeScope: normalizeScope,
    normalizeVarName: normalizeVarName,
    normalizeType: normalizeType,
    typeOfValue: typeOfValue,
    normalizeValue: normalizeValue,
    objectKeyOf: objectKeyOf,
    sceneKeyOf: sceneKeyOf,
    isObjectRef: isObjectRef,
    emptyObjectRef: emptyObjectRef,
    objectRefOf: objectRefOf,
    resolveObjectRef: resolveObjectRef,
    set: set,
    get: get,
    read: read,
    has: has,
    remove: remove,
    list: list,
    normalizeDefinition: normalizeDefinition,
    normalizeDefinitions: normalizeDefinitions,
    definitionKey: definitionKey,
    seedRun: seedRun,
    seedScene: seedScene,
    clearScene: clearScene,
    clearScope: clearScope,
    resetRun: resetRun,
    serialize: serialize,
    deserialize: deserialize,
    isScopedVariableAction: isScopedVariableAction,
    isScopedVariableCondition: isScopedVariableCondition,
    isObjectRefAction: isObjectRefAction
  };
}

if (typeof window !== 'undefined') {
  window.HydraVariables = hydraVariablesFactory();
  // Self-contained source of the factory, inlined into exported playable games
  // by HydraPlayer.buildPlayableHtml so exports run without editor files.
  window.HydraVariables.factorySource = hydraVariablesFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraVariablesFactory;
