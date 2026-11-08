// Asset-manager regression test: asset normalization (backward compatible),
// usage collection, unused-asset detection, reference removal, and the
// quota-safe save path's asset handling.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HYDRA = path.join(__dirname, '..', 'hydra');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const sandbox = {};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-universal.js'), 'utf8'), sandbox,
  { filename: 'hydra-universal.js' });
const HU = sandbox.HydraUniversal;
check('HydraUniversal loaded with asset helpers',
  !!HU && typeof HU.normalizeAsset === 'function' && typeof HU.collectAssetUsage === 'function' &&
  typeof HU.findUnusedAssets === 'function' && typeof HU.removeAssetReferences === 'function');

const IMG = 'data:image/png;base64,iVBORw0KGgo=';
const GIF = 'data:image/gif;base64,R0lGODlhAQABAAAA';
const MP3 = 'data:audio/mpeg;base64,//uQxAAAA';

// --- normalizeAsset: backward compatibility ---
const legacy = HU.normalizeAsset({ name: 'hero.png', dataUrl: IMG });
check('legacy {name,dataUrl} keeps image kind', legacy.kind === 'image');
check('legacy entry keeps name', legacy.name === 'hero.png');

const audio = HU.normalizeAsset({ name: 'jump.mp3', dataUrl: MP3 });
check('audio dataUrl infers audio kind', audio.kind === 'audio');

const gif = HU.normalizeAsset({ name: 'run.gif', dataUrl: GIF });
check('gif stays image kind (browsers animate it)', gif.kind === 'image');

const nameless = HU.normalizeAsset({ dataUrl: IMG });
check('missing name gets default', nameless.name === 'Untitled asset');

const explicit = HU.normalizeAsset({ name: 'x', dataUrl: MP3, kind: 'image' });
check('explicit kind is respected', explicit.kind === 'image');

// --- collectAssetUsage / findUnusedAssets ---
const project = {
  scenes: [
    {
      id: 1, name: 'Level 1', bgAssetId: 'a_bg',
      objects: [
        { id: 1, name: 'Hero', assetId: 'a_hero' },
        { id: 2, name: 'Hero clone', assetId: 'a_hero' },
        { id: 3, name: 'Sign', assetId: null }
      ]
    },
    { id: 2, name: 'Level 2', bgAssetId: null, objects: [] }
  ],
  assets: {
    a_hero: { name: 'hero.png', dataUrl: IMG, kind: 'image' },
    a_bg: { name: 'bg.png', dataUrl: IMG, kind: 'image' },
    a_old: { name: 'old.png', dataUrl: IMG, kind: 'image' }
  }
};

const usage = HU.collectAssetUsage(project);
check('sprite usage collected', Array.isArray(usage.a_hero) && usage.a_hero.length === 2);
check('sprite usage entry shape',
  usage.a_hero[0].where === 'sprite' && usage.a_hero[0].objectName === 'Hero' &&
  usage.a_hero[0].sceneId === 1);
check('background usage collected',
  Array.isArray(usage.a_bg) && usage.a_bg.length === 1 && usage.a_bg[0].where === 'background' &&
  usage.a_bg[0].sceneName === 'Level 1');
check('unreferenced id absent from usage', !usage.a_old);

// Dangling reference: id referenced but missing from project.assets.
project.scenes[1].objects.push({ id: 9, name: 'Ghost', assetId: 'a_missing' });
const usage2 = HU.collectAssetUsage(project);
check('dangling asset ref still reported',
  Array.isArray(usage2.a_missing) && usage2.a_missing[0].objectName === 'Ghost');

const unused = HU.findUnusedAssets(project);
check('unused asset detected', unused.length === 1 && unused[0] === 'a_old');

// --- removeAssetReferences ---
const clone = JSON.parse(JSON.stringify(project));
const cleared = HU.removeAssetReferences(clone, 'a_hero');
check('removeAssetReferences clears both sprite refs', cleared === 2 &&
  clone.scenes[0].objects[0].assetId === null && clone.scenes[0].objects[1].assetId === null);
const clearedBg = HU.removeAssetReferences(clone, 'a_bg');
check('removeAssetReferences clears background ref',
  clearedBg === 1 && clone.scenes[0].bgAssetId === null);
const clearedNone = HU.removeAssetReferences(clone, 'a_nope');
check('removeAssetReferences returns 0 for unknown id', clearedNone === 0);

// --- normalizeProject normalizes legacy assets ---
const oldProject = {
  scenes: [],
  assets: { a1: { name: 'old.mp3', dataUrl: MP3 } } // no kind field
};
HU.normalizeProject(oldProject);
check('normalizeProject infers audio kind on legacy assets', oldProject.assets.a1.kind === 'audio');

// --- serializeProject preserves assets untouched ---
const withAliases = JSON.parse(JSON.stringify(project));
HU.normalizeProject(withAliases);
const serialized = HU.serializeProject(withAliases);
check('serializeProject keeps all assets',
  serialized.assets && Object.keys(serialized.assets).length === 3 &&
  serialized.assets.a_hero.name === 'hero.png');
const roundTrip = HU.normalizeProject(serialized);
check('asset entries survive save/load round-trip',
  roundTrip.assets.a_bg.kind === 'image' && HU.findUnusedAssets(roundTrip).length === 1);

// --- upload limits (Stage 2 asset manager) ---
check('upload helpers exported',
  typeof HU.validateUploadFile === 'function' && typeof HU.downscaleDimensions === 'function' &&
  HU.ASSET_MAX_FILE_BYTES === 8 * 1024 * 1024 && HU.ASSET_MAX_IMAGE_SIDE === 1024);

check('small file passes validation',
  HU.validateUploadFile({ name: 'a.png', size: 1024, type: 'image/png' }).ok === true);
check('file at exactly the limit passes',
  HU.validateUploadFile({ name: 'a.png', size: 8 * 1024 * 1024, type: 'image/png' }).ok === true);
const tooBig = HU.validateUploadFile({ name: 'huge.png', size: 9 * 1024 * 1024, type: 'image/png' });
check('file over the limit is refused', tooBig.ok === false);
check('refusal names the file and the limit',
  /huge\.png/.test(tooBig.reason) && /8\.00 MB/.test(tooBig.reason));
check('missing file is refused',
  HU.validateUploadFile(null).ok === false);
check('file with unknown size passes (size enforced again at save time if present)',
  HU.validateUploadFile({ name: 'a.png', type: 'image/png' }).ok === true);

const fit = HU.downscaleDimensions(800, 600, 1024);
check('image inside the limit is unchanged',
  fit.width === 800 && fit.height === 600 && fit.downscaled === false);
const wide = HU.downscaleDimensions(2048, 1024, 1024);
check('wide image scales to the limit keeping aspect',
  wide.width === 1024 && wide.height === 512 && wide.downscaled === true);
const tall = HU.downscaleDimensions(500, 2000, 1024);
check('tall image scales on its longest side',
  tall.width === 256 && tall.height === 1024 && tall.downscaled === true);
const square = HU.downscaleDimensions(3000, 3000, 1024);
check('square image scales to the limit on both sides',
  square.width === 1024 && square.height === 1024 && square.downscaled === true);
const atLimit = HU.downscaleDimensions(1024, 768, 1024);
check('image exactly at the limit is unchanged', atLimit.downscaled === false);
check('bad dimensions do not crash',
  HU.downscaleDimensions(0, 0, 1024).downscaled === false);

process.exit(failures === 0 ? 0 : 1);
