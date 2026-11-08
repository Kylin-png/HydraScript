/* HydraGridModel — pure logic-grid data model for the editor.
 *
 * P2 item 14 (editor becomes a DOM-only module), slice 1: the logic grid
 * is HydraScript's signature scripting view, and its data layer lived
 * inline in script.js — scope rules, the 60x60 geometry, the stored-grid
 * read/write, and the default data record for a newly placed block.
 * This module owns all of that as pure functions. The editor (script.js)
 * keeps only the DOM half: the 3600 cell elements, the live stores
 * (scenes, globalGridData, cellData), the property panels, and the
 * preview runtime. Nothing here touches the DOM, window, or storage.
 *
 * Conventions (per the other hydra-*.js modules): nothing ever throws —
 * hostile input degrades to safe defaults — and every function that
 * takes project data treats it as untrusted (wrong types repair to
 * empty). Where this module deliberately differs from the old inline
 * code, the difference is noted at the function.
 *
 * Deliberate non-delegation: script.js keeps its own getAdjacentIndexes
 * (up, down, left, right order) for the preview runtime — the AND /
 * trigger-once merge order depends on it, so it belongs to the engine
 * extraction (P2 item 15/12), not to this module. adjacentIndexes here
 * uses reading order (right, down, left, up), matching HydraFlow.
 *
 * Follows the hydra-*.js factorySource pattern for export inlining.
 */
