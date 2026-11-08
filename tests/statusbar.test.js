// Unit tests for the P5-2 slice a status bar — the thin bar at the bottom
// of the editor showing the current scene, the object count, the live
// preview FPS, and the diagnostics count.
//
// Covers the three layers: the preview runtime's previewFps() getter
// (live FPS from the profiler's rolling average, 0 when no run is live),
// the footer markup + styles in index.html / style.css, and the
// updateStatusBar() wiring in script.js (500ms tick, change-only DOM
// writes, diagnostics click opens the dock).

const fs = require('fs');
const path = require('path');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}
function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected),
    `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

const INDEX_HTML = fs.readFileSync(
  path.join(__dirname, '..', 'hydra', 'index.html'), 'utf8');
const STYLE_CSS = fs.readFileSync(
  path.join(__dirname, '..', 'hydra', 'style.css'), 'utf8');
const SCRIPT_JS = fs.readFileSync(
  path.join(__dirname, '..', 'hydra', 'script.js'), 'utf8');
const PREVIEW_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'hydra', 'hydra-previewruntime.js'), 'utf8');
const GUIDE = fs.readFileSync(
  path.join(__dirname, '..', 'docs', 'user-guide.md'), 'utf8');
const factory = require(path.join(__dirname, '..', 'hydra', 'hydra-previewruntime.js'));

// --- previewFps() --------------------------------------------------------
// The getter reads the profiler through the getModule provider and the
// run state through the host's getRunState, the same two providers the
// frame loop's profile hook uses.
function runtimeWith(run, profile) {
  const T = factory();
  T.configure({
    getModule: (name) => (name === 'Profile' ? profile : null),
    host: { getRunState: () => run }
  });
  return T;
}

{
  const T = factory();
  check('factory exposes previewFps', typeof T.previewFps === 'function');
  eq('previewFps with no host and no run state is 0', T.previewFps(), 0);
}
{
  const run = { profiler: { samples: [16.7, 16.7, 16.7] } };
  const profile = { stats: () => ({ fps: 59.7, frameMs: 16.7 }) };
  const T = runtimeWith(run, profile);
  T.startGame();
  eq('previewFps returns the profiler fps for a live run',
    T.previewFps(), 59.7);
}
{
  // The profiler keeps its last samples after a stop, so a stopped run
  // must read 0 — not the stale FPS. (Caught by the visual QA: the bar
  // still showed 49 FPS on the Scene tab after the preview stopped.)
  const run = { profiler: { samples: [16.7, 16.7, 16.7] } };
  const profile = { stats: () => ({ fps: 59.7, frameMs: 16.7 }) };
  const T = runtimeWith(run, profile);
  T.startGame();
  T.stopPreviewLoop();
  eq('previewFps is 0 after the loop stops (stale profiler samples ignored)',
    T.previewFps(), 0);
}
{
  const run = {};
  const profile = { stats: () => ({ fps: 60 }) };
  eq('previewFps with a run but no profiler is 0',
    runtimeWith(run, profile).previewFps(), 0);
}
{
  const run = { profiler: {} };
  eq('previewFps with no Profile module is 0',
    runtimeWith(run, null).previewFps(), 0);
}
{
  const run = { profiler: {} };
  const profile = {};
  eq('previewFps with a Profile module but no stats is 0',
    runtimeWith(run, profile).previewFps(), 0);
}
{
  const run = { profiler: {} };
  const profile = { stats: () => { throw new Error('boom'); } };
  eq('previewFps with a throwing stats degrades to 0',
    runtimeWith(run, profile).previewFps(), 0);
}
{
  const run = { profiler: {} };
  const profile = { stats: () => ({ fps: 0 }) };
  eq('previewFps with zero fps (no frame recorded yet) is 0',
    runtimeWith(run, profile).previewFps(), 0);
}
{
  const run = { profiler: {} };
  const profile = { stats: () => ({ fps: NaN }) };
  eq('previewFps with a non-finite fps is 0',
    runtimeWith(run, profile).previewFps(), 0);
}
{
  const T = factory();
  T.configure({
    getModule: () => { throw new Error('boom'); },
    host: { getRunState: () => { throw new Error('boom'); } }
  });
  eq('previewFps with throwing providers degrades to 0', T.previewFps(), 0);
}
{
  check('previewruntime.js exports previewFps next to isPreviewRunning',
    /previewFps: previewFps,/.test(PREVIEW_SRC));
}

// --- markup ---------------------------------------------------------------
{
  check('index.html has the status-bar footer with the contentinfo role',
    INDEX_HTML.includes('<footer class="status-bar" id="status-bar" role="contentinfo"'));
  check('status bar carries the scene name element',
    INDEX_HTML.includes('id="status-scene-name"'));
  check('status bar carries the object count element',
    INDEX_HTML.includes('id="status-object-count"'));
  check('status bar carries the FPS value element',
    INDEX_HTML.includes('id="status-fps-value"'));
  check('status bar carries the diagnostics button and count',
    INDEX_HTML.includes('id="status-diagnostics"') &&
    INDEX_HTML.includes('id="status-diagnostics-count"'));
  check('status bar shows a dash for FPS before any preview runs',
    INDEX_HTML.includes('<strong id="status-fps-value">—</strong>'));
  check('status bar sits after the content area and before the dialogs',
    INDEX_HTML.indexOf('id="status-bar"') > INDEX_HTML.indexOf('id="diagnostics-dock"') &&
    INDEX_HTML.indexOf('id="status-bar"') < INDEX_HTML.indexOf('id="new-project-dialog"'));
}

// --- styles ---------------------------------------------------------------
{
  check('status bar is a fixed 28px bar pinned to the bottom',
    /\.status-bar\s*\{[^}]*position:\s*fixed;[^}]*bottom:\s*0;[^}]*height:\s*28px;/s.test(STYLE_CSS));
  check('status bar uses the muted shell palette (dark bar, hairline top border)',
    /\.status-bar\s*\{[^}]*background:\s*#171820;[^}]*border-top:\s*1px solid #2f303a;/s.test(STYLE_CSS));
  check('content area ends above the status bar',
    /\.content-area\s*\{[^}]*bottom:\s*28px;/s.test(STYLE_CSS));
  check('diagnostics dock clears the status bar (28px bar + 14px gap)',
    /\.diagnostics-dock\s*\{[^}]*bottom:\s*42px;/s.test(STYLE_CSS));
  check('diagnostics item turns muted amber when errors are open',
    /\.status-diagnostics\.has-errors strong\s*\{[^}]*color:\s*#cbaa54;/s.test(STYLE_CSS));
  check('scene name truncates with an ellipsis instead of overflowing',
    /#status-scene-name\s*\{[^}]*text-overflow:\s*ellipsis;/s.test(STYLE_CSS));
  check('status items never shrink (the spacer absorbs the slack)',
    /\.status-item\s*\{[^}]*flex-shrink:\s*0;/s.test(STYLE_CSS));
  check('diagnostics button resets the global button width: 100% rule',
    /\.status-diagnostics\s*\{[^}]*width:\s*auto;[^}]*flex:\s*0 0 auto;/s.test(STYLE_CSS));
}

// --- script.js wiring ------------------------------------------------------
{
  check('script.js defines updateStatusBar',
    /function updateStatusBar\(\)/.test(SCRIPT_JS));
  check('updateStatusBar reads the scene name and object count from getCurrentScene',
    /getCurrentScene\(\)/.test(SCRIPT_JS) && /scene\.objects/.test(SCRIPT_JS));
  check('updateStatusBar reads FPS through HydraPreviewRuntime.previewFps',
    /HydraPreviewRuntime\.previewFps\(\)/.test(SCRIPT_JS));
  check('updateStatusBar reads the diagnostics count from the dock count element',
    /getElementById\('diagnostic-count'\)/.test(SCRIPT_JS));
  check('updateStatusBar shows a dash for FPS while no preview runs',
    /fps > 0\) \? String\(Math\.round\(fps\)\) : '—'/.test(SCRIPT_JS));
  check('updateStatusBar flags the diagnostics item when errors are open',
    /classList\.toggle\('has-errors', diagCount > 0\)/.test(SCRIPT_JS));
  check('updateStatusBar only writes the DOM when a value changed',
    /lastStatusBar\.fps !== fpsText/.test(SCRIPT_JS) &&
    /lastStatusBar\.diagnostics !== diagCount/.test(SCRIPT_JS));
  check('status bar refreshes on a 500ms tick like the Live variables readout',
    /setInterval\(updateStatusBar, 500\)/.test(SCRIPT_JS));
  check('status bar is initialized at editor load',
    /if \(typeof initStatusBar === 'function'\) initStatusBar\(\);/.test(SCRIPT_JS));
  check('clicking the diagnostics item opens the dock (removes is-collapsed)',
    /statusBarEls\.diagnostics[\s\S]*?classList\.remove\('is-collapsed'\)/.test(SCRIPT_JS));
  check('the status-bar updater never throws out of its own try block',
    /function updateStatusBar\(\) \{\s*try \{/.test(SCRIPT_JS));
}

// --- docs ------------------------------------------------------------------
{
  check('user guide documents the status bar (scene, objects, FPS, diagnostics)',
    GUIDE.includes('**Status bar:**') &&
    GUIDE.includes('live preview FPS') &&
    GUIDE.includes('clicking it opens the diagnostics panel'));
}

if (failures) { console.log(`${failures} check(s) failed`); process.exit(1); }
console.log('statusbar.test.js: all checks passed');
