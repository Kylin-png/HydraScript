// HydraScript browser smoke test (Playwright + local Chromium).
//
// Boots its own static server for ../hydra, then drives the real UI:
//   home -> new project (collector template) -> editor Logic tab ->
//   Add Condition picker -> place block on grid -> Preview tab.
//
// Usage: node tests/browser-smoke.js
// Exit 0 = all checks passed. Any failure prints details and exits 1.
// If Chromium itself cannot launch, the test skips loudly with exit 0
// instead of crashing (same gate as the playtest): the smoke test was
// NOT verified in that case, and TESTING.md still requires the harness
// to be run by hand before any stable release ships.
//
// This is the "never claim a feature is complete without testing it in the
// browser" gate. Keep it fast and deterministic; extend it as features land.
//
// Navigations use waitUntil 'domcontentloaded', never 'networkidle': the
// editor loads Font Awesome from a CDN the sandbox cannot reliably reach,
// and a stalled CDN request starves networkidle past the 30s default —
// that flaked the suite in cycles 74 and 75 at different pages (a goto,
// then two different reloads). All HydraScript scripts are classic (no
// async/defer), so they execute during parsing, before domcontentloaded
// fires; every step after a navigation waits for the element it needs
// (Playwright auto-waits, waitForSelector, or an explicit timeout).

const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const HYDRA_DIR = path.join(__dirname, '..', 'hydra');
const PORT = 8124;
const CHROME_PATH = path.join(
  process.env.HOME || '/home/hatch',
  '.cache/ms-playwright/chromium-1248/chrome-linux64/chrome'
);

// ---- Chromium gate: skip loudly unless the browser can really launch ----
// (Cycle 14 repair, restored this cycle after the cycle-20 smoke-file
// reconstruction from HEAD dropped it: `--version` still exits 0 on a
// broken Chromium, so only a real headless launch proves anything. A
// non-zero exit (SIGTRAP 133 on the Nov 7, 2026 breakage) or a timeout
// means the smoke test cannot run here. The probe runs before the
// server starts, so a skipped run never starts one.)
function chromiumLaunchable() {
  try {
    const r = spawnSync(CHROME_PATH, ['--headless', '--disable-gpu', '--no-sandbox', '--dump-dom', 'about:blank'],
      { encoding: 'utf8', timeout: 20000 });
    return r.status === 0;
  } catch (e) { return false; }
}
if (!fs.existsSync(CHROME_PATH)) {
  console.log('SKIPPED - chromium not available; the smoke test was NOT verified. Run the harness by hand before shipping (see TESTING.md).');
  process.exit(0);
}
if (!chromiumLaunchable()) {
  console.log('SKIPPED - chromium cannot launch (binary exists but a real headless launch fails); the smoke test was NOT verified. Run the harness by hand before shipping (see TESTING.md).');
  process.exit(0);
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

// Navigation with retries (cycles 76/77): under load a localhost goto /
// reload occasionally stalls past Playwright's 30s domcontentloaded
// timeout — the same URL loads fine on a later attempt, and the
// identical navigation succeeded dozens of times in the same run, so
// the stall is environmental (loaded machine / sandbox network faults
// on the pages' CDN stylesheets), not the page. Cycle 77 run 4 showed
// a stall lasting past two consecutive 30s attempts, so retry twice
// with a short pause between attempts; a third failure rethrows, so a
// genuinely unloadable page still fails the test exactly as before.
async function goto(pg, url, opts) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return await pg.goto(url, opts); }
    catch (e) {
      console.log(`(navigation to ${url} stalled on attempt ${attempt}/3: ${e.message.split('\n')[0]})`);
      if (attempt === 3) throw e;
      await pg.waitForTimeout(5000);
    }
  }
}
async function reloadPage(pg, opts) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return await pg.reload(opts); }
    catch (e) {
      console.log(`(reload stalled on attempt ${attempt}/3: ${e.message.split('\n')[0]})`);
      if (attempt === 3) throw e;
      await pg.waitForTimeout(5000);
    }
  }
}

async function main() {
  const { chromium } = require('playwright-core');
  if (!fs.existsSync(CHROME_PATH)) {
    console.log('SKIPPED - chromium not available at ' + CHROME_PATH);
    process.exit(0);
  }

  // stdio 'ignore': the server logs every request to stderr, and with
  // the default piped stdio nobody reads it — after ~1100 requests the
  // 64KB pipe fills and the server blocks mid-response forever (cycle 0:
  // three consecutive smoke runs stalled at the same late navigation,
  // server alive, CPU idle, threads piling up; repro stalls at 1108 reqs).
  const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: HYDRA_DIR, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));

  const browser = await chromium.launch({ executablePath: CHROME_PATH });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => pageErrors.push(String(e && e.message || e)));

  try {
    // ---- home: new project from the collector template ----
    await goto(page, `http://localhost:${PORT}/home.html`, { waitUntil: 'domcontentloaded' });
    await page.click('#new-project-btn-main');
    await page.fill('#project-name-input', 'Smoke Test Game');
    await page.click('.template-card[data-template="collector"]');
    await Promise.all([
      page.waitForURL(/index\.html/, { timeout: 15000 }),
      page.click('#create-project-btn')
    ]);
    check('editor opens after creating collector project', /index\.html/.test(page.url()), page.url());

    // ---- Logic tab ----
    await page.click('.tab[data-tab="script-tab"]');


    await page.waitForSelector('#grid', { timeout: 10000 });
    const gridCells = await page.locator('#grid > *').count();
    check('logic grid renders 3600 cells', gridCells === 3600, `found ${gridCells}`);
    const blockCount = await page.locator('#grid [data-block-type]').count();
    check('collector template ships with blocks on the grid', blockCount > 0, `found ${blockCount}`);
    check('empty-logic hint stays hidden when blocks exist',
      await page.locator('.grid-empty-hint').count() === 0);

    // ---- Add a block through the picker ----
    const blocksBefore = await page.locator('#grid [data-block-type]').count();
    await page.click('#add-condition-tool');
    await page.waitForSelector('.hydra-modal', { timeout: 5000 });
    check('Add Condition opens the block picker', true);
    await page.locator('.picker-grid .picker-item').first().click();
    await page.waitForSelector('.hydra-modal', { state: 'detached', timeout: 5000 });
    await page.locator('#grid > *:not([data-block-type])').last().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type]').length > n,
      blocksBefore, { timeout: 5000 }
    ).catch(() => {});
    const blocksAfter = await page.locator('#grid [data-block-type]').count();
    check('Add Condition picker places a block on the grid', blocksAfter === blocksBefore + 1,
      `before=${blocksBefore} after=${blocksAfter}`);

    // ---- accessibility (P3 item 17): names, palette + grid keyboard ----
    check('a11y: icon-only buttons expose an accessible name',
      await page.evaluate(() => ['#scene-rename-btn', '#preview-restart-btn', '#preview-profiler-btn', '#preview-trace-btn']
        .every(id => document.querySelector(id)?.getAttribute('aria-label'))));
    check('a11y: diagnostics feed is a polite live region',
      await page.evaluate(() => document.getElementById('diagnostic-feed')?.getAttribute('aria-live') === 'polite'));
    const paletteA11y = await page.evaluate(() => {
      const opts = [...document.querySelectorAll('.block-option')];
      return {
        labelled: opts.every(o => o.getAttribute('role') === 'button' && o.getAttribute('aria-label')),
        oneTabStop: opts.filter(o => o.tabIndex === 0).length,
      };
    });
    check('a11y: every palette option is a labelled button with one Tab stop',
      paletteA11y.labelled && paletteA11y.oneTabStop === 1, JSON.stringify(paletteA11y));
    // Palette keyboard: the picker flow left a cell selected, so the palette
    // is hidden behind the properties panel; clicking an empty cell with the
    // eraser active brings the palette back, as a user would.
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.evaluate(() => document.querySelector('.block-option:not(.is-filtered)')?.focus());
    await page.keyboard.press('ArrowDown');
    const paletteFocus = await page.evaluate(() => {
      const a = document.activeElement;
      return a ? { type: a.dataset.blockType, label: a.getAttribute('aria-label') } : null;
    });
    check('a11y: palette ArrowDown moves focus to the next option',
      paletteFocus && paletteFocus.type === 'game-start', JSON.stringify(paletteFocus));
    await page.keyboard.press('Enter');
    const activeTool = await page.locator('#script-active-tool').innerText();
    check('a11y: palette Enter picks the focused block tool',
      activeTool === (paletteFocus && paletteFocus.label), `tool=${activeTool}`);
    // Grid keyboard: focus a known empty mid-grid cell, then move, place, clear.
    const cellInfo = await page.evaluate(() => {
      const cell = [...document.querySelectorAll('#grid > .cell')]
        .find(c => !c.dataset.blockType && +c.dataset.col > 5 && +c.dataset.col < 50 && +c.dataset.row > 5 && +c.dataset.row < 50);
      cell.focus();
      return { index: +cell.dataset.index };
    });
    await page.keyboard.press('ArrowRight');
    const afterRight = await page.evaluate(() => +document.activeElement.dataset.index);
    check('a11y: grid ArrowRight moves focus to the next cell',
      afterRight === cellInfo.index + 1, `from=${cellInfo.index} to=${afterRight}`);
    await page.keyboard.press('ArrowDown');
    const afterDown = await page.evaluate(() => +document.activeElement.dataset.index);
    check('a11y: grid ArrowDown moves focus to the cell below',
      afterDown === cellInfo.index + 61, `from=${cellInfo.index} to=${afterDown}`);
    await page.keyboard.press('Enter');
    const placed = await page.evaluate(() => {
      const a = document.activeElement;
      return { type: a.dataset.blockType, label: a.getAttribute('aria-label') };
    });
    check('a11y: grid Enter places the selected block on the focused cell',
      placed.type === 'game-start', JSON.stringify(placed));
    check('a11y: placed cell announces its block in its label',
      /Game Start/.test(placed.label || ''), placed.label);
    await page.keyboard.press('Delete');
    const cleared = await page.evaluate(() => !document.activeElement.dataset.blockType);
    check('a11y: grid Delete clears the focused cell', cleared);
    await page.keyboard.press('Home');
    const afterHome = await page.evaluate(() => {
      const a = document.activeElement;
      return { index: +a.dataset.index, col: +a.dataset.col };
    });
    check('a11y: grid Home jumps to the start of the row',
      afterHome.col === 0, JSON.stringify(afterHome));
    await page.keyboard.press('Escape');
    const afterEsc = await page.evaluate(() => document.activeElement.className);
    check('a11y: grid Escape returns focus to the grid container',
      /grid-container/.test(afterEsc), afterEsc);

    // ---- Preview tab ----
    await page.click('.tab[data-tab="preview-tab"]');
    await page.waitForSelector('#game-canvas', { timeout: 10000 });
    await page.waitForTimeout(2500); // let a few frames run
    const canvasSize = await page.evaluate(() => {
      const c = document.getElementById('game-canvas');
      return c ? { w: c.width, h: c.height } : null;
    });
    check('preview canvas is sized and rendering', !!canvasSize && canvasSize.w > 0 && canvasSize.h > 0,
      JSON.stringify(canvasSize));
    const errorOverlay = await page.locator('body').evaluate((b) =>
      /failed|error/i.test(b.innerText || '') && (b.innerText || '').includes('Hydra') ? b.innerText.slice(0, 200) : '');
    check('no Hydra error overlay in preview', errorOverlay === '', errorOverlay);

    // ---- save -> reload: the added block persists ----
    await page.click('.tab[data-tab="script-tab"]');
    const blocksPreReload = await page.locator('#grid [data-block-type]').count();
    await page.click('#save-project-btn');
    await page.waitForTimeout(500);
    await reloadPage(page, { waitUntil: 'domcontentloaded' });
    await page.click('.tab[data-tab="script-tab"]');
    await page.waitForSelector('#grid', { timeout: 10000 });
    const blocksPostReload = await page.locator('#grid [data-block-type]').count();
    check('added block survives save + reload', blocksPostReload === blocksPreReload && blocksPreReload > 0,
      `before=${blocksPreReload} after=${blocksPostReload}`);

    // ---- export dialog (P4 E1): target picker with guided checklists ----
    await page.click('#export-playable-btn');
    await page.waitForSelector('#export-dialog.open', { timeout: 5000 });
    check('export dialog opens', await page.locator('#export-dialog.open').count() === 1);
    const cards = await page.locator('[data-export-target]').count();
    check('export dialog has 6 target cards (E4 hub)', cards === 6, `found ${cards}`);
    const checklistItems = await page.locator('.export-checklist li').count();
    check('every card carries a guided checklist', checklistItems >= 12, `found ${checklistItems}`);
    const capabilities = await page.locator('.export-capabilities').count();
    check('every card carries honest capability notes', capabilities === 6, `found ${capabilities}`);
    const cmdChips = await page.locator('.export-cmd').count();
    check('export hub has copy-paste command chips', cmdChips >= 7, `found ${cmdChips}`);
    // Escape closes the dialog
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    check('Escape closes the export dialog', await page.locator('#export-dialog.open').count() === 0);

    // ---- export dialog focus management (P3 item 17) ----
    await page.click('#export-playable-btn');
    await page.waitForSelector('#export-dialog.open', { timeout: 5000 });
    check('a11y: export dialog moves focus to its Close button on open',
      await page.evaluate(() => document.activeElement.id === 'export-dialog-close'));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    check('a11y: closing the export dialog returns focus to the Export button',
      await page.evaluate(() => document.activeElement.id === 'export-playable-btn'));

    // ---- export playable HTML (standalone target) ----
    await page.click('#export-playable-btn');
    await page.waitForSelector('#export-dialog.open', { timeout: 5000 });
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      page.click('#export-download-standalone')
    ]);
    const exportPath = await download.path();
    check('export produced a download', !!exportPath);
    const exportedHtml = require('fs').readFileSync(exportPath, 'utf8');
    check('exported HTML is self-contained (no http src)',
      !/src="http|href="http/.test(exportedHtml));

    // ---- exported game boots standalone ----
    const standalone = await context.newPage();
    const standaloneErrors = [];
    standalone.on('pageerror', e => standaloneErrors.push(String(e && e.message || e)));
    await standalone.setContent(exportedHtml, { waitUntil: 'domcontentloaded' });
    await standalone.waitForFunction(
      () => document.documentElement.dataset.hydraPlayer === 'ready' ||
            document.documentElement.dataset.hydraPlayer === 'error',
      null, { timeout: 10000 });
    const bootState = await standalone.evaluate(() => document.documentElement.dataset.hydraPlayer);
    check('exported game boots standalone (hydraPlayer=ready)', bootState === 'ready', bootState);
    await standalone.waitForTimeout(2000);
    check('no errors in standalone exported game', standaloneErrors.length === 0,
      standaloneErrors.slice(0, 3).join(' | '));
    const standaloneCanvas = await standalone.evaluate(() => {
      const c = document.querySelector('canvas');
      return c ? { w: c.width, h: c.height } : null;
    });
    check('standalone game canvas is live',
      !!standaloneCanvas && standaloneCanvas.w > 0, JSON.stringify(standaloneCanvas));
    await standalone.close();

    // ---- E1: Web ZIP (itch.io) download ----
    const [zipDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      page.click('#export-download-webzip')
    ]);
    const zipPath = await zipDownload.path();
    check('web ZIP produced a download', !!zipPath);
    const zipBytes = require('fs').readFileSync(zipPath);
    check('web ZIP has ZIP magic bytes (PK\\x03\\x04)',
      zipBytes.length > 22 && zipBytes[0] === 0x50 && zipBytes[1] === 0x4B &&
      zipBytes[2] === 0x03 && zipBytes[3] === 0x04, `len=${zipBytes.length}`);
    check('web ZIP is a real archive, not an HTML file',
      !zipBytes.slice(0, 15).toString().includes('<!doctype'));

    // ---- E1: PWA ZIP download ----
    const [pwaDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      page.click('#export-download-pwa')
    ]);
    const pwaPath = await pwaDownload.path();
    check('PWA ZIP produced a download', !!pwaPath);
    const pwaBytes = require('fs').readFileSync(pwaPath);
    check('PWA ZIP has ZIP magic bytes',
      pwaBytes.length > 22 && pwaBytes[0] === 0x50 && pwaBytes[1] === 0x4B &&
      pwaBytes[2] === 0x03 && pwaBytes[3] === 0x04, `len=${pwaBytes.length}`);
    check('PWA ZIP is larger (icons + manifest + SW)', pwaBytes.length > zipBytes.length,
      `pwa=${pwaBytes.length} web=${zipBytes.length}`);

    // ---- E2: Desktop (Electron) project ZIP download ----
    const [deskDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      page.click('#export-download-desktop')
    ]);
    const deskPath = await deskDownload.path();
    check('desktop ZIP produced a download', !!deskPath);
    const deskBytes = require('fs').readFileSync(deskPath);
    check('desktop ZIP has ZIP magic bytes',
      deskBytes.length > 22 && deskBytes[0] === 0x50 && deskBytes[1] === 0x4B &&
      deskBytes[2] === 0x03 && deskBytes[3] === 0x04, `len=${deskBytes.length}`);
    check('desktop ZIP is a real archive, not an HTML file',
      !deskBytes.slice(0, 15).toString().includes('<!doctype'));

    // ---- E3: Android (Capacitor) project ZIP download ----
    const [androidDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      page.click('#export-download-android')
    ]);
    const androidPath = await androidDownload.path();
    check('android ZIP produced a download', !!androidPath);
    const androidBytes = require('fs').readFileSync(androidPath);
    check('android ZIP has ZIP magic bytes',
      androidBytes.length > 22 && androidBytes[0] === 0x50 && androidBytes[1] === 0x4B &&
      androidBytes[2] === 0x03 && androidBytes[3] === 0x04, `len=${androidBytes.length}`);
    check('android ZIP is a real archive, not an HTML file',
      !androidBytes.slice(0, 15).toString().includes('<!doctype'));
    check('android ZIP names capacitor.config.json in the archive',
      androidBytes.includes(Buffer.from('capacitor.config.json')));
    check('android ZIP is larger (icon + splash resources)',
      androidBytes.length > deskBytes.length, `android=${androidBytes.length} desktop=${deskBytes.length}`);

    // ---- E4: iOS (Capacitor) project ZIP download (same Capacitor project, iOS guidance) ----
    const [iosDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      page.click('#export-download-ios')
    ]);
    const iosPath = await iosDownload.path();
    check('iOS ZIP produced a download', !!iosPath);
    const iosBytes = require('fs').readFileSync(iosPath);
    check('iOS ZIP has ZIP magic bytes',
      iosBytes.length > 22 && iosBytes[0] === 0x50 && iosBytes[1] === 0x4B &&
      iosBytes[2] === 0x03 && iosBytes[3] === 0x04, `len=${iosBytes.length}`);
    check('iOS ZIP is the same complete Capacitor project as the Android ZIP',
      iosBytes.length === androidBytes.length && iosBytes.includes(Buffer.from('capacitor.config.json')),
      `ios=${iosBytes.length} android=${androidBytes.length}`);

    // ---- E4: one-click copy of a command chip ----
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const firstChip = page.locator('.export-cmd').first();
    const expectedCmd = await firstChip.getAttribute('data-cmd');
    await firstChip.click();
    await page.waitForTimeout(300);
    const clipped = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
    check('command chip copies its command to the clipboard', clipped === expectedCmd,
      `expected=${expectedCmd} got=${clipped}`);
    check('command chip shows Copied feedback',
      (await firstChip.textContent()).includes('Copied!'), await firstChip.textContent());
    // dialog closes via its X button
    await page.click('#export-dialog-close');
    await page.waitForTimeout(200);
    check('X button closes the export dialog', await page.locator('#export-dialog.open').count() === 0);

    // ---- F1: diagnostics dock collapses so it never covers panel buttons ----
    await page.click('.tab[data-tab="script-tab"]');
    await page.waitForSelector('#grid', { timeout: 10000 });
    await page.click('#diagnostics-toggle');
    check('diagnostics dock collapses via its toggle',
      await page.locator('#diagnostics-dock.is-collapsed').count() === 1);
    const dockCoversButton = await page.evaluate(() => {
      const btn = document.getElementById('clearButton');
      btn.scrollIntoView({ block: 'center' });
      const r = btn.getBoundingClientRect();
      const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return !(el === btn || btn.contains(el));
    });
    check('collapsed dock no longer covers the Clear Grid button', !dockCoversButton);

    // ---- F1: empty-logic hint bar (guided empty state) ----
    page.on('dialog', d => d.accept()); // accept the Clear Grid confirm
    await page.click('#clearButton');
    await page.waitForSelector('.grid-empty-hint', { timeout: 5000 });
    check('empty-logic hint appears when the grid is cleared', true);
    await page.click('.grid-empty-hint-btn');
    await page.waitForSelector('.hydra-modal', { timeout: 5000 });
    check('hint "Add your first block" opens the block picker', true);
    // P3 item 17 (accessibility): Escape closes the picker...
    await page.keyboard.press('Escape');
    await page.waitForSelector('.hydra-modal', { state: 'detached', timeout: 5000 });
    check('Escape closes the block picker', true);
    // ...and the Close button does the same when reopened.
    await page.click('.grid-empty-hint-btn');
    await page.waitForSelector('.hydra-modal', { timeout: 5000 });
    await page.locator('.hydra-modal [data-close-picker]').click();
    await page.waitForSelector('.hydra-modal', { state: 'detached', timeout: 5000 });
    check('block picker Close button closes it', true);
    await page.click('.grid-empty-hint-close');
    check('hint dismisses via its close button',
      await page.locator('.grid-empty-hint').count() === 0);

    // ---- F1: hub search with no matches shows a guided empty state ----
    const hub = await context.newPage();
    await goto(hub, `http://localhost:${PORT}/home.html`, { waitUntil: 'domcontentloaded' });
    await hub.fill('#search-input', 'zzz-no-such-project-zzz');
    await hub.waitForFunction(
      () => document.body.innerText.includes('No projects match'), null, { timeout: 5000 });
    check('hub search no-results state appears', true);
    await hub.close();
    // ---- F2: UI widgets — panel object, Menus & HUD inspector ----
    await page.click('.tab[data-tab="scene-tab"]');
    await page.click('.inspector-tab[data-inspector-tab="create"]');
    await page.waitForSelector('.object-create-btn[data-create-kind="panel"]', { timeout: 10000 });
    await page.click('.object-create-btn[data-create-kind="panel"]');
    await page.waitForSelector('.game-object.panel-object', { timeout: 5000 });
    check('panel object appears in the scene editor', true);
    const panelBg = await page.evaluate(() => {
      const el = document.querySelector('.game-object.panel-object');
      return el && getComputedStyle(el).backgroundColor;
    });
    check('panel renders with its background color', !!panelBg && panelBg !== 'rgba(0, 0, 0, 0)', panelBg);

    // Button widget: create one, check the Menus & HUD inspector section.
    // (Creating the panel auto-switched the inspector to the Inspect tab.)
    await page.click('.inspector-tab[data-inspector-tab="create"]');
    await page.click('.object-create-btn[data-create-kind="button"]');
    await page.waitForSelector('.ui-layout-editor', { timeout: 5000 });
    check('Menus & HUD inspector section appears for buttons', true);
    const anchorOptions = await page.evaluate(() =>
      [...document.querySelectorAll('.ui-layout-editor select option')].map(o => o.value));
    check('anchor select offers none + 9 screen anchors',
      anchorOptions.length === 10 && anchorOptions.includes('top-right') && anchorOptions.includes('center'),
      anchorOptions.join(','));
    const btnBg = await page.evaluate(() => {
      const el = document.querySelector('.game-object.selected');
      return el && getComputedStyle(el).backgroundColor;
    });
    check('button renders with a background fill in the scene editor',
      !!btnBg && btnBg !== 'rgba(0, 0, 0, 0)', btnBg);

    // Anchor it top-center: the badge names the anchor.
    await page.evaluate(() => {
      const sel = document.querySelector('.ui-layout-editor select');
      sel.value = 'top-center';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForSelector('.ui-widget-badge', { timeout: 5000 });
    const badgeText = await page.evaluate(() =>
      document.querySelector('.game-object.selected .ui-widget-badge')?.textContent);
    check('anchored widget shows its anchor badge', /Top center/.test(badgeText || ''), badgeText);

    // ---- F3: save-slot blocks in the palette with a working property panel ----
    await page.click('.tab[data-tab="script-tab"]');
    await page.waitForSelector('#grid', { timeout: 10000 });
    const paletteLabels = await page.evaluate(() =>
      [...document.querySelectorAll('.block-selector .block-category-label')]
        .map(el => el.textContent.trim()));
    check('Storage category appears in the block palette', paletteLabels.includes('Storage'),
      paletteLabels.join(' | '));
    const saveBlockOptions = await page.evaluate(() =>
      ['save-game', 'load-game', 'delete-save', 'save-slot-exists-condition'].map(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('save-slot blocks are in the palette (Save Game / Load Game / Delete Save / Save Slot Exists)',
      saveBlockOptions.every(Boolean), JSON.stringify(saveBlockOptions));
    // Place Save Game on the grid, then check its property panel has the Slot name field.
    const saveGameBefore = await page.locator('#grid [data-block-type="save-game"]').count();
    await page.click('.block-selector .block-option[data-block-type="save-game"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="save-game"]').length > n,
      saveGameBefore, { timeout: 5000 }).catch(() => {});
    const saveGameCell = page.locator('#grid [data-block-type="save-game"]').first();
    check('Save Game block places on the grid', await saveGameCell.count() === 1);
    await saveGameCell.click();
    const propPanelText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Save Game property panel offers a Slot name field', /Slot name/i.test(propPanelText),
      propPanelText.slice(0, 200));

    // ---- F4: pause blocks in the palette with a working property panel ----
    // (Selecting the save-game cell swapped the side panel to the property
    // panel; go back to the block palette first.)
    await page.click('#back-to-blocks-btn');
    await page.waitForSelector('.block-selector .block-option[data-block-type="pause-game"]:visible',
      { timeout: 5000 }).catch(() => {});
    check('Game Flow category appears in the block palette', paletteLabels.includes('Game Flow'),
      paletteLabels.join(' | '));
    const pauseBlockOptions = await page.evaluate(() =>
      ['pause-game', 'resume-game', 'toggle-pause', 'game-paused-condition'].map(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('pause blocks are in the palette (Pause Game / Resume Game / Toggle Pause / Game Paused)',
      pauseBlockOptions.every(Boolean), JSON.stringify(pauseBlockOptions));
    // Place Pause Game on the grid.
    const pauseBefore = await page.locator('#grid [data-block-type="pause-game"]').count();
    await page.click('.block-selector .block-option[data-block-type="pause-game"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="pause-game"]').length > n,
      pauseBefore, { timeout: 5000 }).catch(() => {});
    const pauseCell = page.locator('#grid [data-block-type="pause-game"]').first();
    check('Pause Game block places on the grid', await pauseCell.count() === 1);
    // Placing selected the cell (property panel again) — back to the palette.
    await page.click('#back-to-blocks-btn');
    // Place Game Paused, then check its property panel has the Invert field.
    const gamePausedBefore = await page.locator('#grid [data-block-type="game-paused-condition"]').count();
    await page.click('.block-selector .block-option[data-block-type="game-paused-condition"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="game-paused-condition"]').length > n,
      gamePausedBefore, { timeout: 5000 }).catch(() => {});
    const gamePausedCell = page.locator('#grid [data-block-type="game-paused-condition"]').first();
    check('Game Paused block places on the grid', await gamePausedCell.count() === 1);
    await gamePausedCell.click();
    const pausePropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Game Paused property panel offers an Invert field', /Invert/i.test(pausePropText),
      pausePropText.slice(0, 200));

    // ---- Cycle 60: Screen Flash block (v4 gap) in the palette with a working panel ----
    // (Selecting the game-paused cell swapped the side panel to the property
    // panel; go back to the block palette first.)
    await page.click('#back-to-blocks-btn');
    await page.waitForSelector('.block-selector .block-option[data-block-type="screen-flash"]:visible',
      { timeout: 5000 }).catch(() => {});
    check('Camera category appears in the block palette', paletteLabels.includes('Camera'),
      paletteLabels.join(' | '));
    check('Screen Flash block is in the palette',
      await page.evaluate(() => !!document.querySelector('.block-selector .block-option[data-block-type="screen-flash"]')));
    check('flash presets are in the palette (White screen flash / Red damage flash)',
      await page.evaluate(() => ['flash-white', 'flash-red'].every(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`))));
    // Place Screen Flash on the grid, then check its property panel fields.
    const flashBefore = await page.locator('#grid [data-block-type="screen-flash"]').count();
    await page.click('.block-selector .block-option[data-block-type="screen-flash"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="screen-flash"]').length > n,
      flashBefore, { timeout: 5000 }).catch(() => {});
    const flashCell = page.locator('#grid [data-block-type="screen-flash"]').first();
    check('Screen Flash block places on the grid', await flashCell.count() === 1);
    await flashCell.click();
    const flashPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Screen Flash property panel offers a Color field', /Color/i.test(flashPropText),
      flashPropText.slice(0, 200));
    check('Screen Flash property panel offers Intensity and Seconds fields',
      /Intensity/i.test(flashPropText) && /Seconds/i.test(flashPropText),
      flashPropText.slice(0, 300));

    // ---- Cycle 61: camera effects through the shared HydraCameraFx module (P2 item 15/12, slice 1) ----
    // (Selecting the flash cell swapped the side panel to the property
    // panel; go back to the block palette first.)
    await page.click('#back-to-blocks-btn');
    const cameraFxLoaded = await page.evaluate(() => {
      const FX = window.HydraCameraFx;
      return !!FX && typeof FX.triggerShake === 'function' &&
        typeof FX.triggerFlash === 'function' && typeof FX.decay === 'function' &&
        typeof FX.shakeOffset === 'function' && typeof FX.flashAlpha === 'function' &&
        typeof FX.isValidHexColor === 'function' && typeof FX.createShake === 'function' &&
        typeof FX.createFlash === 'function' && typeof FX.factorySource === 'string';
    });
    check('HydraCameraFx module is loaded in the editor', cameraFxLoaded);
    await page.waitForSelector('.block-selector .block-option[data-block-type="screen-shake"]:visible',
      { timeout: 5000 }).catch(() => {});
    check('Screen Shake block is in the palette',
      await page.evaluate(() => !!document.querySelector('.block-selector .block-option[data-block-type="screen-shake"]')));
    // Place Screen Shake on the grid, then check its property panel fields.
    const shakeBefore = await page.locator('#grid [data-block-type="screen-shake"]').count();
    await page.click('.block-selector .block-option[data-block-type="screen-shake"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="screen-shake"]').length > n,
      shakeBefore, { timeout: 5000 }).catch(() => {});
    const shakeCell = page.locator('#grid [data-block-type="screen-shake"]').first();
    check('Screen Shake block places on the grid', await shakeCell.count() === 1);
    await shakeCell.click();
    const shakePropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Screen Shake property panel offers Strength and Seconds fields',
      /Strength/i.test(shakePropText) && /Seconds/i.test(shakePropText),
      shakePropText.slice(0, 300));

    // ---- Cycle 62: scene-load object init through the shared HydraSceneInit module (P2 item 15/12, slice 2) ----
    const sceneInitLoaded = await page.evaluate(() => {
      const SI = window.HydraSceneInit;
      return !!SI && typeof SI.initSceneObjects === 'function' &&
        typeof SI.applyBoundTexts === 'function' && typeof SI.factorySource === 'string';
    });
    check('HydraSceneInit module is loaded in the editor', sceneInitLoaded);
    // Live parity check: a preview scene switch now runs the FULL object
    // init (start animation autoplays, initial state entered, tween state
    // fresh) — previously a switch only reset velocity, so the scene-2
    // hero sat on frame 0 with no state machine until a block touched it.
    const sctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const spage = await sctx.newPage();
    const sErrors = [];
    spage.on('pageerror', e => sErrors.push(String(e && e.message || e)));
    await goto(spage, `http://localhost:${PORT}/home.html`, { waitUntil: 'domcontentloaded' });
    await spage.evaluate(() => {
      const now = new Date().toISOString();
      const hero = (id, name) => ({
        id, name, kind: 'sprite', posX: 10, posY: 20, width: 40, height: 40, color: '#ff0000',
        animations: [
          { name: 'Idle', mode: 'loop', fps: 8, frames: ['a1'] },
          { name: 'Run', mode: 'loop', fps: 8, frames: ['r1', 'r2'] }
        ],
        animStates: [
          { name: 'Idle', animation: 'Idle', speed: 1 },
          { name: 'Run', animation: 'Run', speed: 1.5 }
        ],
        startAnimation: 'Run', animStateInitial: 'Idle'
      });
      const si = {
        id: 'sceneinit-game', name: 'SceneInit Game', dateCreated: now, lastModified: now, assets: {},
        globalGridData: {},
        scenes: [{
          id: 1, name: 'Level 1', objects: [hero(1, 'hero1')],
          gridData: {
            0: { type: 'gameStart', kind: 'condition' },
            1: { type: 'switchScene', kind: 'action', sceneId: 2 }
          },
          worldWidth: 800, worldHeight: 600, viewportWidth: 800, viewportHeight: 600, bgColor: '#ffffff'
        }, {
          id: 2, name: 'Level 2', objects: [hero(2, 'hero2')],
          gridData: {},
          worldWidth: 800, worldHeight: 600, viewportWidth: 800, viewportHeight: 600, bgColor: '#000000'
        }]
      };
      localStorage.setItem('hydraProjects', JSON.stringify([si]));
      localStorage.setItem('currentProjectId', 'sceneinit-game');
    });
    await goto(spage, `http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await spage.click('.tab[data-tab="preview-tab"]');
    await spage.waitForSelector('#game-canvas', { timeout: 10000 });
    await spage.waitForFunction(() => typeof previewState !== 'undefined' && previewState.sceneId === 2,
      null, { timeout: 10000 });
    const switchedHero = await spage.evaluate(() => {
      const o = (previewState.objects || []).find(o => o.name === 'hero2');
      return o ? { anim: o._anim && { name: o._anim.name, playing: o._anim.playing },
        sm: o._sm && o._sm.state, tweens: Array.isArray(o._tweens) ? o._tweens.length : -1,
        alive: o._alive, vel3x: o.vel3x } : null;
    });
    check('preview scene switch autoplays the play-at-start animation (initial state wins)',
      !!switchedHero && switchedHero.anim && switchedHero.anim.name === 'Idle' && switchedHero.anim.playing === true,
      JSON.stringify(switchedHero));
    check('preview scene switch enters the initial animation state',
      !!switchedHero && switchedHero.sm === 'Idle', JSON.stringify(switchedHero));
    check('preview scene switch gives fresh tween state on the new scene objects',
      !!switchedHero && switchedHero.tweens === 0 && switchedHero.alive === true && switchedHero.vel3x === 0,
      JSON.stringify(switchedHero));
    check('no page errors on the scene-init pages', sErrors.length === 0, sErrors.slice(0, 3).join(' | '));
    await sctx.close();

    // ---- Cycle 63: per-frame update order through the shared HydraFrame module (P2 item 15/12, slice 3) ----
    const frameLoaded = await page.evaluate(() => {
      const HF = window.HydraFrame;
      return !!HF && typeof HF.computeDt === 'function' &&
        typeof HF.stepFrame === 'function' && Array.isArray(HF.PHASES) &&
        typeof HF.factorySource === 'string';
    });
    check('HydraFrame module is loaded in the editor', frameLoaded);
    // Live parity check: the preview now steps through the same canonical
    // order as the export — a destroy fired by scripts is visible to later
    // scripts in the SAME frame (objectCount drops to 0 at once), and the
    // destroyed object takes no further physics steps. (The exact one-step
    // value is pinned deterministically in export-boot Phase AZ; here the
    // live check is that the fall happens once and then the position
    // freezes.)
    const fctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const fpage = await fctx.newPage();
    const fErrors = [];
    fpage.on('pageerror', e => fErrors.push(String(e && e.message || e)));
    await goto(fpage, `http://localhost:${PORT}/home.html`, { waitUntil: 'domcontentloaded' });
    await fpage.evaluate(() => {
      const now = new Date().toISOString();
      const fz = {
        id: 'frame-game', name: 'Frame Game', dateCreated: now, lastModified: now, assets: {},
        globalGridData: {
          0: { type: 'gameStart', kind: 'condition' },
          1: { type: 'setVariable', kind: 'action', varName: 'tick', operation: 'set', value: '0' },
          60: { type: 'always', kind: 'condition' },
          61: { type: 'setVariable', kind: 'action', varName: 'tick', operation: 'set', value: 'tick + 1' },
          120: { type: 'getVariable', kind: 'condition', varName: 'tick', operator: '>=', compareValue: '2' },
          121: { type: 'destroyObject', kind: 'action', targetObject: 'victim' },
          180: { type: 'objectCount', kind: 'condition', targetObject: 'victim', operator: '==', count: '0' },
          181: { type: 'setVariable', kind: 'action', varName: 'gone', operation: 'set', value: '1' }
        },
        scenes: [{
          id: 1, name: 'Main', gridData: {},
          objects: [{
            id: 1, name: 'victim', kind: 'sprite', posX: 100, posY: 100, width: 40, height: 40, color: '#ff0000',
            physicsEnabled: true, physics: { gravity: 10, friction: 1, bounciness: 0, maxSpeed: 100 }
          }],
          worldWidth: 800, worldHeight: 600, viewportWidth: 800, viewportHeight: 600, bgColor: '#000000'
        }],
        currentSceneId: 1
      };
      localStorage.setItem('hydraProjects', JSON.stringify([fz]));
      localStorage.setItem('currentProjectId', 'frame-game');
    });
    await goto(fpage, `http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await fpage.click('.tab[data-tab="preview-tab"]');
    await fpage.waitForSelector('#game-canvas', { timeout: 10000 });
    await fpage.waitForFunction(() => typeof gameVariables !== 'undefined' && gameVariables.gone === 1,
      null, { timeout: 10000 });
    const victimPosY1 = await fpage.evaluate(() => {
      const o = (previewState.objects || []).find(o => o.name === 'victim');
      return o ? o.posY : null;
    });
    check('preview destroy is visible to later scripts in the same frame (gone set, victim fell once)',
      victimPosY1 !== null && victimPosY1 > 100, `posY=${victimPosY1}`);
    await new Promise(r => setTimeout(r, 600));
    const victimPosY2 = await fpage.evaluate(() => {
      const o = (previewState.objects || []).find(o => o.name === 'victim');
      return o ? o.posY : null;
    });
    check('preview destroyed victim takes no further physics steps (position frozen)',
      victimPosY2 !== null && victimPosY2 === victimPosY1, `posY ${victimPosY1} -> ${victimPosY2}`);
    check('no page errors on the frame-order pages', fErrors.length === 0, fErrors.slice(0, 3).join(' | '));
    await fctx.close();

    // ---- Cycle 64: per-frame 2D physics step through the shared HydraPhysicsStep module (P2 item 15/12, slice 4) ----
    const stepLoaded = await page.evaluate(() => {
      const PS = window.HydraPhysicsStep;
      return !!PS && typeof PS.stepPhysics2d === 'function' &&
        typeof PS.integrateBody === 'function' &&
        typeof PS.resolveObjectCollisions === 'function' &&
        typeof PS.resolveTileCollisions === 'function' &&
        typeof PS.factorySource === 'string';
    });
    check('HydraPhysicsStep module is loaded in the editor', stepLoaded);
    // Live parity check: the preview now steps 2D physics through the same
    // shared module as the export — a falling body lands on the floor, and
    // a text object with collision enabled + gravity never falls (the
    // preview used to move it). (Exact frame-by-frame values are pinned
    // deterministically in export-boot Phase BA; here the live check is
    // that the hero settles on the floor and the label never moves. The
    // hero uses gravity 1 on purpose: with real-time frames a hitch can
    // make one step jump a gravity-10 body clean through the 20px floor —
    // pre-existing tunneling in both runtimes, not a slice regression —
    // while at gravity 1 the worst single-frame move is 3px, so the hero
    // can never tunnel and the settle check is stable.)
    const pctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const ppage = await pctx.newPage();
    const pErrors = [];
    ppage.on('pageerror', e => pErrors.push(String(e && e.message || e)));
    await goto(ppage, `http://localhost:${PORT}/home.html`, { waitUntil: 'domcontentloaded' });
    await ppage.evaluate(() => {
      const now = new Date().toISOString();
      const pz = {
        id: 'physicsstep-game', name: 'Physics Step Game', dateCreated: now, lastModified: now, assets: {},
        globalGridData: {},
        scenes: [{
          id: 1, name: 'Main', gridData: {},
          objects: [
            { id: 1, name: 'hero', kind: 'sprite', posX: 100, posY: 150, width: 40, height: 40, color: '#ff0000',
              physicsEnabled: true, physics: { gravity: 1, friction: 1, bounciness: 0, maxSpeed: 100 } },
            { id: 2, name: 'floor', kind: 'sprite', posX: 0, posY: 200, width: 800, height: 20, color: '#888888',
              static: true, physicsEnabled: false },
            { id: 3, name: 'label', kind: 'text', text: 'Hello', posX: 300, posY: 100, width: 120, height: 30, color: '#ffffff',
              physicsEnabled: true, physics: { gravity: 10, friction: 1, bounciness: 0, maxSpeed: 100 },
              collision: { enabled: true } }
          ],
          worldWidth: 800, worldHeight: 600, viewportWidth: 800, viewportHeight: 600, bgColor: '#000000'
        }],
        currentSceneId: 1
      };
      localStorage.setItem('hydraProjects', JSON.stringify([pz]));
      localStorage.setItem('currentProjectId', 'physicsstep-game');
    });
    await goto(ppage, `http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await ppage.click('.tab[data-tab="preview-tab"]');
    await ppage.waitForSelector('#game-canvas', { timeout: 10000 });
    await ppage.waitForFunction(() => {
      const o = (previewState.objects || []).find(o => o.name === 'hero');
      return o && o.posY === 160 && o.velY === 0;
    }, null, { timeout: 10000 });
    const landed = await ppage.evaluate(() => {
      const hero = (previewState.objects || []).find(o => o.name === 'hero');
      const label = (previewState.objects || []).find(o => o.name === 'label');
      return { heroY: hero ? hero.posY : null, heroVelY: hero ? hero.velY : null,
        labelY: label ? label.posY : null };
    });
    check('preview hero falls and lands on the floor through the shared step (posY 160, velY 0)',
      landed.heroY === 160 && landed.heroVelY === 0, JSON.stringify(landed));
    check('preview collision-enabled text label never falls (posY still 100)',
      landed.labelY === 100, JSON.stringify(landed));
    await new Promise(r => setTimeout(r, 600));
    const settled = await ppage.evaluate(() => {
      const hero = (previewState.objects || []).find(o => o.name === 'hero');
      const label = (previewState.objects || []).find(o => o.name === 'label');
      return { heroY: hero ? hero.posY : null, labelY: label ? label.posY : null };
    });
    check('preview landed hero stays put and label still has not moved',
      settled.heroY === 160 && settled.labelY === 100, JSON.stringify(settled));
    check('no page errors on the physics-step pages', pErrors.length === 0, pErrors.slice(0, 3).join(' | '));
    await pctx.close();

    // ---- Cycle 65: scene-load runtime state reset through the shared HydraSceneReset module (P2 item 15/12, slice 5) ----
    const srLoaded = await page.evaluate(() => {
      const SR = window.HydraSceneReset;
      return !!SR && typeof SR.resetSceneRuntime === 'function' &&
        typeof SR.factorySource === 'string';
    });
    check('HydraSceneReset module is loaded in the editor', srLoaded);
    // Live parity check: the preview now resets the run state on every
    // scene load through the same shared module as the export. Two pages
    // share one seed project — a control page (no switch) proves frame 1
    // dirties every field the reset owns, and a switch page proves the
    // deferred switch clears them all. The pause reset is pinned in
    // export-boot Phase BB instead: the preview fires gameStart chains at
    // launch, so a pauseGame in the chain would freeze frame 1's physics
    // step before the trigger contact could populate. (Exact values are
    // pinned deterministically in export-boot Phase BB; here the live
    // check is that the switch page ends clean while the control page
    // stays dirty. Scene 1's world is 1600x1200 against an 800x600
    // viewport on purpose, so the setCamera move (120, 40) survives the
    // camera clamp and the reset back to (0, 0) is observable.)
    function sceneresetSeed(withSwitch) {
      const now = new Date().toISOString();
      return {
        id: 'scenereset-game', name: 'Scene Reset Game', dateCreated: now, lastModified: now, assets: {},
        globalGridData: withSwitch ? {
          0: { type: 'gameStart', kind: 'condition' },
          1: { type: 'switchScene', kind: 'action', sceneId: 2 }
        } : {},
        scenes: [
          {
            id: 1, name: 'Scene 1',
            gridData: {
              0: { type: 'gameStart', kind: 'condition' },
              1: { type: 'setCamera', kind: 'action', cameraX: 120, cameraY: 40 },
              2: { type: 'timerControl', kind: 'action', timerName: 't1', action: 'start' },
              3: { type: 'emitBurst', kind: 'action', x: 100, y: 100, count: 10, speed: 50, lifetime: 5 },
              60: { type: 'triggerEnter', kind: 'condition', zoneObject: 'zone', targetObject: 'hero' },
              61: { type: 'setVariable', kind: 'action', varName: 'entered', operation: 'set', value: '1' }
            },
            objects: [
              { id: 1, name: 'hero', kind: 'sprite', posX: 100, posY: 100, width: 40, height: 40, color: '#ff0000',
                physicsEnabled: true, physics: { gravity: 0, friction: 1, bounciness: 0, maxSpeed: 100 } },
              { id: 2, name: 'zone', kind: 'sprite', posX: 100, posY: 100, width: 40, height: 40, color: '#00ff00',
                static: true, physicsEnabled: false, collision: { mode: 'trigger' } }
            ],
            worldWidth: 1600, worldHeight: 1200, viewportWidth: 800, viewportHeight: 600, bgColor: '#000000'
          },
          {
            id: 2, name: 'Scene 2',
            gridData: {},
            objects: [
              { id: 3, name: 'enemy', kind: 'sprite', posX: 50, posY: 50, width: 40, height: 40, color: '#0000ff' }
            ],
            worldWidth: 800, worldHeight: 600, viewportWidth: 800, viewportHeight: 600, bgColor: '#000000'
          }
        ],
        currentSceneId: 1
      };
    }
    async function openSceneresetPage(withSwitch) {
      const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
      const pg = await ctx.newPage();
      const errs = [];
      pg.on('pageerror', e => errs.push(String(e && e.message || e)));
      await goto(pg, `http://localhost:${PORT}/home.html`, { waitUntil: 'domcontentloaded' });
      await pg.evaluate((seed) => {
        localStorage.setItem('hydraProjects', JSON.stringify([seed]));
        localStorage.setItem('currentProjectId', 'scenereset-game');
      }, sceneresetSeed(withSwitch));
      await goto(pg, `http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
      await pg.click('.tab[data-tab="preview-tab"]');
      await pg.waitForSelector('#game-canvas', { timeout: 10000 });
      return { ctx, pg, errs };
    }
    // Control page: no switch — frame 1 dirties every field the reset owns.
    const cctx = await openSceneresetPage(false);
    await cctx.pg.waitForFunction(() => gameVariables.entered === 1, null, { timeout: 10000 });
    const control = await cctx.pg.evaluate(() => ({
      camera: { x: previewState.camera.x, y: previewState.camera.y, zoom: previewState.camera.zoom },
      paused: previewState.paused,
      timers: timerStates.size,
      triggerPairs: Object.keys(previewState._triggerPairs || {}),
      particles: previewState.particles ? previewState.particles.particles.length : null,
      entered: gameVariables.entered
    }));
    check('control: preview frame 1 moves the camera (120, 40), starts the timer, records the trigger',
      control.camera.x === 120 && control.camera.y === 40 && control.timers === 1 &&
      JSON.stringify(control.triggerPairs) === '["2:1"]' && control.entered === 1, JSON.stringify(control));
    check('control: preview frame 1 spawns the burst particles',
      control.particles === 10, JSON.stringify(control));
    check('no page errors on the scene-reset control page', cctx.errs.length === 0, cctx.errs.slice(0, 3).join(' | '));
    await cctx.ctx.close();
    // Switch page: the same frame 1 dirties everything, then the deferred
    // switch applies at end of frame and the shared reset clears it all.
    const srSwitchCtx = await openSceneresetPage(true);
    await srSwitchCtx.pg.waitForFunction(() => previewState.sceneId === 2, null, { timeout: 10000 });
    const srSwitched = await srSwitchCtx.pg.evaluate(() => ({
      sceneId: previewState.sceneId,
      objects: (previewState.objects || []).map(o => o.name),
      camera: { x: previewState.camera.x, y: previewState.camera.y, zoom: previewState.camera.zoom },
      paused: previewState.paused,
      timers: timerStates.size,
      triggerPairs: Object.keys(previewState._triggerPairs || {}),
      particles: previewState.particles ? previewState.particles.particles.length : null,
      entered: gameVariables.entered
    }));
    check('preview scene switch lands in scene 2 with its own objects',
      srSwitched.sceneId === 2 && JSON.stringify(srSwitched.objects) === '["enemy"]', JSON.stringify(srSwitched));
    check('preview scene switch resets the camera to (0, 0, zoom 1)',
      srSwitched.camera.x === 0 && srSwitched.camera.y === 0 && srSwitched.camera.zoom === 1, JSON.stringify(srSwitched));
    check('preview scene switch clears the timer and the trigger edge state',
      srSwitched.timers === 0 && srSwitched.triggerPairs.length === 0, JSON.stringify(srSwitched));
    check('preview scene switch leaves a fresh empty particle state',
      srSwitched.particles === 0, JSON.stringify(srSwitched));
    check('preview trigger fired in frame 1 before the reset (entered var survives the switch)',
      srSwitched.entered === 1, JSON.stringify(srSwitched));
    check('no page errors on the scene-reset switch page', srSwitchCtx.errs.length === 0, srSwitchCtx.errs.slice(0, 3).join(' | '));
    await srSwitchCtx.ctx.close();

    // ---- Cycle 66: draw passes through the shared HydraDraw module (P2 item 15/12, slice 6) ----
    const drawLoaded = await page.evaluate(() => {
      const D = window.HydraDraw;
      return !!D && typeof D.drawFrame === 'function' &&
        typeof D.drawObject === 'function' && typeof D.factorySource === 'string';
    });
    check('HydraDraw module is loaded in the editor', drawLoaded);
    // Live parity check: the preview draws the frame through the same
    // shared module as the export. One seeded page carries a hero
    // sprite, a rotated text label, a panel, a tilemap, and a HUD
    // button; the canvas pixels prove each pass actually painted.
    // (Exact draw calls are pinned deterministically in export-boot
    // Phase BC; here the live check is the painted pixels. The flash
    // from the gameStart chain has faded by the time the pixels are
    // read, and the read retries until the hero pixel lands so a
    // mid-frame read cannot flake the check.)
    function drawSeed() {
      const now = new Date().toISOString();
      const tiles = new Array(60).fill(-1);
      for (let c = 0; c < 10; c++) tiles[4 * 10 + c] = 0;
      return {
        id: 'draw-game', name: 'Draw Game', dateCreated: now, lastModified: now, assets: {},
        globalGridData: {
          0: { type: 'gameStart', kind: 'condition' },
          1: { type: 'screenFlash', kind: 'action', color: '#ff0000', intensity: 0.5, duration: 0.2 },
          2: { type: 'setVariable', kind: 'action', varName: 'flashed', operation: 'set', value: '1' }
        },
        scenes: [{
          id: 1, name: 'Main', gridData: {},
          objects: [
            { id: 1, name: 'hero', kind: 'sprite', posX: 10, posY: 20, width: 40, height: 40, color: '#ff0000' },
            { id: 2, name: 'label', kind: 'text', text: 'Hi', posX: 200, posY: 300, width: 100, height: 24, textColor: '#111111', rotation: 30 },
            { id: 3, name: 'menu', kind: 'panel', posX: 50, posY: 60, width: 200, height: 100, color: '#1e293b', cornerRadius: 12 },
            { id: 4, name: 'ground', kind: 'tilemap', posX: 0, posY: 200, width: 320, height: 192,
              tileSize: 32, cols: 10, rows: 6, tiles, tilesetAssetId: null, tilesetCols: 8, solidTiles: [0],
              static: true, physicsEnabled: false },
            { id: 5, name: 'play', kind: 'text', archetype: 'button', text: 'Play', posX: 600, posY: 20, width: 100, height: 30, hud: true }
          ],
          worldWidth: 800, worldHeight: 600, viewportWidth: 800, viewportHeight: 600, bgColor: '#000000'
        }],
        currentSceneId: 1
      };
    }
    const drawCtx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const drawPg = await drawCtx.newPage();
    const drawErrs = [];
    drawPg.on('pageerror', e => drawErrs.push(String(e && e.message || e)));
    await goto(drawPg, `http://localhost:${PORT}/home.html`, { waitUntil: 'domcontentloaded' });
    await drawPg.evaluate((seed) => {
      localStorage.setItem('hydraProjects', JSON.stringify([seed]));
      localStorage.setItem('currentProjectId', 'draw-game');
    }, drawSeed());
    await goto(drawPg, `http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await drawPg.click('.tab[data-tab="preview-tab"]');
    await drawPg.waitForSelector('#game-canvas', { timeout: 10000 });
    await drawPg.waitForFunction(() => gameVariables.flashed === 1, null, { timeout: 10000 });
    await drawPg.waitForTimeout(500);
    const px = (x, y) => drawPg.evaluate(([px, py]) => {
      const c = document.getElementById('game-canvas');
      const d = c.getContext('2d').getImageData(px, py, 1, 1).data;
      return [d[0], d[1], d[2], d[3]];
    }, [x, y]);
    let heroPx = null;
    for (let i = 0; i < 6 && !(heroPx && heroPx[0] > 200 && heroPx[1] < 50 && heroPx[2] < 50); i++) {
      heroPx = await px(30, 40);
      if (!(heroPx[0] > 200 && heroPx[1] < 50 && heroPx[2] < 50)) await drawPg.waitForTimeout(150);
    }
    const bgPx = await px(790, 590);
    const tilePx = await px(16, 344);
    const panelPx = await px(150, 110);
    const btnPx = await px(615, 28);
    check('preview paints the hero sprite red at its center',
      heroPx && heroPx[0] > 200 && heroPx[1] < 50 && heroPx[2] < 50, JSON.stringify(heroPx));
    check('preview paints the black background in the corner',
      bgPx && bgPx[0] < 20 && bgPx[1] < 20 && bgPx[2] < 20, JSON.stringify(bgPx));
    check('preview paints the tilemap solid row',
      tilePx && tilePx[0] > 150 && tilePx[1] < 120 && tilePx[2] < 120, JSON.stringify(tilePx));
    check('preview paints the panel in its color',
      panelPx && panelPx[0] >= 25 && panelPx[0] <= 35 && panelPx[1] >= 36 && panelPx[1] <= 46 &&
      panelPx[2] >= 54 && panelPx[2] <= 64, JSON.stringify(panelPx));
    check('preview paints the HUD button in the default button blue',
      btnPx && btnPx[0] >= 40 && btnPx[0] <= 80 && btnPx[1] >= 110 && btnPx[1] <= 150 && btnPx[2] > 200,
      JSON.stringify(btnPx));
    check('no page errors on the draw page', drawErrs.length === 0, drawErrs.slice(0, 3).join(' | '));
    await drawCtx.close();

    // ---- Cycle 67: script-grid dispatch through the shared HydraDispatch module (P2 item 15/12, slice 7) ----
    const dispatchLoaded = await page.evaluate(() => {
      const Dp = window.HydraDispatch;
      return !!Dp && typeof Dp.processScope === 'function' &&
        Array.isArray(Dp.DEFERRED_TYPES) && typeof Dp.factorySource === 'string';
    });
    check('HydraDispatch module is loaded in the editor', dispatchLoaded);
    // Live parity check: the preview dispatches through the same shared
    // module as the export. The seed carries an edge condition that
    // stays true (objectVisible on the hero) next to a level condition
    // (always): the edge action must fire exactly once while the level
    // action fires every frame. Before this slice the preview wiped
    // its edge memory every frame, so the edge action re-fired on
    // every frame there while firing once in exports.
    function dispatchSeed() {
      const now = new Date().toISOString();
      return {
        id: 'dispatch-game', name: 'Dispatch Game', dateCreated: now, lastModified: now, assets: {},
        globalGridData: {
          0: { type: 'gameStart', kind: 'condition' },
          1: { type: 'setVariable', kind: 'action', varName: 'started', operation: 'set', value: '1' },
          60: { type: 'always', kind: 'condition' },
          61: { type: 'setVariable', kind: 'action', varName: 'ticks', operation: 'add', value: '1' },
          120: { type: 'objectVisible', kind: 'condition', targetObject: 'hero' },
          121: { type: 'setVariable', kind: 'action', varName: 'seen', operation: 'add', value: '1' }
        },
        scenes: [{
          id: 1, name: 'Main', gridData: {},
          objects: [
            { id: 1, name: 'hero', kind: 'sprite', posX: 10, posY: 20, width: 40, height: 40, color: '#ff0000' }
          ],
          worldWidth: 800, worldHeight: 600, viewportWidth: 800, viewportHeight: 600, bgColor: '#000000'
        }],
        currentSceneId: 1
      };
    }
    const dispCtx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const dispPg = await dispCtx.newPage();
    const dispErrs = [];
    dispPg.on('pageerror', e => dispErrs.push(String(e && e.message || e)));
    await goto(dispPg, `http://localhost:${PORT}/home.html`, { waitUntil: 'domcontentloaded' });
    await dispPg.evaluate((seed) => {
      localStorage.setItem('hydraProjects', JSON.stringify([seed]));
      localStorage.setItem('currentProjectId', 'dispatch-game');
    }, dispatchSeed());
    await goto(dispPg, `http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await dispPg.click('.tab[data-tab="preview-tab"]');
    await dispPg.waitForSelector('#game-canvas', { timeout: 10000 });
    await dispPg.waitForFunction(() => gameVariables.started === 1, null, { timeout: 10000 });
    await dispPg.waitForTimeout(1000);
    const dispVars = await dispPg.evaluate(() => ({
      started: gameVariables.started, ticks: gameVariables.ticks, seen: gameVariables.seen
    }));
    check('preview edge condition fires once while it stays true (seen 1 after a second)',
      dispVars.seen === 1, JSON.stringify(dispVars));
    check('preview level condition keeps firing every frame (ticks well above 1)',
      dispVars.ticks >= 5, JSON.stringify(dispVars));
    check('no page errors on the dispatch page', dispErrs.length === 0, dispErrs.slice(0, 3).join(' | '));
    await dispCtx.close();

    // ---- Cycle 68: per-block conditions through the shared HydraConditions module (P2 item 15/12, slice 8) ----
    const conditionsLoaded = await page.evaluate(() => {
      const Cn = window.HydraConditions;
      return !!Cn && typeof Cn.evaluateCondition === 'function' &&
        typeof Cn.factorySource === 'string' &&
        Array.isArray(Cn.FROZEN_WHILE_PAUSED) && Cn.FROZEN_WHILE_PAUSED.length === 11;
    });
    check('HydraConditions module is loaded in the editor', conditionsLoaded);
    // Live parity check: the preview evaluates conditions through the same
    // shared module as the export. The seed hides the first coin (which
    // sits on the hero) on gameStart, then asks the shared module whether
    // two coins remain and whether the hero collides with one. Before this
    // slice the preview counted hidden objects, so the count read 3 and
    // the collision fired — both now match the export (2, no collision).
    function conditionsSeed() {
      const now = new Date().toISOString();
      return {
        id: 'conditions-game', name: 'Conditions Game', dateCreated: now, lastModified: now, assets: {},
        globalGridData: {
          0: { type: 'gameStart', kind: 'condition' },
          1: { type: 'setVariable', kind: 'action', varName: 'score', operation: 'set', value: '5' },
          2: { type: 'showHide', kind: 'action', targetObject: 'coin', targetMode: 'first', action: 'hide' },
          60: { type: 'objectCount', kind: 'condition', targetObject: 'coin', operator: '==', count: '2' },
          61: { type: 'setVariable', kind: 'action', varName: 'counted', operation: 'add', value: '1' },
          120: { type: 'collision', kind: 'condition', object1: 'hero', object2: 'coin' },
          121: { type: 'setVariable', kind: 'action', varName: 'collided', operation: 'add', value: '1' },
          180: { type: 'objectVisible', kind: 'condition', targetObject: 'coin' },
          181: { type: 'setVariable', kind: 'action', varName: 'visible', operation: 'add', value: '1' }
        },
        scenes: [{
          id: 1, name: 'Main', gridData: {},
          objects: [
            { id: 3, name: 'coin', kind: 'sprite', posX: 10, posY: 20, width: 40, height: 40, color: '#ffd700' },
            { id: 1, name: 'hero', kind: 'sprite', posX: 10, posY: 20, width: 40, height: 40, color: '#ff0000' },
            { id: 2, name: 'coin', kind: 'sprite', posX: 100, posY: 20, width: 40, height: 40, color: '#ffd700' },
            { id: 4, name: 'coin', kind: 'sprite', posX: 200, posY: 20, width: 40, height: 40, color: '#ffd700' }
          ],
          worldWidth: 800, worldHeight: 600, viewportWidth: 800, viewportHeight: 600, bgColor: '#000000'
        }],
        currentSceneId: 1
      };
    }
    const condCtx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const condPg = await condCtx.newPage();
    const condErrs = [];
    condPg.on('pageerror', e => condErrs.push(String(e && e.message || e)));
    await goto(condPg, `http://localhost:${PORT}/home.html`, { waitUntil: 'domcontentloaded' });
    await condPg.evaluate((seed) => {
      localStorage.setItem('hydraProjects', JSON.stringify([seed]));
      localStorage.setItem('currentProjectId', 'conditions-game');
    }, conditionsSeed());
    await goto(condPg, `http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await condPg.click('.tab[data-tab="preview-tab"]');
    await condPg.waitForSelector('#game-canvas', { timeout: 10000 });
    await condPg.waitForFunction(() => gameVariables.score === 5, null, { timeout: 10000 });
    await condPg.waitForTimeout(1000);
    const condVars = await condPg.evaluate(() => ({
      score: gameVariables.score, counted: gameVariables.counted,
      collided: gameVariables.collided, visible: gameVariables.visible
    }));
    check('preview objectCount excludes the hidden coin (counted 1 after a second)',
      condVars.counted === 1, JSON.stringify(condVars));
    check('preview collision never fires with the only overlapping coin hidden',
      condVars.collided === undefined, JSON.stringify(condVars));
    check('preview objectVisible fires once for the remaining visible coins',
      condVars.visible === 1, JSON.stringify(condVars));
    check('no page errors on the conditions page', condErrs.length === 0, condErrs.slice(0, 3).join(' | '));
    await condCtx.close();

    // ---- Cycle 69: per-block actions through the shared HydraExecute module (P2 item 15/12, slice 9) ----
    const executeLoaded = await page.evaluate(() => {
      const Ex = window.HydraExecute;
      return !!Ex && typeof Ex.executeAction === 'function' &&
        typeof Ex.factorySource === 'string';
    });
    check('HydraExecute module is loaded in the editor', executeLoaded);
    // Live parity check: the preview runs actions through the same shared
    // module as the export. The seed stops the hero with a bare Stop
    // Object block, separates the overlapping hero/coin pair, hides the
    // ghost and tries to move it (a hidden object must ignore the move),
    // then pushes the menu scene and pops back. Before this slice the
    // preview's bare Stop Object stopped nothing, the preview had no
    // push/pop scene actions at all, and hidden objects still moved.
    function executeSeed() {
      const now = new Date().toISOString();
      return {
        id: 'execute-game', name: 'Execute Game', dateCreated: now, lastModified: now, assets: {},
        globalGridData: {
          0: { type: 'gameStart', kind: 'condition' },
          1: { type: 'setVariable', kind: 'action', varName: 'score', operation: 'set', value: '5' },
          2: { type: 'setVelocity', kind: 'action', targetObject: 'hero', velX: '30', velY: '40' },
          3: { type: 'stopObject', kind: 'action', targetObject: 'hero' },
          4: { type: 'setVariable', kind: 'action', varName: 'stopped', operation: 'set', value: '1' },
          5: { type: 'separateObjects', kind: 'action', object1: 'hero', object2: 'coin' },
          6: { type: 'setVariable', kind: 'action', varName: 'separated', operation: 'set', value: '1' },
          7: { type: 'showHide', kind: 'action', targetObject: 'ghost', targetMode: 'first', action: 'hide' },
          8: { type: 'setVelocity', kind: 'action', targetObject: 'ghost', velX: '50', velY: '0' },
          9: { type: 'showHide', kind: 'action', targetObject: 'ghost', targetMode: 'first', action: 'show' },
          10: { type: 'pushScene', kind: 'action', sceneId: 2 },
          11: { type: 'setVariable', kind: 'action', varName: 'pushed', operation: 'set', value: '1' },
          60: { type: 'objectCount', kind: 'condition', targetObject: 'menuSign', operator: '==', count: '1' },
          61: { type: 'popScene', kind: 'action' },
          62: { type: 'setVariable', kind: 'action', varName: 'popped', operation: 'add', value: '1' },
          120: { type: 'positionCheck', kind: 'condition', targetObject: 'hero', property: 'posX', operator: '==', value: '-30' },
          121: { type: 'setVariable', kind: 'action', varName: 'moved', operation: 'add', value: '1' },
          180: { type: 'velocityCheck', kind: 'condition', targetObject: 'ghost', component: 'x', operator: '==', value: '0' },
          181: { type: 'setVariable', kind: 'action', varName: 'ghostStill', operation: 'add', value: '1' }
        },
        scenes: [
          {
            id: 1, name: 'Main', gridData: {},
            objects: [
              { id: 1, name: 'hero', kind: 'sprite', posX: -10, posY: 20, width: 40, height: 40, color: '#ff0000' },
              { id: 2, name: 'coin', kind: 'sprite', posX: 10, posY: 20, width: 40, height: 40, color: '#ffd700' },
              { id: 4, name: 'ghost', kind: 'sprite', posX: 300, posY: 20, width: 40, height: 40, color: '#888888' }
            ],
            worldWidth: 800, worldHeight: 600, viewportWidth: 800, viewportHeight: 600, bgColor: '#000000'
          },
          {
            id: 2, name: 'Menu', gridData: {},
            objects: [
              { id: 9, name: 'menuSign', kind: 'sprite', posX: 50, posY: 50, width: 100, height: 40, color: '#0000ff' }
            ],
            worldWidth: 800, worldHeight: 600, viewportWidth: 800, viewportHeight: 600, bgColor: '#111111'
          }
        ],
        currentSceneId: 1
      };
    }
    const execCtx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const execPg = await execCtx.newPage();
    const execErrs = [];
    execPg.on('pageerror', e => execErrs.push(String(e && e.message || e)));
    await goto(execPg, `http://localhost:${PORT}/home.html`, { waitUntil: 'domcontentloaded' });
    await execPg.evaluate((seed) => {
      localStorage.setItem('hydraProjects', JSON.stringify([seed]));
      localStorage.setItem('currentProjectId', 'execute-game');
    }, executeSeed());
    await goto(execPg, `http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await execPg.click('.tab[data-tab="preview-tab"]');
    await execPg.waitForSelector('#game-canvas', { timeout: 10000 });
    await execPg.waitForFunction(() => gameVariables.score === 5, null, { timeout: 10000 });
    await execPg.waitForFunction(() => (gameVariables.popped || 0) >= 1, null, { timeout: 10000 });
    await execPg.waitForTimeout(1000);
    const execVars = await execPg.evaluate(() => ({
      score: gameVariables.score, stopped: gameVariables.stopped,
      separated: gameVariables.separated, pushed: gameVariables.pushed,
      popped: gameVariables.popped, moved: gameVariables.moved,
      ghostStill: gameVariables.ghostStill
    }));
    check('preview gameStart action chain runs through the shared module (stopped, separated, pushed set)',
      execVars.stopped === 1 && execVars.separated === 1 && execVars.pushed === 1, JSON.stringify(execVars));
    check('preview separateObjects moves the hero to -30 (moved fires)',
      (execVars.moved || 0) >= 1, JSON.stringify(execVars));
    check('preview hidden ghost ignores setVelocity (ghostStill fires at velX 0)',
      (execVars.ghostStill || 0) >= 1, JSON.stringify(execVars));
    check('preview pushScene/popScene round-trips back to the main scene (popped fires)',
      (execVars.popped || 0) >= 1, JSON.stringify(execVars));
    check('no page errors on the execute page', execErrs.length === 0, execErrs.slice(0, 3).join(' | '));
    await execCtx.close();

    // ---- Cycle 71: preview input host through HydraPreviewRuntime (P2 item 14, slice 6) ----
    const runtimeLoaded = await page.evaluate(() => {
      const R = window.HydraPreviewRuntime;
      return !!R && typeof R.createInputState === 'function' &&
        typeof R.attachKeyboardInput === 'function' &&
        typeof R.attachCanvasInput === 'function' &&
        typeof R.pollGamepad === 'function' &&
        typeof R.factorySource === 'string';
    });
    check('HydraPreviewRuntime module is loaded in the editor', runtimeLoaded);
    // Live check: keyboard and mouse input reach the preview through the
    // module. The seed holds ArrowRight to count held frames, taps it once
    // for the just-pressed edge, and clicks the canvas for the mouse
    // just-pressed edge. Before this slice the key listeners, the canvas
    // handlers, and the edge sets lived inline in script.js.
    function inputSeed() {
      const now = new Date().toISOString();
      return {
        id: 'input-game', name: 'Input Game', dateCreated: now, lastModified: now, assets: {},
        globalGridData: {
          0: { type: 'gameStart', kind: 'condition' },
          1: { type: 'setVariable', kind: 'action', varName: 'started', operation: 'set', value: '1' },
          60: { type: 'keyPressed', kind: 'condition', key: 'ArrowRight' },
          61: { type: 'setVariable', kind: 'action', varName: 'moved', operation: 'add', value: '1' },
          120: { type: 'keyJustPressed', kind: 'condition', key: 'ArrowRight' },
          121: { type: 'setVariable', kind: 'action', varName: 'tapped', operation: 'add', value: '1' },
          180: { type: 'mouseClick', kind: 'condition', mouseCondition: 'mouseButtonJustPressed', button: 'left' },
          181: { type: 'setVariable', kind: 'action', varName: 'clicked', operation: 'add', value: '1' }
        },
        scenes: [{
          id: 1, name: 'Main', gridData: {},
          objects: [
            { id: 1, name: 'hero', kind: 'sprite', posX: 10, posY: 20, width: 40, height: 40, color: '#ff0000' }
          ],
          worldWidth: 800, worldHeight: 600, viewportWidth: 800, viewportHeight: 600, bgColor: '#000000'
        }],
        currentSceneId: 1
      };
    }
    const inputCtx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const inputPg = await inputCtx.newPage();
    const inputErrs = [];
    inputPg.on('pageerror', e => inputErrs.push(String(e && e.message || e)));
    await goto(inputPg, `http://localhost:${PORT}/home.html`, { waitUntil: 'domcontentloaded' });
    await inputPg.evaluate((seed) => {
      localStorage.setItem('hydraProjects', JSON.stringify([seed]));
      localStorage.setItem('currentProjectId', 'input-game');
    }, inputSeed());
    await goto(inputPg, `http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await inputPg.click('.tab[data-tab="preview-tab"]');
    await inputPg.waitForSelector('#game-canvas', { timeout: 10000 });
    await inputPg.waitForFunction(() => gameVariables.started === 1, null, { timeout: 10000 });
    await inputPg.keyboard.down('ArrowRight');
    await inputPg.waitForTimeout(500);
    await inputPg.keyboard.up('ArrowRight');
    const inputVars = await inputPg.evaluate(() => ({
      moved: gameVariables.moved, tapped: gameVariables.tapped
    }));
    check('held ArrowRight counts frames through the module key listener (moved well above 1)',
      (inputVars.moved || 0) >= 5, JSON.stringify(inputVars));
    check('ArrowRight just-pressed fires exactly once per press (tapped 1)',
      inputVars.tapped === 1, JSON.stringify(inputVars));
    const canvasBox = await inputPg.locator('#game-canvas').boundingBox();
    await inputPg.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
    await inputPg.waitForFunction(() => (gameVariables.clicked || 0) >= 1, null, { timeout: 10000 });
    const clickedVars = await inputPg.evaluate(() => ({ clicked: gameVariables.clicked }));
    check('canvas click fires the mouse just-pressed edge (clicked 1)',
      clickedVars.clicked === 1, JSON.stringify(clickedVars));
    check('no page errors on the input page', inputErrs.length === 0, inputErrs.slice(0, 3).join(' | '));
    await inputCtx.close();

    // ---- Cycle 72: preview script-grid dispatch host through HydraPreviewRuntime (P2 item 14, slice 7) ----
    const previewDispatchLoaded = await page.evaluate(() => {
      const R = window.HydraPreviewRuntime;
      return !!R && typeof R.processScriptGrid === 'function' &&
        typeof R.dispatchHooks === 'function' &&
        typeof R.conditionCtx === 'function' &&
        typeof R.actionCtx === 'function' &&
        typeof R.evaluateCondition === 'function' &&
        typeof R.executeAction === 'function' &&
        typeof R.resetFrameConditionContexts === 'function' &&
        typeof R.processGameStartConditions === 'function' &&
        typeof R.getAlivePreviewObjects === 'function';
    });
    check('HydraPreviewRuntime dispatch surface is live in the editor', previewDispatchLoaded);
    // Live check: the whole dispatch path runs through the module. The
    // seed fires gameStart once, ticks every frame off `always`, and
    // fires the objectVisible edge once for the visible hero. Before
    // this slice processScriptGrid, dispatchHooks, the two context
    // builders, and the subsystem hook builders lived inline in script.js.
    function dispatchSeed() {
      const now = new Date().toISOString();
      return {
        id: 'dispatch-game', name: 'Dispatch Game', dateCreated: now, lastModified: now, assets: {},
        globalGridData: {
          0: { type: 'gameStart', kind: 'condition' },
          1: { type: 'setVariable', kind: 'action', varName: 'started', operation: 'set', value: '1' },
          60: { type: 'always', kind: 'condition' },
          61: { type: 'setVariable', kind: 'action', varName: 'ticks', operation: 'add', value: '1' },
          120: { type: 'objectVisible', kind: 'condition', targetObject: 'hero' },
          121: { type: 'setVariable', kind: 'action', varName: 'seen', operation: 'add', value: '1' }
        },
        scenes: [{
          id: 1, name: 'Main', gridData: {},
          objects: [
            { id: 1, name: 'hero', kind: 'sprite', posX: 10, posY: 20, width: 40, height: 40, color: '#ff0000' }
          ],
          worldWidth: 800, worldHeight: 600, viewportWidth: 800, viewportHeight: 600, bgColor: '#000000'
        }],
        currentSceneId: 1
      };
    }
    const dispatchCtx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const dispatchPg = await dispatchCtx.newPage();
    const dispatchErrs = [];
    dispatchPg.on('pageerror', e => dispatchErrs.push(String(e && e.message || e)));
    await goto(dispatchPg, `http://localhost:${PORT}/home.html`, { waitUntil: 'domcontentloaded' });
    await dispatchPg.evaluate((seed) => {
      localStorage.setItem('hydraProjects', JSON.stringify([seed]));
      localStorage.setItem('currentProjectId', 'dispatch-game');
    }, dispatchSeed());
    await goto(dispatchPg, `http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await dispatchPg.click('.tab[data-tab="preview-tab"]');
    await dispatchPg.waitForSelector('#game-canvas', { timeout: 10000 });
    await dispatchPg.waitForFunction(() => gameVariables.started === 1, null, { timeout: 10000 });
    await dispatchPg.waitForFunction(() => (gameVariables.ticks || 0) >= 5, null, { timeout: 10000 });
    await dispatchPg.waitForTimeout(1000);
    const dispatchVars = await dispatchPg.evaluate(() => ({
      started: gameVariables.started, ticks: gameVariables.ticks, seen: gameVariables.seen
    }));
    check('preview gameStart fires once through the module dispatch host (started 1)',
      dispatchVars.started === 1, JSON.stringify(dispatchVars));
    check('preview `always` keeps counting every frame through the module dispatch host (ticks well above 5)',
      (dispatchVars.ticks || 0) > 5, JSON.stringify(dispatchVars));
    check('preview objectVisible edge fires exactly once while the level keeps counting (seen 1)',
      dispatchVars.seen === 1, JSON.stringify(dispatchVars));
    check('no page errors on the dispatch page', dispatchErrs.length === 0, dispatchErrs.slice(0, 3).join(' | '));

    // ---- Cycle 73: frame loop + run lifecycle through HydraPreviewRuntime (P2 item 14, slice 8) ----
    const previewLoopLoaded = await dispatchPg.evaluate(() => {
      const R = window.HydraPreviewRuntime;
      return !!R && typeof R.gameLoop === 'function' &&
        typeof R.launchPreview === 'function' &&
        typeof R.loadPreviewScene === 'function' &&
        typeof R.resetGame === 'function' &&
        typeof R.startGame === 'function' &&
        typeof R.stopPreviewLoop === 'function' &&
        typeof R.startRenderLoop === 'function' &&
        typeof R.initGame === 'function' &&
        typeof R.updateCameraFollow === 'function' &&
        typeof R.switchPreviewScene === 'function';
    });
    check('HydraPreviewRuntime run loop surface is live in the editor', previewLoopLoaded);
    // Live check: the whole run lifecycle runs through the module. Restart
    // the seeded dispatch project through the toolbar button: the run
    // resets (gameStart fires again, the level counter restarts and
    // climbs again) with no page errors. Before this slice gameLoop,
    // launchPreview, loadPreviewScene, and resetGame lived inline in
    // script.js.
    await dispatchPg.click('#preview-restart-btn');
    await dispatchPg.waitForFunction(() => (gameVariables.ticks || 0) >= 5, null, { timeout: 10000 });
    const restartVars = await dispatchPg.evaluate(() => ({
      started: gameVariables.started, ticks: gameVariables.ticks, seen: gameVariables.seen
    }));
    check('preview restart through the module run lifecycle re-fires gameStart (started 1)',
      restartVars.started === 1, JSON.stringify(restartVars));
    check('preview restart through the module run lifecycle restarts the level counter (ticks climbing again)',
      (restartVars.ticks || 0) >= 5, JSON.stringify(restartVars));
    check('no page errors on the dispatch page after restart', dispatchErrs.length === 0, dispatchErrs.slice(0, 3).join(' | '));
    await dispatchCtx.close();

    // ---- P4 item 28: particle blocks in the palette with working panels ----
    // (Selecting the game-paused cell swapped the side panel to the property
    // panel; go back to the block palette first.)
    await page.click('#back-to-blocks-btn');
    await page.waitForSelector('.block-selector .block-option[data-block-type="emit-burst"]:visible',
      { timeout: 5000 }).catch(() => {});
    check('Particles category appears in the block palette', paletteLabels.includes('Particles'),
      paletteLabels.join(' | '));
    const particleBlockOptions = await page.evaluate(() =>
      ['emit-burst', 'start-emitter', 'stop-emitter', 'clear-particles'].map(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('particle blocks are in the palette (Emit Burst / Start Emitter / Stop Emitter / Clear Particles)',
      particleBlockOptions.every(Boolean), JSON.stringify(particleBlockOptions));
    // Place Emit Burst on the grid, then check its property panel has a Preset picker.
    const burstBefore = await page.locator('#grid [data-block-type="emit-burst"]').count();
    await page.click('.block-selector .block-option[data-block-type="emit-burst"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="emit-burst"]').length > n,
      burstBefore, { timeout: 5000 }).catch(() => {});
    const burstCell = page.locator('#grid [data-block-type="emit-burst"]').first();
    check('Emit Burst block places on the grid', await burstCell.count() === 1);
    await burstCell.click();
    const burstPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Emit Burst property panel offers a Preset picker', /Preset/i.test(burstPropText),
      burstPropText.slice(0, 200));
    check('Emit Burst property panel offers particle fields (Count, Speed, Lifetime)',
      /Count/i.test(burstPropText) && /Speed/i.test(burstPropText) && /Lifetime/i.test(burstPropText),
      burstPropText.slice(0, 300));
    // Back to the palette; place Start Emitter and check its Emitter name field.
    await page.click('#back-to-blocks-btn');
    await page.waitForSelector('.block-selector .block-option[data-block-type="start-emitter"]:visible',
      { timeout: 5000 }).catch(() => {});
    const emitterBefore = await page.locator('#grid [data-block-type="start-emitter"]').count();
    await page.click('.block-selector .block-option[data-block-type="start-emitter"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="start-emitter"]').length > n,
      emitterBefore, { timeout: 5000 }).catch(() => {});
    const emitterCell = page.locator('#grid [data-block-type="start-emitter"]').first();
    check('Start Emitter block places on the grid', await emitterCell.count() === 1);
    await emitterCell.click();
    const emitterPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Start Emitter property panel offers Emitter name + Follow object fields',
      /Emitter name/i.test(emitterPropText) && /Follow object/i.test(emitterPropText),
      emitterPropText.slice(0, 300));
    // The shared particle module is loaded in the editor page.
    const hydraParticlesLoaded = await page.evaluate(() =>
      !!window.HydraParticles && typeof window.HydraParticles.burst === 'function');
    check('HydraParticles module is loaded in the editor', hydraParticlesLoaded);

    // ---- P4 item 29: action-based input — Inputs tab, action blocks ----
    const hydraActionsLoaded = await page.evaluate(() =>
      !!window.HydraActions && typeof window.HydraActions.update === 'function');
    check('HydraActions module is loaded in the editor', hydraActionsLoaded);
    // Inputs inspector tab: add an action, rename it, capture a key.
    // (The inspector tabs live in the Scene tab's side panel.)
    await page.click('.tab[data-tab="scene-tab"]');
    const inputsTab = page.locator('.inspector-tab[data-inspector-tab="inputs"]');
    check('Inputs inspector tab exists', await inputsTab.count() === 1);
    await inputsTab.click();
    const inputsPanel = page.locator('.inspector-panel[data-inspector-panel="inputs"]');
    check('Inputs panel shows after clicking the tab', await inputsPanel.isVisible());
    await page.click('#input-action-add-btn');
    const actionRow = page.locator('#input-action-list .input-action-row').first();
    await actionRow.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    check('Add action creates an action row', await page.locator('#input-action-list .input-action-row').count() === 1);
    await actionRow.locator('.input-action-name').fill('Jump');
    // Key capture: click the first key button, press Space, label updates.
    await actionRow.locator('.input-action-keybtn').first().click();
    await page.keyboard.press('Space');
    const keyLabel = await actionRow.locator('.input-action-keybtn').first().innerText();
    check('key capture binds the pressed key', /Space/.test(keyLabel), keyLabel);
    // The wand button adds the platformer preset set.
    await page.click('#input-action-preset-btn');
    const actionNames = await page.evaluate(() =>
      [...document.querySelectorAll('#input-action-list .input-action-name')].map(i => i.value));
    check('platformer preset adds Move Left / Move Right / Jump / Shoot / Interact',
      ['Move Left', 'Move Right', 'Jump', 'Shoot', 'Interact'].every(n => actionNames.includes(n)),
      actionNames.join(', '));
    // Action blocks in the palette; Action Input places and its panel lists actions.
    // (Back to the Logic tab for the block palette. Returning to the tab
    // resets the side panel to the palette; the back button only shows when
    // a cell's property panel is open.)
    await page.click('.tab[data-tab="script-tab"]');
    await page.waitForSelector('#grid', { timeout: 10000 });
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    await page.waitForSelector('.block-selector .block-option[data-block-type="action-input-condition"]:visible',
      { timeout: 5000 }).catch(() => {});
    const actionBlockOptions = await page.evaluate(() =>
      ['action-input-condition', 'remap-action', 'reset-action-bindings'].map(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('action blocks are in the palette (Action Input / Remap Action / Reset Action Bindings)',
      actionBlockOptions.every(Boolean), JSON.stringify(actionBlockOptions));
    const actionCellBefore = await page.locator('#grid [data-block-type="action-input-condition"]').count();
    await page.click('.block-selector .block-option[data-block-type="action-input-condition"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="action-input-condition"]').length > n,
      actionCellBefore, { timeout: 5000 }).catch(() => {});
    const actionCell = page.locator('#grid [data-block-type="action-input-condition"]').first();
    check('Action Input block places on the grid', await actionCell.count() === 1);
    await actionCell.click();
    const actionPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Action Input property panel offers Action + When fields',
      /Action/i.test(actionPropText) && /When/i.test(actionPropText),
      actionPropText.slice(0, 300));
    const actionOptions = await page.evaluate(() =>
      [...document.querySelectorAll('#properties-panel select')].flatMap(s =>
        [...s.options].map(o => o.textContent.trim())));
    check('Action select lists the defined actions (Jump, Move Left)',
      actionOptions.includes('Jump') && actionOptions.includes('Move Left'),
      actionOptions.slice(0, 10).join(', '));

    // ---- P4 item 30: audio buses — Audio tab, bus blocks, Play Sound fields ----
    const hydraAudioBusesLoaded = await page.evaluate(() =>
      !!window.HydraAudioBuses && typeof window.HydraAudioBuses.normalizeBuses === 'function');
    check('HydraAudioBuses module is loaded in the editor', hydraAudioBusesLoaded);
    // Audio inspector tab: three buses with a volume slider and mute toggle each.
    await page.click('.tab[data-tab="scene-tab"]');
    const audioTab = page.locator('.inspector-tab[data-inspector-tab="audio"]');
    check('Audio inspector tab exists', await audioTab.count() === 1);
    await audioTab.click();
    const audioPanel = page.locator('.inspector-panel[data-inspector-panel="audio"]');
    check('Audio panel shows after clicking the tab', await audioPanel.isVisible());
    const busNames = await page.evaluate(() =>
      [...document.querySelectorAll('#audio-bus-list .audio-bus-name')].map(e => e.textContent));
    check('Audio tab lists the Music / SFX / UI buses',
      ['Music', 'SFX', 'UI'].every(n => busNames.includes(n)), busNames.join(', '));
    check('each bus has a volume slider and a mute button (plus the master slider)',
      await page.locator('#audio-bus-list .audio-bus-slider').count() === 4 &&
      await page.locator('#audio-bus-list .audio-bus-mute').count() === 3);
    // P4 item 37 batch 3: the master fader row scales every bus at once.
    const masterNames = await page.evaluate(() =>
      [...document.querySelectorAll('#audio-bus-list .audio-bus-row.audio-bus-master .audio-bus-name')]
        .map(e => e.textContent));
    check('Audio tab has a Master fader row', masterNames.includes('Master'), masterNames.join(', '));
    await page.evaluate(() => {
      const slider = document.querySelector('#audio-bus-list .audio-bus-row.audio-bus-master .audio-bus-slider');
      slider.value = '50';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const masterVol = await page.evaluate(() =>
      window.projectManager?.getCurrentProject?.()?.masterVolume);
    check('Master slider writes project.masterVolume', masterVol === 0.5, `masterVolume=${masterVol}`);
    await page.evaluate(() => {
      const slider = document.querySelector('#audio-bus-list .audio-bus-row.audio-bus-master .audio-bus-slider');
      slider.value = '100';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // Mute toggle flips the bus readout.
    await page.locator('#audio-bus-list .audio-bus-row:not(.audio-bus-master)').first().locator('.audio-bus-mute').click();
    const firstPct = await page.locator('#audio-bus-list .audio-bus-row:not(.audio-bus-master)').first().locator('.audio-bus-pct').innerText();
    check('mute toggle marks the bus Muted', /Muted/.test(firstPct), firstPct);
    await page.locator('#audio-bus-list .audio-bus-row:not(.audio-bus-master)').first().locator('.audio-bus-mute').click();
    // Audio blocks in the palette.
    await page.click('.tab[data-tab="script-tab"]');
    await page.waitForSelector('#grid', { timeout: 10000 });
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    await page.waitForSelector('.block-selector .block-option[data-block-type="set-bus-volume"]:visible',
      { timeout: 5000 }).catch(() => {});
    const busBlockOptions = await page.evaluate(() =>
      ['set-bus-volume', 'set-bus-muted', 'stop-music'].map(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('audio blocks are in the palette (Set Bus Volume / Set Bus Muted / Stop Music)',
      busBlockOptions.every(Boolean), JSON.stringify(busBlockOptions));
    // Set Bus Volume places and its panel offers Bus + Volume fields.
    const busCellBefore = await page.locator('#grid [data-block-type="set-bus-volume"]').count();
    await page.click('.block-selector .block-option[data-block-type="set-bus-volume"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-bus-volume"]').length > n,
      busCellBefore, { timeout: 5000 }).catch(() => {});
    const busCell = page.locator('#grid [data-block-type="set-bus-volume"]').first();
    check('Set Bus Volume block places on the grid', await busCell.count() === 1);
    await busCell.click();
    const busPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Set Bus Volume panel offers Bus + Volume fields',
      /Bus/i.test(busPropText) && /Volume/i.test(busPropText), busPropText.slice(0, 300));
    // Play Sound panel gained Bus + Pitch; the Music bus shows the Loop field.
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const sndCellBefore = await page.locator('#grid [data-block-type="play-sound"]').count();
    await page.click('.block-selector .block-option[data-block-type="play-sound"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="play-sound"]').length > n,
      sndCellBefore, { timeout: 5000 }).catch(() => {});
    const sndCell = page.locator('#grid [data-block-type="play-sound"]').first();
    check('Play Sound block places on the grid', await sndCell.count() === 1);
    await sndCell.click();
    const sndPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Play Sound panel offers Bus + Pitch fields',
      /Bus/i.test(sndPropText) && /Pitch/i.test(sndPropText), sndPropText.slice(0, 300));
    await page.locator('.property-group:has(label:text-is("Bus:")) select').selectOption('music');
    const sndPropText2 = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Music bus shows the Loop field', /Loop/i.test(sndPropText2), sndPropText2.slice(0, 300));

    // ---- P4 item 37 (block expansion, batch 3: audio control) ----
    // Pause / Resume Music, Stop All Sounds, Set Master Volume, Music Playing.
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    await page.waitForSelector('.block-selector .block-option[data-block-type="pause-music"]:visible',
      { timeout: 5000 }).catch(() => {});
    const audioCtlOptions = await page.evaluate(() =>
      ['pause-music', 'resume-music', 'stop-all-sounds', 'set-master-volume', 'music-playing'].map(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('audio-control blocks are in the palette (Pause/Resume/Stop All/Master/Music Playing)',
      audioCtlOptions.every(Boolean), JSON.stringify(audioCtlOptions));
    // Pause Music places on the grid.
    const pauseCellBefore = await page.locator('#grid [data-block-type="pause-music"]').count();
    await page.click('.block-selector .block-option[data-block-type="pause-music"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="pause-music"]').length > n,
      pauseCellBefore, { timeout: 5000 }).catch(() => {});
    check('Pause Music block places on the grid',
      await page.locator('#grid [data-block-type="pause-music"]').count() === pauseCellBefore + 1);
    // Music Playing places and its panel offers the Invert field.
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const mpCellBefore = await page.locator('#grid [data-block-type="music-playing"]').count();
    await page.click('.block-selector .block-option[data-block-type="music-playing"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="music-playing"]').length > n,
      mpCellBefore, { timeout: 5000 }).catch(() => {});
    const mpCell = page.locator('#grid [data-block-type="music-playing"]').first();
    check('Music Playing block places on the grid', await mpCell.count() === 1);
    await mpCell.click();
    const mpPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Music Playing panel offers the Invert field',
      /Invert/i.test(mpPropText), mpPropText.slice(0, 300));
    // ---- P2 item 14/11 (block catalog field-control schema) ----
    // The shipped catalog conforms to its own schema in the live editor,
    // and the fixed drift is visible: a fresh Music Playing block carries
    // a real reversed: false default instead of falling back to ''.
    const catalogLive = await page.evaluate(() => ({
      findings: window.HydraBlockCatalog.validateCatalog(),
      musicReversed: window.HydraBlockCatalog.findBlock('music-playing')?.defaults?.reversed,
      controls: Object.keys(window.HydraBlockCatalog.FIELD_CONTROLS),
    }));
    check('catalog: validateCatalog() is clean in the live editor',
      Array.isArray(catalogLive.findings) && catalogLive.findings.length === 0,
      JSON.stringify(catalogLive.findings));
    check('catalog: music-playing defaults carry reversed: false live',
      catalogLive.musicReversed === false, JSON.stringify(catalogLive));
    check('catalog: FIELD_CONTROLS carries the v4 six + v3 five + the function picker live',
      catalogLive.controls.length === 12 &&
      ['text', 'textarea', 'select', 'expr', 'object', 'color',
       'number', 'checkbox', 'action', 'scene', 'audio', 'function'].every(c => catalogLive.controls.includes(c)),
      catalogLive.controls.join(', '));
    // Set Master Volume places and its panel offers the Volume field.
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const mvCellBefore = await page.locator('#grid [data-block-type="set-master-volume"]').count();
    await page.click('.block-selector .block-option[data-block-type="set-master-volume"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-master-volume"]').length > n,
      mvCellBefore, { timeout: 5000 }).catch(() => {});
    const mvCell = page.locator('#grid [data-block-type="set-master-volume"]').first();
    check('Set Master Volume block places on the grid', await mvCell.count() === 1);
    await mvCell.click();
    const mvPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Set Master Volume panel offers the Volume field',
      /Volume/i.test(mvPropText), mvPropText.slice(0, 300));

    // ---- P4 item 37 (block expansion, batch 4: scene management) ----
    // Push Scene, Pop Scene, Set Scene Background.
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    await page.waitForSelector('.block-selector .block-option[data-block-type="push-scene"]:visible',
      { timeout: 5000 }).catch(() => {});
    const sceneMgmtOptions = await page.evaluate(() =>
      ['push-scene', 'pop-scene', 'set-scene-background'].map(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('scene-management blocks are in the palette (Push/Pop/Set Scene Background)',
      sceneMgmtOptions.every(Boolean), JSON.stringify(sceneMgmtOptions));
    // Push Scene places on the grid and its panel offers a scene picker.
    const pushCellBefore = await page.locator('#grid [data-block-type="push-scene"]').count();
    await page.click('.block-selector .block-option[data-block-type="push-scene"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="push-scene"]').length > n,
      pushCellBefore, { timeout: 5000 }).catch(() => {});
    const pushCell = page.locator('#grid [data-block-type="push-scene"]').first();
    check('Push Scene block places on the grid', await pushCell.count() === 1);
    await pushCell.click();
    const pushPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    const pushSceneOpts = await page.evaluate(() =>
      [...document.querySelectorAll('#properties-panel select')].map(s =>
        [...s.options].map(o => o.textContent)));
    check('Push Scene panel offers a scene picker',
      /Scene to show/i.test(pushPropText) && pushSceneOpts.flat().length >= 1,
      pushPropText.slice(0, 300));
    // Pop Scene places on the grid.
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const popCellBefore = await page.locator('#grid [data-block-type="pop-scene"]').count();
    await page.click('.block-selector .block-option[data-block-type="pop-scene"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="pop-scene"]').length > n,
      popCellBefore, { timeout: 5000 }).catch(() => {});
    check('Pop Scene block places on the grid',
      await page.locator('#grid [data-block-type="pop-scene"]').count() === popCellBefore + 1);
    // Set Scene Background places and its panel offers a color picker.
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const sbgCellBefore = await page.locator('#grid [data-block-type="set-scene-background"]').count();
    await page.click('.block-selector .block-option[data-block-type="set-scene-background"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-scene-background"]').length > n,
      sbgCellBefore, { timeout: 5000 }).catch(() => {});
    const sbgCell = page.locator('#grid [data-block-type="set-scene-background"]').first();
    check('Set Scene Background block places on the grid', await sbgCell.count() === 1);
    await sbgCell.click();
    const sbgPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    const sbgColorPicker = await page.evaluate(() =>
      !!document.querySelector('#properties-panel input[type="color"]'));
    check('Set Scene Background panel offers a color picker',
      /Background color/i.test(sbgPropText) && sbgColorPicker, sbgPropText.slice(0, 300));

    // ---- P4 item 37 (block expansion, batch 5: camera) ----
    // Move Camera, Center Camera On, Follow Object, Stop Camera Follow,
    // Reset Camera, Set Camera Zoom, Camera Position.
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    await page.waitForSelector('.block-selector .block-option[data-block-type="move-camera"]:visible',
      { timeout: 5000 }).catch(() => {});
    const cameraOptions = await page.evaluate(() =>
      ['move-camera', 'center-camera-on', 'follow-object', 'stop-camera-follow',
       'reset-camera', 'set-camera-zoom', 'camera-position'].map(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('camera blocks are in the palette (Move/Center/Follow/Stop/Reset/Zoom/Position)',
      cameraOptions.every(Boolean), JSON.stringify(cameraOptions));
    // Move Camera places on the grid and its panel offers X/Y fields.
    const mcCellBefore = await page.locator('#grid [data-block-type="move-camera"]').count();
    await page.click('.block-selector .block-option[data-block-type="move-camera"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="move-camera"]').length > n,
      mcCellBefore, { timeout: 5000 }).catch(() => {});
    const mcCell = page.locator('#grid [data-block-type="move-camera"]').first();
    check('Move Camera block places on the grid', await mcCell.count() === 1);
    await mcCell.click();
    const mcPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Move Camera panel offers X + Y fields',
      /^X$/m.test(mcPropText) && /^Y$/m.test(mcPropText), mcPropText.slice(0, 300));
    // Follow Object places and its panel offers the Object field.
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const foCellBefore = await page.locator('#grid [data-block-type="follow-object"]').count();
    await page.click('.block-selector .block-option[data-block-type="follow-object"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="follow-object"]').length > n,
      foCellBefore, { timeout: 5000 }).catch(() => {});
    const foCell = page.locator('#grid [data-block-type="follow-object"]').first();
    check('Follow Object block places on the grid', await foCell.count() === 1);
    await foCell.click();
    const foPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Follow Object panel offers the Object field',
      /Object/i.test(foPropText), foPropText.slice(0, 300));
    // Set Camera Zoom places and its panel offers the Zoom field.
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const czCellBefore = await page.locator('#grid [data-block-type="set-camera-zoom"]').count();
    await page.click('.block-selector .block-option[data-block-type="set-camera-zoom"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-camera-zoom"]').length > n,
      czCellBefore, { timeout: 5000 }).catch(() => {});
    const czCell = page.locator('#grid [data-block-type="set-camera-zoom"]').first();
    check('Set Camera Zoom block places on the grid', await czCell.count() === 1);
    await czCell.click();
    const czPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Set Camera Zoom panel offers the Zoom field',
      /Zoom/i.test(czPropText), czPropText.slice(0, 300));
    // Camera Position places and its panel offers Property + Compare fields.
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const cpCellBefore = await page.locator('#grid [data-block-type="camera-position"]').count();
    await page.click('.block-selector .block-option[data-block-type="camera-position"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="camera-position"]').length > n,
      cpCellBefore, { timeout: 5000 }).catch(() => {});
    const cpCell = page.locator('#grid [data-block-type="camera-position"]').first();
    check('Camera Position block places on the grid', await cpCell.count() === 1);
    await cpCell.click();
    const cpPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Camera Position panel offers Property + Compare fields',
      /Property/i.test(cpPropText) && /Compare/i.test(cpPropText), cpPropText.slice(0, 300));

    // ---- P4 item 37 (block expansion, batch 6: variables/arrays/structures) ----
    // 22 Variables blocks: 12 array actions, 2 array conditions, 6 structure
    // actions, 1 structure condition, 2 JSON bridge actions.
    const hydraCollectionsLoaded = await page.evaluate(() =>
      !!window.HydraCollections && typeof window.HydraCollections.applyCollectionAction === 'function');
    check('HydraCollections module is loaded in the editor', hydraCollectionsLoaded);
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    await page.waitForSelector('.block-selector .block-option[data-block-type="array-push"]:visible',
      { timeout: 5000 }).catch(() => {});
    const collectionOptions = await page.evaluate(() =>
      ['array-push', 'array-pop', 'array-set-item', 'array-get-item', 'array-insert',
       'array-remove-at', 'array-remove-value', 'array-clear', 'array-sort',
       'array-shuffle', 'array-join', 'array-math', 'array-length-condition',
       'array-contains-condition', 'struct-set-field', 'struct-get-field',
       'struct-remove-field', 'struct-clear', 'struct-keys',
       'struct-has-field-condition', 'var-to-json', 'var-from-json'].map(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('all 22 collection blocks are in the palette (Variables category)',
      collectionOptions.every(Boolean), JSON.stringify(collectionOptions));
    // Push To Array places and its panel offers List variable + Value is + Value.
    const paCellBefore = await page.locator('#grid [data-block-type="array-push"]').count();
    await page.click('.block-selector .block-option[data-block-type="array-push"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="array-push"]').length > n,
      paCellBefore, { timeout: 5000 }).catch(() => {});
    const paCell = page.locator('#grid [data-block-type="array-push"]').first();
    check('Push To Array block places on the grid', await paCell.count() === 1);
    await paCell.click();
    const paPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Push To Array panel offers List variable + Value is + Value fields',
      /List variable/i.test(paPropText) && /Value is/i.test(paPropText) && /^Value$/m.test(paPropText),
      paPropText.slice(0, 300));
    // Set Structure Field places and its panel offers Structure variable + Field name.
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const sfCellBefore = await page.locator('#grid [data-block-type="struct-set-field"]').count();
    await page.click('.block-selector .block-option[data-block-type="struct-set-field"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="struct-set-field"]').length > n,
      sfCellBefore, { timeout: 5000 }).catch(() => {});
    const sfCell = page.locator('#grid [data-block-type="struct-set-field"]').first();
    check('Set Structure Field block places on the grid', await sfCell.count() === 1);
    await sfCell.click();
    const sfPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Set Structure Field panel offers Structure variable + Field name fields',
      /Structure variable/i.test(sfPropText) && /Field name/i.test(sfPropText),
      sfPropText.slice(0, 300));
    // Array Length places and its panel offers Compare + Invert fields.
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const alCellBefore = await page.locator('#grid [data-block-type="array-length-condition"]').count();
    await page.click('.block-selector .block-option[data-block-type="array-length-condition"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="array-length-condition"]').length > n,
      alCellBefore, { timeout: 5000 }).catch(() => {});
    const alCell = page.locator('#grid [data-block-type="array-length-condition"]').first();
    check('Array Length block places on the grid', await alCell.count() === 1);
    await alCell.click();
    const alPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Array Length panel offers Compare + Invert fields',
      /Compare/i.test(alPropText) && /Invert/i.test(alPropText), alPropText.slice(0, 300));
    // Variable From JSON places and its panel offers the JSON text field.
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const fjCellBefore = await page.locator('#grid [data-block-type="var-from-json"]').count();
    await page.click('.block-selector .block-option[data-block-type="var-from-json"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="var-from-json"]').length > n,
      fjCellBefore, { timeout: 5000 }).catch(() => {});
    const fjCell = page.locator('#grid [data-block-type="var-from-json"]').first();
    check('Variable From JSON block places on the grid', await fjCell.count() === 1);
    await fjCell.click();
    const fjPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Variable From JSON panel offers the JSON text field',
      /JSON text/i.test(fjPropText), fjPropText.slice(0, 300));

    // ---- P4 item 37 (block expansion, batch 7: keyboard/mouse/touch/gamepad input) ----
    // 7 raw Input conditions: Cursor Position, Any Key Pressed, Touch Active,
    // Touch Count, Gamepad Connected, Gamepad Button, Gamepad Stick.
    const hydraInputHelpersLoaded = await page.evaluate(() =>
      !!window.HydraActions && typeof window.HydraActions.isGamepadConnected === 'function' &&
      typeof window.HydraActions.pollGamepadAxes === 'function');
    check('HydraActions exposes gamepad connection + axes helpers in the editor', hydraInputHelpersLoaded);
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    await page.waitForSelector('.block-selector .block-option[data-block-type="cursor-position"]:visible',
      { timeout: 5000 }).catch(() => {});
    const rawInputOptions = await page.evaluate(() =>
      ['cursor-position', 'any-key-pressed', 'touch-active', 'touch-count',
       'gamepad-connected', 'gamepad-button', 'gamepad-stick'].map(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('all 7 raw input blocks are in the palette (Input category)',
      rawInputOptions.every(Boolean), JSON.stringify(rawInputOptions));
    // Cursor Position places and its panel offers Property + Compare fields.
    const curCellBefore = await page.locator('#grid [data-block-type="cursor-position"]').count();
    await page.click('.block-selector .block-option[data-block-type="cursor-position"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="cursor-position"]').length > n,
      curCellBefore, { timeout: 5000 }).catch(() => {});
    const curCell = page.locator('#grid [data-block-type="cursor-position"]').first();
    check('Cursor Position block places on the grid', await curCell.count() === 1);
    await curCell.click();
    const curPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Cursor Position panel offers Property + Compare fields',
      /Property/i.test(curPropText) && /Compare/i.test(curPropText), curPropText.slice(0, 300));
    // Gamepad Button places and its panel offers Button + When fields.
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const gbCellBefore = await page.locator('#grid [data-block-type="gamepad-button"]').count();
    await page.click('.block-selector .block-option[data-block-type="gamepad-button"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="gamepad-button"]').length > n,
      gbCellBefore, { timeout: 5000 }).catch(() => {});
    const gbCell = page.locator('#grid [data-block-type="gamepad-button"]').first();
    check('Gamepad Button block places on the grid', await gbCell.count() === 1);
    await gbCell.click();
    const gbPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Gamepad Button panel offers Button + When fields',
      /Button/i.test(gbPropText) && /When/i.test(gbPropText), gbPropText.slice(0, 300));
    // Gamepad Stick places and its panel offers Stick + Axis fields.
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const gsCellBefore = await page.locator('#grid [data-block-type="gamepad-stick"]').count();
    await page.click('.block-selector .block-option[data-block-type="gamepad-stick"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="gamepad-stick"]').length > n,
      gsCellBefore, { timeout: 5000 }).catch(() => {});
    const gsCell = page.locator('#grid [data-block-type="gamepad-stick"]').first();
    check('Gamepad Stick block places on the grid', await gsCell.count() === 1);
    await gsCell.click();
    const gsPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Gamepad Stick panel offers Stick + Axis fields',
      /Stick/i.test(gsPropText) && /Axis/i.test(gsPropText), gsPropText.slice(0, 300));

    // ---- P4 item 37 (block expansion, batch 8: physics queries) ----
    // 4 Collision conditions: Angle Between, Line of Sight, Distance To
    // Nearest, Moving Towards.
    const hydraQueryHelpersLoaded = await page.evaluate(() =>
      !!window.HydraPhysics2D && typeof window.HydraPhysics2D.angleBetweenObjects === 'function' &&
      typeof window.HydraPhysics2D.movingTowards === 'function' &&
      typeof window.HydraPhysics2D.objectCenter === 'function');
    check('HydraPhysics2D exposes the batch-8 query helpers in the editor', hydraQueryHelpersLoaded);
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    await page.waitForSelector('.block-selector .block-option[data-block-type="angle-between-condition"]:visible',
      { timeout: 5000 }).catch(() => {});
    const queryOptions = await page.evaluate(() =>
      ['angle-between-condition', 'line-of-sight-condition',
       'nearest-distance-condition', 'moving-towards-condition'].map(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('all 4 physics query blocks are in the palette (Collision category)',
      queryOptions.every(Boolean), JSON.stringify(queryOptions));
    // Angle Between places and its panel offers Compare + Degrees fields.
    const abCellBefore = await page.locator('#grid [data-block-type="angle-between-condition"]').count();
    await page.click('.block-selector .block-option[data-block-type="angle-between-condition"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="angle-between-condition"]').length > n,
      abCellBefore, { timeout: 5000 }).catch(() => {});
    const abCell = page.locator('#grid [data-block-type="angle-between-condition"]').first();
    check('Angle Between block places on the grid', await abCell.count() === 1);
    await abCell.click();
    const abPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Angle Between panel offers Compare + Degrees fields',
      /Compare/i.test(abPropText) && /Degrees/i.test(abPropText), abPropText.slice(0, 300));
    // Line of Sight places and its panel offers Layers (mask) + Invert fields.
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const losCellBefore = await page.locator('#grid [data-block-type="line-of-sight-condition"]').count();
    await page.click('.block-selector .block-option[data-block-type="line-of-sight-condition"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="line-of-sight-condition"]').length > n,
      losCellBefore, { timeout: 5000 }).catch(() => {});
    const losCell = page.locator('#grid [data-block-type="line-of-sight-condition"]').first();
    check('Line of Sight block places on the grid', await losCell.count() === 1);
    await losCell.click();
    const losPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Line of Sight panel offers Layers (mask) + Invert fields',
      /Layers \(mask\)/i.test(losPropText) && /Invert/i.test(losPropText), losPropText.slice(0, 300));
    // Moving Towards places and its panel offers Min speed + Invert fields.
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const mtCellBefore = await page.locator('#grid [data-block-type="moving-towards-condition"]').count();
    await page.click('.block-selector .block-option[data-block-type="moving-towards-condition"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="moving-towards-condition"]').length > n,
      mtCellBefore, { timeout: 5000 }).catch(() => {});
    const mtCell = page.locator('#grid [data-block-type="moving-towards-condition"]').first();
    check('Moving Towards block places on the grid', await mtCell.count() === 1);
    await mtCell.click();
    const mtPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Moving Towards panel offers Min speed + Invert fields',
      /Min speed/i.test(mtPropText) && /Invert/i.test(mtPropText), mtPropText.slice(0, 300));

    // ---- P4 item 37 (block expansion, batch 9: timers) ----
    // 2 Game Flow blocks: Timer Elapsed (condition), Read Timer (action).
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    await page.waitForSelector('.block-selector .block-option[data-block-type="timer-elapsed-condition"]:visible',
      { timeout: 5000 }).catch(() => {});
    const timerOptions = await page.evaluate(() =>
      ['timer-elapsed-condition', 'read-timer-action'].map(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('both timer blocks are in the palette (Game Flow category)',
      timerOptions.every(Boolean), JSON.stringify(timerOptions));
    // Timer Elapsed places and its panel offers Timer name + Compare + Seconds + Invert.
    const teCellBefore = await page.locator('#grid [data-block-type="timer-elapsed-condition"]').count();
    await page.click('.block-selector .block-option[data-block-type="timer-elapsed-condition"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="timer-elapsed-condition"]').length > n,
      teCellBefore, { timeout: 5000 }).catch(() => {});
    const teCell = page.locator('#grid [data-block-type="timer-elapsed-condition"]').first();
    check('Timer Elapsed block places on the grid', await teCell.count() === 1);
    await teCell.click();
    const tePropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Timer Elapsed panel offers Timer name + Compare + Seconds + Invert fields',
      /Timer name/i.test(tePropText) && /Compare/i.test(tePropText) &&
      /Seconds/i.test(tePropText) && /Invert/i.test(tePropText), tePropText.slice(0, 300));
    // Read Timer places and its panel offers Timer name + Into variable.
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const rtCellBefore = await page.locator('#grid [data-block-type="read-timer-action"]').count();
    await page.click('.block-selector .block-option[data-block-type="read-timer-action"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="read-timer-action"]').length > n,
      rtCellBefore, { timeout: 5000 }).catch(() => {});
    const rtCell = page.locator('#grid [data-block-type="read-timer-action"]').first();
    check('Read Timer block places on the grid', await rtCell.count() === 1);
    await rtCell.click();
    const rtPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Read Timer panel offers Timer name + Into variable fields',
      /Timer name/i.test(rtPropText) && /Into variable/i.test(rtPropText), rtPropText.slice(0, 300));

    // ---- P4 item 37 (block expansion, batch 10: math/random) ----
    // 5 Variables blocks: Random Integer, Clamp Number, Round Number,
    // Random Pick (actions), Number In Range (condition).
    const hydraMathLoaded = await page.evaluate(() =>
      !!window.HydraMath && typeof window.HydraMath.applyMathAction === 'function');
    check('HydraMath module is loaded in the editor', hydraMathLoaded);
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    await page.waitForSelector('.block-selector .block-option[data-block-type="random-integer"]:visible',
      { timeout: 5000 }).catch(() => {});
    const mathOptions = await page.evaluate(() =>
      ['random-integer', 'clamp-number', 'round-number', 'random-pick', 'number-in-range-condition'].map(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('all 5 math/random blocks are in the palette (Variables category)',
      mathOptions.every(Boolean), JSON.stringify(mathOptions));
    // Random Integer places and its panel offers Into variable + Min + Max.
    const riCellBefore = await page.locator('#grid [data-block-type="random-integer"]').count();
    await page.click('.block-selector .block-option[data-block-type="random-integer"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="random-integer"]').length > n,
      riCellBefore, { timeout: 5000 }).catch(() => {});
    const riCell = page.locator('#grid [data-block-type="random-integer"]').first();
    check('Random Integer block places on the grid', await riCell.count() === 1);
    await riCell.click();
    const riPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Random Integer panel offers Into variable + Min + Max fields',
      /Into variable/i.test(riPropText) && /Min/i.test(riPropText) && /Max/i.test(riPropText),
      riPropText.slice(0, 300));
    // Random Pick places and its panel offers From list + Into variable.
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const rpCellBefore = await page.locator('#grid [data-block-type="random-pick"]').count();
    await page.click('.block-selector .block-option[data-block-type="random-pick"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="random-pick"]').length > n,
      rpCellBefore, { timeout: 5000 }).catch(() => {});
    const rpCell = page.locator('#grid [data-block-type="random-pick"]').first();
    check('Random Pick block places on the grid', await rpCell.count() === 1);
    await rpCell.click();
    const rpPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Random Pick panel offers From list + Into variable fields',
      /From list/i.test(rpPropText) && /Into variable/i.test(rpPropText), rpPropText.slice(0, 300));
    // Number In Range places and its panel offers Value + Minimum + Maximum + Invert.
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const nrCellBefore = await page.locator('#grid [data-block-type="number-in-range-condition"]').count();
    await page.click('.block-selector .block-option[data-block-type="number-in-range-condition"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="number-in-range-condition"]').length > n,
      nrCellBefore, { timeout: 5000 }).catch(() => {});
    const nrCell = page.locator('#grid [data-block-type="number-in-range-condition"]').first();
    check('Number In Range block places on the grid', await nrCell.count() === 1);
    await nrCell.click();
    const nrPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Number In Range panel offers Value + Minimum + Maximum + Invert fields',
      /Value/i.test(nrPropText) && /Minimum/i.test(nrPropText) &&
      /Maximum/i.test(nrPropText) && /Invert/i.test(nrPropText), nrPropText.slice(0, 300));

    // ---- P4 item 37 (block expansion, batch 11: object picking and selection) ----
    // 3 Object conditions: Pick Nearest, Pick Farthest, Pick Random.
    const hydraPickLoaded = await page.evaluate(() =>
      !!window.HydraPick && typeof window.HydraPick.evalPickCondition === 'function');
    check('HydraPick module is loaded in the editor', hydraPickLoaded);
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    await page.waitForSelector('.block-selector .block-option[data-block-type="pick-nearest-condition"]:visible',
      { timeout: 5000 }).catch(() => {});
    const pickOptions = await page.evaluate(() =>
      ['pick-nearest-condition', 'pick-farthest-condition', 'pick-random-condition'].map(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('all 3 pick blocks are in the palette (Object category)',
      pickOptions.every(Boolean), JSON.stringify(pickOptions));
    // Pick Nearest places and its panel offers Object + Near object + Point X/Y.
    const pnCellBefore = await page.locator('#grid [data-block-type="pick-nearest-condition"]').count();
    await page.click('.block-selector .block-option[data-block-type="pick-nearest-condition"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="pick-nearest-condition"]').length > n,
      pnCellBefore, { timeout: 5000 }).catch(() => {});
    const pnCell = page.locator('#grid [data-block-type="pick-nearest-condition"]').first();
    check('Pick Nearest block places on the grid', await pnCell.count() === 1);
    await pnCell.click();
    const pnPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Pick Nearest panel offers Object + Near object + Point X/Y fields',
      /Object/i.test(pnPropText) && /Near object/i.test(pnPropText) &&
      /Point X/i.test(pnPropText) && /Point Y/i.test(pnPropText), pnPropText.slice(0, 300));
    // Pick Random places and its panel offers the Object field.
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const prCellBefore = await page.locator('#grid [data-block-type="pick-random-condition"]').count();
    await page.click('.block-selector .block-option[data-block-type="pick-random-condition"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="pick-random-condition"]').length > n,
      prCellBefore, { timeout: 5000 }).catch(() => {});
    const prCell = page.locator('#grid [data-block-type="pick-random-condition"]').first();
    check('Pick Random block places on the grid', await prCell.count() === 1);
    await prCell.click();
    const prPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Pick Random panel offers the Object field',
      /Object/i.test(prPropText), prPropText.slice(0, 300));

    // ---- P4 item 37 (block expansion, batch 12: layers and effects) ----
    // 8 Object actions + 1 Object condition: Bring to Front, Send to Back,
    // Move Up a Layer, Move Down a Layer, Layer Check, Set Blend Mode,
    // Set Shadow, Set Visual Effect, Clear Effects.
    const hydraLayerFxLoaded = await page.evaluate(() =>
      !!window.HydraLayerFx && typeof window.HydraLayerFx.applyLayerFxAction === 'function');
    check('HydraLayerFx module is loaded in the editor', hydraLayerFxLoaded);
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    await page.waitForSelector('.block-selector .block-option[data-block-type="bring-to-front"]:visible',
      { timeout: 5000 }).catch(() => {});
    const layerFxOptions = await page.evaluate(() =>
      ['bring-to-front', 'send-to-back', 'move-layer-up', 'move-layer-down',
       'layer-check-condition', 'set-blend-mode', 'set-shadow',
       'set-visual-effect', 'clear-effects'].map(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('all 9 layers/effects blocks are in the palette (Object category)',
      layerFxOptions.every(Boolean), JSON.stringify(layerFxOptions));
    // Bring to Front places and its panel offers the Object field.
    const bfCellBefore = await page.locator('#grid [data-block-type="bring-to-front"]').count();
    await page.click('.block-selector .block-option[data-block-type="bring-to-front"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="bring-to-front"]').length > n,
      bfCellBefore, { timeout: 5000 }).catch(() => {});
    const bfCell = page.locator('#grid [data-block-type="bring-to-front"]').first();
    check('Bring to Front block places on the grid', await bfCell.count() === 1);
    await bfCell.click();
    const bfPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Bring to Front panel offers the Object field',
      /Object/i.test(bfPropText), bfPropText.slice(0, 300));
    // Set Blend Mode places and its panel offers the Blend select.
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const bmCellBefore = await page.locator('#grid [data-block-type="set-blend-mode"]').count();
    await page.click('.block-selector .block-option[data-block-type="set-blend-mode"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-blend-mode"]').length > n,
      bmCellBefore, { timeout: 5000 }).catch(() => {});
    const bmCell = page.locator('#grid [data-block-type="set-blend-mode"]').first();
    check('Set Blend Mode block places on the grid', await bmCell.count() === 1);
    await bmCell.click();
    const bmPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Set Blend Mode panel offers the Blend field',
      /Blend/i.test(bmPropText), bmPropText.slice(0, 300));
    // Set Shadow places and its panel offers Shadow color + Blur + Offsets.
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const shCellBefore = await page.locator('#grid [data-block-type="set-shadow"]').count();
    await page.click('.block-selector .block-option[data-block-type="set-shadow"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-shadow"]').length > n,
      shCellBefore, { timeout: 5000 }).catch(() => {});
    const shCell = page.locator('#grid [data-block-type="set-shadow"]').first();
    check('Set Shadow block places on the grid', await shCell.count() === 1);
    await shCell.click();
    const shPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Set Shadow panel offers Shadow color + Blur + Offset fields',
      /Shadow color/i.test(shPropText) && /Blur/i.test(shPropText) &&
      /Offset X/i.test(shPropText) && /Offset Y/i.test(shPropText), shPropText.slice(0, 300));

    // ---- P4 item 3D1 (3D rendering foundation, batch 1) ----
    // 5 actions + 1 condition: Move 3D, Set 3D Position, Set 3D Rotation,
    // Rotate 3D, Set 3D Camera, 3D Distance. 4 primitives in the Create
    // palette. Per-scene 2D/3D render-mode toggle in Scene Settings.
    const hydra3dLoaded = await page.evaluate(() =>
      !!window.Hydra3d && typeof window.Hydra3d.apply3dAction === 'function' &&
      typeof window.Hydra3d.renderScene === 'function');
    check('Hydra3d module is loaded in the editor', hydra3dLoaded);
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    await page.waitForSelector('.block-selector .block-option[data-block-type="move-3d"]:visible',
      { timeout: 5000 }).catch(() => {});
    const tdOptions = await page.evaluate(() =>
      ['move-3d', 'set-3d-position', 'set-3d-rotation', 'rotate-3d',
       'set-model-tint', 'set-3d-camera', 'follow-3d-camera', 'stop-3d-camera-follow',
       'distance-3d-condition'].map(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('all 9 3D blocks are in the palette (3D category)',
      tdOptions.every(Boolean), JSON.stringify(tdOptions));
    // Move 3D places and its panel offers dX/dY/dZ fields.
    const m3CellBefore = await page.locator('#grid [data-block-type="move-3d"]').count();
    await page.click('.block-selector .block-option[data-block-type="move-3d"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="move-3d"]').length > n,
      m3CellBefore, { timeout: 5000 }).catch(() => {});
    const m3Cell = page.locator('#grid [data-block-type="move-3d"]').first();
    check('Move 3D block places on the grid', await m3Cell.count() === 1);
    await m3Cell.click();
    const m3PropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Move 3D panel offers Object + dX/dY/dZ fields',
      /Object/i.test(m3PropText) && /dX/i.test(m3PropText) && /dZ/i.test(m3PropText),
      m3PropText.slice(0, 300));
    // Set 3D Camera places and its panel offers Camera + Look fields.
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const c3CellBefore = await page.locator('#grid [data-block-type="set-3d-camera"]').count();
    await page.click('.block-selector .block-option[data-block-type="set-3d-camera"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-3d-camera"]').length > n,
      c3CellBefore, { timeout: 5000 }).catch(() => {});
    const c3Cell = page.locator('#grid [data-block-type="set-3d-camera"]').first();
    check('Set 3D Camera block places on the grid', await c3Cell.count() === 1);
    await c3Cell.click();
    const c3PropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Set 3D Camera panel offers Camera X/Y/Z + Look X/Y/Z fields',
      /Camera X/i.test(c3PropText) && /Look X/i.test(c3PropText),
      c3PropText.slice(0, 300));
    // 3D Distance places and its panel offers Object A/B + Distance.
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const d3CellBefore = await page.locator('#grid [data-block-type="distance-3d-condition"]').count();
    await page.click('.block-selector .block-option[data-block-type="distance-3d-condition"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="distance-3d-condition"]').length > n,
      d3CellBefore, { timeout: 5000 }).catch(() => {});
    const d3Cell = page.locator('#grid [data-block-type="distance-3d-condition"]').first();
    check('3D Distance block places on the grid', await d3Cell.count() === 1);
    await d3Cell.click();
    const d3PropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('3D Distance panel offers Object A/B + Distance fields',
      /Object A/i.test(d3PropText) && /Object B/i.test(d3PropText) && /Distance/i.test(d3PropText),
      d3PropText.slice(0, 300));
    // Create palette: the 4 3D primitives; Box 3D creates a thumbnail object.
    await page.click('.tab[data-tab="scene-tab"]');
    await page.click('.inspector-tab[data-inspector-tab="create"]');
    await page.waitForSelector('.object-create-btn[data-create-kind="box3d"]', { timeout: 10000 });
    const createKinds = await page.evaluate(() =>
      ['box3d', 'sphere3d', 'plane3d', 'cylinder3d'].map(k =>
        !!document.querySelector(`.object-create-btn[data-create-kind="${k}"]`)));
    check('all 4 3D primitives are in the Create palette', createKinds.every(Boolean),
      JSON.stringify(createKinds));
    await page.click('.object-create-btn[data-create-kind="box3d"]');
    await page.waitForSelector('.game-object.object3d-object', { timeout: 5000 });
    check('Box 3D object appears in the scene editor', true);
    const box3dCanvas = await page.evaluate(() =>
      !!document.querySelector('.game-object.object3d-object canvas.object3d-canvas'));
    check('Box 3D renders a 3D thumbnail on an inner canvas', box3dCanvas);
    const badge3d = await page.evaluate(() =>
      document.querySelector('.game-object.object3d-object .object3d-badge')?.textContent);
    check('Box 3D carries the 3D badge', badge3d === '3D', String(badge3d));
    // Inspector 3D Transform section (auto-shown on create).
    await page.waitForFunction(
      () => /3D Transform/.test(document.getElementById('object-properties')?.innerText || ''),
      { timeout: 5000 }).catch(() => {});
    const insp3d = await page.evaluate(() =>
      document.getElementById('object-properties')?.innerText || '');
    check('3D Transform inspector section appears',
      /3d transform/i.test(insp3d) && /toward viewer/i.test(insp3d), insp3d.slice(0, 300));
    // Scene Settings render-mode toggle switches the scene to 3D.
    await page.click('.inspector-tab[data-inspector-tab="world"]');
    await page.waitForSelector('#scene-render-mode', { timeout: 5000 });
    await page.selectOption('#scene-render-mode', '3d');
    const renderMode = await page.evaluate(() =>
      window.getCurrentScene?.()?.renderMode);
    check('render-mode toggle writes scene.renderMode = 3d', renderMode === '3d', String(renderMode));
    // ---- P4 item 3D1 batch 2: in-editor 3D viewport + camera follow ----
    // Layout / 3D view toggle appears for the 3D scene.
    const viewToggleVisible = await page.evaluate(() => {
      const el = document.getElementById('scene-3d-view-toggle');
      return !!el && el.style.display !== 'none';
    });
    check('Layout/3D view toggle appears for a 3D scene', viewToggleVisible);
    // 3D view renders the true perspective canvas and hides the divs.
    await page.click('#scene-view-3d-btn');
    await page.waitForSelector('#scene-3d-canvas', { timeout: 5000 }).catch(() => {});
    const view3dState = await page.evaluate(() => {
      const objs = [...document.querySelectorAll('#scene-canvas .game-object')];
      return {
        canvas: !!document.querySelector('#scene-3d-canvas'),
        hint: !!document.querySelector('.scene-3d-hint'),
        viewClass: document.getElementById('scene-canvas')?.classList.contains('scene-3d-view'),
        objCount: objs.length,
        objHidden: objs.length > 0 && objs.every(o => getComputedStyle(o).display === 'none'),
        btnActive: document.getElementById('scene-view-3d-btn')?.classList.contains('active')
      };
    });
    check('3D view renders the perspective canvas with hint',
      view3dState.canvas && view3dState.hint && view3dState.viewClass,
      JSON.stringify(view3dState));
    check('3D view hides ALL Layout object divs (incl. inline-styled text)',
      view3dState.objHidden === true,
      `count=${view3dState.objCount} hidden=${view3dState.objHidden}`);
    check('3D view button shows active', view3dState.btnActive === true);
    // Back to Layout restores the divs.
    await page.click('#scene-view-layout-btn');
    const layoutState = await page.evaluate(() => ({
      viewClass: document.getElementById('scene-canvas')?.classList.contains('scene-3d-view'),
      objVisible: (() => { const o = document.querySelector('.game-object');
        return !!o && getComputedStyle(o).display !== 'none'; })()
    }));
    check('Layout view restores the object divs',
      layoutState.viewClass === false && layoutState.objVisible === true,
      JSON.stringify(layoutState));
    // Scene Settings 3D camera fields write scene.camera3d.
    const camWrapVisible = await page.evaluate(() => {
      const el = document.getElementById('scene-3d-camera-wrap');
      return !!el && el.style.display !== 'none';
    });
    check('3D camera fields appear in Scene Settings for a 3D scene', camWrapVisible);
    await page.fill('#scene-cam3d-x', '123');
    const camX = await page.evaluate(() => window.getCurrentScene?.()?.camera3d?.x);
    check('3D camera X field writes scene.camera3d', camX === 123, String(camX));
    await page.click('#scene-cam3d-reset-btn');
    const camReset = await page.evaluate(() => {
      const c = window.getCurrentScene?.()?.camera3d;
      return c && c.x === 400 && c.y === 300;
    });
    check('3D camera Reset re-frames the scene', camReset === true);
    // The toggle hides again for a 2D scene.
    await page.selectOption('#scene-render-mode', '2d');
    const toggleHidden2d = await page.evaluate(() =>
      document.getElementById('scene-3d-view-toggle')?.style.display === 'none');
    check('Layout/3D view toggle hides for a 2D scene', toggleHidden2d === true);
    await page.selectOption('#scene-render-mode', '3d');
    // Follow 3D Object places and its panel offers Object + Offset fields.
    await page.click('.tab[data-tab="script-tab"]');
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    await page.waitForSelector('.block-selector .block-option[data-block-type="follow-3d-camera"]:visible',
      { timeout: 5000 }).catch(() => {});
    const f3CellBefore = await page.locator('#grid [data-block-type="follow-3d-camera"]').count();
    await page.click('.block-selector .block-option[data-block-type="follow-3d-camera"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="follow-3d-camera"]').length > n,
      f3CellBefore, { timeout: 5000 }).catch(() => {});
    const f3Cell = page.locator('#grid [data-block-type="follow-3d-camera"]').first();
    check('Follow 3D Object block places on the grid', await f3Cell.count() === 1);
    await f3Cell.click();
    const f3PropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Follow 3D Object panel offers Object + Offset X/Y/Z fields',
      /Object/i.test(f3PropText) && /Offset X/i.test(f3PropText) && /Offset Z/i.test(f3PropText),
      f3PropText.slice(0, 300));
    // Stop 3D Camera Follow places on the grid.
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const s3CellBefore = await page.locator('#grid [data-block-type="stop-3d-camera-follow"]').count();
    await page.click('.block-selector .block-option[data-block-type="stop-3d-camera-follow"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="stop-3d-camera-follow"]').length > n,
      s3CellBefore, { timeout: 5000 }).catch(() => {});
    check('Stop 3D Camera Follow block places on the grid',
      await page.locator('#grid [data-block-type="stop-3d-camera-follow"]').count() > s3CellBefore);
    // ---- P4 item 3D2 batch 1: 3D model assets (GLB/GLTF upload) ----
    // Set Model Tint is the 9th 3D block.
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    await page.waitForSelector('.block-selector .block-option[data-block-type="set-model-tint"]:visible',
      { timeout: 5000 }).catch(() => {});
    const tintBlockPresent = await page.locator('.block-selector .block-option[data-block-type="set-model-tint"]').count();
    check('Set Model Tint block is in the palette (3D category)', tintBlockPresent === 1);
    const t3CellBefore = await page.locator('#grid [data-block-type="set-model-tint"]').count();
    await page.click('.block-selector .block-option[data-block-type="set-model-tint"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-model-tint"]').length > n,
      t3CellBefore, { timeout: 5000 }).catch(() => {});
    const t3Cell = page.locator('#grid [data-block-type="set-model-tint"]').first();
    check('Set Model Tint block places on the grid', await t3Cell.count() === 1);
    await t3Cell.click();
    const t3PropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Set Model Tint panel offers Object + Tint color fields',
      /Object/i.test(t3PropText) && /Tint color/i.test(t3PropText),
      t3PropText.slice(0, 300));
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    // Model 3D in the Create palette; creates a thumbnail object with badge.
    await page.click('.tab[data-tab="scene-tab"]');
    await page.click('.inspector-tab[data-inspector-tab="create"]');
    await page.waitForSelector('.object-create-btn[data-create-kind="model3d"]', { timeout: 10000 });
    check('Model 3D is in the Create palette', true);
    await page.click('.object-create-btn[data-create-kind="model3d"]');
    await page.waitForFunction(
      () => [...document.querySelectorAll('.game-object')].some(el =>
        (window.getCurrentScene?.().objects || []).find(o => String(o.id) === el.dataset.id)?.kind === 'model3d'),
      { timeout: 5000 }).catch(() => {});
    const modelObj = await page.evaluate(() => {
      const scene = window.getCurrentScene?.();
      return scene ? scene.objects.find(o => o.kind === 'model3d') || null : null;
    });
    check('Model 3D object appears in the scene editor', !!modelObj);
    const modelThumb = await page.evaluate((id) => {
      const el = document.querySelector(`.game-object[data-id="${id}"]`);
      return {
        canvas: !!el?.querySelector('canvas.object3d-canvas'),
        badge: el?.querySelector('.object3d-badge')?.textContent || ''
      };
    }, modelObj && modelObj.id);
    check('Model 3D renders a 3D thumbnail with the 3D badge',
      modelThumb.canvas === true && modelThumb.badge === '3D', JSON.stringify(modelThumb));
    // Inspector 3D Transform section offers the Model picker + tint.
    const inspModel = await page.evaluate(() =>
      document.getElementById('object-properties')?.innerText || '');
    check('Model 3D inspector offers Model picker + Material color (tint)',
      /Model:/.test(inspModel) && /Material color \(tint\)/.test(inspModel),
      inspModel.slice(0, 400));
    // Upload a synthesized .glb through the real Assets tab flow.
    await page.click('.inspector-tab[data-inspector-tab="assets"]');
    await page.waitForSelector('#asset-upload-file', { state: 'attached', timeout: 5000 });
    const glbBuffer = await page.evaluate(() => {
      // Build a minimal tetrahedron GLB (4 triangles) in the browser.
      function pad(buf, byte) {
        const p = (4 - (buf.length % 4)) % 4;
        const out = new Uint8Array(buf.length + p);
        out.set(buf); out.fill(byte, buf.length);
        return out;
      }
      const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
      const idx = new Uint16Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]);
      const bin = new Uint8Array(pos.byteLength + idx.byteLength);
      bin.set(new Uint8Array(pos.buffer), 0);
      bin.set(new Uint8Array(idx.buffer), pos.byteLength);
      const json = {
        asset: { version: '2.0' },
        buffers: [{ byteLength: bin.length }],
        bufferViews: [
          { buffer: 0, byteOffset: 0, byteLength: pos.byteLength },
          { buffer: 0, byteOffset: pos.byteLength, byteLength: idx.byteLength }
        ],
        accessors: [
          { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3' },
          { bufferView: 1, componentType: 5123, count: 12, type: 'SCALAR' }
        ],
        materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.2, 0.6, 1, 1] } }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
        nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0
      };
      const jsonBytes = pad(new TextEncoder().encode(JSON.stringify(json)), 0x20);
      const binPadded = pad(bin, 0);
      const total = 12 + 8 + jsonBytes.length + 8 + binPadded.length;
      const out = new Uint8Array(total);
      const dv = new DataView(out.buffer);
      dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
      let off = 12;
      dv.setUint32(off, jsonBytes.length, true); dv.setUint32(off + 4, 0x4E4F534A, true); off += 8;
      out.set(jsonBytes, off); off += jsonBytes.length;
      dv.setUint32(off, binPadded.length, true); dv.setUint32(off + 4, 0x004E4942, true); off += 8;
      out.set(binPadded, off);
      return [...out];
    });
    await page.setInputFiles('#asset-upload-file', [{
      name: 'tetra.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from(glbBuffer)
    }]);
    await page.waitForFunction(
      () => [...document.querySelectorAll('#asset-list .asset-row')].some(r => /3D Model/.test(r.textContent)),
      { timeout: 10000 }).catch(() => {});
    const assetRow = await page.evaluate(() =>
      [...document.querySelectorAll('#asset-list .asset-row')].some(r => /3D Model/.test(r.textContent)));
    check('uploaded .glb appears in the asset manager as a 3D Model', assetRow === true);
    // Pick the uploaded model on the Model 3D object; the real model renders.
    await page.click('.inspector-tab[data-inspector-tab="inspect"]');
    await page.evaluate((id) => {
      document.querySelector(`.game-object[data-id="${id}"]`)?.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true }));
    }, modelObj.id).catch(() => {});
    const pickModel = await page.evaluate(() => {
      const groups = [...document.querySelectorAll('#object-properties .property-group')];
      const g = groups.find(el => el.querySelector('label')?.textContent === 'Model:');
      const sel = g?.querySelector('select');
      if (!sel || sel.options.length < 2) return { options: sel ? sel.options.length : 0 };
      sel.value = sel.options[1].value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return { options: sel.options.length, picked: sel.value };
    });
    check('Inspector Model picker lists the uploaded .glb',
      pickModel.options >= 2 && !!pickModel.picked, JSON.stringify(pickModel));
    const modelMesh = await page.evaluate(() => {
      const scene = window.getCurrentScene?.();
      const obj = scene?.objects.find(o => o.kind === 'model3d');
      if (!obj || !window.resolveModelMeshFor) return null;
      const mesh = window.resolveModelMeshFor(obj);
      return mesh ? { tris: mesh.tris.length, colors: mesh.colors.length } : null;
    });
    check('uploaded GLB parses and fits to a 4-triangle colored mesh',
      !!modelMesh && modelMesh.tris === 4 && modelMesh.colors === 4,
      JSON.stringify(modelMesh));
    const thumbPixels = await page.evaluate((id) => {
      const cv = document.querySelector(`.game-object[data-id="${id}"] canvas.object3d-canvas`);
      if (!cv) return { found: false };
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
      return { found: true, painted: n };
    }, modelObj.id);
    check('Model 3D thumbnail paints the uploaded model',
      thumbPixels.found === true && thumbPixels.painted > 50, JSON.stringify(thumbPixels));
    // 3D2 batch 2 — texture mapping: a textured .glb shows its own skin.
    // Build a textured quad GLB in the browser (a real 4x4 PNG painted on a
    // canvas, so the test exercises genuine image decoding).
    const texGlbBuffer = await page.evaluate(async () => {
      function pad(buf, byte) {
        const p = (4 - (buf.length % 4)) % 4;
        const out = new Uint8Array(buf.length + p);
        out.set(buf); out.fill(byte, buf.length);
        return out;
      }
      const cv = document.createElement('canvas'); cv.width = 4; cv.height = 4;
      const g = cv.getContext('2d');
      g.fillStyle = '#ff0000'; g.fillRect(0, 0, 2, 2);
      g.fillStyle = '#00ff00'; g.fillRect(2, 0, 2, 2);
      g.fillStyle = '#0000ff'; g.fillRect(0, 2, 2, 2);
      g.fillStyle = '#ffff00'; g.fillRect(2, 2, 2, 2);
      const b64 = cv.toDataURL('image/png').split(',')[1];
      const png = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const pos = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
      const idx = new Uint16Array([0, 1, 2, 0, 2, 3]);
      const uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
      const parts = [
        new Uint8Array(pos.buffer), new Uint8Array(idx.buffer),
        new Uint8Array(uv.buffer), png
      ];
      const bufferViews = [];
      let off = 0;
      for (const p of parts) { bufferViews.push({ buffer: 0, byteOffset: off, byteLength: p.length }); off += p.length; }
      const bin = new Uint8Array(off);
      off = 0; for (const p of parts) { bin.set(p, off); off += p.length; }
      const json = {
        asset: { version: '2.0' },
        buffers: [{ byteLength: bin.length }],
        bufferViews,
        accessors: [
          { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3' },
          { bufferView: 1, componentType: 5123, count: 6, type: 'SCALAR' },
          { bufferView: 2, componentType: 5126, count: 4, type: 'VEC2' }
        ],
        images: [{ bufferView: 3, mimeType: 'image/png' }],
        textures: [{ source: 0 }],
        materials: [{ pbrMetallicRoughness: {
          baseColorFactor: [1, 1, 1, 1], baseColorTexture: { index: 0 } } }],
        meshes: [{ primitives: [{
          attributes: { POSITION: 0, TEXCOORD_0: 2 }, indices: 1, material: 0 }] }],
        nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0
      };
      const jsonBytes = pad(new TextEncoder().encode(JSON.stringify(json)), 0x20);
      const binPadded = pad(bin, 0);
      const total = 12 + 8 + jsonBytes.length + 8 + binPadded.length;
      const out = new Uint8Array(total);
      const dv = new DataView(out.buffer);
      dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
      let o2 = 12;
      dv.setUint32(o2, jsonBytes.length, true); dv.setUint32(o2 + 4, 0x4E4F534A, true); o2 += 8;
      out.set(jsonBytes, o2); o2 += jsonBytes.length;
      dv.setUint32(o2, binPadded.length, true); dv.setUint32(o2 + 4, 0x004E4942, true); o2 += 8;
      out.set(binPadded, o2);
      return [...out];
    });
    await page.setInputFiles('#asset-upload-file', [{
      name: 'quad-textured.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from(texGlbBuffer)
    }]);
    await page.waitForFunction(
      () => [...document.querySelectorAll('#asset-list .asset-row')]
        .some(r => /quad-textured/.test(r.textContent) && /texture/.test(r.textContent)),
      { timeout: 10000 }).catch(() => {});
    const texRow = await page.evaluate(() =>
      [...document.querySelectorAll('#asset-list .asset-row')]
        .some(r => /quad-textured/.test(r.textContent) && /texture/.test(r.textContent)));
    check('textured .glb shows a texture badge in the asset manager', texRow === true);
    // Pick the textured model on the Model 3D object and wait for the
    // real image decode to land.
    await page.click('.inspector-tab[data-inspector-tab="inspect"]');
    await page.evaluate((id) => {
      document.querySelector(`.game-object[data-id="${id}"]`)?.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true }));
    }, modelObj.id).catch(() => {});
    const pickTex = await page.evaluate(() => {
      const groups = [...document.querySelectorAll('#object-properties .property-group')];
      const g = groups.find(el => el.querySelector('label')?.textContent === 'Model:');
      const sel = g?.querySelector('select');
      if (!sel) return { ok: false };
      const opt = [...sel.options].find(o => /quad-textured/.test(o.textContent));
      if (!opt) return { ok: false, options: sel.options.length };
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, picked: opt.textContent };
    });
    check('Inspector Model picker lists the textured .glb', pickTex.ok === true, JSON.stringify(pickTex));
    const texReady = await page.waitForFunction((id) => {
      const scene = window.getCurrentScene?.();
      const obj = scene?.objects.find(o => String(o.id) === String(id));
      const mesh = obj && window.resolveModelMeshFor ? window.resolveModelMeshFor(obj) : null;
      const img = mesh && mesh.texImages && mesh.texImages[0];
      return !!(img && img.naturalWidth > 0);
    }, modelObj.id, { timeout: 15000 }).then(() => true).catch(() => false);
    check('textured model image decodes in the editor', texReady === true);
    const texPixels = await page.evaluate((id) => {
      const cv = document.querySelector(`.game-object[data-id="${id}"] canvas.object3d-canvas`);
      if (!cv) return { found: false };
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let r = 0, g2 = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) {
        const R = d[i], G = d[i + 1], B = d[i + 2], A = d[i + 3];
        if (A < 10) continue;
        if (R > 170 && G < 110 && B < 110) r++;
        else if (G > 170 && R < 110 && B < 110) g2++;
        else if (B > 170 && R < 110 && G < 110) b++;
      }
      return { found: true, r, g: g2, b };
    }, modelObj.id);
    check('Model 3D thumbnail paints the model texture (red/green/blue quads)',
      texPixels.found === true && texPixels.r > 20 && texPixels.g > 20 && texPixels.b > 20,
      JSON.stringify(texPixels));
    // The Inspector texture switch + the Use Model Texture palette block.
    const useTexChk = await page.evaluate(() =>
      [...document.querySelectorAll('#object-properties .property-group')]
        .some(g => /Use model texture/.test(g.textContent) &&
          !!g.querySelector('input[type="checkbox"]')));
    check('Inspector offers the Use model texture checkbox', useTexChk === true);
    // Use Model Texture is the 10th 3D block: in the palette, places, and
    // its panel offers Object + Texture fields.
    await page.click('.tab[data-tab="script-tab"]');
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    await page.waitForSelector('.block-selector .block-option[data-block-type="use-model-texture"]:visible',
      { timeout: 5000 }).catch(() => {});
    const useTexBlockPresent = await page.locator('.block-selector .block-option[data-block-type="use-model-texture"]').count();
    check('Use Model Texture block is in the palette (3D category)', useTexBlockPresent === 1);
    const u3CellBefore = await page.locator('#grid [data-block-type="use-model-texture"]').count();
    await page.click('.block-selector .block-option[data-block-type="use-model-texture"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="use-model-texture"]').length > n,
      u3CellBefore, { timeout: 5000 }).catch(() => {});
    const u3Cell = page.locator('#grid [data-block-type="use-model-texture"]').first();
    check('Use Model Texture block places on the grid', await u3Cell.count() === 1);
    await u3Cell.click();
    const u3PropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Use Model Texture panel offers Object + Texture fields',
      /Object/i.test(u3PropText) && /Texture/i.test(u3PropText),
      u3PropText.slice(0, 300));
    // P4 item 3D3 (character controllers): the 6 new controller blocks are
    // in the palette — Aim 3D Camera + Move 3D Facing (3D), Capture Mouse +
    // Release Mouse + Read Mouse Delta + Mouse Pointer Captured (Input).
    // Back out of the properties panel first so the block selector is
    // visible again.
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    for (const bt of ['aim-3d-camera', 'move-3d-facing', 'capture-mouse',
        'release-mouse', 'read-mouse-delta', 'mouse-pointer-captured']) {
      const n = await page.locator(`.block-selector .block-option[data-block-type="${bt}"]`).count();
      check(`controller block in palette: ${bt}`, n === 1);
    }
    // Aim 3D Camera places and its panel offers Yaw/Pitch/Look distance.
    const aimBefore = await page.locator('#grid [data-block-type="aim-3d-camera"]').count();
    await page.locator('.block-selector .block-option[data-block-type="aim-3d-camera"]')
      .scrollIntoViewIfNeeded().catch(() => {});
    await page.click('.block-selector .block-option[data-block-type="aim-3d-camera"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="aim-3d-camera"]').length > n,
      aimBefore, { timeout: 5000 }).catch(() => {});
    const aimCell = page.locator('#grid [data-block-type="aim-3d-camera"]').first();
    check('Aim 3D Camera block places on the grid', await aimCell.count() === 1);
    await aimCell.click();
    const aimPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Aim 3D Camera panel offers Yaw/Pitch/Look distance fields',
      /Yaw/i.test(aimPropText) && /Pitch/i.test(aimPropText) && /Look distance/i.test(aimPropText),
      aimPropText.slice(0, 300));
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    // Read Mouse Delta places and its panel offers the variable fields.
    const rdBefore = await page.locator('#grid [data-block-type="read-mouse-delta"]').count();
    await page.locator('.block-selector .block-option[data-block-type="read-mouse-delta"]')
      .scrollIntoViewIfNeeded().catch(() => {});
    await page.click('.block-selector .block-option[data-block-type="read-mouse-delta"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="read-mouse-delta"]').length > n,
      rdBefore, { timeout: 5000 }).catch(() => {});
    const rdCell = page.locator('#grid [data-block-type="read-mouse-delta"]').first();
    check('Read Mouse Delta block places on the grid', await rdCell.count() === 1);
    await rdCell.click();
    const rdPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Read Mouse Delta panel offers Into variable fields',
      /Into variable/i.test(rdPropText), rdPropText.slice(0, 300));
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const hydra3dHelpers = await page.evaluate(() =>
      !!window.Hydra3d && typeof window.Hydra3d.yawPitchLookAt === 'function' &&
      typeof window.Hydra3d.facingDelta === 'function');
    check('Hydra3d aim/facing helpers are loaded in the editor', hydra3dHelpers);
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    // P4 item 3D4 (3D physics): the 4 new physics blocks are in the 3D
    // palette — Set 3D Gravity + Set 3D Velocity (actions), 3D On Ground +
    // 3D Collision (conditions).
    for (const bt of ['set-3d-gravity', 'set-3d-velocity', 'on-ground-3d', 'collision-3d']) {
      const n = await page.locator(`.block-selector .block-option[data-block-type="${bt}"]`).count();
      check(`3D physics block in palette: ${bt}`, n === 1);
    }
    // Set 3D Gravity places and its panel offers Object + Gravity.
    const g3Before = await page.locator('#grid [data-block-type="set-3d-gravity"]').count();
    await page.locator('.block-selector .block-option[data-block-type="set-3d-gravity"]')
      .scrollIntoViewIfNeeded().catch(() => {});
    await page.click('.block-selector .block-option[data-block-type="set-3d-gravity"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-3d-gravity"]').length > n,
      g3Before, { timeout: 5000 }).catch(() => {});
    const g3Cell = page.locator('#grid [data-block-type="set-3d-gravity"]').first();
    check('Set 3D Gravity block places on the grid', await g3Cell.count() === 1);
    await g3Cell.click();
    const g3PropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Set 3D Gravity panel offers Object + Gravity fields',
      /Object/i.test(g3PropText) && /Gravity/i.test(g3PropText),
      g3PropText.slice(0, 300));
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    // 3D On Ground places and its panel offers Object + Invert.
    const ogBefore = await page.locator('#grid [data-block-type="on-ground-3d"]').count();
    await page.locator('.block-selector .block-option[data-block-type="on-ground-3d"]')
      .scrollIntoViewIfNeeded().catch(() => {});
    await page.click('.block-selector .block-option[data-block-type="on-ground-3d"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="on-ground-3d"]').length > n,
      ogBefore, { timeout: 5000 }).catch(() => {});
    const ogCell = page.locator('#grid [data-block-type="on-ground-3d"]').first();
    check('3D On Ground block places on the grid', await ogCell.count() === 1);
    await ogCell.click();
    const ogPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('3D On Ground panel offers Object + Invert fields',
      /Object/i.test(ogPropText) && /Invert/i.test(ogPropText),
      ogPropText.slice(0, 300));
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    // Inspector 3D Collider section: create a Box 3D and check the
    // collider shape select + solid checkbox render.
    await page.click('.tab[data-tab="scene-tab"]');
    await page.click('.inspector-tab[data-inspector-tab="create"]');
    await page.waitForSelector('.object-create-btn[data-create-kind="box3d"]', { timeout: 10000 });
    await page.click('.object-create-btn[data-create-kind="box3d"]');
    await page.waitForFunction(
      () => /3D Collider/.test(document.getElementById('object-properties')?.innerText || ''),
      { timeout: 5000 }).catch(() => {});
    const col3d = await page.evaluate(() =>
      document.getElementById('object-properties')?.innerText || '');
    check('3D Collider inspector section appears for 3D objects',
      /3D Collider/i.test(col3d) && /Collider shape/i.test(col3d) && /Solid/i.test(col3d),
      col3d.slice(0, 400));
    // The inert 2D Collision section stays hidden for 3D objects.
    check('2D Collision section is hidden for 3D objects',
      !/One-way platform/.test(col3d), col3d.slice(0, 400));
    // ---- P4 item 3D5: 3D lighting ----
    // Set 3D Light is in the 3D palette, places, and its panel offers
    // Light + Type + Color + Intensity + Range + On/Off.
    await page.click('.tab[data-tab="script-tab"]');
    await page.waitForSelector('.block-selector .block-option[data-block-type="set-3d-light"]', { timeout: 10000 });
    check('Set 3D Light block in the 3D palette',
      await page.locator('.block-selector .block-option[data-block-type="set-3d-light"]').count() === 1);
    const slBefore = await page.locator('#grid [data-block-type="set-3d-light"]').count();
    await page.locator('.block-selector .block-option[data-block-type="set-3d-light"]')
      .scrollIntoViewIfNeeded().catch(() => {});
    await page.click('.block-selector .block-option[data-block-type="set-3d-light"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-3d-light"]').length > n,
      slBefore, { timeout: 5000 }).catch(() => {});
    const slCell = page.locator('#grid [data-block-type="set-3d-light"]').first();
    check('Set 3D Light block places on the grid', await slCell.count() === 1);
    await slCell.click();
    const slPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Set 3D Light panel offers Light + Type + Color + Intensity + Range + On/Off fields',
      /Light/i.test(slPropText) && /Type/i.test(slPropText) && /Color/i.test(slPropText) &&
      /Intensity/i.test(slPropText) && /Range/i.test(slPropText),
      slPropText.slice(0, 400));
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    // Create a 3D Light: switch the scene to 3D first, so the
    // context-aware Light button creates a light3d (in a 2D scene it
    // creates a light2d instead). The scene editor shows a bulb glyph
    // (no 3D thumbnail), and the inspector shows the Light section with
    // a Type select — but no 3D Collider, no 2D Collision, no Physics.
    await page.click('.tab[data-tab="scene-tab"]');
    await page.click('.inspector-tab[data-inspector-tab="world"]');
    await page.waitForSelector('#scene-render-mode', { timeout: 5000 });
    await page.selectOption('#scene-render-mode', '3d');
    await page.click('.inspector-tab[data-inspector-tab="create"]');
    await page.waitForSelector('.object-create-btn[data-create-kind="light"]', { timeout: 10000 });
    await page.click('.object-create-btn[data-create-kind="light"]');
    await page.waitForSelector('.game-object.light3d-object', { timeout: 5000 });
    check('light object appears in the scene editor', true);
    check('light shows a bulb glyph, not a 3D thumbnail',
      await page.locator('.game-object.light3d-object .light3d-glyph').count() === 1 &&
      await page.locator('.game-object.light3d-object canvas.object3d-canvas').count() === 0);
    await page.waitForFunction(
      () => /Light/.test(document.getElementById('object-properties')?.innerText || ''),
      { timeout: 5000 }).catch(() => {});
    const lightPropText = await page.evaluate(() =>
      document.getElementById('object-properties')?.innerText || '');
    check('Light inspector section appears with Type select',
      /Type/i.test(lightPropText) && /Point/i.test(lightPropText) && /Intensity/i.test(lightPropText),
      lightPropText.slice(0, 400));
    check('light inspector hides the 3D Collider section',
      !/3D Collider/i.test(lightPropText), lightPropText.slice(0, 400));
    check('light inspector hides the 2D Collision section and Physics panel',
      !/One-way platform/.test(lightPropText) && !/Max Speed/i.test(lightPropText),
      lightPropText.slice(0, 400));
    // Scene Settings (3D scene) offers the shadow switch + ground Y.
    await page.click('.inspector-tab[data-inspector-tab="world"]');
    await page.waitForSelector('#scene-render-mode', { timeout: 5000 });
    await page.selectOption('#scene-render-mode', '3d');
    await page.waitForSelector('#scene-shadows3d', { timeout: 5000 });
    check('Scene Settings shows the 3D shadow switch for 3D scenes',
      await page.locator('#scene-shadows3d').count() === 1 &&
      await page.locator('#scene-shadow-ground-y').count() === 1);
    await page.click('#scene-shadows3d');
    const shadowsOn = await page.evaluate(() => window.getCurrentScene?.()?.shadows3d === true);
    check('shadow switch writes scene.shadows3d', shadowsOn);
    // The Hydra3d lighting API is loaded in the editor.
    const hydraLightLoaded = await page.evaluate(() =>
      !!window.Hydra3d && typeof window.Hydra3d.isLight3d === 'function' &&
      typeof window.Hydra3d.collectLights3d === 'function' &&
      typeof window.Hydra3d.computeLightRGB === 'function');
    check('Hydra3d lighting API is loaded in the editor', hydraLightLoaded);
    await page.click('.tab[data-tab="scene-tab"]');
    const hydraGltfLoaded = await page.evaluate(() =>
      !!window.HydraGltf && typeof window.HydraGltf.parseGlb === 'function');
    check('HydraGltf module is loaded in the editor', hydraGltfLoaded);
    const hydraTilesLoaded = await page.evaluate(() =>
      !!window.HydraTiles && typeof window.HydraTiles.resolveTileCollision === 'function');
    check('HydraTiles module is loaded in the editor', hydraTilesLoaded);
    await page.click('.tab[data-tab="scene-tab"]');
    await page.click('.inspector-tab[data-inspector-tab="create"]');
    await page.waitForSelector('.object-create-btn[data-create-kind="tilemap"]', { timeout: 10000 });
    await page.click('.object-create-btn[data-create-kind="tilemap"]');
    await page.waitForSelector('.game-object.tilemap-object', { timeout: 5000 });
    check('tilemap object appears in the scene editor', true);
    const tilemapCanvas = await page.evaluate(() =>
      !!document.querySelector('.game-object.tilemap-object canvas.tilemap-canvas'));
    check('tilemap renders its tiles on an inner canvas', tilemapCanvas);
    // Inspector Tilemap section (auto-shown on create).
    await page.waitForSelector('.tilemap-editor', { timeout: 5000 });
    check('Tilemap inspector section appears', true);
    check('tileset strip renders in the inspector',
      await page.locator('.tilemap-strip').count() === 1);
    const solidLabel = await page.locator('.tilemap-solid-label').innerText();
    check('solid-tiles readout defaults to tile 0', /0/.test(solidLabel), solidLabel);
    // Paint a cell: synthetic mousedown on the tilemap's top-left cell.
    await page.evaluate(() => {
      const el = document.querySelector('.game-object.tilemap-object');
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('mousedown', {
        clientX: r.left + 10, clientY: r.top + 10, bubbles: true, cancelable: true
      }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    const paintedTile = await page.evaluate(() => {
      const p = window.projectManager && window.projectManager.getCurrentProject
        ? window.projectManager.getCurrentProject() : null;
      const tm = p && p.scenes[0].objects.find(o => o.kind === 'tilemap');
      return tm ? tm.tiles[0] : 'missing';
    });
    check('painting a cell writes the brush tile into the map', paintedTile === 0, String(paintedTile));
    // Erase it with a right-click.
    await page.evaluate(() => {
      const el = document.querySelector('.game-object.tilemap-object');
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', {
        clientX: r.left + 10, clientY: r.top + 10, bubbles: true, cancelable: true
      }));
    });
    const erasedTile = await page.evaluate(() => {
      const p = window.projectManager.getCurrentProject();
      return p.scenes[0].objects.find(o => o.kind === 'tilemap').tiles[0];
    });
    check('right-click erases the cell', erasedTile === -1, String(erasedTile));
    // Tilemap blocks in the palette.
    await page.click('.tab[data-tab="script-tab"]');
    await page.waitForSelector('#grid', { timeout: 10000 });
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    await page.waitForSelector('.block-selector .block-option[data-block-type="set-tile"]:visible',
      { timeout: 5000 }).catch(() => {});
    const tileBlockOptions = await page.evaluate(() =>
      ['set-tile', 'tile-solid-at-condition', 'standing-on-tile-condition'].map(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('tilemap blocks are in the palette (Set Tile / Tile Solid At / Standing On Tile)',
      tileBlockOptions.every(Boolean), JSON.stringify(tileBlockOptions));
    const tileCatLabels = await page.evaluate(() =>
      [...document.querySelectorAll('.block-selector .block-category-label')].map(el => el.textContent.trim()));
    check('Tilemap category appears in the block palette', tileCatLabels.includes('Tilemap'),
      tileCatLabels.join(' | '));
    // Set Tile places and its panel offers Tilemap + Column + Row + Tile.
    const setTileBefore = await page.locator('#grid [data-block-type="set-tile"]').count();
    await page.click('.block-selector .block-option[data-block-type="set-tile"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-tile"]').length > n,
      setTileBefore, { timeout: 5000 }).catch(() => {});
    const setTileCell = page.locator('#grid [data-block-type="set-tile"]').first();
    check('Set Tile block places on the grid', await setTileCell.count() === 1);
    await setTileCell.click();
    const setTilePropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Set Tile panel offers Tilemap + Column + Row + Tile fields',
      /Tilemap/i.test(setTilePropText) && /Column/i.test(setTilePropText) &&
      /Row/i.test(setTilePropText) && /Tile/i.test(setTilePropText),
      setTilePropText.slice(0, 300));
    // Preview boots with the tilemap and no error overlay.
    await page.click('.tab[data-tab="preview-tab"]');
    await page.waitForSelector('#game-canvas', { timeout: 10000 });
    await page.waitForTimeout(1500);
    const tilePreviewOverlay = await page.locator('body').evaluate((b) =>
      /failed|error/i.test(b.innerText || '') && (b.innerText || '').includes('Hydra') ? b.innerText.slice(0, 200) : '');
    check('no Hydra error overlay in tilemap preview', tilePreviewOverlay === '', tilePreviewOverlay);
    await page.click('.tab[data-tab="script-tab"]');

    // ---- P4 item 32: physics upgrade — module, Collision inspector, blocks ----
    const hydraPhysics2dLoaded = await page.evaluate(() =>
      !!window.HydraPhysics2D && typeof window.HydraPhysics2D.resolvePair === 'function');
    check('HydraPhysics2D module is loaded in the editor', hydraPhysics2dLoaded);
    // Select a non-tilemap object and read its Collision inspector section.
    await page.click('.tab[data-tab="scene-tab"]');
    const physSel = await page.evaluate(() => {
      const scene = window.getCurrentScene ? window.getCurrentScene() : null;
      const obj = scene && scene.objects.find(o => o.kind !== 'tilemap' && o.kind !== 'text');
      if (!obj) return 'no-obj';
      window.selectGameObjectById(obj.id);
      return obj.name || obj.id;
    });
    check('selected a non-tilemap object for the Collision section', physSel !== 'no-obj', String(physSel));
    await page.waitForTimeout(400);
    const collisionPropText = await page.evaluate(() =>
      document.getElementById('object-properties')?.innerText || '');
    check('Collision inspector section appears', /Collision/.test(collisionPropText),
      collisionPropText.slice(0, 300));
    check('Collision section offers Shape + Collider + One-way + Layer + Collides-with fields',
      /Shape/.test(collisionPropText) && /Collider/.test(collisionPropText) &&
      /One-way platform/.test(collisionPropText) && /Layer/.test(collisionPropText) &&
      /Collides with/.test(collisionPropText),
      collisionPropText.slice(0, 500));
    // Flip the shape to Circle and verify it sticks on the project object.
    const shapeSet = await page.evaluate(() => {
      const panel = document.getElementById('object-properties');
      const sel = [...panel.querySelectorAll('select')].find(s =>
        [...s.options].some(o => o.textContent.trim() === 'Circle'));
      if (!sel) return 'no-select';
      sel.value = 'circle';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      const p = window.projectManager && window.projectManager.getCurrentProject();
      const objs = p && p.scenes[0].objects;
      const first = objs && objs.find(o => o.kind !== 'tilemap' && o.kind !== 'text');
      return first && first.collision && first.collision.shape;
    });
    check('Shape select writes circle to the object', shapeSet === 'circle', String(shapeSet));
    // Physics blocks in the palette.
    await page.click('.tab[data-tab="script-tab"]');
    await page.waitForSelector('#grid', { timeout: 10000 });
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    await page.waitForSelector('.block-selector .block-option[data-block-type="trigger-enter-condition"]:visible',
      { timeout: 5000 }).catch(() => {});
    const physBlockOptions = await page.evaluate(() =>
      ['trigger-enter-condition', 'trigger-exit-condition', 'raycast-hit-condition',
       'overlap-check-condition', 'set-collision-layer-action'].map(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('physics blocks are in the palette (Trigger Enter/Exit, Raycast Hit, Objects Overlapping, Set Collision Layer)',
      physBlockOptions.every(Boolean), JSON.stringify(physBlockOptions));
    // Trigger Enter places and its panel offers Trigger zone + Object + Invert.
    const trigBefore = await page.locator('#grid [data-block-type="trigger-enter-condition"]').count();
    await page.click('.block-selector .block-option[data-block-type="trigger-enter-condition"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="trigger-enter-condition"]').length > n,
      trigBefore, { timeout: 5000 }).catch(() => {});
    const trigCell = page.locator('#grid [data-block-type="trigger-enter-condition"]').first();
    check('Trigger Enter block places on the grid', await trigCell.count() === 1);
    await trigCell.click();
    const trigPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Trigger Enter panel offers Trigger zone + Object + Invert fields',
      /Trigger zone/i.test(trigPropText) && /Object/i.test(trigPropText) && /Invert/i.test(trigPropText),
      trigPropText.slice(0, 300));
    // Raycast Hit places and its panel offers From X/Y + To X/Y + Layers.
    await page.click('#back-to-blocks-btn');
    const rayBefore = await page.locator('#grid [data-block-type="raycast-hit-condition"]').count();
    await page.click('.block-selector .block-option[data-block-type="raycast-hit-condition"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="raycast-hit-condition"]').length > n,
      rayBefore, { timeout: 5000 }).catch(() => {});
    const rayCell = page.locator('#grid [data-block-type="raycast-hit-condition"]').first();
    check('Raycast Hit block places on the grid', await rayCell.count() === 1);
    await rayCell.click();
    const rayPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Raycast Hit panel offers From X/Y + To X/Y + Layers fields',
      /From X/i.test(rayPropText) && /To Y/i.test(rayPropText) && /Layers/i.test(rayPropText),
      rayPropText.slice(0, 300));

    // ---- F5: flagship template — featured card, 8 scenes, preview + export ----
    // Its own browser context: creating the flagship writes its id as
    // the current project in localStorage, and a shared context would
    // make the main page's next reload open the flagship instead of
    // the collector (cycle 22: the spawn section's Object select then
    // has no hazard). A separate context keeps its storage apart.
    const hub2ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const hub2 = await hub2ctx.newPage();
    const hub2Errors = [];
    hub2.on('pageerror', e => hub2Errors.push(String(e && e.message || e)));
    await goto(hub2, `http://localhost:${PORT}/home.html`, { waitUntil: 'domcontentloaded' });
    await hub2.click('#new-project-btn-main');
    await hub2.fill('#project-name-input', 'Flagship Smoke Game');
    check('featured flagship template card exists in the gallery',
      await hub2.locator('.template-card[data-template="flagship"]').count() === 1);
    const flagshipCardText = await hub2.locator('.template-card[data-template="flagship"]').innerText();
    check('flagship card carries the Featured badge', /Featured/i.test(flagshipCardText), flagshipCardText.slice(0, 120));
    await hub2.click('.template-card[data-template="flagship"]');
    await Promise.all([
      hub2.waitForURL(/index\.html/, { timeout: 15000 }),
      hub2.click('#create-project-btn')
    ]);
    check('editor opens for the flagship project', /index\.html/.test(hub2.url()), hub2.url());
    const flagshipSceneCount = await hub2.evaluate(() => window.scenes && window.scenes.length);
    check('flagship project has 8 scenes (menu, how-to, select, 3 levels, win, game-over)',
      flagshipSceneCount === 8, String(flagshipSceneCount));
    const flagshipSceneNames = await hub2.evaluate(() => (window.scenes || []).map(s => s.name).join(' | '));
    check('flagship scenes are the planned set',
      /Main Menu/.test(flagshipSceneNames) && /Level 3 - Ember Caverns/.test(flagshipSceneNames) && /Game Over/.test(flagshipSceneNames),
      flagshipSceneNames);
    const flagshipAssets = await hub2.evaluate(() =>
      window.projectManager && window.projectManager.getCurrentProject
        ? Object.keys(window.projectManager.getCurrentProject().assets || {}).length : -1);
    check('flagship sprite-animation assets shipped with the project', flagshipAssets === 9, String(flagshipAssets));
    // Preview boots the menu scene without errors.
    await hub2.click('.tab[data-tab="preview-tab"]');
    await hub2.waitForSelector('#game-canvas', { timeout: 10000 });
    await hub2.waitForTimeout(2500);
    const flagshipOverlay = await hub2.locator('body').evaluate((b) =>
      /failed|error/i.test(b.innerText || '') && (b.innerText || '').includes('Hydra') ? b.innerText.slice(0, 200) : '');
    check('no Hydra error overlay in flagship preview', flagshipOverlay === '', flagshipOverlay);
    // Export the flagship game and boot it standalone.
    await hub2.click('.tab[data-tab="script-tab"]');
    await hub2.click('#export-playable-btn');
    await hub2.waitForSelector('#export-dialog.open', { timeout: 5000 });
    const [flagshipDownload] = await Promise.all([
      hub2.waitForEvent('download', { timeout: 20000 }),
      hub2.click('#export-download-standalone')
    ]);
    const flagshipPath = await flagshipDownload.path();
    check('flagship export produced a download', !!flagshipPath);
    const flagshipHtml = require('fs').readFileSync(flagshipPath, 'utf8');
    const flagshipStandalone = await context.newPage();
    const flagshipStandaloneErrors = [];
    flagshipStandalone.on('pageerror', e => flagshipStandaloneErrors.push(String(e && e.message || e)));
    await flagshipStandalone.setContent(flagshipHtml, { waitUntil: 'domcontentloaded' });
    await flagshipStandalone.waitForFunction(
      () => document.documentElement.dataset.hydraPlayer === 'ready' ||
            document.documentElement.dataset.hydraPlayer === 'error',
      null, { timeout: 10000 });
    const flagshipBoot = await flagshipStandalone.evaluate(() => document.documentElement.dataset.hydraPlayer);
    check('flagship exported game boots standalone (hydraPlayer=ready)', flagshipBoot === 'ready', flagshipBoot);
    await flagshipStandalone.waitForTimeout(2000);
    check('no errors in standalone flagship game', flagshipStandaloneErrors.length === 0,
      flagshipStandaloneErrors.slice(0, 3).join(' | '));
    await flagshipStandalone.close();
    check('no page errors on the flagship hub page', hub2Errors.length === 0, hub2Errors.slice(0, 3).join(' | '));
    await hub2.close();
    await hub2ctx.close();

    // ---- P4 item 37 (block expansion, batch 1: sprite transforms) ----
    await page.click('.tab[data-tab="script-tab"]');
    await page.waitForSelector('#grid', { timeout: 10000 });
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    await page.waitForSelector('.block-selector .block-option[data-block-type="flip-object"]:visible',
      { timeout: 5000 }).catch(() => {});
    const flipBlockOptions = await page.evaluate(() =>
      ['flip-object', 'set-scale'].map(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('transform blocks are in the palette (Flip Object / Set Scale)',
      flipBlockOptions.every(Boolean), JSON.stringify(flipBlockOptions));
    // Flip Object places and its panel offers the Direction field.
    const flipCellBefore = await page.locator('#grid [data-block-type="flip-object"]').count();
    await page.click('.block-selector .block-option[data-block-type="flip-object"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="flip-object"]').length > n,
      flipCellBefore, { timeout: 5000 }).catch(() => {});
    const flipCell = page.locator('#grid [data-block-type="flip-object"]').first();
    check('Flip Object block places on the grid', await flipCell.count() === 1);
    await flipCell.click();
    const flipPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Flip Object panel offers the Direction field',
      /Direction/i.test(flipPropText), flipPropText.slice(0, 300));
    // Set Scale places and its panel offers Scale X + Scale Y fields.
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const scaleCellBefore = await page.locator('#grid [data-block-type="set-scale"]').count();
    await page.click('.block-selector .block-option[data-block-type="set-scale"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-scale"]').length > n,
      scaleCellBefore, { timeout: 5000 }).catch(() => {});
    const scaleCell = page.locator('#grid [data-block-type="set-scale"]').first();
    check('Set Scale block places on the grid', await scaleCell.count() === 1);
    await scaleCell.click();
    const scalePropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Set Scale panel offers Scale X + Scale Y fields',
      /Scale X/i.test(scalePropText) && /Scale Y/i.test(scalePropText), scalePropText.slice(0, 300));
    // Position Check property select offers Scale X / Scale Y.
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const posCellBefore = await page.locator('#grid [data-block-type="position-condition"]').count();
    await page.click('.block-selector .block-option[data-block-type="position-condition"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="position-condition"]').length > n,
      posCellBefore, { timeout: 5000 }).catch(() => {});
    const posCell = page.locator('#grid [data-block-type="position-condition"]').first();
    await posCell.click();
    const propOptions = await page.evaluate(() => {
      const sel = [...document.querySelectorAll('#properties-panel select')]
        .find(s => /Property/.test(s.closest('label, .property-row, .property-group')?.innerText || ''));
      return sel ? [...sel.options].map(o => o.textContent) : [];
    });
    check('Position Check offers Scale X / Scale Y properties',
      propOptions.includes('Scale X') && propOptions.includes('Scale Y'), propOptions.join(', '));

    // ---- P4 item 37 (block expansion, batch 2: text manipulation) ----
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    await page.waitForSelector('.block-selector .block-option[data-block-type="set-text-size"]:visible',
      { timeout: 5000 }).catch(() => {});
    const textBlockOptions = await page.evaluate(() =>
      ['set-text-size', 'set-text-color', 'set-text-style', 'set-text-alignment', 'append-text', 'text-check'].map(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('text blocks are in the palette (5 actions + Text Compare)',
      textBlockOptions.every(Boolean), JSON.stringify(textBlockOptions));
    // Set Text Size places and its panel offers the Size field.
    const textSizeBefore = await page.locator('#grid [data-block-type="set-text-size"]').count();
    await page.click('.block-selector .block-option[data-block-type="set-text-size"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-text-size"]').length > n,
      textSizeBefore, { timeout: 5000 }).catch(() => {});
    const textSizeCell = page.locator('#grid [data-block-type="set-text-size"]').first();
    check('Set Text Size block places on the grid', await textSizeCell.count() === 1);
    await textSizeCell.click();
    const textSizePropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Set Text Size panel offers the Size field',
      /Size/i.test(textSizePropText), textSizePropText.slice(0, 300));
    // Set Text Color places and its panel offers a color picker.
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const textColorBefore = await page.locator('#grid [data-block-type="set-text-color"]').count();
    await page.click('.block-selector .block-option[data-block-type="set-text-color"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-text-color"]').length > n,
      textColorBefore, { timeout: 5000 }).catch(() => {});
    const textColorCell = page.locator('#grid [data-block-type="set-text-color"]').first();
    check('Set Text Color block places on the grid', await textColorCell.count() === 1);
    await textColorCell.click();
    const hasColorInput = await page.evaluate(() =>
      !!document.querySelector('#properties-panel input[type="color"]'));
    check('Set Text Color panel offers a color picker', hasColorInput);
    // Text Compare places and its panel offers the Compare + Compare-to fields.
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const textCheckBefore = await page.locator('#grid [data-block-type="text-check"]').count();
    await page.click('.block-selector .block-option[data-block-type="text-check"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="text-check"]').length > n,
      textCheckBefore, { timeout: 5000 }).catch(() => {});
    const textCheckCell = page.locator('#grid [data-block-type="text-check"]').first();
    check('Text Compare block places on the grid', await textCheckCell.count() === 1);
    await textCheckCell.click();
    const textCheckPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Text Compare panel offers Compare + Compare to fields',
      /Compare/.test(textCheckPropText) && /Compare to/.test(textCheckPropText),
      textCheckPropText.slice(0, 300));
    // Position Check property select offers Text length.
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    await page.click('.block-selector .block-option[data-block-type="position-condition"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForTimeout(500);
    const posCell2 = page.locator('#grid [data-block-type="position-condition"]').last();
    await posCell2.click();
    const propOptions2 = await page.evaluate(() => {
      const sel = [...document.querySelectorAll('#properties-panel select')]
        .find(s => /Property/.test(s.closest('label, .property-row, .property-group')?.innerText || ''));
      return sel ? [...sel.options].map(o => o.textContent) : [];
    });
    check('Position Check offers the Text length property',
      propOptions2.includes('Text length'), propOptions2.join(', '));

    // ---- P4 item 34: profiling overlay — module, blocks, preview toggle ----
    const hydraProfileLoaded = await page.evaluate(() =>
      !!window.HydraProfile && typeof window.HydraProfile.createProfiler === 'function' &&
      typeof window.HydraProfile.drawOverlay === 'function');
    check('HydraProfile module is loaded in the editor', hydraProfileLoaded);
    // Profiler blocks in the Game Flow palette.
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const profBlockOptions = await page.evaluate(() =>
      ['show-profiler', 'hide-profiler', 'toggle-profiler', 'profiler-visible-condition'].map(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('profiler blocks are in the palette (Show / Hide / Toggle Profiler / Profiler Visible)',
      profBlockOptions.every(Boolean), JSON.stringify(profBlockOptions));
    // Place Show Profiler on the grid.
    const showProfBefore = await page.locator('#grid [data-block-type="show-profiler"]').count();
    await page.click('.block-selector .block-option[data-block-type="show-profiler"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="show-profiler"]').length > n,
      showProfBefore, { timeout: 5000 }).catch(() => {});
    const showProfCell = page.locator('#grid [data-block-type="show-profiler"]').first();
    check('Show Profiler block places on the grid', await showProfCell.count() === 1);
    // Place Profiler Visible and check its Invert field.
    await page.click('#back-to-blocks-btn');
    const profVisBefore = await page.locator('#grid [data-block-type="profiler-visible-condition"]').count();
    await page.click('.block-selector .block-option[data-block-type="profiler-visible-condition"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="profiler-visible-condition"]').length > n,
      profVisBefore, { timeout: 5000 }).catch(() => {});
    const profVisCell = page.locator('#grid [data-block-type="profiler-visible-condition"]').first();
    check('Profiler Visible block places on the grid', await profVisCell.count() === 1);
    await profVisCell.click();
    const profVisPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Profiler Visible panel offers an Invert field', /Invert/i.test(profVisPropText),
      profVisPropText.slice(0, 200));
    // The preview toolbar has the Profiler toggle button; clicking it flips
    // the overlay and lights up the button while it is on.
    await page.click('.tab[data-tab="preview-tab"]');
    await page.waitForSelector('#game-canvas', { timeout: 10000 });
    await page.waitForTimeout(1200);
    const profilerBtn = page.locator('#preview-profiler-btn');
    check('preview toolbar has the Profiler toggle button', await profilerBtn.count() === 1);
    await profilerBtn.click();
    await page.waitForTimeout(500);
    check('Profiler button lights up while the overlay is on',
      await profilerBtn.evaluate(b => b.classList.contains('active')));
    await profilerBtn.click();
    await page.waitForTimeout(500);
    check('Profiler button dims again when the overlay is off',
      await profilerBtn.evaluate(b => !b.classList.contains('active')));
    await page.click('.tab[data-tab="script-tab"]');

    // ---- P4 item 35: text scripting API — module, Code blocks, code field ----
    const hydraScriptApiLoaded = await page.evaluate(() =>
      !!window.HydraScriptApi && typeof window.HydraScriptApi.runAction === 'function' &&
      typeof window.HydraScriptApi.evalCondition === 'function' &&
      typeof window.HydraScriptApi.createScriptAPI === 'function');
    check('HydraScriptApi module is loaded in the editor', hydraScriptApiLoaded);
    // Code blocks in the palette.
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const codeBlockOptions = await page.evaluate(() =>
      ['run-script', 'script-check'].map(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('Code blocks are in the palette (Run Script / Script Check)',
      codeBlockOptions.every(Boolean), JSON.stringify(codeBlockOptions));
    // Place Run Script and check its code textarea.
    const runScriptBefore = await page.locator('#grid [data-block-type="run-script"]').count();
    await page.click('.block-selector .block-option[data-block-type="run-script"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="run-script"]').length > n,
      runScriptBefore, { timeout: 5000 }).catch(() => {});
    const runScriptCell = page.locator('#grid [data-block-type="run-script"]').first();
    check('Run Script block places on the grid', await runScriptCell.count() === 1);
    await runScriptCell.click();
    await page.waitForTimeout(400);
    const runScriptHasTextarea = await page.evaluate(() =>
      !!document.querySelector('#properties-panel textarea'));
    check('Run Script panel offers a code textarea', runScriptHasTextarea);
    // Place Script Check and check its Invert field.
    await page.click('#back-to-blocks-btn');
    const scriptCheckBefore = await page.locator('#grid [data-block-type="script-check"]').count();
    await page.click('.block-selector .block-option[data-block-type="script-check"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="script-check"]').length > n,
      scriptCheckBefore, { timeout: 5000 }).catch(() => {});
    const scriptCheckCell = page.locator('#grid [data-block-type="script-check"]').first();
    check('Script Check block places on the grid', await scriptCheckCell.count() === 1);
    await scriptCheckCell.click();
    await page.waitForTimeout(400);
    const scriptCheckPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Script Check panel offers code + Invert fields',
      /JavaScript/i.test(scriptCheckPropText) && /Invert/i.test(scriptCheckPropText),
      scriptCheckPropText.slice(0, 200));
    await page.click('.tab[data-tab="script-tab"]');

    // ---- P4 Advanced (cycle 37): animation state machines ----
    const hydraStateMachineLoaded = await page.evaluate(() =>
      !!window.HydraStateMachine && typeof window.HydraStateMachine.setState === 'function' &&
      typeof window.HydraStateMachine.enterInitial === 'function' &&
      typeof window.HydraStateMachine.normalizeStates === 'function');
    check('HydraStateMachine module is loaded in the editor', hydraStateMachineLoaded);
    // State blocks in the palette.
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const stateBlockOptions = await page.evaluate(() =>
      ['set-anim-state', 'anim-state-condition'].map(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('Animation state blocks are in the palette (Set Animation State / Animation State)',
      stateBlockOptions.every(Boolean), JSON.stringify(stateBlockOptions));
    // Place Set Animation State and check its Object + State fields.
    const setStateBefore = await page.locator('#grid [data-block-type="set-anim-state"]').count();
    await page.click('.block-selector .block-option[data-block-type="set-anim-state"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-anim-state"]').length > n,
      setStateBefore, { timeout: 5000 }).catch(() => {});
    const setStateCell = page.locator('#grid [data-block-type="set-anim-state"]').first();
    check('Set Animation State block places on the grid', await setStateCell.count() === 1);
    await setStateCell.click();
    await page.waitForTimeout(400);
    const setStatePropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Set Animation State panel offers Object + State fields',
      /Object/i.test(setStatePropText) && /State/i.test(setStatePropText),
      setStatePropText.slice(0, 200));
    // Place the Animation State condition and check State + Invert.
    await page.click('#back-to-blocks-btn');
    const animStateBefore = await page.locator('#grid [data-block-type="anim-state-condition"]').count();
    await page.click('.block-selector .block-option[data-block-type="anim-state-condition"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="anim-state-condition"]').length > n,
      animStateBefore, { timeout: 5000 }).catch(() => {});
    const animStateCell = page.locator('#grid [data-block-type="anim-state-condition"]').first();
    check('Animation State block places on the grid', await animStateCell.count() === 1);
    await animStateCell.click();
    await page.waitForTimeout(400);
    const animStatePropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Animation State panel offers State + Invert fields',
      /State/i.test(animStatePropText) && /Invert/i.test(animStatePropText),
      animStatePropText.slice(0, 200));
    // Inspector: a sprite shows the Animations section (wired in this
    // cycle — it was dead code before) and the Animation States section.
    await page.click('.tab[data-tab="scene-tab"]');
    await page.click('.inspector-tab[data-inspector-tab="create"]');
    await page.waitForSelector('.object-create-btn[data-create-kind="sprite"]', { timeout: 10000 });
    await page.click('.object-create-btn[data-create-kind="sprite"]');
    // The inspector can take a while to settle after the long smoke flow;
    // wait generously for the sections instead of snapshotting early.
    // (Section titles render uppercased via CSS, so match case-insensitively.)
    const inspectorSettled = await page.waitForFunction(
      () => /add animation/i.test(document.getElementById('object-properties')?.innerText || '') &&
            /animation states/i.test(document.getElementById('object-properties')?.innerText || ''),
      { timeout: 30000 }).then(() => true).catch(() => false);
    const objPropText = await page.evaluate(() =>
      document.getElementById('object-properties')?.innerText || '');
    check('Inspector shows the Animations section for sprites',
      inspectorSettled && /add animation/i.test(objPropText),
      objPropText.slice(0, 300));
    check('Inspector shows the Animation States section for sprites',
      inspectorSettled && /add state/i.test(objPropText) && /initial state/i.test(objPropText),
      objPropText.slice(0, 300));
    // Add a state: a state card appears with Animation + Speed fields.
    await page.getByRole('button', { name: '+ Add state' }).click();
    await page.waitForTimeout(500);
    const stateCardText = await page.evaluate(() =>
      document.querySelector('.animstate-editor')?.innerText || '');
    check('adding a state creates a state card with Animation + Speed fields',
      /Animation/i.test(stateCardText) && /Speed/i.test(stateCardText),
      stateCardText.slice(0, 300));
    // P4 Advanced (blend spaces): the module, the three palette blocks,
    // and the Inspector Blend Spaces section. The sprite is still selected
    // on the scene tab with its properties showing, so the Inspector
    // checks run first, then the palette checks on the Logic tab.
    const blendSettled = await page.waitForFunction(
      () => /blend spaces/i.test(document.getElementById('object-properties')?.innerText || ''),
      { timeout: 30000 }).then(() => true).catch(() => false);
    const blendPropPanelText = await page.evaluate(() =>
      document.getElementById('object-properties')?.innerText || '');
    check('Inspector shows the Blend Spaces section for sprites',
      blendSettled && /add blend space/i.test(blendPropPanelText),
      blendPropPanelText.slice(0, 300));
    await page.getByRole('button', { name: '+ Add blend space' }).click();
    await page.waitForTimeout(500);
    const blendCardCheck = await page.evaluate(() =>
      document.querySelector('.blendspace-editor')?.innerText || '');
    check('adding a blend space creates a card with Speed (fps) field',
      /Speed \(fps\)/i.test(blendCardCheck), blendCardCheck.slice(0, 300));
    await page.getByRole('button', { name: '+ Add direction' }).click();
    await page.waitForTimeout(500);
    const blendPointText = await page.evaluate(() =>
      document.querySelector('.blendspace-editor')?.innerText || '');
    check('adding a direction creates a point row with Animation + X + Y fields',
      /Animation/i.test(blendPointText) && /(^|\s)X:/i.test(blendPointText) && /(^|\s)Y:/i.test(blendPointText),
      blendPointText.slice(0, 300));
    // Back on the Logic tab for the palette checks — the palette lives
    // there, not on the scene tab.
    await page.click('.tab[data-tab="script-tab"]');
    await page.waitForTimeout(500);
    const hydraBlendSpaceLoaded = await page.evaluate(() =>
      typeof window.HydraBlendSpace !== 'undefined' &&
      typeof window.HydraBlendSpace.setBlend === 'function' &&
      typeof window.HydraBlendSpace.blendFrameList === 'function' &&
      typeof window.HydraBlendSpace.normalizeBlendSpaces === 'function');
    check('HydraBlendSpace module is loaded in the editor', hydraBlendSpaceLoaded);
    // The palette was hidden behind the properties panel by the earlier
    // cell clicks — restore it unconditionally (the button itself lives in
    // the hidden panel, so a :visible check would skip the restore).
    await page.evaluate(() => document.getElementById('back-to-blocks-btn')?.click());
    await page.waitForTimeout(300);
    const blendBlockOptions = await page.evaluate(() =>
      ['set-blend', 'stop-blend', 'blend-active-condition'].map(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('Blend blocks are in the palette (Set Blend / Stop Blend / Blend Active)',
      blendBlockOptions.every(Boolean), JSON.stringify(blendBlockOptions));
    const setBlendBefore = await page.locator('#grid [data-block-type="set-blend"]').count();
    await page.click('.block-selector .block-option[data-block-type="set-blend"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-blend"]').length > n,
      setBlendBefore, { timeout: 5000 }).catch(() => {});
    const setBlendCell = page.locator('#grid [data-block-type="set-blend"]').first();
    check('Set Blend block places on the grid', await setBlendCell.count() === 1);
    await setBlendCell.click();
    await page.waitForTimeout(400);
    const setBlendPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Set Blend panel offers Object + Blend + X + Y fields',
      /Object/i.test(setBlendPropText) && /Blend/i.test(setBlendPropText) &&
      /(^|\s)X:/i.test(setBlendPropText) && /(^|\s)Y:/i.test(setBlendPropText),
      setBlendPropText.slice(0, 200));
    await page.click('#back-to-blocks-btn');
    const blendActiveBefore = await page.locator('#grid [data-block-type="blend-active-condition"]').count();
    await page.click('.block-selector .block-option[data-block-type="blend-active-condition"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="blend-active-condition"]').length > n,
      blendActiveBefore, { timeout: 5000 }).catch(() => {});
    const blendActiveCell = page.locator('#grid [data-block-type="blend-active-condition"]').first();
    check('Blend Active block places on the grid', await blendActiveCell.count() === 1);
    await blendActiveCell.click();
    await page.waitForTimeout(400);
    const blendActivePropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Blend Active panel offers Blend + Invert fields',
      /Blend/i.test(blendActivePropText) && /Invert/i.test(blendActivePropText),
      blendActivePropText.slice(0, 200));

    // P4 Advanced (2D lighting/shadows): the module, the three palette
    // blocks, the Inspector Lighting section, the Light create button
    // in a 2D scene, and the Scene Settings darkness slider.
    const hydraLight2dLoaded = await page.evaluate(() =>
      typeof window.HydraLight2d !== 'undefined' &&
      typeof window.HydraLight2d.drawDarkness === 'function' &&
      typeof window.HydraLight2d.shadowPolygon === 'function' &&
      typeof window.HydraLight2d.normalizeLight2d === 'function');
    check('HydraLight2d module is loaded in the editor', hydraLight2dLoaded);
    const lightingBlocks = await page.evaluate(() =>
      ['set-darkness', 'set-light-2d', 'darkness-level-condition'].map(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('Lighting blocks are in the palette (Set Darkness / Set Light / Darkness Level)',
      lightingBlocks.every(Boolean), JSON.stringify(lightingBlocks));
    const lightingCategory = await page.evaluate(() =>
      [...document.querySelectorAll('.block-selector .block-category-label')]
        .some(el => el.textContent.trim() === 'Lighting'));
    check('Lighting blocks sit under a Lighting palette category', lightingCategory);
    // The Blend Active panel check left the properties panel over the
    // palette — restore it unconditionally (same pattern as the blend
    // section: the button itself lives in the hidden panel).
    await page.evaluate(() => document.getElementById('back-to-blocks-btn')?.click());
    await page.waitForTimeout(300);
    const setDarknessBefore = await page.locator('#grid [data-block-type="set-darkness"]').count();
    await page.click('.block-selector .block-option[data-block-type="set-darkness"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-darkness"]').length > n,
      setDarknessBefore, { timeout: 5000 }).catch(() => {});
    const setDarknessCell = page.locator('#grid [data-block-type="set-darkness"]').first();
    check('Set Darkness block places on the grid', await setDarknessCell.count() === 1);
    await setDarknessCell.click();
    await page.waitForTimeout(400);
    const setDarknessPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Set Darkness panel offers the Darkness field',
      /Darkness/i.test(setDarknessPropText), setDarknessPropText.slice(0, 200));
    await page.click('#back-to-blocks-btn');
    const setLightBefore = await page.locator('#grid [data-block-type="set-light-2d"]').count();
    await page.click('.block-selector .block-option[data-block-type="set-light-2d"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-light-2d"]').length > n,
      setLightBefore, { timeout: 5000 }).catch(() => {});
    const setLightCell = page.locator('#grid [data-block-type="set-light-2d"]').first();
    check('Set Light block places on the grid', await setLightCell.count() === 1);
    await setLightCell.click();
    await page.waitForTimeout(400);
    const setLightPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Set Light panel offers Object + Radius + Color + Light fields',
      /Object/i.test(setLightPropText) && /Radius/i.test(setLightPropText) &&
      /Color/i.test(setLightPropText) && /Light/i.test(setLightPropText),
      setLightPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const darknessLevelBefore = await page.locator('#grid [data-block-type="darkness-level-condition"]').count();
    await page.click('.block-selector .block-option[data-block-type="darkness-level-condition"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="darkness-level-condition"]').length > n,
      darknessLevelBefore, { timeout: 5000 }).catch(() => {});
    const darknessLevelCell = page.locator('#grid [data-block-type="darkness-level-condition"]').first();
    check('Darkness Level block places on the grid', await darknessLevelCell.count() === 1);
    await darknessLevelCell.click();
    await page.waitForTimeout(400);
    const darknessLevelPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Darkness Level panel offers Darkness + Operator + Invert fields',
      /Darkness/i.test(darknessLevelPropText) && /Operator/i.test(darknessLevelPropText) &&
      /Invert/i.test(darknessLevelPropText), darknessLevelPropText.slice(0, 300));
    // Scene tab: switch back to a 2D scene (the 3D-light section left it
    // in 3D), then the Light button creates a 2D light with a bulb glyph,
    // and its Inspector shows the Lighting section.
    await page.click('.tab[data-tab="scene-tab"]');
    await page.click('.inspector-tab[data-inspector-tab="world"]');
    await page.waitForSelector('#scene-render-mode', { timeout: 5000 });
    await page.selectOption('#scene-render-mode', '2d');
    await page.click('.inspector-tab[data-inspector-tab="create"]');
    await page.waitForSelector('.object-create-btn[data-create-kind="light"]', { timeout: 10000 });
    await page.click('.object-create-btn[data-create-kind="light"]');
    await page.waitForSelector('.game-object.light2d-object', { timeout: 5000 });
    check('Light button creates a 2D light object in a 2D scene', true);
    const lightGlyph = await page.evaluate(() =>
      !!document.querySelector('.game-object.light2d-object .light2d-glyph'));
    check('2D light shows a bulb glyph in the scene editor', lightGlyph);
    const lightingSectionText = await page.evaluate(() =>
      document.getElementById('object-properties')?.innerText || '');
    check('Inspector shows the Lighting section for 2D lights',
      /Lighting/i.test(lightingSectionText) && /Emit light/i.test(lightingSectionText) &&
      /Light radius/i.test(lightingSectionText) && /Cast shadow/i.test(lightingSectionText),
      lightingSectionText.slice(0, 300));
    // Scene Settings: the darkness slider writes the scene darkness.
    await page.click('.inspector-tab[data-inspector-tab="world"]');
    await page.waitForSelector('#scene-darkness', { timeout: 5000 });
    await page.evaluate(() => {
      const el = document.getElementById('scene-darkness');
      el.value = '80';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(300);
    const sceneDarkness = await page.evaluate(() =>
      (typeof window.getCurrentScene === 'function' ? window.getCurrentScene() : null)?.darkness);
    check('Scene Settings darkness slider writes scene.darkness', sceneDarkness === 0.8,
      `darkness=${sceneDarkness}`);

    // P4 Advanced (physics joints): the module, the three palette
    // blocks, and the Inspector Joints section with add-joint.
    await page.click('.tab[data-tab="script-tab"]');
    await page.waitForTimeout(500);
    const hydraJointsLoaded = await page.evaluate(() =>
      typeof window.HydraJoints !== 'undefined' &&
      typeof window.HydraJoints.solveJoints === 'function' &&
      typeof window.HydraJoints.normalizeJoints === 'function' &&
      typeof window.HydraJoints.applyJointAction === 'function');
    check('HydraJoints module is loaded in the editor', hydraJointsLoaded);
    await page.evaluate(() => document.getElementById('back-to-blocks-btn')?.click());
    await page.waitForTimeout(300);
    const jointBlocks = await page.evaluate(() =>
      ['create-joint', 'remove-joint', 'joint-connected-condition'].map(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('Physics blocks are in the palette (Create Joint / Remove Joint / Joint Connected)',
      jointBlocks.every(Boolean), JSON.stringify(jointBlocks));
    const physicsCategory = await page.evaluate(() =>
      [...document.querySelectorAll('.block-selector .block-category-label')]
        .some(el => el.textContent.trim() === 'Physics'));
    check('Joint blocks sit under a Physics palette category', physicsCategory);
    const createJointBefore = await page.locator('#grid [data-block-type="create-joint"]').count();
    await page.click('.block-selector .block-option[data-block-type="create-joint"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="create-joint"]').length > n,
      createJointBefore, { timeout: 5000 }).catch(() => {});
    const createJointCell = page.locator('#grid [data-block-type="create-joint"]').first();
    check('Create Joint block places on the grid', await createJointCell.count() === 1);
    await createJointCell.click();
    await page.waitForTimeout(400);
    const createJointPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Create Joint panel offers Object A + Object B + Joint type + Length + Stiffness fields',
      /Object A/i.test(createJointPropText) && /Object B/i.test(createJointPropText) &&
      /Joint type/i.test(createJointPropText) && /Length/i.test(createJointPropText) &&
      /Stiffness/i.test(createJointPropText),
      createJointPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const jointConnectedBefore = await page.locator('#grid [data-block-type="joint-connected-condition"]').count();
    await page.click('.block-selector .block-option[data-block-type="joint-connected-condition"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="joint-connected-condition"]').length > n,
      jointConnectedBefore, { timeout: 5000 }).catch(() => {});
    const jointConnectedCell = page.locator('#grid [data-block-type="joint-connected-condition"]').first();
    check('Joint Connected block places on the grid', await jointConnectedCell.count() === 1);
    await jointConnectedCell.click();
    await page.waitForTimeout(400);
    const jointConnectedPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Joint Connected panel offers Object A + Object B + Invert fields',
      /Object A/i.test(jointConnectedPropText) && /Object B/i.test(jointConnectedPropText) &&
      /Invert/i.test(jointConnectedPropText),
      jointConnectedPropText.slice(0, 300));
    // Scene tab: a fresh sprite is auto-selected, but fresh sprites
    // start unnamed — and joints link objects by name, so the Joints
    // section asks for a name first. Name it, re-select to re-render
    // the panel, and the section shows the add-joint form.
    await page.click('.tab[data-tab="scene-tab"]');
    await page.click('.inspector-tab[data-inspector-tab="create"]');
    await page.waitForSelector('.object-create-btn[data-create-kind="sprite"]', { timeout: 10000 });
    await page.click('.object-create-btn[data-create-kind="sprite"]');
    const jointsNameNote = await page.waitForFunction(
      () => /give this object a name/i.test(document.getElementById('object-properties')?.innerText || ''),
      { timeout: 30000 }).then(() => true).catch(() => false);
    check('Joints section asks for a name on an unnamed sprite', jointsNameNote);
    await page.evaluate(() => {
      const input = document.querySelector('#object-properties input[placeholder="e.g. player, wall1, score_text"]');
      if (input) {
        input.value = 'jointBall';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await page.waitForTimeout(300);
    // Re-select through the object list to re-render the panel with
    // the add-joint form (the name edit alone does not re-render it).
    // The list lives in the Hierarchy panel, not the Create panel.
    await page.click('.inspector-tab[data-inspector-tab="objects"]');
    await page.locator('#scene-object-list .object-list-item', { hasText: 'jointBall' }).first().click();
    await page.waitForTimeout(300);
    const jointsSettled = await page.waitForFunction(
      () => /Other object/i.test(document.getElementById('object-properties')?.innerText || ''),
      { timeout: 30000 }).then(() => true).catch(() => false);
    const jointsPropText = await page.evaluate(() =>
      document.getElementById('object-properties')?.innerText || '');
    check('Inspector shows the Joints section for sprites',
      jointsSettled && /Other object/i.test(jointsPropText) &&
      /Joint type/i.test(jointsPropText) && /Add joint/i.test(jointsPropText),
      jointsPropText.slice(0, 300));
    await page.getByRole('button', { name: '+ Add joint' }).click();
    await page.waitForTimeout(500);
    const jointAddedDetail = await page.evaluate(() => {
      const scene = typeof window.getCurrentScene === 'function' ? window.getCurrentScene() : null;
      return JSON.stringify(scene?.joints || null);
    });
    const jointAdded = await page.evaluate(() => {
      const scene = typeof window.getCurrentScene === 'function' ? window.getCurrentScene() : null;
      const joints = scene?.joints || [];
      return joints.length === 1 && joints[0].type === 'rope' &&
        typeof joints[0].length === 'number' && Number.isFinite(joints[0].length) &&
        joints[0].length >= 0 && (joints[0].a === 'jointBall' || joints[0].b === 'jointBall');
    });
    check('adding a joint writes a rope joint with a captured length to the scene', jointAdded,
      jointAddedDetail);

    // P4 Advanced (skeletal animation): the module, the four palette
    // blocks, and the Inspector Skeleton section with add-bone and
    // add-animation.
    await page.click('.tab[data-tab="script-tab"]');
    await page.waitForTimeout(500);
    const hydraSkeletonLoaded = await page.evaluate(() =>
      typeof window.HydraSkeleton !== 'undefined' &&
      typeof window.HydraSkeleton.setSkeletonAnimation === 'function' &&
      typeof window.HydraSkeleton.normalizeSkeleton === 'function' &&
      typeof window.HydraSkeleton.drawSkeleton === 'function');
    check('HydraSkeleton module is loaded in the editor', hydraSkeletonLoaded);
    await page.evaluate(() => document.getElementById('back-to-blocks-btn')?.click());
    await page.waitForTimeout(300);
    const skeletonBlocks = await page.evaluate(() =>
      ['play-skeleton-animation', 'stop-skeleton-animation', 'set-bone-angle', 'skeleton-playing-condition'].map(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('Skeleton blocks are in the palette (Play / Stop / Set Bone Angle / Skeleton Playing)',
      skeletonBlocks.every(Boolean), JSON.stringify(skeletonBlocks));
    const skeletonCategory = await page.evaluate(() =>
      [...document.querySelectorAll('.block-selector .block-category-label')]
        .some(el => el.textContent.trim() === 'Skeleton'));
    check('Skeleton blocks sit under a Skeleton palette category', skeletonCategory);
    const playSkelBefore = await page.locator('#grid [data-block-type="play-skeleton-animation"]').count();
    await page.click('.block-selector .block-option[data-block-type="play-skeleton-animation"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="play-skeleton-animation"]').length > n,
      playSkelBefore, { timeout: 5000 }).catch(() => {});
    const playSkelCell = page.locator('#grid [data-block-type="play-skeleton-animation"]').first();
    check('Play Skeleton Animation block places on the grid', await playSkelCell.count() === 1);
    await playSkelCell.click();
    await page.waitForTimeout(400);
    const playSkelPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Play Skeleton Animation panel offers Object + Animation fields',
      /Object/i.test(playSkelPropText) && /Animation/i.test(playSkelPropText),
      playSkelPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const setBoneBefore = await page.locator('#grid [data-block-type="set-bone-angle"]').count();
    await page.click('.block-selector .block-option[data-block-type="set-bone-angle"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-bone-angle"]').length > n,
      setBoneBefore, { timeout: 5000 }).catch(() => {});
    const setBoneCell = page.locator('#grid [data-block-type="set-bone-angle"]').first();
    check('Set Bone Angle block places on the grid', await setBoneCell.count() === 1);
    await setBoneCell.click();
    await page.waitForTimeout(400);
    const setBonePropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Set Bone Angle panel offers Object + Bone + Angle fields',
      /Object/i.test(setBonePropText) && /Bone/i.test(setBonePropText) && /Angle/i.test(setBonePropText),
      setBonePropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const skelPlayingBefore = await page.locator('#grid [data-block-type="skeleton-playing-condition"]').count();
    await page.click('.block-selector .block-option[data-block-type="skeleton-playing-condition"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="skeleton-playing-condition"]').length > n,
      skelPlayingBefore, { timeout: 5000 }).catch(() => {});
    const skelPlayingCell = page.locator('#grid [data-block-type="skeleton-playing-condition"]').first();
    check('Skeleton Playing block places on the grid', await skelPlayingCell.count() === 1);
    await skelPlayingCell.click();
    await page.waitForTimeout(400);
    const skelPlayingPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Skeleton Playing panel offers Object + Animation + Invert fields',
      /Object/i.test(skelPlayingPropText) && /Animation/i.test(skelPlayingPropText) && /Invert/i.test(skelPlayingPropText),
      skelPlayingPropText.slice(0, 300));
    // Scene tab: a fresh sprite shows the Skeleton section with the
    // hide-sprite toggle and the add buttons (bones live on the object,
    // so no name is needed first, unlike joints).
    await page.click('.tab[data-tab="scene-tab"]');
    await page.click('.inspector-tab[data-inspector-tab="create"]');
    await page.waitForSelector('.object-create-btn[data-create-kind="sprite"]', { timeout: 10000 });
    await page.click('.object-create-btn[data-create-kind="sprite"]');
    const skelSettled = await page.waitForFunction(
      () => !!document.querySelector('.skeleton-editor'),
      { timeout: 30000 }).then(() => true).catch(() => false);
    const skelPropText = await page.evaluate(() =>
      document.querySelector('.skeleton-editor')?.innerText || '');
    check('Inspector shows the Skeleton section for sprites',
      skelSettled && /Hide sprite/i.test(skelPropText) && /Add bone/i.test(skelPropText) &&
      /Add animation/i.test(skelPropText),
      skelPropText.slice(0, 300));
    await page.locator('.skeleton-editor button', { hasText: '+ Add bone' }).click();
    await page.waitForTimeout(500);
    const boneCardText = await page.evaluate(() =>
      document.querySelector('.skeleton-editor')?.innerText || '');
    check('adding a bone shows a bone card with Parent + Length fields',
      /Parent/i.test(boneCardText) && /Length/i.test(boneCardText),
      boneCardText.slice(0, 300));
    await page.locator('.skeleton-editor button', { hasText: '+ Add animation' }).click();
    await page.waitForTimeout(500);
    const animCardText = await page.evaluate(() =>
      document.querySelector('.skeleton-editor')?.innerText || '');
    check('adding an animation shows an animation card with Speed + Mode fields',
      /Speed \(fps\)/i.test(animCardText) && /Mode/i.test(animCardText),
      animCardText.slice(0, 300));

    // P4 Advanced batch 6 (localization): the shared module, the four
    // palette blocks under a Localization category, placement + panels,
    // the Localization tab with its default-language row and add-string
    // flow, and the text Inspector's Localization key field.
    await page.click('.tab[data-tab="script-tab"]');
    await page.waitForTimeout(500);
    const hydraLocalizationLoaded = await page.evaluate(() =>
      typeof window.HydraLocalization !== 'undefined' &&
      typeof window.HydraLocalization.resolveLocalized === 'function' &&
      typeof window.HydraLocalization.normalizeLocalization === 'function' &&
      typeof window.HydraLocalization.boundTextFor === 'function');
    check('HydraLocalization module is loaded in the editor', hydraLocalizationLoaded);
    await page.evaluate(() => document.getElementById('back-to-blocks-btn')?.click());
    await page.waitForTimeout(300);
    const localizationBlocks = await page.evaluate(() =>
      ['set-language', 'set-text-from-key', 'set-variable-from-key', 'language-is-condition'].map(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('Localization blocks are in the palette (Set Language / Set Text from Key / Set Variable from Key / Language Is)',
      localizationBlocks.every(Boolean), JSON.stringify(localizationBlocks));
    const localizationCategory = await page.evaluate(() =>
      [...document.querySelectorAll('.block-selector .block-category-label')]
        .some(el => el.textContent.trim() === 'Localization'));
    check('Localization blocks sit under a Localization palette category', localizationCategory);
    const setLangBefore = await page.locator('#grid [data-block-type="set-language"]').count();
    await page.click('.block-selector .block-option[data-block-type="set-language"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-language"]').length > n,
      setLangBefore, { timeout: 5000 }).catch(() => {});
    const setLangCell = page.locator('#grid [data-block-type="set-language"]').first();
    check('Set Language block places on the grid', await setLangCell.count() === 1);
    await setLangCell.click();
    await page.waitForTimeout(400);
    const setLangPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Set Language panel offers a Language field',
      /Language/i.test(setLangPropText),
      setLangPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const langIsBefore = await page.locator('#grid [data-block-type="language-is-condition"]').count();
    await page.click('.block-selector .block-option[data-block-type="language-is-condition"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="language-is-condition"]').length > n,
      langIsBefore, { timeout: 5000 }).catch(() => {});
    const langIsCell = page.locator('#grid [data-block-type="language-is-condition"]').first();
    check('Language Is block places on the grid', await langIsCell.count() === 1);
    await langIsCell.click();
    await page.waitForTimeout(400);
    const langIsPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Language Is panel offers Language + Invert fields',
      /Language/i.test(langIsPropText) && /Invert/i.test(langIsPropText),
      langIsPropText.slice(0, 300));
    // Scene tab: the Localization tab shows the default-language row,
    // the language list, and the string list; adding a string creates
    // a key card; a fresh text object shows the Localization key field.
    await page.click('.tab[data-tab="scene-tab"]');
    await page.click('.inspector-tab[data-inspector-tab="localization"]');
    await page.waitForTimeout(500);
    const locPanelText = await page.evaluate(() =>
      document.getElementById('localization-panel')?.innerText || '');
    check('Localization tab shows Default language + Languages + Strings',
      /Default language/i.test(locPanelText) && /Languages/i.test(locPanelText) &&
      /Strings/i.test(locPanelText),
      locPanelText.slice(0, 300));
    await page.click('#localization-add-entry-btn');
    await page.waitForTimeout(500);
    const addedKey = await page.evaluate(() => {
      const inputs = [...document.querySelectorAll('#localization-panel input')];
      const keyInput = inputs.find(i => /^string_/.test(i.value || ''));
      return keyInput ? keyInput.value : '';
    });
    check('adding a string shows a key card with an auto key', /^string_/.test(addedKey), addedKey);
    await page.click('.inspector-tab[data-inspector-tab="create"]');
    await page.waitForSelector('.object-create-btn[data-create-kind="text"]', { timeout: 10000 });
    await page.click('.object-create-btn[data-create-kind="text"]');
    const locKeySettled = await page.waitForFunction(
      () => (document.getElementById('obj-properties-section')?.innerText || '').includes('Localization key'),
      { timeout: 30000 }).then(() => true).catch(() => false);
    const locKeyText = await page.evaluate(() =>
      document.getElementById('obj-properties-section')?.innerText || '');
    check('Inspector shows the Localization key field for text objects',
      locKeySettled && /Localization key/i.test(locKeyText),
      locKeyText.slice(0, 300));

    // P4 Advanced batch 7 (dialogue): the shared module, the eight
    // palette blocks under a Dialogue category, placement + panels,
    // and the Dialogues tab with its add-dialogue flow.
    await page.click('.tab[data-tab="script-tab"]');
    await page.waitForTimeout(500);
    const hydraDialogueLoaded = await page.evaluate(() =>
      typeof window.HydraDialogue !== 'undefined' &&
      typeof window.HydraDialogue.createDialogueRuntime === 'function' &&
      typeof window.HydraDialogue.startDialogue === 'function' &&
      typeof window.HydraDialogue.normalizeDialogues === 'function');
    check('HydraDialogue module is loaded in the editor', hydraDialogueLoaded);
    await page.evaluate(() => document.getElementById('back-to-blocks-btn')?.click());
    await page.waitForTimeout(300);
    const dialogueBlocks = await page.evaluate(() =>
      ['start-dialogue', 'advance-dialogue', 'choose-dialogue-option', 'stop-dialogue',
       'set-dialogue-choice-text', 'dialogue-active-condition',
       'dialogue-waiting-choice-condition', 'dialogue-choice-available-condition'].map(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('Dialogue blocks are in the palette (Start / Advance / Choose / Stop / Set Choice Text / Active / Waiting / Choice Available)',
      dialogueBlocks.every(Boolean), JSON.stringify(dialogueBlocks));
    const dialogueCategory = await page.evaluate(() =>
      [...document.querySelectorAll('.block-selector .block-category-label')]
        .some(el => el.textContent.trim() === 'Dialogue'));
    check('Dialogue blocks sit under a Dialogue palette category', dialogueCategory);
    const startDlgBefore = await page.locator('#grid [data-block-type="start-dialogue"]').count();
    await page.click('.block-selector .block-option[data-block-type="start-dialogue"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="start-dialogue"]').length > n,
      startDlgBefore, { timeout: 5000 }).catch(() => {});
    const startDlgCell = page.locator('#grid [data-block-type="start-dialogue"]').first();
    check('Start Dialogue block places on the grid', await startDlgCell.count() === 1);
    await startDlgCell.click();
    await page.waitForTimeout(400);
    const startDlgPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Start Dialogue panel offers Dialogue + Speaker + Line + Typing Speed fields',
      /Dialogue/i.test(startDlgPropText) && /Speaker text object/i.test(startDlgPropText) &&
      /Line text object/i.test(startDlgPropText) && /Typing speed/i.test(startDlgPropText),
      startDlgPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const dlgActiveBefore = await page.locator('#grid [data-block-type="dialogue-active-condition"]').count();
    await page.click('.block-selector .block-option[data-block-type="dialogue-active-condition"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="dialogue-active-condition"]').length > n,
      dlgActiveBefore, { timeout: 5000 }).catch(() => {});
    const dlgActiveCell = page.locator('#grid [data-block-type="dialogue-active-condition"]').first();
    check('Dialogue Active block places on the grid', await dlgActiveCell.count() === 1);
    await dlgActiveCell.click();
    await page.waitForTimeout(400);
    const dlgActivePropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Dialogue Active panel offers an Invert field',
      /Invert/i.test(dlgActivePropText),
      dlgActivePropText.slice(0, 300));
    // Scene tab: the Dialogues tab shows its hint and add button;
    // adding a dialogue creates a named card with a first line.
    await page.click('.tab[data-tab="scene-tab"]');
    await page.click('.inspector-tab[data-inspector-tab="dialogues"]');
    await page.waitForTimeout(500);
    const dlgPanelText = await page.evaluate(() =>
      document.getElementById('dialogues-panel')?.parentElement?.innerText || '');
    check('Dialogues tab shows its hint and Add button',
      /Named conversations/i.test(dlgPanelText) &&
      await page.locator('#dialogues-add-btn').count() === 1,
      dlgPanelText.slice(0, 300));
    await page.click('#dialogues-add-btn');
    await page.waitForTimeout(500);
    const addedDialogue = await page.evaluate(() => {
      const inputs = [...document.querySelectorAll('#dialogues-panel input')];
      return {
        name: inputs.length ? inputs[0].value : '',
        text: document.getElementById('dialogues-panel')?.innerText || ''
      };
    });
    check('adding a dialogue shows a named card with a first line',
      addedDialogue.name === 'Dialogue 1' && /Line 1/i.test(addedDialogue.text),
      JSON.stringify(addedDialogue));
    const addedDialogueControls = await page.evaluate(() => {
      const panel = document.getElementById('dialogues-panel');
      return {
        placeholders: [...panel.querySelectorAll('input')].map(i => i.placeholder || ''),
        buttons: [...panel.querySelectorAll('button')].map(b => b.textContent.trim())
      };
    });
    check('the new dialogue card offers Speaker + text inputs and add-line/add-choice controls',
      addedDialogueControls.placeholders.includes('Speaker') &&
      addedDialogueControls.placeholders.includes('What they say') &&
      addedDialogueControls.buttons.includes('Line') &&
      addedDialogueControls.buttons.includes('Choice'),
      JSON.stringify(addedDialogueControls));

    // ---- P4 Advanced batch 8 (inventory): the shared module, the seven
    // palette blocks under an Inventory category, placement + panels,
    // and the Items tab with its add-item flow.
    const hydraInventoryLoaded = await page.evaluate(() =>
      typeof window.HydraInventory !== 'undefined' &&
      typeof window.HydraInventory.createInventoryRuntime === 'function' &&
      typeof window.HydraInventory.addItem === 'function' &&
      typeof window.HydraInventory.normalizeItems === 'function');
    check('HydraInventory module is loaded in the editor', hydraInventoryLoaded);
    await page.click('.tab[data-tab="script-tab"]');
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const inventoryBlocks = await page.evaluate(() =>
      ['add-item', 'remove-item', 'set-item-count', 'read-item-count',
       'clear-inventory', 'has-item-condition', 'item-count-condition'].map(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('Inventory blocks are in the palette (Add / Remove / Set / Read / Clear / Has / Count)',
      inventoryBlocks.every(Boolean), JSON.stringify(inventoryBlocks));
    const inventoryCategory = await page.evaluate(() =>
      [...document.querySelectorAll('.block-selector .block-category-label')]
        .some(el => el.textContent.trim() === 'Inventory'));
    check('Inventory blocks sit under an Inventory palette category', inventoryCategory);
    const addItemBefore = await page.locator('#grid [data-block-type="add-item"]').count();
    await page.click('.block-selector .block-option[data-block-type="add-item"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="add-item"]').length > n,
      addItemBefore);
    const addItemCell = page.locator('#grid [data-block-type="add-item"]').first();
    check('Add Item block places on the grid', await addItemCell.count() === 1);
    await addItemCell.click();
    await page.waitForTimeout(400);
    const addItemPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Add Item panel offers Item + Count fields',
      /Item/i.test(addItemPropText) && /Count/i.test(addItemPropText),
      addItemPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const hasItemBefore = await page.locator('#grid [data-block-type="has-item-condition"]').count();
    await page.click('.block-selector .block-option[data-block-type="has-item-condition"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="has-item-condition"]').length > n,
      hasItemBefore);
    const hasItemCell = page.locator('#grid [data-block-type="has-item-condition"]').first();
    check('Has Item block places on the grid', await hasItemCell.count() === 1);
    await hasItemCell.click();
    await page.waitForTimeout(400);
    const hasItemPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Has Item panel offers Item + At least + Invert fields',
      /Item/i.test(hasItemPropText) && /At least/i.test(hasItemPropText) &&
      /Invert/i.test(hasItemPropText),
      hasItemPropText.slice(0, 300));
    // Scene tab: the Items tab shows its hint and add button;
    // adding an item creates a named card with max stack + description.
    await page.click('.tab[data-tab="scene-tab"]');
    await page.click('.inspector-tab[data-inspector-tab="items"]');
    await page.waitForTimeout(500);
    const itemsPanelText = await page.evaluate(() =>
      document.getElementById('items-panel')?.parentElement?.innerText || '');
    check('Items tab shows its hint and Add button',
      /Named items/i.test(itemsPanelText) &&
      await page.locator('#items-add-btn').count() === 1,
      itemsPanelText.slice(0, 300));
    await page.click('#items-add-btn');
    await page.waitForTimeout(500);
    const addedItem = await page.evaluate(() => {
      const inputs = [...document.querySelectorAll('#items-panel input')];
      return {
        name: inputs.length ? inputs[0].value : '',
        text: document.getElementById('items-panel')?.innerText || ''
      };
    });
    check('adding an item shows a named card with a max stack',
      addedItem.name === 'Item 1' && /Max stack/i.test(addedItem.text),
      JSON.stringify(addedItem));
    const addedItemControls = await page.evaluate(() => {
      const panel = document.getElementById('items-panel');
      return {
        placeholders: [...panel.querySelectorAll('input')].map(i => i.placeholder || ''),
        values: [...panel.querySelectorAll('input')].map(i => i.value || '')
      };
    });
    check('the new item card offers a description input and a 99 max stack',
      addedItemControls.placeholders.some(p => /What it is/i.test(p)) &&
      addedItemControls.values.includes('99'),
      JSON.stringify(addedItemControls));

    // ---- P4 Advanced batch 9 (quests): the shared module, the eight
    // palette blocks under a Quest category, placement + panels,
    // and the Quests tab with its add-quest flow.
    const hydraQuestLoaded = await page.evaluate(() =>
      typeof window.HydraQuest !== 'undefined' &&
      typeof window.HydraQuest.createQuestRuntime === 'function' &&
      typeof window.HydraQuest.addQuestProgress === 'function' &&
      typeof window.HydraQuest.normalizeQuests === 'function');
    check('HydraQuest module is loaded in the editor', hydraQuestLoaded);
    await page.click('.tab[data-tab="script-tab"]');
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const questBlocks = await page.evaluate(() =>
      ['add-quest-progress', 'set-quest-progress', 'complete-quest', 'reset-quest',
       'read-quest-progress', 'clear-quests', 'quest-complete-condition',
       'quest-progress-condition'].map(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('Quest blocks are in the palette (Add / Set / Complete / Reset / Read / Clear / Complete? / Progress?)',
      questBlocks.every(Boolean), JSON.stringify(questBlocks));
    const questCategory = await page.evaluate(() =>
      [...document.querySelectorAll('.block-selector .block-category-label')]
        .some(el => el.textContent.trim() === 'Quest'));
    check('Quest blocks sit under a Quest palette category', questCategory);
    const addQuestBefore = await page.locator('#grid [data-block-type="add-quest-progress"]').count();
    await page.click('.block-selector .block-option[data-block-type="add-quest-progress"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="add-quest-progress"]').length > n,
      addQuestBefore);
    const addQuestCell = page.locator('#grid [data-block-type="add-quest-progress"]').first();
    check('Add Quest Progress block places on the grid', await addQuestCell.count() === 1);
    await addQuestCell.click();
    await page.waitForTimeout(400);
    const addQuestPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Add Quest Progress panel offers Quest + Amount fields',
      /Quest/i.test(addQuestPropText) && /Amount/i.test(addQuestPropText),
      addQuestPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const questCompleteBefore = await page.locator('#grid [data-block-type="quest-complete-condition"]').count();
    await page.click('.block-selector .block-option[data-block-type="quest-complete-condition"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="quest-complete-condition"]').length > n,
      questCompleteBefore);
    const questCompleteCell = page.locator('#grid [data-block-type="quest-complete-condition"]').first();
    check('Quest Complete block places on the grid', await questCompleteCell.count() === 1);
    await questCompleteCell.click();
    await page.waitForTimeout(400);
    const questCompletePropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Quest Complete panel offers Quest + Invert fields',
      /Quest/i.test(questCompletePropText) && /Invert/i.test(questCompletePropText),
      questCompletePropText.slice(0, 300));
    // Scene tab: the Quests tab shows its hint and add button;
    // adding a quest creates a named card with a target + description.
    await page.click('.tab[data-tab="scene-tab"]');
    await page.click('.inspector-tab[data-inspector-tab="quests"]');
    await page.waitForTimeout(500);
    const questsPanelText = await page.evaluate(() =>
      document.getElementById('quests-panel')?.parentElement?.innerText || '');
    check('Quests tab shows its hint and Add button',
      /Named objectives/i.test(questsPanelText) &&
      await page.locator('#quests-add-btn').count() === 1,
      questsPanelText.slice(0, 300));
    await page.click('#quests-add-btn');
    await page.waitForTimeout(500);
    const addedQuest = await page.evaluate(() => {
      const inputs = [...document.querySelectorAll('#quests-panel input')];
      return {
        name: inputs.length ? inputs[0].value : '',
        text: document.getElementById('quests-panel')?.innerText || ''
      };
    });
    check('adding a quest shows a named card with a target',
      addedQuest.name === 'Quest 1' && /Target/i.test(addedQuest.text),
      JSON.stringify(addedQuest));
    const addedQuestControls = await page.evaluate(() => {
      const panel = document.getElementById('quests-panel');
      return {
        placeholders: [...panel.querySelectorAll('input')].map(i => i.placeholder || ''),
        values: [...panel.querySelectorAll('input')].map(i => i.value || '')
      };
    });
    check('the new quest card offers a description input and a 1 target',
      addedQuestControls.placeholders.some(p => /What it is/i.test(p)) &&
      addedQuestControls.values.includes('1'),
      JSON.stringify(addedQuestControls));

    // ---- P4 Advanced batch 10 (achievements): the shared module, the
    // six palette blocks under an Achievement category, placement +
    // panels, and the Achievements tab with its add-achievement flow.
    const hydraAchievementLoaded = await page.evaluate(() =>
      typeof window.HydraAchievement !== 'undefined' &&
      typeof window.HydraAchievement.createAchievementRuntime === 'function' &&
      typeof window.HydraAchievement.unlockAchievement === 'function' &&
      typeof window.HydraAchievement.normalizeAchievements === 'function');
    check('HydraAchievement module is loaded in the editor', hydraAchievementLoaded);
    await page.click('.tab[data-tab="script-tab"]');
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const achievementBlocks = await page.evaluate(() =>
      ['unlock-achievement', 'lock-achievement', 'reset-achievements',
       'read-achievement-count', 'achievement-unlocked-condition',
       'achievement-count-condition'].map(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('Achievement blocks are in the palette (Unlock / Lock / Reset / Read / Unlocked? / Count?)',
      achievementBlocks.every(Boolean), JSON.stringify(achievementBlocks));
    const achievementCategory = await page.evaluate(() =>
      [...document.querySelectorAll('.block-selector .block-category-label')]
        .some(el => el.textContent.trim() === 'Achievement'));
    check('Achievement blocks sit under an Achievement palette category', achievementCategory);
    const unlockBefore = await page.locator('#grid [data-block-type="unlock-achievement"]').count();
    await page.click('.block-selector .block-option[data-block-type="unlock-achievement"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="unlock-achievement"]').length > n,
      unlockBefore);
    const unlockCell = page.locator('#grid [data-block-type="unlock-achievement"]').first();
    check('Unlock Achievement block places on the grid', await unlockCell.count() === 1);
    await unlockCell.click();
    await page.waitForTimeout(400);
    const unlockPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Unlock Achievement panel offers the Achievement field',
      /Achievement/i.test(unlockPropText),
      unlockPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const achUnlockedBefore = await page.locator('#grid [data-block-type="achievement-unlocked-condition"]').count();
    await page.click('.block-selector .block-option[data-block-type="achievement-unlocked-condition"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="achievement-unlocked-condition"]').length > n,
      achUnlockedBefore);
    const achUnlockedCell = page.locator('#grid [data-block-type="achievement-unlocked-condition"]').first();
    check('Achievement Unlocked block places on the grid', await achUnlockedCell.count() === 1);
    await achUnlockedCell.click();
    await page.waitForTimeout(400);
    const achUnlockedPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Achievement Unlocked panel offers Achievement + Invert fields',
      /Achievement/i.test(achUnlockedPropText) && /Invert/i.test(achUnlockedPropText),
      achUnlockedPropText.slice(0, 300));
    // Scene tab: the Achievements tab shows its hint and add button;
    // adding an achievement creates a named card with a description.
    await page.click('.tab[data-tab="scene-tab"]');
    await page.click('.inspector-tab[data-inspector-tab="achievements"]');
    await page.waitForTimeout(500);
    const achievementsPanelText = await page.evaluate(() =>
      document.getElementById('achievements-panel')?.parentElement?.innerText || '');
    check('Achievements tab shows its hint and Add button',
      /Permanent trophies/i.test(achievementsPanelText) &&
      await page.locator('#achievements-add-btn').count() === 1,
      achievementsPanelText.slice(0, 300));
    await page.click('#achievements-add-btn');
    await page.waitForTimeout(500);
    const addedAchievement = await page.evaluate(() => {
      const inputs = [...document.querySelectorAll('#achievements-panel input')];
      return {
        name: inputs.length ? inputs[0].value : '',
        text: document.getElementById('achievements-panel')?.innerText || ''
      };
    });
    check('adding an achievement shows a named card',
      addedAchievement.name === 'Achievement 1',
      JSON.stringify(addedAchievement));
    const addedAchievementControls = await page.evaluate(() => {
      const panel = document.getElementById('achievements-panel');
      return {
        placeholders: [...panel.querySelectorAll('input')].map(i => i.placeholder || ''),
        values: [...panel.querySelectorAll('input')].map(i => i.value || '')
      };
    });
    check('the new achievement card offers a description input',
      addedAchievementControls.placeholders.some(p => /What earns it/i.test(p)),
      JSON.stringify(addedAchievementControls));

    // ---- P4 Advanced batch 11 (cutscenes): the shared module, the
    // four palette blocks under a Cutscene category, placement +
    // panels, and the Cutscenes tab with its add-cutscene flow.
    const hydraCutsceneLoaded = await page.evaluate(() =>
      typeof window.HydraCutscene !== 'undefined' &&
      typeof window.HydraCutscene.createCutsceneRuntime === 'function' &&
      typeof window.HydraCutscene.normalizeCutscenes === 'function' &&
      typeof window.HydraCutscene.updateCutscene === 'function');
    check('HydraCutscene module is loaded in the editor', hydraCutsceneLoaded);
    await page.click('.tab[data-tab="script-tab"]');
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const cutsceneBlocks = await page.evaluate(() =>
      ['play-cutscene', 'stop-cutscene', 'cutscene-playing-condition',
       'cutscene-finished-condition'].map(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('Cutscene blocks are in the palette (Play / Stop / Playing? / Finished?)',
      cutsceneBlocks.every(Boolean), JSON.stringify(cutsceneBlocks));
    const cutsceneCategory = await page.evaluate(() =>
      [...document.querySelectorAll('.block-selector .block-category-label')]
        .some(el => el.textContent.trim() === 'Cutscene'));
    check('Cutscene blocks sit under a Cutscene palette category', cutsceneCategory);
    const playCineBefore = await page.locator('#grid [data-block-type="play-cutscene"]').count();
    await page.click('.block-selector .block-option[data-block-type="play-cutscene"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="play-cutscene"]').length > n,
      playCineBefore);
    const playCineCell = page.locator('#grid [data-block-type="play-cutscene"]').first();
    check('Play Cutscene block places on the grid', await playCineCell.count() === 1);
    await playCineCell.click();
    await page.waitForTimeout(400);
    const playCinePropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Play Cutscene panel offers the Cutscene field',
      /Cutscene/i.test(playCinePropText),
      playCinePropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const cinePlayingBefore = await page.locator('#grid [data-block-type="cutscene-playing-condition"]').count();
    await page.click('.block-selector .block-option[data-block-type="cutscene-playing-condition"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="cutscene-playing-condition"]').length > n,
      cinePlayingBefore);
    const cinePlayingCell = page.locator('#grid [data-block-type="cutscene-playing-condition"]').first();
    check('Cutscene Playing block places on the grid', await cinePlayingCell.count() === 1);
    await cinePlayingCell.click();
    await page.waitForTimeout(400);
    const cinePlayingPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Cutscene Playing panel offers Cutscene + Invert fields',
      /Cutscene/i.test(cinePlayingPropText) && /Invert/i.test(cinePlayingPropText),
      cinePlayingPropText.slice(0, 300));
    // Scene tab: the Cutscenes tab shows its hint and add button;
    // adding a cutscene creates a named card with a description and
    // a step list.
    await page.click('.tab[data-tab="scene-tab"]');
    await page.click('.inspector-tab[data-inspector-tab="cutscenes"]');
    await page.waitForTimeout(500);
    const cutscenesPanelText = await page.evaluate(() =>
      document.getElementById('cutscenes-panel')?.parentElement?.innerText || '');
    check('Cutscenes tab shows its hint and Add button',
      /Scripted scenes/i.test(cutscenesPanelText) &&
      await page.locator('#cutscenes-add-btn').count() === 1,
      cutscenesPanelText.slice(0, 300));
    await page.click('#cutscenes-add-btn');
    await page.waitForTimeout(500);
    const addedCutscene = await page.evaluate(() => {
      const inputs = [...document.querySelectorAll('#cutscenes-panel input')];
      return {
        name: inputs.length ? inputs[0].value : '',
        text: document.getElementById('cutscenes-panel')?.innerText || ''
      };
    });
    check('adding a cutscene shows a named card',
      addedCutscene.name === 'Cutscene 1',
      JSON.stringify(addedCutscene));
    const addedCutsceneControls = await page.evaluate(() => {
      const panel = document.getElementById('cutscenes-panel');
      return {
        stepButtons: [...panel.querySelectorAll('button')].map(b => b.innerText.trim()),
        hasKindSelect: panel.querySelectorAll('select').length > 0,
        placeholders: [...panel.querySelectorAll('input')].map(i => i.placeholder || '')
      };
    });
    check('the new cutscene card offers a description input and a + Step button',
      addedCutsceneControls.placeholders.some(p => /What it is/i.test(p)) &&
      addedCutsceneControls.stepButtons.some(t => t === 'Step'),
      JSON.stringify(addedCutsceneControls));
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('#cutscenes-panel button')]
        .find(b => b.innerText.trim() === 'Step');
      if (btn) btn.click();
    });
    await page.waitForTimeout(500);
    const addedStepControls = await page.evaluate(() => {
      const panel = document.getElementById('cutscenes-panel');
      const selects = [...panel.querySelectorAll('select')];
      return {
        selectCount: selects.length,
        options: selects.length ? [...selects[selects.length - 1].options].map(o => o.innerText.trim()) : []
      };
    });
    check('adding a step shows a kind select with the five step kinds',
      addedStepControls.selectCount > 0 &&
      ['Wait', 'Show text', 'Move object', 'Play sound', 'Switch scene']
        .every(k => addedStepControls.options.some(o => o.includes(k))),
      JSON.stringify(addedStepControls));

    // ---- P4 Advanced batch 12 (high scores): the shared module, the
    // five palette blocks under a High Score category, placement +
    // panels, and the High Scores tab with its config + stored board.
    const hydraHighScoreLoaded = await page.evaluate(() =>
      typeof window.HydraHighScore !== 'undefined' &&
      typeof window.HydraHighScore.createHighScoreRuntime === 'function' &&
      typeof window.HydraHighScore.submitScore === 'function' &&
      typeof window.HydraHighScore.normalizeHighScoreConfig === 'function');
    check('HydraHighScore module is loaded in the editor', hydraHighScoreLoaded);
    await page.click('.tab[data-tab="script-tab"]');
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const highScoreBlocks = await page.evaluate(() =>
      ['submit-score', 'clear-high-scores', 'read-high-score',
       'is-high-score-condition', 'high-score-count-condition'].map(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('High Score blocks are in the palette (Submit / Clear / Read / Is? / Count?)',
      highScoreBlocks.every(Boolean), JSON.stringify(highScoreBlocks));
    const highScoreCategory = await page.evaluate(() =>
      [...document.querySelectorAll('.block-selector .block-category-label')]
        .some(el => el.textContent.trim() === 'High Score'));
    check('High Score blocks sit under a High Score palette category', highScoreCategory);
    const submitBefore = await page.locator('#grid [data-block-type="submit-score"]').count();
    await page.click('.block-selector .block-option[data-block-type="submit-score"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="submit-score"]').length > n,
      submitBefore);
    const submitCell = page.locator('#grid [data-block-type="submit-score"]').first();
    check('Submit Score block places on the grid', await submitCell.count() === 1);
    await submitCell.click();
    await page.waitForTimeout(400);
    const submitPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Submit Score panel offers Score + Name fields',
      /Score/i.test(submitPropText) && /Name/i.test(submitPropText),
      submitPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const isHsBefore = await page.locator('#grid [data-block-type="is-high-score-condition"]').count();
    await page.click('.block-selector .block-option[data-block-type="is-high-score-condition"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="is-high-score-condition"]').length > n,
      isHsBefore);
    const isHsCell = page.locator('#grid [data-block-type="is-high-score-condition"]').first();
    check('Is High Score block places on the grid', await isHsCell.count() === 1);
    await isHsCell.click();
    await page.waitForTimeout(400);
    const isHsPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Is High Score panel offers Score + Invert fields',
      /Score/i.test(isHsPropText) && /Invert/i.test(isHsPropText),
      isHsPropText.slice(0, 300));
    // Scene tab: the High Scores tab shows its hint, the config
    // inputs, the empty-board note, and the Clear button.
    await page.click('.tab[data-tab="scene-tab"]');
    await page.click('.inspector-tab[data-inspector-tab="highscores"]');
    await page.waitForTimeout(500);
    const highScoresPanelText = await page.evaluate(() =>
      document.getElementById('highscores-panel')?.parentElement?.innerText || '');
    check('High Scores tab shows its hint and config',
      /ranked leaderboard/i.test(highScoresPanelText) &&
      /Max entries/i.test(highScoresPanelText),
      highScoresPanelText.slice(0, 300));
    const highScoresControls = await page.evaluate(() => {
      const panel = document.getElementById('highscores-panel');
      const inputs = [...panel.querySelectorAll('input')];
      return {
        values: inputs.map(i => i.value || ''),
        placeholders: inputs.map(i => i.placeholder || ''),
        buttons: [...panel.querySelectorAll('button')].map(b => b.innerText.trim())
      };
    });
    check('the High Scores tab offers max-entries and default-name inputs',
      highScoresControls.values.includes('10') &&
      highScoresControls.placeholders.some(p => /Default name/i.test(p)),
      JSON.stringify(highScoresControls));
    check('the High Scores tab shows the empty-board note and a Clear button',
      /No scores yet/i.test(highScoresPanelText) &&
      highScoresControls.buttons.some(t => /Clear stored scores/i.test(t)),
      JSON.stringify(highScoresControls));

    // ---- P4 Advanced batch 13: time scale — module, four palette
    // blocks under a Time category, placement + panels ----
    const hydraTimeScaleLoaded = await page.evaluate(() =>
      typeof window.HydraTimeScale !== 'undefined' &&
      typeof window.HydraTimeScale.createTimeScaleRuntime === 'function' &&
      typeof window.HydraTimeScale.setTimeScale === 'function' &&
      typeof window.HydraTimeScale.scaledDt === 'function' &&
      typeof window.HydraTimeScale.noteScaledFrame === 'function');
    check('HydraTimeScale module is loaded in the editor', hydraTimeScaleLoaded);
    await page.click('.tab[data-tab="script-tab"]');
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const timeScaleBlocks = await page.evaluate(() =>
      ['set-time-scale', 'reset-time-scale', 'read-time-scale',
       'time-scale-condition'].map(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('Time blocks are in the palette (Set / Reset / Read / Time Scale?)',
      timeScaleBlocks.every(Boolean), JSON.stringify(timeScaleBlocks));
    const timeScaleCategory = await page.evaluate(() =>
      [...document.querySelectorAll('.block-selector .block-category-label')]
        .some(el => el.textContent.trim() === 'Time'));
    check('Time blocks sit under a Time palette category', timeScaleCategory);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('.block-selector .block-category-label')]
        .find(e => e.textContent.trim() === 'Time');
      if (el) el.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(300);
    const setTsBefore = await page.locator('#grid [data-block-type="set-time-scale"]').count();
    await page.click('.block-selector .block-option[data-block-type="set-time-scale"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-time-scale"]').length > n,
      setTsBefore);
    const setTsCell = page.locator('#grid [data-block-type="set-time-scale"]').first();
    check('Set Time Scale block places on the grid', await setTsCell.count() === 1);
    await setTsCell.click();
    await page.waitForTimeout(400);
    const setTsPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Set Time Scale panel offers a Scale field',
      /Scale/i.test(setTsPropText), setTsPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const tsCondBefore = await page.locator('#grid [data-block-type="time-scale-condition"]').count();
    await page.click('.block-selector .block-option[data-block-type="time-scale-condition"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="time-scale-condition"]').length > n,
      tsCondBefore);
    const tsCondCell = page.locator('#grid [data-block-type="time-scale-condition"]').first();
    check('Time Scale condition places on the grid', await tsCondCell.count() === 1);
    await tsCondCell.click();
    await page.waitForTimeout(400);
    const tsCondPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Time Scale panel offers Compare + Value + Invert fields',
      /Compare/i.test(tsCondPropText) && /Value/i.test(tsCondPropText) &&
      /Invert/i.test(tsCondPropText),
      tsCondPropText.slice(0, 300));

    // ---- P4 Advanced batch 14: scene transitions — module, four
    // palette blocks under the Scene category, placement + panels,
    // and the Transitions tab with its default effect + duration ----
    const hydraTransitionLoaded = await page.evaluate(() =>
      typeof window.HydraTransition !== 'undefined' &&
      typeof window.HydraTransition.createTransitionRuntime === 'function' &&
      typeof window.HydraTransition.startTransition === 'function' &&
      typeof window.HydraTransition.updateTransition === 'function' &&
      typeof window.HydraTransition.drawTransition === 'function' &&
      typeof window.HydraTransition.normalizeTransitionConfig === 'function');
    check('HydraTransition module is loaded in the editor', hydraTransitionLoaded);
    await page.click('.tab[data-tab="script-tab"]');
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const transitionBlocks = await page.evaluate(() =>
      ['transition-to-scene', 'cancel-transition', 'transition-playing',
       'transition-finished'].map(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('Transition blocks are in the palette (Transition / Cancel / Playing? / Finished?)',
      transitionBlocks.every(Boolean), JSON.stringify(transitionBlocks));
    const transitionCategory = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const sceneIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'Scene');
      if (sceneIdx === -1) return 'no Scene label';
      const after = items.slice(sceneIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      const inScene = (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type'));
      const missing = ['transition-to-scene', 'cancel-transition', 'transition-playing',
        'transition-finished'].filter(t => !inScene.includes(t));
      return missing.length === 0 ? 'ok' : 'missing under Scene: ' + JSON.stringify(missing) +
        ' (Scene holds ' + JSON.stringify(inScene) + ')';
    });
    check('Transition blocks sit under the Scene palette category (not under a later heading)',
      transitionCategory === 'ok', transitionCategory);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('.block-selector .block-category-label')]
        .find(e => e.textContent.trim() === 'Scene');
      if (el) el.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(300);
    const transBefore = await page.locator('#grid [data-block-type="transition-to-scene"]').count();
    await page.click('.block-selector .block-option[data-block-type="transition-to-scene"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="transition-to-scene"]').length > n,
      transBefore);
    const transCell = page.locator('#grid [data-block-type="transition-to-scene"]').first();
    check('Transition to Scene block places on the grid', await transCell.count() === 1);
    await transCell.click();
    await page.waitForTimeout(400);
    const transPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Transition to Scene panel offers Scene + Effect + Duration fields',
      /Scene/i.test(transPropText) && /Effect/i.test(transPropText) &&
      /Duration/i.test(transPropText),
      transPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const transFinBefore = await page.locator('#grid [data-block-type="transition-finished"]').count();
    await page.click('.block-selector .block-option[data-block-type="transition-finished"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="transition-finished"]').length > n,
      transFinBefore);
    const transFinCell = page.locator('#grid [data-block-type="transition-finished"]').first();
    check('Transition Finished block places on the grid', await transFinCell.count() === 1);
    await transFinCell.click();
    await page.waitForTimeout(400);
    const transFinPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Transition Finished panel offers Scene + Invert fields',
      /Scene/i.test(transFinPropText) && /Invert/i.test(transFinPropText),
      transFinPropText.slice(0, 300));
    // Scene tab: the Transitions tab shows its hint, the default
    // effect select, and the duration input.
    await page.click('.tab[data-tab="scene-tab"]');
    await page.click('.inspector-tab[data-inspector-tab="transitions"]');
    await page.waitForTimeout(500);
    const transitionsPanelText = await page.evaluate(() =>
      document.getElementById('transitions-panel')?.parentElement?.innerText || '');
    check('Transitions tab shows its hint and default-effect label',
      /fades to black/i.test(transitionsPanelText) &&
      /Default effect/i.test(transitionsPanelText),
      transitionsPanelText.slice(0, 300));
    const transitionsControls = await page.evaluate(() => {
      const panel = document.getElementById('transitions-panel');
      const select = panel.querySelector('select');
      const input = panel.querySelector('input[type="number"]');
      return {
        effectOptions: select ? [...select.options].map(o => o.textContent.trim()) : [],
        effectValue: select ? select.value : '',
        durationValue: input ? input.value : ''
      };
    });
    check('the Transitions tab offers the Fade / Wipe / None effect select and a 0.5s duration',
      transitionsControls.effectOptions.some(t => /Fade to black/i.test(t)) &&
      transitionsControls.effectOptions.some(t => /Wipe across/i.test(t)) &&
      transitionsControls.effectOptions.some(t => /None/i.test(t)) &&
      transitionsControls.effectValue === 'fade' &&
      transitionsControls.durationValue === '0.5',
      JSON.stringify(transitionsControls));

    // ---- P4 Advanced batch 15: camera feel — module, five palette
    // blocks under the Camera category, placement + panels, and the
    // Scene Settings camera-feel fields ----
    const hydraCameraFeelLoaded = await page.evaluate(() =>
      typeof window.HydraCameraFeel !== 'undefined' &&
      typeof window.HydraCameraFeel.freshCameraFeel === 'function' &&
      typeof window.HydraCameraFeel.updateFollowCamera === 'function' &&
      typeof window.HydraCameraFeel.normalizeSmoothing === 'function' &&
      typeof window.HydraCameraFeel.normalizeCameraBounds === 'function' &&
      typeof window.HydraCameraFeel.isCameraFeelAction === 'function' &&
      typeof window.HydraCameraFeel.isCameraFeelCondition === 'function');
    check('HydraCameraFeel module is loaded in the editor', hydraCameraFeelLoaded);
    await page.click('.tab[data-tab="script-tab"]');
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const cameraFeelBlocks = await page.evaluate(() =>
      ['set-camera-smoothing', 'set-camera-deadzone', 'set-camera-bounds',
       'clear-camera-bounds', 'camera-following'].map(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('Camera-feel blocks are in the palette (Smooth / Deadzone / Bounds / Clear / Following?)',
      cameraFeelBlocks.every(Boolean), JSON.stringify(cameraFeelBlocks));
    const cameraFeelCategory = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const camIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'Camera');
      if (camIdx === -1) return 'no Camera label';
      const after = items.slice(camIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      const inCamera = (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type'));
      const missing = ['set-camera-smoothing', 'set-camera-deadzone', 'set-camera-bounds',
        'clear-camera-bounds', 'camera-following'].filter(t => !inCamera.includes(t));
      return missing.length === 0 ? 'ok' : 'missing under Camera: ' + JSON.stringify(missing) +
        ' (Camera holds ' + JSON.stringify(inCamera) + ')';
    });
    check('Camera-feel blocks sit under the Camera palette category (not under a later heading)',
      cameraFeelCategory === 'ok', cameraFeelCategory);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('.block-selector .block-category-label')]
        .find(e => e.textContent.trim() === 'Camera');
      if (el) el.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(300);
    const smoothBefore = await page.locator('#grid [data-block-type="set-camera-smoothing"]').count();
    await page.click('.block-selector .block-option[data-block-type="set-camera-smoothing"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-camera-smoothing"]').length > n,
      smoothBefore);
    const smoothCell = page.locator('#grid [data-block-type="set-camera-smoothing"]').first();
    check('Set Camera Smoothing block places on the grid', await smoothCell.count() === 1);
    await smoothCell.click();
    await page.waitForTimeout(400);
    const smoothPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Set Camera Smoothing panel offers a Smoothing field',
      /Smoothing/i.test(smoothPropText),
      smoothPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const boundsBefore = await page.locator('#grid [data-block-type="set-camera-bounds"]').count();
    await page.click('.block-selector .block-option[data-block-type="set-camera-bounds"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-camera-bounds"]').length > n,
      boundsBefore);
    const boundsCell = page.locator('#grid [data-block-type="set-camera-bounds"]').first();
    check('Set Camera Bounds block places on the grid', await boundsCell.count() === 1);
    await boundsCell.click();
    await page.waitForTimeout(400);
    const boundsPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Set Camera Bounds panel offers Min X / Min Y / Max X / Max Y fields',
      /Min X/i.test(boundsPropText) && /Min Y/i.test(boundsPropText) &&
      /Max X/i.test(boundsPropText) && /Max Y/i.test(boundsPropText),
      boundsPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const followBefore = await page.locator('#grid [data-block-type="camera-following"]').count();
    await page.click('.block-selector .block-option[data-block-type="camera-following"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="camera-following"]').length > n,
      followBefore);
    const followCell = page.locator('#grid [data-block-type="camera-following"]').first();
    check('Camera Following block places on the grid', await followCell.count() === 1);
    await followCell.click();
    await page.waitForTimeout(400);
    const followPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Camera Following panel offers an Invert field',
      /Invert/i.test(followPropText),
      followPropText.slice(0, 300));
    // Scene tab: the World inspector shows the camera-feel fields with
    // their defaults (0 smoothing, 0x0 deadzone, blank bounds).
    await page.click('.tab[data-tab="scene-tab"]');
    await page.click('.inspector-tab[data-inspector-tab="world"]');
    await page.waitForTimeout(500);
    const cameraFeelFields = await page.evaluate(() => {
      const byId = (id) => document.getElementById(id);
      const wrapRect = byId('scene-camera-feel-wrap')?.getBoundingClientRect();
      return {
        wrap: !!byId('scene-camera-feel-wrap'),
        visible: !!wrapRect && wrapRect.height > 0,
        smoothing: byId('scene-cam-smoothing')?.value ?? null,
        deadzoneW: byId('scene-cam-deadzone-w')?.value ?? null,
        deadzoneH: byId('scene-cam-deadzone-h')?.value ?? null,
        boundsMinX: byId('scene-cam-bounds-minx')?.value ?? null,
        boundsMinY: byId('scene-cam-bounds-miny')?.value ?? null,
        boundsMaxX: byId('scene-cam-bounds-maxx')?.value ?? null,
        boundsMaxY: byId('scene-cam-bounds-maxy')?.value ?? null,
        clearBtn: !!byId('scene-cam-bounds-clear-btn')
      };
    });
    check('Scene Settings shows the camera-feel fields with their defaults',
      cameraFeelFields.wrap && cameraFeelFields.visible &&
      cameraFeelFields.smoothing === '0' &&
      cameraFeelFields.deadzoneW === '0' && cameraFeelFields.deadzoneH === '0' &&
      cameraFeelFields.boundsMinX === '' && cameraFeelFields.boundsMinY === '' &&
      cameraFeelFields.boundsMaxX === '' && cameraFeelFields.boundsMaxY === '' &&
      cameraFeelFields.clearBtn,
      JSON.stringify(cameraFeelFields));

    // ---- P4 Advanced batch 16: parallax backgrounds — module, two
    // palette blocks under the Camera category, placement + panels,
    // and the Inspector Parallax section on a fresh sprite ----
    const hydraParallaxLoaded = await page.evaluate(() =>
      typeof window.HydraParallax !== 'undefined' &&
      typeof window.HydraParallax.parallaxCamera === 'function' &&
      typeof window.HydraParallax.normalizeParallaxFactor === 'function' &&
      typeof window.HydraParallax.isParallaxAction === 'function' &&
      typeof window.HydraParallax.isParallaxCondition === 'function');
    check('HydraParallax module is loaded in the editor', hydraParallaxLoaded);
    await page.click('.tab[data-tab="script-tab"]');
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const parallaxBlocks = await page.evaluate(() =>
      ['set-parallax', 'parallax-factor'].map(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('Parallax blocks are in the palette (Set Parallax / Parallax Factor?)',
      parallaxBlocks.every(Boolean), JSON.stringify(parallaxBlocks));
    const parallaxCategory = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const camIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'Camera');
      if (camIdx === -1) return 'no Camera label';
      const after = items.slice(camIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      const inCamera = (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type'));
      const missing = ['set-parallax', 'parallax-factor'].filter(t => !inCamera.includes(t));
      return missing.length === 0 ? 'ok' : 'missing under Camera: ' + JSON.stringify(missing) +
        ' (Camera holds ' + JSON.stringify(inCamera) + ')';
    });
    check('Parallax blocks sit under the Camera palette category (not under a later heading)',
      parallaxCategory === 'ok', parallaxCategory);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('.block-selector .block-category-label')]
        .find(e => e.textContent.trim() === 'Camera');
      if (el) el.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(300);
    const parallaxBefore = await page.locator('#grid [data-block-type="set-parallax"]').count();
    await page.click('.block-selector .block-option[data-block-type="set-parallax"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-parallax"]').length > n,
      parallaxBefore);
    const parallaxCell = page.locator('#grid [data-block-type="set-parallax"]').first();
    check('Set Parallax block places on the grid', await parallaxCell.count() === 1);
    await parallaxCell.click();
    await page.waitForTimeout(400);
    const parallaxPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Set Parallax panel offers Object / Parallax X / Parallax Y fields',
      /Object/i.test(parallaxPropText) && /Parallax X/i.test(parallaxPropText) &&
      /Parallax Y/i.test(parallaxPropText),
      parallaxPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const factorBefore = await page.locator('#grid [data-block-type="parallax-factor"]').count();
    await page.click('.block-selector .block-option[data-block-type="parallax-factor"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="parallax-factor"]').length > n,
      factorBefore);
    const factorCell = page.locator('#grid [data-block-type="parallax-factor"]').first();
    check('Parallax Factor block places on the grid', await factorCell.count() === 1);
    await factorCell.click();
    await page.waitForTimeout(400);
    const factorPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Parallax Factor panel offers Object / Axis / Compare / Value / Invert fields',
      /Object/i.test(factorPropText) && /Axis/i.test(factorPropText) &&
      /Compare/i.test(factorPropText) && /Value/i.test(factorPropText) &&
      /Invert/i.test(factorPropText),
      factorPropText.slice(0, 300));
    // Scene tab: a fresh sprite's Inspector shows the Parallax
    // section with both factors at world speed (1).
    await page.click('.tab[data-tab="scene-tab"]');
    await page.click('.inspector-tab[data-inspector-tab="create"]');
    await page.waitForSelector('.object-create-btn[data-create-kind="sprite"]', { timeout: 10000 });
    await page.click('.object-create-btn[data-create-kind="sprite"]');
    await page.waitForSelector('.game-object', { timeout: 5000 });
    await page.waitForTimeout(400);
    const parallaxInspector = await page.evaluate(() => {
      const sec = document.querySelector('.parallax-editor');
      const inputs = sec ? [...sec.querySelectorAll('input[type="number"]')].map(i => i.value) : [];
      return {
        section: !!sec,
        text: document.getElementById('object-properties')?.innerText || '',
        inputs
      };
    });
    check('Inspector shows the Parallax section with both factors at 1 for a fresh sprite',
      parallaxInspector.section &&
      /Parallax X/i.test(parallaxInspector.text) &&
      /Parallax Y/i.test(parallaxInspector.text) &&
      parallaxInspector.inputs.length === 2 &&
      parallaxInspector.inputs[0] === '1' && parallaxInspector.inputs[1] === '1',
      JSON.stringify(parallaxInspector));

    // ---- P4 Advanced batch 17: positional / spatial audio — module,
    // palette block under the Audio category, placement + panel with
    // the audio-asset Sound select ----
    const hydraSpatialAudioLoaded = await page.evaluate(() =>
      typeof window.HydraSpatialAudio !== 'undefined' &&
      typeof window.HydraSpatialAudio.spatialMix === 'function' &&
      typeof window.HydraSpatialAudio.normalizeMaxDistance === 'function' &&
      typeof window.HydraSpatialAudio.normalizePan === 'function' &&
      typeof window.HydraSpatialAudio.listenerOf === 'function' &&
      typeof window.HydraSpatialAudio.isSpatialAudioAction === 'function');
    check('HydraSpatialAudio module is loaded in the editor', hydraSpatialAudioLoaded);
    await page.click('.tab[data-tab="script-tab"]');
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const spatialBlock = await page.evaluate(() =>
      !!document.querySelector('.block-selector .block-option[data-block-type="play-sound-at-position"]'));
    check('Play Sound at Position block is in the palette', spatialBlock);
    const spatialCategory = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const audioIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'Audio');
      if (audioIdx === -1) return 'no Audio label';
      const after = items.slice(audioIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      const inAudio = (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type'));
      return inAudio.includes('play-sound-at-position') ? 'ok' :
        'missing under Audio (Audio holds ' + JSON.stringify(inAudio) + ')';
    });
    check('Play Sound at Position sits under the Audio palette category (not under a later heading)',
      spatialCategory === 'ok', spatialCategory);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('.block-selector .block-category-label')]
        .find(e => e.textContent.trim() === 'Audio');
      if (el) el.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(300);
    const spatialBefore = await page.locator('#grid [data-block-type="play-sound-at-position"]').count();
    await page.click('.block-selector .block-option[data-block-type="play-sound-at-position"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="play-sound-at-position"]').length > n,
      spatialBefore);
    const spatialCell = page.locator('#grid [data-block-type="play-sound-at-position"]').first();
    check('Play Sound at Position block places on the grid', await spatialCell.count() === 1);
    await spatialCell.click();
    await page.waitForTimeout(400);
    const spatialPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Play Sound at Position panel offers Sound / At object / X / Y / Hear within / Volume / Bus / Pitch fields',
      /Sound/i.test(spatialPropText) && /At object/i.test(spatialPropText) &&
      /X \(no object\)/i.test(spatialPropText) && /Y \(no object\)/i.test(spatialPropText) &&
      /Hear within/i.test(spatialPropText) && /Volume/i.test(spatialPropText) &&
      /Bus/i.test(spatialPropText) && /Pitch/i.test(spatialPropText),
      spatialPropText.slice(0, 400));
    const spatialSoundOpts = await page.evaluate(() => {
      const panel = document.getElementById('properties-panel');
      if (!panel) return [];
      const groups = [...panel.querySelectorAll('.property-group')];
      const soundGroup = groups.find(g => /Sound/i.test(g.textContent || ''));
      const sel = soundGroup ? soundGroup.querySelector('select') : null;
      return sel ? [...sel.options].map(o => o.textContent) : [];
    });
    check('Play Sound at Position Sound select offers the built-in tone (no audio assets uploaded yet)',
      spatialSoundOpts.length === 1 && spatialSoundOpts[0] === 'Built-in tone',
      JSON.stringify(spatialSoundOpts));
    await page.click('#back-to-blocks-btn');

    // ---- P4 Advanced batch 18: pathfinding — module, palette blocks
    // under the Pathfinding category, placement + panels ----
    const hydraPathfindLoaded = await page.evaluate(() =>
      typeof window.HydraPathfind !== 'undefined' &&
      typeof window.HydraPathfind.findPath === 'function' &&
      typeof window.HydraPathfind.buildWalkGrid === 'function' &&
      typeof window.HydraPathfind.simplifyPath === 'function' &&
      typeof window.HydraPathfind.updatePaths === 'function' &&
      typeof window.HydraPathfind.isPathfindAction === 'function' &&
      typeof window.HydraPathfind.isPathfindCondition === 'function');
    check('HydraPathfind module is loaded in the editor', hydraPathfindLoaded);
    await page.click('.tab[data-tab="script-tab"]');
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const pathBlocks = await page.evaluate(() =>
      ['follow-path', 'stop-path', 'path-finished', 'has-path'].every(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('All four Pathfinding blocks are in the palette', pathBlocks);
    const pathCategory = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const catIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'Pathfinding');
      if (catIdx === -1) return 'no Pathfinding label';
      const after = items.slice(catIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      const inCat = (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type'));
      return ['follow-path', 'stop-path', 'path-finished', 'has-path']
        .every(t => inCat.includes(t)) ? 'ok' :
        'missing under Pathfinding (Pathfinding holds ' + JSON.stringify(inCat) + ')';
    });
    check('All four Pathfinding blocks sit under the Pathfinding palette category (not under a later heading)',
      pathCategory === 'ok', pathCategory);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('.block-selector .block-category-label')]
        .find(e => e.textContent.trim() === 'Pathfinding');
      if (el) el.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(300);
    const pfFollowBefore = await page.locator('#grid [data-block-type="follow-path"]').count();
    await page.click('.block-selector .block-option[data-block-type="follow-path"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="follow-path"]').length > n,
      pfFollowBefore);
    const pfFollowCell = page.locator('#grid [data-block-type="follow-path"]').first();
    check('Follow Path block places on the grid', await pfFollowCell.count() === 1);
    await pfFollowCell.click();
    await page.waitForTimeout(400);
    const pfFollowPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Follow Path panel offers Object / Destination object / X / Y / Speed fields',
      /Object/i.test(pfFollowPropText) && /Destination object/i.test(pfFollowPropText) &&
      /X \(no object\)/i.test(pfFollowPropText) && /Y \(no object\)/i.test(pfFollowPropText) &&
      /Speed \(px\/s\)/i.test(pfFollowPropText),
      pfFollowPropText.slice(0, 400));
    await page.click('#back-to-blocks-btn');
    const finishedBefore = await page.locator('#grid [data-block-type="path-finished"]').count();
    await page.click('.block-selector .block-option[data-block-type="path-finished"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="path-finished"]').length > n,
      finishedBefore);
    const finishedCell = page.locator('#grid [data-block-type="path-finished"]').first();
    check('Path Finished block places on the grid', await finishedCell.count() === 1);
    await finishedCell.click();
    await page.waitForTimeout(400);
    const finishedPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Path Finished panel offers Object / Invert fields',
      /Object/i.test(finishedPropText) && /Invert/i.test(finishedPropText),
      finishedPropText.slice(0, 400));
    await page.click('#back-to-blocks-btn');

    // ---- P4 Advanced batch 19: AI behaviors — module, palette blocks
    // under the AI category, placement + panels ----
    const hydraAiLoaded = await page.evaluate(() =>
      typeof window.HydraAi !== 'undefined' &&
      typeof window.HydraAi.updateAI === 'function' &&
      typeof window.HydraAi.setBehavior === 'function' &&
      typeof window.HydraAi.behaviorOf === 'function' &&
      typeof window.HydraAi.targetInRange === 'function' &&
      typeof window.HydraAi.isAiAction === 'function' &&
      typeof window.HydraAi.isAiCondition === 'function');
    check('HydraAi module is loaded in the editor', hydraAiLoaded);
    await page.click('.tab[data-tab="script-tab"]');
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const aiBlocks = await page.evaluate(() =>
      ['set-ai-behavior', 'stop-ai', 'ai-behavior', 'target-in-range'].every(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('All four AI blocks are in the palette', aiBlocks);
    const aiCategory = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const catIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'AI');
      if (catIdx === -1) return 'no AI label';
      const after = items.slice(catIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      const inCat = (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type'));
      return ['set-ai-behavior', 'stop-ai', 'ai-behavior', 'target-in-range']
        .every(t => inCat.includes(t)) ? 'ok' :
        'missing under AI (AI holds ' + JSON.stringify(inCat) + ')';
    });
    check('All four AI blocks sit under the AI palette category (not under a later heading)',
      aiCategory === 'ok', aiCategory);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('.block-selector .block-category-label')]
        .find(e => e.textContent.trim() === 'AI');
      if (el) el.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(300);
    const aiSetBefore = await page.locator('#grid [data-block-type="set-ai-behavior"]').count();
    await page.click('.block-selector .block-option[data-block-type="set-ai-behavior"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-ai-behavior"]').length > n,
      aiSetBefore);
    const aiSetCell = page.locator('#grid [data-block-type="set-ai-behavior"]').first();
    check('Set AI Behavior block places on the grid', await aiSetCell.count() === 1);
    await aiSetCell.click();
    await page.waitForTimeout(400);
    const aiSetPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Set AI Behavior panel offers Object / Behavior / Target object / Speed / Range / Patrol point fields',
      /Object/i.test(aiSetPropText) && /Behavior/i.test(aiSetPropText) &&
      /Target object/i.test(aiSetPropText) &&
      /Speed \(px\/s\)/i.test(aiSetPropText) && /Range \(px\)/i.test(aiSetPropText) &&
      /Patrol point A/i.test(aiSetPropText) && /Patrol point B/i.test(aiSetPropText),
      aiSetPropText.slice(0, 400));
    await page.click('#back-to-blocks-btn');
    const aiCondBefore = await page.locator('#grid [data-block-type="ai-behavior"]').count();
    await page.click('.block-selector .block-option[data-block-type="ai-behavior"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="ai-behavior"]').length > n,
      aiCondBefore);
    const aiCondCell = page.locator('#grid [data-block-type="ai-behavior"]').first();
    check('AI Behavior block places on the grid', await aiCondCell.count() === 1);
    await aiCondCell.click();
    await page.waitForTimeout(400);
    const aiCondPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('AI Behavior panel offers Object / Behavior / Invert fields',
      /Object/i.test(aiCondPropText) && /Behavior/i.test(aiCondPropText) && /Invert/i.test(aiCondPropText),
      aiCondPropText.slice(0, 400));
    await page.click('#back-to-blocks-btn');

    // ---- P4 Advanced batch 20: virtual joystick — module, palette blocks
    // under the Input category, placement + panels, Joystick tab ----
    const hydraJoystickLoaded = await page.evaluate(() =>
      typeof window.HydraJoystick !== 'undefined' &&
      typeof window.HydraJoystick.createJoystickRuntime === 'function' &&
      typeof window.HydraJoystick.normalizeJoystickConfig === 'function' &&
      typeof window.HydraJoystick.joystickStart === 'function' &&
      typeof window.HydraJoystick.joystickMove === 'function' &&
      typeof window.HydraJoystick.drawJoystick === 'function' &&
      typeof window.HydraJoystick.isJoystickAction === 'function' &&
      typeof window.HydraJoystick.isJoystickCondition === 'function');
    check('HydraJoystick module is loaded in the editor', hydraJoystickLoaded);
    await page.click('.tab[data-tab="script-tab"]');
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const joyBlocks = await page.evaluate(() =>
      ['enable-joystick', 'disable-joystick', 'joystick-active', 'joystick-tilt'].every(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('All four joystick blocks are in the palette', joyBlocks);
    const joyCategory = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const catIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'Input');
      if (catIdx === -1) return 'no Input label';
      const after = items.slice(catIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      const inCat = (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type'));
      return ['enable-joystick', 'disable-joystick', 'joystick-active', 'joystick-tilt']
        .every(t => inCat.includes(t)) ? 'ok' :
        'missing under Input (Input holds ' + JSON.stringify(inCat) + ')';
    });
    check('All four joystick blocks sit under the Input palette category (not under a later heading)',
      joyCategory === 'ok', joyCategory);
    const joyOrder = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const catIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'Input');
      const after = items.slice(catIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      return (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type'))
        .filter(t => t && t.includes('joystick'))
        .join(',');
    });
    check('Joystick blocks sit in Enable / Disable / Active / Tilt order in the palette',
      joyOrder === 'enable-joystick,disable-joystick,joystick-active,joystick-tilt', joyOrder);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('.block-selector .block-category-label')]
        .find(e => e.textContent.trim() === 'Input');
      if (el) el.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(300);
    const joyOnBefore = await page.locator('#grid [data-block-type="enable-joystick"]').count();
    await page.click('.block-selector .block-option[data-block-type="enable-joystick"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="enable-joystick"]').length > n,
      joyOnBefore);
    const joyOnCell = page.locator('#grid [data-block-type="enable-joystick"]').first();
    check('Enable Joystick block places on the grid', await joyOnCell.count() === 1);
    await joyOnCell.click();
    await page.waitForTimeout(400);
    const joyOnPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Enable Joystick panel shows its note (a settings-free block is never a blank panel)',
      /Turns the on-screen joystick on/i.test(joyOnPropText),
      joyOnPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const joyTiltBefore = await page.locator('#grid [data-block-type="joystick-tilt"]').count();
    await page.click('.block-selector .block-option[data-block-type="joystick-tilt"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="joystick-tilt"]').length > n,
      joyTiltBefore);
    const joyTiltCell = page.locator('#grid [data-block-type="joystick-tilt"]').first();
    check('Joystick Tilt block places on the grid', await joyTiltCell.count() === 1);
    await joyTiltCell.click();
    await page.waitForTimeout(400);
    const joyTiltPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Joystick Tilt panel offers Direction / Min tilt / Invert fields',
      /Direction/i.test(joyTiltPropText) && /Min tilt/i.test(joyTiltPropText) && /Invert/i.test(joyTiltPropText),
      joyTiltPropText.slice(0, 400));
    await page.click('#back-to-blocks-btn');
    // Joystick inspector tab: the on-screen stick's setup fields.
    await page.click('.tab[data-tab="scene-tab"]');
    const joystickTab = page.locator('.inspector-tab[data-inspector-tab="joystick"]');
    check('Joystick inspector tab exists', await joystickTab.count() === 1);
    await joystickTab.click();
    const joystickPanel = page.locator('.inspector-panel[data-inspector-panel="joystick"]');
    check('Joystick panel shows after clicking the tab', await joystickPanel.isVisible());
    const joyPanelText = await page.evaluate(() =>
      document.getElementById('joystick-panel')?.innerText || '');
    check('Joystick tab offers On by default / Base position / radii / Dead zone / variables / action drives',
      /On by default/i.test(joyPanelText) && /Base position/i.test(joyPanelText) &&
      /Base radius/i.test(joyPanelText) && /Knob radius/i.test(joyPanelText) &&
      /Dead zone/i.test(joyPanelText) && /Left \/ right variable/i.test(joyPanelText) &&
      /Up \/ down variable/i.test(joyPanelText) && /Tilt left drives/i.test(joyPanelText) &&
      /Tilt right drives/i.test(joyPanelText) && /Tilt up drives/i.test(joyPanelText) &&
      /Tilt down drives/i.test(joyPanelText),
      joyPanelText.slice(0, 500));

    // ---- P4 Advanced batch 21: health & damage — module, palette blocks
    // under the Health category, placement + panels, Inspector section ----
    const hydraHealthLoaded = await page.evaluate(() =>
      typeof window.HydraHealth !== 'undefined' &&
      typeof window.HydraHealth.normalizeHealth === 'function' &&
      typeof window.HydraHealth.damage === 'function' &&
      typeof window.HydraHealth.heal === 'function' &&
      typeof window.HydraHealth.healthFraction === 'function' &&
      typeof window.HydraHealth.drawHealthBar === 'function' &&
      typeof window.HydraHealth.isHealthAction === 'function' &&
      typeof window.HydraHealth.isHealthCondition === 'function');
    check('HydraHealth module is loaded in the editor', hydraHealthLoaded);
    await page.click('.tab[data-tab="script-tab"]');
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const healthBlocks = await page.evaluate(() =>
      ['damage-object', 'heal-object', 'set-health', 'set-max-health', 'health-check', 'object-died'].every(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('All six health blocks are in the palette', healthBlocks);
    const healthCategory = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const catIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'Health');
      if (catIdx === -1) return 'no Health label';
      const after = items.slice(catIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      const inCat = (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type'));
      return ['damage-object', 'heal-object', 'set-health', 'set-max-health', 'health-check', 'object-died']
        .every(t => inCat.includes(t)) ? 'ok' :
        'missing under Health (Health holds ' + JSON.stringify(inCat) + ')';
    });
    check('All six health blocks sit under the Health palette category (not under a later heading)',
      healthCategory === 'ok', healthCategory);
    const healthOrder = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const catIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'Health');
      const after = items.slice(catIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      return (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type'))
        .filter(t => t && (t.includes('health') || t === 'damage-object' || t === 'heal-object' || t === 'object-died'))
        .join(',');
    });
    check('Health blocks sit in Damage / Heal / Set Health / Set Max Health / Health / Died order in the palette',
      healthOrder === 'damage-object,heal-object,set-health,set-max-health,health-check,object-died', healthOrder);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('.block-selector .block-category-label')]
        .find(e => e.textContent.trim() === 'Health');
      if (el) el.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(300);
    const dmgBefore = await page.locator('#grid [data-block-type="damage-object"]').count();
    await page.click('.block-selector .block-option[data-block-type="damage-object"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="damage-object"]').length > n,
      dmgBefore);
    const dmgCell = page.locator('#grid [data-block-type="damage-object"]').first();
    check('Damage Object block places on the grid', await dmgCell.count() === 1);
    await dmgCell.click();
    await page.waitForTimeout(400);
    const dmgPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Damage Object panel offers Object / Amount fields',
      /Object/i.test(dmgPropText) && /Amount/i.test(dmgPropText),
      dmgPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const diedBefore = await page.locator('#grid [data-block-type="object-died"]').count();
    await page.click('.block-selector .block-option[data-block-type="object-died"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="object-died"]').length > n,
      diedBefore);
    const diedCell = page.locator('#grid [data-block-type="object-died"]').first();
    check('Object Died block places on the grid', await diedCell.count() === 1);
    await diedCell.click();
    await page.waitForTimeout(400);
    const diedPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Object Died panel offers Object / Invert fields',
      /Object/i.test(diedPropText) && /Invert/i.test(diedPropText),
      diedPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    // Scene tab: a fresh sprite's Inspector shows the Health section
    // with max health and health at 100 and the bar off.
    await page.click('.tab[data-tab="scene-tab"]');
    await page.click('.inspector-tab[data-inspector-tab="create"]');
    await page.waitForSelector('.object-create-btn[data-create-kind="sprite"]', { timeout: 10000 });
    await page.click('.object-create-btn[data-create-kind="sprite"]');
    await page.waitForSelector('.game-object', { timeout: 5000 });
    await page.waitForTimeout(400);
    const healthInspector = await page.evaluate(() => {
      const sec = document.querySelector('.health-editor');
      const inputs = sec ? [...sec.querySelectorAll('input[type="number"]')].map(i => i.value) : [];
      const barBox = sec ? sec.querySelector('input[type="checkbox"]') : null;
      return {
        section: !!sec,
        text: document.getElementById('object-properties')?.innerText || '',
        inputs,
        barChecked: barBox ? barBox.checked : null
      };
    });
    check('Inspector shows the Health section with max health and health at 100 and the bar off for a fresh sprite',
      healthInspector.section &&
      /Max health/i.test(healthInspector.text) &&
      /Show health bar/i.test(healthInspector.text) &&
      healthInspector.inputs.length === 2 &&
      healthInspector.inputs[0] === '100' && healthInspector.inputs[1] === '100' &&
      healthInspector.barChecked === false,
      JSON.stringify(healthInspector));

    // ---- P4 Advanced batch 22: damage feedback — module, palette blocks
    // under the Health category, placement + panels ----
    // (Batch 22 shipped in cycle 13 with unit + export coverage but no
    // smoke checks — the Health checks above are batch 21's. This closes
    // the gap cycles 13–17 carried as an open observation.)
    const hydraDamageFxLoaded = await page.evaluate(() =>
      typeof window.HydraDamageFx !== 'undefined' &&
      typeof window.HydraDamageFx.spawnDamageNumber === 'function' &&
      typeof window.HydraDamageFx.makeInvincible === 'function' &&
      typeof window.HydraDamageFx.isInvincible === 'function' &&
      typeof window.HydraDamageFx.knockbackDirection === 'function' &&
      typeof window.HydraDamageFx.isDamageFxAction === 'function' &&
      typeof window.HydraDamageFx.isDamageFxCondition === 'function');
    check('HydraDamageFx module is loaded in the editor', hydraDamageFxLoaded);
    await page.click('.tab[data-tab="script-tab"]');
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const damageFxBlocks = await page.evaluate(() =>
      ['show-damage-number', 'make-invincible', 'knockback-object', 'is-invincible'].every(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('All four damage-feedback blocks are in the palette', damageFxBlocks);
    const damageFxCategory = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const catIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'Health');
      if (catIdx === -1) return 'no Health label';
      const after = items.slice(catIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      const inCat = (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type'));
      return ['show-damage-number', 'make-invincible', 'knockback-object', 'is-invincible']
        .every(t => inCat.includes(t)) ? 'ok' :
        'missing under Health (Health holds ' + JSON.stringify(inCat) + ')';
    });
    check('All four damage-feedback blocks sit under the Health palette category',
      damageFxCategory === 'ok', damageFxCategory);
    const healthFullOrder = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const catIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'Health');
      const after = items.slice(catIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      return (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type'))
        .filter(Boolean)
        .join(',');
    });
    check('Health blocks sit in Damage / Heal / Set Health / Set Max Health / Health / Died / Show Damage Number / Make Invincible / Knockback / Is Invincible order in the palette',
      healthFullOrder === 'damage-object,heal-object,set-health,set-max-health,health-check,object-died,show-damage-number,make-invincible,knockback-object,is-invincible', healthFullOrder);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('.block-selector .block-category-label')]
        .find(e => e.textContent.trim() === 'Health');
      if (el) el.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(300);
    const dmgNumBefore = await page.locator('#grid [data-block-type="show-damage-number"]').count();
    await page.click('.block-selector .block-option[data-block-type="show-damage-number"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="show-damage-number"]').length > n,
      dmgNumBefore);
    const dmgNumCell = page.locator('#grid [data-block-type="show-damage-number"]').first();
    check('Show Damage Number block places on the grid', await dmgNumCell.count() === 1);
    await dmgNumCell.click();
    await page.waitForTimeout(400);
    const dmgNumPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Show Damage Number panel offers Object / Amount / Color fields',
      /Object/i.test(dmgNumPropText) && /Amount/i.test(dmgNumPropText) && /Color/i.test(dmgNumPropText),
      dmgNumPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const invBefore = await page.locator('#grid [data-block-type="make-invincible"]').count();
    await page.click('.block-selector .block-option[data-block-type="make-invincible"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="make-invincible"]').length > n,
      invBefore);
    const invCell = page.locator('#grid [data-block-type="make-invincible"]').first();
    check('Make Invincible block places on the grid', await invCell.count() === 1);
    await invCell.click();
    await page.waitForTimeout(400);
    const invPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Make Invincible panel offers Object / Seconds fields',
      /Object/i.test(invPropText) && /Seconds/i.test(invPropText),
      invPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const kbBefore = await page.locator('#grid [data-block-type="knockback-object"]').count();
    await page.click('.block-selector .block-option[data-block-type="knockback-object"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="knockback-object"]').length > n,
      kbBefore);
    const kbCell = page.locator('#grid [data-block-type="knockback-object"]').first();
    check('Knockback Object block places on the grid', await kbCell.count() === 1);
    await kbCell.click();
    await page.waitForTimeout(400);
    const kbPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Knockback Object panel offers Object / From object / Force fields',
      /Object/i.test(kbPropText) && /From object/i.test(kbPropText) && /Force/i.test(kbPropText),
      kbPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const isInvBefore = await page.locator('#grid [data-block-type="is-invincible"]').count();
    await page.click('.block-selector .block-option[data-block-type="is-invincible"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="is-invincible"]').length > n,
      isInvBefore);
    const isInvCell = page.locator('#grid [data-block-type="is-invincible"]').first();
    check('Is Invincible block places on the grid', await isInvCell.count() === 1);
    await isInvCell.click();
    await page.waitForTimeout(400);
    const isInvPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Is Invincible panel offers Object / Invert fields',
      /Object/i.test(isInvPropText) && /Invert/i.test(isInvPropText),
      isInvPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');

    // ---- P4 Advanced batch 23: checkpoints & respawn — module, palette
    // blocks under the Respawn category, placement + panels ----
    const hydraRespawnLoaded = await page.evaluate(() =>
      typeof window.HydraRespawn !== 'undefined' &&
      typeof window.HydraRespawn.createRespawnState === 'function' &&
      typeof window.HydraRespawn.setCheckpoint === 'function' &&
      typeof window.HydraRespawn.respawnPosition === 'function' &&
      typeof window.HydraRespawn.isRespawnAction === 'function' &&
      typeof window.HydraRespawn.isRespawnCondition === 'function');
    check('HydraRespawn module is loaded in the editor', hydraRespawnLoaded);
    await page.click('.tab[data-tab="script-tab"]');
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const respawnBlocks = await page.evaluate(() =>
      ['set-checkpoint', 'respawn-object', 'clear-checkpoint', 'checkpoint-set', 'respawn-count'].every(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('All five respawn blocks are in the palette', respawnBlocks);
    const respawnCategory = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const catIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'Respawn');
      if (catIdx === -1) return 'no Respawn label';
      const after = items.slice(catIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      const inCat = (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type'));
      return ['set-checkpoint', 'respawn-object', 'clear-checkpoint', 'checkpoint-set', 'respawn-count']
        .every(t => inCat.includes(t)) ? 'ok' :
        'missing under Respawn (Respawn holds ' + JSON.stringify(inCat) + ')';
    });
    check('All five respawn blocks sit under the Respawn palette category (not under a later heading)',
      respawnCategory === 'ok', respawnCategory);
    const respawnOrder = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const catIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'Respawn');
      const after = items.slice(catIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      return (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type'))
        .filter(t => t && (t.includes('checkpoint') || t === 'respawn-object' || t === 'respawn-count'))
        .join(',');
    });
    check('Respawn blocks sit in Set Checkpoint / Respawn Object / Clear Checkpoint / Checkpoint Set / Respawn Count order in the palette',
      respawnOrder === 'set-checkpoint,respawn-object,clear-checkpoint,checkpoint-set,respawn-count', respawnOrder);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('.block-selector .block-category-label')]
        .find(e => e.textContent.trim() === 'Respawn');
      if (el) el.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(300);
    const setCpBefore = await page.locator('#grid [data-block-type="set-checkpoint"]').count();
    await page.click('.block-selector .block-option[data-block-type="set-checkpoint"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-checkpoint"]').length > n,
      setCpBefore);
    const setCpCell = page.locator('#grid [data-block-type="set-checkpoint"]').first();
    check('Set Checkpoint block places on the grid', await setCpCell.count() === 1);
    await setCpCell.click();
    await page.waitForTimeout(400);
    const setCpPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Set Checkpoint panel offers Checkpoint object / X / Y fields',
      /Checkpoint object/i.test(setCpPropText) && /\bX\b/.test(setCpPropText) && /\bY\b/.test(setCpPropText),
      setCpPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const respawnBefore = await page.locator('#grid [data-block-type="respawn-object"]').count();
    await page.click('.block-selector .block-option[data-block-type="respawn-object"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="respawn-object"]').length > n,
      respawnBefore);
    const respawnCell = page.locator('#grid [data-block-type="respawn-object"]').first();
    check('Respawn Object block places on the grid', await respawnCell.count() === 1);
    await respawnCell.click();
    await page.waitForTimeout(400);
    const respawnPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Respawn Object panel offers Object / Restore health fields',
      /Object/i.test(respawnPropText) && /Restore health/i.test(respawnPropText),
      respawnPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const countBefore = await page.locator('#grid [data-block-type="respawn-count"]').count();
    await page.click('.block-selector .block-option[data-block-type="respawn-count"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="respawn-count"]').length > n,
      countBefore);
    const countCell = page.locator('#grid [data-block-type="respawn-count"]').first();
    check('Respawn Count block places on the grid', await countCell.count() === 1);
    await countCell.click();
    await page.waitForTimeout(400);
    const countPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Respawn Count panel offers Compare / Value / Invert fields',
      /Compare/i.test(countPropText) && /Value/i.test(countPropText) && /Invert/i.test(countPropText),
      countPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');

    // ---- P4 Advanced batch 24: enemy spawner / wave spawning — module,
    // palette blocks under the Spawner category, placement + panels ----
    const hydraSpawnLoaded = await page.evaluate(() =>
      typeof window.HydraSpawn !== 'undefined' &&
      typeof window.HydraSpawn.createSpawnerState === 'function' &&
      typeof window.HydraSpawn.startSpawner === 'function' &&
      typeof window.HydraSpawn.updateSpawners === 'function' &&
      typeof window.HydraSpawn.isSpawnAction === 'function' &&
      typeof window.HydraSpawn.isSpawnCondition === 'function');
    check('HydraSpawn module is loaded in the editor', hydraSpawnLoaded);
    await page.click('.tab[data-tab="script-tab"]');
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const spawnBlocks = await page.evaluate(() =>
      ['start-spawner', 'stop-spawner', 'read-spawned-count', 'spawner-active', 'spawned-count'].every(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('All five spawner blocks are in the palette', spawnBlocks);
    const spawnCategory = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const catIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'Spawner');
      if (catIdx === -1) return 'no Spawner label';
      const after = items.slice(catIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      const inCat = (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type'));
      return ['start-spawner', 'stop-spawner', 'read-spawned-count', 'spawner-active', 'spawned-count']
        .every(t => inCat.includes(t)) ? 'ok' :
        'missing under Spawner (Spawner holds ' + JSON.stringify(inCat) + ')';
    });
    check('All five spawner blocks sit under the Spawner palette category (not under a later heading)',
      spawnCategory === 'ok', spawnCategory);
    const spawnOrder = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const catIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'Spawner');
      const after = items.slice(catIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      return (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type'))
        .filter(t => t && (t.includes('spawner') || t.includes('spawned')))
        .join(',');
    });
    check('Spawner blocks sit in Start Spawner / Stop Spawner / Read Spawned Count / Spawner Active / Spawned Count order in the palette',
      spawnOrder === 'start-spawner,stop-spawner,read-spawned-count,spawner-active,spawned-count', spawnOrder);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('.block-selector .block-category-label')]
        .find(e => e.textContent.trim() === 'Spawner');
      if (el) el.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(300);
    const startSpBefore = await page.locator('#grid [data-block-type="start-spawner"]').count();
    await page.click('.block-selector .block-option[data-block-type="start-spawner"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="start-spawner"]').length > n,
      startSpBefore);
    const startSpCell = page.locator('#grid [data-block-type="start-spawner"]').first();
    check('Start Spawner block places on the grid', await startSpCell.count() === 1);
    await startSpCell.click();
    await page.waitForTimeout(400);
    const startSpPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Start Spawner panel offers Spawner name / Spawn object / At object / Every / Max alive / Total fields',
      /Spawner name/i.test(startSpPropText) && /Spawn object/i.test(startSpPropText) &&
      /At object/i.test(startSpPropText) && /Every/i.test(startSpPropText) &&
      /Max alive/i.test(startSpPropText) && /Total to spawn/i.test(startSpPropText),
      startSpPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const spawnedCountBefore = await page.locator('#grid [data-block-type="spawned-count"]').count();
    await page.click('.block-selector .block-option[data-block-type="spawned-count"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="spawned-count"]').length > n,
      spawnedCountBefore);
    const spawnedCountCell = page.locator('#grid [data-block-type="spawned-count"]').first();
    check('Spawned Count block places on the grid', await spawnedCountCell.count() === 1);
    await spawnedCountCell.click();
    await page.waitForTimeout(400);
    const spawnedCountPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Spawned Count panel offers Spawner name / Compare / Value / Invert fields',
      /Spawner name/i.test(spawnedCountPropText) && /Compare/i.test(spawnedCountPropText) &&
      /Value/i.test(spawnedCountPropText) && /Invert/i.test(spawnedCountPropText),
      spawnedCountPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const stopSpBefore = await page.locator('#grid [data-block-type="stop-spawner"]').count();
    await page.click('.block-selector .block-option[data-block-type="stop-spawner"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="stop-spawner"]').length > n,
      stopSpBefore);
    check('Stop Spawner block places on the grid',
      await page.locator('#grid [data-block-type="stop-spawner"]').count() > stopSpBefore);
    await page.click('#back-to-blocks-btn');
    const readSpBefore = await page.locator('#grid [data-block-type="read-spawned-count"]').count();
    await page.click('.block-selector .block-option[data-block-type="read-spawned-count"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="read-spawned-count"]').length > n,
      readSpBefore);
    check('Read Spawned Count block places on the grid',
      await page.locator('#grid [data-block-type="read-spawned-count"]').count() > readSpBefore);
    await page.click('#back-to-blocks-btn');
    const activeBefore = await page.locator('#grid [data-block-type="spawner-active"]').count();
    await page.click('.block-selector .block-option[data-block-type="spawner-active"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="spawner-active"]').length > n,
      activeBefore);
    check('Spawner Active block places on the grid',
      await page.locator('#grid [data-block-type="spawner-active"]').count() > activeBefore);
    await page.click('#back-to-blocks-btn');

    // ---- P4 Advanced batch 25: lives & game over — module,
    // palette blocks under the Lives category, placement + panels ----
    const hydraLivesLoaded = await page.evaluate(() =>
      typeof window.HydraLives !== 'undefined' &&
      typeof window.HydraLives.createLivesState === 'function' &&
      typeof window.HydraLives.setLives === 'function' &&
      typeof window.HydraLives.loseLives === 'function' &&
      typeof window.HydraLives.isGameOver === 'function' &&
      typeof window.HydraLives.isLivesAction === 'function' &&
      typeof window.HydraLives.isLivesCondition === 'function');
    check('HydraLives module is loaded in the editor', hydraLivesLoaded);
    await page.click('.tab[data-tab="script-tab"]');
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const livesBlocks = await page.evaluate(() =>
      ['set-lives', 'add-lives', 'lose-life', 'read-lives', 'lives', 'game-over'].every(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('All six lives blocks are in the palette', livesBlocks);
    const livesCategory = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const catIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'Lives');
      if (catIdx === -1) return 'no Lives label';
      const after = items.slice(catIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      const inCat = (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type'));
      return ['set-lives', 'add-lives', 'lose-life', 'read-lives', 'lives', 'game-over']
        .every(t => inCat.includes(t)) ? 'ok' :
        'missing under Lives (Lives holds ' + JSON.stringify(inCat) + ')';
    });
    check('All six lives blocks sit under the Lives palette category (not under a later heading)',
      livesCategory === 'ok', livesCategory);
    const livesOrder = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const catIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'Lives');
      const after = items.slice(catIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      return (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type'))
        .filter(t => ['set-lives', 'add-lives', 'lose-life', 'read-lives', 'lives', 'game-over'].includes(t))
        .join(',');
    });
    check('Lives blocks sit in Set Lives / Add Lives / Lose Life / Read Lives / Lives / Game Over order in the palette',
      livesOrder === 'set-lives,add-lives,lose-life,read-lives,lives,game-over', livesOrder);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('.block-selector .block-category-label')]
        .find(e => e.textContent.trim() === 'Lives');
      if (el) el.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(300);
    const setLivesBefore = await page.locator('#grid [data-block-type="set-lives"]').count();
    await page.click('.block-selector .block-option[data-block-type="set-lives"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-lives"]').length > n,
      setLivesBefore);
    const setLivesCell = page.locator('#grid [data-block-type="set-lives"]').first();
    check('Set Lives block places on the grid', await setLivesCell.count() === 1);
    await setLivesCell.click();
    await page.waitForTimeout(400);
    const setLivesPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Set Lives panel offers the Lives field',
      /Lives/i.test(setLivesPropText),
      setLivesPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const loseLifeBefore = await page.locator('#grid [data-block-type="lose-life"]').count();
    await page.click('.block-selector .block-option[data-block-type="lose-life"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="lose-life"]').length > n,
      loseLifeBefore);
    const loseLifeCell = page.locator('#grid [data-block-type="lose-life"]').first();
    check('Lose Life block places on the grid', await loseLifeCell.count() === 1);
    await loseLifeCell.click();
    await page.waitForTimeout(400);
    const loseLifePropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Lose Life panel offers the Amount field',
      /Amount/i.test(loseLifePropText),
      loseLifePropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const livesBefore = await page.locator('#grid [data-block-type="lives"]').count();
    await page.click('.block-selector .block-option[data-block-type="lives"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="lives"]').length > n,
      livesBefore);
    const livesCell = page.locator('#grid [data-block-type="lives"]').first();
    check('Lives block places on the grid', await livesCell.count() === 1);
    await livesCell.click();
    await page.waitForTimeout(400);
    const livesPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Lives panel offers Compare / Value / Invert fields',
      /Compare/i.test(livesPropText) && /Value/i.test(livesPropText) && /Invert/i.test(livesPropText),
      livesPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const gameOverBefore = await page.locator('#grid [data-block-type="game-over"]').count();
    await page.click('.block-selector .block-option[data-block-type="game-over"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="game-over"]').length > n,
      gameOverBefore);
    const gameOverCell = page.locator('#grid [data-block-type="game-over"]').first();
    check('Game Over block places on the grid', await gameOverCell.count() === 1);
    await gameOverCell.click();
    await page.waitForTimeout(400);
    const gameOverPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Game Over panel offers the Invert field',
      /Invert/i.test(gameOverPropText),
      gameOverPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const addLivesBefore = await page.locator('#grid [data-block-type="add-lives"]').count();
    await page.click('.block-selector .block-option[data-block-type="add-lives"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="add-lives"]').length > n,
      addLivesBefore);
    check('Add Lives block places on the grid',
      await page.locator('#grid [data-block-type="add-lives"]').count() > addLivesBefore);
    await page.click('#back-to-blocks-btn');
    const readLivesBefore = await page.locator('#grid [data-block-type="read-lives"]').count();
    await page.click('.block-selector .block-option[data-block-type="read-lives"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="read-lives"]').length > n,
      readLivesBefore);
    check('Read Lives block places on the grid',
      await page.locator('#grid [data-block-type="read-lives"]').count() > readLivesBefore);
    await page.click('#back-to-blocks-btn');

    // ---- P4 Advanced batch 26: movement abilities — module,
    // palette blocks under the Movement category, placement + panels,
    // Inspector Movement section (batch 28 adds the wall slide /
    // wall jump blocks and the wall fields to the same section) ----
    const hydraMovementLoaded = await page.evaluate(() =>
      typeof window.HydraMovement !== 'undefined' &&
      typeof window.HydraMovement.createMovementState === 'function' &&
      typeof window.HydraMovement.tryJump === 'function' &&
      typeof window.HydraMovement.startDash === 'function' &&
      typeof window.HydraMovement.updateMovement === 'function' &&
      typeof window.HydraMovement.jumpsLeft === 'function' &&
      typeof window.HydraMovement.isDashing === 'function' &&
      typeof window.HydraMovement.touchingWall === 'function' &&
      typeof window.HydraMovement.isWallSliding === 'function' &&
      typeof window.HydraMovement.tryWallJump === 'function' &&
      typeof window.HydraMovement.setWallSlide === 'function' &&
      typeof window.HydraMovement.setWallJump === 'function' &&
      typeof window.HydraMovement.isMovementAction === 'function' &&
      typeof window.HydraMovement.isMovementCondition === 'function');
    check('HydraMovement module is loaded in the editor', hydraMovementLoaded);
    await page.click('.tab[data-tab="script-tab"]');
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const movementBlocks = await page.evaluate(() =>
      ['jump', 'dash', 'set-max-jumps', 'set-coyote-time', 'set-jump-buffer', 'jumps-left', 'is-dashing', 'set-wall-slide', 'set-wall-jump', 'wall-sliding'].every(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('All ten movement blocks are in the palette', movementBlocks);
    const movementCategory = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const catIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'Movement');
      if (catIdx === -1) return 'no Movement label';
      const after = items.slice(catIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      const inCat = (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type'));
      return ['jump', 'dash', 'set-max-jumps', 'set-coyote-time', 'set-jump-buffer', 'jumps-left', 'is-dashing', 'set-wall-slide', 'set-wall-jump', 'wall-sliding']
        .every(t => inCat.includes(t)) ? 'ok' :
        'missing under Movement (Movement holds ' + JSON.stringify(inCat) + ')';
    });
    check('All ten movement blocks sit under the Movement palette category (not under a later heading)',
      movementCategory === 'ok', movementCategory);
    const movementOrder = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const catIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'Movement');
      const after = items.slice(catIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      return (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type'))
        .filter(t => ['jump', 'dash', 'set-max-jumps', 'set-coyote-time', 'set-jump-buffer', 'jumps-left', 'is-dashing', 'set-wall-slide', 'set-wall-jump', 'wall-sliding'].includes(t))
        .join(',');
    });
    check('Movement blocks sit in Jump / Dash / Set Max Jumps / Set Coyote Time / Set Jump Buffer / Jumps Left / Is Dashing / Set Wall Slide / Set Wall Jump / Wall Sliding order in the palette',
      movementOrder === 'jump,dash,set-max-jumps,set-coyote-time,set-jump-buffer,jumps-left,is-dashing,set-wall-slide,set-wall-jump,wall-sliding', movementOrder);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('.block-selector .block-category-label')]
        .find(e => e.textContent.trim() === 'Movement');
      if (el) el.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(300);
    const jumpBefore = await page.locator('#grid [data-block-type="jump"]').count();
    await page.click('.block-selector .block-option[data-block-type="jump"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="jump"]').length > n,
      jumpBefore);
    const jumpCell = page.locator('#grid [data-block-type="jump"]').first();
    check('Jump block places on the grid', await jumpCell.count() === 1);
    await jumpCell.click();
    await page.waitForTimeout(400);
    const jumpPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Jump panel offers the Object / Jump speed fields',
      /Object/i.test(jumpPropText) && /Jump speed/i.test(jumpPropText),
      jumpPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const dashBefore = await page.locator('#grid [data-block-type="dash"]').count();
    await page.click('.block-selector .block-option[data-block-type="dash"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="dash"]').length > n,
      dashBefore);
    const dashCell = page.locator('#grid [data-block-type="dash"]').first();
    check('Dash block places on the grid', await dashCell.count() === 1);
    await dashCell.click();
    await page.waitForTimeout(400);
    const dashPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Dash panel offers Object / Direction / Speed / Duration / Cooldown fields',
      /Object/i.test(dashPropText) && /Direction/i.test(dashPropText) &&
      /Speed/i.test(dashPropText) && /Duration/i.test(dashPropText) && /Cooldown/i.test(dashPropText),
      dashPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const jumpsLeftBefore = await page.locator('#grid [data-block-type="jumps-left"]').count();
    await page.click('.block-selector .block-option[data-block-type="jumps-left"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="jumps-left"]').length > n,
      jumpsLeftBefore);
    const jumpsLeftCell = page.locator('#grid [data-block-type="jumps-left"]').first();
    check('Jumps Left block places on the grid', await jumpsLeftCell.count() === 1);
    await jumpsLeftCell.click();
    await page.waitForTimeout(400);
    const jumpsLeftPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Jumps Left panel offers Object / Compare / Value / Invert fields',
      /Object/i.test(jumpsLeftPropText) && /Compare/i.test(jumpsLeftPropText) &&
      /Value/i.test(jumpsLeftPropText) && /Invert/i.test(jumpsLeftPropText),
      jumpsLeftPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const setMaxJumpsBefore = await page.locator('#grid [data-block-type="set-max-jumps"]').count();
    await page.click('.block-selector .block-option[data-block-type="set-max-jumps"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-max-jumps"]').length > n,
      setMaxJumpsBefore);
    check('Set Max Jumps block places on the grid',
      await page.locator('#grid [data-block-type="set-max-jumps"]').count() > setMaxJumpsBefore);
    await page.click('#back-to-blocks-btn');
    const isDashingBefore = await page.locator('#grid [data-block-type="is-dashing"]').count();
    await page.click('.block-selector .block-option[data-block-type="is-dashing"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="is-dashing"]').length > n,
      isDashingBefore);
    check('Is Dashing block places on the grid',
      await page.locator('#grid [data-block-type="is-dashing"]').count() > isDashingBefore);
    await page.click('#back-to-blocks-btn');
    const setWallSlideBefore = await page.locator('#grid [data-block-type="set-wall-slide"]').count();
    await page.click('.block-selector .block-option[data-block-type="set-wall-slide"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-wall-slide"]').length > n,
      setWallSlideBefore);
    const setWallSlideCell = page.locator('#grid [data-block-type="set-wall-slide"]').first();
    check('Set Wall Slide block places on the grid', await setWallSlideCell.count() === 1);
    await setWallSlideCell.click();
    await page.waitForTimeout(400);
    const setWallSlidePropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Set Wall Slide panel offers Object / Max fall speed fields',
      /Object/i.test(setWallSlidePropText) && /Max fall speed/i.test(setWallSlidePropText),
      setWallSlidePropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const setWallJumpBefore = await page.locator('#grid [data-block-type="set-wall-jump"]').count();
    await page.click('.block-selector .block-option[data-block-type="set-wall-jump"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-wall-jump"]').length > n,
      setWallJumpBefore);
    const setWallJumpCell = page.locator('#grid [data-block-type="set-wall-jump"]').first();
    check('Set Wall Jump block places on the grid', await setWallJumpCell.count() === 1);
    await setWallJumpCell.click();
    await page.waitForTimeout(400);
    const setWallJumpPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Set Wall Jump panel offers Object / Jump speed / Push away fields',
      /Object/i.test(setWallJumpPropText) && /Jump speed/i.test(setWallJumpPropText) &&
      /Push away/i.test(setWallJumpPropText),
      setWallJumpPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const wallSlidingBefore = await page.locator('#grid [data-block-type="wall-sliding"]').count();
    await page.click('.block-selector .block-option[data-block-type="wall-sliding"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="wall-sliding"]').length > n,
      wallSlidingBefore);
    const wallSlidingCell = page.locator('#grid [data-block-type="wall-sliding"]').first();
    check('Wall Sliding block places on the grid', await wallSlidingCell.count() === 1);
    await wallSlidingCell.click();
    await page.waitForTimeout(400);
    const wallSlidingPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Wall Sliding panel offers Object / Invert fields',
      /Object/i.test(wallSlidingPropText) && /Invert/i.test(wallSlidingPropText),
      wallSlidingPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    // Inspector Movement section: a plain sprite carries Max jumps,
    // Coyote time, Jump buffer, Wall slide max fall, Wall jump speed,
    // and Wall jump push.
    await page.click('.tab[data-tab="scene-tab"]');
    await page.click('.inspector-tab[data-inspector-tab="create"]');
    await page.waitForSelector('.object-create-btn[data-create-kind="sprite"]', { timeout: 10000 });
    await page.click('.object-create-btn[data-create-kind="sprite"]');
    await page.waitForFunction(
      () => /Movement/.test(document.getElementById('object-properties')?.innerText || ''),
      { timeout: 5000 }).catch(() => {});
    const movementInsp = await page.evaluate(() =>
      document.getElementById('object-properties')?.innerText || '');
    check('Movement inspector section appears for a sprite',
      /movement/i.test(movementInsp) && /max jumps/i.test(movementInsp) &&
      /coyote time/i.test(movementInsp) && /jump buffer/i.test(movementInsp) &&
      /wall slide max fall/i.test(movementInsp) && /wall jump speed/i.test(movementInsp) &&
      /wall jump push/i.test(movementInsp),
      movementInsp.slice(0, 400));

    // ---- P4 Advanced batch 29: combat — module, palette blocks
    // under the Combat category, placement + panels ----
    const hydraCombatLoaded = await page.evaluate(() =>
      typeof window.HydraCombat !== 'undefined' &&
      typeof window.HydraCombat.createCombatState === 'function' &&
      typeof window.HydraCombat.meleeAttack === 'function' &&
      typeof window.HydraCombat.shootProjectile === 'function' &&
      typeof window.HydraCombat.attackReady === 'function' &&
      typeof window.HydraCombat.updateCombat === 'function' &&
      typeof window.HydraCombat.drawCombatEffects === 'function' &&
      typeof window.HydraCombat.isCombatAction === 'function' &&
      typeof window.HydraCombat.isCombatCondition === 'function');
    check('HydraCombat module is loaded in the editor', hydraCombatLoaded);
    await page.click('.tab[data-tab="script-tab"]');
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const combatBlocks = await page.evaluate(() =>
      ['melee-attack', 'shoot-projectile', 'attack-ready'].every(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('All three combat blocks are in the palette', combatBlocks);
    const combatCategory = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const catIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'Combat');
      if (catIdx === -1) return 'no Combat label';
      const after = items.slice(catIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      const inCat = (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type'));
      return ['melee-attack', 'shoot-projectile', 'attack-ready']
        .every(t => inCat.includes(t)) ? 'ok' :
        'missing under Combat (Combat holds ' + JSON.stringify(inCat) + ')';
    });
    check('All three combat blocks sit under the Combat palette category (not under a later heading)',
      combatCategory === 'ok', combatCategory);
    const combatOrder = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const catIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'Combat');
      const after = items.slice(catIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      return (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type'))
        .filter(t => ['melee-attack', 'shoot-projectile', 'attack-ready'].includes(t))
        .join(',');
    });
    check('Combat blocks sit in Melee Attack / Shoot Projectile / Attack Ready order in the palette',
      combatOrder === 'melee-attack,shoot-projectile,attack-ready', combatOrder);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('.block-selector .block-category-label')]
        .find(e => e.textContent.trim() === 'Combat');
      if (el) el.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(300);
    const meleeBefore = await page.locator('#grid [data-block-type="melee-attack"]').count();
    await page.click('.block-selector .block-option[data-block-type="melee-attack"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="melee-attack"]').length > n,
      meleeBefore);
    const meleeCell = page.locator('#grid [data-block-type="melee-attack"]').first();
    check('Melee Attack block places on the grid', await meleeCell.count() === 1);
    await meleeCell.click();
    await page.waitForTimeout(400);
    const meleePropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Melee Attack panel offers the Attacker / Damage / Range / Direction / Cooldown fields',
      /Attacker/i.test(meleePropText) && /Damage/i.test(meleePropText) &&
      /Range/i.test(meleePropText) && /Direction/i.test(meleePropText) &&
      /Cooldown/i.test(meleePropText),
      meleePropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const shootBefore = await page.locator('#grid [data-block-type="shoot-projectile"]').count();
    await page.click('.block-selector .block-option[data-block-type="shoot-projectile"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="shoot-projectile"]').length > n,
      shootBefore);
    const shootCell = page.locator('#grid [data-block-type="shoot-projectile"]').first();
    check('Shoot Projectile block places on the grid', await shootCell.count() === 1);
    await shootCell.click();
    await page.waitForTimeout(400);
    const shootPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Shoot Projectile panel offers Shooter / Projectile / Direction / Speed / Damage / Lifetime / Cooldown fields',
      /Shooter/i.test(shootPropText) && /Projectile/i.test(shootPropText) &&
      /Direction/i.test(shootPropText) && /Speed/i.test(shootPropText) &&
      /Damage/i.test(shootPropText) && /Lifetime/i.test(shootPropText) &&
      /Cooldown/i.test(shootPropText),
      shootPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const readyBefore = await page.locator('#grid [data-block-type="attack-ready"]').count();
    await page.click('.block-selector .block-option[data-block-type="attack-ready"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="attack-ready"]').length > n,
      readyBefore);
    const readyCell = page.locator('#grid [data-block-type="attack-ready"]').first();
    check('Attack Ready block places on the grid', await readyCell.count() === 1);
    await readyCell.click();
    await page.waitForTimeout(400);
    const readyPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Attack Ready panel offers the Object / Attack / Cooldown / Invert fields',
      /Object/i.test(readyPropText) && /Attack/i.test(readyPropText) &&
      /Cooldown/i.test(readyPropText) && /Invert/i.test(readyPropText),
      readyPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');

    // ---- P4 Advanced batch 30: experience & leveling — module,
    // palette blocks under the XP category, placement + panels ----
    const hydraXpLoaded = await page.evaluate(() =>
      typeof window.HydraXp !== 'undefined' &&
      typeof window.HydraXp.createXpState === 'function' &&
      typeof window.HydraXp.addXp === 'function' &&
      typeof window.HydraXp.setXp === 'function' &&
      typeof window.HydraXp.levelOf === 'function' &&
      typeof window.HydraXp.levelUp === 'function' &&
      typeof window.HydraXp.isXpAction === 'function' &&
      typeof window.HydraXp.isXpCondition === 'function');
    check('HydraXp module is loaded in the editor', hydraXpLoaded);
    await page.click('.tab[data-tab="script-tab"]');
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const xpBlocks = await page.evaluate(() =>
      ['add-xp', 'set-xp', 'set-xp-per-level', 'read-xp', 'read-level', 'xp', 'level', 'level-up'].every(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('All eight XP blocks are in the palette', xpBlocks);
    const xpCategory = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const catIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'XP');
      if (catIdx === -1) return 'no XP label';
      const after = items.slice(catIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      const inCat = (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type'));
      return ['add-xp', 'set-xp', 'set-xp-per-level', 'read-xp', 'read-level', 'xp', 'level', 'level-up']
        .every(t => inCat.includes(t)) ? 'ok' :
        'missing under XP (XP holds ' + JSON.stringify(inCat) + ')';
    });
    check('All eight XP blocks sit under the XP palette category (not under a later heading)',
      xpCategory === 'ok', xpCategory);
    const xpOrder = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const catIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'XP');
      const after = items.slice(catIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      return (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type'))
        .filter(t => ['add-xp', 'set-xp', 'set-xp-per-level', 'read-xp', 'read-level', 'xp', 'level', 'level-up'].includes(t))
        .join(',');
    });
    check('XP blocks sit in Add XP / Set XP / Set XP Per Level / Read XP / Read Level / XP / Level / Level Up order in the palette',
      xpOrder === 'add-xp,set-xp,set-xp-per-level,read-xp,read-level,xp,level,level-up', xpOrder);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('.block-selector .block-category-label')]
        .find(e => e.textContent.trim() === 'XP');
      if (el) el.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(300);
    const addXpBefore = await page.locator('#grid [data-block-type="add-xp"]').count();
    await page.click('.block-selector .block-option[data-block-type="add-xp"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="add-xp"]').length > n,
      addXpBefore);
    const addXpCell = page.locator('#grid [data-block-type="add-xp"]').first();
    check('Add XP block places on the grid', await addXpCell.count() === 1);
    await addXpCell.click();
    await page.waitForTimeout(400);
    const addXpPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Add XP panel offers the Amount field',
      /Amount/i.test(addXpPropText),
      addXpPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const perLevelBefore = await page.locator('#grid [data-block-type="set-xp-per-level"]').count();
    await page.click('.block-selector .block-option[data-block-type="set-xp-per-level"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-xp-per-level"]').length > n,
      perLevelBefore);
    const perLevelCell = page.locator('#grid [data-block-type="set-xp-per-level"]').first();
    check('Set XP Per Level block places on the grid', await perLevelCell.count() === 1);
    await perLevelCell.click();
    await page.waitForTimeout(400);
    const perLevelPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Set XP Per Level panel offers the Amount field',
      /Amount/i.test(perLevelPropText),
      perLevelPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const readLevelBefore = await page.locator('#grid [data-block-type="read-level"]').count();
    await page.click('.block-selector .block-option[data-block-type="read-level"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="read-level"]').length > n,
      readLevelBefore);
    const readLevelCell = page.locator('#grid [data-block-type="read-level"]').first();
    check('Read Level block places on the grid', await readLevelCell.count() === 1);
    await readLevelCell.click();
    await page.waitForTimeout(400);
    const readLevelPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Read Level panel offers the Into variable field',
      /Into variable/i.test(readLevelPropText),
      readLevelPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const levelUpBefore = await page.locator('#grid [data-block-type="level-up"]').count();
    await page.click('.block-selector .block-option[data-block-type="level-up"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="level-up"]').length > n,
      levelUpBefore);
    const levelUpCell = page.locator('#grid [data-block-type="level-up"]').first();
    check('Level Up block places on the grid', await levelUpCell.count() === 1);
    await levelUpCell.click();
    await page.waitForTimeout(400);
    const levelUpPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Level Up panel offers the Trigger and Invert fields',
      /Trigger/i.test(levelUpPropText) && /Invert/i.test(levelUpPropText),
      levelUpPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');

    // ---- P4 Advanced batch 31: level-up rewards & stat growth —
    // module, palette blocks under the Growth category, placement +
    // panels ----
    const hydraGrowthLoaded = await page.evaluate(() =>
      typeof window.HydraGrowth !== 'undefined' &&
      typeof window.HydraGrowth.createGrowthState === 'function' &&
      typeof window.HydraGrowth.addMaxHealthBonus === 'function' &&
      typeof window.HydraGrowth.addDamageBonus === 'function' &&
      typeof window.HydraGrowth.addSpeedBonus === 'function' &&
      typeof window.HydraGrowth.rewardBundle === 'function' &&
      typeof window.HydraGrowth.applyReward === 'function' &&
      typeof window.HydraGrowth.isGrowthAction === 'function');
    check('HydraGrowth module is loaded in the editor', hydraGrowthLoaded);
    await page.click('.tab[data-tab="script-tab"]');
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const growthBlocks = await page.evaluate(() =>
      ['grow-max-health', 'grow-damage', 'grow-speed', 'level-reward', 'read-max-health-bonus', 'read-damage-bonus', 'read-speed-bonus'].every(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('All seven growth blocks are in the palette', growthBlocks);
    const growthCategory = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const catIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'Growth');
      if (catIdx === -1) return 'no Growth label';
      const after = items.slice(catIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      const inCat = (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type'));
      return ['grow-max-health', 'grow-damage', 'grow-speed', 'level-reward', 'read-max-health-bonus', 'read-damage-bonus', 'read-speed-bonus']
        .every(t => inCat.includes(t)) ? 'ok' :
        'missing under Growth (Growth holds ' + JSON.stringify(inCat) + ')';
    });
    check('All seven growth blocks sit under the Growth palette category (not under a later heading)',
      growthCategory === 'ok', growthCategory);
    const growthOrder = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const catIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'Growth');
      const after = items.slice(catIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      return (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type'))
        .filter(t => ['grow-max-health', 'grow-damage', 'grow-speed', 'level-reward', 'read-max-health-bonus', 'read-damage-bonus', 'read-speed-bonus'].includes(t))
        .join(',');
    });
    check('Growth blocks sit in Grow Max Health / Grow Damage / Grow Speed / Level Reward / Read Max Health Bonus / Read Damage Bonus / Read Speed Bonus order in the palette',
      growthOrder === 'grow-max-health,grow-damage,grow-speed,level-reward,read-max-health-bonus,read-damage-bonus,read-speed-bonus', growthOrder);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('.block-selector .block-category-label')]
        .find(e => e.textContent.trim() === 'Growth');
      if (el) el.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(300);
    const growHpBefore = await page.locator('#grid [data-block-type="grow-max-health"]').count();
    await page.click('.block-selector .block-option[data-block-type="grow-max-health"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="grow-max-health"]').length > n,
      growHpBefore);
    const growHpCell = page.locator('#grid [data-block-type="grow-max-health"]').first();
    check('Grow Max Health block places on the grid', await growHpCell.count() === 1);
    await growHpCell.click();
    await page.waitForTimeout(400);
    const growHpPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Grow Max Health panel offers the Object, Amount, and Heal too fields',
      /Object/i.test(growHpPropText) && /Amount/i.test(growHpPropText) && /Heal too/i.test(growHpPropText),
      growHpPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const growDmgBefore = await page.locator('#grid [data-block-type="grow-damage"]').count();
    await page.click('.block-selector .block-option[data-block-type="grow-damage"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="grow-damage"]').length > n,
      growDmgBefore);
    const growDmgCell = page.locator('#grid [data-block-type="grow-damage"]').first();
    check('Grow Damage block places on the grid', await growDmgCell.count() === 1);
    await growDmgCell.click();
    await page.waitForTimeout(400);
    const growDmgPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Grow Damage panel offers the Object and Amount fields',
      /Object/i.test(growDmgPropText) && /Amount/i.test(growDmgPropText),
      growDmgPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const levelRewardBefore = await page.locator('#grid [data-block-type="level-reward"]').count();
    await page.click('.block-selector .block-option[data-block-type="level-reward"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="level-reward"]').length > n,
      levelRewardBefore);
    const levelRewardCell = page.locator('#grid [data-block-type="level-reward"]').first();
    check('Level Reward block places on the grid', await levelRewardCell.count() === 1);
    await levelRewardCell.click();
    await page.waitForTimeout(400);
    const levelRewardPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Level Reward panel offers the Object and Reward fields',
      /Object/i.test(levelRewardPropText) && /Reward/i.test(levelRewardPropText),
      levelRewardPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const readDmgBefore = await page.locator('#grid [data-block-type="read-damage-bonus"]').count();
    await page.click('.block-selector .block-option[data-block-type="read-damage-bonus"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="read-damage-bonus"]').length > n,
      readDmgBefore);
    const readDmgCell = page.locator('#grid [data-block-type="read-damage-bonus"]').first();
    check('Read Damage Bonus block places on the grid', await readDmgCell.count() === 1);
    await readDmgCell.click();
    await page.waitForTimeout(400);
    const readDmgPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Read Damage Bonus panel offers the Object and Into variable fields',
      /Object/i.test(readDmgPropText) && /Into variable/i.test(readDmgPropText),
      readDmgPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');

    // ---- P4 Advanced batch 32: enemy scaling with the hero's level —
    // module, palette blocks under the Scaling category, placement +
    // panels ----
    const hydraScalingLoaded = await page.evaluate(() =>
      typeof window.HydraScaling !== 'undefined' &&
      typeof window.HydraScaling.createScalingState === 'function' &&
      typeof window.HydraScaling.scalingKeyOf === 'function' &&
      typeof window.HydraScaling.normalizeLevel === 'function' &&
      typeof window.HydraScaling.levelOf === 'function' &&
      typeof window.HydraScaling.hpBonusOf === 'function' &&
      typeof window.HydraScaling.dmgBonusOf === 'function' &&
      typeof window.HydraScaling.setLevel === 'function' &&
      typeof window.HydraScaling.setRates === 'function' &&
      typeof window.HydraScaling.isScalingAction === 'function' &&
      typeof window.HydraScaling.isScalingCondition === 'function');
    check('HydraScaling module is loaded in the editor', hydraScalingLoaded);
    const scalingBlocks = await page.evaluate(() =>
      ['set-enemy-level', 'set-scaling-rates', 'scale-to-hero-level', 'read-enemy-level',
       'read-scaled-hp-bonus', 'read-scaled-dmg-bonus', 'enemy-level']
        .every(t => !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('All seven scaling blocks are in the palette', scalingBlocks);
    const scalingCategory = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const catIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'Scaling');
      if (catIdx === -1) return 'no Scaling label';
      const after = items.slice(catIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      const inCat = (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type')).filter(Boolean);
      const want = ['set-enemy-level', 'set-scaling-rates', 'scale-to-hero-level', 'read-enemy-level',
        'read-scaled-hp-bonus', 'read-scaled-dmg-bonus', 'enemy-level'];
      return want.every(t => inCat.includes(t)) ? 'ok' :
        'missing under Scaling (Scaling holds ' + JSON.stringify(inCat) + ')';
    });
    check('All seven scaling blocks sit under the Scaling palette category (not under a later heading)',
      scalingCategory === 'ok', scalingCategory);
    const scalingOrder = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const catIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'Scaling');
      const after = items.slice(catIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      return (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type'))
        .filter(t => ['set-enemy-level', 'set-scaling-rates', 'scale-to-hero-level', 'read-enemy-level', 'read-scaled-hp-bonus', 'read-scaled-dmg-bonus', 'enemy-level'].includes(t))
        .join(',');
    });
    check('Scaling blocks sit in Set Enemy Level / Set Scaling Rates / Scale to Hero Level / Read Enemy Level / Read Scaled HP Bonus / Read Scaled Damage Bonus / Enemy Level order in the palette',
      scalingOrder === 'set-enemy-level,set-scaling-rates,scale-to-hero-level,read-enemy-level,read-scaled-hp-bonus,read-scaled-dmg-bonus,enemy-level', scalingOrder);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('.block-selector .block-category-label')]
        .find(e => e.textContent.trim() === 'Scaling');
      if (el) el.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(300);
    const setLvlBefore = await page.locator('#grid [data-block-type="set-enemy-level"]').count();
    await page.click('.block-selector .block-option[data-block-type="set-enemy-level"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-enemy-level"]').length > n,
      setLvlBefore);
    const setLvlCell = page.locator('#grid [data-block-type="set-enemy-level"]').first();
    check('Set Enemy Level block places on the grid', await setLvlCell.count() === 1);
    await setLvlCell.click();
    await page.waitForTimeout(400);
    const setLvlPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Set Enemy Level panel offers the Object and Level fields',
      /Object/i.test(setLvlPropText) && /Level/i.test(setLvlPropText),
      setLvlPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const setRatesBefore = await page.locator('#grid [data-block-type="set-scaling-rates"]').count();
    await page.click('.block-selector .block-option[data-block-type="set-scaling-rates"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-scaling-rates"]').length > n,
      setRatesBefore);
    const setRatesCell = page.locator('#grid [data-block-type="set-scaling-rates"]').first();
    check('Set Scaling Rates block places on the grid', await setRatesCell.count() === 1);
    await setRatesCell.click();
    await page.waitForTimeout(400);
    const setRatesPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Set Scaling Rates panel offers the Object, HP per level, and Damage per level fields',
      /Object/i.test(setRatesPropText) && /HP per level/i.test(setRatesPropText) && /Damage per level/i.test(setRatesPropText),
      setRatesPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const scaleHeroBefore = await page.locator('#grid [data-block-type="scale-to-hero-level"]').count();
    await page.click('.block-selector .block-option[data-block-type="scale-to-hero-level"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="scale-to-hero-level"]').length > n,
      scaleHeroBefore);
    const scaleHeroCell = page.locator('#grid [data-block-type="scale-to-hero-level"]').first();
    check('Scale to Hero Level block places on the grid', await scaleHeroCell.count() === 1);
    await scaleHeroCell.click();
    await page.waitForTimeout(400);
    const scaleHeroPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Scale to Hero Level panel offers the Object field',
      /Object/i.test(scaleHeroPropText),
      scaleHeroPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const enemyLvlBefore = await page.locator('#grid [data-block-type="enemy-level"]').count();
    await page.click('.block-selector .block-option[data-block-type="enemy-level"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="enemy-level"]').length > n,
      enemyLvlBefore);
    const enemyLvlCell = page.locator('#grid [data-block-type="enemy-level"]').first();
    check('Enemy Level block places on the grid', await enemyLvlCell.count() === 1);
    await enemyLvlCell.click();
    await page.waitForTimeout(400);
    const enemyLvlPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Enemy Level panel offers the Trigger, Object, Compare, and Invert fields',
      /Trigger/i.test(enemyLvlPropText) && /Object/i.test(enemyLvlPropText) &&
      /Compare/i.test(enemyLvlPropText) && /Invert/i.test(enemyLvlPropText),
      enemyLvlPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');

    // ---- P4 Advanced batch 33: boss encounters — module, palette
    // blocks under the Boss category, placement + panels, and a live
    // preview where the boss bar paints green at full health and red
    // in the final phase ----
    const hydraBossLoaded = await page.evaluate(() =>
      typeof window.HydraBoss !== 'undefined' &&
      typeof window.HydraBoss.createBossState === 'function' &&
      typeof window.HydraBoss.normalizePhaseCount === 'function' &&
      typeof window.HydraBoss.isActive === 'function' &&
      typeof window.HydraBoss.fractionOf === 'function' &&
      typeof window.HydraBoss.phaseOf === 'function' &&
      typeof window.HydraBoss.phaseOfState === 'function' &&
      typeof window.HydraBoss.startBoss === 'function' &&
      typeof window.HydraBoss.endBoss === 'function' &&
      typeof window.HydraBoss.setBarVisible === 'function' &&
      typeof window.HydraBoss.bossBarRect === 'function' &&
      typeof window.HydraBoss.bossBarColor === 'function' &&
      typeof window.HydraBoss.drawBossBar === 'function' &&
      typeof window.HydraBoss.isBossAction === 'function' &&
      typeof window.HydraBoss.isBossCondition === 'function');
    check('HydraBoss module is loaded in the editor', hydraBossLoaded);
    const bossBlocks = await page.evaluate(() =>
      ['start-boss', 'end-boss', 'show-boss-bar', 'hide-boss-bar', 'read-boss-phase',
       'boss-phase', 'boss-active']
        .every(t => !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('All seven boss blocks are in the palette', bossBlocks);
    const bossCategory = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const catIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'Boss');
      if (catIdx === -1) return 'no Boss label';
      const after = items.slice(catIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      const inCat = (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type')).filter(Boolean);
      const want = ['start-boss', 'end-boss', 'show-boss-bar', 'hide-boss-bar', 'read-boss-phase',
        'boss-phase', 'boss-active'];
      return want.every(t => inCat.includes(t)) ? 'ok' :
        'missing under Boss (Boss holds ' + JSON.stringify(inCat) + ')';
    });
    check('All seven boss blocks sit under the Boss palette category (not under a later heading)',
      bossCategory === 'ok', bossCategory);
    const bossOrder = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const catIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'Boss');
      const after = items.slice(catIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      return (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type'))
        .filter(t => ['start-boss', 'end-boss', 'show-boss-bar', 'hide-boss-bar', 'read-boss-phase',
          'boss-phase', 'boss-active'].includes(t))
        .join(',');
    });
    check('Boss blocks sit in Start Boss / End Boss / Show Boss Bar / Hide Boss Bar / Read Boss Phase / Boss Phase / Boss Active order in the palette',
      bossOrder === 'start-boss,end-boss,show-boss-bar,hide-boss-bar,read-boss-phase,boss-phase,boss-active', bossOrder);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('.block-selector .block-category-label')]
        .find(e => e.textContent.trim() === 'Boss');
      if (el) el.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(300);
    const startBossBefore = await page.locator('#grid [data-block-type="start-boss"]').count();
    await page.click('.block-selector .block-option[data-block-type="start-boss"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="start-boss"]').length > n,
      startBossBefore);
    const startBossCell = page.locator('#grid [data-block-type="start-boss"]').first();
    check('Start Boss block places on the grid', await startBossCell.count() === 1);
    await startBossCell.click();
    await page.waitForTimeout(400);
    const startBossPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Start Boss panel offers the Object, Phases, and Show bar fields',
      /Object/i.test(startBossPropText) && /Phases/i.test(startBossPropText) && /Show bar/i.test(startBossPropText),
      startBossPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const bossPhaseBefore = await page.locator('#grid [data-block-type="boss-phase"]').count();
    await page.click('.block-selector .block-option[data-block-type="boss-phase"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="boss-phase"]').length > n,
      bossPhaseBefore);
    const bossPhaseCell = page.locator('#grid [data-block-type="boss-phase"]').first();
    check('Boss Phase block places on the grid', await bossPhaseCell.count() === 1);
    await bossPhaseCell.click();
    await page.waitForTimeout(400);
    const bossPhasePropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Boss Phase panel offers the Trigger, Compare, Value, and Invert fields',
      /Trigger/i.test(bossPhasePropText) && /Compare/i.test(bossPhasePropText) &&
      /Value/i.test(bossPhasePropText) && /Invert/i.test(bossPhasePropText),
      bossPhasePropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const readPhaseBefore = await page.locator('#grid [data-block-type="read-boss-phase"]').count();
    await page.click('.block-selector .block-option[data-block-type="read-boss-phase"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="read-boss-phase"]').length > n,
      readPhaseBefore);
    const readPhaseCell = page.locator('#grid [data-block-type="read-boss-phase"]').first();
    check('Read Boss Phase block places on the grid', await readPhaseCell.count() === 1);
    await readPhaseCell.click();
    await page.waitForTimeout(400);
    const readPhasePropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Read Boss Phase panel offers the Into variable field',
      /Into variable/i.test(readPhasePropText),
      readPhasePropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const bossActiveBefore = await page.locator('#grid [data-block-type="boss-active"]').count();
    await page.click('.block-selector .block-option[data-block-type="boss-active"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="boss-active"]').length > n,
      bossActiveBefore);
    const bossActiveCell = page.locator('#grid [data-block-type="boss-active"]').first();
    check('Boss Active block places on the grid', await bossActiveCell.count() === 1);
    await bossActiveCell.click();
    await page.waitForTimeout(400);
    const bossActivePropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Boss Active panel offers the Trigger and Invert fields',
      /Trigger/i.test(bossActivePropText) && /Invert/i.test(bossActivePropText),
      bossActivePropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const endBossBefore = await page.locator('#grid [data-block-type="end-boss"]').count();
    await page.click('.block-selector .block-option[data-block-type="end-boss"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="end-boss"]').length > n,
      endBossBefore);
    check('End Boss block places on the grid',
      await page.locator('#grid [data-block-type="end-boss"]').count() === 1);
    await page.click('#back-to-blocks-btn');
    const showBarBefore = await page.locator('#grid [data-block-type="show-boss-bar"]').count();
    await page.click('.block-selector .block-option[data-block-type="show-boss-bar"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="show-boss-bar"]').length > n,
      showBarBefore);
    check('Show Boss Bar block places on the grid',
      await page.locator('#grid [data-block-type="show-boss-bar"]').count() === 1);
    await page.click('#back-to-blocks-btn');
    const hideBarBefore = await page.locator('#grid [data-block-type="hide-boss-bar"]').count();
    await page.click('.block-selector .block-option[data-block-type="hide-boss-bar"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="hide-boss-bar"]').length > n,
      hideBarBefore);
    check('Hide Boss Bar block places on the grid',
      await page.locator('#grid [data-block-type="hide-boss-bar"]').count() === 1);
    await page.click('#back-to-blocks-btn');
    // Live preview: two seeded pages — one full-health fight (the bar
    // paints green across its whole width, phase 1, Boss Active fires,
    // Boss Phase stays quiet) and one fight hurt to 50 of 300 (phase 3,
    // the Boss Phase row fires, the bar paints red in its filled
    // slice and dark past it).
    function bossSeed(damage) {
      const now = new Date().toISOString();
      const grid = {
        0: { type: 'gameStart', kind: 'condition' },
        1: { type: 'startBoss', kind: 'action', targetObject: 'goblinKing', phases: 3, showBar: true },
        2: { type: 'damageObject', kind: 'action', targetObject: 'goblinKing', amount: String(damage) },
        3: { type: 'readBossPhase', kind: 'action', varName: 'bPhase' },
        4: { type: 'setVariable', kind: 'action', varName: 'started', operation: 'set', value: '1' },
        720: { type: 'bossPhase', kind: 'condition', operator: '>=', value: 2 },
        721: { type: 'setVariable', kind: 'action', varName: 'gatedPhase2', operation: 'set', value: '1' },
        780: { type: 'bossActive', kind: 'condition' },
        781: { type: 'setVariable', kind: 'action', varName: 'fightOn', operation: 'set', value: '1' }
      };
      return {
        id: 'boss-game', name: 'Boss Game', dateCreated: now, lastModified: now, assets: {},
        globalGridData: grid,
        scenes: [{
          id: 1, name: 'Main', gridData: {},
          objects: [
            { id: 1, name: 'hero', kind: 'sprite', posX: 10, posY: 500, width: 40, height: 40, color: '#ff0000' },
            { id: 2, name: 'goblinKing', kind: 'sprite', posX: 500, posY: 100, width: 60, height: 60, color: '#990000', health: 300, maxHealth: 300 }
          ],
          worldWidth: 800, worldHeight: 600, viewportWidth: 800, viewportHeight: 600, bgColor: '#ffffff'
        }],
        currentSceneId: 1
      };
    }
    async function bossPreview(damage) {
      const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
      const pg = await ctx.newPage();
      const errs = [];
      pg.on('pageerror', e => errs.push(String(e && e.message || e)));
      await goto(pg, `http://localhost:${PORT}/home.html`, { waitUntil: 'domcontentloaded' });
      await pg.evaluate((seed) => {
        localStorage.setItem('hydraProjects', JSON.stringify([seed]));
        localStorage.setItem('currentProjectId', 'boss-game');
      }, bossSeed(damage));
      await goto(pg, `http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
      await pg.click('.tab[data-tab="preview-tab"]');
      await pg.waitForSelector('#game-canvas', { timeout: 10000 });
      await pg.waitForFunction(() => gameVariables.started === 1, null, { timeout: 10000 });
      await pg.waitForTimeout(500);
      const pxAt = (x, y) => pg.evaluate(([px, py]) => {
        const c = document.getElementById('game-canvas');
        const d = c.getContext('2d').getImageData(px, py, 1, 1).data;
        return [d[0], d[1], d[2], d[3]];
      }, [x, y]);
      const vars = await pg.evaluate(() => ({
        bPhase: gameVariables.bPhase, fightOn: gameVariables.fightOn,
        gatedPhase2: gameVariables.gatedPhase2
      }));
      const out = { vars, errs, mid: await pxAt(400, 33), left: await pxAt(200, 33) };
      await ctx.close();
      return out;
    }
    const bossFull = await bossPreview(0);
    check('preview starts the boss fight at full health (phase 1, Boss Active fires, Boss Phase stays quiet)',
      bossFull.vars.bPhase === 1 && bossFull.vars.fightOn === 1 &&
      bossFull.vars.gatedPhase2 === undefined,
      JSON.stringify(bossFull.vars));
    check('preview paints the full-health boss bar green at its center',
      bossFull.mid[0] >= 25 && bossFull.mid[0] <= 45 && bossFull.mid[1] >= 185 &&
      bossFull.mid[1] <= 210 && bossFull.mid[2] >= 85 && bossFull.mid[2] <= 105,
      JSON.stringify(bossFull.mid));
    check('no page errors on the full-health boss page', bossFull.errs.length === 0,
      bossFull.errs.slice(0, 3).join(' | '));
    const bossHurt = await bossPreview(250);
    check('preview reads phase 3 at 50 of 300 and fires the Boss Phase row',
      bossHurt.vars.bPhase === 3 && bossHurt.vars.gatedPhase2 === 1 &&
      bossHurt.vars.fightOn === 1,
      JSON.stringify(bossHurt.vars));
    check('preview paints the hurt boss bar red in its filled slice',
      bossHurt.left[0] > 220 && bossHurt.left[1] < 90 && bossHurt.left[2] < 90,
      JSON.stringify(bossHurt.left));
    check('preview leaves the hurt boss bar dark past its filled slice',
      bossHurt.mid[0] >= 100 && bossHurt.mid[0] <= 135 && bossHurt.mid[1] >= 100 &&
      bossHurt.mid[1] <= 135 && bossHurt.mid[2] >= 100 && bossHurt.mid[2] <= 135,
      JSON.stringify(bossHurt.mid));
    check('no page errors on the hurt boss page', bossHurt.errs.length === 0,
      bossHurt.errs.slice(0, 3).join(' | '));

    // ---- P4 Advanced batch 34: object tags — module, palette blocks
    // under the Tags category, placement + panels, the Inspector Tags
    // section (chips + add box), and a live preview where the authored
    // tags count 2 and a runtime tag lands on the hero ----
    const hydraTagsLoaded = await page.evaluate(() =>
      typeof window.HydraTags !== 'undefined' &&
      typeof window.HydraTags.normalizeTag === 'function' &&
      typeof window.HydraTags.tagEquals === 'function' &&
      typeof window.HydraTags.normalizeTags === 'function' &&
      typeof window.HydraTags.normalizeTagsOn === 'function' &&
      typeof window.HydraTags.tagsOf === 'function' &&
      typeof window.HydraTags.hasTag === 'function' &&
      typeof window.HydraTags.addTag === 'function' &&
      typeof window.HydraTags.removeTag === 'function' &&
      typeof window.HydraTags.clearTags === 'function' &&
      typeof window.HydraTags.objectsWithTag === 'function' &&
      typeof window.HydraTags.countTagged === 'function' &&
      typeof window.HydraTags.isTagAction === 'function' &&
      typeof window.HydraTags.isTagCondition === 'function');
    check('HydraTags module is loaded in the editor', hydraTagsLoaded);
    const tagBlocks = await page.evaluate(() =>
      ['add-tag', 'remove-tag', 'clear-tags', 'read-tagged-count',
       'has-tag', 'tagged-count']
        .every(t => !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('The six original tag blocks are in the palette', tagBlocks);
    const tagCategory = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const catIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'Tags');
      if (catIdx === -1) return 'no Tags label';
      const after = items.slice(catIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      const inCat = (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type')).filter(Boolean);
      const want = ['add-tag', 'remove-tag', 'clear-tags', 'read-tagged-count',
        'has-tag', 'tagged-count'];
      return want.every(t => inCat.includes(t)) ? 'ok' :
        'missing under Tags (Tags holds ' + JSON.stringify(inCat) + ')';
    });
    check('The six original tag blocks sit under the Tags palette category (not under a later heading)',
      tagCategory === 'ok', tagCategory);
    const tagOrder = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const catIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'Tags');
      const after = items.slice(catIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      return (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type'))
        .filter(t => ['add-tag', 'remove-tag', 'clear-tags', 'read-tagged-count',
          'has-tag', 'tagged-count'].includes(t))
        .join(',');
    });
    check('Tag blocks sit in Add Tag / Remove Tag / Clear Tags / Read Tagged Count / Has Tag / Tagged Count order in the palette',
      tagOrder === 'add-tag,remove-tag,clear-tags,read-tagged-count,has-tag,tagged-count', tagOrder);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('.block-selector .block-category-label')]
        .find(e => e.textContent.trim() === 'Tags');
      if (el) el.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(300);
    const addTagBefore = await page.locator('#grid [data-block-type="add-tag"]').count();
    await page.click('.block-selector .block-option[data-block-type="add-tag"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="add-tag"]').length > n,
      addTagBefore);
    const addTagCell = page.locator('#grid [data-block-type="add-tag"]').first();
    check('Add Tag block places on the grid', await addTagCell.count() === 1);
    await addTagCell.click();
    await page.waitForTimeout(400);
    const addTagPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Add Tag panel offers the Object and Tag fields',
      /Object/i.test(addTagPropText) && /Tag/i.test(addTagPropText),
      addTagPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const hasTagBefore = await page.locator('#grid [data-block-type="has-tag"]').count();
    await page.click('.block-selector .block-option[data-block-type="has-tag"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="has-tag"]').length > n,
      hasTagBefore);
    const hasTagCell = page.locator('#grid [data-block-type="has-tag"]').first();
    check('Has Tag block places on the grid', await hasTagCell.count() === 1);
    await hasTagCell.click();
    await page.waitForTimeout(400);
    const hasTagPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Has Tag panel offers the Trigger, Object, Tag, and Invert fields',
      /Trigger/i.test(hasTagPropText) && /Object/i.test(hasTagPropText) &&
      /Tag/i.test(hasTagPropText) && /Invert/i.test(hasTagPropText),
      hasTagPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const readCountBefore = await page.locator('#grid [data-block-type="read-tagged-count"]').count();
    await page.click('.block-selector .block-option[data-block-type="read-tagged-count"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="read-tagged-count"]').length > n,
      readCountBefore);
    const readCountCell = page.locator('#grid [data-block-type="read-tagged-count"]').first();
    check('Read Tagged Count block places on the grid', await readCountCell.count() === 1);
    await readCountCell.click();
    await page.waitForTimeout(400);
    const readCountPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Read Tagged Count panel offers the Tag and Into variable fields',
      /Tag/i.test(readCountPropText) && /Into variable/i.test(readCountPropText),
      readCountPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const taggedCountBefore = await page.locator('#grid [data-block-type="tagged-count"]').count();
    await page.click('.block-selector .block-option[data-block-type="tagged-count"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="tagged-count"]').length > n,
      taggedCountBefore);
    const taggedCountCell = page.locator('#grid [data-block-type="tagged-count"]').first();
    check('Tagged Count block places on the grid', await taggedCountCell.count() === 1);
    await taggedCountCell.click();
    await page.waitForTimeout(400);
    const taggedCountPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Tagged Count panel offers the Trigger, Tag, Compare, Value, and Invert fields',
      /Trigger/i.test(taggedCountPropText) && /Tag/i.test(taggedCountPropText) &&
      /Compare/i.test(taggedCountPropText) && /Value/i.test(taggedCountPropText) &&
      /Invert/i.test(taggedCountPropText),
      taggedCountPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const removeTagBefore = await page.locator('#grid [data-block-type="remove-tag"]').count();
    await page.click('.block-selector .block-option[data-block-type="remove-tag"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="remove-tag"]').length > n,
      removeTagBefore);
    check('Remove Tag block places on the grid',
      await page.locator('#grid [data-block-type="remove-tag"]').count() === 1);
    await page.click('#back-to-blocks-btn');
    const clearTagsBefore = await page.locator('#grid [data-block-type="clear-tags"]').count();
    await page.click('.block-selector .block-option[data-block-type="clear-tags"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="clear-tags"]').length > n,
      clearTagsBefore);
    check('Clear Tags block places on the grid',
      await page.locator('#grid [data-block-type="clear-tags"]').count() === 1);
    await page.click('#back-to-blocks-btn');
    // Scene tab: a fresh sprite's Inspector shows the Tags section
    // with no tags yet, an add box, and a working chip round trip.
    await page.click('.tab[data-tab="scene-tab"]');
    await page.click('.inspector-tab[data-inspector-tab="create"]');
    await page.waitForSelector('.object-create-btn[data-create-kind="sprite"]', { timeout: 10000 });
    await page.click('.object-create-btn[data-create-kind="sprite"]');
    await page.waitForSelector('.game-object', { timeout: 5000 });
    await page.waitForTimeout(400);
    const tagsEmpty = await page.evaluate(() => {
      const sec = document.querySelector('.tags-editor');
      return {
        section: !!sec,
        text: document.getElementById('object-properties')?.innerText || '',
        empty: sec?.querySelector('.tags-empty')?.textContent?.trim() || '',
        addBtn: sec?.querySelector('.tags-add-row .component-mini-btn')?.textContent?.trim() || ''
      };
    });
    check('Inspector shows the Tags section with no tags yet and an Add tag box for a fresh sprite',
      tagsEmpty.section &&
      /Tags/i.test(tagsEmpty.text) &&
      tagsEmpty.empty === 'No tags yet.' &&
      tagsEmpty.addBtn === 'Add tag',
      JSON.stringify(tagsEmpty));
    await page.locator('.tags-add-row input').fill('goblin');
    await page.click('.tags-add-row .component-mini-btn');
    await page.waitForTimeout(300);
    const tagsAdded = await page.evaluate(() => {
      const chips = [...document.querySelectorAll('.tags-editor .tag-chip')]
        .map(c => c.childNodes[0]?.textContent?.trim() || '');
      return { chips, empty: !!document.querySelector('.tags-editor .tags-empty') };
    });
    check('Inspector Add tag sticks a goblin chip on the fresh sprite',
      JSON.stringify(tagsAdded.chips) === JSON.stringify(['goblin']) && tagsAdded.empty === false,
      JSON.stringify(tagsAdded));
    await page.locator('.tags-editor .tag-chip-x').click();
    await page.waitForTimeout(300);
    const tagsCleared = await page.evaluate(() => ({
      chips: document.querySelectorAll('.tags-editor .tag-chip').length,
      empty: document.querySelector('.tags-editor .tags-empty')?.textContent?.trim() || ''
    }));
    check('Inspector chip × takes the tag back off (No tags yet. returns)',
      tagsCleared.chips === 0 && tagsCleared.empty === 'No tags yet.',
      JSON.stringify(tagsCleared));
    await page.click('.tab[data-tab="script-tab"]');
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    // Live preview: one seeded page — the two authored goblins count
    // 2 (either case), Add Tag lands heroTag on the hero, and the
    // Tagged Count row stays quiet while goblins remain.
    function tagsSeed() {
      const now = new Date().toISOString();
      const grid = {
        0: { type: 'gameStart', kind: 'condition' },
        1: { type: 'addTag', kind: 'action', targetObject: 'hero', tag: 'heroTag' },
        2: { type: 'readTaggedCount', kind: 'action', tag: 'goblin', varName: 'gLeft' },
        720: { type: 'hasTag', kind: 'condition', targetObject: 'hero', tag: 'heroTag' },
        721: { type: 'setVariable', kind: 'action', varName: 'taggedHero', operation: 'set', value: '1' },
        780: { type: 'taggedCount', kind: 'condition', tag: 'goblin', operator: '==', value: 0 },
        781: { type: 'setVariable', kind: 'action', varName: 'allGone', operation: 'set', value: '1' }
      };
      return {
        id: 'tags-game', name: 'Tags Game', dateCreated: now, lastModified: now, assets: {},
        globalGridData: grid,
        scenes: [{
          id: 1, name: 'Main', gridData: {},
          objects: [
            { id: 1, name: 'hero', kind: 'sprite', posX: 10, posY: 500, width: 40, height: 40, color: '#ff0000' },
            { id: 2, name: 'goblin', kind: 'sprite', posX: 500, posY: 100, width: 40, height: 40, color: '#009900', tags: ['goblin'] },
            { id: 3, name: 'goblin2', kind: 'sprite', posX: 600, posY: 100, width: 40, height: 40, color: '#009900', tags: ['Goblin'] }
          ],
          worldWidth: 800, worldHeight: 600, viewportWidth: 800, viewportHeight: 600, bgColor: '#ffffff'
        }],
        currentSceneId: 1
      };
    }
    async function tagsPreview() {
      const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
      const pg = await ctx.newPage();
      const errs = [];
      pg.on('pageerror', e => errs.push(String(e && e.message || e)));
      await goto(pg, `http://localhost:${PORT}/home.html`, { waitUntil: 'domcontentloaded' });
      await pg.evaluate((seed) => {
        localStorage.setItem('hydraProjects', JSON.stringify([seed]));
        localStorage.setItem('currentProjectId', 'tags-game');
      }, tagsSeed());
      await goto(pg, `http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
      await pg.click('.tab[data-tab="preview-tab"]');
      await pg.waitForSelector('#game-canvas', { timeout: 10000 });
      await pg.waitForFunction(() => gameVariables.gLeft === 2, null, { timeout: 10000 });
      await pg.waitForTimeout(500);
      const vars = await pg.evaluate(() => ({
        gLeft: gameVariables.gLeft, taggedHero: gameVariables.taggedHero,
        allGone: gameVariables.allGone
      }));
      const out = { vars, errs };
      await ctx.close();
      return out;
    }
    const tagsRun = await tagsPreview();
    check('preview counts the two authored goblins (either case) and lands the runtime tag on the hero',
      tagsRun.vars.gLeft === 2 && tagsRun.vars.taggedHero === 1 && tagsRun.vars.allGone === undefined,
      JSON.stringify(tagsRun.vars));
    check('no page errors on the tags preview page', tagsRun.errs.length === 0,
      tagsRun.errs.slice(0, 3).join(' | '));

    // ---- P4 Advanced batch 35: pick objects by tag — the four new
    // Tags palette blocks in order, For Each Tagged Object under
    // Control Flow, placement + panels, and a live preview where the
    // nearest-tag pick damages only the nearest goblin, the farthest
    // still reads full health, and the for-each loop runs three rounds
    // and damages a coin ----
    const tagOrder10 = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const catIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'Tags');
      if (catIdx === -1) return 'no Tags label';
      const after = items.slice(catIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      return (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type')).filter(Boolean).join(',');
    });
    check('Tags palette now holds all ten blocks in order (picks after Tagged Count, hold-action last)',
      tagOrder10 === 'add-tag,remove-tag,clear-tags,read-tagged-count,has-tag,tagged-count,pick-nearest-tagged,pick-farthest-tagged,pick-random-tagged,pick-tagged-object-into-variable',
      tagOrder10);
    const flowOrder = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const catIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'Control Flow');
      if (catIdx === -1) return 'no Control Flow label';
      const after = items.slice(catIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      return (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type')).filter(Boolean).join(',');
    });
    check('Control Flow palette holds For Each Tagged Object after For Each Field',
      flowOrder === 'repeat-times,while-loop,break-loop,continue-loop,for-each-list,for-each-object,for-each-field,for-each-tagged,broadcast-event,on-custom-event',
      flowOrder);
    const pickNearBefore = await page.locator('#grid [data-block-type="pick-nearest-tagged"]').count();
    await page.click('.block-selector .block-option[data-block-type="pick-nearest-tagged"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="pick-nearest-tagged"]').length > n,
      pickNearBefore);
    const pickNearCell = page.locator('#grid [data-block-type="pick-nearest-tagged"]').first();
    check('Pick Nearest Tagged block places on the grid', await pickNearCell.count() === 1);
    await pickNearCell.click();
    await page.waitForTimeout(400);
    const pickNearPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Pick Nearest Tagged panel offers the Trigger, Tag, Near object, and Invert fields',
      /Trigger/i.test(pickNearPropText) && /Tag/i.test(pickNearPropText) &&
      /Near object/i.test(pickNearPropText) && /Invert/i.test(pickNearPropText),
      pickNearPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const pickIntoBefore = await page.locator('#grid [data-block-type="pick-tagged-object-into-variable"]').count();
    await page.click('.block-selector .block-option[data-block-type="pick-tagged-object-into-variable"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="pick-tagged-object-into-variable"]').length > n,
      pickIntoBefore);
    const pickIntoCell = page.locator('#grid [data-block-type="pick-tagged-object-into-variable"]').first();
    check('Pick Tagged Object Into Variable block places on the grid', await pickIntoCell.count() === 1);
    await pickIntoCell.click();
    await page.waitForTimeout(400);
    const pickIntoPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Pick Tagged Object Into Variable panel offers the Tag, Pick, Into variable, and Scope fields',
      /Tag/i.test(pickIntoPropText) && /Pick/i.test(pickIntoPropText) &&
      /Into variable/i.test(pickIntoPropText) && /Scope/i.test(pickIntoPropText),
      pickIntoPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const forEachTaggedBefore = await page.locator('#grid [data-block-type="for-each-tagged"]').count();
    await page.click('.block-selector .block-option[data-block-type="for-each-tagged"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="for-each-tagged"]').length > n,
      forEachTaggedBefore);
    const forEachTaggedCell = page.locator('#grid [data-block-type="for-each-tagged"]').first();
    check('For Each Tagged Object block places on the grid', await forEachTaggedCell.count() === 1);
    await forEachTaggedCell.click();
    await page.waitForTimeout(400);
    const forEachTaggedPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('For Each Tagged Object panel offers the Tag, Object variable, and Index variable fields',
      /Tag/i.test(forEachTaggedPropText) && /Object variable/i.test(forEachTaggedPropText) &&
      /Index variable/i.test(forEachTaggedPropText),
      forEachTaggedPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    // Live preview: one seeded page — the gameStart chain holds the
    // nearest goblin (x 500), the edge pick damages only it (its
    // health reads 20 while the farthest still reads 30), and the
    // for-each loop runs three rounds and damages a coin to 5.
    // (Damage to 0 health does not destroy an object, so the loop is
    // observed through its index and a health read, not a count of 0.
    // The pick row sits at column 10, not under the loop: the legacy
    // orthogonal-adjacent rule would let the pick re-fire the loop
    // above it, and the loop would run twice.)
    function pickTagSeed() {
      const now = new Date().toISOString();
      const grid = {
        0: { type: 'gameStart', kind: 'condition' },
        1: { type: 'pickTaggedObjectIntoVariable', kind: 'action', tag: 'goblin', pickMode: 'nearest', nearObject: 'hero', pointX: 0, pointY: 0, varName: 'target', scope: 'global', targetObject: '' },
        2: { type: 'readObjectProperty', kind: 'action', varName: 'target', scope: 'global', targetObject: '', property: 'x', storeVarName: 'targetX' },
        60: { type: 'forEachTagged', kind: 'action', tag: 'coin', objVar: '', indexVar: 'idx' },
        61: { type: 'damageObject', kind: 'action', targetObject: 'coin', amount: 5 },
        62: { type: 'setVariable', kind: 'action', varName: 'lastIdx', operation: 'set', value: 'idx' },
        130: { type: 'pickNearestTagged', kind: 'condition', tag: 'goblin', nearObject: 'hero', pointX: 0, pointY: 0, triggerMode: 'edge' },
        131: { type: 'damageObject', kind: 'action', targetObject: 'goblin', amount: 10 },
        720: { type: 'always', kind: 'condition' },
        721: { type: 'pickTaggedObjectIntoVariable', kind: 'action', tag: 'goblin', pickMode: 'nearest', nearObject: 'hero', pointX: 0, pointY: 0, varName: 'target', scope: 'global', targetObject: '' },
        722: { type: 'readObjectProperty', kind: 'action', varName: 'target', scope: 'global', targetObject: '', property: 'health', storeVarName: 'hurtHp' },
        780: { type: 'always', kind: 'condition' },
        781: { type: 'pickTaggedObjectIntoVariable', kind: 'action', tag: 'goblin', pickMode: 'farthest', nearObject: 'hero', pointX: 0, pointY: 0, varName: 'farTarget', scope: 'global', targetObject: '' },
        782: { type: 'readObjectProperty', kind: 'action', varName: 'farTarget', scope: 'global', targetObject: '', property: 'health', storeVarName: 'farHp' },
        840: { type: 'always', kind: 'condition' },
        841: { type: 'pickTaggedObjectIntoVariable', kind: 'action', tag: 'coin', pickMode: 'first', nearObject: '', pointX: 0, pointY: 0, varName: 'coinTarget', scope: 'global', targetObject: '' },
        842: { type: 'readObjectProperty', kind: 'action', varName: 'coinTarget', scope: 'global', targetObject: '', property: 'health', storeVarName: 'coinHp' }
      };
      return {
        id: 'pick-tag-game', name: 'Pick Tag Game', dateCreated: now, lastModified: now, assets: {},
        globalGridData: grid,
        scenes: [{
          id: 1, name: 'Main', gridData: {},
          objects: [
            { id: 1, name: 'hero', kind: 'sprite', posX: 100, posY: 100, width: 40, height: 40, color: '#ff0000', health: 100, maxHealth: 100 },
            { id: 2, name: 'goblin', kind: 'sprite', posX: 500, posY: 100, width: 40, height: 40, color: '#009900', health: 30, maxHealth: 30, tags: ['goblin'] },
            { id: 3, name: 'goblin', kind: 'sprite', posX: 600, posY: 100, width: 40, height: 40, color: '#009900', health: 30, maxHealth: 30, tags: ['Goblin'] },
            { id: 5, name: 'coin', kind: 'sprite', posX: 200, posY: 300, width: 40, height: 40, color: '#ffcc00', health: 10, maxHealth: 10, tags: ['coin'] },
            { id: 6, name: 'coin', kind: 'sprite', posX: 300, posY: 300, width: 40, height: 40, color: '#ffcc00', health: 10, maxHealth: 10, tags: ['coin'] },
            { id: 7, name: 'coin', kind: 'sprite', posX: 400, posY: 300, width: 40, height: 40, color: '#ffcc00', health: 10, maxHealth: 10, tags: ['coin'] }
          ],
          worldWidth: 800, worldHeight: 600, viewportWidth: 800, viewportHeight: 600, bgColor: '#ffffff'
        }],
        currentSceneId: 1
      };
    }
    async function pickTagPreview() {
      const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
      const pg = await ctx.newPage();
      const errs = [];
      pg.on('pageerror', e => errs.push(String(e && e.message || e)));
      await goto(pg, `http://localhost:${PORT}/home.html`, { waitUntil: 'domcontentloaded' });
      await pg.evaluate((seed) => {
        localStorage.setItem('hydraProjects', JSON.stringify([seed]));
        localStorage.setItem('currentProjectId', 'pick-tag-game');
      }, pickTagSeed());
      await goto(pg, `http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
      await pg.click('.tab[data-tab="preview-tab"]');
      await pg.waitForSelector('#game-canvas', { timeout: 10000 });
      await pg.waitForFunction(
        () => gameVariables.hurtHp === 20 && gameVariables.farHp === 30 &&
          gameVariables.lastIdx === 3 && gameVariables.coinHp === 5,
        null, { timeout: 10000 });
      await pg.waitForTimeout(500);
      const vars = await pg.evaluate(() => ({
        targetX: gameVariables.targetX, hurtHp: gameVariables.hurtHp,
        farHp: gameVariables.farHp, lastIdx: gameVariables.lastIdx,
        coinHp: gameVariables.coinHp
      }));
      const out = { vars, errs };
      await ctx.close();
      return out;
    }
    const pickTagRun = await pickTagPreview();
    check('preview holds the nearest goblin (x 500), damages only it (20 vs 30), and the loop runs 3 rounds and damages a coin to 5',
      pickTagRun.vars.targetX === 500 && pickTagRun.vars.hurtHp === 20 &&
      pickTagRun.vars.farHp === 30 && pickTagRun.vars.lastIdx === 3 &&
      pickTagRun.vars.coinHp === 5,
      JSON.stringify(pickTagRun.vars));
    check('no page errors on the pick-by-tag preview page', pickTagRun.errs.length === 0,
      pickTagRun.errs.slice(0, 3).join(' | '));

    // ---- P4 Advanced batch 36: minimap — module, palette blocks
    // under the Minimap category, placement + panels, the Scene
    // Settings Minimap section, and live previews where the map
    // paints its panel, the player dot white, the goblin dot in its
    // tag color, the coin gray, and a zoomed map follows the camera
    // with a smaller viewport rectangle ----
    const hydraMinimapLoaded = await page.evaluate(() =>
      typeof window.HydraMinimap !== 'undefined' &&
      typeof window.HydraMinimap.normalizeMinimapConfig === 'function' &&
      typeof window.HydraMinimap.createMinimapState === 'function' &&
      typeof window.HydraMinimap.isVisible === 'function' &&
      typeof window.HydraMinimap.setVisible === 'function' &&
      typeof window.HydraMinimap.setSize === 'function' &&
      typeof window.HydraMinimap.setZoom === 'function' &&
      typeof window.HydraMinimap.minimapRect === 'function' &&
      typeof window.HydraMinimap.worldWindow === 'function' &&
      typeof window.HydraMinimap.tagColor === 'function' &&
      typeof window.HydraMinimap.dotStyle === 'function' &&
      typeof window.HydraMinimap.drawMinimap === 'function' &&
      typeof window.HydraMinimap.isMinimapAction === 'function' &&
      typeof window.HydraMinimap.isMinimapCondition === 'function');
    check('HydraMinimap module is loaded in the editor', hydraMinimapLoaded);
    const minimapBlocks = await page.evaluate(() =>
      ['show-minimap', 'hide-minimap', 'set-minimap-size', 'set-minimap-zoom',
       'minimap-visible']
        .every(t => !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('All five minimap blocks are in the palette', minimapBlocks);
    const minimapCategory = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const catIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'Minimap');
      if (catIdx === -1) return 'no Minimap label';
      const after = items.slice(catIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      const inCat = (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type')).filter(Boolean);
      const want = ['show-minimap', 'hide-minimap', 'set-minimap-size', 'set-minimap-zoom',
        'minimap-visible'];
      return want.every(t => inCat.includes(t)) ? 'ok' :
        'missing under Minimap (Minimap holds ' + JSON.stringify(inCat) + ')';
    });
    check('All five minimap blocks sit under the Minimap palette category (not under a later heading)',
      minimapCategory === 'ok', minimapCategory);
    const minimapOrder = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const catIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'Minimap');
      const after = items.slice(catIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      return (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type'))
        .filter(t => ['show-minimap', 'hide-minimap', 'set-minimap-size', 'set-minimap-zoom',
          'minimap-visible'].includes(t))
        .join(',');
    });
    check('Minimap blocks sit in Show Minimap / Hide Minimap / Set Minimap Size / Set Minimap Zoom / Minimap Visible order in the palette',
      minimapOrder === 'show-minimap,hide-minimap,set-minimap-size,set-minimap-zoom,minimap-visible', minimapOrder);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('.block-selector .block-category-label')]
        .find(e => e.textContent.trim() === 'Minimap');
      if (el) el.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(300);
    const setSizeBefore = await page.locator('#grid [data-block-type="set-minimap-size"]').count();
    await page.click('.block-selector .block-option[data-block-type="set-minimap-size"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-minimap-size"]').length > n,
      setSizeBefore);
    const setSizeCell = page.locator('#grid [data-block-type="set-minimap-size"]').first();
    check('Set Minimap Size block places on the grid', await setSizeCell.count() === 1);
    await setSizeCell.click();
    await page.waitForTimeout(400);
    const setSizePropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Set Minimap Size panel offers the Size field',
      /Size/i.test(setSizePropText),
      setSizePropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const setZoomBefore = await page.locator('#grid [data-block-type="set-minimap-zoom"]').count();
    await page.click('.block-selector .block-option[data-block-type="set-minimap-zoom"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-minimap-zoom"]').length > n,
      setZoomBefore);
    const setZoomCell = page.locator('#grid [data-block-type="set-minimap-zoom"]').first();
    check('Set Minimap Zoom block places on the grid', await setZoomCell.count() === 1);
    await setZoomCell.click();
    await page.waitForTimeout(400);
    const setZoomPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Set Minimap Zoom panel offers the Zoom field',
      /Zoom/i.test(setZoomPropText),
      setZoomPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const mmVisibleBefore = await page.locator('#grid [data-block-type="minimap-visible"]').count();
    await page.click('.block-selector .block-option[data-block-type="minimap-visible"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="minimap-visible"]').length > n,
      mmVisibleBefore);
    const mmVisibleCell = page.locator('#grid [data-block-type="minimap-visible"]').first();
    check('Minimap Visible block places on the grid', await mmVisibleCell.count() === 1);
    await mmVisibleCell.click();
    await page.waitForTimeout(400);
    const mmVisiblePropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Minimap Visible panel offers the Trigger and Invert fields',
      /Trigger/i.test(mmVisiblePropText) && /Invert/i.test(mmVisiblePropText),
      mmVisiblePropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const showMmBefore = await page.locator('#grid [data-block-type="show-minimap"]').count();
    await page.click('.block-selector .block-option[data-block-type="show-minimap"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="show-minimap"]').length > n,
      showMmBefore);
    const showMmCell = page.locator('#grid [data-block-type="show-minimap"]').first();
    check('Show Minimap block places on the grid', await showMmCell.count() === 1);
    await showMmCell.click();
    await page.waitForTimeout(400);
    const showMmPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Show Minimap panel shows its note (no blank panel for a settings-free block)',
      /Shows the minimap for the current scene/i.test(showMmPropText),
      showMmPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const hideMmBefore = await page.locator('#grid [data-block-type="hide-minimap"]').count();
    await page.click('.block-selector .block-option[data-block-type="hide-minimap"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="hide-minimap"]').length > n,
      hideMmBefore);
    check('Hide Minimap block places on the grid',
      await page.locator('#grid [data-block-type="hide-minimap"]').count() === 1);
    await page.click('#back-to-blocks-btn');
    // Scene Settings Minimap section: the five fields write the
    // scene's minimap config and read it back. The inspector tabs
    // live in the Scene view, so switch there first.
    await page.click('.tab[data-tab="scene-tab"]');
    await page.click('.inspector-tab[data-inspector-tab="world"]');
    await page.waitForSelector('#scene-minimap-wrap', { timeout: 5000 });
    const mmWrapVisible = await page.evaluate(() => {
      const el = document.getElementById('scene-minimap-wrap');
      return !!el && el.style.display !== 'none';
    });
    check('Scene Settings Minimap section appears', mmWrapVisible);
    const mmFields = await page.evaluate(() => ({
      enabled: !!document.getElementById('scene-minimap-enabled'),
      corner: !!document.getElementById('scene-minimap-corner'),
      size: !!document.getElementById('scene-minimap-size'),
      zoom: !!document.getElementById('scene-minimap-zoom'),
      viewport: !!document.getElementById('scene-minimap-viewport')
    }));
    check('Scene Settings Minimap section offers the enabled, corner, size, zoom, and viewport fields',
      mmFields.enabled && mmFields.corner && mmFields.size && mmFields.zoom && mmFields.viewport,
      JSON.stringify(mmFields));
    await page.uncheck('#scene-minimap-enabled');
    await page.selectOption('#scene-minimap-corner', 'bottom-left');
    await page.fill('#scene-minimap-size', '240');
    await page.fill('#scene-minimap-zoom', '2');
    await page.uncheck('#scene-minimap-viewport');
    const mmWritten = await page.evaluate(() => window.getCurrentScene?.()?.minimap);
    check('Scene Settings Minimap fields write scene.minimap (disabled, bottom-left, 240, zoom 2, no viewport)',
      mmWritten && mmWritten.enabled === false && mmWritten.corner === 'bottom-left' &&
      mmWritten.size === 240 && mmWritten.zoom === 2 && mmWritten.showViewport === false,
      JSON.stringify(mmWritten));
    await page.check('#scene-minimap-enabled');
    await page.selectOption('#scene-minimap-corner', 'top-right');
    await page.fill('#scene-minimap-size', '160');
    await page.fill('#scene-minimap-zoom', '1');
    await page.check('#scene-minimap-viewport');
    const mmRestored = await page.evaluate(() => window.getCurrentScene?.()?.minimap);
    check('Scene Settings Minimap fields restore the defaults (enabled, top-right, 160, zoom 1, viewport on)',
      mmRestored && mmRestored.enabled === true && mmRestored.corner === 'top-right' &&
      mmRestored.size === 160 && mmRestored.zoom === 1 && mmRestored.showViewport === true,
      JSON.stringify(mmRestored));
    // Live preview: three seeded pages — the fit map (panel, white
    // player dot, tag-colored goblin dot, gray coin dot, gray rock
    // dot, Minimap Visible fires), the zoomed map (camera moved and
    // zoomed, the viewport rectangle shrinks to what the camera sees),
    // and the disabled map (no panel, the visible row stays quiet).
    function minimapSeed(minimap, objects, camX, camY, camZoom) {
      const now = new Date().toISOString();
      const grid = {
        0: { type: 'gameStart', kind: 'condition' },
        1: { type: 'setCameraZoom', kind: 'action', zoom: String(camZoom) },
        2: { type: 'setCamera', kind: 'action', cameraX: String(camX), cameraY: String(camY) },
        3: { type: 'setVariable', kind: 'action', varName: 'started', operation: 'set', value: '1' },
        720: { type: 'minimapVisible', kind: 'condition' },
        721: { type: 'setVariable', kind: 'action', varName: 'mapOn', operation: 'set', value: '1' }
      };
      return {
        id: 'minimap-game', name: 'Minimap Game', dateCreated: now, lastModified: now, assets: {},
        globalGridData: grid,
        scenes: [{
          id: 1, name: 'Main', gridData: {}, minimap: minimap,
          objects: objects,
          worldWidth: 800, worldHeight: 600, viewportWidth: 800, viewportHeight: 600, bgColor: '#ffffff'
        }],
        currentSceneId: 1
      };
    }
    async function minimapPreview(minimap, objects, camX, camY, camZoom) {
      const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
      const pg = await ctx.newPage();
      const errs = [];
      pg.on('pageerror', e => errs.push(String(e && e.message || e)));
      await goto(pg, `http://localhost:${PORT}/home.html`, { waitUntil: 'domcontentloaded' });
      await pg.evaluate((seed) => {
        localStorage.setItem('hydraProjects', JSON.stringify([seed]));
        localStorage.setItem('currentProjectId', 'minimap-game');
      }, minimapSeed(minimap, objects, camX, camY, camZoom));
      await goto(pg, `http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
      await pg.click('.tab[data-tab="preview-tab"]');
      await pg.waitForSelector('#game-canvas', { timeout: 10000 });
      await pg.waitForFunction(() => gameVariables.started === 1, null, { timeout: 10000 });
      await pg.waitForTimeout(500);
      const pxAt = (x, y) => pg.evaluate(([px, py]) => {
        const c = document.getElementById('game-canvas');
        const d = c.getContext('2d').getImageData(px, py, 1, 1).data;
        return [d[0], d[1], d[2], d[3]];
      }, [x, y]);
      const vars = await pg.evaluate(() => ({ mapOn: gameVariables.mapOn }));
      const out = { vars, errs,
        panel: await pxAt(700, 100),
        player: await pxAt(652, 44), goblin: await pxAt(732, 44),
        coin: await pxAt(750, 95), rock: await pxAt(712, 150),
        zoomPlayer: await pxAt(756, 156), zoomGoblin: await pxAt(716, 103),
        vpEdge: await pxAt(668, 90), vpInside: await pxAt(700, 90) };
      await ctx.close();
      return out;
    }
    const fitObjects = [
      { id: 1, name: 'hero', kind: 'sprite', posX: 100, posY: 100, width: 40, height: 40, color: '#ff0000', tags: ['player'] },
      { id: 2, name: 'goblin', kind: 'sprite', posX: 500, posY: 100, width: 40, height: 40, color: '#009900', tags: ['goblin'] },
      { id: 3, name: 'coin', kind: 'sprite', posX: 600, posY: 300, width: 20, height: 20, color: '#ffcc00', tags: ['coin'] },
      { id: 4, name: 'rock', kind: 'sprite', posX: 400, posY: 500, width: 40, height: 40, color: '#888888' }
    ];
    const mmFit = await minimapPreview({ enabled: true }, fitObjects, 0, 0, 1);
    check('preview shows the map when the scene enables it (Minimap Visible fires, mapOn === 1)',
      mmFit.vars.mapOn === 1, JSON.stringify(mmFit.vars));
    check('preview paints the minimap panel dark over the white background',
      mmFit.panel[0] >= 105 && mmFit.panel[0] <= 125 && mmFit.panel[1] >= 105 &&
      mmFit.panel[1] <= 125 && mmFit.panel[2] >= 105 && mmFit.panel[2] <= 125,
      JSON.stringify(mmFit.panel));
    check('preview paints the player dot white at the hero spot',
      mmFit.player[0] > 240 && mmFit.player[1] > 240 && mmFit.player[2] > 240,
      JSON.stringify(mmFit.player));
    check('preview paints the goblin dot in its tag color (greenish, hsl 168)',
      mmFit.goblin[0] >= 40 && mmFit.goblin[0] <= 80 && mmFit.goblin[1] >= 200 &&
      mmFit.goblin[1] <= 240 && mmFit.goblin[2] >= 170 && mmFit.goblin[2] <= 205,
      JSON.stringify(mmFit.goblin));
    check('preview paints the coin dot in its tag color (greenish, hsl 142)',
      mmFit.coin[0] >= 40 && mmFit.coin[0] <= 80 && mmFit.coin[1] >= 200 &&
      mmFit.coin[1] <= 240 && mmFit.coin[2] >= 100 && mmFit.coin[2] <= 140,
      JSON.stringify(mmFit.coin));
    check('preview paints the untagged rock dot gray',
      mmFit.rock[0] >= 145 && mmFit.rock[0] <= 167 && mmFit.rock[1] >= 152 &&
      mmFit.rock[1] <= 174 && mmFit.rock[2] >= 164 && mmFit.rock[2] <= 186,
      JSON.stringify(mmFit.rock));
    check('no page errors on the fit minimap page', mmFit.errs.length === 0,
      mmFit.errs.slice(0, 3).join(' | '));
    const zoomObjects = [
      { id: 1, name: 'hero', kind: 'sprite', posX: 500, posY: 400, width: 40, height: 40, color: '#ff0000', tags: ['player'] },
      { id: 2, name: 'goblin', kind: 'sprite', posX: 400, posY: 300, width: 40, height: 40, color: '#009900', tags: ['goblin'] }
    ];
    const mmZoom = await minimapPreview({ enabled: true, zoom: 2 }, zoomObjects, 300, 225, 4);
    check('preview zoomed map still fires the visible row (mapOn === 1)',
      mmZoom.vars.mapOn === 1, JSON.stringify(mmZoom.vars));
    check('preview zoomed map paints the player dot white at its zoomed spot',
      mmZoom.zoomPlayer[0] > 240 && mmZoom.zoomPlayer[1] > 240 && mmZoom.zoomPlayer[2] > 240,
      JSON.stringify(mmZoom.zoomPlayer));
    check('preview zoomed map paints the goblin dot in its tag color at its zoomed spot',
      mmZoom.zoomGoblin[0] >= 40 && mmZoom.zoomGoblin[0] <= 80 && mmZoom.zoomGoblin[1] >= 200 &&
      mmZoom.zoomGoblin[1] <= 240 && mmZoom.zoomGoblin[2] >= 170 && mmZoom.zoomGoblin[2] <= 205,
      JSON.stringify(mmZoom.zoomGoblin));
    check('preview zoomed map draws the viewport rectangle edge white where the camera view ends',
      mmZoom.vpEdge[0] > 240 && mmZoom.vpEdge[1] > 240 && mmZoom.vpEdge[2] > 240,
      JSON.stringify(mmZoom.vpEdge));
    check('preview zoomed map leaves the panel dark just inside the viewport edge',
      mmZoom.vpInside[0] >= 105 && mmZoom.vpInside[0] <= 125 && mmZoom.vpInside[1] >= 105 &&
      mmZoom.vpInside[1] <= 125 && mmZoom.vpInside[2] >= 105 && mmZoom.vpInside[2] <= 125,
      JSON.stringify(mmZoom.vpInside));
    check('no page errors on the zoomed minimap page', mmZoom.errs.length === 0,
      mmZoom.errs.slice(0, 3).join(' | '));
    const mmOff = await minimapPreview({ enabled: false }, fitObjects, 0, 0, 1);
    check('preview hides the map when the scene disables it (mapOn unset, panel spot stays white)',
      mmOff.vars.mapOn === undefined && mmOff.panel[0] > 240 && mmOff.panel[1] > 240 &&
      mmOff.panel[2] > 240,
      JSON.stringify({ vars: mmOff.vars, panel: mmOff.panel }));
    check('no page errors on the disabled minimap page', mmOff.errs.length === 0,
      mmOff.errs.slice(0, 3).join(' | '));
    // Back to the Logic tab, where the next section expects to be.
    await page.click('.tab[data-tab="script-tab"]');

    // ---- P4 Advanced batch 37: object parenting — module, palette blocks
    // under the Attach category, placement + panels, and live previews
    // where the hat and the sword ride on the hero to its new spot, and
    // a detached hat stays put while the hero moves ----
    const hydraAttachLoaded = await page.evaluate(() =>
      typeof window.HydraAttach !== 'undefined' &&
      typeof window.HydraAttach.createAttachState === 'function' &&
      typeof window.HydraAttach.attachCount === 'function' &&
      typeof window.HydraAttach.wouldCycle === 'function' &&
      typeof window.HydraAttach.attach === 'function' &&
      typeof window.HydraAttach.detach === 'function' &&
      typeof window.HydraAttach.setOffset === 'function' &&
      typeof window.HydraAttach.isAttached === 'function' &&
      typeof window.HydraAttach.attachmentOf === 'function' &&
      typeof window.HydraAttach.applyAttachments === 'function' &&
      typeof window.HydraAttach.isAttachAction === 'function' &&
      typeof window.HydraAttach.isAttachCondition === 'function');
    check('HydraAttach module is loaded in the editor', hydraAttachLoaded);
    const attachBlocks = await page.evaluate(() =>
      ['attach-object-to-object', 'detach-object', 'set-attachment-offset',
       'is-attached']
        .every(t => !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('All four attach blocks are in the palette', attachBlocks);
    const attachCategory = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const catIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'Attach');
      if (catIdx === -1) return 'no Attach label';
      const after = items.slice(catIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      const inCat = (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type')).filter(Boolean);
      const want = ['attach-object-to-object', 'detach-object', 'set-attachment-offset',
        'is-attached'];
      return want.every(t => inCat.includes(t)) ? 'ok' :
        'missing under Attach (Attach holds ' + JSON.stringify(inCat) + ')';
    });
    check('All four attach blocks sit under the Attach palette category (not under a later heading)',
      attachCategory === 'ok', attachCategory);
    const attachOrder = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const catIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'Attach');
      const after = items.slice(catIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      return (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type'))
        .filter(t => ['attach-object-to-object', 'detach-object', 'set-attachment-offset',
          'is-attached'].includes(t))
        .join(',');
    });
    check('Attach blocks sit in Attach Object To Object / Detach Object / Set Attachment Offset / Is Attached order in the palette',
      attachOrder === 'attach-object-to-object,detach-object,set-attachment-offset,is-attached', attachOrder);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('.block-selector .block-category-label')]
        .find(e => e.textContent.trim() === 'Attach');
      if (el) el.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(300);
    const attachBefore = await page.locator('#grid [data-block-type="attach-object-to-object"]').count();
    await page.click('.block-selector .block-option[data-block-type="attach-object-to-object"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="attach-object-to-object"]').length > n,
      attachBefore);
    const attachCell = page.locator('#grid [data-block-type="attach-object-to-object"]').first();
    check('Attach Object To Object block places on the grid', await attachCell.count() === 1);
    await attachCell.click();
    await page.waitForTimeout(400);
    const attachPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Attach Object To Object panel offers the Child, Parent, and Offset fields',
      /Child object/i.test(attachPropText) && /Parent object/i.test(attachPropText) &&
      /Offset X/i.test(attachPropText) && /Offset Y/i.test(attachPropText),
      attachPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const detachBefore = await page.locator('#grid [data-block-type="detach-object"]').count();
    await page.click('.block-selector .block-option[data-block-type="detach-object"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="detach-object"]').length > n,
      detachBefore);
    const detachCell = page.locator('#grid [data-block-type="detach-object"]').first();
    check('Detach Object block places on the grid', await detachCell.count() === 1);
    await detachCell.click();
    await page.waitForTimeout(400);
    const detachPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Detach Object panel offers the Object field',
      /Object/i.test(detachPropText),
      detachPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const setOffBefore = await page.locator('#grid [data-block-type="set-attachment-offset"]').count();
    await page.click('.block-selector .block-option[data-block-type="set-attachment-offset"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-attachment-offset"]').length > n,
      setOffBefore);
    const setOffCell = page.locator('#grid [data-block-type="set-attachment-offset"]').first();
    check('Set Attachment Offset block places on the grid', await setOffCell.count() === 1);
    await setOffCell.click();
    await page.waitForTimeout(400);
    const setOffPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Set Attachment Offset panel offers the Object and Offset fields',
      /Object/i.test(setOffPropText) && /Offset X/i.test(setOffPropText) &&
      /Offset Y/i.test(setOffPropText),
      setOffPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const isAttBefore = await page.locator('#grid [data-block-type="is-attached"]').count();
    await page.click('.block-selector .block-option[data-block-type="is-attached"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="is-attached"]').length > n,
      isAttBefore);
    const isAttCell = page.locator('#grid [data-block-type="is-attached"]').first();
    check('Is Attached block places on the grid', await isAttCell.count() === 1);
    await isAttCell.click();
    await page.waitForTimeout(400);
    const isAttPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Is Attached panel offers the Trigger, Object, Parent, and Invert fields',
      /Trigger/i.test(isAttPropText) && /Object/i.test(isAttPropText) &&
      /Parent object/i.test(isAttPropText) && /Invert/i.test(isAttPropText),
      isAttPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    // Icons, not text: every placed attach block draws its unique icon
    // in the cell (a text-label fallback overflows the 56px cell and
    // clips at the grid edge when the block sits in column 0). The
    // Is Attached icon carries a '?' badge, which is itself a <text>
    // element, so the check is that no text element holds the block's
    // own label — the fallback renders the full label as text.
    const attachIconFaces = await page.evaluate(() =>
      [['attach-object-to-object', 'Attach Obj'],
       ['detach-object', 'Detach Obj'],
       ['set-attachment-offset', 'Set Attach Offset'],
       ['is-attached', 'Attached?']].map(([t, label]) => {
        const cell = document.querySelector(`#grid [data-block-type="${t}"]`);
        if (!cell) return t + ':missing';
        const svg = cell.querySelector('svg');
        if (!svg) return t + ':no-svg';
        const texts = [...svg.querySelectorAll('text')].map(e => e.textContent);
        return texts.includes(label) ? t + ':text' : t + ':icon';
      }).join(','));
    check('All four placed attach blocks draw an icon, never a text label',
      attachIconFaces.split(',').every(s => s.endsWith(':icon')), attachIconFaces);
    // Live preview: two seeded pages — the follow (the hat and the
    // sword ride on the hero to its new spot, Is Attached fires) and
    // the detach (the hat stays at its authored spot while the hero
    // moves).
    function attachSeed(detach) {
      const now = new Date().toISOString();
      const grid = {
        0: { type: 'gameStart', kind: 'condition' },
        1: { type: 'attachObjectToObject', kind: 'action', childObject: 'hat', parentObject: 'hero', offsetX: '', offsetY: '' },
        2: { type: 'attachObjectToObject', kind: 'action', childObject: 'sword', parentObject: 'hero', offsetX: 40, offsetY: 0 },
        3: { type: 'setPosition', kind: 'action', targetObject: 'hero', toX: 300, toY: 200 },
        4: { type: 'setVariable', kind: 'action', varName: 'started', operation: 'set', value: '1' },
        720: { type: 'isAttached', kind: 'condition', targetObject: 'hat' },
        721: { type: 'setVariable', kind: 'action', varName: 'attachedFlag', operation: 'set', value: '1' },
        780: { type: 'isAttached', kind: 'condition', targetObject: 'sword', parentObject: 'hero' },
        781: { type: 'setVariable', kind: 'action', varName: 'swordFlag', operation: 'set', value: '1' }
      };
      if (detach) {
        grid[780] = { type: 'gameStart', kind: 'condition' };
        grid[781] = { type: 'detachObject', kind: 'action', targetObject: 'hat' };
        delete grid[720];
        delete grid[721];
      }
      return {
        id: 'attach-game', name: 'Attach Game', dateCreated: now, lastModified: now, assets: {},
        globalGridData: grid,
        scenes: [{
          id: 1, name: 'Main', gridData: {},
          objects: [
            { id: 1, name: 'hero', kind: 'sprite', posX: 100, posY: 100, width: 40, height: 40, color: '#ff0000' },
            { id: 2, name: 'hat', kind: 'sprite', posX: 110, posY: 80, width: 20, height: 20, color: '#8b5cf6' },
            { id: 3, name: 'sword', kind: 'sprite', posX: 140, posY: 100, width: 30, height: 10, color: '#94a3b8' }
          ],
          worldWidth: 800, worldHeight: 600, viewportWidth: 800, viewportHeight: 600, bgColor: '#ffffff'
        }],
        currentSceneId: 1
      };
    }
    async function attachPreview(detach) {
      const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
      const pg = await ctx.newPage();
      const errs = [];
      pg.on('pageerror', e => errs.push(String(e && e.message || e)));
      await goto(pg, `http://localhost:${PORT}/home.html`, { waitUntil: 'domcontentloaded' });
      await pg.evaluate((seed) => {
        localStorage.setItem('hydraProjects', JSON.stringify([seed]));
        localStorage.setItem('currentProjectId', 'attach-game');
      }, attachSeed(detach));
      await goto(pg, `http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
      await pg.click('.tab[data-tab="preview-tab"]');
      await pg.waitForSelector('#game-canvas', { timeout: 10000 });
      await pg.waitForFunction(() => gameVariables.started === 1, null, { timeout: 10000 });
      await pg.waitForTimeout(500);
      const pxAt = (x, y) => pg.evaluate(([px, py]) => {
        const c = document.getElementById('game-canvas');
        const d = c.getContext('2d').getImageData(px, py, 1, 1).data;
        return [d[0], d[1], d[2], d[3]];
      }, [x, y]);
      const vars = await pg.evaluate(() => ({
        attachedFlag: gameVariables.attachedFlag, swordFlag: gameVariables.swordFlag
      }));
      const out = { vars, errs,
        hero: await pxAt(320, 220), hat: await pxAt(320, 190), sword: await pxAt(355, 205),
        hatHome: await pxAt(120, 90) };
      await ctx.close();
      return out;
    }
    const atFollow = await attachPreview(false);
    check('preview attaches the children (Is Attached fires for hat and sword)',
      atFollow.vars.attachedFlag === 1 && atFollow.vars.swordFlag === 1,
      JSON.stringify(atFollow.vars));
    check('preview paints the hero red at its new spot (300, 200)',
      atFollow.hero[0] > 240 && atFollow.hero[1] < 15 && atFollow.hero[2] < 15,
      JSON.stringify(atFollow.hero));
    check('preview paints the hat purple riding above the hero (310, 180)',
      atFollow.hat[0] >= 129 && atFollow.hat[0] <= 149 && atFollow.hat[1] >= 82 &&
      atFollow.hat[1] <= 102 && atFollow.hat[2] >= 236 && atFollow.hat[2] <= 255,
      JSON.stringify(atFollow.hat));
    check('preview paints the sword gray riding beside the hero (340, 200)',
      atFollow.sword[0] >= 138 && atFollow.sword[0] <= 158 && atFollow.sword[1] >= 153 &&
      atFollow.sword[1] <= 173 && atFollow.sword[2] >= 174 && atFollow.sword[2] <= 194,
      JSON.stringify(atFollow.sword));
    check('no page errors on the attach follow page', atFollow.errs.length === 0,
      atFollow.errs.slice(0, 3).join(' | '));
    const atDetach = await attachPreview(true);
    check('preview detaches the hat (Is Attached stays quiet, both flags unset)',
      atDetach.vars.attachedFlag === undefined && atDetach.vars.swordFlag === undefined,
      JSON.stringify(atDetach.vars));
    check('preview paints the detached hat purple at its authored spot (110, 80)',
      atDetach.hatHome[0] >= 129 && atDetach.hatHome[0] <= 149 && atDetach.hatHome[1] >= 82 &&
      atDetach.hatHome[1] <= 102 && atDetach.hatHome[2] >= 236 && atDetach.hatHome[2] <= 255,
      JSON.stringify(atDetach.hatHome));
    check('preview paints the hero red at its new spot on the detach page too',
      atDetach.hero[0] > 240 && atDetach.hero[1] < 15 && atDetach.hero[2] < 15,
      JSON.stringify(atDetach.hero));
    check('no page errors on the attach detach page', atDetach.errs.length === 0,
      atDetach.errs.slice(0, 3).join(' | '));

    // ---- P5 core-engine track, item P5-1 (Variables v2, slice a):
    // scoped variables — module, palette blocks under the Variables
    // category, placement + panels ----
    const hydraVariablesLoaded = await page.evaluate(() =>
      typeof window.HydraVariables !== 'undefined' &&
      typeof window.HydraVariables.createVariablesState === 'function' &&
      typeof window.HydraVariables.normalizeScope === 'function' &&
      typeof window.HydraVariables.typeOfValue === 'function' &&
      typeof window.HydraVariables.set === 'function' &&
      typeof window.HydraVariables.get === 'function' &&
      typeof window.HydraVariables.read === 'function' &&
      typeof window.HydraVariables.has === 'function' &&
      typeof window.HydraVariables.remove === 'function' &&
      typeof window.HydraVariables.list === 'function' &&
      typeof window.HydraVariables.clearScene === 'function' &&
      typeof window.HydraVariables.clearScope === 'function' &&
      typeof window.HydraVariables.resetRun === 'function' &&
      typeof window.HydraVariables.isScopedVariableAction === 'function' &&
      typeof window.HydraVariables.isScopedVariableCondition === 'function');
    check('HydraVariables module is loaded in the editor', hydraVariablesLoaded);
    const scopedVarBlocks = await page.evaluate(() =>
      ['set-scoped-variable', 'read-scoped-variable', 'delete-scoped-variable',
       'clear-scoped-variables', 'scoped-variable-exists-condition',
       'scoped-variable-check-condition']
        .every(t => !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('All six scoped-variable blocks are in the palette', scopedVarBlocks);
    const scopedVarCategory = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const catIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'Variables');
      if (catIdx === -1) return 'no Variables label';
      const after = items.slice(catIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      const inCat = (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type')).filter(Boolean);
      const want = ['set-scoped-variable', 'read-scoped-variable', 'delete-scoped-variable',
        'clear-scoped-variables', 'scoped-variable-exists-condition', 'scoped-variable-check-condition'];
      return want.every(t => inCat.includes(t)) ? 'ok' :
        'missing under Variables (Variables holds ' + JSON.stringify(inCat) + ')';
    });
    check('All six scoped-variable blocks sit under the Variables palette category (not under a later heading)',
      scopedVarCategory === 'ok', scopedVarCategory);
    const scopedVarOrder = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const catIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'Variables');
      const after = items.slice(catIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      return (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type'))
        .filter(t => ['set-scoped-variable', 'read-scoped-variable', 'delete-scoped-variable',
          'clear-scoped-variables', 'scoped-variable-exists-condition',
          'scoped-variable-check-condition'].includes(t))
        .join(',');
    });
    check('Scoped-variable blocks sit in Set Scoped Variable / Read Scoped Variable / Delete Scoped Variable / Clear Scoped Variables / Scoped Variable Exists / Scoped Variable Check order in the palette',
      scopedVarOrder === 'set-scoped-variable,read-scoped-variable,delete-scoped-variable,clear-scoped-variables,scoped-variable-exists-condition,scoped-variable-check-condition', scopedVarOrder);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('.block-selector .block-category-label')]
        .find(e => e.textContent.trim() === 'Variables');
      if (el) el.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(300);
    const setScopedBefore = await page.locator('#grid [data-block-type="set-scoped-variable"]').count();
    await page.click('.block-selector .block-option[data-block-type="set-scoped-variable"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-scoped-variable"]').length > n,
      setScopedBefore);
    const setScopedCell = page.locator('#grid [data-block-type="set-scoped-variable"]').first();
    check('Set Scoped Variable block places on the grid', await setScopedCell.count() === 1);
    await setScopedCell.click();
    await page.waitForTimeout(400);
    const setScopedPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Set Scoped Variable panel offers the Scope, Object, Variable name, Value is, and Value fields',
      /Scope/i.test(setScopedPropText) && /Object/i.test(setScopedPropText) &&
      /Variable name/i.test(setScopedPropText) && /Value is/i.test(setScopedPropText) &&
      /Value/i.test(setScopedPropText),
      setScopedPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const readScopedBefore = await page.locator('#grid [data-block-type="read-scoped-variable"]').count();
    await page.click('.block-selector .block-option[data-block-type="read-scoped-variable"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="read-scoped-variable"]').length > n,
      readScopedBefore);
    const readScopedCell = page.locator('#grid [data-block-type="read-scoped-variable"]').first();
    check('Read Scoped Variable block places on the grid', await readScopedCell.count() === 1);
    await readScopedCell.click();
    await page.waitForTimeout(400);
    const readScopedPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Read Scoped Variable panel offers the Scope, Object, Variable name, and Into variable fields',
      /Scope/i.test(readScopedPropText) && /Object/i.test(readScopedPropText) &&
      /Variable name/i.test(readScopedPropText) && /Into variable/i.test(readScopedPropText),
      readScopedPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const scopedCheckBefore = await page.locator('#grid [data-block-type="scoped-variable-check-condition"]').count();
    await page.click('.block-selector .block-option[data-block-type="scoped-variable-check-condition"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="scoped-variable-check-condition"]').length > n,
      scopedCheckBefore);
    const scopedCheckCell = page.locator('#grid [data-block-type="scoped-variable-check-condition"]').first();
    check('Scoped Variable Check block places on the grid', await scopedCheckCell.count() === 1);
    await scopedCheckCell.click();
    await page.waitForTimeout(400);
    const scopedCheckPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Scoped Variable Check panel offers the Trigger, Scope, Object, Variable name, Compare, and Invert fields',
      /Trigger/i.test(scopedCheckPropText) && /Scope/i.test(scopedCheckPropText) &&
      /Object/i.test(scopedCheckPropText) && /Variable name/i.test(scopedCheckPropText) &&
      /Compare/i.test(scopedCheckPropText) && /Invert/i.test(scopedCheckPropText),
      scopedCheckPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');

    // ---- P5 core-engine track, item P5-1 (Variables v2, slice b):
    // the Variables manager — tab, add form, create / rename /
    // edit-value / delete through the live UI, on the current
    // project (which starts with no definitions). The section cleans
    // up after itself: the variable it adds is deleted again, so
    // later sections see the same empty definition list.
    await page.click('.tab[data-tab="scene-tab"]');
    await page.click('.inspector-tab[data-inspector-tab="variables"]');
    await page.waitForTimeout(500);
    const variablesPanelText = await page.evaluate(() =>
      document.getElementById('variables-panel')?.parentElement?.innerText || '');
    check('Variables tab shows its hint and the three scope groups',
      /scoped variables this game starts with/i.test(variablesPanelText) &&
      /Global — whole game/i.test(variablesPanelText) &&
      /Scene —/i.test(variablesPanelText) &&
      /Object — per object name/i.test(variablesPanelText),
      variablesPanelText.slice(0, 400));
    const variablesEmpty = await page.evaluate(() => {
      const panel = document.getElementById('variables-panel');
      return {
        addForm: !!document.getElementById('var-add-name') &&
          !!document.getElementById('var-add-scope') &&
          !!document.getElementById('var-add-type') &&
          !!document.getElementById('var-add-value') &&
          !!document.getElementById('var-add-btn'),
        emptyNotes: [...panel.querySelectorAll('.hint-text')].map(e => e.textContent.trim())
      };
    });
    check('Variables tab offers the add form (name, scope, type, value, Add)',
      variablesEmpty.addForm, JSON.stringify(variablesEmpty));
    check('Variables tab shows the empty-group notes with no definitions yet',
      variablesEmpty.emptyNotes.some(t => /No global variables yet/i.test(t)) &&
      variablesEmpty.emptyNotes.some(t => /No scene variables yet/i.test(t)) &&
      variablesEmpty.emptyNotes.some(t => /No object variables yet/i.test(t)),
      JSON.stringify(variablesEmpty.emptyNotes));
    // Add a global number variable through the form.
    await page.evaluate(() => {
      document.querySelector('#variables-panel details').open = true;
    });
    await page.fill('#var-add-name', 'lives');
    await page.selectOption('#var-add-scope', 'global');
    await page.selectOption('#var-add-type', 'number');
    await page.fill('#var-add-value', '3');
    await page.click('#var-add-btn');
    await page.waitForTimeout(400);
    const addedVar = await page.evaluate(() => {
      const project = window.projectManager?.getCurrentProject?.();
      const row = [...document.querySelectorAll('#variables-panel .var-row')]
        .find(r => r.textContent.includes('lives'));
      return {
        defs: project ? project.scopedVariables : null,
        rowText: row ? row.textContent.replace(/\s+/g, ' ').trim() : null,
        value: row ? row.querySelector('.var-value')?.value : null
      };
    });
    check('adding a variable in the Variables tab creates the definition (global lives = 3)',
      Array.isArray(addedVar.defs) && addedVar.defs.length === 1 &&
      addedVar.defs[0].name === 'lives' && addedVar.defs[0].scope === 'global' &&
      addedVar.defs[0].type === 'number' && addedVar.defs[0].value === 3,
      JSON.stringify(addedVar));
    check('the added variable shows as a row with its name, type, and starting value',
      !!addedVar.rowText && /lives/.test(addedVar.rowText) &&
      /number/i.test(addedVar.rowText) && addedVar.value === '3',
      JSON.stringify(addedVar));
    // A duplicate name in the same scope is refused with an error line.
    await page.evaluate(() => {
      document.querySelector('#variables-panel details').open = true;
    });
    await page.fill('#var-add-name', 'lives');
    await page.click('#var-add-btn');
    await page.waitForTimeout(300);
    const dupError = await page.evaluate(() => ({
      error: document.getElementById('var-add-error')?.textContent || '',
      defs: window.projectManager?.getCurrentProject?.().scopedVariables?.length
    }));
    check('adding a duplicate name in the same scope is refused',
      /already exists/i.test(dupError.error) && dupError.defs === 1,
      JSON.stringify(dupError));
    // Rename through the name button. The page carries a persistent
    // dialog handler (registered early for the Clear Grid confirm)
    // that accepts every dialog, so a real prompt would be answered
    // empty before this section's handler could run — stub
    // window.prompt to return the new name instead. The click, the
    // rename logic, and the re-render are all still exercised for real.
    await page.evaluate(() => { window.prompt = () => 'energy'; });
    await page.click('#variables-panel .var-row .var-name');
    await page.waitForTimeout(400);
    await page.evaluate(() => { delete window.prompt; });
    const renamedVar = await page.evaluate(() => ({
      defs: window.projectManager?.getCurrentProject?.().scopedVariables,
      rowText: [...document.querySelectorAll('#variables-panel .var-row')]
        .map(r => r.textContent.replace(/\s+/g, ' ').trim())
    }));
    check('renaming a variable through its name updates the definition',
      Array.isArray(renamedVar.defs) && renamedVar.defs.length === 1 &&
      renamedVar.defs[0].name === 'energy' &&
      renamedVar.rowText.some(t => /energy/.test(t)) &&
      !renamedVar.rowText.some(t => /lives/.test(t)),
      JSON.stringify(renamedVar));
    // Edit the starting value in the row.
    const energyRow = page.locator('#variables-panel .var-row', { hasText: 'energy' });
    await energyRow.locator('.var-value').fill('5');
    await energyRow.locator('.var-value').blur();
    await page.waitForTimeout(300);
    const editedVar = await page.evaluate(() =>
      window.projectManager?.getCurrentProject?.().scopedVariables);
    check('editing a starting value in the row updates the definition',
      Array.isArray(editedVar) && editedVar.length === 1 && editedVar[0].value === 5,
      JSON.stringify(editedVar));
    // Delete through the row's × button.
    await energyRow.locator('.icon-btn', { hasText: '×' }).click();
    await page.waitForTimeout(400);
    const afterDelete = await page.evaluate(() => ({
      defs: window.projectManager?.getCurrentProject?.().scopedVariables,
      rows: document.querySelectorAll('#variables-panel .var-row').length
    }));
    check('deleting a variable through its row removes the definition',
      Array.isArray(afterDelete.defs) && afterDelete.defs.length === 0 && afterDelete.rows === 0,
      JSON.stringify(afterDelete));
    // Object scope through the same form: the dropdown is the shared
    // object-select builder (every named object in every scene). If
    // this project has one, adding an object variable records its
    // object name; if it has none, the form refuses with an error.
    await page.evaluate(() => {
      document.querySelector('#variables-panel details').open = true;
    });
    await page.fill('#var-add-name', 'targetHp');
    await page.selectOption('#var-add-scope', 'object');
    await page.waitForTimeout(300);
    const objectOptions = await page.evaluate(() =>
      [...document.querySelectorAll('#var-add-object option')].map(o => o.value));
    const firstObject = (objectOptions || []).find(v => v);
    if (firstObject) {
      await page.selectOption('#var-add-object', firstObject);
      await page.fill('#var-add-value', '40');
      await page.click('#var-add-btn');
      await page.waitForTimeout(400);
      const addedObjectVar = await page.evaluate(() =>
        window.projectManager?.getCurrentProject?.().scopedVariables);
      check('adding an object variable records its scope and object name',
        Array.isArray(addedObjectVar) && addedObjectVar.length === 1 &&
        addedObjectVar[0].name === 'targetHp' && addedObjectVar[0].scope === 'object' &&
        addedObjectVar[0].objectName === firstObject && addedObjectVar[0].value === 40,
        JSON.stringify(addedObjectVar));
      await page.locator('#variables-panel .var-row', { hasText: 'targetHp' })
        .locator('.icon-btn', { hasText: '×' }).click();
      await page.waitForTimeout(300);
      const objectCleaned = await page.evaluate(() =>
        window.projectManager?.getCurrentProject?.().scopedVariables);
      check('the object variable deletes cleanly afterwards',
        Array.isArray(objectCleaned) && objectCleaned.length === 0,
        JSON.stringify(objectCleaned));
    } else {
      await page.click('#var-add-btn');
      await page.waitForTimeout(300);
      const objectRefused = await page.evaluate(() => ({
        error: document.getElementById('var-add-error')?.textContent || '',
        defs: window.projectManager?.getCurrentProject?.().scopedVariables?.length
      }));
      check('an object variable with no object to pick is refused',
        /Pick an object/i.test(objectRefused.error) && objectRefused.defs === 0,
        JSON.stringify(objectRefused));
    }
    // The Preview tab carries the live readout: clicking the tab
    // starts the preview, so once the 500 ms tick fires the readout
    // shows the live empty state (this project has no definitions
    // left — the section deleted the only one). Wait for that state
    // instead of asserting the stopped hint, which is a tick-phase
    // coin flip right after the launch.
    await page.click('.tab[data-tab="preview-tab"]');
    await page.waitForSelector('#game-canvas', { timeout: 10000 });
    await page.waitForFunction(
      () => (document.getElementById('preview-variables')?.textContent || '')
        .includes('No variables yet'),
      null, { timeout: 5000 });
    const previewVars = await page.evaluate(() => ({
      panel: !!document.getElementById('preview-variables-panel'),
      toggle: !!document.getElementById('preview-variables-toggle'),
      count: document.getElementById('preview-variables-count')?.textContent,
      bodyText: document.getElementById('preview-variables')?.textContent || ''
    }));
    check('Preview tab shows the Live variables readout (running, no definitions: the live empty state)',
      previewVars.panel && previewVars.toggle && previewVars.count === '0' &&
      /No variables yet/i.test(previewVars.bodyText),
      JSON.stringify(previewVars));
    // Drive the toggle through the DOM: the handler is what this
    // checks (a hit-test click is layout-sensitive here — the
    // preview device frame from earlier sections can leave the
    // button covered — while the visual QA already covers the real
    // click on the demo project).
    await page.evaluate(() => document.getElementById('preview-variables-toggle').click());
    await page.waitForTimeout(300);
    const previewVarsOpen = await page.evaluate(() => ({
      hidden: document.getElementById('preview-variables')?.hidden,
      visible: !!document.getElementById('preview-variables')?.offsetParent
    }));
    check('the Live variables readout opens on its toggle',
      previewVarsOpen.hidden === false && previewVarsOpen.visible,
      JSON.stringify(previewVarsOpen));
    // Leave the editor on the Scene tab (the tab switch also stops
    // the preview). The next section clicks its own tab; there is no
    // back-to-blocks button to press from the Preview tab — it only
    // shows while a block's property panel is open in the script tab.
    await page.click('.tab[data-tab="scene-tab"]');

    // ---- P5 core-engine track, item P5-3 (Functions / custom
    // blocks, slice a): the Functions module, the two palette
    // blocks with working panels, and the Functions manager —
    // add / duplicate-refused / rename (which rewrites Call
    // Function blocks naming it) / Edit body scope tab / delete.
    // The section cleans up after itself: the function it adds is
    // deleted again, so later sections see the same empty function
    // list. The two blocks it places stay on the grid (later
    // sections place their own blocks the same way).
    await page.click('.tab[data-tab="script-tab"]');
    const hydraFunctionsLoaded = await page.evaluate(() =>
      typeof window.HydraFunctions !== 'undefined' &&
      typeof window.HydraFunctions.normalizeFunction === 'function' &&
      typeof window.HydraFunctions.mintFunctionId === 'function' &&
      typeof window.HydraFunctions.findFunction === 'function' &&
      typeof window.HydraFunctions.createCallState === 'function' &&
      typeof window.HydraFunctions.call === 'function' &&
      typeof window.HydraFunctions.returnFrom === 'function' &&
      typeof window.HydraFunctions.endCall === 'function' &&
      typeof window.HydraFunctions.scopeKeyFor === 'function' &&
      window.HydraFunctions.MAX_DEPTH === 32 &&
      window.HydraFunctions.MAX_PARAMS === 8);
    check('HydraFunctions module is loaded in the editor', hydraFunctionsLoaded);
    const fnBlocks = await page.evaluate(() =>
      ['call-function', 'return-from-function']
        .every(t => !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('Both function blocks are in the palette', fnBlocks);
    const fnCategory = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const catIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'Functions');
      if (catIdx === -1) return 'no Functions label';
      const after = items.slice(catIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      const inCat = (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type')).filter(Boolean);
      return inCat.join(',') === 'call-function,return-from-function' ? 'ok' :
        'Functions holds ' + JSON.stringify(inCat);
    });
    check('Both function blocks sit under the Functions palette category, Call then Return',
      fnCategory === 'ok', fnCategory);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('.block-selector .block-category-label')]
        .find(e => e.textContent.trim() === 'Functions');
      if (el) el.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(300);
    const callFnBefore = await page.locator('#grid [data-block-type="call-function"]').count();
    await page.click('.block-selector .block-option[data-block-type="call-function"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="call-function"]').length > n,
      callFnBefore);
    const callFnCell = page.locator('#grid [data-block-type="call-function"]').first();
    check('Call Function block places on the grid', await callFnCell.count() === 1);
    await callFnCell.click();
    await page.waitForTimeout(400);
    const callFnPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Call Function panel with no function picked offers the Function picker, the pick-first hint, and Into variable (no argument fields yet)',
      /Function/i.test(callFnPropText) && /Pick a function first/i.test(callFnPropText) &&
      /Into variable/i.test(callFnPropText) && !/Argument 1/i.test(callFnPropText),
      callFnPropText.slice(0, 300));
    const callFnPickerEmpty = await page.evaluate(() =>
      [...document.querySelectorAll('#properties-panel select')].map(s => s.value));
    check('Call Function picker shows the no-functions-yet option with no functions defined',
      callFnPickerEmpty.length === 1 && callFnPickerEmpty[0] === '', JSON.stringify(callFnPickerEmpty));
    await page.click('#back-to-blocks-btn');
    const returnBefore = await page.locator('#grid [data-block-type="return-from-function"]').count();
    await page.click('.block-selector .block-option[data-block-type="return-from-function"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="return-from-function"]').length > n,
      returnBefore);
    const returnCell = page.locator('#grid [data-block-type="return-from-function"]').first();
    check('Return From Function block places on the grid', await returnCell.count() === 1);
    await returnCell.click();
    await page.waitForTimeout(400);
    const returnPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Return From Function panel offers the Value to return field',
      /Value to return/i.test(returnPropText), returnPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');

    // ---- the Functions manager — tab, add form, create / rename /
    // edit body / delete through the live UI, on the current
    // project (which starts with no functions).
    await page.click('.tab[data-tab="scene-tab"]');
    await page.click('.inspector-tab[data-inspector-tab="functions"]');
    await page.waitForTimeout(500);
    const functionsPanelText = await page.evaluate(() =>
      document.getElementById('functions-panel')?.parentElement?.innerText || '');
    check('Functions tab shows its hint and the empty note',
      /Reusable block chains/i.test(functionsPanelText) &&
      /No functions yet/i.test(functionsPanelText),
      functionsPanelText.slice(0, 400));
    const functionsEmpty = await page.evaluate(() => ({
      addForm: !!document.getElementById('fn-add-name') &&
        !!document.getElementById('fn-add-params') &&
        !!document.getElementById('fn-add-btn')
    }));
    check('Functions tab offers the add form (name, parameters, Add)',
      functionsEmpty.addForm, JSON.stringify(functionsEmpty));
    // Add a function through the form.
    await page.evaluate(() => {
      document.querySelector('#functions-panel details').open = true;
    });
    await page.fill('#fn-add-name', 'add');
    await page.fill('#fn-add-params', 'a, b');
    await page.click('#fn-add-btn');
    await page.waitForTimeout(400);
    const addedFn = await page.evaluate(() => {
      const project = window.projectManager?.getCurrentProject?.();
      const row = [...document.querySelectorAll('#functions-panel .var-row')]
        .find(r => r.textContent.includes('add'));
      return {
        fns: project ? project.functions : null,
        rowText: row ? row.textContent.replace(/\s+/g, ' ').trim() : null
      };
    });
    check('adding a function in the Functions tab creates the definition (add with a, b)',
      Array.isArray(addedFn.fns) && addedFn.fns.length === 1 &&
      addedFn.fns[0].name === 'add' &&
      JSON.stringify(addedFn.fns[0].params) === JSON.stringify(['a', 'b']) &&
      addedFn.fns[0].grid && typeof addedFn.fns[0].grid === 'object',
      JSON.stringify(addedFn));
    check('the added function shows as a row with its name and parameter badge',
      !!addedFn.rowText && /add/.test(addedFn.rowText) && /\(a, b\)/.test(addedFn.rowText),
      JSON.stringify(addedFn));
    // Slice c: the row says the function is not called yet — no Call
    // Function block names it (the placed call still has a blank
    // name at this point).
    check('the added function row says it is not called yet',
      !!addedFn.rowText && /Not called yet/.test(addedFn.rowText),
      JSON.stringify(addedFn));
    // A duplicate name is refused with an error line.
    await page.evaluate(() => {
      document.querySelector('#functions-panel details').open = true;
    });
    await page.fill('#fn-add-name', 'add');
    await page.click('#fn-add-btn');
    await page.waitForTimeout(300);
    const fnDupError = await page.evaluate(() => ({
      error: document.getElementById('fn-add-error')?.textContent || '',
      fns: window.projectManager?.getCurrentProject?.().functions?.length
    }));
    check('adding a duplicate function name is refused',
      /already exists/i.test(fnDupError.error) && fnDupError.fns === 1,
      JSON.stringify(fnDupError));
    // Point the placed Call Function block at the new function.
    await page.click('.tab[data-tab="script-tab"]');
    await callFnCell.click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Function")) select').selectOption('add');
    await page.waitForTimeout(300);
    // P5-3 slice b: picking the function rebuilds the panel into one
    // argument field per parameter, labeled with the parameter name.
    const dynamicArgs = await page.evaluate(() => {
      const panel = document.getElementById('properties-panel');
      return {
        labels: [...panel.querySelectorAll('.property-group label')].map(l => l.textContent.trim()),
        text: panel.innerText || ''
      };
    });
    check('Call Function panel shows one argument field per parameter, labeled a and b',
      dynamicArgs.labels.includes('a') && dynamicArgs.labels.includes('b') &&
      !dynamicArgs.labels.some(l => /^Argument \d/.test(l)) &&
      !/Argument 3/.test(dynamicArgs.text),
      JSON.stringify(dynamicArgs));
    // Typing into the labeled fields writes arg1/arg2 on the block,
    // and the values survive a panel rebuild (re-select the cell).
    await page.locator('.property-group:has(label:text-is("a")) input').fill('3');
    await page.locator('.property-group:has(label:text-is("b")) input').fill('4');
    await page.click('#back-to-blocks-btn');
    await callFnCell.click();
    await page.waitForTimeout(400);
    const argValues = {
      a: await page.locator('.property-group:has(label:text-is("a")) input').inputValue(),
      b: await page.locator('.property-group:has(label:text-is("b")) input').inputValue()
    };
    check('argument values typed into the labeled fields persist on the block',
      argValues.a === '3' && argValues.b === '4', JSON.stringify(argValues));
    await page.click('#back-to-blocks-btn');
    // Rename through the name button (same prompt stub as the
    // Variables section: the persistent dialog handler would answer
    // a real prompt empty before this section's handler could run).
    await page.click('.tab[data-tab="scene-tab"]');
    await page.click('.inspector-tab[data-inspector-tab="functions"]');
    await page.waitForTimeout(400);
    await page.evaluate(() => { window.prompt = () => 'sum'; });
    await page.click('#functions-panel .var-row .var-name');
    await page.waitForTimeout(400);
    await page.evaluate(() => { delete window.prompt; });
    const renamedFn = await page.evaluate(() => ({
      fns: window.projectManager?.getCurrentProject?.().functions,
      names: [...document.querySelectorAll('#functions-panel .var-row .var-name')]
        .map(b => b.textContent.trim()),
      rowText: [...document.querySelectorAll('#functions-panel .var-row')]
        .map(r => r.textContent.replace(/\s+/g, ' ').trim())
    }));
    check('renaming a function through its name updates the definition',
      Array.isArray(renamedFn.fns) && renamedFn.fns.length === 1 &&
      renamedFn.fns[0].name === 'sum' &&
      JSON.stringify(renamedFn.names) === JSON.stringify(['sum']) &&
      renamedFn.rowText.some(t => /sum\(a, b\)/.test(t)),
      JSON.stringify(renamedFn));
    // Slice c: the row now says the function is called once — the
    // Call Function block was pointed at it before the rename, and
    // the rename rewrote the call to the new name.
    check('the renamed function row says it is called once',
      renamedFn.rowText.some(t => /Called once/.test(t)),
      JSON.stringify(renamedFn));
    // The rename rewrote the Call Function block that named it.
    await page.click('.tab[data-tab="script-tab"]');
    await callFnCell.click();
    await page.waitForTimeout(400);
    const renamedCallPicker = await page.evaluate(() =>
      [...document.querySelectorAll('#properties-panel select')].map(s => s.value));
    check('renaming a function rewrites the Call Function block that named it',
      renamedCallPicker.length === 1 && renamedCallPicker[0] === 'sum',
      JSON.stringify(renamedCallPicker));
    await page.click('#back-to-blocks-btn');
    // Slice c: Duplicate copies the function — same parameters, a
    // copy of the body — under 'sum copy', with its own scope tab.
    // Deleting the copy again leaves the project as it was.
    await page.click('.tab[data-tab="scene-tab"]');
    await page.click('.inspector-tab[data-inspector-tab="functions"]');
    await page.waitForTimeout(400);
    await page.click('#functions-panel .var-row [aria-label="Duplicate function sum"]');
    await page.waitForTimeout(400);
    const duplicatedFn = await page.evaluate(() => ({
      fns: window.projectManager?.getCurrentProject?.().functions,
      names: [...document.querySelectorAll('#functions-panel .var-row .var-name')]
        .map(b => b.textContent.trim()),
      scopeTabs: [...document.querySelectorAll('.scope-tab')].map(t => t.textContent.trim())
    }));
    check('duplicating a function adds a copy with the same parameters and its own scope tab',
      Array.isArray(duplicatedFn.fns) && duplicatedFn.fns.length === 2 &&
      duplicatedFn.fns[1].name === 'sum copy' &&
      JSON.stringify(duplicatedFn.fns[1].params) === JSON.stringify(['a', 'b']) &&
      duplicatedFn.fns[1].id !== duplicatedFn.fns[0].id &&
      JSON.stringify(duplicatedFn.names) === JSON.stringify(['sum', 'sum copy']) &&
      duplicatedFn.scopeTabs.some(t => t === 'ƒ sum copy'),
      JSON.stringify(duplicatedFn));
    await page.click('#functions-panel .var-row [aria-label="Delete function sum copy"]');
    await page.waitForTimeout(400);
    const afterCopyDelete = await page.evaluate(() => ({
      fns: window.projectManager?.getCurrentProject?.().functions,
      names: [...document.querySelectorAll('#functions-panel .var-row .var-name')]
        .map(b => b.textContent.trim())
    }));
    check('deleting the duplicated copy leaves the original alone',
      Array.isArray(afterCopyDelete.fns) && afterCopyDelete.fns.length === 1 &&
      afterCopyDelete.fns[0].name === 'sum' &&
      JSON.stringify(afterCopyDelete.names) === JSON.stringify(['sum']),
      JSON.stringify(afterCopyDelete));
    // Edit body opens the function scope tab.
    await page.click('.tab[data-tab="scene-tab"]');
    await page.click('.inspector-tab[data-inspector-tab="functions"]');
    await page.waitForTimeout(400);
    await page.click('#functions-panel .var-row [aria-label="Edit body of function sum"]');
    await page.waitForTimeout(500);
    const fnScopeTab = await page.evaluate(() => {
      const tabs = [...document.querySelectorAll('.scope-tab')];
      const active = tabs.find(t => t.classList.contains('active'));
      return {
        hasFnTab: tabs.some(t => t.textContent.trim() === 'ƒ sum'),
        activeText: active ? active.textContent.trim() : null,
        info: document.getElementById('scope-info')?.textContent || ''
      };
    });
    check('Edit body opens the function scope tab (ƒ sum, active) with its scope note',
      fnScopeTab.hasFnTab && fnScopeTab.activeText === 'ƒ sum' &&
      /Function body: sum/.test(fnScopeTab.info),
      JSON.stringify(fnScopeTab));
    // Back to the global grid, then delete the function (the Call
    // Function block still names it, so the confirm fires — the
    // persistent dialog handler accepts it).
    await page.evaluate(() => {
      const tab = [...document.querySelectorAll('.scope-tab')]
        .find(t => t.textContent.trim() === 'Global');
      if (tab) tab.click();
    });
    await page.waitForTimeout(400);
    await page.click('.tab[data-tab="scene-tab"]');
    await page.click('.inspector-tab[data-inspector-tab="functions"]');
    await page.waitForTimeout(400);
    await page.click('#functions-panel .var-row [aria-label="Delete function sum"]');
    await page.waitForTimeout(400);
    const afterFnDelete = await page.evaluate(() => ({
      fns: window.projectManager?.getCurrentProject?.().functions,
      rows: document.querySelectorAll('#functions-panel .var-row').length,
      scopeTabs: [...document.querySelectorAll('.scope-tab')].map(t => t.textContent.trim())
    }));
    check('deleting a function through its row removes the definition and its scope tab',
      Array.isArray(afterFnDelete.fns) && afterFnDelete.fns.length === 0 &&
      afterFnDelete.rows === 0 &&
      !afterFnDelete.scopeTabs.some(t => t.includes('sum')),
      JSON.stringify(afterFnDelete));
    // Slice c: a duplicate parameter in the add form is reported,
    // not trimmed silently — 'tri' keeps x and y, and the panel
    // says it dropped the second x.
    await page.evaluate(() => {
      document.querySelector('#functions-panel details').open = true;
    });
    await page.fill('#fn-add-name', 'tri');
    await page.fill('#fn-add-params', 'x, x, y');
    await page.click('#fn-add-btn');
    await page.waitForTimeout(400);
    const droppedParam = await page.evaluate(() => ({
      fns: window.projectManager?.getCurrentProject?.().functions,
      note: document.getElementById('fn-params-note')?.textContent || ''
    }));
    check('adding a function with a duplicate parameter keeps the unique names and reports the drop',
      Array.isArray(droppedParam.fns) && droppedParam.fns.length === 1 &&
      JSON.stringify(droppedParam.fns[0].params) === JSON.stringify(['x', 'y']) &&
      droppedParam.note === 'Kept x, y. Dropped duplicate "x".',
      JSON.stringify(droppedParam));
    // The same report fires when the row's own parameter input drops
    // a duplicate — here the note updates and the input shows the
    // kept list.
    await page.evaluate(() => {
      const input = document.querySelector('#functions-panel .var-row .var-value');
      input.value = 'p, p, q';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(400);
    const rowParamDrop = await page.evaluate(() => ({
      fns: window.projectManager?.getCurrentProject?.().functions,
      note: document.getElementById('fn-params-note')?.textContent || '',
      inputValue: document.querySelector('#functions-panel .var-row .var-value')?.value || ''
    }));
    check('editing the row parameters reports the dropped duplicate and keeps p, q',
      Array.isArray(rowParamDrop.fns) && rowParamDrop.fns.length === 1 &&
      JSON.stringify(rowParamDrop.fns[0].params) === JSON.stringify(['p', 'q']) &&
      rowParamDrop.note === 'Kept p, q. Dropped duplicate "p".' &&
      rowParamDrop.inputValue === 'p, q',
      JSON.stringify(rowParamDrop));
    // Leave the project with no functions again, as the section found it.
    await page.click('#functions-panel .var-row [aria-label="Delete function tri"]');
    await page.waitForTimeout(400);
    // Leave the editor on the Scene tab.
    await page.click('.tab[data-tab="scene-tab"]');

    // ---- P5 core-engine track, item P5-4 (Control flow + events,
    // slice a): the Loops module, the four palette blocks with
    // working panels, and a live loop in the preview — gameStart
    // -> Repeat 3 (counter loopProbeI) -> Set Variable loopProbe
    // add loopProbeI -> Set Scoped Variable loopProbeLive copies
    // loopProbe, which sums 1 + 2 + 3 to 6. The chain sits on a
    // free row found first, and the While / Break / Continue blocks
    // sit untriggered on a second free row, so later sections see
    // the same grid plus one loop chain.
    await page.click('.tab[data-tab="script-tab"]');
    await page.waitForSelector('.block-selector .block-option[data-block-type="repeat-times"]:visible', { timeout: 5000 });
    const loopsModule = await page.evaluate(() => {
      const L = window.HydraLoops;
      if (!L) return null;
      return ['isLoopBlock', 'isLoopAction', 'compare', 'normalizeCount',
        'createLoopState', 'resetLoopBudget', 'requestBreak',
        'requestContinue', 'beginLoop', 'endLoop', 'consumeBudget']
        .every(f => typeof L[f] === 'function') && L.MAX_REPEAT === 1000 &&
        L.MAX_WHILE_ITERATIONS === 1000 && L.MAX_LOOP_DEPTH === 8 &&
        L.MAX_LOOP_ACTIONS_PER_FRAME === 10000 &&
        L.isLoopBlock('repeatTimes') === true &&
        L.isLoopBlock('whileLoop') === true &&
        L.isLoopBlock('breakLoop') === false;
    });
    check('HydraLoops module is loaded with the loop surface and caps',
      loopsModule === true, JSON.stringify(loopsModule));
    const loopPalette = await page.evaluate(() => {
      const options = [...document.querySelectorAll('.block-option')];
      const labels = [...document.querySelectorAll('.block-category-label')]
        .map(el => el.textContent.trim());
      const flow = options.filter(o => o.dataset.category === 'Control Flow');
      return {
        labels,
        flow: flow.map(o => o.dataset.blockType),
        flowLabels: flow.map(o => o.querySelector('.block-label')?.textContent?.trim() || '')
      };
    });
    check('Control Flow palette category holds Repeat, While, Break, Continue, For Each Item, For Each Object, For Each Field, For Each Tagged Object, Broadcast Event, On Event in order',
      loopPalette.labels.includes('Control Flow') &&
      JSON.stringify(loopPalette.flow) === JSON.stringify(['repeat-times', 'while-loop', 'break-loop', 'continue-loop', 'for-each-list', 'for-each-object', 'for-each-field', 'for-each-tagged', 'broadcast-event', 'on-custom-event']) &&
      JSON.stringify(loopPalette.flowLabels) === JSON.stringify(['Repeat', 'While', 'Break', 'Continue', 'For Each Item', 'For Each Object', 'For Each Field', 'For Each Tagged Object', 'Broadcast Event', 'On Event']),
      JSON.stringify(loopPalette));
    // Find two free rows on the global grid: one for the live chain
    // (gameStart, Repeat, Set Variable, Set Scoped Variable), one
    // for the untriggered While / Break / Continue panels. The panel
    // row sits at least two rows below the chain row, so the While
    // is never orthogonally adjacent to the gameStart and never
    // fires through the legacy adjacency.
    const loopRows = await page.evaluate(() => {
      const taken = new Set([...document.querySelectorAll('#grid [data-block-type]')]
        .map(el => parseInt(el.dataset.index, 10)));
      const freeRow = (startRow) => {
        for (let row = startRow; row < 60; row++) {
          let ok = true;
          for (let c = 0; c < 4; c++) if (taken.has(row * 60 + c)) { ok = false; break; }
          if (ok) return row * 60;
        }
        return -1;
      };
      const chain = freeRow(0);
      const panel = chain === -1 ? -1 : freeRow(Math.floor(chain / 60) + 2);
      return [chain, panel];
    });
    check('two free rows exist on the global grid for the loop chain and panels',
      loopRows.length === 2 && loopRows[0] !== -1 && loopRows[1] !== -1, JSON.stringify(loopRows));
    const loopChainStart = loopRows[0];
    const loopPanelStart = loopRows[1];
    async function placeLoopBlock(blockType, cellIndex) {
      const before = await page.locator(`#grid [data-block-type="${blockType}"]`).count();
      // Placing a block opens its property panel, which hides the
      // palette — go back to the palette first, and scroll the
      // option into view (Control Flow sits below the fold).
      if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
        await page.click('#back-to-blocks-btn');
        await page.waitForTimeout(300);
      }
      await page.evaluate((t) => {
        document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)
          ?.scrollIntoView({ block: 'center' });
      }, blockType);
      await page.click(`.block-selector .block-option[data-block-type="${blockType}"]`);
      await page.locator(`#grid [data-index="${cellIndex}"]`).click();
      await page.waitForFunction(
        ([t, n]) => document.querySelectorAll(`#grid [data-block-type="${t}"]`).length > n,
        [blockType, before], { timeout: 5000 });
      check(`${blockType} places on the grid at cell ${cellIndex}`,
        (await page.locator(`#grid [data-block-type="${blockType}"]`).count()) > before);
    }
    await placeLoopBlock('game-start', loopChainStart);
    await placeLoopBlock('repeat-times', loopChainStart + 1);
    await placeLoopBlock('set-variable', loopChainStart + 2);
    await placeLoopBlock('set-scoped-variable', loopChainStart + 3);
    // The Repeat panel: Times expression plus the optional counter.
    await page.locator(`#grid [data-index="${loopChainStart + 1}"]`).click();
    await page.waitForTimeout(400);
    const repeatPanel = await page.evaluate(() => ({
      text: document.getElementById('properties-content')?.textContent || ''
    }));
    check('Repeat panel shows Times and Counter variable fields',
      /Times/.test(repeatPanel.text) && /Counter variable \(optional\)/.test(repeatPanel.text),
      repeatPanel.text.slice(0, 400));
    await page.locator('.property-group:has(label:text-is("Times")) .expr-input').fill('3');
    await page.locator('.property-group:has(label:text-is("Counter variable (optional)")) input').fill('loopProbeI');
    // The Set Variable panel: loopProbe add loopProbeI each round.
    await page.locator(`#grid [data-index="${loopChainStart + 2}"]`).click();
    await page.waitForTimeout(400);
    const setVarPanel = await page.evaluate(() => ({
      text: document.getElementById('properties-content')?.textContent || ''
    }));
    check('Set Variable panel shows Variable, Operation and Value fields',
      /Variable:/.test(setVarPanel.text) && /Operation:/.test(setVarPanel.text) && /Value:/.test(setVarPanel.text),
      setVarPanel.text.slice(0, 400));
    await page.locator('.property-group:has(label:text-is("Variable:")) input').fill('loopProbe');
    await page.locator('.property-group:has(label:text-is("Operation:")) select').selectOption('add');
    await page.locator('.property-group:has(label:text-is("Value:")) .expr-input').fill('loopProbeI');
    // The Set Scoped Variable panel: copy the flat sum into a scoped
    // variable the Live variables readout shows.
    await page.locator(`#grid [data-index="${loopChainStart + 3}"]`).click();
    await page.waitForTimeout(400);
    const setScopedPanel = await page.evaluate(() => ({
      text: document.getElementById('properties-content')?.textContent || ''
    }));
    check('Set Scoped Variable panel shows Scope, Variable name and Value fields',
      /Scope/.test(setScopedPanel.text) && /Variable name/.test(setScopedPanel.text) && /Value/.test(setScopedPanel.text),
      setScopedPanel.text.slice(0, 400));
    await page.locator('.property-group:has(label:text-is("Variable name")) input').fill('loopProbeLive');
    await page.locator('.property-group:has(label:text-is("Value")) .expr-input').fill('loopProbe');
    // The While panel, on the second free row: Left value, Compare,
    // Right value. It stays untriggered, so it never runs.
    await placeLoopBlock('while-loop', loopPanelStart);
    await placeLoopBlock('break-loop', loopPanelStart + 1);
    await placeLoopBlock('continue-loop', loopPanelStart + 2);
    await page.locator(`#grid [data-index="${loopPanelStart}"]`).click();
    await page.waitForTimeout(400);
    const whilePanel = await page.evaluate(() => ({
      text: document.getElementById('properties-content')?.textContent || ''
    }));
    check('While panel shows Left value, Compare and Right value fields',
      /Left value/.test(whilePanel.text) && /Compare/.test(whilePanel.text) && /Right value/.test(whilePanel.text),
      whilePanel.text.slice(0, 400));
    await page.locator('.property-group:has(label:text-is("Left value")) .expr-input').fill('loopProbe');
    await page.locator('.property-group:has(label:text-is("Compare")) select').selectOption('<');
    await page.locator('.property-group:has(label:text-is("Right value")) .expr-input').fill('10');
    // Break and Continue have no fields, just their note.
    await page.locator(`#grid [data-index="${loopPanelStart + 1}"]`).click();
    await page.waitForTimeout(400);
    const breakPanel = await page.evaluate(() => document.getElementById('properties-content')?.textContent || '');
    check('Break panel shows the stops-the-innermost note and no fields',
      /Stops the innermost Repeat or While loop at once/.test(breakPanel), breakPanel.slice(0, 300));
    await page.locator(`#grid [data-index="${loopPanelStart + 2}"]`).click();
    await page.waitForTimeout(400);
    const continuePanel = await page.evaluate(() => document.getElementById('properties-content')?.textContent || '');
    check('Continue panel shows the skips-the-rest note and no fields',
      /Skips the rest of this time round/.test(continuePanel), continuePanel.slice(0, 300));
    // Run the preview: the loop sums 1 + 2 + 3, and the scoped copy
    // reads 6 in the Live variables readout.
    await page.click('.tab[data-tab="preview-tab"]');
    await page.waitForSelector('#game-canvas', { timeout: 10000 });
    await page.waitForFunction(() => {
      const rows = [...document.querySelectorAll('#preview-variables .preview-var-row')];
      const row = rows.find(r => r.querySelector('.var-name')?.textContent === 'loopProbeLive');
      const val = row?.querySelector('[data-preview-var-key]')?.textContent;
      return val === '6';
    }, null, { timeout: 10000 });
    const loopLive = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#preview-variables .preview-var-row')];
      const row = rows.find(r => r.querySelector('.var-name')?.textContent === 'loopProbeLive');
      return row ? row.textContent : '';
    });
    check('preview runs the loop: 1 + 2 + 3 reaches 6 in the Live variables readout',
      /loopProbeLive/.test(loopLive) && /Global/.test(loopLive) && loopLive.trim().endsWith('6'),
      loopLive);
    // Leave the editor on the Scene tab (the tab switch also stops
    // the preview).
    await page.click('.tab[data-tab="scene-tab"]');

    // ---- P5 core-engine track, item P5-4 (Control flow + events,
    // slice b): For Each Item over a list and For Each Object over
    // live objects. The list row seeds a list with three pushes,
    // then For Each Item sums it (10 + 20 + 30 is 60). The spawn
    // row clones the coin twice, then For Each Object runs once per
    // coin (3 runs) and destroys each one. Both results reach the
    // Live variables readout through Set Scoped Variable, the cycle-8
    // pattern. The rows sit below the loop panel row, so no gameStart
    // sits orthogonally adjacent to another chain's actions.
    await page.click('.tab[data-tab="script-tab"]');
    await page.waitForSelector('.block-selector .block-option[data-block-type="for-each-list"]:visible', { timeout: 5000 });
    const forEachPalette = await page.evaluate(() => {
      const options = [...document.querySelectorAll('.block-option')];
      const flow = options.filter(o => o.dataset.category === 'Control Flow');
      return {
        flow: flow.map(o => o.dataset.blockType),
        flowLabels: flow.map(o => o.querySelector('.block-label')?.textContent?.trim() || '')
      };
    });
    check('Control Flow palette category holds all eight loop blocks plus the two event blocks in order',
      JSON.stringify(forEachPalette.flow) === JSON.stringify(['repeat-times', 'while-loop', 'break-loop', 'continue-loop', 'for-each-list', 'for-each-object', 'for-each-field', 'for-each-tagged', 'broadcast-event', 'on-custom-event']) &&
      JSON.stringify(forEachPalette.flowLabels) === JSON.stringify(['Repeat', 'While', 'Break', 'Continue', 'For Each Item', 'For Each Object', 'For Each Field', 'For Each Tagged Object', 'Broadcast Event', 'On Event']),
      JSON.stringify(forEachPalette));
    const feRows = await page.evaluate((panelStart) => {
      const taken = new Set([...document.querySelectorAll('#grid [data-block-type]')]
        .map(el => parseInt(el.dataset.index, 10)));
      const freeRow = (startRow, width) => {
        for (let row = startRow; row < 60; row++) {
          let ok = true;
          for (let c = 0; c < width; c++) if (taken.has(row * 60 + c)) { ok = false; break; }
          if (ok) return row * 60;
        }
        return -1;
      };
      const startRow = Math.floor(panelStart / 60) + 2;
      const list = freeRow(startRow, 7);
      const spawn = list === -1 ? -1 : freeRow(Math.floor(list / 60) + 1, 3);
      const obj = spawn === -1 ? -1 : freeRow(Math.floor(spawn / 60) + 1, 5);
      return [list, spawn, obj];
    }, loopPanelStart);
    check('three free rows exist for the for-each chains',
      feRows.length === 3 && feRows.every(r => r !== -1), JSON.stringify(feRows));
    const feListStart = feRows[0];
    const feSpawnStart = feRows[1];
    const feObjStart = feRows[2];
    await placeLoopBlock('game-start', feListStart);
    await placeLoopBlock('array-push', feListStart + 1);
    await placeLoopBlock('array-push', feListStart + 2);
    await placeLoopBlock('array-push', feListStart + 3);
    await placeLoopBlock('for-each-list', feListStart + 4);
    await placeLoopBlock('set-variable', feListStart + 5);
    await placeLoopBlock('set-scoped-variable', feListStart + 6);
    // The three pushes seed the list with 10, 20, 30.
    const fePushValues = ['10', '20', '30'];
    for (let p = 0; p < 3; p++) {
      await page.locator(`#grid [data-index="${feListStart + 1 + p}"]`).click();
      await page.waitForTimeout(400);
      await page.locator('.property-group:has(label:text-is("List variable")) input').fill('feDeck');
      await page.locator('.property-group:has(label:text-is("Value is")) select').selectOption('number');
      await page.locator('.property-group:has(label:text-is("Value")) .expr-input').fill(fePushValues[p]);
    }
    const fePushPanel = await page.evaluate(() => ({
      text: document.getElementById('properties-content')?.textContent || ''
    }));
    check('Push To Array panel shows List variable, Value is and Value fields',
      /List variable/.test(fePushPanel.text) && /Value is/.test(fePushPanel.text) && /Value/.test(fePushPanel.text),
      fePushPanel.text.slice(0, 400));
    // The For Each Item panel: list, item, and index variables.
    await page.locator(`#grid [data-index="${feListStart + 4}"]`).click();
    await page.waitForTimeout(400);
    const feListPanel = await page.evaluate(() => ({
      text: document.getElementById('properties-content')?.textContent || ''
    }));
    check('For Each Item panel shows List, Item and Index variable fields',
      /List variable/.test(feListPanel.text) && /Item variable/.test(feListPanel.text) &&
      /Index variable \(optional\)/.test(feListPanel.text),
      feListPanel.text.slice(0, 400));
    await page.locator('.property-group:has(label:text-is("List variable")) input').fill('feDeck');
    await page.locator('.property-group:has(label:text-is("Item variable")) input').fill('feCard');
    await page.locator('.property-group:has(label:text-is("Index variable (optional)")) input').fill('feN');
    // The sum body: feTotal add feCard, then copy it into a scoped variable.
    await page.locator(`#grid [data-index="${feListStart + 5}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Variable:")) input').fill('feTotal');
    await page.locator('.property-group:has(label:text-is("Operation:")) select').selectOption('add');
    await page.locator('.property-group:has(label:text-is("Value:")) .expr-input').fill('feCard');
    await page.locator(`#grid [data-index="${feListStart + 6}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Variable name")) input').fill('feListLive');
    await page.locator('.property-group:has(label:text-is("Value")) .expr-input').fill('feTotal');
    // The spawn row: gameStart -> Repeat 2 -> Spawn Object coin.
    await placeLoopBlock('game-start', feSpawnStart);
    await placeLoopBlock('repeat-times', feSpawnStart + 1);
    await placeLoopBlock('spawn-object', feSpawnStart + 2);
    await page.locator(`#grid [data-index="${feSpawnStart + 1}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Times")) .expr-input').fill('2');
    await page.locator(`#grid [data-index="${feSpawnStart + 2}"]`).click();
    await page.waitForTimeout(400);
    const spawnPanel = await page.evaluate(() => ({
      text: document.getElementById('properties-content')?.textContent || ''
    }));
    check('Spawn Object panel shows Object, X and Y fields',
      /Object:/.test(spawnPanel.text) && /X:/.test(spawnPanel.text) && /Y:/.test(spawnPanel.text),
      spawnPanel.text.slice(0, 400));
    await page.locator('.property-group:has(label:text-is("Object:")) select').selectOption('coin');
    // The object row: gameStart -> For Each Object coin -> count, destroy, copy.
    await placeLoopBlock('game-start', feObjStart);
    await placeLoopBlock('for-each-object', feObjStart + 1);
    await placeLoopBlock('set-variable', feObjStart + 2);
    await placeLoopBlock('destroy-object', feObjStart + 3);
    await placeLoopBlock('set-scoped-variable', feObjStart + 4);
    await page.locator(`#grid [data-index="${feObjStart + 1}"]`).click();
    await page.waitForTimeout(400);
    const feObjPanel = await page.evaluate(() => ({
      text: document.getElementById('properties-content')?.textContent || ''
    }));
    check('For Each Object panel shows Object and Index variable fields',
      /Object/.test(feObjPanel.text) && /Index variable \(optional\)/.test(feObjPanel.text),
      feObjPanel.text.slice(0, 400));
    await page.locator('.property-group:has(label:text-is("Object")) select').selectOption('coin');
    await page.locator('.property-group:has(label:text-is("Index variable (optional)")) input').fill('feObjN');
    await page.locator(`#grid [data-index="${feObjStart + 2}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Variable:")) input').fill('feObjCount');
    await page.locator('.property-group:has(label:text-is("Operation:")) select').selectOption('add');
    await page.locator('.property-group:has(label:text-is("Value:")) .expr-input').fill('1');
    await page.locator(`#grid [data-index="${feObjStart + 3}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Object:")) select').selectOption('coin');
    await page.locator(`#grid [data-index="${feObjStart + 4}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Variable name")) input').fill('feObjLive');
    await page.locator('.property-group:has(label:text-is("Value")) .expr-input').fill('feObjCount');
    // Run the preview: the list sums 10 + 20 + 30, and the object
    // loop runs once per coin (the original plus two spawns).
    await page.click('.tab[data-tab="preview-tab"]');
    await page.waitForSelector('#game-canvas', { timeout: 10000 });
    await page.waitForFunction(() => {
      const rows = [...document.querySelectorAll('#preview-variables .preview-var-row')];
      const read = (name) => {
        const row = rows.find(r => r.querySelector('.var-name')?.textContent === name);
        return row?.querySelector('[data-preview-var-key]')?.textContent;
      };
      return read('feListLive') === '60' && read('feObjLive') === '3';
    }, null, { timeout: 10000 });
    const feLive = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#preview-variables .preview-var-row')];
      const read = (name) => {
        const row = rows.find(r => r.querySelector('.var-name')?.textContent === name);
        return row ? row.textContent : '';
      };
      return { list: read('feListLive'), obj: read('feObjLive') };
    });
    check('preview runs the for-each loops: list sums to 60, object loop runs 3 times',
      /feListLive/.test(feLive.list) && feLive.list.trim().endsWith('60') &&
      /feObjLive/.test(feLive.obj) && feLive.obj.trim().endsWith('3'),
      JSON.stringify(feLive));
    // Leave the editor on the Scene tab (the tab switch also stops
    // the preview).
    await page.click('.tab[data-tab="scene-tab"]');

    // ---- P5 core-engine track, item P5-4 (Control flow + events,
    // slice c): custom events. The broadcast row sends 'evGoal' once
    // at game start; the listener row below it hears it in the same
    // frame (the listener sits after the broadcaster in the grid
    // walk) and counts once. The heartbeat rows broadcast 'evTick'
    // every frame from an always chain, and the listener counts every
    // frame — the level trigger plus the per-broadcast poll, so a
    // broadcast every frame is a tick every frame, not one tick.
    // Both results reach the Live variables readout through Set
    // Scoped Variable, the cycle-8 pattern. The rows sit below the
    // for-each object row with one empty row between, so no gameStart
    // sits orthogonally adjacent to another chain's actions.
    await page.click('.tab[data-tab="script-tab"]');
    await page.waitForSelector('.block-selector .block-option[data-block-type="broadcast-event"]:visible', { timeout: 5000 });
    const evRows = await page.evaluate((objStart) => {
      const taken = new Set([...document.querySelectorAll('#grid [data-block-type]')]
        .map(el => parseInt(el.dataset.index, 10)));
      const freeRow = (startRow, width) => {
        for (let row = startRow; row < 60; row++) {
          let ok = true;
          for (let c = 0; c < width; c++) if (taken.has(row * 60 + c)) { ok = false; break; }
          if (ok) return row * 60;
        }
        return -1;
      };
      const startRow = Math.floor(objStart / 60) + 2;
      const send = freeRow(startRow, 2);
      const listen = send === -1 ? -1 : freeRow(Math.floor(send / 60) + 1, 3);
      const tickSend = listen === -1 ? -1 : freeRow(Math.floor(listen / 60) + 1, 2);
      const tickListen = tickSend === -1 ? -1 : freeRow(Math.floor(tickSend / 60) + 1, 3);
      return [send, listen, tickSend, tickListen];
    }, feObjStart);
    check('four free rows exist for the custom-event chains',
      evRows.length === 4 && evRows.every(r => r !== -1), JSON.stringify(evRows));
    const evSendStart = evRows[0];
    const evListenStart = evRows[1];
    const evTickSendStart = evRows[2];
    const evTickListenStart = evRows[3];
    await placeLoopBlock('game-start', evSendStart);
    await placeLoopBlock('broadcast-event', evSendStart + 1);
    await placeLoopBlock('on-custom-event', evListenStart);
    await placeLoopBlock('set-variable', evListenStart + 1);
    await placeLoopBlock('set-scoped-variable', evListenStart + 2);
    await placeLoopBlock('always-condition', evTickSendStart);
    await placeLoopBlock('broadcast-event', evTickSendStart + 1);
    await placeLoopBlock('on-custom-event', evTickListenStart);
    await placeLoopBlock('set-variable', evTickListenStart + 1);
    await placeLoopBlock('set-scoped-variable', evTickListenStart + 2);
    // The Broadcast Event panel: one Event name field.
    await page.locator(`#grid [data-index="${evSendStart + 1}"]`).click();
    await page.waitForTimeout(400);
    const broadcastPanel = await page.evaluate(() => ({
      text: document.getElementById('properties-content')?.textContent || ''
    }));
    check('Broadcast Event panel shows the Event name field',
      /Event name/.test(broadcastPanel.text), broadcastPanel.text.slice(0, 300));
    await page.locator('.property-group:has(label:text-is("Event name")) input').fill('evGoal');
    // The On Event panel: one Event name field.
    await page.locator(`#grid [data-index="${evListenStart}"]`).click();
    await page.waitForTimeout(400);
    const onEventPanel = await page.evaluate(() => ({
      text: document.getElementById('properties-content')?.textContent || ''
    }));
    check('On Event panel shows the Event name field',
      /Event name/.test(onEventPanel.text), onEventPanel.text.slice(0, 300));
    await page.locator('.property-group:has(label:text-is("Event name")) input').fill('evGoal');
    await page.locator(`#grid [data-index="${evListenStart + 1}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Variable:")) input').fill('evHits');
    await page.locator('.property-group:has(label:text-is("Operation:")) select').selectOption('add');
    await page.locator('.property-group:has(label:text-is("Value:")) .expr-input').fill('1');
    await page.locator(`#grid [data-index="${evListenStart + 2}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Variable name")) input').fill('evLive');
    await page.locator('.property-group:has(label:text-is("Value")) .expr-input').fill('evHits');
    // The heartbeat rows: always broadcasts 'evTick', the listener
    // counts every frame.
    await page.locator(`#grid [data-index="${evTickSendStart + 1}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Event name")) input').fill('evTick');
    await page.locator(`#grid [data-index="${evTickListenStart}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Event name")) input').fill('evTick');
    await page.locator(`#grid [data-index="${evTickListenStart + 1}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Variable:")) input').fill('evTicks');
    await page.locator('.property-group:has(label:text-is("Operation:")) select').selectOption('add');
    await page.locator('.property-group:has(label:text-is("Value:")) .expr-input').fill('1');
    await page.locator(`#grid [data-index="${evTickListenStart + 2}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Variable name")) input').fill('evTickLive');
    await page.locator('.property-group:has(label:text-is("Value")) .expr-input').fill('evTicks');
    // Run the preview: the one-shot listener counts exactly once,
    // and the heartbeat listener reaches at least 3 ticks.
    await page.click('.tab[data-tab="preview-tab"]');
    await page.waitForSelector('#game-canvas', { timeout: 10000 });
    await page.waitForFunction(() => {
      const rows = [...document.querySelectorAll('#preview-variables .preview-var-row')];
      const read = (name) => {
        const row = rows.find(r => r.querySelector('.var-name')?.textContent === name);
        return row?.querySelector('[data-preview-var-key]')?.textContent;
      };
      return read('evLive') === '1' && Number(read('evTickLive')) >= 3;
    }, null, { timeout: 10000 });
    const evLive = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#preview-variables .preview-var-row')];
      const read = (name) => {
        const row = rows.find(r => r.querySelector('.var-name')?.textContent === name);
        return row ? row.textContent : '';
      };
      return { goal: read('evLive'), tick: read('evTickLive') };
    });
    check('preview runs the custom events: one-shot listener counts once, heartbeat ticks at least 3 times',
      /evLive/.test(evLive.goal) && evLive.goal.trim().endsWith('1') &&
      /evTickLive/.test(evLive.tick) &&
      Number((evLive.tick.match(/(\d+)\s*$/) || [])[1] || 0) >= 3,
      JSON.stringify(evLive));
    // Leave the editor on the Scene tab (the tab switch also stops
    // the preview).
    await page.click('.tab[data-tab="scene-tab"]');

    // ---- P5 core-engine track, item P5-5 (Object primitives,
    // slice a): object references as values. The chain picks the
    // nearest hazard to the player into 'orTarget', reads its X
    // (610) into 'orX', damages it 25 (100 -> 75), reads its health
    // and liveness, and copies all three into scoped variables the
    // Live variables readout shows. The hazard is the target because
    // it sits still at (610,120): the collector's coins are spawned
    // and destroyed by the for-each section above, so their count
    // and positions are not stable. The row sits below the event
    // rows with one empty row between, so no gameStart sits
    // orthogonally adjacent to another chain's actions.
    await page.click('.tab[data-tab="script-tab"]');
    await page.waitForSelector('.block-selector .block-option[data-block-type="pick-object-into-variable"]:visible', { timeout: 5000 });
    const orPalette = await page.evaluate(() => {
      const options = [...document.querySelectorAll('.block-option')];
      const vars = options.filter(o => o.dataset.category === 'Variables');
      return {
        vars: vars.map(o => o.dataset.blockType),
        varLabels: vars.map(o => o.querySelector('.block-label')?.textContent?.trim() || '')
      };
    });
    check('Variables palette category holds the two object-reference blocks after Scoped Variable Check',
      (() => {
        const at = orPalette.vars.indexOf('scoped-variable-check-condition');
        return at !== -1 &&
          orPalette.vars[at + 1] === 'pick-object-into-variable' &&
          orPalette.vars[at + 2] === 'read-object-property' &&
          orPalette.varLabels[at + 1] === 'Pick Object Into Variable' &&
          orPalette.varLabels[at + 2] === 'Read Object Property';
      })(),
      JSON.stringify(orPalette));
    const orRow = await page.evaluate((tickListenStart) => {
      const taken = new Set([...document.querySelectorAll('#grid [data-block-type]')]
        .map(el => parseInt(el.dataset.index, 10)));
      const freeRow = (startRow, width) => {
        for (let row = startRow; row < 60; row++) {
          let ok = true;
          for (let c = 0; c < width; c++) if (taken.has(row * 60 + c)) { ok = false; break; }
          if (ok) return row * 60;
        }
        return -1;
      };
      return freeRow(Math.floor(tickListenStart / 60) + 2, 9);
    }, evTickListenStart);
    check('a free row of 9 cells exists for the object-reference chain',
      orRow !== -1, JSON.stringify(orRow));
    const orStart = orRow;
    await placeLoopBlock('game-start', orStart);
    await placeLoopBlock('pick-object-into-variable', orStart + 1);
    await placeLoopBlock('read-object-property', orStart + 2);
    await placeLoopBlock('set-scoped-variable', orStart + 3);
    await placeLoopBlock('damage-object', orStart + 4);
    await placeLoopBlock('read-object-property', orStart + 5);
    await placeLoopBlock('set-scoped-variable', orStart + 6);
    await placeLoopBlock('read-object-property', orStart + 7);
    await placeLoopBlock('set-scoped-variable', orStart + 8);
    // The Pick Object Into Variable panel: Object, Pick, Near object,
    // X, Y, Into variable, Scope, Scope object.
    await page.locator(`#grid [data-index="${orStart + 1}"]`).click();
    await page.waitForTimeout(400);
    const pickPanel = await page.evaluate(() => ({
      text: document.getElementById('properties-content')?.textContent || ''
    }));
    check('Pick Object Into Variable panel shows Object, Pick, Near object, Into variable, and Scope fields',
      /Object/.test(pickPanel.text) && /Pick/.test(pickPanel.text) &&
      /Near object/.test(pickPanel.text) && /Into variable/.test(pickPanel.text) &&
      /Scope/.test(pickPanel.text),
      pickPanel.text.slice(0, 400));
    await page.locator('.property-group:has(label:text-is("Object")) select').selectOption('hazard');
    await page.locator('.property-group:has(label:text-is("Near object (optional)")) select').selectOption('player');
    await page.locator('.property-group:has(label:text-is("Into variable")) input').fill('orTarget');
    // The first Read Object Property panel (X into orX).
    await page.locator(`#grid [data-index="${orStart + 2}"]`).click();
    await page.waitForTimeout(400);
    const readPanel = await page.evaluate(() => ({
      text: document.getElementById('properties-content')?.textContent || ''
    }));
    check('Read Object Property panel shows Object variable, Scope, Property, and Into variable fields',
      /Object variable/.test(readPanel.text) && /Scope/.test(readPanel.text) &&
      /Property/.test(readPanel.text) && /Into variable/.test(readPanel.text),
      readPanel.text.slice(0, 400));
    await page.locator('.property-group:has(label:text-is("Object variable")) input').fill('orTarget');
    await page.locator('.property-group:has(label:text-is("Property")) select').selectOption('x');
    await page.locator('.property-group:has(label:text-is("Into variable")) input').fill('orX');
    // Copy orX into the scoped orXLive.
    await page.locator(`#grid [data-index="${orStart + 3}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Variable name")) input').fill('orXLive');
    await page.locator('.property-group:has(label:text-is("Value")) .expr-input').fill('orX');
    // Damage the picked hazard 25.
    await page.locator(`#grid [data-index="${orStart + 4}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Object")) select').selectOption('hazard');
    await page.locator('.property-group:has(label:text-is("Amount")) .expr-input').fill('25');
    // Read its health into orHp, then copy it into orHpLive.
    await page.locator(`#grid [data-index="${orStart + 5}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Object variable")) input').fill('orTarget');
    await page.locator('.property-group:has(label:text-is("Property")) select').selectOption('health');
    await page.locator('.property-group:has(label:text-is("Into variable")) input').fill('orHp');
    await page.locator(`#grid [data-index="${orStart + 6}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Variable name")) input').fill('orHpLive');
    await page.locator('.property-group:has(label:text-is("Value")) .expr-input').fill('orHp');
    // Read its liveness into orAlive, then copy it into orAliveLive.
    await page.locator(`#grid [data-index="${orStart + 7}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Object variable")) input').fill('orTarget');
    await page.locator('.property-group:has(label:text-is("Property")) select').selectOption('alive');
    await page.locator('.property-group:has(label:text-is("Into variable")) input').fill('orAlive');
    await page.locator(`#grid [data-index="${orStart + 8}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Variable name")) input').fill('orAliveLive');
    await page.locator('.property-group:has(label:text-is("Value")) .expr-input').fill('orAlive');
    // Run the preview: the picked hazard sits at X 610, its health
    // reads 75 after the 25 damage, and it is still alive.
    await page.click('.tab[data-tab="preview-tab"]');
    await page.waitForSelector('#game-canvas', { timeout: 10000 });
    await page.waitForFunction(() => {
      const rows = [...document.querySelectorAll('#preview-variables .preview-var-row')];
      const read = (name) => {
        const row = rows.find(r => r.querySelector('.var-name')?.textContent === name);
        return row?.querySelector('[data-preview-var-key]')?.textContent;
      };
      return read('orXLive') === '610' && read('orHpLive') === '75' && read('orAliveLive') === '1';
    }, null, { timeout: 10000 });
    const orLive = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#preview-variables .preview-var-row')];
      const read = (name) => {
        const row = rows.find(r => r.querySelector('.var-name')?.textContent === name);
        return row ? row.textContent : '';
      };
      return { x: read('orXLive'), hp: read('orHpLive'), alive: read('orAliveLive') };
    });
    check('preview runs the object references: hazard X 610, health 75 after damage, alive 1',
      /orXLive/.test(orLive.x) && orLive.x.trim().endsWith('610') &&
      /orHpLive/.test(orLive.hp) && orLive.hp.trim().endsWith('75') &&
      /orAliveLive/.test(orLive.alive) && orLive.alive.trim().endsWith('1'),
      JSON.stringify(orLive));
    // Leave the editor on the Scene tab (the tab switch also stops
    // the preview).
    await page.click('.tab[data-tab="scene-tab"]');

    // ---- P5 core-engine track, item P5-5 (Object primitives,
    // slice b): physics queries that return data. The chain casts a
    // ray straight down x=103 from y=0 — through the player's
    // center, so it enters at y=80 whether the player is a box or
    // a circle (an earlier smoke section flips the player's shape
    // to circle, and a horizontal ray would graze the circle at a
    // different distance) — reads the hit's X (80) and copies both
    // numbers into scoped variables, then lists the objects
    // overlapping a circle on the hazard (610,120) and copies that
    // count (1) into a scoped variable. The player never moves
    // without input and the hazard has not moved yet on the
    // gameStart frame, so all three numbers are exact. The row
    // sits below the object-reference row with one empty row
    // between, so no gameStart sits orthogonally adjacent to
    // another chain's actions.
    await page.click('.tab[data-tab="script-tab"]');
    await page.waitForSelector('.block-selector .block-option[data-block-type="raycast-into-variables"]:visible', { timeout: 5000 });
    const pqPalette = await page.evaluate(() => {
      const options = [...document.querySelectorAll('.block-option')];
      const vars = options.filter(o => o.dataset.category === 'Variables');
      return {
        vars: vars.map(o => o.dataset.blockType),
        varLabels: vars.map(o => o.querySelector('.block-label')?.textContent?.trim() || '')
      };
    });
    check('Variables palette category holds the two physics-query blocks after Read Object Property',
      (() => {
        const at = pqPalette.vars.indexOf('read-object-property');
        return at !== -1 &&
          pqPalette.vars[at + 1] === 'raycast-into-variables' &&
          pqPalette.vars[at + 2] === 'list-overlapping-objects' &&
          pqPalette.varLabels[at + 1] === 'Raycast Into Variables' &&
          pqPalette.varLabels[at + 2] === 'List Overlapping Objects';
      })(),
      JSON.stringify(pqPalette));
    const pqRow = await page.evaluate((orStart) => {
      const taken = new Set([...document.querySelectorAll('#grid [data-block-type]')]
        .map(el => parseInt(el.dataset.index, 10)));
      const freeRow = (startRow, width) => {
        for (let row = startRow; row < 60; row++) {
          let ok = true;
          for (let c = 0; c < width; c++) if (taken.has(row * 60 + c)) { ok = false; break; }
          if (ok) return row * 60;
        }
        return -1;
      };
      return freeRow(Math.floor(orStart / 60) + 2, 7);
    }, orStart);
    check('a free row of 7 cells exists for the physics-query chain',
      pqRow !== -1, JSON.stringify(pqRow));
    const pqStart = pqRow;
    await placeLoopBlock('game-start', pqStart);
    await placeLoopBlock('raycast-into-variables', pqStart + 1);
    await placeLoopBlock('read-object-property', pqStart + 2);
    await placeLoopBlock('set-scoped-variable', pqStart + 3);
    await placeLoopBlock('set-scoped-variable', pqStart + 4);
    await placeLoopBlock('list-overlapping-objects', pqStart + 5);
    await placeLoopBlock('set-scoped-variable', pqStart + 6);
    // The Raycast Into Variables panel: From/To points, Layers,
    // Into variable, Scope, Distance variable.
    await page.locator(`#grid [data-index="${pqStart + 1}"]`).click();
    await page.waitForTimeout(400);
    const raycastPanel = await page.evaluate(() => ({
      text: document.getElementById('properties-content')?.textContent || ''
    }));
    check('Raycast Into Variables panel shows From/To, Layers, Into variable, Scope, and Distance variable fields',
      /From X/.test(raycastPanel.text) && /From Y/.test(raycastPanel.text) &&
      /To X/.test(raycastPanel.text) && /To Y/.test(raycastPanel.text) &&
      /Layers \(mask\)/.test(raycastPanel.text) && /Into variable/.test(raycastPanel.text) &&
      /Scope/.test(raycastPanel.text) && /Distance variable/.test(raycastPanel.text),
      raycastPanel.text.slice(0, 400));
    await page.locator('.property-group:has(label:text-is("From X")) .expr-input').fill('103');
    await page.locator('.property-group:has(label:text-is("From Y")) .expr-input').fill('0');
    await page.locator('.property-group:has(label:text-is("To X")) .expr-input').fill('103');
    await page.locator('.property-group:has(label:text-is("To Y")) .expr-input').fill('600');
    await page.locator('.property-group:has(label:text-is("Into variable")) input').fill('pqHit');
    await page.locator('.property-group:has(label:text-is("Distance variable")) input').fill('pqDist');
    // Read the hit object's X into pqX.
    await page.locator(`#grid [data-index="${pqStart + 2}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Object variable")) input').fill('pqHit');
    await page.locator('.property-group:has(label:text-is("Property")) select').selectOption('x');
    await page.locator('.property-group:has(label:text-is("Into variable")) input').fill('pqX');
    // Copy pqX and pqDist into scoped variables the Live readout shows.
    await page.locator(`#grid [data-index="${pqStart + 3}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Variable name")) input').fill('pqXLive');
    await page.locator('.property-group:has(label:text-is("Value")) .expr-input').fill('pqX');
    await page.locator(`#grid [data-index="${pqStart + 4}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Variable name")) input').fill('pqDistLive');
    await page.locator('.property-group:has(label:text-is("Value")) .expr-input').fill('pqDist');
    // The List Overlapping Objects panel: X, Y, Radius, Layers,
    // Into list, Count variable.
    await page.locator(`#grid [data-index="${pqStart + 5}"]`).click();
    await page.waitForTimeout(400);
    const overlapPanel = await page.evaluate(() => ({
      text: document.getElementById('properties-content')?.textContent || ''
    }));
    check('List Overlapping Objects panel shows X, Y, Radius, Layers, Into list, and Count variable fields',
      /X/.test(overlapPanel.text) && /Y/.test(overlapPanel.text) && /Radius/.test(overlapPanel.text) &&
      /Layers \(mask\)/.test(overlapPanel.text) && /Into list/.test(overlapPanel.text) &&
      /Count variable/.test(overlapPanel.text),
      overlapPanel.text.slice(0, 400));
    await page.locator('.property-group:has(label:text-is("X")) .expr-input').fill('610');
    await page.locator('.property-group:has(label:text-is("Y")) .expr-input').fill('120');
    await page.locator('.property-group:has(label:text-is("Radius")) .expr-input').fill('60');
    await page.locator('.property-group:has(label:text-is("Into list")) input').fill('pqNearby');
    await page.locator('.property-group:has(label:text-is("Count variable")) input').fill('pqNearCount');
    // Copy the overlap count into a scoped variable.
    await page.locator(`#grid [data-index="${pqStart + 6}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Variable name")) input').fill('pqNearLive');
    await page.locator('.property-group:has(label:text-is("Value")) .expr-input').fill('pqNearCount');
    // Run the preview: the ray hits the player at X 80, distance 80,
    // and the circle on the hazard overlaps exactly 1 object.
    await page.click('.tab[data-tab="preview-tab"]');
    await page.waitForSelector('#game-canvas', { timeout: 10000 });
    await page.waitForFunction(() => {
      const rows = [...document.querySelectorAll('#preview-variables .preview-var-row')];
      const read = (name) => {
        const row = rows.find(r => r.querySelector('.var-name')?.textContent === name);
        return row?.querySelector('[data-preview-var-key]')?.textContent;
      };
      // The distance is a float (the ray-vs-shape math), so compare
      // with a tolerance instead of an exact string.
      const dist = Number(read('pqDistLive'));
      return read('pqXLive') === '80' && Number.isFinite(dist) && Math.abs(dist - 80) < 0.01 &&
        read('pqNearLive') === '1';
    }, null, { timeout: 10000 });
    const pqLive = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#preview-variables .preview-var-row')];
      const read = (name) => {
        const row = rows.find(r => r.querySelector('.var-name')?.textContent === name);
        return row ? row.textContent : '';
      };
      return { x: read('pqXLive'), dist: read('pqDistLive'), near: read('pqNearLive') };
    });
    check('preview runs the physics queries: hit X 80, distance 80, overlap count 1',
      /pqXLive/.test(pqLive.x) && pqLive.x.trim().endsWith('80') &&
      /pqDistLive/.test(pqLive.dist) &&
      Math.abs(Number((pqLive.dist.match(/([\d.]+)\s*$/) || [])[1] || NaN) - 80) < 0.01 &&
      /pqNearLive/.test(pqLive.near) && pqLive.near.trim().endsWith('1'),
      JSON.stringify(pqLive));
    // Leave the editor on the Scene tab (the tab switch also stops
    // the preview).
    await page.click('.tab[data-tab="scene-tab"]');

    // ---- P5 core-engine track, item P5-2 (pro editor shell, pass 1,
    // slice a): the status bar — scene name, object count, live FPS,
    // diagnostics count. The section adds one object and one
    // diagnostic probe, then removes the probe again (clearing the
    // feed also clears the diagnostics earlier sections left open —
    // no later section reads the main page's feed). The object add /
    // delete returns the project to the same object count.
    // The previous section leaves the editor on the Scene tab, which
    // stops the preview loop at once — but the bar only refreshes on
    // its 500ms tick, so wait for the FPS to settle to a dash before
    // reading the bar, or the check sees the pre-stop value. The same
    // tick copies the diagnostics count, and the previous section's
    // final commit can add a validation finding (a deleted function's
    // orphaned call) right before this read — so wait for the bar's
    // diagnostics count to match the dock's too, or the check reads
    // the bar one tick stale (slice b exposed this race: 9 vs 10).
    await page.waitForFunction(
      () => document.getElementById('status-fps-value')?.textContent === '—',
      null, { timeout: 5000 });
    await page.waitForFunction(
      () => document.getElementById('status-diagnostics-count')?.textContent ===
        document.getElementById('diagnostic-count')?.textContent,
      null, { timeout: 5000 });
    const statusBar = await page.evaluate(() => {
      const project = window.projectManager?.getCurrentProject?.();
      const sceneId = document.getElementById('scene-switcher-select')?.value;
      const scene = project?.scenes?.find(s => String(s.id) === String(sceneId));
      return {
        bar: !!document.getElementById('status-bar'),
        sceneName: document.getElementById('status-scene-name')?.textContent || '',
        projectSceneName: scene?.name || '',
        objectCount: document.getElementById('status-object-count')?.textContent || '',
        projectObjectCount: scene ? scene.objects.length : -1,
        fps: document.getElementById('status-fps-value')?.textContent || '',
        diag: document.getElementById('status-diagnostics-count')?.textContent || '',
        dockCount: document.getElementById('diagnostic-count')?.textContent || ''
      };
    });
    check('status bar is present with the current scene name and object count',
      statusBar.bar && statusBar.sceneName === statusBar.projectSceneName &&
      statusBar.sceneName.length > 0 &&
      statusBar.objectCount === String(statusBar.projectObjectCount),
      JSON.stringify(statusBar));
    check('status bar shows a dash for FPS while no preview runs',
      statusBar.fps === '—', JSON.stringify(statusBar));
    check('status bar diagnostics count matches the diagnostics dock',
      statusBar.diag === statusBar.dockCount, JSON.stringify(statusBar));
    // Add an object through the Create panel: the count follows.
    // (The previous section left the Variables inspector tab open,
    // so switch to Create first — the Add Entity button is hidden
    // while its panel is not active.)
    const objectsBefore = Number(statusBar.objectCount);
    await page.click('.inspector-tab[data-inspector-tab="create"]');
    await page.click('#add-object-btn');
    await page.waitForFunction(
      (n) => document.getElementById('status-object-count')?.textContent === String(n),
      objectsBefore + 1, { timeout: 5000 });
    check('status bar object count rises when an object is added',
      (await page.locator('#status-object-count').innerText()) === String(objectsBefore + 1));
    // Delete the object again through the scene toolbar.
    await page.click('#scene-delete-btn');
    await page.waitForFunction(
      (n) => document.getElementById('status-object-count')?.textContent === String(n),
      objectsBefore, { timeout: 5000 });
    check('status bar object count falls back when the object is deleted',
      (await page.locator('#status-object-count').innerText()) === String(objectsBefore));
    // A diagnostic probe: the count follows the dock and the item
    // turns amber; clicking it opens the dock. Earlier sections may
    // already have diagnostics open on this project, so the probe is
    // measured relative to the count before it, not against zero.
    const diagBefore = Number(
      await page.locator('#status-diagnostics-count').innerText());
    await page.evaluate(() => window.HydraUniversal?.pushDiagnostic('warning', 'smoke status-bar probe'));
    await page.waitForFunction(
      (n) => document.getElementById('status-diagnostics-count')?.textContent === String(n),
      diagBefore + 1, { timeout: 5000 });
    const diagProbe = await page.evaluate(() => ({
      count: document.getElementById('status-diagnostics-count')?.textContent,
      dock: document.getElementById('diagnostic-count')?.textContent,
      amber: document.getElementById('status-diagnostics')?.classList.contains('has-errors')
    }));
    check('status bar diagnostics count follows a new diagnostic and turns amber',
      diagProbe.count === String(diagBefore + 1) && diagProbe.dock === String(diagBefore + 1) &&
      diagProbe.amber === true,
      JSON.stringify({ ...diagProbe, diagBefore }));
    await page.evaluate(() => document.getElementById('status-diagnostics').click());
    await page.waitForTimeout(300);
    const dockOpened = await page.evaluate(() => ({
      collapsed: document.getElementById('diagnostics-dock')?.classList.contains('is-collapsed'),
      expanded: document.getElementById('diagnostics-toggle')?.getAttribute('aria-expanded')
    }));
    check('clicking the status-bar diagnostics item opens the diagnostics dock',
      dockOpened.collapsed === false && dockOpened.expanded === 'true',
      JSON.stringify(dockOpened));
    await page.evaluate(() => window.HydraUniversal?.clearRuntimeDiagnostics?.());
    await page.waitForFunction(
      () => document.getElementById('status-diagnostics-count')?.textContent === '0',
      null, { timeout: 5000 });
    check('clearing diagnostics returns the status-bar count to zero',
      (await page.locator('#status-diagnostics-count').innerText()) === '0');
    // FPS goes live while the preview plays, and back to a dash when
    // the preview stops (tab switch stops the loop).
    await page.click('.tab[data-tab="preview-tab"]');
    await page.waitForSelector('#game-canvas', { timeout: 10000 });
    await page.waitForFunction(
      () => /^\d+$/.test(document.getElementById('status-fps-value')?.textContent || ''),
      null, { timeout: 10000 });
    const fpsLive = await page.evaluate(() => ({
      fps: document.getElementById('status-fps-value')?.textContent,
      viaApi: window.HydraPreviewRuntime?.previewFps?.()
    }));
    check('status bar FPS is a live number while the preview runs',
      /^\d+$/.test(fpsLive.fps || '') && Number(fpsLive.fps) > 0 &&
      typeof fpsLive.viaApi === 'number' && fpsLive.viaApi > 0,
      JSON.stringify(fpsLive));
    await page.click('.tab[data-tab="scene-tab"]');
    await page.waitForFunction(
      () => document.getElementById('status-fps-value')?.textContent === '—',
      null, { timeout: 5000 });
    check('status bar FPS returns to a dash when the preview stops',
      (await page.locator('#status-fps-value').innerText()) === '—');

    // ---- P5 core-engine track, item P5-2 (pro editor shell, pass 1,
    // slice d): resizable panels. Drag the scene inspector wider and
    // the stage follows; double-click resets; the logic panel resizes
    // from the keyboard; a reload restores the stored widths. Leaves
    // the editor on the Scene tab with both panels back at their
    // defaults (340 / 320), so later sections measure the default
    // layout.
    // The logic panel reports 0px while its tab is hidden (display:
    // none), so the helper returns the CSS variable too — the var is
    // the width, and it reads the same on either tab.
    const panelWidths = async () => page.evaluate(() => {
      const scenePanel = document.querySelector('.scene-side-panel');
      const stage = document.querySelector('.scene-container');
      const logicPanel = document.querySelector('.grid-editor .side-panel');
      const stored = window.HydraPanelResize?.readStoredWidths(window.localStorage);
      return {
        scene: scenePanel ? Math.round(scenePanel.getBoundingClientRect().width) : -1,
        stageRight: stage ? Math.round(stage.getBoundingClientRect().right) : -1,
        logic: logicPanel ? Math.round(logicPanel.getBoundingClientRect().width) : -1,
        logicVar: document.querySelector('.grid-editor')?.style.getPropertyValue('--logic-panel-width') || '',
        stored: stored || null
      };
    });
    const beforeDrag = await panelWidths();
    check('resizable panels start at the default widths (scene 340, logic 320)',
      beforeDrag.scene === 340 && beforeDrag.logicVar === '320px', JSON.stringify(beforeDrag));
    // Drag the scene handle 120px left: the panel widens to 460 and
    // the stage's right edge follows it.
    const sceneHandle = await page.locator('#scene-panel-resizer').boundingBox();
    await page.mouse.move(sceneHandle.x + sceneHandle.width / 2, sceneHandle.y + 200);
    await page.mouse.down();
    await page.mouse.move(sceneHandle.x + sceneHandle.width / 2 - 120, sceneHandle.y + 200, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const afterDrag = await panelWidths();
    check('dragging the scene handle widens the inspector and the stage follows',
      afterDrag.scene === 460 && afterDrag.stageRight === 1400 - 460,
      JSON.stringify(afterDrag));
    check('dragging persists the scene width to localStorage',
      afterDrag.stored && afterDrag.stored.scene === 460 && afterDrag.stored.logic === 320,
      JSON.stringify(afterDrag.stored));
    // Double-click the handle: back to the default, and persisted.
    await page.dblclick('#scene-panel-resizer');
    await page.waitForTimeout(200);
    const afterReset = await panelWidths();
    check('double-clicking the scene handle resets it to 340',
      afterReset.scene === 340 && afterReset.stored && afterReset.stored.scene === 340,
      JSON.stringify(afterReset));
    // Logic tab: keyboard resize — ArrowRight widens 10px, Home resets.
    await page.click('.tab[data-tab="script-tab"]');
    await page.waitForSelector('#grid', { timeout: 10000 });
    await page.focus('#logic-panel-resizer');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    const afterKey = await panelWidths();
    check('ArrowRight on the logic handle widens it by 10px',
      afterKey.logic === 330 && afterKey.stored && afterKey.stored.logic === 330,
      JSON.stringify(afterKey));
    await page.keyboard.press('Home');
    await page.waitForTimeout(200);
    const afterLogicHome = await panelWidths();
    check('Home on the logic handle resets it to 320',
      afterLogicHome.logic === 320 && afterLogicHome.stored && afterLogicHome.stored.logic === 320,
      JSON.stringify(afterLogicHome));
    // A reload restores stored non-default widths: set both, reload,
    // measure, then put both back at their defaults.
    await page.click('.tab[data-tab="scene-tab"]');
    const sceneHandle2 = await page.locator('#scene-panel-resizer').boundingBox();
    await page.mouse.move(sceneHandle2.x + sceneHandle2.width / 2, sceneHandle2.y + 200);
    await page.mouse.down();
    await page.mouse.move(sceneHandle2.x + sceneHandle2.width / 2 - 120, sceneHandle2.y + 200, { steps: 12 });
    await page.mouse.up();
    await page.click('.tab[data-tab="script-tab"]');
    await page.waitForSelector('#grid', { timeout: 10000 });
    await page.focus('#logic-panel-resizer');
    await page.keyboard.press('ArrowRight');
    await reloadPage(page, { waitUntil: 'domcontentloaded' });
    await page.click('.tab[data-tab="scene-tab"]');
    await page.waitForTimeout(300);
    const afterReload = await panelWidths();
    check('a reload restores the stored panel widths (scene 460, logic 330)',
      afterReload.scene === 460 && afterReload.logicVar === '330px',
      JSON.stringify(afterReload));
    await page.dblclick('#scene-panel-resizer');
    await page.click('.tab[data-tab="script-tab"]');
    await page.waitForSelector('#grid', { timeout: 10000 });
    await page.focus('#logic-panel-resizer');
    await page.keyboard.press('Home');
    await page.click('.tab[data-tab="scene-tab"]');
    await page.waitForTimeout(200);
    const restoredDefaults = await panelWidths();
    check('panels return to their defaults after the reload check',
      restoredDefaults.scene === 340 && restoredDefaults.logicVar === '320px',
      JSON.stringify(restoredDefaults));

    // ---- P5 core-engine track, item P5-5 (Object primitives,
    // slice c): spawn and destroy through a scoped variable. The
    // chain spawns a hazard clone at (200, 200) into srClone, reads
    // its X, copies it into a scoped variable, destroys exactly
    // that clone, reads Is alive (0 now), and copies that too. The
    // original hazard never moves, so the clone's X is exact.
    await page.click('.tab[data-tab="script-tab"]');
    await page.waitForSelector('.block-selector .block-option[data-block-type="spawn-object-into-variable"]:visible', { timeout: 5000 });
    const srPalette = await page.evaluate(() => {
      const options = [...document.querySelectorAll('.block-option')];
      const vars = options.filter(o => o.dataset.category === 'Variables');
      return {
        vars: vars.map(o => o.dataset.blockType),
        varLabels: vars.map(o => o.querySelector('.block-label')?.textContent?.trim() || '')
      };
    });
    check('Variables palette holds Spawn and Destroy Object In Variable after the physics-query blocks',
      (() => {
        const at = srPalette.vars.indexOf('read-object-property');
        return at !== -1 &&
          srPalette.vars[at + 3] === 'spawn-object-into-variable' &&
          srPalette.vars[at + 4] === 'destroy-object-in-variable' &&
          srPalette.varLabels[at + 3] === 'Spawn Object Into Variable' &&
          srPalette.varLabels[at + 4] === 'Destroy Object In Variable';
      })(),
      JSON.stringify(srPalette));
    const srRow = await page.evaluate((pqStart) => {
      const taken = new Set([...document.querySelectorAll('#grid [data-block-type]')]
        .map(el => parseInt(el.dataset.index, 10)));
      const freeRow = (startRow, width) => {
        for (let row = startRow; row < 60; row++) {
          let ok = true;
          for (let c = 0; c < width; c++) if (taken.has(row * 60 + c)) { ok = false; break; }
          if (ok) return row * 60;
        }
        return -1;
      };
      return freeRow(Math.floor(pqStart / 60) + 2, 7);
    }, pqStart);
    check('a free row of 7 cells exists for the spawn/destroy chain',
      srRow !== -1, JSON.stringify(srRow));
    const srStart = srRow;
    await placeLoopBlock('game-start', srStart);
    await placeLoopBlock('spawn-object-into-variable', srStart + 1);
    await placeLoopBlock('read-object-property', srStart + 2);
    await placeLoopBlock('set-scoped-variable', srStart + 3);
    await placeLoopBlock('destroy-object-in-variable', srStart + 4);
    await placeLoopBlock('read-object-property', srStart + 5);
    await placeLoopBlock('set-scoped-variable', srStart + 6);
    // The Spawn Object Into Variable panel: Object, X, Y, Into
    // variable, Scope, Scope object.
    await page.locator(`#grid [data-index="${srStart + 1}"]`).click();
    await page.waitForTimeout(400);
    const srSpawnPanel = await page.evaluate(() => ({
      text: document.getElementById('properties-content')?.textContent || ''
    }));
    check('Spawn Object Into Variable panel shows Object, X, Y, Into variable, and Scope fields',
      /Object/.test(srSpawnPanel.text) && /Into variable/.test(srSpawnPanel.text) &&
      /Scope/.test(srSpawnPanel.text),
      srSpawnPanel.text.slice(0, 400));
    await page.locator('.property-group:has(label:text-is("Object")) select').selectOption('hazard');
    await page.locator('.property-group:has(label:text-is("X")) .expr-input').fill('200');
    await page.locator('.property-group:has(label:text-is("Y")) .expr-input').fill('200');
    await page.locator('.property-group:has(label:text-is("Into variable")) input').fill('srClone');
    // Read the clone's X into srX.
    await page.locator(`#grid [data-index="${srStart + 2}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Object variable")) input').fill('srClone');
    await page.locator('.property-group:has(label:text-is("Property")) select').selectOption('x');
    await page.locator('.property-group:has(label:text-is("Into variable")) input').fill('srX');
    // Copy srX into a scoped variable the Live readout shows.
    await page.locator(`#grid [data-index="${srStart + 3}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Variable name")) input').fill('srXLive');
    await page.locator('.property-group:has(label:text-is("Value")) .expr-input').fill('srX');
    // The Destroy Object In Variable panel: Object variable, Scope,
    // Scope object.
    await page.locator(`#grid [data-index="${srStart + 4}"]`).click();
    await page.waitForTimeout(400);
    const destroyPanel = await page.evaluate(() => ({
      text: document.getElementById('properties-content')?.textContent || ''
    }));
    check('Destroy Object In Variable panel shows Object variable and Scope fields',
      /Object variable/.test(destroyPanel.text) && /Scope/.test(destroyPanel.text),
      destroyPanel.text.slice(0, 400));
    await page.locator('.property-group:has(label:text-is("Object variable")) input').fill('srClone');
    // Read the clone's Is alive into srAlive (0 after the destroy).
    await page.locator(`#grid [data-index="${srStart + 5}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Object variable")) input').fill('srClone');
    await page.locator('.property-group:has(label:text-is("Property")) select').selectOption('alive');
    await page.locator('.property-group:has(label:text-is("Into variable")) input').fill('srAlive');
    await page.locator(`#grid [data-index="${srStart + 6}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Variable name")) input').fill('srAliveLive');
    await page.locator('.property-group:has(label:text-is("Value")) .expr-input').fill('srAlive');
    // Run the preview: the clone spawns at X 200 and is gone by the
    // time its Is alive is read.
    await page.click('.tab[data-tab="preview-tab"]');
    await page.waitForSelector('#game-canvas', { timeout: 10000 });
    await page.waitForFunction(() => {
      const rows = [...document.querySelectorAll('#preview-variables .preview-var-row')];
      const read = (name) => {
        const row = rows.find(r => r.querySelector('.var-name')?.textContent === name);
        return row?.querySelector('[data-preview-var-key]')?.textContent;
      };
      return read('srXLive') === '200' && read('srAliveLive') === '0';
    }, null, { timeout: 10000 });
    const srLive = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#preview-variables .preview-var-row')];
      const read = (name) => {
        const row = rows.find(r => r.querySelector('.var-name')?.textContent === name);
        return row ? row.textContent : '';
      };
      return { x: read('srXLive'), alive: read('srAliveLive') };
    });
    check('preview runs spawn then destroy: clone X 200, Is alive 0',
      /srXLive/.test(srLive.x) && srLive.x.trim().endsWith('200') &&
      /srAliveLive/.test(srLive.alive) && srLive.alive.trim().endsWith('0'),
      JSON.stringify(srLive));
    // Leave the editor on the Scene tab (the tab switch also stops
    // the preview).
    await page.click('.tab[data-tab="scene-tab"]');

    // ---- P5 core-engine track, item P5-5 (Object primitives,
    // slice d): decompose the attack presets. Melee Attack and
    // Shoot Projectile are presets over the primitives — damage,
    // range, direction, cooldown — and this section only pins the
    // Combat palette order and both panels; no live preview, the
    // presets run on the same execute path the primitives do.
    await page.click('.tab[data-tab="script-tab"]');
    await page.waitForSelector('.block-selector .block-option[data-block-type="melee-attack"]:visible', { timeout: 5000 });
    const coPalette = await page.evaluate(() => {
      const options = [...document.querySelectorAll('.block-option')];
      const combat = options.filter(o => o.dataset.category === 'Combat');
      return {
        combat: combat.map(o => o.dataset.blockType),
        combatLabels: combat.map(o => o.querySelector('.block-label')?.textContent?.trim() || '')
      };
    });
    check('Combat palette holds Melee Attack before Shoot Projectile',
      (() => {
        const at = coPalette.combat.indexOf('melee-attack');
        return at !== -1 &&
          coPalette.combat[at + 1] === 'shoot-projectile' &&
          coPalette.combatLabels[at] === 'Melee Attack' &&
          coPalette.combatLabels[at + 1] === 'Shoot Projectile';
      })(),
      JSON.stringify(coPalette));
    const coRow = await page.evaluate((srStart) => {
      const taken = new Set([...document.querySelectorAll('#grid [data-block-type]')]
        .map(el => parseInt(el.dataset.index, 10)));
      const freeRow = (startRow, width) => {
        for (let row = startRow; row < 60; row++) {
          let ok = true;
          for (let c = 0; c < width; c++) if (taken.has(row * 60 + c)) { ok = false; break; }
          if (ok) return row * 60;
        }
        return -1;
      };
      return freeRow(Math.floor(srStart / 60) + 2, 2);
    }, srStart);
    check('a free row of 2 cells exists for the two attack presets',
      coRow !== -1, JSON.stringify(coRow));
    const coStart = coRow;
    await placeLoopBlock('melee-attack', coStart);
    await placeLoopBlock('shoot-projectile', coStart + 1);
    // The Melee Attack panel: Attacker, Damage, Range, Direction,
    // Cooldown.
    await page.locator(`#grid [data-index="${coStart}"]`).click();
    await page.waitForTimeout(400);
    const meleePanel = await page.evaluate(() => ({
      text: document.getElementById('properties-content')?.textContent || ''
    }));
    check('Melee Attack panel shows Attacker, Damage, Range, Direction, and Cooldown fields',
      /Attacker/.test(meleePanel.text) && /Damage/.test(meleePanel.text) &&
      /Range \(px\)/.test(meleePanel.text) && /Direction/.test(meleePanel.text) &&
      /Cooldown \(s\)/.test(meleePanel.text),
      meleePanel.text.slice(0, 400));
    // The Shoot Projectile panel: Shooter, Projectile, Direction.
    await page.locator(`#grid [data-index="${coStart + 1}"]`).click();
    await page.waitForTimeout(400);
    const shootPanel = await page.evaluate(() => ({
      text: document.getElementById('properties-content')?.textContent || ''
    }));
    check('Shoot Projectile panel shows Shooter, Projectile, and Direction fields',
      /Shooter/.test(shootPanel.text) && /Projectile/.test(shootPanel.text) &&
      /Direction/.test(shootPanel.text),
      shootPanel.text.slice(0, 400));
    await page.click('.tab[data-tab="scene-tab"]');

    // ---- P5 core-engine track, item P5-6 (Data structures,
    // slice a): nested paths. The chain builds a party list of
    // member dictionaries with Set Nested Value, then reads the
    // second member's hp (25) and the first member's name (Ky)
    // back with Get Nested Value and copies both into scoped
    // variables the Live readout shows. The name travels as a
    // variable copy — expressions are numeric and cannot carry
    // text.
    await page.click('.tab[data-tab="script-tab"]');
    await page.waitForSelector('.block-selector .block-option[data-block-type="nested-get"]:visible', { timeout: 5000 });
    const npPalette = await page.evaluate(() => {
      const options = [...document.querySelectorAll('.block-option')];
      const vars = options.filter(o => o.dataset.category === 'Variables');
      return {
        vars: vars.map(o => o.dataset.blockType),
        varLabels: vars.map(o => o.querySelector('.block-label')?.textContent?.trim() || '')
      };
    });
    check('Variables palette holds Get and Set Nested Value after Variable From JSON',
      (() => {
        const at = npPalette.vars.indexOf('var-from-json');
        return at !== -1 &&
          npPalette.vars[at + 1] === 'nested-get' &&
          npPalette.vars[at + 2] === 'nested-set' &&
          npPalette.varLabels[at + 1] === 'Get Nested Value' &&
          npPalette.varLabels[at + 2] === 'Set Nested Value';
      })(),
      JSON.stringify(npPalette));
    const npRow = await page.evaluate((coStart) => {
      const taken = new Set([...document.querySelectorAll('#grid [data-block-type]')]
        .map(el => parseInt(el.dataset.index, 10)));
      const freeRow = (startRow, width) => {
        for (let row = startRow; row < 60; row++) {
          let ok = true;
          for (let c = 0; c < width; c++) if (taken.has(row * 60 + c)) { ok = false; break; }
          if (ok) return row * 60;
        }
        return -1;
      };
      return freeRow(Math.floor(coStart / 60) + 2, 8);
    }, coStart);
    check('a free row of 8 cells exists for the nested-paths chain',
      npRow !== -1, JSON.stringify(npRow));
    const npStart = npRow;
    await placeLoopBlock('game-start', npStart);
    await placeLoopBlock('nested-set', npStart + 1);
    await placeLoopBlock('nested-set', npStart + 2);
    await placeLoopBlock('nested-set', npStart + 3);
    await placeLoopBlock('nested-get', npStart + 4);
    await placeLoopBlock('nested-get', npStart + 5);
    await placeLoopBlock('set-scoped-variable', npStart + 6);
    await placeLoopBlock('set-scoped-variable', npStart + 7);
    // The Set Nested Value panel: Variable, Path, Value is, Value.
    await page.locator(`#grid [data-index="${npStart + 1}"]`).click();
    await page.waitForTimeout(400);
    const nestedSetPanel = await page.evaluate(() => ({
      text: document.getElementById('properties-content')?.textContent || ''
    }));
    check('Set Nested Value panel shows Variable, Path, Value is, and Value fields',
      /Variable/.test(nestedSetPanel.text) && /Path/.test(nestedSetPanel.text) &&
      /Value is/.test(nestedSetPanel.text) && /Value/.test(nestedSetPanel.text),
      nestedSetPanel.text.slice(0, 400));
    await page.locator('.property-group:has(label:text-is("Variable")) input').fill('party');
    await page.locator('.property-group:has(label:text-is("Path")) input').fill('[0].name');
    await page.locator('.property-group:has(label:text-is("Value is")) select').selectOption('text');
    await page.locator('.property-group:has(label:text-is("Value")) .expr-input').fill('Ky');
    await page.locator(`#grid [data-index="${npStart + 2}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Variable")) input').fill('party');
    await page.locator('.property-group:has(label:text-is("Path")) input').fill('[0].hp');
    await page.locator('.property-group:has(label:text-is("Value")) .expr-input').fill('30');
    await page.locator(`#grid [data-index="${npStart + 3}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Variable")) input').fill('party');
    await page.locator('.property-group:has(label:text-is("Path")) input').fill('[1].hp');
    await page.locator('.property-group:has(label:text-is("Value")) .expr-input').fill('25');
    // The Get Nested Value panel: Variable, Path, Into variable.
    await page.locator(`#grid [data-index="${npStart + 4}"]`).click();
    await page.waitForTimeout(400);
    const nestedGetPanel = await page.evaluate(() => ({
      text: document.getElementById('properties-content')?.textContent || ''
    }));
    check('Get Nested Value panel shows Variable, Path, and Into variable fields',
      /Variable/.test(nestedGetPanel.text) && /Path/.test(nestedGetPanel.text) &&
      /Into variable/.test(nestedGetPanel.text),
      nestedGetPanel.text.slice(0, 400));
    await page.locator('.property-group:has(label:text-is("Variable")) input').fill('party');
    await page.locator('.property-group:has(label:text-is("Path")) input').fill('[1].hp');
    await page.locator('.property-group:has(label:text-is("Into variable")) input').fill('secondHp');
    await page.locator(`#grid [data-index="${npStart + 5}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Variable")) input').fill('party');
    await page.locator('.property-group:has(label:text-is("Path")) input').fill('[0].name');
    await page.locator('.property-group:has(label:text-is("Into variable")) input').fill('firstName');
    // Copy both reads into scoped variables the Live readout shows.
    await page.locator(`#grid [data-index="${npStart + 6}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Variable name")) input').fill('npHpLive');
    await page.locator('.property-group:has(label:text-is("Value")) .expr-input').fill('secondHp');
    await page.locator(`#grid [data-index="${npStart + 7}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Variable name")) input').fill('npNameLive');
    await page.locator('.property-group:has(label:text-is("Value is")) select').selectOption('variable');
    await page.locator('.property-group:has(label:text-is("Value")) .expr-input').fill('firstName');
    // Run the preview: second hp 25, first name Ky.
    await page.click('.tab[data-tab="preview-tab"]');
    await page.waitForSelector('#game-canvas', { timeout: 10000 });
    await page.waitForFunction(() => {
      const rows = [...document.querySelectorAll('#preview-variables .preview-var-row')];
      const read = (name) => {
        const row = rows.find(r => r.querySelector('.var-name')?.textContent === name);
        return row?.querySelector('[data-preview-var-key]')?.textContent;
      };
      return read('npHpLive') === '25' && read('npNameLive') === 'Ky';
    }, null, { timeout: 10000 });
    const npLive = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#preview-variables .preview-var-row')];
      const read = (name) => {
        const row = rows.find(r => r.querySelector('.var-name')?.textContent === name);
        return row ? row.textContent : '';
      };
      return { hp: read('npHpLive'), name: read('npNameLive') };
    });
    check('preview runs the nested paths: second hp 25, first name Ky',
      /npHpLive/.test(npLive.hp) && npLive.hp.trim().endsWith('25') &&
      /npNameLive/.test(npLive.name) && npLive.name.trim().endsWith('Ky'),
      JSON.stringify(npLive));
    await page.click('.tab[data-tab="scene-tab"]');

    // ---- P5 core-engine track, item P5-6 (Data structures,
    // slice b): object references inside structures. The chain
    // spawns a hazard clone at (200, 200) into sqMember, stores
    // the handle in squad[0], reads it back into sqBack, then
    // reads the member's X (200) and Is alive (1) through the
    // handle and copies both into scoped variables.
    await page.click('.tab[data-tab="script-tab"]');
    await page.waitForSelector('.block-selector .block-option[data-block-type="nested-store-object"]:visible', { timeout: 5000 });
    const sqPalette = await page.evaluate(() => {
      const options = [...document.querySelectorAll('.block-option')];
      const vars = options.filter(o => o.dataset.category === 'Variables');
      return {
        vars: vars.map(o => o.dataset.blockType),
        varLabels: vars.map(o => o.querySelector('.block-label')?.textContent?.trim() || '')
      };
    });
    check('Variables palette holds Store and Read Object In Structure after Set Nested Value',
      (() => {
        const at = sqPalette.vars.indexOf('nested-set');
        return at !== -1 &&
          sqPalette.vars[at + 1] === 'nested-store-object' &&
          sqPalette.vars[at + 2] === 'nested-read-object' &&
          sqPalette.varLabels[at + 1] === 'Store Object In Structure' &&
          sqPalette.varLabels[at + 2] === 'Read Object From Structure';
      })(),
      JSON.stringify(sqPalette));
    const sqRow = await page.evaluate((npStart) => {
      const taken = new Set([...document.querySelectorAll('#grid [data-block-type]')]
        .map(el => parseInt(el.dataset.index, 10)));
      const freeRow = (startRow, width) => {
        for (let row = startRow; row < 60; row++) {
          let ok = true;
          for (let c = 0; c < width; c++) if (taken.has(row * 60 + c)) { ok = false; break; }
          if (ok) return row * 60;
        }
        return -1;
      };
      return freeRow(Math.floor(npStart / 60) + 2, 8);
    }, npStart);
    check('a free row of 8 cells exists for the object-in-structure chain',
      sqRow !== -1, JSON.stringify(sqRow));
    const sqStart = sqRow;
    await placeLoopBlock('game-start', sqStart);
    await placeLoopBlock('spawn-object-into-variable', sqStart + 1);
    await placeLoopBlock('nested-store-object', sqStart + 2);
    await placeLoopBlock('nested-read-object', sqStart + 3);
    await placeLoopBlock('read-object-property', sqStart + 4);
    await placeLoopBlock('set-scoped-variable', sqStart + 5);
    await placeLoopBlock('read-object-property', sqStart + 6);
    await placeLoopBlock('set-scoped-variable', sqStart + 7);
    // Spawn the member at (200, 200).
    await page.locator(`#grid [data-index="${sqStart + 1}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Object")) select').selectOption('hazard');
    await page.locator('.property-group:has(label:text-is("X")) .expr-input').fill('200');
    await page.locator('.property-group:has(label:text-is("Y")) .expr-input').fill('200');
    await page.locator('.property-group:has(label:text-is("Into variable")) input').fill('sqMember');
    // The Store Object In Structure panel: Variable, Path, Object
    // variable, Scope, Scope object.
    await page.locator(`#grid [data-index="${sqStart + 2}"]`).click();
    await page.waitForTimeout(400);
    const storeObjPanel = await page.evaluate(() => ({
      text: document.getElementById('properties-content')?.textContent || ''
    }));
    check('Store Object In Structure panel shows Variable, Path, Object variable, and Scope fields',
      /Variable/.test(storeObjPanel.text) && /Path/.test(storeObjPanel.text) &&
      /Object variable/.test(storeObjPanel.text) && /Scope/.test(storeObjPanel.text),
      storeObjPanel.text.slice(0, 400));
    await page.locator('.property-group:has(label:text-is("Variable")) input').fill('squad');
    await page.locator('.property-group:has(label:text-is("Path")) input').fill('[0]');
    await page.locator('.property-group:has(label:text-is("Object variable")) input').fill('sqMember');
    // The Read Object From Structure panel: the same five fields.
    await page.locator(`#grid [data-index="${sqStart + 3}"]`).click();
    await page.waitForTimeout(400);
    const readObjPanel = await page.evaluate(() => ({
      text: document.getElementById('properties-content')?.textContent || ''
    }));
    check('Read Object From Structure panel shows Variable, Path, Object variable, and Scope fields',
      /Variable/.test(readObjPanel.text) && /Path/.test(readObjPanel.text) &&
      /Object variable/.test(readObjPanel.text) && /Scope/.test(readObjPanel.text),
      readObjPanel.text.slice(0, 400));
    await page.locator('.property-group:has(label:text-is("Variable")) input').fill('squad');
    await page.locator('.property-group:has(label:text-is("Path")) input').fill('[0]');
    await page.locator('.property-group:has(label:text-is("Object variable")) input').fill('sqBack');
    // Read the member's X and Is alive through the handle.
    await page.locator(`#grid [data-index="${sqStart + 4}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Object variable")) input').fill('sqBack');
    await page.locator('.property-group:has(label:text-is("Property")) select').selectOption('x');
    await page.locator('.property-group:has(label:text-is("Into variable")) input').fill('sqX');
    await page.locator(`#grid [data-index="${sqStart + 5}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Variable name")) input').fill('sqXLive');
    await page.locator('.property-group:has(label:text-is("Value")) .expr-input').fill('sqX');
    await page.locator(`#grid [data-index="${sqStart + 6}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Object variable")) input').fill('sqBack');
    await page.locator('.property-group:has(label:text-is("Property")) select').selectOption('alive');
    await page.locator('.property-group:has(label:text-is("Into variable")) input').fill('sqAlive');
    await page.locator(`#grid [data-index="${sqStart + 7}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Variable name")) input').fill('sqAliveLive');
    await page.locator('.property-group:has(label:text-is("Value")) .expr-input').fill('sqAlive');
    // Run the preview: the member read back from squad[0] is at
    // X 200 and alive.
    await page.click('.tab[data-tab="preview-tab"]');
    await page.waitForSelector('#game-canvas', { timeout: 10000 });
    await page.waitForFunction(() => {
      const rows = [...document.querySelectorAll('#preview-variables .preview-var-row')];
      const read = (name) => {
        const row = rows.find(r => r.querySelector('.var-name')?.textContent === name);
        return row?.querySelector('[data-preview-var-key]')?.textContent;
      };
      return read('sqXLive') === '200' && read('sqAliveLive') === '1';
    }, null, { timeout: 10000 });
    const sqLive = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#preview-variables .preview-var-row')];
      const read = (name) => {
        const row = rows.find(r => r.querySelector('.var-name')?.textContent === name);
        return row ? row.textContent : '';
      };
      return { x: read('sqXLive'), alive: read('sqAliveLive') };
    });
    check('preview reads the stored object back: member X 200, Is alive 1',
      /sqXLive/.test(sqLive.x) && sqLive.x.trim().endsWith('200') &&
      /sqAliveLive/.test(sqLive.alive) && sqLive.alive.trim().endsWith('1'),
      JSON.stringify(sqLive));
    await page.click('.tab[data-tab="scene-tab"]');

    // ---- P5 core-engine track, item P5-6 (Data structures,
    // slice c): For Each Field. The chain rebuilds a stats
    // structure from JSON ({hp: 40, mp: 30, xp: 10}), walks its
    // fields, adds each value into ffTotal and each index into
    // ffIdx, and copies both totals into scoped variables: the
    // values sum to 80 and the indexes (1, 2, 3) sum to 6.
    await page.click('.tab[data-tab="script-tab"]');
    await page.waitForSelector('.block-selector .block-option[data-block-type="for-each-field"]:visible', { timeout: 5000 });
    const ffPalette = await page.evaluate(() => {
      const options = [...document.querySelectorAll('.block-option')];
      const control = options.filter(o => o.dataset.category === 'Control Flow');
      return {
        control: control.map(o => o.dataset.blockType),
        controlLabels: control.map(o => o.querySelector('.block-label')?.textContent?.trim() || '')
      };
    });
    check('Control Flow palette holds For Each Field after For Each Object',
      (() => {
        const at = ffPalette.control.indexOf('for-each-object');
        return at !== -1 &&
          ffPalette.control[at + 1] === 'for-each-field' &&
          ffPalette.controlLabels[at + 1] === 'For Each Field';
      })(),
      JSON.stringify(ffPalette));
    const ffRow = await page.evaluate((sqStart) => {
      const taken = new Set([...document.querySelectorAll('#grid [data-block-type]')]
        .map(el => parseInt(el.dataset.index, 10)));
      const freeRow = (startRow, width) => {
        for (let row = startRow; row < 60; row++) {
          let ok = true;
          for (let c = 0; c < width; c++) if (taken.has(row * 60 + c)) { ok = false; break; }
          if (ok) return row * 60;
        }
        return -1;
      };
      return freeRow(Math.floor(sqStart / 60) + 2, 7);
    }, sqStart);
    check('a free row of 7 cells exists for the For Each Field chain',
      ffRow !== -1, JSON.stringify(ffRow));
    const ffStart = ffRow;
    await placeLoopBlock('game-start', ffStart);
    await placeLoopBlock('var-from-json', ffStart + 1);
    await placeLoopBlock('for-each-field', ffStart + 2);
    await placeLoopBlock('set-variable', ffStart + 3);
    await placeLoopBlock('set-variable', ffStart + 4);
    await placeLoopBlock('set-scoped-variable', ffStart + 5);
    await placeLoopBlock('set-scoped-variable', ffStart + 6);
    // Rebuild the stats structure from JSON.
    await page.locator(`#grid [data-index="${ffStart + 1}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Variable")) input').fill('ffStats');
    await page.locator('.property-group:has(label:text-is("JSON text")) input').fill('{"hp":40,"mp":30,"xp":10}');
    // The For Each Field panel: Structure variable, Key variable,
    // Value variable, Index variable (optional).
    await page.locator(`#grid [data-index="${ffStart + 2}"]`).click();
    await page.waitForTimeout(400);
    const forEachFieldPanel = await page.evaluate(() => ({
      text: document.getElementById('properties-content')?.textContent || ''
    }));
    check('For Each Field panel shows Structure, Key, Value, and Index variable fields',
      /Structure variable/.test(forEachFieldPanel.text) && /Key variable/.test(forEachFieldPanel.text) &&
      /Value variable/.test(forEachFieldPanel.text) && /Index variable/.test(forEachFieldPanel.text),
      forEachFieldPanel.text.slice(0, 400));
    await page.locator('.property-group:has(label:text-is("Structure variable")) input').fill('ffStats');
    await page.locator('.property-group:has(label:text-is("Key variable")) input').fill('ffKey');
    await page.locator('.property-group:has(label:text-is("Value variable")) input').fill('ffVal');
    await page.locator('.property-group:has(label:text-is("Index variable (optional)")) input').fill('ffN');
    // The loop body adds each value and each index into flat totals.
    await page.locator(`#grid [data-index="${ffStart + 3}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Variable:")) input').fill('ffTotal');
    await page.locator('.property-group:has(label:text-is("Operation:")) select').selectOption('add');
    await page.locator('.property-group:has(label:text-is("Value:")) .expr-input').fill('ffVal');
    await page.locator(`#grid [data-index="${ffStart + 4}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Variable:")) input').fill('ffIdx');
    await page.locator('.property-group:has(label:text-is("Operation:")) select').selectOption('add');
    await page.locator('.property-group:has(label:text-is("Value:")) .expr-input').fill('ffN');
    // Copy both totals into scoped variables the Live readout shows.
    await page.locator(`#grid [data-index="${ffStart + 5}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Variable name")) input').fill('ffTotalLive');
    await page.locator('.property-group:has(label:text-is("Value")) .expr-input').fill('ffTotal');
    await page.locator(`#grid [data-index="${ffStart + 6}"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.property-group:has(label:text-is("Variable name")) input').fill('ffIdxLive');
    await page.locator('.property-group:has(label:text-is("Value")) .expr-input').fill('ffIdx');
    // Run the preview: the field values sum to 80, the indexes to 6.
    await page.click('.tab[data-tab="preview-tab"]');
    await page.waitForSelector('#game-canvas', { timeout: 10000 });
    await page.waitForFunction(() => {
      const rows = [...document.querySelectorAll('#preview-variables .preview-var-row')];
      const read = (name) => {
        const row = rows.find(r => r.querySelector('.var-name')?.textContent === name);
        return row?.querySelector('[data-preview-var-key]')?.textContent;
      };
      return read('ffTotalLive') === '80' && read('ffIdxLive') === '6';
    }, null, { timeout: 10000 });
    const ffLive = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#preview-variables .preview-var-row')];
      const read = (name) => {
        const row = rows.find(r => r.querySelector('.var-name')?.textContent === name);
        return row ? row.textContent : '';
      };
      return { total: read('ffTotalLive'), idx: read('ffIdxLive') };
    });
    check('preview walks the structure fields: values sum 80, indexes sum 6',
      /ffTotalLive/.test(ffLive.total) && ffLive.total.trim().endsWith('80') &&
      /ffIdxLive/.test(ffLive.idx) && ffLive.idx.trim().endsWith('6'),
      JSON.stringify(ffLive));
    await page.click('.tab[data-tab="scene-tab"]');

    // ---- P5 core-engine track, item P5-8 (pro editor shell, pass 2,
    // slice a): dockable panels. Each side panel can dock to the
    // left edge instead of the right: the dock button names the
    // next side, reads active while its panel sits on the left, and
    // the choice persists across reloads. A docked panel keeps
    // resizing from its free edge. Leaves both panels back at
    // their right-docked defaults (scene 340, logic 320).
    const dockState = async () => page.evaluate(() => {
      const PD = window.HydraPanelDock;
      const scenePanel = document.querySelector('.scene-side-panel');
      const logicPanel = document.querySelector('.grid-editor .side-panel');
      const sceneBtn = document.getElementById('scene-panel-dock-btn');
      const logicBtn = document.getElementById('logic-panel-dock-btn');
      return {
        scene: document.querySelector('.scene-editor')?.getAttribute('data-panel-side') || '',
        logic: document.querySelector('.grid-editor')?.getAttribute('data-panel-side') || '',
        sceneLeft: scenePanel ? Math.round(scenePanel.getBoundingClientRect().left) : -1,
        sceneWidth: scenePanel ? Math.round(scenePanel.getBoundingClientRect().width) : -1,
        logicLeft: logicPanel ? Math.round(logicPanel.getBoundingClientRect().left) : -1,
        logicVar: document.querySelector('.grid-editor')?.style.getPropertyValue('--logic-panel-width') || '',
        stored: PD ? PD.readStoredSides(window.localStorage) : null,
        sceneBtnActive: sceneBtn ? sceneBtn.classList.contains('active') : false,
        logicBtnActive: logicBtn ? logicBtn.classList.contains('active') : false
      };
    });
    const dockStart = await dockState();
    check('panels start right-docked (scene left 1060 width 340, logic 320)',
      dockStart.scene === 'right' && dockStart.logic === 'right' &&
      dockStart.sceneLeft === 1400 - 340 && dockStart.sceneWidth === 340 &&
      dockStart.logicVar === '320px' && !dockStart.sceneBtnActive && !dockStart.logicBtnActive,
      JSON.stringify(dockStart));
    // Dock the scene panel left: it moves to the left edge and the
    // choice persists.
    await page.click('#scene-panel-dock-btn');
    await page.waitForTimeout(200);
    const dockSceneLeft = await dockState();
    check('docking the scene panel left moves it to the left edge and persists',
      dockSceneLeft.scene === 'left' && dockSceneLeft.sceneLeft === 0 &&
      dockSceneLeft.sceneWidth === 340 && dockSceneLeft.sceneBtnActive &&
      dockSceneLeft.stored && dockSceneLeft.stored.scene === 'left' &&
      dockSceneLeft.stored.logic === 'right',
      JSON.stringify(dockSceneLeft));
    // Drag the left-docked handle 120px right: the panel widens
    // to 460 from its free edge.
    const dockHandle = await page.locator('#scene-panel-resizer').boundingBox();
    await page.mouse.move(dockHandle.x + dockHandle.width / 2, dockHandle.y + 200);
    await page.mouse.down();
    await page.mouse.move(dockHandle.x + dockHandle.width / 2 + 120, dockHandle.y + 200, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const dockAfterDrag = await dockState();
    check('dragging the left-docked scene handle widens it to 460',
      dockAfterDrag.sceneWidth === 460 && dockAfterDrag.sceneLeft === 0,
      JSON.stringify(dockAfterDrag));
    // Double-click the handle: back to the default width.
    await page.dblclick('#scene-panel-resizer');
    await page.waitForTimeout(200);
    const dockAfterReset = await dockState();
    check('double-clicking the docked handle resets it to 340',
      dockAfterReset.sceneWidth === 340 && dockAfterReset.sceneLeft === 0,
      JSON.stringify(dockAfterReset));
    // Dock the scene panel back right.
    await page.click('#scene-panel-dock-btn');
    await page.waitForTimeout(200);
    const dockSceneRight = await dockState();
    check('docking the scene panel back right restores it and persists',
      dockSceneRight.scene === 'right' && dockSceneRight.sceneLeft === 1400 - 340 &&
      dockSceneRight.sceneWidth === 340 && !dockSceneRight.sceneBtnActive &&
      dockSceneRight.stored && dockSceneRight.stored.scene === 'right',
      JSON.stringify(dockSceneRight));
    // Logic tab: dock left, ArrowLeft narrows 10px, Home resets.
    await page.click('.tab[data-tab="script-tab"]');
    await page.waitForSelector('#grid', { timeout: 10000 });
    await page.click('#logic-panel-dock-btn');
    await page.waitForTimeout(200);
    const dockLogicLeft = await dockState();
    check('docking the logic panel left moves it to the left edge and persists',
      dockLogicLeft.logic === 'left' && dockLogicLeft.logicLeft === 0 &&
      dockLogicLeft.logicBtnActive &&
      dockLogicLeft.stored && dockLogicLeft.stored.logic === 'left',
      JSON.stringify(dockLogicLeft));
    await page.focus('#logic-panel-resizer');
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(200);
    const dockLogicNarrow = await dockState();
    const dockLogicNarrowWidths = await panelWidths();
    check('ArrowLeft on the left-docked logic handle narrows it by 10px',
      dockLogicNarrow.logicVar === '310px' &&
      dockLogicNarrowWidths.stored && dockLogicNarrowWidths.stored.logic === 310,
      JSON.stringify({ ...dockLogicNarrow, storedWidths: dockLogicNarrowWidths.stored }));
    await page.keyboard.press('Home');
    await page.waitForTimeout(200);
    const dockLogicHome = await dockState();
    const dockLogicHomeWidths = await panelWidths();
    check('Home on the logic handle resets it to 320',
      dockLogicHome.logicVar === '320px' &&
      dockLogicHomeWidths.stored && dockLogicHomeWidths.stored.logic === 320,
      JSON.stringify({ ...dockLogicHome, storedWidths: dockLogicHomeWidths.stored }));
    // A reload restores stored dock sides: scene left, logic 330.
    // Each step needs its own tab: the scene dock button lives on
    // the Scene tab, the logic resizer on the Logic tab.
    await page.click('.tab[data-tab="scene-tab"]');
    await page.waitForTimeout(200);
    await page.click('#scene-panel-dock-btn');
    await page.click('.tab[data-tab="script-tab"]');
    await page.waitForSelector('#grid', { timeout: 10000 });
    await page.focus('#logic-panel-resizer');
    await page.keyboard.press('ArrowRight');
    await reloadPage(page, { waitUntil: 'domcontentloaded' });
    await page.click('.tab[data-tab="scene-tab"]');
    await page.waitForTimeout(300);
    const dockAfterReload = await dockState();
    const dockAfterReloadWidths = await panelWidths();
    // dockState().stored holds the dock SIDES ({scene, logic} strings);
    // the stored WIDTHS live in panelWidths().stored (cycle 23: this
    // check read the width off the sides store, so 'left' === 330
    // could never pass even though the 330px width restored fine).
    check('a reload restores the stored dock sides (scene left, logic 330)',
      dockAfterReload.scene === 'left' && dockAfterReload.sceneLeft === 0 &&
      dockAfterReload.logicVar === '330px' &&
      dockAfterReload.stored && dockAfterReload.stored.scene === 'left' &&
      dockAfterReload.stored.logic === 'left' &&
      dockAfterReloadWidths.stored && dockAfterReloadWidths.stored.logic === 330,
      JSON.stringify({ ...dockAfterReload, storedWidths: dockAfterReloadWidths.stored }));
    // Back to right-docked defaults on both panels.
    await page.click('#scene-panel-dock-btn');
    await page.click('.tab[data-tab="script-tab"]');
    await page.waitForSelector('#grid', { timeout: 10000 });
    await page.click('#logic-panel-dock-btn');
    await page.focus('#logic-panel-resizer');
    await page.keyboard.press('Home');
    await page.click('.tab[data-tab="scene-tab"]');
    await page.waitForTimeout(200);
    const dockDefaults = await dockState();
    check('panels return to right-docked defaults after the reload check',
      dockDefaults.scene === 'right' && dockDefaults.logic === 'right' &&
      dockDefaults.sceneLeft === 1400 - 340 && dockDefaults.sceneWidth === 340 &&
      dockDefaults.logicVar === '320px' && !dockDefaults.sceneBtnActive && !dockDefaults.logicBtnActive,
      JSON.stringify(dockDefaults));

    // ---- P5 core-engine track, item P5-8 (pro editor shell, pass 2,
    // slice b): outliner + details polish. The Hierarchy tab groups
    // the scene's objects by layer under collapsible headers; each
    // row carries an eye (starting visibility) and a lock (canvas
    // drag), double-click renames, and arrow keys walk the rows.
    // The Inspector opens with a kind, layer, and id summary and
    // mirrors the eye and lock. Leaves the coin visible, unlocked,
    // named coin, at X 520.
    // Its own browser context with a fresh collector project: the
    // main page's collector has collected objects from every earlier
    // section by now (panels, 3D objects, tilemaps, sprites, joints),
    // so its Hierarchy no longer holds the pristine 6-object scene
    // this section is written against (cycle 23: 21 rows, a Layer 20
    // group, and a covering object that ate the locked-drag
    // mousedown, so the drag selected the wrong object and the
    // rename step never found its input). A separate context keeps
    // its storage apart, the same pattern as hub2/hub3 and the
    // inspector page.
    const outCtx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const out = await outCtx.newPage();
    await goto(out, `http://localhost:${PORT}/home.html`, { waitUntil: 'domcontentloaded' });
    await out.click('#new-project-btn-main');
    await out.fill('#project-name-input', 'Outliner Smoke Game');
    await out.click('.template-card[data-template="collector"]');
    await Promise.all([
      out.waitForURL(/index\.html/, { timeout: 15000 }),
      out.click('#create-project-btn')
    ]);
    check('editor opens for the outliner project', /index\.html/.test(out.url()), out.url());
    const openHierarchy = async () => {
      await out.click('.tab[data-tab="scene-tab"]');
      await out.click('.inspector-tab[data-inspector-tab="objects"]');
      await out.waitForSelector('#scene-object-list .object-list-item', { timeout: 5000 });
    };
    const outlinerState = async () => out.evaluate(() => {
      const list = document.getElementById('scene-object-list');
      const rows = [...(list?.querySelectorAll('.object-list-item') || [])];
      const coin = rows.find(r => r.dataset.objectId === '2');
      const coinStage = document.querySelector('.game-object[data-id="2"]');
      return {
        count: rows.length,
        groupLabels: [...(list?.querySelectorAll('.object-list-group-label') || [])].map(el => el.textContent.trim()),
        groupCollapsed: [...(list?.querySelectorAll('.object-list-group') || [])].map(el => el.classList.contains('collapsed')),
        rowNames: rows.map(r => r.querySelector('.object-list-name')?.textContent?.trim() || ''),
        activeName: list?.querySelector('.object-list-item.active .object-list-name')?.textContent?.trim() || '',
        coinHidden: coin ? coin.classList.contains('is-hidden') : false,
        coinLocked: coin ? coin.classList.contains('is-locked') : false,
        coinDisplay: coinStage ? getComputedStyle(coinStage).display : 'missing',
        summary: document.querySelector('.object-details-summary')?.textContent?.trim() || '',
        coinX: document.querySelector('#object-properties input[data-prop="posX"]')?.value || '',
        inspectorTab: document.querySelector('.inspector-tab.active')?.dataset.inspectorTab || ''
      };
    });
    await openHierarchy();
    const outStart = await outlinerState();
    check('Hierarchy groups the 6 objects by layer (L20, L5, L4, L3)',
      outStart.count === 6 &&
      JSON.stringify(outStart.groupLabels) === JSON.stringify(['Layer 20 · 3 objects', 'Layer 5 · 1 object', 'Layer 4 · 1 object', 'Layer 3 · 1 object']) &&
      JSON.stringify(outStart.rowNames) === JSON.stringify(['scoreLabel', 'scoreText', 'hint', 'player', 'hazard', 'coin']),
      JSON.stringify(outStart));
    // Collapse the Layer 3 group: the coin row leaves the list.
    await out.locator('.object-list-group:has(.object-list-group-label:text-is("Layer 3 · 1 object"))').click();
    await out.waitForTimeout(200);
    const outCollapsed = await outlinerState();
    check('collapsing the Layer 3 group hides its row',
      outCollapsed.count === 5 && outCollapsed.groupCollapsed[3] === true &&
      !outCollapsed.rowNames.includes('coin'),
      JSON.stringify(outCollapsed));
    // A reload keeps the group collapsed.
    await reloadPage(out, { waitUntil: 'domcontentloaded' });
    await openHierarchy();
    const outReload = await outlinerState();
    check('a reload keeps the Layer 3 group collapsed',
      outReload.count === 5 && outReload.groupCollapsed[3] === true,
      JSON.stringify(outReload));
    // Expand it again.
    await out.locator('.object-list-group:has(.object-list-group-label:text-is("Layer 3 · 1 object"))').click();
    await out.waitForTimeout(200);
    const outExpanded = await outlinerState();
    check('expanding the Layer 3 group brings the coin row back',
      outExpanded.count === 6 && outExpanded.groupCollapsed[3] === false &&
      outExpanded.rowNames.includes('coin'),
      JSON.stringify(outExpanded));
    // Select the coin: the Inspector opens with its summary and X.
    await out.locator('.object-list-item[data-object-id="2"]').click();
    await out.waitForTimeout(400);
    const outSelected = await outlinerState();
    check('selecting the coin shows its Inspector summary and X 520',
      outSelected.activeName === 'coin' && outSelected.inspectorTab === 'inspect' &&
      outSelected.summary === 'sprite · Layer 3 · #2' && outSelected.coinX === '520',
      JSON.stringify(outSelected));
    // The eye hides the coin on the stage and dims its row; a
    // second click brings it back.
    await out.click('.inspector-tab[data-inspector-tab="objects"]');
    await out.locator('.object-list-item[data-object-id="2"] .object-list-eye').click();
    await out.waitForTimeout(200);
    const outHidden = await outlinerState();
    check('the eye hides the coin on the stage and dims its row',
      outHidden.coinHidden === true && outHidden.coinDisplay === 'none',
      JSON.stringify(outHidden));
    await out.locator('.object-list-item[data-object-id="2"] .object-list-eye').click();
    await out.waitForTimeout(200);
    const outShown = await outlinerState();
    check('the eye again brings the coin back',
      outShown.coinHidden === false && outShown.coinDisplay !== 'none',
      JSON.stringify(outShown));
    // The lock blocks a canvas drag; unlocked, the same drag moves
    // the coin and a drag back restores it (snap is 20px).
    await out.locator('.object-list-item[data-object-id="2"] .object-list-lock').click();
    await out.waitForTimeout(200);
    const outLocked = await outlinerState();
    check('the lock marks the coin row locked', outLocked.coinLocked === true,
      JSON.stringify(outLocked));
    const coinBox = await out.locator('.game-object[data-id="2"]').boundingBox();
    await out.mouse.move(coinBox.x + coinBox.width / 2, coinBox.y + coinBox.height / 2);
    await out.mouse.down();
    await out.mouse.move(coinBox.x + coinBox.width / 2 + 80, coinBox.y + coinBox.height / 2, { steps: 8 });
    await out.mouse.up();
    await out.waitForTimeout(200);
    const outDragLocked = await outlinerState();
    check('a locked coin does not move on a canvas drag (X stays 520)',
      outDragLocked.coinX === '520', JSON.stringify(outDragLocked));
    await out.locator('.object-list-item[data-object-id="2"] .object-list-lock').click();
    await out.waitForTimeout(200);
    const coinBox2 = await out.locator('.game-object[data-id="2"]').boundingBox();
    await out.mouse.move(coinBox2.x + coinBox2.width / 2, coinBox2.y + coinBox2.height / 2);
    await out.mouse.down();
    await out.mouse.move(coinBox2.x + coinBox2.width / 2 + 80, coinBox2.y + coinBox2.height / 2, { steps: 8 });
    await out.mouse.up();
    await out.waitForTimeout(200);
    const outDragged = await outlinerState();
    check('an unlocked coin drags 80px on the canvas (X 600)',
      outDragged.coinX === '600', JSON.stringify(outDragged));
    const coinBox3 = await out.locator('.game-object[data-id="2"]').boundingBox();
    await out.mouse.move(coinBox3.x + coinBox3.width / 2, coinBox3.y + coinBox3.height / 2);
    await out.mouse.down();
    await out.mouse.move(coinBox3.x + coinBox3.width / 2 - 80, coinBox3.y + coinBox3.height / 2, { steps: 8 });
    await out.mouse.up();
    await out.waitForTimeout(200);
    const outDragBack = await outlinerState();
    check('dragging the coin back restores X 520',
      outDragBack.coinX === '520', JSON.stringify(outDragBack));
    // Double-click renames the coin, and back again.
    await out.click('.inspector-tab[data-inspector-tab="objects"]');
    await out.locator('.object-list-item[data-object-id="2"] .object-list-name').dblclick();
    await out.waitForTimeout(200);
    await out.locator('.object-list-item[data-object-id="2"] .object-list-rename').fill('goldCoin');
    await out.keyboard.press('Enter');
    await out.waitForTimeout(200);
    const outRenamed = await outlinerState();
    check('double-click renames the coin to goldCoin',
      outRenamed.rowNames.includes('goldCoin') && !outRenamed.rowNames.includes('coin'),
      JSON.stringify(outRenamed));
    await out.locator('.object-list-item[data-object-id="2"] .object-list-name').dblclick();
    await out.waitForTimeout(200);
    await out.locator('.object-list-item[data-object-id="2"] .object-list-rename').fill('coin');
    await out.keyboard.press('Enter');
    await out.waitForTimeout(200);
    const outRenamedBack = await outlinerState();
    check('renaming it back restores the name coin',
      outRenamedBack.rowNames.includes('coin') && !outRenamedBack.rowNames.includes('goldCoin'),
      JSON.stringify(outRenamedBack));
    // Arrow keys walk the rows; Enter opens the Inspector. The rows
    // run highest layer first, so the coin is last: ArrowUp from it
    // goes to hazard, ArrowDown comes back to the coin.
    await out.focus('#scene-object-list');
    await out.keyboard.press('ArrowUp');
    await out.waitForTimeout(200);
    const afterOutlinerUp = await outlinerState();
    check('ArrowUp moves the selection to hazard',
      afterOutlinerUp.activeName === 'hazard', JSON.stringify(afterOutlinerUp));
    await out.keyboard.press('ArrowDown');
    await out.waitForTimeout(200);
    const afterOutlinerDown = await outlinerState();
    check('ArrowDown moves the selection back to coin',
      afterOutlinerDown.activeName === 'coin', JSON.stringify(afterOutlinerDown));
    await out.keyboard.press('Enter');
    await out.waitForTimeout(400);
    const afterOutlinerEnter = await outlinerState();
    check('Enter opens the Inspector for the selected object',
      afterOutlinerEnter.inspectorTab === 'inspect' && afterOutlinerEnter.activeName === 'coin',
      JSON.stringify(afterOutlinerEnter));
    // Final state: all six objects listed, the coin visible,
    // unlocked, named coin, at X 520.
    await out.click('.inspector-tab[data-inspector-tab="objects"]');
    const outFinal = await outlinerState();
    check('outliner leaves the scene untouched: 6 objects, coin visible, unlocked, coin at 520',
      outFinal.count === 6 && outFinal.coinHidden === false && outFinal.coinLocked === false &&
      outFinal.rowNames.includes('coin') && outFinal.coinX === '520',
      JSON.stringify(outFinal));

    await outCtx.close();

    // ---- P5 core-engine track, item P5-8 (pro editor shell, pass 2,
    // slice c): compact-density option for blocks. The "Compact blocks"
    // toggle in the Logic tab's command bar shrinks the grid cells
    // from 56px to 44px, the block labels shrink with them, and the
    // puzzle-piece SVGs scale with their cell instead of spilling
    // past it. The choice persists across reloads. Leaves the grid
    // back at the comfortable 56px default. (The background grid has
    // two layers, horizontal + vertical lines, so its computed size
    // lists both: '56px 56px, 56px 56px'.)
    await page.click('.tab[data-tab="script-tab"]');
    await page.waitForSelector('#grid', { timeout: 10000 });
    const densityState = async () => page.evaluate(() => {
      const BD = window.HydraBlockDensity;
      const cell = document.querySelector('#grid .cell');
      const container = document.querySelector('.grid-container');
      const placed = document.querySelector('#grid [data-block-type]');
      const svg = document.querySelector('#grid .cell.puzzle-block .puzzle-shape');
      const btn = document.getElementById('block-density-btn');
      return {
        density: document.querySelector('.grid-editor')?.getAttribute('data-block-density') || '',
        cellW: cell ? Math.round(cell.getBoundingClientRect().width) : -1,
        cellH: cell ? Math.round(cell.getBoundingClientRect().height) : -1,
        bgSize: container ? getComputedStyle(container).backgroundSize : '',
        labelFont: placed ? getComputedStyle(placed, '::after').fontSize : '',
        svgW: svg ? Math.round(svg.getBoundingClientRect().width) : -1,
        stored: BD ? BD.readStoredDensity(window.localStorage) : null,
        btnActive: btn ? btn.classList.contains('active') : false,
        btnLabel: btn?.querySelector('span')?.textContent?.trim() || ''
      };
    });
    const densityStart = await densityState();
    check('blocks start comfortable: 56px cells, 56px background grid, stored comfortable',
      densityStart.density === 'comfortable' && densityStart.cellW === 56 && densityStart.cellH === 56 &&
      densityStart.bgSize === '56px 56px, 56px 56px' && !densityStart.btnActive &&
      densityStart.btnLabel === 'Compact blocks' && densityStart.stored === 'comfortable',
      JSON.stringify(densityStart));
    // Compact: cells shrink to 44px, labels to 8px, puzzle SVGs scale
    // to the cell instead of staying 56px wide.
    await page.click('#block-density-btn');
    await page.waitForTimeout(200);
    const densityCompact = await densityState();
    check('Compact blocks shrinks cells to 44px, labels to 8px, SVGs to 44px, and persists',
      densityCompact.density === 'compact' && densityCompact.cellW === 44 && densityCompact.cellH === 44 &&
      densityCompact.bgSize === '44px 44px, 44px 44px' && densityCompact.labelFont === '8px' &&
      densityCompact.svgW === 44 && densityCompact.btnActive &&
      densityCompact.btnLabel === 'Comfortable blocks' && densityCompact.stored === 'compact',
      JSON.stringify(densityCompact));
    // A reload restores the stored compact density.
    await reloadPage(page, { waitUntil: 'domcontentloaded' });
    await page.click('.tab[data-tab="script-tab"]');
    await page.waitForSelector('#grid', { timeout: 10000 });
    const densityReload = await densityState();
    check('a reload restores the stored compact density',
      densityReload.density === 'compact' && densityReload.cellW === 44 &&
      densityReload.btnActive && densityReload.stored === 'compact',
      JSON.stringify(densityReload));
    // Back to the comfortable default.
    await page.click('#block-density-btn');
    await page.waitForTimeout(200);
    const densityBack = await densityState();
    check('toggling back restores comfortable 56px cells and persists',
      densityBack.density === 'comfortable' && densityBack.cellW === 56 && densityBack.cellH === 56 &&
      densityBack.bgSize === '56px 56px, 56px 56px' && !densityBack.btnActive &&
      densityBack.btnLabel === 'Compact blocks' && densityBack.stored === 'comfortable',
      JSON.stringify(densityBack));

    // ---- P5 core-engine track, item P5-9 (the build-the-editor test):
    // the Variable Inspector template in the live editor and preview.
    // The template is a real game built only from blocks: it lists
    // score, coins, goblin HP, and a name, edits them with - / +
    // buttons or by typing a number, and watches them change live.
    // Its home card must exist (a template with no card is unreachable),
    // the Logic tab must carry the Read Text Into Variable block, the
    // buttons must be real Button components (plain text objects never
    // draw a background, so they render as bare glyphs), and the
    // preview must play end to end: + once, - twice, type 42, Set.
    // Its own browser context, for the same reason as hub2/hub3:
    // creating the inspector writes its id as the current project in
    // localStorage, and a shared context would make a later main-page
    // reload open the inspector instead of the collector.
    const inspCtx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const insp = await inspCtx.newPage();
    const inspErrors = [];
    insp.on('pageerror', e => inspErrors.push(String(e && e.message || e)));
    await goto(insp, `http://localhost:${PORT}/home.html`, { waitUntil: 'domcontentloaded' });
    await insp.click('#new-project-btn-main');
    await insp.fill('#project-name-input', 'Inspector Smoke Game');
    check('variable-inspector template card exists in the gallery',
      await insp.locator('.template-card[data-template="variable-inspector"]').count() === 1);
    await insp.click('.template-card[data-template="variable-inspector"]');
    await Promise.all([
      insp.waitForURL(/index\.html/, { timeout: 15000 }),
      insp.click('#create-project-btn')
    ]);
    check('editor opens for the inspector project', /index\.html/.test(insp.url()), insp.url());
    const inspObjects = await insp.evaluate(() => (window.scenes?.[0]?.objects || []).map(o => o.name));
    check('inspector scene ships the panel objects (values, buttons, input, box, hints)',
      ['player', 'coin', 'goblin', 'scoreText', 'scoreMinus', 'scorePlus', 'hpText',
       'scoreInput', 'scoreInputBox', 'scoreSetBtn', 'scoreClearBtn', 'hint', 'hint2']
        .every(n => inspObjects.includes(n)),
      inspObjects.join(','));
    const inspButtonsReal = await insp.evaluate(() =>
      (window.scenes?.[0]?.objects || [])
        .filter(o => /Minus|Plus|SetBtn|ClearBtn/.test(o.name))
        .every(o => (o.components || []).some(c => c === 'Button' || c.type === 'Button')));
    check('inspector - / + / Set / Clear are real Button components (they draw a fill)',
      inspButtonsReal);
    await insp.click('.tab[data-tab="script-tab"]');
    await insp.waitForSelector('#grid', { timeout: 10000 });
    check('inspector grid carries the Read Text Into Variable block',
      await insp.locator('#grid [data-block-type="read-text-into-variable"]').count() === 1);
    await insp.click('.tab[data-tab="preview-tab"]');
    await insp.waitForSelector('#game-canvas', { timeout: 10000 });
    const inspLabels = () => insp.evaluate(() => {
      const t = (n) => {
        const o = (previewState.objects || []).find(x => x.name === n);
        return o ? (o._runtimeText !== undefined ? o._runtimeText : (o.text || '')) : null;
      };
      return { score: t('scoreText'), coins: t('coinsText'), hp: t('hpText'), name: t('nameText'), input: t('scoreInput') };
    });
    await insp.waitForFunction(() => {
      const o = (previewState.objects || []).find(x => x.name === 'scoreText');
      return o && (o._runtimeText !== undefined ? o._runtimeText : o.text) === '0';
    }, null, { timeout: 10000 });
    const inspStart = await inspLabels();
    check('inspector preview opens on the starting values (score 0, coins 0, hp 30, name Ky, input empty)',
      inspStart.score === '0' && inspStart.coins === '0' && inspStart.hp === '30' &&
      inspStart.name === 'Ky' && inspStart.input === '', JSON.stringify(inspStart));
    // Click a button by world coordinates: the canvas shows the 800x600
    // world scaled to its displayed box, so map through the box.
    const inspClickWorld = async (wx, wy) => {
      const b = await insp.locator('#game-canvas').boundingBox();
      await insp.mouse.click(b.x + wx * (b.width / 800), b.y + wy * (b.height / 600));
      await insp.waitForTimeout(300);
    };
    await inspClickWorld(236, 65); // scorePlus centre
    await insp.waitForFunction(() => {
      const o = (previewState.objects || []).find(x => x.name === 'scoreText');
      return o && (o._runtimeText !== undefined ? o._runtimeText : o.text) === '1';
    }, null, { timeout: 10000 });
    check('inspector preview + button raises the score to 1', (await inspLabels()).score === '1');
    await inspClickWorld(194, 65); // scoreMinus centre
    await inspClickWorld(194, 65);
    await insp.waitForFunction(() => {
      const o = (previewState.objects || []).find(x => x.name === 'scoreText');
      return o && (o._runtimeText !== undefined ? o._runtimeText : o.text) === '-1';
    }, null, { timeout: 10000 });
    check('inspector preview - button twice lowers the score to -1', (await inspLabels()).score === '-1');
    await insp.keyboard.press('Digit4');
    await insp.waitForTimeout(200);
    await insp.keyboard.press('Digit2');
    await insp.waitForFunction(() => {
      const o = (previewState.objects || []).find(x => x.name === 'scoreInput');
      return o && (o._runtimeText !== undefined ? o._runtimeText : o.text) === '42';
    }, null, { timeout: 10000 });
    check('inspector preview typing 4 then 2 shows 42 in the input', (await inspLabels()).input === '42');
    await inspClickWorld(290, 229); // scoreSetBtn centre
    await insp.waitForFunction(() => {
      const s = (previewState.objects || []).find(x => x.name === 'scoreText');
      const i = (previewState.objects || []).find(x => x.name === 'scoreInput');
      const sv = s ? (s._runtimeText !== undefined ? s._runtimeText : s.text) : null;
      const iv = i ? (i._runtimeText !== undefined ? i._runtimeText : i.text) : null;
      return sv === '42' && iv === '';
    }, null, { timeout: 10000 });
    const inspSet = await inspLabels();
    check('inspector preview Set copies the typed 42 into the score and clears the input',
      inspSet.score === '42' && inspSet.input === '', JSON.stringify(inspSet));
    check('no page errors on the inspector page', inspErrors.length === 0, inspErrors.slice(0, 3).join(' | '));
    await insp.close();
    await inspCtx.close();

    // ---- P5 core-engine track, item P5-2 (pro editor shell, pass 1,
    // slice b): denser panels + smaller professional type scale.
    // Computed-style probes on the live editor: the Scene tab measures
    // the header, the inspector tabs, and the Create panel; the Logic
    // tab measures the block palette side panel. Leaves the editor on
    // the Scene tab, like the status-bar section did.
    const densityScene = await page.evaluate(() => {
      const cs = (el) => el ? getComputedStyle(el) : null;
      const header = document.querySelector('.scene-side-panel .panel-section-header');
      return {
        logo: cs(document.querySelector('.logo h1'))?.fontSize,
        tab: cs(document.querySelector('.tab'))?.fontSize,
        projectName: cs(document.getElementById('project-name'))?.fontSize,
        sidePanel: cs(document.querySelector('.scene-side-panel'))?.paddingTop,
        section: cs(document.querySelector('.scene-side-panel .panel-section'))?.paddingTop,
        sectionHeader: cs(header)?.paddingBottom,
        sectionTitle: cs(header?.querySelector('h3'))?.fontSize,
        inspectorTab: cs(document.querySelector('.inspector-tab'))?.minHeight,
        createBtn: cs(document.querySelector('.object-create-btn'))?.paddingTop,
        hint: cs(document.querySelector('.scene-side-panel .hint-text'))?.fontSize,
        propInput: cs(document.getElementById('new-object-kind'))?.fontSize
      };
    });
    check('dense shell: header wordmark 16px, tabs 12px, project name 13px',
      densityScene.logo === '16px' && densityScene.tab === '12px' &&
      densityScene.projectName === '13px', JSON.stringify(densityScene));
    check('dense shell: scene side panel and sections are 8px',
      densityScene.sidePanel === '8px' && densityScene.section === '8px',
      JSON.stringify(densityScene));
    check('dense shell: section headers have 6px below, titles stay 11px',
      densityScene.sectionHeader === '6px' && densityScene.sectionTitle === '11px',
      JSON.stringify(densityScene));
    check('dense shell: inspector tabs are 30px min-height',
      densityScene.inspectorTab === '30px', JSON.stringify(densityScene));
    check('dense shell: create buttons are 7px rows, hints 11px, inputs 12px',
      densityScene.createBtn === '7px' && densityScene.hint === '11px' &&
      densityScene.propInput === '12px', JSON.stringify(densityScene));
    // Logic tab: the block palette side panel. The first category label
    // carries a :first-child padding-top reset, so measure the second.
    await page.click('.tab[data-tab="script-tab"]');
    await page.waitForSelector('.side-panel .block-option', { timeout: 10000 });
    const densityLogic = await page.evaluate(() => {
      const cs = (el) => el ? getComputedStyle(el) : null;
      const labels = document.querySelectorAll('.block-category-label');
      return {
        sidePanel: cs(document.querySelector('.side-panel'))?.paddingTop,
        blockOption: cs(document.querySelector('.block-option'))?.paddingTop,
        category: cs(labels[1])?.paddingTop,
        blockLabel: cs(document.querySelector('.block-label'))?.fontSize
      };
    });
    check('dense shell: logic side panel is 12px, block rows are 7px',
      densityLogic.sidePanel === '12px' && densityLogic.blockOption === '7px',
      JSON.stringify(densityLogic));
    check('dense shell: category labels have 6px top padding, block labels stay 12px',
      densityLogic.category === '6px' && densityLogic.blockLabel === '12px',
      JSON.stringify(densityLogic));
    await page.click('.tab[data-tab="scene-tab"]');

    // ---- P4 Advanced batch 27: moving platforms & one-way platforms — module,
    // palette blocks under the Platform category, placement + panels,
    // Inspector Platform section ----
    const hydraPlatformLoaded = await page.evaluate(() =>
      typeof window.HydraPlatform !== 'undefined' &&
      typeof window.HydraPlatform.createPlatformState === 'function' &&
      typeof window.HydraPlatform.updatePlatforms === 'function' &&
      typeof window.HydraPlatform.setPlatformPath === 'function' &&
      typeof window.HydraPlatform.setOneWay === 'function' &&
      typeof window.HydraPlatform.setCrumbleTime === 'function' &&
      typeof window.HydraPlatform.isMovingPlatform === 'function' &&
      typeof window.HydraPlatform.isOneWayPlatform === 'function' &&
      typeof window.HydraPlatform.isPlatformAction === 'function' &&
      typeof window.HydraPlatform.isPlatformCondition === 'function' &&
      typeof window.HydraPlatform.platformUnder === 'function' &&
      typeof window.HydraPlatform.standsOn === 'function');
    check('HydraPlatform module is loaded in the editor', hydraPlatformLoaded);
    await page.click('.tab[data-tab="script-tab"]');
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const platformBlocks = await page.evaluate(() =>
      ['set-platform-path', 'set-one-way', 'set-crumble-time', 'standing-on-platform', 'standing-on-oneway'].every(t =>
        !!document.querySelector(`.block-selector .block-option[data-block-type="${t}"]`)));
    check('All five platform blocks are in the palette', platformBlocks);
    const platformCategory = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const catIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'Platform');
      if (catIdx === -1) return 'no Platform label';
      const after = items.slice(catIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      const inCat = (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type'));
      return ['set-platform-path', 'set-one-way', 'set-crumble-time', 'standing-on-platform', 'standing-on-oneway']
        .every(t => inCat.includes(t)) ? 'ok' :
        'missing under Platform (Platform holds ' + JSON.stringify(inCat) + ')';
    });
    check('All five platform blocks sit under the Platform palette category (not under a later heading)',
      platformCategory === 'ok', platformCategory);
    const platformOrder = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.block-selector .block-category-label, .block-selector .block-option')];
      const catIdx = items.findIndex(el =>
        el.classList.contains('block-category-label') && el.textContent.trim() === 'Platform');
      const after = items.slice(catIdx + 1);
      const nextLabel = after.findIndex(el => el.classList.contains('block-category-label'));
      return (nextLabel === -1 ? after : after.slice(0, nextLabel))
        .map(el => el.getAttribute('data-block-type'))
        .filter(t => ['set-platform-path', 'set-one-way', 'set-crumble-time', 'standing-on-platform', 'standing-on-oneway'].includes(t))
        .join(',');
    });
    check('Platform blocks sit in Set Platform Path / Set One-Way / Set Crumble Time / Standing On Platform / Standing On One-Way order in the palette',
      platformOrder === 'set-platform-path,set-one-way,set-crumble-time,standing-on-platform,standing-on-oneway', platformOrder);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('.block-selector .block-category-label')]
        .find(e => e.textContent.trim() === 'Platform');
      if (el) el.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(300);
    const setPlatformPathBefore = await page.locator('#grid [data-block-type="set-platform-path"]').count();
    await page.click('.block-selector .block-option[data-block-type="set-platform-path"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-platform-path"]').length > n,
      setPlatformPathBefore);
    const setPlatformPathCell = page.locator('#grid [data-block-type="set-platform-path"]').first();
    check('Set Platform Path block places on the grid', await setPlatformPathCell.count() === 1);
    await setPlatformPathCell.click();
    await page.waitForTimeout(400);
    const setPlatformPathPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Set Platform Path panel offers Object / Point 1 X / Point 2 X / Speed / Mode fields',
      /Object/i.test(setPlatformPathPropText) && /Point 1 X/i.test(setPlatformPathPropText) &&
      /Point 2 X/i.test(setPlatformPathPropText) && /Speed/i.test(setPlatformPathPropText) &&
      /Mode/i.test(setPlatformPathPropText),
      setPlatformPathPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const setOneWayBefore = await page.locator('#grid [data-block-type="set-one-way"]').count();
    await page.click('.block-selector .block-option[data-block-type="set-one-way"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-one-way"]').length > n,
      setOneWayBefore);
    const setOneWayCell = page.locator('#grid [data-block-type="set-one-way"]').first();
    check('Set One-Way Platform block places on the grid', await setOneWayCell.count() === 1);
    await setOneWayCell.click();
    await page.waitForTimeout(400);
    const setOneWayPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Set One-Way Platform panel offers Object / One-way fields',
      /Object/i.test(setOneWayPropText) && /One-way/i.test(setOneWayPropText),
      setOneWayPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const standingOnPlatformBefore = await page.locator('#grid [data-block-type="standing-on-platform"]').count();
    await page.click('.block-selector .block-option[data-block-type="standing-on-platform"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="standing-on-platform"]').length > n,
      standingOnPlatformBefore);
    const standingOnPlatformCell = page.locator('#grid [data-block-type="standing-on-platform"]').first();
    check('Standing On Platform block places on the grid', await standingOnPlatformCell.count() === 1);
    await standingOnPlatformCell.click();
    await page.waitForTimeout(400);
    const standingOnPlatformPropText = await page.evaluate(() =>
      document.getElementById('properties-panel')?.innerText || '');
    check('Standing On Platform panel offers Object / Invert fields',
      /Object/i.test(standingOnPlatformPropText) && /Invert/i.test(standingOnPlatformPropText),
      standingOnPlatformPropText.slice(0, 300));
    await page.click('#back-to-blocks-btn');
    const setCrumbleTimeBefore = await page.locator('#grid [data-block-type="set-crumble-time"]').count();
    await page.click('.block-selector .block-option[data-block-type="set-crumble-time"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-crumble-time"]').length > n,
      setCrumbleTimeBefore);
    check('Set Crumble Time block places on the grid',
      await page.locator('#grid [data-block-type="set-crumble-time"]').count() > setCrumbleTimeBefore);
    await page.click('#back-to-blocks-btn');
    const standingOnOneWayBefore = await page.locator('#grid [data-block-type="standing-on-oneway"]').count();
    await page.click('.block-selector .block-option[data-block-type="standing-on-oneway"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="standing-on-oneway"]').length > n,
      standingOnOneWayBefore);
    check('Standing On One-Way block places on the grid',
      await page.locator('#grid [data-block-type="standing-on-oneway"]').count() > standingOnOneWayBefore);
    await page.click('#back-to-blocks-btn');
    // Inspector Platform section: a plain sprite carries Moving
    // platform, Point 1 X, Speed, and Crumble after.
    await page.click('.tab[data-tab="scene-tab"]');
    await page.click('.inspector-tab[data-inspector-tab="create"]');
    await page.waitForSelector('.object-create-btn[data-create-kind="sprite"]', { timeout: 10000 });
    await page.click('.object-create-btn[data-create-kind="sprite"]');
    await page.waitForFunction(
      () => /Platform/.test(document.getElementById('object-properties')?.innerText || ''),
      { timeout: 5000 }).catch(() => {});
    const platformInsp = await page.evaluate(() =>
      document.getElementById('object-properties')?.innerText || '');
    check('Platform inspector section appears for a sprite',
      /platform/i.test(platformInsp) && /moving platform/i.test(platformInsp) &&
      /point 1 x/i.test(platformInsp) && /speed/i.test(platformInsp) &&
      /crumble after/i.test(platformInsp),
      platformInsp.slice(0, 400));

    // ---- P4 item 36 phase C: flow tracer — module, toolbar toggle,
    // panel feed, grid highlight ----
    const hydraTraceLoaded = await page.evaluate(() =>
      !!window.HydraTrace && typeof window.HydraTrace.createTracer === 'function' &&
      typeof window.HydraTrace.record === 'function' &&
      typeof window.HydraTrace.formatEvent === 'function');
    check('HydraTrace module is loaded in the editor', hydraTraceLoaded);
    // Place an Always block so there is a block guaranteed to fire every
    // frame once the preview runs.
    await page.click('.tab[data-tab="script-tab"]');
    if (await page.locator('#back-to-blocks-btn:visible').count() > 0) {
      await page.click('#back-to-blocks-btn');
    }
    const alwaysBefore = await page.locator('#grid [data-block-type="always-condition"]').count();
    await page.click('.block-selector .block-option[data-block-type="always-condition"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="always-condition"]').length > n,
      alwaysBefore, { timeout: 5000 }).catch(() => {});
    check('Always block places on the grid',
      await page.locator('#grid [data-block-type="always-condition"]').count() > alwaysBefore);
    await page.click('.tab[data-tab="preview-tab"]');
    await page.waitForSelector('#game-canvas', { timeout: 10000 });
    await page.waitForTimeout(1200);
    const traceBtn = page.locator('#preview-trace-btn');
    check('preview toolbar has the Trace toggle button', await traceBtn.count() === 1);
    check('Trace panel starts hidden', await page.evaluate(() =>
      document.getElementById('trace-panel')?.hidden === true));
    await traceBtn.click();
    await page.waitForTimeout(900);
    check('Trace button lights up while tracing is on',
      await traceBtn.evaluate(b => b.classList.contains('active')));
    check('Trace panel shows while tracing is on', await page.evaluate(() =>
      document.getElementById('trace-panel')?.hidden === false));
    const traceFeedText = await page.evaluate(() =>
      document.getElementById('trace-feed')?.innerText || '');
    check('Trace feed lists the firing Always block',
      /trigger always/i.test(traceFeedText), traceFeedText.slice(0, 300));
    const tracedCell = await page.evaluate(() =>
      !!document.querySelector('#grid [data-block-type="always-condition"].traced'));
    check('firing Always block carries the traced grid highlight', tracedCell);
    await traceBtn.click();
    await page.waitForTimeout(500);
    check('Trace button dims again when tracing is off',
      await traceBtn.evaluate(b => !b.classList.contains('active')));
    check('Trace panel hides again when tracing is off', await page.evaluate(() =>
      document.getElementById('trace-panel')?.hidden === true));
    await page.click('.tab[data-tab="script-tab"]');

    // ---- P2 item 14 slice 1: logic-grid data model — pure module,
    // geometry, keyboard nav, scope rules, and save/load routing ----
    const gridModelLive = await page.evaluate(() => {
      const M = window.HydraGridModel;
      if (!M) return null;
      return {
        cols: M.GRID_COLS, rows: M.GRID_ROWS, cells: M.GRID_CELLS,
        moveRight: M.moveIndex(61, 'ArrowRight'),
        moveLeftEdge: M.moveIndex(0, 'ArrowLeft'),
        moveHome: M.moveIndex(65, 'Home'),
        scopeNum: M.normalizeScriptScope('3'),
        scopeBad: M.normalizeScriptScope('nope'),
        sameScope: M.sameScriptScope('3', 3),
        scopeKey: M.getScopeKey(3),
        neighbours: M.adjacentIndexes(61),
        cellCount: document.querySelectorAll('#grid .cell').length
      };
    });
    check('HydraGridModel module is loaded in the editor', gridModelLive !== null);
    check('grid model reports the 60x60 grid live',
      gridModelLive && gridModelLive.cols === 60 && gridModelLive.rows === 60 &&
      gridModelLive.cells === 3600, JSON.stringify(gridModelLive));
    check('grid model keyboard nav works live (right, edge clamp, Home)',
      gridModelLive && gridModelLive.moveRight === 62 &&
      gridModelLive.moveLeftEdge === null && gridModelLive.moveHome === 60,
      JSON.stringify(gridModelLive));
    check('grid model scope rules work live',
      gridModelLive && gridModelLive.scopeNum === 3 && gridModelLive.scopeBad === 'global' &&
      gridModelLive.sameScope === true && gridModelLive.scopeKey === '3',
      JSON.stringify(gridModelLive));
    check('grid model neighbours match the flow reading order live',
      gridModelLive && JSON.stringify(gridModelLive.neighbours) === JSON.stringify([62, 121, 60, 1]),
      JSON.stringify(gridModelLive?.neighbours));
    check('grid still renders 3600 cells after the model routing',
      gridModelLive && gridModelLive.cellCount === 3600, String(gridModelLive?.cellCount));
    // Place a Game Start block, leave the tab (commits the grid through
    // the module's save), come back (loads it through the module) — the
    // block must survive the round trip with its defaults intact.
    const gameStartBefore = await page.locator('#grid [data-block-type="game-start"]').count();
    await page.click('.block-selector .block-option[data-block-type="game-start"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="game-start"]').length > n,
      gameStartBefore, { timeout: 5000 }).catch(() => {});
    check('Game Start block places on the grid (defaults routing)',
      await page.locator('#grid [data-block-type="game-start"]').count() > gameStartBefore);
    await page.click('.tab[data-tab="preview-tab"]');
    await page.waitForTimeout(800);
    await page.click('.tab[data-tab="script-tab"]');
    await page.waitForTimeout(500);
    check('placed block survives a tab switch (save/load routing)',
      await page.locator('#grid [data-block-type="game-start"]').count() > gameStartBefore);

    // ---- P2 item 14 slice 2: property-panel input primitives — DOM module,
    // label binding, and the color / textarea catalog cases ----
    const propInputsLive = await page.evaluate(() => {
      const P = window.HydraPropInputs;
      if (!P) return null;
      return {
        fns: ['configure', 'makePropGroup', 'makeSelect', 'makeNumberInput',
          'makeTextInput', 'makeCheckbox', 'makeColorInput', 'makeTextareaInput',
          'makeNote', 'bindStaticPropGroupLabels'].every(f => typeof P[f] === 'function'),
        factory: typeof P.factorySource === 'string'
      };
    });
    check('HydraPropInputs module is loaded in the editor', propInputsLive !== null);
    check('HydraPropInputs exposes the full builder surface live',
      propInputsLive && propInputsLive.fns === true && propInputsLive.factory === true,
      JSON.stringify(propInputsLive));
    // Set Scene Background carries a color field: its panel must show a
    // labelled color picker whose label points at the input.
    const bgBefore = await page.locator('#grid [data-block-type="set-scene-background"]').count();
    await page.click('.block-selector .block-option[data-block-type="set-scene-background"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-scene-background"]').length > n,
      bgBefore, { timeout: 5000 }).catch(() => {});
    const bgCell = page.locator('#grid [data-block-type="set-scene-background"]').first();
    check('Set Scene Background block places on the grid', await bgCell.count() === 1);
    await bgCell.click();
    const bgPanel = await page.evaluate(() => {
      const group = [...document.querySelectorAll('#properties-panel .property-group')]
        .find(g => /Background color/i.test(g.querySelector('label')?.textContent || ''));
      if (!group) return null;
      const label = group.querySelector('label');
      const input = group.querySelector('input');
      return { forAttr: label?.getAttribute('for') || '', inputId: input?.id || '',
        inputType: input?.type || '' };
    });
    check('Background color label is bound to its color input',
      bgPanel !== null && bgPanel.forAttr !== '' && bgPanel.forAttr === bgPanel.inputId,
      JSON.stringify(bgPanel));
    check('Background color field is a color picker',
      bgPanel !== null && bgPanel.inputType === 'color', JSON.stringify(bgPanel));
    // Comment carries a textarea field: its panel must show a labelled textarea.
    await page.click('#back-to-blocks-btn');
    await page.waitForSelector('.block-selector .block-option[data-block-type="comment-block"]:visible',
      { timeout: 5000 }).catch(() => {});
    const commentBefore = await page.locator('#grid [data-block-type="comment-block"]').count();
    await page.click('.block-selector .block-option[data-block-type="comment-block"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="comment-block"]').length > n,
      commentBefore, { timeout: 5000 }).catch(() => {});
    const commentCell = page.locator('#grid [data-block-type="comment-block"]').first();
    check('Comment block places on the grid', await commentCell.count() === 1);
    await commentCell.click();
    const commentPanel = await page.evaluate(() => {
      const group = [...document.querySelectorAll('#properties-panel .property-group')]
        .find(g => /Comment/i.test(g.querySelector('label')?.textContent || ''));
      if (!group) return null;
      const label = group.querySelector('label');
      const area = group.querySelector('textarea');
      return { forAttr: label?.getAttribute('for') || '', areaId: area?.id || '',
        rows: area?.rows, placeholder: area?.placeholder || '' };
    });
    check('Comment label is bound to its textarea',
      commentPanel !== null && commentPanel.forAttr !== '' &&
      commentPanel.forAttr === commentPanel.areaId, JSON.stringify(commentPanel));
    check('Comment field is a 4-row textarea with its placeholder',
      commentPanel !== null && commentPanel.rows === 4 &&
      /What this event does/.test(commentPanel.placeholder), JSON.stringify(commentPanel));

    // ---- P2 item 14 slice 3: editor-state builders as a module ----
    const propInputsLive3 = await page.evaluate(() => {
      const P = window.HydraPropInputs;
      if (!P) return null;
      return ['makeInvertToggle', 'makeObjectSelect', 'makeActionSelect',
        'makeKeyPicker', 'makeTargetModeSelect', 'makeAnimationNameSelect',
        'makeStateNameSelect', 'makeBlendNameSelect', 'makeExprInput']
        .every(f => typeof P[f] === 'function');
    });
    check('HydraPropInputs exposes the slice-3 builder surface live',
      propInputsLive3 === true);
    // Game Start panel carries the invert toggle.
    const gsCell3 = page.locator('#grid [data-block-type="game-start"]').first();
    await gsCell3.click();
    const invertLive = await page.evaluate(() => {
      const row = document.querySelector('#properties-panel .checkbox-row');
      if (!row) return null;
      const cb = row.querySelector('input[type="checkbox"]');
      return { label: row.textContent.trim(), checked: cb ? cb.checked : null };
    });
    check('Game Start panel offers the Invert condition checkbox',
      invertLive !== null && /Invert condition/.test(invertLive.label) &&
      invertLive.checked === false, JSON.stringify(invertLive));
    // Key Pressed panel carries the key picker with a Record button.
    // (The legacy "condition" palette block — the catalog key presets
    // use the generic catalog panel, which has no key picker.)
    await page.click('#back-to-blocks-btn');
    await page.waitForSelector('.block-selector .block-option[data-block-type="condition"]:visible',
      { timeout: 5000 }).catch(() => {});
    const keyBefore = await page.locator('#grid [data-block-type="condition"]').count();
    await page.click('.block-selector .block-option[data-block-type="condition"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="condition"]').length > n,
      keyBefore, { timeout: 5000 }).catch(() => {});
    const keyCell = page.locator('#grid [data-block-type="condition"]').first();
    check('Key Pressed block places on the grid', await keyCell.count() === 1);
    await keyCell.click();
    const keyPickerLive = await page.evaluate(() => {
      const row = document.querySelector('#properties-panel .key-picker-row');
      if (!row) return null;
      const input = row.querySelector('input');
      const btn = row.querySelector('button');
      return { value: input ? input.value : '', button: btn ? btn.textContent : '' };
    });
    check('Key Pressed panel offers the key picker with a Record button',
      keyPickerLive !== null && keyPickerLive.value === 'ArrowRight' &&
      keyPickerLive.button === 'Record', JSON.stringify(keyPickerLive));
    // Set Variable panel carries an expression input with the fx badge.
    await page.click('#back-to-blocks-btn');
    await page.waitForSelector('.block-selector .block-option[data-block-type="set-variable"]:visible',
      { timeout: 5000 }).catch(() => {});
    const svBefore = await page.locator('#grid [data-block-type="set-variable"]').count();
    await page.click('.block-selector .block-option[data-block-type="set-variable"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="set-variable"]').length > n,
      svBefore, { timeout: 5000 }).catch(() => {});
    const svCell = page.locator('#grid [data-block-type="set-variable"]').first();
    check('Set Variable block places on the grid', await svCell.count() === 1);
    await svCell.click();
    const exprLive = await page.evaluate(() => {
      const wrap = document.querySelector('#properties-panel .expr-input-wrap');
      if (!wrap) return null;
      const input = wrap.querySelector('input.expr-input');
      const badge = wrap.querySelector('.expr-badge');
      return { hasInput: !!input, badge: badge ? badge.textContent : '' };
    });
    check('Set Variable panel offers an expression input with the fx badge',
      exprLive !== null && exprLive.hasInput && exprLive.badge === 'fx',
      JSON.stringify(exprLive));

    // ---- P2 item 14 slice 4: scene stage as a module ----
    const stageLive = await page.evaluate(() => {
      const S = window.HydraStage;
      if (!S) return null;
      return ['configure', 'normalizeSceneDimensions', 'getSceneWorldWidth',
        'getSceneWorldHeight', 'getSceneViewportWidth', 'getSceneViewportHeight',
        'snapValue', 'clampZoom', 'kindName3d', 'applySceneZoom',
        'getScenePointFromEvent', 'updateCameraFrame', 'updateSceneBg',
        'applySceneSize', 'isScene3dScene', 'get3dView', 'set3dView',
        'update3dViewToggle', 'render3dView', 'syncScene3dCameraFields',
        'onScene3dCameraInput', 'syncSceneDarknessFields',
        'onSceneDarknessInput'].every(f => typeof S[f] === 'function');
    });
    check('HydraStage exposes the stage surface live', stageLive === true);
    await page.click('.tab[data-tab="scene-tab"]');
    const stageDims = await page.evaluate(() => {
      const scene = window.getCurrentScene();
      return {
        worldW: window.getSceneWorldWidth(scene),
        worldH: window.getSceneWorldHeight(scene),
        viewW: window.getSceneViewportWidth(scene),
        viewH: window.getSceneViewportHeight(scene),
        frame: (() => {
          const f = document.querySelector('.scene-camera-frame');
          return f ? { w: f.style.width, h: f.style.height } : null;
        })(),
        toggleHidden: document.getElementById('scene-3d-view-toggle')?.style.display,
        zoomReadout: document.getElementById('scene-zoom-readout')?.textContent
      };
    });
    check('stage reports the collector scene dimensions through the module',
      stageDims.worldW === 800 && stageDims.worldH === 600 &&
      stageDims.viewW === 800 && stageDims.viewH === 600, JSON.stringify(stageDims));
    check('camera frame is drawn on the stage',
      stageDims.frame !== null && stageDims.frame.w === '800px' &&
      stageDims.frame.h === '600px', JSON.stringify(stageDims.frame));
    check('3D view toggle stays hidden for a 2D scene',
      stageDims.toggleHidden === 'none', stageDims.toggleHidden);
    check('zoom readout starts at 100%',
      stageDims.zoomReadout === '100%', stageDims.zoomReadout);
    await page.click('#scene-zoom-in-btn');
    const zoomed = await page.evaluate(() => ({
      readout: document.getElementById('scene-zoom-readout')?.textContent,
      transform: document.getElementById('scene-canvas')?.style.transform
    }));
    check('zoom-in button scales the stage through the module',
      zoomed.readout === '110%' && zoomed.transform === 'scale(1.1)',
      JSON.stringify(zoomed));
    await page.click('#scene-zoom-out-btn');
    const zoomedBack = await page.evaluate(() => ({
      readout: document.getElementById('scene-zoom-readout')?.textContent,
      transform: document.getElementById('scene-canvas')?.style.transform
    }));
    check('zoom-out button returns the stage to 100%',
      zoomedBack.readout === '100%' && zoomedBack.transform === 'scale(1)',
      JSON.stringify(zoomedBack));
    await page.click('.tab[data-tab="script-tab"]');

    // ---- P3 item 20: plain-language block tooltips ----
    const tooltipStats = await page.evaluate(() => {
      const opts = [...document.querySelectorAll('.block-selector .block-option')];
      const untitled = opts.filter(o => !(o.getAttribute('title') || '').trim());
      const lang = document.querySelector('.block-selector .block-option[data-block-type="set-language"]');
      const preset = document.querySelector('.block-selector .block-option[data-block-type="var-score-set"]');
      const cell = document.querySelector('#grid [data-block-type="always-condition"]');
      const note = (window.HydraBlockCatalog?.blocks || [])
        .find(b => b.blockType === 'set-language')?.note || '';
      return {
        total: opts.length,
        untitled: untitled.length,
        langTitle: lang?.getAttribute('title') || '',
        langNote: note,
        presetTitle: preset?.getAttribute('title') || '',
        cellTitle: cell?.getAttribute('title') || ''
      };
    });
    check('palette has block options to tooltip', tooltipStats.total >= 30, String(tooltipStats.total));
    check('every palette block option carries a hover tooltip',
      tooltipStats.untitled === 0, `${tooltipStats.untitled} untitled of ${tooltipStats.total}`);
    check('catalog block tooltip matches its catalog note',
      tooltipStats.langTitle !== '' && tooltipStats.langTitle === tooltipStats.langNote,
      tooltipStats.langTitle.slice(0, 120));
    check('preset block tooltip names its variable',
      /score variable/.test(tooltipStats.presetTitle), tooltipStats.presetTitle.slice(0, 120));
    check('placed grid cell carries the block tooltip',
      tooltipStats.cellTitle !== '', tooltipStats.cellTitle.slice(0, 120));

    // ---- P3 item 23: preview upgrades — device frames ----
    await page.click('.tab[data-tab="preview-tab"]');
    await page.waitForTimeout(500);
    const deviceSelect = page.locator('#preview-device-select');
    check('preview toolbar has a device-frame select', await deviceSelect.count() === 1);
    const deviceOptions = await deviceSelect.locator('option').evaluateAll(
      els => els.map(e => e.value));
    check('device select offers desktop, phone portrait/landscape, tablet',
      deviceOptions.join(',') === 'desktop,phone-portrait,phone-landscape,tablet-portrait',
      deviceOptions.join(','));
    const frameBefore = await page.evaluate(() => ({
      device: document.getElementById('preview-device-frame')?.dataset.device || '',
      labelHidden: document.getElementById('preview-device-label')?.hidden !== false,
    }));
    check('device frame starts on desktop with its label hidden',
      frameBefore.device === 'desktop' && frameBefore.labelHidden,
      JSON.stringify(frameBefore));
    await deviceSelect.selectOption('phone-portrait');
    await page.waitForTimeout(300);
    const phoneFrame = await page.evaluate(() => {
      const canvas = document.getElementById('game-canvas');
      const w = parseFloat(canvas?.style.width || '0');
      const h = parseFloat(canvas?.style.height || '0');
      return {
        device: document.getElementById('preview-device-frame')?.dataset.device || '',
        label: document.getElementById('preview-device-label')?.innerText || '',
        labelHidden: document.getElementById('preview-device-label')?.hidden !== false,
        w, h, ratio: h > 0 ? w / h : 0,
      };
    });
    check('phone frame sets the frame device + label',
      phoneFrame.device === 'phone-portrait' && !phoneFrame.labelHidden &&
      /390/.test(phoneFrame.label), JSON.stringify(phoneFrame));
    // Letterbox (Nov 7, 2026): the canvas keeps the scene viewport's
    // aspect (800x600) inside the phone frame instead of stretching to
    // the phone's aspect (390/844), and it never exceeds the device.
    check('phone frame letterboxes the canvas at the scene aspect (800/600)',
      phoneFrame.w > 0 && phoneFrame.h > 0 &&
      Math.abs(phoneFrame.ratio - 800 / 600) < 0.02 &&
      phoneFrame.w <= 390 && phoneFrame.h <= 844,
      `w=${phoneFrame.w} h=${phoneFrame.h} ratio=${phoneFrame.ratio}`);
    await deviceSelect.selectOption('phone-landscape');
    await page.waitForTimeout(300);
    const landscapeFrame = await page.evaluate(() => {
      const canvas = document.getElementById('game-canvas');
      const w = parseFloat(canvas?.style.width || '0');
      const h = parseFloat(canvas?.style.height || '0');
      return { w, h, ratio: h > 0 ? w / h : 0 };
    });
    check('landscape phone frame also letterboxes at the scene aspect',
      landscapeFrame.w > 0 && landscapeFrame.h > 0 &&
      Math.abs(landscapeFrame.ratio - 800 / 600) < 0.02 &&
      landscapeFrame.w <= 844 && landscapeFrame.h <= 390,
      `w=${landscapeFrame.w} h=${landscapeFrame.h} ratio=${landscapeFrame.ratio}`);
    await deviceSelect.selectOption('desktop');
    await page.waitForTimeout(300);
    const frameAfter = await page.evaluate(() => ({
      device: document.getElementById('preview-device-frame')?.dataset.device || '',
      labelHidden: document.getElementById('preview-device-label')?.hidden !== false,
    }));
    check('desktop selection removes the frame and hides the label',
      frameAfter.device === 'desktop' && frameAfter.labelHidden,
      JSON.stringify(frameAfter));

    // ---- P3 item 21: guided first-run tutorial ----
    // Its own browser context, for the same reason as hub2: creating
    // the tutorial project writes its id as the current project in
    // localStorage, and a shared context would make a later main-page
    // reload open the tutorial instead of the collector.
    const hub3ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const hub3 = await hub3ctx.newPage();
    const hub3Errors = [];
    hub3.on('pageerror', e => hub3Errors.push(String(e && e.message || e)));
    await goto(hub3, `http://localhost:${PORT}/home.html`, { waitUntil: 'domcontentloaded' });
    await hub3.click('#new-project-btn-main');
    await hub3.fill('#project-name-input', 'Tutorial Smoke Game');
    check('tutorial template card exists in the gallery',
      await hub3.locator('.template-card[data-template="tutorial"]').count() === 1);
    await hub3.click('.template-card[data-template="tutorial"]');
    await Promise.all([
      hub3.waitForURL(/index\.html/, { timeout: 15000 }),
      hub3.click('#create-project-btn')
    ]);
    check('editor opens for the tutorial project', /index\.html/.test(hub3.url()), hub3.url());
    await hub3.waitForSelector('#tutorial-panel', { timeout: 10000 });
    const panelBefore = await hub3.evaluate(() => ({
      hidden: document.getElementById('tutorial-panel')?.hidden !== false,
      text: document.getElementById('tutorial-panel')?.innerText || '',
      objects: (window.scenes?.[0]?.objects || []).map(o => o.name).join(','),
    }));
    check('tutorial panel is visible for a tutorial project', !panelBefore.hidden, JSON.stringify(panelBefore));
    check('tutorial panel names the Logic and Preview steps',
      /Logic/.test(panelBefore.text) && /Preview/.test(panelBefore.text), panelBefore.text);
    check('tutorial scene ships player, coin, and score text',
      /player/.test(panelBefore.objects) && /coin/.test(panelBefore.objects) && /scoreText/.test(panelBefore.objects),
      panelBefore.objects);
    await hub3.click('#tutorial-open-logic-btn');
    await hub3.waitForTimeout(400);
    check('tutorial Open Logic button switches to the Logic tab',
      await hub3.evaluate(() => document.querySelector('.tab[data-tab="script-tab"]')?.classList.contains('active')));
    await hub3.click('#tutorial-open-preview-btn');
    await hub3.waitForSelector('#game-canvas', { timeout: 10000 });
    check('tutorial Open Preview button switches to Preview and boots the game',
      await hub3.evaluate(() => document.querySelector('.tab[data-tab="preview-tab"]')?.classList.contains('active') &&
        !!document.getElementById('game-canvas')));
    await hub3.click('#tutorial-dismiss-btn');
    await hub3.waitForTimeout(200);
    check('tutorial dismiss hides the panel',
      await hub3.evaluate(() => document.getElementById('tutorial-panel')?.hidden !== false));
    await reloadPage(hub3, { waitUntil: 'domcontentloaded' });
    // The panel stays in the DOM while hidden, so wait for attachment, not visibility.
    await hub3.waitForSelector('#tutorial-panel', { state: 'attached', timeout: 10000 });
    check('tutorial dismissal persists across reload',
      await hub3.evaluate(() => document.getElementById('tutorial-panel')?.hidden !== false));
    check('no page errors on the tutorial pages', hub3Errors.length === 0, hub3Errors.slice(0, 3).join(' | '));
    await hub3.close();
    await hub3ctx.close();

    // ---- home: CDN-resilient fallback (P3 item 22) ----
    // Block every third-party CDN so the hub must render from the local
    // fallback stylesheet alone, then assert layout + theme survive.
    const offlineCtx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await offlineCtx.route('**/cdn.tailwindcss.com/**', r => r.abort());
    await offlineCtx.route('**/fonts.googleapis.com/**', r => r.abort());
    await offlineCtx.route('**/fonts.gstatic.com/**', r => r.abort());
    const off = await offlineCtx.newPage();
    const offErrors = [];
    off.on('pageerror', e => offErrors.push(String(e && e.message || e)));
    await goto(off, `http://localhost:${PORT}/home.html`, { waitUntil: 'domcontentloaded' });
    // The fallback stylesheet is injected by script once Tailwind fails to
    // load; wait for it to apply before reading computed styles.
    // (domcontentloaded does not wait for a dynamically injected stylesheet
    // the way networkidle did; the checks below stay the real verdict.)
    await off.waitForFunction(
      () => getComputedStyle(document.body).backgroundColor === 'rgb(17, 17, 17)',
      null, { timeout: 10000 }).catch(() => {});
    check('offline home loads the local fallback stylesheet',
      await off.evaluate(() => document.documentElement.classList.contains('hydra-no-tailwind') &&
        !!document.querySelector('link[href="home-fallback.css"]')));
    const offStyles = await off.evaluate(() => {
      const cs = (sel, prop) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el)[prop] : 'missing';
      };
      return {
        headerDisplay: cs('header', 'display'),
        bodyBg: cs('body', 'backgroundColor'),
        gridDisplay: cs('#projects-list', 'display'),
        newBtnBg: cs('#new-project-btn-main', 'backgroundColor'),
        wizardDisplay: cs('#new-project-wizard-overlay', 'display'),
        titleText: (document.querySelector('h1') || {}).innerText || '',
      };
    });
    check('offline home header keeps its flex layout', offStyles.headerDisplay === 'flex', offStyles.headerDisplay);
    check('offline home body keeps its dark background', offStyles.bodyBg === 'rgb(17, 17, 17)', offStyles.bodyBg);
    check('offline home projects grid keeps its grid layout', offStyles.gridDisplay === 'grid', offStyles.gridDisplay);
    check('offline home primary button keeps its blue background', offStyles.newBtnBg === 'rgb(59, 130, 246)', offStyles.newBtnBg);
    check('offline home wizard stays hidden until opened', offStyles.wizardDisplay === 'none', offStyles.wizardDisplay);
    check('offline home title still renders', offStyles.titleText.includes('HYDRA'), offStyles.titleText);
    await off.click('#new-project-btn-main');
    await off.waitForTimeout(300);
    check('offline home wizard opens on New Project (hidden/flex toggle works)',
      await off.evaluate(() => getComputedStyle(document.getElementById('new-project-wizard-overlay')).display === 'flex'));
    check('no page errors on the offline home page', offErrors.length === 0, offErrors.slice(0, 3).join(' | '));
    await off.close();
    await offlineCtx.close();

    // ---- P3 item 15: editor project JSON import/export + templates ----
    // Its own browser context, for the same reason as hub2/hub3:
    // creating the blank project writes its id as the current project
    // in localStorage, and a shared context would make a later
    // main-page reload open the blank project instead of the collector.
    const pjCtx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const pj = await pjCtx.newPage();
    const pjErrors = [];
    pj.on('pageerror', e => pjErrors.push(String(e && e.message || e)));
    await goto(pj, `http://localhost:${PORT}/home.html`, { waitUntil: 'domcontentloaded' });
    await pj.click('#new-project-btn-main');
    await pj.fill('#project-name-input', 'JSON Smoke Game');
    await pj.click('.template-card[data-template="blank"]');
    await Promise.all([
      pj.waitForURL(/index\.html/, { timeout: 15000 }),
      pj.click('#create-project-btn')
    ]);
    check('editor header has New / Import JSON / Export JSON buttons',
      await pj.locator('#new-project-btn').count() === 1 &&
      await pj.locator('#import-json-btn').count() === 1 &&
      await pj.locator('#export-json-btn').count() === 1);
    await pj.click('#new-project-btn');
    await pj.waitForSelector('#new-project-dialog.open', { timeout: 5000 });
    const templateOptions = await pj.locator('#new-project-template option').count();
    const templateValues = await pj.evaluate(() =>
      [...document.querySelectorAll('#new-project-template option')].map(o => o.value));
    check('new-project dialog lists the hub templates', templateOptions >= 15 &&
      templateValues.includes('blank') && templateValues.includes('tutorial'),
      `options=${templateOptions}`);
    await pj.selectOption('#new-project-template', 'tutorial');
    await pj.waitForTimeout(200);
    check('new-project dialog describes the selected template',
      (await pj.locator('#new-project-template-desc').innerText()).includes('guided first game'));
    await pj.keyboard.press('Escape');
    await pj.waitForTimeout(200);
    check('Escape closes the new-project dialog',
      await pj.locator('#new-project-dialog.open').count() === 0);
    const [jsonDownload] = await Promise.all([
      pj.waitForEvent('download', { timeout: 15000 }),
      pj.click('#export-json-btn')
    ]);
    check('export JSON downloads a .hydra file',
      (jsonDownload.suggestedFilename() || '').endsWith('.hydra'), jsonDownload.suggestedFilename());
    const jsonText = require('fs').readFileSync(await jsonDownload.path(), 'utf8');
    let jsonParsed = null;
    try { jsonParsed = JSON.parse(jsonText); } catch (e) { /* checked below */ }
    check('exported JSON parses and names the current project',
      !!jsonParsed && jsonParsed.name === 'JSON Smoke Game' && Array.isArray(jsonParsed.scenes),
      jsonParsed ? jsonParsed.name : 'unparsable');
    // A broken file alerts and leaves the current project untouched.
    let alertMessage = '';
    pj.on('dialog', async d => { alertMessage = d.message(); await d.accept(); });
    const badPath = require('path').join(require('os').tmpdir(), 'hydra-bad-smoke.hydra');
    require('fs').writeFileSync(badPath, '{not json');
    await pj.setInputFiles('#import-json-file', badPath);
    await pj.waitForTimeout(500);
    check('broken import alerts instead of replacing the project',
      alertMessage.includes('Failed to import project'), alertMessage);
    check('broken import leaves the current project in place',
      (await pj.locator('#project-name').innerText()).includes('JSON Smoke Game'));
    // A valid file opens as a project in the editor.
    const goodPath = require('path').join(require('os').tmpdir(), 'hydra-good-smoke.hydra');
    const imported = { ...jsonParsed, id: 'imported-json-smoke', name: 'Imported JSON Game' };
    require('fs').writeFileSync(goodPath, JSON.stringify(imported));
    await pj.setInputFiles('#import-json-file', goodPath);
    // The reload happens after the async FileReader finishes, so wait for
    // the new project name rather than the load state of the old page.
    await pj.waitForFunction(
      () => document.getElementById('project-name')?.textContent.includes('Imported JSON Game'),
      null, { timeout: 15000 });
    check('valid import opens the imported project in the editor',
      (await pj.locator('#project-name').innerText()).includes('Imported JSON Game'));
    // New from a template, without leaving the editor.
    await pj.click('#new-project-btn');
    await pj.waitForSelector('#new-project-dialog.open', { timeout: 5000 });
    await pj.fill('#new-project-name', 'From Editor Template');
    await pj.selectOption('#new-project-template', 'collector');
    await pj.click('#new-project-create-btn');
    await pj.waitForFunction(
      () => document.getElementById('project-name')?.textContent.includes('From Editor Template'),
      null, { timeout: 15000 });
    check('new from a template opens the new project in the editor',
      (await pj.locator('#project-name').innerText()).includes('From Editor Template'));
    check('no page errors on the project-JSON pages', pjErrors.length === 0, pjErrors.slice(0, 3).join(' | '));
    await pj.close();
    await pjCtx.close();

    // ---- P1 item 16 (resilience): damaged saved data never kills the app ----
    const rctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const rpage = await rctx.newPage();
    const rErrors = [];
    rpage.on('pageerror', e => rErrors.push(String(e && e.message || e)));
    // (a) The whole store is not valid JSON: the hub reports it, backs the
    // raw bytes up, and still renders. (Seeded with a plain evaluate +
    // reload, not addInitScript: an init script would re-clobber the store
    // on every later navigation in this context.)
    await goto(rpage, `http://localhost:${PORT}/home.html`, { waitUntil: 'domcontentloaded' });
    await rpage.evaluate(() => localStorage.setItem('hydraProjects', '{this is not json'));
    await reloadPage(rpage, { waitUntil: 'domcontentloaded' });
    check('corrupt project store shows a warning banner',
      await rpage.locator('#hydra-store-notice').count() === 1);
    check('corrupt store banner says a backup was kept',
      (await rpage.locator('#hydra-store-notice').innerText()).toLowerCase().includes('backup'));
    check('corrupt project store still renders the hub',
      await rpage.locator('#projects-list').count() === 1);
    check('corrupt store was backed up under a backup key',
      await rpage.evaluate(() => Object.keys(localStorage).some(k => k.startsWith('hydraProjects.corrupt.'))));
    // (b) One damaged record among good ones: the good projects stay, the
    // repairable one is repaired, the unrepairable one is reported.
    await rpage.evaluate(() => {
      const now = new Date().toISOString();
      const good = { id: 'good-one', name: 'Good Project', dateCreated: now, lastModified: now, scenes: [], assets: {} };
      const repairable = { id: 'repair-one', name: 'Repairable Project', dateCreated: now, lastModified: now, scenes: 'not-an-array', assets: {} };
      localStorage.setItem('hydraProjects', JSON.stringify([good, repairable, 'just a string record']));
    });
    await reloadPage(rpage, { waitUntil: 'domcontentloaded' });
    check('one damaged record does not hide the good projects',
      await rpage.locator('.project-open-btn[data-project-id="good-one"]').count() === 1);
    check('a record with a damaged scenes field is repaired and still listed',
      await rpage.locator('.project-open-btn[data-project-id="repair-one"]').count() === 1);
    check('an unrepairable record is reported in the banner',
      (await rpage.locator('#hydra-store-notice').innerText()).includes('1 saved project'));
    // (c) The editor opens a project whose scenes field is damaged.
    await rpage.evaluate(() => {
      const now = new Date().toISOString();
      const damaged = { id: 'damaged-editor', name: 'Damaged Editor Game', dateCreated: now, lastModified: now, scenes: 'not-an-array', assets: {} };
      localStorage.setItem('hydraProjects', JSON.stringify([damaged]));
      localStorage.setItem('currentProjectId', 'damaged-editor');
    });
    await goto(rpage, `http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await rpage.waitForFunction(
      () => document.getElementById('project-name')?.textContent.length > 0,
      null, { timeout: 10000 });
    check('editor opens a project with a damaged scenes field',
      (await rpage.locator('#project-name').innerText()).includes('Damaged Editor Game'));
    check('editor grid still renders after opening damaged data',
      (await rpage.locator('#grid > *').count()) === 3600);
    check('no page errors on the resilience pages', rErrors.length === 0, rErrors.slice(0, 3).join(' | '));
    await rctx.close();

    // ---- P3 item 18 (block validation): dangling refs + broken expressions
    // surface in the diagnostics dock on load, and clear when fixed ----
    const vctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const vpage = await vctx.newPage();
    const vErrors = [];
    vpage.on('pageerror', e => vErrors.push(String(e && e.message || e)));
    await goto(vpage, `http://localhost:${PORT}/home.html`, { waitUntil: 'domcontentloaded' });
    await vpage.evaluate(() => {
      const now = new Date().toISOString();
      const val = {
        id: 'validation-game', name: 'Validation Game', dateCreated: now, lastModified: now, assets: {},
        globalGridData: { 0: { type: 'always' }, 1: { type: 'applyForce', targetObject: 'coin', forceX: '5', forceY: '0' }, 2: { type: 'callFunction', functionName: 'nope', arg1: '1', storeVarName: '' } },
        // P5-3 slice b: a function body with a broken expression, plus
        // a Return placed outside any function body (scene grid).
        functions: [{ id: 'fn_add', name: 'add', params: ['a', 'b'],
          grid: { 0: { type: 'returnFromFunction', value: 'a +' } } }],
        scenes: [{
          id: 1, name: 'Level 1',
          objects: [{ id: 1, name: 'player' }, { id: 2, name: 'coin' }],
          gridData: {
            0: { type: 'always' },
            1: { type: 'applyForce', targetObject: 'ghost', forceX: '5 +', forceY: '0' },
            2: { type: 'switchScene', sceneId: 999 },
            3: { type: 'setVariable', varName: 'score', operation: 'set', value: 'score +' },
            4: { type: 'returnFromFunction', value: '1' }
          }
        }]
      };
      localStorage.setItem('hydraProjects', JSON.stringify([val]));
      localStorage.setItem('currentProjectId', 'validation-game');
    });
    await goto(vpage, `http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await vpage.waitForFunction(
      () => document.getElementById('diagnostic-feed')?.textContent.includes('ghost'),
      null, { timeout: 10000 });
    const vFeed = () => vpage.evaluate(() => document.getElementById('diagnostic-feed').textContent);
    check('validation: dangling object reported in the diagnostics dock',
      (await vFeed()).includes('names object "ghost"'));
    check('validation: broken legacy expression reported',
      (await vFeed()).includes('5 +') && (await vFeed()).includes('will not run'));
    check('validation: broken catalog expression reported',
      (await vFeed()).includes('score +'));
    check('validation: missing scene reported',
      (await vFeed()).includes('999') && (await vFeed()).includes('does not exist'));
    check('validation: global grid object that exists in a scene stays quiet',
      !(await vFeed()).includes('names object "coin"'));
    check('validation: calling a missing function is reported',
      (await vFeed()).includes('calls function "nope"'));
    check('validation: broken expression inside a function body is reported with the function label',
      (await vFeed()).includes('a +') && (await vFeed()).includes('Function add'));
    check('validation: Return outside a function body is reported',
      (await vFeed()).includes('only works inside a function body'));
    check('validation: diagnostics count reflects the findings',
      Number(await vpage.locator('#diagnostic-count').innerText()) >= 7);
    // Fix every flagged block through the live editor state and refresh:
    // the warnings must clear without a reload.
    await vpage.evaluate(() => {
      window.scenes[0].gridData[1].targetObject = 'player';
      window.scenes[0].gridData[1].forceX = '5';
      window.scenes[0].gridData[2].sceneId = 1;
      window.scenes[0].gridData[3].value = 'score + 1';
      delete window.scenes[0].gridData[4];
      window.globalGridData[2].functionName = 'add';
      const fn = window.projectManager?.getCurrentProject?.().functions?.[0];
      if (fn && fn.grid) fn.grid[0].value = 'a + b';
      window.refreshValidationDiagnostics();
    });
    await vpage.waitForFunction(
      () => document.getElementById('diagnostic-feed')?.textContent.includes('No runtime diagnostics.'),
      null, { timeout: 10000 });
    check('validation: fixing the blocks clears the warnings',
      (await vFeed()).includes('No runtime diagnostics.'));
    check('no page errors on the validation pages', vErrors.length === 0, vErrors.slice(0, 3).join(' | '));
    await vctx.close();

    // ---- P2 item 13/10 (core factories): New Scene and Add Object in
    // the live editor build through the core factories ----
    await page.click('.tab[data-tab="scene-tab"]');
    await page.waitForSelector('.scene-container', { timeout: 10000 });
    const scenesBefore = await page.evaluate(() => window.scenes.length);
    await page.click('#scene-toolbar-add-btn');
    await page.waitForFunction(
      (n) => window.scenes.length === n + 1, scenesBefore, { timeout: 10000 });
    const newScene = await page.evaluate(() => {
      const s = window.scenes[window.scenes.length - 1];
      return { name: s.name, bgColor: s.bgColor, renderMode: s.renderMode,
        layers: (s.layers || []).length, objects: s.objects.length,
        grid: typeof s.gridData === 'object' };
    });
    check('core factories: Add scene creates a normalized scene through the factory',
      newScene.name === `Scene ${scenesBefore + 1}` && newScene.bgColor === '#ffffff' &&
      newScene.renderMode === '2d' && newScene.layers === 3 && newScene.objects === 0 && newScene.grid,
      JSON.stringify(newScene));
    const knownObjIds = await page.evaluate(() =>
      window.scenes.flatMap(s => s.objects.map(o => o.id)));
    await page.click('.inspector-tab[data-inspector-tab="create"]');
    await page.waitForSelector('.object-create-btn[data-create-kind="sprite"]', { timeout: 10000 });
    const objsBefore = await page.evaluate(() =>
      window.scenes.reduce((m, s) => m + s.objects.length, 0));
    await page.click('.object-create-btn[data-create-kind="sprite"]');
    await page.waitForFunction(
      (n) => window.scenes.reduce((m, s) => m + s.objects.length, 0) === n + 1,
      objsBefore, { timeout: 10000 });
    const newObj = await page.evaluate((known) => {
      for (const s of window.scenes) {
        const o = s.objects.find(o => !known.includes(o.id));
        if (o) {
          const tf = (o.components || []).find(c => c.type === 'Transform');
          return { w: o.width, h: o.height, color: o.color, name: o.name,
            kind: o.kind, archetype: o.archetype,
            tfX: tf && tf.props.x, posX: o.posX, tfY: tf && tf.props.y, posY: o.posY };
        }
      }
      return null;
    }, [...knownObjIds]);
    check('core factories: Create Sprite builds a 60x60 factory object',
      !!newObj && newObj.w === 60 && newObj.h === 60 && newObj.color === '#4488ff' &&
      newObj.name === '' && newObj.kind === 'sprite' && newObj.archetype === 'sprite',
      JSON.stringify(newObj));
    check('core factories: factory object Transform props match its snapped position',
      !!newObj && newObj.tfX === newObj.posX && newObj.tfY === newObj.posY,
      JSON.stringify(newObj));

    // ---- narrow viewport: panels stack instead of squeezing (P3 item 17) ----
    await page.setViewportSize({ width: 720, height: 900 });
    await reloadPage(page, { waitUntil: 'domcontentloaded' });
    await page.click('.tab[data-tab="scene-tab"]');
    await page.waitForTimeout(300);
    const sceneStack = await page.evaluate(() => {
      const stage = document.querySelector('.scene-container').getBoundingClientRect();
      const panel = document.querySelector('.scene-side-panel').getBoundingClientRect();
      return { panelBelow: panel.top >= stage.bottom - 1, panelFits: panel.right <= 721 };
    });
    check('a11y: narrow viewport stacks the inspector below the stage',
      sceneStack.panelBelow && sceneStack.panelFits, JSON.stringify(sceneStack));
    await page.click('.tab[data-tab="script-tab"]');
    await page.waitForSelector('#grid', { timeout: 10000 });
    const logicStack = await page.evaluate(() => {
      const gridBox = document.querySelector('.grid-container').getBoundingClientRect();
      const panel = document.querySelector('.grid-editor .side-panel').getBoundingClientRect();
      return {
        column: getComputedStyle(document.querySelector('.grid-editor')).flexDirection === 'column',
        panelBelow: panel.top >= gridBox.bottom - 1,
        panelFits: panel.right <= 721,
      };
    });
    check('a11y: narrow viewport stacks the logic panel below the grid',
      logicStack.column && logicStack.panelBelow && logicStack.panelFits, JSON.stringify(logicStack));
    await page.setViewportSize({ width: 1400, height: 900 });
    await reloadPage(page, { waitUntil: 'domcontentloaded' });

    // ---- Apply Force arrow rotates to the force direction (queued by
    // Ky'lin, Nov 7, 2026 — the last of the three brief items). A
    // placed Apply Force block draws its arrow rotated by
    // atan2(forceY, forceX): left for (-100, 0), down for (0, 100),
    // down-right for (100, 100). An expression in X or Y keeps the
    // default right arrow, and the palette icon stays generic. The
    // X/Y panel fields re-point the arrow as you type, and a reload
    // restores the stored direction (the panel's markDirty autosaves
    // after ~900ms, so the check waits past it).
    await page.click('.tab[data-tab="script-tab"]');
    await page.waitForSelector('#grid', { timeout: 10000 });
    const paletteArrow = await page.evaluate(() => {
      const opt = document.querySelector('.block-selector .block-option[data-block-type="action"]');
      return opt ? opt.innerHTML : '';
    });
    check('palette Apply Force icon stays generic (no rotate transform)',
      paletteArrow !== '' && !/rotate\(/.test(paletteArrow), paletteArrow.slice(0, 200));
    const forceBeforeIdx = await page.evaluate(() =>
      [...document.querySelectorAll('#grid [data-block-type="action"]')].map(c => c.dataset.index));
    await page.click('.block-selector .block-option[data-block-type="action"]');
    await page.locator('#grid > *:not([data-block-type])').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#grid [data-block-type="action"]').length > n,
      forceBeforeIdx.length, { timeout: 5000 }).catch(() => {});
    const forceIndex = await page.evaluate((before) => {
      const added = [...document.querySelectorAll('#grid [data-block-type="action"]')]
        .find(c => !before.includes(c.dataset.index));
      return added ? added.dataset.index : null;
    }, forceBeforeIdx);
    check('Apply Force block places on the grid', forceIndex !== null, JSON.stringify(forceBeforeIdx));
    const forceCell = page.locator(`#grid .cell[data-index="${forceIndex}"]`);
    const forceAngle = async () => page.evaluate((idx) => {
      const cell = document.querySelector(`#grid .cell[data-index="${idx}"]`);
      const m = cell ? cell.innerHTML.match(/rotate\((-?[\d.]+) 28 28\)/) : null;
      return m ? Number(m[1]) : null;
    }, forceIndex);
    check('freshly placed Apply Force (5, 0) points right',
      (await forceAngle()) === 0, String(await forceAngle()));
    // Select the cell so the property panel shows its X/Y fields.
    await forceCell.click();
    const forceInputs = page.locator('#properties-content .expr-input');
    check('Apply Force property panel offers X and Y fields',
      (await forceInputs.count()) === 2, String(await forceInputs.count()));
    const setForce = async (x, y) => {
      await forceInputs.nth(0).fill(String(x));
      await forceInputs.nth(1).fill(String(y));
      await page.waitForTimeout(100);
    };
    await setForce(-100, 0);
    check('force (-100, 0) points the arrow left (180)',
      (await forceAngle()) === 180, String(await forceAngle()));
    if (process.env.HYDRA_SMOKE_SHOTS) {
      await forceCell.screenshot({ path: `${process.env.HYDRA_SMOKE_SHOTS}/force-arrow-left.png` });
    }
    await setForce(0, 100);
    check('force (0, 100) points the arrow down (90)',
      (await forceAngle()) === 90, String(await forceAngle()));
    await setForce(100, 100);
    check('force (100, 100) points the arrow down-right (45)',
      (await forceAngle()) === 45, String(await forceAngle()));
    if (process.env.HYDRA_SMOKE_SHOTS) {
      await forceCell.screenshot({ path: `${process.env.HYDRA_SMOKE_SHOTS}/force-arrow-diagonal.png` });
      await page.locator('.grid-container').screenshot({ path: `${process.env.HYDRA_SMOKE_SHOTS}/force-arrow-grid.png` });
    }
    await setForce('speed', 0);
    check('an expression X keeps the default right arrow (no rotate)',
      (await forceAngle()) === null, String(await forceAngle()));
    await setForce(-100, 0);
    check('back to (-100, 0) the arrow points left again',
      (await forceAngle()) === 180, String(await forceAngle()));
    await page.waitForTimeout(1500);
    await reloadPage(page, { waitUntil: 'domcontentloaded' });
    await page.click('.tab[data-tab="script-tab"]');
    await page.waitForSelector('#grid', { timeout: 10000 });
    check('a reload restores the stored force direction (left, 180)',
      (await forceAngle()) === 180, String(await forceAngle()));

    // (Resource-load failures for third-party CDNs are environmental: this
    // sandbox has no external network. The app itself must not throw.)
    check('no page errors during the whole flow', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
    const realConsoleErrors = consoleErrors.filter(t =>
      !/favicon/i.test(t) && !/Failed to load resource/i.test(t) && !/net::ERR_/i.test(t));
    check('no console errors during the whole flow', realConsoleErrors.length === 0,
      realConsoleErrors.slice(0, 3).join(' | '));
  } catch (e) {
    failures++;
    console.log(`NOT OK - smoke test threw: ${e.message}`);
  } finally {
    await browser.close().catch(() => {});
    server.kill();
  }

  if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
  console.log('browser-smoke.js: all checks passed');
}

main().catch(e => { console.error('fatal:', e); process.exit(1); });
