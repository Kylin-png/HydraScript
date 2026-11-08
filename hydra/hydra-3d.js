/* ============================================================================
 * hydra-3d.js — HydraScript shared 3D rendering foundation (P4 item 3D1).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation of
 * the 3D block semantics and the built-in CPU 3D renderer used by:
 *   - the editor preview runtime (script.js delegates to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Design (beginner-first 3D, no dependencies):
 *   - The world uses the SAME orientation intuition as the 2D canvas:
 *     x grows right, y grows DOWN, and z grows TOWARD the viewer. There is
 *     no "y is up" surprise: if you drag an object down in the scene
 *     editor, it sits lower in the 3D view too. (GLB models, authored
 *     Y-up, are flipped to Y-down on load by hydra-gltf.js so they stand
 *     upright.)
 *   - A 3D object's rendered center is (posX + width/2, posY + height/2, z).
 *     The new `z` field is the depth position (0 = the screen plane,
 *     positive = closer to the camera). The new `depth` field is the
 *     object's size along z. `rotX`/`rotY`/`rotZ` are degrees of rotation
 *     about the object's center.
 *   - Rendering is a small built-in projector: perspective camera, meshes
 *     for the four primitives plus uploaded GLB/GLTF models (parsed by
 *     hydra-gltf.js, fitted into the object's w/h/d box, drawn with the
 *     model's base-color textures sampled per triangle where present,
 *     flat-shaded from the model's material colors times the object's
 *     material tint), flat shading from one fixed directional light,
 *     painter's-algorithm triangle sorting. No WebGL, no Three.js, no
 *     CDN — exported games stay fully self-contained single files.
 *   - Texture honesty: a triangle whose model has a baseColorTexture
 *     samples it (glTF UV convention, origin top-left); the flat-shade
 *     light darkens it the same way, and the material tint washes over
 *     it. Textures can be switched off per object (useTexture) or at
 *     runtime; missing or undecoded images always fall back to flat
 *     colors — never a broken frame.
 *   - Scenes opt in per scene: `scene.renderMode` is '2d' (default) or
 *     '3d'. `scene.camera3d` holds {x,y,z,tx,ty,tz,fov}; when missing, a
 *     sensible default frames the whole scene.
 *
 * Blocks (category "3D", all ordinary blocks — no black boxes):
 *   - Move 3D (action): adds dX/dY/dZ to the object's center.
 *   - Set 3D Position (action): moves the object's CENTER to X/Y/Z.
 *   - Set 3D Rotation (action): absolute rotation in degrees.
 *   - Rotate 3D (action): adds degrees to the rotation.
 *   - Set Model Tint (action): tints a 3D model's material colors with a
 *     color (white = no tint); also tints 3D primitives.
 *   - Use Model Texture (action): switches a model's texture on or off
 *     at runtime (On/Off). Off shows the model's flat material colors.
 *   - Set 3D Camera (action): camera position + look-at target (also
 *     stops any Follow 3D Object, like 2D Move Camera clears follow).
 *   - Follow 3D Object (action): the camera rides the object's 3D center
 *     + offset every frame, always looking at it (third-person chase).
 *   - Stop 3D Camera Follow (action): ends the follow; the camera holds.
 *   - 3D Distance (condition): center-to-center distance between two
 *     objects compared against a value; a state read like distanceCheck
 *     (defaults to 'level' trigger mode, evaluates while paused).
 *   - Aim 3D Camera (action): FPS-style mouse-look — keeps the camera
 *     where it is and re-aims its look-at point from yaw/pitch degrees.
 *     Unlike Set 3D Camera it never ends a Follow 3D Object: park the
 *     camera on the player's head with Follow 3D Object, then aim it
 *     every frame from the mouse deltas.
 *   - Move 3D Facing (action): WASD-style motion — moves the object along
 *     its yaw heading (Forward steps, Strafe steps right), using the same
 *     yaw convention as Aim 3D Camera so movement and mouse-look agree.
 *   - Capture Mouse / Release Mouse (actions): pointer lock for FPS
 *     mouse-look (the host owns the DOM call; the module only asks).
 *   - Read Mouse Delta (action): copies this frame's accumulated mouse
 *     movement into two game variables (steer a yaw variable with it).
 *   - Mouse Pointer Captured (condition): true while pointer lock holds;
 *     invert it to catch the player pressing Esc.
 *   - 3D physics basics (P4 item 3D4): per-frame gravity, box/sphere 3D
 *     colliders, ground detection, and MTV collision response between
 *     dynamic 3D objects and solid 3D objects.
 *   - Set 3D Gravity (action): sets a 3D object's gravity — the same
 *     field the Inspector's Physics panel edits, so the 2D Set Gravity
 *     block and the panel stay in sync.
 *   - Set 3D Velocity (action): sets the object's 3D velocity (X/Y/Z) —
 *     launch, knockback, zero it to stop.
 *   - 3D On Ground (condition): true while a 3D object rests on a solid
 *     3D surface (world-dependent: reports the paused freeze, like 2D
 *     On Floor).
 *   - 3D Collision (condition): true while two 3D objects' colliders
 *     overlap (world-dependent: reports the paused freeze, like 2D
 *     Collision).
 *   - 3D lighting (P4 item 3D5): light3d objects are invisible,
 *     non-physical scene objects that light the scene — Ambient (no
 *     position or direction, washes everything), Directional (aimed by
 *     the light's Rot X / Rot Y; no rotation = the classic fixed key
 *     light), Point (shines from the light's 3D center with linear
 *     falloff to Range; range 0 = no falloff). A scene with no lights
 *     keeps the legacy fixed shading, so old projects render exactly as
 *     before; with lights, every triangle is shaded per-channel by the
 *     summed light (ambient + directional + point), and model textures
 *     are multiplied by the same light. Scenes with lights but no
 *     ambient light keep a dim 0.25 white base so nothing goes pitch
 *     black — adding an Ambient light replaces that base.
 *   - Set 3D Light (action): changes a light's type, color, intensity,
 *     range, and on/off at runtime — day/night cycles, flickering
 *     torches, muzzle flashes. Warns on bad data; quiet on blank names.
 *   - Simple blob shadows (P4 item 3D5): scene.shadows3d draws a soft
 *     dark ellipse under each 3D object on the horizontal ground plane
 *     y = scene.shadowGroundY (defaults to the bottom of the world),
 *     fading with height. Drawn before geometry — a cheap honest
 *     shadow, not shadow mapping.
 *
 * Conventions (kept identical in preview and exports):
 *   - Nothing here ever throws; hostile input produces a safe fallback.
 *   - Bad expressions warn once through hooks.warn and the action is
 *     skipped (the math/collections convention).
 *   - The condition stays quiet on blank/missing names or bad values (the
 *     timer/pick convention — no per-frame warning spam).
 *   - 3D objects are inert to the 2D physics/collision system (their
 *     collision is disabled at normalization); 2D click/hover blocks do
 *     not hit-test 3D objects yet.
 *   - 3D physics (updatePhysics3d) reuses the shared obj.physics fields
 *     (gravity, friction, maxSpeed) — one Physics section in the
 *     Inspector drives both 2D and 3D. 3D velocity lives on
 *     obj.vel3x/vel3y/vel3z (the 2D step never touches 3D objects, so the
 *     2D velX/velY fields stay clean). The per-object 3D collider lives
 *     on obj.physics3d { shape: 'box'|'sphere', solid: bool }.
 *
 * The hooks contract: targets(data) returns the host's resolved action
 * targets (already context-aware, so picking works); num(raw) evaluates an
 * expression like the other shared modules (returns {ok, value});
 * warn(msg) reports a runtime diagnostic; objectsByName(name) returns live
 * objects with the name; camera3d() returns the host's live 3D camera
 * object (mutated in place by Set 3D Camera); setFollow3d(follow) stores
 * or clears the runtime's 3D camera-follow state (a normalize3dFollow
 * record or null — kept in runtime state, never in scene.camera3d, so it
 * cannot leak into saved project JSON). tick3dCameraFollow(cam, follow,
 * objectsByName) applies one frame of follow; the host calls it once per
 * frame (inside its unpaused update, mirroring 2D camera follow).
 * captureMouse()/releaseMouse() perform the host's pointer-lock
 * request/release and report success; pointerLocked() reports whether the
 * pointer is currently locked to the game canvas; readMouseDelta() returns
 * this frame's accumulated {x, y} mouse movement (the host accumulates
 * from pointer-lock movementX/Y, or from cursor travel when uncaptured,
 * and resets it at the end of each frame); setVar(name, value) writes a
 * game variable (for Read Mouse Delta). The module never touches the DOM
 * itself — hosts own all browser calls.
 *
 * Load order (index.html): hydra-3d.js BEFORE player-runtime.js and
 * script.js. player-runtime.js throws a clear error if Hydra3d is missing.
 * ========================================================================== */

