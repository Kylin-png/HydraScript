// Unit tests for hydra/hydra-combat.js — the shared combat
// (P4 Advanced batch 29: melee attacks & projectiles, beginner
// edition).
//
// Pure logic: per-object attack cooldowns, the melee arc, projectile
// flight and hits, the slash visual, and the per-frame refresh — plus
// the routing sets. Nothing here touches the DOM; both runtimes
// delegate to this module. Static checks at the end pin the wiring:
// catalog blocks, both runtimes' dispatch, the flow trigger mode, the
// frame phase, the scene-reset minting, and the docs.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HYDRA = path.join(__dirname, '..', 'hydra');
const REPO = path.join(__dirname, '..');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures++; console.log(`NOT OK - ${name}${detail ? ' :: ' + detail : ''}`); }
}

const sandbox = {};
sandbox.window = sandbox; // hydra-combat.js assigns to bare `window`
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-combat.js'), 'utf8'),
  sandbox, { filename: 'hydra-combat.js' });
const CB = sandbox.HydraCombat;

check('HydraCombat exposed with helpers',
  !!CB && typeof CB.createCombatState === 'function' &&
  typeof CB.normalizeDamage === 'function' &&
  typeof CB.normalizeMeleeRange === 'function' &&
  typeof CB.normalizeCooldown === 'function' &&
  typeof CB.normalizeSpeed === 'function' &&
  typeof CB.normalizeLifetime === 'function' &&
  typeof CB.directionVector === 'function' &&
  typeof CB.attackReady === 'function' &&
  typeof CB.meleeTargets === 'function' &&
  typeof CB.meleeAttack === 'function' &&
  typeof CB.shootProjectile === 'function' &&
  typeof CB.updateCombat === 'function' &&
  typeof CB.drawCombatEffects === 'function' &&
  typeof CB.isCombatAction === 'function' &&
  typeof CB.isCombatCondition === 'function');
check('factorySource is a non-empty string',
  typeof CB.factorySource === 'string' && CB.factorySource.length > 1000);

// --- normalizers ---
check('normalizeDamage is 0..10000 with a 10 default',
  CB.normalizeDamage(25) === 25 && CB.normalizeDamage() === 10 &&
  CB.normalizeDamage('40') === 40 && CB.normalizeDamage(-5) === 0 &&
  CB.normalizeDamage(99999) === 10000 && CB.normalizeDamage('oops') === 10);
check('normalizeMeleeRange is 0..2000 with a 60 default',
  CB.normalizeMeleeRange(120) === 120 && CB.normalizeMeleeRange() === 60 &&
  CB.normalizeMeleeRange('90') === 90 && CB.normalizeMeleeRange(-1) === 0 &&
  CB.normalizeMeleeRange(99999) === 2000 && CB.normalizeMeleeRange('oops') === 60);
check('normalizeCooldown is 0..60 with a 0.5 default',
  CB.normalizeCooldown(1) === 1 && CB.normalizeCooldown() === 0.5 &&
  CB.normalizeCooldown('2') === 2 && CB.normalizeCooldown(-1) === 0 &&
  CB.normalizeCooldown(999) === 60 && CB.normalizeCooldown('oops') === 0.5);
check('normalizeSpeed is 0..5000 with a 300 default',
  CB.normalizeSpeed(500) === 500 && CB.normalizeSpeed() === 300 &&
  CB.normalizeSpeed('150') === 150 && CB.normalizeSpeed(-1) === 0 &&
  CB.normalizeSpeed(99999) === 5000 && CB.normalizeSpeed('oops') === 300);
check('normalizeLifetime is 0..60 with a 2 default',
  CB.normalizeLifetime(5) === 5 && CB.normalizeLifetime() === 2 &&
  CB.normalizeLifetime('3') === 3 && CB.normalizeLifetime(-1) === 0 &&
  CB.normalizeLifetime(999) === 60 && CB.normalizeLifetime('oops') === 2);
check('hostile input degrades to safe defaults',
  CB.normalizeDamage([]) === 10 && CB.normalizeMeleeRange([]) === 60 &&
  CB.normalizeCooldown([]) === 0.5 && CB.normalizeSpeed([]) === 300 &&
  CB.normalizeLifetime([]) === 2 && CB.normalizeDamage(true) === 10 &&
  CB.normalizeMeleeRange({}) === 60);
