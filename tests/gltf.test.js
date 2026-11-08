// Unit tests for hydra/hydra-gltf.js — the shared glTF/GLB model loader.
//
// Pure logic: base64 data-URL decoding, GLB chunk parsing, accessor reads,
// node-transform baking, material colors, Y-up -> Y-down conversion, the
// triangle cap, and fitModelToBox. Hostile input must produce
// { ok:false, error } and never throw. Nothing here touches the DOM.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const sandbox = {};
sandbox.window = sandbox; // hydra-gltf.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-gltf.js'), 'utf8'),
  sandbox, { filename: 'hydra-gltf.js' });
const G = sandbox.HydraGltf;

check('HydraGltf exposed with parsers',
  !!G && typeof G.parseGlb === 'function' && typeof G.parseGltfText === 'function' &&
  typeof G.parseModelBytes === 'function' && typeof G.bytesFromDataUrl === 'function' &&
  typeof G.fitModelToBox === 'function' && typeof G.modelAssetBytes === 'function');
check('factorySource is a self-contained function string',
  typeof G.factorySource === 'string' && G.factorySource.includes('hydraGltfFactory'));

// ---------- test GLB builders ----------
function buildGlb(json, bin) {
  const jsonRaw = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = (4 - (jsonRaw.length % 4)) % 4;
  const jsonBytes = Buffer.concat([jsonRaw, Buffer.alloc(jsonPad, 0x20)]);
  const binRaw = Buffer.from(bin.buffer, bin.byteOffset, bin.byteLength);
  const binPad = (4 - (binRaw.length % 4)) % 4;
  const binBytes = binRaw.length ? Buffer.concat([binRaw, Buffer.alloc(binPad, 0)]) : Buffer.alloc(0);
  const total = 12 + 8 + jsonBytes.length + (binBytes.length ? 8 + binBytes.length : 0);
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546C67, 0); // 'glTF'
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  let off = 12;
  out.writeUInt32LE(jsonBytes.length, off); out.writeUInt32LE(0x4E4F534A, off + 4); off += 8;
  jsonBytes.copy(out, off); off += jsonBytes.length;
  if (binBytes.length) {
    out.writeUInt32LE(binBytes.length, off); out.writeUInt32LE(0x004E4942, off + 4); off += 8;
    binBytes.copy(out, off);
  }
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

// Tetrahedron mesh GLB. opts: indices (bool), color [r,g,b], translation [x,y,z].
function tetraGlb(opts) {
  opts = opts || {};
  const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
  const indices = [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3];
  const posArr = new Float32Array(positions);
  const parts = [Buffer.from(posArr.buffer, posArr.byteOffset, posArr.byteLength)];
  const bufferViews = [{ buffer: 0, byteOffset: 0, byteLength: posArr.byteLength }];
  const accessors = [{ bufferView: 0, componentType: 5126, count: 4, type: 'VEC3' }];
  const prim = { attributes: { POSITION: 0 }, material: 0 };
  if (opts.indices !== false) {
    const idxArr = new Uint16Array(indices);
    const ibo = posArr.byteLength;
    parts.push(Buffer.from(idxArr.buffer, idxArr.byteOffset, idxArr.byteLength));
    bufferViews.push({ buffer: 0, byteOffset: ibo, byteLength: idxArr.byteLength });
    accessors.push({ bufferView: 1, componentType: 5123, count: indices.length, type: 'SCALAR' });
    prim.indices = 1;
  }
  const bin = Buffer.concat(parts);
  const color = opts.color || [1, 1, 1];
  const json = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: bin.length }],
    bufferViews, accessors,
    materials: [{ name: 'mat', pbrMetallicRoughness: { baseColorFactor: [color[0], color[1], color[2], 1] } }],
    meshes: [{ name: 'tetra', primitives: [prim] }],
    nodes: [{ name: 'root', mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0
  };
  if (opts.translation) json.nodes[0].translation = opts.translation;
  if (opts.scale) json.nodes[0].scale = opts.scale;
  return buildGlb(json, new Uint8Array(bin.buffer, bin.byteOffset, bin.byteLength));
}

// ---------- bytesFromDataUrl ----------
check('bytesFromDataUrl decodes a base64 data URL',
  (() => {
    const b = G.bytesFromDataUrl('data:model/gltf-binary;base64,' + Buffer.from([1, 2, 3]).toString('base64'));
    return b && b.length === 3 && b[0] === 1 && b[2] === 3;
  })());
