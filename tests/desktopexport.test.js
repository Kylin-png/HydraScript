// Unit tests for hydra/hydra-desktopexport.js — the P4 E2 desktop wrapper
// (Electron + electron-builder project generation).
//
// Pure logic: package/app-id sanitizing, package.json / main.js / README
// builders, and full project-file assembly (verified through a HydraWebExport
// ZIP round-trip with a minimal reader below). Nothing here touches the DOM.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const sandbox = {};
sandbox.window = sandbox; // hydra-desktopexport.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-desktopexport.js'), 'utf8'),
  sandbox, { filename: 'hydra-desktopexport.js' });
const D = sandbox.HydraDesktopExport;

check('HydraDesktopExport exposed with builders',
  !!D && typeof D.sanitizePackageName === 'function' && typeof D.sanitizeAppId === 'function' &&
  typeof D.buildPackageJson === 'function' && typeof D.buildMainJs === 'function' &&
  typeof D.buildReadme === 'function' && typeof D.buildDesktopFiles === 'function');
check('factorySource is a self-contained function string',
  typeof D.factorySource === 'string' && D.factorySource.includes('hydraDesktopExportFactory'));

// --- sanitizePackageName ---
check('package name is npm-safe', D.sanitizePackageName('My Cool Game: 2!') === 'my-cool-game-2',
  D.sanitizePackageName('My Cool Game: 2!'));
check('package name empty falls back', D.sanitizePackageName('') === 'hydra-game' && D.sanitizePackageName(null) === 'hydra-game');
check('package name caps length', D.sanitizePackageName('a'.repeat(200)).length <= 60);

// --- sanitizeAppId ---
check('app id is reverse-domain from the name',
  D.sanitizeAppId('My Cool Game') === 'com.hydrascript.my-cool-game', D.sanitizeAppId('My Cool Game'));

// --- buildPackageJson ---
{
  const text = D.buildPackageJson('My Cool Game', {});
  let cfg = null, err = null;
  try { cfg = JSON.parse(text); } catch (e) { err = e; }
  check('package.json parses as JSON', !!cfg && err === null, err && err.message);
  check('package.json names the game + package',
    cfg && cfg.name === 'my-cool-game' && cfg.productName === 'My Cool Game' &&
    cfg.main === 'main.js' && cfg.version === '1.0.0', cfg && cfg.name);
  check('package.json scripts run Electron + electron-builder',
    cfg && cfg.scripts.start === 'electron .' && /electron-builder/.test(cfg.scripts.dist),
    cfg && JSON.stringify(cfg.scripts));
  check('package.json has electron devDependencies',
    cfg && cfg.devDependencies && 'electron' in cfg.devDependencies && 'electron-builder' in cfg.devDependencies);
  check('package.json build config: appId, output dir, targets',
    cfg && cfg.build && cfg.build.appId === 'com.hydrascript.my-cool-game' &&
    cfg.build.directories.output === 'dist' &&
    Array.isArray(cfg.build.win.target) && cfg.build.win.target.includes('nsis') &&
    Array.isArray(cfg.build.mac.target) && cfg.build.mac.target.includes('dmg') &&
    Array.isArray(cfg.build.linux.target) && cfg.build.linux.target.includes('AppImage') &&
    cfg.build.linux.icon === 'build/icon.png',
    cfg && JSON.stringify(cfg.build));
  check('package.json files whitelist covers the payload',
    cfg && Array.isArray(cfg.build.files) && cfg.build.files.includes('main.js') &&
    cfg.build.files.includes('game/**/*') && cfg.build.files.includes('build/icon.png'));
  // custom appId passthrough + invalid appId repair
  const custom = JSON.parse(D.buildPackageJson('G', { appId: 'com.example.g' }));
  check('custom appId honored', custom.build.appId === 'com.example.g');
  const repaired = JSON.parse(D.buildPackageJson('G', { appId: 'not an id!!' }));
  check('invalid appId repaired to sanitized default', repaired.build.appId === 'com.hydrascript.g');
  check('buildPackageJson hostile-safe',
    typeof D.buildPackageJson(null, null) === 'string' && typeof D.buildPackageJson(undefined) === 'string');
}

// --- buildMainJs ---
{
  const src = D.buildMainJs('My Cool Game', { width: 1024, height: 768 });
  check('main.js requires Electron + creates a window',
    src.includes("require('electron')") && src.includes('BrowserWindow') && src.includes('createWindow'));
  check('main.js loads game/index.html and hides the menu',
    src.includes("loadFile(path.join(__dirname, 'game', 'index.html'))") && src.includes('setMenu(null)'));
  check('main.js sizes the window to the scene',
    src.includes('width: 1024') && src.includes('height: 768'), src.split('\n').slice(6, 10).join(' '));
  check('main.js keeps web security on',
    src.includes('nodeIntegration: false') && src.includes('contextIsolation: true'));
  check('main.js handles macOS activate + window-all-closed',
    src.includes("process.platform !== 'darwin'") && src.includes("on('activate'"));
  const evil = D.buildMainJs("Game'); console.log('xss", {});
  check('main.js escapes quotes in the title', !evil.includes("console.log('xss"),
    evil.split('\n').find(l => l.includes('title')));
  const clamped = D.buildMainJs('G', { width: 10, height: 99999 });
  check('main.js clamps window size', clamped.includes('width: 320') && clamped.includes('height: 4096'));
  check('buildMainJs hostile-safe', typeof D.buildMainJs(null, null) === 'string');
}

