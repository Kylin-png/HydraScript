// Unit tests for hydra/hydra-mobileexport.js — the P4 E3 mobile wrapper
// (Capacitor project generation for Android + iOS).
//
// Pure logic: package/app-id sanitizing, package.json / capacitor.config.json
// / README builders, and full project-file assembly (verified through a
// HydraWebExport ZIP round-trip with a minimal reader below). Nothing here
// touches the DOM.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const sandbox = {};
sandbox.window = sandbox; // hydra-mobileexport.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-mobileexport.js'), 'utf8'),
  sandbox, { filename: 'hydra-mobileexport.js' });
const M = sandbox.HydraMobileExport;

check('HydraMobileExport exposed with builders',
  !!M && typeof M.sanitizePackageName === 'function' && typeof M.sanitizeMobileAppId === 'function' &&
  typeof M.buildPackageJson === 'function' && typeof M.buildCapacitorConfig === 'function' &&
  typeof M.buildReadme === 'function' && typeof M.buildMobileFiles === 'function');
check('factorySource is a self-contained function string',
  typeof M.factorySource === 'string' && M.factorySource.includes('hydraMobileExportFactory'));

// --- sanitizeMobileAppId ---
check('app id is reverse-domain from the name',
  M.sanitizeMobileAppId('My Cool Game') === 'com.hydrascript.mycoolgame', M.sanitizeMobileAppId('My Cool Game'));
check('app id strips dashes (Android forbids them)',
  M.sanitizeMobileAppId('my-cool-game') === 'com.hydrascript.mycoolgame', M.sanitizeMobileAppId('my-cool-game'));
check('app id strips leading digits (segments must start with a letter)',
  M.sanitizeMobileAppId('2 Fast 2 Furious') === 'com.hydrascript.fast2furious', M.sanitizeMobileAppId('2 Fast 2 Furious'));
check('app id empty falls back', M.sanitizeMobileAppId('') === 'com.hydrascript.hydragame');
check('validMobileAppId accepts dotted segments', M.validMobileAppId('com.example.game'));
check('validMobileAppId rejects dashes + missing dot',
  !M.validMobileAppId('com.example.my-game') && !M.validMobileAppId('singlelabel'));

// --- buildPackageJson ---
{
  const text = M.buildPackageJson('My Cool Game', {});
  let cfg = null, err = null;
  try { cfg = JSON.parse(text); } catch (e) { err = e; }
  check('package.json parses as JSON', !!cfg && err === null, err && err.message);
  check('package.json names the game + package',
    cfg && cfg.name === 'my-cool-game' && cfg.productName === 'My Cool Game' &&
    cfg.version === '1.0.0', cfg && cfg.name);
  check('package.json has the Capacitor lockstep deps',
    cfg && cfg.dependencies && '@capacitor/core' in cfg.dependencies &&
    '@capacitor/cli' in cfg.dependencies && '@capacitor/android' in cfg.dependencies &&
    '@capacitor/ios' in cfg.dependencies, cfg && JSON.stringify(cfg.dependencies));
  check('package.json has @capacitor/assets for icon/splash generation',
    cfg && cfg.devDependencies && '@capacitor/assets' in cfg.devDependencies);
  check('package.json scripts: sync + open android/ios + debug APK',
    cfg && cfg.scripts.sync === 'cap sync' &&
    cfg.scripts['open:android'] === 'cap open android' &&
    cfg.scripts['open:ios'] === 'cap open ios' &&
    /gradlew assembleDebug/.test(cfg.scripts['build:apk']),
    cfg && JSON.stringify(cfg.scripts));
  check('buildPackageJson hostile-safe',
    typeof M.buildPackageJson(null, null) === 'string' && typeof M.buildPackageJson(undefined) === 'string');
}

// --- buildCapacitorConfig ---
{
  const text = M.buildCapacitorConfig('My Cool Game', {});
  let cfg = null, err = null;
  try { cfg = JSON.parse(text); } catch (e) { err = e; }
  check('capacitor.config.json parses as JSON', !!cfg && err === null, err && err.message);
  check('capacitor config: appId, appName, webDir www',
    cfg && cfg.appId === 'com.hydrascript.mycoolgame' && cfg.appName === 'My Cool Game' &&
    cfg.webDir === 'www', cfg && JSON.stringify({ appId: cfg.appId, appName: cfg.appName, webDir: cfg.webDir }));
  check('capacitor config carries android + ios sections',
    cfg && typeof cfg.android === 'object' && typeof cfg.ios === 'object');
  const custom = JSON.parse(M.buildCapacitorConfig('G', { appId: 'com.example.g' }));
  check('custom appId honored', custom.appId === 'com.example.g');
  const repaired = JSON.parse(M.buildCapacitorConfig('G', { appId: 'not an id!!' }));
  check('invalid appId repaired to sanitized default', repaired.appId === 'com.hydrascript.g');
  check('buildCapacitorConfig hostile-safe', typeof M.buildCapacitorConfig(null, null) === 'string');
}

