# HydraScript tests

One repeatable command: `node tests/run.js` (from `repo/`).

Coverage so far:

- **Syntax**: `node --check` on every JS file in `../hydra`.
- **Node tests**: each `*.test.js` in this directory runs as a child process; exit 0 = pass.

Planned additions (see ROADMAP P0/P1):

- `project-model.test.js`: save/load round-trip fidelity, normalization of corrupt
  project data, backward compatibility fixtures from v3-baseline data.
- `export.test.js`: exported standalone HTML boots without editor globals;
  function serialization is real functions, not strings.
- `blocks.test.js`: every block-catalog entry has required fields; runtime mapping
  resolves.
- `browser-smoke.md`: live checklist — home → new project → editor → scene entity
  placement → block script in preview → save/reload → export → standalone run.
  Each checklist item must be exercised in the real browser before a feature is
  claimed complete.
