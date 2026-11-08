// ============================================================
// HydraScript v4 — Block Catalog
// Declarative definitions for all visual scripting blocks
// ============================================================

(function (global) {
  'use strict';

  const EXPR = 'expr';
  const OBJ = 'object';

  const BLOCKS = [
    // ---- Organization ----
    {
      category: 'Organization', blockType: 'comment-block', runtimeType: 'comment', kind: 'meta',
      label: 'Comment', color: '#64748b', cellLabel: 'Note',
      defaults: { type: 'comment', text: 'Comment' },
      fields: [{ key: 'text', label: 'Comment', control: 'textarea', placeholder: 'What this event does...' }],
      note: 'Editor-only note. Never runs in preview.',
    },

    // ---- Logic: Conditions ----
    {
      category: 'Conditions', blockType: 'always-condition', runtimeType: 'always', kind: 'condition',
      label: 'Every Frame', color: '#0d9488', cellLabel: 'Always',
      defaults: { type: 'always' },
      note: 'Always true while preview is running.',
    },
    {
      category: 'Conditions', blockType: 'game-start', runtimeType: 'gameStart', kind: 'condition',
      label: 'On Game Start', color: '#10b981', cellLabel: 'Start',
      defaults: { type: 'gameStart' },
      note: 'Fires once when the game starts.',
    },
    {
      category: 'Conditions', blockType: 'key-down', runtimeType: 'keyDown', kind: 'condition',
      label: 'Key Held', color: '#3b82f6', cellLabel: 'Key↓',
      defaults: { type: 'keyDown', key: 'ArrowRight' },
      fields: [{ key: 'key', label: 'Key', control: 'text', placeholder: 'ArrowRight, KeyA, Space...' }],
      note: 'True while the specified key is held down.',
    },
    {
      category: 'Conditions', blockType: 'key-pressed', runtimeType: 'keyPressed', kind: 'condition',
      label: 'Key Just Pressed', color: '#2563eb', cellLabel: 'Key▶',
      defaults: { type: 'keyPressed', key: 'Space' },
      fields: [{ key: 'key', label: 'Key', control: 'text', placeholder: 'Space, Enter, KeyW...' }],
      note: 'True only on the frame the key is first pressed.',
    },
    {
      category: 'Conditions', blockType: 'key-released', runtimeType: 'keyReleased', kind: 'condition',
      label: 'Key Just Released', color: '#1d4ed8', cellLabel: 'Key↑',
      defaults: { type: 'keyReleased', key: 'Space' },
      fields: [{ key: 'key', label: 'Key', control: 'text', placeholder: 'Space, Enter...' }],
      note: 'True only on the frame the key is released.',
    },
    {
      category: 'Conditions', blockType: 'mouse-down', runtimeType: 'mouseDown', kind: 'condition',
      label: 'Mouse Held', color: '#8b5cf6', cellLabel: 'Mouse↓',
      defaults: { type: 'mouseDown', button: 'left' },
      fields: [{ key: 'button', label: 'Button', control: 'select', options: [['left', 'Left'], ['right', 'Right'], ['middle', 'Middle']] }],
      note: 'True while the mouse button is held.',
    },
    {
      category: 'Conditions', blockType: 'mouse-pressed', runtimeType: 'mousePressed', kind: 'condition',
      label: 'Mouse Just Clicked', color: '#7c3aed', cellLabel: 'Click▶',
      defaults: { type: 'mousePressed', button: 'left' },
      fields: [{ key: 'button', label: 'Button', control: 'select', options: [['left', 'Left'], ['right', 'Right'], ['middle', 'Middle']] }],
      note: 'True only on the frame the mouse button is first pressed.',
    },
    {
      category: 'Conditions', blockType: 'overlap-condition', runtimeType: 'overlap', kind: 'condition',
      label: 'Objects Overlap', color: '#f59e0b', cellLabel: 'Overlap?',
      defaults: { type: 'overlap', object1: '', object2: '', reversed: false },
      fields: [
        { key: 'object1', label: 'Object A', control: OBJ },
        { key: 'object2', label: 'Object B', control: OBJ },
        { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] },
      ],
      note: 'True when the hitboxes of two named objects overlap.',
    },
    {
      category: 'Conditions', blockType: 'timer-condition', runtimeType: 'timer', kind: 'condition',
      label: 'On Timer', color: '#0f766e', cellLabel: 'Timer⏱',
      defaults: { type: 'timer', timerName: 'spawnTimer', interval: 60, reset: true },
      fields: [
        { key: 'timerName', label: 'Timer name', control: 'text', placeholder: 'spawnTimer' },
        { key: 'interval', label: 'Frames (60 = 1s)', control: EXPR, placeholder: '60' },
        { key: 'reset', label: 'Auto-reset', control: 'select', options: [[true, 'Yes (repeating)'], [false, 'No (one-shot)']] },
      ],
      note: 'Fires when the named timer reaches its interval.',
    },
    {
      category: 'Conditions', blockType: 'trigger-once-condition', runtimeType: 'triggerOnce', kind: 'condition',
      label: 'Trigger Once', color: '#10b981', cellLabel: 'Once',
      defaults: { type: 'triggerOnce', reversed: false },
      fields: [{ key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }],
      note: 'Fires once per preview. Put it next to another condition to gate it.',
    },
    {
      category: 'Conditions', blockType: 'edge-condition', runtimeType: 'edge', kind: 'condition',
      label: 'Edge Detect', color: '#0891b2', cellLabel: 'Edge',
      defaults: { type: 'edge', targetObject: '', property: 'posY', operator: '>=', value: 500 },
      fields: [
        { key: 'targetObject', label: 'Object', control: OBJ },
        { key: 'property', label: 'Property', control: 'select', options: [['posX', 'X'], ['posY', 'Y'], ['velX', 'Vel X'], ['velY', 'Vel Y']] },
        { key: 'operator', label: 'Crosses', control: 'select', options: [['>=', 'up past'], ['<=', 'down past']] },
        { key: 'value', label: 'Value', control: EXPR, placeholder: '500' },
      ],
      note: 'True on the frame a property crosses a threshold.',
    },
    {
      category: 'Conditions', blockType: 'distance-condition', runtimeType: 'distanceCheck', kind: 'condition',
      label: 'Distance Check', color: '#0891b2', cellLabel: 'Dist?',
      defaults: { type: 'distanceCheck', object1: '', object2: '', operator: '<=', distance: 120, reversed: false },
      fields: [
        { key: 'object1', label: 'Object A', control: OBJ },
        { key: 'object2', label: 'Object B', control: OBJ },
        { key: 'operator', label: 'Compare', control: 'select', options: [['<=', 'Within'], ['>', 'Farther than'], ['>=', 'At least'], ['<', 'Less than']] },
        { key: 'distance', label: 'Distance', control: EXPR, placeholder: '120 or aggroRange' },
        { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] },
      ],
      note: 'Compares center-to-center distance between two objects.',
    },
    {
      category: 'Conditions', blockType: 'position-condition', runtimeType: 'positionCheck', kind: 'condition',
      label: 'Position Check', color: '#0f766e', cellLabel: 'Pos?',
      defaults: { type: 'positionCheck', targetObject: '', property: 'posY', operator: '>=', value: 500, reversed: false },
      fields: [
        { key: 'targetObject', label: 'Object', control: OBJ },
        { key: 'property', label: 'Property', control: 'select', options: [['posX', 'X pos'], ['posY', 'Y pos'], ['velX', 'Vel X'], ['velY', 'Vel Y'], ['width', 'Width'], ['height', 'Height'], ['rotation', 'Rotation']] },
        { key: 'operator', label: 'Op', control: 'select', options: [['>=', '≥'], ['<=', '≤'], ['==', '='], ['!=', '≠'], ['>', '>'], ['<', '<']] },
        { key: 'value', label: 'Value', control: EXPR, placeholder: '500 or groundY' },
        { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] },
      ],
    },

    // ---- Logic: Actions — Movement ----
    {
      category: 'Movement', blockType: 'set-position', runtimeType: 'setPosition', kind: 'action',
      label: 'Set Position', color: '#3b82f6', cellLabel: 'Pos=',
      defaults: { type: 'setPosition', targetObject: '', x: '', y: '', mode: 'set' },
      fields: [
        { key: 'targetObject', label: 'Object', control: OBJ },
        { key: 'x', label: 'X', control: EXPR, placeholder: 'e.g. 100 or player.posX' },
        { key: 'y', label: 'Y', control: EXPR, placeholder: 'e.g. 200 or player.posY' },
        { key: 'mode', label: 'Mode', control: 'select', options: [['set', 'Set'], ['add', 'Add (offset)']] },
      ],
      note: 'Sets or offsets the position of an object.',
    },
    {
      category: 'Movement', blockType: 'set-velocity', runtimeType: 'setVelocity', kind: 'action',
      label: 'Set Velocity', color: '#6366f1', cellLabel: 'Vel=',
      defaults: { type: 'setVelocity', targetObject: '', velX: '', velY: '', mode: 'set' },
      fields: [
        { key: 'targetObject', label: 'Object', control: OBJ },
        { key: 'velX', label: 'Vel X', control: EXPR, placeholder: 'e.g. 5 or -3' },
        { key: 'velY', label: 'Vel Y', control: EXPR, placeholder: 'e.g. -10 or jumpForce' },
        { key: 'mode', label: 'Mode', control: 'select', options: [['set', 'Set'], ['add', 'Add']] },
      ],
    },
    {
      category: 'Movement', blockType: 'move-toward', runtimeType: 'moveToward', kind: 'action',
      label: 'Move Toward', color: '#8b5cf6', cellLabel: '→',
      defaults: { type: 'moveToward', targetObject: '', targetX: '', targetY: '', speed: 5 },
      fields: [
        { key: 'targetObject', label: 'Object', control: OBJ },
        { key: 'targetX', label: 'Target X', control: EXPR, placeholder: 'e.g. 400' },
        { key: 'targetY', label: 'Target Y', control: EXPR, placeholder: 'e.g. 300' },
        { key: 'speed', label: 'Speed', control: EXPR, placeholder: '5' },
      ],
      note: 'Moves an object toward a target point at a constant speed.',
    },
    {
      category: 'Movement', blockType: 'force-toward', runtimeType: 'forceToward', kind: 'action',
      label: 'Apply Force Toward', color: '#a78bfa', cellLabel: 'Force→',
      defaults: { type: 'forceToward', targetObject: '', targetObjectName: '', force: 0.5 },
      fields: [
        { key: 'targetObject', label: 'Object', control: OBJ },
        { key: 'targetObjectName', label: 'Toward object', control: OBJ },
        { key: 'force', label: 'Force', control: EXPR, placeholder: '0.5' },
      ],
    },
    {
      category: 'Movement', blockType: 'rotate-object', runtimeType: 'rotateObject', kind: 'action',
      label: 'Rotate', color: '#6366f1', cellLabel: 'Rotate',
      defaults: { type: 'rotateObject', targetObject: '', angle: 5, mode: 'add' },
      fields: [
        { key: 'targetObject', label: 'Object', control: OBJ },
        { key: 'angle', label: 'Angle', control: EXPR, placeholder: '5 or spinSpeed' },
        { key: 'mode', label: 'Mode', control: 'select', options: [['add', 'Add'], ['set', 'Set']] },
      ],
    },
    {
      category: 'Movement', blockType: 'set-size', runtimeType: 'setSize', kind: 'action',
      label: 'Set Size', color: '#3b82f6', cellLabel: 'Size=',
      defaults: { type: 'setSize', targetObject: '', width: '', height: '', mode: 'set' },
      fields: [
        { key: 'targetObject', label: 'Object', control: OBJ },
        { key: 'width', label: 'Width', control: EXPR, placeholder: '64' },
        { key: 'height', label: 'Height', control: EXPR, placeholder: '64' },
        { key: 'mode', label: 'Mode', control: 'select', options: [['set', 'Set'], ['add', 'Add']] },
      ],
    },
    {
      category: 'Movement', blockType: 'apply-impulse', runtimeType: 'applyImpulse', kind: 'action',
      label: 'Apply Impulse', color: '#818cf8', cellLabel: 'Push',
      defaults: { type: 'applyImpulse', targetObject: '', impulseX: 0, impulseY: -10 },
      fields: [
        { key: 'targetObject', label: 'Object', control: OBJ },
        { key: 'impulseX', label: 'X Force', control: EXPR, placeholder: '0' },
        { key: 'impulseY', label: 'Y Force', control: EXPR, placeholder: '-10 (jump)' },
      ],
      note: 'Instantly adds velocity to a physics object.',
    },

    // ---- Logic: Actions — Variables ----
    {
      category: 'Variables', blockType: 'set-variable', runtimeType: 'setVariable', kind: 'action',
      label: 'Set Variable', color: '#f59e0b', cellLabel: 'Var=',
      defaults: { type: 'setVariable', name: 'score', value: '0', mode: 'set', scope: 'global' },
      fields: [
        { key: 'name', label: 'Variable name', control: 'text', placeholder: 'score' },
        { key: 'value', label: 'Value', control: EXPR, placeholder: '0 or score + 1' },
        { key: 'mode', label: 'Mode', control: 'select', options: [['set', 'Set'], ['add', 'Add'], ['sub', 'Subtract'], ['mul', 'Multiply'], ['div', 'Divide']] },
        { key: 'scope', label: 'Scope', control: 'select', options: [['global', 'Global'], ['local', 'Per-entity']] },
      ],
    },
    {
      category: 'Variables', blockType: 'get-variable', runtimeType: 'getVariable', kind: 'action',
      label: 'Read Variable', color: '#fbbf24', cellLabel: 'Var?',
      defaults: { type: 'getVariable', name: 'score', scope: 'global' },
      fields: [
        { key: 'name', label: 'Variable name', control: 'text', placeholder: 'score' },
        { key: 'scope', label: 'Scope', control: 'select', options: [['global', 'Global'], ['local', 'Per-entity']] },
      ],
      note: 'Reads a variable for use in expressions. Use in other blocks value fields.',
    },
    {
      category: 'Variables', blockType: 'random-variable', runtimeType: 'randomVariable', kind: 'action',
      label: 'Random Variable', color: '#f97316', cellLabel: 'Rand',
      defaults: { type: 'randomVariable', name: 'randomValue', min: 0, max: 100 },
      fields: [
        { key: 'name', label: 'Variable name', control: 'text', placeholder: 'randomValue' },
        { key: 'min', label: 'Min', control: EXPR, placeholder: '0' },
        { key: 'max', label: 'Max', control: EXPR, placeholder: '100' },
      ],
      note: 'Sets a variable to a random integer between min and max.',
    },
    {
      category: 'Variables', blockType: 'variable-condition', runtimeType: 'variableCheck', kind: 'condition',
      label: 'Variable Check', color: '#f59e0b', cellLabel: 'Var?',
      defaults: { type: 'variableCheck', name: 'score', operator: '>=', value: 10, scope: 'global', reversed: false },
      fields: [
        { key: 'name', label: 'Variable name', control: 'text', placeholder: 'score' },
        { key: 'operator', label: 'Operator', control: 'select', options: [['>=', '≥'], ['<=', '≤'], ['==', '='], ['!=', '≠'], ['>', '>'], ['<', '<']] },
        { key: 'value', label: 'Value', control: EXPR, placeholder: '10' },
        { key: 'scope', label: 'Scope', control: 'select', options: [['global', 'Global'], ['local', 'Per-entity']] },
        { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] },
      ],
    },

    // ---- Logic: Actions — Objects ----
    {
      category: 'Objects', blockType: 'destroy-object', runtimeType: 'destroyObject', kind: 'action',
      label: 'Destroy Object', color: '#ef4444', cellLabel: 'Destroy',
      defaults: { type: 'destroyObject', targetObject: '' },
      fields: [{ key: 'targetObject', label: 'Object', control: OBJ }],
    },
    {
      category: 'Objects', blockType: 'spawn-object', runtimeType: 'spawnObject', kind: 'action',
      label: 'Spawn Object', color: '#22c55e', cellLabel: 'Spawn',
      defaults: { type: 'spawnObject', sourceObject: '', targetObject: '', x: '', y: '' },
      fields: [
        { key: 'sourceObject', label: 'Template (existing)', control: OBJ },
        { key: 'targetObject', label: 'New name', control: 'text', placeholder: 'bullet1' },
        { key: 'x', label: 'X', control: EXPR, placeholder: 'e.g. player.posX' },
        { key: 'y', label: 'Y', control: EXPR, placeholder: 'e.g. player.posY' },
      ],
      note: 'Creates a clone of an existing object at the given position.',
    },
    {
      category: 'Objects', blockType: 'show-hide', runtimeType: 'showHide', kind: 'action',
      label: 'Show / Hide', color: '#64748b', cellLabel: 'Vis',
      defaults: { type: 'showHide', targetObject: '', visible: true },
      fields: [
        { key: 'targetObject', label: 'Object', control: OBJ },
        { key: 'visible', label: 'Visible', control: 'select', options: [[true, 'Show'], [false, 'Hide']] },
      ],
    },
    {
      category: 'Objects', blockType: 'set-text', runtimeType: 'setText', kind: 'action',
      label: 'Set Text', color: '#06b6d4', cellLabel: 'Text=',
      defaults: { type: 'setText', targetObject: '', text: 'Hello' },
      fields: [
        { key: 'targetObject', label: 'Object', control: OBJ },
        { key: 'text', label: 'Text', control: 'text', placeholder: 'Hello or "Score: " + score' },
      ],
    },
    {
      category: 'Objects', blockType: 'set-color', runtimeType: 'setColor', kind: 'action',
      label: 'Set Color', color: '#06b6d4', cellLabel: 'Color=',
      defaults: { type: 'setColor', targetObject: '', color: '#ff0000' },
      fields: [
        { key: 'targetObject', label: 'Object', control: OBJ },
        { key: 'color', label: 'Color', control: 'color' },
      ],
    },

    // ---- Logic: Actions — Camera ----
    {
      category: 'Camera', blockType: 'set-camera', runtimeType: 'setCamera', kind: 'action',
      label: 'Set Camera', color: '#8b5cf6', cellLabel: 'Cam=',
      defaults: { type: 'setCamera', x: 0, y: 0 },
      fields: [
        { key: 'x', label: 'Camera X', control: EXPR, placeholder: '0' },
        { key: 'y', label: 'Camera Y', control: EXPR, placeholder: '0' },
      ],
    },
    {
      category: 'Camera', blockType: 'follow-camera', runtimeType: 'followCamera', kind: 'action',
      label: 'Camera Follow', color: '#a78bfa', cellLabel: 'Follow',
      defaults: { type: 'followCamera', targetObject: '', offsetX: 0, offsetY: 0 },
      fields: [
        { key: 'targetObject', label: 'Follow object', control: OBJ },
        { key: 'offsetX', label: 'Offset X', control: EXPR, placeholder: '0' },
        { key: 'offsetY', label: 'Offset Y', control: EXPR, placeholder: '0' },
      ],
    },
    {
      category: 'Camera', blockType: 'camera-shake', runtimeType: 'cameraShake', kind: 'action',
      label: 'Camera Shake', color: '#c084fc', cellLabel: 'Shake',
      defaults: { type: 'cameraShake', strength: 8, duration: 20 },
      fields: [
        { key: 'strength', label: 'Strength', control: EXPR, placeholder: '8' },
        { key: 'duration', label: 'Duration (frames)', control: EXPR, placeholder: '20' },
      ],
    },

    // ---- Logic: Actions — Scene ----
    {
      category: 'Scene', blockType: 'switch-scene', runtimeType: 'switchScene', kind: 'action',
      label: 'Switch Scene', color: '#10b981', cellLabel: 'Scene→',
      defaults: { type: 'switchScene', sceneName: '' },
      fields: [{ key: 'sceneName', label: 'Scene name', control: 'text', placeholder: 'Scene 2' }],
    },
    {
      category: 'Scene', blockType: 'play-sound', runtimeType: 'playSound', kind: 'action',
      label: 'Play Sound', color: '#f59e0b', cellLabel: 'Sound',
      defaults: { type: 'playSound', frequency: 440, duration: 0.15, type: 'sine', volume: 0.3 },
      fields: [
        { key: 'frequency', label: 'Frequency (Hz)', control: EXPR, placeholder: '440' },
        { key: 'duration', label: 'Duration (s)', control: EXPR, placeholder: '0.15' },
        { key: 'type', label: 'Wave', control: 'select', options: [['sine', 'Sine'], ['square', 'Square'], ['sawtooth', 'Sawtooth'], ['triangle', 'Triangle']] },
        { key: 'volume', label: 'Volume', control: EXPR, placeholder: '0.3' },
      ],
      note: 'Plays a synthesized tone. No audio file needed.',
    },
    {
      category: 'Scene', blockType: 'timer-control', runtimeType: 'timerControl', kind: 'action',
      label: 'Timer Control', color: '#0f766e', cellLabel: 'Timer⚙',
      defaults: { type: 'timerControl', timerName: 'timer', action: 'reset' },
      fields: [
        { key: 'timerName', label: 'Timer name', control: 'text', placeholder: 'spawnTimer' },
        { key: 'action', label: 'Action', control: 'select', options: [['reset', 'Reset / start'], ['pause', 'Pause'], ['resume', 'Resume'], ['clear', 'Clear']] },
      ],
    },

    // ---- Logic: Actions — Effects ----
    {
      category: 'Effects', blockType: 'screen-flash', runtimeType: 'screenFlash', kind: 'action',
      label: 'Screen Flash', color: '#fbbf24', cellLabel: 'Flash',
      defaults: { type: 'screenFlash', color: '#ffffff', intensity: 0.6, duration: 10 },
      fields: [
        { key: 'color', label: 'Color', control: 'color' },
        { key: 'intensity', label: 'Intensity (0-1)', control: EXPR, placeholder: '0.6' },
        { key: 'duration', label: 'Duration (frames)', control: EXPR, placeholder: '10' },
      ],
    },
    {
      category: 'Effects', blockType: 'create-particles', runtimeType: 'createParticles', kind: 'action',
      label: 'Particles', color: '#f472b6', cellLabel: 'Particles',
      defaults: { type: 'createParticles', x: '', y: '', count: 12, color: '#f59e0b', spread: 8, life: 30 },
      fields: [
        { key: 'x', label: 'X', control: EXPR, placeholder: 'e.g. player.posX' },
        { key: 'y', label: 'Y', control: EXPR, placeholder: 'e.g. player.posY' },
        { key: 'count', label: 'Count', control: EXPR, placeholder: '12' },
        { key: 'color', label: 'Color', control: 'color' },
        { key: 'spread', label: 'Spread speed', control: EXPR, placeholder: '8' },
        { key: 'life', label: 'Lifetime (frames)', control: EXPR, placeholder: '30' },
      ],
    },
  ];

  // Build lookup maps
  const BLOCK_MAP = Object.fromEntries(BLOCKS.map((b) => [b.blockType, b]));
  const RUNTIME_MAP = Object.fromEntries(BLOCKS.map((b) => [b.runtimeType, b]));
  const CATEGORIES = [...new Set(BLOCKS.map((b) => b.category))];

  function getBlock(blockType) {
    return BLOCK_MAP[blockType] || null;
  }

  function getBlockByRuntime(runtimeType) {
    return RUNTIME_MAP[runtimeType] || null;
  }

  function getBlocksByCategory(category) {
    return BLOCKS.filter((b) => b.category === category);
  }

  function getConditionBlocks() {
    return BLOCKS.filter((b) => b.kind === 'condition');
  }

  function getActionBlocks() {
    return BLOCKS.filter((b) => b.kind === 'action');
  }

  global.HydraBlocks = {
    BLOCKS, BLOCK_MAP, RUNTIME_MAP, CATEGORIES,
    getBlock, getBlockByRuntime, getBlocksByCategory,
    getConditionBlocks, getActionBlocks,
  };
})(window);
