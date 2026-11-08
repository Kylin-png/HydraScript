/* ============================================================================
 * hydra-desktopexport.js — HydraScript shared desktop-target export helpers.
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation of
 * the P4 E2 desktop wrapper export (Electron + electron-builder project
 * generation) used by:
 *   - the editor export dialog (project.js drives it), and
 *   - exported-file assembly (player-runtime.js buildDesktopTarget delegates
 *     to these builders; the lazy load guard there throws a clear error when
 *     this module is missing, so existing export paths are unaffected).
 *
 * What it does:
 *   - sanitizePackageName / sanitizeAppId: npm-safe package names and
 *     reverse-domain app IDs from the game's display name.
 *   - buildPackageJson: a complete, buildable package.json — Electron shell
 *     scripts (`npm start` for dev, `npm run dist` for installers), pinned
 *     devDependencies, and an electron-builder config (appId, output dir,
 *     file whitelist, nsis/dmg/AppImage targets, Linux icon path).
 *   - buildMainJs: the Electron window shell (BrowserWindow sized to the
 *     scene, menu hidden, loads game/index.html, sane lifecycle hooks).
 *   - buildReadme: the guided checklist as markdown — what the engine
 *     generated, the exact commands to run, and what cannot be automated
 *     (Node required; the engine never signs or notarizes; branded icons
 *     are a user step because they need .ico/.icns conversion).
 *   - buildDesktopFiles: assembles the whole project file list —
 *     package.json, main.js, README.md, game/index.html, game/assets/*, and
 *     build/icon.png when PNG bytes are supplied. Every entry is a fresh
 *     Uint8Array (cross-realm safe for the vm-sandbox tests).
 *
 * Honesty rules baked in:
 *   - Binaries build on the user's machine (`npm run dist`); the browser
 *     cannot produce them.
 *   - The engine never pretends to sign or notarize. Unsigned builds show
 *     the OS's usual unknown-publisher warning; signing is the user's step.
 *   - Only a PNG icon ships (canvas-drawn from the game's name). Branded
 *     .ico/.icns files need conversion the engine cannot do here; the README
 *     explains the conventional filenames electron-builder picks up on its
 *     own (build/icon.ico, build/icon.icns).
 *
 * Load order (index.html): hydra-desktopexport.js BEFORE player-runtime.js
 * and project.js. Nothing here touches the DOM, so node tests can drive it
 * directly. It is editor-side only — unlike the gameplay modules it is never
 * inlined into exported games.
 * ========================================================================== */

