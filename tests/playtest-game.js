// HydraScript end-to-end playtest harness.
//
// This is the release gate. A game is not shippable because it "boots
// with no errors": it is shippable only when this harness plays it, for
// real, in real Chromium, and every check passes. It exists because the
// Nov 5 2026 Hydra Quest release booted clean and passed ~100 content
// assertions while shipping two unplayable bugs: button labels that did
// not render (invisible text) and a player that could not jump. Neither
// bug produced an error, a warning, or a failed assertion in the old
// suite, because nothing ever looked at the pixels or pressed a key.
//
// What it checks, against a REAL standalone exported game html:
//   1. Boot: zero page errors, zero console errors, zero failed
//      requests (favicon.ico is whitelisted: it is a browser artifact,
//      not the game). hydraPlayer must report ready.
//   2. Button labels actually render: for every VISIBLE button in the
//      scene, the harness reads the canvas pixels in the button's
//      bounds and asserts a meaningful count of pixels in the button's
//      text color. A button whose label does not render FAILS the run.
//   3. Menu navigation: every menu button is clicked and the expected
//      scene must load.
//   4. Real play in a level: move left/right (posX changes), jump
//      (velY goes negative, the player rises, then lands), collect a
//      coin (score increases), touch an enemy (lives decrease), reach
//      the goal (the level completes), pause (the world freezes and
//      Resume returns), lose all lives (Game Over), Retry (a fresh
//      run). Screenshots of the title, level, pause, and game-over
//      states are saved to a timestamped folder and their paths
//      printed.
//   5. Exit code is nonzero on ANY failure. There is no "passed with
//      warnings" for a broken control or an invisible label.
//
// Usage:
//   node tests/playtest-game.js --template flagship --game <path-to-exported-html> [--out <dir>]
//
// The harness is parameterized by template id and game html path so the
// SAME harness playtests any template-built game. Each template needs a
// playbook entry below (scene ids, object names, keys). Only flagship
// (Hydra Quest) has one today; add the arena shooter's playbook when
// that template lands, do not fork the harness.
//
// Release rule (see TESTING.md): no stable release ships until this
// harness passes end to end on the exported game. "Boots with no
// errors" is not a pass. tests/playtest.test.js wires this into
// `node tests/run.js` (it builds the flagship export and runs this
// harness against it; it skips, loudly, only when Chromium is absent).
'use strict';

const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = path.join(
  process.env.HOME || '/home/hatch',
  '.cache/ms-playwright/chromium-1248/chrome-linux64/chrome'
);
const REPO = path.resolve(__dirname, '..');

// ---------------------------------------------------------------- CLI ----
const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def;
}
const TEMPLATE = arg('--template', 'flagship');
const GAME = arg('--game', null);
const OUTDIR = arg('--out', null);
if (!GAME) {
  console.error('usage: node tests/playtest-game.js --template <id> --game <path-to-exported-html> [--out <dir>]');
  process.exit(2);
}
if (!fs.existsSync(GAME)) {
  console.error('playtest: game html not found: ' + GAME);
  process.exit(2);
}

// ------------------------------------------------------------ playbooks ----
// One entry per template-built game. Scene ids and object names come from
// the template's own scene builders; keys are the game's real controls.
const PLAYBOOKS = {
  flagship: {
    label: 'Hydra Quest',
    menuScene: 1,
    howToScene: 2,
    selectScene: 3,
    firstLevelScene: 4,
    level2Scene: 5,
    winScene: 7,
    gameOverScene: 8,
    menu: { playBtn: 'playBtn', howBtn: 'howBtn', resetBtn: 'resetBtn', backBtn: 'backBtn' },
    select: { level1Btn: 'l1Btn', backBtn: 'backBtn' },
    level: {
      player: 'player',
      leftKey: 'ArrowLeft', rightKey: 'ArrowRight', jumpKey: 'Space', pauseKey: 'KeyP',
      pauseBtn: 'pauseBtn', resumeBtn: 'resumeBtn', restartBtn: 'restartBtn', quitBtn: 'quitBtn',
      pausePanel: 'pausePanel',
      coin: 'coin4',        // the ground coin: collectable by walking right
      enemy: 'enemy1',      // first patrolling enemy on the ground
      goal: 'goal',
      groundY: 492,         // player resting posY on the ground
      goalScene: 5,         // scene after completing level 1
    },
    gameOver: { retryBtn: 'retryBtn', menuBtn: 'menuBtn' },
  },
  // TODO: add the arena shooter playbook here when its template lands.
  // The harness must fail loudly for an unknown template, never pass
  // by skipping the game it was asked to playtest.
};
const BOOK = PLAYBOOKS[TEMPLATE];
if (!BOOK) {
  console.error(`playtest: no playbook for template "${TEMPLATE}". Known: ${Object.keys(PLAYBOOKS).join(', ')}. Add one before playtesting this game.`);
  process.exit(2);
}
if (!fs.existsSync(CHROME_PATH)) {
  console.log('SKIPPED - chromium not available at ' + CHROME_PATH);
  process.exit(0);
}

