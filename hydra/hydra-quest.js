/* ============================================================================
 * hydra-quest.js — HydraScript shared quest system (P4 Advanced batch 9:
 * the objectives a player works through).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation
 * of quests used by:
 *   - the editor preview runtime (hydra-previewruntime.js delegates
 *     to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Idea (Unity quest system / Godot quest resources, beginner edition):
 * the project carries named quest definitions — collect 4 coins, defeat
 * 3 enemies, reach the goal — and each run carries a quest log, a plain
 * progress map plus a done set. Blocks add, set, read, complete, and
 * reset progress; conditions gate rewards, doors, and endings on what
 * the player finished:
 *
 *   Game Start -> Add Quest Progress "Collect 4 coins" 0 (or nothing —
 *     a quest starts at 0 on its own)
 *   Coin collected -> Add Quest Progress "Collect 4 coins" 1
 *   Quest Complete "Collect 4 coins" (edge) -> Add Item "Brass key" 1
 *   Quest Progress "Defeat 3 enemies" >= 2 -> Show "Almost there"
 *   Read Quest Progress "Collect 4 coins" into coinsFound -> Save Game
 *
 * Data model (stored on the project, saved in project JSON, edited in
 * the Quests tab):
 *   project.quests = [
 *     { id: 'qst_...', name: 'Collect 4 coins', target: 4,
 *       description: 'Pick up every coin in Level 1.' },
 *     { id: 'qst_...', name: 'Reach the goal', target: 1,
 *       description: 'Finish the level.' }
 *   ];
 * `target` is how much progress finishes the quest (default 1); a
 * target of 1 is a one-shot quest — reach the goal, talk to the guard.
 * Progress never exceeds the target: adding past it fills to the cap
 * and completes the quest.
 *
 * Runtime state (NOT saved; per run, created fresh at game start):
 *   { progress: { 'Collect 4 coins': 3 }, done: { 'Reach the goal': true } }
 * The log survives scene switches inside a run (player state, like the
 * backpack and the current language) and resets on a fresh run. It is
 * NOT part of the save-slot payload: save slots store game variables
 * only, so the manual path is Read Quest Progress into a variable
 * before Save Game, and Set Quest Progress from that variable after
 * Load Game. That keeps the slot format untouched and the persistence
 * rebuildable from ordinary blocks.
 *
 * Blank quest names stay quiet (the same blank-quiet convention as
 * every other block family); unknown quest names and bad amounts warn
 * and hold. Conditions read the live log directly and never warn: an
 * unknown or unfinished quest simply reads as not complete / 0.
 * Nothing ever throws; hostile input degrades to safe defaults.
 *
 * Honest limits: progress is whole numbers only (fractions round
 * down); there is one quest log per run, with no per-quest metadata
 * at runtime (a description lives on the definition, not on the
 * carried copy); there is no built-in quest HUD — show progress with
 * Read Quest Progress into a text object, like any other number; a
 * quest has one target and one done flag, with no multi-step chains
 * (chain quests by gating the next quest's progress on the previous
 * quest's Quest Complete); and the log does not travel inside save
 * slots (see the manual path above). Old projects have no quests
 * field and behave exactly as before.
 *
 * Load order (index.html): hydra-quest.js BEFORE player-runtime.js
 * and script.js. player-runtime.js throws a clear error if
 * HydraQuest is missing.
 * ========================================================================== */

