# HydraScript — Security & Trust Boundary

## The one rule

**Only open `.hydra` project files from people and sources you trust.** A HydraScript
project file is mostly plain data (scenes, objects, block layouts), but the *expression*
fields inside logic blocks are compiled to JavaScript and executed when the game runs.
Opening a project from an untrusted source is equivalent to running their code in your
browser.

The same applies to exported games: a standalone exported HTML file runs the embedded
project's expressions. Treat an exported game from someone you don't know like any
downloaded executable — play it in a fresh browser profile if you're unsure.

## Where expressions become code

Block fields that take numbers (move amounts, `setVariable` values, conditions, timer
durations, ...) accept expression text such as `score + 10`, `hero.posX`, or
`Math.floor(Math.random() * 690) + 40`. At runtime that text is evaluated by the single
shared evaluator in `hydra/hydra-expr.js` (`evaluate()`), which compiles it with
`new Function(...)` and calls it.

This evaluator is used in two places:

- **Editor preview** (`hydra/script.js` delegates to it) — expressions run in the
  editor's page, i.e. your browser origin, with access to your HydraScript
  `localStorage` projects.
- **Exported games** (`hydra/player-runtime.js`; the evaluator is inlined into the
  exported HTML via `factorySource` so exports stay self-contained) — expressions run
  in whoever opens the exported file's browser.

## What project data can reach the evaluator

Expression strings arrive as plain JSON inside:

- `.hydra` files imported through the project hub (`home.html`) or the editor,
- projects stored in `localStorage` (`hydraProjects`),
- the project JSON embedded in an exported standalone HTML game.

Any of these can carry hand-crafted expression text — the file format does not
distinguish "typed by the owner in the editor" from "written by hand into the JSON".

## Mitigations in place (defense in depth, not a sandbox)

`hydra-expr.js` does not eval raw text blindly. Before compiling, it:

1. **Rejects unknown identifiers.** Any name that is not a game variable, a declared
   builtin (`mouseX`, `cameraX`, `dt`, ...), or on the small reserved list (`Math`,
   `true`/`false`/`null`, `NaN`/`Infinity`, plain math function names) makes the
   expression unevaluable: the action is skipped and a warning is surfaced in the
   diagnostics panel (editor) or console + HUD badge (exports). Direct references to
   `document`, `window`, `fetch`, `Function`, `eval`, etc. are blocked this way.
2. **Rewrites `object.property` access** to literal values looked up from live game
   objects (unknown objects / missing properties become `0`), except `Math.*`, which
   is passed through to the real `Math` object.
3. **Strips string literals** before the identifier check so quoted text can't smuggle
   names past the gate.

These layers meaningfully shrink what a hostile expression can do, but they are a
filter, not a sandbox: the design still compiles project-supplied text with
`new Function`. The trust boundary is therefore social, not technical — it sits at
the moment you choose to open someone else's project file.

## Script blocks (Run Script / Script Check) are raw JavaScript

The Code category's **Run Script** and **Script Check** blocks compile their code
fields with `new Function('hs', ...)` and run them with **no identifier filter**.
Unlike expressions, script code can reach `window`, `document`, `fetch`,
`localStorage`, and everything else the page can do. That is the deliberate
trade-off of a power-user API: the `hs` object is a convenience bridge, not a
sandbox.

The practical rule does not change — only open projects from people and sources
you trust — but the stakes are higher with scripts: a `.hydra` file or exported
game carrying hostile script blocks is equivalent to running its author's code in
your browser, with full page privileges. The editor shows a Code block's script
in the property panel as plain text, so you can always read what a script does
before you hit Preview.

Rails that are in place (reliability, not security): compile errors warn once
with the message and the block does nothing; runtime errors are caught, warned
through diagnostics (deduped per message), and never break the game loop; blank
code is a quiet no-op. None of this restricts what *working* script code can do.

## Guidance for users

- Open `.hydra` files only from sources you trust, the same way you'd treat a `.zip`
  or `.exe` from the internet.
- Don't paste expression text you don't understand into block fields.
- Read a script block's code in the property panel before previewing a project
  you received from someone else.
- Exported games are safe to share with players; the risk direction is *receiving*
  project files, not sending them.

## Guidance for engine developers

- `hydra-expr.js` is the single canonical evaluator (editor + exports). Never add a
  second one, and never loosen the `unknownIdentifiers` / `RESERVED` gate without a
  security review — that list is load-bearing.
- If you add new builtins to expression scope, keep them to plain values and the
  `Math` object; never expose DOM, storage, or network handles.
- Possible future hardening (not implemented yet): restrict `Math` to an allowlist of
  methods instead of the whole object, reject `constructor` / `__proto__` /
  `prototype` tokens in the prop-access pass, or replace `new Function` with a real
  expression parser. Any of these must keep all existing `tests/expr.test.js`
  assertions passing.
