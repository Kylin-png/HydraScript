/* ============================================================================
 * hydra-outliner.js — HydraScript scene outliner (Hierarchy tab) logic
 * (P5 core-engine track, item P5-8: pro editor shell, pass 2 — slice b,
 * outliner + details polish).
 *
 * Pure logic plus the row helpers the editor's renderObjectList uses; no
 * other HydraScript dependency. Used by the editor (script.js); the
 * exported standalone game has no editor panels, so nothing here is
 * inlined into exports.
 *
 * Idea (Unreal / Unity / Godot, beginner edition): the Hierarchy tab is
 * the list of everything in the current scene, and it is the fastest
 * way to find an object you cannot click on the canvas — one buried
 * under other objects, one off-screen, one hidden behind the player.
 * Before this slice it was a flat list sorted by layer with a layer
 * badge; now it reads like a real outliner:
 *
 *   - Layer groups. Rows sit under collapsible "Layer N" headers,
 *     highest layer first (the draw order the flat list already
 *     sorted by), with a count per group. A collapsed group stays
 *     collapsed across loads — the choice is saved in localStorage
 *     and restored the next time the editor opens. While a search
 *     query is active the groups flatten away, so a search shows
 *     exactly the matching rows, like before.
 *   - Eye toggle. Every row has an eye: click it and the object is
 *     hidden — it leaves the editor stage (and the 3D view) and
 *     starts the game hidden, the same starting-visibility flag the
 *     runtimes seed into their hidden set at scene load, so a Show
 *     Object block can reveal it later. The row stays in the list,
 *     dimmed, so the object is never lost — click the eye again to
 *     bring it back. Editor-only hiding would strand the flag in
 *     the editor; starting hidden is the honest one, and the guide
 *     says so plainly.
 *   - Lock toggle. Every row has a lock: a locked object cannot be
 *     dragged on the canvas (clicking it still selects it, so it
 *     can always be inspected and unlocked). The stage element gets
 *     a dashed outline, so a locked object reads as locked where
 *     you work on it, not only in the list.
 *   - Inline rename. Double-click a name to edit it in place;
 *     Enter or clicking away commits, Escape or a blank name
 *     reverts. The same write the Inspector's Name field does.
 *   - Keyboard navigation. Focus the list and the arrow keys move
 *     the selection from row to row (Home / End jump to the ends);
 *     Enter opens the Inspector tab for the selected object.
 *
 * The details side of the slice lives in the Inspector: the object
 * properties panel opens with a summary line (kind, layer, id — the
 * three facts the old panel never showed together) and Visible /
 * Locked checkboxes that mirror the outliner's eye and lock, so the
 * two places never disagree about an object.
 *
 * Nothing ever throws; hostile input degrades to safe defaults. A
 * missing storage object simply means groups start expanded.
 *
 * Honest limits: the eye hides the object at the START of the run —
 * it is an authored starting state, not a runtime switch. A hidden
 * object still exists for logic (a block can Show it; a hidden
 * object still collides, like any invisible object in Godot). Lock
 * is editor-only: it never reaches a preview or an export, so a
 * locked object still moves when a block moves it.
 * ========================================================================== */

