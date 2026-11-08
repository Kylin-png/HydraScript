// TEMPORARY editor UI sounds (Nov 7 2026).
// Ky'lin asked for the sounds in the editor now, temporary. This file is a
// thin overlay that watches the editor from the outside: it never edits
// script.js or any engine module, so it cannot collide with a running
// cycle. The loop's proper wiring (real mute toggle, per-moment hooks at
// the call sites) should REPLACE this file: delete ui-sounds-temp.js, the
// sounds-temp/ folder, and the script tag in index.html when it lands.
//
// Sounds (Ky'lin's picks, Nov 7): click = his pickupCoin.wav, place = his
// hitHurt.wav, snap/delete/select/pickup/error = v3 physical-modeling
// synth. All 16-bit mono 44.1kHz, peak 0.85. Source copies live in
// ~/workspace/hydrascript/sound-lab/wav/.
(function () {
  'use strict';
  if (window.HydraTempSounds) return; // load once
  var muted = false;
  var sounds = {};
  var NAMES = ['click', 'place', 'snap', 'delete', 'select', 'pickup', 'error'];
  NAMES.forEach(function (name) {
    try {
      var a = new Audio('sounds-temp/' + name + '.wav');
      a.preload = 'auto';
      a.volume = 0.8;
      sounds[name] = a;
    } catch (e) { /* a missing file stays silent, never breaks the editor */ }
  });
  var lastPlayed = {};
  function play(name) {
    if (muted) return;
    var now = Date.now();
    if (lastPlayed[name] && now - lastPlayed[name] < 120) return; // one dedupe window per sound
    lastPlayed[name] = now;
    var a = sounds[name];
    if (!a) return;
    try {
      var c = a.cloneNode();
      c.volume = a.volume;
      var p = c.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) { /* audio must never break the editor */ }
  }

  // --- grid: placement and deletion, by watching the block count -------
  function blockCells() {
    var grid = document.getElementById('grid');
    if (!grid) return [];
    return Array.prototype.slice.call(grid.querySelectorAll('[data-block-type]'));
  }
  var lastCount = -1;
  var gridObserved = null;
  function hasNeighbor(cell, others) {
    try {
      var r = cell.getBoundingClientRect();
      if (!r.width) return false;
      var cx = r.left + r.width / 2;
      var cy = r.top + r.height / 2;
      for (var i = 0; i < others.length; i++) {
        var o = others[i].getBoundingClientRect();
        var dx = Math.abs((o.left + o.width / 2) - cx);
        var dy = Math.abs((o.top + o.height / 2) - cy);
        if (dx < r.width * 1.5 && dy < r.height * 1.5 && (dx > 1 || dy > 1)) return true;
      }
    } catch (e) {}
    return false;
  }
  function ensureGridWatch() {
    var grid = document.getElementById('grid');
    if (!grid || gridObserved === grid) return;
    gridObserved = grid;
    lastCount = blockCells().length;
    try {
      var mo = new MutationObserver(function () {
        var cells = blockCells();
        var n = cells.length;
        if (n === lastCount) return;
        if (n > lastCount) {
          play('place');
          var fresh = cells[cells.length - 1];
          var rest = cells.slice(0, -1);
          setTimeout(function () { if (hasNeighbor(fresh, rest)) play('snap'); }, 80);
        } else {
          play('delete');
        }
        lastCount = n;
      });
      mo.observe(grid, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-block-type'] });
    } catch (e) {}
  }

  // --- clicks: tabs/buttons are clicks; grid cells are select/place ----
  document.addEventListener('click', function (e) {
    try {
      var t = e.target;
      if (!t || !t.closest) return;
      ensureGridWatch();
      if (t.closest('canvas')) return; // game input, not UI
      if (t.closest('#grid')) {
        var cell = t.closest('#grid > *');
        if (cell && cell.hasAttribute && cell.hasAttribute('data-block-type')) play('select');
        return; // empty cell: the grid watcher plays place
      }
      if (t.closest('button, .tab, [role="button"], select, input, a')) play('click');
    } catch (err) {}
  }, true);

  // --- pickup: a drag starting on a placed block -----------------------
  var dragArmed = null;
  document.addEventListener('mousedown', function (e) {
    try {
      var cell = e.target && e.target.closest && e.target.closest('#grid > [data-block-type]');
      if (cell) dragArmed = cell;
    } catch (err) {}
  }, true);
  document.addEventListener('mousemove', function (e) {
    if (dragArmed && (e.buttons & 1)) { play('pickup'); dragArmed = null; }
  }, true);
  document.addEventListener('mouseup', function () { dragArmed = null; }, true);

  // --- error: a new diagnostic appears ---------------------------------
  var lastDiagCount = -1;
  function ensureDiagWatch() {
    var feed = document.getElementById('diagnostic-feed');
    var countEl = document.getElementById('diagnostic-count');
    if (countEl) {
      var n = parseInt(countEl.textContent || '0', 10);
      if (!isNaN(n)) {
        if (lastDiagCount >= 0 && n > lastDiagCount) play('error');
        lastDiagCount = n;
      }
    }
    if (feed && !feed.__tempSoundsObserved) {
      feed.__tempSoundsObserved = true;
      try {
        var mo = new MutationObserver(function (muts) {
          for (var i = 0; i < muts.length; i++) {
            var added = muts[i].addedNodes;
            for (var j = 0; j < added.length; j++) {
              var node = added[j];
              if (node.nodeType === 1 && !(node.classList && node.classList.contains('diagnostic-empty'))) {
                play('error');
                return;
              }
            }
          }
        });
        mo.observe(feed, { childList: true });
      } catch (e) {}
    }
  }

  // --- mute toggle in the status bar -----------------------------------
  // The global button rule is width:100% + purple, so the toggle needs
  // the same reset the diagnostics button uses (see style.css) or it
  // stretches across the whole bar.
  function ensureMuteButton() {
    var bar = document.getElementById('status-bar');
    if (!bar || document.getElementById('temp-sounds-toggle')) return;
    try {
      if (!document.getElementById('temp-sounds-style')) {
        var st = document.createElement('style');
        st.id = 'temp-sounds-style';
        st.textContent = '#temp-sounds-toggle { background: none; border: 0; cursor: pointer; font: inherit; color: inherit; padding: 3px 6px; border-radius: 6px; width: auto; margin: 0; flex: 0 0 auto; box-shadow: none; } #temp-sounds-toggle:hover { background: #1e293b; color: #e2e8f0; transform: none; box-shadow: none; }';
        document.head.appendChild(st);
      }
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'status-item';
      b.id = 'temp-sounds-toggle';
      b.title = 'Mute editor sounds (temporary wiring)';
      b.innerHTML = '<i class="fas fa-volume-up" aria-hidden="true"></i> <strong id="temp-sounds-state">on</strong> <span class="status-label">sounds</span>';
      b.addEventListener('click', function () {
        muted = !muted;
        var s = document.getElementById('temp-sounds-state');
        if (s) s.textContent = muted ? 'off' : 'on';
        if (!muted) play('click');
      });
      bar.appendChild(b);
    } catch (e) {}
  }

  function init() {
    ensureGridWatch();
    ensureDiagWatch();
    ensureMuteButton();
    setInterval(function () { ensureGridWatch(); ensureDiagWatch(); ensureMuteButton(); }, 2000);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  window.HydraTempSounds = {
    play: play,
    get muted() { return muted; },
    set muted(v) { muted = !!v; },
    version: 'temp-20261107'
  };
})();
