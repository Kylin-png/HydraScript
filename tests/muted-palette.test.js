// Unit tests for the P5-2 slice c muted palette — the editor shell's
// saturated accents are desaturated to 55% of their saturation (three
// white-text button backgrounds also lose 6% lightness so their white-on
// contrast stays >= 4.2). Pins the new values in hydra/style.css, pins
// the things this slice deliberately did NOT move (the logic-grid block
// colors, the palette swatches, the brand logo gradient, game-content
// defaults in script.js), and proves no old accent survives outside
// those excluded lines.

const fs = require('fs');
const path = require('path');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const STYLE_CSS = fs.readFileSync(
  path.join(__dirname, '..', 'hydra', 'style.css'), 'utf8');
const SCRIPT_JS = fs.readFileSync(
  path.join(__dirname, '..', 'hydra', 'script.js'), 'utf8');
const GUIDE = fs.readFileSync(
  path.join(__dirname, '..', 'docs', 'user-guide.md'), 'utf8');

// Match one rule block and test a property inside it, so a value in some
// other rule cannot satisfy the check by accident.
function ruleHas(name, selectorPattern, propPattern) {
  const re = new RegExp(selectorPattern + '\\s*\\{[^}]*' + propPattern + '[^}]*\\}', 's');
  check(name, re.test(STYLE_CSS));
}