function hydraOutlinerFactory() {
  'use strict';

  var STORAGE_KEY = 'hydra.outlinerLayers.v1';

  // Group objects by layer, highest layer first (the draw order the
  // flat list already sorted by). Within a group the scene order is
  // kept, so two objects on one layer read top to bottom the way
  // they sit in the scene. A non-array reads as no groups.
  function groupByLayer(objects) {
    var list = Array.isArray(objects) ? objects : [];
    var byLayer = {};
    var order = [];
    var i, obj, layer;
    for (i = 0; i < list.length; i++) {
      obj = list[i];
      if (!obj || typeof obj !== 'object') continue;
      layer = (typeof obj.layer === 'number' && isFinite(obj.layer)) ? obj.layer : 0;
      if (!Object.prototype.hasOwnProperty.call(byLayer, layer)) {
        byLayer[layer] = [];
        order.push(layer);
      }
      byLayer[layer].push(obj);
    }
    order.sort(function (a, b) { return b - a; });
    return order.map(function (l) { return { layer: l, objects: byLayer[l] }; });
  }

  // The search filter the list already had: name, kind, archetype,
  // tags, and component types, case-insensitive. A blank query
  // passes everything through unchanged.
  function filterObjects(objects, query) {
    var list = Array.isArray(objects) ? objects : [];
    var q = typeof query === 'string' ? query.trim().toLowerCase() : '';
    if (!q) return list.slice();
    return list.filter(function (obj) {
      if (!obj || typeof obj !== 'object') return false;
      var haystack = [
        obj.name, obj.kind, obj.archetype,
        Array.isArray(obj.tags) ? obj.tags.join(' ') : '',
        Array.isArray(obj.components)
          ? obj.components.map(function (c) { return c && c.type; }).join(' ') : ''
      ].join(' ').toLowerCase();
      return haystack.indexOf(q) !== -1;
    });
  }

  // Parse the stored collapsed-layer map: { "2": true, "0": true }.
  // Only boolean-true entries survive; anything unparseable,
  // wrong-shaped, or holding a bad value degrades to no collapsed
  // groups — one bad entry never takes the rest down with it.
  function parseStoredCollapsed(raw) {
    var out = {};
    if (typeof raw !== 'string' || !raw) return out;
    var parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { return out; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
    Object.keys(parsed).forEach(function (key) {
      var layer = Number(key);
      if (isFinite(layer) && parsed[key] === true) out[String(layer)] = true;
    });
    return out;
  }

  // Serialize a collapsed map for storage: only the collapsed
  // layers, keys normalized to plain numbers-as-strings, so a stored
  // value is always one parseStoredCollapsed would accept back.
  function serializeCollapsed(collapsed) {
    var out = {};
    if (collapsed && typeof collapsed === 'object' && !Array.isArray(collapsed)) {
      Object.keys(collapsed).forEach(function (key) {
        var layer = Number(key);
        if (isFinite(layer) && collapsed[key] === true) out[String(layer)] = true;
      });
    }
    try { return JSON.stringify(out); } catch (e) { return '{}'; }
  }

  // Read / write the collapsed map through a localStorage-shaped
  // object (getItem / setItem). A missing or throwing storage
  // degrades to all-expanded instead of breaking the editor load.
  function readStoredCollapsed(storage) {
    try {
      if (!storage || typeof storage.getItem !== 'function') return {};
      return parseStoredCollapsed(storage.getItem(STORAGE_KEY));
    } catch (e) { return {}; }
  }

  function writeStoredCollapsed(storage, collapsed) {
    try {
      if (!storage || typeof storage.setItem !== 'function') return false;
      storage.setItem(STORAGE_KEY, serializeCollapsed(collapsed));
      return true;
    } catch (e) { return false; }
  }

  // Flip one layer's collapsed state. Returns a NEW map, so the
  // caller keeps the old one intact until it decides to persist.
  function toggleCollapsed(collapsed, layer) {
    var out = {};
    var key = String((typeof layer === 'number' && isFinite(layer)) ? layer : 0);
    if (collapsed && typeof collapsed === 'object' && !Array.isArray(collapsed)) {
      Object.keys(collapsed).forEach(function (k) {
        if (collapsed[k] === true) out[String(Number(k))] = true;
      });
    }
    if (out[key]) delete out[key];
    else out[key] = true;
    return out;
  }

  function isCollapsed(collapsed, layer) {
    if (!collapsed || typeof collapsed !== 'object') return false;
    return collapsed[String((typeof layer === 'number' && isFinite(layer)) ? layer : 0)] === true;
  }

  // The two per-object flags. Both read as strict true, so an old
  // project (no flag at all) reads as visible and unlocked — the
  // defaults every existing project already had.
  function isHidden(obj) {
    return !!(obj && typeof obj === 'object' && obj.hidden === true);
  }

  function isLocked(obj) {
    return !!(obj && typeof obj === 'object' && obj.locked === true);
  }

  function setHidden(obj, hide) {
    if (!obj || typeof obj !== 'object') return false;
    obj.hidden = !!hide;
    return obj.hidden;
  }

  function setLocked(obj, lock) {
    if (!obj || typeof obj !== 'object') return false;
    obj.locked = !!lock;
    return obj.locked;
  }

  // Rename an object. A blank name (or a missing object) is a
  // no-op that reports ok:false, so the caller reverts the edit
  // instead of writing an empty name into the project.
  function renameObject(obj, name) {
    if (!obj || typeof obj !== 'object') return { ok: false, name: '' };
    var next = typeof name === 'string' ? name.trim() : '';
    if (!next) return { ok: false, name: obj.name || '' };
    obj.name = next;
    return { ok: true, name: next };
  }

  // Move the selection one row in the direction: +1 down, -1 up.
  // Stays on the first / last row at the ends instead of wrapping,
  // and a selection that is not in the list starts at the end the
  // direction points to. An empty list has no selection.
  function moveSelection(ids, currentId, dir) {
    var list = Array.isArray(ids) ? ids : [];
    if (!list.length) return null;
    var idx = list.indexOf(currentId);
    if (idx === -1) return dir < 0 ? list[list.length - 1] : list[0];
    var next = idx + (dir < 0 ? -1 : 1);
    if (next < 0) next = 0;
    if (next > list.length - 1) next = list.length - 1;
    return list[next];
  }

  // The header line for one layer group: "Layer 2 · 3 objects".
  function layerLabel(layer, count) {
    var n = typeof count === 'number' ? count : 0;
    return 'Layer ' + layer + ' · ' + n + ' object' + (n === 1 ? '' : 's');
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    groupByLayer: groupByLayer,
    filterObjects: filterObjects,
    parseStoredCollapsed: parseStoredCollapsed,
    serializeCollapsed: serializeCollapsed,
    readStoredCollapsed: readStoredCollapsed,
    writeStoredCollapsed: writeStoredCollapsed,
    toggleCollapsed: toggleCollapsed,
    isCollapsed: isCollapsed,
    isHidden: isHidden,
    isLocked: isLocked,
    setHidden: setHidden,
    setLocked: setLocked,
    renameObject: renameObject,
    moveSelection: moveSelection,
    layerLabel: layerLabel
  };
}

if (typeof window !== 'undefined') window.HydraOutliner = hydraOutlinerFactory();
if (typeof window !== 'undefined') window.HydraOutliner.factorySource = hydraOutlinerFactory.toString();
if (typeof module !== 'undefined' && module.exports) module.exports = hydraOutlinerFactory;
