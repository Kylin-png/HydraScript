// Screenshot capture for HydraScript pages (not part of the test suite).
// Usage: node scripts/capture-screens.js
// Writes PNGs to ../screenshots/.

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const HYDRA_DIR = path.join(__dirname, '..', 'hydra');
const OUT_DIR = path.join(__dirname, '..', 'screenshots');
const PORT = 8125;
const CHROME_PATH = path.join(
  process.env.HOME || '/home/hatch',
  '.cache/ms-playwright/chromium-1248/chrome-linux64/chrome'
);

async function main() {
  const { chromium } = require('playwright-core');
  if (!fs.existsSync(CHROME_PATH)) {
    console.log('SKIPPED - chromium not available');
    process.exit(0);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: HYDRA_DIR });
  await new Promise(r => setTimeout(r, 1200));

  const browser = await chromium.launch({ executablePath: CHROME_PATH });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  try {
    // 1. Home hub
    await page.goto(`http://localhost:${PORT}/home.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT_DIR, '1-home.png') });
    console.log('captured 1-home.png');

    // 2. New project dialog with templates
    await page.click('#new-project-btn-main');
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT_DIR, '2-new-project.png') });
    console.log('captured 2-new-project.png');

    // 3. Create collector project -> editor scene tab
    await page.fill('#project-name-input', 'Screenshot Tour');
    await page.click('.template-card[data-template="collector"]');
    await Promise.all([
      page.waitForURL(/index\.html/, { timeout: 15000 }),
      page.click('#create-project-btn')
    ]);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT_DIR, '3-editor-scene.png') });
    console.log('captured 3-editor-scene.png');

    // 4. Logic tab - grid view
    await page.click('.tab[data-tab="script-tab"]');
    await page.waitForSelector('#grid', { timeout: 10000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT_DIR, '4-logic-grid.png') });
    console.log('captured 4-logic-grid.png');

    // 5. Logic tab - event sheet view
    await page.click('#logic-view-events-btn');
    await page.waitForSelector('#event-sheet-panel:not([hidden])', { timeout: 5000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT_DIR, '5-event-sheet.png') });
    console.log('captured 5-event-sheet.png');

    // 6. Preview tab
    await page.click('.tab[data-tab="preview-tab"]');
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(OUT_DIR, '6-preview.png') });
    console.log('captured 6-preview.png');
  } finally {
    await browser.close();
    server.kill();
  }
  console.log('done');
}

main().catch(e => { console.error(e); process.exit(1); });
