/* ============================================================================
 * hydra-joints.js — HydraScript shared 2D physics joints.
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation
 * of physics joints used by:
 *   - the editor preview runtime (script.js delegates to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Idea (Box2D joints, beginner edition): a joint links two objects by
 * NAME in a scene, and the solver runs every frame inside the unpaused
 * update (after collision resolution, so joints and walls agree) in both
 * runtimes. Three kinds, each one plain sentence:
 *
 *   - Distance: a rigid rod. The two centers stay exactly `length` apart
 *     (length 0 welds the centers together — a hinge with no swing).
 *   - Rope: a rope or chain. The centers may come closer freely, but
 *     never stretch past `length` (a swinging lantern, a grappling hook,
 *     a trailer towed behind a truck).
 *   - Spring: a stretchy cord. A spring pull accelerates both ends toward
 *     the rest `length`, damped so it settles instead of bouncing
 *     forever (a bungee, a jelly enemy, a car suspension look).
 *
 * Data model (stored on the scene, saved in project JSON):
 *   scene.joints = [{ type: 'rope', a: 'lantern', b: 'ceiling',
 *                     length: 160, stiffness: 0.05 }];
 * `length: null` means "capture the current distance the first time the
 * joint solves" — that is what the Inspector writes when the Length box
 * is left blank, and what the Create Joint block writes when its Length
 * field is blank. `stiffness` only matters for springs (0..1, default
 * 0.05); distance and rope joints ignore it.
 *
 * Mass rule: a static object is an anchor — it never moves for a joint.
 * Two moving objects split every correction half and half; one moving
 * object against an anchor takes the whole correction. Joints connect by
 * name (the first live object with each name wins, like other blocks);
 * a joint whose endpoint is missing, hidden, or destroyed simply does
 * nothing that frame instead of breaking the game.
 *
 * Honest limits: joints connect object CENTERS (position + half size) —
 * there are no anchor offsets, no rotation, and no angular physics, so a
 * "hinge" here holds centers together rather than swinging a body around
 * a pivot; joints ignore collision layers (a joint holds even across
 * layers); joints are 2D only (3D objects never solve). Old projects
 * have no joints array and behave exactly as before.
 *
 * Load order (index.html): hydra-joints.js BEFORE player-runtime.js and
 * script.js. player-runtime.js throws a clear error if HydraJoints is
 * missing.
 * ========================================================================== */

