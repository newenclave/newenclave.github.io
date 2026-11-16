import { moveToward, moveWithCollision, chasePlayer, canSee } from './entity.js';
import { damagePlayer } from './player-damage.js';
import { tierScale } from '../systems/difficulty.js';
import { speedFactor } from './status.js';

const LEASH = 520;
const PLAYER_R = 14;

// A monster of a given danger tier: tougher and stronger far from the start, and worth more.
export function makeEnemy(def, x, y, tier = 0) {
  const sc = tierScale(tier);
  const hp = Math.round(def.hp * sc.hp);
  return {
    def, x, y, r: def.r, hp, maxHp: hp, tier,
    damage: Math.round(def.damage * sc.damage), xp: Math.round(def.xp * sc.reward), goldMult: sc.reward,
    flash: 0, respawn: 0, home: { x, y }, mode: 'idle', atkCd: 0, wanderT: 0, wander: { x, y }, atk: null,
    age: 0, phase: Math.random() * Math.PI * 2, // for the flutter of bats
  };
}

export function spawnEnemyProjectile(state, x, y, angle, speed, damage, radius, color, range = 650) {
  state.enemyProjectiles ??= [];
  state.enemyProjectiles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, r: radius, damage, left: range, color });
}

// Projectiles stop at the edge of a town (towns are safe) and fly over a rolling player without hitting.
export function updateEnemyProjectiles(state, world, dt) {
  if (!state.enemyProjectiles) return;
  const p = state.player;
  state.enemyProjectiles = state.enemyProjectiles.filter((s) => {
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.left -= Math.hypot(s.vx, s.vy) * dt;
    if (s.left <= 0 || world.isTown(s.x, s.y) || world.blocksShots?.(s.x, s.y)) return false; // towns and dungeon walls stop shots
    if (!state.dead && p.rollTime <= 0 && Math.hypot(p.x - s.x, p.y - s.y) <= s.r + PLAYER_R) {
      damagePlayer(state, s.damage);
      return false;
    }
    return true;
  });
}

const angleToPlayer = (state, e) => Math.atan2(state.player.y - e.y, state.player.x - e.x);

function chaseMelee(state, world, e, dist, dt) {
  const def = e.def;
  if (dist > def.attackRange + e.r + PLAYER_R) {
    const speed = def.speed * speedFactor(e);
    if (def.flutter) { // bats weave from side to side on their way to you
      const a = Math.atan2(state.player.y - e.y, state.player.x - e.x) + Math.sin(e.age * 7 + e.phase) * 0.8;
      moveWithCollision(world, e, Math.cos(a) * speed * dt, Math.sin(a) * speed * dt, true);
    } else {
      chasePlayer(world, e, state.player.x, state.player.y, speed, dt, true);
    }
  } else if (e.atkCd <= 0) {
    e.atkCd = def.attackCooldown;
    damagePlayer(state, e.damage);
  }
}

// Archers and mages keep their distance and shoot.
function chaseRanged(state, world, e, dist, dt) {
  const def = e.def;
  const p = state.player;
  const r = def.ranged;
  const speed = def.speed * speedFactor(e);
  if (dist > r.keep + 30) {
    chasePlayer(world, e, p.x, p.y, speed, dt, true);
  } else if (dist < r.keep - 70) {
    moveToward(world, e, e.x + (e.x - p.x), e.y + (e.y - p.y), speed * 0.8, dt, true);
  }
  if (e.atkCd <= 0 && dist <= def.aggro && canSee(world, e.x, e.y, p.x, p.y)) {
    e.atkCd = def.attackCooldown;
    spawnEnemyProjectile(state, e.x, e.y, angleToPlayer(state, e), r.speed, e.damage, r.radius, r.color, def.aggro + 150);
  }
}

// Boars wind up (the red line shows where they will run), dash, and are stunned for a moment afterwards.
function chaseCharger(state, world, e, dist, dt) {
  const def = e.def;
  const c = def.charger;
  const p = state.player;
  const a = e.atk;
  if (a) {
    a.t += dt;
    if (a.phase === 'windup') {
      if (a.t < a.dur * 0.6) a.dir = angleToPlayer(state, e); // locked in the last part of the windup: you can dodge
      if (a.t >= a.dur) e.atk = { phase: 'dash', t: 0, dur: c.time, dir: a.dir, hit: false };
    } else if (a.phase === 'dash') {
      moveWithCollision(world, e, Math.cos(a.dir) * c.speed * dt, Math.sin(a.dir) * c.speed * dt, true);
      if (!a.hit && dist <= e.r + PLAYER_R + 4) {
        a.hit = true;
        damagePlayer(state, e.damage);
      }
      if (a.t >= a.dur) e.atk = { phase: 'recover', t: 0, dur: c.recover };
    } else if (a.t >= a.dur) {
      e.atk = null;
      e.atkCd = def.attackCooldown;
    }
    return;
  }
  if (e.atkCd <= 0 && dist > 80 && dist <= c.trigger && canSee(world, e.x, e.y, p.x, p.y)) {
    e.atk = { phase: 'windup', t: 0, dur: c.windup, dir: angleToPlayer(state, e) };
    return;
  }
  chaseMelee(state, world, e, dist, dt);
}

const CHASE = { melee: chaseMelee, ranged: chaseRanged, charger: chaseCharger };

// Regular monsters. Bosses are driven by updateBoss (see lairs.js).
export function updateEnemies(state, world, dt) {
  const p = state.player;
  const playerSafe = state.dead || world.isTown(p.x, p.y); // towns are safe zones
  for (const e of state.enemies) {
    if (e.boss) continue;
    e.flash = Math.max(0, e.flash - dt);
    if (e.hp <= 0) { // the dead stay dead: new monsters come from camps and from far away (systems/camps.js, spawning.js)
      e.remove = true;
      continue;
    }
    e.atkCd = Math.max(0, e.atkCd - dt);
    e.age += dt;
    const def = e.def;
    const dist = Math.hypot(p.x - e.x, p.y - e.y);
    const homeDist = Math.hypot(e.home.x - e.x, e.home.y - e.y);

    if (e.mode === 'idle') {
      if (!playerSafe && dist < def.aggro && canSee(world, e.x, e.y, p.x, p.y)) { e.mode = 'chase'; continue; } // no waking up through a wall
      e.wanderT -= dt;
      if (e.wanderT <= 0) {
        e.wanderT = 2 + Math.random() * 3;
        const a = Math.random() * Math.PI * 2;
        const d = Math.random() * 90;
        e.wander = { x: e.home.x + Math.cos(a) * d, y: e.home.y + Math.sin(a) * d };
      }
      moveToward(world, e, e.wander.x, e.wander.y, def.speed * 0.3 * speedFactor(e), dt, true);
    } else if (e.mode === 'chase') {
      if (playerSafe || homeDist > LEASH || dist > def.aggro * 1.8) { e.mode = 'return'; e.atk = null; continue; }
      (CHASE[def.ai ?? 'melee'] ?? chaseMelee)(state, world, e, dist, dt);
    } else if (e.mode === 'return') {
      moveToward(world, e, e.home.x, e.home.y, def.speed * 1.2 * speedFactor(e), dt, true);
      e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.3 * dt);
      if (homeDist < 8) e.mode = 'idle';
    }
  }
  if (state.enemies.some((e) => e.remove)) state.enemies = state.enemies.filter((e) => !e.remove);
}