check('directionVector reads left/right/up/down and defaults anything else to right',
  JSON.stringify(CB.directionVector('left')) === JSON.stringify({ x: -1, y: 0 }) &&
  JSON.stringify(CB.directionVector('right')) === JSON.stringify({ x: 1, y: 0 }) &&
  JSON.stringify(CB.directionVector('up')) === JSON.stringify({ x: 0, y: -1 }) &&
  JSON.stringify(CB.directionVector('down')) === JSON.stringify({ x: 0, y: 1 }) &&
  JSON.stringify(CB.directionVector('diagonal')) === JSON.stringify({ x: 1, y: 0 }) &&
  JSON.stringify(CB.directionVector(null)) === JSON.stringify({ x: 1, y: 0 }));

// --- fixtures ---
function objAt(id, name, x, y, w, h) {
  return { id: id, name: name, kind: 'sprite', posX: x, posY: y, width: w || 40, height: h || 40, velX: 0, velY: 0 };
}
function hooksFor(list, over) {
  const hits = [];
  const h = {
    objects: list,
    hitbox: (o) => ({ x: o.posX, y: o.posY, w: o.width, h: o.height }),
    isCollision: (o) => o.kind !== 'text' && o.solid !== false,
    damage: (t, amount) => { t._hp = (t._hp == null ? 100 : t._hp) - amount; hits.push([t.name, amount]); },
    spawn: (template, x, y) => null,
    destroy: (o) => { h.destroyed.push(o); },
    isAlive: (o) => !h.destroyed.includes(o),
    destroyed: [],
    hits: hits
  };
  return Object.assign(h, over || {});
}

// --- state + cooldowns ---
check('createCombatState starts empty',
  JSON.stringify(CB.createCombatState()) === JSON.stringify({ cooldowns: {}, projectiles: [], slashes: [] }));
check('attackReady is true for a never-attacked object, and melee and shot cooldowns are separate',
  (() => {
    const st = CB.createCombatState();
    const hero = objAt(1, 'hero', 100, 100);
    if (!CB.attackReady(st, hero, 'melee', 0.5, 10)) return false;
    if (!CB.attackReady(st, hero, 'shot', 0.5, 10)) return false;
    const h = hooksFor([hero]);
    if (!CB.meleeAttack(st, hero, { damage: 10, range: 60, direction: 'right', cooldown: 0.5 }, h, 10).hit) return false;
    if (CB.attackReady(st, hero, 'melee', 0.5, 10.2)) return false;
    if (CB.attackReady(st, hero, 'melee', 0.5, 10.49)) return false; // 0.49s < 0.5s
    if (!CB.attackReady(st, hero, 'shot', 0.5, 10.2)) return false; // the shot never fired
    if (CB.attackReady(st, hero, 'melee', 0.5, 10.4)) return false; // 0.4s < 0.5s
    if (!CB.attackReady(st, hero, 'melee', 0.5, 10.6)) return false; // 0.6s > 0.5s
    if (CB.attackReady(st, null, 'melee', 0.5, 10)) return false;
    if (!CB.attackReady(null, hero, 'melee', 0.5, 10)) return false; // no state reads as ready
    return true;
  })());

// --- melee geometry ---
check('meleeTargets hits the arc in front and skips what is behind, out of range, or non-solid',
  (() => {
    const hero = objAt(1, 'hero', 100, 100); // center (120, 120)
    const ahead = objAt(2, 'ahead', 160, 100); // center (180, 120), 60px ahead
    const far = objAt(3, 'far', 260, 100); // center (280, 120), 160px ahead
    const behind = objAt(4, 'behind', 40, 100); // center (60, 120), behind
    const above = objAt(5, 'above', 160, 40); // center (180, 60), 45 degrees up... atan2(-60, 60) = -45deg, on the edge
    const high = objAt(6, 'high', 160, 20); // center (180, 40), ~53 degrees up, outside
    const ghost = objAt(7, 'ghost', 160, 140); ghost.kind = 'text'; // in range, not solid
    const h = hooksFor([hero, ahead, far, behind, above, high, ghost]);
    const names = CB.meleeTargets(hero, 100, 'right', h).map(o => o.name).sort();
    if (JSON.stringify(names) !== JSON.stringify(['above', 'ahead'])) return 'got ' + JSON.stringify(names);
    // Facing left flips the arc.
    const left = CB.meleeTargets(hero, 100, 'left', h).map(o => o.name).sort();
    if (JSON.stringify(left) !== JSON.stringify(['behind'])) return 'left got ' + JSON.stringify(left);
    // Facing up: above and high are in the arc, ahead is not.
    const up = CB.meleeTargets(hero, 100, 'up', h).map(o => o.name).sort();
    if (JSON.stringify(up) !== JSON.stringify(['above', 'high'])) return 'up got ' + JSON.stringify(up);
    // No hooks reads as no targets, never a throw.
    if (CB.meleeTargets(hero, 100, 'right', null).length !== 0) return 'null hooks';
    if (CB.meleeTargets(null, 100, 'right', h).length !== 0) return 'null attacker';
    return true;
  })());
