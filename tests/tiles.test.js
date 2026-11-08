// Unit tests for hydra/hydra-tiles.js — the shared tilemap module.
//
// Pure logic: normalization, tile access, paint/resize, solid queries,
// AABB-vs-tile collision resolution, draw culling math, and ASCII map
// editing. Nothing here touches the DOM; both runtimes delegate to it.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const sandbox = {};
sandbox.window = sandbox; // hydra-tiles.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hydra', 'hydra-tiles.js'), 'utf8'),
  sandbox, { filename: 'hydra-tiles.js' });
const T = sandbox.HydraTiles;

check('HydraTiles exposed with helpers',
  !!T && typeof T.normalizeTilemap === 'function' && typeof T.setTile === 'function' &&
  typeof T.resolveTileCollision === 'function' && typeof T.drawTilemap === 'function' &&
  typeof T.fromAscii === 'function' && typeof T.toAscii === 'function');
check('factorySource is a self-contained function string',
  typeof T.factorySource === 'string' && T.factorySource.includes('hydraTilesFactory'));

// --- normalization ---
{
  const n = T.normalizeTilemap(null);
  check('null normalizes to defaults',
    n.tileSize === 32 && n.cols === 10 && n.rows === 10 && n.tiles.length === 100 &&
    n.tiles.every(v => v === -1) && n.tilesetAssetId === null && n.tilesetCols === 8 &&
    JSON.stringify(n.solidTiles) === '[0]', JSON.stringify(n));
  const bad = T.normalizeTilemap({ tileSize: 'huge', cols: -5, rows: 1e9, tiles: 'nope', solidTiles: 'x', tilesetCols: 0 });
  check('corrupt fields repair to defaults',
    bad.tileSize === 32 && bad.cols === 1 && bad.rows === 200 && bad.tiles.length === 200 &&
    bad.tilesetCols === 1 && JSON.stringify(bad.solidTiles) === '[0]', JSON.stringify({ ts: bad.tileSize, c: bad.cols, r: bad.rows }));
  const keep = T.normalizeTilemap({ cols: 4, rows: 3, tiles: [0, 1, -1, 5, 0], solidTiles: [1, 1, 2, -3, 'a'] });
  check('tiles pad and solidTiles dedupe',
    keep.tiles.length === 12 && keep.tiles[0] === 0 && keep.tiles[4] === 0 && keep.tiles[5] === -1 &&
    JSON.stringify(keep.solidTiles) === '[1,2]', JSON.stringify(keep.tiles.slice(0, 6)));
  const crop = T.normalizeTilemap({ cols: 2, rows: 2, tiles: [0, 1, 2, 3, 4, 5] });
  check('oversized tiles crop', crop.tiles.length === 4 && crop.tiles[3] === 3, JSON.stringify(crop.tiles));
  const empty = T.normalizeTilemap({ solidTiles: [] });
  check('explicit empty solidTiles stays empty (no collision)', empty.solidTiles.length === 0);
  const frac = T.normalizeTilemap({ tiles: [1.9, '2', null, undefined, -5] });
  check('tile values coerce to ints >= -1', frac.tiles[0] === 1 && frac.tiles[1] === 2 && frac.tiles[2] === -1 && frac.tiles[4] === -1);
}

// --- applyToObject / syncSize ---
{
  const obj = { kind: 'tilemap', posX: 0, posY: 0 };
  T.applyToObject(obj, T.normalizeTilemap({ tileSize: 16, cols: 5, rows: 4, tiles: [0], tilesetAssetId: 'a1', tilesetCols: 4, solidTiles: [0, 3] }));
  check('applyToObject syncs width/height', obj.width === 80 && obj.height === 64 && obj.tiles.length === 20 && obj.tilesetAssetId === 'a1', `${obj.width}x${obj.height}`);
  check('normalizeTilemap does not mutate input', (() => {
    const raw = { cols: 30, rows: 30 };
    T.normalizeTilemap(raw);
    return raw.cols === 30 && !('tiles' in raw);
  })());
}

