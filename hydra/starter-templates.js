// Serverless starter projects for the home screen.
//
// P2 item 16/13 — templates are pure builder functions: no DOM, no storage,
// no window at load time, no shared mutable state between builds. The core
// (HydraUniversal) is a dependency, not a global the module assumes: it is
// resolved from the global scope, or injected as the 4th argument to
// createProject, so the module loads and builds in plain node via require().
// The id factory is optional — without one the core mints the project id.
(function () {
  const basePhysics = { gravity: 0, friction: 0.82, bounciness: 0.2, maxSpeed: 25 };

  function sprite(id, name, x, y, width, height, color, overrides = {}) {
    return {
      id, name, kind: 'sprite',
      posX: x, posY: y, width, height,
      velX: 0, velY: 0, rotation: 0,
      color, assetId: null,
      assetFit: 'cover',
      opacity: 1,
      hitboxOffsetX: 0,
      hitboxOffsetY: 0,
      hitboxWidth: width,
      hitboxHeight: height,
      static: false,
      physicsEnabled: false,
      layer: 0,
      showLabel: false,
      uiPinned: false,
      physics: { ...basePhysics },
      text: null,
      fontSize: null,
      fontFamily: null,
      textColor: null,
      textAlign: null,
      bold: false,
      italic: false,
      ...overrides
    };
  }

  function text(id, name, x, y, value, overrides = {}) {
    const _w = overrides.width ?? 180;
    const _h = overrides.height ?? 34;
    return {
      id, name, kind: 'text',
      posX: x, posY: y, width: _w, height: _h,
      velX: 0, velY: 0, rotation: 0,
      color: '#ffffff', assetId: null,
      assetFit: 'cover',
      opacity: 1,
      hitboxOffsetX: 0,
      hitboxOffsetY: 0,
      hitboxWidth: overrides.hitboxWidth ?? _w,
      hitboxHeight: overrides.hitboxHeight ?? _h,
      static: false,
      physicsEnabled: false,
      layer: 20,
      showLabel: false,
      uiPinned: true,
      physics: { ...basePhysics },
      text: value,
      fontSize: 22,
      fontFamily: 'sans-serif',
      textColor: '#111827',
      textAlign: 'left',
      bold: true,
      italic: false,
      ...overrides
    };
  }

  const templates = [
    {
      id: 'blank',
      name: 'Blank Canvas',
      description: 'Clean scene with no starter logic.'
    },
    {
      id: 'flagship',
      name: 'Hydra Quest',
      description: 'Flagship platformer: main menu, how-to, level select, 3 levels, pause menu, save slots, music, sprite animations.',
      featured: true
    },
    {
      id: 'tutorial',
      name: 'First Game Tutorial',
      description: 'The guided first game: move the player with the arrow keys, collect the coin, then hit Preview. Opens with a step-by-step guide in the editor.'
    },
    {
      id: 'variables-demo',
      name: 'Scoped Variables Demo',
      description: 'The Variables manager acceptance game: a global score, per-level coins, and one goblin HP shared across two levels. Watch the Variables tab while you play.'
    },
    {
      id: 'variable-inspector',
      name: 'Variable Inspector',
      description: 'The core-engine acceptance game: a working variable inspector built only from blocks — list variables, edit them with - / + buttons or by typing a number, and watch them change live from play and from the panel.'
    },
    {
      id: 'webapp',
      name: 'Webapp Dashboard',
      description: 'DOM-style UI screen with button, form input, data store, and event logic.'
    },
    {
      id: 'fullgame',
      name: 'Crystal Key Adventure',
      description: 'A complete menu-to-levels game: title screen, two levels, coins, key-door logic, enemies, HUD, and win screen.'
    },
    {
      id: 'platformer',
      name: 'Platformer Quest',
      description: 'Grounded jumps, platforms, camera follow, score pickup, enemy contact, and a goal.'
    },
    {
      id: 'topdown',
      name: 'Top-Down Arena',
      description: 'Four-way movement, enemy chase AI, arena bounds, score and health loops.'
    },
    {
      id: 'collector',
      name: 'Coin Rush',
      description: 'Collectibles, random respawn, timer pressure, hazards, and score text.'
    },
    {
      id: 'shooter',
      name: 'Arcade Shooter',
      description: 'Bullet spawning, projectile motion, enemy respawn, screen shake, and scoring.'
    },
    {
      id: 'physics',
      name: 'Motion Lab',
      description: 'A clean physics starter with one ball, one attractor, simple forces, and a small floor.'
    },
    {
      id: 'scene3d',
      name: '3D Scene',
      description: 'Camera, light, mesh actors, trigger zone, and UI overlay foundation.'
    },
    {
      id: 'fps',
      name: 'FPS Prototype',
      description: 'First-person camera, controller, raycast weapon, target trigger, and HUD.'
    },
    {
      id: 'arenafps',
      name: 'Neon Reactor FPS',
      description: 'Full exported FPS arena with raycast rendering, enemies, pickups, weapon, HUD, minimap, and objective.'
    },
    {
      id: 'towerdefense',
      name: 'Tower Defense',
      description: 'Enemy lanes, build pads, wave timers, base health, score, and upgrade hooks.'
    },
    {
      id: 'roguelike',
      name: 'Dungeon Roguelike',
      description: 'Room movement, hazards, pickups, enemy pursuit, and locked-exit logic.'
    },
    {
      id: 'puzzle',
      name: 'Puzzle Platformer',
      description: 'Switches, doors, crates, jump arcs, collectible keys, and checkpoint logic.'
    },
    {
      id: 'racer',
      name: 'Top-Down Racer',
      description: 'Vehicle physics, laps, checkpoints, drift friction, timer, and obstacles.'
    },
    {
      id: 'rpg',
      name: 'Dialogue RPG',
      description: 'NPC interaction, quest variable, dialogue text, pickup, and scene transition.'
    },
    {
      id: 'survival',
      name: 'Survival Arena',
      description: 'Waves, pickups, enemy spawns, health, score, and escalating difficulty.'
    }
  ];

  function blankScene() {
    return {
      id: 1,
      name: 'Scene 1',
      objects: [],
      bgColor: '#ffffff',
      bgAssetId: null,
      width: 800,
      height: 600,
      worldWidth: 800,
      worldHeight: 600,
      viewportWidth: 800,
      viewportHeight: 600,
      gridData: {},
      logicGrids: { main: {} },
      eventSheets: []
    };
  }

  function webappScene() {
    const title = text(1, 'titleText', 120, 80, 'Hydra Webapp', { width: 360, height: 46, fontSize: 32, textColor: '#0f172a', uiPinned: false });
    const input = text(2, 'nameInput', 120, 160, 'Name input', { width: 260, height: 44, fontSize: 18, textColor: '#1f2937', uiPinned: false });
    input.archetype = 'formInput';
    input.components = [
      { id: 'cmp_form', type: 'FormInput', enabled: true, props: { inputType: 'text', value: '', placeholder: 'Name' } },
      { id: 'cmp_ui', type: 'UIElement', enabled: true, props: { pinned: false, interactive: true, role: 'input' } }
    ];
    const button = text(3, 'submitButton', 410, 160, 'Submit', { width: 140, height: 44, fontSize: 18, textAlign: 'center', textColor: '#ffffff', uiPinned: false, color: '#2563eb' });
    button.archetype = 'button';
    button.components = [
      { id: 'cmp_button', type: 'Button', enabled: true, props: { label: 'Submit', action: 'submitName' } },
      { id: 'cmp_ui_button', type: 'UIElement', enabled: true, props: { pinned: false, interactive: true, role: 'button' } }
    ];
    const output = text(4, 'outputText', 120, 230, 'Output appears here', { width: 430, height: 40, fontSize: 18, textColor: '#334155', uiPinned: false });
    output.components = [{ id: 'cmp_store', type: 'DataStore', enabled: true, props: { records: [] } }];
    return {
      ...blankScene(),
      name: 'Webapp Dashboard',
      bgColor: '#f8fafc',
      objects: [title, input, button, output],
      gridData: {
        1: { type: 'gameStart' },
        2: { type: 'setVariable', varName: 'submissions', operation: 'set', value: 0 },
        61: { type: 'objectClicked', targetObject: 'submitButton', button: 'left', reversed: false },
        62: { type: 'setVariable', varName: 'submissions', operation: 'add', value: 1 },
        63: { type: 'setText', targetObject: 'outputText', useVariable: true, varName: 'submissions', prefix: 'Submissions: ', suffix: '' }
      }
    };
  }

  function platformerScene() {
    return {
      ...blankScene(),
      name: 'Platformer Quest',
      bgColor: '#dbeafe',
      objects: [
        sprite(1, 'player', 80, 486, 44, 54, '#2563eb', {
          physicsEnabled: true,
          physics: { gravity: 0.8, friction: 0.88, bounciness: 0, maxSpeed: 18 },
          layer: 6
        }),
        sprite(2, 'ground', 0, 550, 800, 50, '#14532d', { static: true, layer: 1 }),
        sprite(3, 'platform', 180, 440, 160, 24, '#15803d', { static: true, layer: 2 }),
        sprite(4, 'platform', 420, 355, 150, 24, '#16a34a', { static: true, layer: 2 }),
        sprite(5, 'platform', 640, 470, 120, 24, '#22c55e', { static: true, layer: 2 }),
        sprite(6, 'coin', 475, 315, 30, 30, '#facc15', { static: true, layer: 5 }),
        sprite(7, 'enemy', 650, 512, 38, 38, '#dc2626', {
          physicsEnabled: true,
          physics: { gravity: 0.8, friction: 0.9, bounciness: 0, maxSpeed: 4 },
          layer: 5
        }),
        sprite(8, 'goal', 735, 494, 46, 56, '#10b981', { static: true, layer: 4 }),
        text(9, 'scoreLabel', 18, 18, 'Score', { width: 80, textColor: '#0f172a' }),
        text(10, 'scoreText', 96, 18, '0', { width: 70, textColor: '#0f172a' }),
        text(11, 'livesLabel', 18, 48, 'Lives', { width: 80, textColor: '#0f172a' }),
        text(12, 'livesText', 96, 48, '3', { width: 70, textColor: '#0f172a' }),
        text(13, 'hint', 18, 560, 'Arrows move. Space jumps on ground or platforms.', { width: 500, fontSize: 16, textColor: '#0f172a' })
      ],
      gridData: {
        1: { type: 'gameStart', reversed: false },
        2: { type: 'followCamera', targetObject: 'player', offsetX: 0, offsetY: 0 },
        61: { type: 'gameStart', reversed: false },
        62: { type: 'setVariable', varName: 'score', operation: 'set', value: 0 },
        121: { type: 'gameStart', reversed: false },
        122: { type: 'setVariable', varName: 'lives', operation: 'set', value: 3 },
        181: { type: 'always' },
        182: { type: 'clampToScreen', targetObject: 'player', bounce: false },
        183: { type: 'setText', targetObject: 'scoreText', useVariable: true, varName: 'score' },
        301: { type: 'always' },
        302: { type: 'setText', targetObject: 'livesText', useVariable: true, varName: 'lives' },
        361: { type: 'always' },
        362: { type: 'forceToward', targetObject: 'enemy', sourceObject: 'player', speed: 0.8, mode: 'add' },
        421: { type: 'keyPressed', key: 'ArrowRight', reversed: false },
        422: { type: 'applyForce', targetObject: 'player', forceX: 1.2, forceY: 0, mode: 'add' },
        481: { type: 'keyPressed', key: 'ArrowLeft', reversed: false },
        482: { type: 'applyForce', targetObject: 'player', forceX: -1.2, forceY: 0, mode: 'add' },
        601: { type: 'collision', object1: 'player', object2: 'ground', countTouchingEdges: true, reversed: false },
        602: { type: 'and', logic: 'and' },
        603: { type: 'keyPressed', key: 'Space', trigger: 'pressed', reversed: false },
        662: { type: 'setVelocity', targetObject: 'player', velX: 'player.velX', velY: -15 },
        721: { type: 'collision', object1: 'player', object2: 'platform', countTouchingEdges: true, reversed: false },
        722: { type: 'and', logic: 'and' },
        723: { type: 'keyPressed', key: 'Space', trigger: 'pressed', reversed: false },
        782: { type: 'setVelocity', targetObject: 'player', velX: 'player.velX', velY: -15 },
        901: { type: 'collision', object1: 'player', object2: 'coin', countTouchingEdges: true, reversed: false },
        902: { type: 'setVariable', varName: 'score', operation: 'add', value: 1 },
        903: { type: 'randomVariable', varName: 'coinX', min: 220, max: 760, round: true },
        904: { type: 'randomVariable', varName: 'coinY', min: 300, max: 505, round: true },
        905: { type: 'setPosition', targetObject: 'coin', x: 'coinX', y: 'coinY' },
        1081: { type: 'collision', object1: 'player', object2: 'enemy', countTouchingEdges: true, reversed: false },
        1082: { type: 'setVariable', varName: 'lives', operation: 'subtract', value: 1 },
        1083: { type: 'setVelocity', targetObject: 'player', velX: -8, velY: -8 },
        1084: { type: 'setPosition', targetObject: 'player', x: 80, y: 486 },
        1085: { type: 'screenShake', strength: 5, duration: 0.18 },
        1261: { type: 'collision', object1: 'player', object2: 'goal', countTouchingEdges: true, reversed: false },
        1262: { type: 'setText', targetObject: 'hint', value: 'Goal reached. Add a Switch Scene block here.', useVariable: false, varName: '' }
      }
    };
  }

  function topDownScene() {
    return {
      ...blankScene(),
      name: 'Top-Down Arena',
      bgColor: '#ecfeff',
      objects: [
        sprite(1, 'player', 376, 276, 48, 48, '#0ea5e9', {
          physicsEnabled: true,
          physics: { gravity: 0, friction: 0.76, bounciness: 0.2, maxSpeed: 10 },
          layer: 6
        }),
        sprite(2, 'enemy', 650, 120, 44, 44, '#ef4444', {
          physicsEnabled: true,
          physics: { gravity: 0, friction: 0.9, bounciness: 0.1, maxSpeed: 5 },
          layer: 5
        }),
        sprite(3, 'goal', 680, 470, 58, 58, '#22c55e', { static: true, layer: 3 }),
        sprite(4, 'wall', 260, 190, 280, 24, '#334155', { static: true, layer: 2 }),
        sprite(5, 'wall', 260, 386, 280, 24, '#334155', { static: true, layer: 2 }),
        text(6, 'scoreLabel', 18, 18, 'Score', { width: 80 }),
        text(7, 'scoreText', 96, 18, '0', { width: 70 }),
        text(8, 'hint', 18, 550, 'Reach the green zone while the enemy chases you.', { width: 520, fontSize: 16 })
      ],
      gridData: {
        1: { type: 'gameStart', reversed: false },
        2: { type: 'setVariable', varName: 'score', operation: 'set', value: 0 },
        61: { type: 'always' },
        62: { type: 'clampToScreen', targetObject: 'player', bounce: false },
        63: { type: 'setText', targetObject: 'scoreText', useVariable: true, varName: 'score' },
        180: { type: 'always' },
        181: { type: 'forceToward', targetObject: 'enemy', sourceObject: 'player', speed: 0.45, mode: 'add' },
        182: { type: 'faceMovement', targetObject: 'enemy', offsetAngle: 0, minSpeed: 0.05 },
        301: { type: 'keyPressed', key: 'ArrowRight', reversed: false },
        302: { type: 'applyForce', targetObject: 'player', forceX: 0.9, forceY: 0, mode: 'add' },
        361: { type: 'keyPressed', key: 'ArrowLeft', reversed: false },
        362: { type: 'applyForce', targetObject: 'player', forceX: -0.9, forceY: 0, mode: 'add' },
        421: { type: 'keyPressed', key: 'ArrowUp', reversed: false },
        422: { type: 'applyForce', targetObject: 'player', forceX: 0, forceY: -0.9, mode: 'add' },
        481: { type: 'keyPressed', key: 'ArrowDown', reversed: false },
        482: { type: 'applyForce', targetObject: 'player', forceX: 0, forceY: 0.9, mode: 'add' },
        661: { type: 'collision', object1: 'player', object2: 'goal', countTouchingEdges: true, reversed: false },
        662: { type: 'setVariable', varName: 'score', operation: 'add', value: 10 },
        663: { type: 'setPosition', targetObject: 'goal', x: 'Math.floor(Math.random() * 690) + 40', y: 'Math.floor(Math.random() * 460) + 70' },
        841: { type: 'collision', object1: 'player', object2: 'enemy', countTouchingEdges: true, reversed: false },
        840: { type: 'setVelocity', targetObject: 'enemy', velX: 0, velY: 0 },
        842: { type: 'screenShake', strength: 7, duration: 0.2 },
        843: { type: 'setPosition', targetObject: 'player', x: 376, y: 276 }
      }
    };
  }

  function collectorScene() {
    return {
      ...blankScene(),
      name: 'Coin Rush',
      bgColor: '#fff7ed',
      objects: [
        sprite(1, 'player', 80, 80, 46, 46, '#2563eb', {
          physicsEnabled: true,
          physics: { gravity: 0, friction: 0.78, bounciness: 0.2, maxSpeed: 11 },
          layer: 5
        }),
        sprite(2, 'coin', 520, 320, 32, 32, '#facc15', { static: true, layer: 3 }),
        sprite(3, 'hazard', 610, 120, 50, 50, '#dc2626', {
          physicsEnabled: true,
          physics: { gravity: 0, friction: 0.95, bounciness: 0.5, maxSpeed: 7 },
          layer: 4
        }),
        text(4, 'scoreLabel', 18, 18, 'Score', { width: 80 }),
        text(5, 'scoreText', 96, 18, '0', { width: 70 }),
        text(6, 'hint', 18, 550, 'Collect coins. The hazard homes in when you get close.', { width: 520, fontSize: 16 })
      ],
      gridData: {
        1: { type: 'gameStart', reversed: false },
        2: { type: 'setVariable', varName: 'score', operation: 'set', value: 0 },
        61: { type: 'always' },
        62: { type: 'clampToScreen', targetObject: 'player', bounce: false },
        63: { type: 'setText', targetObject: 'scoreText', useVariable: true, varName: 'score' },
        121: { type: 'keyPressed', key: 'ArrowRight', reversed: false },
        122: { type: 'applyForce', targetObject: 'player', forceX: 0.9, forceY: 0, mode: 'add' },
        181: { type: 'keyPressed', key: 'ArrowLeft', reversed: false },
        182: { type: 'applyForce', targetObject: 'player', forceX: -0.9, forceY: 0, mode: 'add' },
        241: { type: 'keyPressed', key: 'ArrowUp', reversed: false },
        242: { type: 'applyForce', targetObject: 'player', forceX: 0, forceY: -0.9, mode: 'add' },
        301: { type: 'keyPressed', key: 'ArrowDown', reversed: false },
        302: { type: 'applyForce', targetObject: 'player', forceX: 0, forceY: 0.9, mode: 'add' },
        361: { type: 'distanceCheck', object1: 'hazard', object2: 'player', operator: '<=', distance: 260, reversed: false },
        362: { type: 'forceToward', targetObject: 'hazard', sourceObject: 'player', speed: 0.35, mode: 'add' },
        421: { type: 'always' },
        422: { type: 'wrapScreen', targetObject: 'hazard' },
        481: { type: 'collision', object1: 'player', object2: 'coin', countTouchingEdges: true, reversed: false },
        482: { type: 'setVariable', varName: 'score', operation: 'add', value: 1 },
        483: { type: 'setPosition', targetObject: 'coin', x: 'Math.floor(Math.random()*670)+50', y: 'Math.floor(Math.random()*450)+70' },
        541: { type: 'collision', object1: 'player', object2: 'hazard', countTouchingEdges: true, reversed: false },
        542: { type: 'screenShake', strength: 7, duration: 0.2 },
        543: { type: 'setPosition', targetObject: 'player', x: 80, y: 80 },
        544: { type: 'setVariable', varName: 'score', operation: 'subtract', value: 3 }
      }
    };
  }

  // P3 item 21 — guided first-run tutorial: the smallest complete game that
  // teaches the editor in about five minutes. One scene, one event per row
  // (see the template logic audit, tests/templates.test.js): move the
  // player with the arrow keys, touch the coin to score, then hit Preview.
  function tutorialScene() {
    return {
      ...blankScene(),
      name: 'First Game',
      bgColor: '#eff6ff',
      objects: [
        sprite(1, 'player', 80, 80, 46, 46, '#2563eb', {
          physicsEnabled: true,
          physics: { gravity: 0, friction: 0.78, bounciness: 0.2, maxSpeed: 11 },
          layer: 5
        }),
        sprite(2, 'coin', 520, 320, 32, 32, '#facc15', { static: true, layer: 3 }),
        text(3, 'scoreLabel', 18, 18, 'Score', { width: 80, textColor: '#0f172a' }),
        text(4, 'scoreText', 96, 18, '0', { width: 70, textColor: '#0f172a' }),
        text(5, 'hint', 18, 550, 'Arrow keys move. Touch the coin to score. Then open Preview and play.', { width: 560, fontSize: 16, textColor: '#0f172a' })
      ],
      gridData: {
        1: { type: 'gameStart', reversed: false },
        2: { type: 'setVariable', varName: 'score', operation: 'set', value: 0 },
        61: { type: 'always' },
        62: { type: 'clampToScreen', targetObject: 'player', bounce: false },
        63: { type: 'setText', targetObject: 'scoreText', useVariable: true, varName: 'score' },
        121: { type: 'keyPressed', key: 'ArrowRight', reversed: false },
        122: { type: 'applyForce', targetObject: 'player', forceX: 0.9, forceY: 0, mode: 'add' },
        181: { type: 'keyPressed', key: 'ArrowLeft', reversed: false },
        182: { type: 'applyForce', targetObject: 'player', forceX: -0.9, forceY: 0, mode: 'add' },
        241: { type: 'keyPressed', key: 'ArrowUp', reversed: false },
        242: { type: 'applyForce', targetObject: 'player', forceX: 0, forceY: -0.9, mode: 'add' },
        301: { type: 'keyPressed', key: 'ArrowDown', reversed: false },
        302: { type: 'applyForce', targetObject: 'player', forceX: 0, forceY: 0.9, mode: 'add' },
        361: { type: 'collision', object1: 'player', object2: 'coin', countTouchingEdges: true, reversed: false },
        362: { type: 'setVariable', varName: 'score', operation: 'add', value: 1 },
        363: { type: 'setPosition', targetObject: 'coin', x: 'Math.floor(Math.random()*670)+50', y: 'Math.floor(Math.random()*450)+70' }
      }
    };
  }

  // P5 core-engine track, item P5-1, slice b — the Scoped Variables
  // Demo: the acceptance game for the Variables manager. Two levels,
  // one event per row (see the template logic audit,
  // tests/templates.test.js). No block sets the starting values —
  // they come from the project's scoped-variable definitions (see
  // createProject below): a global score (kept across scenes), a
  // scene coins counter (each level starts from 0), and an object hp
  // for the goblin (one value per goblin NAME, so it carries across
  // levels — hurt the goblin here, and the level-2 goblin shows the
  // same hp). Touch the coin to score, touch the goblin three times
  // to beat it (+50), reach the door to change level, and watch the
  // Variables tab: the values there are live while you play.
  function variablesDemoScene(id, name, bgColor, coinX, coinY, doorX, doorTo, hint) {
    return {
      ...blankScene(),
      id: id,
      name: name,
      bgColor: bgColor,
      objects: [
        sprite(1, 'player', 80, 140, 46, 46, '#38bdf8', {
          physicsEnabled: true,
          physics: { gravity: 0, friction: 0.78, bounciness: 0.2, maxSpeed: 11 },
          layer: 5
        }),
        sprite(2, 'coin', coinX, coinY, 32, 32, '#facc15', { static: true, layer: 3 }),
        sprite(3, 'goblin', 600, 140, 44, 44, '#ef4444', { static: true, layer: 4 }),
        sprite(4, 'door', doorX, 500, 58, 58, '#22c55e', { static: true, layer: 3 }),
        text(5, 'scoreLabel', 18, 18, 'Score', { width: 80, textColor: '#e0f2fe' }),
        text(6, 'scoreText', 96, 18, '0', { width: 70, textColor: '#e0f2fe' }),
        text(7, 'coinsLabel', 18, 48, 'Coins', { width: 80, textColor: '#e0f2fe' }),
        text(8, 'coinsText', 96, 48, '0', { width: 70, textColor: '#e0f2fe' }),
        text(9, 'hpLabel', 18, 78, 'Goblin HP', { width: 110, textColor: '#e0f2fe' }),
        text(10, 'hpText', 128, 78, '30', { width: 70, textColor: '#e0f2fe' }),
        text(11, 'hint', 18, 550, hint, { width: 700, fontSize: 16, textColor: '#e0f2fe' })
      ],
      gridData: {
        61: { type: 'always' },
        62: { type: 'clampToScreen', targetObject: 'player', bounce: false },
        63: { type: 'readScopedVariable', scope: 'global', varName: 'score', storeVarName: 'scoreNow' },
        64: { type: 'setText', targetObject: 'scoreText', useVariable: true, varName: 'scoreNow' },
        65: { type: 'readScopedVariable', scope: 'scene', varName: 'coins', storeVarName: 'coinsNow' },
        66: { type: 'setText', targetObject: 'coinsText', useVariable: true, varName: 'coinsNow' },
        67: { type: 'readScopedVariable', scope: 'object', targetObject: 'goblin', varName: 'hp', storeVarName: 'hpNow' },
        68: { type: 'setText', targetObject: 'hpText', useVariable: true, varName: 'hpNow' },
        121: { type: 'keyPressed', key: 'ArrowRight', reversed: false },
        122: { type: 'applyForce', targetObject: 'player', forceX: 0.9, forceY: 0, mode: 'add' },
        181: { type: 'keyPressed', key: 'ArrowLeft', reversed: false },
        182: { type: 'applyForce', targetObject: 'player', forceX: -0.9, forceY: 0, mode: 'add' },
        241: { type: 'keyPressed', key: 'ArrowUp', reversed: false },
        242: { type: 'applyForce', targetObject: 'player', forceX: 0, forceY: -0.9, mode: 'add' },
        301: { type: 'keyPressed', key: 'ArrowDown', reversed: false },
        302: { type: 'applyForce', targetObject: 'player', forceX: 0, forceY: 0.9, mode: 'add' },
        361: { type: 'collision', object1: 'player', object2: 'coin', countTouchingEdges: true, reversed: false },
        362: { type: 'readScopedVariable', scope: 'scene', varName: 'coins', storeVarName: 'coinsNow' },
        363: { type: 'setScopedVariable', scope: 'scene', varName: 'coins', valueKind: 'number', value: 'coinsNow + 1' },
        364: { type: 'readScopedVariable', scope: 'global', varName: 'score', storeVarName: 'scoreNow' },
        365: { type: 'setScopedVariable', scope: 'global', varName: 'score', valueKind: 'number', value: 'scoreNow + 10' },
        366: { type: 'setPosition', targetObject: 'coin', x: 'Math.floor(Math.random()*670)+50', y: 'Math.floor(Math.random()*450)+70' },
        421: { type: 'collision', object1: 'player', object2: 'goblin', countTouchingEdges: true, reversed: false },
        422: { type: 'readScopedVariable', scope: 'object', targetObject: 'goblin', varName: 'hp', storeVarName: 'hpNow' },
        423: { type: 'setScopedVariable', scope: 'object', targetObject: 'goblin', varName: 'hp', valueKind: 'number', value: 'hpNow - 10' },
        424: { type: 'setPosition', targetObject: 'goblin', x: 'Math.floor(Math.random()*670)+50', y: 'Math.floor(Math.random()*450)+70' },
        425: { type: 'screenShake', strength: 5, duration: 0.15 },
        481: { type: 'scopedVariableCheck', scope: 'object', targetObject: 'goblin', varName: 'hp', operator: '<=', compareValue: 0, reversed: false },
        // The kill chain uses a vertical `and`: the check sits above
        // the `and`, the Exists sits left of it, and the four actions
        // run on the row below the `and`. The actions must not sit
        // below any triggering condition but the `and` — a condition
        // fires the actions adjacent to it, so the old horizontal
        // shape (check / and / exists on one row, actions below)
        // let the Exists fire the score action every frame on its
        // own, inflating the score 50 a frame while the goblin lived.
        540: { type: 'scopedVariableExists', scope: 'object', targetObject: 'goblin', varName: 'hp', reversed: false },
        541: { type: 'and', logic: 'and' },
        601: { type: 'destroyObject', targetObject: 'goblin' },
        602: { type: 'readScopedVariable', scope: 'global', varName: 'score', storeVarName: 'scoreNow' },
        603: { type: 'setScopedVariable', scope: 'global', varName: 'score', valueKind: 'number', value: 'scoreNow + 50' },
        604: { type: 'setScopedVariable', scope: 'object', targetObject: 'goblin', varName: 'hp', valueKind: 'number', value: 30 },
        721: { type: 'collision', object1: 'player', object2: 'door', countTouchingEdges: true, reversed: false },
        722: { type: 'switchScene', sceneId: doorTo }
      }
    };
  }

  function variablesDemoScenes() {
    return [
      variablesDemoScene(1, 'Level 1', '#0f172a', 520, 320, 700, 2,
        'Arrows move. Grab the coin, hit the goblin 3 times, then take the green door.'),
      variablesDemoScene(2, 'Level 2', '#1e1b4b', 240, 400, 60, 1,
        'Same goblin, same HP. Coins start over here. Head back through the door.')
    ];
  }

  // P5 core-engine track, item P5-9 (the build-the-editor test):
  // a working variable inspector built ONLY from HydraScript
  // blocks — list variables, edit values, watch them change. One
  // scene: the inspector panel floats at the top (text objects are
  // UI-pinned, so the rows stay on screen while the player roams),
  // and the coin + goblin gameplay from the Scoped Variables Demo
  // keeps changing the same values from play, so the panel watches
  // change from both sides. Four rows, one per watched variable:
  // global score, scene coins, the goblin's object hp, and a global
  // text name (shown, not edited — the typed row writes numbers).
  // Each numeric row has - / + buttons (Object Clicked reads the
  // variable, writes it back one step). The typed row is the digit
  // keys (just pressed) appending to an input text object, a Set
  // button reading the text back with Read Text Into Variable and
  // copying it into the score, then clearing the field so the next
  // number starts fresh; Clear empties the field without setting.
  // No block sets the starting values — they come from the
  // project's scoped-variable definitions (see createProject):
  // score 0, coins 0, goblin hp 30, name 'Ky'.
  function variableInspectorScene() {
    // Real Button components: a plain text object never draws its
    // `color` as a background (drawTextObject only fills when
    // HydraUI.isButton is true), so the - / + / Set / Clear controls
    // are buttons with a Button component and an explicit buttonStyle,
    // or they render as bare glyphs. The Set button is blue, the rest
    // slate. The input field gets a panel behind it for the same
    // reason: an empty text object is invisible, so without the panel
    // the player cannot see where to type.
    function btn(id, name, x, y, label, w, fill, hover, pressed) {
      return text(id, name, x, y, label, {
        width: w, textAlign: 'center', textColor: '#e0f2fe',
        archetype: 'button',
        buttonStyle: { normal: fill, hover: hover, pressed: pressed },
        components: [{ id: 'cmp_' + name, type: 'Button', enabled: true, props: { label: label, action: '' } }]
      });
    }
    const inputBox = {
      id: 24, name: 'scoreInputBox', kind: 'panel', archetype: 'panel',
      posX: 128, posY: 212, width: 120, height: 34,
      velX: 0, velY: 0, rotation: 0,
      color: '#1e293b', assetId: null, assetFit: 'cover', opacity: 1,
      hitboxOffsetX: 0, hitboxOffsetY: 0, hitboxWidth: 120, hitboxHeight: 34,
      static: true, physicsEnabled: false, layer: 19, showLabel: false, uiPinned: true,
      anchor: 'none', hud: false, cornerRadius: 6, borderWidth: 0,
      physics: { ...basePhysics }, text: null, fontSize: null, fontFamily: null,
      textColor: null, textAlign: null, bold: false, italic: false
    };
    return {
      ...blankScene(),
      name: 'Variable Inspector',
      bgColor: '#0f172a',
      objects: [
        sprite(1, 'player', 80, 320, 46, 46, '#38bdf8', {
          physicsEnabled: true,
          physics: { gravity: 0, friction: 0.78, bounciness: 0.2, maxSpeed: 11 },
          layer: 5
        }),
        sprite(2, 'coin', 520, 400, 32, 32, '#facc15', { static: true, layer: 3 }),
        sprite(3, 'goblin', 600, 320, 44, 44, '#ef4444', { static: true, layer: 4 }),
        text(4, 'inspectorTitle', 18, 14, 'Variable Inspector', { width: 300, fontSize: 22, textColor: '#e0f2fe' }),
        text(5, 'scoreLabel', 18, 48, 'Score', { width: 80, textColor: '#e0f2fe' }),
        text(6, 'scoreText', 96, 48, '0', { width: 70, textColor: '#e0f2fe' }),
        btn(7, 'scoreMinus', 176, 48, '-', 36, '#334155', '#475569', '#1e293b'),
        btn(8, 'scorePlus', 218, 48, '+', 36, '#334155', '#475569', '#1e293b'),
        text(9, 'coinsLabel', 18, 88, 'Coins', { width: 80, textColor: '#e0f2fe' }),
        text(10, 'coinsText', 96, 88, '0', { width: 70, textColor: '#e0f2fe' }),
        btn(11, 'coinsMinus', 176, 88, '-', 36, '#334155', '#475569', '#1e293b'),
        btn(12, 'coinsPlus', 218, 88, '+', 36, '#334155', '#475569', '#1e293b'),
        text(13, 'hpLabel', 18, 128, 'Goblin HP', { width: 110, textColor: '#e0f2fe' }),
        text(14, 'hpText', 128, 128, '30', { width: 70, textColor: '#e0f2fe' }),
        btn(15, 'hpMinus', 208, 128, '-', 36, '#334155', '#475569', '#1e293b'),
        btn(16, 'hpPlus', 250, 128, '+', 36, '#334155', '#475569', '#1e293b'),
        text(17, 'nameLabel', 18, 168, 'Name', { width: 80, textColor: '#e0f2fe' }),
        text(18, 'nameText', 96, 168, 'Ky', { width: 120, textColor: '#e0f2fe' }),
        text(19, 'typeLabel', 18, 212, 'Set score:', { width: 100, textColor: '#e0f2fe' }),
        inputBox,
        text(20, 'scoreInput', 128, 212, '', { width: 120, textColor: '#e0f2fe' }),
        btn(21, 'scoreSetBtn', 258, 212, 'Set', 64, '#2563eb', '#1d4ed8', '#1e40af'),
        btn(22, 'scoreClearBtn', 328, 212, 'Clear', 64, '#334155', '#475569', '#1e293b'),
        text(23, 'hint', 18, 532, 'Arrows move. Grab the coin, bump the goblin.', { width: 740, fontSize: 16, textColor: '#e0f2fe' }),
        text(25, 'hint2', 18, 560, 'Click - / + to edit, or type a number and press Set.', { width: 740, fontSize: 16, textColor: '#e0f2fe' })
      ],
      gridData: {
        61: { type: 'always' },
        62: { type: 'readScopedVariable', scope: 'global', varName: 'score', storeVarName: 'scoreNow' },
        63: { type: 'setText', targetObject: 'scoreText', useVariable: true, varName: 'scoreNow' },
        64: { type: 'readScopedVariable', scope: 'scene', varName: 'coins', storeVarName: 'coinsNow' },
        65: { type: 'setText', targetObject: 'coinsText', useVariable: true, varName: 'coinsNow' },
        66: { type: 'readScopedVariable', scope: 'object', targetObject: 'goblin', varName: 'hp', storeVarName: 'hpNow' },
        67: { type: 'setText', targetObject: 'hpText', useVariable: true, varName: 'hpNow' },
        68: { type: 'readScopedVariable', scope: 'global', varName: 'playerName', storeVarName: 'nameNow' },
        69: { type: 'setText', targetObject: 'nameText', useVariable: true, varName: 'nameNow' },
        121: { type: 'keyPressed', key: 'ArrowRight', reversed: false },
        122: { type: 'applyForce', targetObject: 'player', forceX: 0.9, forceY: 0, mode: 'add' },
        181: { type: 'keyPressed', key: 'ArrowLeft', reversed: false },
        182: { type: 'applyForce', targetObject: 'player', forceX: -0.9, forceY: 0, mode: 'add' },
        241: { type: 'keyPressed', key: 'ArrowUp', reversed: false },
        242: { type: 'applyForce', targetObject: 'player', forceX: 0, forceY: -0.9, mode: 'add' },
        301: { type: 'keyPressed', key: 'ArrowDown', reversed: false },
        302: { type: 'applyForce', targetObject: 'player', forceX: 0, forceY: 0.9, mode: 'add' },
        361: { type: 'collision', object1: 'player', object2: 'coin', countTouchingEdges: true, reversed: false },
        362: { type: 'readScopedVariable', scope: 'scene', varName: 'coins', storeVarName: 'coinsNow' },
        363: { type: 'setScopedVariable', scope: 'scene', varName: 'coins', valueKind: 'number', value: 'coinsNow + 1' },
        364: { type: 'readScopedVariable', scope: 'global', varName: 'score', storeVarName: 'scoreNow' },
        365: { type: 'setScopedVariable', scope: 'global', varName: 'score', valueKind: 'number', value: 'scoreNow + 10' },
        366: { type: 'setPosition', targetObject: 'coin', x: 'Math.floor(Math.random()*670)+50', y: 'Math.floor(Math.random()*450)+70' },
        421: { type: 'collision', object1: 'player', object2: 'goblin', countTouchingEdges: true, reversed: false },
        422: { type: 'readScopedVariable', scope: 'object', targetObject: 'goblin', varName: 'hp', storeVarName: 'hpNow' },
        423: { type: 'setScopedVariable', scope: 'object', targetObject: 'goblin', varName: 'hp', valueKind: 'number', value: 'hpNow - 10' },
        424: { type: 'setPosition', targetObject: 'goblin', x: 'Math.floor(Math.random()*670)+50', y: 'Math.floor(Math.random()*450)+70' },
        425: { type: 'screenShake', strength: 5, duration: 0.15 },
        481: { type: 'scopedVariableCheck', scope: 'object', targetObject: 'goblin', varName: 'hp', operator: '<=', compareValue: 0, reversed: false },
        540: { type: 'scopedVariableExists', scope: 'object', targetObject: 'goblin', varName: 'hp', reversed: false },
        541: { type: 'and', logic: 'and' },
        601: { type: 'destroyObject', targetObject: 'goblin' },
        602: { type: 'readScopedVariable', scope: 'global', varName: 'score', storeVarName: 'scoreNow' },
        603: { type: 'setScopedVariable', scope: 'global', varName: 'score', valueKind: 'number', value: 'scoreNow + 50' },
        604: { type: 'setScopedVariable', scope: 'object', targetObject: 'goblin', varName: 'hp', valueKind: 'number', value: 30 },
        721: { type: 'objectClicked', targetObject: 'scoreMinus', button: 'left', reversed: false },
        722: { type: 'readScopedVariable', scope: 'global', varName: 'score', storeVarName: 'scoreNow' },
        723: { type: 'setScopedVariable', scope: 'global', varName: 'score', valueKind: 'number', value: 'scoreNow - 1' },
        781: { type: 'objectClicked', targetObject: 'scorePlus', button: 'left', reversed: false },
        782: { type: 'readScopedVariable', scope: 'global', varName: 'score', storeVarName: 'scoreNow' },
        783: { type: 'setScopedVariable', scope: 'global', varName: 'score', valueKind: 'number', value: 'scoreNow + 1' },
        841: { type: 'objectClicked', targetObject: 'coinsMinus', button: 'left', reversed: false },
        842: { type: 'readScopedVariable', scope: 'scene', varName: 'coins', storeVarName: 'coinsNow' },
        843: { type: 'setScopedVariable', scope: 'scene', varName: 'coins', valueKind: 'number', value: 'coinsNow - 1' },
        901: { type: 'objectClicked', targetObject: 'coinsPlus', button: 'left', reversed: false },
        902: { type: 'readScopedVariable', scope: 'scene', varName: 'coins', storeVarName: 'coinsNow' },
        903: { type: 'setScopedVariable', scope: 'scene', varName: 'coins', valueKind: 'number', value: 'coinsNow + 1' },
        961: { type: 'objectClicked', targetObject: 'hpMinus', button: 'left', reversed: false },
        962: { type: 'readScopedVariable', scope: 'object', targetObject: 'goblin', varName: 'hp', storeVarName: 'hpNow' },
        963: { type: 'setScopedVariable', scope: 'object', targetObject: 'goblin', varName: 'hp', valueKind: 'number', value: 'hpNow - 1' },
        1021: { type: 'objectClicked', targetObject: 'hpPlus', button: 'left', reversed: false },
        1022: { type: 'readScopedVariable', scope: 'object', targetObject: 'goblin', varName: 'hp', storeVarName: 'hpNow' },
        1023: { type: 'setScopedVariable', scope: 'object', targetObject: 'goblin', varName: 'hp', valueKind: 'number', value: 'hpNow + 1' },
        1081: { type: 'keyJustPressed', key: 'Digit0', inputCondition: 'keyJustPressed', reversed: false },
        1082: { type: 'appendText', targetObject: 'scoreInput', value: '0' },
        1141: { type: 'keyJustPressed', key: 'Digit1', inputCondition: 'keyJustPressed', reversed: false },
        1142: { type: 'appendText', targetObject: 'scoreInput', value: '1' },
        1201: { type: 'keyJustPressed', key: 'Digit2', inputCondition: 'keyJustPressed', reversed: false },
        1202: { type: 'appendText', targetObject: 'scoreInput', value: '2' },
        1261: { type: 'keyJustPressed', key: 'Digit3', inputCondition: 'keyJustPressed', reversed: false },
        1262: { type: 'appendText', targetObject: 'scoreInput', value: '3' },
        1321: { type: 'keyJustPressed', key: 'Digit4', inputCondition: 'keyJustPressed', reversed: false },
        1322: { type: 'appendText', targetObject: 'scoreInput', value: '4' },
        1381: { type: 'keyJustPressed', key: 'Digit5', inputCondition: 'keyJustPressed', reversed: false },
        1382: { type: 'appendText', targetObject: 'scoreInput', value: '5' },
        1441: { type: 'keyJustPressed', key: 'Digit6', inputCondition: 'keyJustPressed', reversed: false },
        1442: { type: 'appendText', targetObject: 'scoreInput', value: '6' },
        1501: { type: 'keyJustPressed', key: 'Digit7', inputCondition: 'keyJustPressed', reversed: false },
        1502: { type: 'appendText', targetObject: 'scoreInput', value: '7' },
        1561: { type: 'keyJustPressed', key: 'Digit8', inputCondition: 'keyJustPressed', reversed: false },
        1562: { type: 'appendText', targetObject: 'scoreInput', value: '8' },
        1621: { type: 'keyJustPressed', key: 'Digit9', inputCondition: 'keyJustPressed', reversed: false },
        1622: { type: 'appendText', targetObject: 'scoreInput', value: '9' },
        1681: { type: 'objectClicked', targetObject: 'scoreSetBtn', button: 'left', reversed: false },
        1682: { type: 'readTextIntoVariable', targetObject: 'scoreInput', mode: 'number', storeVarName: 'typedValue' },
        1683: { type: 'setScopedVariable', scope: 'global', varName: 'score', valueKind: 'variable', value: 'typedValue' },
        1684: { type: 'setText', targetObject: 'scoreInput', value: '', useVariable: false, varName: '' },
        1741: { type: 'objectClicked', targetObject: 'scoreClearBtn', button: 'left', reversed: false },
        1742: { type: 'setText', targetObject: 'scoreInput', value: '', useVariable: false, varName: '' }
      }
    };
  }

  function shooterScene() {
    return {
      ...blankScene(),
      name: 'Arcade Shooter',
      bgColor: '#0f172a',
      objects: [
        sprite(1, 'player', 70, 275, 52, 38, '#38bdf8', {
          physicsEnabled: true,
          physics: { gravity: 0, friction: 0.8, bounciness: 0.1, maxSpeed: 9 },
          layer: 5
        }),
        sprite(2, 'bullet', -120, -120, 18, 8, '#facc15', {
          physicsEnabled: true,
          physics: { gravity: 0, friction: 1, bounciness: 0, maxSpeed: 18 },
          layer: 4
        }),
        sprite(3, 'enemy', 640, 250, 48, 48, '#ef4444', {
          physicsEnabled: true,
          physics: { gravity: 0, friction: 1, bounciness: 0, maxSpeed: 5 },
          layer: 4
        }),
        text(4, 'scoreLabel', 18, 18, 'Score', { width: 80, textColor: '#e0f2fe' }),
        text(5, 'scoreText', 96, 18, '0', { width: 80, textColor: '#e0f2fe' }),
        text(6, 'hint', 18, 550, 'Up/Down move. Space spawns bullets from the player.', { width: 520, fontSize: 16, textColor: '#e0f2fe' })
      ],
      gridData: {
        1: { type: 'gameStart', reversed: false },
        2: { type: 'setVariable', varName: 'score', operation: 'set', value: 0 },
        61: { type: 'always' },
        62: { type: 'clampToScreen', targetObject: 'player', bounce: false },
        63: { type: 'setText', targetObject: 'scoreText', useVariable: true, varName: 'score' },
        64: { type: 'setVelocity', targetObject: 'bullet', velX: 14, velY: 0 },
        121: { type: 'always' },
        122: { type: 'forceTowardPosition', targetObject: 'enemy', targetX: -80, targetY: 'enemy.posY', speed: 2, mode: 'set' },
        181: { type: 'keyPressed', key: 'ArrowUp', reversed: false },
        182: { type: 'applyForce', targetObject: 'player', forceX: 0, forceY: -0.9, mode: 'add' },
        241: { type: 'keyPressed', key: 'ArrowDown', reversed: false },
        242: { type: 'applyForce', targetObject: 'player', forceX: 0, forceY: 0.9, mode: 'add' },
        301: { type: 'keyPressed', key: 'Space', trigger: 'pressed', reversed: false },
        302: { type: 'spawnAtObject', sourceObject: 'bullet', targetObject: 'player', offsetX: 36, offsetY: 0 },
        361: { type: 'collision', object1: 'bullet', object2: 'enemy', countTouchingEdges: true, reversed: false },
        362: { type: 'setVariable', varName: 'score', operation: 'add', value: 5 },
        363: { type: 'screenShake', strength: 6, duration: 0.16 },
        364: { type: 'setPosition', targetObject: 'enemy', x: 720, y: 'Math.floor(Math.random()*430)+70' },
        421: { type: 'positionCheck', targetObject: 'enemy', property: 'posX', operator: '<=', value: -40, reversed: false },
        422: { type: 'setPosition', targetObject: 'enemy', x: 720, y: 'Math.floor(Math.random()*430)+70' }
      }
    };
  }

  function physicsScene() {
    return {
      ...blankScene(),
      name: 'Motion Lab',
      bgColor: '#f1f5f9',
      objects: [
        sprite(1, 'ball', 160, 80, 44, 44, '#f97316', {
          physicsEnabled: true,
          physics: { gravity: 0.65, friction: 0.98, bounciness: 0.55, maxSpeed: 16 },
          layer: 5
        }),
        sprite(2, 'attractor', 610, 314, 42, 42, '#7c3aed', { static: true, layer: 3 }),
        sprite(3, 'floor', 60, 548, 680, 34, '#334155', { static: true, layer: 1 }),
        text(4, 'hint', 18, 18, 'Hold left mouse to pull the ball. Space makes it bouncier.', { width: 560, fontSize: 17 })
      ],
      gridData: {
        1: { type: 'gameStart', reversed: false },
        2: { type: 'setMaxSpeed', targetObject: 'ball', maxSpeed: 16 },
        61: { type: 'always' },
        62: { type: 'clampToScreen', targetObject: 'ball', bounce: true },
        181: { type: 'mouseClick', button: 'left', reversed: false },
        182: { type: 'forceToward', targetObject: 'ball', sourceObject: 'attractor', speed: 0.42, mode: 'add' },
        241: { type: 'keyPressed', key: 'Space', trigger: 'pressed', reversed: false },
        242: { type: 'setBounciness', targetObject: 'ball', bounciness: 0.8 },
        301: { type: 'keyPressed', key: 'KeyR', trigger: 'pressed', reversed: false },
        302: { type: 'setPosition', targetObject: 'ball', x: 160, y: 80 },
        303: { type: 'setVelocity', targetObject: 'ball', velX: 0, velY: 0 }
      }
    };
  }

  function fullGameScenes() {
    const menu = {
      ...blankScene(),
      id: 1,
      name: 'Main Menu',
      bgColor: '#08111f',
      objects: [
        sprite(1, 'menuBackdrop', 0, 0, 800, 600, '#08111f', { static: true, layer: 0 }),
        sprite(2, 'startButton', 275, 330, 250, 64, '#2563eb', { static: true, layer: 3, hitboxWidth: 250, hitboxHeight: 64 }),
        sprite(3, 'spark', 170, 170, 44, 44, '#facc15', { static: true, layer: 2, rotation: 18 }),
        sprite(4, 'spark', 590, 132, 34, 34, '#38bdf8', { static: true, layer: 2, rotation: -22 }),
        text(5, 'titleText', 116, 130, 'Crystal Key Adventure', { width: 600, height: 60, fontSize: 44, textColor: '#f8fafc', textAlign: 'center', uiPinned: false }),
        text(6, 'subtitleText', 164, 210, 'A complete editable HydraScript game template', { width: 480, height: 34, fontSize: 20, textColor: '#bfdbfe', textAlign: 'center', uiPinned: false, bold: false }),
        text(7, 'startText', 325, 346, 'Start Game', { width: 160, height: 30, fontSize: 24, textColor: '#ffffff', textAlign: 'center', uiPinned: false }),
        text(8, 'menuHelp', 208, 430, 'Click Start or press Enter. Open the Script Editor to see every event.', { width: 420, height: 40, fontSize: 16, textColor: '#cbd5e1', textAlign: 'center', uiPinned: false, bold: false })
      ],
      gridData: {
        61: { type: 'objectClicked', targetObject: 'startButton', button: 'left', reversed: false },
        62: { type: 'switchScene', sceneId: 2 },
        121: { type: 'keyPressed', inputCondition: 'keyJustPressed', key: 'Enter', trigger: 'pressed', reversed: false },
        122: { type: 'switchScene', sceneId: 2 }
      }
    };

    const level1 = {
      ...blankScene(),
      id: 2,
      name: 'Level 1 - Forest Gate',
      bgColor: '#dbeafe',
      width: 1100,
      height: 600,
      worldWidth: 1100,
      worldHeight: 600,
      viewportWidth: 800,
      viewportHeight: 600,
      objects: [
        sprite(1, 'player', 70, 485, 42, 54, '#2563eb', {
          physicsEnabled: true,
          physics: { gravity: 0.82, friction: 0.88, bounciness: 0, maxSpeed: 18 },
          layer: 8
        }),
        sprite(2, 'platform', 0, 548, 1100, 52, '#14532d', { static: true, layer: 1 }),
        sprite(3, 'platform', 160, 448, 150, 24, '#15803d', { static: true, layer: 2 }),
        sprite(4, 'platform', 390, 370, 150, 24, '#16a34a', { static: true, layer: 2 }),
        sprite(5, 'platform', 625, 455, 140, 24, '#22c55e', { static: true, layer: 2 }),
        sprite(6, 'coin', 430, 330, 28, 28, '#facc15', { static: true, layer: 5 }),
        sprite(7, 'key', 686, 410, 32, 22, '#f59e0b', { static: true, layer: 5 }),
        sprite(8, 'door', 1010, 488, 48, 60, '#7c3aed', { static: true, layer: 4 }),
        sprite(9, 'enemy', 565, 510, 38, 38, '#dc2626', {
          physicsEnabled: true,
          physics: { gravity: 0.82, friction: 0.92, bounciness: 0, maxSpeed: 5 },
          layer: 6
        }),
        text(10, 'scoreText', 18, 16, 'Score: 0', { width: 160, height: 28, textColor: '#0f172a' }),
        text(11, 'healthText', 18, 46, 'Health: 3', { width: 160, height: 28, textColor: '#0f172a' }),
        text(12, 'statusText', 18, 560, 'Find the key, then reach the purple door.', { width: 440, height: 28, fontSize: 16, textColor: '#0f172a' })
      ],
      // One event per row, with a blank row between events: vertical
      // adjacency used to leak actions across events (jumping also collected
      // the coin, touching the enemy also collected the key, and holding the
      // key drifted the player right forever). The jump and door events keep
      // the documented and-pattern (a condition above / beside the and block).
      gridData: {
        1: { type: 'gameStart', reversed: false },
        2: { type: 'setVariable', varName: 'score', operation: 'set', value: 0 },
        3: { type: 'setVariable', varName: 'health', operation: 'set', value: 3 },
        4: { type: 'setVariable', varName: 'hasKey', operation: 'set', value: 0 },
        5: { type: 'followCamera', targetObject: 'player', offsetX: 0, offsetY: 0 },
        61: { type: 'always' },
        62: { type: 'clampToScreen', targetObject: 'player', bounce: false, targetMode: 'first' },
        182: { type: 'keyPressed', inputCondition: 'keyJustPressed', key: 'Space', trigger: 'pressed', reversed: false },
        241: { type: 'onFloor', targetObject: 'player', platformObject: 'platform', countTouchingEdges: true, reversed: false },
        242: { type: 'and', logic: 'and' },
        243: { type: 'setVelocity', targetObject: 'player', velX: 'player.velX', velY: -15 },
        361: { type: 'collision', object1: 'player', object2: 'coin', countTouchingEdges: true, reversed: false },
        362: { type: 'setVariable', varName: 'score', operation: 'add', value: 10 },
        363: { type: 'destroyObject', targetObject: 'coin' },
        364: { type: 'playSound', frequency: 740, duration: 0.12, waveform: 'triangle', volume: 0.25 },
        481: { type: 'collision', object1: 'player', object2: 'key', countTouchingEdges: true, reversed: false },
        482: { type: 'setVariable', varName: 'hasKey', operation: 'set', value: 1 },
        483: { type: 'destroyObject', targetObject: 'key' },
        484: { type: 'setText', targetObject: 'statusText', value: 'Key collected. The door is open.', useVariable: false, varName: '' },
        601: { type: 'collision', object1: 'player', object2: 'enemy', countTouchingEdges: true, reversed: false },
        602: { type: 'triggerOnce', reversed: false },
        603: { type: 'setVariable', varName: 'health', operation: 'subtract', value: 1 },
        604: { type: 'setPosition', targetObject: 'player', x: 70, y: 485 },
        605: { type: 'screenShake', strength: 8, duration: 0.22, cooldown: 0.35 },
        721: { type: 'always' },
        722: { type: 'forceToward', targetObject: 'enemy', sourceObject: 'player', speed: 0.18, mode: 'add', targetMode: 'all' },
        841: { type: 'keyPressed', inputCondition: 'keyPressed', key: 'ArrowLeft', trigger: 'down', reversed: false },
        842: { type: 'applyForce', targetObject: 'player', forceX: -1.1, forceY: 0, mode: 'add' },
        961: { type: 'keyPressed', inputCondition: 'keyPressed', key: 'ArrowRight', trigger: 'down', reversed: false },
        962: { type: 'applyForce', targetObject: 'player', forceX: 1.1, forceY: 0, mode: 'add' },
        1082: { type: 'getVariable', varName: 'hasKey', operator: '>=', compareValue: 1, reversed: false },
        1141: { type: 'collision', object1: 'player', object2: 'door', countTouchingEdges: true, reversed: false },
        1142: { type: 'and', logic: 'and' },
        1143: { type: 'switchScene', sceneId: 3 },
        1261: { type: 'always' },
        1262: { type: 'setText', targetObject: 'scoreText', useVariable: true, varName: 'score', prefix: 'Score: ', suffix: '' },
        1381: { type: 'always' },
        1382: { type: 'setText', targetObject: 'healthText', useVariable: true, varName: 'health', prefix: 'Health: ', suffix: '' },
        1501: { type: 'getVariable', varName: 'health', operator: '<=', compareValue: 0, reversed: false },
        1502: { type: 'restartScene' }
      }
    };

    const level2 = {
      ...blankScene(),
      id: 3,
      name: 'Level 2 - Sky Ruins',
      bgColor: '#e0f2fe',
      width: 980,
      height: 600,
      worldWidth: 980,
      worldHeight: 600,
      viewportWidth: 800,
      viewportHeight: 600,
      objects: [
        sprite(1, 'player', 64, 480, 42, 54, '#2563eb', {
          physicsEnabled: true,
          physics: { gravity: 0.78, friction: 0.88, bounciness: 0, maxSpeed: 18 },
          layer: 8
        }),
        sprite(2, 'platform', 0, 548, 980, 52, '#334155', { static: true, layer: 1 }),
        sprite(3, 'platform', 150, 452, 120, 22, '#475569', { static: true, layer: 2 }),
        sprite(4, 'platform', 340, 380, 120, 22, '#64748b', { static: true, layer: 2 }),
        sprite(5, 'platform', 540, 305, 120, 22, '#94a3b8', { static: true, layer: 2 }),
        sprite(6, 'coin', 570, 265, 28, 28, '#facc15', { static: true, layer: 5 }),
        sprite(7, 'gem', 890, 498, 38, 38, '#14b8a6', { static: true, layer: 5 }),
        sprite(8, 'enemy', 388, 342, 36, 36, '#be123c', {
          physicsEnabled: true,
          physics: { gravity: 0.78, friction: 0.95, bounciness: 0.2, maxSpeed: 6 },
          layer: 6
        }),
        text(9, 'scoreText', 18, 16, 'Score: 0', { width: 160, height: 28, textColor: '#0f172a' }),
        text(10, 'statusText', 18, 560, 'Reach the crystal at the end.', { width: 440, height: 28, fontSize: 16, textColor: '#0f172a' })
      ],
      // One event per row, with a blank row between events: vertical
      // adjacency used to leak actions across events (jumping also pushed
      // the player left, and touching the enemy also collected the coin,
      // added the gem score, and switched to the win screen). The jump event
      // keeps the documented and-pattern (Space above the and block).
      gridData: {
        1: { type: 'gameStart', reversed: false },
        2: { type: 'setText', targetObject: 'statusText', value: 'Level 2: reach the crystal.', useVariable: false, varName: '' },
        3: { type: 'followCamera', targetObject: 'player', offsetX: 0, offsetY: 0 },
        61: { type: 'always' },
        62: { type: 'clampToScreen', targetObject: 'player', bounce: false, targetMode: 'first' },
        182: { type: 'keyPressed', inputCondition: 'keyJustPressed', key: 'Space', trigger: 'pressed', reversed: false },
        241: { type: 'onFloor', targetObject: 'player', platformObject: 'platform', countTouchingEdges: true, reversed: false },
        242: { type: 'and', logic: 'and' },
        243: { type: 'setVelocity', targetObject: 'player', velX: 'player.velX', velY: -15 },
        361: { type: 'keyPressed', inputCondition: 'keyPressed', key: 'ArrowLeft', trigger: 'down', reversed: false },
        362: { type: 'applyForce', targetObject: 'player', forceX: -1.1, forceY: 0, mode: 'add' },
        481: { type: 'keyPressed', inputCondition: 'keyPressed', key: 'ArrowRight', trigger: 'down', reversed: false },
        482: { type: 'applyForce', targetObject: 'player', forceX: 1.1, forceY: 0, mode: 'add' },
        601: { type: 'always' },
        602: { type: 'forceToward', targetObject: 'enemy', sourceObject: 'player', speed: 0.25, mode: 'add', targetMode: 'all' },
        721: { type: 'collision', object1: 'player', object2: 'coin', countTouchingEdges: true, reversed: false },
        722: { type: 'setVariable', varName: 'score', operation: 'add', value: 25 },
        723: { type: 'destroyObject', targetObject: 'coin' },
        724: { type: 'screenShake', strength: 4, duration: 0.12, cooldown: 0.3 },
        841: { type: 'collision', object1: 'player', object2: 'enemy', countTouchingEdges: true, reversed: false },
        842: { type: 'triggerOnce', reversed: false },
        843: { type: 'setPosition', targetObject: 'player', x: 64, y: 480 },
        844: { type: 'screenShake', strength: 8, duration: 0.2, cooldown: 0.35 },
        961: { type: 'collision', object1: 'player', object2: 'gem', countTouchingEdges: true, reversed: false },
        962: { type: 'setVariable', varName: 'score', operation: 'add', value: 100 },
        963: { type: 'switchScene', sceneId: 4 },
        1081: { type: 'always' },
        1082: { type: 'setText', targetObject: 'scoreText', useVariable: true, varName: 'score', prefix: 'Score: ', suffix: '' }
      }
    };

    const win = {
      ...blankScene(),
      id: 4,
      name: 'You Win',
      bgColor: '#07131f',
      objects: [
        sprite(1, 'restartButton', 266, 350, 268, 62, '#10b981', { static: true, layer: 3 }),
        text(2, 'winTitle', 190, 160, 'You found the crystal!', { width: 440, height: 54, fontSize: 38, textColor: '#f8fafc', textAlign: 'center', uiPinned: false }),
        text(3, 'finalText', 252, 235, 'Now remix the levels, blocks, and objects.', { width: 320, height: 34, fontSize: 18, textColor: '#bfdbfe', textAlign: 'center', uiPinned: false, bold: false }),
        text(4, 'restartText', 326, 367, 'Main Menu', { width: 150, height: 30, fontSize: 24, textColor: '#ffffff', textAlign: 'center', uiPinned: false })
      ],
      gridData: {
        61: { type: 'objectClicked', targetObject: 'restartButton', button: 'left', reversed: false },
        62: { type: 'switchScene', sceneId: 1 },
        121: { type: 'keyPressed', inputCondition: 'keyJustPressed', key: 'Enter', trigger: 'pressed', reversed: false },
        122: { type: 'switchScene', sceneId: 1 }
      }
    };

    return [menu, level1, level2, win];
  }

  // ============================================================================
  // F5 flagship template: HYDRA QUEST. A complete multi-level platformer
  // built ENTIRELY with engine blocks - no hand-written game code. Dogfoods
  // every engine pillar: UI widgets (buttons, panels, anchors, HUD layer),
  // player save slots (level-unlock progression), pause/resume (pause menu),
  // sprite animations (frames generated below as tiny procedural PNGs, so the
  // template ships zero binary assets), named timers (music loop), tweens of
  // the heart (screen shake), camera follow, and the tone synth (SFX).
  //
  // Scenes: 1 Main Menu, 2 How to Play, 3 Level Select, 4-6 Levels 1-3,
  // 7 You Win, 8 Game Over. Save slot: 'HydraQuest'.
  // ============================================================================

  // --- tiny procedural PNG writer (pure JS: stored deflate, no compression) ---
  const HQ_CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function hqCrc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = HQ_CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function hqAdler32(bytes) {
    let a = 1, b = 0;
    for (let i = 0; i < bytes.length; i++) { a = (a + bytes[i]) % 65521; b = (b + a) % 65521; }
    return ((b << 16) | a) >>> 0;
  }
  function hqBase64(bytes) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i], b1 = i + 1 < bytes.length ? bytes[i + 1] : 0, b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
      const n = (b0 << 16) | (b1 << 8) | b2;
      out += chars[(n >>> 18) & 63] + chars[(n >>> 12) & 63]
        + (i + 1 < bytes.length ? chars[(n >>> 6) & 63] : '=')
        + (i + 2 < bytes.length ? chars[n & 63] : '=');
    }
    return out;
  }
  function hqPngDataUrl(w, h, rgba) {
    const stride = w * 4;
    const raw = new Uint8Array(h * (stride + 1));
    for (let y = 0; y < h; y++) {
      raw[y * (stride + 1)] = 0; // filter type 0 (none)
      raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
    }
    const nBlocks = Math.max(1, Math.ceil(raw.length / 65535));
    const z = new Uint8Array(2 + nBlocks * 5 + raw.length + 4);
    let p = 0;
    z[p++] = 0x78; z[p++] = 0x01; // zlib header
    let off = 0;
    for (let b = 0; b < nBlocks; b++) {
      const len = Math.min(65535, raw.length - off);
      z[p++] = b === nBlocks - 1 ? 1 : 0;
      z[p++] = len & 0xFF; z[p++] = (len >>> 8) & 0xFF;
      z[p++] = (~len) & 0xFF; z[p++] = ((~len) >>> 8) & 0xFF;
      z.set(raw.subarray(off, off + len), p); p += len; off += len;
    }
    const ad = hqAdler32(raw);
    z[p++] = (ad >>> 24) & 0xFF; z[p++] = (ad >>> 16) & 0xFF; z[p++] = (ad >>> 8) & 0xFF; z[p++] = ad & 0xFF;
    function chunk(type, data) {
      const c = new Uint8Array(12 + data.length);
      const dv = new DataView(c.buffer);
      dv.setUint32(0, data.length);
      for (let i = 0; i < 4; i++) c[4 + i] = type.charCodeAt(i);
      c.set(data, 8);
      dv.setUint32(8 + data.length, hqCrc32(c.subarray(4, 8 + data.length)));
      return c;
    }
    const ihdr = new Uint8Array(13);
    const idv = new DataView(ihdr.buffer);
    idv.setUint32(0, w); idv.setUint32(4, h);
    ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
    const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr), chunk('IDAT', z.subarray(0, p)), chunk('IEND', new Uint8Array(0))];
    const total = parts.reduce((n, c) => n + c.length, 0);
    const png = new Uint8Array(total);
    let q = 0;
    parts.forEach(c => { png.set(c, q); q += c.length; });
    return 'data:image/png;base64,' + hqBase64(png);
  }
  function hqCanvas(w, h) { return { w, h, px: new Uint8Array(w * h * 4) }; }
  function hqHex(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >>> 16) & 255, (n >>> 8) & 255, n & 255, 255];
  }
  function hqRect(cv, x, y, w, h, color) {
    const c = hqHex(color);
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      if (i < 0 || j < 0 || i >= cv.w || j >= cv.h) continue;
      const o = (j * cv.w + i) * 4;
      cv.px[o] = c[0]; cv.px[o + 1] = c[1]; cv.px[o + 2] = c[2]; cv.px[o + 3] = c[3];
    }
  }
  function hqHeroFrame(pose) {
    const cv = hqCanvas(16, 16);
    const skin = '#fcd9a0', suit = '#2563eb', dark = '#1e3a8a', ink = '#111827';
    hqRect(cv, 5, 1, 6, 5, skin);
    hqRect(cv, 6, 3, 1, 1, ink); hqRect(cv, 9, 3, 1, 1, ink);
    hqRect(cv, 5, 6, 6, 5, suit);
    if (pose === 'jump') {
      hqRect(cv, 4, 4, 1, 2, skin); hqRect(cv, 11, 4, 1, 2, skin);
      hqRect(cv, 5, 11, 2, 2, dark); hqRect(cv, 9, 11, 2, 2, dark);
    } else {
      hqRect(cv, 4, 6, 1, 3, skin); hqRect(cv, 11, 6, 1, 3, skin);
      if (pose === 'run1') { hqRect(cv, 5, 11, 2, 4, dark); hqRect(cv, 9, 11, 2, 2, dark); }
      else if (pose === 'run2') { hqRect(cv, 5, 11, 2, 2, dark); hqRect(cv, 9, 11, 2, 4, dark); }
      else { hqRect(cv, 5, 11, 2, 4, dark); hqRect(cv, 9, 11, 2, 4, dark); }
    }
    return hqPngDataUrl(16, 16, cv.px);
  }
  function hqCoinFrame(step) {
    const cv = hqCanvas(12, 12);
    const w = [8, 5, 2, 5][step % 4];
    const x = Math.floor((12 - w) / 2);
    hqRect(cv, x, 2, w, 8, '#facc15');
    hqRect(cv, x, 2, w, 1, '#b45309'); hqRect(cv, x, 9, w, 1, '#b45309');
    if (w > 4) hqRect(cv, x + 1, 4, w - 2, 4, '#fde68a');
    return hqPngDataUrl(12, 12, cv.px);
  }
  function hqEnemyFrame(step) {
    const cv = hqCanvas(16, 16);
    hqRect(cv, 3, 4, 10, 8, '#dc2626');
    hqRect(cv, 3, 4, 10, 2, '#991b1b');
    hqRect(cv, 5, 6, 2, 2, '#ffffff'); hqRect(cv, 9, 6, 2, 2, '#ffffff');
    hqRect(cv, 5, 7, 1, 1, '#111827'); hqRect(cv, 9, 7, 1, 1, '#111827');
    hqRect(cv, 4, 5, 2, 1, '#111827'); hqRect(cv, 10, 5, 2, 1, '#111827');
    if (step % 2 === 0) { hqRect(cv, 4, 12, 3, 3, '#7f1d1d'); hqRect(cv, 9, 12, 3, 2, '#7f1d1d'); }
    else { hqRect(cv, 4, 12, 3, 2, '#7f1d1d'); hqRect(cv, 9, 12, 3, 3, '#7f1d1d'); }
    return hqPngDataUrl(16, 16, cv.px);
  }
  function flagshipAssets() {
    const assets = {};
    const add = (id, name, dataUrl, w, h) => { assets[id] = { name, dataUrl, kind: 'image', width: w, height: h }; };
    add('hq-hero-run1', 'Hero run 1', hqHeroFrame('run1'), 16, 16);
    add('hq-hero-run2', 'Hero run 2', hqHeroFrame('run2'), 16, 16);
    add('hq-hero-jump', 'Hero jump', hqHeroFrame('jump'), 16, 16);
    for (let s = 0; s < 4; s++) add('hq-coin-' + s, 'Coin spin ' + (s + 1), hqCoinFrame(s), 12, 12);
    for (let s = 0; s < 2; s++) add('hq-enemy-' + s, 'Enemy walk ' + (s + 1), hqEnemyFrame(s), 16, 16);
    return assets;
  }

  // --- flagship object helpers ---
  function hqButton(id, name, x, y, w, h, label, overrides = {}) {
    return text(id, name, x, y, label, {
      width: w, height: h, fontSize: 22, textColor: '#ffffff', textAlign: 'center',
      archetype: 'button', color: '#2563eb', cornerRadius: 10,
      components: [{ id: 'cmp_' + name, type: 'Button', enabled: true, props: { label, action: '' } }],
      anchor: 'none', hud: false,
      ...overrides
    });
  }
  function hqLabel(id, name, x, y, w, h, value, overrides = {}) {
    return text(id, name, x, y, value, { width: w, height: h, fontSize: 20, textAlign: 'center', ...overrides });
  }
  function hqPanel(id, name, w, h, overrides = {}) {
    return {
      id, name, kind: 'panel', archetype: 'panel',
      posX: 0, posY: 0, width: w, height: h,
      velX: 0, velY: 0, rotation: 0,
      color: '#0f172a', assetId: null, assetFit: 'cover', opacity: 0.96,
      hitboxOffsetX: 0, hitboxOffsetY: 0, hitboxWidth: w, hitboxHeight: h,
      static: true, physicsEnabled: false, layer: 60, showLabel: false, uiPinned: true,
      anchor: 'center', hud: true, cornerRadius: 16, borderWidth: 0,
      physics: { ...basePhysics }, text: null, fontSize: null, fontFamily: null,
      textColor: null, textAlign: null, bold: false, italic: false,
      ...overrides
    };
  }
  function hqPlayer(id, x, y) {
    return sprite(id, 'player', x, y, 44, 56, '#2563eb', {
      physicsEnabled: true,
      physics: { gravity: 0.8, friction: 0.88, bounciness: 0, maxSpeed: 32 },
      layer: 8,
      assetId: 'hq-hero-run1',
      animations: [
        { name: 'Run', mode: 'loop', fps: 8, frames: ['hq-hero-run1', 'hq-hero-run2'] },
        { name: 'Jump', mode: 'once', fps: 10, frames: ['hq-hero-jump'] }
      ],
      startAnimation: 'Run'
    });
  }
  function hqCoin(id, name, x, y) {
    return sprite(id, name, x, y, 28, 28, '#facc15', {
      static: true, layer: 5,
      assetId: 'hq-coin-0',
      animations: [{ name: 'Spin', mode: 'loop', fps: 6, frames: ['hq-coin-0', 'hq-coin-1', 'hq-coin-2', 'hq-coin-3'] }],
      startAnimation: 'Spin'
    });
  }
  function hqEnemy(id, name, x, y) {
    return sprite(id, name, x, y, 40, 40, '#dc2626', {
      physicsEnabled: true,
      physics: { gravity: 0.8, friction: 0.9, bounciness: 0, maxSpeed: 6 },
      layer: 6,
      assetId: 'hq-enemy-0',
      animations: [{ name: 'Walk', mode: 'loop', fps: 6, frames: ['hq-enemy-0', 'hq-enemy-1'] }],
      startAnimation: 'Walk'
    });
  }
  function hqPlatform(id, x, y, w, h, color) {
    return sprite(id, 'platform', x, y, w, h, color, { static: true, layer: 2 });
  }
  function hqClickSound() {
    return { type: 'playSound', frequency: 660, duration: 0.06, waveform: 'triangle', volume: 0.18 };
  }

  // --- flagship level grid: movement, jump, patrols, pickups, hazards,
  // --- HUD, music, pause menu, goal/unlock, game over. All blocks.
  function hqLevelGrid(cfg) {
    const g = {};
    let r = 1;
    const put = (row, col, block) => { g[(row - 1) * 60 + (col - 1)] = block; };
    put(r, 1, { type: 'gameStart' });
    put(r, 2, { type: 'setVariable', varName: 'lives', operation: 'set', value: 3 });
    put(r, 3, { type: 'setVariable', varName: 'retryScene', operation: 'set', value: cfg.sceneId });
    put(r, 4, { type: 'followCamera', targetObject: 'player', offsetX: 0, offsetY: 0 });
    put(r, 5, { type: 'showHide', targetObject: 'pausePanel', action: 'hide' });
    put(r, 6, { type: 'showHide', targetObject: 'pauseTitle', action: 'hide' });
    put(r, 7, { type: 'showHide', targetObject: 'resumeBtn', action: 'hide' });
    put(r, 8, { type: 'showHide', targetObject: 'restartBtn', action: 'hide' });
    put(r, 9, { type: 'showHide', targetObject: 'quitBtn', action: 'hide' });
    // Patrol direction init: each enemy patrols between minX/maxX on
    // a direction variable (1 = right, -1 = left); the bounds rows
    // below flip it and the per-frame drive rows apply it. The
    // variable (not a one-time velocity) is what makes the patrol
    // start: friction decays a single setVelocity to zero within a
    // second, and the bounds rows only fire at the bounds, so an
    // enemy spawning with velX 0 never moved at all. All ordinary
    // blocks a user would place by hand.
    cfg.enemies.forEach((e, i) => {
      put(r, 10 + i, { type: 'setVariable', varName: e.name + 'Dir', operation: 'set', value: 1 });
    });
    r++;
    put(r, 1, { type: 'always' });
    put(r, 2, { type: 'clampToScreen', targetObject: 'player', bounce: false });
    put(r, 3, { type: 'setText', targetObject: 'scoreText', useVariable: true, varName: 'score', prefix: 'Score: ', suffix: '' });
    put(r, 4, { type: 'setText', targetObject: 'livesText', useVariable: true, varName: 'lives', prefix: 'Lives: ', suffix: '' });
    r++;
    put(r, 1, { type: 'keyPressed', key: 'ArrowLeft' });
    put(r, 2, { type: 'applyForce', targetObject: 'player', forceX: -0.7, forceY: 0, mode: 'add' });
    r++;
    put(r, 1, { type: 'keyPressed', key: 'ArrowRight' });
    put(r, 2, { type: 'applyForce', targetObject: 'player', forceX: 0.7, forceY: 0, mode: 'add' });
    r++;
    put(r, 1, { type: 'keyJustPressed', key: 'Space' });
    put(r, 2, { type: 'and', logic: 'and' });
    put(r, 3, { type: 'onFloor', targetObject: 'player', platformObject: 'platform', countTouchingEdges: true });
    r++;
    put(r, 2, { type: 'setVelocity', targetObject: 'player', velX: 'player.velX', velY: -36 });
    r++;
    put(r, 1, { type: 'keyJustPressed', key: 'Space' });
    put(r, 2, { type: 'playSound', frequency: 523, duration: 0.08, waveform: 'triangle', volume: 0.2 });
    put(r, 3, { type: 'playAnimation', targetObject: 'player', animation: 'Jump' });
    r++;
    put(r, 1, { type: 'animationFinished', targetObject: 'player', animation: 'Jump' });
    put(r, 2, { type: 'playAnimation', targetObject: 'player', animation: 'Run' });
    r++;
    cfg.enemies.forEach(e => {
      put(r, 1, { type: 'positionCheck', targetObject: e.name, property: 'posX', operator: '<=', value: e.minX });
      put(r, 2, { type: 'setVariable', varName: e.name + 'Dir', operation: 'set', value: 1 });
      r++;
      put(r, 1, { type: 'positionCheck', targetObject: e.name, property: 'posX', operator: '>=', value: e.maxX });
      put(r, 2, { type: 'setVariable', varName: e.name + 'Dir', operation: 'set', value: -1 });
      r++;
    });
    // Per-frame patrol drive: the direction variable is applied every
    // frame, because friction decays any velocity set once to zero
    // within a second. Same always-row idiom the chaser templates use
    // (always + forceToward), with a direction variable instead.
    cfg.enemies.forEach(e => {
      put(r, 1, { type: 'always' });
      put(r, 2, { type: 'setVelocity', targetObject: e.name, velX: '2.2 * ' + e.name + 'Dir', velY: e.name + '.velY' });
      r++;
    });
    cfg.coins.forEach((c, i) => {
      const name = 'coin' + (i + 1);
      put(r, 1, { type: 'collision', object1: 'player', object2: name, countTouchingEdges: true });
      put(r, 2, { type: 'setVariable', varName: 'score', operation: 'add', value: 1 });
      put(r, 3, { type: 'destroyObject', targetObject: name });
      put(r, 4, { type: 'playSound', frequency: 880, duration: 0.1, waveform: 'triangle', volume: 0.22 });
      r++;
    });
    cfg.enemies.forEach(e => {
      put(r, 1, { type: 'collision', object1: 'player', object2: e.name, countTouchingEdges: true });
      put(r, 2, { type: 'setVariable', varName: 'lives', operation: 'subtract', value: 1 });
      put(r, 3, { type: 'setPosition', targetObject: 'player', x: cfg.spawnX, y: cfg.spawnY });
      put(r, 4, { type: 'setVelocity', targetObject: 'player', velX: 0, velY: 0 });
      put(r, 5, { type: 'screenShake', strength: 6, duration: 0.18, cooldown: 0.3 });
      put(r, 6, { type: 'playSound', frequency: 180, duration: 0.2, waveform: 'square', volume: 0.22 });
      r++;
    });
    if (cfg.pit) {
      put(r, 1, { type: 'positionCheck', targetObject: 'player', property: 'posY', operator: '>', value: 640 });
      put(r, 2, { type: 'setVariable', varName: 'lives', operation: 'subtract', value: 1 });
      put(r, 3, { type: 'setPosition', targetObject: 'player', x: cfg.spawnX, y: cfg.spawnY });
      put(r, 4, { type: 'setVelocity', targetObject: 'player', velX: 0, velY: 0 });
      put(r, 5, { type: 'playSound', frequency: 180, duration: 0.2, waveform: 'square', volume: 0.22 });
      r++;
    }
    put(r, 1, { type: 'getVariable', varName: 'lives', operator: '<=', compareValue: 0 });
    put(r, 2, { type: 'switchScene', sceneId: 8 });
    r++;
    put(r, 1, { type: 'collision', object1: 'player', object2: 'goal', countTouchingEdges: true });
    put(r, 2, { type: 'playSound', frequency: 1046, duration: 0.25, waveform: 'triangle', volume: 0.25 });
    put(r, 3, { type: 'setVariable', varName: 'unlockedLevel', operation: 'set', value: 'Math.max(unlockedLevel, ' + cfg.unlockValue + ')' });
    put(r, 4, { type: 'saveGame', slotName: 'HydraQuest' });
    put(r, 5, { type: 'switchScene', sceneId: cfg.nextSceneId });
    r++;
    put(r, 1, { type: 'onTimer', timerName: 'musicA', interval: 0.5 });
    put(r, 2, { type: 'playSound', frequency: 196, duration: 0.18, waveform: 'triangle', volume: 0.06 });
    r++;
    put(r, 1, { type: 'onTimer', timerName: 'musicB', interval: 1.0 });
    put(r, 2, { type: 'playSound', frequency: 294, duration: 0.3, waveform: 'sine', volume: 0.045 });
    r++;
    put(r, 1, { type: 'onTimer', timerName: 'musicC', interval: 2.0 });
    put(r, 2, { type: 'playSound', frequency: 392, duration: 0.4, waveform: 'sine', volume: 0.04 });
    r++;
    put(r, 1, { type: 'objectClicked', targetObject: 'pauseBtn', button: 'left' });
    put(r, 2, { type: 'pauseGame' });
    put(r, 3, hqClickSound());
    r++;
    put(r, 1, { type: 'keyJustPressed', key: 'KeyP' });
    put(r, 2, { type: 'togglePause' });
    r++;
    put(r, 1, { type: 'gamePaused' });
    put(r, 2, { type: 'showHide', targetObject: 'pausePanel', action: 'show' });
    put(r, 3, { type: 'showHide', targetObject: 'pauseTitle', action: 'show' });
    put(r, 4, { type: 'showHide', targetObject: 'resumeBtn', action: 'show' });
    put(r, 5, { type: 'showHide', targetObject: 'restartBtn', action: 'show' });
    put(r, 6, { type: 'showHide', targetObject: 'quitBtn', action: 'show' });
    r++;
    put(r, 1, { type: 'gamePaused', reversed: true });
    put(r, 2, { type: 'showHide', targetObject: 'pausePanel', action: 'hide' });
    put(r, 3, { type: 'showHide', targetObject: 'pauseTitle', action: 'hide' });
    put(r, 4, { type: 'showHide', targetObject: 'resumeBtn', action: 'hide' });
    put(r, 5, { type: 'showHide', targetObject: 'restartBtn', action: 'hide' });
    put(r, 6, { type: 'showHide', targetObject: 'quitBtn', action: 'hide' });
    r++;
    put(r, 1, { type: 'objectClicked', targetObject: 'resumeBtn', button: 'left' });
    put(r, 2, { type: 'resumeGame' });
    put(r, 3, hqClickSound());
    r++;
    put(r, 1, { type: 'objectClicked', targetObject: 'restartBtn', button: 'left' });
    put(r, 2, { type: 'resumeGame' });
    put(r, 3, { type: 'restartScene' });
    r++;
    put(r, 1, { type: 'objectClicked', targetObject: 'quitBtn', button: 'left' });
    put(r, 2, { type: 'switchScene', sceneId: 3 });
    r++;
    return g;
  }

  function flagshipLevelScene(cfg) {
    const objs = [
      hqPlayer(1, cfg.spawnX, cfg.spawnY),
      ...cfg.platforms.map(p => hqPlatform(0, p[0], p[1], p[2], p[3], p[4])),
      ...cfg.coins.map((c, i) => hqCoin(0, 'coin' + (i + 1), c[0], c[1])),
      ...cfg.enemies.map(e => hqEnemy(0, e.name, e.x, e.y)),
      sprite(0, 'goal', cfg.goalX, cfg.goalY, 50, 60, '#f59e0b', { static: true, layer: 4 }),
      hqLabel(0, 'scoreText', 18, 14, 190, 30, 'Score: 0', { fontSize: 20, textAlign: 'left', textColor: cfg.uiText, anchor: 'top-left', hud: true }),
      hqLabel(0, 'livesText', 18, 48, 190, 30, 'Lives: 3', { fontSize: 20, textAlign: 'left', textColor: cfg.uiText, anchor: 'top-left', hud: true }),
      hqLabel(0, 'levelLabel', 0, 0, 400, 30, cfg.name, { fontSize: 20, textColor: cfg.uiText, anchor: 'top-center', hud: true, posX: 0, posY: 14 }),
      hqButton(0, 'pauseBtn', 0, 0, 54, 40, 'II', { fontSize: 18, anchor: 'top-right', hud: true, posX: -70, posY: 14 }),
      hqPanel(0, 'pausePanel', 360, 300, { layer: 15 }),
      hqLabel(0, 'pauseTitle', 0, 0, 200, 40, 'Paused', { fontSize: 32, textColor: '#f8fafc', anchor: 'center', hud: true, posX: 0, posY: -112 }),
      hqButton(0, 'resumeBtn', 0, 0, 220, 48, 'Resume', { anchor: 'center', hud: true, posX: 0, posY: -40 }),
      hqButton(0, 'restartBtn', 0, 0, 220, 48, 'Restart Level', { anchor: 'center', hud: true, posX: 0, posY: 24 }),
      hqButton(0, 'quitBtn', 0, 0, 220, 48, 'Quit to Menu', { anchor: 'center', hud: true, posX: 0, posY: 88, color: '#475569' })
    ];
    return {
      ...blankScene(),
      id: cfg.sceneId,
      name: cfg.name,
      bgColor: cfg.bgColor,
      width: cfg.worldWidth,
      height: 600,
      worldWidth: cfg.worldWidth,
      worldHeight: 600,
      viewportWidth: 800,
      viewportHeight: 600,
      objects: objs,
      gridData: hqLevelGrid(cfg)
    };
  }

  function flagshipMenuScene() {
    const g = {};
    let r = 1;
    const put = (row, col, block) => { g[(row - 1) * 60 + (col - 1)] = block; };
    put(r, 1, { type: 'gameStart' });
    put(r, 2, { type: 'setVariable', varName: 'unlockedLevel', operation: 'set', value: 1 });
    put(r, 3, { type: 'setVariable', varName: 'bestScore', operation: 'set', value: 0 });
    put(r, 4, { type: 'loadGame', slotName: 'HydraQuest' });
    put(r, 5, { type: 'setVariable', varName: 'score', operation: 'set', value: 0 });
    put(r, 6, { type: 'setText', targetObject: 'bestText', useVariable: true, varName: 'bestScore', prefix: 'Best score: ', suffix: '' });
    r++;
    put(r, 1, { type: 'objectClicked', targetObject: 'playBtn', button: 'left' });
    put(r, 2, hqClickSound());
    put(r, 3, { type: 'switchScene', sceneId: 3 });
    r++;
    put(r, 1, { type: 'objectClicked', targetObject: 'howBtn', button: 'left' });
    put(r, 2, hqClickSound());
    put(r, 3, { type: 'switchScene', sceneId: 2 });
    r++;
    put(r, 1, { type: 'objectClicked', targetObject: 'resetBtn', button: 'left' });
    put(r, 2, { type: 'deleteSaveSlot', slotName: 'HydraQuest' });
    put(r, 3, { type: 'setVariable', varName: 'unlockedLevel', operation: 'set', value: 1 });
    put(r, 4, { type: 'setVariable', varName: 'bestScore', operation: 'set', value: 0 });
    put(r, 5, { type: 'setText', targetObject: 'bestText', useVariable: true, varName: 'bestScore', prefix: 'Best score: ', suffix: '' });
    r++;
    put(r, 1, { type: 'onTimer', timerName: 'musicA', interval: 0.5 });
    put(r, 2, { type: 'playSound', frequency: 196, duration: 0.18, waveform: 'triangle', volume: 0.06 });
    r++;
    put(r, 1, { type: 'onTimer', timerName: 'musicB', interval: 1.0 });
    put(r, 2, { type: 'playSound', frequency: 294, duration: 0.3, waveform: 'sine', volume: 0.045 });
    return {
      ...blankScene(),
      id: 1,
      name: 'Main Menu',
      bgColor: '#0b1526',
      objects: [
        hqLabel(1, 'titleText', 150, 110, 500, 64, 'HYDRA QUEST', { fontSize: 56, textColor: '#f8fafc' }),
        hqLabel(2, 'subText', 150, 184, 500, 30, 'A complete platformer built with HydraScript blocks', { fontSize: 18, textColor: '#93c5fd', bold: false }),
        hqCoin(4, 'decoCoin1', 620, 150),
        hqCoin(5, 'decoCoin2', 664, 210),
        hqCoin(6, 'decoCoin3', 620, 270),
        hqButton(7, 'playBtn', 300, 300, 200, 56, 'Play'),
        hqButton(8, 'howBtn', 300, 372, 200, 56, 'How to Play', { color: '#475569' }),
        hqLabel(9, 'bestText', 300, 448, 200, 30, 'Best score: 0', { fontSize: 18, textColor: '#e2e8f0', bold: false }),
        hqButton(10, 'resetBtn', 330, 500, 140, 36, 'Reset progress', { fontSize: 14, color: '#64748b' })
      ],
      gridData: g
    };
  }

  function flagshipHowToScene() {
    const lines = [
      'Move with the Left and Right arrow keys.',
      'Jump with Space, but only while standing on a platform.',
      'Collect coins for score. Avoid the red enemies: each hit costs a life.',
      'Reach the golden goal to unlock the next level.',
      'Pause anytime with P or the II button. Progress saves automatically.'
    ];
    const objects = [
      hqLabel(1, 'howTitle', 150, 90, 500, 54, 'How to Play', { fontSize: 40, textColor: '#0f172a' }),
      ...lines.map((line, i) => hqLabel(0, 'howLine' + (i + 1), 120, 180 + i * 44, 560, 36, line, { fontSize: 18, textAlign: 'left', textColor: '#334155', bold: false })),
      hqButton(0, 'backBtn', 300, 440, 200, 56, 'Back')
    ];
    return {
      ...blankScene(),
      id: 2,
      name: 'How to Play',
      bgColor: '#f1f5f9',
      objects,
      gridData: {
        0: { type: 'objectClicked', targetObject: 'backBtn', button: 'left' },
        1: hqClickSound(),
        2: { type: 'switchScene', sceneId: 1 }
      }
    };
  }

  function flagshipLevelSelectScene() {
    const g = {};
    let r = 1;
    const put = (row, col, block) => { g[(row - 1) * 60 + (col - 1)] = block; };
    put(r, 1, { type: 'gameStart' });
    put(r, 2, { type: 'setVariable', varName: 'unlockedLevel', operation: 'set', value: 1 });
    put(r, 3, { type: 'loadGame', slotName: 'HydraQuest' });
    put(r, 4, { type: 'setVariable', varName: 'score', operation: 'set', value: 0 });
    r++;
    put(r, 1, { type: 'getVariable', varName: 'unlockedLevel', operator: '>=', compareValue: 2 });
    put(r, 2, { type: 'showHide', targetObject: 'l2Btn', action: 'show' });
    put(r, 3, { type: 'showHide', targetObject: 'l2Lock', action: 'hide' });
    r++;
    put(r, 1, { type: 'getVariable', varName: 'unlockedLevel', operator: '>=', compareValue: 2, reversed: true });
    put(r, 2, { type: 'showHide', targetObject: 'l2Btn', action: 'hide' });
    put(r, 3, { type: 'showHide', targetObject: 'l2Lock', action: 'show' });
    r++;
    put(r, 1, { type: 'getVariable', varName: 'unlockedLevel', operator: '>=', compareValue: 3 });
    put(r, 2, { type: 'showHide', targetObject: 'l3Btn', action: 'show' });
    put(r, 3, { type: 'showHide', targetObject: 'l3Lock', action: 'hide' });
    r++;
    put(r, 1, { type: 'getVariable', varName: 'unlockedLevel', operator: '>=', compareValue: 3, reversed: true });
    put(r, 2, { type: 'showHide', targetObject: 'l3Btn', action: 'hide' });
    put(r, 3, { type: 'showHide', targetObject: 'l3Lock', action: 'show' });
    r++;
    put(r, 1, { type: 'objectClicked', targetObject: 'l1Btn', button: 'left' });
    put(r, 2, hqClickSound());
    put(r, 3, { type: 'switchScene', sceneId: 4 });
    r++;
    put(r, 1, { type: 'objectClicked', targetObject: 'l2Btn', button: 'left' });
    put(r, 2, hqClickSound());
    put(r, 3, { type: 'switchScene', sceneId: 5 });
    r++;
    put(r, 1, { type: 'objectClicked', targetObject: 'l3Btn', button: 'left' });
    put(r, 2, hqClickSound());
    put(r, 3, { type: 'switchScene', sceneId: 6 });
    r++;
    put(r, 1, { type: 'objectClicked', targetObject: 'backBtn', button: 'left' });
    put(r, 2, { type: 'switchScene', sceneId: 1 });
    return {
      ...blankScene(),
      id: 3,
      name: 'Level Select',
      bgColor: '#0b1526',
      objects: [
        hqLabel(1, 'selTitle', 150, 90, 500, 54, 'Choose a Level', { fontSize: 40, textColor: '#f8fafc' }),
        hqButton(2, 'l1Btn', 250, 200, 300, 56, 'Level 1: Green Hills'),
        hqButton(3, 'l2Btn', 250, 280, 300, 56, 'Level 2: Sky Bridges'),
        hqLabel(4, 'l2Lock', 250, 280, 300, 56, 'Locked: finish Level 1', { fontSize: 18, textColor: '#64748b', bold: false }),
        hqButton(5, 'l3Btn', 250, 360, 300, 56, 'Level 3: Ember Caverns'),
        hqLabel(6, 'l3Lock', 250, 360, 300, 56, 'Locked: finish Level 2', { fontSize: 18, textColor: '#64748b', bold: false }),
        hqButton(7, 'backBtn', 250, 450, 300, 56, 'Back', { color: '#475569' })
      ],
      gridData: g
    };
  }

  function flagshipWinScene() {
    const g = {};
    let r = 1;
    const put = (row, col, block) => { g[(row - 1) * 60 + (col - 1)] = block; };
    put(r, 1, { type: 'gameStart' });
    put(r, 2, { type: 'setVariable', varName: 'bestScore', operation: 'set', value: 'Math.max(score, bestScore)' });
    put(r, 3, { type: 'saveGame', slotName: 'HydraQuest' });
    put(r, 4, { type: 'setText', targetObject: 'finalScoreText', useVariable: true, varName: 'score', prefix: 'Final score: ', suffix: '' });
    put(r, 5, { type: 'setText', targetObject: 'bestScoreText', useVariable: true, varName: 'bestScore', prefix: 'Best: ', suffix: '' });
    put(r, 6, { type: 'playSound', frequency: 1046, duration: 0.3, waveform: 'triangle', volume: 0.25 });
    r++;
    put(r, 1, { type: 'objectClicked', targetObject: 'againBtn', button: 'left' });
    put(r, 2, hqClickSound());
    put(r, 3, { type: 'switchScene', sceneId: 3 });
    r++;
    put(r, 1, { type: 'objectClicked', targetObject: 'menuBtn', button: 'left' });
    put(r, 2, { type: 'switchScene', sceneId: 1 });
    return {
      ...blankScene(),
      id: 7,
      name: 'You Win',
      bgColor: '#07131f',
      objects: [
        hqLabel(1, 'winTitle', 150, 110, 500, 60, 'You Win!', { fontSize: 48, textColor: '#f8fafc' }),
        hqLabel(2, 'finalScoreText', 250, 200, 300, 36, 'Final score: 0', { fontSize: 24, textColor: '#bfdbfe' }),
        hqLabel(3, 'bestScoreText', 250, 244, 300, 36, 'Best: 0', { fontSize: 24, textColor: '#bfdbfe' }),
        hqPlayer(4, 368, 420),
        hqCoin(5, 'winCoin1', 250, 420),
        hqCoin(6, 'winCoin2', 522, 420),
        hqButton(7, 'againBtn', 300, 330, 200, 56, 'Play Again'),
        hqButton(8, 'menuBtn', 300, 404, 200, 56, 'Main Menu', { color: '#475569' })
      ],
      gridData: g
    };
  }

  function flagshipGameOverScene() {
    const g = {};
    let r = 1;
    const put = (row, col, block) => { g[(row - 1) * 60 + (col - 1)] = block; };
    put(r, 1, { type: 'gameStart' });
    put(r, 2, { type: 'setText', targetObject: 'finalText', useVariable: true, varName: 'score', prefix: 'Score: ', suffix: '' });
    r++;
    [4, 5, 6].forEach(sceneId => {
      put(r, 1, { type: 'objectClicked', targetObject: 'retryBtn', button: 'left' });
      put(r, 2, { type: 'and', logic: 'and' });
      put(r, 3, { type: 'getVariable', varName: 'retryScene', operator: '==', compareValue: sceneId });
      r++;
      put(r, 2, { type: 'switchScene', sceneId });
      r++;
    });
    put(r, 1, { type: 'objectClicked', targetObject: 'menuBtn', button: 'left' });
    put(r, 2, { type: 'switchScene', sceneId: 1 });
    return {
      ...blankScene(),
      id: 8,
      name: 'Game Over',
      bgColor: '#1f2937',
      objects: [
        hqLabel(1, 'overTitle', 150, 130, 500, 60, 'Game Over', { fontSize: 48, textColor: '#f8fafc' }),
        hqLabel(2, 'finalText', 250, 214, 300, 36, 'Score: 0', { fontSize: 24, textColor: '#fca5a5' }),
        hqButton(3, 'retryBtn', 300, 290, 200, 56, 'Retry Level'),
        hqButton(4, 'menuBtn', 300, 364, 200, 56, 'Main Menu', { color: '#475569' })
      ],
      gridData: g
    };
  }

  function flagshipScenes() {
    return [
      flagshipMenuScene(),
      flagshipHowToScene(),
      flagshipLevelSelectScene(),
      flagshipLevelScene({
        sceneId: 4, levelNum: 1, nextSceneId: 5, unlockValue: 2,
        name: 'Level 1 - Green Hills', worldWidth: 1600, bgColor: '#d9f2e3', uiText: '#0f172a',
        spawnX: 80, spawnY: 480, pit: false,
        platforms: [
          [0, 548, 1600, 52, '#3f6212'],
          [220, 450, 180, 24, '#65a30d'], [520, 280, 170, 24, '#65a30d'],
          [830, 450, 170, 24, '#65a30d'], [1100, 280, 160, 24, '#65a30d']
        ],
        // The ground coin sits on open ground before the first patrol
        // band (enemy1 starts at x 700): a ground coin inside a patrol
        // band is patrol-phase luck, because the jump over the enemy
        // can carry the player over it and the playtest coin check then
        // fails about one run in three (cycle 77: 43/44, score 0 -> 0).
        coins: [[600, 238], [905, 408], [1170, 238], [450, 500]],
        enemies: [
          { name: 'enemy1', x: 760, y: 505, minX: 700, maxX: 820 },
          { name: 'enemy2', x: 1370, y: 505, minX: 1300, maxX: 1450 }
        ],
        goalX: 1520, goalY: 488
      }),
      flagshipLevelScene({
        sceneId: 5, levelNum: 2, nextSceneId: 6, unlockValue: 3,
        name: 'Level 2 - Sky Bridges', worldWidth: 1800, bgColor: '#e0f2fe', uiText: '#0f172a',
        spawnX: 80, spawnY: 480, pit: true,
        platforms: [
          [0, 548, 700, 52, '#475569'], [1100, 548, 700, 52, '#475569'],
          [150, 460, 150, 22, '#64748b'], [420, 380, 140, 22, '#64748b'],
          [700, 300, 140, 22, '#64748b'], [980, 380, 150, 22, '#64748b'],
          [1260, 300, 140, 22, '#64748b'], [1520, 420, 150, 22, '#64748b']
        ],
        coins: [[480, 338], [760, 258], [1040, 338], [1320, 258], [1600, 378]],
        enemies: [
          { name: 'enemy1', x: 350, y: 505, minX: 280, maxX: 460 },
          { name: 'enemy2', x: 1350, y: 505, minX: 1280, maxX: 1480 }
        ],
        goalX: 1700, goalY: 488
      }),
      flagshipLevelScene({
        sceneId: 6, levelNum: 3, nextSceneId: 7, unlockValue: 3,
        name: 'Level 3 - Ember Caverns', worldWidth: 2000, bgColor: '#1f2937', uiText: '#f9fafb',
        spawnX: 80, spawnY: 480, pit: false,
        platforms: [
          [0, 548, 2000, 52, '#4b5563'],
          [200, 460, 140, 22, '#9ca3af'], [480, 370, 130, 22, '#9ca3af'],
          [740, 460, 140, 22, '#9ca3af'], [1010, 350, 130, 22, '#9ca3af'],
          [1280, 440, 140, 22, '#9ca3af'], [1560, 330, 130, 22, '#9ca3af']
        ],
        coins: [[540, 328], [1070, 308], [1340, 398], [1620, 288], [300, 418], [1850, 500]],
        enemies: [
          { name: 'enemy1', x: 620, y: 505, minX: 540, maxX: 700 },
          { name: 'enemy2', x: 1150, y: 505, minX: 1080, maxX: 1230 },
          { name: 'enemy3', x: 1700, y: 505, minX: 1640, maxX: 1800 }
        ],
        goalX: 1900, goalY: 488
      }),
      flagshipWinScene(),
      flagshipGameOverScene()
    ];
  }

  function scene3dScene() {
    const camera = sprite(1, 'MainCamera3D', 90, 90, 54, 54, '#38bdf8', {
      archetype: 'camera3d',
      collision: { enabled: false },
      components: [
        { id: 'cmp_cam3d', type: 'Camera3D', enabled: true, props: { fov: 70, near: 0.1, far: 1000 } },
        { id: 'cmp_transform_cam', type: 'Transform', enabled: true, props: { x: 0, y: 2, z: 8, width: 54, height: 54, rotation: 0 } }
      ]
    });
    const light = sprite(2, 'SunLight', 170, 90, 54, 54, '#fde047', {
      archetype: 'light3d',
      collision: { enabled: false },
      components: [
        { id: 'cmp_light', type: 'Light', enabled: true, props: { lightType: 'directional', color: '#ffffff', intensity: 1.2 } }
      ]
    });
    const cube = sprite(3, 'CrateMesh', 350, 250, 90, 90, '#f97316', {
      archetype: 'mesh',
      components: [
        { id: 'cmp_mesh', type: 'MeshRenderer', enabled: true, props: { primitive: 'box', material: '#f97316', assetId: '' } },
        { id: 'cmp_col3d', type: 'Collider3D', enabled: true, props: { shape: 'box', trigger: false } }
      ]
    });
    const hud = text(4, 'hudText', 18, 18, '3D scene foundation', { width: 260, textColor: '#0f172a' });
    return {
      ...blankScene(),
      name: '3D Scene',
      bgColor: '#e0f2fe',
      objects: [camera, light, cube, hud],
      gridData: {
        1: { type: 'gameStart' },
        2: { type: 'setText', targetObject: 'hudText', value: '3D scene ready. Add meshes, cameras, lights, and triggers.', useVariable: false }
      }
    };
  }

  function fpsScene() {
    const player = sprite(1, 'FPSPlayer', 120, 400, 48, 72, '#2563eb', {
      archetype: 'fpsPlayer',
      physicsEnabled: true,
      physics: { gravity: 0, friction: 0.85, bounciness: 0, maxSpeed: 16 },
      components: [
        { id: 'cmp_fps', type: 'FirstPersonController', enabled: true, props: { moveSpeed: 6, lookSensitivity: 0.18, jumpSpeed: 5 } },
        { id: 'cmp_cam', type: 'Camera3D', enabled: true, props: { fov: 75, near: 0.1, far: 800 } },
        { id: 'cmp_weapon', type: 'RaycastWeapon', enabled: true, props: { range: 80, damage: 1, cooldown: 0.18 } }
      ]
    });
    const target = sprite(2, 'Target', 580, 320, 80, 80, '#dc2626', {
      static: true,
      archetype: 'target',
      components: [
        { id: 'cmp_trigger', type: 'TriggerZone', enabled: true, props: { once: false, eventName: 'targetHit' } },
        { id: 'cmp_mesh_target', type: 'MeshRenderer', enabled: true, props: { primitive: 'box', material: '#dc2626', assetId: '' } }
      ]
    });
    const hud = text(3, 'hudText', 18, 18, 'FPS Prototype - click target', { width: 360, textColor: '#0f172a' });
    return {
      ...blankScene(),
      name: 'FPS Prototype',
      bgColor: '#e2e8f0',
      objects: [player, target, hud],
      gridData: {
        1: { type: 'gameStart' },
        2: { type: 'setVariable', varName: 'hits', operation: 'set', value: 0 },
        61: { type: 'objectClicked', targetObject: 'Target', button: 'left', reversed: false },
        62: { type: 'setVariable', varName: 'hits', operation: 'add', value: 1 },
        63: { type: 'setText', targetObject: 'hudText', useVariable: true, varName: 'hits', prefix: 'Target hits: ', suffix: '' },
        64: { type: 'screenShake', strength: 4, duration: 0.12, cooldown: 0.2 }
      }
    };
  }

  function retroFpsScene() {
    return {
      id: 1,
      name: 'Neon Reactor FPS',
      objects: [
        text(1, 'titleText', 80, 80, 'Neon Reactor FPS', { width: 520, height: 54, fontSize: 38, textColor: '#e0e7ff', uiPinned: false }),
        text(2, 'hintText', 84, 150, 'Export playable HTML: objects named Drone, ReactorCore, AmmoBox, Medkit become enemies and pickups.', { width: 620, height: 34, fontSize: 20, textColor: '#bfdbfe', uiPinned: false, bold: false }),
        sprite(3, 'PreviewPlayer', 110, 230, 52, 52, '#38bdf8', {
          components: [
            { id: 'cmp_fps', type: 'FirstPersonController', enabled: true, props: { moveSpeed: 6, lookSensitivity: 0.18, jumpSpeed: 5 } },
            { id: 'cmp_weapon', type: 'RaycastWeapon', enabled: true, props: { damage: 1, range: 10, fireRate: 6, ammo: 24 } }
          ]
        }),
        sprite(4, 'Drone', 260, 232, 48, 48, '#ef4444', {
          components: [{ id: 'cmp_drone', type: 'TriggerZone', enabled: true, props: { radius: 1.5, onEnter: 'damagePlayer' } }]
        }),
        sprite(5, 'ReactorCore', 410, 236, 38, 38, '#a78bfa')
      ],
      bgColor: '#111827',
      bgAssetId: null,
      width: 800,
      height: 600,
      worldWidth: 800,
      worldHeight: 600,
      viewportWidth: 800,
      viewportHeight: 600,
      gridData: {
        0: { type: 'gameStart' },
        1: { type: 'setText', targetObject: 'hintText', mode: 'value', value: 'Export playable HTML: Drone/ReactorCore/AmmoBox/Medkit objects become enemies and pickups in the arena.' }
      },
      logicGrids: { main: {} },
      eventSheets: []
    };
  }

  function makeVariantScene(templateId) {
    const scene = templateId === 'towerdefense' ? topDownScene()
      : templateId === 'roguelike' ? topDownScene()
      : templateId === 'puzzle' ? platformerScene()
      : templateId === 'racer' ? physicsScene()
      : templateId === 'rpg' ? collectorScene()
      : topDownScene();
    const names = {
      towerdefense: ['Tower Defense', 'Build pads, wave timers, base health, and enemy lanes.'],
      roguelike: ['Dungeon Roguelike', 'Rooms, pickups, enemy pursuit, hazards, and locked exits.'],
      puzzle: ['Puzzle Platformer', 'Switches, crates, keys, checkpoints, and door logic.'],
      racer: ['Top-Down Racer', 'Vehicle friction, checkpoints, laps, boost, and obstacles.'],
      rpg: ['Dialogue RPG', 'NPC interaction, quest state, pickups, and scene transitions.'],
      survival: ['Survival Arena', 'Waves, health pickups, chase enemies, score, and escalation.']
    };
    const [name, caption] = names[templateId] || names.survival;
    scene.name = name;
    scene.objects = scene.objects || [];
    scene.objects.push(text(9000, 'templateLabel', 28, 24, name, { width: 360, height: 34, fontSize: 26, textColor: '#f8fafc', uiPinned: false }));
    scene.objects.push(text(9001, 'templateNotes', 28, 60, caption, { width: 620, height: 28, fontSize: 16, textColor: '#cbd5e1', uiPinned: false, bold: false }));
    scene.bgColor = templateId === 'puzzle' ? '#1e293b' : templateId === 'racer' ? '#0f172a' : '#111827';
    return scene;
  }

  function getTemplateScene(templateId) {
    if (templateId === 'tutorial') return tutorialScene();
    if (templateId === 'variable-inspector') return variableInspectorScene();
    if (templateId === 'webapp') return webappScene();
    if (templateId === 'platformer') return platformerScene();
    if (templateId === 'topdown') return topDownScene();
    if (templateId === 'collector') return collectorScene();
    if (templateId === 'shooter') return shooterScene();
    if (templateId === 'physics') return physicsScene();
    if (templateId === 'scene3d') return scene3dScene();
    if (templateId === 'fps') return fpsScene();
    if (templateId === 'arenafps') return retroFpsScene();
    if (['towerdefense', 'roguelike', 'puzzle', 'racer', 'rpg', 'survival'].includes(templateId)) return makeVariantScene(templateId);
    return blankScene();
  }

  function getTemplateScenes(templateId) {
    if (templateId === 'flagship') return flagshipScenes();
    if (templateId === 'fullgame') return fullGameScenes();
    if (templateId === 'variables-demo') return variablesDemoScenes();
    return [getTemplateScene(templateId)];
  }

  // P2 item 16/13: the core is an injected (or global) dependency, never a
  // bare `window` read — in a browser globalThis IS window, in a node vm
  // sandbox it is the context global, in plain node it is `global`. The id
  // factory is optional: it is passed through to the core, which mints an
  // id itself when none is given (cycle 53), so a caller that does not care
  // about ids can omit it entirely.
  function createProject(templateId, projectName, idFactory, core) {
    const templateScenes = getTemplateScenes(templateId);
    // Object ids must be unique across the whole project, not just per scene:
    // templates number each scene's objects from 1. Blocks reference objects
    // by name, so renumbering is safe.
    let nextObjectId = 1;
    templateScenes.forEach(scene => {
      (scene.objects || []).forEach(obj => { obj.id = nextObjectId++; });
    });
    const hasSceneLogic = Object.keys(templateScenes[0]?.gridData || {}).length > 0;
    const maxSceneId = Math.max(0, ...templateScenes.map(scene => Number(scene.id) || 0));
    const U = core || (typeof globalThis !== 'undefined' ? globalThis.HydraUniversal : undefined);
    if (!U || typeof U.createProject !== 'function') {
      throw new Error('HydraStarterTemplates.createProject needs HydraUniversal loaded first: load hydra-universal.js before starter-templates.js, or pass the core as the 4th argument.');
    }
    // P2 item 13/10: the project record comes from the core factory
    // (already normalized) — templates keep no second literal. The
    // template flags ride along as extra fields.
    return U.createProject({
      name: projectName || 'Untitled Project',
      scenes: templateScenes,
      currentSceneId: templateScenes[0]?.id || 1,
      nextSceneId: maxSceneId + 1,
      activeScriptScope: hasSceneLogic ? templateScenes[0].id : 'global',
      assets: templateId === 'flagship' ? flagshipAssets() : {},
      ...(typeof idFactory === 'function' ? { idFactory } : {}),
      ...(templateId === 'tutorial' ? { tutorial: 'first-game' } : {}),
      // P5-1 slice b: the demo's starting values live in the
      // definition list, not in blocks — the game starts with a
      // global score of 0, scene coins of 0 in each level, and the
      // goblin's hp at 30 (one value per goblin name, shared across
      // the two levels).
      ...(templateId === 'variables-demo' ? {
        scopedVariables: [
          { name: 'score', scope: 'global', type: 'number', value: 0 },
          { name: 'coins', scope: 'scene', type: 'number', value: 0 },
          { name: 'hp', scope: 'object', objectName: 'goblin', type: 'number', value: 30 }
        ]
      } : {}),
      // P5-9: the inspector's starting values, same rule — a global
      // score of 0, scene coins of 0, the goblin's hp at 30, and a
      // global text name 'Ky'.
      ...(templateId === 'variable-inspector' ? {
        scopedVariables: [
          { name: 'score', scope: 'global', type: 'number', value: 0 },
          { name: 'coins', scope: 'scene', type: 'number', value: 0 },
          { name: 'hp', scope: 'object', objectName: 'goblin', type: 'number', value: 30 },
          { name: 'playerName', scope: 'global', type: 'text', value: 'Ky' }
        ]
      } : {}),
      ...(templateId === 'arenafps' ? { playableRuntime: 'retroFps', fpsConfig: { theme: 'neon-reactor', difficulty: 'normal' } } : {})
    });
  }

  // P2 item 16/13: the module loads in plain node (no window) and in the
  // browser, following the hydra-flow.js pattern.
  const api = { templates, createProject, buildScene: getTemplateScene, buildScenes: getTemplateScenes };
  if (typeof window !== 'undefined') window.HydraStarterTemplates = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
