/* ============================================================================
 * hydra-paneldock.js — HydraScript dockable editor panels (P5 core-engine
 * track, item P5-8: pro editor shell, pass 2 — slice a, dockable panels).
 *
 * Pure logic plus one thin DOM wiring helper, no other HydraScript
 * dependency. Used by the editor (script.js initPanelDock); the
 * exported standalone game has no editor panels, so nothing here is
 * inlined into exports.
 *
 * Idea (Unreal / Godot / VS Code, beginner edition): the Scene tab's
 * inspector and the Logic tab's block palette both sit on the right,
 * so a user who wants the stage on the right and the tools on the
 * left — or a left-handed mouse user, or anyone with a second monitor
 * on the left — has no way to move them. A dock button in each tab's
 * toolbar flips its panel to the other edge: the stage, the toolbar,
 * and the resize handle all move with it, because the layout reads a
 * data-panel-side attribute off the tab's container
 * (.scene-editor / .grid-editor) and the panel width still comes
 * from the same CSS variable the resizer writes. The choice sticks:
 * it is saved in localStorage and restored on the next load.
 *
 * How it works: the dock state is one side per panel, 'left' or
 * 'right', defaulting to 'right' (the layout everyone already
 * knows). The button toggles to the opposite side; the module sets
 * the container's data-panel-side attribute and rewrites the
 * button's title, aria-label, active state, and visible label to
 * name the next action ("Dock inspector panel on the left" while it
 * sits on the right). The host's onSide callback hears every change
 * so it can flip the resizer's drag math (a left-docked panel
 * measures from the container's left edge) and persist the pair.
 * The arrow keys keep their meaning on both sides — Right widens,
 * Left narrows — so only the pointer math is side-aware.
 *
 * Nothing ever throws; hostile input degrades to safe defaults. A
 * missing button, container, or storage object simply means that
 * panel stays on the right.
 *
 * Honest limits: below the 900px breakpoint the panels dock below
 * their main area (the P3 responsive rule), so the side choice has
 * no visible effect there and the dock buttons do nothing useful —
 * docking is a wide-screen feature. The sides are per browser
 * (localStorage), not per project, so they follow the machine, not
 * the .hydra file.
 * ========================================================================== */

