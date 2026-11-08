// Unit tests for the P5-2 slice b dense editor shell — denser panels and a
// smaller professional type scale (12px base for panel UI).
//
// Pins the CSS values in hydra/style.css: the chrome type scale (logo,
// project name, header buttons, top tabs, the global button rule), the
// panel density (side-panel padding, section padding/margins, inspector
// tabs, property rows, palette rows, list rows, white cards), and the
// things this slice deliberately did NOT move (header/tab heights, the
// 56px grid cells, the status bar). Colors are untouched by this slice.

const fs = require('fs');
const path = require('path');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const STYLE_CSS = fs.readFileSync(
  path.join(__dirname, '..', 'hydra', 'style.css'), 'utf8');
const GUIDE = fs.readFileSync(
  path.join(__dirname, '..', 'docs', 'user-guide.md'), 'utf8');

// Match one rule block and test a property inside it, so a value in some
// other rule cannot satisfy the check by accident.
function ruleHas(name, selectorPattern, propPattern) {
  const re = new RegExp(selectorPattern + '\\s*\\{[^}]*' + propPattern + '[^}]*\\}', 's');
  check(name, re.test(STYLE_CSS));
}

// --- chrome type scale: 12px base for editor UI ---------------------------
{
  ruleHas('wordmark is 16px (was 18px)',
    '\\.logo h1', 'font-size:\\s*16px;');
  ruleHas('project name is 13px (was 14px)',
    '#project-name', 'font-size:\\s*13px;');
  ruleHas('header action buttons are 12px with tighter padding',
    '\\.project-actions button', 'padding:\\s*6px 12px;[^}]*font-size:\\s*12px;');
  ruleHas('top tabs are 12px (was 13px)',
    '\\.tab', 'font-size:\\s*12px;');
  ruleHas('global button rule is 12px with 7px 12px padding',
    '\\nbutton', 'padding:\\s*7px 12px;[^}]*font-size:\\s*12px;');
}

// --- panel density ---------------------------------------------------------
{
  ruleHas('logic-tab side panel padding is 12px (was 16px)',
    '\\.side-panel', 'padding:\\s*12px;');
  ruleHas('panel sections are 8px with an 8px gap (was 10px)',
    '\\.panel-section', 'margin-bottom:\\s*8px;[^}]*padding:\\s*8px;');
  ruleHas('scene side-panel sections are 8px too (the override must move)',
    '\\.scene-side-panel \\.panel-section', 'padding:\\s*8px;');
  ruleHas('section headings have 6px of breathing room (was 8px)',
    '\\.panel-section h3', 'padding-bottom:\\s*6px;[^}]*margin-bottom:\\s*6px;');
  ruleHas('section headers have 6px of breathing room (was 8px)',
    '\\.panel-section-header', 'padding-bottom:\\s*6px;[^}]*margin-bottom:\\s*6px;');
  ruleHas('inspector tab strip has 6px below it (was 8px)',
    '\\.inspector-tabs', 'padding-bottom:\\s*6px;[^}]*margin-bottom:\\s*6px;');
  ruleHas('inspector tabs are 30px min-height with 3px vertical padding',
    '\\.inspector-tab', 'min-height:\\s*30px;[^}]*padding:\\s*3px 4px;');
}

// --- property rows ----------------------------------------------------------
{
  ruleHas('property groups have a 6px gap (was 8px)',
    '\\.prop-group', 'margin-bottom:\\s*6px;');
  ruleHas('property labels are 11px (was 12px)',
    '\\.prop-group label', 'font-size:\\s*11px;');
  ruleHas('property groups have an 8px gap (was 12px)',
    '\\.property-group', 'margin-bottom:\\s*8px;');
  ruleHas('property-group labels are 11px (was 12px)',
    '\\.property-group label', 'font-size:\\s*11px;');
  ruleHas('property inputs are 12px with 6px 8px padding',
    '\\.property-input', 'padding:\\s*6px 8px;[^}]*font-size:\\s*12px;');
  ruleHas('hint text is 11px (was 12px)',
    '\\.hint-text', 'font-size:\\s*11px;');
  ruleHas('scene-panel inputs are 30px rows (was 34px)',
    '\\.scene-side-panel \\.property-input', 'min-height:\\s*30px;');
  ruleHas('scene-panel buttons are 30px rows (was 32px)',
    '\\.scene-side-panel button', 'min-height:\\s*30px;');
  ruleHas('small action buttons are 30px rows (was 34px)',
    '\\.small-action-btn', 'min-height:\\s*30px;');
}

// --- block palette (logic tab) ----------------------------------------------
{
  ruleHas('block selector gap is 4px (was 6px)',
    '\\.block-selector', 'gap:\\s*4px;');
  ruleHas('category labels have 6px of top padding (was 8px)',
    '\\.block-category-label', 'padding:\\s*6px 4px 2px;');
  ruleHas('block options are 7px 9px rows (was 9px 10px)',
    '\\.block-option', 'padding:\\s*7px 9px;');
}

