/* ============================================================================
 * hydra-pick.js — HydraScript shared object picking and selection.
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation of
 * the pick-block semantics used by:
 *   - the editor preview runtime (script.js delegates to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Blocks (all in the Object palette category, kind 'condition' — picking is
 * done through conditions because a triggered condition hands its picked
 * object to chained actions via the execution context: an action placed next
 * to a pick block with the same Object name applies ONLY to the picked
 * object, using the action's normal Target picker default):
 *   - Pick Nearest (condition): picks the nearest live object with the given
 *     name to a reference — the named Near object, or the X/Y point when the
 *     Near object is blank. Fires while at least one live object exists.
 *   - Pick Farthest (condition): the same, but picks the furthest object.
 *   - Pick Random (condition): picks a uniformly random live object with the
 *     given name. Edge-triggered by default (fires once per appearance),
 *     so chained actions hit exactly one object; switch the trigger mode to
 *     'level' for a fresh random pick every frame.
 *   - pickObject (P5-5 slice a, for the Pick Object Into Variable action):
 *     the same pick without the condition wrapper — one live object by
 *     mode, or null when nothing can be picked. The action stores the
 *     winner in a variable and points the execution context at it, so
 *     the rest of the chain targets that one object.
 *   - Pick Nearest Tagged / Pick Farthest Tagged / Pick Random Tagged
 *     (P4 Advanced batch 35: pick objects by tag): the same three picks,
 *     but the candidates are the live objects carrying a tag instead of
 *     the live objects with a name — the group a tag names, whatever the
 *     members are called. A chained action names the picked object's
 *     name, the same rule as the name picks; when the tagged objects
 *     have different names, hold the pick in a variable instead
 *     (pickTaggedObject, below) and read it with Read Object Property.
 *   - pickTaggedObject (batch 35, for the Pick Tagged Object Into
 *     Variable action): the tag pick without the condition wrapper —
 *     one live tagged object by mode, or null when nothing can be
 *     picked. The action stores the winner in a variable and points
 *     the execution context at it, so the rest of the chain targets
 *     that one object.
 *
 * Conventions (kept identical in preview and exports):
 *   - Nothing here ever throws; hostile input produces a safe fallback.
 *   - A blank object name, no live objects, or a missing/broken reference
 *     keeps the condition quiet (no per-frame warning spam) — like the
 *     timer conditions, which stay quiet on blank names.
 *   - Ties resolve to the first object in live order (deterministic).
 *   - The hooks contract: liveObjects(name) returns the host's live objects
 *     with that name (destroyed objects already excluded by the host);
 *     num(raw) evaluates an expression like the other shared modules;
 *     warn(msg) reports a runtime diagnostic.
 *
 * Load order (index.html): hydra-pick.js BEFORE player-runtime.js and
 * script.js. player-runtime.js throws a clear error if HydraPick is missing.
 * ========================================================================== */