check('bytesFromDataUrl rejects non-data URLs and non-base64',
  G.bytesFromDataUrl('https://example.com/x.glb') === null &&
  G.bytesFromDataUrl('data:text/plain,hello') === null &&
  G.bytesFromDataUrl(null) === null &&
  G.bytesFromDataUrl('') === null);
check('modelAssetBytes reads the record dataUrl',
  (() => {
    const b = G.modelAssetBytes({ dataUrl: 'data:application/octet-stream;base64,' + Buffer.from([9]).toString('base64') });
    return b && b.length === 1 && b[0] === 9 && G.modelAssetBytes({}) === null && G.modelAssetBytes(null) === null;
  })());

// ---------- parseGlb: happy paths ----------
const tetra = tetraGlb();
const parsed = G.parseGlb(tetra);
check('parseGlb parses a valid tetrahedron GLB',
  parsed.ok === true && parsed.model && parsed.model.triCount === 4,
  `ok=${parsed.ok} tris=${parsed.model && parsed.model.triCount} err=${parsed.error}`);
check('parsed triangles carry positions and default white color',
  (() => {
    const t = parsed.model.tris[0];
    return Array.isArray(t.a) && t.a.length === 3 && Array.isArray(t.color) &&
      t.color[0] === 1 && t.color[1] === 1 && t.color[2] === 1;
  })());
check('glTF Y-up flips to HydraScript Y-down (vertex y=1 -> y=-1)',
  (() => {
    const ys = [];
    parsed.model.tris.forEach(t => { ys.push(t.a[1], t.b[1], t.c[1]); });
    return ys.some(y => y === -1) && !ys.some(y => y === 1);
  })());
check('bounds track the flipped geometry',
  parsed.model.bounds.min[1] === -1 && parsed.model.bounds.max[1] === 0,
  JSON.stringify(parsed.model.bounds));

const red = G.parseGlb(tetraGlb({ color: [1, 0, 0] }));
check('material baseColorFactor becomes the triangle color',
  red.ok && red.model.tris.every(t => t.color[0] === 1 && t.color[1] === 0 && t.color[2] === 0));

const moved = G.parseGlb(tetraGlb({ translation: [10, 20, 30] }));
check('node translation is baked into world space',
  (() => {
    if (!moved.ok) return false;
    const xs = [];
    moved.model.tris.forEach(t => { xs.push(t.a[0], t.b[0], t.c[0]); });
    return Math.min(...xs) === 10 && Math.max(...xs) === 11;
  })());

const scaled = G.parseGlb(tetraGlb({ scale: [2, 2, 2] }));
check('node scale is baked into world space',
  (() => {
    if (!scaled.ok) return false;
    const xs = [];
    scaled.model.tris.forEach(t => { xs.push(t.a[0], t.b[0], t.c[0]); });
    return Math.max(...xs) === 2;
  })());

const nonIndexed = G.parseGlb(tetraGlb({ indices: false }));
check('non-indexed geometry parses (4 verts -> 1 triangle)',
  nonIndexed.ok === true && nonIndexed.model.triCount === 1,
  `tris=${nonIndexed.model && nonIndexed.model.triCount}`);

// ---------- parseGlb: hostile input ----------
const hostileCases = [
  ['empty bytes', new Uint8Array(0)],
  ['short header', new Uint8Array([1, 2, 3])],
  ['bad magic', (() => { const b = Buffer.from(tetra); b.writeUInt32LE(0xdeadbeef, 0); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength); })()],
  ['bad version', (() => { const b = Buffer.from(tetra); b.writeUInt32LE(1, 4); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength); })()],
  ['corrupt JSON chunk', buildGlb({ asset: 42 }, new Uint8Array(0))],
  ['no meshes', buildGlb({ asset: { version: '2.0' }, scenes: [{ nodes: [] }] }, new Uint8Array(0))],
  ['null input', null],
  ['plain array', [1, 2, 3, 4]],
];
let hostileOk = true;
hostileCases.forEach(([label, input]) => {
  let r = null, threw = false;
  try { r = G.parseGlb(input); } catch (e) { threw = true; }
  if (threw || !r || r.ok !== false || typeof r.error !== 'string' || !r.error) {
    hostileOk = false;
    console.log(`NOT OK - hostile case never throws and reports ok:false: ${label}`);
  }
});
check('hostile GLB inputs all fail cleanly (no throws)', hostileOk);

check('primitive without POSITION is skipped, not fatal',
  (() => {
    const json = {
      asset: { version: '2.0' }, buffers: [{ byteLength: 0 }],
      meshes: [{ primitives: [{ attributes: {}, material: 0 }] }],
      nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }]
    };
    const r = G.parseGlb(buildGlb(json, new Uint8Array(0)));
    return r.ok === false; // no triangles at all -> clean failure
  })());

