// Unit tests for hydra/hydra-localization.js — the shared localization
// (string tables) module.
//
// Pure logic: table normalization (repairs, drops, dedupe, default
// always present), entry lookups, translation resolution with the
// default-language fallback, known-language checks, and bound-text
// resolution for text objects. Nothing here touches the DOM; both
// runtimes delegate to this module.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const sandbox = {};
sandbox.window = sandbox; // hydra-localization.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-localization.js'), 'utf8'),
  sandbox, { filename: 'hydra-localization.js' });
const L = sandbox.HydraLocalization;

check('HydraLocalization exposed with helpers',
  !!L && typeof L.normalizeLocalization === 'function' && typeof L.languageList === 'function' &&
  typeof L.defaultLanguageOf === 'function' && typeof L.entryKeys === 'function' &&
  typeof L.getEntry === 'function' && typeof L.hasTranslation === 'function' &&
  typeof L.resolveLocalized === 'function' && typeof L.isKnownLanguage === 'function' &&
  typeof L.boundTextFor === 'function' && typeof L.isLocalizationAction === 'function' &&
  typeof L.isLocalizationCondition === 'function');
check('factorySource is a self-contained function string',
  typeof L.factorySource === 'string' && L.factorySource.includes('hydraLocalizationFactory'));
check('fallback language is en', L.FALLBACK_LANGUAGE === 'en');

// --- normalization ---
{
  const loc = L.normalizeLocalization(null);
  check('null normalizes to an English-only table',
    loc.defaultLanguage === 'en' && JSON.stringify(loc.languages) === '["en"]' && loc.entries.length === 0,
    JSON.stringify(loc));
  const loc2 = L.normalizeLocalization({ defaultLanguage: '  ', languages: ['es', ' es ', '', 'es', 7], entries: [] });
  check('blank default repairs to en and language codes trim + dedupe',
    loc2.defaultLanguage === 'en' && JSON.stringify(loc2.languages) === '["en","es","7"]',
    JSON.stringify(loc2));
  const loc3 = L.normalizeLocalization({ defaultLanguage: 'fr', languages: ['en'], entries: [] });
  check('default language is prepended when missing from the list',
    JSON.stringify(loc3.languages) === '["fr","en"]', JSON.stringify(loc3));
}
{
  const loc = {
    defaultLanguage: 'en', languages: ['en', 'es'],
    entries: [
      { key: 'play', values: { en: 'Play', es: 'Jugar' } },
      { key: ' play ', values: { en: 'Dup' } },
      { key: '', values: { en: 'Blank' } },
      { key: 'num', values: { en: 42, es: null } },
      null, 'junk',
      { key: 'novals', values: null }
    ]
  };
  const norm = L.normalizeLocalization(loc);
  check('normalization is in place (same object identity)',
    norm === loc, 'identity changed');
  check('duplicate keys collapse to the first, blank keys drop, junk drops',
    JSON.stringify(L.entryKeys(loc)) === '["play","num","novals"]', JSON.stringify(L.entryKeys(loc)));
  check('translation values coerce to strings, null becomes empty',
    L.getEntry(loc, 'num').values.en === '42' && L.getEntry(loc, 'num').values.es === '',
    JSON.stringify(L.getEntry(loc, 'num')));
  check('missing values record repairs to an object',
    L.getEntry(loc, 'novals') && typeof L.getEntry(loc, 'novals').values === 'object',
    JSON.stringify(L.getEntry(loc, 'novals')));
}
{
  // The skeleton lesson: held entry references must survive re-normalize.
  const loc = { defaultLanguage: 'en', languages: ['en'], entries: [{ key: 'a', values: { en: 'A' } }] };
  const held = loc.entries[0];
  L.normalizeLocalization(loc);
  L.normalizeLocalization(loc);
  check('held entry references survive re-normalization',
    loc.entries[0] === held, 'entry object replaced');
  held.values.en = 'A2';
  check('edits through a held reference land on the live table',
    L.resolveLocalized(loc, 'a', 'en') === 'A2', L.resolveLocalized(loc, 'a', 'en'));
}

// --- lookups ---
{
  const loc = {
    defaultLanguage: 'en', languages: ['en', 'es', 'fr'],
    entries: [
      { key: 'play', values: { en: 'Play', es: 'Jugar' } },
      { key: 'quit', values: { en: 'Quit', es: '', fr: 'Quitter' } },
      { key: 'empty', values: { en: '', es: '' } }
    ]
  };
  check('getEntry finds by exact key, missing and blank read null',
    L.getEntry(loc, 'play') && L.getEntry(loc, 'play').values.es === 'Jugar' &&
    L.getEntry(loc, 'nope') === null && L.getEntry(loc, '') === null,
    'lookup mismatch');
  check('getEntry trims the wanted key',
    L.getEntry(loc, ' play ') !== null, 'trim lookup failed');
  check('languageList returns a copy',
    (() => { const l = L.languageList(loc); l.push('xx'); return L.languageList(loc).length === 3; })(),
    JSON.stringify(L.languageList(loc)));
  check('defaultLanguageOf reads the default',
    L.defaultLanguageOf(loc) === 'en', L.defaultLanguageOf(loc));
  check('hasTranslation is exact-language, no fallback',
    L.hasTranslation(loc, 'play', 'es') === true &&
    L.hasTranslation(loc, 'quit', 'es') === false &&
    L.hasTranslation(loc, 'quit', 'fr') === true &&
    L.hasTranslation(loc, 'nope', 'en') === false,
    'hasTranslation mismatch');
}

