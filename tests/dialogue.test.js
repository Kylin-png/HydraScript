// Unit tests for hydra/hydra-dialogue.js — the shared dialogue system
// (P4 Advanced batch 7: named conversations).
//
// Pure logic: dialogue-table normalization (repairs, drops, dedupe,
// goto coercion), name/id lookups, the typewriter runtime (start /
// update / advance / choose / stop), the current-line display state,
// and the action/condition routing sets. Nothing here touches the
// DOM; both runtimes delegate to this module. Static checks at the end
// pin the wiring: catalog blocks, editor tab + panel, both runtimes'
// dispatch, and the export inlining.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HYDRA = path.join(__dirname, '..', 'hydra');
const REPO = path.join(__dirname, '..');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const sandbox = {};
sandbox.window = sandbox; // hydra-dialogue.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-dialogue.js'), 'utf8'),
  sandbox, { filename: 'hydra-dialogue.js' });
const D = sandbox.HydraDialogue;

check('HydraDialogue exposed with helpers',
  !!D && typeof D.normalizeDialogues === 'function' && typeof D.dialogueNames === 'function' &&
  typeof D.getDialogue === 'function' && typeof D.createDialogueRuntime === 'function' &&
  typeof D.currentLine === 'function' && typeof D.currentDialogue === 'function' &&
  typeof D.choiceCount === 'function' && typeof D.choiceLabel === 'function' &&
  typeof D.isDialogueActive === 'function' && typeof D.isDialogueWaitingChoice === 'function' &&
  typeof D.startDialogue === 'function' && typeof D.updateDialogue === 'function' &&
  typeof D.advanceDialogue === 'function' && typeof D.chooseDialogue === 'function' &&
  typeof D.stopDialogue === 'function' && typeof D.isDialogueAction === 'function' &&
  typeof D.isDialogueCondition === 'function');
check('factorySource is a self-contained function string',
  typeof D.factorySource === 'string' && D.factorySource.includes('hydraDialogueFactory'));
check('default typing speed is 40 chars/sec', D.DEFAULT_CHARS_PER_SEC === 40);

function guardDialogue() {
  return {
    id: 'dlg_guard', name: 'Guard intro',
    lines: [
      { speaker: 'Guard', text: 'Halt! Who goes there?' },
      { speaker: 'Hero', text: 'Just a traveler.',
        choices: [
          { label: 'Show the pass', goto: 2 },
          { label: 'Run away', goto: 3 }
        ] },
      { speaker: 'Guard', text: 'Pass accepted. Move along.' },
      { speaker: 'Guard', text: 'Guards! Seize them!' }
    ]
  };
}

function makeHooks() {
  const writes = [];
  return {
    writes,
    hooks: {
      warn: function (msg) { writes.push(['warn', msg]); },
      setObjectText: function (name, text) { writes.push([name, text]); }
    }
  };
}

// --- normalization ---
{
  check('null normalizes to an empty list', JSON.stringify(D.normalizeDialogues(null)) === '[]');
  check('a non-array normalizes to an empty list', JSON.stringify(D.normalizeDialogues({})) === '[]');
  const list = [
    { id: 'a', name: ' Guard intro ', lines: [
      { speaker: 'Guard', text: 'Hi', choices: [{ label: 'Go', goto: 1 }, { label: '', goto: 0 }, { label: 'Bad', goto: 1.5 }, { label: 'Neg', goto: -1 }, { label: 'Str', goto: '2' }, null] },
      null, 'junk',
      { speaker: 7, text: 42 }
    ] },
    { name: 'Guard intro', lines: [] },
    { name: '  ', lines: [] },
    null, 'junk',
    { name: 'Second', lines: 'nope' }
  ];
  const norm = D.normalizeDialogues(list);
  check('normalization is in place (same array identity)', norm === list, 'identity changed');
  check('duplicate names collapse to the first, blank names drop, junk drops',
    JSON.stringify(D.dialogueNames(list)) === '["Guard intro","Second"]', JSON.stringify(D.dialogueNames(list)));
  const first = D.getDialogue(list, 'Guard intro');
  check('dialogue names trim', first && first.name === 'Guard intro');
  check('line speaker/text coerce to strings', first.lines[1].speaker === '7' && first.lines[1].text === '42',
    JSON.stringify(first.lines[1]));
  check('blank-label choices drop, bad gotos coerce to null, numeric strings coerce',
    JSON.stringify(first.lines[0].choices) ===
    '[{"label":"Go","goto":1},{"label":"Bad","goto":null},{"label":"Neg","goto":null},{"label":"Str","goto":2}]',
    JSON.stringify(first.lines[0].choices));
  check('junk lines drop, non-array lines repair to []',
    first.lines.length === 2 && Array.isArray(D.getDialogue(list, 'Second').lines) &&
    D.getDialogue(list, 'Second').lines.length === 0);
}