function hydraPickFactory() {
  'use strict';

  var CONDITION_TYPES = ['pickNearest', 'pickFarthest', 'pickRandom'];

  // P4 Advanced batch 35 (pick objects by tag): the tag-pick
  // conditions — the same three picks, but the candidates are the
  // live objects carrying a tag instead of the live objects with a
  // name. The hosts hand them their candidates through the
  // pickHooks' liveObjectsByTag(tag) hook; a host without it falls
  // back to filtering allLiveObjects() with the matcher below, so
  // the module stays usable with either hook shape.
  var TAG_PICK_CONDITION_TYPES = ['pickNearestTagged', 'pickFarthestTagged', 'pickRandomTagged'];

  function isPickTaggedCondition(t) { return TAG_PICK_CONDITION_TYPES.indexOf(t) >= 0; }

  // P5-5 slice a (object references as values): the pick modes the
  // Pick Object Into Variable action offers — nearest / farthest /
  // random / first among the live objects with a name. 'first' is
  // the live order's first object, so a single object of that name
  // is picked without needing a reference point.
  var PICK_MODES = ['nearest', 'farthest', 'random', 'first'];

  function isPickCondition(t) { return CONDITION_TYPES.indexOf(t) >= 0 || TAG_PICK_CONDITION_TYPES.indexOf(t) >= 0; }

  // The pick mode, or 'nearest' for anything unrecognized — the
  // mode select constrains it in the editor, so anything else is
  // hostile data, and nearest is the useful default.
  function normalizePickMode(mode) {
    var m = (typeof mode === 'string') ? mode.trim().toLowerCase() : '';
    return PICK_MODES.indexOf(m) !== -1 ? m : 'nearest';
  }

  function nameOf(data, key) {
    return String((data && data[key]) || '').trim();
  }

  // Hitbox center, null-safe. Bad fields collapse to 0 — never throws.
  function objectCenter(obj) {
    if (!obj || typeof obj !== 'object') return { x: 0, y: 0 };
    var x = Number(obj.posX), y = Number(obj.posY);
    var w = Number(obj.width), h = Number(obj.height);
    return {
      x: (Number.isFinite(x) ? x : 0) + (Number.isFinite(w) ? w : 0) / 2,
      y: (Number.isFinite(y) ? y : 0) + (Number.isFinite(h) ? h : 0) / 2
    };
  }

  function distSq(a, b) {
    var dx = a.x - b.x, dy = a.y - b.y;
    return dx * dx + dy * dy;
  }

  function pickNearest(objects, refX, refY) {
    if (!Array.isArray(objects) || objects.length === 0) return null;
    var ref = { x: refX, y: refY };
    var best = null, bestD = Infinity;
    for (var i = 0; i < objects.length; i++) {
      var o = objects[i];
      if (!o || typeof o !== 'object') continue;
      var d = distSq(objectCenter(o), ref);
      if (d < bestD) { bestD = d; best = o; }
    }
    return best;
  }

  function pickFarthest(objects, refX, refY) {
    if (!Array.isArray(objects) || objects.length === 0) return null;
    var ref = { x: refX, y: refY };
    var best = null, bestD = -Infinity;
    for (var i = 0; i < objects.length; i++) {
      var o = objects[i];
      if (!o || typeof o !== 'object') continue;
      var d = distSq(objectCenter(o), ref);
      if (d > bestD) { bestD = d; best = o; }
    }
    return best;
  }

  // Uniform random pick. Empty lists (or all-hostile entries) give null.
  function pickRandom(objects) {
    if (!Array.isArray(objects)) return null;
    var live = [];
    for (var i = 0; i < objects.length; i++) {
      if (objects[i] && typeof objects[i] === 'object') live.push(objects[i]);
    }
    if (live.length === 0) return null;
    return live[Math.floor(Math.random() * live.length)];
  }

  function liveOf(hooks, name) {
    var list = null;
    try { list = hooks.liveObjects(name); } catch (e) { list = null; }
    if (!Array.isArray(list)) return [];
    return list.filter(function (o) { return o && typeof o === 'object'; });
  }

  // ---------- condition dispatch (read-only; never creates or moves objects) ----------
  //
  // Returns { pass, context }. On a pass, context.obj1 is the picked object,
  // so chained actions with the same object name target only it (the
  // runtimes' normal context-mode target resolution).
  function evalPickCondition(data, hooks) {
    var ctx = {};
    function quiet() { return { pass: false, context: ctx }; }
    if (!data || typeof data !== 'object') return quiet();
    var type = data.type;
    if (CONDITION_TYPES.indexOf(type) < 0) return quiet();

    var live = liveOf(hooks, nameOf(data, 'objectName'));
    if (live.length === 0) return quiet();

    if (type === 'pickRandom') {
      var picked = pickRandom(live);
      if (!picked) return quiet();
      return { pass: true, context: { obj1: picked } };
    }

    // pickNearest / pickFarthest: resolve the reference point. The named
    // Near object wins when it names a live object; otherwise the X/Y point
    // is used. Bad references stay quiet instead of guessing.
    var rx = 0, ry = 0;
    var refName = nameOf(data, 'nearObject');
    if (refName) {
      var refLive = liveOf(hooks, refName);
      if (refLive.length === 0) return quiet();
      var c = objectCenter(refLive[0]);
      rx = c.x; ry = c.y;
    } else {
      var xi = hooks.num(data.pointX), yi = hooks.num(data.pointY);
      if (!xi || !xi.ok || !Number.isFinite(xi.value) ||
          !yi || !yi.ok || !Number.isFinite(yi.value)) return quiet();
      rx = xi.value; ry = yi.value;
    }

    var winner = (type === 'pickFarthest')
      ? pickFarthest(live, rx, ry)
      : pickNearest(live, rx, ry);
    if (!winner) return quiet();
    return { pass: true, context: { obj1: winner } };
  }

  // ---------- tag picks (P4 Advanced batch 35) ---------------------------
  //
  // The tag matcher, mirroring HydraTags.hasTag exactly (trimmed,
  // case-insensitive, a blank tag never matches) so a host that
  // filters with the fallback below agrees with a host that filters
  // through HydraTags. Never throws.
  function tagMatches(obj, tag) {
    try {
      if (!obj || typeof obj !== 'object') return false;
      if (typeof tag !== 'string') return false;
      var t = tag.trim().toLowerCase();
      if (t === '') return false;
      var list = obj.tags;
      if (!Array.isArray(list)) return false;
      for (var i = 0; i < list.length; i++) {
        if (typeof list[i] === 'string' && list[i].trim().toLowerCase() === t) return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  // Every object in the list carrying the tag, in list order. A
  // blank tag or a non-array reads as none — a blank tag names no
  // group. Never throws.
  function objectsWithTagValue(objects, tag) {
    try {
      if (!Array.isArray(objects)) return [];
      if (typeof tag !== 'string' || tag.trim() === '') return [];
      var out = [];
      for (var i = 0; i < objects.length; i++) {
        if (tagMatches(objects[i], tag)) out.push(objects[i]);
      }
      return out;
    } catch (e) {
      return [];
    }
  }

  function pickNearestTagged(objects, tag, refX, refY) {
    return pickNearest(objectsWithTagValue(objects, tag), refX, refY);
  }

  function pickFarthestTagged(objects, tag, refX, refY) {
    return pickFarthest(objectsWithTagValue(objects, tag), refX, refY);
  }

  function pickRandomTagged(objects, tag) {
    return pickRandom(objectsWithTagValue(objects, tag));
  }

  // The live tagged objects from the hooks: liveObjectsByTag(tag)
  // when the host supplies it, else the allLiveObjects() list
  // filtered with the matcher above, else none — a host with
  // neither hook stays quiet instead of guessing. A blank tag
  // names no group. Never throws.
  function liveTaggedOf(hooks, tag) {
    var t = (typeof tag === 'string') ? tag.trim() : '';
    if (t === '') return [];
    var list = null;
    try {
      if (hooks && typeof hooks.liveObjectsByTag === 'function') {
        list = hooks.liveObjectsByTag(tag);
      }
    } catch (e) { list = null; }
    if (Array.isArray(list)) {
      return list.filter(function (o) { return o && typeof o === 'object'; });
    }
    var all = null;
    try {
      if (hooks && typeof hooks.allLiveObjects === 'function') {
        all = hooks.allLiveObjects();
      }
    } catch (e) { all = null; }
    if (!Array.isArray(all)) return [];
    return objectsWithTagValue(all, tag);
  }

  // ---------- tag-pick condition dispatch (read-only) ----------
  //
  // Returns { pass, context } like evalPickCondition, with the
  // picked tagged object as context.obj1 on a pass, so chained
  // actions with the picked object's name target only it. A blank
  // tag, no live tagged objects, or a missing/broken reference
  // keeps the condition quiet — like the name picks, which stay
  // quiet on blank names.
  function evalPickTaggedCondition(data, hooks) {
    var ctx = {};
    function quiet() { return { pass: false, context: ctx }; }
    if (!data || typeof data !== 'object') return quiet();
    var type = data.type;
    if (TAG_PICK_CONDITION_TYPES.indexOf(type) < 0) return quiet();

    var live = liveTaggedOf(hooks, data.tag);
    if (live.length === 0) return quiet();

    if (type === 'pickRandomTagged') {
      var picked = pickRandom(live);
      if (!picked) return quiet();
      return { pass: true, context: { obj1: picked } };
    }

    // pickNearestTagged / pickFarthestTagged: resolve the reference
    // point exactly the way the name picks do — the named Near
    // object wins when it names a live object, otherwise the X/Y
    // point. Bad references stay quiet instead of guessing.
    var rx = 0, ry = 0;
    var refName = nameOf(data, 'nearObject');
    if (refName) {
      var refLive = liveOf(hooks, refName);
      if (refLive.length === 0) return quiet();
      var c = objectCenter(refLive[0]);
      rx = c.x; ry = c.y;
    } else {
      var xi = hooks.num(data.pointX), yi = hooks.num(data.pointY);
      if (!xi || !xi.ok || !Number.isFinite(xi.value) ||
          !yi || !yi.ok || !Number.isFinite(yi.value)) return quiet();
      rx = xi.value; ry = yi.value;
    }

    var winner = (type === 'pickFarthestTagged')
      ? pickFarthest(live, rx, ry)
      : pickNearest(live, rx, ry);
    if (!winner) return quiet();
    return { pass: true, context: { obj1: winner } };
  }

  // ---------- action pick by tag ----------
  //
  // pickTaggedObject(data, hooks): the tag pick without the
  // condition wrapper — one live tagged object by mode, or null
  // when nothing can be picked. The caller decides what silence
  // means (the action warns on a blank tag itself, but stays quiet
  // when no live tagged object exists, like the pick conditions).
  // data: { tag, pickMode, nearObject, pointX, pointY }. Random
  // and first need no reference point; nearest and farthest read
  // it the way the pick conditions do.
  function pickTaggedObject(data, hooks) {
    if (!data || typeof data !== 'object') return null;
    var live = liveTaggedOf(hooks, data.tag);
    if (live.length === 0) return null;
    var mode = normalizePickMode(data.pickMode);
    if (mode === 'random') return pickRandom(live);
    if (mode === 'first') return live[0] || null;

    var rx = 0, ry = 0;
    var refName = nameOf(data, 'nearObject');
    if (refName) {
      var refLive = liveOf(hooks, refName);
      if (refLive.length === 0) return null;
      var c = objectCenter(refLive[0]);
      rx = c.x; ry = c.y;
    } else {
      var xi = hooks.num(data.pointX), yi = hooks.num(data.pointY);
      if (!xi || !xi.ok || !Number.isFinite(xi.value) ||
          !yi || !yi.ok || !Number.isFinite(yi.value)) return null;
      rx = xi.value; ry = yi.value;
    }
    return (mode === 'farthest')
      ? pickFarthest(live, rx, ry)
      : pickNearest(live, rx, ry);
  }

  // ---------- action pick (P5-5 slice a: object references as values) ----------
  //
  // Pick Object Into Variable needs the same pick, minus the
  // condition wrapper: one live object, chosen by mode, or null
  // when nothing can be picked. The caller decides what silence
  // means (the action warns on a blank name itself, but stays
  // quiet when no live object exists, like the pick conditions).
  // data: { objectName, pickMode, nearObject, pointX, pointY }.
  // hooks: the pickHooks shape — liveObjects(name), num(raw),
  // warn(msg). Random and first need no reference point; nearest
  // and farthest read it the way the pick conditions do (the named
  // Near object wins when it names a live object, otherwise the
  // X/Y point; a bad reference picks nothing instead of guessing).
  function pickObject(data, hooks) {
    if (!data || typeof data !== 'object') return null;
    var live = liveOf(hooks, nameOf(data, 'objectName'));
    if (live.length === 0) return null;
    var mode = normalizePickMode(data.pickMode);
    if (mode === 'random') return pickRandom(live);
    if (mode === 'first') return live[0] || null;

    var rx = 0, ry = 0;
    var refName = nameOf(data, 'nearObject');
    if (refName) {
      var refLive = liveOf(hooks, refName);
      if (refLive.length === 0) return null;
      var c = objectCenter(refLive[0]);
      rx = c.x; ry = c.y;
    } else {
      var xi = hooks.num(data.pointX), yi = hooks.num(data.pointY);
      if (!xi || !xi.ok || !Number.isFinite(xi.value) ||
          !yi || !yi.ok || !Number.isFinite(yi.value)) return null;
      rx = xi.value; ry = yi.value;
    }
    return (mode === 'farthest')
      ? pickFarthest(live, rx, ry)
      : pickNearest(live, rx, ry);
  }

  return {
    CONDITION_TYPES: CONDITION_TYPES,
    TAG_PICK_CONDITION_TYPES: TAG_PICK_CONDITION_TYPES,
    PICK_MODES: PICK_MODES,
    isPickCondition: isPickCondition,
    isPickTaggedCondition: isPickTaggedCondition,
    normalizePickMode: normalizePickMode,
    objectCenter: objectCenter,
    tagMatches: tagMatches,
    objectsWithTagValue: objectsWithTagValue,
    pickNearest: pickNearest,
    pickFarthest: pickFarthest,
    pickRandom: pickRandom,
    pickNearestTagged: pickNearestTagged,
    pickFarthestTagged: pickFarthestTagged,
    pickRandomTagged: pickRandomTagged,
    evalPickCondition: evalPickCondition,
    evalPickTaggedCondition: evalPickTaggedCondition,
    pickObject: pickObject,
    pickTaggedObject: pickTaggedObject
  };
}

window.HydraPick = hydraPickFactory();
// Self-contained source of the factory, inlined into exported playable games
// by HydraPlayer.buildPlayableHtml so exports run without editor files.
window.HydraPick.factorySource = hydraPickFactory.toString();
