/* ============================================================================
 * hydra-attach.js — HydraScript shared object parenting (P4 Advanced
 * batch 37: attach, beginner edition).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation
 * of how one object rides on another — used by:
 *   - the editor preview runtime (hydra-previewruntime.js delegates
 *     to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Idea (Unity Transform parenting / Godot node parenting, beginner
 * edition): batch 36 let the player see where things are, but one
 * object still could not ride on another — a sword in the hero's
 * hand, a hat on a goblin, a name tag above an NPC all meant
 * re-aiming the child every frame by hand. An attachment is a plain
 * link: the child object follows its parent's position plus a fixed
 * offset, applied every frame after every other movement phase, so
 * the attach is the frame's final word on the child's position.
 *
 *   state — a fresh link table per scene load (like damage numbers):
 *     createAttachState returns { links: {} }, child name -> { parent,
 *     dx, dy }. A scene load re-clones its objects from the authored
 *     definitions, so a stale link would snap the child back to a
 *     dead parent's spot — a fresh scene starts with no links, and a
 *     gameStart row re-attaches what it needs. Links never travel in
 *     save slots.
 *   attach — a blank child or parent name, a child attached to
 *     itself, or a link that would close a cycle (A on B, B on A)
 *     all refuse and return false, so the caller can warn and hold.
 *     Attaching a child that already has a parent replaces the old
 *     link — one parent per child, like the real engines' single
 *     parent slot.
 *   offsets — numbers in world pixels from the parent's top-left
 *     corner to the child's top-left corner. The Attach block leaves
 *     them blank to keep the spacing the objects already have; the
 *     execute layer computes that spacing from the live positions
 *     and hands the module plain numbers.
 *   apply — once per frame, after the combat phase (the last mover),
 *     every link sets its child to parent + offset. A missing child
 *     or parent stays quiet (the object may spawn later — a link to
 *     a not-yet-spawned object starts working the frame it appears),
 *     and a parent with a non-finite position holds the child where
 *     it is instead of dragging it off the map. When several objects
 *     share the parent's name the first live one wins, the same rule
 *     named() uses everywhere else.
 *
 * Nothing ever throws; hostile input degrades to safe defaults.
 *
 * Honest limits: position only — a child does not inherit its
 * parent's rotation or scale; one parent per child; a child follows
 * the first live object with the parent's name; links clear on
 * scene load; no `hs` script-API surface yet.
 *
 * Load order (index.html): hydra-attach.js BEFORE player-runtime.js
 * and script.js. player-runtime.js throws a clear error if HydraAttach
 * is missing.
 * ========================================================================== */

