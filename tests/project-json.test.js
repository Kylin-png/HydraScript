// Tests for P3 item 15 — editor project JSON import/export + templates
// from inside the editor.
//
// The hub (home.html) already imported/exported .hydra files and offered
// templates; the editor had neither. These are static wiring checks (the
// live behavior is covered by browser-smoke.js): the header buttons, the
// New Project dialog, the starter-templates script load, and the
// import/export/new-project handlers in project.js.

const fs = require('fs');
const path = require('path');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const html = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'style.css'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', 'hydra', 'project.js'), 'utf8');
const guide = fs.readFileSync(path.join(__dirname, '..', 'docs', 'user-guide.md'), 'utf8');

check('editor header has New, Import JSON, and Export JSON buttons',
  /id="new-project-btn"/.test(html) && /id="import-json-btn"/.test(html) &&
  /id="export-json-btn"/.test(html));
check('import file input accepts .hydra and .json',
  /id="import-json-file"[^>]*accept="\.hydra,\.json,application\/json"/.test(html));
check('new-project dialog has name input, template select, description, create and cancel',
  /id="new-project-dialog"/.test(html) && /id="new-project-name"/.test(html) &&
  /id="new-project-template"/.test(html) && /id="new-project-template-desc"/.test(html) &&
  /id="new-project-create-btn"/.test(html) && /id="new-project-cancel-btn"/.test(html) &&
  /id="new-project-dialog-close"/.test(html));
check('starter-templates loads in the editor before project.js',
  html.indexOf('starter-templates.js') !== -1 &&
  html.indexOf('starter-templates.js') < html.indexOf('src="project.js'));
check('header buttons are wired in project.js',
  /newProjectBtn\?\.addEventListener\('click', openNewProjectDialog\)/.test(js) &&
  /importJsonBtn\?\.addEventListener\('click'/.test(js) &&
  /importJsonFile\?\.addEventListener\('change', importProjectJson\)/.test(js) &&
  /exportJsonBtn\?\.addEventListener\('click', exportProjectJson\)/.test(js));
check('export JSON saves first, serializes, and downloads a .hydra file',
  /function exportProjectJson\(\)[\s\S]{0,600}saveProject\(\{ silent: true \}\)/.test(js) &&
  /serializeProject\(currentProject\)/.test(js) &&
  /downloadBlob\(blob, `\$\{safeJsonFileName\(currentProject\.name\)\}\.hydra`\)/.test(js));
check('import JSON rejects non-objects and arrays, sanitizes the id, normalizes',
  /Array\.isArray\(parsed\)/.test(js) && /Invalid project file/.test(js) &&
  /replace\(\/\[\^a-z0-9_-\]\/gi, ''\)/.test(js) &&
  /normalizeProject\?\.\(imported\)/.test(js));
check('import JSON gives a colliding id a fresh id instead of overwriting',
  /imported\.id = generateId\(\)/.test(js));
check('import JSON alerts on failure and leaves the project in place',
  /alert\('Failed to import project: ' \+ error\.message\)/.test(js));
check('import and new-project both open the result with a reload',
  (js.match(/window\.location\.reload\(\)/g) || []).length >= 2);
check('new-project dialog populates its select from the template list',
  /newProjectTemplates\(\)\.forEach/.test(js) &&
  /HydraStarterTemplates\?\.templates/.test(js));
check('new-project creation uses createProject and falls back to a blank project',
  /HydraStarterTemplates\.createProject\(templateId, name, generateId\)/.test(js) &&
  /createNewProject\(\)/.test(js));
check('new-project dialog closes on its close button, cancel, overlay click, and Escape',
  /new-project-dialog-close'\)\?\.addEventListener\('click', closeNewProjectDialog\)/.test(js) &&
  /new-project-cancel-btn'\)\?\.addEventListener\('click', closeNewProjectDialog\)/.test(js) &&
  /e\.target\.id === 'new-project-dialog'/.test(js) &&
  /e\.key === 'Escape'/.test(js));
check('stylesheet styles the new-project dialog form',
  /\.new-project-panel/.test(css) && /\.new-project-form/.test(css) &&
  /#new-project-create-btn/.test(css));
check('user guide documents the editor New / Import JSON / Export JSON buttons',
  /Export JSON/.test(guide) && /Import JSON/.test(guide) && /\*\*New\*\*/.test(guide));

if (failures) { console.log(`${failures} check(s) failed`); process.exit(1); }
console.log('project-json.test.js: all checks passed');
