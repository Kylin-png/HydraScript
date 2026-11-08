/* ============================================================================
 * hydra-mobileexport.js — HydraScript shared mobile-target export helpers.
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation of
 * the P4 E3 mobile wrapper export (Capacitor project generation for
 * Android + iOS) used by:
 *   - the editor export dialog (project.js drives it), and
 *   - exported-file assembly (player-runtime.js buildMobileTarget delegates
 *     to these builders; the lazy load guard there throws a clear error when
 *     this module is missing, so existing export paths are unaffected).
 *
 * What it does:
 *   - sanitizePackageName / sanitizeMobileAppId: npm-safe package names and
 *     Android-valid application IDs (each dot-segment starts with a letter,
 *     letters/digits/underscores only — dashes are NOT allowed in an
 *     Android applicationId).
 *   - buildPackageJson: a complete, buildable package.json — Capacitor
 *     deps (@capacitor/core + @capacitor/cli + @capacitor/android +
 *     @capacitor/ios, resolved in lockstep at install), @capacitor/assets
 *     for icon/splash generation, and honest scripts (sync, open android /
 *     ios, debug APK via gradlew).
 *   - buildCapacitorConfig: capacitor.config.json (appId, appName, webDir
 *     'www', background colors, iOS content inset) — plain JSON on purpose
 *     so a beginner can read every line without touching TypeScript.
 *   - buildReadme: the guided checklist as markdown — what the engine
 *     generated, the exact commands to run (npx cap add android / sync /
 *     gradlew assembleDebug), copy-paste AndroidManifest prefs (orientation,
 *     fullscreen) and the splash/icon pipeline, and what cannot be
 *     automated (native projects generate on the user's machine; Play Store
 *     release needs the user's own signing key; an iOS binary REQUIRES
 *     macOS + Xcode).
 *   - buildMobileFiles: assembles the whole project file list —
 *     package.json, capacitor.config.json, README.md, www/index.html,
 *     www/assets/*, and resources/icon.png + resources/splash.png when PNG
 *     bytes are supplied. Every entry is a fresh Uint8Array (cross-realm
 *     safe for the vm-sandbox tests).
 *
 * Honesty rules baked in:
 *   - The native Android/iOS projects do NOT ship in the ZIP — they are
 *     created on the user's machine by `npx cap add android|ios`, because
 *     they contain machine-specific Gradle/Xcode state a browser cannot
 *     and should not generate.
 *   - A debug APK is free and needs no signing; a Play Store release needs
 *     the user's own signing key — the engine never pretends to sign.
 *   - iOS is honest to the bone: the engine produces the full iOS project,
 *     but Apple only builds the binary on macOS with Xcode.
 *
 * Load order (index.html): hydra-mobileexport.js BEFORE player-runtime.js
 * and project.js. Nothing here touches the DOM, so node tests can drive it
 * directly. It is editor-side only — unlike the gameplay modules it is never
 * inlined into exported games.
 * ========================================================================== */

