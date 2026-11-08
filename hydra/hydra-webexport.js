/* ============================================================================
 * hydra-webexport.js — HydraScript shared web-target export helpers.
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation of
 * the P4 E1 web targets (itch.io-ready ZIP + PWA export) used by:
 *   - the editor export dialog (project.js drives it), and
 *   - exported-file assembly (player-runtime.js buildWebTarget delegates to
 *     these builders; the lazy load guard there throws a clear error when
 *     this module is missing, so existing export paths are unaffected).
 *
 * What it does:
 *   - extractAssets(project): moves embedded data-URL assets into an
 *     assets/ file list and rewrites the project to reference them by
 *     relative path. The exported runtime resolves them through
 *     HydraAudio.assetUrl (dataUrl wins when present, else assets/<file>).
 *   - buildZip(files): minimal stored-method ZIP writer (no compression, no
 *     dependencies) returning a Uint8Array the editor downloads as .zip.
 *   - buildManifest / buildServiceWorker / injectPwa: the PWA pieces —
 *     web manifest JSON, an offline-first service worker, and the head/body
 *     snippets injected into the exported index.html.
 *   - drawIcon(ctx, size, label): paints the PWA icon on any 2D context.
 *
 * Load order (index.html): hydra-webexport.js BEFORE player-runtime.js and
 * project.js. Nothing here touches the DOM, so node tests can drive it
 * directly.
 * ========================================================================== */

