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

function storeAsset(file, callback) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const id = 'asset_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    assetLibrary[id] = { name: file.name, dataUrl: e.target.result };
    callback(id);
  };
  reader.readAsDataURL(file);
}

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
  objects: [],
  executionContext: null,
  conditionContexts: {},
  camera: { x: 0, y: 0, followTarget: '' },
  cameraShake: { strength: 0, timeLeft: 0 },
  mouse: { x: 0, y: 0 },
  dt: 1,
  frameId: 0
};
const gameVariables = {};
const hiddenObjects   = new Set();
const destroyedObjects = new Set();
const pendingDestroy   = new Set();
let   gameRunning    = false;
let   gameStartFired = false;
const gameStartFiredScopes = new Set();
let   rafHandle      = null;
let   lastTime       = 0;
let   autosaveTimer  = null;

function normalizeSceneDimensions(scene) {
  if (!scene) return null;
  window.HydraUniversal?.normalizeScene?.(scene);
  const worldW = Number(scene.worldWidth || scene.width || 800);
  const worldH = Number(scene.worldHeight || scene.height || 600);
  scene.worldWidth = Math.max(100, worldW);
  scene.worldHeight = Math.max(100, worldH);
  scene.width = scene.worldWidth;
  scene.height = scene.worldHeight;
  scene.viewportWidth = Math.max(100, Number(scene.viewportWidth || Math.min(scene.worldWidth, 800) || 800));
  scene.viewportHeight = Math.max(100, Number(scene.viewportHeight || Math.min(scene.worldHeight, 600) || 600));
  return scene;
}

function getSceneWorldWidth(scene) {
  return normalizeSceneDimensions(scene)?.worldWidth || 800;
}

function getSceneWorldHeight(scene) {
  return normalizeSceneDimensions(scene)?.worldHeight || 600;
}

function getSceneViewportWidth(scene) {
  return normalizeSceneDimensions(scene)?.viewportWidth || 800;
}

function getSceneViewportHeight(scene) {
  return normalizeSceneDimensions(scene)?.viewportHeight || 600;
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
  if (scope === 'global') return 'global';
  const parsed = parseInt(scope, 10);
  return Number.isFinite(parsed) ? parsed : 'global';
}

function sameScriptScope(a, b) {
  return normalizeScriptScope(a) === normalizeScriptScope(b);
}

function getScopeKey(scope) {
  return String(normalizeScriptScope(scope));
}

function gridHasBlocks(gridData) {
  return Boolean(gridData && Object.keys(gridData).length);
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

function stopPreviewLoop() {
  gameRunning = false;
  if (rafHandle) {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }
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
  renderEventSheet?.();
  if (options.dirty !== false) markProjectDirty({ autosave: options.autosave });
}

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

  const info = document.getElementById('scope-info');
  if (info) {
    if (activeScriptScope === 'global') {
      info.textContent = 'Global script runs logic across ALL scenes';
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
  const normalizedScope = normalizeScriptScope(scope);
  if (normalizedScope === 'global') return globalGridData;
  const s = scenes.find(x => x.id === normalizedScope);
  if (!s) return {};
  if (!s.gridData) s.gridData = {};
  return s.gridData;
}

function saveGridToScope(scope) {
  const normalizedScope = normalizeScriptScope(scope);
  const target = normalizedScope === 'global' ? globalGridData : (() => {
    const s = scenes.find(x => x.id === normalizedScope);
    if (!s) return null;
    if (!s.gridData) s.gridData = {};
    return s.gridData;
  })();
  if (!target) return;
  // Clear then repopulate
  Object.keys(target).forEach(k => delete target[k]);
  cellData.forEach((v, k) => { target[k] = cloneData(v); });
  if (normalizedScope !== 'global') {
    const scene = scenes.find(x => x.id === normalizedScope);
    if (scene) {
      scene.logicGrids = scene.logicGrids || {};
      scene.logicGrids.main = scene.gridData;
      window.HydraUniversal?.normalizeScene?.(scene);
    }
  }
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
  Object.entries(source).forEach(([k, v]) => {
    const idx  = parseInt(k);
    const data = cloneData(v);
    cellData.set(idx, data);
    const cell      = cells[idx];
    const blockType = typeToBlockClass(data.type);
    if (cell && blockType) {
      cell.classList.add(blockType);
      cell.dataset.blockType = blockType;
      applyBlockVisualToCell(cell, blockType);
    }
  });
  hydratedScriptScope = normalizedScope;
  scriptGridHydrated = true;
  clearSelectedCell();
  showDefaultPropertiesPanel();
  refreshScriptMeta();
}

function typeToBlockClass(type) {
  const map = {
    keyPressed:    'condition',
    keyJustPressed:'condition',
    triggerOnce:   'trigger-once-condition',
    mouseClick:    'mouse-condition',
    applyForce:    'action',
    collision:     'advanced-condition',
    teleport:      'advanced-action',
    and:           'and-condition',
    setVariable:   'set-variable',
    getVariable:   'get-variable',
    destroyObject: 'destroy-object',
    showHide:      'show-hide',
    playSound:     'play-sound',
    gameStart:     'game-start',
    switchScene:   'switch-scene',
    setText:       'set-text',
    setCamera:     'set-camera',
    followCamera:  'follow-camera',
    setSize:       'set-size',
    onTimer:       'timer-condition',
    onEdge:        'edge-condition',
    setVelocity:   'set-velocity',
    spawnObject:   'spawn-object',
    rotateObject:  'rotate-object',
    randomVariable:'random-variable',
    overlapTouch:  'overlap-condition',
    forceToward:   'force-toward',
  };
  if (map[type]) return map[type];
  const catalogBlock = getCatalogBlocks().find(block => block.runtimeType === type);
  if (catalogBlock) return catalogBlock.blockType;
  return null;
}

// ============================================================
// GRID SYSTEM
// ============================================================
const grid          = document.getElementById('grid');
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
    getCategoryAnchor(block.category || (block.kind === 'condition' ? 'Logic' : 'Actions'));
    const option = document.createElement('div');
    option.className = 'block-option';
    option.dataset.blockType = block.blockType;
    option.innerHTML = `
      <div class="block-color" style="background:${block.color || '#64748b'};"></div>
      <div class="block-label">${block.label}</div>
    `;
    selector.appendChild(option);
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
  opt.addEventListener('click', () => setSelectedBlockTool(opt.getAttribute('data-block-type')));
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
});

function refreshScriptMeta() {
  if (scriptBlockCountEl) scriptBlockCountEl.textContent = String(cellData.size);
  if (scriptActiveToolEl) {
    const selected = [...blockOptions].find(opt => opt.getAttribute('data-block-type') === selectedBlockType);
    scriptActiveToolEl.textContent = selected?.querySelector('.block-label')?.textContent || 'Select / Erase';
  }
  renderEventSheet?.();
}

// ============================================================
// LOGIC VIEWS - grid stays first-class; event sheet is a synced view
// ============================================================
const logicViewGridBtn = document.getElementById('logic-view-grid-btn');
const logicViewEventsBtn = document.getElementById('logic-view-events-btn');
const eventSheetPanel = document.getElementById('event-sheet-panel');
const eventSheetList = document.getElementById('event-sheet-list');
const addEventRowBtn = document.getElementById('add-event-row-btn');
let activeLogicView = 'grid';

function setLogicView(view) {
  activeLogicView = view === 'events' ? 'events' : 'grid';
  const gridEditor = document.querySelector('.grid-editor');
  const gridContainerEl = document.querySelector('.grid-container');
  if (logicViewGridBtn) logicViewGridBtn.classList.toggle('active', activeLogicView === 'grid');
  if (logicViewEventsBtn) logicViewEventsBtn.classList.toggle('active', activeLogicView === 'events');
  if (eventSheetPanel) eventSheetPanel.hidden = activeLogicView !== 'events';
  if (gridContainerEl) gridContainerEl.hidden = activeLogicView !== 'grid';
  if (gridEditor) gridEditor.classList.toggle('event-view-active', activeLogicView === 'events');
  if (activeLogicView === 'events') renderEventSheet();
}

logicViewGridBtn?.addEventListener('click', () => setLogicView('grid'));
logicViewEventsBtn?.addEventListener('click', () => setLogicView('events'));

function renderEventSheet() {
  if (!eventSheetList || activeLogicView !== 'events') return;
  const gd = getGridDataForScope(activeScriptScope);
  const rows = window.HydraUniversal?.gridToEventRows?.(gd) || [];
  eventSheetList.innerHTML = '';
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'event-empty';
    empty.textContent = 'No events yet. Add an event here or use the Logic Grid.';
    eventSheetList.appendChild(empty);
    return;
  }

  rows.forEach(row => {
    if (row.type === 'comment') {
      const comment = document.createElement('div');
      comment.className = 'event-comment-row';
      comment.textContent = row.comment || 'Comment';
      eventSheetList.appendChild(comment);
      return;
    }
    const el = document.createElement('div');
    el.className = 'event-row';
    el.appendChild(renderEventCell('Conditions', row.conditions || [], 'condition', row));
    el.appendChild(renderEventCell('Actions', row.actions || [], 'action', row));
    eventSheetList.appendChild(el);
  });
}
window.renderEventSheet = renderEventSheet;

function renderEventCell(title, items, kind, row) {
  const cell = document.createElement('div');
  cell.className = 'event-cell';
  const header = document.createElement('div');
  header.className = 'event-cell-title';
  header.textContent = title;
  cell.appendChild(header);
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'event-empty';
    empty.textContent = kind === 'condition' ? 'No condition' : 'No action';
    cell.appendChild(empty);
  } else {
    items.forEach(item => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `event-chip ${kind}`;
      chip.textContent = window.HydraUniversal?.formatInstruction?.(item) || item.type;
      chip.title = `Grid cell ${item.index}`;
      chip.addEventListener('click', () => {
        setLogicView('grid');
        const gridCell = cells[item.index];
        if (gridCell) {
          gridCell.scrollIntoView({ block: 'center', inline: 'center' });
          selectCell(gridCell);
        }
      });
      cell.appendChild(chip);
    });
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'event-add-link';
  add.textContent = kind === 'condition' ? '+ Add condition' : '+ Add action';
  add.addEventListener('click', () => openLogicBlockPicker(kind, blockType => addBlockNearEvent(row, kind, blockType)));
  cell.appendChild(add);
  return cell;
}

addEventRowBtn?.addEventListener('click', () => addEventRow());

document.getElementById('diagnostics-toggle')?.addEventListener('click', () => {
  document.getElementById('diagnostics-dock')?.classList.toggle('is-collapsed');
});

function addEventRow() {
  commitActiveGrid({ dirty: false });
  const gd = getGridDataForScope(activeScriptScope);
  let row = 0;
  while (row < 60 && Object.keys(gd).some(idx => Math.floor(Number(idx) / 60) === row)) row++;
  if (row >= 60) {
    window.HydraUniversal?.pushDiagnostic?.('warning', 'Logic grid is full. Clear space before adding another event.');
    return;
  }
  const eventId = `event_${Date.now().toString(36)}`;
  gd[row * 60] = { type: 'always', eventId };
  gd[row * 60 + 1] = { type: 'comment', text: 'Describe this event', eventId };
  loadGridForScope(activeScriptScope);
  setLogicView('events');
  markProjectDirty();
}

function addBlockNearEvent(row, kind, blockType) {
  if (!row?.sourceIndexes?.length) return;
  const gd = getGridDataForScope(activeScriptScope);
  const sourceIndex = row.sourceIndexes[0];
  const sourceRow = Math.floor(sourceIndex / 60);
  let startCol = kind === 'condition' ? 0 : Math.max(1, ...row.sourceIndexes.map(i => i % 60)) + 1;
  for (let col = startCol; col < 60; col++) {
    const idx = sourceRow * 60 + col;
    if (gd[idx]) continue;
    initCellDefaults(idx, blockType);
    const data = cloneData(cellData.get(idx));
    data.eventId = row.id;
    gd[idx] = data;
    loadGridForScope(activeScriptScope);
    setLogicView('events');
    markProjectDirty();
    return;
  }
  window.HydraUniversal?.pushDiagnostic?.('warning', 'No empty space on this grid row for the new block.');
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
  'show-hide','play-sound','game-start','switch-scene','mouse-condition','set-text',
  'set-camera','follow-camera','set-size','timer-condition','edge-condition','trigger-once-condition','set-velocity','spawn-object','rotate-object','random-variable',
  'overlap-condition','force-toward',
  ...getCatalogBlocks().map(block => block.blockType)
];

function applyBlockVisualToCell(cell, blockType) {
  const catalogBlock = getCatalogBlock(blockType);
  if (catalogBlock) {
    cell.style.setProperty('--block-color', catalogBlock.color || '#64748b');
    cell.dataset.blockLabel = catalogBlock.cellLabel || catalogBlock.label || blockType;
  } else {
    cell.style.removeProperty('--block-color');
    delete cell.dataset.blockLabel;
  }
}

function clearBlockVisualFromCell(cell) {
  cell.style.removeProperty('--block-color');
  delete cell.dataset.blockLabel;
}

for (let i = 0; i < 60 * 60; i++) {
  const cell = document.createElement('div');
  cell.className     = 'cell';
  cell.dataset.index = i;
  cell.dataset.row   = Math.floor(i / 60);
  cell.dataset.col   = i % 60;

  cell.addEventListener('click', e => {
    const shift = e.shiftKey;
    if (selectedBlockType === 'none') {
      if (cell.dataset.blockType) selectCell(cell);
      else { clearSelectedCell(); showDefaultPropertiesPanel(); }
      return;
    }
    if (cell.dataset.blockType === selectedBlockType) { if (!shift) selectCell(cell); return; }

    document.getElementById('cell-highlight')?.remove();
    cell.classList.remove(...ALL_BLOCK_CLASSES);
    clearBlockVisualFromCell(cell);

    if (cell.dataset.blockType) {
      delete cell.dataset.blockType;
      cellData.delete(i);
      if (selectedCell === cell) { clearSelectedCell(); showDefaultPropertiesPanel(); }
    } else {
      cell.classList.add(selectedBlockType);
      cell.dataset.blockType = selectedBlockType;
      applyBlockVisualToCell(cell, selectedBlockType);
      if (!cellData.has(i)) initCellDefaults(i, selectedBlockType);
      if (!shift) {
        selectCell(cell);
        blockOptions.forEach(o => { if (o.getAttribute('data-block-type') === 'none') o.click(); });
      }
    }
    commitActiveGrid();
  });

  grid.appendChild(cell);
  cells.push(cell);
}

function initCellDefaults(index, type) {
  const objNames = getAllObjectNames();
  const first    = objNames[0] || '';
  const second   = objNames[1] || '';
  const catalogBlock = getCatalogBlock(type);
  if (catalogBlock?.defaults) {
    const data = cloneData(catalogBlock.defaults);
    if ('targetObject' in data && !data.targetObject) data.targetObject = first;
    if ('sourceObject' in data && !data.sourceObject) data.sourceObject = second || first;
    if ('object1' in data && !data.object1) data.object1 = first;
    if ('object2' in data && !data.object2) data.object2 = second || first;
    if ('platformObject' in data && !data.platformObject) data.platformObject = second || first;
    cellData.set(index, data);
    return;
  }
  const defaults = {
    'condition':        { key: 'ArrowRight', type: 'keyPressed', inputCondition: 'keyPressed', trigger: 'down', reversed: false },
    'mouse-condition':  { button: 'left', type: 'mouseClick', mouseCondition: 'mouseButtonPressed', reversed: false },
    'advanced-condition':{ type: 'collision', object1: first, object2: second, countTouchingEdges: true, reversed: false },
    'action':           { forceX: 5, forceY: 0, type: 'applyForce',   targetObject: first, reversed: false },
    'advanced-action':  { type: 'teleport', toX: 300, toY: 200,       targetObject: first, reversed: false },
    'and-condition':    { type: 'and', reversed: false },
    'set-variable':     { type: 'setVariable', varName: 'score', operation: 'set', value: 0 },
    'get-variable':     { type: 'getVariable', varName: 'score', operator: '>=', compareValue: 1, reversed: false },
    'destroy-object':   { type: 'destroyObject', targetObject: first },
    'show-hide':        { type: 'showHide', targetObject: first, action: 'hide' },
    'play-sound':       { type: 'playSound', frequency: 440, duration: 0.2, waveform: 'square', volume: 0.3 },
    'game-start':       { type: 'gameStart', reversed: false },
    'switch-scene':     { type: 'switchScene', sceneId: currentSceneId },
    'set-text':         { type: 'setText', targetObject: first, value: 'Hello!', useVariable: false, varName: '' },
    'set-camera':       { type: 'setCamera', cameraX: 0, cameraY: 0 },
    'follow-camera':    { type: 'followCamera', targetObject: first, offsetX: 0, offsetY: 0 },
    'set-size':         { type: 'setSize', targetObject: first, width: 64, height: 64 },
    'timer-condition':  { type: 'onTimer', timerName: '', interval: 1.0, reversed: false },
    'edge-condition':   { type: 'onEdge', targetObject: first, edge: 'any', reversed: false },
    'trigger-once-condition': { type: 'triggerOnce', reversed: false },
    'set-velocity':     { type: 'setVelocity', targetObject: first, velX: 5, velY: 0 },
    'spawn-object':     { type: 'spawnObject', sourceObject: first, spawnX: 400, spawnY: 300 },
    'rotate-object':    { type: 'rotateObject', targetObject: first, angle: 90, mode: 'add' },
    'random-variable':  { type: 'randomVariable', varName: 'score', min: 0, max: 10, round: true },
    'overlap-condition':{ type: 'overlapTouch', object1: first, object2: second, tolerance: 4, reversed: false },
    'force-toward':     { type: 'forceToward', targetObject: first, sourceObject: second, speed: 3, mode: 'add' },
  };
  cellData.set(index, defaults[type] ? { ...defaults[type] } : {});
}

