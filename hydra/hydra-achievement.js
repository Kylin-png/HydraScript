/* ============================================================================
 * hydra-achievement.js — HydraScript shared achievement system
 * (P4 Advanced batch 10: the permanent trophies a player earns).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation
 * of achievements used by:
 *   - the editor preview runtime (hydra-previewruntime.js delegates
 *     to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Idea (Unity / Game Center / Steam achievements, beginner edition):
 * the project carries named achievement definitions — beat every level,
 * collect 100 coins, finish without dying — and each game carries an
 * unlocked set, a plain name -> true map. Blocks unlock, lock, reset,
 * and count achievements; conditions gate rewards, endings, and
 * trophy-room displays on what the player earned.
 *
 * The companion to quests, with one deliberate difference: quests are
 * per-run objectives that reset on a fresh run, achievements are
 * PERMANENT. Once unlocked, an achievement stays unlocked across runs,
 * scenes, and restarts, so it carries meta-progression. That is the
 * whole point — resetGame never clears the set, and neither does a
 * scene switch. The only way back is the Reset Achievements block
 * (all of them) or Lock Achievement (one of them), which exist for a
 * "reset progress" menu and for testing.
 *
 *   Game Start -> (nothing — achievements start locked on their own)
 *   Quest Complete "Collect 4 coins" (edge) -> Unlock Achievement "Coin hoarder"
 *   Achievement Unlocked "Coin hoarder" (edge) -> Show "Trophy earned!"
 *   Achievement Count >= 3 -> Show "Veteran" badge
 *   Read Achievement Count into trophies -> Save Game
 *
 * Data model (stored on the project, saved in project JSON, edited in
 * the Achievements tab):
 *   project.achievements = [
 *     { id: 'ach_...', name: 'Coin hoarder',
 *       description: 'Collect 100 coins across any number of runs.' },
 *     { id: 'ach_...', name: 'Flawless', description: 'Finish a level without dying.' }
 *   ];
 * There is no target: an achievement is either unlocked or it is not.
 *
 * Runtime state (NOT part of the save-slot payload; persisted per game):
 *   { unlocked: { 'Coin hoarder': true } }
 * Persistence is the hosts' job, through the storage helpers below:
 * one localStorage entry per game, keyed `hydraAchievements:<projectId>`
 * (the id sanitized, `default` when there is none), holding a JSON
 * array of unlocked names. The hosts load it at boot and write it back
 * on every change (unlock / lock / reset), so the preview and exported
 * games share the same per-project store the way save slots share
 * `hydraSlot:` keys. Storage may be unavailable (opaque origins,
 * locked-down browsers): load reads as empty and save is a quiet
 * no-op, and the game keeps playing with achievements in memory only.
 *
 * Blank achievement names stay quiet (the same blank-quiet convention
 * as every other block family); unknown names warn and hold. Conditions
 * read the live set directly and never warn: an unknown or locked
 * achievement simply reads as not unlocked / 0.
 * Nothing ever throws; hostile input degrades to safe defaults.
 *
 * Honest limits: there is no built-in achievement toast or HUD — show
 * an unlock by gating a text object on Achievement Unlocked, like any
 * other state; descriptions live on the definition, not on the carried
 * copy; an achievement has no progress counter of its own (count
 * progress with a quest or a variable, then unlock when it completes);
 * and the unlocked set is keyed by project id, so renaming the project
 * keeps it but copying the project to a new id starts it fresh. Old
 * projects have no achievements field and behave exactly as before.
 *
 * Load order (index.html): hydra-achievement.js BEFORE player-runtime.js
 * and script.js. player-runtime.js throws a clear error if
 * HydraAchievement is missing.
 * ========================================================================== */