// --- buildReadme ---
{
  const md = M.buildReadme('My Cool Game', {});
  check('README covers the guided checklist',
    md.includes('npx cap add android') && md.includes('npx cap sync') &&
    md.includes('gradlew assembleDebug') && md.includes('What the engine generated') &&
    md.includes('What cannot be automated'));
  check('README documents icons/splash + manifest prefs',
    md.includes('capacitor-assets generate') && md.includes('resources/icon.png') &&
    md.includes('resources/splash.png') && md.includes('screenOrientation') &&
    md.includes('Theme.NoTitleBar.Fullscreen'), md.slice(0, 200));
  check('README is honest about native projects generating on the user machine',
    md.includes('npx cap add') && md.includes('your machine'));
  check('README is honest about the Play Store signing key',
    md.includes('signing key') && md.includes('keystore'));
  check('README is honest that iOS requires macOS + Xcode',
    md.includes('macOS') && md.includes('Xcode') && md.includes('.ipa'));
  check('README mentions the iOS flow (cap add ios / open ios)',
    md.includes('npx cap add ios') && md.includes('npx cap open ios'));
  check('buildReadme hostile-safe', typeof M.buildReadme(null) === 'string');
}

// --- buildMobileFiles ---
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
{
  const r = M.buildMobileFiles({
    gameName: 'My Cool Game',
    gameHtml: '<html>game</html>',
    assetFiles: [{ path: 'assets/hero.png', bytes: PNG_BYTES }],
    iconBytes: PNG_BYTES,
    splashBytes: PNG_BYTES
  });
  const names = r.files.map(f => f.path);
  check('project has package.json, capacitor.config.json, README, www/index.html, assets, icon, splash',
    ['package.json', 'capacitor.config.json', 'README.md', 'www/index.html', 'www/assets/hero.png',
     'resources/icon.png', 'resources/splash.png'].every(n => names.includes(n)), names.join(','));
  check('file list metadata reports name + appId',
    r.gameName === 'My Cool Game' && r.packageName === 'my-cool-game' &&
    r.appId === 'com.hydrascript.mycoolgame', JSON.stringify({ gameName: r.gameName, packageName: r.packageName, appId: r.appId }));
  check('every file carries fresh byte arrays (no instanceof)',
    r.files.every(f => f && typeof f.bytes === 'object' && typeof f.bytes.length === 'number' &&
      typeof f.bytes.slice === 'function'),
    r.files.map(f => f.path + ':' + (f.bytes && f.bytes.length)).join(', '));
  const htmlFile = r.files.find(f => f.path === 'www/index.html');
  check('game HTML lands byte-identical',
    Buffer.from(htmlFile.bytes).equals(Buffer.from('<html>game</html>', 'utf8')));
  const iconFile = r.files.find(f => f.path === 'resources/icon.png');
  check('icon PNG lands byte-identical', Buffer.from(iconFile.bytes).equals(Buffer.from(PNG_BYTES)));
  const splashFile = r.files.find(f => f.path === 'resources/splash.png');
  check('splash PNG lands byte-identical', Buffer.from(splashFile.bytes).equals(Buffer.from(PNG_BYTES)));
  const assetFile = r.files.find(f => f.path === 'www/assets/hero.png');
  check('asset bytes preserved under www/', Buffer.from(assetFile.bytes).equals(Buffer.from(PNG_BYTES)));
  // no resources supplied -> no resource files, project still complete
  const noRes = M.buildMobileFiles({ gameName: 'G', gameHtml: '<html></html>' });
  check('no resources when iconBytes/splashBytes omitted',
    !noRes.files.some(f => f.path === 'resources/icon.png') &&
    !noRes.files.some(f => f.path === 'resources/splash.png') &&
    noRes.files.some(f => f.path === 'www/index.html'));
  // hostile input never throws and always returns a file list
  let hostileOk = true;
  try {
    [['null', null], ['empty', {}], ['garbage', { gameName: 123, assetFiles: 'x', iconBytes: 'x', splashBytes: 'x', gameHtml: {} }]]
      .forEach(([label, opts]) => {
        const out = M.buildMobileFiles(opts);
        if (!out || !Array.isArray(out.files) || !out.files.some(f => f.path === 'www/index.html')) {
          hostileOk = false;
        }
      });
  } catch (e) { hostileOk = false; }
  check('buildMobileFiles hostile-safe', hostileOk);
}

// --- ZIP round-trip through HydraWebExport.buildZip ---
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
    const compSize = u32(p + 20);
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
  const r = M.buildMobileFiles({ gameName: 'Zip Game', gameHtml: '<html>g</html>', iconBytes: PNG_BYTES, splashBytes: PNG_BYTES });
  const zip = WE.buildZip(r.files);
  const back = readZip(zip);
  const names = back.map(f => f.name);
  check('mobile project zips + round-trips through buildZip',
    names.includes('package.json') && names.includes('capacitor.config.json') &&
    names.includes('README.md') && names.includes('www/index.html') &&
    names.includes('resources/icon.png') && names.includes('resources/splash.png'), names.join(','));
  const capBack = back.find(f => f.name === 'capacitor.config.json');
  check('capacitor.config.json parses after the zip round-trip',
    (() => { try { return JSON.parse(Buffer.from(capBack.bytes).toString('utf8')).webDir === 'www'; } catch (e) { return false; } })());
  const pkgBack = back.find(f => f.name === 'package.json');
  check('package.json parses after the zip round-trip',
    (() => { try { return '@capacitor/core' in JSON.parse(Buffer.from(pkgBack.bytes).toString('utf8')).dependencies; } catch (e) { return false; } })());
}

if (failures) { console.error(`${failures} assertion(s) failed`); process.exit(1); }
console.log('mobileexport.test.js: all assertions passed');