// --- lookups ---
{
  const list = [guardDialogue()];
  check('getDialogue finds by name', D.getDialogue(list, 'Guard intro') === list[0]);
  check('getDialogue finds by id', D.getDialogue(list, 'dlg_guard') === list[0]);
  check('getDialogue trims the name', D.getDialogue(list, '  Guard intro  ') === list[0]);
  check('getDialogue returns null for blank names', D.getDialogue(list, '  ') === null);
  check('getDialogue returns null for unknown names', D.getDialogue(list, 'Nobody') === null);
  check('getDialogue returns null for a null table', D.getDialogue(null, 'Guard intro') === null);
  check('dialogueNames returns a copy', (() => {
    const names = D.dialogueNames(list);
    names.push('bogus');
    return D.dialogueNames(list).length === 1;
  })());
}

// --- runtime shape ---
{
  const rt = D.createDialogueRuntime();
  check('fresh runtime is inactive with no dialogue',
    rt.active === false && rt.dialogue === null && rt.lineIndex === 0 && rt.revealed === 0 &&
    rt.charsPerSec === 40 && rt.waitingChoice === false &&
    rt.speakerObject === '' && rt.textObject === '');
  check('isDialogueActive reads false on a fresh runtime', D.isDialogueActive(rt) === false);
  check('isDialogueWaitingChoice reads false on a fresh runtime', D.isDialogueWaitingChoice(rt) === false);
  check('currentDialogue reads null when inactive', D.currentDialogue(rt) === null);
  check('choiceCount reads 0 when inactive', D.choiceCount(rt) === 0);
  check('choiceLabel reads null when inactive', D.choiceLabel(rt, 1) === null);
}

// --- start ---
{
  const rt = D.createDialogueRuntime();
  const h = makeHooks();
  check('start with a blank name stays quiet', D.startDialogue(rt, [guardDialogue()], '  ', {}, h.hooks) === false && rt.active === false);
  check('start with an unknown name warns and holds',
    D.startDialogue(rt, [guardDialogue()], 'Nobody', {}, h.hooks) === false && rt.active === false &&
    h.writes.some(w => w[0] === 'warn' && /no dialogue named "Nobody"/.test(w[1])),
    JSON.stringify(h.writes));
  const ok = D.startDialogue(rt, [guardDialogue()], 'Guard intro',
    { charsPerSec: 40, speakerObject: 'who', textObject: 'line' }, h.hooks);
  check('start with a known name begins line 0',
    ok === true && rt.active === true && rt.lineIndex === 0 && rt.revealed === 0 &&
    rt.speakerObject === 'who' && rt.textObject === 'line', JSON.stringify(rt));
  check('start applies the speaker and an empty line to the bound objects',
    h.writes.some(w => w[0] === 'who' && w[1] === 'Guard') &&
    h.writes.some(w => w[0] === 'line' && w[1] === ''), JSON.stringify(h.writes));
  const cur = D.currentDialogue(rt);
  check('currentDialogue reports the first line typing from empty',
    cur && cur.name === 'Guard intro' && cur.speaker === 'Guard' &&
    cur.text === 'Halt! Who goes there?' && cur.revealedText === '' && cur.typing === true &&
    cur.waitingChoice === false && cur.choices.length === 0 && cur.lineIndex === 0 && cur.totalLines === 4,
    JSON.stringify(cur));
  check('restarting the same dialogue restarts from line 0', (() => {
    rt.lineIndex = 2; rt.revealed = 5;
    return D.startDialogue(rt, [guardDialogue()], 'Guard intro', {}, h.hooks) === true &&
      rt.lineIndex === 0 && rt.revealed === 0;
  })());
  check('a zero typing speed means instant', (() => {
    const rt2 = D.createDialogueRuntime();
    D.startDialogue(rt2, [guardDialogue()], 'Guard intro', { charsPerSec: 0 }, h.hooks);
    return rt2.charsPerSec === 0;
  })());
  check('a bad typing speed falls back to the default', (() => {
    const rt2 = D.createDialogueRuntime();
    D.startDialogue(rt2, [guardDialogue()], 'Guard intro', { charsPerSec: -3 }, h.hooks);
    const rt3 = D.createDialogueRuntime();
    D.startDialogue(rt3, [guardDialogue()], 'Guard intro', { charsPerSec: 'fast' }, h.hooks);
    return rt2.charsPerSec === 40 && rt3.charsPerSec === 40;
  })());
  check('starting an empty dialogue ends at once', (() => {
    const rt2 = D.createDialogueRuntime();
    const started = D.startDialogue(rt2, [{ name: 'Empty', lines: [] }], 'Empty', {}, h.hooks);
    return started === true && rt2.active === false;
  })());
}

