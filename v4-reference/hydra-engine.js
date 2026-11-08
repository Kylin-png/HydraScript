// ============================================================
// HydraScript v4 — Game Engine Runtime
// Physics, rendering, input, block execution, export
// ============================================================

(function (global) {
  'use strict';

  const { clone, clamp } = global.HydraCore || {};

  // ---- Engine State ----
  function createState(project, canvas, ctx) {
    return {
      project, canvas, ctx,
      scenes: (project.scenes || []).map(normalizeScene).filter(Boolean),
      assets: project.assets || {},
      sceneId: null,
      objects: [],
      variables: {},
      hidden: new Set(),
      destroyed: new Set(),
      pendingDestroy: new Set(),
      timers: new Map(),
      once: new Set(),
      edgeTracker: new Map(),
      contexts: {},
      executionContext: null,
      camera: { x: 0, y: 0, followTarget: '', offsetX: 0, offsetY: 0 },
      keys: new Set(),
      keysJustPressed: new Set(),
      keysJustReleased: new Set(),
      mouseButtons: new Set(),
      mouseJustPressed: new Set(),
      mouseJustReleased: new Set(),
      mouse: { x: 0, y: 0 },
      frameId: 0,
      dt: 1,
      shake: { strength: 0, timeLeft: 0 },
      running: false,
      startedScopes: new Set(),
      imageCache: {},
      audioCtx: null,
      particles: [],
      flash: { color: '#fff', intensity: 0, duration: 0 },
    };
  }

  function normalizeScene(scene) {
    if (!scene) return null;
    scene.worldWidth = Math.max(100, Number(scene.worldWidth || scene.width || 800));
    scene.worldHeight = Math.max(100, Number(scene.worldHeight || scene.height || 600));
    scene.width = scene.worldWidth;
    scene.height = scene.worldHeight;
    scene.viewportWidth = Math.max(100, Number(scene.viewportWidth || Math.min(scene.worldWidth, 800) || 800));
    scene.viewportHeight = Math.max(100, Number(scene.viewportHeight || Math.min(scene.worldHeight, 600) || 600));
    scene.gridData = scene.gridData || (scene.logicGrids?.main) || {};
    scene.objects = scene.objects || [];
    scene.objects.forEach(normalizeObject);
    return scene;
  }

  function normalizeObject(obj) {
    obj.components = Array.isArray(obj.components) ? obj.components : [];
    obj.variables = obj.variables || {};
    obj.collision = obj.collision || {};
    if (typeof obj.collision.enabled !== 'boolean') {
      obj.collision.enabled = obj.kind !== 'text' && obj.uiPinned !== true;
    }
    return obj;
  }

  // ---- Lifecycle ----
  function start(project, options = {}) {
    const p = clone(project || {});
    p.logicGrids = p.logicGrids || { global: p.globalGridData || {} };
    p.globalGridData = p.globalGridData || p.logicGrids.global || {};
    const canvas = typeof options.canvas === 'string'
      ? document.querySelector(options.canvas)
      : (options.canvas || document.getElementById(options.canvasId || 'game-canvas'));
    if (!canvas) throw new Error('Canvas not found');
    const ctx = canvas.getContext('2d');
    const state = createState(p, canvas, ctx);
    bindInput(state);
    loadScene(state, Number(p.currentSceneId || state.scenes[0]?.id || 1));
    resizeCanvas(state);
    global.addEventListener('resize', () => resizeCanvas(state));
    state.running = true;
    state.lastTime = 0;
    state.rafHandle = requestAnimationFrame((t) => loop(state, t));
    return state;
  }

  function stop(state) {
    state.running = false;
    if (state.rafHandle) cancelAnimationFrame(state.rafHandle);
    state.rafHandle = null;
    if (state.audioCtx) { try { state.audioCtx.close(); } catch {} state.audioCtx = null; }
  }

  // ---- Input ----
  function bindInput(state) {
    const canvas = state.canvas;
    canvas.tabIndex = 0;

    state._keydown = (e) => {
      if (!state.keys.has(e.key)) state.keysJustPressed.add(e.key);
      state.keys.add(e.key);
      if (e.code) {
        if (!state.keys.has(e.code)) state.keysJustPressed.add(e.code);
        state.keys.add(e.code);
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
    };
    state._keyup = (e) => {
      [e.key, e.code].filter(Boolean).forEach((k) => {
        if (state.keys.has(k)) state.keysJustReleased.add(k);
        state.keys.delete(k);
      });
      if (e.key === ' ') { state.keys.delete('Space'); state.keysJustReleased.add('Space'); }
    };
    state._mousemove = (e) => updateMouse(state, e);
    state._mousedown = (e) => {
      updateMouse(state, e);
      state.mouseButtons.add(e.button);
      state.mouseJustPressed.add(e.button);
      canvas.focus();
    };
    state._mouseup = (e) => {
      updateMouse(state, e);
      state.mouseButtons.delete(e.button);
      state.mouseJustReleased.add(e.button);
    };
    state._contextmenu = (e) => e.preventDefault();

    document.addEventListener('keydown', state._keydown);
    document.addEventListener('keyup', state._keyup);
    canvas.addEventListener('mousemove', state._mousemove);
    canvas.addEventListener('mousedown', state._mousedown);
    canvas.addEventListener('mouseup', state._mouseup);
    canvas.addEventListener('contextmenu', state._contextmenu);
  }

  function unbindInput(state) {
    document.removeEventListener('keydown', state._keydown);
    document.removeEventListener('keyup', state._keyup);
    state.canvas.removeEventListener('mousemove', state._mousemove);
    state.canvas.removeEventListener('mousedown', state._mousedown);
    state.canvas.removeEventListener('mouseup', state._mouseup);
    state.canvas.removeEventListener('contextmenu', state._contextmenu);
  }

  function updateMouse(state, e) {
    const rect = state.canvas.getBoundingClientRect();
    state.mouse.x = ((e.clientX - rect.left) / rect.width) * state.canvas.width;
    state.mouse.y = ((e.clientY - rect.top) / rect.height) * state.canvas.height;
  }

  // ---- Scene Management ----
  function loadScene(state, sceneId) {
    const scene = state.scenes.find((s) => s.id === Number(sceneId)) || state.scenes[0];
    if (!scene) return;
    state.sceneId = scene.id;
    state.objects = clone(scene.objects || []);
    state.objects.forEach((o) => { o.velX = 0; o.velY = 0; o._alive = true; o._runtimeText = undefined; });
    state.hidden.clear();
    state.destroyed.clear();
    state.pendingDestroy.clear();
    state.timers.clear();
    state.once.clear();
    state.edgeTracker.clear();
    state.contexts = {};
    state.executionContext = null;
    state.camera = { x: 0, y: 0, followTarget: '', offsetX: 0, offsetY: 0 };
    state.startedScopes.clear();
    state.particles = [];
    state.flash = { color: '#fff', intensity: 0, duration: 0 };
    resizeCanvas(state);
  }

  function resizeCanvas(state) {
    const scene = getScene(state);
    if (!scene) return;
    state.canvas.width = scene.viewportWidth;
    state.canvas.height = scene.viewportHeight;
    clampCamera(state);
  }

  function getScene(state) {
    return normalizeScene(state.scenes.find((s) => s.id === state.sceneId) || state.scenes[0]);
  }

  function getScopeGrid(state, scope) {
    if (scope === 'global') return state.project.globalGridData || {};
    return normalizeScene(state.scenes.find((s) => s.id === Number(scope)))?.gridData || {};
  }

  // ---- Camera ----
  function clampCamera(state) {
    const scene = getScene(state);
    if (!scene) return;
    state.camera.x = clamp(state.camera.x, 0, Math.max(0, scene.worldWidth - scene.viewportWidth));
    state.camera.y = clamp(state.camera.y, 0, Math.max(0, scene.worldHeight - scene.viewportHeight));
  }

  function updateCameraFollow(state) {
    if (!state.camera.followTarget) return;
    const obj = findObjectByName(state, state.camera.followTarget);
    if (!obj) return;
    const scene = getScene(state);
    if (!scene) return;
    state.camera.x = clamp(
      obj.posX + obj.width / 2 - scene.viewportWidth / 2 + state.camera.offsetX,
      0, Math.max(0, scene.worldWidth - scene.viewportWidth)
    );
    state.camera.y = clamp(
      obj.posY + obj.height / 2 - scene.viewportHeight / 2 + state.camera.offsetY,
      0, Math.max(0, scene.worldHeight - scene.viewportHeight)
    );
  }

  // ---- Physics ----
  function getPhysics(obj) {
    return Object.assign({ gravity: 0, friction: 0.82, bounciness: 0.4, maxSpeed: 25 }, obj.physics || {});
  }

  function hitbox(obj) {
    return {
      x: (obj.posX || 0) + (Number(obj.hitboxOffsetX) || 0),
      y: (obj.posY || 0) + (Number(obj.hitboxOffsetY) || 0),
      width: Number(obj.hitboxWidth) > 0 ? Number(obj.hitboxWidth) : (obj.width || 1),
      height: Number(obj.hitboxHeight) > 0 ? Number(obj.hitboxHeight) : (obj.height || 1),
    };
  }

  function aabb(a, b) {
    const ab = hitbox(a), bb = hitbox(b);
    return ab.x < bb.x + bb.width && ab.x + ab.width > bb.x &&
           ab.y < bb.y + bb.height && ab.y + ab.height > bb.y;
  }

  function overlap(a, b) {
    const ab = hitbox(a), bb = hitbox(b);
    const dx = (ab.x + ab.width / 2) - (bb.x + bb.width / 2);
    const dy = (ab.y + ab.height / 2) - (bb.y + bb.height / 2);
    const ox = (ab.width / 2 + bb.width / 2) - Math.abs(dx);
    const oy = (ab.height / 2 + bb.height / 2) - Math.abs(dy);
    if (ox <= 0 || oy <= 0) return null;
    return ox < oy ? { nx: Math.sign(dx), ny: 0, depth: ox } : { nx: 0, ny: Math.sign(dy), depth: oy };
  }

  function isCollisionObject(o) {
    return o && o.collision?.enabled !== false && o.kind !== 'text' && !o.uiPinned;
  }

  function updatePhysics(state) {
    const live = state.objects.filter((o) => !state.destroyed.has(o.id));
    live.forEach((obj) => {
      obj._prevX = obj.posX;
      obj._prevY = obj.posY;
      if (obj.kind === 'text' || obj.static || !obj.physicsEnabled) return;
      const p = getPhysics(obj);
      obj.velY = (obj.velY || 0) + p.gravity * state.dt;
      obj.velX = (obj.velX || 0) * Math.pow(p.friction, state.dt);
      obj.velY = (obj.velY || 0) * Math.pow(p.friction, state.dt);
      obj.velX = clamp(obj.velX, -p.maxSpeed, p.maxSpeed);
      obj.velY = clamp(obj.velY, -p.maxSpeed, p.maxSpeed);
      obj.posX += obj.velX * state.dt;
      obj.posY += obj.velY * state.dt;
    });
    resolveCollisions(live);
    // World bounds
    const scene = getScene(state);
    if (scene) {
      live.forEach((obj) => {
        if (obj.kind === 'text' || obj.static || !obj.physicsEnabled) return;
        if (obj.posX < 0) { obj.posX = 0; obj.velX = Math.abs(obj.velX || 0) * getPhysics(obj).bounciness; }
        if (obj.posX + obj.width > scene.worldWidth) { obj.posX = scene.worldWidth - obj.width; obj.velX = -Math.abs(obj.velX || 0) * getPhysics(obj).bounciness; }
        if (obj.posY < 0) { obj.posY = 0; obj.velY = Math.abs(obj.velY || 0) * getPhysics(obj).bounciness; }
        if (obj.posY + obj.height > scene.worldHeight) { obj.posY = scene.worldHeight - obj.height; obj.velY = -Math.abs(obj.velY || 0) * getPhysics(obj).bounciness; }
      });
    }
  }

  function resolveCollisions(objects) {
    const solids = objects.filter((o) => isCollisionObject(o) && (o.static || !o.physicsEnabled));
    const dynamics = objects.filter((o) => isCollisionObject(o) && !o.static && o.physicsEnabled);
    dynamics.forEach((obj) => {
      solids.forEach((wall) => {
        if (wall === obj) return;
        const mtv = overlap(obj, wall);
        if (!mtv) return;
        if (mtv.nx !== 0) {
          obj.posX += mtv.nx * mtv.depth;
          obj.velX = -obj.velX * getPhysics(obj).bounciness;
        }
        if (mtv.ny !== 0) {
          obj.posY += mtv.ny * mtv.depth;
          obj.velY = -obj.velY * getPhysics(obj).bounciness;
        }
      });
    });
  }

  // ---- Object Lookup ----
  function findObjectByName(state, name) {
    if (!name) return null;
    return state.objects.find((o) => o.name === name && !state.destroyed.has(o.id)) || null;
  }

  function findObjectsByTag(state, tag) {
    if (!tag) return [];
    return state.objects.filter((o) => (o.tags || []).includes(tag) && !state.destroyed.has(o.id));
  }

  function getAllObjectNames(state) {
    return state.objects.filter((o) => !state.destroyed.has(o.id)).map((o) => o.name);
  }

  // ---- Expression Evaluation ----
  function evalExpr(state, expr, context = {}) {
    if (expr === '' || expr === null || expr === undefined) return 0;
    if (typeof expr === 'number') return expr;
    const str = String(expr).trim();
    if (str === '') return 0;
    if (/^-?\d+(\.\d+)?$/.test(str)) return Number(str);

    // Build context with objects, variables, and built-ins
    const scope = {};
    // Global variables
    Object.assign(scope, state.variables);
    // Context variables
    Object.assign(scope, context);
    // Object references (read-only position/velocity/etc)
    state.objects.forEach((o) => {
      if (!state.destroyed.has(o.id) && o.name) {
        Object.defineProperty(scope, o.name, {
          get() {
            return {
              posX: o.posX, posY: o.posY, width: o.width, height: o.height,
              velX: o.velX || 0, velY: o.velY || 0, rotation: o.rotation || 0,
              name: o.name, id: o.id, kind: o.kind,
              get text() { return o.text; },
              get variable() { return o.variables || {}; },
            };
          },
        });
      }
    });
    // Built-in functions
    scope.mouseX = state.mouse.x;
    scope.mouseY = state.mouse.y;
    scope.random = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    scope.randomFloat = (min, max) => Math.random() * (max - min) + min;
    scope.abs = Math.abs;
    scope.floor = Math.floor;
    scope.ceil = Math.ceil;
    scope.round = Math.round;
    scope.min = Math.min;
    scope.max = Math.max;
    scope.sin = Math.sin;
    scope.cos = Math.cos;
    scope.PI = Math.PI;
    scope.frame = state.frameId;
    scope.dt = state.dt;

    try {
      const keys = Object.keys(scope);
      const vals = Object.values(scope);
      return new Function(...keys, `"use strict"; return (${str});`)(...vals);
    } catch (e) {
      // Fallback: try simple number parse
      const n = Number(str);
      return Number.isFinite(n) ? n : 0;
    }
  }

  // ---- Block Execution ----
  function processScope(state, scope) {
    const grid = getScopeGrid(state, scope);
    if (!grid || !Object.keys(grid).length) return;

    const indices = Object.keys(grid).map(Number).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
    const scopeKey = String(scope);

    // Group cells into event rows
    let currentRow = null;
    const rows = [];

    for (const idx of indices) {
      const cell = grid[idx];
      if (!cell) continue;

      if (cell.type === 'comment') {
        if (currentRow) rows.push(currentRow);
        currentRow = null;
        continue;
      }

      const isCond = cell.kind === 'condition' || global.HydraCore.isConditionType(cell.type);
      if (isCond) {
        if (currentRow && (currentRow.conditions.length || currentRow.actions.length)) rows.push(currentRow);
        currentRow = { conditions: [], actions: [] };
        currentRow.conditions.push({ cell, idx });
      } else {
        if (!currentRow) currentRow = { conditions: [], actions: [] };
        currentRow.actions.push({ cell, idx });
      }
    }
    if (currentRow) rows.push(currentRow);

    // Execute rows
    for (const row of rows) {
      // Check conditions
      let allConditionsMet = row.conditions.length === 0;
      if (row.conditions.length > 0) {
        allConditionsMet = true;
        for (const { cell } of row.conditions) {
          if (!checkCondition(state, cell, scopeKey)) {
            allConditionsMet = false;
            break;
          }
        }
      }
      // Execute actions if conditions met
      if (allConditionsMet) {
        for (const { cell } of row.actions) {
          executeAction(state, cell, scopeKey);
        }
      }
    }
  }

  function checkCondition(state, cell, scopeKey) {
    const ctx = state.executionContext || {};
    const t = cell.type;
    const inverted = (val) => (cell.reversed ? !val : val);

    switch (t) {
      case 'always':
        return true;

      case 'gameStart': {
        const key = `start_${scopeKey}`;
        if (state.startedScopes.has(key)) return false;
        state.startedScopes.add(key);
        return true;
      }

      case 'keyDown':
        return state.keys.has(cell.key);

      case 'keyPressed':
        return state.keysJustPressed.has(cell.key);

      case 'keyReleased':
        return state.keysJustReleased.has(cell.key);

      case 'mouseDown':
        return state.mouseButtons.has(Number(cell.button === 'left' ? 0 : cell.button === 'right' ? 2 : 1));

      case 'mousePressed':
        return state.mouseJustPressed.has(Number(cell.button === 'left' ? 0 : cell.button === 'right' ? 2 : 1));

      case 'mouseReleased':
        return state.mouseJustReleased.has(Number(cell.button === 'left' ? 0 : cell.button === 'right' ? 2 : 1));

      case 'overlap': {
        const a = findObjectByName(state, cell.object1);
        const b = findObjectByName(state, cell.object2);
        if (!a || !b) return inverted(false);
        return inverted(aabb(a, b));
      }

      case 'triggerOnce': {
        const key = `once_${scopeKey}_${cell._idx || ''}`;
        if (state.once.has(key)) return inverted(false);
        // Only mark as triggered when the row would fire (i.e., this is the only condition)
        // For now, mark immediately
        state.once.add(key);
        return inverted(true);
      }

      case 'timer': {
        const name = cell.timerName || 'timer';
        const interval = Math.max(1, evalExpr(state, cell.interval, ctx));
        if (!state.timers.has(name)) state.timers.set(name, 0);
        let count = state.timers.get(name) + 1;
        state.timers.set(name, count);
        if (count >= interval) {
          if (cell.reset !== false) state.timers.set(name, 0);
          return true;
        }
        return false;
      }

      case 'edge': {
        const obj = findObjectByName(state, cell.targetObject);
        if (!obj) return false;
        const prop = cell.property || 'posY';
        const val = Number(obj[prop]) || 0;
        const threshold = evalExpr(state, cell.value, ctx);
        const key = `edge_${cell.targetObject}_${prop}_${cell.operator}_${threshold}`;
        const prev = state.edgeTracker.get(key);
        state.edgeTracker.set(key, val);
        if (prev === undefined) return false;
        if (cell.operator === '>=') return val >= threshold && prev < threshold;
        if (cell.operator === '<=') return val <= threshold && prev > threshold;
        return false;
      }

      case 'distanceCheck': {
        const a = findObjectByName(state, cell.object1);
        const b = findObjectByName(state, cell.object2);
        if (!a || !b) return inverted(false);
        const dx = (a.posX + a.width / 2) - (b.posX + b.width / 2);
        const dy = (a.posY + a.height / 2) - (b.posY + b.height / 2);
        const dist = Math.sqrt(dx * dx + dy * dy);
        const target = evalExpr(state, cell.distance, ctx);
        const ops = { '<=': dist <= target, '>': dist > target, '>=': dist >= target, '<': dist < target };
        return inverted(ops[cell.operator] ?? false);
      }

      case 'positionCheck': {
        const obj = findObjectByName(state, cell.targetObject);
        if (!obj) return inverted(false);
        const val = Number(obj[cell.property]) || 0;
        const target = evalExpr(state, cell.value, ctx);
        const ops = { '>=': val >= target, '<=': val <= target, '==': val === target, '!=': val !== target, '>': val > target, '<': val < target };
        return inverted(ops[cell.operator] ?? false);
      }

      case 'variableCheck': {
        const scope = cell.scope || 'global';
        const vars = scope === 'local' ? (state.executionContext?._entity?.variables || {}) : state.variables;
        const val = Number(vars[cell.name]) || 0;
        const target = evalExpr(state, cell.value, ctx);
        const ops = { '>=': val >= target, '<=': val <= target, '==': val === target, '!=': val !== target, '>': val > target, '<': val < target };
        return inverted(ops[cell.operator] ?? false);
      }

      default:
        return false;
    }
  }

  function executeAction(state, cell, scopeKey) {
    const ctx = state.executionContext || {};
    const t = cell.type;

    switch (t) {
      case 'setPosition': {
        const obj = findObjectByName(state, cell.targetObject);
        if (!obj) return;
        const x = evalExpr(state, cell.x, ctx);
        const y = evalExpr(state, cell.y, ctx);
        if (cell.mode === 'add') { obj.posX += x; obj.posY += y; }
        else { obj.posX = x; obj.posY = y; }
        break;
      }

      case 'setVelocity': {
        const obj = findObjectByName(state, cell.targetObject);
        if (!obj) return;
        const vx = evalExpr(state, cell.velX, ctx);
        const vy = evalExpr(state, cell.velY, ctx);
        if (cell.mode === 'add') { obj.velX = (obj.velX || 0) + vx; obj.velY = (obj.velY || 0) + vy; }
        else { obj.velX = vx; obj.velY = vy; }
        break;
      }

      case 'moveToward': {
        const obj = findObjectByName(state, cell.targetObject);
        if (!obj) return;
        const tx = evalExpr(state, cell.targetX, ctx);
        const ty = evalExpr(state, cell.targetY, ctx);
        const speed = evalExpr(state, cell.speed, ctx);
        const dx = tx - obj.posX, dy = ty - obj.posY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0.5) {
          obj.posX += (dx / dist) * speed * state.dt;
          obj.posY += (dy / dist) * speed * state.dt;
        }
        break;
      }

      case 'forceToward': {
        const obj = findObjectByName(state, cell.targetObject);
        const target = findObjectByName(state, cell.targetObjectName);
        if (!obj || !target) return;
        const force = evalExpr(state, cell.force, ctx);
        const dx = (target.posX + target.width / 2) - (obj.posX + obj.width / 2);
        const dy = (target.posY + target.height / 2) - (obj.posY + obj.height / 2);
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        obj.velX = (obj.velX || 0) + (dx / dist) * force;
        obj.velY = (obj.velY || 0) + (dy / dist) * force;
        break;
      }

      case 'rotateObject': {
        const obj = findObjectByName(state, cell.targetObject);
        if (!obj) return;
        const angle = evalExpr(state, cell.angle, ctx);
        if (cell.mode === 'add') obj.rotation = (obj.rotation || 0) + angle;
        else obj.rotation = angle;
        break;
      }

      case 'setSize': {
        const obj = findObjectByName(state, cell.targetObject);
        if (!obj) return;
        const w = evalExpr(state, cell.width, ctx);
        const h = evalExpr(state, cell.height, ctx);
        if (cell.mode === 'add') { obj.width += w; obj.height += h; }
        else { obj.width = w; obj.height = h; }
        break;
      }

      case 'applyImpulse': {
        const obj = findObjectByName(state, cell.targetObject);
        if (!obj) return;
        obj.velX = (obj.velX || 0) + evalExpr(state, cell.impulseX, ctx);
        obj.velY = (obj.velY || 0) + evalExpr(state, cell.impulseY, ctx);
        break;
      }

      case 'setVariable': {
        const val = evalExpr(state, cell.value, ctx);
        const name = cell.name;
        if (!name) return;
        const scope = cell.scope || 'global';
        let vars;
        if (scope === 'local' && state.executionContext?._entity) {
          state.executionContext._entity.variables = state.executionContext._entity.variables || {};
          vars = state.executionContext._entity.variables;
        } else {
          vars = state.variables;
        }
        const current = Number(vars[name]) || 0;
        switch (cell.mode) {
          case 'add': vars[name] = current + val; break;
          case 'sub': vars[name] = current - val; break;
          case 'mul': vars[name] = current * val; break;
          case 'div': vars[name] = val !== 0 ? current / val : 0; break;
          default: vars[name] = val;
        }
        break;
      }

      case 'randomVariable': {
        const min = Math.ceil(evalExpr(state, cell.min, ctx));
        const max = Math.floor(evalExpr(state, cell.max, ctx));
        state.variables[cell.name] = Math.floor(Math.random() * (max - min + 1)) + min;
        break;
      }

      case 'destroyObject': {
        const obj = findObjectByName(state, cell.targetObject);
        if (obj) state.pendingDestroy.add(obj.id);
        break;
      }

      case 'spawnObject': {
        const source = findObjectByName(state, cell.sourceObject);
        if (!source) return;
        const copy = clone(source);
        copy.id = global.HydraCore.uid('ent');
        copy.name = cell.targetObject || `${source.name}_clone`;
        copy.posX = evalExpr(state, cell.x, ctx);
        copy.posY = evalExpr(state, cell.y, ctx);
        copy.velX = 0; copy.velY = 0; copy._alive = true;
        state.objects.push(copy);
        break;
      }

      case 'showHide': {
        const obj = findObjectByName(state, cell.targetObject);
        if (!obj) return;
        if (cell.visible) state.hidden.delete(obj.id);
        else state.hidden.add(obj.id);
        break;
      }

      case 'setText': {
        const obj = findObjectByName(state, cell.targetObject);
        if (!obj) return;
        let text = String(cell.text || '');
        // Evaluate embedded expressions in "quotes" + expr pattern
        if (text.includes('+') || /\$\{/.test(text)) {
          try {
            obj._runtimeText = String(evalExpr(state, text, ctx));
          } catch {
            obj._runtimeText = text;
          }
        } else {
          obj._runtimeText = text;
        }
        break;
      }

      case 'setColor': {
        const obj = findObjectByName(state, cell.targetObject);
        if (!obj) return;
        obj.color = cell.color || '#ff0000';
        break;
      }

      case 'setCamera': {
        state.camera.followTarget = '';
        state.camera.x = evalExpr(state, cell.x, ctx);
        state.camera.y = evalExpr(state, cell.y, ctx);
        clampCamera(state);
        break;
      }

      case 'followCamera': {
        state.camera.followTarget = cell.targetObject || '';
        state.camera.offsetX = evalExpr(state, cell.offsetX, ctx);
        state.camera.offsetY = evalExpr(state, cell.offsetY, ctx);
        break;
      }

      case 'cameraShake': {
        state.shake.strength = evalExpr(state, cell.strength, ctx);
        state.shake.timeLeft = evalExpr(state, cell.duration, ctx);
        break;
      }

      case 'switchScene': {
        const scene = state.scenes.find((s) => s.name === cell.sceneName);
        if (scene) loadScene(state, scene.id);
        break;
      }

      case 'playSound': {
        playSound(state, cell);
        break;
      }

      case 'timerControl': {
        const name = cell.timerName || 'timer';
        switch (cell.action) {
          case 'reset': state.timers.set(name, 0); break;
          case 'clear': state.timers.delete(name); break;
          case 'pause': { const v = state.timers.get(name); if (v !== undefined) state.timers.set(name, v); break; }
          case 'resume': break;
        }
        break;
      }

      case 'screenFlash': {
        state.flash = {
          color: cell.color || '#ffffff',
          intensity: clamp(evalExpr(state, cell.intensity, ctx), 0, 1),
          duration: evalExpr(state, cell.duration, ctx),
        };
        break;
      }

      case 'createParticles': {
        const count = evalExpr(state, cell.count, ctx);
        const x = evalExpr(state, cell.x, ctx);
        const y = evalExpr(state, cell.y, ctx);
        const spread = evalExpr(state, cell.spread, ctx);
        const life = evalExpr(state, cell.life, ctx);
        const color = cell.color || '#f59e0b';
        for (let i = 0; i < count; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = Math.random() * spread + 1;
          state.particles.push({
            x, y,
            velX: Math.cos(angle) * speed,
            velY: Math.sin(angle) * speed,
            life, maxLife: life,
            color, size: Math.random() * 4 + 2,
          });
        }
        break;
      }
    }
  }

  function playSound(state, cell) {
    try {
      if (!state.audioCtx) state.audioCtx = new (global.AudioContext || global.webkitAudioContext)();
      const ac = state.audioCtx;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = cell.type || 'sine';
      osc.frequency.value = evalExpr(state, cell.frequency, {});
      const dur = evalExpr(state, cell.duration, {});
      const vol = evalExpr(state, cell.volume, {});
      gain.gain.setValueAtTime(vol, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start();
      osc.stop(ac.currentTime + dur);
    } catch (e) { /* audio not available */ }
  }

  // ---- Main Loop ----
  function loop(state, timestamp) {
    if (!state.lastTime) state.lastTime = timestamp;
    state.dt = Math.min((timestamp - state.lastTime) / 16.67, 3);
    state.lastTime = timestamp;
    state.frameId++;

    if (state.shake.timeLeft > 0) state.shake.timeLeft = Math.max(0, state.shake.timeLeft - state.dt * 16.67);
    if (state.flash.duration > 0) state.flash.duration = Math.max(0, state.flash.duration - state.dt);

    updateCameraFollow(state);
    updatePhysics(state);
    updateParticles(state);

    state.contexts = {};
    state.executionContext = null;
    processScope(state, 'global');
    processScope(state, state.sceneId);

    state.pendingDestroy.forEach((id) => { state.destroyed.add(id); });
    state.pendingDestroy.clear();

    draw(state);

    state.keysJustPressed.clear();
    state.keysJustReleased.clear();
    state.mouseJustPressed.clear();
    state.mouseJustReleased.clear();

    if (state.running) state.rafHandle = requestAnimationFrame((t) => loop(state, t));
  }

  function updateParticles(state) {
    state.particles = state.particles.filter((p) => {
      p.x += p.velX * state.dt;
      p.y += p.velY * state.dt;
      p.velY += 0.2 * state.dt;
      p.life -= state.dt;
      return p.life > 0;
    });
  }

  // ---- Rendering ----
  function draw(state) {
    const { ctx, canvas } = state;
    const scene = getScene(state);
    if (!scene) return;

    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background
    if (scene.bgAssetId && state.assets[scene.bgAssetId]) {
      const img = getImage(state, scene.bgAssetId);
      if (img) ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      else ctx.fillStyle = scene.bgColor || '#1a1a2e';
    } else {
      ctx.fillStyle = scene.bgColor || '#1a1a2e';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Camera shake offset
    let shakeX = 0, shakeY = 0;
    if (state.shake.timeLeft > 0) {
      const mag = state.shake.strength * (state.shake.timeLeft / 20);
      shakeX = (Math.random() - 0.5) * mag;
      shakeY = (Math.random() - 0.5) * mag;
    }

    ctx.translate(-state.camera.x + shakeX, -state.camera.y + shakeY);

    // Draw objects
    const visible = state.objects.filter((o) => !state.hidden.has(o.id) && !state.destroyed.has(o.id));
    visible.forEach((obj) => drawObject(state, obj));

    // Draw particles
    state.particles.forEach((p) => {
      const alpha = p.life / p.maxLife;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    ctx.restore();

    // Screen flash
    if (state.flash.duration > 0) {
      ctx.globalAlpha = state.flash.intensity * (state.flash.duration / 10);
      ctx.fillStyle = state.flash.color;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
    }
  }

  function drawObject(state, obj) {
    const { ctx } = state;
    ctx.save();

    if (obj.rotation) {
      ctx.translate(obj.posX + obj.width / 2, obj.posY + obj.height / 2);
      ctx.rotate((obj.rotation * Math.PI) / 180);
      ctx.translate(-obj.width / 2, -obj.height / 2);
    } else {
      ctx.translate(obj.posX, obj.posY);
    }

    if (obj.kind === 'text') {
      const text = obj._runtimeText !== undefined ? obj._runtimeText : (obj.text || 'Text');
      const fontSize = Number(obj.fontSize) || 24;
      const fontFamily = obj.fontFamily || 'Inter, sans-serif';
      const weight = obj.bold ? 'bold ' : '';
      const style = obj.italic ? 'italic ' : '';
      ctx.font = `${style}${weight}${fontSize}px ${fontFamily}`;
      ctx.fillStyle = obj._runtimeText !== undefined ? (obj.textColor || '#111827') : (obj.textColor || '#111827');
      ctx.textAlign = obj.textAlign || 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(text, 0, 0);
    } else {
      // Image or color rect
      if (obj.assetId && state.assets[obj.assetId]) {
        const img = getImage(state, obj.assetId);
        if (img) {
          ctx.drawImage(img, 0, 0, obj.width, obj.height);
        } else {
          ctx.fillStyle = obj.color || '#4488ff';
          ctx.fillRect(0, 0, obj.width, obj.height);
        }
      } else {
        ctx.fillStyle = obj.color || '#4488ff';
        if (obj.kind === 'button') {
          // Rounded rect for buttons
          const r = 8;
          ctx.beginPath();
          ctx.roundRect(0, 0, obj.width, obj.height, r);
          ctx.fill();
          // Label
          ctx.fillStyle = '#ffffff';
          ctx.font = '600 16px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(obj.text || 'Button', obj.width / 2, obj.height / 2);
        } else {
          ctx.fillRect(0, 0, obj.width, obj.height);
        }
      }
    }

    ctx.restore();
  }

  function getImage(state, assetId) {
    if (state.imageCache[assetId]) return state.imageCache[assetId];
    const asset = state.assets[assetId];
    if (!asset || !asset.dataUrl) return null;
    try {
      const img = new Image();
      img.src = asset.dataUrl;
      state.imageCache[assetId] = img;
      return img;
    } catch {
      return null;
    }
  }

  // ---- Export: Build Playable HTML ----
  function buildPlayableHtml(project) {
    const p = clone(project);
    const scenesJson = JSON.stringify(p);
    const engineCode = global.HydraEngine.toString();
    const coreCode = global.HydraCore ? `
      var HydraCore = ${serializeCore()};
    ` : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(p.name || 'Hydra Game')}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0a0a0a; display: flex; align-items: center; justify-content: center; min-height: 100vh; font-family: 'Inter', sans-serif; overflow: hidden; }
  #game-container { position: relative; border-radius: 8px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.5); }
  #game-canvas { display: block; background: #1a1a2e; image-rendering: pixelated; }
  #game-overlay { position: absolute; top: 12px; left: 12px; color: rgba(255,255,255,0.6); font-size: 12px; pointer-events: none; }
</style>
</head>
<body>
<div id="game-container">
  <canvas id="game-canvas"></canvas>
  <div id="game-overlay">${escapeHtml(p.name || 'Hydra Game')}</div>
</div>
<script>
${coreCode}
(function(global) {
  ${engineCode}
})(window);
var PROJECT_DATA = ${scenesJson};
window.addEventListener('load', function() {
  HydraEngine.start(PROJECT_DATA, { canvasId: 'game-canvas' });
});
</script>
</body>
</html>`;
  }

  function serializeCore() {
    return JSON.stringify({
      clone: clone.toString(),
      clamp: clamp.toString(),
    });
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ---- Export API ----
  global.HydraEngine = {
    start, stop, loadScene, resizeCanvas,
    createState, getScene, getScopeGrid,
    findObjectByName, findObjectsByTag, getAllObjectNames,
    evalExpr, processScope, checkCondition, executeAction,
    updatePhysics, draw, drawObject, getImage,
    bindInput, unbindInput,
    buildPlayableHtml,
  };
})(window);
