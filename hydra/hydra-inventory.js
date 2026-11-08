/* ============================================================================
 * hydra-inventory.js — HydraScript shared inventory system (P4 Advanced
 * batch 8: the backpack a player carries).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation
 * of inventory used by:
 *   - the editor preview runtime (hydra-previewruntime.js delegates
 *     to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Idea (Unity inventory / Godot resource-based items, beginner
 * edition): the project carries named item definitions — a key, a
 * potion, a gem, a quest relic — and each run carries a backpack, a
 * plain name -> count map. Blocks add, remove, set, and read counts;
 * conditions gate doors, shops, and quests on what the player
 * carries:
 *
 *   Game Start -> Add Item "Brass key" 1
 *   Object Clicked on the chest -> Add Item "Gold coin" 5
 *   Has Item "Brass key" 1 -> Show the locked door opening
 *   Item Count "Gold coin" >= 10 -> Show the shopkeeper's rare stock
 *   Read Item Count "Gold coin" into coins -> Save Game (see below)
 *
 * Data model (stored on the project, saved in project JSON, edited in
 * the Items tab):
 *   project.items = [
 *     { id: 'itm_...', name: 'Brass key', maxStack: 1,
 *       description: 'Opens the cellar door.' },
 *     { id: 'itm_...', name: 'Gold coin', maxStack: 99,
 *       description: 'Spend it at the shop.' }
 *   ];
 * `maxStack` is the most of that item the backpack holds at once
 * (default 99); adding past it fills to the cap and holds the rest.
 * An item with maxStack 1 is a unique item — a key, a relic — so a
 * second copy can never sneak in.
 *
 * Runtime state (NOT saved; per run, created fresh at game start):
 *   { counts: { 'Brass key': 1, 'Gold coin': 5 } }
 * The backpack survives scene switches inside a run (player state,
 * like the current language) and resets on a fresh run. It is NOT
 * part of the save-slot payload: save slots store game variables
 * only, so the manual path is Read Item Count into a variable before
 * Save Game, and Set Item Count from that variable after Load Game.
 * That keeps the slot format untouched and the persistence rebuildable
 * from ordinary blocks.
 *
 * Blank item names stay quiet (the same blank-quiet convention as
 * every other block family); unknown item names and bad counts warn
 * and hold. Conditions read the live counts directly and never warn:
 * an unknown or missing item simply counts as 0. Nothing ever throws;
 * hostile input degrades to safe defaults.
 *
 * Honest limits: counts are whole numbers only (fractions round
 * down); there is one backpack per run, with no per-item metadata at
 * runtime (a description lives on the definition, not on the carried
 * copy); there is no built-in inventory HUD — show counts with Read
 * Item Count into a text object, like any other number; and the
 * backpack does not travel inside save slots (see the manual path
 * above). Old projects have no items field and behave exactly as
 * before.
 *
 * Load order (index.html): hydra-inventory.js BEFORE player-runtime.js
 * and script.js. player-runtime.js throws a clear error if
 * HydraInventory is missing.
 * ========================================================================== */