check('meleeAttack damages every target in the arc, draws a slash, and refuses during the cooldown',
  (() => {
    const st = CB.createCombatState();
    const hero = objAt(1, 'hero', 100, 100);
    const enemy = objAt(2, 'enemy', 160, 100);
    const h = hooksFor([hero, enemy]);
    const first = CB.meleeAttack(st, hero, { damage: 25, range: 100, direction: 'right', cooldown: 0.5 }, h, 5);
    if (!first.hit || JSON.stringify(first.hits) !== JSON.stringify(['enemy'])) return 'first ' + JSON.stringify(first);
    if (enemy._hp !== 75) return 'enemy hp ' + enemy._hp;
    if (h.hits.length !== 1 || h.hits[0][1] !== 25) return 'damage hook ' + JSON.stringify(h.hits);
    if (st.slashes.length !== 1) return 'slash missing';
    if (st.slashes[0].range !== 100 || st.slashes[0].remain !== 0.15) return 'slash ' + JSON.stringify(st.slashes[0]);
    // A second swing inside the cooldown changes nothing.
    const second = CB.meleeAttack(st, hero, { damage: 25, range: 100, direction: 'right', cooldown: 0.5 }, h, 5.2);
    if (second.hit || second.reason !== 'cooldown') return 'second ' + JSON.stringify(second);
    if (enemy._hp !== 75 || st.slashes.length !== 1) return 'cooldown swing changed state';
    // After the cooldown the swing lands again.
    const third = CB.meleeAttack(st, hero, { damage: 25, range: 100, direction: 'right', cooldown: 0.5 }, h, 5.6);
    if (!third.hit || enemy._hp !== 50) return 'third ' + JSON.stringify(third) + ' hp ' + enemy._hp;
    // A swing with nothing in range still draws, and still spends the cooldown.
    const empty = CB.meleeAttack(st, hero, { damage: 10, range: 60, direction: 'left', cooldown: 0.5 }, h, 6.2);
    if (!empty.hit || empty.hits.length !== 0) return 'empty swing ' + JSON.stringify(empty);
    if (st.slashes.length !== 3) return 'empty slash missing';
    // A missing attacker stays quiet.
    const none = CB.meleeAttack(st, null, { damage: 10, range: 60, direction: 'right', cooldown: 0.5 }, h, 7);
    if (none.hit || none.reason !== 'no-attacker') return 'null attacker ' + JSON.stringify(none);
    // No damage hook: the swing still reports its hits, nothing throws.
    const h2 = hooksFor([hero, enemy]); delete h2.damage;
    const st2 = CB.createCombatState();
    const r = CB.meleeAttack(st2, hero, { damage: 10, range: 100, direction: 'right', cooldown: 0 }, h2, 0);
    if (!r.hit || JSON.stringify(r.hits) !== JSON.stringify(['enemy'])) return 'no-damage-hook ' + JSON.stringify(r);
    return true;
  })());
check('meleeAttack never hits another projectile in the arc',
  (() => {
    const st = CB.createCombatState();
    const hero = objAt(1, 'hero', 100, 100);
    const enemy = objAt(2, 'enemy', 160, 100);
    const bullet = objAt(9, 'fireball', 150, 100, 16, 16);
    st.projectiles.push({ obj: bullet, vx: 300, vy: 0, damage: 10, bornAt: 0, lifetime: 2, shooterId: 1 });
    const h = hooksFor([hero, enemy, bullet]);
    const r = CB.meleeAttack(st, hero, { damage: 10, range: 100, direction: 'right', cooldown: 0 }, h, 0);
    if (!r.hit || JSON.stringify(r.hits) !== JSON.stringify(['enemy'])) return JSON.stringify(r);
    if (bullet._hp != null) return 'bullet took damage';
    return true;
  })());