// --- tile access (project-style objects carry posX/posY; normalizeTilemap
// returns a bare spec, so origin tests use object literals) ---
function tileObject(over) {
  const o = Object.assign({ kind: 'tilemap', posX: 100, posY: 50, tileSize: 32, cols: 4, rows: 4,
    tiles: new Array(16).fill(-1), tilesetAssetId: null, tilesetCols: 8, solidTiles: [0] }, over || {});
  return o;
}
{
  const tm = tileObject();
  T.setTile(tm, 1, 2, 7);
  check('setTile + tileIndexAt', T.tileIndexAt(tm, 1, 2) === 7 && T.tileIndexAt(tm, 0, 0) === -1);
  check('tileIndexAt out of bounds is -1', T.tileIndexAt(tm, -1, 0) === -1 && T.tileIndexAt(tm, 4, 0) === -1 && T.tileIndexAt(tm, 0, 9) === -1);
  check('setTile out of bounds ignored', T.setTile(tm, 9, 9, 3) === false && T.setTile(tm, -1, 0, 3) === false);
  check('setTile clears with -1', T.setTile(tm, 1, 2, -1) === true && T.tileIndexAt(tm, 1, 2) === -1);
  check('setTile no-change returns false', T.setTile(tm, 0, 0, -1) === false);
  check('setTile on null is safe', T.setTile(null, 0, 0, 1) === false);
  const cell = T.worldToCell(tm, 100 + 32 * 2 + 5, 50 + 32 * 1);
  check('worldToCell accounts for map origin', cell.col === 2 && cell.row === 1, JSON.stringify(cell));
  T.setTile(tm, 2, 1, 4);
  check('tileAtPixel', T.tileAtPixel(tm, 100 + 32 * 2 + 5, 50 + 32 + 3) === 4 && T.tileAtPixel(tm, 0, 0) === -1);
}

// --- resize ---
{
  const tm = T.normalizeTilemap({ cols: 3, rows: 3 });
  T.setTile(tm, 2, 2, 9); T.setTile(tm, 0, 0, 1);
  T.resize(tm, 2, 2);
  check('resize keeps overlapping data', tm.cols === 2 && tm.rows === 2 && T.tileIndexAt(tm, 0, 0) === 1 && tm.width === 64, `${tm.cols}x${tm.rows}`);
  T.resize(tm, 4, 1);
  check('resize grows with empty cells', tm.cols === 4 && tm.rows === 1 && T.tileIndexAt(tm, 3, 0) === -1 && T.tileIndexAt(tm, 0, 0) === 1);
  T.resize(tm, 0, -3);
  check('resize clamps to >= 1', tm.cols === 1 && tm.rows === 1);
}

// --- solidity ---
{
  const tm = T.normalizeTilemap({ solidTiles: [0, 2] });
  check('isSolidTile', T.isSolidTile(tm, 0) && T.isSolidTile(tm, 2) && !T.isSolidTile(tm, 1) && !T.isSolidTile(tm, -1));
  const dflt = T.normalizeTilemap({});
  check('default solidTiles is [0]', T.isSolidTile(dflt, 0) && !T.isSolidTile(dflt, 5));
  check('isSolidTile on null map defaults to [0]', T.isSolidTile(null, 0) === true);
}

// --- tileSourceXY ---
{
  const s = T.tileSourceXY(10, 8, 32);
  check('tileSourceXY', s.sx === 64 && s.sy === 32, JSON.stringify(s));
  const s0 = T.tileSourceXY(0, 8, 32);
  check('tileSourceXY tile 0', s0.sx === 0 && s0.sy === 0);
}

