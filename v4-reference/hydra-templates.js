// ============================================================
// HydraScript v4 — Starter Templates
// ============================================================

(function (global) {
  'use strict';

  const { createProject, createScene, createObject, normalizeObject, normalizeScene, normalizeProject } = global.HydraCore;

  const TEMPLATES = {
    blank: {
      name: 'Blank Canvas',
      description: 'Clean scene, no starter logic.',
      icon: 'crop_square',
      build: () => createProject('Blank Project'),
    },

    webapp: {
      name: 'Webapp',
      description: 'Dashboard screen, button, form input, and data events.',
      icon: 'web',
      build: () => {
        const p = createProject('Web App');
        const scene = p.scenes[0];
        scene.name = 'Main Screen';
        scene.bgColor = '#f3f4f6';
        scene.worldWidth = 1200;
        scene.worldHeight = 800;
        scene.viewportWidth = 1200;
        scene.viewportHeight = 800;

        // Title
        const title = createObject('text', { name: 'Title', text: 'My Dashboard', posX: 100, posY: 60, fontSize: 32, textColor: '#1f2937', bold: true });
        scene.objects.push(title);

        // Button
        const btn = createObject('button', { name: 'SubmitBtn', text: 'Submit', posX: 100, posY: 300, width: 160, height: 48, color: '#3B82F6' });
        scene.objects.push(btn);

        // Input field
        const input = createObject('sprite', { name: 'InputField', posX: 100, posY: 220, width: 300, height: 48, color: '#ffffff' });
        scene.objects.push(input);

        // Data display
        const display = createObject('text', { name: 'Display', text: 'Count: 0', posX: 100, posY: 400, fontSize: 24, textColor: '#374151' });
        scene.objects.push(display);

        return p;
      },
    },

    fullgame: {
      name: 'Full Game',
      description: 'Menu, game scene, player, enemies, collectibles, HUD, and win screen.',
      icon: 'auto_awesome',
      build: () => {
        const p = createProject('Adventure Game');
        p.scenes = [];

        // Menu scene
        const menu = createScene('Menu', { bgColor: '#1a1a2e' });
        const menuTitle = createObject('text', { name: 'Title', text: 'MY GAME', posX: 300, posY: 200, fontSize: 48, textColor: '#f59e0b', bold: true });
        menu.objects.push(menuTitle);
        const playBtn = createObject('button', { name: 'PlayBtn', text: 'Play', posX: 325, posY: 350, width: 150, height: 50, color: '#10b981' });
        menu.objects.push(playBtn);
        p.scenes.push(menu);

        // Game scene
        const game = createScene('Level 1', { bgColor: '#0f172a' });

        // Player
        const player = createObject('sprite', { name: 'Player', posX: 100, posY: 400, width: 40, height: 40, color: '#3b82f6', physicsEnabled: true });
        player.physics = { gravity: 0, friction: 0.85, bounciness: 0.1, maxSpeed: 8 };
        game.objects.push(player);

        // Ground
        const ground = createObject('sprite', { name: 'Ground', posX: 0, posY: 560, width: 800, height: 40, color: '#334155', static: true });
        game.objects.push(ground);

        // Collectible
        const coin = createObject('sprite', { name: 'Coin', posX: 600, posY: 400, width: 24, height: 24, color: '#f59e0b' });
        game.objects.push(coin);

        // HUD
        const score = createObject('text', { name: 'ScoreText', text: 'Score: 0', posX: 20, posY: 20, fontSize: 24, textColor: '#ffffff', bold: true });
        game.objects.push(score);

        // Logic: move player with arrows
        game.gridData = {};
        game.gridData[0] = { type: 'always', kind: 'condition', _idx: 0, blockType: 'always-condition' };
        game.gridData[1] = { type: 'keyDown', key: 'ArrowRight', kind: 'condition', _idx: 1, blockType: 'key-down' };
        game.gridData[2] = { type: 'setVelocity', targetObject: 'Player', velX: '5', velY: '0', mode: 'set', kind: 'action', _idx: 2, blockType: 'set-velocity' };
        game.gridData[3] = { type: 'always', kind: 'condition', _idx: 3, blockType: 'always-condition' };
        game.gridData[4] = { type: 'keyDown', key: 'ArrowLeft', kind: 'condition', _idx: 4, blockType: 'key-down' };
        game.gridData[5] = { type: 'setVelocity', targetObject: 'Player', velX: '-5', velY: '0', mode: 'set', kind: 'action', _idx: 5, blockType: 'set-velocity' };
        game.gridData[6] = { type: 'always', kind: 'condition', _idx: 6, blockType: 'always-condition' };
        game.gridData[7] = { type: 'keyDown', key: 'ArrowUp', kind: 'condition', _idx: 7, blockType: 'key-down' };
        game.gridData[8] = { type: 'setVelocity', targetObject: 'Player', velX: '0', velY: '-5', mode: 'set', kind: 'action', _idx: 8, blockType: 'set-velocity' };
        game.gridData[9] = { type: 'always', kind: 'condition', _idx: 9, blockType: 'always-condition' };
        game.gridData[10] = { type: 'keyDown', key: 'ArrowDown', kind: 'condition', _idx: 10, blockType: 'key-down' };
        game.gridData[11] = { type: 'setVelocity', targetObject: 'Player', velX: '0', velY: '5', mode: 'set', kind: 'action', _idx: 11, blockType: 'set-velocity' };
        // Collect coin
        game.gridData[12] = { type: 'always', kind: 'condition', _idx: 12, blockType: 'always-condition' };
        game.gridData[13] = { type: 'overlap', object1: 'Player', object2: 'Coin', kind: 'condition', _idx: 13, blockType: 'overlap-condition' };
        game.gridData[14] = { type: 'destroyObject', targetObject: 'Coin', kind: 'action', _idx: 14, blockType: 'destroy-object' };
        game.gridData[15] = { type: 'setVariable', name: 'score', value: 'score + 1', mode: 'set', scope: 'global', kind: 'action', _idx: 15, blockType: 'set-variable' };
        game.gridData[16] = { type: 'setText', targetObject: 'ScoreText', text: '"Score: " + score', kind: 'action', _idx: 16, blockType: 'set-text' };

        p.scenes.push(game);
        p.currentSceneId = menu.id;

        // Win scene
        const win = createScene('Win Screen', { bgColor: '#1a1a2e' });
        const winText = createObject('text', { name: 'WinText', text: 'YOU WIN!', posX: 300, posY: 250, fontSize: 48, textColor: '#10b981', bold: true });
        win.objects.push(winText);
        p.scenes.push(win);

        normalizeProject(p);
        return p;
      },
    },

    platformer: {
      name: 'Platformer',
      description: 'Gravity, jump, ground contact, side-scrolling movement, and camera follow.',
      icon: 'sports_esports',
      build: () => {
        const p = createProject('Platformer');
        const scene = p.scenes[0];
        scene.name = 'Level 1';
        scene.bgColor = '#1e1e3f';
        scene.worldWidth = 1600;
        scene.worldHeight = 600;

        // Player
        const player = createObject('sprite', { name: 'Player', posX: 100, posY: 300, width: 32, height: 48, color: '#3b82f6', physicsEnabled: true });
        player.physics = { gravity: 0.5, friction: 0.85, bounciness: 0, maxSpeed: 10 };
        scene.objects.push(player);

        // Ground platforms
        const ground = createObject('sprite', { name: 'Ground', posX: 0, posY: 550, width: 800, height: 50, color: '#475569', static: true });
        scene.objects.push(ground);
        const plat1 = createObject('sprite', { name: 'Platform1', posX: 400, posY: 400, width: 200, height: 20, color: '#64748b', static: true });
        scene.objects.push(plat1);
        const plat2 = createObject('sprite', { name: 'Platform2', posX: 700, posY: 300, width: 200, height: 20, color: '#64748b', static: true });
        scene.objects.push(plat2);

        // Logic
        scene.gridData = {};
        // Move right
        scene.gridData[0] = { type: 'keyDown', key: 'ArrowRight', kind: 'condition', _idx: 0, blockType: 'key-down' };
        scene.gridData[1] = { type: 'setVelocity', targetObject: 'Player', velX: '5', velY: '', mode: 'set', kind: 'action', _idx: 1, blockType: 'set-velocity' };
        // Move left
        scene.gridData[2] = { type: 'keyDown', key: 'ArrowLeft', kind: 'condition', _idx: 2, blockType: 'key-down' };
        scene.gridData[3] = { type: 'setVelocity', targetObject: 'Player', velX: '-5', velY: '', mode: 'set', kind: 'action', _idx: 3, blockType: 'set-velocity' };
        // Jump
        scene.gridData[4] = { type: 'keyPressed', key: 'ArrowUp', kind: 'condition', _idx: 4, blockType: 'key-pressed' };
        scene.gridData[5] = { type: 'applyImpulse', targetObject: 'Player', impulseX: '0', impulseY: '-12', kind: 'action', _idx: 5, blockType: 'apply-impulse' };
        // Camera follow
        scene.gridData[6] = { type: 'gameStart', kind: 'condition', _idx: 6, blockType: 'game-start' };
        scene.gridData[7] = { type: 'followCamera', targetObject: 'Player', offsetX: '-400', offsetY: '-300', kind: 'action', _idx: 7, blockType: 'follow-camera' };

        normalizeProject(p);
        return p;
      },
    },

    topdown: {
      name: 'Top-Down',
      description: 'Four-directional movement with WASD and screen bounds.',
      icon: 'gamepad',
      build: () => {
        const p = createProject('Top-Down Game');
        const scene = p.scenes[0];
        scene.name = 'Map';
        scene.bgColor = '#1a2a1a';

        const player = createObject('sprite', { name: 'Player', posX: 380, posY: 280, width: 40, height: 40, color: '#10b981' });
        scene.objects.push(player);

        // Walls
        const wallT = createObject('sprite', { name: 'WallTop', posX: 0, posY: 0, width: 800, height: 20, color: '#4a5568', static: true });
        scene.objects.push(wallT);
        const wallB = createObject('sprite', { name: 'WallBot', posX: 0, posY: 580, width: 800, height: 20, color: '#4a5568', static: true });
        scene.objects.push(wallB);
        const wallL = createObject('sprite', { name: 'WallLeft', posX: 0, posY: 0, width: 20, height: 600, color: '#4a5568', static: true });
        scene.objects.push(wallL);
        const wallR = createObject('sprite', { name: 'WallRight', posX: 780, posY: 0, width: 20, height: 600, color: '#4a5568', static: true });
        scene.objects.push(wallR);

        // Movement logic
        scene.gridData = {};
        scene.gridData[0] = { type: 'keyDown', key: 'KeyW', kind: 'condition', _idx: 0, blockType: 'key-down' };
        scene.gridData[1] = { type: 'setVelocity', targetObject: 'Player', velX: '0', velY: '-4', mode: 'set', kind: 'action', _idx: 1, blockType: 'set-velocity' };
        scene.gridData[2] = { type: 'keyDown', key: 'KeyS', kind: 'condition', _idx: 2, blockType: 'key-down' };
        scene.gridData[3] = { type: 'setVelocity', targetObject: 'Player', velX: '0', velY: '4', mode: 'set', kind: 'action', _idx: 3, blockType: 'set-velocity' };
        scene.gridData[4] = { type: 'keyDown', key: 'KeyA', kind: 'condition', _idx: 4, blockType: 'key-down' };
        scene.gridData[5] = { type: 'setVelocity', targetObject: 'Player', velX: '-4', velY: '0', mode: 'set', kind: 'action', _idx: 5, blockType: 'set-velocity' };
        scene.gridData[6] = { type: 'keyDown', key: 'KeyD', kind: 'condition', _idx: 6, blockType: 'key-down' };
        scene.gridData[7] = { type: 'setVelocity', targetObject: 'Player', velX: '4', velY: '0', mode: 'set', kind: 'action', _idx: 7, blockType: 'set-velocity' };
        // Stop when no keys
        scene.gridData[8] = { type: 'always', kind: 'condition', _idx: 8, blockType: 'always-condition' };
        scene.gridData[9] = { type: 'setVariable', name: 'moving', value: '0', mode: 'set', scope: 'global', kind: 'action', _idx: 9, blockType: 'set-variable' };

        normalizeProject(p);
        return p;
      },
    },

    collector: {
      name: 'Collector',
      description: 'Player moves around collecting coins that respawn. Score counter included.',
      icon: 'star',
      build: () => {
        const p = createProject('Coin Collector');
        const scene = p.scenes[0];
        scene.name = 'Arena';
        scene.bgColor = '#1a1a3e';

        const player = createObject('sprite', { name: 'Player', posX: 380, posY: 280, width: 40, height: 40, color: '#3b82f6' });
        scene.objects.push(player);

        const coin = createObject('sprite', { name: 'Coin', posX: 200, posY: 200, width: 28, height: 28, color: '#f59e0b' });
        scene.objects.push(coin);

        const score = createObject('text', { name: 'ScoreLabel', text: 'Coins: 0', posX: 20, posY: 20, fontSize: 24, textColor: '#f59e0b', bold: true });
        scene.objects.push(score);

        // Movement + collection logic
        scene.gridData = {};
        // WASD movement
        scene.gridData[0] = { type: 'keyDown', key: 'KeyW', kind: 'condition', _idx: 0, blockType: 'key-down' };
        scene.gridData[1] = { type: 'setVelocity', targetObject: 'Player', velX: '0', velY: '-4', mode: 'set', kind: 'action', _idx: 1, blockType: 'set-velocity' };
        scene.gridData[2] = { type: 'keyDown', key: 'KeyS', kind: 'condition', _idx: 2, blockType: 'key-down' };
        scene.gridData[3] = { type: 'setVelocity', targetObject: 'Player', velX: '0', velY: '4', mode: 'set', kind: 'action', _idx: 3, blockType: 'set-velocity' };
        scene.gridData[4] = { type: 'keyDown', key: 'KeyA', kind: 'condition', _idx: 4, blockType: 'key-down' };
        scene.gridData[5] = { type: 'setVelocity', targetObject: 'Player', velX: '-4', velY: '0', mode: 'set', kind: 'action', _idx: 5, blockType: 'set-velocity' };
        scene.gridData[6] = { type: 'keyDown', key: 'KeyD', kind: 'condition', _idx: 6, blockType: 'key-down' };
        scene.gridData[7] = { type: 'setVelocity', targetObject: 'Player', velX: '4', velY: '0', mode: 'set', kind: 'action', _idx: 7, blockType: 'set-velocity' };
        // Collect coin
        scene.gridData[8] = { type: 'overlap', object1: 'Player', object2: 'Coin', kind: 'condition', _idx: 8, blockType: 'overlap-condition' };
        scene.gridData[9] = { type: 'setVariable', name: 'coins', value: 'coins + 1', mode: 'set', scope: 'global', kind: 'action', _idx: 9, blockType: 'set-variable' };
        scene.gridData[10] = { type: 'setText', targetObject: 'ScoreLabel', text: '"Coins: " + coins', kind: 'action', _idx: 10, blockType: 'set-text' };
        scene.gridData[11] = { type: 'setPosition', targetObject: 'Coin', x: 'random(50, 750)', y: 'random(50, 550)', mode: 'set', kind: 'action', _idx: 11, blockType: 'set-position' };
        scene.gridData[12] = { type: 'playSound', frequency: '660', duration: '0.1', type: 'sine', volume: '0.3', kind: 'action', _idx: 12, blockType: 'play-sound' };

        normalizeProject(p);
        return p;
      },
    },
  };

  function getTemplateList() {
    return Object.entries(TEMPLATES).map(([id, t]) => ({ id, name: t.name, description: t.description, icon: t.icon }));
  }

  function buildTemplate(id) {
    const t = TEMPLATES[id];
    return t ? t.build() : TEMPLATES.blank.build();
  }

  global.HydraTemplates = { TEMPLATES, getTemplateList, buildTemplate };
})(window);
