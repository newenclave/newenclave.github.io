import { moveToward, moveWithCollision, chasePlayer, canSee, goHome } from './entity.js';
import { damagePlayer } from './player-damage.js';
import { tierScale } from '../systems/difficulty.js';
import { speedFactor } from './status.js';

const LEASH = 520;
const PLAYER_R = 14;
export const GIVE_UP = 3; // seconds with no way to you (a cliff, a river) before a monster gives up and goes home...
export const CALM = 4; // ... and leaves you alone for a while

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

// A melee blow has three parts (anticipation, attack, recovery): the monster stops and winds up (the red wedge shows
// where it will land), lunges, and stands open for a moment afterwards. Step out during the windup, hit back after.
const DEG = Math.PI / 180;
export const BITE_ARC = 70 * DEG; // half the width of the wedge
const LUNGE_TIME = 0.12;
const WINDUP = 0.45;
const RECOVER = 0.4;
const LUNGE = 24;

// Attack tokens (Doom 2016): only a few monsters wind up at once, the rest circle and wait their turn.
export const maxBiters = (tier = 0) => (tier >= 2 ? 3 : 2);
const bitingNow = (e) => e.atk?.kind === 'bite' && e.atk.phase !== 'recover';

const biteReach = (e) => e.def.attackRange + e.r + PLAYER_R;
const angleDiff = (a, b) => {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
};

function biteStep(state, world, e, dist, dt) {
  const def = e.def;
  const a = e.atk;
  a.t += dt;
  if (a.phase === 'windup') {
    if (a.t < a.dur * 0.6) { // it keeps after you while it takes aim: running away does not outpace a windup
      a.dir = angleToPlayer(state, e);
      if (dist > biteReach(e) * 0.6) chasePlayer(world, e, state.player.x, state.player.y, def.speed * speedFactor(e), dt, true);
    } // locked in the last part of the windup: you can step out
    if (a.t >= a.dur) e.atk = { ...a, phase: 'lunge', t: 0, dur: LUNGE_TIME, hit: false };
  } else if (a.phase === 'lunge') {
    const v = (def.lunge ?? LUNGE) / LUNGE_TIME;
    if (dist > e.r + PLAYER_R) moveWithCollision(world, e, Math.cos(a.dir) * v * dt, Math.sin(a.dir) * v * dt, true); // not through you
    const d = Math.hypot(state.player.x - e.x, state.player.y - e.y);
    if (!a.hit && d <= biteReach(e) && angleDiff(angleToPlayer(state, e), a.dir) <= BITE_ARC) {
      a.hit = true;
      damagePlayer(state, e.damage, e);
    }
    if (a.t >= a.dur) e.atk = { kind: 'bite', phase: 'recover', t: 0, dur: def.recover ?? RECOVER };
  } else if (a.t >= a.dur) {
    e.atk = null;
    e.atkCd = Math.max(0.2, def.attackCooldown - (def.windup ?? WINDUP)); // the windup is part of the wait
  }
}

// No token: keep a step away and walk round the player.
function circle(state, world, e, dist, speed, dt) {
  const p = state.player;
  const want = biteReach(e) + (e.def.lunge ?? LUNGE) + 26;
  const ax = (e.x - p.x) / (dist || 1);
  const ay = (e.y - p.y) / (dist || 1);
  const side = Math.sin(e.phase) >= 0 ? 1 : -1;
  const out = Math.max(-1, Math.min(1, (want - dist) / 30));
  moveWithCollision(world, e, (-ay * side + ax * out) * speed * 0.45 * dt, (ax * side + ay * out) * speed * 0.45 * dt, true);
}

function chaseMelee(state, world, e, dist, dt) {
  const def = e.def;
  if (e.atk) { biteStep(state, world, e, dist, dt); return; }
  const speed = def.speed * speedFactor(e);
  const tokenFree = (state.biters ?? 0) < maxBiters(e.tier);
  if (dist <= biteReach(e) + 6 && e.atkCd <= 0 && tokenFree && canSee(world, e.x, e.y, state.player.x, state.player.y)) {
    state.biters = (state.biters ?? 0) + 1;
    e.atk = { kind: 'bite', phase: 'windup', t: 0, dur: def.windup ?? WINDUP, dir: angleToPlayer(state, e), reach: biteReach(e) + (def.lunge ?? LUNGE) };
    return;
  }
  if ((!tokenFree || e.atkCd > 0) && dist < biteReach(e) + (def.lunge ?? LUNGE) + 36) { // waiting its turn: a step away, circling
    circle(state, world, e, dist, speed, dt);
    return;
  }
  if (def.flutter) { // bats weave from side to side on their way to you
    const ang = angleToPlayer(state, e) + Math.sin(e.age * 7 + e.phase) * 0.8;
    moveWithCollision(world, e, Math.cos(ang) * speed * dt, Math.sin(ang) * speed * dt, true);
  } else {
    chasePlayer(world, e, state.player.x, state.player.y, speed, dt, true);
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
  if (a?.kind === 'bite') { biteStep(state, world, e, dist, dt); return; }
  if (a) {
    a.t += dt;
    if (a.phase === 'windup') {
      if (a.t < a.dur * 0.6) a.dir = angleToPlayer(state, e); // locked in the last part of the windup: you can dodge
      if (a.t >= a.dur) e.atk = { phase: 'dash', t: 0, dur: c.time, dir: a.dir, hit: false };
    } else if (a.phase === 'dash') {
      moveWithCollision(world, e, Math.cos(a.dir) * c.speed * dt, Math.sin(a.dir) * c.speed * dt, true);
      if (!a.hit && dist <= e.r + PLAYER_R + 4) {
        a.hit = true;
        damagePlayer(state, e.damage, e);
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
  state.biters = state.enemies.filter((e) => !e.boss && e.hp > 0 && e.mode === 'chase' && bitingNow(e)).length;
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

    e.calm = Math.max(0, (e.calm ?? 0) - dt);
    if (e.mode === 'idle') {
      if (!playerSafe && !e.calm && dist < def.aggro && canSee(world, e.x, e.y, p.x, p.y)) { e.mode = 'chase'; e.lost = 0; continue; } // no waking up through a wall
      e.wanderT -= dt;
      if (e.wanderT <= 0) {
        e.wanderT = 2 + Math.random() * 3;
        const a = Math.random() * Math.PI * 2;
        const d = Math.random() * 90;
        e.wander = { x: e.home.x + Math.cos(a) * d, y: e.home.y + Math.sin(a) * d };
      }
      moveToward(world, e, e.wander.x, e.wander.y, def.speed * 0.3 * speedFactor(e), dt, true);
    } else if (e.mode === 'chase') {
      if (playerSafe || homeDist > LEASH || dist > def.aggro * 1.8) { e.mode = 'return'; e.atk = null; e.lost = 0; continue; }
      // no way to you: a monster that cannot shoot you from where it stands gives up for a while
      if ((e.lost ?? 0) > GIVE_UP && !(def.ai === 'ranged' && canSee(world, e.x, e.y, p.x, p.y))) {
        e.mode = 'return';
        e.atk = null;
        e.lost = 0;
        e.calm = CALM;
        continue;
      }
      (CHASE[def.ai ?? 'melee'] ?? chaseMelee)(state, world, e, dist, dt);
    } else if (e.mode === 'return') {
      goHome(world, e, def.speed * 1.2 * speedFactor(e), dt);
      e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.3 * dt);
      if (homeDist < 8) e.mode = 'idle';
    }
  }
  if (state.enemies.some((e) => e.remove)) state.enemies = state.enemies.filter((e) => !e.remove);
}
