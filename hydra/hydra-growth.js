/* ============================================================================
 * hydra-growth.js — HydraScript shared level-up rewards & stat growth
 * (P4 Advanced batch 31: level-up rewards & stat growth, beginner
 * edition).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation
 * of how leveling up makes the hero stronger — used by:
 *   - the editor preview runtime (hydra-previewruntime.js delegates
 *     to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Idea (Unity RPG stat growth / Godot level-up rewards, beginner
 * edition): batch 30 gave the hero XP and levels, but nothing in the
 * game reacted to the level yet beyond the rows the author writes by
 * hand. Growth is the reward side of a level up:
 *
 *   max health — Grow Max Health raises the object's ceiling by the
 *     amount (10 by default) and, unless Heal is Off, heals by the
 *     same amount, so a level up both toughens the hero and tops the
 *     bar back up. The raise runs through HydraHealth.setMaxHealth,
 *     so the ceiling still caps at 10000 and the current health
 *     re-clamps to it.
 *   damage — Grow Damage adds a per-object bonus (2 by default) that
 *     the combat blocks add to every hit: Melee Attack and Shoot
 *     Projectile (the projectile carries the boosted damage) deal
 *     their block damage plus the attacker's bonus. A hero that
 *     leveled twice with +2 each hits for +4. Damage Object
 *     deliberately does NOT add a bonus: it names the victim, not
 *     an attacker, so adding the victim's own bonus would make a
 *     grown hero take MORE damage. To grow a Damage Object hit by
 *     hand, read the bonus with Read Damage Bonus and add it in the
 *     amount expression (10 + dmgBonus).
 *   speed — Grow Speed adds a per-object bonus (50 by default) that
 *     the Dash block adds to its speed, so the hero's dashes get
 *     longer and quicker as the levels pile up.
 *   level reward — one block that applies a picked bundle through the
 *     same writers, so a Level Up row can grant a whole reward in one
 *     cell: Balanced (+10 max health, heal 10, +2 damage), Tank (+20
 *     max health, heal 20), Striker (+5 damage), Swift (+50 speed).
 *     Every bundle decomposes into the ordinary Grow blocks, so the
 *     author can always rebuild the same reward by hand.
 *   reads — Read Max Health Bonus / Read Damage Bonus / Read Speed
 *     Bonus copy one object's bonuses into variables, so a label can
 *     show them or Save Game can keep them.
 *
 *   scene switches — the ledger survives them (the bonuses are read
 *     by name, so the level-2 hero keeps what the level-1 hero
 *     grew), but the live max health is per-scene authored state:
 *     a fresh scene's hero starts at its own authored max health,
 *     and the next Grow Max Health builds from there. Damage and
 *     speed bonuses are read from the ledger at use time, so they
 *     apply in full in every scene.
 *
 * The bonuses live in a transient per-run record, keyed by object
 * NAME (the same name the blocks address objects by), so the hero
 * keeps its growth across scene switches: the level-1 hero and the
 * level-2 hero are both named "hero", so the bonus follows the name.
 * Two objects sharing a name share the bonus, the same way a block
 * aimed at that name hits both of them. The record is minted fresh
 * on a fresh run (like the XP total), survives scene switches inside
 * a run, and resets only when the game starts over. It never travels
 * in save slots — persist it through the Read blocks into variables
 * the way XP does. There is deliberately no scene-reset hook for it.
 *
 * Nothing ever throws; hostile input degrades to safe defaults.
 *
 * Honest limits: growth is per object, not per level curve — the
 * author picks the amount per reward row, so a flat +2 damage every
 * level is the default shape; no automatic stat scaling unless the
 * author wires it (chain Level Up to a Grow block once per level).
 * The speed bonus quickens dashes only: the Dash block is the one
 * movement block with a speed, and walking speed comes from Set
 * Velocity / Move Toward blocks with their own speeds, so the bonus
 * never touches those. The speed bonus caps at 2000, the fastest
 * dash the engine runs, and the max-health bonus caps at the 10000
 * health ceiling. Growing max health never revives a dead object:
 * Heal Object clamps at the ceiling but a 0-health object stays
 * dead until the game heals it some other way. No `hs` script-API
 * surface yet.
 *
 * Load order (index.html): hydra-growth.js BEFORE player-runtime.js
 * and script.js. player-runtime.js throws a clear error if HydraGrowth
 * is missing.
 * ========================================================================== */

