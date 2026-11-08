# HydraScript

A browser-based visual game engine and game creator. Create multi-scene 2D games with
objects, collisions, movement, input, variables, camera behavior, visual event logic,
templates, asset support, save/load, playtesting, and export to a standalone playable
HTML game. No programming required.

## Layout

- `v3-baseline/` — pristine copy of HydraScript_v3_Fixed (the working baseline). Do not edit.
- `v4-reference/` — pristine copy of HydraScript_v4 (modular refactor, reference only). Do not edit.
- `hydra/` — the working tree being built forward. (Created in P0.)
- `tests/` — repeatable test workflow.
- `PROGRESS.md` — status, test results, known bugs, next task, decisions.
- `ROADMAP.md` — prioritized plan.
- `CHANGELOG.md` — user-visible changes.
- `SECURITY.md` — trust boundary: project files can carry executable expressions; open `.hydra` files only from sources you trust.

## Local development

```bash
cd repo/hydra
python3 -m http.server 8123
# open http://localhost:8123/home.html   (project hub)
# open http://localhost:8123/index.html  (editor)
```

## Tests

```bash
cd repo
node tests/run.js
```

See `tests/README.md` for what is covered.
