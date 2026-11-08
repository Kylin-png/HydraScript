/* ============================================================================
 * hydra-gltf.js — HydraScript shared glTF/GLB 3D model loader (P4 item 3D2).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation of
 * 3D model asset parsing used by:
 *   - the editor (script.js resolves an asset record to bytes, parses, and
 *     hands hydra-3d.js a fitted {verts, tris, colors} mesh), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * What it does (beginner-first 3D models, no dependencies):
 *   - Parses GLB 2.0 files (the one-file 3D format Blender, Tinkercad, and
 *     most model sites export) and .gltf JSON with embedded (data: URI)
 *     buffers. A .gltf that points at a separate .bin file is rejected
 *     with a plain-language error — upload the .glb instead.
 *   - Reads triangle meshes: indexed or not, any index width, node
 *     transforms (translation/rotation/scale or full matrices) baked into
 *     world space, per-primitive material base colors.
 *   - glTF's Y-up is converted to HydraScript's Y-down on load, so a model
 *     authored standing up renders standing up (no "why is my robot lying
 *     down" surprise).
 *
 * Honest limits of this slice (documented in the user guide too):
 *   - Geometry + flat material colors + base-color TEXTURES. The parser
 *     reads each material's baseColorTexture (TEXCOORD_0 UVs, embedded
 *     image bytes only) and the projector samples it per triangle —
 *     no skeletal animation, no skins, no morph targets, no KHR extensions
 *     (KHR_texture_transform is ignored), no external image URIs.
 *   - Triangle counts are capped (MAX_MODEL_TRIS) to protect the built-in
 *     CPU projector; bigger models load with `truncated: true`.
 *
 * Conventions (kept identical in preview and exports):
 *   - Nothing here ever throws; hostile input produces { ok: false, error }
 *     with a plain-language message, never an exception.
 *   - The parsed model is renderer-agnostic data:
 *       { tris: [{ a:[x,y,z], b:[...], c:[...], color:[r,g,b],
 *                  uv:[[u,v],[u,v],[u,v]] | null, tex: textureIndex | -1 }],
 *         triCount, truncated, bounds: { min:[x,y,z], max:[x,y,z] },
 *         textures: [{ index, mimeType, bytes: Uint8Array }] }
 *     UVs use glTF's own convention (origin at the image's top-left), so
 *     they sample straight with u -> x, v -> y. Texture bytes are handed to
 *     the host untouched — decoding images is a host (browser) job, not
 *     this module's. fitModelToBox(model, w, h, d) scales the model into a
 *     w-by-h-by-d box centered on the origin and returns hydra-3d's mesh
 *     shape { verts, tris, colors, uvs, tex } (uvs/tex parallel to tris;
 *     tex is -1 where the triangle has no texture).
 *
 * Load order (index.html): hydra-gltf.js BEFORE hydra-3d.js and
 * player-runtime.js. player-runtime.js throws a clear error if HydraGltf is
 * missing. hydra-3d.js never touches this module directly — the host hands
 * it a ready mesh through renderScene's resolveModel hook.
 * ========================================================================== */

