// Block-catalog field-control schema (P2 item 14/11).
//
// The catalog is the single declarative source for every visual block's
// defaults, label, and editor fields. This test locks the schema in:
//   - FIELD_CONTROLS is the canonical control vocabulary: the six v4
//     controls (text, textarea, select, expr, object, color) plus the four
//     v3 extensions (number, checkbox, action, scene).
//   - validateCatalog() finds nothing wrong with the shipped catalog.
//   - every control in the vocabulary is actually rendered by the editor's
//     catalog property panel (script.js makeCatalogFieldInput).
//   - every v4 reference block is accounted for in v3: present in the
//     catalog, dispatched by a runtime, renamed (map below), or a recorded
//     known gap — never silently lost.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HYDRA = path.join(__dirname, '..', 'hydra');
const REPO = path.join(__dirname, '..');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

function loadInSandbox(file, exportLine) {
  const src = fs.readFileSync(file, 'utf8');
  const sb = { console };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(exportLine ? src.replace(/}\)\(window\);\s*$/, exportLine) : src, sb,
    { filename: path.basename(file) });
  return sb;
}

// ---- the v3 catalog ----
const catSb = loadInSandbox(path.join(HYDRA, 'block-catalog.js'));
const catalog = catSb.window.HydraBlockCatalog;
const blocks = catalog.blocks;

check('catalog loads with 556 blocks', blocks.length === 556, `got ${blocks.length}`);
check('catalog exposes FIELD_CONTROLS', !!catalog.FIELD_CONTROLS && typeof catalog.FIELD_CONTROLS === 'object');
check('catalog exposes findBlock', typeof catalog.findBlock === 'function');
check('catalog exposes validateCatalog', typeof catalog.validateCatalog === 'function');

// ---- the vocabulary ----
const V4_CONTROLS = ['text', 'textarea', 'select', 'expr', 'object', 'color'];
const V3_CONTROLS = ['number', 'checkbox', 'action', 'scene', 'audio'];
const FUNCTION_CONTROLS = ['function'];
const controls = Object.keys(catalog.FIELD_CONTROLS);
check('FIELD_CONTROLS is exactly the v4 six plus the v3 five plus the function picker',
  controls.length === 12 &&
  V4_CONTROLS.every(c => controls.includes(c)) &&
  V3_CONTROLS.every(c => controls.includes(c)) &&
  FUNCTION_CONTROLS.every(c => controls.includes(c)),
  controls.join(', '));
V4_CONTROLS.concat(V3_CONTROLS).forEach(c => {
  const spec = catalog.FIELD_CONTROLS[c];
  check(`FIELD_CONTROLS.${c} declares its extras as an array`,
    spec && Array.isArray(spec.extras) && typeof spec.desc === 'string' && spec.desc.length > 0);
});
check('FIELD_CONTROLS.select allows options', catalog.FIELD_CONTROLS.select.extras.includes('options'));
check('FIELD_CONTROLS.number allows min/max/step',
  ['min', 'max', 'step'].every(k => catalog.FIELD_CONTROLS.number.extras.includes(k)));
check('FIELD_CONTROLS.object allows includeAll', catalog.FIELD_CONTROLS.object.extras.includes('includeAll'));
check('FIELD_CONTROLS.textarea allows placeholder + rows',
  catalog.FIELD_CONTROLS.textarea.extras.includes('placeholder') &&
  catalog.FIELD_CONTROLS.textarea.extras.includes('rows'));

// ---- the shipped catalog conforms ----
const findings = catalog.validateCatalog();
check('validateCatalog() finds nothing in the shipped catalog',
  Array.isArray(findings) && findings.length === 0, findings.slice(0, 5).join(' | '));
check('validateCatalog() with no argument defaults to the catalog',
  catalog.validateCatalog().length === 0);
check('validateCatalog() accepts an explicit list',
  catalog.validateCatalog(blocks).length === 0);

// Every field control in the catalog is in the vocabulary (implied by the
// empty findings above, asserted directly so a regression names the control).
const usedControls = new Set();
blocks.forEach(b => (b.fields || []).forEach(f => usedControls.add(f.control)));
check('every control used by the catalog is in FIELD_CONTROLS',
  [...usedControls].every(c => controls.includes(c)), [...usedControls].join(', '));
check('the catalog uses all twelve controls', usedControls.size === 12, [...usedControls].join(', '));

// ---- the editor renders every control in the vocabulary ----
const scriptSrc = fs.readFileSync(path.join(HYDRA, 'script.js'), 'utf8');
controls.forEach(c => {
  check(`script.js makeCatalogFieldInput handles control '${c}'`,
    new RegExp(`case '${c}':`).test(scriptSrc));
});

// ---- findBlock ----
check('findBlock returns the block for a known blockType',
  catalog.findBlock('music-playing') && catalog.findBlock('music-playing').runtimeType === 'musicPlaying');
