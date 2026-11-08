/* ============================================================================
 * hydra-scaling.js — HydraScript shared enemy scaling (P4 Advanced
 * batch 32: enemy scaling with the hero's level, beginner edition).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation
 * of how enemies keep up with a leveling hero — used by:
 *   - the editor preview runtime (hydra-previewruntime.js delegates
 *     to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Idea (Unity / Godot difficulty scaling, beginner edition): batch 31
 * let the hero grow stronger every level, but the enemies never did —
 * the game got easier the longer a run went on. Scaling is the other
 * half of the bargain: an enemy has a level, and its numbers rise with
 * that level:
 *
 *   level — the enemy's level, 1 by default (an unscaled enemy is a
 *     level-1 enemy, so old games play exactly as before). Set Enemy
 *     Level writes it outright, and Scale to Hero Level copies the
 *     run's current player level onto it, so one Level Up row can
 *     re-scale every enemy still alive.
 *   rates — how much each level is worth: HP per level (10 by
 *     default) and Damage per level (2 by default). Set Scaling Rates
 *     rewrites them per enemy, so a boss can gain 50 health a level
 *     while a minion gains 5.
 *   bonuses — derived, never stored: hpBonus = (level - 1) * hpPerLevel
 *     and dmgBonus = (level - 1) * dmgPerLevel. A level-3 goblin at the
 *     default rates is +20 max health and +4 damage; a level-1 enemy
 *     is +0 and +0. The host applies the health bonus to the live
 *     object when the level or the rates change (raising the ceiling
 *     by the delta and healing by the same delta when it rises, the
 *     way Grow Max Health does), and the combat blocks add the damage
 *     bonus to the attacker's Melee Attack and Shoot Projectile hits
 *     at use time, the way the growth damage bonus is added.
 *   reads — Read Enemy Level / Read Scaled HP Bonus / Read Scaled
 *     Damage Bonus copy one enemy's level and bonuses into variables,
 *     so a label can show them or Save Game can keep them. Enemy
 *     Level is the condition: true while the enemy's level compares
 *     with the value the picked way, so a level-5 door or a level-3
 *     wave gate is one row.
 *
 * The level and rates live in a transient per-run record, keyed by
 * object NAME (the same name the blocks address objects by), so the
 * enemy keeps its level across scene switches: the level-1 goblin and
 * the level-2 goblin are both named "goblin", so the level follows
 * the name. Two objects sharing a name share the level, the same way
 * a block aimed at that name hits both of them. The record is minted
 * fresh on a fresh run (like the XP total and the growth ledger),
 * survives scene switches inside a run, and resets only when the
 * game starts over. It never travels in save slots — persist it
 * through the Read blocks into variables the way growth does. There
 * is deliberately no scene-reset hook for it.
 *
 * Nothing ever throws; hostile input degrades to safe defaults.
 *
 * Honest limits: scaling is per enemy, not per level curve — the
 * author picks the rates per enemy, so a flat +10 health and +2
 * damage per level is the default shape; nothing scales on its own
 * unless the author wires it (chain Level Up to Scale to Hero Level,
 * or put Scale to Hero Level on a gameStart row so each scene's
 * enemies scale when the scene starts). The health bonus applies
 * when a scaling block runs, not when a scene loads: a fresh scene's
 * enemy starts at its own authored max health, and the next Set
 * Enemy Level / Set Scaling Rates / Scale to Hero Level builds from
 * there — the same rule growth follows. The damage bonus applies to
 * Melee Attack and Shoot Projectile only: Damage Object deliberately
 * does NOT add it, because it names the victim, not an attacker, so
 * adding the victim's own bonus would make a scaled enemy take MORE
 * damage — read the bonus and add it in the amount expression
 * instead (10 + dmgBonus), the way growth does. Scaling never touches
 * speed: the Dash block is the one movement block with a speed, and
 * enemies do not dash. No `hs` script-API surface yet.
 *
 * Load order (index.html): hydra-scaling.js BEFORE player-runtime.js
 * and script.js. player-runtime.js throws a clear error if HydraScaling
 * is missing.
 * ========================================================================== */

