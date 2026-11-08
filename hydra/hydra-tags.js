/* ============================================================================
 * hydra-tags.js — HydraScript shared object tags (P4 Advanced
 * batch 34: object tags / groups, beginner edition).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation
 * of how an object's tags work — used by:
 *   - the editor preview runtime (hydra-previewruntime.js delegates
 *     to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Idea (Unity Tags / Godot Groups, beginner edition): batch 33 gave
 * the run a boss, but a game still had no way to ask "how many
 * goblins are left" without naming each one. A tag is a plain label
 * on an object — goblin, coin, boss, collectible — so a whole group
 * of objects can be asked about at once:
 *
 *   author — the Inspector Tags section lists an object's tags as
 *     chips, with an add box. Those are the permanent tags: a fresh
 *     run starts with them, and a scene that loads again restores
 *     them. Old projects keep working: an object with no tags field
 *     simply has none.
 *   runtime — Add Tag sticks a label on a live object, Remove Tag
 *     takes one off, Clear Tags takes them all off. Runtime tags
 *     last until the scene loads again (a scene load re-clones its
 *     objects from the authored definitions, like every other
 *     runtime change to a live object).
 *   ask — Has Tag is true while any live object with the name
 *     carries the tag; Tagged Count compares how many live objects
 *     carry it, so the classic win row is Tagged Count goblin
 *     equals 0; Read Tagged Count copies that count into a
 *     variable, so a label can show "goblins left: 3".
 *
 * Matching ignores case, so "Goblin" and "goblin" are the same tag
 * and the first spelling wins; a tag is trimmed, at most 64
 * characters, and an object holds at most 16. Nothing ever throws;
 * hostile input degrades to safe defaults.
 *
 * Honest limits: a tag never travels in save slots (persist a count
 * through Read Tagged Count into a variable, the way quests and
 * inventory do); no `hs` script-API surface yet. Picking by tag
 * lives in hydra-pick.js (Pick Nearest / Farthest / Random Tagged,
 * Pick Tagged Object Into Variable) and walking a tag lives in
 * hydra-execute.js (For Each Tagged Object).
 *
 * Load order (index.html): hydra-tags.js BEFORE player-runtime.js
 * and script.js. player-runtime.js throws a clear error if HydraTags
 * is missing.
 * ========================================================================== */

