// Tests for P3 item 23 — preview upgrades: device frames.
//
// The FPS-counter half of item 23 already shipped with the profiling
// overlay (P4 item 34: the Preview toolbar gauge button shows live FPS).
// This file covers the remaining half: the device-frame selector in the
// preview toolbar. The frame is display-only chrome: the game still
// renders at the scene viewport resolution, and only the canvas display
// size changes. These are static HTML/CSS wiring checks (the live
// behavior is covered by browser-smoke.js); the device table, the
// setPreviewDevice behavior, and the canvas sizing math live in
// hydra-previewtoolbar.js (P2 item 14, slice 5) and are covered by
// tests/previewtoolbar.test.js.

const fs = require('fs');
const path = require('path');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const html = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'style.css'), 'utf8');

const select = html.match(/<select[^>]*id="preview-device-select"[^>]*>([\s\S]*?)<\/select>/);
check('preview toolbar has a device select', !!select);
const options = select ? [...select[1].matchAll(/value="([^"]+)"/g)].map(m => m[1]) : [];
check('device select offers desktop + phone portrait/landscape + tablet',
  options.join(',') === 'desktop,phone-portrait,phone-landscape,tablet-portrait',
  options.join(','));
check('preview canvas sits inside a device frame element',
  /id="preview-device-frame"[^>]*data-device="desktop"/.test(html));
check('device frame has a label element, hidden for desktop',
  /id="preview-device-label"[^>]*hidden/.test(html));

check('stylesheet draws a bezel for phone frames',
  /\.preview-device-frame\[data-device="phone-portrait"\]/.test(css) &&
  /border-radius: 28px/.test(css));
check('stylesheet draws a bezel for the tablet frame',
  /\.preview-device-frame\[data-device="tablet-portrait"\]/.test(css));

if (failures) { console.log(`${failures} check(s) failed`); process.exit(1); }
console.log('preview-devices.test.js: all checks passed');