// --- projectiles ---
check('shootProjectile spawns the clone at the shooter edge, centered, and registers the flight',
  (() => {
    const st = CB.createCombatState();
    const hero = objAt(1, 'hero', 100, 100); // center (120, 120), half-size 20
    const spawned = [];
    const h = hooksFor([hero], {
      spawn: (template, x, y) => {
        const c = objAt(90, template, x, y, 16, 16);
        spawned.push(c);
        return c;
      }
    });
    const r = CB.shootProjectile(st, hero, { template: 'fireball', direction: 'right', speed: 300, damage: 10, lifetime: 2, cooldown: 0.5 }, h, 3);
    if (!r.fired) return 'not fired ' + JSON.stringify(r);
    if (spawned.length !== 1) return 'spawn count ' + spawned.length;
    const c = spawned[0];
    // Edge point is center + (20 + 4) right = (144, 120); recentered by
    // half the clone (8) -> top-left (136, 112).
    if (c.posX !== 136 || c.posY !== 112) return 'clone at ' + c.posX + ',' + c.posY;
    if (st.projectiles.length !== 1) return 'record missing';
    const p = st.projectiles[0];
    if (p.obj !== c || p.vx !== 300 || p.vy !== 0 || p.damage !== 10 || p.bornAt !== 3 || p.lifetime !== 2 || p.shooterId !== 1) {
      return 'record ' + JSON.stringify(p, (k, v) => (k === 'obj' ? '<clone>' : v));
    }
    // A second shot inside the cooldown is refused and spawns nothing.
    const r2 = CB.shootProjectile(st, hero, { template: 'fireball', direction: 'right', speed: 300, damage: 10, lifetime: 2, cooldown: 0.5 }, h, 3.2);
    if (r2.fired || r2.reason !== 'cooldown' || spawned.length !== 1) return 'cooldown shot ' + JSON.stringify(r2);
    return true;
  })());
check('shootProjectile stays quiet on a blank template, a missing template, or a missing shooter — and a refused shot never spends the cooldown',
  (() => {
    const st = CB.createCombatState();
    const hero = objAt(1, 'hero', 100, 100);
    const h = hooksFor([hero], {
      spawn: (template) => (template === 'fireball' ? objAt(90, template, 0, 0, 16, 16) : null)
    });
    const blank = CB.shootProjectile(st, hero, { template: '', direction: 'right', speed: 300, damage: 10, lifetime: 2, cooldown: 0.5 }, h, 0);
    if (blank.fired || blank.reason !== 'no-template') return 'blank ' + JSON.stringify(blank);
    if (!CB.attackReady(st, hero, 'shot', 0.5, 0)) return 'blank spent the cooldown';
    const missing = CB.shootProjectile(st, hero, { template: 'ghost', direction: 'right', speed: 300, damage: 10, lifetime: 2, cooldown: 0.5 }, h, 0);
    if (missing.fired || missing.reason !== 'no-template') return 'missing ' + JSON.stringify(missing);
    if (!CB.attackReady(st, hero, 'shot', 0.5, 0)) return 'missing spent the cooldown';
    const none = CB.shootProjectile(st, null, { template: 'fireball', direction: 'right', speed: 300, damage: 10, lifetime: 2, cooldown: 0.5 }, h, 0);
    if (none.fired || none.reason !== 'no-shooter') return 'null shooter ' + JSON.stringify(none);
    // A real shot fires after the refusals, so the cooldown was untouched.
    const ok = CB.shootProjectile(st, hero, { template: 'fireball', direction: 'up', speed: 300, damage: 10, lifetime: 2, cooldown: 0.5 }, h, 0);
    if (!ok.fired) return 'real shot refused ' + JSON.stringify(ok);
    if (st.projectiles[0].vy !== -300) return 'up velocity ' + st.projectiles[0].vy;
    return true;
  })());
check('shootProjectile refuses at the 200-projectile cap',
  (() => {
    const st = CB.createCombatState();
    const hero = objAt(1, 'hero', 100, 100);
    for (let i = 0; i < 200; i++) {
      st.projectiles.push({ obj: objAt(1000 + i, 'p', 0, 0, 8, 8), vx: 300, vy: 0, damage: 10, bornAt: 0, lifetime: 2, shooterId: 1 });
    }
    const h = hooksFor([hero], { spawn: () => objAt(90, 'fireball', 0, 0, 16, 16) });
    const r = CB.shootProjectile(st, hero, { template: 'fireball', direction: 'right', speed: 300, damage: 10, lifetime: 2, cooldown: 0 }, h, 0);
    if (r.fired || r.reason !== 'cap') return JSON.stringify(r);
    return true;
  })());