function hydraGrowthFactory() {
  'use strict';

  // Bonus totals never exceed these: the max-health bonus caps at
  // the health ceiling, the damage bonus at the melee damage cap,
  // and the speed bonus at the fastest dash the engine runs.
  var MAX_HEALTH_BONUS = 10000;
  var MAX_DAMAGE_BONUS = 10000;
  var MAX_SPEED_BONUS = 2000;

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
  // never grew anything.
  function stateOf(state) {
    return (state && typeof state === 'object') ? state : null;
  }

  // --- Keys ----------------------------------------------------------------

  // The ledger key for an object: its name, so the bonus follows the
  // hero across scenes (the level-1 hero and the level-2 hero share
  // the name "hero" even though their ids differ). An unnamed object
  // falls back to its id; a nameless, id-less value has no key and
  // never grows. A bare string is already a key.
  function growthKeyOf(obj) {
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

  // A max-health growth amount: a whole number 0–10000, default 10.
  // 0 is a legal no-op amount.
  function normalizeMaxHealthAmount(v) {
    var n = saneNum(v, 10);
    if (n <= 0) return 0;
    if (n > 10000) return 10000;
    return Math.floor(n);
  }

  // A damage growth amount: a whole number 0–10000, default 2.
  function normalizeDamageAmount(v) {
    var n = saneNum(v, 2);
    if (n <= 0) return 0;
    if (n > 10000) return 10000;
    return Math.floor(n);
  }

  // A speed growth amount: a whole number 0–5000, default 50.
  function normalizeSpeedAmount(v) {
    var n = saneNum(v, 50);
    if (n <= 0) return 0;
    if (n > 5000) return 5000;
    return Math.floor(n);
  }

  // --- State ---------------------------------------------------------------

  // A fresh transient growth state for a run: no bonuses anywhere.
  // The hosts mint one per run (the export at state creation, the
  // preview lazily through growthRuntime) — never per scene, so the
  // bonuses survive scene switches inside the run.
  function createGrowthState() {
    return { byId: {} };
  }

  // The bonus record for a key, or null when there is none. With
  // create, a missing record is minted at all zeros first.
  function recordOf(state, key, create) {
    try {
      var st = stateOf(state);
      if (!st) return null;
      var k = growthKeyOf(key);
      if (k == null) return null;
      if (!st.byId || typeof st.byId !== 'object') st.byId = {};
      var rec = st.byId[k] || null;
      if (!rec && create) {
        rec = { maxHealth: 0, damage: 0, speed: 0 };
        st.byId[k] = rec;
      }
      return rec;
    } catch (e) {
      return null;
    }
  }

  // --- Reads ---------------------------------------------------------------

  // How much max health the object has grown. A missing state, a
  // missing record, or a blank key reads as 0. Never throws.
  function maxHealthBonusOf(state, objOrKey) {
    try {
      var rec = recordOf(state, objOrKey, false);
      if (!rec) return 0;
      var n = saneNum(rec.maxHealth, 0);
      if (n <= 0) return 0;
      if (n > MAX_HEALTH_BONUS) return MAX_HEALTH_BONUS;
      return Math.floor(n);
    } catch (e) {
      return 0;
    }
  }

  // How much damage the object has grown. Same defaults as above.
  function damageBonusOf(state, objOrKey) {
    try {
      var rec = recordOf(state, objOrKey, false);
      if (!rec) return 0;
      var n = saneNum(rec.damage, 0);
      if (n <= 0) return 0;
      if (n > MAX_DAMAGE_BONUS) return MAX_DAMAGE_BONUS;
      return Math.floor(n);
    } catch (e) {
      return 0;
    }
  }

  // How much speed the object has grown. Same defaults as above.
  function speedBonusOf(state, objOrKey) {
    try {
      var rec = recordOf(state, objOrKey, false);
      if (!rec) return 0;
      var n = saneNum(rec.speed, 0);
      if (n <= 0) return 0;
      if (n > MAX_SPEED_BONUS) return MAX_SPEED_BONUS;
      return Math.floor(n);
    } catch (e) {
      return 0;
    }
  }

  // --- Writes --------------------------------------------------------------

  // Grow the object's max-health bonus, capped at the health
  // ceiling. Returns the new bonus, or null when there is no state
  // or no key to grow. Never throws. (The host applies the same
  // amount to the live object through HydraHealth; this module only
  // keeps the ledger.)
  function addMaxHealthBonus(state, objOrKey, amount) {
    try {
      var rec = recordOf(state, objOrKey, true);
      if (!rec) return null;
      rec.maxHealth = Math.min(MAX_HEALTH_BONUS,
        maxHealthBonusOf(state, objOrKey) + normalizeMaxHealthAmount(amount));
      return rec.maxHealth;
    } catch (e) {
      return null;
    }
  }

  // Grow the object's damage bonus, capped at the melee damage cap.
  // Returns the new bonus, or null when there is no state or key.
  function addDamageBonus(state, objOrKey, amount) {
    try {
      var rec = recordOf(state, objOrKey, true);
      if (!rec) return null;
      rec.damage = Math.min(MAX_DAMAGE_BONUS,
        damageBonusOf(state, objOrKey) + normalizeDamageAmount(amount));
      return rec.damage;
    } catch (e) {
      return null;
    }
  }

  // Grow the object's speed bonus, capped at the fastest dash.
  // Returns the new bonus, or null when there is no state or key.
  function addSpeedBonus(state, objOrKey, amount) {
    try {
      var rec = recordOf(state, objOrKey, true);
      if (!rec) return null;
      rec.speed = Math.min(MAX_SPEED_BONUS,
        speedBonusOf(state, objOrKey) + normalizeSpeedAmount(amount));
      return rec.speed;
    } catch (e) {
      return null;
    }
  }

  // --- Reward bundles ------------------------------------------------------

  // The Level Reward bundles: one block, one picked bundle, applied
  // through the same writers as the Grow blocks. Each bundle is a
  // plain record of amounts: maxHealth (ceiling growth), heal (the
  // heal that rides along with it), damage, and speed. Balanced is
  // the level-up default: tougher, topped up, and hitting a little
  // harder. Tank is all health, Striker is all damage, Swift is all
  // dash speed.
  var REWARD_BUNDLES = {
    balanced: { maxHealth: 10, heal: 10, damage: 2, speed: 0 },
    tank: { maxHealth: 20, heal: 20, damage: 0, speed: 0 },
    striker: { maxHealth: 0, heal: 0, damage: 5, speed: 0 },
    swift: { maxHealth: 0, heal: 0, damage: 0, speed: 50 }
  };

  // A fresh copy of the picked bundle, or null for an unknown name.
  // The name matches case-insensitively, so a hand-written 'Tank'
  // reads the same as the picker's 'tank'. Never throws.
  function rewardBundle(name) {
    try {
      if (name == null) return null;
      var key = String(name).trim().toLowerCase();
      var b = REWARD_BUNDLES[key];
      if (!b) return null;
      return { maxHealth: b.maxHealth, heal: b.heal, damage: b.damage, speed: b.speed };
    } catch (e) {
      return null;
    }
  }

  // Apply the picked bundle to the object's ledger: the max-health,
  // damage, and speed amounts grow through the same writers (so the
  // same caps apply), and the heal rides along in the returned
  // record for the host to apply through HydraHealth. Returns the
  // applied amounts, or null for an unknown bundle, no state, or no
  // key. Never throws.
  function applyReward(state, objOrKey, name) {
    try {
      var b = rewardBundle(name);
      if (!b) return null;
      var rec = recordOf(state, objOrKey, true);
      if (!rec) return null;
      if (b.maxHealth > 0) addMaxHealthBonus(state, objOrKey, b.maxHealth);
      if (b.damage > 0) addDamageBonus(state, objOrKey, b.damage);
      if (b.speed > 0) addSpeedBonus(state, objOrKey, b.speed);
      return { maxHealth: b.maxHealth, heal: b.heal, damage: b.damage, speed: b.speed };
    } catch (e) {
      return null;
    }
  }

  // --- Routing -------------------------------------------------------------

  function isGrowthAction(type) {
    return type === 'growMaxHealth' || type === 'growDamage' ||
      type === 'growSpeed' || type === 'levelReward' ||
      type === 'readMaxHealthBonus' || type === 'readDamageBonus' ||
      type === 'readSpeedBonus';
  }

  return {
    MAX_HEALTH_BONUS: MAX_HEALTH_BONUS,
    MAX_DAMAGE_BONUS: MAX_DAMAGE_BONUS,
    MAX_SPEED_BONUS: MAX_SPEED_BONUS,
    createGrowthState: createGrowthState,
    growthKeyOf: growthKeyOf,
    normalizeMaxHealthAmount: normalizeMaxHealthAmount,
    normalizeDamageAmount: normalizeDamageAmount,
    normalizeSpeedAmount: normalizeSpeedAmount,
    maxHealthBonusOf: maxHealthBonusOf,
    damageBonusOf: damageBonusOf,
    speedBonusOf: speedBonusOf,
    addMaxHealthBonus: addMaxHealthBonus,
    addDamageBonus: addDamageBonus,
    addSpeedBonus: addSpeedBonus,
    rewardBundle: rewardBundle,
    applyReward: applyReward,
    isGrowthAction: isGrowthAction
  };
}

if (typeof window !== 'undefined') {
  window.HydraGrowth = hydraGrowthFactory();
  // Self-contained source of the factory, inlined into exported playable games
  // by HydraPlayer.buildPlayableHtml so exports run without editor files.
  window.HydraGrowth.factorySource = hydraGrowthFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraGrowthFactory;