// --- resolution + fallback ---
{
  const loc = {
    defaultLanguage: 'en', languages: ['en', 'es'],
    entries: [
      { key: 'play', values: { en: 'Play', es: 'Jugar' } },
      { key: 'quit', values: { en: 'Quit', es: '' } },
      { key: 'empty', values: { en: '', es: '' } }
    ]
  };
  check('current-language translation wins',
    L.resolveLocalized(loc, 'play', 'es') === 'Jugar', L.resolveLocalized(loc, 'play', 'es'));
  check('empty current translation falls back to the default',
    L.resolveLocalized(loc, 'quit', 'es') === 'Quit', L.resolveLocalized(loc, 'quit', 'es'));
  check('unknown language falls back to the default',
    L.resolveLocalized(loc, 'play', 'de') === 'Play', L.resolveLocalized(loc, 'play', 'de'));
  check('blank language falls back to the default',
    L.resolveLocalized(loc, 'play', '') === 'Play', L.resolveLocalized(loc, 'play', ''));
  check('missing everywhere resolves to null',
    L.resolveLocalized(loc, 'empty', 'es') === null &&
    L.resolveLocalized(loc, 'nope', 'en') === null &&
    L.resolveLocalized(loc, '', 'en') === null,
    'missing-key resolution mismatch');
  check('default-language entry wins over nothing, not over a translation',
    L.resolveLocalized(loc, 'play', 'en') === 'Play', L.resolveLocalized(loc, 'play', 'en'));
}

// --- known languages ---
{
  const loc = { defaultLanguage: 'en', languages: ['en', 'es'], entries: [] };
  check('isKnownLanguage matches list members only',
    L.isKnownLanguage(loc, 'es') === true && L.isKnownLanguage(loc, 'de') === false &&
    L.isKnownLanguage(loc, '') === false && L.isKnownLanguage(loc, ' es ') === true,
    'known-language mismatch');
  check('isKnownLanguage on a missing table knows only en',
    L.isKnownLanguage(null, 'en') === true && L.isKnownLanguage(null, 'es') === false,
    'null-table known-language mismatch');
}

// --- bound texts ---
{
  const loc = {
    defaultLanguage: 'en', languages: ['en', 'es'],
    entries: [{ key: 'play', values: { en: 'Play', es: 'Jugar' } }]
  };
  check('boundTextFor resolves a bound text object',
    L.boundTextFor({ kind: 'text', localeKey: 'play' }, loc, 'es') === 'Jugar',
    L.boundTextFor({ kind: 'text', localeKey: 'play' }, loc, 'es'));
  check('boundTextFor falls back for a bound text object',
    L.boundTextFor({ kind: 'text', localeKey: 'play' }, loc, 'de') === 'Play',
    L.boundTextFor({ kind: 'text', localeKey: 'play' }, loc, 'de'));
  check('boundTextFor reads null for unbound / non-text / missing keys',
    L.boundTextFor({ kind: 'text', localeKey: '' }, loc, 'es') === null &&
    L.boundTextFor({ kind: 'text' }, loc, 'es') === null &&
    L.boundTextFor({ kind: 'sprite', localeKey: 'play' }, loc, 'es') === null &&
    L.boundTextFor({ kind: 'text', localeKey: 'nope' }, loc, 'es') === null &&
    L.boundTextFor(null, loc, 'es') === null,
    'bound-text mismatch');
}

// --- block predicates ---
check('action predicate covers the three actions only',
  L.isLocalizationAction('setLanguage') && L.isLocalizationAction('setTextFromKey') &&
  L.isLocalizationAction('setVariableFromKey') && !L.isLocalizationAction('languageIs') &&
  !L.isLocalizationAction('setText'));
check('condition predicate covers languageIs only',
  L.isLocalizationCondition('languageIs') && !L.isLocalizationCondition('setLanguage'));

// --- hostile safety ---
{
  let threw = false;
  try {
    L.normalizeLocalization('junk');
    L.normalizeLocalization({ defaultLanguage: {}, languages: 'es', entries: 'nope' });
    L.getEntry(null, null);
    L.resolveLocalized(undefined, undefined, undefined);
    L.isKnownLanguage(42, {});
    L.boundTextFor('junk', null, null);
    L.languageList(null);
    L.entryKeys('junk');
  } catch (e) { threw = true; }
  check('hostile input never throws', !threw, 'threw');
  check('hostile table shapes degrade to the English default',
    L.defaultLanguageOf('junk') === 'en' && JSON.stringify(L.languageList(42)) === '["en"]',
    `${L.defaultLanguageOf('junk')} / ${JSON.stringify(L.languageList(42))}`);
}

if (failures) { console.error(`${failures} assertion(s) failed`); process.exit(1); }
console.log('localization.test.js: all assertions passed');
