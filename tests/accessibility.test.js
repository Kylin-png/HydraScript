// Tests for P3 item 17 — accessibility pass: keyboard, labels, focus,
// responsive layout, reduced motion.
//
// Static wiring checks (live behavior is covered by browser-smoke.js):
// every button has an accessible name, every visible form control has a
// name, the logic grid and palette are keyboard-operable, dialogs move
// focus in and back out, and the stylesheet stacks panels + honors
// prefers-reduced-motion.

const fs = require('fs');
const path = require('path');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const HYDRA = path.join(__dirname, '..', 'hydra');
const indexHtml = fs.readFileSync(path.join(HYDRA, 'index.html'), 'utf8');
const homeHtml = fs.readFileSync(path.join(HYDRA, 'home.html'), 'utf8');
const css = fs.readFileSync(path.join(HYDRA, 'style.css'), 'utf8');
const js = fs.readFileSync(path.join(HYDRA, 'script.js'), 'utf8');
const propInputsJs = fs.readFileSync(path.join(HYDRA, 'hydra-propinputs.js'), 'utf8');
const projectJs = fs.readFileSync(path.join(HYDRA, 'project.js'), 'utf8');
const homeJs = fs.readFileSync(path.join(HYDRA, 'home.js'), 'utf8');

// ---- accessible names for every button in the static markup ----
// A button counts as named when it has a non-empty aria-label, or visible
// text once icon markup (<i>, material-icons spans) is stripped out.
function buttonName(tag, inner) {
  const aria = /aria-label="([^"]+)"/.exec(tag);
  if (aria && aria[1].trim()) return aria[1].trim();
  const text = inner
    .replace(/<i\b[^>]*>[\s\S]*?<\/i>/g, '')
    .replace(/<span class="material-icons[^"]*">[\s\S]*?<\/span>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
  return text;
}
function checkButtonsNamed(file, html) {
  const bad = [];
  for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    if (!buttonName(m[1], m[2])) {
      bad.push((m[1].match(/id="([^"]+)"/) || ['', m[1].slice(0, 60)])[1]);
    }
  }
  check(`every button in ${file} has an accessible name (aria-label or visible text)`,
    bad.length === 0, bad.length ? 'unnamed: ' + bad.join(', ') : '');
}
checkButtonsNamed('index.html', indexHtml);
checkButtonsNamed('home.html', homeHtml);

// ---- every visible form control has a name ----
// Named = aria-label, a <label for=id>, wrapped in a <label>, or a title.
function checkControlsNamed(file, html) {
  const labelFors = new Set([...html.matchAll(/<label\b[^>]*for="([^"]+)"/g)].map(m => m[1]));
  const labelSpans = [...html.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)]
    .map(m => [m.index, m.index + m[0].length,
      m[1].replace(/<input\b[^>]*>/g, '').replace(/<[^>]+>/g, '').trim()]);
  const bad = [];
  for (const m of html.matchAll(/<(input|select|textarea)\b([^>]*)>/g)) {
    const attrs = m[2];
    if (/type="(hidden|file)"/.test(attrs) && /display:\s*none/.test(attrs)) continue;
    if (/\bhidden\b/.test(attrs) || /display:\s*none/.test(attrs)) continue;
    if (/class="[^"]*\bhidden\b/.test(attrs)) continue;
    const id = (/id="([^"]+)"/.exec(attrs) || [])[1] || '';
    const aria = (/aria-label="([^"]+)"/.exec(attrs) || [])[1] || '';
    const title = (/title="([^"]+)"/.exec(attrs) || [])[1] || '';
    const wrapped = labelSpans.some(([a, b, text]) => m.index > a && m.index < b && text);
    if (!aria.trim() && !title.trim() && !labelFors.has(id) && !wrapped) {
      bad.push(id || attrs.slice(0, 60));
    }
  }
  check(`every visible form control in ${file} has an accessible name`,
    bad.length === 0, bad.length ? 'unnamed: ' + bad.join(', ') : '');
}
checkControlsNamed('index.html', indexHtml);
checkControlsNamed('home.html', homeHtml);

