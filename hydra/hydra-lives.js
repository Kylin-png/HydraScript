/* ============================================================================
 * hydra-lives.js — HydraScript shared lives & game over (P4 Advanced
 * batch 25: lives & game over, beginner edition).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation
 * of how many chances the player gets — used by:
 *   - the editor preview runtime (hydra-previewruntime.js delegates
 *     to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Idea (Unity lives systems / Godot lives counters, beginner edition):
 * batch 21 gave every object hit points, batch 22 made the hit feel
 * like a hit, batch 23 brought the player back after dying, and batch
 * 24 made the enemies keep coming — but the comebacks were free and
 * endless. Lives are the classic bound on them:
 *
 *   lives — one count for the whole game, 3 by default (the arcade
 *     default). Set Lives writes it outright, Add Lives tops it up,
 *     Lose Life spends it (one at a time by default), Read Lives
 *     copies it into a variable so a label can show it or Save Game
 *     can keep it. The count is a whole number, 0–99: setting 0
 *     starts the game already over, and adding past 99 stops at 99.
 *   game over — derived, never stored (the batch-21 death rule):
 *     the game is over exactly while the count reads 0. The Game Over
 *     condition is an edge trigger, so it fires once on the moment
 *     the last life is lost — chain it to Switch Scene for the
 *     game-over screen, or to Show for a game-over banner. Gaining a
 *     life after game over (a continue) clears it, so losing the
 *     last life again fires it again.
 *   the classic loop — Object Died → Lose Life → Respawn Object is
 *     the whole die-and-respawn loop in three blocks, and Game Over
 *     → Switch Scene is the ending. A three-lives game over no
 *     longer needs the Respawn Count workaround the batch-23 notes
 *     suggested: Lose Life once per death and Game Over fires on the
 *     third one.
 *
 * The state is transient run state, minted fresh on a fresh run (like
 * the quest log and the backpack): it SURVIVES scene switches inside
 * a run, so the lives left in level 1 are the lives left in level 2,
 * and it resets only when the game starts over. It never travels in
 * save slots — persist it through a variable the way quests and
 * inventory do (Read Lives into a variable on save, Set Lives from
 * it on load). There is deliberately no scene-reset hook for it:
 * the scene reset never touches the lives record, the same way it
 * never touches the quest log.
 *
 * Nothing ever throws; hostile input degrades to safe defaults.
 *
 * Honest limits: one count for the whole game (no per-player or
 * per-scene lives); the count is not shown anywhere by itself —
 * Read Lives into a variable and show it in a text object (or gate
 * a label on the Lives condition); losing a life never respawns
 * anything on its own — chain Respawn Object after Lose Life for
 * the comeback; no `hs` script-API surface yet.
 *
 * Load order (index.html): hydra-lives.js BEFORE player-runtime.js
 * and script.js. player-runtime.js throws a clear error if HydraLives
 * is missing.
 * ========================================================================== */

