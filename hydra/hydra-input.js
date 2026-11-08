/* ============================================================================
 * hydra-input.js — HydraScript shared input helpers.
 *
 * Pure logic, no DOM access. Single canonical source for input mappings
 * used by the editor preview runtime (script.js) and the exported player
 * runtime (player-runtime.js). Exported games inline factorySource via
 * HydraPlayer.buildPlayableHtml, so exports never depend on editor files.
 *
 * Load order (index.html): hydra-input.js BEFORE player-runtime.js and
 * script.js. player-runtime.js throws a clear error if HydraInput is missing.
 * ========================================================================== */

function hydraInputFactory() {
  'use strict';

  // Canonical mouse button name -> DOM button code mapping.
  // 'left' -> 0, 'middle' -> 1, 'right' -> 2. Anything else (including
  // undefined) falls back to 0 (left) to match historical behavior.
  function mouseButtonCode(button) {
    if (button === 'right') return 2;
    if (button === 'middle') return 1;
    return 0;
  }

  // Normalize a configured key name ("Spacebar", "Left", ...) to the
  // canonical form used for matching.
  function normalizeKeyName(key) {
    const value = String(key ?? '').trim().replace(/^["']|["']$/g, '');
    const map = {
      Left: 'ArrowLeft',
      Right: 'ArrowRight',
      Up: 'ArrowUp',
      Down: 'ArrowDown',
      Return: 'Enter',
      Esc: 'Escape',
      Spacebar: 'Space'
    };
    return map[value] || value;
  }

  // All the key identifiers that should count as "this key is down":
  // the normalized name plus case variants, Key<code> form, and common
  // aliases (Space <-> ' ', ArrowLeft <-> 'Left').
  function keyNameAliases(key) {
    const normalized = normalizeKeyName(key);
    const aliases = new Set([normalized]);
    if (normalized.length === 1) {
      aliases.add(normalized.toLowerCase());
      aliases.add(normalized.toUpperCase());
      aliases.add(`Key${normalized.toUpperCase()}`);
    }
    if (normalized === 'Space') aliases.add(' ');
    if (normalized.startsWith('Arrow')) aliases.add(normalized.replace('Arrow', ''));
    return [...aliases].filter(Boolean);
  }

  // True when any alias of `key` is present in the key set.
  function keySetHas(keySet, key) {
    return keyNameAliases(key).some(alias => keySet.has(alias));
  }

  return {
    mouseButtonCode: mouseButtonCode,
    normalizeKeyName: normalizeKeyName,
    keyNameAliases: keyNameAliases,
    keySetHas: keySetHas
  };
}

window.HydraInput = hydraInputFactory();
// Self-contained source of the factory, inlined into exported playable games
// by HydraPlayer.buildPlayableHtml so exports run without editor files.
window.HydraInput.factorySource = hydraInputFactory.toString();
