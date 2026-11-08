/* ============================================================================
 * hydra-trace.js — HydraScript shared flow tracer (P4 item 36, phase C).
 *
 * Pure logic, no DOM access. This is the SINGLE canonical implementation of
 * the flow tracer used by:
 *   - the editor preview runtime (script.js delegates to it), and
 *   - exported standalone games (buildPlayableHtml inlines factorySource
 *     into the exported page, so exports never depend on editor files).
 *
 * What it does: while tracing is ON, every flow event is recorded in a
 * capped ring buffer — a condition triggering, and every action /
 * condition-pass / condition-stop the HydraFlow.propagate() walk visits
 * (the onVisit hook). The editor shows the recent events in the Trace
 * panel and highlights grid cells that fired recently; an exported game
 * with ?hydraTrace=1 in the URL enables tracing and exposes the buffer
 * as window.__hydraTrace for inspection in devtools.
 *
 * A trace event is a plain record:
 *   { frame, scope, index, kind, type }
 *   - frame: the host's per-run frame counter (the host owns the clock,
 *     so the module stays DOM-free and deterministic in tests).
 *   - scope: the host's scope key, e.g. 'global' or a scene id.
 *   - index: the grid cell index of the block.
 *   - kind: 'trigger' | 'action' | 'condition-pass' | 'condition-stop'.
 *   - type: the block type string, e.g. 'always' or 'setVariable'.
 *
 * Tracing is session state, never saved into project JSON: it is off by
 * default, it resets on every preview run / exported-game start, and it
 * survives scene switches within a run (a debug tool is not game state).
 * Recording is cheap and capped (default 200 events, oldest dropped
 * first), and nothing here ever throws; hostile input degrades to a
 * quiet no-op instead of breaking the frame.
 *
 * Load order (index.html): hydra-trace.js BEFORE player-runtime.js and
 * script.js. player-runtime.js throws a clear error if HydraTrace is
 * missing.
 * ========================================================================== */
