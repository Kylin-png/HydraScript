/* ============================================================================
 * hydra-blockdensity.js — HydraScript compact-density option for blocks
 * (P5 core-engine track, item P5-8: pro editor shell, pass 2 — slice c,
 * compact-density option for blocks).
 *
 * Pure logic plus one thin DOM wiring helper, no other HydraScript
 * dependency. Used by the editor (script.js initBlockDensity); the
 * exported standalone game has no editor grid, so nothing here is
 * inlined into exports.
 *
 * Idea (Unreal / Godot / VS Code, beginner edition): a big logic grid
 * is easier to read at the default 56px cells, but a busy game — a
 * long chain, a wide fan-out — wants more blocks on screen at once.
 * A Compact blocks toggle in the Logic tab's command bar shrinks the
 * grid cells to 44px and the block labels with them, so about a
 * quarter more columns fit across the same stage. It changes nothing
 * about the game: cell size is purely visual, the grid is still
 * 60 columns wide and rows are still unbounded, and every block,
 * chain, and saved project works exactly the same in either density.
 * The choice sticks: it is saved in localStorage and restored on the
 * next load.
 *
 * How it works: the density is one value, 'comfortable' (56px, the
 * layout everyone already knows) or 'compact' (44px). The button
 * toggles to the other density; the module sets the container's
 * data-block-density attribute (the .grid-editor element) and
 * rewrites the button's title, aria-label, active state, and visible
 * label to name the next action ("Compact blocks" while comfortable,
 * "Comfortable blocks" while compact). The host's onDensity callback
 * hears every change so it can persist the value.
 *
 * Nothing ever throws; hostile input degrades to safe defaults. A
 * missing button, container, or storage object simply means the grid
 * stays comfortable.
 *
 * Honest limits: the density is per browser (localStorage), not per
 * project, so it follows the machine, not the .hydra file. The
 * puzzle-piece SVG blocks scale with their cell (their shape is
 * inset: 0 in the cell), so a compact block keeps its silhouette —
 * only the label type and the cell itself shrink.
 * ========================================================================== */