// --- buildReadme ---
{
  const md = D.buildReadme('My Cool Game', {});
  check('README covers the guided checklist',
    md.includes('npm install') && md.includes('npm run dist') && md.includes('npm start') &&
    md.includes('What the engine generated') && md.includes('What you do') &&
    md.includes('What cannot be automated'));
  check('README is honest about signing/notarizing',
    md.includes('never signs or notarizes') && md.includes('unknown-publisher'));
  check('README is honest about branded icons',
    md.includes('build/icon.ico') && md.includes('build/icon.icns') && md.includes('electron-builder picks up'));
  check('buildReadme hostile-safe', typeof D.buildReadme(null) === 'string');
}

// --- buildDesktopFiles ---
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
{
  const r = D.buildDesktopFiles({
    gameName: 'My Cool Game',
    width: 1024, height: 768,
    gameHtml: '<html>game</html>',
    assetFiles: [{ path: 'assets/hero.png', bytes: PNG_BYTES }],
    iconBytes: PNG_BYTES
  });
  const names = r.files.map(f => f.path);
  check('project has package.json, main.js, README, game/index.html, assets, icon',
    ['package.json', 'main.js', 'README.md', 'game/index.html', 'game/assets/hero.png', 'build/icon.png']
      .every(n => names.includes(n)), names.join(','));
  check('file list metadata reports name + appId',
    r.gameName === 'My Cool Game' && r.packageName === 'my-cool-game' &&
    r.appId === 'com.hydrascript.my-cool-game', JSON.stringify({ gameName: r.gameName, packageName: r.packageName, appId: r.appId }));
  check('every file carries fresh byte arrays (no instanceof)',
    r.files.every(f => f && typeof f.bytes === 'object' && typeof f.bytes.length === 'number' &&
      typeof f.bytes.slice === 'function'),
    r.files.map(f => f.path + ':' + (f.bytes && f.bytes.length)).join(', '));
  const htmlFile = r.files.find(f => f.path === 'game/index.html');
  check('game HTML lands byte-identical',
    Buffer.from(htmlFile.bytes).equals(Buffer.from('<html>game</html>', 'utf8')));
  const iconFile = r.files.find(f => f.path === 'build/icon.png');
  check('icon PNG lands byte-identical', Buffer.from(iconFile.bytes).equals(Buffer.from(PNG_BYTES)));
  const assetFile = r.files.find(f => f.path === 'game/assets/hero.png');
  check('asset bytes preserved', Buffer.from(assetFile.bytes).equals(Buffer.from(PNG_BYTES)));
  // no icon supplied -> no icon file, project still complete
  const noIcon = D.buildDesktopFiles({ gameName: 'G', gameHtml: '<html></html>' });
  check('no icon when iconBytes omitted',
    !noIcon.files.some(f => f.path === 'build/icon.png') &&
    noIcon.files.some(f => f.path === 'game/index.html'));
  // hostile input never throws and always returns a file list
  let hostileOk = true;
  try {
    [['null', null], ['empty', {}], ['garbage', { gameName: 123, assetFiles: 'x', iconBytes: 'x', gameHtml: {} }]]
      .forEach(([label, opts]) => {
        const out = D.buildDesktopFiles(opts);
        if (!out || !Array.isArray(out.files) || !out.files.some(f => f.path === 'game/index.html')) {
          hostileOk = false;
        }
      });
  } catch (e) { hostileOk = false; }
  check('buildDesktopFiles hostile-safe', hostileOk);
}

// --- ZIP round-trip through HydraWebExport.buildZip ---
// Minimal stored-ZIP reader (test-only): returns [{name, bytes}] or throws.
function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = o => view.getUint16(o, true);
  const u32 = o => view.getUint32(o, true);
  if (bytes.length < 22 || u32(bytes.length - 22) !== 0x06054b50) throw new Error('EOCD not found');
  const eocd = bytes.length - 22;
  const count = u16(eocd + 10);
  const centralOff = u32(eocd + 16);
  const out = [];
  let p = centralOff;
  const td = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (u32(p) !== 0x02014b50) throw new Error('bad central header');
    const method = u16(p + 10);
    const crc = u32(p + 16), compSize = u32(p + 20);
    const nameLen = u16(p + 28), extraLen = u16(p + 30), commentLen = u16(p + 32);
    const localOff = u32(p + 42);
    const nameBytes = bytes.slice(p + 46, p + 46 + nameLen);
    if (method !== 0) throw new Error('expected stored entry');
    const ln = u16(localOff + 26), le = u16(localOff + 28);
    const data = bytes.slice(localOff + 30 + ln + le, localOff + 30 + ln + le + compSize);
    out.push({ name: td.decode(nameBytes), bytes: data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
{
  const wsb = {};
  wsb.window = wsb;
  vm.createContext(wsb);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-webexport.js'), 'utf8'),
    wsb, { filename: 'hydra-webexport.js' });
  const WE = wsb.HydraWebExport;
  const r = D.buildDesktopFiles({ gameName: 'Zip Game', gameHtml: '<html>g</html>', iconBytes: PNG_BYTES });
  const zip = WE.buildZip(r.files);
  const back = readZip(zip);
  const names = back.map(f => f.name);
  check('desktop project zips + round-trips through buildZip',
    names.includes('package.json') && names.includes('main.js') && names.includes('README.md') &&
    names.includes('game/index.html') && names.includes('build/icon.png'), names.join(','));
  const pkgBack = back.find(f => f.name === 'package.json');
  check('package.json parses after the zip round-trip',
    (() => { try { return JSON.parse(Buffer.from(pkgBack.bytes).toString('utf8')).main === 'main.js'; } catch (e) { return false; } })());
}

if (failures) { console.error(`${failures} assertion(s) failed`); process.exit(1); }
console.log('desktopexport.test.js: all assertions passed');