function hydraInventoryFactory() {
  'use strict';

  var DEFAULT_MAX_STACK = 99;
  var MAX_STACK_CAP = 9999;

  function saneStr(v) {
    return String(v == null ? '' : v);
  }

  function saneName(v) {
    return saneStr(v).trim();
  }

  // A whole count, or null when the value is not a usable number.
  function saneCount(v) {
    var n = Number(v);
    if (!isFinite(n)) return null;
    return Math.floor(n);
  }

  // Normalize a project's item list IN PLACE — entries are repaired on
  // the existing array, so the record keeps its identity across calls
  // (the dialogue/localization lesson: the editor tab holds entry
  // references while it renders, and a wholesale replacement would
  // orphan them). Blank-name items drop, duplicate names collapse to
  // the first, maxStack keeps only a finite integer >= 1 (capped at
  // 9999; anything else reads as the 99 default), and descriptions
  // coerce to strings. Never throws.
  function normalizeItems(items) {
    try {
      if (!Array.isArray(items)) return [];
      var seen = {};
      for (var i = 0; i < items.length;) {
        var it = items[i];
        if (!it || typeof it !== 'object' || Array.isArray(it)) { items.splice(i, 1); continue; }
        var name = saneName(it.name);
        if (!name || seen[name]) { items.splice(i, 1); continue; }
        seen[name] = true;
        it.name = name;
        if (typeof it.id !== 'string' || !it.id) it.id = 'itm_' + (i + 1);
        var ms = saneCount(it.maxStack);
        it.maxStack = (ms === null || ms < 1) ? DEFAULT_MAX_STACK : Math.min(ms, MAX_STACK_CAP);
        it.description = saneStr(it.description);
        i++;
      }
      return items;
    } catch (err) {
      return [];
    }
  }

  // The normalized item names (a copy — callers may not mutate it).
  function itemNames(items) {
    try {
      return normalizeItems(items).map(function (it) { return it.name; });
    } catch (e) {
      return [];
    }
  }

  // The item definition with exactly this name (or id), or null.
  // Blank names read null.
  function getItem(items, name) {
    try {
      var want = saneName(name);
      if (!want) return null;
      var list = normalizeItems(items);
      for (var i = 0; i < list.length; i++) {
        if (list[i].name === want || list[i].id === want) return list[i];
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  // A fresh per-run backpack. Nothing is carried yet.
  function createInventoryRuntime() {
    return { counts: {} };
  }

  function isRuntime(rt) {
    return !!rt && typeof rt === 'object';
  }

  function countsOf(rt) {
    try {
      if (!isRuntime(rt)) return {};
      if (!rt.counts || typeof rt.counts !== 'object') rt.counts = {};
      return rt.counts;
    } catch (e) {
      return {};
    }
  }

  // How many of the named item the backpack holds (0 when absent,
  // blank, or corrupt — a count never reads negative).
  function itemCount(rt, name) {
    try {
      var want = saneName(name);
      if (!want) return 0;
      var n = Number(countsOf(rt)[want]);
      if (!isFinite(n)) return 0;
      return Math.max(0, Math.floor(n));
    } catch (e) {
      return 0;
    }
  }

  // True while the backpack holds at least `count` of the named item
  // (default 1). An undefined item reads false — a condition never
  // warns, it just does not pass.
  function hasItem(rt, items, name, count) {
    try {
      var want = saneName(name);
      if (!want) return false;
      if (!getItem(items, want)) return false;
      var need = saneCount(count);
      if (need === null || need < 1) need = 1;
      return itemCount(rt, want) >= need;
    } catch (e) {
      return false;
    }
  }

  function warnHook(hooks, msg) {
    try {
      if (hooks && typeof hooks.warn === 'function') hooks.warn(msg);
    } catch (e) { /* a throwing warn never breaks the inventory */ }
  }

  // Add `count` of the named item, clamped at the item's max stack.
  // Blank names stay quiet; unknown names and bad counts warn and
  // hold. Returns true when the count changed.
  function addItem(rt, items, name, count, hooks) {
    try {
      if (!isRuntime(rt)) return false;
      var want = saneName(name);
      if (!want) return false;
      var def = getItem(items, want);
      if (!def) {
        warnHook(hooks, 'Add Item: no item named "' + want + '" in the Items tab. The item was not added.');
        return false;
      }
      var n = saneCount(count);
      if (n === null || n < 1) {
        warnHook(hooks, 'Add Item: count "' + count + '" is not a whole number of 1 or more. The item was not added.');
        return false;
      }
      var counts = countsOf(rt);
      counts[want] = Math.min(def.maxStack, itemCount(rt, want) + n);
      return true;
    } catch (e) {
      return false;
    }
  }

  // Remove up to `count` of the named item (fewer held than asked
  // removes what is there). The entry drops when the count reaches 0.
  // Blank names stay quiet; unknown names and bad counts warn and
  // hold. Returns true when the count changed.
  function removeItem(rt, items, name, count, hooks) {
    try {
      if (!isRuntime(rt)) return false;
      var want = saneName(name);
      if (!want) return false;
      var def = getItem(items, want);
      if (!def) {
        warnHook(hooks, 'Remove Item: no item named "' + want + '" in the Items tab. Nothing was removed.');
        return false;
      }
      var n = saneCount(count);
      if (n === null || n < 1) {
        warnHook(hooks, 'Remove Item: count "' + count + '" is not a whole number of 1 or more. Nothing was removed.');
        return false;
      }
      var have = itemCount(rt, want);
      if (have <= 0) return true;
      var left = have - Math.min(n, have);
      var counts = countsOf(rt);
      if (left <= 0) delete counts[want];
      else counts[want] = left;
      return true;
    } catch (e) {
      return false;
    }
  }

  // Set the named item's count outright, clamped to 0..maxStack (0
  // drops the entry). Blank names stay quiet; unknown names and bad
  // counts warn and hold. Returns true when the count changed.
  function setItemCount(rt, items, name, count, hooks) {
    try {
      if (!isRuntime(rt)) return false;
      var want = saneName(name);
      if (!want) return false;
      var def = getItem(items, want);
      if (!def) {
        warnHook(hooks, 'Set Item Count: no item named "' + want + '" in the Items tab. The count was not changed.');
        return false;
      }
      var n = saneCount(count);
      if (n === null) {
        warnHook(hooks, 'Set Item Count: count "' + count + '" is not a whole number. The count was not changed.');
        return false;
      }
      n = Math.max(0, Math.min(def.maxStack, n));
      var counts = countsOf(rt);
      if (n <= 0) delete counts[want];
      else counts[want] = n;
      return true;
    } catch (e) {
      return false;
    }
  }

  // Read the named item's count, or null when the name is blank or
  // the item is not defined (blank stays quiet, unknown warns).
  // A defined item with nothing carried reads 0.
  function readItemCount(rt, items, name, hooks) {
    try {
      if (!isRuntime(rt)) return null;
      var want = saneName(name);
      if (!want) return null;
      if (!getItem(items, want)) {
        warnHook(hooks, 'Read Item Count: no item named "' + want + '" in the Items tab. The variable was not changed.');
        return null;
      }
      return itemCount(rt, want);
    } catch (e) {
      return null;
    }
  }

  // Empty the whole backpack. Always succeeds; a missing runtime is a
  // quiet no-op.
  function clearInventory(rt) {
    try {
      if (!isRuntime(rt)) return false;
      var counts = countsOf(rt);
      Object.keys(counts).forEach(function (k) { delete counts[k]; });
      return true;
    } catch (e) {
      return false;
    }
  }

  // Every carried item as { name, count } pairs, sorted by name (a
  // copy — callers may not mutate it). Empty backpack reads [].
  function inventoryList(rt) {
    try {
      var counts = countsOf(rt);
      return Object.keys(counts).sort().map(function (k) {
        return { name: k, count: itemCount(rt, k) };
      }).filter(function (e) { return e.count > 0; });
    } catch (e) {
      return [];
    }
  }

  function isInventoryAction(type) {
    return type === 'addItem' || type === 'removeItem' ||
      type === 'setItemCount' || type === 'readItemCount' ||
      type === 'clearInventory';
  }

  function isInventoryCondition(type) {
    return type === 'hasItem' || type === 'itemCount';
  }

  return {
    DEFAULT_MAX_STACK: DEFAULT_MAX_STACK,
    MAX_STACK_CAP: MAX_STACK_CAP,
    normalizeItems: normalizeItems,
    itemNames: itemNames,
    getItem: getItem,
    createInventoryRuntime: createInventoryRuntime,
    itemCount: itemCount,
    hasItem: hasItem,
    addItem: addItem,
    removeItem: removeItem,
    setItemCount: setItemCount,
    readItemCount: readItemCount,
    clearInventory: clearInventory,
    inventoryList: inventoryList,
    isInventoryAction: isInventoryAction,
    isInventoryCondition: isInventoryCondition
  };
}

if (typeof window !== 'undefined') {
  window.HydraInventory = hydraInventoryFactory();
  // Self-contained source of the factory, inlined into exported playable games
  // by HydraPlayer.buildPlayableHtml so exports run without editor files.
  window.HydraInventory.factorySource = hydraInventoryFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraInventoryFactory;