function hydraTraceFactory() {
  'use strict';

  var DEFAULT_CAP = 200;

  // Fresh tracer record. The runtime owns one per run
  // (preview: previewState.trace; export: state.trace).
  function createTracer(cap) {
    var c = Math.floor(Number(cap));
    if (!isFinite(c) || c < 1) c = DEFAULT_CAP;
    return { enabled: false, cap: c, events: [], lastFired: {} };
  }

  function isEnabled(tracer) {
    return !!(tracer && tracer.enabled);
  }

  // Enable tracing. Clears any stale events so the feed starts fresh.
  // Idempotent; returns the new state (true).
  function enable(tracer) {
    if (!tracer) return false;
    tracer.enabled = true;
    clear(tracer);
    return true;
  }

  // Disable tracing. Keeps the recorded events so the last trace stays
  // readable after the run is stopped. Idempotent; returns false.
  function disable(tracer) {
    if (!tracer) return false;
    tracer.enabled = false;
    return false;
  }

  // Flip tracing. Enabling clears (see enable); returns the new state.
  function toggle(tracer) {
    if (!tracer) return false;
    return tracer.enabled ? disable(tracer) : enable(tracer);
  }

  function scopeKeyOf(ev) {
    var s = ev && ev.scope != null ? String(ev.scope) : '';
    var i = ev && ev.index != null ? Number(ev.index) : NaN;
    if (!s || !isFinite(i)) return null;
    return s + ':' + Math.floor(i);
  }

  // Record one flow event. A no-op when tracing is off, when the tracer
  // is missing, or when the event carries no usable scope/index — a
  // debug tool must never break the frame it is watching. Events past
  // the cap drop the oldest first, so the buffer always holds the most
  // recent flow.
  function record(tracer, ev) {
    if (!tracer || !tracer.enabled || !ev) return false;
    var key = scopeKeyOf(ev);
    if (!key) return false;
    var frame = Math.floor(Number(ev.frame));
    if (!isFinite(frame) || frame < 0) frame = 0;
    var kind = ev.kind;
    if (kind !== 'trigger' && kind !== 'action' &&
        kind !== 'condition-pass' && kind !== 'condition-stop') return false;
    var entry = {
      frame: frame,
      scope: String(ev.scope),
      index: Math.floor(Number(ev.index)),
      kind: kind,
      type: typeof ev.type === 'string' ? ev.type : ''
    };
    if (!Array.isArray(tracer.events)) tracer.events = [];
    tracer.events.push(entry);
    var cap = Math.floor(Number(tracer.cap));
    if (!isFinite(cap) || cap < 1) cap = DEFAULT_CAP;
    while (tracer.events.length > cap) tracer.events.shift();
    if (!tracer.lastFired || typeof tracer.lastFired !== 'object') tracer.lastFired = {};
    tracer.lastFired[key] = frame;
    return true;
  }

  // The most recent n events, oldest first (a copy — callers cannot
  // mutate the ring). n <= 0 or missing means all of them.
  function recent(tracer, n) {
    if (!tracer || !Array.isArray(tracer.events)) return [];
    var count = Math.floor(Number(n));
    if (!isFinite(count) || count < 1) return tracer.events.slice();
    return tracer.events.slice(-count);
  }

  // Drop every recorded event and every last-fired mark. Keeps the
  // enabled flag and the cap: clearing the feed mid-run stays on.
  function clear(tracer) {
    if (!tracer) return;
    tracer.events = [];
    tracer.lastFired = {};
  }

  // The frame a block last fired on, or null when it never fired (or
  // the tracer is missing). Scope + index identify the block.
  function lastFiredFrame(tracer, scope, index) {
    if (!tracer || !tracer.lastFired) return null;
    var key = scopeKeyOf({ scope: scope, index: index });
    if (!key) return null;
    var f = tracer.lastFired[key];
    return isFinite(Number(f)) ? Math.floor(Number(f)) : null;
  }

  // True when the block fired within the last `within` frames
  // (inclusive of the current frame). Used to highlight grid cells
  // that just ran. Never throws; bad input reads as "not recent".
  function firedRecently(tracer, scope, index, frame, within) {
    var last = lastFiredFrame(tracer, scope, index);
    if (last === null) return false;
    var cur = Math.floor(Number(frame));
    var w = Math.floor(Number(within));
    if (!isFinite(cur) || !isFinite(w) || w < 0) return false;
    return cur - last >= 0 && cur - last <= w;
  }

  // One plain-language line for the Trace panel, e.g.
  // "frame 12 · global cell 0 · trigger always". Safe for any input.
  function formatEvent(ev) {
    if (!ev || typeof ev !== 'object') return '';
    var frame = Math.floor(Number(ev.frame));
    if (!isFinite(frame) || frame < 0) frame = 0;
    var scope = ev.scope != null ? String(ev.scope) : '';
    var idx = Math.floor(Number(ev.index));
    if (!isFinite(idx)) idx = 0;
    var kind = typeof ev.kind === 'string' ? ev.kind : '';
    var type = typeof ev.type === 'string' && ev.type ? ev.type : 'block';
    return 'frame ' + frame + ' · ' + scope + ' cell ' + idx + ' · ' + kind + ' ' + type;
  }

  return {
    createTracer: createTracer,
    isEnabled: isEnabled,
    enable: enable,
    disable: disable,
    toggle: toggle,
    record: record,
    recent: recent,
    clear: clear,
    lastFiredFrame: lastFiredFrame,
    firedRecently: firedRecently,
    formatEvent: formatEvent
  };
}

if (typeof window !== 'undefined') {
  window.HydraTrace = hydraTraceFactory();
  // Self-contained source of the factory, inlined into exported playable games
  // by buildPlayableHtml (player-runtime.js). Kept as a string, never eval'd here.
  window.HydraTrace.factorySource = hydraTraceFactory.toString();
}
if (typeof module !== 'undefined' && module.exports) module.exports = hydraTraceFactory;