// --- lists and create panel ---------------------------------------------------
{
  ruleHas('scene list items are 12px with 6px 8px padding',
    '\\.scene-list-item', 'padding:\\s*6px 8px;[^}]*font-size:\\s*12px;');
  ruleHas('object list gap is 4px (was 6px)',
    '\\.scene-object-list', 'gap:\\s*4px;');
  ruleHas('object list items are 6px 8px rows (was 8px)',
    '\\.object-list-item', 'padding:\\s*6px 8px;');
  ruleHas('create grid gap is 6px (was 8px)',
    '\\.object-create-grid', 'gap:\\s*6px;');
  ruleHas('create buttons are 7px 10px (was 9px 10px)',
    '\\.object-create-btn', 'padding:\\s*7px 10px;');
  ruleHas('add-object row gap is 6px (was 8px)',
    '\\.add-object-row', 'gap:\\s*6px;');
  ruleHas('add-object button is 6px 10px (was 8px 12px)',
    '\\.add-object-row button', 'padding:\\s*6px 10px;');
  ruleHas('back button is 12px (was 13px)',
    '\\.back-button', 'font-size:\\s*12px;');
  ruleHas('checkbox rows are 12px (was 13px)',
    '\\.checkbox-row', 'font-size:\\s*12px;');
  ruleHas('upload button is 6px 10px (was 7px 12px)',
    '\\.upload-btn', 'padding:\\s*6px 10px;');
}

// --- inspector sub-panels and white cards ------------------------------------
{
  ruleHas('physics panel padding is 8px (was 10px)',
    '\\.physics-panel', 'padding:\\s*8px;');
  ruleHas('hitbox editor padding is 8px (was 10px)',
    '\\.hitbox-editor', 'padding:\\s*8px;');
  ruleHas('UI layout editor padding is 8px (was 10px)',
    '\\.ui-layout-editor', 'padding:\\s*8px;');
  ruleHas('component section headings are 12px (was 13px)',
    '\\.component-section-header h4', 'font-size:\\s*12px;');
  ruleHas('component card bodies are 7px 8px (was 9px 10px)',
    '\\.component-card-body', 'padding:\\s*7px 8px;');
  ruleHas('input-action rows are 6px (was 8px)',
    '\\.input-action-row', 'padding:\\s*6px;');
  ruleHas('audio-bus rows are 6px (was 8px)',
    '\\.audio-bus-row', 'padding:\\s*6px;');
  ruleHas('audio-bus names are 12px (was 13px)',
    '\\.audio-bus-name', 'font-size:\\s*12px;');
  ruleHas('animation cards are 6px (was 8px)',
    '\\.animation-card', 'padding:\\s*6px;');
  ruleHas('variables rows name at 12px (was 13px)',
    '\\.var-row \\.var-name', 'font-size:\\s*12px;');
  ruleHas('asset list gap is 6px (was 8px)',
    '\\.asset-list', 'gap:\\s*6px;');
  ruleHas('asset rows are 6px 8px (was 8px)',
    '\\.asset-row', 'padding:\\s*6px 8px;');
  ruleHas('asset names are 12px (was 13px)',
    '\\.asset-name', 'font-size:\\s*12px;');
  ruleHas('live-variables header is 12px (was 13px)',
    '\\.preview-variables-header', 'font-size:\\s*12px;');
  ruleHas('tutorial panel is 12px (was 13px)',
    '\\.tutorial-panel', 'font-size:\\s*12px;');
  ruleHas('tutorial title is 13px (was 14px)',
    '\\.tutorial-panel-title', 'font-size:\\s*13px;');
}

// --- what this slice did NOT move --------------------------------------------
{
  ruleHas('header height stays 48px (chrome height is a later slice)',
    '\\.header', 'height:\\s*48px;');
  ruleHas('tab strip height stays 44px',
    '\\.tabs', 'height:\\s*44px;');
  ruleHas('content area still starts below the 48px header + 44px tabs',
    '\\.content-area', 'top:\\s*92px;');
  ruleHas('grid cells stay 56px (the scripting canvas is not a panel)',
    '\\.grid', 'grid-template-columns:\\s*repeat\\(60, 56px\\);');
  ruleHas('status bar stays 28px (slice a, pinned again here as a guard)',
    '\\.status-bar', 'height:\\s*28px;');
  check('section headings stay 11px uppercase (only spacing moved)',
    /\.panel-section h3\s*\{[^}]*font-size:\s*11px;[^}]*text-transform:\s*uppercase;/s.test(STYLE_CSS));
  check('block labels stay 12px (already at the new base size)',
    /\.block-label\s*\{[^}]*font-size:\s*12px;/s.test(STYLE_CSS));
}

// --- docs ----------------------------------------------------------------------
{
  check('user guide documents the compact panels (12px type scale)',
    GUIDE.includes('**Compact panels:**') &&
    GUIDE.includes('dense 12px type scale'));
}

if (failures) { console.log(`${failures} check(s) failed`); process.exit(1); }
console.log('editor-density.test.js: all checks passed');
