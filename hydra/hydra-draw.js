/* ============================================================================
 * hydra-draw.js — HydraScript shared draw passes (P2 item 15/12, slice 6:
 * the shared-engine extraction continues here).
 *
 * Pure logic, no DOM access (the only DOM touch is the host's
 * getDarkCanvas hook, which creates the offscreen canvas). This is the
 * SINGLE canonical implementation of the frame the player sees — the part
 * of the engine that turns a scene + a camera into canvas calls — used by:
 *   - the editor preview runtime (script.js drawGame delegates to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Why this slice sixth, and last of the large ones: the two runtimes drew
 * the same frame in the same order — background, 3D pass, world objects,
 * particles, darkness overlay, HUD pass, screen flash, profiler overlay —
 * but "the same" hid real divergences (below), and the draw code was
 * ~350 lines of near-identical code in two places (export draw +
 * drawAny/drawTilemap/drawPanel/drawText/drawObject/drawFitted, preview
 * drawGame + its nested drawPreview* helpers). The frame itself is now
 * shared code; each host only supplies its subsystem modules, its image
 * resolution, and its three host-specific bits as hooks.
 *
 * One frame, in order (the export's order, which is the reference):
 *   1. The shaken render camera: the base camera plus the HydraCameraFx
 *      shake offset (the module returns it, so the export keeps setting
 *      state.renderCamera from it exactly as before).
 *   2. Background: the scene bg image (drawn at the world size, zoomed)
 *      or the bg color fill.
 *   3. 3D pass (3D scenes only): the Hydra3d projector over the live
 *      3D kinds + lights, with the host's model-mesh resolver.
 *   4. World pass: live objects sorted by layer, skipping destroyed /
 *      hidden / HUD / light3d / light2d / (in 3D scenes) 3D kinds;
 *      text, panel, tilemap, and sprite draws per object.
 *   5. Particles: world-space, zoom-scaled, above the world.
 *   5b. Damage numbers: world-space, zoom-scaled, above the world
 *      and particles (P4 Advanced batch 22) — a floating hit number
 *      reads on top of the burst that caused it.
 *   6. Darkness overlay (2D scenes, darkness > 0): the HydraLight2d
 *      composite above the world and particles, below the HUD.
 *   7. HUD pass: HUD objects last, camera-independent.
 *   8. Screen flash: the HydraCameraFx wash above the HUD.
 *   9. Profiler overlay: the per-frame draw counts, painted last.
 *  10. onFrameEnd hook (preview-only DOM sync: the Profiler + Trace
 *      toolbar buttons and the Trace panel).
 *
 * Hooks (all optional):
 *   - ui, tiles, anim, blendSpace, skeleton, layerFx, light2d, threeD,
 *     cameraFx, particles, profile — the shared subsystem modules. The
 *     export passes its hard-guarded modules; the preview passes
 *     window.Hydra* (or null). A missing module degrades the way the
 *     preview always did: no tiles module means tilemaps draw nothing,
 *     no 3D module means a 3D scene draws flat, no profiler means no
 *     overlay, no cameraFx means no shake/flash.
 *   - damageFx — the shared HydraDamageFx module (or null). A missing
 *     module draws no floating numbers, exactly as before.
 *   - health — the shared HydraHealth module (or null). A missing
 *     module draws no health bars, exactly as before.
 *   - parallax — the shared HydraParallax module (or null). A non-fixed
 *     object draws against its parallax camera (the live camera scaled
 *     by the object's factors); a missing module draws every object at
 *     world speed, exactly as before.
 *   - image(assetId, isBackground) -> image element or null. The export
 *     resolves through its asset caches (missing assets read as null);
 *     the preview resolves through getImage / getBgImage.
 *   - modelMesh(obj) -> fitted mesh or null, for the 3D pass. The
 *     export resolves through its model cache; the preview passes
 *     resolveModelMeshFor (or null).
 *   - getDarkCanvas() -> canvas or null. The host creates it lazily and
 *     caches it: the export's vm-stub-safe creation, the preview's
 *     direct createElement on previewState.
 *   - buttonState(obj, sx, sy, scale) -> 'normal' | 'hover' | 'pressed'.
 *     The export computes it live from the mouse in the draw (the old
 *     buttonUiState); the preview reads obj._uiState, precomputed once
 *     per frame by updateUiWidgetStates in gameLoop.
 *   - drawLabel(ctx, obj, info) — preview-only: the showLabel name tag
 *     under a sprite (info: { cx, cy, camX, camY, zoom, fixed }).
 *     The export passes nothing; labels never drew in exports.
 *   - onFrameEnd(result) — preview-only DOM sync after the overlay
 *     (Profiler button active state, Trace button + panel). The export
 *     passes nothing.
 *
 * Semantics:
 *   - drawFrame(ctx, view, hooks): draws one frame and returns
 *     { draws2d, tris3d, camera, camera3d } (camera is the shaken
 *     render camera; camera3d is the normalized 3D camera, or null).
 *     A non-object ctx or view is a no-op returning false. Nothing
 *     here ever throws: a throwing hook or a throwing per-object draw
 *     degrades to a skipped pass / skipped object, never a dead frame.
 *   - drawObject / drawTextObject / drawPanelObject / drawSpriteObject
 *     / drawTilemapObject: the per-kind draws, exported for tests.
 *     Each takes (ctx, view, hooks, obj, cam) with cam the shaken
 *     render camera { x, y, zoom }.
 *   - normalizeCameraZoom, shakenCamera, roundedRectPath, drawScaleOf,
 *     applyDrawTransform, drawFitted, isScreenFixed, widgetScreenPos:
 *     the small draw helpers, exported for tests.
 *
 * Behavior changes vs the old inline code (all in the direction the code
 * already documented with "(mirrors the export)" / "(mirrors the editor
 * preview)" comments — the two runtimes were supposed to agree and did
 * not):
 *   - Text objects now rotate in exports. The preview rotated text
 *     about the text-box center; the export ignored obj.rotation
 *     entirely, so a rotated label looked different in the preview
 *     and in the exported game. The module rotates (the preview's
 *     behavior); exports gain the rotation the preview already showed.
 *   - Text boxes now measure their text when the object has no width.
 *     The preview fell back to ctx.measureText when obj.width was
 *     falsy (centering / flip centers used the real text width); the
 *     export used width 1. The module measures (guarded: a context
 *     without measureText reads as 0, exactly the export's old width).
 *   - The background image now draws at worldWidth || width. The
 *     export used scene.worldWidth/worldHeight; the preview used
 *     scene.width/height (which normalizeSceneDimensions syncs to the
 *     world size on every getPreviewScene). On normalized scenes the
 *     two are identical; the module reads worldWidth first and falls
 *     back to width, then to the canvas size, so an unnormalized scene
 *     still fills the canvas.
 *   - The object list is sorted once and reused for the HUD pass. The
 *     export sorted twice (identical order); the preview sorted once.
 *     Same draw order, one less sort.
 *
 * Deliberate resilience delta (in the direction of the frame slice):
 * a throwing per-object draw or a throwing pass no longer kills the
 * rAF chain. The old inline loops had no guard at all — one bad object
 * froze the game. A bad object is now skipped (and not counted in
 * draws2d) and the frame continues; a bad pass is skipped the same
 * way. A draw error is still a bug and still shows up in the test
 * suite's outcome assertions; it just no longer takes the game down
 * in front of a player.
 *
 * Deliberately NOT unified (stays host-side, documented here so the
 * next slice does not "fix" it by accident):
 *   - Button hover/press state: the export computes it live from the
 *     mouse inside the text draw; the preview precomputes obj._uiState
 *     once per frame in gameLoop (updateUiWidgetStates) and the draw
 *     reads it. The two computations use the same screen-box math;
 *     unifying the timing would change when a hover starts showing.
 *   - Profiler / Trace toolbar sync: editor DOM, preview-only, behind
 *     the onFrameEnd hook. Exports have no toolbar.
 *   - Name labels (obj.showLabel): preview-only editor affordance,
 *     behind the drawLabel hook. Exports never drew them.
 *   - Dark-canvas creation: host-side via getDarkCanvas (the export's
 *     creation is vm-stub-safe; the preview's is a plain createElement
 *     on previewState). The module only ever draws into the canvas the
 *     hook returns.
 *   - The 2D physics / script dispatch around the draw stays where it
 *     is (HydraFrame stepFrame calls draw as a phase hook in both
 *     runtimes); this module owns the draw itself, not the loop.
 *
 * Load order (index.html): hydra-draw.js BEFORE player-runtime.js and
 * script.js. player-runtime.js throws a clear error if HydraDraw is
 * missing. The preview guards the drawFrame call (window.HydraDraw),
 * so the editor still boots if the tag is ever dropped — the canvas
 * keeps its last frame, the same guarded-call degradation the other
 * shared modules use; the tag order is pinned by tests/draw.test.js.
 * ========================================================================== */