function hydraGridModelFactory() {
  'use strict';

  var GRID_COLS = 60;
  var GRID_ROWS = 60;
  var GRID_CELLS = GRID_COLS * GRID_ROWS;

  function isInteger(value) {
    return typeof value === 'number' && Number.isFinite(value) && Math.floor(value) === value;
  }

  // --- geometry -------------------------------------------------------
  // The grid is one flat 60x60 array, row-major: index = row * 60 + col.

  function isValidIndex(index) {
    return isInteger(index) && index >= 0 && index < GRID_CELLS;
  }

  function rowOf(index) {
    if (!isValidIndex(index)) return null;
    return Math.floor(index / GRID_COLS);
  }

  function colOf(index) {
    if (!isValidIndex(index)) return null;
    return index % GRID_COLS;
  }

  function indexOf(row, col) {
    if (!isInteger(row) || !isInteger(col)) return null;
    if (row < 0 || row >= GRID_ROWS || col < 0 || col >= GRID_COLS) return null;
    return row * GRID_COLS + col;
  }

  function rowStartIndex(row) {
    if (!isInteger(row) || row < 0 || row >= GRID_ROWS) return null;
    return row * GRID_COLS;
  }

  function rowEndIndex(row) {
    var start = rowStartIndex(row);
    return start === null ? null : start + GRID_COLS - 1;
  }

  // Orthogonal neighbours in reading order: right, down, left, up.
  // (Same order as HydraFlow.adjacentIndexes, so editor and runtime
  // agree on fan-out order. Invalid indexes yield [].)
  // P5-7: this copy stays bounded to the editor's visible 60x60 grid
  // on purpose — the editor renders exactly 3600 cells, so an index
  // past 3599 is not a cell here. Runtime flow over taller grids uses
  // HydraFlow.adjacentIndexes (no row cap); do not "fix" this one to
  // match it, or the editor model would report neighbours that have
  // no cell.
  function adjacentIndexes(index) {
    if (!isValidIndex(index)) return [];
    var row = rowOf(index), col = colOf(index);
    var out = [];
    if (col + 1 < GRID_COLS) out.push(index + 1);
    if (row + 1 < GRID_ROWS) out.push(index + GRID_COLS);
    if (col - 1 >= 0) out.push(index - 1);
    if (row - 1 >= 0) out.push(index - GRID_COLS);
    return out;
  }

  // Keyboard navigation over the grid: arrow keys move one cell (clamped
  // at the edges — no wrap), Home/End jump to the ends of the row. Any
  // other key, or an invalid start index, returns null (no move).
  function moveIndex(index, key) {
    if (!isValidIndex(index)) return null;
    var row = rowOf(index), col = colOf(index);
    switch (key) {
      case 'ArrowLeft': return col > 0 ? index - 1 : null;
      case 'ArrowRight': return col < GRID_COLS - 1 ? index + 1 : null;
      case 'ArrowUp': return row > 0 ? index - GRID_COLS : null;
      case 'ArrowDown': return row < GRID_ROWS - 1 ? index + GRID_COLS : null;
      case 'Home': return row * GRID_COLS;
      case 'End': return row * GRID_COLS + GRID_COLS - 1;
      default: return null;
    }
  }

  // --- scopes ---------------------------------------------------------
  // A scope is 'global', a scene id (number), or a function body
  // ('function:<id>', P5-3: functions / custom blocks — a function's
  // body grid is its own scope, edited on its own scope tab and run
  // only when Call Function names it). Anything else normalizes to
  // 'global', exactly as the editor always did. The function-id
  // pattern below mirrors HydraFunctions.normalizeFunctionId
  // (hydra-functions.js) so this module stays dependency-free.

  function normalizeScriptScope(scope) {
    if (scope === 'global') return 'global';
    if (typeof scope === 'string' && scope.indexOf('function:') === 0) {
      var fnId = scope.slice('function:'.length);
      if (/^[A-Za-z0-9_-]+$/.test(fnId)) return scope;
      return 'global';
    }
    var parsed = parseInt(scope, 10);
    return Number.isFinite(parsed) ? parsed : 'global';
  }

  // The function id for a function scope ('function:<id>'), or null
  // for any other scope.
  function functionIdOfScope(scope) {
    var normalized = normalizeScriptScope(scope);
    if (typeof normalized === 'string' && normalized.indexOf('function:') === 0) {
      return normalized.slice('function:'.length);
    }
    return null;
  }

  function sameScriptScope(a, b) {
    return normalizeScriptScope(a) === normalizeScriptScope(b);
  }

  function getScopeKey(scope) {
    return String(normalizeScriptScope(scope));
  }

  // --- grid data ------------------------------------------------------

  function cloneData(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function gridHasBlocks(gridData) {
    return Boolean(gridData && typeof gridData === 'object' && Object.keys(gridData).length);
  }

  function createGridData() {
    return {};
  }

  function findScene(store, scopeId) {
    var scenes = store && Array.isArray(store.scenes) ? store.scenes : [];
    for (var i = 0; i < scenes.length; i++) {
      if (scenes[i] && scenes[i].id === scopeId) return scenes[i];
    }
    return null;
  }

  // The function definition with the id, from a store shaped like
  // the editor's live state ({ functions: [...] } — the normalized
  // project.functions list). A non-array list has no functions.
  function findFunction(store, fnId) {
    var fns = store && Array.isArray(store.functions) ? store.functions : [];
    for (var i = 0; i < fns.length; i++) {
      if (fns[i] && fns[i].id === fnId) return fns[i];
    }
    return null;
  }

  // The stored grid object for a scope, from a store shaped like the
  // editor's live state: { scenes: [...], globalGridData: {...},
  // functions: [...] }.
  // - 'global' returns the store's global grid (created when missing).
  // - a scene scope returns that scene's gridData (created when missing).
  // - a function scope returns that function's body grid (created when
  //   missing, so the scope tab can edit a fresh function).
  // - an unknown scene id or function id returns a fresh {} that is NOT
  //   stored, so writes to it are lost — the editor's legacy behavior,
  //   kept so a dangling scope can never corrupt a scene or a function.
  // A null/non-object store yields a fresh {} instead of throwing.
  function getGridDataForScope(store, scope) {
    var normalizedScope = normalizeScriptScope(scope);
    if (normalizedScope === 'global') {
      if (!store || typeof store !== 'object') return {};
      if (!store.globalGridData || typeof store.globalGridData !== 'object') {
        store.globalGridData = {};
      }
      return store.globalGridData;
    }
    if (typeof normalizedScope === 'string') {
      var fn = findFunction(store, functionIdOfScope(normalizedScope));
      if (!fn) return {};
      if (!fn.grid || typeof fn.grid !== 'object') fn.grid = {};
      return fn.grid;
    }
    var scene = findScene(store, normalizedScope);
    if (!scene) return {};
    if (!scene.gridData || typeof scene.gridData !== 'object') scene.gridData = {};
    return scene.gridData;
  }

  // Map-like (the editor's live cellData Map) or plain-object cell data
  // as [key, value] pairs; anything else reads as empty.
  function entriesOf(cellData) {
    if (!cellData || typeof cellData !== 'object') return [];
    if (typeof cellData.forEach === 'function' && typeof cellData.get === 'function') {
      var out = [];
      cellData.forEach(function (v, k) { out.push([k, v]); });
      return out;
    }
    return Object.entries(cellData);
  }

  // Serializes live cell data into the plain stored form: string cell
  // indexes to deep-cloned block records. Non-integer keys are dropped
  // (the old inline save copied them verbatim; cell indexes are always
  // integers in practice, and a stray key must not survive a save).
  function gridDataFromMap(cellData) {
    var out = {};
    entriesOf(cellData).forEach(function (pair) {
      var idx = typeof pair[0] === 'number' ? pair[0] : parseInt(pair[0], 10);
      if (!Number.isFinite(idx)) return;
      out[String(idx)] = cloneData(pair[1]);
    });
    return out;
  }

  // Writes the editor's live cell map into the scope's stored grid,
  // clearing stale entries first. Scene scopes also refresh the
  // logicGrids.main alias (the normalizer's canonical grid pointer).
  // normalizeScene is an optional host hook (the editor passes
  // HydraUniversal.normalizeScene); when absent the alias is still set,
  // and a throwing hook is swallowed so a save can never break editing.
  // Returns true when the scope was written, false when the scene or
  // function is unknown (nothing is written then).
  function saveGridToScope(store, scope, cellData, normalizeScene) {
    var normalizedScope = normalizeScriptScope(scope);
    var scene = null;
    var fn = null;
    if (typeof normalizedScope === 'string' && normalizedScope !== 'global') {
      fn = findFunction(store, functionIdOfScope(normalizedScope));
      if (!fn) return false;
    } else if (normalizedScope !== 'global') {
      scene = findScene(store, normalizedScope);
      if (!scene) return false;
    }
    var target = getGridDataForScope(store, normalizedScope);
    Object.keys(target).forEach(function (k) { delete target[k]; });
    var fresh = gridDataFromMap(cellData);
    Object.keys(fresh).forEach(function (k) { target[k] = fresh[k]; });
    if (scene) {
      scene.logicGrids = scene.logicGrids && typeof scene.logicGrids === 'object' ? scene.logicGrids : {};
      scene.logicGrids.main = scene.gridData;
      if (typeof normalizeScene === 'function') {
        try { normalizeScene(scene); } catch (e) { /* advisory only */ }
      }
    }
    return true;
  }

  // Pure half of loading a scope into the editor: parses the stored grid
  // into [{ index, data }] pairs with cloned data, skipping keys that
  // are not integers. Out-of-range indexes are kept, matching the
  // editor's legacy load (its DOM loop skips cells that do not exist).
  // A null/non-object source yields [].
  function loadGridEntries(source) {
    if (!source || typeof source !== 'object') return [];
    var out = [];
    Object.entries(source).forEach(function (pair) {
      var idx = parseInt(pair[0], 10);
      if (!Number.isFinite(idx)) return;
      out.push({ index: idx, data: cloneData(pair[1]) });
    });
    return out;
  }

  // --- live cell map --------------------------------------------------
  // The editor's cellData is a Map keyed by cell index. placeBlock stores
  // a deep clone (later edits to the caller's record must not leak into
  // the grid); both reject invalid indexes instead of throwing.

  function placeBlock(cellData, index, data) {
    if (!cellData || typeof cellData.set !== 'function') return false;
    if (!isValidIndex(index)) return false;
    cellData.set(index, cloneData(data));
    return true;
  }

  function clearBlock(cellData, index) {
    if (!cellData || typeof cellData.delete !== 'function') return false;
    if (!isValidIndex(index)) return false;
    return cellData.delete(index);
  }

  // --- block defaults -------------------------------------------------
  // The legacy (non-catalog) block-type -> CSS class map. Catalog blocks
  // resolve through their own blockType; this table covers the core types
  // the catalog does not own.

  var LEGACY_BLOCK_CLASSES = {
    keyPressed: 'condition',
    keyJustPressed: 'condition',
    triggerOnce: 'trigger-once-condition',
    mouseClick: 'mouse-condition',
    applyForce: 'action',
    collision: 'advanced-condition',
    teleport: 'advanced-action',
    and: 'and-condition',
    setVariable: 'set-variable',
    getVariable: 'get-variable',
    destroyObject: 'destroy-object',
    showHide: 'show-hide',
    playSound: 'play-sound',
    playAnimation: 'play-animation',
    setAnimation: 'set-animation',
    stopAnimation: 'stop-animation',
    animationFinished: 'animation-finished-condition',
    setAnimState: 'set-anim-state',
    animStateIs: 'anim-state-condition',
    setBlend: 'set-blend',
    stopBlend: 'stop-blend',
    blendActive: 'blend-active-condition',
    tweenProperty: 'tween-property',
    stopTween: 'stop-tween',
    tweenFinished: 'tween-finished-condition',
    saveGame: 'save-game',
    loadGame: 'load-game',
    deleteSaveSlot: 'delete-save',
    saveSlotExists: 'save-slot-exists-condition',
    gameStart: 'game-start',
    switchScene: 'switch-scene',
    setText: 'set-text',
    setCamera: 'set-camera',
    followCamera: 'follow-camera',
    setSize: 'set-size',
    onTimer: 'timer-condition',
    onEdge: 'edge-condition',
    setVelocity: 'set-velocity',
    spawnObject: 'spawn-object',
    rotateObject: 'rotate-object',
    randomVariable: 'random-variable',
    overlapTouch: 'overlap-condition',
    forceToward: 'force-toward'
  };

  function blockClassForType(type, catalogBlocks) {
    if (typeof type !== 'string' || !type) return null;
    if (LEGACY_BLOCK_CLASSES[type]) return LEGACY_BLOCK_CLASSES[type];
    var list = Array.isArray(catalogBlocks) ? catalogBlocks : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].runtimeType === type) return list[i].blockType || null;
    }
    return null;
  }

  // The legacy core block-type -> default data table (same values the
  // editor used inline). Object fields come from the project's object
  // names: first = names[0], second = names[1] ('' when absent).
  function legacyDefaults(first, second, currentSceneId) {
    return {
      'condition': { key: 'ArrowRight', type: 'keyPressed', inputCondition: 'keyPressed', trigger: 'down', reversed: false },
      'mouse-condition': { button: 'left', type: 'mouseClick', mouseCondition: 'mouseButtonPressed', reversed: false },
      'advanced-condition': { type: 'collision', object1: first, object2: second, countTouchingEdges: true, reversed: false },
      'action': { forceX: 5, forceY: 0, type: 'applyForce', targetObject: first, reversed: false },
      'advanced-action': { type: 'teleport', toX: 300, toY: 200, targetObject: first, reversed: false },
      'and-condition': { type: 'and', reversed: false },
      'set-variable': { type: 'setVariable', varName: 'score', operation: 'set', value: 0 },
      'get-variable': { type: 'getVariable', varName: 'score', operator: '>=', compareValue: 1, reversed: false },
      'destroy-object': { type: 'destroyObject', targetObject: first },
      'show-hide': { type: 'showHide', targetObject: first, action: 'hide' },
      'play-sound': { type: 'playSound', assetId: '', frequency: 440, duration: 0.2, waveform: 'square', volume: 0.3, bus: 'sfx', pitch: 1 },
      'play-animation': { type: 'playAnimation', targetObject: first, animation: '' },
      'set-animation': { type: 'setAnimation', targetObject: first, animation: '' },
      'stop-animation': { type: 'stopAnimation', targetObject: first },
      'animation-finished-condition': { type: 'animationFinished', targetObject: first, animation: '', reversed: false },
      'set-anim-state': { type: 'setAnimState', targetObject: first, state: '' },
      'anim-state-condition': { type: 'animStateIs', targetObject: first, state: '', reversed: false },
      'set-blend': { type: 'setBlend', targetObject: first, blend: '', blendX: '0', blendY: '0' },
      'stop-blend': { type: 'stopBlend', targetObject: first, blend: '' },
      'blend-active-condition': { type: 'blendActive', targetObject: first, blend: '', reversed: false },
      'tween-property': { type: 'tweenProperty', targetObject: first, property: 'posX', toValue: '100', relative: true, duration: 0.6, easing: 'easeOut', repeat: 'once' },
      'stop-tween': { type: 'stopTween', targetObject: first, property: '' },
      'tween-finished-condition': { type: 'tweenFinished', targetObject: first, property: '', reversed: false },
      'save-game': { type: 'saveGame', slotName: 'Slot 1' },
      'load-game': { type: 'loadGame', slotName: 'Slot 1' },
      'delete-save': { type: 'deleteSaveSlot', slotName: 'Slot 1' },
      'save-slot-exists-condition': { type: 'saveSlotExists', slotName: 'Slot 1', reversed: false },
      'game-start': { type: 'gameStart', reversed: false },
      'switch-scene': { type: 'switchScene', sceneId: currentSceneId },
      'set-text': { type: 'setText', targetObject: first, value: 'Hello!', useVariable: false, varName: '' },
      'set-camera': { type: 'setCamera', cameraX: 0, cameraY: 0 },
      'follow-camera': { type: 'followCamera', targetObject: first, offsetX: 0, offsetY: 0 },
      'set-size': { type: 'setSize', targetObject: first, width: 64, height: 64 },
      'timer-condition': { type: 'onTimer', timerName: '', interval: 1.0, reversed: false },
      'edge-condition': { type: 'onEdge', targetObject: first, edge: 'any', reversed: false },
      'trigger-once-condition': { type: 'triggerOnce', reversed: false },
      'set-velocity': { type: 'setVelocity', targetObject: first, velX: 5, velY: 0 },
      'spawn-object': { type: 'spawnObject', sourceObject: first, spawnX: 400, spawnY: 300 },
      'rotate-object': { type: 'rotateObject', targetObject: first, angle: 90, mode: 'add' },
      'random-variable': { type: 'randomVariable', varName: 'score', min: 0, max: 10, round: true },
      'overlap-condition': { type: 'overlapTouch', object1: first, object2: second, tolerance: 4, reversed: false },
      'force-toward': { type: 'forceToward', targetObject: first, sourceObject: second, speed: 3, mode: 'add' }
    };
  }

  // Fresh default data record for a newly placed block of `blockType`.
  // - Catalog blocks: clone the catalog defaults, then fill any empty
  //   object-name field from the project's object names (first/second).
  //   Exception: a block that carries a scope field uses targetObject
  //   as its SCOPE object, not its primary target, so it is only
  //   filled when the scope is Object; with Global/Scene/Local scope
  //   the scope object stays blank, the panel reads (none), and the
  //   runtime warns if the scope is later switched to Object without
  //   naming one, instead of silently binding the first object.
  // - Legacy core types: the fixed table above.
  // - Unknown types: {} (the editor still places the visual block).
  // objectNames: array of object names across all scenes. catalogBlock:
  // the catalog entry for the block type (or null). currentSceneId: the
  // id of the scene the block is placed in (the switch-scene default).
  // Never mutates its inputs; the returned record is always fresh.
  function buildBlockDefaults(blockType, objectNames, catalogBlock, currentSceneId) {
    var names = Array.isArray(objectNames) ? objectNames : [];
    var first = names[0] || '';
    var second = names[1] || '';
    if (catalogBlock && catalogBlock.defaults && typeof catalogBlock.defaults === 'object') {
      var data = cloneData(catalogBlock.defaults);
      if ('targetObject' in data && !data.targetObject && (!('scope' in data) || data.scope === 'object')) data.targetObject = first;
      if ('sourceObject' in data && !data.sourceObject) data.sourceObject = second || first;
      if ('object1' in data && !data.object1) data.object1 = first;
      if ('object2' in data && !data.object2) data.object2 = second || first;
      if ('platformObject' in data && !data.platformObject) data.platformObject = second || first;
      return data;
    }
    var table = legacyDefaults(first, second, currentSceneId);
    var found = table[blockType];
    return found ? cloneData(found) : {};
  }

  return {
    GRID_COLS: GRID_COLS,
    GRID_ROWS: GRID_ROWS,
    GRID_CELLS: GRID_CELLS,
    isValidIndex: isValidIndex,
    rowOf: rowOf,
    colOf: colOf,
    indexOf: indexOf,
    rowStartIndex: rowStartIndex,
    rowEndIndex: rowEndIndex,
    adjacentIndexes: adjacentIndexes,
    moveIndex: moveIndex,
    normalizeScriptScope: normalizeScriptScope,
    functionIdOfScope: functionIdOfScope,
    findFunction: findFunction,
    sameScriptScope: sameScriptScope,
    getScopeKey: getScopeKey,
    cloneData: cloneData,
    gridHasBlocks: gridHasBlocks,
    createGridData: createGridData,
    getGridDataForScope: getGridDataForScope,
    saveGridToScope: saveGridToScope,
    loadGridEntries: loadGridEntries,
    gridDataFromMap: gridDataFromMap,
    placeBlock: placeBlock,
    clearBlock: clearBlock,
    blockClassForType: blockClassForType,
    buildBlockDefaults: buildBlockDefaults
  };
}

if (typeof window !== 'undefined') {
  window.HydraGridModel = hydraGridModelFactory();
  // Self-contained source of the factory, inlined into exported playable games
  // by buildPlayableHtml (player-runtime.js) when a future cycle needs it.
  // Kept as a string, never eval'd here.
  window.HydraGridModel.factorySource = hydraGridModelFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraGridModelFactory;
