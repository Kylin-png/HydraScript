/* ============================================================================
 * hydra-save.js — HydraScript shared save-slot helpers (F3: player save slots).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation of
 * versioned named save slots used by:
 *   - the editor preview runtime (script.js delegates to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Data model:
 *   A slot is one localStorage entry keyed `hydraSlot:<name>` holding
 *   { version: 1, savedAt: <epoch ms>, data: <plain JSON variables> }.
 *   Slots are per-browser memory-card slots: any exported Hydra game (and
 *   the editor preview) reads and writes the same `hydraSlot:` keys, so a
 *   player can carry a save from the preview into an exported build and
 *   vice versa. Corrupt entries read back as null — never throw — and a
 *   version field is stored so a future Hydra can migrate old saves.
 *
 * The simple on-ramp (GDevelop-style): four blocks — Save Game (writes ALL
 * game variables into a named slot), Load Game (restores them), Delete
 * Save (clears the slot), and the Save Slot Exists condition (true when a
 * valid save is stored). Typical wiring for level-unlock progression:
 *   Save Slot Exists "Slot 1" (reversed) → Show "New Game" prompt
 *   Game Start → Load Game "Slot 1" → ...then levels read `levelUnlocked`
 *   Level Complete → Set Variable levelUnlocked +1 → Save Game "Slot 1"
 *
 * Load order (index.html): hydra-save.js BEFORE player-runtime.js and
 * script.js. player-runtime.js throws a clear error if HydraSave is missing.
 * ========================================================================== */

function hydraSaveFactory() {
  'use strict';

  // Bumped whenever the on-disk slot shape changes; readSlot keeps the
  // stored version so a future Hydra can migrate instead of dropping saves.
  var SLOT_VERSION = 1;
  var SLOT_PREFIX = 'hydraSlot:';
  var DEFAULT_SLOT_NAME = 'Slot 1';

  // A slot name is whatever the player/designer typed, trimmed. Empty or
  // missing names fall back to the default so blocks always hit one slot.
  function normalizeSlotName(name) {
    if (typeof name !== 'string') name = String(name == null ? '' : name);
    name = name.trim();
    return name.length > 0 ? name : DEFAULT_SLOT_NAME;
  }

  function slotKey(name) {
    return SLOT_PREFIX + normalizeSlotName(name);
  }

  // Deep-clone to a JSON-safe plain object. Anything that does not survive
  // a JSON round-trip (functions, undefined, circular refs) is dropped or
  // replaced with {} rather than crashing the save.
  function sanitizeVariables(vars) {
    if (!vars || typeof vars !== 'object') return {};
    try {
      var clone = JSON.parse(JSON.stringify(vars));
      return clone && typeof clone === 'object' ? clone : {};
    } catch (e) {
      return {};
    }
  }

  // Write ALL game variables into the named slot. Returns true on success.
  function writeSlot(storage, name, variables) {
    try {
      if (!storage || typeof storage.setItem !== 'function') return false;
      var record = {
        version: SLOT_VERSION,
        savedAt: Date.now(),
        data: sanitizeVariables(variables)
      };
      storage.setItem(slotKey(name), JSON.stringify(record));
      return true;
    } catch (e) {
      return false; // quota exceeded, private mode, bad storage — save lost
    }
  }

  // Read a slot back. Returns null when missing, unreadable, corrupt, or
  // not shaped like a Hydra save record. Never throws.
  function readSlot(storage, name) {
    try {
      if (!storage || typeof storage.getItem !== 'function') return null;
      var raw = storage.getItem(slotKey(name));
      if (raw === null || raw === undefined) return null;
      var record = JSON.parse(raw);
      if (!record || typeof record !== 'object') return null;
      if (!record.data || typeof record.data !== 'object') return null;
      return {
        version: typeof record.version === 'number' ? record.version : 0,
        savedAt: typeof record.savedAt === 'number' ? record.savedAt : 0,
        data: sanitizeVariables(record.data)
      };
    } catch (e) {
      return null;
    }
  }

  // True when the named slot holds a readable, valid save record.
  function slotExists(storage, name) {
    return readSlot(storage, name) !== null;
  }

  // Clear a slot. Returns true (idempotent: clearing an empty slot is fine).
  function deleteSlot(storage, name) {
    try {
      if (!storage || typeof storage.removeItem !== 'function') return false;
      storage.removeItem(slotKey(name));
      return true;
    } catch (e) {
      return false;
    }
  }

  // List every readable save slot on this browser (for a future slot-picker
  // UI). Corrupt entries are skipped, never thrown on.
  function listSlots(storage) {
    var out = [];
    try {
      if (!storage || typeof storage.length !== 'number') return out;
      for (var i = 0; i < storage.length; i++) {
        var key = storage.key(i);
        if (typeof key !== 'string' || key.indexOf(SLOT_PREFIX) !== 0) continue;
        var slot = readSlot(storage, key.slice(SLOT_PREFIX.length));
        if (slot) out.push({ name: key.slice(SLOT_PREFIX.length), savedAt: slot.savedAt, version: slot.version });
      }
    } catch (e) { /* best effort listing */ }
    out.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
    return out;
  }

  // localStorage itself may be unreadable: opaque origins (sandboxed iframes,
  // data-URL/setContent documents) and locked-down browsers throw a
  // SecurityError on mere property ACCESS, not just on use. Never let a
  // storage lookup crash the game loop: when storage is unavailable every
  // slot operation below degrades to a safe no-op (writeSlot false,
  // readSlot/slotExists null/false) and the game keeps playing.
  function safeStorage() {
    try {
      var s = (typeof localStorage !== 'undefined') ? localStorage : null;
      return (s && typeof s.getItem === 'function') ? s : null;
    } catch (e) {
      return null;
    }
  }

  return {
    SLOT_VERSION: SLOT_VERSION,
    SLOT_PREFIX: SLOT_PREFIX,
    DEFAULT_SLOT_NAME: DEFAULT_SLOT_NAME,
    normalizeSlotName: normalizeSlotName,
    slotKey: slotKey,
    sanitizeVariables: sanitizeVariables,
    safeStorage: safeStorage,
    writeSlot: writeSlot,
    readSlot: readSlot,
    slotExists: slotExists,
    deleteSlot: deleteSlot,
    listSlots: listSlots
  };
}

window.HydraSave = hydraSaveFactory();
// Self-contained source of the factory, inlined into exported playable games
// by HydraPlayer.buildPlayableHtml so exports run without editor files.
window.HydraSave.factorySource = hydraSaveFactory.toString();
