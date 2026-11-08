/* ============================================================================
 * hydra-dialogue.js — HydraScript shared dialogue system (P4 Advanced
 * batch 7: conversations a beginner can actually write).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation
 * of dialogue used by:
 *   - the editor preview runtime (hydra-previewruntime.js delegates
 *     to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Idea (Unity Dialogue System / Godot Dialogic / Unreal Dialogue,
 * beginner edition): the project carries named conversations — a list
 * of lines, each with a speaker and a line of text — and blocks run
 * them at runtime:
 *
 *   "Guard intro":
 *     Guard: "Halt! Who goes there?"
 *     Hero:  "Just a traveler."
 *     Guard: "Show me your pass, or turn back."   [choices]
 *              > "Show the pass"  -> line 4
 *              > "Run away"       -> line 5
 *     Guard: "Pass accepted. Move along."
 *     Guard: "Guards! Seize them!"
 *
 * Data model (stored on the project, saved in project JSON, edited in
 * the Dialogues tab):
 *   project.dialogues = [
 *     { id: 'dlg_...', name: 'Guard intro', lines: [
 *       { speaker: 'Guard', text: 'Halt! Who goes there?' },
 *       { speaker: 'Hero', text: 'Just a traveler.',
 *         choices: [ { label: 'Show the pass', goto: 3 },
 *                    { label: 'Run away', goto: 4 } ] },
 *       { speaker: 'Guard', text: 'Pass accepted.' },
 *       { speaker: 'Guard', text: 'Guards! Seize them!' } ] }
 *   ];
 * A choice's `goto` is a 0-based line index; a missing, non-integer, or
 * out-of-range goto ends the dialogue after the choice is picked. A
 * line with a non-empty `choices` array is a choice line: once its text
 * is fully revealed the dialogue waits for the player to pick.
 *
 * Runtime state (NOT saved; per run, created fresh at game start):
 *   { active, dialogue, lineIndex, revealed, charsPerSec,
 *     waitingChoice, speakerObject, textObject }
 * The runtime survives scene switches inside a run only in the sense
 * that a scene load ends it: the scene-reset hook stops any running
 * dialogue, so a fresh scene never inherits a half-finished
 * conversation (the same fresh-scene rule as the per-scene collections).
 *
 * Display: dialogue is UI, not world — the engine writes the current
 * speaker and the typewriter-revealed line into two text objects the
 * author names on the Start Dialogue block (a panel + speaker label +
 * text label built from ordinary objects, so the dialogue box itself
 * stays rebuildable from primitives). Choices are the author's own
 * buttons too: Set Choice Text writes a choice's label into a text
 * object, Dialogue Choice Available gates each button's visibility,
 * and Choose Dialogue Option (or Object Clicked on the button) picks.
 * The author wires advancement the same way (Key Just Pressed or
 * Object Clicked -> Advance Dialogue), so a dialogue never needs a
 * hardcoded key.
 *
 * Typewriter: `charsPerSec` characters per second (default 40; 0 means
 * instant, the whole line at once). The per-frame update runs inside
 * both runtimes' runScripts phase — before the grids run, so a
 * condition reading the dialogue sees this frame's text — and it runs
 * while paused, like the pause menu: dialogue is UI, the world is
 * frozen. Advance Dialogue completes the current line's typing first,
 * then moves to the next line; it stays quiet on a choice line (the
 * player must choose). Starting a dialogue that is already running
 * restarts it from line 0.
 *
 * When a dialogue ends (last line advanced past, a choice with no
 * valid goto, or Stop Dialogue), the speaker and text labels keep the
 * last revealed line — the module stops writing, it does not blank
 * them, so a label that is also bound to a localization key is never
 * clobbered. Hide the panel with Dialogue Active (inverted) when the
 * conversation is over.
 *
 * Blank names stay quiet (the same blank-quiet convention as every
 * other block family); unknown dialogue names and out-of-range option
 * numbers warn and hold. Nothing ever throws; hostile input degrades
 * to safe defaults.
 *
 * Honest limits: lines are plain text (no rich text, no {placeholders}
 * — compose those with Set Text and variables); choices jump by line
 * number, with no named labels or sub-dialogue calls; there is one
 * running dialogue at a time (starting another restarts from line 0);
 * the typewriter has no per-character sound or per-line speed (one
 * speed per Start Dialogue block).
 * Old projects have no dialogues field and behave exactly as before.
 *
 * Load order (index.html): hydra-dialogue.js BEFORE player-runtime.js
 * and script.js. player-runtime.js throws a clear error if
 * HydraDialogue is missing.
 * ========================================================================== */

