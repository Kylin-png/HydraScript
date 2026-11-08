// playtest.test.js — the release gate inside `node tests/run.js`.
//
// Builds the REAL flagship export (Hydra Quest) through
// HydraPlayer.buildPlayableHtml, writes it to a temp file, and runs the
// end-to-end playtest harness (tests/playtest-game.js) against it in real
// Chromium. The suite fails if the harness fails: a game that boots but
// cannot be played is a failing build.
//
// This file is picked up automatically by tests/run.js (it runs every
// *.test.js). It skips, loudly, only when Chromium is absent or cannot
// launch — in that case the release checklist in TESTING.md still requires
// the harness to be run by hand before any stable release ships. The
// launch probe below runs before the export is built: a real headless
// launch is the only reliable check (the binary can exist yet die with
// SIGTRAP on launch, as the env-wide Chromium breakage of Nov 7, 2026
// showed), and skipping early also avoids the temp-file write the
// harness needs but a skipped run never uses.
//
// Timeout: the harness playthrough takes ~45-60s. run.js gives each
// test file 120s; the spawn below enforces its own 110s cap so a hung
// browser is reported as a failure, not a silent hang.
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const HYDRA = path.join(REPO, 'hydra');
const CHROME_PATH = path.join(
  process.env.HOME || '/home/hatch',
  '.cache/ms-playwright/chromium-1248/chrome-linux64/chrome'
);

// ---- Chromium gate: skip loudly unless the browser can really launch ----
// `--version` still exits 0 on a broken Chromium, so only a real headless
// launch proves anything. A non-zero exit (SIGTRAP 133 on the Nov 7, 2026
// breakage) or a timeout means the release gate cannot run here.
function chromiumLaunchable() {
  try {
    const r = spawnSync(CHROME_PATH, ['--headless', '--disable-gpu', '--no-sandbox', '--dump-dom', 'about:blank'],
      { encoding: 'utf8', timeout: 20000 });
    return r.status === 0;
  } catch (e) { return false; }
}
if (!fs.existsSync(CHROME_PATH)) {
  console.log('SKIPPED - chromium not available; the release gate was NOT verified. Run the harness by hand before shipping (see TESTING.md).');
  process.exit(0);
}
if (!chromiumLaunchable()) {
  console.log('SKIPPED - chromium cannot launch (binary exists but a real headless launch fails); the release gate was NOT verified. Run the harness by hand before shipping (see TESTING.md).');
  process.exit(0);
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

// ---- Build the flagship export (same method as flagship.test.js) ----
function makeCtx() {
  return new Proxy({}, {
    get(t, p) { if (p === Symbol.toPrimitive) return () => 0; return () => undefined; },
    set() { return true; }
  });
}
function makeBrowserStubs() {
  const rafCallbacks = [];
  const canvasListeners = {};
  const clock = { now: 0 };
  const canvas = {
    width: 300, height: 150, tabIndex: 0, style: {},
    getContext: () => makeCtx(),
    addEventListener(type, fn) { (canvasListeners[type] = canvasListeners[type] || []).push(fn); },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    focus() {}
  };
  const documentElement = { dataset: {} };
  const document = {
    documentElement,
    body: { appendChild() {} },
    querySelector: () => canvas,
    getElementById: () => canvas,
    addEventListener() {},
    createElement: () => ({ style: {}, textContent: '' })
  };
  const sandbox = {
    console,
    document, canvas, canvasListeners,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    performance: { now: () => clock.now },
    Image: function () { this.complete = false; this.naturalWidth = 0; },
    addEventListener() {},
    requestAnimationFrame: (cb) => { rafCallbacks.push(cb); return rafCallbacks.length; },
    setTimeout: () => 0,
    clearTimeout: () => {}
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return sandbox;
}

const tb = {}; tb.window = tb; vm.createContext(tb);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-universal.js'), 'utf8'), tb, { filename: 'hydra-universal.js' });
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'starter-templates.js'), 'utf8'), tb, { filename: 'starter-templates.js' });
const project = tb.HydraStarterTemplates.createProject('flagship', 'Hydra Quest', () => 'playtest-id');

