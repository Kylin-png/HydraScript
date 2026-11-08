/* ============================================================================
 * hydra-respawn.js — HydraScript shared checkpoints & respawn (P4 Advanced
 * batch 23: checkpoints & respawn, beginner edition).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation
 * of coming back after a death — used by:
 *   - the editor preview runtime (hydra-previewruntime.js delegates
 *     to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Idea (Unity checkpoint / respawn systems / Godot respawn points,
 * beginner edition): batch 21 gave every object hit points and batch
 * 22 made the hit feel like a hit, but death still left the game to
 * decide what happens next with hand-built variables and teleports.
 * Three small pieces make the classic loop work:
 *
 *   checkpoint — Set Checkpoint records one point for the scene: the
 *     top-left corner of a named checkpoint object (a flag, a door, a
 *     campfire), or the X/Y point when no object is named. One
 *     checkpoint per scene; setting a new one replaces the old, so a
 *     level's flags naturally hand the respawn forward as the player
 *     passes them. Clear Checkpoint forgets it again.
 *   respawn — Respawn Object sends the object back: to the checkpoint
 *     when one is set, or to where the object started the scene when
 *     none is set yet (the start positions are recorded at scene load,
 *     so a fresh scene always has a home to send the player to). The
 *     teleport writes the position, zeroes the velocity (a dead body
 *     sliding off a cliff should not keep sliding), stops a walking
 *     path (the path was planned from the old spot), and — when the
 *     Restore health box is ticked — fills the health back to full.
 *     Each respawn counts, so the game can end after three deaths or
 *     show a "lives used" counter.
 *   count — the Respawn Count condition reads how many times the
 *     scene has respawned anyone, and Checkpoint Set reads whether a
 *     checkpoint is recorded at all, so the game can gate the goal
 *     door on reaching the flag or flash "no checkpoint yet" at the
 *     start.
 *
 * The state is transient run state, minted fresh per scene load (like
 * the floating damage numbers): a fresh scene starts with no
 * checkpoint and a zero count, and it never travels in save slots —
 * persist it through a variable the way quests and inventory do (read
 * the count with the Respawn Count condition into Set Variable on
 * save, and re-set the checkpoint on load). The checkpoint is
 * per-scene on purpose: a checkpoint from level 1 must never send the
 * player back into level 1 after they died in level 2.
 *
 * Nothing ever throws; hostile input degrades to safe defaults.
 *
 * Honest limits: one checkpoint per scene (no checkpoint list, no
 * named checkpoints); the respawn point is the object's top-left
 * corner, not its center; an AI behavior keeps running after a
 * respawn (the brain re-plans from the new spot — stop it yourself
 * with Stop AI if the respawn should calm the enemy down); the shield
 * from Make Invincible is left alone (chain Make Invincible after
 * Respawn Object for a spawn shield); no `hs` script-API surface yet.
 *
 * Load order (index.html): hydra-respawn.js BEFORE player-runtime.js
 * and script.js. player-runtime.js throws a clear error if HydraRespawn
 * is missing.
 * ========================================================================== */

