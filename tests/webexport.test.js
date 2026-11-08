// Unit tests for hydra/hydra-webexport.js — the P4 E1 web-target helpers.
//
// Pure logic: filename sanitizing, data-URL asset extraction, the stored-ZIP
// writer (verified with a minimal reader below), PWA manifest / service
// worker builders, the PWA HTML injection, and the icon painter. Nothing
// here touches the DOM.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const sandbox = {};
sandbox.window = sandbox; // hydra-webexport.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-webexport.js'), 'utf8'),
  sandbox, { filename: 'hydra-webexport.js' });
const W = sandbox.HydraWebExport;

check('HydraWebExport exposed with helpers',
  !!W && typeof W.extractAssets === 'function' && typeof W.buildZip === 'function' &&
  typeof W.buildManifest === 'function' && typeof W.buildServiceWorker === 'function' &&
  typeof W.injectPwa === 'function' && typeof W.drawIcon === 'function' &&
  typeof W.sanitizeFilename === 'function' && typeof W.parseDataUrl === 'function' &&
  typeof W.crc32 === 'function' && typeof W.utf8Bytes === 'function' &&
  typeof W.toBytes === 'function' &&
  typeof W.pwaCacheName === 'function');
check('factorySource is a self-contained function string',
  typeof W.factorySource === 'string' && W.factorySource.includes('hydraWebExportFactory'));

// --- sanitizeFilename ---
check('sanitize strips unsafe chars', W.sanitizeFilename('My Game: 2/2!') === 'My_Game_2_2', W.sanitizeFilename('My Game: 2/2!'));
check('sanitize collapses + trims', W.sanitizeFilename('__..hi..__') === 'hi', W.sanitizeFilename('__..hi..__'));
check('sanitize empty falls back', W.sanitizeFilename('') === 'file' && W.sanitizeFilename(null) === 'file');
check('sanitize caps length', W.sanitizeFilename('a'.repeat(200)).length <= 60);
check('sanitize keeps dots/dashes', W.sanitizeFilename('v1.2-final') === 'v1.2-final');

// --- mimeExtension ---
check('mimeExtension maps common types',
  W.mimeExtension('image/png') === 'png' && W.mimeExtension('image/jpeg') === 'jpg' &&
  W.mimeExtension('audio/mpeg') === 'mp3' && W.mimeExtension('audio/ogg') === 'ogg' &&
  W.mimeExtension('image/gif') === 'gif');
check('mimeExtension unknown -> bin', W.mimeExtension('application/x-foo') === 'bin' && W.mimeExtension('') === 'bin');

// --- parseDataUrl ---
const PNG1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
{
  const p = W.parseDataUrl(PNG1);
  // NOTE: no `instanceof Uint8Array` — the module runs in a vm sandbox with
  // its own constructor. Duck-type byte-likes everywhere.
  check('parseDataUrl decodes a PNG data URL',
    !!p && p.mime === 'image/png' && !!p.bytes && typeof p.bytes.length === 'number' &&
    p.bytes.length > 0 && p.bytes[0] === 0x89 && p.bytes[1] === 0x50, p && `${p.mime}/${p.bytes.length}`);
  check('parseDataUrl rejects garbage', W.parseDataUrl('not a url') === null);
  check('parseDataUrl hostile-safe',
    W.parseDataUrl(null) === null && W.parseDataUrl(42) === null && W.parseDataUrl('data:;base64,!!!') === null);
}

// --- extractAssets ---
const MP3 = 'data:audio/mpeg;base64,//uQxAAAA';
function webProject() {
  return {
    id: 'w1', name: 'Web Game',
    assets: {
      img1: { name: 'hero.png', kind: 'image', dataUrl: PNG1 },
      snd1: { name: 'jump.mp3', kind: 'audio', dataUrl: MP3 },
      gone: { name: 'gone.mp3', kind: 'audio' }, // no dataUrl: left alone
      dup: { name: 'hero.png', kind: 'image', dataUrl: PNG1 } // same display name as img1
    },
    scenes: []
  };
}
{
  const src = webProject();
  const ex = W.extractAssets(src);
  // img1, snd1, dup have data URLs (gone does not) -> 3 files
  check('extractAssets pulls 3 files into assets/', ex.files.length === 3 &&
    ex.files.every(f => f.path.indexOf('assets/') === 0), JSON.stringify(ex.files.map(f => f.path)));
  const imgFile = ex.files.find(f => f.path.endsWith('.png'));
  const expected = Buffer.from(PNG1.split(',')[1], 'base64');
  check('extracted bytes match the data URL',
    imgFile && imgFile.bytes.length === expected.length && Buffer.from(imgFile.bytes).equals(expected));
  check('project records rewritten to {file}', ex.project.assets.img1.file === 'hero.png' &&
    !('dataUrl' in ex.project.assets.img1) && ex.project.assets.snd1.file === 'jump.mp3',
    JSON.stringify(ex.project.assets.img1));
  check('dangling asset untouched', ex.project.assets.gone.name === 'gone.mp3' && !('file' in ex.project.assets.gone));
  check('duplicate display names deduped', ex.project.assets.dup.file !== ex.project.assets.img1.file,
    `${ex.project.assets.img1.file} vs ${ex.project.assets.dup.file}`);
  check('input project not mutated', typeof src.assets.img1.dataUrl === 'string' && !('file' in src.assets.img1));
  const empty = W.extractAssets(null);
  check('extractAssets hostile-safe', Array.isArray(empty.files) && empty.files.length === 0 &&
    typeof empty.project === 'object');
  const noAssets = W.extractAssets({ id: 'x' });
  check('extractAssets without assets table', noAssets.files.length === 0 && noAssets.project.id === 'x');
}