function hydraWebExportFactory() {
  'use strict';

  var B64CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  // ---- filename helpers -------------------------------------------------

  // Makes a filesystem-safe base name (no extension): strips unsafe chars,
  // collapses repeats, trims edge dots/underscores, caps length.
  function sanitizeFilename(name) {
    var s = String(name == null ? '' : name);
    s = s.replace(/[^a-zA-Z0-9._-]+/g, '_');
    s = s.replace(/_+/g, '_').replace(/^[_.]+|[_.]+$/g, '');
    if (s.length > 60) s = s.slice(0, 60).replace(/[_.]+$/g, '');
    return s || 'file';
  }

  var MIME_EXT = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif',
    'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp',
    'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/ogg': 'ogg',
    'audio/wav': 'wav', 'audio/wave': 'wav', 'audio/x-wav': 'wav',
    'audio/webm': 'webm', 'audio/mp4': 'm4a',
    'video/mp4': 'mp4', 'video/webm': 'webm',
    'application/json': 'json', 'text/plain': 'txt',
    // P4 item 3D2: 3D model assets keep their real extensions in web targets.
    'model/gltf-binary': 'glb', 'model/gltf+json': 'gltf'
  };

  function mimeExtension(mime) {
    var m = String(mime || '').toLowerCase().split(';')[0].trim();
    return MIME_EXT[m] || 'bin';
  }

  // Pure base64 data-URL decoder (no atob/DOM), mirroring the hydra-buses
  // decoder but for any MIME type. Returns {mime, bytes} or null.
  function parseDataUrl(dataUrl) {
    try {
      if (typeof dataUrl !== 'string') return null;
      var m = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+)(;[^,]*)?,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl.trim());
      if (!m) return null;
      var mime = m[1].toLowerCase();
      var isB64 = /;base64/i.test(m[2] || '');
      var data = m[3].replace(/\s+/g, '');
      var bytes;
      if (isB64) {
        var out = [];
        var acc = 0, bits = 0;
        for (var i = 0; i < data.length; i++) {
          var c = data.charAt(i);
          if (c === '=') break;
          var v = B64CHARS.indexOf(c);
          if (v < 0) return null;
          acc = (acc << 6) | v;
          bits += 6;
          if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 255); }
        }
        bytes = new Uint8Array(out);
      } else {
        var s = decodeURIComponent(data);
        bytes = new Uint8Array(s.length);
        for (var j = 0; j < s.length; j++) bytes[j] = s.charCodeAt(j) & 255;
      }
      return { mime: mime, bytes: bytes };
    } catch (e) { return null; }
  }

  function uniqueName(used, base, ext) {
    var name = base + '.' + ext, n = 1;
    while (used[name]) { n++; name = base + '-' + n + '.' + ext; }
    used[name] = true;
    return name;
  }

  // Deep-clones the project; every asset with a decodable dataUrl becomes a
  // file under assets/ and its record is rewritten to {name, kind, file}.
  // Records without a dataUrl are left untouched (the runtime falls back to
  // tones / skips missing images exactly as before). Never throws.
  function extractAssets(project) {
    var files = [];
    var clone;
    try { clone = JSON.parse(JSON.stringify(project || {})); }
    catch (e) { return { project: {}, files: files }; }
    var used = {};
    var assets = clone.assets;
    if (!assets || typeof assets !== 'object') return { project: clone, files: files };
    Object.keys(assets).forEach(function (id) {
      var rec = assets[id];
      if (!rec || typeof rec !== 'object') return;
      var parsed = parseDataUrl(rec.dataUrl);
      if (!parsed) return;
      var base = sanitizeFilename(String(rec.name || id).replace(/\.[a-z0-9]+$/i, ''));
      var fname = uniqueName(used, base, mimeExtension(parsed.mime));
      files.push({ path: 'assets/' + fname, bytes: parsed.bytes, mime: parsed.mime });
      assets[id] = { name: rec.name || fname, kind: rec.kind || '', file: fname };
    });
    return { project: clone, files: files };
  }

  // ---- ZIP writer (stored method, no compression) -------------------------

  var CRC_TABLE = null;
  function crcTable() {
    if (CRC_TABLE) return CRC_TABLE;
    CRC_TABLE = new Int32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      CRC_TABLE[n] = c;
    }
    return CRC_TABLE;
  }

  function crc32(bytes) {
    var t = crcTable(), crc = 0xFFFFFFFF, i;
    for (i = 0; i < bytes.length; i++) crc = t[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  // Copies any byte-like value (Uint8Array, Buffer, plain array — any realm)
  // into a fresh Uint8Array. Never uses instanceof: the module runs in a vm
  // sandbox in tests, where foreign Uint8Arrays fail instanceof.
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
  // UTF-8 encoder that works in bare vm sandboxes too (TextEncoder is not
  // guaranteed there).
  function utf8Bytes(s) {
    s = String(s == null ? '' : s);
    if (typeof TextEncoder !== 'undefined') {
      try { return new TextEncoder().encode(s); } catch (e) { /* fall through */ }
    }
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

  // files: [{path, bytes}]. Returns the complete .zip as a Uint8Array.
  // Stored (uncompressed) entries keep the writer dependency-free; itch.io
  // and browsers accept stored ZIPs fine.
  function buildZip(files) {
    files = Array.isArray(files) ? files : [];
    var list = [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i] || {};
      var name = String(f.path == null ? '' : f.path).replace(/\\/g, '/').replace(/^\/+/, '');
      if (!name || /\/$/.test(name)) continue;
      var bytes = toBytes(f.bytes);
      list.push({ name: name, nameBytes: utf8Bytes(name), bytes: bytes, crc: crc32(bytes) });
    }
    var now = new Date();
    var dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF;
    var dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;
    var localSize = 0, centralSize = 0, j;
    for (j = 0; j < list.length; j++) {
      localSize += 30 + list[j].nameBytes.length + list[j].bytes.length;
      centralSize += 46 + list[j].nameBytes.length;
    }
    var out = new Uint8Array(localSize + centralSize + 22);
    var view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    var pos = 0;
    function w16(v) { view.setUint16(pos, v & 0xFFFF, true); pos += 2; }
    function w32(v) { view.setUint32(pos, v >>> 0, true); pos += 4; }
    function wBytes(b) { out.set(b, pos); pos += b.length; }
    var offsets = [];
    for (j = 0; j < list.length; j++) {
      var e = list[j];
      offsets.push(pos);
      w32(0x04034b50); w16(20); w16(0x0800); w16(0); // local header, UTF-8 flag, stored
      w16(dosTime); w16(dosDate);
      w32(e.crc); w32(e.bytes.length); w32(e.bytes.length);
      w16(e.nameBytes.length); w16(0);
      wBytes(e.nameBytes); wBytes(e.bytes);
    }
    var centralStart = pos;
    for (j = 0; j < list.length; j++) {
      var c = list[j];
      w32(0x02014b50); w16(20); w16(20); w16(0x0800); w16(0);
      w16(dosTime); w16(dosDate);
      w32(c.crc); w32(c.bytes.length); w32(c.bytes.length);
      w16(c.nameBytes.length); w16(0); w16(0); w16(0); w16(0);
      w32(0); w32(offsets[j]);
      wBytes(c.nameBytes);
    }
    var centralEnd = pos;
    w32(0x06054b50); w16(0); w16(0);
    w16(list.length); w16(list.length);
    w32(centralEnd - centralStart); w32(centralStart); w16(0);
    return out;
  }

  // ---- PWA builders -------------------------------------------------------

  function pwaCacheName(gameName) {
    return 'hydra-' + sanitizeFilename(gameName || 'game').toLowerCase().replace(/_+/g, '-') + '-v1';
  }

  // icons: [{path, sizes}] e.g. {path:'icons/icon-192.png', sizes:'192x192'}
  function buildManifest(opts) {
    opts = opts || {};
    var name = String(opts.name || 'Hydra Game');
    var icons = (Array.isArray(opts.icons) ? opts.icons : []).map(function (ic) {
      return { src: String(ic.path), sizes: String(ic.sizes || ''), type: 'image/png' };
    });
    return JSON.stringify({
      name: name,
      short_name: String(opts.shortName || name).slice(0, 24),
      start_url: '.',
      scope: '.',
      display: 'standalone',
      orientation: 'any',
      background_color: opts.backgroundColor || '#0f172a',
      theme_color: opts.themeColor || '#f59e0b',
      icons: icons
    }, null, 2);
  }

  // Offline-first service worker: precaches every exported path on install,
  // serves cache-first, purges stale caches on activate.
  function buildServiceWorker(opts) {
    opts = opts || {};
    var cacheName = String(opts.cacheName || 'hydra-pwa-v1');
    var paths = (Array.isArray(opts.paths) ? opts.paths : []).map(function (p) {
      return JSON.stringify(String(p));
    });
    return '// HydraScript PWA service worker: offline-first cache.\n' +
      '// Generated by the HydraScript editor. Safe to ship as-is.\n' +
      'var CACHE_NAME = ' + JSON.stringify(cacheName) + ';\n' +
      'var PRECACHE_URLS = [\n  ' + paths.join(',\n  ') + '\n];\n' +
      "self.addEventListener('install', function (event) {\n" +
      '  event.waitUntil(caches.open(CACHE_NAME).then(function (cache) {\n' +
      '    return cache.addAll(PRECACHE_URLS);\n' +
      '  }).then(function () { return self.skipWaiting(); }));\n' +
      '});\n' +
      "self.addEventListener('activate', function (event) {\n" +
      '  event.waitUntil(caches.keys().then(function (keys) {\n' +
      '    return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; })\n' +
      '      .map(function (k) { return caches.delete(k); }));\n' +
      '  }).then(function () { return self.clients.claim(); }));\n' +
      '});\n' +
      "self.addEventListener('fetch', function (event) {\n" +
      "  if (event.request.method !== 'GET') return;\n" +
      '  event.respondWith(caches.match(event.request).then(function (hit) {\n' +
      '    return hit || fetch(event.request);\n' +
      '  }));\n' +
      '});\n';
  }

  function escapeHtmlAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  // Injects the manifest link + theme-color meta into <head> and the service
  // worker registration before </body>. Uses the LAST occurrence of each tag:
  // the exported runtime source embeds template literals that contain their
  // own </head> / </body> (the retro-FPS template), so first-match would
  // inject mid-script and corrupt the export. Never throws.
  function injectPwa(html, opts) {
    opts = opts || {};
    try {
      var manifestPath = escapeHtmlAttr(opts.manifestPath || 'manifest.webmanifest');
      var swPath = String(opts.swPath || 'sw.js').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      var theme = escapeHtmlAttr(opts.themeColor || '#f59e0b');
      var head = '<link rel="manifest" href="' + manifestPath + '">\n' +
        '<meta name="theme-color" content="' + theme + '">\n' +
        '<meta name="mobile-web-app-capable" content="yes">\n' +
        '<meta name="apple-mobile-web-app-capable" content="yes">';
      var reg = '<script>\n' +
        "if ('serviceWorker' in navigator) {\n" +
        "  window.addEventListener('load', function () {\n" +
        "    navigator.serviceWorker.register('" + swPath + "').catch(function (e) {\n" +
        "      console.warn('Hydra PWA: service worker registration failed', e);\n" +
        '    });\n' +
        '  });\n' +
        '}\n</scr' + 'ipt>';
      var out = String(html == null ? '' : html);
      var hi = out.lastIndexOf('</head>');
      out = hi !== -1 ? out.slice(0, hi) + head + '\n' + out.slice(hi) : head + '\n' + out;
      var bi = out.lastIndexOf('</body>');
      out = bi !== -1 ? out.slice(0, bi) + reg + '\n' + out.slice(bi) : out + '\n' + reg;
      return out;
    } catch (e) { return String(html == null ? '' : html); }
  }

  // ---- PWA icon painter ---------------------------------------------------

  function rrPath(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Paints the app icon on any 2D context: dark navy rounded square, amber
  // ring, the game's initial, and a small amber dot motif. Decorative only;
  // never throws.
  function drawIcon(ctx, size, label) {
    try {
      size = Math.max(1, Math.round(Number(size) || 192));
      var letter = String(label == null ? '' : label).trim().charAt(0).toUpperCase() || 'H';
      ctx.fillStyle = '#0f172a';
      rrPath(ctx, 0, 0, size, size, size * 0.22);
      ctx.fill();
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = Math.max(2, size * 0.03);
      rrPath(ctx, size * 0.06, size * 0.06, size * 0.88, size * 0.88, size * 0.18);
      ctx.stroke();
      ctx.fillStyle = '#f8fafc';
      ctx.font = '700 ' + Math.round(size * 0.52) + 'px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(letter, size / 2, size * 0.54);
      ctx.fillStyle = '#f59e0b';
      var r = size * 0.035;
      [[0.22, 0.20, 1], [0.80, 0.26, 0.8], [0.74, 0.78, 0.9]].forEach(function (d) {
        ctx.beginPath();
        ctx.arc(size * d[0], size * d[1], r * d[2], 0, Math.PI * 2);
        ctx.fill();
      });
    } catch (e) { /* decorative; never break the export */ }
  }

  return {
    sanitizeFilename: sanitizeFilename,
    mimeExtension: mimeExtension,
    parseDataUrl: parseDataUrl,
    extractAssets: extractAssets,
    crc32: crc32,
    utf8Bytes: utf8Bytes,
    toBytes: toBytes,
    buildZip: buildZip,
    pwaCacheName: pwaCacheName,
    buildManifest: buildManifest,
    buildServiceWorker: buildServiceWorker,
    injectPwa: injectPwa,
    drawIcon: drawIcon
  };
}

window.HydraWebExport = hydraWebExportFactory();
// Self-contained source of the factory, following the hydra-*.js pattern so
// editor code and tests can rehydrate it anywhere.
window.HydraWebExport.factorySource = hydraWebExportFactory.toString();