// ---------- triangle cap ----------
check('huge models truncate at MAX_MODEL_TRIS instead of hanging',
  (() => {
    // 70k triangles as one non-indexed soup (positions only).
    const n = 70000;
    const pos = new Float32Array(n * 9);
    for (let i = 0; i < n * 9; i++) pos[i] = (i % 7) * 0.13;
    const bin = Buffer.from(pos.buffer, pos.byteOffset, pos.byteLength);
    const json = {
      asset: { version: '2.0' }, buffers: [{ byteLength: bin.length }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
      accessors: [{ bufferView: 0, componentType: 5126, count: n * 3, type: 'VEC3' }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }]
    };
    const t0 = Date.now();
    const r = G.parseGlb(buildGlb(json, new Uint8Array(bin.buffer, bin.byteOffset, bin.byteLength)));
    const ms = Date.now() - t0;
    return r.ok === true && r.model.truncated === true &&
      r.model.triCount === G.MAX_MODEL_TRIS && ms < 15000;
  })());

// ---------- parseGltfText ----------
check('parseGltfText reads embedded-buffer .gltf',
  (() => {
    const bin = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
    const json = {
      asset: { version: '2.0' },
      buffers: [{ byteLength: bin.length, uri: 'data:application/octet-stream;base64,' + bin.toString('base64') }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }]
    };
    const r = G.parseGltfText(JSON.stringify(json));
    return r.ok === true && r.model.triCount === 1;
  })());
check('parseGltfText rejects external .bin with a helpful message',
  (() => {
    const r = G.parseGltfText(JSON.stringify({
      asset: { version: '2.0' }, buffers: [{ byteLength: 100, uri: 'model.bin' }],
      meshes: []
    }));
    return r.ok === false && /\.glb/i.test(r.error);
  })());
check('parseGltfText rejects corrupt JSON without throwing',
  (() => { let threw = false, r = null; try { r = G.parseGltfText('{{{nope'); } catch (e) { threw = true; } return !threw && r && r.ok === false; })());

// ---------- parseModelBytes ----------
check('parseModelBytes dispatches on GLB magic regardless of name',
  G.parseModelBytes(tetra, 'mystery.bin').ok === true);
check('parseModelBytes parses .gltf text by name',
  (() => {
    const text = JSON.stringify({
      asset: { version: '2.0' }, buffers: [],
      meshes: [{ primitives: [] }], nodes: [], scenes: []
    });
    const r = G.parseModelBytes(Buffer.from(text, 'utf8'), 'model.gltf');
    return r.ok === false && typeof r.error === 'string'; // no triangles -> clean fail
  })());
check('parseModelBytes rejects unknown files with a helpful message',
  (() => {
    const r = G.parseModelBytes(new Uint8Array([1, 2, 3, 4]), 'notes.txt');
    return r.ok === false && /\.glb/i.test(r.error);
  })());

// ---------- fitModelToBox ----------
check('fitModelToBox centers and scales the model into the box',
  (() => {
    const mesh = G.fitModelToBox(parsed.model, 120, 120, 120);
    if (!mesh.tris.length || mesh.tris.length !== mesh.colors.length) return false;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    mesh.verts.forEach(v => {
      if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
      if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
    });
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const size = Math.max(maxX - minX, maxY - minY);
    return Math.abs(cx) < 1e-9 && Math.abs(cy) < 1e-9 && size <= 120 + 1e-9 && size > 0;
  })());
check('fitModelToBox preserves per-triangle colors',
  (() => {
    const mesh = G.fitModelToBox(red.model, 100, 100, 100);
    return mesh.colors.length === mesh.tris.length &&
      mesh.colors.every(c => c[0] === 1 && c[1] === 0 && c[2] === 0);
  })());
check('fitModelToBox never throws on hostile models',
  (() => {
    let threw = false;
    try {
      const a = G.fitModelToBox(null, 100, 100, 100);
      const b = G.fitModelToBox({ tris: [{ a: [NaN, 0, 0] }] }, -5, 0, 'x');
      const c = G.fitModelToBox({ tris: 'nope', bounds: null }, 100, 100, 100);
      if (!a || !b || !c) threw = true;
    } catch (e) { threw = true; }
    return !threw;
  })());

// ---------- decodeUtf8 ----------
check('decodeUtf8 round-trips ASCII',
  G.decodeUtf8(new Uint8Array([104, 105])) === 'hi');