function hydraPanelDockFactory() {
  'use strict';

  // The two dockable panels, their defaults, and their labels (the
  // word the dock button uses: the scene panel is the inspector, the
  // logic panel is the block palette).
  var DEFAULT_SIDES = { scene: 'right', logic: 'right' };
  var PANEL_LABELS = { scene: 'inspector', logic: 'block' };
  var STORAGE_KEY = 'hydra.panelDock.v1';

  function isPanelKey(key) {
    return key === 'scene' || key === 'logic';
  }

  // Normalize a side to 'left' or 'right'. Anything that is not
  // exactly 'left' reads as 'right', so a stored 'right' stays put
  // and a broken value can never strand a panel off-screen.
  function normalizeSide(side) {
    return side === 'left' ? 'left' : 'right';
  }

  // The other side: 'left' <-> 'right'. A garbage input reads as
  // 'right' first, so its opposite is 'left'.
  function oppositeSide(side) {
    return normalizeSide(side) === 'left' ? 'right' : 'left';
  }

  // Parse the stored sides JSON. Anything unparseable, wrong-shaped,
  // or holding a bad side degrades to the defaults for that panel —
  // one bad entry never takes the other panel's side down with it.
  function parseStoredSides(raw) {
    var out = { scene: DEFAULT_SIDES.scene, logic: DEFAULT_SIDES.logic };
    if (typeof raw !== 'string' || !raw) return out;
    var parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { return out; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
    if (parsed.scene !== undefined) out.scene = normalizeSide(parsed.scene);
    if (parsed.logic !== undefined) out.logic = normalizeSide(parsed.logic);
    return out;
  }

  // Serialize sides for storage: both panels, normalized, so a stored
  // value is always one parseStoredSides would accept back.
  function serializeSides(sides) {
    var out = { scene: DEFAULT_SIDES.scene, logic: DEFAULT_SIDES.logic };
    if (sides && typeof sides === 'object') {
      if (sides.scene !== undefined) out.scene = normalizeSide(sides.scene);
      if (sides.logic !== undefined) out.logic = normalizeSide(sides.logic);
    }
    try { return JSON.stringify(out); } catch (e) { return JSON.stringify(DEFAULT_SIDES); }
  }

  // Read the stored sides through a localStorage-shaped object
  // (getItem / setItem). A missing or throwing storage degrades to
  // the defaults instead of breaking the editor load.
  function readStoredSides(storage) {
    try {
      if (!storage || typeof storage.getItem !== 'function') {
        return { scene: DEFAULT_SIDES.scene, logic: DEFAULT_SIDES.logic };
      }
      return parseStoredSides(storage.getItem(STORAGE_KEY));
    } catch (e) {
      return { scene: DEFAULT_SIDES.scene, logic: DEFAULT_SIDES.logic };
    }
  }

  function writeStoredSides(storage, sides) {
    try {
      if (!storage || typeof storage.setItem !== 'function') return false;
      storage.setItem(STORAGE_KEY, serializeSides(sides));
      return true;
    } catch (e) { return false; }
  }

  // Apply a side to a tab container: the layout reads the
  // data-panel-side attribute, so setting it moves the panel, the
  // stage, the toolbar, and the resize handle together. Returns the
  // applied side, or null when there is no container to apply to.
  function applySide(container, panel, side) {
    var applied = normalizeSide(side);
    try {
      if (!container || typeof container.setAttribute !== 'function') return null;
      container.setAttribute('data-panel-side', applied);
      return applied;
    } catch (e) { return null; }
  }

  // Rewrite a dock button to name the next action: the title and
  // aria-label say which side the panel will move to, the button
  // reads active while the panel sits on the left, and a visible
  // label span (the Logic button's "Dock left" text) follows along.
  // Returns the side the button now describes, or null with no
  // button to update.
  function updateDockButton(button, panel, side) {
    var current = normalizeSide(side);
    var next = oppositeSide(current);
    try {
      if (!button) return null;
      var label = isPanelKey(panel) ? PANEL_LABELS[panel] : 'panel';
      var text = 'Dock ' + label + ' panel on the ' + next;
      if (typeof button.setAttribute === 'function') {
        button.setAttribute('title', text);
        button.setAttribute('aria-label', text);
      }
      try {
        if (button.classList && typeof button.classList.toggle === 'function') {
          button.classList.toggle('active', current === 'left');
        }
      } catch (e) { /* the active state is cosmetic */ }
      try {
        var span = (typeof button.querySelector === 'function')
          ? button.querySelector('span') : null;
        if (span) span.textContent = 'Dock ' + next;
      } catch (e) { /* an icon-only button has no label span */ }
      return current;
    } catch (e) { return null; }
  }

  // Wire one dock button to one panel. cfg:
  //   panel ('scene' | 'logic'), button (the toggle), container
  //   (the element carrying the data-panel-side attribute:
  //   .scene-editor or .grid-editor), initialSide (the side the
  //   panel starts on), onSide (host callback fired with (panel,
  //   side) whenever the side changes — the host flips the
  //   resizer's drag math and persists the pair).
  // Returns a { destroy, getSide, setSide } handle, or null when the
  // wiring cannot run. setSide drives the side without calling
  // onSide, so the host can re-apply a stored side silently.
  function createDockToggle(cfg) {
    try {
      if (!cfg || !isPanelKey(cfg.panel)) return null;
      var button = cfg.button || null;
      var container = cfg.container || null;
      if (!button || typeof button.addEventListener !== 'function') return null;

      var panel = cfg.panel;
      var current = normalizeSide(cfg.initialSide);

      function apply(side, notify) {
        current = normalizeSide(side);
        applySide(container, panel, current);
        updateDockButton(button, panel, current);
        if (notify && typeof cfg.onSide === 'function') {
          try { cfg.onSide(panel, current); } catch (e) {}
        }
      }

      function onClick(ev) {
        if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
        apply(oppositeSide(current), true);
      }

      button.addEventListener('click', onClick);
      // The starting side (from storage, applied by the host before
      // wiring) is announced on the button from the first render.
      applySide(container, panel, current);
      updateDockButton(button, panel, current);

      return {
        destroy: function () {
          try {
            if (typeof button.removeEventListener === 'function') {
              button.removeEventListener('click', onClick);
            }
          } catch (e) {}
        },
        getSide: function () { return current; },
        setSide: function (side) { apply(side, false); }
      };
    } catch (e) { return null; }
  }

  return {
    DEFAULT_SIDES: DEFAULT_SIDES,
    PANEL_LABELS: PANEL_LABELS,
    STORAGE_KEY: STORAGE_KEY,
    normalizeSide: normalizeSide,
    oppositeSide: oppositeSide,
    parseStoredSides: parseStoredSides,
    serializeSides: serializeSides,
    readStoredSides: readStoredSides,
    writeStoredSides: writeStoredSides,
    applySide: applySide,
    updateDockButton: updateDockButton,
    createDockToggle: createDockToggle
  };
}

if (typeof window !== 'undefined') window.HydraPanelDock = hydraPanelDockFactory();
if (typeof window !== 'undefined') window.HydraPanelDock.factorySource = hydraPanelDockFactory.toString();
if (typeof module !== 'undefined' && module.exports) module.exports = hydraPanelDockFactory;
