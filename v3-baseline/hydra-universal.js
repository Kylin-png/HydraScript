// HydraScript universal creator foundation.
// Keeps old object/grid projects working while adding entities, components,
// logic grids, event sheets, and diagnostics as shared engine concepts.
(function installHydraUniversal(global) {
  const COMPONENTS = {
    core: [
      def('Transform', 'Core', 'Position, size, rotation, and hierarchy data.'),
      def('Variables', 'Core', 'Per-entity local variables.'),
      def('Timer', 'Core', 'Named timers local to an entity or event scope.'),
      def('InputMap', 'Core', 'Maps keys, buttons, pointers, or sticks to named actions.'),
      def('Events', 'Core', 'Runs logic attached to this entity.'),
      def('AudioSource', 'Core', 'Plays one-shot or looping audio.')
    ],
    web: [
      def('UIElement', 'Web/UI', 'DOM or HUD element layout, pinning, and interactivity.'),
      def('Text', 'Web/UI', 'Editable text, labels, headings, HUD counters, and signs.'),
      def('Button', 'Web/UI', 'Clickable command surface.'),
      def('FormInput', 'Web/UI', 'Text, number, checkbox, select, or textarea input.'),
      def('Route', 'Web/UI', 'Webapp screen or route state.'),
      def('DataStore', 'Web/UI', 'Small local data table or state store.'),
      def('Fetch', 'Web/UI', 'HTTP request configuration for webapp data.')
    ],
    twoD: [
      def('SpriteRenderer', '2D', 'Draws an image or color rectangle in the 2D viewport.'),
      def('ShapeRenderer', '2D', 'Draws primitive 2D shapes.'),
      def('Collider2D', '2D', '2D hitbox used by collisions and triggers.'),
      def('Rigidbody2D', '2D', 'Velocity, gravity, friction, and collision response.'),
      def('CharacterController2D', '2D', 'Reusable movement for platformers or top-down games.'),
      def('Tilemap', '2D', 'Grid/tile based level geometry.')
    ],
    threeD: [
      def('MeshRenderer', '3D/FPS', 'Primitive, GLB, or generated 3D mesh renderer.'),
      def('Camera3D', '3D/FPS', 'Perspective camera for 3D scenes and FPS games.'),
      def('Light', '3D/FPS', 'Directional, point, or ambient light.'),
      def('Collider3D', '3D/FPS', '3D collision volume.'),
      def('Rigidbody3D', '3D/FPS', '3D physics body placeholder.'),
      def('FirstPersonController', '3D/FPS', 'WASD, pointer-look, jumping, and camera control.'),
      def('RaycastWeapon', '3D/FPS', 'FPS-style hitscan interaction.'),
      def('TriggerZone', '3D/FPS', 'Area triggers for pickups, doors, and checkpoints.')
    ]
  };

  const COMPONENT_LIST = Object.values(COMPONENTS).flat();
  const diagnostics = [];

  function def(type, category, description) {
    return { type, category, description };
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function pushDiagnostic(level, message, source = {}) {
    const key = `${level}:${message}:${source.scope || ''}:${source.index || ''}`;
    if (diagnostics.some(d => d.key === key)) return;
    diagnostics.push({ key, level, message, source, time: Date.now() });
    if (diagnostics.length > 80) diagnostics.shift();
    renderDiagnostics();
  }

  function clearRuntimeDiagnostics() {
    diagnostics.splice(0, diagnostics.length);
    renderDiagnostics();
  }

  function normalizeProject(project) {
    if (!project || typeof project !== 'object') return project;
    project.eventsVersion = project.eventsVersion || 1;
    project.logicGrids = project.logicGrids || {};
    project.eventSheets = project.eventSheets || [];
    project.assets = project.assets || {};

    const hasGlobalGrid = project.globalGridData && Object.keys(project.globalGridData).length > 0;
    const hasGlobalLogic = project.logicGrids.global && Object.keys(project.logicGrids.global).length > 0;
    if (!hasGlobalGrid && hasGlobalLogic) project.globalGridData = project.logicGrids.global;
    if (!project.globalGridData) project.globalGridData = {};
    if (!hasGlobalLogic) project.logicGrids.global = project.globalGridData;

    (project.scenes || []).forEach(scene => normalizeScene(scene, project));
    rebuildProjectEventSheets(project);
    return project;
  }

  function normalizeScene(scene, project = null) {
    if (!scene || typeof scene !== 'object') return scene;
    scene.objects = scene.objects || [];
    scene.entities = scene.entities || scene.objects;
    scene.logicGrids = scene.logicGrids || {};
    const hasSceneGrid = scene.gridData && Object.keys(scene.gridData).length > 0;
    const hasSceneLogic = scene.logicGrids.main && Object.keys(scene.logicGrids.main).length > 0;
    if (!hasSceneGrid && hasSceneLogic) scene.gridData = scene.logicGrids.main;
    if (!scene.gridData) scene.gridData = {};
    if (!hasSceneLogic) scene.logicGrids.main = scene.gridData;
    scene.layers = scene.layers || [
      { id: 'world2d', name: 'World 2D', space: '2d', visible: true },
      { id: 'ui', name: 'UI', space: 'ui', visible: true },
      { id: 'world3d', name: 'World 3D', space: '3d', visible: true }
    ];
    scene.eventSheets = scene.eventSheets || [];
    scene.objects.forEach(obj => normalizeObject(obj));
    scene.entities = scene.objects;
    if (project) project.logicGrids[String(scene.id)] = scene.gridData || {};
    return scene;
  }

  function normalizeObject(obj) {
    if (!obj || typeof obj !== 'object') return obj;
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
    ensureComponent(obj, 'Transform', {
      x: Number(obj.posX) || 0,
      y: Number(obj.posY) || 0,
      width: Number(obj.width) || 1,
      height: Number(obj.height) || 1,
      rotation: Number(obj.rotation) || 0
    });
    ensureComponent(obj, 'Variables', { variables: obj.variables });
    if (obj.kind === 'text') {
      ensureComponent(obj, 'UIElement', { pinned: obj.uiPinned !== false, interactive: false });
      ensureComponent(obj, 'Text', {
        text: obj.text || 'Text',
        fontSize: obj.fontSize || 24,
        color: obj.textColor || '#111827'
      });
    } else {
      ensureComponent(obj, 'SpriteRenderer', {
        color: obj.color || '#4488ff',
        assetId: obj.assetId || null,
        fit: obj.assetFit || 'cover'
      });
    }
    if (obj.collision.enabled) {
      ensureComponent(obj, 'Collider2D', {
        enabled: true,
        trigger: Boolean(obj.trigger),
        offsetX: Number(obj.hitboxOffsetX) || 0,
        offsetY: Number(obj.hitboxOffsetY) || 0,
        width: Number(obj.hitboxWidth || obj.width || 1),
        height: Number(obj.hitboxHeight || obj.height || 1)
      });
    }
    if (obj.physicsEnabled) {
      ensureComponent(obj, 'Rigidbody2D', Object.assign({
        gravity: 0,
        friction: 0.82,
        bounciness: 0.4,
        maxSpeed: 25
      }, obj.physics || {}));
    }
    return obj;
  }

  function ensureComponent(obj, type, props = {}) {
    let component = obj.components.find(c => c.type === type);
    if (!component) {
      component = {
        id: `cmp_${type}_${Math.random().toString(36).slice(2, 8)}`,
        type,
        enabled: true,
        props: {}
      };
      obj.components.push(component);
    }
    component.props = Object.assign({}, props, component.props || {});
    return component;
  }

  function addComponent(obj, type) {
    const info = getComponentDefinition(type);
    if (!obj || !info) return null;
    const component = ensureComponent(obj, type, defaultPropsFor(type, obj));
    if (type === 'Collider2D') obj.collision = Object.assign({}, obj.collision, { enabled: true });
    if (type === 'Rigidbody2D') obj.physicsEnabled = true;
    return component;
  }

  function removeComponent(obj, componentId) {
    if (!obj?.components) return;
    const component = obj.components.find(c => c.id === componentId);
    obj.components = obj.components.filter(c => c.id !== componentId);
    if (component?.type === 'Collider2D') obj.collision = Object.assign({}, obj.collision, { enabled: false });
    if (component?.type === 'Rigidbody2D') obj.physicsEnabled = false;
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
      Camera3D: { fov: 70, near: 0.1, far: 1000 },
      Light: { lightType: 'directional', color: '#ffffff', intensity: 1 },
      Collider3D: { shape: 'box', trigger: false },
      Rigidbody3D: { mass: 1, gravity: true },
      FirstPersonController: { moveSpeed: 6, lookSensitivity: 0.18, jumpSpeed: 5 },
      RaycastWeapon: { range: 80, damage: 1, cooldown: 0.18 },
      TriggerZone: { once: false, eventName: '' }
    };
    return clone(defaults[type] || {});
  }

  function getComponentDefinition(type) {
    return COMPONENT_LIST.find(component => component.type === type) || null;
  }

  function isCondition(type) {
    return [
      'gameStart','always','keyPressed','keyJustPressed','mouseClick',
      'mouseOverObject','objectClicked','getVariable','collision','onFloor',
      'overlapTouch','distanceCheck','positionCheck','velocityCheck','objectVisible',
      'objectCount','chance','onTimer','onEdge','and','triggerOnce'
    ].includes(type);
  }

  function isAction(type) {
    return !isCondition(type) && type !== 'comment';
  }

  function gridToInstructions(gridData = {}) {
    return Object.entries(gridData)
      .map(([index, data]) => {
        const n = Number(index);
        const kind = data?.type === 'comment' ? 'comment' : isCondition(data?.type) ? 'condition' : 'action';
        return {
          id: data?.id || `grid_${n}`,
          index: n,
          row: Math.floor(n / 60),
          col: n % 60,
          kind,
          type: data?.type || 'unknown',
          params: clone(data || {}),
          targetMode: data?.targetMode || 'context',
          enabled: data?.enabled !== false,
          comment: data?.text || data?.comment || '',
          groupId: data?.groupId || data?.eventId || ''
        };
      })
      .sort((a, b) => a.index - b.index);
  }

  function gridToEventRows(gridData = {}) {
    const instructions = gridToInstructions(gridData);
    const byIndex = new Map(instructions.map(inst => [inst.index, inst]));
    const consumedActions = new Set();
    const rows = [];

    for (const inst of instructions) {
      if (inst.kind === 'comment') {
        rows.push({ id: inst.id, type: 'comment', comment: inst.comment || 'Comment', sourceIndexes: [inst.index] });
        continue;
      }
      if (inst.kind !== 'condition') continue;
      const actions = [];
      for (const adj of adjacentIndexes(inst.index)) {
        const candidate = byIndex.get(adj);
        if (candidate?.kind === 'action') {
          actions.push(candidate);
          consumedActions.add(candidate.index);
        }
      }
      for (let c = inst.col + 1; c < 60; c++) {
        const candidate = byIndex.get(inst.row * 60 + c);
        if (!candidate) {
          if (actions.length) break;
          continue;
        }
        if (candidate.kind === 'action') {
          actions.push(candidate);
          consumedActions.add(candidate.index);
          continue;
        }
        if (candidate.kind === 'comment') continue;
        break;
      }
      rows.push({
        id: inst.groupId || inst.id,
        type: 'standard',
        conditions: [inst],
        actions,
        sourceIndexes: [inst.index, ...actions.map(a => a.index)]
      });
    }

    instructions.forEach(inst => {
      if (inst.kind === 'action' && !consumedActions.has(inst.index)) {
        rows.push({ id: inst.id, type: 'loose-action', conditions: [], actions: [inst], sourceIndexes: [inst.index] });
      }
    });
    return rows;
  }

  function adjacentIndexes(index) {
    const row = Math.floor(index / 60);
    const col = index % 60;
    return [
      [row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]
    ].filter(([r, c]) => r >= 0 && r < 60 && c >= 0 && c < 60).map(([r, c]) => r * 60 + c);
  }

  function rebuildProjectEventSheets(project) {
    const sheets = [];
    sheets.push({
      id: 'global',
      name: 'Global Events',
      scope: 'global',
      events: gridToEventRows(project.globalGridData || project.logicGrids?.global || {})
    });
    (project.scenes || []).forEach(scene => {
      sheets.push({
        id: `scene_${scene.id}`,
        name: `${scene.name || 'Scene'} Events`,
        scope: 'scene',
        sceneId: scene.id,
        events: gridToEventRows(scene.gridData || {})
      });
    });
    project.eventSheets = sheets;
    return sheets;
  }

  function formatInstruction(instOrData) {
    const data = instOrData?.params || instOrData || {};
    const type = data.type || instOrData?.type || 'unknown';
    const name = data.targetObject || data.object1 || data.varName || data.sourceObject || '';
    const labels = {
      gameStart: 'At the beginning of the scene',
      always: 'Every frame',
      keyPressed: `${data.key || 'Key'} ${data.inputCondition === 'keyJustPressed' ? 'was pressed' : 'is held'}`,
      mouseClick: `${data.button || 'left'} mouse button`,
      collision: `${data.object1 || 'Object A'} is in collision with ${data.object2 || 'Object B'}`,
      overlapTouch: `${data.object1 || 'Object A'} touches ${data.object2 || 'Object B'}`,
      onTimer: `Timer ${data.timerName || '(unnamed)'} elapsed ${data.interval || 1}s`,
      getVariable: `${data.varName || 'variable'} ${data.operator || '>='} ${data.compareValue ?? 0}`,
      setVariable: `${data.operation || 'set'} ${data.varName || 'variable'} ${data.value ?? ''}`,
      applyForce: `Move ${data.targetObject || 'object'} by (${data.forceX ?? 0}, ${data.forceY ?? 0})`,
      setVelocity: `Set ${data.targetObject || 'object'} velocity`,
      destroyObject: `Delete ${data.targetObject || name || 'object'}`,
      setText: `Set text of ${data.targetObject || 'text object'}`,
      playSound: `Play sound ${data.soundName || data.frequency || 'effect'}`,
      switchScene: `Switch scene`,
      followCamera: `Camera follows ${data.targetObject || 'object'}`,
      forceToward: `${data.targetObject || 'object'} moves toward ${data.sourceObject || 'target'}`,
      forceTowardPosition: `${data.targetObject || 'object'} moves toward (${data.targetX ?? 0}, ${data.targetY ?? 0})`,
      moveTowardPosition: `${data.targetObject || 'object'} moves to (${data.targetX ?? 0}, ${data.targetY ?? 0})`,
      comment: data.text || 'Comment'
    };
    return labels[type] || type.replace(/([A-Z])/g, ' $1').trim();
  }

  function collectProjectDiagnostics(project) {
    const out = [];
    const scan = (scopeName, grid = {}) => {
      Object.entries(grid).forEach(([index, data]) => {
        if (!data?.type) out.push({ level: 'warning', message: `Empty logic block at ${scopeName}:${index}` });
        if (data?.type === 'onTimer' && !String(data.timerName || '').trim()) {
          out.push({ level: 'info', message: `Timer at ${scopeName}:${index} is unnamed; it will be scoped to that block.` });
        }
      });
    };
    scan('global', project.globalGridData || {});
    (project.scenes || []).forEach(scene => scan(scene.name || scene.id, scene.gridData || {}));
    return out;
  }

  function renderDiagnostics() {
    const feed = document.getElementById('diagnostic-feed');
    const count = document.getElementById('diagnostic-count');
    if (count) count.textContent = String(diagnostics.length);
    if (!feed) return;
    feed.innerHTML = '';
    if (!diagnostics.length) {
      const empty = document.createElement('div');
      empty.className = 'diagnostic-empty';
      empty.textContent = 'No runtime diagnostics.';
      feed.appendChild(empty);
      return;
    }
    diagnostics.slice(-12).reverse().forEach(item => {
      const row = document.createElement('div');
      row.className = `diagnostic-row ${item.level || 'info'}`;
      row.textContent = item.message;
      feed.appendChild(row);
    });
  }

  global.HydraUniversal = {
    COMPONENTS,
    COMPONENT_LIST,
    diagnostics,
    normalizeProject,
    normalizeScene,
    normalizeObject,
    ensureComponent,
    addComponent,
    removeComponent,
    getComponentDefinition,
    defaultPropsFor,
    gridToInstructions,
    gridToEventRows,
    rebuildProjectEventSheets,
    formatInstruction,
    collectProjectDiagnostics,
    pushDiagnostic,
    clearRuntimeDiagnostics,
    renderDiagnostics
  };
})(window);
