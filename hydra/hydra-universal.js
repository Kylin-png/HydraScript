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

  // ============================================================
  // ASSETS — model helpers (pure; shared by editor, hub, and tests)
  // Asset record: { name, dataUrl, kind:'image'|'audio'|'other', mime, sizeBytes,
  //                 width?, height? }
  // Records saved by older builds may only carry {name, dataUrl}; normalizeAsset
  // backfills the rest so old projects keep working unchanged.
  // ============================================================
  const ASSET_KEY_FIELDS = ['assetId', 'bgAssetId'];

  function inferAssetKind(dataUrl) {
    const m = /^data:([^;,]+)/.exec(dataUrl || '');
    const mime = (m ? m[1] : '').toLowerCase();
    if (mime.indexOf('image/') === 0) return 'image';
    if (mime.indexOf('audio/') === 0) return 'audio';
    return 'other';
  }

  function inferAssetMime(dataUrl) {
    const m = /^data:([^;,]+)/.exec(dataUrl || '');
    return m ? m[1] : '';
  }

  function inferAssetSizeBytes(dataUrl) {
    if (typeof dataUrl !== 'string') return 0;
    const b64 = dataUrl.split(',')[1] || '';
    return Math.floor(b64.length * 3 / 4);
  }

  function normalizeAsset(rec) {
    if (!rec || typeof rec !== 'object') return rec;
    rec.name = rec.name || 'Untitled asset';
    rec.kind = rec.kind || inferAssetKind(rec.dataUrl);
    // P4 item 3D2: .glb/.gltf files are 3D model assets (upload sniffing by
    // File type is unreliable for models, so the name decides).
    if ((!rec.kind || rec.kind === 'other') && /\.(glb|gltf)$/i.test(rec.name)) rec.kind = 'model';
    rec.mime = rec.mime || inferAssetMime(rec.dataUrl);
    if (rec.kind === 'model' && !rec.mime) {
      rec.mime = /\.gltf$/i.test(rec.name) ? 'model/gltf+json' : 'model/gltf-binary';
    }
    if (rec.sizeBytes == null) rec.sizeBytes = inferAssetSizeBytes(rec.dataUrl);
    return rec;
  }

  function normalizeAssets(assets) {
    if (!assets || typeof assets !== 'object' || Array.isArray(assets)) return assets;
    Object.keys(assets).forEach(id => normalizeAsset(assets[id]));
    return assets;
  }

  // Upload limits (Stage 2 asset manager). Projects save to localStorage,
  // so an unbounded upload breaks saves: files over 8 MB are refused with
  // a plain message, and still images larger than 1024 px on a side are
  // scaled down on upload. GIFs skip the downscale — redrawing one through
  // a canvas would freeze it to a single frame.
  const ASSET_MAX_FILE_BYTES = 8 * 1024 * 1024;
  const ASSET_MAX_IMAGE_SIDE = 1024;

  // file: { name, size, type } — a File, or a plain object in tests.
  // Returns { ok: true } or { ok: false, reason } with a message safe to
  // show to the user as-is.
  function validateUploadFile(file) {
    if (!file || typeof file !== 'object') return { ok: false, reason: 'No file was selected.' };
    const size = Number(file.size);
    if (isFinite(size) && size > ASSET_MAX_FILE_BYTES) {
      return {
        ok: false,
        reason: '"' + (file.name || 'That file') + '" is ' + formatBytes(size) +
          ' — files over ' + formatBytes(ASSET_MAX_FILE_BYTES) +
          ' cannot be uploaded. Shrink the file and try again.'
      };
    }
    return { ok: true };
  }

  // Returns { width, height, downscaled } — the input size unchanged when
  // the image already fits inside maxSide on its longest side.
  function downscaleDimensions(width, height, maxSide) {
    const w = Number(width) || 0;
    const h = Number(height) || 0;
    const side = Math.max(w, h);
    const limit = Number(maxSide) || ASSET_MAX_IMAGE_SIDE;
    if (!w || !h || side <= limit) return { width: w, height: h, downscaled: false };
    const scale = limit / side;
    return {
      width: Math.max(1, Math.round(w * scale)),
      height: Math.max(1, Math.round(h * scale)),
      downscaled: true
    };
  }

  // Where is each asset referenced? Returns { assetId: [usage] } where each
  // usage is { where:'sprite'|'background'|'component'|'model', objectName,
  // sceneId, sceneName, componentType? }. Scans scene backgrounds, object
  // sprites, model3d model references (recursively through children), and
  // component asset references.
  // Dangling references (id not present in project.assets) are still
  // reported. Assets with no entry are unused.
  function collectAssetUsage(project) {
    const usages = {};
    const add = (assetId, entry) => {
      if (!assetId || typeof assetId !== 'string') return;
      (usages[assetId] = usages[assetId] || []).push(entry);
    };
    const scanObject = (obj, scene) => {
      if (!obj || typeof obj !== 'object') return;
      if (obj.assetId) add(obj.assetId, {
        where: 'sprite', objectName: obj.name || 'object',
        sceneId: scene.id, sceneName: scene.name || 'Scene'
      });
      // P4 item 3D2: model3d objects reference model assets.
      if (obj.modelAssetId) add(obj.modelAssetId, {
        where: 'model', objectName: obj.name || 'object',
        sceneId: scene.id, sceneName: scene.name || 'Scene'
      });
      asArray(obj.components).forEach(c => {
        if (c && typeof c === 'object' && typeof c.assetId === 'string' && c.assetId) {
          add(c.assetId, {
            where: 'component', objectName: obj.name || 'object',
            sceneId: scene.id, sceneName: scene.name || 'Scene',
            componentType: c.type || 'component'
          });
        }
      });
      asArray(obj.children).forEach(child => scanObject(child, scene));
    };
    // P1 item 16: a damaged scene list (a string, a number) scans as
    // empty instead of throwing on `.forEach`.
    asArray(project && project.scenes).forEach(scene => {
      if (!scene || typeof scene !== 'object') return;
      if (scene.bgAssetId) add(scene.bgAssetId, {
        where: 'background', sceneId: scene.id, sceneName: scene.name || 'Scene'
      });
      asArray(scene.objects).forEach(obj => scanObject(obj, scene));
    });
    return usages;
  }

  // Plural alias kept for code written against the early draft name.
  function collectAssetUsages(project) { return collectAssetUsage(project); }

  function findUnusedAssets(project) {
    const assets = (project && project.assets) || {};
    const usages = collectAssetUsage(project);
    return Object.keys(assets).filter(id => !(usages[id] && usages[id].length));
  }

  // Clear every reference to an asset across the project (object sprites,
  // scene backgrounds, component asset fields); returns the number cleared.
  function removeAssetReferences(project, assetId) {
    if (!project || !assetId) return 0;
    let cleared = 0;
    const scanObject = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      if (obj.assetId === assetId) { obj.assetId = null; cleared++; }
      // P4 item 3D2: clear model3d references too.
      if (obj.modelAssetId === assetId) { obj.modelAssetId = null; cleared++; }
      asArray(obj.components).forEach(c => {
        if (c && typeof c === 'object' && c.assetId === assetId) { c.assetId = null; cleared++; }
      });
      asArray(obj.children).forEach(scanObject);
    };
    // P1 item 16: a damaged scene list scans as empty instead of throwing.
    asArray(project.scenes).forEach(scene => {
      if (!scene || typeof scene !== 'object') return;
      if (scene.bgAssetId === assetId) { scene.bgAssetId = null; cleared++; }
      asArray(scene.objects).forEach(scanObject);
    });
    return cleared;
  }

  function formatBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  }

  // P1 item 16 (resilience): corrupt saved data arrives with the right
  // shape but the wrong types (a string where an array belongs, a number
  // where an object belongs). These coercions repair the shape instead of
  // letting a `.forEach` on a string kill the whole load.
  function asArray(v) { return Array.isArray(v) ? v : []; }
  function asPlainObject(v) {
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  }

  function normalizeProject(project) {
    if (!project || typeof project !== 'object') return project;
    project.eventsVersion = project.eventsVersion || 1;
    project.logicGrids = asPlainObject(project.logicGrids);
    project.eventSheets = asArray(project.eventSheets);
    project.assets = asPlainObject(project.assets);
    normalizeAssets(project.assets);
    // Named input actions (P4 item 29): absent in old projects -> empty list,
    // so old projects behave exactly as before.
    if (!Array.isArray(project.inputActions)) project.inputActions = [];
    // Audio buses (P4 item 30): absent in old projects -> the shipped
    // defaults. Keep in sync with HydraAudioBuses.BUS_DEFAULTS
    // (hydra-buses.js loads after this file, so the defaults are inlined).
    if (!project.audioBuses || typeof project.audioBuses !== 'object' || Array.isArray(project.audioBuses)) {
      project.audioBuses = {
        music: { volume: 0.8, muted: false, maxVoices: 1 },
        sfx:   { volume: 1.0, muted: false, maxVoices: 8 },
        ui:    { volume: 1.0, muted: false, maxVoices: 4 }
      };
    }
    // Master fader (P4 item 37 batch 3): absent/corrupt in old projects ->
    // full volume, so old projects sound exactly as before.
    {
      const mraw = project.masterVolume;
      const mv = (mraw === null || mraw === undefined || mraw === '') ? 1 : Number(mraw);
      project.masterVolume = (isFinite(mv) && mv >= 0 && mv <= 1) ? mv : 1;
    }
    // Localization string tables (P4 Advanced batch 6): absent in old
    // projects -> English-only, so old projects behave exactly as before.
    // Keep in sync with HydraLocalization.normalizeLocalization
    // (hydra-localization.js loads after this file, so the defaults and
    // the light repair are inlined; the module owns deep normalization).
    if (!project.localization || typeof project.localization !== 'object' || Array.isArray(project.localization)) {
      project.localization = { defaultLanguage: 'en', languages: ['en'], entries: [] };
    } else {
      const loc = project.localization;
      const def = String(loc.defaultLanguage == null ? '' : loc.defaultLanguage).trim() || 'en';
      loc.defaultLanguage = def;
      const seenL = {};
      const langs = [];
      (Array.isArray(loc.languages) ? loc.languages : []).forEach(c => {
        const code = String(c == null ? '' : c).trim();
        if (code && !seenL[code]) { seenL[code] = true; langs.push(code); }
      });
      if (!seenL[def]) langs.unshift(def);
      loc.languages = langs.length ? langs : [def];
      if (!Array.isArray(loc.entries)) loc.entries = [];
    }

    // Dialogue (P4 Advanced batch 7): absent in old projects -> no
    // conversations, so old projects behave exactly as before. Keep in
    // sync with HydraDialogue.normalizeDialogues (hydra-dialogue.js
    // loads after this file, so the default and the light repair are
    // inlined; the module owns deep normalization).
    if (!Array.isArray(project.dialogues)) project.dialogues = [];

    // Inventory (P4 Advanced batch 8): absent in old projects -> no
    // items, so old projects behave exactly as before. Keep in sync
    // with HydraInventory.normalizeItems (hydra-inventory.js loads
    // after this file, so the default and the light repair are inlined;
    // the module owns deep normalization).
    if (!Array.isArray(project.items)) project.items = [];

    // Quests (P4 Advanced batch 9): absent in old projects -> no
    // quests, so old projects behave exactly as before. Keep in sync
    // with HydraQuest.normalizeQuests (hydra-quest.js loads after
    // this file, so the default and the light repair are inlined; the
    // module owns deep normalization).
    if (!Array.isArray(project.quests)) project.quests = [];

    // Achievements (P4 Advanced batch 10): absent in old projects ->
    // no achievements, so old projects behave exactly as before.
    // Keep in sync with HydraAchievement.normalizeAchievements
    // (hydra-achievement.js loads after this file, so the default
    // and the light repair are inlined; the module owns deep
    // normalization).
    if (!Array.isArray(project.achievements)) project.achievements = [];

    // Cutscenes (P4 Advanced batch 11): absent in old projects ->
    // no cutscenes, so old projects behave exactly as before.
    // Keep in sync with HydraCutscene.normalizeCutscenes
    // (hydra-cutscene.js loads after this file, so the default
    // and the light repair are inlined; the module owns deep
    // normalization).
    if (!Array.isArray(project.cutscenes)) project.cutscenes = [];

    // High scores (P4 Advanced batch 12): absent in old projects ->
    // the default table config, so old projects behave exactly as
    // before. Keep in sync with
    // HydraHighScore.normalizeHighScoreConfig (hydra-highscore.js
    // loads after this file, so the default and the light repair are
    // inlined; the module owns deep normalization).
    if (!project.highScores || typeof project.highScores !== 'object' || Array.isArray(project.highScores)) {
      project.highScores = { maxEntries: 10, defaultName: 'Player' };
    }

    // Scene transitions (P4 Advanced batch 14): absent in old
    // projects -> the default fade, so old projects behave exactly
    // as before (plain Switch Scene stays an instant cut). Keep in
    // sync with HydraTransition.normalizeTransitionConfig
    // (hydra-transition.js loads after this file, so the default
    // and the light repair are inlined; the module owns deep
    // normalization).
    if (!project.sceneTransition || typeof project.sceneTransition !== 'object' || Array.isArray(project.sceneTransition)) {
      project.sceneTransition = { effect: 'fade', duration: 0.5 };
    }

    // Virtual joystick (P4 Advanced batch 20): absent in old
    // projects -> the stick is off by default, so old projects behave
    // exactly as before. Keep in sync with
    // HydraJoystick.normalizeJoystickConfig (hydra-joystick.js
    // loads after this file, so the default and the light repair are
    // inlined; the module owns deep normalization).
    if (!project.virtualJoystick || typeof project.virtualJoystick !== 'object' || Array.isArray(project.virtualJoystick)) {
      project.virtualJoystick = { enabled: false, anchor: 'bottom-left', x: 120, y: 480, radius: 60, knobRadius: 24, deadzone: 0.15, varX: 'joystickX', varY: 'joystickY', actionLeft: '', actionRight: '', actionUp: '', actionDown: '' };
    }

    // Scoped variable definitions (P5 core-engine track, item P5-1,
    // slice b): the authored starting values for the scoped
    // variables, one per (scope, object, name), listed in the
    // Variables manager and seeded into the run at run start (global
    // + object) and at scene load (scene). Absent in old projects
    // -> no definitions, so old projects behave exactly as before
    // (their variables still come only from blocks). Keep in sync
    // with HydraVariables.normalizeDefinitions (hydra-variables.js
    // loads after this file, so the deep pass runs when the module
    // is present and the light repair covers the rest; the module
    // owns deep normalization).
    if (typeof window !== 'undefined' && window.HydraVariables &&
        typeof window.HydraVariables.normalizeDefinitions === 'function') {
      project.scopedVariables = window.HydraVariables.normalizeDefinitions(project.scopedVariables);
    } else if (!Array.isArray(project.scopedVariables)) {
      project.scopedVariables = [];
    }

    // Custom functions (P5 core-engine track, item P5-3, slice a):
    // the named reusable block chains, one record per function
    // ({ id, name, params, grid }) listed in the Functions manager.
    // Absent in old projects -> no functions, so old projects behave
    // exactly as before (their logic still lives only in the global
    // and scene grids). Keep in sync with
    // HydraFunctions.normalizeFunctions (hydra-functions.js loads
    // after this file, so the deep pass runs when the module is
    // present and the light repair covers the rest; the module owns
    // deep normalization).
    if (typeof window !== 'undefined' && window.HydraFunctions &&
        typeof window.HydraFunctions.normalizeFunctions === 'function') {
      project.functions = window.HydraFunctions.normalizeFunctions(project.functions);
    } else if (!Array.isArray(project.functions)) {
      project.functions = [];
    }

    const hasGlobalGrid = project.globalGridData && Object.keys(project.globalGridData).length > 0;
    const hasGlobalLogic = project.logicGrids.global && Object.keys(project.logicGrids.global).length > 0;
    if (!hasGlobalGrid && hasGlobalLogic) project.globalGridData = project.logicGrids.global;
    if (!project.globalGridData) project.globalGridData = {};
    if (!hasGlobalLogic) project.logicGrids.global = project.globalGridData;
    // A damaged grid (a string, a number) repairs to empty, and the alias
    // is re-pointed at the repaired object either way.
    project.globalGridData = asPlainObject(project.globalGridData);
    project.logicGrids.global = project.globalGridData;

    project.scenes = asArray(project.scenes);
    project.scenes.forEach(scene => normalizeScene(scene, project));
    rebuildProjectEventSheets(project);
    return project;
  }

  function normalizeScene(scene, project = null) {
    if (!scene || typeof scene !== 'object') return scene;
    scene.objects = asArray(scene.objects);
    scene.entities = scene.entities || scene.objects;
    scene.logicGrids = asPlainObject(scene.logicGrids);
    const hasSceneGrid = scene.gridData && Object.keys(scene.gridData).length > 0;
    const hasSceneLogic = scene.logicGrids.main && Object.keys(scene.logicGrids.main).length > 0;
    if (!hasSceneGrid && hasSceneLogic) scene.gridData = scene.logicGrids.main;
    if (!scene.gridData) scene.gridData = {};
    if (!hasSceneLogic) scene.logicGrids.main = scene.gridData;
    // Same repair as the project-level alias: a damaged grid becomes
    // empty, and the alias points at the repaired object either way.
    scene.gridData = asPlainObject(scene.gridData);
    scene.logicGrids.main = scene.gridData;
    // P4 item 3D1 (3D rendering foundation): per-scene 2D/3D render mode
    // plus the 3D camera. '2d' is the default, so every existing scene
    // keeps rendering exactly as before. Defensive: hydra-3d.js may load
    // after this file; the repair is idempotent so a later pass works.
    try {
      if (typeof window !== 'undefined' && window.Hydra3d) {
        scene.renderMode = window.Hydra3d.normalizeRenderMode(scene.renderMode);
        scene.camera3d = window.Hydra3d.normalizeCamera3d(scene.camera3d, scene);
      } else {
        if (scene.renderMode !== '3d') scene.renderMode = '2d';
        if (!scene.camera3d || typeof scene.camera3d !== 'object') scene.camera3d = {};
      }
    } catch (e) { /* never break normalization */ }
    // P4 Advanced (2D lighting): scene darkness + tint (0 = fully lit,
    // so every existing scene keeps rendering exactly as before).
    try {
      if (typeof window !== 'undefined' && window.HydraLight2d &&
          typeof window.HydraLight2d.normalizeSceneDarkness === 'function') {
        window.HydraLight2d.normalizeSceneDarkness(scene);
      } else {
        if (typeof scene.darkness !== 'number' || !isFinite(scene.darkness)) scene.darkness = 0;
        if (typeof scene.darknessColor !== 'string' || !/^#([0-9a-fA-F]{6})$/.test(scene.darknessColor)) scene.darknessColor = '#000000';
      }
    } catch (e) { /* never break normalization */ }
    // P4 Advanced batch 15 (camera feel): per-scene follow
    // smoothing + deadzone + camera bounds (0 = snap, so every
    // existing scene keeps following exactly as before). Defensive:
    // hydra-camerafeel.js may load after this file; the repair is
    // idempotent so a later pass works.
    try {
      if (typeof window !== 'undefined' && window.HydraCameraFeel &&
          typeof window.HydraCameraFeel.normalizeCameraFeel === 'function') {
        scene.cameraFeel = window.HydraCameraFeel.normalizeCameraFeel(scene.cameraFeel);
      } else if (!scene.cameraFeel || typeof scene.cameraFeel !== 'object') {
        scene.cameraFeel = { smoothing: 0, deadzoneW: 0, deadzoneH: 0, bounds: null };
      }
    } catch (e) { /* never break normalization */ }
    // P4 Advanced batch 36 (minimap): per-scene corner map (off by
    // default, so every existing scene keeps rendering exactly as
    // before). Defensive: hydra-minimap.js may load after this file;
    // the repair is idempotent so a later pass works.
    try {
      if (typeof window !== 'undefined' && window.HydraMinimap &&
          typeof window.HydraMinimap.normalizeMinimapConfig === 'function') {
        scene.minimap = window.HydraMinimap.normalizeMinimapConfig(scene.minimap);
      } else if (!scene.minimap || typeof scene.minimap !== 'object') {
        scene.minimap = { enabled: false, corner: 'top-right', size: 160, zoom: 1, showViewport: true };
      }
    } catch (e) { /* never break normalization */ }
    scene.layers = Array.isArray(scene.layers) ? scene.layers : [
      { id: 'world2d', name: 'World 2D', space: '2d', visible: true },
      { id: 'ui', name: 'UI', space: 'ui', visible: true },
      { id: 'world3d', name: 'World 3D', space: '3d', visible: true }
    ];
    scene.eventSheets = asArray(scene.eventSheets);
    scene.objects.forEach(obj => normalizeObject(obj));
    scene.entities = scene.objects;
    if (project && project.logicGrids && typeof project.logicGrids === 'object') {
      project.logicGrids[String(scene.id)] = scene.gridData;
    }
    return scene;
  }

  // Produce a save-safe copy of a project with alias duplicates stripped.
  // In memory, normalizeProject/normalizeScene keep several aliases pointing
  // at the same objects (logicGrids.global === globalGridData,
  // scene.logicGrids.main === scene.gridData,
  // project.logicGrids[sceneId] === scene.gridData,
  // scene.entities === scene.objects). Serializing those as-is stores every
  // scene's scripts ~3x and objects ~2x. project/scene.eventSheets are fully
  // derived from the grids (rebuilt by normalizeProject on load) and are
  // stripped as well. The canonical fields are globalGridData, scene.gridData
  // and scene.objects; dropping the rest here is lossless.
  function serializeProject(project) {
    if (!project || typeof project !== 'object') return project;
    let clone;
    try {
      clone = JSON.parse(JSON.stringify(project));
    } catch (e) {
      // P1 item 16: a project with circular references cannot be cloned;
      // return it unchanged so the save path can report the failure
      // instead of dying inside the serializer.
      return project;
    }
    clone.eventSheets = [];
    (clone.scenes || []).forEach(scene => {
      delete scene.entities;
      scene.eventSheets = [];
      if (scene.logicGrids && typeof scene.logicGrids === 'object') {
        delete scene.logicGrids.main;
      }
    });
    if (clone.logicGrids && typeof clone.logicGrids === 'object') {
      delete clone.logicGrids.global;
      (clone.scenes || []).forEach(scene => {
        delete clone.logicGrids[String(scene.id)];
      });
    }
    return clone;
  }

  function normalizeObject(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    obj.kind = obj.kind || 'sprite';
    obj.tags = Array.isArray(obj.tags) ? obj.tags : [];
    // P4 Advanced batch 34 (object tags): per-object tag lists
    // (trimmed, deduped case-insensitively, at most 16). Defensive,
    // same shape as the parallax repair below: hydra-tags.js may
    // load after this file, and old projects keep their tags, so
    // nothing they shipped changes.
    try {
      if (typeof window !== 'undefined' && window.HydraTags &&
          typeof window.HydraTags.normalizeTagsOn === 'function') {
        window.HydraTags.normalizeTagsOn(obj);
      }
    } catch (e) { /* never break normalization */ }
    // P1 item 16: a damaged record (a string where an object belongs)
    // repairs to the empty default instead of throwing on the first
    // property write below.
    obj.variables = asPlainObject(obj.variables);
    obj.effects = Array.isArray(obj.effects) ? obj.effects : [];
    obj.components = Array.isArray(obj.components) ? obj.components : [];
    obj.children = Array.isArray(obj.children) ? obj.children : [];
    obj.collision = asPlainObject(obj.collision);
    if (typeof obj.collision.enabled !== 'boolean') {
      obj.collision.enabled = obj.kind !== 'text' && obj.kind !== 'panel' && obj.uiPinned !== true &&
        !(typeof window !== 'undefined' && window.Hydra3d && (window.Hydra3d.is3dKind(obj.kind) || window.Hydra3d.isLight3d(obj.kind))) &&
        !(typeof window !== 'undefined' && window.HydraLight2d && window.HydraLight2d.isLight2d(obj.kind));
    }
    // P4 item 3D5: legacy light placeholders (2D sprites) promote to the
    // real light3d kind before any 3D normalization runs.
    try {
      if (typeof window !== 'undefined' && window.Hydra3d &&
          typeof window.Hydra3d.migrateLegacyLight3d === 'function') {
        window.Hydra3d.migrateLegacyLight3d(obj);
      }
    } catch (e) { /* never break normalization */ }
    // P4 item 3D1 (3D rendering foundation): z-depth position, depth size,
    // and rotation fields. Old projects have no 3D objects, so nothing
    // they shipped changes.
    try {
      if (typeof window !== 'undefined' && window.Hydra3d &&
          typeof window.Hydra3d.normalizeObject3d === 'function' &&
          (window.Hydra3d.is3dKind(obj.kind) || window.Hydra3d.isLight3d(obj.kind))) {
        window.Hydra3d.normalizeObject3d(obj);
      }
    } catch (e) { /* never break normalization */ }
    // P4 Advanced (2D lighting): 2D light records + shadow flags.
    // Guarded away from 3D lights (their `light` record has a different
    // shape) and defensive about load order, like the 3D pass above.
    try {
      if (typeof window !== 'undefined' && window.HydraLight2d &&
          typeof window.HydraLight2d.normalizeLight2d === 'function' &&
          (window.HydraLight2d.isLight2d(obj.kind) ||
            (obj.light && typeof obj.light === 'object' &&
              !(window.Hydra3d && (window.Hydra3d.isLight3d(obj.kind) || window.Hydra3d.is3dKind(obj.kind)))))) {
        window.HydraLight2d.normalizeLight2d(obj);
      }
    } catch (e) { /* never break normalization */ }
    // F2 (menus & HUD): anchor layout, HUD layer, button/panel styling.
    // Defensive: hydra-ui.js may load after this file; normalizeUiFields is
    // idempotent so a later pass also works.
    try {
      if (typeof window !== 'undefined' && window.HydraUi && typeof window.HydraUi.normalizeUiFields === 'function') {
        window.HydraUi.normalizeUiFields(obj);
      } else {
        if (obj.anchor === undefined) obj.anchor = 'none';
        if (obj.hud === undefined) obj.hud = false;
      }
    } catch (e) { /* never break normalization */ }
    // P4 item 31 (tilemaps): repair tile fields and keep width/height in
    // sync with cols/rows * tileSize. Defensive: hydra-tiles.js may load
    // after this file; applyToObject is idempotent so a later pass works.
    try {
      if (obj.kind === 'tilemap' && typeof window !== 'undefined' && window.HydraTiles &&
          typeof window.HydraTiles.applyToObject === 'function') {
        window.HydraTiles.applyToObject(obj);
      }
    } catch (e) { /* never break normalization */ }
    // P4 item 32 (physics upgrade): circle/solid/trigger/one-way/layers.
    // Defensive: hydra-physics2d.js may load after this file; the repair
    // is idempotent and old projects keep classic box/solid behavior.
    try {
      if (typeof window !== 'undefined' && window.HydraPhysics2D &&
          typeof window.HydraPhysics2D.normalizePhysics2d === 'function') {
        window.HydraPhysics2D.normalizePhysics2d(obj);
      }
    } catch (e) { /* never break normalization */ }
    ensureComponent(obj, 'Transform', {
      x: Number(obj.posX) || 0,
      y: Number(obj.posY) || 0,
      width: Number(obj.width) || 1,
      height: Number(obj.height) || 1,
      rotation: Number(obj.rotation) || 0
    });
    // P4 item 37 (block expansion, batch 1: sprite transforms): visual flip
    // and scale factors. scaleX/scaleY multiply the drawn size (1 = normal);
    // flipH/flipV mirror the drawing. Old projects keep 1/false, so nothing
    // they shipped changes. Collision keeps using width/height — scale and
    // flip are drawing-only by design.
    const nScaleX = Number(obj.scaleX), nScaleY = Number(obj.scaleY);
    obj.scaleX = Number.isFinite(nScaleX) ? nScaleX : 1;
    obj.scaleY = Number.isFinite(nScaleY) ? nScaleY : 1;
    obj.flipH = obj.flipH === true;
    obj.flipV = obj.flipV === true;
    // P4 Advanced batch 16 (parallax backgrounds): per-object scroll
    // factors (1 = world speed, the old behavior). Defensive:
    // hydra-parallax.js may load after this file; the repair is
    // idempotent and old projects keep factor 1, so nothing they
    // shipped changes. Drawing-only, like flip/scale.
    try {
      if (typeof window !== 'undefined' && window.HydraParallax &&
          typeof window.HydraParallax.normalizeParallax === 'function') {
        window.HydraParallax.normalizeParallax(obj);
      }
    } catch (e) { /* never break normalization */ }
    // P4 Advanced batch 21 (health & damage): per-object hit points
    // (100 / 100 with the bar off). Defensive, same shape as the
    // parallax repair above: hydra-health.js may load after this
    // file, and old projects keep full health, so nothing they
    // shipped changes.
    try {
      if (typeof window !== 'undefined' && window.HydraHealth &&
          typeof window.HydraHealth.normalizeHealth === 'function') {
        window.HydraHealth.normalizeHealth(obj);
      }
    } catch (e) { /* never break normalization */ }
    // P4 Advanced batch 26 (movement abilities): per-object jump
    // config (one jump, no coyote, no buffer). Defensive, same shape
    // as the health repair above: hydra-movement.js may load after
    // this file, and old projects keep a single jump, so nothing they
    // shipped changes.
    try {
      if (typeof window !== 'undefined' && window.HydraMovement &&
          typeof window.HydraMovement.normalizeMovementConfig === 'function' &&
          obj.movement && typeof obj.movement === 'object') {
        window.HydraMovement.normalizeMovementConfig(obj.movement);
      }
    } catch (e) { /* never break normalization */ }
    // P4 Advanced batch 27 (moving platforms & one-way platforms):
    // per-object platform config (not a platform). Defensive, same
    // shape as the movement repair above: hydra-platform.js may load
    // after this file, and old projects keep ordinary floors, so
    // nothing they shipped changes. The one-way flag merges across
    // the config and the physics record.
    try {
      if (typeof window !== 'undefined' && window.HydraPlatform &&
          typeof window.HydraPlatform.normalizePlatformConfig === 'function' &&
          obj.platform && typeof obj.platform === 'object') {
        window.HydraPlatform.normalizePlatformConfig(obj.platform, obj);
      }
    } catch (e) { /* never break normalization */ }
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

  // P5-7: the row cap is gone here too — the grid is 60 columns wide
  // but rows are unbounded, exactly like HydraFlow.adjacentIndexes
  // (the one flow module; this diagnostics copy mirrors it because
  // hydra-universal.js loads before hydra-flow.js and is required
  // standalone in node tests, so it cannot import the module — keep
  // the two in sync). A capped copy used to make the diagnostics view
  // drop every neighbour past row 60, so a tall grid's `and` looked
  // unconnected in the diagnostics while it ran fine.
  function adjacentIndexes(index) {
    const row = Math.floor(index / 60);
    const col = index % 60;
    return [
      [row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]
    ].filter(([r, c]) => r >= 0 && c >= 0 && c < 60).map(([r, c]) => r * 60 + c);
  }

  function rebuildProjectEventSheets(project) {
    const sheets = [];
    sheets.push({
      id: 'global',
      name: 'Global Events',
      scope: 'global',
      events: gridToEventRows(project.globalGridData || project.logicGrids?.global || {})
    });
    // P1 item 16: damaged scene entries are skipped, not dereferenced.
    asArray(project.scenes).forEach(scene => {
      if (!scene || typeof scene !== 'object') return;
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
      readTextIntoVariable: `Read text of ${data.targetObject || 'text object'} into ${data.storeVarName || 'variable'}`,
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

  // P3 item 18 — block validation. Field roles come from two sources:
  //   (a) the declarative block catalog (HydraBlockCatalog, when loaded):
  //       fields with control 'object' name an object, 'expr' hold a
  //       numeric expression, 'scene' names a scene;
  //   (b) LEGACY_FIELDS below, for the core block types the catalog does
  //       not cover (collision, switchScene, applyForce, ...). A type in
  //       neither source has no checkable fields and is skipped.
  // A collections block whose valueKind is 'text' or 'variable' holds
  // plain text in its value field, not an expression — that field is
  // skipped for syntax checking.
  const LEGACY_FIELDS = {
    collision: { objects: ['object1', 'object2'] },
    overlapTouch: { objects: ['object1', 'object2'] },
    onEdge: { objects: ['targetObject'] },
    applyForce: { objects: ['targetObject'], exprs: ['forceX', 'forceY'] },
    teleport: { objects: ['targetObject'], exprs: ['toX', 'toY'] },
    destroyObject: { objects: ['targetObject'] },
    showHide: { objects: ['targetObject'] },
    playAnimation: { objects: ['targetObject'] },
    setAnimation: { objects: ['targetObject'] },
    stopAnimation: { objects: ['targetObject'] },
    animationFinished: { objects: ['targetObject'] },
    setAnimState: { objects: ['targetObject'] },
    animStateIs: { objects: ['targetObject'] },
    setBlend: { objects: ['targetObject'], exprs: ['blendX', 'blendY'] },
    stopBlend: { objects: ['targetObject'] },
    blendActive: { objects: ['targetObject'] },
    tweenProperty: { objects: ['targetObject'], exprs: ['toValue'] },
    stopTween: { objects: ['targetObject'] },
    tweenFinished: { objects: ['targetObject'] },
    switchScene: { scenes: ['sceneId'] },
    setText: { objects: ['targetObject'] },
    setSize: { objects: ['targetObject'], exprs: ['width', 'height'] },
    setVelocity: { objects: ['targetObject'], exprs: ['velX', 'velY'] },
    spawnObject: { objects: ['sourceObject'], exprs: ['spawnX', 'spawnY'] },
    rotateObject: { objects: ['targetObject'], exprs: ['angle'] },
    randomVariable: { exprs: ['min', 'max'] },
    forceToward: { objects: ['targetObject', 'sourceObject'], exprs: ['speed'] }
  };

  function catalogFieldRoles() {
    const roles = {};
    const blocks = global.HydraBlockCatalog && global.HydraBlockCatalog.blocks;
    if (!Array.isArray(blocks)) return roles;
    blocks.forEach(b => {
      if (!b || typeof b.runtimeType !== 'string') return;
      const entry = roles[b.runtimeType] || (roles[b.runtimeType] = { objects: [], exprs: [], scenes: [] });
      (Array.isArray(b.fields) ? b.fields : []).forEach(f => {
        if (!f || typeof f.key !== 'string') return;
        if (f.control === 'object' && entry.objects.indexOf(f.key) === -1) entry.objects.push(f.key);
        else if (f.control === 'expr' && entry.exprs.indexOf(f.key) === -1) entry.exprs.push(f.key);
        else if (f.control === 'scene' && entry.scenes.indexOf(f.key) === -1) entry.scenes.push(f.key);
      });
    });
    return roles;
  }

  function collectProjectDiagnostics(project) {
    const out = [];
    const push = (level, message, scope, index) => {
      if (out.length >= 100) return;
      out.push({ level, message, scope: scope || '', index: index == null ? '' : index });
    };
    const roles = catalogFieldRoles();
    const validateSyntax = global.HydraExpr && typeof global.HydraExpr.validateSyntax === 'function'
      ? global.HydraExpr.validateSyntax : null;
    const scenes = asArray(project && project.scenes);
    const sceneIds = new Set();
    const allObjectNames = new Set();
    scenes.forEach(scene => {
      if (!scene || typeof scene !== 'object') return;
      if (scene.id != null) sceneIds.add(scene.id);
      asArray(scene.objects).forEach(o => {
        if (o && typeof o.name === 'string' && o.name) allObjectNames.add(o.name);
      });
    });
    // P5-3 slice b: the project's function names, for the
    // callFunction check in scan — calls name functions, not scenes.
    const functionNames = new Set();
    asArray(project && project.functions).forEach(fn => {
      if (fn && typeof fn.name === 'string' && fn.name) functionNames.add(fn.name);
    });
    const scan = (scopeName, scopeLabel, grid, names, opts) => {
      const isFunctionScope = !!(opts && opts.isFunctionScope);
      const entries = (grid && typeof grid === 'object') ? Object.entries(grid) : [];
      entries.forEach(([index, data]) => {
        if (!data || typeof data !== 'object') {
          if (data != null) push('warning', `Empty logic block at ${scopeLabel}:${index}`, scopeName, index);
          return;
        }
        if (!data.type) {
          push('warning', `Empty logic block at ${scopeLabel}:${index}`, scopeName, index);
          return;
        }
        if (data.type === 'comment') return;
        if (data.type === 'onTimer' && !String(data.timerName || '').trim()) {
          push('info', `Timer at ${scopeLabel}:${index} is unnamed; it will be scoped to that block.`, scopeName, index);
        }
        // P5-3 slice b: a call names a function, and a Return only
        // works inside a function body — both are static mistakes
        // the diagnostics panel can catch before the game runs.
        if (data.type === 'callFunction') {
          const called = String(data.functionName || '').trim();
          if (!called) {
            push('info', `Call Function at ${scopeLabel}:${index} has no function picked; it will do nothing.`, scopeName, index);
          } else if (!functionNames.has(called)) {
            push('warning', `Block ${index} (callFunction) in ${scopeLabel} calls function "${called}", which does not exist.`, scopeName, index);
          }
        }
        if (data.type === 'returnFromFunction' && !isFunctionScope) {
          push('warning', `Block ${index} (returnFromFunction) in ${scopeLabel} only works inside a function body.`, scopeName, index);
        }
        const r = roles[data.type] || LEGACY_FIELDS[data.type];
        if (!r) return;
        (r.objects || []).forEach(f => {
          const v = data[f];
          if (typeof v === 'string' && v && !names.has(v)) {
            push('warning', `Block ${index} (${data.type}) in ${scopeLabel} names object "${v}", which is not in this scene.`, scopeName, index);
          }
        });
        (r.scenes || []).forEach(f => {
          const v = data[f];
          if (v != null && v !== '' && !sceneIds.has(v)) {
            push('warning', `Block ${index} (${data.type}) in ${scopeLabel} switches to scene "${v}", which does not exist.`, scopeName, index);
          }
        });
        if (validateSyntax) {
          (r.exprs || []).forEach(f => {
            if (f === 'value' && (data.valueKind === 'text' || data.valueKind === 'variable')) return;
            const v = data[f];
            if (typeof v !== 'string' || !v.trim()) return;
            const res = validateSyntax(v);
            if (!res.ok) {
              push('warning', `Block ${index} (${data.type}) in ${scopeLabel} has an expression that will not run: "${v}" (${res.error}).`, scopeName, index);
            }
          });
        }
      });
    };
    // The global grid runs in every scene, so a name that exists in any
    // scene counts as valid there; a scene grid only sees its own objects.
    scan('global', 'Global', project && project.globalGridData, allObjectNames);
    // P1 item 16: damaged scene entries are skipped, not dereferenced.
    scenes.forEach(scene => {
      if (!scene || typeof scene !== 'object') return;
      const names = new Set();
      asArray(scene.objects).forEach(o => {
        if (o && typeof o.name === 'string' && o.name) names.add(o.name);
      });
      scan(scene.name || scene.id, scene.name || String(scene.id), scene.gridData || {}, names);
    });
    // P5-3 slice b: function body grids are validated like any other
    // grid. A body runs in every scene's context, so a name that
    // exists in any scene counts as valid there, the way the global
    // grid works; the scope label reads "Function <name>" so the
    // finding says where the block lives.
    asArray(project && project.functions).forEach(fn => {
      if (!fn || typeof fn !== 'object' || !fn.grid) return;
      scan('function:' + (fn.id || fn.name || '?'), 'Function ' + (fn.name || fn.id || '?'),
        fn.grid, allObjectNames, { isFunctionScope: true });
    });
    return out;
  }

  // P3 item 18: refresh the validation findings in the live diagnostics
  // feed. Old validation entries are removed first so a fixed block
  // clears its warning; runtime diagnostics are left alone.
  function runBlockValidation(project) {
    for (let i = diagnostics.length - 1; i >= 0; i--) {
      if (diagnostics[i].source && diagnostics[i].source.kind === 'validation') diagnostics.splice(i, 1);
    }
    const found = collectProjectDiagnostics(project);
    found.forEach(d => pushDiagnostic(d.level || 'warning', d.message,
      { kind: 'validation', scope: d.scope || '', index: d.index === '' ? '' : d.index }));
    renderDiagnostics();
    return found;
  }

  function renderDiagnostics() {
    // P3 item 18: node test sandboxes have no document; validation runs
    // there too, so the DOM half is a no-op outside a browser.
    if (typeof document === 'undefined') return;
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

  // F1 polish: wire the diagnostics dock collapse toggle. index.html ships
  // #diagnostics-toggle but nothing ever bound it, so the always-open dock
  // covered the bottom of the side panel (e.g. the Clear Grid button) and
  // could not be moved. Defensive: node test sandboxes stub document, and
  // home.html has no dock at all.
  try {
    const diagnosticsDock = typeof document !== 'undefined' && document.getElementById('diagnostics-dock');
    const diagnosticsToggle = typeof document !== 'undefined' && document.getElementById('diagnostics-toggle');
    if (diagnosticsDock && diagnosticsToggle && diagnosticsToggle.dataset &&
        !diagnosticsToggle.dataset.hydraBound &&
        typeof diagnosticsToggle.addEventListener === 'function' &&
        diagnosticsDock.classList) {
      diagnosticsToggle.dataset.hydraBound = '1';
      diagnosticsToggle.setAttribute('aria-expanded', 'true');
      diagnosticsToggle.addEventListener('click', () => {
        const collapsed = diagnosticsDock.classList.toggle('is-collapsed');
        diagnosticsToggle.setAttribute('aria-expanded', String(!collapsed));
      });
    }
  } catch (e) { /* non-DOM environment: dock toggle is a browser-only nicety */ }

  // ============================================================
  // FACTORIES — P2 item 13/10 (core behind a firewall)
  //
  // The core is the ONLY place that builds project/scene/object
  // records from scratch. Every construction site (editor New Scene
  // and Add Object, New Project in the editor and the hub, starter
  // templates) routes through these three functions, so a record can
  // never enter the store unnormalized: each factory returns its
  // record through the matching normalizer. Callers that already own
  // an id counter (the editor's nextSceneId/nextObjectId, the hub's
  // generateId) pass the id in; when no id is given the factory
  // mints one from a module counter seeded at Date.now(), the same
  // convention script.js used for nextObjectId. Overrides win over
  // the defaults, and an explicit `undefined` never clobbers one.
  // Nothing here touches the DOM and nothing ever throws: hostile
  // input degrades to the defaults.
  // ============================================================
  let factorySeq = 0;
  function nextFactoryId() { return Date.now() + (factorySeq++); }

  function stripUndefined(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    const out = {};
    Object.keys(obj).forEach(k => { if (obj[k] !== undefined) out[k] = obj[k]; });
    return out;
  }

  // Project ids are the same random-hex shape generateId() in
  // project.js/home.js produces, so factory-made projects sort and
  // compare exactly like editor-made ones.
  function generateProjectId() {
    return Math.random().toString(16).slice(2) + Date.now().toString(16);
  }

  // One scene, the shape script.js createScene() used to build by
  // hand. The name default is deliberately plain: callers that
  // number scenes ("Scene 3") pass the name in.
  function createScene(options) {
    const opts = stripUndefined(options);
    const scene = Object.assign({
      id: nextFactoryId(),
      name: 'New Scene',
      objects: [],
      bgColor: '#ffffff',
      bgAssetId: null,
      width: 800, height: 600,
      worldWidth: 800, worldHeight: 600,
      viewportWidth: 800, viewportHeight: 600,
      gridData: {},
      logicGrids: { main: {} },
      eventSheets: []
    }, opts);
    return normalizeScene(scene);
  }

  // One object of the requested kind, with the kind-default table
  // script.js addGameObject() used to carry inline (sizes, display
  // names, colors, 3D fields, text fields, light records). The
  // requested kind is kept as `archetype`; the stored `kind` follows
  // the editor's mapping (button -> text, empty/camera3d -> sprite).
  // A requested 'light' is NOT resolved here — the editor maps it to
  // light3d/light2d from the scene's render mode before calling.
  // posX/posY are the final top-left; callers that center on a click
  // point adjust them after the call (and sync the Transform
  // component's stored x/y, which normalizeObject snapshots here).
  function createObject(kind, options) {
    const k = typeof kind === 'string' && kind ? kind : 'sprite';
    const opts = stripUndefined(options);
    const has3d = typeof window !== 'undefined' && window.Hydra3d;
    const is3d = has3d && typeof window.Hydra3d.is3dKind === 'function' &&
      window.Hydra3d.is3dKind(k) === true;
    const isLight = has3d && typeof window.Hydra3d.isLight3d === 'function' &&
      window.Hydra3d.isLight3d(k) === true;
    const isLight2d = typeof window !== 'undefined' && window.HydraLight2d &&
      typeof window.HydraLight2d.isLight2d === 'function' &&
      window.HydraLight2d.isLight2d(k) === true;
    let width = 60, height = 60;
    if (k === 'empty') { width = 34; height = 34; }
    if (k === 'text' || k === 'button') { width = 160; height = k === 'button' ? 42 : 32; }
    if (k === 'panel') { width = 320; height = 200; }
    if (k === 'tilemap') { width = 320; height = 320; }
    if (k === 'camera3d' || k === 'light3d' || k === 'light2d') { width = 54; height = 54; }
    // P4 item 3D1: 3D primitives get a default depth (size along z) so
    // they render as real volumes immediately; the plane stays thin.
    let depth = 64;
    if (k === 'plane3d') { width = 160; height = 120; depth = 4; }
    if (k === 'sphere3d' || k === 'cylinder3d') { width = 64; height = 64; depth = 64; }
    if (k === 'box3d') { width = 80; height = 80; depth = 80; }
    // P4 item 3D2: model3d objects start as a 120-unit cube; the
    // uploaded model is fitted into the Width/Height/Depth box.
    if (k === 'model3d') { width = 120; height = 120; depth = 120; }
    const obj = Object.assign({
      id: nextFactoryId(),
      name: k === 'empty' ? 'Entity' : k === 'button' ? 'Button' : k === 'panel' ? 'Panel' :
        k === 'tilemap' ? 'Tilemap' : k === 'camera3d' ? 'Camera3D' :
        k === 'light3d' || k === 'light2d' ? 'Light' :
        is3d ? (k === 'box3d' ? 'Box3D' : k === 'sphere3d' ? 'Sphere3D' :
          k === 'plane3d' ? 'Plane3D' : k === 'cylinder3d' ? 'Cylinder3D' :
          k === 'model3d' ? 'Model3D' : '') : '',
      kind: k === 'button' ? 'text' : k === 'panel' ? 'panel' :
        k === 'empty' || k === 'camera3d' ? 'sprite' : k,
      archetype: k,
      posX: 0, posY: 0,
      width, height,
      // P4 item 3D1: 3D primitives start on the screen plane (z 0) with
      // no rotation; normalizeObject fills any missing 3D fields below.
      // P4 item 3D5: light3d is a real 3D kind now (invisible,
      // non-physical); it keeps a Z depth position and Rot X / Rot Y
      // to aim directional lights, but no depth size.
      z: (is3d || isLight) ? 0 : undefined,
      depth: is3d ? depth : undefined,
      rotX: (is3d || isLight) ? 0 : undefined,
      rotY: (is3d || isLight) ? 0 : undefined,
      rotZ: (is3d || isLight) ? 0 : undefined,
      velX: 0, velY: 0,
      rotation: 0,
      color: k === 'camera3d' ? '#38bdf8' : k === 'light3d' ? '#fde047' : k === 'light2d' ? '#fde047' :
        k === 'box3d' ? '#38bdf8' : k === 'sphere3d' ? '#f472b6' : k === 'plane3d' ? '#a3e635' :
        k === 'cylinder3d' ? '#fbbf24' : k === 'model3d' ? '#94a3b8' :
        k === 'empty' ? '#64748b' : k === 'panel' ? '#1e293b' : '#4488ff',
      // P4 item 3D2: model3d fields — the picked model asset and its tint.
      modelAssetId: k === 'model3d' ? null : undefined,
      materialColor: is3d ? '#ffffff' : undefined,
      // P4 item 3D5: real light objects carry their light fields (the
      // old unwired Light component is superseded; legacy sprite
      // placeholders are promoted by migrateLegacyLight3d on load).
      light: isLight ? { type: 'point', color: '#ffffff', intensity: 1, range: 600, enabled: true } :
        isLight2d ? { enabled: true, radius: 220, color: '#ffffff', intensity: 1 } : undefined,
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
      uiPinned: k === 'text' || k === 'button' || k === 'panel',
      // F2: menus & HUD layout. Anchors pin a widget to a screen
      // point; hud draws it last, on top of everything,
      // camera-independent.
      anchor: 'none',
      hud: k === 'panel',
      cornerRadius: k === 'button' ? 8 : k === 'panel' ? 12 : 0,
      // Keep in sync with DEFAULT_PHYSICS in script.js.
      physics: { gravity: 0, friction: 0.82, bounciness: 0.4, maxSpeed: 25 },
      // text
      text: k === 'text' ? 'Text' : k === 'button' ? 'Button' : null,
      fontSize: k === 'text' || k === 'button' ? 24 : null,
      fontFamily: k === 'text' ? 'sans-serif' : null,
      textColor: k === 'button' ? '#ffffff' : k === 'text' ? '#111827' : null,
      textAlign: k === 'button' ? 'center' : k === 'text' ? 'left' : null,
      bold: false,
      italic: false
    }, opts);
    // The hitbox tracks the size: a caller that overrides width/height
    // gets a matching hitbox, unless it overrides the hitbox itself.
    if (opts.hitboxWidth === undefined) obj.hitboxWidth = obj.width;
    if (opts.hitboxHeight === undefined) obj.hitboxHeight = obj.height;
    return normalizeObject(obj);
  }

  // One project. When no scenes are given, the project opens with a
  // single empty Scene 1 (the blank-project shape). Extra fields pass
  // straight through, so template flags (tutorial, playableRuntime,
  // fpsConfig) ride along unchanged.
  function createProject(options) {
    const opts = stripUndefined(options);
    const { id, idFactory, name, scenes: optScenes, currentSceneId,
      nextSceneId, activeScriptScope, assets, ...extra } = opts;
    const scenes = Array.isArray(optScenes) && optScenes.length
      ? optScenes
      : [createScene({ id: 1, name: 'Scene 1' })];
    const firstId = scenes[0] && scenes[0].id != null ? scenes[0].id : 1;
    const maxSceneId = Math.max(0, ...scenes.map(s => Number(s && s.id) || 0));
    const project = Object.assign({
      id: id != null ? id : (typeof idFactory === 'function' ? idFactory() : generateProjectId()),
      name: name || 'Untitled Project',
      dateCreated: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      eventsVersion: 1,
      globalGridData: {},
      logicGrids: { global: {} },
      eventSheets: [],
      scenes,
      currentSceneId: currentSceneId != null ? currentSceneId : firstId,
      nextSceneId: nextSceneId != null ? nextSceneId : maxSceneId + 1,
      activeScriptScope: activeScriptScope || 'global',
      sceneCount: scenes.length,
      assets: assets || {}
    }, stripUndefined(extra));
    return normalizeProject(project);
  }

  global.HydraUniversal = {
    COMPONENTS,
    COMPONENT_LIST,
    diagnostics,
    normalizeProject,
    normalizeScene,
    normalizeObject,
    serializeProject,
    createScene,
    createObject,
    createProject,
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
    runBlockValidation,
    pushDiagnostic,
    clearRuntimeDiagnostics,
    renderDiagnostics,
    inferAssetKind,
    normalizeAsset,
    normalizeAssets,
    ASSET_MAX_FILE_BYTES,
    ASSET_MAX_IMAGE_SIDE,
    validateUploadFile,
    downscaleDimensions,
    collectAssetUsage,
    collectAssetUsages,
    findUnusedAssets,
    removeAssetReferences,
    formatBytes
  };
})(window);
