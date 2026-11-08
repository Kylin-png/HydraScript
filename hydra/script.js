// ============================================================
// HydraScript Engine v3 — script.js
// ============================================================

// ---------- Loading Screen ----------
function initLoadingScreen() {
  const loadingScreen = document.getElementById('app-loading-screen');
  const progressBar   = document.getElementById('loading-progress-bar');
  const statusText    = document.getElementById('loading-status');
  const subtext       = document.getElementById('loading-subtext');
  if (!loadingScreen) return;
  const steps = [
    { progress: 20,  status: 'Initializing Engine...',  subtext: 'loading core modules...' },
    { progress: 45,  status: 'Loading Assets...',       subtext: 'fetching project data...' },
    { progress: 70,  status: 'Preparing Workspace...',  subtext: 'setting up scene system...' },
    { progress: 90,  status: 'Restoring State...',      subtext: 'rebuilding project...' },
    { progress: 100, status: 'Ready!',                  subtext: 'launching Hydra Script...' }
  ];
  let step = 0;
  const tick = () => {
    if (step >= steps.length) { setTimeout(() => loadingScreen.classList.add('hidden'), 400); return; }
    progressBar.style.width = `${steps[step].progress}%`;
    statusText.textContent  = steps[step].status;
    subtext.textContent     = steps[step].subtext;
    step++;
    setTimeout(tick, 350 + Math.random() * 350);
  };
  tick();
}
document.addEventListener('DOMContentLoaded', initLoadingScreen);

// ============================================================
// ASSET LIBRARY — stores uploaded images as base64 keyed by assetId
// ============================================================
const assetLibrary = {}; // assetId -> { name, dataUrl }
window.assetLibrary = assetLibrary;

// Downscale a still image data URL that is larger than the asset limit.
// GIFs pass through untouched — redrawing one through a canvas would freeze
// it to a single frame. Calls back with (dataUrl, wasDownscaled, w, h).
function maybeDownscaleImage(dataUrl, mime, callback) {
  const HU = window.HydraUniversal || {};
  const maxSide = typeof HU.ASSET_MAX_IMAGE_SIDE === 'number' ? HU.ASSET_MAX_IMAGE_SIDE : 1024;
  if ((mime || '').toLowerCase() === 'image/gif' || typeof Image === 'undefined' || typeof document === 'undefined') {
    callback(dataUrl, false, 0, 0);
    return;
  }
  const img = new Image();
  img.onload = () => {
    const dims = typeof HU.downscaleDimensions === 'function'
      ? HU.downscaleDimensions(img.naturalWidth, img.naturalHeight, maxSide)
      : { width: img.naturalWidth, height: img.naturalHeight, downscaled: false };
    if (!dims.downscaled) { callback(dataUrl, false, img.naturalWidth, img.naturalHeight); return; }
    try {
      const canvas = document.createElement('canvas');
      canvas.width = dims.width; canvas.height = dims.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, dims.width, dims.height);
      const outMime = (mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/webp') ? mime : 'image/png';
      callback(canvas.toDataURL(outMime), true, dims.width, dims.height);
    } catch (err) {
      callback(dataUrl, false, img.naturalWidth, img.naturalHeight);
    }
  };
  img.onerror = () => callback(dataUrl, false, 0, 0);
  img.src = dataUrl;
}

// Stores an uploaded file in the asset library. On success calls back with
// the new asset id; on refusal (file over the size limit) calls back with
// (null, reason) so the caller can tell the user why in plain words.
function storeAsset(file, callback) {
  const HU = window.HydraUniversal || {};
  if (typeof HU.validateUploadFile === 'function') {
    const check = HU.validateUploadFile(file);
    if (!check.ok) { if (callback) callback(null, check.reason); return; }
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const finish = (dataUrl, downscaled, width, height) => {
      const id = 'asset_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      const rec = { name: file.name, dataUrl: dataUrl };
      // Backfill kind/mime/sizeBytes from the data URL (HydraUniversal helper).
      // A downscaled image reports the stored size, not the original file's.
      if (window.HydraUniversal && typeof window.HydraUniversal.normalizeAsset === 'function') {
        window.HydraUniversal.normalizeAsset(rec);
      } else {
        rec.kind = (file.type || '').indexOf('audio/') === 0 ? 'audio'
          : (file.type || '').indexOf('image/') === 0 ? 'image' : 'other';
        rec.mime = file.type || '';
      }
      // P4 item 3D2: .glb/.gltf uploads are 3D model assets (the File type is
      // unreliable for models, so the extension decides).
      if (/\.(glb|gltf)$/i.test(file.name || '')) {
        rec.kind = 'model';
        if (!rec.mime) rec.mime = /\.gltf$/i.test(file.name || '') ? 'model/gltf+json' : 'model/gltf-binary';
      }
      if (!downscaled && file.size) rec.sizeBytes = file.size;
      if (width) rec.width = width;
      if (height) rec.height = height;
      assetLibrary[id] = rec;
      // Keep the asset-manager panel fresh when sprites/backgrounds upload.
      if (typeof refreshAssetManager === 'function') refreshAssetManager();
      callback(id);
    };
    // Still images are downscaled before they are stored; audio, models,
    // and GIFs pass through as-is.
    const mime = (file.type || '').toLowerCase();
    if (mime.indexOf('image/') === 0) maybeDownscaleImage(e.target.result, mime, finish);
    else finish(e.target.result, false, 0, 0);
  };
  reader.readAsDataURL(file);
}

// Replace an asset's file in place: keeps the id (all references stay valid),
// refreshes metadata, and invalidates the preview image caches so the new
// file shows up everywhere immediately. Same size guard and image downscale
// as storeAsset; on refusal calls back with (null, reason).
function replaceAssetFile(id, file, callback) {
  const HU = window.HydraUniversal || {};
  if (typeof HU.validateUploadFile === 'function') {
    const check = HU.validateUploadFile(file);
    if (!check.ok) { if (callback) callback(null, check.reason); return; }
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const finish = (dataUrl, downscaled, width, height) => {
      const rec = assetLibrary[id];
      if (!rec) { if (callback) callback(null); return; }
      rec.name = file.name;
      rec.dataUrl = dataUrl;
      if (window.HydraUniversal && typeof window.HydraUniversal.normalizeAsset === 'function') {
        delete rec.kind; delete rec.mime; delete rec.sizeBytes;
        window.HydraUniversal.normalizeAsset(rec);
      }
      if (!downscaled && file.size) rec.sizeBytes = file.size;
      if (width) rec.width = width; else delete rec.width;
      if (height) rec.height = height; else delete rec.height;
      delete imageCache[id];
      delete bgImageCache[id];
      // P4 item 3D2: a replaced file changes the model bytes — drop the
      // parsed-model caches so the new file shows up immediately.
      if (typeof modelDocCache === 'object' && modelDocCache) delete modelDocCache[id];
      if (typeof modelTexCache === 'object' && modelTexCache) delete modelTexCache[id];
      clearModelMeshCacheFor(id);
      if (typeof refreshAssetManager === 'function') refreshAssetManager();
      if (callback) callback(id);
    };
    const mime = (file.type || '').toLowerCase();
    if (mime.indexOf('image/') === 0) maybeDownscaleImage(e.target.result, mime, finish);
    else finish(e.target.result, false, 0, 0);
  };
  reader.readAsDataURL(file);
}

// ============================================================
// 3D MODEL CACHE (P4 item 3D2) — parsed glTF/GLB assets.
// modelDocCache: assetId -> { rec, dataUrl, doc } (doc null = parse failed,
// still cached so a broken file is not re-parsed every frame).
// modelMeshCache: "<assetId>|<w>|<h>|<d>" -> { doc, mesh } fitted hydra-3d
// mesh. Identity checks (rec/dataUrl by reference) invalidate automatically
// when a file is replaced; assetDelete/replaceAssetFile clear explicitly.
// ============================================================
const modelDocCache = {};
const modelMeshCache = {};

// P4 item 3D2 batch 2 (texture mapping): decoded model textures.
// modelTexCache: assetId -> { dataUrl, images: { texIndex: HTMLImageElement
// or 'failed' } }. Decoding is async (Image onload); until an image is
// ready the model draws with its flat colors, and when it lands the mesh
// cache for that asset is dropped so the next frame re-fits with the
// texture attached. Never throws.
const modelTexCache = {};

function clearModelMeshCacheFor(id) {
  if (typeof modelMeshCache === 'object' && modelMeshCache) {
    Object.keys(modelMeshCache).forEach(k => { if (k.indexOf(id + '|') === 0) delete modelMeshCache[k]; });
  }
}

function refreshModel3dThumbs() {
  try {
    document.querySelectorAll('.game-object').forEach(el => {
      const id = el.getAttribute('data-id');
      const obj = id && typeof getCurrentScene === 'function'
        ? (getCurrentScene().objects || []).find(o => String(o.id) === String(id)) : null;
      if (obj && obj.kind === 'model3d') draw3dElementCanvas(obj, el);
    });
    if (typeof renderEditor3dView === 'function') renderEditor3dView();
  } catch (e) { /* thumbnails are decoration; never break the frame */ }
}

// Kick off decoding of a parsed model's texture images and return the
// currently-ready ones as { texIndex: HTMLImageElement }. Safe to call
// every frame — decodes start once per asset dataUrl.
function modelTextureImages(assetId, doc) {
  const out = {};
  try {
    const G = window.HydraGltf;
    if (!G || !assetId || !doc || !Array.isArray(doc.textures) || !doc.textures.length) return out;
    if (typeof Image === 'undefined') return out;
    const rec = assetLibrary[assetId];
    let entry = modelTexCache[assetId];
    if (!entry || entry.dataUrl !== (rec && rec.dataUrl)) {
      entry = { dataUrl: rec && rec.dataUrl, images: {} };
      modelTexCache[assetId] = entry;
    }
    doc.textures.forEach((tex, i) => {
      if (!tex || !tex.bytes || !tex.bytes.length) return;
      const have = entry.images[i];
      if (have === 'failed') return;
      if (have && have.complete && have.naturalWidth > 0) { out[i] = have; return; }
      if (have) return; // still decoding
      try {
        const img = new Image();
        entry.images[i] = img;
        img.onload = () => {
          clearModelMeshCacheFor(assetId);
          refreshModel3dThumbs();
        };
        img.onerror = () => { entry.images[i] = 'failed'; };
        img.src = 'data:' + (tex.mimeType || 'image/png') + ';base64,' + G.bytesToBase64(tex.bytes);
      } catch (e) { entry.images[i] = 'failed'; }
    });
  } catch (e) { /* flat colors are the honest fallback */ }
  return out;
}

function getModelDoc(assetId) {
  const G = window.HydraGltf;
  if (!G || !assetId || typeof assetId !== 'string') return null;
  const rec = assetLibrary[assetId];
  if (!rec) return null;
  const hit = modelDocCache[assetId];
  if (hit && hit.rec === rec && hit.dataUrl === rec.dataUrl) return hit.doc;
  let doc = null;
  try {
    const bytes = G.modelAssetBytes(rec);
    if (bytes && bytes.length) {
      const parsed = G.parseModelBytes(bytes, rec.name || '');
      if (parsed && parsed.ok) doc = parsed.model;
    }
  } catch (e) { doc = null; }
  modelDocCache[assetId] = { rec: rec, dataUrl: rec.dataUrl, doc: doc };
  return doc;
}

// The resolveModel hook hydra-3d.js calls for model3d objects: returns a
// fitted { verts, tris, colors, cacheKey } mesh, or null when the model is
// not ready (the 3D pass draws a placeholder box instead). Never throws.
function resolveModelMeshFor(obj) {
  const G = window.HydraGltf;
  if (!G || !obj || obj.kind !== 'model3d') return null;
  const doc = getModelDoc(obj.modelAssetId);
  if (!doc) return null;
  const w = Math.max(1, Number(obj.width) || 120);
  const h = Math.max(1, Number(obj.height) || 120);
  const d = Math.max(1, Number(obj.depth) || 120);
  const key = String(obj.modelAssetId) + '|' + w + '|' + h + '|' + d;
  const hit = modelMeshCache[key];
  if (hit && hit.doc === doc) return hit.mesh;
  let mesh = null;
  try { mesh = G.fitModelToBox(doc, w, h, d); } catch (e) { mesh = null; }
  if (mesh && Array.isArray(mesh.tris) && mesh.tris.length) {
    mesh.cacheKey = key;
    // P4 item 3D2 batch 2: attach the decoded texture images (ready ones
    // only — the rest paint flat until their onload clears this cache).
    try { mesh.texImages = modelTextureImages(obj.modelAssetId, doc); } catch (e) { mesh.texImages = {}; }
    modelMeshCache[key] = { doc: doc, mesh: mesh };
    return mesh;
  }
  return null;
}
window.resolveModelMeshFor = resolveModelMeshFor;

// ============================================================
// ASSET MANAGER PANEL — guided UI over the asset library.
// Shows every uploaded file with preview, size, usage, and
// rename / replace / delete. Usage is computed from the live
// scene data via HydraUniversal helpers.
// ============================================================
function assetManagerUsages() {
  if (window.HydraUniversal && typeof window.HydraUniversal.collectAssetUsage === 'function') {
    return window.HydraUniversal.collectAssetUsage({ scenes: scenes });
  }
  return {};
}

function refreshAssetManager() {
  const listEl = document.getElementById('asset-list');
  const summaryEl = document.getElementById('asset-storage-summary');
  if (!listEl) return; // editor DOM not ready
  const HU = window.HydraUniversal || {};
  const ids = Object.keys(assetLibrary);
  const usages = assetManagerUsages();
  const fmt = typeof HU.formatBytes === 'function' ? HU.formatBytes : (n => n + ' B');

  // Storage summary
  let totalBytes = 0;
  ids.forEach(id => {
    const rec = assetLibrary[id];
    if (HU.normalizeAsset) HU.normalizeAsset(rec);
    totalBytes += Number(rec.sizeBytes) || 0;
  });
  if (summaryEl) {
    summaryEl.textContent = ids.length === 0
      ? 'No assets yet. Upload images, audio, GIFs, or 3D models (.glb/.gltf) to use them in your game. Files up to 8 MB; large images are scaled down to 1024 px on upload.'
      : `${ids.length} asset${ids.length === 1 ? '' : 's'} — ${fmt(totalBytes)} total.`;
  }

  // Rows
  listEl.innerHTML = '';
  if (ids.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'asset-empty';
    empty.textContent = 'Nothing uploaded yet. Click the upload button above to add images, audio, GIFs, or 3D models (.glb/.gltf).';
    listEl.appendChild(empty);
    return;
  }
  ids.forEach(id => {
    const rec = assetLibrary[id];
    const used = usages[id] || [];
    const row = document.createElement('div');
    row.className = 'asset-row';
    row.dataset.assetId = id;

    const thumb = document.createElement('div');
    thumb.className = 'asset-thumb';
    if (rec.kind === 'image' && rec.dataUrl) {
      const img = document.createElement('img');
      img.src = rec.dataUrl;
      img.alt = rec.name || 'asset';
      thumb.appendChild(img);
    } else {
      const icon = document.createElement('i');
      // P4 item 3D2: 3D model assets get a cube icon.
      icon.className = rec.kind === 'audio' ? 'fas fa-volume-up' : rec.kind === 'model' ? 'fas fa-cube' : 'fas fa-file';
      thumb.appendChild(icon);
    }
    row.appendChild(thumb);

    const meta = document.createElement('div');
    meta.className = 'asset-meta';
    const nameEl = document.createElement('div');
    nameEl.className = 'asset-name';
    nameEl.textContent = rec.name || 'Untitled asset';
    meta.appendChild(nameEl);
    const sub = document.createElement('div');
    sub.className = 'asset-sub';
    const kindLabel = document.createElement('span');
    let kindText = `${rec.kind === 'image' ? 'Image' : rec.kind === 'audio' ? 'Audio' : rec.kind === 'model' ? '3D Model' : 'File'} · ${fmt(rec.sizeBytes || 0)}`;
    // P4 item 3D2 batch 2: say when a model carries textures.
    if (rec.kind === 'model' && id) {
      try {
        const doc = getModelDoc(id);
        if (doc && doc.textures && doc.textures.length) kindText += ' · texture';
      } catch (e) { /* parse failures are shown elsewhere */ }
    }
    kindLabel.textContent = kindText;
    sub.appendChild(kindLabel);
    const badge = document.createElement('span');
    badge.className = 'asset-badge' + (used.length ? '' : ' unused');
    badge.textContent = used.length ? `Used in ${used.length} place${used.length === 1 ? '' : 's'}` : 'Unused';
    if (used.length) {
      badge.title = used.map(u =>
        (u.where === 'sprite' ? `Sprite "${u.objectName}"` :
         u.where === 'background' ? `Background of "${u.sceneName}"` :
         // P4 item 3D2: model3d objects reference model assets.
         u.where === 'model' ? `3D Model on "${u.objectName}"` :
         `Component on "${u.objectName}"`)
      ).join('\n');
    }
    sub.appendChild(badge);
    meta.appendChild(sub);
    row.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'asset-actions';
    const renameBtn = document.createElement('button');
    renameBtn.className = 'asset-action-btn asset-rename-btn';
    renameBtn.textContent = 'Rename';
    renameBtn.addEventListener('click', () => assetRename(id));
    const replaceBtn = document.createElement('button');
    replaceBtn.className = 'asset-action-btn asset-replace-btn';
    replaceBtn.textContent = 'Replace';
    replaceBtn.addEventListener('click', () => assetReplace(id));
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'asset-action-btn danger asset-delete-btn';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => assetDelete(id));
    actions.appendChild(renameBtn);
    actions.appendChild(replaceBtn);
    actions.appendChild(deleteBtn);
    row.appendChild(actions);

    listEl.appendChild(row);
  });
}
window.refreshAssetManager = refreshAssetManager;

function assetRename(id) {
  const rec = assetLibrary[id];
  if (!rec) return;
  const next = prompt('Rename asset:', rec.name || '');
  if (next === null) return; // cancelled
  const trimmed = String(next).trim();
  if (!trimmed) return;
  rec.name = trimmed;
  markProjectDirty();
  refreshAssetManager();
}

function assetReplace(id) {
  if (!assetLibrary[id]) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,audio/*,.gif,.glb,.gltf';
  input.style.display = 'none';
  input.addEventListener('change', () => {
    if (!input.files || !input.files[0]) { input.remove(); return; }
    replaceAssetFile(id, input.files[0], (replacedId, err) => {
      if (!replacedId && err) { alert(err); return; }
      markProjectDirty();
      refreshAssetManager();
      if (typeof renderSceneObjects === 'function') renderSceneObjects();
    });
    input.remove();
  });
  document.body.appendChild(input);
  input.click();
}

function assetDelete(id) {
  const rec = assetLibrary[id];
  if (!rec) return;
  const HU = window.HydraUniversal || {};
  const usages = assetManagerUsages()[id] || [];
  let msg = `Delete asset "${rec.name || 'Untitled asset'}"?`;
  if (usages.length) {
    const where = usages.map(u =>
      u.where === 'sprite' ? `sprite "${u.objectName}"` :
      u.where === 'background' ? `background of scene "${u.sceneName}"` :
      `component on "${u.objectName}"`
    ).join(', ');
    msg += `\n\nIt is used by: ${where}.\nDeleting will clear those references (objects lose their image, scenes lose their background).`;
  }
  if (!confirm(msg)) return;
  const cleared = typeof HU.removeAssetReferences === 'function'
    ? HU.removeAssetReferences({ scenes: scenes }, id) : 0;
  delete assetLibrary[id];
  // Invalidate preview caches so the deleted asset can never reappear.
  if (typeof imageCache === 'object' && imageCache) delete imageCache[id];
  if (typeof bgImageCache === 'object' && bgImageCache) delete bgImageCache[id];
  // P4 item 3D2: drop parsed-model caches for the deleted asset.
  if (typeof modelDocCache === 'object' && modelDocCache) delete modelDocCache[id];
  if (typeof modelTexCache === 'object' && modelTexCache) delete modelTexCache[id];
  clearModelMeshCacheFor(id);
  markProjectDirty();
  refreshAssetManager();
  if (typeof renderSceneObjects === 'function') renderSceneObjects();
  return cleared;
}

function initAssetManager() {
  const uploadBtn = document.getElementById('asset-upload-btn');
  const fileInput = document.getElementById('asset-upload-file');
  const assetsTabBtn = document.querySelector('.inspector-tab[data-inspector-tab="assets"]');
  if (!uploadBtn || !fileInput) return;
  uploadBtn.addEventListener('click', () => fileInput.click());
  if (assetsTabBtn) assetsTabBtn.addEventListener('click', refreshAssetManager);
  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files || []);
    if (!files.length) return;
    let skipped = 0;
    let done = 0;
    const rejected = [];
    const finishOne = () => {
      done++;
      if (done === files.length) {
        fileInput.value = '';
        const notes = [];
        if (skipped) notes.push(`${skipped} file(s) were skipped — only images, audio, GIFs, and 3D model files (.glb/.gltf) are supported.`);
        if (rejected.length) notes.push(...rejected);
        if (notes.length) alert(notes.join('\n\n'));
        refreshAssetManager();
      }
    };
    files.forEach(file => {
      const t = (file.type || '').toLowerCase();
      const isGifName = /\.gif$/i.test(file.name || '');
      // P4 item 3D2: .glb/.gltf 3D model files (the File type is unreliable
      // for models, so the extension decides).
      const isModelName = /\.(glb|gltf)$/i.test(file.name || '');
      const okKind = t.indexOf('image/') === 0 || t.indexOf('audio/') === 0 || isGifName || isModelName;
      if (!okKind) { skipped++; finishOne(); return; }
      storeAsset(file, (assetId, err) => {
        if (!assetId && err) rejected.push(err);
        else markProjectDirty();
        finishOne();
      });
    });
  });
  // Keep the panel fresh when assets arrive through the sprite/background
  // uploaders elsewhere in the editor.
  refreshAssetManager();
}
window.initAssetManager = initAssetManager;

// ============================================================
// INPUT ACTIONS (P4 item 29 — action-based input)
// Project-level named actions (Inputs tab): each action binds keyboard
// keys, one gamepad button, and one touch zone. Blocks read the action,
// never the raw key.
// ============================================================
function getMutableInputActions() {
  // window.projectManager is assigned on DOMContentLoaded (project.js), so
  // the bare name is not safe to reference during script load.
  const project = window.projectManager?.getCurrentProject?.();
  if (!project) return null;
  if (!Array.isArray(project.inputActions)) project.inputActions = [];
  return project.inputActions;
}

function inputActionDisplayKey(key) {
  const k = String(key || '');
  return k || '(none)';
}

function renderInputActionsPanel() {
  const list = document.getElementById('input-action-list');
  if (!list) return;
  const mod = window.HydraActions;
  const actions = getMutableInputActions() || [];
  list.innerHTML = '';
  if (!actions.length) {
    const empty = document.createElement('p');
    empty.className = 'hint-text';
    empty.textContent = 'No actions yet. Add one, or use the wand button for a ready-made platformer set.';
    list.appendChild(empty);
  }
  const touchOpts = [['none', 'No touch binding'], ...mod.TOUCH_ZONES.map(z => [z, mod.TOUCH_ZONE_LABELS[z]])];
  const padOpts = [[-1, 'No gamepad button'], ...mod.GAMEPAD_BUTTONS.map(([v, t]) => [v, t])];
  actions.forEach((action, index) => {
    const row = document.createElement('div');
    row.className = 'input-action-row';
    const keys = Array.isArray(action.keys) ? action.keys : [];
    row.innerHTML = `
      <div class="input-action-top">
        <input class="property-input input-action-name" value="" placeholder="Action name" title="Action name">
        <button type="button" class="icon-btn input-action-delete" title="Delete action" aria-label="Delete action"><i class="fas fa-trash"></i></button>
      </div>
      <div class="input-action-bindings"></div>
    `;
    const nameInput = row.querySelector('.input-action-name');
    nameInput.value = action.name || '';
    nameInput.addEventListener('input', () => {
      action.name = nameInput.value.trim();
      markProjectDirty();
    });
    row.querySelector('.input-action-delete').addEventListener('click', () => {
      actions.splice(index, 1);
      markProjectDirty();
      renderInputActionsPanel();
    });
    const bindings = row.querySelector('.input-action-bindings');
    // Primary + secondary key capture buttons.
    for (let slot = 0; slot < 2; slot++) {
      const label = document.createElement('span');
      label.className = 'input-action-label';
      label.textContent = slot === 0 ? 'Key:' : 'Alt key:';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'input-action-keybtn';
      const refresh = () => { btn.textContent = inputActionDisplayKey(keys[slot]); };
      refresh();
      btn.title = 'Click, then press a key to bind it';
      btn.addEventListener('click', () => {
        btn.textContent = 'press a key…';
        const capture = (e) => {
          e.preventDefault();
          e.stopPropagation();
          document.removeEventListener('keydown', capture, true);
          const code = e.code || e.key;
          if (code === 'Escape') { refresh(); return; }
          keys[slot] = code;
          action.keys = keys.filter(Boolean);
          markProjectDirty();
          refresh();
        };
        document.addEventListener('keydown', capture, true);
      });
      const wrap = document.createElement('div');
      wrap.className = 'input-action-field';
      wrap.append(label, btn);
      bindings.appendChild(wrap);
    }
    const padWrap = document.createElement('div');
    padWrap.className = 'input-action-field';
    const padLabel = document.createElement('span');
    padLabel.className = 'input-action-label';
    padLabel.textContent = 'Gamepad:';
    const padSel = makeSelect(padOpts, action.gamepad == null ? -1 : Number(action.gamepad), v => {
      action.gamepad = Number(v);
      markProjectDirty();
    });
    padWrap.append(padLabel, padSel);
    bindings.appendChild(padWrap);
    const touchWrap = document.createElement('div');
    touchWrap.className = 'input-action-field';
    const touchLabel = document.createElement('span');
    touchLabel.className = 'input-action-label';
    touchLabel.textContent = 'Touch:';
    const touchSel = makeSelect(touchOpts, action.touch || 'none', v => {
      action.touch = v;
      markProjectDirty();
    });
    touchWrap.append(touchLabel, touchSel);
    bindings.appendChild(touchWrap);
    list.appendChild(row);
  });
}
window.renderInputActionsPanel = renderInputActionsPanel;

function initInputActionsPanel() {
  const addBtn = document.getElementById('input-action-add-btn');
  const presetBtn = document.getElementById('input-action-preset-btn');
  const inputsTabBtn = document.querySelector('.inspector-tab[data-inspector-tab="inputs"]');
  if (inputsTabBtn) inputsTabBtn.addEventListener('click', renderInputActionsPanel);
  if (addBtn) addBtn.addEventListener('click', () => {
    const actions = getMutableInputActions();
    if (!actions) return;
    const base = 'Action';
    let n = actions.length + 1;
    let name = `${base} ${n}`;
    const taken = new Set(actions.map(a => a.name));
    while (taken.has(name)) { n++; name = `${base} ${n}`; }
    actions.push({ name, keys: [], gamepad: -1, touch: 'none' });
    markProjectDirty();
    renderInputActionsPanel();
  });
  if (presetBtn) presetBtn.addEventListener('click', () => {
    const actions = getMutableInputActions();
    if (!actions || !window.HydraActions) return;
    const taken = new Set(actions.map(a => a.name));
    window.HydraActions.defaultPlatformerActions().forEach(preset => {
      if (!taken.has(preset.name)) { actions.push(JSON.parse(JSON.stringify(preset))); taken.add(preset.name); }
    });
    markProjectDirty();
    renderInputActionsPanel();
  });
  renderInputActionsPanel();
}
window.initInputActionsPanel = initInputActionsPanel;

// ============================================================
// AUDIO BUSES (P4 item 30 — Music / SFX / UI)
// Project-level bus mix: per-bus volume + mute, edited in the Audio tab.
// Blocks read project.audioBuses at preview-run start; Set Bus Volume /
// Set Bus Muted change the running mix via previewState.buses.
// ============================================================
function getMutableAudioBuses() {
  // window.projectManager is assigned on DOMContentLoaded (project.js), so
  // the bare name is not safe to reference during script load.
  const project = window.projectManager?.getCurrentProject?.();
  if (!project) return null;
  const B = window.HydraAudioBuses;
  if (!project.audioBuses || typeof project.audioBuses !== 'object' || Array.isArray(project.audioBuses)) {
    project.audioBuses = B ? B.normalizeBuses(null) : {};
  }
  return project.audioBuses;
}

const AUDIO_BUS_NOTES = {
  music: 'Streams audio files (never fully loaded into memory). One track at a time; a new track replaces the old one; loops by default.',
  sfx: 'Up to 8 sounds at once; each file is decoded once and kept in memory, so rapid repeats cost nothing.',
  ui: 'Up to 4 sounds at once; decoded once and kept in memory, for clicks and menu sounds.'
};

function renderAudioBusesPanel() {
  const list = document.getElementById('audio-bus-list');
  if (!list) return;
  const B = window.HydraAudioBuses;
  list.innerHTML = '';
  if (!B) {
    const p = document.createElement('p');
    p.className = 'hint-text';
    p.textContent = 'Audio engine still loading — try again in a moment.';
    list.appendChild(p);
    return;
  }
  const stored = getMutableAudioBuses() || {};
  const buses = B.normalizeBuses(stored);
  // P4 item 37 batch 3: the master fader row — one gain over every bus.
  const projectForMaster = window.projectManager?.getCurrentProject?.();
  const masterRow = document.createElement('div');
  masterRow.className = 'audio-bus-row audio-bus-master';
  masterRow.innerHTML = `
    <div class="audio-bus-top">
      <span class="audio-bus-name">Master</span>
      <span class="audio-bus-pct"></span>
    </div>
    <input type="range" class="audio-bus-slider" min="0" max="100" step="1" title="Master volume" aria-label="Master volume">
    <p class="audio-bus-note">Scales every bus at once — the game's single volume control. Per-bus volumes still apply underneath.</p>
  `;
  const masterPct = masterRow.querySelector('.audio-bus-pct');
  const masterSlider = masterRow.querySelector('.audio-bus-slider');
  const masterRefresh = () => {
    const mv = B.normalizeMasterVolume(projectForMaster ? projectForMaster.masterVolume : 1);
    masterPct.textContent = Math.round(mv * 100) + '%';
    masterSlider.value = String(Math.round(mv * 100));
  };
  masterRefresh();
  masterSlider.addEventListener('input', () => {
    const p = window.projectManager?.getCurrentProject?.();
    if (!p) return;
    p.masterVolume = B.normalizeMasterVolume(Number(masterSlider.value) / 100);
    markProjectDirty();
    masterRefresh();
  });
  list.appendChild(masterRow);
  B.BUS_IDS.forEach(id => {
    const cfg = buses[id];
    const row = document.createElement('div');
    row.className = 'audio-bus-row';
    const pct = Math.round(cfg.volume * 100);
    row.innerHTML = `
      <div class="audio-bus-top">
        <span class="audio-bus-name"></span>
        <span class="audio-bus-pct"></span>
        <button type="button" class="icon-btn audio-bus-mute" title="Mute / unmute this bus"><i class="fas"></i></button>
      </div>
      <input type="range" class="audio-bus-slider" min="0" max="100" step="1" title="Bus volume" aria-label="">
      <p class="audio-bus-note"></p>
    `;
    row.querySelector('.audio-bus-name').textContent = B.BUS_LABELS[id];
    const pctEl = row.querySelector('.audio-bus-pct');
    const muteBtn = row.querySelector('.audio-bus-mute');
    const muteIcon = muteBtn.querySelector('i');
    const slider = row.querySelector('.audio-bus-slider');
    slider.setAttribute('aria-label', B.BUS_LABELS[id] + ' volume');
    row.querySelector('.audio-bus-note').textContent = AUDIO_BUS_NOTES[id] || '';
    const refresh = () => {
      const cur = B.normalizeBuses(getMutableAudioBuses() || {})[id];
      pctEl.textContent = cur.muted ? 'Muted' : Math.round(cur.volume * 100) + '%';
      muteIcon.className = cur.muted ? 'fas fa-volume-mute' : 'fas fa-volume-up';
      muteBtn.title = cur.muted ? 'Unmute this bus' : 'Mute this bus';
      slider.value = String(Math.round(cur.volume * 100));
    };
    refresh();
    slider.addEventListener('input', () => {
      const s = getMutableAudioBuses();
      if (!s) return;
      s[id] = Object.assign({}, B.normalizeBuses(s)[id], { volume: Number(slider.value) / 100 });
      markProjectDirty();
      refresh();
    });
    muteBtn.addEventListener('click', () => {
      const s = getMutableAudioBuses();
      if (!s) return;
      const cur = B.normalizeBuses(s)[id];
      s[id] = Object.assign({}, cur, { muted: !cur.muted });
      markProjectDirty();
      refresh();
    });
    list.appendChild(row);
  });
}
window.renderAudioBusesPanel = renderAudioBusesPanel;

function initAudioBusesPanel() {
  const audioTabBtn = document.querySelector('.inspector-tab[data-inspector-tab="audio"]');
  if (audioTabBtn) audioTabBtn.addEventListener('click', renderAudioBusesPanel);
  renderAudioBusesPanel();
}
window.initAudioBusesPanel = initAudioBusesPanel;

// ============================================================
// LOCALIZATION (P4 Advanced batch 6 — string tables)
// Project-level: default language + language list + key entries,
// edited in the Localization tab. Blocks read project.localization at
// preview-run start; Set Language changes the running language via
// previewState.language (scene switches keep it).
// ============================================================
function getMutableLocalization() {
  // window.projectManager is assigned on DOMContentLoaded (project.js), so
  // the bare name is not safe to reference during script load.
  const project = window.projectManager?.getCurrentProject?.();
  if (!project) return null;
  const L = window.HydraLocalization;
  project.localization = L
    ? L.normalizeLocalization(project.localization)
    : (project.localization && typeof project.localization === 'object' && !Array.isArray(project.localization)
      ? project.localization
      : { defaultLanguage: 'en', languages: ['en'], entries: [] });
  return project.localization;
}

// Renaming a key repoints every block and bound text object that used
// the old key (mirrors propagateStateRename).
function propagateLocalizationKeyRename(oldKey, newKey) {
  if (!oldKey || oldKey === newKey) return;
  const visit = (d) => {
    if (d && (d.type === 'setTextFromKey' || d.type === 'setVariableFromKey') && d.key === oldKey) {
      d.key = newKey;
    }
  };
  const scanGrid = (g) => {
    if (!g) return;
    if (g instanceof Map) g.forEach(visit);
    else Object.values(g).forEach(visit);
  };
  scanGrid(cellData);
  scanGrid(globalGridData);
  (scenes || []).forEach(s => {
    scanGrid(s.gridData);
    (s.objects || []).forEach(o => { if (o.localeKey === oldKey) o.localeKey = newKey; });
  });
  markProjectDirty();
}

function renderLocalizationPanel() {
  const panel = document.getElementById('localization-panel');
  if (!panel) return;
  const L = window.HydraLocalization;
  panel.innerHTML = '';
  if (!L) {
    const p = document.createElement('p');
    p.className = 'hint-text';
    p.textContent = 'Localization engine still loading — try again in a moment.';
    panel.appendChild(p);
    return;
  }
  const loc = getMutableLocalization();
  if (!loc) {
    const p = document.createElement('p');
    p.className = 'hint-text';
    p.textContent = 'Open a project to edit its string table.';
    panel.appendChild(p);
    return;
  }
  // Default language row.
  const defRow = document.createElement('div');
  defRow.className = 'input-action-row';
  defRow.appendChild(makePropGroup('Default language:', makeSelect(
    loc.languages.map(c => [c, c]),
    loc.defaultLanguage,
    v => { loc.defaultLanguage = v; renderLocalizationPanel(); }
  )));
  const defNote = document.createElement('p');
  defNote.className = 'hint-text';
  defNote.textContent = 'The fallback: when a key has no translation in the current language, the game shows the default language\'s text instead.';
  defRow.appendChild(defNote);
  panel.appendChild(defRow);
  // Language rows.
  const langHead = document.createElement('p');
  langHead.className = 'hint-text';
  langHead.textContent = 'Languages (use the + button to add one):';
  panel.appendChild(langHead);
  loc.languages.forEach(code => {
    const row = document.createElement('div');
    row.className = 'input-action-row';
    row.innerHTML = `
      <div class="input-action-top">
        <span class="input-action-label"></span>
        <button type="button" class="icon-btn" title="Delete language"><i class="fas fa-trash"></i></button>
      </div>
    `;
    row.querySelector('.input-action-label').textContent =
      code + (code === loc.defaultLanguage ? ' (default)' : '');
    row.querySelector('button').addEventListener('click', () => {
      const idx = loc.languages.indexOf(code);
      if (idx === -1) return;
      loc.languages.splice(idx, 1);
      if (loc.defaultLanguage === code) {
        loc.defaultLanguage = loc.languages[0] || 'en';
      }
      markProjectDirty();
      renderLocalizationPanel();
    });
    panel.appendChild(row);
  });
  // Entry cards.
  const entryHead = document.createElement('p');
  entryHead.className = 'hint-text';
  entryHead.textContent = 'Strings (use the font button to add one):';
  panel.appendChild(entryHead);
  if (!loc.entries.length) {
    const empty = document.createElement('p');
    empty.className = 'hint-text';
    empty.textContent = 'No strings yet. Add one, give it a key like play_button, and write it in each language.';
    panel.appendChild(empty);
  }
  loc.entries.forEach((entry, entryIdx) => {
    const card = document.createElement('div');
    card.className = 'input-action-row';
    const header = document.createElement('div');
    header.className = 'input-action-top';
    const keyInput = makeTextInput(entry.key || '', 'e.g. play_button', v => { entry.key = v; });
    let keyBeforeEdit = entry.key;
    keyInput.addEventListener('focus', () => { keyBeforeEdit = entry.key; });
    keyInput.addEventListener('change', () => {
      L.normalizeLocalization(loc);
      // Only repoint blocks when the renamed entry survived normalization
      // (a blank or duplicate key is dropped instead of renamed).
      if (loc.entries.indexOf(entry) !== -1) {
        propagateLocalizationKeyRename(keyBeforeEdit, entry.key);
      }
      renderLocalizationPanel();
    });
    const delBtn = document.createElement('button');
    delBtn.type = 'button'; delBtn.className = 'icon-btn'; delBtn.title = 'Delete string';
    delBtn.setAttribute('aria-label', 'Delete string');
    delBtn.innerHTML = '<i class="fas fa-trash"></i>';
    delBtn.addEventListener('click', () => {
      loc.entries.splice(entryIdx, 1);
      markProjectDirty();
      renderLocalizationPanel();
    });
    header.appendChild(keyInput);
    header.appendChild(delBtn);
    card.appendChild(header);
    loc.languages.forEach(code => {
      const val = (entry.values && entry.values[code]) || '';
      card.appendChild(makePropGroup(code + (code === loc.defaultLanguage ? ' (default)' : '') + ':',
        makeTextInput(val, code === loc.defaultLanguage ? '' : 'blank = falls back to default', v => {
          if (!entry.values || typeof entry.values !== 'object') entry.values = {};
          entry.values[code] = v;
        })));
    });
    panel.appendChild(card);
  });
}
window.renderLocalizationPanel = renderLocalizationPanel;

function initLocalizationPanel() {
  const locTabBtn = document.querySelector('.inspector-tab[data-inspector-tab="localization"]');
  if (locTabBtn) locTabBtn.addEventListener('click', renderLocalizationPanel);
  const addLangBtn = document.getElementById('localization-add-language-btn');
  if (addLangBtn) addLangBtn.addEventListener('click', () => {
    const loc = getMutableLocalization();
    if (!loc) return;
    const code = String(prompt('Add language code (for example es):', '') || '').trim();
    if (!code) return;
    if (loc.languages.indexOf(code) === -1) loc.languages.push(code);
    markProjectDirty();
    renderLocalizationPanel();
  });
  const addEntryBtn = document.getElementById('localization-add-entry-btn');
  if (addEntryBtn) addEntryBtn.addEventListener('click', () => {
    const loc = getMutableLocalization();
    if (!loc) return;
    const taken = new Set(loc.entries.map(e => e.key));
    let n = loc.entries.length + 1;
    let key = `string_${n}`;
    while (taken.has(key)) { n++; key = `string_${n}`; }
    loc.entries.push({ key, values: {} });
    markProjectDirty();
    renderLocalizationPanel();
  });
  renderLocalizationPanel();
}
window.initLocalizationPanel = initLocalizationPanel;

// ============================================================
// DIALOGUES (P4 Advanced batch 7 — named conversations)
// Project-level: a list of named dialogues, each a list of lines
// ({ speaker, text, choices: [{ label, goto }] }), edited in the
// Dialogues tab. Blocks read project.dialogues at preview-run start;
// the per-run dialogue runtime lives in the preview runtime module.
// ============================================================
function getMutableDialogues() {
  const project = window.projectManager?.getCurrentProject?.();
  if (!project) return null;
  const D = window.HydraDialogue;
  project.dialogues = D
    ? D.normalizeDialogues(project.dialogues)
    : (Array.isArray(project.dialogues) ? project.dialogues : []);
  return project.dialogues;
}

// Renaming a dialogue repoints every Start Dialogue block that used
// the old name (mirrors propagateLocalizationKeyRename).
function propagateDialogueRename(oldName, newName) {
  if (!oldName || oldName === newName) return;
  const visit = (d) => {
    if (d && d.type === 'startDialogue' && d.dialogue === oldName) {
      d.dialogue = newName;
    }
  };
  const scanGrid = (g) => {
    if (!g) return;
    if (g instanceof Map) g.forEach(visit);
    else Object.values(g).forEach(visit);
  };
  scanGrid(cellData);
  scanGrid(globalGridData);
  (scenes || []).forEach(s => {
    scanGrid(s.gridData);
  });
  markProjectDirty();
}

function renderDialoguesPanel() {
  const panel = document.getElementById('dialogues-panel');
  if (!panel) return;
  const D = window.HydraDialogue;
  panel.innerHTML = '';
  if (!D) {
    const p = document.createElement('p');
    p.className = 'hint-text';
    p.textContent = 'Dialogue engine still loading — try again in a moment.';
    panel.appendChild(p);
    return;
  }
  const dialogues = getMutableDialogues();
  if (!dialogues) {
    const p = document.createElement('p');
    p.className = 'hint-text';
    p.textContent = 'Open a project to write its conversations.';
    panel.appendChild(p);
    return;
  }
  if (!dialogues.length) {
    const empty = document.createElement('p');
    empty.className = 'hint-text';
    empty.textContent = 'No dialogues yet. Add one, name it (for example Guard intro), and write its lines — one row per line, with who speaks and what they say.';
    panel.appendChild(empty);
    return;
  }
  dialogues.forEach((dlg, dlgIdx) => {
    const card = document.createElement('div');
    card.className = 'input-action-row';
    // Name row.
    const header = document.createElement('div');
    header.className = 'input-action-top';
    const nameInput = makeTextInput(dlg.name || '', 'e.g. Guard intro', v => { dlg.name = v; });
    let nameBeforeEdit = dlg.name;
    nameInput.addEventListener('focus', () => { nameBeforeEdit = dlg.name; });
    nameInput.addEventListener('change', () => {
      D.normalizeDialogues(dialogues);
      // Only repoint blocks when the renamed dialogue survived
      // normalization (a blank or duplicate name is dropped instead).
      if (dialogues.indexOf(dlg) !== -1) {
        propagateDialogueRename(nameBeforeEdit, dlg.name);
      }
      renderDialoguesPanel();
    });
    const delBtn = document.createElement('button');
    delBtn.type = 'button'; delBtn.className = 'icon-btn'; delBtn.title = 'Delete dialogue';
    delBtn.setAttribute('aria-label', 'Delete dialogue');
    delBtn.innerHTML = '<i class="fas fa-trash"></i>';
    delBtn.addEventListener('click', () => {
      dialogues.splice(dlgIdx, 1);
      markProjectDirty();
      renderDialoguesPanel();
    });
    header.appendChild(nameInput);
    header.appendChild(delBtn);
    card.appendChild(header);
    // Lines.
    if (!Array.isArray(dlg.lines)) dlg.lines = [];
    dlg.lines.forEach((line, lineIdx) => {
      const row = document.createElement('div');
      row.className = 'input-action-top';
      const num = document.createElement('span');
      num.className = 'input-action-label';
      num.textContent = 'Line ' + (lineIdx + 1);
      row.appendChild(num);
      row.appendChild(makeTextInput(line.speaker || '', 'Speaker', v => { line.speaker = v; }));
      row.appendChild(makeTextInput(line.text || '', 'What they say', v => { line.text = v; }));
      const delLineBtn = document.createElement('button');
      delLineBtn.type = 'button'; delLineBtn.className = 'icon-btn'; delLineBtn.title = 'Delete line';
      delLineBtn.setAttribute('aria-label', 'Delete line');
      delLineBtn.innerHTML = '<i class="fas fa-trash"></i>';
      delLineBtn.addEventListener('click', () => {
        dlg.lines.splice(lineIdx, 1);
        markProjectDirty();
        renderDialoguesPanel();
      });
      row.appendChild(delLineBtn);
      card.appendChild(row);
      // Choices on this line: label + the line the choice jumps to
      // ('End dialogue' when the choice ends the conversation).
      if (!Array.isArray(line.choices)) line.choices = [];
      line.choices.forEach((choice, choiceIdx) => {
        const cRow = document.createElement('div');
        cRow.className = 'input-action-top';
        const cLabel = document.createElement('span');
        cLabel.className = 'input-action-label';
        cLabel.textContent = 'Choice';
        cRow.appendChild(cLabel);
        cRow.appendChild(makeTextInput(choice.label || '', 'e.g. Show the pass', v => { choice.label = v; }));
        const gotoOptions = [['end', 'End dialogue']].concat(
          dlg.lines.map((_, li) => [String(li), 'Line ' + (li + 1)])
        );
        const gotoValue = (choice.goto === null || choice.goto === undefined) ? 'end' : String(choice.goto);
        cRow.appendChild(makeSelect(gotoOptions, gotoValue, v => {
          choice.goto = (v === 'end') ? null : Number(v);
        }));
        const delChoiceBtn = document.createElement('button');
        delChoiceBtn.type = 'button'; delChoiceBtn.className = 'icon-btn'; delChoiceBtn.title = 'Delete choice';
        delChoiceBtn.setAttribute('aria-label', 'Delete choice');
        delChoiceBtn.innerHTML = '<i class="fas fa-trash"></i>';
        delChoiceBtn.addEventListener('click', () => {
          line.choices.splice(choiceIdx, 1);
          markProjectDirty();
          renderDialoguesPanel();
        });
        cRow.appendChild(delChoiceBtn);
        card.appendChild(cRow);
      });
      const addChoiceBtn = document.createElement('button');
      addChoiceBtn.type = 'button'; addChoiceBtn.className = 'icon-btn'; addChoiceBtn.title = 'Add choice';
      addChoiceBtn.setAttribute('aria-label', 'Add choice');
      addChoiceBtn.innerHTML = '<i class="fas fa-plus"></i> Choice';
      addChoiceBtn.addEventListener('click', () => {
        line.choices.push({ label: '', goto: null });
        markProjectDirty();
        renderDialoguesPanel();
      });
      card.appendChild(addChoiceBtn);
    });
    const addLineBtn = document.createElement('button');
    addLineBtn.type = 'button'; addLineBtn.className = 'icon-btn'; addLineBtn.title = 'Add line';
    addLineBtn.setAttribute('aria-label', 'Add line');
    addLineBtn.innerHTML = '<i class="fas fa-plus"></i> Line';
    addLineBtn.addEventListener('click', () => {
      dlg.lines.push({ speaker: '', text: '', choices: [] });
      markProjectDirty();
      renderDialoguesPanel();
    });
    card.appendChild(addLineBtn);
    panel.appendChild(card);
  });
}
window.renderDialoguesPanel = renderDialoguesPanel;

function initDialoguesPanel() {
  const dlgTabBtn = document.querySelector('.inspector-tab[data-inspector-tab="dialogues"]');
  if (dlgTabBtn) dlgTabBtn.addEventListener('click', renderDialoguesPanel);
  const addBtn = document.getElementById('dialogues-add-btn');
  if (addBtn) addBtn.addEventListener('click', () => {
    const dialogues = getMutableDialogues();
    if (!dialogues) return;
    const taken = new Set(dialogues.map(d => d.name));
    let n = dialogues.length + 1;
    let name = `Dialogue ${n}`;
    while (taken.has(name)) { n++; name = `Dialogue ${n}`; }
    dialogues.push({ id: 'dlg_' + Date.now() + '_' + n, name, lines: [{ speaker: '', text: '', choices: [] }] });
    markProjectDirty();
    renderDialoguesPanel();
  });
  renderDialoguesPanel();
}
window.initDialoguesPanel = initDialoguesPanel;

// ============================================================
// ITEMS (P4 Advanced batch 8 — the backpack)
// Project-level: a list of named items ({ name, maxStack,
// description }), edited in the Items tab. Blocks read
// project.items at preview-run start; the per-run backpack runtime
// lives in the preview runtime module.
// ============================================================
function getMutableItems() {
  const project = window.projectManager?.getCurrentProject?.();
  if (!project) return null;
  const I = window.HydraInventory;
  project.items = I
    ? I.normalizeItems(project.items)
    : (Array.isArray(project.items) ? project.items : []);
  return project.items;
}

// Renaming an item repoints every item block that used the old name
// (mirrors propagateDialogueRename).
function propagateItemRename(oldName, newName) {
  if (!oldName || oldName === newName) return;
  const itemTypes = ['addItem', 'removeItem', 'setItemCount', 'readItemCount', 'hasItem', 'itemCount'];
  const visit = (d) => {
    if (d && itemTypes.indexOf(d.type) !== -1 && d.item === oldName) {
      d.item = newName;
    }
  };
  const scanGrid = (g) => {
    if (!g) return;
    if (g instanceof Map) g.forEach(visit);
    else Object.values(g).forEach(visit);
  };
  scanGrid(cellData);
  scanGrid(globalGridData);
  (scenes || []).forEach(s => {
    scanGrid(s.gridData);
  });
  markProjectDirty();
}

function renderItemsPanel() {
  const panel = document.getElementById('items-panel');
  if (!panel) return;
  const I = window.HydraInventory;
  panel.innerHTML = '';
  if (!I) {
    const p = document.createElement('p');
    p.className = 'hint-text';
    p.textContent = 'Inventory engine still loading — try again in a moment.';
    panel.appendChild(p);
    return;
  }
  const items = getMutableItems();
  if (!items) {
    const p = document.createElement('p');
    p.className = 'hint-text';
    p.textContent = 'Open a project to define its items.';
    panel.appendChild(p);
    return;
  }
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'hint-text';
    empty.textContent = 'No items yet. Add one, name it (for example Brass key), set how many fit in the backpack at once, and write a short description.';
    panel.appendChild(empty);
    return;
  }
  items.forEach((item, itemIdx) => {
    const card = document.createElement('div');
    card.className = 'input-action-row';
    // Name row.
    const header = document.createElement('div');
    header.className = 'input-action-top';
    const nameInput = makeTextInput(item.name || '', 'e.g. Brass key', v => { item.name = v; });
    let nameBeforeEdit = item.name;
    nameInput.addEventListener('focus', () => { nameBeforeEdit = item.name; });
    nameInput.addEventListener('change', () => {
      I.normalizeItems(items);
      // Only repoint blocks when the renamed item survived
      // normalization (a blank or duplicate name is dropped instead).
      if (items.indexOf(item) !== -1) {
        propagateItemRename(nameBeforeEdit, item.name);
      }
      renderItemsPanel();
    });
    const delBtn = document.createElement('button');
    delBtn.type = 'button'; delBtn.className = 'icon-btn'; delBtn.title = 'Delete item';
    delBtn.setAttribute('aria-label', 'Delete item');
    delBtn.innerHTML = '<i class="fas fa-trash"></i>';
    delBtn.addEventListener('click', () => {
      items.splice(itemIdx, 1);
      markProjectDirty();
      renderItemsPanel();
    });
    header.appendChild(nameInput);
    header.appendChild(delBtn);
    card.appendChild(header);
    // Max stack + description row.
    const detailRow = document.createElement('div');
    detailRow.className = 'input-action-top';
    const stackLabel = document.createElement('span');
    stackLabel.className = 'input-action-label';
    stackLabel.textContent = 'Max stack';
    detailRow.appendChild(stackLabel);
    detailRow.appendChild(makeNumberInput(item.maxStack == null ? 99 : item.maxStack, 1, 9999, 1, v => {
      item.maxStack = v;
      markProjectDirty();
    }));
    detailRow.appendChild(makeTextInput(item.description || '', 'What it is (e.g. Opens the cellar door)', v => {
      item.description = v;
      markProjectDirty();
    }));
    card.appendChild(detailRow);
    panel.appendChild(card);
  });
}
window.renderItemsPanel = renderItemsPanel;

function initItemsPanel() {
  const itemTabBtn = document.querySelector('.inspector-tab[data-inspector-tab="items"]');
  if (itemTabBtn) itemTabBtn.addEventListener('click', renderItemsPanel);
  const addBtn = document.getElementById('items-add-btn');
  if (addBtn) addBtn.addEventListener('click', () => {
    const items = getMutableItems();
    if (!items) return;
    const taken = new Set(items.map(i => i.name));
    let n = items.length + 1;
    let name = `Item ${n}`;
    while (taken.has(name)) { n++; name = `Item ${n}`; }
    items.push({ id: 'itm_' + Date.now() + '_' + n, name, maxStack: 99, description: '' });
    markProjectDirty();
    renderItemsPanel();
  });
  renderItemsPanel();
}
window.initItemsPanel = initItemsPanel;

// ============================================================
// QUESTS (P4 Advanced batch 9 — the objectives)
// Project-level: a list of named quests ({ name, target,
// description }), edited in the Quests tab. Blocks read
// project.quests at preview-run start; the per-run quest-log
// runtime lives in the preview runtime module.
// ============================================================
function getMutableQuests() {
  const project = window.projectManager?.getCurrentProject?.();
  if (!project) return null;
  const Q = window.HydraQuest;
  project.quests = Q
    ? Q.normalizeQuests(project.quests)
    : (Array.isArray(project.quests) ? project.quests : []);
  return project.quests;
}

// Renaming a quest repoints every quest block that used the old name
// (mirrors propagateItemRename).
function propagateQuestRename(oldName, newName) {
  if (!oldName || oldName === newName) return;
  const questTypes = ['addQuestProgress', 'setQuestProgress', 'completeQuest', 'resetQuest', 'readQuestProgress', 'questComplete', 'questProgress'];
  const visit = (d) => {
    if (d && questTypes.indexOf(d.type) !== -1 && d.quest === oldName) {
      d.quest = newName;
    }
  };
  const scanGrid = (g) => {
    if (!g) return;
    if (g instanceof Map) g.forEach(visit);
    else Object.values(g).forEach(visit);
  };
  scanGrid(cellData);
  scanGrid(globalGridData);
  (scenes || []).forEach(s => {
    scanGrid(s.gridData);
  });
  markProjectDirty();
}

function renderQuestsPanel() {
  const panel = document.getElementById('quests-panel');
  if (!panel) return;
  const Q = window.HydraQuest;
  panel.innerHTML = '';
  if (!Q) {
    const p = document.createElement('p');
    p.className = 'hint-text';
    p.textContent = 'Quest engine still loading — try again in a moment.';
    panel.appendChild(p);
    return;
  }
  const quests = getMutableQuests();
  if (!quests) {
    const p = document.createElement('p');
    p.className = 'hint-text';
    p.textContent = 'Open a project to define its quests.';
    panel.appendChild(p);
    return;
  }
  if (!quests.length) {
    const empty = document.createElement('p');
    empty.className = 'hint-text';
    empty.textContent = 'No quests yet. Add one, name it (for example Collect 4 coins), set how much progress finishes it, and write a short description.';
    panel.appendChild(empty);
    return;
  }
  quests.forEach((quest, questIdx) => {
    const card = document.createElement('div');
    card.className = 'input-action-row';
    // Name row.
    const header = document.createElement('div');
    header.className = 'input-action-top';
    const nameInput = makeTextInput(quest.name || '', 'e.g. Collect 4 coins', v => { quest.name = v; });
    let nameBeforeEdit = quest.name;
    nameInput.addEventListener('focus', () => { nameBeforeEdit = quest.name; });
    nameInput.addEventListener('change', () => {
      Q.normalizeQuests(quests);
      // Only repoint blocks when the renamed quest survived
      // normalization (a blank or duplicate name is dropped instead).
      if (quests.indexOf(quest) !== -1) {
        propagateQuestRename(nameBeforeEdit, quest.name);
      }
      renderQuestsPanel();
    });
    const delBtn = document.createElement('button');
    delBtn.type = 'button'; delBtn.className = 'icon-btn'; delBtn.title = 'Delete quest';
    delBtn.setAttribute('aria-label', 'Delete quest');
    delBtn.innerHTML = '<i class="fas fa-trash"></i>';
    delBtn.addEventListener('click', () => {
      quests.splice(questIdx, 1);
      markProjectDirty();
      renderQuestsPanel();
    });
    header.appendChild(nameInput);
    header.appendChild(delBtn);
    card.appendChild(header);
    // Target + description row.
    const detailRow = document.createElement('div');
    detailRow.className = 'input-action-top';
    const targetLabel = document.createElement('span');
    targetLabel.className = 'input-action-label';
    targetLabel.textContent = 'Target';
    detailRow.appendChild(targetLabel);
    detailRow.appendChild(makeNumberInput(quest.target == null ? 1 : quest.target, 1, 9999, 1, v => {
      quest.target = v;
      markProjectDirty();
    }));
    detailRow.appendChild(makeTextInput(quest.description || '', 'What it is (e.g. Pick up every coin in Level 1)', v => {
      quest.description = v;
      markProjectDirty();
    }));
    card.appendChild(detailRow);
    panel.appendChild(card);
  });
}
window.renderQuestsPanel = renderQuestsPanel;

function initQuestsPanel() {
  const questTabBtn = document.querySelector('.inspector-tab[data-inspector-tab="quests"]');
  if (questTabBtn) questTabBtn.addEventListener('click', renderQuestsPanel);
  const addBtn = document.getElementById('quests-add-btn');
  if (addBtn) addBtn.addEventListener('click', () => {
    const quests = getMutableQuests();
    if (!quests) return;
    const taken = new Set(quests.map(q => q.name));
    let n = quests.length + 1;
    let name = `Quest ${n}`;
    while (taken.has(name)) { n++; name = `Quest ${n}`; }
    quests.push({ id: 'qst_' + Date.now() + '_' + n, name, target: 1, description: '' });
    markProjectDirty();
    renderQuestsPanel();
  });
  renderQuestsPanel();
}
window.initQuestsPanel = initQuestsPanel;

// ============================================================
// ACHIEVEMENTS (P4 Advanced batch 10 — the permanent trophies)
// Project-level: a list of named achievements ({ name,
// description }), edited in the Achievements tab. Blocks read
// project.achievements at preview-run start; the unlocked set lives
// in the preview runtime module and persists in storage across runs.
// ============================================================
function getMutableAchievements() {
  const project = window.projectManager?.getCurrentProject?.();
  if (!project) return null;
  const A = window.HydraAchievement;
  project.achievements = A
    ? A.normalizeAchievements(project.achievements)
    : (Array.isArray(project.achievements) ? project.achievements : []);
  return project.achievements;
}

// Renaming an achievement repoints every achievement block that used
// the old name (mirrors propagateQuestRename; only the blocks that
// name one achievement carry the field — Unlock / Lock / Unlocked).
function propagateAchievementRename(oldName, newName) {
  if (!oldName || oldName === newName) return;
  const achievementTypes = ['unlockAchievement', 'lockAchievement', 'achievementUnlocked'];
  const visit = (d) => {
    if (d && achievementTypes.indexOf(d.type) !== -1 && d.achievement === oldName) {
      d.achievement = newName;
    }
  };
  const scanGrid = (g) => {
    if (!g) return;
    if (g instanceof Map) g.forEach(visit);
    else Object.values(g).forEach(visit);
  };
  scanGrid(cellData);
  scanGrid(globalGridData);
  (scenes || []).forEach(s => {
    scanGrid(s.gridData);
  });
  markProjectDirty();
}

function renderAchievementsPanel() {
  const panel = document.getElementById('achievements-panel');
  if (!panel) return;
  const A = window.HydraAchievement;
  panel.innerHTML = '';
  if (!A) {
    const p = document.createElement('p');
    p.className = 'hint-text';
    p.textContent = 'Achievement engine still loading — try again in a moment.';
    panel.appendChild(p);
    return;
  }
  const achievements = getMutableAchievements();
  if (!achievements) {
    const p = document.createElement('p');
    p.className = 'hint-text';
    p.textContent = 'Open a project to define its achievements.';
    panel.appendChild(p);
    return;
  }
  if (!achievements.length) {
    const empty = document.createElement('p');
    empty.className = 'hint-text';
    empty.textContent = 'No achievements yet. Add one, name it (for example Coin hoarder), and write a short description of what earns it.';
    panel.appendChild(empty);
    return;
  }
  achievements.forEach((achievement, achievementIdx) => {
    const card = document.createElement('div');
    card.className = 'input-action-row';
    // Name row.
    const header = document.createElement('div');
    header.className = 'input-action-top';
    const nameInput = makeTextInput(achievement.name || '', 'e.g. Coin hoarder', v => { achievement.name = v; });
    let nameBeforeEdit = achievement.name;
    nameInput.addEventListener('focus', () => { nameBeforeEdit = achievement.name; });
    nameInput.addEventListener('change', () => {
      A.normalizeAchievements(achievements);
      // Only repoint blocks when the renamed achievement survived
      // normalization (a blank or duplicate name is dropped instead).
      if (achievements.indexOf(achievement) !== -1) {
        propagateAchievementRename(nameBeforeEdit, achievement.name);
      }
      renderAchievementsPanel();
    });
    const delBtn = document.createElement('button');
    delBtn.type = 'button'; delBtn.className = 'icon-btn'; delBtn.title = 'Delete achievement';
    delBtn.setAttribute('aria-label', 'Delete achievement');
    delBtn.innerHTML = '<i class="fas fa-trash"></i>';
    delBtn.addEventListener('click', () => {
      achievements.splice(achievementIdx, 1);
      markProjectDirty();
      renderAchievementsPanel();
    });
    header.appendChild(nameInput);
    header.appendChild(delBtn);
    card.appendChild(header);
    // Description row.
    const detailRow = document.createElement('div');
    detailRow.className = 'input-action-top';
    detailRow.appendChild(makeTextInput(achievement.description || '', 'What earns it (e.g. Collect 100 coins across any number of runs)', v => {
      achievement.description = v;
      markProjectDirty();
    }));
    card.appendChild(detailRow);
    panel.appendChild(card);
  });
}
window.renderAchievementsPanel = renderAchievementsPanel;

function initAchievementsPanel() {
  const achievementTabBtn = document.querySelector('.inspector-tab[data-inspector-tab="achievements"]');
  if (achievementTabBtn) achievementTabBtn.addEventListener('click', renderAchievementsPanel);
  const addBtn = document.getElementById('achievements-add-btn');
  if (addBtn) addBtn.addEventListener('click', () => {
    const achievements = getMutableAchievements();
    if (!achievements) return;
    const taken = new Set(achievements.map(a => a.name));
    let n = achievements.length + 1;
    let name = `Achievement ${n}`;
    while (taken.has(name)) { n++; name = `Achievement ${n}`; }
    achievements.push({ id: 'ach_' + Date.now() + '_' + n, name, description: '' });
    markProjectDirty();
    renderAchievementsPanel();
  });
  renderAchievementsPanel();
}
window.initAchievementsPanel = initAchievementsPanel;

// ============================================================
// CUTSCENES (P4 Advanced batch 11 — the scripted scenes)
// Project-level: a list of named cutscenes ({ name, description,
// steps[] }), edited in the Cutscenes tab. Blocks read
// project.cutscenes at preview-run start; the per-run cutscene
// runtime itself lives in the preview runtime module and is reset
// on a fresh run, surviving scene switches inside the run.
// ============================================================
function getMutableCutscenes() {
  const project = window.projectManager?.getCurrentProject?.();
  if (!project) return null;
  const C = window.HydraCutscene;
  project.cutscenes = C
    ? C.normalizeCutscenes(project.cutscenes)
    : (Array.isArray(project.cutscenes) ? project.cutscenes : []);
  return project.cutscenes;
}

// Renaming a cutscene repoints every cutscene block that used the
// old name (mirrors propagateQuestRename; all four cutscene blocks
// carry the field — Play / Stop / Playing / Finished).
function propagateCutsceneRename(oldName, newName) {
  if (!oldName || oldName === newName) return;
  const cutsceneTypes = ['playCutscene', 'stopCutscene', 'cutscenePlaying', 'cutsceneFinished'];
  const visit = (d) => {
    if (d && cutsceneTypes.indexOf(d.type) !== -1 && d.cutscene === oldName) {
      d.cutscene = newName;
    }
  };
  const scanGrid = (g) => {
    if (!g) return;
    if (g instanceof Map) g.forEach(visit);
    else Object.values(g).forEach(visit);
  };
  scanGrid(cellData);
  scanGrid(globalGridData);
  const project = window.projectManager?.getCurrentProject?.();
  const scenes = (project && project.scenes) || [];
  scenes.forEach(s => {
    scanGrid(s.gridData);
  });
  markProjectDirty();
}

// The scenes a Switch scene step can jump to, as [name, name]
// select options (the runtime resolves a step's scene by name first,
// then by numeric id). A stored name that no longer matches a scene
// (a renamed scene) is kept as its own option, so the step still
// shows what it points at instead of silently flipping to the first
// scene.
function cutsceneSceneOptions(storedScene) {
  const project = window.projectManager?.getCurrentProject?.();
  const scenes = (project && Array.isArray(project.scenes)) ? project.scenes : [];
  const options = scenes
    .filter(s => s && typeof s.name === 'string' && s.name)
    .map(s => [s.name, s.name]);
  if (storedScene && !options.some(o => o[0] === storedScene)) {
    options.unshift([storedScene, storedScene + ' (missing scene)']);
  }
  if (!options.length) options.push(['', '(no scenes yet)']);
  return options;
}

// The fields one step kind needs, wiped clean when the kind changes
// so a step never carries stale fields from its old kind.
function resetCutsceneStepForKind(step, kind) {
  step.kind = kind;
  delete step.object; delete step.text; delete step.x; delete step.y;
  delete step.sound; delete step.scene;
  if (kind === 'wait') { step.seconds = 1; }
  else if (kind === 'text') { step.object = ''; step.text = ''; step.seconds = 1; }
  else if (kind === 'move') { step.object = ''; step.x = 0; step.y = 0; step.seconds = 1; }
  else if (kind === 'sound') { step.sound = ''; }
  else if (kind === 'scene') { step.scene = ''; }
}

function renderCutscenesPanel() {
  const panel = document.getElementById('cutscenes-panel');
  if (!panel) return;
  const C = window.HydraCutscene;
  panel.innerHTML = '';
  if (!C) {
    const p = document.createElement('p');
    p.className = 'hint-text';
    p.textContent = 'Cutscene engine still loading — try again in a moment.';
    panel.appendChild(p);
    return;
  }
  const cutscenes = getMutableCutscenes();
  if (!cutscenes) {
    const p = document.createElement('p');
    p.className = 'hint-text';
    p.textContent = 'Open a project to define its cutscenes.';
    panel.appendChild(p);
    return;
  }
  if (!cutscenes.length) {
    const empty = document.createElement('p');
    empty.className = 'hint-text';
    empty.textContent = 'No cutscenes yet. Add one, name it (for example Intro), and add steps — a caption, a glide, a sound, a scene switch — that play in order when the Play Cutscene block runs it.';
    panel.appendChild(empty);
    return;
  }
  const stepKindOptions = [
    ['wait', 'Wait'], ['text', 'Show text'], ['move', 'Move object'],
    ['sound', 'Play sound'], ['scene', 'Switch scene']
  ];
  cutscenes.forEach((cutscene, cutsceneIdx) => {
    const card = document.createElement('div');
    card.className = 'input-action-row';
    // Name row.
    const header = document.createElement('div');
    header.className = 'input-action-top';
    const nameInput = makeTextInput(cutscene.name || '', 'e.g. Intro', v => { cutscene.name = v; });
    let nameBeforeEdit = cutscene.name;
    nameInput.addEventListener('focus', () => { nameBeforeEdit = cutscene.name; });
    nameInput.addEventListener('change', () => {
      C.normalizeCutscenes(cutscenes);
      // Only repoint blocks when the renamed cutscene survived
      // normalization (a blank or duplicate name is dropped instead).
      if (cutscenes.indexOf(cutscene) !== -1) {
        propagateCutsceneRename(nameBeforeEdit, cutscene.name);
      }
      renderCutscenesPanel();
    });
    const delBtn = document.createElement('button');
    delBtn.type = 'button'; delBtn.className = 'icon-btn'; delBtn.title = 'Delete cutscene';
    delBtn.setAttribute('aria-label', 'Delete cutscene');
    delBtn.innerHTML = '<i class="fas fa-trash"></i>';
    delBtn.addEventListener('click', () => {
      cutscenes.splice(cutsceneIdx, 1);
      markProjectDirty();
      renderCutscenesPanel();
    });
    header.appendChild(nameInput);
    header.appendChild(delBtn);
    card.appendChild(header);
    // Description row.
    const detailRow = document.createElement('div');
    detailRow.className = 'input-action-top';
    detailRow.appendChild(makeTextInput(cutscene.description || '', 'What it is (e.g. The opening crawl before Level 1)', v => {
      cutscene.description = v;
      markProjectDirty();
    }));
    card.appendChild(detailRow);
    // Steps, in play order.
    if (!Array.isArray(cutscene.steps)) cutscene.steps = [];
    cutscene.steps.forEach((step, stepIdx) => {
      const row = document.createElement('div');
      row.className = 'input-action-top cutscene-step-row';
      const num = document.createElement('span');
      num.className = 'input-action-label';
      num.textContent = 'Step ' + (stepIdx + 1);
      row.appendChild(num);
      row.appendChild(makeSelect(stepKindOptions, step.kind || 'wait', v => {
        resetCutsceneStepForKind(step, v);
        markProjectDirty();
        renderCutscenesPanel();
      }));
      if (step.kind === 'wait') {
        row.appendChild(makeNumberInput(step.seconds == null ? 1 : step.seconds, 0, 9999, 0.1, v => {
          step.seconds = v;
          markProjectDirty();
        }));
        const secLabel = document.createElement('span');
        secLabel.className = 'input-action-label';
        secLabel.textContent = 'sec';
        row.appendChild(secLabel);
      } else if (step.kind === 'text') {
        row.appendChild(makeTextInput(step.object || '', 'Object e.g. Caption', v => { step.object = v; }));
        row.appendChild(makeTextInput(step.text || '', 'What it says', v => { step.text = v; }));
        row.appendChild(makeNumberInput(step.seconds == null ? 1 : step.seconds, 0, 9999, 0.1, v => {
          step.seconds = v;
          markProjectDirty();
        }));
        const secLabel = document.createElement('span');
        secLabel.className = 'input-action-label';
        secLabel.textContent = 'sec';
        row.appendChild(secLabel);
      } else if (step.kind === 'move') {
        row.appendChild(makeTextInput(step.object || '', 'Object e.g. Hero', v => { step.object = v; }));
        const xLabel = document.createElement('span');
        xLabel.className = 'input-action-label';
        xLabel.textContent = 'X';
        row.appendChild(xLabel);
        row.appendChild(makeNumberInput(step.x == null ? 0 : step.x, -99999, 99999, 1, v => {
          step.x = v;
          markProjectDirty();
        }));
        const yLabel = document.createElement('span');
        yLabel.className = 'input-action-label';
        yLabel.textContent = 'Y';
        row.appendChild(yLabel);
        row.appendChild(makeNumberInput(step.y == null ? 0 : step.y, -99999, 99999, 1, v => {
          step.y = v;
          markProjectDirty();
        }));
        row.appendChild(makeNumberInput(step.seconds == null ? 1 : step.seconds, 0, 9999, 0.1, v => {
          step.seconds = v;
          markProjectDirty();
        }));
        const secLabel = document.createElement('span');
        secLabel.className = 'input-action-label';
        secLabel.textContent = 'sec';
        row.appendChild(secLabel);
      } else if (step.kind === 'sound') {
        row.appendChild(makeTextInput(step.sound || '', 'Sound e.g. Fanfare', v => { step.sound = v; }));
      } else if (step.kind === 'scene') {
        row.appendChild(makeSelect(cutsceneSceneOptions(step.scene || ''), step.scene || '', v => {
          step.scene = v;
          markProjectDirty();
        }));
      }
      const delStepBtn = document.createElement('button');
      delStepBtn.type = 'button'; delStepBtn.className = 'icon-btn'; delStepBtn.title = 'Delete step';
      delStepBtn.setAttribute('aria-label', 'Delete step');
      delStepBtn.innerHTML = '<i class="fas fa-trash"></i>';
      delStepBtn.addEventListener('click', () => {
        cutscene.steps.splice(stepIdx, 1);
        markProjectDirty();
        renderCutscenesPanel();
      });
      row.appendChild(delStepBtn);
      card.appendChild(row);
    });
    const addStepBtn = document.createElement('button');
    addStepBtn.type = 'button'; addStepBtn.className = 'icon-btn'; addStepBtn.title = 'Add step';
    addStepBtn.setAttribute('aria-label', 'Add step');
    addStepBtn.innerHTML = '<i class="fas fa-plus"></i> Step';
    addStepBtn.addEventListener('click', () => {
      cutscene.steps.push({ kind: 'wait', seconds: 1 });
      markProjectDirty();
      renderCutscenesPanel();
    });
    card.appendChild(addStepBtn);
    panel.appendChild(card);
  });
}
window.renderCutscenesPanel = renderCutscenesPanel;

function initCutscenesPanel() {
  const cutsceneTabBtn = document.querySelector('.inspector-tab[data-inspector-tab="cutscenes"]');
  if (cutsceneTabBtn) cutsceneTabBtn.addEventListener('click', renderCutscenesPanel);
  const addBtn = document.getElementById('cutscenes-add-btn');
  if (addBtn) addBtn.addEventListener('click', () => {
    const cutscenes = getMutableCutscenes();
    if (!cutscenes) return;
    const taken = new Set(cutscenes.map(c => c.name));
    let n = cutscenes.length + 1;
    let name = `Cutscene ${n}`;
    while (taken.has(name)) { n++; name = `Cutscene ${n}`; }
    cutscenes.push({ id: 'cts_' + Date.now() + '_' + n, name, description: '', steps: [] });
    markProjectDirty();
    renderCutscenesPanel();
  });
  renderCutscenesPanel();
}
window.initCutscenesPanel = initCutscenesPanel;

// HIGH SCORES (P4 Advanced batch 12 — the ranked leaderboard)
// The tab edits the table config (max entries + default name) and
// shows the scores stored for this game, best first. The table
// itself is runtime data, not authored content: scores arrive
// through the Submit Score block and live in per-game storage, so
// the panel reads the stored board fresh on every render. The Clear
// button empties the live preview table too (through the preview
// runtime), so the stored board and a running preview agree at once.
function renderHighScoresPanel() {
  const panel = document.getElementById('highscores-panel');
  if (!panel) return;
  const H = window.HydraHighScore;
  panel.innerHTML = '';
  if (!H) {
    const p = document.createElement('p');
    p.className = 'hint-text';
    p.textContent = 'High score engine still loading — try again in a moment.';
    panel.appendChild(p);
    return;
  }
  const config = getMutableHighScoreConfig();
  if (!config) {
    const p = document.createElement('p');
    p.className = 'hint-text';
    p.textContent = 'Open a project to set up its leaderboard.';
    panel.appendChild(p);
    return;
  }
  // Config card: max entries + default name.
  const card = document.createElement('div');
  card.className = 'input-action-row';
  const top = document.createElement('div');
  top.className = 'input-action-top highscore-row';
  const maxLabel = document.createElement('span');
  maxLabel.className = 'input-action-label';
  maxLabel.textContent = 'Max entries';
  top.appendChild(maxLabel);
  top.appendChild(makeNumberInput(config.maxEntries == null ? 10 : config.maxEntries, 1, 50, 1, v => {
    config.maxEntries = v;
    markProjectDirty();
    renderHighScoresPanel();
  }));
  top.appendChild(makeTextInput(config.defaultName || '', 'Default name (e.g. Player)', v => {
    config.defaultName = v;
    markProjectDirty();
  }));
  card.appendChild(top);
  panel.appendChild(card);
  // Stored board, best first (trimmed to the configured size for
  // display — the runtime trims on its next load).
  const entries = H.loadEntries(H.safeStorage(), getProjectId())
    .slice(0, config.maxEntries || 10);
  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'hint-text';
    empty.textContent = 'No scores yet. Submit one with the Submit Score block — the board fills up as players play.';
    panel.appendChild(empty);
  } else {
    entries.forEach((entry, idx) => {
      const row = document.createElement('div');
      row.className = 'input-action-row';
      const line = document.createElement('div');
      line.className = 'input-action-top highscore-row';
      const rank = document.createElement('span');
      rank.className = 'input-action-label';
      rank.textContent = '#' + (idx + 1);
      line.appendChild(rank);
      const who = document.createElement('span');
      who.className = 'highscore-name';
      who.textContent = entry.name || 'Player';
      line.appendChild(who);
      const score = document.createElement('span');
      score.className = 'highscore-score';
      score.textContent = String(entry.score);
      line.appendChild(score);
      if (entry.date) {
        const when = document.createElement('span');
        when.className = 'hint-text';
        try { when.textContent = new Date(entry.date).toLocaleDateString(); } catch (e) { when.textContent = ''; }
        line.appendChild(when);
      }
      row.appendChild(line);
      panel.appendChild(row);
    });
  }
  // Clear the stored board (and the live preview table, so a running
  // preview agrees at once).
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button'; clearBtn.className = 'danger-btn'; clearBtn.textContent = 'Clear stored scores';
  clearBtn.addEventListener('click', () => {
    const storage = H.safeStorage();
    if (storage) H.saveEntries(storage, getProjectId(), []);
    try {
      if (window.HydraPreviewRuntime && typeof window.HydraPreviewRuntime.clearHighScoreTable === 'function') {
        window.HydraPreviewRuntime.clearHighScoreTable();
      }
    } catch (e) { /* a throwing clear never breaks the editor */ }
    markProjectDirty();
    renderHighScoresPanel();
  });
  panel.appendChild(clearBtn);
}
window.renderHighScoresPanel = renderHighScoresPanel;

function initHighScoresPanel() {
  const highScoresTabBtn = document.querySelector('.inspector-tab[data-inspector-tab="highscores"]');
  if (highScoresTabBtn) highScoresTabBtn.addEventListener('click', renderHighScoresPanel);
  renderHighScoresPanel();
}
window.initHighScoresPanel = initHighScoresPanel;

// ============================================================
// VARIABLES PANEL
// (P5 core-engine track, item P5-1, slice b: the Variables manager.
// The tab lists the project's scoped-variable definitions — the
// starting values a game begins with — grouped by scope. Create /
// rename / delete / edit the starting value here; the definitions
// live in the project and seed the run at run start (global +
// object) and at scene load (scene). Live values belong to the
// Preview tab's Live variables readout (renderPreviewVariables):
// switching tabs stops the preview, so this panel never sees a
// running game and edits starting values only.)
// ============================================================

// The project's definition list, normalized in place (mirrors
// getMutableHighScoreConfig); the tab holds the live record while
// it renders. The panel also seeds the live run from this list.
// In place, on purpose: the panel closes over this array, and the
// 500ms live-values tick calls this too — handing back a fresh
// array each time would orphan the panel's edits (an add would
// push into the old array and the panel's own re-render would read
// the new one without it). When the list is already clean the same
// array (and the same definition objects) come back untouched;
// only a dropped or coerced entry rebuilds it, still in place.
function getMutableScopedVariables() {
  const project = window.projectManager?.getCurrentProject?.();
  if (!project) return null;
  const V = window.HydraVariables;
  if (!V) {
    if (!Array.isArray(project.scopedVariables)) project.scopedVariables = [];
    return project.scopedVariables;
  }
  if (!Array.isArray(project.scopedVariables)) {
    project.scopedVariables = V.normalizeDefinitions(project.scopedVariables);
    return project.scopedVariables;
  }
  const cur = project.scopedVariables;
  const clean = V.normalizeDefinitions(cur);
  let changed = cur.length !== clean.length;
  for (let i = 0; i < clean.length && !changed; i++) {
    if (JSON.stringify(cur[i]) !== JSON.stringify(clean[i])) changed = true;
  }
  if (!changed) return cur;
  cur.length = 0;
  clean.forEach(d => cur.push(d));
  return cur;
}

// The definition list for the preview runtime host (mirrors
// getProjectHighScores): the definitions the run seeds from, or
// null with no project / module (the host degrades to none).
function getProjectScopedVariables() {
  const defs = getMutableScopedVariables();
  return defs || [];
}

// P5 core-engine track, item P5-3 (Functions / custom blocks,
// slice a): the live function list for the project — the same
// identity-preserving contract as getMutableScopedVariables, so the
// Functions panel, the scope tabs, and the grid store all write to
// the same records (a dirty entry is replaced once, then the list
// is stable; a clean list comes back untouched).
function getMutableFunctions() {
  const project = window.projectManager?.getCurrentProject?.();
  if (!project) return null;
  const F = window.HydraFunctions;
  if (!F) {
    if (!Array.isArray(project.functions)) project.functions = [];
    return project.functions;
  }
  if (!Array.isArray(project.functions)) {
    project.functions = F.normalizeFunctions(project.functions);
    return project.functions;
  }
  const cur = project.functions;
  const clean = F.normalizeFunctions(cur);
  let changed = cur.length !== clean.length;
  for (let i = 0; i < clean.length && !changed; i++) {
    if (cur[i] !== clean[i]) changed = true;
  }
  if (!changed) return cur;
  cur.length = 0;
  clean.forEach(d => cur.push(d));
  return cur;
}

// The function list for the preview runtime host (mirrors
// getProjectScopedVariables): the definitions the run calls from,
// or null with no project / module (the host degrades to none).
function getProjectFunctions() {
  const fns = getMutableFunctions();
  return fns || [];
}

// The live run state while a preview runs, or null when the game is
// stopped (the panel then shows starting values only).
function variablesLiveState() {
  try {
    const R = window.HydraPreviewRuntime;
    if (!R || typeof R.isPreviewRunning !== 'function' || !R.isPreviewRunning()) return null;
    return (typeof R.variablesRuntime === 'function') ? R.variablesRuntime() : null;
  } catch (e) { return null; }
}

// The scene the running game is in (previewState.sceneId), or the
// editor's current scene when stopped — the scene whose live values
// the Preview tab's readout shows.
function variablesLiveSceneId() {
  try {
    const live = (typeof previewState !== 'undefined' && previewState && previewState.sceneId != null)
      ? previewState.sceneId : null;
    if (live != null) return live;
  } catch (e) { /* hostile preview state */ }
  return currentSceneId;
}

function variablesFormatValue(type, value) {
  const V = window.HydraVariables;
  if (type === 'list') return 'list (' + (Array.isArray(value) ? value.length : 0) + ' items)';
  if (type === 'dict') {
    const keys = (value && typeof value === 'object') ? Object.keys(value).length : 0;
    return 'dict (' + keys + (keys === 1 ? ' key)' : ' keys)');
  }
  // P5-5 slice a (object references as values): a handle shows the
  // object it points at, or (none) when it points at nothing — never
  // the raw handle, and never a number (the old fall-through read a
  // handle as 0).
  if (type === 'object') {
    const refName = (value && typeof value === 'object' && typeof value.name === 'string') ? value.name : '';
    return refName ? 'object (' + refName + ')' : 'object (none)';
  }
  if (type === 'bool') return value === true ? 'true' : 'false';
  if (type === 'text') return String(value == null ? '' : value);
  return String(V ? V.normalizeValue(value, 'number') : value);
}

function renderVariablesPanel() {
  const panel = document.getElementById('variables-panel');
  if (!panel) return;
  const V = window.HydraVariables;
  panel.innerHTML = '';
  if (!V) {
    const p = document.createElement('p');
    p.className = 'hint-text';
    p.textContent = 'Variables engine still loading — try again in a moment.';
    panel.appendChild(p);
    return;
  }
  const defs = getMutableScopedVariables();
  if (!defs) {
    const p = document.createElement('p');
    p.className = 'hint-text';
    p.textContent = 'Open a project to manage its variables.';
    panel.appendChild(p);
    return;
  }
  // The Scene group is labelled with the editor's current scene:
  // the panel edits starting values, and live values belong to the
  // Preview tab's Live variables readout (switching tabs stops the
  // preview, so this panel never sees a running game).
  const sceneName = (() => {
    try {
      const s = getCurrentScene();
      return s && s.name ? s.name : 'Scene ' + currentSceneId;
    } catch (e) { return 'Scene ' + currentSceneId; }
  })();

  // ---- Add a variable (behind a disclosure: the middle-ground rule
  // keeps the everyday list clean and the form one click away). ----
  const addDetails = document.createElement('details');
  addDetails.className = 'input-action-row';
  const addSummary = document.createElement('summary');
  addSummary.textContent = 'Add a variable';
  addSummary.style.cssText = 'cursor:pointer;font-weight:600;font-size:13px;color:#1e293b';
  addDetails.appendChild(addSummary);
  const nameInput = document.createElement('input');
  nameInput.type = 'text'; nameInput.className = 'property-input';
  nameInput.placeholder = 'Name (e.g. coins)'; nameInput.setAttribute('aria-label', 'Variable name');
  nameInput.id = 'var-add-name';
  addDetails.appendChild(nameInput);
  const scopeSelect = document.createElement('select');
  scopeSelect.className = 'property-input'; scopeSelect.setAttribute('aria-label', 'Scope');
  scopeSelect.id = 'var-add-scope';
  [['global', 'Global (whole game)'], ['scene', 'Scene (this scene only)'], ['object', 'Object (per object name)']]
    .forEach(([v, label]) => {
      const o = document.createElement('option'); o.value = v; o.textContent = label; scopeSelect.appendChild(o);
    });
  addDetails.appendChild(scopeSelect);
  // The object dropdown is the shared builder (HydraPropInputs):
  // the propinputs suite keeps the object-select body in the module,
  // and the shared builder lists every named object in every scene.
  // It is rebuilt on each scope change (the select element itself is
  // swapped, so the previous pick is passed back in to keep it).
  const objectSelectWrap = document.createElement('div');
  objectSelectWrap.style.display = 'none';
  addDetails.appendChild(objectSelectWrap);
  let objectSelect = null;
  const typeSelect = document.createElement('select');
  typeSelect.className = 'property-input'; typeSelect.setAttribute('aria-label', 'Type');
  typeSelect.id = 'var-add-type';
  [['number', 'Number'], ['text', 'Text'], ['bool', 'True / False']]
    .forEach(([v, label]) => {
      const o = document.createElement('option'); o.value = v; o.textContent = label; typeSelect.appendChild(o);
    });
  addDetails.appendChild(typeSelect);
  const valueWrap = document.createElement('div');
  valueWrap.id = 'var-add-value-wrap';
  let valueInput = document.createElement('input');
  valueInput.type = 'number'; valueInput.className = 'property-input'; valueInput.value = '0';
  valueInput.placeholder = 'Starting value'; valueInput.setAttribute('aria-label', 'Starting value');
  valueInput.id = 'var-add-value';
  valueWrap.appendChild(valueInput);
  addDetails.appendChild(valueWrap);
  const errorLine = document.createElement('p');
  errorLine.className = 'var-add-error';
  errorLine.id = 'var-add-error';
  addDetails.appendChild(errorLine);
  const addBtn = document.createElement('button');
  addBtn.type = 'button'; addBtn.className = 'icon-btn'; addBtn.textContent = 'Add variable';
  addBtn.id = 'var-add-btn';
  addBtn.style.cssText = 'align-self:flex-start';
  addDetails.appendChild(addBtn);
  function syncObjectSelect() {
    const show = scopeSelect.value === 'object';
    objectSelectWrap.style.display = show ? '' : 'none';
    if (!show) return;
    const prev = objectSelect ? objectSelect.value : '';
    const next = makeObjectSelect(prev, null);
    if (!next) return;
    next.setAttribute('aria-label', 'Object');
    next.id = 'var-add-object';
    objectSelectWrap.innerHTML = '';
    objectSelectWrap.appendChild(next);
    objectSelect = next;
  }
  function syncValueInput() {
    const type = typeSelect.value;
    const next = document.createElement('input');
    next.className = 'property-input'; next.setAttribute('aria-label', 'Starting value');
    next.id = 'var-add-value';
    if (type === 'bool') {
      next.type = 'checkbox';
      next.checked = valueInput && valueInput.type === 'checkbox' ? valueInput.checked : false;
    } else {
      next.type = type === 'text' ? 'text' : 'number';
      next.value = (valueInput && valueInput.type !== 'checkbox') ? valueInput.value : (type === 'text' ? '' : '0');
      next.placeholder = 'Starting value';
    }
    valueWrap.innerHTML = '';
    valueWrap.appendChild(next);
    valueInput = next;
  }
  scopeSelect.addEventListener('change', syncObjectSelect);
  typeSelect.addEventListener('change', syncValueInput);
  syncObjectSelect();
  addBtn.addEventListener('click', () => {
    errorLine.textContent = '';
    const rawName = (nameInput.value || '').trim();
    if (!rawName) { errorLine.textContent = 'Give the variable a name first.'; nameInput.focus(); return; }
    const scope = scopeSelect.value;
    const objectName = scope === 'object' ? ((objectSelect ? objectSelect.value : '') || '').trim() : '';
    if (scope === 'object' && !objectName) {
      errorLine.textContent = 'Pick an object for an object variable (add a named object to a scene first).';
      return;
    }
    const type = typeSelect.value;
    const rawValue = valueInput.type === 'checkbox' ? valueInput.checked : valueInput.value;
    const def = V.normalizeDefinition({ name: rawName, scope, objectName, type, value: rawValue });
    if (!def) { errorLine.textContent = 'That variable could not be created — check the name.'; return; }
    const key = V.definitionKey(def);
    if (defs.some(d => V.definitionKey(d) === key)) {
      errorLine.textContent = 'A variable with that name already exists in this scope.';
      return;
    }
    defs.push(def);
    markProjectDirty();
    nameInput.value = '';
    if (valueInput.type === 'checkbox') valueInput.checked = false;
    else valueInput.value = type === 'text' ? '' : '0';
    addDetails.open = false;
    renderVariablesPanel();
  });
  panel.appendChild(addDetails);

  // ---- One row per definition. The value input edits the starting
  // value. Lists, dicts, and object references show a read-only
  // line — they are built by copying (or by picking, for objects),
  // not typed in here (the data-structures track). ----
  function defRow(def) {
    const row = document.createElement('div');
    row.className = 'input-action-row var-row';
    const top = document.createElement('div');
    top.className = 'var-top input-action-top';
    const nameBtn = document.createElement('button');
    nameBtn.type = 'button'; nameBtn.className = 'var-name'; nameBtn.textContent = def.name;
    nameBtn.title = 'Click to rename';
    nameBtn.addEventListener('click', () => {
      const next = prompt('Rename variable:', def.name);
      if (next == null) return;
      const trimmed = String(next).trim();
      if (!trimmed || trimmed === def.name) return;
      const renamed = V.normalizeDefinition({ name: trimmed, scope: def.scope, objectName: def.objectName, type: def.type, value: def.value });
      if (!renamed) return;
      if (defs.some(d => d !== def && V.definitionKey(d) === V.definitionKey(renamed))) {
        alert('A variable with that name already exists in this scope.');
        return;
      }
      def.name = renamed.name;
      markProjectDirty();
      renderVariablesPanel();
    });
    top.appendChild(nameBtn);
    const badge = document.createElement('span');
    badge.className = 'var-type';
    badge.textContent = def.type;
    top.appendChild(badge);
    const delBtn = document.createElement('button');
    delBtn.type = 'button'; delBtn.className = 'icon-btn'; delBtn.textContent = '×';
    delBtn.title = 'Delete variable'; delBtn.setAttribute('aria-label', 'Delete variable ' + def.name);
    delBtn.addEventListener('click', () => {
      const at = defs.indexOf(def);
      if (at !== -1) defs.splice(at, 1);
      markProjectDirty();
      renderVariablesPanel();
    });
    row.appendChild(top);
    const key = V.definitionKey(def);
    if (def.scope === 'object') {
      const objLine = document.createElement('p');
      objLine.className = 'var-note var-object';
      objLine.textContent = 'Object: ' + def.objectName;
      row.appendChild(objLine);
    }
    if (def.type === 'list' || def.type === 'dict' || def.type === 'object') {
      const val = document.createElement('p');
      val.className = 'var-note';
      val.textContent = variablesFormatValue(def.type, def.value);
      val.setAttribute('data-var-key', key);
      row.appendChild(val);
    } else if (def.type === 'bool') {
      const val = document.createElement('input');
      val.type = 'checkbox'; val.checked = def.value === true;
      val.className = 'var-value';
      val.setAttribute('data-var-key', key);
      val.setAttribute('aria-label', 'Starting value for ' + def.name);
      val.addEventListener('change', () => {
        def.value = !!val.checked;
        markProjectDirty();
      });
      top.appendChild(val);
    } else {
      const val = document.createElement('input');
      val.type = def.type === 'text' ? 'text' : 'number';
      val.className = 'property-input var-value';
      val.value = def.type === 'text' ? String(def.value == null ? '' : def.value) : String(V.normalizeValue(def.value, 'number'));
      val.setAttribute('data-var-key', key);
      val.setAttribute('aria-label', 'Starting value for ' + def.name);
      val.addEventListener('change', () => {
        def.value = V.normalizeValue(val.value, def.type);
        markProjectDirty();
      });
      top.appendChild(val);
    }
    // The delete button sits after the value, so the value input
    // keeps its width in the narrow panel.
    top.appendChild(delBtn);
    return row;
  }

  function groupTitle(text) {
    const h = document.createElement('p');
    h.className = 'var-group-title';
    h.textContent = text;
    return h;
  }

  const globalDefs = defs.filter(d => d.scope === 'global');
  const sceneDefs = defs.filter(d => d.scope === 'scene');
  const objectDefs = defs.filter(d => d.scope === 'object');
  panel.appendChild(groupTitle('Global — whole game'));
  if (!globalDefs.length) {
    const empty = document.createElement('p');
    empty.className = 'hint-text';
    empty.textContent = 'No global variables yet.';
    panel.appendChild(empty);
  }
  globalDefs.forEach(d => panel.appendChild(defRow(d)));
  panel.appendChild(groupTitle('Scene — ' + sceneName));
  if (!sceneDefs.length) {
    const empty = document.createElement('p');
    empty.className = 'hint-text';
    empty.textContent = 'No scene variables yet. Each scene starts from these values.';
    panel.appendChild(empty);
  }
  sceneDefs.forEach(d => panel.appendChild(defRow(d)));
  const objectNames = [...new Set(objectDefs.map(d => d.objectName))].sort();
  panel.appendChild(groupTitle('Object — per object name'));
  if (!objectDefs.length) {
    const empty = document.createElement('p');
    empty.className = 'hint-text';
    empty.textContent = 'No object variables yet. One value per object name, kept across scenes.';
    panel.appendChild(empty);
  }
  objectNames.forEach(name => {
    const sub = document.createElement('p');
    sub.className = 'var-group-title';
    sub.textContent = name;
    panel.appendChild(sub);
    objectDefs.filter(d => d.objectName === name).forEach(d => panel.appendChild(defRow(d)));
  });
}
window.renderVariablesPanel = renderVariablesPanel;

// ---- The Preview tab's live readout. While a preview runs, every
// variable the game can see — definitions plus any the blocks
// created mid-run — with its current value, refreshed twice a
// second. The manager panel lives in the Scene tab, and switching
// tabs stops the preview, so the live view belongs here, next to
// the game. One row per variable: name, type, scope, live value.
// A `data-preview-var-key` holds the definition key, so tests and
// QA can read one value out of the list. ----
function previewVarRow(def, value, type, liveOnly) {
  const V = window.HydraVariables;
  const row = document.createElement('div');
  row.className = 'input-action-row var-row preview-var-row';
  const top = document.createElement('div');
  top.className = 'var-top input-action-top';
  const nameEl = document.createElement('span');
  nameEl.className = 'var-name';
  nameEl.textContent = def.name;
  top.appendChild(nameEl);
  const badge = document.createElement('span');
  badge.className = 'var-type';
  badge.textContent = type;
  top.appendChild(badge);
  const scopeEl = document.createElement('span');
  scopeEl.className = 'var-note';
  scopeEl.textContent = def.scope === 'object' ? 'Object: ' + def.objectName
    : def.scope === 'scene' ? 'Scene' : 'Global';
  top.appendChild(scopeEl);
  const val = document.createElement('span');
  val.className = 'var-note';
  val.textContent = value === undefined ? '(not set yet)' : variablesFormatValue(type, value);
  if (V) val.setAttribute('data-preview-var-key', V.definitionKey(def) || def.name);
  top.appendChild(val);
  if (liveOnly) {
    const dot = document.createElement('span');
    dot.className = 'var-live-dot';
    dot.title = 'Live only — made by blocks during play';
    top.appendChild(dot);
  }
  row.appendChild(top);
  return row;
}

function renderPreviewVariables() {
  const body = document.getElementById('preview-variables');
  if (!body) return;
  const V = window.HydraVariables;
  const live = variablesLiveState();
  const defs = getMutableScopedVariables() || [];
  const count = document.getElementById('preview-variables-count');
  if (count) count.textContent = String(defs.length);
  if (!V || !live) {
    body.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'hint-text';
    p.textContent = 'Launch the preview to see live values.';
    body.appendChild(p);
    return;
  }
  const sceneId = variablesLiveSceneId();
  body.innerHTML = '';
  const seen = new Set();
  defs.forEach(def => {
    const key = V.definitionKey(def);
    if (key) seen.add(key);
    let entry = null;
    try { entry = V.get(live, def.scope, def.name, { objectName: def.objectName, sceneId }); } catch (e) { entry = null; }
    body.appendChild(previewVarRow(def, entry ? entry.value : undefined, entry ? entry.type : def.type, false));
  });
  // Live-only variables the blocks created mid-run, with no definition.
  [['global', {}], ['scene', { sceneId }], ['object', {}]].forEach(([scope, opts]) => {
    let rows = [];
    try { rows = V.list(live, scope, opts); } catch (e) { rows = []; }
    rows.forEach(r => {
      const probe = V.normalizeDefinition({ name: r.name, scope, objectName: r.objectName || '', type: r.type, value: r.value });
      if (!probe) return;
      const key = V.definitionKey(probe);
      if (!key || seen.has(key)) return;
      seen.add(key);
      body.appendChild(previewVarRow(
        { name: r.name, scope, objectName: r.objectName || '', type: r.type }, r.value, r.type, true));
    });
  });
  if (!body.children.length) {
    const p = document.createElement('p');
    p.className = 'hint-text';
    p.textContent = 'No variables yet — add one in the Variables tab.';
    body.appendChild(p);
  }
}
window.renderPreviewVariables = renderPreviewVariables;

function initVariablesPanel() {
  const variablesTabBtn = document.querySelector('.inspector-tab[data-inspector-tab="variables"]');
  if (variablesTabBtn) variablesTabBtn.addEventListener('click', renderVariablesPanel);
  renderVariablesPanel();
  const pvToggle = document.getElementById('preview-variables-toggle');
  if (pvToggle) pvToggle.addEventListener('click', () => {
    const body = document.getElementById('preview-variables');
    if (body) body.hidden = !body.hidden;
  });
  // Live-values tick while the editor is open; the render no-ops
  // to a hint unless a preview is running.
  if (typeof setInterval === 'function') setInterval(renderPreviewVariables, 500);
}
window.initVariablesPanel = initVariablesPanel;

// ============================================================
// FUNCTIONS PANEL (P5-3 slice a: custom functions / custom blocks)
// The Functions inspector tab lists the project's functions —
// create, rename (rewriting every Call Function block that names
// the old name, so a rename never orphans a call), edit the
// parameters, open the body grid in the Logic tab, delete. The body
// itself is edited on the function's own scope tab, like a scene's
// grid; the panel only shows how many blocks it holds.
// ============================================================

// Every Call Function block that names `oldName`, across the stored
// grids (global, every scene, every function body) and the live
// cell map — the stored grid and the live map hold separate copies,
// so both are rewritten. Returns how many blocks were rewritten.
function renameFunctionReferences(oldName, newName) {
  let count = 0;
  const rewriteGrid = (grid) => {
    if (!grid || typeof grid !== 'object') return;
    Object.values(grid).forEach((cell) => {
      if (cell && cell.type === 'callFunction' && cell.functionName === oldName) {
        cell.functionName = newName;
        count++;
      }
    });
  };
  try {
    rewriteGrid(globalGridData);
    (typeof scenes !== 'undefined' ? scenes : []).forEach(s => rewriteGrid(s && s.gridData));
    (getMutableFunctions() || []).forEach(f => rewriteGrid(f && f.grid));
    if (typeof cellData !== 'undefined' && cellData && typeof cellData.forEach === 'function') {
      cellData.forEach((cell) => {
        if (cell && cell.type === 'callFunction' && cell.functionName === oldName) {
          cell.functionName = newName;
          count++;
        }
      });
    }
  } catch (e) { /* a broken grid never breaks the rename */ }
  return count;
}

// How many Call Function blocks name this function (for the delete
// confirm — deleting a called function orphans its calls, which
// then warn at runtime instead of running).
function countFunctionReferences(name) {
  let count = 0;
  const countGrid = (grid) => {
    if (!grid || typeof grid !== 'object') return;
    Object.values(grid).forEach((cell) => {
      if (cell && cell.type === 'callFunction' && cell.functionName === name) count++;
    });
  };
  try {
    countGrid(globalGridData);
    (typeof scenes !== 'undefined' ? scenes : []).forEach(s => countGrid(s && s.gridData));
    (getMutableFunctions() || []).forEach(f => countGrid(f && f.grid));
  } catch (e) { /* a broken grid never breaks the count */ }
  return count;
}

// P5-3 slice c — the note about the last parameter edit. When a
// parameter list lost entries (a duplicate name, or a ninth parameter
// past the cap), the panel says which ones it dropped instead of
// trimming the list silently. The note shows until the next panel
// action (add, rename, duplicate, delete, or another parameter edit)
// replaces or clears it.
let lastFnParamsNote = '';

// One plain line from a normalizeParamsReport report, or '' when
// nothing was dropped: 'Kept a, b. Dropped duplicate "a".' /
// 'Kept a, b, c, d, e, f, g, h. Dropped "i" past the 8-parameter
// cap.' A list that kept nothing still names what it dropped. (No
// em dash here: this string shows in the panel, and visible text
// never carries one.)
function fnParamsDropNote(report) {
  if (!report) return '';
  const parts = [];
  if (report.droppedDuplicates && report.droppedDuplicates.length) {
    const names = report.droppedDuplicates.map(n => '"' + n + '"').join(', ');
    parts.push(report.droppedDuplicates.length === 1
      ? 'Dropped duplicate ' + names + '.'
      : 'Dropped duplicates ' + names + '.');
  }
  if (report.droppedOverflow && report.droppedOverflow.length) {
    const names = report.droppedOverflow.map(n => '"' + n + '"').join(', ');
    parts.push('Dropped ' + names + ' past the 8-parameter cap.');
  }
  if (!parts.length) return '';
  const kept = (report.params && report.params.length) ? report.params.join(', ') : 'no parameters';
  return 'Kept ' + kept + '. ' + parts.join(' ');
}

function renderFunctionsPanel() {
  const panel = document.getElementById('functions-panel');
  if (!panel) return;
  const F = window.HydraFunctions;
  panel.innerHTML = '';
  if (!F) {
    const p = document.createElement('p');
    p.className = 'hint-text';
    p.textContent = 'Functions engine still loading — try again in a moment.';
    panel.appendChild(p);
    return;
  }
  const fns = getMutableFunctions();
  if (!fns) {
    const p = document.createElement('p');
    p.className = 'hint-text';
    p.textContent = 'Open a project to manage its functions.';
    panel.appendChild(p);
    return;
  }

  // ---- Add a function (behind a disclosure: the middle-ground rule
  // keeps the everyday list clean and the form one click away). ----
  const addDetails = document.createElement('details');
  addDetails.className = 'input-action-row';
  const addSummary = document.createElement('summary');
  addSummary.textContent = 'Add a function';
  addSummary.style.cssText = 'cursor:pointer;font-weight:600;font-size:13px;color:#1e293b';
  addDetails.appendChild(addSummary);
  const nameInput = document.createElement('input');
  nameInput.type = 'text'; nameInput.className = 'property-input';
  nameInput.placeholder = 'Name (e.g. addBonus)'; nameInput.setAttribute('aria-label', 'Function name');
  nameInput.id = 'fn-add-name';
  addDetails.appendChild(nameInput);
  const paramsInput = document.createElement('input');
  paramsInput.type = 'text'; paramsInput.className = 'property-input';
  paramsInput.placeholder = 'Parameters, comma-separated (up to 8)';
  paramsInput.setAttribute('aria-label', 'Parameters');
  paramsInput.id = 'fn-add-params';
  addDetails.appendChild(paramsInput);
  const errorLine = document.createElement('p');
  errorLine.className = 'var-add-error';
  errorLine.id = 'fn-add-error';
  addDetails.appendChild(errorLine);
  const addBtn = document.createElement('button');
  addBtn.type = 'button'; addBtn.className = 'icon-btn'; addBtn.textContent = 'Add function';
  addBtn.id = 'fn-add-btn';
  addBtn.style.cssText = 'align-self:flex-start';
  addDetails.appendChild(addBtn);
  addBtn.addEventListener('click', () => {
    errorLine.textContent = '';
    const rawName = (nameInput.value || '').trim();
    if (!rawName) { errorLine.textContent = 'Give the function a name first.'; nameInput.focus(); return; }
    if (F.findFunction(fns, rawName)) {
      errorLine.textContent = 'A function with that name already exists.';
      return;
    }
    const report = F.normalizeParamsReport((paramsInput.value || '').split(',').map(s => s.trim()));
    const params = report.params;
    lastFnParamsNote = fnParamsDropNote(report);
    const fn = F.normalizeFunction({ name: rawName, params, grid: {} });
    if (!fn) { errorLine.textContent = 'That function could not be created — check the name.'; return; }
    fns.push(fn);
    markProjectDirty();
    nameInput.value = '';
    paramsInput.value = '';
    addDetails.open = false;
    renderFunctionsPanel();
    refreshScopeTabs();
  });
  panel.appendChild(addDetails);

  // Slice c: the note about the last parameter edit, when the list
  // lost entries. It lives outside the add disclosure so it stays
  // visible after the form closes on a successful add.
  if (lastFnParamsNote) {
    const paramsNote = document.createElement('p');
    paramsNote.className = 'hint-text';
    paramsNote.id = 'fn-params-note';
    paramsNote.textContent = lastFnParamsNote;
    panel.appendChild(paramsNote);
  }

  if (!fns.length) {
    const empty = document.createElement('p');
    empty.className = 'hint-text';
    empty.textContent = 'No functions yet. Define one, then call it from any row with the Call Function block.';
    panel.appendChild(empty);
    return;
  }

  // ---- One row per function: rename, parameters, body size, edit,
  // delete. ----
  fns.forEach(fn => {
    const row = document.createElement('div');
    row.className = 'input-action-row var-row fn-row';
    const top = document.createElement('div');
    top.className = 'var-top input-action-top';
    const nameBtn = document.createElement('button');
    nameBtn.type = 'button'; nameBtn.className = 'var-name'; nameBtn.textContent = fn.name;
    nameBtn.title = 'Click to rename';
    nameBtn.addEventListener('click', () => {
      const next = prompt('Rename function:', fn.name);
      if (next == null) return;
      const trimmed = String(next).trim();
      if (!trimmed || trimmed === fn.name) return;
      if (F.findFunction(fns, trimmed)) {
        alert('A function with that name already exists.');
        return;
      }
      const oldName = fn.name;
      fn.name = trimmed;
      renameFunctionReferences(oldName, trimmed);
      lastFnParamsNote = '';
      markProjectDirty();
      renderFunctionsPanel();
      refreshScopeTabs();
    });
    top.appendChild(nameBtn);
    const badge = document.createElement('span');
    badge.className = 'fn-params';
    badge.textContent = fn.params.length ? '(' + fn.params.join(', ') + ')' : 'no parameters';
    // The badge truncates past 180px (slice b's fn-row rule), so the
    // full list stays reachable on hover.
    if (fn.params.length) badge.title = fn.params.join(', ');
    top.appendChild(badge);
    const delBtn = document.createElement('button');
    delBtn.type = 'button'; delBtn.className = 'icon-btn'; delBtn.textContent = '×';
    delBtn.title = 'Delete function'; delBtn.setAttribute('aria-label', 'Delete function ' + fn.name);
    delBtn.addEventListener('click', () => {
      const refs = countFunctionReferences(fn.name);
      if (refs > 0 && !confirm(`Delete "${fn.name}"? ${refs} Call Function block${refs === 1 ? '' : 's'} call${refs === 1 ? 's' : ''} it, and ${refs === 1 ? 'it' : 'they'} will warn instead of running.`)) return;
      const at = fns.indexOf(fn);
      if (at !== -1) fns.splice(at, 1);
      // A deleted function leaves no scope tab behind: when its own
      // body grid was open, fall back to the global grid.
      if (activeScriptScope === 'function:' + fn.id) {
        setActiveScriptScope('global');
        loadGridForScope('global');
      }
      lastFnParamsNote = '';
      markProjectDirty();
      renderFunctionsPanel();
      refreshScopeTabs();
    });
    row.appendChild(top);
    const bodyCount = fn.grid && typeof fn.grid === 'object' ? Object.keys(fn.grid).length : 0;
    // Slice c: the row says how many Call Function blocks name this
    // function, so a dead helper and a workhorse read differently at
    // a glance. The count reads the stored grids (the same source the
    // delete confirm uses) — a call typed into the live grid but not
    // yet committed is not counted.
    const refs = countFunctionReferences(fn.name);
    const callText = refs === 0 ? ' Not called yet.'
      : refs === 1 ? ' Called once.'
      : ' Called ' + refs + ' times.';
    const note = document.createElement('p');
    note.className = 'var-note';
    note.textContent = (bodyCount === 0
      ? 'Empty body — open it and add blocks.'
      : bodyCount + (bodyCount === 1 ? ' block' : ' blocks') + ' in the body.') + callText;
    row.appendChild(note);
    const paramsInputRow = document.createElement('input');
    paramsInputRow.type = 'text';
    paramsInputRow.className = 'property-input var-value';
    paramsInputRow.value = fn.params.join(', ');
    paramsInputRow.placeholder = 'Parameters, comma-separated (up to 8)';
    paramsInputRow.setAttribute('aria-label', 'Parameters for ' + fn.name);
    paramsInputRow.addEventListener('change', () => {
      // Slice c: the edit reports what it dropped, the same way the
      // add form does. The change fires on blur, so re-rendering the
      // panel to show the note cannot steal focus mid-edit.
      const report = F.normalizeParamsReport(paramsInputRow.value.split(',').map(s => s.trim()));
      fn.params = report.params;
      paramsInputRow.value = fn.params.join(', ');
      lastFnParamsNote = fnParamsDropNote(report);
      markProjectDirty();
      refreshScopeTabs();
      renderFunctionsPanel();
    });
    top.appendChild(paramsInputRow);
    const editBtn = document.createElement('button');
    editBtn.type = 'button'; editBtn.className = 'icon-btn'; editBtn.textContent = 'Edit body';
    editBtn.title = 'Open this function\'s body grid in the Logic tab';
    editBtn.setAttribute('aria-label', 'Edit body of function ' + fn.name);
    editBtn.addEventListener('click', () => {
      const tab = document.querySelector('.tab[data-tab="script-tab"]');
      if (tab) tab.click();
      switchScope('function:' + fn.id);
    });
    top.appendChild(editBtn);
    // Slice c: duplicate the function — same parameters, a deep copy
    // of the body, under a fresh 'copy' name — so a variant starts
    // from a working body instead of an empty grid.
    const dupBtn = document.createElement('button');
    dupBtn.type = 'button'; dupBtn.className = 'icon-btn'; dupBtn.textContent = 'Duplicate';
    dupBtn.title = 'Copy this function — same parameters, a copy of the body, under a new name';
    dupBtn.setAttribute('aria-label', 'Duplicate function ' + fn.name);
    dupBtn.addEventListener('click', () => {
      const copy = F.duplicateFunction(fns, fn);
      if (!copy) return;
      fns.push(copy);
      lastFnParamsNote = '';
      markProjectDirty();
      renderFunctionsPanel();
      refreshScopeTabs();
    });
    top.appendChild(dupBtn);
    // The delete button sits after the value, so the value input
    // keeps its width in the narrow panel.
    top.appendChild(delBtn);
    panel.appendChild(row);
  });
}
window.renderFunctionsPanel = renderFunctionsPanel;

function initFunctionsPanel() {
  const functionsTabBtn = document.querySelector('.inspector-tab[data-inspector-tab="functions"]');
  if (functionsTabBtn) functionsTabBtn.addEventListener('click', renderFunctionsPanel);
  renderFunctionsPanel();
}
window.initFunctionsPanel = initFunctionsPanel;

// ============================================================
// STATUS BAR (P5-2 slice a: object count, FPS, error count)
// The bar sits at the bottom of the editor: current scene +
// object count on the left, live preview FPS and the diagnostics
// count on the right. It refreshes on the same 500ms tick as the
// Live variables readout, so FPS follows the running preview and
// the diagnostics count follows the dock without a second timer.
// Writes only touch the DOM when a value actually changed, and
// the whole updater is guarded so the bar can never break the
// editor. Clicking the diagnostics item opens the dock.
// ============================================================
const statusBarEls = {
  scene: document.getElementById('status-scene-name'),
  objects: document.getElementById('status-object-count'),
  fps: document.getElementById('status-fps-value'),
  diagnostics: document.getElementById('status-diagnostics'),
  diagnosticsCount: document.getElementById('status-diagnostics-count')
};
const lastStatusBar = { scene: null, objects: null, fps: null, diagnostics: null };
function updateStatusBar() {
  try {
    const scene = (typeof getCurrentScene === 'function') ? getCurrentScene() : null;
    const sceneName = (scene && scene.name) ? String(scene.name) : '—';
    const objectCount = (scene && Array.isArray(scene.objects)) ? scene.objects.length : 0;
    let fps = 0;
    try {
      if (window.HydraPreviewRuntime && typeof window.HydraPreviewRuntime.previewFps === 'function') {
        fps = window.HydraPreviewRuntime.previewFps();
      }
    } catch (e) { fps = 0; }
    const fpsText = (typeof fps === 'number' && isFinite(fps) && fps > 0) ? String(Math.round(fps)) : '—';
    let diagCount = 0;
    const dockCount = document.getElementById('diagnostic-count');
    if (dockCount) {
      const n = parseInt(dockCount.textContent, 10);
      if (isFinite(n) && n >= 0) diagCount = n;
    }
    if (lastStatusBar.scene !== sceneName) {
      if (statusBarEls.scene) statusBarEls.scene.textContent = sceneName;
      lastStatusBar.scene = sceneName;
    }
    if (lastStatusBar.objects !== objectCount) {
      if (statusBarEls.objects) statusBarEls.objects.textContent = String(objectCount);
      lastStatusBar.objects = objectCount;
    }
    if (lastStatusBar.fps !== fpsText) {
      if (statusBarEls.fps) statusBarEls.fps.textContent = fpsText;
      lastStatusBar.fps = fpsText;
    }
    if (lastStatusBar.diagnostics !== diagCount) {
      if (statusBarEls.diagnosticsCount) statusBarEls.diagnosticsCount.textContent = String(diagCount);
      if (statusBarEls.diagnostics) statusBarEls.diagnostics.classList.toggle('has-errors', diagCount > 0);
      lastStatusBar.diagnostics = diagCount;
    }
  } catch (e) { /* the status bar never breaks the editor */ }
}
window.updateStatusBar = updateStatusBar;

function initStatusBar() {
  if (statusBarEls.diagnostics) statusBarEls.diagnostics.addEventListener('click', () => {
    const dock = document.getElementById('diagnostics-dock');
    const toggle = document.getElementById('diagnostics-toggle');
    if (dock) dock.classList.remove('is-collapsed');
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
  });
  updateStatusBar();
  if (typeof setInterval === 'function') setInterval(updateStatusBar, 500);
}
window.initStatusBar = initStatusBar;

// ============================================================
// RESIZABLE PANELS
// (P5-2 slice d: drag the handle on a side panel's left edge to
// resize it; double-click or Home resets to the default. Widths
// persist per browser in localStorage and are restored on load.
// The layout reads CSS variables off the tab containers, so the
// stage, toolbar, and panel all move together from one value.)
// ============================================================
var panelWidths = { scene: 340, logic: 320 };
function applyPanelWidths() {
  try {
    var sceneEditor = document.querySelector('.scene-editor');
    if (sceneEditor && sceneEditor.style) {
      sceneEditor.style.setProperty('--scene-panel-width', panelWidths.scene + 'px');
    }
  } catch (e) { /* a failed var write never breaks the editor */ }
  try {
    var gridEditor = document.querySelector('.grid-editor');
    if (gridEditor && gridEditor.style) {
      gridEditor.style.setProperty('--logic-panel-width', panelWidths.logic + 'px');
    }
  } catch (e) { /* a failed var write never breaks the editor */ }
}
function initPanelResizers() {
  try {
    var PR = window.HydraPanelResize;
    if (!PR) return;
    try {
      panelWidths = PR.readStoredWidths(window.localStorage);
    } catch (e) { panelWidths = { scene: 340, logic: 320 }; }
    applyPanelWidths();
    var getWidths = function () { return { scene: panelWidths.scene, logic: panelWidths.logic }; };
    var onWidth = function (panel, width) {
      if (panel === 'scene' || panel === 'logic') {
        panelWidths[panel] = width;
        applyPanelWidths();
      }
    };
    var sceneEditor = document.querySelector('.scene-editor');
    var gridEditor = document.querySelector('.grid-editor');
    panelResizers.scene = PR.createResizer({
      panel: 'scene',
      handle: document.getElementById('scene-panel-resizer'),
      container: sceneEditor,
      storage: window.localStorage,
      getWidths: getWidths,
      onWidth: onWidth,
      side: panelSides.scene
    });
    panelResizers.logic = PR.createResizer({
      panel: 'logic',
      handle: document.getElementById('logic-panel-resizer'),
      container: gridEditor,
      storage: window.localStorage,
      getWidths: getWidths,
      onWidth: onWidth,
      side: panelSides.logic
    });
  } catch (e) { /* resizable panels never break the editor */ }
}
window.initPanelResizers = initPanelResizers;

// ============================================================
// DOCKABLE PANELS
// (P5-8 slice a: a dock button in each tab's toolbar flips its
// side panel to the other edge — the stage, the toolbar, and the
// resize handle move with it, because the layout reads a
// data-panel-side attribute off the tab container. The side sticks:
// it is saved per browser in localStorage and restored on load.
// Runs before initPanelResizers, so the resizers start with the
// stored side and their drag math measures from the right edge.)
// ============================================================
var panelSides = { scene: 'right', logic: 'right' };
var panelResizers = { scene: null, logic: null };
function initPanelDock() {
  try {
    var PD = window.HydraPanelDock;
    if (!PD) return;
    try {
      panelSides = PD.readStoredSides(window.localStorage);
    } catch (e) { panelSides = { scene: 'right', logic: 'right' }; }
    var sceneEditor = document.querySelector('.scene-editor');
    var gridEditor = document.querySelector('.grid-editor');
    PD.applySide(sceneEditor, 'scene', panelSides.scene);
    PD.applySide(gridEditor, 'logic', panelSides.logic);
    var sceneBtn = document.getElementById('scene-panel-dock-btn');
    var logicBtn = document.getElementById('logic-panel-dock-btn');
    PD.updateDockButton(sceneBtn, 'scene', panelSides.scene);
    PD.updateDockButton(logicBtn, 'logic', panelSides.logic);
    var onSide = function (panel, side) {
      if (panel !== 'scene' && panel !== 'logic') return;
      panelSides[panel] = side;
      try {
        if (panelResizers[panel] && typeof panelResizers[panel].setSide === 'function') {
          panelResizers[panel].setSide(side);
        }
      } catch (e) { /* a missed resizer flip never breaks the editor */ }
      try { PD.writeStoredSides(window.localStorage, panelSides); } catch (e) { /* persistence is best-effort */ }
    };
    PD.createDockToggle({
      panel: 'scene',
      button: sceneBtn,
      container: sceneEditor,
      initialSide: panelSides.scene,
      onSide: onSide
    });
    PD.createDockToggle({
      panel: 'logic',
      button: logicBtn,
      container: gridEditor,
      initialSide: panelSides.logic,
      onSide: onSide
    });
  } catch (e) { /* dockable panels never break the editor */ }
}
window.initPanelDock = initPanelDock;

// ============================================================
// BLOCK DENSITY
// (P5-8 slice c: the "Compact blocks" toggle in the Logic tab's
// command bar shrinks the logic-grid cells from 56px to 44px so
// more blocks fit on screen. The grid carries a
// data-block-density attribute, which the CSS reads; the density
// sticks: it is saved per browser in localStorage and restored on
// load. Cell size is purely visual — the grid is still 60 columns
// wide with unbounded rows, and no block or chain changes meaning.)
// ============================================================
var blockDensity = 'comfortable';
function initBlockDensity() {
  try {
    var BD = window.HydraBlockDensity;
    if (!BD) return;
    try {
      blockDensity = BD.readStoredDensity(window.localStorage);
    } catch (e) { blockDensity = 'comfortable'; }
    var gridEditor = document.querySelector('.grid-editor');
    BD.applyDensity(gridEditor, blockDensity);
    var densityBtn = document.getElementById('block-density-btn');
    BD.updateDensityButton(densityBtn, blockDensity);
    var onDensity = function (density) {
      blockDensity = density;
      try { BD.writeStoredDensity(window.localStorage, blockDensity); } catch (e) { /* persistence is best-effort */ }
    };
    BD.createDensityToggle({
      button: densityBtn,
      container: gridEditor,
      initialDensity: blockDensity,
      onDensity: onDensity
    });
  } catch (e) { /* compact density never breaks the editor */ }
}
window.initBlockDensity = initBlockDensity;

// ============================================================
// TRANSITIONS PANEL
// (P4 Advanced batch 14: the default scene-transition effect +
// duration, edited in the Transitions tab; each Transition to
// Scene block can override both for one switch.)
// ============================================================
function renderTransitionsPanel() {
  const panel = document.getElementById('transitions-panel');
  if (!panel) return;
  const T = window.HydraTransition;
  panel.innerHTML = '';
  if (!T) {
    const p = document.createElement('p');
    p.className = 'hint-text';
    p.textContent = 'Transition engine still loading — try again in a moment.';
    panel.appendChild(p);
    return;
  }
  const config = getMutableTransitionConfig();
  if (!config) {
    const p = document.createElement('p');
    p.className = 'hint-text';
    p.textContent = 'Open a project to set up its scene transitions.';
    panel.appendChild(p);
    return;
  }
  // Config card: default effect + total duration.
  const card = document.createElement('div');
  card.className = 'input-action-row';
  const top = document.createElement('div');
  top.className = 'input-action-top highscore-row';
  const effectLabel = document.createElement('span');
  effectLabel.className = 'input-action-label';
  effectLabel.textContent = 'Default effect';
  top.appendChild(effectLabel);
  top.appendChild(makeSelect(
    [['fade', 'Fade to black'], ['wipe', 'Wipe across'], ['none', 'None (instant)']],
    config.effect || 'fade', v => {
      config.effect = v;
      markProjectDirty();
      renderTransitionsPanel();
    }));
  card.appendChild(top);
  const bottom = document.createElement('div');
  bottom.className = 'input-action-top highscore-row';
  const durLabel = document.createElement('span');
  durLabel.className = 'input-action-label';
  durLabel.textContent = 'Duration (seconds)';
  bottom.appendChild(durLabel);
  bottom.appendChild(makeNumberInput(config.duration == null ? 0.5 : config.duration, 0, 10, 0.1, v => {
    config.duration = v;
    markProjectDirty();
    renderTransitionsPanel();
  }));
  card.appendChild(bottom);
  panel.appendChild(card);
  const hint = document.createElement('p');
  hint.className = 'hint-text';
  hint.textContent = 'The duration is the total time: half to fade out, half to fade back in. 0 switches at once. A transition in progress shows over the preview canvas — press a key wired to Transition to Scene to see it.';
  panel.appendChild(hint);
}
window.renderTransitionsPanel = renderTransitionsPanel;

function initTransitionsPanel() {
  const transitionsTabBtn = document.querySelector('.inspector-tab[data-inspector-tab="transitions"]');
  if (transitionsTabBtn) transitionsTabBtn.addEventListener('click', renderTransitionsPanel);
  renderTransitionsPanel();
}
window.initTransitionsPanel = initTransitionsPanel;

// ============================================================
// JOYSTICK PANEL
// (P4 Advanced batch 20: the on-screen stick's project default —
// on or off, where the base sits, how big it is, what it writes.
// The Enable / Disable Joystick blocks flip the live stick during
// a run; this tab sets what a fresh run starts with.)
// ============================================================
function renderJoystickPanel() {
  const panel = document.getElementById('joystick-panel');
  if (!panel) return;
  const J = window.HydraJoystick;
  panel.innerHTML = '';
  if (!J) {
    const p = document.createElement('p');
    p.className = 'hint-text';
    p.textContent = 'Joystick engine still loading — try again in a moment.';
    panel.appendChild(p);
    return;
  }
  const config = getMutableJoystickConfig();
  if (!config) {
    const p = document.createElement('p');
    p.className = 'hint-text';
    p.textContent = 'Open a project to set up its on-screen joystick.';
    panel.appendChild(p);
    return;
  }
  function row(labelText, control) {
    const r = document.createElement('div');
    r.className = 'input-action-top highscore-row';
    const label = document.createElement('span');
    label.className = 'input-action-label';
    label.textContent = labelText;
    r.appendChild(label);
    r.appendChild(control);
    return r;
  }
  const card = document.createElement('div');
  card.className = 'input-action-row';
  card.appendChild(makeCheckbox('On by default', config.enabled === true, v => {
    config.enabled = v;
    markProjectDirty();
    renderJoystickPanel();
  }));
  card.appendChild(row('Base position', makeSelect(
    [['bottom-left', 'Bottom left'], ['bottom-right', 'Bottom right'], ['custom', 'Custom position']],
    config.anchor || 'bottom-left', v => {
      config.anchor = v;
      markProjectDirty();
      renderJoystickPanel();
    })));
  card.appendChild(row('Custom X (px)', makeNumberInput(config.x == null ? 120 : config.x, 0, 4000, 1, v => {
    config.x = v;
    markProjectDirty();
  })));
  card.appendChild(row('Custom Y (px)', makeNumberInput(config.y == null ? 480 : config.y, 0, 4000, 1, v => {
    config.y = v;
    markProjectDirty();
  })));
  card.appendChild(row('Base radius (px)', makeNumberInput(config.radius == null ? 60 : config.radius, 20, 200, 1, v => {
    config.radius = v;
    markProjectDirty();
  })));
  card.appendChild(row('Knob radius (px)', makeNumberInput(config.knobRadius == null ? 24 : config.knobRadius, 8, 100, 1, v => {
    config.knobRadius = v;
    markProjectDirty();
  })));
  card.appendChild(row('Dead zone (0-0.9)', makeNumberInput(config.deadzone == null ? 0.15 : config.deadzone, 0, 0.9, 0.05, v => {
    config.deadzone = v;
    markProjectDirty();
  })));
  card.appendChild(row('Left / right variable', makeTextInput(config.varX || '', 'joystickX', v => {
    config.varX = v;
    markProjectDirty();
  })));
  card.appendChild(row('Up / down variable', makeTextInput(config.varY || '', 'joystickY', v => {
    config.varY = v;
    markProjectDirty();
  })));
  card.appendChild(row('Tilt left drives', makeActionSelect(config.actionLeft || '', v => {
    config.actionLeft = v;
    markProjectDirty();
  })));
  card.appendChild(row('Tilt right drives', makeActionSelect(config.actionRight || '', v => {
    config.actionRight = v;
    markProjectDirty();
  })));
  card.appendChild(row('Tilt up drives', makeActionSelect(config.actionUp || '', v => {
    config.actionUp = v;
    markProjectDirty();
  })));
  card.appendChild(row('Tilt down drives', makeActionSelect(config.actionDown || '', v => {
    config.actionDown = v;
    markProjectDirty();
  })));
  panel.appendChild(card);
  const hint = document.createElement('p');
  hint.className = 'hint-text';
  hint.textContent = 'Custom X / Y only move the base when Base position is Custom position. The variables read -1 to 1 every frame while the stick is on (0 when released); leave one blank to skip it. A tilt past a third of the way holds that direction\'s action, with just-pressed and released edges like a key.';
  panel.appendChild(hint);
}
window.renderJoystickPanel = renderJoystickPanel;

function initJoystickPanel() {
  const joystickTabBtn = document.querySelector('.inspector-tab[data-inspector-tab="joystick"]');
  if (joystickTabBtn) joystickTabBtn.addEventListener('click', renderJoystickPanel);
  renderJoystickPanel();
}
window.initJoystickPanel = initJoystickPanel;

// ============================================================
// SCENE DATA
// Each scene: { id, name, objects[], bgColor, bgAssetId, width, height, gridData{} }
// objects: { id, name, kind('sprite'|'text'), posX, posY, width, height,
//            color, assetId, static, physicsEnabled,
//            physics{gravity,friction,bounciness,maxSpeed}, layer,
//            // text-only:
//            text, fontSize, fontFamily, textColor, textAlign, bold, italic,
//            // runtime:
//            velX, velY, _alive }
// ============================================================

let scenes = [{
  id: 1, name: 'Scene 1',
  objects: [],
  bgColor: '#ffffff',
  bgAssetId: null,
  width: 800, height: 600,
  worldWidth: 800, worldHeight: 600,
  viewportWidth: 800, viewportHeight: 600,
  gridData: {}
}];
let currentSceneId = 1;
let nextSceneId    = 2;
window.scenes = scenes;

function getCurrentScene() {
  const scene = scenes.find(s => s.id === currentSceneId) || scenes[0];
  normalizeSceneDimensions(scene);
  return scene;
}
window.getCurrentScene = getCurrentScene;

// Global script data (scope = 'global')
const globalGridData = {};
window.globalGridData = globalGridData;

// Active script scope: 'global' | scene id (number)
let activeScriptScope = 'global';
let hydratedScriptScope = null;
let scriptGridHydrated = false;

// ============================================================
// STATE
// ============================================================
const previewState = {
  sceneId: null,
  pendingSceneId: null,
  objects: [],
  executionContext: null,
  conditionContexts: {},
  flowTriggerStates: {},
  camera: { x: 0, y: 0, zoom: 1, followTarget: '' },
  // P2 item 15/12 slice 1 (shared engine): shake + flash state comes from
  // HydraCameraFx, the same module the exported runtime uses; the literal
  // is only the fallback if the module tag is ever dropped.
  cameraShake: window.HydraCameraFx ? window.HydraCameraFx.createShake() : { strength: 0, timeLeft: 0 },
  // Screen Flash (v4 gap, cycle 60): a fullscreen color wash that fades
  // out; timeLeft/maxTime are ms so the fade matches the shake clock.
  flash: window.HydraCameraFx ? window.HydraCameraFx.createFlash() : { color: '#ffffff', intensity: 0, timeLeft: 0, maxTime: 0 },
  mouse: { x: 0, y: 0 },
  dt: 1,
  frameId: 0,
  // F4 pause: paused freezes the world simulation (physics, anims, tweens,
  // camera, timers); pausedElapsedMs freezes the timer clock.
  // P4 Advanced batch 13 (time scale): timeScaleDebtMs is the clock
  // debt banked per frame by HydraTimeScale — the un-scaled portion,
  // so the named timers slow with the world.
  paused: false,
  pausedElapsedMs: 0,
  timeScaleDebtMs: 0
};
const gameVariables = {};
const hiddenObjects   = new Set();
const destroyedObjects = new Set();
const pendingDestroy   = new Set();
const gameStartFiredScopes = new Set();
let   autosaveTimer  = null;

function normalizeSceneDimensions(scene) {
  return HydraStage.normalizeSceneDimensions(scene);
}

function getSceneWorldWidth(scene) {
  return HydraStage.getSceneWorldWidth(scene);
}

function getSceneWorldHeight(scene) {
  return HydraStage.getSceneWorldHeight(scene);
}

function getSceneViewportWidth(scene) {
  return HydraStage.getSceneViewportWidth(scene);
}

function getSceneViewportHeight(scene) {
  return HydraStage.getSceneViewportHeight(scene);
}

function getPreviewScene() {
  const scene = scenes.find(s => s.id === previewState.sceneId) || getCurrentScene();
  normalizeSceneDimensions(scene);
  return scene;
}

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function syncEditorGlobals() {
  window.activeScriptScope = activeScriptScope;
  window.currentSceneId    = currentSceneId;
  window.nextSceneId       = nextSceneId;
}

function normalizeScriptScope(scope) {
  return HydraGridModel.normalizeScriptScope(scope);
}

function sameScriptScope(a, b) {
  return HydraGridModel.sameScriptScope(a, b);
}

function getScopeKey(scope) {
  return HydraGridModel.getScopeKey(scope);
}

function gridHasBlocks(gridData) {
  return HydraGridModel.gridHasBlocks(gridData);
}

function markProjectDirty(options = {}) {
  window.hydraProjectDirty = true;
  if (options.autosave === false) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    if (typeof window.projectManager?.saveProject === 'function') {
      window.projectManager.saveProject({ silent: true });
    }
  }, 900);
}

// P2 item 14 slice 8: the frame loop / run lifecycle lives in
// HydraPreviewRuntime now; script.js keeps this thin delegation
// so every existing call site is unchanged.
function stopPreviewLoop() {
  if (window.HydraPreviewRuntime) window.HydraPreviewRuntime.stopPreviewLoop();
}

function setActiveScriptScope(scope) {
  activeScriptScope = normalizeScriptScope(scope);
  syncEditorGlobals();
}

function preferCurrentSceneScriptIfGlobalEmpty() {
  const scene = getCurrentScene();
  if (
    activeScriptScope === 'global' &&
    !gridHasBlocks(globalGridData) &&
    gridHasBlocks(scene?.gridData)
  ) {
    setActiveScriptScope(scene.id);
    return true;
  }
  return false;
}

function setCurrentSceneId(sceneId) {
  currentSceneId = parseInt(sceneId) || scenes[0]?.id || 1;
  syncEditorGlobals();
}

function setNextSceneId(sceneId) {
  nextSceneId = Math.max(parseInt(sceneId) || 1, 1);
  syncEditorGlobals();
}

function commitActiveGrid(options = {}) {
  if (!scriptGridHydrated || !sameScriptScope(hydratedScriptScope, activeScriptScope)) {
    syncEditorGlobals();
    return;
  }
  saveGridToScope(activeScriptScope);
  syncEditorGlobals();
  refreshScriptMeta?.();
  if (options.dirty !== false) markProjectDirty({ autosave: options.autosave });
  refreshValidationDiagnostics();
}

// P3 item 18 — block validation: re-run the static check over the live
// editor state (window.scenes + window.globalGridData) and refresh the
// validation entries in the diagnostics dock. Never throws: a broken
// validator must not break grid editing.
function refreshValidationDiagnostics() {
  try {
    if (!window.HydraUniversal?.runBlockValidation) return;
    // P5-3 slice b: the validator also covers function body grids
    // and Call Function names, so the live project hands it the
    // function list too — without it the function checks never run.
    window.HydraUniversal.runBlockValidation({
      scenes: window.scenes || [],
      globalGridData: window.globalGridData || {},
      functions: (typeof getMutableFunctions === 'function' ? getMutableFunctions() : []) || []
    });
  } catch (e) { /* validation is advisory; the editor keeps working */ }
}
window.refreshValidationDiagnostics = refreshValidationDiagnostics;

syncEditorGlobals();

// ============================================================
// TAB SWITCHING
// ============================================================
const tabs        = document.querySelectorAll('.tab');
const tabContents = document.querySelectorAll('.tab-content');

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    commitActiveGrid();
    stopPreviewLoop();

    tabs.forEach(t => t.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    const tabId = tab.getAttribute('data-tab');
    document.getElementById(tabId).classList.add('active');

    if (tabId === 'preview-tab') {
      launchPreview();
    } else if (tabId === 'scene-tab') {
      initSceneEditor();
      renderSceneObjects();
      refreshSceneList();
      refreshScopeTabs();
    } else if (tabId === 'script-tab') {
      preferCurrentSceneScriptIfGlobalEmpty();
      refreshScopeTabs();
      loadGridForScope(activeScriptScope);
    }
  });
});

// ============================================================
// TUTORIAL PANEL (P3 item 21: guided first-run tutorial)
// ============================================================
// Shown only for projects built from the First Game Tutorial template
// (project.tutorial === 'first-game'), until the user dismisses it; the
// dismissal is stored per project id in localStorage, so reopening the
// project does not resurrect the guide. This listener runs after
// project.js's DOMContentLoaded handler (script order), so
// projectManager.getCurrentProject() is already populated.
document.addEventListener('DOMContentLoaded', () => {
  try {
    const panel = document.getElementById('tutorial-panel');
    if (!panel) return;
    const project = window.projectManager?.getCurrentProject?.();
    if (!project || project.tutorial !== 'first-game') return;
    if (window.localStorage?.getItem('hydraTutorialDismissed:' + project.id)) return;
    panel.hidden = false;
    const clickTab = (tabId) => {
      const tab = document.querySelector('.tab[data-tab="' + tabId + '"]');
      if (tab) tab.click();
    };
    document.getElementById('tutorial-open-logic-btn')?.addEventListener('click', () => clickTab('script-tab'));
    document.getElementById('tutorial-open-preview-btn')?.addEventListener('click', () => clickTab('preview-tab'));
    document.getElementById('tutorial-dismiss-btn')?.addEventListener('click', () => {
      try { window.localStorage?.setItem('hydraTutorialDismissed:' + project.id, '1'); } catch (e) { /* private mode: session-only */ }
      panel.hidden = true;
    });
  } catch (e) { /* a broken guide must never break the editor */ }
});

// ============================================================
// SCRIPT SCOPE — per-scene + global
// ============================================================
function refreshScopeTabs() {
  const container = document.getElementById('scope-tabs');
  if (!container) return;
  container.innerHTML = '';

  // Global tab
  const globalTab = document.createElement('div');
  globalTab.className = 'scope-tab' + (activeScriptScope === 'global' ? ' active' : '');
  globalTab.dataset.scope = 'global';
  globalTab.innerHTML = '<i class="fas fa-globe"></i> Global';
  globalTab.addEventListener('click', () => switchScope('global'));
  container.appendChild(globalTab);

  // One tab per scene
  scenes.forEach(s => {
    const t = document.createElement('div');
    t.className = 'scope-tab' + (activeScriptScope === s.id ? ' active' : '');
    t.dataset.scope = s.id;
    t.textContent = s.name;
    t.addEventListener('click', () => switchScope(s.id));
    container.appendChild(t);
  });

  // One tab per function (P5-3): a function's body grid is its own
  // scope, edited like a scene's grid and run only when Call
  // Function names it.
  (getMutableFunctions() || []).forEach(fn => {
    const scopeKey = 'function:' + fn.id;
    const t = document.createElement('div');
    t.className = 'scope-tab' + (activeScriptScope === scopeKey ? ' active' : '');
    t.dataset.scope = scopeKey;
    t.textContent = 'ƒ ' + fn.name;
    t.addEventListener('click', () => switchScope(scopeKey));
    container.appendChild(t);
  });

  const info = document.getElementById('scope-info');
  if (info) {
    if (activeScriptScope === 'global') {
      info.textContent = 'Global script runs logic across ALL scenes';
    } else if (typeof activeScriptScope === 'string' && activeScriptScope.indexOf('function:') === 0) {
      const fn = (getMutableFunctions() || []).find(f => 'function:' + f.id === activeScriptScope);
      info.textContent = `Function body: ${fn ? fn.name : '?'} — only runs when Call Function names it`;
    } else {
      const s = scenes.find(x => x.id === activeScriptScope);
      info.textContent = `Script for scene: ${s ? s.name : '?'} — only runs when this scene is active`;
    }
  }
}

function switchScope(scope) {
  // Save current grid before switching
  commitActiveGrid();
  setActiveScriptScope(scope);
  refreshScopeTabs();
  loadGridForScope(activeScriptScope);
}

function getGridDataForScope(scope) {
  return HydraGridModel.getGridDataForScope({ scenes, globalGridData, functions: getMutableFunctions() }, scope);
}

function saveGridToScope(scope) {
  HydraGridModel.saveGridToScope(
    { scenes, globalGridData, functions: getMutableFunctions() }, scope, cellData, window.HydraUniversal?.normalizeScene);
}

function loadGridForScope(scope) {
  const normalizedScope = normalizeScriptScope(scope);
  const source = getGridDataForScope(normalizedScope);
  // Clear visual grid
  cells.forEach(cell => {
    cell.classList.remove(...ALL_BLOCK_CLASSES, 'selected', 'triggered');
    delete cell.dataset.blockType;
    clearBlockVisualFromCell(cell);
  });
  cellData.clear();
  // Load from source
  HydraGridModel.loadGridEntries(source).forEach(({ index: idx, data }) => {
    cellData.set(idx, data);
    const cell      = cells[idx];
    const blockType = typeToBlockClass(data.type);
    if (cell && blockType) {
      cell.classList.add(blockType);
      cell.dataset.blockType = blockType;
      applyBlockVisualToCell(cell, blockType);
    }
  });
  // Second pass: per-side connectors depend on neighbors, which may have
  // been placed after this cell in the loop above.
  cells.forEach(cell => {
    if (cell.dataset.blockType) applyBlockVisualToCell(cell, cell.dataset.blockType);
  });
  hydratedScriptScope = normalizedScope;
  scriptGridHydrated = true;
  clearSelectedCell();
  showDefaultPropertiesPanel();
  refreshScriptMeta();
}

function typeToBlockClass(type) {
  return HydraGridModel.blockClassForType(type, getCatalogBlocks());
}

// ============================================================
// GRID SYSTEM
// ============================================================
// P1 item 16 (resilience): #grid and #game-canvas are looked up at load
// time, and a missing element used to kill this whole script (a null
// canvas throws inside getContext at line 4063, a null grid inside
// renderGrid). Fall back to a detached element of the same kind so the
// rest of the editor keeps working; the missing piece is logged, and the
// affected pane simply renders nothing.
function fallbackElement(id, tagName) {
  console.error(`HydraScript: #${id} is missing from the page; using a detached <${tagName}> so the editor keeps working.`);
  const el = document.createElement(tagName);
  el.id = id;
  return el;
}
const grid          = document.getElementById('grid') || fallbackElement('grid', 'div');
const gridContainer = document.querySelector('.grid-container');
const clearButton   = document.getElementById('clearButton');
const blockSearch   = document.getElementById('block-search');
const scriptBlockCountEl = document.getElementById('script-block-count');
const scriptActiveToolEl = document.getElementById('script-active-tool');
const addConditionToolBtn = document.getElementById('add-condition-tool');
const addActionToolBtn = document.getElementById('add-action-tool');
const addCommentToolBtn = document.getElementById('add-comment-tool');

function getCatalogBlocks() {
  return window.HydraBlockCatalog?.blocks || [];
}

function getCatalogBlock(blockType) {
  return getCatalogBlocks().find(block => block.blockType === blockType) || null;
}

function getCatalogBlockByRuntimeType(runtimeType) {
  return getCatalogBlocks().find(block => block.runtimeType === runtimeType) || null;
}

function getCatalogRuntimeTypes(kind = null) {
  return getCatalogBlocks()
    .filter(block => !kind || block.kind === kind)
    .map(block => block.runtimeType);
}

function hydrateCatalogBlocks() {
  const selector = document.querySelector('.block-selector');
  if (!selector) return;
  const existing = new Set([...selector.querySelectorAll('.block-option')].map(option => option.dataset.blockType));
  const categoryAnchors = new Map();

  function getCategoryAnchor(category) {
    if (categoryAnchors.has(category)) return categoryAnchors.get(category);
    const label = document.createElement('div');
    label.className = 'block-category-label';
    label.textContent = category;
    selector.appendChild(label);
    categoryAnchors.set(category, label);
    return label;
  }

  getCatalogBlocks().forEach(block => {
    if (block.hidden) return;
    if (existing.has(block.blockType)) return;
    const category = block.category || (block.kind === 'condition' ? 'Logic' : 'Actions');
    const anchor = getCategoryAnchor(category);
    const option = document.createElement('div');
    option.className = 'block-option';
    option.dataset.blockType = block.blockType;
    option.dataset.category = category;
    option.title = block.note || block.label;
    option.innerHTML = `
      <div class="block-color" style="background:${block.color || '#64748b'};"></div>
      <div class="block-label">${block.label}</div>
    `;
    // Insert under its own category heading, after the last option
    // already there. Appending at the end would strand a block added
    // to an existing category under whatever heading came last in
    // catalog order (a new block for Scene would render under Time).
    let ref = anchor;
    while (ref.nextElementSibling &&
      ref.nextElementSibling.classList.contains('block-option') &&
      ref.nextElementSibling.dataset.category === category) {
      ref = ref.nextElementSibling;
    }
    ref.after(option);
    existing.add(block.blockType);
  });
}

hydrateCatalogBlocks();
const blockOptions  = document.querySelectorAll('.block-option');

let selectedBlockType = 'none';
let selectedCell      = null;
let cells             = [];
const cellData        = new Map();
window.cellData       = cellData;

function setSelectedBlockTool(blockType) {
  selectedBlockType = blockType || 'none';
  blockOptions.forEach(option => {
    option.classList.toggle('selected', option.getAttribute('data-block-type') === selectedBlockType);
  });
  refreshScriptMeta();
}

function clearSelectedCell() {
  cells.forEach(cell => cell.classList.remove('selected'));
  selectedCell = null;
}

blockOptions.forEach(opt => {
  opt.addEventListener('click', () => { setPaletteRoving(opt); setSelectedBlockTool(opt.getAttribute('data-block-type')); });
});

// P3 item 17 (accessibility): the block palette is keyboard-operable.
// Options are buttons to assistive tech, with one Tab stop (roving tabindex):
// arrows move between visible options, Enter/Space picks the tool.
let paletteRoving = null;
function paletteVisibleOptions() {
  return [...document.querySelectorAll('.block-option')]
    .filter(opt => !opt.classList.contains('is-filtered'));
}
function setPaletteRoving(opt) {
  if (paletteRoving && paletteRoving !== opt) paletteRoving.tabIndex = -1;
  if (opt) { opt.tabIndex = 0; paletteRoving = opt; }
}
function initPaletteA11y() {
  document.querySelectorAll('.block-option').forEach(opt => {
    opt.setAttribute('role', 'button');
    const label = opt.querySelector('.block-label')?.textContent?.trim()
      || opt.dataset.blockType || 'Block';
    opt.setAttribute('aria-label', label);
    if (opt.tabIndex !== 0) opt.tabIndex = -1;
  });
  const first = paletteVisibleOptions()[0];
  if (first) setPaletteRoving(first);
}
initPaletteA11y();
document.querySelector('.block-selector')?.addEventListener('keydown', e => {
  const opt = e.target.closest?.('.block-option');
  if (!opt) return;
  const visible = paletteVisibleOptions();
  const at = visible.indexOf(opt);
  let next = null;
  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = visible[Math.min(at + 1, visible.length - 1)];
  else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = visible[Math.max(at - 1, 0)];
  else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault(); e.stopPropagation();
    setPaletteRoving(opt);
    setSelectedBlockTool(opt.getAttribute('data-block-type'));
    return;
  } else return;
  if (!next || next === opt) return;
  e.preventDefault(); e.stopPropagation();
  setPaletteRoving(next);
  next.focus();
});

addConditionToolBtn?.addEventListener('click', () => openLogicBlockPicker('condition', setSelectedBlockTool));
addActionToolBtn?.addEventListener('click', () => openLogicBlockPicker('action', setSelectedBlockTool));
addCommentToolBtn?.addEventListener('click', () => setSelectedBlockTool('comment-block'));

blockSearch?.addEventListener('input', e => {
  const term = e.target.value.trim().toLowerCase();
  blockOptions.forEach(opt => {
    const label = opt.querySelector('.block-label')?.textContent.toLowerCase() || '';
    const type = opt.getAttribute('data-block-type') || '';
    opt.classList.toggle('is-filtered', Boolean(term) && !label.includes(term) && !type.includes(term));
  });
  // Keep the single Tab stop on a visible option after filtering.
  const firstVisible = paletteVisibleOptions()[0];
  if (firstVisible) setPaletteRoving(firstVisible);
});

function refreshScriptMeta() {
  if (scriptBlockCountEl) scriptBlockCountEl.textContent = String(cellData.size);
  if (scriptActiveToolEl) {
    const selected = [...blockOptions].find(opt => opt.getAttribute('data-block-type') === selectedBlockType);
    scriptActiveToolEl.textContent = selected?.querySelector('.block-label')?.textContent || 'Select / Erase';
  }
  refreshGridEmptyHint();
}

// F1 polish: guided empty-state for the logic grid. When the active scope
// has no blocks yet, a hint bar floats over the grid pointing the user at
// the block picker. Dismissal is per scope and resets when scopes change.
let gridHintDismissedScope = null;
function refreshGridEmptyHint() {
  if (!gridContainer) return;
  const scope = activeScriptScope;
  if (scope !== gridHintDismissedScope) gridHintDismissedScope = null;
  let hint = gridContainer.querySelector('.grid-empty-hint');
  if (cellData.size > 0 || gridHintDismissedScope === scope) {
    hint?.remove();
    return;
  }
  if (hint) return;
  hint = document.createElement('div');
  hint.className = 'grid-empty-hint';
  hint.innerHTML =
    '<i class="fas fa-lightbulb"></i>' +
    '<div class="grid-empty-hint-copy">' +
      '<strong>This logic is empty</strong>' +
      '<span>Conditions on the left run actions on the right. Start with one condition to make something happen.</span>' +
    '</div>' +
    '<button type="button" class="grid-empty-hint-btn"><i class="fas fa-plus"></i> Add your first block</button>' +
    '<button type="button" class="grid-empty-hint-close" title="Dismiss"><i class="fas fa-times"></i></button>';
  hint.querySelector('.grid-empty-hint-btn')?.addEventListener('click', () => {
    openLogicBlockPicker('condition', setSelectedBlockTool);
  });
  hint.querySelector('.grid-empty-hint-close')?.addEventListener('click', () => {
    gridHintDismissedScope = scope;
    hint.remove();
  });
  gridContainer.appendChild(hint);
}

function openLogicBlockPicker(kind, onPick) {
  const allowed = [...document.querySelectorAll('.block-option')]
    .filter(opt => opt.dataset.blockType && opt.dataset.blockType !== 'none')
    .filter(opt => {
      const dataType = previewBlockRuntimeType(opt.dataset.blockType);
      const runtimeKind = dataType === 'comment' ? 'comment' : isConditionRuntimeType(dataType) ? 'condition' : 'action';
      return kind === runtimeKind || (kind === 'action' && runtimeKind === 'comment');
    });
  const categoryFor = opt => {
    let node = opt.previousElementSibling;
    while (node) {
      if (node.classList?.contains('block-category-label')) return node.textContent;
      node = node.previousElementSibling;
    }
    return kind === 'condition' ? 'Conditions' : 'Actions';
  };
  openPickerDialog(`Add ${kind}`, allowed.map(opt => ({
    title: opt.querySelector('.block-label')?.textContent || opt.dataset.blockType,
    category: categoryFor(opt),
    description: getCatalogBlock(opt.dataset.blockType)?.note || opt.dataset.blockType,
    fields: getCatalogBlock(opt.dataset.blockType)?.fields || [],
    value: opt.dataset.blockType
  })), onPick);
}

function previewBlockRuntimeType(blockType) {
  const catalog = getCatalogBlock(blockType);
  if (catalog) return catalog.runtimeType;
  const defaults = {
    condition: 'keyPressed',
    'mouse-condition': 'mouseClick',
    'advanced-condition': 'collision',
    action: 'applyForce',
    'advanced-action': 'teleport',
    'and-condition': 'and',
    'set-variable': 'setVariable',
    'get-variable': 'getVariable',
    'destroy-object': 'destroyObject',
    'show-hide': 'showHide',
    'play-sound': 'playSound',
    'play-animation': 'playAnimation',
    'set-animation': 'setAnimation',
    'stop-animation': 'stopAnimation',
    'animation-finished-condition': 'animationFinished',
    'set-anim-state': 'setAnimState',
    'anim-state-condition': 'animStateIs',
    'set-blend': 'setBlend',
    'stop-blend': 'stopBlend',
    'blend-active-condition': 'blendActive',
    'tween-property': 'tweenProperty',
    'stop-tween': 'stopTween',
    'tween-finished-condition': 'tweenFinished',
    'save-game': 'saveGame',
    'load-game': 'loadGame',
    'delete-save': 'deleteSaveSlot',
    'save-slot-exists-condition': 'saveSlotExists',
    'game-start': 'gameStart',
    'switch-scene': 'switchScene',
    'set-text': 'setText',
    'set-camera': 'setCamera',
    'follow-camera': 'followCamera',
    'set-size': 'setSize',
    'timer-condition': 'onTimer',
    'edge-condition': 'onEdge',
    'trigger-once-condition': 'triggerOnce',
    'set-velocity': 'setVelocity',
    'spawn-object': 'spawnObject',
    'rotate-object': 'rotateObject',
    'random-variable': 'randomVariable',
    'overlap-condition': 'overlapTouch',
    'force-toward': 'forceToward'
  };
  return defaults[blockType] || blockType;
}

const ALL_BLOCK_CLASSES = [
  'condition','action','advanced-condition','advanced-action',
  'and-condition','set-variable','get-variable','destroy-object',
  'show-hide','play-sound','play-animation','set-animation','stop-animation','animation-finished-condition','set-anim-state','anim-state-condition','tween-property','stop-tween','tween-finished-condition','game-start','switch-scene','mouse-condition','set-text',
  'set-camera','follow-camera','set-size','timer-condition','edge-condition','trigger-once-condition','set-velocity','spawn-object','rotate-object','random-variable',
  'overlap-condition','force-toward',
  ...getCatalogBlocks().map(block => block.blockType)
];

// Legacy + catalog block palette, read once from the block picker DOM so the
// grid always matches the picker's colors and labels (single source of truth).
let blockOptionMetaCache = null;
function blockOptionMeta(blockType) {
  if (!blockOptionMetaCache) {
    blockOptionMetaCache = new Map();
    document.querySelectorAll('.block-option[data-block-type]').forEach(opt => {
      const bt = opt.dataset.blockType;
      if (!bt || blockOptionMetaCache.has(bt)) return;
      const label = opt.querySelector('.block-label')?.textContent?.trim() || bt;
      const colorEl = opt.querySelector('.block-color');
      const color = colorEl ? getComputedStyle(colorEl).backgroundColor : '#64748b';
      blockOptionMetaCache.set(bt, { label, color });
    });
  }
  return blockOptionMetaCache.get(blockType) || null;
}

// Chain distances (Nov 5): how many steps each action sits from the
// nearest condition, following action adjacency in any direction.
// Conditions are distance 0. Used to decide which side of an action is
// its input (socket, toward the chain source) and which side is its
// output stub (tab, toward the chain's next link).
function conceptChainDistances() {
  const dist = new Map();
  const queue = [];
  cells.forEach((cell, idx) => {
    if (!cell.dataset.blockType) return;
    const rt = previewBlockRuntimeType(cell.dataset.blockType);
    if (isCommentRuntimeType(rt)) return;
    if (isConditionRuntimeType(rt)) { dist.set(idx, 0); queue.push(idx); }
  });
  const dirs = [[-1, 0], [0, 1], [1, 0], [0, -1]];
  while (queue.length) {
    const idx = queue.shift();
    const d = dist.get(idx);
    const row = Math.floor(idx / 60), col = idx % 60;
    for (const [dr, dc] of dirs) {
      const r = row + dr, c = col + dc;
      if (r < 0 || r >= 60 || c < 0 || c >= 60) continue;
      const nIdx = r * 60 + c;
      if (dist.has(nIdx)) continue;
      const nb = cells[nIdx];
      if (!nb || !nb.dataset.blockType) continue;
      const nrt = previewBlockRuntimeType(nb.dataset.blockType);
      if (isCommentRuntimeType(nrt) || isConditionRuntimeType(nrt)) continue;
      dist.set(nIdx, d + 1);
      queue.push(nIdx);
    }
  }
  return dist;
}

// Directional chaining (Ky'lin's call, Nov 5): each side is a tab (stub),
// a slot (socket), or nothing. The chain flows out from a condition in
// any direction. A condition's sides facing actions are tabs (outputs).
// An action's side facing its chain source is a slot (input); its side
// toward the chain's next link is a stub (tab, output). If no next link
// is placed yet, the stub sits on the side opposite the input, so the
// chain's direction is visible and the next block snaps onto it. Sides
// with no chain on them stay plain rounded-square edges, so a lone block
// is just a rounded square. Comments never connect.
function conceptSidesForCell(cell) {
  const none = { top: null, right: null, bottom: null, left: null };
  const blockType = cell.dataset.blockType;
  if (!blockType) return none;
  const rt = previewBlockRuntimeType(blockType);
  if (isCommentRuntimeType(rt)) return none;
  const isCondition = isConditionRuntimeType(rt);
  const row = parseInt(cell.dataset.row), col = parseInt(cell.dataset.col);
  const dirs = { top: [-1, 0], right: [0, 1], bottom: [1, 0], left: [0, -1] };
  const opp = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' };
  const sides = { top: null, right: null, bottom: null, left: null };
  const neighbor = side => {
    const [dr, dc] = dirs[side];
    const r = row + dr, c = col + dc;
    if (r < 0 || r >= 60 || c < 0 || c >= 60) return null;
    const nb = cells[r * 60 + c];
    if (!nb || !nb.dataset.blockType) return null;
    const nrt = previewBlockRuntimeType(nb.dataset.blockType);
    if (isCommentRuntimeType(nrt)) return null;
    return { cell: nb, isCondition: isConditionRuntimeType(nrt) };
  };
  if (isCondition) {
    for (const side of Object.keys(dirs)) {
      const nb = neighbor(side);
      if (nb && !nb.isCondition) sides[side] = 'tab';
    }
    return sides;
  }
  const dist = conceptChainDistances();
  const idx = parseInt(cell.dataset.index);
  const d = dist.get(idx);
  if (d === undefined) return none;
  let firstInput = null;
  for (const side of Object.keys(dirs)) {
    const nb = neighbor(side);
    if (!nb) continue;
    if (nb.isCondition) {
      sides[side] = 'slot';
      if (!firstInput) firstInput = side;
      continue;
    }
    const nd = dist.get(parseInt(nb.cell.dataset.index));
    if (nd === undefined) continue;
    if (nd === d - 1) {
      sides[side] = 'slot';
      if (!firstInput) firstInput = side;
    } else if (nd === d + 1) {
      sides[side] = 'tab';
    }
  }
  const hasTab = Object.values(sides).some(v => v === 'tab');
  // A stub with no next link yet is 'stub', not 'tab': it is not seated
  // in any socket, so it gets its own outline (see conceptOutlinePath).
  // A seated tab carries no outline of its own, the socket frames it.
  if (!hasTab && firstInput) sides[opp[firstInput]] = 'stub';
  return sides;
}

// Re-render the visuals of cells adjacent to `cell`: their per-side
// connectors depend on whether this cell holds a block.
function refreshAdjacentBlockVisuals(cell) {
  const idx = parseInt(cell.dataset.index);
  if (!Number.isFinite(idx)) return;
  // Merge fix (Nov 5, 2026): the prototype called the bare global
  // getAdjacentIndexes, which the P2 modularization moved into
  // HydraGridModel.adjacentIndexes. Same orthogonal neighbours.
  HydraGridModel.adjacentIndexes(idx).forEach(nIdx => {
    const nb = cells[nIdx];
    if (nb && nb.dataset.blockType) applyBlockVisualToCell(nb, nb.dataset.blockType);
  });
}

function applyBlockVisualToCell(cell, blockType) {
  const catalogBlock = getCatalogBlock(blockType);
  const meta = blockOptionMeta(blockType);
  const color = (catalogBlock && catalogBlock.color) || (meta && meta.color) || '#64748b';
  const label = (catalogBlock && (catalogBlock.cellLabel || catalogBlock.label)) ||
    (meta && meta.label) || blockType;
  cell.style.setProperty('--block-color', color);
  cell.dataset.blockLabel = label;
  cell.title = (catalogBlock && catalogBlock.note) || label;
  updateCellA11y(cell);
  // Concept-image blocks (Nov 4, 2026): rounded chunky body, connectors
  // only on sides with a real connection (conditional connectors, Nov 5).
  cell.classList.add('puzzle-block');
  // Apply Force (Nov 7, 2026): the arrow rotates to the force direction
  // from the cell's own X/Y. No stored data yet (a fresh place renders
  // before its defaults exist) or expression values read as no angle,
  // so the default right-pointing arrow shows until the panel holds
  // numbers. The module is guarded: an editor without it still draws.
  let forceAngle = null;
  try {
    const FA = (typeof window !== 'undefined' && window.HydraForceArrow) || null;
    const idx = parseInt(cell.dataset.index, 10);
    if (FA && Number.isFinite(idx)) forceAngle = FA.angleForBlock(cellData.get(idx));
  } catch (e) { forceAngle = null; }
  cell.innerHTML = conceptBlockSVG(blockType, color, label, conceptSidesForCell(cell), forceAngle);
}

function clearBlockVisualFromCell(cell) {
  cell.style.removeProperty('--block-color');
  delete cell.dataset.blockLabel;
  cell.classList.remove('puzzle-block');
  cell.innerHTML = '';
  updateCellA11y(cell);
}

// Parametric puzzle-piece silhouette for Direction A blocks (56x56 grid cell).
// nSockets: semicircular dents on the left edge (inputs). nTabs: protrusions on
// the right edge (outputs). Tab radius matches socket radius so a tab plugs a socket.
function puzzleBlockPath(w, h, r, nSockets, nTabs, tr) {
  const sockY = i => h * (i + 1) / (nSockets + 1);
  const tabY  = i => h * (i + 1) / (nTabs + 1);
  let d = `M ${r} 0 L ${w - r} 0 Q ${w} 0 ${w} ${r}`;
  const tabs = [];
  for (let i = 0; i < nTabs; i++) tabs.push(tabY(i));
  tabs.sort((a, b) => a - b);
  for (const ty of tabs) {
    d += ` L ${w} ${(ty - tr).toFixed(2)} A ${tr} ${tr} 0 0 1 ${w} ${(ty + tr).toFixed(2)}`;
  }
  d += ` L ${w} ${h - r} Q ${w} ${h} ${w - r} ${h} L ${r} ${h} Q 0 ${h} 0 ${h - r}`;
  const socks = [];
  for (let i = 0; i < nSockets; i++) socks.push(sockY(i));
  socks.sort((a, b) => b - a);
  for (const sy of socks) {
    d += ` L 0 ${(sy + tr).toFixed(2)} A ${tr} ${tr} 0 0 0 0 ${(sy - tr).toFixed(2)}`;
  }
  d += ` L 0 ${r} Q 0 0 ${r} 0 Z`;
  return d;
}

// Concept-image blocks (Nov 4, 2026): the user's concept sketch, built
// literally. Rounded chunky body, one big connector per side, centered.
// Directional chaining (Nov 5): each side is a tab (stub out), a slot
// (socket in), or a plain edge, decided per side by the chain. A
// condition's sides facing actions are tabs (it sends). An action's side
// facing its chain source is a slot (it receives); its side toward the
// chain's next link is a stub (it sends on). Comments: plain rounded slab.
// Exact fit + depth: the tab is the exact mirror of the slot (20 wide, 8
// out/deep, 3-radius corners), so a seated tab touches the socket walls
// with zero gap. Outline: a socket's walls are traced (strong, so the half
// of the outline a seated tab covers still reads); a tab's base has a gap
// in the outline, so no line cuts through a tab. No drop shadow (Nov 5): a
// shadow cast onto the socket is the cue for floating above it, so the tab
// read as higher z-order than the condition. Interlocked pieces are
// coplanar; the diagonal sheen gives the light.
let conceptSheenId = 0;
function conceptBlockPath(w, h, r, sides) {
  sides = sides || { top: null, right: null, bottom: null, left: null };
  const cx = w / 2, cy = h / 2;
  const tabHalf = 10, tabOut = 8, tabTip = 3;
  const slotHalf = 10, slotDepth = 8, slotTip = 3;
  let d = `M ${r} 0`;
  // Top edge, left to right. Each side is a tab (stub out), a slot
  // (socket in), or a plain straight edge.
  if (sides.top === 'tab' || sides.top === 'stub') d += ` L ${cx - tabHalf} 0 L ${cx - tabHalf} ${-tabOut + tabTip} Q ${cx - tabHalf} ${-tabOut} ${cx - tabHalf + tabTip} ${-tabOut} L ${cx + tabHalf - tabTip} ${-tabOut} Q ${cx + tabHalf} ${-tabOut} ${cx + tabHalf} ${-tabOut + tabTip} L ${cx + tabHalf} 0`;
  else if (sides.top === 'slot') d += ` L ${cx - slotHalf} 0 L ${cx - slotHalf} ${slotDepth - slotTip} Q ${cx - slotHalf} ${slotDepth} ${cx - slotHalf + slotTip} ${slotDepth} L ${cx + slotHalf - slotTip} ${slotDepth} Q ${cx + slotHalf} ${slotDepth} ${cx + slotHalf} ${slotDepth - slotTip} L ${cx + slotHalf} 0`;
  d += ` L ${w - r} 0 Q ${w} 0 ${w} ${r}`;
  // Right edge, top to bottom.
  if (sides.right === 'tab' || sides.right === 'stub') d += ` L ${w} ${cy - tabHalf} L ${w + tabOut - tabTip} ${cy - tabHalf} Q ${w + tabOut} ${cy - tabHalf} ${w + tabOut} ${cy - tabHalf + tabTip} L ${w + tabOut} ${cy + tabHalf - tabTip} Q ${w + tabOut} ${cy + tabHalf} ${w + tabOut - tabTip} ${cy + tabHalf} L ${w} ${cy + tabHalf}`;
  else if (sides.right === 'slot') d += ` L ${w} ${cy - slotHalf} L ${w - slotDepth + slotTip} ${cy - slotHalf} Q ${w - slotDepth} ${cy - slotHalf} ${w - slotDepth} ${cy - slotHalf + slotTip} L ${w - slotDepth} ${cy + slotHalf - slotTip} Q ${w - slotDepth} ${cy + slotHalf} ${w - slotDepth + slotTip} ${cy + slotHalf} L ${w} ${cy + slotHalf}`;
  d += ` L ${w} ${h - r} Q ${w} ${h} ${w - r} ${h}`;
  // Bottom edge, right to left.
  if (sides.bottom === 'tab' || sides.bottom === 'stub') d += ` L ${cx + tabHalf} ${h} L ${cx + tabHalf} ${h + tabOut - tabTip} Q ${cx + tabHalf} ${h + tabOut} ${cx + tabHalf - tabTip} ${h + tabOut} L ${cx - tabHalf + tabTip} ${h + tabOut} Q ${cx - tabHalf} ${h + tabOut} ${cx - tabHalf} ${h + tabOut - tabTip} L ${cx - tabHalf} ${h}`;
  else if (sides.bottom === 'slot') d += ` L ${cx + slotHalf} ${h} L ${cx + slotHalf} ${h - slotDepth + slotTip} Q ${cx + slotHalf} ${h - slotDepth} ${cx + slotHalf - slotTip} ${h - slotDepth} L ${cx - slotHalf + slotTip} ${h - slotDepth} Q ${cx - slotHalf} ${h - slotDepth} ${cx - slotHalf} ${h - slotDepth + slotTip} L ${cx - slotHalf} ${h}`;
  d += ` L ${r} ${h} Q 0 ${h} 0 ${h - r}`;
  // Left edge, bottom to top.
  if (sides.left === 'tab' || sides.left === 'stub') d += ` L 0 ${cy + tabHalf} L ${-tabOut + tabTip} ${cy + tabHalf} Q ${-tabOut} ${cy + tabHalf} ${-tabOut} ${cy + tabHalf - tabTip} L ${-tabOut} ${cy - tabHalf + tabTip} Q ${-tabOut} ${cy - tabHalf} ${-tabOut + tabTip} ${cy - tabHalf} L 0 ${cy - tabHalf}`;
  else if (sides.left === 'slot') d += ` L 0 ${cy + slotHalf} L ${slotDepth - slotTip} ${cy + slotHalf} Q ${slotDepth} ${cy + slotHalf} ${slotDepth} ${cy + slotHalf - slotTip} L ${slotDepth} ${cy - slotHalf + slotTip} Q ${slotDepth} ${cy - slotHalf} ${slotDepth - slotTip} ${cy - slotHalf} L 0 ${cy - slotHalf}`;
  d += ` L 0 ${r} Q 0 0 ${r} 0 Z`;
  return d;
}

// Outline for a concept block: a slot's walls are traced (a seated tab is
// framed by the socket's own outline), a tab's base gets a gap (no line
// through a tab), plain sides are a straight edge. No closing Z: after an
// M jump it would draw a diagonal across the block.
function conceptOutlinePath(w, h, r, sides) {
  sides = sides || { top: null, right: null, bottom: null, left: null };
  const cx = w / 2, cy = h / 2;
  const tabHalf = 10, tabOut = 8, tabTip = 3, slotHalf = 10, slotDepth = 8, slotTip = 3;
  let o = `M ${r} 0`;
  // Top edge.
  if (sides.top === 'slot') o += ` L ${cx - slotHalf} 0 L ${cx - slotHalf} ${slotDepth - slotTip} Q ${cx - slotHalf} ${slotDepth} ${cx - slotHalf + slotTip} ${slotDepth} L ${cx + slotHalf - slotTip} ${slotDepth} Q ${cx + slotHalf} ${slotDepth} ${cx + slotHalf} ${slotDepth - slotTip} L ${cx + slotHalf} 0`;
  else if (sides.top === 'tab') o += ` L ${cx - tabHalf} 0 M ${cx + tabHalf} 0`;
  else if (sides.top === 'stub') o += ` L ${cx - tabHalf} 0 L ${cx - tabHalf} ${-tabOut + tabTip} Q ${cx - tabHalf} ${-tabOut} ${cx - tabHalf + tabTip} ${-tabOut} L ${cx + tabHalf - tabTip} ${-tabOut} Q ${cx + tabHalf} ${-tabOut} ${cx + tabHalf} ${-tabOut + tabTip} L ${cx + tabHalf} 0`;
  o += ` L ${w - r} 0 Q ${w} 0 ${w} ${r}`;
  // Right edge.
  if (sides.right === 'slot') o += ` L ${w} ${cy - slotHalf} L ${w - slotDepth + slotTip} ${cy - slotHalf} Q ${w - slotDepth} ${cy - slotHalf} ${w - slotDepth} ${cy - slotHalf + slotTip} L ${w - slotDepth} ${cy + slotHalf - slotTip} Q ${w - slotDepth} ${cy + slotHalf} ${w - slotDepth + slotTip} ${cy + slotHalf} L ${w} ${cy + slotHalf}`;
  else if (sides.right === 'tab') o += ` L ${w} ${cy - tabHalf} M ${w} ${cy + tabHalf}`;
  else if (sides.right === 'stub') o += ` L ${w} ${cy - tabHalf} L ${w + tabOut - tabTip} ${cy - tabHalf} Q ${w + tabOut} ${cy - tabHalf} ${w + tabOut} ${cy - tabHalf + tabTip} L ${w + tabOut} ${cy + tabHalf - tabTip} Q ${w + tabOut} ${cy + tabHalf} ${w + tabOut - tabTip} ${cy + tabHalf} L ${w} ${cy + tabHalf}`;
  o += ` L ${w} ${h - r} Q ${w} ${h} ${w - r} ${h}`;
  // Bottom edge.
  if (sides.bottom === 'slot') o += ` L ${cx + slotHalf} ${h} L ${cx + slotHalf} ${h - slotDepth + slotTip} Q ${cx + slotHalf} ${h - slotDepth} ${cx + slotHalf - slotTip} ${h - slotDepth} L ${cx - slotHalf + slotTip} ${h - slotDepth} Q ${cx - slotHalf} ${h - slotDepth} ${cx - slotHalf} ${h - slotDepth + slotTip} L ${cx - slotHalf} ${h}`;
  else if (sides.bottom === 'tab') o += ` L ${cx + tabHalf} ${h} M ${cx - tabHalf} ${h}`;
  else if (sides.bottom === 'stub') o += ` L ${cx + tabHalf} ${h} L ${cx + tabHalf} ${h + tabOut - tabTip} Q ${cx + tabHalf} ${h + tabOut} ${cx + tabHalf - tabTip} ${h + tabOut} L ${cx - tabHalf + tabTip} ${h + tabOut} Q ${cx - tabHalf} ${h + tabOut} ${cx - tabHalf} ${h + tabOut - tabTip} L ${cx - tabHalf} ${h}`;
  o += ` L ${r} ${h} Q 0 ${h} 0 ${h - r}`;
  // Left edge.
  if (sides.left === 'slot') o += ` L 0 ${cy + slotHalf} L ${slotDepth - slotTip} ${cy + slotHalf} Q ${slotDepth} ${cy + slotHalf} ${slotDepth} ${cy + slotHalf - slotTip} L ${slotDepth} ${cy - slotHalf + slotTip} Q ${slotDepth} ${cy - slotHalf} ${slotDepth - slotTip} ${cy - slotHalf} L 0 ${cy - slotHalf}`;
  else if (sides.left === 'tab') o += ` L 0 ${cy + tabHalf} M 0 ${cy - tabHalf}`;
  else if (sides.left === 'stub') o += ` L 0 ${cy + tabHalf} L ${-tabOut + tabTip} ${cy + tabHalf} Q ${-tabOut} ${cy + tabHalf} ${-tabOut} ${cy + tabHalf - tabTip} L ${-tabOut} ${cy - tabHalf + tabTip} Q ${-tabOut} ${cy - tabHalf} ${-tabOut + tabTip} ${cy - tabHalf} L 0 ${cy - tabHalf}`;
  o += ` L 0 ${r} Q 0 0 ${r} 0`;
  return o;
}

// ===== CONCEPT ICONS (Nov 5, 2026) =====
// Every block is identified by a unique icon instead of a text label.
// Icons are drawn in a 24x24 box centered on the block (16..40), in the
// same near-white as the old labels. Bold shapes only (stroke 2 or more).
// SYMMETRY IS THE RULE: every icon is centered on x=28 and y=28 unless
// it is inherently directional (arrows, play triangle, a T, a cursor).
// Verify symmetry by the numbers, not by eye: mirrored parts must be
// equal distances from 28, and any centered span must start and end at
// 28 minus/plus the same amount.
//
// Lookup order (conceptIconForBlock): a blockType map first (specific),
// then family builders (pattern-matched variants), then the label map
// (legacy generic classes), then the text label as a last resort.
const CONCEPT_ICON_WHITE = 'rgba(255,255,255,0.96)';
const W = CONCEPT_ICON_WHITE;

// Centered text glyph (a single letter, symbol, or short word inside a
// pictogram, e.g. a keycap letter or an operator). y is the baseline.
function icText(txt, x, y, size) {
  return `<text x="${x}" y="${y}" text-anchor="middle" font-size="${size}" font-weight="800" fill="${W}">${txt}</text>`;
}

// Bold arrow in a direction. Symmetric about the axis it points along.
function icArrow(dir) {
  if (dir === 'right') return `<polygon points="18,26 32,26 32,21 40,28 32,35 32,30 18,30" fill="${W}"/>`;
  if (dir === 'left') return `<polygon points="38,26 24,26 24,21 16,28 24,35 24,30 38,30" fill="${W}"/>`;
  if (dir === 'up') return `<polygon points="26,38 26,24 21,24 28,16 35,24 30,24 30,38" fill="${W}"/>`;
  return `<polygon points="26,18 26,32 21,32 28,40 35,32 30,32 30,18" fill="${W}"/>`; // down
}
// Small triangle (state badge, direction marker). Centered on 28.
function icTri(dir) {
  if (dir === 'down') return `<polygon points="24,35 32,35 28,40" fill="${W}"/>`;
  if (dir === 'up') return `<polygon points="24,21 32,21 28,16" fill="${W}"/>`;
  if (dir === 'right') return `<polygon points="35,24 35,32 40,28" fill="${W}"/>`;
  return `<polygon points="21,24 21,32 16,28" fill="${W}"/>`; // left
}

// --- Pictograms. Each is a single coherent shape in the 24x24 box. ---
function picPlay() { return `<polygon points="25,19 25,37 39,28" fill="${W}"/>`; }
function picPause() { return `<rect x="23" y="20" width="4" height="16" fill="${W}"/><rect x="29" y="20" width="4" height="16" fill="${W}"/>`; }
function picStop() { return `<rect x="21" y="21" width="14" height="14" rx="2" fill="${W}"/>`; }
function picClock() { return `<circle cx="28" cy="28" r="9" fill="none" stroke="${W}" stroke-width="2.5"/><path d="M 28 28 L 28 21 M 28 28 L 33 28" fill="none" stroke="${W}" stroke-width="2.5" stroke-linecap="round"/>`; }
function picCube() { return `<path d="M 28 19 L 36 23.5 L 36 32.5 L 28 37 L 20 32.5 L 20 23.5 Z" fill="none" stroke="${W}" stroke-width="2" stroke-linejoin="round"/><path d="M 28 28 L 28 19 M 28 28 L 36 32.5 M 28 28 L 20 32.5" fill="none" stroke="${W}" stroke-width="2" stroke-linecap="round"/>`; }
function picCamera() { return `<rect x="17" y="23" width="22" height="13" rx="3" fill="none" stroke="${W}" stroke-width="2"/><circle cx="28" cy="29.5" r="4.5" fill="none" stroke="${W}" stroke-width="2"/><circle cx="28" cy="29.5" r="1.5" fill="${W}"/><rect x="24" y="20" width="8" height="3" rx="1" fill="${W}"/>`; }
function picEye() { return `<path d="M 18 28 Q 28 20 38 28 Q 28 36 18 28 Z" fill="none" stroke="${W}" stroke-width="2.5"/><circle cx="28" cy="28" r="3" fill="${W}"/>`; }
function picTarget() { return `<circle cx="28" cy="28" r="9" fill="none" stroke="${W}" stroke-width="2.5"/><circle cx="28" cy="28" r="5" fill="none" stroke="${W}" stroke-width="2"/><circle cx="28" cy="28" r="2" fill="${W}"/>`; }
function picDice() { return `<rect x="20" y="20" width="16" height="16" rx="3" fill="none" stroke="${W}" stroke-width="2"/><circle cx="24" cy="24" r="1.6" fill="${W}"/><circle cx="32" cy="24" r="1.6" fill="${W}"/><circle cx="28" cy="28" r="1.6" fill="${W}"/><circle cx="24" cy="32" r="1.6" fill="${W}"/><circle cx="32" cy="32" r="1.6" fill="${W}"/>`; }
function picRuler() { return `<rect x="16" y="24" width="24" height="8" rx="1" fill="none" stroke="${W}" stroke-width="2"/><path d="M 20 24 L 20 28 M 24 24 L 24 28 M 28 24 L 28 28 M 32 24 L 32 28 M 36 24 L 36 28" stroke="${W}" stroke-width="2"/>`; }
function picCrosshair() { return `<circle cx="28" cy="28" r="8" fill="none" stroke="${W}" stroke-width="2"/><path d="M 28 16 L 28 20 M 28 36 L 28 40 M 16 28 L 20 28 M 36 28 L 40 28" stroke="${W}" stroke-width="2"/>`; }
function picCursor() { return `<path d="M 23 18 L 23 36 L 27.5 31.5 L 30 38 L 33 36.5 L 30.5 30 L 36 30 Z" fill="${W}"/>`; }
function picGamepad() { return `<rect x="16" y="23" width="24" height="12" rx="6" fill="none" stroke="${W}" stroke-width="2"/><rect x="20" y="28" width="4" height="2" fill="${W}"/><rect x="21" y="27" width="2" height="4" fill="${W}"/><circle cx="31" cy="27" r="1.5" fill="${W}"/><circle cx="34" cy="30" r="1.5" fill="${W}"/>`; }
function picLaser() { return `<rect x="16" y="25" width="5" height="6" rx="1" fill="${W}"/><path d="M 22 28 L 33 28" stroke="${W}" stroke-width="2.5"/><circle cx="37" cy="28" r="2.5" fill="${W}"/>`; }
function picOverlap() { return `<circle cx="24" cy="28" r="6" fill="none" stroke="${W}" stroke-width="2"/><circle cx="32" cy="28" r="6" fill="none" stroke="${W}" stroke-width="2"/>`; }
function picProtractor() { return `<path d="M 18 32 A 10 10 0 0 1 38 32" fill="none" stroke="${W}" stroke-width="2"/><path d="M 18 32 L 38 32 M 28 32 L 35 25" stroke="${W}" stroke-width="2" stroke-linecap="round"/>`; }
function picHeart() { return `<path d="M 28 36 C 20 30 18 24 22 21 C 25 19 28 21 28 24 C 28 21 31 19 34 21 C 38 24 36 30 28 36 Z" fill="${W}"/>`; }
function picStar() { return `<polygon points="28,19 30.5,25.5 37,25.5 32,29.5 34,36 28,32 22,36 24,29.5 19,25.5 25.5,25.5" fill="${W}"/>`; }
function picBullet() { return `<path d="M 28 18 L 32 22 L 32 30 L 34 30 L 34 35 L 22 35 L 22 30 L 24 30 L 24 22 Z" fill="${W}"/>`; }
function picCoin() { return `<circle cx="28" cy="28" r="9" fill="none" stroke="${W}" stroke-width="2.5"/><circle cx="28" cy="28" r="4.5" fill="none" stroke="${W}" stroke-width="2"/>`; }
function picKey() { return `<circle cx="22" cy="28" r="4.5" fill="none" stroke="${W}" stroke-width="2.5"/><path d="M 26.5 28 L 38 28 M 33 28 L 33 32 M 37 28 L 37 31" fill="none" stroke="${W}" stroke-width="2.5" stroke-linecap="round"/>`; }
function picWave() { return `<path d="M 18 25 Q 23 21 28 25 T 38 25 M 18 31 Q 23 27 28 31 T 38 31" fill="none" stroke="${W}" stroke-width="2" stroke-linecap="round"/>`; }
function picPerson() { return `<circle cx="28" cy="23" r="3.5" fill="${W}"/><path d="M 20 36 Q 20 29 28 29 Q 36 29 36 36 Z" fill="${W}"/>`; }
function picBolt() { return `<polygon points="31,18 22,29 27,29 24,38 34,26 29,26" fill="${W}"/>`; }
function picScroll() { return `<rect x="21" y="20" width="14" height="16" rx="2" fill="none" stroke="${W}" stroke-width="2"/><path d="M 25 25 L 31 25 M 25 29 L 31 29 M 25 33 L 31 33" stroke="${W}" stroke-width="2" stroke-linecap="round"/>`; }
function picCrown() { return `<polygon points="20,32 20,24 24,28 28,21 32,28 36,24 36,32" fill="${W}"/>`; }
function picMoon() { return `<path d="M 33 20 A 9 9 0 1 0 33 36" fill="none" stroke="${W}" stroke-width="4" stroke-linecap="round"/>`; }
function picCloud() { return `<circle cx="23" cy="30" r="4" fill="${W}"/><circle cx="28" cy="26" r="5" fill="${W}"/><circle cx="33" cy="30" r="4" fill="${W}"/><rect x="19" y="30" width="18" height="4" fill="${W}"/>`; }
function picSnow() { return `<path d="M 19 28 L 37 28 M 23.5 20.2 L 32.5 35.8 M 32.5 20.2 L 23.5 35.8" stroke="${W}" stroke-width="2" stroke-linecap="round"/>`; }
function picWeight() { return `<circle cx="28" cy="30" r="6" fill="${W}"/><path d="M 23 26 A 5 5 0 0 1 33 26" fill="none" stroke="${W}" stroke-width="2.5"/>`; }
function picCar() { return `<rect x="18" y="27" width="20" height="6" rx="2" fill="${W}"/><rect x="23" y="23" width="10" height="5" rx="2" fill="${W}"/><circle cx="23" cy="34" r="2.5" fill="${W}"/><circle cx="33" cy="34" r="2.5" fill="${W}"/>`; }
function picBulletUp() { return `<polygon points="28,18 33,26 33,36 23,36 23,26" fill="${W}"/>`; }
function picDroplet() { return `<path d="M 28 18 C 28 18 20 26 20 30 A 8 8 0 0 0 36 30 C 36 26 28 18 28 18 Z" fill="${W}"/>`; }
function picCode() { return `<path d="M 25 21 L 19 28 L 25 35 M 31 21 L 37 28 L 31 35" fill="none" stroke="${W}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`; }
function picSwap() { return `<path d="M 19 24 L 33 24 M 30 21 L 33 24 L 30 27 M 37 32 L 23 32 M 26 29 L 23 32 L 26 35" fill="none" stroke="${W}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`; }
function picFilm() { return `<rect x="18" y="20" width="20" height="16" rx="2" fill="none" stroke="${W}" stroke-width="2"/><rect x="20" y="23" width="2" height="2" fill="${W}"/><rect x="20" y="27" width="2" height="2" fill="${W}"/><rect x="20" y="31" width="2" height="2" fill="${W}"/><rect x="34" y="23" width="2" height="2" fill="${W}"/><rect x="34" y="27" width="2" height="2" fill="${W}"/><rect x="34" y="31" width="2" height="2" fill="${W}"/>`; }
function picCurve() { return `<path d="M 18 36 Q 28 18 38 22" fill="none" stroke="${W}" stroke-width="2.5" stroke-linecap="round"/><circle cx="28" cy="23.5" r="2.5" fill="${W}"/><circle cx="18" cy="36" r="2" fill="${W}"/><circle cx="38" cy="22" r="2" fill="${W}"/>`; }
function picBurst() { return `<path d="M 33 28 L 39 28 M 31.5 24.5 L 35.8 20.2 M 28 23 L 28 17 M 24.5 24.5 L 20.2 20.2 M 23 28 L 17 28 M 24.5 31.5 L 20.2 35.8 M 28 33 L 28 39 M 31.5 31.5 L 35.8 35.8" stroke="${W}" stroke-width="2" stroke-linecap="round"/><circle cx="28" cy="28" r="2.5" fill="${W}"/>`; }
function picLayers() { return `<path d="M 20 24 L 28 20 L 36 24 M 20 29 L 28 25 L 36 29 M 20 34 L 28 30 L 36 34" fill="none" stroke="${W}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`; }
function picGrid() { return `<rect x="20" y="20" width="16" height="16" rx="1" fill="none" stroke="${W}" stroke-width="2"/><path d="M 28 20 L 28 36 M 20 28 L 36 28" stroke="${W}" stroke-width="2"/>`; }
function picSun() { return `<circle cx="28" cy="28" r="5" fill="${W}"/><path d="M 36 28 L 40 28 M 33.7 22.3 L 36.5 19.5 M 28 20 L 28 16 M 22.3 22.3 L 19.5 19.5 M 20 28 L 16 28 M 22.3 33.7 L 19.5 36.5 M 28 36 L 28 40 M 33.7 33.7 L 36.5 36.5" stroke="${W}" stroke-width="2" stroke-linecap="round"/>`; }
function picTrash() { return `<rect x="19" y="21" width="18" height="2.5" rx="1" fill="${W}"/><rect x="25" y="18" width="6" height="2" rx="1" fill="${W}"/><path d="M 22 25 L 34 25 L 33 37 L 23 37 Z" fill="${W}"/>`; }
function picLink() { return `<rect x="17" y="24" width="11" height="8" rx="4" fill="none" stroke="${W}" stroke-width="2"/><rect x="28" y="24" width="11" height="8" rx="4" fill="none" stroke="${W}" stroke-width="2"/>`; }
// P4 Advanced batch 37 (attach): two interlocked rings on the diagonal,
// a chain link. Centers (23.5, 23.5) and (32.5, 32.5) mirror through
// (28, 28), so the pair is symmetric by a half turn about the center.
function picChain() { return `<circle cx="23.5" cy="23.5" r="5" fill="none" stroke="${W}" stroke-width="2.5"/><circle cx="32.5" cy="32.5" r="5" fill="none" stroke="${W}" stroke-width="2.5"/>`; }
// Two separated rings with a slash through the gap: a broken link
// (detach). Rings at 28 +/- 6, the slash runs (25, 22) to (31, 34)
// through the center, so the whole mark mirrors through (28, 28).
function picUnlink() { return `<circle cx="22" cy="28" r="4.5" fill="none" stroke="${W}" stroke-width="2.5"/><circle cx="34" cy="28" r="4.5" fill="none" stroke="${W}" stroke-width="2.5"/><path d="M 25 22 L 31 34" stroke="${W}" stroke-width="2.5" stroke-linecap="round"/>`; }
// A ring with a double-headed shift arrow below: move the attachment to
// a new offset. Ring centered on x=28, arrow shaft 20..36 at y=35.
function picOffsetLink() { return `<circle cx="28" cy="24" r="5" fill="none" stroke="${W}" stroke-width="2.5"/><path d="M 20 35 L 36 35" stroke="${W}" stroke-width="2" stroke-linecap="round"/><polygon points="20,35 25,32 25,38" fill="${W}"/><polygon points="36,35 31,32 31,38" fill="${W}"/>`; }
// P4 Advanced batches 34-36 (tags / pick-by-tag / minimap): a price-tag
// label, point left, hole ring right. The point (19, 28) and the hole
// (33, 28) both sit on the center line, so the mark reads the same
// turned half a turn about the block center (28, 28).
function picTag() { return `<path d="M 23 22 L 37 22 L 37 34 L 23 34 L 19 28 Z" fill="none" stroke="${W}" stroke-width="2" stroke-linejoin="round"/><circle cx="33" cy="28" r="2" fill="none" stroke="${W}" stroke-width="2"/>`; }
// The tag with a slash through it: clear every tag. The slash runs
// (21, 21) to (35, 35), through the center, so it maps to itself
// under a half turn about (28, 28).
function picTagSlash() { return picTag() + `<path d="M 21 21 L 35 35" stroke="${W}" stroke-width="2.5" stroke-linecap="round"/>`; }
// A level frame with the camera view inside it and two dots for
// objects: the minimap. Frame (18, 20)-(38, 36) and view
// (24, 24)-(32, 32) are both centered on (28, 28), and the dots
// (22, 32) and (34, 24) swap under a half turn, so the whole mark
// is symmetric about the block center.
function picMap() { return `<rect x="18" y="20" width="20" height="16" fill="none" stroke="${W}" stroke-width="2"/><rect x="24" y="24" width="8" height="8" fill="none" stroke="${W}" stroke-width="2"/><circle cx="22" cy="32" r="1.5" fill="${W}"/><circle cx="34" cy="24" r="1.5" fill="${W}"/>`; }
function picSearch() { return `<circle cx="25" cy="25" r="6" fill="none" stroke="${W}" stroke-width="2.5"/><path d="M 29.5 29.5 L 36 36" stroke="${W}" stroke-width="2.5" stroke-linecap="round"/>`; }
function picSort() { return `<path d="M 22 26 L 28 20 L 34 26 M 22 30 L 28 36 L 34 30" fill="none" stroke="${W}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`; }
function picShuffle() { return `<path d="M 19 32 L 37 24 M 33 24 L 37 24 L 37 28 M 19 24 L 37 32 M 33 32 L 37 32 L 37 28" fill="none" stroke="${W}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`; }
function picSigma() { return `<path d="M 34 21 L 22 21 L 22 35 L 34 35 M 22 28 L 30 28" fill="none" stroke="${W}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`; }
function picPencil() { return `<polygon points="23,33 25,27 33,19 37,23 29,31" fill="${W}"/><polygon points="23,33 20,37 27,35" fill="${W}"/>`; }
function picList() { return `<path d="M 19 23 L 37 23 M 19 28 L 37 28 M 19 33 L 37 33" stroke="${W}" stroke-width="2.5" stroke-linecap="round"/>`; }
function picBox() { return `<rect x="20" y="20" width="16" height="16" rx="2" fill="none" stroke="${W}" stroke-width="2.5"/>`; }
function picRecord() { return `<rect x="19" y="21" width="18" height="14" rx="2" fill="none" stroke="${W}" stroke-width="2"/><path d="M 23 26 L 33 26 M 23 30 L 33 30" stroke="${W}" stroke-width="2" stroke-linecap="round"/>`; }
function picGauge() { return `<path d="M 19 32 A 9 9 0 0 1 37 32" fill="none" stroke="${W}" stroke-width="2.5" stroke-linecap="round"/><path d="M 28 32 L 28 24" stroke="${W}" stroke-width="2.5" stroke-linecap="round"/><circle cx="28" cy="32" r="2" fill="${W}"/>`; }
function picSpring() { return `<path d="M 18 28 L 22 22 L 26 34 L 30 22 L 34 34 L 38 28" fill="none" stroke="${W}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`; }
function picLock() { return `<rect x="21" y="26" width="14" height="10" rx="2" fill="${W}"/><path d="M 24 26 L 24 23 A 4 4 0 0 1 32 23 L 32 26" fill="none" stroke="${W}" stroke-width="2.5"/>`; }
function picGhost() { return `<path d="M 20 36 L 20 26 A 8 8 0 0 1 36 26 L 36 36 L 32 32 L 28 36 L 24 32 Z" fill="${W}"/>`; }
function picSpeaker() { return `<polygon points="18,25 23,25 29,19 29,37 23,31 18,31" fill="${W}"/><path d="M 32 24 Q 37 28 32 32 M 35 21 Q 41 28 35 35" fill="none" stroke="${W}" stroke-width="2" stroke-linecap="round"/>`; }
function picNote() { return `<ellipse cx="24" cy="33" rx="4" ry="3" fill="${W}" transform="rotate(-20 24 33)"/><rect x="27" y="19" width="2.5" height="14" fill="${W}"/><polygon points="29.5,19 36,23 33,28 29.5,24" fill="${W}"/>`; }
function picDisk() { return `<path d="M 20 20 L 32 20 L 36 24 L 36 36 L 20 36 Z" fill="none" stroke="${W}" stroke-width="2" stroke-linejoin="round"/><rect x="24" y="20" width="8" height="6" fill="none" stroke="${W}" stroke-width="2"/><rect x="24" y="28" width="8" height="5" fill="${W}"/>`; }
function picDoor() { return `<rect x="22" y="19" width="12" height="18" rx="1" fill="none" stroke="${W}" stroke-width="2"/><circle cx="31" cy="29" r="1.5" fill="${W}"/>`; }
function picCheck() { return `<path d="M 20 29 L 26 35 L 37 22" fill="none" stroke="${W}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`; }
function picX() { return `<path d="M 22 22 L 34 34 M 34 22 L 22 34" stroke="${W}" stroke-width="3" stroke-linecap="round"/>`; }
function picPlus() { return `<path d="M 28 20 L 28 36 M 20 28 L 36 28" stroke="${W}" stroke-width="3" stroke-linecap="round"/>`; }
function picMinus() { return `<path d="M 20 28 L 36 28" stroke="${W}" stroke-width="3" stroke-linecap="round"/>`; }
function picFlag() { return `<path d="M 21 37 L 21 19" stroke="${W}" stroke-width="2.5" stroke-linecap="round"/><polygon points="21,19 37,23 21,27" fill="${W}"/>`; }
function picScene() { return `<rect x="18" y="21" width="20" height="14" rx="2" fill="none" stroke="${W}" stroke-width="2"/><path d="M 18 29 L 25 24 L 30 28 L 34 25 L 38 29" fill="none" stroke="${W}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`; }
function picMouse() { return `<rect x="22" y="19" width="12" height="18" rx="6" fill="none" stroke="${W}" stroke-width="2"/><path d="M 28 19 L 28 27" stroke="${W}" stroke-width="2"/>`; }
function picKeycap(sym) { return `<rect x="18" y="20" width="20" height="16" rx="3" fill="none" stroke="${W}" stroke-width="2"/>` + sym; }
function picTap() { return `<circle cx="28" cy="28" r="3" fill="${W}"/><circle cx="28" cy="28" r="8" fill="none" stroke="${W}" stroke-width="2"/><circle cx="28" cy="28" r="12" fill="none" stroke="${W}" stroke-width="1.5"/>`; }
function picLoopCW() { return `<path d="M 36 28 A 8 8 0 1 1 28 20" fill="none" stroke="${W}" stroke-width="2.5" stroke-linecap="round"/><polygon points="26,16 26,24 34,20" fill="${W}"/>`; }
function picLoopCCW() { return `<path d="M 36 28 A 8 8 0 1 0 28 36" fill="none" stroke="${W}" stroke-width="2.5" stroke-linecap="round"/><polygon points="24,32 24,40 31,36" fill="${W}"/>`; }
function picRewind() { return `<polygon points="20,28 28,20 28,36" fill="${W}"/><polygon points="28,28 36,20 36,36" fill="${W}"/>`; }
function picScale(base) { return `<g transform="translate(25,26) scale(0.8) translate(-28,-28)">${base}</g>`; }

// --- Label map (the seven collector icons). Fallback for legacy generic
// classes whose blockType carries no specific meaning.
const CONCEPT_ICONS = {
  // On Game Start: play triangle.
  'on game start': `<polygon points="25,19 25,37 39,28" fill="${CONCEPT_ICON_WHITE}"/>`,
  'game start': `<polygon points="25,19 25,37 39,28" fill="${CONCEPT_ICON_WHITE}"/>`,
  // Set Variable: a box with an equals sign (assign a value into it).
  'set variable': `<rect x="20" y="20" width="16" height="16" rx="2" fill="none" stroke="${CONCEPT_ICON_WHITE}" stroke-width="2"/><path d="M 24.5 26 L 31.5 26 M 24.5 30 L 31.5 30" stroke="${CONCEPT_ICON_WHITE}" stroke-width="2" stroke-linecap="round"/>`,
  // Always: a loop arrow, true every frame, forever.
  'always': `<path d="M 36 28 A 8 8 0 1 1 28 20" fill="none" stroke="${CONCEPT_ICON_WHITE}" stroke-width="2.5" stroke-linecap="round"/><polygon points="26,16 26,24 34,20" fill="${CONCEPT_ICON_WHITE}"/>`,
  // Clamp: a value held between two bounds, [ value ].
  'clamp': `<path d="M 22 22 L 18 22 L 18 34 L 22 34" fill="none" stroke="${CONCEPT_ICON_WHITE}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M 34 22 L 38 22 L 38 34 L 34 34" fill="none" stroke="${CONCEPT_ICON_WHITE}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><rect x="25" y="25" width="6" height="6" rx="1" fill="${CONCEPT_ICON_WHITE}"/>`,
  // Set Text: bold T, the text-tool mark.
  'set text': `<path d="M 20 21 L 36 21 L 36 24 L 29.5 24 L 29.5 36 L 26.5 36 L 26.5 24 L 20 24 Z" fill="${CONCEPT_ICON_WHITE}"/>`,
  // Keyboard: a row of keys over a wide spacebar. Keys span 19-37 and
  // the spacebar 22-34, both centered on 28 (symmetry is the rule).
  'keyboard': `<rect x="16" y="21" width="24" height="14" rx="2" fill="none" stroke="${CONCEPT_ICON_WHITE}" stroke-width="2"/><rect x="19" y="24" width="3" height="3" fill="${CONCEPT_ICON_WHITE}"/><rect x="24" y="24" width="3" height="3" fill="${CONCEPT_ICON_WHITE}"/><rect x="29" y="24" width="3" height="3" fill="${CONCEPT_ICON_WHITE}"/><rect x="34" y="24" width="3" height="3" fill="${CONCEPT_ICON_WHITE}"/><rect x="22" y="29" width="12" height="3" rx="1" fill="${CONCEPT_ICON_WHITE}"/>`,
  'key pressed': `<rect x="16" y="21" width="24" height="14" rx="2" fill="none" stroke="${CONCEPT_ICON_WHITE}" stroke-width="2"/><rect x="19" y="24" width="3" height="3" fill="${CONCEPT_ICON_WHITE}"/><rect x="24" y="24" width="3" height="3" fill="${CONCEPT_ICON_WHITE}"/><rect x="29" y="24" width="3" height="3" fill="${CONCEPT_ICON_WHITE}"/><rect x="34" y="24" width="3" height="3" fill="${CONCEPT_ICON_WHITE}"/><rect x="22" y="29" width="12" height="3" rx="1" fill="${CONCEPT_ICON_WHITE}"/>`,
  // Apply Force: a push arrow.
  'apply force': `<polygon points="18,26 32,26 32,21 40,28 32,35 32,30 18,30" fill="${CONCEPT_ICON_WHITE}"/>`,
};
function conceptIconForLabel(label) {
  const key = String(label == null ? '' : label).trim().toLowerCase();
  return CONCEPT_ICONS[key] || null;
}

// --- Family builders (pattern-matched variants). Each returns an SVG
// fragment or null when the blockType is not in that family. ---

// Keys: key-<name>-<held|pressed|released>. A keycap with the key's
// symbol, plus a small state arrow below (down = pressed, up = released,
// none = held). The keycap sits at y 18-34 so the whole icon stays
// centered on 28 with the state arrow at 35-38.
const KEY_SYMBOLS = {
  keyw: 'W', keya: 'A', keys: 'S', keyd: 'D', keye: 'E', keyq: 'Q', keyr: 'R', keyf: 'F',
  digit1: '1', digit2: '2', digit3: '3',
  arrowup: 'up', arrowleft: 'left', arrowdown: 'down', arrowright: 'right',
  space: 'space', shiftleft: 'shift', controlleft: 'ctrl', enter: 'enter', escape: 'esc', tab: 'tab'
};
function conceptKeyIcon(blockType) {
  const m = /^key-([a-z0-9]+)-(held|pressed|released)$/.exec(blockType);
  if (!m) return null;
  const sym = KEY_SYMBOLS[m[1]];
  if (!sym) return null;
  const state = m[2];
  let inner = '';
  if (sym === 'up') inner = `<polygon points="28,20 22,29 34,29" fill="${W}"/>`;
  else if (sym === 'down') inner = `<polygon points="28,32 22,23 34,23" fill="${W}"/>`;
  else if (sym === 'left') inner = `<polygon points="22,26 31,20 31,32" fill="${W}"/>`;
  else if (sym === 'right') inner = `<polygon points="34,26 25,20 25,32" fill="${W}"/>`;
  else if (sym === 'space') inner = `<rect x="22" y="24" width="12" height="3" rx="1" fill="${W}"/>`;
  else if (sym === 'shift') inner = `<polygon points="28,20 22,29 34,29" fill="${W}"/>`;
  else if (sym === 'enter') inner = `<path d="M 25 21 L 25 28 L 32 28 M 29 25 L 32 28 L 29 31" fill="none" stroke="${W}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
  else if (sym === 'ctrl') inner = icText('Ctrl', 28, 29.5, 6.5);
  else if (sym === 'esc') inner = icText('Esc', 28, 29.5, 6.5);
  else if (sym === 'tab') inner = icText('Tab', 28, 29.5, 7);
  else inner = icText(sym, 28, 29.5, 10);
  let s = `<rect x="18" y="18" width="20" height="16" rx="3" fill="none" stroke="${W}" stroke-width="2"/>` + inner;
  if (state === 'pressed') s += `<polygon points="24,35 32,35 28,38" fill="${W}"/>`;
  else if (state === 'released') s += `<polygon points="24,38 32,38 28,35" fill="${W}"/>`;
  return s;
}

// Mouse: mouse-<held|pressed|released>-<left|middle|right|any>. A mouse
// body with the button marked by a dot, same state arrow as keys.
function conceptMouseIcon(blockType) {
  const m = /^mouse-(held|pressed|released)-(left|middle|right|any)$/.exec(blockType);
  if (!m) return null;
  const state = m[1], btn = m[2];
  let s = `<rect x="22" y="18" width="12" height="16" rx="6" fill="none" stroke="${W}" stroke-width="2"/>` +
    `<path d="M 28 18 L 28 26" stroke="${W}" stroke-width="2"/>`;
  if (btn === 'left') s += `<circle cx="25" cy="22" r="2" fill="${W}"/>`;
  else if (btn === 'right') s += `<circle cx="31" cy="22" r="2" fill="${W}"/>`;
  else if (btn === 'middle') s += `<circle cx="28" cy="22" r="2" fill="${W}"/>`;
  else s += `<circle cx="25" cy="22" r="2" fill="${W}"/><circle cx="31" cy="22" r="2" fill="${W}"/>`;
  if (state === 'pressed') s += `<polygon points="24,35 32,35 28,38" fill="${W}"/>`;
  else if (state === 'released') s += `<polygon points="24,38 32,38 28,35" fill="${W}"/>`;
  return s;
}

// Vars: var-<name>-<at-least|set|add|subtract>. The variable's pictogram,
// scaled down and shifted up-left, plus the operator glyph bottom-right.
const VAR_PICTOS = {
  score: () => picStar(), health: () => picHeart(), ammo: () => picBullet(),
  coins: () => picCoin(), keys: () => picKey(), wave: () => picWave(),
  lives: () => picPerson(), energy: () => picBolt(), quest: () => picScroll(),
  timer: () => picClock(), doorsopen: () => picDoor(), bosshealth: () => picCrown()
};
const VAR_OPS = { 'at-least': '≥', 'set': '=', 'add': '+', 'subtract': '−' };
function conceptVarIcon(blockType) {
  const m = /^var-([a-z]+)-(at-least|set|add|subtract)$/.exec(blockType);
  if (!m) return null;
  const pic = VAR_PICTOS[m[1]];
  const op = VAR_OPS[m[2]];
  if (!pic || op === undefined) return null;
  return picScale(pic()) + icText(op, 37, 38, 10);
}

// Colors: color-<name>. A paint droplet; the block's own color says which.
function conceptColorIcon(blockType) {
  if (/^color-(red|orange|yellow|green|cyan|blue|purple|pink|white|black)$/.test(blockType)) return picDroplet();
  return null;
}

// Opacities: opacity-<0|0-25|0-5|0-75|1>. A square filled to that level.
function conceptOpacityIcon(blockType) {
  const m = /^opacity-(0|0-25|0-5|0-75|1)$/.exec(blockType);
  if (!m) return null;
  const v = { '0': 0, '0-25': 0.25, '0-5': 0.5, '0-75': 0.75, '1': 1 }[m[1]];
  const h = Math.round(16 * v);
  const inner = h > 0 ? `<rect x="20" y="${36 - h}" width="16" height="${h}" rx="1" fill="${W}"/>` : '';
  return `<rect x="20" y="20" width="16" height="16" rx="2" fill="none" stroke="${W}" stroke-width="2"/>` + inner;
}

// Physics presets: preset-<move|jump|dash|fall|stop>-... and
// physics-<preset>-<gravity|friction|max-speed>. A preset pictogram plus
// the property mark.
const PRESET_PICTOS = {
  platformer: () => icArrow('up'),
  floaty: () => picCloud(),
  'top-down': () => `<rect x="20" y="20" width="16" height="16" rx="2" fill="none" stroke="${W}" stroke-width="2"/><circle cx="28" cy="28" r="2.5" fill="${W}"/>`,
  ice: () => picSnow(),
  heavy: () => picWeight(),
  'low-gravity': () => picMoon(),
  bullet: () => picBulletUp(),
  vehicle: () => picCar()
};
function conceptPresetIcon(blockType) {
  let m = /^preset-(move-left|move-right|move-up|move-down|jump-small|jump-high|dash-left|dash-right|fall-fast|stop-x|stop-y|stop-all)$/.exec(blockType);
  if (m) {
    const k = m[1];
    if (k === 'move-left') return `<rect x="33" y="25" width="6" height="6" rx="1" fill="${W}"/><polygon points="32,26 22,26 22,21 16,28 22,35 22,30 32,30" fill="${W}"/>`;
    if (k === 'move-right') return `<rect x="17" y="25" width="6" height="6" rx="1" fill="${W}"/><polygon points="24,26 34,26 34,21 40,28 34,35 34,30 24,30" fill="${W}"/>`;
    if (k === 'move-up') return `<rect x="25" y="33" width="6" height="6" rx="1" fill="${W}"/><polygon points="26,32 26,22 21,22 28,16 35,22 30,22 30,32" fill="${W}"/>`;
    if (k === 'move-down') return `<rect x="25" y="17" width="6" height="6" rx="1" fill="${W}"/><polygon points="26,24 26,34 21,34 28,40 35,34 30,34 30,24" fill="${W}"/>`;
    if (k === 'jump-small') return `<path d="M 18 37 L 38 37" stroke="${W}" stroke-width="2.5" stroke-linecap="round"/><polygon points="26,33 26,28 21,28 28,22 35,28 30,28 30,33" fill="${W}"/>`;
    if (k === 'jump-high') return `<path d="M 18 37 L 38 37" stroke="${W}" stroke-width="2.5" stroke-linecap="round"/><polygon points="26,33 26,24 21,24 28,18 35,24 30,24 30,33" fill="${W}"/>`;
    if (k === 'dash-left') return `<polygon points="38,26 24,26 24,21 16,28 24,35 24,30 38,30" fill="${W}"/><path d="M 30 21 L 38 21 M 30 35 L 38 35" stroke="${W}" stroke-width="2" stroke-linecap="round"/>`;
    if (k === 'dash-right') return `<polygon points="18,26 32,26 32,21 40,28 32,35 32,30 18,30" fill="${W}"/><path d="M 18 21 L 26 21 M 18 35 L 26 35" stroke="${W}" stroke-width="2" stroke-linecap="round"/>`;
    if (k === 'fall-fast') return `<polygon points="26,18 26,32 21,32 28,40 35,32 30,32 30,18" fill="${W}"/><path d="M 19 20 L 19 30 M 37 20 L 37 30" stroke="${W}" stroke-width="2" stroke-linecap="round"/>`;
    if (k === 'stop-x') return `<rect x="25" y="25" width="6" height="6" rx="1" fill="${W}"/><path d="M 19 28 L 22 28 M 34 28 L 37 28 M 22 28 L 19 25 M 22 28 L 19 31 M 34 28 L 37 25 M 34 28 L 37 31" fill="none" stroke="${W}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    if (k === 'stop-y') return `<rect x="25" y="25" width="6" height="6" rx="1" fill="${W}"/><path d="M 28 19 L 28 22 M 28 34 L 28 37 M 28 22 L 25 19 M 28 22 L 31 19 M 28 34 L 25 37 M 28 34 L 31 37" fill="none" stroke="${W}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    return picStop(); // stop-all
  }
  m = /^physics-([a-z-]+)-(gravity|friction|max-speed)$/.exec(blockType);
  if (!m) return null;
  const pic = PRESET_PICTOS[m[1]];
  if (!pic) return null;
  const prop = m[2];
  let mark = '';
  if (prop === 'gravity') mark = `<polygon points="37,32 33,32 35,38" fill="${W}"/>`;
  else if (prop === 'friction') mark = `<path d="M 32 34 L 40 34 M 32 38 L 40 38" stroke="${W}" stroke-width="2" stroke-linecap="round"/>`;
  else mark = `<path d="M 33 38 A 5 5 0 0 1 39 32" fill="none" stroke="${W}" stroke-width="2" stroke-linecap="round"/>`;
  return picScale(pic()) + mark;
}

// Small modifiers, drawn at the bottom-right (around 33-40, 33-40) next
// to a scaled-down main pictogram. Used for "X + modifier" icons.
const SM = {
  play: `<polygon points="33,32 33,38 39,35" fill="${W}"/>`,
  stop: `<rect x="33" y="32" width="6" height="6" rx="1" fill="${W}"/>`,
  check: `<path d="M 32 35 L 35 38 L 40 32" fill="none" stroke="${W}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  x: `<path d="M 33 33 L 39 39 M 39 33 L 33 39" stroke="${W}" stroke-width="2.5" stroke-linecap="round"/>`,
  plus: `<path d="M 36 32 L 36 40 M 32 36 L 40 36" stroke="${W}" stroke-width="2.5" stroke-linecap="round"/>`,
  minus: `<path d="M 32 36 L 40 36" stroke="${W}" stroke-width="2.5" stroke-linecap="round"/>`,
  drop: `<path d="M 36 31 C 36 31 32 35 32 37 A 4 4 0 0 0 40 37 C 40 35 36 31 36 31 Z" fill="${W}"/>`,
  eye: `<path d="M 32 36 Q 36 33 40 36 Q 36 39 32 36 Z" fill="none" stroke="${W}" stroke-width="1.5"/><circle cx="36" cy="36" r="1.2" fill="${W}"/>`,
  target: `<circle cx="36" cy="36" r="4" fill="none" stroke="${W}" stroke-width="2"/><circle cx="36" cy="36" r="1.5" fill="${W}"/>`,
  triR: `<polygon points="33,33 33,39 39,36" fill="${W}"/>`,
  triL: `<polygon points="39,33 39,39 33,36" fill="${W}"/>`,
  triU: `<polygon points="33,39 39,39 36,33" fill="${W}"/>`,
  triD: `<polygon points="33,33 39,33 36,39" fill="${W}"/>`,
  grid: `<rect x="33" y="33" width="7" height="7" rx="1" fill="none" stroke="${W}" stroke-width="1.5"/><path d="M 36.5 33 L 36.5 40 M 33 36.5 L 40 36.5" stroke="${W}" stroke-width="1.5"/>`,
  box: `<rect x="33" y="33" width="7" height="7" rx="1" fill="none" stroke="${W}" stroke-width="2"/>`,
  key: `<circle cx="34" cy="36" r="2.5" fill="none" stroke="${W}" stroke-width="1.5"/><path d="M 36.5 36 L 40 36 M 38 36 L 38 38" stroke="${W}" stroke-width="1.5" stroke-linecap="round"/>`,
  star: `<polygon points="36,32 37,35 40,36 37,37 36,40 35,37 32,36 35,35" fill="${W}"/>`,
  pencil: `<polygon points="34,38 35,34 39,30 40,31 36,35" fill="${W}"/>`,
  lens: `<circle cx="36" cy="36" r="3.5" fill="none" stroke="${W}" stroke-width="2"/><circle cx="36" cy="36" r="1.2" fill="${W}"/>`,
  person: `<circle cx="36" cy="33.5" r="1.8" fill="${W}"/><path d="M 32.5 39 Q 32.5 36 36 36 Q 39.5 36 39.5 39 Z" fill="${W}"/>`,
  gauge: `<path d="M 32 38 A 4.5 4.5 0 0 1 40 38" fill="none" stroke="${W}" stroke-width="2" stroke-linecap="round"/>`,
  sun: `<circle cx="36" cy="36" r="2.5" fill="${W}"/><path d="M 36 30.5 L 36 32 M 36 40 L 36 41.5 M 30.5 36 L 32 36 M 40 36 L 41.5 36" stroke="${W}" stroke-width="1.5" stroke-linecap="round"/>`,
  cross: `<circle cx="36" cy="36" r="3.5" fill="none" stroke="${W}" stroke-width="1.5"/><path d="M 36 31.5 L 36 33 M 36 39 L 36 40.5 M 31.5 36 L 33 36 M 39 36 L 40.5 36" stroke="${W}" stroke-width="1.5"/>`,
  loop: `<path d="M 39 36 A 3.5 3.5 0 1 1 36 32.5" fill="none" stroke="${W}" stroke-width="2" stroke-linecap="round"/><polygon points="35,30.5 35,34 38,32" fill="${W}"/>`,
  tag: `<polygon points="34,33 40,33 40,39 34,39 32,36" fill="${W}"/>`,
  q: icText('?', 37, 38, 9),
  eq: icText('=', 37, 38, 10),
  hash: icText('#', 37, 38, 10),
  braces: icText('{ }', 37, 38, 8),
  n: icText('N', 37, 38, 10),
  f: icText('F', 37, 38, 10)
};
// Main pictogram scaled down (0.8, centered 25,26) plus a small modifier.
function mod(pic, small) { return picScale(pic) + small; }

// --- BlockType map (explicit one-offs). Keyed by the cell's blockType,
// which is specific; the label map is only a fallback. ---
const CONCEPT_ICONS_BY_TYPE = {
  // Comment: a speech bubble with lines (a note).
  'comment-block': `<rect x="19" y="21" width="18" height="11" rx="3" fill="none" stroke="${W}" stroke-width="2"/><polygon points="24,32 24,37 29,32" fill="${W}"/><path d="M 23 25 L 33 25 M 23 29 L 29 29" stroke="${W}" stroke-width="2" stroke-linecap="round"/>`,
  // Conditions.
  'always-condition': picLoopCW(),
  'trigger-once-condition': `<circle cx="28" cy="28" r="9" fill="none" stroke="${W}" stroke-width="2.5"/>` + icText('1', 28, 32, 11),
  'distance-condition': picRuler(),
  'position-condition': picCrosshair(),
  'object-count-condition': `<rect x="19" y="24" width="5" height="5" fill="${W}"/><rect x="25.5" y="24" width="5" height="5" fill="${W}"/><rect x="32" y="24" width="5" height="5" fill="${W}"/><path d="M 19 33 L 37 33" stroke="${W}" stroke-width="2" stroke-linecap="round"/>`,
  'chance-condition': picDice(),
  'mouse-over-object-condition': picCursor(),
  'velocity-condition': icArrow('right') + `<path d="M 18 21 L 26 21 M 18 35 L 26 35" stroke="${W}" stroke-width="2" stroke-linecap="round"/>`,
  'visible-condition': picEye(),
  'object-clicked-condition': `<rect x="20" y="22" width="16" height="16" rx="2" fill="none" stroke="${W}" stroke-width="2"/><circle cx="28" cy="30" r="2.5" fill="${W}"/><circle cx="28" cy="30" r="5" fill="none" stroke="${W}" stroke-width="2"/>`,
  'action-input-condition': picGamepad(),
  'cursor-position': picCrosshair(),
  'mouse-pointer-captured': picLock(),
  'any-key-pressed': picKeycap(icText('?', 28, 29.5, 11)),
  'touch-active': picTap(),
  'touch-count': `<circle cx="23" cy="28" r="2.5" fill="${W}"/><circle cx="23" cy="28" r="5" fill="none" stroke="${W}" stroke-width="2"/><circle cx="33" cy="28" r="2.5" fill="${W}"/><circle cx="33" cy="28" r="5" fill="none" stroke="${W}" stroke-width="2"/>`,
  'gamepad-connected': picGamepad(),
  'gamepad-button': `<rect x="16" y="23" width="24" height="12" rx="6" fill="none" stroke="${W}" stroke-width="2"/><rect x="20" y="28" width="4" height="2" fill="${W}"/><rect x="21" y="27" width="2" height="4" fill="${W}"/><circle cx="32" cy="28" r="3.5" fill="${W}"/>`,
  'gamepad-stick': `<rect x="16" y="23" width="24" height="12" rx="6" fill="none" stroke="${W}" stroke-width="2"/><path d="M 22 33 L 22 27" stroke="${W}" stroke-width="2.5" stroke-linecap="round"/><circle cx="22" cy="25" r="3" fill="${W}"/><circle cx="31" cy="27" r="1.5" fill="${W}"/><circle cx="34" cy="30" r="1.5" fill="${W}"/>`,
  'trigger-enter-condition': `<rect x="20" y="19" width="11" height="18" rx="1" fill="none" stroke="${W}" stroke-width="2"/><circle cx="28" cy="29" r="1.5" fill="${W}"/><polygon points="38,26 32,26 32,22 28,28 32,34 32,30 38,30" fill="${W}"/>`,
  'trigger-exit-condition': `<rect x="25" y="19" width="11" height="18" rx="1" fill="none" stroke="${W}" stroke-width="2"/><circle cx="27" cy="29" r="1.5" fill="${W}"/><polygon points="18,26 24,26 24,22 28,28 24,34 24,30 18,30" fill="${W}"/>`,
  'raycast-hit-condition': picLaser(),
  'overlap-check-condition': picOverlap(),
  'angle-between-condition': picProtractor(),
  'line-of-sight-condition': `<path d="M 16 28 Q 22 22 28 28 Q 22 34 16 28 Z" fill="none" stroke="${W}" stroke-width="2"/><circle cx="22" cy="28" r="2" fill="${W}"/><path d="M 29 28 L 36 28" stroke="${W}" stroke-width="2"/><circle cx="38" cy="28" r="2" fill="${W}"/>`,
  'nearest-distance-condition': picTarget(),
  'moving-towards-condition': `<path d="M 18 28 L 26 28 M 23 25 L 26 28 L 23 31" fill="none" stroke="${W}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="33" cy="28" r="5" fill="none" stroke="${W}" stroke-width="2"/><circle cx="33" cy="28" r="1.5" fill="${W}"/>`,
  'save-slot-exists-condition': mod(picDisk(), SM.q),
  'game-paused-condition': picPause(),
  'profiler-visible-condition': mod(picEye(), `<rect x="33" y="35" width="2" height="3" fill="${W}"/><rect x="36" y="33" width="2" height="5" fill="${W}"/><rect x="39" y="31" width="2" height="7" fill="${W}"/>`),
  'timer-elapsed-condition': picClock(),
  'script-check': mod(picCode(), SM.q),
  'layer-check-condition': mod(picLayers(), SM.q),
  'distance-3d-condition': picCube() + `<path d="M 20 39 L 36 39 M 20 36.5 L 20 39 M 36 36.5 L 36 39" stroke="${W}" stroke-width="2" stroke-linecap="round"/>`,
  'on-ground-3d': picCube() + `<path d="M 18 38 L 38 38" stroke="${W}" stroke-width="2.5" stroke-linecap="round"/>`,
  'collision-3d': mod(picCube(), SM.star),
  'text-check': mod(`<path d="M 20 21 L 36 21 L 36 24 L 29.5 24 L 29.5 36 L 26.5 36 L 26.5 24 L 20 24 Z" fill="${W}"/>`, SM.q),
  'pick-nearest-condition': mod(picTarget(), SM.n),
  'pick-farthest-condition': mod(picTarget(), SM.f),
  'pick-random-condition': mod(picDice(), SM.target),
  'camera-position': mod(picCamera(), SM.cross),
  'array-length-condition': picList() + `<path d="M 19 37 L 37 37" stroke="${W}" stroke-width="2" stroke-linecap="round"/>`,
  'array-contains-condition': mod(picList(), `<circle cx="36" cy="36" r="3.5" fill="none" stroke="${W}" stroke-width="2"/><path d="M 38.5 38.5 L 41 41" stroke="${W}" stroke-width="2" stroke-linecap="round"/>`),
  'struct-has-field-condition': mod(picRecord(), SM.q),
  'number-in-range-condition': `<path d="M 22 22 L 18 22 L 18 34 L 22 34" fill="none" stroke="${W}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M 34 22 L 38 22 L 38 34 L 34 34" fill="none" stroke="${W}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><rect x="25" y="25" width="6" height="6" rx="1" fill="${W}"/>`,
  'darkness-level-condition': mod(picMoon(), SM.q),
  // Legacy conditions (picker).
  'mouse-condition': picCursor(),
  'advanced-condition': picOverlap(),
  'overlap-condition': picOverlap(),
  'get-variable': picBox() + icText('?', 28, 32, 11),
  'and-condition': icText('&', 28, 33, 14),
  'timer-condition': picClock(),
  'edge-condition': `<rect x="20" y="20" width="16" height="16" rx="2" fill="none" stroke="${W}" stroke-width="2"/><path d="M 20 20 L 36 20 M 20 36 L 36 36" stroke="${W}" stroke-width="2"/>`,
  'anim-state-condition': mod(picFilm(), SM.q),
  'animation-finished-condition': mod(picFilm(), SM.check),
  'blend-active-condition': mod(picFilm(), SM.drop),
  'tween-finished-condition': mod(picCurve(), SM.check),
  // Timer actions.
  'timer-control': picClock(),
  'read-timer-action': mod(picClock(), SM.eye),
  'timer-reset-spawn': mod(picClock(), SM.loop),
  'timer-pause-spawn': mod(picClock(), `<rect x="33" y="32" width="2.5" height="6" fill="${W}"/><rect x="36.5" y="32" width="2.5" height="6" fill="${W}"/>`),
  // Input actions.
  'remap-action': picSwap(),
  'reset-action-bindings': picLoopCCW(),
  'capture-mouse': picMouse() + `<polygon points="24,35 32,35 28,38" fill="${W}"/>`,
  'release-mouse': picMouse() + `<polygon points="24,38 32,38 28,35" fill="${W}"/>`,
  'read-mouse-delta': picMouse() + `<path d="M 18 37 L 24 37 M 32 37 L 38 37 M 24 37 L 21 34 M 24 37 L 21 40 M 32 37 L 35 34 M 32 37 L 35 40" fill="none" stroke="${W}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  'run-script': picCode(),
  // Audio.
  'set-bus-volume': picSpeaker(),
  'set-bus-muted': `<polygon points="18,25 23,25 29,19 29,37 23,31 18,31" fill="${W}"/><path d="M 32 24 L 38 30 M 38 24 L 32 30" stroke="${W}" stroke-width="2.5" stroke-linecap="round"/>`,
  'stop-music': mod(picNote(), SM.stop),
  'pause-music': mod(picNote(), `<rect x="33" y="32" width="2.5" height="6" fill="${W}"/><rect x="36.5" y="32" width="2.5" height="6" fill="${W}"/>`),
  'resume-music': mod(picNote(), SM.play),
  'stop-all-sounds': picSpeaker() + `<path d="M 20 20 L 38 38" stroke="${W}" stroke-width="3" stroke-linecap="round"/>`,
  'set-master-volume': mod(picSpeaker(), `<path d="M 37 22 L 37 34" stroke="${W}" stroke-width="2" stroke-linecap="round"/><circle cx="37" cy="26" r="2.5" fill="${W}"/>`),
  'music-playing': picNote(),
  // Tile.
  'set-tile': mod(picGrid(), SM.pencil),
  'tile-solid-at-condition': mod(picGrid(), SM.check),
  'standing-on-tile-condition': picGrid() + `<path d="M 18 38 L 38 38" stroke="${W}" stroke-width="2.5" stroke-linecap="round"/>`,
  'on-floor-condition': `<path d="M 18 38 L 38 38" stroke="${W}" stroke-width="2.5" stroke-linecap="round"/><rect x="24" y="24" width="8" height="8" rx="1" fill="${W}"/>`,
  // Physics 2D.
  'force-toward-position': `<circle cx="34" cy="28" r="5" fill="none" stroke="${W}" stroke-width="2"/><circle cx="34" cy="28" r="1.5" fill="${W}"/><path d="M 18 28 L 26 28 M 23 25 L 26 28 L 23 31" fill="none" stroke="${W}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  'move-toward-position': `<rect x="17" y="25" width="6" height="6" rx="1" fill="${W}"/><path d="M 25 28 L 33 28 M 30 25 L 33 28 L 30 31" fill="none" stroke="${W}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="37" cy="28" r="2" fill="${W}"/>`,
  'move-toward-object': `<rect x="17" y="25" width="6" height="6" rx="1" fill="${W}"/><path d="M 25 28 L 31 28 M 28 25 L 31 28 L 28 31" fill="none" stroke="${W}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="35" cy="28" r="4" fill="none" stroke="${W}" stroke-width="2"/><circle cx="35" cy="28" r="1.5" fill="${W}"/>`,
  'impulse-away-object': `<circle cx="21" cy="28" r="5" fill="none" stroke="${W}" stroke-width="2"/><circle cx="21" cy="28" r="1.5" fill="${W}"/><path d="M 28 28 L 36 28 M 33 25 L 36 28 L 33 31" fill="none" stroke="${W}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  'stop-object': picStop(),
  'separate-objects': `<circle cx="22" cy="28" r="5" fill="${W}"/><circle cx="34" cy="28" r="5" fill="${W}"/><path d="M 16 28 L 18 28 M 38 28 L 40 28" stroke="${W}" stroke-width="2" stroke-linecap="round"/>`,
  'set-collision-layer-action': mod(picLayers(), SM.eq),
  'face-movement': `<circle cx="23" cy="28" r="5" fill="none" stroke="${W}" stroke-width="2"/><path d="M 29 28 L 36 28 M 33 25 L 36 28 L 33 31" fill="none" stroke="${W}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  'set-position': mod(picCrosshair(), SM.eq),
  'spawn-at-object': picBurst() + `<rect x="24" y="24" width="8" height="8" rx="1" fill="none" stroke="${W}" stroke-width="2"/>`,
  'clamp-to-screen': `<rect x="18" y="20" width="20" height="16" rx="2" fill="none" stroke="${W}" stroke-width="2"/><rect x="24" y="24" width="8" height="8" rx="1" fill="${W}"/>`,
  'wrap-screen': `<rect x="22" y="22" width="12" height="12" rx="2" fill="none" stroke="${W}" stroke-width="2"/><path d="M 34 28 L 40 28 M 37 25 L 40 28 L 37 31" fill="none" stroke="${W}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M 22 28 L 16 28 M 19 25 L 16 28 L 19 31" fill="none" stroke="${W}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  'destroy-outside-screen': picGhost(),
  'set-gravity': `<circle cx="28" cy="21" r="4" fill="${W}"/><polygon points="26,27 26,33 21,33 28,39 35,33 30,33 30,27" fill="${W}"/>`,
  'set-max-speed': picGauge(),
  'set-bounciness': picSpring(),
  'set-physics-enabled': picBolt(),
  'set-static': picLock(),
  'set-friction': `<path d="M 20 24 L 32 24 M 29 21 L 32 24 L 29 27" fill="none" stroke="${W}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M 36 32 L 24 32 M 27 29 L 24 32 L 27 35" fill="none" stroke="${W}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  // Scene.
  'restart-scene': picLoopCCW(),
  'next-scene': mod(picScene(), SM.triR),
  'previous-scene': mod(picScene(), SM.triL),
  'push-scene': mod(picScene(), SM.plus),
  'pop-scene': mod(picScene(), SM.minus),
  'set-scene-background': mod(picScene(), SM.drop),
  'switch-scene': mod(picScene(), `<path d="M 33 34 L 39 34 M 37 32 L 39 34 L 37 36 M 39 38 L 33 38 M 35 36 L 33 38 L 35 40" fill="none" stroke="${W}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`),
  'set-camera': mod(picCamera(), SM.eq),
  'follow-camera': mod(picCamera(), SM.triR),
  // Save / load.
  'save-variable': mod(picDisk(), SM.triD),
  'load-variable': mod(picDisk(), SM.triU),
  'save-game': mod(picDisk(), SM.triD),
  'load-game': mod(picDisk(), SM.triU),
  'delete-save': mod(picDisk(), SM.x),
  'save-score': mod(picDisk(), SM.star),
  'load-score': mod(picDisk(), SM.star),
  // Game state.
  'pause-game': picPause(),
  'resume-game': picPlay(),
  'toggle-pause': `<rect x="20" y="22" width="3" height="12" fill="${W}"/><rect x="24" y="22" width="3" height="12" fill="${W}"/><polygon points="31,22 31,34 38,28" fill="${W}"/>`,
  'show-profiler': mod(picEye(), SM.plus),
  'hide-profiler': mod(picEye(), SM.minus),
  'toggle-profiler': mod(picEye(), `<path d="M 33 34 L 39 34 M 37 32 L 39 34 L 37 36 M 39 38 L 33 38 M 35 36 L 33 38 L 35 40" fill="none" stroke="${W}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`),
  // Particles.
  'emit-burst': picBurst(),
  'start-emitter': mod(picBurst(), SM.play),
  'stop-emitter': mod(picBurst(), SM.stop),
  'clear-particles': mod(picBurst(), SM.x),
  // Appearance.
  'set-color': picDroplet(),
  'set-opacity': `<rect x="20" y="20" width="16" height="16" rx="2" fill="none" stroke="${W}" stroke-width="2"/><rect x="20" y="28" width="16" height="8" rx="1" fill="${W}"/>`,
  'set-layer': mod(picLayers(), SM.eq),
  'flip-object': `<rect x="21" y="22" width="14" height="12" rx="2" fill="none" stroke="${W}" stroke-width="2"/><path d="M 28 19 L 28 37" stroke="${W}" stroke-width="2" stroke-dasharray="3 2"/>`,
  'set-scale': `<rect x="20" y="20" width="16" height="16" rx="2" fill="none" stroke="${W}" stroke-width="2"/><path d="M 36 36 L 40 40 M 37 40 L 40 40 L 40 37" fill="none" stroke="${W}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  'bring-to-front': mod(picLayers(), SM.triU),
  'send-to-back': mod(picLayers(), SM.triD),
  'move-layer-up': mod(picLayers(), SM.triU),
  'move-layer-down': mod(picLayers(), SM.triD),
  // 3D.
  'move-3d': mod(picCube(), SM.triR),
  'set-3d-position': mod(picCube(), SM.cross),
  'set-3d-rotation': mod(picCube(), SM.loop),
  'rotate-3d': mod(picCube(), SM.loop),
  'set-model-tint': mod(picCube(), SM.drop),
  'use-model-texture': mod(picCube(), SM.grid),
  'set-3d-camera': mod(picCube(), SM.lens),
  'follow-3d-camera': mod(picCube(), SM.triR),
  'stop-3d-camera-follow': mod(picCube(), SM.stop),
  'aim-3d-camera': mod(picCube(), SM.target),
  'move-3d-facing': mod(picCube(), SM.triU),
  'set-3d-gravity': mod(picCube(), SM.triD),
  'set-3d-velocity': mod(picCube(), SM.gauge),
  'set-3d-light': mod(picCube(), SM.sun),
  'set-blend-mode': mod(picLayers(), SM.drop),
  'set-shadow': `<circle cx="28" cy="26" r="7" fill="${W}"/><ellipse cx="28" cy="36" rx="10" ry="2.5" fill="${W}"/>`,
  'set-visual-effect': mod(picBurst(), SM.eye),
  'clear-effects': mod(picBurst(), SM.x),
  // Text.
  'set-text-size': `<path d="M 20 21 L 36 21 L 36 24 L 29.5 24 L 29.5 36 L 26.5 36 L 26.5 24 L 20 24 Z" fill="${W}"/>` + `<path d="M 18 37 L 24 37 M 32 37 L 38 37 M 24 37 L 21 34 M 24 37 L 21 40 M 32 37 L 35 34 M 32 37 L 35 40" fill="none" stroke="${W}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  'set-text-color': `<path d="M 20 21 L 36 21 L 36 24 L 29.5 24 L 29.5 36 L 26.5 36 L 26.5 24 L 20 24 Z" fill="${W}"/>` + SM.drop,
  'set-text-style': icText('B', 24, 33, 13) + icText('I', 33, 33, 13),
  'set-text-alignment': `<path d="M 19 23 L 31 23 M 23 28 L 33 28 M 25 33 L 37 33" stroke="${W}" stroke-width="2.5" stroke-linecap="round"/>`,
  'append-text': `<path d="M 20 21 L 36 21 L 36 24 L 29.5 24 L 29.5 36 L 26.5 36 L 26.5 24 L 20 24 Z" fill="${W}"/>` + SM.plus,
  // Point toward.
  'point-toward-object': `<circle cx="28" cy="28" r="9" fill="none" stroke="${W}" stroke-width="2.5"/><circle cx="28" cy="28" r="5" fill="none" stroke="${W}" stroke-width="2"/><circle cx="28" cy="28" r="2" fill="${W}"/>` + `<polygon points="28,16 24,22 32,22" fill="${W}"/>`,
  'point-toward-position': mod(picTarget(), SM.cross),
  // Camera.
  'screen-shake': mod(picCamera(), `<path d="M 20 38 L 24 34 L 28 38 L 32 34 L 36 38" fill="none" stroke="${W}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`),
  'move-camera': mod(picCamera(), SM.triR),
  'center-camera-on': mod(picCamera(), SM.cross),
  'follow-object': mod(picCamera(), SM.person),
  'stop-camera-follow': mod(picCamera(), SM.stop),
  'reset-camera': mod(picCamera(), SM.loop),
  'set-camera-zoom': mod(picCamera(), `<circle cx="36" cy="36" r="3.5" fill="none" stroke="${W}" stroke-width="2"/><path d="M 38.5 38.5 L 41 41" stroke="${W}" stroke-width="2" stroke-linecap="round"/>`),
  'camera-follow-player': mod(picCamera(), SM.person),
  'camera-origin': mod(picCamera(), SM.target),
  'shake-small': mod(picCamera(), `<path d="M 30 38 L 33 35 L 36 38 L 39 35" fill="none" stroke="${W}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`),
  'shake-big': mod(picCamera(), `<path d="M 28 39 L 31 34 L 34 39 L 37 34 L 40 39" fill="none" stroke="${W}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`),
  // Array.
  'array-push': picList() + `<polygon points="24,35 32,35 28,38" fill="${W}"/>`,
  'array-pop': picList() + `<polygon points="24,38 32,38 28,35" fill="${W}"/>`,
  'array-set-item': mod(picList(), SM.pencil),
  'array-get-item': mod(picList(), SM.triR),
  'array-insert': mod(picList(), SM.plus),
  'array-remove-at': mod(picList(), SM.minus),
  'array-remove-value': mod(picList(), SM.x),
  'array-clear': mod(picList(), `<rect x="33" y="32" width="7" height="7" rx="1" fill="none" stroke="${W}" stroke-width="1.5"/><path d="M 33 32 L 40 32" stroke="${W}" stroke-width="1.5" stroke-linecap="round"/>`),
  'array-sort': picSort(),
  'array-shuffle': picShuffle(),
  'array-join': picLink(),
  'array-math': picSigma(),
  // Struct.
  'struct-set-field': mod(picRecord(), SM.pencil),
  'struct-get-field': mod(picRecord(), SM.triR),
  'struct-remove-field': mod(picRecord(), SM.x),
  'struct-clear': mod(picRecord(), `<rect x="33" y="32" width="7" height="7" rx="1" fill="none" stroke="${W}" stroke-width="1.5"/><path d="M 33 32 L 40 32" stroke="${W}" stroke-width="1.5" stroke-linecap="round"/>`),
  'struct-keys': mod(picRecord(), SM.key),
  'var-to-json': mod(picRecord(), SM.braces),
  'var-from-json': mod(picRecord(), SM.braces),
  // Numbers.
  'random-integer': mod(picDice(), SM.hash),
  'clamp-number': `<path d="M 22 22 L 18 22 L 18 34 L 22 34" fill="none" stroke="${W}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M 34 22 L 38 22 L 38 34 L 34 34" fill="none" stroke="${W}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><rect x="25" y="25" width="6" height="6" rx="1" fill="${W}"/>`,
  'round-number': `<circle cx="28" cy="28" r="9" fill="none" stroke="${W}" stroke-width="2.5"/>` + icText('~', 28, 32, 12),
  'random-pick': mod(picDice(), SM.target),
  // Light / dark.
  'set-darkness': picMoon(),
  'set-light-2d': picSun(),
  // Legacy actions (picker).
  'advanced-action': mod(picBolt(), SM.triR),
  'set-size': `<rect x="20" y="20" width="16" height="16" rx="2" fill="none" stroke="${W}" stroke-width="2"/><path d="M 36 36 L 40 40 M 37 40 L 40 40 L 40 37" fill="none" stroke="${W}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  'destroy-object': picTrash(),
  'show-hide': mod(picEye(), SM.x),
  'play-sound': mod(picSpeaker(), SM.play),
  'set-velocity': mod(picGauge(), SM.eq),
  'spawn-object': picBurst(),
  'rotate-object': picLoopCW(),
  'random-variable': mod(picDice(), SM.box),
  'force-toward': `<circle cx="34" cy="28" r="5" fill="none" stroke="${W}" stroke-width="2"/><circle cx="34" cy="28" r="1.5" fill="${W}"/><path d="M 18 28 L 26 28 M 23 25 L 26 28 L 23 31" fill="none" stroke="${W}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  'play-animation': mod(picFilm(), SM.play),
  'set-animation': mod(picFilm(), SM.eq),
  'stop-animation': mod(picFilm(), SM.stop),
  'set-anim-state': mod(picFilm(), SM.box),
  'set-blend': mod(picLayers(), SM.drop),
  'stop-blend': mod(picDroplet(), SM.stop),
  'tween-property': picCurve(),
  'stop-tween': mod(picCurve(), SM.stop),
  // Generic family marks.
  'set-text': `<path d="M 20 21 L 36 21 L 36 24 L 29.5 24 L 29.5 36 L 26.5 36 L 26.5 24 L 20 24 Z" fill="${W}"/>`,
  // Attach (P4 Advanced batch 37): the four attach blocks each carry a
  // unique icon, so they never fall back to a text label on the grid
  // (a text label overflows the 56px cell and clips at the grid edge).
  // The condition reuses the chain with the standard question badge.
  'attach-object-to-object': picChain(),
  'detach-object': picUnlink(),
  'set-attachment-offset': picOffsetLink(),
  'set-attachment-follow': mod(picChain(), SM.loop),
  'is-attached': mod(picChain(), SM.q),
  // Tags / pick-by-tag / minimap (P4 Advanced batches 34-36): the 16
  // blocks from the tag, pick-by-tag and minimap batches each carry a
  // unique icon, so they never fall back to a text label on the grid
  // (a text label overflows the 56px cell and clips at the grid edge).
  // The tag mark carries a badge for the operation, the map mark the
  // same, and the random pick reuses the dice with a tag badge.
  'add-tag': mod(picTag(), SM.plus),
  'remove-tag': mod(picTag(), SM.x),
  'clear-tags': picTagSlash(),
  'read-tagged-count': mod(picTag(), SM.hash),
  'has-tag': mod(picTag(), SM.q),
  'tagged-count': mod(picTag(), SM.eq),
  'pick-nearest-tagged': mod(picTag(), SM.n),
  'pick-farthest-tagged': mod(picTag(), SM.f),
  'pick-random-tagged': mod(picDice(), SM.tag),
  'pick-tagged-object-into-variable': mod(picTag(), SM.box),
  'for-each-tagged': mod(picTag(), SM.loop),
  'show-minimap': mod(picMap(), SM.plus),
  'hide-minimap': mod(picMap(), SM.minus),
  'set-minimap-size': mod(picMap(), SM.box),
  'set-minimap-zoom': mod(picMap(), SM.lens),
  'minimap-visible': mod(picMap(), SM.q),
};

// --- Dispatch. BlockType first (specific), then family builders, then
// the label map (legacy generic classes), then text.
function conceptIconForBlock(blockType, label) {
  if (blockType && CONCEPT_ICONS_BY_TYPE[blockType]) return CONCEPT_ICONS_BY_TYPE[blockType];
  let icon = null;
  if (blockType) {
    icon = conceptKeyIcon(blockType) || conceptMouseIcon(blockType) ||
      conceptVarIcon(blockType) || conceptColorIcon(blockType) ||
      conceptOpacityIcon(blockType) || conceptPresetIcon(blockType);
  }
  if (icon) return icon;
  return conceptIconForLabel(label);
}
// ===== END CONCEPT ICONS =====

function conceptBlockSVG(blockType, color, label, sides, iconAngleDeg) {
  // Directional chaining (Nov 5): the shape comes entirely from `sides`,
  // one tab (stub), slot (socket), or plain edge per side. The outline
  // traces slot walls and gaps at tabs, so no line cuts through a tab's
  // base. Outline weight is strong when the block has a slot: the tab's
  // fill covers the inner half of the socket's outline, so it needs the
  // extra weight for the half that shows to still read.
  const d = conceptBlockPath(56, 56, 10, sides);
  const safeLabel = String(label == null ? '' : label)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const gid = 'conceptSheen' + (conceptSheenId++);
  const outlineD = conceptOutlinePath(56, 56, 10, sides);
  const hasSlot = Object.values(sides || {}).some(v => v === 'slot');
  const outlineW = hasSlot ? 3 : 1.5;
  const outlineO = hasSlot ? 0.8 : 0.55;
  // A block with a unique icon shows the icon instead of its text label;
  // anything without an icon keeps its text.
  const icon = conceptIconForBlock(blockType, label);
  let face = icon || `<text x="28" y="30" text-anchor="middle" font-size="8.5" font-weight="800" ` +
    `letter-spacing="0.2" fill="rgba(255,255,255,0.96)">${safeLabel}</text>`;
  // Apply Force (Nov 7, 2026): the arrow icon rotates to the force
  // direction when the placed block carries numeric X/Y (atan2, screen
  // coords, Y down — the SVG rotate is clockwise-positive, the same
  // sense). A null angle (expression values, or no data, as in the
  // palette) keeps the default right-pointing arrow, and only the
  // Apply Force icon ever rotates.
  if (icon && Number.isFinite(iconAngleDeg) &&
      String(label == null ? '' : label).trim().toLowerCase() === 'apply force') {
    face = `<g transform="rotate(${iconAngleDeg} 28 28)">${icon}</g>`;
  }
  let s = `<svg class="puzzle-shape" viewBox="0 0 56 56" width="56" height="56" aria-hidden="true">` +
    `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="#ffffff" stop-opacity="0.22"/>` +
    `<stop offset="0.5" stop-color="#ffffff" stop-opacity="0.05"/>` +
    `<stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient></defs>` +
    `<path d="${d}" fill="${color}"/>`;
  s += `<path d="${d}" fill="url(#${gid})"/>` +
    `<path d="${outlineD}" fill="none" stroke="rgba(2,6,16,${outlineO})" stroke-width="${outlineW}" stroke-linejoin="round"/>` +
    face + `</svg>`;
  return s;
}

// P3 item 17 (accessibility): keyboard-operable logic grid.
// Cells use roving tabindex (one Tab stop for the whole grid): arrow keys
// move between cells, Enter/Space places or selects a block, Delete clears
// the focused cell, Escape returns focus to the grid container (where the
// arrows scroll the grid instead, as before). Every cell carries a plain
// aria-label so a screen reader can say what is on it.
function updateCellA11y(cell) {
  const row = parseInt(cell.dataset.row, 10) + 1;
  const col = parseInt(cell.dataset.col, 10) + 1;
  const label = cell.dataset.blockLabel || cell.dataset.blockType;
  cell.setAttribute('aria-label', label
    ? `Row ${row}, column ${col}: ${label} block`
    : `Row ${row}, column ${col}: empty cell`);
}

let rovingCell = null;
function setRovingCell(cell) {
  if (rovingCell && rovingCell !== cell) rovingCell.tabIndex = -1;
  if (cell) { cell.tabIndex = 0; rovingCell = cell; }
}

function activateCell(cell, shift) {
  const i = parseInt(cell.dataset.index, 10);
  if (selectedBlockType === 'none') {
    if (cell.dataset.blockType) selectCell(cell);
    else { clearSelectedCell(); showDefaultPropertiesPanel(); }
    return;
  }
  if (cell.dataset.blockType === selectedBlockType) { if (!shift) selectCell(cell); return; }

  cell.classList.remove(...ALL_BLOCK_CLASSES);
  clearBlockVisualFromCell(cell);

  if (cell.dataset.blockType) {
    delete cell.dataset.blockType;
    cellData.delete(i);
    if (selectedCell === cell) { clearSelectedCell(); showDefaultPropertiesPanel(); }
  } else {
    cell.classList.add(selectedBlockType);
    cell.dataset.blockType = selectedBlockType;
    // Defaults first, then the visual: the visual reads the cell's own
    // data (the Apply Force arrow rotates to its X/Y), so a fresh place
    // must own its defaults before it draws.
    if (!cellData.has(i)) initCellDefaults(i, selectedBlockType);
    applyBlockVisualToCell(cell, selectedBlockType);
    if (!shift) {
      selectCell(cell);
      blockOptions.forEach(o => { if (o.getAttribute('data-block-type') === 'none') o.click(); });
    }
  }
  updateCellA11y(cell);
  commitActiveGrid();
  // Placing or removing a block changes which sides its neighbors show
  // connectors on (conditional connectors, prototype/negspace-blocks).
  refreshAdjacentBlockVisuals(cell);
}

for (let i = 0; i < HydraGridModel.GRID_CELLS; i++) {
  const cell = document.createElement('div');
  cell.className     = 'cell';
  cell.dataset.index = i;
  cell.dataset.row   = HydraGridModel.rowOf(i);
  cell.dataset.col   = HydraGridModel.colOf(i);
  cell.tabIndex      = i === 0 ? 0 : -1;
  if (i === 0) rovingCell = cell;
  updateCellA11y(cell);

  cell.addEventListener('click', e => { setRovingCell(cell); activateCell(cell, e.shiftKey); });

  grid.appendChild(cell);
  cells.push(cell);
}

// Grid keyboard navigation (delegated: one listener, not 3600).
// stopPropagation keeps the document-level arrow-scroll handler from also
// firing while focus is on a cell.
grid.addEventListener('keydown', e => {
  const cell = e.target.closest?.('.cell');
  if (!cell) return;
  const idx = parseInt(cell.dataset.index, 10);
  switch (e.key) {
    case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown':
    case 'Home': case 'End': {
      const next = HydraGridModel.moveIndex(idx, e.key);
      if (next === null) return;
      e.preventDefault(); e.stopPropagation();
      const target = cells[next];
      if (!target) return;
      setRovingCell(target);
      target.focus();
      return;
    }
    case 'Enter': case ' ':
      e.preventDefault(); e.stopPropagation();
      setRovingCell(cell); activateCell(cell, e.shiftKey);
      return;
    case 'Delete': case 'Backspace':
      if (cell.dataset.blockType) {
        e.preventDefault(); e.stopPropagation();
        if (selectedCell !== cell) selectCell(cell);
        deleteSelectedBlock();
        setRovingCell(cell); cell.focus();
      }
      return;
    case 'Escape':
      e.preventDefault(); e.stopPropagation();
      gridContainer?.focus();
      return;
    default: return;
  }
});

function initCellDefaults(index, type) {
  cellData.set(index, HydraGridModel.buildBlockDefaults(
    type, getAllObjectNames(), getCatalogBlock(type), currentSceneId));
}

// Returns names of all objects across ALL scenes (for script dropdowns)
function getAllObjectNames() {
  const names = new Set();
  scenes.forEach(s => s.objects.forEach(o => { if (o.name) names.add(o.name); }));
  return [...names];
}

// Returns objects from the currently active scene by name
function getObjectsByName(name, objectList) {
  if (!name || (typeof name === 'string' && !name.trim())) return [];
  return (objectList || []).filter(o => o.name === name && o._alive !== false);
}

// ============================================================
// PANEL HELPERS
// ============================================================
const backToBlocksBtn = document.getElementById('back-to-blocks-btn');
const blockTypePanel  = document.getElementById('block-type-panel');
const propertiesPanel = document.getElementById('properties-panel');
const propertiesContent = document.getElementById('properties-content');

backToBlocksBtn.addEventListener('click', showBlockTypePanel);

function showBlockTypePanel() {
  blockTypePanel.style.display = 'block';
  propertiesPanel.style.display = 'none';
}
function showPropertiesPanel() {
  blockTypePanel.style.display = 'none';
  propertiesPanel.style.display = 'block';
}
function showDefaultPropertiesPanel() { showBlockTypePanel(); }

function openPickerDialog(title, items, onPick) {
  const backdrop = document.createElement('div');
  backdrop.className = 'hydra-modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'hydra-modal';
  modal.innerHTML = `
    <div class="hydra-modal-header">
      <strong>${title}</strong>
      <button type="button" class="component-mini-btn" data-close-picker>Close</button>
    </div>
    <div class="hydra-modal-body picker-layout">
      <aside class="picker-context">
        <input class="picker-context-search" type="search" placeholder="Filter objects">
        <div class="picker-context-title">Scene objects</div>
        <div class="picker-object-list"></div>
      </aside>
      <section class="picker-main">
        <input class="picker-search" type="search" placeholder="Search ${title.toLowerCase()}">
        <div class="picker-grid"></div>
      </section>
      <aside class="picker-details">
        <div class="picker-detail-icon"><i class="fas fa-magic"></i></div>
        <strong>Select an item</strong>
        <p>Choose from the list to see what it changes and which settings it will expose.</p>
      </aside>
    </div>
  `;
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  const search = modal.querySelector('.picker-search');
  const contextSearch = modal.querySelector('.picker-context-search');
  const objectList = modal.querySelector('.picker-object-list');
  const gridEl = modal.querySelector('.picker-grid');
  const detailEl = modal.querySelector('.picker-details');
  const pickerOpener = document.activeElement;
  const close = () => {
    backdrop.remove();
    // P3 item 17 (accessibility): focus returns to whatever opened the picker.
    if (pickerOpener && document.contains(pickerOpener)) pickerOpener.focus();
  };
  modal.querySelector('[data-close-picker]')?.addEventListener('click', close);
  backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) close(); });
  // P3 item 17 (accessibility): Escape closes the picker from anywhere inside it.
  backdrop.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });

  function renderObjects(term = '') {
    if (!objectList) return;
    const q = term.trim().toLowerCase();
    const names = getAllObjectNames().filter(name => !q || name.toLowerCase().includes(q));
    objectList.innerHTML = '';
    if (!names.length) {
      const empty = document.createElement('div');
      empty.className = 'picker-empty';
      empty.textContent = 'No matching objects';
      objectList.appendChild(empty);
      return;
    }
    names.forEach(name => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'picker-object';
      const icon = document.createElement('i');
      icon.className = 'fas fa-cube';
      const label = document.createElement('span');
      label.textContent = name;
      item.append(icon, label);
      item.addEventListener('click', () => {
        search.value = name;
        render(name);
      });
      objectList.appendChild(item);
    });
  }

  function showDetail(item) {
    if (!detailEl || !item) return;
    detailEl.innerHTML = '';
    const icon = document.createElement('div');
    icon.className = 'picker-detail-icon';
    icon.innerHTML = item.icon || '<i class="fas fa-bolt"></i>';
    const name = document.createElement('strong');
    name.textContent = item.title;
    const category = document.createElement('div');
    category.className = 'picker-detail-category';
    category.textContent = item.category || 'General';
    const desc = document.createElement('p');
    desc.textContent = item.description || 'Adds this block or component to the current selection.';
    detailEl.append(icon, name, category, desc);
    if (item.fields?.length) {
      const fieldList = document.createElement('ul');
      item.fields.slice(0, 5).forEach(field => {
        const li = document.createElement('li');
        li.textContent = field.label || field.key;
        fieldList.appendChild(li);
      });
      detailEl.appendChild(fieldList);
    }
  }

  function render(term = '') {
    const q = term.trim().toLowerCase();
    gridEl.innerHTML = '';
    const filtered = items.filter(item => {
      const haystack = `${item.title || ''} ${item.category || ''} ${item.description || ''} ${item.value || ''}`.toLowerCase();
      return !q || haystack.includes(q);
    });
    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'picker-empty';
      empty.textContent = 'No matching items';
      gridEl.appendChild(empty);
      return;
    }
    let activeCategory = null;
    filtered.forEach(item => {
      if ((item.category || 'General') !== activeCategory) {
        activeCategory = item.category || 'General';
        const category = document.createElement('div');
        category.className = 'picker-category';
        category.textContent = activeCategory;
        gridEl.appendChild(category);
      }
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'picker-item';
        const strong = document.createElement('strong');
        strong.textContent = item.title;
        const span = document.createElement('span');
        span.textContent = item.description || '';
        btn.append(strong, span);
        btn.addEventListener('mouseenter', () => showDetail(item));
        btn.addEventListener('focus', () => showDetail(item));
        btn.addEventListener('click', () => { onPick(item.value, item); close(); });
        gridEl.appendChild(btn);
      });
    showDetail(filtered[0]);
  }
  contextSearch?.addEventListener('input', e => renderObjects(e.target.value));
  search?.addEventListener('input', e => render(e.target.value));
  renderObjects();
  render();
  setTimeout(() => search?.focus(), 0);
}

function selectCell(cell) {
  clearSelectedCell();
  selectedCell = cell;
  cell.classList.add('selected');
  setRovingCell(cell);
  const idx  = parseInt(cell.dataset.index);
  const type = cell.dataset.blockType;
  showPropertiesPanel();
  const map = {
    'condition':          showConditionProperties,
    'mouse-condition':    showMouseConditionProperties,
    'action':             showActionProperties,
    'advanced-condition': showAdvancedConditionProperties,
    'advanced-action':    showAdvancedActionProperties,
    'and-condition':      showAndConditionProperties,
    'set-variable':       showSetVariableProperties,
    'get-variable':       showGetVariableProperties,
    'destroy-object':     showDestroyObjectProperties,
    'show-hide':          showShowHideProperties,
    'play-sound':         showPlaySoundProperties,
    'play-animation':     showPlayAnimationProperties,
    'set-animation':      showSetAnimationProperties,
    'stop-animation':     showStopAnimationProperties,
    'animation-finished-condition': showAnimationFinishedProperties,
    'set-anim-state':     showSetAnimStateProperties,
    'anim-state-condition': showAnimStateConditionProperties,
    'set-blend':          showSetBlendProperties,
    'stop-blend':         showStopBlendProperties,
    'blend-active-condition': showBlendActiveConditionProperties,
    'tween-property': showTweenProperties,
    'stop-tween':     showStopTweenProperties,
    'tween-finished-condition': showTweenFinishedProperties,
    'emit-burst': showEmitBurstProperties,
    'start-emitter': showStartEmitterProperties,
    'stop-emitter': showStopEmitterProperties,
    'clear-particles': showClearParticlesProperties,
    'game-start':         showGameStartProperties,
    'switch-scene':       showSwitchSceneProperties,
    'set-text':           showSetTextProperties,
    'set-camera':         showSetCameraProperties,
    'follow-camera':      showFollowCameraProperties,
    'set-size':           showSetSizeProperties,
    'timer-condition':    showTimerConditionProperties,
    'edge-condition':     showEdgeConditionProperties,
    'trigger-once-condition': showTriggerOnceProperties,
    'set-velocity':       showSetVelocityProperties,
    'spawn-object':       showSpawnObjectProperties,
    'rotate-object':      showRotateObjectProperties,
    'random-variable':    showRandomVariableProperties,
    'overlap-condition':  showOverlapConditionProperties,
    'force-toward':       showForceTowardProperties,
  };
  if (map[type]) map[type](idx);
  else if (getCatalogBlock(type)) showCatalogBlockProperties(idx, getCatalogBlock(type));
}

function deleteSelectedBlock() {
  if (!selectedCell?.dataset.blockType) return;
  const idx = parseInt(selectedCell.dataset.index);
  selectedCell.classList.remove(...ALL_BLOCK_CLASSES, 'selected');
  delete selectedCell.dataset.blockType;
  clearBlockVisualFromCell(selectedCell);
  cellData.delete(idx);
  refreshAdjacentBlockVisuals(selectedCell);
  clearSelectedCell();
  showDefaultPropertiesPanel();
  commitActiveGrid();
}

// ============================================================
// PROPERTY PANEL BUILDERS
// ============================================================
// P2 item 14 slice 2: the property-panel input primitives live in
// hydra-propinputs.js. script.js keeps thin delegations so the hundreds
// of call sites below are unchanged; the module owns the id counter and
// calls back into markProjectDirty on every edit.
// Slice 3: the editor-state builders read live editor state only
// through these providers; the module degrades to empty name lists /
// no-op cell writes when one is missing or throws.
HydraPropInputs.configure({
  onDirty: function () { markProjectDirty(); },
  getObjectNames: getAllObjectNames,
  getInputActionNames: function () { return getProjectInputActions().map(function (a) { return a.name; }); },
  getAnimationNames: getObjectAnimationNames,
  getStateNames: getObjectStateNames,
  getBlendNames: getObjectBlendNames,
  getVariableNames: getKnownVariableNames,
  getAudioAssets: function () {
    return Object.keys(assetLibrary).filter(function (id) { return (assetLibrary[id].kind || '') === 'audio'; })
      .map(function (id) { return [id, assetLibrary[id].name || id]; });
  },
  getKeyAliases: getEventKeyAliases,
  setCellData: function (cellIndex, data) { cellData.set(cellIndex, data); }
});
function bindStaticPropGroupLabels() { return HydraPropInputs.bindStaticPropGroupLabels(); }
// P2 item 14 slice 4: the scene stage (dimensions, snap/zoom, camera
// frame, background/size, 3D viewport + camera/darkness field sync)
// lives in hydra-stage.js. The stage reads live editor state only
// through these providers; without them it degrades to no background
// image, no model meshes, and no 3D/Lighting modules.
HydraStage.configure({
  onDirty: function () { markProjectDirty(); },
  normalizeScene: function (scene) { window.HydraUniversal?.normalizeScene?.(scene); },
  getBgDataUrl: function (id) { return assetLibrary[id] ? assetLibrary[id].dataUrl : null; },
  getImage: getImage,
  resolveModelMeshFor: resolveModelMeshFor
});
bindStaticPropGroupLabels();
function makePropGroup(label, input) { return HydraPropInputs.makePropGroup(label, input); }
function makeSelect(options, value, onChange) { return HydraPropInputs.makeSelect(options, value, onChange); }
function makeNumberInput(value, min, max, step, onChange) { return HydraPropInputs.makeNumberInput(value, min, max, step, onChange); }
function makeTextInput(value, placeholder, onChange) { return HydraPropInputs.makeTextInput(value, placeholder, onChange); }
function makeCheckbox(label, checked, onChange) { return HydraPropInputs.makeCheckbox(label, checked, onChange); }
function makeColorInput(value, onChange) { return HydraPropInputs.makeColorInput(value, onChange); }
function makeTextareaInput(value, placeholder, rows, onChange) { return HydraPropInputs.makeTextareaInput(value, placeholder, rows, onChange); }
function makeNote(text) { return HydraPropInputs.makeNote(text); }

function makeInvertToggle(data, cellIndex, label = 'Invert condition') { return HydraPropInputs.makeInvertToggle(data, cellIndex, label); }

// Object name dropdown populated from all scene objects
function makeObjectSelect(value, onChange, includeAll = false, allowBlank = false) { return HydraPropInputs.makeObjectSelect(value, onChange, includeAll, allowBlank); }

// Named input actions defined on the project (Inputs tab). Returns the
// normalized list; always an array, never throws.
function getProjectInputActions() {
  try {
    const project = window.projectManager?.getCurrentProject?.();
    const mod = window.HydraActions;
    if (!mod) return [];
    return mod.normalizeActions(project && project.inputActions);
  } catch (e) { return []; }
}

// Action name dropdown populated from the project's input actions.
function makeActionSelect(value, onChange) { return HydraPropInputs.makeActionSelect(value, onChange); }

// Audio asset dropdown populated from the project's uploaded audio
// assets (blank = built-in tone). P4 Advanced batch 17.
function makeAudioAssetSelect(value, onChange) { return HydraPropInputs.makeAudioAssetSelect(value, onChange); }

function keyboardConditionState(data) {
  const inputCondition = data?.inputCondition || '';
  if (inputCondition.includes('JustPressed') || data?.trigger === 'pressed') return 'justPressed';
  if (inputCondition.includes('Released') || data?.trigger === 'released') return 'released';
  return 'pressed';
}

function keyboardConditionUsesAnyKey(data) {
  return String(data?.inputCondition || '').startsWith('anyKey');
}

function buildKeyboardCondition(state, anyKey) {
  if (anyKey) {
    if (state === 'justPressed') return 'anyKeyJustPressed';
    if (state === 'released') return 'anyKeyReleased';
    return 'anyKeyPressed';
  }
  if (state === 'justPressed') return 'keyJustPressed';
  if (state === 'released') return 'keyReleased';
  return 'keyPressed';
}

function syncKeyboardConditionData(data, state, anyKey) {
  data.type = 'keyPressed';
  data.inputCondition = buildKeyboardCondition(state, anyKey);
  data.trigger = state === 'justPressed' ? 'pressed' : state === 'released' ? 'released' : 'down';
}

function makeKeyPicker(data, cellIndex) { return HydraPropInputs.makeKeyPicker(data, cellIndex); }

function makeTargetModeSelect(data, cellIndex, label = 'Target instances:') { return HydraPropInputs.makeTargetModeSelect(data, cellIndex, label); }

// ============================================================
// BLOCK PROPERTIES PANELS
// ============================================================

function showGameStartProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { type: 'gameStart', reversed: false };
  const root = document.createElement('div');
  root.appendChild(makeInvertToggle(data, cellIndex));
  root.appendChild(makeNote('Fires when the preview starts.'));
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

function showConditionProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { key: 'ArrowRight', type: 'keyPressed', inputCondition: 'keyPressed', reversed: false };
  if (data.type === 'keyJustPressed') {
    data.type = 'keyPressed';
    data.inputCondition = 'keyJustPressed';
    cellData.set(cellIndex, data);
  }
  if (!data.inputCondition) {
    data.inputCondition = data.trigger === 'pressed'
      ? 'keyJustPressed'
      : data.trigger === 'released'
        ? 'keyReleased'
        : 'keyPressed';
    cellData.set(cellIndex, data);
  }
  const root = document.createElement('div');
  const state = keyboardConditionState(data);
  const anyKey = keyboardConditionUsesAnyKey(data);
  root.appendChild(makePropGroup('State:', makeSelect(
    [
      ['pressed', 'Held down'],
      ['justPressed', 'Pressed this frame'],
      ['released', 'Released this frame']
    ],
    state,
    v => {
      syncKeyboardConditionData(data, v, keyboardConditionUsesAnyKey(data));
      cellData.set(cellIndex, data);
      showConditionProperties(cellIndex);
    }
  )));
  root.appendChild(makeCheckbox('Any key', anyKey, v => {
    syncKeyboardConditionData(data, keyboardConditionState(data), v);
    cellData.set(cellIndex, data);
    showConditionProperties(cellIndex);
  }));
  if (!keyboardConditionUsesAnyKey(data)) {
    root.appendChild(makePropGroup('Key to check:', makeKeyPicker(data, cellIndex)));
  }
  root.appendChild(makeInvertToggle(data, cellIndex));
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

function showMouseConditionProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { button: 'left', type: 'mouseClick', mouseCondition: 'mouseButtonPressed', reversed: false };
  const root = document.createElement('div');
  root.appendChild(makePropGroup('Condition:', makeSelect(
    [['mouseButtonPressed', 'Mouse button pressed'], ['mouseButtonJustPressed', 'Mouse button just pressed'], ['mouseButtonReleased', 'Mouse button released']],
    data.mouseCondition || 'mouseButtonPressed',
    v => { data.mouseCondition = v; cellData.set(cellIndex, data); }
  )));
  root.appendChild(makePropGroup('Button:', makeSelect(
    [['left','Left Click'],['middle','Middle Click'],['right','Right Click'],['any','Any Button']],
    data.button || 'left',
    v => { data.button = v; cellData.set(cellIndex, data); }
  )));
  root.appendChild(makeInvertToggle(data, cellIndex));
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

function showAdvancedConditionProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { type: 'collision', object1: '', object2: '', countTouchingEdges: true, reversed: false };
  if (data.countTouchingEdges === undefined) data.countTouchingEdges = data.contactTolerance !== 0;
  delete data.side;
  delete data.contactTolerance;
  cellData.set(cellIndex, data);
  const root = document.createElement('div');
  root.appendChild(makePropGroup('Object A:', makeObjectSelect(data.object1, v => { data.object1 = v; cellData.set(cellIndex, data); })));
  root.appendChild(makePropGroup('Object B:', makeObjectSelect(data.object2, v => { data.object2 = v; cellData.set(cellIndex, data); })));
  root.appendChild(makeCheckbox('Count edges touching as collision', data.countTouchingEdges !== false, v => {
    data.countTouchingEdges = v;
    cellData.set(cellIndex, data);
  }));
  root.appendChild(makeInvertToggle(data, cellIndex));
  root.appendChild(makeNote('Turn on edge touching when separated physics objects should still count, such as a player standing on a floor.'));
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

// Re-render one placed cell's block visual (used by the Apply Force
// panel: editing X/Y re-points the arrow immediately, without waiting
// for a save or a reload).
function refreshForceArrow(cellIndex) {
  const cell = cells[cellIndex];
  if (cell && cell.dataset.blockType) applyBlockVisualToCell(cell, cell.dataset.blockType);
}

function showActionProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { forceX: 5, forceY: 0, type: 'applyForce', targetObject: '', reversed: false };
  const root = document.createElement('div');
  root.appendChild(makePropGroup('Object:', makeObjectSelect(data.targetObject, v => { data.targetObject = v; cellData.set(cellIndex, data); })));
  root.appendChild(makeTargetModeSelect(data, cellIndex));
  root.appendChild(makePropGroup('X:', makeExprInput(data.forceX ?? 5, '5 or speed', v => { data.forceX = v; cellData.set(cellIndex, data); refreshForceArrow(cellIndex); })));
  root.appendChild(makePropGroup('Y:', makeExprInput(data.forceY ?? 0, '0 or -jump', v => { data.forceY = v; cellData.set(cellIndex, data); refreshForceArrow(cellIndex); })));
  root.appendChild(makePropGroup('Mode:', makeSelect(
    [['add','Add'],['set','Set']],
    data.mode || 'add',
    v => { data.mode = v; cellData.set(cellIndex, data); }
  )));
  root.appendChild(makeNote('Positive Y = downward. Accepts numbers or expressions like "score * 0.5".'));
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

function showAdvancedActionProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { type: 'teleport', toX: 300, toY: 200, targetObject: '' };
  const root = document.createElement('div');
  root.appendChild(makePropGroup('Object:', makeObjectSelect(data.targetObject, v => { data.targetObject = v; cellData.set(cellIndex, data); })));
  root.appendChild(makeTargetModeSelect(data, cellIndex));
  root.appendChild(makePropGroup('X:', makeExprInput(data.toX ?? 300, '300 or enemy.posX', v => { data.toX = v; cellData.set(cellIndex, data); })));
  root.appendChild(makePropGroup('Y:', makeExprInput(data.toY ?? 200, '200 or enemy.posY', v => { data.toY = v; cellData.set(cellIndex, data); })));
  root.appendChild(makeNote('Accepts numbers or expressions like "enemy.posX + 10".'));
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

function showAndConditionProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { type: 'and', reversed: false };
  const root = document.createElement('div');
  root.appendChild(makePropGroup('Logic:', makeSelect(
    [['and','And'],['or','Or']],
    data.logic || 'and',
    v => { data.logic = v; cellData.set(cellIndex, data); }
  )));
  root.appendChild(makeNote('Combines adjacent condition blocks.'));
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

function showSetVariableProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { type: 'setVariable', varName: 'score', operation: 'set', value: 0 };
  const root = document.createElement('div');
  root.appendChild(makePropGroup('Variable:', makeTextInput(data.varName, 'score', v => { data.varName = v; cellData.set(cellIndex, data); })));
  root.appendChild(makePropGroup('Operation:', makeSelect(
    [['set','Set to value'],['add','Add value'],['subtract','Subtract value'],['multiply','Multiply by value'],['toggle','Toggle true/false']],
    data.operation,
    v => { data.operation = v; cellData.set(cellIndex, data); }
  )));
  root.appendChild(makePropGroup('Value:', makeExprInput(data.value ?? 0, '1  or  score + lives', v => { data.value = v; cellData.set(cellIndex, data); })));
  root.appendChild(makeNote('Value can be a number or expression: "score + 10", "lives * 2".'));
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

function showGetVariableProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { type: 'getVariable', varName: 'score', operator: '>=', compareValue: 1, reversed: false };
  const root = document.createElement('div');
  root.appendChild(makePropGroup('Variable:', makeTextInput(data.varName, 'score', v => { data.varName = v; cellData.set(cellIndex, data); })));
  root.appendChild(makePropGroup('Operator:', makeSelect(
    [['>=','≥ (gte)'],['<=','≤ (lte)'],['==','= (equals)'],['!=','≠ (not equals)'],['>', '> (gt)'],['<', '< (lt)']],
    data.operator,
    v => { data.operator = v; cellData.set(cellIndex, data); }
  )));
  root.appendChild(makePropGroup('Value:', makeExprInput(data.compareValue ?? 1, '10 or lives', v => { data.compareValue = v; cellData.set(cellIndex, data); })));
  root.appendChild(makeInvertToggle(data, cellIndex));
  root.appendChild(makeNote('Compare value can be an expression: "lives * 2", "Math.floor(score / 10)".'));
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

function showDestroyObjectProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { type: 'destroyObject', targetObject: '' };
  const root = document.createElement('div');
  root.appendChild(makePropGroup('Object:', makeObjectSelect(data.targetObject, v => { data.targetObject = v; cellData.set(cellIndex, data); })));
  root.appendChild(makeTargetModeSelect(data, cellIndex));
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

function showShowHideProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { type: 'showHide', targetObject: '', action: 'hide' };
  const root = document.createElement('div');
  root.appendChild(makePropGroup('Object:', makeObjectSelect(data.targetObject, v => { data.targetObject = v; cellData.set(cellIndex, data); })));
  root.appendChild(makeTargetModeSelect(data, cellIndex));
  root.appendChild(makePropGroup('Action:', makeSelect(
    [['hide','Hide'],['show','Show'],['toggle','Toggle']],
    data.action,
    v => { data.action = v; cellData.set(cellIndex, data); }
  )));
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

function showPlaySoundProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { type: 'playSound', assetId: '', frequency: 440, duration: 0.2, waveform: 'square', volume: 0.3, bus: 'sfx', pitch: 1 };
  const root = document.createElement('div');
  // Sound source: built-in tone (legacy) or an uploaded audio asset.
  const audioAssets = Object.keys(assetLibrary).filter(id => (assetLibrary[id].kind || '') === 'audio');
  const sourceOpts = [['', 'Built-in tone']].concat(audioAssets.map(id => [id, assetLibrary[id].name || id]));
  root.appendChild(makePropGroup('Sound:', makeSelect(
    sourceOpts,
    data.assetId || '',
    v => {
      data.assetId = v;
      data.soundName = v ? (assetLibrary[v] ? assetLibrary[v].name : '') : '';
      cellData.set(cellIndex, data);
      showPlaySoundProperties(cellIndex);
    }
  )));
  if (audioAssets.length === 0) {
    root.appendChild(makeNote('Upload an audio file in the Assets tab to play your own sounds.'));
  }
  if (data.assetId && assetLibrary[data.assetId]) {
    // Asset selected: tone settings don't apply.
    root.appendChild(makeNote('Plays "' + (assetLibrary[data.assetId].name || 'audio') + '" from your Assets. Tone settings below are ignored.'));
  } else {
    root.appendChild(makePropGroup('Frequency (Hz):', makeNumberInput(data.frequency, 20, 20000, 1, v => { data.frequency = v; cellData.set(cellIndex, data); })));
    root.appendChild(makePropGroup('Duration (s):', makeNumberInput(data.duration, 0.01, 5, 0.01, v => { data.duration = v; cellData.set(cellIndex, data); })));
    root.appendChild(makePropGroup('Waveform:', makeSelect(
      [['square','Square'],['sine','Sine'],['sawtooth','Sawtooth'],['triangle','Triangle']],
      data.waveform,
      v => { data.waveform = v; cellData.set(cellIndex, data); }
    )));
  }
  root.appendChild(makePropGroup('Volume (0–1):', makeNumberInput(data.volume, 0, 1, 0.05, v => { data.volume = v; cellData.set(cellIndex, data); })));
  // P4 item 30: audio buses. Every sound plays through the Music, SFX, or UI
  // bus; pitch shifts the tone frequency (or the streamed playback rate).
  const B30 = window.HydraAudioBuses;
  if (B30) {
    root.appendChild(makePropGroup('Bus:', makeSelect(
      B30.BUS_IDS.map(id => [id, B30.BUS_LABELS[id]]),
      B30.normalizeBusId(data.bus),
      v => {
        data.bus = v;
        cellData.set(cellIndex, data);
        showPlaySoundProperties(cellIndex); // re-render: the Loop field is music-only
      }
    )));
    root.appendChild(makePropGroup('Pitch (0.25–2):', makeNumberInput(data.pitch == null ? 1 : data.pitch, 0.25, 2, 0.05, v => { data.pitch = v; cellData.set(cellIndex, data); })));
    if (B30.normalizeBusId(data.bus) === 'music') {
      const loopDefault = data.loop === undefined ? true : !!data.loop;
      root.appendChild(makePropGroup('Loop:', makeSelect(
        [[true, 'Loop on'], [false, 'Play once']],
        loopDefault,
        v => { data.loop = (v === true || v === 'true'); cellData.set(cellIndex, data); }
      )));
      root.appendChild(makeNote('Music streams the audio file (never fully loaded into memory). Only one track plays at a time — a new one replaces the old.'));
    } else {
      root.appendChild(makeNote('SFX and UI sounds are decoded once and kept in memory, so rapid repeats cost nothing.'));
    }
  }
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

// Animation block property panels. Animation names come from the target
// object's Animations list in the Inspector; a typed name that doesn't exist
// yet is kept so blocks can be placed before the animation is built.
function getObjectAnimationNames(objectName) {
  const names = [];
  (scenes || []).forEach(s => (s.objects || []).forEach(o => {
    if (o.name === objectName) (o.animations || []).forEach(a => {
      if (a && a.name && !names.includes(a.name)) names.push(a.name);
    });
  }));
  return names;
}

function makeAnimationNameSelect(data, cellIndex, allowAny) { return HydraPropInputs.makeAnimationNameSelect(data, cellIndex, allowAny); }

function showPlayAnimationProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { type: 'playAnimation', targetObject: '', animation: '' };
  const root = document.createElement('div');
  root.appendChild(makePropGroup('Object:', makeObjectSelect(data.targetObject, v => {
    data.targetObject = v;
    if (!data.animation) {
      const names = getObjectAnimationNames(v);
      if (names.length) data.animation = names[0];
    }
    cellData.set(cellIndex, data);
    showPlayAnimationProperties(cellIndex);
  })));
  root.appendChild(makeTargetModeSelect(data, cellIndex));
  root.appendChild(makePropGroup('Animation:', makeAnimationNameSelect(data, cellIndex, false)));
  root.appendChild(makeNote('Plays the animation from its first frame. Build the animation list on the object in the Inspector (Animations section).'));
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

function showSetAnimationProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { type: 'setAnimation', targetObject: '', animation: '' };
  const root = document.createElement('div');
  root.appendChild(makePropGroup('Object:', makeObjectSelect(data.targetObject, v => {
    data.targetObject = v;
    if (!data.animation) {
      const names = getObjectAnimationNames(v);
      if (names.length) data.animation = names[0];
    }
    cellData.set(cellIndex, data);
    showSetAnimationProperties(cellIndex);
  })));
  root.appendChild(makeTargetModeSelect(data, cellIndex));
  root.appendChild(makePropGroup('Animation:', makeAnimationNameSelect(data, cellIndex, false)));
  root.appendChild(makeNote('Switches to the animation without restarting the frame counter — use it to swap variants (Walk → WalkHurt) seamlessly.'));
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

function showStopAnimationProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { type: 'stopAnimation', targetObject: '' };
  const root = document.createElement('div');
  root.appendChild(makePropGroup('Object:', makeObjectSelect(data.targetObject, v => { data.targetObject = v; cellData.set(cellIndex, data); })));
  root.appendChild(makeTargetModeSelect(data, cellIndex));
  root.appendChild(makeNote('Stops the animation. The object goes back to its static sprite.'));
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

function showAnimationFinishedProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { type: 'animationFinished', targetObject: '', animation: '', reversed: false };
  const root = document.createElement('div');
  root.appendChild(makePropGroup('Object:', makeObjectSelect(data.targetObject, v => {
    data.targetObject = v;
    cellData.set(cellIndex, data);
    showAnimationFinishedProperties(cellIndex);
  })));
  root.appendChild(makePropGroup('Animation:', makeAnimationNameSelect(data, cellIndex, true)));
  root.appendChild(makeInvertToggle(data, cellIndex));
  root.appendChild(makeNote('Fires when a play-once animation finishes. Pick a specific animation, or "Any animation" to catch all of them.'));
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

// Animation state machine property panels. State names come from the target
// object's Animation States list in the Inspector; a typed name that doesn't
// exist yet is kept so blocks can be placed before the states are built.
function getObjectStateNames(objectName) {
  const names = [];
  (scenes || []).forEach(s => (s.objects || []).forEach(o => {
    if (o.name === objectName) {
      const states = window.HydraStateMachine ? window.HydraStateMachine.normalizeStates(o) : (o.animStates || []);
      states.forEach(st => {
        if (st && st.name && !names.includes(st.name)) names.push(st.name);
      });
    }
  }));
  return names;
}

function makeStateNameSelect(data, cellIndex) { return HydraPropInputs.makeStateNameSelect(data, cellIndex); }

function showSetAnimStateProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { type: 'setAnimState', targetObject: '', state: '' };
  const root = document.createElement('div');
  root.appendChild(makePropGroup('Object:', makeObjectSelect(data.targetObject, v => {
    data.targetObject = v;
    if (!data.state) {
      const names = getObjectStateNames(v);
      if (names.length) data.state = names[0];
    }
    cellData.set(cellIndex, data);
    showSetAnimStateProperties(cellIndex);
  })));
  root.appendChild(makeTargetModeSelect(data, cellIndex));
  root.appendChild(makePropGroup('State:', makeStateNameSelect(data, cellIndex)));
  root.appendChild(makeNote('Enters the state and plays its animation automatically at the state\u2019s speed. Drive transitions from your logic grid — e.g. Every Frame \u2192 Action Held \u2192 Set Animation State "Run".'));
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

function showAnimStateConditionProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { type: 'animStateIs', targetObject: '', state: '', reversed: false };
  const root = document.createElement('div');
  root.appendChild(makePropGroup('Object:', makeObjectSelect(data.targetObject, v => {
    data.targetObject = v;
    cellData.set(cellIndex, data);
    showAnimStateConditionProperties(cellIndex);
  })));
  root.appendChild(makePropGroup('State:', makeStateNameSelect(data, cellIndex)));
  root.appendChild(makeInvertToggle(data, cellIndex));
  root.appendChild(makeNote('True while the object is in this animation state. Invert it to catch "left the state". Evaluates every frame like a variable read.'));
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

// Blend-space property panels. Blend names come from the target object's
// Blend Spaces list in the Inspector; a typed name that doesn't exist yet
// is kept so blocks can be placed before the blend spaces are built.
function getObjectBlendNames(objectName) {
  const names = [];
  (scenes || []).forEach(s => (s.objects || []).forEach(o => {
    if (o.name === objectName) {
      const blends = window.HydraBlendSpace ? window.HydraBlendSpace.normalizeBlendSpaces(o) : (o.animBlends || []);
      blends.forEach(b => {
        if (b && b.name && !names.includes(b.name)) names.push(b.name);
      });
    }
  }));
  return names;
}

function makeBlendNameSelect(data, cellIndex) { return HydraPropInputs.makeBlendNameSelect(data, cellIndex); }

function showSetBlendProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { type: 'setBlend', targetObject: '', blend: '', blendX: '0', blendY: '0' };
  const root = document.createElement('div');
  root.appendChild(makePropGroup('Object:', makeObjectSelect(data.targetObject, v => {
    data.targetObject = v;
    if (!data.blend) {
      const names = getObjectBlendNames(v);
      if (names.length) data.blend = names[0];
    }
    cellData.set(cellIndex, data);
    showSetBlendProperties(cellIndex);
  })));
  root.appendChild(makeTargetModeSelect(data, cellIndex));
  root.appendChild(makePropGroup('Blend:', makeBlendNameSelect(data, cellIndex)));
  root.appendChild(makePropGroup('X:', makeExprInput(data.blendX ?? '0', 'e.g. moveX', v => {
    data.blendX = v; cellData.set(cellIndex, data);
  })));
  root.appendChild(makePropGroup('Y:', makeExprInput(data.blendY ?? '0', 'e.g. moveY', v => {
    data.blendY = v; cellData.set(cellIndex, data);
  })));
  root.appendChild(makeNote('Sets the blend values and activates the blend space. Run it every frame from input values — e.g. X = Action Input "moveX", Y = Action Input "moveY" — and the engine crossfades between the nearest animations.'));
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

function showStopBlendProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { type: 'stopBlend', targetObject: '', blend: '' };
  const root = document.createElement('div');
  root.appendChild(makePropGroup('Object:', makeObjectSelect(data.targetObject, v => {
    data.targetObject = v;
    cellData.set(cellIndex, data);
    showStopBlendProperties(cellIndex);
  })));
  root.appendChild(makeTargetModeSelect(data, cellIndex));
  root.appendChild(makePropGroup('Blend:', makeBlendNameSelect(data, cellIndex)));
  root.appendChild(makeNote('Stops the blend space; the object goes back to its normal animation. Leave Blend empty to stop whichever blend is active.'));
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

function showBlendActiveConditionProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { type: 'blendActive', targetObject: '', blend: '', reversed: false };
  const root = document.createElement('div');
  root.appendChild(makePropGroup('Object:', makeObjectSelect(data.targetObject, v => {
    data.targetObject = v;
    cellData.set(cellIndex, data);
    showBlendActiveConditionProperties(cellIndex);
  })));
  root.appendChild(makePropGroup('Blend:', makeBlendNameSelect(data, cellIndex)));
  root.appendChild(makeInvertToggle(data, cellIndex));
  root.appendChild(makeNote('True while this blend space is active. Invert it to catch "blend stopped". Evaluates every frame like a variable read.'));
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

// Tween property panel: one-tap presets fill the fields below; hand-editing
// any field switches the preset back to Custom.
const TWEEN_PRESETS = [
  { id: 'custom', label: 'Custom (set the fields below)', fill: null },
  { id: 'move-right', label: 'Move right 100', fill: { property: 'posX', toValue: '100', relative: true, duration: 0.6, easing: 'easeOut', repeat: 'once' } },
  { id: 'move-left', label: 'Move left 100', fill: { property: 'posX', toValue: '-100', relative: true, duration: 0.6, easing: 'easeOut', repeat: 'once' } },
  { id: 'jump-up', label: 'Jump up 100', fill: { property: 'posY', toValue: '-100', relative: true, duration: 0.5, easing: 'easeOut', repeat: 'once' } },
  { id: 'bounce-down', label: 'Bounce down 200', fill: { property: 'posY', toValue: '200', relative: true, duration: 0.8, easing: 'easeOutBounce', repeat: 'once' } },
  { id: 'fade-out', label: 'Fade out', fill: { property: 'opacity', toValue: '0', relative: false, duration: 0.5, easing: 'easeInOut', repeat: 'once' } },
  { id: 'fade-in', label: 'Fade in', fill: { property: 'opacity', toValue: '1', relative: false, duration: 0.5, easing: 'easeInOut', repeat: 'once' } },
  { id: 'spin', label: 'Spin 360 degrees', fill: { property: 'rotation', toValue: '360', relative: true, duration: 1, easing: 'linear', repeat: 'once' } },
  { id: 'shake', label: 'Shake (wiggle left-right)', fill: { property: 'posX', toValue: '12', relative: true, duration: 0.12, easing: 'linear', repeat: 'pingpong' } }
];

function getTweenMeta() {
  const T = window.HydraTween;
  const props = T && T.PROPERTIES ? T.PROPERTIES : [
    { id: 'posX', label: 'X position' }, { id: 'posY', label: 'Y position' },
    { id: 'width', label: 'Width' }, { id: 'height', label: 'Height' },
    { id: 'rotation', label: 'Rotation (degrees)' }, { id: 'opacity', label: 'Opacity (0-1)' }
  ];
  const easings = T && T.EASINGS ? T.EASINGS : [
    { id: 'linear', label: 'Linear (steady)' }, { id: 'easeIn', label: 'Ease in (slow start)' },
    { id: 'easeOut', label: 'Ease out (slow end)' }, { id: 'easeInOut', label: 'Ease in-out (smooth)' },
    { id: 'easeOutBack', label: 'Pop (overshoots)' }, { id: 'easeOutBounce', label: 'Bounce (like a ball)' }
  ];
  const repeats = T && T.REPEATS ? T.REPEATS : [
    { id: 'once', label: 'Once' }, { id: 'loop', label: 'Loop' }, { id: 'pingpong', label: 'Ping-pong' }
  ];
  return { props, easings, repeats };
}

function showTweenProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { type: 'tweenProperty', targetObject: '', property: 'posX', toValue: '100', relative: true, duration: 0.6, easing: 'easeOut', repeat: 'once' };
  const meta = getTweenMeta();
  const root = document.createElement('div');
  root.appendChild(makePropGroup('Object:', makeObjectSelect(data.targetObject, v => {
    data.targetObject = v; cellData.set(cellIndex, data);
  })));
  root.appendChild(makeTargetModeSelect(data, cellIndex));
  root.appendChild(makePropGroup('Preset:', makeSelect(TWEEN_PRESETS.map(p => [p.id, p.label]), data.preset || 'custom', v => {
    data.preset = v;
    const p = TWEEN_PRESETS.find(x => x.id === v);
    if (p && p.fill) Object.assign(data, p.fill);
    cellData.set(cellIndex, data);
    showTweenProperties(cellIndex);
  })));
  const markCustom = () => { data.preset = 'custom'; cellData.set(cellIndex, data); showTweenProperties(cellIndex); };
  root.appendChild(makePropGroup('Property:', makeSelect(meta.props.map(p => [p.id, p.label]), data.property || 'posX', v => {
    data.property = v; markCustom();
  })));
  root.appendChild(makePropGroup('To value:', makeExprInput(data.toValue ?? '100', '100 or hero.posX + 200', v => {
    data.toValue = v; markCustom();
  })));
  root.appendChild(makeCheckbox('Relative: add to the starting value', data.relative !== false, v => {
    data.relative = v; markCustom();
  }));
  root.appendChild(makePropGroup('Duration (seconds):', makeNumberInput(data.duration ?? 0.6, 0, 60, 0.1, v => {
    data.duration = v; markCustom();
  })));
  root.appendChild(makePropGroup('Easing:', makeSelect(meta.easings.map(e => [e.id, e.label]), data.easing || 'easeOut', v => {
    data.easing = v; markCustom();
  })));
  root.appendChild(makePropGroup('Repeat:', makeSelect(meta.repeats.map(r => [r.id, r.label]), data.repeat || 'once', v => {
    data.repeat = v; markCustom();
  })));
  root.appendChild(makeNote('Animates the property over time. A new Tween on the same property replaces the old one. Relative adds the To value to where the property starts (great for jumps and moves).'));
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

function showStopTweenProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { type: 'stopTween', targetObject: '', property: '' };
  const meta = getTweenMeta();
  const root = document.createElement('div');
  root.appendChild(makePropGroup('Object:', makeObjectSelect(data.targetObject, v => { data.targetObject = v; cellData.set(cellIndex, data); })));
  root.appendChild(makeTargetModeSelect(data, cellIndex));
  root.appendChild(makePropGroup('Tweens to stop:', makeSelect(
    [['', 'All tweens'], ...meta.props.map(p => [p.id, p.label + ' only'])],
    data.property || '', v => { data.property = v; cellData.set(cellIndex, data); })));
  root.appendChild(makeNote('Stops the running tween(s). The property stays where it is.'));
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

function showTweenFinishedProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { type: 'tweenFinished', targetObject: '', property: '', reversed: false };
  const meta = getTweenMeta();
  const root = document.createElement('div');
  root.appendChild(makePropGroup('Object:', makeObjectSelect(data.targetObject, v => {
    data.targetObject = v;
    cellData.set(cellIndex, data);
    showTweenFinishedProperties(cellIndex);
  })));
  root.appendChild(makePropGroup('Tween:', makeSelect(
    [['', 'Any property'], ...meta.props.map(p => [p.id, p.label])],
    data.property || '', v => { data.property = v; cellData.set(cellIndex, data); })));
  root.appendChild(makeInvertToggle(data, cellIndex));
  root.appendChild(makeNote('Fires when a once-tween finishes. Pick a property, or "Any property" to catch all of them. Looping tweens never finish.'));
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

// ---- Particles property panels: preset-driven like the tween panel ----
// One-tap presets fill the fields below; hand-editing any field flips the
// preset back to Custom.

// Particle state for the editor preview: one transient state per preview run
// / scene load (mirrors the exported runtime). Never saved to project JSON.
function ensurePreviewParticleState() {
  const P = window.HydraParticles;
  if (!previewState.particles && P) previewState.particles = P.createParticleState();
  return previewState.particles;
}

// Floating damage-number state for the editor preview: one transient
// state per preview run / scene load (mirrors the exported runtime).
// Never saved to project JSON.
function ensurePreviewDamageNumberState() {
  const DF = window.HydraDamageFx;
  if (!previewState.damageNumbers && DF) previewState.damageNumbers = DF.createDamageNumberState();
  return previewState.damageNumbers;
}

// Respawn state for the editor preview: one transient state per preview
// run / scene load (mirrors the exported runtime). Never saved to
// project JSON.
function ensurePreviewRespawnState() {
  const RM = window.HydraRespawn;
  if (!previewState.respawn && RM) previewState.respawn = RM.createRespawnState();
  return previewState.respawn;
}

// Spawner state for the editor preview: one transient state per preview
// run / scene load (mirrors the exported runtime). Never saved to
// project JSON.
function ensurePreviewSpawnerState() {
  const SP = window.HydraSpawn;
  if (!previewState.spawners && SP) previewState.spawners = SP.createSpawnerState();
  return previewState.spawners;
}

// Movement state for the editor preview: one transient state per preview
// run / scene load (mirrors the exported runtime). Never saved to
// project JSON.
function ensurePreviewMovementState() {
  const MV = window.HydraMovement;
  if (!previewState.movement && MV) previewState.movement = MV.createMovementState();
  return previewState.movement;
}

// Platform state for the editor preview: one transient state per preview
// run / scene load (mirrors the exported runtime). Never saved to
// project JSON.
function ensurePreviewPlatformState() {
  const PF = window.HydraPlatform;
  if (!previewState.platform && PF) previewState.platform = PF.createPlatformState();
  return previewState.platform;
}

// Combat state for the editor preview: one transient state per preview
// run / scene load (mirrors the exported runtime). Never saved to
// project JSON.
function ensurePreviewCombatState() {
  const CB = window.HydraCombat;
  if (!previewState.combat && CB) previewState.combat = CB.createCombatState();
  return previewState.combat;
}

function getParticleMeta() {
  const P = window.HydraParticles;
  const shapes = P && P.SHAPES ? P.SHAPES : [
    { id: 'circle', label: 'Circle' }, { id: 'square', label: 'Square' }
  ];
  return { shapes };
}

function particlePresetOptions(kind) {
  const P = window.HydraParticles;
  const list = P && typeof P.presetsFor === 'function' ? P.presetsFor(kind) : [];
  return list.map(p => [p.id, p.label]);
}

function applyParticlePreset(data, presetId) {
  const P = window.HydraParticles;
  const p = P && P.PRESETS ? P.PRESETS.find(x => x.id === presetId) : null;
  data.preset = presetId;
  if (p && p.fill) Object.assign(data, p.fill);
}

function makeParticleColorInput(value, onChange) {
  const input = document.createElement('input');
  input.type = 'color'; input.className = 'property-input'; input.style.height = '36px';
  input.value = /^#[0-9a-fA-F]{6}$/.test(value || '') ? value : '#ffffff';
  input.addEventListener('input', e => { onChange(e.target.value); markProjectDirty(); });
  return input;
}

// Shared spec fields for Emit Burst (kind 'burst') and Start Emitter (kind
// 'emitter'): preset, x/y, count-or-rate, speed, spread, direction, lifetime,
// start/end size, start/end color, gravity, shape, additive glow.
function appendParticleSpecFields(root, data, cellIndex, kind, rerender) {
  const meta = getParticleMeta();
  root.appendChild(makePropGroup('Preset:', makeSelect(particlePresetOptions(kind), data.preset || 'custom', v => {
    applyParticlePreset(data, v);
    cellData.set(cellIndex, data);
    rerender();
  })));
  const markCustom = () => { data.preset = 'custom'; cellData.set(cellIndex, data); rerender(); };
  root.appendChild(makePropGroup('X:', makeExprInput(data.x ?? '0', '0 or hero.posX', v => {
    data.x = v; markCustom();
  })));
  root.appendChild(makePropGroup('Y:', makeExprInput(data.y ?? '0', '0 or hero.posY', v => {
    data.y = v; markCustom();
  })));
  if (kind === 'emitter') {
    root.appendChild(makePropGroup('Rate (particles/sec):', makeNumberInput(data.rate ?? 60, 0, 600, 1, v => {
      data.rate = v; markCustom();
    })));
  } else {
    root.appendChild(makePropGroup('Count:', makeNumberInput(data.count ?? 20, 1, 500, 1, v => {
      data.count = v; markCustom();
    })));
  }
  root.appendChild(makePropGroup('Speed (px/sec):', makeNumberInput(data.speed ?? 200, 0, 3000, 10, v => {
    data.speed = v; markCustom();
  })));
  root.appendChild(makePropGroup('Spread (degrees):', makeNumberInput(data.spread ?? 360, 0, 360, 5, v => {
    data.spread = v; markCustom();
  })));
  root.appendChild(makePropGroup('Direction (0=right, 90=down, 180=left, 270=up):', makeNumberInput(data.direction ?? 0, 0, 360, 5, v => {
    data.direction = v; markCustom();
  })));
  root.appendChild(makePropGroup('Lifetime (seconds):', makeNumberInput(data.lifetime ?? 1, 0.05, 30, 0.1, v => {
    data.lifetime = v; markCustom();
  })));
  root.appendChild(makePropGroup('Start size (px):', makeNumberInput(data.size0 ?? 8, 0, 200, 1, v => {
    data.size0 = v; markCustom();
  })));
  root.appendChild(makePropGroup('End size (px):', makeNumberInput(data.size1 ?? 2, 0, 200, 1, v => {
    data.size1 = v; markCustom();
  })));
  root.appendChild(makePropGroup('Start color:', makeParticleColorInput(data.color0, v => {
    data.color0 = v; markCustom();
  })));
  root.appendChild(makePropGroup('End color:', makeParticleColorInput(data.color1, v => {
    data.color1 = v; markCustom();
  })));
  root.appendChild(makePropGroup('Gravity (px/sec, negative = rises):', makeNumberInput(data.gravity ?? 0, -5000, 5000, 10, v => {
    data.gravity = v; markCustom();
  })));
  root.appendChild(makePropGroup('Shape:', makeSelect(meta.shapes.map(s => [s.id, s.label]), data.shape || 'circle', v => {
    data.shape = v; markCustom();
  })));
  root.appendChild(makeCheckbox('Additive glow (brightens whatever is behind)', data.additive === true, v => {
    data.additive = v; markCustom();
  }));
}

function showEmitBurstProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { type: 'emitBurst', preset: 'explosion', x: '0', y: '0', count: 40, speed: 320, spread: 360, direction: 0, lifetime: 0.7, size0: 10, size1: 2, color0: '#fbbf24', color1: '#ef4444', gravity: 500, shape: 'circle', additive: true };
  const root = document.createElement('div');
  const rerender = () => showEmitBurstProperties(cellIndex);
  appendParticleSpecFields(root, data, cellIndex, 'burst', rerender);
  root.appendChild(makeNote('Fires a one-shot burst of particles. X and Y are expressions, so you can burst right at hero.posX, hero.posY. Particles fade out as they die; speed and lifetime vary a little per particle so bursts look natural.'));
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

function showStartEmitterProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { type: 'startEmitter', emitterName: 'fx', followObject: '', preset: 'fire', rate: 60, x: '0', y: '0', speed: 90, spread: 25, direction: 270, lifetime: 1.1, size0: 14, size1: 4, color0: '#fb923c', color1: '#ef4444', gravity: -80, shape: 'circle', additive: true };
  const root = document.createElement('div');
  root.appendChild(makePropGroup('Emitter name:', makeTextInput(data.emitterName || 'fx', 'fx', v => {
    data.emitterName = v; cellData.set(cellIndex, data);
  })));
  const followNames = getAllObjectNames();
  root.appendChild(makePropGroup('Follow object (optional):', makeSelect(
    [['', 'None (fixed position)'], ...followNames.map(n => [n, n])],
    data.followObject || '', v => { data.followObject = v; cellData.set(cellIndex, data); })));
  const rerender = () => showStartEmitterProperties(cellIndex);
  appendParticleSpecFields(root, data, cellIndex, 'emitter', rerender);
  root.appendChild(makeNote('Starts a continuous emitter. It keeps spawning until Stop Emitter runs, and every scene starts with a clean slate. Tip: Game Start -> Start Emitter "rain" across the top of the world, or follow the player for a magic trail.'));
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

function showStopEmitterProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { type: 'stopEmitter', emitterName: '' };
  const root = document.createElement('div');
  root.appendChild(makePropGroup('Emitter name (blank = all):', makeTextInput(data.emitterName || '', 'fx', v => {
    data.emitterName = v; cellData.set(cellIndex, data);
  })));
  root.appendChild(makeNote('Stops the emitter. Particles already flying finish out their lifetimes.'));
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

function showClearParticlesProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { type: 'clearParticles', emitterName: '' };
  const root = document.createElement('div');
  root.appendChild(makePropGroup('Emitter name (blank = everything):', makeTextInput(data.emitterName || '', 'fx', v => {
    data.emitterName = v; cellData.set(cellIndex, data);
  })));
  root.appendChild(makeNote('Removes live particles instantly. The emitter keeps running unless you stop it too.'));
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

function showSwitchSceneProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { type: 'switchScene', sceneId: currentSceneId };
  const root = document.createElement('div');
  const opts = scenes.map(s => [String(s.id), s.name]);
  root.appendChild(makePropGroup('Switch to Scene:', makeSelect(opts, String(data.sceneId), v => { data.sceneId = parseInt(v); cellData.set(cellIndex, data); })));
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

function showSetTextProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { type: 'setText', targetObject: '', value: '', useVariable: false, varName: '' };
  const root = document.createElement('div');
  root.appendChild(makePropGroup('Text object:', makeObjectSelect(data.targetObject, v => { data.targetObject = v; cellData.set(cellIndex, data); })));
  root.appendChild(makeTargetModeSelect(data, cellIndex));

  const modeRow = makeCheckbox('Use variable', data.useVariable, v => {
    data.useVariable = v; cellData.set(cellIndex, data);
    showSetTextProperties(cellIndex);
  });
  root.appendChild(modeRow);

  if (data.useVariable) {
    root.appendChild(makePropGroup('Variable:', makeTextInput(data.varName || '', 'score', v => { data.varName = v; cellData.set(cellIndex, data); })));
    root.appendChild(makePropGroup('Prefix:', makeTextInput(data.prefix || '', 'Score: ', v => { data.prefix = v; cellData.set(cellIndex, data); })));
    root.appendChild(makePropGroup('Suffix:', makeTextInput(data.suffix || '', ' pts', v => { data.suffix = v; cellData.set(cellIndex, data); })));
    root.appendChild(makeNote('The text object will display the current value of the variable.'));
  } else {
    root.appendChild(makePropGroup('Value:', makeTextInput(data.value || '', 'Hello!', v => { data.value = v; cellData.set(cellIndex, data); })));
  }
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

function showSetCameraProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { type: 'setCamera', cameraX: 0, cameraY: 0 };
  const root = document.createElement('div');
  root.appendChild(makePropGroup('X:', makeExprInput(data.cameraX ?? 0, '0 or player.posX - 400', v => { data.cameraX = v; cellData.set(cellIndex, data); })));
  root.appendChild(makePropGroup('Y:', makeExprInput(data.cameraY ?? 0, '0 or player.posY - 300', v => { data.cameraY = v; cellData.set(cellIndex, data); })));
  root.appendChild(makeNote('Moves the preview camera viewport. World objects shift; UI text stays fixed.'));
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

function showFollowCameraProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { type: 'followCamera', targetObject: '', offsetX: 0, offsetY: 0 };
  const root = document.createElement('div');
  root.appendChild(makePropGroup('Object:', makeObjectSelect(data.targetObject, v => { data.targetObject = v; cellData.set(cellIndex, data); })));
  root.appendChild(makePropGroup('Offset X:', makeExprInput(data.offsetX ?? 0, '0', v => { data.offsetX = v; cellData.set(cellIndex, data); })));
  root.appendChild(makePropGroup('Offset Y:', makeExprInput(data.offsetY ?? 0, '0', v => { data.offsetY = v; cellData.set(cellIndex, data); })));
  root.appendChild(makeNote('Centers the camera on the target object, plus optional offset.'));
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

function showSetSizeProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { type: 'setSize', targetObject: '', width: 64, height: 64 };
  const root = document.createElement('div');
  root.appendChild(makePropGroup('Object:', makeObjectSelect(data.targetObject, v => { data.targetObject = v; cellData.set(cellIndex, data); })));
  root.appendChild(makeTargetModeSelect(data, cellIndex));
  root.appendChild(makePropGroup('Width:', makeExprInput(data.width ?? 64, '64  or  player.width + 8', v => { data.width = v; cellData.set(cellIndex, data); })));
  root.appendChild(makePropGroup('Height:', makeExprInput(data.height ?? 64, '64  or  player.height + 8', v => { data.height = v; cellData.set(cellIndex, data); })));
  root.appendChild(makeNote('Resizes every object with this name. Width and height accept expressions.'));
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

function showTimerConditionProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { type: 'onTimer', timerName: '', interval: 1.0, reversed: false };
  const root = document.createElement('div');
  root.appendChild(makePropGroup('Name:', makeTextInput(data.timerName || '', 'spawnTimer', v => { data.timerName = v; cellData.set(cellIndex, data); })));
  root.appendChild(makePropGroup('Seconds:', makeNumberInput(data.interval ?? 1.0, 0.05, 60, 0.05, v => { data.interval = v; cellData.set(cellIndex, data); })));
  root.appendChild(makeInvertToggle(data, cellIndex));
  root.appendChild(makeNote('Fires repeatedly every N seconds. Timers with the same name share the same tick.'));
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

function showEdgeConditionProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { type: 'onEdge', targetObject: '', edge: 'any', reversed: false };
  const root = document.createElement('div');
  root.appendChild(makePropGroup('Object:', makeObjectSelect(data.targetObject, v => { data.targetObject = v; cellData.set(cellIndex, data); })));
  root.appendChild(makePropGroup('Edge:', makeSelect(
    [['any','Any Edge'],['left','Left Edge'],['right','Right Edge'],['top','Top Edge'],['bottom','Bottom Edge']],
    data.edge || 'any',
    v => { data.edge = v; cellData.set(cellIndex, data); }
  )));
  root.appendChild(makeInvertToggle(data, cellIndex));
  root.appendChild(makeNote('Detects when an object reaches a canvas boundary.'));
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

function showTriggerOnceProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { type: 'triggerOnce', reversed: false };
  const root = document.createElement('div');
  root.appendChild(makeInvertToggle(data, cellIndex));
  root.appendChild(makeNote('Fires once per preview. If placed next to another condition, it fires once when that neighbor becomes true.'));
  propertiesContent.innerHTML = '';
  propertiesContent.appendChild(root);
}

function showSetVelocityProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { type: 'setVelocity', targetObject: '', velX: 5, velY: 0 };
  const root = document.createElement('div');
  root.appendChild(makePropGroup('Object:', makeObjectSelect(data.targetObject, v => { data.targetObject = v; cellData.set(cellIndex, data); })));
  root.appendChild(makeTargetModeSelect(data, cellIndex));
  root.appendChild(makePropGroup('X:', makeExprInput(data.velX ?? 5, '5 or speed', v => { data.velX = v; cellData.set(cellIndex, data); })));
  root.appendChild(makePropGroup('Y:', makeExprInput(data.velY ?? 0, '0 or -jump', v => { data.velY = v; cellData.set(cellIndex, data); })));
  root.appendChild(makeNote('Directly assigns vel.x and vel.y. Accepts expressions like "speed * 2".'));
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

function showSpawnObjectProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { type: 'spawnObject', sourceObject: '', spawnX: 400, spawnY: 300 };
  const root = document.createElement('div');
  root.appendChild(makePropGroup('Object:', makeObjectSelect(data.sourceObject, v => { data.sourceObject = v; cellData.set(cellIndex, data); })));
  root.appendChild(makePropGroup('X:', makeExprInput(data.spawnX ?? 400, '400 or player.posX', v => { data.spawnX = v; cellData.set(cellIndex, data); })));
  root.appendChild(makePropGroup('Y:', makeExprInput(data.spawnY ?? 300, '300 or player.posY', v => { data.spawnY = v; cellData.set(cellIndex, data); })));
  root.appendChild(makeNote('Spawn position can be an expression like "player.posX + 20".'));
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

function showRotateObjectProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { type: 'rotateObject', targetObject: '', angle: 90, mode: 'add' };
  const root = document.createElement('div');
  root.appendChild(makePropGroup('Object:', makeObjectSelect(data.targetObject, v => { data.targetObject = v; cellData.set(cellIndex, data); })));
  root.appendChild(makeTargetModeSelect(data, cellIndex));
  root.appendChild(makePropGroup('Angle:', makeExprInput(data.angle ?? 90, '2 or speed', v => { data.angle = v; cellData.set(cellIndex, data); })));
  root.appendChild(makePropGroup('Mode:', makeSelect(
    [['add','Add'],['set','Set']],
    data.mode || 'add',
    v => { data.mode = v; cellData.set(cellIndex, data); }
  )));
  root.appendChild(makeNote('Use small angle values (1–5) per frame for a smooth spin effect.'));
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

function showRandomVariableProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { type: 'randomVariable', varName: 'score', min: 0, max: 10, round: true };
  const root = document.createElement('div');
  root.appendChild(makePropGroup('Variable:', makeTextInput(data.varName, 'score', v => { data.varName = v; cellData.set(cellIndex, data); })));
  root.appendChild(makePropGroup('Min:', makeExprInput(data.min ?? 0, '0  or  score', v => { data.min = v; cellData.set(cellIndex, data); })));
  root.appendChild(makePropGroup('Max:', makeExprInput(data.max ?? 10, '10  or  score * 2', v => { data.max = v; cellData.set(cellIndex, data); })));
  root.appendChild(makeCheckbox('Round to integer', data.round ?? true, v => { data.round = v; cellData.set(cellIndex, data); }));
  root.appendChild(makeNote('Sets variable to Random.range(min, max). Min/Max can be expressions.'));
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

function showOverlapConditionProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { type: 'overlapTouch', object1: '', object2: '', tolerance: 4, reversed: false };
  const root = document.createElement('div');
  root.appendChild(makePropGroup('Object A:', makeObjectSelect(data.object1, v => { data.object1 = v; cellData.set(cellIndex, data); })));
  root.appendChild(makePropGroup('Object B:', makeObjectSelect(data.object2, v => { data.object2 = v; cellData.set(cellIndex, data); })));
  root.appendChild(makePropGroup('Touch distance:', makeNumberInput(data.tolerance ?? 4, 0, 32, 1, v => { data.tolerance = v; cellData.set(cellIndex, data); })));
  root.appendChild(makeInvertToggle(data, cellIndex));
  root.appendChild(makeNote('Tolerance expands the hitbox so resting objects (e.g. standing on ground) still count as touching. 4px works well for most cases.'));
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

function showForceTowardProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { type: 'forceToward', targetObject: '', sourceObject: '', speed: 3, mode: 'add' };
  const root = document.createElement('div');
  root.appendChild(makePropGroup('Object:', makeObjectSelect(data.targetObject, v => { data.targetObject = v; cellData.set(cellIndex, data); })));
  root.appendChild(makeTargetModeSelect(data, cellIndex));
  root.appendChild(makePropGroup('Toward:', makeObjectSelect(data.sourceObject, v => { data.sourceObject = v; cellData.set(cellIndex, data); })));
  root.appendChild(makePropGroup('Speed:', makeExprInput(data.speed ?? 3, '3 or enemySpeed', v => { data.speed = v; cellData.set(cellIndex, data); })));
  root.appendChild(makePropGroup('Mode:', makeSelect(
    [['add','Instant force'],['set','Permanent speed']],
    data.mode || 'add',
    v => { data.mode = v; cellData.set(cellIndex, data); }
  )));
  root.appendChild(makeNote('Physics objects with gravity keep vertical gravity. If the target is higher and the object is grounded, Hydra gives a jump impulse instead of flying upward.'));
  propertiesContent.innerHTML = ''; propertiesContent.appendChild(root);
}

// P5-3 slice b — the dynamic argument editor for Call Function.
// The panel shows the Function picker, then exactly one argument
// field per parameter of the picked function, labeled with the
// parameter name (so a call to add(a, b) shows "a" and "b", not
// "Argument 1" and "Argument 2"). Picking a different function
// rebuilds the panel so the fields match the new function's
// parameters; values already typed into arg1..arg8 stay on the
// block and reappear when a function with that many parameters is
// picked again. A function with no parameters shows a note instead
// of argument fields, and a blank or missing name says so plainly.
// The hints use a bare .prop-note paragraph (not makeNote, which
// hides behind the property-help flag) because they are state, not
// help text.
function showCallFunctionProperties(cellIndex, block, data, root) {
  const fnField = (block.fields || []).find(f => f.key === 'functionName');
  const fnInput = makeCatalogFieldInput(fnField, data, cellIndex, block);
  if (fnInput && typeof fnInput.addEventListener === 'function') {
    // makeSelect's own change listener (which stores the new name)
    // was attached first, so it runs before this rebuild.
    fnInput.addEventListener('change', () => showCatalogBlockProperties(cellIndex, block));
  }
  root.appendChild(makePropGroup('Function', fnInput));
  const F = window.HydraFunctions;
  const fns = (typeof getMutableFunctions === 'function' ? getMutableFunctions() : null) || [];
  const fnName = String(data.functionName || '').trim();
  const fn = (F && fnName) ? F.findFunction(fns, fnName) : null;
  const hint = (text) => {
    const p = document.createElement('p');
    p.className = 'prop-note';
    p.textContent = text;
    root.appendChild(p);
  };
  if (!fnName) {
    hint('Pick a function first — one argument field appears per parameter, labeled with the parameter name.');
  } else if (!fn) {
    hint(`There is no function named "${fnName}" — create it in the Functions tab first.`);
  } else if (!fn.params.length) {
    hint(`"${fn.name}" takes no arguments.`);
  } else {
    fn.params.forEach((param, i) => {
      const key = 'arg' + (i + 1);
      root.appendChild(makePropGroup(param, makeExprInput(
        data[key] ?? '', 'value for ' + param,
        v => { data[key] = v; cellData.set(cellIndex, data); }
      )));
    });
  }
  const storeField = (block.fields || []).find(f => f.key === 'storeVarName');
  if (storeField) {
    root.appendChild(makePropGroup(storeField.label, makeCatalogFieldInput(storeField, data, cellIndex, block)));
  }
  if (block.note) root.appendChild(makeNote(block.note));
}

function showCatalogBlockProperties(cellIndex, block) {
  const data = cellData.get(cellIndex) || cloneData(block.defaults || { type: block.runtimeType });
  const root = document.createElement('div');
  // P5-3 slice b (dynamic argument editor): a Call Function block
  // shows one argument field per parameter of the function it names,
  // labeled with the parameter name — not the catalog's eight fixed
  // Argument 1..8 fields. The panel is built by its own function.
  if (block.blockType === 'call-function') {
    showCallFunctionProperties(cellIndex, block, data, root);
    propertiesContent.innerHTML = '';
    propertiesContent.appendChild(root);
    return;
  }
  // Trigger mode (HydraFlow): conditions can fire once on false->true (edge)
  // or every frame while true (level). Shown for condition blocks.
  if (block.kind === 'condition' && typeof HydraFlow !== 'undefined') {
    const mode = HydraFlow.triggerModeOf(data);
    const modeSelect = makeSelect(
      [['edge', 'On become true (once)'], ['level', 'While true (every frame)']],
      mode,
      v => { data.triggerMode = v; cellData.set(cellIndex, data); markProjectDirty(); }
    );
    root.appendChild(makePropGroup('Trigger', modeSelect));
    const hint = document.createElement('p');
    hint.className = 'prop-note';
    hint.textContent = 'Edge: fires once when the condition becomes true. Level: fires every frame while true.';
    root.appendChild(hint);
  }
  (block.fields || []).forEach(field => {
    const input = makeCatalogFieldInput(field, data, cellIndex, block);
    root.appendChild(field.control === 'checkbox' || field.key === 'reversed' ? input : makePropGroup(field.label, input));
  });
  const hasPrimaryObjectTarget = block.kind === 'action' && (block.fields || []).some(field => field.key === 'targetObject');
  if (hasPrimaryObjectTarget) {
    root.appendChild(makeTargetModeSelect(data, cellIndex));
  }
  if (!(block.fields || []).length) {
    // A settings-free block has nothing else to show, so its note
    // always renders here — makeNote hides help text behind the help
    // flag, which would leave the panel blank (caught in cycle 11
    // visual QA on Enable Joystick).
    const note = document.createElement('p');
    note.className = 'prop-note';
    note.textContent = block.note || `${block.label} has no editable settings.`;
    root.appendChild(note);
  } else if (block.note) {
    root.appendChild(makeNote(block.note));
  }
  propertiesContent.innerHTML = '';
  propertiesContent.appendChild(root);
}

function setCatalogFieldValue(data, cellIndex, field, value, block) {
  const defaultValue = block.defaults?.[field.key];
  if (typeof defaultValue === 'boolean') value = value === true || value === 'true';
  data[field.key] = value;
  cellData.set(cellIndex, data);
}

function makeCatalogFieldInput(field, data, cellIndex, block) {
  const value = data[field.key] ?? block.defaults?.[field.key] ?? '';
  const onChange = v => setCatalogFieldValue(data, cellIndex, field, v, block);
  if (field.key === 'reversed') {
    return makeCheckbox('Invert condition', Boolean(value), onChange);
  }
  switch (field.control) {
    case 'object':
      return makeObjectSelect(value, onChange, Boolean(field.includeAll), true);
    case 'action':
      return makeActionSelect(value, onChange);
    case 'audio':
      return makeAudioAssetSelect(value, onChange);
    case 'expr':
      return makeExprInput(value, field.placeholder || '', onChange);
    case 'number':
      return makeNumberInput(value, field.min ?? -999999, field.max ?? 999999, field.step ?? 1, onChange);
    case 'checkbox':
      return makeCheckbox(field.label, Boolean(value), onChange);
    case 'color':
      return makeColorInput(value, onChange);
    case 'select':
      return makeSelect(field.options || [], value, onChange);
    case 'scene': {
      const sceneOpts = (typeof scenes !== 'undefined' ? scenes : [])
        .map(s => [String(s.id), s.name || `Scene ${s.id}`]);
      if (!sceneOpts.length) sceneOpts.push(['', '(No scenes yet)']);
      return makeSelect(sceneOpts, value == null ? '' : String(value), v => onChange(v === '' ? null : Number(v)));
    }
    case 'function': {
      // P5-3: the Function picker lists the project's functions by
      // name (with their parameters, so a call shows what it takes);
      // the block stores the name, and renaming a function rewrites
      // every Call Function block that names it (see the Functions
      // panel's rename path).
      const fnOpts = (typeof getMutableFunctions === 'function' ? getMutableFunctions() : null) || [];
      const opts = fnOpts.map(f => [f.name, f.name + (f.params && f.params.length ? ' (' + f.params.join(', ') + ')' : ' (no parameters)')]);
      if (!opts.length) opts.push(['', '(No functions yet — add one in the Functions tab)']);
      return makeSelect(opts, value == null ? '' : String(value), onChange);
    }
    case 'text':
    default:
      return makeTextInput(value, field.placeholder || '', onChange);
    case 'textarea':
      return makeTextareaInput(value, field.placeholder || '', field.rows || 4, onChange);
  }
}

// ============================================================
// CLEAR GRID
// ============================================================
clearButton.addEventListener('click', () => {
  if (!confirm('Clear the current script grid?')) return;
  cells.forEach(cell => {
    cell.classList.remove(...ALL_BLOCK_CLASSES, 'selected', 'triggered');
    delete cell.dataset.blockType;
    clearBlockVisualFromCell(cell);
  });
  cellData.clear();
  clearSelectedCell();
  showDefaultPropertiesPanel();
  commitActiveGrid();
});

// Grid keyboard nav
const SCROLL_AMOUNT = 100;
document.addEventListener('keydown', e => {
  if (!document.getElementById('script-tab').classList.contains('active')) return;
  if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) return;
  switch (e.key) {
    case 'ArrowUp':    gridContainer.scrollBy(0, -SCROLL_AMOUNT); e.preventDefault(); break;
    case 'ArrowDown':  gridContainer.scrollBy(0,  SCROLL_AMOUNT); e.preventDefault(); break;
    case 'ArrowLeft':  gridContainer.scrollBy(-SCROLL_AMOUNT, 0); e.preventDefault(); break;
    case 'ArrowRight': gridContainer.scrollBy( SCROLL_AMOUNT, 0); e.preventDefault(); break;
    case 'Delete': case 'Backspace':
      if (selectedCell?.dataset.blockType) { if (e.key === 'Backspace') e.preventDefault(); deleteSelectedBlock(); }
      break;
  }
});

// ============================================================
// PHYSICS
// ============================================================
const DEFAULT_PHYSICS = { gravity: 0, friction: 0.82, bounciness: 0.4, maxSpeed: 25 };

function getPhysics(obj) {
  return {
    gravity:    obj.physics?.gravity    ?? DEFAULT_PHYSICS.gravity,
    friction:   obj.physics?.friction   ?? DEFAULT_PHYSICS.friction,
    bounciness: obj.physics?.bounciness ?? DEFAULT_PHYSICS.bounciness,
    maxSpeed:   obj.physics?.maxSpeed   ?? DEFAULT_PHYSICS.maxSpeed,
  };
}
function ensurePhysics(obj) { if (obj.velX === undefined) obj.velX = 0; if (obj.velY === undefined) obj.velY = 0; }
function clamp(v, a, b)     { return Math.max(a, Math.min(b, v)); }

function getHitbox(obj) {
  const width = Number(obj.hitboxWidth) > 0 ? Number(obj.hitboxWidth) : (obj.width || 1);
  const height = Number(obj.hitboxHeight) > 0 ? Number(obj.hitboxHeight) : (obj.height || 1);
  return {
    x: (obj.posX || 0) + (Number(obj.hitboxOffsetX) || 0),
    y: (obj.posY || 0) + (Number(obj.hitboxOffsetY) || 0),
    width,
    height
  };
}

// ============================================================
// COLLISION
// ============================================================
function getAABBOverlap(a, b) {
  const ab = getHitbox(a);
  const bb = getHitbox(b);
  const dx = (ab.x + ab.width/2) - (bb.x + bb.width/2);
  const dy = (ab.y + ab.height/2) - (bb.y + bb.height/2);
  const ox = (ab.width/2 + bb.width/2)   - Math.abs(dx);
  const oy = (ab.height/2 + bb.height/2) - Math.abs(dy);
  if (ox <= 0 || oy <= 0) return null;
  return ox < oy ? { nx: Math.sign(dx), ny: 0, depth: ox } : { nx: 0, ny: Math.sign(dy), depth: oy };
}

function compareValues(left, operator, right) {
  switch (operator) {
    case '>=': return left >= right;
    case '<=': return left <= right;
    case '==': return left == right;
    case '!=': return left != right;
    case '>':  return left > right;
    case '<':  return left < right;
    default:   return false;
  }
}

// ============================================================
// EXPRESSION EVALUATOR — GDevelop-style runtime formula eval
// Supports: numbers, game vars, object.prop, math expressions
// Examples: "5"  "score"  "score + 10"  "player.posX * 2"  "Math.floor(score/3)"
// ============================================================
function evalExpr(exprStr) {
  return evalExprInfo(exprStr).value;
}

function evalExprInfo(exprStr) {
  // Delegates to the shared pure evaluator (hydra-expr.js) — the same logic
  // the exported player runtime uses, so preview and export agree.
  const HX = window.HydraExpr;
  if (!HX || typeof HX.evaluate !== 'function') {
    window.HydraUniversal?.pushDiagnostic?.('error', 'Expression evaluator (hydra-expr.js) is not loaded. Reload the editor.');
    return { value: 0, ok: false, unknowns: [] };
  }
  let alive = [];
  try { alive = previewState.objects.filter(o => !destroyedObjects.has(o.id) && !pendingDestroy.has(o.id)); } catch (err) { alive = []; }
  let scene = null;
  try { scene = getPreviewScene(); } catch (err) { scene = null; }
  return HX.evaluate(exprStr, {
    lookupObject: (name) => getObjectsByName(name, alive)[0] || null,
    builtins: {
      mouseX: previewState.mouse?.x ?? 0,
      mouseY: previewState.mouse?.y ?? 0,
      // P4 item 37 batch 5 (camera): screen pixels shrink by the zoom factor.
      mouseWorldX: (previewState.mouse?.x ?? 0) / previewCameraZoom() + (previewState.camera?.x || 0),
      mouseWorldY: (previewState.mouse?.y ?? 0) / previewCameraZoom() + (previewState.camera?.y || 0),
      canvasWidth: canvas?.width ?? 0,
      canvasHeight: canvas?.height ?? 0,
      viewportWidth: getSceneViewportWidth(scene),
      viewportHeight: getSceneViewportHeight(scene),
      sceneWidth: getSceneWorldWidth(scene),
      sceneHeight: getSceneWorldHeight(scene),
      worldWidth: getSceneWorldWidth(scene),
      worldHeight: getSceneWorldHeight(scene),
      cameraX: previewState.camera?.x || 0,
      cameraY: previewState.camera?.y || 0,
      cameraZoom: previewCameraZoom(),
      dt: previewState.dt ?? 1
    },
    variables: gameVariables,
    onWarning: (msg) => window.HydraUniversal?.pushDiagnostic?.('warning', msg, { expression: String(exprStr) })
  });
}

// P2 item 14 slice 7: the subsystem hook builders (collectionHooks,
// mathHooks, pickHooks, layerFxActionHooks, layerFxConditionHooks,
// scriptApiHooks, threeDActionHooks, threeDConditionHooks) and the
// timer-record helpers (getTimerRecord, resetNamedTimer,
// setNamedTimerPaused) live in HydraPreviewRuntime now; they are only
// ever called from the condition/action contexts, which moved with them.

// Scan all grid scopes to collect declared variable names (for suggestions)
function getKnownVariableNames() {
  const names = new Set();
  const scan = gd => Object.values(gd || {}).forEach(d => {
    if (d && d.varName && ['setVariable','getVariable','randomVariable'].includes(d.type)) names.add(d.varName);
  });
  scan(globalGridData);
  scenes.forEach(s => scan(s.gridData));
  cellData.forEach(d => { if (d && d.varName) names.add(d.varName); });
  return [...names];
}

// ============================================================
// EXPRESSION INPUT — text field with live variable/property suggestions
// ============================================================
function makeExprInput(value, placeholder, onChange) { return HydraPropInputs.makeExprInput(value, placeholder, onChange); }

// ============================================================
// AUDIO ENGINE
// ============================================================
let audioCtx = null;
function getAudioCtx() { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); return audioCtx; }
const soundCooldowns = new Map();
const cameraShakeCooldowns = new Map();

// ============================================================
// TIMER & EDGE STATE
// ============================================================
const timerStates = new Map(); // timerKey -> { lastFiredTime, paused, firedFrame }
const previewSceneStack = []; // push/pop scene stack for the preview run (reset on a fresh run, never on a scene switch)

// ============================================================
// AUDIO BUSES (P4 item 30) — playback helpers for the preview runtime.
// Music streams through an <audio> element (never decoded into memory);
// SFX/UI assets are decoded once into an AudioBuffer and kept
// memory-resident; tones go through an oscillator. Voice accounting comes
// from HydraAudioBuses so the polyphony limits are honored.
// ============================================================
const sfxBufferCache = new Map(); // dataUrl -> AudioBuffer (memory-resident SFX/UI)

function busReleaseOnce(releaseFn) {
  let released = false;
  return () => { if (!released) { released = true; try { releaseFn(); } catch (e) {} } };
}

// Every live sound registers a stopper so the Stop All Sounds block can
// silence ringing SFX/UI voices (music elements are tracked separately).
function registerPreviewSoundStopper(stopper) {
  try {
    previewState.liveSoundStoppers = previewState.liveSoundStoppers || [];
    previewState.liveSoundStoppers.push(stopper);
  } catch (e) {}
}

function playToneBuffer(data, volume, pitch, onDone, pan) {
  const done = busReleaseOnce(onDone);
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = data.waveform || 'square';
    osc.frequency.setValueAtTime((data.frequency || 440) * pitch, ctx.currentTime);
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    const dur = data.duration || 0.2;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    const panner = previewPanner(ctx, pan);
    osc.connect(gain);
    if (panner) { gain.connect(panner); panner.connect(ctx.destination); }
    else gain.connect(ctx.destination);
    try { osc.onended = done; } catch (e) {}
    osc.start(); osc.stop(ctx.currentTime + dur);
    registerPreviewSoundStopper({ stop() { try { osc.stop(); } catch (e) {} } });
    setTimeout(done, dur * 1000 + 50); // belt-and-braces: always free the voice
  } catch (e) { done(); }
}

// P4 Advanced batch 17 (positional audio): a StereoPannerNode for one
// positioned sound, or null when there is nothing to pan (pan 0 is
// centered, and an old browser without createStereoPanner just plays
// centered). The caller wires gain -> panner -> destination, or gain
// -> destination when this returns null.
function previewPanner(ctx, rawPan) {
  try {
    const SA = window.HydraSpatialAudio;
    const pan = SA ? SA.normalizePan(rawPan) : 0;
    if (!pan) return null;
    if (!ctx || typeof ctx.createStereoPanner !== 'function') return null;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    return panner;
  } catch (e) { return null; }
}

function playSfxBuffer(dataUrl, volume, pitch, onDone, pan) {
  const done = busReleaseOnce(onDone);
  const playBuf = (buf) => {
    try {
      const ctx = getAudioCtx();
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = pitch;
      const gain = ctx.createGain();
      gain.gain.value = volume;
      const panner = previewPanner(ctx, pan);
      src.connect(gain);
      if (panner) { gain.connect(panner); panner.connect(ctx.destination); }
      else gain.connect(ctx.destination);
      try { src.onended = done; } catch (e) {}
      src.start();
      registerPreviewSoundStopper({ stop() { try { src.stop(); } catch (e) {} } });
      setTimeout(done, 60000); // safety: never leak a voice on a stuck source
    } catch (e) { done(); }
  };
  try {
    const cached = sfxBufferCache.get(dataUrl);
    if (cached) { playBuf(cached); return; }
    const B = window.HydraAudioBuses;
    const bytes = B ? B.decodeDataUrl(dataUrl) : null;
    if (!bytes) {
      // Not a base64 data URL: fall back to element playback (the old path).
      const el = new Audio(dataUrl);
      el.volume = volume; el.playbackRate = pitch;
      el.addEventListener('ended', done);
      const playResult = el.play();
      if (playResult && typeof playResult.catch === 'function') playResult.catch(() => {});
      registerPreviewSoundStopper({ stop() { try { el.pause(); } catch (e) {} } });
      setTimeout(done, 60000);
      return;
    }
    getAudioCtx().decodeAudioData(bytes.buffer, (buf) => {
      if (buf) { sfxBufferCache.set(dataUrl, buf); playBuf(buf); } else done();
    }, () => done());
  } catch (e) { done(); }
}

// Stops every track on the Music bus and frees their voices.
function stopPreviewMusic() {
  try {
    const els = previewState.musicElements || [];
    previewState.musicElements = [];
    els.forEach(el => { try { el.pause(); } catch (e) {} });
    previewState.musicPaused = false;
    const B = window.HydraAudioBuses;
    if (B && previewState.busVoices) {
      while (previewState.busVoices.counts.music > 0) B.release(previewState.busVoices, 'music');
    }
  } catch (e) {}
}

// P4 item 37 batch 3: pause/resume keep the track's position (element-only;
// a tone played on the music bus cannot pause, so it keeps playing).
function pausePreviewMusic() {
  try {
    (previewState.musicElements || []).forEach(el => { try { el.pause(); } catch (e) {} });
    previewState.musicPaused = true;
  } catch (e) {}
}

function resumePreviewMusic() {
  try {
    (previewState.musicElements || []).forEach(el => {
      try {
        const r = el.play();
        if (r && typeof r.catch === 'function') r.catch(() => {});
      } catch (e) {}
    });
    previewState.musicPaused = false;
  } catch (e) {}
}

// P4 item 37 batch 3: silences everything — the music track plus every live
// SFX/UI voice — and frees all voices at once.
function stopAllPreviewSounds() {
  stopPreviewMusic();
  try {
    const stoppers = previewState.liveSoundStoppers || [];
    previewState.liveSoundStoppers = [];
    stoppers.forEach(s => { try { s.stop(); } catch (e) {} });
    const B = window.HydraAudioBuses;
    if (B && previewState.busVoices) B.releaseAll(previewState.busVoices);
  } catch (e) {}
}

// Project-level bus mix for the preview (the Audio tab edits
// project.audioBuses; normalizeBuses repairs corrupt data).
function getPreviewBuses() {
  const project = window.projectManager?.getCurrentProject?.();
  const B = window.HydraAudioBuses;
  return B ? B.normalizeBuses(project ? project.audioBuses : null) : null;
}

// P2 item 14 slice 8: the project's master fader for a fresh preview run
// (the Audio tab edits project.masterVolume); the run lifecycle reads it
// through the host instead of reaching into projectManager itself.
function getProjectMasterVolume() {
  const project = window.projectManager?.getCurrentProject?.();
  return project ? project.masterVolume : 1;
}

// P4 Advanced (localization): the project's string table, normalized in
// place (mirrors getMutableInputActions); the run's current language
// lives on previewState.language and survives scene switches.
function getPreviewLocalization() {
  const project = window.projectManager?.getCurrentProject?.();
  const L = window.HydraLocalization;
  if (!project || !L) return null;
  project.localization = L.normalizeLocalization(project.localization);
  return project.localization;
}

function getPreviewLanguage() {
  const L = window.HydraLocalization;
  if (previewState.language) return previewState.language;
  const loc = getPreviewLocalization();
  return (L && loc) ? L.defaultLanguageOf(loc) : 'en';
}

// P4 Advanced batch 7 (dialogue): the project's conversation table,
// normalized in place (mirrors getPreviewLocalization); the per-run
// dialogue runtime itself lives in the preview runtime module and is
// reset on a fresh run, ended on every scene load.
function getProjectDialogues() {
  const project = window.projectManager?.getCurrentProject?.();
  const D = window.HydraDialogue;
  if (!project || !D) return null;
  project.dialogues = D.normalizeDialogues(project.dialogues);
  return project.dialogues;
}

// P4 Advanced batch 8 (inventory): the project's item table,
// normalized in place (mirrors getProjectDialogues); the per-run
// backpack runtime itself lives in the preview runtime module and is
// reset on a fresh run, surviving scene switches inside the run.
function getProjectItems() {
  const project = window.projectManager?.getCurrentProject?.();
  const I = window.HydraInventory;
  if (!project || !I) return null;
  project.items = I.normalizeItems(project.items);
  return project.items;
}

// P4 Advanced batch 9 (quests): the project's quest table,
// normalized in place (mirrors getProjectDialogues); the per-run
// quest-log runtime itself lives in the preview runtime module and is
// reset on a fresh run, surviving scene switches inside the run.
function getProjectQuests() {
  const project = window.projectManager?.getCurrentProject?.();
  const Q = window.HydraQuest;
  if (!project || !Q) return null;
  project.quests = Q.normalizeQuests(project.quests);
  return project.quests;
}

// P4 Advanced batch 10 (achievements): the project's achievement
// table, normalized in place (mirrors getProjectQuests); the unlocked
// set itself lives in the preview runtime module and persists in
// storage across runs, surviving scene switches and restarts.
function getProjectAchievements() {
  const project = window.projectManager?.getCurrentProject?.();
  const A = window.HydraAchievement;
  if (!project || !A) return null;
  project.achievements = A.normalizeAchievements(project.achievements);
  return project.achievements;
}

// P4 Advanced batch 11 (cutscenes): the project's cutscene table,
// normalized in place (mirrors getProjectAchievements); the per-run
// cutscene runtime itself lives in the preview runtime module and is
// reset on a fresh run, surviving scene switches inside the run.
function getProjectCutscenes() {
  const project = window.projectManager?.getCurrentProject?.();
  const C = window.HydraCutscene;
  if (!project || !C) return null;
  project.cutscenes = C.normalizeCutscenes(project.cutscenes);
  return project.cutscenes;
}

// P4 Advanced batch 12 (high scores): the project's table config,
// normalized in place (mirrors getProjectCutscenes); the ranked table
// itself lives in the preview runtime module and persists in storage
// across runs, surviving scene switches and restarts.
function getProjectHighScores() {
  const project = window.projectManager?.getCurrentProject?.();
  const H = window.HydraHighScore;
  if (!project || !H) return null;
  project.highScores = H.normalizeHighScoreConfig(project.highScores);
  return project.highScores;
}

// The same config object the High Scores tab edits (normalized in
// place, so the tab holds the live record while it renders).
function getMutableHighScoreConfig() {
  const project = window.projectManager?.getCurrentProject?.();
  if (!project) return null;
  const H = window.HydraHighScore;
  project.highScores = H
    ? H.normalizeHighScoreConfig(project.highScores)
    : (project.highScores && typeof project.highScores === 'object' && !Array.isArray(project.highScores)
      ? project.highScores : { maxEntries: 10, defaultName: 'Player' });
  return project.highScores;
}

function getProjectTransitionConfig() {
  const project = window.projectManager?.getCurrentProject?.();
  const T = window.HydraTransition;
  if (!project || !T) return null;
  project.sceneTransition = T.normalizeTransitionConfig(project.sceneTransition);
  return project.sceneTransition;
}

// P4 Advanced batch 20 (virtual joystick): the project's stick
// config, normalized in place (mirrors getProjectTransitionConfig);
// the live stick itself lives in the preview runtime module (and
// in the exported runtime's state) and starts enabled from here.
function getProjectJoystickConfig() {
  const project = window.projectManager?.getCurrentProject?.();
  const J = window.HydraJoystick;
  if (!project || !J) return null;
  project.virtualJoystick = J.normalizeJoystickConfig(project.virtualJoystick);
  return project.virtualJoystick;
}

// The same config object the Joystick tab edits (normalized in
// place, so the tab holds the live record while it renders).
function getMutableJoystickConfig() {
  const project = window.projectManager?.getCurrentProject?.();
  if (!project) return null;
  const J = window.HydraJoystick;
  project.virtualJoystick = J
    ? J.normalizeJoystickConfig(project.virtualJoystick)
    : (project.virtualJoystick && typeof project.virtualJoystick === 'object' && !Array.isArray(project.virtualJoystick)
      ? project.virtualJoystick : { enabled: false, anchor: 'bottom-left', x: 120, y: 480, radius: 60, knobRadius: 24, deadzone: 0.15, varX: 'joystickX', varY: 'joystickY', actionLeft: '', actionRight: '', actionUp: '', actionDown: '' });
  return project.virtualJoystick;
}

// The same config object the Transitions tab edits (normalized in
// place, so the tab holds the live record while it renders).
function getMutableTransitionConfig() {
  const project = window.projectManager?.getCurrentProject?.();
  if (!project) return null;
  const T = window.HydraTransition;
  project.sceneTransition = T
    ? T.normalizeTransitionConfig(project.sceneTransition)
    : (project.sceneTransition && typeof project.sceneTransition === 'object' && !Array.isArray(project.sceneTransition)
      ? project.sceneTransition : { effect: 'fade', duration: 0.5 });
  return project.sceneTransition;
}

// The current project's stable id, for per-game storage keys (the
// achievement store is keyed by project id so two games never share
// a trophy case). Empty when no project is open.
function getProjectId() {
  const project = window.projectManager?.getCurrentProject?.();
  return project && project.id ? String(project.id) : '';
}

// Re-apply every bound text object in the run's current language (the
// Set Language follow-through, mirrors the exported runtime).
function applyPreviewBoundTexts() {
  const L = window.HydraLocalization;
  if (!L) return;
  const loc = getPreviewLocalization();
  const lang = getPreviewLanguage();
  getAlivePreviewObjects().forEach(o => {
    const bound = L.boundTextFor(o, loc, lang);
    if (bound !== null) o._runtimeText = bound;
  });
}

function playSound(data, cooldownKey) {
  if (cooldownKey) {
    const now = Date.now();
    if (now - (soundCooldowns.get(cooldownKey) || 0) < 100) return;
    soundCooldowns.set(cooldownKey, now);
  }
  try {
    const B = window.HydraAudioBuses;
    const audio = window.HydraAudio;
    const busId = B ? B.normalizeBusId(data.bus) : 'sfx';
    const busCfg = previewState.buses || getPreviewBuses();
    if (B && !previewState.buses) previewState.buses = busCfg;
    const soundVol = audio ? audio.normalizeVolume(data.volume) : (data.volume || 0.3);
    if (previewState.masterVolume === undefined && B) {
      const project = window.projectManager?.getCurrentProject?.();
      previewState.masterVolume = B.normalizeMasterVolume(project ? project.masterVolume : 1);
    }
    const volume = B && busCfg ? B.effectiveVolume(busCfg, busId, soundVol, previewState.masterVolume) : soundVol;
    if (volume <= 0) return; // muted bus (or bus at 0): stay silent, take no voice
    const pitch = B ? B.normalizePitch(data.pitch) : 1;
    const loop = data.loop === undefined ? busId === 'music' : !!data.loop;
    const source = audio ? audio.resolveSoundSource(assetLibrary, data) : { kind: 'tone' };
    if (B && !previewState.busVoices) previewState.busVoices = B.createVoices(busCfg);
    const voices = previewState.busVoices;
    if (busId === 'music') {
      // Music bus: one voice; a new track replaces the running one.
      stopPreviewMusic();
      if (B && !B.tryAcquire(voices, 'music')) return;
      previewState.musicPaused = false;
      const releaseMusic = busReleaseOnce(() => { if (B) B.release(voices, 'music'); });
      if (source.kind === 'asset') {
        const el = new Audio(source.dataUrl);
        el.volume = volume; el.playbackRate = pitch; el.loop = loop;
        el.addEventListener('ended', releaseMusic);
        (previewState.musicElements = previewState.musicElements || []).push(el);
        const playResult = el.play();
        if (playResult && typeof playResult.catch === 'function') playResult.catch(() => {});
      } else {
        // P4 Advanced batch 17: a positioned tone on the music bus
        // still pans (the graph path); a streamed asset above does
        // not — an <audio> element has no panner node.
        playToneBuffer(data, volume, pitch, releaseMusic, data.pan);
      }
      return;
    }
    if (B && !B.tryAcquire(voices, busId)) return; // polyphony cap: drop the sound
    const releaseVoice = busReleaseOnce(() => { if (B) B.release(voices, busId); });
    if (source.kind === 'asset') playSfxBuffer(source.dataUrl, volume, pitch, releaseVoice, data.pan);
    else playToneBuffer(data, volume, pitch, releaseVoice, data.pan);
  } catch(e) {}
}

// ============================================================
// CANVAS / PREVIEW SETUP
// ============================================================
// P1 item 16: same fallback as #grid above — a missing canvas must not
// throw inside getContext() and take the whole editor script down.
const canvas  = document.getElementById('game-canvas') || fallbackElement('game-canvas', 'canvas');
const ctx     = canvas.getContext('2d');

// Cached images for preview
const imageCache = {};
function getImage(assetId) {
  if (!assetId || !assetLibrary[assetId]) return null;
  if (imageCache[assetId]) return imageCache[assetId];
  const img = new Image();
  img.src = assetLibrary[assetId].dataUrl;
  imageCache[assetId] = img;
  return img;
}

// P2 item 14 slice 5: the preview toolbar (device frames, Profiler /
// Trace buttons, trace feed, canvas resize) lives in the DOM module
// hydra-previewtoolbar.js. script.js only configures it with live
// editor state and keeps thin delegations (resizeGameCanvas /
// renderTraceFeed) so existing call sites are unchanged. The device
// choice stays session state, never saved into project JSON, and the
// frame stays display-only: the game still renders at the scene
// viewport resolution.
if (window.HydraPreviewToolbar) {
  window.HydraPreviewToolbar.configure({
    getScene: () => getPreviewScene(),
    getViewportSize: (scene) => ({ width: getSceneViewportWidth(scene), height: getSceneViewportHeight(scene) }),
    clampCamera: (scene) => clampCameraToScene(scene),
    isPreviewTabActive: (doc) => (doc || document).getElementById('preview-tab')?.classList.contains('active'),
    getProfiler: () => previewState.profiler,
    getTrace: () => previewState.trace
  });
  window.HydraPreviewToolbar.initToolbar(document, canvas);
}

// P2 item 14 slice 5: the canvas sizing lives in HydraPreviewToolbar;
// this delegation keeps the launchPreview / loadPreviewScene call sites
// unchanged. A dropped module tag degrades to a canvas that keeps its
// size instead of breaking the editor.
function resizeGameCanvas(sceneOverride = null) {
  if (window.HydraPreviewToolbar) window.HydraPreviewToolbar.resizeGameCanvas(document, canvas, sceneOverride);
}

// ============================================================
// DRAW GAME
// ============================================================
const bgImageCache = {};
function getBgImage(assetId) {
  if (!assetId || !assetLibrary[assetId]) return null;
  if (bgImageCache[assetId]) return bgImageCache[assetId];
  const img = new Image();
  img.src = assetLibrary[assetId].dataUrl;
  bgImageCache[assetId] = img;
  return img;
}

// P2 item 15/12 slice 6: the draw passes live in the shared HydraDraw
// module (hydra-draw.js) — the full frame composition plus the per-kind
// draws, used identically by exported games. drawGame only builds the
// host's view + hooks; the module draws the frame. The call is guarded
// (window.HydraDraw), so a dropped module tag degrades to a canvas that
// keeps its last frame instead of breaking the editor — the same
// guarded-call degradation the other shared modules use. The Profiler /
// Trace toolbar sync lives in HydraPreviewToolbar (called from the
// onFrameEnd hook below) and the showLabel name tags live in the
// drawLabel hook; the button hover/press state is the
// per-frame _uiState updateUiWidgetStates computes in gameLoop.
function drawGame() {
  if (!window.HydraDraw) return;
  window.HydraDraw.drawFrame(ctx, drawGameView(), drawGameHooks());
  // P4 Advanced batch 20 (virtual joystick): the stick paints in
  // screen space above the HUD objects, below the transition
  // overlay — the preview runtime owns the live stick, so the draw
  // reads it through the module's accessor (guarded, like the
  // transition overlay below, so a dropped module tag degrades to
  // no stick). The accessor returns null while no run is active, so
  // the stopped scene view never shows a stick the game is not
  // running.
  try {
    const J = window.HydraJoystick;
    const PR = window.HydraPreviewRuntime;
    if (J && typeof J.drawJoystick === 'function' && PR && typeof PR.joystickRuntimeForDraw === 'function') {
      J.drawJoystick(ctx, PR.joystickRuntimeForDraw(), getProjectJoystickConfig(), canvas.width, canvas.height);
    }
  } catch (e) { /* a throwing stick never breaks the editor */ }
  // P4 Advanced batch 14 (scene transitions): the fade / wipe
  // overlay paints last, in screen space over the whole canvas —
  // the preview runtime owns the live transition, so the overlay
  // reads it through the module's accessor (guarded, like the draw
  // call above, so a dropped module tag degrades to no overlay).
  try {
    const TR = window.HydraTransition;
    const PR = window.HydraPreviewRuntime;
    if (TR && typeof TR.drawTransition === 'function' && PR && typeof PR.transitionRuntime === 'function') {
      TR.drawTransition(ctx, canvas.width, canvas.height, PR.transitionRuntime());
    }
  } catch (e) { /* a throwing overlay never breaks the editor */ }
}

function drawGameView() {
  return {
    scene: getPreviewScene(),
    objects: previewState.objects,
    width: canvas.width,
    height: canvas.height,
    camera: previewState.camera || { x: 0, y: 0 },
    shake: previewState.cameraShake,
    flash: previewState.flash,
    particles: previewState.particles,
    damageNumbers: previewState.damageNumbers,
    combat: previewState.combat,
    profiler: previewState.profiler,
    camera3d: previewState.camera3d,
    hidden: hiddenObjects,
    destroyed: destroyedObjects
  };
}

function drawGameHooks() {
  return {
    ui: window.HydraUi || null, tiles: window.HydraTiles || null,
    anim: window.HydraAnim || null, blendSpace: window.HydraBlendSpace || null,
    skeleton: window.HydraSkeleton || null, layerFx: window.HydraLayerFx || null,
    light2d: window.HydraLight2d || null, threeD: window.Hydra3d || null,
    cameraFx: window.HydraCameraFx || null, particles: window.HydraParticles || null,
    profile: window.HydraProfile || null, parallax: window.HydraParallax || null,
    health: window.HydraHealth || null, damageFx: window.HydraDamageFx || null,
    combat: window.HydraCombat || null,
    // P4 Advanced batch 33 (boss encounters): the boss bar's module,
    // live fight state, and the live boss object (the first alive
    // object with the boss's name, or null when it has not spawned
    // yet — the draw module hides the bar then).
    boss: window.HydraBoss || null,
    bossState: (window.HydraPreviewRuntime && typeof window.HydraPreviewRuntime.bossRuntime === 'function') ? window.HydraPreviewRuntime.bossRuntime() : null,
    bossObject: (name) => {
      try {
        var alive = getAlivePreviewObjects();
        return getObjectsByName(name, alive)[0] || null;
      } catch (e) { return null; }
    },
    // P4 Advanced batch 36 (minimap): the map's module and the live
    // minimap run record (minted per scene load by the preview
    // runtime's scene-reset hook; the draw module reads the boss
    // state above for the red boss dot).
    minimap: window.HydraMinimap || null,
    minimapState: (window.HydraPreviewRuntime && typeof window.HydraPreviewRuntime.minimapState === 'function') ? window.HydraPreviewRuntime.minimapState() : null,
    image: (assetId, isBackground) => isBackground ? getBgImage(assetId) : getImage(assetId),
    modelMesh: (typeof resolveModelMeshFor === 'function') ? resolveModelMeshFor : null,
    getDarkCanvas: () => {
      previewState.darkCanvas = previewState.darkCanvas || document.createElement('canvas');
      return previewState.darkCanvas;
    },
    // Button hover/press state, precomputed once per frame by
    // updateUiWidgetStates in gameLoop.
    buttonState: (obj) => obj._uiState || 'normal',
    // The showLabel name tag under a sprite (preview-only editor
    // affordance; exports never drew it).
    drawLabel: (labelCtx, obj, info) => {
      if (!obj.showLabel || !obj.name) return;
      labelCtx.save();
      // The label sits with its object.
      if (!info.fixed && info.zoom !== 1) labelCtx.scale(info.zoom, info.zoom);
      if (!info.fixed) labelCtx.translate(-info.camX, -info.camY);
      labelCtx.font = '11px sans-serif';
      labelCtx.fillStyle = 'rgba(255,255,255,0.7)';
      labelCtx.textAlign = 'center';
      labelCtx.fillText(obj.name, info.cx, info.cy + 4);
      labelCtx.restore();
    },
    // P2 item 14 slice 5: the Profiler / Trace toolbar sync lives in
    // HydraPreviewToolbar (its onFrameEnd call), so block-driven
    // visibility changes still show the right button state. The
    // showLabel name tags live in the drawLabel hook above.
    onFrameEnd: () => {
      if (window.HydraPreviewToolbar) window.HydraPreviewToolbar.syncToolbarButtons(document);
    }
  };
}

// ============================================================
// GAME LOOP
// ============================================================
// P2 item 14 slice 8: the frame loop / run lifecycle lives in
// HydraPreviewRuntime now; script.js keeps this thin delegation
// so every existing call site is unchanged.
function initGame() {
  if (window.HydraPreviewRuntime) window.HydraPreviewRuntime.initGame();
}

// P2 item 14 slice 8: the frame loop / run lifecycle lives in
// HydraPreviewRuntime now; script.js keeps this thin delegation
// so every existing call site is unchanged.
function gameLoop(timestamp) {
  if (window.HydraPreviewRuntime) window.HydraPreviewRuntime.gameLoop(timestamp);
}
// P2 item 14 slice 8: the frame loop / run lifecycle lives in
// HydraPreviewRuntime now; script.js keeps this thin delegation
// so every existing call site is unchanged.
function updateCameraFollow() {
  if (window.HydraPreviewRuntime) window.HydraPreviewRuntime.updateCameraFollow();
}

// P2 item 14 slice 8: the frame loop / run lifecycle lives in
// HydraPreviewRuntime now; script.js keeps this thin delegation
// so every existing call site is unchanged.
function resetGame() {
  if (window.HydraPreviewRuntime) window.HydraPreviewRuntime.resetGame();
}

// P2 item 14 slice 6: the preview mouse tracking (updateMouse) now
// lives in HydraPreviewRuntime; the canvas handlers in launchPreview
// attach through its attachCanvasInput.

// P2 item 14 slice 8: the frame loop / run lifecycle lives in
// HydraPreviewRuntime now; script.js keeps this thin delegation
// so every existing call site is unchanged.
function launchPreview() {
  if (window.HydraPreviewRuntime) window.HydraPreviewRuntime.launchPreview();
}

document.getElementById('preview-restart-btn')?.addEventListener('click', () => {
  if (document.getElementById('preview-tab').classList.contains('active')) launchPreview();
});

// P2 item 14 slice 5: the Profiler / Trace toolbar buttons and the
// trace feed live in HydraPreviewToolbar (wired by its initToolbar,
// which runs near the top of this file). This delegation keeps the
// per-frame call site in processScriptGrid unchanged; a dropped module
// tag degrades to a feed that stops updating instead of breaking the
// editor.
function renderTraceFeed() {
  if (window.HydraPreviewToolbar) window.HydraPreviewToolbar.renderTraceFeed(document);
}

// P2 item 14 slice 8: the trace-feed render cache lives in the toolbar
// module; resetGame (in HydraPreviewRuntime now) resets it through this
// delegation, matching renderTraceFeed above.
function resetTraceRender() {
  if (window.HydraPreviewToolbar) window.HydraPreviewToolbar.resetTraceRender();
}

// ============================================================
// SCRIPT GRID PROCESSING
// ============================================================
// P2 item 14 slice 6: the preview input state (keyboard / mouse /
// touch / gamepad — the P4 item 37 batch 7 raw input blocks plus the
// P4 item 3D3 mouse deltas) lives in HydraPreviewRuntime. script.js
// aliases the Set fields so the condition/action contexts and the game
// loop keep reading the same objects; the module always mutates them
// in place, never replaces them, so the aliases never go stale. The
// mouse position is the module state's mouse object, mutated in place,
// so previewState.mouse stays the same object. The two scalar fields
// (touchCount, gamepadConnected) are read off previewInput at the use
// site, never aliased. If the module tag is ever dropped, the fallback
// literal below keeps the same shape so the read sites don't crash;
// input just stops feeding the preview.
const previewInput = window.HydraPreviewRuntime
  ? window.HydraPreviewRuntime.createInputState()
  : {
      mouse: { x: 0, y: 0 },
      mouseButtons: new Set(), mouseJustPressed: new Set(), mouseJustReleased: new Set(),
      keysPressed: new Set(), keysJustPressed: new Set(), keysJustReleased: new Set(),
      touchZones: new Set(), touchCount: 0,
      gamepadButtons: new Set(), gamepadPrev: new Set(),
      gamepadJustPressed: new Set(), gamepadJustReleased: new Set(),
      gamepadAxes: { lx: 0, ly: 0, rx: 0, ry: 0 }, gamepadConnected: false,
      mouseDelta: { x: 0, y: 0 }, lastClient: null
    };
previewState.mouse = previewInput.mouse;
const mouseButtons = previewInput.mouseButtons;
const mouseJustPressed = previewInput.mouseJustPressed;
const mouseJustReleased = previewInput.mouseJustReleased;
const keysPressed = previewInput.keysPressed;
const keysJustPressed = previewInput.keysJustPressed;
const keysJustReleased = previewInput.keysJustReleased;
const previewTouchZones = previewInput.touchZones;
const previewGamepadButtons = previewInput.gamepadButtons;
const previewGamepadJustPressed = previewInput.gamepadJustPressed;
const previewGamepadJustReleased = previewInput.gamepadJustReleased;
const previewGamepadAxes = previewInput.gamepadAxes;
const previewMouseDelta = previewInput.mouseDelta;
const onceTriggerStates      = new Set();

// Key-name helpers live in the shared hydra-input.js module (single canonical
// source, also used by exported games). These wrappers preserve the local names;
// P2 item 14 slice 6 routes them through HydraPreviewRuntime so the preview
// input state and its key helpers live in one module.
function normalizeKeyName(key) {
  return window.HydraPreviewRuntime
    ? window.HydraPreviewRuntime.normalizeKeyName(key)
    : String(key ?? '').trim();
}

function keyNameAliases(key) {
  if (window.HydraPreviewRuntime) return window.HydraPreviewRuntime.keyNameAliases(key);
  const normalized = normalizeKeyName(key);
  return [normalized];
}

function keySetHas(keySet, key) {
  if (window.HydraPreviewRuntime) return window.HydraPreviewRuntime.keySetHas(keySet, key);
  return keySet.has(normalizeKeyName(key));
}

function getEventKeyAliases(e) {
  if (window.HydraPreviewRuntime) return window.HydraPreviewRuntime.getEventKeyAliases(e);
  const aliases = new Set([e.key, e.code]);
  if (e.key === ' ') aliases.add('Space');
  if (e.code === 'Space') aliases.add('Space');
  return [...aliases].filter(Boolean);
}
// P2 item 14 slice 6: the preview keyboard listeners live in
// HydraPreviewRuntime (attachKeyboardInput); a dropped module tag
// degrades to no keyboard input in the preview instead of breaking
// the editor.
if (window.HydraPreviewRuntime) window.HydraPreviewRuntime.attachKeyboardInput(document, previewInput);

// P2 item 14 slice 6: the touch-zone set, the gamepad poll, and the
// touch handler live in HydraPreviewRuntime (previewInput.touchZones,
// pollGamepad, updateTouch). Touch zones are recomputed from active
// touches; a finger can sit in two zones at once (one horizontal, one
// vertical).

// P2 item 14 slice 7: the script-grid dispatch host lives in
// HydraPreviewRuntime (hydra-previewruntime.js) — processScriptGrid,
// dispatchHooks, conditionCtx/actionCtx and their hook builders, the
// per-frame context bookkeeping, and the warn-once helpers. The host
// object below hands the module the live editor state it needs; the
// module never reads editor globals. Every entry is optional with a
// safe default inside the module, and a dropped module tag degrades
// to scripts not running (the house guarded-call degradation).
if (window.HydraPreviewRuntime) window.HydraPreviewRuntime.configure({
  host: {
    getRunState: () => previewState,
    getStartedScopes: () => gameStartFiredScopes,
    getOnce: () => onceTriggerStates,
    getTimers: () => timerStates,
    getShakeCooldowns: () => cameraShakeCooldowns,
    getSceneStack: () => previewSceneStack,
    getVariables: () => gameVariables,
    getHidden: () => hiddenObjects,
    getDestroyed: () => destroyedObjects,
    getPendingDestroy: () => pendingDestroy,
    getInputState: () => previewInput,
    getScenes: () => scenes,
    getCurrentSceneId: () => currentSceneId,
    getCanvas: () => canvas,
    getCells: () => cells,
    getActiveScriptScope: () => activeScriptScope,
    getAssetLibrary: () => assetLibrary,
    getObjectsByName, getHitbox, getPhysics, isCollisionObject,
    evalExpr, evalExprInfo,
    getPreviewScene, getSceneWorldWidth, getSceneWorldHeight,
    getSceneViewportWidth, getSceneViewportHeight,
    clampCameraToScene, updateCameraFollow, normalizeCameraZoom, clamp,
    getPreviewLanguage, getPreviewLocalization, applyPreviewBoundTexts,
    getProjectDialogues, getProjectItems, getProjectQuests, getProjectAchievements, getProjectCutscenes, getProjectHighScores, getProjectTransitionConfig, getProjectJoystickConfig, getProjectId, getProjectScopedVariables, getProjectFunctions,
    ensurePreviewParticleState, ensurePreviewDamageNumberState, ensurePreviewRespawnState, ensurePreviewSpawnerState, ensurePreviewMovementState, ensurePreviewPlatformState, ensurePreviewCombatState, getPreviewBuses,
    playSound, stopPreviewMusic, pausePreviewMusic, resumePreviewMusic, stopAllPreviewSounds,
    getGridDataForScope, getScopeKey, sameScriptScope,
    isCondition: isConditionRuntimeType, isAction: isActionRuntimeType, isComment: isCommentRuntimeType,
    pushDiagnostic: (level, msg) => window.HydraUniversal?.pushDiagnostic?.(level, msg),
    sceneInitHooks, renderTraceFeed, switchPreviewScene,
    // P2 item 14 slice 8: the run-loop host entries — the frame loop and
    // the run lifecycle read the live editor state through these.
    getCurrentScene, getProjectInputActions, getProjectMasterVolume,
    resizeGameCanvas, resetTraceRender, drawGame, commitActiveGrid,
    clearRuntimeDiagnostics: () => window.HydraUniversal?.clearRuntimeDiagnostics?.(),
    getSoundCooldowns: () => soundCooldowns
  }
});

function resetFrameConditionContexts() {
  if (window.HydraPreviewRuntime) window.HydraPreviewRuntime.resetFrameConditionContexts();
  else {
    previewState.conditionContexts = {};
    previewState.executionContext = null;
  }
}

function resetGameStartState() {
  if (window.HydraPreviewRuntime) window.HydraPreviewRuntime.resetGameStartState();
  else gameStartFiredScopes.clear();
}

function getGridCellsForScope(scope) {
  // Build a virtual lookup using stored grid data for the scope
  return getGridDataForScope(scope);
}

function processScriptGrid(scope) {
  if (window.HydraPreviewRuntime) window.HydraPreviewRuntime.processScriptGrid(scope);
}

function isConditionRuntimeType(type) {
  return [
    'gameStart','always','keyPressed','keyJustPressed','mouseClick',
    'mouseOverObject','objectClicked','getVariable','collision','onFloor',
    'overlapTouch','distanceCheck','positionCheck','velocityCheck','objectVisible',
    'objectCount','chance','onTimer','onEdge','and','triggerOnce','animationFinished','tweenFinished','animStateIs','blendActive',
    ...getCatalogRuntimeTypes('condition')
  ].includes(type);
}

// P2 item 14 slice 7: the dispatch host (dispatchHooks, conditionCtx,
// evaluateCondition, the warn-once helpers, namedTimerElapsedSeconds)
// lives in HydraPreviewRuntime now.

// P4 Advanced (animation state machines): the hooks the shared
// HydraStateMachine module needs from the editor preview runtime —
// warnings surface in the diagnostics panel, plays go through HydraAnim
// with the state's speed multiplier.
// P2 item 15/12 slice 2 (shared engine): the subsystem modules +
// diagnostics warn the shared HydraSceneInit module needs from the editor
// preview runtime — one helper so the four call sites (launch, scene
// switch, both spawn paths) can never drift apart.
function sceneInitHooks() {
  return {
    anim: window.HydraAnim || null,
    stateMachine: window.HydraStateMachine || null,
    blendSpace: window.HydraBlendSpace || null,
    skeleton: window.HydraSkeleton || null,
    warn: (msg) => window.HydraUniversal?.pushDiagnostic?.('warning', msg)
  };
}

function processGameStartConditions(scope) {
  if (window.HydraPreviewRuntime) window.HydraPreviewRuntime.processGameStartConditions(scope);
}

function getMousePointForObject(obj) {
  // F2: anchored objects live in screen space (their position resolves
  // against the viewport), as do HUD and pinned widgets.
  const Ui = window.HydraUi;
  if (Ui ? Ui.isScreenFixed(obj) : obj?.uiPinned) return previewState.mouse || { x: 0, y: 0 };
  const camera = previewState.camera || { x: 0, y: 0 };
  // P4 item 37 batch 5 (camera): screen pixels shrink by the zoom factor.
  const z = normalizeCameraZoom(camera.zoom);
  return {
    x: (previewState.mouse?.x || 0) / z + (camera.x || 0),
    y: (previewState.mouse?.y || 0) / z + (camera.y || 0)
  };
}

function pointInsideObject(point, obj) {
  const box = getHitbox(obj);
  return point.x >= box.x && point.x <= box.x + box.width &&
         point.y >= box.y && point.y <= box.y + box.height;
}

function isActionRuntimeType(type) {
  return ['applyForce','teleport','setVariable','destroyObject','showHide','playSound','playAnimation','setAnimation','stopAnimation','setAnimState','setBlend','stopBlend','tweenProperty','stopTween','switchScene','setText','setCamera','followCamera','setSize','setVelocity','spawnObject','rotateObject','randomVariable','forceToward','restartScene','nextScene','previousScene', ...getCatalogRuntimeTypes('action')].includes(type);
}

function isCommentRuntimeType(type) {
  return type === 'comment';
}

// P2 item 14 slice 7: the flow-adjacency helpers
// (getEventActionIndexes, applyAdjacentActionsFromScope) and the
// preview-time getAdjacentIndexes live in HydraPreviewRuntime now.
// P5-7: getAdjacentIndexes there delegates to HydraFlow — the one
// flow module — so the preview and the export share one adjacency.

function normalizeVector(dx, dy) {
  const dist = Math.hypot(dx, dy) || 1;
  return { x: dx / dist, y: dy / dist, dist };
}

function getAlivePreviewObjects() {
  if (window.HydraPreviewRuntime) return window.HydraPreviewRuntime.getAlivePreviewObjects();
  // pendingDestroy counts as destroyed immediately: an object destroyed
  // earlier this frame must not be hittable, collidable, or targetable for
  // the rest of the frame.
  return previewState.objects.filter(o => !destroyedObjects.has(o.id) && !pendingDestroy.has(o.id));
}

function isCollisionObject(obj) {
  if (!obj) return false;
  // P4 item 31: tilemaps collide per-tile, never as whole-object AABBs
  // (a whole-map box would make the entire map solid).
  if (obj.kind === 'tilemap') return false;
  if (obj.kind === 'text' || obj.uiPinned === true) return obj.collision?.enabled === true;
  if (obj.collision && obj.collision.enabled === false) return false;
  return obj.collidable !== false;
}

// P2 item 14 slice 7: the action-target helpers
// (getContextObjectForName, resolveActionTargets) live in
// HydraPreviewRuntime now.

// P4 item 37 (block expansion, batch 5: camera): zoom lives on the camera
// state. 1 is normal; the Set Camera Zoom block clamps to 0.25-4 and bad
// values fall back to 1, so rendering math never sees 0/NaN/negative.
function normalizeCameraZoom(value) {
  const z = Number(value);
  return Number.isFinite(z) ? Math.min(4, Math.max(0.25, z)) : 1;
}
function previewCameraZoom() {
  return normalizeCameraZoom(previewState.camera?.zoom);
}
function clampCameraToScene(scene = getPreviewScene()) {
  const camera = previewState.camera || (previewState.camera = { x: 0, y: 0, zoom: 1 });
  const z = normalizeCameraZoom(camera.zoom);
  const maxX = Math.max(0, getSceneWorldWidth(scene) - getSceneViewportWidth(scene) / z);
  const maxY = Math.max(0, getSceneWorldHeight(scene) - getSceneViewportHeight(scene) / z);
  camera.x = clamp(camera.x || 0, 0, maxX);
  camera.y = clamp(camera.y || 0, 0, maxY);
}

// P2 item 14 slice 8: the frame loop / run lifecycle lives in
// HydraPreviewRuntime now; script.js keeps this thin delegation
// so every existing call site is unchanged.
function loadPreviewScene(scene) {
  if (window.HydraPreviewRuntime) window.HydraPreviewRuntime.loadPreviewScene(scene);
}

// P2 item 14 slice 8: the frame loop / run lifecycle lives in
// HydraPreviewRuntime now; script.js keeps this thin delegation
// so every existing call site is unchanged.
function switchPreviewScene(sceneId) {
  if (window.HydraPreviewRuntime) window.HydraPreviewRuntime.switchPreviewScene(sceneId);
}

// P2 item 14 slice 7: the action context builder (actionCtx) and
// executeAction live in HydraPreviewRuntime now.

// ============================================================
// HELPERS
// ============================================================
function getAdjacentCells(row, col) {
  return [
    { r: row-1, c: col }, { r: row+1, c: col },
    { r: row, c: col-1 }, { r: row, c: col+1 }
  ].map(({ r, c }) => (r < 0 || r >= 60 || c < 0 || c >= 60) ? null : cells[r*60+c]);
}

// P2 item 14 slice 7: the preview-time getAdjacentIndexes lives in
// HydraPreviewRuntime now (with the rest of the dispatch host).
// P5-7: it delegates to HydraFlow.adjacentIndexes there.

// ============================================================
// SCENE EDITOR
// ============================================================
let selectedGameObject = null;
let isDragging  = false;
let dragOffsetX = 0, dragOffsetY = 0;
// P5-8 slice b fix (cycle 23): the target of the most recent mousedown,
// recorded in capture phase (the object's own mousedown handler stops
// propagation, so a bubble-phase listener would never see it). The
// scene's click-to-deselect handler needs it: a press that starts on
// an object and releases elsewhere — a drag, including a blocked drag
// on a locked object — bubbles a click whose target is the scene
// itself, and without this guard that click deselects the object the
// mousedown just selected and empties the Inspector.
let sceneMouseDownTarget = null;
document.addEventListener('mousedown', e => { sceneMouseDownTarget = e.target; }, true);
let nextObjectId = Date.now();
let addingObject = false; // true when user clicked Add and waiting to place
let sceneZoom = 1;
let sceneSnapEnabled = true;
const SCENE_GRID_SIZE = 20;

const sceneSnapBtn = document.getElementById('scene-snap-btn');
const sceneZoomOutBtn = document.getElementById('scene-zoom-out-btn');
const sceneZoomInBtn = document.getElementById('scene-zoom-in-btn');
const sceneZoomReadout = document.getElementById('scene-zoom-readout');
const sceneDuplicateBtn = document.getElementById('scene-duplicate-btn');
const sceneCenterBtn = document.getElementById('scene-center-btn');
const sceneFrontBtn = document.getElementById('scene-front-btn');
const sceneBackBtn = document.getElementById('scene-back-btn');
const sceneDeleteBtn = document.getElementById('scene-delete-btn');
const sceneObjectList = document.getElementById('scene-object-list');
const sceneObjectCount = document.getElementById('scene-object-count');
const entitySearch = document.getElementById('entity-search');
const sceneSwitcherSelect = document.getElementById('scene-switcher-select');
const sceneRenameBtn = document.getElementById('scene-rename-btn');
const sceneToolbarAddBtn = document.getElementById('scene-toolbar-add-btn');
const sceneToolbarDeleteBtn = document.getElementById('scene-toolbar-delete-btn');
const objectCreateButtons = document.querySelectorAll('.object-create-btn');
const inspectorTabs = document.querySelectorAll('.inspector-tab');
const inspectorPanels = document.querySelectorAll('.inspector-panel');

entitySearch?.addEventListener('input', () => renderObjectList());

// P5-8 slice b: keyboard navigation for the outliner. Focus the
// list and the arrows move the selection row to row (collapsed
// groups are not in the DOM, so they are skipped for free); Home /
// End jump to the ends, Enter opens the Inspector for the selected
// object. The arrows select without leaving the Hierarchy tab —
// selectGameObjectById would otherwise switch to Inspector on
// every press.
sceneObjectList?.addEventListener('keydown', e => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' &&
      e.key !== 'End' && e.key !== 'Enter') return;
  const rows = [...sceneObjectList.querySelectorAll('.object-list-item')];
  if (!rows.length) return;
  const ids = rows.map(r => parseInt(r.dataset.objectId));
  const selectedId = selectedGameObject ? parseInt(selectedGameObject.dataset.id) : null;
  if (e.key === 'Enter') {
    if (selectedId != null) switchInspectorTab('inspect');
    return;
  }
  e.preventDefault();
  const O = getOutliner();
  let nextId = null;
  if (e.key === 'Home') nextId = ids[0];
  else if (e.key === 'End') nextId = ids[ids.length - 1];
  else if (O) nextId = O.moveSelection(ids, selectedId, e.key === 'ArrowDown' ? 1 : -1);
  if (nextId == null) return;
  selectGameObjectById(nextId, { switchTab: false });
  sceneObjectList.focus();
});

// P5-8 slice b: the outliner's collapsed-layer map, loaded once
// from localStorage at editor start (initOutliner) and written back
// on every group toggle. Null until initOutliner runs; the list
// treats null as all-expanded, so the Hierarchy tab works even if
// the module never loads. The declaration MUST sit above the
// load-time initOutliner() call below: initOutliner assigns this
// binding, and a `let` declared after the call throws a temporal
// dead zone error that aborts the rest of this script (Nov 7, 2026:
// that exact ordering hid the whole Create panel and failed the
// smoke test's F2 step).
let outlinerCollapsed = null;

// P5-8 slice b: the outliner's collapsed-layer map loads with the
// editor, next to the dock sides, so the first render already
// knows which groups start collapsed.
if (typeof initOutliner === 'function') initOutliner();

function switchInspectorTab(tabName) {
  inspectorTabs.forEach(tab => tab.classList.toggle('active', tab.dataset.inspectorTab === tabName));
  inspectorPanels.forEach(panel => panel.classList.toggle('active', panel.dataset.inspectorPanel === tabName));
}

inspectorTabs.forEach(tab => {
  tab.addEventListener('click', () => switchInspectorTab(tab.dataset.inspectorTab));
});

// Asset manager panel wiring (upload / rename / replace / delete UI).
if (typeof initAssetManager === 'function') initAssetManager();

// Input actions panel wiring (Inputs tab: named actions with key,
// gamepad, and touch bindings).
if (typeof initInputActionsPanel === 'function') initInputActionsPanel();
// Audio buses panel wiring (Audio tab: per-bus volume + mute).
if (typeof initAudioBusesPanel === 'function') initAudioBusesPanel();
// Localization panel wiring (Localization tab: string tables).
if (typeof initLocalizationPanel === 'function') initLocalizationPanel();
// Dialogues panel wiring (Dialogues tab: named conversations).
if (typeof initDialoguesPanel === 'function') initDialoguesPanel();
// Items panel wiring (Items tab: named items with max stack).
if (typeof initItemsPanel === 'function') initItemsPanel();
// Quests panel wiring (Quests tab: named objectives with a target).
if (typeof initQuestsPanel === 'function') initQuestsPanel();
// Achievements panel wiring (Achievements tab: permanent trophies).
if (typeof initAchievementsPanel === 'function') initAchievementsPanel();
// Cutscenes panel wiring (Cutscenes tab: scripted scenes, step by step).
if (typeof initCutscenesPanel === 'function') initCutscenesPanel();
// High Scores panel wiring (High Scores tab: table config + stored board).
if (typeof initHighScoresPanel === 'function') initHighScoresPanel();
// Variables panel wiring (Variables tab: scoped-variable definitions
// with live values + the add form).
if (typeof initVariablesPanel === 'function') initVariablesPanel();
// Functions panel wiring (Functions tab: custom-function definitions
// with the add form + body-grid links).
if (typeof initFunctionsPanel === 'function') initFunctionsPanel();
// Status bar wiring (P5-2 slice a: scene + object count, live FPS,
// diagnostics count at the bottom of the editor).
if (typeof initStatusBar === 'function') initStatusBar();
// Dockable panels wiring (P5-8 slice a: the dock buttons flip
// each side panel to the other edge; runs before the resizers so
// they start with the stored side).
if (typeof initPanelDock === 'function') initPanelDock();
// Compact block density wiring (P5-8 slice c: the "Compact blocks"
// toggle shrinks the logic-grid cells; the density persists per
// browser in localStorage).
if (typeof initBlockDensity === 'function') initBlockDensity();
// Resizable panels wiring (P5-2 slice d: drag the handle on a side
// panel's left edge; widths persist per browser in localStorage).
if (typeof initPanelResizers === 'function') initPanelResizers();
// Transitions panel wiring (Transitions tab: default effect + duration).
if (typeof initTransitionsPanel === 'function') initTransitionsPanel();
// Joystick panel wiring (Joystick tab: on-screen stick defaults).
if (typeof initJoystickPanel === 'function') initJoystickPanel();

function snapSceneValue(value) {
  return HydraStage.snapValue(value, sceneSnapEnabled, SCENE_GRID_SIZE);
}

function getSelectedSceneObjectData() {
  if (!selectedGameObject) return null;
  const id = parseInt(selectedGameObject.dataset.id);
  return getCurrentScene().objects.find(o => o.id === id) || null;
}

function updateSceneToolState() {
  sceneSnapBtn?.classList.toggle('active', sceneSnapEnabled);
  if (sceneZoomReadout) sceneZoomReadout.textContent = `${Math.round(sceneZoom * 100)}%`;
  if (sceneSwitcherSelect) sceneSwitcherSelect.value = String(currentSceneId);
  const hasSelection = Boolean(getSelectedSceneObjectData());
  [sceneDuplicateBtn, sceneCenterBtn, sceneFrontBtn, sceneBackBtn, sceneDeleteBtn].forEach(btn => {
    if (btn) btn.disabled = !hasSelection;
  });
  if (sceneToolbarDeleteBtn) sceneToolbarDeleteBtn.disabled = scenes.length <= 1;
}

function applySceneZoom() {
  HydraStage.applySceneZoom(document, sceneZoom);
  updateSceneToolState();
}

function setSceneZoom(nextZoom) {
  sceneZoom = HydraStage.clampZoom(nextZoom);
  applySceneZoom();
}

function selectGameObjectById(id, opts) {
  const el = document.querySelector(`.game-object[data-id="${id}"]`);
  const obj = getCurrentScene().objects.find(o => o.id === id);
  if (!el || !obj) return;
  document.querySelectorAll('.game-object').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  selectedGameObject = el;
  showObjectProperties(obj);
  if (opts && opts.keepListDom) {
    // Row click only (a pure selection change): keep the list DOM
    // stable instead of re-rendering it. A full re-render replaces
    // the row under a double-click, so the browser never fires
    // dblclick on the new node and rename never opens (cycle 23).
    // The active row is already right; only its class needs syncing.
    // Every other caller keeps the re-render — center / layer nudge
    // change the data the list displays (position, group).
    document.querySelectorAll('.object-list-item').forEach(r =>
      r.classList.toggle('active', r.dataset.objectId === String(id)));
  } else {
    renderObjectList();
  }
  updateSceneToolState();
  // P5-8 slice b: the outliner's arrow keys select without leaving
  // the Hierarchy tab ({ switchTab: false }); every other caller
  // keeps the old behavior of opening the Inspector.
  if (!opts || opts.switchTab !== false) switchInspectorTab('inspect');
}

function getScenePointFromEvent(event) {
  return HydraStage.getScenePointFromEvent(event, sceneZoom, document);
}

function createSceneObjectAt(kind, x, y, sourceObject = null) {
  if (sourceObject) {
    const copy = cloneData(sourceObject);
    copy.id = nextObjectId++;
    copy.name = sourceObject.name || '';
    copy.posX = snapSceneValue(x - (copy.width || 60) / 2);
    copy.posY = snapSceneValue(y - (copy.height || 60) / 2);
    getCurrentScene().objects.push(copy);
    renderSceneObjects();
    selectGameObjectById(copy.id);
    markProjectDirty();
    return copy;
  }
  return addGameObject(kind, x, y);
}

function deleteSelectedSceneObject() {
  const obj = getSelectedSceneObjectData();
  if (!obj) return;
  getCurrentScene().objects = getCurrentScene().objects.filter(o => o.id !== obj.id);
  selectedGameObject?.remove();
  selectedGameObject = null;
  document.getElementById('object-properties').innerHTML = '<p class="hint-text">Click an object in the scene to select it.</p>';
  renderObjectList();
  updateSceneToolState();
  markProjectDirty();
  refreshValidationDiagnostics();
}

function duplicateSelectedSceneObject() {
  const obj = getSelectedSceneObjectData();
  if (!obj) return;
  const copy = cloneData(obj);
  copy.id = nextObjectId++;
  copy.name = obj.name || '';
  copy.posX = snapSceneValue((obj.posX || 0) + SCENE_GRID_SIZE);
  copy.posY = snapSceneValue((obj.posY || 0) + SCENE_GRID_SIZE);
  getCurrentScene().objects.push(copy);
  renderSceneObjects();
  selectGameObjectById(copy.id);
  markProjectDirty();
}

function centerSelectedSceneObject() {
  const obj = getSelectedSceneObjectData();
  if (!obj) return;
  const scene = getCurrentScene();
  obj.posX = snapSceneValue(((scene.width || 800) - obj.width) / 2);
  obj.posY = snapSceneValue(((scene.height || 600) - obj.height) / 2);
  renderSceneObjects();
  selectGameObjectById(obj.id);
  markProjectDirty();
}

function nudgeSelectedLayer(direction) {
  const obj = getSelectedSceneObjectData();
  if (!obj) return;
  const layers = getCurrentScene().objects.map(o => o.layer || 0);
  obj.layer = direction > 0 ? Math.max(...layers, 0) + 1 : Math.min(...layers, 0) - 1;
  renderSceneObjects();
  selectGameObjectById(obj.id);
  markProjectDirty();
}

function getOutliner() {
  return (typeof window !== 'undefined' && window.HydraOutliner) || null;
}

function initOutliner() {
  const O = getOutliner();
  outlinerCollapsed = O ? O.readStoredCollapsed(window.localStorage) : {};
}

// P5-8 slice b: one outliner row — swatch, name + meta, eye, lock,
// layer badge. The eye hides the object (stage element + run start;
// the row stays, dimmed, so it is never lost) and the lock stops
// canvas drags; both write through the outliner module and refresh
// the stage element in place (renderSceneObjects would orphan the
// selected element), the list, and the Inspector when the row is
// the selected object.
function buildObjectListItem(obj, selectedId) {
  const O = getOutliner();
  const item = document.createElement('div');
  item.className = 'object-list-item' + (obj.id === selectedId ? ' active' : '');
  if (O && O.isHidden(obj)) item.classList.add('is-hidden');
  if (O && O.isLocked(obj)) item.classList.add('is-locked');
  item.dataset.objectId = String(obj.id);
  const swatch = document.createElement('div');
  swatch.className = 'object-list-swatch';
  if (obj.assetId && assetLibrary[obj.assetId]) swatch.style.backgroundImage = `url('${assetLibrary[obj.assetId].dataUrl}')`;
  else swatch.style.backgroundColor = obj.kind === 'text' ? '#111827' : (obj.color || '#4488ff');
  const label = document.createElement('div');
  const name = document.createElement('span');
  name.className = 'object-list-name';
  name.textContent = obj.name || (obj.kind === 'text' ? 'Text Object' : 'Sprite Object');
  name.title = 'Double-click to rename';
  name.addEventListener('dblclick', e => {
    e.stopPropagation();
    startObjectListRename(obj, name);
  });
  const meta = document.createElement('span');
  meta.className = 'object-list-meta';
  const componentCount = obj.components?.length || 0;
  meta.textContent = `${obj.archetype || obj.kind} - ${componentCount} components - ${Math.round(obj.posX)}, ${Math.round(obj.posY)}`;
  label.appendChild(name);
  label.appendChild(meta);
  const eye = document.createElement('button');
  eye.type = 'button';
  eye.className = 'object-list-eye';
  const hidden = O ? O.isHidden(obj) : false;
  eye.innerHTML = `<i class="fas ${hidden ? 'fa-eye-slash' : 'fa-eye'}"></i>`;
  eye.title = hidden ? 'Show object' : 'Hide object';
  eye.setAttribute('aria-label', `${hidden ? 'Show' : 'Hide'} ${obj.name || 'object'}`);
  eye.addEventListener('click', e => {
    e.stopPropagation();
    if (!O) return;
    O.setHidden(obj, !O.isHidden(obj));
    markProjectDirty();
    syncObjectListStageFlag(obj);
    renderEditor3dView();
    renderObjectList();
    if (obj.id === selectedId) showObjectProperties(obj);
  });
  const lock = document.createElement('button');
  lock.type = 'button';
  lock.className = 'object-list-lock';
  const locked = O ? O.isLocked(obj) : false;
  lock.innerHTML = `<i class="fas ${locked ? 'fa-lock' : 'fa-lock-open'}"></i>`;
  lock.title = locked ? 'Unlock object' : 'Lock object';
  lock.setAttribute('aria-label', `${locked ? 'Unlock' : 'Lock'} ${obj.name || 'object'}`);
  lock.addEventListener('click', e => {
    e.stopPropagation();
    if (!O) return;
    O.setLocked(obj, !O.isLocked(obj));
    markProjectDirty();
    syncObjectListStageFlag(obj);
    renderObjectList();
    if (obj.id === selectedId) showObjectProperties(obj);
  });
  const layer = document.createElement('span');
  layer.className = 'object-list-layer';
  layer.textContent = `L${obj.layer || 0}`;
  item.appendChild(swatch);
  item.appendChild(label);
  item.appendChild(eye);
  item.appendChild(lock);
  item.appendChild(layer);
  item.draggable = true;
  item.addEventListener('dragstart', e => {
    e.dataTransfer.setData('application/x-hydra-object-id', String(obj.id));
    e.dataTransfer.effectAllowed = 'copy';
  });
  // A click on the row name selects in place and stays in the list:
  // switching to the Inspector there would hide the list under a
  // double-click, so the second click could never land and rename
  // never opened (cycle 23). A click anywhere else on the row opens
  // the Inspector, as before.
  item.addEventListener('click', e => {
    const onName = e.target && e.target.closest ? e.target.closest('.object-list-name') : null;
    selectGameObjectById(obj.id, { keepListDom: true, switchTab: onName ? false : undefined });
  });
  return item;
}

// P5-8 slice b: flip the stage element's hidden / locked classes to
// match the object's flags, in place — no re-render, so the selected
// element reference stays live.
function syncObjectListStageFlag(obj) {
  const O = getOutliner();
  const el = document.querySelector(`.game-object[data-id="${obj.id}"]`);
  if (!el || !O) return;
  el.classList.toggle('object-hidden', O.isHidden(obj));
  el.classList.toggle('object-locked', O.isLocked(obj));
}

// P5-8 slice b: rename an object in place in the outliner.
// Double-click the name to edit it; Enter or clicking away commits
// (the same write the Inspector's Name field does), Escape or a
// blank name reverts. The list re-renders on commit, and the
// Inspector refreshes when the renamed row is the selected object.
function startObjectListRename(obj, nameSpan) {
  const O = getOutliner();
  if (!O) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'object-list-rename';
  input.value = obj.name || '';
  input.setAttribute('aria-label', 'Rename object');
  let done = false;
  function commit(cancel) {
    if (done) return;
    done = true;
    if (!cancel) {
      const res = O.renameObject(obj, input.value);
      if (res.ok) markProjectDirty();
    }
    renderObjectList();
    const selectedId = selectedGameObject ? parseInt(selectedGameObject.dataset.id) : null;
    if (obj.id === selectedId) showObjectProperties(obj);
  }
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') commit(false);
    else if (e.key === 'Escape') commit(true);
  });
  input.addEventListener('blur', () => commit(false));
  input.addEventListener('click', e => e.stopPropagation());
  nameSpan.replaceWith(input);
  input.focus();
  input.select();
}

// P5-8 slice b: one collapsible layer-group header — chevron plus
// "Layer N · M objects". Clicking flips the group and persists the
// choice, so a collapsed layer stays collapsed across loads.
function buildObjectListGroupHeader(group) {
  const O = getOutliner();
  const collapsed = O ? O.isCollapsed(outlinerCollapsed || {}, group.layer) : false;
  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'object-list-group' + (collapsed ? ' collapsed' : '');
  header.setAttribute('aria-expanded', String(!collapsed));
  header.dataset.layer = String(group.layer);
  const chevron = document.createElement('i');
  chevron.className = collapsed ? 'fas fa-chevron-right' : 'fas fa-chevron-down';
  const label = document.createElement('span');
  label.className = 'object-list-group-label';
  label.textContent = O ? O.layerLabel(group.layer, group.objects.length) : `Layer ${group.layer}`;
  header.appendChild(chevron);
  header.appendChild(label);
  header.addEventListener('click', () => {
    if (!O) return;
    outlinerCollapsed = O.toggleCollapsed(outlinerCollapsed || {}, group.layer);
    O.writeStoredCollapsed(window.localStorage, outlinerCollapsed);
    renderObjectList();
  });
  return header;
}

function renderObjectList() {
  if (!sceneObjectList) return;
  const O = getOutliner();
  const query = (entitySearch?.value || '').trim().toLowerCase();
  const scene = getCurrentScene();
  // P5-8 slice b: the search filter lives in the outliner module
  // now (same haystack as before); without the module the inline
  // filter below is the old behavior, so the list never breaks on
  // a missing script tag.
  const objects = (O ? O.filterObjects(scene.objects, query) : [...(scene.objects || [])]
    .filter(obj => {
      if (!query) return true;
      const haystack = [
        obj.name,
        obj.kind,
        obj.archetype,
        ...(obj.tags || []),
        ...(obj.components || []).map(c => c.type)
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    }))
    .sort((a, b) => (b.layer || 0) - (a.layer || 0));
  if (sceneObjectCount) sceneObjectCount.textContent = `${objects.length}/${scene.objects.length}`;
  sceneObjectList.innerHTML = '';
  if (!objects.length) {
    const empty = document.createElement('div');
    empty.className = 'object-list-empty';
    empty.textContent = 'No objects in this scene yet.';
    sceneObjectList.appendChild(empty);
    return;
  }
  const selectedId = selectedGameObject ? parseInt(selectedGameObject.dataset.id) : null;
  // P5-8 slice b: with no search query the rows sit under
  // collapsible layer headers, highest layer first; a search
  // flattens the groups away, so it shows exactly the matches.
  if (O && !query) {
    O.groupByLayer(objects).forEach(group => {
      sceneObjectList.appendChild(buildObjectListGroupHeader(group));
      if (O.isCollapsed(outlinerCollapsed || {}, group.layer)) return;
      group.objects.forEach(obj => {
        sceneObjectList.appendChild(buildObjectListItem(obj, selectedId));
      });
    });
    return;
  }
  objects.forEach(obj => {
    sceneObjectList.appendChild(buildObjectListItem(obj, selectedId));
  });
}

function refreshSceneSwitcher() {
  if (!sceneSwitcherSelect) return;
  sceneSwitcherSelect.innerHTML = '';
  scenes.forEach(scene => {
    const opt = document.createElement('option');
    opt.value = String(scene.id);
    opt.textContent = scene.name;
    sceneSwitcherSelect.appendChild(opt);
  });
  sceneSwitcherSelect.value = String(currentSceneId);
  updateSceneToolState();
}

function createScene() {
  // P2 item 13/10: scenes are built by the core factory, so a new scene
  // can never enter the store unnormalized.
  const newScene = window.HydraUniversal.createScene({
    id: nextSceneId++, name: `Scene ${scenes.length + 1}`
  });
  syncEditorGlobals();
  scenes.push(newScene);
  setCurrentSceneId(newScene.id);
  renderSceneObjects(); refreshSceneList(); refreshScopeTabs(); refreshSceneSwitcher();
  switchInspectorTab('scenes');
  markProjectDirty();
}

function deleteCurrentScene() {
  if (scenes.length <= 1) { alert('Cannot delete the last scene.'); return; }
  const scene = getCurrentScene();
  if (!confirm(`Delete "${scene.name}"?`)) return;
  scenes.splice(scenes.indexOf(scene), 1);
  setCurrentSceneId(scenes[0].id);
  renderSceneObjects(); refreshSceneList(); refreshScopeTabs(); refreshSceneSwitcher();
  markProjectDirty();
  refreshValidationDiagnostics();
}

function renameCurrentScene() {
  const scene = getCurrentScene();
  const nextName = prompt('Scene name:', scene.name);
  if (!nextName?.trim()) return;
  scene.name = nextName.trim();
  refreshSceneList(); refreshScopeTabs(); refreshSceneSwitcher();
  markProjectDirty();
}

sceneSnapBtn?.addEventListener('click', () => {
  sceneSnapEnabled = !sceneSnapEnabled;
  updateSceneToolState();
});
sceneZoomOutBtn?.addEventListener('click', () => setSceneZoom(sceneZoom - 0.1));
sceneZoomInBtn?.addEventListener('click', () => setSceneZoom(sceneZoom + 0.1));
// P4 item 3D1 batch 2: Layout / 3D view toggle (3D scenes only).
document.getElementById('scene-view-layout-btn')?.addEventListener('click', () => setSceneEditor3dView(false));
document.getElementById('scene-view-3d-btn')?.addEventListener('click', () => setSceneEditor3dView(true));
sceneDuplicateBtn?.addEventListener('click', duplicateSelectedSceneObject);
sceneCenterBtn?.addEventListener('click', centerSelectedSceneObject);
sceneFrontBtn?.addEventListener('click', () => nudgeSelectedLayer(1));
sceneBackBtn?.addEventListener('click', () => nudgeSelectedLayer(-1));
sceneDeleteBtn?.addEventListener('click', deleteSelectedSceneObject);
sceneSwitcherSelect?.addEventListener('change', e => {
  setCurrentSceneId(e.target.value);
  renderSceneObjects(); refreshSceneList(); refreshScopeTabs(); initSceneEditor(); refreshSceneSwitcher();
});
sceneRenameBtn?.addEventListener('click', renameCurrentScene);
sceneToolbarAddBtn?.addEventListener('click', createScene);
sceneToolbarDeleteBtn?.addEventListener('click', deleteCurrentScene);
objectCreateButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const s = getCurrentScene();
    createSceneObjectAt(btn.dataset.createKind || 'sprite', (s.width || 800) / 2, (s.height || 600) / 2);
  });
  btn.addEventListener('dragstart', e => {
    e.dataTransfer.setData('application/x-hydra-create-kind', btn.dataset.createKind || 'sprite');
    e.dataTransfer.effectAllowed = 'copy';
  });
});

function initSceneEditor() {
  const sceneEl = document.getElementById('scene-canvas');
  const newScene = sceneEl.cloneNode(true);
  sceneEl.parentNode.replaceChild(newScene, sceneEl);

  // Add Object button
  const addBtn = document.getElementById('add-object-btn');
  if (addBtn) {
    addBtn.onclick = () => {
      const kind = document.getElementById('new-object-kind').value;
      const s = getCurrentScene();
      const cx = (s.width  || 800) / 2;
      const cy = (s.height || 600) / 2;
      addGameObject(kind, cx, cy);
    };
  }

  // Scene canvas click to place
  newScene.addEventListener('click', e => {
    if (e.target !== newScene || isDragging) return;
    // Only a press that ALSO started on empty scene counts as a
    // click-to-deselect (cycle 23: a press on an object released
    // elsewhere — e.g. a blocked drag on a locked object — bubbles
    // a click targeted at the scene, and deselecting there threw
    // away the selection the mousedown had just made).
    if (sceneMouseDownTarget !== newScene) return;
    // deselect
    document.querySelectorAll('.game-object').forEach(o => o.classList.remove('selected'));
    selectedGameObject = null;
    document.getElementById('object-properties').innerHTML = '<p class="hint-text">Click an object in the scene to select it.</p>';
    renderObjectList();
    updateSceneToolState();
  });

  newScene.addEventListener('dragover', e => {
    if (
      e.dataTransfer.types.includes('application/x-hydra-create-kind') ||
      e.dataTransfer.types.includes('application/x-hydra-object-id')
    ) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  });

  newScene.addEventListener('drop', e => {
    const kind = e.dataTransfer.getData('application/x-hydra-create-kind');
    const objectId = parseInt(e.dataTransfer.getData('application/x-hydra-object-id'));
    if (!kind && !objectId) return;
    e.preventDefault();
    const point = getScenePointFromEvent(e);
    const source = objectId ? getCurrentScene().objects.find(o => o.id === objectId) : null;
    createSceneObjectAt(kind || source?.kind || 'sprite', point.x, point.y, source);
  });

  // Scene bg color
  const bgColorInput = document.getElementById('scene-bg-color');
  if (bgColorInput) {
    bgColorInput.value = getCurrentScene().bgColor || '#ffffff';
    bgColorInput.oninput = e => {
      getCurrentScene().bgColor = e.target.value;
      newScene.style.backgroundColor = e.target.value;
      updateSceneBg();
      renderEditor3dView(); // P4 item 3D1 batch 2: repaint the 3D viewport
      markProjectDirty();
    };
  }

  // P4 item 3D1: per-scene 2D/3D render mode.
  const renderModeInput = document.getElementById('scene-render-mode');
  if (renderModeInput) {
    renderModeInput.value = window.Hydra3d
      ? window.Hydra3d.normalizeRenderMode(getCurrentScene().renderMode) : '2d';
    renderModeInput.onchange = e => {
      const scene = getCurrentScene();
      scene.renderMode = window.Hydra3d
        ? window.Hydra3d.normalizeRenderMode(e.target.value) : '2d';
      // P4 item 3D1 batch 2: the Layout/3D view toggle and the 3D camera
      // fields only exist for 3D scenes; refresh the viewport too.
      // P4 Advanced (2D lighting): the darkness fields only exist for 2D.
      updateScene3dViewToggle();
      syncScene3dCameraFields();
      syncSceneDarknessFields();
      syncSceneCameraFeelFields();
      syncSceneMinimapFields();
      renderEditor3dView();
      markProjectDirty();
    };
  }

  // P4 item 3D1 batch 2: Scene Settings 3D camera fields (position +
  // look-at + FOV). Assignment is idempotent, so re-wiring on every
  // initSceneEditor() call is safe — same as the handlers above.
  ['scene-cam3d-x', 'scene-cam3d-y', 'scene-cam3d-z',
   'scene-cam3d-tx', 'scene-cam3d-ty', 'scene-cam3d-tz',
   'scene-cam3d-fov'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.oninput = onScene3dCameraInput;
  });
  // P4 item 3D5: shadow switch + ground plane ride the same handler.
  ['scene-shadows3d', 'scene-shadow-ground-y'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.oninput = onScene3dCameraInput;
  });
  // P4 Advanced (2D lighting): darkness slider + tint ride their handler.
  ['scene-darkness', 'scene-darkness-color'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.oninput = onSceneDarknessInput;
  });
  const cam3dResetBtn = document.getElementById('scene-cam3d-reset-btn');
  if (cam3dResetBtn) {
    cam3dResetBtn.onclick = () => {
      getCurrentScene().camera3d = null;
      syncScene3dCameraFields();
      renderEditor3dView();
      markProjectDirty();
    };
  }
  // P4 Advanced batch 15 (camera feel): smoothing + deadzone + bounds
  // ride their handler; the Clear bounds button wipes all four edges.
  ['scene-cam-smoothing', 'scene-cam-deadzone-w', 'scene-cam-deadzone-h',
   'scene-cam-bounds-minx', 'scene-cam-bounds-miny',
   'scene-cam-bounds-maxx', 'scene-cam-bounds-maxy'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.oninput = onSceneCameraFeelInput;
  });
  const camBoundsClearBtn = document.getElementById('scene-cam-bounds-clear-btn');
  if (camBoundsClearBtn) {
    camBoundsClearBtn.onclick = () => {
      const scene = getCurrentScene();
      if (scene && window.HydraCameraFeel) {
        window.HydraCameraFeel.normalizeCameraFeel(scene.cameraFeel);
        scene.cameraFeel.bounds = null;
      }
      syncSceneCameraFeelFields();
      markProjectDirty();
    };
  }
  // P4 Advanced batch 36 (minimap): enabled + corner + size + zoom +
  // viewport ride their handler (the checkbox fires on change, which
  // the input event covers for checkboxes too).
  ['scene-minimap-enabled', 'scene-minimap-corner', 'scene-minimap-size',
   'scene-minimap-zoom', 'scene-minimap-viewport'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.oninput = onSceneMinimapInput;
  });
  syncScene3dCameraFields();
  syncSceneDarknessFields();
  syncSceneCameraFeelFields();
  syncSceneMinimapFields();

  // Scene bg image upload
  const bgUploadBtn = document.getElementById('scene-bg-upload-btn');
  const bgFileInput = document.getElementById('scene-bg-file');
  const bgClearBtn  = document.getElementById('scene-bg-clear-btn');
  if (bgUploadBtn && bgFileInput) {
    bgUploadBtn.onclick = () => bgFileInput.click();
    bgFileInput.onchange = e => {
      const file = e.target.files[0];
      if (!file) return;
      storeAsset(file, (assetId, err) => {
        if (!assetId) { if (err) alert(err); return; }
        getCurrentScene().bgAssetId = assetId;
        updateSceneBg();
        bgClearBtn.style.display = '';
        markProjectDirty();
      });
    };
  }
  if (bgClearBtn) {
    bgClearBtn.style.display = getCurrentScene().bgAssetId ? '' : 'none';
    bgClearBtn.onclick = () => {
      getCurrentScene().bgAssetId = null;
      updateSceneBg();
      bgClearBtn.style.display = 'none';
      markProjectDirty();
    };
  }

  // Canvas size inputs
  const wInput = document.getElementById('scene-width');
  const hInput = document.getElementById('scene-height');
  const vwInput = document.getElementById('scene-viewport-width');
  const vhInput = document.getElementById('scene-viewport-height');
  if (wInput) {
    wInput.value = getSceneWorldWidth(getCurrentScene());
    wInput.oninput = e => {
      const scene = getCurrentScene();
      scene.worldWidth = parseInt(e.target.value) || 800;
      scene.width = scene.worldWidth;
      applySceneSize();
      markProjectDirty();
    };
  }
  if (hInput) {
    hInput.value = getSceneWorldHeight(getCurrentScene());
    hInput.oninput = e => {
      const scene = getCurrentScene();
      scene.worldHeight = parseInt(e.target.value) || 600;
      scene.height = scene.worldHeight;
      applySceneSize();
      markProjectDirty();
    };
  }
  if (vwInput) {
    vwInput.value = getSceneViewportWidth(getCurrentScene());
    vwInput.oninput = e => {
      getCurrentScene().viewportWidth = parseInt(e.target.value) || 800;
      applySceneSize();
      markProjectDirty();
    };
  }
  if (vhInput) {
    vhInput.value = getSceneViewportHeight(getCurrentScene());
    vhInput.oninput = e => {
      getCurrentScene().viewportHeight = parseInt(e.target.value) || 600;
      applySceneSize();
      markProjectDirty();
    };
  }

  // Clear scene
  const clearSceneBtn = document.getElementById('clearSceneButton');
  if (clearSceneBtn) {
    clearSceneBtn.onclick = () => {
      if (!confirm('Clear all objects from this scene?')) return;
      const s = document.getElementById('scene-canvas');
      while (s.firstChild) s.removeChild(s.firstChild);
      getCurrentScene().objects = [];
      selectedGameObject = null;
      document.getElementById('object-properties').innerHTML = '<p class="hint-text">Click an object in the scene to select it.</p>';
      renderObjectList();
      updateSceneToolState();
      markProjectDirty();
    };
  }

  updateSceneBg();
  applySceneSize();
}

function updateSceneBg() {
  HydraStage.updateSceneBg(document, getCurrentScene());
}

function applySceneSize() {
  HydraStage.applySceneSize(document, getCurrentScene());
}

function updateCameraFrame() {
  HydraStage.updateCameraFrame(document, getCurrentScene());
}

// P2 item 14 slice 4: the in-editor 3D viewport and its Scene Settings
// field sync live in hydra-stage.js; script.js keeps thin delegations.
function isScene3dScene() {
  return HydraStage.isScene3dScene(getCurrentScene());
}

function updateScene3dViewToggle() {
  HydraStage.update3dViewToggle(document, getCurrentScene());
}

function setSceneEditor3dView(on) {
  HydraStage.set3dView(document, on, getCurrentScene());
}

function renderEditor3dView() {
  HydraStage.render3dView(document, getCurrentScene());
}

function syncScene3dCameraFields() {
  HydraStage.syncScene3dCameraFields(document, getCurrentScene());
}

function onScene3dCameraInput() {
  HydraStage.onScene3dCameraInput(document, getCurrentScene());
}

function syncSceneDarknessFields() {
  HydraStage.syncSceneDarknessFields(document, getCurrentScene());
}

function onSceneDarknessInput() {
  HydraStage.onSceneDarknessInput(document, getCurrentScene());
}

function syncSceneCameraFeelFields() {
  HydraStage.syncSceneCameraFeelFields(document, getCurrentScene());
}

function onSceneCameraFeelInput() {
  HydraStage.onSceneCameraFeelInput(document, getCurrentScene());
}

function syncSceneMinimapFields() {
  HydraStage.syncSceneMinimapFields(document, getCurrentScene());
}

function onSceneMinimapInput() {
  HydraStage.onSceneMinimapInput(document, getCurrentScene());
}

function kindName3d(kind) {
  return HydraStage.kindName3d(kind);
}

function addGameObject(kind, x, y) {
  // P4 Advanced (2D lighting): the Create palette's Light button is
  // context-aware — a 2D light in 2D scenes, a 3D light in 3D scenes.
  // The Add Entity dropdown offers both kinds explicitly.
  if (kind === 'light') {
    const mode = getCurrentScene()?.renderMode;
    kind = mode === '3d' ? 'light3d' : 'light2d';
  }
  const is3d = window.Hydra3d?.is3dKind?.(kind) === true;
  const isLight = window.Hydra3d?.isLight3d?.(kind) === true;
  const isLight2d = window.HydraLight2d?.isLight2d?.(kind) === true;
  // P2 item 13/10: the object record (kind defaults + normalization)
  // comes from the core factory. The factory takes the top-left, so the
  // object is first built at the click point and then centered on it,
  // snapped to the scene grid — and the Transform component's stored
  // x/y are synced, or editing that component later would jump the
  // object back to the pre-snap position.
  const obj = window.HydraUniversal.createObject(kind, {
    id: nextObjectId++, posX: x, posY: y
  });
  // A new object must arrive with a name no other object in the scene
  // already has, or the pickers and the runtime cannot tell them apart.
  {
    const scene = getCurrentScene();
    if (scene && Array.isArray(scene.objects)) {
      const used = new Set(scene.objects.filter(o => o !== obj).map(o => o && o.name));
      if (used.has(obj.name)) {
        let n = 2;
        while (used.has(obj.name + ' ' + n)) n++;
        obj.name = obj.name + ' ' + n;
      }
    }
  }
  obj.posX = snapSceneValue(x - obj.width / 2);
  obj.posY = snapSceneValue(y - obj.height / 2);
  const transform = obj.components?.find(c => c.type === 'Transform');
  if (transform) { transform.props.x = obj.posX; transform.props.y = obj.posY; }

  if (kind === 'button') window.HydraUniversal?.addComponent?.(obj, 'Button');
  if (kind === 'camera3d') window.HydraUniversal?.addComponent?.(obj, 'Camera3D');
  if (isLight) window.Hydra3d?.normalizeLight3d?.(obj);
  if (isLight2d) window.HydraLight2d?.normalizeLight2d?.(obj);
  if (kind === 'empty') obj.collision.enabled = false;
  if (kind === 'tilemap') {
    // P4 item 31: fresh tilemap spec (10x10 of 32px tiles, tile 0 solid).
    window.HydraTiles?.applyToObject?.(obj);
    obj.collision.enabled = true;
  }

  getCurrentScene().objects.push(obj);
  markProjectDirty();
  const el = renderGameObject(obj);
  // Auto-select and show properties
  document.querySelectorAll('.game-object').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  selectedGameObject = el;
  showObjectProperties(obj);
  renderObjectList();
  updateSceneToolState();
  switchInspectorTab('inspect');
}

// ============================================================
// TILEMAP SCENE EDITOR (P4 item 31)
// ============================================================
// A tilemap renders as a <canvas> inside its scene div. When paint mode is
// on (the default), click/drag paints the brush tile and right-click erases
// a cell; the Paint/Move toggle in the inspector Tilemap section switches
// back to moving the object. All tile math comes from HydraTiles.
let tilePaintSession = null; // { id } while a paint drag is active

function tileBrushFor(obj) {
  const b = Number(obj._brushTile);
  return Number.isFinite(b) ? Math.floor(b) : 0; // -1 = eraser
}

function isTilePaintMode(obj) {
  return !!obj && obj.kind === 'tilemap' && obj._paintMode !== false;
}

function refreshTilemapElement(obj) {
  const el = document.querySelector(`.game-object[data-id="${obj.id}"]`);
  if (!el) return;
  el.style.width = `${obj.width}px`;
  el.style.height = `${obj.height}px`;
  drawTilemapElementCanvas(obj, el);
}

// P4 item 3D1: the scene editor shows 3D primitives as a small live 3D
// thumbnail (a fixed three-quarter camera) inside the object's div, so
// what you place is what the preview renders. The div keeps the object's
// 2D footprint for dragging; Z/depth/rotation live in the Inspector.
function draw3dElementCanvas(obj, el) {
  const H3 = window.Hydra3d;
  if (!H3 || !H3.is3dKind(obj.kind)) return;
  let cv = el.querySelector('canvas.object3d-canvas');
  if (!cv) {
    cv = document.createElement('canvas');
    cv.className = 'object3d-canvas';
    el.appendChild(cv);
  }
  const w = Math.max(1, Math.round(obj.width || 1));
  const h = Math.max(1, Math.round(obj.height || 1));
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, w, h);
  // Frame the single object with a fixed three-quarter camera.
  var dist = Math.max(w, h, obj.depth || 0) * 2.2;
  var scene = {
    worldWidth: w, worldHeight: h,
    camera3d: { x: w / 2 + dist * 0.35, y: h / 2 - dist * 0.35, z: dist, tx: w / 2, ty: h / 2, tz: 0, fov: 55 }
  };
  var thumb = { kind: obj.kind, width: w, height: h, depth: obj.depth, color: obj.color, posX: 0, posY: 0, z: 0, rotX: 0, rotY: -18, rotZ: 0 };
  // P4 item 3D2: model3d thumbnails render the actual uploaded model (or a
  // placeholder box when no model is picked yet).
  if (obj.kind === 'model3d') {
    thumb.modelAssetId = obj.modelAssetId;
    thumb.materialColor = obj.materialColor;
    // P4 item 3D2 batch 2: the thumbnail honors the texture switch too.
    thumb.useTexture = obj.useTexture !== false;
  }
  H3.renderScene(g, scene, [thumb], w, h,
    (typeof resolveModelMeshFor === 'function') ? resolveModelMeshFor : null);
  let badge = el.querySelector('.object3d-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'object3d-badge';
    badge.textContent = '3D';
    el.appendChild(badge);
  }
}

// P4 item 3D5: the scene-editor glyph for a light — a bulb icon tinted by
// the light color, with the light type as a label. Lights never render
// geometry (not in thumbnails, the 3D view, preview, or exports); the div
// keeps the 2D footprint for dragging.
function drawLightElement(obj, el) {
  const H3 = window.Hydra3d;
  if (!H3 || !H3.isLight3d(obj.kind)) return;
  let glyph = el.querySelector('.light3d-glyph');
  if (!glyph) {
    glyph = document.createElement('div');
    glyph.className = 'light3d-glyph';
    el.appendChild(glyph);
  }
  const l = (H3.normalizeLight3d(obj).light) || {};
  const typeName = l.type === 'ambient' ? 'Ambient' : l.type === 'directional' ? 'Directional' : 'Point';
  glyph.innerHTML = '';
  const icon = document.createElement('i');
  icon.className = 'fas fa-lightbulb';
  icon.style.color = l.color || '#fde047';
  glyph.appendChild(icon);
  const lbl = document.createElement('span');
  lbl.className = 'light3d-type';
  lbl.textContent = typeName + (l.enabled === false ? ' (off)' : '');
  glyph.appendChild(lbl);
  el.title = typeName + ' light — invisible in the game; drag to move' +
    (l.type === 'point' ? '; Z is its depth position' :
     l.type === 'directional' ? '; Rot X / Rot Y aim it' : '; no position or direction');
}

function drawLight2dElement(obj, el) {
  const L2 = window.HydraLight2d;
  if (!L2 || !L2.isLight2d(obj.kind)) return;
  let glyph = el.querySelector('.light2d-glyph');
  if (!glyph) {
    glyph = document.createElement('div');
    glyph.className = 'light2d-glyph';
    el.appendChild(glyph);
  }
  const l = (L2.normalizeLight2d(obj) && obj.light) || {};
  glyph.innerHTML = '';
  const icon = document.createElement('i');
  icon.className = 'fas fa-lightbulb';
  icon.style.color = l.color || '#fde047';
  glyph.appendChild(icon);
  const lbl = document.createElement('span');
  lbl.className = 'light2d-type';
  lbl.textContent = '2D Light' + (l.enabled === false ? ' (off)' : '');
  glyph.appendChild(lbl);
  el.title = '2D light — invisible in the game; drag to move. It only shows when the scene has Darkness above 0.';
}

function drawTilemapElementCanvas(obj, el) {  const T = window.HydraTiles;
  if (!T) return;
  let cv = el.querySelector('canvas.tilemap-canvas');
  if (!cv) {
    cv = document.createElement('canvas');
    cv.className = 'tilemap-canvas';
    el.appendChild(cv);
  }
  cv.width = Math.max(1, Math.round(obj.width || 1));
  cv.height = Math.max(1, Math.round(obj.height || 1));
  const g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  const img = obj.tilesetAssetId ? getImage(obj.tilesetAssetId) : null;
  if (img && !img.complete) img.addEventListener('load', () => drawTilemapElementCanvas(obj, el), { once: true });
  T.drawTilemap(g, obj, {
    image: img, camX: 0, camY: 0, viewW: cv.width, viewH: cv.height,
    showGrid: true, labelTiles: !img
  });
}

function paintTileFromEvent(obj, el, e, erase) {
  const T = window.HydraTiles;
  if (!T) return;
  const rect = el.getBoundingClientRect();
  const w = obj.width || 1, h = obj.height || 1;
  if (rect.width <= 0 || rect.height <= 0) return;
  // client coords -> unzoomed px inside the tilemap div
  const lx = (e.clientX - rect.left) / (rect.width / w);
  const ly = (e.clientY - rect.top) / (rect.height / h);
  const cell = T.worldToCell({ posX: 0, posY: 0, tileSize: obj.tileSize, cols: obj.cols, rows: obj.rows }, lx, ly);
  if (T.setTile(obj, cell.col, cell.row, erase ? -1 : tileBrushFor(obj))) {
    drawTilemapElementCanvas(obj, el);
  }
}

function renderGameObject(objectData) {
  const sceneEl = document.getElementById('scene-canvas');
  const el = document.createElement('div');
  el.className  = `game-object ${objectData.kind}-object`;
  el.dataset.id = objectData.id;
  el.style.left = `${objectData.posX}px`;
  el.style.top  = `${objectData.posY}px`;
  el.style.width  = `${objectData.width}px`;
  el.style.height = `${objectData.height}px`;
  el.style.zIndex = (objectData.layer || 0) + 1;
  // P5-8 slice b: the outliner's eye and lock, on the stage element
  // itself — a hidden object leaves the canvas (display:none, so it
  // cannot be clicked or dragged there; the outliner row still
  // selects it), a locked one reads as locked where you work on it.
  if (objectData.hidden === true) el.classList.add('object-hidden');
  if (objectData.locked === true) el.classList.add('object-locked');
  // P4 item 37: edit-mode preview of flip/scale, composed with rotation.
  {
    const parts = [];
    if (objectData.rotation) parts.push(`rotate(${objectData.rotation}deg)`);
    const esx = Number(objectData.scaleX), esy = Number(objectData.scaleY);
    const fx = (objectData.flipH ? -1 : 1) * (Number.isFinite(esx) ? esx : 1);
    const fy = (objectData.flipV ? -1 : 1) * (Number.isFinite(esy) ? esy : 1);
    if (fx !== 1 || fy !== 1) parts.push(`scale(${fx}, ${fy})`);
    if (parts.length) el.style.transform = parts.join(' ');
  }

  if (objectData.kind === 'text') {
    applyTextStyle(el, objectData);
  } else if (objectData.kind === 'panel') {
    applyPanelStyle(el, objectData);
  } else if (objectData.kind === 'tilemap') {
    // P4 item 31: tilemaps draw their tiles on an inner canvas.
    el.style.backgroundColor = 'transparent';
    el.classList.add('tilemap-object');
    drawTilemapElementCanvas(objectData, el);
  } else if (window.HydraLight2d && window.HydraLight2d.isLight2d(objectData.kind)) {
    // P4 Advanced (2D lighting): 2D lights are invisible in the render —
    // the scene editor shows a bulb glyph so they stay selectable and
    // draggable, mirroring the 3D light glyph.
    el.style.backgroundColor = 'transparent';
    el.classList.add('light2d-object');
    drawLight2dElement(objectData, el);
  } else if (window.Hydra3d && window.Hydra3d.isLight3d(objectData.kind)) {
    // P4 item 3D5: lights are invisible in the render — the scene editor
    // shows a bulb glyph with the light type so they stay selectable and
    // draggable.
    el.style.backgroundColor = 'transparent';
    el.classList.add('light3d-object');
    drawLightElement(objectData, el);
  } else if (window.Hydra3d && window.Hydra3d.is3dKind(objectData.kind)) {
    // P4 item 3D1: 3D primitives draw a live 3D thumbnail on an inner
    // canvas; the div keeps the 2D footprint for dragging.
    el.style.backgroundColor = 'transparent';
    el.classList.add('object3d-object');
    draw3dElementCanvas(objectData, el);
  } else {
    applyObjectVisual(el, objectData);
  }
  applyHitboxOverlay(el, objectData);
  applyUiWidgetBadge(el, objectData);

  el.addEventListener('mousedown', e => {
    e.preventDefault();
    e.stopPropagation();
    document.querySelectorAll('.game-object').forEach(o => o.classList.remove('selected'));
    el.classList.add('selected');
    selectedGameObject = el;
    showObjectProperties(objectData);
    renderObjectList();
    updateSceneToolState();
    // P5-8 slice b: a locked object still selects (so it can be
    // inspected and unlocked from the Inspector) but never drags
    // and never paints — the outliner is the way to move it, or
    // unlock it first.
    if (objectData.locked === true) return;
    // P4 item 31: paint mode — click/drag paints tiles instead of moving
    // the object (right-click erases; the inspector toggles Paint/Move).
    if (isTilePaintMode(objectData)) {
      paintTileFromEvent(objectData, el, e, false);
      tilePaintSession = { id: objectData.id };
      return;
    }
    isDragging = true;
    const rect = el.getBoundingClientRect();
    dragOffsetX = (e.clientX - rect.left) / sceneZoom;
    dragOffsetY = (e.clientY - rect.top) / sceneZoom;
  });

  // P4 item 31: right-click erases the tile under the cursor.
  if (objectData.kind === 'tilemap') {
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      paintTileFromEvent(objectData, el, e, true);
      markProjectDirty();
    });
  }

  sceneEl.appendChild(el);
  return el;
}

function applyTextStyle(el, obj) {
  el.style.fontSize   = `${obj.fontSize || 24}px`;
  el.style.fontFamily = obj.fontFamily || 'sans-serif';
  el.style.color      = obj.textColor || '#111827';
  el.style.fontWeight = obj.bold ? 'bold' : 'normal';
  el.style.fontStyle  = obj.italic ? 'italic' : 'normal';
  el.style.opacity    = obj.opacity ?? 1;
  el.style.whiteSpace = 'nowrap';
  el.style.overflow   = 'visible';
  el.style.lineHeight  = 'normal';
  el.textContent = obj.text || 'Text';

  // F2: buttons render as real buttons in the scene editor too (normal
  // state; hover/press states show in preview and exported games).
  const isBtn = window.HydraUi ? window.HydraUi.isButton(obj) : obj.archetype === 'button';
  if (isBtn) {
    const bf = window.HydraUi ? window.HydraUi.buttonFillFor(obj, 'normal') : { fill: '#3b82f6', radius: 8 };
    // setProperty with 'important': the .text-object stylesheet rule forces
    // a transparent background with !important, and button fills must win.
    el.style.setProperty('background-color', bf.fill, 'important');
    el.style.setProperty('background-image', 'none', 'important');
    el.style.borderRadius = `${bf.radius}px`;
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.justifyContent = obj.textAlign === 'left' ? 'flex-start' : obj.textAlign === 'right' ? 'flex-end' : 'center';
    el.style.textAlign = obj.textAlign || 'center';
    el.style.padding = '0 12px';
    el.style.boxSizing = 'border-box';
    const bw = Number(obj.borderWidth) || 0;
    el.style.border = bw > 0 && obj.borderColor ? `${bw}px solid ${obj.borderColor}` : '';
  } else {
    el.style.textAlign  = obj.textAlign || 'left';
    el.style.display    = 'block';
    el.style.alignItems = '';
    el.style.justifyContent = '';
    el.style.padding    = '0';
    el.style.background = 'transparent';
    el.style.borderRadius = '0';
    el.style.backgroundColor = '';
    el.style.border = '';
    el.style.boxSizing = '';
  }
}

// F2: panel widget — a rounded-rect container for menus and HUD blocks.
function applyPanelStyle(el, obj) {
  el.style.backgroundColor = obj.color || '#1e293b';
  el.style.borderRadius = `${Math.max(0, Number(obj.cornerRadius) || 0)}px`;
  el.style.opacity = obj.opacity ?? 1;
  const bw = Number(obj.borderWidth) || 0;
  el.style.border = bw > 0 && obj.borderColor ? `${bw}px solid ${obj.borderColor}` : '';
}

// F2: tiny badge on anchored / HUD widgets so menu layout is visible while
// editing (the anchor itself resolves against the preview/export viewport).
function applyUiWidgetBadge(el, obj) {
  let badge = el.querySelector('.ui-widget-badge');
  const Ui = window.HydraUi;
  const parts = [];
  if (Ui && Ui.normalizeAnchor(obj.anchor) !== 'none') {
    const entry = Ui.ANCHORS.find(a => a.value === obj.anchor);
    parts.push('\u2693 ' + (entry ? entry.label : obj.anchor));
  }
  if (obj.hud) parts.push('HUD');
  if (!parts.length) { if (badge) badge.remove(); return; }
  if (!badge) {
    badge = document.createElement('div');
    badge.className = 'ui-widget-badge';
    el.appendChild(badge);
  }
  badge.textContent = parts.join(' \u00B7 ');
}

function applyObjectVisual(el, obj) {
  el.style.opacity = obj.opacity ?? 1;
  if (obj.assetId && assetLibrary[obj.assetId]) {
    el.style.backgroundImage    = `url('${assetLibrary[obj.assetId].dataUrl}')`;
    el.style.backgroundSize     = obj.assetFit === 'contain' ? 'contain' : (obj.assetFit === 'stretch' ? '100% 100%' : 'cover');
    el.style.backgroundRepeat   = 'no-repeat';
    el.style.backgroundPosition = 'center';
    el.style.backgroundColor    = 'transparent';
  } else {
    el.style.backgroundImage = '';
    el.style.backgroundColor = obj.color || '#4488ff';
  }
}

function hasCustomHitbox(obj) {
  return Boolean(
    (Number(obj.hitboxOffsetX) || 0) !== 0 ||
    (Number(obj.hitboxOffsetY) || 0) !== 0 ||
    (Number(obj.hitboxWidth) || obj.width || 0) !== (obj.width || 0) ||
    (Number(obj.hitboxHeight) || obj.height || 0) !== (obj.height || 0)
  );
}

function applyHitboxOverlay(el, obj) {
  let overlay = el.querySelector('.hitbox-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'hitbox-overlay';
    el.appendChild(overlay);
  }
  const box = getHitbox({ ...obj, posX: 0, posY: 0 });
  overlay.style.left = `${box.x}px`;
  overlay.style.top = `${box.y}px`;
  overlay.style.width = `${box.width}px`;
  overlay.style.height = `${box.height}px`;
  el.classList.toggle('has-custom-hitbox', hasCustomHitbox(obj));
}

function renderSceneObjects() {
  const sceneEl = document.getElementById('scene-canvas');
  while (sceneEl.firstChild) sceneEl.removeChild(sceneEl.firstChild);
  getCurrentScene().objects.forEach(renderGameObject);
  updateSceneBg();
  applySceneSize();
  applySceneZoom();
  renderObjectList();
  updateSceneToolState();
  // P4 item 3D1 batch 2: keep the Layout/3D view toggle honest (a 2D scene
  // always falls back to Layout) and refresh the 3D viewport if visible.
  updateScene3dViewToggle();
  renderEditor3dView();
}
window.renderSceneObjects = renderSceneObjects;

// Drag
document.addEventListener('mousemove', e => {
  // P4 item 31: tile paint drags paint every cell the pointer crosses.
  if (tilePaintSession) {
    const el = document.querySelector(`.game-object[data-id="${tilePaintSession.id}"]`);
    const obj = el && getCurrentScene().objects.find(o => o.id === tilePaintSession.id);
    if (el && obj && isTilePaintMode(obj)) paintTileFromEvent(obj, el, e, false);
    return;
  }
  if (!isDragging || !selectedGameObject) return;
  const sceneEl = document.getElementById('scene-canvas');
  const rect    = sceneEl.getBoundingClientRect();
  const x = snapSceneValue((e.clientX - rect.left) / sceneZoom - dragOffsetX);
  const y = snapSceneValue((e.clientY - rect.top) / sceneZoom - dragOffsetY);
  const id  = parseInt(selectedGameObject.dataset.id);
  const obj = getCurrentScene().objects.find(o => o.id === id);
  if (obj) {
    obj.posX = x; obj.posY = y;
    selectedGameObject.style.left = `${x}px`;
    selectedGameObject.style.top  = `${y}px`;
    // Update position inputs live
    const xIn = document.querySelector('#object-properties input[data-prop="posX"]');
    const yIn = document.querySelector('#object-properties input[data-prop="posY"]');
    if (xIn) xIn.value = x;
    if (yIn) yIn.value = y;
    renderObjectList();
  }
});
document.addEventListener('mouseup', () => {
  if (tilePaintSession) { markProjectDirty(); tilePaintSession = null; }
  if (isDragging) markProjectDirty();
  isDragging = false;
});

// ============================================================
// OBJECT PROPERTIES PANEL
// ============================================================
// Animation editor preview timer (module-level so a panel re-render kills the
// previous preview instead of stacking intervals).
let animEditorPreviewTimer = null;
let animEditorPreviewImg = null;

// GDevelop-style per-object animation editor: an animation list where each
// animation has a name, a mode (loop / ping-pong / play once), a frame rate,
// and frames picked from the Assets library. Played back live in preview and
// exported games via the shared HydraAnim module.
function appendAnimationEditor(root, obj) {
  if (animEditorPreviewTimer) { clearInterval(animEditorPreviewTimer); animEditorPreviewTimer = null; }
  animEditorPreviewImg = null;
  window.HydraAnim?.normalizeAnimations(obj);
  const animations = obj.animations || [];
  const imageAssets = Object.keys(assetLibrary).filter(id => (assetLibrary[id].kind || '') === 'image');

  const section = document.createElement('div');
  section.className = 'animation-editor';
  const title = document.createElement('div');
  title.className = 'property-mini-title';
  title.textContent = 'Animations';
  section.appendChild(title);

  // Blocks target objects by NAME, so an unnamed sprite's animations cannot
  // be played from a Play Animation block. A fresh sprite starts with a
  // blank name, same as joints (see the Joints editor): say so plainly
  // instead of letting the block picker silently offer nothing.
  if (!obj.name) {
    const prompt = document.createElement('div');
    prompt.className = 'property-group animation-name-prompt';
    const promptText = document.createElement('span');
    promptText.textContent = 'Blocks find objects by name. Give this object a name in the Name field above, then a Play Animation block can play these animations.';
    prompt.appendChild(promptText);
    section.appendChild(prompt);
  }

  const refresh = () => showObjectProperties(obj);

  // Renaming an animation repoints every animation block + the play-at-start
  // setting that used the old name, across all script scopes.
  function propagateAnimationRename(oldName, newName) {
    if (!oldName || oldName === newName) return;
    const visit = (d) => {
      if (d && (d.type === 'playAnimation' || d.type === 'setAnimation' || d.type === 'animationFinished') && d.animation === oldName) {
        d.animation = newName;
      }
    };
    const scanGrid = (g) => {
      if (!g) return;
      if (g instanceof Map) g.forEach(visit); // Map.forEach passes (value, key)
      else Object.values(g).forEach(visit);
    };
    scanGrid(cellData);
    scanGrid(globalGridData);
    (scenes || []).forEach(s => scanGrid(s.gridData));
    if (obj.startAnimation === oldName) obj.startAnimation = newName;
    // P4 Advanced (cycle 37): states bind animations by name — repoint them
    // too so a rename never orphans a state.
    (obj.animStates || []).forEach(st => {
      if (st && st.animation === oldName) st.animation = newName;
    });
    // P4 Advanced (cycle 38): blend-space points bind animations by name
    // too — repoint them for the same reason.
    (obj.animBlends || []).forEach(b => {
      (b.points || []).forEach(p => {
        if (p && p.animation === oldName) p.animation = newName;
      });
    });
    markProjectDirty();
  }

  animations.forEach((anim, animIdx) => {
    const card = document.createElement('div');
    card.className = 'animation-card';

    const header = document.createElement('div');
    header.className = 'animation-card-header';
    const nameInput = makeTextInput(anim.name || '', 'e.g. Walk', v => { anim.name = v; });
    nameInput.style.flex = '1';
    let nameBeforeEdit = anim.name;
    nameInput.addEventListener('focus', () => { nameBeforeEdit = anim.name; });
    nameInput.addEventListener('change', () => {
      window.HydraAnim?.normalizeAnimations(obj);
      propagateAnimationRename(nameBeforeEdit, anim.name);
      refresh();
    });
    const delBtn = document.createElement('button');
    delBtn.type = 'button'; delBtn.className = 'component-mini-btn danger';
    delBtn.textContent = 'Delete';
    delBtn.onclick = () => {
      if (obj.startAnimation === anim.name) obj.startAnimation = '';
      // P4 Advanced (cycle 37): unbind deleted animations from states.
      (obj.animStates || []).forEach(st => {
        if (st && st.animation === anim.name) st.animation = '';
      });
      // P4 Advanced (cycle 38): unbind deleted animations from blend
      // points too (the point keeps its position, bound to nothing).
      (obj.animBlends || []).forEach(b => {
        (b.points || []).forEach(p => {
          if (p && p.animation === anim.name) p.animation = '';
        });
      });
      animations.splice(animIdx, 1);
      markProjectDirty(); refresh();
    };
    header.appendChild(nameInput);
    header.appendChild(delBtn);
    card.appendChild(header);

    const row = document.createElement('div');
    row.className = 'animation-card-row';
    row.appendChild(makePropGroup('Mode:', makeSelect(
      [['loop', 'Loop'], ['pingpong', 'Ping-pong'], ['once', 'Play once']],
      anim.mode || 'loop',
      v => { anim.mode = v; markProjectDirty(); }
    )));
    row.appendChild(makePropGroup('Frames/sec:', makeNumberInput(anim.fps || 8, 1, 60, 1, v => {
      anim.fps = Math.max(1, Math.round(v) || 8);
      markProjectDirty();
    })));
    card.appendChild(row);

    // Frame strip: thumbnails in order, each removable.
    const framesWrap = document.createElement('div');
    framesWrap.className = 'animation-frames';
    anim.frames.forEach((frameId, frameIdx) => {
      const cell = document.createElement('div');
      cell.className = 'animation-frame';
      const rec = assetLibrary[frameId];
      if (rec && rec.dataUrl) {
        const thumb = document.createElement('img');
        thumb.src = rec.dataUrl;
        thumb.title = rec.name || frameId;
        cell.appendChild(thumb);
      } else {
        const missing = document.createElement('div');
        missing.className = 'animation-frame-missing';
        missing.textContent = '!';
        missing.title = "This frame's asset is missing or was deleted — it is skipped during playback.";
        cell.appendChild(missing);
      }
      // Reorder: frames play in strip order, so a misplaced frame moves
      // instead of forcing a delete-and-re-add.
      const moveLeft = document.createElement('button');
      moveLeft.type = 'button'; moveLeft.className = 'animation-frame-move move-left';
      moveLeft.textContent = '◀'; moveLeft.title = 'Move frame earlier';
      moveLeft.disabled = frameIdx === 0;
      moveLeft.onclick = () => {
        if (frameIdx === 0) return;
        const tmp = anim.frames[frameIdx - 1];
        anim.frames[frameIdx - 1] = anim.frames[frameIdx];
        anim.frames[frameIdx] = tmp;
        markProjectDirty(); refresh();
      };
      cell.appendChild(moveLeft);
      const moveRight = document.createElement('button');
      moveRight.type = 'button'; moveRight.className = 'animation-frame-move move-right';
      moveRight.textContent = '▶'; moveRight.title = 'Move frame later';
      moveRight.disabled = frameIdx === anim.frames.length - 1;
      moveRight.onclick = () => {
        if (frameIdx === anim.frames.length - 1) return;
        const tmp = anim.frames[frameIdx + 1];
        anim.frames[frameIdx + 1] = anim.frames[frameIdx];
        anim.frames[frameIdx] = tmp;
        markProjectDirty(); refresh();
      };
      cell.appendChild(moveRight);
      const rm = document.createElement('button');
      rm.type = 'button'; rm.className = 'animation-frame-remove';
      rm.textContent = '×'; rm.title = 'Remove frame';
      rm.onclick = () => { anim.frames.splice(frameIdx, 1); markProjectDirty(); refresh(); };
      cell.appendChild(rm);
      framesWrap.appendChild(cell);
    });
    if (!anim.frames.length) {
      const empty = document.createElement('p');
      empty.className = 'hint-text';
      empty.textContent = 'No frames yet — add image frames from your Assets below.';
      framesWrap.appendChild(empty);
    }
    card.appendChild(framesWrap);

    const frameSelect = makeSelect(
      [['', '+ Add frame from Assets…']].concat(imageAssets.map(id => [id, assetLibrary[id].name || id])),
      '',
      v => {
        if (!v) return;
        anim.frames.push(v);
        markProjectDirty(); refresh();
      }
    );
    card.appendChild(frameSelect);

    // Live preview: cycles the frames with the shared HydraAnim state machine
    // so what you see is exactly what the game plays.
    const previewRow = document.createElement('div');
    previewRow.className = 'animation-preview-row';
    const playBtn = document.createElement('button');
    playBtn.type = 'button'; playBtn.className = 'component-mini-btn';
    playBtn.textContent = '▶ Preview';
    const previewImg = document.createElement('img');
    previewImg.className = 'animation-preview-img';
    previewImg.alt = 'Animation preview';
    const firstRec = anim.frames.length && assetLibrary[anim.frames[0]];
    if (firstRec && firstRec.dataUrl) previewImg.src = firstRec.dataUrl;
    playBtn.onclick = () => {
      const isThisPreview = animEditorPreviewImg === previewImg;
      if (animEditorPreviewTimer) { clearInterval(animEditorPreviewTimer); animEditorPreviewTimer = null; }
      document.querySelectorAll('.animation-preview-row .component-mini-btn').forEach(b => { b.textContent = '▶ Preview'; });
      if (isThisPreview) { animEditorPreviewImg = null; return; }
      if (!anim.frames.length || !window.HydraAnim) return;
      const pst = window.HydraAnim.createAnimState();
      window.HydraAnim.play(pst, obj, anim.name);
      animEditorPreviewImg = previewImg;
      playBtn.textContent = '⏸ Stop';
      const stepMs = 50;
      animEditorPreviewTimer = setInterval(() => {
        window.HydraAnim.update(pst, obj, stepMs / (1000 / 60));
        const fid = window.HydraAnim.currentFrameAssetId(pst, obj);
        const rec = fid && assetLibrary[fid];
        if (rec && rec.dataUrl) previewImg.src = rec.dataUrl;
        if (!pst.playing) {
          clearInterval(animEditorPreviewTimer); animEditorPreviewTimer = null;
          animEditorPreviewImg = null;
          playBtn.textContent = '▶ Preview';
        }
      }, stepMs);
    };
    previewRow.appendChild(playBtn);
    previewRow.appendChild(previewImg);
    card.appendChild(previewRow);

    section.appendChild(card);
  });

  section.appendChild(makePropGroup('Play at start:', makeSelect(
    [['', 'None (static sprite)']].concat(animations.map(a => [a.name, a.name])),
    obj.startAnimation || '',
    v => { obj.startAnimation = v; markProjectDirty(); }
  )));

  const addBtn = document.createElement('button');
  addBtn.type = 'button'; addBtn.className = 'component-mini-btn';
  addBtn.textContent = '+ Add animation';
  addBtn.onclick = () => {
    animations.push({ name: 'Animation ' + (animations.length + 1), mode: 'loop', fps: 8, frames: [] });
    markProjectDirty(); refresh();
  };
  section.appendChild(addBtn);
  if (!imageAssets.length) {
    section.appendChild(makeNote('Upload images in the Assets tab first — animation frames come from your image assets.'));
  }
  section.appendChild(makeNote('Loop replays forever, Ping-pong bounces back and forth, Play once runs a single time and can trigger the Animation Finished block.'));

  root.appendChild(section);
}

// P4 Advanced (animation state machines, cycle 37): the per-object state
// list editor. Each state binds a name to one of the object's animations
// plus a playback speed; the optional initial state is entered when the
// game/scene starts. Transitions stay in the logic grid (Set Animation
// State / Animation State blocks) — states are data, transitions are
// blocks, so everything here is rebuildable from Play Animation blocks.
function appendAnimStateEditor(root, obj) {
  const SM = window.HydraStateMachine;
  if (!SM) return;
  const states = SM.normalizeStates(obj);
  const animations = (obj.animations || []).map(a => a && a.name).filter(Boolean);

  const section = document.createElement('div');
  section.className = 'animstate-editor';
  const title = document.createElement('div');
  title.className = 'property-mini-title';
  title.textContent = 'Animation States';
  section.appendChild(title);

  const refresh = () => showObjectProperties(obj);

  // Renaming a state repoints every state block + the initial-state setting
  // that used the old name, across all script scopes (mirrors the animation
  // rename propagation above).
  function propagateStateRename(oldName, newName) {
    if (!oldName || oldName === newName) return;
    const visit = (d) => {
      if (d && (d.type === 'setAnimState' || d.type === 'animStateIs') && d.state === oldName) {
        d.state = newName;
      }
    };
    const scanGrid = (g) => {
      if (!g) return;
      if (g instanceof Map) g.forEach(visit);
      else Object.values(g).forEach(visit);
    };
    scanGrid(cellData);
    scanGrid(globalGridData);
    (scenes || []).forEach(s => scanGrid(s.gridData));
    if (obj.animStateInitial === oldName) obj.animStateInitial = newName;
    markProjectDirty();
  }

  states.forEach((st, stIdx) => {
    const card = document.createElement('div');
    card.className = 'animation-card';

    const header = document.createElement('div');
    header.className = 'animation-card-header';
    const nameInput = makeTextInput(st.name || '', 'e.g. Run', v => { st.name = v; });
    nameInput.style.flex = '1';
    let nameBeforeEdit = st.name;
    nameInput.addEventListener('focus', () => { nameBeforeEdit = st.name; });
    nameInput.addEventListener('change', () => {
      SM.normalizeStates(obj);
      propagateStateRename(nameBeforeEdit, st.name);
      refresh();
    });
    const delBtn = document.createElement('button');
    delBtn.type = 'button'; delBtn.className = 'component-mini-btn danger';
    delBtn.textContent = 'Delete';
    delBtn.onclick = () => {
      if (obj.animStateInitial === st.name) obj.animStateInitial = '';
      states.splice(stIdx, 1);
      markProjectDirty(); refresh();
    };
    header.appendChild(nameInput);
    header.appendChild(delBtn);
    card.appendChild(header);

    const row = document.createElement('div');
    row.className = 'animation-card-row';
    row.appendChild(makePropGroup('Animation:', makeSelect(
      [['', 'None (state only)']].concat(animations.map(n => [n, n])),
      st.animation || '',
      v => { st.animation = v; markProjectDirty(); }
    )));
    row.appendChild(makePropGroup('Speed:', makeNumberInput(st.speed || 1, 0.1, 8, 0.05, v => {
      st.speed = v; markProjectDirty();
    })));
    card.appendChild(row);

    section.appendChild(card);
  });

  section.appendChild(makePropGroup('Initial state:', makeSelect(
    [['', 'None']].concat(states.map(st => [st.name, st.name])),
    obj.animStateInitial || '',
    v => { obj.animStateInitial = v; markProjectDirty(); }
  )));

  const addBtn = document.createElement('button');
  addBtn.type = 'button'; addBtn.className = 'component-mini-btn';
  addBtn.textContent = '+ Add state';
  addBtn.onclick = () => {
    states.push({ name: 'State ' + (states.length + 1), animation: animations[0] || '', speed: 1 });
    markProjectDirty(); refresh();
  };
  section.appendChild(addBtn);
  section.appendChild(makeNote('States name a moment ("Idle", "Run", "Hurt") and play their animation automatically when entered. Change states from the logic grid with the Set Animation State block; read the current state with the Animation State condition. A state with no animation is a pure logic flag.'));

  root.appendChild(section);
}

// P4 Advanced (blend spaces): the Blend Spaces section. Each blend space
// places the object's animations at X/Y points; the Set Blend block drives
// the values at runtime and the engine crossfades between the nearest
// animations.
function appendBlendSpaceEditor(root, obj) {
  const BS = window.HydraBlendSpace;
  if (!BS) return;
  const blends = BS.normalizeBlendSpaces(obj);
  const animations = (obj.animations || []).map(a => a && a.name).filter(Boolean);

  const section = document.createElement('div');
  section.className = 'blendspace-editor';
  const title = document.createElement('div');
  title.className = 'property-mini-title';
  title.textContent = 'Blend Spaces';
  section.appendChild(title);

  const refresh = () => showObjectProperties(obj);

  // Renaming a blend space repoints every blend block that used the old
  // name, across all script scopes (mirrors propagateStateRename).
  function propagateBlendRename(oldName, newName) {
    if (!oldName || oldName === newName) return;
    const visit = (d) => {
      if (d && (d.type === 'setBlend' || d.type === 'stopBlend' || d.type === 'blendActive') && d.blend === oldName) {
        d.blend = newName;
      }
    };
    const scanGrid = (g) => {
      if (!g) return;
      if (g instanceof Map) g.forEach(visit);
      else Object.values(g).forEach(visit);
    };
    scanGrid(cellData);
    scanGrid(globalGridData);
    (scenes || []).forEach(s => scanGrid(s.gridData));
    markProjectDirty();
  }

  blends.forEach((b, bIdx) => {
    const card = document.createElement('div');
    card.className = 'animation-card';

    const header = document.createElement('div');
    header.className = 'animation-card-header';
    const nameInput = makeTextInput(b.name || '', 'e.g. Move', v => { b.name = v; });
    nameInput.style.flex = '1';
    let nameBeforeEdit = b.name;
    nameInput.addEventListener('focus', () => { nameBeforeEdit = b.name; });
    nameInput.addEventListener('change', () => {
      BS.normalizeBlendSpaces(obj);
      propagateBlendRename(nameBeforeEdit, b.name);
      refresh();
    });
    const delBtn = document.createElement('button');
    delBtn.type = 'button'; delBtn.className = 'component-mini-btn danger';
    delBtn.textContent = 'Delete';
    delBtn.onclick = () => {
      blends.splice(bIdx, 1);
      markProjectDirty(); refresh();
    };
    header.appendChild(nameInput);
    header.appendChild(delBtn);
    card.appendChild(header);

    const fpsRow = document.createElement('div');
    fpsRow.className = 'animation-card-row';
    fpsRow.appendChild(makePropGroup('Speed (fps):', makeNumberInput(b.fps || 8, 1, 60, 1, v => {
      b.fps = v; markProjectDirty();
    })));
    card.appendChild(fpsRow);

    b.points.forEach((p, pIdx) => {
      const prow = document.createElement('div');
      prow.className = 'animation-card-row';
      prow.appendChild(makePropGroup('Animation:', makeSelect(
        [['', '-- Choose --']].concat(animations.map(n => [n, n])),
        p.animation || '',
        v => { p.animation = v; markProjectDirty(); }
      )));
      prow.appendChild(makePropGroup('X:', makeNumberInput(p.x || 0, -10, 10, 0.1, v => {
        p.x = v; markProjectDirty();
      })));
      prow.appendChild(makePropGroup('Y:', makeNumberInput(p.y || 0, -10, 10, 0.1, v => {
        p.y = v; markProjectDirty();
      })));
      const pdel = document.createElement('button');
      pdel.type = 'button'; pdel.className = 'component-mini-btn danger';
      pdel.textContent = 'x';
      pdel.onclick = () => { b.points.splice(pIdx, 1); markProjectDirty(); refresh(); };
      prow.appendChild(pdel);
      card.appendChild(prow);
    });

    const addPt = document.createElement('button');
    addPt.type = 'button'; addPt.className = 'component-mini-btn';
    addPt.textContent = '+ Add direction';
    addPt.onclick = () => {
      b.points.push({ animation: animations[0] || '', x: 0, y: 0 });
      markProjectDirty(); refresh();
    };
    card.appendChild(addPt);
    section.appendChild(card);
  });

  const addBtn = document.createElement('button');
  addBtn.type = 'button'; addBtn.className = 'component-mini-btn';
  addBtn.textContent = '+ Add blend space';
  addBtn.onclick = () => {
    blends.push({ name: 'Blend ' + (blends.length + 1), fps: 8, points: [] });
    markProjectDirty(); refresh();
  };
  section.appendChild(addBtn);
  section.appendChild(makeNote('A blend space mixes the object\u2019s animations by two values, X and Y. Place an animation at each direction point — for example Idle at 0,0 and Walk Right at 1,0 — then set X and Y from the logic grid with the Set Blend block (usually from input actions every frame). The engine crossfades between the nearest animations.'));

  root.appendChild(section);
}

// P4 Advanced (2D lighting): the Inspector Lighting section — any 2D
// object can emit light, and any 2D object can cast a shadow. Light
// objects (light2d) start with Emit on; every other 2D kind starts off.
// Lights only show when the scene has Darkness above 0 (Scene Settings).
function appendLight2dEditor(root, obj) {
  const L2 = window.HydraLight2d;
  if (!L2 || !obj) return;
  if (window.Hydra3d && (window.Hydra3d.is3dKind(obj.kind) || window.Hydra3d.isLight3d(obj.kind))) return;
  const section = document.createElement('div');
  section.className = 'light2d-editor';
  const title = document.createElement('div');
  title.className = 'property-mini-title';
  title.textContent = 'Lighting';
  section.appendChild(title);
  function lightRec() {
    if (!obj.light || typeof obj.light !== 'object') obj.light = {};
    L2.normalizeLight2d(obj);
    return obj.light;
  }
  function refreshGlyph() {
    const el = document.querySelector(`.game-object[data-id="${obj.id}"]`);
    if (el && L2.isLight2d(obj.kind)) drawLight2dElement(obj, el);
  }
  const emitting = !!(obj.light && obj.light.enabled !== false);
  section.appendChild(makeCheckbox('Emit light', emitting, v => {
    const l = lightRec();
    l.enabled = v;
    refreshGlyph();
    markProjectDirty();
    showObjectProperties(obj);
  }));
  const l = obj.light && typeof obj.light === 'object' ? obj.light : null;
  section.appendChild(makePropGroup('Light radius:', makeNumberInput(l ? (Number(l.radius) || 0) : 220, 0, 4000, 10, v => {
    lightRec().radius = v;
    markProjectDirty();
  })));
  const colorInput = document.createElement('input');
  colorInput.type = 'color'; colorInput.className = 'property-input'; colorInput.style.height = '36px';
  colorInput.value = (l && /^#([0-9a-fA-F]{6})$/.test(l.color || '')) ? l.color : '#ffffff';
  colorInput.addEventListener('input', e => {
    lightRec().color = e.target.value;
    refreshGlyph();
    markProjectDirty();
  });
  section.appendChild(makePropGroup('Light color:', colorInput));
  section.appendChild(makePropGroup('Light intensity:', makeNumberInput(l ? (Number(l.intensity) || 0) : 1, 0, 1, 0.05, v => {
    lightRec().intensity = v;
    markProjectDirty();
  })));
  section.appendChild(makeCheckbox('Cast shadow', obj.castShadow === true, v => {
    obj.castShadow = v;
    markProjectDirty();
  }));
  section.appendChild(makeNote('Emit light punches a soft round hole in the scene darkness, centered on this object. Cast shadow blocks the light — a shadow stretches away from the light behind this object. Both only show when the scene Darkness is above 0 (Scene Settings); the Set Light block changes a light while the game runs.'));
  root.appendChild(section);
}

// P4 Advanced batch 16 (parallax backgrounds): the Inspector Parallax
// section — per-object scroll factors. 1 moves with the world (the old
// behavior); 0 stays pinned to the camera, like a sky; 0.5 moves at half
// speed, like distant hills; above 1 rushes past, like a foreground.
// Drawing-only, like flip/scale: physics and collision keep the world
// position, so this belongs on decoration layers. 3D kinds and lights
// skip it — the 3D pass and the light projection use world positions.
function appendParallaxEditor(root, obj) {
  const PX = window.HydraParallax;
  if (!PX || !obj) return;
  if (window.Hydra3d && (window.Hydra3d.is3dKind(obj.kind) || window.Hydra3d.isLight3d(obj.kind))) return;
  if (window.HydraLight2d && window.HydraLight2d.isLight2d(obj.kind)) return;
  const section = document.createElement('div');
  section.className = 'parallax-editor';
  const title = document.createElement('div');
  title.className = 'property-mini-title';
  title.textContent = 'Parallax';
  section.appendChild(title);
  PX.normalizeParallax(obj);
  section.appendChild(makePropGroup('Parallax X:', makeNumberInput(Number(obj.parallaxX), 0, 2, 0.05, v => {
    PX.normalizeParallax(obj);
    obj.parallaxX = PX.normalizeParallaxFactor(v);
    markProjectDirty();
  })));
  section.appendChild(makePropGroup('Parallax Y:', makeNumberInput(Number(obj.parallaxY), 0, 2, 0.05, v => {
    PX.normalizeParallax(obj);
    obj.parallaxY = PX.normalizeParallaxFactor(v);
    markProjectDirty();
  })));
  section.appendChild(makeNote('How fast this object scrolls with the camera. 1 moves with the world; 0 stays pinned to the screen, like a sky; 0.5 moves at half speed, like distant hills; above 1 rushes past, like a foreground. Drawing only — physics and collision still use the world position, so keep parallax on decoration layers. Clicks and hover follow the drawn position. Set Parallax changes these while the game runs.'));
  root.appendChild(section);
}

// P4 Advanced batch 21 (health & damage): the Inspector Health
// section — per-object hit points. Max health is the ceiling (1 to
// 10000); Health is what is left, clamped into 0..max; Show health
// bar draws the small green/amber/red bar above the object while it
// runs. 3D kinds, lights, and tilemaps skip it — a bar over a whole
// tilemap or a light makes no sense, and the 3D pass draws its own
// picture. Damage / Heal / Set Health / Set Max Health change these
// while the game runs.
function appendHealthEditor(root, obj) {
  const HH = window.HydraHealth;
  if (!HH || !obj) return;
  if (window.Hydra3d && (window.Hydra3d.is3dKind(obj.kind) || window.Hydra3d.isLight3d(obj.kind))) return;
  if (window.HydraLight2d && window.HydraLight2d.isLight2d(obj.kind)) return;
  if (obj.kind === 'tilemap') return;
  const section = document.createElement('div');
  section.className = 'health-editor';
  const title = document.createElement('div');
  title.className = 'property-mini-title';
  title.textContent = 'Health';
  section.appendChild(title);
  HH.normalizeHealth(obj);
  section.appendChild(makePropGroup('Max health:', makeNumberInput(Number(obj.maxHealth), 1, 10000, 1, v => {
    HH.normalizeHealth(obj);
    obj.maxHealth = HH.normalizeMaxHealth(v);
    HH.normalizeHealth(obj);
    markProjectDirty();
  })));
  section.appendChild(makePropGroup('Health:', makeNumberInput(Number(obj.health), 0, Number(obj.maxHealth), 1, v => {
    HH.normalizeHealth(obj);
    obj.health = HH.normalizeHealthValue(v, obj.maxHealth);
    markProjectDirty();
  })));
  section.appendChild(makeCheckbox('Show health bar', obj.showHealthBar === true, v => {
    HH.normalizeHealth(obj);
    obj.showHealthBar = v === true;
    markProjectDirty();
  }));
  section.appendChild(makeNote('Hit points for this object. Damage Object takes some off (stopping at 0), Heal Object gives some back (stopping at the max), and Object Died fires once when the health reaches 0. The bar draws above the object while the game runs — green over half, amber over a quarter, red below. A fresh run starts at these values.'));
  root.appendChild(section);
}

// P4 Advanced batch 34 (object tags): the Inspector Tags section —
// the object's authored tags as removable chips, plus an add box.
// Tags are plain labels (a goblin, a coin, a boss): Has Tag asks
// whether an object carries one, Tagged Count counts the live
// objects carrying one. Matching ignores case, so "Goblin" and
// "goblin" are the same tag; the first spelling wins. Runtime
// blocks (Add / Remove / Clear Tag) change the live object's tags
// until the scene loads again; these chips are the permanent ones.
function appendTagsEditor(root, obj) {
  const TG = window.HydraTags;
  if (!TG || !obj) return;
  const section = document.createElement('div');
  section.className = 'tags-editor';
  const title = document.createElement('div');
  title.className = 'property-mini-title';
  title.textContent = 'Tags';
  section.appendChild(title);
  TG.normalizeTagsOn(obj);
  const chips = document.createElement('div');
  chips.className = 'tags-chips';
  function renderChips() {
    chips.innerHTML = '';
    TG.normalizeTagsOn(obj);
    if (!obj.tags.length) {
      const none = document.createElement('div');
      none.className = 'tags-empty';
      none.textContent = 'No tags yet.';
      chips.appendChild(none);
      return;
    }
    obj.tags.forEach(function (tag) {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.textContent = tag;
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'tag-chip-x';
      x.textContent = '×';
      x.setAttribute('aria-label', 'Remove tag ' + tag);
      x.addEventListener('click', function () {
        TG.removeTag(obj, tag);
        markProjectDirty();
        renderChips();
      });
      chip.appendChild(x);
      chips.appendChild(chip);
    });
  }
  renderChips();
  section.appendChild(chips);
  const addRow = document.createElement('div');
  addRow.className = 'tags-add-row';
  const input = makeTextInput('', 'Add a tag…', function () {});
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); addBtn.click(); }
  });
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'component-mini-btn';
  addBtn.textContent = 'Add tag';
  addBtn.addEventListener('click', function () {
    if (TG.addTag(obj, input.value)) {
      markProjectDirty();
      renderChips();
    }
    input.value = '';
    input.focus();
  });
  addRow.appendChild(input);
  addRow.appendChild(addBtn);
  section.appendChild(addRow);
  section.appendChild(makeNote('Labels for this object, like goblin or coin. Has Tag asks whether an object carries one, Tagged Count counts the live objects carrying one — so a win row is Tagged Count goblin equals 0. Matching ignores capitals. Add Tag, Remove Tag, and Clear Tags change the tags while the game runs; these chips are the ones a fresh run starts with.'));
  root.appendChild(section);
}

// P4 Advanced batch 26 (movement abilities): the Inspector Movement
// section — per-object jump config. Max jumps is how many jumps the
// object gets before it must land again (1 is a single jump, 2 is the
// classic double jump); Coyote time is the grace window in seconds
// after walking off a ledge during which a jump still counts; Jump
// buffer is how long a jump press is remembered for when no jump is
// available, so it fires on landing. P4 Advanced batch 28 (wall slide
// & wall jump): Wall slide max fall caps the fall in px/s while the
// object presses toward a solid wall (0 turns the slide off); Wall
// jump speed and Wall jump push are the push-off the Jump block
// performs while the object touches a wall. 3D kinds, lights, and
// tilemaps skip it — jumping is a 2D physics move. Jump / Dash /
// Set Max Jumps / Set Coyote Time / Set Jump Buffer / Set Wall Slide
// / Set Wall Jump change these while the game runs.
function appendMovementEditor(root, obj) {
  const MV = window.HydraMovement;
  if (!MV || !obj) return;
  if (window.Hydra3d && (window.Hydra3d.is3dKind(obj.kind) || window.Hydra3d.isLight3d(obj.kind))) return;
  if (window.HydraLight2d && window.HydraLight2d.isLight2d(obj.kind)) return;
  if (obj.kind === 'tilemap') return;
  const section = document.createElement('div');
  section.className = 'movement-editor';
  const title = document.createElement('div');
  title.className = 'property-mini-title';
  title.textContent = 'Movement';
  section.appendChild(title);
  if (!obj.movement || typeof obj.movement !== 'object') obj.movement = {};
  MV.normalizeMovementConfig(obj.movement);
  section.appendChild(makePropGroup('Max jumps:', makeNumberInput(Number(obj.movement.maxJumps), 1, 10, 1, v => {
    MV.normalizeMovementConfig(obj.movement);
    obj.movement.maxJumps = MV.normalizeMaxJumps(v);
    markProjectDirty();
  })));
  section.appendChild(makePropGroup('Coyote time (s):', makeNumberInput(Number(obj.movement.coyoteSeconds), 0, 1, 0.05, v => {
    MV.normalizeMovementConfig(obj.movement);
    obj.movement.coyoteSeconds = MV.normalizeCoyoteSeconds(v);
    markProjectDirty();
  })));
  section.appendChild(makePropGroup('Jump buffer (s):', makeNumberInput(Number(obj.movement.bufferSeconds), 0, 1, 0.05, v => {
    MV.normalizeMovementConfig(obj.movement);
    obj.movement.bufferSeconds = MV.normalizeBufferSeconds(v);
    markProjectDirty();
  })));
  section.appendChild(makePropGroup('Wall slide max fall (px/s):', makeNumberInput(Number(obj.movement.wallSlideMaxFall), 0, 2000, 10, v => {
    MV.normalizeMovementConfig(obj.movement);
    obj.movement.wallSlideMaxFall = MV.normalizeWallSlideMaxFall(v);
    markProjectDirty();
  })));
  section.appendChild(makePropGroup('Wall jump speed:', makeNumberInput(Number(obj.movement.wallJumpSpeed), 0, 100, 1, v => {
    MV.normalizeMovementConfig(obj.movement);
    obj.movement.wallJumpSpeed = MV.normalizeWallJumpSpeed(v);
    markProjectDirty();
  })));
  section.appendChild(makePropGroup('Wall jump push:', makeNumberInput(Number(obj.movement.wallJumpPush), 0, 100, 1, v => {
    MV.normalizeMovementConfig(obj.movement);
    obj.movement.wallJumpPush = MV.normalizeWallJumpPush(v);
    markProjectDirty();
  })));
  section.appendChild(makeNote('How this object jumps. Max jumps 2 is the classic double jump — the Jump block spends them one at a time and landing refills them. Coyote time lets a jump pressed just after walking off a ledge still count; jump buffer remembers a press just before landing and fires it on landing. Wall slide caps the fall at the px/s you set while the object presses toward a solid wall (arrow keys or A/D) — 60 is a slow slide, 0 turns it off. Wall jump is the push off a wall: the Jump block performs it while the object touches a wall, up at the jump speed and away at the push, costing one air jump and one wall jump per wall until landing. A fresh run starts at these values.'));
  root.appendChild(section);
}

// P4 Advanced batch 27 (moving platforms & one-way platforms): the
// Inspector Platform section — per-object waypoint path, speed, mode,
// one-way flag, and crumble delay. Point 1 and Point 2 are absolute
// world positions (the platform's top-left corner travels between
// them); Speed is px per second; Ping-pong goes there and back, Loop
// jumps back to the first point and starts over. Turning the platform
// on with no path yet seeds one from where it stands (200px to the
// right and back). 3D kinds, lights, and tilemaps skip it — platforms
// are a 2D physics move. Set Platform Path / Set One-Way Platform /
// Set Crumble Time change these while the game runs.
function appendPlatformEditor(root, obj) {
  const PF = window.HydraPlatform;
  if (!PF || !obj) return;
  if (window.Hydra3d && (window.Hydra3d.is3dKind(obj.kind) || window.Hydra3d.isLight3d(obj.kind))) return;
  if (window.HydraLight2d && window.HydraLight2d.isLight2d(obj.kind)) return;
  if (obj.kind === 'tilemap') return;
  const section = document.createElement('div');
  section.className = 'platform-editor';
  const title = document.createElement('div');
  title.className = 'property-mini-title';
  title.textContent = 'Platform';
  section.appendChild(title);
  if (!obj.platform || typeof obj.platform !== 'object') obj.platform = {};
  PF.normalizePlatformConfig(obj.platform, obj);
  function seedPoints() {
    PF.normalizePlatformConfig(obj.platform, obj);
    if (obj.platform.points.length < 2) {
      const x = Number(obj.posX) || 0, y = Number(obj.posY) || 0;
      obj.platform.points = [{ x: x, y: y }, { x: x + 200, y: y }];
    }
  }
  function pointAt(i) {
    const pts = obj.platform.points || [];
    if (pts[i]) return pts[i];
    const x = Number(obj.posX) || 0, y = Number(obj.posY) || 0;
    return i === 0 ? { x: x, y: y } : { x: x + 200, y: y };
  }
  function writePoint(i, x, y) {
    PF.normalizePlatformConfig(obj.platform, obj);
    const pts = obj.platform.points.slice();
    while (pts.length <= i) {
      const px = Number(obj.posX) || 0, py = Number(obj.posY) || 0;
      pts.push({ x: px, y: py });
    }
    pts[i] = { x: x, y: y };
    obj.platform.points = PF.normalizePoints(pts);
    markProjectDirty();
  }
  section.appendChild(makeCheckbox('Moving platform', obj.platform.enabled === true, v => {
    PF.normalizePlatformConfig(obj.platform, obj);
    obj.platform.enabled = v === true;
    if (v === true) seedPoints();
    markProjectDirty();
  }));
  const p1 = pointAt(0), p2 = pointAt(1);
  section.appendChild(makePropGroup('Point 1 X:', makeNumberInput(Number(p1.x), -99999, 99999, 1, v => {
    writePoint(0, v, pointAt(0).y);
  })));
  section.appendChild(makePropGroup('Point 1 Y:', makeNumberInput(Number(p1.y), -99999, 99999, 1, v => {
    writePoint(0, pointAt(0).x, v);
  })));
  section.appendChild(makePropGroup('Point 2 X:', makeNumberInput(Number(p2.x), -99999, 99999, 1, v => {
    writePoint(1, v, pointAt(1).y);
  })));
  section.appendChild(makePropGroup('Point 2 Y:', makeNumberInput(Number(p2.y), -99999, 99999, 1, v => {
    writePoint(1, pointAt(1).x, v);
  })));
  section.appendChild(makePropGroup('Speed (px/s):', makeNumberInput(Number(obj.platform.speed), 0, 1000, 5, v => {
    PF.normalizePlatformConfig(obj.platform, obj);
    obj.platform.speed = PF.normalizeSpeed(v);
    markProjectDirty();
  })));
  section.appendChild(makePropGroup('Mode:', makeSelect(
    [['pingpong', 'Ping-pong'], ['loop', 'Loop']],
    obj.platform.mode || 'pingpong',
    v => {
      PF.normalizePlatformConfig(obj.platform, obj);
      obj.platform.mode = PF.normalizeMode(v);
      markProjectDirty();
    }
  )));
  section.appendChild(makeCheckbox('One-way platform (land from above only)', obj.platform.oneWay === true, v => {
    PF.normalizePlatformConfig(obj.platform, obj);
    obj.platform.oneWay = v === true;
    if (!obj.collision || typeof obj.collision !== 'object') obj.collision = {};
    obj.collision.oneWay = v === true;
    markProjectDirty();
  }));
  section.appendChild(makePropGroup('Crumble after (s):', makeNumberInput(Number(obj.platform.crumbleSeconds), 0, 30, 0.5, v => {
    PF.normalizePlatformConfig(obj.platform, obj);
    obj.platform.crumbleSeconds = PF.normalizeCrumbleSeconds(v);
    markProjectDirty();
  })));
  section.appendChild(makeNote('How this platform moves. A moving platform slides between its two points and carries anything standing on it — 60 px/s is a gentle ride. One-way means jump up through it from below and land on it from above. Crumble after sets how long it holds once a rider stands on it before it falls away (0 means it never crumbles). A fresh run starts at these values.'));
  root.appendChild(section);
}

// P4 Advanced (physics joints): the Inspector Joints section — the
// scene joints linking this object to another object by name. Joints
// live on the scene (not the object), so this section lists the joints
// where this object is either end; adding one here is the no-blocks
// on-ramp, and the Create Joint / Remove Joint blocks do the same thing
// at runtime. 2D physics objects only: 3D kinds, lights, and tilemaps
// never solve joints.
function appendJointEditor(root, obj) {
  const J = window.HydraJoints;
  if (!J || !obj) return;
  if (window.Hydra3d && (window.Hydra3d.is3dKind(obj.kind) || window.Hydra3d.isLight3d(obj.kind))) return;
  if (window.HydraLight2d && window.HydraLight2d.isLight2d(obj.kind)) return;
  if (obj.kind === 'tilemap') return;
  const scene = getCurrentScene();
  if (!scene) return;
  J.normalizeJoints(scene);
  const section = document.createElement('div');
  section.className = 'joints-editor';
  const title = document.createElement('div');
  title.className = 'property-mini-title';
  title.textContent = 'Joints';
  section.appendChild(title);
  // Joints link objects by NAME, so an unnamed object cannot be an
  // endpoint: a fresh sprite starts with a blank name, and a joint
  // written with a blank end would be dropped by normalization on the
  // next render. Say so plainly instead of showing a form that silently
  // eats the joint. (Not makeNote: property help notes are hidden by
  // default, and this prompt must be visible to be useful.)
  if (!obj.name) {
    const prompt = document.createElement('div');
    prompt.className = 'property-group';
    const promptText = document.createElement('span');
    promptText.textContent = 'Joints link objects by name. Give this object a name in the Name field above, then add joints here.';
    prompt.appendChild(promptText);
    section.appendChild(prompt);
    root.appendChild(section);
    return;
  }
  const mine = scene.joints.filter(j => j.a === obj.name || j.b === obj.name);
  mine.forEach(j => {
    const row = document.createElement('div');
    row.className = 'animation-card-row';
    const label = document.createElement('span');
    const other = j.a === obj.name ? j.b : j.a;
    label.textContent = j.type + ': ' + other + ' (' +
      (j.length == null ? 'auto' : Math.round(j.length) + 'px') +
      (j.type === 'spring' ? ', stiffness ' + j.stiffness : '') + ')';
    row.appendChild(label);
    const delBtn = document.createElement('button');
    delBtn.type = 'button'; delBtn.className = 'component-mini-btn danger-btn';
    delBtn.textContent = 'Delete';
    delBtn.onclick = () => {
      scene.joints = scene.joints.filter(x => x !== j);
      markProjectDirty();
      showObjectProperties(obj);
    };
    row.appendChild(delBtn);
    section.appendChild(row);
  });
  const others = [];
  (scene.objects || []).forEach(o => {
    if (o.id !== obj.id && o.name && others.indexOf(o.name) === -1) others.push(o.name);
  });
  let newOther = others[0] || '';
  let newType = 'rope';
  let newLength = '';
  let newStiffness = 0.05;
  section.appendChild(makePropGroup('Other object:', makeSelect(
    others.map(n => [n, n]), newOther, v => { newOther = v; })));
  section.appendChild(makePropGroup('Joint type:', makeSelect(
    [['distance', 'Distance (rigid rod)'], ['rope', 'Rope (max length)'], ['spring', 'Spring (stretchy)']],
    newType, v => { newType = v; })));
  section.appendChild(makePropGroup('Length (blank = current distance):', makeTextInput(
    '', 'e.g. 160', v => { newLength = v; })));
  section.appendChild(makePropGroup('Stiffness (spring only):', makeNumberInput(
    newStiffness, 0, 1, 0.01, v => { newStiffness = v; })));
  const addBtn = document.createElement('button');
  addBtn.type = 'button'; addBtn.className = 'component-mini-btn';
  addBtn.textContent = '+ Add joint';
  addBtn.onclick = () => {
    if (!newOther) return;
    const target = (scene.objects || []).find(o => o.name === newOther);
    let len = null;
    const parsed = parseFloat(newLength);
    if (newLength.trim() !== '' && Number.isFinite(parsed) && parsed >= 0) len = parsed;
    else if (target) len = J.distanceBetween(obj, target);
    J.normalizeJoints(scene);
    scene.joints = scene.joints.filter(j => {
      const samePair = (j.a === obj.name && j.b === newOther) || (j.a === newOther && j.b === obj.name);
      return !(samePair && j.type === newType);
    });
    scene.joints.push({ type: newType, a: obj.name, b: newOther, length: len, stiffness: newStiffness });
    markProjectDirty();
    showObjectProperties(obj);
  };
  section.appendChild(addBtn);
  section.appendChild(makeNote('A joint links this object to another object: Distance holds the two centers a fixed length apart like a rigid rod, Rope lets them come closer but never stretch past the length like a chain, Spring pulls them toward the length like a stretchy cord. Static objects act as anchors that never move. Change joints while the game runs with the Create Joint and Remove Joint blocks; read them with the Joint Connected condition.'));
  root.appendChild(section);
}

// P4 Advanced (skeletal animation): the Inspector Skeleton section — the
// bone rig and its keyframed angle tracks, with a live mini preview of
// the rest pose. Bones draw over the sprite in Preview and exported
// games (or instead of it with Hide sprite); the Play / Stop / Set Bone
// Angle blocks drive the same rig at runtime.
function appendSkeletonEditor(root, obj) {
  const SK = window.HydraSkeleton;
  if (!SK || !obj) return;
  const skel = SK.normalizeSkeleton(obj);
  const imageAssets = Object.keys(assetLibrary).filter(id => (assetLibrary[id].kind || '') === 'image');

  const section = document.createElement('div');
  section.className = 'skeleton-editor';
  const title = document.createElement('div');
  title.className = 'property-mini-title';
  title.textContent = 'Skeleton';
  section.appendChild(title);

  const refresh = () => showObjectProperties(obj);

  // Renaming a skeletal animation repoints every skeleton block that used
  // the old name on this object (mirrors propagateBlendRename, scoped to
  // blocks aimed at this object or at no object yet).
  function propagateSkeletonAnimationRename(oldName, newName) {
    if (!oldName || oldName === newName) return;
    const visit = (d) => {
      if (d && (d.type === 'playSkeletonAnimation' || d.type === 'stopSkeletonAnimation' || d.type === 'skeletonPlaying') &&
        d.animation === oldName && (!d.object1 || d.object1 === obj.name)) {
        d.animation = newName;
      }
    };
    const scanGrid = (g) => {
      if (!g) return;
      if (g instanceof Map) g.forEach(visit);
      else Object.values(g).forEach(visit);
    };
    scanGrid(cellData);
    scanGrid(globalGridData);
    (scenes || []).forEach(s => scanGrid(s.gridData));
    markProjectDirty();
  }

  // Renaming a bone repoints its children's parent links, its tracks on
  // this object, and Set Bone Angle blocks aimed at this object.
  function propagateBoneRename(oldName, newName) {
    if (!oldName || oldName === newName) return;
    skel.bones.forEach(b => { if (b.parent === oldName) b.parent = newName; });
    skel.animations.forEach(a => (a.tracks || []).forEach(t => { if (t.bone === oldName) t.bone = newName; }));
    const visit = (d) => {
      if (d && d.type === 'setBoneAngle' && d.bone === oldName && (!d.object1 || d.object1 === obj.name)) {
        d.bone = newName;
      }
    };
    const scanGrid = (g) => {
      if (!g) return;
      if (g instanceof Map) g.forEach(visit);
      else Object.values(g).forEach(visit);
    };
    scanGrid(cellData);
    scanGrid(globalGridData);
    (scenes || []).forEach(s => scanGrid(s.gridData));
    markProjectDirty();
  }

  section.appendChild(makeCheckbox('Hide sprite, draw bones only', skel.hideSprite === true, v => {
    skel.hideSprite = v;
    markProjectDirty();
    showObjectProperties(obj);
  }));

  // Mini rig preview: the rest pose, fitted into the canvas.
  const preview = document.createElement('canvas');
  preview.width = 220; preview.height = 150;
  preview.style.cssText = 'width:220px;height:150px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:4px;';
  section.appendChild(preview);
  const pctx = preview.getContext('2d');
  if (pctx) {
    const segs = SK.boneSegmentsLocal(obj, SK.currentBoneAngles(null, obj));
    let extent = 0;
    segs.forEach(s => {
      extent = Math.max(extent, Math.abs(s.x1), Math.abs(s.y1), Math.abs(s.x2), Math.abs(s.y2));
    });
    const scale = extent > 100 ? 100 / extent : 1;
    pctx.clearRect(0, 0, 220, 150);
    pctx.save();
    pctx.translate(110, 75);
    pctx.scale(scale, scale);
    SK.drawSkeleton(pctx, segs, (id) => (id && assetLibrary[id]) ? getImage(id) : null);
    pctx.restore();
  }

  skel.bones.forEach((b, bIdx) => {
    const card = document.createElement('div');
    card.className = 'animation-card';

    const header = document.createElement('div');
    header.className = 'animation-card-header';
    const nameInput = makeTextInput(b.name || '', 'e.g. arm', v => { b.name = v; });
    nameInput.style.flex = '1';
    let nameBeforeEdit = b.name;
    nameInput.addEventListener('focus', () => { nameBeforeEdit = b.name; });
    nameInput.addEventListener('change', () => {
      SK.normalizeSkeleton(obj);
      propagateBoneRename(nameBeforeEdit, b.name);
      refresh();
    });
    const delBtn = document.createElement('button');
    delBtn.type = 'button'; delBtn.className = 'component-mini-btn danger';
    delBtn.textContent = 'Delete';
    delBtn.onclick = () => {
      // Children hang off the deleted bone's parent; its tracks go away.
      skel.bones.forEach(other => { if (other.parent === b.name) other.parent = b.parent; });
      skel.animations.forEach(a => { a.tracks = (a.tracks || []).filter(t => t.bone !== b.name); });
      skel.bones.splice(bIdx, 1);
      markProjectDirty(); refresh();
    };
    header.appendChild(nameInput);
    header.appendChild(delBtn);
    card.appendChild(header);

    const parentRow = document.createElement('div');
    parentRow.className = 'animation-card-row';
    parentRow.appendChild(makePropGroup('Parent:', makeSelect(
      [['', 'Root (object center)']].concat(skel.bones.filter(other => other !== b).map(other => [other.name, other.name])),
      b.parent || '',
      v => { b.parent = v; markProjectDirty(); refresh(); }
    )));
    parentRow.appendChild(makePropGroup('Length:', makeNumberInput(b.length || 0, 0, 1000, 1, v => {
      b.length = v; markProjectDirty();
    })));
    card.appendChild(parentRow);

    const angleRow = document.createElement('div');
    angleRow.className = 'animation-card-row';
    angleRow.appendChild(makePropGroup('Angle:', makeNumberInput(b.angle || 0, -360, 360, 1, v => {
      b.angle = v; markProjectDirty();
    })));
    angleRow.appendChild(makePropGroup('Thickness:', makeNumberInput(b.width || 10, 1, 64, 1, v => {
      b.width = v; markProjectDirty();
    })));
    card.appendChild(angleRow);

    const colorInput = document.createElement('input');
    colorInput.type = 'color'; colorInput.className = 'property-input'; colorInput.style.height = '36px';
    colorInput.value = (/^#([0-9a-fA-F]{6})$/.test(b.color || '')) ? b.color :
      (/^#([0-9a-fA-F]{6})$/.test(obj.color || '')) ? obj.color : '#334155';
    colorInput.addEventListener('input', e => {
      b.color = e.target.value;
      markProjectDirty();
    });
    const lookRow = document.createElement('div');
    lookRow.className = 'animation-card-row';
    lookRow.appendChild(makePropGroup('Bone color:', colorInput));
    lookRow.appendChild(makePropGroup('Bone image:', makeSelect(
      [['', 'None (limb line)']].concat(imageAssets.map(id => [id, assetLibrary[id].name || id])),
      b.image || '',
      v => { b.image = v; markProjectDirty(); }
    )));
    card.appendChild(lookRow);
    section.appendChild(card);
  });

  const addBoneBtn = document.createElement('button');
  addBoneBtn.type = 'button'; addBoneBtn.className = 'component-mini-btn';
  addBoneBtn.textContent = '+ Add bone';
  addBoneBtn.onclick = () => {
    skel.bones.push({ name: 'Bone ' + (skel.bones.length + 1), parent: '', length: 40, angle: 0, color: '', image: '', width: 10 });
    markProjectDirty(); refresh();
  };
  section.appendChild(addBoneBtn);

  skel.animations.forEach((a, aIdx) => {
    const card = document.createElement('div');
    card.className = 'animation-card';

    const header = document.createElement('div');
    header.className = 'animation-card-header';
    const nameInput = makeTextInput(a.name || '', 'e.g. Walk', v => { a.name = v; });
    nameInput.style.flex = '1';
    let nameBeforeEdit = a.name;
    nameInput.addEventListener('focus', () => { nameBeforeEdit = a.name; });
    nameInput.addEventListener('change', () => {
      SK.normalizeSkeleton(obj);
      propagateSkeletonAnimationRename(nameBeforeEdit, a.name);
      refresh();
    });
    const delBtn = document.createElement('button');
    delBtn.type = 'button'; delBtn.className = 'component-mini-btn danger';
    delBtn.textContent = 'Delete';
    delBtn.onclick = () => {
      skel.animations.splice(aIdx, 1);
      markProjectDirty(); refresh();
    };
    header.appendChild(nameInput);
    header.appendChild(delBtn);
    card.appendChild(header);

    const speedRow = document.createElement('div');
    speedRow.className = 'animation-card-row';
    speedRow.appendChild(makePropGroup('Speed (fps):', makeNumberInput(a.fps || 8, 1, 60, 1, v => {
      a.fps = v; markProjectDirty();
    })));
    speedRow.appendChild(makePropGroup('Mode:', makeSelect(
      [['loop', 'Loop'], ['pingpong', 'Ping-pong'], ['once', 'Once (hold last frame)']],
      a.mode || 'loop',
      v => { a.mode = v; markProjectDirty(); }
    )));
    card.appendChild(speedRow);

    (a.tracks || []).forEach((t, tIdx) => {
      const trow = document.createElement('div');
      trow.className = 'animation-card-row';
      trow.appendChild(makePropGroup('Bone:', makeSelect(
        [['', '-- Choose bone --']].concat(skel.bones.map(bb => [bb.name, bb.name])),
        t.bone || '',
        v => { t.bone = v; markProjectDirty(); }
      )));
      const anglesInput = makeTextInput((t.angles || []).join(', '), 'e.g. 0, 40, 0, -40', v => {
        const parsed = v.split(',').map(s => parseFloat(s.trim())).filter(n => Number.isFinite(n));
        if (parsed.length > 0) t.angles = parsed;
      });
      anglesInput.addEventListener('change', () => {
        if (!t.angles || t.angles.length === 0) anglesInput.value = '';
        else anglesInput.value = t.angles.join(', ');
        markProjectDirty(); refresh();
      });
      trow.appendChild(makePropGroup('Angles:', anglesInput));
      const tdel = document.createElement('button');
      tdel.type = 'button'; tdel.className = 'component-mini-btn danger';
      tdel.textContent = 'x';
      tdel.onclick = () => { a.tracks.splice(tIdx, 1); markProjectDirty(); refresh(); };
      trow.appendChild(tdel);
      card.appendChild(trow);
    });

    const addTrack = document.createElement('button');
    addTrack.type = 'button'; addTrack.className = 'component-mini-btn';
    addTrack.textContent = '+ Add track';
    addTrack.onclick = () => {
      a.tracks.push({ bone: skel.bones.length ? skel.bones[0].name : '', angles: [0] });
      markProjectDirty(); refresh();
    };
    card.appendChild(addTrack);
    section.appendChild(card);
  });

  const addAnimBtn = document.createElement('button');
  addAnimBtn.type = 'button'; addAnimBtn.className = 'component-mini-btn';
  addAnimBtn.textContent = '+ Add animation';
  addAnimBtn.onclick = () => {
    skel.animations.push({ name: 'Pose ' + (skel.animations.length + 1), fps: 8, mode: 'loop', tracks: [] });
    markProjectDirty(); refresh();
  };
  section.appendChild(addAnimBtn);
  section.appendChild(makeNote('A skeleton is a tree of bones drawn over this object: the root bone starts at the object center, each child hangs off its parent\'s tip, and posing a parent swings everything below it. Angles are degrees — 0 points right, 90 points down. A bone with no image draws as a limb line; a bone image stretches along the bone, so draw limb art as a horizontal strip. An animation is one angle list per bone, stepping at its fps; tracks shorter than the animation wrap at their own length. Play it with the Play Skeleton Animation block, pose a bone by hand with Set Bone Angle (a posed bone wins over a track until a new animation starts), and read it with Skeleton Playing. Hide sprite draws bones only, for a pure stick figure.'));
  root.appendChild(section);
}

// P4 item 31: tilemap inspector — tileset, tile size, map size, brush +
// solid-tile tileset strip, paint/move mode, edit-as-text.
function appendTilemapEditor(root, obj) {
  const T = window.HydraTiles;
  if (!T || !obj || obj.kind !== 'tilemap') return;
  T.applyToObject(obj); // repair corrupt fields + sync width/height
  const section = document.createElement('div');
  section.className = 'tilemap-editor';
  const title = document.createElement('div');
  title.className = 'property-mini-title';
  title.textContent = 'Tilemap';
  section.appendChild(title);
  const refresh = () => { refreshTilemapElement(obj); showObjectProperties(obj); };

  // Tileset image
  const imageAssets = Object.keys(assetLibrary).filter(id => (assetLibrary[id].kind || '') === 'image');
  section.appendChild(makePropGroup('Tileset image:', makeSelect(
    [['', 'None (colored tiles)']].concat(imageAssets.map(id => [id, assetLibrary[id].name || id])),
    obj.tilesetAssetId || '',
    v => { obj.tilesetAssetId = v || null; markProjectDirty(); refresh(); }
  )));
  section.appendChild(makePropGroup('Tile size (px):', makeNumberInput(obj.tileSize || 32, 8, 256, 1, v => {
    obj.tileSize = v; T.syncSize(obj); markProjectDirty(); refresh();
  })));
  section.appendChild(makePropGroup('Tileset columns:', makeNumberInput(obj.tilesetCols || 8, 1, 64, 1, v => {
    obj.tilesetCols = v; markProjectDirty(); drawTilesetStrip();
  })));

  // Map size (resize keeps the tiles that still fit)
  const sizeRow = document.createElement('div');
  sizeRow.className = 'tilemap-size-row';
  const colsWrap = document.createElement('label'); colsWrap.textContent = 'W ';
  colsWrap.appendChild(makeNumberInput(obj.cols || 10, 1, 200, 1, v => { T.resize(obj, v, obj.rows); markProjectDirty(); refresh(); }));
  const rowsWrap = document.createElement('label'); rowsWrap.textContent = 'H ';
  rowsWrap.appendChild(makeNumberInput(obj.rows || 10, 1, 200, 1, v => { T.resize(obj, obj.cols, v); markProjectDirty(); refresh(); }));
  sizeRow.appendChild(colsWrap); sizeRow.appendChild(rowsWrap);
  section.appendChild(makePropGroup('Map size (tiles):', sizeRow));

  // Tileset strip: click picks the brush, right-click toggles solid.
  const stripTitle = document.createElement('div');
  stripTitle.className = 'tilemap-strip-title';
  stripTitle.textContent = 'Tiles — click to pick the brush, right-click to toggle solid';
  section.appendChild(stripTitle);
  const strip = document.createElement('canvas');
  strip.className = 'tilemap-strip';
  section.appendChild(strip);
  const STRIP_ROWS = 4;
  function stripTileIndex(e) {
    const rect = strip.getBoundingClientRect();
    const tcols = obj.tilesetCols || 8;
    const ci = Math.floor((e.clientX - rect.left) / rect.width * tcols);
    const ri = Math.floor((e.clientY - rect.top) / rect.height * STRIP_ROWS);
    if (ci < 0 || ci >= tcols || ri < 0 || ri >= STRIP_ROWS) return -1;
    return ri * tcols + ci;
  }
  function drawTilesetStrip() {
    const ts = obj.tileSize || 32;
    const tcols = obj.tilesetCols || 8;
    const cell = 34;
    strip.width = tcols * cell; strip.height = STRIP_ROWS * cell;
    const g = strip.getContext('2d');
    const img = obj.tilesetAssetId ? getImage(obj.tilesetAssetId) : null;
    const imgOk = !!(img && img.complete && img.naturalWidth > 0);
    if (img && !imgOk) img.addEventListener('load', drawTilesetStrip, { once: true });
    const brush = tileBrushFor(obj);
    const solid = T.solidTilesOf(obj);
    for (let i = 0; i < tcols * STRIP_ROWS; i++) {
      const cx = (i % tcols) * cell, cy = Math.floor(i / tcols) * cell;
      if (imgOk) {
        const s = T.tileSourceXY(i, tcols, ts);
        try { g.drawImage(img, s.sx, s.sy, ts, ts, cx + 1, cy + 1, cell - 2, cell - 2); }
        catch (err) { g.fillStyle = '#334155'; g.fillRect(cx + 1, cy + 1, cell - 2, cell - 2); }
      } else {
        g.fillStyle = 'hsl(' + ((i * 47) % 360) + ',60%,55%)';
        g.fillRect(cx + 1, cy + 1, cell - 2, cell - 2);
        g.fillStyle = 'rgba(15,23,42,0.85)';
        g.font = '10px sans-serif'; g.textBaseline = 'top';
        g.fillText(String(i), cx + 4, cy + 3);
      }
      if (solid.indexOf(i) !== -1) {
        g.fillStyle = '#f59e0b';
        g.fillRect(cx + cell - 14, cy + 2, 12, 12);
        g.fillStyle = '#0f172a'; g.font = 'bold 9px sans-serif';
        g.fillText('S', cx + cell - 11, cy + 3);
      }
      if (brush === i) {
        g.strokeStyle = '#38bdf8'; g.lineWidth = 3;
        g.strokeRect(cx + 1.5, cy + 1.5, cell - 3, cell - 3);
      }
    }
  }
  strip.addEventListener('click', e => {
    const i = stripTileIndex(e);
    if (i < 0) return;
    obj._brushTile = i; markProjectDirty(); drawTilesetStrip(); updateBrushLabel();
  });
  strip.addEventListener('contextmenu', e => {
    e.preventDefault();
    const i = stripTileIndex(e);
    if (i < 0) return;
    const solid = T.solidTilesOf(obj);
    const at = solid.indexOf(i);
    if (at === -1) solid.push(i); else solid.splice(at, 1);
    obj.solidTiles = solid.sort((a, b) => a - b);
    markProjectDirty(); drawTilesetStrip(); updateSolidLabel();
  });

  // Brush row: brush label + eraser + paint/move mode
  const brushRow = document.createElement('div');
  brushRow.className = 'tilemap-brush-row';
  const brushLabel = document.createElement('span');
  brushLabel.className = 'tilemap-brush-label';
  function updateBrushLabel() {
    const b = tileBrushFor(obj);
    brushLabel.textContent = b < 0 ? 'Brush: eraser' : 'Brush: tile ' + b;
  }
  updateBrushLabel();
  const eraserBtn = document.createElement('button');
  eraserBtn.type = 'button'; eraserBtn.className = 'clear-btn'; eraserBtn.textContent = 'Eraser';
  eraserBtn.onclick = () => { obj._brushTile = -1; markProjectDirty(); drawTilesetStrip(); updateBrushLabel(); };
  const modeBtn = document.createElement('button');
  modeBtn.type = 'button'; modeBtn.className = 'clear-btn';
  function updateModeBtn() { modeBtn.textContent = isTilePaintMode(obj) ? 'Mode: Paint' : 'Mode: Move'; }
  updateModeBtn();
  modeBtn.onclick = () => { obj._paintMode = !isTilePaintMode(obj); markProjectDirty(); updateModeBtn(); };
  brushRow.appendChild(brushLabel); brushRow.appendChild(eraserBtn); brushRow.appendChild(modeBtn);
  section.appendChild(brushRow);

  const solidLabel = document.createElement('p');
  solidLabel.className = 'tilemap-solid-label';
  function updateSolidLabel() {
    const s = T.solidTilesOf(obj);
    solidLabel.textContent = 'Solid tiles: ' + (s.length ? s.join(', ') : 'none — nothing collides');
  }
  updateSolidLabel();
  section.appendChild(solidLabel);

  // Edit as text
  const taWrap = document.createElement('div');
  const ta = document.createElement('textarea');
  ta.className = 'property-input tilemap-ascii';
  ta.rows = 6; ta.spellcheck = false;
  ta.value = T.toAscii(obj).join('\n');
  taWrap.appendChild(ta);
  const applyBtn = document.createElement('button');
  applyBtn.type = 'button'; applyBtn.className = 'clear-btn'; applyBtn.textContent = 'Apply text';
  applyBtn.style.marginTop = '6px';
  const asciiErr = document.createElement('p');
  asciiErr.className = 'tilemap-ascii-err';
  applyBtn.onclick = () => {
    try {
      const spec = T.fromAscii(ta.value.split('\n'));
      T.resize(obj, spec.cols, spec.rows);
      obj.tiles = spec.tiles;
      asciiErr.textContent = '';
      markProjectDirty(); refresh();
    } catch (err) { asciiErr.textContent = 'Could not parse the map text.'; }
  };
  taWrap.appendChild(applyBtn); taWrap.appendChild(asciiErr);
  section.appendChild(makePropGroup('Edit as text:', taWrap));
  section.appendChild(makeNote('Text rows use 0-9, a-z and #@$%& for tiles, . or space for empty. Applying text resizes the map to fit.'));

  root.appendChild(section);
  drawTilesetStrip();
}

// P4 item 32: Collision section of the object inspector — collider shape,
// trigger vs solid, one-way platforms, collision layers and masks. Written
// onto obj.collision; normalized by HydraPhysics2D.normalizePhysics2d so
// old projects keep the classic box/solid/layer-0 behavior.
function appendCollisionEditor(root, obj) {
  const P2D = window.HydraPhysics2D;
  if (P2D && typeof P2D.normalizePhysics2d === 'function') P2D.normalizePhysics2d(obj);
  else { obj.collision = obj.collision || {}; }
  const c = obj.collision;

  const hr = document.createElement('hr'); hr.className = 'prop-divider';
  root.appendChild(hr);
  const h = document.createElement('h4');
  h.textContent = 'Collision';
  h.style.cssText = 'margin:10px 0 6px;font-size:13px;color:#e2e8f0;';
  root.appendChild(h);

  root.appendChild(makePropGroup('Shape:', makeSelect(
    [['box', 'Box'], ['circle', 'Circle']],
    c.shape || 'box',
    v => { c.shape = v; }
  )));
  root.appendChild(makeNote('Circle is centered on the hitbox; its radius is half the smaller side. Great for balls and round pickups.'));

  root.appendChild(makePropGroup('Collider:', makeSelect(
    [['solid', 'Solid (blocks movement)'], ['trigger', 'Trigger (reports touches, never blocks)']],
    c.mode || 'solid',
    v => { c.mode = v; }
  )));
  root.appendChild(makeNote('Triggers never push objects away. Use Trigger Enter / Trigger Exit blocks to react when something walks into one.'));

  root.appendChild(makeCheckbox('One-way platform (land from above only)', c.oneWay === true, v => {
    c.oneWay = v;
    // P4 Advanced batch 27 (moving platforms): the platform config
    // carries the same flag — keep the two in step so the Platform
    // section and this checkbox never disagree.
    if (obj.platform && typeof obj.platform === 'object') obj.platform.oneWay = v;
  }));
  root.appendChild(makeNote('Jump up through it from below, land on it from above. Classic platformer ledges.'));

  const layerNames = [];
  for (let i = 0; i < 8; i++) layerNames.push([String(i), 'Layer ' + i]);
  root.appendChild(makePropGroup('Layer:', makeSelect(
    layerNames,
    String(c.layer ?? 0),
    v => { c.layer = Math.max(0, Math.min(7, parseInt(v, 10) || 0)); }
  )));

  const maskWrap = document.createElement('div');
  maskWrap.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;margin:4px 0 2px;';
  const mask = (c.mask == null ? 255 : c.mask) >>> 0;
  const maskBoxes = [];
  for (let i = 0; i < 8; i++) {
    const bit = (mask >> i) & 1;
    const label = document.createElement('label');
    label.className = 'checkbox-row';
    label.style.cssText = 'min-width:0;padding:3px 8px;border:1px solid #475569;border-radius:6px;font-size:12px;cursor:pointer;';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = bit === 1;
    cb.dataset.layerIndex = String(i);
    cb.addEventListener('change', () => {
      let m = 0;
      maskBoxes.forEach(b => { if (b.checked) m |= (1 << parseInt(b.dataset.layerIndex, 10)); });
      c.mask = m;
      markProjectDirty();
    });
    maskBoxes.push(cb);
    label.appendChild(cb);
    const span = document.createElement('span'); span.textContent = String(i);
    label.appendChild(span);
    maskWrap.appendChild(label);
  }
  root.appendChild(makePropGroup('Collides with:', maskWrap));
  root.appendChild(makeNote('Two objects interact only when each one\'s "collides with" includes the other\'s layer. Leave everything checked for classic behavior.'));
}

function showObjectProperties(obj) {
  const panel = document.getElementById('object-properties');
  const root  = document.createElement('div');

  // P5-8 slice b: details summary — the three facts the old panel
  // never showed together (kind, layer, id), so a user can tell
  // two same-named objects apart without opening the outliner.
  const summary = document.createElement('div');
  summary.className = 'object-details-summary';
  summary.textContent = `${obj.archetype || obj.kind} · Layer ${obj.layer || 0} · #${obj.id}`;
  root.appendChild(summary);

  // Name. A blank name is never saved: it is invisible to every
  // object picker yet still matches a blank target at runtime, so
  // clearing the field must restore the previous name instead.
  // (makeTextInput fires per keystroke, so the guard runs on blur,
  // when the name is committed, not while the user is still typing.)
  const prevName = obj.name;
  const nameInput = makeTextInput(obj.name || '', 'e.g. player, wall1, score_text', v => {
    obj.name = v;
    renderObjectList();
  });
  if (nameInput) {
    nameInput.addEventListener('blur', () => {
      const trimmed = (obj.name || '').trim();
      if (!trimmed) {
        obj.name = prevName || 'Sprite';
        showObjectProperties(obj);
        renderObjectList();
      } else if (trimmed !== obj.name) {
        obj.name = trimmed;
        renderObjectList();
      }
    });
  }
  root.appendChild(makePropGroup('Name:', nameInput));

  // P5-8 slice b: Visible / Locked, mirroring the outliner's eye
  // and lock — the same flags, the same write path, so the two
  // places never disagree about an object. The stage element is
  // updated in place (no re-render, so the selection stays live).
  const O = getOutliner();
  if (O) {
    root.appendChild(makeCheckbox('Visible', !O.isHidden(obj), v => {
      O.setHidden(obj, !v);
      markProjectDirty();
      syncObjectListStageFlag(obj);
      renderEditor3dView();
      renderObjectList();
    }));
    root.appendChild(makeCheckbox('Locked (cannot drag on canvas)', O.isLocked(obj), v => {
      O.setLocked(obj, v);
      markProjectDirty();
      syncObjectListStageFlag(obj);
      renderObjectList();
    }));
  }

  const hr0 = document.createElement('hr'); hr0.className = 'prop-divider';
  root.appendChild(hr0);

  // Position / Size
  function posInput(prop, label, min, max) {
    const i = makeNumberInput(Math.round(obj[prop]), min, max, 1, v => {
      const hitboxWasDefault = !hasCustomHitbox(obj);
      obj[prop] = v;
      if (hitboxWasDefault && prop === 'width') obj.hitboxWidth = v;
      if (hitboxWasDefault && prop === 'height') obj.hitboxHeight = v;
      const el = document.querySelector(`.game-object[data-id="${obj.id}"]`);
      if (el) {
        el.style[prop === 'posX' ? 'left' : prop === 'posY' ? 'top' : prop === 'width' ? 'width' : 'height'] = `${v}px`;
        applyHitboxOverlay(el, obj);
      }
      renderObjectList();
    });
    i.dataset.prop = prop;
    return makePropGroup(label, i);
  }
  root.appendChild(posInput('posX', 'X:', -9999, 9999));
  root.appendChild(posInput('posY', 'Y:', -9999, 9999));
  root.appendChild(posInput('width', 'Width:', 1, 4000));
  root.appendChild(posInput('height', 'Height:', 1, 4000));

  // P4 item 3D1: 3D transform section for 3D primitives — depth position,
  // depth size, and rotation about the center. X/Y stay the 2D footprint
  // (drag to move); Y grows down like the 2D canvas, Z grows toward the
  // viewer, and the true 3D view is in Preview.
  // P4 item 3D5: lights share the section (Z position, Rot X / Rot Y aim
  // for directionals) and get their own Light controls below; they have
  // no depth size and no collider.
  const H3sec = window.Hydra3d;
  const is3dObj = !!(H3sec && H3sec.is3dKind(obj.kind));
  const isLightObj = !!(H3sec && H3sec.isLight3d(obj.kind));
  if (is3dObj || isLightObj) {
    window.Hydra3d.normalizeObject3d(obj);
    const sec3d = document.createElement('div');
    const title3d = document.createElement('div');
    title3d.className = 'property-mini-title';
    title3d.textContent = '3D Transform';
    sec3d.appendChild(title3d);
    function refresh3dElement() {
      const el = document.querySelector(`.game-object[data-id="${obj.id}"]`);
      if (!el) return;
      if (isLightObj) drawLightElement(obj, el);
      else draw3dElementCanvas(obj, el);
    }
    function num3d(prop, label, min, max, step) {
      const input = makeNumberInput(Number(obj[prop]) || 0, min, max, step || 1, v => {
        obj[prop] = v;
        refresh3dElement();
        markProjectDirty();
        renderObjectList();
        // P4 item 3D1 batch 2: keep the in-editor 3D viewport live.
        renderEditor3dView();
      });
      input.dataset.prop = prop;
      return makePropGroup(label, input);
    }
    sec3d.appendChild(num3d('z', 'Z (toward viewer):', -4000, 4000, 1));
    if (is3dObj) {
      sec3d.appendChild(num3d('depth', 'Depth (size):', 1, 4000, 1));
    }
    sec3d.appendChild(num3d('rotX', 'Rot X (degrees):', -360, 360, 1));
    sec3d.appendChild(num3d('rotY', 'Rot Y (degrees):', -360, 360, 1));
    sec3d.appendChild(num3d('rotZ', 'Rot Z (degrees):', -360, 360, 1));
    if (isLightObj) {
      // P4 item 3D5: the light itself — type, color, intensity, range,
      // on/off. Lights are invisible objects: they only change how 3D
      // objects are shaded, in the 3D view, Preview, and exports.
      const l = window.Hydra3d.normalizeLight3d(obj).light;
      const titleLight = document.createElement('div');
      titleLight.className = 'property-mini-title';
      titleLight.textContent = 'Light';
      sec3d.appendChild(titleLight);
      function lightChanged() {
        refresh3dElement();
        markProjectDirty();
        renderEditor3dView();
      }
      sec3d.appendChild(makePropGroup('Type:', makeSelect(
        [['point', 'Point'], ['directional', 'Directional'], ['ambient', 'Ambient']],
        l.type || 'point',
        v => { l.type = v; lightChanged(); showObjectProperties(obj); }
      )));
      const lightColorInput = document.createElement('input');
      lightColorInput.type = 'color'; lightColorInput.className = 'property-input'; lightColorInput.style.height = '36px';
      lightColorInput.value = /^#([0-9a-fA-F]{6})$/.test(l.color || '') ? l.color : '#ffffff';
      lightColorInput.title = 'Light color';
      lightColorInput.addEventListener('input', e => { l.color = e.target.value; lightChanged(); });
      sec3d.appendChild(makePropGroup('Color:', lightColorInput));
      sec3d.appendChild(makePropGroup('Intensity:', makeNumberInput(Number(l.intensity) || 0, 0, 4, 0.1, v => { l.intensity = v; lightChanged(); })));
      sec3d.appendChild(makePropGroup('Range:', makeNumberInput(Number(l.range) || 0, 0, 4000, 10, v => { l.range = v; lightChanged(); })));
      sec3d.appendChild(makeCheckbox('Enabled', l.enabled !== false, v => { l.enabled = v; lightChanged(); showObjectProperties(obj); }));
      sec3d.appendChild(makeNote('Point lights shine from the light\u2019s position and fade with Range (0 = no falloff). Directional lights shine everywhere from one direction — aim them with Rot X / Rot Y above. Ambient lights wash the whole scene with no position or direction. A scene with no lights keeps the classic fixed shading; with lights but no Ambient light, a dim base light keeps shadows from going pitch black.'));
      sec3d.appendChild(makeNote('The light is invisible in the game — drag its bulb glyph to move it. Z is its depth position (point lights).'));
      root.appendChild(sec3d);
    } else {
    // P4 item 3D4 (3D physics): the 3D collider — box or sphere, solid or
    // ghost. Gravity/friction/maxSpeed stay in the shared Physics panel
    // below (one panel drives both 2D and 3D).
    const p3 = window.Hydra3d.normalizePhysics3d(obj).physics3d;
    const titlePhys3d = document.createElement('div');
    titlePhys3d.className = 'property-mini-title';
    titlePhys3d.textContent = '3D Collider';
    sec3d.appendChild(titlePhys3d);
    sec3d.appendChild(makePropGroup('Collider shape:', makeSelect(
      [['box', 'Box'], ['sphere', 'Sphere']],
      p3.shape || 'box',
      v => { p3.shape = v; markProjectDirty(); }
    )));
    sec3d.appendChild(makeCheckbox('Solid (blocks 3D objects)', p3.solid !== false, v => {
      p3.solid = v;
      markProjectDirty();
    }));
    // P4 item 3D2: model3d objects pick an uploaded .glb/.gltf asset and a
    // material color tint (white = the model's own colors).
    if (obj.kind === 'model3d') {
      const modelIds = Object.keys(assetLibrary)
        .filter(id => assetLibrary[id] && assetLibrary[id].kind === 'model');
      const modelOpts = [['', '-- Choose a 3D model --'],
        ...modelIds.map(id => [id, assetLibrary[id].name || 'Untitled model'])];
      if (obj.modelAssetId && !modelOpts.some(([v]) => v === obj.modelAssetId)) {
        modelOpts.push([obj.modelAssetId, '(Missing asset)']);
      }
      const modelRow = document.createElement('div');
      modelRow.style.display = 'flex'; modelRow.style.gap = '6px'; modelRow.style.alignItems = 'center';
      const modelSel = makeSelect(modelOpts, obj.modelAssetId || '', v => {
        obj.modelAssetId = v || null;
        const el = document.querySelector(`.game-object[data-id="${obj.id}"]`);
        if (el) draw3dElementCanvas(obj, el);
        renderObjectList();
        renderEditor3dView();
      });
      modelSel.style.flex = '1';
      modelRow.appendChild(modelSel);
      const uploadModelBtn = document.createElement('button');
      uploadModelBtn.className = 'icon-btn';
      uploadModelBtn.title = 'Upload a .glb/.gltf model file';
      uploadModelBtn.innerHTML = '<i class="fas fa-upload"></i>';
      const uploadModelInput = document.createElement('input');
      uploadModelInput.type = 'file';
      uploadModelInput.accept = '.glb,.gltf,model/gltf-binary,model/gltf+json';
      uploadModelInput.style.display = 'none';
      uploadModelBtn.addEventListener('click', () => uploadModelInput.click());
      uploadModelInput.addEventListener('change', () => {
        const file = uploadModelInput.files && uploadModelInput.files[0];
        uploadModelInput.value = '';
        if (!file) return;
        storeAsset(file, (assetId, err) => {
          if (!assetId) { if (err) alert(err); return; }
          obj.modelAssetId = assetId;
          markProjectDirty();
          showObjectProperties(obj); // refresh the panel so the picker lists it
          const el = document.querySelector(`.game-object[data-id="${obj.id}"]`);
          if (el) draw3dElementCanvas(obj, el);
          renderEditor3dView();
        });
      });
      modelRow.appendChild(uploadModelBtn);
      modelRow.appendChild(uploadModelInput);
      sec3d.appendChild(makePropGroup('Model:', modelRow));
      const tintInput = document.createElement('input');
      tintInput.type = 'color'; tintInput.className = 'property-input'; tintInput.style.height = '36px';
      tintInput.value = /^#([0-9a-fA-F]{6})$/.test(obj.materialColor || '') ? obj.materialColor : '#ffffff';
      tintInput.title = 'Material color (tint)';
      tintInput.addEventListener('input', e => {
        obj.materialColor = e.target.value;
        const el = document.querySelector(`.game-object[data-id="${obj.id}"]`);
        if (el) draw3dElementCanvas(obj, el);
        markProjectDirty();
        renderEditor3dView();
      });
      sec3d.appendChild(makePropGroup('Material color (tint):', tintInput));
      // P4 item 3D2 batch 2: texture switch — on by default, so a textured
      // .glb shows its own skin; off shows the flat material colors.
      const texRow = document.createElement('label');
      texRow.style.display = 'flex'; texRow.style.alignItems = 'center'; texRow.style.gap = '6px';
      const texChk = document.createElement('input');
      texChk.type = 'checkbox';
      texChk.checked = obj.useTexture !== false;
      texChk.title = 'Use model texture';
      texChk.addEventListener('change', () => {
        obj.useTexture = !!texChk.checked;
        const el = document.querySelector(`.game-object[data-id="${obj.id}"]`);
        if (el) draw3dElementCanvas(obj, el);
        markProjectDirty();
        renderEditor3dView();
      });
      const texLbl = document.createElement('span');
      texLbl.textContent = 'Use model texture';
      texRow.appendChild(texChk); texRow.appendChild(texLbl);
      sec3d.appendChild(makePropGroup('', texRow));
      sec3d.appendChild(makeNote('Upload a .glb file on the Assets tab (or the upload button above), then choose it here. The model is scaled to fit the Width / Height / Depth box. White tint shows the model\u2019s own colors. A textured model shows its own skin automatically — switch that off here or with the Use Model Texture block to see the flat colors instead.'));
    }
    sec3d.appendChild(makeNote('The center of the object sits at (X + Width/2, Y + Height/2, Z). Rotation spins about that center. This is a flat thumbnail — flip the scene toolbar to 3D view for the true perspective render.'));
    root.appendChild(sec3d);
    } // end non-light 3D branch
  }

  // F2: Menus & HUD — anchor layout + HUD layer for every object kind.
  // P4 item 3D5: lights are not widgets — no anchors, no HUD layer.
  // P4 Advanced (2D lighting): 2D lights are not widgets either.
  (function buildUiLayoutSection() {
    const Ui = window.HydraUi;
    if (!Ui) return;
    if (window.Hydra3d && window.Hydra3d.isLight3d(obj.kind)) return;
    if (window.HydraLight2d && window.HydraLight2d.isLight2d(obj.kind)) return;
    const section = document.createElement('div');
    section.className = 'ui-layout-editor';
    const title = document.createElement('div');
    title.className = 'property-mini-title';
    title.textContent = 'Menus & HUD';
    section.appendChild(title);

    function refreshWidgetVisual() {
      const el = document.querySelector(`.game-object[data-id="${obj.id}"]`);
      if (el) {
        if (obj.kind === 'text') applyTextStyle(el, obj);
        else if (obj.kind === 'panel') applyPanelStyle(el, obj);
        else applyObjectVisual(el, obj);
        applyUiWidgetBadge(el, obj);
      }
      renderObjectList();
    }

    const anchorOpts = Ui.ANCHORS.map(a => [a.value, a.label]);
    section.appendChild(makePropGroup('Anchor to screen:', makeSelect(
      anchorOpts,
      Ui.normalizeAnchor(obj.anchor),
      v => { obj.anchor = v; refreshWidgetVisual(); }
    )));
    section.appendChild(makeCheckbox('HUD layer (always on top)', obj.hud === true, v => {
      obj.hud = v;
      refreshWidgetVisual();
    }));
    section.appendChild(makeNote('Anchors pin the widget to a screen corner, edge, or center — it stays put no matter where the camera moves. X and Y become the offset from that point (e.g. Top right with X \u221220, Y 20 sits 20px in from the corner). HUD draws above everything else: perfect for score bars, menus, and pause screens.'));

    // F2: button background colors (hover/press show in preview and exports).
    if (Ui.isButton(obj)) {
      if (!obj.buttonStyle) Ui.normalizeUiFields(obj);
      const styleTitle = document.createElement('div');
      styleTitle.className = 'property-mini-title';
      styleTitle.textContent = 'Button style';
      section.appendChild(styleTitle);
      function styleColorInput(prop, label, fallback) {
        const input = document.createElement('input');
        input.type = 'color'; input.className = 'property-input'; input.style.height = '36px';
        input.value = (obj.buttonStyle && obj.buttonStyle[prop]) || fallback;
        input.addEventListener('input', e => {
          obj.buttonStyle[prop] = e.target.value;
          refreshWidgetVisual();
        });
        return makePropGroup(label, input);
      }
      section.appendChild(styleColorInput('normal', 'Normal color:', '#3b82f6'));
      section.appendChild(styleColorInput('hover', 'Hover color:', '#60a5fa'));
      section.appendChild(styleColorInput('pressed', 'Pressed color:', '#1d4ed8'));
      section.appendChild(makePropGroup('Corner radius:', makeNumberInput(obj.cornerRadius ?? 8, 0, 100, 1, v => {
        obj.cornerRadius = v;
        refreshWidgetVisual();
      })));
      section.appendChild(makeNote('Hover and pressed colors appear automatically when the player moves the mouse over the button or holds it down. Use the Object Clicked block to run logic when it is clicked.'));
    }

    // F2: panel background + border.
    if (Ui.isPanel(obj)) {
      const panelTitle = document.createElement('div');
      panelTitle.className = 'property-mini-title';
      panelTitle.textContent = 'Panel style';
      section.appendChild(panelTitle);
      const bgInput = document.createElement('input');
      bgInput.type = 'color'; bgInput.className = 'property-input'; bgInput.style.height = '36px';
      bgInput.value = obj.color || '#1e293b';
      bgInput.addEventListener('input', e => { obj.color = e.target.value; refreshWidgetVisual(); });
      section.appendChild(makePropGroup('Background:', bgInput));
      section.appendChild(makePropGroup('Corner radius:', makeNumberInput(obj.cornerRadius ?? 12, 0, 100, 1, v => {
        obj.cornerRadius = v;
        refreshWidgetVisual();
      })));
      const borderInput = document.createElement('input');
      borderInput.type = 'color'; borderInput.className = 'property-input'; borderInput.style.height = '36px';
      borderInput.value = obj.borderColor || '#38bdf8';
      borderInput.addEventListener('input', e => { obj.borderColor = e.target.value; if ((Number(obj.borderWidth) || 0) <= 0) obj.borderWidth = 2; refreshWidgetVisual(); });
      section.appendChild(makePropGroup('Border color:', borderInput));
      section.appendChild(makePropGroup('Border width:', makeNumberInput(obj.borderWidth || 0, 0, 20, 1, v => {
        obj.borderWidth = v;
        refreshWidgetVisual();
      })));
      section.appendChild(makeNote('Panels are menu backdrops: anchor one to the screen center and it frames your title screen on any window size.'));
    }

    root.appendChild(section);
  })();

  const hitboxSection = document.createElement('div');
  hitboxSection.className = 'hitbox-editor';
  const hitboxTitle = document.createElement('div');
  hitboxTitle.className = 'property-mini-title';
  hitboxTitle.textContent = 'Hitbox';
  hitboxSection.appendChild(hitboxTitle);

  function hitboxInput(prop, label, min, max) {
    const i = makeNumberInput(Math.round(obj[prop] ?? (prop === 'hitboxWidth' ? obj.width : prop === 'hitboxHeight' ? obj.height : 0)), min, max, 1, v => {
      obj[prop] = v;
      const el = document.querySelector(`.game-object[data-id="${obj.id}"]`);
      if (el) applyHitboxOverlay(el, obj);
    });
    return makePropGroup(label, i);
  }
  hitboxSection.appendChild(hitboxInput('hitboxOffsetX', 'Offset X:', -4000, 4000));
  hitboxSection.appendChild(hitboxInput('hitboxOffsetY', 'Offset Y:', -4000, 4000));
  hitboxSection.appendChild(hitboxInput('hitboxWidth', 'Width:', 1, 4000));
  hitboxSection.appendChild(hitboxInput('hitboxHeight', 'Height:', 1, 4000));
  const resetHitboxBtn = document.createElement('button');
  resetHitboxBtn.type = 'button';
  resetHitboxBtn.className = 'clear-btn';
  resetHitboxBtn.textContent = 'Match Visual Bounds';
  resetHitboxBtn.onclick = () => {
    obj.hitboxOffsetX = 0;
    obj.hitboxOffsetY = 0;
    obj.hitboxWidth = obj.width;
    obj.hitboxHeight = obj.height;
    markProjectDirty();
    const el = document.querySelector(`.game-object[data-id="${obj.id}"]`);
    if (el) applyHitboxOverlay(el, obj);
    showObjectProperties(obj);
  };
  hitboxSection.appendChild(resetHitboxBtn);
  root.appendChild(hitboxSection);

  // Layer
  root.appendChild(makePropGroup('Layer (z-order):', makeNumberInput(obj.layer || 0, -100, 100, 1, v => {
    obj.layer = v;
    const el = document.querySelector(`.game-object[data-id="${obj.id}"]`);
    if (el) el.style.zIndex = v + 1;
    renderObjectList();
  })));

  // Rotation
  root.appendChild(makePropGroup('Rotation (degrees):', makeNumberInput(obj.rotation || 0, -360, 360, 1, v => {
    obj.rotation = v;
    const el = document.querySelector(`.game-object[data-id="${obj.id}"]`);
    if (el) el.style.transform = `rotate(${v}deg)`;
  })));

  root.appendChild(makePropGroup('Opacity:', makeNumberInput(obj.opacity ?? 1, 0, 1, 0.05, v => {
    obj.opacity = clamp(v, 0, 1);
    const el = document.querySelector(`.game-object[data-id="${obj.id}"]`);
    if (el) el.style.opacity = obj.opacity;
  })));

  const hr1 = document.createElement('hr'); hr1.className = 'prop-divider';
  root.appendChild(hr1);

  if (obj.kind === 'text') {
    // Text content
    root.appendChild(makePropGroup('Text:', makeTextInput(obj.text || '', 'Text', v => {
      obj.text = v;
      const el = document.querySelector(`.game-object[data-id="${obj.id}"]`);
      if (el) {
        applyTextStyle(el, obj);
        applyHitboxOverlay(el, obj);
      }
    })));
    // P4 Advanced (localization): bind this label to a string-table key.
    // At runtime (preview and exports) the label shows the key's
    // translation in the current language instead of the Text above, and
    // Set Language re-reads it at once. Blank means unbound.
    root.appendChild(makePropGroup('Localization key:', makeTextInput(obj.localeKey || '', 'e.g. play_button (blank = unbound)', v => {
      obj.localeKey = String(v || '').trim();
    })));
    root.appendChild(makePropGroup('Font Size:', makeNumberInput(obj.fontSize || 24, 6, 200, 1, v => {
      obj.fontSize = v;
      const el = document.querySelector(`.game-object[data-id="${obj.id}"]`);
      if (el) { applyTextStyle(el, obj); applyHitboxOverlay(el, obj); }
    })));
    root.appendChild(makePropGroup('Font Family:', makeTextInput(obj.fontFamily || 'sans-serif', 'sans-serif', v => {
      obj.fontFamily = v;
      const el = document.querySelector(`.game-object[data-id="${obj.id}"]`);
      if (el) { applyTextStyle(el, obj); applyHitboxOverlay(el, obj); }
    })));

    const textColorInput = document.createElement('input'); textColorInput.type = 'color';
    textColorInput.className = 'property-input'; textColorInput.style.height = '36px';
    textColorInput.value = obj.textColor || '#111827';
    textColorInput.addEventListener('input', e => {
      obj.textColor = e.target.value;
      const el = document.querySelector(`.game-object[data-id="${obj.id}"]`);
      if (el) { applyTextStyle(el, obj); applyHitboxOverlay(el, obj); }
      markProjectDirty();
    });
    root.appendChild(makePropGroup('Text Color:', textColorInput));

    root.appendChild(makePropGroup('Align:', makeSelect(
      [['left','Left'],['center','Center'],['right','Right']],
      obj.textAlign || 'left',
      v => {
        obj.textAlign = v;
        const el = document.querySelector(`.game-object[data-id="${obj.id}"]`);
        if (el) { applyTextStyle(el, obj); applyHitboxOverlay(el, obj); }
      }
    )));
    root.appendChild(makeCheckbox('Bold', obj.bold || false, v => {
      obj.bold = v;
      const el = document.querySelector(`.game-object[data-id="${obj.id}"]`);
      if (el) { applyTextStyle(el, obj); applyHitboxOverlay(el, obj); }
    }));
    root.appendChild(makeCheckbox('Italic', obj.italic || false, v => {
      obj.italic = v;
      const el = document.querySelector(`.game-object[data-id="${obj.id}"]`);
      if (el) { applyTextStyle(el, obj); applyHitboxOverlay(el, obj); }
    }));
    root.appendChild(makeCheckbox('Fixed to screen', obj.uiPinned !== false, v => {
      obj.uiPinned = v;
      const el = document.querySelector(`.game-object[data-id="${obj.id}"]`);
      if (el) { applyTextStyle(el, obj); applyHitboxOverlay(el, obj); }
    }));
    root.appendChild(makeNote('UI text stays fixed on screen. Turn this off for world labels/signs affected by camera movement.'));

  } else if (!(window.Hydra3d && window.Hydra3d.isLight3d(obj.kind)) && !(window.HydraLight2d && window.HydraLight2d.isLight2d(obj.kind))) {
    // Sprite object. P4 item 3D5: lights skip this whole branch — no
    // image upload, no color fill, no physics toggles, no 2D collision.
    // P4 Advanced (2D lighting): 2D lights skip it too.
    // Asset upload
    const uploadSection = document.createElement('div'); uploadSection.className = 'upload-section';
    const uploadBtn = document.createElement('button'); uploadBtn.className = 'upload-btn';
    uploadBtn.innerHTML = '<i class="fas fa-image"></i> Upload Image';
    const fileInput = document.createElement('input'); fileInput.type = 'file'; fileInput.accept = 'image/*'; fileInput.style.display = 'none';

    if (obj.assetId && assetLibrary[obj.assetId]) {
      const preview = document.createElement('img');
      preview.src = assetLibrary[obj.assetId].dataUrl;
      preview.className = 'asset-preview';
      uploadSection.appendChild(preview);

      const clearAssetBtn = document.createElement('button'); clearAssetBtn.className = 'clear-btn';
      clearAssetBtn.innerHTML = '<i class="fas fa-times"></i> Clear Image';
      clearAssetBtn.onclick = () => {
        obj.assetId = null;
        const el = document.querySelector(`.game-object[data-id="${obj.id}"]`);
        if (el) applyObjectVisual(el, obj);
        markProjectDirty();
        showObjectProperties(obj);
      };
      uploadSection.appendChild(clearAssetBtn);
    }

    uploadBtn.onclick = () => fileInput.click();
    fileInput.onchange = e => {
      const file = e.target.files[0];
      if (!file) return;
      storeAsset(file, (assetId, err) => {
        if (!assetId) { if (err) alert(err); return; }
        obj.assetId = assetId;
        const el = document.querySelector(`.game-object[data-id="${obj.id}"]`);
        if (el) applyObjectVisual(el, obj);
        markProjectDirty();
        showObjectProperties(obj); // refresh panel
      });
    };
    uploadSection.appendChild(uploadBtn);
    uploadSection.appendChild(fileInput);
    // Pick an image already in the Assets library, instead of uploading
    // the same file twice.
    const libImages = Object.keys(assetLibrary).filter(aid => (assetLibrary[aid].kind || '') === 'image');
    if (libImages.length) {
      const pickSelect = makeSelect(
        [['', 'Use an image from Assets…']].concat(libImages.map(aid => [aid, assetLibrary[aid].name || aid])),
        '',
        v => {
          if (!v) return;
          obj.assetId = v;
          const el = document.querySelector(`.game-object[data-id="${obj.id}"]`);
          if (el) applyObjectVisual(el, obj);
          markProjectDirty();
          showObjectProperties(obj); // refresh panel
        }
      );
      uploadSection.appendChild(pickSelect);
    }
    root.appendChild(makePropGroup('Sprite:', uploadSection));

    root.appendChild(makePropGroup('Image Fit:', makeSelect(
      [['cover','Cover box'],['contain','Contain whole image'],['stretch','Stretch to box']],
      obj.assetFit || 'cover',
      v => {
        obj.assetFit = v;
        const el = document.querySelector(`.game-object[data-id="${obj.id}"]`);
        if (el) applyObjectVisual(el, obj);
      }
    )));

    // Color (fallback when no image)
    const colorInput = document.createElement('input'); colorInput.type = 'color';
    colorInput.className = 'property-input'; colorInput.style.height = '36px';
    colorInput.value = obj.color || '#4488ff';
    colorInput.addEventListener('input', e => {
      obj.color = e.target.value;
      if (!obj.assetId) {
        const el = document.querySelector(`.game-object[data-id="${obj.id}"]`);
        if (el) el.style.backgroundColor = e.target.value;
      }
      markProjectDirty();
    });
    root.appendChild(makePropGroup('Color:', colorInput));

    const hr2 = document.createElement('hr'); hr2.className = 'prop-divider';
    root.appendChild(hr2);

    // Static / physics toggles
    root.appendChild(makeCheckbox('Static', obj.static || false, v => {
      obj.static = v;
    }));
    root.appendChild(makeCheckbox('Physics', obj.physicsEnabled || false, v => {
      obj.physicsEnabled = v;
      physicsPanel.style.display = v ? 'block' : 'none';
    }));

    // Physics panel
    const physicsPanel = document.createElement('div');
    physicsPanel.style.display = obj.physicsEnabled ? 'block' : 'none';
    physicsPanel.className = 'physics-panel';

    if (!obj.physics) obj.physics = { ...DEFAULT_PHYSICS };
    physicsPanel.appendChild(makePropGroup('Gravity:', makeNumberInput(obj.physics.gravity, -50, 50, 0.1, v => { obj.physics.gravity = v; })));
    physicsPanel.appendChild(makePropGroup('Friction (0–1):', makeNumberInput(obj.physics.friction, 0, 1, 0.01, v => { obj.physics.friction = v; })));
    physicsPanel.appendChild(makePropGroup('Bounciness (0–1):', makeNumberInput(obj.physics.bounciness, 0, 1, 0.05, v => { obj.physics.bounciness = v; })));
    physicsPanel.appendChild(makePropGroup('Max Speed:', makeNumberInput(obj.physics.maxSpeed, 1, 500, 1, v => { obj.physics.maxSpeed = v; })));

    const presets = document.createElement('div'); presets.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;';
    [
      ['Platformer', { gravity: 0.8, friction: 0.9,  bounciness: 0.1, maxSpeed: 15 }],
      ['Top-Down',   { gravity: 0,   friction: 0.75, bounciness: 0.2, maxSpeed: 12 }],
      ['Floaty',     { gravity: 0.1, friction: 0.98, bounciness: 0.6, maxSpeed: 8  }],
      ['Bouncy',     { gravity: 0.5, friction: 0.99, bounciness: 0.9, maxSpeed: 20 }],
    ].forEach(([label, preset]) => {
      const btn = document.createElement('button'); btn.textContent = label;
      btn.style.cssText = 'width:auto;margin:0;padding:4px 10px;font-size:12px;background:#334155;color:#e2e8f0;border:none;border-radius:4px;cursor:pointer;';
      btn.onclick = () => { Object.assign(obj.physics, preset); markProjectDirty(); showObjectProperties(obj); };
      presets.appendChild(btn);
    });
    physicsPanel.appendChild(presets);
    root.appendChild(physicsPanel);
  }

  // P4 item 32: collision upgrade — shape, trigger vs solid, one-way
  // platforms, collision layers + masks. Tilemaps collide per-tile, so they
  // skip this section (their layer/mask stay at the defaults).
  // P4 item 3D4: 3D objects use the 3D Collider controls in the 3D
  // Transform section instead — the 2D collision fields are inert for
  // them, so showing both would lie about which one works.
  // P4 item 3D5: lights are non-physical — no collision section at all.
  // P4 Advanced (2D lighting): 2D lights are non-physical too.
  if (obj.kind !== 'tilemap' && !(window.Hydra3d && (window.Hydra3d.is3dKind(obj.kind) || window.Hydra3d.isLight3d(obj.kind))) && !(window.HydraLight2d && window.HydraLight2d.isLight2d(obj.kind))) appendCollisionEditor(root, obj);

  // P4 item 21 FIX (cycle 37): the Animations section was built but never
  // wired in — appendAnimationEditor existed since the feature shipped and
  // nothing called it, so the animation lists the Play Animation block
  // asks for could not be built. It now renders for sprite-drawn objects
  // (the only kinds whose animation frames actually render: text, panels,
  // tilemaps, 3D kinds, and lights draw through other paths).
  // P4 Advanced (cycle 37): the Animation States section rides right under
  // the animations its states bind to.
  const H3sm = window.Hydra3d;
  const isSpriteDrawable = obj.kind !== 'text' && obj.kind !== 'tilemap' &&
    !(window.HydraUi && window.HydraUi.isPanel(obj)) &&
    !(H3sm && (H3sm.is3dKind(obj.kind) || H3sm.isLight3d(obj.kind)));
  if (isSpriteDrawable) {
    appendAnimationEditor(root, obj);
    appendAnimStateEditor(root, obj);
    // P4 Advanced (cycle 38): the Blend Spaces section rides right under
    // the animations its points bind to.
    appendBlendSpaceEditor(root, obj);
    // P4 Advanced (cycle 41): the Skeleton section rides under the blend
    // spaces — the bone rig whose tracks animate this sprite.
    appendSkeletonEditor(root, obj);
  }

  // P4 Advanced (2D lighting): the Lighting section rides under the
  // animation sections — any 2D object can emit light or cast a shadow.
  appendLight2dEditor(root, obj);

  // P4 Advanced batch 16 (parallax backgrounds): the Parallax section
  // rides under Lighting — how fast this object scrolls with the camera.
  appendParallaxEditor(root, obj);

  // P4 Advanced batch 21 (health & damage): the Health section rides
  // under Parallax — the object's hit points and its health bar.
  appendHealthEditor(root, obj);

  // P4 Advanced batch 34 (object tags): the Tags section rides under
  // Health — the object's labels, as chips with an add box.
  appendTagsEditor(root, obj);

  // P4 Advanced batch 26 (movement abilities): the Movement section
  // rides under Health — the object's jumps, coyote time, and jump
  // buffer.
  appendMovementEditor(root, obj);

  // P4 Advanced batch 27 (moving platforms & one-way platforms): the
  // Platform section rides under Movement — the object's waypoint
  // path, speed, mode, one-way flag, and crumble delay.
  appendPlatformEditor(root, obj);

  // P4 Advanced (physics joints): the Joints section rides under
  // Lighting — scene joints linking this object to another object.
  appendJointEditor(root, obj);

  // P4 item 31: tilemap editor section (tileset, brush, solids, text edit).
  appendTilemapEditor(root, obj);

  appendComponentInspector(root, obj);

  // Show label toggle
  root.appendChild(makeCheckbox('Show name label', obj.showLabel || false, v => { obj.showLabel = v; }));

  // Delete
  const hr3 = document.createElement('hr'); hr3.className = 'prop-divider';
  root.appendChild(hr3);
  const deleteBtn = document.createElement('button');
  deleteBtn.textContent = 'Delete Object'; deleteBtn.className = 'danger-btn';
  deleteBtn.style.marginTop = '8px';
  deleteBtn.onclick = () => {
    selectGameObjectById(obj.id);
    deleteSelectedSceneObject();
  };
  root.appendChild(deleteBtn);

  panel.innerHTML = ''; panel.appendChild(root);
}

function appendComponentInspector(root, obj) {
  window.HydraUniversal?.normalizeObject?.(obj);
  const section = document.createElement('div');
  section.className = 'component-section';
  const header = document.createElement('div');
  header.className = 'component-section-header';
  header.innerHTML = '<h4>Components</h4>';
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'component-mini-btn';
  addBtn.textContent = '+ Add Component';
  addBtn.addEventListener('click', () => openComponentPicker(obj));
  header.appendChild(addBtn);
  section.appendChild(header);

  (obj.components || []).forEach(component => {
    section.appendChild(renderComponentCard(obj, component));
  });
  root.appendChild(section);
}

function renderComponentCard(obj, component) {
  const info = window.HydraUniversal?.getComponentDefinition?.(component.type) || { category: 'Custom', description: '' };
  const card = document.createElement('div');
  card.className = 'component-card';
  const header = document.createElement('div');
  header.className = 'component-card-header';
  header.innerHTML = `
    <div>
      <div class="component-title">
        <span class="component-state ${component.enabled === false ? 'is-off' : 'is-on'}">${component.enabled === false ? 'Off' : 'On'}</span>
        <span>${component.type}</span>
      </div>
      <div class="component-category">${info.category || 'Custom'}</div>
    </div>
  `;
  const actions = document.createElement('div');
  actions.className = 'component-actions';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'component-mini-btn';
  toggle.textContent = component.enabled === false ? 'Enable' : 'Disable';
  toggle.addEventListener('click', e => {
    e.stopPropagation();
    component.enabled = component.enabled === false;
    syncComponentToLegacyFields(obj, component);
    markProjectDirty();
    showObjectProperties(obj);
  });
  actions.appendChild(toggle);
  if (!['Transform', 'Variables', 'SpriteRenderer', 'Text', 'UIElement'].includes(component.type)) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'component-mini-btn danger';
    remove.textContent = 'Remove';
    remove.addEventListener('click', e => {
      e.stopPropagation();
      window.HydraUniversal?.removeComponent?.(obj, component.id);
      markProjectDirty();
      showObjectProperties(obj);
    });
    actions.appendChild(remove);
  }
  header.appendChild(actions);
  card.appendChild(header);

  const body = document.createElement('div');
  body.className = 'component-card-body';
  const props = component.props || (component.props = {});
  const keys = Object.keys(props).slice(0, 10);
  if (!keys.length && info.description) {
    const note = document.createElement('p');
    note.className = 'hint-text';
    note.textContent = info.description;
    body.appendChild(note);
  }
  keys.forEach(key => {
    const row = document.createElement('label');
    row.className = 'component-prop';
    const label = document.createElement('span');
    label.textContent = key;
    let input;
    if (typeof props[key] === 'boolean') {
      input = document.createElement('select');
      [['true', 'On'], ['false', 'Off']].forEach(([v, t]) => {
        const option = document.createElement('option');
        option.value = v;
        option.textContent = t;
        input.appendChild(option);
      });
      input.value = String(props[key]);
      input.addEventListener('change', e => { props[key] = e.target.value === 'true'; syncComponentToLegacyFields(obj, component); markProjectDirty(); });
    } else if (typeof props[key] === 'number') {
      input = document.createElement('input');
      input.type = 'number';
      input.step = 'any';
      input.value = props[key];
      input.addEventListener('change', e => { props[key] = Number(e.target.value) || 0; syncComponentToLegacyFields(obj, component); markProjectDirty(); });
    } else {
      input = document.createElement('input');
      input.type = 'text';
      input.value = props[key] == null ? '' : String(props[key]);
      input.addEventListener('change', e => { props[key] = e.target.value; syncComponentToLegacyFields(obj, component); markProjectDirty(); });
    }
    row.appendChild(label);
    row.appendChild(input);
    body.appendChild(row);
  });
  card.appendChild(body);
  return card;
}

function syncComponentToLegacyFields(obj, component) {
  const props = component.props || {};
  if (component.type === 'Transform') {
    if ('x' in props) obj.posX = Number(props.x) || obj.posX || 0;
    if ('y' in props) obj.posY = Number(props.y) || obj.posY || 0;
    if ('width' in props) obj.width = Math.max(1, Number(props.width) || obj.width || 1);
    if ('height' in props) obj.height = Math.max(1, Number(props.height) || obj.height || 1);
    if ('rotation' in props) obj.rotation = Number(props.rotation) || 0;
  }
  if (component.type === 'Collider2D') {
    obj.collision = Object.assign({}, obj.collision, { enabled: component.enabled !== false && props.enabled !== false });
    obj.hitboxOffsetX = Number(props.offsetX) || 0;
    obj.hitboxOffsetY = Number(props.offsetY) || 0;
    obj.hitboxWidth = Number(props.width) || obj.width;
    obj.hitboxHeight = Number(props.height) || obj.height;
  }
  if (component.type === 'Rigidbody2D') {
    obj.physicsEnabled = component.enabled !== false;
    obj.physics = Object.assign(obj.physics || {}, props);
  }
  if (component.type === 'Text') {
    obj.text = props.text ?? obj.text;
    obj.fontSize = Number(props.fontSize) || obj.fontSize;
    obj.textColor = props.color || obj.textColor;
  }
  const el = document.querySelector(`.game-object[data-id="${obj.id}"]`);
  if (el) {
    el.style.left = `${obj.posX}px`;
    el.style.top = `${obj.posY}px`;
    el.style.width = `${obj.width}px`;
    el.style.height = `${obj.height}px`;
    if (obj.kind === 'text') applyTextStyle(el, obj); else applyObjectVisual(el, obj);
    applyHitboxOverlay(el, obj);
  }
}

function openComponentPicker(obj) {
  const existing = new Set((obj.components || []).map(c => c.type));
  const items = (window.HydraUniversal?.COMPONENT_LIST || [])
    .filter(component => !existing.has(component.type))
    .map(component => ({
      title: component.type,
      category: component.category,
      description: component.description,
      value: component.type
    }));
  openPickerDialog('Add Component', items, type => {
    window.HydraUniversal?.addComponent?.(obj, type);
    markProjectDirty();
    showObjectProperties(obj);
  });
}

// ============================================================
// SCENE LIST
// ============================================================
function refreshSceneList() {
  const list = document.getElementById('scene-list');
  if (!list) return;
  list.innerHTML = '';

  scenes.forEach(scene => {
    const item = document.createElement('div');
    item.className = 'scene-list-item' + (scene.id === currentSceneId ? ' active' : '');

    const nameEl = document.createElement('span'); nameEl.textContent = scene.name; nameEl.style.flex = '1';
    nameEl.addEventListener('dblclick', () => {
      const inp = document.createElement('input'); inp.type = 'text'; inp.value = scene.name;
      inp.className = 'property-input'; inp.style.cssText = 'flex:1;padding:4px 6px;font-size:13px;height:24px;';
      item.replaceChild(inp, nameEl);
      inp.focus(); inp.select();
      const commit = () => { scene.name = inp.value || scene.name; refreshSceneList(); refreshScopeTabs(); markProjectDirty(); };
      inp.addEventListener('blur', commit);
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); });
    });

    const delBtn = document.createElement('button'); delBtn.textContent = '✕';
    delBtn.style.cssText = 'width:22px;height:22px;padding:0;margin:0;font-size:12px;background:#c05454;border-radius:4px;color:white;border:none;cursor:pointer;';
    delBtn.title = 'Delete scene';
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (scenes.length <= 1) { alert('Cannot delete the last scene.'); return; }
      if (!confirm(`Delete "${scene.name}"?`)) return;
      scenes.splice(scenes.indexOf(scene), 1);
      if (currentSceneId === scene.id) setCurrentSceneId(scenes[0].id);
      renderSceneObjects(); refreshSceneList(); refreshScopeTabs();
      markProjectDirty();
      refreshValidationDiagnostics();
    });

    item.appendChild(nameEl); item.appendChild(delBtn);
    item.addEventListener('click', () => {
      setCurrentSceneId(scene.id);
      renderSceneObjects();
      refreshSceneList();
      refreshScopeTabs();
      // Update scene settings panel
      const bgInput = document.getElementById('scene-bg-color');
      if (bgInput) bgInput.value = getCurrentScene().bgColor || '#ffffff';
      const renderModeInput = document.getElementById('scene-render-mode');
      if (renderModeInput) renderModeInput.value = window.Hydra3d
        ? window.Hydra3d.normalizeRenderMode(getCurrentScene().renderMode) : '2d';
      const wInput = document.getElementById('scene-width');
      const hInput = document.getElementById('scene-height');
      const vwInput = document.getElementById('scene-viewport-width');
      const vhInput = document.getElementById('scene-viewport-height');
      if (wInput) wInput.value = getSceneWorldWidth(getCurrentScene());
      if (hInput) hInput.value = getSceneWorldHeight(getCurrentScene());
      if (vwInput) vwInput.value = getSceneViewportWidth(getCurrentScene());
      if (vhInput) vhInput.value = getSceneViewportHeight(getCurrentScene());
      initSceneEditor();
    });
    list.appendChild(item);
  });
  refreshSceneSwitcher();
}

document.getElementById('add-scene-btn')?.addEventListener('click', () => {
  createScene();
});

// ============================================================
// EXPORTS for project.js
// ============================================================
window.showDefaultPropertiesPanel = showDefaultPropertiesPanel;
window.processScriptGrid          = processScriptGrid;
window.refreshSceneList           = refreshSceneList;
window.refreshScopeTabs           = refreshScopeTabs;
window.saveGridToScope            = saveGridToScope;
window.commitActiveGrid           = commitActiveGrid;
window.loadGridForScope           = loadGridForScope;
window.preferCurrentSceneScriptIfGlobalEmpty = preferCurrentSceneScriptIfGlobalEmpty;
window.globalGridData             = globalGridData;
window.getCurrentScene            = getCurrentScene;
window.getActiveScriptScope       = () => activeScriptScope;
window.setActiveScriptScope       = setActiveScriptScope;
window.getCurrentSceneId          = () => currentSceneId;
window.setCurrentSceneId          = setCurrentSceneId;
window.getNextSceneId             = () => nextSceneId;
window.setNextSceneId             = setNextSceneId;
window.markProjectDirty           = markProjectDirty;
window.getAllObjectNames           = getAllObjectNames;

// ============================================================
// BOOT
// ============================================================
window.addEventListener('load', () => {
  setTimeout(() => document.querySelector('.loading-screen')?.classList.add('hidden'), 2500);
  initSceneEditor();
  renderSceneObjects();
  refreshSceneList();
  preferCurrentSceneScriptIfGlobalEmpty();
  refreshScopeTabs();
  initGame();
  // Start the render loop quietly in scene view (P2 item 14 slice 8:
  // the loop lives in HydraPreviewRuntime now; it re-arms itself and
  // stopPreviewLoop cancels the chain it started).
  if (window.HydraPreviewRuntime) window.HydraPreviewRuntime.startRenderLoop();
  gridContainer.focus();
});