// --- typewriter update ---
{
  const rt = D.createDialogueRuntime();
  const h = makeHooks();
  check('update is a no-op when inactive', D.updateDialogue(rt, 1, h.hooks) === false);
  D.startDialogue(rt, [guardDialogue()], 'Guard intro', { charsPerSec: 40, speakerObject: 'who', textObject: 'line' }, h.hooks);
  h.writes.length = 0;
  check('update reveals charsPerSec * dt characters',
    D.updateDialogue(rt, 0.5, h.hooks) === true && rt.revealed === 20 &&
    D.currentDialogue(rt).revealedText === 'Halt! Who goes there'.slice(0, 20), JSON.stringify(D.currentDialogue(rt)));
  check('update applies the revealed text to the bound objects',
    h.writes.some(w => w[0] === 'line' && w[1] === 'Halt! Who goes there'.slice(0, 20)), JSON.stringify(h.writes));
  check('update with dt 0 reveals nothing more',
    D.updateDialogue(rt, 0, h.hooks) === false && rt.revealed === 20);
  check('update with a bad dt reveals nothing more',
    D.updateDialogue(rt, NaN, h.hooks) === false && D.updateDialogue(rt, -1, h.hooks) === false && rt.revealed === 20);
  check('update caps at the line length',
    D.updateDialogue(rt, 10, h.hooks) === true && rt.revealed === 21 &&
    D.currentDialogue(rt).revealedText === 'Halt! Who goes there?' && D.currentDialogue(rt).typing === false);
  check('a plain line never waits for a choice', rt.waitingChoice === false);
  // Choice line: advance to it, then type it out.
  D.advanceDialogue(rt, h.hooks);
  check('advance moves to the next line empty',
    rt.lineIndex === 1 && rt.revealed === 0 && D.currentDialogue(rt).speaker === 'Hero');
  D.updateDialogue(rt, 10, h.hooks);
  check('a fully revealed choice line waits for a pick',
    rt.waitingChoice === true && D.isDialogueWaitingChoice(rt) === true &&
    D.choiceCount(rt) === 2 && D.choiceLabel(rt, 1) === 'Show the pass' &&
    D.choiceLabel(rt, 2) === 'Run away' && D.choiceLabel(rt, 3) === null &&
    D.choiceLabel(rt, 0) === null, JSON.stringify(D.currentDialogue(rt)));
  check('update is a no-op while waiting for a choice',
    D.updateDialogue(rt, 5, h.hooks) === false && rt.waitingChoice === true);
  check('update while waiting still re-applies the display',
    (() => {
      h.writes.length = 0;
      D.updateDialogue(rt, 5, h.hooks);
      return h.writes.some(w => w[0] === 'line' && w[1] === 'Just a traveler.');
    })(), JSON.stringify(h.writes));
  check('instant speed reveals the whole line at once', (() => {
    const rt2 = D.createDialogueRuntime();
    const h2 = makeHooks();
    D.startDialogue(rt2, [guardDialogue()], 'Guard intro', { charsPerSec: 0, textObject: 'line' }, h2.hooks);
    D.updateDialogue(rt2, 0.016, h2.hooks);
    return rt2.revealed === 21 && D.currentDialogue(rt2).revealedText === 'Halt! Who goes there?';
  })());
}