// Returns names of all objects across ALL scenes (for script dropdowns)
function getAllObjectNames() {
  const names = new Set();
  scenes.forEach(s => s.objects.forEach(o => { if (o.name) names.add(o.name); }));
  return [...names];
}

// Returns objects from the currently active scene by name
function getObjectsByName(name, objectList) {
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
  const close = () => backdrop.remove();
  modal.querySelector('[data-close-picker]')?.addEventListener('click', close);
  backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) close(); });

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
  clearSelectedCell();
  showDefaultPropertiesPanel();
  commitActiveGrid();
}

// ============================================================
// PROPERTY PANEL BUILDERS
// ============================================================
function makePropGroup(label, input) {
  const g = document.createElement('div'); g.className = 'property-group';
  const l = document.createElement('label'); l.textContent = label;
  g.appendChild(l); g.appendChild(input);
  return g;
}

function makeSelect(options, value, onChange) {
  const s = document.createElement('select'); s.className = 'property-input';
  options.forEach(([v, t]) => {
    const o = document.createElement('option'); o.value = v; o.textContent = t; s.appendChild(o);
  });
  s.value = value;
  s.addEventListener('change', e => { onChange(e.target.value); markProjectDirty(); });
  return s;
}

function makeNumberInput(value, min, max, step, onChange) {
  const i = document.createElement('input');
  i.type = 'number'; i.className = 'property-input';
  i.min = min; i.max = max; i.step = step; i.value = value;
  i.addEventListener('input', e => { onChange(parseFloat(e.target.value) || 0); markProjectDirty(); });
  return i;
}

function makeTextInput(value, placeholder, onChange) {
  const i = document.createElement('input');
  i.type = 'text'; i.className = 'property-input'; i.value = value; i.placeholder = placeholder;
  i.addEventListener('input', e => { onChange(e.target.value); markProjectDirty(); });
  return i;
}

function makeCheckbox(label, checked, onChange) {
  const wrap = document.createElement('label'); wrap.className = 'checkbox-row';
  const cb   = document.createElement('input'); cb.type = 'checkbox'; cb.checked = checked;
  cb.addEventListener('change', e => { onChange(e.target.checked); markProjectDirty(); });
  wrap.appendChild(cb);
  const span = document.createElement('span'); span.textContent = label;
  wrap.appendChild(span);
  return wrap;
}

function makeInvertToggle(data, cellIndex, label = 'Invert condition') {
  return makeCheckbox(label, Boolean(data.reversed), v => {
    data.reversed = v;
    cellData.set(cellIndex, data);
  });
}

// Object name dropdown populated from all scene objects
function makeObjectSelect(value, onChange, includeAll = false) {
  const names = getAllObjectNames();
  const opts  = includeAll ? [['', '-- Any --'], ...names.map(n => [n, n])] : names.map(n => [n, n]);
  if (!opts.length) opts.push(['', '(No named objects yet)']);
  return makeSelect(opts, value, onChange);
}

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

function makeKeyPicker(data, cellIndex) {
  const wrap = document.createElement('div');
  wrap.className = 'key-picker-row';
  const input = makeTextInput(data.key || 'ArrowRight', '"Space", "ArrowRight", "a"', v => {
    data.key = v;
    cellData.set(cellIndex, data);
  });
  const captureBtn = document.createElement('button');
  captureBtn.type = 'button';
  captureBtn.className = 'small-action-btn';
  captureBtn.textContent = 'Record';
  captureBtn.onclick = () => {
    captureBtn.textContent = 'Press a key';
    const capture = e => {
      e.preventDefault();
      data.key = getEventKeyAliases(e)[0] || e.key || 'Space';
      input.value = data.key;
      cellData.set(cellIndex, data);
      markProjectDirty();
      captureBtn.textContent = 'Record';
      document.removeEventListener('keydown', capture, true);
    };
    setTimeout(() => document.addEventListener('keydown', capture, true), 0);
  };
  wrap.appendChild(input);
  wrap.appendChild(captureBtn);
  return wrap;
}

function makeTargetModeSelect(data, cellIndex, label = 'Target instances:') {
  if (!data.targetMode) data.targetMode = 'context';
  const details = document.createElement('details');
  details.className = 'advanced-prop-details';
  details.open = data.targetMode && data.targetMode !== 'context';
  const summary = document.createElement('summary');
  summary.textContent = 'Target matching';
  details.appendChild(summary);
  details.appendChild(makePropGroup(label, makeSelect(
    [
      ['context', 'Matched object, otherwise first'],
      ['first', 'First matching object'],
      ['all', 'All matching objects']
    ],
    data.targetMode || 'context',
    v => { data.targetMode = v; cellData.set(cellIndex, data); markProjectDirty(); }
  )));
  return details;
}

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
    [['left','Left Click'],['right','Right Click'],['any','Any Button']],
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