function hydraGltfFactory() {
  'use strict';

  var MAX_MODEL_TRIS = 20000;
  var MAX_VERTS_PER_PRIMITIVE = 1000000;
  var MAX_TEXTURE_BYTES = 8 * 1024 * 1024; // one image; bigger ones are skipped
  var GLB_MAGIC = 0x46546C67; // 'glTF' little-endian
  var CHUNK_JSON = 0x4E4F534A; // 'JSON'
  var CHUNK_BIN = 0x004E4942; // 'BIN\0'

  var COMP_SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
  var TYPE_COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

  function fail(error) { return { ok: false, error: String(error || 'unreadable model'), model: null }; }

  function fin(v) { var n = Number(v); return Number.isFinite(n) ? n : 0; }
  function clamp01(v) { v = Number(v); if (!Number.isFinite(v)) return 0; return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function dim(v, fallback) { var n = Number(v); return (Number.isFinite(n) && n > 0) ? n : fallback; }

  // Copy any byte-like value into a fresh Uint8Array. Never uses
  // instanceof: the module runs in vm sandboxes in tests, where foreign
  // Uint8Arrays fail instanceof.
  function toBytes(v) {
    try {
      if (v && typeof v.byteLength === 'number' && v.buffer) {
        return new Uint8Array(v.buffer, v.byteOffset || 0, v.byteLength);
      }
      if (v && typeof v.length === 'number') {
        var out = new Uint8Array(v.length);
        for (var i = 0; i < v.length; i++) out[i] = v[i] & 255;
        return out;
      }
    } catch (e) { /* fall through */ }
    return new Uint8Array(0);
  }

  // ---------- base64 (self-contained: atob is not guaranteed in vm sandboxes) ----------
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function base64ToBytes(s) {
    try {
      s = String(s || '').replace(/[^A-Za-z0-9+/=]/g, '');
      var out = [], i = 0;
      while (i + 1 < s.length) {
        var c0 = B64.indexOf(s.charAt(i++)), c1 = B64.indexOf(s.charAt(i++));
        var ch2 = s.charAt(i), ch3 = s.charAt(i + 1);
        var c2 = ch2 === '=' ? -1 : B64.indexOf(ch2); i++;
        var c3 = ch3 === '=' ? -1 : B64.indexOf(ch3); i++;
        if (c0 < 0 || c1 < 0) break;
        out.push((c0 << 2) | (c1 >> 4));
        if (c2 >= 0) out.push(((c1 & 15) << 4) | (c2 >> 2));
        if (c3 >= 0) out.push(((c2 & 3) << 6) | c3);
      }
      return new Uint8Array(out);
    } catch (e) { return new Uint8Array(0); }
  }

  // data:[mime][;base64],... -> Uint8Array, or null when not a base64 data URL.
  function bytesFromDataUrl(dataUrl) {
    try {
      var m = /^data:([^;,]*)?(;base64)?,([\s\S]*)$/.exec(String(dataUrl || ''));
      if (!m || !m[2]) return null;
      var bytes = base64ToBytes(m[3]);
      return bytes.length ? bytes : null;
    } catch (e) { return null; }
  }

  // Self-contained encoder (the base64ToBytes twin): Uint8Array -> base64
  // string, so hosts can turn parsed texture bytes into an <img> data URL
  // without depending on btoa (unavailable in vm sandboxes).
  function bytesToBase64(bytes) {
    try {
      bytes = toBytes(bytes);
      var out = '';
      for (var i = 0; i < bytes.length; i += 3) {
        var b0 = bytes[i], b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
        var b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
        out += B64.charAt(b0 >> 2) + B64.charAt(((b0 & 3) << 4) | (b1 >> 4)) +
          (i + 1 < bytes.length ? B64.charAt(((b1 & 15) << 2) | (b2 >> 6)) : '=') +
          (i + 2 < bytes.length ? B64.charAt(b2 & 63) : '=');
      }
      return out;
    } catch (e) { return ''; }
  }

  // Asset record ({dataUrl} in the editor and classic exports) -> bytes.
  // Web-target exports rewrite records to {file}; the host fetches those
  // bytes itself and calls parseModelBytes/parseGlb directly.
  function modelAssetBytes(rec) {
    if (!rec || typeof rec !== 'object') return null;
    return bytesFromDataUrl(rec.dataUrl);
  }

  function decodeUtf8(bytes) {
    var s = '', i = 0;
    while (i < bytes.length) {
      var c = bytes[i++];
      if (c < 128) { s += String.fromCharCode(c); continue; }
      if ((c & 0xE0) === 0xC0 && i < bytes.length) {
        s += String.fromCharCode(((c & 31) << 6) | (bytes[i++] & 63)); continue;
      }
      if ((c & 0xF0) === 0xE0 && i + 1 < bytes.length) {
        s += String.fromCharCode(((c & 15) << 12) | ((bytes[i] & 63) << 6) | (bytes[i + 1] & 63));
        i += 2; continue;
      }
      s += '�';
    }
    return s;
  }

  // ---------- glTF math (column-major, matching the spec) ----------
  function mat4Identity() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }

  function mat4Mul(a, b) {
    var o = new Array(16);
    for (var c = 0; c < 4; c++) {
      for (var r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
          a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return o;
  }

  function mat4FromTRS(t, q, s) {
    t = t || [0, 0, 0]; q = q || [0, 0, 0, 1]; s = s || [1, 1, 1];
    var x = fin(q[0]), y = fin(q[1]), z = fin(q[2]), w = fin(q[3]);
    var sx = fin(s[0]) || 0, sy = fin(s[1]) || 0, sz = fin(s[2]) || 0;
    var xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z;
    var wx = w * x, wy = w * y, wz = w * z;
    return [
      (1 - 2 * (yy + zz)) * sx, (2 * (xy + wz)) * sx, (2 * (xz - wy)) * sx, 0,
      (2 * (xy - wz)) * sy, (1 - 2 * (xx + zz)) * sy, (2 * (yz + wx)) * sy, 0,
      (2 * (xz + wy)) * sz, (2 * (yz - wx)) * sz, (1 - 2 * (xx + yy)) * sz, 0,
      fin(t[0]), fin(t[1]), fin(t[2]), 1
    ];
  }

  function mat4TransformPoint(m, p) {
    var x = fin(p[0]), y = fin(p[1]), z = fin(p[2]);
    return [
      m[0] * x + m[4] * y + m[8] * z + m[12],
      m[1] * x + m[5] * y + m[9] * z + m[13],
      m[2] * x + m[6] * y + m[10] * z + m[14]
    ];
  }

  function nodeLocalMatrix(node) {
    if (Array.isArray(node.matrix) && node.matrix.length === 16) {
      var m = [];
      for (var i = 0; i < 16; i++) m.push(fin(node.matrix[i]));
      return m;
    }
    return mat4FromTRS(node.translation, node.rotation, node.scale);
  }

  // ---------- accessor reading ----------
  function makeView(bin) {
    try { return new DataView(bin.buffer, bin.byteOffset, bin.byteLength); }
    catch (e) { return null; }
  }

  function readComp(dv, compType, off) {
    try {
      switch (compType) {
        case 5120: return dv.getInt8(off);
        case 5121: return dv.getUint8(off);
        case 5122: return dv.getInt16(off, true);
        case 5123: return dv.getUint16(off, true);
        case 5125: return dv.getUint32(off, true);
        case 5126: return dv.getFloat32(off, true);
        default: return 0;
      }
    } catch (e) { return 0; }
  }

  // -> { data: [numbers], count, itemSize } or null. Sparse accessors are
  // read dense (their overrides are ignored) — documented limit.
  function readAccessor(json, bin, dv, index) {
    try {
      var acc = json.accessors && json.accessors[index];
      if (!acc || typeof acc !== 'object') return null;
      var bv = json.bufferViews && json.bufferViews[acc.bufferView];
      if (!bv || typeof bv !== 'object') return null;
      var compSize = COMP_SIZE[acc.componentType];
      var itemSize = TYPE_COUNT[acc.type];
      if (!compSize || !itemSize || !dv) return null;
      var count = Math.floor(Number(acc.count)) || 0;
      if (count <= 0 || count > MAX_VERTS_PER_PRIMITIVE) return null;
      var stride = Number(bv.byteStride) || (compSize * itemSize);
      if (!(stride >= compSize * itemSize)) return null;
      var base = (Number(bv.byteOffset) || 0) + (Number(acc.byteOffset) || 0);
      var out = new Array(count * itemSize);
      for (var i = 0; i < count; i++) {
        for (var k = 0; k < itemSize; k++) {
          out[i * itemSize + k] = readComp(dv, acc.componentType, base + i * stride + k * compSize);
        }
      }
      return { data: out, count: count, itemSize: itemSize };
    } catch (e) { return null; }
  }

  function materialColor(json, matIndex) {
    try {
      var mats = json.materials;
      var m = mats && mats[matIndex];
      var pbr = m && m.pbrMetallicRoughness;
      var f = pbr && pbr.baseColorFactor;
      if (Array.isArray(f)) return [clamp01(f[0]), clamp01(f[1]), clamp01(f[2])];
    } catch (e) { /* fall through */ }
    return [1, 1, 1];
  }

  // UVs (TEXCOORD_0): VEC2 of floats normally; normalized integer types are
  // de-normalized per the glTF spec. Returns { data:[u,v,...], count } or
  // null. Nothing here throws.
  function readUVs(json, bin, dv, index) {
    try {
      var acc = json.accessors && json.accessors[index];
      if (!acc || typeof acc !== 'object') return null;
      var bv = json.bufferViews && json.bufferViews[acc.bufferView];
      if (!bv || typeof bv !== 'object') return null;
      var compSize = COMP_SIZE[acc.componentType];
      var itemSize = TYPE_COUNT[acc.type];
      if (!compSize || itemSize !== 2 || !dv) return null;
      var count = Math.floor(Number(acc.count)) || 0;
      if (count <= 0 || count > MAX_VERTS_PER_PRIMITIVE) return null;
      var stride = Number(bv.byteStride) || (compSize * itemSize);
      if (!(stride >= compSize * itemSize)) return null;
      var base = (Number(bv.byteOffset) || 0) + (Number(acc.byteOffset) || 0);
      // Denominator for normalized integer UVs (float UVs pass through).
      var denom = 1;
      if (acc.normalized) {
        if (acc.componentType === 5120) denom = 127;
        else if (acc.componentType === 5121) denom = 255;
        else if (acc.componentType === 5122) denom = 32767;
        else if (acc.componentType === 5123) denom = 65535;
        else if (acc.componentType === 5125) denom = 4294967295;
      }
      var out = new Array(count * 2);
      for (var i = 0; i < count; i++) {
        for (var k = 0; k < 2; k++) {
          var v = readComp(dv, acc.componentType, base + i * stride + k * compSize);
          if (denom !== 1) v = v / denom;
          out[i * 2 + k] = fin(v);
        }
      }
      return { data: out, count: count };
    } catch (e) { return null; }
  }

  // Base-color textures: materials[].pbrMetallicRoughness.baseColorTexture
  // -> textures[].source -> images[]. Returns an array of
  // { index, mimeType, bytes } (bytes are Uint8Array subarrays of the GLB
  // binary chunk or decoded data: URIs). Images that point at separate
  // files are skipped — the model still loads, untextured, with its flat
  // colors. Never throws.
  function extractTextures(json, bin) {
    var textures = [];
    try {
      var jsonTextures = (json && Array.isArray(json.textures)) ? json.textures : [];
      var jsonImages = (json && Array.isArray(json.images)) ? json.images : [];
      for (var i = 0; i < jsonTextures.length; i++) {
        var t = jsonTextures[i];
        if (!t || typeof t !== 'object') continue;
        var imgIdx = Number(t.source);
        if (!Number.isFinite(imgIdx) || imgIdx < 0 || imgIdx >= jsonImages.length) continue;
        var img = jsonImages[imgIdx];
        if (!img || typeof img !== 'object') continue;
        var bytes = null, mime = 'image/png';
        if (typeof img.mimeType === 'string' && /^image\//.test(img.mimeType)) mime = img.mimeType;
        if (img.bufferView != null) {
          var bv = json.bufferViews && json.bufferViews[img.bufferView];
          if (bv && typeof bv === 'object') {
            var off = Number(bv.byteOffset) || 0;
            var len = Number(bv.byteLength) || 0;
            if (len > 0 && len <= MAX_TEXTURE_BYTES && off + len <= bin.length) {
              bytes = bin.subarray(off, off + len);
            }
          }
        } else if (typeof img.uri === 'string' && img.uri.indexOf('data:') === 0) {
          bytes = bytesFromDataUrl(img.uri);
          if (bytes && bytes.length > MAX_TEXTURE_BYTES) bytes = null;
        }
        // A separate-file image (external uri) is skipped, not an error.
        if (bytes && bytes.length) textures.push({ index: i, mimeType: mime, bytes: bytes });
      }
    } catch (e) { /* hostile texture tables degrade to no textures */ }
    return textures;
  }

  // Texture index (into the extractTextures array) for a primitive's
  // material baseColorTexture, or -1 when the material has none usable.
  function primitiveTextureIndex(json, textures, prim) {
    try {
      if (!prim || prim.material == null) return -1;
      var mats = json.materials;
      var m = mats && mats[prim.material];
      var pbr = m && m.pbrMetallicRoughness;
      var bt = pbr && pbr.baseColorTexture;
      if (!bt || typeof bt !== 'object' || bt.index == null) return -1;
      var wanted = Number(bt.index);
      for (var i = 0; i < textures.length; i++) {
        if (textures[i].index === wanted) return i;
      }
    } catch (e) { /* fall through */ }
    return -1;
  }

  // ---------- model building ----------
  function buildModel(json, bin) {
    if (!json || typeof json !== 'object') return fail('no model data');
    bin = toBytes(bin);
    var dv = makeView(bin);
    var tris = [];
    var truncated = false;
    var textures = extractTextures(json, bin);
    var min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    function track(p) {
      for (var i = 0; i < 3; i++) {
        if (p[i] < min[i]) min[i] = p[i];
        if (p[i] > max[i]) max[i] = p[i];
      }
    }

    function addPrimitive(prim, matrix) {
      if (!prim || typeof prim !== 'object' || prim.mode != null && prim.mode !== 4) return;
      var attrs = prim.attributes || {};
      if (attrs.POSITION == null) return;
      var pos = readAccessor(json, bin, dv, attrs.POSITION);
      if (!pos || pos.itemSize !== 3 || pos.count === 0) return;
      var idx = (prim.indices != null) ? readAccessor(json, bin, dv, prim.indices) : null;
      if (prim.indices != null && (!idx || idx.itemSize !== 1)) return;
      var triTotal = idx ? Math.floor(idx.count / 3) : Math.floor(pos.count / 3);
      var color = materialColor(json, prim.material);
      // Texture: the material's baseColorTexture (position in the
      // textures array) plus per-vertex TEXCOORD_0 UVs. Either missing
      // means the triangle keeps its flat color — never a crash.
      var texIdx = primitiveTextureIndex(json, textures, prim);
      var uvs = (texIdx >= 0 && attrs.TEXCOORD_0 != null)
        ? readUVs(json, bin, dv, attrs.TEXCOORD_0) : null;
      if (uvs && (uvs.count !== pos.count)) uvs = null;
      var hasTex = texIdx >= 0 && !!uvs;
      for (var t = 0; t < triTotal; t++) {
        if (tris.length >= MAX_MODEL_TRIS) { truncated = true; return; }
        var ia, ib, ic;
        if (idx) {
          ia = Math.floor(idx.data[t * 3]); ib = Math.floor(idx.data[t * 3 + 1]); ic = Math.floor(idx.data[t * 3 + 2]);
        } else { ia = t * 3; ib = t * 3 + 1; ic = t * 3 + 2; }
        if (ia < 0 || ib < 0 || ic < 0 || ia >= pos.count || ib >= pos.count || ic >= pos.count) continue;
        var pts = [ia, ib, ic].map(function (vi) {
          var p = mat4TransformPoint(matrix, [pos.data[vi * 3], pos.data[vi * 3 + 1], pos.data[vi * 3 + 2]]);
          // glTF Y-up -> HydraScript Y-down, so authored models stand upright.
          p[1] = -p[1];
          return [fin(p[0]), fin(p[1]), fin(p[2])];
        });
        if (!Number.isFinite(pts[0][0] + pts[0][1] + pts[0][2] +
          pts[1][0] + pts[1][1] + pts[1][2] + pts[2][0] + pts[2][1] + pts[2][2])) continue;
        pts.forEach(track);
        var uvTri = null;
        if (hasTex) {
          uvTri = [ia, ib, ic].map(function (vi) {
            return [uvs.data[vi * 2], uvs.data[vi * 2 + 1]];
          });
          if (!Number.isFinite(uvTri[0][0] + uvTri[0][1] + uvTri[1][0] + uvTri[1][1] +
            uvTri[2][0] + uvTri[2][1])) uvTri = null;
        }
        tris.push({ a: pts[0], b: pts[1], c: pts[2], color: color,
          uv: uvTri, tex: uvTri ? texIdx : -1 });
      }
    }

    var state = { done: false };
    function traverse(nodeIndex, parentMat) {
      if (state.done) return;
      var node = json.nodes && json.nodes[nodeIndex];
      if (!node || typeof node !== 'object') return;
      var world = mat4Mul(parentMat, nodeLocalMatrix(node));
      if (node.mesh != null && json.meshes && json.meshes[node.mesh]) {
        var mesh = json.meshes[node.mesh];
        (mesh.primitives || []).forEach(function (prim) {
          addPrimitive(prim, world);
          if (truncated) state.done = true;
        });
      }
      (node.children || []).forEach(function (child) { traverse(child, world); });
    }

    try {
      var roots = null;
      var scenes = Array.isArray(json.scenes) ? json.scenes : [];
      var scene = scenes[Number(json.scene) || 0] || scenes[0];
      if (scene && Array.isArray(scene.nodes)) roots = scene.nodes;
      if (!roots) {
        // Lenient: no scene — treat every node as a root.
        roots = [];
        var childSet = {};
        (json.nodes || []).forEach(function (n) { (n && n.children || []).forEach(function (c) { childSet[c] = true; }); });
        (json.nodes || []).forEach(function (n, i) { if (!childSet[i]) roots.push(i); });
      }
      var identity = mat4Identity();
      roots.forEach(function (r) { traverse(r, identity); });
    } catch (e) { return fail('could not read the model meshes'); }

    if (!tris.length) return fail('the model has no triangles to draw');
    for (var i = 0; i < 3; i++) {
      if (!Number.isFinite(min[i])) min[i] = 0;
      if (!Number.isFinite(max[i])) max[i] = 0;
    }
    return {
      ok: true, error: '',
      model: { tris: tris, triCount: tris.length, truncated: truncated,
        bounds: { min: min, max: max }, textures: textures }
    };
  }

  // ---------- entry points ----------
  function parseGlb(bytes) {
    try {
      bytes = toBytes(bytes);
      if (bytes.length < 12) return fail('that file is too short to be a GLB model');
      var dv = makeView(bytes);
      if (!dv) return fail('could not read the model bytes');
      if (dv.getUint32(0, true) !== GLB_MAGIC) return fail('not a GLB file — upload a .glb model');
      if (dv.getUint32(4, true) !== 2) return fail('only glTF 2.0 models are supported');
      var off = 12, jsonBytes = null, binBytes = new Uint8Array(0);
      var guard = 0;
      while (off + 8 <= bytes.length && guard++ < 16) {
        var clen = dv.getUint32(off, true), ctype = dv.getUint32(off + 4, true);
        off += 8;
        if (clen > bytes.length || off + clen > bytes.length) break;
        if (ctype === CHUNK_JSON) jsonBytes = bytes.subarray(off, off + clen);
        else if (ctype === CHUNK_BIN) binBytes = bytes.subarray(off, off + clen);
        off += clen;
      }
      if (!jsonBytes || !jsonBytes.length) return fail('the GLB has no JSON chunk');
      var json;
      try { json = JSON.parse(decodeUtf8(jsonBytes)); }
      catch (e) { return fail('the GLB metadata is not valid JSON'); }
      return buildModel(json, binBytes);
    } catch (e) { return fail('could not parse the GLB file'); }
  }

  // .gltf JSON text. Only embedded (data: URI) buffers work — a .gltf that
  // points at a separate .bin file is rejected with a helpful message.
  function parseGltfText(text) {
    try {
      var json = JSON.parse(String(text || ''));
      if (!json || typeof json !== 'object') return fail('not a glTF file');
      var buffers = Array.isArray(json.buffers) ? json.buffers : [];
      var bin = new Uint8Array(0);
      if (buffers.length) {
        var uri = buffers[0] && buffers[0].uri;
        if (typeof uri !== 'string' || uri.indexOf('data:') !== 0) {
          return fail('this .gltf needs a separate .bin file — upload the .glb version instead');
        }
        bin = bytesFromDataUrl(uri) || new Uint8Array(0);
      }
      return buildModel(json, bin);
    } catch (e) { return fail('could not parse the .gltf file'); }
  }

  // One call for hosts: GLB bytes parse as GLB; anything else with a .gltf
  // name parses as glTF JSON; anything else fails with a helpful message.
  function parseModelBytes(bytes, name) {
    bytes = toBytes(bytes);
    if (bytes.length >= 4) {
      try {
        var dv = makeView(bytes);
        if (dv && dv.getUint32(0, true) === GLB_MAGIC) return parseGlb(bytes);
      } catch (e) { /* fall through to the name check */ }
    }
    if (/\.gltf$/i.test(String(name || ''))) return parseGltfText(decodeUtf8(bytes));
    return fail('not a GLB/GLTF model — upload a .glb file');
  }

  // Scale a parsed model into a w-by-h-by-d box centered on the origin and
  // return hydra-3d's mesh shape { verts, tris, colors, uvs, tex } (colors,
  // uvs, tex parallel to tris, [r,g,b] 0..1; uvs entry null and tex -1
  // where the triangle has no texture). Never throws.
  function fitModelToBox(model, w, h, d) {
    try {
      w = dim(w, 120); h = dim(h, 120); d = dim(d, 120);
      var b = (model && model.bounds) || { min: [0, 0, 0], max: [1, 1, 1] };
      var sx = b.max[0] - b.min[0], sy = b.max[1] - b.min[1], sz = b.max[2] - b.min[2];
      var s = Math.min(w / (sx > 0 ? sx : 1), h / (sy > 0 ? sy : 1), d / (sz > 0 ? sz : 1));
      if (!Number.isFinite(s) || s <= 0) s = 1;
      var mid = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
      var verts = [], tris = [], colors = [], uvs = [], tex = [];
      (model.tris || []).forEach(function (t) {
        if (!t || !t.a || !t.b || !t.c) return;
        var base = verts.length;
        [t.a, t.b, t.c].forEach(function (p) {
          verts.push([(fin(p[0]) - mid[0]) * s, (fin(p[1]) - mid[1]) * s, (fin(p[2]) - mid[2]) * s]);
        });
        tris.push([base, base + 1, base + 2]);
        var c = t.color || [1, 1, 1];
        colors.push([clamp01(c[0]), clamp01(c[1]), clamp01(c[2])]);
        if (t.uv && t.tex != null && t.tex >= 0) {
          uvs.push([[fin(t.uv[0][0]), fin(t.uv[0][1])],
            [fin(t.uv[1][0]), fin(t.uv[1][1])], [fin(t.uv[2][0]), fin(t.uv[2][1])]]);
          tex.push(Math.floor(t.tex));
        } else {
          uvs.push(null);
          tex.push(-1);
        }
      });
      return { verts: verts, tris: tris, colors: colors, uvs: uvs, tex: tex };
    } catch (e) {
      return { verts: [], tris: [], colors: [], uvs: [], tex: [] };
    }
  }

  function isModelKind(kind) { return String(kind || '') === 'model'; }

  return {
    MAX_MODEL_TRIS: MAX_MODEL_TRIS,
    bytesFromDataUrl: bytesFromDataUrl,
    bytesToBase64: bytesToBase64,
    modelAssetBytes: modelAssetBytes,
    parseGlb: parseGlb,
    parseGltfText: parseGltfText,
    parseModelBytes: parseModelBytes,
    fitModelToBox: fitModelToBox,
    isModelKind: isModelKind,
    decodeUtf8: decodeUtf8
  };
}

window.HydraGltf = hydraGltfFactory();
// Self-contained source of the factory, inlined into exported playable games
// by HydraPlayer.buildPlayableHtml so exports run without editor files.
window.HydraGltf.factorySource = hydraGltfFactory.toString();
