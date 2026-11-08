// HydraScript test runner — the repeatable verification command.
//
//   node tests/run.js
//
// Runs, in order:
//   1. Syntax checks (node --check) on every JS file in ../hydra
//   2. Every *.test.js in this directory as a child node process
//   3. The Playwright browser smoke test (tests/browser-smoke.js), which
//      boots its own server + Chromium; it SKIPS (exit 0) when Chromium or
//      playwright-core is unavailable.
//
// A test file passes by exiting 0. Use tests/assert-lite.js helpers.
// Browser smoke tests live in tests/browser-smoke.md (checklist) and are
// driven manually through the live browser for now.
//
// Per-file timeout is 120s, raised from 60s in cycle 75: on a loaded
// machine (cycle 75 ran at load ~3.4 with swap in use) a sub-second file
// like gltf.test.js was reported ETIMEDOUT even though every one of its
// checks had passed — the parent simply could not reap it inside 60s.
// Same reasoning as the cycle-66 smoke-timeout raise: a slow-but-green
// run is not a failure.

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const HYDRA = path.join(REPO, 'hydra');

let failures = 0;
function ok(label) { console.log(`  PASS  ${label}`); }
function fail(label, detail) {
  failures++;
  console.log(`  FAIL  ${label}`);
  if (detail) console.log(`        ${String(detail).split('\n').join('\n        ')}`);
}

function listJs(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/node_modules/.test(e.name)) out.push(...listJs(p)); }
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out.sort();
}

// 1. Syntax checks
console.log('== syntax checks (node --check) ==');
for (const f of listJs(HYDRA)) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status === 0) ok(path.relative(REPO, f));
  else fail(path.relative(REPO, f), r.stderr);
}

// 2. Node test files
console.log('== node tests ==');
const testFiles = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort();
for (const f of testFiles) {
  const p = path.join(__dirname, f);
  try {
    const out = execFileSync(process.execPath, [p], { encoding: 'utf8', cwd: HYDRA, timeout: 120000 });
    ok(f);
    if (out.trim()) console.log(`        ${out.trim().split('\n').join('\n        ')}`);
  } catch (e) {
    fail(f, (e.stdout || '') + (e.stderr || e.message));
  }
}

if (failures === 0) {
  // 3. Browser smoke test (separate: needs Chromium + a local server; skips gracefully)
  // P4 item 3D5: the smoke flow grows every cycle (now ~5 min); the
  // subprocess timeout grows with it so a slow-but-green run is not
  // reported as a failure. Raised 300s -> 420s in cycle 66: the
  // standalone smoke run takes ~298s on a quiet machine and the
  // 300s cap killed it mid-run inside the full suite with no failing
  // assertion. Raised 420s -> 900s in cycle 77: on this loaded machine
  // the standalone smoke run takes ~14 min, and the 420s cap killed a
  // slow-but-green run mid-retry (resilience section, no failing
  // assertion) with spawnSync ETIMEDOUT. Raised 900s -> 1200s in
  // cycle 9 (Nov 8, 2026): the same kill hit a slow-but-green run
  // again — 0 NOT OK in the log, the smoke was killed mid-final-section
  // (Apply Force) after ~900s on this loaded machine, while the two
  // runs before it finished the same flow in ~890s. The cap is a
  // wall-clock guard against a hung browser, not a test assertion.
  console.log('== browser smoke test ==');
  try {
    const out = execFileSync(process.execPath, [path.join(__dirname, 'browser-smoke.js')],
      { encoding: 'utf8', cwd: REPO, timeout: 1200000 });
    console.log(out.trim().split('\n').map(l => '        ' + l).join('\n'));
  } catch (e) {
    fail('browser-smoke.js', (e.stdout || '') + (e.stderr || e.message));
  }
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
