/* ============================================================================
 * hydra-events.js — HydraScript shared custom-event state machine (P5
 * core-engine track, item P5-4: Control flow + events, slice c —
 * Broadcast Event / On Event).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation
 * of custom events — used by:
 *   - the editor preview runtime (hydra-previewruntime.js delegates
 *     to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * Idea (the event dispatcher of real engines, beginner edition): any
 * chain can send a named event with Broadcast Event, and any On Event
 * condition with the same name hears it. The two blocks are the only
 * new pieces — the broadcast is an ordinary action, the listener an
 * ordinary condition, and the chain after the listener is an ordinary
 * chain the user could have written by hand. A coin that scores, a
 * boss that dies, a door that opens: the block that knows says so by
 * name, and every chain that cares listens for that name, instead of
 * every chain polling a variable or reaching across the grid.
 *
 * How it works: the run owns one event state ({ counts, seen }).
 * Broadcast Event bumps the count for its name by one. On Event
 * polls the count against what its own cell has already seen — the
 * seen map is keyed by "scopeKey:cell", so every listener cell keeps
 * its own place — and fires exactly once per broadcast: the first
 * evaluation after the count rises returns true and records the new
 * count, later evaluations read the same count and stay quiet. A
 * broadcast the listener has not been evaluated for yet fires the
 * moment it is evaluated, so a broadcast and a listener in the same
 * frame fire in that frame when the listener sits after the
 * broadcaster in the grid walk, and on the next frame when it sits
 * before it — either way exactly once per broadcast. Several
 * broadcasts of the same name in one frame still fire the listener
 * once that frame (the count rises by more than one, and one poll
 * swallows the whole rise); a broadcast every frame fires the
 * listener every frame, because the count rises every frame.
 *
 * The state is host-owned run state, minted fresh on a fresh run.
 * It survives scene switches inside a run, like the loop state, so
 * a broadcast in one scene reaches a listener in the next scene on
 * the next frame. Nothing here ever throws; hostile input degrades
 * to safe defaults (a blank name never broadcasts, a missing state
 * never fires).
 *
 * Honest limits: an event carries no value with it — a listener
 * knows THAT something happened, not how much or where; pass a
 * number or a name through a variable next to the broadcast (the
 * usual pattern: set the variable, then broadcast). An event name
 * is plain text, not an expression, so it cannot be built from a
 * variable at run time. A listener that never hears its event
 * stays quiet forever, with no warning — a misspelled name looks
 * exactly like an event that never happens, so spell the name the
 * same on both blocks.
 *
 * Load order (index.html): hydra-events.js BEFORE player-runtime.js
 * and script.js. player-runtime.js throws a clear error if
 * HydraEvents is missing.
 * ========================================================================== */

function hydraEventsFactory() {
  'use strict';

  // --- Classification -------------------------------------------------------

  // Broadcast Event is an action; On Event is a condition. The hosts'
  // classifiers compose these, the way they compose the variables /
  // functions / loops classifiers.
  function isEventAction(type) {
    return type === 'broadcastEvent';
  }

  function isEventCondition(type) {
    return type === 'onCustomEvent';
  }

  // --- Names ----------------------------------------------------------------
  // An event name, normalized: a trimmed string, or '' for anything
  // that is not a usable name (blank, non-string). A blank name never
  // broadcasts and never fires — the callers warn on broadcast and
  // stay quiet on listen.

  function normalizeEventName(name) {
    return (typeof name === 'string') ? name.trim() : '';
  }

  // --- Event state ----------------------------------------------------------
  // Host-owned run state: { counts, seen }. counts maps an event name
  // to how many times it has been broadcast this run; seen maps a
  // listener cell ("scopeKey:cell") to the count it last observed, so
  // each listener fires once per broadcast no matter how many other
  // listeners share the name.

  function createEventState() {
    return { counts: {}, seen: {} };
  }

  function stateOf(state) {
    return (state && typeof state === 'object' &&
      state.counts && typeof state.counts === 'object' &&
      state.seen && typeof state.seen === 'object') ? state : null;
  }

  // Broadcast the named event: bump its count by one. Returns
  // { ok: true, name, count } — or { ok: false, reason } for a blank
  // name ('blank') or an unusable state ('bad-state'), so the caller
  // can warn about the name and stay quiet about the state.
  function broadcast(state, name) {
    var n = normalizeEventName(name);
    if (!n) return { ok: false, reason: 'blank' };
    var s = stateOf(state);
    if (!s) return { ok: false, reason: 'bad-state' };
    var count = (typeof s.counts[n] === 'number' ? s.counts[n] : 0) + 1;
    s.counts[n] = count;
    return { ok: true, name: n, count: count };
  }

  // How many times the named event has been broadcast this run (0
  // for a name never broadcast, a blank name, or an unusable state).
  function eventCount(state, name) {
    var n = normalizeEventName(name);
    if (!n) return 0;
    var s = stateOf(state);
    if (!s) return 0;
    var c = s.counts[n];
    return (typeof c === 'number' && isFinite(c)) ? c : 0;
  }

  // One listener's poll: true exactly when the named event has been
  // broadcast since this listener cell last looked. The cell's key is
  // "scopeKey:cell" (the same key the dispatch uses for edge memory),
  // so two listeners for one event each fire on their own. The poll
  // records the count it saw, so a second poll in the same frame —
  // or on any later frame with no new broadcast — stays quiet. A
  // blank name, an unusable state, or a missing seen map never
  // fires: without a place to record what was seen, firing would
  // repeat forever.
  function pollEvent(state, name, key) {
    var n = normalizeEventName(name);
    if (!n) return false;
    var s = stateOf(state);
    if (!s) return false;
    var k = (typeof key === 'string') ? key : String(key == null ? '' : key);
    if (!k) return false;
    var count = eventCount(s, n);
    var last = s.seen[k];
    if (typeof last !== 'number' || !isFinite(last)) last = 0;
    if (count <= last) return false;
    s.seen[k] = count;
    return true;
  }

  return {
    isEventAction: isEventAction,
    isEventCondition: isEventCondition,
    normalizeEventName: normalizeEventName,
    createEventState: createEventState,
    broadcast: broadcast,
    eventCount: eventCount,
    pollEvent: pollEvent
  };
}

if (typeof window !== 'undefined') {
  window.HydraEvents = hydraEventsFactory();
  // Self-contained source of the factory, inlined into exported playable games
  // by HydraPlayer.buildPlayableHtml so exports run without editor files.
  window.HydraEvents.factorySource = hydraEventsFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraEventsFactory;