// --- visibleTileRange ---
{
  const tm = T.normalizeTilemap({ cols: 10, rows: 10, tileSize: 32 });
  const r = T.visibleTileRange(tm, 0, 0, 320, 320);
  check('full-map range', r.c0 === 0 && r.c1 === 9 && r.r0 === 0 && r.r1 === 9 && !r.empty, JSON.stringify(r));
  const r2 = T.visibleTileRange(tm, 64, 64, 32, 32);
  check('culled range', r2.c0 === 2 && r2.c1 === 3 && r2.r0 === 2 && r2.r1 === 3, JSON.stringify(r2));
  const r3 = T.visibleTileRange(tm, 9999, 9999, 320, 320);
  check('off-map range is empty', r3.empty === true);
}

// --- resolveTileCollision ---
function floorMap(cols, rows, solidRow) {
  const tm = T.normalizeTilemap({ cols, rows, tileSize: 32, solidTiles: [0] });
  for (let c = 0; c < cols; c++) T.setTile(tm, c, solidRow, 0);
  return tm;
}
{
  // falling box lands on a floor row
  const tm = floorMap(10, 10, 5); // floor top at y = 160
  const box = { x: 40, y: 100, w: 24, h: 24, velX: 0, velY: 10, prevX: 40, prevY: 90 };
  // step it until it settles (mimics frames)
  let b = box, landed = false;
  for (let i = 0; i < 30 && !landed; i++) {
    const step = Object.assign({}, b, { prevX: b.x, prevY: b.y, y: b.y + b.velY, velY: b.velY + 2 });
    const res = T.resolveTileCollision(tm, step);
    b = { x: res.x, y: res.y, w: 24, h: 24, velX: res.velX, velY: res.velY };
    landed = res.landed;
  }
  check('falling box lands on tile floor', landed && b.y === 160 - 24 && b.velY === 0, `y=${b.y} velY=${b.velY} landed=${landed}`);
}
{
  // side push against a wall column
  const tm = T.normalizeTilemap({ cols: 10, rows: 10, tileSize: 32, solidTiles: [0] });
  for (let r = 0; r < 10; r++) T.setTile(tm, 5, r, 0); // wall at x=160
  const box = { x: 130, y: 100, w: 24, h: 24, velX: 20, velY: 0, prevX: 130, prevY: 100 };
  const res = T.resolveTileCollision(tm, Object.assign({}, box, { x: box.x + box.velX }));
  check('side push stops at wall', res.collided && res.x === 160 - 24 && res.velX === 0 && !res.landed, `x=${res.x}`);
}
{
  // jumping into a ceiling
  const tm = T.normalizeTilemap({ cols: 10, rows: 10, tileSize: 32, solidTiles: [0] });
  for (let c = 0; c < 10; c++) T.setTile(tm, c, 2, 0); // ceiling bottom at y=96
  const box = { x: 40, y: 110, w: 24, h: 24, velX: 0, velY: -20, prevX: 40, prevY: 130 };
  const res = T.resolveTileCollision(tm, Object.assign({}, box, { y: box.y + box.velY }));
  check('ceiling hit zeroes upward velocity', res.collided && res.hitHead && res.y === 96 && res.velY === 0, `y=${res.y} hitHead=${res.hitHead}`);
}
{
  // no overlap -> untouched, input not mutated
  const tm = floorMap(10, 10, 9);
  const box = { x: 40, y: 40, w: 24, h: 24, velX: 3, velY: 4, prevX: 37, prevY: 36 };
  const res = T.resolveTileCollision(tm, box);
  check('no overlap leaves box alone', !res.collided && res.x === 40 && res.y === 40 && res.velX === 3 && res.velY === 4);
  check('input box not mutated', box.x === 40 && box.y === 40 && box.velX === 3);
}
{
  // non-solid tiles do not collide
  const tm = T.normalizeTilemap({ cols: 4, rows: 4, tileSize: 32, solidTiles: [1] });
  T.setTile(tm, 1, 1, 0); // tile 0 is decorative here
  const res = T.resolveTileCollision(tm, { x: 32, y: 32, w: 32, h: 32, velX: 0, velY: 5, prevX: 32, prevY: 27 });
  check('non-solid tile ignored', !res.collided);
}
{
  // empty solidTiles -> nothing collides
  const tm = T.normalizeTilemap({ cols: 4, rows: 4, tileSize: 32, solidTiles: [] });
  T.setTile(tm, 1, 1, 0);
  const res = T.resolveTileCollision(tm, { x: 32, y: 32, w: 32, h: 32, velX: 0, velY: 5, prevX: 32, prevY: 27 });
  check('empty solidTiles never collides', !res.collided);
}
{
  // hostile inputs never throw
  const tm = T.normalizeTilemap({});
  const r1 = T.resolveTileCollision(tm, null);
  const r2 = T.resolveTileCollision(null, { x: 0, y: 0, w: 10, h: 10 });
  const r3 = T.resolveTileCollision(tm, { x: 0, y: 0, w: 0, h: -5 });
  check('hostile boxes are safe', r1.collided === false && r2.collided === false && r3.collided === false);
}

