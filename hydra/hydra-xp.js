/* ============================================================================
 * hydra-xp.js — HydraScript shared experience & leveling (P4 Advanced
 * batch 30: experience & leveling, beginner edition).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation
 * of how the player gets stronger across a run — used by:
 *   - the editor preview runtime (hydra-previewruntime.js delegates
 *     to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Idea (Unity RPG progression / Godot XP systems, beginner edition):
 * batch 29 gave the hero a swing and a fireball, but a defeated enemy
 * earned nothing — there was no sense of getting stronger across a run.
 * XP is the classic bound on that:
 *
 *   xp — one total for the whole game, 0 by default. Add XP tops it
 *     up (10 at a time by default — one coin, one defeated enemy),
 *     Set XP writes it outright, Read XP copies it into a variable so
 *     a label can show it or Save Game can keep it. The total is a
 *     whole number, 0–999999999: adding past the cap stops there.
 *   level — derived, never stored: level = floor(xp / xpPerLevel) + 1.
 *     XP per level is 100 by default (the arcade default: ten
 *     10-XP kills to level 2) and Set XP Per Level rewrites it at
 *     runtime, 1–100000. Raising the threshold never takes a level
 *     away mid-run unless the XP no longer covers it — the level is
 *     always just the math on the current numbers.
 *   level up — a consume-on-read check, not a stored flag: Level Up
 *     returns true once per level increase, then marks that level
 *     announced, so the next evaluation reads false until the level
 *     climbs again. The Level Up condition is an edge trigger, so it
 *     fires once on the moment the level rises — chain it to Heal
 *     Object for a level-up heal, Play Sound for the fanfare, or Show
 *     for a LEVEL UP banner. Lowering XP below the announced level
 *     never re-fires until the level climbs past it again, and a
 *     state that never recorded an announced level treats its current
 *     level as already announced, so a fresh game never fires
 *     spuriously.
 *
 * The state is transient run state, minted fresh on a fresh run (like
 * the lives count): it SURVIVES scene switches inside a run, so the
 * XP earned in level 1 is the XP earned in level 2, and it resets
 * only when the game starts over. It never travels in save slots —
 * persist it through a variable the way lives do (Read XP / Read
 * Level into variables on save, Set XP / Set XP Per Level from them
 * on load). There is deliberately no scene-reset hook for it: the
 * scene reset never touches the XP record, the same way it never
 * touches the lives record.
 *
 * Nothing ever throws; hostile input degrades to safe defaults.
 *
 * Honest limits: one XP total for the whole game (no per-object or
 * per-player XP, no XP curves — one flat XP-per-level number, so
 * level 10 costs the same 100 XP as level 2); Level Up is consumed
 * on read, so place one Level Up row per reward chain — a second
 * Level Up row in the same grid would see nothing, because the first
 * read already announced the level; the level is not shown anywhere
 * by itself — Read XP / Read Level into variables and show them in
 * text objects; gaining XP never heals, damages, or unlocks anything
 * on its own — chain the Level Up condition after Add XP for the
 * reward; no `hs` script-API surface yet.
 *
 * Load order (index.html): hydra-xp.js BEFORE player-runtime.js
 * and script.js. player-runtime.js throws a clear error if HydraXp
 * is missing.
 * ========================================================================== */

