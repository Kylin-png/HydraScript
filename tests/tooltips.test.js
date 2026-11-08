// Tests for P3 item 20 — plain-language block tooltips.
//
// Every catalog block must carry a non-empty `note` (the palette hover
// tooltip and the block-picker detail text both read it), and every
// static palette option in index.html must carry a non-empty `title`.
// The catalog-driven hydration in script.js copies note -> title for
// generated options, and placed grid cells get the same note as a title.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const sandbox = {};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'hydra', 'block-catalog.js'), 'utf8'),
  sandbox, { filename: 'block-catalog.js' });
const blocks = sandbox.HydraBlockCatalog.blocks;

check('catalog loads with blocks', Array.isArray(blocks) && blocks.length > 300,
  `got ${blocks && blocks.length}`);

const missing = blocks.filter(b => !b.note || !String(b.note).trim());
check('every catalog block has a non-empty note',
  missing.length === 0,
  missing.slice(0, 10).map(b => b.blockType).join(', '));

const short = blocks.filter(b => b.note && String(b.note).trim().length < 10);
check('every note is a real sentence, not a stub',
  short.length === 0,
  short.slice(0, 10).map(b => `${b.blockType} (${JSON.stringify(b.note)})`).join(', '));

// Spot checks: preset notes must name the thing they do, not just repeat a label.
const by = t => blocks.find(b => b.blockType === t) || {};
check('mouse preset note names the button',
  /left mouse button/.test(by('mouse-pressed-left').note || ''));
check('mouse any-button preset note reads naturally',
  by('mouse-held-any').note === 'True while any mouse button is held down.');
check('variable preset note expands doorsOpen',
  /doors open variable/.test(by('var-doorsopen-add').note || ''));
check('variable preset note expands bossHealth',
  /boss health variable/.test(by('var-bosshealth-at-least').note || ''));
check('physics preset note carries its value',
  /ice preset value \(0\.99\)/.test(by('physics-ice-friction').note || ''));
check('key preset note names the key and timing',
  by('key-keyw-held').note === 'True while W is held down.');
check('game-flow preset note present',
  /camera follow the object/.test(by('camera-follow-player').note || ''));

// Static palette options in index.html: every block-option needs a title.
// The tag regex must tolerate `>` inside quoted attribute values
// (titles like "score >= 10" contain one).
const html = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'index.html'), 'utf8');
const options = [...html.matchAll(/<div class="block-option"(?:[^>"']|"[^"]*")*>/g)].map(m => m[0]);
check('static palette has block options', options.length >= 30, `got ${options.length}`);
const untitled = options.filter(o => !/title="[^"]+"/.test(o));
check('every static palette option has a non-empty title',
  untitled.length === 0,
  untitled.slice(0, 5).join(' '));
const titledTypes = options.map(o => (o.match(/data-block-type="([^"]+)"/) || [])[1]);
check('game-start option tooltip explains setup use',
  /Fires once when/.test(
    (options.find(o => /data-block-type="game-start"/.test(o)) || '').match(/title="([^"]+)"/)?.[1] || ''));

// The editor wiring must copy catalog notes onto palette options and cells.
const script = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'script.js'), 'utf8');
check('hydrateCatalogBlocks sets option.title from block.note',
  /option\.title = block\.note \|\| block\.label/.test(script));
check('placed grid cells get the catalog note as title',
  /cell\.title = \(catalogBlock && catalogBlock\.note\) \|\| label/.test(script));

if (failures) { console.log(`${failures} FAILURES`); process.exit(1); }
console.log('all tooltip checks passed');