check('findBlock returns null for an unknown blockType', catalog.findBlock('no-such-block') === null);
check('findBlock returns null for non-string input',
  catalog.findBlock(null) === null && catalog.findBlock(42) === null && catalog.findBlock('') === null);

// ---- the one drift this cycle fixed ----
// Music Playing declared an Invert field but its defaults carried no
// reversed key, so a freshly placed block had no real boolean until touched.
check('music-playing defaults carry reversed: false',
  catalog.findBlock('music-playing').defaults.reversed === false);

// ---- presets are by design, not drift ----
// Preset blocks share their base block's runtimeType and pin values in
// defaults that no field edits; validateCatalog() must not flag either.
const runtimeCounts = {};
blocks.forEach(b => { runtimeCounts[b.runtimeType] = (runtimeCounts[b.runtimeType] || 0) + 1; });
const shared = Object.entries(runtimeCounts).filter(([, n]) => n > 1);
check('preset blocks share runtimeTypes (keyPressed, mouseClick, ...)',
  shared.length > 0 && shared.some(([rt]) => rt === 'keyPressed') && shared.some(([rt]) => rt === 'mouseClick'),
  shared.slice(0, 5).map(([rt, n]) => `${rt}x${n}`).join(', '));
check('validateCatalog() still returns empty with shared runtimeTypes', findings.length === 0);
const noFieldBlocks = blocks.filter(b => !(b.fields || []).length);
check('fixed presets with no editable fields exist and pass validation',
  noFieldBlocks.length > 0 && findings.length === 0, `no-field blocks: ${noFieldBlocks.length}`);

// ---- hostile input never throws ----
[['null', null], ['string', 'x'], ['number', 42], ['bare null', [null]],
 ['bare object', [{}]], ['bad fields', [{ blockType: 'x', fields: 'nope' }]],
 ['unknown control', [{ blockType: 'x', runtimeType: 'x', kind: 'action', category: 'c',
   label: 'l', color: '#fff', cellLabel: 'c', note: 'n', defaults: { type: 'x' },
   fields: [{ key: 'v', label: 'V', control: 'bogus' }] }]],
].forEach(([name, input]) => {
  let out;
  let threw = false;
  try { out = catalog.validateCatalog(input); } catch (e) { threw = true; }
  check(`validateCatalog(${name}) returns findings without throwing`,
    !threw && Array.isArray(out) && out.length > 0, threw ? 'threw' : JSON.stringify(out));
});
check('validateCatalog flags the unknown control by name',
  catalog.validateCatalog([{ blockType: 'x', runtimeType: 'x', kind: 'action', category: 'c',
    label: 'l', color: '#fff', cellLabel: 'c', note: 'n', defaults: { type: 'x' },
    fields: [{ key: 'v', label: 'V', control: 'bogus' }] }])
    .some(f => /unknown control bogus/.test(f)));
check('validateCatalog flags a field key missing from defaults',
  catalog.validateCatalog([{ blockType: 'x', runtimeType: 'x', kind: 'condition', category: 'c',
    label: 'l', color: '#fff', cellLabel: 'c', note: 'n', defaults: { type: 'x' },
    fields: [{ key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }] }])
    .some(f => /field key not in defaults/.test(f)));
check('validateCatalog flags a select without options',
  catalog.validateCatalog([{ blockType: 'x', runtimeType: 'x', kind: 'action', category: 'c',
    label: 'l', color: '#fff', cellLabel: 'c', note: 'n', defaults: { type: 'x', mode: '' },
    fields: [{ key: 'mode', label: 'Mode', control: 'select' }] }])
    .some(f => /without options/.test(f)));
check('validateCatalog flags a number without min/max/step',
  catalog.validateCatalog([{ blockType: 'x', runtimeType: 'x', kind: 'action', category: 'c',
    label: 'l', color: '#fff', cellLabel: 'c', note: 'n', defaults: { type: 'x', v: 0 },
    fields: [{ key: 'v', label: 'V', control: 'number' }] }])
    .some(f => /without min\/max\/step/.test(f)));
check('validateCatalog flags a non-canonical reversed field',
  catalog.validateCatalog([{ blockType: 'x', runtimeType: 'x', kind: 'condition', category: 'c',
    label: 'l', color: '#fff', cellLabel: 'c', note: 'n', defaults: { type: 'x', reversed: false },
    fields: [{ key: 'reversed', label: 'Invert', control: 'checkbox' }] }])
    .some(f => /canonical Off\/On select/.test(f)));

// ---- v4 alignment ----
// Load the pristine v4 reference catalog (read-only; never edited).
const v4Sb = loadInSandbox(path.join(REPO, 'v4-reference', 'hydra-blocks.js'),
  '  global.__v4blocks = BLOCKS;\n})(window);');
