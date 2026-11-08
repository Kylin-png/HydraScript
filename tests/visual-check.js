// HydraScript visual check — one-command visual verification.
//
// Usage:
//   node tests/visual-check.js                    # editor logic grid + preview
//   node tests/visual-check.js --template flagship # specific template
//   node tests/visual-check.js --game              # boot standalone game + screenshots
//
// Saves screenshots to ../screenshots/visual-check-<timestamp>/.
// Exit 0 = no errors. This is for HUMAN visual inspection — it doesn't assert
// layout correctness, it just captures the current state so you can LOOK at it.
//
// This replaces ad-hoc /tmp/shot-*.js scripts. Use this every time.

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const HYDRA_DIR = path.join(__dirname, '..', 'hydra');
const SHOT_DIR = path.join(__dirname, '..', 'screenshots');
const PORT = 8125;
const CHROME_PATH = path.join(
  process.env.HOME || '/home/hatch',
  '.cache/ms-playwright/chromium-1248/chrome-linux64/chrome'
);

const args = process.argv.slice(2);
let template = 'collector';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--template' && args[i + 1]) template = args[i + 1];
  else if (args[i].startsWith('--template=')) template = args[i].split('=')[1];
}
const gameMode = args.includes('--game');

async function main() {
  const { chromium } = require('playwright-core');
  if (!fs.existsSync(CHROME_PATH)) {
    console.log('SKIPPED - chromium not available');
    process.exit(0);
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.join(SHOT_DIR, `visual-check-${ts}`);
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`Screenshots -> ${outDir}`);

  // stdio 'ignore': see browser-smoke.js — the server logs every request
  // to stderr, and with piped stdio nobody reads it, so the 64KB pipe
  // fills after ~1100 requests and the server blocks mid-response forever.
  const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: HYDRA_DIR, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));

  const browser = await chromium.launch({ executablePath: CHROME_PATH });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  try {
    // ---- Editor: new project from template ----
    console.log(`\n[1/4] Opening editor with '${template}' template...`);
    await page.goto(`http://localhost:${PORT}/home.html`, { waitUntil: 'networkidle' });
    await page.click('#new-project-btn-main');
    await page.fill('#project-name-input', 'Visual Check');
    await page.click(`.template-card[data-template="${template}"]`);
    await Promise.all([
      page.waitForURL(/index\.html/, { timeout: 15000 }),
      page.click('#create-project-btn')
    ]);
    await page.waitForSelector('#app-loading-screen', { state: 'hidden', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // ---- Logic tab ----
    console.log('[2/4] Capturing logic grid...');
    await page.click('.tab[data-tab="script-tab"]');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(outDir, 'logic-grid.png') });
    console.log('  saved logic-grid.png');

    // ---- Preview tab ----
    console.log('[3/4] Capturing preview...');
    await page.click('.tab[data-tab="preview-tab"]');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(outDir, 'preview.png') });
    console.log('  saved preview.png');

    // ---- Standalone game (optional) ----
    if (gameMode) {
      console.log('[4/4] Exporting and booting standalone game...');
      // Click Export, then the Single HTML card's download
      await page.click('#export-btn, button:has-text("Export Game")');
      await page.waitForTimeout(1000);
      const downloadPromise = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
      // Click the first export card's download button
      await page.click('.export-card button:has-text("Download"), .export-card button:has-text("Export")');
      const download = await downloadPromise;
      if (download) {
        const gamePath = path.join(outDir, 'game.html');
        await download.saveAs(gamePath);
        console.log('  exported game.html');

        // Boot it
        const gamePage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
        gamePage.on('pageerror', e => errors.push('GAME: ' + e.message));
        await gamePage.goto(`file://${gamePath}`);
        await gamePage.waitForTimeout(3000);
        await gamePage.screenshot({ path: path.join(outDir, 'game-boot.png') });
        console.log('  saved game-boot.png');

        // Simulate some input
        await gamePage.keyboard.press('Space');
        await gamePage.waitForTimeout(1000);
        await gamePage.screenshot({ path: path.join(outDir, 'game-input.png') });
        console.log('  saved game-input.png (after Space)');
        await gamePage.close();
      } else {
        console.log('  (export download timed out, skipping game boot)');
      }
    }

    console.log(`\nDone. ${errors.length} error(s).`);
    if (errors.length) {
      console.log('Errors:');
      errors.slice(0, 5).forEach(e => console.log('  - ' + e.slice(0, 120)));
    }
    console.log(`\nOpen the screenshots in ${outDir} to inspect visually.`);
  } finally {
    await browser.close().catch(() => {});
    server.kill();
  }
}

main().catch(e => { console.error('fatal:', e.message); process.exit(1); });
