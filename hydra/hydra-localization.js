/* ============================================================================
 * hydra-localization.js — HydraScript shared localization (string tables).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation
 * of localization used by:
 *   - the editor preview runtime (script.js delegates to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Idea (Unity Localization / Godot TranslationServer, beginner edition):
 * the project carries ONE string table — named keys, one translation per
 * language — and blocks read from it at runtime:
 *
 *   key "play_button": en "Play", es "Jugar", fr "Jouer"
 *
 * A game ships in one language by default and switches with a single
 * Set Language block; every label bound to a key (a text object's
 * Localization key, or a Set Text from Key block) follows automatically.
 * No per-object translation lists, no locale files to manage.
 *
 * Data model (stored on the project, saved in project JSON):
 *   project.localization = {
 *     defaultLanguage: 'en',       // fallback when a key has no
 *                                  // translation in the current language
 *     languages: ['en', 'es'],     // every language code in the table
 *     entries: [{ key: 'play_button',
 *                 values: { en: 'Play', es: 'Jugar' } }]
 *   };
 *
 * Runtime state (NOT saved; per run, created fresh at game start):
 *   state.language = 'es'          // the current language code
 * The current language survives scene switches inside a run (it is a
 * player setting, like the audio mix — not scene state), and resets to
 * the project's default language on every fresh run.
 *
 * Fallback rule: the current language's translation wins when it is a
 * non-empty string; otherwise the default language's translation wins;
 * otherwise the key is missing and the block warns and holds (the old
 * text stays, the old variable stays, the old language stays). Blank
 * keys and blank language codes are always a quiet no-op — the same
 * blank-quiet convention as every other block family. Nothing ever
 * throws; hostile input degrades to safe defaults.
 *
 * Honest limits: keys are exact-match (no plurals, no gender forms, no
 * {placeholders} — compose those with Set Text / variables), language
 * codes are free-form strings the author defines (no built-in locale
 * list, no automatic browser-language detection — Set Language is the
 * explicit switch), and translations are plain text (no rich text).
 * Old projects have no localization field and behave exactly as before:
 * their default language is 'en' and their texts are untouched.
 *
 * Load order (index.html): hydra-localization.js BEFORE player-runtime.js
 * and script.js. player-runtime.js throws a clear error if
 * HydraLocalization is missing.
 * ========================================================================== */