const v4blocks = v4Sb.__v4blocks;
check('v4 reference catalog loads (38 blocks)', Array.isArray(v4blocks) && v4blocks.length === 38,
  `got ${v4blocks && v4blocks.length}`);
const v4Controls = new Set();
v4blocks.forEach(b => (b.fields || []).forEach(f => v4Controls.add(f.control)));
check('every control v4 uses is in FIELD_CONTROLS',
  [...v4Controls].every(c => controls.includes(c)), [...v4Controls].join(', '));
// The v4 reference predates the tooltip-notes rule (eighteen of its blocks
// carry no note) and carries one real authoring bug of its own: play-sound
// ({ type: 'playSound', ..., type: 'sine' } — the wave field reuses the
// discriminator key), so its effective defaults.type is 'sine', not
// 'playSound'. v3 sidestepped both: every v3 block has a note, and Play
// Sound is asset-based with no wave field. The v4 file is pristine and
// stays untouched, so the test pins the exact finding list instead.
const v4Findings = catalog.validateCatalog(v4blocks);
const V4_MISSING_NOTES = ['position-condition', 'set-velocity', 'force-toward',
  'rotate-object', 'set-size', 'set-variable', 'variable-condition',
  'destroy-object', 'show-hide', 'set-text', 'set-color', 'set-camera',
  'follow-camera', 'camera-shake', 'switch-scene', 'timer-control',
  'screen-flash', 'create-particles'];
check('v4 non-conformances are exactly the 18 missing notes + the play-sound duplicate-type bug',
  v4Findings.length === V4_MISSING_NOTES.length + 1 &&
  V4_MISSING_NOTES.every(t => v4Findings.includes(`${t}: missing note`)) &&
  v4Findings.includes('play-sound: defaults.type sine != runtimeType playSound'),
  v4Findings.join(' | '));
// With notes supplied and the play-sound bug repaired in the copy only,
// the v4 blocks must otherwise conform to the field-control schema exactly.
const v4Repaired = v4blocks.map(b => ({
  ...b,
  note: b.note || 'v4 reference block',
  defaults: { ...b.defaults, type: b.runtimeType }
}));
check('the v4 reference blocks otherwise conform to the field-control schema',
  catalog.validateCatalog(v4Repaired).length === 0,
  catalog.validateCatalog(v4Repaired).slice(0, 5).join(' | '));

// Where each v4 block lives in v3. Renames are the honest record of v3
// unifying v4's split types: held/pressed/released keys and mouse buttons
// became one runtimeType with a mode field; v4's moveToward split into
// toward-an-object and toward-a-position; the rest are single renames.
const V4_RENAMES = {
  keyDown: 'keyPressed',       // held variant: inputCondition 'keyPressed'
  keyReleased: 'keyPressed',   // inputCondition 'keyReleased'
  mouseDown: 'mouseClick',     // mouseCondition 'mouseButtonPressed'
  mousePressed: 'mouseClick',  // mouseCondition 'mouseButtonJustPressed'
  overlap: 'overlapTouch',
  timer: 'onTimer',
  moveToward: 'moveTowardObject', // v3 also has moveTowardPosition
  applyImpulse: 'applyForce',
  variableCheck: 'getVariable',
  cameraShake: 'screenShake',
  createParticles: 'emitBurst'
};
// The v4 blocks with no v3 equivalent at all: none remain. v4's screenFlash
// was the last gap and closed in cycle 60 (the Screen Flash block, Camera
// category). Kept as an empty list so a future v4 block with no v3
// equivalent is recorded here instead of silently dropping a capability.
const KNOWN_GAPS = [];

const catalogRT = new Set(blocks.map(b => b.runtimeType));
const playerSrc = fs.readFileSync(path.join(HYDRA, 'player-runtime.js'), 'utf8');
function knownRuntime(rt) {
  return catalogRT.has(rt) || scriptSrc.includes(`'${rt}'`) || playerSrc.includes(`'${rt}'`);
}
const unaccounted = [];
v4blocks.forEach(b => {
  const rt = b.runtimeType;
  const target = V4_RENAMES[rt];
  const ok = knownRuntime(rt) || (target && knownRuntime(target)) || KNOWN_GAPS.includes(rt);
  if (!ok) unaccounted.push(rt);
});
check('every v4 block is accounted for in v3 (catalog, runtime, rename, or recorded gap)',
  unaccounted.length === 0, unaccounted.join(', '));
Object.entries(V4_RENAMES).forEach(([from, to]) => {
  check(`v4 rename ${from} -> ${to} points at a real v3 runtime type`, knownRuntime(to));
});
check('KNOWN_GAPS lists exactly the v4 blocks with no v3 equivalent',
  KNOWN_GAPS.length === 0, KNOWN_GAPS.join(', '));

if (failures) { console.log(`${failures} FAILURES`); process.exit(1); }
console.log('all catalog checks passed');
