// HydraScript block catalogue extensions.
// Keep new blocks declarative here so script.js does not become the only place
// that knows about every visual block, default, label, and editor field.
(function () {
  const expr = 'expr';
  const obj = 'object';

  window.HydraBlockCatalog = {
    blocks: [
      {
        category: 'Organization',
        blockType: 'comment-block',
        runtimeType: 'comment',
        kind: 'meta',
        label: 'Comment',
        color: '#64748b',
        cellLabel: 'Note',
        defaults: { type: 'comment', text: 'Comment' },
        fields: [
          { key: 'text', label: 'Comment', control: 'textarea', placeholder: 'What this event does...' }
        ],
        note: 'Editor-only note. It never runs in preview.'
      },
      {
        category: 'Logic',
        blockType: 'always-condition',
        runtimeType: 'always',
        kind: 'condition',
        label: 'Every Frame',
        color: '#0d9488',
        cellLabel: 'Always',
        defaults: { type: 'always' },
        note: 'Always true while the preview is running.'
      },
      {
        category: 'Logic',
        blockType: 'trigger-once-condition',
        runtimeType: 'triggerOnce',
        kind: 'condition',
        label: 'Trigger Once',
        color: '#10b981',
        cellLabel: 'Once',
        defaults: { type: 'triggerOnce', reversed: false },
        fields: [
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'Fires once per preview. Put it next to another condition to gate that condition once.'
      },
      {
        category: 'Logic',
        blockType: 'timer-control',
        runtimeType: 'timerControl',
        kind: 'action',
        label: 'Reset / Pause Timer',
        color: '#0f766e',
        cellLabel: 'Timer',
        defaults: { type: 'timerControl', timerName: 'timer', action: 'reset' },
        fields: [
          { key: 'timerName', label: 'Timer name', control: 'text', placeholder: 'spawnTimer' },
          { key: 'action', label: 'Action', control: 'select', options: [['reset', 'Reset / start'], ['pause', 'Pause'], ['resume', 'Resume'], ['clear', 'Clear']] }
        ],
        note: 'Controls the named timer used by On Timer blocks.'
      },
      {
        category: 'Logic',
        blockType: 'distance-condition',
        runtimeType: 'distanceCheck',
        kind: 'condition',
        label: 'Distance Check',
        color: '#0891b2',
        cellLabel: 'Dist?',
        defaults: { type: 'distanceCheck', object1: '', object2: '', operator: '<=', distance: 120, reversed: false },
        fields: [
          { key: 'object1', label: 'Object A', control: obj },
          { key: 'object2', label: 'Object B', control: obj },
          { key: 'operator', label: 'Operator', control: 'select', options: [['<=', 'Within distance'], ['>', 'Farther than distance'], ['>=', 'At least distance'], ['<', 'Less than distance']] },
          { key: 'distance', label: 'Distance', control: expr, placeholder: '120 or aggroRange' },
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'Compares center-to-center distance between named objects.'
      },
      {
        category: 'Logic',
        blockType: 'position-condition',
        runtimeType: 'positionCheck',
        kind: 'condition',
        label: 'Position Check',
        color: '#0f766e',
        cellLabel: 'Pos?',
        defaults: { type: 'positionCheck', targetObject: '', property: 'posY', operator: '>=', value: 500, reversed: false },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'property', label: 'Property', control: 'select', options: [['posX', 'X position'], ['posY', 'Y position'], ['velX', 'Velocity X'], ['velY', 'Velocity Y'], ['width', 'Width'], ['height', 'Height'], ['rotation', 'Rotation']] },
          { key: 'operator', label: 'Operator', control: 'select', options: [['>=', '>='], ['<=', '<='], ['==', '=='], ['!=', '!='], ['>', '>'], ['<', '<']] },
          { key: 'value', label: 'Value', control: expr, placeholder: '500 or groundY' },
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ]
      },
      {
        category: 'Logic',
        blockType: 'object-count-condition',
        runtimeType: 'objectCount',
        kind: 'condition',
        label: 'Object Count',
        color: '#7c3aed',
        cellLabel: 'Count?',
        defaults: { type: 'objectCount', targetObject: '', operator: '==', count: 0, reversed: false },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'operator', label: 'Operator', control: 'select', options: [['==', '=='], ['!=', '!='], ['>=', '>='], ['<=', '<='], ['>', '>'], ['<', '<']] },
          { key: 'count', label: 'Count', control: expr, placeholder: '0 or targetCount' },
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ]
      },
      {
        category: 'Logic',
        blockType: 'chance-condition',
        runtimeType: 'chance',
        kind: 'condition',
        label: 'Chance',
        color: '#c026d3',
        cellLabel: 'Chance',
        defaults: { type: 'chance', percent: 5, reversed: false },
        fields: [
          { key: 'percent', label: 'Percent', control: expr, placeholder: '5' },
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'A random roll each frame this condition is evaluated.'
      },
      {
        category: 'Logic',
        blockType: 'mouse-over-object-condition',
        runtimeType: 'mouseOverObject',
        kind: 'condition',
        label: 'Mouse Over Object',
        color: '#0284c7',
        cellLabel: 'Hover?',
        defaults: { type: 'mouseOverObject', targetObject: '', reversed: false },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'Works with camera-follow worlds and fixed UI objects.'
      },
      {
        category: 'Logic',
        blockType: 'velocity-condition',
        runtimeType: 'velocityCheck',
        kind: 'condition',
        label: 'Velocity Check',
        color: '#0f766e',
        cellLabel: 'Speed?',
        defaults: { type: 'velocityCheck', targetObject: '', component: 'speed', operator: '>=', value: 1, reversed: false },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'component', label: 'Component', control: 'select', options: [['speed', 'Total speed'], ['x', 'Velocity X'], ['y', 'Velocity Y']] },
          { key: 'operator', label: 'Operator', control: 'select', options: [['>=', '>='], ['<=', '<='], ['==', '=='], ['!=', '!='], ['>', '>'], ['<', '<']] },
          { key: 'value', label: 'Value', control: expr, placeholder: '1 or maxRunSpeed' },
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ]
      },
      {
        category: 'Logic',
        blockType: 'visible-condition',
        runtimeType: 'objectVisible',
        kind: 'condition',
        label: 'Object Visible',
        color: '#7c3aed',
        cellLabel: 'Visible?',
        defaults: { type: 'objectVisible', targetObject: '', reversed: false },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ]
      },
      {
        category: 'Input',
        blockType: 'object-clicked-condition',
        runtimeType: 'objectClicked',
        kind: 'condition',
        label: 'Object Clicked',
        color: '#0284c7',
        cellLabel: 'Click Obj',
        defaults: { type: 'objectClicked', targetObject: '', button: 'left', reversed: false },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'button', label: 'Button', control: 'select', options: [['left', 'Left button'], ['middle', 'Middle button'], ['right', 'Right button']] },
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ]
      },
      {
        category: 'Collision',
        blockType: 'on-floor-condition',
        runtimeType: 'onFloor',
        kind: 'condition',
        label: 'Is On Floor',
        color: '#8b5cf6',
        cellLabel: 'Floor?',
        defaults: { type: 'onFloor', targetObject: '', platformObject: '', countTouchingEdges: true, reversed: false },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'platformObject', label: 'Floor', control: obj },
          { key: 'countTouchingEdges', label: 'Count touching edges', control: 'checkbox' },
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ]
      },
      {
        category: 'Motion',
        blockType: 'force-toward-position',
        runtimeType: 'forceTowardPosition',
        kind: 'action',
        label: 'Force Toward Position',
        color: '#e11d48',
        cellLabel: 'Force XY',
        defaults: { type: 'forceTowardPosition', targetObject: '', targetX: 400, targetY: 300, speed: 3, mode: 'add' },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'targetX', label: 'X', control: expr, placeholder: '400 or mouseX' },
          { key: 'targetY', label: 'Y', control: expr, placeholder: '300 or mouseY' },
          { key: 'speed', label: 'Speed', control: expr, placeholder: '3 or enemySpeed' },
          { key: 'mode', label: 'Mode', control: 'select', options: [['add', 'Instant force'], ['set', 'Permanent speed']] }
        ],
        note: 'For objects using gravity, this keeps gravity active and uses horizontal force plus a grounded jump impulse when the target is above.'
      },
      {
        category: 'Motion',
        blockType: 'move-toward-position',
        runtimeType: 'moveTowardPosition',
        kind: 'action',
        label: 'Move Toward Position',
        color: '#f97316',
        cellLabel: 'Move XY',
        defaults: { type: 'moveTowardPosition', targetObject: '', targetX: 400, targetY: 300, speed: 4, stopDistance: 1 },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'targetX', label: 'X', control: expr, placeholder: '400' },
          { key: 'targetY', label: 'Y', control: expr, placeholder: '300' },
          { key: 'speed', label: 'Speed', control: expr, placeholder: '4' },
          { key: 'stopDistance', label: 'Stop Distance', control: expr, placeholder: '1' }
        ],
        note: 'Moves position directly, useful for UI and non-physics objects.'
      },
      {
        category: 'Motion',
        blockType: 'move-toward-object',
        runtimeType: 'moveTowardObject',
        kind: 'action',
        label: 'Move Toward Object',
        color: '#fb923c',
        cellLabel: 'Move Obj',
        defaults: { type: 'moveTowardObject', targetObject: '', sourceObject: '', speed: 4, stopDistance: 1 },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'sourceObject', label: 'Toward', control: obj },
          { key: 'speed', label: 'Speed', control: expr, placeholder: '4' },
          { key: 'stopDistance', label: 'Stop Distance', control: expr, placeholder: '1' }
        ]
      },
      {
        category: 'Motion',
        blockType: 'impulse-away-object',
        runtimeType: 'impulseAwayObject',
        kind: 'action',
        label: 'Impulse Away Object',
        color: '#be123c',
        cellLabel: 'Away',
        defaults: { type: 'impulseAwayObject', targetObject: '', sourceObject: '', speed: 8, mode: 'add' },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'sourceObject', label: 'From', control: obj },
          { key: 'speed', label: 'Impulse', control: expr, placeholder: '8' },
          { key: 'mode', label: 'Mode', control: 'select', options: [['add', 'Add'], ['set', 'Set']] }
        ]
      },
      {
        category: 'Motion',
        blockType: 'stop-object',
        runtimeType: 'stopObject',
        kind: 'action',
        label: 'Stop Object',
        color: '#64748b',
        cellLabel: 'Stop',
        defaults: { type: 'stopObject', targetObject: '', axis: 'both' },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'axis', label: 'Axis', control: 'select', options: [['both', 'X and Y'], ['x', 'X only'], ['y', 'Y only']] }
        ]
      },
      {
        category: 'Collision',
        blockType: 'separate-objects',
        runtimeType: 'separateObjects',
        kind: 'action',
        label: 'Separate Objects',
        color: '#8b5cf6',
        cellLabel: 'Separate',
        defaults: { type: 'separateObjects', object1: '', object2: '', move: 'object1' },
        fields: [
          { key: 'object1', label: 'Object A', control: obj },
          { key: 'object2', label: 'Object B', control: obj },
          { key: 'move', label: 'Move', control: 'select', options: [['object1', 'Object A'], ['object2', 'Object B'], ['both', 'Both']] }
        ]
      },
      {
        category: 'Motion',
        blockType: 'face-movement',
        runtimeType: 'faceMovement',
        kind: 'action',
        label: 'Face Movement',
        color: '#ec4899',
        cellLabel: 'Face Vel',
        defaults: { type: 'faceMovement', targetObject: '', offsetAngle: 0, minSpeed: 0.05 },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'offsetAngle', label: 'Angle offset', control: expr, placeholder: '0 or 90' },
          { key: 'minSpeed', label: 'Speed', control: expr, placeholder: '0.05' }
        ],
        note: 'Rotates an object to point in the direction it is moving.'
      },
      {
        category: 'Motion',
        blockType: 'set-position',
        runtimeType: 'setPosition',
        kind: 'action',
        label: 'Set Position',
        color: '#f59e0b',
        cellLabel: 'Set Pos',
        defaults: { type: 'setPosition', targetObject: '', x: 400, y: 300 },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'x', label: 'X', control: expr, placeholder: '400 or spawnX' },
          { key: 'y', label: 'Y', control: expr, placeholder: '300 or spawnY' }
        ]
      },
      {
        category: 'Object',
        blockType: 'spawn-at-object',
        runtimeType: 'spawnAtObject',
        kind: 'action',
        label: 'Spawn At Object',
        color: '#22c55e',
        cellLabel: 'Spawn Obj',
        defaults: { type: 'spawnAtObject', sourceObject: '', targetObject: '', offsetX: 0, offsetY: 0 },
        fields: [
          { key: 'sourceObject', label: 'Object', control: obj },
          { key: 'targetObject', label: 'At', control: obj },
          { key: 'offsetX', label: 'Offset X', control: expr, placeholder: '0 or player.width' },
          { key: 'offsetY', label: 'Offset Y', control: expr, placeholder: '0' }
        ]
      },
      {
        category: 'World',
        blockType: 'clamp-to-screen',
        runtimeType: 'clampToScreen',
        kind: 'action',
        label: 'Clamp To World',
        color: '#0ea5e9',
        cellLabel: 'Clamp',
        defaults: { type: 'clampToScreen', targetObject: '', bounce: false },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'bounce', label: 'Bounce', control: 'checkbox' }
        ]
      },
      {
        category: 'World',
        blockType: 'wrap-screen',
        runtimeType: 'wrapScreen',
        kind: 'action',
        label: 'Wrap At World Edge',
        color: '#38bdf8',
        cellLabel: 'Wrap',
        defaults: { type: 'wrapScreen', targetObject: '' },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj }
        ]
      },
      {
        category: 'World',
        blockType: 'destroy-outside-screen',
        runtimeType: 'destroyOutsideScreen',
        kind: 'action',
        label: 'Destroy Outside World',
        color: '#0ea5e9',
        cellLabel: 'Cull',
        defaults: { type: 'destroyOutsideScreen', targetObject: '', margin: 0 },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'margin', label: 'Margin', control: expr, placeholder: '40' }
        ]
      },
      {
        category: 'World',
        blockType: 'set-gravity',
        runtimeType: 'setGravity',
        kind: 'action',
        label: 'Set Gravity',
        color: '#6366f1',
        cellLabel: 'Gravity',
        defaults: { type: 'setGravity', targetObject: '', gravity: 0.8 },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'gravity', label: 'Gravity', control: expr, placeholder: '0.8' }
        ]
      },
      {
        category: 'World',
        blockType: 'set-max-speed',
        runtimeType: 'setMaxSpeed',
        kind: 'action',
        label: 'Set Max Speed',
        color: '#4f46e5',
        cellLabel: 'Max Spd',
        defaults: { type: 'setMaxSpeed', targetObject: '', maxSpeed: 12 },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'maxSpeed', label: 'Max Speed', control: expr, placeholder: '12' }
        ]
      },
      {
        category: 'World',
        blockType: 'set-bounciness',
        runtimeType: 'setBounciness',
        kind: 'action',
        label: 'Set Bounciness',
        color: '#6366f1',
        cellLabel: 'Bounce',
        defaults: { type: 'setBounciness', targetObject: '', bounciness: 0.4 },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'bounciness', label: 'Bounciness', control: expr, placeholder: '0.4' }
        ]
      },
      {
        category: 'World',
        blockType: 'set-physics-enabled',
        runtimeType: 'setPhysicsEnabled',
        kind: 'action',
        label: 'Enable / Disable Physics',
        color: '#0f766e',
        cellLabel: 'Physics',
        defaults: { type: 'setPhysicsEnabled', targetObject: '', enabled: true, resetVelocity: false },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'enabled', label: 'Enabled', control: 'checkbox' },
          { key: 'resetVelocity', label: 'Reset velocity', control: 'checkbox' }
        ]
      },
      {
        category: 'World',
        blockType: 'set-static',
        runtimeType: 'setStatic',
        kind: 'action',
        label: 'Set Static / Dynamic',
        color: '#64748b',
        cellLabel: 'Static',
        defaults: { type: 'setStatic', targetObject: '', static: true },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'static', label: 'Static', control: 'checkbox' }
        ]
      },
      {
        category: 'World',
        blockType: 'set-friction',
        runtimeType: 'setFriction',
        kind: 'action',
        label: 'Set Friction',
        color: '#4f46e5',
        cellLabel: 'Friction',
        defaults: { type: 'setFriction', targetObject: '', friction: 0.82 },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'friction', label: 'Friction', control: expr, placeholder: '0.82' }
        ]
      },
      {
        category: 'Scene',
        blockType: 'restart-scene',
        runtimeType: 'restartScene',
        kind: 'action',
        label: 'Restart Scene',
        color: '#059669',
        cellLabel: 'Restart',
        defaults: { type: 'restartScene' },
        fields: []
      },
      {
        category: 'Scene',
        blockType: 'next-scene',
        runtimeType: 'nextScene',
        kind: 'action',
        label: 'Go To Next Scene',
        color: '#059669',
        cellLabel: 'Next',
        defaults: { type: 'nextScene' },
        fields: []
      },
      {
        category: 'Scene',
        blockType: 'previous-scene',
        runtimeType: 'previousScene',
        kind: 'action',
        label: 'Go To Previous Scene',
        color: '#059669',
        cellLabel: 'Prev',
        defaults: { type: 'previousScene' },
        fields: []
      },
      {
        category: 'Storage',
        blockType: 'save-variable',
        runtimeType: 'saveVariable',
        kind: 'action',
        label: 'Save Variable',
        color: '#64748b',
        cellLabel: 'Save Var',
        defaults: { type: 'saveVariable', varName: 'bestScore', saveKey: 'bestScore' },
        fields: [
          { key: 'varName', label: 'Variable', control: 'text', placeholder: 'bestScore' },
          { key: 'saveKey', label: 'Key', control: 'text', placeholder: 'bestScore' }
        ]
      },
      {
        category: 'Storage',
        blockType: 'load-variable',
        runtimeType: 'loadVariable',
        kind: 'action',
        label: 'Load Variable',
        color: '#64748b',
        cellLabel: 'Load Var',
        defaults: { type: 'loadVariable', varName: 'bestScore', saveKey: 'bestScore' },
        fields: [
          { key: 'varName', label: 'Variable', control: 'text', placeholder: 'bestScore' },
          { key: 'saveKey', label: 'Key', control: 'text', placeholder: 'bestScore' }
        ]
      },
      {
        category: 'Object',
        blockType: 'set-color',
        runtimeType: 'setColor',
        kind: 'action',
        label: 'Set Color',
        color: '#a855f7',
        cellLabel: 'Color',
        defaults: { type: 'setColor', targetObject: '', color: '#ffcc00' },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'color', label: 'Color', control: 'color' }
        ]
      },
      {
        category: 'Object',
        blockType: 'set-opacity',
        runtimeType: 'setOpacity',
        kind: 'action',
        label: 'Set Opacity',
        color: '#a855f7',
        cellLabel: 'Opacity',
        defaults: { type: 'setOpacity', targetObject: '', opacity: 1 },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'opacity', label: 'Opacity', control: expr, placeholder: '0.5' }
        ]
      },
      {
        category: 'Object',
        blockType: 'set-layer',
        runtimeType: 'setLayer',
        kind: 'action',
        label: 'Set Layer',
        color: '#9333ea',
        cellLabel: 'Layer',
        defaults: { type: 'setLayer', targetObject: '', layer: 1 },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'layer', label: 'Layer', control: expr, placeholder: '1 or score' }
        ]
      },
      {
        category: 'Object',
        blockType: 'point-toward-object',
        runtimeType: 'pointTowardObject',
        kind: 'action',
        label: 'Point Toward Object',
        color: '#ec4899',
        cellLabel: 'Look Obj',
        defaults: { type: 'pointTowardObject', targetObject: '', sourceObject: '', offsetAngle: 0 },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'sourceObject', label: 'Toward', control: obj },
          { key: 'offsetAngle', label: 'Angle offset', control: expr, placeholder: '0 or 90' }
        ]
      },
      {
        category: 'Object',
        blockType: 'point-toward-position',
        runtimeType: 'pointTowardPosition',
        kind: 'action',
        label: 'Point Toward Position',
        color: '#db2777',
        cellLabel: 'Look XY',
        defaults: { type: 'pointTowardPosition', targetObject: '', targetX: 400, targetY: 300, offsetAngle: 0 },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'targetX', label: 'X', control: expr, placeholder: '400' },
          { key: 'targetY', label: 'Y', control: expr, placeholder: '300' },
          { key: 'offsetAngle', label: 'Angle offset', control: expr, placeholder: '0 or 90' }
        ]
      },
      {
        category: 'Camera',
        blockType: 'screen-shake',
        runtimeType: 'screenShake',
        kind: 'action',
        label: 'Screen Shake',
        color: '#f97316',
        cellLabel: 'Shake',
        defaults: { type: 'screenShake', strength: 6, duration: 0.2, cooldown: 0.25 },
        fields: [
          { key: 'strength', label: 'Strength', control: expr, placeholder: '6' },
          { key: 'duration', label: 'Seconds', control: expr, placeholder: '0.2' },
          { key: 'cooldown', label: 'Cooldown', control: expr, placeholder: '0.25' }
        ]
      }
    ]
  };
  const blocks = window.HydraBlockCatalog.blocks;
  const addBlock = block => {
    if (!blocks.some(existing => existing.blockType === block.blockType)) blocks.push(block);
  };
  const slug = value => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const keyPresets = [
    ['KeyW', 'W'], ['KeyA', 'A'], ['KeyS', 'S'], ['KeyD', 'D'],
    ['ArrowUp', 'Up Arrow'], ['ArrowLeft', 'Left Arrow'], ['ArrowDown', 'Down Arrow'], ['ArrowRight', 'Right Arrow'],
    ['Space', 'Space'], ['ShiftLeft', 'Left Shift'], ['ControlLeft', 'Left Ctrl'], ['Enter', 'Enter'],
    ['Escape', 'Escape'], ['KeyE', 'E / Interact'], ['KeyQ', 'Q'], ['KeyR', 'R / Reload'],
    ['Digit1', '1'], ['Digit2', '2'], ['Digit3', '3'], ['KeyF', 'F'], ['Tab', 'Tab']
  ];
  const keyModes = [
    ['held', 'Held', 'keyPressed'],
    ['pressed', 'Just Pressed', 'keyJustPressed'],
    ['released', 'Released', 'keyReleased']
  ];
  keyPresets.forEach(([key, label]) => {
    keyModes.forEach(([modeId, modeLabel, inputCondition]) => addBlock({
      category: 'Input Presets',
      blockType: `key-${slug(key)}-${modeId}`,
      runtimeType: inputCondition === 'keyJustPressed' ? 'keyJustPressed' : 'keyPressed',
      kind: 'condition',
      label: `${label} ${modeLabel}`,
      color: '#0284c7',
      cellLabel: modeId === 'held' ? label : modeLabel,
      defaults: { type: inputCondition === 'keyJustPressed' ? 'keyJustPressed' : 'keyPressed', key, inputCondition, reversed: false },
      fields: [
        { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
      ],
      note: `Preset keyboard condition for ${label}.`
    }));
  });
  ['left', 'middle', 'right', 'any'].forEach(button => {
    [
      ['mouse-held', 'Mouse held', 'mouseButtonPressed'],
      ['mouse-pressed', 'Mouse just pressed', 'mouseButtonJustPressed'],
      ['mouse-released', 'Mouse released', 'mouseButtonReleased']
    ].forEach(([id, label, mouseCondition]) => addBlock({
      category: 'Input Presets',
      blockType: `${id}-${button}`,
      runtimeType: 'mouseClick',
      kind: 'condition',
      label: `${label}: ${button}`,
      color: '#0ea5e9',
      cellLabel: 'Mouse',
      defaults: { type: 'mouseClick', button, mouseCondition, reversed: false },
      fields: [{ key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }]
    }));
  });
  const variables = ['score', 'health', 'ammo', 'coins', 'keys', 'wave', 'lives', 'energy', 'quest', 'timer', 'doorsOpen', 'bossHealth'];
  variables.forEach(name => {
    addBlock({
      category: 'Variable Presets',
      blockType: `var-${slug(name)}-at-least`,
      runtimeType: 'getVariable',
      kind: 'condition',
      label: `${name} >= value`,
      color: '#06b6d4',
      cellLabel: `${name}?`,
      defaults: { type: 'getVariable', varName: name, operator: '>=', compareValue: 1, reversed: false },
      fields: [
        { key: 'operator', label: 'Operator', control: 'select', options: [['>=', '>='], ['<=', '<='], ['==', '=='], ['!=', '!='], ['>', '>'], ['<', '<']] },
        { key: 'compareValue', label: 'Value', control: expr, placeholder: '1' },
        { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
      ]
    });
    ['set', 'add', 'subtract'].forEach(operation => addBlock({
      category: 'Variable Presets',
      blockType: `var-${slug(name)}-${operation}`,
      runtimeType: 'setVariable',
      kind: 'action',
      label: `${operation} ${name}`,
      color: '#14b8a6',
      cellLabel: `${operation} ${name}`,
      defaults: { type: 'setVariable', varName: name, operation, value: operation === 'subtract' ? 1 : operation === 'add' ? 1 : 0 },
      fields: [{ key: 'value', label: 'Value', control: expr, placeholder: '1' }]
    }));
  });
  [
    ['move-left', 'Move left', -5, 0], ['move-right', 'Move right', 5, 0], ['move-up', 'Move up', 0, -5], ['move-down', 'Move down', 0, 5],
    ['jump-small', 'Small jump', 0, -8], ['jump-high', 'High jump', 0, -14], ['dash-left', 'Dash left', -15, 0], ['dash-right', 'Dash right', 15, 0],
    ['fall-fast', 'Fast fall', 0, 8], ['stop-x', 'Stop X', 0, 0], ['stop-y', 'Stop Y', 0, 0], ['stop-all', 'Stop all', 0, 0]
  ].forEach(([id, label, velX, velY]) => addBlock({
    category: 'Movement Presets',
    blockType: `preset-${id}`,
    runtimeType: id.startsWith('stop') ? 'stopObject' : 'setVelocity',
    kind: 'action',
    label,
    color: '#f97316',
    cellLabel: label,
    defaults: id === 'stop-x' ? { type: 'stopObject', targetObject: '', axis: 'x' }
      : id === 'stop-y' ? { type: 'stopObject', targetObject: '', axis: 'y' }
      : id === 'stop-all' ? { type: 'stopObject', targetObject: '', axis: 'both' }
      : { type: 'setVelocity', targetObject: '', velX, velY },
    fields: [{ key: 'targetObject', label: 'Object', control: obj }]
  }));
  [
    ['platformer', 0.8, 0.9, 18], ['floaty', 0.25, 0.96, 12], ['top-down', 0, 0.72, 12],
    ['ice', 0.6, 0.99, 20], ['heavy', 1.4, 0.86, 14], ['low-gravity', 0.18, 0.94, 18],
    ['bullet', 0, 1, 40], ['vehicle', 0, 0.94, 28]
  ].forEach(([id, gravity, friction, maxSpeed]) => {
    addBlock({
      category: 'Physics Presets',
      blockType: `physics-${id}-gravity`,
      runtimeType: 'setGravity',
      kind: 'action',
      label: `${id} gravity`,
      color: '#6366f1',
      cellLabel: 'Gravity',
      defaults: { type: 'setGravity', targetObject: '', gravity },
      fields: [{ key: 'targetObject', label: 'Object', control: obj }]
    });
    addBlock({
      category: 'Physics Presets',
      blockType: `physics-${id}-friction`,
      runtimeType: 'setFriction',
      kind: 'action',
      label: `${id} friction`,
      color: '#4f46e5',
      cellLabel: 'Friction',
      defaults: { type: 'setFriction', targetObject: '', friction },
      fields: [{ key: 'targetObject', label: 'Object', control: obj }]
    });
    addBlock({
      category: 'Physics Presets',
      blockType: `physics-${id}-max-speed`,
      runtimeType: 'setMaxSpeed',
      kind: 'action',
      label: `${id} max speed`,
      color: '#4338ca',
      cellLabel: 'Max',
      defaults: { type: 'setMaxSpeed', targetObject: '', maxSpeed },
      fields: [{ key: 'targetObject', label: 'Object', control: obj }]
    });
  });
  ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink', 'white', 'black'].forEach(colorName => {
    const colorMap = { red: '#ef4444', orange: '#f97316', yellow: '#facc15', green: '#22c55e', cyan: '#06b6d4', blue: '#3b82f6', purple: '#a855f7', pink: '#ec4899', white: '#f8fafc', black: '#111827' };
    addBlock({
      category: 'Visual Presets',
      blockType: `color-${colorName}`,
      runtimeType: 'setColor',
      kind: 'action',
      label: `Tint ${colorName}`,
      color: colorMap[colorName],
      cellLabel: colorName,
      defaults: { type: 'setColor', targetObject: '', color: colorMap[colorName] },
      fields: [{ key: 'targetObject', label: 'Object', control: obj }]
    });
  });
  [0, 0.25, 0.5, 0.75, 1].forEach(value => addBlock({
    category: 'Visual Presets',
    blockType: `opacity-${String(value).replace('.', '-')}`,
    runtimeType: 'setOpacity',
    kind: 'action',
    label: `Opacity ${value}`,
    color: '#a855f7',
    cellLabel: 'Opacity',
    defaults: { type: 'setOpacity', targetObject: '', opacity: value },
    fields: [{ key: 'targetObject', label: 'Object', control: obj }]
  }));
  [
    ['camera-follow-player', 'Camera follows object', 'followCamera', { type: 'followCamera', targetObject: '', offsetX: 0, offsetY: 0 }],
    ['camera-origin', 'Camera to origin', 'setCamera', { type: 'setCamera', cameraX: 0, cameraY: 0 }],
    ['shake-small', 'Small screen shake', 'screenShake', { type: 'screenShake', strength: 3, duration: 0.15, cooldown: 0.15 }],
    ['shake-big', 'Big screen shake', 'screenShake', { type: 'screenShake', strength: 10, duration: 0.35, cooldown: 0.25 }],
    ['timer-reset-spawn', 'Reset spawn timer', 'timerControl', { type: 'timerControl', timerName: 'spawn', action: 'reset' }],
    ['timer-pause-spawn', 'Pause spawn timer', 'timerControl', { type: 'timerControl', timerName: 'spawn', action: 'pause' }],
    ['save-score', 'Save score', 'saveVariable', { type: 'saveVariable', varName: 'score', saveKey: 'score' }],
    ['load-score', 'Load score', 'loadVariable', { type: 'loadVariable', varName: 'score', saveKey: 'score' }]
  ].forEach(([id, label, runtimeType, defaults]) => addBlock({
    category: 'Game Flow Presets',
    blockType: id,
    runtimeType,
    kind: 'action',
    label,
    color: '#059669',
    cellLabel: label.split(' ')[0],
    defaults,
    fields: runtimeType === 'followCamera' ? [{ key: 'targetObject', label: 'Object', control: obj }] : []
  }));
})();