function hydraTagsFactory() {
  'use strict';

  var MAX_TAGS_PER_OBJECT = 16;
  var MAX_TAG_LENGTH = 64;

  // A usable tag, or '' when the value is not one: trimmed, cut to
  // the length cap. Only strings count — a number, an array, or an
  // object is not a tag (the cycle-13 strict-coercion lesson: a
  // coerced value would silently read as a real tag).
  function normalizeTag(tag) {
    try {
      if (typeof tag !== 'string') return '';
      var t = tag.trim();
      if (t === '') return '';
      if (t.length > MAX_TAG_LENGTH) t = t.slice(0, MAX_TAG_LENGTH);
      return t;
    } catch (e) {
      return '';
    }
  }

  // True when two tags are the same label, ignoring case and the
  // surrounding space — "Goblin" and "goblin" are one tag. A blank
  // tag never equals anything, not even another blank.
  function tagEquals(a, b) {
    try {
      var na = normalizeTag(a);
      var nb = normalizeTag(b);
      if (na === '' || nb === '') return false;
      return na.toLowerCase() === nb.toLowerCase();
    } catch (e) {
      return false;
    }
  }

  // A tag list cleaned up: non-arrays read as no tags, blanks and
  // non-strings drop out, duplicates collapse case-insensitively
  // (the first spelling wins), and the list caps at 16. Never
  // throws, never mutates the input.
  function normalizeTags(tags) {
    try {
      if (!Array.isArray(tags)) return [];
      var out = [];
      for (var i = 0; i < tags.length; i++) {
        var t = normalizeTag(tags[i]);
        if (t === '') continue;
        var dup = false;
        for (var j = 0; j < out.length; j++) {
          if (out[j].toLowerCase() === t.toLowerCase()) { dup = true; break; }
        }
        if (!dup) out.push(t);
        if (out.length >= MAX_TAGS_PER_OBJECT) break;
      }
      return out;
    } catch (e) {
      return [];
    }
  }

  // Repair an object's tags in place (the normalizer's defensive
  // call, like normalizeParallax): a missing or damaged tags field
  // becomes a clean list, so old projects and hand-edited JSON keep
  // working. Returns the object, or the input unchanged when it is
  // not an object. Never throws.
  function normalizeTagsOn(obj) {
    try {
      if (!obj || typeof obj !== 'object') return obj;
      obj.tags = normalizeTags(obj.tags);
      return obj;
    } catch (e) {
      return obj;
    }
  }

  // The object's tags as a fresh list (a copy, so the caller can
  // never mutate the live record through it). A missing object or a
  // missing tags field reads as no tags. Never throws.
  function tagsOf(obj) {
    try {
      if (!obj || typeof obj !== 'object') return [];
      return normalizeTags(obj.tags);
    } catch (e) {
      return [];
    }
  }

  // True while the object carries the tag (case-insensitive). A
  // missing object or a blank tag reads as false. Never throws.
  function hasTag(obj, tag) {
    try {
      if (!obj || typeof obj !== 'object') return false;
      var t = normalizeTag(tag);
      if (t === '') return false;
      var list = normalizeTags(obj.tags);
      for (var i = 0; i < list.length; i++) {
        if (list[i].toLowerCase() === t.toLowerCase()) return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  // Stick a tag on the object. Returns true when it was added,
  // false when the tag is blank, already there (any case), the
  // object already holds 16, or the object is not an object — the
  // caller warns on the blank cases and stays quiet on the rest.
  // Never throws.
  function addTag(obj, tag) {
    try {
      if (!obj || typeof obj !== 'object') return false;
      var t = normalizeTag(tag);
      if (t === '') return false;
      normalizeTagsOn(obj);
      if (hasTag(obj, t)) return false;
      if (obj.tags.length >= MAX_TAGS_PER_OBJECT) return false;
      obj.tags.push(t);
      return true;
    } catch (e) {
      return false;
    }
  }

  // Take a tag off the object (any case). Returns true when one was
  // removed, false when the tag was not there, the tag is blank, or
  // the object is not an object. Never throws.
  function removeTag(obj, tag) {
    try {
      if (!obj || typeof obj !== 'object') return false;
      var t = normalizeTag(tag);
      if (t === '') return false;
      normalizeTagsOn(obj);
      var removed = false;
      var kept = [];
      for (var i = 0; i < obj.tags.length; i++) {
        if (obj.tags[i].toLowerCase() === t.toLowerCase()) removed = true;
        else kept.push(obj.tags[i]);
      }
      if (removed) obj.tags = kept;
      return removed;
    } catch (e) {
      return false;
    }
  }

  // Take every tag off the object. Returns true when the object is
  // an object, false otherwise. Never throws.
  function clearTags(obj) {
    try {
      if (!obj || typeof obj !== 'object') return false;
      obj.tags = [];
      return true;
    } catch (e) {
      return false;
    }
  }

  // Every live object in the list carrying the tag (case-
  // insensitive), in list order. A blank tag or a non-array reads
  // as none — a blank tag names no group. Never throws.
  function objectsWithTag(objects, tag) {
    try {
      var t = normalizeTag(tag);
      if (t === '') return [];
      if (!Array.isArray(objects)) return [];
      var out = [];
      for (var i = 0; i < objects.length; i++) {
        if (hasTag(objects[i], t)) out.push(objects[i]);
      }
      return out;
    } catch (e) {
      return [];
    }
  }

  // How many live objects carry the tag — the count Tagged Count
  // and Read Tagged Count report. Never throws.
  function countTagged(objects, tag) {
    try {
      return objectsWithTag(objects, tag).length;
    } catch (e) {
      return 0;
    }
  }

  // --- Routing -------------------------------------------------------------

  function isTagAction(type) {
    return type === 'addTag' || type === 'removeTag' ||
      type === 'clearTags' || type === 'readTaggedCount';
  }

  function isTagCondition(type) {
    return type === 'hasTag' || type === 'taggedCount';
  }

  return {
    MAX_TAGS_PER_OBJECT: MAX_TAGS_PER_OBJECT,
    MAX_TAG_LENGTH: MAX_TAG_LENGTH,
    normalizeTag: normalizeTag,
    tagEquals: tagEquals,
    normalizeTags: normalizeTags,
    normalizeTagsOn: normalizeTagsOn,
    tagsOf: tagsOf,
    hasTag: hasTag,
    addTag: addTag,
    removeTag: removeTag,
    clearTags: clearTags,
    objectsWithTag: objectsWithTag,
    countTagged: countTagged,
    isTagAction: isTagAction,
    isTagCondition: isTagCondition
  };
}

if (typeof window !== 'undefined') {
  window.HydraTags = hydraTagsFactory();
  // Self-contained source of the factory, inlined into exported playable games
  // by HydraPlayer.buildPlayableHtml so exports run without editor files.
  window.HydraTags.factorySource = hydraTagsFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraTagsFactory;