function hydraAttachFactory() {
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

  // A trimmed name, or '' when the value is not a usable name.
  function cleanName(v) {
    if (v == null) return '';
    return String(v).trim();
  }

  // The links table itself, or an empty table for a missing /
  // non-object state — the callers below degrade to "no links"
  // instead of throwing, so a dropped module tag reads the same as
  // a scene with nothing attached.
  function linksOf(state) {
    try {
      if (!state || typeof state !== 'object') return {};
      var links = state.links;
      return (links && typeof links === 'object' && !Array.isArray(links)) ? links : {};
    } catch (e) {
      return {};
    }
  }

  // --- State ---------------------------------------------------------------

  // A fresh transient link table for a run / scene load. The table is
  // the whole state — links are plain name pairs, so nothing else
  // needs to remember them.
  function createAttachState() {
    return { links: {} };
  }

  // How many links the table holds. A missing state reads as 0.
  // Never throws.
  function attachCount(state) {
    try {
      var links = linksOf(state);
      var n = 0;
      for (var k in links) {
        if (Object.prototype.hasOwnProperty.call(links, k)) n++;
      }
      return n;
    } catch (e) {
      return 0;
    }
  }

  // --- Links ---------------------------------------------------------------

  // True when attaching `child` to `parent` would close a cycle:
  // walk the chain up from the parent, and if the child shows up
  // anywhere on it, the new link would loop. A blank name never
  // cycles (the attach refuses it on its own). Never throws.
  function wouldCycle(state, child, parent) {
    try {
      var c = cleanName(child);
      var p = cleanName(parent);
      if (c === '' || p === '') return false;
      if (c === p) return true;
      var links = linksOf(state);
      var seen = {};
      var cur = p;
      while (cur !== '' && !seen[cur]) {
        seen[cur] = true;
        if (cur === c) return true;
        var link = links[cur];
        if (!link || typeof link !== 'object') return false;
        cur = cleanName(link.parent);
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  // Link `child` to `parent` at the offset (dx, dy) in world pixels
  // from the parent's top-left corner to the child's. A missing state,
  // a blank child or parent name, a self-attach, or a cycle all
  // refuse and return false, so the caller can warn and hold.
  // Attaching a child that already has a parent replaces the old
  // link. Returns true when the link was stored. Never throws.
  function attach(state, child, parent, dx, dy) {
    try {
      if (!state || typeof state !== 'object') return false;
      var c = cleanName(child);
      var p = cleanName(parent);
      if (c === '' || p === '') return false;
      if (c === p) return false;
      if (wouldCycle(state, c, p)) return false;
      if (!state.links || typeof state.links !== 'object' || Array.isArray(state.links)) {
        state.links = {};
      }
      state.links[c] = {
        parent: p,
        dx: saneNum(dx, 0),
        dy: saneNum(dy, 0)
      };
      return true;
    } catch (e) {
      return false;
    }
  }

  // Drop the child's link. Returns true when a link was removed,
  // false when the child had none (or the state is missing). Never
  // throws.
  function detach(state, child) {
    try {
      if (!state || typeof state !== 'object') return false;
      var c = cleanName(child);
      if (c === '') return false;
      var links = linksOf(state);
      if (!Object.prototype.hasOwnProperty.call(links, c)) return false;
      delete state.links[c];
      return true;
    } catch (e) {
      return false;
    }
  }

  // Move a child's offset without re-attaching it: the child stays
  // on the same parent at the new spacing. Returns false when the
  // child is not attached, or when either offset is not a number —
  // the old offset stands then, so a bad value never yanks the
  // child. Returns true when the offset changed. Never throws.
  function setOffset(state, child, dx, dy) {
    try {
      if (!state || typeof state !== 'object') return false;
      var c = cleanName(child);
      if (c === '') return false;
      var links = linksOf(state);
      var link = links[c];
      if (!link || typeof link !== 'object') return false;
      var nx = saneNum(dx, NaN);
      var ny = saneNum(dy, NaN);
      if (!isFinite(nx) || !isFinite(ny)) return false;
      link.dx = nx;
      link.dy = ny;
      return true;
    } catch (e) {
      return false;
    }
  }

  // True while the child has a link — to the named parent when one
  // is given, to any parent when it is blank. A blank child reads
  // as not attached. Never throws.
  function isAttached(state, child, parent) {
    try {
      var c = cleanName(child);
      if (c === '') return false;
      var link = linksOf(state)[c];
      if (!link || typeof link !== 'object') return false;
      var p = cleanName(parent);
      if (p === '') return true;
      return cleanName(link.parent) === p;
    } catch (e) {
      return false;
    }
  }

  // The child's link ({ parent, dx, dy }) as a copy, or null when
  // the child has none. The copy keeps a caller from rewriting the
  // table by accident. Never throws.
  function attachmentOf(state, child) {
    try {
      var c = cleanName(child);
      if (c === '') return null;
      var link = linksOf(state)[c];
      if (!link || typeof link !== 'object') return null;
      return {
        parent: cleanName(link.parent),
        dx: saneNum(link.dx, 0),
        dy: saneNum(link.dy, 0)
      };
    } catch (e) {
      return null;
    }
  }

  // --- Per-frame apply -----------------------------------------------------

  // The first live object with the name, or null. The caller passes
  // the live list (already filtered of destroyed objects by the host,
  // the way the AI / path phases receive theirs), so a missing name
  // reads as null instead of throwing. Never throws.
  function findNamed(objects, name) {
    try {
      if (!Array.isArray(objects)) return null;
      var n = cleanName(name);
      if (n === '') return null;
      for (var i = 0; i < objects.length; i++) {
        var o = objects[i];
        if (o && typeof o === 'object' && cleanName(o.name) === n) return o;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  // Set every linked child to its parent's position plus the stored
  // offset. A link whose child or parent is missing stays quiet (the
  // object may spawn later — the link starts working the frame it
  // appears), and a parent with a non-finite position holds the child
  // where it is. Returns how many children moved. Never throws.
  function applyAttachments(state, objects) {
    try {
      var links = linksOf(state);
      if (!Array.isArray(objects)) return 0;
      var moved = 0;
      for (var child in links) {
        if (!Object.prototype.hasOwnProperty.call(links, child)) continue;
        var link = links[child];
        if (!link || typeof link !== 'object') continue;
        var parent = findNamed(objects, link.parent);
        if (!parent) continue;
        var px = saneNum(parent.posX, NaN);
        var py = saneNum(parent.posY, NaN);
        if (!isFinite(px) || !isFinite(py)) continue;
        var kid = findNamed(objects, child);
        if (!kid) continue;
        kid.posX = px + saneNum(link.dx, 0);
        kid.posY = py + saneNum(link.dy, 0);
        moved++;
      }
      return moved;
    } catch (e) {
      return 0;
    }
  }

  // --- Routing -------------------------------------------------------------

  function isAttachAction(type) {
    return type === 'attachObjectToObject' || type === 'detachObject' ||
      type === 'setAttachmentOffset';
  }

  function isAttachCondition(type) {
    return type === 'isAttached';
  }

  return {
    createAttachState: createAttachState,
    attachCount: attachCount,
    wouldCycle: wouldCycle,
    attach: attach,
    detach: detach,
    setOffset: setOffset,
    isAttached: isAttached,
    attachmentOf: attachmentOf,
    applyAttachments: applyAttachments,
    isAttachAction: isAttachAction,
    isAttachCondition: isAttachCondition
  };
}

if (typeof window !== 'undefined') {
  window.HydraAttach = hydraAttachFactory();
  // Self-contained source of the factory, inlined into exported playable games
  // by HydraPlayer.buildPlayableHtml so exports run without editor files.
  window.HydraAttach.factorySource = hydraAttachFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraAttachFactory;
