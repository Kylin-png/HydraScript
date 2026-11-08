/* ============================================================================
 * hydra-highscore.js — HydraScript shared local high-score table
 * (P4 Advanced batch 12: the ranked leaderboard a game keeps for itself).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation
 * of high scores used by:
 *   - the editor preview runtime (hydra-previewruntime.js delegates
 *     to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Idea (Unity / Game Center / Steam local leaderboards, beginner edition):
 * the game keeps one ranked table of its best scores — name, score, and
 * the date it was set — sorted best first, capped at the table size the
 * author picks in the High Scores tab. Blocks submit a score, read a rank
 * back into variables, and clear the table; conditions gate on whether a
 * score would make the table and on how many scores it holds. A "you made
 * the leaderboard!" screen is plain blocks: Is High Score (edge) -> Show
 * the celebration text, Submit Score, then Read High Score rank 1 into
 * variables for the display.
 *
 * The companion to achievements, with one deliberate difference: an
 * achievement is a named trophy the player earns or not; a high-score
 * table is a RANKED list that keeps score. Like achievements it is
 * PERMANENT — once a score is on the board it stays there across runs,
 * scenes, and restarts, until the Clear High Scores block takes it back.
 * That is the whole point — resetGame never clears the table, and neither
 * does a scene switch. The only way back is the Clear High Scores block,
 * which exists for a "reset progress" menu and for testing.
 *
 *   Game Over -> Is High Score `score` (edge) -> Show "New best!"
 *   Game Over -> Submit Score `score` "Alex"
 *   Game Start -> Read High Score rank 1 into topScore + topName
 *   High Score Count >= 10 -> Show "Leaderboard full" badge
 *
 * Data model (stored on the project, saved in project JSON, edited in
 * the High Scores tab — a config, not a list of entries):
 *   project.highScores = { maxEntries: 10, defaultName: 'Player' };
 * maxEntries caps the table (1-50, 10 by default); defaultName is the
 * name a submitted score gets when the Submit Score block's Name field
 * is left blank ('Player' when the author leaves that blank too).
 *
 * Runtime state (NOT part of the save-slot payload; persisted per game):
 *   { entries: [ { name: 'Alex', score: 1250, date: 1793123456789 } ] }
 * Entries are sorted best first (highest score first; ties go to the
 * earlier date, so the first player to reach a score keeps the higher
 * rank). Persistence is the hosts' job, through the storage helpers
 * below: one localStorage entry per game, keyed
 * `hydraHighScores:<projectId>` (the id sanitized, `default` when there
 * is none), holding a JSON array of entries. The hosts load it at boot
 * and write it back on every change (submit / clear), so the preview and
 * exported games share the same per-project store the way save slots
 * share `hydraSlot:` keys. Storage may be unavailable (opaque origins,
 * locked-down browsers): load reads as empty and save is a quiet
 * no-op, and the game keeps playing with scores in memory only.
 *
 * A score that does not make the table is a quiet no-op (Submit Score
 * returns rank 0); a non-numeric score warns and holds. Conditions read
 * the live table directly and never warn: a score that would not make
 * the table simply reads false, and an empty table reads as 0 entries.
 * Nothing ever throws; hostile input degrades to safe defaults.
 *
 * Honest limits: there is no built-in leaderboard HUD — show the board
 * by reading ranks into variables with Read High Score and writing them
 * into text objects with Set Text, like any other state; the table holds
 * scores, not replays or per-level splits (keep one table per game, or
 * submit a combined score); Submit Score does not report the rank it
 * earned back into a variable — read the rank you care about with Read
 * High Score instead; and the table is keyed by project id, so renaming
 * the project keeps it but copying the project to a new id starts it
 * fresh. Old projects have no highScores field and behave exactly as
 * before.
 *
 * Load order (index.html): hydra-highscore.js BEFORE player-runtime.js
 * and script.js. player-runtime.js throws a clear error if
 * HydraHighScore is missing.
 * ========================================================================== */

