// P3 item 22 — CDN-resilient home page.
//
// When the Tailwind CDN is unreachable, home.html must still render as a
// usable, dark-themed hub instead of raw unstyled HTML. The mechanism is
// a detection script (window.tailwind undefined -> inject the local
// home-fallback.css) plus a fallback stylesheet that re-implements every
// Tailwind utility home.html/home.js actually use.
//
// This test pins the mechanism statically: the detection script exists and
// is the ONLY reference to the fallback file (no static <link>, which
// would double-apply under Tailwind), and every utility token used in the
// hub markup has a matching selector in the fallback CSS — so a new
// Tailwind class added to the hub without a fallback rule fails here
// instead of silently un-styling offline users.

const fs = require('fs');
const path = require('path');

const HYDRA = path.join(__dirname, '..', 'hydra');
const homeHtml = fs.readFileSync(path.join(HYDRA, 'home.html'), 'utf8');
const homeJs = fs.readFileSync(path.join(HYDRA, 'home.js'), 'utf8');
const fallbackPath = path.join(HYDRA, 'home-fallback.css');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

check('home-fallback.css exists', fs.existsSync(fallbackPath));
const css = fs.existsSync(fallbackPath) ? fs.readFileSync(fallbackPath, 'utf8') : '';

// 1. Detection script: runs after the CDN script, injects the fallback
//    only when window.tailwind is missing, and marks <html>.
check('home.html detects a missing Tailwind CDN and injects the fallback',
  /if\s*\(\s*!window\.tailwind\s*\)/.test(homeHtml) &&
  /hydraFallback\.href\s*=\s*'home-fallback\.css'/.test(homeHtml) &&
  /classList\.add\('hydra-no-tailwind'\)/.test(homeHtml));
check('home.html has no static link to the fallback (it must not double-apply under Tailwind)',
  !/<link[^>]*home-fallback\.css/.test(homeHtml));
check('fallback file is injected by exactly one assignment in the detection script',
  (homeHtml.match(/\.href\s*=\s*'home-fallback\.css'/g) || []).length === 1);

// 2. Ordering rule: .hidden must come after .flex/.grid/.block, matching
//    Tailwind, so the wizard overlay (carrying both hidden and flex)
//    stays hidden until JS removes the class.
const hiddenAt = css.indexOf('.hidden {');
check('fallback defines .hidden after .flex/.grid/.block (Tailwind order)',
  hiddenAt > css.indexOf('.flex {') && hiddenAt > css.indexOf('.grid {') &&
  hiddenAt > css.indexOf('.block {'));

// 3. Coverage: every utility token used in home.html/home.js has a rule.
//    Tokens that need no rule by design:
const ALLOWLIST = new Set([
  'group',            // hover anchor only, no styles of its own
  'dark',             // theme switch on <html>, not a styled utility
  'modal', 'grid-pattern', 'light-grid-pattern', // defined in home.html's inline <style>
  'template-card', 'project-open-btn', 'project-rename-btn',
  'project-export-btn', 'project-delete-btn', // JS hooks, styled via utilities
  'fa-github', 'fab', // no FontAwesome stylesheet is loaded even online
  'hydra-no-tailwind', // marker class added by the detection script, not a styled utility
  'transform',        // translate/scale utilities set transform directly
  'bg-opacity-80',    // covered by the combined .bg-black.bg-opacity-80 rule
  'focus:ring-offset-2', 'focus:ring-offset-gray-900', // ring offsets are no-ops here
]);
check('combined bg-black + bg-opacity-80 rule exists',
  css.includes('.bg-black.bg-opacity-80'));

function escapeToken(t) {
  return t.replace(/([:[\]#/.%])/g, '\\$1');
}
function selectorFor(token) {
  if (token.startsWith('dark:hover:')) return `.dark .dark\\:hover\\:${escapeToken(token.slice('dark:hover:'.length))}:hover`;
  if (token.startsWith('dark:')) return `.dark .dark\\:${escapeToken(token.slice('dark:'.length))}`;
  if (token.startsWith('group-hover:')) return `.group:hover .group-hover\\:${escapeToken(token.slice('group-hover:'.length))}`;
  if (token.startsWith('hover:')) return `.hover\\:${escapeToken(token.slice('hover:'.length))}:hover`;
  if (token.startsWith('focus:')) return `.focus\\:${escapeToken(token.slice('focus:'.length))}:focus`;
  if (/^(sm|md|lg|xl):/.test(token)) {
    const i = token.indexOf(':');
    return `.${token.slice(0, i)}\\:${escapeToken(token.slice(i + 1))}`;
  }
  return `.${escapeToken(token)}`;
}

const tokens = new Set();
for (const src of [homeHtml, homeJs]) {
  for (const m of src.matchAll(/class="([^"]+)"/g)) {
    for (const t of m[1].split(/\s+/)) if (t) tokens.add(t);
  }
  for (const m of src.matchAll(/classList\.toggle\('([^']+)'/g)) tokens.add(m[1]);
  for (const m of src.matchAll(/classList\.(?:add|remove)\('([^']+)'/g)) tokens.add(m[1]);
  for (const m of src.matchAll(/\.className\s*=\s*'([^']+)'/g)) {
    for (const t of m[1].split(/\s+/)) if (t) tokens.add(t);
  }
}
const missing = [];
for (const t of [...tokens].sort()) {
  if (ALLOWLIST.has(t)) continue;
  if (!css.includes(selectorFor(t))) missing.push(`${t} -> ${selectorFor(t)}`);
}
check('every hub utility token has a fallback rule', missing.length === 0,
  missing.slice(0, 10).join(' | ') + (missing.length > 10 ? ` (+${missing.length - 10} more)` : ''));

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log('home-fallback.test.js: all checks passed');