// --- advance ---
{
  const rt = D.createDialogueRuntime();
  const h = makeHooks();
  check('advance is quiet when inactive', D.advanceDialogue(rt, h.hooks) === false);
  D.startDialogue(rt, [guardDialogue()], 'Guard intro', { charsPerSec: 40, speakerObject: 'who', textObject: 'line' }, h.hooks);
  check('advance completes the typing first',
    D.advanceDialogue(rt, h.hooks) === true && rt.revealed === 21 && rt.lineIndex === 0 &&
    D.currentDialogue(rt).typing === false);
  check('a second advance moves to the next line',
    D.advanceDialogue(rt, h.hooks) === true && rt.lineIndex === 1 && rt.revealed === 0);
  D.updateDialogue(rt, 10, h.hooks);
  check('advance stays quiet on a choice line',
    D.advanceDialogue(rt, h.hooks) === false && rt.lineIndex === 1 && rt.waitingChoice === true);
  // Pick the first choice (goto line 2), then advance to the end.
  D.chooseDialogue(rt, 1, h.hooks);
  check('after the pick the dialogue sits on the target line',
    rt.lineIndex === 2 && rt.waitingChoice === false && rt.revealed === 0);
  D.advanceDialogue(rt, h.hooks);
  D.advanceDialogue(rt, h.hooks);
  check('the next advance completes the last line\'s typing',
    D.advanceDialogue(rt, h.hooks) === true && rt.lineIndex === 3 && rt.revealed === 19 && rt.active === true);
  check('advancing past the last line ends the dialogue',
    D.advanceDialogue(rt, h.hooks) === true && rt.active === false && D.currentDialogue(rt) === null);
  check('advancing after the end stays quiet', D.advanceDialogue(rt, h.hooks) === false);
}

// --- choose ---
{
  const rt = D.createDialogueRuntime();
  const h = makeHooks();
  check('choose is quiet when inactive', D.chooseDialogue(rt, 1, h.hooks) === false);
  D.startDialogue(rt, [guardDialogue()], 'Guard intro', { charsPerSec: 40 }, h.hooks);
  check('choose is quiet before the choice line is revealed',
    D.chooseDialogue(rt, 1, h.hooks) === false && rt.lineIndex === 0);
  D.advanceDialogue(rt, h.hooks);
  D.advanceDialogue(rt, h.hooks);
  D.updateDialogue(rt, 10, h.hooks);
  check('choosing an out-of-range option warns and holds',
    D.chooseDialogue(rt, 3, h.hooks) === false && rt.waitingChoice === true && rt.lineIndex === 1 &&
    h.writes.some(w => w[0] === 'warn' && /option 3 is not one of the 2 choices/.test(w[1])),
    JSON.stringify(h.writes));
  check('choosing the second option jumps to its line',
    D.chooseDialogue(rt, 2, h.hooks) === true && rt.lineIndex === 3 && rt.waitingChoice === false &&
    D.currentDialogue(rt).text === 'Guards! Seize them!');
  check('a choice with no valid goto ends the dialogue', (() => {
    const rt2 = D.createDialogueRuntime();
    const h2 = makeHooks();
    const dlg = { name: 'Fork', lines: [
      { speaker: 'A', text: 'Pick.', choices: [{ label: 'End it', goto: null }, { label: 'Nowhere', goto: 99 }] },
      { speaker: 'A', text: 'Never reached.' }
    ] };
    D.startDialogue(rt2, [dlg], 'Fork', { charsPerSec: 0 }, h2.hooks);
    D.updateDialogue(rt2, 0.1, h2.hooks);
    const picked = D.chooseDialogue(rt2, 1, h2.hooks);
    const rt3 = D.createDialogueRuntime();
    D.startDialogue(rt3, [dlg], 'Fork', { charsPerSec: 0 }, h2.hooks);
    D.updateDialogue(rt3, 0.1, h2.hooks);
    const picked2 = D.chooseDialogue(rt3, 2, h2.hooks);
    return picked === true && rt2.active === false && picked2 === true && rt3.active === false;
  })());
}

// --- stop ---
{
  const rt = D.createDialogueRuntime();
  const h = makeHooks();
  check('stop is quiet when inactive', D.stopDialogue(rt, h.hooks) === false);
  D.startDialogue(rt, [guardDialogue()], 'Guard intro', { charsPerSec: 40 }, h.hooks);
  check('stop ends the running dialogue', D.stopDialogue(rt, h.hooks) === true && rt.active === false);
  check('stop is quiet after the end', D.stopDialogue(rt, h.hooks) === false);
}

// --- routing sets ---
{
  check('isDialogueAction matches the five action blocks',
    D.isDialogueAction('startDialogue') && D.isDialogueAction('advanceDialogue') &&
    D.isDialogueAction('chooseDialogueOption') && D.isDialogueAction('stopDialogue') &&
    D.isDialogueAction('setDialogueChoiceText') && !D.isDialogueAction('setLanguage') &&
    !D.isDialogueAction('dialogueActive'));
  check('isDialogueCondition matches the three condition blocks',
    D.isDialogueCondition('dialogueActive') && D.isDialogueCondition('dialogueWaitingChoice') &&
    D.isDialogueCondition('dialogueChoiceAvailable') && !D.isDialogueCondition('languageIs') &&
    !D.isDialogueCondition('startDialogue'));
}