function hydraXpFactory() {
  'use strict';

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
  // never touched XP.
  function stateOf(state) {
    return (state && typeof state === 'object') ? state : null;
  }

  // --- Normalizers ---------------------------------------------------------

  // The XP total: a whole number 0–999999999, default 0. Below 0
  // reads as 0 — XP never goes negative.
  function normalizeXp(v) {
    var n = saneNum(v, 0);
    if (n <= 0) return 0;
    if (n > 999999999) return 999999999;
    return Math.floor(n);
  }

  // An amount to add: a whole number 0–1000000, default 10. 0 is a
  // legal no-op amount.
  function normalizeXpAmount(v) {
    var n = saneNum(v, 10);
    if (n <= 0) return 0;
    if (n > 1000000) return 1000000;
    return Math.floor(n);
  }

  // The XP per level: a whole number 1–100000, default 100 (the
  // arcade default). Below 1 reads as 1 — a level always costs at
  // least 1 XP, so the level math can never divide by zero.
  function normalizeXpPerLevel(v) {
    var n = saneNum(v, 100);
    if (n < 1) return 1;
    if (n > 100000) return 100000;
    return Math.floor(n);
  }

  // --- State ---------------------------------------------------------------

  // A fresh transient XP state for a run: 0 XP, 100 XP per level,
  // level 1 already announced (so a fresh game never fires Level Up
  // spuriously). The hosts mint one per run (the export at state
  // creation, the preview lazily through xpRuntime) — never per
  // scene, so the XP survives scene switches inside the run.
  function createXpState() {
    return { xp: 0, xpPerLevel: 100, levelAnnounced: 1 };
  }

  // --- Reads ---------------------------------------------------------------

  // How much XP the player has. A missing state reads as the default
  // 0 (a fresh game has no XP), a negative total reads as 0, and a
  // non-numeric total reads as the default. Never throws.
  function xpOf(state) {
    try {
      var st = stateOf(state);
      if (!st) return 0;
      if (st.xp == null) return 0;
      return normalizeXp(st.xp);
    } catch (e) {
      return 0;
    }
  }

  // How much XP one level costs. A missing state reads as the default
  // 100, and a bad value reads as the default. Never throws.
  function xpPerLevelOf(state) {
    try {
      var st = stateOf(state);
      if (!st) return 100;
      if (st.xpPerLevel == null) return 100;
      return normalizeXpPerLevel(st.xpPerLevel);
    } catch (e) {
      return 100;
    }
  }

  // The level, derived from the XP and the per-level cost — never
  // stored, so changing either number re-levels at once. Level 1
  // covers 0 up to (but not including) one level's worth of XP.
  // Never throws.
  function levelOf(state) {
    try {
      var per = xpPerLevelOf(state);
      var total = xpOf(state);
      var lv = Math.floor(total / per) + 1;
      return (lv < 1) ? 1 : lv;
    } catch (e) {
      return 1;
    }
  }

  // True once per level increase, then false until the level climbs
  // again — a consume-on-read check. The first read after the level
  // rises marks that level announced and returns true; every read
  // after that returns false until a higher level arrives. A state
  // with no announced level treats its current level as already
  // announced (and records it), so a foreign or hand-built state
  // never fires spuriously. Never throws.
  function levelUp(state) {
    try {
      var st = stateOf(state);
      if (!st) return false;
      var lv = levelOf(st);
      var announced = st.levelAnnounced;
      if (announced == null) {
        st.levelAnnounced = lv;
        return false;
      }
      announced = Math.floor(saneNum(announced, lv));
      if (announced < 1) announced = 1;
      if (lv > announced) {
        st.levelAnnounced = lv;
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  // --- Writes --------------------------------------------------------------

  // Top the XP up, clamped at 999999999. Returns the new total, or
  // null when there is no state to write. Never throws.
  function addXp(state, amount) {
    try {
      var st = stateOf(state);
      if (!st) return null;
      st.xp = Math.min(999999999, xpOf(st) + normalizeXpAmount(amount));
      return st.xp;
    } catch (e) {
      return null;
    }
  }

  // Write the XP outright, clamped 0–999999999. Returns the new
  // total, or null when there is no state to write. Never throws.
  function setXp(state, v) {
    try {
      var st = stateOf(state);
      if (!st) return null;
      st.xp = normalizeXp(v);
      return st.xp;
    } catch (e) {
      return null;
    }
  }

  // Rewrite what one level costs, clamped 1–100000. Returns the new
  // cost, or null when there is no state to write. Never throws.
  function setXpPerLevel(state, v) {
    try {
      var st = stateOf(state);
      if (!st) return null;
      st.xpPerLevel = normalizeXpPerLevel(v);
      return st.xpPerLevel;
    } catch (e) {
      return null;
    }
  }

  // --- Routing -------------------------------------------------------------

  function isXpAction(type) {
    return type === 'addXp' || type === 'setXp' ||
      type === 'setXpPerLevel' || type === 'readXp' ||
      type === 'readLevel';
  }

  function isXpCondition(type) {
    return type === 'xp' || type === 'level' || type === 'levelUp';
  }

  return {
    createXpState: createXpState,
    normalizeXp: normalizeXp,
    normalizeXpAmount: normalizeXpAmount,
    normalizeXpPerLevel: normalizeXpPerLevel,
    xpOf: xpOf,
    xpPerLevelOf: xpPerLevelOf,
    levelOf: levelOf,
    levelUp: levelUp,
    addXp: addXp,
    setXp: setXp,
    setXpPerLevel: setXpPerLevel,
    isXpAction: isXpAction,
    isXpCondition: isXpCondition
  };
}

if (typeof window !== 'undefined') {
  window.HydraXp = hydraXpFactory();
  // Self-contained source of the factory, inlined into exported playable games
  // by HydraPlayer.buildPlayableHtml so exports run without editor files.
  window.HydraXp.factorySource = hydraXpFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraXpFactory;
