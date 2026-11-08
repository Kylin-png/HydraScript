// Docs regression test for P3 item 19 (user guide + block reference).
//
// Verifies the docs stay complete as blocks are added:
//   - docs/user-guide.md and docs/block-reference.md exist
//   - every block in hydra/block-catalog.js is documented in the reference
//   - every core palette block (data-block-type in index.html) is documented
//   - no TODO placeholders left in the docs
//   - the user guide covers the main workflows

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.join(__dirname, '..');
const HYDRA = path.join(REPO, 'hydra');
const DOCS = path.join(REPO, 'docs');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const guidePath = path.join(DOCS, 'user-guide.md');
const refPath = path.join(DOCS, 'block-reference.md');
check('user guide exists', fs.existsSync(guidePath));
check('block reference exists', fs.existsSync(refPath));
if (!fs.existsSync(guidePath) || !fs.existsSync(refPath)) process.exit(1);

const guide = fs.readFileSync(guidePath, 'utf8');
const ref = fs.readFileSync(refPath, 'utf8');

// --- catalog coverage ---
const sb = {}; sb.window = sb; vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8'), sb,
  { filename: 'block-catalog.js' });
const catalog = sb.HydraBlockCatalog.blocks;
check('catalog loaded', Array.isArray(catalog) && catalog.length > 0, String(catalog && catalog.length));
const missingCatalog = catalog.filter(b => !ref.includes(b.label)).map(b => b.label);
check('every catalog block documented', missingCatalog.length === 0,
  missingCatalog.slice(0, 5).join(', '));

// --- core palette coverage ---
const html = fs.readFileSync(path.join(HYDRA, 'index.html'), 'utf8');
const paletteTypes = new Set();
const re = /data-block-type="([^"]+)"/g;
let m;
while ((m = re.exec(html))) { if (m[1] !== 'none') paletteTypes.add(m[1]); }
const labelRe = /data-block-type="([^"]+)"[\s\S]*?block-label">([^<]+)</g;
const paletteLabels = {};
while ((m = labelRe.exec(html))) { if (m[1] !== 'none') paletteLabels[m[1]] = m[2].trim(); }
const missingPalette = [...paletteTypes].filter(t => {
  const label = paletteLabels[t] || t;
  return !ref.includes(label);
});
check('every palette block documented', missingPalette.length === 0,
  missingPalette.slice(0, 5).join(', '));

// --- no placeholders ---
for (const [name, text] of [['user guide', guide], ['block reference', ref]]) {
  check(`${name} has no TODO markers`, !/TODO|FIXME|XXX/i.test(text));
}

// --- user guide covers the main workflows ---
const sections = ['Start a project', 'Assets', 'Logic', 'Variables and expressions',
  'Preview and diagnostics', 'Export a playable game', 'Staying safe'];
const missingSections = sections.filter(s => !guide.includes(s));
check('user guide covers main workflows', missingSections.length === 0,
  missingSections.join(', '));

// --- reference mentions expressions safety + event wiring basics ---
check('reference explains condition/action wiring', /Condition.*Action|actions run/i.test(ref));

process.exit(failures === 0 ? 0 : 1);
