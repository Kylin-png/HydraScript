/* ============================================================================
 * hydra-physics2d.js — HydraScript physics upgrade (P4 item 32).
 *
 * Pure logic, no DOM access. Single canonical source for the 2D collision
 * upgrade used by the editor (script.js: preview runtime + inspector) and
 * the exported player runtime (player-runtime.js). Exported games inline
 * factorySource via HydraPlayer.buildPlayableHtml, so exports never depend
 * on editor files.
 *
 * What lives here:
 *   - collision fields on obj.collision: shape ('box'|'circle'), mode
 *     ('solid'|'trigger'), oneWay (one-way platforms), layer (0-7),
 *     mask (bitmask of layers this object collides with)
 *   - shape-aware overlap tests: box/box, circle/circle, box/circle
 *   - collision resolution: cross-from-side for box pairs (the engine's
 *     long-standing behavior), MTV push for pairs with a circle, one-way
 *     platforms that only catch bodies falling onto them from above
 *   - triggers: solid colliders block movement; trigger colliders never
 *     block — they only report contacts (Trigger Enter / Trigger Exit)
 *   - collision layers + masks: pairs only interact when each object's
 *     mask includes the other's layer
 *   - raycasts and circle-overlap queries for gameplay code
 *
 * Backward compatibility: every new field defaults so old projects behave
 * exactly as before — box shape, solid mode, not one-way, layer 0, mask
 * 255 (all layers). Corrupt fields are repaired, never thrown on.
 *
 * Load order (index.html): hydra-physics2d.js BEFORE player-runtime.js and
 * script.js. player-runtime.js throws a clear error if HydraPhysics2D is
 * missing.
 * ========================================================================== */