function hydraDesktopExportFactory() {
  'use strict';

  // ---- byte helpers (self-contained; the module runs in vm sandboxes where
  // TextEncoder / foreign Uint8Arrays are unreliable) -----------------------

  // Copies any byte-like value (Uint8Array, Buffer, plain array — any realm)
  // into a fresh Uint8Array. Never uses instanceof.
  function toBytes(v) {
    try {
      if (v && typeof v.length === 'number') {
        var out = new Uint8Array(v.length);
        for (var i = 0; i < v.length; i++) out[i] = v[i] & 255;
        return out;
      }
    } catch (e) { /* fall through */ }
    return new Uint8Array(0);
  }

  function utf8Bytes(s) {
    s = String(s == null ? '' : s);
    var out = [], i, c;
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      if (c < 128) { out.push(c); continue; }
      if (c < 2048) { out.push(192 | (c >> 6), 128 | (c & 63)); continue; }
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
        var lo = s.charCodeAt(i + 1);
        if (lo >= 0xDC00 && lo <= 0xDFFF) {
          var cp = 0x10000 + ((c - 0xD800) << 10) + (lo - 0xDC00);
          out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63));
          i++;
          continue;
        }
      }
      out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
    }
    return new Uint8Array(out);
  }

  // ---- name helpers -------------------------------------------------------

  function displayName(name) {
    var s = String(name == null ? '' : name).replace(/[\r\n\t]+/g, ' ').trim();
    return s || 'Hydra Game';
  }

  // npm-safe package name: lowercase, only [a-z0-9-], capped at 60 chars.
  function sanitizePackageName(name) {
    var s = String(name == null ? '' : name).toLowerCase();
    s = s.replace(/[^a-z0-9._~-]+/g, '-');
    s = s.replace(/[-._~]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
    if (s.length > 60) s = s.slice(0, 60).replace(/[-.]+$/g, '');
    return s || 'hydra-game';
  }

  // Reverse-domain app ID from the package name (dots dropped so the ID is
  // one clean label per segment).
  function sanitizeAppId(name) {
    var pkg = sanitizePackageName(name).replace(/[.]+/g, '-');
    return 'com.hydrascript.' + pkg;
  }

  // Escape a JS single-quoted string literal (main.js title/comment).
  function escapeJs(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/[\r\n]+/g, ' ');
  }

  function validAppId(s) {
    return typeof s === 'string' && /^[A-Za-z][A-Za-z0-9._-]*$/.test(s.trim());
  }

  // ---- package.json -------------------------------------------------------

  // A complete, buildable package.json for the generated Electron project.
  // opts: { appId } — blank/invalid appId falls back to the sanitized one.
  function buildPackageJson(gameName, opts) {
    opts = opts || {};
    var name = displayName(gameName);
    var pkg = sanitizePackageName(name);
    var appId = validAppId(opts.appId) ? String(opts.appId).trim() : sanitizeAppId(name);
    var cfg = {
      name: pkg,
      productName: name,
      version: '1.0.0',
      description: name + ' — built with HydraScript.',
      main: 'main.js',
      scripts: {
        start: 'electron .',
        dist: 'electron-builder --win --mac --linux'
      },
      devDependencies: {
        electron: 'latest',
        'electron-builder': 'latest'
      },
      build: {
        appId: appId,
        productName: name,
        directories: { output: 'dist' },
        files: ['main.js', 'game/**/*', 'build/icon.png'],
        win: { target: ['nsis'] },
        mac: { target: ['dmg'] },
        linux: { target: ['AppImage'], icon: 'build/icon.png', category: 'Game' }
      }
    };
    return JSON.stringify(cfg, null, 2);
  }

  // ---- main.js ------------------------------------------------------------

  // The Electron window shell: window sized to the scene viewport (clamped),
  // menu hidden, loads game/index.html. opts: { width, height }.
  function buildMainJs(gameName, opts) {
    opts = opts || {};
    var name = displayName(gameName);
    var w = Math.round(Number(opts.width) || 960);
    var h = Math.round(Number(opts.height) || 640);
    w = Math.max(320, Math.min(4096, w));
    h = Math.max(240, Math.min(4096, h));
    return '// ' + escapeJs(name) + ' — Electron shell. Generated by the HydraScript editor.\n' +
      '// Run `npm install` once, then `npm start` to play or `npm run dist` for installers.\n' +
      "var electron = require('electron');\n" +
      "var app = electron.app;\n" +
      "var BrowserWindow = electron.BrowserWindow;\n" +
      "var path = require('path');\n" +
      '\n' +
      'function createWindow() {\n' +
      '  var win = new BrowserWindow({\n' +
      '    width: ' + w + ',\n' +
      '    height: ' + h + ',\n' +
      '    useContentSize: true,\n' +
      "    backgroundColor: '#0f172a',\n" +
      "    title: '" + escapeJs(name) + "',\n" +
      '    webPreferences: { nodeIntegration: false, contextIsolation: true }\n' +
      '  });\n' +
      '  win.setMenu(null);\n' +
      "  win.loadFile(path.join(__dirname, 'game', 'index.html'));\n" +
      '}\n' +
      '\n' +
      'app.whenReady().then(createWindow);\n' +
      "app.on('window-all-closed', function () {\n" +
      "  if (process.platform !== 'darwin') app.quit();\n" +
      '});\n' +
      "app.on('activate', function () {\n" +
      '  if (BrowserWindow.getAllWindows().length === 0) createWindow();\n' +
      '});\n';
  }

  // ---- README -------------------------------------------------------------

  // The guided checklist as markdown: what the engine generated, the exact
  // commands, and what cannot be automated (and why).
  function buildReadme(gameName, opts) {
    opts = opts || {};
    var name = displayName(gameName);
    var pkg = sanitizePackageName(name);
    return '# ' + name + ' — desktop app project\n' +
      '\n' +
      'Generated by the HydraScript editor. This is a complete Electron +\n' +
      'electron-builder project — no black boxes.\n' +
      '\n' +
      '## What the engine generated\n' +
      '\n' +
      '- `package.json` — app metadata, the Electron scripts, and the\n' +
      '  electron-builder config (appId `' + sanitizeAppId(name) + '`,\n' +
      '  Windows nsis / macOS dmg / Linux AppImage targets).\n' +
      '- `main.js` — the window shell. It opens a window sized to your scene\n' +
      '  and loads `game/index.html`. Edit it freely (window size, title).\n' +
      '- `game/` — your game: `index.html` plus an `assets/` folder. The game\n' +
      '  is the same engine that runs in the editor preview and the web\n' +
      '  exports, so what you tested is what players get.\n' +
      '- `build/icon.png` — a 512px icon drawn from your game name.\n' +
      '\n' +
      '## What you do\n' +
      '\n' +
      '1. Install Node.js if you do not have it (nodejs.org).\n' +
      '2. In this folder, run `npm install` — this downloads Electron (large,\n' +
      '   one time).\n' +
      '3. Run `npm start` to play the game in a desktop window.\n' +
      '4. Run `npm run dist` to build installers. They land in `dist/`:\n' +
      '   a Windows setup (.exe), a macOS disk image (.dmg), and a Linux\n' +
      '   AppImage. The build targets are one line each in package.json —\n' +
      '   change `build.win` / `build.mac` / `build.linux` for other formats\n' +
      '   (portable, zip, snap, deb, ...).\n' +
      '\n' +
      '## What cannot be automated (and why)\n' +
      '\n' +
      '- **Building the binary runs on your machine.** A browser cannot\n' +
      '  compile installers, so `npm run dist` is always your step.\n' +
      '- **The engine never signs or notarizes.** Unsigned builds still\n' +
      '  install and play, but Windows and macOS show their usual\n' +
      '  unknown-publisher warning. Signing needs your own certificate\n' +
      '  (Apple Developer for macOS, a code-signing cert for Windows) and\n' +
      '  must happen outside the editor.\n' +
      '- **Branded icons for Windows/macOS are your step.** Only a PNG ships\n' +
      '  here (`build/icon.png`, used for Linux). Convert it to\n' +
      '  `build/icon.ico` (Windows) and `build/icon.icns` (macOS) —\n' +
      '  electron-builder picks up those conventional filenames\n' +
      '  automatically. Without them the installers build fine but carry\n' +
      '  Electron\u2019s default icon.\n' +
      '\n' +
      'Package folder name if you rename it: `' + pkg + '`. Happy shipping.\n';
  }

  // ---- project assembly ---------------------------------------------------

  // opts: { gameName, appId, width, height, gameHtml,
  //         assetFiles: [{path, bytes}], iconBytes }
  // assetFiles use web-target paths (e.g. "assets/hero.png") and are placed
  // under game/. iconBytes (a 512px PNG) becomes build/icon.png when given.
  // Returns { files: [{path, bytes: Uint8Array}], gameName, packageName,
  //           appId }. Never throws.
  function buildDesktopFiles(opts) {
    var files = [];
    try {
      opts = opts || {};
      var name = displayName(opts.gameName);
      var appId = validAppId(opts.appId) ? String(opts.appId).trim() : sanitizeAppId(name);
      files.push({ path: 'package.json', bytes: utf8Bytes(buildPackageJson(name, { appId: appId })) });
      files.push({ path: 'main.js', bytes: utf8Bytes(buildMainJs(name, opts)) });
      files.push({ path: 'README.md', bytes: utf8Bytes(buildReadme(name, opts)) });
      files.push({ path: 'game/index.html', bytes: utf8Bytes(opts.gameHtml) });
      var assets = Array.isArray(opts.assetFiles) ? opts.assetFiles : [];
      assets.forEach(function (f) {
        if (!f || typeof f !== 'object') return;
        var p = String(f.path == null ? '' : f.path).replace(/\\/g, '/').replace(/^\/+/, '');
        if (!p) return;
        files.push({ path: 'game/' + p, bytes: toBytes(f.bytes) });
      });
      if (opts.iconBytes && typeof opts.iconBytes.length === 'number' && opts.iconBytes.length > 0) {
        files.push({ path: 'build/icon.png', bytes: toBytes(opts.iconBytes) });
      }
      return {
        files: files,
        gameName: name,
        packageName: sanitizePackageName(name),
        appId: appId
      };
    } catch (e) {
      return { files: files, gameName: 'Hydra Game', packageName: 'hydra-game', appId: 'com.hydrascript.hydra-game' };
    }
  }

  return {
    displayName: displayName,
    sanitizePackageName: sanitizePackageName,
    sanitizeAppId: sanitizeAppId,
    buildPackageJson: buildPackageJson,
    buildMainJs: buildMainJs,
    buildReadme: buildReadme,
    buildDesktopFiles: buildDesktopFiles,
    utf8Bytes: utf8Bytes,
    toBytes: toBytes
  };
}

window.HydraDesktopExport = hydraDesktopExportFactory();
// Self-contained source of the factory, following the hydra-*.js pattern so
// editor code and tests can rehydrate it anywhere.
window.HydraDesktopExport.factorySource = hydraDesktopExportFactory.toString();