function hydraDialogueFactory() {
  'use strict';

  var DEFAULT_CHARS_PER_SEC = 40;

  function saneStr(v) {
    return String(v == null ? '' : v);
  }

  function saneName(v) {
    return saneStr(v).trim();
  }

  // Normalize a project's dialogue list IN PLACE — entries are repaired
  // on the existing array, so the record keeps its identity across
  // calls (the localization lesson: the editor tab holds entry
  // references while it renders, and a wholesale replacement would
  // orphan them). Blank-name dialogues drop, duplicate names collapse
  // to the first, lines coerce to { speaker, text, choices }, choices
  // with blank labels drop, and a choice goto keeps only a finite
  // integer >= 0 (anything else reads as "end the dialogue"). Never
  // throws.
  function normalizeDialogues(dialogues) {
    try {
      if (!Array.isArray(dialogues)) return [];
      var seen = {};
      for (var i = 0; i < dialogues.length;) {
        var d = dialogues[i];
        if (!d || typeof d !== 'object' || Array.isArray(d)) { dialogues.splice(i, 1); continue; }
        var name = saneName(d.name);
        if (!name || seen[name]) { dialogues.splice(i, 1); continue; }
        seen[name] = true;
        d.name = name;
        if (typeof d.id !== 'string' || !d.id) d.id = 'dlg_' + (i + 1);
        if (!Array.isArray(d.lines)) d.lines = [];
        for (var j = d.lines.length - 1; j >= 0; j--) {
          var line = d.lines[j];
          if (!line || typeof line !== 'object' || Array.isArray(line)) { d.lines.splice(j, 1); continue; }
          line.speaker = saneStr(line.speaker);
          line.text = saneStr(line.text);
          if (!Array.isArray(line.choices)) line.choices = [];
          for (var k = line.choices.length - 1; k >= 0; k--) {
            var ch = line.choices[k];
            if (!ch || typeof ch !== 'object' || Array.isArray(ch)) { line.choices.splice(k, 1); continue; }
            ch.label = saneStr(ch.label);
            if (!ch.label) { line.choices.splice(k, 1); continue; }
            // A missing goto ends the dialogue; a present one keeps
            // only a finite integer >= 0. (Number(null) is 0, so null
            // must be tested before the Number() coercion, or a second
            // normalization would turn "end the dialogue" into "go to
            // line 0".)
            var rawGoto = ch.goto;
            var g = (rawGoto === null || rawGoto === undefined || rawGoto === '') ? null : Number(rawGoto);
            ch.goto = (g !== null && isFinite(g) && Math.floor(g) === g && g >= 0) ? g : null;
          }
        }
        i++;
      }
      return dialogues;
    } catch (err) {
      return [];
    }
  }

  // The normalized dialogue names (a copy — callers may not mutate it).
  function dialogueNames(dialogues) {
    try {
      return normalizeDialogues(dialogues).map(function (d) { return d.name; });
    } catch (e) {
      return [];
    }
  }

  // The dialogue with exactly this name (or id), or null. Blank names
  // read null.
  function getDialogue(dialogues, name) {
    try {
      var want = saneName(name);
      if (!want) return null;
      var list = normalizeDialogues(dialogues);
      for (var i = 0; i < list.length; i++) {
        if (list[i].name === want || list[i].id === want) return list[i];
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  // A fresh per-run dialogue runtime. Nothing is running yet.
  function createDialogueRuntime() {
    return {
      active: false,
      dialogue: null,
      lineIndex: 0,
      revealed: 0,
      charsPerSec: DEFAULT_CHARS_PER_SEC,
      waitingChoice: false,
      speakerObject: '',
      textObject: ''
    };
  }

  function isRuntime(rt) {
    return !!rt && typeof rt === 'object';
  }

  // The current line object, or null when no dialogue is running or the
  // line index is out of range.
  function currentLine(rt) {
    try {
      if (!isRuntime(rt) || !rt.active || !rt.dialogue) return null;
      var lines = rt.dialogue.lines;
      if (!Array.isArray(lines)) return null;
      var line = lines[rt.lineIndex];
      return (line && typeof line === 'object') ? line : null;
    } catch (e) {
      return null;
    }
  }

  // The display state for the current line, or null when no dialogue is
  // running. `revealedText` is the typewriter-visible slice of the
  // line's text; `typing` is true while characters are still appearing.
  function currentDialogue(rt) {
    try {
      var line = currentLine(rt);
      if (!line) return null;
      var text = saneStr(line.text);
      var revealed = Math.max(0, Math.min(text.length, Math.floor(Number(rt.revealed) || 0)));
      var choices = Array.isArray(line.choices) ? line.choices.map(function (c) { return saneStr(c.label); }) : [];
      return {
        name: rt.dialogue.name,
        speaker: saneStr(line.speaker),
        text: text,
        revealedText: text.slice(0, revealed),
        typing: revealed < text.length,
        waitingChoice: !!rt.waitingChoice,
        choices: choices,
        lineIndex: rt.lineIndex,
        totalLines: Array.isArray(rt.dialogue.lines) ? rt.dialogue.lines.length : 0
      };
    } catch (e) {
      return null;
    }
  }

  function choiceList(rt) {
    try {
      var line = currentLine(rt);
      if (!line || !Array.isArray(line.choices)) return [];
      return line.choices;
    } catch (e) {
      return [];
    }
  }

  // How many choices the current line offers while the dialogue is
  // waiting for a pick (0 otherwise — the buttons only exist then).
  function choiceCount(rt) {
    try {
      if (!isRuntime(rt) || !rt.active || !rt.waitingChoice) return 0;
      return choiceList(rt).length;
    } catch (e) {
      return 0;
    }
  }

  // The label of the 1-based numbered choice, or null when there is no
  // such choice (not waiting, or the number is out of range).
  function choiceLabel(rt, index) {
    try {
      var n = Number(index);
      if (!isRuntime(rt) || !rt.active || !rt.waitingChoice) return null;
      if (!isFinite(n) || Math.floor(n) !== n || n < 1) return null;
      var choices = choiceList(rt);
      if (n > choices.length) return null;
      return saneStr(choices[n - 1].label);
    } catch (e) {
      return null;
    }
  }

  function isDialogueActive(rt) {
    try {
      return !!(isRuntime(rt) && rt.active);
    } catch (e) {
      return false;
    }
  }

  function isDialogueWaitingChoice(rt) {
    try {
      return !!(isRuntime(rt) && rt.active && rt.waitingChoice);
    } catch (e) {
      return false;
    }
  }

  // Write the current speaker + revealed text into the bound text
  // objects. A missing hook, a missing object, or a throwing hook is a
  // silent no-op — one bad binding never breaks the dialogue.
  function applyDisplay(rt, hooks) {
    try {
      if (!hooks || typeof hooks.setObjectText !== 'function') return;
      var cur = currentDialogue(rt);
      if (!cur) return;
      if (rt.speakerObject) {
        try { hooks.setObjectText(rt.speakerObject, cur.speaker); } catch (e) { /* one bad binding never breaks the dialogue */ }
      }
      if (rt.textObject) {
        try { hooks.setObjectText(rt.textObject, cur.revealedText); } catch (e) { /* one bad binding never breaks the dialogue */ }
      }
    } catch (e) { /* display is best-effort */ }
  }

  function warnHook(hooks, msg) {
    try {
      if (hooks && typeof hooks.warn === 'function') hooks.warn(msg);
    } catch (e) { /* a throwing warn never breaks the dialogue */ }
  }

  // End the running dialogue. The bound labels keep the last revealed
  // line (the module stops writing; it never blanks them).
  function endDialogue(rt) {
    try {
      if (!isRuntime(rt)) return false;
      var was = !!rt.active;
      rt.active = false;
      rt.dialogue = null;
      rt.lineIndex = 0;
      rt.revealed = 0;
      rt.waitingChoice = false;
      return was;
    } catch (e) {
      return false;
    }
  }

  // Start a dialogue by name. Blank names stay quiet; unknown names
  // warn and hold (the old dialogue, if any, keeps running). Starting
  // a dialogue that is already running restarts it from line 0.
  // opts: { charsPerSec, speakerObject, textObject }.
  function startDialogue(rt, dialogues, name, opts, hooks) {
    try {
      if (!isRuntime(rt)) return false;
      var want = saneName(name);
      if (!want) return false;
      var def = getDialogue(dialogues, want);
      if (!def) {
        warnHook(hooks, 'Start Dialogue: no dialogue named "' + want + '" in the Dialogues tab. The dialogue was not started.');
        return false;
      }
      var o = opts || {};
      var cps = Number(o.charsPerSec);
      rt.charsPerSec = (cps === 0) ? 0 : (isFinite(cps) && cps > 0 ? cps : DEFAULT_CHARS_PER_SEC);
      rt.speakerObject = saneName(o.speakerObject);
      rt.textObject = saneName(o.textObject);
      rt.dialogue = def;
      rt.lineIndex = 0;
      rt.revealed = 0;
      rt.waitingChoice = false;
      rt.active = true;
      if (!Array.isArray(def.lines) || def.lines.length === 0) {
        endDialogue(rt);
        return true;
      }
      applyDisplay(rt, hooks);
      return true;
    } catch (e) {
      return false;
    }
  }

  // Advance the typewriter by dtSeconds (0 or negative reveals
  // nothing; a speed of 0 reveals the whole line at once). When the
  // line finishes revealing and it offers choices, the dialogue waits
  // for a pick. Returns true when the display changed. Never throws.
  function updateDialogue(rt, dtSeconds, hooks) {
    try {
      if (!isRuntime(rt) || !rt.active) return false;
      var line = currentLine(rt);
      if (!line) { endDialogue(rt); return false; }
      if (rt.waitingChoice) {
        // Still re-apply the display: a bound label hidden during the
        // reveal missed its write, and would show the stale line until
        // the next line starts unless the current text is re-applied.
        // The update still reports no change (it returns false).
        applyDisplay(rt, hooks);
        return false;
      }
      var text = saneStr(line.text);
      var before = Math.max(0, Math.min(text.length, Math.floor(Number(rt.revealed) || 0)));
      var dt = Number(dtSeconds);
      if (!isFinite(dt) || dt < 0) dt = 0;
      var after;
      if (!(rt.charsPerSec > 0)) {
        after = text.length;
      } else {
        after = Math.min(text.length, before + rt.charsPerSec * dt);
      }
      rt.revealed = after;
      if (after >= text.length && Array.isArray(line.choices) && line.choices.length > 0) {
        rt.waitingChoice = true;
      }
      applyDisplay(rt, hooks);
      return after !== before || rt.waitingChoice;
    } catch (e) {
      return false;
    }
  }

  // Advance one step: complete the current line's typing, or move to
  // the next line, or end the dialogue past the last line. Quiet on a
  // choice line (the player must choose) and when no dialogue is
  // running. Returns true when the dialogue advanced.
  function advanceDialogue(rt, hooks) {
    try {
      if (!isRuntime(rt) || !rt.active) return false;
      var line = currentLine(rt);
      if (!line) { endDialogue(rt); return false; }
      var text = saneStr(line.text);
      var revealed = Math.max(0, Math.min(text.length, Math.floor(Number(rt.revealed) || 0)));
      if (revealed < text.length) {
        rt.revealed = text.length;
        if (Array.isArray(line.choices) && line.choices.length > 0) rt.waitingChoice = true;
        applyDisplay(rt, hooks);
        return true;
      }
      if (rt.waitingChoice) return false;
      var lines = Array.isArray(rt.dialogue.lines) ? rt.dialogue.lines : [];
      rt.lineIndex++;
      if (rt.lineIndex >= lines.length) {
        endDialogue(rt);
        return true;
      }
      rt.revealed = 0;
      rt.waitingChoice = false;
      applyDisplay(rt, hooks);
      return true;
    } catch (e) {
      return false;
    }
  }

  // Pick the 1-based numbered choice while the dialogue waits for one.
  // A choice with no valid goto ends the dialogue; a valid goto jumps
  // to that line (0-based in the data). Quiet when not waiting; an
  // out-of-range option warns and holds. Returns true when a choice
  // was picked.
  function chooseDialogue(rt, index, hooks) {
    try {
      if (!isRuntime(rt) || !rt.active || !rt.waitingChoice) return false;
      var choices = choiceList(rt);
      var n = Number(index);
      if (!isFinite(n) || Math.floor(n) !== n || n < 1 || n > choices.length) {
        warnHook(hooks, 'Choose Dialogue Option: option ' + index + ' is not one of the ' + choices.length + ' choices. The dialogue is still waiting.');
        return false;
      }
      var target = choices[n - 1].goto;
      var lines = Array.isArray(rt.dialogue.lines) ? rt.dialogue.lines : [];
      if (target === null || target === undefined || target < 0 || target >= lines.length) {
        endDialogue(rt);
        return true;
      }
      rt.lineIndex = target;
      rt.revealed = 0;
      rt.waitingChoice = false;
      applyDisplay(rt, hooks);
      return true;
    } catch (e) {
      return false;
    }
  }

  // Stop the running dialogue. Quiet when none is running.
  function stopDialogue(rt, hooks) {
    try {
      if (!isRuntime(rt) || !rt.active) return false;
      endDialogue(rt);
      return true;
    } catch (e) {
      return false;
    }
  }

  function isDialogueAction(type) {
    return type === 'startDialogue' || type === 'advanceDialogue' ||
      type === 'chooseDialogueOption' || type === 'stopDialogue' ||
      type === 'setDialogueChoiceText';
  }

  function isDialogueCondition(type) {
    return type === 'dialogueActive' || type === 'dialogueWaitingChoice' ||
      type === 'dialogueChoiceAvailable';
  }

  return {
    DEFAULT_CHARS_PER_SEC: DEFAULT_CHARS_PER_SEC,
    normalizeDialogues: normalizeDialogues,
    dialogueNames: dialogueNames,
    getDialogue: getDialogue,
    createDialogueRuntime: createDialogueRuntime,
    currentLine: currentLine,
    currentDialogue: currentDialogue,
    choiceList: choiceList,
    choiceCount: choiceCount,
    choiceLabel: choiceLabel,
    isDialogueActive: isDialogueActive,
    isDialogueWaitingChoice: isDialogueWaitingChoice,
    startDialogue: startDialogue,
    updateDialogue: updateDialogue,
    advanceDialogue: advanceDialogue,
    chooseDialogue: chooseDialogue,
    stopDialogue: stopDialogue,
    isDialogueAction: isDialogueAction,
    isDialogueCondition: isDialogueCondition
  };
}

if (typeof window !== 'undefined') {
  window.HydraDialogue = hydraDialogueFactory();
  // Self-contained source of the factory, inlined into exported playable games
  // by HydraPlayer.buildPlayableHtml so exports run without editor files.
  window.HydraDialogue.factorySource = hydraDialogueFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraDialogueFactory;