function hydraLivesFactory() {
  'use strict';

  // A usable number, or the fallback when the value is not one.
  // Only real numbers or numeric strings count — null / undefined /
  // '' count as missing, and anything else (an array, an object, a
  // boolean) reads as the fallback instead of a coerced number
  // (Number([]) is 0, which would silently read as a real value
  // instead of the fallback — the cycle-13 strict-coercion lesson).
  function saneNum(v, fallback) {
    if (v == null || v === '') return fallback;
    if (typeof v === 'number') return isFinite(v) ? v : fallback;
    if (typeof v === 'string') {
      if (v.trim() === '') return fallback;
      var n = Number(v);
      return isFinite(n) ? n : fallback;
    }
    return fallback;
  }

  // The state itself, or null for a missing / non-object state — the
  // callers below degrade to the fresh-game default instead of
  // throwing, so a dropped module tag reads the same as a game that
  // never touched lives.
  function stateOf(state) {
    return (state && typeof state === 'object') ? state : null;
  }

  // --- Normalizers ---------------------------------------------------------

  // The lives count: a whole number 0–99, default 3 (the arcade
  // default). Below 0 reads as 0 — a game that starts already over.
  function normalizeLives(v) {
    var n = saneNum(v, 3);
    if (n <= 0) return 0;
    if (n > 99) return 99;
    return Math.floor(n);
  }

  // An amount to add or lose: a whole number 0–99, default 1. 0 is
  // a legal no-op amount.
  function normalizeLivesAmount(v) {
    var n = saneNum(v, 1);
    if (n <= 0) return 0;
    if (n > 99) return 99;
    return Math.floor(n);
  }

  // --- State ---------------------------------------------------------------

  // A fresh transient lives state for a run: the default 3 lives.
  // The hosts mint one per run (the export at state creation, the
  // preview lazily through livesRuntime) — never per scene, so the
  // count survives scene switches inside the run.
  function createLivesState() {
    return { lives: 3 };
  }

  // --- Reads ---------------------------------------------------------------

  // How many lives are left. A missing state reads as the default 3
  // (a fresh game has 3 lives), a negative count reads as 0, and a
  // non-numeric count reads as the default. Never throws.
  function livesOf(state) {
    try {
      var st = stateOf(state);
      if (!st) return 3;
      if (st.lives == null) return 3;
      var n = saneNum(st.lives, 3);
      return (n < 0) ? 0 : Math.floor(n);
    } catch (e) {
      return 3;
    }
  }

  // True while the game is over: the count reads 0. Derived, never
  // stored — gaining a life after game over (a continue) clears it,
  // so losing the last life again fires the edge again. Never throws.
  function isGameOver(state) {
    try {
      return livesOf(state) <= 0;
    } catch (e) {
      return false;
    }
  }

  // --- Writes --------------------------------------------------------------

  // Write the count outright, clamped 0–99. Returns the new count,
  // or null when there is no state to write. Never throws.
  function setLives(state, v) {
    try {
      var st = stateOf(state);
      if (!st) return null;
      st.lives = normalizeLives(v);
      return st.lives;
    } catch (e) {
      return null;
    }
  }

  // Top the count up, clamped at 99. Returns the new count, or null
  // when there is no state to write. Never throws.
  function addLives(state, amount) {
    try {
      var st = stateOf(state);
      if (!st) return null;
      st.lives = Math.min(99, livesOf(st) + normalizeLivesAmount(amount));
      return st.lives;
    } catch (e) {
      return null;
    }
  }

  // Spend lives, clamped at 0 — the count never goes negative, so
  // losing a life at 0 stays at 0 and game over stays true. Returns
  // the new count, or null when there is no state to write. Never
  // throws.
  function loseLives(state, amount) {
    try {
      var st = stateOf(state);
      if (!st) return null;
      st.lives = Math.max(0, livesOf(st) - normalizeLivesAmount(amount));
      return st.lives;
    } catch (e) {
      return null;
    }
  }

  // --- Routing -------------------------------------------------------------

  function isLivesAction(type) {
    return type === 'setLives' || type === 'addLives' ||
      type === 'loseLife' || type === 'readLives';
  }

  function isLivesCondition(type) {
    return type === 'lives' || type === 'gameOver';
  }

  return {
    createLivesState: createLivesState,
    normalizeLives: normalizeLives,
    normalizeLivesAmount: normalizeLivesAmount,
    livesOf: livesOf,
    isGameOver: isGameOver,
    setLives: setLives,
    addLives: addLives,
    loseLives: loseLives,
    isLivesAction: isLivesAction,
    isLivesCondition: isLivesCondition
  };
}

if (typeof window !== 'undefined') {
  window.HydraLives = hydraLivesFactory();
  // Self-contained source of the factory, inlined into exported playable games
  // by HydraPlayer.buildPlayableHtml so exports run without editor files.
  window.HydraLives.factorySource = hydraLivesFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraLivesFactory;
