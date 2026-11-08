// Icon coverage for batches 34-36 (P4 Advanced: object tags, pick by
// tag, minimap) — the 13 blocks cycle 9 recorded as text-label fallbacks
// plus the three its probe never tested (read-tagged-count, tagged-count,
// for-each-tagged), all 16 of which fell back to a text label on the
// grid. A text label overflows the 56px cell and clips at the grid edge
// when the block sits in column 0, the defect cycle 9 fixed for the
// attach blocks. Each of the 16 now carries a unique icon in
// CONCEPT_ICONS_BY_TYPE (hydra/script.js), symmetric about the block
// center (28, 28), following the picChain / picUnlink / picOffsetLink
// pattern. The live proof (a placed cell draws an icon, never its label
// as text) lives in the browser-smoke icon-coverage section; this file
// pins the wiring statically.

const fs = require('fs');
const path = require('path');

const HYDRA = path.join(__dirname, '..', 'hydra');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const scriptJs = fs.readFileSync(path.join(HYDRA, 'script.js'), 'utf8');
const catalogJs = fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8');

// blockType -> the exact CONCEPT_ICONS_BY_TYPE value expected.
const EXPECTED = {
  'add-tag': 'mod(picTag(), SM.plus),',
  'remove-tag': 'mod(picTag(), SM.x),',
  'clear-tags': 'picTagSlash(),',
  'read-tagged-count': 'mod(picTag(), SM.hash),',
  'has-tag': 'mod(picTag(), SM.q),',
  'tagged-count': 'mod(picTag(), SM.eq),',
  'pick-nearest-tagged': 'mod(picTag(), SM.n),',
  'pick-farthest-tagged': 'mod(picTag(), SM.f),',
  'pick-random-tagged': 'mod(picDice(), SM.tag),',
  'pick-tagged-object-into-variable': 'mod(picTag(), SM.box),',
  'for-each-tagged': 'mod(picTag(), SM.loop),',
  'show-minimap': 'mod(picMap(), SM.plus),',
  'hide-minimap': 'mod(picMap(), SM.minus),',
  'set-minimap-size': 'mod(picMap(), SM.box),',
  'set-minimap-zoom': 'mod(picMap(), SM.lens),',
  'minimap-visible': 'mod(picMap(), SM.q),'
};
const TYPES = Object.keys(EXPECTED);

check('editor gives each of the 16 batch 34-36 blocks a unique icon (no text-label fallback on the grid)',
  TYPES.every(t => scriptJs.includes(`'${t}': ${EXPECTED[t]}`)),
  TYPES.filter(t => !scriptJs.includes(`'${t}': ${EXPECTED[t]}`)).join(','));

check('the 16 icon values are all distinct strings',
  (() => {
    const vals = TYPES.map(t => EXPECTED[t]);
    return new Set(vals).size === vals.length;
  })());

check('no batch 34-36 icon reuses an attach icon (picChain / picUnlink / picOffsetLink)',
  TYPES.every(t => !EXPECTED[t].includes('picChain') &&
    !EXPECTED[t].includes('picUnlink') && !EXPECTED[t].includes('picOffsetLink')));

check('tag pictogram is symmetric about the block center (28, 28)',
  scriptJs.includes('function picTag()') &&
  scriptJs.includes('M 23 22 L 37 22 L 37 34 L 23 34 L 19 28 Z') &&
  scriptJs.includes('cx="33" cy="28" r="2"'));
check('clear-tags slash maps to itself under a half turn about (28, 28)',
  scriptJs.includes('function picTagSlash()') &&
  scriptJs.includes('picTag() +') &&
  scriptJs.includes('M 21 21 L 35 35'));
check('map pictogram is symmetric about the block center (28, 28)',
  scriptJs.includes('function picMap()') &&
  scriptJs.includes('x="18" y="20" width="20" height="16"') &&
  scriptJs.includes('x="24" y="24" width="8" height="8"') &&
  scriptJs.includes('cx="22" cy="32"') && scriptJs.includes('cx="34" cy="24"'));
check('the tag badge is a small tag centered on (36, 36)',
  scriptJs.includes('tag: `<polygon points="34,33 40,33 40,39 34,39 32,36" fill="${W}"/>`'));

check('icon helpers are used nowhere else (each icon stays unique)',
  (scriptJs.match(/picTag\(\)/g) || []).length === 11 &&
  (scriptJs.match(/picTagSlash\(\)/g) || []).length === 2 &&
  (scriptJs.match(/picMap\(\)/g) || []).length === 6 &&
  (scriptJs.match(/SM\.tag/g) || []).length === 1);

check('the catalog still carries all 16 blocks in their batches',
  catalogJs.includes("blockType: 'add-tag'") &&
  catalogJs.includes("blockType: 'remove-tag'") &&
  catalogJs.includes("blockType: 'clear-tags'") &&
  catalogJs.includes("blockType: 'read-tagged-count'") &&
  catalogJs.includes("blockType: 'has-tag'") &&
  catalogJs.includes("blockType: 'tagged-count'") &&
  catalogJs.includes("blockType: 'pick-nearest-tagged'") &&
  catalogJs.includes("blockType: 'pick-farthest-tagged'") &&
  catalogJs.includes("blockType: 'pick-random-tagged'") &&
  catalogJs.includes("blockType: 'pick-tagged-object-into-variable'") &&
  catalogJs.includes("blockType: 'for-each-tagged'") &&
  catalogJs.includes("blockType: 'show-minimap'") &&
  catalogJs.includes("blockType: 'hide-minimap'") &&
  catalogJs.includes("blockType: 'set-minimap-size'") &&
  catalogJs.includes("blockType: 'set-minimap-zoom'") &&
  catalogJs.includes("blockType: 'minimap-visible'") &&
  catalogJs.includes("category: 'Tags'") &&
  catalogJs.includes("category: 'Minimap'") &&
  catalogJs.includes("category: 'Control Flow'"));

check('the tag pictogram is defined once, next to the attach pictograms',
  scriptJs.indexOf('function picTag()') > scriptJs.indexOf('function picOffsetLink()') &&
  scriptJs.indexOf('function picTag()') < scriptJs.indexOf('function picSearch()'));
check('the map pictogram is defined once, next to the tag pictograms',
  scriptJs.indexOf('function picMap()') > scriptJs.indexOf('function picTagSlash()') &&
  scriptJs.indexOf('function picMap()') < scriptJs.indexOf('function picSearch()'));
check('the 16 icon entries sit with the attach entries in the blockType map',
  (() => {
    const attachAt = scriptJs.indexOf("'is-attached': mod(picChain(), SM.q),");
    const firstAt = scriptJs.indexOf(`'${TYPES[0]}': ${EXPECTED[TYPES[0]]}`);
    const lastAt = scriptJs.indexOf(`'${TYPES[TYPES.length - 1]}': ${EXPECTED[TYPES[TYPES.length - 1]]}`);
    return attachAt !== -1 && firstAt > attachAt && lastAt > firstAt;
  })());

if (failures > 0) { console.log(`FAILURES: ${failures}`); process.exit(1); }
console.log('iconcoverage.test.js: all checks passed');