function hydraAchievementFactory() {
  'use strict';

  var STORAGE_PREFIX = 'hydraAchievements:';

  function saneStr(v) {
    return String(v == null ? '' : v);
  }

  function saneName(v) {
    return saneStr(v).trim();
  }

  // Normalize a project's achievement list IN PLACE — entries are
  // repaired on the existing array, so the record keeps its identity
  // across calls (the dialogue/localization lesson: the editor tab
  // holds entry references while it renders, and a wholesale
  // replacement would orphan them). Blank-name achievements drop,
  // duplicate names collapse to the first, and descriptions coerce to
  // strings. Never throws.
  function normalizeAchievements(achievements) {
    try {
      if (!Array.isArray(achievements)) return [];
      var seen = {};
      for (var i = 0; i < achievements.length;) {
        var a = achievements[i];
        if (!a || typeof a !== 'object' || Array.isArray(a)) { achievements.splice(i, 1); continue; }
        var name = saneName(a.name);
        if (!name || seen[name]) { achievements.splice(i, 1); continue; }
        seen[name] = true;
        a.name = name;
        if (typeof a.id !== 'string' || !a.id) a.id = 'ach_' + (i + 1);
        a.description = saneStr(a.description);
        i++;
      }
      return achievements;
    } catch (err) {
      return [];
    }
  }

  // The normalized achievement names (a copy — callers may not mutate it).
  function achievementNames(achievements) {
    try {
      return normalizeAchievements(achievements).map(function (a) { return a.name; });
    } catch (e) {
      return [];
    }
  }

  // The achievement definition with exactly this name (or id), or null.
  // Blank names read null.
  function getAchievement(achievements, name) {
    try {
      var want = saneName(name);
      if (!want) return null;
      var list = normalizeAchievements(achievements);
      for (var i = 0; i < list.length; i++) {
        if (list[i].name === want || list[i].id === want) return list[i];
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  // A fresh unlocked set. Nothing is unlocked yet. `unlockedNames`
  // (an array of names, as read back from storage) seeds it; only
  // string entries count — a stored number or null is corrupt data,
  // not a name — and duplicates collapse.
  function createAchievementRuntime(unlockedNames) {
    var rt = { unlocked: {} };
    try {
      if (Array.isArray(unlockedNames)) {
        unlockedNames.forEach(function (n) {
          if (typeof n === 'string') {
            var name = n.trim();
            if (name) rt.unlocked[name] = true;
          }
        });
      }
    } catch (e) { /* a corrupt seed reads as empty */ }
    return rt;
  }

  function isRuntime(rt) {
    return !!rt && typeof rt === 'object';
  }

  function unlockedOf(rt) {
    try {
      if (!isRuntime(rt)) return {};
      if (!rt.unlocked || typeof rt.unlocked !== 'object') rt.unlocked = {};
      return rt.unlocked;
    } catch (e) {
      return {};
    }
  }

  // True while the named achievement is unlocked. The unlocked set is
  // the single source of truth — permanence lives here, not in a flag
  // anywhere else.
  function isAchievementUnlocked(rt, name) {
    try {
      var want = saneName(name);
      if (!want) return false;
      return unlockedOf(rt)[want] === true;
    } catch (e) {
      return false;
    }
  }

  // How many achievements are unlocked (0 when the runtime is missing
  // or corrupt).
  function achievementCount(rt) {
    try {
      return Object.keys(unlockedOf(rt)).length;
    } catch (e) {
      return 0;
    }
  }

  // Every unlocked name, sorted (a copy — callers may not mutate it).
  function unlockedAchievementNames(rt) {
    try {
      return Object.keys(unlockedOf(rt)).sort();
    } catch (e) {
      return [];
    }
  }

  function warnHook(hooks, msg) {
    try {
      if (hooks && typeof hooks.warn === 'function') hooks.warn(msg);
    } catch (e) { /* a throwing warn never breaks the set */ }
  }

  function persistHook(hooks) {
    try {
      if (hooks && typeof hooks.persist === 'function') hooks.persist();
    } catch (e) { /* a throwing persist never breaks the set */ }
  }

  // Unlock the named achievement. Blank names stay quiet; unknown names
  // warn and hold. Unlocking an already-unlocked achievement changes
  // nothing. Returns true only when the set actually changed (so the
  // host can persist on change, not on every call).
  function unlockAchievement(rt, achievements, name, hooks) {
    try {
      if (!isRuntime(rt)) return false;
      var want = saneName(name);
      if (!want) return false;
      if (!getAchievement(achievements, want)) {
        warnHook(hooks, 'Unlock Achievement: no achievement named "' + want + '" in the Achievements tab. Nothing was unlocked.');
        return false;
      }
      if (unlockedOf(rt)[want] === true) return false;
      unlockedOf(rt)[want] = true;
      persistHook(hooks);
      return true;
    } catch (e) {
      return false;
    }
  }

  // Lock the named achievement again: it reads as never earned. Blank
  // names stay quiet; unknown names warn and hold. Returns true only
  // when the set actually changed.
  function lockAchievement(rt, achievements, name, hooks) {
    try {
      if (!isRuntime(rt)) return false;
      var want = saneName(name);
      if (!want) return false;
      if (!getAchievement(achievements, want)) {
        warnHook(hooks, 'Lock Achievement: no achievement named "' + want + '" in the Achievements tab. Nothing was locked.');
        return false;
      }
      if (!(want in unlockedOf(rt))) return false;
      delete unlockedOf(rt)[want];
      persistHook(hooks);
      return true;
    } catch (e) {
      return false;
    }
  }

  // Lock every achievement at once. Always succeeds; a missing runtime
  // is a quiet no-op. Returns true only when anything was locked.
  function resetAchievements(rt, hooks) {
    try {
      if (!isRuntime(rt)) return false;
      var unlocked = unlockedOf(rt);
      var had = Object.keys(unlocked).length > 0;
      Object.keys(unlocked).forEach(function (k) { delete unlocked[k]; });
      if (had) persistHook(hooks);
      return had;
    } catch (e) {
      return false;
    }
  }

  // Every defined achievement as { name, description, unlocked },
  // sorted by name (a copy — callers may not mutate it). An
  // achievement never unlocked reads unlocked: false.
  function achievementList(rt, achievements) {
    try {
      var list = normalizeAchievements(achievements);
      return list.map(function (a) {
        return {
          name: a.name,
          description: a.description,
          unlocked: unlockedOf(rt)[a.name] === true
        };
      }).sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
    } catch (e) {
      return [];
    }
  }

  // --- Persistence ------------------------------------------------------
  // One storage entry per game. The key carries the project id so two
  // different games never share a trophy case; the id is sanitized to
  // the safe alphabet and capped, and a missing id reads as 'default'.

  function achievementKey(projectId) {
    try {
      var id = saneStr(projectId).trim().replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
      if (!id) id = 'default';
      return STORAGE_PREFIX + id;
    } catch (e) {
      return STORAGE_PREFIX + 'default';
    }
  }

  // The unlocked names as a JSON string (sorted, for stable bytes).
  function serializeUnlocked(rt) {
    try {
      return JSON.stringify(unlockedAchievementNames(rt));
    } catch (e) {
      return '[]';
    }
  }

  // Parse a stored JSON string back into names. Anything corrupt —
  // bad JSON, a non-array, non-string entries — reads as empty, never
  // throws.
  function parseUnlocked(value) {
    try {
      var parsed = JSON.parse(String(value == null ? '' : value));
      if (!Array.isArray(parsed)) return [];
      var out = [];
      parsed.forEach(function (n) {
        if (typeof n === 'string') {
          var name = n.trim();
          if (name) out.push(name);
        }
      });
      return out;
    } catch (e) {
      return [];
    }
  }

  // localStorage itself may be unreadable: opaque origins (sandboxed
  // iframes, data-URL/setContent documents) and locked-down browsers
  // throw a SecurityError on mere property ACCESS, not just on use.
  // Never let a storage lookup crash the game loop: when storage is
  // unavailable every operation below degrades to a safe no-op and the
  // game keeps playing with achievements in memory only.
  function safeStorage() {
    try {
      var s = (typeof localStorage !== 'undefined') ? localStorage : null;
      return (s && typeof s.getItem === 'function') ? s : null;
    } catch (e) {
      return null;
    }
  }

  // Read the unlocked names for this game out of storage. A missing
  // storage, a missing key, or corrupt bytes all read as empty.
  function loadUnlocked(storage, projectId) {
    try {
      if (!storage || typeof storage.getItem !== 'function') return [];
      return parseUnlocked(storage.getItem(achievementKey(projectId)));
    } catch (e) {
      return [];
    }
  }

  // Write the unlocked names for this game into storage. Returns true
  // when the write landed; a missing storage or a throwing write
  // reads as false and the game keeps playing.
  function saveUnlocked(storage, projectId, names) {
    try {
      if (!storage || typeof storage.setItem !== 'function') return false;
      if (!Array.isArray(names)) return false;
      storage.setItem(achievementKey(projectId), JSON.stringify(names.filter(function (n) {
        return typeof n === 'string' && n.trim();
      })));
      return true;
    } catch (e) {
      return false;
    }
  }

  function isAchievementAction(type) {
    return type === 'unlockAchievement' || type === 'lockAchievement' ||
      type === 'resetAchievements' || type === 'readAchievementCount';
  }

  function isAchievementCondition(type) {
    return type === 'achievementUnlocked' || type === 'achievementCount';
  }

  return {
    STORAGE_PREFIX: STORAGE_PREFIX,
    normalizeAchievements: normalizeAchievements,
    achievementNames: achievementNames,
    getAchievement: getAchievement,
    createAchievementRuntime: createAchievementRuntime,
    isAchievementUnlocked: isAchievementUnlocked,
    achievementCount: achievementCount,
    unlockedAchievementNames: unlockedAchievementNames,
    unlockAchievement: unlockAchievement,
    lockAchievement: lockAchievement,
    resetAchievements: resetAchievements,
    achievementList: achievementList,
    achievementKey: achievementKey,
    serializeUnlocked: serializeUnlocked,
    parseUnlocked: parseUnlocked,
    safeStorage: safeStorage,
    loadUnlocked: loadUnlocked,
    saveUnlocked: saveUnlocked,
    isAchievementAction: isAchievementAction,
    isAchievementCondition: isAchievementCondition
  };
}

if (typeof window !== 'undefined') {
  window.HydraAchievement = hydraAchievementFactory();
  // Self-contained source of the factory, inlined into exported playable games
  // by HydraPlayer.buildPlayableHtml so exports run without editor files.
  window.HydraAchievement.factorySource = hydraAchievementFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraAchievementFactory;