// --- drawTilemap (smoke: never throws, culls) ---
{
  const calls = [];
  const fakeCtx = {
    fillRect(x, y, w, h) { calls.push(['fill', x, y, w, h]); },
    strokeRect(x, y, w, h) { calls.push(['stroke', x, y, w, h]); },
    drawImage() { calls.push(['img']); },
    fillText() {}
  };
  const tm = floorMap(10, 10, 5);
  T.drawTilemap(fakeCtx, tm, { camX: 0, camY: 0, viewW: 64, viewH: 64, showGrid: true });
  const fills = calls.filter(c => c[0] === 'fill');
  check('draw culls to the visible range', fills.length === 0, `fills=${fills.length}`); // row 5 not visible in 64px view
  calls.length = 0;
  T.drawTilemap(fakeCtx, tm, { camX: 0, camY: 128, viewW: 320, viewH: 64, labelTiles: true });
  const fills2 = calls.filter(c => c[0] === 'fill');
  check('draw paints the visible solid row', fills2.length === 10, `fills=${fills2.length}`);
  check('drawTilemap never throws on garbage', (() => {
    try { T.drawTilemap(null, null, null); T.drawTilemap(fakeCtx, 'nope', {}); return true; }
    catch (e) { return false; }
  })());
  // image path: complete image draws tiles from the tileset
  const imgCalls = [];
  const imgCtx = { drawImage() { imgCalls.push(1); }, fillRect() {}, strokeRect() {} };
  const fakeImg = { complete: true, naturalWidth: 256, naturalHeight: 256 };
  T.drawTilemap(imgCtx, tm, { camX: 0, camY: 128, viewW: 320, viewH: 64, image: fakeImg });
  check('draw uses tileset image when available', imgCalls.length === 10, `draws=${imgCalls.length}`);
}

// --- ASCII ---
{
  const spec = T.fromAscii(['#####', '#...#', '#.0.#']);
  check('fromAscii parses', spec.cols === 5 && spec.rows === 3 && spec.tiles[0] === 36 && spec.tiles[6] === -1 && spec.tiles[12] === 0,
    JSON.stringify(spec.tiles.slice(0, 8)));
  const tm = T.normalizeTilemap({ cols: spec.cols, rows: spec.rows });
  tm.tiles = spec.tiles;
  const lines = T.toAscii(tm);
  check('toAscii round-trips', lines[0] === '#####' && lines[1] === '#...#' && lines[2] === '#.0.#', JSON.stringify(lines));
  const mixed = T.fromAscii(['AbZ', ' ?x']);
  check('fromAscii charset + unknown chars', mixed.tiles[0] === 10 && mixed.tiles[1] === 11 && mixed.tiles[2] === 35 &&
    mixed.tiles[3] === -1 && mixed.tiles[4] === -1 && mixed.tiles[5] === 33, JSON.stringify(mixed.tiles));
  const big = T.fromAscii(['#'.repeat(500)]);
  check('fromAscii clamps width', big.cols === 200);
}

process.exit(failures === 0 ? 0 : 1);