function hydraJointsFactory() {
  'use strict';

  var JOINT_TYPES = ['distance', 'rope', 'spring'];
  var DEFAULT_STIFFNESS = 0.05;
  var MAX_SPRING_STEP = 30; // px/frame of spring velocity change, cap vs explosions

  function saneNum(v, fallback) {
    var n = Number(v);
    return isFinite(n) ? n : fallback;
  }

  function isJointType(t) {
    return JOINT_TYPES.indexOf(t) !== -1;
  }

  // Object center: position + half size, the same center the lighting
  // module uses. Never throws.
  function objectCenter(obj) {
    try {
      var x = Number(obj.posX), y = Number(obj.posY);
      var w = Number(obj.width), h = Number(obj.height);
      return {
        x: (isFinite(x) ? x : 0) + (isFinite(w) ? w / 2 : 0),
        y: (isFinite(y) ? y : 0) + (isFinite(h) ? h / 2 : 0)
      };
    } catch (e) {
      return { x: 0, y: 0 };
    }
  }

  function distanceBetween(a, b) {
    var ca = objectCenter(a), cb = objectCenter(b);
    var dx = cb.x - ca.x, dy = cb.y - ca.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // Repair/complete a scene's joint list in place. Idempotent; corrupt
  // entries are dropped, bad types repair to 'distance', bad lengths
  // become null (capture on first solve), bad stiffness repairs to the
  // default. Exact duplicates (same unordered pair + type) collapse to
  // one, so a joint is never solved twice. Never throws.
  function normalizeJoints(scene) {
    try {
      if (!scene || typeof scene !== 'object') return [];
      if (!Array.isArray(scene.joints)) scene.joints = [];
      var seen = {};
      var out = [];
      for (var i = 0; i < scene.joints.length; i++) {
        var j = scene.joints[i];
        if (!j || typeof j !== 'object') continue;
        var a = String(j.a == null ? '' : j.a).trim();
        var b = String(j.b == null ? '' : j.b).trim();
        if (!a || !b || a === b) continue;
        var key = (a < b ? a + '\n' + b : b + '\n' + a) + '\n' + (isJointType(j.type) ? j.type : 'distance');
        if (seen[key]) continue;
        seen[key] = true;
        var len = j.length == null ? null : Number(j.length);
        var stiff = Number(j.stiffness);
        out.push({
          type: isJointType(j.type) ? j.type : 'distance',
          a: a,
          b: b,
          length: (len != null && isFinite(len) && len >= 0) ? len : null,
          stiffness: isFinite(stiff) ? Math.max(0, Math.min(1, stiff)) : DEFAULT_STIFFNESS
        });
      }
      scene.joints = out;
      return out;
    } catch (e) {
      return [];
    }
  }

  // First live object with a name, or null. Hosts pass their own live
  // list; the module never assumes a host lookup shape.
  function findByName(objects, name) {
    try {
      if (!Array.isArray(objects) || !name) return null;
      for (var i = 0; i < objects.length; i++) {
        if (objects[i] && objects[i].name === name) return objects[i];
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  // True when a joint links nameA and nameB (either direction). Blank
  // nameB means "any joint involving nameA". Blank nameA is never
  // connected. Never throws.
  function jointConnected(joints, nameA, nameB) {
    try {
      var a = String(nameA == null ? '' : nameA).trim();
      if (!a) return false;
      var b = String(nameB == null ? '' : nameB).trim();
      var list = Array.isArray(joints) ? joints : [];
      for (var i = 0; i < list.length; i++) {
        var j = list[i];
        if (!j || typeof j !== 'object') continue;
        var ja = String(j.a == null ? '' : j.a).trim();
        var jb = String(j.b == null ? '' : j.b).trim();
        if (!b) { if (ja === a || jb === a) return true; }
        else if ((ja === a && jb === b) || (ja === b && jb === a)) return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  // Remove joints: nameB blank removes every joint involving nameA;
  // otherwise removes only the nameA-nameB joints (either direction).
  // Returns how many were removed. Never throws.
  function removeJoint(joints, nameA, nameB) {
    try {
      var a = String(nameA == null ? '' : nameA).trim();
      if (!a || !Array.isArray(joints)) return 0;
      var b = String(nameB == null ? '' : nameB).trim();
      var kept = [];
      var removed = 0;
      for (var i = 0; i < joints.length; i++) {
        var j = joints[i];
        if (!j || typeof j !== 'object') { removed++; continue; }
        var ja = String(j.a == null ? '' : j.a).trim();
        var jb = String(j.b == null ? '' : j.b).trim();
        var hit = !b
          ? (ja === a || jb === a)
          : ((ja === a && jb === b) || (ja === b && jb === a));
        if (hit) removed++;
        else kept.push(j);
      }
      joints.length = 0;
      for (var k = 0; k < kept.length; k++) joints.push(kept[k]);
      return removed;
    } catch (e) {
      return 0;
    }
  }

  // One joint's positional/velocity solve for a frame. `movable` reports
  // whether an object may move (static objects are anchors). Distance
  // and rope are positional corrections; spring is a damped velocity
  // pull toward the rest length. Never throws.
  function solveOneJoint(objA, objB, joint, dt, movable) {
    try {
      if (!objA || !objB || objA === objB) return;
      if (!joint || typeof joint !== 'object') return;
      var type = isJointType(joint.type) ? joint.type : 'distance';
      var len = joint.length;
      if (len == null || !isFinite(len) || len < 0) {
        len = distanceBetween(objA, objB);
        joint.length = len; // capture once, so the rod/rope keeps its size
      }
      var ca = objectCenter(objA), cb = objectCenter(objB);
      var dx = cb.x - ca.x, dy = cb.y - ca.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var moveA = movable(objA), moveB = movable(objB);
      if (!moveA && !moveB) return;
      var shareA = moveA && moveB ? 0.5 : (moveA ? 1 : 0);
      var shareB = moveA && moveB ? 0.5 : (moveB ? 1 : 0);

      if (type === 'spring') {
        var step = saneNum(dt, 1);
        if (!(step > 0)) step = 1;
        var ax, ay;
        if (dist < 1e-6) { ax = 1; ay = 0; }
        else { ax = dx / dist; ay = dy / dist; }
        var stretch = dist - len;
        var vax = saneNum(objA.velX, 0), vay = saneNum(objA.velY, 0);
        var vbx = saneNum(objB.velX, 0), vby = saneNum(objB.velY, 0);
        var relVel = (vbx - vax) * ax + (vby - vay) * ay;
        var k = isFinite(Number(joint.stiffness)) ? Math.max(0, Math.min(1, Number(joint.stiffness))) : DEFAULT_STIFFNESS;
        // Pull together when stretched (or separating), push apart when
        // compressed; damping (0.2) bleeds the bounce so it settles.
        var s = (k * stretch + 0.2 * relVel) * step;
        if (s > MAX_SPRING_STEP) s = MAX_SPRING_STEP;
        if (s < -MAX_SPRING_STEP) s = -MAX_SPRING_STEP;
        objA.velX = vax + ax * s * shareA;
        objA.velY = vay + ay * s * shareA;
        objB.velX = vbx - ax * s * shareB;
        objB.velY = vby - ay * s * shareB;
        return;
      }

      // Distance: always correct to the rod length. Rope: only correct
      // when stretched past the max length (slack is free).
      if (type === 'rope' && dist <= len) return;
      if (dist < 1e-6 && len === 0) return;
      var ux, uy;
      if (dist < 1e-6) { ux = 1; uy = 0; dist = 0; }
      else { ux = dx / dist; uy = dy / dist; }
      var err = dist - len; // > 0: too far apart; < 0: too close (rod only)
      if (err === 0) return;
      // Move A toward/away along the axis by its share of the error, and
      // B the opposite way. Positions shift by center deltas, which for
      // posX/posY is the same delta (centers differ from positions by a
      // constant half-size).
      objA.posX = saneNum(objA.posX, 0) + ux * err * shareA;
      objA.posY = saneNum(objA.posY, 0) + uy * err * shareA;
      objB.posX = saneNum(objB.posX, 0) - ux * err * shareB;
      objB.posY = saneNum(objB.posY, 0) - uy * err * shareB;
    } catch (e) { /* never throws */ }
  }

  // Solve every joint in a scene's list against the host's live objects,
  // two passes so chains (A-B, B-C) settle faster. Springs apply only
  // on the first pass — a velocity pull must not double-apply. Hosts
  // call this inside the unpaused update, after collision resolution, so
  // joints freeze while paused like the rest of the world sim. `movable`
  // is an optional host predicate (default: not static). Never throws.
  function solveJoints(objects, joints, dt, movable) {
    try {
      if (!Array.isArray(objects) || !Array.isArray(joints) || joints.length === 0) return;
      var canMove = typeof movable === 'function'
        ? movable
        : function (o) { return !o.static; };
      for (var pass = 0; pass < 2; pass++) {
        for (var i = 0; i < joints.length; i++) {
          var j = joints[i];
          if (!j || typeof j !== 'object') continue;
          if (pass > 0 && j.type === 'spring') continue;
          var objA = findByName(objects, j.a);
          var objB = findByName(objects, j.b);
          if (!objA || !objB) continue;
          solveOneJoint(objA, objB, j, dt, canMove);
        }
      }
    } catch (e) { /* never throws */ }
  }

  // ---------- block dispatch (one entry point, both runtimes) ----------
  // hooks = { scene() -> scene object, objects() -> live objects,
  //           num(expr) -> { ok, value }, warn(msg) }.
  // createJoint: validates everything before any write (bad type/length/
  // stiffness/missing endpoint warns and holds); blank names stay quiet.
  // Re-creating the same pair + type replaces the old joint instead of
  // doubling it. removeJoint: blank Object A stays quiet; blank Object B
  // removes every joint involving A. Never throws.
  function applyJointAction(data, hooks) {
    try {
      if (!data || typeof data !== 'object' || !hooks) return;
      if (data.type === 'createJoint') {
        var a = String(data.object1 == null ? '' : data.object1).trim();
        var b = String(data.object2 == null ? '' : data.object2).trim();
        if (!a || !b) return; // blank: quiet
        if (a === b) {
          if (hooks.warn) hooks.warn('Create Joint: an object cannot be joined to itself — skipped.');
          return;
        }
        var type = String(data.jointType || 'distance').trim();
        if (!isJointType(type)) {
          if (hooks.warn) hooks.warn('Create Joint: bad joint type — skipped.');
          return;
        }
        var len = null;
        if (data.length != null && String(data.length).trim() !== '') {
          var lv = hooks.num ? hooks.num(data.length) : null;
          if (!lv || !lv.ok || !isFinite(lv.value) || lv.value < 0) {
            if (hooks.warn) hooks.warn('Create Joint: bad length — skipped.');
            return;
          }
          len = lv.value;
        }
        var stiff = DEFAULT_STIFFNESS;
        if (data.stiffness != null && String(data.stiffness).trim() !== '') {
          var sv = hooks.num ? hooks.num(data.stiffness) : null;
          if (!sv || !sv.ok || !isFinite(sv.value) || sv.value < 0 || sv.value > 1) {
            if (hooks.warn) hooks.warn('Create Joint: bad stiffness — skipped.');
            return;
          }
          stiff = sv.value;
        }
        var scene = hooks.scene ? hooks.scene() : null;
        if (!scene || typeof scene !== 'object') return;
        var live = hooks.objects ? hooks.objects() : [];
        if (!findByName(live, a) || !findByName(live, b)) {
          if (hooks.warn) hooks.warn('Create Joint: "' + a + '" or "' + b + '" was not found — skipped.');
          return;
        }
        normalizeJoints(scene);
        if (len == null) len = distanceBetween(findByName(live, a), findByName(live, b));
        // Re-creating the same pair + type replaces the old joint; other
        // types on the same pair (a rod AND a spring) keep working.
        scene.joints = scene.joints.filter(function (j) {
          var samePair = (j.a === a && j.b === b) || (j.a === b && j.b === a);
          return !(samePair && j.type === type);
        });
        scene.joints.push({ type: type, a: a, b: b, length: len, stiffness: stiff });
        return;
      }
      if (data.type === 'removeJoint') {
        var ra = String(data.object1 == null ? '' : data.object1).trim();
        if (!ra) return; // blank: quiet
        var rb = String(data.object2 == null ? '' : data.object2).trim();
        var rscene = hooks.scene ? hooks.scene() : null;
        if (!rscene || typeof rscene !== 'object') return;
        normalizeJoints(rscene);
        removeJoint(rscene.joints, ra, rb);
        return;
      }
    } catch (e) { /* never throws */ }
  }

  // Joint Connected condition: true while a joint links the two objects
  // (either direction); blank Object B means any joint involving Object
  // A. A state read — it evaluates while paused like getVariable, since
  // positions and joints are frozen. Quiet (false) on bad data. The host
  // applies `reversed`. Never throws.
  function evalJointCondition(data, hooks) {
    var quiet = { pass: false, context: {} };
    try {
      if (!data || typeof data !== 'object' || data.type !== 'jointConnected') return quiet;
      var scene = hooks && hooks.scene ? hooks.scene() : null;
      var joints = scene && Array.isArray(scene.joints) ? scene.joints : [];
      var pass = jointConnected(joints, data.object1, data.object2);
      return { pass: pass, context: {} };
    } catch (e) {
      return quiet;
    }
  }

  function isJointAction(type) {
    return type === 'createJoint' || type === 'removeJoint';
  }

  function isJointCondition(type) {
    return type === 'jointConnected';
  }

  return {
    JOINT_TYPES: JOINT_TYPES,
    DEFAULT_STIFFNESS: DEFAULT_STIFFNESS,
    objectCenter: objectCenter,
    distanceBetween: distanceBetween,
    normalizeJoints: normalizeJoints,
    findByName: findByName,
    jointConnected: jointConnected,
    removeJoint: removeJoint,
    solveOneJoint: solveOneJoint,
    solveJoints: solveJoints,
    applyJointAction: applyJointAction,
    evalJointCondition: evalJointCondition,
    isJointAction: isJointAction,
    isJointCondition: isJointCondition
  };
}

window.HydraJoints = hydraJointsFactory();
// Self-contained source of the factory, inlined into exported playable games
// by HydraPlayer.buildPlayableHtml so exports run without editor files.
window.HydraJoints.factorySource = hydraJointsFactory.toString();