function hydraQuestFactory() {
  'use strict';

  var DEFAULT_TARGET = 1;

  function saneStr(v) {
    return String(v == null ? '' : v);
  }

  function saneName(v) {
    return saneStr(v).trim();
  }

  // A whole amount, or null when the value is not a usable number.
  function saneAmount(v) {
    var n = Number(v);
    if (!isFinite(n)) return null;
    return Math.floor(n);
  }

  // Normalize a project's quest list IN PLACE — entries are repaired
  // on the existing array, so the record keeps its identity across
  // calls (the dialogue/localization lesson: the editor tab holds
  // entry references while it renders, and a wholesale replacement
  // would orphan them). Blank-name quests drop, duplicate names
  // collapse to the first, target keeps only a finite integer >= 1
  // (anything else reads as the 1 default), and descriptions coerce
  // to strings. Never throws.
  function normalizeQuests(quests) {
    try {
      if (!Array.isArray(quests)) return [];
      var seen = {};
      for (var i = 0; i < quests.length;) {
        var q = quests[i];
        if (!q || typeof q !== 'object' || Array.isArray(q)) { quests.splice(i, 1); continue; }
        var name = saneName(q.name);
        if (!name || seen[name]) { quests.splice(i, 1); continue; }
        seen[name] = true;
        q.name = name;
        if (typeof q.id !== 'string' || !q.id) q.id = 'qst_' + (i + 1);
        var t = saneAmount(q.target);
        q.target = (t === null || t < 1) ? DEFAULT_TARGET : t;
        q.description = saneStr(q.description);
        i++;
      }
      return quests;
    } catch (err) {
      return [];
    }
  }

  // The normalized quest names (a copy — callers may not mutate it).
  function questNames(quests) {
    try {
      return normalizeQuests(quests).map(function (q) { return q.name; });
    } catch (e) {
      return [];
    }
  }

  // The quest definition with exactly this name (or id), or null.
  // Blank names read null.
  function getQuest(quests, name) {
    try {
      var want = saneName(name);
      if (!want) return null;
      var list = normalizeQuests(quests);
      for (var i = 0; i < list.length; i++) {
        if (list[i].name === want || list[i].id === want) return list[i];
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  // A fresh per-run quest log. Nothing is started yet.
  function createQuestRuntime() {
    return { progress: {}, done: {} };
  }

  function isRuntime(rt) {
    return !!rt && typeof rt === 'object';
  }

  function progressOf(rt) {
    try {
      if (!isRuntime(rt)) return {};
      if (!rt.progress || typeof rt.progress !== 'object') rt.progress = {};
      return rt.progress;
    } catch (e) {
      return {};
    }
  }

  function doneOf(rt) {
    try {
      if (!isRuntime(rt)) return {};
      if (!rt.done || typeof rt.done !== 'object') rt.done = {};
      return rt.done;
    } catch (e) {
      return {};
    }
  }

  // How much progress the named quest has (0 when absent, blank, or
  // corrupt — progress never reads negative).
  function questProgress(rt, name) {
    try {
      var want = saneName(name);
      if (!want) return 0;
      var n = Number(progressOf(rt)[want]);
      if (!isFinite(n)) return 0;
      return Math.max(0, Math.floor(n));
    } catch (e) {
      return 0;
    }
  }

  // True while the named quest is complete. Completion is one source
  // of truth — the done flag, maintained by add/set/complete below —
  // so a quest that reached its target stays complete until its
  // progress is deliberately set back below it.
  function isQuestComplete(rt, quests, name) {
    try {
      var want = saneName(name);
      if (!want) return false;
      if (!getQuest(quests, want)) return false;
      return doneOf(rt)[want] === true;
    } catch (e) {
      return false;
    }
  }

  function warnHook(hooks, msg) {
    try {
      if (hooks && typeof hooks.warn === 'function') hooks.warn(msg);
    } catch (e) { /* a throwing warn never breaks the quest log */ }
  }

  // Add `amount` of progress to the named quest, clamped at the
  // quest's target — adding past it fills to the cap and completes
  // the quest. Blank names stay quiet; unknown names and bad amounts
  // warn and hold. Returns true when the progress changed.
  function addQuestProgress(rt, quests, name, amount, hooks) {
    try {
      if (!isRuntime(rt)) return false;
      var want = saneName(name);
      if (!want) return false;
      var def = getQuest(quests, want);
      if (!def) {
        warnHook(hooks, 'Add Quest Progress: no quest named "' + want + '" in the Quests tab. No progress was added.');
        return false;
      }
      var n = saneAmount(amount);
      if (n === null || n < 1) {
        warnHook(hooks, 'Add Quest Progress: amount "' + amount + '" is not a whole number of 1 or more. No progress was added.');
        return false;
      }
      var progress = progressOf(rt);
      var next = Math.min(def.target, questProgress(rt, want) + n);
      var changed = next !== questProgress(rt, want) || doneOf(rt)[want] !== true;
      progress[want] = next;
      if (next >= def.target) doneOf(rt)[want] = true;
      return changed;
    } catch (e) {
      return false;
    }
  }

  // Set the named quest's progress outright, clamped to 0..target.
  // Reaching the target completes the quest; setting it back below
  // the target un-completes it (a deliberate manual override).
  // Blank names stay quiet; unknown names and bad amounts warn and
  // hold. Returns true when the progress changed.
  function setQuestProgress(rt, quests, name, amount, hooks) {
    try {
      if (!isRuntime(rt)) return false;
      var want = saneName(name);
      if (!want) return false;
      var def = getQuest(quests, want);
      if (!def) {
        warnHook(hooks, 'Set Quest Progress: no quest named "' + want + '" in the Quests tab. The progress was not changed.');
        return false;
      }
      var n = saneAmount(amount);
      if (n === null) {
        warnHook(hooks, 'Set Quest Progress: amount "' + amount + '" is not a whole number. The progress was not changed.');
        return false;
      }
      n = Math.max(0, Math.min(def.target, n));
      var progress = progressOf(rt);
      var done = doneOf(rt);
      var changed = questProgress(rt, want) !== n || (done[want] === true) !== (n >= def.target);
      if (n <= 0) delete progress[want];
      else progress[want] = n;
      if (n >= def.target) done[want] = true;
      else delete done[want];
      return changed;
    } catch (e) {
      return false;
    }
  }

  // Complete the named quest at once: progress fills to the target
  // and the done flag sets. Blank names stay quiet; unknown names
  // warn and hold. Returns true when the quest changed.
  function completeQuest(rt, quests, name, hooks) {
    try {
      if (!isRuntime(rt)) return false;
      var want = saneName(name);
      if (!want) return false;
      var def = getQuest(quests, want);
      if (!def) {
        warnHook(hooks, 'Complete Quest: no quest named "' + want + '" in the Quests tab. The quest was not completed.');
        return false;
      }
      var changed = questProgress(rt, want) !== def.target || doneOf(rt)[want] !== true;
      progressOf(rt)[want] = def.target;
      doneOf(rt)[want] = true;
      return changed;
    } catch (e) {
      return false;
    }
  }

  // Reset the named quest: its progress and done flag both drop, so
  // it reads as never started. Blank names stay quiet; unknown names
  // warn and hold. Returns true when anything was cleared.
  function resetQuest(rt, quests, name, hooks) {
    try {
      if (!isRuntime(rt)) return false;
      var want = saneName(name);
      if (!want) return false;
      if (!getQuest(quests, want)) {
        warnHook(hooks, 'Reset Quest: no quest named "' + want + '" in the Quests tab. Nothing was reset.');
        return false;
      }
      var had = (want in progressOf(rt)) || (want in doneOf(rt));
      delete progressOf(rt)[want];
      delete doneOf(rt)[want];
      return had;
    } catch (e) {
      return false;
    }
  }

  // Read the named quest's progress, or null when the name is blank
  // or the quest is not defined (blank stays quiet, unknown warns).
  // A defined quest with no progress yet reads 0.
  function readQuestProgress(rt, quests, name, hooks) {
    try {
      if (!isRuntime(rt)) return null;
      var want = saneName(name);
      if (!want) return null;
      if (!getQuest(quests, want)) {
        warnHook(hooks, 'Read Quest Progress: no quest named "' + want + '" in the Quests tab. The variable was not changed.');
        return null;
      }
      return questProgress(rt, want);
    } catch (e) {
      return null;
    }
  }

  // Empty the whole quest log. Always succeeds; a missing runtime is
  // a quiet no-op.
  function clearQuests(rt) {
    try {
      if (!isRuntime(rt)) return false;
      var progress = progressOf(rt);
      var done = doneOf(rt);
      Object.keys(progress).forEach(function (k) { delete progress[k]; });
      Object.keys(done).forEach(function (k) { delete done[k]; });
      return true;
    } catch (e) {
      return false;
    }
  }

  // Every defined quest as { name, progress, target, done } pairs,
  // sorted by name (a copy — callers may not mutate it). A quest with
  // no progress yet reads 0 and not done.
  function questList(rt, quests) {
    try {
      var list = normalizeQuests(quests);
      return list.map(function (q) {
        return {
          name: q.name,
          progress: questProgress(rt, q.name),
          target: q.target,
          done: doneOf(rt)[q.name] === true
        };
      }).sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
    } catch (e) {
      return [];
    }
  }

  function isQuestAction(type) {
    return type === 'addQuestProgress' || type === 'setQuestProgress' ||
      type === 'completeQuest' || type === 'resetQuest' ||
      type === 'readQuestProgress' || type === 'clearQuests';
  }

  function isQuestCondition(type) {
    return type === 'questComplete' || type === 'questProgress';
  }

  return {
    DEFAULT_TARGET: DEFAULT_TARGET,
    normalizeQuests: normalizeQuests,
    questNames: questNames,
    getQuest: getQuest,
    createQuestRuntime: createQuestRuntime,
    questProgress: questProgress,
    isQuestComplete: isQuestComplete,
    addQuestProgress: addQuestProgress,
    setQuestProgress: setQuestProgress,
    completeQuest: completeQuest,
    resetQuest: resetQuest,
    readQuestProgress: readQuestProgress,
    clearQuests: clearQuests,
    questList: questList,
    isQuestAction: isQuestAction,
    isQuestCondition: isQuestCondition
  };
}

if (typeof window !== 'undefined') {
  window.HydraQuest = hydraQuestFactory();
  // Self-contained source of the factory, inlined into exported playable games
  // by HydraPlayer.buildPlayableHtml so exports run without editor files.
  window.HydraQuest.factorySource = hydraQuestFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraQuestFactory;