const sb = makeBrowserStubs();
for (const f of ['hydra-expr.js', 'hydra-input.js', 'hydra-audio.js', 'hydra-anim.js',
  'hydra-tween.js', 'hydra-ui.js', 'hydra-save.js', 'hydra-pause.js', 'hydra-camerafx.js', 'hydra-sceneinit.js', 'hydra-frame.js', 'hydra-physicsstep.js', 'hydra-scenereset.js', 'hydra-draw.js', 'hydra-dispatch.js', 'hydra-conditions.js', 'hydra-execute.js', 'hydra-particles.js', 'hydra-actions.js', 'hydra-buses.js', 'hydra-tiles.js', 'hydra-physics2d.js', 'hydra-flow.js', 'hydra-collections.js', 'hydra-math.js', 'hydra-pick.js', 'hydra-layerfx.js', 'hydra-gltf.js', 'hydra-3d.js', 'hydra-profile.js', 'hydra-scriptapi.js', 'hydra-statemachine.js', 'hydra-blendspace.js', 'hydra-light2d.js', 'hydra-joints.js', 'hydra-skeleton.js', 'hydra-localization.js', 'hydra-dialogue.js', 'hydra-inventory.js', 'hydra-quest.js', 'hydra-achievement.js', 'hydra-cutscene.js', 'hydra-highscore.js', 'hydra-timescale.js', 'hydra-transition.js', 'hydra-camerafeel.js', 'hydra-parallax.js', 'hydra-spatialaudio.js', 'hydra-pathfind.js', 'hydra-ai.js', 'hydra-joystick.js', 'hydra-health.js', 'hydra-damagefx.js', 'hydra-respawn.js', 'hydra-spawn.js', 'hydra-lives.js', 'hydra-movement.js', 'hydra-platform.js', 'hydra-combat.js', 'hydra-xp.js', 'hydra-growth.js', 'hydra-scaling.js', 'hydra-boss.js', 'hydra-tags.js', 'hydra-minimap.js', 'hydra-attach.js', 'hydra-variables.js', 'hydra-functions.js', 'hydra-loops.js', 'hydra-events.js', 'hydra-trace.js', 'player-runtime.js']) {
  vm.runInContext(fs.readFileSync(path.join(HYDRA, f), 'utf8'), sb, { filename: f });
}
const html = sb.window.HydraPlayer.buildPlayableHtml(project);
check('playtest export built', typeof html === 'string' && html.length > 50000, `length=${html && html.length}`);
if (failures) { console.error('playtest.test.js: export build failed'); process.exit(1); }

const tmpHtml = path.join(os.tmpdir(), `hydra-playtest-${process.pid}.html`);
fs.writeFileSync(tmpHtml, html);
console.log(`playtest export: ${tmpHtml} (${html.length} bytes)`);

// ---- Run the harness against it ----
const r = spawnSync(process.execPath, [
  path.join(__dirname, 'playtest-game.js'),
  '--template', 'flagship',
  '--game', tmpHtml,
], { encoding: 'utf8', timeout: 110000 });
if (r.stdout) process.stdout.write(r.stdout);
if (r.stderr) process.stderr.write(r.stderr);
if (r.status === 0) {
  check('end-to-end playtest passes (boot, labels, nav, move, jump, coin, enemy, goal, pause, game over, retry)', true);
  try { fs.unlinkSync(tmpHtml); } catch (e) { /* keep going */ }
} else {
  check('end-to-end playtest passes (boot, labels, nav, move, jump, coin, enemy, goal, pause, game over, retry)',
    false, `harness exit=${r.status}. Export kept at ${tmpHtml} for debugging.`);
}

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log('playtest.test.js: all checks passed');