// ---- dynamic icon-only buttons in JS carry aria-labels ----
check('hub project-card buttons have aria-labels (home.js)',
  /project-rename-btn"[^>]*aria-label="Rename project"/.test(homeJs) &&
  /project-export-btn"[^>]*aria-label="Download project backup"/.test(homeJs) &&
  /project-delete-btn"[^>]*aria-label="Delete project"/.test(homeJs));
check('localization delete button has an aria-label (script.js)',
  /delBtn\.setAttribute\('aria-label', 'Delete string'\)/.test(js));
check('input-action delete button has an aria-label (script.js)',
  /input-action-delete"[^>]*aria-label="Delete action"/.test(js));

// ---- logic grid: keyboard navigation + cell labels ----
check('grid defines updateCellA11y with row/column/block naming',
  /function updateCellA11y\(cell\)/.test(js) &&
  /Row \$\{row\}, column \$\{col\}/.test(js));
check('grid cells use roving tabindex (one Tab stop)',
  /function setRovingCell\(cell\)/.test(js) &&
  /cell\.tabIndex\s*=\s*i === 0 \? 0 : -1/.test(js));
check('grid has a delegated keydown handler for arrows/Home/End/Enter/Delete/Escape',
  /grid\.addEventListener\('keydown'/.test(js) &&
  /case 'ArrowLeft'/.test(js) && /case 'ArrowRight'/.test(js) &&
  /case 'ArrowUp'/.test(js) && /case 'ArrowDown'/.test(js) &&
  /case 'Home'/.test(js) && /case 'End'/.test(js) &&
  /case 'Enter': case ' ':/.test(js) &&
  /case 'Delete': case 'Backspace':/.test(js) &&
  /case 'Escape':/.test(js));
check('cell keyboard activation reuses the click path (activateCell)',
  /function activateCell\(cell, shift\)/.test(js) &&
  /cell\.addEventListener\('click', e => \{ setRovingCell\(cell\); activateCell\(cell, e\.shiftKey\); \}\)/.test(js));
check('cell labels refresh when a block is placed or cleared',
  /applyBlockVisualToCell[\s\S]{0,400}updateCellA11y\(cell\)/.test(js) &&
  /clearBlockVisualFromCell[\s\S]{0,300}updateCellA11y\(cell\)/.test(js));
check('selecting a cell moves the roving Tab stop to it',
  /function selectCell\(cell\)[\s\S]{0,200}setRovingCell\(cell\)/.test(js));
check('grid container describes keyboard use in its aria-label',
  /class="grid-container"[^>]*aria-label="Logic grid\. Tab to a cell/.test(indexHtml));
check('diagnostics feed is a polite live region',
  /id="diagnostic-feed"[^>]*aria-live="polite"/.test(indexHtml));

// ---- block palette: keyboard navigation ----
check('palette options are buttons to assistive tech with labels',
  /opt\.setAttribute\('role', 'button'\)/.test(js) &&
  /opt\.setAttribute\('aria-label', label\)/.test(js));
check('palette uses roving tabindex with arrow/Enter/Space handling',
  /function setPaletteRoving\(opt\)/.test(js) &&
  /block-selector'\)\?\.addEventListener\('keydown'/.test(js) &&
  /e\.key === 'ArrowDown' \|\| e\.key === 'ArrowRight'/.test(js) &&
  /e\.key === 'Enter' \|\| e\.key === ' '\)/.test(js));
check('palette search filter keeps the Tab stop on a visible option',
  /const firstVisible = paletteVisibleOptions\(\)\[0\];/.test(js));

// ---- property-panel labels ----
// P2 item 14 slice 2: the label binding lives in hydra-propinputs.js now;
// script.js keeps the delegation and the load-time call.
check('makePropGroup binds its label to the control with for/id',
  /if \(input && !input\.id\) input\.id = 'hydra-prop-'/.test(propInputsJs) &&
  /if \(input && input\.id\) l\.htmlFor = input\.id;/.test(propInputsJs) &&
  /function makePropGroup\(label, input\) \{ return HydraPropInputs\.makePropGroup/.test(js));
check('static scene-settings groups get their labels bound at load',
  /function bindStaticPropGroupLabels\(doc\)/.test(propInputsJs) &&
  /label\.htmlFor = control\.id;/.test(propInputsJs) &&
  /bindStaticPropGroupLabels\(\);/.test(js));

// ---- dialog focus management ----
check('export dialog moves focus in on open and back to the opener on close',
  /exportDialogOpener = document\.activeElement;/.test(projectJs) &&
  /document\.getElementById\('export-dialog-close'\)\?\.focus\(\)/.test(projectJs) &&
  /if \(exportDialogOpener && document\.contains\(exportDialogOpener\)\) \{\s*\n?\s*exportDialogOpener\.focus\(\);/.test(projectJs));
check('new-project dialog returns focus to its opener on close',
  /newProjectDialogOpener = document\.activeElement;/.test(projectJs) &&
  /if \(newProjectDialogOpener && document\.contains\(newProjectDialogOpener\)\) \{\s*\n?\s*newProjectDialogOpener\.focus\(\);/.test(projectJs));
check('block picker closes on Escape and returns focus to its opener',
  /const pickerOpener = document\.activeElement;/.test(js) &&
  /backdrop\.addEventListener\('keydown', e => \{ if \(e\.key === 'Escape'\)/.test(js) &&
  /if \(pickerOpener && document\.contains\(pickerOpener\)\) pickerOpener\.focus\(\);/.test(js));

// ---- responsive layout + reduced motion ----
check('stylesheet stacks the scene inspector below the stage under 900px',
  /@media \(max-width: 900px\)/.test(css) &&
  /\.scene-side-panel \{\s*\n?\s*top: auto; left: 0; right: 0; bottom: 0;/.test(css));
check('stylesheet stacks the logic properties panel below the grid under 900px',
  /\.grid-editor \{ flex-direction: column; \}/.test(css) &&
  /\.grid-editor \.side-panel \{\s*\n?\s*width: 100%;/.test(css));
check('stylesheet collapses the block picker to one column under 900px',
  /\.picker-layout \{ grid-template-columns: 1fr;/.test(css));
check('stylesheet honors prefers-reduced-motion',
  /@media \(prefers-reduced-motion: reduce\)/.test(css) &&
  /animation-duration: 0\.01ms !important;/.test(css) &&
  /transition-duration: 0\.01ms !important;/.test(css));

console.log(failures === 0 ? 'accessibility: all checks passed' : `accessibility: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