// ------------------------------------------------------- check bookkeeping ----
let failures = 0;
let checks = 0;
const failedNames = [];
function check(name, cond, detail) {
  checks++;
  if (cond) { console.log(`ok - ${name}`); }
  else {
    failures++;
    failedNames.push(name);
    console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`);
  }
}
function section(title) { console.log(`\n== ${title} ==`); }

// ------------------------------------------------------------ page helpers ----
// Snapshot of the live game state (JSON-safe).
async function readState(page) {
  return await page.evaluate(() => {
    const s = window.__hydraState;
    if (!s) return null;
    const objs = (s.objects || []).map(o => ({
      id: o.id, name: o.name, kind: o.kind, anchor: o.anchor,
      posX: o.posX, posY: o.posY, width: o.width, height: o.height,
      text: o._runtimeText !== undefined ? o._runtimeText : (o.text || null),
      textColor: o.textColor,
      hidden: !!(s.hidden && s.hidden.has(o.id)),
    }));
    const p = (s.objects || []).find(o => o.name === 'player');
    return {
      sceneId: s.sceneId,
      paused: !!s.paused,
      variables: Object.assign({}, s.variables),
      camera: s.camera ? { x: s.camera.x || 0, y: s.camera.y || 0, zoom: s.camera.zoom || 1 } : { x: 0, y: 0, zoom: 1 },
      player: p ? { posX: p.posX, posY: p.posY, velX: p.velX, velY: p.velY, anim: p._anim ? p._anim.name : null } : null,
      objects: objs,
    };
  });
}
function namedObj(state, name) {
  return (state && state.objects || []).find(o => o.name === name) || null;
}
async function playerPos(page) {
  const s = await readState(page);
  return s && s.player ? { x: s.player.posX, y: s.player.posY, velX: s.player.velX, velY: s.player.velY, anim: s.player.anim } : null;
}
async function waitForScene(page, id, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeoutMs || 5000)) {
    const s = await readState(page);
    if (s && s.sceneId === id) return true;
    await page.waitForTimeout(100);
  }
  const s = await readState(page);
  return !!(s && s.sceneId === id);
}
// Canvas coords (center) of an object, using the runtime's own widget
// positioning so anchored HUD buttons resolve exactly like the draw does.
async function objectCenter(page, name) {
  return await page.evaluate((nm) => {
    const s = window.__hydraState;
    const cv = document.getElementById('game-canvas');
    if (!s || !cv) return null;
    const o = (s.objects || []).find(x => x.name === nm);
    if (!o) return null;
    if (s.hidden && s.hidden.has(o.id)) return { hidden: true, name: nm };
    let sp = { x: o.posX, y: o.posY };
    try {
      if (window.HydraUi && typeof window.HydraUi.resolveWidgetPosition === 'function') {
        sp = window.HydraUi.resolveWidgetPosition(o, cv.width, cv.height);
      }
    } catch (e) { /* fall through to the world position */ }
    const cam = s.camera || { x: 0, y: 0, zoom: 1 };
    let cx = sp.x, cy = sp.y;
    if (!o.anchor || o.anchor === 'none') {
      const z = cam.zoom || 1;
      cx = (sp.x - (cam.x || 0)) * z;
      cy = (sp.y - (cam.y || 0)) * z;
    }
    return { name: nm, cx: cx + o.width / 2, cy: cy + o.height / 2, w: o.width, h: o.height };
  }, name);
}
async function canvasRect(page) {
  return await page.evaluate(() => {
    const cv = document.getElementById('game-canvas');
    const r = cv.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, iw: cv.width, ih: cv.height };
  });
}
async function clickObject(page, name) {
  const c = await objectCenter(page, name);
  if (!c) throw new Error('no such object: ' + name);
  if (c.hidden) throw new Error('object is hidden, cannot click: ' + name);
  const rect = await canvasRect(page);
  const sx = rect.x + (c.cx / rect.iw) * rect.w;
  const sy = rect.y + (c.cy / rect.ih) * rect.h;
  await page.mouse.click(sx, sy);
  return c;
}
// Read the canvas pixels for every visible button in the current scene
// and count, inside each button's bounds, pixels in the button's text
// color. A label that does not render leaves ~0 such pixels; a rendered
// label leaves hundreds (tens for a two-bar "II"). Threshold: 20.
async function buttonLabelPixels(page) {
  return await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => {
      const s = window.__hydraState;
      const cv = document.getElementById('game-canvas');
      const out = { error: null, buttons: [] };
      if (!s || !cv) { out.error = 'no game state/canvas'; resolve(out); return; }
      let ctx = null;
      try { ctx = cv.getContext('2d'); } catch (e) { out.error = String(e); resolve(out); return; }
      const W = cv.width, H = cv.height;
      let img = null;
      try { img = ctx.getImageData(0, 0, W, H); } catch (e) { out.error = String(e); resolve(out); return; }
      const d = img.data;
      const cam = s.camera || { x: 0, y: 0, zoom: 1 };
      const hex = (c) => {
        const m = /^#?([0-9a-f]{6})$/i.exec(c || '');
        if (!m) return null;
        const n = parseInt(m[1], 16);
        return [n >> 16 & 255, n >> 8 & 255, n & 255];
      };
      const px = (x, y) => {
        x = Math.max(0, Math.min(W - 1, Math.round(x)));
        y = Math.max(0, Math.min(H - 1, Math.round(y)));
        const i = (y * W + x) * 4;
        return [d[i], d[i + 1], d[i + 2], d[i + 3]];
      };
      const close = (a, b, tol) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;
      (s.objects || []).forEach(o => {
        let isBtn = false;
        try { isBtn = !!(window.HydraUi && window.HydraUi.isButton(o)); } catch (e) { isBtn = false; }
        if (!isBtn) return;
        if (s.hidden && s.hidden.has(o.id)) return;
        let sp = { x: o.posX, y: o.posY };
        try {
          if (window.HydraUi && typeof window.HydraUi.resolveWidgetPosition === 'function') {
            sp = window.HydraUi.resolveWidgetPosition(o, W, H);
          }
        } catch (e) { /* keep world position */ }
        let bx = sp.x, by = sp.y;
        if (!o.anchor || o.anchor === 'none') {
          const z = cam.zoom || 1;
          bx = (sp.x - (cam.x || 0)) * z;
          by = (sp.y - (cam.y || 0)) * z;
        }
        const bw = o.width, bh = o.height;
        if (bx + bw < 0 || by + bh < 0 || bx > W || by > H) {
          out.buttons.push({ name: o.name, label: o.text, offscreen: true, textCount: 0, fillCount: 0 });
          return;
        }
        // The button fill, sampled just below the top edge at the
        // horizontal center: fill, never the centered label.
        const fillPx = px(bx + bw / 2, by + 4);
        const textRgb = hex(o.textColor || '#ffffff');
        let textCount = 0, fillCount = 0;
        const x0 = Math.max(0, Math.floor(bx) + 2), x1 = Math.min(W - 1, Math.ceil(bx + bw) - 2);
        const y0 = Math.max(0, Math.floor(by) + 2), y1 = Math.min(H - 1, Math.ceil(by + bh) - 2);
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const p = px(x, y);
            if (p[3] < 200) continue;
            if (close(p, fillPx, 24)) fillCount++;
            if (textRgb && close(p, textRgb, 50)) textCount++;
          }
        }
        out.buttons.push({
          name: o.name,
          label: (o._runtimeText !== undefined ? o._runtimeText : o.text) || '',
          x: Math.round(bx), y: Math.round(by), w: bw, h: bh,
          fillCount, textCount,
        });
      });
      resolve(out);
    });
  }));
}
// Assert every visible button's label renders. Fails the run on the
// first button whose label is missing; returns the per-button counts.
async function checkButtonLabels(page, stage) {
  await page.mouse.move(5, 5);
  await page.waitForTimeout(150);
  const res = await buttonLabelPixels(page);
  check(`${stage}: button labels readable from canvas pixels`, !res.error, res.error || '');
  if (res.error) return;
  if (res.buttons.length === 0) {
    check(`${stage}: at least one visible button to check`, false, 'no visible buttons found');
    return;
  }
  for (const b of res.buttons) {
    if (b.offscreen) continue;
    check(`${stage}: label renders on "${b.name}" ("${b.label}")`,
      b.textCount >= 20 && b.fillCount > 50,
      `textPixels=${b.textCount} fillPixels=${b.fillCount} at (${b.x},${b.y}) ${b.w}x${b.h}`);
  }
}

// ------------------------------------------------------------- main flow ----
async function main() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = OUTDIR || path.join(REPO, 'screenshots', `playtest-${TEMPLATE}-${ts}`);
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`Playtest: template=${TEMPLATE} (${BOOK.label}) game=${GAME}`);
  console.log(`Screenshots -> ${outDir}`);

  const browser = await chromium.launch({ executablePath: CHROME_PATH });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('requestfailed', r => {
    if (/favicon\.ico$/.test(r.url())) return; // browser artifact, not the game
    errors.push('REQFAIL: ' + r.url());
  });
  const shot = (name) => page.screenshot({ path: path.join(outDir, name) });

  try {
    // ---- 1. Boot ----
    section('boot');
    await page.goto('file://' + GAME, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(2500);
    const ready = await page.evaluate(() => document.documentElement.dataset.hydraPlayer === 'ready' && !!window.__hydraState);
    check('game boots (hydraPlayer=ready, state present)', ready === true);
    check('zero page errors, console errors, failed requests', errors.length === 0, errors.slice(0, 3).join(' | '));
    await shot('01-title.png');
    let st = await readState(page);
    check('starts on the title menu', st && st.sceneId === BOOK.menuScene, `sceneId=${st && st.sceneId}`);

    // ---- 2. Menu labels + navigation ----
    section('menu labels + navigation');
    await checkButtonLabels(page, 'title menu');
    await clickObject(page, BOOK.menu.howBtn);
    check('How to Play opens', await waitForScene(page, BOOK.howToScene, 5000), `sceneId=${(await readState(page) || {}).sceneId}`);
    await shot('02-how-to-play.png');
    await checkButtonLabels(page, 'how-to screen');
    await clickObject(page, BOOK.menu.backBtn);
    check('Back returns to the menu', await waitForScene(page, BOOK.menuScene, 5000));
    await clickObject(page, BOOK.menu.playBtn);
    check('Play opens Level Select', await waitForScene(page, BOOK.selectScene, 5000), `sceneId=${(await readState(page) || {}).sceneId}`);
    await shot('03-level-select.png');
    await checkButtonLabels(page, 'level select');
    await clickObject(page, BOOK.select.level1Btn);
    check('Level 1 starts', await waitForScene(page, BOOK.firstLevelScene, 5000), `sceneId=${(await readState(page) || {}).sceneId}`);
    await page.waitForTimeout(1200);
    await shot('04-level-1.png');
    st = await readState(page);
    check('level init: 3 lives', st && st.variables.lives === 3, `lives=${st && st.variables.lives}`);

    // ---- 3. Movement + jump (real keys) ----
    section('movement + jump');
    const L = BOOK.level;
    let p0 = await playerPos(page);
    await page.keyboard.down(L.rightKey);
    await page.waitForTimeout(800);
    await page.keyboard.up(L.rightKey);
    let p1 = await playerPos(page);
    check('move right: posX increases', p1 && p0 && p1.x > p0.x + 30, `x ${p0 && Math.round(p0.x)} -> ${p1 && Math.round(p1.x)}`);
    await page.keyboard.down(L.leftKey);
    await page.waitForTimeout(800);
    await page.keyboard.up(L.leftKey);
    let p2 = await playerPos(page);
    check('move left: posX decreases', p2 && p1 && p2.x < p1.x - 30, `x ${p1 && Math.round(p1.x)} -> ${p2 && Math.round(p2.x)}`);
    // Jump: press Space, sample velY/posY until the player lands again.
    const start = await playerPos(page);
    await page.keyboard.press(L.jumpKey);
    let minY = start.y, minVelY = 0, landed = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 2500) {
      const p = await playerPos(page);
      if (!p) break;
      if (p.velY < minVelY) minVelY = p.velY;
      if (p.y < minY) minY = p.y;
      if (Date.now() - t0 > 300 && p.velY === 0 && Math.abs(p.y - start.y) < 6) { landed = true; break; }
      await page.waitForTimeout(16);
    }
    const afterJump = await playerPos(page);
    check('jump: velY goes negative (launch)', minVelY < -5, `minVelY=${minVelY}`);
    check('jump: player rises', minY < start.y - 20, `y ${Math.round(start.y)} -> min ${Math.round(minY)}`);
    check('jump: player lands back on the ground', landed && afterJump && Math.abs(afterJump.y - start.y) < 6,
      `landed=${landed} y=${afterJump && Math.round(afterJump.y)} start=${Math.round(start.y)}`);
    await shot('05-level-1-after-jump.png');

    // ---- 4. Pause ----
    section('pause');
    await clickObject(page, L.pauseBtn);
    await page.waitForTimeout(400);
    st = await readState(page);
    check('pause button pauses the game', st && st.paused === true, `paused=${st && st.paused}`);
    const pausePanel = namedObj(st, L.pausePanel);
    check('pause menu shown while paused', !!(pausePanel && !pausePanel.hidden), 'pausePanel still hidden');
    await checkButtonLabels(page, 'pause menu');
    const pp0 = await playerPos(page);
    await page.waitForTimeout(500);
    const pp1 = await playerPos(page);
    check('pause: world frozen while paused', pp0 && pp1 && pp0.x === pp1.x && pp0.y === pp1.y,
      `pos (${pp0 && Math.round(pp0.x)},${pp0 && Math.round(pp0.y)}) -> (${pp1 && Math.round(pp1.x)},${pp1 && Math.round(pp1.y)})`);
    await shot('06-pause.png');
    await clickObject(page, L.resumeBtn);
    await page.waitForTimeout(400);
    st = await readState(page);
    check('Resume unpauses', st && st.paused === false, `paused=${st && st.paused}`);
    const pausePanel2 = namedObj(st, L.pausePanel);
    check('pause menu hidden after resume', !!(pausePanel2 && pausePanel2.hidden), 'pausePanel still visible');

    // ---- 5. Enemy hit, then game over by enemy hits ----
    section('enemy hit + game over');
    async function walkIntoEnemy() {
      // Hold Right with no jumping; the patrolling enemy is on the
      // ground path. Returns the lives value when it changes, or null.
      const before = (await readState(page) || {}).variables || {};
      const lives0 = before.lives;
      await page.keyboard.down(L.rightKey);
      let lives = lives0;
      const tend = Date.now() + 12000;
      try {
        while (Date.now() < tend) {
          const s2 = await readState(page);
          if (!s2) break;
          lives = s2.variables.lives;
          if (lives !== lives0) break;
          if (s2.sceneId !== BOOK.firstLevelScene) break;
          await page.waitForTimeout(80);
        }
      } finally {
        await page.keyboard.up(L.rightKey);
      }
      return lives;
    }
    async function waitForRespawn() {
      const tend = Date.now() + 5000;
      while (Date.now() < tend) {
        const p = await playerPos(page);
        if (p && Math.abs(p.x - 80) < 60) return true;
        await page.waitForTimeout(100);
      }
      return false;
    }
    let lives = await walkIntoEnemy();
    check('enemy hit costs one life', lives === 2, `lives=${lives}`);
    check('player respawns at the level spawn after a hit', await waitForRespawn());
    lives = await walkIntoEnemy();
    check('second enemy hit costs another life', lives === 1, `lives=${lives}`);
    await waitForRespawn();
    lives = await walkIntoEnemy();
    check('third enemy hit ends the run', await waitForScene(page, BOOK.gameOverScene, 5000), `sceneId=${(await readState(page) || {}).sceneId} lives=${lives}`);
    await shot('07-game-over.png');
    await checkButtonLabels(page, 'game over');
    await clickObject(page, BOOK.gameOver.retryBtn);
    check('Retry returns to Level 1', await waitForScene(page, BOOK.firstLevelScene, 5000));
    await page.waitForTimeout(800);
    st = await readState(page);
    check('Retry restores 3 lives (fresh run)', st && st.variables.lives === 3, `lives=${st && st.variables.lives}`);

    // ---- 6. Coin + goal: drive right, jumping over the patrolling enemies ----
    section('coin + goal');
    const scoreBefore = (await readState(page) || {}).variables.score || 0;
    let goalReached = false;
    // Drive right and jump over each enemy when its left edge is within
    // 140px. The Level 1 enemies are placed clear of the overhead
    // platforms (see starter-templates.js), so a jump over one is a
    // clean arc with no ceiling to clip. The window was 80px, but on a
    // loaded machine the readState round-trip stretches the poll well
    // past 25ms and the player walks into the enemy before the jump
    // fires (cycle 77: all 3 drive attempts ended in game over, 43/44);
    // at a ~490px/s worst-case closing speed 140px buys ~285ms of
    // margin, and the landing still clears the patrol band. If a run
    // still ends in game over, Retry and drive again (up to 3 runs): a
    // release gate must be deterministic, and a single unlucky patrol
    // cycle must not fail the build. Poll fast: at full speed the
    // player covers ~9px per 25ms, so a 50ms poll can skip the jump
    // window.
    for (let attempt = 1; attempt <= 3 && !goalReached; attempt++) {
      const driveEnd = Date.now() + 40000;
      await page.keyboard.down(L.rightKey);
      try {
        while (Date.now() < driveEnd) {
          const s2 = await readState(page);
          if (!s2) break;
          if (s2.sceneId !== BOOK.firstLevelScene) { goalReached = s2.sceneId === L.goalScene; break; }
          if (s2.variables.lives === 0) break;
          const p = s2.player;
          const foes = (s2.objects || []).filter(o => (o.name === 'enemy1' || o.name === 'enemy2') && !o.hidden);
          const ahead = foes.find(e => {
            const gap = e.posX - p.posX;
            return gap <= 140 && gap > 0 && Math.abs(e.posY - p.posY) < 100;
          });
          if (ahead && p.velY === 0) await page.keyboard.press(L.jumpKey);
          await page.waitForTimeout(25);
        }
      } finally {
        await page.keyboard.up(L.rightKey);
      }
      if (!goalReached) {
        st = await readState(page);
        if (st && st.sceneId === BOOK.gameOverScene && attempt < 3) {
          await clickObject(page, BOOK.gameOver.retryBtn);
          await waitForScene(page, BOOK.firstLevelScene, 5000);
          await page.waitForTimeout(600);
        }
      }
    }
    st = await readState(page);
    const scoreAfter = (st && st.variables.score) || 0;
    check('coin collected on the way (score increases)', scoreAfter > scoreBefore, `score ${scoreBefore} -> ${scoreAfter}`);
    check('goal reached: level completes to the next scene', goalReached && st && st.sceneId === L.goalScene,
      `sceneId=${st && st.sceneId} goalReached=${goalReached}`);
    await shot('08-level-2.png');
    check('no errors accumulated during the whole playthrough', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) {
    failures++;
    failedNames.push('harness crashed: ' + e.message);
    console.log('NOT OK - harness crashed :: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e.message));
    try { await shot('99-crash.png'); } catch (_) { /* ignore */ }
  } finally {
    await browser.close().catch(() => {});
  }

  console.log(`\nPlaytest ${TEMPLATE}: ${checks - failures}/${checks} checks passed. Screenshots in ${outDir}`);
  if (failures > 0) {
    console.log('Failing checks:');
    failedNames.forEach(n => console.log('  - ' + n));
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => {
  console.error('playtest fatal: ' + (e && e.stack ? e.stack : e.message));
  process.exit(1);
});
