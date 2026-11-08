// P2 item 16/13 — templates as pure builder functions.
//
// The templates module must load and build with no window, no DOM, and no
// storage: the core is an injected (or global) dependency, the id factory
// is optional, and every build is fresh — two projects from the same
// template share no object references and are deterministic.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HYDRA = path.join(__dirname, '..', 'hydra');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

// All reachable object identities in a plain-data tree (identity walk, so a
// shared reference between two builds is caught even deep inside a grid).
function collectIdentities(root) {
  const ids = new Set();
  const stack = [root];
  const seen = new Set();
  while (stack.length) {
    const v = stack.pop();
    if (!v || typeof v !== 'object' || seen.has(v)) continue;
    seen.add(v);
    ids.add(v);
    for (const k of Object.keys(v)) stack.push(v[k]);
  }
  return ids;
}

// ---------- plain-node require: no window in this process ----------
check('no window global in plain node', typeof window === 'undefined');
const HST = require(path.join(HYDRA, 'starter-templates.js'));
check('require returns the template API', !!HST && typeof HST.createProject === 'function' && Array.isArray(HST.templates));
check('buildScene/buildScenes exposed', typeof HST.buildScene === 'function' && typeof HST.buildScenes === 'function');

// The real core, loaded once in a vm sandbox (the core still takes its
// global the old way); the templates module itself never sees that sandbox.
const sb = {}; sb.window = sb; vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-universal.js'), 'utf8'), sb, { filename: 'hydra-universal.js' });
const core = sb.HydraUniversal;
check('real core loaded for injection', !!core && typeof core.createProject === 'function');

// ---------- missing core: a plain-language error, not a TypeError ----------
let threw = null;
try { HST.createProject('platformer', 'No core', () => 'x-1'); } catch (e) { threw = e; }
check('missing core throws a clear error', threw instanceof Error && /HydraUniversal/.test(threw.message) && !/Cannot read propert/.test(threw.message), threw && threw.message);

// ---------- injected core works with no global HydraUniversal ----------
check('no global HydraUniversal in this process', typeof global.HydraUniversal === 'undefined');
const p1 = HST.createProject('platformer', 'Injected', () => 'inj-1', core);
check('injected core builds a project', !!p1 && p1.id === 'inj-1' && p1.scenes.length === 1 && p1.scenes[0].name === 'Platformer Quest', p1 && JSON.stringify({ id: p1.id, scenes: p1.scenes.length }));

// ---------- core resolved from globalThis when not injected ----------
global.HydraUniversal = core;
try {
  const p = HST.createProject('collector', 'Global', () => 'g-1');
  check('core resolved from globalThis', !!p && p.id === 'g-1');
} finally { delete global.HydraUniversal; }

// ---------- idFactory is optional: the core mints the id ----------
const pNoFactory = HST.createProject('collector', 'No factory', undefined, core);
check('omitted idFactory still builds (core mints the id)', !!pNoFactory && typeof pNoFactory.id === 'string' && pNoFactory.id.length > 0, pNoFactory && String(pNoFactory.id));
const pNoArgs = HST.createProject('shooter', undefined, undefined, core);
check('omitted name falls back to Untitled Project', pNoArgs && pNoArgs.name === 'Untitled Project', pNoArgs && pNoArgs.name);

// ---------- buildScene / buildScenes are pure scene builders ----------
const s1 = HST.buildScene('platformer');
const s2 = HST.buildScene('platformer');
check('buildScene returns the platformer scene', !!s1 && s1.name === 'Platformer Quest');
check('buildScene builds fresh scenes', s1 !== s2 && s1.objects !== s2.objects);
check('buildScene unknown id falls back to a blank scene', HST.buildScene('no-such-template').name === 'Scene 1');
check('buildScenes flagship has 8 scenes', HST.buildScenes('flagship').length === 8);
check('buildScenes fullgame has 4 scenes', HST.buildScenes('fullgame').map(s => s.name).join('|') === 'Main Menu|Level 1 - Forest Gate|Level 2 - Sky Ruins|You Win', HST.buildScenes('fullgame').map(s => s.name).join('|'));
check('buildScenes single-scene template has 1 scene', HST.buildScenes('shooter').length === 1);
check('createProject unknown id falls back to a blank project', HST.createProject('nope', 'Blank', () => 'b-1', core).scenes[0].name === 'Scene 1');

// ---------- determinism: same inputs, same template-authored content ----------
// The raw scene builders are pure functions of the template id, so two
// builds are byte-identical. The full createProject pipeline runs through
// the core normalizer, which mints fresh random component ids (cmp_*)
// per call — those are the core's, not the templates', so they are stripped
// along with the wall-clock timestamps before comparing.
function stripVolatile(v) {
  if (Array.isArray(v)) return v.map(stripVolatile);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (k === 'dateCreated' || k === 'lastModified') continue;
      if (k === 'id' && typeof val === 'string' && val.startsWith('cmp_')) continue;
      out[k] = stripVolatile(val);
    }
    return out;
  }
  return v;
}
function freshIds(prefix) { let n = 0; return () => prefix + '-' + (++n); }
check('raw scene builders are deterministic', JSON.stringify(HST.buildScenes('fullgame')) === JSON.stringify(HST.buildScenes('fullgame')));
check('raw flagship scene builders are deterministic', JSON.stringify(HST.buildScenes('flagship')) === JSON.stringify(HST.buildScenes('flagship')));
const d1 = HST.createProject('fullgame', 'Det', freshIds('d'), core);
const d2 = HST.createProject('fullgame', 'Det', freshIds('d'), core);
check('same inputs build identical projects (modulo core-minted ids)', JSON.stringify(stripVolatile(d1)) === JSON.stringify(stripVolatile(d2)));

// ---------- independence: two builds share no references ----------
// Every template, twice: no object identity may appear in both builds, and
// mutating the first build must leave the second byte-identical.
for (const tpl of HST.templates) {
  const a = HST.createProject(tpl.id, 'A', () => 'a-1', core);
  const b = HST.createProject(tpl.id, 'B', () => 'b-1', core);
  const aIds = collectIdentities(a);
  const bIds = collectIdentities(b);
  let shared = 0;
  for (const id of bIds) if (aIds.has(id)) shared++;
  const bBefore = JSON.stringify(b);
  // Mutate the first build as deeply as its shape allows.
  const aObj = a.scenes[0] && (a.scenes[0].objects || [])[0];
  if (aObj && aObj.physics) aObj.physics.gravity = 99;
  if (aObj) aObj.posX = -12345;
  const aGrid = a.scenes[0] && a.scenes[0].gridData;
  const aGridKey = aGrid && Object.keys(aGrid)[0];
  if (aGridKey != null) aGrid[aGridKey] = { type: 'mutated' };
  const aAssetKey = a.assets && Object.keys(a.assets)[0];
  if (aAssetKey) a.assets[aAssetKey].name = 'mutated';
  check(`${tpl.id}: two builds share no object references`, shared === 0, shared + ' shared');
  check(`${tpl.id}: mutating one build leaves the other untouched`, JSON.stringify(b) === bBefore);
}

if (failures) { console.log(`${failures} FAILURES`); process.exit(1); }
console.log('all template purity checks passed');