function hydraBlockDensityFactory() {
  'use strict';

  // The two densities and their cell sizes in pixels. Comfortable is
  // the default the grid has always used; compact is the tighter
  // option, about a quarter more columns across the same stage.
  var DEFAULT_DENSITY = 'comfortable';
  var CELL_SIZE = { comfortable: 56, compact: 44 };
  var STORAGE_KEY = 'hydra.blockDensity.v1';

  // Normalize a density to 'comfortable' or 'compact'. Anything that
  // is not exactly 'compact' reads as 'comfortable', so a stored
  // 'comfortable' stays put and a broken value can never strand the
  // grid in an unknown size.
  function normalizeDensity(density) {
    return density === 'compact' ? 'compact' : 'comfortable';
  }

  // The other density: 'comfortable' <-> 'compact'. A garbage input
  // reads as 'comfortable' first, so its opposite is 'compact'.
  function oppositeDensity(density) {
    return normalizeDensity(density) === 'compact' ? 'comfortable' : 'compact';
  }

  // The cell size in pixels for a density (56 comfortable, 44
  // compact). A garbage input reads as comfortable, so it returns 56.
  function cellSize(density) {
    return CELL_SIZE[normalizeDensity(density)];
  }

  // Parse the stored density string. Anything unparseable or holding
  // a bad value degrades to the default — one bad entry never breaks
  // the editor load.
  function parseStoredDensity(raw) {
    if (typeof raw !== 'string' || !raw) return DEFAULT_DENSITY;
    return normalizeDensity(raw.trim());
  }

  // Serialize a density for storage: normalized, so a stored value is
  // always one parseStoredDensity would accept back.
  function serializeDensity(density) {
    return normalizeDensity(density);
  }

  // Read the stored density through a localStorage-shaped object
  // (getItem / setItem). A missing or throwing storage degrades to
  // the default instead of breaking the editor load.
  function readStoredDensity(storage) {
    try {
      if (!storage || typeof storage.getItem !== 'function') return DEFAULT_DENSITY;
      return parseStoredDensity(storage.getItem(STORAGE_KEY));
    } catch (e) {
      return DEFAULT_DENSITY;
    }
  }

  function writeStoredDensity(storage, density) {
    try {
      if (!storage || typeof storage.setItem !== 'function') return false;
      storage.setItem(STORAGE_KEY, serializeDensity(density));
      return true;
    } catch (e) { return false; }
  }

  // Apply a density to a tab container: the layout reads the
  // data-block-density attribute, so setting it resizes the grid
  // cells, the background grid lines, and the block labels together.
  // Returns the applied density, or null when there is no container
  // to apply to.
  function applyDensity(container, density) {
    var applied = normalizeDensity(density);
    try {
      if (!container || typeof container.setAttribute !== 'function') return null;
      container.setAttribute('data-block-density', applied);
      return applied;
    } catch (e) { return null; }
  }

  // Rewrite a density button to name the next action: the title and
  // aria-label say which density the grid will switch to, the button
  // reads active while the grid is compact, and a visible label span
  // follows along ("Compact blocks" while comfortable, "Comfortable
  // blocks" while compact). Returns the density the button now
  // describes, or null with no button to update.
  function updateDensityButton(button, density) {
    var current = normalizeDensity(density);
    var next = oppositeDensity(current);
    try {
      if (!button) return null;
      var nextWord = next === 'compact' ? 'Compact' : 'Comfortable';
      var text = nextWord + ' blocks';
      if (typeof button.setAttribute === 'function') {
        button.setAttribute('title', text);
        button.setAttribute('aria-label', text);
      }
      try {
        if (button.classList && typeof button.classList.toggle === 'function') {
          button.classList.toggle('active', current === 'compact');
        }
      } catch (e) { /* the active state is cosmetic */ }
      try {
        var span = (typeof button.querySelector === 'function')
          ? button.querySelector('span') : null;
        if (span) span.textContent = text;
      } catch (e) { /* an icon-only button has no label span */ }
      return current;
    } catch (e) { return null; }
  }

  // Wire one density button to the grid. cfg:
  //   button (the toggle), container (the element carrying the
  //   data-block-density attribute: .grid-editor), initialDensity
  //   (the density the grid starts on), onDensity (host callback
  //   fired with the density whenever it changes — the host persists
  //   it).
  // Returns a { destroy, getDensity, setDensity } handle, or null when
  // the wiring cannot run. setDensity drives the density without
  // calling onDensity, so the host can re-apply a stored density
  // silently.
  function createDensityToggle(cfg) {
    try {
      if (!cfg) return null;
      var button = cfg.button || null;
      var container = cfg.container || null;
      if (!button || typeof button.addEventListener !== 'function') return null;

      var current = normalizeDensity(cfg.initialDensity);

      function apply(density, notify) {
        current = normalizeDensity(density);
        applyDensity(container, current);
        updateDensityButton(button, current);
        if (notify && typeof cfg.onDensity === 'function') {
          try { cfg.onDensity(current); } catch (e) {}
        }
      }

      function onClick(ev) {
        if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
        apply(oppositeDensity(current), true);
      }

      button.addEventListener('click', onClick);
      // The starting density (from storage, applied by the host before
      // wiring) is announced on the button from the first render.
      applyDensity(container, current);
      updateDensityButton(button, current);

      return {
        destroy: function () {
          try {
            if (typeof button.removeEventListener === 'function') {
              button.removeEventListener('click', onClick);
            }
          } catch (e) {}
        },
        getDensity: function () { return current; },
        setDensity: function (density) { apply(density, false); }
      };
    } catch (e) { return null; }
  }

  return {
    DEFAULT_DENSITY: DEFAULT_DENSITY,
    CELL_SIZE: CELL_SIZE,
    STORAGE_KEY: STORAGE_KEY,
    normalizeDensity: normalizeDensity,
    oppositeDensity: oppositeDensity,
    cellSize: cellSize,
    parseStoredDensity: parseStoredDensity,
    serializeDensity: serializeDensity,
    readStoredDensity: readStoredDensity,
    writeStoredDensity: writeStoredDensity,
    applyDensity: applyDensity,
    updateDensityButton: updateDensityButton,
    createDensityToggle: createDensityToggle
  };
}

if (typeof window !== 'undefined') window.HydraBlockDensity = hydraBlockDensityFactory();
if (typeof window !== 'undefined') window.HydraBlockDensity.factorySource = hydraBlockDensityFactory.toString();
if (typeof module !== 'undefined' && module.exports) module.exports = hydraBlockDensityFactory;