function showActionProperties(cellIndex) {
  const data = cellData.get(cellIndex) || { forceX: 5, forceY: 0, type: 'applyForce', targetObject: '', reversed: false };
  const root = document.createElement('div');
  root.appendChild(makePropGroup('Object:', makeObjectSelect(data.targetObject, v => { data.targetObject = v; cellData.set(cellIndex, data); })));
  root.appendChild(makeTargetModeSelect(data, cellIndex));
  root.appendChild(makePropGroup('X:', makeExprInput(data.forceX ?? 5, '5 or speed', v => { data.forceX = v; cellData.set(cellIndex, data); })));
  root.appendChild(makePropGroup('Y:', makeExprInput(data.forceY ?? 0, '0 or -jump', v => { data.forceY = v; cellData.set(cellIndex, data); })));
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
  const data = cellData.get(cellIndex) || { type: 'playSound', frequency: 440, duration: 0.2, waveform: 'square', volume: 0.3 };
  const root = document.createElement('div');
  root.appendChild(makePropGroup('Frequency (Hz):', makeNumberInput(data.frequency, 20, 20000, 1, v => { data.frequency = v; cellData.set(cellIndex, data); })));
  root.appendChild(makePropGroup('Duration (s):', makeNumberInput(data.duration, 0.01, 5, 0.01, v => { data.duration = v; cellData.set(cellIndex, data); })));
  root.appendChild(makePropGroup('Waveform:', makeSelect(
    [['square','Square'],['sine','Sine'],['sawtooth','Sawtooth'],['triangle','Triangle']],
    data.waveform,
    v => { data.waveform = v; cellData.set(cellIndex, data); }
  )));
  root.appendChild(makePropGroup('Volume (0–1):', makeNumberInput(data.volume, 0, 1, 0.05, v => { data.volume = v; cellData.set(cellIndex, data); })));
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

function showCatalogBlockProperties(cellIndex, block) {
  const data = cellData.get(cellIndex) || cloneData(block.defaults || { type: block.runtimeType });
  const root = document.createElement('div');
  (block.fields || []).forEach(field => {
    const input = makeCatalogFieldInput(field, data, cellIndex, block);
    root.appendChild(field.control === 'checkbox' || field.key === 'reversed' ? input : makePropGroup(field.label, input));
  });
  const hasPrimaryObjectTarget = block.kind === 'action' && (block.fields || []).some(field => field.key === 'targetObject');
  if (hasPrimaryObjectTarget) {
    root.appendChild(makeTargetModeSelect(data, cellIndex));
  }
  if (!(block.fields || []).length) {
    root.appendChild(makeNote(block.note || `${block.label} has no editable settings.`));
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
      return makeObjectSelect(value, onChange, Boolean(field.includeAll));
    case 'expr':
      return makeExprInput(value, field.placeholder || '', onChange);
    case 'number':
      return makeNumberInput(value, field.min ?? -999999, field.max ?? 999999, field.step ?? 1, onChange);
    case 'checkbox':
      return makeCheckbox(field.label, Boolean(value), onChange);
    case 'color': {
      const input = document.createElement('input');
      input.type = 'color';
      input.className = 'property-input';
      input.style.height = '36px';
      input.value = value || '#ffffff';
      input.addEventListener('input', e => { onChange(e.target.value); markProjectDirty(); });
      return input;
    }
    case 'select':
      return makeSelect(field.options || [], value, onChange);
    case 'text':
    default:
      return makeTextInput(value, field.placeholder || '', onChange);
    case 'textarea': {
      const textarea = document.createElement('textarea');
      textarea.className = 'property-input';
      textarea.rows = field.rows || 4;
      textarea.value = value;
      textarea.placeholder = field.placeholder || '';
      textarea.addEventListener('input', e => { onChange(e.target.value); markProjectDirty(); });
      return textarea;
    }
  }
}

const SHOW_PROPERTY_HELP = false;

function makeNote(text) {
  const n = document.createElement('p');
  n.className = 'prop-note'; n.textContent = text;
  if (!SHOW_PROPERTY_HELP) n.hidden = true;
  return n;
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

function getPreviousHitbox(obj) {
  const prev = Object.assign({}, obj, {
    posX: obj._prevX ?? obj.posX,
    posY: obj._prevY ?? obj.posY
  });
  return getHitbox(prev);
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
function aabbOverlaps(a, b) {
  const ab = getHitbox(a);
  const bb = getHitbox(b);
  return ab.x < bb.x + bb.width && ab.x + ab.width > bb.x &&
         ab.y < bb.y + bb.height && ab.y + ab.height > bb.y;
}

function rangesOverlapOrTouch(aMin, aMax, bMin, bMax, tolerance = 0) {
  return aMin <= bMax + tolerance && aMax >= bMin - tolerance;
}

function getAABBContact(a, b, tolerance = 2) {
  if (!a || !b || a.id === b.id) return null;
  const ab = getHitbox(a);
  const bb = getHitbox(b);
  const horizontal = rangesOverlapOrTouch(ab.x, ab.x + ab.width, bb.x, bb.x + bb.width, tolerance);
  const vertical = rangesOverlapOrTouch(ab.y, ab.y + ab.height, bb.y, bb.y + bb.height, tolerance);
  if (!horizontal || !vertical) return null;

  const overlap = aabbOverlaps(a, b);
  const gaps = [
    { side: 'bottom', distance: Math.abs((ab.y + ab.height) - bb.y) },
    { side: 'top',    distance: Math.abs(ab.y - (bb.y + bb.height)) },
    { side: 'right',  distance: Math.abs((ab.x + ab.width) - bb.x) },
    { side: 'left',   distance: Math.abs(ab.x - (bb.x + bb.width)) }
  ];

  if (!overlap) {
    const touchingSide = gaps
      .filter(gap => gap.distance <= tolerance)
      .sort((aGap, bGap) => aGap.distance - bGap.distance)[0];
    return touchingSide ? { touching: true, overlap: false, side: touchingSide.side } : null;
  }

  const dx = (ab.x + ab.width / 2) - (bb.x + bb.width / 2);
  const dy = (ab.y + ab.height / 2) - (bb.y + bb.height / 2);
  const ox = (ab.width / 2 + bb.width / 2) - Math.abs(dx);
  const oy = (ab.height / 2 + bb.height / 2) - Math.abs(dy);
  const side = ox < oy
    ? (dx < 0 ? 'right' : 'left')
    : (dy < 0 ? 'bottom' : 'top');
  return { touching: true, overlap: true, side };
}

function objectCentersDistance(a, b) {
  const ab = getHitbox(a);
  const bb = getHitbox(b);
  const ax = ab.x + ab.width / 2;
  const ay = ab.y + ab.height / 2;
  const bx = bb.x + bb.width / 2;
  const by = bb.y + bb.height / 2;
  return Math.hypot(ax - bx, ay - by);
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
  if (exprStr === null || exprStr === undefined) return { value: 0, ok: true, unknowns: [] };
  if (typeof exprStr === 'number') return { value: isFinite(exprStr) ? exprStr : 0, ok: isFinite(exprStr), unknowns: [] };
  const s = String(exprStr).trim();
  if (s === '') return { value: 0, ok: true, unknowns: [] };
  const n = Number(s);
  if (!isNaN(n)) return { value: n, ok: true, unknowns: [] };
  try {
    // Resolve "objName.prop" tokens with live values before eval
    const resolved = s.replace(/\b([A-Za-z_]\w*)\.(\w+)\b/g, (_, objName, prop) => {
      const alive = previewState.objects.filter(o => !destroyedObjects.has(o.id));
      const obj = getObjectsByName(objName, alive)[0];
      return (obj && prop in obj) ? String(obj[prop] ?? 0) : '0';
    });
    const scene = getPreviewScene();
    const builtins = {
      mouseX: previewState.mouse?.x ?? 0,
      mouseY: previewState.mouse?.y ?? 0,
      mouseWorldX: (previewState.mouse?.x ?? 0) + (previewState.camera?.x || 0),
      mouseWorldY: (previewState.mouse?.y ?? 0) + (previewState.camera?.y || 0),
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
      dt: previewState.dt ?? 1
    };
    const scopeValues = { ...builtins, ...gameVariables };
    const unknowns = getUnknownExpressionIdentifiers(s, scopeValues);
    if (unknowns.length) {
      window.HydraUniversal?.pushDiagnostic?.(
        'warning',
        `Unknown expression name ${unknowns.join(', ')} in "${s}". The action will wait until it exists.`,
        { expression: s }
      );
      return { value: 0, ok: false, unknowns };
    }
    const keys = Object.keys(scopeValues);
    const vals = keys.map(k => scopeValues[k]);
    // eslint-disable-next-line no-new-func
    const result = new Function(...keys, `"use strict"; return (${resolved});`)(...vals);
    return { value: typeof result === 'number' && isFinite(result) ? result : 0, ok: typeof result === 'number' && isFinite(result), unknowns: [] };
  } catch (err) {
    window.HydraUniversal?.pushDiagnostic?.('warning', `Could not evaluate expression "${s}": ${err.message || err}`);
    return { value: 0, ok: false, unknowns: [] };
  }
}

function getUnknownExpressionIdentifiers(exprStr, scopeValues) {
  const withoutProps = exprStr
    .replace(/\b([A-Za-z_]\w*)\.(\w+)\b/g, '')
    .replace(/"[^"]*"|'[^']*'/g, '');
  const reserved = new Set([
    'Math','true','false','null','undefined','NaN','Infinity',
    'floor','ceil','round','abs','sqrt','max','min','random','sin','cos','tan',
    'if','else','return'
  ]);
  const identifiers = withoutProps.match(/\b[A-Za-z_]\w*\b/g) || [];
  return [...new Set(identifiers.filter(name => !(name in scopeValues) && !reserved.has(name)))];
}

function getTimerKey(scope, idx, data = {}) {
  const name = String(data.timerName || data.name || '').trim();
  return name ? `named:${name}` : `cell:${getScopeKey(scope)}:${idx}`;
}

function getTimerRecord(key, now = performance.now(), interval = 1000) {
  const existing = timerStates.get(key);
  if (existing && typeof existing === 'object') return existing;
  const record = {
    lastFiredTime: typeof existing === 'number' ? existing : now - interval,
    paused: false,
    pausedAt: 0,
    firedFrame: -1
  };
  timerStates.set(key, record);
  return record;
}

function resetNamedTimer(timerName) {
  const name = String(timerName || '').trim();
  if (!name) return;
  timerStates.set(`named:${name}`, {
    lastFiredTime: performance.now(),
    paused: false,
    pausedAt: 0,
    firedFrame: -1
  });
}

function setNamedTimerPaused(timerName, paused) {
  const name = String(timerName || '').trim();
  if (!name) return;
  const key = `named:${name}`;
  const now = performance.now();
  const record = getTimerRecord(key, now, 1000);
  if (paused && !record.paused) {
    record.paused = true;
    record.pausedAt = now;
  } else if (!paused && record.paused) {
    const pausedFor = now - (record.pausedAt || now);
    record.lastFiredTime += pausedFor;
    record.paused = false;
    record.pausedAt = 0;
  }
  timerStates.set(key, record);
}

function clearNamedTimer(timerName) {
  const name = String(timerName || '').trim();
  if (name) timerStates.delete(`named:${name}`);
}

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
function makeExprInput(value, placeholder, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'expr-input-wrap';

  const row = document.createElement('div');
  row.style.cssText = 'position:relative;';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'property-input expr-input';
  input.value = String(value ?? '');
  input.placeholder = placeholder || '0   or   score + 1';

  const badge = document.createElement('span');
  badge.className = 'expr-badge';
  badge.textContent = 'fx';

  const refresh = () => {
    const isExpr = input.value.trim() !== '' && isNaN(Number(input.value.trim()));
    input.classList.toggle('has-expr', isExpr);
    badge.classList.toggle('active', isExpr);
  };
  refresh();

  input.addEventListener('input', () => { refresh(); onChange(input.value); markProjectDirty(); });

  // Suggestion panel shown on focus
  const sugg = document.createElement('div');
  sugg.className = 'expr-suggestions';

  input.addEventListener('focus', () => {
    sugg.innerHTML = '';

    // Game variables
    getKnownVariableNames().forEach(vName => {
      const p = document.createElement('button');
      p.className = 'expr-pill var-pill'; p.type = 'button'; p.textContent = vName;
      p.title = `Variable: ${vName}`;
      p.onmousedown = e => {
        e.preventDefault();
        input.value = input.value ? `${input.value} + ${vName}` : vName;
        refresh(); onChange(input.value); markProjectDirty(); input.focus();
      };
      sugg.appendChild(p);
    });

    // Object properties for each named object
    getAllObjectNames().slice(0, 4).forEach(oName => {
      ['posX','posY','velX','velY','width','height','rotation'].forEach(prop => {
        const p = document.createElement('button');
        p.className = 'expr-pill prop-pill'; p.type = 'button';
        p.textContent = `${oName}.${prop}`;
        p.onmousedown = e => {
          e.preventDefault();
          input.value = `${oName}.${prop}`; refresh(); onChange(input.value); markProjectDirty(); input.focus();
        };
        sugg.appendChild(p);
      });
    });

    // Math helpers
    ['Math.floor(x)', 'Math.ceil(x)', 'Math.abs(x)', 'Math.sqrt(x)', 'Math.max(a,b)', 'Math.min(a,b)', 'Math.PI', 'Math.random()'].forEach(m => {
      const p = document.createElement('button');
      p.className = 'expr-pill math-pill'; p.type = 'button'; p.textContent = m;
      p.onmousedown = e => {
        e.preventDefault();
        const cur = input.value.trim();
        const fn = m.match(/^Math\.\w+\(/);
        input.value = fn && cur ? `${m.replace('x', cur).replace('(x)', `(${cur})`)}` : (cur ? `${cur} * ${m}` : m);
        refresh(); onChange(input.value); markProjectDirty(); input.focus();
      };
      sugg.appendChild(p);
    });
  });

  row.appendChild(input);
  row.appendChild(badge);
  wrap.appendChild(row);
  wrap.appendChild(sugg);
  return wrap;
}

function resolveCollisions(objects, canvas) {
  const statics = objects.filter(o => isCollisionObject(o) && (o.static || !o.physicsEnabled));
  const dynamics = objects.filter(o => isCollisionObject(o) && !o.static && o.physicsEnabled);

  dynamics.forEach(obj => {
    ensurePhysics(obj);

    statics.forEach(wall => {
      if (wall === obj) return;
      const mtv = getAABBOverlap(obj, wall);
      if (!mtv) return;
      const previous = getPreviousHitbox(obj);
      const target = getHitbox(wall);
      const crossedFromTop = previous.y + previous.height <= target.y && (obj.velY || 0) >= 0;
      const crossedFromBottom = previous.y >= target.y + target.height && (obj.velY || 0) <= 0;
      const crossedFromLeft = previous.x + previous.width <= target.x && (obj.velX || 0) >= 0;
      const crossedFromRight = previous.x >= target.x + target.width && (obj.velX || 0) <= 0;
      if (crossedFromTop) {
        obj.posY += target.y - (getHitbox(obj).y + getHitbox(obj).height);
        obj.velY = 0;
      } else if (crossedFromBottom) {
        obj.posY += (target.y + target.height) - getHitbox(obj).y;
        obj.velY = 0;
      } else if (crossedFromLeft) {
        obj.posX += target.x - (getHitbox(obj).x + getHitbox(obj).width);
        obj.velX = 0;
      } else if (crossedFromRight) {
        obj.posX += (target.x + target.width) - getHitbox(obj).x;
        obj.velX = 0;
      } else {
        obj.posX += mtv.nx * mtv.depth;
        obj.posY += mtv.ny * mtv.depth;
        if (mtv.nx !== 0) obj.velX = 0;
        if (mtv.ny !== 0) obj.velY = 0;
      }
    });
  });
}

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
const spawnCounter = { value: 0 }; // unique id suffix for spawned clones

function playSound(data, cooldownKey) {
  if (cooldownKey) {
    const now = Date.now();
    if (now - (soundCooldowns.get(cooldownKey) || 0) < 100) return;
    soundCooldowns.set(cooldownKey, now);
  }
  try {
    const ctx  = getAudioCtx();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type      = data.waveform || 'square';
    osc.frequency.setValueAtTime(data.frequency || 440, ctx.currentTime);
    gain.gain.setValueAtTime(data.volume || 0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (data.duration || 0.2));
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + (data.duration || 0.2));
  } catch(e) {}
}

// ============================================================
// CANVAS / PREVIEW SETUP
// ============================================================
const canvas  = document.getElementById('game-canvas');
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

function resizeGameCanvas(sceneOverride = null) {
  const scene = sceneOverride || getPreviewScene();
  const container = document.querySelector('.fullscreen-preview');
  const viewW = getSceneViewportWidth(scene);
  const viewH = getSceneViewportHeight(scene);
  const scale = container
    ? Math.min(container.clientWidth / viewW, container.clientHeight / viewH)
    : 1;
  canvas.width  = viewW;
  canvas.height = viewH;
  canvas.style.width  = `${Math.round(viewW * scale)}px`;
  canvas.style.height = `${Math.round(viewH * scale)}px`;
  clampCameraToScene(scene);
}
window.addEventListener('resize', () => {
  if (document.getElementById('preview-tab').classList.contains('active')) resizeGameCanvas();
});

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

function drawGame() {
  const scene = getPreviewScene();
  const camera = previewState.camera || { x: 0, y: 0 };
  const shake = previewState.cameraShake?.timeLeft > 0 ? previewState.cameraShake : null;
  const shakeX = shake ? (Math.random() * 2 - 1) * shake.strength : 0;
  const shakeY = shake ? (Math.random() * 2 - 1) * shake.strength : 0;
  const cameraX = (camera.x || 0) + shakeX;
  const cameraY = (camera.y || 0) + shakeY;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Background
  const bgImg = getBgImage(scene.bgAssetId);
  if (bgImg && bgImg.complete) {
    ctx.drawImage(bgImg, -cameraX, -cameraY, scene.width || canvas.width, scene.height || canvas.height);
  } else {
    ctx.fillStyle = scene.bgColor || '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Sort by layer
  const sortedObjs = [...previewState.objects].sort((a, b) => (a.layer || 0) - (b.layer || 0));

  sortedObjs.forEach(obj => {
    if (destroyedObjects.has(obj.id)) return;
    if (hiddenObjects.has(obj.id)) return;

    if (obj.kind === 'text') {
      ctx.save();
      if (!obj.uiPinned) ctx.translate(-cameraX, -cameraY);
      const weight  = obj.bold ? 'bold ' : '';
      const style   = obj.italic ? 'italic ' : '';
      ctx.font      = `${style}${weight}${obj.fontSize || 24}px ${obj.fontFamily || 'sans-serif'}`;
      ctx.textBaseline = 'top';
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = obj.opacity ?? 1;
      ctx.fillStyle = obj.textColor || '#111827';
      const align = obj.textAlign || 'left';
      ctx.textAlign = align;
      // runtime text override from set-text action
      const displayText = obj._runtimeText !== undefined ? obj._runtimeText : (obj.text || '');
      const boxW = Math.max(1, obj.width || ctx.measureText(displayText).width || 1);
      const boxH = Math.max(1, obj.height || obj.fontSize || 24);
      const rot = obj.rotation || 0;
      const drawX = obj.posX;
      const drawY = obj.posY;
      const textX = align === 'center' ? boxW / 2 : align === 'right' ? boxW : 0;
      if (rot !== 0) {
        ctx.translate(drawX + boxW / 2, drawY + boxH / 2);
        ctx.rotate((rot * Math.PI) / 180);
        ctx.translate(-boxW / 2, -boxH / 2);
        ctx.fillText(displayText, textX, 0);
      } else {
        ctx.fillText(displayText, drawX + textX, drawY);
      }
      ctx.restore();
      return;
    }

    // Sprite / shape
    const img     = getImage(obj.assetId);
    const rot     = obj.rotation || 0;
    const cx      = obj.posX + obj.width  / 2;
    const cy      = obj.posY + obj.height / 2;
    const halfW   = obj.width  / 2;
    const halfH   = obj.height / 2;

    ctx.save();
    ctx.globalAlpha = obj.opacity ?? 1;
    ctx.translate(-cameraX, -cameraY);
    if (rot !== 0) {
      ctx.translate(cx, cy);
      ctx.rotate((rot * Math.PI) / 180);
      ctx.translate(-halfW, -halfH);
    } else {
      ctx.translate(obj.posX, obj.posY);
    }

    if (img && img.complete && img.naturalWidth > 0) {
      drawImageInObject(ctx, img, obj.width, obj.height, obj.assetFit || 'cover');
    } else {
      ctx.fillStyle = obj.color || '#888888';
      ctx.fillRect(0, 0, obj.width, obj.height);
    }
    ctx.restore();

    // Show name label if set
    if (obj.showLabel && obj.name) {
      ctx.save();
      ctx.translate(-cameraX, -cameraY);
      ctx.font = '11px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.textAlign = 'center';
      ctx.fillText(obj.name, cx, cy + 4);
      ctx.restore();
    }
  });
}

function drawImageInObject(targetCtx, img, width, height, fit = 'cover') {
  if (fit === 'stretch') {
    targetCtx.drawImage(img, 0, 0, width, height);
    return;
  }
  const imageRatio = img.naturalWidth / img.naturalHeight;
  const boxRatio = width / height;
  let drawW = width;
  let drawH = height;
  if (fit === 'contain' ? imageRatio > boxRatio : imageRatio < boxRatio) {
    drawW = width;
    drawH = width / imageRatio;
  } else {
    drawH = height;
    drawW = height * imageRatio;
  }
  targetCtx.drawImage(img, (width - drawW) / 2, (height - drawH) / 2, drawW, drawH);
}

// ============================================================
// GAME LOOP
// ============================================================
function initGame() { if (canvas.width === 0) { canvas.width = 800; canvas.height = 600; } }

function gameLoop(timestamp) {
  if (!lastTime) lastTime = timestamp;
  const dt = Math.min((timestamp - lastTime) / 16.67, 3);
  lastTime = timestamp;

  if (gameRunning) {
    previewState.dt = dt;
    previewState.frameId = (previewState.frameId || 0) + 1;
    if (previewState.cameraShake?.timeLeft > 0) {
      previewState.cameraShake.timeLeft = Math.max(0, previewState.cameraShake.timeLeft - dt * 16.67);
    }
    updateCameraFollow();
    const objs = previewState.objects.filter(o => !destroyedObjects.has(o.id));

    // Physics update — only physics-enabled, non-static objects
    objs.forEach(obj => {
      obj._prevX = obj.posX;
      obj._prevY = obj.posY;
      if (!isCollisionObject(obj) && obj.kind === 'text') return;
      if (obj.static || !obj.physicsEnabled) return;
      ensurePhysics(obj);
      const p = getPhysics(obj);
      obj.velY += p.gravity * dt;
      obj.velX *= Math.pow(p.friction, dt);
      obj.velY *= Math.pow(p.friction, dt);
      obj.velX  = clamp(obj.velX, -p.maxSpeed, p.maxSpeed);
      obj.velY  = clamp(obj.velY, -p.maxSpeed, p.maxSpeed);
      obj.posX += obj.velX * dt;
      obj.posY += obj.velY * dt;
    });

    resolveCollisions(objs, canvas);

    pendingDestroy.forEach(id => destroyedObjects.add(id));
    pendingDestroy.clear();

    // Process global script + current scene script
    resetFrameConditionContexts();
    processScriptGrid('global');
    processScriptGrid(previewState.sceneId || currentSceneId);
    keysJustPressed.clear();
    keysJustReleased.clear();
    mouseJustPressed.clear();
    mouseJustReleased.clear();
  }

  drawGame();
  rafHandle = requestAnimationFrame(gameLoop);
}

function updateCameraFollow() {
  const camera = previewState.camera;
  if (!camera?.followTarget) return;
  const alive = previewState.objects.filter(o => !destroyedObjects.has(o.id));
  const target = getObjectsByName(camera.followTarget, alive)[0];
  if (!target) return;
  camera.x = (target.posX + target.width / 2) - canvas.width / 2 + (camera.offsetX || 0);
  camera.y = (target.posY + target.height / 2) - canvas.height / 2 + (camera.offsetY || 0);
  clampCameraToScene();
}

function startGame() { gameRunning = true; }

function resetGame() {
  gameRunning    = false;
  resetGameStartState();
  lastTime       = 0;
  previewState.frameId = 0;
  resetFrameConditionContexts();
  collisionStates.clear();
  collisionTriggerTimes.clear();
  onceTriggerStates.clear();
  soundCooldowns.clear();
  cameraShakeCooldowns.clear();
  timerStates.clear();
  spawnCounter.value = 0;
  initGame();
}

function updatePreviewMouse(e) {
  const rect = canvas.getBoundingClientRect();
  previewState.mouse = {
    x: ((e.clientX - rect.left) / rect.width) * canvas.width,
    y: ((e.clientY - rect.top) / rect.height) * canvas.height
  };
}

function launchPreview() {
  stopPreviewLoop();

  // Save current grid
  commitActiveGrid();

  // Deep-clone current scene objects for preview
  const scene = getCurrentScene();
  previewState.sceneId = scene.id;
  previewState.objects = cloneData(scene.objects);
  previewState.objects.forEach(o => {
    o.velX = 0; o.velY = 0; o._alive = true; o._runtimeText = undefined;
  });
  previewState.camera = { x: 0, y: 0, followTarget: '', offsetX: 0, offsetY: 0 };
  previewState.cameraShake = { strength: 0, timeLeft: 0 };

  Object.keys(gameVariables).forEach(k => delete gameVariables[k]);
  hiddenObjects.clear();
  destroyedObjects.clear();
  pendingDestroy.clear();
  mouseButtons.clear();
  mouseJustPressed.clear();
  mouseJustReleased.clear();
  keysJustPressed.clear();
  keysJustReleased.clear();
  onceTriggerStates.clear();

  resizeGameCanvas(scene);
  resetGame();

  // Set up mouse tracking
  canvas.onmousemove = updatePreviewMouse;
  canvas.onmousedown = (e) => {
    updatePreviewMouse(e);
    if (!mouseButtons.has(e.button)) mouseJustPressed.add(e.button);
    mouseButtons.add(e.button);
  };
  canvas.onmouseup   = (e) => {
    updatePreviewMouse(e);
    if (mouseButtons.has(e.button)) mouseJustReleased.add(e.button);
    mouseButtons.delete(e.button);
  };
  canvas.oncontextmenu = e => e.preventDefault();

  startGame();
  processGameStartConditions('global');
  processGameStartConditions(scene.id);

  rafHandle = requestAnimationFrame(gameLoop);
}

document.getElementById('preview-restart-btn')?.addEventListener('click', () => {
  if (document.getElementById('preview-tab').classList.contains('active')) launchPreview();
});

// ============================================================
// SCRIPT GRID PROCESSING
// ============================================================
const collisionStates        = new Map();
const collisionTriggerTimes  = new Map();
const mouseButtons           = new Set();
const mouseJustPressed       = new Set();
const mouseJustReleased      = new Set();
const keysPressed            = new Set();
const keysJustPressed        = new Set();
const keysJustReleased       = new Set();
const onceTriggerStates      = new Set();

function normalizeKeyName(key) {
  const value = String(key ?? '').trim().replace(/^["']|["']$/g, '');
  const map = {
    Left: 'ArrowLeft',
    Right: 'ArrowRight',
    Up: 'ArrowUp',
    Down: 'ArrowDown',
    Return: 'Enter',
    Esc: 'Escape',
    Spacebar: 'Space'
  };
  return map[value] || value;
}

function keyNameAliases(key) {
  const normalized = normalizeKeyName(key);
  const aliases = new Set([normalized]);
  if (normalized.length === 1) {
    aliases.add(normalized.toLowerCase());
    aliases.add(normalized.toUpperCase());
    aliases.add(`Key${normalized.toUpperCase()}`);
  }
  if (normalized === 'Space') aliases.add(' ');
  if (normalized.startsWith('Arrow')) aliases.add(normalized.replace('Arrow', ''));
  return [...aliases].filter(Boolean);
}

function keySetHas(keySet, key) {
  return keyNameAliases(key).some(alias => keySet.has(alias));
}

function getEventKeyAliases(e) {
  const aliases = new Set([e.key, e.code]);
  if (e.key === ' ') aliases.add('Space');
  if (e.code === 'Space') aliases.add('Space');
  return [...aliases].filter(Boolean);
}
document.addEventListener('keydown', e => {
  getEventKeyAliases(e).forEach(key => {
    if (!keysPressed.has(key)) keysJustPressed.add(key);
    keysPressed.add(key);
  });
});
document.addEventListener('keyup', e => {
  getEventKeyAliases(e).forEach(key => {
    if (keysPressed.has(key)) keysJustReleased.add(key);
    keysPressed.delete(key);
  });
});

function getConditionContextKey(scope, idx) {
  return `${getScopeKey(scope)}:${idx}`;
}

function setConditionContext(scope, idx, context) {
  previewState.conditionContexts[getConditionContextKey(scope, idx)] = context;
  previewState.executionContext = context;
}

function getConditionContext(scope, idx) {
  return previewState.conditionContexts?.[getConditionContextKey(scope, idx)];
}

function markConditionTriggered(scope, idx) {
  if (sameScriptScope(scope, activeScriptScope)) {
    cells[idx]?.classList.add('triggered');
  }
}

function resetFrameConditionContexts() {
  previewState.conditionContexts = {};
  previewState.executionContext = null;
}

function resetGameStartState() {
  gameStartFired = false;
  gameStartFiredScopes.clear();
}

function getGridCellsForScope(scope) {
  // Build a virtual lookup using stored grid data for the scope
  return getGridDataForScope(scope);
}

function processScriptGrid(scope) {
  previewState.conditionContexts = previewState.conditionContexts || {};
  const gd = getGridDataForScope(scope);
  if (sameScriptScope(scope, activeScriptScope)) {
    const scopeCells = cells.filter(c => {
      const idx = parseInt(c.dataset.index);
      return gd[idx] !== undefined;
    });
    scopeCells.forEach(c => c.classList.remove('triggered'));
  }
  processDeterministicConditions(scope, false);
  processDeterministicConditions(scope, true);
  const scopeKey = getScopeKey(scope);
  if (!gameStartFiredScopes.has(scopeKey)) gameStartFiredScopes.add(scopeKey);
  gameStartFired = true;
}

const DEFERRED_CONDITION_TYPES = new Set(['and', 'triggerOnce']);

function isConditionRuntimeType(type) {
  return [
    'gameStart','always','keyPressed','keyJustPressed','mouseClick',
    'mouseOverObject','objectClicked','getVariable','collision','onFloor',
    'overlapTouch','distanceCheck','positionCheck','velocityCheck','objectVisible',
    'objectCount','chance','onTimer','onEdge','and','triggerOnce',
    ...getCatalogRuntimeTypes('condition')
  ].includes(type);
}

function processDeterministicConditions(scope, deferredPass) {
  const gd = getScopeGridData(scope);
  Object.entries(gd)
    .map(([idxStr, data]) => [Number(idxStr), data])
    .sort(([a], [b]) => a - b)
    .forEach(([idx, data]) => {
      if (!data || !isConditionRuntimeType(data.type)) return;
      const isDeferred = DEFERRED_CONDITION_TYPES.has(data.type);
      if (Boolean(deferredPass) !== isDeferred) return;
      const result = evaluateCondition(data, idx, scope);
      if (!result?.triggered) return;
      markConditionTriggered(scope, idx);
      setConditionContext(scope, idx, result.context || {});
      applyAdjacentActionsFromScope(idx, scope);
    });
}

function evaluateCondition(data, idx, scope) {
  switch (data.type) {
    case 'gameStart': {
      const alreadyFired = gameStartFiredScopes.has(getScopeKey(scope));
      const pass = data.reversed ? alreadyFired : !alreadyFired;
      return pass ? { triggered: true, context: { gameStart: true } } : { triggered: false };
    }
    case 'always':
      return { triggered: true, context: { always: true } };
    case 'keyJustPressed': {
      const pressed = keySetHas(keysJustPressed, data.key);
      return conditionResult(data.reversed ? !pressed : pressed, { key: data.key, justPressed: true });
    }
    case 'keyPressed':
      return evaluateKeyboardCondition(data);
    case 'mouseClick':
      return evaluateMouseCondition(data);
    case 'mouseOverObject':
      return evaluateMouseOverObjectCondition(data);
    case 'objectClicked':
      return evaluateObjectClickedCondition(data);
    case 'getVariable': {
      const val = gameVariables[data.varName] ?? 0;
      const cv = evalExpr(data.compareValue ?? 0);
      return conditionResult(data.reversed ? !compareValues(val, data.operator, cv) : compareValues(val, data.operator, cv), { variable: data.varName, value: val });
    }
    case 'collision':
      return evaluateCollisionCondition(data);
    case 'onFloor':
      return evaluateOnFloorCondition(data);
    case 'overlapTouch':
      return evaluateOverlapCondition(data);
    case 'distanceCheck':
      return evaluateDistanceCondition(data);
    case 'positionCheck':
      return evaluatePositionCondition(data);
    case 'velocityCheck':
      return evaluateVelocityCondition(data);
    case 'objectVisible':
      return evaluateObjectVisibleCondition(data);
    case 'objectCount':
      return evaluateObjectCountCondition(data);
    case 'chance': {
      const percent = clamp(evalExpr(data.percent ?? 0), 0, 100);
      return conditionResult(data.reversed ? !(Math.random() * 100 < percent) : (Math.random() * 100 < percent), { chance: percent });
    }
    case 'onTimer':
      return evaluateTimerCondition(data, idx, scope);
    case 'onEdge':
      return evaluateEdgeCondition(data);
    case 'triggerOnce':
      return evaluateTriggerOnceCondition(data, idx, scope);
    case 'and':
      return evaluateAndCondition(data, idx, scope);
    default:
      return { triggered: false };
  }
}

function conditionResult(triggered, context = {}) {
  return triggered ? { triggered: true, context } : { triggered: false };
}

function evaluateKeyboardCondition(data) {
  const inputCondition = data.inputCondition || (
    data.trigger === 'pressed' ? 'keyJustPressed' :
    data.trigger === 'released' ? 'keyReleased' :
    'keyPressed'
  );
  let pass = false;
  if (inputCondition === 'anyKeyPressed') pass = keysPressed.size > 0;
  else if (inputCondition === 'anyKeyJustPressed') pass = keysJustPressed.size > 0;
  else if (inputCondition === 'anyKeyReleased') pass = keysJustReleased.size > 0;
  else if (inputCondition === 'keyJustPressed') pass = keySetHas(keysJustPressed, data.key);
  else if (inputCondition === 'keyReleased') pass = keySetHas(keysJustReleased, data.key);
  else pass = keySetHas(keysPressed, data.key);
  return conditionResult(data.reversed ? !pass : pass, { key: data.key, inputCondition });
}

function evaluateMouseCondition(data) {
  const state = data.mouseCondition || 'mouseButtonPressed';
  const source = state === 'mouseButtonJustPressed'
    ? mouseJustPressed
    : state === 'mouseButtonReleased'
      ? mouseJustReleased
      : mouseButtons;
  let isPressed = false;
  if (data.button === 'left') isPressed = source.has(0);
  else if (data.button === 'right') isPressed = source.has(2);
  else if (data.button === 'any') isPressed = source.size > 0;
  return conditionResult(data.reversed ? !isPressed : isPressed, { mouse: true, mouseCondition: state });
}

function evaluateMouseOverObjectCondition(data) {
  const targets = getObjectsByName(data.targetObject, getAlivePreviewObjects());
  let hovered = false;
  let hoveredObject = null;
  for (const obj of targets) {
    if (pointInsideObject(getMousePointForObject(obj), obj)) {
      hovered = true;
      hoveredObject = obj;
      break;
    }
  }
  return conditionResult(data.reversed ? !hovered : hovered, { mouseOver: hovered, obj1: hoveredObject, targetObject: data.targetObject });
}

function evaluateObjectClickedCondition(data) {
  const targets = getObjectsByName(data.targetObject, getAlivePreviewObjects());
  const button = data.button === 'right' ? 2 : data.button === 'middle' ? 1 : 0;
  const justClicked = mouseJustPressed.has(button);
  let clicked = false;
  let clickedObject = null;
  if (justClicked) {
    for (const obj of targets) {
      if (pointInsideObject(getMousePointForObject(obj), obj)) {
        clicked = true;
        clickedObject = obj;
        break;
      }
    }
  }
  return conditionResult(data.reversed ? !clicked : clicked, { objectClicked: clicked, obj1: clickedObject, targetObject: data.targetObject });
}

function evaluateCollisionCondition(data) {
  const alive = getAlivePreviewObjects();
  const objs1 = getCollisionObjectsByName(data.object1, alive);
  const objs2 = getCollisionObjectsByName(data.object2, alive);
  let colliding = false;
  let colObj1 = null;
  let colObj2 = null;
  let contact = null;
  const countTouchingEdges = data.countTouchingEdges !== false;
  const tolerance = countTouchingEdges ? 3 : 0;
  for (const a of objs1) {
    for (const b of objs2) {
      const nextContact = countTouchingEdges
        ? getAABBContact(a, b, tolerance)
        : (aabbOverlaps(a, b) ? { touching: true, overlap: true, side: null } : null);
      if (nextContact) {
        colliding = true;
        colObj1 = a;
        colObj2 = b;
        contact = nextContact;
        break;
      }
    }
    if (colliding) break;
  }
  return conditionResult(data.reversed ? !colliding : colliding, { colliding, obj1: colObj1, obj2: colObj2, side: contact?.side || null, object1Name: data.object1, object2Name: data.object2 });
}

function evaluateOnFloorCondition(data) {
  const alive = getAlivePreviewObjects();
  const targets = getCollisionObjectsByName(data.targetObject, alive);
  const platforms = getCollisionObjectsByName(data.platformObject, alive);
  let onFloor = false;
  let floorTarget = null;
  let floorObject = null;
  const tolerance = data.countTouchingEdges === false ? 0 : 4;
  for (const obj of targets) {
    for (const platform of platforms) {
      const contact = getAABBContact(obj, platform, tolerance);
      if (contact?.side === 'bottom') {
        onFloor = true;
        floorTarget = obj;
        floorObject = platform;
        break;
      }
    }
    if (onFloor) break;
  }
  return conditionResult(data.reversed ? !onFloor : onFloor, { onFloor, obj1: floorTarget, obj2: floorObject, targetObject: data.targetObject, platformObject: data.platformObject });
}

function evaluateOverlapCondition(data) {
  const alive = getAlivePreviewObjects();
  const objs1 = getCollisionObjectsByName(data.object1, alive);
  const objs2 = getCollisionObjectsByName(data.object2, alive);
  const tol = data.tolerance ?? 4;
  let touching = false;
  let colObj1 = null;
  let colObj2 = null;
  for (const a of objs1) {
    for (const b of objs2) {
      if (a.id !== b.id && aabbOverlapsTolerance(a, b, tol)) {
        touching = true;
        colObj1 = a;
        colObj2 = b;
        break;
      }
    }
    if (touching) break;
  }
  return conditionResult(data.reversed ? !touching : touching, { touching, obj1: colObj1, obj2: colObj2, object1Name: data.object1, object2Name: data.object2 });
}

function evaluateDistanceCondition(data) {
  const alive = getAlivePreviewObjects();
  const objs1 = getObjectsByName(data.object1, alive);
  const objs2 = getObjectsByName(data.object2, alive);
  const threshold = evalExpr(data.distance ?? 0);
  let pass = false;
  let distance = Infinity;
  let distObj1 = null;
  let distObj2 = null;
  for (const a of objs1) {
    for (const b of objs2) {
      if (a.id === b.id) continue;
      const nextDistance = objectCentersDistance(a, b);
      if (nextDistance < distance) distance = nextDistance;
      if (compareValues(nextDistance, data.operator || '<=', threshold)) {
        pass = true;
        distObj1 = a;
        distObj2 = b;
      }
    }
    if (pass) break;
  }
  return conditionResult(data.reversed ? !pass : pass, { distance, obj1: distObj1, obj2: distObj2, object1Name: data.object1, object2Name: data.object2 });
}

function evaluatePositionCondition(data) {
  const targets = getObjectsByName(data.targetObject, getAlivePreviewObjects());
  const compareValue = evalExpr(data.value ?? 0);
  let pass = false;
  let matched = null;
  targets.forEach(obj => {
    const value = obj[data.property || 'posY'] ?? 0;
    if (compareValues(value, data.operator || '>=', compareValue)) {
      pass = true;
      if (!matched) matched = obj;
    }
  });
  return conditionResult(data.reversed ? !pass : pass, { obj1: matched, targetObject: data.targetObject });
}

function evaluateVelocityCondition(data) {
  const targets = getObjectsByName(data.targetObject, getAlivePreviewObjects());
  const compareValue = evalExpr(data.value ?? 0);
  let pass = false;
  let checkedValue = 0;
  let matched = null;
  targets.forEach(obj => {
    const vx = obj.velX || 0;
    const vy = obj.velY || 0;
    if (data.component === 'x') checkedValue = vx;
    else if (data.component === 'y') checkedValue = vy;
    else checkedValue = Math.hypot(vx, vy);
    if (compareValues(checkedValue, data.operator || '>=', compareValue)) {
      pass = true;
      if (!matched) matched = obj;
    }
  });
  return conditionResult(data.reversed ? !pass : pass, { obj1: matched, targetObject: data.targetObject, value: checkedValue });
}

function evaluateObjectVisibleCondition(data) {
  const targets = getObjectsByName(data.targetObject, getAlivePreviewObjects());
  let visibleObj = null;
  const visible = targets.some(obj => {
    if (!hiddenObjects.has(obj.id)) {
      visibleObj = obj;
      return true;
    }
    return false;
  });
  return conditionResult(data.reversed ? !visible : visible, { obj1: visibleObj, targetObject: data.targetObject, visible });
}

function evaluateObjectCountCondition(data) {
  const alive = getAlivePreviewObjects();
  const count = getObjectsByName(data.targetObject, alive).length;
  const pass = compareValues(count, data.operator || '==', evalExpr(data.count ?? 0));
  return conditionResult(data.reversed ? !pass : pass, { count, targetObject: data.targetObject });
}

function evaluateTimerCondition(data, idx, scope) {
  const now = performance.now();
  const key = getTimerKey(scope, idx, data);
  const interval = Math.max(0.001, evalExpr(data.interval ?? 1.0)) * 1000;
  const record = getTimerRecord(key, now, interval);
  const elapsed = record.paused ? (record.pausedAt || now) - record.lastFiredTime : now - record.lastFiredTime;
  let fired = record.firedFrame === previewState.frameId;
  if (!record.paused && elapsed >= interval) {
    fired = true;
    record.lastFiredTime = now;
    record.firedFrame = previewState.frameId;
    timerStates.set(key, record);
  }
  return conditionResult(data.reversed ? !fired : fired, { timer: true, timerName: data.timerName || '', elapsed: elapsed / 1000 });
}

function evaluateEdgeCondition(data) {
  const scene = getPreviewScene();
  const boundsW = getSceneWorldWidth(scene);
  const boundsH = getSceneWorldHeight(scene);
  const targets = getObjectsByName(data.targetObject, getAlivePreviewObjects());
  let atEdge = false;
  targets.forEach(obj => {
    const box = getHitbox(obj);
    const edge = data.edge || 'any';
    if (edge === 'left' || edge === 'any') atEdge = atEdge || box.x <= 0;
    if (edge === 'right' || edge === 'any') atEdge = atEdge || (box.x + box.width >= boundsW);
    if (edge === 'top' || edge === 'any') atEdge = atEdge || box.y <= 0;
    if (edge === 'bottom' || edge === 'any') atEdge = atEdge || (box.y + box.height >= boundsH);
  });
  return conditionResult(data.reversed ? !atEdge : atEdge, { edge: true });
}

function evaluateTriggerOnceCondition(data, idx, scope) {
  const onceKey = getConditionContextKey(scope, idx);
  const hasFired = onceTriggerStates.has(onceKey);
  const adjacentContexts = getAdjacentIndexes(idx)
    .map(adjIdx => getConditionContext(scope, adjIdx))
    .filter(Boolean);
  const hasConditionGate = adjacentContexts.length > 0;
  const canFire = hasConditionGate ? adjacentContexts.some(Boolean) : true;
  const pass = data.reversed ? hasFired : (!hasFired && canFire);
  if (pass && !data.reversed) onceTriggerStates.add(onceKey);
  return conditionResult(pass, Object.assign({ once: true, gated: hasConditionGate }, ...adjacentContexts));
}

function evaluateAndCondition(data, idx, scope) {
  const adjacent = getAdjacentIndexes(idx);
  const conditionCells = adjacent.filter(adjIdx => getConditionContext(scope, adjIdx));
  const logic = data.logic || 'and';
  let pass = false;
  if (logic === 'and') pass = conditionCells.length >= 2;
  else if (logic === 'or') pass = conditionCells.length >= 1;
  const merged = Object.assign({ andGroup: true }, ...conditionCells.map(adjIdx => getConditionContext(scope, adjIdx)));
  return conditionResult(pass, merged);
}

function getScopeGridData(scope) {
  return getGridDataForScope(scope);
}

function processGameStartConditions(scope) {
  const gd = getScopeGridData(scope);
  const scopeKey = getScopeKey(scope);
  const alreadyFired = gameStartFiredScopes.has(scopeKey);
  Object.entries(gd).forEach(([idxStr, data]) => {
    if (data.type !== 'gameStart') return;
    const idx  = parseInt(idxStr);
    const fired = data.reversed ? alreadyFired : !alreadyFired;
    if (fired) {
      markConditionTriggered(scope, idx);
      const execCtx = { gameStart: true };
      setConditionContext(scope, idx, execCtx);
      applyAdjacentActionsFromScope(idx, scope);
    }
  });
  gameStartFiredScopes.add(scopeKey);
  gameStartFired = true;
}

function processKeyPressConditions(scope) {
  const gd = getScopeGridData(scope);
  Object.entries(gd).forEach(([idxStr, data]) => {
    if (data.type !== 'keyPressed') return;
    const idx  = parseInt(idxStr);
    const inputCondition = data.inputCondition || (
      data.trigger === 'pressed' ? 'keyJustPressed' :
      data.trigger === 'released' ? 'keyReleased' :
      'keyPressed'
    );
    let pass = false;
    if (inputCondition === 'anyKeyPressed') pass = keysPressed.size > 0;
    else if (inputCondition === 'anyKeyJustPressed') pass = keysJustPressed.size > 0;
    else if (inputCondition === 'anyKeyReleased') pass = keysJustReleased.size > 0;
    else if (inputCondition === 'keyJustPressed') pass = keySetHas(keysJustPressed, data.key);
    else if (inputCondition === 'keyReleased') pass = keySetHas(keysJustReleased, data.key);
    else pass = keySetHas(keysPressed, data.key);
    const triggered = data.reversed ? !pass : pass;
    if (triggered) {
      markConditionTriggered(scope, idx);
      setConditionContext(scope, idx, { key: data.key, inputCondition });
      applyAdjacentActionsFromScope(idx, scope);
    }
  });
}

function processMouseConditions(scope) {
  const gd = getScopeGridData(scope);
  Object.entries(gd).forEach(([idxStr, data]) => {
    if (data.type !== 'mouseClick') return;
    const idx  = parseInt(idxStr);
    const state = data.mouseCondition || 'mouseButtonPressed';
    const source = state === 'mouseButtonJustPressed'
      ? mouseJustPressed
      : state === 'mouseButtonReleased'
        ? mouseJustReleased
        : mouseButtons;
    let isPressed = false;
    if (data.button === 'left')  isPressed = source.has(0);
    else if (data.button === 'right') isPressed = source.has(2);
    else if (data.button === 'any')   isPressed = source.size > 0;
    const triggered = data.reversed ? !isPressed : isPressed;
    if (triggered) {
      markConditionTriggered(scope, idx);
      setConditionContext(scope, idx, { mouse: true, mouseCondition: state });
      applyAdjacentActionsFromScope(idx, scope);
    }
  });
}

function getMousePointForObject(obj) {
  if (obj?.uiPinned) return previewState.mouse || { x: 0, y: 0 };
  const camera = previewState.camera || { x: 0, y: 0 };
  return {
    x: (previewState.mouse?.x || 0) + (camera.x || 0),
    y: (previewState.mouse?.y || 0) + (camera.y || 0)
  };
}

function pointInsideObject(point, obj) {
  const box = getHitbox(obj);
  return point.x >= box.x && point.x <= box.x + box.width &&
         point.y >= box.y && point.y <= box.y + box.height;
}

function processMouseOverObjectConditions(scope) {
  const gd = getScopeGridData(scope);
  Object.entries(gd).forEach(([idxStr, data]) => {
    if (data.type !== 'mouseOverObject') return;
    const idx = parseInt(idxStr);
    const targets = getObjectsByName(data.targetObject, getAlivePreviewObjects());
    let hovered = false;
    let hoveredObject = null;
    for (const obj of targets) {
      if (pointInsideObject(getMousePointForObject(obj), obj)) {
        hovered = true;
        hoveredObject = obj;
        break;
      }
    }
    const triggered = data.reversed ? !hovered : hovered;
    if (triggered) {
      markConditionTriggered(scope, idx);
      setConditionContext(scope, idx, { mouseOver: hovered, obj1: hoveredObject, targetObject: data.targetObject });
      applyAdjacentActionsFromScope(idx, scope);
    }
  });
}

function processObjectClickedConditions(scope) {
  const gd = getScopeGridData(scope);
  Object.entries(gd).forEach(([idxStr, data]) => {
    if (data.type !== 'objectClicked') return;
    const idx = parseInt(idxStr);
    const targets = getObjectsByName(data.targetObject, getAlivePreviewObjects());
    const button = data.button === 'right' ? 2 : data.button === 'middle' ? 1 : 0;
    const justClicked = mouseJustPressed.has(button);
    let clicked = false;
    let clickedObject = null;
    if (justClicked) {
      for (const obj of targets) {
        if (pointInsideObject(getMousePointForObject(obj), obj)) {
          clicked = true;
          clickedObject = obj;
          break;
        }
      }
    }
    const triggered = data.reversed ? !clicked : clicked;
    if (triggered) {
      markConditionTriggered(scope, idx);
      setConditionContext(scope, idx, { objectClicked: clicked, obj1: clickedObject, targetObject: data.targetObject });
      applyAdjacentActionsFromScope(idx, scope);
    }
  });
}

function processAlwaysConditions(scope) {
  const gd = getScopeGridData(scope);
  Object.entries(gd).forEach(([idxStr, data]) => {
    if (data.type !== 'always') return;
    const idx = parseInt(idxStr);
    markConditionTriggered(scope, idx);
    setConditionContext(scope, idx, { always: true });
    applyAdjacentActionsFromScope(idx, scope);
  });
}

function processKeyJustPressedConditions(scope) {
  const gd = getScopeGridData(scope);
  Object.entries(gd).forEach(([idxStr, data]) => {
    if (data.type !== 'keyJustPressed') return;
    const idx = parseInt(idxStr);
    const pressed = keySetHas(keysJustPressed, data.key);
    const triggered = data.reversed ? !pressed : pressed;
    if (triggered) {
      markConditionTriggered(scope, idx);
      setConditionContext(scope, idx, { key: data.key, justPressed: true });
      applyAdjacentActionsFromScope(idx, scope);
    }
  });
}

function processTriggerOnceConditions(scope) {
  const gd = getScopeGridData(scope);
  Object.entries(gd).forEach(([idxStr, data]) => {
    if (data.type !== 'triggerOnce') return;
    const idx = parseInt(idxStr);
    const onceKey = getConditionContextKey(scope, idx);
    const hasFired = onceTriggerStates.has(onceKey);
    const adjacentContexts = getAdjacentIndexes(idx)
      .map(adjIdx => getConditionContext(scope, adjIdx))
      .filter(Boolean);
    const hasConditionGate = adjacentContexts.length > 0;
    const canFire = hasConditionGate ? adjacentContexts.some(Boolean) : true;
    const pass = data.reversed ? hasFired : (!hasFired && canFire);
    if (pass) {
      if (!data.reversed) onceTriggerStates.add(onceKey);
      markConditionTriggered(scope, idx);
      setConditionContext(scope, idx, Object.assign({ once: true, gated: hasConditionGate }, ...adjacentContexts));
      applyAdjacentActionsFromScope(idx, scope);
    }
  });
}

function processVariableConditions(scope) {
  const gd = getScopeGridData(scope);
  Object.entries(gd).forEach(([idxStr, data]) => {
    if (data.type !== 'getVariable') return;
    const idx  = parseInt(idxStr);
    const val  = gameVariables[data.varName] ?? 0;
    const cv   = evalExpr(data.compareValue ?? 0);
    const pass = compareValues(val, data.operator, cv);
    const triggered = data.reversed ? !pass : pass;
    if (triggered) {
      markConditionTriggered(scope, idx);
      setConditionContext(scope, idx, { variable: data.varName, value: val });
      applyAdjacentActionsFromScope(idx, scope);
    }
  });
}

function processCollisionConditions(scope) {
  const gd = getScopeGridData(scope);
  Object.entries(gd).forEach(([idxStr, data]) => {
    if (data.type !== 'collision') return;
    const idx   = parseInt(idxStr);
    const alive = getAlivePreviewObjects();
    const objs1 = getCollisionObjectsByName(data.object1, alive);
    const objs2 = getCollisionObjectsByName(data.object2, alive);

    let colliding = false;
    let colObj1 = null, colObj2 = null, contact = null;
    const countTouchingEdges = data.countTouchingEdges !== false;
    const tolerance = countTouchingEdges ? 3 : 0;
    for (const a of objs1) {
      for (const b of objs2) {
        const nextContact = countTouchingEdges
          ? getAABBContact(a, b, tolerance)
          : (aabbOverlaps(a, b) ? { touching: true, overlap: true, side: null } : null);
        if (nextContact) {
          colliding = true; colObj1 = a; colObj2 = b; contact = nextContact; break;
        }
      }
      if (colliding) break;
    }
    const triggered = data.reversed ? !colliding : colliding;
    if (triggered) {
      markConditionTriggered(scope, idx);
      const execCtx = { colliding, obj1: colObj1, obj2: colObj2, side: contact?.side || null, object1Name: data.object1, object2Name: data.object2 };
      setConditionContext(scope, idx, execCtx);
      applyAdjacentActionsFromScope(idx, scope);
    }
  });
}

function processOnFloorConditions(scope) {
  const gd = getScopeGridData(scope);
  Object.entries(gd).forEach(([idxStr, data]) => {
    if (data.type !== 'onFloor') return;
    const idx = parseInt(idxStr);
    const alive = getAlivePreviewObjects();
    const targets = getCollisionObjectsByName(data.targetObject, alive);
    const platforms = getCollisionObjectsByName(data.platformObject, alive);
    let onFloor = false;
    let floorTarget = null;
    let floorObject = null;
    const tolerance = data.countTouchingEdges === false ? 0 : 4;
    for (const obj of targets) {
      for (const platform of platforms) {
        const contact = getAABBContact(obj, platform, tolerance);
        if (contact?.side === 'bottom') {
          onFloor = true;
          floorTarget = obj;
          floorObject = platform;
          break;
        }
      }
      if (onFloor) break;
    }
    const triggered = data.reversed ? !onFloor : onFloor;
    if (triggered) {
      markConditionTriggered(scope, idx);
      setConditionContext(scope, idx, { onFloor, obj1: floorTarget, obj2: floorObject, targetObject: data.targetObject, platformObject: data.platformObject });
      applyAdjacentActionsFromScope(idx, scope);
    }
  });
}

function aabbOverlapsTolerance(a, b, tol) {
  const ab = getHitbox(a);
  const bb = getHitbox(b);
  return ab.x - tol < bb.x + bb.width  &&
         ab.x + ab.width  + tol > bb.x &&
         ab.y - tol < bb.y + bb.height &&
         ab.y + ab.height + tol > bb.y;
}

function processOverlapConditions(scope) {
  const gd = getScopeGridData(scope);
  Object.entries(gd).forEach(([idxStr, data]) => {
    if (data.type !== 'overlapTouch') return;
    const idx   = parseInt(idxStr);
    const tol   = data.tolerance ?? 4;
    const alive = getAlivePreviewObjects();
    const objs1 = getCollisionObjectsByName(data.object1, alive);
    const objs2 = getCollisionObjectsByName(data.object2, alive);
    let touching = false;
    let colObj1 = null, colObj2 = null;
    for (const a of objs1) {
      for (const b of objs2) {
        if (a.id !== b.id && aabbOverlapsTolerance(a, b, tol)) {
          touching = true; colObj1 = a; colObj2 = b; break;
        }
      }
      if (touching) break;
    }
    const triggered = data.reversed ? !touching : touching;
    if (triggered) {
      markConditionTriggered(scope, idx);
      const execCtx = { touching, obj1: colObj1, obj2: colObj2, object1Name: data.object1, object2Name: data.object2 };
      setConditionContext(scope, idx, execCtx);
      applyAdjacentActionsFromScope(idx, scope);
    }
  });
}

function processDistanceConditions(scope) {
  const gd = getScopeGridData(scope);
  Object.entries(gd).forEach(([idxStr, data]) => {
    if (data.type !== 'distanceCheck') return;
    const idx = parseInt(idxStr);
    const alive = previewState.objects.filter(o => !destroyedObjects.has(o.id));
    const objs1 = getObjectsByName(data.object1, alive);
    const objs2 = getObjectsByName(data.object2, alive);
    const threshold = evalExpr(data.distance ?? 0);
    let pass = false;
    let distance = Infinity;
    let distObj1 = null, distObj2 = null;
    for (const a of objs1) {
      for (const b of objs2) {
        if (a.id === b.id) continue;
        const nextDistance = objectCentersDistance(a, b);
        if (nextDistance < distance) distance = nextDistance;
        if (compareValues(nextDistance, data.operator || '<=', threshold)) {
          pass = true;
          distObj1 = a;
          distObj2 = b;
        }
      }
      if (pass) break;
    }
    const triggered = data.reversed ? !pass : pass;
    if (triggered) {
      markConditionTriggered(scope, idx);
      setConditionContext(scope, idx, { distance, obj1: distObj1, obj2: distObj2, object1Name: data.object1, object2Name: data.object2 });
      applyAdjacentActionsFromScope(idx, scope);
    }
  });
}

function processPositionConditions(scope) {
  const gd = getScopeGridData(scope);
  Object.entries(gd).forEach(([idxStr, data]) => {
    if (data.type !== 'positionCheck') return;
    const idx = parseInt(idxStr);
    const alive = previewState.objects.filter(o => !destroyedObjects.has(o.id));
    const targets = getObjectsByName(data.targetObject, alive);
    const compareValue = evalExpr(data.value ?? 0);
    let pass = false;
    let matched = null;
    targets.forEach(obj => {
      const value = obj[data.property || 'posY'] ?? 0;
      if (compareValues(value, data.operator || '>=', compareValue)) {
        pass = true;
        if (!matched) matched = obj;
      }
    });
    const triggered = data.reversed ? !pass : pass;
    if (triggered) {
      markConditionTriggered(scope, idx);
      setConditionContext(scope, idx, { obj1: matched, targetObject: data.targetObject });
      applyAdjacentActionsFromScope(idx, scope);
    }
  });
}

function processVelocityConditions(scope) {
  const gd = getScopeGridData(scope);
  Object.entries(gd).forEach(([idxStr, data]) => {
    if (data.type !== 'velocityCheck') return;
    const idx = parseInt(idxStr);
    const alive = getAlivePreviewObjects();
    const targets = getObjectsByName(data.targetObject, alive);
    const compareValue = evalExpr(data.value ?? 0);
    let pass = false;
    let checkedValue = 0;
    let matched = null;
    targets.forEach(obj => {
      const vx = obj.velX || 0;
      const vy = obj.velY || 0;
      if (data.component === 'x') checkedValue = vx;
      else if (data.component === 'y') checkedValue = vy;
      else checkedValue = Math.hypot(vx, vy);
      if (compareValues(checkedValue, data.operator || '>=', compareValue)) {
        pass = true;
        if (!matched) matched = obj;
      }
    });
    const triggered = data.reversed ? !pass : pass;
    if (triggered) {
      markConditionTriggered(scope, idx);
      setConditionContext(scope, idx, { obj1: matched, targetObject: data.targetObject, value: checkedValue });
      applyAdjacentActionsFromScope(idx, scope);
    }
  });
}

function processObjectVisibleConditions(scope) {
  const gd = getScopeGridData(scope);
  Object.entries(gd).forEach(([idxStr, data]) => {
    if (data.type !== 'objectVisible') return;
    const idx = parseInt(idxStr);
    const targets = getObjectsByName(data.targetObject, getAlivePreviewObjects());
    let visibleObj = null;
    const visible = targets.some(obj => {
      if (!hiddenObjects.has(obj.id)) {
        visibleObj = obj;
        return true;
      }
      return false;
    });
    const triggered = data.reversed ? !visible : visible;
    if (triggered) {
      markConditionTriggered(scope, idx);
      setConditionContext(scope, idx, { obj1: visibleObj, targetObject: data.targetObject, visible });
      applyAdjacentActionsFromScope(idx, scope);
    }
  });
}

function processObjectCountConditions(scope) {
  const gd = getScopeGridData(scope);
  Object.entries(gd).forEach(([idxStr, data]) => {
    if (data.type !== 'objectCount') return;
    const idx = parseInt(idxStr);
    const alive = previewState.objects.filter(o => !destroyedObjects.has(o.id));
    const count = getObjectsByName(data.targetObject, alive).length;
    const pass = compareValues(count, data.operator || '==', evalExpr(data.count ?? 0));
    const triggered = data.reversed ? !pass : pass;
    if (triggered) {
      markConditionTriggered(scope, idx);
      setConditionContext(scope, idx, { count, targetObject: data.targetObject });
      applyAdjacentActionsFromScope(idx, scope);
    }
  });
}

function processChanceConditions(scope) {
  const gd = getScopeGridData(scope);
  Object.entries(gd).forEach(([idxStr, data]) => {
    if (data.type !== 'chance') return;
    const idx = parseInt(idxStr);
    const percent = clamp(evalExpr(data.percent ?? 0), 0, 100);
    const pass = Math.random() * 100 < percent;
    const triggered = data.reversed ? !pass : pass;
    if (triggered) {
      markConditionTriggered(scope, idx);
      setConditionContext(scope, idx, { chance: percent });
      applyAdjacentActionsFromScope(idx, scope);
    }
  });
}

function processAndConditions(scope) {
  const gd = getScopeGridData(scope);
  Object.entries(gd).forEach(([idxStr, data]) => {
    if (data.type !== 'and') return;
    const idx  = parseInt(idxStr);
    const adjacent = getAdjacentIndexes(idx);
    const conditionCells = adjacent.filter(adjIdx => getConditionContext(scope, adjIdx));
    let pass = false;
    const logic = data.logic || 'and';
    if (logic === 'and') pass = conditionCells.length >= 2;
    else if (logic === 'or') pass = conditionCells.length >= 1;
    if (pass) {
      markConditionTriggered(scope, idx);
      const merged = Object.assign({ andGroup: true }, ...conditionCells.map(adjIdx => getConditionContext(scope, adjIdx)));
      setConditionContext(scope, idx, merged);
      applyAdjacentActionsFromScope(idx, scope);
    }
  });
}

function processTimerConditions(scope) {
  const gd  = getScopeGridData(scope);
  const now = performance.now();
  Object.entries(gd).forEach(([idxStr, data]) => {
    if (data.type !== 'onTimer') return;
    const idx       = parseInt(idxStr);
    const key       = getTimerKey(scope, idx, data);
    const interval  = Math.max(0.001, evalExpr(data.interval ?? 1.0)) * 1000; // ms
    const record    = getTimerRecord(key, now, interval);
    const elapsed   = record.paused ? (record.pausedAt || now) - record.lastFiredTime : now - record.lastFiredTime;
    let fired       = record.firedFrame === previewState.frameId;
    if (!record.paused && elapsed >= interval) {
      fired = true;
      record.lastFiredTime = now;
      record.firedFrame = previewState.frameId;
      timerStates.set(key, record);
    }
    const triggered = data.reversed ? !fired : fired;
    if (triggered) {
      markConditionTriggered(scope, idx);
      setConditionContext(scope, idx, { timer: true, timerName: data.timerName || '', elapsed: elapsed / 1000 });
      applyAdjacentActionsFromScope(idx, scope);
    }
  });
}

function processEdgeConditions(scope) {
  const gd = getScopeGridData(scope);
  const scene = getPreviewScene();
  const boundsW = getSceneWorldWidth(scene);
  const boundsH = getSceneWorldHeight(scene);
  Object.entries(gd).forEach(([idxStr, data]) => {
    if (data.type !== 'onEdge') return;
    const idx   = parseInt(idxStr);
    const alive = previewState.objects.filter(o => !destroyedObjects.has(o.id));
    const targets = getObjectsByName(data.targetObject, alive);
    let atEdge = false;
    targets.forEach(obj => {
      const box = getHitbox(obj);
      const edge = data.edge || 'any';
      if (edge === 'left'   || edge === 'any') atEdge = atEdge || box.x <= 0;
      if (edge === 'right'  || edge === 'any') atEdge = atEdge || (box.x + box.width  >= boundsW);
      if (edge === 'top'    || edge === 'any') atEdge = atEdge || box.y <= 0;
      if (edge === 'bottom' || edge === 'any') atEdge = atEdge || (box.y + box.height >= boundsH);
    });
    const triggered = data.reversed ? !atEdge : atEdge;
    if (triggered) {
      markConditionTriggered(scope, idx);
      setConditionContext(scope, idx, { edge: true });
      applyAdjacentActionsFromScope(idx, scope);
    }
  });
}

function isActionRuntimeType(type) {
  return ['applyForce','teleport','setVariable','destroyObject','showHide','playSound','switchScene','setText','setCamera','followCamera','setSize','setVelocity','spawnObject','rotateObject','randomVariable','forceToward','restartScene','nextScene','previousScene', ...getCatalogRuntimeTypes('action')].includes(type);
}

function isCommentRuntimeType(type) {
  return type === 'comment';
}

function getEventActionIndexes(conditionIndex, scope) {
  const gd = getScopeGridData(scope);
  const conditionData = gd[conditionIndex];
  if (!conditionData) return [];

  if (conditionData.eventId) {
    return Object.entries(gd)
      .filter(([idxStr, data]) => Number(idxStr) !== conditionIndex && data?.eventId === conditionData.eventId && isActionRuntimeType(data.type))
      .map(([idxStr]) => Number(idxStr))
      .sort((a, b) => a - b);
  }

  const row = Math.floor(conditionIndex / 60);
  const col = conditionIndex % 60;
  const actionIndexes = [];
  const seenActions = new Set();
  const addAction = idx => {
    const data = gd[idx];
    if (data && isActionRuntimeType(data.type) && !seenActions.has(idx)) {
      seenActions.add(idx);
      actionIndexes.push(idx);
    }
  };

  getAdjacentIndexes(conditionIndex).forEach(addAction);

  let rightwardStarted = false;
  for (let nextCol = col + 1; nextCol < 60; nextCol++) {
    const idx = row * 60 + nextCol;
    const data = gd[idx];
    if (!data) {
      if (rightwardStarted) break;
      continue;
    }
    if (isActionRuntimeType(data.type)) {
      addAction(idx);
      rightwardStarted = true;
      continue;
    }
    if (isCommentRuntimeType(data.type)) {
      continue;
    }
    break;
  }
  return actionIndexes;
}

function applyAdjacentActionsFromScope(conditionCellOrIndex, scope) {
  const conditionIndex = typeof conditionCellOrIndex === 'number'
    ? conditionCellOrIndex
    : parseInt(conditionCellOrIndex?.dataset?.index, 10);
  if (!Number.isFinite(conditionIndex)) return;
  const gd = getScopeGridData(scope);

  getEventActionIndexes(conditionIndex, scope).forEach(adjIdx => {
    const adjData = gd[adjIdx];
    if (!adjData) return;
    if (isActionRuntimeType(adjData.type)) {
      executeAction(adjData, adjIdx);
    }
  });
}

function normalizeVector(dx, dy) {
  const dist = Math.hypot(dx, dy) || 1;
  return { x: dx / dist, y: dy / dist, dist };
}

function getAlivePreviewObjects() {
  return previewState.objects.filter(o => !destroyedObjects.has(o.id));
}

function isCollisionObject(obj) {
  if (!obj) return false;
  if (obj.kind === 'text' || obj.uiPinned === true) return obj.collision?.enabled === true;
  if (obj.collision && obj.collision.enabled === false) return false;
  return obj.collidable !== false;
}

function getCollisionObjectsByName(name, objectList = getAlivePreviewObjects()) {
  return getObjectsByName(name, objectList).filter(isCollisionObject);
}

function hasGravityMovement(obj) {
  if (!obj || !obj.physicsEnabled) return false;
  return Math.abs(getPhysics(obj).gravity || 0) > 0.0001;
}

function isObjectGrounded(obj, objectList = getAlivePreviewObjects()) {
  if (!obj || !isCollisionObject(obj)) return false;
  const box = getHitbox(obj);
  const bottom = box.y + box.height;
  const tolerance = Math.max(5, Math.abs(obj.velY || 0) + 3);
  return objectList.some(other => {
    if (!other || other.id === obj.id || !isCollisionObject(other)) return false;
    if (!(other.static || !other.physicsEnabled)) return false;
    const floor = getHitbox(other);
    const horizontal = box.x < floor.x + floor.width - 1 && box.x + box.width > floor.x + 1;
    const vertical = bottom >= floor.y - tolerance && bottom <= floor.y + tolerance;
    return horizontal && vertical;
  });
}

function applyPlatformAwareTowardVelocity(obj, dx, dy, speed, mode, n) {
  ensurePhysics(obj);
  const p = getPhysics(obj);
  const horizontalSpeed = Math.sign(dx || n.x || 0) * Math.min(Math.abs(n.x * speed), Math.abs(speed));
  if (mode === 'add') obj.velX += horizontalSpeed;
  else obj.velX = horizontalSpeed;

  const verticalGap = -dy;
  const closeEnoughToJump = Math.abs(dx) <= Math.max(obj.width * 6, Math.abs(speed) * 18, 72);
  const needsJump = verticalGap > Math.max(10, obj.height * 0.25);
  if (needsJump && closeEnoughToJump && isObjectGrounded(obj)) {
    const jumpVelocity = Math.min(
      p.maxSpeed,
      Math.max(Math.abs(speed) * 1.15, Math.sqrt(Math.max(p.gravity, 0.1) * verticalGap * 2))
    );
    obj.velY = Math.min(obj.velY || 0, -jumpVelocity);
  }

  obj.velX = clamp(obj.velX, -p.maxSpeed, p.maxSpeed);
  obj.velY = clamp(obj.velY || 0, -p.maxSpeed, p.maxSpeed);
}

function setVelocityToward(obj, dx, dy, speed, mode = 'set') {
  if (obj.kind === 'text') return;
  ensurePhysics(obj);
  const n = normalizeVector(dx, dy);
  if (hasGravityMovement(obj)) {
    applyPlatformAwareTowardVelocity(obj, dx, dy, speed, mode, n);
    return;
  }
  if (mode === 'add') {
    obj.velX += n.x * speed;
    obj.velY += n.y * speed;
  } else {
    obj.velX = n.x * speed;
    obj.velY = n.y * speed;
  }
  const p = getPhysics(obj);
  obj.velX = clamp(obj.velX, -p.maxSpeed, p.maxSpeed);
  obj.velY = clamp(obj.velY, -p.maxSpeed, p.maxSpeed);
}

function moveObjectTowardPoint(obj, targetX, targetY, speed, stopDistance = 1) {
  const dx = targetX - (obj.posX + obj.width / 2);
  const dy = targetY - (obj.posY + obj.height / 2);
  const n = normalizeVector(dx, dy);
  if (n.dist <= stopDistance) return;
  const step = Math.min(n.dist - stopDistance, speed * (previewState.dt || 1));
  obj.posX += n.x * step;
  obj.posY += n.y * step;
}

function separateObjectsPair(a, b, mode = 'object1') {
  const mtv = getAABBOverlap(a, b);
  if (!mtv) return;
  const moveA = mode !== 'object2';
  const moveB = mode !== 'object1';
  if (moveA && moveB) {
    a.posX += mtv.nx * mtv.depth / 2;
    a.posY += mtv.ny * mtv.depth / 2;
    b.posX -= mtv.nx * mtv.depth / 2;
    b.posY -= mtv.ny * mtv.depth / 2;
  } else if (moveA) {
    a.posX += mtv.nx * mtv.depth;
    a.posY += mtv.ny * mtv.depth;
  } else if (moveB) {
    b.posX -= mtv.nx * mtv.depth;
    b.posY -= mtv.ny * mtv.depth;
  }
  if (mtv.nx !== 0) {
    if (moveA) a.velX = 0;
    if (moveB) b.velX = 0;
  }
  if (mtv.ny !== 0) {
    if (moveA) a.velY = 0;
    if (moveB) b.velY = 0;
  }
}

function setObjectRotationTowardPoint(obj, targetX, targetY, offsetAngle = 0) {
  const dx = targetX - (obj.posX + obj.width / 2);
  const dy = targetY - (obj.posY + obj.height / 2);
  obj.rotation = Math.atan2(dy, dx) * 180 / Math.PI + offsetAngle;
}

function getContextObjectForName(name) {
  if (!name) return null;
  const ctx = previewState.executionContext || {};
  const candidates = [ctx.obj1, ctx.obj2, ctx.targetObjectInstance, ctx.sourceObjectInstance].filter(Boolean);
  return candidates.find(obj => obj.name === name && !destroyedObjects.has(obj.id)) || null;
}

function resolveActionTargets(data, key = 'targetObject', options = {}) {
  const name = data?.[key] || '';
  if (!name) return [];
  const pool = options.includeHidden
    ? previewState.objects.filter(o => !destroyedObjects.has(o.id))
    : getAlivePreviewObjects();
  const all = getObjectsByName(name, pool);
  if (!all.length) return [];
  const mode = data.targetMode || 'context';
  if (mode === 'all') return all;
  if (mode === 'first') return all.slice(0, 1);
  const contextObj = getContextObjectForName(name);
  return contextObj ? [contextObj] : all.slice(0, 1);
}

function clampCameraToScene(scene = getPreviewScene()) {
  const camera = previewState.camera || (previewState.camera = { x: 0, y: 0 });
  const maxX = Math.max(0, getSceneWorldWidth(scene) - getSceneViewportWidth(scene));
  const maxY = Math.max(0, getSceneWorldHeight(scene) - getSceneViewportHeight(scene));
  camera.x = clamp(camera.x || 0, 0, maxX);
  camera.y = clamp(camera.y || 0, 0, maxY);
}

function loadPreviewScene(scene) {
  if (!scene) return;
  window.HydraUniversal?.clearRuntimeDiagnostics?.();
  normalizeSceneDimensions(scene);
  previewState.sceneId = scene.id;
  previewState.objects = cloneData(scene.objects);
  previewState.objects.forEach(o => { o.velX = 0; o.velY = 0; o._alive = true; o._runtimeText = undefined; });
  previewState.camera = { x: 0, y: 0, followTarget: '', offsetX: 0, offsetY: 0 };
  previewState.cameraShake = { strength: 0, timeLeft: 0 };
  previewState.frameId = 0;
  destroyedObjects.clear(); hiddenObjects.clear(); pendingDestroy.clear();
  collisionStates.clear(); collisionTriggerTimes.clear();
  cameraShakeCooldowns.clear();
  onceTriggerStates.clear();
  timerStates.clear();
  spawnCounter.value = 0;
  resetGameStartState();
  resizeGameCanvas(scene);
  processGameStartConditions('global');
  processGameStartConditions(scene.id);
}

function switchPreviewScene(sceneId) {
  const target = scenes.find(s => s.id === Number(sceneId));
  if (!target || target.id === previewState.sceneId) return;
  loadPreviewScene(target);
}

function executeAction(data, idx) {
  switch (data.type) {
    case 'applyForce': {
      const targets = resolveActionTargets(data);
      targets.forEach(obj => {
        if (obj.kind === 'text') return;
        ensurePhysics(obj);
        const fX = evalExpr(data.forceX);
        const fY = evalExpr(data.forceY);
        if (data.mode === 'set') {
          obj.velX = fX;
          obj.velY = fY;
        } else {
          obj.velX += fX;
          obj.velY += fY;
        }
        const p = getPhysics(obj);
        obj.velX = clamp(obj.velX, -p.maxSpeed, p.maxSpeed);
        obj.velY = clamp(obj.velY, -p.maxSpeed, p.maxSpeed);
      });
      break;
    }
    case 'teleport': {
      const targets = resolveActionTargets(data);
      const xInfo = evalExprInfo(data.toX);
      const yInfo = evalExprInfo(data.toY);
      if (!xInfo.ok || !yInfo.ok) break;
      targets.forEach(obj => { obj.posX = xInfo.value; obj.posY = yInfo.value; });
      break;
    }
    case 'setVariable': {
      const cur = gameVariables[data.varName] ?? 0;
      const valInfo = evalExprInfo(data.value);
      if (!valInfo.ok && data.operation !== 'toggle') break;
      const val = valInfo.value;
      switch (data.operation) {
        case 'set':      gameVariables[data.varName] = val; break;
        case 'add':      gameVariables[data.varName] = cur + val; break;
        case 'subtract': gameVariables[data.varName] = cur - val; break;
        case 'multiply': gameVariables[data.varName] = cur * val; break;
        case 'toggle':   gameVariables[data.varName] = !cur; break;
        default:         gameVariables[data.varName] = val;
      }
      break;
    }
    case 'destroyObject': {
      const targets = resolveActionTargets(data);
      targets.forEach(obj => pendingDestroy.add(obj.id));
      break;
    }
    case 'showHide': {
      const targets = resolveActionTargets(data, 'targetObject', { includeHidden: true });
      targets.forEach(obj => {
        if (data.action === 'hide')        hiddenObjects.add(obj.id);
        else if (data.action === 'show')   hiddenObjects.delete(obj.id);
        else if (data.action === 'toggle') {
          if (hiddenObjects.has(obj.id)) hiddenObjects.delete(obj.id);
          else hiddenObjects.add(obj.id);
        }
      });
      break;
    }
    case 'playSound': {
      playSound(data, 'sound_' + idx);
      break;
    }
    case 'switchScene': {
      switchPreviewScene(data.sceneId);
      break;
    }
    case 'restartScene': {
      loadPreviewScene(getPreviewScene());
      break;
    }
    case 'nextScene': {
      const ordered = [...scenes].sort((a, b) => a.id - b.id);
      const idxNow = ordered.findIndex(s => s.id === (previewState.sceneId || currentSceneId));
      const next = ordered[idxNow + 1] || ordered[0];
      if (next) switchPreviewScene(next.id);
      break;
    }
    case 'previousScene': {
      const ordered = [...scenes].sort((a, b) => a.id - b.id);
      const idxNow = ordered.findIndex(s => s.id === (previewState.sceneId || currentSceneId));
      const prev = ordered[idxNow - 1] || ordered[ordered.length - 1];
      if (prev) switchPreviewScene(prev.id);
      break;
    }
    case 'setText': {
      const targets = resolveActionTargets(data);
      targets.forEach(obj => {
        if (obj.kind !== 'text') return;
        if (data.useVariable) {
          obj._runtimeText = `${data.prefix || ''}${gameVariables[data.varName] ?? ''}${data.suffix || ''}`;
        } else {
          obj._runtimeText = data.value || '';
        }
      });
      break;
    }
    case 'setCamera': {
      previewState.camera = previewState.camera || { x: 0, y: 0 };
      previewState.camera.x = evalExpr(data.cameraX);
      previewState.camera.y = evalExpr(data.cameraY);
      previewState.camera.followTarget = '';
      clampCameraToScene();
      break;
    }
    case 'followCamera': {
      previewState.camera = previewState.camera || { x: 0, y: 0 };
      previewState.camera.followTarget = data.targetObject || '';
      previewState.camera.offsetX = evalExpr(data.offsetX);
      previewState.camera.offsetY = evalExpr(data.offsetY);
      updateCameraFollow();
      break;
    }
    case 'setSize': {
      const targets = resolveActionTargets(data);
      targets.forEach(obj => {
        obj.width = Math.max(1, evalExpr(data.width));
        obj.height = Math.max(1, evalExpr(data.height));
      });
      break;
    }
    case 'setVelocity': {
      const targets = resolveActionTargets(data);
      targets.forEach(obj => {
        if (obj.kind === 'text') return;
        ensurePhysics(obj);
        obj.velX = evalExpr(data.velX);
        obj.velY = evalExpr(data.velY);
      });
      break;
    }
    case 'spawnObject': {
      const scene = getPreviewScene();
      const sourceDefs = scene.objects.filter(o => o.name === data.sourceObject);
      sourceDefs.forEach(src => {
        const clone = cloneData(src);
        clone.id    = 'spawn_' + (++spawnCounter.value) + '_' + Date.now();
        clone.posX  = evalExpr(data.spawnX) ?? src.posX;
        clone.posY  = evalExpr(data.spawnY) ?? src.posY;
        clone.velX  = 0; clone.velY = 0;
        clone._alive = true; clone._runtimeText = undefined; clone.rotation = 0;
        previewState.objects.push(clone);
      });
      break;
    }
    case 'rotateObject': {
      const targets = resolveActionTargets(data);
      targets.forEach(obj => {
        if (obj.rotation === undefined) obj.rotation = 0;
        const ang = evalExpr(data.angle);
        obj.rotation = data.mode === 'set' ? ang : (obj.rotation + ang) % 360;
      });
      break;
    }
    case 'randomVariable': {
      const rMin = evalExpr(data.min);
      const rMax = evalExpr(data.max);
      let rVal = Math.random() * (rMax - rMin) + rMin;
      if (data.round) rVal = Math.round(rVal);
      gameVariables[data.varName] = rVal;
      break;
    }
    case 'timerControl': {
      const name = data.timerName || data.name || '';
      if (data.action === 'pause') setNamedTimerPaused(name, true);
      else if (data.action === 'resume') setNamedTimerPaused(name, false);
      else if (data.action === 'clear') clearNamedTimer(name);
      else resetNamedTimer(name);
      break;
    }
    case 'forceToward': {
      const alive = previewState.objects.filter(o => !destroyedObjects.has(o.id));
      const targets = resolveActionTargets(data);
      const sources = getObjectsByName(data.sourceObject, alive);
      if (!sources.length) break;
      const src = sources[0];
      const speed = evalExpr(data.speed ?? 3);
      targets.forEach(obj => {
        const dx = (src.posX + src.width / 2) - (obj.posX + obj.width / 2);
        const dy = (src.posY + src.height / 2) - (obj.posY + obj.height / 2);
        setVelocityToward(obj, dx, dy, speed, data.mode || 'add');
      });
      break;
    }
    case 'forceTowardPosition': {
      const targets = resolveActionTargets(data);
      const txInfo = evalExprInfo(data.targetX ?? 0);
      const tyInfo = evalExprInfo(data.targetY ?? 0);
      const speedInfo = evalExprInfo(data.speed ?? 3);
      if (!txInfo.ok || !tyInfo.ok || !speedInfo.ok) break;
      const tx = txInfo.value;
      const ty = tyInfo.value;
      const speed = speedInfo.value;
      targets.forEach(obj => {
        const dx = tx - (obj.posX + obj.width / 2);
        const dy = ty - (obj.posY + obj.height / 2);
        setVelocityToward(obj, dx, dy, speed, data.mode || 'add');
      });
      break;
    }
    case 'moveTowardPosition': {
      const targets = resolveActionTargets(data);
      const txInfo = evalExprInfo(data.targetX ?? 0);
      const tyInfo = evalExprInfo(data.targetY ?? 0);
      const speedInfo = evalExprInfo(data.speed ?? 4);
      const stopInfo = evalExprInfo(data.stopDistance ?? 1);
      if (!txInfo.ok || !tyInfo.ok || !speedInfo.ok || !stopInfo.ok) break;
      const tx = txInfo.value;
      const ty = tyInfo.value;
      const speed = speedInfo.value;
      const stopDistance = stopInfo.value;
      targets.forEach(obj => moveObjectTowardPoint(obj, tx, ty, speed, stopDistance));
      break;
    }
    case 'moveTowardObject': {
      const alive = getAlivePreviewObjects();
      const targets = resolveActionTargets(data);
      const sources = getObjectsByName(data.sourceObject, alive);
      if (!sources.length) break;
      const src = sources[0];
      const tx = src.posX + src.width / 2;
      const ty = src.posY + src.height / 2;
      const speed = evalExpr(data.speed ?? 4);
      const stopDistance = evalExpr(data.stopDistance ?? 1);
      targets.forEach(obj => moveObjectTowardPoint(obj, tx, ty, speed, stopDistance));
      break;
    }
    case 'impulseAwayObject': {
      const alive = getAlivePreviewObjects();
      const targets = resolveActionTargets(data);
      const sources = getObjectsByName(data.sourceObject, alive);
      if (!sources.length) break;
      const src = sources[0];
      const speed = evalExpr(data.speed ?? 8);
      targets.forEach(obj => {
        const dx = (obj.posX + obj.width / 2) - (src.posX + src.width / 2);
        const dy = (obj.posY + obj.height / 2) - (src.posY + src.height / 2);
        setVelocityToward(obj, dx, dy, speed, data.mode || 'add');
      });
      break;
    }
    case 'stopObject': {
      const targets = resolveActionTargets(data);
      targets.forEach(obj => {
        ensurePhysics(obj);
        if (data.axis === 'x' || data.axis === 'both') obj.velX = 0;
        if (data.axis === 'y' || data.axis === 'both') obj.velY = 0;
      });
      break;
    }
    case 'setPosition': {
      const targets = resolveActionTargets(data);
      const xInfo = evalExprInfo(data.x ?? 0);
      const yInfo = evalExprInfo(data.y ?? 0);
      if (!xInfo.ok || !yInfo.ok) break;
      const x = xInfo.value;
      const y = yInfo.value;
      targets.forEach(obj => { obj.posX = x; obj.posY = y; });
      break;
    }
    case 'clampToScreen': {
      const scene = getPreviewScene();
      const boundsW = getSceneWorldWidth(scene);
      const boundsH = getSceneWorldHeight(scene);
      const targets = resolveActionTargets(data);
      targets.forEach(obj => {
        ensurePhysics(obj);
        const oldX = obj.posX;
        const oldY = obj.posY;
        const box = getHitbox(obj);
        if (box.x < 0) obj.posX += -box.x;
        if (box.y < 0) obj.posY += -box.y;
        if (box.x + box.width > boundsW) obj.posX -= (box.x + box.width) - boundsW;
        if (box.y + box.height > boundsH) obj.posY -= (box.y + box.height) - boundsH;
        if (data.bounce) {
          if (obj.posX !== oldX) obj.velX *= -1;
          if (obj.posY !== oldY) obj.velY *= -1;
        }
      });
      break;
    }
    case 'wrapScreen': {
      const scene = getPreviewScene();
      const boundsW = getSceneWorldWidth(scene);
      const boundsH = getSceneWorldHeight(scene);
      const targets = resolveActionTargets(data);
      targets.forEach(obj => {
        if (obj.posX + obj.width < 0) obj.posX = boundsW;
        if (obj.posX > boundsW) obj.posX = -obj.width;
        if (obj.posY + obj.height < 0) obj.posY = boundsH;
        if (obj.posY > boundsH) obj.posY = -obj.height;
      });
      break;
    }
    case 'setGravity': {
      const targets = resolveActionTargets(data);
      targets.forEach(obj => {
        obj.physics = obj.physics || { ...DEFAULT_PHYSICS };
        obj.physics.gravity = evalExpr(data.gravity ?? DEFAULT_PHYSICS.gravity);
        obj.physicsEnabled = true;
      });
      break;
    }
    case 'setFriction': {
      const targets = resolveActionTargets(data);
      targets.forEach(obj => {
        obj.physics = obj.physics || { ...DEFAULT_PHYSICS };
        obj.physics.friction = clamp(evalExpr(data.friction ?? DEFAULT_PHYSICS.friction), 0, 1);
        obj.physicsEnabled = true;
      });
      break;
    }
    case 'setColor': {
      const targets = resolveActionTargets(data);
      targets.forEach(obj => {
        obj.color = data.color || obj.color || '#ffffff';
        obj.assetId = null;
      });
      break;
    }
    case 'setOpacity': {
      const targets = resolveActionTargets(data);
      const opacity = clamp(evalExpr(data.opacity ?? 1), 0, 1);
      targets.forEach(obj => { obj.opacity = opacity; });
      break;
    }
    case 'separateObjects': {
      const alive = getAlivePreviewObjects();
      const objs1 = getObjectsByName(data.object1, alive);
      const objs2 = getObjectsByName(data.object2, alive);
      objs1.forEach(a => objs2.forEach(b => {
        if (a.id !== b.id) separateObjectsPair(a, b, data.move || 'object1');
      }));
      break;
    }
    case 'destroyOutsideScreen': {
      const scene = getPreviewScene();
      const boundsW = getSceneWorldWidth(scene);
      const boundsH = getSceneWorldHeight(scene);
      const targets = resolveActionTargets(data);
      const margin = Math.max(0, evalExpr(data.margin ?? 0));
      targets.forEach(obj => {
        const box = getHitbox(obj);
        if (
          box.x + box.width < -margin ||
          box.x > boundsW + margin ||
          box.y + box.height < -margin ||
          box.y > boundsH + margin
        ) pendingDestroy.add(obj.id);
      });
      break;
    }
    case 'saveVariable': {
      const key = `hydraSave:${data.saveKey || data.varName || 'value'}`;
      localStorage.setItem(key, JSON.stringify(gameVariables[data.varName] ?? 0));
      break;
    }
    case 'loadVariable': {
      const key = `hydraSave:${data.saveKey || data.varName || 'value'}`;
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        try { gameVariables[data.varName] = JSON.parse(raw); }
        catch { gameVariables[data.varName] = raw; }
      }
      break;
    }
    case 'pointTowardObject': {
      const alive = getAlivePreviewObjects();
      const targets = resolveActionTargets(data);
      const sources = getObjectsByName(data.sourceObject, alive);
      if (!sources.length) break;
      const src = sources[0];
      const tx = src.posX + src.width / 2;
      const ty = src.posY + src.height / 2;
      const offset = evalExpr(data.offsetAngle ?? 0);
      targets.forEach(obj => setObjectRotationTowardPoint(obj, tx, ty, offset));
      break;
    }
    case 'pointTowardPosition': {
      const targets = resolveActionTargets(data);
      const tx = evalExpr(data.targetX ?? 0);
      const ty = evalExpr(data.targetY ?? 0);
      const offset = evalExpr(data.offsetAngle ?? 0);
      targets.forEach(obj => setObjectRotationTowardPoint(obj, tx, ty, offset));
      break;
    }
    case 'spawnAtObject': {
      const scene = getPreviewScene();
      const sourceDefs = scene.objects.filter(o => o.name === data.sourceObject);
      const anchors = resolveActionTargets({ targetObject: data.targetObject, targetMode: data.targetMode || 'context' });
      if (!anchors.length) break;
      const anchor = anchors[0];
      const offsetX = evalExpr(data.offsetX ?? 0);
      const offsetY = evalExpr(data.offsetY ?? 0);
      sourceDefs.forEach(src => {
        const clone = cloneData(src);
        clone.id = 'spawn_' + (++spawnCounter.value) + '_' + Date.now();
        clone.posX = anchor.posX + anchor.width / 2 - clone.width / 2 + offsetX;
        clone.posY = anchor.posY + anchor.height / 2 - clone.height / 2 + offsetY;
        clone.velX = 0;
        clone.velY = 0;
        clone._alive = true;
        clone._runtimeText = undefined;
        previewState.objects.push(clone);
      });
      break;
    }
    case 'setMaxSpeed': {
      const targets = resolveActionTargets(data);
      targets.forEach(obj => {
        obj.physics = obj.physics || { ...DEFAULT_PHYSICS };
        obj.physics.maxSpeed = Math.max(0, evalExpr(data.maxSpeed ?? DEFAULT_PHYSICS.maxSpeed));
        obj.physicsEnabled = true;
      });
      break;
    }
    case 'setBounciness': {
      const targets = resolveActionTargets(data);
      targets.forEach(obj => {
        obj.physics = obj.physics || { ...DEFAULT_PHYSICS };
        obj.physics.bounciness = clamp(evalExpr(data.bounciness ?? DEFAULT_PHYSICS.bounciness), 0, 1);
        obj.physicsEnabled = true;
      });
      break;
    }
    case 'setPhysicsEnabled': {
      const targets = resolveActionTargets(data);
      const enabled = data.enabled === true || data.enabled === 'true';
      targets.forEach(obj => {
        obj.physicsEnabled = enabled;
        if (enabled) obj.physics = obj.physics || { ...DEFAULT_PHYSICS };
        if (data.resetVelocity) {
          obj.velX = 0;
          obj.velY = 0;
        }
      });
      break;
    }
    case 'setStatic': {
      const targets = resolveActionTargets(data);
      const isStatic = data.static === true || data.static === 'true';
      targets.forEach(obj => {
        obj.static = isStatic;
        if (isStatic) {
          obj.velX = 0;
          obj.velY = 0;
        }
      });
      break;
    }
    case 'setLayer': {
      const targets = resolveActionTargets(data);
      const layer = evalExpr(data.layer ?? 0);
      targets.forEach(obj => { obj.layer = layer; });
      break;
    }
    case 'faceMovement': {
      const targets = resolveActionTargets(data);
      const offset = evalExpr(data.offsetAngle ?? 0);
      const threshold = evalExpr(data.minSpeed ?? 0.05);
      targets.forEach(obj => {
        const vx = obj.velX || 0;
        const vy = obj.velY || 0;
        if (Math.hypot(vx, vy) >= threshold) {
          obj.rotation = Math.atan2(vy, vx) * 180 / Math.PI + offset;
        }
      });
      break;
    }
    case 'screenShake': {
      const now = performance.now();
      const cooldownMs = Math.max(0, evalExpr(data.cooldown ?? 0.25) * 1000);
      const cooldownKey = `shake_${idx}`;
      if (cooldownMs && now - (cameraShakeCooldowns.get(cooldownKey) || 0) < cooldownMs) break;
      cameraShakeCooldowns.set(cooldownKey, now);
      previewState.cameraShake = {
        strength: Math.max(0, evalExpr(data.strength ?? 6)),
        timeLeft: Math.max(0, evalExpr(data.duration ?? 0.2) * 1000)
      };
      break;
    }
  }
}

// ============================================================
// HELPERS
// ============================================================
function getAdjacentCells(row, col) {
  return [
    { r: row-1, c: col }, { r: row+1, c: col },
    { r: row, c: col-1 }, { r: row, c: col+1 }
  ].map(({ r, c }) => (r < 0 || r >= 60 || c < 0 || c >= 60) ? null : cells[r*60+c]);
}

function getAdjacentIndexes(index) {
  const row = Math.floor(index / 60);
  const col = index % 60;
  return [
    { r: row - 1, c: col },
    { r: row + 1, c: col },
    { r: row, c: col - 1 },
    { r: row, c: col + 1 }
  ]
    .filter(({ r, c }) => r >= 0 && r < 60 && c >= 0 && c < 60)
    .map(({ r, c }) => r * 60 + c);
}

// ============================================================
// SCENE EDITOR
// ============================================================
let selectedGameObject = null;
let isDragging  = false;
let dragOffsetX = 0, dragOffsetY = 0;
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

function switchInspectorTab(tabName) {
  inspectorTabs.forEach(tab => tab.classList.toggle('active', tab.dataset.inspectorTab === tabName));
  inspectorPanels.forEach(panel => panel.classList.toggle('active', panel.dataset.inspectorPanel === tabName));
}

inspectorTabs.forEach(tab => {
  tab.addEventListener('click', () => switchInspectorTab(tab.dataset.inspectorTab));
});

function snapSceneValue(value) {
  return sceneSnapEnabled ? Math.round(value / SCENE_GRID_SIZE) * SCENE_GRID_SIZE : Math.round(value);
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
  const sceneEl = document.getElementById('scene-canvas');
  if (sceneEl) sceneEl.style.transform = `scale(${sceneZoom})`;
  updateSceneToolState();
}

function setSceneZoom(nextZoom) {
  sceneZoom = clamp(nextZoom, 0.35, 2);
  applySceneZoom();
}

function selectGameObjectById(id) {
  const el = document.querySelector(`.game-object[data-id="${id}"]`);
  const obj = getCurrentScene().objects.find(o => o.id === id);
  if (!el || !obj) return;
  document.querySelectorAll('.game-object').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  selectedGameObject = el;
  showObjectProperties(obj);
  renderObjectList();
  updateSceneToolState();
  switchInspectorTab('inspect');
}

function getScenePointFromEvent(event) {
  const sceneEl = document.getElementById('scene-canvas');
  const rect = sceneEl.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) / sceneZoom,
    y: (event.clientY - rect.top) / sceneZoom
  };
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

function renderObjectList() {
  if (!sceneObjectList) return;
  const query = (entitySearch?.value || '').trim().toLowerCase();
  const objects = [...getCurrentScene().objects]
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
    })
    .sort((a, b) => (b.layer || 0) - (a.layer || 0));
  if (sceneObjectCount) sceneObjectCount.textContent = `${objects.length}/${getCurrentScene().objects.length}`;
  sceneObjectList.innerHTML = '';
  if (!objects.length) {
    const empty = document.createElement('div');
    empty.className = 'object-list-empty';
    empty.textContent = 'No objects in this scene yet.';
    sceneObjectList.appendChild(empty);
    return;
  }
  const selectedId = selectedGameObject ? parseInt(selectedGameObject.dataset.id) : null;
  objects.forEach(obj => {
    const item = document.createElement('div');
    item.className = 'object-list-item' + (obj.id === selectedId ? ' active' : '');
    const swatch = document.createElement('div');
    swatch.className = 'object-list-swatch';
    if (obj.assetId && assetLibrary[obj.assetId]) swatch.style.backgroundImage = `url('${assetLibrary[obj.assetId].dataUrl}')`;
    else swatch.style.backgroundColor = obj.kind === 'text' ? '#111827' : (obj.color || '#4488ff');
    const label = document.createElement('div');
    const name = document.createElement('span');
    name.className = 'object-list-name';
    name.textContent = obj.name || (obj.kind === 'text' ? 'Text Object' : 'Sprite Object');
    const meta = document.createElement('span');
    meta.className = 'object-list-meta';
    const componentCount = obj.components?.length || 0;
    meta.textContent = `${obj.archetype || obj.kind} - ${componentCount} components - ${Math.round(obj.posX)}, ${Math.round(obj.posY)}`;
    label.appendChild(name);
    label.appendChild(meta);
    const layer = document.createElement('span');
    layer.className = 'object-list-layer';
    layer.textContent = `L${obj.layer || 0}`;
    item.appendChild(swatch);
    item.appendChild(label);
    item.appendChild(layer);
    item.draggable = true;
    item.addEventListener('dragstart', e => {
      e.dataTransfer.setData('application/x-hydra-object-id', String(obj.id));
      e.dataTransfer.effectAllowed = 'copy';
    });
    item.addEventListener('click', () => selectGameObjectById(obj.id));
    sceneObjectList.appendChild(item);
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
  const newScene = {
    id: nextSceneId++, name: `Scene ${scenes.length + 1}`,
    objects: [], bgColor: '#ffffff', bgAssetId: null,
    width: 800, height: 600,
    worldWidth: 800, worldHeight: 600,
    viewportWidth: 800, viewportHeight: 600,
    gridData: {},
    logicGrids: { main: {} },
    eventSheets: []
  };
  window.HydraUniversal?.normalizeScene?.(newScene);
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
      markProjectDirty();
    };
  }

  // Scene bg image upload
  const bgUploadBtn = document.getElementById('scene-bg-upload-btn');
  const bgFileInput = document.getElementById('scene-bg-file');
  const bgClearBtn  = document.getElementById('scene-bg-clear-btn');
  if (bgUploadBtn && bgFileInput) {
    bgUploadBtn.onclick = () => bgFileInput.click();
    bgFileInput.onchange = e => {
      const file = e.target.files[0];
      if (!file) return;
      storeAsset(file, assetId => {
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
  const sceneEl = document.getElementById('scene-canvas');
  const scene   = getCurrentScene();
  if (scene.bgAssetId && assetLibrary[scene.bgAssetId]) {
    sceneEl.style.backgroundImage = `url('${assetLibrary[scene.bgAssetId].dataUrl}')`;
    sceneEl.style.backgroundSize = 'cover';
    sceneEl.style.backgroundPosition = 'center';
    sceneEl.style.backgroundColor = '';
  } else {
    sceneEl.style.backgroundImage = '';
    sceneEl.style.backgroundColor = scene.bgColor || '#ffffff';
  }
}

function applySceneSize() {
  const scene   = getCurrentScene();
  const sceneEl = document.getElementById('scene-canvas');
  sceneEl.style.width  = `${getSceneWorldWidth(scene)}px`;
  sceneEl.style.height = `${getSceneWorldHeight(scene)}px`;
  updateCameraFrame();
}

function updateCameraFrame() {
  const sceneEl = document.getElementById('scene-canvas');
  if (!sceneEl) return;
  const scene = getCurrentScene();
  let frame = sceneEl.querySelector('.scene-camera-frame');
  if (!frame) {
    frame = document.createElement('div');
    frame.className = 'scene-camera-frame';
    sceneEl.appendChild(frame);
  }
  frame.style.width = `${Math.min(getSceneViewportWidth(scene), getSceneWorldWidth(scene))}px`;
  frame.style.height = `${Math.min(getSceneViewportHeight(scene), getSceneWorldHeight(scene))}px`;
  frame.style.left = '0px';
  frame.style.top = '0px';
}

function addGameObject(kind, x, y) {
  let width = 60, height = 60;
  if (kind === 'empty') { width = 34; height = 34; }
  if (kind === 'text' || kind === 'button') { width = 160; height = kind === 'button' ? 42 : 32; }
  if (kind === 'camera3d' || kind === 'light3d') { width = 54; height = 54; }

  const obj = {
    id: nextObjectId++,
    name: kind === 'empty' ? 'Entity' : kind === 'button' ? 'Button' : kind === 'camera3d' ? 'Camera3D' : kind === 'light3d' ? 'Light' : '',
    kind: kind === 'button' ? 'text' : kind === 'empty' || kind === 'camera3d' || kind === 'light3d' ? 'sprite' : kind,
    archetype: kind,
    posX: snapSceneValue(x - width/2),
    posY: snapSceneValue(y - height/2),
    width, height,
    velX: 0, velY: 0,
    rotation: 0,
    color: kind === 'camera3d' ? '#38bdf8' : kind === 'light3d' ? '#fde047' : kind === 'empty' ? '#64748b' : '#4488ff',
    assetId: null,
    assetFit: 'cover',
    opacity: 1,
    hitboxOffsetX: 0,
    hitboxOffsetY: 0,
    hitboxWidth: width,
    hitboxHeight: height,
    static: false,
    physicsEnabled: false,
    layer: 0,
    showLabel: false,
    uiPinned: kind === 'text' || kind === 'button',
    physics: { ...DEFAULT_PHYSICS },
    // text
    text: kind === 'text' ? 'Text' : kind === 'button' ? 'Button' : null,
    fontSize: kind === 'text' || kind === 'button' ? 24 : null,
    fontFamily: kind === 'text' ? 'sans-serif' : null,
    textColor: kind === 'text' || kind === 'button' ? '#111827' : null,
    textAlign: kind === 'button' ? 'center' : kind === 'text' ? 'left' : null,
    bold: false,
    italic: false,
  };

  window.HydraUniversal?.normalizeObject?.(obj);
  if (kind === 'button') window.HydraUniversal?.addComponent?.(obj, 'Button');
  if (kind === 'camera3d') window.HydraUniversal?.addComponent?.(obj, 'Camera3D');
  if (kind === 'light3d') window.HydraUniversal?.addComponent?.(obj, 'Light');
  if (kind === 'empty') obj.collision.enabled = false;

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
  if (objectData.rotation) el.style.transform = `rotate(${objectData.rotation}deg)`;

  if (objectData.kind === 'text') {
    applyTextStyle(el, objectData);
  } else {
    applyObjectVisual(el, objectData);
  }
  applyHitboxOverlay(el, objectData);

  el.addEventListener('mousedown', e => {
    e.preventDefault();
    e.stopPropagation();
    document.querySelectorAll('.game-object').forEach(o => o.classList.remove('selected'));
    el.classList.add('selected');
    selectedGameObject = el;
    showObjectProperties(objectData);
    renderObjectList();
    updateSceneToolState();
    isDragging = true;
    const rect = el.getBoundingClientRect();
    dragOffsetX = (e.clientX - rect.left) / sceneZoom;
    dragOffsetY = (e.clientY - rect.top) / sceneZoom;
  });

  sceneEl.appendChild(el);
  return el;
}

function applyTextStyle(el, obj) {
  el.style.fontSize   = `${obj.fontSize || 24}px`;
  el.style.fontFamily = obj.fontFamily || 'sans-serif';
  el.style.color      = obj.textColor || '#111827';
  el.style.fontWeight = obj.bold ? 'bold' : 'normal';
  el.style.fontStyle  = obj.italic ? 'italic' : 'normal';
  el.style.textAlign  = obj.textAlign || 'left';
  el.style.opacity    = obj.opacity ?? 1;
  el.style.display    = 'block';
  el.style.alignItems = '';
  el.style.justifyContent = '';
  el.style.padding    = '0';
  el.style.whiteSpace = 'nowrap';
  el.style.overflow   = 'visible';
  el.style.lineHeight  = 'normal';
  el.style.background = 'transparent';
  el.style.borderRadius = '0';
  el.style.backgroundColor = '';
  el.textContent = obj.text || 'Text';
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
}
window.renderSceneObjects = renderSceneObjects;

// Drag
document.addEventListener('mousemove', e => {
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
  if (isDragging) markProjectDirty();
  isDragging = false;
});

// ============================================================
// OBJECT PROPERTIES PANEL
// ============================================================
function showObjectProperties(obj) {
  const panel = document.getElementById('object-properties');
  const root  = document.createElement('div');

  // Name
  const nameInput = makeTextInput(obj.name || '', 'e.g. player, wall1, score_text', v => {
    obj.name = v;
    renderObjectList();
  });
  root.appendChild(makePropGroup('Name:', nameInput));

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

  } else {
    // Sprite object
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
      storeAsset(file, assetId => {
        obj.assetId = assetId;
        const el = document.querySelector(`.game-object[data-id="${obj.id}"]`);
        if (el) applyObjectVisual(el, obj);
        markProjectDirty();
        showObjectProperties(obj); // refresh panel
      });
    };
    uploadSection.appendChild(uploadBtn);
    uploadSection.appendChild(fileInput);
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
    delBtn.style.cssText = 'width:22px;height:22px;padding:0;margin:0;font-size:12px;background:#ef4444;border-radius:4px;color:white;border:none;cursor:pointer;';
    delBtn.title = 'Delete scene';
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (scenes.length <= 1) { alert('Cannot delete the last scene.'); return; }
      if (!confirm(`Delete "${scene.name}"?`)) return;
      scenes.splice(scenes.indexOf(scene), 1);
      if (currentSceneId === scene.id) setCurrentSceneId(scenes[0].id);
      renderSceneObjects(); refreshSceneList(); refreshScopeTabs();
      markProjectDirty();
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
  // Start the render loop quietly in scene view
  rafHandle = requestAnimationFrame(gameLoop);
  gridContainer.focus();
});