function hydra3dFactory() {
  'use strict';

  var ACTION_TYPES = ['set3dPosition', 'move3d', 'set3dRotation', 'rotate3d', 'setModelTint', 'useModelTexture', 'set3dCamera', 'follow3dCamera', 'stop3dCameraFollow', 'aim3dCamera', 'move3dFacing', 'captureMouse', 'releaseMouse', 'readMouseDelta', 'set3dGravity', 'set3dVelocity', 'set3dLight'];
  var CONDITION_TYPES = ['distance3d', 'mousePointerCaptured', 'onGround3d', 'collision3d'];
  var THREE_D_KINDS = ['box3d', 'sphere3d', 'plane3d', 'cylinder3d', 'model3d'];
  // The light object kind. Deliberately NOT in THREE_D_KINDS: lights are
  // invisible, non-physical scene objects — never geometry, never
  // colliders, never drawn as sprites. Hosts include them in the object
  // list they hand to renderScene (which collects them for lighting) but
  // exclude them from physics and 2D draw passes via is3dKind.
  var LIGHT3D_KIND = 'light3d';

  var DEG = Math.PI / 180;
  var MAX_TRIS_PER_FRAME = 24000;
  var SPHERE_SEG = 10;
  var CYLINDER_SEG = 12;

  // ---------- tiny vec3 ----------
  function v3(x, y, z) { return [fin(x), fin(y), fin(z)]; }
  function fin(v) { var n = Number(v); return Number.isFinite(n) ? n : 0; }
  function vadd(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function vsub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function vscale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function vdot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function vcross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function vlen(a) { return Math.sqrt(vdot(a, a)); }
  function vnorm(a) { var l = vlen(a); return l > 1e-9 ? vscale(a, 1 / l) : [0, 0, 0]; }

  // Rotate point p by Euler angles (degrees), applied Z then Y then X
  // (p' = Rx * Ry * Rz * p). Consistent everywhere; never throws.
  function rotXYZ(p, rxDeg, ryDeg, rzDeg) {
    if (!Array.isArray(p)) p = [0, 0, 0];
    var rx = fin(rxDeg) * DEG, ry = fin(ryDeg) * DEG, rz = fin(rzDeg) * DEG;
    var x = fin(p[0]), y = fin(p[1]), z = fin(p[2]);
    var c, s;
    if (rz) { c = Math.cos(rz); s = Math.sin(rz); var x1 = x * c - y * s, y1 = x * s + y * c; x = x1; y = y1; }
    if (ry) { c = Math.cos(ry); s = Math.sin(ry); var x2 = x * c + z * s, z2 = -x * s + z * c; x = x2; z = z2; }
    if (rx) { c = Math.cos(rx); s = Math.sin(rx); var y3 = y * c - z * s, z3 = y * s + z * c; y = y3; z = z3; }
    return [x, y, z];
  }

  function is3dKind(kind) {
    return THREE_D_KINDS.indexOf(String(kind || '')) >= 0;
  }

  function isLight3d(kind) {
    return String(kind || '') === LIGHT3D_KIND;
  }

  function posNum(v, fallback) {
    var n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  // Repair/complete the 3D fields on an object. Idempotent; never throws.
  function normalizeObject3d(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    obj.z = fin(obj.z);
    var w = posNum(obj.width, 64), h = posNum(obj.height, 64);
    obj.depth = posNum(obj.depth, Math.min(w, h));
    obj.rotX = fin(obj.rotX); obj.rotY = fin(obj.rotY); obj.rotZ = fin(obj.rotZ);
    // P4 item 3D2: material tint (white = no tint), the picked model
    // asset for model3d objects, and the texture switch (on by default —
    // a textured model shows its own skin, flat colors otherwise).
    // Old objects keep rendering as before.
    if (!isValidHexColor(obj.materialColor)) obj.materialColor = '#ffffff';
    if (obj.modelAssetId != null && typeof obj.modelAssetId !== 'string') obj.modelAssetId = null;
    if (obj.useTexture === false) obj.useTexture = false; else obj.useTexture = true;
    // P4 item 3D4: per-object 3D collider (box or sphere, solid by
    // default). Old objects keep passing through as before until the
    // user enables physics on them.
    normalizePhysics3d(obj);
    // P4 item 3D5: light objects carry their light fields.
    if (isLight3d(obj.kind)) normalizeLight3d(obj);
    return obj;
  }

  // Repair/complete the 3D physics fields on an object. Idempotent; never
  // throws. `solid: false` makes the object a ghost — it passes through
  // (and is passed through by) other 3D objects.
  function normalizePhysics3d(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    var c = obj.physics3d;
    if (!c || typeof c !== 'object') { obj.physics3d = c = {}; }
    c.shape = (c.shape === 'sphere') ? 'sphere' : 'box';
    c.solid = c.solid !== false;
    return obj;
  }

  // Repair/complete the light fields on a light3d object. Idempotent;
  // never throws.
  //   type: 'ambient' (no position or direction — washes the whole scene),
  //     'directional' (aimed by the light's Rot X / Rot Y; no rotation =
  //     the classic fixed key light), or 'point' (shines from the light's
  //     3D center, fading linearly to `range`; range 0 = no falloff).
  //   enabled: false switches the light off (Set 3D Light flips it).
  function normalizeLight3d(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    var l = obj.light;
    if (!l || typeof l !== 'object') { obj.light = l = {}; }
    var t = String(l.type || '').trim().toLowerCase();
    l.type = (t === 'ambient' || t === 'directional' || t === 'point') ? t : 'point';
    if (!isValidHexColor(l.color)) l.color = '#ffffff';
    var inten = Number(l.intensity);
    l.intensity = Number.isFinite(inten) ? inten : 1;
    var range = Number(l.range);
    l.range = (Number.isFinite(range) && range >= 0) ? range : 600;
    l.enabled = l.enabled !== false;
    return obj;
  }

  // P4 item 3D5: before this pillar, the Create palette's Light button
  // made a 2D sprite placeholder (kind 'sprite', archetype 'light3d',
  // with an unwired Light component). Promote those to the real light3d
  // kind, carrying the legacy component's fields over when present.
  // Idempotent; never throws.
  function migrateLegacyLight3d(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    if (obj.kind === LIGHT3D_KIND || obj.archetype !== LIGHT3D_KIND) return obj;
    obj.kind = LIGHT3D_KIND;
    var props = {};
    try {
      var comps = Array.isArray(obj.components) ? obj.components : [];
      for (var i = 0; i < comps.length; i++) {
        if (comps[i] && comps[i].type === 'Light' && comps[i].props && typeof comps[i].props === 'object') {
          props = comps[i].props;
          break;
        }
      }
    } catch (e) {}
    var t = String(props.lightType || '').trim().toLowerCase();
    obj.light = {
      type: (t === 'ambient' || t === 'directional' || t === 'point') ? t : 'directional',
      color: isValidHexColor(props.color) ? String(props.color).trim() : '#ffffff',
      intensity: Number.isFinite(Number(props.intensity)) ? Number(props.intensity) : 1,
      range: 600,
      enabled: true
    };
    // The legacy component is superseded by obj.light; leave the
    // component record in place (harmless) so nothing else that reads
    // components breaks.
    return normalizeLight3d(obj);
  }

  function isValidHexColor(v) {
    return typeof v === 'string' && /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(v.trim());
  }

  // Per-scene 3D camera. Defaults frame the whole scene: camera centered on
  // the scene, pulled back along +z, looking at the scene center.
  function normalizeCamera3d(cam, scene) {
    var out = (cam && typeof cam === 'object') ? cam : {};
    var worldW = posNum(scene && scene.worldWidth, 800);
    var worldH = posNum(scene && scene.worldHeight, 600);
    var dist = Math.max(worldW, worldH) * 1.15;
    function n(v, d) { var x = Number(v); return Number.isFinite(x) ? x : d; }
    out.x = n(out.x, worldW / 2);
    out.y = n(out.y, worldH / 2);
    out.z = n(out.z, dist);
    out.tx = n(out.tx, worldW / 2);
    out.ty = n(out.ty, worldH / 2);
    out.tz = n(out.tz, 0);
    var fov = n(out.fov, 60);
    out.fov = Math.min(120, Math.max(10, fov));
    return out;
  }

  function normalizeRenderMode(mode) {
    return String(mode || '2d').toLowerCase() === '3d' ? '3d' : '2d';
  }

  // 3D camera-follow state: { name, dx, dy, dz }. The camera sits at the
  // target's 3D center + offset and looks at the center every frame (a
  // third-person chase view the user can tune — no black-box controller).
  // Sanitized records only; never throws. The record is runtime state —
  // hosts keep it OUT of scene.camera3d so saves stay clean.
  function normalize3dFollow(f) {
    if (!f || typeof f !== 'object') return null;
    var name = String(f.name || '').trim();
    if (!name) return null;
    return { name: name, dx: fin(f.dx), dy: fin(f.dy), dz: fin(f.dz) };
  }

  // One frame of camera follow: park the camera at center + offset and aim
  // it at the target's center. When the target is gone the camera holds its
  // last position (never snaps home). Never throws.
  function tick3dCameraFollow(cam, follow, objectsByName) {
    try {
      if (!cam || typeof cam !== 'object') return;
      var rec = normalize3dFollow(follow);
      if (!rec) return;
      var list = (typeof objectsByName === 'function') ? objectsByName(rec.name) : null;
      var target = (list && list[0] && typeof list[0] === 'object') ? list[0] : null;
      if (!target) return;
      var c = centerOf(target);
      cam.x = c[0] + rec.dx;
      cam.y = c[1] + rec.dy;
      cam.z = c[2] + rec.dz;
      cam.tx = c[0];
      cam.ty = c[1];
      cam.tz = c[2];
    } catch (e) { /* follow is decoration; never break the frame */ }
  }

  // Rendered center of a 3D object: (posX + w/2, posY + h/2, z).
  function centerOf(obj) {
    if (!obj || typeof obj !== 'object') return v3(0, 0, 0);
    var w = posNum(obj.width, 64), h = posNum(obj.height, 64);
    return [fin(obj.posX) + w / 2, fin(obj.posY) + h / 2, fin(obj.z)];
  }

  function distance3d(a, b) {
    var ca = centerOf(a), cb = centerOf(b);
    return vlen(vsub(ca, cb));
  }

  // FPS aim math: the look-at point at `dist` from the camera position
  // along the yaw/pitch facing. Yaw 0 = into the screen (-Z), positive yaw
  // turns right (+X); pitch 0 = level, positive pitch looks down (+Y,
  // screen-down). A non-positive distance falls back to 500 so the camera
  // never degenerates. Never throws.
  function yawPitchLookAt(camPos, yawDeg, pitchDeg, dist) {
    var d = fin(dist);
    if (!(d > 0)) d = 500;
    var yaw = fin(yawDeg) * DEG, pitch = fin(pitchDeg) * DEG;
    var cp = Math.cos(pitch);
    var fwd = [Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
    var p = Array.isArray(camPos) ? camPos : [0, 0, 0];
    return vadd(v3(p[0], p[1], p[2]), vscale(fwd, d));
  }

  // Walk/strafe along a yaw facing: forward = (sin yaw, 0, -cos yaw),
  // character-right = (cos yaw, 0, sin yaw) — the same yaw convention as
  // yawPitchLookAt, so WASD movement and mouse-look always agree. Returns
  // [dX, dZ]. Never throws.
  function facingDelta(forward, strafe, yawDeg) {
    var yaw = fin(yawDeg) * DEG;
    var f = fin(forward), s = fin(strafe);
    var sy = Math.sin(yaw), cy = Math.cos(yaw);
    return [f * sy + s * cy, -f * cy + s * sy];
  }

  // ---------- 3D physics (P4 item 3D4) ----------
  // The collider of a 3D object, from its w/h/depth box:
  //   - box: the object's (w,h,depth) box (min 0.5 per side, like the 2D
  //     circle collider's radius floor).
  //   - sphere: centered on the object, radius = half the smallest side.
  // Centers use the same centerOf() as the renderer (posX + w/2,
  // posY + h/2, z). Rotation is ignored by the collider — colliders stay
  // axis-aligned (a documented simple-on-ramp limit).
  function collider3dOf(obj) {
    var c = centerOf(obj);
    var w = Math.max(0.5, posNum(obj && obj.width, 64));
    var h = Math.max(0.5, posNum(obj && obj.height, 64));
    var d = Math.max(0.5, posNum(obj && obj.depth, Math.min(w, h)));
    var shape = (obj && obj.physics3d && obj.physics3d.shape === 'sphere') ? 'sphere' : 'box';
    if (shape === 'sphere') {
      return { shape: 'sphere', cx: c[0], cy: c[1], cz: c[2], r: Math.min(w, h, d) / 2 };
    }
    return { shape: 'box', cx: c[0], cy: c[1], cz: c[2], hx: w / 2, hy: h / 2, hz: d / 2 };
  }

  function isSolid3d(obj) {
    return !!(obj && obj.physics3d && obj.physics3d.solid !== false);
  }

  // Overlap helpers return null or {nx,ny,nz,depth} with the normal
  // pointing from B toward A (the push direction for A). Pure; never throw.
  function boxBox3dOverlap(a, b) {
    var dx = a.cx - b.cx, dy = a.cy - b.cy, dz = a.cz - b.cz;
    var ox = (a.hx + b.hx) - Math.abs(dx);
    var oy = (a.hy + b.hy) - Math.abs(dy);
    var oz = (a.hz + b.hz) - Math.abs(dz);
    if (ox <= 0 || oy <= 0 || oz <= 0) return null;
    if (ox <= oy && ox <= oz) return { nx: dx >= 0 ? 1 : -1, ny: 0, nz: 0, depth: ox };
    if (oy <= oz) return { nx: 0, ny: dy >= 0 ? 1 : -1, nz: 0, depth: oy };
    return { nx: 0, ny: 0, nz: dz >= 0 ? 1 : -1, depth: oz };
  }

  function sphereSphere3dOverlap(a, b) {
    var dx = a.cx - b.cx, dy = a.cy - b.cy, dz = a.cz - b.cz;
    var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    var minDist = a.r + b.r;
    if (dist >= minDist) return null;
    var nx, ny, nz;
    if (dist > 1e-6) { nx = dx / dist; ny = dy / dist; nz = dz / dist; }
    else { nx = 0; ny = -1; nz = 0; } // coincident centers: push up
    return { nx: nx, ny: ny, nz: nz, depth: minDist - dist };
  }

  function sphereBox3dOverlap(s, b) {
    // s = sphere, b = box.
    var qx = Math.max(b.cx - b.hx, Math.min(s.cx, b.cx + b.hx));
    var qy = Math.max(b.cy - b.hy, Math.min(s.cy, b.cy + b.hy));
    var qz = Math.max(b.cz - b.hz, Math.min(s.cz, b.cz + b.hz));
    var dx = s.cx - qx, dy = s.cy - qy, dz = s.cz - qz;
    var distSq = dx * dx + dy * dy + dz * dz;
    if (distSq >= s.r * s.r) return null;
    if (distSq > 1e-9) {
      var dist = Math.sqrt(distSq);
      return { nx: dx / dist, ny: dy / dist, nz: dz / dist, depth: s.r - dist };
    }
    // Sphere center is inside the box: push out along the shallowest face.
    var px = b.hx - Math.abs(s.cx - b.cx);
    var py = b.hy - Math.abs(s.cy - b.cy);
    var pz = b.hz - Math.abs(s.cz - b.cz);
    if (px <= py && px <= pz) return { nx: (s.cx >= b.cx ? 1 : -1), ny: 0, nz: 0, depth: px + s.r };
    if (py <= pz) return { nx: 0, ny: (s.cy >= b.cy ? 1 : -1), nz: 0, depth: py + s.r };
    return { nx: 0, ny: 0, nz: (s.cz >= b.cz ? 1 : -1), depth: pz + s.r };
  }

  // Shape-aware overlap between two 3D objects. Returns null or
  // {nx,ny,nz,depth} with the normal pointing from B toward A (the push
  // direction for A). Ignores solidity — the caller decides what blocks.
  // Never throws.
  function pairOverlap3d(a, b) {
    try {
      if (!a || !b || a === b || typeof a !== 'object' || typeof b !== 'object') return null;
      var ca = collider3dOf(a), cb = collider3dOf(b);
      if (ca.shape === 'box' && cb.shape === 'box') return boxBox3dOverlap(ca, cb);
      if (ca.shape === 'sphere' && cb.shape === 'sphere') return sphereSphere3dOverlap(ca, cb);
      if (ca.shape === 'sphere') return sphereBox3dOverlap(ca, cb);
      var ov = sphereBox3dOverlap(cb, ca); // circle B vs box A: flip the normal
      return ov ? { nx: -ov.nx, ny: -ov.ny, nz: -ov.nz, depth: ov.depth } : null;
    } catch (e) { return null; }
  }

  function clamp3(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  // One frame of 3D physics: gravity, friction, maxSpeed, integration,
  // then MTV collision response between dynamic 3D objects and solid 3D
  // objects (dynamics = physics enabled + not static; solids = static or
  // physics disabled — the 2D rule). Blocking needs BOTH objects solid;
  // non-solid objects pass through like ghosts. Landing sets the
  // velocity component along the contact normal to 0 (the 2D rule), so
  // objects rest on floors and slide along walls. obj._onGround3d is true
  // while the object was pushed up out of a solid (the floor is below).
  //
  // objects: the host's live 3D objects (3D kinds only — the host
  // filters). dt: frames (1 = one 60fps frame), like the 2D step.
  // getPhysics(obj): the host's physics-field reader with defaults.
  // Never throws; hostile input degrades to no motion.
  function updatePhysics3d(objects, dt, getPhysics) {
    try {
      var list = Array.isArray(objects) ? objects : [];
      var dtf = Number(dt);
      if (!(dtf > 0)) return;
      var i;
      var dynamics = [], solids = [];
      for (i = 0; i < list.length; i++) {
        var o = list[i];
        if (!o || typeof o !== 'object') continue;
        normalizePhysics3d(o);
        if (o.static || !o.physicsEnabled) solids.push(o);
        else dynamics.push(o);
      }
      for (i = 0; i < dynamics.length; i++) {
        var d = dynamics[i];
        var gravity = 0, friction = 0.82, maxSpeed = 25;
        try {
          var gp = (typeof getPhysics === 'function') ? getPhysics(d) : null;
          if (gp && typeof gp === 'object') {
            if (Number.isFinite(Number(gp.gravity))) gravity = Number(gp.gravity);
            if (Number.isFinite(Number(gp.friction))) friction = clamp3(Number(gp.friction), 0, 1);
            if (Number.isFinite(Number(gp.maxSpeed)) && Number(gp.maxSpeed) > 0) maxSpeed = Number(gp.maxSpeed);
          }
        } catch (e) {}
        d.vel3x = fin(d.vel3x); d.vel3y = fin(d.vel3y); d.vel3z = fin(d.vel3z);
        d.vel3y += gravity * dtf;
        var fr = Math.pow(friction, dtf);
        d.vel3x *= fr; d.vel3y *= fr; d.vel3z *= fr;
        d.vel3x = clamp3(d.vel3x, -maxSpeed, maxSpeed);
        d.vel3y = clamp3(d.vel3y, -maxSpeed, maxSpeed);
        d.vel3z = clamp3(d.vel3z, -maxSpeed, maxSpeed);
        d.posX = fin(d.posX) + d.vel3x * dtf;
        d.posY = fin(d.posY) + d.vel3y * dtf;
        d.z = fin(d.z) + d.vel3z * dtf;
        d._onGround3d = false;
      }
      for (i = 0; i < dynamics.length; i++) {
        var dyn = dynamics[i];
        if (!isSolid3d(dyn)) continue; // ghosts pass through
        for (var j = 0; j < solids.length; j++) {
          var wall = solids[j];
          if (!isSolid3d(wall)) continue;
          var ov = pairOverlap3d(dyn, wall);
          if (!ov) continue;
          dyn.posX += ov.nx * ov.depth;
          dyn.posY += ov.ny * ov.depth;
          dyn.z += ov.nz * ov.depth;
          // Kill the velocity along the contact normal on the dominant
          // axis (the 2D cross-from-side convention).
          var ax = Math.abs(ov.nx), ay = Math.abs(ov.ny), az = Math.abs(ov.nz);
          if (ax >= ay && ax >= az) dyn.vel3x = 0;
          else if (ay >= az) dyn.vel3y = 0;
          else dyn.vel3z = 0;
          // Landed: the push normal points up, so the wall is below.
          if (ov.ny < -0.5) dyn._onGround3d = true;
        }
      }
    } catch (e) { /* 3D physics must never break the frame */ }
  }

  // ---------- primitive meshes ----------
  // Each builder returns { verts: [[x,y,z]...], tris: [[i,j,k]...] } in
  // local space centered on the origin. Face normals are derived from the
  // transformed triangles at draw time (flat shading).
  function dim(v, fallback) {
    var n = Number(v);
    return (Number.isFinite(n) && n > 0) ? n : fallback;
  }

  function buildBox(w, h, d) {
    w = dim(w, 64); h = dim(h, 64); d = dim(d, 64);
    var x = w / 2, y = h / 2, z = d / 2;
    var verts = [
      [-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z],
      [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]
    ];
    var tris = [
      [0, 1, 2], [0, 2, 3],       // back  (-z)
      [4, 6, 5], [4, 7, 6],       // front (+z)
      [0, 4, 5], [0, 5, 1],       // top   (-y)
      [3, 2, 6], [3, 6, 7],       // bottom(+y)
      [1, 5, 6], [1, 6, 2],       // right (+x)
      [0, 3, 7], [0, 7, 4]        // left  (-x)
    ];
    return { verts: verts, tris: tris };
  }

  function buildPlane(w, h) {
    w = dim(w, 64); h = dim(h, 64);
    var x = w / 2, y = h / 2;
    return {
      verts: [[-x, -y, 0], [x, -y, 0], [x, y, 0], [-x, y, 0]],
      tris: [[0, 1, 2], [0, 2, 3]]
    };
  }

  function buildSphere(w, h, d) {
    var rx = Math.max(dim(w, 64) / 2, 0.001), ry = Math.max(dim(h, 64) / 2, 0.001), rz = Math.max(dim(d, 64) / 2, 0.001);
    var verts = [], tris = [];
    for (var i = 0; i <= SPHERE_SEG; i++) {
      var phi = (i / SPHERE_SEG) * Math.PI; // 0..pi, top(-y) to bottom(+y)
      for (var j = 0; j <= SPHERE_SEG; j++) {
        var theta = (j / SPHERE_SEG) * Math.PI * 2;
        verts.push([
          rx * Math.sin(phi) * Math.cos(theta),
          -ry * Math.cos(phi),
          rz * Math.sin(phi) * Math.sin(theta)
        ]);
      }
    }
    var ring = SPHERE_SEG + 1;
    for (var a = 0; a < SPHERE_SEG; a++) {
      for (var b = 0; b < SPHERE_SEG; b++) {
        var p0 = a * ring + b, p1 = p0 + 1, p2 = p0 + ring, p3 = p2 + 1;
        tris.push([p0, p2, p1], [p1, p2, p3]);
      }
    }
    return { verts: verts, tris: tris };
  }

  function buildCylinder(w, h, d) {
    var rx = Math.max(dim(w, 64) / 2, 0.001), rz = Math.max(dim(d, 64) / 2, 0.001), hy = dim(h, 64) / 2;
    var verts = [], tris = [];
    for (var j = 0; j < CYLINDER_SEG; j++) {
      var t = (j / CYLINDER_SEG) * Math.PI * 2;
      verts.push([rx * Math.cos(t), -hy, rz * Math.sin(t)]);
      verts.push([rx * Math.cos(t), hy, rz * Math.sin(t)]);
    }
    for (var k = 0; k < CYLINDER_SEG; k++) {
      var k2 = (k + 1) % CYLINDER_SEG;
      var t0 = k * 2, b0 = k * 2 + 1, t1 = k2 * 2, b1 = k2 * 2 + 1;
      tris.push([t0, b0, t1], [t1, b0, b1]); // side
    }
    var topC = verts.length; verts.push([0, -hy, 0]);
    var botC = verts.length; verts.push([0, hy, 0]);
    for (var m = 0; m < CYLINDER_SEG; m++) {
      var m2 = (m + 1) % CYLINDER_SEG;
      tris.push([topC, m2 * 2, m * 2]);
      tris.push([botC, m * 2 + 1, m2 * 2 + 1]);
    }
    return { verts: verts, tris: tris };
  }

  var MESH_BUILDERS = { box3d: buildBox, sphere3d: buildSphere, plane3d: buildPlane, cylinder3d: buildCylinder };

  // Mesh cache: derived from (kind, w, h, d) only. WeakMap so cached meshes
  // never leak into saved project data and never pin objects. Model meshes
  // bypass this cache — the host's resolveModel hook caches fitted meshes
  // itself (it owns the asset bytes), so hydra-3d stays decoupled from the
  // glTF parser.
  var meshCache = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;
  function meshFor(obj, resolveModel) {
    var kind = String(obj.kind || '');
    if (kind === 'model3d') return modelMeshFor(obj, resolveModel);
    var builder = MESH_BUILDERS[kind];
    if (!builder) return null;
    var w = posNum(obj.width, 64), h = posNum(obj.height, 64), d = posNum(obj.depth, Math.min(w, h));
    var key = kind + '|' + w + '|' + h + '|' + d;
    try {
      if (meshCache) {
        var hit = meshCache.get(obj);
        if (hit && hit.key === key) return hit.mesh;
      }
      var mesh = builder(w, h, d);
      if (meshCache) meshCache.set(obj, { key: key, mesh: mesh });
      return mesh;
    } catch (e) { return null; }
  }

  // A model3d mesh comes from the host's resolveModel(obj) hook, which
  // returns hydra-3d's mesh shape { verts, tris, colors, uvs, tex }
  // (colors/uvs/tex optional, parallel to tris) with a `cacheKey` string
  // the host changes whenever the asset bytes or fit dimensions change —
  // or null. The host may also attach `texImages` ({ texIndex: decoded
  // <img> }) so textured triangles actually paint; without it they fall
  // back to flat colors. No hook, no asset, or a failed parse renders an
  // honest placeholder box in the object's color; the scene never breaks
  // because a model is missing.
  function modelMeshFor(obj, resolveModel) {
    var w = posNum(obj.width, 120), h = posNum(obj.height, 120), d = posNum(obj.depth, Math.min(w, h));
    var mesh = null;
    try {
      if (typeof resolveModel === 'function') mesh = resolveModel(obj);
    } catch (e) { mesh = null; }
    var usable = mesh && Array.isArray(mesh.verts) && Array.isArray(mesh.tris) && mesh.tris.length > 0;
    // Without a host cacheKey we cannot tell a fresh mesh from a stale one,
    // so skip the cache and trust the hook's return value as-is.
    if (usable && !(mesh.cacheKey)) return mesh;
    var key = 'model|' + (usable ? String(mesh.cacheKey) : 'placeholder') +
      '|' + w + '|' + h + '|' + d;
    try {
      if (meshCache) {
        var hit = meshCache.get(obj);
        if (hit && hit.key === key) return hit.mesh;
      }
      var out = usable ? mesh : buildBox(w, h, d);
      if (meshCache) meshCache.set(obj, { key: key, mesh: out });
      return out;
    } catch (e) { return usable ? mesh : buildBox(w, h, d); }
  }

  // ---------- camera + projection ----------
  function cameraBasis(cam) {
    var pos = [fin(cam.x), fin(cam.y), fin(cam.z)];
    var tgt = [fin(cam.tx), fin(cam.ty), fin(cam.tz)];
    var fwd = vnorm(vsub(tgt, pos));
    if (vlen(fwd) < 1e-9) fwd = [0, 0, -1];
    var up = [0, -1, 0]; // screen-up is world -y (matches the 2D canvas)
    var right = vnorm(vcross(up, fwd));
    if (vlen(right) < 1e-9) right = [1, 0, 0];
    var cup = vcross(fwd, right);
    return { pos: pos, fwd: fwd, right: right, up: cup };
  }

  // World point -> screen {x, y, depth} or null when behind the camera.
  function projectPoint(basis, fovDeg, p, W, H) {
    var v = vsub(p, basis.pos);
    var cx = vdot(v, basis.right), cy = vdot(v, basis.up), cz = vdot(v, basis.fwd);
    if (cz < 1) return null;
    var f = (H / 2) / Math.tan(Math.max(10, Math.min(120, fovDeg)) * DEG / 2);
    return { x: W / 2 + (cx / cz) * f, y: H / 2 - (cy / cz) * f, depth: cz };
  }

  // #rrggbb (or #rgb) scaled by light 0..1. Unknown colors -> engine blue.
  function shadeColor(hex, light) {
    var c = String(hex || '').trim();
    var m = /^#([0-9a-fA-F]{6})$/.exec(c) || /^#([0-9a-fA-F]{3})$/.exec(c);
    var r, g, b;
    if (!m) { r = 0x44; g = 0x88; b = 0xff; }
    else if (m[1].length === 3) {
      r = parseInt(m[1][0] + m[1][0], 16); g = parseInt(m[1][1] + m[1][1], 16); b = parseInt(m[1][2] + m[1][2], 16);
    } else {
      r = parseInt(m[1].substr(0, 2), 16); g = parseInt(m[1].substr(2, 2), 16); b = parseInt(m[1].substr(4, 2), 16);
    }
    var k = Math.min(1.15, Math.max(0.08, Number(light)));
    function ch(v) { return Math.min(255, Math.max(0, Math.round(v * k))); }
    return 'rgb(' + ch(r) + ',' + ch(g) + ',' + ch(b) + ')';
  }

  var LIGHT_DIR = vnorm([-0.45, -0.75, 0.55]); // fixed key light (screen-up-left-front)

  // Paint one screen-space triangle with a texture: affine-map the texture
  // triangle (UV * image size) onto the screen triangle with ctx.transform,
  // then darken by the light factor and wash by the tint (white = no-op).
  // Returns false when the triangle cannot be textured (degenerate UVs,
  // undecoded image, stub context) so the caller falls back to the flat
  // color. Never throws.
  function drawTexturedTri(ctx, img, uv, q, light, tint) {
    try {
      var iw = Number(img && img.width), ih = Number(img && img.height);
      if (!(iw > 0) || !(ih > 0) || !uv) return false;
      function upair(p) {
        if (!Array.isArray(p)) return null;
        return [fin(p[0]) * iw, fin(p[1]) * ih];
      }
      var t0 = upair(uv[0]), t1 = upair(uv[1]), t2 = upair(uv[2]);
      if (!t0 || !t1 || !t2) return false;
      var det = (t1[0] - t0[0]) * (t2[1] - t0[1]) - (t2[0] - t0[0]) * (t1[1] - t0[1]);
      if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return false;
      function triPath() {
        ctx.beginPath();
        ctx.moveTo(q[0].x, q[0].y);
        ctx.lineTo(q[1].x, q[1].y);
        ctx.lineTo(q[2].x, q[2].y);
        ctx.closePath();
      }
      var a = ((q[1].x - q[0].x) * (t2[1] - t0[1]) - (q[2].x - q[0].x) * (t1[1] - t0[1])) / det;
      var b = ((q[1].y - q[0].y) * (t2[1] - t0[1]) - (q[2].y - q[0].y) * (t1[1] - t0[1])) / det;
      var c = ((q[2].x - q[0].x) * (t1[0] - t0[0]) - (q[1].x - q[0].x) * (t2[0] - t0[0])) / det;
      var d = ((q[2].y - q[0].y) * (t1[0] - t0[0]) - (q[1].y - q[0].y) * (t2[0] - t0[0])) / det;
      var e = q[0].x - a * t0[0] - c * t0[1];
      var f = q[0].y - b * t0[0] - d * t0[1];
      if (![a, b, c, d, e, f].every(function (v) { return Number.isFinite(v); })) return false;
      ctx.save();
      triPath();
      ctx.clip();
      ctx.transform(a, b, c, d, e, f);
      ctx.drawImage(img, 0, 0);
      ctx.restore();
      // Flat-shade wash: darken by the same light factor the flat path uses.
      // P4 item 3D5: with scene lights the wash is the per-channel light
      // multiplied over the texture (white = no-op), so colored lights
      // tint textures exactly like they tint flat triangles.
      if (Array.isArray(light) && light.length === 3) {
        var mr = Math.min(1, Math.max(0, Number(light[0]))),
            mg = Math.min(1, Math.max(0, Number(light[1]))),
            mb = Math.min(1, Math.max(0, Number(light[2])));
        if (mr < 0.999 || mg < 0.999 || mb < 0.999) {
          ctx.save(); triPath();
          ctx.globalCompositeOperation = 'multiply';
          ctx.fillStyle = 'rgb(' + Math.round(mr * 255) + ',' + Math.round(mg * 255) + ',' + Math.round(mb * 255) + ')';
          ctx.fill(); ctx.restore();
        }
      } else {
        var lk = Math.min(1, Math.max(0, Number(light)));
        var darkA = (1 - lk) * 0.75;
        if (darkA > 0.01) {
          ctx.save(); triPath();
          ctx.fillStyle = 'rgba(2,6,23,' + darkA.toFixed(3) + ')';
          ctx.fill(); ctx.restore();
        }
      }
      // Tint wash: white tint is a no-op; deeper tints wash the texture.
      var tintAvg = (Number(tint[0]) + Number(tint[1]) + Number(tint[2])) / 3;
      var tintA = (1 - Math.min(1, Math.max(0, tintAvg))) * 0.55;
      if (tintA > 0.01) {
        ctx.save(); triPath();
        ctx.fillStyle = 'rgb(' + Math.round(Math.min(1, Math.max(0, Number(tint[0]))) * 255) + ',' +
          Math.round(Math.min(1, Math.max(0, Number(tint[1]))) * 255) + ',' +
          Math.round(Math.min(1, Math.max(0, Number(tint[2]))) * 255) + ')';
        ctx.globalAlpha = tintA;
        ctx.fill(); ctx.restore();
      }
      return true;
    } catch (err) { return false; }
  }

  // Material tint as [r,g,b] 0..1. Anything unparseable reads as white
  // (no tint), so old projects render exactly as before.
  function tintRGB(hex) {
    var c = String(hex || '').trim();
    var m = /^#([0-9a-fA-F]{6})$/.exec(c) || /^#([0-9a-fA-F]{3})$/.exec(c);
    if (!m) return [1, 1, 1];
    var h = m[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [
      parseInt(h.substr(0, 2), 16) / 255,
      parseInt(h.substr(2, 2), 16) / 255,
      parseInt(h.substr(4, 2), 16) / 255
    ];
  }

  // Flat-shade an [r,g,b] 0..1 triple by the light factor. Defensive:
  // hostile channels collapse to mid-gray, never NaN.
  function shadeRGB(r, g, b, light) {
    var k = Math.min(1.15, Math.max(0.08, Number(light)));
    function ch(v) {
      v = Number(v);
      if (!Number.isFinite(v)) v = 0.5;
      return Math.min(255, Math.max(0, Math.round(Math.min(1, Math.max(0, v)) * 255 * k)));
    }
    return 'rgb(' + ch(r) + ',' + ch(g) + ',' + ch(b) + ')';
  }

  // ---------- 3D lighting (P4 item 3D5) ----------
  // Enabled lights as plain records: { type, color:[r,g,b], intensity,
  // range, pos:[x,y,z] (point), dir:[x,y,z] (direction TO the light,
  // directional) }. A directional light is aimed by the light object's
  // Rot X / Rot Y; no rotation reproduces the classic fixed key light,
  // so adding a first directional light keeps a familiar look. Pure;
  // never throws.
  function collectLights3d(objects) {
    var out = [];
    try {
      var list = Array.isArray(objects) ? objects : [];
      for (var i = 0; i < list.length; i++) {
        var o = list[i];
        if (!o || typeof o !== 'object' || !isLight3d(o.kind)) continue;
        normalizeLight3d(o);
        if (o.light.enabled === false) continue;
        var rec = {
          type: o.light.type,
          color: tintRGB(o.light.color),
          intensity: o.light.intensity,
          range: o.light.range,
          pos: centerOf(o),
          dir: [0, 0, 0]
        };
        if (rec.type === 'directional') {
          rec.dir = vnorm(rotXYZ(LIGHT_DIR, o.rotX, o.rotY, 0));
          if (!(vlen(rec.dir) > 1e-9)) rec.dir = LIGHT_DIR.slice();
        }
        out.push(rec);
      }
    } catch (e) { /* lights are decoration; never break the frame */ }
    return out;
  }

  // Total light hitting a surface point: [r,g,b] irradiance, each channel
  // clamped to [0, 1.15] (the shadeRGB headroom). normal = world-space
  // face normal, point = world-space surface point.
  //   - ambient lights add intensity x color everywhere (no direction);
  //   - directional lights add intensity x color x max(0, N.L);
  //   - point lights add intensity x color x max(0, N.L) x linear falloff
  //     (range <= 0 = no falloff; beyond range = no light).
  // Scenes whose lights include no ambient light keep a dim 0.25 white
  // base so nothing goes pitch black; adding an Ambient light replaces
  // that base (even an intensity-0 one — then darkness is explicit).
  // Pure; never throws.
  function computeLightRGB(normal, point, lights) {
    var r = 0, g = 0, b = 0;
    try {
      var list = Array.isArray(lights) ? lights : [];
      var hasAmbient = false, i, L;
      for (i = 0; i < list.length; i++) {
        if (list[i] && list[i].type === 'ambient') { hasAmbient = true; break; }
      }
      if (!hasAmbient) { r = 0.25; g = 0.25; b = 0.25; }
      var n = Array.isArray(normal) ? normal : [0, 0, 0];
      var p = Array.isArray(point) ? point : [0, 0, 0];
      for (i = 0; i < list.length; i++) {
        L = list[i];
        if (!L || typeof L !== 'object') continue;
        var inten = Number(L.intensity);
        if (!(inten > 0)) continue;
        var c = Array.isArray(L.color) ? L.color : [1, 1, 1];
        var nd = 0;
        if (L.type === 'ambient') {
          nd = 1;
        } else {
          var toLight = (L.type === 'directional')
            ? (Array.isArray(L.dir) ? L.dir : [0, 0, 0])
            : vsub(Array.isArray(L.pos) ? L.pos : [0, 0, 0], p);
          var tl = vlen(toLight);
          if (!(tl > 1e-9)) continue;
          nd = Math.max(0, vdot(n, vscale(toLight, 1 / tl)));
          if (!(nd > 0)) continue;
          if (L.type === 'point') {
            var rng = Number(L.range);
            if (rng > 0) {
              var att = 1 - tl / rng;
              if (!(att > 0)) continue;
              nd *= att;
            }
          }
        }
        r += inten * nd * (Number(c[0]) || 0);
        g += inten * nd * (Number(c[1]) || 0);
        b += inten * nd * (Number(c[2]) || 0);
      }
    } catch (e) { r = 0.25; g = 0.25; b = 0.25; }
    function cl(v) {
      v = Number(v);
      if (!Number.isFinite(v)) v = 0.25;
      return Math.min(1.15, Math.max(0, v));
    }
    return [cl(r), cl(g), cl(b)];
  }

  // Flat-shade an [r,g,b] 0..1 triple by a per-channel light [lr,lg,lb].
  function shadeRGB3(r, g, b, lr, lg, lb) {
    return shadeRGB(r * fin(lr), g * fin(lg), b * fin(lb), 1);
  }

  // Hex color shaded by a per-channel light. Unknown colors fall back to
  // the engine blue, like shadeColor.
  function shadeLitColor(hex, lr, lg, lb) {
    var c = String(hex || '').trim();
    var m = /^#([0-9a-fA-F]{6})$/.exec(c) || /^#([0-9a-fA-F]{3})$/.exec(c);
    var rgb = m ? tintRGB(hex) : [0x44 / 255, 0x88 / 255, 0xff / 255];
    return shadeRGB3(rgb[0], rgb[1], rgb[2], lr, lg, lb);
  }

  // P4 item 3D5: simple blob shadows. shadowParams3d is the pure math:
  // null, or { cx, cz, rx, rz, groundY, alpha } for the soft ellipse an
  // object drops on the horizontal ground plane y = groundY (y grows
  // down, so the plane sits below the object's underside). Alpha fades
  // with height above the plane. Never throws.
  function shadowParams3d(obj, groundY) {
    try {
      if (!obj || typeof obj !== 'object') return null;
      if (isLight3d(obj.kind) || !is3dKind(obj.kind)) return null;
      var gy = Number(groundY);
      if (!Number.isFinite(gy)) return null;
      var c = centerOf(obj);
      var w = posNum(obj.width, 64), h = posNum(obj.height, 64);
      var d = posNum(obj.depth, Math.min(w, h));
      var above = gy - (c[1] + h / 2);
      if (!(above >= 0)) return null; // at or below the plane: no shadow
      var alpha = 0.32 * Math.min(1, Math.max(0.15, 1 - above / 700));
      return { cx: c[0], cz: c[2], rx: w / 2, rz: d / 2, groundY: gy, alpha: alpha };
    } catch (e) { return null; }
  }

  // Draw all blob shadows for a frame. Shadows land on the ground plane
  // and are drawn right after the reference grid, before geometry — a
  // deliberate simple-shadow limit: an object between the camera and the
  // ground plane can overdraw its own shadow. Guarded like drawGrid so a
  // stub context never breaks the frame.
  function drawShadows3d(ctx, scene, objects, basis, fov, W, H) {
    try {
      if (!scene || scene.shadows3d !== true) return;
      if (!ctx || typeof ctx.ellipse !== 'function') return;
      var gy = Number(scene.shadowGroundY);
      if (!Number.isFinite(gy)) gy = posNum(scene.worldHeight, 600);
      var list = Array.isArray(objects) ? objects : [];
      for (var i = 0; i < list.length; i++) {
        var sp = shadowParams3d(list[i], gy);
        if (!sp) continue;
        var c = projectPoint(basis, fov, [sp.cx, sp.groundY, sp.cz], W, H);
        var ax = projectPoint(basis, fov, [sp.cx + sp.rx, sp.groundY, sp.cz], W, H);
        var az = projectPoint(basis, fov, [sp.cx, sp.groundY, sp.cz + sp.rz], W, H);
        if (!c || !ax || !az) continue;
        var vaxx = ax.x - c.x, vaxy = ax.y - c.y;
        var vazx = az.x - c.x, vazy = az.y - c.y;
        var rxS = Math.sqrt(vaxx * vaxx + vaxy * vaxy);
        var rzS = Math.sqrt(vazx * vazx + vazy * vazy);
        if (!(rxS > 0.5) || !(rzS > 0.5)) continue;
        ctx.save();
        ctx.fillStyle = 'rgba(2,6,23,' + sp.alpha.toFixed(3) + ')';
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, rxS, rzS, Math.atan2(vaxy, vaxx), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    } catch (e) { /* shadows are decoration; never break the frame */ }
  }

  function drawGrid(ctx, basis, fov, scene, W, H) {
    try {
      var worldW = posNum(scene && scene.worldWidth, 800);
      var worldH = posNum(scene && scene.worldHeight, 600);
      var step = 64;
      ctx.save();
      ctx.strokeStyle = 'rgba(100,116,139,0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      var x, y, p0, p1;
      for (x = 0; x <= worldW + 1; x += step) {
        p0 = projectPoint(basis, fov, [x, 0, 0], W, H);
        p1 = projectPoint(basis, fov, [x, worldH, 0], W, H);
        if (p0 && p1) { ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); }
      }
      for (y = 0; y <= worldH + 1; y += step) {
        p0 = projectPoint(basis, fov, [0, y, 0], W, H);
        p1 = projectPoint(basis, fov, [worldW, y, 0], W, H);
        if (p0 && p1) { ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); }
      }
      ctx.stroke();
      ctx.restore();
    } catch (e) { /* the grid is decoration; never break the frame */ }
  }

  // Draw every 3D object in `objects` with perspective projection and flat
  // shading. The host fills the background and draws 2D/HUD passes. The
  // optional resolveModel(obj) hook supplies model3d meshes (see
  // modelMeshFor); without it, models draw as placeholder boxes. Never
  // throws; hostile scenes degrade to an empty draw, never a broken frame.
  function renderScene(ctx, scene, objects, viewW, viewH, resolveModel) {
    try {
      if (!ctx) return 0;
      var W = (Number(viewW) > 0) ? Number(viewW) : 800;
      var H = (Number(viewH) > 0) ? Number(viewH) : 600;
      var list = Array.isArray(objects) ? objects : [];
      // P4 item 3D5: lights. A scene with no light objects keeps the
      // legacy fixed key light, so old projects render pixel-identically.
      var lights = collectLights3d(list);
      var useLights = lights.length > 0;
      var cam = normalizeCamera3d(scene && scene.camera3d, scene);
      var basis = cameraBasis(cam);
      drawGrid(ctx, basis, cam.fov, scene, W, H);
      // P4 item 3D5: simple blob shadows (scene.shadows3d), drawn before
      // geometry on the ground plane.
      drawShadows3d(ctx, scene, list, basis, cam.fov, W, H);

      var draw = []; // {pts:[s0,s1,s2], depth, color}
      for (var oi = 0; oi < list.length; oi++) {
        var obj = list[oi];
        if (!obj || typeof obj !== 'object' || !is3dKind(obj.kind)) continue;
        var mesh = meshFor(obj, resolveModel);
        if (!mesh) continue;
        var c = centerOf(obj);
        var rx = fin(obj.rotX), ry = fin(obj.rotY), rz = fin(obj.rotZ);
        // Local -> world: rotate, then translate to the center.
        var world = new Array(mesh.verts.length);
        for (var vi = 0; vi < mesh.verts.length; vi++) {
          world[vi] = vadd(rotXYZ(mesh.verts[vi], rx, ry, rz), c);
        }
        var proj = new Array(world.length);
        var ok = true;
        for (var pi = 0; pi < world.length; pi++) {
          var s = projectPoint(basis, cam.fov, world[pi], W, H);
          if (!s) { ok = false; break; }
          proj[pi] = s;
        }
        if (!ok) continue; // object intersects the near plane; skip it
        var baseColor = (typeof obj.color === 'string' && obj.color) ? obj.color : '#4488ff';
        var tint = tintRGB(obj.materialColor);
        var triColors = mesh.colors;
        var useTex = obj.useTexture !== false; // normalized to true; the
        // texture switch only applies to models with mesh.tex/uvs anyway
        for (var ti = 0; ti < mesh.tris.length; ti++) {
          var t = mesh.tris[ti];
          var p0 = world[t[0]], p1 = world[t[1]], p2 = world[t[2]];
          var n = vnorm(vcross(vsub(p1, p0), vsub(p2, p0)));
          // P4 item 3D5: per-triangle colored lighting when the scene has
          // lights; the legacy fixed key light otherwise (unchanged look).
          var light, lightRGB = null;
          if (useLights) {
            var pc = [(p0[0] + p1[0] + p2[0]) / 3, (p0[1] + p1[1] + p2[1]) / 3, (p0[2] + p1[2] + p2[2]) / 3];
            // The projector draws triangles double-sided (no backface
            // culling), so shade the side facing the camera: flip the
            // winding normal when it points away from the viewer.
            if (vdot(n, vsub(basis.pos, pc)) < 0) n = vscale(n, -1);
            lightRGB = computeLightRGB(n, pc, lights);
            light = 0.299 * lightRGB[0] + 0.587 * lightRGB[1] + 0.114 * lightRGB[2];
          } else {
            light = 0.42 + 0.58 * Math.abs(vdot(n, LIGHT_DIR));
          }
          var s0 = proj[t[0]], s1 = proj[t[1]], s2 = proj[t[2]];
          // Per-triangle material colors (3D models) are tinted by the
          // object's material color; primitives keep the hex path.
          var css = (triColors && triColors[ti])
            ? (useLights
              ? shadeRGB3(triColors[ti][0] * tint[0], triColors[ti][1] * tint[1], triColors[ti][2] * tint[2],
                lightRGB[0], lightRGB[1], lightRGB[2])
              : shadeRGB(triColors[ti][0] * tint[0], triColors[ti][1] * tint[1], triColors[ti][2] * tint[2], light))
            : (useLights
              ? shadeLitColor(baseColor, lightRGB[0], lightRGB[1], lightRGB[2])
              : shadeColor(baseColor, light));
          // Textured model triangles: the host attaches decoded images as
          // mesh.texImages[texIndex]; missing/failed images fall back to
          // the flat color path below.
          var texInfo = null;
          if (useTex && mesh.tex && mesh.uvs && mesh.texImages &&
              typeof mesh.tex[ti] === 'number' && mesh.tex[ti] >= 0 && mesh.uvs[ti]) {
            var texImg = mesh.texImages[mesh.tex[ti]];
            if (texImg) texInfo = { img: texImg, uv: mesh.uvs[ti] };
          }
          draw.push({
            pts: [s0, s1, s2],
            depth: (s0.depth + s1.depth + s2.depth) / 3,
            color: css,
            light: light,
            lightRGB: lightRGB,
            tint: tint,
            tex: texInfo
          });
          if (draw.length >= MAX_TRIS_PER_FRAME) break;
        }
        if (draw.length >= MAX_TRIS_PER_FRAME) break;
      }
      draw.sort(function (a, b) { return b.depth - a.depth; });
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(15,23,42,0.18)';
      for (var di = 0; di < draw.length; di++) {
        var d = draw[di], q = d.pts;
        ctx.beginPath();
        ctx.moveTo(q[0].x, q[0].y);
        ctx.lineTo(q[1].x, q[1].y);
        ctx.lineTo(q[2].x, q[2].y);
        ctx.closePath();
        if (d.tex) {
          // The textured path paints the triangle itself; a false return
          // (degenerate UV, stub context) falls back to the flat color.
          // With scene lights the per-channel light rides along so colored
          // lights tint textures too.
          if (!drawTexturedTri(ctx, d.tex.img, d.tex.uv, q, d.lightRGB || d.light, d.tint)) {
            ctx.fillStyle = d.color;
            ctx.fill();
          }
        } else {
          ctx.fillStyle = d.color;
          ctx.fill();
        }
        ctx.stroke();
      }
      ctx.restore();
    } catch (e) { /* a 3D frame must never crash the game loop */ }
    // P4 item 34 (profiling overlay): report how many triangles were drawn
    // so the host can show a real 3D draw count. Backward compatible —
    // old callers ignore the return value. (draw is hoisted; if the frame
    // failed before the draw list was built, this reads as 0.)
    return (draw && draw.length) || 0;
  }

  // ---------- hooks helpers ----------
  function numValue(hooks, raw) {
    try {
      var r = hooks.num(raw);
      if (r && typeof r.value !== 'undefined' && Number.isFinite(Number(r.value))) {
        return { ok: true, value: Number(r.value) };
      }
      if (typeof r === 'number' && Number.isFinite(r)) return { ok: true, value: r };
    } catch (e) { /* fall through */ }
    return { ok: false, value: 0 };
  }

  function safeTargets(hooks, data) {
    try {
      var list = hooks.targets(data);
      var out = [];
      for (var i = 0; i < (list || []).length; i++) {
        if (list[i] && typeof list[i] === 'object') out.push(list[i]);
      }
      return out;
    } catch (e) { return []; }
  }

  function safeByName(hooks, name) {
    try {
      var list = hooks.objectsByName(name);
      var out = [];
      for (var i = 0; i < (list || []).length; i++) {
        if (list[i] && typeof list[i] === 'object') out.push(list[i]);
      }
      return out;
    } catch (e) { return []; }
  }

  // Store/clear the host's 3D follow state. The hook is optional so old
  // hosts keep working; nothing here ever throws.
  function setFollowHook(hooks, follow) {
    try {
      if (hooks && typeof hooks.setFollow3d === 'function') {
        hooks.setFollow3d(normalize3dFollow(follow));
      }
    } catch (e) {}
  }

  // ---------- action dispatch ----------
  function apply3dAction(data, hooks) {
    if (!data || typeof data !== 'object') return;
    var type = data.type;
    if (ACTION_TYPES.indexOf(type) < 0) return;
    var targets = safeTargets(hooks, data);

    // keys: the three data-field names to read (e.g. ['x','y','z']).
    function triple(keys, label, fallback) {
      var vals = [];
      for (var i = 0; i < 3; i++) {
        var raw = data[keys[i]];
        var v = numValue(hooks, raw == null ? (fallback == null ? 0 : fallback) : raw);
        if (!v.ok) {
          try { hooks.warn(label + ': bad ' + keys[i] + ' expression — skipped.'); } catch (e) {}
          return null;
        }
        vals.push(v.value);
      }
      return vals;
    }

    if (type === 'set3dPosition') {
      var p = triple(['x', 'y', 'z'], 'Set 3D Position');
      if (!p) return;
      targets.forEach(function (o) {
        var w = posNum(o.width, 64), h = posNum(o.height, 64);
        o.posX = p[0] - w / 2; o.posY = p[1] - h / 2; o.z = p[2];
      });
      return;
    }
    if (type === 'move3d') {
      var d = triple(['dX', 'dY', 'dZ'], 'Move 3D');
      if (!d) return;
      targets.forEach(function (o) { o.posX = fin(o.posX) + d[0]; o.posY = fin(o.posY) + d[1]; o.z = fin(o.z) + d[2]; });
      return;
    }
    if (type === 'set3dRotation') {
      var r = triple(['rotX', 'rotY', 'rotZ'], 'Set 3D Rotation');
      if (!r) return;
      targets.forEach(function (o) { o.rotX = r[0]; o.rotY = r[1]; o.rotZ = r[2]; });
      return;
    }
    if (type === 'rotate3d') {
      var dr = triple(['rotX', 'rotY', 'rotZ'], 'Rotate 3D');
      if (!dr) return;
      targets.forEach(function (o) { o.rotX = fin(o.rotX) + dr[0]; o.rotY = fin(o.rotY) + dr[1]; o.rotZ = fin(o.rotZ) + dr[2]; });
      return;
    }
    if (type === 'setModelTint') {
      // Tints a 3D model's material colors (white = no tint). Bad colors
      // warn and skip, like the other 3D actions.
      var tintCol = String(data.color || '').trim();
      if (!isValidHexColor(tintCol)) {
        try { hooks.warn('Set Model Tint: bad color — skipped.'); } catch (e) {}
        return;
      }
      targets.forEach(function (o) { o.materialColor = tintCol; });
      return;
    }
    if (type === 'useModelTexture') {
      // Runtime texture switch for 3D models. On = the model's own
      // textures paint the triangles; Off = flat material colors. A bad
      // select warns and skips (the 3D convention).
      var mode = String(data.mode || 'on').trim().toLowerCase();
      if (mode !== 'on' && mode !== 'off') {
        try { hooks.warn('Use Model Texture: bad mode — skipped.'); } catch (e) {}
        return;
      }
      targets.forEach(function (o) { o.useTexture = (mode === 'on'); });
      return;
    }
    if (type === 'follow3dCamera') {
      // Blank name = clear the follow (the 2D followCamera convention — a
      // freshly placed block does nothing until an object is picked).
      var fname = String(data.targetObject || '').trim();
      if (!fname) { setFollowHook(hooks, null); return; }
      var off = triple(['offX', 'offY', 'offZ'], 'Follow 3D Object', 0);
      if (!off) return; // bad expression: warn already, keep old follow
      setFollowHook(hooks, { name: fname, dx: off[0], dy: off[1], dz: off[2] });
      return;
    }
    if (type === 'stop3dCameraFollow') {
      setFollowHook(hooks, null);
      return;
    }
    if (type === 'set3dCamera') {
      var cam = null;
      try { cam = hooks.camera3d(); } catch (e) { cam = null; }
      if (!cam || typeof cam !== 'object') return;
      var cx = numValue(hooks, data.camX == null ? 0 : data.camX);
      var cy = numValue(hooks, data.camY == null ? 0 : data.camY);
      var cz = numValue(hooks, data.camZ == null ? 0 : data.camZ);
      var tx = numValue(hooks, data.lookX == null ? 0 : data.lookX);
      var ty = numValue(hooks, data.lookY == null ? 0 : data.lookY);
      var tz = numValue(hooks, data.lookZ == null ? 0 : data.lookZ);
      if (!cx.ok || !cy.ok || !cz.ok || !tx.ok || !ty.ok || !tz.ok) {
        try { hooks.warn('Set 3D Camera: bad camera/look expression — skipped.'); } catch (e) {}
        return;
      }
      cam.x = cx.value; cam.y = cy.value; cam.z = cz.value;
      cam.tx = tx.value; cam.ty = ty.value; cam.tz = tz.value;
      // An explicit camera move ends any follow (the 2D setCamera rule).
      setFollowHook(hooks, null);
    }
    if (type === 'aim3dCamera') {
      // FPS mouse-look: keep the camera where it is, re-aim the look-at
      // point from yaw/pitch degrees. Unlike Set 3D Camera this never ends
      // a Follow 3D Object — park the camera on the player's head with
      // Follow 3D Object, then aim it every frame from the mouse deltas.
      var aim = triple(['yaw', 'pitch', 'dist'], 'Aim 3D Camera');
      if (!aim) return;
      var aimCam = null;
      try { aimCam = hooks.camera3d(); } catch (e) { aimCam = null; }
      if (!aimCam || typeof aimCam !== 'object') return;
      var look = yawPitchLookAt([aimCam.x, aimCam.y, aimCam.z], aim[0], aim[1], aim[2]);
      aimCam.tx = look[0]; aimCam.ty = look[1]; aimCam.tz = look[2];
      return;
    }
    if (type === 'move3dFacing') {
      // WASD-style motion along the yaw heading: Forward steps toward the
      // facing, Strafe steps right (negative = left). Same yaw convention
      // as Aim 3D Camera, so movement and mouse-look always agree.
      var mv = triple(['forward', 'strafe', 'yaw'], 'Move 3D Facing');
      if (!mv) return;
      var fwd = facingDelta(mv[0], mv[1], mv[2]);
      targets.forEach(function (o) { o.posX = fin(o.posX) + fwd[0]; o.z = fin(o.z) + fwd[1]; });
      return;
    }
    if (type === 'captureMouse') {
      // Pointer lock needs a real user gesture and a supporting browser.
      // The host performs the DOM call and reports success; on failure
      // warn with the fix (run it from a click). The runtimes dedupe the
      // warning, so a per-frame retry does not spam.
      var captured = false;
      try {
        captured = !!(hooks && typeof hooks.captureMouse === 'function' && hooks.captureMouse());
      } catch (e) { captured = false; }
      if (!captured) {
        try { hooks.warn('Capture Mouse: the browser did not lock the pointer — run this block from a click (Object Clicked or Mouse Click). The mouse still works uncaptured; Read Mouse Delta tracks cursor movement instead.'); } catch (e) {}
      }
      return;
    }
    if (type === 'releaseMouse') {
      try { if (hooks && typeof hooks.releaseMouse === 'function') hooks.releaseMouse(); } catch (e) {}
      return;
    }
    if (type === 'readMouseDelta') {
      // Copy this frame's accumulated mouse movement into game variables
      // (steer a yaw variable with it). Blank names warn and skip, like
      // the other variable-writing blocks.
      var dxName = String(data.dxVar || '').trim();
      var dyName = String(data.dyVar || '').trim();
      if (!dxName && !dyName) {
        try { hooks.warn('Read Mouse Delta: both variable names are blank — skipped. Name the variables that should receive this frame\u2019s mouse movement.'); } catch (e) {}
        return;
      }
      var delta = { x: 0, y: 0 };
      try {
        if (hooks && typeof hooks.readMouseDelta === 'function') {
          var rd = hooks.readMouseDelta();
          if (rd && typeof rd === 'object') delta = { x: fin(rd.x), y: fin(rd.y) };
        }
      } catch (e) {}
      try {
        if (typeof hooks.setVar === 'function') {
          if (dxName) hooks.setVar(dxName, delta.x);
          if (dyName) hooks.setVar(dyName, delta.y);
        }
      } catch (e) {}
      return;
    }
    if (type === 'set3dGravity') {
      // Sets the shared physics.gravity field on the targets (the same
      // field the Inspector's Physics panel edits, so the 2D Set Gravity
      // block and the panel stay in sync) and enables physics on them,
      // like the 2D Set Gravity block does.
      var gv = numValue(hooks, data.gravity == null ? 0 : data.gravity);
      if (!gv.ok) {
        try { hooks.warn('Set 3D Gravity: bad gravity expression — skipped.'); } catch (e) {}
        return;
      }
      targets.forEach(function (o) {
        if (!o.physics || typeof o.physics !== 'object') o.physics = {};
        o.physics.gravity = gv.value;
        o.physicsEnabled = true;
      });
      return;
    }
    if (type === 'set3dVelocity') {
      // Sets the 3D velocity (X/Y/Z) directly — launch, knockback, or
      // zero it to stop dead. Mirrors the 2D Set Velocity block.
      var vv = triple(['vx', 'vy', 'vz'], 'Set 3D Velocity');
      if (!vv) return;
      targets.forEach(function (o) { o.vel3x = vv[0]; o.vel3y = vv[1]; o.vel3z = vv[2]; });
      return;
    }
    if (type === 'set3dLight') {
      // P4 item 3D5: runtime light control — type, color, intensity,
      // range, on/off. Only light3d objects are touched; naming something
      // that is not a light warns instead of silently doing nothing.
      var lname = String(data.targetObject || '').trim();
      if (!lname) return; // blank: quiet, like setModelTint with no targets
      var lType = String(data.lightType || 'point').trim().toLowerCase();
      if (lType !== 'ambient' && lType !== 'directional' && lType !== 'point') {
        try { hooks.warn('Set 3D Light: bad light type — skipped.'); } catch (e) {}
        return;
      }
      var lColor = String(data.color || '').trim();
      if (!isValidHexColor(lColor)) {
        try { hooks.warn('Set 3D Light: bad color — skipped.'); } catch (e) {}
        return;
      }
      var lInten = numValue(hooks, data.intensity == null ? 1 : data.intensity);
      if (!lInten.ok) {
        try { hooks.warn('Set 3D Light: bad intensity expression — skipped.'); } catch (e) {}
        return;
      }
      var lRange = numValue(hooks, data.range == null ? 600 : data.range);
      if (!lRange.ok || !(lRange.value >= 0)) {
        try { hooks.warn('Set 3D Light: bad range expression — skipped.'); } catch (e) {}
        return;
      }
      var lMode = String(data.mode || 'on').trim().toLowerCase();
      if (lMode !== 'on' && lMode !== 'off') {
        try { hooks.warn('Set 3D Light: bad on/off mode — skipped.'); } catch (e) {}
        return;
      }
      var allTargets = safeTargets(hooks, data);
      var lTargets = allTargets.filter(function (o) { return isLight3d(o.kind); });
      if (lTargets.length === 0) {
        if (allTargets.length > 0) {
          try { hooks.warn('Set 3D Light: "' + lname + '" is not a light — skipped.'); } catch (e) {}
        }
        return;
      }
      lTargets.forEach(function (o) {
        normalizeLight3d(o);
        o.light.type = lType;
        o.light.color = lColor;
        o.light.intensity = lInten.value;
        o.light.range = lRange.value;
        o.light.enabled = (lMode === 'on');
      });
      return;
    }
  }

  // ---------- condition dispatch (read-only) ----------
  // Returns { pass, context }. Quiet (no per-frame warning spam) when a
  // name is blank, no live object matches, the value is bad, or the
  // operator is corrupt — the timer/pick convention.
  function eval3dCondition(data, hooks) {
    var ctx = {};
    function quiet() { return { pass: false, context: ctx }; }
    if (!data || typeof data !== 'object') return quiet();
    if (CONDITION_TYPES.indexOf(data.type) < 0) return quiet();
    // Pointer-lock state read: true while the host's pointer is locked to
    // the game canvas. Invert it to catch the player pressing Esc.
    if (data.type === 'mousePointerCaptured') {
      var lockedNow = false;
      try {
        lockedNow = !!(hooks && typeof hooks.pointerLocked === 'function' && hooks.pointerLocked());
      } catch (e) { lockedNow = false; }
      return { pass: lockedNow, context: ctx };
    }
    // P4 item 3D4: world-dependent 3D physics conditions. While the game
    // is paused the world is frozen, so they report the freeze (quiet)
    // instead of stale state — the 2D collision/onFloor convention. The
    // host's hooks.paused() is optional so old hosts keep working.
    function worldFrozen() {
      try { return !!(hooks && typeof hooks.paused === 'function' && hooks.paused()); }
      catch (e) { return false; }
    }
    if (data.type === 'onGround3d') {
      if (worldFrozen()) return quiet();
      var gName = String(data.targetObject || '').trim();
      if (!gName) return quiet();
      var gs = safeByName(hooks, gName);
      for (var gi = 0; gi < gs.length; gi++) {
        if (gs[gi]._onGround3d === true) { ctx.obj1 = gs[gi]; return { pass: true, context: ctx }; }
      }
      return quiet();
    }
    if (data.type === 'collision3d') {
      if (worldFrozen()) return quiet();
      var cA = String(data.object1 || '').trim();
      var cB = String(data.object2 || '').trim();
      if (!cA || !cB) return quiet();
      var as = safeByName(hooks, cA), bs = safeByName(hooks, cB);
      for (var ai = 0; ai < as.length; ai++) {
        for (var bi = 0; bi < bs.length; bi++) {
          if (as[ai] === bs[bi]) continue;
          if (pairOverlap3d(as[ai], bs[bi])) {
            ctx.obj1 = as[ai]; ctx.obj2 = bs[bi];
            return { pass: true, context: ctx };
          }
        }
      }
      return quiet();
    }
    var aName = String(data.object1 || '').trim();
    var bName = String(data.object2 || '').trim();
    if (!aName || !bName) return quiet();
    var as = safeByName(hooks, aName), bs = safeByName(hooks, bName);
    if (as.length === 0 || bs.length === 0) return quiet();
    var dv = numValue(hooks, data.distance == null ? 100 : data.distance);
    if (!dv.ok) return quiet();
    var op = typeof data.operator === 'string' ? data.operator : '<=';
    var dist = distance3d(as[0], bs[0]);
    var pass;
    switch (op) {
      case '<=': pass = dist <= dv.value; break;
      case '<': pass = dist < dv.value; break;
      case '>=': pass = dist >= dv.value; break;
      case '>': pass = dist > dv.value; break;
      case '==': pass = dist === dv.value; break;
      case '!=': pass = dist !== dv.value; break;
      default: return quiet();
    }
    if (pass) { ctx.obj1 = as[0]; ctx.obj2 = bs[0]; }
    return { pass: pass, context: ctx };
  }

  function is3dAction(t) { return ACTION_TYPES.indexOf(t) >= 0; }
  function is3dCondition(t) { return CONDITION_TYPES.indexOf(t) >= 0; }

  return {
    ACTION_TYPES: ACTION_TYPES,
    CONDITION_TYPES: CONDITION_TYPES,
    THREE_D_KINDS: THREE_D_KINDS,
    LIGHT3D_KIND: LIGHT3D_KIND,
    MAX_TRIS_PER_FRAME: MAX_TRIS_PER_FRAME,
    is3dAction: is3dAction,
    is3dCondition: is3dCondition,
    is3dKind: is3dKind,
    isLight3d: isLight3d,
    normalizeObject3d: normalizeObject3d,
    normalizeLight3d: normalizeLight3d,
    migrateLegacyLight3d: migrateLegacyLight3d,
    collectLights3d: collectLights3d,
    computeLightRGB: computeLightRGB,
    shadowParams3d: shadowParams3d,
    shadeRGB3: shadeRGB3,
    shadeLitColor: shadeLitColor,
    normalizeCamera3d: normalizeCamera3d,
    normalizeRenderMode: normalizeRenderMode,
    normalize3dFollow: normalize3dFollow,
    normalizePhysics3d: normalizePhysics3d,
    isSolid3d: isSolid3d,
    collider3dOf: collider3dOf,
    pairOverlap3d: pairOverlap3d,
    updatePhysics3d: updatePhysics3d,
    tick3dCameraFollow: tick3dCameraFollow,
    centerOf: centerOf,
    distance3d: distance3d,
    yawPitchLookAt: yawPitchLookAt,
    facingDelta: facingDelta,
    buildBox: buildBox,
    buildPlane: buildPlane,
    buildSphere: buildSphere,
    buildCylinder: buildCylinder,
    cameraBasis: cameraBasis,
    projectPoint: projectPoint,
    rotXYZ: rotXYZ,
    shadeColor: shadeColor,
    renderScene: renderScene,
    apply3dAction: apply3dAction,
    eval3dCondition: eval3dCondition,
    tintRGB: tintRGB,
    shadeRGB: shadeRGB,
    v3: v3, vadd: vadd, vsub: vsub, vdot: vdot, vcross: vcross, vlen: vlen, vnorm: vnorm
  };
}

window.Hydra3d = hydra3dFactory();
// Self-contained source of the factory, inlined into exported playable games
// by HydraPlayer.buildPlayableHtml so exports run without editor files.
window.Hydra3d.factorySource = hydra3dFactory.toString();