// --- frame phase ---
check('updateCombat flies the projectile, hits the first solid object, and destroys the shot',
  (() => {
    const st = CB.createCombatState();
    const hero = objAt(1, 'hero', 100, 100);
    const enemy = objAt(2, 'enemy', 200, 100); // center (220, 120)
    const behind = objAt(3, 'behind', 300, 100); // center (320, 120), past the enemy
    const h = hooksFor([hero, enemy, behind], {
      spawn: (template, x, y) => objAt(90, template, x, y, 16, 16)
    });
    CB.shootProjectile(st, hero, { template: 'fireball', direction: 'right', speed: 300, damage: 10, lifetime: 2, cooldown: 0 }, h, 0);
    const p = st.projectiles[0];
    // One frame at 300 px/s: the clone moves 5px (300/60).
    CB.updateCombat(st, 1 / 60, h, 1 / 60);
    if (st.projectiles.length !== 1) return 'projectile vanished early';
    if (p.obj.posX !== 141) return 'posX ' + p.obj.posX;
    if (enemy._hp != null) return 'hit too early, hp ' + enemy._hp;
    // Fly until it reaches the enemy's left edge (200): the clone's
    // right edge starts at 152 and moves 5px/frame, so 10 frames.
    for (let f = 0; f < 10; f++) CB.updateCombat(st, 1 / 60, h, (f + 2) / 60);
    if (st.projectiles.length !== 0) return 'projectile survived the hit';
    if (enemy._hp !== 90) return 'enemy hp ' + enemy._hp;
    if (behind._hp != null) return 'the shot pierced to the second target';
    if (h.destroyed.length !== 1 || h.destroyed[0] !== p.obj) return 'destroy hook ' + JSON.stringify(h.destroyed.length);
    return true;
  })());
check('updateCombat passes through non-solid objects, never hits the shooter, and never hits another projectile',
  (() => {
    const st = CB.createCombatState();
    const hero = objAt(1, 'hero', 100, 100);
    const text = objAt(2, 'label', 160, 100); text.kind = 'text';
    const other = objAt(3, 'fireball', 200, 100, 16, 16);
    const enemy = objAt(4, 'enemy', 260, 100);
    st.projectiles.push({ obj: other, vx: 0, vy: 0, damage: 10, bornAt: 0, lifetime: 2, shooterId: 1 });
    const h = hooksFor([hero, text, other, enemy], {
      spawn: (template, x, y) => objAt(90, template, x, y, 16, 16)
    });
    CB.shootProjectile(st, hero, { template: 'fireball', direction: 'right', speed: 300, damage: 10, lifetime: 2, cooldown: 0 }, h, 0);
    for (let f = 0; f < 40; f++) CB.updateCombat(st, 1 / 60, h, (f + 1) / 60);
    if (st.projectiles.length !== 1) return 'projectile count ' + st.projectiles.length;
    if (text._hp != null) return 'the text object took damage';
    if (other._hp != null) return 'the other projectile took damage';
    if (enemy._hp !== 90) return 'enemy hp ' + enemy._hp;
    if (hero._hp != null) return 'the shooter hit itself';
    return true;
  })());
check('updateCombat destroys the projectile when its lifetime ends, and drops a clone that vanished by other means',
  (() => {
    const st = CB.createCombatState();
    const hero = objAt(1, 'hero', 100, 100);
    const h = hooksFor([hero], {
      spawn: (template, x, y) => objAt(90, template, x, y, 16, 16)
    });
    CB.shootProjectile(st, hero, { template: 'fireball', direction: 'right', speed: 300, damage: 10, lifetime: 0.1, cooldown: 0 }, h, 0);
    const p = st.projectiles[0];
    CB.updateCombat(st, 1 / 60, h, 0.05);
    if (st.projectiles.length !== 1) return 'expired early';
    CB.updateCombat(st, 1 / 60, h, 0.11);
    if (st.projectiles.length !== 0) return 'expired shot survived';
    if (h.destroyed.length !== 1 || h.destroyed[0] !== p.obj) return 'expiry destroy missing';
    // A clone destroyed elsewhere drops quietly, no destroy call.
    CB.shootProjectile(st, hero, { template: 'fireball', direction: 'right', speed: 300, damage: 10, lifetime: 2, cooldown: 0 }, h, 0.2);
    const p2 = st.projectiles[0];
    h.destroyed.push(p2.obj); // someone else destroyed it
    const calls = h.destroyed.length;
    CB.updateCombat(st, 1 / 60, h, 0.25);
    if (st.projectiles.length !== 0) return 'vanished clone kept';
    if (h.destroyed.length !== calls) return 'vanished clone re-destroyed';
    // dt <= 0 moves nothing.
    CB.shootProjectile(st, hero, { template: 'fireball', direction: 'right', speed: 300, damage: 10, lifetime: 2, cooldown: 0 }, h, 0.3);
    const p3 = st.projectiles[0];
    const x0 = p3.obj.posX;
    CB.updateCombat(st, 0, h, 0.3);
    if (p3.obj.posX !== x0) return 'zero dt moved the shot';
    CB.updateCombat(null, 1 / 60, h, 0.3); // no state never throws
    return true;
  })());
