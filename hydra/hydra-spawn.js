/* ============================================================================
 * hydra-spawn.js — HydraScript shared enemy spawner / wave spawning (P4
 * Advanced batch 24: enemy spawner, beginner edition).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation
 * of enemies that keep coming on their own — used by:
 *   - the editor preview runtime (hydra-previewruntime.js delegates
 *     to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Idea (Unity spawn systems / Godot spawners, beginner edition): batch
 * 21 gave every object hit points, batch 22 made the hit feel like a
 * hit, and batch 23 brought the player back after dying — but the
 * enemies still had to be placed by hand, one block at a time, or
 * driven by hand-built timer chains. A spawner is the classic loop
 * that fills the gap:
 *
 *   spawner — Start Spawner names one: the template object to clone
 *     (an enemy, a coin, a power-up), the spot to clone it at (the
 *     top-left corner of a named spawn-point object, or the X/Y point
 *     when no object is named), how often (every N seconds), how many
 *     may be alive at once (the max-alive cap, 0 = no cap), and how
 *     many in total (0 = endless). Starting a spawner with a name that
 *     already runs replaces it, timer and count fresh — so re-running
 *     the block restarts the wave instead of doubling it.
 *   tick — once a frame, in the updateSpawners phase (last in the
 *     world sim, after the path follower, so a newborn never gets a
 *     half-stepped physics or AI update on its birth frame), every
 *     running spawner banks its frame time and spawns when a full
 *     interval has passed. The first spawn lands after one interval,
 *     never at once, so a wave has a readable beat. A long hitch
 *     banks the time instead of spawning a burst: at most 25 spawns
 *     per spawner per frame, the remainder draining over the next
 *     frames.
 *   caps — the max-alive cap counts every live object with the
 *     template's name, however it got there (a hand-spawned enemy
 *     holds a slot too), and a capped spawner simply waits: the
 *     interval passes, no spawn, and it tries again next interval, so
 *     killing an enemy frees the slot on the next tick. A total, when
 *     set, ends the spawner: reaching it stops the spawner, so
 *     Spawner Active reads false once the wave is done.
 *   count — Read Spawned Count copies how many the spawner has made
 *     into a variable (show it, save it, compare it), and Spawned
 *     Count reads it as a condition, so the game can open the goal
 *     door after 10 spawns or end the wave at 20.
 *
 * The state is transient run state, minted fresh per scene load (like
 * the floating damage numbers and the checkpoint): a fresh scene
 * starts with no spawners running, and it never travels in save slots
 * — persist it through a variable the way quests and inventory do
 * (read the count with Read Spawned Count on save, and re-start the
 * spawner on load). Spawners never survive a scene switch on purpose:
 * a wave from level 1 must never keep spawning into level 2.
 *
 * Spawning itself belongs to the host: the module asks the host's
 * hooks to clone the template (through the same Spawn Object action
 * both runtimes already run), to find the anchor object, and to count
 * the live objects with a name. A missing hook degrades to "no
 * spawn this tick" instead of throwing, so a dropped module tag reads
 * the same as a spawner with no template.
 *
 * Nothing ever throws; hostile input degrades to safe defaults.
 *
 * Honest limits: one spawn per interval tick per spawner (a 0.1s
 * interval at 60fps still spawns at most once a frame); the clone's
 * top-left corner lands at the spawn point (the anchor's top-left
 * corner, or the X/Y point), not its center; max alive counts every
 * live object with the template's name, however it got there; a
 * named anchor that is missing or destroyed holds the spawn until it
 * exists again (the interval passes with no spawn); a spawner never
 * sets an AI behavior or a path on what it spawns — chain Set AI
 * Behavior after the spawn if the newborn should chase; no `hs`
 * script-API surface yet.
 *
 * Load order (index.html): hydra-spawn.js BEFORE player-runtime.js
 * and script.js. player-runtime.js throws a clear error if HydraSpawn
 * is missing.
 * ========================================================================== */