function hydraLocalizationFactory() {
  'use strict';

  var FALLBACK_LANGUAGE = 'en';

  function saneCode(v) {
    return String(v == null ? '' : v).trim();
  }

  function saneKey(v) {
    return String(v == null ? '' : v).trim();
  }

  // Normalize a project's localization record IN PLACE — fields are
  // repaired on the existing record and its arrays, so the record keeps
  // its identity across calls (the skeleton lesson: the editor tab holds
  // entry references while it renders, and a wholesale replacement would
  // orphan them). Blank language codes are dropped, duplicates collapse
  // to the first, the default language is always present in the list,
  // blank-key entries are dropped, duplicate keys collapse to the first,
  // and translation values coerce to strings (null/undefined become '',
  // which reads as "untranslated" and falls back). Never throws.
  function normalizeLocalization(loc) {
    try {
      if (!loc || typeof loc !== 'object' || Array.isArray(loc)) {
        return { defaultLanguage: FALLBACK_LANGUAGE, languages: [FALLBACK_LANGUAGE], entries: [] };
      }
      var def = saneCode(loc.defaultLanguage) || FALLBACK_LANGUAGE;
      loc.defaultLanguage = def;
      var langs = Array.isArray(loc.languages) ? loc.languages : [];
      var seen = {};
      var clean = [];
      for (var i = 0; i < langs.length; i++) {
        var c = saneCode(langs[i]);
        if (!c || seen[c]) continue;
        seen[c] = true;
        clean.push(c);
      }
      if (!seen[def]) clean.unshift(def);
      if (clean.length === 0) clean = [def];
      loc.languages = clean;
      if (!Array.isArray(loc.entries)) loc.entries = [];
      for (var j = loc.entries.length - 1; j >= 0; j--) {
        if (!loc.entries[j] || typeof loc.entries[j] !== 'object') loc.entries.splice(j, 1);
      }
      var seenK = {};
      for (var k = 0; k < loc.entries.length;) {
        var e = loc.entries[k];
        var key = saneKey(e.key);
        if (!key || seenK[key]) { loc.entries.splice(k, 1); continue; }
        seenK[key] = true;
        e.key = key;
        if (!e.values || typeof e.values !== 'object' || Array.isArray(e.values)) e.values = {};
        var vals = e.values;
        for (var lang in vals) {
          if (!Object.prototype.hasOwnProperty.call(vals, lang)) continue;
          var v = vals[lang];
          vals[lang] = (v == null) ? '' : String(v);
        }
        k++;
      }
      return loc;
    } catch (err) {
      return { defaultLanguage: FALLBACK_LANGUAGE, languages: [FALLBACK_LANGUAGE], entries: [] };
    }
  }

  // The normalized language list (a copy — callers may not mutate it).
  function languageList(loc) {
    try {
      return normalizeLocalization(loc && typeof loc === 'object' ? loc : null).languages.slice();
    } catch (e) {
      return [FALLBACK_LANGUAGE];
    }
  }

  function defaultLanguageOf(loc) {
    try {
      return normalizeLocalization(loc && typeof loc === 'object' ? loc : null).defaultLanguage;
    } catch (e) {
      return FALLBACK_LANGUAGE;
    }
  }

  function entryKeys(loc) {
    try {
      return normalizeLocalization(loc && typeof loc === 'object' ? loc : null).entries.map(function (e) { return e.key; });
    } catch (e) {
      return [];
    }
  }

  // The entry with exactly this key, or null. Blank keys read null.
  function getEntry(loc, key) {
    try {
      var want = saneKey(key);
      if (!want) return null;
      var entries = normalizeLocalization(loc && typeof loc === 'object' ? loc : null).entries;
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].key === want) return entries[i];
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  // True when the key has a non-empty translation in exactly this
  // language (no fallback — the editor tab uses this for its
  // "translated / missing" readout).
  function hasTranslation(loc, key, language) {
    try {
      var e = getEntry(loc, key);
      if (!e) return false;
      var v = e.values[saneCode(language)];
      return typeof v === 'string' && v.length > 0;
    } catch (err) {
      return false;
    }
  }

  // Resolve a key for a language: the language's translation when it is
  // a non-empty string, else the default language's translation, else
  // null (missing everywhere). Blank keys resolve to null. Never throws.
  function resolveLocalized(loc, key, language) {
    try {
      var e = getEntry(loc, key);
      if (!e) return null;
      var norm = normalizeLocalization(loc && typeof loc === 'object' ? loc : null);
      var lang = saneCode(language);
      if (lang) {
        var v = e.values[lang];
        if (typeof v === 'string' && v.length > 0) return v;
      }
      var d = e.values[norm.defaultLanguage];
      if (typeof d === 'string' && d.length > 0) return d;
      return null;
    } catch (err) {
      return null;
    }
  }

  // True when the code names a language in the table (the Set Language
  // validity check — unknown codes warn and hold, like unknown
  // animations). Blank codes read false.
  function isKnownLanguage(loc, code) {
    try {
      var c = saneCode(code);
      if (!c) return false;
      var langs = languageList(loc);
      for (var i = 0; i < langs.length; i++) {
        if (langs[i] === c) return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  // The localized text for one text object bound to a key
  // (obj.localeKey), or null when the object is not a bound text object
  // or the key has no translation. Hosts apply the result to the
  // object's displayed text (_runtimeText). Never throws.
  function boundTextFor(obj, loc, language) {
    try {
      if (!obj || typeof obj !== 'object') return null;
      if (obj.kind !== 'text') return null;
      var key = saneKey(obj.localeKey);
      if (!key) return null;
      return resolveLocalized(loc, key, language);
    } catch (e) {
      return null;
    }
  }

  function isLocalizationAction(type) {
    return type === 'setLanguage' || type === 'setTextFromKey' ||
      type === 'setVariableFromKey';
  }

  function isLocalizationCondition(type) {
    return type === 'languageIs';
  }

  return {
    FALLBACK_LANGUAGE: FALLBACK_LANGUAGE,
    normalizeLocalization: normalizeLocalization,
    languageList: languageList,
    defaultLanguageOf: defaultLanguageOf,
    entryKeys: entryKeys,
    getEntry: getEntry,
    hasTranslation: hasTranslation,
    resolveLocalized: resolveLocalized,
    isKnownLanguage: isKnownLanguage,
    boundTextFor: boundTextFor,
    isLocalizationAction: isLocalizationAction,
    isLocalizationCondition: isLocalizationCondition
  };
}

window.HydraLocalization = hydraLocalizationFactory();
// Self-contained source of the factory, inlined into exported playable games
// by HydraPlayer.buildPlayableHtml so exports run without editor files.
window.HydraLocalization.factorySource = hydraLocalizationFactory.toString();