function hydraScalingFactory() {
  'use strict';

  // Bonus totals never exceed these: the health bonus caps at the
  // health ceiling and the damage bonus at the melee damage cap,
  // the same caps growth uses.
  var MAX_HP_BONUS = 10000;
  var MAX_DMG_BONUS = 10000;

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
  // never scaled anything.
  function stateOf(state) {
    return (state && typeof state === 'object') ? state : null;
  }

  // --- Keys ----------------------------------------------------------------

  // The ledger key for an object: its name, so the level follows the
  // enemy across scenes (the level-1 goblin and the level-2 goblin
  // share the name "goblin" even though their ids differ). An unnamed
  // object falls back to its id; a nameless, id-less value has no key
  // and never scales. A bare string is already a key.
  function scalingKeyOf(obj) {
    try {
      if (obj == null) return null;
      if (typeof obj === 'string') {
        var k = obj.trim();
        return k === '' ? null : k;
      }
      if (typeof obj !== 'object') return null;
      var name = (obj.name == null) ? '' : String(obj.name).trim();
      if (name !== '') return name;
      if (obj.id == null) return null;
      var id = String(obj.id).trim();
      return id === '' ? null : id;
    } catch (e) {
      return null;
    }
  }

  // --- Normalizers ---------------------------------------------------------

  // An enemy level: a whole number 1–999, default 1. Below 1 reads
  // as 1 — an enemy is always at least level 1, so the bonus math
  // can never go negative.
  function normalizeLevel(v) {
    var n = saneNum(v, 1);
    if (n < 1) return 1;
    if (n > 999) return 999;
    return Math.floor(n);
  }

  // Health gained per level: a whole number 0–10000, default 10.
  // 0 is a legal no-op rate.
  function normalizeHpPerLevel(v) {
    var n = saneNum(v, 10);
    if (n <= 0) return 0;
    if (n > 10000) return 10000;
    return Math.floor(n);
  }

  // Damage gained per level: a whole number 0–10000, default 2.
  function normalizeDmgPerLevel(v) {
    var n = saneNum(v, 2);
    if (n <= 0) return 0;
    if (n > 10000) return 10000;
    return Math.floor(n);
  }

  // --- State ---------------------------------------------------------------

  // A fresh transient scaling state for a run: no levels anywhere.
  // The hosts mint one per run (the export at state creation, the
  // preview lazily through scalingRuntime) — never per scene, so the
  // levels survive scene switches inside the run.
  function createScalingState() {
    return { byId: {} };
  }

  // The scaling record for a key, or null when there is none. With
  // create, a missing record is minted at the defaults first.
  function recordOf(state, key, create) {
    try {
      var st = stateOf(state);
      if (!st) return null;
      var k = scalingKeyOf(key);
      if (k == null) return null;
      if (!st.byId || typeof st.byId !== 'object') st.byId = {};
      var rec = st.byId[k] || null;
      if (!rec && create) {
        rec = { level: 1, hpPerLevel: 10, dmgPerLevel: 2 };
        st.byId[k] = rec;
      }
      return rec;
    } catch (e) {
      return null;
    }
  }

  // --- Reads ---------------------------------------------------------------

  // The enemy's level. A missing state, a missing record, or a blank
  // key reads as 1 — an unscaled enemy is a level-1 enemy. Never
  // throws.
  function levelOf(state, objOrKey) {
    try {
      var rec = recordOf(state, objOrKey, false);
      if (!rec) return 1;
      if (rec.level == null) return 1;
      return normalizeLevel(rec.level);
    } catch (e) {
      return 1;
    }
  }

  // How much health one level is worth for the enemy. Missing state
  // or record reads as the default 10. Never throws.
  function hpPerLevelOf(state, objOrKey) {
    try {
      var rec = recordOf(state, objOrKey, false);
      if (!rec) return 10;
      if (rec.hpPerLevel == null) return 10;
      return normalizeHpPerLevel(rec.hpPerLevel);
    } catch (e) {
      return 10;
    }
  }

  // How much damage one level is worth for the enemy. Missing state
  // or record reads as the default 2. Never throws.
  function dmgPerLevelOf(state, objOrKey) {
    try {
      var rec = recordOf(state, objOrKey, false);
      if (!rec) return 2;
      if (rec.dmgPerLevel == null) return 2;
      return normalizeDmgPerLevel(rec.dmgPerLevel);
    } catch (e) {
      return 2;
    }
  }

  // How much max health the enemy has gained from its level:
  // (level - 1) * hpPerLevel, capped at the health ceiling. A
  // level-1 enemy reads 0. Never throws.
  function hpBonusOf(state, objOrKey) {
    try {
      var b = (levelOf(state, objOrKey) - 1) * hpPerLevelOf(state, objOrKey);
      if (b <= 0) return 0;
      if (b > MAX_HP_BONUS) return MAX_HP_BONUS;
      return Math.floor(b);
    } catch (e) {
      return 0;
    }
  }

  // How much damage the enemy has gained from its level:
  // (level - 1) * dmgPerLevel, capped at the melee damage cap. A
  // level-1 enemy reads 0. Never throws.
  function dmgBonusOf(state, objOrKey) {
    try {
      var b = (levelOf(state, objOrKey) - 1) * dmgPerLevelOf(state, objOrKey);
      if (b <= 0) return 0;
      if (b > MAX_DMG_BONUS) return MAX_DMG_BONUS;
      return Math.floor(b);
    } catch (e) {
      return 0;
    }
  }

  // --- Writes --------------------------------------------------------------

  // Set the enemy's level, clamped 1–999. Returns the new level, the
  // two bonuses, and the health-bonus delta (new minus old) so the
  // host can raise or lower the live max health by exactly that much
  // — the growth ledger and the scaling ledger compose through
  // deltas, never by rewriting each other's totals. Returns null
  // when there is no state or no key to scale. Never throws.
  function setLevel(state, objOrKey, level) {
    try {
      var before = hpBonusOf(state, objOrKey);
      var rec = recordOf(state, objOrKey, true);
      if (!rec) return null;
      rec.level = normalizeLevel(level);
      var after = hpBonusOf(state, objOrKey);
      return {
        level: rec.level,
        hpBonus: after,
        dmgBonus: dmgBonusOf(state, objOrKey),
        hpDelta: after - before
      };
    } catch (e) {
      return null;
    }
  }

  // Rewrite what one level is worth for the enemy. Returns the new
  // rates, the two bonuses, and the health-bonus delta, or null when
  // there is no state or no key. Never throws.
  function setRates(state, objOrKey, hpPerLevel, dmgPerLevel) {
    try {
      var before = hpBonusOf(state, objOrKey);
      var rec = recordOf(state, objOrKey, true);
      if (!rec) return null;
      rec.hpPerLevel = normalizeHpPerLevel(hpPerLevel);
      rec.dmgPerLevel = normalizeDmgPerLevel(dmgPerLevel);
      var after = hpBonusOf(state, objOrKey);
      return {
        hpPerLevel: rec.hpPerLevel,
        dmgPerLevel: rec.dmgPerLevel,
        hpBonus: after,
        dmgBonus: dmgBonusOf(state, objOrKey),
        hpDelta: after - before
      };
    } catch (e) {
      return null;
    }
  }

  // --- Routing -------------------------------------------------------------

  function isScalingAction(type) {
    return type === 'setEnemyLevel' || type === 'setScalingRates' ||
      type === 'scaleToHeroLevel' || type === 'readEnemyLevel' ||
      type === 'readScaledHpBonus' || type === 'readScaledDmgBonus';
  }

  function isScalingCondition(type) {
    return type === 'enemyLevel';
  }

  return {
    MAX_HP_BONUS: MAX_HP_BONUS,
    MAX_DMG_BONUS: MAX_DMG_BONUS,
    createScalingState: createScalingState,
    scalingKeyOf: scalingKeyOf,
    normalizeLevel: normalizeLevel,
    normalizeHpPerLevel: normalizeHpPerLevel,
    normalizeDmgPerLevel: normalizeDmgPerLevel,
    levelOf: levelOf,
    hpPerLevelOf: hpPerLevelOf,
    dmgPerLevelOf: dmgPerLevelOf,
    hpBonusOf: hpBonusOf,
    dmgBonusOf: dmgBonusOf,
    setLevel: setLevel,
    setRates: setRates,
    isScalingAction: isScalingAction,
    isScalingCondition: isScalingCondition
  };
}

if (typeof window !== 'undefined') {
  window.HydraScaling = hydraScalingFactory();
  // Self-contained source of the factory, inlined into exported playable games
  // by HydraPlayer.buildPlayableHtml so exports run without editor files.
  window.HydraScaling.factorySource = hydraScalingFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraScalingFactory;