// --- crc32 ---
check('crc32 known vector', W.crc32(W.utf8Bytes('123456789')) === 0xCBF43926,
  W.crc32(W.utf8Bytes('123456789')).toString(16));

// --- utf8Bytes ---
{
  const b = W.utf8Bytes('Aé😀');
  check('utf8Bytes encodes multibyte', b.length === 1 + 2 + 4 && b[0] === 65 && b[1] === 0xC3 && b[2] === 0xA9,
    Array.from(b).join(','));
}

// --- buildZip + minimal reader ---
// Minimal stored-ZIP reader (test-only): returns [{name, bytes}] or throws.
function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = o => view.getUint16(o, true);
  const u32 = o => view.getUint32(o, true);
  if (u32(0) !== 0x04034b50 && !(bytes.length >= 22 && u32(bytes.length - 22) === 0x06054b50)) {
    throw new Error('not a zip');
  }
  // find EOCD (no comment written by buildZip, so it sits at the very end)
  const eocd = bytes.length - 22;
  if (u32(eocd) !== 0x06054b50) throw new Error('EOCD not found');
  const count = u16(eocd + 10);
  const centralOff = u32(eocd + 16);
  const out = [];
  let p = centralOff;
  const td = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (u32(p) !== 0x02014b50) throw new Error('bad central header');
    const method = u16(p + 10);
    const crc = u32(p + 16), compSize = u32(p + 20); // central header has an extra version field vs local
    const nameLen = u16(p + 28), extraLen = u16(p + 30), commentLen = u16(p + 32);
    const localOff = u32(p + 42);
    const nameBytes = bytes.slice(p + 46, p + 46 + nameLen);
    if (method !== 0) throw new Error('expected stored entry');
    if (u32(localOff) !== 0x04034b50) throw new Error('bad local header');
    const ln = u16(localOff + 26), le = u16(localOff + 28);
    const data = bytes.slice(localOff + 30 + ln + le, localOff + 30 + ln + le + compSize);
    if (W.crc32(data) !== crc) throw new Error('CRC mismatch for ' + td.decode(nameBytes));
    out.push({ name: td.decode(nameBytes), bytes: data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
{
  const files = [
    { path: 'index.html', bytes: W.utf8Bytes('<html>hi</html>') },
    { path: 'assets/hero.png', bytes: W.parseDataUrl(PNG1).bytes },
    { path: 'icons/icon-192.png', bytes: new Uint8Array([1, 2, 3]) }
  ];
  const zip = W.buildZip(files);
  // NOTE: no `instanceof Uint8Array` — the module runs in a vm sandbox with
  // its own constructor (same lesson as the audio-buses tests). Duck-type it.
  check('buildZip returns bytes with ZIP magic',
    !!zip && typeof zip.length === 'number' && typeof zip.slice === 'function' &&
    zip[0] === 0x50 && zip[1] === 0x4B && zip[2] === 0x03 && zip[3] === 0x04,
    `len=${zip && zip.length}`);
  const back = readZip(zip);
  check('zip round-trips all 3 files', back.length === 3, back.map(f => f.name).join(','));
  check('zip contents byte-identical',
    back.every((f, i) => f.name === files[i].path && Buffer.from(f.bytes).equals(Buffer.from(files[i].bytes))));
  const emptyZip = W.buildZip([]);
  const emptyBack = readZip(emptyZip);
  check('empty zip is valid with 0 entries', emptyBack.length === 0);
  const skipBad = W.buildZip(null);
  check('buildZip hostile-safe (null)', readZip(skipBad).length === 0);
  const skipEmpty = W.buildZip([{ path: '', bytes: new Uint8Array(1) }, { path: 'ok.txt', bytes: W.utf8Bytes('x') }]);
  const skipBack = readZip(skipEmpty);
  check('buildZip skips empty paths', skipBack.length === 1 && skipBack[0].name === 'ok.txt');
}

// --- pwaCacheName ---
check('pwaCacheName sanitized', W.pwaCacheName('My Cool Game!') === 'hydra-my-cool-game-v1',
  W.pwaCacheName('My Cool Game!'));

// --- buildManifest ---
{
  const m = JSON.parse(W.buildManifest({
    name: 'My Game', shortName: 'MG', themeColor: '#123456', backgroundColor: '#000000',
    icons: [{ path: 'icons/icon-192.png', sizes: '192x192' }, { path: 'icons/icon-512.png', sizes: '512x512' }]
  }));
  check('manifest has required PWA fields',
    m.name === 'My Game' && m.short_name === 'MG' && m.start_url === '.' && m.display === 'standalone' &&
    m.theme_color === '#123456' && m.icons.length === 2 && m.icons[0].src === 'icons/icon-192.png' &&
    m.icons[0].sizes === '192x192' && m.icons[0].type === 'image/png', JSON.stringify(m).slice(0, 120));
  check('manifest hostile-safe', JSON.parse(W.buildManifest(null)).name === 'Hydra Game');
}

// --- buildServiceWorker ---
{
  const sw = W.buildServiceWorker({
    cacheName: 'hydra-test-v1',
    paths: ['index.html', 'assets/hero.png', 'manifest.webmanifest', 'sw.js', 'icons/icon-192.png']
  });
  check('service worker has install/activate/fetch handlers',
    sw.includes("addEventListener('install'") && sw.includes("addEventListener('activate'") &&
    sw.includes("addEventListener('fetch'"));
  check('service worker precaches every path',
    ['index.html', 'assets/hero.png', 'manifest.webmanifest', 'sw.js', 'icons/icon-192.png']
      .every(p => sw.includes(JSON.stringify(p))), sw.slice(0, 200));
  check('service worker names the cache', sw.includes('hydra-test-v1'));
  check('service worker is GET-only + cache-first',
    sw.includes("event.request.method !== 'GET'") && sw.includes('caches.match'));
}

// --- injectPwa ---
{
  const html = '<!doctype html><html><head><title>G</title></head><body><p>x</p></body></html>';
  const out = W.injectPwa(html, { manifestPath: 'manifest.webmanifest', swPath: 'sw.js', themeColor: '#123456' });
  check('injectPwa adds manifest link + theme color',
    out.includes('<link rel="manifest" href="manifest.webmanifest">') &&
    out.includes('<meta name="theme-color" content="#123456">'));
  check('injectPwa registers the service worker', out.includes("navigator.serviceWorker.register('sw.js')"));
  check('injectPwa keeps the original page', out.includes('<title>G</title>') && out.includes('<p>x</p>'));
  const noHead = W.injectPwa('<p>bare</p>', {});
  check('injectPwa works without head/body', noHead.includes('rel="manifest"') && noHead.includes('serviceWorker'));
  check('injectPwa hostile-safe', W.injectPwa(null, null).includes('rel="manifest"'));
  // Regression: the exported runtime embeds template literals containing
  // their own </head> / </body> (retro-FPS template). Injection must target
  // the LAST occurrence, never mid-script.
  {
    const tricky = '<html><head><title>T</title></head><body>' +
      '<script>var tpl = "</head><body>inner</body>";</scr' + 'ipt>' +
      '<p>real</p></body></html>';
    const out = W.injectPwa(tricky, { swPath: 'sw.js' });
    check('injectPwa targets the last </body>, not one inside a script',
      out.indexOf('serviceWorker') > out.indexOf('inner</body>') &&
      out.indexOf('serviceWorker') < out.lastIndexOf('</body>'),
      out.slice(out.indexOf('serviceWorker') - 40, out.indexOf('serviceWorker') + 40));
    check('injectPwa targets the last </head>',
      out.indexOf('rel="manifest"') > out.indexOf('<title>T</title>'));
  }
}

// --- drawIcon ---
{
  const calls = [];
  const ctx = new Proxy({}, {
    get(t, p) {
      if (p === 'canvas') return null;
      return (...a) => { calls.push([p, ...a]); };
    },
    set(t, p, v) { calls.push(['set:' + p, v]); return true; }
  });
  check('drawIcon never throws on a recording ctx', (() => { W.drawIcon(ctx, 192, 'test game'); return true; })());
  const texts = calls.filter(c => c[0] === 'fillText');
  check('drawIcon paints the game initial', texts.length === 1 && texts[0][1] === 'T',
    JSON.stringify(texts.map(c => c[1])));
  check('drawIcon fills + strokes', calls.some(c => c[0] === 'fill') && calls.some(c => c[0] === 'stroke'));
  check('drawIcon hostile-safe', (() => { W.drawIcon(null, 0, null); W.drawIcon(ctx, -5, ''); return true; })());
}

if (failures) { console.error(`${failures} assertion(s) failed`); process.exit(1); }
console.log('webexport.test.js: all assertions passed');