function hydraHighScoreFactory() {
  'use strict';

  var STORAGE_PREFIX = 'hydraHighScores:';
  var DEFAULT_MAX_ENTRIES = 10;
  var MAX_ENTRIES_CAP = 50;
  var DEFAULT_NAME = 'Player';
  var MAX_NAME_LENGTH = 32;

  function saneStr(v) {
    return String(v == null ? '' : v);
  }

  function saneName(v) {
    return saneStr(v).trim();
  }

  // Normalize a project's high-score config IN PLACE — the fields are
  // repaired on the existing object, so the record keeps its identity
  // across calls (the dialogue/localization lesson: the editor tab
  // holds the config while it renders, and a wholesale replacement
  // would orphan it). A non-object config (an old project has none)
  // returns a fresh default instead; callers assign the return value
  // back. maxEntries keeps only a finite integer >= 1, capped at 50,
  // else the 10 default; defaultName trims to a string and falls back
  // to 'Player' when blank, capped at 32 characters. Never throws.
  function normalizeHighScoreConfig(config) {
    try {
      if (!config || typeof config !== 'object' || Array.isArray(config)) {
        return { maxEntries: DEFAULT_MAX_ENTRIES, defaultName: DEFAULT_NAME };
      }
      var max = Number(config.maxEntries);
      config.maxEntries = (isFinite(max) && Math.floor(max) >= 1)
        ? Math.min(MAX_ENTRIES_CAP, Math.floor(max)) : DEFAULT_MAX_ENTRIES;
      var name = saneName(config.defaultName);
      config.defaultName = name ? name.slice(0, MAX_NAME_LENGTH) : DEFAULT_NAME;
      return config;
    } catch (err) {
      return { maxEntries: DEFAULT_MAX_ENTRIES, defaultName: DEFAULT_NAME };
    }
  }

  // Best first: highest score first, ties to the earlier date (the
  // first player to reach a score keeps the higher rank). Sorts in
  // place and returns the array.
  function sortEntries(entries) {
    entries.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.date - b.date;
    });
    return entries;
  }

  // A fresh ranked table. `entries` (an array of { name, score, date }
  // records, as read back from storage) seeds it; only records with a
  // non-blank string name and a finite numeric score count — a stored
  // number, null, or NaN score is corrupt data, not an entry — and
  // names trim and cap at 32 characters. The seed is capped at the
  // config's maxEntries, so a table that shrank still fits.
  function createHighScoreRuntime(entries, config) {
    var rt = { entries: [] };
    try {
      var cfg = normalizeHighScoreConfig(config);
      if (Array.isArray(entries)) {
        entries.forEach(function (e) {
          if (!e || typeof e !== 'object') return;
          var score = Number(e.score);
          if (!isFinite(score)) return;
          var name = saneName(e.name);
          if (!name) return;
          var date = Number(e.date);
          rt.entries.push({
            name: name.slice(0, MAX_NAME_LENGTH),
            score: score,
            date: (isFinite(date) && date > 0) ? date : 0
          });
        });
      }
      sortEntries(rt.entries);
      if (rt.entries.length > cfg.maxEntries) rt.entries.length = cfg.maxEntries;
    } catch (e) { /* a corrupt seed reads as empty */ }
    return rt;
  }

  function isRuntime(rt) {
    return !!rt && typeof rt === 'object';
  }

  function entriesOf(rt) {
    try {
      if (!isRuntime(rt)) return [];
      if (!Array.isArray(rt.entries)) rt.entries = [];
      return rt.entries;
    } catch (e) {
      return [];
    }
  }

  function maxEntriesOf(config) {
    try {
      return normalizeHighScoreConfig(config).maxEntries;
    } catch (e) {
      return DEFAULT_MAX_ENTRIES;
    }
  }

  function warnHook(hooks, msg) {
    try {
      if (hooks && typeof hooks.warn === 'function') hooks.warn(msg);
    } catch (e) { /* a throwing warn never breaks the table */ }
  }

  function persistHook(hooks) {
    try {
      if (hooks && typeof hooks.persist === 'function') hooks.persist();
    } catch (e) { /* a throwing persist never breaks the table */ }
  }

  // Submit a score to the table. The name falls back to the config's
  // default name when blank; the score must be a finite number (a
  // non-numeric score warns and holds). Returns the rank the score
  // earned (1-based), or 0 when the score did not make the table (the
  // table is full and the score does not beat its lowest entry — a
  // tie with the lowest entry does not displace it). Persists on
  // change through the hooks' persist.
  function submitScore(rt, config, name, score, hooks) {
    try {
      if (!isRuntime(rt)) return 0;
      var value = Number(score);
      if (!isFinite(value)) {
        warnHook(hooks, 'Submit Score: the score is not a number. Nothing was submitted.');
        return 0;
      }
      var cfg = normalizeHighScoreConfig(config);
      var entries = entriesOf(rt);
      var displayName = saneName(name) || cfg.defaultName;
      displayName = displayName.slice(0, MAX_NAME_LENGTH);
      if (entries.length >= cfg.maxEntries && entries.length) {
        var lowest = entries[entries.length - 1].score;
        if (value <= lowest) return 0;
      }
      var entry = { name: displayName, score: value, date: Date.now() };
      entries.push(entry);
      sortEntries(entries);
      if (entries.length > cfg.maxEntries) entries.length = cfg.maxEntries;
      persistHook(hooks);
      return entries.indexOf(entry) + 1;
    } catch (e) {
      return 0;
    }
  }

  // True while the score would make the table: the table has room, or
  // the score beats its lowest entry. A non-numeric score never
  // qualifies; a missing runtime reads false.
  function isHighScore(rt, config, score) {
    try {
      if (!isRuntime(rt)) return false;
      var value = Number(score);
      if (!isFinite(value)) return false;
      var entries = entriesOf(rt);
      if (entries.length < maxEntriesOf(config)) return true;
      if (!entries.length) return true;
      var lowest = entries[entries.length - 1].score;
      return value > lowest;
    } catch (e) {
      return false;
    }
  }

  // The entry at the 1-based rank, or null when the rank is out of
  // range (the table is shorter, or the rank is not a whole number
  // >= 1). Returns a copy — callers may not mutate the table.
  function readHighScore(rt, rank) {
    try {
      var r = Math.floor(Number(rank));
      if (!isFinite(r) || r < 1) return null;
      var entries = entriesOf(rt);
      var e = entries[r - 1];
      return e ? { name: e.name, score: e.score, date: e.date } : null;
    } catch (e) {
      return null;
    }
  }

  // How many scores the table holds (0 when the runtime is missing or
  // corrupt).
  function highScoreCount(rt) {
    try {
      return entriesOf(rt).length;
    } catch (e) {
      return 0;
    }
  }

  // Every entry as { name, score, date }, best first (a copy —
  // callers may not mutate it).
  function highScoreList(rt) {
    try {
      return entriesOf(rt).map(function (e) {
        return { name: e.name, score: e.score, date: e.date };
      });
    } catch (e) {
      return [];
    }
  }

  // Empty the table. Always succeeds; a missing runtime is a quiet
  // no-op. Returns true only when anything was cleared.
  function clearHighScores(rt, hooks) {
    try {
      if (!isRuntime(rt)) return false;
      var entries = entriesOf(rt);
      if (!entries.length) return false;
      entries.length = 0;
      persistHook(hooks);
      return true;
    } catch (e) {
      return false;
    }
  }

  // --- Persistence ------------------------------------------------------
  // One storage entry per game. The key carries the project id so two
  // different games never share a leaderboard; the id is sanitized to
  // the safe alphabet and capped, and a missing id reads as 'default'.

  function highScoreKey(projectId) {
    try {
      var id = saneStr(projectId).trim().replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
      if (!id) id = 'default';
      return STORAGE_PREFIX + id;
    } catch (e) {
      return STORAGE_PREFIX + 'default';
    }
  }

  // The entries as a JSON string (already sorted best first, so the
  // stored bytes are stable).
  function serializeEntries(rt) {
    try {
      return JSON.stringify(highScoreList(rt));
    } catch (e) {
      return '[]';
    }
  }

  // Parse a stored JSON string back into entries. Anything corrupt —
  // bad JSON, a non-array, records without a name or a finite score —
  // reads as empty (or drops just the bad records), never throws.
  function parseEntries(value) {
    try {
      var parsed = JSON.parse(String(value == null ? '' : value));
      if (!Array.isArray(parsed)) return [];
      var rt = createHighScoreRuntime(parsed);
      return highScoreList(rt);
    } catch (e) {
      return [];
    }
  }

  // localStorage itself may be unreadable: opaque origins (sandboxed
  // iframes, data-URL/setContent documents) and locked-down browsers
  // throw a SecurityError on mere property ACCESS, not just on use.
  // Never let a storage lookup crash the game loop: when storage is
  // unavailable every operation below degrades to a safe no-op and the
  // game keeps playing with scores in memory only.
  function safeStorage() {
    try {
      var s = (typeof localStorage !== 'undefined') ? localStorage : null;
      return (s && typeof s.getItem === 'function') ? s : null;
    } catch (e) {
      return null;
    }
  }

  // Read the entries for this game out of storage. A missing storage,
  // a missing key, or corrupt bytes all read as empty.
  function loadEntries(storage, projectId) {
    try {
      if (!storage || typeof storage.getItem !== 'function') return [];
      return parseEntries(storage.getItem(highScoreKey(projectId)));
    } catch (e) {
      return [];
    }
  }

  // Write the entries for this game into storage. Returns true when
  // the write landed; a missing storage or a throwing write reads as
  // false and the game keeps playing.
  function saveEntries(storage, projectId, entries) {
    try {
      if (!storage || typeof storage.setItem !== 'function') return false;
      if (!Array.isArray(entries)) return false;
      storage.setItem(highScoreKey(projectId), JSON.stringify(entries.filter(function (e) {
        return e && typeof e === 'object' && typeof e.name === 'string' && e.name.trim() &&
          isFinite(Number(e.score));
      }).map(function (e) {
        return { name: String(e.name).trim().slice(0, MAX_NAME_LENGTH), score: Number(e.score), date: Number(e.date) || 0 };
      })));
      return true;
    } catch (e) {
      return false;
    }
  }

  function isHighScoreAction(type) {
    return type === 'submitScore' || type === 'clearHighScores' ||
      type === 'readHighScore';
  }

  function isHighScoreCondition(type) {
    return type === 'isHighScore' || type === 'highScoreCount';
  }

  return {
    STORAGE_PREFIX: STORAGE_PREFIX,
    DEFAULT_MAX_ENTRIES: DEFAULT_MAX_ENTRIES,
    MAX_ENTRIES_CAP: MAX_ENTRIES_CAP,
    DEFAULT_NAME: DEFAULT_NAME,
    normalizeHighScoreConfig: normalizeHighScoreConfig,
    createHighScoreRuntime: createHighScoreRuntime,
    submitScore: submitScore,
    isHighScore: isHighScore,
    readHighScore: readHighScore,
    highScoreCount: highScoreCount,
    highScoreList: highScoreList,
    clearHighScores: clearHighScores,
    highScoreKey: highScoreKey,
    serializeEntries: serializeEntries,
    parseEntries: parseEntries,
    safeStorage: safeStorage,
    loadEntries: loadEntries,
    saveEntries: saveEntries,
    isHighScoreAction: isHighScoreAction,
    isHighScoreCondition: isHighScoreCondition
  };
}

if (typeof window !== 'undefined') {
  window.HydraHighScore = hydraHighScoreFactory();
  // Self-contained source of the factory, inlined into exported playable games
  // by HydraPlayer.buildPlayableHtml so exports run without editor files.
  window.HydraHighScore.factorySource = hydraHighScoreFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraHighScoreFactory;
