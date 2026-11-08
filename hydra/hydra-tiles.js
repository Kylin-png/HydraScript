/* ============================================================================
 * hydra-tiles.js — HydraScript tilemaps (P4 item 31).
 *
 * Pure logic, no DOM access. Single canonical source for tilemap data and
 * tile collision used by the editor (script.js: scene-editor paint +
 * preview runtime) and the exported player runtime (player-runtime.js).
 * Exported games inline factorySource via HydraPlayer.buildPlayableHtml,
 * so exports never depend on editor files.
 *
 * A tilemap is an object of kind 'tilemap':
 *   tileSize      — pixel size of one square tile (default 32)
 *   cols, rows    — map size in tiles (default 10 x 10)
 *   tiles         — flat row-major array, cols*rows entries;
 *                   -1 = empty cell, 0..N = tile index into the tileset
 *   tilesetAssetId— image asset id, or null (then tiles draw as colors)
 *   tilesetCols   — tiles per row in the tileset image (default 8)
 *   solidTiles    — tile indexes that collide (default [0])
 *
 * The tileset image is sliced on a grid of tileSize x tileSize, so tile N
 * lives at ((N % tilesetCols) * tileSize, floor(N / tilesetCols) * tileSize).
 *
 * Load order (index.html): hydra-tiles.js BEFORE player-runtime.js and
 * script.js. player-runtime.js throws a clear error if HydraTiles is
 * missing.
 * ========================================================================== */