function hydraDrawFactory() {
  'use strict';

  // Camera zoom clamp 0.25-4, corrupt values read as 1 — the identical
  // three lines both runtimes carry (kept local so the module never
  // reads a host global for its own zoom math).
  function normalizeCameraZoom(value) {
    var z = Number(value);
    return Number.isFinite(z) ? Math.min(4, Math.max(0.25, z)) : 1;
  }

  // The shaken render camera: the base camera plus the HydraCameraFx
  // shake offset. A missing or throwing cameraFx reads as no shake.
  // Always a fresh record — no caller can alias the host's camera.
  function shakenCamera(camera, shake, cameraFx) {
    var base = (camera && typeof camera === 'object') ? camera : { x: 0, y: 0, zoom: 1 };
    var off = { x: 0, y: 0 };
    try {
      if (cameraFx && typeof cameraFx.shakeOffset === 'function') {
        var o = cameraFx.shakeOffset(shake);
        if (o && typeof o === 'object') off = o;
      }
    } catch (e) { off = { x: 0, y: 0 }; }
    return {
      x: (base.x || 0) + (off.x || 0),
      y: (base.y || 0) + (off.y || 0),
      zoom: base.zoom || 1
    };
  }

  // Set membership that never throws: a missing set, a non-function
  // has, or a throwing has reads as "not in the set".
  function isInSet(set, id) {
    try {
      return !!set && typeof set.has === 'function' && set.has(id);
    } catch (e) { return false; }
  }

  // The module's own module-presence checks, each guarded so a missing
  // or throwing subsystem degrades instead of breaking the frame.
  function isHudObject(obj, ui) {
    try {
      return !!(ui && typeof ui.isHudObject === 'function' && ui.isHudObject(obj));
    } catch (e) { return false; }
  }
  function isLight3dKind(obj, threeD) {
    try {
      return !!(threeD && typeof threeD.isLight3d === 'function' && threeD.isLight3d(obj.kind));
    } catch (e) { return false; }
  }
  function isLight2dKind(obj, light2d) {
    try {
      return !!(light2d && typeof light2d.isLight2d === 'function' && light2d.isLight2d(obj.kind));
    } catch (e) { return false; }
  }
  function is3dKind(obj, threeD) {
    try {
      return !!(threeD && typeof threeD.is3dKind === 'function' && threeD.is3dKind(obj.kind));
    } catch (e) { return false; }
  }
  function isScreenFixed(obj, ui) {
    try {
      if (ui && typeof ui.isScreenFixed === 'function') return ui.isScreenFixed(obj);
    } catch (e) { /* fall through to the pinned flag */ }
    return obj.uiPinned === true;
  }
  // Screen-space top-left of an object. Anchored objects resolve
  // against the canvas (viewport); anything else returns the world
  // position and the caller applies the camera transform unless the
  // object is screen-fixed.
  function widgetScreenPos(obj, width, height, ui) {
    try {
      if (ui && typeof ui.isAnchored === 'function' && ui.isAnchored(obj) &&
          typeof ui.resolveWidgetPosition === 'function') {
        return ui.resolveWidgetPosition(obj, width, height);
      }
    } catch (e) { /* fall through to the world position */ }
    return { x: obj.posX || 0, y: obj.posY || 0 };
  }

  function roundedRectPath(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r || 0, w / 2, h / 2));
    ctx.beginPath();
    if (r <= 0) { ctx.rect(x, y, w, h); return; }
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function strokeWidgetBorder(ctx, obj) {
    var bw = Number(obj.borderWidth) || 0;
    if (bw > 0 && obj.borderColor) {
      ctx.lineWidth = bw;
      ctx.strokeStyle = obj.borderColor;
      ctx.stroke();
    }
  }

  // Visual flip + scale factors applied about the object's center in
  // every draw path. Drawing-only: collision keeps using width/height.
  function drawScaleOf(obj) {
    var sx = Number(obj.scaleX), sy = Number(obj.scaleY);
    return [(obj.flipH ? -1 : 1) * (Number.isFinite(sx) ? sx : 1),
            (obj.flipV ? -1 : 1) * (Number.isFinite(sy) ? sy : 1)];
  }
  function applyDrawTransform(ctx, obj, cx, cy) {
    var s = drawScaleOf(obj);
    if (s[0] !== 1 || s[1] !== 1) {
      ctx.translate(cx, cy);
      ctx.scale(s[0], s[1]);
      ctx.translate(-cx, -cy);
    }
  }

  // Fit an image inside the object's box, centered on the origin (the
  // caller translates to the object center first). 'stretch' fills the
  // box exactly; 'contain' letterboxes; anything else covers.
  function drawFitted(ctx, img, obj) {
    if (obj.assetFit === 'stretch') { ctx.drawImage(img, -obj.width / 2, -obj.height / 2, obj.width, obj.height); return; }
    var imageRatio = img.naturalWidth / img.naturalHeight;
    var boxRatio = obj.width / obj.height;
    var w = obj.width, h = obj.height;
    if (obj.assetFit === 'contain' ? imageRatio > boxRatio : imageRatio < boxRatio) h = w / imageRatio;
    else w = h * imageRatio;
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
  }

  // Tilemaps draw through the shared HydraTiles renderer with camera
  // culling. No tiles module means nothing draws (the preview's guard).
  function drawTilemapObject(ctx, view, hooks, obj, cam) {
    if (!hooks.tiles || typeof hooks.tiles.drawTilemap !== 'function') return;
    var img = null;
    try { img = obj.tilesetAssetId ? hooks.image(obj.tilesetAssetId, false) : null; } catch (e) { img = null; }
    var z = normalizeCameraZoom(cam.zoom);
    ctx.save();
    if (z !== 1) ctx.scale(z, z);
    hooks.tiles.drawTilemap(ctx, obj, {
      image: img, camX: cam.x || 0, camY: cam.y || 0,
      viewW: view.width / z, viewH: view.height / z, showGrid: false
    });
    ctx.restore();
  }

  function drawPanelObject(ctx, view, hooks, obj, cam) {
    var fixed = isScreenFixed(obj, hooks.ui);
    var sp = widgetScreenPos(obj, view.width, view.height, hooks.ui);
    // Zoom scales world panels about the screen origin; screen-fixed
    // widgets skip it.
    var cz = fixed ? 1 : normalizeCameraZoom(cam.zoom);
    var w = Math.max(1, obj.width || 1), h = Math.max(1, obj.height || 1);
    var r = Number(obj.cornerRadius);
    if (!isFinite(r) || r < 0) r = 12;
    ctx.save();
    // Blend mode, shadow, and filter from the Set Blend Mode / Set
    // Shadow / Set Visual Effect blocks. ctx.save()/restore() resets
    // them, so the common no-effect case adds almost nothing.
    if (hooks.layerFx && typeof hooks.layerFx.applyObjectEffects === 'function') {
      hooks.layerFx.applyObjectEffects(ctx, obj);
    }
    if (cz !== 1) ctx.scale(cz, cz);
    if (!fixed) ctx.translate(-cam.x, -cam.y);
    ctx.globalAlpha = obj.opacity ?? 1;
    // Flip/scale about the panel center.
    applyDrawTransform(ctx, obj, sp.x + w / 2, sp.y + h / 2);
    roundedRectPath(ctx, sp.x, sp.y, w, h, r);
    ctx.fillStyle = obj.color || '#1e293b';
    ctx.fill();
    strokeWidgetBorder(ctx, obj);
    ctx.restore();
  }

  function drawTextObject(ctx, view, hooks, obj, cam) {
    var fixed = isScreenFixed(obj, hooks.ui);
    var sp = widgetScreenPos(obj, view.width, view.height, hooks.ui);
    // Zoom scales world text about the screen origin; screen-fixed
    // widgets skip it.
    var cz = fixed ? 1 : normalizeCameraZoom(cam.zoom);
    var text = obj._runtimeText !== undefined ? obj._runtimeText : (obj.text || '');
    ctx.save();
    // Blend mode, shadow, and filter from the Set Blend Mode / Set
    // Shadow / Set Visual Effect blocks. save()/restore() resets them.
    if (hooks.layerFx && typeof hooks.layerFx.applyObjectEffects === 'function') {
      hooks.layerFx.applyObjectEffects(ctx, obj);
    }
    if (cz !== 1) ctx.scale(cz, cz);
    if (!fixed) ctx.translate(-cam.x, -cam.y);
    ctx.globalAlpha = obj.opacity ?? 1;
    ctx.font = (obj.italic ? 'italic ' : '') + (obj.bold ? 'bold ' : '') +
      (obj.fontSize || 24) + 'px ' + (obj.fontFamily || 'sans-serif');
    ctx.textBaseline = 'top';
    ctx.textAlign = obj.textAlign || 'left';
    ctx.fillStyle = obj.textColor || '#111827';
    // The text box: the authored width, or the measured text width
    // when the object has none (a context without measureText reads
    // as 0, exactly the export's old width of 1).
    var measured = 0;
    try {
      if (typeof ctx.measureText === 'function') {
        var m = ctx.measureText(text);
        measured = (m && m.width) || 0;
      }
    } catch (e) { measured = 0; }
    var boxW = Math.max(1, obj.width || measured || 1);
    var boxH = Math.max(1, obj.height || obj.fontSize || 24);
    // Flip/scale about the text box center, before the button
    // background, so backgrounds scale with their labels.
    applyDrawTransform(ctx, obj, sp.x + boxW / 2, sp.y + boxH / 2);
    // Buttons draw their state-colored background behind the label.
    // The state comes from the host: the export computes it live from
    // the mouse, the preview reads the per-frame _uiState.
    var isButton = false;
    try {
      isButton = !!(hooks.ui && typeof hooks.ui.isButton === 'function' && hooks.ui.isButton(obj));
    } catch (e) { isButton = false; }
    if (isButton) {
      var bsx = fixed ? sp.x : (sp.x - cam.x) * cz;
      var bsy = fixed ? sp.y : (sp.y - cam.y) * cz;
      var bstate = 'normal';
      try {
        if (typeof hooks.buttonState === 'function') bstate = hooks.buttonState(obj, bsx, bsy, cz) || 'normal';
      } catch (e) { bstate = 'normal'; }
      var bf = null;
      try { bf = hooks.ui.buttonFillFor(obj, bstate); } catch (e) { bf = null; }
      if (bf) {
        roundedRectPath(ctx, sp.x, sp.y, Math.max(1, obj.width || 1), Math.max(1, obj.height || 1), bf.radius);
        ctx.fillStyle = bf.fill;
        ctx.fill();
        strokeWidgetBorder(ctx, obj);
      }
    }
    var align = obj.textAlign || 'left';
    var textX = align === 'center' ? boxW / 2 : align === 'right' ? boxW : 0;
    // Buttons center their label vertically in the button; plain text
    // stays top-aligned.
    var rot = obj.rotation || 0;
    if (isButton) ctx.textBaseline = 'middle';
    // The button background above overwrote fillStyle with the button
    // fill; reset it to the label color before drawing the text, or
    // the label renders in the button's own color and is invisible.
    ctx.fillStyle = obj.textColor || '#111827';
    if (rot !== 0) {
      ctx.translate(sp.x + boxW / 2, sp.y + boxH / 2);
      ctx.rotate((rot * Math.PI) / 180);
      ctx.translate(-boxW / 2, -boxH / 2);
      ctx.fillText(text, textX, isButton ? boxH / 2 : 0);
    } else {
      ctx.fillText(text, sp.x + textX, isButton ? sp.y + boxH / 2 : sp.y);
    }
    ctx.restore();
  }

  function drawSpriteObject(ctx, view, hooks, obj, cam) {
    var fixed = isScreenFixed(obj, hooks.ui);
    var sp = widgetScreenPos(obj, view.width, view.height, hooks.ui);
    // Zoom scales world objects about the screen origin; screen-fixed
    // widgets skip it.
    var cz = fixed ? 1 : normalizeCameraZoom(cam.zoom);
    // Sprite animations: an active blend space's frames win over the
    // playing animation's current frame; a missing/deleted frame asset
    // falls back to the static sprite image.
    var blendFrames = null;
    try {
      if (hooks.blendSpace && typeof hooks.blendSpace.blendFrameList === 'function') {
        blendFrames = hooks.blendSpace.blendFrameList(obj._blends, obj, function (animName) {
          var a = null;
          try { a = hooks.anim ? hooks.anim.getAnimation(obj, animName) : null; } catch (e) { a = null; }
          return a ? a.frames : [];
        });
      }
    } catch (e) { blendFrames = null; }
    var frameAssetId;
    try { frameAssetId = hooks.anim ? hooks.anim.currentFrameAssetId(obj._anim, obj) : undefined; } catch (e) { frameAssetId = undefined; }
    var blendFrame2 = null;
    if (blendFrames && blendFrames.length > 0) {
      frameAssetId = blendFrames[0].assetId;
      if (blendFrames.length > 1) blendFrame2 = blendFrames[1];
    }
    var img = null;
    if (typeof hooks.image === 'function') {
      try { img = frameAssetId ? hooks.image(frameAssetId, false) : null; } catch (e) { img = null; }
      if (!img) {
        try { img = hooks.image(obj.assetId, false); } catch (e) { img = null; }
      }
    }
    ctx.save();
    ctx.globalAlpha = obj.opacity ?? 1;
    // Blend mode, shadow, and filter from the Set Blend Mode / Set
    // Shadow / Set Visual Effect blocks. save()/restore() resets them.
    if (hooks.layerFx && typeof hooks.layerFx.applyObjectEffects === 'function') {
      hooks.layerFx.applyObjectEffects(ctx, obj);
    }
    if (cz !== 1) ctx.scale(cz, cz);
    ctx.translate(sp.x - (fixed ? 0 : cam.x) + obj.width / 2, sp.y - (fixed ? 0 : cam.y) + obj.height / 2);
    if (obj.rotation) ctx.rotate(obj.rotation * Math.PI / 180);
    // Flip/scale about the object center.
    applyDrawTransform(ctx, obj, 0, 0);
    // Skeletal animation: bones draw over the sprite (or instead of it
    // with Hide sprite) — inside the sprite transform, so rotation,
    // flip, scale, camera, and zoom all apply to the rig.
    var skel = null;
    try { skel = hooks.skeleton ? hooks.skeleton.normalizeSkeleton(obj) : null; } catch (e) { skel = null; }
    if (!skel || !skel.hideSprite) {
      if (img && img.complete && img.naturalWidth > 0) {
        drawFitted(ctx, img, obj);
        // The runner-up blend frame draws at partial alpha over the
        // winner — the crossfade.
        if (blendFrame2 && blendFrame2.alpha > 0.001) {
          var img2 = null;
          try { img2 = (blendFrame2.assetId && typeof hooks.image === 'function') ? hooks.image(blendFrame2.assetId, false) : null; } catch (e) { img2 = null; }
          if (img2 && img2.complete && img2.naturalWidth > 0) {
            var keepAlpha = ctx.globalAlpha;
            ctx.globalAlpha = keepAlpha * blendFrame2.alpha;
            drawFitted(ctx, img2, obj);
            ctx.globalAlpha = keepAlpha;
          }
        }
      } else {
        ctx.fillStyle = obj.color || '#888888';
        ctx.fillRect(-obj.width / 2, -obj.height / 2, obj.width, obj.height);
      }
    }
    if (skel && skel.bones.length > 0) {
      try {
        hooks.skeleton.drawSkeleton(ctx,
          hooks.skeleton.boneSegmentsLocal(obj, hooks.skeleton.currentBoneAngles(obj._skel, obj)),
          function (id) {
            var im = null;
            try { im = (id && typeof hooks.image === 'function') ? hooks.image(id, false) : null; } catch (e) { im = null; }
            return im;
          });
      } catch (e) { /* a bad rig never breaks the frame */ }
    }
    ctx.restore();
    // Preview-only name label (obj.showLabel), drawn after the sprite
    // restore in its own pass; the export passes no drawLabel hook.
    if (typeof hooks.drawLabel === 'function') {
      try {
        hooks.drawLabel(ctx, obj, {
          cx: sp.x + obj.width / 2, cy: sp.y + obj.height / 2,
          camX: cam.x, camY: cam.y, zoom: cz, fixed: fixed
        });
      } catch (e) { /* a bad label never breaks the frame */ }
    }
  }

  function drawObject(ctx, view, hooks, obj, cam) {
    if (!obj || typeof obj !== 'object') return false;
    // Parallax (P4 Advanced batch 16): a non-fixed object draws against
    // its parallax camera — the live camera scaled by the object's
    // factors — so background layers scroll slower than the world.
    // Screen-fixed objects skip the camera entirely, so the factor never
    // applies to them; a missing module draws at world speed. Every
    // per-kind draw below takes the camera it is given, so one
    // substitution here covers sprites, text, panels, and tilemaps —
    // including the button hover math, which reads the same camera.
    var effCam = cam;
    if (hooks.parallax && typeof hooks.parallax.parallaxCamera === 'function' &&
        !isScreenFixed(obj, hooks.ui)) {
      try { effCam = hooks.parallax.parallaxCamera(cam, obj) || cam; } catch (e) { effCam = cam; }
    }
    var isPanel = false;
    try {
      isPanel = !!(hooks.ui && typeof hooks.ui.isPanel === 'function' && hooks.ui.isPanel(obj));
    } catch (e) { isPanel = false; }
    if (obj.kind === 'text') { drawTextObject(ctx, view, hooks, obj, effCam); }
    else if (isPanel) { drawPanelObject(ctx, view, hooks, obj, effCam); }
    else if (obj.kind === 'tilemap') { drawTilemapObject(ctx, view, hooks, obj, effCam); }
    else { drawSpriteObject(ctx, view, hooks, obj, effCam); }
    // P4 Advanced batch 21 (health & damage): the health bar draws
    // above the object when it asks for one — after the per-kind draw,
    // so the bar sits on top of the sprite, and in the same
    // screen-space convention as the preview's name label (center,
    // camera, zoom, screen-fixed flag), so the bar follows the camera,
    // the zoom, and the object's parallax camera exactly like the
    // sprite it belongs to. A missing module draws nothing; a bad bar
    // never breaks the frame.
    if (obj.showHealthBar && hooks.health && typeof hooks.health.drawHealthBar === 'function') {
      try {
        var fixedHb = isScreenFixed(obj, hooks.ui);
        var spHb = widgetScreenPos(obj, view.width, view.height, hooks.ui);
        var czHb = fixedHb ? 1 : normalizeCameraZoom(effCam.zoom);
        hooks.health.drawHealthBar(ctx, obj, {
          cx: spHb.x + obj.width / 2, cy: spHb.y + obj.height / 2,
          camX: effCam.x, camY: effCam.y, zoom: czHb, fixed: fixedHb
        });
      } catch (e) { /* a bad bar never breaks the frame */ }
    }
    return true;
  }

  // One full frame, in the export's order. Returns
  // { draws2d, tris3d, camera, camera3d } (camera is the shaken render
  // camera; camera3d is the normalized 3D camera, or null), or false
  // when the context or the view is not an object. Never throws.
  function drawFrame(ctx, view, hooks) {
    if (!ctx || typeof ctx !== 'object') return false;
    if (!view || typeof view !== 'object') return false;
    var h = hooks || {};
    var scene = (view.scene && typeof view.scene === 'object') ? view.scene : {};
    var objects = Array.isArray(view.objects) ? view.objects : [];
    var width = Number(view.width) || 0;
    var height = Number(view.height) || 0;
    var cam = shakenCamera(view.camera, view.shake, h.cameraFx);
    var z = normalizeCameraZoom(cam.zoom);
    var draws2d = 0, tris3d = 0, camera3d = null;
    var hidden = view.hidden, destroyed = view.destroyed;

    // Background: the scene image at the world size, or the bg color.
    // worldWidth wins; width is the preview's synced alias; the canvas
    // size is the last resort for an unnormalized scene.
    var bgW = Number(scene.worldWidth || scene.width) || width;
    var bgH = Number(scene.worldHeight || scene.height) || height;
    try {
      ctx.clearRect(0, 0, width, height);
      var bg = null;
      try { bg = (typeof h.image === 'function') ? h.image(scene.bgAssetId, true) : null; } catch (e) { bg = null; }
      if (bg && bg.complete) {
        ctx.save();
        if (z !== 1) ctx.scale(z, z);
        ctx.drawImage(bg, -cam.x, -cam.y, bgW, bgH);
        ctx.restore();
      } else {
        ctx.fillStyle = scene.bgColor || '#ffffff';
        ctx.fillRect(0, 0, width, height);
      }
    } catch (e) { /* the background never breaks the frame */ }

    // 3D scenes render the 3D objects through the shared Hydra3d
    // projector. 2D objects in a 3D scene keep drawing as a flat
    // overlay below; HUD last.
    var is3dScene = false;
    try {
      is3dScene = !!(h.threeD && scene.renderMode === '3d');
      if (is3dScene) {
        try { camera3d = h.threeD.normalizeCamera3d(view.camera3d, scene); } catch (e) { camera3d = null; }
        if (camera3d) {
          var meshFor = (typeof h.modelMesh === 'function') ? h.modelMesh : null;
          var list3d = objects.filter(function (o) {
            return o && !isInSet(destroyed, o.id) && !isInSet(hidden, o.id) &&
              (is3dKind(o, h.threeD) || isLight3dKind(o, h.threeD));
          });
          try {
            tris3d = h.threeD.renderScene(ctx,
              { camera3d: camera3d, worldWidth: scene.worldWidth, worldHeight: scene.worldHeight, shadows3d: scene.shadows3d === true, shadowGroundY: scene.shadowGroundY },
              list3d, width, height, meshFor) || 0;
          } catch (e) { tris3d = 0; }
        }
      }
    } catch (e) { is3dScene = false; }

    // World pass: live objects sorted by layer. Lights never draw as
    // 2D sprites (any scene mode); 3D kinds in a 3D scene already drew
    // in the 3D pass above.
    var sorted = objects.slice().sort(function (a, b) {
      return (((a && a.layer) || 0) - ((b && b.layer) || 0));
    });
    sorted.forEach(function (obj) {
      if (!obj || typeof obj !== 'object') return;
      if (isInSet(destroyed, obj.id) || isInSet(hidden, obj.id)) return;
      if (isHudObject(obj, h.ui)) return;
      if (isLight3dKind(obj, h.threeD)) return;
      if (isLight2dKind(obj, h.light2d)) return;
      if (is3dScene && is3dKind(obj, h.threeD)) return;
      try { if (drawObject(ctx, view, h, obj, cam)) draws2d++; } catch (e) { /* one bad object never breaks the frame */ }
    });

    // Particles: world-space effects draw above the world, below the
    // HUD. The cull window widens with zoom so a zoomed-out view keeps
    // edges.
    if (h.particles && view.particles) {
      try {
        ctx.save();
        if (z !== 1) ctx.scale(z, z);
        h.particles.draw(ctx, view.particles, cam.x, cam.y, width / z, height / z);
        ctx.restore();
      } catch (e) {
        try { ctx.restore(); } catch (e2) { /* the particle pass never breaks the frame */ }
      }
    }

    // Damage numbers: world-space floating hit numbers draw above the
    // world and the particles, below the HUD — a number reads on top
    // of the burst that caused it. Same zoom-scaled pass as particles.
    if (h.damageFx && view.damageNumbers) {
      try {
        ctx.save();
        if (z !== 1) ctx.scale(z, z);
        h.damageFx.drawDamageNumbers(ctx, view.damageNumbers, cam.x, cam.y, width / z, height / z);
        ctx.restore();
      } catch (e) {
        try { ctx.restore(); } catch (e2) { /* the number pass never breaks the frame */ }
      }
    }

    // Combat slash arcs: the melee swing draws above the world and the
    // damage numbers, below the HUD — a swing reads on top of the hit
    // it caused. Same zoom-scaled pass as the numbers; the arc carries
    // its own time left, so the pass needs no game clock.
    if (h.combat && view.combat) {
      try {
        ctx.save();
        if (z !== 1) ctx.scale(z, z);
        h.combat.drawCombatEffects(ctx, view.combat, cam.x, cam.y);
        ctx.restore();
      } catch (e) {
        try { ctx.restore(); } catch (e2) { /* the slash pass never breaks the frame */ }
      }
    }

    // 2D lighting: the darkness overlay draws above the world and
    // particles, below the HUD — menus stay readable in the dark.
    // 2D scenes only; darkness 0 skips the pass entirely.
    if (!is3dScene && h.light2d) {
      try {
        h.light2d.normalizeSceneDarkness(scene);
        if (scene.darkness > 0) {
          var dc = null;
          try { dc = (typeof h.getDarkCanvas === 'function') ? h.getDarkCanvas() : null; } catch (e) { dc = null; }
          if (dc) {
            var lightObjs = objects.filter(function (o) {
              return o && !isInSet(destroyed, o.id) && !isInSet(hidden, o.id) && !isHudObject(o, h.ui);
            });
            var lights = h.light2d.collectLights2d(lightObjs);
            var boxes = h.light2d.occluderBoxes(lightObjs.filter(function (o) {
              return !isLight2dKind(o, h.light2d) && !isLight3dKind(o, h.threeD);
            }));
            var screenLights = h.light2d.projectLights(lights, boxes, cam.x, cam.y, z);
            h.light2d.drawDarkness(ctx, {
              width: width, height: height,
              darkness: scene.darkness, color: scene.darknessColor,
              darkCanvas: dc, lights: screenLights
            });
          }
        }
      } catch (e) { /* the darkness overlay must never break the frame */ }
    }

    // HUD layer: HUD objects draw last, on top of everything,
    // camera-independent.
    sorted.forEach(function (obj) {
      if (!obj || typeof obj !== 'object') return;
      if (isInSet(destroyed, obj.id) || isInSet(hidden, obj.id)) return;
      if (!isHudObject(obj, h.ui)) return;
      try { if (drawObject(ctx, view, h, obj, cam)) draws2d++; } catch (e) { /* one bad object never breaks the frame */ }
    });

    // P4 Advanced batch 33 (boss encounters): the boss bar draws
    // above the HUD, below the screen flash — a wide centered bar
    // with the boss's name, so the fight reads at a glance. It shows
    // only while a fight is active, the bar is on, and a live object
    // with the boss's name exists (a boss that has not spawned yet
    // shows no bar). The fraction comes from the health module when
    // the host wired it, else the raw health fields — the same rule
    // the boss module's own fractionOf uses.
    try {
      var bossMod = h.boss;
      var bossState = h.bossState;
      if (bossMod && typeof bossMod.isActive === 'function' && typeof bossMod.drawBossBar === 'function' &&
          bossState && bossMod.isActive(bossState) && bossState.barVisible === true) {
        var bossObj = null;
        if (typeof h.bossObject === 'function') {
          try { bossObj = h.bossObject(bossState.objectName) || null; } catch (e) { bossObj = null; }
        }
        if (bossObj) {
          var bossFrac = null;
          if (typeof bossMod.fractionOf === 'function') {
            try { bossFrac = bossMod.fractionOf(bossObj, h.health || null); } catch (e) { bossFrac = null; }
          }
          if (bossFrac != null) {
            try { bossMod.drawBossBar(ctx, bossState.objectName, bossFrac, width, height); } catch (e) { /* the bar never breaks the frame */ }
          }
        }
      }
    } catch (e) { /* the boss bar never breaks the frame */ }

    // P4 Advanced batch 36 (minimap): the small live map in a screen
    // corner, with a dot for every live world object and a white
    // rectangle for what the camera sees. It draws above the HUD,
    // below the screen flash. It shows only while the scene's run
    // record says visible — the module reads the same record the
    // Show / Hide Minimap blocks write. Hidden, destroyed, HUD, and
    // light objects never get a dot; the boss object draws red while
    // a fight runs, through the boss state the boss bar already
    // reads.
    try {
      var mmMod = h.minimap;
      var mmState = h.minimapState;
      if (mmMod && typeof mmMod.isVisible === 'function' && typeof mmMod.drawMinimap === 'function' &&
          mmState && mmMod.isVisible(mmState)) {
        var mmBossName = '';
        try {
          if (h.boss && typeof h.boss.isActive === 'function' && h.bossState &&
              h.boss.isActive(h.bossState) && typeof h.bossState.objectName === 'string') {
            mmBossName = h.bossState.objectName;
          }
        } catch (e) { mmBossName = ''; }
        var mmDots = sorted.filter(function (o) {
          return o && typeof o === 'object' &&
            !isInSet(destroyed, o.id) && !isInSet(hidden, o.id) &&
            !isHudObject(o, h.ui) &&
            !isLight3dKind(o, h.threeD) && !isLight2dKind(o, h.light2d);
        });
        try {
          mmMod.drawMinimap(ctx, {
            state: mmState,
            worldW: bgW, worldH: bgH,
            camX: cam.x, camY: cam.y,
            viewW: z !== 0 ? width / z : width,
            viewH: z !== 0 ? height / z : height,
            viewPxW: width, viewPxH: height,
            objects: mmDots,
            bossName: mmBossName
          });
        } catch (e) { /* the map never breaks the frame */ }
      }
    } catch (e) { /* the map never breaks the frame */ }

    // Screen Flash: the color wash draws above the HUD, below the
    // profiler overlay, fading linearly from full intensity to
    // transparent. The fade alpha lives in HydraCameraFx.
    var flashAlpha = 0;
    try { flashAlpha = h.cameraFx ? h.cameraFx.flashAlpha(view.flash) : 0; } catch (e) { flashAlpha = 0; }
    if (typeof flashAlpha !== 'number' || !isFinite(flashAlpha)) flashAlpha = 0;
    if (flashAlpha > 0) {
      try {
        ctx.save();
        ctx.globalAlpha = flashAlpha;
        ctx.fillStyle = (view.flash && view.flash.color) || '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
      } catch (e) {
        try { ctx.restore(); } catch (e2) { /* the flash never breaks the frame */ }
      }
    }

    // Profiling overlay: report this frame's render counts, then paint
    // the overlay last so it sits on top of everything else.
    var liveParticles = (view.particles && Array.isArray(view.particles.particles))
      ? view.particles.particles.length : 0;
    var liveObjects = objects.filter(function (o) {
      return o && !isInSet(destroyed, o.id);
    }).length;
    if (h.profile && view.profiler) {
      try {
        h.profile.noteDraws(view.profiler, draws2d, tris3d, liveParticles, liveObjects);
        h.profile.drawOverlay(ctx, view.profiler, width, height);
      } catch (e) { /* the overlay never breaks the frame */ }
    }

    var result = { draws2d: draws2d, tris3d: tris3d, camera: cam, camera3d: camera3d };
    // Preview-only DOM sync (Profiler / Trace toolbar buttons and the
    // Trace panel); the export passes no onFrameEnd hook.
    if (typeof h.onFrameEnd === 'function') {
      try { h.onFrameEnd(result); } catch (e) { /* editor chrome never breaks the frame */ }
    }
    return result;
  }

  return {
    normalizeCameraZoom: normalizeCameraZoom,
    shakenCamera: shakenCamera,
    isScreenFixed: isScreenFixed,
    widgetScreenPos: widgetScreenPos,
    roundedRectPath: roundedRectPath,
    drawScaleOf: drawScaleOf,
    applyDrawTransform: applyDrawTransform,
    drawFitted: drawFitted,
    drawTilemapObject: drawTilemapObject,
    drawPanelObject: drawPanelObject,
    drawTextObject: drawTextObject,
    drawSpriteObject: drawSpriteObject,
    drawObject: drawObject,
    drawFrame: drawFrame
  };
}

window.HydraDraw = hydraDrawFactory();
// Self-contained source of the factory, inlined into exported playable games
// by HydraPlayer.buildPlayableHtml so exports run without editor files.
window.HydraDraw.factorySource = hydraDrawFactory.toString();