// --- design tokens ---------------------------------------------------------
{
  check('primary token is the muted violet #8762c5 (was #7c3aed)',
    /--primary-color:\s*#8762c5;/.test(STYLE_CSS));
  check('secondary token is the muted red #c05454 (was #ef4444)',
    /--secondary-color:\s*#c05454;/.test(STYLE_CSS));
  check('advanced-condition token is the muted violet #997fd3 (was #8b5cf6)',
    /--advanced-condition-color:\s*#997fd3;/.test(STYLE_CSS));
  check('advanced-action token is the muted amber #c09040 (was #f59e0b)',
    /--advanced-action-color:\s*#c09040;/.test(STYLE_CSS));
  check('and-condition token is the muted green #369374 (was #10b981)',
    /--and-condition-color:\s*#369374;/.test(STYLE_CSS));
  check('focus ring is the muted blue rgba(78, 123, 196, 0.55)',
    /--focus-ring:\s*0 0 0 2px rgba\(78, 123, 196, 0\.55\);/.test(STYLE_CSS));
}

// --- header buttons ---------------------------------------------------------
{
  ruleHas('save button is the muted blue #4e7bc4 (was #3b82f6)',
    '\\.project-actions button#save-project-btn', 'background:\\s*#4e7bc4;');
  ruleHas('save button hover is the muted blue #5274be (was #2563eb)',
    '\\.project-actions button#save-project-btn:hover', 'background:\\s*#5274be;');
  ruleHas('export button is the muted green #369374 (was #10b981)',
    '\\.project-actions button#export-playable-btn', 'background:\\s*#369374;');
  ruleHas('export button hover is the muted green #26755d (was #059669)',
    '\\.project-actions button#export-playable-btn:hover', 'background:\\s*#26755d;');
  ruleHas('new-project Create button is the muted blue',
    '\\.new-project-actions button#new-project-create-btn', 'background:\\s*#4e7bc4;');
  ruleHas('active tab indicator is the muted violet #997fd3 (was #8b5cf6)',
    '\\.tab\\.active::after', 'background:\\s*#997fd3;');
  ruleHas('loading progress fill is the muted blue',
    '\\.loading-progress-fill', 'background:\\s*#4e7bc4;');
}

// --- inspector + panels ------------------------------------------------------
{
  ruleHas('inspector active tab is the muted indigo #6f6ac1 (was #4f46e5)',
    '\\.inspector-tab\\.active', 'background:\\s*#6f6ac1;');
  ruleHas('inspector active tab border is the muted violet #8762c5',
    '\\.inspector-tab\\.active', 'border-color:\\s*#8762c5;');
  ruleHas('panel count badge is the muted tint #e7eef8 / #5274be',
    '\\.panel-count', 'background:\\s*#e7eef8;[^}]*color:\\s*#5274be;');
  ruleHas('object list layer pill is the muted tint #f2f4fb / #6f6ac1',
    '\\.object-list-layer', 'background:\\s*#f2f4fb;[^}]*color:\\s*#6f6ac1;');
  ruleHas('object list active border is the muted blue',
    '\\.object-list-item\\.active', 'border-color:\\s*#4e7bc4;');
  ruleHas('scene list active item uses the muted primary token',
    '\\.scene-list-item\\.active', 'border-color:\\s*var\\(--primary-color\\);');
  ruleHas('scene delete button is the muted red #c05454 (was #ef4444)',
    '\\.scene-list-item button', 'background:\\s*#c05454;');
  ruleHas('clear button is the muted red',
    '\\.clear-btn', 'background:\\s*#c05454;');
  ruleHas('clear button hover is the muted red #b34f4f (was #dc2626)',
    '\\.clear-btn:hover', 'background:\\s*#b34f4f;');
  ruleHas('danger button still rides the secondary token',
    '\\.danger-btn', 'background:\\s*var\\(--secondary-color\\)');
  ruleHas('diagnostics count pill is the muted blue #5274be',
    '\\.diagnostics-header strong', 'background:\\s*#5274be;');
  ruleHas('diagnostic warning border is the muted amber',
    '\\.diagnostic-row\\.warning', 'border-left-color:\\s*#c09040;');
  ruleHas('diagnostic error border is the muted red',
    '\\.diagnostic-row\\.error', 'border-left-color:\\s*#c05454;');
  ruleHas('diagnostic info border is the muted sky',
    '\\.diagnostic-row\\.info', 'border-left-color:\\s*#63accd;');
  ruleHas('status diagnostics amber is muted #cbaa54 (was #fbbf24)',
    '\\.status-diagnostics\\.has-errors strong', 'color:\\s*#cbaa54;');
}

// --- logic tab chrome ---------------------------------------------------------
{
  ruleHas('scope tab active text is the muted blue',
    '\\.scope-tab\\.active', 'color:\\s*#4e7bc4;');
  ruleHas('scope tab active underline is the muted blue',
    '\\.scope-tab\\.active', 'border-bottom:\\s*2px solid #4e7bc4;');
  ruleHas('Add Block button is the muted indigo #6f6ac1',
    '\\.logic-tool-btn', 'background:\\s*#6f6ac1;');
  ruleHas('Add Block button border is the muted indigo #6b5e9d',
    '\\.logic-tool-btn', 'border:\\s*1px solid #6b5e9d;');
  ruleHas('Add Block button hover is the muted indigo #7469d1 (was #6d5dfc)',
    '\\.logic-tool-btn:hover', 'background:\\s*#7469d1;');
  ruleHas('scene toolbar active tool is the muted blue #4762ae (was #1d4ed8)',
    '\\.scene-tool-btn\\.active', 'background:\\s*#4762ae;');
  ruleHas('3D view toggle active is the muted sky #3f92b8 (was #0ea5e9)',
    '\\.scene-view-btn\\.active', 'background:\\s*#3f92b8;');
  ruleHas('script stat pill text is the muted pale blue #cdddf0',
    '\\.script-stat', 'color:\\s*#cdddf0;');
  ruleHas('focused property input border is the muted violet #b3a4e1',
    '\\.property-input:focus', 'border-color:\\s*#b3a4e1;');
  ruleHas('focused property input ring is the muted violet rgba',
    '\\.property-input:focus', 'box-shadow:\\s*0 0 0 2px rgba\\(135,98,197,0\\.22\\);');
  ruleHas('expression input with an expression is the muted tint',
    '\\.expr-input\\.has-expr', 'border-color:\\s*#4e7bc4(?: !important)?;[^}]*background:\\s*#f3f6fb(?: !important)?;[^}]*color:\\s*#3f518e(?: !important)?;');
  ruleHas('grid selection outline is the muted amber #c6ad49 (was #facc15)',
    '\\.cell\\.selected', 'outline:\\s*2px solid #c6ad49;');
  ruleHas('trace panel border is the muted cyan rgba(80,177,192,0.4)',
    '\\.trace-panel', 'border:\\s*1px solid rgba\\(80,177,192,0\\.4\\);');
  ruleHas('save toast is the muted green #369374',
    '\\.save-confirmation', 'background:\\s*#369374;');
}

// --- export dialog + white cards ----------------------------------------------
{
  ruleHas('export download button is the muted amber #c09040 (was #f59e0b)',
    '\\.export-download-btn', 'background:\\s*#c09040;');
  ruleHas('export download hover is the muted amber #cbaa54 (was #fbbf24)',
    '\\.export-download-btn:hover:not\\(:disabled\\)', 'background:\\s*#cbaa54;');
  ruleHas('export header icon is the muted amber',
    '\\.export-dialog-header h2 i', 'color:\\s*#c09040;');
  ruleHas('export checklist check is the muted green #58af8f (was #34d399)',
    '\\.export-checklist li::before', 'color:\\s*#58af8f;');
  ruleHas('export command chip text is the muted amber',
    '\\.export-cmd', 'color:\\s*#cbaa54;');
  ruleHas('export capabilities line is the muted sky #9ac9df (was #7dd3fc)',
    '\\.export-capabilities', 'color:\\s*#9ac9df;');
  ruleHas('variable type badge is the muted indigo #6f6ac1 on #f2f4fb',
    '\\.var-row \\.var-type', 'color:\\s*#6f6ac1;[^}]*background:\\s*#f2f4fb;');
  ruleHas('variable live dot is the muted green #47a068 (was #22c55e)',
    '\\.var-row \\.var-live-dot', 'background:\\s*#47a068;');
  ruleHas('asset used badge is the muted green tint',
    '\\.asset-badge', 'background:\\s*#e3f5e9;[^}]*color:\\s*#285338;');
  ruleHas('asset unused badge is the muted amber tint',
    '\\.asset-badge\\.unused', 'background:\\s*#f2ecd3;[^}]*color:\\s*#74472c;');
  ruleHas('audio bus slider accent is the muted amber #aa7435 (was #d97706)',
    '\\.audio-bus-slider', 'accent-color:\\s*#aa7435;');
  ruleHas('empty-state icon is the muted tint #e7eef8 / #4e7bc4',
    '\\.hydra-empty \\.hydra-empty-icon', 'background:\\s*#e7eef8;[^}]*color:\\s*#4e7bc4;');
  ruleHas('empty-state action button is the muted blue',
    '\\.hydra-empty \\.hydra-empty-action', 'background:\\s*#4e7bc4;');
  ruleHas('grid empty-hint button is the muted blue',
    '\\.grid-empty-hint \\.grid-empty-hint-btn', 'background:\\s*#4e7bc4;');
  ruleHas('grid empty-hint icon is the muted amber',
    '\\.grid-empty-hint > i', 'color:\\s*#cbaa54;');
}

// --- what this slice did NOT move ----------------------------------------------
{
  // Logic-grid block colors: the functional coding system stays saturated.
  ruleHas('condition block stays saturated blue #3b82f6',
    '\\.cell\\.condition', '--block-color:\\s*#3b82f6;');
  ruleHas('action block stays saturated red #ef4444',
    '\\.cell\\.action', '--block-color:\\s*#ef4444;');
  ruleHas('advanced-condition block stays saturated violet #8b5cf6',
    '\\.cell\\.advanced-condition', '--block-color:\\s*#8b5cf6;');
  ruleHas('advanced-action block stays saturated amber #f59e0b',
    '\\.cell\\.advanced-action', '--block-color:\\s*#f59e0b;');
  ruleHas('and-condition block stays saturated green #10b981',
    '\\.cell\\.and-condition', '--block-color:\\s*#10b981;');
  ruleHas('palette swatch for conditions stays saturated blue',
    '\\.condition-color', 'background:\\s*#3b82f6;');
  ruleHas('palette swatch for actions stays saturated red',
    '\\.action-color', 'background:\\s*#ef4444;');
  check('brand logo gradient stays the saturated violet-blue',
    /linear-gradient\(135deg, #7c3aed 0%, #3b82f6 100%\)/.test(STYLE_CSS));
  check('brand logo glow stays the saturated violet rgba',
    /rgba\(124, 58, 237, 0\.5\)/.test(STYLE_CSS) &&
    /rgba\(124, 58, 237, 0\.45\)/.test(STYLE_CSS));

  // No old accent may survive outside an excluded line (a block-color
  // assignment, a palette swatch, or a brand-gradient line).
  const oldHexes = ['#7c3aed', '#8b5cf6', '#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#2563eb', '#4f46e5'];
  const bad = [];
  STYLE_CSS.split('\n').forEach((line, idx) => {
    if (line.includes('--block-color:')) return;
    if (/^\s*\.(condition|action|advanced-condition|advanced-action)-color\s*\{/.test(line)) return;
    if (line.includes('linear-gradient(135deg, #7c3aed')) return;
    for (const old of oldHexes) {
      if (line.toLowerCase().includes(old)) bad.push(`style.css:${idx + 1} ${old} :: ${line.trim()}`);
    }
  });
  check('no old saturated accent survives outside block colors / swatches / brand',
    bad.length === 0, bad.join(' | '));

  // script.js: only the scene delete button's inline style moved; the
  // button-widget default colors (game content) are untouched.
  check('scene delete button inline style is the muted red',
    /delBtn\.style\.cssText = '[^']*background:#c05454;/.test(SCRIPT_JS));
  check('button-widget default colors are untouched (game content)',
    SCRIPT_JS.includes("styleColorInput('normal', 'Normal color:', '#3b82f6')") &&
    SCRIPT_JS.includes("styleColorInput('hover', 'Hover color:', '#60a5fa')") &&
    SCRIPT_JS.includes("styleColorInput('pressed', 'Pressed color:', '#1d4ed8')"));
}

// --- docs ----------------------------------------------------------------------
{
  check('user guide documents the muted palette',
    GUIDE.includes('**Muted palette:**') && GUIDE.includes('less saturated'));
}

if (failures) { console.log(`${failures} check(s) failed`); process.exit(1); }
console.log('muted-palette.test.js: all checks passed');