// ---------- textures (3D2 batch 2) ----------
// Textured quad GLB builder: a 2-triangle quad with TEXCOORD_0 UVs, an
// embedded image (bufferView), a texture pointing at it, and a material
// with baseColorTexture. opts: uvAccessor (float|ushort-normalized|none),
// image (present|external|missing|oversize), textureIndex (valid|bad).
const FAKE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
function texturedQuadGlb(opts) {
  opts = opts || {};
  const positions = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0];
  const indices = [0, 1, 2, 0, 2, 3];
  const posArr = new Float32Array(positions);
  const idxArr = new Uint16Array(indices);
  const uvKind = opts.uvAccessor || 'float';
  let uvBytes, uvComp, uvCount = 4;
  if (uvKind === 'ushort-normalized') {
    const u = new Uint16Array([0, 0, 65535, 0, 65535, 65535, 0, 65535]);
    uvBytes = Buffer.from(u.buffer, u.byteOffset, u.byteLength); uvComp = 5123;
  } else {
    const u = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
    uvBytes = Buffer.from(u.buffer, u.byteOffset, u.byteLength); uvComp = 5126;
  }
  const imgBytes = opts.image === 'oversize'
    ? Buffer.alloc(8 * 1024 * 1024 + 1, 7) : FAKE_PNG;
  const parts = [
    Buffer.from(posArr.buffer, posArr.byteOffset, posArr.byteLength),
    Buffer.from(idxArr.buffer, idxArr.byteOffset, idxArr.byteLength),
    uvKind === 'none' ? Buffer.alloc(0) : uvBytes,
    opts.image === 'missing' ? Buffer.alloc(0) : imgBytes
  ];
  const bufferViews = [];
  const accessors = [];
  function addView(byteOffset, byteLength) {
    bufferViews.push({ buffer: 0, byteOffset, byteLength });
    return bufferViews.length - 1;
  }
  let off = 0;
  const posView = addView(off, parts[0].length); off += parts[0].length;
  const idxView = addView(off, parts[1].length); off += parts[1].length;
  accessors.push({ bufferView: posView, componentType: 5126, count: 4, type: 'VEC3' });
  accessors.push({ bufferView: idxView, componentType: 5123, count: indices.length, type: 'SCALAR' });
  let uvAcc = null;
  if (uvKind !== 'none') {
    const uvView = addView(off, parts[2].length);
    accessors.push({ bufferView: uvView, componentType: uvComp, count: uvCount, type: 'VEC2',
      normalized: uvKind === 'ushort-normalized' });
    uvAcc = accessors.length - 1;
  }
  off += parts[2].length;
  const imgMode = opts.image || 'present';
  let imgView = null;
  if (imgMode === 'present' || imgMode === 'oversize') {
    imgView = addView(off, parts[3].length);
  }
  off += parts[3].length;
  const bin = Buffer.concat(parts.filter(p => p.length));
  const prim = { attributes: { POSITION: 0 }, indices: 1, material: 0 };
  if (uvAcc != null) prim.attributes.TEXCOORD_0 = uvAcc;
  const texWanted = opts.textureIndex === 'bad' ? 7 : 0;
  const images = [];
  if (imgMode === 'present' || imgMode === 'oversize') {
    images.push({ bufferView: imgView, mimeType: 'image/png' });
  } else if (imgMode === 'external') {
    images.push({ uri: 'texture.png', mimeType: 'image/png' });
  } else if (imgMode === 'data-uri') {
    images.push({ uri: 'data:image/png;base64,' + FAKE_PNG.toString('base64') });
  }
  const json = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: bin.length }],
    bufferViews, accessors,
    images,
    textures: images.length ? [{ source: 0 }] : [],
    materials: [{ name: 'mat',
      pbrMetallicRoughness: {
        baseColorFactor: [1, 1, 1, 1],
        baseColorTexture: { index: texWanted }
      } }],
    meshes: [{ name: 'quad', primitives: [prim] }],
    nodes: [{ name: 'root', mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0
  };
  return buildGlb(json, new Uint8Array(bin.buffer, bin.byteOffset, bin.byteLength));
}

const texParsed = G.parseGlb(texturedQuadGlb());
check('textured GLB parses with one texture record',
  texParsed.ok === true && Array.isArray(texParsed.model.textures) &&
  texParsed.model.textures.length === 1 &&
  texParsed.model.textures[0].mimeType === 'image/png',
  `ok=${texParsed.ok} err=${texParsed.error}`);
