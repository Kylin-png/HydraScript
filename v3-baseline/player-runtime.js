(function installHydraPlayer(global) {
  'use strict';

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function normalizeScene(scene) {
    if (!scene) return null;
    scene.worldWidth = Math.max(100, Number(scene.worldWidth || scene.width || 800));
    scene.worldHeight = Math.max(100, Number(scene.worldHeight || scene.height || 600));
    scene.width = scene.worldWidth;
    scene.height = scene.worldHeight;
    scene.viewportWidth = Math.max(100, Number(scene.viewportWidth || Math.min(scene.worldWidth, 800) || 800));
    scene.viewportHeight = Math.max(100, Number(scene.viewportHeight || Math.min(scene.worldHeight, 600) || 600));
    scene.logicGrids = scene.logicGrids || {};
    const hasGridData = scene.gridData && Object.keys(scene.gridData).length > 0;
    const hasLogicGrid = scene.logicGrids.main && Object.keys(scene.logicGrids.main).length > 0;
    if (!hasGridData && hasLogicGrid) scene.gridData = scene.logicGrids.main;
    scene.gridData = scene.gridData || {};
    if (!hasLogicGrid) scene.logicGrids.main = scene.gridData;
    scene.objects = scene.objects || [];
    scene.objects.forEach(normalizeObject);
    return scene;
  }

  function normalizeObject(obj) {
    obj.components = Array.isArray(obj.components) ? obj.components : [];
    obj.variables = obj.variables || {};
    obj.effects = Array.isArray(obj.effects) ? obj.effects : [];
    obj.collision = obj.collision || {};
    if (typeof obj.collision.enabled !== 'boolean') {
      obj.collision.enabled = obj.kind !== 'text' && obj.uiPinned !== true;
    }
    return obj;
  }

  function start(projectInput, options = {}) {
    const project = clone(projectInput || {});
    project.eventsVersion = project.eventsVersion || 1;
    project.logicGrids = project.logicGrids || { global: project.globalGridData || {} };
    project.globalGridData = project.globalGridData || project.logicGrids.global || {};
    const scenes = (project.scenes || []).map(normalizeScene).filter(Boolean);
    const assets = project.assets || {};
    const canvas = typeof options.canvas === 'string'
      ? document.querySelector(options.canvas)
      : (options.canvas || document.getElementById(options.canvasId || 'game-canvas'));
    if (!canvas) throw new Error('Hydra player canvas not found.');
    const ctx = canvas.getContext('2d');
    const state = createState(project, scenes, assets, canvas, ctx);
    bindInput(state);
    loadScene(state, Number(project.currentSceneId || scenes[0]?.id || 1));
    resizeCanvas(state);
    global.addEventListener('resize', () => resizeCanvas(state));
    state.running = true;
    state.lastTime = 0;
    requestAnimationFrame(t => loop(state, t));
    return state;
  }

  function createState(project, scenes, assets, canvas, ctx) {
    return {
      project, scenes, assets, canvas, ctx,
      sceneId: null,
      objects: [],
      variables: {},
      hidden: new Set(),
      destroyed: new Set(),
      pendingDestroy: new Set(),
      timers: new Map(),
      once: new Set(),
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
      bgCache: {},
      audioCtx: null
    };
  }

  function getScene(state) {
    return normalizeScene(state.scenes.find(s => s.id === state.sceneId) || state.scenes[0]);
  }

  function getScopeGrid(state, scope) {
    if (scope === 'global') return state.project.globalGridData || {};
    return normalizeScene(state.scenes.find(s => s.id === Number(scope)))?.gridData || {};
  }

  function getScopeKey(scope) {
    return String(scope === 'global' ? 'global' : Number(scope));
  }

  function loadScene(state, sceneId) {
    const scene = normalizeScene(state.scenes.find(s => s.id === Number(sceneId)) || state.scenes[0]);
    if (!scene) return;
    state.sceneId = scene.id;
    state.objects = clone(scene.objects || []);
    state.objects.forEach(o => {
      o.velX = 0;
      o.velY = 0;
      o._runtimeText = undefined;
      o._alive = true;
    });
    state.hidden.clear();
    state.destroyed.clear();
    state.pendingDestroy.clear();
    state.timers.clear();
    state.once.clear();
    state.contexts = {};
    state.executionContext = null;
    state.camera = { x: 0, y: 0, followTarget: '', offsetX: 0, offsetY: 0 };
    state.startedScopes.clear();
    resizeCanvas(state);
  }

  function resizeCanvas(state) {
    const scene = getScene(state);
    if (!scene) return;
    state.canvas.width = scene.viewportWidth;
    state.canvas.height = scene.viewportHeight;
    clampCamera(state);
  }

  function bindInput(state) {
    const canvas = state.canvas;
    canvas.tabIndex = 0;
    document.addEventListener('keydown', e => {
      if (!state.keys.has(e.key)) state.keysJustPressed.add(e.key);
      state.keys.add(e.key);
      if (e.code) {
        if (!state.keys.has(e.code)) state.keysJustPressed.add(e.code);
        state.keys.add(e.code);
      }
      if (e.key === ' ') state.keys.add('Space');
    });
    document.addEventListener('keyup', e => {
      [e.key, e.code, e.key === ' ' ? 'Space' : ''].filter(Boolean).forEach(key => {
        if (state.keys.has(key)) state.keysJustReleased.add(key);
        state.keys.delete(key);
      });
    });
    canvas.addEventListener('mousemove', e => updateMouse(state, e));
    canvas.addEventListener('mousedown', e => {
      updateMouse(state, e);
      state.mouseButtons.add(e.button);
      state.mouseJustPressed.add(e.button);
      canvas.focus();
    });
    canvas.addEventListener('mouseup', e => {
      updateMouse(state, e);
      state.mouseButtons.delete(e.button);
      state.mouseJustReleased.add(e.button);
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  function updateMouse(state, e) {
    const rect = state.canvas.getBoundingClientRect();
    state.mouse.x = ((e.clientX - rect.left) / rect.width) * state.canvas.width;
    state.mouse.y = ((e.clientY - rect.top) / rect.height) * state.canvas.height;
  }

  function loop(state, timestamp) {
    if (!state.lastTime) state.lastTime = timestamp;
    state.dt = Math.min((timestamp - state.lastTime) / 16.67, 3);
    state.lastTime = timestamp;
    state.frameId++;
    if (state.shake.timeLeft > 0) state.shake.timeLeft = Math.max(0, state.shake.timeLeft - state.dt * 16.67);
    updateCameraFollow(state);
    updatePhysics(state);
    state.contexts = {};
    state.executionContext = null;
    processScope(state, 'global');
    processScope(state, state.sceneId);
    state.pendingDestroy.forEach(id => state.destroyed.add(id));
    state.pendingDestroy.clear();
    draw(state);
    state.keysJustPressed.clear();
    state.keysJustReleased.clear();
    state.mouseJustPressed.clear();
    state.mouseJustReleased.clear();
    if (state.running) requestAnimationFrame(t => loop(state, t));
  }

  function updatePhysics(state) {
    const live = state.objects.filter(o => !state.destroyed.has(o.id));
    live.forEach(obj => {
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
  }

  function getPhysics(obj) {
    const defaults = { gravity: 0, friction: 0.82, bounciness: 0.4, maxSpeed: 25 };
    return Object.assign(defaults, obj.physics || {});
  }

  function hitbox(obj) {
    return {
      x: (obj.posX || 0) + (Number(obj.hitboxOffsetX) || 0),
      y: (obj.posY || 0) + (Number(obj.hitboxOffsetY) || 0),
      width: Number(obj.hitboxWidth) > 0 ? Number(obj.hitboxWidth) : (obj.width || 1),
      height: Number(obj.hitboxHeight) > 0 ? Number(obj.hitboxHeight) : (obj.height || 1)
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

  function resolveCollisions(objects) {
    const solids = objects.filter(o => isCollisionObject(o) && (o.static || !o.physicsEnabled));
    const dynamics = objects.filter(o => isCollisionObject(o) && !o.static && o.physicsEnabled);
    dynamics.forEach(obj => {
      solids.forEach(wall => {
        if (wall === obj) return;
        const mtv = overlap(obj, wall);
        if (!mtv) return;
        const prev = hitbox(Object.assign({}, obj, { posX: obj._prevX ?? obj.posX, posY: obj._prevY ?? obj.posY }));
        const wallBox = hitbox(wall);
        const fromTop = prev.y + prev.height <= wallBox.y && (obj.velY || 0) >= 0;
        const fromBottom = prev.y >= wallBox.y + wallBox.height && (obj.velY || 0) <= 0;
        const fromLeft = prev.x + prev.width <= wallBox.x && (obj.velX || 0) >= 0;
        const fromRight = prev.x >= wallBox.x + wallBox.width && (obj.velX || 0) <= 0;
        if (fromTop) {
          obj.posY += wallBox.y - (hitbox(obj).y + hitbox(obj).height);
          obj.velY = 0;
        } else if (fromBottom) {
          obj.posY += (wallBox.y + wallBox.height) - hitbox(obj).y;
          obj.velY = 0;
        } else if (fromLeft) {
          obj.posX += wallBox.x - (hitbox(obj).x + hitbox(obj).width);
          obj.velX = 0;
        } else if (fromRight) {
          obj.posX += (wallBox.x + wallBox.width) - hitbox(obj).x;
          obj.velX = 0;
        } else {
          obj.posX += mtv.nx * mtv.depth;
          obj.posY += mtv.ny * mtv.depth;
          if (mtv.nx) obj.velX = 0;
          if (mtv.ny) obj.velY = 0;
        }
      });
    });
  }

  function isCollisionObject(obj) {
    if (!obj) return false;
    if (obj.kind === 'text' || obj.uiPinned === true) return obj.collision?.enabled === true;
    if (obj.collision && obj.collision.enabled === false) return false;
    return obj.collidable !== false;
  }

  function processScope(state, scope) {
    const gd = getScopeGrid(state, scope);
    const entries = Object.entries(gd).map(([idx, data]) => [Number(idx), data]).sort(([a], [b]) => a - b);
    entries.forEach(([idx, data]) => {
      if (!data || data.type === 'and' || data.type === 'triggerOnce' || !isCondition(data.type)) return;
      runCondition(state, scope, idx, data);
    });
    entries.forEach(([idx, data]) => {
      if (!data || (data.type !== 'and' && data.type !== 'triggerOnce')) return;
      runCondition(state, scope, idx, data);
    });
    state.startedScopes.add(getScopeKey(scope));
  }

  function isCondition(type) {
    return ['gameStart','always','keyPressed','keyJustPressed','mouseClick','mouseOverObject','objectClicked','getVariable','collision','onFloor','overlapTouch','distanceCheck','positionCheck','velocityCheck','objectVisible','objectCount','chance','onTimer','onEdge','and','triggerOnce'].includes(type);
  }

  function isAction(type) {
    return ['applyForce','teleport','setVariable','destroyObject','showHide','playSound','switchScene','setText','setCamera','followCamera','setSize','setVelocity','spawnObject','rotateObject','randomVariable','forceToward','forceTowardPosition','moveTowardPosition','moveTowardObject','impulseAwayObject','stopObject','setPosition','clampToScreen','wrapScreen','destroyOutsideScreen','setGravity','setFriction','setMaxSpeed','setBounciness','setPhysicsEnabled','setStatic','setColor','setOpacity','setLayer','pointTowardObject','pointTowardPosition','faceMovement','timerControl','screenShake','restartScene','nextScene','previousScene','spawnAtObject','separateObjects','saveVariable','loadVariable'].includes(type);
  }

  function runCondition(state, scope, idx, data) {
    const result = evaluate(state, scope, idx, data);
    if (!result.triggered) return;
    const key = `${getScopeKey(scope)}:${idx}`;
    state.contexts[key] = result.context || {};
    state.executionContext = result.context || {};
    getActionIndexes(state, scope, idx).forEach(actionIdx => execute(state, getScopeGrid(state, scope)[actionIdx], actionIdx));
  }

  function evaluate(state, scope, idx, data) {
    switch (data.type) {
      case 'gameStart': return res(data.reversed ? state.startedScopes.has(getScopeKey(scope)) : !state.startedScopes.has(getScopeKey(scope)), { gameStart: true });
      case 'always': return res(true, { always: true });
      case 'keyJustPressed': return res(data.reversed ? !hasKey(state.keysJustPressed, data.key) : hasKey(state.keysJustPressed, data.key), { key: data.key });
      case 'keyPressed': return evalKey(state, data);
      case 'mouseClick': return evalMouse(state, data);
      case 'mouseOverObject': return evalPointObject(state, data, false);
      case 'objectClicked': return evalPointObject(state, data, true);
      case 'getVariable': {
        const val = state.variables[data.varName] ?? 0;
        const pass = compare(val, data.operator, expr(state, data.compareValue ?? 0));
        return res(data.reversed ? !pass : pass, { variable: data.varName, value: val });
      }
      case 'collision': return evalCollision(state, data);
      case 'overlapTouch': return evalCollision(state, data);
      case 'onFloor': return evalOnFloor(state, data);
      case 'distanceCheck': return evalDistance(state, data);
      case 'positionCheck': return evalProperty(state, data, data.property || 'posY');
      case 'velocityCheck': return evalVelocity(state, data);
      case 'objectVisible': {
        const targets = named(state, data.targetObject);
        const visibleObj = targets.find(o => !state.hidden.has(o.id));
        return res(data.reversed ? !visibleObj : Boolean(visibleObj), { obj1: visibleObj, targetObject: data.targetObject });
      }
      case 'objectCount': {
        const count = named(state, data.targetObject).length;
        const pass = compare(count, data.operator || '==', expr(state, data.count ?? 0));
        return res(data.reversed ? !pass : pass, { count, targetObject: data.targetObject });
      }
      case 'chance': {
        const pass = Math.random() * 100 < clamp(expr(state, data.percent ?? 0), 0, 100);
        return res(data.reversed ? !pass : pass, { chance: data.percent });
      }
      case 'onTimer': return evalTimer(state, scope, idx, data);
      case 'onEdge': return evalEdge(state, data);
      case 'triggerOnce': return evalOnce(state, scope, idx, data);
      case 'and': return evalAnd(state, scope, idx, data);
      default: return res(false);
    }
  }

  function res(triggered, context = {}) {
    return { triggered: Boolean(triggered), context };
  }

  function evalKey(state, data) {
    const mode = data.inputCondition || (data.trigger === 'pressed' ? 'keyJustPressed' : data.trigger === 'released' ? 'keyReleased' : 'keyPressed');
    let pass = false;
    if (mode === 'anyKeyPressed') pass = state.keys.size > 0;
    else if (mode === 'anyKeyJustPressed') pass = state.keysJustPressed.size > 0;
    else if (mode === 'anyKeyReleased') pass = state.keysJustReleased.size > 0;
    else if (mode === 'keyJustPressed') pass = hasKey(state.keysJustPressed, data.key);
    else if (mode === 'keyReleased') pass = hasKey(state.keysJustReleased, data.key);
    else pass = hasKey(state.keys, data.key);
    return res(data.reversed ? !pass : pass, { key: data.key, inputCondition: mode });
  }

  function hasKey(set, key) {
    if (key === 'Space') return set.has('Space') || set.has(' ');
    return set.has(key);
  }

  function evalMouse(state, data) {
    const mode = data.mouseCondition || 'mouseButtonPressed';
    const source = mode === 'mouseButtonJustPressed' ? state.mouseJustPressed : mode === 'mouseButtonReleased' ? state.mouseJustReleased : state.mouseButtons;
    const button = data.button === 'right' ? 2 : 0;
    const pass = data.button === 'any' ? source.size > 0 : source.has(button);
    return res(data.reversed ? !pass : pass, { mouse: true });
  }

  function evalPointObject(state, data, requireClick) {
    const button = data.button === 'right' ? 2 : data.button === 'middle' ? 1 : 0;
    if (requireClick && !state.mouseJustPressed.has(button)) return res(data.reversed, { objectClicked: false });
    let matched = null;
    const pass = named(state, data.targetObject).some(obj => {
      const p = obj.uiPinned ? state.mouse : { x: state.mouse.x + state.camera.x, y: state.mouse.y + state.camera.y };
      const box = hitbox(obj);
      const inside = p.x >= box.x && p.x <= box.x + box.width && p.y >= box.y && p.y <= box.y + box.height;
      if (inside) matched = obj;
      return inside;
    });
    return res(data.reversed ? !pass : pass, { obj1: matched, targetObject: data.targetObject });
  }

  function evalCollision(state, data) {
    const aList = named(state, data.object1).filter(isCollisionObject);
    const bList = named(state, data.object2).filter(isCollisionObject);
    let obj1 = null, obj2 = null, pass = false;
    for (const a of aList) {
      for (const b of bList) {
        if (a.id !== b.id && aabb(a, b)) {
          obj1 = a; obj2 = b; pass = true; break;
        }
      }
      if (pass) break;
    }
    return res(data.reversed ? !pass : pass, { colliding: pass, touching: pass, obj1, obj2, object1Name: data.object1, object2Name: data.object2 });
  }

  function evalOnFloor(state, data) {
    let target = null, floor = null, pass = false;
    named(state, data.targetObject).filter(isCollisionObject).forEach(a => {
      named(state, data.platformObject).filter(isCollisionObject).forEach(b => {
        const ab = hitbox(a), bb = hitbox(b);
        const horizontal = ab.x <= bb.x + bb.width + 4 && ab.x + ab.width >= bb.x - 4;
        const bottomTouch = Math.abs((ab.y + ab.height) - bb.y) <= 4;
        if (horizontal && bottomTouch) { target = a; floor = b; pass = true; }
      });
    });
    return res(data.reversed ? !pass : pass, { onFloor: pass, obj1: target, obj2: floor, targetObject: data.targetObject, platformObject: data.platformObject });
  }

  function evalDistance(state, data) {
    const threshold = expr(state, data.distance ?? 0);
    let pass = false, obj1 = null, obj2 = null, distance = Infinity;
    named(state, data.object1).forEach(a => named(state, data.object2).forEach(b => {
      if (a.id === b.id) return;
      const d = Math.hypot((a.posX + a.width / 2) - (b.posX + b.width / 2), (a.posY + a.height / 2) - (b.posY + b.height / 2));
      if (d < distance) distance = d;
      if (compare(d, data.operator || '<=', threshold)) { pass = true; obj1 = a; obj2 = b; }
    }));
    return res(data.reversed ? !pass : pass, { distance, obj1, obj2 });
  }

  function evalProperty(state, data, prop) {
    const value = expr(state, data.value ?? 0);
    let matched = null;
    const pass = named(state, data.targetObject).some(obj => {
      const ok = compare(obj[prop] ?? 0, data.operator || '>=', value);
      if (ok) matched = obj;
      return ok;
    });
    return res(data.reversed ? !pass : pass, { obj1: matched, targetObject: data.targetObject });
  }

  function evalVelocity(state, data) {
    const value = expr(state, data.value ?? 0);
    let matched = null, checked = 0;
    const pass = named(state, data.targetObject).some(obj => {
      checked = data.component === 'x' ? (obj.velX || 0) : data.component === 'y' ? (obj.velY || 0) : Math.hypot(obj.velX || 0, obj.velY || 0);
      const ok = compare(checked, data.operator || '>=', value);
      if (ok) matched = obj;
      return ok;
    });
    return res(data.reversed ? !pass : pass, { obj1: matched, value: checked });
  }

  function evalTimer(state, scope, idx, data) {
    const name = String(data.timerName || '').trim();
    const key = name ? `named:${name}` : `cell:${getScopeKey(scope)}:${idx}`;
    const now = performance.now();
    const interval = Math.max(0.001, expr(state, data.interval ?? 1)) * 1000;
    let record = state.timers.get(key);
    if (!record) record = { lastFiredTime: now - interval, paused: false, pausedAt: 0, firedFrame: -1 };
    const elapsed = record.paused ? (record.pausedAt || now) - record.lastFiredTime : now - record.lastFiredTime;
    let fired = record.firedFrame === state.frameId;
    if (!record.paused && elapsed >= interval) {
      fired = true;
      record.lastFiredTime = now;
      record.firedFrame = state.frameId;
    }
    state.timers.set(key, record);
    return res(data.reversed ? !fired : fired, { timer: true, timerName: name, elapsed: elapsed / 1000 });
  }

  function evalEdge(state, data) {
    const scene = getScene(state);
    let pass = false;
    named(state, data.targetObject).forEach(obj => {
      const box = hitbox(obj), edge = data.edge || 'any';
      if (edge === 'left' || edge === 'any') pass = pass || box.x <= 0;
      if (edge === 'right' || edge === 'any') pass = pass || box.x + box.width >= scene.worldWidth;
      if (edge === 'top' || edge === 'any') pass = pass || box.y <= 0;
      if (edge === 'bottom' || edge === 'any') pass = pass || box.y + box.height >= scene.worldHeight;
    });
    return res(data.reversed ? !pass : pass, { edge: true });
  }

  function evalOnce(state, scope, idx, data) {
    const key = `${getScopeKey(scope)}:${idx}`;
    const fired = state.once.has(key);
    const contexts = adjacentIndexes(idx).map(i => state.contexts[`${getScopeKey(scope)}:${i}`]).filter(Boolean);
    const gated = contexts.length > 0;
    const pass = data.reversed ? fired : (!fired && (gated ? contexts.some(Boolean) : true));
    if (pass && !data.reversed) state.once.add(key);
    return res(pass, Object.assign({ once: true, gated }, ...contexts));
  }

  function evalAnd(state, scope, idx, data) {
    const contexts = adjacentIndexes(idx).map(i => state.contexts[`${getScopeKey(scope)}:${i}`]).filter(Boolean);
    const pass = (data.logic || 'and') === 'or' ? contexts.length >= 1 : contexts.length >= 2;
    return res(pass, Object.assign({ andGroup: true }, ...contexts));
  }

  function execute(state, data, idx) {
    if (!data) return;
    switch (data.type) {
      case 'applyForce': targets(state, data).forEach(o => velocity(o, expr(state, data.forceX), expr(state, data.forceY), data.mode)); break;
      case 'setVelocity': targets(state, data).forEach(o => { o.velX = expr(state, data.velX); o.velY = expr(state, data.velY); }); break;
      case 'teleport':
      case 'setPosition': {
        const x = exprInfo(state, data.toX ?? data.x);
        const y = exprInfo(state, data.toY ?? data.y);
        if (x.ok && y.ok) targets(state, data).forEach(o => { o.posX = x.value; o.posY = y.value; });
        break;
      }
      case 'setVariable': setVar(state, data); break;
      case 'randomVariable': state.variables[data.varName] = randomValue(state, data); break;
      case 'destroyObject': targets(state, data).forEach(o => state.pendingDestroy.add(o.id)); break;
      case 'showHide': targets(state, data, true).forEach(o => setVisible(state, o, data.action)); break;
      case 'setText': targets(state, data).forEach(o => { if (o.kind === 'text') o._runtimeText = data.useVariable ? `${data.prefix || ''}${state.variables[data.varName] ?? ''}${data.suffix || ''}` : (data.value || ''); }); break;
      case 'setCamera': state.camera.x = expr(state, data.cameraX); state.camera.y = expr(state, data.cameraY); state.camera.followTarget = ''; clampCamera(state); break;
      case 'followCamera': state.camera.followTarget = data.targetObject || ''; state.camera.offsetX = expr(state, data.offsetX || 0); state.camera.offsetY = expr(state, data.offsetY || 0); updateCameraFollow(state); break;
      case 'switchScene': loadScene(state, data.sceneId); break;
      case 'restartScene': loadScene(state, state.sceneId); break;
      case 'nextScene':
      case 'previousScene': changeSceneRelative(state, data.type === 'nextScene' ? 1 : -1); break;
      case 'setSize': targets(state, data).forEach(o => { o.width = Math.max(1, expr(state, data.width)); o.height = Math.max(1, expr(state, data.height)); }); break;
      case 'spawnObject': spawnAt(state, data.sourceObject, expr(state, data.spawnX), expr(state, data.spawnY)); break;
      case 'spawnAtObject': targets(state, { targetObject: data.targetObject, targetMode: data.targetMode || 'context' }).forEach(a => spawnAt(state, data.sourceObject, a.posX + a.width / 2 + expr(state, data.offsetX || 0), a.posY + a.height / 2 + expr(state, data.offsetY || 0))); break;
      case 'rotateObject': targets(state, data).forEach(o => { o.rotation = data.mode === 'set' ? expr(state, data.angle) : ((o.rotation || 0) + expr(state, data.angle)) % 360; }); break;
      case 'forceToward':
      case 'moveTowardObject': towardObject(state, data, data.type === 'moveTowardObject'); break;
      case 'forceTowardPosition': {
        const tx = exprInfo(state, data.targetX);
        const ty = exprInfo(state, data.targetY);
        if (tx.ok && ty.ok) towardPoint(state, data, tx.value, ty.value, false);
        break;
      }
      case 'moveTowardPosition': {
        const tx = exprInfo(state, data.targetX);
        const ty = exprInfo(state, data.targetY);
        if (tx.ok && ty.ok) towardPoint(state, data, tx.value, ty.value, true);
        break;
      }
      case 'impulseAwayObject': awayObject(state, data); break;
      case 'stopObject': targets(state, data).forEach(o => { if (data.axis !== 'y') o.velX = 0; if (data.axis !== 'x') o.velY = 0; }); break;
      case 'setGravity': setPhysics(state, data, 'gravity'); break;
      case 'setFriction': setPhysics(state, data, 'friction'); break;
      case 'setMaxSpeed': setPhysics(state, data, 'maxSpeed'); break;
      case 'setBounciness': setPhysics(state, data, 'bounciness'); break;
      case 'setPhysicsEnabled': targets(state, data).forEach(o => { o.physicsEnabled = data.enabled === true || data.enabled === 'true'; if (data.resetVelocity) { o.velX = 0; o.velY = 0; } }); break;
      case 'setStatic': targets(state, data).forEach(o => { o.static = data.static === true || data.static === 'true'; }); break;
      case 'setColor': targets(state, data).forEach(o => { o.color = data.color || o.color; o.assetId = null; }); break;
      case 'setOpacity': targets(state, data).forEach(o => { o.opacity = clamp(expr(state, data.opacity ?? 1), 0, 1); }); break;
      case 'setLayer': targets(state, data).forEach(o => { o.layer = expr(state, data.layer ?? 0); }); break;
      case 'timerControl': controlTimer(state, data); break;
      case 'playSound': playSound(state, data); break;
      case 'clampToScreen': clampObjects(state, data); break;
      case 'wrapScreen': wrapObjects(state, data); break;
      case 'destroyOutsideScreen': destroyOutside(state, data); break;
      case 'pointTowardObject': pointTowardObject(state, data); break;
      case 'pointTowardPosition': targets(state, data).forEach(o => pointTo(o, expr(state, data.targetX), expr(state, data.targetY), expr(state, data.offsetAngle || 0))); break;
      case 'faceMovement': targets(state, data).forEach(o => { if (Math.hypot(o.velX || 0, o.velY || 0) >= expr(state, data.minSpeed || 0.05)) o.rotation = Math.atan2(o.velY || 0, o.velX || 0) * 180 / Math.PI + expr(state, data.offsetAngle || 0); }); break;
      case 'screenShake': state.shake = { strength: Math.max(0, expr(state, data.strength || 6)), timeLeft: Math.max(0, expr(state, data.duration || 0.2) * 1000) }; break;
      case 'saveVariable': try { localStorage.setItem(`hydraSave:${data.saveKey || data.varName || 'value'}`, JSON.stringify(state.variables[data.varName] ?? 0)); } catch {} break;
      case 'loadVariable': try { const raw = localStorage.getItem(`hydraSave:${data.saveKey || data.varName || 'value'}`); if (raw !== null) state.variables[data.varName] = JSON.parse(raw); } catch {} break;
    }
  }

  function velocity(obj, x, y, mode) {
    if (obj.kind === 'text') return;
    if (mode === 'set') { obj.velX = x; obj.velY = y; }
    else { obj.velX = (obj.velX || 0) + x; obj.velY = (obj.velY || 0) + y; }
    const p = getPhysics(obj);
    obj.velX = clamp(obj.velX, -p.maxSpeed, p.maxSpeed);
    obj.velY = clamp(obj.velY, -p.maxSpeed, p.maxSpeed);
  }

  function targets(state, data, includeHidden = false) {
    const all = named(state, data.targetObject || '', includeHidden);
    if (!all.length) return [];
    if (data.targetMode === 'all') return all;
    if (data.targetMode === 'first') return all.slice(0, 1);
    const ctx = state.executionContext || {};
    const match = [ctx.obj1, ctx.obj2].find(o => o && o.name === (data.targetObject || '') && !state.destroyed.has(o.id));
    return match ? [match] : all.slice(0, 1);
  }

  function named(state, name, includeHidden = false) {
    return state.objects.filter(o => o.name === name && !state.destroyed.has(o.id) && (includeHidden || !state.hidden.has(o.id)));
  }

  function setVar(state, data) {
    const cur = state.variables[data.varName] ?? 0;
    const valueInfo = exprInfo(state, data.value);
    if (!valueInfo.ok && data.operation !== 'toggle') return;
    const val = valueInfo.value;
    if (data.operation === 'add') state.variables[data.varName] = cur + val;
    else if (data.operation === 'subtract') state.variables[data.varName] = cur - val;
    else if (data.operation === 'multiply') state.variables[data.varName] = cur * val;
    else if (data.operation === 'toggle') state.variables[data.varName] = !cur;
    else state.variables[data.varName] = val;
  }

  function randomValue(state, data) {
    const min = expr(state, data.min), max = expr(state, data.max);
    const val = Math.random() * (max - min) + min;
    return data.round ? Math.round(val) : val;
  }

  function setVisible(state, obj, action) {
    if (action === 'show') state.hidden.delete(obj.id);
    else if (action === 'toggle') state.hidden.has(obj.id) ? state.hidden.delete(obj.id) : state.hidden.add(obj.id);
    else state.hidden.add(obj.id);
  }

  function spawnAt(state, sourceName, x, y) {
    const scene = getScene(state);
    (scene.objects || []).filter(o => o.name === sourceName).forEach(src => {
      const cloneObj = clone(src);
      cloneObj.id = `spawn_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      cloneObj.posX = x;
      cloneObj.posY = y;
      cloneObj.velX = 0;
      cloneObj.velY = 0;
      state.objects.push(cloneObj);
    });
  }

  function towardObject(state, data, directMove) {
    const source = named(state, data.sourceObject)[0];
    if (!source) return;
    towardPoint(state, data, source.posX + source.width / 2, source.posY + source.height / 2, directMove);
  }

  function awayObject(state, data) {
    const source = named(state, data.sourceObject)[0];
    if (!source) return;
    targets(state, data).forEach(obj => {
      const dx = (obj.posX + obj.width / 2) - (source.posX + source.width / 2);
      const dy = (obj.posY + obj.height / 2) - (source.posY + source.height / 2);
      setVelocityToward(state, obj, dx, dy, expr(state, data.speed || 8), data.mode || 'add');
    });
  }

  function towardPoint(state, data, x, y, directMove) {
    targets(state, data).forEach(obj => {
      const dx = x - (obj.posX + obj.width / 2);
      const dy = y - (obj.posY + obj.height / 2);
      const dist = Math.hypot(dx, dy) || 1;
      const speed = expr(state, data.speed || 3);
      if (directMove) {
        const stop = expr(state, data.stopDistance || 1);
        if (dist <= stop) return;
        const step = Math.min(dist - stop, speed * state.dt);
        obj.posX += dx / dist * step;
        obj.posY += dy / dist * step;
      } else {
        setVelocityToward(state, obj, dx, dy, speed, data.mode || 'add');
      }
    });
  }

  function hasGravityMovement(obj) {
    if (!obj || !obj.physicsEnabled) return false;
    return Math.abs(getPhysics(obj).gravity || 0) > 0.0001;
  }

  function isObjectGrounded(state, obj) {
    if (!obj || !isCollisionObject(obj)) return false;
    const box = hitbox(obj);
    const bottom = box.y + box.height;
    const tolerance = Math.max(5, Math.abs(obj.velY || 0) + 3);
    return state.objects.some(other => {
      if (!other || other.id === obj.id || state.destroyed.has(other.id) || !isCollisionObject(other)) return false;
      if (!(other.static || !other.physicsEnabled)) return false;
      const floor = hitbox(other);
      const horizontal = box.x < floor.x + floor.width - 1 && box.x + box.width > floor.x + 1;
      const vertical = bottom >= floor.y - tolerance && bottom <= floor.y + tolerance;
      return horizontal && vertical;
    });
  }

  function applyPlatformAwareTowardVelocity(state, obj, dx, dy, speed, mode, nx) {
    const p = getPhysics(obj);
    const horizontalSpeed = Math.sign(dx || nx || 0) * Math.min(Math.abs(nx * speed), Math.abs(speed));
    if (mode === 'add') obj.velX = (obj.velX || 0) + horizontalSpeed;
    else obj.velX = horizontalSpeed;

    const verticalGap = -dy;
    const closeEnoughToJump = Math.abs(dx) <= Math.max(obj.width * 6, Math.abs(speed) * 18, 72);
    const needsJump = verticalGap > Math.max(10, obj.height * 0.25);
    if (needsJump && closeEnoughToJump && isObjectGrounded(state, obj)) {
      const jumpVelocity = Math.min(
        p.maxSpeed,
        Math.max(Math.abs(speed) * 1.15, Math.sqrt(Math.max(p.gravity, 0.1) * verticalGap * 2))
      );
      obj.velY = Math.min(obj.velY || 0, -jumpVelocity);
    }

    obj.velX = clamp(obj.velX || 0, -p.maxSpeed, p.maxSpeed);
    obj.velY = clamp(obj.velY || 0, -p.maxSpeed, p.maxSpeed);
  }

  function setVelocityToward(state, obj, dx, dy, speed, mode) {
    const dist = Math.hypot(dx, dy) || 1;
    const nx = dx / dist;
    const ny = dy / dist;
    if (hasGravityMovement(obj)) {
      applyPlatformAwareTowardVelocity(state, obj, dx, dy, speed, mode, nx);
      return;
    }
    velocity(obj, nx * speed, ny * speed, mode);
  }

  function setPhysics(state, data, key) {
    targets(state, data).forEach(o => {
      o.physics = o.physics || {};
      o.physics[key] = expr(state, data[key]);
      o.physicsEnabled = true;
    });
  }

  function controlTimer(state, data) {
    const name = String(data.timerName || '').trim();
    if (!name) return;
    const key = `named:${name}`;
    const now = performance.now();
    let record = state.timers.get(key) || { lastFiredTime: now, paused: false, pausedAt: 0, firedFrame: -1 };
    if (data.action === 'pause') { record.paused = true; record.pausedAt = now; }
    else if (data.action === 'resume' && record.paused) { record.lastFiredTime += now - (record.pausedAt || now); record.paused = false; }
    else if (data.action === 'clear') { state.timers.delete(key); return; }
    else record = { lastFiredTime: now, paused: false, pausedAt: 0, firedFrame: -1 };
    state.timers.set(key, record);
  }

  function playSound(state, data) {
    try {
      state.audioCtx = state.audioCtx || new (global.AudioContext || global.webkitAudioContext)();
      const osc = state.audioCtx.createOscillator();
      const gain = state.audioCtx.createGain();
      osc.type = data.waveform || 'square';
      osc.frequency.value = data.frequency || 440;
      gain.gain.value = data.volume || 0.3;
      gain.gain.exponentialRampToValueAtTime(0.001, state.audioCtx.currentTime + (data.duration || 0.2));
      osc.connect(gain); gain.connect(state.audioCtx.destination);
      osc.start(); osc.stop(state.audioCtx.currentTime + (data.duration || 0.2));
    } catch {}
  }

  function clampObjects(state, data) {
    const scene = getScene(state);
    targets(state, data).forEach(o => {
      o.posX = clamp(o.posX, 0, scene.worldWidth - o.width);
      o.posY = clamp(o.posY, 0, scene.worldHeight - o.height);
    });
  }

  function wrapObjects(state, data) {
    const scene = getScene(state);
    targets(state, data).forEach(o => {
      if (o.posX + o.width < 0) o.posX = scene.worldWidth;
      if (o.posX > scene.worldWidth) o.posX = -o.width;
      if (o.posY + o.height < 0) o.posY = scene.worldHeight;
      if (o.posY > scene.worldHeight) o.posY = -o.height;
    });
  }

  function destroyOutside(state, data) {
    const scene = getScene(state), margin = Math.max(0, expr(state, data.margin || 0));
    targets(state, data).forEach(o => {
      const b = hitbox(o);
      if (b.x + b.width < -margin || b.x > scene.worldWidth + margin || b.y + b.height < -margin || b.y > scene.worldHeight + margin) state.pendingDestroy.add(o.id);
    });
  }

  function pointTowardObject(state, data) {
    const src = named(state, data.sourceObject)[0];
    if (!src) return;
    targets(state, data).forEach(o => pointTo(o, src.posX + src.width / 2, src.posY + src.height / 2, expr(state, data.offsetAngle || 0)));
  }

  function pointTo(obj, x, y, offset) {
    obj.rotation = Math.atan2(y - (obj.posY + obj.height / 2), x - (obj.posX + obj.width / 2)) * 180 / Math.PI + offset;
  }

  function changeSceneRelative(state, dir) {
    const ordered = [...state.scenes].sort((a, b) => a.id - b.id);
    const current = ordered.findIndex(s => s.id === state.sceneId);
    const next = ordered[(current + dir + ordered.length) % ordered.length];
    if (next) loadScene(state, next.id);
  }

  function getActionIndexes(state, scope, conditionIndex) {
    const gd = getScopeGrid(state, scope);
    const conditionData = gd[conditionIndex];
    if (conditionData?.eventId) {
      return Object.entries(gd)
        .filter(([idx, data]) => Number(idx) !== conditionIndex && data?.eventId === conditionData.eventId && isAction(data.type))
        .map(([idx]) => Number(idx))
        .sort((a, b) => a - b);
    }
    const out = [], seen = new Set();
    const add = idx => {
      if (gd[idx] && isAction(gd[idx].type) && !seen.has(idx)) { seen.add(idx); out.push(idx); }
    };
    adjacentIndexes(conditionIndex).forEach(add);
    const row = Math.floor(conditionIndex / 60), col = conditionIndex % 60;
    let started = false;
    for (let c = col + 1; c < 60; c++) {
      const idx = row * 60 + c, data = gd[idx];
      if (!data) { if (started) break; continue; }
      if (isAction(data.type)) { add(idx); started = true; continue; }
      if (data.type === 'comment') continue;
      break;
    }
    return out;
  }

  function adjacentIndexes(index) {
    const row = Math.floor(index / 60), col = index % 60;
    return [
      { r: row - 1, c: col }, { r: row + 1, c: col },
      { r: row, c: col - 1 }, { r: row, c: col + 1 }
    ].filter(p => p.r >= 0 && p.r < 60 && p.c >= 0 && p.c < 60).map(p => p.r * 60 + p.c);
  }

  function expr(state, value) {
    return exprInfo(state, value).value;
  }

  function exprInfo(state, value) {
    if (value === null || value === undefined || value === '') return { value: 0, ok: true };
    if (typeof value === 'number') return { value: Number.isFinite(value) ? value : 0, ok: Number.isFinite(value) };
    const s = String(value).trim();
    const n = Number(s);
    if (!Number.isNaN(n)) return { value: n, ok: true };
    try {
      const resolved = s.replace(/\b([A-Za-z_]\w*)\.(\w+)\b/g, (_, objName, prop) => {
        const obj = named(state, objName, true)[0];
        return obj && prop in obj ? String(obj[prop] ?? 0) : '0';
      });
      const scene = getScene(state);
      const builtins = {
        mouseX: state.mouse.x,
        mouseY: state.mouse.y,
        mouseWorldX: state.mouse.x + state.camera.x,
        mouseWorldY: state.mouse.y + state.camera.y,
        canvasWidth: state.canvas.width,
        canvasHeight: state.canvas.height,
        viewportWidth: scene.viewportWidth,
        viewportHeight: scene.viewportHeight,
        sceneWidth: scene.worldWidth,
        sceneHeight: scene.worldHeight,
        worldWidth: scene.worldWidth,
        worldHeight: scene.worldHeight,
        cameraX: state.camera.x,
        cameraY: state.camera.y,
        dt: state.dt
      };
      const scope = Object.assign({}, builtins, state.variables);
      const unknowns = unknownIdentifiers(s, scope);
      if (unknowns.length) {
        state.lastExpressionWarning = `Unknown expression name ${unknowns.join(', ')} in "${s}"`;
        return { value: 0, ok: false };
      }
      const keys = Object.keys(scope);
      const vals = keys.map(k => scope[k]);
      const result = new Function(...keys, `"use strict"; return (${resolved});`)(...vals);
      return { value: Number.isFinite(result) ? result : 0, ok: Number.isFinite(result) };
    } catch {
      return { value: 0, ok: false };
    }
  }

  function unknownIdentifiers(exprText, scope) {
    const stripped = exprText.replace(/\b([A-Za-z_]\w*)\.(\w+)\b/g, '').replace(/"[^"]*"|'[^']*'/g, '');
    const reserved = new Set(['Math','true','false','null','undefined','NaN','Infinity','floor','ceil','round','abs','sqrt','max','min','random','sin','cos','tan']);
    const ids = stripped.match(/\b[A-Za-z_]\w*\b/g) || [];
    return [...new Set(ids.filter(id => !(id in scope) && !reserved.has(id)))];
  }

  function compare(left, op, right) {
    if (op === '>=') return left >= right;
    if (op === '<=') return left <= right;
    if (op === '==') return left == right;
    if (op === '!=') return left != right;
    if (op === '>') return left > right;
    if (op === '<') return left < right;
    return false;
  }

  function updateCameraFollow(state) {
    if (!state.camera.followTarget) return;
    const target = named(state, state.camera.followTarget, true)[0];
    if (!target) return;
    state.camera.x = target.posX + target.width / 2 - state.canvas.width / 2 + (state.camera.offsetX || 0);
    state.camera.y = target.posY + target.height / 2 - state.canvas.height / 2 + (state.camera.offsetY || 0);
    clampCamera(state);
  }

  function clampCamera(state) {
    const scene = getScene(state);
    if (!scene) return;
    state.camera.x = clamp(state.camera.x || 0, 0, Math.max(0, scene.worldWidth - scene.viewportWidth));
    state.camera.y = clamp(state.camera.y || 0, 0, Math.max(0, scene.worldHeight - scene.viewportHeight));
  }

  function image(state, assetId, bg) {
    if (!assetId || !state.assets[assetId]) return null;
    const cache = bg ? state.bgCache : state.imageCache;
    if (cache[assetId]) return cache[assetId];
    const img = new Image();
    img.src = state.assets[assetId].dataUrl;
    cache[assetId] = img;
    return img;
  }

  function draw(state) {
    const scene = getScene(state);
    const ctx = state.ctx;
    state.renderCamera = renderCamera(state);
    const cam = state.renderCamera;
    ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
    const bg = image(state, scene.bgAssetId, true);
    if (bg && bg.complete) ctx.drawImage(bg, -cam.x, -cam.y, scene.worldWidth, scene.worldHeight);
    else { ctx.fillStyle = scene.bgColor || '#ffffff'; ctx.fillRect(0, 0, state.canvas.width, state.canvas.height); }
    [...state.objects].sort((a, b) => (a.layer || 0) - (b.layer || 0)).forEach(obj => {
      if (state.destroyed.has(obj.id) || state.hidden.has(obj.id)) return;
      if (obj.kind === 'text') return drawText(state, obj);
      drawObject(state, obj);
    });
  }

  function drawText(state, obj) {
    const ctx = state.ctx, cam = state.renderCamera || state.camera;
    ctx.save();
    if (!obj.uiPinned) ctx.translate(-cam.x, -cam.y);
    ctx.globalAlpha = obj.opacity ?? 1;
    ctx.font = `${obj.italic ? 'italic ' : ''}${obj.bold ? 'bold ' : ''}${obj.fontSize || 24}px ${obj.fontFamily || 'sans-serif'}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = obj.textAlign || 'left';
    ctx.fillStyle = obj.textColor || '#111827';
    const text = obj._runtimeText !== undefined ? obj._runtimeText : (obj.text || '');
    const x = obj.textAlign === 'center' ? obj.posX + (obj.width || 1) / 2 : obj.textAlign === 'right' ? obj.posX + (obj.width || 1) : obj.posX;
    ctx.fillText(text, x, obj.posY);
    ctx.restore();
  }

  function drawObject(state, obj) {
    const ctx = state.ctx, cam = state.renderCamera || state.camera;
    const img = image(state, obj.assetId, false);
    ctx.save();
    ctx.globalAlpha = obj.opacity ?? 1;
    ctx.translate(obj.posX - cam.x + obj.width / 2, obj.posY - cam.y + obj.height / 2);
    if (obj.rotation) ctx.rotate(obj.rotation * Math.PI / 180);
    if (img && img.complete && img.naturalWidth > 0) drawFitted(ctx, img, obj);
    else { ctx.fillStyle = obj.color || '#888888'; ctx.fillRect(-obj.width / 2, -obj.height / 2, obj.width, obj.height); }
    ctx.restore();
  }

  function drawFitted(ctx, img, obj) {
    if (obj.assetFit === 'stretch') { ctx.drawImage(img, -obj.width / 2, -obj.height / 2, obj.width, obj.height); return; }
    const imageRatio = img.naturalWidth / img.naturalHeight;
    const boxRatio = obj.width / obj.height;
    let w = obj.width, h = obj.height;
    if (obj.assetFit === 'contain' ? imageRatio > boxRatio : imageRatio < boxRatio) h = w / imageRatio;
    else w = h * imageRatio;
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
  }

  function renderCamera(state) {
    if (!state.shake || state.shake.timeLeft <= 0) return state.camera;
    return {
      x: (state.camera.x || 0) + (Math.random() * 2 - 1) * state.shake.strength,
      y: (state.camera.y || 0) + (Math.random() * 2 - 1) * state.shake.strength
    };
  }

  function buildPlayableHtml(project) {
    if (project?.playableRuntime === 'retroFps') return buildRetroFpsHtml(project);
    const safeProject = JSON.stringify(project).replace(/</g, '\\u003c');
    const runtime = `(${installHydraPlayer.toString()})(window);`.replace(/<\/script/gi, '<\\/script');
    const title = escapeHtml(project?.name || 'Hydra Game');
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
:root{color-scheme:dark;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#020617;color:#e5edf8}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at top,#172554 0,#020617 52%,#020617 100%);overflow:hidden}
.shell{position:relative;display:grid;place-items:center;width:100vw;height:100vh}
canvas{max-width:100vw;max-height:100vh;box-shadow:0 24px 80px rgba(0,0,0,.45);background:#000;outline:none}
.hud{position:fixed;left:14px;top:12px;padding:8px 10px;border:1px solid rgba(148,163,184,.25);border-radius:8px;background:rgba(15,23,42,.68);backdrop-filter:blur(10px);font-size:12px;color:#dbeafe}
</style>
</head>
<body>
<div class="shell"><canvas id="game-canvas" aria-label="Hydra playable game"></canvas><div class="hud">${title}</div></div>
<script>${runtime}</script>
<script>
try {
  window.HydraPlayer.start(${safeProject},{canvasId:"game-canvas"});
  document.documentElement.dataset.hydraPlayer = "ready";
} catch (error) {
  document.documentElement.dataset.hydraPlayer = "error";
  const message = document.createElement("pre");
  message.textContent = "Hydra export failed to start: " + (error && error.message ? error.message : error);
  message.style.cssText = "position:fixed;left:16px;right:16px;bottom:16px;z-index:10;padding:12px;border-radius:8px;background:#7f1d1d;color:#fee2e2;white-space:pre-wrap";
  document.body.appendChild(message);
  console.error(error);
}
</script>
</body>
</html>`;
  }

  function buildRetroFpsHtml(project) {
    const title = escapeHtml(project?.name || 'Hydra FPS');
    const cfg = JSON.stringify(project?.fpsConfig || {}).replace(/</g, '\\u003c');
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
:root{color-scheme:dark;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#080912;color:#f8fafc}
body{margin:0;overflow:hidden;background:#080912}
canvas{display:block;width:100vw;height:100vh;background:#090b12;cursor:crosshair}
.hud{position:fixed;inset:0;pointer-events:none;color:#f8fafc;text-shadow:0 2px 8px #000}
.top{position:absolute;left:16px;top:14px;display:flex;gap:10px;align-items:center;font-size:13px;font-weight:900}
.chip{padding:8px 10px;border:1px solid rgba(255,255,255,.18);border-radius:8px;background:rgba(12,16,28,.62);backdrop-filter:blur(10px)}
.objective{position:absolute;right:16px;top:14px;max-width:340px;padding:10px 12px;border-radius:8px;background:rgba(12,16,28,.72);border:1px solid rgba(255,255,255,.16);font-size:13px;font-weight:800}
.reticle{position:absolute;left:50%;top:50%;width:18px;height:18px;margin:-9px 0 0 -9px}
.reticle:before,.reticle:after{content:"";position:absolute;background:#e2e8f0;box-shadow:0 0 8px rgba(255,255,255,.7)}
.reticle:before{left:8px;top:0;width:2px;height:18px}.reticle:after{left:0;top:8px;width:18px;height:2px}
.weapon{position:absolute;left:50%;bottom:0;width:280px;height:190px;margin-left:-140px;border-radius:120px 120px 0 0;background:linear-gradient(135deg,#172033,#0f172a 42%,#334155);box-shadow:0 -18px 50px rgba(0,0,0,.5),inset 0 0 0 3px rgba(255,255,255,.08)}
.bar{position:absolute;left:16px;bottom:16px;display:flex;gap:12px;align-items:end}
.meter{width:180px;height:12px;border:1px solid rgba(255,255,255,.2);background:#111827;border-radius:999px;overflow:hidden}
.meter span{display:block;height:100%;background:linear-gradient(90deg,#22c55e,#facc15,#ef4444)}
.center-msg{position:absolute;left:50%;top:18%;transform:translateX(-50%);padding:10px 14px;border-radius:8px;background:rgba(2,6,23,.75);border:1px solid rgba(255,255,255,.18);font-weight:900;letter-spacing:.02em}
.help{position:absolute;left:50%;bottom:22px;transform:translateX(-50%);font-size:12px;color:#cbd5e1;background:rgba(2,6,23,.52);padding:7px 10px;border-radius:999px}
</style>
</head>
<body>
<canvas id="game"></canvas>
<div class="hud">
  <div class="top"><div class="chip" id="score">Score 0</div><div class="chip" id="ammo">Ammo 24</div><div class="chip" id="wave">Wave 1</div></div>
  <div class="objective" id="objective">Collect reactor cores and clear the arena.</div>
  <div class="reticle"></div><div class="weapon" id="weapon"></div>
  <div class="bar"><div><div style="font-size:12px;font-weight:900;margin-bottom:6px">HEALTH</div><div class="meter"><span id="health"></span></div></div></div>
  <div class="center-msg" id="message">Click to lock pointer and start</div>
  <div class="help">WASD move · mouse/arrow keys look · click/space shoot · R reload · Shift dash</div>
</div>
<script>
(() => {
const cfg=${cfg};
const canvas=document.getElementById('game'),ctx=canvas.getContext('2d');
const ui={score:document.getElementById('score'),ammo:document.getElementById('ammo'),wave:document.getElementById('wave'),health:document.getElementById('health'),objective:document.getElementById('objective'),msg:document.getElementById('message'),weapon:document.getElementById('weapon')};
const map=(cfg.map||[
"1111111111111111",
"1000000002000001",
"1011110101110101",
"1000010100010101",
"1011010111010101",
"1001000000010001",
"1101011111010111",
"1001000001010001",
"1011110101011101",
"1000000100000001",
"1011111111011101",
"1000000001000001",
"1010111101110101",
"1000100000000301",
"1000000000000001",
"1111111111111111"]).map(r=>r.split('').map(Number));
const colors={1:'#6b7280',2:'#7c3aed',3:'#10b981'};
const keys=new Set(),shots=[];let W=0,H=0,last=0,flash=0,shake=0,won=false,over=false;
const player={x:2.4,y:2.5,a:0,hp:100,ammo:24,maxAmmo:24,score:0,cores:0,wave:1,cool:0,reload:0,dash:0};
const enemies=[
 {x:8.5,y:2.5,hp:2,t:0,kind:0},{x:12.5,y:5.5,hp:2,t:0,kind:1},{x:6.5,y:9.5,hp:2,t:0,kind:0},
 {x:13.5,y:12.5,hp:3,t:0,kind:1},{x:3.5,y:13.5,hp:2,t:0,kind:0},{x:10.5,y:13.5,hp:3,t:0,kind:1}
];
const pickups=[{x:4.5,y:4.5,type:'core'},{x:13.5,y:3.5,type:'ammo'},{x:3.5,y:10.5,type:'med'},{x:11.5,y:11.5,type:'core'},{x:6.5,y:13.5,type:'core'},{x:14.5,y:8.5,type:'ammo'}];
function resize(){W=canvas.width=innerWidth*devicePixelRatio;H=canvas.height=innerHeight*devicePixelRatio;ctx.imageSmoothingEnabled=false} addEventListener('resize',resize);resize();
addEventListener('keydown',e=>{keys.add(e.code);if(e.code==='Space')shoot();if(e.code==='KeyR')reload()});
addEventListener('keyup',e=>keys.delete(e.code));
canvas.addEventListener('click',()=>{canvas.requestPointerLock?.();shoot();ui.msg.style.display='none'});
addEventListener('mousemove',e=>{if(document.pointerLockElement===canvas)player.a+=e.movementX*0.0025});
function cell(x,y){return map[Math.floor(y)]?.[Math.floor(x)]||1}
function solid(x,y){const c=cell(x,y);return c===1||c===2}
function move(dx,dy){const nx=player.x+dx,ny=player.y+dy;if(!solid(nx,player.y))player.x=nx;if(!solid(player.x,ny))player.y=ny}
function cast(a){let x=player.x,y=player.y,dx=Math.cos(a)*0.035,dy=Math.sin(a)*0.035,d=0,c=0;while(d<20){x+=dx;y+=dy;d+=0.035;c=cell(x,y);if(c)break}return{d,c,x,y}}
function reload(){if(player.reload<=0&&player.ammo<player.maxAmmo){player.reload=.8;ui.msg.textContent='Reloading';ui.msg.style.display='block';setTimeout(()=>ui.msg.style.display='none',650)}}
function shoot(){if(over||won||player.cool>0||player.reload>0)return;if(player.ammo<=0){reload();return}player.ammo--;player.cool=.16;flash=.09;shake=.14;ui.weapon.style.transform='translateY(12px) scale(1.04)';setTimeout(()=>ui.weapon.style.transform='',90);let best=null,bestDot=.985;for(const e of enemies){if(e.hp<=0)continue;const ang=Math.atan2(e.y-player.y,e.x-player.x);const dot=Math.cos(norm(ang-player.a));const dist=Math.hypot(e.x-player.x,e.y-player.y);if(dot>bestDot&&dist<10&&!wallBetween(e.x,e.y)){best=e;bestDot=dot}}if(best){best.hp--;player.score+=best.hp<=0?150:35;ui.msg.textContent=best.hp<=0?'Drone down':'+ hit';ui.msg.style.display='block';setTimeout(()=>ui.msg.style.display='none',260)}}
function wallBetween(x,y){const steps=Math.ceil(Math.hypot(x-player.x,y-player.y)*12);for(let i=1;i<steps;i++){const t=i/steps;if(solid(player.x+(x-player.x)*t,player.y+(y-player.y)*t))return true}return false}
function norm(a){while(a>Math.PI)a-=Math.PI*2;while(a<-Math.PI)a+=Math.PI*2;return a}
function update(dt){if(over||won)return;player.cool=Math.max(0,player.cool-dt);player.reload=Math.max(0,player.reload-dt);if(player.reload===0&&ui.msg.textContent==='Reloading')player.ammo=player.maxAmmo;const speed=(keys.has('ShiftLeft')&&player.dash<=0)?0.09:0.045;if(keys.has('ShiftLeft')&&player.dash<=0)player.dash=.9;player.dash=Math.max(0,player.dash-dt);if(keys.has('ArrowLeft'))player.a-=2.4*dt;if(keys.has('ArrowRight'))player.a+=2.4*dt;let mx=0,my=0;if(keys.has('KeyW')){mx+=Math.cos(player.a);my+=Math.sin(player.a)}if(keys.has('KeyS')){mx-=Math.cos(player.a);my-=Math.sin(player.a)}if(keys.has('KeyA')){mx+=Math.cos(player.a-Math.PI/2);my+=Math.sin(player.a-Math.PI/2)}if(keys.has('KeyD')){mx+=Math.cos(player.a+Math.PI/2);my+=Math.sin(player.a+Math.PI/2)}const m=Math.hypot(mx,my)||1;move(mx/m*speed*dt*60,my/m*speed*dt*60);for(const e of enemies){if(e.hp<=0)continue;const dist=Math.hypot(e.x-player.x,e.y-player.y);if(dist<8&&!wallBetween(e.x,e.y)){const vx=(player.x-e.x)/dist,vy=(player.y-e.y)/dist;if(dist>.75&&!solid(e.x+vx*.018*dt*60,e.y))e.x+=vx*.018*dt*60;if(dist>.75&&!solid(e.x,e.y+vy*.018*dt*60))e.y+=vy*.018*dt*60;if(dist<.85){player.hp-=18*dt;shake=.08}}else{e.t+=dt;e.x+=Math.cos(e.t+e.kind)*.004*dt*60;e.y+=Math.sin(e.t*.7+e.kind)*.004*dt*60}}for(const p of pickups){if(p.done)continue;if(Math.hypot(p.x-player.x,p.y-player.y)<.55){p.done=true;if(p.type==='core'){player.cores++;player.score+=250}else if(p.type==='ammo')player.ammo=player.maxAmmo;else player.hp=Math.min(100,player.hp+35)}}if(player.cores>=3)map[13][13]=0;if(player.cores>=3&&player.x>13&&player.y>13){won=true;ui.msg.textContent='Arena cleared';ui.msg.style.display='block'}if(player.hp<=0){over=true;ui.msg.textContent='Simulation failed - press refresh';ui.msg.style.display='block'}}
function draw(){ctx.fillStyle='#111827';ctx.fillRect(0,0,W,H/2);ctx.fillStyle='#1f2937';ctx.fillRect(0,H/2,W,H/2);const cols=Math.floor(W/4),fov=Math.PI/3;for(let i=0;i<cols;i++){const a=player.a-fov/2+fov*i/cols,r=cast(a),dist=r.d*Math.cos(a-player.a),h=Math.min(H,H/(dist*.8)),x=i*4,y=(H-h)/2;const shade=Math.max(.22,1-dist/14);ctx.fillStyle=shadeColor(colors[r.c]||'#475569',shade);ctx.fillRect(x,y,5,h)}const sprites=[];for(const e of enemies)if(e.hp>0)sprites.push({...e,type:'enemy',d:Math.hypot(e.x-player.x,e.y-player.y)});for(const p of pickups)if(!p.done)sprites.push({...p,d:Math.hypot(p.x-player.x,p.y-player.y)});sprites.sort((a,b)=>b.d-a.d).forEach(s=>drawSprite(s));if(flash>0){ctx.fillStyle='rgba(250,204,21,.35)';ctx.beginPath();ctx.arc(W/2,H*.62,90*devicePixelRatio,0,7);ctx.fill()}drawMini();ui.score.textContent='Score '+player.score;ui.ammo.textContent='Ammo '+(player.reload>0?'...':player.ammo);ui.wave.textContent='Wave '+player.wave;ui.health.style.width=Math.max(0,player.hp)+'%';ui.objective.textContent=player.cores<3?'Collect reactor cores: '+player.cores+'/3 · Drones left: '+enemies.filter(e=>e.hp>0).length:'Exit opened - reach the green gate';}
function drawSprite(s){const ang=norm(Math.atan2(s.y-player.y,s.x-player.x)-player.a),dist=s.d;if(Math.abs(ang)>Math.PI/2||dist<.1)return;const size=H/(dist*1.2),x=W/2+Math.tan(ang)*(W*.78)-size/2,y=H/2-size*.42;ctx.fillStyle=s.type==='enemy'?'#ef4444':s.type==='core'?'#a78bfa':s.type==='ammo'?'#facc15':'#22c55e';ctx.fillRect(x,y,size,size);ctx.fillStyle='rgba(255,255,255,.28)';ctx.fillRect(x+size*.18,y+size*.18,size*.22,size*.22)}
function drawMini(){const S=7*devicePixelRatio,ox=W-130*devicePixelRatio,oy=H-130*devicePixelRatio;ctx.globalAlpha=.82;for(let y=0;y<map.length;y++)for(let x=0;x<map[y].length;x++){ctx.fillStyle=cell(x,y)?'#475569':'#0f172a';ctx.fillRect(ox+x*S,oy+y*S,S-1,S-1)}ctx.fillStyle='#38bdf8';ctx.fillRect(ox+player.x*S-2,oy+player.y*S-2,4,4);ctx.globalAlpha=1}
function shadeColor(hex,s){const n=parseInt(hex.slice(1),16),r=(n>>16)*s,g=((n>>8)&255)*s,b=(n&255)*s;return 'rgb('+r+','+g+','+b+')'}
function loop(t){const dt=Math.min(.05,(t-last)/1000||.016);last=t;flash=Math.max(0,flash-dt);shake=Math.max(0,shake-dt);update(dt);draw();requestAnimationFrame(loop)}requestAnimationFrame(loop);
})();
</script>
</body>
</html>`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  global.HydraPlayer = { start, buildPlayableHtml };
})(typeof window !== 'undefined' ? window : globalThis);