function hydraRespawnFactory() {
  'use strict';

  // A usable number, or the fallback when the value is not one.
  // null / undefined / '' count as missing (Number(null) is 0, which
  // would silently read as a real value instead of the fallback).
  function saneNum(v, fallback) {
    if (v == null || v === '') return fallback;
    var n = Number(v);
    return isFinite(n) ? n : fallback;
  }

  // The state itself, or null for a missing / non-object state — the
  // callers below degrade to "no checkpoint, no respawns" instead of
  // throwing, so a dropped module tag reads the same as a fresh scene.
  function stateOf(state) {
    return (state && typeof state === 'object') ? state : null;
  }

  // --- State ---------------------------------------------------------------

  // A fresh transient respawn state for a run / scene load: no
  // checkpoint yet, nobody respawned, no start positions recorded.
  // The hosts mint one per scene load through the scene-reset hook.
  function createRespawnState() {
    return { point: null, count: 0, initial: {} };
  }

  // --- Checkpoints ---------------------------------------------------------

  // Record the checkpoint at a world position: { x, y, name }. The
  // name is the checkpoint object's name, or '' for an X/Y point, so
  // a test (or a debug read) can tell which kind it was. A missing
  // state or a non-finite position reads as null (nothing recorded);
  // setting a new checkpoint replaces the old one. Returns the point,
  // or null. Never throws.
  function setCheckpoint(state, x, y, name) {
    try {
      var st = stateOf(state);
      if (!st) return null;
      var px = saneNum(x, NaN);
      var py = saneNum(y, NaN);
      if (!isFinite(px) || !isFinite(py)) return null;
      var nm = (name == null) ? '' : String(name);
      st.point = { x: px, y: py, name: nm };
      return st.point;
    } catch (e) {
      return null;
    }
  }

  // Forget the checkpoint: the next respawn goes home to the start
  // position instead. A missing state is a no-op. Never throws.
  function clearCheckpoint(state) {
    try {
      var st = stateOf(state);
      if (st) st.point = null;
    } catch (e) { /* a throwing clear never breaks the frame */ }
  }

  // True while a checkpoint is recorded. A missing state or a missing
  // point reads as false — a fresh scene has no checkpoint yet.
  // Never throws.
  function hasCheckpoint(state) {
    try {
      var st = stateOf(state);
      return !!(st && st.point && typeof st.point === 'object');
    } catch (e) {
      return false;
    }
  }

  // The recorded point ({ x, y, name }), or null when none is set.
  // Never throws.
  function checkpointOf(state) {
    try {
      var st = stateOf(state);
      return (st && st.point && typeof st.point === 'object') ? st.point : null;
    } catch (e) {
      return null;
    }
  }

  // --- Start positions -----------------------------------------------------

  // Remember where every object started the scene: initial[name] =
  // { x, y } from the object's top-left corner. The first object per
  // name wins, so two coins sharing a name both respawn at the first
  // coin's spot — the same first-match rule the action targets use.
  // A missing state or a non-array objects list is a no-op. Never
  // throws.
  function recordInitialPositions(state, objects) {
    try {
      var st = stateOf(state);
      if (!st) return;
      if (!st.initial || typeof st.initial !== 'object') st.initial = {};
      if (!Array.isArray(objects)) return;
      for (var i = 0; i < objects.length; i++) {
        var o = objects[i];
        if (!o || typeof o !== 'object') continue;
        var name = (o.name == null) ? '' : String(o.name);
        if (name === '' || st.initial[name]) continue;
        var x = saneNum(o.posX, NaN);
        var y = saneNum(o.posY, NaN);
        if (!isFinite(x) || !isFinite(y)) continue;
        st.initial[name] = { x: x, y: y };
      }
    } catch (e) { /* a throwing record never breaks scene load */ }
  }

  // The recorded start position for a name ({ x, y }), or null when
  // the scene never recorded one (a spawned clone shares its name's
  // spot; a truly unknown name has no home). Never throws.
  function initialPositionOf(state, name) {
    try {
      var st = stateOf(state);
      if (!st || !st.initial || typeof st.initial !== 'object') return null;
      var nm = (name == null) ? '' : String(name);
      var pos = st.initial[nm];
      return (pos && typeof pos === 'object' && isFinite(saneNum(pos.x, NaN)) &&
        isFinite(saneNum(pos.y, NaN))) ? { x: pos.x, y: pos.y } : null;
    } catch (e) {
      return null;
    }
  }

  // --- Respawn -------------------------------------------------------------

  // Where the named object respawns: the checkpoint when one is set,
  // else the object's start position, else null (no checkpoint, no
  // recorded start — the caller stays quiet). The returned point is a
  // fresh { x, y } copy, so the caller can never mutate the recorded
  // checkpoint by writing into it. Never throws.
  function respawnPosition(state, name) {
    try {
      var cp = checkpointOf(state);
      if (cp) return { x: cp.x, y: cp.y };
      var home = initialPositionOf(state, name);
      return home ? { x: home.x, y: home.y } : null;
    } catch (e) {
      return null;
    }
  }

  // Count one respawn and return the new count (1 after the first
  // death, so "died once" reads as Respawn Count >= 1). A missing
  // state reads as 0. Never throws.
  function noteRespawn(state) {
    try {
      var st = stateOf(state);
      if (!st) return 0;
      var n = saneNum(st.count, 0);
      if (n < 0) n = 0;
      st.count = n + 1;
      return st.count;
    } catch (e) {
      return 0;
    }
  }

  // How many times anyone respawned in this scene. A missing state
  // reads as 0. Never throws.
  function respawnCount(state) {
    try {
      var st = stateOf(state);
      if (!st) return 0;
      var n = saneNum(st.count, 0);
      return (n < 0) ? 0 : n;
    } catch (e) {
      return 0;
    }
  }

  // --- Routing -------------------------------------------------------------

  function isRespawnAction(type) {
    return type === 'setCheckpoint' || type === 'respawnObject' ||
      type === 'clearCheckpoint';
  }

  function isRespawnCondition(type) {
    return type === 'checkpointSet' || type === 'respawnCount';
  }

  return {
    createRespawnState: createRespawnState,
    setCheckpoint: setCheckpoint,
    clearCheckpoint: clearCheckpoint,
    hasCheckpoint: hasCheckpoint,
    checkpointOf: checkpointOf,
    recordInitialPositions: recordInitialPositions,
    initialPositionOf: initialPositionOf,
    respawnPosition: respawnPosition,
    noteRespawn: noteRespawn,
    respawnCount: respawnCount,
    isRespawnAction: isRespawnAction,
    isRespawnCondition: isRespawnCondition
  };
}

if (typeof window !== 'undefined') {
  window.HydraRespawn = hydraRespawnFactory();
  // Self-contained source of the factory, inlined into exported playable games
  // by HydraPlayer.buildPlayableHtml so exports run without editor files.
  window.HydraRespawn.factorySource = hydraRespawnFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraRespawnFactory;