check('texture bytes match the embedded image bytes',
  (() => {
    const t = texParsed.model.textures[0];
    return t.bytes && t.bytes.length === FAKE_PNG.length &&
      t.bytes[0] === 0x89 && t.bytes[1] === 0x50;
  })());
check('textured triangles carry UVs and tex index 0',
  (() => {
    const tris = texParsed.model.tris;
    return tris.length === 2 && tris.every(tr =>
      Array.isArray(tr.uv) && tr.uv.length === 3 &&
      tr.uv[0].length === 2 && tr.tex === 0);
  })());
check('quad UVs are the glTF top-left-origin corners',
  (() => {
    const uv = texParsed.model.tris[0].uv;
    return uv[0][0] === 0 && uv[0][1] === 0 && uv[1][0] === 1 && uv[1][1] === 0 &&
      uv[2][0] === 1 && uv[2][1] === 1;
  })());
check('fitModelToBox carries uvs and tex parallel to tris',
  (() => {
    const mesh = G.fitModelToBox(texParsed.model, 100, 100, 100);
    return mesh.uvs.length === mesh.tris.length && mesh.tex.length === mesh.tris.length &&
      mesh.tex.every(t => t === 0) && mesh.uvs.every(u => Array.isArray(u) && u.length === 3);
  })());
check('untextured model: textures [], tris with tex -1 and null uv',
  parsed.ok === true && Array.isArray(parsed.model.textures) &&
  parsed.model.textures.length === 0 &&
  parsed.model.tris.every(tr => tr.tex === -1 && tr.uv === null));
check('normalized ushort UVs de-normalize to 0..1',
  (() => {
    const p = G.parseGlb(texturedQuadGlb({ uvAccessor: 'ushort-normalized' }));
    if (!p.ok) return false;
    const uv = p.model.tris[0].uv;
    return Math.abs(uv[1][0] - 1) < 0.001 && uv[0][0] === 0 && uv[2][1] > 0.999;
  })());
check('missing TEXCOORD_0 degrades to flat colors (tex -1)',
  (() => {
    const p = G.parseGlb(texturedQuadGlb({ uvAccessor: 'none' }));
    return p.ok === true && p.model.tris.every(tr => tr.tex === -1 && tr.uv === null);
  })());
check('bad texture index on the material is skipped, geometry survives',
  (() => {
    const p = G.parseGlb(texturedQuadGlb({ textureIndex: 'bad' }));
    return p.ok === true && p.model.triCount === 2 &&
      p.model.textures.length === 1 && p.model.tris.every(tr => tr.tex === -1);
  })());
check('external-uri image is skipped (flat colors), not an error',
  (() => {
    const p = G.parseGlb(texturedQuadGlb({ image: 'external' }));
    return p.ok === true && p.model.triCount === 2 && p.model.textures.length === 0;
  })());
check('oversize texture image is skipped, geometry survives',
  (() => {
    const p = G.parseGlb(texturedQuadGlb({ image: 'oversize' }));
    return p.ok === true && p.model.triCount === 2 && p.model.textures.length === 0;
  })());
check('data-URI image uri decodes into texture bytes',
  (() => {
    const p = G.parseGlb(texturedQuadGlb({ image: 'data-uri' }));
    return p.ok === true && p.model.textures.length === 1 &&
      p.model.textures[0].bytes.length === FAKE_PNG.length;
  })());
check('bytesToBase64 round-trips bytesFromDataUrl',
  (() => {
    const bytes = new Uint8Array([1, 2, 3, 250, 255]);
    const b64 = G.bytesToBase64(bytes);
    const back = G.bytesFromDataUrl('data:image/png;base64,' + b64);
    return back && back.length === 5 && back[0] === 1 && back[3] === 250 && back[4] === 255 &&
      typeof G.bytesToBase64 === 'function';
  })());
check('texture parsing never throws on hostile texture tables',
  (() => {
    let threw = false, okModel = false;
    try {
      const p = G.parseGlb(texturedQuadGlb());
      okModel = p.ok === true;
      const hostile = [
        { textures: 'nope', images: null },
        { textures: [{ source: -1 }], images: [{ bufferView: 99 }] },
        { textures: [null], images: [null] },
        { textures: [{ source: 0 }], images: [{ bufferView: 0, mimeType: 'text/plain' }] }
      ];
      hostile.forEach(h => {
        const json = JSON.parse(JSON.stringify({ asset: { version: '2.0' }, scenes: [{ nodes: [] }], ...h }));
        G.parseGltfText(JSON.stringify(json));
      });
    } catch (e) { threw = true; }
    return !threw && okModel;
  })());

process.exit(failures === 0 ? 0 : 1);