function hydraTilesFactory() {
  'use strict';

  var DEFAULT_TILE_SIZE = 32;
  var DEFAULT_COLS = 10;
  var DEFAULT_ROWS = 10;
  var MAX_COLS = 200;
  var MAX_ROWS = 200;
  // Characters for the "edit as text" inspector: 0-9 then a-z, then a few
  // classic map symbols (#@$%&); '.' or space means empty.
  var CHARSET = '0123456789abcdefghijklmnopqrstuvwxyz#@$%&';

  function clampInt(v, lo, hi, dflt) {
    var n = Math.floor(Number(v));
    if (!isFinite(n)) return dflt;
    if (n < lo) return lo;
    if (n > hi) return hi;
    return n;
  }

  function cleanTileIndex(v) {
    if (v == null) return -1; // missing data = empty cell, never tile 0
    var n = Math.floor(Number(v));
    if (!isFinite(n) || n < 0) return -1;
    return n;
  }

  // Repair a raw tilemap object (or a bare spec) into a clean spec.
  // Never throws; corrupt fields are repaired to defaults so old or
  // hand-edited project JSON cannot crash the editor or an export.
  // Returns a FRESH spec object (does not mutate the input).
  function normalizeTilemap(raw) {
    var t = (raw && typeof raw === 'object') ? raw : {};
    var tileSize = clampInt(t.tileSize, 8, 256, DEFAULT_TILE_SIZE);
    var cols = clampInt(t.cols, 1, MAX_COLS, DEFAULT_COLS);
    var rows = clampInt(t.rows, 1, MAX_ROWS, DEFAULT_ROWS);
    var tiles = new Array(cols * rows);
    var i;
    for (i = 0; i < tiles.length; i++) tiles[i] = -1;
    if (Array.isArray(t.tiles)) {
      var n = Math.min(t.tiles.length, tiles.length);
      for (i = 0; i < n; i++) tiles[i] = cleanTileIndex(t.tiles[i]);
    }
    var tilesetCols = clampInt(t.tilesetCols, 1, 64, 8);
    var solid = [];
    if (Array.isArray(t.solidTiles)) {
      t.solidTiles.forEach(function (s) {
        var v = Math.floor(Number(s));
        if (isFinite(v) && v >= 0 && solid.indexOf(v) === -1) solid.push(v);
      });
      solid.sort(function (a, b) { return a - b; });
    } else {
      solid = [0]; // default: tile 0 is solid ground
    }
    var tilesetAssetId = (typeof t.tilesetAssetId === 'string' && t.tilesetAssetId) ? t.tilesetAssetId : null;
    return {
      tileSize: tileSize,
      cols: cols,
      rows: rows,
      tiles: tiles,
      tilesetAssetId: tilesetAssetId,
      tilesetCols: tilesetCols,
      solidTiles: solid
    };
  }

  // Write a normalized spec's fields back onto a project object in place
  // (keeps width/height in sync with cols/rows * tileSize).
  function applyToObject(obj, spec) {
    if (!obj || typeof obj !== 'object') return obj;
    var s = spec || normalizeTilemap(obj);
    obj.tileSize = s.tileSize;
    obj.cols = s.cols;
    obj.rows = s.rows;
    obj.tiles = s.tiles;
    obj.tilesetAssetId = s.tilesetAssetId;
    obj.tilesetCols = s.tilesetCols;
    obj.solidTiles = s.solidTiles;
    syncSize(obj);
    return obj;
  }

  function syncSize(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    var ts = clampInt(obj.tileSize, 8, 256, DEFAULT_TILE_SIZE);
    var cols = clampInt(obj.cols, 1, MAX_COLS, DEFAULT_COLS);
    var rows = clampInt(obj.rows, 1, MAX_ROWS, DEFAULT_ROWS);
    obj.width = cols * ts;
    obj.height = rows * ts;
    return obj;
  }

  function dims(tm) {
    var t = tm || {};
    return {
      tileSize: clampInt(t.tileSize, 8, 256, DEFAULT_TILE_SIZE),
      cols: clampInt(t.cols, 1, MAX_COLS, DEFAULT_COLS),
      rows: clampInt(t.rows, 1, MAX_ROWS, DEFAULT_ROWS),
      tilesetCols: clampInt(t.tilesetCols, 1, 64, 8),
      posX: Number(t.posX) || 0,
      posY: Number(t.posY) || 0
    };
  }

  function tilesArray(tm) {
    return (tm && Array.isArray(tm.tiles)) ? tm.tiles : [];
  }

  function tileIndexAt(tm, col, row) {
    var d = dims(tm);
    if (col < 0 || row < 0 || col >= d.cols || row >= d.rows) return -1;
    var tiles = tilesArray(tm);
    var v = cleanTileIndex(tiles[row * d.cols + col]);
    return v;
  }

  // Paint one cell. index < 0 clears the cell. Out-of-bounds writes are
  // ignored. Returns true when the map changed.
  function setTile(tm, col, row, index) {
    if (!tm || typeof tm !== 'object') return false;
    var d = dims(tm);
    col = Math.floor(Number(col)); row = Math.floor(Number(row));
    if (!isFinite(col) || !isFinite(row)) return false;
    if (col < 0 || row < 0 || col >= d.cols || row >= d.rows) return false;
    var tiles = tilesArray(tm);
    if (!Array.isArray(tm.tiles) || tm.tiles.length < d.cols * d.rows) {
      var fresh = new Array(d.cols * d.rows);
      for (var i = 0; i < fresh.length; i++) fresh[i] = cleanTileIndex(tiles[i]);
      tm.tiles = fresh;
      tiles = fresh;
    }
    var v = cleanTileIndex(index);
    var at = row * d.cols + col;
    if (tiles[at] === v) return false;
    tiles[at] = v;
    return true;
  }

  // Resize the map, keeping whatever tile data still fits.
  function resize(tm, cols, rows) {
    if (!tm || typeof tm !== 'object') return tm;
    var d = dims(tm);
    var nc = clampInt(cols, 1, MAX_COLS, d.cols);
    var nr = clampInt(rows, 1, MAX_ROWS, d.rows);
    if (nc === d.cols && nr === d.rows && Array.isArray(tm.tiles) && tm.tiles.length === nc * nr) return tm;
    var old = tilesArray(tm);
    var fresh = new Array(nc * nr);
    var r, c;
    for (r = 0; r < nr; r++) {
      for (c = 0; c < nc; c++) {
        fresh[r * nc + c] = (r < d.rows && c < d.cols) ? cleanTileIndex(old[r * d.cols + c]) : -1;
      }
    }
    tm.cols = nc; tm.rows = nr; tm.tiles = fresh;
    syncSize(tm);
    return tm;
  }

  // World pixel -> tile cell (may be out of range; use tileIndexAt for -1).
  function worldToCell(tm, x, y) {
    var d = dims(tm);
    return {
      col: Math.floor((Number(x) - d.posX) / d.tileSize),
      row: Math.floor((Number(y) - d.posY) / d.tileSize)
    };
  }

  function tileAtPixel(tm, x, y) {
    var cell = worldToCell(tm, x, y);
    return tileIndexAt(tm, cell.col, cell.row);
  }

  function solidTilesOf(tm) {
    if (tm && Array.isArray(tm.solidTiles)) {
      var out = [];
      tm.solidTiles.forEach(function (s) {
        var v = Math.floor(Number(s));
        if (isFinite(v) && v >= 0 && out.indexOf(v) === -1) out.push(v);
      });
      return out;
    }
    return [0];
  }

  function isSolidTile(tm, index) {
    var v = Math.floor(Number(index));
    if (!isFinite(v) || v < 0) return false;
    return solidTilesOf(tm).indexOf(v) !== -1;
  }

  function isSolidAtPixel(tm, x, y) {
    return isSolidTile(tm, tileAtPixel(tm, x, y));
  }

  // Source rect of a tile inside the tileset image. The tileset is sliced
  // on the same tileSize grid as the map.
  function tileSourceXY(index, tilesetCols, tileSize) {
    var tc = clampInt(tilesetCols, 1, 64, 8);
    var ts = clampInt(tileSize, 8, 256, DEFAULT_TILE_SIZE);
    var i = Math.max(0, Math.floor(Number(index)) || 0);
    return { sx: (i % tc) * ts, sy: Math.floor(i / tc) * ts };
  }

  // Which tile cells intersect the camera view (for draw culling).
  // Returns {c0, c1, r0, r1, empty}.
  function visibleTileRange(tm, camX, camY, viewW, viewH) {
    var d = dims(tm);
    var vx = Number(camX) || 0, vy = Number(camY) || 0;
    var vw = Number(viewW), vh = Number(viewH);
    if (!isFinite(vw) || vw <= 0) vw = d.cols * d.tileSize;
    if (!isFinite(vh) || vh <= 0) vh = d.rows * d.tileSize;
    var c0 = Math.max(0, Math.floor((vx - d.posX) / d.tileSize));
    var r0 = Math.max(0, Math.floor((vy - d.posY) / d.tileSize));
    var c1 = Math.min(d.cols - 1, Math.floor((vx + vw - d.posX) / d.tileSize));
    var r1 = Math.min(d.rows - 1, Math.floor((vy + vh - d.posY) / d.tileSize));
    return { c0: c0, c1: c1, r0: r0, r1: r1, empty: c1 < c0 || r1 < r0 };
  }

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  // Collide an AABB against the map's solid tiles, using the same
  // cross-from-side resolution the engine uses for object-vs-object
  // collisions (previous position decides the side; MTV fallback).
  //
  // box: {x, y, w|width, h|height, velX, velY, prevX, prevY}
  //   (x/y/w/h describe the hitbox; prevX/prevY its previous position)
  // Returns {x, y, velX, velY, collided, landed, hitHead}.
  // Pure: the input box is never mutated.
  function resolveTileCollision(tm, box) {
    var out = { x: 0, y: 0, velX: 0, velY: 0, collided: false, landed: false, hitHead: false };
    try {
      if (!tm || !box || typeof box !== 'object') return out;
      var d = dims(tm);
      var bw = Number(box.w != null ? box.w : box.width);
      var bh = Number(box.h != null ? box.h : box.height);
      if (!isFinite(bw) || !isFinite(bh) || bw <= 0 || bh <= 0) return out;
      var bx = Number(box.x) || 0, by = Number(box.y) || 0;
      var vx = Number(box.velX) || 0, vy = Number(box.velY) || 0;
      var px = (box.prevX != null && isFinite(Number(box.prevX))) ? Number(box.prevX) : bx;
      var py = (box.prevY != null && isFinite(Number(box.prevY))) ? Number(box.prevY) : by;
      var solid = solidTilesOf(tm);
      if (!solid.length) return out;
      var ts = d.tileSize;
      var c0 = Math.max(0, Math.floor((bx - d.posX) / ts));
      var r0 = Math.max(0, Math.floor((by - d.posY) / ts));
      var c1 = Math.min(d.cols - 1, Math.floor((bx + bw - d.posX) / ts));
      var r1 = Math.min(d.rows - 1, Math.floor((by + bh - d.posY) / ts));
      var tiles = tilesArray(tm);
      var collided = false, landed = false, hitHead = false;
      var r, c;
      for (r = r0; r <= r1; r++) {
        for (c = c0; c <= c1; c++) {
          var idx = cleanTileIndex(tiles[r * d.cols + c]);
          if (idx < 0 || solid.indexOf(idx) === -1) continue;
          var tx = d.posX + c * ts, ty = d.posY + r * ts;
          var boxR = { x: bx, y: by, w: bw, h: bh };
          var tileR = { x: tx, y: ty, w: ts, h: ts };
          if (!rectsOverlap(boxR, tileR)) continue;
          // MTV between box and tile (same math as the engine's overlap()).
          var cx = (bx + bw / 2) - (tx + ts / 2);
          var cy = (by + bh / 2) - (ty + ts / 2);
          var ox = (bw / 2 + ts / 2) - Math.abs(cx);
          var oy = (bh / 2 + ts / 2) - Math.abs(cy);
          if (ox <= 0 || oy <= 0) continue;
          var mtv = ox < oy ? { nx: cx > 0 ? 1 : -1, ny: 0, depth: ox }
                            : { nx: 0, ny: cy > 0 ? 1 : -1, depth: oy };
          var fromTop = py + bh <= ty && vy >= 0;
          var fromBottom = py >= ty + ts && vy <= 0;
          var fromLeft = px + bw <= tx && vx >= 0;
          var fromRight = px >= tx + ts && vx <= 0;
          if (fromTop) { by = ty - bh; vy = 0; landed = true; }
          else if (fromBottom) { by = ty + ts; vy = 0; hitHead = true; }
          else if (fromLeft) { bx = tx - bw; vx = 0; }
          else if (fromRight) { bx = tx + ts; vx = 0; }
          else {
            bx += mtv.nx * mtv.depth; by += mtv.ny * mtv.depth;
            if (mtv.nx !== 0) vx = 0; else vy = 0;
            if (mtv.ny < 0) landed = true;
            if (mtv.ny > 0) hitHead = true;
          }
          collided = true;
        }
      }
      out = { x: bx, y: by, velX: vx, velY: vy, collided: collided, landed: landed, hitHead: hitHead };
    } catch (e) { /* a hostile box never breaks the frame */ }
    return out;
  }

  // Draw the tilemap on a 2D context.
  // opts: {image (HTMLImageElement|null), camX, camY, viewW, viewH,
  //        showGrid (draw faint cell grid under empty cells),
  //        labelTiles (draw the tile index number on placeholder tiles)}
  // Tiles with no image draw as colored placeholders (hue by index).
  // Never throws: a hostile context or map degrades to nothing drawn.
  function drawTilemap(ctx, tm, opts) {
    try {
      if (!ctx || !tm) return;
      var o = opts || {};
      var d = dims(tm);
      var range = visibleTileRange(tm, o.camX || 0, o.camY || 0, o.viewW, o.viewH);
      if (range.empty) return;
      var ts = d.tileSize;
      var img = o.image || null;
      var imgOk = !!(img && img.complete && img.naturalWidth > 0);
      var tiles = tilesArray(tm);
      var camX = Number(o.camX) || 0, camY = Number(o.camY) || 0;
      var r, c;
      for (r = range.r0; r <= range.r1; r++) {
        for (c = range.c0; c <= range.c1; c++) {
          var idx = cleanTileIndex(tiles[r * d.cols + c]);
          var dx = d.posX + c * ts - camX;
          var dy = d.posY + r * ts - camY;
          if (idx < 0) {
            if (o.showGrid) {
              ctx.strokeStyle = 'rgba(100,116,139,0.35)';
              ctx.lineWidth = 1;
              ctx.strokeRect(dx + 0.5, dy + 0.5, ts - 1, ts - 1);
            }
            continue;
          }
          if (imgOk) {
            var s = tileSourceXY(idx, d.tilesetCols, ts);
            ctx.drawImage(img, s.sx, s.sy, ts, ts, dx, dy, ts, ts);
          } else {
            ctx.fillStyle = 'hsl(' + ((idx * 47) % 360) + ',60%,55%)';
            ctx.fillRect(dx, dy, ts, ts);
            if (o.labelTiles) {
              ctx.fillStyle = 'rgba(15,23,42,0.85)';
              ctx.font = Math.max(9, Math.floor(ts / 2.4)) + 'px sans-serif';
              ctx.textBaseline = 'top';
              ctx.fillText(String(idx), dx + 3, dy + 2);
            }
          }
        }
      }
    } catch (e) { /* drawing never breaks the game */ }
  }

  // --- ASCII map editing ("edit as text" in the inspector) ---
  // fromAscii(lines): lines = array of strings (or one \n-joined string).
  // Every char maps through CHARSET (case-insensitive); '.' or space (or
  // any unknown char) means empty. Returns {cols, rows, tiles}.
  function fromAscii(lines) {
    var arr = Array.isArray(lines) ? lines : String(lines == null ? '' : lines).split('\n');
    var rows = Math.min(Math.max(arr.length, 1), MAX_ROWS);
    var cols = 1;
    var r;
    for (r = 0; r < rows; r++) cols = Math.max(cols, String(arr[r] || '').length);
    cols = Math.min(cols, MAX_COLS);
    var tiles = new Array(cols * rows);
    for (r = 0; r < rows; r++) {
      var line = String(arr[r] || '');
      for (var c = 0; c < cols; c++) {
        var ch = line.charAt(c);
        var idx = (ch === '.' || ch === ' ') ? -1 : CHARSET.indexOf(ch.toLowerCase());
        tiles[r * cols + c] = idx;
      }
    }
    return { cols: cols, rows: rows, tiles: tiles };
  }

  // toAscii(tm): the inverse — '.' for empty, CHARSET char for known tiles,
  // '?' for higher indexes (they do not round-trip; noted in the guide).
  function toAscii(tm) {
    var d = dims(tm);
    var tiles = tilesArray(tm);
    var lines = [];
    for (var r = 0; r < d.rows; r++) {
      var line = '';
      for (var c = 0; c < d.cols; c++) {
        var idx = cleanTileIndex(tiles[r * d.cols + c]);
        line += idx < 0 ? '.' : (idx < CHARSET.length ? CHARSET.charAt(idx) : '?');
      }
      lines.push(line);
    }
    return lines;
  }

  return {
    DEFAULT_TILE_SIZE: DEFAULT_TILE_SIZE,
    MAX_COLS: MAX_COLS,
    MAX_ROWS: MAX_ROWS,
    CHARSET: CHARSET,
    normalizeTilemap: normalizeTilemap,
    applyToObject: applyToObject,
    syncSize: syncSize,
    tileIndexAt: tileIndexAt,
    setTile: setTile,
    resize: resize,
    worldToCell: worldToCell,
    tileAtPixel: tileAtPixel,
    solidTilesOf: solidTilesOf,
    isSolidTile: isSolidTile,
    isSolidAtPixel: isSolidAtPixel,
    tileSourceXY: tileSourceXY,
    visibleTileRange: visibleTileRange,
    resolveTileCollision: resolveTileCollision,
    drawTilemap: drawTilemap,
    fromAscii: fromAscii,
    toAscii: toAscii
  };
}

window.HydraTiles = hydraTilesFactory();
// Self-contained source of the factory, inlined into exported playable games
// by HydraPlayer.buildPlayableHtml so exports run without editor files.
window.HydraTiles.factorySource = hydraTilesFactory.toString();