function hydraPhysics2dFactory() {
  'use strict';

  var LAYER_COUNT = 8;
  var ALL_MASK = (1 << LAYER_COUNT) - 1; // 255

  function num(v, dflt) {
    if (v == null) return dflt; // null/undefined means "missing", not 0
    var n = Number(v);
    return isFinite(n) ? n : dflt;
  }

  function clampLayer(v) {
    var n = Math.floor(num(v, 0));
    if (n < 0) return 0;
    if (n >= LAYER_COUNT) return LAYER_COUNT - 1;
    return n;
  }

  function clampMask(v) {
    var n = Math.floor(num(v, ALL_MASK));
    if (n < 0) return 0;
    if (n > ALL_MASK) return ALL_MASK;
    return n;
  }

  // Repair obj.collision's physics-upgrade fields in place. Old projects
  // (which never stored these fields) get the classic behavior: box, solid,
  // not one-way, layer 0, mask all. Never throws.
  function normalizePhysics2d(obj) {
    try {
      if (!obj || typeof obj !== 'object') return obj;
      var c = obj.collision;
      if (!c || typeof c !== 'object') { obj.collision = c = {}; }
      c.shape = (c.shape === 'circle') ? 'circle' : 'box';
      c.mode = (c.mode === 'trigger') ? 'trigger' : 'solid';
      c.oneWay = c.oneWay === true;
      c.layer = clampLayer(c.layer);
      c.mask = clampMask(c.mask);
      // enabled stays whatever the engine already normalized.
      return obj;
    } catch (e) { return obj; }
  }

  // The AABB hitbox shared by every shape (same math as the runtimes).
  function hitboxOf(obj) {
    var w = num(obj && obj.hitboxWidth, 0) > 0 ? num(obj.hitboxWidth, 0) : num(obj && obj.width, 1);
    var h = num(obj && obj.hitboxHeight, 0) > 0 ? num(obj.hitboxHeight, 0) : num(obj && obj.height, 1);
    return {
      x: num(obj && obj.posX, 0) + num(obj && obj.hitboxOffsetX, 0),
      y: num(obj && obj.posY, 0) + num(obj && obj.hitboxOffsetY, 0),
      width: w,
      height: h
    };
  }

  // Circle collider: centered on the hitbox, radius = half the smaller side.
  function circleOf(obj) {
    var hb = hitboxOf(obj);
    return {
      cx: hb.x + hb.width / 2,
      cy: hb.y + hb.height / 2,
      r: Math.max(0.5, Math.min(hb.width, hb.height) / 2)
    };
  }

  function shapeOf(obj) {
    return (obj && obj.collision && obj.collision.shape === 'circle') ? 'circle' : 'box';
  }

  function isTrigger(obj) {
    return !!(obj && obj.collision && obj.collision.mode === 'trigger');
  }

  function isOneWay(obj) {
    return !!(obj && obj.collision && obj.collision.oneWay === true);
  }

  function layerOf(obj) {
    return clampLayer(obj && obj.collision && obj.collision.layer);
  }

  function maskOf(obj) {
    return clampMask(obj && obj.collision && obj.collision.mask);
  }

  function layerBit(layer) {
    return 1 << clampLayer(layer);
  }

  // Two objects interact only when each object's mask includes the other's
  // layer. Default (layer 0, mask 255) means everything collides with
  // everything — the pre-upgrade behavior.
  function canCollide(a, b) {
    try {
      return (maskOf(a) & layerBit(layerOf(b))) !== 0 &&
             (maskOf(b) & layerBit(layerOf(a))) !== 0;
    } catch (e) { return true; }
  }

  function boxBoxOverlap(ab, bb) {
    var dx = (ab.x + ab.width / 2) - (bb.x + bb.width / 2);
    var dy = (ab.y + ab.height / 2) - (bb.y + bb.height / 2);
    var ox = (ab.width / 2 + bb.width / 2) - Math.abs(dx);
    var oy = (ab.height / 2 + bb.height / 2) - Math.abs(dy);
    if (ox <= 0 || oy <= 0) return null;
    return ox < oy
      ? { nx: dx >= 0 ? 1 : -1, ny: 0, depth: ox }
      : { nx: 0, ny: dy >= 0 ? 1 : -1, depth: oy };
  }

  function circleCircleOverlap(ca, cb) {
    var dx = ca.cx - cb.cx, dy = ca.cy - cb.cy;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var minDist = ca.r + cb.r;
    if (dist >= minDist) return null;
    var depth = minDist - dist;
    var nx, ny;
    if (dist > 1e-6) { nx = dx / dist; ny = dy / dist; }
    else { nx = 0; ny = -1; } // centers coincide: push straight up
    return { nx: nx, ny: ny, depth: depth };
  }

  // Circle A vs box B (boxes given as {x,y,width,height}).
  function circleBoxOverlap(c, b) {
    var closestX = Math.max(b.x, Math.min(c.cx, b.x + b.width));
    var closestY = Math.max(b.y, Math.min(c.cy, b.y + b.height));
    var dx = c.cx - closestX, dy = c.cy - closestY;
    var distSq = dx * dx + dy * dy;
    if (distSq >= c.r * c.r) return null;
    var depth, nx, ny;
    if (distSq > 1e-9) {
      var dist = Math.sqrt(distSq);
      depth = c.r - dist;
      nx = dx / dist; ny = dy / dist;
    } else {
      // Circle center is inside the box: push out along the shallowest axis.
      var left = c.cx - b.x, right = b.x + b.width - c.cx;
      var top = c.cy - b.y, bottom = b.y + b.height - c.cy;
      var m = Math.min(left, right, top, bottom);
      if (m === left) { nx = -1; ny = 0; depth = left + c.r; }
      else if (m === right) { nx = 1; ny = 0; depth = right + c.r; }
      else if (m === top) { nx = 0; ny = -1; depth = top + c.r; }
      else { nx = 0; ny = 1; depth = bottom + c.r; }
    }
    return { nx: nx, ny: ny, depth: depth };
  }

  // Shape-aware overlap between two objects. Returns null or
  // {nx, ny, depth} with the normal pointing from B toward A (the push
  // direction for A). tol expands both shapes by tol px (the collision
  // condition's touching-edges tolerance). Pure: inputs never mutated.
  function pairOverlap(a, b, tol) {
    try {
      if (!a || !b) return null;
      var t = num(tol, 0);
      var sa = shapeOf(a), sb = shapeOf(b);
      if (sa === 'box' && sb === 'box') {
        var ab = hitboxOf(a), bb = hitboxOf(b);
        if (t > 0) {
          ab = { x: ab.x - t, y: ab.y - t, width: ab.width + t * 2, height: ab.height + t * 2 };
          bb = { x: bb.x - t, y: bb.y - t, width: bb.width + t * 2, height: bb.height + t * 2 };
        }
        return boxBoxOverlap(ab, bb);
      }
      if (sa === 'circle' && sb === 'circle') {
        var ca = circleOf(a), cb = circleOf(b);
        ca = { cx: ca.cx, cy: ca.cy, r: ca.r + t };
        cb = { cx: cb.cx, cy: cb.cy, r: cb.r + t };
        return circleCircleOverlap(ca, cb);
      }
      // Mixed pair: circle A vs box B, or box A vs circle B (flip the normal).
      var circ, box, flip;
      if (sa === 'circle') { circ = circleOf(a); box = hitboxOf(b); flip = false; }
      else { circ = circleOf(b); box = hitboxOf(a); flip = true; }
      circ = { cx: circ.cx, cy: circ.cy, r: circ.r + t };
      if (t > 0) box = { x: box.x - t, y: box.y - t, width: box.width + t * 2, height: box.height + t * 2 };
      var ov = circleBoxOverlap(circ, box);
      if (!ov) return null;
      return flip ? { nx: -ov.nx, ny: -ov.ny, depth: ov.depth } : ov;
    } catch (e) { return null; }
  }

  // Resolve a dynamic body against a solid wall. dyn is the object; ds is
  // its current hitbox state {x, y, w, h, velX, velY, prevX, prevY} (x/y are
  // the hitbox top-left, prevX/prevY its previous top-left). Triggers never
  // reach here — the caller routes them to contacts only.
  //
  // One-way platforms resolve ONLY when the body crossed from above and is
  // falling (prevBottom <= wallTop && velY >= 0); everything else passes
  // straight through.
  //
  // Box-vs-box keeps the engine's cross-from-side resolution. Any pair with
  // a circle pushes out along the shape MTV; a circle is "landed" when the
  // push normal points mostly upward (the wall is below it).
  //
  // Returns {x, y, velX, velY, collided, landed, hitHead}. Pure: inputs
  // never mutated.
  function resolvePair(dyn, wall, ds) {
    var out = { x: 0, y: 0, velX: 0, velY: 0, collided: false, landed: false, hitHead: false };
    try {
      if (!dyn || !wall || !ds || typeof ds !== 'object') return out;
      var w = num(ds.w != null ? ds.w : ds.width, 0);
      var h = num(ds.h != null ? ds.h : ds.height, 0);
      if (w <= 0 || h <= 0) return out;
      var x = num(ds.x, 0), y = num(ds.y, 0);
      var vx = num(ds.velX, 0), vy = num(ds.velY, 0);
      var px = isFinite(num(ds.prevX, NaN)) ? num(ds.prevX, x) : x;
      var py = isFinite(num(ds.prevY, NaN)) ? num(ds.prevY, y) : y;

      var sd = shapeOf(dyn), sw = shapeOf(wall);
      var oneWay = isOneWay(wall);

      if (sd === 'box' && sw === 'box') {
        var wallBox = hitboxOf(wall);
        var mtv = boxBoxOverlap({ x: x, y: y, width: w, height: h }, wallBox);
        if (!mtv) return out;
        var fromTop = py + h <= wallBox.y && vy >= 0;
        var fromBottom = py >= wallBox.y + wallBox.height && vy <= 0;
        var fromLeft = px + w <= wallBox.x && vx >= 0;
        var fromRight = px >= wallBox.x + wallBox.width && vx <= 0;
        if (oneWay) {
          if (fromTop) { y = wallBox.y - h; vy = 0; out.landed = true; }
          else return out; // pass through from below / the sides
        } else if (fromTop) {
          y = wallBox.y - h; vy = 0; out.landed = true;
        } else if (fromBottom) {
          y = wallBox.y + wallBox.height; vy = 0; out.hitHead = true;
        } else if (fromLeft) {
          x = wallBox.x - w; vx = 0;
        } else if (fromRight) {
          x = wallBox.x + wallBox.width; vx = 0;
        } else {
          x += mtv.nx * mtv.depth; y += mtv.ny * mtv.depth;
          if (mtv.nx !== 0) vx = 0; else vy = 0;
          if (mtv.ny < 0) out.landed = true;
          if (mtv.ny > 0) out.hitHead = true;
        }
        out.x = x; out.y = y; out.velX = vx; out.velY = vy; out.collided = true;
        return out;
      }

      // At least one circle: push out along the shape MTV.
      var fakeDyn = { collision: { shape: sd }, posX: x, posY: y, width: w, height: h,
                      hitboxOffsetX: 0, hitboxOffsetY: 0, hitboxWidth: w, hitboxHeight: h };
      var ov = pairOverlap(fakeDyn, wall);
      if (!ov) return out;
      if (oneWay) {
        // One-way circles: only catch the body when it lands on top.
        if (ov.ny < -0.5 && vy >= 0) {
          x += ov.nx * ov.depth; y += ov.ny * ov.depth;
          vy = 0; out.landed = true; out.collided = true;
        } else return out;
      } else {
        x += ov.nx * ov.depth; y += ov.ny * ov.depth;
        if (Math.abs(ov.nx) >= Math.abs(ov.ny)) vx = 0; else vy = 0;
        if (ov.ny < -0.5) out.landed = true;
        if (ov.ny > 0.5) out.hitHead = true;
        out.collided = true;
      }
      out.x = x; out.y = y; out.velX = vx; out.velY = vy;
      return out;
    } catch (e) { return out; }
  }

  // Trigger contacts: every {zone, obj} pair where a trigger zone overlaps
  // a dynamic body, honoring collision layers. Pure helper — the runtimes
  // call it during collision resolution and diff the pairs for Enter/Exit.
  function triggerContacts(dynamics, walls) {
    var out = [];
    try {
      var i, j;
      for (i = 0; i < dynamics.length; i++) {
        for (j = 0; j < walls.length; j++) {
          var dyn = dynamics[i], wall = walls[j];
          if (dyn === wall || !isTrigger(wall)) continue;
          if (!canCollide(dyn, wall)) continue;
          if (pairOverlap(dyn, wall)) out.push({ zone: wall, obj: dyn });
        }
      }
    } catch (e) { /* hostile lists never break the frame */ }
    return out;
  }

  function pairKey(zone, obj) {
    return String(zone && zone.id) + ':' + String(obj && obj.id);
  }

  // Segment vs AABB (slab test). Returns t in [0,1] of first contact or null.
  function rayVsBox(x1, y1, dx, dy, b) {
    var tmin = 0, tmax = 1, i;
    var mins = [b.x, b.y], maxs = [b.x + b.width, b.y + b.height];
    var o = [x1, y1], d = [dx, dy];
    for (i = 0; i < 2; i++) {
      if (Math.abs(d[i]) < 1e-9) {
        if (o[i] < mins[i] || o[i] > maxs[i]) return null;
      } else {
        var t1 = (mins[i] - o[i]) / d[i], t2 = (maxs[i] - o[i]) / d[i];
        if (t1 > t2) { var tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return null;
      }
    }
    return tmin;
  }

  // Segment vs circle. Returns t in [0,1] of first contact or null.
  function rayVsCircle(x1, y1, dx, dy, c) {
    var fx = x1 - c.cx, fy = y1 - c.cy;
    var a = dx * dx + dy * dy;
    if (a < 1e-12) return (fx * fx + fy * fy) <= c.r * c.r ? 0 : null;
    var b = 2 * (fx * dx + fy * dy);
    var cc = fx * fx + fy * fy - c.r * c.r;
    var disc = b * b - 4 * a * cc;
    if (disc < 0) return null;
    var sq = Math.sqrt(disc);
    var t = (-b - sq) / (2 * a);
    if (t >= 0 && t <= 1) return t;
    t = (-b + sq) / (2 * a); // started inside: report the exit
    if (t >= 0 && t <= 1) return 0;
    return null;
  }

  // Cast a ray from (x1,y1) to (x2,y2) against a list of objects. mask is a
  // layer bitmask (default ALL_MASK): only objects whose layer bit is set in
  // mask are hit. Returns null or {x, y, distance, object} for the closest
  // hit. Pure: inputs never mutated.
  function raycast(objects, x1, y1, x2, y2, mask) {
    var best = null;
    try {
      var m = clampMask(mask);
      var px = num(x1, 0), py = num(y1, 0);
      var dx = num(x2, 0) - px, dy = num(y2, 0) - py;
      var len = Math.sqrt(dx * dx + dy * dy);
      if (!isFinite(px) || !isFinite(py) || !isFinite(dx) || !isFinite(dy)) return null;
      var list = Array.isArray(objects) ? objects : [];
      var i;
      for (i = 0; i < list.length; i++) {
        var o = list[i];
        if (!o) continue;
        if ((m & layerBit(layerOf(o))) === 0) continue;
        var t = null;
        if (shapeOf(o) === 'circle') t = rayVsCircle(px, py, dx, dy, circleOf(o));
        else t = rayVsBox(px, py, dx, dy, hitboxOf(o));
        if (t == null) continue;
        var dist = t * len;
        if (!best || dist < best.distance) {
          best = { x: px + dx * t, y: py + dy * t, distance: dist, object: o };
        }
      }
    } catch (e) { /* hostile input never breaks the frame */ }
    return best;
  }

  // All objects (mask-filtered) whose collider overlaps the circle at
  // (x, y) with radius r. Pure.
  function overlapCircle(objects, x, y, r, mask) {
    var out = [];
    try {
      var m = clampMask(mask);
      var probe = { collision: { shape: 'circle' }, posX: num(x, 0) - num(r, 0),
                    posY: num(y, 0) - num(r, 0), width: num(r, 0) * 2, height: num(r, 0) * 2,
                    hitboxOffsetX: 0, hitboxOffsetY: 0 };
      probe.hitboxWidth = probe.width; probe.hitboxHeight = probe.height;
      var list = Array.isArray(objects) ? objects : [];
      var i;
      for (i = 0; i < list.length; i++) {
        var o = list[i];
        if (!o) continue;
        if ((m & layerBit(layerOf(o))) === 0) continue;
        if (pairOverlap(probe, o)) out.push(o);
      }
    } catch (e) { /* hostile input never breaks the frame */ }
    return out;
  }

  // P4 item 37 batch 8 (physics queries): pure spatial-query helpers used
  // by the Angle Between / Line of Sight / Distance To Nearest / Moving
  // Towards conditions. Centers use the same hitbox math as the runtimes'
  // distance checks, so editor preview and exports agree. Never throw.

  // Hitbox center of an object. Null-safe: a bad object centers at 0,0.
  function objectCenter(obj) {
    try {
      var hb = hitboxOf(obj);
      return { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
    } catch (e) { return { x: 0, y: 0 }; }
  }

  // Center-to-center distance in pixels. Bad objects give Infinity so
  // comparisons stay quiet rather than firing.
  function distanceBetweenObjects(a, b) {
    try {
      var ca = objectCenter(a), cb = objectCenter(b);
      var dx = cb.x - ca.x, dy = cb.y - ca.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      return isFinite(d) ? d : Infinity;
    } catch (e) { return Infinity; }
  }

  // Angle in degrees from object a's center to object b's center, screen
  // coordinates (y grows downward), in (-180, 180]. 0 = directly right,
  // 90 = directly down, -90 = directly up.
  function angleBetweenObjects(a, b) {
    try {
      var ca = objectCenter(a), cb = objectCenter(b);
      var dx = cb.x - ca.x, dy = cb.y - ca.y;
      if (dx === 0 && dy === 0) return 0; // same center: define as 0
      return Math.atan2(dy, dx) * 180 / Math.PI;
    } catch (e) { return 0; }
  }

  // Speed of an object in pixels per second.
  function speedOf(obj) {
    try {
      var vx = num(obj && obj.velX, 0), vy = num(obj && obj.velY, 0);
      var s = Math.sqrt(vx * vx + vy * vy);
      return isFinite(s) ? s : 0;
    } catch (e) { return 0; }
  }

  // True when object a is moving toward object b — its velocity has a
  // positive component along the a->b direction AND its speed exceeds
  // minSpeed (so a stationary object is never "moving towards").
  function movingTowards(a, b, minSpeed) {
    try {
      var ca = objectCenter(a), cb = objectCenter(b);
      var dx = cb.x - ca.x, dy = cb.y - ca.y;
      var len = Math.sqrt(dx * dx + dy * dy);
      if (!isFinite(len) || len === 0) return false;
      var vx = num(a && a.velX, 0), vy = num(a && a.velY, 0);
      var sp = Math.sqrt(vx * vx + vy * vy);
      var min = num(minSpeed, 1);
      if (!isFinite(sp) || sp <= min) return false;
      var dot = vx * (dx / len) + vy * (dy / len);
      return dot > 0;
    } catch (e) { return false; }
  }

  return {
    LAYER_COUNT: LAYER_COUNT,
    ALL_MASK: ALL_MASK,
    normalizePhysics2d: normalizePhysics2d,
    hitboxOf: hitboxOf,
    circleOf: circleOf,
    shapeOf: shapeOf,
    isTrigger: isTrigger,
    isOneWay: isOneWay,
    layerOf: layerOf,
    maskOf: maskOf,
    layerBit: layerBit,
    canCollide: canCollide,
    pairOverlap: pairOverlap,
    resolvePair: resolvePair,
    triggerContacts: triggerContacts,
    pairKey: pairKey,
    raycast: raycast,
    overlapCircle: overlapCircle,
    objectCenter: objectCenter,
    distanceBetweenObjects: distanceBetweenObjects,
    angleBetweenObjects: angleBetweenObjects,
    speedOf: speedOf,
    movingTowards: movingTowards
  };
}

window.HydraPhysics2D = hydraPhysics2dFactory();
// Self-contained source of the factory, inlined into exported playable games
// by HydraPlayer.buildPlayableHtml so exports run without editor files.
window.HydraPhysics2D.factorySource = hydraPhysics2dFactory.toString();
