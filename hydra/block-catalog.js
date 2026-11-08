// HydraScript block catalogue extensions.
// Keep new blocks declarative here so script.js does not become the only place
// that knows about every visual block, default, label, and editor field.
//
// FIELD-CONTROL SCHEMA (P2 item 14/11): every block field declares one control
// from HydraBlockCatalog.FIELD_CONTROLS, and script.js renders the property
// panel from that declaration alone (makeCatalogFieldInput). The first six
// controls are the v4 field-control schema (v4-reference/hydra-blocks.js);
// the last five are v3 extensions the v4 schema has no equivalent for.
//   text/textarea/expr: free input; expr values are evaluated as expressions.
//   object: a select of the scene's object names (includeAll adds an "All" row).
//   select: options are [value, label] pairs; booleans stay booleans.
//   color: a color picker. number: a stepped number input (min/max/step).
//   checkbox: a labelled toggle. action: a select of named input actions.
//   scene: a select of the project's scenes (by id).
//   audio: a select of the uploaded audio assets (blank = built-in tone).
// A field may only carry the extra keys its control lists (key/label/control
// are universal). 'reversed' fields always use the canonical Off/On select
// and render as an Invert checkbox in the panel. validateCatalog() enforces
// all of this; tests/catalog.test.js locks it in.
(function () {
  const expr = 'expr';
  const obj = 'object';

  // The field-control schema. `extras` lists the only additional keys a
  // field with that control may carry (beyond key/label/control).
  const FIELD_CONTROLS = {
    text:     { extras: ['placeholder'], desc: 'Plain text input.' },
    textarea: { extras: ['placeholder', 'rows'], desc: 'Multi-line text input.' },
    expr:     { extras: ['placeholder'], desc: 'Expression input (evaluated at runtime).' },
    object:   { extras: ['includeAll'], desc: 'Select of the scene object names.' },
    select:   { extras: ['options'], desc: 'Select from [value, label] option pairs.' },
    color:    { extras: [], desc: 'Color picker.' },
    number:   { extras: ['min', 'max', 'step'], desc: 'Stepped number input.' },
    checkbox: { extras: [], desc: 'Labelled on/off toggle.' },
    action:   { extras: [], desc: 'Select of the named input actions.' },
    scene:    { extras: [], desc: 'Select of the project scenes.' },
    function: { extras: [], desc: 'Select of the project functions.' },
    audio:    { extras: [], desc: 'Select of the uploaded audio assets (blank = built-in tone).' }
  };

  // Validate a block list against the schema. Returns an array of plain
  // findings (empty = conforms). Never throws, even on hostile input.
  // Deliberately NOT findings, by design:
  //   - duplicate runtimeType: preset blocks share their base block's type
  //     (key presets are all keyPressed/keyJustPressed with inputCondition
  //     pinning the mode; mouse presets are all mouseClick, and so on).
  //   - defaults keys with no field: a preset pins those values; only the
  //     fields listed are editable in the panel.
  //   - blocks with no fields at all: fixed presets, nothing to edit.
  function validateCatalogBlocks(list) {
    const findings = [];
    try {
      if (!Array.isArray(list)) return ['catalog: expected an array of blocks'];
      const seenTypes = new Set();
      list.forEach((block, i) => {
        const where = 'block[' + i + ']';
        if (!block || typeof block !== 'object' || Array.isArray(block)) {
          findings.push(where + ': not an object');
          return;
        }
        const id = (typeof block.blockType === 'string' && block.blockType) || where;
        if (typeof block.blockType !== 'string' || !block.blockType) {
          findings.push(id + ': missing blockType');
        } else if (seenTypes.has(block.blockType)) {
          findings.push(id + ': duplicate blockType');
        } else {
          seenTypes.add(block.blockType);
        }
        if (typeof block.runtimeType !== 'string' || !block.runtimeType) {
          findings.push(id + ': missing runtimeType');
        }
        if (block.kind !== 'condition' && block.kind !== 'action' && block.kind !== 'meta') {
          findings.push(id + ': bad kind ' + String(block.kind));
        }
        ['category', 'label', 'color', 'cellLabel', 'note'].forEach(key => {
          if (typeof block[key] !== 'string' || !block[key]) findings.push(id + ': missing ' + key);
        });
        const defaults = block.defaults;
        if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) {
          findings.push(id + ': missing defaults object');
        } else if (defaults.type !== block.runtimeType) {
          findings.push(id + ': defaults.type ' + String(defaults.type) +
            ' != runtimeType ' + String(block.runtimeType));
        }
        const fields = block.fields;
        if (fields === undefined || fields === null) return; // fixed preset
        if (!Array.isArray(fields)) {
          findings.push(id + ': fields is not an array');
          return;
        }
        fields.forEach((field, j) => {
          const fwhere = id + '.' + ((field && typeof field.key === 'string' && field.key) || ('field[' + j + ']'));
          if (!field || typeof field !== 'object' || Array.isArray(field)) {
            findings.push(fwhere + ': not an object');
            return;
          }
          if (typeof field.key !== 'string' || !field.key) findings.push(fwhere + ': missing key');
          if (typeof field.label !== 'string' || !field.label) findings.push(fwhere + ': missing label');
          if (typeof field.control !== 'string' || !field.control) {
            findings.push(fwhere + ': missing control');
            return;
          }
          const spec = FIELD_CONTROLS[field.control];
          if (!spec) {
            findings.push(fwhere + ': unknown control ' + field.control);
            return;
          }
          Object.keys(field).forEach(key => {
            if (key !== 'key' && key !== 'label' && key !== 'control' && spec.extras.indexOf(key) === -1) {
              findings.push(fwhere + ': unexpected key ' + key + ' for control ' + field.control);
            }
          });
          if (field.control === 'select') {
            if (!Array.isArray(field.options) || !field.options.length) {
              findings.push(fwhere + ': select without options');
            } else {
              field.options.forEach(opt => {
                if (!Array.isArray(opt) || opt.length !== 2 || opt[1] === undefined || opt[1] === '') {
                  findings.push(fwhere + ': bad option ' + JSON.stringify(opt));
                }
              });
            }
          }
          if (field.control === 'number') {
            if (typeof field.min !== 'number' || typeof field.max !== 'number' || typeof field.step !== 'number') {
              findings.push(fwhere + ': number without min/max/step');
            } else if (field.min > field.max) {
              findings.push(fwhere + ': number min > max');
            }
          }
          if ((field.control === 'expr' || field.control === 'text' || field.control === 'textarea') &&
              (typeof field.placeholder !== 'string' || !field.placeholder)) {
            findings.push(fwhere + ': missing placeholder');
          }
          if (field.key === 'reversed' &&
              (field.control !== 'select' ||
               JSON.stringify(field.options) !== '[[false,"Off"],[true,"On"]]')) {
            findings.push(fwhere + ': reversed must be the canonical Off/On select');
          }
          if (defaults && typeof defaults === 'object' && !Array.isArray(defaults) &&
              field.key && !(field.key in defaults)) {
            findings.push(fwhere + ': field key not in defaults');
          }
        });
      });
    } catch (err) {
      findings.push('catalog: validator failed: ' + (err && err.message ? err.message : String(err)));
    }
    return findings;
  }

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
        note: 'Compares one position, size, or speed value of an object against a number. Example: Y >= 500 fires when the object drops below Y 500.',
        color: '#0f766e',
        cellLabel: 'Pos?',
        defaults: { type: 'positionCheck', targetObject: '', property: 'posY', operator: '>=', value: 500, reversed: false },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'property', label: 'Property', control: 'select', options: [['posX', 'X position'], ['posY', 'Y position'], ['velX', 'Velocity X'], ['velY', 'Velocity Y'], ['width', 'Width'], ['height', 'Height'], ['rotation', 'Rotation'], ['scaleX', 'Scale X'], ['scaleY', 'Scale Y'], ['textLength', 'Text length']] },
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
        note: 'Counts how many live objects share a name and compares the count. Example: count of Coin == 0 fires when the last coin is collected.',
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
        note: 'Compares an object speed or velocity component against a number. Example: Speed >= 1 fires while the object is moving.',
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
        note: 'True while the named object is shown. Invert it to check that an object is hidden.',
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
        note: 'Fires when the player clicks the named object. Pick the mouse button in the block settings.',
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
        category: 'Input',
        blockType: 'action-input-condition',
        runtimeType: 'actionInput',
        kind: 'condition',
        label: 'Action Input',
        color: '#0284c7',
        cellLabel: 'Action?',
        defaults: { type: 'actionInput', actionName: '', inputCondition: 'actionHeld', reversed: false },
        fields: [
          { key: 'actionName', label: 'Action', control: 'action' },
          { key: 'inputCondition', label: 'When', control: 'select', options: [['actionHeld', 'Held'], ['actionJustPressed', 'Just pressed'], ['actionReleased', 'Released']] },
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'Reads a named input action from the Inputs tab. One action can bind keyboard keys, a gamepad button, and a touch zone — so the same logic works on keyboard, gamepad, and touchscreen.'
      },
      {
        category: 'Input',
        blockType: 'remap-action',
        runtimeType: 'remapAction',
        kind: 'action',
        label: 'Remap Action',
        color: '#0284c7',
        cellLabel: 'Remap',
        defaults: { type: 'remapAction', actionName: '', newKey: 'Space' },
        fields: [
          { key: 'actionName', label: 'Action', control: 'action' },
          { key: 'newKey', label: 'New key', control: 'text', placeholder: 'Space' }
        ],
        note: 'Changes the keyboard binding of a named action while the game runs — the building block for a settings / controls menu. Use Reset Action Bindings to restore the defaults.'
      },
      {
        category: 'Input',
        blockType: 'reset-action-bindings',
        runtimeType: 'resetActionBindings',
        kind: 'action',
        label: 'Reset Action Bindings',
        color: '#0284c7',
        cellLabel: 'Reset keys',
        defaults: { type: 'resetActionBindings' },
        fields: [],
        note: 'Restores every input action to the key, gamepad, and touch bindings set in the Inputs tab.'
      },
      // P4 item 37 batch 7 (raw input blocks): the Input presets cover the
      // common keys and mouse buttons; these conditions cover the rest of
      // the keyboard, mouse, touch, and gamepad surface — cursor position,
      // any-key, raw touch state, and raw gamepad buttons/sticks. All are
      // state reads: they evaluate every frame and keep working while the
      // game is paused (like every other input condition).
      {
        category: 'Input',
        blockType: 'cursor-position',
        runtimeType: 'cursorPosition',
        kind: 'condition',
        label: 'Cursor Position',
        color: '#0284c7',
        cellLabel: 'Cursor',
        defaults: { type: 'cursorPosition', property: 'cursorX', operator: '>=', value: 0, reversed: false },
        fields: [
          { key: 'property', label: 'Property', control: 'select', options: [['cursorX', 'Cursor X'], ['cursorY', 'Cursor Y']] },
          { key: 'operator', label: 'Compare', control: 'select', options: [['>=', 'at least'], ['<=', 'at most'], ['==', 'equals'], ['!=', 'not equals'], ['>', 'greater than'], ['<', 'less than']] },
          { key: 'value', label: 'Value', control: expr, placeholder: '0' },
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'True when the mouse cursor position (in screen pixels) matches the comparison. Use it for cursor zones, screen edges, and aim-like checks without an object.'
      },
      // P4 item 3D3 (composable character controllers): pointer-lock mouse
      // control + per-frame mouse deltas, the mouse-look half of an FPS
      // controller. All four live in the Input category next to the other
      // raw mouse blocks.
      {
        category: 'Input',
        blockType: 'capture-mouse',
        runtimeType: 'captureMouse',
        kind: 'action',
        label: 'Capture Mouse',
        color: '#0284c7',
        cellLabel: 'CapMouse',
        defaults: { type: 'captureMouse' },
        fields: [],
        note: 'Locks the mouse pointer to the game (pointer lock) for FPS-style mouse-look: the cursor hides and mouse movement turns into deltas instead of screen position. Browsers only allow this from a real click, so run it from an Object Clicked or Mouse Click block — a "Click to play" button is the classic setup. Pressing Esc always releases the pointer.'
      },
      {
        category: 'Input',
        blockType: 'release-mouse',
        runtimeType: 'releaseMouse',
        kind: 'action',
        label: 'Release Mouse',
        color: '#0284c7',
        cellLabel: 'RelMouse',
        defaults: { type: 'releaseMouse' },
        fields: [],
        note: 'Releases the mouse pointer captured by Capture Mouse, so the cursor comes back for menus. (The player can also press Esc any time.)'
      },
      {
        category: 'Input',
        blockType: 'read-mouse-delta',
        runtimeType: 'readMouseDelta',
        kind: 'action',
        label: 'Read Mouse Delta',
        color: '#0284c7',
        cellLabel: 'MouseD',
        defaults: { type: 'readMouseDelta', dxVar: 'mdx', dyVar: 'mdy' },
        fields: [
          { key: 'dxVar', label: 'Into variable (dX)', control: 'text', placeholder: 'mdx' },
          { key: 'dyVar', label: 'Into variable (dY)', control: 'text', placeholder: 'mdy' }
        ],
        note: 'Copies this frame\u2019s mouse movement into two game variables — how far the mouse moved right (dX) and down (dY) since the last frame. While the pointer is captured this is raw mouse motion; otherwise it is cursor travel. Chain it after Every Frame, then steer a yaw variable: yaw = yaw + mdx * 0.25.'
      },
      {
        category: 'Input',
        blockType: 'mouse-pointer-captured',
        runtimeType: 'mousePointerCaptured',
        kind: 'condition',
        label: 'Mouse Pointer Captured',
        color: '#0284c7',
        cellLabel: 'Captured?',
        defaults: { type: 'mousePointerCaptured', reversed: false },
        fields: [
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'True while the mouse pointer is captured by Capture Mouse. Invert it to detect the player pressing Esc — the moment to show the pause menu and offer a "Click to resume" button.'
      },
      {
        category: 'Input',
        blockType: 'any-key-pressed',
        runtimeType: 'anyKeyPressed',
        kind: 'condition',
        label: 'Any Key Pressed',
        color: '#0284c7',
        cellLabel: 'Any key',
        defaults: { type: 'anyKeyPressed', reversed: false },
        fields: [
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'True while any keyboard key is held down. Invert it for "no key is pressed" — handy for attract-mode timers and "press any key to start".'
      },
      {
        category: 'Input',
        blockType: 'touch-active',
        runtimeType: 'touchActive',
        kind: 'condition',
        label: 'Touch Active',
        color: '#0284c7',
        cellLabel: 'Touch?',
        defaults: { type: 'touchActive', reversed: false },
        fields: [
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'True while at least one finger is touching the game. On desktop with no touchscreen it never fires; invert it for "no finger is down".'
      },
      {
        category: 'Input',
        blockType: 'touch-count',
        runtimeType: 'touchCount',
        kind: 'condition',
        label: 'Touch Count',
        color: '#0284c7',
        cellLabel: 'Touches',
        defaults: { type: 'touchCount', operator: '>=', value: 2, reversed: false },
        fields: [
          { key: 'operator', label: 'Compare', control: 'select', options: [['>=', 'at least'], ['<=', 'at most'], ['==', 'equals'], ['!=', 'not equals'], ['>', 'greater than'], ['<', 'less than']] },
          { key: 'value', label: 'Fingers', control: expr, placeholder: '2' },
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'True when the number of fingers touching the game matches the comparison. Use 2 for two-finger gestures like pinch or a second player.'
      },
      {
        category: 'Input',
        blockType: 'gamepad-connected',
        runtimeType: 'gamepadConnected',
        kind: 'condition',
        label: 'Gamepad Connected',
        color: '#0284c7',
        cellLabel: 'Pad?',
        defaults: { type: 'gamepadConnected', reversed: false },
        fields: [
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'True when at least one gamepad is connected. Browsers ask the player for permission the first time a game reads a gamepad, so this usually fires after the player presses a button once.'
      },
      {
        category: 'Input',
        blockType: 'gamepad-button',
        runtimeType: 'gamepadButton',
        kind: 'condition',
        label: 'Gamepad Button',
        color: '#0284c7',
        cellLabel: 'Pad btn',
        defaults: { type: 'gamepadButton', button: 0, when: 'held', reversed: false },
        fields: [
          { key: 'button', label: 'Button', control: 'select', options: [[0, 'A / Cross'], [1, 'B / Circle'], [2, 'X / Square'], [3, 'Y / Triangle'], [4, 'Left bumper (LB)'], [5, 'Right bumper (RB)'], [6, 'Left trigger (LT)'], [7, 'Right trigger (RT)'], [8, 'Back / Select'], [9, 'Start'], [10, 'Left stick click'], [11, 'Right stick click'], [12, 'D-pad up'], [13, 'D-pad down'], [14, 'D-pad left'], [15, 'D-pad right']] },
          { key: 'when', label: 'When', control: 'select', options: [['held', 'Held'], ['justPressed', 'Just pressed'], ['released', 'Released']] },
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'Reads a raw gamepad button without going through the Inputs tab. For the shared keyboard/gamepad/touch path, use Action Input with a named action instead.'
      },
      {
        category: 'Input',
        blockType: 'gamepad-stick',
        runtimeType: 'gamepadStick',
        kind: 'condition',
        label: 'Gamepad Stick',
        color: '#0284c7',
        cellLabel: 'Pad stick',
        defaults: { type: 'gamepadStick', stick: 'left', axis: 'x', operator: '>', value: 0.2, reversed: false },
        fields: [
          { key: 'stick', label: 'Stick', control: 'select', options: [['left', 'Left stick'], ['right', 'Right stick']] },
          { key: 'axis', label: 'Axis', control: 'select', options: [['x', 'X axis (left/right)'], ['y', 'Y axis (up/down)']] },
          { key: 'operator', label: 'Compare', control: 'select', options: [['>=', 'at least'], ['<=', 'at most'], ['==', 'equals'], ['!=', 'not equals'], ['>', 'greater than'], ['<', 'less than']] },
          { key: 'value', label: 'Value', control: expr, placeholder: '0.2' },
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'True when an analog stick axis matches the comparison (values run -1 to 1, 0 is centered). The default 0.2 ignores stick drift; compare against -0.2 with "less than" to read the other direction.'
      },
      {
        category: 'Audio',
        blockType: 'set-bus-volume',
        runtimeType: 'setBusVolume',
        kind: 'action',
        label: 'Set Bus Volume',
        color: '#d97706',
        cellLabel: 'Bus vol',
        defaults: { type: 'setBusVolume', bus: 'sfx', volume: 0.8 },
        fields: [
          { key: 'bus', label: 'Bus', control: 'select', options: [['music', 'Music'], ['sfx', 'SFX'], ['ui', 'UI']] },
          { key: 'volume', label: 'Volume (0-1)', control: 'number', min: 0, max: 1, step: 0.05 }
        ],
        note: 'Changes an audio bus volume while the game runs — fade the music out before a boss fight, duck the SFX in a menu. The Audio tab sets the starting volumes.'
      },
      {
        category: 'Audio',
        blockType: 'set-bus-muted',
        runtimeType: 'setBusMuted',
        kind: 'action',
        label: 'Set Bus Muted',
        color: '#d97706',
        cellLabel: 'Mute bus',
        defaults: { type: 'setBusMuted', bus: 'sfx', muted: true },
        fields: [
          { key: 'bus', label: 'Bus', control: 'select', options: [['music', 'Music'], ['sfx', 'SFX'], ['ui', 'UI']] },
          { key: 'muted', label: 'Muted', control: 'select', options: [[true, 'Muted'], [false, 'Unmuted']] }
        ],
        note: 'Mutes or unmutes an audio bus while the game runs — the building block for a settings-menu mute toggle.'
      },
      {
        category: 'Audio',
        blockType: 'stop-music',
        runtimeType: 'stopMusic',
        kind: 'action',
        label: 'Stop Music',
        color: '#d97706',
        cellLabel: 'Stop music',
        defaults: { type: 'stopMusic' },
        fields: [],
        note: 'Stops the track currently streaming on the Music bus. Playing a new track on the Music bus also replaces the old one.'
      },
      {
        category: 'Audio',
        blockType: 'pause-music',
        runtimeType: 'pauseMusic',
        kind: 'action',
        label: 'Pause Music',
        color: '#d97706',
        cellLabel: 'Pause music',
        defaults: { type: 'pauseMusic' },
        fields: [],
        note: 'Pauses the streaming music track, keeping its position — resume it with Resume Music. A music track played as a built-in tone (no audio file) cannot pause, so keep a tone track playing.'
      },
      {
        category: 'Audio',
        blockType: 'resume-music',
        runtimeType: 'resumeMusic',
        kind: 'action',
        label: 'Resume Music',
        color: '#d97706',
        cellLabel: 'Resume music',
        defaults: { type: 'resumeMusic' },
        fields: [],
        note: 'Continues a paused music track from where it stopped. Does nothing when no music is paused.'
      },
      {
        category: 'Audio',
        blockType: 'stop-all-sounds',
        runtimeType: 'stopAllSounds',
        kind: 'action',
        label: 'Stop All Sounds',
        color: '#d97706',
        cellLabel: 'Stop all',
        defaults: { type: 'stopAllSounds' },
        fields: [],
        note: 'Stops everything currently playing — the music track plus every SFX and UI sound still ringing out. The cutscene / scene-change silencer.'
      },
      {
        category: 'Audio',
        blockType: 'set-master-volume',
        runtimeType: 'setMasterVolume',
        kind: 'action',
        label: 'Set Master Volume',
        color: '#d97706',
        cellLabel: 'Master vol',
        defaults: { type: 'setMasterVolume', volume: 0.5 },
        fields: [
          { key: 'volume', label: 'Volume (0-1)', control: 'number', min: 0, max: 1, step: 0.05 }
        ],
        note: 'Sets the master fader that scales every bus at once — the single volume control for a settings menu. The Audio tab sets the starting level; per-bus volumes still apply underneath.'
      },
      {
        category: 'Audio',
        blockType: 'music-playing',
        runtimeType: 'musicPlaying',
        kind: 'condition',
        label: 'Music Playing',
        color: '#d97706',
        cellLabel: 'Music playing',
        defaults: { type: 'musicPlaying', reversed: false },
        fields: [
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'True while a music track is streaming on the Music bus (false when paused, stopped, or finished). Invert it to detect "the song ended" and start the next one.'
      },
      {
        category: 'Audio',
        blockType: 'play-sound-at-position',
        runtimeType: 'playSoundAtPosition',
        kind: 'action',
        label: 'Play Sound at Position',
        color: '#d97706',
        cellLabel: 'Sound at pos',
        defaults: { type: 'playSoundAtPosition', assetId: '', frequency: 440, duration: 0.2, waveform: 'square', atObject: '', posX: 0, posY: 0, maxDistance: 600, volume: 0.3, bus: 'sfx', pitch: 1 },
        fields: [
          { key: 'assetId', label: 'Sound', control: 'audio' },
          { key: 'frequency', label: 'Frequency (Hz)', control: expr, placeholder: '440' },
          { key: 'duration', label: 'Duration (s)', control: expr, placeholder: '0.2' },
          { key: 'waveform', label: 'Waveform', control: 'select', options: [['square', 'Square'], ['sine', 'Sine'], ['sawtooth', 'Sawtooth'], ['triangle', 'Triangle']] },
          { key: 'atObject', label: 'At object', control: obj },
          { key: 'posX', label: 'X (no object)', control: expr, placeholder: '0' },
          { key: 'posY', label: 'Y (no object)', control: expr, placeholder: '0' },
          { key: 'maxDistance', label: 'Hear within (px)', control: expr, placeholder: '600' },
          { key: 'volume', label: 'Volume (0-1)', control: 'number', min: 0, max: 1, step: 0.05 },
          { key: 'bus', label: 'Bus', control: 'select', options: [['music', 'Music'], ['sfx', 'SFX'], ['ui', 'UI']] },
          { key: 'pitch', label: 'Pitch (0.25-2)', control: 'number', min: 0.25, max: 2, step: 0.05 }
        ],
        note: 'Plays a tone or an uploaded sound from a place in the world — at an object, or at the X/Y point when no object is named. The listener is the center of the screen: the sound is full volume on top of it, fades to silent at the hear-within distance, and pans left or right with the source. Past that distance nothing plays. A missing object stays quiet. Upload audio in the Assets tab to play your own sounds.'
      },
      {
        category: 'Tilemap',
        blockType: 'set-tile',
        runtimeType: 'setTile',
        kind: 'action',
        label: 'Set Tile',
        color: '#b45309',
        cellLabel: 'Set tile',
        defaults: { type: 'setTile', targetObject: '', col: 0, row: 0, tile: 0 },
        fields: [
          { key: 'targetObject', label: 'Tilemap', control: obj },
          { key: 'col', label: 'Column', control: expr, placeholder: '0' },
          { key: 'row', label: 'Row', control: expr, placeholder: '0' },
          { key: 'tile', label: 'Tile (-1 clears)', control: expr, placeholder: '0' }
        ],
        note: 'Paints one cell of a tilemap while the game runs — build or destroy terrain, open doors, crumble platforms. Use -1 to clear a cell.'
      },
      {
        category: 'Tilemap',
        blockType: 'tile-solid-at-condition',
        runtimeType: 'tileSolidAt',
        kind: 'condition',
        label: 'Tile Solid At',
        color: '#b45309',
        cellLabel: 'Solid?',
        defaults: { type: 'tileSolidAt', targetObject: '', x: 0, y: 0, reversed: false },
        fields: [
          { key: 'targetObject', label: 'Tilemap', control: obj },
          { key: 'x', label: 'X (world)', control: expr, placeholder: 'hero.posX' },
          { key: 'y', label: 'Y (world)', control: expr, placeholder: 'hero.posY' },
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'True when the tile at the world position (X, Y) is solid — check what is ahead of the player before they get there.'
      },
      {
        category: 'Tilemap',
        blockType: 'standing-on-tile-condition',
        runtimeType: 'standingOnTile',
        kind: 'condition',
        label: 'Standing On Tile',
        color: '#b45309',
        cellLabel: 'Grounded?',
        defaults: { type: 'standingOnTile', targetObject: '', tilemapName: '', reversed: false },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'tilemapName', label: 'Tilemap', control: obj },
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'True when the object stands on a solid tile of the tilemap — the tile-aware grounded check for platformer jump logic.'
      },
      {
        category: 'Collision',
        blockType: 'on-floor-condition',
        runtimeType: 'onFloor',
        kind: 'condition',
        label: 'Is On Floor',
        note: 'True while the object rests on a floor, platform, or another object. Leave the platform blank to accept any surface below it.',
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
        note: 'Moves an object toward another object at the given speed and stops at the stop distance. Example: an enemy chasing the player.',
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
        note: 'Pushes an object away from another object in one burst. Add mode adds to its current speed, Set mode replaces it.',
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
        note: 'Stops an object movement on the X axis, the Y axis, or both. The object stays where it is.',
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
        note: 'Pushes two overlapping objects apart so they no longer touch. Choose which object moves.',
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
        category: 'Collision',
        blockType: 'trigger-enter-condition',
        runtimeType: 'triggerEnter',
        kind: 'condition',
        label: 'Trigger Enter',
        color: '#8b5cf6',
        cellLabel: 'Entered?',
        defaults: { type: 'triggerEnter', zoneObject: '', targetObject: '', reversed: false },
        fields: [
          { key: 'zoneObject', label: 'Trigger zone', control: obj },
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'Fires once, on the first frame the object starts touching a trigger zone — collect coins, open doors, start a cutscene.'
      },
      {
        category: 'Collision',
        blockType: 'trigger-exit-condition',
        runtimeType: 'triggerExit',
        kind: 'condition',
        label: 'Trigger Exit',
        color: '#8b5cf6',
        cellLabel: 'Exited?',
        defaults: { type: 'triggerExit', zoneObject: '', targetObject: '', reversed: false },
        fields: [
          { key: 'zoneObject', label: 'Trigger zone', control: obj },
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'Fires once, on the first frame the object stops touching a trigger zone — leaving a safe area, walking out of a light cone.'
      },
      {
        category: 'Collision',
        blockType: 'raycast-hit-condition',
        runtimeType: 'raycastHit',
        kind: 'condition',
        label: 'Raycast Hit',
        color: '#8b5cf6',
        cellLabel: 'Ray hit?',
        defaults: { type: 'raycastHit', fromX: 0, fromY: 0, toX: 400, toY: 300, layerMask: 255, reversed: false },
        fields: [
          { key: 'fromX', label: 'From X', control: expr, placeholder: 'hero.posX' },
          { key: 'fromY', label: 'From Y', control: expr, placeholder: 'hero.posY' },
          { key: 'toX', label: 'To X', control: expr, placeholder: '400 or mouseX' },
          { key: 'toY', label: 'To Y', control: expr, placeholder: '600' },
          { key: 'layerMask', label: 'Layers (mask)', control: expr, placeholder: '255 = all' },
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'Shoots an invisible line and answers whether it hits any collider — line of sight, laser guns, "is there ground below me?".'
      },
      {
        category: 'Collision',
        blockType: 'overlap-check-condition',
        runtimeType: 'overlapCheck',
        kind: 'condition',
        label: 'Objects Overlapping',
        color: '#8b5cf6',
        cellLabel: 'Overlap?',
        defaults: { type: 'overlapCheck', x: 400, y: 300, radius: 48, layerMask: 255, reversed: false },
        fields: [
          { key: 'x', label: 'Center X', control: expr, placeholder: 'hero.posX' },
          { key: 'y', label: 'Center Y', control: expr, placeholder: 'hero.posY' },
          { key: 'radius', label: 'Radius', control: expr, placeholder: '48' },
          { key: 'layerMask', label: 'Layers (mask)', control: expr, placeholder: '255 = all' },
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'True when any collider overlaps the circle — explosion blast radius, pickup magnets, proximity checks.'
      },
      {
        category: 'Collision',
        blockType: 'set-collision-layer-action',
        runtimeType: 'setCollisionLayer',
        kind: 'action',
        label: 'Set Collision Layer',
        color: '#8b5cf6',
        cellLabel: 'Set Layer',
        defaults: { type: 'setCollisionLayer', targetObject: '', layer: 0, mask: 255 },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'layer', label: 'Layer', control: expr, placeholder: '0-7' },
          { key: 'mask', label: 'Collides with (mask)', control: expr, placeholder: '255 = all' }
        ],
        note: 'Moves an object to a collision layer at runtime — ghost power-ups that pass through walls, team-based friendly fire.'
      },
      // P4 item 37 batch 8 (physics queries): object-to-object spatial
      // questions answered by the new HydraPhysics2D query helpers. All
      // four are state reads (positions/velocities), so they default to the
      // 'level' trigger mode and evaluate while paused.
      {
        category: 'Collision',
        blockType: 'angle-between-condition',
        runtimeType: 'angleBetween',
        kind: 'condition',
        label: 'Angle Between',
        color: '#8b5cf6',
        cellLabel: 'Angle?',
        defaults: { type: 'angleBetween', object1: '', object2: '', operator: '>=', value: 0, reversed: false },
        fields: [
          { key: 'object1', label: 'From object', control: obj },
          { key: 'object2', label: 'To object', control: obj },
          { key: 'operator', label: 'Compare', control: 'select', options: [['>=', 'at least'], ['<=', 'at most'], ['==', 'equals'], ['!=', 'not equals'], ['>', 'greater than'], ['<', 'less than']] },
          { key: 'value', label: 'Degrees', control: expr, placeholder: '0' },
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'Angle in degrees from the first object to the second (0 = right, 90 = down, -90 = up). Turret aiming, "is the enemy behind me?".'
      },
      {
        category: 'Collision',
        blockType: 'line-of-sight-condition',
        runtimeType: 'lineOfSight',
        kind: 'condition',
        label: 'Line of Sight',
        color: '#8b5cf6',
        cellLabel: 'Sight?',
        defaults: { type: 'lineOfSight', object1: '', object2: '', layerMask: 255, reversed: false },
        fields: [
          { key: 'object1', label: 'From object', control: obj },
          { key: 'object2', label: 'To object', control: obj },
          { key: 'layerMask', label: 'Layers (mask)', control: expr, placeholder: '255 = all' },
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'True when no collider blocks the straight line between the two objects — enemy vision cones, "can the guard see me?".'
      },
      {
        category: 'Collision',
        blockType: 'nearest-distance-condition',
        runtimeType: 'nearestDistance',
        kind: 'condition',
        label: 'Distance To Nearest',
        color: '#8b5cf6',
        cellLabel: 'Near Dist',
        defaults: { type: 'nearestDistance', object1: '', targetObject: '', operator: '<=', value: 100, reversed: false },
        fields: [
          { key: 'object1', label: 'Object', control: obj },
          { key: 'targetObject', label: 'Nearest', control: obj },
          { key: 'operator', label: 'Compare', control: 'select', options: [['>=', 'at least'], ['<=', 'at most'], ['==', 'equals'], ['!=', 'not equals'], ['>', 'greater than'], ['<', 'less than']] },
          { key: 'value', label: 'Distance', control: expr, placeholder: '100' },
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'Distance from the object to the closest object with the named group — enemy AI aggro range, nearest-coin highlight. False when none exist.'
      },
      {
        category: 'Collision',
        blockType: 'moving-towards-condition',
        runtimeType: 'movingTowards',
        kind: 'condition',
        label: 'Moving Towards',
        color: '#8b5cf6',
        cellLabel: 'Toward?',
        defaults: { type: 'movingTowards', object1: '', object2: '', minSpeed: 1, reversed: false },
        fields: [
          { key: 'object1', label: 'Object', control: obj },
          { key: 'object2', label: 'Towards', control: obj },
          { key: 'minSpeed', label: 'Min speed', control: expr, placeholder: '1' },
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'True when the object is moving toward the other — chasing enemies, homing missiles, "am I approaching the landing pad?".'
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
        note: 'Moves an object instantly to an X and Y position. Example: X 400, Y 300 puts it near the middle of an 800 by 600 world.',
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
        note: 'Creates a copy of one object at the position of another, plus an optional offset. Example: spawn a bullet at the player.',
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
        note: 'Keeps an object inside the world edges instead of letting it leave. Turn on Bounce to make it rebound off the edge.',
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
        note: 'Teleports an object to the opposite world edge when it leaves one side, like classic arcade wrap-around.',
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
        note: 'Deletes an object once it travels past the world edge by the margin you set. Use it to clean up bullets and stray enemies.',
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
        note: 'Sets how strongly gravity pulls an object down each frame. Use 0 for a floating object and a negative value to make it rise.',
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
        note: 'Caps how fast an object can move, so a long fall or a big push cannot send it flying out of control.',
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
        note: 'Sets how much speed an object keeps when it bounces off a surface. 0 stops dead, 1 bounces back at full speed.',
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
        note: 'Turns physics on or off for an object. With physics off, the object still draws but no longer falls or collides.',
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
        note: 'Makes an object static, like a wall or floor that never moves, or dynamic, a body that physics can push around.',
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
        note: 'Sets how much speed an object keeps while sliding. Near 1 slides far like ice, lower values stop it sooner.',
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
        note: 'Reloads the current scene from the beginning, putting every object back where it started.',
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
        note: 'Switches to the next scene in the scene list, for example the next level.',
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
        note: 'Switches to the previous scene in the scene list, for example back to the menu.',
        color: '#059669',
        cellLabel: 'Prev',
        defaults: { type: 'previousScene' },
        fields: []
      },
      {
        category: 'Scene',
        blockType: 'push-scene',
        runtimeType: 'pushScene',
        kind: 'action',
        label: 'Push Scene',
        color: '#059669',
        cellLabel: 'Push',
        defaults: { type: 'pushScene', sceneId: null },
        fields: [
          { key: 'sceneId', label: 'Scene to show', control: 'scene' }
        ],
        note: 'Switches to the scene but remembers where you came from: Pop Scene returns to this scene. Build pause menus, settings screens, and pop-up dialogs as scenes. Like every scene change, the switch happens at the end of the frame; up to 16 scenes can be stacked.'
      },
      {
        category: 'Scene',
        blockType: 'pop-scene',
        runtimeType: 'popScene',
        kind: 'action',
        label: 'Pop Scene',
        color: '#059669',
        cellLabel: 'Pop',
        defaults: { type: 'popScene' },
        fields: [],
        note: 'Returns to the scene that Push Scene came from. Does nothing when no scene was pushed.'
      },
      {
        category: 'Scene',
        blockType: 'set-scene-background',
        runtimeType: 'setSceneBackground',
        kind: 'action',
        label: 'Set Scene Background',
        color: '#059669',
        cellLabel: 'Bg',
        defaults: { type: 'setSceneBackground', color: '#1e1b4b' },
        fields: [
          { key: 'color', label: 'Background color', control: 'color' }
        ],
        note: 'Recolors the current scene behind everything, right away. A scene background image, when one is set, still draws on top of the color.'
      },
      {
        category: 'Storage',
        blockType: 'save-variable',
        runtimeType: 'saveVariable',
        kind: 'action',
        label: 'Save Variable',
        note: 'Saves one game variable into the browser save slot so it survives after the game closes. Example: save bestScore after a win.',
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
        note: 'Reads a saved variable back into the game. If nothing was saved yet, the variable keeps its current value.',
        color: '#64748b',
        cellLabel: 'Load Var',
        defaults: { type: 'loadVariable', varName: 'bestScore', saveKey: 'bestScore' },
        fields: [
          { key: 'varName', label: 'Variable', control: 'text', placeholder: 'bestScore' },
          { key: 'saveKey', label: 'Key', control: 'text', placeholder: 'bestScore' }
        ]
      },
      {
        category: 'Storage',
        blockType: 'save-game',
        runtimeType: 'saveGame',
        kind: 'action',
        label: 'Save Game',
        color: '#0d9488',
        cellLabel: 'Save Game',
        defaults: { type: 'saveGame', slotName: 'Slot 1' },
        fields: [
          { key: 'slotName', label: 'Slot name', control: 'text', placeholder: 'Slot 1' }
        ],
        note: 'Saves ALL game variables into a named save slot (your browser\u2019s memory card). Use it for progress, unlocked levels, and high scores. Works in the preview and in exported games.'
      },
      {
        category: 'Storage',
        blockType: 'load-game',
        runtimeType: 'loadGame',
        kind: 'action',
        label: 'Load Game',
        color: '#0d9488',
        cellLabel: 'Load Game',
        defaults: { type: 'loadGame', slotName: 'Slot 1' },
        fields: [
          { key: 'slotName', label: 'Slot name', control: 'text', placeholder: 'Slot 1' }
        ],
        note: 'Restores all variables saved in the named slot. Does nothing if the slot is empty \u2014 pair it with Save Slot Exists to check first.'
      },
      {
        category: 'Storage',
        blockType: 'delete-save',
        runtimeType: 'deleteSaveSlot',
        kind: 'action',
        label: 'Delete Save',
        color: '#64748b',
        cellLabel: 'Del Save',
        defaults: { type: 'deleteSaveSlot', slotName: 'Slot 1' },
        fields: [
          { key: 'slotName', label: 'Slot name', control: 'text', placeholder: 'Slot 1' }
        ],
        note: 'Clears the named save slot. Use it for a \u201cNew Game\u201d button that wipes old progress.'
      },
      {
        category: 'Storage',
        blockType: 'save-slot-exists-condition',
        runtimeType: 'saveSlotExists',
        kind: 'condition',
        label: 'Save Slot Exists',
        color: '#0d9488',
        cellLabel: 'Save?',
        defaults: { type: 'saveSlotExists', slotName: 'Slot 1', reversed: false },
        fields: [
          { key: 'slotName', label: 'Slot name', control: 'text', placeholder: 'Slot 1' },
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'True when the named slot holds a saved game. Great on a title screen: saved game found \u2192 show Continue; no save \u2192 show New Game.'
      },
      {
        category: 'Game Flow',
        blockType: 'pause-game',
        runtimeType: 'pauseGame',
        kind: 'action',
        label: 'Pause Game',
        color: '#ea580c',
        cellLabel: 'Pause',
        defaults: { type: 'pauseGame' },
        fields: [],
        note: 'Freezes the game world: objects stop moving, animations and timers stop, but the game keeps drawing and buttons still work. Show your pause menu right after it.'
      },
      {
        category: 'Game Flow',
        blockType: 'resume-game',
        runtimeType: 'resumeGame',
        kind: 'action',
        label: 'Resume Game',
        color: '#ea580c',
        cellLabel: 'Resume',
        defaults: { type: 'resumeGame' },
        fields: [],
        note: 'Unfreezes the game world exactly where it paused. Put it on your Resume button: Object Clicked \u2192 Resume Game, then hide the pause menu.'
      },
      {
        category: 'Game Flow',
        blockType: 'toggle-pause',
        runtimeType: 'togglePause',
        kind: 'action',
        label: 'Toggle Pause',
        color: '#ea580c',
        cellLabel: 'Pause?',
        defaults: { type: 'togglePause' },
        fields: [],
        note: 'Pauses if running, resumes if paused \u2014 one block for a pause key. Pair it with Game Paused to show or hide the menu.'
      },
      {
        category: 'Game Flow',
        blockType: 'game-paused-condition',
        runtimeType: 'gamePaused',
        kind: 'condition',
        label: 'Game Paused',
        color: '#ea580c',
        cellLabel: 'Paused?',
        defaults: { type: 'gamePaused', reversed: false },
        fields: [
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'True while the game is paused. Use it to show the pause menu, and invert it to gate gameplay actions so they only run while unpaused.'
      },
      {
        category: 'Game Flow',
        blockType: 'show-profiler',
        runtimeType: 'showProfiler',
        kind: 'action',
        label: 'Show Profiler',
        color: '#ea580c',
        cellLabel: 'Show Prof',
        defaults: { type: 'showProfiler' },
        fields: [],
        note: 'Shows the profiling overlay: FPS, frame time, and how many sprites, 3D triangles, particles, and objects the game drew this frame. Use it while playtesting to spot slow scenes.'
      },
      {
        category: 'Game Flow',
        blockType: 'hide-profiler',
        runtimeType: 'hideProfiler',
        kind: 'action',
        label: 'Hide Profiler',
        color: '#ea580c',
        cellLabel: 'Hide Prof',
        defaults: { type: 'hideProfiler' },
        fields: [],
        note: 'Hides the profiling overlay again. Your players never need to see it, so turn it off before you share the game.'
      },
      {
        category: 'Game Flow',
        blockType: 'toggle-profiler',
        runtimeType: 'toggleProfiler',
        kind: 'action',
        label: 'Toggle Profiler',
        color: '#ea580c',
        cellLabel: 'Prof?',
        defaults: { type: 'toggleProfiler' },
        fields: [],
        note: 'Shows the overlay if hidden, hides it if shown \u2014 one block for a debug key. Pair it with Key Just Pressed so F3 flips the overlay on and off.'
      },
      {
        category: 'Game Flow',
        blockType: 'profiler-visible-condition',
        runtimeType: 'profilerVisible',
        kind: 'condition',
        label: 'Profiler Visible',
        color: '#ea580c',
        cellLabel: 'Prof On?',
        defaults: { type: 'profilerVisible', reversed: false },
        fields: [
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'True while the profiling overlay is on screen. Invert it to run debug actions only while the overlay is hidden.'
      },
      {
        category: 'Game Flow',
        blockType: 'timer-elapsed-condition',
        runtimeType: 'timerElapsed',
        kind: 'condition',
        label: 'Timer Elapsed',
        color: '#ea580c',
        cellLabel: 'Time?',
        defaults: { type: 'timerElapsed', timerName: 'timer', operator: '>=', seconds: 5, reversed: false },
        fields: [
          { key: 'timerName', label: 'Timer name', control: 'text', placeholder: 'spawnTimer' },
          { key: 'operator', label: 'Compare', control: 'select', options: [['>=', 'At least (elapsed >=)'], ['<=', 'At most (elapsed <=)'], ['==', 'Exactly (elapsed ==)'], ['!=', 'Not (elapsed !=)'], ['>', 'More than (elapsed >)'], ['<', 'Less than (elapsed <)']] },
          { key: 'seconds', label: 'Seconds', control: expr, placeholder: '5 or waveDelay' },
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'True while the named timer\u2019s elapsed time compares against the seconds you enter. The timer holds its elapsed time while the game is paused. A timer that was never started reads as 0 seconds.'
      },
      {
        category: 'Game Flow',
        blockType: 'read-timer-action',
        runtimeType: 'readTimer',
        kind: 'action',
        label: 'Read Timer',
        color: '#ea580c',
        cellLabel: 'ReadT',
        defaults: { type: 'readTimer', timerName: 'timer', varName: 'elapsed' },
        fields: [
          { key: 'timerName', label: 'Timer name', control: 'text', placeholder: 'spawnTimer' },
          { key: 'varName', label: 'Into variable', control: 'text', placeholder: 'elapsed' }
        ],
        note: 'Copies the named timer\u2019s elapsed seconds into a game variable, so you can show a countdown, compare times, or do math with them. A timer that was never started reads as 0.'
      },
      {
        category: 'Code',
        blockType: 'run-script',
        runtimeType: 'runScript',
        kind: 'action',
        label: 'Run Script',
        color: '#9333ea',
        cellLabel: 'Script',
        defaults: { type: 'runScript', code: '' },
        fields: [
          { key: 'code', label: 'JavaScript code', control: 'textarea', rows: 6, placeholder: 'hs.obj(\'hero\').move(3, 0);' }
        ],
        note: 'Runs your own JavaScript with the hs scripting API, the power-user shortcut for logic that would take many blocks. Try hs.get/hs.set for variables, hs.obj(\'name\') to move or change objects, hs.input(\'Jump\').pressed for input, and hs.play(\'coin\') for sound. The full API is in the user guide under \u201CText scripting\u201D. Errors show in the diagnostics panel and never break the game. Only open projects with scripts from people you trust \u2014 script code runs as real JavaScript.'
      },
      {
        category: 'Code',
        blockType: 'script-check',
        runtimeType: 'scriptCheck',
        kind: 'condition',
        label: 'Script Check',
        color: '#9333ea',
        cellLabel: 'JS?',
        defaults: { type: 'scriptCheck', code: '', reversed: false },
        fields: [
          { key: 'code', label: 'JavaScript (true/false)', control: 'textarea', rows: 4, placeholder: 'hs.get(\'score\') > 10' },
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'True when your JavaScript reads as true. Write an expression like hs.get(\'score\') > 10, or full statements with a return. Fires once when it becomes true (flip the Trigger dropdown to \u201CWhile true\u201D to run every frame). Errors read as false and show in the diagnostics panel. Only open projects with scripts from people you trust \u2014 script code runs as real JavaScript.'
      },
      {
        category: 'Particles',
        blockType: 'emit-burst',
        runtimeType: 'emitBurst',
        kind: 'action',
        label: 'Emit Burst',
        color: '#ec4899',
        cellLabel: 'Burst',
        defaults: { type: 'emitBurst', preset: 'explosion', x: '0', y: '0', count: 40,
          speed: 320, spread: 360, direction: 0, lifetime: 0.7, size0: 10, size1: 2,
          color0: '#fbbf24', color1: '#ef4444', gravity: 500, shape: 'circle', additive: true },
        fields: [],
        note: 'Fires a one-shot burst of particles: an explosion, sparkle, smoke puff, confetti, or your own custom burst. Pick a preset, then tweak the fields.'
      },
      {
        category: 'Particles',
        blockType: 'start-emitter',
        runtimeType: 'startEmitter',
        kind: 'action',
        label: 'Start Emitter',
        color: '#db2777',
        cellLabel: 'Emitter',
        defaults: { type: 'startEmitter', emitterName: 'fx', followObject: '', preset: 'fire',
          rate: 60, x: '0', y: '0', speed: 90, spread: 25, direction: 270, lifetime: 1.1,
          size0: 14, size1: 4, color0: '#fb923c', color1: '#ef4444', gravity: -80,
          shape: 'circle', additive: true },
        fields: [],
        note: 'Starts a continuous particle emitter (fire, rain, snow, a magic trail...). Give it a name; set Follow object to make it track an object, like a rocket trail.'
      },
      {
        category: 'Particles',
        blockType: 'stop-emitter',
        runtimeType: 'stopEmitter',
        kind: 'action',
        label: 'Stop Emitter',
        color: '#be185d',
        cellLabel: 'Stop Fx',
        defaults: { type: 'stopEmitter', emitterName: '' },
        fields: [
          { key: 'emitterName', label: 'Emitter name (blank = all)', control: 'text', placeholder: 'fx' }
        ],
        note: 'Stops a running emitter by name. Leave the name blank to stop every emitter. Particles already in flight finish their lifetimes.'
      },
      {
        category: 'Particles',
        blockType: 'clear-particles',
        runtimeType: 'clearParticles',
        kind: 'action',
        label: 'Clear Particles',
        color: '#9d174d',
        cellLabel: 'Clear Fx',
        defaults: { type: 'clearParticles', emitterName: '' },
        fields: [
          { key: 'emitterName', label: 'Emitter name (blank = everything)', control: 'text', placeholder: 'fx' }
        ],
        note: 'Removes live particles instantly: one emitter\'s, or everything when the name is blank. Emitters keep running unless you also stop them.'
      },
      {
        category: 'Object',
        blockType: 'set-color',
        runtimeType: 'setColor',
        kind: 'action',
        label: 'Set Color',
        note: 'Tints an object with a color. Example: #ffcc00 paints it gold.',
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
        note: 'Sets how see-through an object is, from 0 (invisible) to 1 (fully solid).',
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
        note: 'Sets the draw layer of an object. Higher layers draw on top of lower ones.',
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
        blockType: 'flip-object',
        runtimeType: 'flipObject',
        kind: 'action',
        label: 'Flip Object',
        color: '#a855f7',
        cellLabel: 'Flip',
        defaults: { type: 'flipObject', targetObject: '', direction: 'horizontal' },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'direction', label: 'Direction', control: 'select', options: [['horizontal', 'Flip horizontal'], ['vertical', 'Flip vertical'], ['both', 'Flip both'], ['off', 'Unflip (face original way)']] }
        ],
        note: 'Mirrors the object, like a character turning around when it walks left. Unflip restores the original facing. Flip changes only how the object looks; its size and collision stay the same.'
      },
      {
        category: 'Object',
        blockType: 'set-scale',
        runtimeType: 'setScale',
        kind: 'action',
        label: 'Set Scale',
        color: '#a855f7',
        cellLabel: 'Scale',
        defaults: { type: 'setScale', targetObject: '', scaleX: 1, scaleY: 1 },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'scaleX', label: 'Scale X', control: expr, placeholder: '1' },
          { key: 'scaleY', label: 'Scale Y', control: expr, placeholder: '1' }
        ],
        note: 'Scales how big the object looks: 1 is normal, 2 is twice as big, 0.5 is half. Scale changes only the drawing, not the collision box — the hitbox keeps using the object\u2019s width and height, so use Set Size when the collision must change too.'
      },
      // P4 item 37 (block expansion, batch 12: layers and effects). Draw
      // order is already a per-object number (Set Layer writes an absolute
      // value); these four actions manage relative ordering, and the four
      // effect actions restyle how an object draws (blend mode, drop
      // shadow, pixel filter) — all drawing-only, like flip/scale.
      {
        category: 'Object',
        blockType: 'bring-to-front',
        runtimeType: 'bringToFront',
        kind: 'action',
        label: 'Bring to Front',
        color: '#a855f7',
        cellLabel: 'To Front',
        defaults: { type: 'bringToFront', targetObject: '' },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj }
        ],
        note: 'Moves the object above every other live object in draw order (its layer becomes the highest layer + 1). The classic way to make a dragged card, an active player, or a popup land on top.'
      },
      {
        category: 'Object',
        blockType: 'send-to-back',
        runtimeType: 'sendToBack',
        kind: 'action',
        label: 'Send to Back',
        color: '#a855f7',
        cellLabel: 'To Back',
        defaults: { type: 'sendToBack', targetObject: '' },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj }
        ],
        note: 'Moves the object below every other live object in draw order (its layer becomes the lowest layer - 1). Put a background prop behind everything else without hunting for the right layer number.'
      },
      {
        category: 'Object',
        blockType: 'move-layer-up',
        runtimeType: 'moveLayerUp',
        kind: 'action',
        label: 'Move Up a Layer',
        color: '#a855f7',
        cellLabel: 'Layer +',
        defaults: { type: 'moveLayerUp', targetObject: '', steps: 1 },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'steps', label: 'Steps', control: expr, placeholder: '1' }
        ],
        note: 'Raises the object\u2019s draw layer by the given steps (default 1), so it draws over whatever sat just above it. Handy when objects shuffle order often, like stacked cards or inventory slots.'
      },
      {
        category: 'Object',
        blockType: 'move-layer-down',
        runtimeType: 'moveLayerDown',
        kind: 'action',
        label: 'Move Down a Layer',
        color: '#a855f7',
        cellLabel: 'Layer -',
        defaults: { type: 'moveLayerDown', targetObject: '', steps: 1 },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'steps', label: 'Steps', control: expr, placeholder: '1' }
        ],
        note: 'Lowers the object\u2019s draw layer by the given steps (default 1), so whatever was just below it now draws on top.'
      },
      {
        category: 'Object',
        blockType: 'layer-check-condition',
        runtimeType: 'layerCheck',
        kind: 'condition',
        label: 'Layer Check',
        color: '#a855f7',
        cellLabel: 'Layer?',
        defaults: { type: 'layerCheck', targetObject: '', operator: '>=', value: 1, reversed: false },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'operator', label: 'Compare', control: 'select', options: [['>=', 'at least'], ['<=', 'at most'], ['==', 'equals'], ['!=', 'not equals'], ['>', 'greater than'], ['<', 'less than']] },
          { key: 'value', label: 'Layer', control: expr, placeholder: '1' },
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'True when a live object with the given name has a draw layer matching the comparison — for example, ask whether the card is already above the table (Layer at least 5).'
      },
      // P4 item 3D1 (3D rendering foundation, batch 1): the first 3D blocks.
      // 3D blocks work on the object's CENTER (posX + w/2, posY + h/2, z);
      // y grows down like the 2D canvas, z grows toward the viewer.
      {
        category: '3D',
        blockType: 'move-3d',
        runtimeType: 'move3d',
        kind: 'action',
        label: 'Move 3D',
        color: '#0ea5e9',
        cellLabel: 'Move3D',
        defaults: { type: 'move3d', targetObject: '', dX: 0, dY: 0, dZ: 0 },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'dX', label: 'dX', control: expr, placeholder: '0' },
          { key: 'dY', label: 'dY', control: expr, placeholder: '0' },
          { key: 'dZ', label: 'dZ (toward viewer)', control: expr, placeholder: '0' }
        ],
        note: 'Moves the 3D object by the given amounts: dX right, dY down (like the 2D canvas), dZ toward the viewer. Chain it after an Every Frame block for smooth 3D motion.'
      },
      {
        category: '3D',
        blockType: 'set-3d-position',
        runtimeType: 'set3dPosition',
        kind: 'action',
        label: 'Set 3D Position',
        color: '#0ea5e9',
        cellLabel: 'Pos3D',
        defaults: { type: 'set3dPosition', targetObject: '', x: 400, y: 300, z: 0 },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'x', label: 'X (center)', control: expr, placeholder: '400' },
          { key: 'y', label: 'Y (center)', control: expr, placeholder: '300' },
          { key: 'z', label: 'Z (toward viewer)', control: expr, placeholder: '0' }
        ],
        note: 'Teleports the CENTER of the 3D object to X/Y/Z. Y grows down like the 2D canvas; Z 0 is the screen plane and positive Z comes toward the viewer.'
      },
      {
        category: '3D',
        blockType: 'set-3d-rotation',
        runtimeType: 'set3dRotation',
        kind: 'action',
        label: 'Set 3D Rotation',
        color: '#0ea5e9',
        cellLabel: 'Rot3D',
        defaults: { type: 'set3dRotation', targetObject: '', rotX: 0, rotY: 0, rotZ: 0 },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'rotX', label: 'Rot X (degrees)', control: expr, placeholder: '0' },
          { key: 'rotY', label: 'Rot Y (degrees)', control: expr, placeholder: '0' },
          { key: 'rotZ', label: 'Rot Z (degrees)', control: expr, placeholder: '0' }
        ],
        note: 'Sets the absolute rotation of the 3D object in degrees, about its center. Rot X tips it forward/back, Rot Y spins it like a turntable, Rot Z rolls it like a 2D rotation.'
      },
      {
        category: '3D',
        blockType: 'rotate-3d',
        runtimeType: 'rotate3d',
        kind: 'action',
        label: 'Rotate 3D',
        color: '#0ea5e9',
        cellLabel: 'Spin3D',
        defaults: { type: 'rotate3d', targetObject: '', rotX: 0, rotY: 5, rotZ: 0 },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'rotX', label: 'Rot X (degrees)', control: expr, placeholder: '0' },
          { key: 'rotY', label: 'Rot Y (degrees)', control: expr, placeholder: '5' },
          { key: 'rotZ', label: 'Rot Z (degrees)', control: expr, placeholder: '0' }
        ],
        note: 'Adds degrees to the 3D object\u2019s rotation. Chain it after an Every Frame block (Rot Y 2) for a smooth turntable spin — the classic 3D showcase.'
      },
      // P4 item 3D2 (3D assets, batch 1): runtime control over the model
      // material tint set in the Inspector.
      {
        category: '3D',
        blockType: 'set-model-tint',
        runtimeType: 'setModelTint',
        kind: 'action',
        label: 'Set Model Tint',
        color: '#0ea5e9',
        cellLabel: 'Tint3D',
        defaults: { type: 'setModelTint', targetObject: '', color: '#ff0000' },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'color', label: 'Tint color', control: 'color' }
        ],
        note: 'Tints the 3D model\u2019s material colors with the picked color — white means no tint, so the model shows its own colors. Flash a model red when it takes a hit, or fade it blue underwater. Also tints 3D primitives.'
      },
      {
        category: '3D',
        blockType: 'use-model-texture',
        runtimeType: 'useModelTexture',
        kind: 'action',
        label: 'Use Model Texture',
        color: '#0ea5e9',
        cellLabel: 'Tex3D',
        defaults: { type: 'useModelTexture', targetObject: '', mode: 'on' },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'mode', label: 'Texture', control: 'select', options: [['on', 'On'], ['off', 'Off']] }
        ],
        note: 'Switches a 3D model\u2019s texture on or off at runtime. On shows the model\u2019s own skin (textures come with the .glb upload); Off shows its flat material colors instead. Has no effect on models without textures.'
      },
      {
        category: '3D',
        blockType: 'set-3d-camera',
        runtimeType: 'set3dCamera',
        kind: 'action',
        label: 'Set 3D Camera',
        color: '#0ea5e9',
        cellLabel: 'Cam3D',
        defaults: { type: 'set3dCamera', camX: 400, camY: 300, camZ: 900, lookX: 400, lookY: 300, lookZ: 0 },
        fields: [
          { key: 'camX', label: 'Camera X', control: expr, placeholder: '400' },
          { key: 'camY', label: 'Camera Y', control: expr, placeholder: '300' },
          { key: 'camZ', label: 'Camera Z', control: expr, placeholder: '900' },
          { key: 'lookX', label: 'Look X', control: expr, placeholder: '400' },
          { key: 'lookY', label: 'Look Y', control: expr, placeholder: '300' },
          { key: 'lookZ', label: 'Look Z', control: expr, placeholder: '0' }
        ],
        note: 'Moves the 3D camera and aims it at the look-at point. The default camera already frames the whole scene — use this for dramatic angles and fly-bys. It also ends any Follow 3D Object in progress.'
      },
      {
        category: '3D',
        blockType: 'follow-3d-camera',
        runtimeType: 'follow3dCamera',
        kind: 'action',
        label: 'Follow 3D Object',
        color: '#0ea5e9',
        cellLabel: 'Follow3D',
        defaults: { type: 'follow3dCamera', targetObject: '', offX: 0, offY: -60, offZ: 280 },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'offX', label: 'Offset X (right)', control: expr, placeholder: '0' },
          { key: 'offY', label: 'Offset Y (down)', control: expr, placeholder: '-60' },
          { key: 'offZ', label: 'Offset Z (toward viewer)', control: expr, placeholder: '280' }
        ],
        note: 'The 3D camera rides the object\u2019s center every frame, always looking at it — the classic third-person chase view. Offset X moves the camera right, Offset Y down (negative = above), Offset Z toward the viewer. Set 3D Camera or Stop 3D Camera Follow ends the follow.'
      },
      {
        category: '3D',
        blockType: 'stop-3d-camera-follow',
        runtimeType: 'stop3dCameraFollow',
        kind: 'action',
        label: 'Stop 3D Camera Follow',
        color: '#0ea5e9',
        cellLabel: 'Stop3DFol',
        defaults: { type: 'stop3dCameraFollow' },
        fields: [],
        note: 'Stops the 3D camera follow started by Follow 3D Object — the camera stays exactly where it is. (Set 3D Camera also ends a follow.)'
      },
      // P4 item 3D3 (composable character controllers): the two controller
      // primitives — FPS aim and yaw-relative movement. Both use the same
      // yaw convention (0 = into the screen, positive = right), so
      // mouse-look and WASD always agree. Recipes, not black boxes: the
      // user wires these with Follow 3D Object, Read Mouse Delta, and
      // named input actions.
      {
        category: '3D',
        blockType: 'aim-3d-camera',
        runtimeType: 'aim3dCamera',
        kind: 'action',
        label: 'Aim 3D Camera',
        color: '#0ea5e9',
        cellLabel: 'Aim3D',
        defaults: { type: 'aim3dCamera', yaw: 0, pitch: 0, dist: 500 },
        fields: [
          { key: 'yaw', label: 'Yaw (degrees)', control: expr, placeholder: '0' },
          { key: 'pitch', label: 'Pitch (degrees)', control: expr, placeholder: '0' },
          { key: 'dist', label: 'Look distance', control: expr, placeholder: '500' }
        ],
        note: 'Aims the 3D camera from where it already is, using yaw/pitch degrees — the mouse-look half of an FPS camera. Yaw 0 faces into the screen; positive yaw turns right. Pitch 0 is level; positive pitch looks down. Unlike Set 3D Camera this never ends a Follow 3D Object, so park the camera on the player\u2019s head with Follow 3D Object and aim it every frame.'
      },
      {
        category: '3D',
        blockType: 'move-3d-facing',
        runtimeType: 'move3dFacing',
        kind: 'action',
        label: 'Move 3D Facing',
        color: '#0ea5e9',
        cellLabel: 'FaceMove3D',
        defaults: { type: 'move3dFacing', targetObject: '', forward: 4, strafe: 0, yaw: 0 },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'forward', label: 'Forward', control: expr, placeholder: '4' },
          { key: 'strafe', label: 'Strafe (right +)', control: expr, placeholder: '0' },
          { key: 'yaw', label: 'Yaw (degrees)', control: expr, placeholder: '0' }
        ],
        note: 'Moves the 3D object along the direction it faces: Forward steps toward the yaw heading, Strafe steps right (negative = left). Yaw 0 is into the screen; positive yaw turns right — the same yaw you steer with Aim 3D Camera, so WASD movement and mouse-look always agree.'
      },
      // P4 item 3D4 (3D physics basics): gravity + velocity actions. These
      // write the shared physics/velocity fields, so they compose with the
      // Inspector's Physics panel and with each other — no black boxes.
      {
        category: '3D',
        blockType: 'set-3d-gravity',
        runtimeType: 'set3dGravity',
        kind: 'action',
        label: 'Set 3D Gravity',
        color: '#0ea5e9',
        cellLabel: 'Grav3D',
        defaults: { type: 'set3dGravity', targetObject: '', gravity: 0.8 },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'gravity', label: 'Gravity (down +)', control: expr, placeholder: '0.8' }
        ],
        note: 'Gives the 3D object gravity — it falls downward every frame, exactly like the 2D Set Gravity block. Positive pulls down. Also turns physics on for the object, and writes the same value the Inspector\u2019s Physics panel shows, so they never disagree.'
      },
      {
        category: '3D',
        blockType: 'set-3d-velocity',
        runtimeType: 'set3dVelocity',
        kind: 'action',
        label: 'Set 3D Velocity',
        color: '#0ea5e9',
        cellLabel: 'Vel3D',
        defaults: { type: 'set3dVelocity', targetObject: '', vx: 0, vy: -6, vz: 0 },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'vx', label: 'VX (right +)', control: expr, placeholder: '0' },
          { key: 'vy', label: 'VY (down +)', control: expr, placeholder: '-6' },
          { key: 'vz', label: 'VZ (toward viewer +)', control: expr, placeholder: '0' }
        ],
        note: 'Sets the 3D object\u2019s velocity directly: a negative VY launches it upward (jump), zeros stop it dead. Combine with 3D On Ground for jump-only-when-landed, the classic platformer move.'
      },
      {
        category: '3D',
        blockType: 'distance-3d-condition',
        runtimeType: 'distance3d',
        kind: 'condition',
        label: '3D Distance',
        color: '#0ea5e9',
        cellLabel: 'Dist3D?',
        defaults: { type: 'distance3d', object1: '', object2: '', operator: '<=', distance: 150, reversed: false },
        fields: [
          { key: 'object1', label: 'Object A', control: obj },
          { key: 'object2', label: 'Object B', control: obj },
          { key: 'operator', label: 'Operator', control: 'select', options: [['<=', 'Within distance'], ['>', 'Farther than distance'], ['>=', 'At least distance'], ['<', 'Less than distance']] },
          { key: 'distance', label: 'Distance', control: expr, placeholder: '150' },
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'Compares the center-to-center 3D distance between two objects (X, Y, and Z all count). The 3D version of Distance Check — great for 3D pickups and proximity triggers.'
      },
      // P4 item 3D4 (3D physics basics): ground + touch conditions. Both
      // are world-dependent, so they report the paused freeze (a reversed
      // one passes while paused), like 2D Collision and On Floor.
      {
        category: '3D',
        blockType: 'on-ground-3d',
        runtimeType: 'onGround3d',
        kind: 'condition',
        label: '3D On Ground',
        color: '#0ea5e9',
        cellLabel: 'Ground3D?',
        defaults: { type: 'onGround3d', targetObject: '', reversed: false },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'True while the 3D object is resting on a solid 3D surface. The 3D version of On Floor — the classic use is a jump button that only works while the player is grounded (chain 3D On Ground + Action Input into Set 3D Velocity).'
      },
      {
        category: '3D',
        blockType: 'collision-3d',
        runtimeType: 'collision3d',
        kind: 'condition',
        label: '3D Collision',
        color: '#0ea5e9',
        cellLabel: 'Hit3D?',
        defaults: { type: 'collision3d', object1: '', object2: '', reversed: false },
        fields: [
          { key: 'object1', label: 'Object A', control: obj },
          { key: 'object2', label: 'Object B', control: obj },
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'True while the two 3D objects\u2019 colliders overlap — box or sphere colliders, whichever each object uses. The 3D version of the Collision condition; it only reports the touch, it never moves anything.'
      },
      // P4 item 3D5 (3D lighting): runtime control over Light 3D objects —
      // day/night cycles, flickering torches, muzzle flashes.
      {
        category: '3D',
        blockType: 'set-3d-light',
        runtimeType: 'set3dLight',
        kind: 'action',
        label: 'Set 3D Light',
        color: '#0ea5e9',
        cellLabel: 'Light3D',
        defaults: { type: 'set3dLight', targetObject: '', lightType: 'point', color: '#ffffff', intensity: 1, range: 600, mode: 'on' },
        fields: [
          { key: 'targetObject', label: 'Light', control: obj },
          { key: 'lightType', label: 'Type', control: 'select', options: [['point', 'Point'], ['directional', 'Directional'], ['ambient', 'Ambient']] },
          { key: 'color', label: 'Color', control: 'color' },
          { key: 'intensity', label: 'Intensity', control: expr, placeholder: '1' },
          { key: 'range', label: 'Range', control: expr, placeholder: '600' },
          { key: 'mode', label: 'Light', control: 'select', options: [['on', 'On'], ['off', 'Off']] }
        ],
        note: 'Changes a Light 3D object while the game runs: its type (Point shines from its position and fades with Range, Directional aims with the light\u2019s Rot X / Rot Y, Ambient washes the whole scene), color, intensity, range, or on/off. Flicker a torch by chaining Every Frame into Set 3D Light with a wobbling intensity; fade to night by dimming the ambient light.'
      },
      {
        category: 'Object',
        blockType: 'set-blend-mode',
        runtimeType: 'setBlendMode',
        kind: 'action',
        label: 'Set Blend Mode',
        color: '#a855f7',
        cellLabel: 'Blend',
        defaults: { type: 'setBlendMode', targetObject: '', blend: 'normal' },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'blend', label: 'Blend', control: 'select', options: [['normal', 'Normal'], ['add', 'Add (glow)'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'], ['difference', 'Difference']] }
        ],
        note: 'Changes how the object blends with whatever is drawn under it. Add makes bright colors glow over dark backgrounds (lasers, fireflies, light rays); Multiply darkens like stained glass. Drawing-only — collision is untouched.'
      },
      {
        category: 'Object',
        blockType: 'set-shadow',
        runtimeType: 'setShadow',
        kind: 'action',
        label: 'Set Shadow',
        color: '#a855f7',
        cellLabel: 'Shadow',
        defaults: { type: 'setShadow', targetObject: '', color: '#000000', blur: 8, offsetX: 0, offsetY: 4 },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'color', label: 'Shadow color', control: 'color' },
          { key: 'blur', label: 'Blur', control: expr, placeholder: '8' },
          { key: 'offsetX', label: 'Offset X', control: expr, placeholder: '0' },
          { key: 'offsetY', label: 'Offset Y', control: expr, placeholder: '4' }
        ],
        note: 'Gives the object a drop shadow: a colored, blurred copy drawn underneath at the offset. Blur runs 0-64; a blur of 0 turns the shadow off. Drawing-only — collision is untouched.'
      },
      {
        category: 'Object',
        blockType: 'set-visual-effect',
        runtimeType: 'setVisualEffect',
        kind: 'action',
        label: 'Set Visual Effect',
        color: '#a855f7',
        cellLabel: 'FX',
        defaults: { type: 'setVisualEffect', targetObject: '', effect: 'none' },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'effect', label: 'Effect', control: 'select', options: [['none', 'None'], ['grayscale', 'Grayscale'], ['sepia', 'Sepia'], ['invert', 'Invert colors'], ['brighten', 'Brighten'], ['dim', 'Dim'], ['blur', 'Soft blur']] }
        ],
        note: 'Applies a pixel filter to the object: turn the world grayscale in a flashback, invert colors for a glitch moment, dim a paused scene. Choose None to switch the filter off. Drawing-only — collision is untouched.'
      },
      {
        category: 'Object',
        blockType: 'clear-effects',
        runtimeType: 'clearEffects',
        kind: 'action',
        label: 'Clear Effects',
        color: '#a855f7',
        cellLabel: 'Clear FX',
        defaults: { type: 'clearEffects', targetObject: '' },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj }
        ],
        note: 'Resets the object\u2019s blend mode, shadow, and visual effect back to normal drawing — the undo button for Set Blend Mode, Set Shadow, and Set Visual Effect.'
      },
      // P4 item 37 (block expansion, batch 2: text manipulation). These five
      // actions restyle text objects at runtime; all other object kinds are
      // left untouched (mirrors the setText guard).
      {
        category: 'Object',
        blockType: 'set-text-size',
        runtimeType: 'setTextSize',
        kind: 'action',
        label: 'Set Text Size',
        color: '#a855f7',
        cellLabel: 'TextSize',
        defaults: { type: 'setTextSize', targetObject: '', size: 24 },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'size', label: 'Size', control: expr, placeholder: '24 or titleSize' }
        ],
        note: 'Changes the font size of text objects. Only affects text objects; everything else is left alone.'
      },
      {
        category: 'Object',
        blockType: 'set-text-color',
        runtimeType: 'setTextColor',
        kind: 'action',
        label: 'Set Text Color',
        color: '#a855f7',
        cellLabel: 'TextClr',
        defaults: { type: 'setTextColor', targetObject: '', color: '#111827' },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'color', label: 'Color', control: 'color' }
        ],
        note: 'Changes the color of text objects. Only affects text objects; everything else is left alone.'
      },
      {
        category: 'Object',
        blockType: 'set-text-style',
        runtimeType: 'setTextStyle',
        kind: 'action',
        label: 'Set Text Style',
        color: '#a855f7',
        cellLabel: 'TextStyle',
        defaults: { type: 'setTextStyle', targetObject: '', bold: 'off', italic: 'off' },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'bold', label: 'Bold', control: 'select', options: [['on', 'Bold'], ['off', 'Not bold']] },
          { key: 'italic', label: 'Italic', control: 'select', options: [['on', 'Italic'], ['off', 'Not italic']] }
        ],
        note: 'Turns bold and italic on or off for text objects. Only affects text objects; everything else is left alone.'
      },
      {
        category: 'Object',
        blockType: 'set-text-alignment',
        runtimeType: 'setTextAlignment',
        kind: 'action',
        label: 'Set Text Alignment',
        color: '#a855f7',
        cellLabel: 'TextAln',
        defaults: { type: 'setTextAlignment', targetObject: '', align: 'left' },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'align', label: 'Alignment', control: 'select', options: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']] }
        ],
        note: 'Aligns the text inside its box: left, center, or right. Only affects text objects; everything else is left alone.'
      },
      {
        category: 'Object',
        blockType: 'append-text',
        runtimeType: 'appendText',
        kind: 'action',
        label: 'Append Text',
        color: '#a855f7',
        cellLabel: 'Append',
        defaults: { type: 'appendText', targetObject: '', value: 'A' },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'value', label: 'Text to add', control: 'text', placeholder: 'A' }
        ],
        note: 'Adds text to the END of what the text object already shows. Pair with On Timer to build a typewriter effect: every timer tick, append the next letter. Only affects text objects.'
      },
      {
        category: 'Logic',
        blockType: 'text-check',
        runtimeType: 'textCheck',
        kind: 'condition',
        label: 'Text Compare',
        color: '#0f766e',
        cellLabel: 'Txt?',
        defaults: { type: 'textCheck', targetObject: '', operator: 'equals', value: 'Ready', reversed: false },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'operator', label: 'Compare', control: 'select', options: [['equals', 'Equals'], ['notEquals', 'Does not equal'], ['contains', 'Contains'], ['startsWith', 'Starts with'], ['endsWith', 'Ends with'], ['isEmpty', 'Is empty']] },
          { key: 'value', label: 'Compare to', control: 'text', placeholder: 'Ready' },
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'Compares what a text object currently shows. "Is empty" ignores the Compare-to field. Use it to react when a score label reaches a value or a typewriter finishes.'
      },
      {
        category: 'Object',
        blockType: 'point-toward-object',
        runtimeType: 'pointTowardObject',
        kind: 'action',
        label: 'Point Toward Object',
        note: 'Rotates an object to face another object. Add an offset angle if the sprite artwork points a different way.',
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
        note: 'Rotates an object to face an X and Y point. Example: aim a turret at a target position.',
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
        category: 'Object',
        blockType: 'pick-nearest-condition',
        runtimeType: 'pickNearest',
        kind: 'condition',
        label: 'Pick Nearest',
        color: '#a855f7',
        cellLabel: 'Pick Near',
        defaults: { type: 'pickNearest', objectName: '', nearObject: '', pointX: 400, pointY: 300 },
        fields: [
          { key: 'objectName', label: 'Object', control: obj },
          { key: 'nearObject', label: 'Near object', control: obj },
          { key: 'pointX', label: 'Point X', control: expr, placeholder: '400' },
          { key: 'pointY', label: 'Point Y', control: expr, placeholder: '300' }
        ],
        note: 'Picks the nearest live object with the given name to the Near object (leave Near object blank to measure from the X/Y point instead). An action chained after this block with the same Object name applies ONLY to the picked object — enemy AI targeting, homing pickups, "the closest coin flashes". True while at least one live object with the name exists.'
      },
      {
        category: 'Object',
        blockType: 'pick-farthest-condition',
        runtimeType: 'pickFarthest',
        kind: 'condition',
        label: 'Pick Farthest',
        color: '#a855f7',
        cellLabel: 'Pick Far',
        defaults: { type: 'pickFarthest', objectName: '', nearObject: '', pointX: 400, pointY: 300 },
        fields: [
          { key: 'objectName', label: 'Object', control: obj },
          { key: 'nearObject', label: 'Near object', control: obj },
          { key: 'pointX', label: 'Point X', control: expr, placeholder: '400' },
          { key: 'pointY', label: 'Point Y', control: expr, placeholder: '300' }
        ],
        note: 'Picks the furthest live object with the given name from the Near object (leave Near object blank to measure from the X/Y point instead). An action chained after this block with the same Object name applies ONLY to the picked object. True while at least one live object with the name exists.'
      },
      {
        category: 'Object',
        blockType: 'pick-random-condition',
        runtimeType: 'pickRandom',
        kind: 'condition',
        label: 'Pick Random',
        color: '#a855f7',
        cellLabel: 'Pick Rnd',
        defaults: { type: 'pickRandom', objectName: '' },
        fields: [
          { key: 'objectName', label: 'Object', control: obj }
        ],
        note: 'Picks one random live object with the given name. An action chained after this block with the same Object name applies ONLY to the picked object. Fires once per appearance by default (switch the trigger mode to "While true" for a fresh random pick every frame).'
      },
      {
        category: 'Camera',
        blockType: 'screen-shake',
        runtimeType: 'screenShake',
        kind: 'action',
        label: 'Screen Shake',
        note: 'Shakes the screen briefly for impact. Strength sets how far it jumps, Duration sets how long it lasts.',
        color: '#f97316',
        cellLabel: 'Shake',
        defaults: { type: 'screenShake', strength: 6, duration: 0.2, cooldown: 0.25 },
        fields: [
          { key: 'strength', label: 'Strength', control: expr, placeholder: '6' },
          { key: 'duration', label: 'Seconds', control: expr, placeholder: '0.2' },
          { key: 'cooldown', label: 'Cooldown', control: expr, placeholder: '0.25' }
        ]
      },
      {
        category: 'Camera',
        blockType: 'screen-flash',
        runtimeType: 'screenFlash',
        kind: 'action',
        label: 'Screen Flash',
        note: 'Flashes the whole screen a color briefly, for hits, pickups, or scene changes. Color sets the flash color, Intensity (0-1) sets how strong it looks, Duration sets how long it lasts.',
        color: '#f97316',
        cellLabel: 'Flash',
        defaults: { type: 'screenFlash', color: '#ffffff', intensity: 0.6, duration: 0.2 },
        fields: [
          { key: 'color', label: 'Color', control: 'color' },
          { key: 'intensity', label: 'Intensity', control: expr, placeholder: '0.6' },
          { key: 'duration', label: 'Seconds', control: expr, placeholder: '0.2' }
        ]
      },
      {
        category: 'Camera',
        blockType: 'move-camera',
        runtimeType: 'setCamera',
        kind: 'action',
        label: 'Move Camera',
        color: '#f97316',
        cellLabel: 'Cam Move',
        defaults: { type: 'setCamera', cameraX: 0, cameraY: 0 },
        fields: [
          { key: 'cameraX', label: 'X', control: expr, placeholder: '0 or player.posX - 400' },
          { key: 'cameraY', label: 'Y', control: expr, placeholder: '0 or player.posY - 300' }
        ],
        note: 'Sets the world position shown at the top-left of the screen. Clears any camera follow.'
      },
      {
        category: 'Camera',
        blockType: 'center-camera-on',
        runtimeType: 'centerCameraOn',
        kind: 'action',
        label: 'Center Camera On',
        color: '#f97316',
        cellLabel: 'Cam Center',
        defaults: { type: 'centerCameraOn', targetObject: '', offsetX: 0, offsetY: 0 },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'offsetX', label: 'Offset X', control: expr, placeholder: '0' },
          { key: 'offsetY', label: 'Offset Y', control: expr, placeholder: '0' }
        ],
        note: 'One shot: centers the camera on the object right now. Does not keep following it.'
      },
      {
        category: 'Camera',
        blockType: 'follow-object',
        runtimeType: 'followCamera',
        kind: 'action',
        label: 'Follow Object',
        color: '#f97316',
        cellLabel: 'Cam Follow',
        defaults: { type: 'followCamera', targetObject: '', offsetX: 0, offsetY: 0 },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'offsetX', label: 'Offset X', control: expr, placeholder: '0' },
          { key: 'offsetY', label: 'Offset Y', control: expr, placeholder: '0' }
        ],
        note: 'The camera tracks the object every frame until you stop it.'
      },
      {
        category: 'Camera',
        blockType: 'stop-camera-follow',
        runtimeType: 'stopCameraFollow',
        kind: 'action',
        label: 'Stop Camera Follow',
        color: '#f97316',
        cellLabel: 'Cam Stop',
        defaults: { type: 'stopCameraFollow' },
        fields: [],
        note: 'The camera stops following and stays where it is.'
      },
      {
        category: 'Camera',
        blockType: 'reset-camera',
        runtimeType: 'resetCamera',
        kind: 'action',
        label: 'Reset Camera',
        color: '#f97316',
        cellLabel: 'Cam Reset',
        defaults: { type: 'resetCamera' },
        fields: [],
        note: 'Stops following, sets zoom back to 1, moves the camera to the top-left of the world, and restores the scene\'s follow smoothing, deadzone, and bounds.'
      },
      {
        category: 'Camera',
        blockType: 'set-camera-zoom',
        runtimeType: 'setCameraZoom',
        kind: 'action',
        label: 'Set Camera Zoom',
        color: '#f97316',
        cellLabel: 'Cam Zoom',
        defaults: { type: 'setCameraZoom', zoom: 1 },
        fields: [
          { key: 'zoom', label: 'Zoom', control: expr, placeholder: '1' }
        ],
        note: '1 is normal. 2 zooms in (things look twice as big); 0.5 zooms out. Clamped to 0.25-4.'
      },
      {
        category: 'Camera',
        blockType: 'camera-position',
        runtimeType: 'cameraPosition',
        kind: 'condition',
        label: 'Camera Position',
        color: '#f97316',
        cellLabel: 'Cam Pos',
        defaults: { type: 'cameraPosition', property: 'cameraX', operator: '>=', value: 0, reversed: false },
        fields: [
          { key: 'property', label: 'Property', control: 'select', options: [['cameraX', 'Camera X'], ['cameraY', 'Camera Y'], ['zoom', 'Zoom']] },
          { key: 'operator', label: 'Compare', control: 'select', options: [['>=', 'at least'], ['<=', 'at most'], ['==', 'equals'], ['!=', 'not equals'], ['>', 'greater than'], ['<', 'less than']] },
          { key: 'value', label: 'Value', control: expr, placeholder: '0' },
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'True when the camera position or zoom matches the comparison.'
      },
      // P4 Advanced batch 15 (camera feel): follow smoothing, deadzone,
      // and camera bounds (Unity Cinemachine damping + confiner /
      // Godot Camera2D smoothing + drag margins + limits, beginner
      // edition). The scene's defaults live in Scene Settings; these
      // blocks change them while the game runs, for the current scene.
      {
        category: 'Camera',
        blockType: 'set-camera-smoothing',
        runtimeType: 'setCameraSmoothing',
        kind: 'action',
        label: 'Set Camera Smoothing',
        color: '#f97316',
        cellLabel: 'Cam Smooth',
        defaults: { type: 'setCameraSmoothing', smoothing: 0.5 },
        fields: [
          { key: 'smoothing', label: 'Smoothing', control: expr, placeholder: '0.5' }
        ],
        note: 'How gently the camera chases the followed object. 0 snaps at once (the old behavior); 0.5 glides halfway there each frame; 0.9 is a slow cinematic drift. A bad number warns and the smoothing stays put.'
      },
      {
        category: 'Camera',
        blockType: 'set-camera-deadzone',
        runtimeType: 'setCameraDeadzone',
        kind: 'action',
        label: 'Set Camera Deadzone',
        color: '#f97316',
        cellLabel: 'Cam Zone',
        defaults: { type: 'setCameraDeadzone', width: 160, height: 100 },
        fields: [
          { key: 'width', label: 'Width', control: expr, placeholder: '160' },
          { key: 'height', label: 'Height', control: expr, placeholder: '100' }
        ],
        note: 'A width x height rectangle (world pixels) around the center of the screen. While the followed object stays inside it the camera does not move, so small hops never shake the view. 0 x 0 turns the deadzone off.'
      },
      {
        category: 'Camera',
        blockType: 'set-camera-bounds',
        runtimeType: 'setCameraBounds',
        kind: 'action',
        label: 'Set Camera Bounds',
        color: '#f97316',
        cellLabel: 'Cam Bounds',
        defaults: { type: 'setCameraBounds', minX: 0, minY: 0, maxX: 800, maxY: 600 },
        fields: [
          { key: 'minX', label: 'Min X', control: expr, placeholder: '0' },
          { key: 'minY', label: 'Min Y', control: expr, placeholder: '0' },
          { key: 'maxX', label: 'Max X', control: expr, placeholder: '800' },
          { key: 'maxY', label: 'Max Y', control: expr, placeholder: '600' }
        ],
        note: 'A world rectangle the camera view stays inside, so the camera never shows past the edge of a room. Min must be below Max on both axes; a bad rectangle warns and the bounds stay put. Clear Camera Bounds removes them.'
      },
      {
        category: 'Camera',
        blockType: 'clear-camera-bounds',
        runtimeType: 'clearCameraBounds',
        kind: 'action',
        label: 'Clear Camera Bounds',
        color: '#f97316',
        cellLabel: 'Cam Unbound',
        defaults: { type: 'clearCameraBounds' },
        fields: [],
        note: 'Removes the camera bounds, so the view goes back to staying inside the scene edges.'
      },
      {
        category: 'Camera',
        blockType: 'camera-following',
        runtimeType: 'cameraFollowing',
        kind: 'condition',
        label: 'Camera Following',
        color: '#f97316',
        cellLabel: 'Cam Follow?',
        defaults: { type: 'cameraFollowing', reversed: false },
        fields: [
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'True while the camera is following an object. Invert it to detect that the camera is free and park it somewhere with Move Camera.'
      },
      // P4 Advanced batch 16 (parallax backgrounds): depth without a
      // 3D scene — background layers scroll slower than the world
      // (Unity ParallaxBackground / Godot ParallaxBackground +
      // ParallaxLayer, beginner edition). The factor lives on the
      // object (Inspector Parallax section, 1 = normal); these blocks
      // change it while the game runs and read it back.
      {
        category: 'Camera',
        blockType: 'set-parallax',
        runtimeType: 'setParallax',
        kind: 'action',
        label: 'Set Parallax',
        color: '#f97316',
        cellLabel: 'Parallax',
        defaults: { type: 'setParallax', targetObject: '', parallaxX: 0.5, parallaxY: 0.5 },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'parallaxX', label: 'Parallax X', control: expr, placeholder: '0.5' },
          { key: 'parallaxY', label: 'Parallax Y', control: expr, placeholder: '0.5' }
        ],
        note: 'How fast this object scrolls with the camera. 1 moves with the world; 0 stays pinned to the screen, like a sky; 0.5 moves at half speed, like distant hills; above 1 rushes past, like a foreground. A bad number warns and the factors stay put.'
      },
      {
        category: 'Camera',
        blockType: 'parallax-factor',
        runtimeType: 'parallaxFactor',
        kind: 'condition',
        label: 'Parallax Factor',
        color: '#f97316',
        cellLabel: 'Parallax?',
        defaults: { type: 'parallaxFactor', targetObject: '', axis: 'parallaxX', operator: '==', value: 0.5, reversed: false },
        fields: [
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'axis', label: 'Axis', control: 'select', options: [['parallaxX', 'X (horizontal)'], ['parallaxY', 'Y (vertical)']] },
          { key: 'operator', label: 'Compare', control: 'select', options: [['>=', 'at least'], ['<=', 'at most'], ['==', 'equals'], ['!=', 'not equals'], ['>', 'greater than'], ['<', 'less than']] },
          { key: 'value', label: 'Value', control: expr, placeholder: '0.5' },
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'True when an object\'s parallax factor matches the comparison — use it to check a layer is set up the way you meant before the camera starts moving.'
      },
      // P4 item 37 batch 6 (variables/arrays/structures): any game variable
      // can hold a list (array) or a structure (named fields). The blocks
      // create the container on first write; reads never create variables.
      // Values come in four kinds: number (an expression), text, true/false,
      // or a copy of another variable.
      {
        category: 'Variables',
        blockType: 'array-push',
        runtimeType: 'arrayPush',
        kind: 'action',
        label: 'Push To Array',
        color: '#2563eb',
        cellLabel: 'Push',
        defaults: { type: 'arrayPush', varName: 'inventory', valueKind: 'text', value: '' },
        fields: [
          { key: 'varName', label: 'List variable', control: 'text', placeholder: 'inventory' },
          { key: 'valueKind', label: 'Value is', control: 'select', options: [['number', 'Number (expression)'], ['text', 'Text'], ['true', 'True'], ['false', 'False'], ['variable', 'Copy of another variable']] },
          { key: 'value', label: 'Value', control: expr, placeholder: '1, score + 1, or item name' }
        ],
        note: 'Adds the value to the end of the list. Creates the list if the variable does not hold one yet.'
      },
      {
        category: 'Variables',
        blockType: 'array-pop',
        runtimeType: 'arrayPop',
        kind: 'action',
        label: 'Pop From Array',
        color: '#2563eb',
        cellLabel: 'Pop',
        defaults: { type: 'arrayPop', varName: 'inventory', storeVarName: '' },
        fields: [
          { key: 'varName', label: 'List variable', control: 'text', placeholder: 'inventory' },
          { key: 'storeVarName', label: 'Into variable (optional)', control: 'text', placeholder: 'pickedItem' }
        ],
        note: 'Removes the last item of the list. Optionally stores it in another variable (0 when the list is empty).'
      },
      {
        category: 'Variables',
        blockType: 'array-set-item',
        runtimeType: 'arraySetItem',
        kind: 'action',
        label: 'Set Array Item',
        color: '#2563eb',
        cellLabel: 'Set Item',
        defaults: { type: 'arraySetItem', varName: 'inventory', index: 0, valueKind: 'number', value: 0 },
        fields: [
          { key: 'varName', label: 'List variable', control: 'text', placeholder: 'inventory' },
          { key: 'index', label: 'Index', control: expr, placeholder: '0 (first), -1 (last)' },
          { key: 'valueKind', label: 'Value is', control: 'select', options: [['number', 'Number (expression)'], ['text', 'Text'], ['true', 'True'], ['false', 'False'], ['variable', 'Copy of another variable']] },
          { key: 'value', label: 'Value', control: expr, placeholder: '1, score + 1, or item name' }
        ],
        note: 'Replaces the item at the index (0 is first, -1 is last). Grows the list with 0s when the index is past the end.'
      },
      {
        category: 'Variables',
        blockType: 'array-get-item',
        runtimeType: 'arrayGetItem',
        kind: 'action',
        label: 'Get Array Item',
        color: '#2563eb',
        cellLabel: 'Get Item',
        defaults: { type: 'arrayGetItem', varName: 'inventory', index: 0, storeVarName: 'pickedItem' },
        fields: [
          { key: 'varName', label: 'List variable', control: 'text', placeholder: 'inventory' },
          { key: 'index', label: 'Index', control: expr, placeholder: '0 (first), -1 (last)' },
          { key: 'storeVarName', label: 'Into variable', control: 'text', placeholder: 'pickedItem' }
        ],
        note: 'Copies the item at the index into another variable (0 when the index is out of range). Use the copied variable in expressions.'
      },
      {
        category: 'Variables',
        blockType: 'array-insert',
        runtimeType: 'arrayInsert',
        kind: 'action',
        label: 'Insert Into Array',
        color: '#2563eb',
        cellLabel: 'Insert',
        defaults: { type: 'arrayInsert', varName: 'inventory', index: 0, valueKind: 'text', value: '' },
        fields: [
          { key: 'varName', label: 'List variable', control: 'text', placeholder: 'inventory' },
          { key: 'index', label: 'Index', control: expr, placeholder: '0 (first), -1 (last)' },
          { key: 'valueKind', label: 'Value is', control: 'select', options: [['number', 'Number (expression)'], ['text', 'Text'], ['true', 'True'], ['false', 'False'], ['variable', 'Copy of another variable']] },
          { key: 'value', label: 'Value', control: expr, placeholder: '1, score + 1, or item name' }
        ],
        note: 'Inserts the value at the index, shifting later items one step right.'
      },
      {
        category: 'Variables',
        blockType: 'array-remove-at',
        runtimeType: 'arrayRemoveAt',
        kind: 'action',
        label: 'Remove Array Item',
        color: '#2563eb',
        cellLabel: 'Remove #',
        defaults: { type: 'arrayRemoveAt', varName: 'inventory', index: 0, storeVarName: '' },
        fields: [
          { key: 'varName', label: 'List variable', control: 'text', placeholder: 'inventory' },
          { key: 'index', label: 'Index', control: expr, placeholder: '0 (first), -1 (last)' },
          { key: 'storeVarName', label: 'Into variable (optional)', control: 'text', placeholder: 'removedItem' }
        ],
        note: 'Removes the item at the index. Optionally stores the removed item in another variable.'
      },
      {
        category: 'Variables',
        blockType: 'array-remove-value',
        runtimeType: 'arrayRemoveValue',
        kind: 'action',
        label: 'Remove Array Value',
        color: '#2563eb',
        cellLabel: 'Remove =',
        defaults: { type: 'arrayRemoveValue', varName: 'inventory', valueKind: 'text', value: '' },
        fields: [
          { key: 'varName', label: 'List variable', control: 'text', placeholder: 'inventory' },
          { key: 'valueKind', label: 'Value is', control: 'select', options: [['number', 'Number (expression)'], ['text', 'Text'], ['true', 'True'], ['false', 'False'], ['variable', 'Copy of another variable']] },
          { key: 'value', label: 'Value', control: expr, placeholder: '1, score + 1, or item name' }
        ],
        note: 'Removes the first item that exactly equals the value. Does nothing when the value is not in the list.'
      },
      {
        category: 'Variables',
        blockType: 'array-clear',
        runtimeType: 'arrayClear',
        kind: 'action',
        label: 'Clear Array',
        color: '#2563eb',
        cellLabel: 'Clear List',
        defaults: { type: 'arrayClear', varName: 'inventory' },
        fields: [
          { key: 'varName', label: 'List variable', control: 'text', placeholder: 'inventory' }
        ],
        note: 'Empties the list. The variable still holds a list, just with no items.'
      },
      {
        category: 'Variables',
        blockType: 'array-sort',
        runtimeType: 'arraySort',
        kind: 'action',
        label: 'Sort Array',
        color: '#2563eb',
        cellLabel: 'Sort',
        defaults: { type: 'arraySort', varName: 'scores', sortMode: 'num-asc' },
        fields: [
          { key: 'varName', label: 'List variable', control: 'text', placeholder: 'scores' },
          { key: 'sortMode', label: 'Sort by', control: 'select', options: [['num-asc', 'Numbers, low to high'], ['num-desc', 'Numbers, high to low'], ['text-asc', 'Text, A to Z'], ['text-desc', 'Text, Z to A']] }
        ],
        note: 'Sorts the list in place. Number sorts treat non-numbers as 0; text sorts compare as text.'
      },
      {
        category: 'Variables',
        blockType: 'array-shuffle',
        runtimeType: 'arrayShuffle',
        kind: 'action',
        label: 'Shuffle Array',
        color: '#2563eb',
        cellLabel: 'Shuffle',
        defaults: { type: 'arrayShuffle', varName: 'deck' },
        fields: [
          { key: 'varName', label: 'List variable', control: 'text', placeholder: 'deck' }
        ],
        note: 'Randomly reorders the list in place. The classic card-deck shuffle.'
      },
      {
        category: 'Variables',
        blockType: 'array-join',
        runtimeType: 'arrayJoin',
        kind: 'action',
        label: 'Join Array To Text',
        color: '#2563eb',
        cellLabel: 'Join',
        defaults: { type: 'arrayJoin', varName: 'inventory', separator: ', ', storeVarName: 'inventoryText' },
        fields: [
          { key: 'varName', label: 'List variable', control: 'text', placeholder: 'inventory' },
          { key: 'separator', label: 'Separator', control: 'text', placeholder: ', ' },
          { key: 'storeVarName', label: 'Into variable', control: 'text', placeholder: 'inventoryText' }
        ],
        note: 'Glues every item into one text with the separator between items, and stores it. Show it with Set Text.'
      },
      {
        category: 'Variables',
        blockType: 'array-math',
        runtimeType: 'arrayMath',
        kind: 'action',
        label: 'Array Total',
        color: '#2563eb',
        cellLabel: 'Total',
        defaults: { type: 'arrayMath', varName: 'scores', mathOp: 'sum', storeVarName: 'total' },
        fields: [
          { key: 'varName', label: 'List variable', control: 'text', placeholder: 'scores' },
          { key: 'mathOp', label: 'Compute', control: 'select', options: [['sum', 'Sum'], ['average', 'Average'], ['min', 'Minimum'], ['max', 'Maximum']] },
          { key: 'storeVarName', label: 'Into variable', control: 'text', placeholder: 'total' }
        ],
        note: 'Computes the sum, average, minimum, or maximum of the list (non-numbers count as 0) and stores the result. An empty list gives 0.'
      },
      {
        category: 'Variables',
        blockType: 'array-length-condition',
        runtimeType: 'arrayLength',
        kind: 'condition',
        label: 'Array Length',
        color: '#1d4ed8',
        cellLabel: 'Len?',
        defaults: { type: 'arrayLength', varName: 'inventory', operator: '>=', compareValue: 1, reversed: false },
        fields: [
          { key: 'varName', label: 'List variable', control: 'text', placeholder: 'inventory' },
          { key: 'operator', label: 'Compare', control: 'select', options: [['>=', 'at least'], ['<=', 'at most'], ['==', 'equals'], ['!=', 'not equals'], ['>', 'greater than'], ['<', 'less than']] },
          { key: 'compareValue', label: 'Value', control: expr, placeholder: '1' },
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'True when the number of items in the list matches the comparison. A missing variable counts as an empty list.'
      },
      {
        category: 'Variables',
        blockType: 'array-contains-condition',
        runtimeType: 'arrayContains',
        kind: 'condition',
        label: 'Array Contains',
        color: '#1d4ed8',
        cellLabel: 'Has?',
        defaults: { type: 'arrayContains', varName: 'inventory', valueKind: 'text', value: '', reversed: false },
        fields: [
          { key: 'varName', label: 'List variable', control: 'text', placeholder: 'inventory' },
          { key: 'valueKind', label: 'Value is', control: 'select', options: [['number', 'Number (expression)'], ['text', 'Text'], ['true', 'True'], ['false', 'False'], ['variable', 'Copy of another variable']] },
          { key: 'value', label: 'Value', control: expr, placeholder: '1, score + 1, or item name' },
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'True when the list holds an item exactly equal to the value. Invert it to ask "does the player NOT have the key yet?".'
      },
      {
        category: 'Variables',
        blockType: 'struct-set-field',
        runtimeType: 'structSetField',
        kind: 'action',
        label: 'Set Structure Field',
        color: '#7c3aed',
        cellLabel: 'Set Field',
        defaults: { type: 'structSetField', varName: 'player', field: 'gold', valueKind: 'number', value: 0 },
        fields: [
          { key: 'varName', label: 'Structure variable', control: 'text', placeholder: 'player' },
          { key: 'field', label: 'Field name', control: 'text', placeholder: 'gold' },
          { key: 'valueKind', label: 'Value is', control: 'select', options: [['number', 'Number (expression)'], ['text', 'Text'], ['true', 'True'], ['false', 'False'], ['variable', 'Copy of another variable']] },
          { key: 'value', label: 'Value', control: expr, placeholder: '1, score + 1, or item name' }
        ],
        note: 'Sets a named field on the structure (player.gold = 50). Creates the structure if the variable does not hold one yet.'
      },
      {
        category: 'Variables',
        blockType: 'struct-get-field',
        runtimeType: 'structGetField',
        kind: 'action',
        label: 'Get Structure Field',
        color: '#7c3aed',
        cellLabel: 'Get Field',
        defaults: { type: 'structGetField', varName: 'player', field: 'gold', storeVarName: 'gold' },
        fields: [
          { key: 'varName', label: 'Structure variable', control: 'text', placeholder: 'player' },
          { key: 'field', label: 'Field name', control: 'text', placeholder: 'gold' },
          { key: 'storeVarName', label: 'Into variable', control: 'text', placeholder: 'gold' }
        ],
        note: 'Copies the field into another variable (0 when the field is missing). Use the copied variable in expressions.'
      },
      {
        category: 'Variables',
        blockType: 'struct-remove-field',
        runtimeType: 'structRemoveField',
        kind: 'action',
        label: 'Remove Structure Field',
        color: '#7c3aed',
        cellLabel: 'Del Field',
        defaults: { type: 'structRemoveField', varName: 'player', field: 'gold' },
        fields: [
          { key: 'varName', label: 'Structure variable', control: 'text', placeholder: 'player' },
          { key: 'field', label: 'Field name', control: 'text', placeholder: 'gold' }
        ],
        note: 'Deletes the named field from the structure. Does nothing when the field is not there.'
      },
      {
        category: 'Variables',
        blockType: 'struct-clear',
        runtimeType: 'structClear',
        kind: 'action',
        label: 'Clear Structure',
        color: '#7c3aed',
        cellLabel: 'Clear Fields',
        defaults: { type: 'structClear', varName: 'player' },
        fields: [
          { key: 'varName', label: 'Structure variable', control: 'text', placeholder: 'player' }
        ],
        note: 'Removes every field from the structure. The variable still holds a structure, just with no fields.'
      },
      {
        category: 'Variables',
        blockType: 'struct-keys',
        runtimeType: 'structKeys',
        kind: 'action',
        label: 'List Structure Keys',
        color: '#7c3aed',
        cellLabel: 'Keys',
        defaults: { type: 'structKeys', varName: 'player', storeVarName: 'fieldNames' },
        fields: [
          { key: 'varName', label: 'Structure variable', control: 'text', placeholder: 'player' },
          { key: 'storeVarName', label: 'Into variable', control: 'text', placeholder: 'fieldNames' }
        ],
        note: 'Stores the list of field names as a new list variable. Handy with Array Length and Join Array To Text.'
      },
      {
        category: 'Variables',
        blockType: 'struct-has-field-condition',
        runtimeType: 'structHasField',
        kind: 'condition',
        label: 'Structure Has Field',
        color: '#6d28d9',
        cellLabel: 'Field?',
        defaults: { type: 'structHasField', varName: 'player', field: 'gold', reversed: false },
        fields: [
          { key: 'varName', label: 'Structure variable', control: 'text', placeholder: 'player' },
          { key: 'field', label: 'Field name', control: 'text', placeholder: 'gold' },
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'True when the structure has the named field. A missing variable counts as having no fields.'
      },
      {
        category: 'Variables',
        blockType: 'var-to-json',
        runtimeType: 'varToJson',
        kind: 'action',
        label: 'Variable To JSON',
        color: '#0891b2',
        cellLabel: 'To JSON',
        defaults: { type: 'varToJson', varName: 'player', storeVarName: 'playerJson' },
        fields: [
          { key: 'varName', label: 'Variable', control: 'text', placeholder: 'player' },
          { key: 'storeVarName', label: 'Into variable', control: 'text', placeholder: 'playerJson' }
        ],
        note: 'Turns any variable (list, structure, number, text) into JSON text. Pairs with Variable From JSON to rebuild it.'
      },
      {
        category: 'Variables',
        blockType: 'var-from-json',
        runtimeType: 'varFromJson',
        kind: 'action',
        label: 'Variable From JSON',
        color: '#0891b2',
        cellLabel: 'From JSON',
        defaults: { type: 'varFromJson', varName: 'player', jsonText: '{"gold": 0}' },
        fields: [
          { key: 'varName', label: 'Variable', control: 'text', placeholder: 'player' },
          { key: 'jsonText', label: 'JSON text', control: 'text', placeholder: '{"gold": 0}' }
        ],
        note: 'Rebuilds a variable from JSON text (the reverse of Variable To JSON). Invalid JSON warns and leaves the variable unchanged.'
      },
      {
        // P5 core-engine track, item P5-6 (data structures, slice a):
        // nested paths — one block reads or writes a value deep inside
        // lists and structures (party[0].hp, player.stats.hp), building
        // the containers it needs on the way down.
        category: 'Variables',
        blockType: 'nested-get',
        runtimeType: 'nestedGet',
        kind: 'action',
        label: 'Get Nested Value',
        color: '#7c3aed',
        cellLabel: 'Get Path',
        defaults: { type: 'nestedGet', varName: 'party', path: '[0].name', storeVarName: 'firstName' },
        fields: [
          { key: 'varName', label: 'Variable', control: 'text', placeholder: 'party' },
          { key: 'path', label: 'Path', control: 'text', placeholder: '[0].name or stats.hp' },
          { key: 'storeVarName', label: 'Into variable', control: 'text', placeholder: 'firstName' }
        ],
        note: 'Reads a value deep inside a list or structure (party[0].name, player.stats.hp) into another variable. A missing step reads as 0.'
      },
      {
        category: 'Variables',
        blockType: 'nested-set',
        runtimeType: 'nestedSet',
        kind: 'action',
        label: 'Set Nested Value',
        color: '#7c3aed',
        cellLabel: 'Set Path',
        defaults: { type: 'nestedSet', varName: 'party', path: '[0].hp', valueKind: 'number', value: 10 },
        fields: [
          { key: 'varName', label: 'Variable', control: 'text', placeholder: 'party' },
          { key: 'path', label: 'Path', control: 'text', placeholder: '[0].hp or stats.hp' },
          { key: 'valueKind', label: 'Value is', control: 'select', options: [['number', 'Number (expression)'], ['text', 'Text'], ['true', 'True'], ['false', 'False'], ['variable', 'Copy of another variable']] },
          { key: 'value', label: 'Value', control: expr, placeholder: '1, score + 1, or item name' }
        ],
        note: 'Writes a value deep inside a list or structure (party[0].hp = 10). Builds the lists and structures it needs on the way down.'
      },
      {
        // P5 core-engine track, item P5-6 (data structures, slice b):
        // object references inside structures — a picked or spawned
        // object held in a list or dictionary field, read back
        // through a path. The handle is plain data, so a list of
        // live objects is a list of handles.
        category: 'Variables',
        blockType: 'nested-store-object',
        runtimeType: 'nestedStoreObject',
        kind: 'action',
        label: 'Store Object In Structure',
        color: '#7c3aed',
        cellLabel: 'Store Obj',
        defaults: { type: 'nestedStoreObject', varName: 'squad', path: '[0]', objectVar: 'member', scope: 'global', targetObject: '' },
        fields: [
          { key: 'varName', label: 'Variable', control: 'text', placeholder: 'squad' },
          { key: 'path', label: 'Path', control: 'text', placeholder: '[0] or leader' },
          { key: 'objectVar', label: 'Object variable', control: 'text', placeholder: 'member' },
          { key: 'scope', label: 'Scope', control: 'select', options: [['global', 'Global (whole game)'], ['scene', 'Scene (this scene only)'], ['object', 'Object (per object name)'], ['local', 'Local (this function only)']] },
          { key: 'targetObject', label: 'Scope object', control: obj }
        ],
        note: 'Stores the object a scoped variable holds inside a list or structure at a path (squad[0], party.leader). Builds the lists and structures it needs on the way down, like Set Nested Value. A variable that holds no object stores the empty reference, so a later Is alive read is 0.'
      },
      {
        category: 'Variables',
        blockType: 'nested-read-object',
        runtimeType: 'nestedReadObject',
        kind: 'action',
        label: 'Read Object From Structure',
        color: '#7c3aed',
        cellLabel: 'Read Obj',
        defaults: { type: 'nestedReadObject', varName: 'squad', path: '[0]', objectVar: 'member', scope: 'global', targetObject: '' },
        fields: [
          { key: 'varName', label: 'Variable', control: 'text', placeholder: 'squad' },
          { key: 'path', label: 'Path', control: 'text', placeholder: '[0] or leader' },
          { key: 'objectVar', label: 'Object variable', control: 'text', placeholder: 'member' },
          { key: 'scope', label: 'Scope', control: 'select', options: [['global', 'Global (whole game)'], ['scene', 'Scene (this scene only)'], ['object', 'Object (per object name)'], ['local', 'Local (this function only)']] },
          { key: 'targetObject', label: 'Scope object', control: obj }
        ],
        note: 'Reads the object at a path inside a list or structure (squad[0], party.leader) back into a scoped variable, so the game can walk a party list one member at a time. A missing step, or a value that is not an object, clears the variable, so a later Is alive read is 0. Chained actions after it hit that one object.'
      },
      {
        // P5 core-engine track, item P5-1 (Variables v2, slice a): scoped
        // variables — global, scene, and object scope, each value typed.
        // The flat dict stays the global scope's history: Set Variable
        // writes one flat variable everywhere, these blocks write a
        // named variable into exactly one scope, so two scenes (or two
        // goblins) can each keep their own value under the same name.
        category: 'Variables',
        blockType: 'set-scoped-variable',
        runtimeType: 'setScopedVariable',
        kind: 'action',
        label: 'Set Scoped Variable',
        color: '#4f46e5',
        cellLabel: 'Set Var',
        defaults: { type: 'setScopedVariable', scope: 'global', targetObject: '', varName: '', valueKind: 'number', value: 0 },
        fields: [
          { key: 'scope', label: 'Scope', control: 'select', options: [['global', 'Global (whole game)'], ['scene', 'Scene (this scene only)'], ['object', 'Object (per object name)'], ['local', 'Local (this function only)']] },
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'varName', label: 'Variable name', control: 'text', placeholder: 'coins' },
          { key: 'valueKind', label: 'Value is', control: 'select', options: [['number', 'Number (expression)'], ['text', 'Text'], ['true', 'True'], ['false', 'False'], ['variable', 'Copy of another variable']] },
          { key: 'value', label: 'Value', control: expr, placeholder: '1, score + 1, or item name' }
        ],
        note: 'Stores a value in one scope: Global keeps it for the whole run, Scene keeps it for this scene only (it resets when the scene loads), Object keeps one value per object name. The type follows the value — number, text, true/false, or a copy of another variable.'
      },
      {
        category: 'Variables',
        blockType: 'read-scoped-variable',
        runtimeType: 'readScopedVariable',
        kind: 'action',
        label: 'Read Scoped Variable',
        color: '#6366f1',
        cellLabel: 'Read Var',
        defaults: { type: 'readScopedVariable', scope: 'global', targetObject: '', varName: '', storeVarName: '' },
        fields: [
          { key: 'scope', label: 'Scope', control: 'select', options: [['global', 'Global (whole game)'], ['scene', 'Scene (this scene only)'], ['object', 'Object (per object name)'], ['local', 'Local (this function only)']] },
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'varName', label: 'Variable name', control: 'text', placeholder: 'coins' },
          { key: 'storeVarName', label: 'Into variable', control: 'text', placeholder: 'coinsHere' }
        ],
        note: 'Copies a scoped variable into an ordinary flat variable, so expressions, labels, and the old variable blocks can use it. A missing variable reads as 0.'
      },
      {
        // P5 core-engine track, item P5-9 (the build-the-editor test):
        // the bridge that lets a game read typed input back into a
        // variable. Text objects are the only place typed text can
        // land (digit keys + Append Text build it up, one letter at a
        // time), and until this block there was no way to get that
        // text back out into a variable — so a player could never type
        // a number into the Variable Inspector and have the game use
        // it. Number mode parses the text (a blank reads as 0, text
        // that is not a number warns and leaves the variable alone);
        // Text mode stores the text as-is.
        category: 'Variables',
        blockType: 'read-text-into-variable',
        runtimeType: 'readTextIntoVariable',
        kind: 'action',
        label: 'Read Text Into Variable',
        color: '#7c3aed',
        cellLabel: 'Read Text',
        defaults: { type: 'readTextIntoVariable', targetObject: '', mode: 'text', storeVarName: '' },
        fields: [
          { key: 'targetObject', label: 'Text object', control: obj },
          { key: 'mode', label: 'Read as', control: 'select', options: [['text', 'Text (as shown)'], ['number', 'Number (parse digits)']] },
          { key: 'storeVarName', label: 'Into variable', control: 'text', placeholder: 'typedValue' }
        ],
        note: 'Reads what a text object shows into an ordinary flat variable. Pair it with digit keys + Append Text to let the player type a value, then Set Scoped Variable copies it in. Number mode parses the text: a blank reads as 0, text that is not a number warns and leaves the variable alone.'
      },
      {
        category: 'Variables',
        blockType: 'delete-scoped-variable',
        runtimeType: 'deleteScopedVariable',
        kind: 'action',
        label: 'Delete Scoped Variable',
        color: '#4338ca',
        cellLabel: 'Del Var',
        defaults: { type: 'deleteScopedVariable', scope: 'global', targetObject: '', varName: '' },
        fields: [
          { key: 'scope', label: 'Scope', control: 'select', options: [['global', 'Global (whole game)'], ['scene', 'Scene (this scene only)'], ['object', 'Object (per object name)'], ['local', 'Local (this function only)']] },
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'varName', label: 'Variable name', control: 'text', placeholder: 'coins' }
        ],
        note: 'Deletes one scoped variable. Does nothing when the variable is not there.'
      },
      {
        category: 'Variables',
        blockType: 'clear-scoped-variables',
        runtimeType: 'clearScopedVariables',
        kind: 'action',
        label: 'Clear Scoped Variables',
        color: '#3730a3',
        cellLabel: 'Clear Vars',
        defaults: { type: 'clearScopedVariables', scope: 'scene', targetObject: '' },
        fields: [
          { key: 'scope', label: 'Scope', control: 'select', options: [['global', 'Global (whole game)'], ['scene', 'Scene (this scene only)'], ['object', 'Object (per object name)'], ['local', 'Local (this function only)']] },
          { key: 'targetObject', label: 'Object (blank = every object)', control: obj }
        ],
        note: 'Clears a whole scope at once: every global variable, this scene\u2019s variables, or one object\u2019s variables (leave Object blank to clear every object\u2019s).'
      },
      {
        category: 'Variables',
        blockType: 'scoped-variable-exists-condition',
        runtimeType: 'scopedVariableExists',
        kind: 'condition',
        label: 'Scoped Variable Exists',
        color: '#818cf8',
        cellLabel: 'Var Exists?',
        defaults: { type: 'scopedVariableExists', scope: 'global', targetObject: '', varName: '', reversed: false },
        fields: [
          { key: 'scope', label: 'Scope', control: 'select', options: [['global', 'Global (whole game)'], ['scene', 'Scene (this scene only)'], ['object', 'Object (per object name)'], ['local', 'Local (this function only)']] },
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'varName', label: 'Variable name', control: 'text', placeholder: 'coins' },
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'True while the named variable exists in the picked scope. Invert it to run a row only the first time — set the variable at the end of the row so it never fires twice.'
      },
      {
        category: 'Variables',
        blockType: 'scoped-variable-check-condition',
        runtimeType: 'scopedVariableCheck',
        kind: 'condition',
        label: 'Scoped Variable Check',
        color: '#a5b4fc',
        cellLabel: 'Var = ?',
        defaults: { type: 'scopedVariableCheck', scope: 'global', targetObject: '', varName: '', operator: '>=', compareValue: 1, reversed: false },
        fields: [
          { key: 'scope', label: 'Scope', control: 'select', options: [['global', 'Global (whole game)'], ['scene', 'Scene (this scene only)'], ['object', 'Object (per object name)'], ['local', 'Local (this function only)']] },
          { key: 'targetObject', label: 'Object', control: obj },
          { key: 'varName', label: 'Variable name', control: 'text', placeholder: 'coins' },
          { key: 'operator', label: 'Compare', control: 'select', options: [['>=', 'at least'], ['<=', 'at most'], ['==', 'equals'], ['!=', 'not equals'], ['>', 'greater than'], ['<', 'less than']] },
          { key: 'compareValue', label: 'Value', control: expr, placeholder: '1' },
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'True while a scoped variable compares with the value the picked way. Numbers compare numerically; text and true/false compare as text. A missing variable reads as 0.'
      },
      {
        // P5 core-engine track, item P5-5 (Object primitives, slice a):
        // object references as values. Pick Object Into Variable picks
        // one live object and stores it in a scoped variable, so the
        // game can keep track of one goblin, one coin, one bullet and
        // use it later — and it points the execution context at the
        // picked object, so chained actions that target the object's
        // name hit that one object. Read Object Property reads one
        // property of the held object back into an ordinary variable.
        category: 'Variables',
        blockType: 'pick-object-into-variable',
        runtimeType: 'pickObjectIntoVariable',
        kind: 'action',
        label: 'Pick Object Into Variable',
        color: '#7e22ce',
        cellLabel: 'Pick Obj',
        defaults: { type: 'pickObjectIntoVariable', objectName: '', pickMode: 'nearest', nearObject: '', pointX: 0, pointY: 0, varName: 'target', scope: 'global', targetObject: '' },
        fields: [
          { key: 'objectName', label: 'Object', control: obj },
          { key: 'pickMode', label: 'Pick', control: 'select', options: [['nearest', 'Nearest'], ['farthest', 'Farthest'], ['random', 'Random'], ['first', 'First']] },
          { key: 'nearObject', label: 'Near object (optional)', control: obj },
          { key: 'pointX', label: 'X', control: expr, placeholder: '0' },
          { key: 'pointY', label: 'Y', control: expr, placeholder: '0' },
          { key: 'varName', label: 'Into variable', control: 'text', placeholder: 'target' },
          { key: 'scope', label: 'Scope', control: 'select', options: [['global', 'Global (whole game)'], ['scene', 'Scene (this scene only)'], ['object', 'Object (per object name)'], ['local', 'Local (this function only)']] },
          { key: 'targetObject', label: 'Scope object', control: obj }
        ],
        note: 'Picks one live object and stores it in a variable, so the game can keep track of one enemy, one coin, one bullet. Nearest and Farthest measure from the Near object when one is named, otherwise from the X/Y point; Random and First need no reference. Actions chained after it that target the same object name hit only the picked object. No live object stays quiet and writes nothing; a blank object or variable name warns and holds.'
      },
      {
        category: 'Variables',
        blockType: 'read-object-property',
        runtimeType: 'readObjectProperty',
        kind: 'action',
        label: 'Read Object Property',
        color: '#8b5cf6',
        cellLabel: 'Obj Prop',
        defaults: { type: 'readObjectProperty', varName: 'target', scope: 'global', targetObject: '', property: 'x', storeVarName: 'targetX' },
        fields: [
          { key: 'varName', label: 'Object variable', control: 'text', placeholder: 'target' },
          { key: 'scope', label: 'Scope', control: 'select', options: [['global', 'Global (whole game)'], ['scene', 'Scene (this scene only)'], ['object', 'Object (per object name)'], ['local', 'Local (this function only)']] },
          { key: 'targetObject', label: 'Scope object', control: obj },
          { key: 'property', label: 'Property', control: 'select', options: [['x', 'X position'], ['y', 'Y position'], ['width', 'Width'], ['height', 'Height'], ['rotation', 'Rotation (degrees)'], ['velX', 'Velocity X'], ['velY', 'Velocity Y'], ['health', 'Health'], ['maxHealth', 'Max Health'], ['name', 'Name (text)'], ['alive', 'Is alive (1 or 0)']] },
          { key: 'storeVarName', label: 'Into variable', control: 'text', placeholder: 'targetX' }
        ],
        note: 'Reads one property of the object a variable holds into an ordinary variable, so expressions and labels can use it: where the picked enemy stands, how fast it moves, how much health it has left. Is alive reads 1 while the held object is still live and 0 when it is gone, so it is the liveness test. A missing variable, a variable that holds no object, or a stale object reads as 0 (empty text for Name) and stays quiet.'
      },
      {
        // P5 core-engine track, item P5-5 (Object primitives, slice b):
        // physics queries that return data. Raycast Into Variables
        // casts a ray and stores what it hits — the closest live
        // collision object in a scoped object variable, and the
        // distance to the hit in an ordinary variable — so a game can
        // ask what is in front of the player instead of only whether
        // something is there. A miss writes -1 for the distance and
        // clears the object variable, so the variable never holds a
        // stale hit. List Overlapping Objects stores every live
        // collision object inside a circle as a list of object
        // handles, so For Each Item can walk through them one at a
        // time and act on each one.
        category: 'Variables',
        blockType: 'raycast-into-variables',
        runtimeType: 'raycastIntoVariables',
        kind: 'action',
        label: 'Raycast Into Variables',
        color: '#6d28d9',
        cellLabel: 'Raycast',
        defaults: { type: 'raycastIntoVariables', fromX: 0, fromY: 0, toX: 400, toY: 300, layerMask: 255, varName: 'hit', scope: 'global', targetObject: '', distanceVar: 'hitDistance' },
        fields: [
          { key: 'fromX', label: 'From X', control: expr, placeholder: '0' },
          { key: 'fromY', label: 'From Y', control: expr, placeholder: '0' },
          { key: 'toX', label: 'To X', control: expr, placeholder: '400' },
          { key: 'toY', label: 'To Y', control: expr, placeholder: '300' },
          { key: 'layerMask', label: 'Layers (mask)', control: expr, placeholder: '255 = all' },
          { key: 'varName', label: 'Into variable', control: 'text', placeholder: 'hit' },
          { key: 'scope', label: 'Scope', control: 'select', options: [['global', 'Global (whole game)'], ['scene', 'Scene (this scene only)'], ['object', 'Object (per object name)'], ['local', 'Local (this function only)']] },
          { key: 'targetObject', label: 'Scope object', control: obj },
          { key: 'distanceVar', label: 'Distance variable', control: 'text', placeholder: 'hitDistance' }
        ],
        note: 'Casts a ray from the From point to the To point and stores what it hits: the closest live collision object goes into a scoped object variable, and the distance to the hit goes into an ordinary variable. Actions chained after it that target the same object name hit only the hit object. A miss writes -1 for the distance and clears the object variable, so a later Is alive read is 0. A blank distance variable only skips the distance store.'
      },
      {
        category: 'Variables',
        blockType: 'list-overlapping-objects',
        runtimeType: 'listOverlappingObjects',
        kind: 'action',
        label: 'List Overlapping Objects',
        color: '#9333ea',
        cellLabel: 'Overlap List',
        defaults: { type: 'listOverlappingObjects', x: 400, y: 300, radius: 48, layerMask: 255, listVar: 'nearby', countVar: 'nearbyCount' },
        fields: [
          { key: 'x', label: 'X', control: expr, placeholder: '400' },
          { key: 'y', label: 'Y', control: expr, placeholder: '300' },
          { key: 'radius', label: 'Radius', control: expr, placeholder: '48' },
          { key: 'layerMask', label: 'Layers (mask)', control: expr, placeholder: '255 = all' },
          { key: 'listVar', label: 'Into list', control: 'text', placeholder: 'nearby' },
          { key: 'countVar', label: 'Count variable', control: 'text', placeholder: 'nearbyCount' }
        ],
        note: 'Lists every live collision object overlapping the circle at X/Y with the given radius and stores them as a list of object handles, so For Each Item can walk through them one at a time: each round the body reads the current object with Read Object Property and its actions hit that one object. The list is replaced fresh on every run, never added to. An empty overlap stores an empty list and a count of 0. A blank count variable only skips the count store.'
      },
      {
        category: 'Variables',
        blockType: 'spawn-object-into-variable',
        runtimeType: 'spawnObjectIntoVariable',
        kind: 'action',
        label: 'Spawn Object Into Variable',
        color: '#7c3aed',
        cellLabel: 'Spawn Obj',
        defaults: { type: 'spawnObjectIntoVariable', sourceObject: '', spawnX: 400, spawnY: 300, varName: 'spawned', scope: 'global', targetObject: '' },
        fields: [
          { key: 'sourceObject', label: 'Object', control: obj },
          { key: 'spawnX', label: 'X', control: expr, placeholder: '400' },
          { key: 'spawnY', label: 'Y', control: expr, placeholder: '300' },
          { key: 'varName', label: 'Into variable', control: 'text', placeholder: 'spawned' },
          { key: 'scope', label: 'Scope', control: 'select', options: [['global', 'Global (whole game)'], ['scene', 'Scene (this scene only)'], ['object', 'Object (per object name)'], ['local', 'Local (this function only)']] },
          { key: 'targetObject', label: 'Scope object', control: obj }
        ],
        note: 'Spawns a copy of the object at X/Y and stores the clone in a scoped object variable, so the game can keep track of one spawned enemy, one bullet, one coin and use it later. Actions chained after it that target the same object name hit only the clone. A missing source clears the variable, so a later Is alive read is 0. A blank object or variable name warns and holds.'
      },
      {
        category: 'Variables',
        blockType: 'destroy-object-in-variable',
        runtimeType: 'destroyObjectInVariable',
        kind: 'action',
        label: 'Destroy Object In Variable',
        color: '#c026d3',
        cellLabel: 'Destroy Obj',
        defaults: { type: 'destroyObjectInVariable', varName: 'spawned', scope: 'global', targetObject: '' },
        fields: [
          { key: 'varName', label: 'Object variable', control: 'text', placeholder: 'spawned' },
          { key: 'scope', label: 'Scope', control: 'select', options: [['global', 'Global (whole game)'], ['scene', 'Scene (this scene only)'], ['object', 'Object (per object name)'], ['local', 'Local (this function only)']] },
          { key: 'targetObject', label: 'Scope object', control: obj }
        ],
        note: 'Destroys exactly the object a variable holds, the clone a spawn handed back or the goblin a pick chose, not every object with that name. A missing variable, a variable that holds no object, or an object that is already gone stays quiet. A blank variable name warns and holds.'
      },
      {
        // P5 core-engine track, item P5-3 (Functions / custom blocks,
        // slice a): define a function once in the Functions manager
        // (a name, up to eight parameters, and a body grid like any
        // other scope), then call it from any row. Calling a function
        // runs its body grid once; the parameters arrive as local
        // variables, so a Set Scoped Variable with scope Local writes
        // this call's copy. Return sets the value the call hands back
        // and stops the rest of the body; a function with no Return
        // returns 0, the way a missing variable reads as 0.
        // Slice b: the block declares eight argument slots (arg1..arg8)
        // so the catalog stays the source of truth, but the property
        // panel only shows one field per parameter of the picked
        // function, labeled with the parameter name — the dynamic
        // argument editor in script.js.
        category: 'Functions',
        blockType: 'call-function',
        runtimeType: 'callFunction',
        kind: 'action',
        label: 'Call Function',
        color: '#0d9488',
        cellLabel: 'Call Fn',
        defaults: { type: 'callFunction', functionName: '', arg1: '', arg2: '', arg3: '', arg4: '', arg5: '', arg6: '', arg7: '', arg8: '', storeVarName: '' },
        fields: [
          { key: 'functionName', label: 'Function', control: 'function' },
          { key: 'arg1', label: 'Argument 1', control: expr, placeholder: 'value for the first parameter' },
          { key: 'arg2', label: 'Argument 2', control: expr, placeholder: 'value for the second parameter' },
          { key: 'arg3', label: 'Argument 3', control: expr, placeholder: 'value for the third parameter' },
          { key: 'arg4', label: 'Argument 4', control: expr, placeholder: 'value for the fourth parameter' },
          { key: 'arg5', label: 'Argument 5', control: expr, placeholder: 'value for the fifth parameter' },
          { key: 'arg6', label: 'Argument 6', control: expr, placeholder: 'value for the sixth parameter' },
          { key: 'arg7', label: 'Argument 7', control: expr, placeholder: 'value for the seventh parameter' },
          { key: 'arg8', label: 'Argument 8', control: expr, placeholder: 'value for the eighth parameter' },
          { key: 'storeVarName', label: 'Into variable (optional)', control: 'text', placeholder: 'result' }
        ],
        note: 'Runs the named function once and stores what it returns in a variable (0 when the function has no Return, or when Into variable is blank the value is discarded). The panel shows one argument field per parameter, labeled with the parameter name; arguments fill the parameters in order, and a blank argument ends the list. A missing function warns and holds.'
      },
      {
        category: 'Functions',
        blockType: 'return-from-function',
        runtimeType: 'returnFromFunction',
        kind: 'action',
        label: 'Return From Function',
        color: '#14b8a6',
        cellLabel: 'Return',
        defaults: { type: 'returnFromFunction', value: '' },
        fields: [
          { key: 'value', label: 'Value to return', control: expr, placeholder: '0, score + bonus, or a name' }
        ],
        note: 'Hands a value back to the Call Function block that ran this function, and stops the rest of the body. Outside a function it warns and does nothing.'
      },
      {
        // P5 core-engine track, item P5-4 (Control flow + events,
        // slice a): loops. A loop block sits at the head of a row and
        // the actions to its right on the same row are its body —
        // Repeat runs the body a set number of times, While runs it
        // until its test stops being true, and Break / Continue steer
        // the innermost loop from inside the body. The body stays
        // ordinary blocks, never hidden inside the loop.
        category: 'Control Flow',
        blockType: 'repeat-times',
        runtimeType: 'repeatTimes',
        kind: 'action',
        label: 'Repeat',
        color: '#8b5cf6',
        cellLabel: 'Repeat',
        defaults: { type: 'repeatTimes', count: '3', counterVar: '' },
        fields: [
          { key: 'count', label: 'Times', control: expr, placeholder: '3' },
          { key: 'counterVar', label: 'Counter variable (optional)', control: 'text', placeholder: 'i' }
        ],
        note: 'Runs the blocks to its right on the same row over and over, the set number of times. The counter variable, when named, counts the time round (1, then 2, up to the count) and the body reads it like any other variable. A Repeat with no blocks to its right runs nothing. Past 1000 times it runs 1000 and warns.'
      },
      {
        category: 'Control Flow',
        blockType: 'while-loop',
        runtimeType: 'whileLoop',
        kind: 'action',
        label: 'While',
        color: '#7c3aed',
        cellLabel: 'While',
        defaults: { type: 'whileLoop', left: 'i', operator: '<', right: '10' },
        fields: [
          { key: 'left', label: 'Left value', control: expr, placeholder: 'score' },
          { key: 'operator', label: 'Compare', control: 'select', options: [['>=', 'at least'], ['<=', 'at most'], ['==', 'equals'], ['!=', 'not equals'], ['>', 'greater than'], ['<', 'less than']] },
          { key: 'right', label: 'Right value', control: expr, placeholder: '10' }
        ],
        note: 'Runs the blocks to its right on the same row over and over while the test holds, and stops the moment it stops holding. Change a variable inside the body and test that variable — a test that never changes stops after 1000 times with a warning. A While with no blocks to its right runs nothing.'
      },
      {
        category: 'Control Flow',
        blockType: 'break-loop',
        runtimeType: 'breakLoop',
        kind: 'action',
        label: 'Break',
        color: '#a855f7',
        cellLabel: 'Break',
        defaults: { type: 'breakLoop' },
        fields: [],
        note: 'Stops the innermost Repeat or While loop at once, and the game carries on after the loop. Outside a loop it warns and does nothing.'
      },
      {
        category: 'Control Flow',
        blockType: 'continue-loop',
        runtimeType: 'continueLoop',
        kind: 'action',
        label: 'Continue',
        color: '#a855f7',
        cellLabel: 'Continue',
        defaults: { type: 'continueLoop' },
        fields: [],
        note: 'Skips the rest of this time round the innermost Repeat or While loop and starts the next one. Outside a loop it warns and does nothing.'
      },
      {
        // P5 core-engine track, item P5-4 (Control flow + events,
        // slice b): for-each. For Each Item runs the body once per
        // item of a list variable (the list the array blocks build);
        // For Each Object runs it once per live object with a name,
        // handing each object to the body through the execution
        // context, the same narrowing pick conditions use — so body
        // actions that target the object's name hit that one object.
        // Both share the loop body rule, caps, budget, and Break /
        // Continue with Repeat and While.
        category: 'Control Flow',
        blockType: 'for-each-list',
        runtimeType: 'forEachList',
        kind: 'action',
        label: 'For Each Item',
        color: '#8b5cf6',
        cellLabel: 'For Each',
        defaults: { type: 'forEachList', listVar: 'inventory', itemVar: 'item', indexVar: '' },
        fields: [
          { key: 'listVar', label: 'List variable', control: 'text', placeholder: 'inventory' },
          { key: 'itemVar', label: 'Item variable', control: 'text', placeholder: 'item' },
          { key: 'indexVar', label: 'Index variable (optional)', control: 'text', placeholder: 'index' }
        ],
        note: 'Runs the blocks to its right on the same row once for every item in the list. The item variable holds the item each time round and the index variable, when named, counts 1, 2, 3. A list with more than 1000 items runs only the first 1000 and warns; a variable that holds no list warns and nothing runs.'
      },
      {
        category: 'Control Flow',
        blockType: 'for-each-object',
        runtimeType: 'forEachObject',
        kind: 'action',
        label: 'For Each Object',
        color: '#7c3aed',
        cellLabel: 'Each Obj',
        defaults: { type: 'forEachObject', objectName: '', indexVar: '' },
        fields: [
          { key: 'objectName', label: 'Object', control: obj },
          { key: 'indexVar', label: 'Index variable (optional)', control: 'text', placeholder: 'index' }
        ],
        note: 'Runs the blocks to its right on the same row once for every live object with that name. Body actions that target the object hit one object at a time — the current one — so the same chain can heal every goblin or move every coin. The index variable, when named, counts 1, 2, 3. More than 1000 live objects runs only the first 1000 and warns; no live objects runs nothing.'
      },
      {
        // P5 core-engine track, item P5-6 (Data structures,
        // slice c): iteration over structures. For Each Field runs
        // the body once per field of a structure, handing the body
        // the field name as text and the field's value each round —
        // the dict half of For Each Item, which walks a list. When
        // a field's value is an object handle, the body round also
        // points the execution context at that live object, the
        // same narrowing For Each Item uses. Shares the loop body
        // rule, caps, budget, and Break / Continue with the other
        // for-each blocks.
        category: 'Control Flow',
        blockType: 'for-each-field',
        runtimeType: 'forEachField',
        kind: 'action',
        label: 'For Each Field',
        color: '#7c3aed',
        cellLabel: 'Each Field',
        defaults: { type: 'forEachField', varName: 'stats', keyVar: 'field', valueVar: 'value', indexVar: '' },
        fields: [
          { key: 'varName', label: 'Structure variable', control: 'text', placeholder: 'stats' },
          { key: 'keyVar', label: 'Key variable', control: 'text', placeholder: 'field' },
          { key: 'valueVar', label: 'Value variable', control: 'text', placeholder: 'value' },
          { key: 'indexVar', label: 'Index variable (optional)', control: 'text', placeholder: 'index' }
        ],
        note: 'Runs the blocks to its right on the same row once for every field in the structure. The key variable holds the field name each time round, the value variable holds the field\'s value, and the index variable, when named, counts 1, 2, 3. A structure with more than 1000 fields runs only the first 1000 and warns; a variable that holds no structure warns and nothing runs.'
      },
      {
        // P4 Advanced batch 35 (pick objects by tag): For Each Tagged
        // Object walks the group a tag names — every live object
        // carrying the tag, whatever the members are called — so one
        // chain can damage every goblin or heal every ally. Body
        // actions that target the object's name hit one object at a
        // time, the current one; when the Object variable is named it
        // also holds the current object, so the body can read it with
        // Read Object Property even when the tagged objects have
        // different names.
        category: 'Control Flow',
        blockType: 'for-each-tagged',
        runtimeType: 'forEachTagged',
        kind: 'action',
        label: 'For Each Tagged Object',
        color: '#7c3aed',
        cellLabel: 'Each Tagged',
        defaults: { type: 'forEachTagged', tag: '', objVar: '', indexVar: '' },
        fields: [
          { key: 'tag', label: 'Tag', control: 'text', placeholder: 'e.g. goblin' },
          { key: 'objVar', label: 'Object variable (optional)', control: 'text', placeholder: 'foe' },
          { key: 'indexVar', label: 'Index variable (optional)', control: 'text', placeholder: 'index' }
        ],
        note: 'Runs the blocks to its right on the same row once for every live object carrying the tag, in live order. Body actions that target the object hit one object at a time — the current one — so the same chain can damage every goblin or move every coin. When the Object variable is named it holds the current object each time round, so Read Object Property can read it even when the tagged objects have different names. The index variable, when named, counts 1, 2, 3. More than 1000 live tagged objects runs only the first 1000 and warns; no live tagged objects runs nothing; a blank tag warns and holds.'
      },
      {
        // P5 core-engine track, item P5-4 (Control flow + events,
        // slice c): custom events. Broadcast Event sends a named
        // event; On Event hears it. The broadcast is an ordinary
        // action and the listener an ordinary condition, and the
        // chain after the listener is an ordinary chain — the event
        // is only the link between two chains that would otherwise
        // have to poll a variable or reach across the grid.
        category: 'Control Flow',
        blockType: 'broadcast-event',
        runtimeType: 'broadcastEvent',
        kind: 'action',
        label: 'Broadcast Event',
        color: '#8b5cf6',
        cellLabel: 'Broadcast',
        defaults: { type: 'broadcastEvent', eventName: '' },
        fields: [
          { key: 'eventName', label: 'Event name', control: 'text', placeholder: 'goal-scored' }
        ],
        note: 'Sends the named event to every On Event listener with the same name. A blank name warns and does nothing; an event carries no value with it, so set a variable first when the listener needs a number or a name.'
      },
      {
        category: 'Control Flow',
        blockType: 'on-custom-event',
        runtimeType: 'onCustomEvent',
        kind: 'condition',
        label: 'On Event',
        color: '#7c3aed',
        cellLabel: 'On Event',
        defaults: { type: 'onCustomEvent', eventName: '' },
        fields: [
          { key: 'eventName', label: 'Event name', control: 'text', placeholder: 'goal-scored' }
        ],
        note: 'True for one frame when the named event is broadcast, so the blocks to its right run once per broadcast. A listener before the broadcaster in the grid fires on the next frame instead; several broadcasts of one name in one frame still fire it once. A name that is never broadcast stays quiet, so spell it exactly as the Broadcast block does.'
      },
      {
        category: 'Variables',
        blockType: 'random-integer',
        runtimeType: 'randomInteger',
        kind: 'action',
        label: 'Random Integer',
        color: '#0891b2',
        cellLabel: 'Rand Int',
        defaults: { type: 'randomInteger', varName: 'roll', min: 1, max: 6 },
        fields: [
          { key: 'varName', label: 'Into variable', control: 'text', placeholder: 'roll' },
          { key: 'min', label: 'Min', control: expr, placeholder: '1' },
          { key: 'max', label: 'Max', control: expr, placeholder: '6' }
        ],
        note: 'Stores a whole number between Min and Max, inclusive on both ends. Min and Max swap automatically when Min is bigger.'
      },
      {
        category: 'Variables',
        blockType: 'clamp-number',
        runtimeType: 'clampNumber',
        kind: 'action',
        label: 'Clamp Number',
        color: '#0891b2',
        cellLabel: 'Clamp',
        defaults: { type: 'clampNumber', varName: 'health', min: 0, max: 100 },
        fields: [
          { key: 'varName', label: 'Number variable', control: 'text', placeholder: 'health' },
          { key: 'min', label: 'Minimum', control: expr, placeholder: '0' },
          { key: 'max', label: 'Maximum', control: expr, placeholder: '100' }
        ],
        note: 'Forces the variable into the Minimum..Maximum range (health that cannot pass 100 or drop below 0). Writes the result back into the same variable.'
      },
      {
        category: 'Variables',
        blockType: 'round-number',
        runtimeType: 'roundNumber',
        kind: 'action',
        label: 'Round Number',
        color: '#0891b2',
        cellLabel: 'Round',
        defaults: { type: 'roundNumber', varName: 'score', mode: 'nearest' },
        fields: [
          { key: 'varName', label: 'Number variable', control: 'text', placeholder: 'score' },
          { key: 'mode', label: 'Round to', control: 'select', options: [['nearest', 'Whole number'], ['down', 'Down (floor)'], ['up', 'Up (ceiling)'], ['dec1', '1 decimal place'], ['dec2', '2 decimal places']] }
        ],
        note: 'Rounds the variable and writes the result back into it. Use for score displays and tidy HUD numbers.'
      },
      {
        category: 'Variables',
        blockType: 'random-pick',
        runtimeType: 'randomPick',
        kind: 'action',
        label: 'Random Pick',
        color: '#0891b2',
        cellLabel: 'Pick',
        defaults: { type: 'randomPick', varName: 'deck', storeVarName: 'drawnCard' },
        fields: [
          { key: 'varName', label: 'From list', control: 'text', placeholder: 'deck' },
          { key: 'storeVarName', label: 'Into variable', control: 'text', placeholder: 'drawnCard' }
        ],
        note: 'Copies a random item from the list into another variable. Writes 0 when the list is empty or missing.'
      },
      {
        category: 'Variables',
        blockType: 'number-in-range-condition',
        runtimeType: 'numberInRange',
        kind: 'condition',
        label: 'Number In Range',
        color: '#0891b2',
        cellLabel: 'In Range?',
        defaults: { type: 'numberInRange', value: 'score', min: 0, max: 100, reversed: false },
        fields: [
          { key: 'value', label: 'Value', control: expr, placeholder: 'score' },
          { key: 'min', label: 'Minimum', control: expr, placeholder: '0' },
          { key: 'max', label: 'Maximum', control: expr, placeholder: '100' },
          { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
        ],
        note: 'True while the value sits between Minimum and Maximum, inclusive. A state read, so it stays true every frame the value is in range.'
      }
    ],
    // The field-control schema (see the header comment): the canonical
    // vocabulary every block field draws its control from.
    FIELD_CONTROLS: FIELD_CONTROLS,
    // Look a block up by its palette id. Returns the block or null; never throws.
    findBlock: function (blockType) {
      if (typeof blockType !== 'string' || !blockType) return null;
      const found = (this.blocks || []).find(b => b && b.blockType === blockType);
      return found || null;
    },
    // Validate a block list against the schema (no argument = this catalog).
    // An explicit null is NOT treated as "no argument": it is a caller error
    // and reports as such, so a bad call can never silently read as valid.
    // Returns an array of plain findings; empty means the list conforms.
    validateCatalog: function (list) {
      return validateCatalogBlocks(list === undefined ? this.blocks : list);
    }
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
      note: modeId === 'held' ? `True while ${label} is held down.`
        : modeId === 'pressed' ? `Fires once when ${label} is pressed.`
        : `Fires once when ${label} is released.`
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
      fields: [{ key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }],
      note: id === 'mouse-held'
        ? (button === 'any' ? 'True while any mouse button is held down.' : `True while the ${button} mouse button is held down.`)
        : id === 'mouse-pressed'
        ? (button === 'any' ? 'Fires once when any mouse button is pressed.' : `Fires once when the ${button} mouse button is pressed.`)
        : (button === 'any' ? 'Fires once when any mouse button is released.' : `Fires once when the ${button} mouse button is released.`)
    }));
  });
  const variables = ['score', 'health', 'ammo', 'coins', 'keys', 'wave', 'lives', 'energy', 'quest', 'timer', 'doorsOpen', 'bossHealth'];
  const varDisplay = { doorsOpen: 'doors open', bossHealth: 'boss health' };
  variables.forEach(name => {
    const disp = varDisplay[name] || name;
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
      ],
      note: `True while the ${disp} variable is at least the value you set.`
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
      fields: [{ key: 'value', label: 'Value', control: expr, placeholder: '1' }],
      note: operation === 'set' ? `Sets the ${disp} variable to the value you choose.`
        : operation === 'add' ? `Adds the value you choose to the ${disp} variable.`
        : `Subtracts the value you choose from the ${disp} variable.`
    }));
  });
  const moveNotes = {
    'move-left': 'Moves the object left at a steady speed.',
    'move-right': 'Moves the object right at a steady speed.',
    'move-up': 'Moves the object up at a steady speed.',
    'move-down': 'Moves the object down at a steady speed.',
    'jump-small': 'Gives the object a small upward jump.',
    'jump-high': 'Gives the object a high upward jump.',
    'dash-left': 'Dashes the object left in a quick burst.',
    'dash-right': 'Dashes the object right in a quick burst.',
    'fall-fast': 'Makes the object fall faster than normal gravity.',
    'stop-x': 'Stops the object horizontal movement.',
    'stop-y': 'Stops the object vertical movement.',
    'stop-all': 'Stops all of the object movement.'
  };
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
    fields: [{ key: 'targetObject', label: 'Object', control: obj }],
    note: moveNotes[id]
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
      fields: [{ key: 'targetObject', label: 'Object', control: obj }],
      note: `Sets gravity to the ${id} preset value (${gravity}).`
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
      fields: [{ key: 'targetObject', label: 'Object', control: obj }],
      note: `Sets friction to the ${id} preset value (${friction}).`
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
      fields: [{ key: 'targetObject', label: 'Object', control: obj }],
      note: `Caps speed at the ${id} preset value (${maxSpeed}).`
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
      fields: [{ key: 'targetObject', label: 'Object', control: obj }],
      note: `Tints the object ${colorName}.`
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
    fields: [{ key: 'targetObject', label: 'Object', control: obj }],
    note: value === 0 ? 'Sets the object opacity to 0 (fully invisible).'
      : value === 1 ? 'Sets the object opacity to 1 (fully solid).'
      : `Sets the object opacity to ${value}.`
  }));
  const flowNotes = {
    'camera-follow-player': 'Makes the camera follow the object as it moves.',
    'camera-origin': 'Moves the camera back to the top-left corner of the world (0, 0).',
    'shake-small': 'Shakes the screen a little for a light impact.',
    'shake-big': 'Shakes the screen hard for a big impact.',
    'flash-white': 'Flashes the screen white briefly, for a pickup or scene change.',
    'flash-red': 'Flashes the screen red briefly, for taking damage.',
    'timer-reset-spawn': 'Resets the spawn timer back to zero.',
    'timer-pause-spawn': 'Pauses the spawn timer where it is.',
    'save-score': 'Saves the score variable into the browser save slot.',
    'load-score': 'Loads the saved score variable back into the game.'
  };
  [
    ['camera-follow-player', 'Camera follows object', 'followCamera', { type: 'followCamera', targetObject: '', offsetX: 0, offsetY: 0 }],
    ['camera-origin', 'Camera to origin', 'setCamera', { type: 'setCamera', cameraX: 0, cameraY: 0 }],
    ['shake-small', 'Small screen shake', 'screenShake', { type: 'screenShake', strength: 3, duration: 0.15, cooldown: 0.15 }],
    ['shake-big', 'Big screen shake', 'screenShake', { type: 'screenShake', strength: 10, duration: 0.35, cooldown: 0.25 }],
    ['flash-white', 'White screen flash', 'screenFlash', { type: 'screenFlash', color: '#ffffff', intensity: 0.6, duration: 0.2 }],
    ['flash-red', 'Red damage flash', 'screenFlash', { type: 'screenFlash', color: '#ff0000', intensity: 0.7, duration: 0.25 }],
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
    fields: runtimeType === 'followCamera' ? [{ key: 'targetObject', label: 'Object', control: obj }] : [],
    note: flowNotes[id]
  }));
  // P4 Advanced (2D lighting/shadows): scene darkness + runtime light
  // control. Darkness is a scene-level dimmer; lights punch soft holes
  // in it; shadows stretch behind cast-shadow objects. The blocks work
  // in 2D scenes (3D scenes have their own lighting).
  addBlock({
    category: 'Lighting',
    blockType: 'set-darkness',
    runtimeType: 'setDarkness',
    kind: 'action',
    label: 'Set Darkness',
    color: '#eab308',
    cellLabel: 'Dark',
    defaults: { type: 'setDarkness', darkness: '0.8' },
    fields: [
      { key: 'darkness', label: 'Darkness', control: expr, placeholder: '0 = day, 1 = pitch black' }
    ],
    note: 'Dims the whole scene (0 = fully lit, 1 = pitch black). The live scene darkens instantly; lights punch holes in it. Fade to night by chaining Every Frame into Set Darkness with a slowly rising value, or snap to night with one block.'
  });
  addBlock({
    category: 'Lighting',
    blockType: 'set-light-2d',
    runtimeType: 'setLight2d',
    kind: 'action',
    label: 'Set Light',
    color: '#f59e0b',
    cellLabel: 'Light',
    defaults: { type: 'setLight2d', targetObject: '', radius: '220', color: '#ffffff', mode: 'on' },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'radius', label: 'Radius', control: expr, placeholder: '220' },
      { key: 'color', label: 'Color', control: 'color' },
      { key: 'mode', label: 'Light', control: 'select', options: [['on', 'On'], ['off', 'Off']] }
    ],
    note: 'Changes a light while the game runs: how far it shines (Radius), its tint (Color), or on/off. Any object can be a light — a Light object, or a sprite with Emit light checked in the Inspector. Flicker a torch by chaining Every Frame into Set Light with a wobbling radius.'
  });
  addBlock({
    category: 'Lighting',
    blockType: 'darkness-level-condition',
    runtimeType: 'darknessLevel',
    kind: 'condition',
    label: 'Darkness Level',
    color: '#ca8a04',
    cellLabel: 'Dark?',
    defaults: { type: 'darknessLevel', darkness: '0.5', operator: '>=', reversed: false },
    fields: [
      { key: 'darkness', label: 'Darkness', control: expr, placeholder: '0.5' },
      { key: 'operator', label: 'Operator', control: 'select', options: [['<=', 'At most'], ['>=', 'At least'], ['==', 'Exactly'], ['!=', 'Not'], ['<', 'Less than'], ['>', 'More than']] },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the scene darkness compares to the value (0 = fully lit, 1 = pitch black). Gate night behavior with it: when it is dark enough, the bats come out. Evaluates every frame like a variable read, even while paused.'
  });
  // P4 Advanced (physics joints): rods, ropes, and springs linking two
  // objects by name. The solver runs every frame in preview and exports;
  // the Inspector Joints section is the no-blocks way to add them.
  addBlock({
    category: 'Physics',
    blockType: 'create-joint',
    runtimeType: 'createJoint',
    kind: 'action',
    label: 'Create Joint',
    color: '#b45309',
    cellLabel: 'Joint',
    defaults: { type: 'createJoint', object1: '', object2: '', jointType: 'rope', length: '', stiffness: '0.05' },
    fields: [
      { key: 'object1', label: 'Object A', control: obj },
      { key: 'object2', label: 'Object B', control: obj },
      { key: 'jointType', label: 'Joint type', control: 'select', options: [['distance', 'Distance (rigid rod)'], ['rope', 'Rope (max length)'], ['spring', 'Spring (stretchy)']] },
      { key: 'length', label: 'Length', control: expr, placeholder: 'blank = current distance' },
      { key: 'stiffness', label: 'Stiffness', control: expr, placeholder: '0.05 (spring only)' }
    ],
    note: 'Links two objects: Distance holds their centers a fixed length apart like a rigid rod, Rope lets them come closer but never stretch past the length like a chain, Spring pulls them toward the length like a stretchy cord. Leave Length blank to use the distance they are apart right now. Static objects act as anchors that never move.'
  });
  addBlock({
    category: 'Physics',
    blockType: 'remove-joint',
    runtimeType: 'removeJoint',
    kind: 'action',
    label: 'Remove Joint',
    color: '#92400e',
    cellLabel: 'Unjoint',
    defaults: { type: 'removeJoint', object1: '', object2: '' },
    fields: [
      { key: 'object1', label: 'Object A', control: obj },
      { key: 'object2', label: 'Object B', control: obj }
    ],
    note: 'Unlinks two objects: removes their joint. Leave Object B blank to remove every joint involving Object A. Removing a joint that does not exist does nothing.'
  });
  addBlock({
    category: 'Physics',
    blockType: 'joint-connected-condition',
    runtimeType: 'jointConnected',
    kind: 'condition',
    label: 'Joint Connected',
    color: '#d97706',
    cellLabel: 'Joint?',
    defaults: { type: 'jointConnected', object1: '', object2: '', reversed: false },
    fields: [
      { key: 'object1', label: 'Object A', control: obj },
      { key: 'object2', label: 'Object B', control: obj },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while a joint links the two objects (either direction). Leave Object B blank to test whether Object A has any joint at all. Evaluates every frame like a variable read, even while paused.'
  });
  // P4 Advanced (skeletal animation): bone rigs + keyframed angle tracks.
  // Bones live on the object (Inspector Skeleton section); these blocks
  // drive them at runtime. Playing a track wins over the base pose, and
  // Set Bone Angle wins over a track until a new animation starts.
  addBlock({
    category: 'Skeleton',
    blockType: 'play-skeleton-animation',
    runtimeType: 'playSkeletonAnimation',
    kind: 'action',
    label: 'Play Skeleton Animation',
    color: '#7c3aed',
    cellLabel: 'SkelAnim',
    defaults: { type: 'playSkeletonAnimation', object1: '', animation: '' },
    fields: [
      { key: 'object1', label: 'Object', control: obj },
      { key: 'animation', label: 'Animation', control: 'text', placeholder: 'e.g. Walk' }
    ],
    note: 'Plays one of the object\'s skeletal animations from the Inspector Skeleton section. Unknown animation names warn and hold the old animation; blank stays quiet. Re-playing the same animation keeps its clock, so playing it every frame does not restart the cycle.'
  });
  addBlock({
    category: 'Skeleton',
    blockType: 'stop-skeleton-animation',
    runtimeType: 'stopSkeletonAnimation',
    kind: 'action',
    label: 'Stop Skeleton Animation',
    color: '#6d28d9',
    cellLabel: 'StopSkel',
    defaults: { type: 'stopSkeletonAnimation', object1: '', animation: '' },
    fields: [
      { key: 'object1', label: 'Object', control: obj },
      { key: 'animation', label: 'Animation', control: 'text', placeholder: 'blank = active animation' }
    ],
    note: 'Stops the object\'s skeletal animation. Leave Animation blank to stop whichever animation is active. The pose returns to the bones\' base angles (plus any Set Bone Angle poses). Stopping an animation that is not playing does nothing.'
  });
  addBlock({
    category: 'Skeleton',
    blockType: 'set-bone-angle',
    runtimeType: 'setBoneAngle',
    kind: 'action',
    label: 'Set Bone Angle',
    color: '#5b21b6',
    cellLabel: 'BoneAngle',
    defaults: { type: 'setBoneAngle', object1: '', bone: '', angle: '0' },
    fields: [
      { key: 'object1', label: 'Object', control: obj },
      { key: 'bone', label: 'Bone', control: 'text', placeholder: 'e.g. arm' },
      { key: 'angle', label: 'Angle', control: expr, placeholder: 'degrees, 0 = right' }
    ],
    note: 'Poses one bone by hand, in degrees (0 points right, 90 points down). A posed bone wins over a playing animation track until a new skeletal animation starts, so a walk cycle plus a hand-aimed arm is one block per frame. Unknown bones and bad angles warn and hold; blank stays quiet.'
  });
  addBlock({
    category: 'Skeleton',
    blockType: 'skeleton-playing-condition',
    runtimeType: 'skeletonPlaying',
    kind: 'condition',
    label: 'Skeleton Playing',
    color: '#8b5cf6',
    cellLabel: 'Skel?',
    defaults: { type: 'skeletonPlaying', object1: '', animation: '', reversed: false },
    fields: [
      { key: 'object1', label: 'Object', control: obj },
      { key: 'animation', label: 'Animation', control: 'text', placeholder: 'e.g. Walk' },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the object\'s chosen skeletal animation is playing. A finished once-run animation reads false (its pose holds, its playing stops). Evaluates every frame like a variable read, even while paused.'
  });
  // P4 Advanced (localization): one string table for the whole game.
  // Keys live on the project (Localization tab); these blocks switch the
  // language and read from the table at runtime. Missing translations
  // fall back to the default language; missing everywhere warns + holds.
  addBlock({
    category: 'Localization',
    blockType: 'set-language',
    runtimeType: 'setLanguage',
    kind: 'action',
    label: 'Set Language',
    color: '#0e7490',
    cellLabel: 'Lang',
    defaults: { type: 'setLanguage', language: '' },
    fields: [
      { key: 'language', label: 'Language', control: 'text', placeholder: 'e.g. es' }
    ],
    note: 'Switches the whole game to a language from the Localization tab (for example es). Every text object bound to a key re-reads its translation at once. Unknown language codes warn and hold the old language; blank stays quiet.'
  });
  addBlock({
    category: 'Localization',
    blockType: 'set-text-from-key',
    runtimeType: 'setTextFromKey',
    kind: 'action',
    label: 'Set Text from Key',
    color: '#0891b2',
    cellLabel: 'TextKey',
    defaults: { type: 'setTextFromKey', object1: '', key: '' },
    fields: [
      { key: 'object1', label: 'Object', control: obj },
      { key: 'key', label: 'Key', control: 'text', placeholder: 'e.g. play_button' }
    ],
    note: 'Sets a text object\'s displayed text to the key\'s translation in the current language (falling back to the default language). Only text objects change; other kinds are skipped. Unknown keys warn and hold the old text; blank stays quiet.'
  });
  addBlock({
    category: 'Localization',
    blockType: 'set-variable-from-key',
    runtimeType: 'setVariableFromKey',
    kind: 'action',
    label: 'Set Variable from Key',
    color: '#06b6d4',
    cellLabel: 'VarKey',
    defaults: { type: 'setVariableFromKey', varName: '', key: '' },
    fields: [
      { key: 'varName', label: 'Into variable', control: 'text', placeholder: 'greeting' },
      { key: 'key', label: 'Key', control: 'text', placeholder: 'e.g. play_button' }
    ],
    note: 'Copies a key\'s translation in the current language (falling back to the default language) into a game variable, so translated text can feed dialogs, Set Text, or any other block. Unknown keys warn and hold the old value; blank stays quiet.'
  });
  addBlock({
    category: 'Localization',
    blockType: 'language-is-condition',
    runtimeType: 'languageIs',
    kind: 'condition',
    label: 'Language Is',
    color: '#22d3ee',
    cellLabel: 'Lang?',
    defaults: { type: 'languageIs', language: '', reversed: false },
    fields: [
      { key: 'language', label: 'Language', control: 'text', placeholder: 'e.g. es' },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the game\'s current language is the named one (for example, show the Spanish-only help card). Evaluates every frame like a variable read, even while paused.'
  });
  // P4 Advanced batch 7 (dialogue): named conversations from the
  // Dialogues tab, run with a typewriter reveal into two text objects
  // the author picks (a panel + speaker label + text label built from
  // ordinary objects). Choices are the author's own buttons: Set Choice
  // Text writes a choice's label into a text object, Dialogue Choice
  // Available gates each button, Choose Dialogue Option picks. Blank
  // dialogue names stay quiet; unknown names warn and hold.
  addBlock({
    category: 'Dialogue',
    blockType: 'start-dialogue',
    runtimeType: 'startDialogue',
    kind: 'action',
    label: 'Start Dialogue',
    color: '#7c3aed',
    cellLabel: 'Talk',
    defaults: { type: 'startDialogue', dialogue: '', speakerObject: '', textObject: '', typingSpeed: 40 },
    fields: [
      { key: 'dialogue', label: 'Dialogue', control: 'text', placeholder: 'e.g. Guard intro' },
      { key: 'speakerObject', label: 'Speaker text object', control: obj },
      { key: 'textObject', label: 'Line text object', control: obj },
      { key: 'typingSpeed', label: 'Typing speed (chars/sec, 0 = instant)', control: 'number', min: 0, max: 200, step: 1 }
    ],
    note: 'Starts a dialogue from the Dialogues tab: the speaker name and the line appear in the two text objects you pick, revealed letter by letter. Starting a dialogue that is already running restarts it from the first line. Unknown names warn and hold; blank stays quiet.'
  });
  addBlock({
    category: 'Dialogue',
    blockType: 'advance-dialogue',
    runtimeType: 'advanceDialogue',
    kind: 'action',
    label: 'Advance Dialogue',
    color: '#8b5cf6',
    cellLabel: 'Next',
    defaults: { type: 'advanceDialogue' },
    fields: [],
    note: 'Moves the running dialogue one step: finishes the current line\'s typing first, then goes to the next line (past the last line it ends). Stays quiet on a choice line — the player has to pick — and when no dialogue is running. Wire it to a key or a Next button.'
  });
  addBlock({
    category: 'Dialogue',
    blockType: 'choose-dialogue-option',
    runtimeType: 'chooseDialogueOption',
    kind: 'action',
    label: 'Choose Dialogue Option',
    color: '#6d28d9',
    cellLabel: 'Pick',
    defaults: { type: 'chooseDialogueOption', option: 1 },
    fields: [
      { key: 'option', label: 'Option number', control: 'number', min: 1, max: 20, step: 1 }
    ],
    note: 'Picks the numbered choice (1 is the first) while the dialogue is waiting for one, jumping to the line that choice points at. A choice with no line to jump to ends the dialogue. An option number with no such choice warns and holds; picking when the dialogue is not waiting stays quiet.'
  });
  addBlock({
    category: 'Dialogue',
    blockType: 'stop-dialogue',
    runtimeType: 'stopDialogue',
    kind: 'action',
    label: 'Stop Dialogue',
    color: '#5b21b6',
    cellLabel: 'EndTalk',
    defaults: { type: 'stopDialogue' },
    fields: [],
    note: 'Ends the running dialogue at once. The speaker and text labels keep the last line that was showing — hide the dialogue panel with Dialogue Active (inverted) if you want it to disappear. Stays quiet when no dialogue is running.'
  });
  addBlock({
    category: 'Dialogue',
    blockType: 'set-dialogue-choice-text',
    runtimeType: 'setDialogueChoiceText',
    kind: 'action',
    label: 'Set Choice Text',
    color: '#a78bfa',
    cellLabel: 'Choice',
    defaults: { type: 'setDialogueChoiceText', object1: '', option: 1 },
    fields: [
      { key: 'object1', label: 'Object', control: obj },
      { key: 'option', label: 'Option number', control: 'number', min: 1, max: 20, step: 1 }
    ],
    note: 'Writes the numbered choice\'s label into a text object, so you can build your own choice buttons (one button + label per option). Run it while the dialogue is waiting for a choice. An option number with no such choice warns and holds; blank stays quiet.'
  });
  addBlock({
    category: 'Dialogue',
    blockType: 'dialogue-active-condition',
    runtimeType: 'dialogueActive',
    kind: 'condition',
    label: 'Dialogue Active',
    color: '#c4b5fd',
    cellLabel: 'Talk?',
    defaults: { type: 'dialogueActive', reversed: false },
    fields: [
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while any dialogue is running. Use it to show the dialogue panel when a conversation starts (and, inverted, to hide it when the conversation ends). Evaluates every frame like a variable read, even while paused.'
  });
  addBlock({
    category: 'Dialogue',
    blockType: 'dialogue-waiting-choice-condition',
    runtimeType: 'dialogueWaitingChoice',
    kind: 'condition',
    label: 'Dialogue Waiting For Choice',
    color: '#ddd6fe',
    cellLabel: 'Pick?',
    defaults: { type: 'dialogueWaitingChoice', reversed: false },
    fields: [
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the running dialogue has fully revealed a choice line and is waiting for the player to pick. Use it to show the choice buttons (and hide the Next button). Evaluates every frame like a variable read, even while paused.'
  });
  addBlock({
    category: 'Dialogue',
    blockType: 'dialogue-choice-available-condition',
    runtimeType: 'dialogueChoiceAvailable',
    kind: 'condition',
    label: 'Dialogue Choice Available',
    color: '#ede9fe',
    cellLabel: 'Opt?',
    defaults: { type: 'dialogueChoiceAvailable', option: 1, reversed: false },
    fields: [
      { key: 'option', label: 'Option number', control: 'number', min: 1, max: 20, step: 1 },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the dialogue is waiting for a choice AND the numbered option exists (1 is the first). Use one per choice button so a two-choice conversation never shows a third empty button. Evaluates every frame like a variable read, even while paused.'
  });
  // P4 Advanced batch 8 (inventory): the backpack the player carries.
  // Items are defined in the Items tab (name + max stack + a short
  // description); blocks add, remove, set, and read counts, and the
  // conditions gate doors, shops, and quests on what is carried.
  // Blank item names stay quiet; unknown names and bad counts warn
  // and hold. The backpack survives scene switches and resets on a
  // fresh run; it is not part of save slots (persist counts through
  // Read Item Count into a variable, then Set Item Count on load).
  addBlock({
    category: 'Inventory',
    blockType: 'add-item',
    runtimeType: 'addItem',
    kind: 'action',
    label: 'Add Item',
    color: '#b45309',
    cellLabel: 'AddIt',
    defaults: { type: 'addItem', item: '', count: 1 },
    fields: [
      { key: 'item', label: 'Item', control: 'text', placeholder: 'e.g. Brass key' },
      { key: 'count', label: 'Count', control: expr, placeholder: '1' }
    ],
    note: 'Adds the count of the named item to the backpack, up to its max stack (a max stack of 1 makes a unique item, so a second key can never sneak in). Unknown items and bad counts warn and hold; blank stays quiet.'
  });
  addBlock({
    category: 'Inventory',
    blockType: 'remove-item',
    runtimeType: 'removeItem',
    kind: 'action',
    label: 'Remove Item',
    color: '#92400e',
    cellLabel: 'RemIt',
    defaults: { type: 'removeItem', item: '', count: 1 },
    fields: [
      { key: 'item', label: 'Item', control: 'text', placeholder: 'e.g. Gold coin' },
      { key: 'count', label: 'Count', control: expr, placeholder: '1' }
    ],
    note: 'Removes up to the count of the named item from the backpack (removing more than is carried takes what is there). The entry drops when its count reaches 0. Unknown items and bad counts warn and hold; blank stays quiet.'
  });
  addBlock({
    category: 'Inventory',
    blockType: 'set-item-count',
    runtimeType: 'setItemCount',
    kind: 'action',
    label: 'Set Item Count',
    color: '#d97706',
    cellLabel: 'SetIt',
    defaults: { type: 'setItemCount', item: '', count: 0 },
    fields: [
      { key: 'item', label: 'Item', control: 'text', placeholder: 'e.g. Gold coin' },
      { key: 'count', label: 'Count', control: expr, placeholder: '0' }
    ],
    note: 'Sets the named item\'s count outright, clamped to 0 up to its max stack (0 drops the entry). Use it to restore a saved count after Load Game, or to hand the player an exact amount. Unknown items and bad counts warn and hold; blank stays quiet.'
  });
  addBlock({
    category: 'Inventory',
    blockType: 'read-item-count',
    runtimeType: 'readItemCount',
    kind: 'action',
    label: 'Read Item Count',
    color: '#a16207',
    cellLabel: 'ReadIt',
    defaults: { type: 'readItemCount', item: '', varName: '' },
    fields: [
      { key: 'item', label: 'Item', control: 'text', placeholder: 'e.g. Gold coin' },
      { key: 'varName', label: 'Into variable', control: 'text', placeholder: 'e.g. coinCount' }
    ],
    note: 'Copies how many of the named item the backpack holds into a game variable, so you can show the count in a label, compare it, or save it with Save Game (then restore it with Set Item Count after Load Game). A defined item with nothing carried reads 0; unknown items warn and hold.'
  });
  addBlock({
    category: 'Inventory',
    blockType: 'clear-inventory',
    runtimeType: 'clearInventory',
    kind: 'action',
    label: 'Clear Inventory',
    color: '#78350f',
    cellLabel: 'ClearIt',
    defaults: { type: 'clearInventory' },
    fields: [],
    note: 'Empties the whole backpack at once — every item drops to 0. Use it for a new game, a fresh level, or a "lose everything" trap.'
  });
  addBlock({
    category: 'Inventory',
    blockType: 'has-item-condition',
    runtimeType: 'hasItem',
    kind: 'condition',
    label: 'Has Item',
    color: '#f59e0b',
    cellLabel: 'Has?',
    defaults: { type: 'hasItem', item: '', count: 1, reversed: false },
    fields: [
      { key: 'item', label: 'Item', control: 'text', placeholder: 'e.g. Brass key' },
      { key: 'count', label: 'At least', control: expr, placeholder: '1' },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the backpack holds at least the count of the named item (1 by default). Gate a locked door on Has Item "Brass key", or a shop on Has Item "Gold coin" 10. An item the backpack never held reads false. Evaluates every frame like a variable read, even while paused.'
  });
  addBlock({
    category: 'Inventory',
    blockType: 'item-count-condition',
    runtimeType: 'itemCount',
    kind: 'condition',
    label: 'Item Count',
    color: '#fbbf24',
    cellLabel: 'Count?',
    defaults: { type: 'itemCount', item: '', operator: '>=', value: 0, reversed: false },
    fields: [
      { key: 'item', label: 'Item', control: 'text', placeholder: 'e.g. Gold coin' },
      { key: 'operator', label: 'Compare', control: 'select', options: [['>=', 'At least (count >=)'], ['<=', 'At most (count <=)'], ['==', 'Exactly (count ==)'], ['!=', 'Not (count !=)'], ['>', 'More than (count >)'], ['<', 'Less than (count <)']] },
      { key: 'value', label: 'Value', control: expr, placeholder: '0' },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the named item\'s count compares against the value you enter. An item the backpack never held reads as 0. Evaluates every frame like a variable read, even while paused.'
  });
  // P4 Advanced batch 9 (quests): the objectives the player works
  // through. Quests are defined in the Quests tab (name + target +
  // a short description); blocks add, set, read, complete, and reset
  // progress, and the conditions gate rewards, doors, and endings on
  // what is finished. Blank quest names stay quiet; unknown names
  // and bad amounts warn and hold. The log survives scene switches
  // and resets on a fresh run; it is not part of save slots (persist
  // progress through Read Quest Progress into a variable, then Set
  // Quest Progress on load).
  addBlock({
    category: 'Quest',
    blockType: 'add-quest-progress',
    runtimeType: 'addQuestProgress',
    kind: 'action',
    label: 'Add Quest Progress',
    color: '#15803d',
    cellLabel: 'AddQst',
    defaults: { type: 'addQuestProgress', quest: '', amount: 1 },
    fields: [
      { key: 'quest', label: 'Quest', control: 'text', placeholder: 'e.g. Collect 4 coins' },
      { key: 'amount', label: 'Amount', control: expr, placeholder: '1' }
    ],
    note: 'Adds the amount of progress to the named quest, up to its target — adding past the target fills it and completes the quest. Unknown quests and bad amounts warn and hold; blank stays quiet.'
  });
  addBlock({
    category: 'Quest',
    blockType: 'set-quest-progress',
    runtimeType: 'setQuestProgress',
    kind: 'action',
    label: 'Set Quest Progress',
    color: '#16a34a',
    cellLabel: 'SetQst',
    defaults: { type: 'setQuestProgress', quest: '', amount: 0 },
    fields: [
      { key: 'quest', label: 'Quest', control: 'text', placeholder: 'e.g. Collect 4 coins' },
      { key: 'amount', label: 'Amount', control: expr, placeholder: '0' }
    ],
    note: 'Sets the named quest\'s progress outright, clamped to 0 up to its target (reaching the target completes it; setting it back below un-completes it). Use it to restore a saved progress after Load Game, or to hand the player an exact amount. Unknown quests and bad amounts warn and hold; blank stays quiet.'
  });
  addBlock({
    category: 'Quest',
    blockType: 'complete-quest',
    runtimeType: 'completeQuest',
    kind: 'action',
    label: 'Complete Quest',
    color: '#166534',
    cellLabel: 'Done!',
    defaults: { type: 'completeQuest', quest: '' },
    fields: [
      { key: 'quest', label: 'Quest', control: 'text', placeholder: 'e.g. Reach the goal' }
    ],
    note: 'Completes the named quest at once: its progress fills to the target and it reads as done. Use it for one-shot quests — reaching the goal, talking to the guard — where there is nothing to count. Unknown quests warn and hold; blank stays quiet.'
  });
  addBlock({
    category: 'Quest',
    blockType: 'reset-quest',
    runtimeType: 'resetQuest',
    kind: 'action',
    label: 'Reset Quest',
    color: '#14532d',
    cellLabel: 'ResetQ',
    defaults: { type: 'resetQuest', quest: '' },
    fields: [
      { key: 'quest', label: 'Quest', control: 'text', placeholder: 'e.g. Collect 4 coins' }
    ],
    note: 'Resets the named quest to never started: its progress and its done flag both drop. Use it for a replayable quest, or a "try again" after a failed run. Unknown quests warn and hold; blank stays quiet.'
  });
  addBlock({
    category: 'Quest',
    blockType: 'read-quest-progress',
    runtimeType: 'readQuestProgress',
    kind: 'action',
    label: 'Read Quest Progress',
    color: '#22c55e',
    cellLabel: 'ReadQst',
    defaults: { type: 'readQuestProgress', quest: '', varName: '' },
    fields: [
      { key: 'quest', label: 'Quest', control: 'text', placeholder: 'e.g. Collect 4 coins' },
      { key: 'varName', label: 'Into variable', control: 'text', placeholder: 'e.g. coinsFound' }
    ],
    note: 'Copies how much progress the named quest has into a game variable, so you can show it in a label, compare it, or save it with Save Game (then restore it with Set Quest Progress after Load Game). A defined quest with no progress yet reads 0; unknown quests warn and hold.'
  });
  addBlock({
    category: 'Quest',
    blockType: 'clear-quests',
    runtimeType: 'clearQuests',
    kind: 'action',
    label: 'Clear Quests',
    color: '#052e16',
    cellLabel: 'ClearQ',
    defaults: { type: 'clearQuests' },
    fields: [],
    note: 'Empties the whole quest log at once — every quest drops to 0 progress and not done. Use it for a new game, or a "lose all progress" trap.'
  });
  addBlock({
    category: 'Quest',
    blockType: 'quest-complete-condition',
    runtimeType: 'questComplete',
    kind: 'condition',
    label: 'Quest Complete',
    color: '#4ade80',
    cellLabel: 'QDone?',
    defaults: { type: 'questComplete', quest: '', reversed: false },
    fields: [
      { key: 'quest', label: 'Quest', control: 'text', placeholder: 'e.g. Collect 4 coins' },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the named quest is complete. Put it on edge trigger to fire once, exactly when the quest completes — the reward hook (give the key, open the door, show the ending). An unfinished or unknown quest reads false. Evaluates every frame like a variable read, even while paused.'
  });
  addBlock({
    category: 'Quest',
    blockType: 'quest-progress-condition',
    runtimeType: 'questProgress',
    kind: 'condition',
    label: 'Quest Progress',
    color: '#86efac',
    cellLabel: 'QProg?',
    defaults: { type: 'questProgress', quest: '', operator: '>=', value: 0, reversed: false },
    fields: [
      { key: 'quest', label: 'Quest', control: 'text', placeholder: 'e.g. Collect 4 coins' },
      { key: 'operator', label: 'Compare', control: 'select', options: [['>=', 'At least (progress >=)'], ['<=', 'At most (progress <=)'], ['==', 'Exactly (progress ==)'], ['!=', 'Not (progress !=)'], ['>', 'More than (progress >)'], ['<', 'Less than (progress <)']] },
      { key: 'value', label: 'Value', control: expr, placeholder: '0' },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the named quest\'s progress compares against the value you enter. A quest with no progress yet reads as 0. Use it for "almost there" hints a finished-or-not check cannot express. Evaluates every frame like a variable read, even while paused.'
  });
  // P4 Advanced batch 10 (achievements): the permanent trophies the
  // player earns. Achievements are defined in the Achievements tab
  // (name + a short description); blocks unlock, lock, reset, and
  // count them, and the conditions gate rewards, endings, and
  // trophy-room displays on what is earned. Unlike quests, which
  // reset on a fresh run, achievements are PERMANENT — once unlocked
  // they stay unlocked across runs, scenes, and restarts, until
  // Lock Achievement or Reset Achievements takes them back. Blank
  // names stay quiet; unknown names warn and hold.
  addBlock({
    category: 'Achievement',
    blockType: 'unlock-achievement',
    runtimeType: 'unlockAchievement',
    kind: 'action',
    label: 'Unlock Achievement',
    color: '#b45309',
    cellLabel: 'Unlock!',
    defaults: { type: 'unlockAchievement', achievement: '' },
    fields: [
      { key: 'achievement', label: 'Achievement', control: 'text', placeholder: 'e.g. Coin hoarder' }
    ],
    note: 'Unlocks the named achievement for good: it stays unlocked across runs, scenes, and restarts. Unlocking one that is already unlocked changes nothing. Unknown achievements warn and hold; blank stays quiet.'
  });
  addBlock({
    category: 'Achievement',
    blockType: 'lock-achievement',
    runtimeType: 'lockAchievement',
    kind: 'action',
    label: 'Lock Achievement',
    color: '#92400e',
    cellLabel: 'LockAch',
    defaults: { type: 'lockAchievement', achievement: '' },
    fields: [
      { key: 'achievement', label: 'Achievement', control: 'text', placeholder: 'e.g. Coin hoarder' }
    ],
    note: 'Locks the named achievement again, so it reads as never earned. Use it for a "reset this trophy" option, or for testing an unlock flow. Unknown achievements warn and hold; blank stays quiet.'
  });
  addBlock({
    category: 'Achievement',
    blockType: 'reset-achievements',
    runtimeType: 'resetAchievements',
    kind: 'action',
    label: 'Reset Achievements',
    color: '#451a03',
    cellLabel: 'ResetA',
    defaults: { type: 'resetAchievements' },
    fields: [],
    note: 'Locks every achievement at once — the whole trophy case empties. Use it for a "reset progress" menu, or to test unlock flows from scratch.'
  });
  addBlock({
    category: 'Achievement',
    blockType: 'read-achievement-count',
    runtimeType: 'readAchievementCount',
    kind: 'action',
    label: 'Read Achievement Count',
    color: '#d97706',
    cellLabel: 'ReadAch',
    defaults: { type: 'readAchievementCount', varName: '' },
    fields: [
      { key: 'varName', label: 'Into variable', control: 'text', placeholder: 'e.g. trophies' }
    ],
    note: 'Copies how many achievements are unlocked into a game variable, so you can show the count in a label or save it with Save Game.'
  });
  addBlock({
    category: 'Achievement',
    blockType: 'achievement-unlocked-condition',
    runtimeType: 'achievementUnlocked',
    kind: 'condition',
    label: 'Achievement Unlocked',
    color: '#f59e0b',
    cellLabel: 'AchDone?',
    defaults: { type: 'achievementUnlocked', achievement: '', reversed: false },
    fields: [
      { key: 'achievement', label: 'Achievement', control: 'text', placeholder: 'e.g. Coin hoarder' },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the named achievement is unlocked. Put it on edge trigger to fire once, exactly when the trophy is earned — the celebration hook (show the badge, play the fanfare). A locked or unknown achievement reads false. Evaluates every frame like a variable read, even while paused.'
  });
  addBlock({
    category: 'Achievement',
    blockType: 'achievement-count-condition',
    runtimeType: 'achievementCount',
    kind: 'condition',
    label: 'Achievement Count',
    color: '#fbbf24',
    cellLabel: 'AchCnt?',
    defaults: { type: 'achievementCount', operator: '>=', value: 0, reversed: false },
    fields: [
      { key: 'operator', label: 'Compare', control: 'select', options: [['>=', 'At least (count >=)'], ['<=', 'At most (count <=)'], ['==', 'Exactly (count ==)'], ['!=', 'Not (count !=)'], ['>', 'More than (count >)'], ['<', 'Less than (count <)']] },
      { key: 'value', label: 'Value', control: expr, placeholder: '0' },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the number of unlocked achievements compares against the value you enter. Use it for veteran rewards — a badge at 3 trophies, a secret door at all of them. Evaluates every frame like a variable read, even while paused.'
  });
  // P4 Advanced batch 11 (cutscenes): the scripted scenes the game
  // plays by itself. Cutscenes are defined in the Cutscenes tab (name
  // + steps: wait, show text, move an object, play a sound, switch
  // scene); blocks play and stop them, and the conditions gate what
  // happens while one runs and when it ends. A cutscene freezes while
  // the game is paused; stopping one counts as finished, so a skip
  // button runs the same hook as a natural ending. Blank cutscene
  // names stay quiet; unknown names warn and hold. The runtime
  // survives scene switches and resets on a fresh run; it is not
  // part of save slots (replay the cutscene after Load Game, or skip
  // it with a Cutscene Finished gate).
  addBlock({
    category: 'Cutscene',
    blockType: 'play-cutscene',
    runtimeType: 'playCutscene',
    kind: 'action',
    label: 'Play Cutscene',
    color: '#7c3aed',
    cellLabel: 'PlayCine',
    defaults: { type: 'playCutscene', cutscene: '' },
    fields: [
      { key: 'cutscene', label: 'Cutscene', control: 'text', placeholder: 'e.g. Intro' }
    ],
    note: 'Plays the named cutscene from its first step, replacing any cutscene already playing. The steps run in order on their own — waits, captions, glides, sounds, scene switches — until the last step ends. Unknown cutscenes warn and hold; blank stays quiet.'
  });
  addBlock({
    category: 'Cutscene',
    blockType: 'stop-cutscene',
    runtimeType: 'stopCutscene',
    kind: 'action',
    label: 'Stop Cutscene',
    color: '#6d28d9',
    cellLabel: 'StopCine',
    defaults: { type: 'stopCutscene', cutscene: '' },
    fields: [
      { key: 'cutscene', label: 'Cutscene', control: 'text', placeholder: 'e.g. Intro (blank = any)' }
    ],
    note: 'Stops the running cutscene — a skip button. Stopping counts as finished, so the Cutscene Finished hook runs just as it would at a natural ending. Leave the name blank to stop whichever cutscene is playing; a name stops only that one. Unknown cutscenes warn and hold; blank with nothing playing stays quiet.'
  });
  addBlock({
    category: 'Cutscene',
    blockType: 'cutscene-playing-condition',
    runtimeType: 'cutscenePlaying',
    kind: 'condition',
    label: 'Cutscene Playing',
    color: '#a78bfa',
    cellLabel: 'Cine?',
    defaults: { type: 'cutscenePlaying', cutscene: '', reversed: false },
    fields: [
      { key: 'cutscene', label: 'Cutscene', control: 'text', placeholder: 'e.g. Intro (blank = any)' },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the named cutscene is playing. Leave the name blank to mean any cutscene — the gate for hiding the HUD and locking player input while a scene plays. Evaluates every frame like a variable read, even while paused.'
  });
  addBlock({
    category: 'Cutscene',
    blockType: 'cutscene-finished-condition',
    runtimeType: 'cutsceneFinished',
    kind: 'condition',
    label: 'Cutscene Finished',
    color: '#c4b5fd',
    cellLabel: 'CineDone?',
    defaults: { type: 'cutsceneFinished', cutscene: '', reversed: false },
    fields: [
      { key: 'cutscene', label: 'Cutscene', control: 'text', placeholder: 'e.g. Intro (blank = any)' },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True once the named cutscene has finished — a natural ending or a stop both count, so a skip button lands in the same place. Put it on edge trigger to fire once, exactly when the scene ends — the switch-to-level hook. Leave the name blank to mean whichever cutscene finished most recently. Evaluates every frame like a variable read, even while paused.'
  });
  // P4 Advanced batch 12 (high scores): the ranked leaderboard a game
  // keeps for itself. The table is configured in the High Scores tab
  // (how many entries it holds, the default name for a blank submit);
  // blocks submit a score, read a rank back into variables, and clear
  // the table, and the conditions gate on whether a score would make
  // the table and on how many scores it holds. Like achievements the
  // table is PERMANENT — a score stays on the board across runs,
  // scenes, and restarts, until Clear High Scores takes it back.
  // A score that does not make a full table is a quiet no-op; a
  // non-numeric score warns and holds.
  addBlock({
    category: 'High Score',
    blockType: 'submit-score',
    runtimeType: 'submitScore',
    kind: 'action',
    label: 'Submit Score',
    color: '#047857',
    cellLabel: 'Submit',
    defaults: { type: 'submitScore', score: 0, name: '' },
    fields: [
      { key: 'score', label: 'Score', control: expr, placeholder: '0' },
      { key: 'name', label: 'Name', control: 'text', placeholder: 'e.g. Alex (blank = default name)' }
    ],
    note: 'Submits a score to the ranked table, best first. A blank name uses the default name from the High Scores tab. A score that does not beat the lowest entry on a full table changes nothing; a non-numeric score warns and holds.'
  });
  addBlock({
    category: 'High Score',
    blockType: 'clear-high-scores',
    runtimeType: 'clearHighScores',
    kind: 'action',
    label: 'Clear High Scores',
    color: '#064e3b',
    cellLabel: 'ClearHS',
    defaults: { type: 'clearHighScores' },
    fields: [],
    note: 'Empties the whole leaderboard at once. Use it for a "reset progress" menu, or to test a submit flow from scratch.'
  });
  addBlock({
    category: 'High Score',
    blockType: 'read-high-score',
    runtimeType: 'readHighScore',
    kind: 'action',
    label: 'Read High Score',
    color: '#059669',
    cellLabel: 'ReadHS',
    defaults: { type: 'readHighScore', rank: 1, varName: '', nameVarName: '' },
    fields: [
      { key: 'rank', label: 'Rank', control: expr, placeholder: '1' },
      { key: 'varName', label: 'Into score variable', control: 'text', placeholder: 'e.g. topScore' },
      { key: 'nameVarName', label: 'Into name variable', control: 'text', placeholder: 'e.g. topName' }
    ],
    note: 'Copies the score at the rank you enter (1 is the best) into a game variable, and its name into a second variable, so you can show the board in labels. A rank past the end of the table writes nothing; leave a variable blank to skip it.'
  });
  addBlock({
    category: 'High Score',
    blockType: 'is-high-score-condition',
    runtimeType: 'isHighScore',
    kind: 'condition',
    label: 'Is High Score',
    color: '#10b981',
    cellLabel: 'IsHS?',
    defaults: { type: 'isHighScore', score: 0, reversed: false },
    fields: [
      { key: 'score', label: 'Score', control: expr, placeholder: '0' },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the score would make the leaderboard — the table has room, or the score beats its lowest entry. Put it on edge trigger to fire once, exactly when a run ends with a board-worthy score — the "New best!" hook. A non-numeric score never qualifies. Evaluates every frame like a variable read, even while paused.'
  });
  addBlock({
    category: 'High Score',
    blockType: 'high-score-count-condition',
    runtimeType: 'highScoreCount',
    kind: 'condition',
    label: 'High Score Count',
    color: '#34d399',
    cellLabel: 'HSCnt?',
    defaults: { type: 'highScoreCount', operator: '>=', value: 0, reversed: false },
    fields: [
      { key: 'operator', label: 'Compare', control: 'select', options: [['>=', 'At least (count >=)'], ['<=', 'At most (count <=)'], ['==', 'Exactly (count ==)'], ['!=', 'Not (count !=)'], ['>', 'More than (count >)'], ['<', 'Less than (count <)']] },
      { key: 'value', label: 'Value', control: expr, placeholder: '0' },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the number of scores on the leaderboard compares against the value you enter. Use it for a "leaderboard full" badge, or a first-score-ever hint when the count is 0. Evaluates every frame like a variable read, even while paused.'
  });
  // P4 Advanced batch 13 (time scale): the whole game clock runs
  // faster or slower. The scale is run-level state — it survives
  // scene switches inside a run and resets only on a fresh run — and
  // it slows physics, animation, tweens, particles, cutscenes,
  // dialogue typing, and the named timers together, while scripts,
  // input, and buttons keep running at full speed. A non-numeric
  // scale warns and holds; any other value clamps to 0..4.
  addBlock({
    category: 'Time',
    blockType: 'set-time-scale',
    runtimeType: 'setTimeScale',
    kind: 'action',
    label: 'Set Time Scale',
    color: '#0369a1',
    cellLabel: 'TimeScale',
    defaults: { type: 'setTimeScale', scale: 1 },
    fields: [
      { key: 'scale', label: 'Scale', control: expr, placeholder: '1' }
    ],
    note: 'Sets how fast the game world runs: 1 is normal speed, 0.3 is slow motion, 0.5 is half speed, 2 is double speed, 0 freezes the world (scripts and buttons keep running, so a block can always unfreeze it). Physics, animation, tweens, particles, cutscenes, dialogue, and named timers all slow together. A non-numeric scale warns and holds; any other value clamps to 0..4.'
  });
  addBlock({
    category: 'Time',
    blockType: 'reset-time-scale',
    runtimeType: 'resetTimeScale',
    kind: 'action',
    label: 'Reset Time Scale',
    color: '#075985',
    cellLabel: 'TimeReset',
    defaults: { type: 'resetTimeScale' },
    fields: [],
    note: 'Back to normal speed at once. The un-freeze button for a slow-motion death or a frozen world.'
  });
  addBlock({
    category: 'Time',
    blockType: 'read-time-scale',
    runtimeType: 'readTimeScale',
    kind: 'action',
    label: 'Read Time Scale',
    color: '#0284c7',
    cellLabel: 'ReadTime',
    defaults: { type: 'readTimeScale', varName: '' },
    fields: [
      { key: 'varName', label: 'Into variable', control: 'text', placeholder: 'e.g. gameSpeed' }
    ],
    note: 'Copies the current time scale into a game variable, so you can show it in a label or save it. Leave the variable blank to skip it.'
  });
  addBlock({
    category: 'Time',
    blockType: 'time-scale-condition',
    runtimeType: 'timeScale',
    kind: 'condition',
    label: 'Time Scale',
    color: '#38bdf8',
    cellLabel: 'Time?',
    defaults: { type: 'timeScale', operator: '<', value: 1, reversed: false },
    fields: [
      { key: 'operator', label: 'Compare', control: 'select', options: [['>=', 'At least (scale >=)'], ['<=', 'At most (scale <=)'], ['==', 'Exactly (scale ==)'], ['!=', 'Not (scale !=)'], ['>', 'More than (scale >)'], ['<', 'Less than (scale <)']] },
      { key: 'value', label: 'Value', control: expr, placeholder: '1' },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the current time scale compares against the value you enter. Use it for a "SLOW-MO" badge while the scale is under 1, or a speed-up indicator while it is over 1. Evaluates every frame like a variable read, even while paused.'
  });
  // P4 Advanced batch 14 (scene transitions): fade / wipe between
  // scenes instead of an instant cut. The project default (effect +
  // duration) lives in the Transitions tab; every Transition to
  // Scene block can override the effect and the duration for that
  // one switch, or leave them on Default. The plain Switch Scene
  // block stays an instant cut. A transition replaces one already
  // playing; an unknown scene warns and holds, so a typo never
  // leaves the game stuck on black.
  addBlock({
    category: 'Scene',
    blockType: 'transition-to-scene',
    runtimeType: 'transitionToScene',
    kind: 'action',
    label: 'Transition to Scene',
    color: '#0d9488',
    cellLabel: 'TransScene',
    defaults: { type: 'transitionToScene', sceneId: null, effect: 'default', duration: '' },
    fields: [
      { key: 'sceneId', label: 'Scene to show', control: 'scene' },
      { key: 'effect', label: 'Effect', control: 'select', options: [['default', 'Use default'], ['fade', 'Fade to black'], ['wipe', 'Wipe across'], ['cut', 'Cut (instant)']] },
      { key: 'duration', label: 'Duration (seconds)', control: expr, placeholder: 'blank = default' }
    ],
    note: 'Switches to the scene with a fade or a wipe instead of an instant cut: the screen fades (or wipes) out, the scene switches under full cover, then it fades (or wipes) back in. The default effect and duration come from the Transitions tab; a blank Duration uses the default, and 0 switches at once. An unknown scene warns and holds.'
  });
  addBlock({
    category: 'Scene',
    blockType: 'cancel-transition',
    runtimeType: 'cancelTransition',
    kind: 'action',
    label: 'Cancel Transition',
    color: '#0f766e',
    cellLabel: 'TransCancel',
    defaults: { type: 'cancelTransition' },
    fields: [],
    note: 'Stops a transition that is playing. Cancelling while the screen is fading out stays in the current scene; cancelling while it is fading back in finishes at once, since the scene already switched. Does nothing when no transition is playing.'
  });
  addBlock({
    category: 'Scene',
    blockType: 'transition-playing',
    runtimeType: 'transitionPlaying',
    kind: 'condition',
    label: 'Transition Playing',
    color: '#14b8a6',
    cellLabel: 'Trans?',
    defaults: { type: 'transitionPlaying', sceneId: null, reversed: false },
    fields: [
      { key: 'sceneId', label: 'Scene', control: 'scene' },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while a scene transition is playing. Leave the Scene blank for any transition, or pick one to gate only on the way to that scene — for example, hide the HUD while transitioning to the next level. Evaluates every frame like a variable read, even while paused.'
  });
  addBlock({
    category: 'Scene',
    blockType: 'transition-finished',
    runtimeType: 'transitionFinished',
    kind: 'condition',
    label: 'Transition Finished',
    color: '#2dd4bf',
    cellLabel: 'TransDone?',
    defaults: { type: 'transitionFinished', sceneId: null, reversed: false },
    fields: [
      { key: 'sceneId', label: 'Scene', control: 'scene' },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'Fires once when a scene transition ends (an instant switch counts too). Leave the Scene blank for any transition, or pick one to run what happens next only after arriving at that scene. The edge trigger is what fires once on the change.'
  });
  addBlock({
    category: 'Pathfinding',
    blockType: 'follow-path',
    runtimeType: 'followPath',
    kind: 'action',
    label: 'Follow Path',
    color: '#059669',
    cellLabel: 'Follow Path',
    defaults: { type: 'followPath', targetObject: '', destinationObject: '', posX: 0, posY: 0, speed: 100 },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'destinationObject', label: 'Destination object', control: obj },
      { key: 'posX', label: 'X (no object)', control: expr, placeholder: '0' },
      { key: 'posY', label: 'Y (no object)', control: expr, placeholder: '0' },
      { key: 'speed', label: 'Speed (px/s)', control: expr, placeholder: '100' }
    ],
    note: 'Walks the object to a destination around the tilemap walls — an enemy chasing the player through a maze, an NPC walking to a door. Point it at an object, or at the X/Y point when no object is named. The path is found once, when the block runs, so a moving target needs a fresh Follow Path. A destination with no path warns and holds; a missing object stays quiet.'
  });
  addBlock({
    category: 'Pathfinding',
    blockType: 'stop-path',
    runtimeType: 'stopPath',
    kind: 'action',
    label: 'Stop Path',
    color: '#047857',
    cellLabel: 'Stop Path',
    defaults: { type: 'stopPath', targetObject: '' },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj }
    ],
    note: 'Stops an object walking a path at once, right where it stands. After it, Path Finished and Has Path both read false. Does nothing when the object has no path.'
  });
  addBlock({
    category: 'Pathfinding',
    blockType: 'path-finished',
    runtimeType: 'pathFinished',
    kind: 'condition',
    label: 'Path Finished',
    color: '#10b981',
    cellLabel: 'Path done?',
    defaults: { type: 'pathFinished', targetObject: '', reversed: false },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True once the object has arrived at the end of its path. Use it to run what happens next — open the door, start the attack, roll a new destination. True every frame while the path stays finished, so pair it with a trigger-once or a state change when the next step should run once.'
  });
  addBlock({
    category: 'Pathfinding',
    blockType: 'has-path',
    runtimeType: 'hasPath',
    kind: 'condition',
    label: 'Has Path',
    color: '#34d399',
    cellLabel: 'Has path?',
    defaults: { type: 'hasPath', targetObject: '', reversed: false },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the object is walking a path that has not arrived yet. Use it to freeze the enemy AI or hide the "walking" animation while the object is on the move, or to keep a new Follow Path from replacing the one already walking.'
  });
  addBlock({
    category: 'AI',
    blockType: 'set-ai-behavior',
    runtimeType: 'setAiBehavior',
    kind: 'action',
    label: 'Set AI Behavior',
    color: '#7c3aed',
    cellLabel: 'Set AI',
    defaults: { type: 'setAiBehavior', targetObject: '', behavior: 'chase', targetName: '', speed: 100, range: 300, patrolA: '', patrolB: '' },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'behavior', label: 'Behavior', control: 'select', options: [['none', 'None (stop)'], ['patrol', 'Patrol'], ['chase', 'Chase'], ['flee', 'Flee'], ['wander', 'Wander']] },
      { key: 'targetName', label: 'Target object', control: obj },
      { key: 'speed', label: 'Speed (px/s)', control: expr, placeholder: '100' },
      { key: 'range', label: 'Range (px)', control: expr, placeholder: '300' },
      { key: 'patrolA', label: 'Patrol point A', control: obj },
      { key: 'patrolB', label: 'Patrol point B', control: obj }
    ],
    note: 'Gives the object a brain, so it decides where to walk on its own: Patrol walks between the two patrol points, Chase walks at the target while it stays in range, Flee walks away from the target, Wander strolls around the spot where the behavior was set. Every behavior walks around the tilemap walls through the pathfinder. A bad speed or range warns and holds; a missing object stays quiet.'
  });
  addBlock({
    category: 'AI',
    blockType: 'stop-ai',
    runtimeType: 'stopAi',
    kind: 'action',
    label: 'Stop AI',
    color: '#6d28d9',
    cellLabel: 'Stop AI',
    defaults: { type: 'stopAi', targetObject: '' },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj }
    ],
    note: 'Stops the object thinking at once: the behavior is cleared and the object halts where it stands. After it, AI Behavior reads None and the object waits for a new Set AI Behavior.'
  });
  addBlock({
    category: 'AI',
    blockType: 'ai-behavior',
    runtimeType: 'aiBehavior',
    kind: 'condition',
    label: 'AI Behavior',
    color: '#8b5cf6',
    cellLabel: 'AI is?',
    defaults: { type: 'aiBehavior', targetObject: '', behavior: 'chase', reversed: false },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'behavior', label: 'Behavior', control: 'select', options: [['none', 'None (stop)'], ['patrol', 'Patrol'], ['chase', 'Chase'], ['flee', 'Flee'], ['wander', 'Wander']] },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the object is running the picked behavior. Use it to run what happens next — switch a guard from patrol to chase when the player is spotted, or play the flee animation while a deer runs. Evaluates every frame, even while paused.'
  });
  addBlock({
    category: 'AI',
    blockType: 'target-in-range',
    runtimeType: 'targetInRange',
    kind: 'condition',
    label: 'Target In Range',
    color: '#a78bfa',
    cellLabel: 'In range?',
    defaults: { type: 'targetInRange', targetObject: '', targetName: '', range: 300, reversed: false },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'targetName', label: 'Target object', control: obj },
      { key: 'range', label: 'Range (px)', control: expr, placeholder: '300' },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the target object is within Range pixels of the object, center to center. Use it to spot the player (chase only when close), to trigger a guard barking, or to end a flee once the target is far away. Evaluates every frame, even while paused.'
  });
  addBlock({
    category: 'Input',
    blockType: 'enable-joystick',
    runtimeType: 'enableJoystick',
    kind: 'action',
    label: 'Enable Joystick',
    color: '#0284c7',
    cellLabel: 'Joy On',
    defaults: { type: 'enableJoystick' },
    fields: [],
    note: 'Turns the on-screen joystick on for the rest of the run: the base circle appears in its corner and a finger (or a mouse drag) can grab it to steer. Use it on a level that needs touch controls, or on a touch-device check, instead of turning the stick on for the whole game in the Joystick tab.'
  });
  addBlock({
    category: 'Input',
    blockType: 'disable-joystick',
    runtimeType: 'disableJoystick',
    kind: 'action',
    label: 'Disable Joystick',
    color: '#0369a1',
    cellLabel: 'Joy Off',
    defaults: { type: 'disableJoystick' },
    fields: [],
    note: 'Turns the on-screen joystick off at once: the base circle disappears and a held stick lets go, so the tilt reads 0 again. Use it when the player picks up the keyboard, or on a menu scene that needs the whole screen for buttons.'
  });
  addBlock({
    category: 'Input',
    blockType: 'joystick-active',
    runtimeType: 'joystickActive',
    kind: 'condition',
    label: 'Joystick Active',
    color: '#0ea5e9',
    cellLabel: 'Joy on?',
    defaults: { type: 'joystickActive', reversed: false },
    fields: [
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the player is steering with the on-screen joystick — grabbed and tilted past the dead zone. Use it to show a "you are driving" hint, to switch the hero to its walking animation, or to pause the idle timer while the player steers. Evaluates every frame, even while paused.'
  });
  addBlock({
    category: 'Input',
    blockType: 'joystick-tilt',
    runtimeType: 'joystickTilt',
    kind: 'condition',
    label: 'Joystick Tilt',
    color: '#38bdf8',
    cellLabel: 'Joy tilt?',
    defaults: { type: 'joystickTilt', direction: 'any', minTilt: 0.5, reversed: false },
    fields: [
      { key: 'direction', label: 'Direction', control: 'select', options: [['any', 'Any direction'], ['up', 'Up'], ['down', 'Down'], ['left', 'Left'], ['right', 'Right']] },
      { key: 'minTilt', label: 'Min tilt (0-1)', control: expr, placeholder: '0.5' },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the on-screen joystick tilts the picked way past the minimum tilt (0 is centered, 1 is all the way to the edge). Use it to walk left only past half tilt, to jump when the stick goes up, or to steer with the tilt itself instead of the joystickX / joystickY variables. Evaluates every frame, even while paused.'
  });
  addBlock({
    category: 'Health',
    blockType: 'damage-object',
    runtimeType: 'damageObject',
    kind: 'action',
    label: 'Damage Object',
    color: '#dc2626',
    cellLabel: 'Damage',
    defaults: { type: 'damageObject', targetObject: '', amount: 10 },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'amount', label: 'Amount', control: expr, placeholder: '10' }
    ],
    note: 'Takes hit points off the object, stopping at 0 — an enemy at 10 hit points hit for 25 reads 0, not -15. Use it when a bullet lands, a spike touches the player, or a trap fires. The hit that reaches 0 is the one Object Died fires on. A bad amount warns and holds; a missing object stays quiet.'
  });
  addBlock({
    category: 'Health',
    blockType: 'heal-object',
    runtimeType: 'healObject',
    kind: 'action',
    label: 'Heal Object',
    color: '#16a34a',
    cellLabel: 'Heal',
    defaults: { type: 'healObject', targetObject: '', amount: 10 },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'amount', label: 'Amount', control: expr, placeholder: '10' }
    ],
    note: 'Gives hit points back to the object, stopping at its max — a potion never overfills the bar. Use it when the player grabs a heart, stands in a healing zone, or levels up. A bad amount warns and holds; a missing object stays quiet.'
  });
  addBlock({
    category: 'Health',
    blockType: 'set-health',
    runtimeType: 'setHealth',
    kind: 'action',
    label: 'Set Health',
    color: '#991b1b',
    cellLabel: 'Set HP',
    defaults: { type: 'setHealth', targetObject: '', value: 100 },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'value', label: 'Value', control: expr, placeholder: '100' }
    ],
    note: 'Writes an exact health value, clamped between 0 and the object\'s max — use it to reset the player to full at a checkpoint, to set a boss to half health when the fight starts, or to load a saved health value back after Load Game. A bad value warns and holds; a missing object stays quiet.'
  });
  addBlock({
    category: 'Health',
    blockType: 'set-max-health',
    runtimeType: 'setMaxHealth',
    kind: 'action',
    label: 'Set Max Health',
    color: '#7f1d1d',
    cellLabel: 'Max HP',
    defaults: { type: 'setMaxHealth', targetObject: '', value: 100 },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'value', label: 'Value', control: expr, placeholder: '100' }
    ],
    note: 'Moves the object\'s health ceiling — a level-up raises it, a curse lowers it. The current health re-clamps to the new ceiling, so a lowered max never leaves health above the bar. Use it when the player upgrades armor or a boss enrages. A bad value warns and holds; a missing object stays quiet.'
  });
  addBlock({
    category: 'Health',
    blockType: 'health-check',
    runtimeType: 'healthCheck',
    kind: 'condition',
    label: 'Health',
    color: '#f87171',
    cellLabel: 'HP is?',
    defaults: { type: 'healthCheck', targetObject: '', operator: '>=', value: 0, reversed: false },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'operator', label: 'Compare', control: 'select', options: [['>=', '>='], ['<=', '<='], ['==', '=='], ['!=', '!='], ['>', '>'], ['<', '<']] },
      { key: 'value', label: 'Value', control: expr, placeholder: '0' },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the object\'s health compares with the value the picked way — at least 50, exactly 0, below a quarter. Use it to flash a low-health warning, to make a boss change attacks under half health, or to heal the player only when hurt. Evaluates every frame, even while paused.'
  });
  addBlock({
    category: 'Health',
    blockType: 'object-died',
    runtimeType: 'objectDied',
    kind: 'condition',
    label: 'Object Died',
    color: '#ef4444',
    cellLabel: 'Died?',
    defaults: { type: 'objectDied', targetObject: '', reversed: false },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the object\'s health is 0 — it fires once on the killing hit, so a chained explosion or game-over screen runs once instead of every frame the body lies there. The block never destroys the object itself: chain Destroy Object, Hide Object, or a death animation after it. Evaluates every frame, even while paused.'
  });
  addBlock({
    category: 'Health',
    blockType: 'show-damage-number',
    runtimeType: 'showDamageNumber',
    kind: 'action',
    label: 'Show Damage Number',
    color: '#f59e0b',
    cellLabel: 'Dmg #',
    defaults: { type: 'showDamageNumber', targetObject: '', amount: 10, color: '#ffffff' },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'amount', label: 'Amount', control: expr, placeholder: '10' },
      { key: 'color', label: 'Color', control: 'color' }
    ],
    note: 'Pops a floating number above the object — it rises and fades out over about a second, so the player sees the hit land. Place it right after Damage Object with the same amount. The number is only a display: it never changes the health itself. A bad amount warns and holds; a missing object stays quiet.'
  });
  addBlock({
    category: 'Health',
    blockType: 'make-invincible',
    runtimeType: 'makeInvincible',
    kind: 'action',
    label: 'Make Invincible',
    color: '#fbbf24',
    cellLabel: 'Invincible',
    defaults: { type: 'makeInvincible', targetObject: '', seconds: 1 },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'seconds', label: 'Seconds', control: expr, placeholder: '1' }
    ],
    note: 'Gives the object a shield for the picked seconds — Damage Object skips it while the shield holds, so the classic hit-then-brief-shield loop is Damage Object followed by this block. 0 seconds clears the shield at once. Heal and Set Health still apply to a shielded object: the shield blocks hits, not help. A bad value warns and holds; a missing object stays quiet.'
  });
  addBlock({
    category: 'Health',
    blockType: 'knockback-object',
    runtimeType: 'knockbackObject',
    kind: 'action',
    label: 'Knockback Object',
    color: '#ea580c',
    cellLabel: 'Knockback',
    defaults: { type: 'knockbackObject', targetObject: '', fromObject: '', x: 0, y: 0, force: 300 },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'fromObject', label: 'From object', control: obj },
      { key: 'x', label: 'X', control: expr, placeholder: '0' },
      { key: 'y', label: 'Y', control: expr, placeholder: '0' },
      { key: 'force', label: 'Force', control: expr, placeholder: '300' }
    ],
    note: 'Shoves the object away from the source — a hit that throws the enemy back, an explosion that launches the player. Leave From object blank to push away from the X/Y point instead; a push from the object\'s own spot goes straight up. It adds to the velocity, so it moves the object the way Apply Force does — any object except text and static ones, which stay put. A bad force or position warns and holds; a missing object stays quiet.'
  });
  addBlock({
    category: 'Health',
    blockType: 'is-invincible',
    runtimeType: 'isInvincible',
    kind: 'condition',
    label: 'Is Invincible',
    color: '#fde68a',
    cellLabel: 'Shield?',
    defaults: { type: 'isInvincible', targetObject: '', reversed: false },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the object\'s shield still holds — use it to flash the sprite while invincible, to skip a second hit yourself, or to show a shield icon only while it lasts. Evaluates every frame, even while paused.'
  });
  addBlock({
    category: 'Respawn',
    blockType: 'set-checkpoint',
    runtimeType: 'setCheckpoint',
    kind: 'action',
    label: 'Set Checkpoint',
    color: '#0ea5e9',
    cellLabel: 'Checkpoint',
    defaults: { type: 'setCheckpoint', checkpointObject: '', x: 0, y: 0 },
    fields: [
      { key: 'checkpointObject', label: 'Checkpoint object', control: obj },
      { key: 'x', label: 'X', control: expr, placeholder: '0' },
      { key: 'y', label: 'Y', control: expr, placeholder: '0' }
    ],
    note: 'Records the spot the player comes back to after dying — the top-left corner of the checkpoint object, or the X/Y point when no object is named. Put a flag at each safe spot and run this when the player touches it; a new checkpoint replaces the old one, so the respawn moves forward as the player passes each flag. A bad X/Y warns and holds; a missing object stays quiet.'
  });
  addBlock({
    category: 'Respawn',
    blockType: 'respawn-object',
    runtimeType: 'respawnObject',
    kind: 'action',
    label: 'Respawn Object',
    color: '#0284c7',
    cellLabel: 'Respawn',
    defaults: { type: 'respawnObject', targetObject: '', restoreHealth: true },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'restoreHealth', label: 'Restore health', control: 'checkbox' }
    ],
    note: 'Sends the object back to the last checkpoint — or to where it started the scene, when no checkpoint is set yet. The teleport zeroes the velocity and stops a walking path, and refills the health to full while Restore health is ticked (untick it for a hardcore run where the player comes back hurt). Chain it after Object Died for the classic die-and-respawn loop. A missing object stays quiet.'
  });
  addBlock({
    category: 'Respawn',
    blockType: 'clear-checkpoint',
    runtimeType: 'clearCheckpoint',
    kind: 'action',
    label: 'Clear Checkpoint',
    color: '#0369a1',
    cellLabel: 'Clear CP',
    defaults: { type: 'clearCheckpoint' },
    fields: [],
    note: 'Forgets the checkpoint for this scene, so the next respawn sends the object back to where it started instead. Use it when a level restarts, when the player leaves the checkpoint area, or to reset the run after a game over.'
  });
  addBlock({
    category: 'Respawn',
    blockType: 'checkpoint-set',
    runtimeType: 'checkpointSet',
    kind: 'condition',
    label: 'Checkpoint Set',
    color: '#7dd3fc',
    cellLabel: 'Has CP?',
    defaults: { type: 'checkpointSet', reversed: false },
    fields: [
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while a checkpoint is recorded for this scene — use it to show a "checkpoint reached" banner only after the player passes a flag, or (inverted) to flash "no checkpoint yet" at the start. A fresh scene starts with none set. Evaluates every frame, even while paused.'
  });
  addBlock({
    category: 'Respawn',
    blockType: 'respawn-count',
    runtimeType: 'respawnCount',
    kind: 'condition',
    label: 'Respawn Count',
    color: '#38bdf8',
    cellLabel: 'Respawns?',
    defaults: { type: 'respawnCount', operator: '>=', value: 1, reversed: false },
    fields: [
      { key: 'operator', label: 'Compare', control: 'select', options: [['>=', '>='], ['<=', '<='], ['==', '=='], ['!=', '!='], ['>', '>'], ['<', '<']] },
      { key: 'value', label: 'Value', control: expr, placeholder: '1' },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the scene\'s respawn count compares with the value the picked way — at least 1 after the first death, at least 3 for a three-lives game over. The count resets with the scene, so it counts deaths in this level only. Evaluates every frame, even while paused.'
  });
  addBlock({
    category: 'Spawner',
    blockType: 'start-spawner',
    runtimeType: 'startSpawner',
    kind: 'action',
    label: 'Start Spawner',
    color: '#0d9488',
    cellLabel: 'Spawner',
    defaults: { type: 'startSpawner', name: '', templateObject: '', atObject: '', x: 0, y: 0, interval: 2, maxAlive: 10, total: 0 },
    fields: [
      { key: 'name', label: 'Spawner name', control: 'text', placeholder: 'e.g. goblins' },
      { key: 'templateObject', label: 'Spawn object', control: obj },
      { key: 'atObject', label: 'At object', control: obj },
      { key: 'x', label: 'X', control: expr, placeholder: '0' },
      { key: 'y', label: 'Y', control: expr, placeholder: '0' },
      { key: 'interval', label: 'Every (seconds)', control: expr, placeholder: '2' },
      { key: 'maxAlive', label: 'Max alive', control: expr, placeholder: '10' },
      { key: 'total', label: 'Total to spawn', control: expr, placeholder: '0' }
    ],
    note: 'Starts a named spawner: every few seconds it clones the Spawn object at the At object (or at the X/Y point when no object is named) until Max alive are on screen, or until Total have spawned. Max alive 0 means no cap, Total 0 means endless. The first spawn lands after one interval, never at once. Starting a spawner that already runs restarts it, timer and count fresh. A blank name or a blank Spawn object stays quiet; a bad interval, max alive, total, or X/Y warns and holds.'
  });
  addBlock({
    category: 'Spawner',
    blockType: 'stop-spawner',
    runtimeType: 'stopSpawner',
    kind: 'action',
    label: 'Stop Spawner',
    color: '#0f766e',
    cellLabel: 'Stop Spawn',
    defaults: { type: 'stopSpawner', name: '' },
    fields: [
      { key: 'name', label: 'Spawner name', control: 'text', placeholder: 'blank stops all' }
    ],
    note: 'Stops the named spawner, so it never spawns again — use it when the wave is beaten, when the player leaves the area, or to end the level. Leave the name blank to stop every spawner at once. An unknown name stays quiet.'
  });
  addBlock({
    category: 'Spawner',
    blockType: 'read-spawned-count',
    runtimeType: 'readSpawnedCount',
    kind: 'action',
    label: 'Read Spawned Count',
    color: '#14b8a6',
    cellLabel: 'Read Spawn',
    defaults: { type: 'readSpawnedCount', name: '', varName: '' },
    fields: [
      { key: 'name', label: 'Spawner name', control: 'text', placeholder: 'e.g. goblins' },
      { key: 'varName', label: 'Into variable', control: 'text', placeholder: 'e.g. goblinsSpawned' }
    ],
    note: 'Copies how many the named spawner has made into a game variable, so you can show it in a label, compare it, or save it with Save Game (then re-start the spawner after Load Game). A spawner that never started reads 0; a blank variable name warns and holds.'
  });
  addBlock({
    category: 'Spawner',
    blockType: 'spawner-active',
    runtimeType: 'spawnerActive',
    kind: 'condition',
    label: 'Spawner Active',
    color: '#5eead4',
    cellLabel: 'Spawning?',
    defaults: { type: 'spawnerActive', name: '', reversed: false },
    fields: [
      { key: 'name', label: 'Spawner name', control: 'text', placeholder: 'e.g. goblins' },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the named spawner runs — use it to show a "wave incoming" banner only while enemies are still spawning, or (inverted) to open the goal door once the wave is done. A spawner that reached its total reads as stopped. Evaluates every frame, even while paused.'
  });
  addBlock({
    category: 'Spawner',
    blockType: 'spawned-count',
    runtimeType: 'spawnedCount',
    kind: 'condition',
    label: 'Spawned Count',
    color: '#2dd4bf',
    cellLabel: 'Spawned?',
    defaults: { type: 'spawnedCount', name: '', operator: '>=', value: 1, reversed: false },
    fields: [
      { key: 'name', label: 'Spawner name', control: 'text', placeholder: 'e.g. goblins' },
      { key: 'operator', label: 'Compare', control: 'select', options: [['>=', '>='], ['<=', '<='], ['==', '=='], ['!=', '!='], ['>', '>'], ['<', '<']] },
      { key: 'value', label: 'Value', control: expr, placeholder: '1' },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the named spawner\'s spawned total compares with the value the picked way — at least 10 for a ten-spawn wave gate, at least 1 once the first enemy has arrived. The count resets with the scene, so it counts spawns in this level only. Evaluates every frame, even while paused.'
  });
  addBlock({
    category: 'Lives',
    blockType: 'set-lives',
    runtimeType: 'setLives',
    kind: 'action',
    label: 'Set Lives',
    color: '#e11d48',
    cellLabel: 'Set Lives',
    defaults: { type: 'setLives', lives: 3 },
    fields: [
      { key: 'lives', label: 'Lives', control: expr, placeholder: '3' }
    ],
    note: 'Sets how many lives the player has — 3 is the classic arcade default, 0 starts the game already over. Lives survive scene switches inside a run, so set them once at gameStart. A bad value warns and holds.'
  });
  addBlock({
    category: 'Lives',
    blockType: 'add-lives',
    runtimeType: 'addLives',
    kind: 'action',
    label: 'Add Lives',
    color: '#be123c',
    cellLabel: 'Add Lives',
    defaults: { type: 'addLives', amount: 1 },
    fields: [
      { key: 'amount', label: 'Amount', control: expr, placeholder: '1' }
    ],
    note: 'Gives the player more lives — a 1-up, a bonus life for beating a level, a continue. The count stops at 99. A bad amount warns and holds.'
  });
  addBlock({
    category: 'Lives',
    blockType: 'lose-life',
    runtimeType: 'loseLife',
    kind: 'action',
    label: 'Lose Life',
    color: '#f43f5e',
    cellLabel: 'Lose Life',
    defaults: { type: 'loseLife', amount: 1 },
    fields: [
      { key: 'amount', label: 'Amount', control: expr, placeholder: '1' }
    ],
    note: 'Takes lives away — one at a time by default. Chain it after Object Died for the classic die-and-respawn loop, then Respawn Object to bring the player back. The count never goes below 0, so losing a life at 0 stays at 0. A bad amount warns and holds.'
  });
  addBlock({
    category: 'Lives',
    blockType: 'read-lives',
    runtimeType: 'readLives',
    kind: 'action',
    label: 'Read Lives',
    color: '#fb7185',
    cellLabel: 'Read Lives',
    defaults: { type: 'readLives', varName: '' },
    fields: [
      { key: 'varName', label: 'Into variable', control: 'text', placeholder: 'e.g. livesLeft' }
    ],
    note: 'Copies how many lives are left into a game variable, so you can show it in a label, compare it, or save it with Save Game (then Set Lives from it after Load Game). A game that never touched lives reads 3; a blank variable name warns and holds.'
  });
  addBlock({
    category: 'Lives',
    blockType: 'lives',
    runtimeType: 'lives',
    kind: 'condition',
    label: 'Lives',
    color: '#fda4af',
    cellLabel: 'Lives?',
    defaults: { type: 'lives', operator: '>=', value: 1, reversed: false },
    fields: [
      { key: 'operator', label: 'Compare', control: 'select', options: [['>=', '>='], ['<=', '<='], ['==', '=='], ['!=', '!='], ['>', '>'], ['<', '<']] },
      { key: 'value', label: 'Value', control: expr, placeholder: '1' },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the lives count compares with the value the picked way — at least 1 while the player still has a life left, exactly 0 when the game is over. The count survives scene switches, so it counts lives for the whole game, not one level. Evaluates every frame, even while paused.'
  });
  addBlock({
    category: 'Lives',
    blockType: 'game-over',
    runtimeType: 'gameOver',
    kind: 'condition',
    label: 'Game Over',
    color: '#9f1239',
    cellLabel: 'Game Over',
    defaults: { type: 'gameOver', reversed: false },
    fields: [
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the game is over — the lives count reads 0. It fires once, exactly when the last life is lost, so chain it to Switch Scene for the game-over screen. Gaining a life after game over clears it, so losing the last life again fires it again. Evaluates every frame, even while paused.'
  });
  addBlock({
    category: 'Movement',
    blockType: 'jump',
    runtimeType: 'jump',
    kind: 'action',
    label: 'Jump',
    color: '#0284c7',
    cellLabel: 'Jump',
    defaults: { type: 'jump', targetObject: '', jumpSpeed: 12 },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'jumpSpeed', label: 'Jump speed', control: expr, placeholder: '12' }
    ],
    note: 'Makes the object jump — on the ground, just after walking off a ledge while the coyote window holds, or in the air up to its Max jumps (2 is the classic double jump). A press with no jump left is remembered for the jump-buffer window and fires on landing. Jump speed 12 is a solid platformer jump. A bad speed warns and holds; a missing object stays quiet.'
  });
  addBlock({
    category: 'Movement',
    blockType: 'dash',
    runtimeType: 'dash',
    kind: 'action',
    label: 'Dash',
    color: '#0ea5e9',
    cellLabel: 'Dash',
    defaults: { type: 'dash', targetObject: '', direction: 'right', speed: 400, duration: 0.15, cooldown: 0.5 },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'direction', label: 'Direction', control: 'select', options: [['left', 'Left'], ['right', 'Right'], ['up', 'Up'], ['down', 'Down']] },
      { key: 'speed', label: 'Speed (px/s)', control: expr, placeholder: '400' },
      { key: 'duration', label: 'Duration (s)', control: expr, placeholder: '0.15' },
      { key: 'cooldown', label: 'Cooldown (s)', control: expr, placeholder: '0.5' }
    ],
    note: 'Bursts the object in one direction at an exact speed — 400 px/s for 0.15 seconds covers about 60 pixels. Gravity cannot droop the burst and friction cannot decay it. A dash already running or still cooling down is ignored, so one press is one dash. A bad number warns and holds; a missing object stays quiet.'
  });
  addBlock({
    category: 'Movement',
    blockType: 'set-max-jumps',
    runtimeType: 'setMaxJumps',
    kind: 'action',
    label: 'Set Max Jumps',
    color: '#0369a1',
    cellLabel: 'Max Jumps',
    defaults: { type: 'setMaxJumps', targetObject: '', jumps: 2 },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'jumps', label: 'Jumps', control: expr, placeholder: '2' }
    ],
    note: 'Sets how many jumps the object gets before it must land again — 1 is a single jump, 2 is the classic double jump. A power-up that grants a double jump is one block. A bad count warns and holds; a missing object stays quiet.'
  });
  addBlock({
    category: 'Movement',
    blockType: 'set-coyote-time',
    runtimeType: 'setCoyoteTime',
    kind: 'action',
    label: 'Set Coyote Time',
    color: '#38bdf8',
    cellLabel: 'Coyote',
    defaults: { type: 'setCoyoteTime', targetObject: '', seconds: 0.1 },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'seconds', label: 'Seconds', control: expr, placeholder: '0.1' }
    ],
    note: 'Sets the grace window in seconds after walking off a ledge during which a jump still counts — 0.1 is the classic forgiving platformer feel, 0 turns it off. A bad value warns and holds; a missing object stays quiet.'
  });
  addBlock({
    category: 'Movement',
    blockType: 'set-jump-buffer',
    runtimeType: 'setJumpBuffer',
    kind: 'action',
    label: 'Set Jump Buffer',
    color: '#7dd3fc',
    cellLabel: 'Buffer',
    defaults: { type: 'setJumpBuffer', targetObject: '', seconds: 0.1 },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'seconds', label: 'Seconds', control: expr, placeholder: '0.1' }
    ],
    note: 'Sets how long a jump press is remembered for when no jump is available — 0.1 means a press just before landing fires on landing instead of being lost. 0 turns it off. A bad value warns and holds; a missing object stays quiet.'
  });
  addBlock({
    category: 'Movement',
    blockType: 'jumps-left',
    runtimeType: 'jumpsLeft',
    kind: 'condition',
    label: 'Jumps Left',
    color: '#075985',
    cellLabel: 'Jumps?',
    defaults: { type: 'jumpsLeft', targetObject: '', operator: '>=', value: 1, reversed: false },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'operator', label: 'Compare', control: 'select', options: [['>=', '>='], ['<=', '<='], ['==', '=='], ['!=', '!='], ['>', '>'], ['<', '<']] },
      { key: 'value', label: 'Value', control: expr, placeholder: '1' },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the object\'s jumps left compare with the value the picked way — at least 1 while the player can still jump, exactly 0 while every jump is spent until the next landing. Use it to show a double-jump icon only when the air jump is ready. Evaluates every frame, even while paused.'
  });
  addBlock({
    category: 'Movement',
    blockType: 'is-dashing',
    runtimeType: 'isDashing',
    kind: 'condition',
    label: 'Is Dashing',
    color: '#0c4a6e',
    cellLabel: 'Dashing?',
    defaults: { type: 'isDashing', targetObject: '', reversed: false },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the object is mid-dash — inside the burst the Dash block started. Use it to spawn dash particles, play a whoosh, or make the player invincible while dashing (chain Make Invincible after Dash). Evaluates every frame, even while paused.'
  });
  addBlock({
    category: 'Movement',
    blockType: 'set-wall-slide',
    runtimeType: 'setWallSlide',
    kind: 'action',
    label: 'Set Wall Slide',
    color: '#0e7490',
    cellLabel: 'Wall Slide',
    defaults: { type: 'setWallSlide', targetObject: '', maxFall: 60 },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'maxFall', label: 'Max fall speed (px/s)', control: expr, placeholder: '60' }
    ],
    note: 'Sets how fast the object may fall while sliding down a wall — 60 px/s is a slow slide, 0 turns the slide off. The slide only holds while the object keeps pressing toward the wall (arrow keys or A/D). A bad speed warns and holds; a missing object stays quiet.'
  });
  addBlock({
    category: 'Movement',
    blockType: 'set-wall-jump',
    runtimeType: 'setWallJump',
    kind: 'action',
    label: 'Set Wall Jump',
    color: '#155e75',
    cellLabel: 'Wall Jump',
    defaults: { type: 'setWallJump', targetObject: '', jumpSpeed: 12, push: 8 },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'jumpSpeed', label: 'Jump speed', control: expr, placeholder: '12' },
      { key: 'push', label: 'Push away', control: expr, placeholder: '8' }
    ],
    note: 'Sets the wall jump: how hard the object jumps off a wall, and how hard it is pushed away from it. The Jump block performs the wall jump while the object touches a wall — it costs one air jump, so Max jumps still bounds the climb, and one wall jump per wall until the hero lands or reaches another wall. A bad number warns and holds; a missing object stays quiet.'
  });
  addBlock({
    category: 'Movement',
    blockType: 'wall-sliding',
    runtimeType: 'wallSliding',
    kind: 'condition',
    label: 'Wall Sliding',
    color: '#164e63',
    cellLabel: 'Sliding?',
    defaults: { type: 'wallSliding', targetObject: '', reversed: false },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the object slides down a wall — airborne, falling, pressing toward a solid wall it touches, with a slide speed set. Use it to play a slide sound, spawn wall dust, or show a climbing hint. Evaluates every frame, even while paused.'
  });
  addBlock({
    category: 'Combat',
    blockType: 'melee-attack',
    runtimeType: 'meleeAttack',
    kind: 'action',
    label: 'Melee Attack',
    color: '#ea580c',
    cellLabel: 'Melee',
    defaults: { type: 'meleeAttack', targetObject: '', damage: 10, range: 60, direction: 'right', cooldown: 0.5 },
    fields: [
      { key: 'targetObject', label: 'Attacker', control: obj },
      { key: 'damage', label: 'Damage', control: expr, placeholder: '10' },
      { key: 'range', label: 'Range (px)', control: expr, placeholder: '60' },
      { key: 'direction', label: 'Direction', control: 'select', options: [['left', 'Left'], ['right', 'Right'], ['up', 'Up'], ['down', 'Down']] },
      { key: 'cooldown', label: 'Cooldown (s)', control: expr, placeholder: '0.5' }
    ],
    note: 'Swings in front of the attacker — every solid object inside the 90-degree arc out to the range takes the damage, and a white slash arc flashes for a moment. An attack pressed during the cooldown does nothing, so one press is one swing. Invincible targets skip the hit, and Object Died still fires on the killing blow. A bad number warns and holds; a missing object stays quiet.'
  });
  addBlock({
    category: 'Combat',
    blockType: 'shoot-projectile',
    runtimeType: 'shootProjectile',
    kind: 'action',
    label: 'Shoot Projectile',
    color: '#c2410c',
    cellLabel: 'Shoot',
    defaults: { type: 'shootProjectile', targetObject: '', projectileObject: '', direction: 'right', speed: 300, damage: 10, lifetime: 2, cooldown: 0.5 },
    fields: [
      { key: 'targetObject', label: 'Shooter', control: obj },
      { key: 'projectileObject', label: 'Projectile', control: obj },
      { key: 'direction', label: 'Direction', control: 'select', options: [['left', 'Left'], ['right', 'Right'], ['up', 'Up'], ['down', 'Down']] },
      { key: 'speed', label: 'Speed (px/s)', control: expr, placeholder: '300' },
      { key: 'damage', label: 'Damage', control: expr, placeholder: '10' },
      { key: 'lifetime', label: 'Lifetime (s)', control: expr, placeholder: '2' },
      { key: 'cooldown', label: 'Cooldown (s)', control: expr, placeholder: '0.5' }
    ],
    note: 'Fires a copy of the projectile object from the shooter\'s edge, flying straight until it hits the first solid object or its lifetime ends — one hit, no piercing. Make the projectile a small sprite with collision on; the shooter never hits itself. A shot pressed during the cooldown does nothing. A bad number warns and holds; a missing shooter or projectile stays quiet.'
  });
  addBlock({
    category: 'Combat',
    blockType: 'attack-ready',
    runtimeType: 'attackReady',
    kind: 'condition',
    label: 'Attack Ready',
    color: '#9a3412',
    cellLabel: 'Ready?',
    defaults: { type: 'attackReady', targetObject: '', attackKind: 'melee', cooldown: 0.5, reversed: false },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'attackKind', label: 'Attack', control: 'select', options: [['melee', 'Melee'], ['shot', 'Shot']] },
      { key: 'cooldown', label: 'Cooldown (s)', control: expr, placeholder: '0.5' },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the object\'s picked attack has cooled down — a melee swing or a shot is ready to fire again. Gate a fire button on it instead of spamming a refused attack every frame. An object that never attacked reads as ready. Evaluates every frame, even while paused.'
  });
  addBlock({
    category: 'Platform',
    blockType: 'set-platform-path',
    runtimeType: 'setPlatformPath',
    kind: 'action',
    label: 'Set Platform Path',
    color: '#0d9488',
    cellLabel: 'Platform',
    defaults: { type: 'setPlatformPath', targetObject: '', x1: 0, y1: 0, x2: 200, y2: 0, speed: 60, mode: 'pingpong' },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'x1', label: 'Point 1 X', control: expr, placeholder: '0' },
      { key: 'y1', label: 'Point 1 Y', control: expr, placeholder: '0' },
      { key: 'x2', label: 'Point 2 X', control: expr, placeholder: '200' },
      { key: 'y2', label: 'Point 2 Y', control: expr, placeholder: '0' },
      { key: 'speed', label: 'Speed (px/s)', control: expr, placeholder: '60' },
      { key: 'mode', label: 'Mode', control: 'select', options: [['pingpong', 'Ping-pong'], ['loop', 'Loop']] }
    ],
    note: 'Turns the object into a moving platform that slides between two points — 60 px/s between (0, 0) and (200, 0) is a gentle back-and-forth ride. Ping-pong goes there and back; Loop jumps back to the first point and starts over. Anything standing on the platform rides it. A bad number warns and holds; a missing object stays quiet.'
  });
  addBlock({
    category: 'Platform',
    blockType: 'set-one-way',
    runtimeType: 'setOneWay',
    kind: 'action',
    label: 'Set One-Way Platform',
    color: '#14b8a6',
    cellLabel: 'One-Way',
    defaults: { type: 'setOneWay', targetObject: '', enabled: true },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'enabled', label: 'One-way', control: 'select', options: [[true, 'On'], [false, 'Off']] }
    ],
    note: 'Makes the object a one-way platform: jump up through it from below, land on it from above. Works on any object, platform or plain floor — it flips the same flag the Inspector Collision section sets. A missing object stays quiet.'
  });
  addBlock({
    category: 'Platform',
    blockType: 'set-crumble-time',
    runtimeType: 'setCrumbleTime',
    kind: 'action',
    label: 'Set Crumble Time',
    color: '#0f766e',
    cellLabel: 'Crumble',
    defaults: { type: 'setCrumbleTime', targetObject: '', seconds: 2 },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'seconds', label: 'Seconds', control: expr, placeholder: '2' }
    ],
    note: 'Sets how long the object holds after a rider stands on it before it falls away — 2 seconds is a fair crossing window, 0 means it never crumbles. Once the timer starts it runs to the end even if the rider steps off. A bad value warns and holds; a missing object stays quiet.'
  });
  addBlock({
    category: 'Platform',
    blockType: 'standing-on-platform',
    runtimeType: 'standingOnPlatform',
    kind: 'condition',
    label: 'Standing On Platform',
    color: '#2dd4bf',
    cellLabel: 'On Plat?',
    defaults: { type: 'standingOnPlatform', targetObject: '', reversed: false },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the object stands on a moving platform — the ride is on. Use it to play a platform hum, or to warn the player before a crumbling platform gives way. Evaluates every frame, even while paused.'
  });
  addBlock({
    category: 'Platform',
    blockType: 'standing-on-oneway',
    runtimeType: 'standingOnOneWay',
    kind: 'condition',
    label: 'Standing On One-Way',
    color: '#5eead4',
    cellLabel: 'On 1-Way?',
    defaults: { type: 'standingOnOneWay', targetObject: '', reversed: false },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the object stands on a one-way platform — a floor you jump up through and land on from above. Works for any one-way floor, platform or plain. Evaluates every frame, even while paused.'
  });
  addBlock({
    category: 'XP',
    blockType: 'add-xp',
    runtimeType: 'addXp',
    kind: 'action',
    label: 'Add XP',
    color: '#65a30d',
    cellLabel: 'Add XP',
    defaults: { type: 'addXp', amount: 10 },
    fields: [
      { key: 'amount', label: 'Amount', control: expr, placeholder: '10' }
    ],
    note: 'Gives the player experience points — 10 is one coin or one defeated enemy. At 100 XP per level, ten of these is a level up. A bad amount warns and holds.'
  });
  addBlock({
    category: 'XP',
    blockType: 'set-xp',
    runtimeType: 'setXp',
    kind: 'action',
    label: 'Set XP',
    color: '#4d7c0f',
    cellLabel: 'Set XP',
    defaults: { type: 'setXp', xp: 0 },
    fields: [
      { key: 'xp', label: 'XP', control: expr, placeholder: '0' }
    ],
    note: 'Writes the XP total outright — 0 starts the player fresh, 100 starts them at level 2. XP survives scene switches inside a run, so set it once at gameStart. A bad value warns and holds.'
  });
  addBlock({
    category: 'XP',
    blockType: 'set-xp-per-level',
    runtimeType: 'setXpPerLevel',
    kind: 'action',
    label: 'Set XP Per Level',
    color: '#3f6212',
    cellLabel: 'XP / Level',
    defaults: { type: 'setXpPerLevel', amount: 100 },
    fields: [
      { key: 'amount', label: 'Amount', control: expr, placeholder: '100' }
    ],
    note: 'Sets how much XP one level costs — 100 is the classic default, 50 levels up twice as fast, 200 makes every level a grind. The level is always the math on the current numbers, so changing it re-levels at once. A bad amount warns and holds.'
  });
  addBlock({
    category: 'XP',
    blockType: 'read-xp',
    runtimeType: 'readXp',
    kind: 'action',
    label: 'Read XP',
    color: '#84cc16',
    cellLabel: 'Read XP',
    defaults: { type: 'readXp', varName: '' },
    fields: [
      { key: 'varName', label: 'Into variable', control: 'text', placeholder: 'e.g. xpTotal' }
    ],
    note: 'Copies how much XP the player has into a game variable, so you can show it in a label, compare it, or save it with Save Game (then Set XP from it after Load Game). A game that never touched XP reads 0; a blank variable name warns and holds.'
  });
  addBlock({
    category: 'XP',
    blockType: 'read-level',
    runtimeType: 'readLevel',
    kind: 'action',
    label: 'Read Level',
    color: '#a3e635',
    cellLabel: 'Read Level',
    defaults: { type: 'readLevel', varName: '' },
    fields: [
      { key: 'varName', label: 'Into variable', control: 'text', placeholder: 'e.g. playerLevel' }
    ],
    note: 'Copies the player level into a game variable, so you can show it in a label, compare it, or save it with Save Game (then Set XP from it after Load Game). A game that never touched XP reads level 1; a blank variable name warns and holds.'
  });
  addBlock({
    category: 'XP',
    blockType: 'xp',
    runtimeType: 'xp',
    kind: 'condition',
    label: 'XP',
    color: '#bef264',
    cellLabel: 'XP?',
    defaults: { type: 'xp', operator: '>=', value: 10, reversed: false },
    fields: [
      { key: 'operator', label: 'Compare', control: 'select', options: [['>=', '>='], ['<=', '<='], ['==', '=='], ['!=', '!='], ['>', '>'], ['<', '<']] },
      { key: 'value', label: 'Value', control: expr, placeholder: '10' },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the XP total compares with the value the picked way — at least 100 once the player has earned a level\'s worth, exactly 0 before the first kill. The total survives scene switches, so it counts XP for the whole game, not one level. Evaluates every frame, even while paused.'
  });
  addBlock({
    category: 'XP',
    blockType: 'level',
    runtimeType: 'level',
    kind: 'condition',
    label: 'Level',
    color: '#d9f99d',
    cellLabel: 'Level?',
    defaults: { type: 'level', operator: '>=', value: 2, reversed: false },
    fields: [
      { key: 'operator', label: 'Compare', control: 'select', options: [['>=', '>='], ['<=', '<='], ['==', '=='], ['!=', '!='], ['>', '>'], ['<', '<']] },
      { key: 'value', label: 'Value', control: expr, placeholder: '2' },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the player level compares with the value the picked way — at least 2 once the player has leveled up, exactly 1 before the first level. Gate a locked door or a stronger enemy on it. Evaluates every frame, even while paused.'
  });
  addBlock({
    category: 'XP',
    blockType: 'level-up',
    runtimeType: 'levelUp',
    kind: 'condition',
    label: 'Level Up',
    color: '#365314',
    cellLabel: 'Level Up',
    defaults: { type: 'levelUp', reversed: false },
    fields: [
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'Fires once, exactly when the player levels up — chain it to Heal Object for a level-up heal, Play Sound for the fanfare, or Show for a LEVEL UP banner. It is consumed on read, so place one Level Up row per reward chain. Evaluates every frame, even while paused.'
  });
  addBlock({
    category: 'Growth',
    blockType: 'grow-max-health',
    runtimeType: 'growMaxHealth',
    kind: 'action',
    label: 'Grow Max Health',
    color: '#059669',
    cellLabel: 'Grow HP',
    defaults: { type: 'growMaxHealth', targetObject: '', amount: 10, heal: true },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'amount', label: 'Amount', control: expr, placeholder: '10' },
      { key: 'heal', label: 'Heal too', control: 'select', options: [[true, 'On'], [false, 'Off']] }
    ],
    note: 'Raises the object\'s max health by the amount and heals it by the same amount, so a level up both toughens the hero and tops the bar back up. Chain it after Level Up. Turn Heal off to raise the ceiling without the heal. The growth follows the object\'s name across scenes. A bad amount warns and holds; a missing object stays quiet.'
  });
  addBlock({
    category: 'Growth',
    blockType: 'grow-damage',
    runtimeType: 'growDamage',
    kind: 'action',
    label: 'Grow Damage',
    color: '#047857',
    cellLabel: 'Grow Dmg',
    defaults: { type: 'growDamage', targetObject: '', amount: 2 },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'amount', label: 'Amount', control: expr, placeholder: '2' }
    ],
    note: 'Adds a lasting damage bonus to the object — 2 by default, so a hero that leveled twice with this hits for +4. Melee Attack and Shoot Projectile add the bonus to their block damage. Damage Object does not add it: it names the victim, not an attacker, so read the bonus and add it in the amount expression instead (10 + dmgBonus). Chain it after Level Up. The growth follows the object\'s name across scenes. A bad amount warns and holds; a missing object stays quiet.'
  });
  addBlock({
    category: 'Growth',
    blockType: 'grow-speed',
    runtimeType: 'growSpeed',
    kind: 'action',
    label: 'Grow Speed',
    color: '#065f46',
    cellLabel: 'Grow Spd',
    defaults: { type: 'growSpeed', targetObject: '', amount: 50 },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'amount', label: 'Amount', control: expr, placeholder: '50' }
    ],
    note: 'Adds a lasting speed bonus to the object — 50 by default, so a 400-speed dash becomes a 450 dash. The Dash block adds the bonus to its speed. Walking speed is untouched: it comes from Set Velocity and Move Toward blocks with their own speeds. Chain it after Level Up. The growth follows the object\'s name across scenes. A bad amount warns and holds; a missing object stays quiet.'
  });
  addBlock({
    category: 'Growth',
    blockType: 'level-reward',
    runtimeType: 'levelReward',
    kind: 'action',
    label: 'Level Reward',
    color: '#10b981',
    cellLabel: 'Reward',
    defaults: { type: 'levelReward', targetObject: '', bundle: 'balanced' },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'bundle', label: 'Reward', control: 'select', options: [['balanced', 'Balanced'], ['tank', 'Tank'], ['striker', 'Striker'], ['swift', 'Swift']] }
    ],
    note: 'Grants a whole level-up reward in one block — Balanced (+10 max health, heal 10, +2 damage), Tank (+20 max health, heal 20), Striker (+5 damage), or Swift (+50 dash speed). Every bundle is just the Grow blocks packed together, so you can always rebuild the same reward by hand. Chain it after Level Up. An unknown bundle warns and holds; a missing object stays quiet.'
  });
  addBlock({
    category: 'Growth',
    blockType: 'read-max-health-bonus',
    runtimeType: 'readMaxHealthBonus',
    kind: 'action',
    label: 'Read Max Health Bonus',
    color: '#34d399',
    cellLabel: 'Read HP+',
    defaults: { type: 'readMaxHealthBonus', targetObject: '', varName: '' },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'varName', label: 'Into variable', control: 'text', placeholder: 'e.g. hpBonus' }
    ],
    note: 'Copies how much max health the object has grown into a game variable, so you can show it in a label, compare it, or save it with Save Game. An object that never grew reads 0. A blank variable name warns and holds; a missing object reads 0.'
  });
  addBlock({
    category: 'Growth',
    blockType: 'read-damage-bonus',
    runtimeType: 'readDamageBonus',
    kind: 'action',
    label: 'Read Damage Bonus',
    color: '#6ee7b7',
    cellLabel: 'Read Dmg+',
    defaults: { type: 'readDamageBonus', targetObject: '', varName: '' },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'varName', label: 'Into variable', control: 'text', placeholder: 'e.g. dmgBonus' }
    ],
    note: 'Copies how much damage the object has grown into a game variable, so you can show it in a label, compare it, or save it with Save Game. An object that never grew reads 0. A blank variable name warns and holds; a missing object reads 0.'
  });
  addBlock({
    category: 'Growth',
    blockType: 'read-speed-bonus',
    runtimeType: 'readSpeedBonus',
    kind: 'action',
    label: 'Read Speed Bonus',
    color: '#a7f3d0',
    cellLabel: 'Read Spd+',
    defaults: { type: 'readSpeedBonus', targetObject: '', varName: '' },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'varName', label: 'Into variable', control: 'text', placeholder: 'e.g. spdBonus' }
    ],
    note: 'Copies how much speed the object has grown into a game variable, so you can show it in a label, compare it, or save it with Save Game. An object that never grew reads 0. A blank variable name warns and holds; a missing object reads 0.'
  });
  addBlock({
    category: 'Scaling',
    blockType: 'set-enemy-level',
    runtimeType: 'setEnemyLevel',
    kind: 'action',
    label: 'Set Enemy Level',
    color: '#a21caf',
    cellLabel: 'Set Lvl',
    defaults: { type: 'setEnemyLevel', targetObject: '', level: 1 },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'level', label: 'Level', control: expr, placeholder: '1' }
    ],
    note: 'Sets the enemy\'s level — 1 is an unscaled enemy, 3 at the default rates is +20 max health and +4 damage. The max health rises by the bonus (and heals by the same amount when it rises), and the damage bonus rides along on the enemy\'s Melee Attack and Shoot Projectile hits. Chain it after Level Up, or put it on a gameStart row so each scene\'s enemies scale when the scene starts. The level follows the object\'s name across scenes. A bad level warns and holds; a missing object stays quiet.'
  });
  addBlock({
    category: 'Scaling',
    blockType: 'set-scaling-rates',
    runtimeType: 'setScalingRates',
    kind: 'action',
    label: 'Set Scaling Rates',
    color: '#86198f',
    cellLabel: 'Scale Rates',
    defaults: { type: 'setScalingRates', targetObject: '', hpPerLevel: 10, dmgPerLevel: 2 },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'hpPerLevel', label: 'HP per level', control: expr, placeholder: '10' },
      { key: 'dmgPerLevel', label: 'Damage per level', control: expr, placeholder: '2' }
    ],
    note: 'Sets what one level is worth for the enemy — 10 health and 2 damage per level by default, so a level-3 enemy is +20 max health and +4 damage. Give a boss 50 health per level and a minion 5, and they scale apart. The max health re-applies at once when the rates change. A bad rate warns and holds; a missing object stays quiet.'
  });
  addBlock({
    category: 'Scaling',
    blockType: 'scale-to-hero-level',
    runtimeType: 'scaleToHeroLevel',
    kind: 'action',
    label: 'Scale to Hero Level',
    color: '#c026d3',
    cellLabel: 'Scale to Hero',
    defaults: { type: 'scaleToHeroLevel', targetObject: '' },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj }
    ],
    note: 'Sets the enemy\'s level to the hero\'s current level in one block — the fastest way to keep a fight fair. Chain it after Level Up to re-scale every enemy still alive, or put it on a gameStart row so each scene\'s enemies arrive at the hero\'s level. The level follows the object\'s name across scenes. A missing object stays quiet.'
  });
  addBlock({
    category: 'Scaling',
    blockType: 'read-enemy-level',
    runtimeType: 'readEnemyLevel',
    kind: 'action',
    label: 'Read Enemy Level',
    color: '#d946ef',
    cellLabel: 'Read Lvl',
    defaults: { type: 'readEnemyLevel', targetObject: '', varName: '' },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'varName', label: 'Into variable', control: 'text', placeholder: 'e.g. enemyLevel' }
    ],
    note: 'Copies the enemy\'s level into a game variable, so you can show it in a label, compare it, or save it with Save Game. An enemy that was never scaled reads 1. A blank variable name warns and holds; a missing object reads 1.'
  });
  addBlock({
    category: 'Scaling',
    blockType: 'read-scaled-hp-bonus',
    runtimeType: 'readScaledHpBonus',
    kind: 'action',
    label: 'Read Scaled HP Bonus',
    color: '#e879f9',
    cellLabel: 'Read HP+',
    defaults: { type: 'readScaledHpBonus', targetObject: '', varName: '' },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'varName', label: 'Into variable', control: 'text', placeholder: 'e.g. scaledHp' }
    ],
    note: 'Copies how much max health the enemy has gained from its level into a game variable, so you can show it in a label, compare it, or save it with Save Game. A level-1 enemy reads 0. A blank variable name warns and holds; a missing object reads 0.'
  });
  addBlock({
    category: 'Scaling',
    blockType: 'read-scaled-dmg-bonus',
    runtimeType: 'readScaledDmgBonus',
    kind: 'action',
    label: 'Read Scaled Damage Bonus',
    color: '#f0abfc',
    cellLabel: 'Read Dmg+',
    defaults: { type: 'readScaledDmgBonus', targetObject: '', varName: '' },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'varName', label: 'Into variable', control: 'text', placeholder: 'e.g. scaledDmg' }
    ],
    note: 'Copies how much damage the enemy has gained from its level into a game variable, so you can show it in a label, compare it, or save it with Save Game. A level-1 enemy reads 0. A blank variable name warns and holds; a missing object reads 0.'
  });
  addBlock({
    category: 'Scaling',
    blockType: 'enemy-level',
    runtimeType: 'enemyLevel',
    kind: 'condition',
    label: 'Enemy Level',
    color: '#701a75',
    cellLabel: 'Enemy Lvl?',
    defaults: { type: 'enemyLevel', targetObject: '', operator: '>=', value: 2, reversed: false },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'operator', label: 'Compare', control: 'select', options: [['>=', '>='], ['<=', '<='], ['==', '=='], ['!=', '!='], ['>', '>'], ['<', '<']] },
      { key: 'value', label: 'Value', control: expr, placeholder: '2' },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the enemy\'s level compares with the value the picked way — at least 3 once the enemy has scaled twice, exactly 1 before it ever scaled. Gate a stronger wave or a level-locked door on it. Evaluates every frame, even while paused.'
  });
  addBlock({
    category: 'Boss',
    blockType: 'start-boss',
    runtimeType: 'startBoss',
    kind: 'action',
    label: 'Start Boss',
    color: '#9f1239',
    cellLabel: 'Start Boss',
    defaults: { type: 'startBoss', targetObject: '', phases: 3, showBar: true },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'phases', label: 'Phases', control: expr, placeholder: '3' },
      { key: 'showBar', label: 'Show bar', control: 'checkbox' }
    ],
    note: 'Starts a boss fight with the named object — the big fight at the end of the run. The fight has 2 to 5 phases (3 by default), equal slices of the boss\'s health bar, so Boss Phase counts 1 at full health and reaches the last phase in the final slice. The wide bar across the top of the screen shows while the fight runs. Starting a second boss replaces the first. A blank object name warns and holds; a boss that has not spawned yet still counts, and its bar appears when it does.'
  });
  addBlock({
    category: 'Boss',
    blockType: 'end-boss',
    runtimeType: 'endBoss',
    kind: 'action',
    label: 'End Boss',
    color: '#be123c',
    cellLabel: 'End Boss',
    defaults: { type: 'endBoss' },
    fields: [],
    note: 'Ends the boss fight — the bar hides and Boss Phase reads 0 again. Nothing ends the fight on its own: chain it after Object Died on the boss, on the same row as the win screen, the XP reward, or the next-level unlock. Quiet when no fight is running.'
  });
  addBlock({
    category: 'Boss',
    blockType: 'show-boss-bar',
    runtimeType: 'showBossBar',
    kind: 'action',
    label: 'Show Boss Bar',
    color: '#e11d48',
    cellLabel: 'Show Bar',
    defaults: { type: 'showBossBar' },
    fields: [],
    note: 'Shows the boss health bar again after hiding it — bring it back when a cutscene ends and the fight resumes. Quiet when no fight is running.'
  });
  addBlock({
    category: 'Boss',
    blockType: 'hide-boss-bar',
    runtimeType: 'hideBossBar',
    kind: 'action',
    label: 'Hide Boss Bar',
    color: '#f43f5e',
    cellLabel: 'Hide Bar',
    defaults: { type: 'hideBossBar' },
    fields: [],
    note: 'Hides the boss health bar without ending the fight — clear the screen for a cutscene, then Show Boss Bar when the fight resumes. Quiet when no fight is running.'
  });
  addBlock({
    category: 'Boss',
    blockType: 'read-boss-phase',
    runtimeType: 'readBossPhase',
    kind: 'action',
    label: 'Read Boss Phase',
    color: '#fb7185',
    cellLabel: 'Read Phase',
    defaults: { type: 'readBossPhase', varName: '' },
    fields: [
      { key: 'varName', label: 'Into variable', control: 'text', placeholder: 'e.g. bossPhase' }
    ],
    note: 'Copies the boss fight\'s current phase number into a game variable, so you can show it in a label, compare it, or save it with Save Game. No fight running reads 0, and a boss that has not spawned yet reads 0 too. A blank variable name warns and holds.'
  });
  addBlock({
    category: 'Boss',
    blockType: 'boss-phase',
    runtimeType: 'bossPhase',
    kind: 'condition',
    label: 'Boss Phase',
    color: '#9f1239',
    cellLabel: 'Boss Phase?',
    defaults: { type: 'bossPhase', operator: '>=', value: 2, reversed: false },
    fields: [
      { key: 'operator', label: 'Compare', control: 'select', options: [['>=', '>='], ['<=', '<='], ['==', '=='], ['!=', '!='], ['>', '>'], ['<', '<']] },
      { key: 'value', label: 'Value', control: expr, placeholder: '2' },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the boss fight\'s phase compares with the value the picked way — at least 2 once the boss drops below two thirds of its health, exactly 3 in the final slice. Hang the phase behavior on it: a faster AI, harder hits, minions on the phase change. Evaluates every frame, even while paused.'
  });
  addBlock({
    category: 'Boss',
    blockType: 'boss-active',
    runtimeType: 'bossActive',
    kind: 'condition',
    label: 'Boss Active',
    color: '#be123c',
    cellLabel: 'Boss Active?',
    defaults: { type: 'bossActive', reversed: false },
    fields: [
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while a boss fight is running — from Start Boss until End Boss, even before the boss spawns. Gate the fight music, the arena doors, or the phase rows on it. Evaluates every frame, even while paused.'
  });
  addBlock({
    category: 'Tags',
    blockType: 'add-tag',
    runtimeType: 'addTag',
    kind: 'action',
    label: 'Add Tag',
    color: '#0e7490',
    cellLabel: 'Add Tag',
    defaults: { type: 'addTag', targetObject: '', tag: '' },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'tag', label: 'Tag', control: 'text', placeholder: 'e.g. goblin' }
    ],
    note: 'Sticks a label on the object while the game runs — tag the goblins goblin, the coins coin, the boss boss. Tags match without caring about capitals, so Goblin and goblin are the same tag, and an object holds at most 16. The tag lasts until the scene loads again; the Inspector chips are the permanent ones. A blank object or tag warns and holds.'
  });
  addBlock({
    category: 'Tags',
    blockType: 'remove-tag',
    runtimeType: 'removeTag',
    kind: 'action',
    label: 'Remove Tag',
    color: '#0891b2',
    cellLabel: 'Remove Tag',
    defaults: { type: 'removeTag', targetObject: '', tag: '' },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'tag', label: 'Tag', control: 'text', placeholder: 'e.g. goblin' }
    ],
    note: 'Takes a label off the object while the game runs — untag a goblin once it stops being one. A tag that was never there stays quiet. A blank object or tag warns and holds.'
  });
  addBlock({
    category: 'Tags',
    blockType: 'clear-tags',
    runtimeType: 'clearTags',
    kind: 'action',
    label: 'Clear Tags',
    color: '#06b6d4',
    cellLabel: 'Clear Tags',
    defaults: { type: 'clearTags', targetObject: '' },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj }
    ],
    note: 'Takes every label off the object at once — wipe a repurposed enemy clean before tagging it as something else. A blank object warns and holds.'
  });
  addBlock({
    category: 'Tags',
    blockType: 'read-tagged-count',
    runtimeType: 'readTaggedCount',
    kind: 'action',
    label: 'Read Tagged Count',
    color: '#22d3ee',
    cellLabel: 'Read Tagged',
    defaults: { type: 'readTaggedCount', tag: '', varName: '' },
    fields: [
      { key: 'tag', label: 'Tag', control: 'text', placeholder: 'e.g. goblin' },
      { key: 'varName', label: 'Into variable', control: 'text', placeholder: 'e.g. goblinsLeft' }
    ],
    note: 'Counts how many live objects carry the tag right now and copies the count into a game variable, so a label can show it or Save Game can keep it. A blank tag or variable name warns and holds.'
  });
  addBlock({
    category: 'Tags',
    blockType: 'has-tag',
    runtimeType: 'hasTag',
    kind: 'condition',
    label: 'Has Tag',
    color: '#155e75',
    cellLabel: 'Has Tag?',
    defaults: { type: 'hasTag', targetObject: '', tag: '', reversed: false },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'tag', label: 'Tag', control: 'text', placeholder: 'e.g. goblin' },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while any live object with the name carries the tag — a goblin is elite, a coin is golden. Matching ignores capitals. A blank object or tag reads as false, quietly. Evaluates every frame, even while paused.'
  });
  addBlock({
    category: 'Tags',
    blockType: 'tagged-count',
    runtimeType: 'taggedCount',
    kind: 'condition',
    label: 'Tagged Count',
    color: '#67e8f9',
    cellLabel: 'Tagged Count?',
    defaults: { type: 'taggedCount', tag: '', operator: '==', value: 0, reversed: false },
    fields: [
      { key: 'tag', label: 'Tag', control: 'text', placeholder: 'e.g. goblin' },
      { key: 'operator', label: 'Compare', control: 'select', options: [['>=', '>='], ['<=', '<='], ['==', '=='], ['!=', '!='], ['>', '>'], ['<', '<']] },
      { key: 'value', label: 'Value', control: expr, placeholder: '0' },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the number of live objects carrying the tag compares with the value the picked way — exactly 0 once every goblin is gone, so the win row is Tagged Count goblin equals 0. A blank tag counts 0. Evaluates every frame, even while paused.'
  });
  addBlock({
    category: 'Tags',
    blockType: 'pick-nearest-tagged',
    runtimeType: 'pickNearestTagged',
    kind: 'condition',
    label: 'Pick Nearest Tagged',
    color: '#0e7490',
    cellLabel: 'Pick Near Tag',
    defaults: { type: 'pickNearestTagged', tag: '', nearObject: '', pointX: 400, pointY: 300, reversed: false },
    fields: [
      { key: 'tag', label: 'Tag', control: 'text', placeholder: 'e.g. goblin' },
      { key: 'nearObject', label: 'Near object', control: obj },
      { key: 'pointX', label: 'Point X', control: expr, placeholder: '400' },
      { key: 'pointY', label: 'Point Y', control: expr, placeholder: '300' },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'Picks the nearest live object carrying the tag to the Near object (leave Near object blank to measure from the X/Y point instead) — the closest goblin, whatever the goblins are called. An action chained after this block that names the picked object\'s name applies ONLY to the picked object. True while at least one live object carries the tag. A blank tag reads as false, quietly. Evaluates every frame, even while paused.'
  });
  addBlock({
    category: 'Tags',
    blockType: 'pick-farthest-tagged',
    runtimeType: 'pickFarthestTagged',
    kind: 'condition',
    label: 'Pick Farthest Tagged',
    color: '#0891b2',
    cellLabel: 'Pick Far Tag',
    defaults: { type: 'pickFarthestTagged', tag: '', nearObject: '', pointX: 400, pointY: 300, reversed: false },
    fields: [
      { key: 'tag', label: 'Tag', control: 'text', placeholder: 'e.g. goblin' },
      { key: 'nearObject', label: 'Near object', control: obj },
      { key: 'pointX', label: 'Point X', control: expr, placeholder: '400' },
      { key: 'pointY', label: 'Point Y', control: expr, placeholder: '300' },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'Picks the furthest live object carrying the tag from the Near object (leave Near object blank to measure from the X/Y point instead). An action chained after this block that names the picked object\'s name applies ONLY to the picked object. True while at least one live object carries the tag. A blank tag reads as false, quietly. Evaluates every frame, even while paused.'
  });
  addBlock({
    category: 'Tags',
    blockType: 'pick-random-tagged',
    runtimeType: 'pickRandomTagged',
    kind: 'condition',
    label: 'Pick Random Tagged',
    color: '#06b6d4',
    cellLabel: 'Pick Rnd Tag',
    defaults: { type: 'pickRandomTagged', tag: '', reversed: false },
    fields: [
      { key: 'tag', label: 'Tag', control: 'text', placeholder: 'e.g. goblin' },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'Picks one random live object carrying the tag. An action chained after this block that names the picked object\'s name applies ONLY to the picked object. Fires once per appearance by default (switch the trigger mode to "While true" for a fresh random pick every frame). A blank tag reads as false, quietly.'
  });
  addBlock({
    category: 'Tags',
    blockType: 'pick-tagged-object-into-variable',
    runtimeType: 'pickTaggedObjectIntoVariable',
    kind: 'action',
    label: 'Pick Tagged Object Into Variable',
    color: '#22d3ee',
    cellLabel: 'Pick Tag Obj',
    defaults: { type: 'pickTaggedObjectIntoVariable', tag: '', pickMode: 'nearest', nearObject: '', pointX: 0, pointY: 0, varName: 'target', scope: 'global', targetObject: '' },
    fields: [
      { key: 'tag', label: 'Tag', control: 'text', placeholder: 'e.g. goblin' },
      { key: 'pickMode', label: 'Pick', control: 'select', options: [['nearest', 'Nearest'], ['farthest', 'Farthest'], ['random', 'Random'], ['first', 'First']] },
      { key: 'nearObject', label: 'Near object (optional)', control: obj },
      { key: 'pointX', label: 'X', control: expr, placeholder: '0' },
      { key: 'pointY', label: 'Y', control: expr, placeholder: '0' },
      { key: 'varName', label: 'Into variable', control: 'text', placeholder: 'target' },
      { key: 'scope', label: 'Scope', control: 'select', options: [['global', 'Global (whole game)'], ['scene', 'Scene (this scene only)'], ['object', 'Object (per object name)'], ['local', 'Local (this function only)']] },
      { key: 'targetObject', label: 'Scope object', control: obj }
    ],
    note: 'Picks one live object carrying the tag and stores it in a variable, so the game can keep track of one goblin even when the goblins have different names. Nearest and Farthest measure from the Near object when one is named, otherwise from the X/Y point; Random and First need no reference. Read it back with Read Object Property, destroy it with Destroy Object In Variable, or test it with Is Alive. Actions chained after it that target the same object name hit only the picked object. No live tagged object stays quiet and writes nothing; a blank tag or variable name warns and holds.'
  });
  addBlock({
    category: 'Minimap',
    blockType: 'show-minimap',
    runtimeType: 'showMinimap',
    kind: 'action',
    label: 'Show Minimap',
    color: '#6d28d9',
    cellLabel: 'Show Minimap',
    defaults: { type: 'showMinimap' },
    note: 'Shows the minimap for the current scene — the small live map in the corner, with a dot for every live object and a white rectangle for what the camera sees. The scene\'s Minimap setting decides whether it starts shown; this block turns it on mid-run, for example when the player picks up the map. Quiet when the map is already showing.'
  });
  addBlock({
    category: 'Minimap',
    blockType: 'hide-minimap',
    runtimeType: 'hideMinimap',
    kind: 'action',
    label: 'Hide Minimap',
    color: '#7c3aed',
    cellLabel: 'Hide Minimap',
    defaults: { type: 'hideMinimap' },
    note: 'Hides the minimap for the current scene without touching the scene\'s Minimap setting — clear the screen for a cutscene, then Show Minimap when it ends. Quiet when the map is already hidden.'
  });
  addBlock({
    category: 'Minimap',
    blockType: 'set-minimap-size',
    runtimeType: 'setMinimapSize',
    kind: 'action',
    label: 'Set Minimap Size',
    color: '#8b5cf6',
    cellLabel: 'Set Map Size',
    defaults: { type: 'setMinimapSize', size: 160 },
    fields: [
      { key: 'size', label: 'Size (px)', control: expr, placeholder: '160' }
    ],
    note: 'Sets how big the minimap draws, in pixels on a side — 80 to 400, 160 by default. A bigger map reads further across a large level. The change lasts for the current scene only; the scene\'s Minimap setting keeps its own size. A bad size warns and holds.'
  });
  addBlock({
    category: 'Minimap',
    blockType: 'set-minimap-zoom',
    runtimeType: 'setMinimapZoom',
    kind: 'action',
    label: 'Set Minimap Zoom',
    color: '#a78bfa',
    cellLabel: 'Set Map Zoom',
    defaults: { type: 'setMinimapZoom', zoom: 1 },
    fields: [
      { key: 'zoom', label: 'Zoom', control: expr, placeholder: '1' }
    ],
    note: 'Sets how much of the level the minimap shows — 1 fits the whole scene, 2 shows half of it centered on the camera, 4 shows a quarter, so a zoomed map follows the player instead of shrinking a huge level into unreadable dots. The change lasts for the current scene only; the scene\'s Minimap setting keeps its own zoom. A bad zoom warns and holds.'
  });
  addBlock({
    category: 'Minimap',
    blockType: 'minimap-visible',
    runtimeType: 'minimapVisible',
    kind: 'condition',
    label: 'Minimap Visible',
    color: '#4c1d95',
    cellLabel: 'Map Visible?',
    defaults: { type: 'minimapVisible', reversed: false },
    fields: [
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the minimap is showing for the current scene — gate a map-toggle button or a hint label on it. Evaluates every frame, even while paused.'
  });
  addBlock({
    category: 'Attach',
    blockType: 'attach-object-to-object',
    runtimeType: 'attachObjectToObject',
    kind: 'action',
    label: 'Attach Object To Object',
    color: '#b45309',
    cellLabel: 'Attach Obj',
    defaults: { type: 'attachObjectToObject', childObject: '', parentObject: '', offsetX: '', offsetY: '' },
    fields: [
      { key: 'childObject', label: 'Child object', control: obj },
      { key: 'parentObject', label: 'Parent object', control: obj },
      { key: 'offsetX', label: 'Offset X', control: expr, placeholder: 'keep spacing' },
      { key: 'offsetY', label: 'Offset Y', control: expr, placeholder: 'keep spacing' }
    ],
    note: 'Attaches the child object to the parent, so the child follows the parent everywhere it goes at a fixed offset — a sword in the hero\'s hand, a hat on a goblin, a name tag above an NPC. The offsets are in world pixels from the parent\'s top-left corner to the child\'s; leave them blank to keep the spacing the objects already have. Attaching a child that already has a parent replaces the old link. A blank name, a child attached to itself, or a link that would close a cycle warns and holds; a link to an object that has not spawned yet stays quiet and starts working the frame it appears. Links clear when the scene loads again, so re-attach in a gameStart row.'
  });
  addBlock({
    category: 'Attach',
    blockType: 'detach-object',
    runtimeType: 'detachObject',
    kind: 'action',
    label: 'Detach Object',
    color: '#d97706',
    cellLabel: 'Detach Obj',
    defaults: { type: 'detachObject', targetObject: '' },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj }
    ],
    note: 'Detaches the object from whatever it is attached to, so it stops following its parent and stays where it is. Quiet when the object is not attached; a blank object warns and holds.'
  });
  addBlock({
    category: 'Attach',
    blockType: 'set-attachment-offset',
    runtimeType: 'setAttachmentOffset',
    kind: 'action',
    label: 'Set Attachment Offset',
    color: '#92400e',
    cellLabel: 'Set Attach Offset',
    defaults: { type: 'setAttachmentOffset', targetObject: '', offsetX: 0, offsetY: 0 },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'offsetX', label: 'Offset X', control: expr, placeholder: '0' },
      { key: 'offsetY', label: 'Offset Y', control: expr, placeholder: '0' }
    ],
    note: 'Moves an attached object to a new spacing from its parent without re-attaching it — slide the sword from the hero\'s hand to their back, or drop the hat lower on the goblin\'s head. The offsets are in world pixels from the parent\'s top-left corner to the child\'s. Warns and holds when the object is not attached, or when an offset is not a number.'
  });
  addBlock({
    category: 'Attach',
    blockType: 'is-attached',
    runtimeType: 'isAttached',
    kind: 'condition',
    label: 'Is Attached',
    color: '#f59e0b',
    cellLabel: 'Attached?',
    defaults: { type: 'isAttached', targetObject: '', parentObject: '', reversed: false },
    fields: [
      { key: 'targetObject', label: 'Object', control: obj },
      { key: 'parentObject', label: 'Parent object (optional)', control: obj },
      { key: 'reversed', label: 'Invert', control: 'select', options: [[false, 'Off'], [true, 'On']] }
    ],
    note: 'True while the object is attached to something — name a parent to ask about that parent only, leave it blank to ask about any parent. Gate a drop-the-sword row or a pick-up prompt on it. A blank object reads as not attached. Evaluates every frame, even while paused.'
  });
})();
