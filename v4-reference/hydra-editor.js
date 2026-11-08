// ============================================================
// HydraScript v4 — Visual Editor
// Scene editor, logic grid editor, preview, inspector
// ============================================================

(function (global) {
  'use strict';

  const { clone, clamp, uid, escapeHtml, normalizeObject, normalizeScene, normalizeProject, createObject, createScene, createProject, gridToEventRows, ensureComponent, addComponent, removeComponent, getComponent, getComponentDefinition, defaultPropsFor } = global.HydraCore;
  const { BLOCKS, BLOCK_MAP, getBlock, getBlockByRuntime, getBlocksByCategory, CATEGORIES } = global.HydraBlocks;

  // ============================================================
  // STATE
  // ============================================================
  let project = null;
  let scenes = [];
  let currentSceneId = null;
  let nextSceneId = 2;
  let activeScriptScope = 'global';
  let globalGridData = {};
  let cellData = {};
  let scriptGridHydrated = false;
  let hydratedScriptScope = null;
  let selectedBlockType = null;
  let selectedCell = null;
  let selectedObjectId = null;
  let gameRunning = false;
  let rafHandle = null;
  let engineState = null;
  let autosaveTimer = null;
  let activeLogicView = 'grid';

  const GRID_COLS = 60;
  const GRID_ROWS = 60;
  const ALL_BLOCK_TYPES = BLOCKS.map((b) => b.blockType);

  // Asset library
  const assetLibrary = {};
  global.assetLibrary = assetLibrary;

  // ============================================================
  // INITIALIZATION
  // ============================================================
  document.addEventListener('DOMContentLoaded', initApp);

  function initApp() {
    initLoadingScreen();
    initProject();
    initTabs();
    initSceneEditor();
    initLogicEditor();
    initPreview();
    initKeyboardShortcuts();
    // Auto-load last project or create new
    loadOrCreateProject();
  }

  function initLoadingScreen() {
    const screen = document.getElementById('app-loading-screen');
    const bar = document.getElementById('loading-progress-bar');
    const status = document.getElementById('loading-status');
    const subtext = document.getElementById('loading-subtext');
    if (!screen) return;
    const steps = [
      { p: 20, s: 'Initializing Engine...', t: 'loading core modules...' },
      { p: 45, s: 'Loading Assets...', t: 'fetching project data...' },
      { p: 70, s: 'Preparing Workspace...', t: 'setting up scene system...' },
      { p: 90, s: 'Restoring State...', t: 'rebuilding project...' },
      { p: 100, s: 'Ready!', t: 'launching Hydra Script...' },
    ];
    let i = 0;
    const tick = () => {
      if (i >= steps.length) { setTimeout(() => screen.classList.add('hidden'), 400); return; }
      bar.style.width = steps[i].p + '%';
      status.textContent = steps[i].s;
      subtext.textContent = steps[i].t;
      i++;
      setTimeout(tick, 300 + Math.random() * 300);
    };
    tick();
  }

  // ============================================================
  // PROJECT MANAGEMENT
  // ============================================================
  function loadOrCreateProject() {
    const id = localStorage.getItem('currentProjectId');
    if (id) {
      const projects = loadProjects();
      const found = projects.find((p) => p.id === id);
      if (found) { setProject(found); return; }
    }
    const p = createProject();
    setProject(p);
    saveCurrentProject();
  }

  function setProject(p) {
    normalizeProject(p);
    project = p;
    scenes = p.scenes;
    currentSceneId = p.currentSceneId || scenes[0]?.id || 1;
    nextSceneId = p.nextSceneId || scenes.length + 1;
    activeScriptScope = p.activeScriptScope || 'global';
    globalGridData = p.globalGridData || {};
    Object.assign(assetLibrary, p.assets || {});
    localStorage.setItem('currentProjectId', p.id);
    document.getElementById('project-name').textContent = p.name;

    // Render UI
    setTimeout(() => {
      renderSceneObjects();
      refreshSceneList();
      refreshSceneSwitcher();
      refreshScopeTabs();
      loadGridForScope(activeScriptScope);
      hydrateBlockPalette();
    }, 100);
  }

  function saveCurrentProject(silent = false) {
    if (!project) return;
    commitActiveGrid({ dirty: false, autosave: false });
    project.assets = clone(assetLibrary);
    scenes.forEach((s) => normalizeScene(s, project));
    project.scenes = clone(scenes);
    project.sceneCount = scenes.length;
    project.globalGridData = clone(globalGridData);
    normalizeProject(project);
    project.currentSceneId = currentSceneId;
    project.nextSceneId = nextSceneId;
    project.activeScriptScope = activeScriptScope;
    project.name = document.getElementById('project-name').textContent.trim() || 'Untitled Project';
    project.lastModified = new Date().toISOString();

    const projects = loadProjects();
    const idx = projects.findIndex((p) => p.id === project.id);
    if (idx !== -1) projects[idx] = project;
    else projects.push(project);

    try {
      localStorage.setItem('hydraProjects', JSON.stringify(projects));
    } catch (e) {
      // Storage quota exceeded — save without assets
      const light = clone(project);
      light.assets = {};
      light.scenes.forEach((s) => { s.bgAssetId = null; s.objects.forEach((o) => { o.assetId = null; }); });
      const idx2 = projects.findIndex((p) => p.id === light.id);
      if (idx2 !== -1) projects[idx2] = light;
      else projects.push(light);
      try { localStorage.setItem('hydraProjects', JSON.stringify(projects)); } catch {}
      if (!silent) alert('Storage full — project saved without image assets.');
    }

    if (!silent) showSaveConfirmation();
  }

  function loadProjects() {
    try { return JSON.parse(localStorage.getItem('hydraProjects') || '[]'); }
    catch { return []; }
  }

  function showSaveConfirmation() {
    const el = document.createElement('div');
    el.className = 'save-confirmation';
    el.innerHTML = '<i class="fas fa-check"></i> Project saved';
    document.body.appendChild(el);
    setTimeout(() => { el.classList.add('show'); setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 2000); }, 10);
  }

  function markProjectDirty(autosave = true) {
    clearTimeout(autosaveTimer);
    if (autosave) {
      autosaveTimer = setTimeout(() => saveCurrentProject(true), 1200);
    }
  }

  function commitActiveGrid(options = {}) {
    if (!scriptGridHydrated || hydratedScriptScope !== activeScriptScope) return;
    saveGridToScope(activeScriptScope);
    refreshScriptMeta();
    renderEventSheet();
    if (options.dirty !== false) markProjectDirty(options.autosave);
  }

  function saveGridToScope(scope) {
    if (scope === 'global') {
      Object.keys(globalGridData).forEach((k) => delete globalGridData[k]);
      Object.assign(globalGridData, clone(cellData));
    } else {
      const scene = scenes.find((s) => String(s.id) === String(scope));
      if (scene) {
        scene.gridData = scene.gridData || {};
        Object.keys(scene.gridData).forEach((k) => delete scene.gridData[k]);
        Object.assign(scene.gridData, clone(cellData));
      }
    }
  }

  function getGridDataForScope(scope) {
    if (scope === 'global') return globalGridData;
    return scenes.find((s) => String(s.id) === String(scope))?.gridData || {};
  }

  function loadGridForScope(scope) {
    cellData = clone(getGridDataForScope(scope));
    scriptGridHydrated = true;
    hydratedScriptScope = scope;
    renderGrid();
    refreshScriptMeta();
    renderEventSheet();
  }

  // ============================================================
  // TABS
  // ============================================================
  function initTabs() {
    const tabs = document.querySelectorAll('.tab');
    const contents = document.querySelectorAll('.tab-content');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        commitActiveGrid();
        stopPreview();
        tabs.forEach((t) => t.classList.remove('active'));
        contents.forEach((c) => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab).classList.add('active');

        const tabId = tab.dataset.tab;
        if (tabId === 'preview-tab') launchPreview();
        else if (tabId === 'scene-tab') { renderSceneObjects(); refreshSceneList(); refreshSceneSwitcher(); }
        else if (tabId === 'script-tab') { refreshScopeTabs(); loadGridForScope(activeScriptScope); }
      });
    });

    // Project name editing
    const nameEl = document.getElementById('project-name');
    nameEl.addEventListener('blur', () => {
      if (project) {
        project.name = nameEl.textContent.trim() || 'Untitled Project';
        nameEl.textContent = project.name;
        markProjectDirty();
      }
    });
    nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); } });

    // Buttons
    document.getElementById('save-project-btn')?.addEventListener('click', () => saveCurrentProject());
    document.getElementById('export-playable-btn')?.addEventListener('click', exportGame);
    document.getElementById('home-btn')?.addEventListener('click', () => { saveCurrentProject(); window.location.href = 'home.html?v4'; });
  }

  // ============================================================
  // SCENE EDITOR
  // ============================================================
  function getCurrentScene() {
    const s = scenes.find((s) => s.id === currentSceneId) || scenes[0];
    if (s) normalizeScene(s);
    return s;
  }

  function initSceneEditor() {
    // Inspector tabs
    document.querySelectorAll('.inspector-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.inspector-tab').forEach((t) => t.classList.remove('active'));
        document.querySelectorAll('.inspector-panel').forEach((p) => p.classList.remove('active'));
        tab.classList.add('active');
        document.querySelector(`.inspector-panel[data-inspector-panel="${tab.dataset.inspectorTab}"]`).classList.add('active');
      });
    });

    // Scene management
    document.getElementById('add-scene-btn')?.addEventListener('click', addScene);
    document.getElementById('scene-toolbar-add-btn')?.addEventListener('click', addScene);
    document.getElementById('scene-toolbar-delete-btn')?.addEventListener('click', deleteScene);
    document.getElementById('scene-rename-btn')?.addEventListener('click', renameScene);

    // Zoom
    let sceneZoom = 1;
    document.getElementById('scene-zoom-in-btn')?.addEventListener('click', () => { sceneZoom = clamp(sceneZoom + 0.2, 0.3, 3); applySceneZoom(sceneZoom); });
    document.getElementById('scene-zoom-out-btn')?.addEventListener('click', () => { sceneZoom = clamp(sceneZoom - 0.2, 0.3, 3); applySceneZoom(sceneZoom); });

    // Object operations
    document.getElementById('scene-delete-btn')?.addEventListener('click', deleteSelectedObject);
    document.getElementById('scene-duplicate-btn')?.addEventListener('click', duplicateSelectedObject);
    document.getElementById('scene-center-btn')?.addEventListener('click', centerSelectedObject);

    // Add object
    document.getElementById('add-object-btn')?.addEventListener('click', () => {
      const kind = document.getElementById('new-object-kind').value;
      const scene = getCurrentScene();
      addObjectAt(kind, scene.worldWidth / 2, scene.worldHeight / 2);
    });

    // Create grid buttons
    document.querySelectorAll('.object-create-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const scene = getCurrentScene();
        addObjectAt(btn.dataset.createKind, scene.worldWidth / 2, scene.worldHeight / 2);
      });
    });

    // Scene settings
    document.getElementById('scene-bg-color')?.addEventListener('input', (e) => {
      const scene = getCurrentScene();
      if (scene) { scene.bgColor = e.target.value; renderSceneObjects(); markProjectDirty(); }
    });
    document.getElementById('scene-width')?.addEventListener('change', (e) => {
      const scene = getCurrentScene();
      if (scene) { scene.worldWidth = scene.width = clamp(Number(e.target.value), 100, 4000); renderSceneObjects(); markProjectDirty(); }
    });
    document.getElementById('scene-height')?.addEventListener('change', (e) => {
      const scene = getCurrentScene();
      if (scene) { scene.worldHeight = scene.height = clamp(Number(e.target.value), 100, 4000); renderSceneObjects(); markProjectDirty(); }
    });
    document.getElementById('scene-viewport-width')?.addEventListener('change', (e) => {
      const scene = getCurrentScene();
      if (scene) { scene.viewportWidth = clamp(Number(e.target.value), 100, 4000); markProjectDirty(); }
    });
    document.getElementById('scene-viewport-height')?.addEventListener('change', (e) => {
      const scene = getCurrentScene();
      if (scene) { scene.viewportHeight = clamp(Number(e.target.value), 100, 4000); markProjectDirty(); }
    });

    // Background image upload
    document.getElementById('scene-bg-upload-btn')?.addEventListener('click', () => document.getElementById('scene-bg-file').click());
    document.getElementById('scene-bg-file')?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      storeAsset(file, (assetId) => {
        const scene = getCurrentScene();
        if (scene) { scene.bgAssetId = assetId; renderSceneObjects(); markProjectDirty(); }
      });
    });
    document.getElementById('scene-bg-clear-btn')?.addEventListener('click', () => {
      const scene = getCurrentScene();
      if (scene) { scene.bgAssetId = null; renderSceneObjects(); markProjectDirty(); }
    });

    // Scene switcher
    document.getElementById('scene-switcher-select')?.addEventListener('change', (e) => {
      switchScene(Number(e.target.value));
    });

    // Entity search
    document.getElementById('entity-search')?.addEventListener('input', (e) => {
      renderObjectList(e.target.value);
    });
  }

  function storeAsset(file, callback) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const id = 'asset_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      assetLibrary[id] = { name: file.name, dataUrl: e.target.result };
      callback(id);
    };
    reader.readAsDataURL(file);
  }

  let sceneSnapEnabled = true;
  let sceneZoomLevel = 1;

  function applySceneZoom(zoom) {
    sceneZoomLevel = zoom;
    document.getElementById('scene-zoom-readout').textContent = Math.round(zoom * 100) + '%';
    const canvas = document.getElementById('scene-canvas');
    if (canvas) canvas.style.transform = `scale(${zoom})`;
  }

  function renderSceneObjects() {
    const canvas = document.getElementById('scene-canvas');
    if (!canvas) return;
    const scene = getCurrentScene();
    if (!scene) return;

    canvas.innerHTML = '';
    canvas.style.width = scene.worldWidth + 'px';
    canvas.style.height = scene.worldHeight + 'px';
    canvas.style.backgroundColor = scene.bgColor || '#1a1a2e';

    // Background image
    if (scene.bgAssetId && assetLibrary[scene.bgAssetId]) {
      canvas.style.backgroundImage = `url(${assetLibrary[scene.bgAssetId].dataUrl})`;
      canvas.style.backgroundSize = 'cover';
    } else {
      canvas.style.backgroundImage = '';
    }

    // Camera frame
    const frame = document.createElement('div');
    frame.className = 'scene-camera-frame';
    frame.style.width = scene.viewportWidth + 'px';
    frame.style.height = scene.viewportHeight + 'px';
    frame.style.left = '0px';
    frame.style.top = '0px';
    canvas.appendChild(frame);

    // Objects
    scene.objects.forEach((obj) => {
      const el = renderGameObject(obj);
      if (el) canvas.appendChild(el);
    });

    renderObjectList();
    updateSceneSettings();
  }

  function renderGameObject(obj) {
    const el = document.createElement('div');
    el.className = `game-object ${obj.kind}-object`;
    el.dataset.id = obj.id;
    el.style.left = obj.posX + 'px';
    el.style.top = obj.posY + 'px';
    el.style.width = obj.width + 'px';
    el.style.height = obj.height + 'px';
    if (obj.rotation) el.style.transform = `rotate(${obj.rotation}deg)`;

    // Visual
    if (obj.kind === 'text') {
      el.style.fontSize = (obj.fontSize || 24) + 'px';
      el.style.color = obj.textColor || '#111827';
      el.style.fontWeight = obj.bold ? 'bold' : 'normal';
      el.style.fontStyle = obj.italic ? 'italic' : 'normal';
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.justifyContent = obj.textAlign === 'center' ? 'center' : 'flex-start';
      el.textContent = obj.text || 'Text';
    } else if (obj.assetId && assetLibrary[obj.assetId]) {
      el.style.backgroundImage = `url(${assetLibrary[obj.assetId].dataUrl})`;
      el.style.backgroundSize = obj.assetFit || 'cover';
      el.style.backgroundRepeat = 'no-repeat';
    } else {
      el.style.backgroundColor = obj.color || '#4488ff';
      if (obj.kind === 'button') {
        el.style.borderRadius = '8px';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        el.style.color = 'white';
        el.style.fontWeight = '600';
        el.style.fontSize = '14px';
        el.textContent = obj.text || 'Button';
      }
    }

    // Label
    const label = document.createElement('div');
    label.className = 'obj-label';
    label.textContent = obj.name;
    el.appendChild(label);

    // Selection
    if (obj.id === selectedObjectId) el.classList.add('selected');

    // Drag
    el.addEventListener('mousedown', (e) => startDrag(e, obj));

    // Click to select
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      selectObject(obj.id);
    });

    return el;
  }

  let dragState = null;

  function startDrag(e, obj) {
    e.preventDefault();
    e.stopPropagation();
    selectObject(obj.id);
    const canvas = document.getElementById('scene-canvas');
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width / canvas.offsetWidth;
    dragState = {
      obj, startX: e.clientX, startY: e.clientY,
      origX: obj.posX, origY: obj.posY, scale,
    };
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', endDrag);
  }

  function onDrag(e) {
    if (!dragState) return;
    const dx = (e.clientX - dragState.startX) / dragState.scale;
    const dy = (e.clientY - dragState.startY) / dragState.scale;
    let nx = dragState.origX + dx;
    let ny = dragState.origY + dy;
    if (sceneSnapEnabled) {
      nx = Math.round(nx / 10) * 10;
      ny = Math.round(ny / 10) * 10;
    }
    dragState.obj.posX = nx;
    dragState.obj.posY = ny;
    renderSceneObjects();
    showObjectProperties(dragState.obj);
  }

  function endDrag() {
    if (dragState) markProjectDirty();
    dragState = null;
    document.removeEventListener('mousemove', onDrag);
    document.removeEventListener('mouseup', endDrag);
  }

  function selectObject(id) {
    selectedObjectId = id;
    document.querySelectorAll('.game-object').forEach((el) => el.classList.remove('selected'));
    const el = document.querySelector(`.game-object[data-id="${id}"]`);
    if (el) el.classList.add('selected');
    const obj = getCurrentScene()?.objects.find((o) => o.id === id);
    if (obj) showObjectProperties(obj);
    renderObjectList();
  }

  function addObjectAt(kind, x, y) {
    const scene = getCurrentScene();
    if (!scene) return;
    const obj = createObject(kind);
    obj.posX = Math.round(x - obj.width / 2);
    obj.posY = Math.round(y - obj.height / 2);
    normalizeObject(obj);
    scene.objects.push(obj);
    renderSceneObjects();
    selectObject(obj.id);
    markProjectDirty();
  }

  function deleteSelectedObject() {
    if (!selectedObjectId) return;
    const scene = getCurrentScene();
    scene.objects = scene.objects.filter((o) => o.id !== selectedObjectId);
    selectedObjectId = null;
    document.getElementById('object-properties').innerHTML = '<p class="hint-text">Click an object to select it.</p>';
    renderSceneObjects();
    markProjectDirty();
  }

  function duplicateSelectedObject() {
    if (!selectedObjectId) return;
    const scene = getCurrentScene();
    const obj = scene.objects.find((o) => o.id === selectedObjectId);
    if (!obj) return;
    const copy = clone(obj);
    copy.id = uid('ent');
    copy.name = obj.name + ' Copy';
    copy.posX += 20;
    copy.posY += 20;
    scene.objects.push(copy);
    renderSceneObjects();
    selectObject(copy.id);
    markProjectDirty();
  }

  function centerSelectedObject() {
    if (!selectedObjectId) return;
    const scene = getCurrentScene();
    const obj = scene.objects.find((o) => o.id === selectedObjectId);
    if (!obj) return;
    obj.posX = scene.worldWidth / 2 - obj.width / 2;
    obj.posY = scene.worldHeight / 2 - obj.height / 2;
    renderSceneObjects();
    showObjectProperties(obj);
    markProjectDirty();
  }

  // ============================================================
  // OBJECT INSPECTOR
  // ============================================================
  function showObjectProperties(obj) {
    const root = document.getElementById('object-properties');
    if (!root) return;
    root.innerHTML = '';

    // Name
    const nameGroup = document.createElement('div');
    nameGroup.className = 'prop-group';
    nameGroup.innerHTML = `<label>Name</label>`;
    const nameInput = document.createElement('input');
    nameInput.className = 'property-input';
    nameInput.value = obj.name || '';
    nameInput.addEventListener('input', () => { obj.name = nameInput.value; renderSceneObjects(); renderObjectList(); markProjectDirty(); });
    nameGroup.appendChild(nameInput);
    root.appendChild(nameGroup);

    // Position
    const posGroup = document.createElement('div');
    posGroup.style.display = 'flex';
    posGroup.style.gap = '8px';
    posGroup.innerHTML = `
      <div class="prop-group" style="flex:1">
        <label>X</label>
        <input type="number" class="property-input" id="prop-x" value="${obj.posX || 0}">
      </div>
      <div class="prop-group" style="flex:1">
        <label>Y</label>
        <input type="number" class="property-input" id="prop-y" value="${obj.posY || 0}">
      </div>
    `;
    root.appendChild(posGroup);
    document.getElementById('prop-x').addEventListener('input', (e) => { obj.posX = Number(e.target.value) || 0; renderSceneObjects(); markProjectDirty(); });
    document.getElementById('prop-y').addEventListener('input', (e) => { obj.posY = Number(e.target.value) || 0; renderSceneObjects(); markProjectDirty(); });

    // Size
    const sizeGroup = document.createElement('div');
    sizeGroup.style.display = 'flex';
    sizeGroup.style.gap = '8px';
    sizeGroup.innerHTML = `
      <div class="prop-group" style="flex:1">
        <label>Width</label>
        <input type="number" class="property-input" id="prop-w" value="${obj.width || 64}" min="1">
      </div>
      <div class="prop-group" style="flex:1">
        <label>Height</label>
        <input type="number" class="property-input" id="prop-h" value="${obj.height || 64}" min="1">
      </div>
    `;
    root.appendChild(sizeGroup);
    document.getElementById('prop-w').addEventListener('input', (e) => { obj.width = Math.max(1, Number(e.target.value) || 1); renderSceneObjects(); markProjectDirty(); });
    document.getElementById('prop-h').addEventListener('input', (e) => { obj.height = Math.max(1, Number(e.target.value) || 1); renderSceneObjects(); markProjectDirty(); });

    // Rotation
    if (obj.kind !== 'text') {
      const rotGroup = document.createElement('div');
      rotGroup.className = 'prop-group';
      rotGroup.innerHTML = `<label>Rotation (°)</label>`;
      const rotInput = document.createElement('input');
      rotInput.type = 'number';
      rotInput.className = 'property-input';
      rotInput.value = obj.rotation || 0;
      rotInput.addEventListener('input', (e) => { obj.rotation = Number(e.target.value) || 0; renderSceneObjects(); markProjectDirty(); });
      rotGroup.appendChild(rotInput);
      root.appendChild(rotGroup);
    }

    // Kind-specific properties
    if (obj.kind === 'text') {
      addTextProperties(root, obj);
    } else {
      addVisualProperties(root, obj);
    }

    // Color
    if (obj.kind !== 'text') {
      const colorGroup = document.createElement('div');
      colorGroup.className = 'prop-group';
      colorGroup.innerHTML = `<label>Color</label>`;
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.className = 'property-input';
      colorInput.style.height = '36px';
      colorInput.value = obj.color || '#4488ff';
      colorInput.addEventListener('input', (e) => { obj.color = e.target.value; renderSceneObjects(); markProjectDirty(); });
      colorGroup.appendChild(colorInput);
      root.appendChild(colorGroup);

      // Image upload
      const uploadSection = document.createElement('div');
      uploadSection.className = 'upload-section';
      const uploadBtn = document.createElement('button');
      uploadBtn.className = 'upload-btn';
      uploadBtn.innerHTML = '<i class="fas fa-image"></i> Upload Image';
      uploadBtn.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.addEventListener('change', (e) => {
          const file = e.target.files[0];
          if (file) storeAsset(file, (aid) => { obj.assetId = aid; renderSceneObjects(); showObjectProperties(obj); markProjectDirty(); });
        });
        input.click();
      });
      uploadSection.appendChild(uploadBtn);

      if (obj.assetId && assetLibrary[obj.assetId]) {
        const preview = document.createElement('img');
        preview.className = 'asset-preview';
        preview.src = assetLibrary[obj.assetId].dataUrl;
        preview.style.maxWidth = '100%';
        uploadSection.appendChild(preview);

        const clearBtn = document.createElement('button');
        clearBtn.className = 'clear-btn';
        clearBtn.innerHTML = '<i class="fas fa-times"></i> Clear Image';
        clearBtn.addEventListener('click', () => { obj.assetId = null; renderSceneObjects(); showObjectProperties(obj); markProjectDirty(); });
        uploadSection.appendChild(clearBtn);
      }
      root.appendChild(uploadSection);
    }

    // Physics
    if (obj.kind !== 'text') {
      addPhysicsProperties(root, obj);
    }

    // Collision
    if (obj.kind !== 'text') {
      addCollisionProperties(root, obj);
    }

    // Components
    const hr = document.createElement('hr');
    hr.className = 'prop-divider';
    root.appendChild(hr);
    appendComponentInspector(root, obj);

    // Delete
    const hr2 = document.createElement('hr');
    hr2.className = 'prop-divider';
    root.appendChild(hr2);
    const delBtn = document.createElement('button');
    delBtn.className = 'danger-btn';
    delBtn.textContent = 'Delete Object';
    delBtn.addEventListener('click', deleteSelectedObject);
    root.appendChild(delBtn);
  }

  function addTextProperties(root, obj) {
    const textGroup = document.createElement('div');
    textGroup.className = 'prop-group';
    textGroup.innerHTML = `<label>Text Content</label>`;
    const textInput = document.createElement('input');
    textInput.className = 'property-input';
    textInput.value = obj.text || '';
    textInput.addEventListener('input', (e) => { obj.text = e.target.value; renderSceneObjects(); markProjectDirty(); });
    textGroup.appendChild(textInput);
    root.appendChild(textGroup);

    // Font size
    const fsGroup = document.createElement('div');
    fsGroup.className = 'prop-group';
    fsGroup.innerHTML = `<label>Font Size</label>`;
    const fsInput = document.createElement('input');
    fsInput.type = 'number';
    fsInput.className = 'property-input';
    fsInput.value = obj.fontSize || 24;
    fsInput.addEventListener('input', (e) => { obj.fontSize = Number(e.target.value) || 24; renderSceneObjects(); markProjectDirty(); });
    fsGroup.appendChild(fsInput);
    root.appendChild(fsGroup);

    // Text color
    const tcGroup = document.createElement('div');
    tcGroup.className = 'prop-group';
    tcGroup.innerHTML = `<label>Text Color</label>`;
    const tcInput = document.createElement('input');
    tcInput.type = 'color';
    tcInput.className = 'property-input';
    tcInput.style.height = '36px';
    tcInput.value = obj.textColor || '#111827';
    tcInput.addEventListener('input', (e) => { obj.textColor = e.target.value; renderSceneObjects(); markProjectDirty(); });
    tcGroup.appendChild(tcInput);
    root.appendChild(tcGroup);
  }

  function addVisualProperties(root, obj) {
    // Static checkbox
    const staticRow = document.createElement('label');
    staticRow.className = 'checkbox-row';
    staticRow.innerHTML = `<input type="checkbox" id="prop-static" ${obj.static ? 'checked' : ''}> Static (immovable)`;
    root.appendChild(staticRow);
    document.getElementById('prop-static').addEventListener('change', (e) => { obj.static = e.target.checked; markProjectDirty(); });

    // Tags
    const tagGroup = document.createElement('div');
    tagGroup.className = 'prop-group';
    tagGroup.innerHTML = `<label>Tags (comma-separated)</label>`;
    const tagInput = document.createElement('input');
    tagInput.className = 'property-input';
    tagInput.value = (obj.tags || []).join(', ');
    tagInput.addEventListener('input', (e) => { obj.tags = e.target.value.split(',').map((t) => t.trim()).filter(Boolean); markProjectDirty(); });
    tagGroup.appendChild(tagInput);
    root.appendChild(tagGroup);
  }

  function addPhysicsProperties(root, obj) {
    const panel = document.createElement('div');
    panel.className = 'physics-panel';
    panel.innerHTML = `<h4><i class="fas fa-atom"></i> Physics</h4>`;

    const enableRow = document.createElement('label');
    enableRow.className = 'checkbox-row';
    enableRow.innerHTML = `<input type="checkbox" id="prop-physics" ${obj.physicsEnabled ? 'checked' : ''}> Enable Physics`;
    panel.appendChild(enableRow);
    document.getElementById('prop-physics').addEventListener('change', (e) => {
      obj.physicsEnabled = e.target.checked;
      if (e.target.checked) {
        obj.physics = obj.physics || {};
        ensureComponent(obj, 'Rigidbody2D', obj.physics);
      }
      markProjectDirty();
    });

    if (obj.physicsEnabled) {
      const p = obj.physics || {};
      ['gravity', 'friction', 'bounciness', 'maxSpeed'].forEach((prop) => {
        const g = document.createElement('div');
        g.className = 'prop-group';
        g.innerHTML = `<label>${prop.charAt(0).toUpperCase() + prop.slice(1)}</label>`;
        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'property-input';
        input.step = '0.1';
        input.value = p[prop] ?? (prop === 'gravity' ? 0 : prop === 'friction' ? 0.82 : prop === 'bounciness' ? 0.4 : 25);
        input.addEventListener('input', (e) => {
          obj.physics = obj.physics || {};
          obj.physics[prop] = Number(e.target.value) || 0;
          markProjectDirty();
        });
        g.appendChild(input);
        panel.appendChild(g);
      });
    }

    root.appendChild(panel);
  }

  function addCollisionProperties(root, obj) {
    obj.collision = obj.collision || {};
    const g = document.createElement('div');
    g.className = 'prop-group';
    g.innerHTML = `<label>Collision</label>`;

    const enableRow = document.createElement('label');
    enableRow.className = 'checkbox-row';
    enableRow.innerHTML = `<input type="checkbox" id="prop-collision" ${obj.collision.enabled ? 'checked' : ''}> Enable Collision`;
    g.appendChild(enableRow);

    const triggerRow = document.createElement('label');
    triggerRow.className = 'checkbox-row';
    triggerRow.innerHTML = `<input type="checkbox" id="prop-trigger" ${obj.collision.trigger ? 'checked' : ''}> Trigger Only (no solid)`;
    g.appendChild(triggerRow);

    root.appendChild(g);

    document.getElementById('prop-collision').addEventListener('change', (e) => { obj.collision.enabled = e.target.checked; markProjectDirty(); });
    document.getElementById('prop-trigger').addEventListener('change', (e) => { obj.collision.trigger = e.target.checked; markProjectDirty(); });
  }

  function appendComponentInspector(root, obj) {
    const section = document.createElement('div');
    section.className = 'component-section';

    const header = document.createElement('div');
    header.className = 'component-section-header';
    header.innerHTML = `<h4>Components</h4>`;
    const addBtn = document.createElement('button');
    addBtn.className = 'component-mini-btn';
    addBtn.textContent = '+ Add';
    addBtn.addEventListener('click', () => openComponentPicker(obj));
    header.appendChild(addBtn);
    section.appendChild(header);

    (obj.components || []).forEach((comp) => {
      section.appendChild(renderComponentCard(obj, comp));
    });

    root.appendChild(section);
  }

  function renderComponentCard(obj, comp) {
    const def = getComponentDefinition(comp.type);
    const card = document.createElement('div');
    card.className = 'component-card';

    const header = document.createElement('div');
    header.className = 'component-card-header';
    header.innerHTML = `
      <div class="component-title">
        <span class="component-state ${comp.enabled === false ? 'is-off' : 'is-on'}">${comp.enabled === false ? 'Off' : 'On'}</span>
        ${comp.type}
      </div>
      <div class="component-category">${def?.category || 'Custom'}</div>
    `;
    const actions = document.createElement('div');
    actions.className = 'component-actions';

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'component-mini-btn';
    toggleBtn.textContent = comp.enabled === false ? 'On' : 'Off';
    toggleBtn.addEventListener('click', () => { comp.enabled = comp.enabled === false; if (comp.enabled) { comp.enabled = true; } else { comp.enabled = false; } showObjectProperties(obj); });
    actions.appendChild(toggleBtn);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'component-mini-btn danger';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => { removeComponent(obj, comp.id); showObjectProperties(obj); markProjectDirty(); });
    actions.appendChild(removeBtn);

    header.appendChild(actions);
    card.appendChild(header);

    // Body with property fields
    const body = document.createElement('div');
    body.className = 'component-card-body';
    const props = comp.props || {};
    const defProps = defaultPropsFor(comp.type, obj);
    const allKeys = [...new Set([...Object.keys(defProps), ...Object.keys(props)])];

    allKeys.forEach((key) => {
      if (key === 'variables') return;
      const row = document.createElement('div');
      row.className = 'component-prop';
      row.innerHTML = `<label>${key}</label>`;
      const val = props[key] ?? defProps[key];
      const input = document.createElement('input');
      input.className = 'property-input';
      input.value = typeof val === 'object' ? JSON.stringify(val) : String(val);
      input.addEventListener('change', (e) => {
        let v = e.target.value;
        if (typeof defProps[key] === 'number') v = Number(v) || 0;
        if (typeof defProps[key] === 'boolean') v = v === 'true' || v === true;
        comp.props = comp.props || {};
        comp.props[key] = v;
        markProjectDirty();
      });
      row.appendChild(input);
      body.appendChild(row);
    });

    card.appendChild(body);
    return card;
  }

  function openComponentPicker(obj) {
    const items = global.HydraCore.COMPONENT_DEFS
      .filter((c) => !(obj.components || []).some((oc) => oc.type === c.type))
      .map((c) => ({ title: c.type, category: c.category, description: c.description, value: c.type }));

    openPickerDialog('Add Component', items, (value) => {
      addComponent(obj, value);
      showObjectProperties(obj);
      markProjectDirty();
    });
  }

  // ============================================================
  // OBJECT HIERARCHY LIST
  // ============================================================
  function renderObjectList(filter = '') {
    const list = document.getElementById('scene-object-list');
    if (!list) return;
    const scene = getCurrentScene();
    list.innerHTML = '';
    const objects = scene?.objects || [];
    const q = filter.trim().toLowerCase();
    const filtered = q ? objects.filter((o) => o.name.toLowerCase().includes(q)) : objects;

    document.getElementById('scene-object-count').textContent = objects.length;

    if (!filtered.length) {
      list.innerHTML = '<div class="object-list-empty">No objects</div>';
      return;
    }

    filtered.forEach((obj) => {
      const item = document.createElement('div');
      item.className = 'object-list-item' + (obj.id === selectedObjectId ? ' active' : '');
      item.innerHTML = `
        <div class="object-list-swatch" style="background:${obj.color || obj.textColor || '#4488ff'}"></div>
        <div class="object-list-name">${escapeHtml(obj.name)}</div>
        <div class="object-list-meta">${obj.kind}</div>
      `;
      item.addEventListener('click', () => selectObject(obj.id));
      list.appendChild(item);
    });
  }

  // ============================================================
  // SCENE MANAGEMENT
  // ============================================================
  function addScene() {
    const scene = createScene('Scene ' + nextSceneId);
    nextSceneId++;
    scenes.push(scene);
    currentSceneId = scene.id;
    renderSceneObjects();
    refreshSceneList();
    refreshSceneSwitcher();
    refreshScopeTabs();
    markProjectDirty();
  }

  function deleteScene() {
    if (scenes.length <= 1) { alert('Cannot delete the only scene.'); return; }
    if (!confirm('Delete this scene and all its objects?')) return;
    const idx = scenes.findIndex((s) => s.id === currentSceneId);
    scenes.splice(idx, 1);
    currentSceneId = scenes[Math.max(0, idx - 1)].id;
    renderSceneObjects();
    refreshSceneList();
    refreshSceneSwitcher();
    refreshScopeTabs();
    markProjectDirty();
  }

  function renameScene() {
    const scene = getCurrentScene();
    if (!scene) return;
    const name = prompt('Scene name:', scene.name);
    if (name && name.trim()) { scene.name = name.trim(); refreshSceneList(); refreshSceneSwitcher(); refreshScopeTabs(); markProjectDirty(); }
  }

  function switchScene(id) {
    currentSceneId = id;
    renderSceneObjects();
    refreshSceneList();
    refreshSceneSwitcher();
    markProjectDirty();
  }

  function refreshSceneList() {
    const list = document.getElementById('scene-list');
    if (!list) return;
    list.innerHTML = '';
    scenes.forEach((scene) => {
      const item = document.createElement('div');
      item.className = 'scene-list-item' + (scene.id === currentSceneId ? ' active' : '');
      item.innerHTML = `<div class="scene-list-item-name">${escapeHtml(scene.name)}</div>`;
      item.addEventListener('click', () => switchScene(scene.id));
      list.appendChild(item);
    });
  }

  function refreshSceneSwitcher() {
    const sel = document.getElementById('scene-switcher-select');
    if (!sel) return;
    sel.innerHTML = '';
    scenes.forEach((scene) => {
      const opt = document.createElement('option');
      opt.value = scene.id;
      opt.textContent = scene.name;
      if (scene.id === currentSceneId) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function updateSceneSettings() {
    const scene = getCurrentScene();
    if (!scene) return;
    const el = (id) => document.getElementById(id);
    if (el('scene-bg-color')) el('scene-bg-color').value = scene.bgColor || '#1a1a2e';
    if (el('scene-width')) el('scene-width').value = scene.worldWidth || 800;
    if (el('scene-height')) el('scene-height').value = scene.worldHeight || 600;
    if (el('scene-viewport-width')) el('scene-viewport-width').value = scene.viewportWidth || 800;
    if (el('scene-viewport-height')) el('scene-viewport-height').value = scene.viewportHeight || 600;

    const clearBtn = document.getElementById('scene-bg-clear-btn');
    if (clearBtn) clearBtn.style.display = scene.bgAssetId ? 'inline-block' : 'none';
  }

  // ============================================================
  // LOGIC EDITOR — Block Palette + Grid
  // ============================================================
  function initLogicEditor() {
    // Logic view toggle
    const gridBtn = document.getElementById('logic-view-grid-btn');
    const eventsBtn = document.getElementById('logic-view-events-btn');
    gridBtn?.addEventListener('click', () => setLogicView('grid'));
    eventsBtn?.addEventListener('click', () => setLogicView('events'));

    // Clear grid button
    document.getElementById('clear-grid-btn')?.addEventListener('click', () => {
      if (!confirm('Clear all blocks from this scope?')) return;
      Object.keys(cellData).forEach((k) => delete cellData[k]);
      renderGrid();
      commitActiveGrid();
    });

    // Block search
    document.getElementById('block-search')?.addEventListener('input', (e) => filterBlocks(e.target.value));
  }

  function hydrateBlockPalette() {
    const panel = document.getElementById('block-type-panel');
    if (!panel) return;
    panel.innerHTML = '';

    CATEGORIES.forEach((cat) => {
      const label = document.createElement('div');
      label.className = 'block-category-label';
      label.textContent = cat;
      panel.appendChild(label);

      getBlocksByCategory(cat).forEach((block) => {
        const opt = document.createElement('div');
        opt.className = 'block-option';
        opt.dataset.blockType = block.blockType;
        opt.innerHTML = `<div class="block-color" style="background:${block.color}"></div><div class="block-label">${block.label}</div>`;
        opt.addEventListener('click', () => selectBlockTool(block.blockType));
        panel.appendChild(opt);
      });
    });
  }

  function selectBlockTool(type) {
    selectedBlockType = type;
    document.querySelectorAll('.block-option').forEach((opt) => {
      opt.classList.toggle('selected', opt.dataset.blockType === type);
    });
  }

  function filterBlocks(term) {
    const q = term.trim().toLowerCase();
    document.querySelectorAll('.block-option').forEach((opt) => {
      const label = opt.querySelector('.block-label')?.textContent.toLowerCase() || '';
      const type = opt.dataset.blockType?.toLowerCase() || '';
      opt.classList.toggle('is-filtered', Boolean(q) && !label.includes(q) && !type.includes(q));
    });
  }

  function setLogicView(view) {
    activeLogicView = view;
    document.getElementById('logic-view-grid-btn')?.classList.toggle('active', view === 'grid');
    document.getElementById('logic-view-events-btn')?.classList.toggle('active', view === 'events');
    document.getElementById('grid-wrapper')?.style.setProperty('display', view === 'grid' ? '' : 'none');
    document.getElementById('event-sheet')?.style.setProperty('display', view === 'events' ? 'block' : 'none');
    if (view === 'events') renderEventSheet();
    if (view === 'grid') renderGrid();
  }

  function refreshScopeTabs() {
    const container = document.getElementById('scope-tabs');
    if (!container) return;
    container.innerHTML = '';

    const globalTab = document.createElement('div');
    globalTab.className = 'scope-tab' + (activeScriptScope === 'global' ? ' active' : '');
    globalTab.dataset.scope = 'global';
    globalTab.innerHTML = '<i class="fas fa-globe"></i> Global';
    globalTab.addEventListener('click', () => switchScope('global'));
    container.appendChild(globalTab);

    scenes.forEach((s) => {
      const t = document.createElement('div');
      t.className = 'scope-tab' + (activeScriptScope === s.id ? ' active' : '');
      t.dataset.scope = s.id;
      t.textContent = s.name;
      t.addEventListener('click', () => switchScope(s.id));
      container.appendChild(t);
    });

    const info = document.getElementById('scope-info');
    if (info) {
      info.textContent = activeScriptScope === 'global'
        ? 'Global script runs across ALL scenes'
        : `Script for: ${scenes.find((s) => s.id === activeScriptScope)?.name || '?'} — only runs when this scene is active`;
    }
  }

  function switchScope(scope) {
    commitActiveGrid();
    activeScriptScope = scope;
    refreshScopeTabs();
    loadGridForScope(scope);
  }

  // ---- Grid Rendering ----
  function renderGrid() {
    const grid = document.getElementById('grid-editor');
    if (!grid) return;
    grid.innerHTML = '';

    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const idx = row * GRID_COLS + col;
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.index = idx;

        const data = cellData[idx];
        if (data) {
          applyBlockVisual(cell, data);
        }

        cell.addEventListener('click', () => onCellClick(cell, idx));
        grid.appendChild(cell);
      }
    }
  }

  function applyBlockVisual(cell, data) {
    const block = getBlock(data.blockType || data.type) || getBlockByRuntime(data.type);
    const blockType = block?.blockType || data.blockType || data.type;
    cell.dataset.blockType = blockType;
    cell.dataset.cellLabel = block?.cellLabel || data.type || 'Block';
    if (block?.color) cell.style.setProperty('--block-bg', block.color);
  }

  function onCellClick(cell, idx) {
    // If a block tool is selected and cell is empty, place it
    if (selectedBlockType && !cellData[idx]) {
      const block = getBlock(selectedBlockType);
      if (!block) return;
      cellData[idx] = { ...clone(block.defaults), _idx: idx, blockType: selectedBlockType, kind: block.kind };
      applyBlockVisual(cell, cellData[idx]);
      commitActiveGrid();
      // Keep tool selected for rapid placement
    }
    // If cell has a block, select it for editing
    else if (cellData[idx]) {
      selectCell(cell, idx);
    }
  }

  function selectCell(cell, idx) {
    document.querySelectorAll('.cell.selected').forEach((c) => c.classList.remove('selected'));
    cell.classList.add('selected');
    selectedCell = cell;
    showBlockProperties(idx);
  }

  function showBlockProperties(idx) {
    const data = cellData[idx];
    if (!data) return;
    const block = getBlock(data.blockType || data.type) || getBlockByRuntime(data.type);
    const panel = document.getElementById('properties-content');
    if (!panel) return;
    panel.innerHTML = '';

    // Title
    const title = document.createElement('div');
    title.className = 'panel-title';
    title.innerHTML = `<i class="fas fa-cube" style="color:${block?.color || '#64748b'}"></i> ${block?.label || data.type}`;
    panel.appendChild(title);

    const body = document.createElement('div');
    body.className = 'panel-body';

    if (block?.note) {
      const note = document.createElement('p');
      note.className = 'hint-text';
      note.textContent = block.note;
      body.appendChild(note);
    }

    // Fields
    (block?.fields || []).forEach((field) => {
      const group = document.createElement('div');
      group.className = 'property-group';
      group.innerHTML = `<label>${field.label}</label>`;

      const val = data[field.key] ?? block.defaults[field.key] ?? '';

      if (field.control === 'select') {
        const sel = document.createElement('select');
        sel.className = 'property-input';
        field.options.forEach(([v, t]) => {
          const opt = document.createElement('option');
          opt.value = v;
          opt.textContent = t;
          sel.appendChild(opt);
        });
        sel.value = val;
        sel.addEventListener('change', (e) => {
          let v = e.target.value;
          if (v === 'true') v = true;
          if (v === 'false') v = false;
          data[field.key] = v;
          commitActiveGrid();
        });
        group.appendChild(sel);
      } else if (field.control === 'textarea') {
        const ta = document.createElement('textarea');
        ta.className = 'property-input';
        ta.value = val;
        ta.placeholder = field.placeholder || '';
        ta.addEventListener('input', (e) => { data[field.key] = e.target.value; markProjectDirty(); });
        group.appendChild(ta);
      } else if (field.control === 'color') {
        const inp = document.createElement('input');
        inp.type = 'color';
        inp.className = 'property-input';
        inp.style.height = '36px';
        inp.value = val;
        inp.addEventListener('input', (e) => { data[field.key] = e.target.value; markProjectDirty(); });
        group.appendChild(inp);
      } else if (field.control === 'object') {
        const sel = document.createElement('select');
        sel.className = 'property-input';
        sel.innerHTML = '<option value="">— Select object —</option>';
        const scene = getCurrentScene();
        (scene?.objects || []).forEach((o) => {
          const opt = document.createElement('option');
          opt.value = o.name;
          opt.textContent = o.name;
          sel.appendChild(opt);
        });
        sel.value = val;
        sel.addEventListener('change', (e) => { data[field.key] = e.target.value; commitActiveGrid(); });
        group.appendChild(sel);
      } else {
        // text or expr
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.className = 'property-input';
        inp.value = val;
        inp.placeholder = field.placeholder || '';
        inp.addEventListener('input', (e) => { data[field.key] = e.target.value; markProjectDirty(); });
        group.appendChild(inp);
      }

      body.appendChild(group);
    });

    // Delete button
    const delBtn = document.createElement('button');
    delBtn.className = 'danger-btn';
    delBtn.textContent = 'Delete Block';
    delBtn.addEventListener('click', () => {
      delete cellData[idx];
      selectedCell = null;
      renderGrid();
      commitActiveGrid();
      document.getElementById('properties-content').innerHTML = '';
    });
    body.appendChild(delBtn);

    panel.appendChild(body);
  }

  function refreshScriptMeta() {
    const count = Object.keys(cellData).length;
    const meta = document.getElementById('script-meta');
    if (meta) meta.textContent = `${count} block${count !== 1 ? 's' : ''}`;
  }

  // ---- Event Sheet View ----
  function renderEventSheet() {
    const container = document.getElementById('event-sheet');
    if (!container) return;
    const rows = gridToEventRows(cellData);
    container.innerHTML = '';

    if (!rows.length) {
      container.innerHTML = '<div class="event-empty">No events yet. Switch to Grid view to add blocks.</div>';
      return;
    }

    rows.forEach((row) => {
      if (row.comment) {
        const comment = document.createElement('div');
        comment.className = 'event-comment-row';
        comment.textContent = '💡 ' + row.comment;
        container.appendChild(comment);
        return;
      }

      const el = document.createElement('div');
      el.className = 'event-row';

      const inner = document.createElement('div');
      inner.className = 'event-row-inner';

      // Conditions
      const condCell = document.createElement('div');
      condCell.className = 'event-cell';
      condCell.innerHTML = '<span class="event-cell-title">IF</span>';
      if (row.conditions.length === 0) {
        condCell.innerHTML += '<span class="event-empty">always</span>';
      } else {
        row.conditions.forEach((c) => {
          const block = getBlock(c.blockType || c.type) || getBlockByRuntime(c.type);
          const chip = document.createElement('span');
          chip.className = 'event-chip condition';
          chip.textContent = block?.label || c.type;
          condCell.appendChild(chip);
        });
      }
      inner.appendChild(condCell);

      // Actions
      const actCell = document.createElement('div');
      actCell.className = 'event-cell';
      actCell.innerHTML = '<span class="event-cell-title">DO</span>';
      if (row.actions.length === 0) {
        actCell.innerHTML += '<span class="event-empty">nothing</span>';
      } else {
        row.actions.forEach((a) => {
          const block = getBlock(a.blockType || a.type) || getBlockByRuntime(a.type);
          const chip = document.createElement('span');
          chip.className = 'event-chip action';
          chip.textContent = block?.label || a.type;
          actCell.appendChild(chip);
        });
      }
      inner.appendChild(actCell);

      el.appendChild(inner);
      container.appendChild(el);
    });
  }

  // ============================================================
  // PREVIEW
  // ============================================================
  function initPreview() {
    document.getElementById('preview-restart-btn')?.addEventListener('click', () => { stopPreview(); launchPreview(); });
    document.getElementById('preview-stop-btn')?.addEventListener('click', () => stopPreview());
  }

  function launchPreview() {
    stopPreview();
    saveCurrentProject(true);
    const container = document.getElementById('preview-container');
    if (!container) return;

    container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'preview-wrapper';
    const canvas = document.createElement('canvas');
    canvas.id = 'game-canvas';
    wrapper.appendChild(canvas);

    const overlay = document.createElement('div');
    overlay.className = 'preview-overlay';
    overlay.innerHTML = `
      <div class="preview-title">${escapeHtml(project?.name || 'Preview')}</div>
      <div class="preview-controls">
        <button class="preview-btn" id="preview-restart-btn" title="Restart"><i class="fas fa-redo"></i></button>
        <button class="preview-btn" id="preview-stop-btn" title="Stop"><i class="fas fa-stop"></i></button>
      </div>
    `;
    wrapper.appendChild(overlay);
    container.appendChild(wrapper);

    document.getElementById('preview-restart-btn').addEventListener('click', () => { stopPreview(); launchPreview(); });
    document.getElementById('preview-stop-btn').addEventListener('click', () => stopPreview());

    try {
      const playProject = clone(project);
      engineState = global.HydraEngine.start(playProject, { canvas });
    } catch (e) {
      container.innerHTML = `<div class="preview-empty"><i class="fas fa-exclamation-triangle"></i><br>Error: ${escapeHtml(e.message)}</div>`;
    }
  }

  function stopPreview() {
    if (engineState) {
      global.HydraEngine.stop(engineState);
      engineState = null;
    }
  }

  // ============================================================
  // EXPORT
  // ============================================================
  function exportGame() {
    saveCurrentProject(true);
    if (!global.HydraEngine?.buildPlayableHtml) { alert('Export not available.'); return; }
    const html = global.HydraEngine.buildPlayableHtml(clone(project));
    const blob = new Blob([html], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(project.name || 'hydra-game').replace(/[^a-z0-9_-]+/gi, '_')}_playable.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ============================================================
  // KEYBOARD SHORTCUTS
  // ============================================================
  function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Don't intercept when typing in inputs
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

      // Ctrl+S = save
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveCurrentProject(); }
      // Delete = delete selected object
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedObjectId) { e.preventDefault(); deleteSelectedObject(); }
      }
      // Ctrl+D = duplicate
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') { e.preventDefault(); duplicateSelectedObject(); }
      // Escape = deselect
      if (e.key === 'Escape') {
        selectedObjectId = null;
        selectedCell = null;
        document.querySelectorAll('.game-object.selected, .cell.selected').forEach((el) => el.classList.remove('selected'));
        document.getElementById('properties-content').innerHTML = '';
      }
    });
  }

  // ============================================================
  // PICKER DIALOG (reusable)
  // ============================================================
  function openPickerDialog(title, items, onPick) {
    const backdrop = document.createElement('div');
    backdrop.className = 'hydra-modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'hydra-modal';
    modal.innerHTML = `
      <div class="hydra-modal-header">
        <strong>${title}</strong>
        <button class="component-mini-btn" data-close>Close</button>
      </div>
      <div class="hydra-modal-body picker-layout">
        <section class="picker-main">
          <input class="picker-search" type="search" placeholder="Search...">
          <div class="picker-grid"></div>
        </section>
        <aside class="picker-details">
          <div class="picker-detail-icon"><i class="fas fa-magic"></i></div>
          <strong>Select an item</strong>
          <p>Choose from the list to see details.</p>
        </aside>
      </div>
    `;
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    const search = modal.querySelector('.picker-search');
    const grid = modal.querySelector('.picker-grid');
    const detail = modal.querySelector('.picker-details');
    const close = () => backdrop.remove();
    modal.querySelector('[data-close]').addEventListener('click', close);
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });

    function showDetail(item) {
      if (!item || !detail) return;
      detail.innerHTML = `
        <div class="picker-detail-icon"><i class="fas fa-bolt"></i></div>
        <strong>${item.title}</strong>
        <div class="picker-detail-category">${item.category || 'General'}</div>
        <p>${item.description || ''}</p>
      `;
    }

    function render(term = '') {
      const q = term.trim().toLowerCase();
      grid.innerHTML = '';
      const filtered = items.filter((i) => !q || `${i.title} ${i.category} ${i.description}`.toLowerCase().includes(q));
      if (!filtered.length) { grid.innerHTML = '<div class="picker-empty">No items</div>'; return; }
      let cat = null;
      filtered.forEach((item) => {
        if ((item.category || 'General') !== cat) {
          cat = item.category || 'General';
          const label = document.createElement('div');
          label.className = 'picker-category';
          label.textContent = cat;
          grid.appendChild(label);
        }
        const btn = document.createElement('button');
        btn.className = 'picker-item';
        btn.innerHTML = `<strong>${item.title}</strong><span>${item.description || ''}</span>`;
        btn.addEventListener('mouseenter', () => showDetail(item));
        btn.addEventListener('click', () => { onPick(item.value, item); close(); });
        grid.appendChild(btn);
      });
      if (filtered[0]) showDetail(filtered[0]);
    }

    search.addEventListener('input', (e) => render(e.target.value));
    render();
    setTimeout(() => search.focus(), 0);
  }

  // ============================================================
  // EXPORT TO WINDOW
  // ============================================================
  global.HydraEditor = {
    getProject: () => project,
    getScenes: () => scenes,
    getCurrentScene,
    saveCurrentProject,
    loadProjects,
    setProject,
    renderSceneObjects,
  };

})(window);