check('updateCombat fades and prunes the slash arcs on the frame clock',
  (() => {
    const st = CB.createCombatState();
    const hero = objAt(1, 'hero', 100, 100);
    const h = hooksFor([hero]);
    CB.meleeAttack(st, hero, { damage: 10, range: 60, direction: 'right', cooldown: 0 }, h, 0);
    if (st.slashes.length !== 1 || st.slashes[0].remain !== 0.15) return 'slash ' + JSON.stringify(st.slashes);
    CB.updateCombat(st, 1 / 60, h, 1 / 60);
    if (st.slashes.length !== 1 || Math.abs(st.slashes[0].remain - (0.15 - 1 / 60)) > 1e-9) {
      return 'slash remain ' + JSON.stringify(st.slashes[0]);
    }
    for (let f = 0; f < 9; f++) CB.updateCombat(st, 1 / 60, h, (f + 2) / 60);
    if (st.slashes.length !== 0) return 'slash survived its 0.15s';
    return true;
  })());

// --- draw ---
check('drawCombatEffects draws the slash arc and fades it, and stays quiet with nothing to draw',
  (() => {
    const calls = [];
    function fakeCtx() {
      return {
        save: () => calls.push('save'),
        restore: () => calls.push('restore'),
        beginPath: () => calls.push('beginPath'),
        moveTo: (x, y) => calls.push(['moveTo', x, y]),
        arc: (x, y, r, a0, a1) => calls.push(['arc', x, y, r, a0, a1]),
        closePath: () => calls.push('closePath'),
        fill: () => calls.push('fill'),
        stroke: () => calls.push('stroke'),
        set globalAlpha(v) { calls.push(['alpha', v]); },
        set strokeStyle(v) { calls.push(['strokeStyle', v]); },
        set fillStyle(v) { calls.push(['fillStyle', v]); },
        set lineWidth(v) { calls.push(['lineWidth', v]); }
      };
    }
    const st = CB.createCombatState();
    CB.drawCombatEffects(fakeCtx(), st, 0, 0);
    CB.drawCombatEffects(null, st, 0, 0);
    if (calls.length !== 0) return 'drew with no slashes';
    st.slashes.push({ x: 120, y: 120, dirX: 1, dirY: 0, range: 60, remain: 0.15 });
    CB.drawCombatEffects(fakeCtx(), st, 20, 10);
    const arc = calls.find(c => Array.isArray(c) && c[0] === 'arc');
    if (!arc) return 'no arc drawn: ' + JSON.stringify(calls);
    // Camera (20, 10) shifts the arc to (100, 110); right-facing arc
    // spans -45 to +45 degrees.
    if (arc[1] !== 100 || arc[2] !== 110 || arc[3] !== 60 ||
        Math.abs(arc[4] + Math.PI / 4) > 1e-9 || Math.abs(arc[5] - Math.PI / 4) > 1e-9) {
      return 'arc ' + JSON.stringify(arc);
    }
    const alpha = calls.find(c => Array.isArray(c) && c[0] === 'alpha');
    if (!alpha || Math.abs(alpha[1] - 0.85) > 1e-9) return 'alpha ' + JSON.stringify(alpha);
    // Half faded: remain 0.075 reads alpha 0.425.
    calls.length = 0;
    st.slashes[0].remain = 0.075;
    CB.drawCombatEffects(fakeCtx(), st, 0, 0);
    const alpha2 = calls.find(c => Array.isArray(c) && c[0] === 'alpha');
    if (!alpha2 || Math.abs(alpha2[1] - 0.425) > 1e-9) return 'faded alpha ' + JSON.stringify(alpha2);
    return true;
  })());

// --- routing ---
check('routing sets cover the two actions and one condition',
  CB.isCombatAction('meleeAttack') && CB.isCombatAction('shootProjectile') &&
  !CB.isCombatAction('attackReady') && !CB.isCombatAction('jump') &&
  !CB.isCombatAction(null) &&
  CB.isCombatCondition('attackReady') &&
  !CB.isCombatCondition('meleeAttack') && !CB.isCombatCondition(null));

