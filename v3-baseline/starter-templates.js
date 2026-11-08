// Serverless starter projects for the home screen.
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
    return {
      id, name, kind: 'text',
      posX: x, posY: y, width: 180, height: 34,
      velX: 0, velY: 0, rotation: 0,
      color: '#ffffff', assetId: null,
      assetFit: 'cover',
      opacity: 1,
      hitboxOffsetX: 0,
      hitboxOffsetY: 0,
      hitboxWidth: 180,
      hitboxHeight: 34,
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
        241: { type: 'setText', targetObject: 'scoreText', useVariable: true, varName: 'score' },
        301: { type: 'always' },
        302: { type: 'setText', targetObject: 'livesText', useVariable: true, varName: 'lives' },
        361: { type: 'forceToward', targetObject: 'enemy', sourceObject: 'player', speed: 0.8, mode: 'add' },
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
        841: { type: 'randomVariable', varName: 'coinX', min: 220, max: 760, round: true },
        900: { type: 'setPosition', targetObject: 'coin', x: 'coinX', y: 'coinY' },
        901: { type: 'collision', object1: 'player', object2: 'coin', countTouchingEdges: true, reversed: false },
        902: { type: 'setVariable', varName: 'score', operation: 'add', value: 1 },
        961: { type: 'randomVariable', varName: 'coinY', min: 300, max: 505, round: true },
        1021: { type: 'screenShake', strength: 5, duration: 0.18 },
        1080: { type: 'setVariable', varName: 'lives', operation: 'subtract', value: 1 },
        1081: { type: 'collision', object1: 'player', object2: 'enemy', countTouchingEdges: true, reversed: false },
        1082: { type: 'setVelocity', targetObject: 'player', velX: -8, velY: -8 },
        1141: { type: 'setPosition', targetObject: 'player', x: 80, y: 486 },
        1260: { type: 'setText', targetObject: 'hint', value: 'Goal reached. Add a Switch Scene block here.', useVariable: false, varName: '' },
        1261: { type: 'collision', object1: 'player', object2: 'goal', countTouchingEdges: true, reversed: false }
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
        121: { type: 'setText', targetObject: 'scoreText', useVariable: true, varName: 'score' },
        180: { type: 'always' },
        181: { type: 'forceToward', targetObject: 'enemy', sourceObject: 'player', speed: 0.45, mode: 'add' },
        240: { type: 'faceMovement', targetObject: 'enemy', offsetAngle: 0, minSpeed: 0.05 },
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
        721: { type: 'setPosition', targetObject: 'goal', x: 'Math.floor(Math.random() * 690) + 40', y: 'Math.floor(Math.random() * 460) + 70' },
        841: { type: 'collision', object1: 'player', object2: 'enemy', countTouchingEdges: true, reversed: false },
        840: { type: 'setVelocity', targetObject: 'enemy', velX: 0, velY: 0 },
        842: { type: 'screenShake', strength: 7, duration: 0.2 },
        901: { type: 'setPosition', targetObject: 'player', x: 376, y: 276 }
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
        121: { type: 'setText', targetObject: 'scoreText', useVariable: true, varName: 'score' },
        181: { type: 'keyPressed', key: 'ArrowRight', reversed: false },
        182: { type: 'applyForce', targetObject: 'player', forceX: 0.9, forceY: 0, mode: 'add' },
        241: { type: 'keyPressed', key: 'ArrowLeft', reversed: false },
        242: { type: 'applyForce', targetObject: 'player', forceX: -0.9, forceY: 0, mode: 'add' },
        301: { type: 'keyPressed', key: 'ArrowUp', reversed: false },
        302: { type: 'applyForce', targetObject: 'player', forceX: 0, forceY: -0.9, mode: 'add' },
        361: { type: 'keyPressed', key: 'ArrowDown', reversed: false },
        362: { type: 'applyForce', targetObject: 'player', forceX: 0, forceY: 0.9, mode: 'add' },
        481: { type: 'distanceCheck', object1: 'hazard', object2: 'player', operator: '<=', distance: 260, reversed: false },
        482: { type: 'forceToward', targetObject: 'hazard', sourceObject: 'player', speed: 0.35, mode: 'add' },
        541: { type: 'wrapScreen', targetObject: 'hazard' },
        661: { type: 'randomVariable', varName: 'coinX', min: 50, max: 720, round: true },
        720: { type: 'setPosition', targetObject: 'coin', x: 'coinX', y: 'coinY' },
        721: { type: 'collision', object1: 'player', object2: 'coin', countTouchingEdges: true, reversed: false },
        722: { type: 'setVariable', varName: 'score', operation: 'add', value: 1 },
        781: { type: 'randomVariable', varName: 'coinY', min: 70, max: 520, round: true },
        901: { type: 'collision', object1: 'player', object2: 'hazard', countTouchingEdges: true, reversed: false },
        902: { type: 'screenShake', strength: 7, duration: 0.2 },
        961: { type: 'setPosition', targetObject: 'player', x: 80, y: 80 },
        962: { type: 'setVariable', varName: 'score', operation: 'subtract', value: 3 }
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
        121: { type: 'setText', targetObject: 'scoreText', useVariable: true, varName: 'score' },
        180: { type: 'always' },
        181: { type: 'setVelocity', targetObject: 'bullet', velX: 14, velY: 0 },
        240: { type: 'forceTowardPosition', targetObject: 'enemy', targetX: -80, targetY: 'enemy.posY', speed: 2, mode: 'set' },
        301: { type: 'keyPressed', key: 'ArrowUp', reversed: false },
        302: { type: 'applyForce', targetObject: 'player', forceX: 0, forceY: -0.9, mode: 'add' },
        361: { type: 'keyPressed', key: 'ArrowDown', reversed: false },
        362: { type: 'applyForce', targetObject: 'player', forceX: 0, forceY: 0.9, mode: 'add' },
        481: { type: 'keyPressed', key: 'Space', trigger: 'pressed', reversed: false },
        482: { type: 'spawnAtObject', sourceObject: 'bullet', targetObject: 'player', offsetX: 36, offsetY: 0 },
        661: { type: 'randomVariable', varName: 'enemyY', min: 70, max: 500, round: true },
        720: { type: 'setPosition', targetObject: 'enemy', x: 720, y: 'enemyY' },
        721: { type: 'collision', object1: 'bullet', object2: 'enemy', countTouchingEdges: true, reversed: false },
        722: { type: 'setVariable', varName: 'score', operation: 'add', value: 5 },
        781: { type: 'screenShake', strength: 6, duration: 0.16 },
        901: { type: 'positionCheck', targetObject: 'enemy', property: 'posX', operator: '<=', value: -40, reversed: false },
        902: { type: 'setPosition', targetObject: 'enemy', x: 720, y: 'Math.floor(Math.random() * 430) + 70' }
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
        301: { type: 'collision', object1: 'player', object2: 'coin', countTouchingEdges: true, reversed: false },
        302: { type: 'setVariable', varName: 'score', operation: 'add', value: 10 },
        303: { type: 'destroyObject', targetObject: 'coin' },
        304: { type: 'playSound', frequency: 740, duration: 0.12, waveform: 'triangle', volume: 0.25 },
        361: { type: 'collision', object1: 'player', object2: 'key', countTouchingEdges: true, reversed: false },
        362: { type: 'setVariable', varName: 'hasKey', operation: 'set', value: 1 },
        363: { type: 'destroyObject', targetObject: 'key' },
        364: { type: 'setText', targetObject: 'statusText', value: 'Key collected. The door is open.', useVariable: false, varName: '' },
        421: { type: 'collision', object1: 'player', object2: 'enemy', countTouchingEdges: true, reversed: false },
        422: { type: 'triggerOnce', reversed: false },
        423: { type: 'setVariable', varName: 'health', operation: 'subtract', value: 1 },
        424: { type: 'setPosition', targetObject: 'player', x: 70, y: 485 },
        425: { type: 'screenShake', strength: 8, duration: 0.22, cooldown: 0.35 },
        481: { type: 'always' },
        482: { type: 'forceToward', targetObject: 'enemy', sourceObject: 'player', speed: 0.18, mode: 'add', targetMode: 'all' },
        541: { type: 'keyPressed', inputCondition: 'keyPressed', key: 'ArrowLeft', trigger: 'down', reversed: false },
        542: { type: 'applyForce', targetObject: 'player', forceX: -1.1, forceY: 0, mode: 'add' },
        601: { type: 'keyPressed', inputCondition: 'keyPressed', key: 'ArrowRight', trigger: 'down', reversed: false },
        602: { type: 'applyForce', targetObject: 'player', forceX: 1.1, forceY: 0, mode: 'add' },
        662: { type: 'getVariable', varName: 'hasKey', operator: '>=', compareValue: 1, reversed: false },
        721: { type: 'collision', object1: 'player', object2: 'door', countTouchingEdges: true, reversed: false },
        722: { type: 'and', logic: 'and' },
        723: { type: 'switchScene', sceneId: 3 },
        781: { type: 'always' },
        782: { type: 'setText', targetObject: 'scoreText', useVariable: true, varName: 'score', prefix: 'Score: ', suffix: '' },
        841: { type: 'always' },
        842: { type: 'setText', targetObject: 'healthText', useVariable: true, varName: 'health', prefix: 'Health: ', suffix: '' },
        901: { type: 'getVariable', varName: 'health', operator: '<=', compareValue: 0, reversed: false },
        902: { type: 'restartScene' }
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
      gridData: {
        1: { type: 'gameStart', reversed: false },
        2: { type: 'setText', targetObject: 'statusText', value: 'Level 2: reach the crystal.', useVariable: false, varName: '' },
        3: { type: 'followCamera', targetObject: 'player', offsetX: 0, offsetY: 0 },
        61: { type: 'always' },
        62: { type: 'clampToScreen', targetObject: 'player', bounce: false, targetMode: 'first' },
        122: { type: 'keyPressed', inputCondition: 'keyJustPressed', key: 'Space', trigger: 'pressed', reversed: false },
        181: { type: 'onFloor', targetObject: 'player', platformObject: 'platform', countTouchingEdges: true, reversed: false },
        182: { type: 'and', logic: 'and' },
        183: { type: 'setVelocity', targetObject: 'player', velX: 'player.velX', velY: -15 },
        241: { type: 'keyPressed', inputCondition: 'keyPressed', key: 'ArrowLeft', trigger: 'down', reversed: false },
        242: { type: 'applyForce', targetObject: 'player', forceX: -1.1, forceY: 0, mode: 'add' },
        301: { type: 'keyPressed', inputCondition: 'keyPressed', key: 'ArrowRight', trigger: 'down', reversed: false },
        302: { type: 'applyForce', targetObject: 'player', forceX: 1.1, forceY: 0, mode: 'add' },
        361: { type: 'always' },
        362: { type: 'forceToward', targetObject: 'enemy', sourceObject: 'player', speed: 0.25, mode: 'add', targetMode: 'all' },
        421: { type: 'collision', object1: 'player', object2: 'coin', countTouchingEdges: true, reversed: false },
        422: { type: 'setVariable', varName: 'score', operation: 'add', value: 25 },
        423: { type: 'destroyObject', targetObject: 'coin' },
        424: { type: 'screenShake', strength: 4, duration: 0.12, cooldown: 0.3 },
        481: { type: 'collision', object1: 'player', object2: 'enemy', countTouchingEdges: true, reversed: false },
        482: { type: 'triggerOnce', reversed: false },
        483: { type: 'setPosition', targetObject: 'player', x: 64, y: 480 },
        484: { type: 'screenShake', strength: 8, duration: 0.2, cooldown: 0.35 },
        541: { type: 'collision', object1: 'player', object2: 'gem', countTouchingEdges: true, reversed: false },
        542: { type: 'setVariable', varName: 'score', operation: 'add', value: 100 },
        543: { type: 'switchScene', sceneId: 4 },
        601: { type: 'always' },
        602: { type: 'setText', targetObject: 'scoreText', useVariable: true, varName: 'score', prefix: 'Score: ', suffix: '' }
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
        text(2, 'hintText', 84, 150, 'Export playable HTML to boot the full FPS arena.', { width: 620, height: 34, fontSize: 20, textColor: '#bfdbfe', uiPinned: false, bold: false }),
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
        1: { type: 'setText', targetObject: 'hintText', mode: 'value', value: 'FPS export includes enemies, pickups, weapon, HUD, minimap, and objective.' }
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
    if (templateId === 'fullgame') return fullGameScenes();
    return [getTemplateScene(templateId)];
  }

  function createProject(templateId, projectName, idFactory) {
    const templateScenes = getTemplateScenes(templateId);
    const hasSceneLogic = Object.keys(templateScenes[0]?.gridData || {}).length > 0;
    const maxSceneId = Math.max(0, ...templateScenes.map(scene => Number(scene.id) || 0));
    const project = {
      id: idFactory(),
      name: projectName || 'Untitled Project',
      dateCreated: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      eventsVersion: 1,
      globalGridData: {},
      logicGrids: { global: {} },
      eventSheets: [],
      sceneCount: templateScenes.length,
      scenes: templateScenes,
      currentSceneId: templateScenes[0]?.id || 1,
      nextSceneId: maxSceneId + 1,
      activeScriptScope: hasSceneLogic ? templateScenes[0].id : 'global',
      assets: {}
    };
    if (templateId === 'arenafps') {
      project.playableRuntime = 'retroFps';
      project.fpsConfig = { theme: 'neon-reactor', difficulty: 'normal' };
    }
    return project;
  }

  window.HydraStarterTemplates = { templates, createProject };
})();