function hydraSpawnFactory() {
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
  // callers below degrade to "no spawners running" instead of
  // throwing, so a dropped module tag reads the same as a fresh scene.
  function stateOf(state) {
    return (state && typeof state === 'object') ? state : null;
  }

  // A spawner name, trimmed: blank names cannot be addressed later,
  // so they never start a spawner.
  function cleanName(v) {
    return String((v == null) ? '' : v).trim();
  }

  // --- Normalizers ---------------------------------------------------------

  // Seconds between spawns: 0.1–3600, default 2. Below 0.1 would
  // spawn every frame at 60fps, so the floor keeps the beat readable.
  function normalizeInterval(v) {
    var n = saneNum(v, 2);
    if (n < 0.1) return 0.1;
    if (n > 3600) return 3600;
    return n;
  }

  // How many live objects with the template's name may exist at once:
  // a whole number 0–1000, default 10. 0 means no cap.
  function normalizeMaxAlive(v) {
    var n = saneNum(v, 10);
    if (n <= 0) return 0;
    if (n > 1000) return 1000;
    return Math.floor(n);
  }

  // How many the spawner makes in total: a whole number 0–10000,
  // default 0. 0 means endless — the wave never ends on its own.
  function normalizeTotal(v) {
    var n = saneNum(v, 0);
    if (n <= 0) return 0;
    if (n > 10000) return 10000;
    return Math.floor(n);
  }

  // --- State ---------------------------------------------------------------

  // A fresh transient spawner state for a run / scene load: no
  // spawners running. The hosts mint one per scene load through the
  // scene-reset hook.
  function createSpawnerState() {
    return { spawners: {} };
  }

  // The named spawner record, or null when no spawner by that name
  // runs in this state. Never throws.
  function spawnerOf(state, name) {
    try {
      var st = stateOf(state);
      if (!st || !st.spawners || typeof st.spawners !== 'object') return null;
      var sp = st.spawners[cleanName(name)];
      return (sp && typeof sp === 'object') ? sp : null;
    } catch (e) {
      return null;
    }
  }

  // --- Start / stop ----------------------------------------------------------

  // Start (or restart) a named spawner: the template to clone, the
  // spot to clone it at (the top-left corner of the named anchor
  // object, or the X/Y point when no object is named), the interval,
  // the max-alive cap, and the total. A blank name or a blank
  // template reads as null (no spawner starts — there is nothing to
  // address or nothing to clone). Restarting a running spawner
  // replaces it with a fresh timer and a zero count. Returns the
  // record, or null. Never throws.
  function startSpawner(state, spec) {
    try {
      var st = stateOf(state);
      if (!st) return null;
      var s = (spec && typeof spec === 'object') ? spec : {};
      var name = cleanName(s.name);
      var template = cleanName(s.template);
      if (!name || !template) return null;
      if (!st.spawners || typeof st.spawners !== 'object') st.spawners = {};
      var rec = {
        name: name,
        template: template,
        atObject: cleanName(s.atObject),
        x: saneNum(s.x, 0),
        y: saneNum(s.y, 0),
        interval: normalizeInterval(s.interval),
        maxAlive: normalizeMaxAlive(s.maxAlive),
        total: normalizeTotal(s.total),
        active: true,
        timer: 0,
        spawned: 0
      };
      st.spawners[name] = rec;
      return rec;
    } catch (e) {
      return null;
    }
  }

  // Stop one spawner by name: it never spawns again, and Spawner
  // Active reads false. A blank name or an unknown name is a no-op.
  // Never throws.
  function stopSpawner(state, name) {
    try {
      var sp = spawnerOf(state, name);
      if (sp) sp.active = false;
    } catch (e) { /* a throwing stop never breaks the frame */ }
  }

  // Stop every spawner in the state. A missing state is a no-op.
  // Never throws.
  function stopAllSpawners(state) {
    try {
      var st = stateOf(state);
      if (!st || !st.spawners || typeof st.spawners !== 'object') return;
      var names = Object.keys(st.spawners);
      for (var i = 0; i < names.length; i++) {
        var sp = st.spawners[names[i]];
        if (sp && typeof sp === 'object') sp.active = false;
      }
    } catch (e) { /* a throwing stop never breaks the frame */ }
  }

  // --- Reads ---------------------------------------------------------------

  // True while the named spawner runs: it exists, it is active, and
  // it has not reached its total yet (a finished wave reads false
  // even before the next tick notices). A missing state or name reads
  // as false. Never throws.
  function spawnerActive(state, name) {
    try {
      var sp = spawnerOf(state, name);
      if (!sp || !sp.active) return false;
      var total = normalizeTotal(sp.total);
      if (total > 0 && saneNum(sp.spawned, 0) >= total) return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  // How many the named spawner has made so far. A missing state or
  // name reads as 0, and a negative count reads as 0. Never throws.
  function spawnedCount(state, name) {
    try {
      var sp = spawnerOf(state, name);
      if (!sp) return 0;
      var n = saneNum(sp.spawned, 0);
      return (n < 0) ? 0 : n;
    } catch (e) {
      return 0;
    }
  }

  // --- Tick ------------------------------------------------------------------

  // Advance every running spawner by dtSeconds (the frame's scaled
  // step, so spawners slow with the time scale and freeze while
  // paused) and spawn what is due. Hooks (all optional):
  //   spawn(template, x, y) -> the spawned object, or null when the
  //     template does not exist (the clone's top-left corner lands at
  //     the point; a missing template stays quiet and retries next
  //     interval);
  //   findObject(name) -> the anchor object, or null (a named anchor
  //     that is missing holds the spawn until it exists again);
  //   aliveCount(template) -> how many live objects carry the
  //     template's name (the max-alive cap reads it).
  // A tick with dt <= 0 ages nothing (the first frame runs with dt
  // 0, so nothing spawns before the game has really started). At
  // most 25 spawns per spawner per frame — a long hitch banks the
  // leftover time instead of spawning a burst. Never throws.
  function updateSpawners(state, dtSeconds, hooks) {
    try {
      var st = stateOf(state);
      if (!st || !st.spawners || typeof st.spawners !== 'object') return;
      var dt = saneNum(dtSeconds, 0);
      if (!(dt > 0)) return;
      var h = (hooks && typeof hooks === 'object') ? hooks : {};
      var names = Object.keys(st.spawners);
      for (var i = 0; i < names.length; i++) {
        var sp = st.spawners[names[i]];
        if (!sp || typeof sp !== 'object' || !sp.active) continue;
        var total = normalizeTotal(sp.total);
        if (total > 0 && saneNum(sp.spawned, 0) >= total) {
          sp.active = false;
          continue;
        }
        var interval = normalizeInterval(sp.interval);
        var maxAlive = normalizeMaxAlive(sp.maxAlive);
        sp.timer = saneNum(sp.timer, 0) + dt;
        var tries = 0;
        while (sp.timer >= interval && tries < 25) {
          tries++;
          sp.timer -= interval;
          if (total > 0 && saneNum(sp.spawned, 0) >= total) {
            sp.active = false;
            break;
          }
          if (maxAlive > 0) {
            var alive = 0;
            try {
              if (typeof h.aliveCount === 'function') alive = saneNum(h.aliveCount(sp.template), 0);
            } catch (e) { alive = 0; }
            if (alive >= maxAlive) break;
          }
          var pos = null;
          if (sp.atObject) {
            var anchor = null;
            try {
              if (typeof h.findObject === 'function') anchor = h.findObject(sp.atObject);
            } catch (e) { anchor = null; }
            if (anchor && typeof anchor === 'object') {
              pos = { x: saneNum(anchor.posX, 0), y: saneNum(anchor.posY, 0) };
            } else {
              break;
            }
          } else {
            pos = { x: saneNum(sp.x, 0), y: saneNum(sp.y, 0) };
          }
          var born = null;
          try {
            if (typeof h.spawn === 'function') born = h.spawn(sp.template, pos.x, pos.y);
          } catch (e) { born = null; }
          if (born) {
            sp.spawned = saneNum(sp.spawned, 0) + 1;
            // Reaching the total ends the wave at once: the spawner
            // reads as stopped on the same frame the last one lands,
            // instead of waiting for the next tick to notice.
            if (total > 0 && sp.spawned >= total) {
              sp.active = false;
              break;
            }
          }
        }
      }
    } catch (e) { /* a throwing tick never breaks the frame */ }
  }

  // --- Routing -------------------------------------------------------------

  function isSpawnAction(type) {
    return type === 'startSpawner' || type === 'stopSpawner' ||
      type === 'readSpawnedCount';
  }

  function isSpawnCondition(type) {
    return type === 'spawnerActive' || type === 'spawnedCount';
  }

  return {
    createSpawnerState: createSpawnerState,
    spawnerOf: spawnerOf,
    normalizeInterval: normalizeInterval,
    normalizeMaxAlive: normalizeMaxAlive,
    normalizeTotal: normalizeTotal,
    startSpawner: startSpawner,
    stopSpawner: stopSpawner,
    stopAllSpawners: stopAllSpawners,
    spawnerActive: spawnerActive,
    spawnedCount: spawnedCount,
    updateSpawners: updateSpawners,
    isSpawnAction: isSpawnAction,
    isSpawnCondition: isSpawnCondition
  };
}

if (typeof window !== 'undefined') {
  window.HydraSpawn = hydraSpawnFactory();
  // Self-contained source of the factory, inlined into exported playable games
  // by HydraPlayer.buildPlayableHtml so exports run without editor files.
  window.HydraSpawn.factorySource = hydraSpawnFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraSpawnFactory;