// --- static wiring ---
{
  const html = fs.readFileSync(path.join(HYDRA, 'index.html'), 'utf8');
  const cbTag = html.indexOf('src="hydra-combat.js');
  check('index.html loads hydra-combat.js before player-runtime.js and script.js',
    cbTag !== -1 && cbTag < html.indexOf('src="player-runtime.js') && cbTag < html.indexOf('src="script.js'));
  check('index.html loads hydra-combat.js after hydra-platform.js',
    cbTag > html.indexOf('src="hydra-platform.js'));
  const playerJs = fs.readFileSync(path.join(HYDRA, 'player-runtime.js'), 'utf8');
  check('player-runtime.js hard-guards on HydraCombat',
    playerJs.includes("if (!HydraCombat || typeof HydraCombat.createCombatState !== 'function')") &&
    playerJs.includes('HydraScript player runtime requires hydra-combat.js'));
  check('player-runtime.js inlines HydraCombat into exports',
    playerJs.includes("'HydraCombat', global.HydraCombat && global.HydraCombat.factorySource"));
  check('player-runtime.js classifies combat blocks for the dispatch',
    playerJs.includes('HydraCombat.isCombatCondition(type)') &&
    playerJs.includes('HydraCombat.isCombatAction(type)'));
  check('player-runtime.js exposes the module to both contexts and runs the frame phase',
    playerJs.includes('combatModule: HydraCombat') &&
    playerJs.includes('combat: state.combat') &&
    playerJs.includes('updateCombat: () => {') &&
    playerJs.includes('HydraCombat.updateCombat(state.combat, (state.dt || 0) / 60,'));
  check('player-runtime.js mints fresh combat state per scene load',
    playerJs.includes('createCombatState: () => HydraCombat.createCombatState()'));
  check('player-runtime.js draws the slash arcs through the shared draw module',
    playerJs.includes('combat: state.combat,') &&
    playerJs.includes('combat: HydraCombat,'));
  const frameJs = fs.readFileSync(path.join(HYDRA, 'hydra-frame.js'), 'utf8');
  check('frame module runs updateCombat after updateMovement in the world sim',
    frameJs.includes("'updatePaths', 'updateSpawners', 'updatePlatforms', 'updateMovement', 'updateCombat',") &&
    frameJs.includes("call('updateCombat', host.updateCombat);"));
  const resetJs = fs.readFileSync(path.join(HYDRA, 'hydra-scenereset.js'), 'utf8');
  check('scene reset mints fresh combat state per scene load',
    resetJs.includes("typeof h.createCombatState === 'function'") &&
    resetJs.includes('state.combat = combatSt;'));
  const previewJs = fs.readFileSync(path.join(HYDRA, 'hydra-previewruntime.js'), 'utf8');
  check('preview runtime exposes the module to both contexts',
    (previewJs.match(/combatModule: mod\('Combat'\)/g) || []).length === 2 &&
    previewJs.includes('combat: run ? run.combat : null') &&
    previewJs.includes("ensureCombatState: function () { return hostCall('ensurePreviewCombatState', [], null); }"));
  check('preview runtime runs the combat frame phase and mints state per scene',
    previewJs.includes('updateCombat: function () {') &&
    previewJs.includes('CB.updateCombat(r.combat, dt / 60,') &&
    previewJs.includes('createCombatState: function () {') &&
    previewJs.includes("mod('Combat')"));
  const scriptJs = fs.readFileSync(path.join(HYDRA, 'script.js'), 'utf8');
  check('editor hands the combat-state maker to the preview runtime host',
    scriptJs.includes('function ensurePreviewCombatState()') &&
    scriptJs.includes('ensurePreviewPlatformState, ensurePreviewCombatState, getPreviewBuses'));
  check('editor draw view and hooks carry the combat state and module',
    scriptJs.includes('combat: previewState.combat,') &&
    scriptJs.includes('combat: window.HydraCombat || null,'));
  const drawJs = fs.readFileSync(path.join(HYDRA, 'hydra-draw.js'), 'utf8');
  check('shared draw module paints the slash arcs after the damage numbers',
    drawJs.includes('h.combat.drawCombatEffects(ctx, view.combat, cam.x, cam.y)') &&
    drawJs.indexOf('drawCombatEffects') > drawJs.indexOf('drawDamageNumbers'));
  const executeJs = fs.readFileSync(path.join(HYDRA, 'hydra-execute.js'), 'utf8');
  check('shared execute module runs the two combat actions',
    executeJs.includes("if (isType(ctx.combatModule, 'isCombatAction', type))") &&
    executeJs.includes("type === 'meleeAttack'") &&
    executeJs.includes("type === 'shootProjectile'") &&
    executeJs.includes('CB.meleeAttack(cbState, o, { damage: mav.value + growthBonusOf(ctx, \'damage\', o) + scalingBonusOf(ctx, \'damage\', o), range: mrv.value, direction: data.direction, cooldown: mcv.value }, mHooks, cbNow)') &&
    executeJs.includes('CB.shootProjectile(cbState, o, { template: data.projectileObject, direction: data.direction, speed: spv.value, damage: sdv.value + growthBonusOf(ctx, \'damage\', o) + scalingBonusOf(ctx, \'damage\', o), lifetime: slv.value, cooldown: scv.value }, sHooks, cbNow)') &&
    executeJs.includes('function combatHooks(ctx)') &&
    executeJs.includes('spawnClone(ctx, name, x, y)'));
  const conditionsJs = fs.readFileSync(path.join(HYDRA, 'hydra-conditions.js'), 'utf8');
  check('shared conditions module reads Attack Ready',
    conditionsJs.includes("case 'attackReady':") &&
    conditionsJs.includes('CBm.attackReady(ctx.combat, o, arKind, arCd, arNow)'));
  check('shared conditions module does not freeze the Attack Ready read while paused',
    !conditionsJs.split('FROZEN_WHILE_PAUSED = [')[1].split('];')[0].includes("'attackReady'"));
  const flowSb = {};
  flowSb.window = flowSb;
  vm.createContext(flowSb);
  vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-flow.js'), 'utf8'),
    flowSb, { filename: 'hydra-flow.js' });
  const F = flowSb.HydraFlow;
  check('flow module reads Attack Ready as a level trigger',
    F.defaultTriggerMode('attackReady') === 'level');
  const resetSb = {};
  resetSb.window = resetSb;
  vm.createContext(resetSb);
  vm.runInContext(fs.readFileSync(path.join(HYDRA, 'hydra-scenereset.js'), 'utf8'),
    resetSb, { filename: 'hydra-scenereset.js' });
  const SR = resetSb.HydraSceneReset;
  check('scene reset mints a fresh combat state (a shot never leaks into the next scene)',
    (() => {
      const st = CB.createCombatState();
      st.projectiles.push({ obj: { id: 9 }, vx: 300, vy: 0, damage: 10, bornAt: 0, lifetime: 2, shooterId: 1 });
      const state = { combat: st };
      const ok = SR.resetSceneRuntime(state, { id: 1 }, {
        createCombatState: () => CB.createCombatState()
      });
      return ok === true && state.combat !== st && state.combat.projectiles.length === 0;
    })() &&
    (() => {
      const state = {};
      const ok = SR.resetSceneRuntime(state, { id: 2 }, {});
      return ok === true && state.combat === null;
    })());
  const catalogJs = fs.readFileSync(path.join(HYDRA, 'block-catalog.js'), 'utf8');
  check('catalog carries the three combat blocks in the Combat category',
    catalogJs.includes("category: 'Combat'") &&
    catalogJs.includes("blockType: 'melee-attack'") &&
    catalogJs.includes("runtimeType: 'meleeAttack'") &&
    catalogJs.includes("blockType: 'shoot-projectile'") &&
    catalogJs.includes("runtimeType: 'shootProjectile'") &&
    catalogJs.includes("blockType: 'attack-ready'") &&
    catalogJs.includes("runtimeType: 'attackReady'") &&
    catalogJs.includes("key: 'damage', label: 'Damage'") &&
    catalogJs.includes("key: 'range', label: 'Range (px)'") &&
    catalogJs.includes("key: 'projectileObject', label: 'Projectile'") &&
    catalogJs.includes("key: 'speed', label: 'Speed (px/s)'") &&
    catalogJs.includes("key: 'lifetime', label: 'Lifetime (s)'") &&
    catalogJs.includes("key: 'attackKind', label: 'Attack'"));
  const refMd = fs.readFileSync(path.join(REPO, 'docs', 'block-reference.md'), 'utf8');
  check('block reference documents all three combat blocks',
    refMd.includes('Melee Attack') && refMd.includes('Shoot Projectile') &&
    refMd.includes('Attack Ready') && refMd.includes('### Combat (3)'));
  const guideMd = fs.readFileSync(path.join(REPO, 'docs', 'user-guide.md'), 'utf8');
  check('user guide covers combat, melee, and projectiles',
    guideMd.includes('## Combat') && guideMd.includes('Melee Attack') &&
    guideMd.includes('Shoot Projectile') && guideMd.includes('Attack Ready'));
}

process.exit(failures === 0 ? 0 : 1);