// --- hostile input ---
{
  const h = makeHooks();
  check('start on a null runtime stays quiet', D.startDialogue(null, [guardDialogue()], 'Guard intro', {}, h.hooks) === false);
  check('update on a null runtime stays quiet', D.updateDialogue(null, 1, h.hooks) === false);
  check('advance on a null runtime stays quiet', D.advanceDialogue(null, h.hooks) === false);
  check('choose on a null runtime stays quiet', D.chooseDialogue(null, 1, h.hooks) === false);
  check('stop on a null runtime stays quiet', D.stopDialogue(null, h.hooks) === false);
  check('currentDialogue on a frozen runtime reads without throwing', (() => {
    const rt = D.createDialogueRuntime();
    D.startDialogue(rt, [guardDialogue()], 'Guard intro', {}, h.hooks);
    Object.freeze(rt);
    const cur = D.currentDialogue(rt);
    return cur && cur.speaker === 'Guard';
  })());
  check('a throwing setObjectText hook never breaks the update', (() => {
    const rt = D.createDialogueRuntime();
    const bad = { warn: function () {}, setObjectText: function () { throw new Error('boom'); } };
    D.startDialogue(rt, [guardDialogue()], 'Guard intro', { charsPerSec: 40, textObject: 'line' }, bad);
    return D.updateDialogue(rt, 0.5, bad) === true && rt.revealed === 20;
  })());
  check('a throwing warn hook never breaks the start', (() => {
    const rt = D.createDialogueRuntime();
    const bad = { warn: function () { throw new Error('boom'); } };
    return D.startDialogue(rt, [guardDialogue()], 'Nobody', {}, bad) === false && rt.active === false;
  })());
  check('a hostile dialogue table degrades to no dialogue', (() => {
    const rt = D.createDialogueRuntime();
    return D.startDialogue(rt, 'not a table', 'Guard intro', {}, h.hooks) === false && rt.active === false;
  })());
}

