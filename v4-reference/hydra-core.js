// ============================================================
// HydraScript v4 — Core Engine Foundation
// Entity-Component system, utilities, project model, normalization
// ============================================================

(function (global) {
  'use strict';

  // ---- Utilities ----
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const uid = (prefix = 'id') => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const safeString = (v, fb = '') => (typeof v === 'string' && v.trim() ? v.trim() : fb);
  const isNum = (v) => Number.isFinite(Number(v));

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ---- Component Definitions ----
  const COMPONENT_DEFS = [
    { type: 'Transform', category: 'Core', description: 'Position, size, rotation, and hierarchy data.' },
    { type: 'Variables', category: 'Core', description: 'Per-entity local variables.' },
    { type: 'Timer', category: 'Core', description: 'Named timers local to an entity or event scope.' },
    { type: 'InputMap', category: 'Core', description: 'Maps keys, buttons, pointers, or sticks to named actions.' },
    { type: 'Events', category: 'Core', description: 'Runs logic attached to this entity.' },
    { type: 'AudioSource', category: 'Core', description: 'Plays one-shot or looping audio.' },
    { type: 'UIElement', category: 'Web/UI', description: 'DOM or HUD element layout, pinning, and interactivity.' },
    { type: 'Text', category: 'Web/UI', description: 'Editable text, labels, headings, HUD counters, and signs.' },
    { type: 'Button', category: 'Web/UI', description: 'Clickable command surface.' },
    { type: 'FormInput', category: 'Web/UI', description: 'Text, number, checkbox, select, or textarea input.' },
    { type: 'Route', category: 'Web/UI', description: 'Webapp screen or route state.' },
    { type: 'DataStore', category: 'Web/UI', description: 'Small local data table or state store.' },
    { type: 'Fetch', category: 'Web/UI', description: 'HTTP request configuration for webapp data.' },
    { type: 'SpriteRenderer', category: '2D', description: 'Draws an image or color rectangle in the 2D viewport.' },
    { type: 'ShapeRenderer', category: '2D', description: 'Draws primitive 2D shapes.' },
    { type: 'Collider2D', category: '2D', description: '2D hitbox used by collisions and triggers.' },
    { type: 'Rigidbody2D', category: '2D', description: 'Velocity, gravity, friction, and collision response.' },
    { type: 'CharacterController2D', category: '2D', description: 'Reusable movement for platformers or top-down games.' },
    { type: 'Tilemap', category: '2D', description: 'Grid/tile based level geometry.' },
    { type: 'MeshRenderer', category: '3D/FPS', description: 'Primitive, GLB, or generated 3D mesh renderer.' },
    { type: 'Camera3D', category: '3D/FPS', description: 'Perspective camera for 3D scenes and FPS games.' },
    { type: 'Light', category: '3D/FPS', description: 'Directional, point, or ambient light.' },
    { type: 'Collider3D', category: '3D/FPS', description: '3D collision volume.' },
    { type: 'Rigidbody3D', category: '3D/FPS', description: '3D physics body placeholder.' },
    { type: 'FirstPersonController', category: '3D/FPS', description: 'WASD, pointer-look, jumping, and camera control.' },
    { type: 'RaycastWeapon', category: '3D/FPS', description: 'FPS-style hitscan interaction.' },
    { type: 'TriggerZone', category: '3D/FPS', description: 'Area triggers for pickups, doors, and checkpoints.' },
  ];

  const COMPONENT_MAP = Object.fromEntries(COMPONENT_DEFS.map((c) => [c.type, c]));
  const COMPONENT_CATEGORIES = [...new Set(COMPONENT_DEFS.map((c) => c.category))];

  function getComponentDefinition(type) {
    return COMPONENT_MAP[type] || null;
  }

  function defaultPropsFor(type, obj = {}) {
    const baseSize = { width: Number(obj.width) || 64, height: Number(obj.height) || 64 };
    const defaults = {
      Transform: { x: obj.posX || 0, y: obj.posY || 0, width: baseSize.width, height: baseSize.height, rotation: obj.rotation || 0 },
      Variables: { variables: obj.variables || {} },
      Timer: { timers: [] },
      InputMap: { actions: [] },
      Events: { sheetId: '' },
      AudioSource: { assetId: '', volume: 1, loop: false },
      UIElement: { pinned: true, interactive: false, role: 'generic' },
      Text: { text: obj.text || 'Text', fontSize: obj.fontSize || 24, color: obj.textColor || '#111827' },
      Button: { label: obj.text || obj.name || 'Button', action: '' },
      FormInput: { inputType: 'text', value: '', placeholder: '' },
      Route: { path: '/', title: obj.name || 'Screen' },
      DataStore: { records: [] },
      Fetch: { url: '', method: 'GET' },
      SpriteRenderer: { color: obj.color || '#4488ff', assetId: obj.assetId || null, fit: obj.assetFit || 'cover' },
      ShapeRenderer: { shape: 'rectangle', color: obj.color || '#4488ff' },
      Collider2D: { enabled: true, trigger: false, offsetX: 0, offsetY: 0, width: baseSize.width, height: baseSize.height },
      Rigidbody2D: Object.assign({ gravity: 0, friction: 0.82, bounciness: 0.4, maxSpeed: 25 }, obj.physics || {}),
      CharacterController2D: { mode: 'platformer', speed: 400, jumpSpeed: 700, gravity: 1050 },
      Tilemap: { tileSize: 32, tiles: [] },
      MeshRenderer: { primitive: 'box', material: '#7dd3fc', assetId: '' },
      Camera3D: { fov: 60, near: 0.1, far: 1000 },
      Light: { type: 'directional', color: '#ffffff', intensity: 1 },
      Collider3D: { shape: 'box', width: 1, height: 1, depth: 1 },
      Rigidbody3D: { mass: 1, velocity: [0, 0, 0] },
      FirstPersonController: { speed: 5, sensitivity: 0.002, jumpHeight: 1.5 },
      RaycastWeapon: { range: 50, damage: 10 },
      TriggerZone: { size: [1, 1, 1], once: false },
    };
    return defaults[type] || {};
  }

  // ---- Entity/Component Operations ----
  function ensureComponent(obj, type, props = {}) {
    if (!obj.components) obj.components = [];
    let comp = obj.components.find((c) => c.type === type);
    if (!comp) {
      comp = { id: HydraCore.uid('cmp'), type, enabled: true, props: {} };
      obj.components.push(comp);
    }
    comp.props = Object.assign({}, props, comp.props || {});
    return comp;
  }

  function addComponent(obj, type) {
    if (!obj || !COMPONENT_MAP[type]) return null;
    const comp = ensureComponent(obj, type, defaultPropsFor(type, obj));
    if (type === 'Collider2D') obj.collision = Object.assign({}, obj.collision, { enabled: true });
    if (type === 'Rigidbody2D') obj.physicsEnabled = true;
    return comp;
  }

  function removeComponent(obj, componentId) {
    if (!obj?.components) return;
    const comp = obj.components.find((c) => c.id === componentId);
    obj.components = obj.components.filter((c) => c.id !== componentId);
    if (comp?.type === 'Collider2D') obj.collision = Object.assign({}, obj.collision, { enabled: false });
    if (comp?.type === 'Rigidbody2D') obj.physicsEnabled = false;
  }

  function getComponent(obj, type) {
    return obj?.components?.find((c) => c.type === type) || null;
  }

  // ---- Object Normalization ----
  function normalizeObject(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    obj.id = obj.id || HydraCore.uid('ent');
    obj.name = obj.name || `${obj.kind || 'Entity'} ${obj.id.slice(-4)}`;
    obj.kind = obj.kind || 'sprite';
    obj.tags = Array.isArray(obj.tags) ? obj.tags : [];
    obj.variables = obj.variables || {};
    obj.effects = Array.isArray(obj.effects) ? obj.effects : [];
    obj.components = Array.isArray(obj.components) ? obj.components : [];
    obj.children = Array.isArray(obj.children) ? obj.children : [];
    obj.collision = obj.collision || {};
    if (typeof obj.collision.enabled !== 'boolean') {
      obj.collision.enabled = obj.kind !== 'text' && obj.uiPinned !== true;
    }
    obj.posX = Number(obj.posX) || 0;
    obj.posY = Number(obj.posY) || 0;
    obj.width = Number(obj.width) || 64;
    obj.height = Number(obj.height) || 64;
    obj.rotation = Number(obj.rotation) || 0;

    ensureComponent(obj, 'Transform', {
      x: obj.posX, y: obj.posY, width: obj.width, height: obj.height, rotation: obj.rotation
    });
    ensureComponent(obj, 'Variables', { variables: obj.variables });

    if (obj.kind === 'text') {
      ensureComponent(obj, 'UIElement', { pinned: obj.uiPinned !== false, interactive: false });
      ensureComponent(obj, 'Text', {
        text: obj.text || 'Text', fontSize: obj.fontSize || 24, color: obj.textColor || '#111827'
      });
    } else {
      ensureComponent(obj, 'SpriteRenderer', {
        color: obj.color || '#4488ff', assetId: obj.assetId || null, fit: obj.assetFit || 'cover'
      });
    }
    if (obj.collision.enabled) {
      ensureComponent(obj, 'Collider2D', {
        enabled: true, trigger: Boolean(obj.trigger),
        offsetX: Number(obj.hitboxOffsetX) || 0, offsetY: Number(obj.hitboxOffsetY) || 0,
        width: Number(obj.hitboxWidth || obj.width) || 64, height: Number(obj.hitboxHeight || obj.height) || 64
      });
    }
    if (obj.physicsEnabled) {
      ensureComponent(obj, 'Rigidbody2D', Object.assign(
        { gravity: 0, friction: 0.82, bounciness: 0.4, maxSpeed: 25 }, obj.physics || {}
      ));
    }
    return obj;
  }

  // ---- Scene Normalization ----
  function normalizeScene(scene, project = null) {
    if (!scene || typeof scene !== 'object') return scene;
    scene.id = scene.id || HydraCore.uid('scene');
    scene.name = scene.name || 'Untitled Scene';
    scene.objects = scene.objects || [];
    scene.entities = scene.objects;
    scene.bgColor = scene.bgColor || '#1a1a2e';
    scene.bgAssetId = scene.bgAssetId || null;
    scene.width = Number(scene.width) || 800;
    scene.height = Number(scene.height) || 600;
    scene.worldWidth = Math.max(100, Number(scene.worldWidth || scene.width) || 800);
    scene.worldHeight = Math.max(100, Number(scene.worldHeight || scene.height) || 600);
    scene.viewportWidth = Math.max(100, Number(scene.viewportWidth || Math.min(scene.worldWidth, 800)) || 800);
    scene.viewportHeight = Math.max(100, Number(scene.viewportHeight || Math.min(scene.worldHeight, 600)) || 600);
    scene.gridData = scene.gridData || {};
    scene.logicGrids = scene.logicGrids || { main: scene.gridData };
    if (!scene.logicGrids.main) scene.logicGrids.main = scene.gridData;
    scene.eventSheets = scene.eventSheets || [];
    scene.layers = scene.layers || [
      { id: 'world2d', name: 'World 2D', space: '2d', visible: true },
      { id: 'ui', name: 'UI', space: 'ui', visible: true },
      { id: 'world3d', name: 'World 3D', space: '3d', visible: true },
    ];
    scene.objects.forEach(normalizeObject);
    scene.entities = scene.objects;
    if (project) {
      project.logicGrids = project.logicGrids || {};
      project.logicGrids[String(scene.id)] = scene.gridData;
    }
    return scene;
  }

  // ---- Project Normalization ----
  function normalizeProject(project) {
    if (!project || typeof project !== 'object') return project;
    project.id = project.id || HydraCore.uid('proj');
    project.name = project.name || 'Untitled Project';
    project.eventsVersion = project.eventsVersion || 1;
    project.logicGrids = project.logicGrids || {};
    project.eventSheets = project.eventSheets || [];
    project.assets = project.assets || {};
    project.globalGridData = project.globalGridData || project.logicGrids.global || {};
    project.logicGrids.global = project.globalGridData;
    project.scenes = project.scenes || [];
    project.scenes.forEach((s) => normalizeScene(s, project));
    project.currentSceneId = project.currentSceneId || project.scenes[0]?.id || 1;
    project.activeScriptScope = project.activeScriptScope || 'global';
    return project;
  }

  // ---- Factories ----
  function createScene(name = 'New Scene', overrides = {}) {
    return Object.assign({
      id: HydraCore.uid('scene'), name,
      objects: [], entities: [],
      bgColor: '#1a1a2e', bgAssetId: null,
      width: 800, height: 600,
      worldWidth: 800, worldHeight: 600,
      viewportWidth: 800, viewportHeight: 600,
      gridData: {}, logicGrids: { main: {} },
      eventSheets: [],
      layers: [
        { id: 'world2d', name: 'World 2D', space: '2d', visible: true },
        { id: 'ui', name: 'UI', space: 'ui', visible: true },
        { id: 'world3d', name: 'World 3D', space: '3d', visible: true },
      ],
    }, overrides);
  }

  function createObject(kind = 'sprite', overrides = {}) {
    const base = {
      id: HydraCore.uid('ent'),
      name: overrides.name || `${kind.charAt(0).toUpperCase() + kind.slice(1)} ${Math.floor(Math.random() * 999)}`,
      kind, posX: 0, posY: 0,
      width: kind === 'text' ? 200 : 64,
      height: kind === 'text' ? 40 : 64,
      rotation: 0, color: '#4488ff',
      static: false, physicsEnabled: false,
      collision: { enabled: kind !== 'text', trigger: false },
      tags: [], variables: {}, effects: [], components: [], children: [],
    };
    if (kind === 'text') {
      base.text = overrides.text || 'Text';
      base.fontSize = overrides.fontSize || 24;
      base.textColor = overrides.textColor || '#111827';
      base.fontFamily = overrides.fontFamily || 'Inter, sans-serif';
      base.textAlign = overrides.textAlign || 'left';
      base.bold = false; base.italic = false;
      base.uiPinned = true;
    }
    if (kind === 'button') {
      base.text = overrides.text || 'Button';
      base.color = '#3B82F6';
      base.collision = { enabled: false, trigger: false };
      base.uiPinned = true;
    }
    return normalizeObject(Object.assign(base, overrides));
  }

  function createProject(name = 'Untitled Project', overrides = {}) {
    const scene = createScene('Scene 1');
    const project = Object.assign({
      id: HydraCore.uid('proj'), name,
      dateCreated: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      eventsVersion: 1,
      globalGridData: {}, logicGrids: { global: {} },
      eventSheets: [],
      scenes: [scene],
      currentSceneId: scene.id,
      nextSceneId: 2,
      activeScriptScope: 'global',
      sceneCount: 1, assets: {},
    }, overrides);
    normalizeProject(project);
    return project;
  }

  // ---- Event Sheet Conversion (grid → event rows) ----
  function gridToEventRows(gridData) {
    if (!gridData || typeof gridData !== 'object') return [];
    const rows = [];
    let currentRow = null;
    const cells = Object.keys(gridData).map(Number).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);

    for (const idx of cells) {
      const cell = gridData[idx];
      if (!cell) continue;
      if (cell.type === 'comment') {
        if (currentRow) rows.push(currentRow);
        currentRow = { comment: cell.text || '', conditions: [], actions: [] };
        rows.push(currentRow);
        currentRow = null;
        continue;
      }
      if (cell.kind === 'condition' || isConditionType(cell.type)) {
        if (currentRow && (currentRow.conditions.length || currentRow.actions.length)) rows.push(currentRow);
        currentRow = { comment: '', conditions: [], actions: [] };
        currentRow.conditions.push(cell);
      } else if (cell.kind === 'action' || isActionType(cell.type)) {
        if (!currentRow) currentRow = { comment: '', conditions: [], actions: [] };
        currentRow.actions.push(cell);
      }
    }
    if (currentRow) rows.push(currentRow);
    return rows;
  }

  function isConditionType(type) {
    const condTypes = ['always', 'gameStart', 'keyDown', 'keyPressed', 'keyReleased', 'mouseDown',
      'mousePressed', 'mouseReleased', 'overlap', 'timer', 'triggerOnce', 'edge',
      'distanceCheck', 'positionCheck', 'mouseCondition', 'advancedCondition', 'andCondition'];
    return condTypes.includes(type);
  }

  function isActionType(type) {
    return !isConditionType(type) && type !== 'comment';
  }

  // ---- Export ----
  global.HydraCore = {
    clone, clamp, uid, safeString, isNum, escapeHtml,
    COMPONENT_DEFS, COMPONENT_MAP, COMPONENT_CATEGORIES,
    getComponentDefinition, defaultPropsFor,
    ensureComponent, addComponent, removeComponent, getComponent,
    normalizeObject, normalizeScene, normalizeProject,
    createScene, createObject, createProject,
    gridToEventRows, isConditionType, isActionType,
  };
})(window);
