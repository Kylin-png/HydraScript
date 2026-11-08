# HydraScript testing — the release rule

## The standing rule

**No stable release ships until the end-to-end playtest harness passes
on the exported game. "Boots with no errors" is not a pass.**

This rule exists because the Nov 5 2026 Hydra Quest release booted
clean and passed ~100 content assertions while shipping two unplayable
bugs: button labels that did not render (invisible text) and a player
that could not jump. Neither bug produced an error, a warning, or a
failed assertion, because nothing ever looked at the pixels or pressed
a key. A game that cannot be played is a failing build, no matter how
green the unit suite is.

## The harness

`tests/playtest-game.js` plays a real exported game in real Chromium
(Playwright) and asserts, with real input and real pixels:

1. Boot: zero page errors, zero console errors, zero failed requests.
2. Button labels actually render: for every visible button, the canvas
   pixels in the button's bounds are read and a meaningful count of
   pixels in the button's text color is required. An invisible label
   fails the run.
3. Menu navigation: every menu button is clicked; the expected scene
   must load.
4. Real play in a level: move left/right, jump (velY goes negative,
   the player rises, then lands), collect a coin (score increases),
   touch an enemy (lives decrease), reach the goal (the level
   completes), pause (the world freezes, Resume returns), lose all
   lives (Game Over), Retry (a fresh run).
5. Exit code is nonzero on any failure. There is no "passed with
   warnings" for a broken control or an invisible label.

Run it directly against any exported html:

```
node tests/playtest-game.js --template flagship --game <path-to-exported-html>
```

It is parameterized by template id and game html path so the same
harness playtests any template-built game. Each template needs a
playbook entry in the file (scene ids, object names, keys). Only
flagship (Hydra Quest) has one today; add the arena shooter's
playbook when that template lands. An unknown template fails loudly;
the harness never passes by skipping the game it was asked to playtest.

## Wiring

- `tests/playtest.test.js` is picked up automatically by
  `node tests/run.js` (it runs every `*.test.js`). It builds the
  flagship export, writes it to a temp file, and runs the harness
  against it. It skips, loudly, only when Chromium is absent.
- Screenshots land in `screenshots/playtest-<template>-<timestamp>/`
  and their paths are printed by the harness. Inspect them before
  shipping; a green harness plus a looked-at screenshot is the bar.

## Stable-release checklist

1. `node tests/run.js` — the full suite, including the playtest gate,
   must be green. If the playtest was skipped (no Chromium), stop:
   run it by hand where Chromium is available. Do not ship a release
   whose playtest was skipped.
2. Rebuild the game html from the last green commit with
   `HydraPlayer.buildPlayableHtml` (see `tests/flagship.test.js` for
   the method) and write it to `~/workspace/your_files/hydrascript/`.
3. Run the harness against the rebuilt html directly and confirm it
   passes end to end:
   `node tests/playtest-game.js --template flagship --game <rebuilt-html>`
4. Open the harness screenshots and look at them: title, level,
   pause, game over. A green run does not excuse an unlooked-at
   screenshot.
5. Only then hand the html to the user, with the commit hash and the
   changes since the last release.

## The two bugs that made this rule (Nov 5 2026)

- **Button labels invisible** (`hydra/hydra-draw.js`, `drawTextObject`):
  the text color was set, then overwritten with the button fill to
  paint the background and never reset before `fillText`, so the label
  drew in the button's own color on the button. Fixed by resetting
  `fillStyle` to the text color before `fillText`. Commit `5b649da`.
- **Player could not jump** (`hydra/hydra-dispatch.js`): per-frame
  condition contexts are reset every frame and were only re-recorded
  when a condition fired. An edge-triggered condition that stays true
  (`onFloor` while standing) fires only on its false-to-true
  transition, so its context was absent on the frame Space was
  pressed and the neighbouring `and` (which needs two adjacent true
  contexts) could never pass. Fixed by recording a condition's
  context whenever it evaluates true, via the `onPropagateCondition`
  hook (context only; the execution context is untouched), so the
  and/once merge reads current truth. This also fixes the same latent
  bug in `triggerOnce`. Commit `5b649da`.