// --- static wiring ---
{
  const html = fs.readFileSync(path.join(HYDRA, 'index.html'), 'utf8');
  const scriptJs = fs.readFileSync(path.join(HYDRA, 'script.js'), 'utf8');
  const playerJs = fs.readFileSync(path.join(HYDRA, 'player-runtime.js'), 'utf8');
  const previewJs = fs.readFileSync(path.join(HYDRA, 'hydra-previewruntime.js'), 'utf8');
  const universalJs = fs.readFileSync(path.join(HYDRA, 'hydra-universal.js'), 'utf8');
  const conditionsJs = fs.readFileSync(path.join(HYDRA, 'hydra-conditions.js'), 'utf8');
  const executeJs = fs.readFileSync(path.join(HYDRA, 'hydra-execute.js'), 'utf8');
  const flowJs = fs.readFileSync(path.join(HYDRA, 'hydra-flow.js'), 'utf8');
  const resetJs = fs.readFileSync(path.join(HYDRA, 'hydra-scenereset.js'), 'utf8');

  const dlgTag = html.indexOf('src="hydra-dialogue.js');
  check('index.html loads hydra-dialogue.js before player-runtime.js and script.js',
    dlgTag !== -1 && dlgTag < html.indexOf('src="player-runtime.js') && dlgTag < html.indexOf('src="script.js'));
  check('index.html has a Dialogues inspector tab',
    html.includes('data-inspector-tab="dialogues"') && html.includes('data-inspector-panel="dialogues"'));
  check('index.html has the Dialogues panel + add button',
    html.includes('id="dialogues-panel"') && html.includes('id="dialogues-add-btn"'));
  check('script.js exposes the Dialogues tab panel + init + rename propagation',
    scriptJs.includes('function renderDialoguesPanel') && scriptJs.includes('function initDialoguesPanel') &&
    scriptJs.includes('function propagateDialogueRename') && scriptJs.includes('function getMutableDialogues') &&
    scriptJs.includes('initDialoguesPanel()'));
  check('script.js hands the project dialogue table to the preview runtime',
    scriptJs.includes('function getProjectDialogues') && scriptJs.includes('getProjectDialogues,'));
  check('player-runtime.js hard-guards on HydraDialogue',
    playerJs.includes("requires hydra-dialogue.js (window.HydraDialogue)"));
  check('player-runtime.js inlines HydraDialogue into exports',
    playerJs.includes("'HydraDialogue', global.HydraDialogue && global.HydraDialogue.factorySource"));
  check('player-runtime.js creates the per-run dialogue runtime + table',
    playerJs.includes('dialogue: HydraDialogue.createDialogueRuntime()') &&
    playerJs.includes('dialogues: HydraDialogue.normalizeDialogues(project.dialogues)'));
  check('player-runtime.js advances the typewriter from the runScripts phase',
    playerJs.includes('updateDialogue(state); processScope(state,'));
  check('player-runtime.js ends a running dialogue on scene load',
    playerJs.includes('resetDialogue: () => {') && playerJs.includes('HydraDialogue.stopDialogue(state.dialogue'));
  check('player-runtime.js routes dialogue blocks through the shared modules',
    playerJs.includes('HydraDialogue.isDialogueCondition(type)') &&
    playerJs.includes('HydraDialogue.isDialogueAction(type)') &&
    playerJs.includes('dialogue: state.dialogue') && playerJs.includes('dialogueModule: HydraDialogue'));
  check('preview runtime holds the dialogue runtime + per-frame update',
    previewJs.includes('function dialogueRuntime') && previewJs.includes('function updatePreviewDialogue') &&
    previewJs.includes('function resetDialogueRuntime') && previewJs.includes('updatePreviewDialogue(dt);'));
  check('preview runtime contexts carry the dialogue state',
    previewJs.includes('dialogue: dialogueRuntime()') && previewJs.includes("dialogues: hostCall('getProjectDialogues'"));
  check('preview runtime ends a running dialogue on scene load',
    previewJs.includes('resetDialogue: function () { resetDialogueRuntime(); }'));
  check('hydra-universal.js defaults project.dialogues to []',
    universalJs.includes('if (!Array.isArray(project.dialogues)) project.dialogues = [];'));
  check('shared conditions module evaluates the three dialogue conditions',
    conditionsJs.includes("case 'dialogueActive'") && conditionsJs.includes("case 'dialogueWaitingChoice'") &&
    conditionsJs.includes("case 'dialogueChoiceAvailable'"));
  check('shared execute module runs the five dialogue actions',
    executeJs.includes("isType(ctx.dialogueModule, 'isDialogueAction', type)") &&
    executeJs.includes("type === 'startDialogue'") && executeJs.includes("type === 'setDialogueChoiceText'"));
  check('flow module defaults the dialogue conditions to level triggers',
    flowJs.includes("t === 'dialogueActive'") && flowJs.includes("t === 'dialogueWaitingChoice'") &&
    flowJs.includes("t === 'dialogueChoiceAvailable'"));
  check('scene-reset module offers the resetDialogue hook',
    resetJs.includes('resetDialogue') && resetJs.includes("typeof h.resetDialogue === 'function'"));

  // Catalog: eight Dialogue blocks, schema-clean.
  const catSb = {}; catSb.window = catSb; vm.createContext(catSb);
  vm.runInContext(fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8'), catSb,
    { filename: 'block-catalog.js' });
  const catalog = catSb.HydraBlockCatalog;
  const dlgBlocks = catalog.blocks.filter(b => b.category === 'Dialogue');
  check('catalog carries eight Dialogue blocks',
    dlgBlocks.length === 8, dlgBlocks.map(b => b.label).join(', '));
  const labels = dlgBlocks.map(b => b.label).sort();
  check('Dialogue blocks are the five actions + three conditions',
    JSON.stringify(labels) === JSON.stringify(['Advance Dialogue', 'Choose Dialogue Option', 'Dialogue Active', 'Dialogue Choice Available', 'Dialogue Waiting For Choice', 'Set Choice Text', 'Start Dialogue', 'Stop Dialogue'].sort()),
    labels.join(', '));
  const findings = catalog.validateCatalog();
  check('catalog validates clean with the Dialogue blocks', findings.length === 0,
    JSON.stringify(findings.slice(0, 3)));
  const ref = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');
  check('every Dialogue block is documented in the block reference',
    dlgBlocks.every(b => ref.includes(b.label)), dlgBlocks.filter(b => !ref.includes(b.label)).map(b => b.label).join(', '));
  const guide = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');
  check('user guide has a Dialogue section', guide.includes('## Dialogue'));
}

process.exit(failures === 0 ? 0 : 1);