function hydraMobileExportFactory() {
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

  // Android applicationId: dot-separated segments, each starting with a
  // letter, letters/digits/underscores only. Dashes are NOT allowed.
  // Derived from the package name with dashes dropped and leading digits
  // stripped so the final segment is always valid.
  function sanitizeMobileAppId(name) {
    var label = sanitizePackageName(name).replace(/[^a-z0-9]/g, '');
    label = label.replace(/^[0-9]+/, '');
    if (!label) label = 'hydragame';
    return 'com.hydrascript.' + label;
  }

  // Valid when every dot-segment starts with a letter and holds only
  // letters, digits, and underscores, with at least two segments (Android
  // requires at least one dot). iOS bundle IDs follow the same shape.
  function validMobileAppId(s) {
    return typeof s === 'string' &&
      /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(s.trim());
  }

  // Escape a JS double-quoted string literal (capacitor.config.json sits
  // in JSON; the README shows the appId in shell snippets).
  function escapeShell(s) {
    return String(s == null ? '' : s).replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ');
  }

  // ---- package.json -------------------------------------------------------

  // A complete, buildable package.json for the generated Capacitor project.
  // opts: { appId } — blank/invalid appId falls back to the sanitized one.
  function buildPackageJson(gameName, opts) {
    opts = opts || {};
    var name = displayName(gameName);
    var pkg = sanitizePackageName(name);
    var cfg = {
      name: pkg,
      productName: name,
      version: '1.0.0',
      description: name + ' — built with HydraScript.',
      scripts: {
        sync: 'cap sync',
        'open:android': 'cap open android',
        'open:ios': 'cap open ios',
        'build:apk': 'cd android && ./gradlew assembleDebug'
      },
      dependencies: {
        '@capacitor/android': 'latest',
        '@capacitor/cli': 'latest',
        '@capacitor/core': 'latest',
        '@capacitor/ios': 'latest'
      },
      devDependencies: {
        '@capacitor/assets': 'latest'
      }
    };
    return JSON.stringify(cfg, null, 2);
  }

  // ---- capacitor.config.json ----------------------------------------------

  // Plain JSON on purpose: no TypeScript toolchain, every line readable.
  // opts: { appId } — blank/invalid appId falls back to the sanitized one.
  function buildCapacitorConfig(gameName, opts) {
    opts = opts || {};
    var name = displayName(gameName);
    var appId = validMobileAppId(opts.appId) ? String(opts.appId).trim() : sanitizeMobileAppId(name);
    var cfg = {
      appId: appId,
      appName: name,
      webDir: 'www',
      backgroundColor: '#0f172a',
      android: {
        backgroundColor: '#0f172a',
        allowMixedContent: false
      },
      ios: {
        backgroundColor: '#0f172a',
        contentInset: 'always'
      }
    };
    return JSON.stringify(cfg, null, 2);
  }

  // ---- README -------------------------------------------------------------

  // The guided checklist as markdown: what the engine generated, the exact
  // commands, copy-paste Android prefs, and what cannot be automated (and
  // why).
  function buildReadme(gameName, opts) {
    opts = opts || {};
    var name = displayName(gameName);
    var pkg = sanitizePackageName(name);
    var appId = validMobileAppId(opts.appId) ? String(opts.appId).trim() : sanitizeMobileAppId(name);
    return '# ' + name + ' — mobile app project\n' +
      '\n' +
      'Generated by the HydraScript editor. This is a complete Capacitor\n' +
      'project — no black boxes. Capacitor wraps your game (the `www/`\n' +
      'folder) in a real native Android / iOS app.\n' +
      '\n' +
      '## What the engine generated\n' +
      '\n' +
      '- `package.json` — Capacitor dependencies (`@capacitor/core` +\n' +
      '  `@capacitor/cli` + `@capacitor/android` + `@capacitor/ios`, all\n' +
      '  resolved to one consistent version when you install) and\n' +
      '  `@capacitor/assets` for icon/splash generation. Scripts: `npm run\n' +
      '  sync`, `npm run open:android`, `npm run open:ios`, `npm run\n' +
      '  build:apk`.\n' +
      '- `capacitor.config.json` — your appId `' + escapeShell(appId) + '`,\n' +
      '  app name, and `webDir: "www"`. Plain JSON so you can read every\n' +
      '  line without touching TypeScript.\n' +
      '- `www/` — your game: `index.html` plus an `assets/` folder. The\n' +
      '  game is the same engine that runs in the editor preview and the\n' +
      '  web exports, so what you tested is what players get.\n' +
      '- `resources/icon.png` — a 1024px icon drawn from your game name.\n' +
      '- `resources/splash.png` — a launch-screen image drawn from your\n' +
      '  game name.\n' +
      '\n' +
      'The `android/` and `ios/` native folders are NOT in this ZIP on\n' +
      'purpose: they contain machine-specific Gradle/Xcode state, so\n' +
      'Capacitor creates them on your machine with `npx cap add`.\n' +
      '\n' +
      '## Android: from this folder to a debug APK\n' +
      '\n' +
      '1. Install Node.js (nodejs.org) and the Android SDK (Android\n' +
      '   Studio installs both).\n' +
      '2. In this folder, run `npm install`.\n' +
      '3. Run `npx cap add android` — this creates the `android/` folder.\n' +
      '4. Run `npx cap sync` — this copies `www/` into the native project.\n' +
      '   Run it again every time you change the game.\n' +
      '5. Build the debug APK: `cd android && ./gradlew assembleDebug`\n' +
      '   (Windows: `gradlew.bat assembleDebug`). The APK lands at\n' +
      '   `android/app/build/outputs/apk/debug/app-debug.apk` — copy it to\n' +
      '   your phone and install it. A debug APK is free and needs no\n' +
      '   signing key.\n' +
      '\n' +
      '## Android: icons, splash, orientation, fullscreen\n' +
      '\n' +
      '- Icons + splash (the easy way): after `npx cap add android`, run\n' +
      '  `npx capacitor-assets generate` in this folder. It reads\n' +
      '  `resources/icon.png` and `resources/splash.png` and writes every\n' +
      '  Android density automatically.\n' +
      '- Lock orientation: open `android/app/src/main/AndroidManifest.xml`\n' +
      '  and add `android:screenOrientation="portrait"` (or `"landscape"`)\n' +
      '  to the `<activity>` tag.\n' +
      '- Fullscreen (hide the status bar): in the same `<activity>` tag,\n' +
      '  set `android:theme="@android:style/Theme.NoTitleBar.Fullscreen"`.\n' +
      '\n' +
      '## iOS\n' +
      '\n' +
      '1. On a Mac with Xcode installed, in this folder run `npm install`.\n' +
      '2. Run `npx cap add ios`, then `npx cap sync`.\n' +
      '3. Run `npx cap open ios` and build from Xcode.\n' +
      '\n' +
      '## What cannot be automated (and why)\n' +
      '\n' +
      '- **The native projects generate on your machine.** `npx cap add`\n' +
      '  needs your SDK / Xcode installation, so a browser cannot do it.\n' +
      '- **A Play Store release needs your own signing key.** Debug APKs\n' +
      '  install freely, but publishing requires a keystore you create\n' +
      '  yourself (`keytool`) and a signed release build — Google ties the\n' +
      '  listing to your key, so the engine never pretends to sign.\n' +
      '- **An iOS binary REQUIRES macOS + Xcode.** The engine produces the\n' +
      '  complete iOS project (`npx cap add ios` makes it on your Mac), but\n' +
      '  only Apple\u2019s toolchain on a Mac can build and sign the .ipa.\n' +
      '  There is no way around this — it is Apple\u2019s rule, not the\n' +
      '  engine\u2019s.\n' +
      '\n' +
      'Package folder name if you rename it: `' + pkg + '`. Happy shipping.\n';
  }

  // ---- project assembly ---------------------------------------------------

  // opts: { gameName, appId, gameHtml,
  //         assetFiles: [{path, bytes}], iconBytes, splashBytes }
  // assetFiles use web-target paths (e.g. "assets/hero.png") and are placed
  // under www/. iconBytes/splashBytes become resources/icon.png and
  // resources/splash.png when given.
  // Returns { files: [{path, bytes: Uint8Array}], gameName, packageName,
  //           appId }. Never throws.
  function buildMobileFiles(opts) {
    var files = [];
    try {
      opts = opts || {};
      var name = displayName(opts.gameName);
      var appId = validMobileAppId(opts.appId) ? String(opts.appId).trim() : sanitizeMobileAppId(name);
      files.push({ path: 'package.json', bytes: utf8Bytes(buildPackageJson(name, { appId: appId })) });
      files.push({ path: 'capacitor.config.json', bytes: utf8Bytes(buildCapacitorConfig(name, { appId: appId })) });
      files.push({ path: 'README.md', bytes: utf8Bytes(buildReadme(name, { appId: appId })) });
      files.push({ path: 'www/index.html', bytes: utf8Bytes(opts.gameHtml) });
      var assets = Array.isArray(opts.assetFiles) ? opts.assetFiles : [];
      assets.forEach(function (f) {
        if (!f || typeof f !== 'object') return;
        var p = String(f.path == null ? '' : f.path).replace(/\\/g, '/').replace(/^\/+/, '');
        if (!p) return;
        files.push({ path: 'www/' + p, bytes: toBytes(f.bytes) });
      });
      if (opts.iconBytes && typeof opts.iconBytes.length === 'number' && opts.iconBytes.length > 0) {
        files.push({ path: 'resources/icon.png', bytes: toBytes(opts.iconBytes) });
      }
      if (opts.splashBytes && typeof opts.splashBytes.length === 'number' && opts.splashBytes.length > 0) {
        files.push({ path: 'resources/splash.png', bytes: toBytes(opts.splashBytes) });
      }
      return {
        files: files,
        gameName: name,
        packageName: sanitizePackageName(name),
        appId: appId
      };
    } catch (e) {
      return { files: files, gameName: 'Hydra Game', packageName: 'hydra-game', appId: 'com.hydrascript.hydragame' };
    }
  }

  return {
    displayName: displayName,
    sanitizePackageName: sanitizePackageName,
    sanitizeMobileAppId: sanitizeMobileAppId,
    validMobileAppId: validMobileAppId,
    buildPackageJson: buildPackageJson,
    buildCapacitorConfig: buildCapacitorConfig,
    buildReadme: buildReadme,
    buildMobileFiles: buildMobileFiles,
    utf8Bytes: utf8Bytes,
    toBytes: toBytes
  };
}

window.HydraMobileExport = hydraMobileExportFactory();
// Self-contained source of the factory, following the hydra-*.js pattern so
// editor code and tests can rehydrate it anywhere.
window.HydraMobileExport.factorySource = hydraMobileExportFactory.toString();
