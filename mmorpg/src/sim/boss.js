import { moveToward, moveWithCollision, chasePlayer, canSee } from './entity.js';
import { damagePlayer } from './player-damage.js';
import { makeEnemy, spawnEnemyProjectile } from './enemy.js';

const PLAYER_R = 14;
const MAX_MINIONS = 6;
const RECOVER = 0.5; // pause after every attack: the moment to hit back
const TOUCH_COOLDOWN = 1.0;
const RETURN_HEAL = 0.3; // share of max HP per second while the boss walks home after you left
const RETURN_SPEED = 1.5;
const LOCK_AT = 0.6; // the target is locked after 60% of the windup: move away in time and the attack misses

export function makeBoss(def, lair, tier) {
  const scale = 1 + 0.25 * Math.max(0, tier - def.tier); // a boss in a more dangerous region is tougher
  const hp = Math.round(def.hp * scale);
  return {
    def, boss: true, lairId: lair.id, name: lair.name, tier, x: lair.px, y: lair.py, r: def.r, hp, maxHp: hp,
    damage: Math.round(def.damage * scale), xp: Math.round(def.xp * scale), goldMult: scale,
    flash: 0, respawn: 0, home: { x: lair.px, y: lair.py }, mode: 'idle', atkCd: 0, touchCd: 0, atk: null, lastKind: null,
  };
}

export const bossHpFraction = (e) => e.hp / e.maxHp;

// Attacks the boss may use right now: low-health attacks unlock as it gets hurt, and each has a range.
export function availableAttacks(e, dist) {
  const frac = bossHpFraction(e);
  return e.def.attacks.filter((a) => frac <= (a.from ?? 1) && (a.range === undefined || dist <= a.range));
}

// Attack numbers in the data are for the base boss; a tougher boss hits harder by the same factor.
const dmg = (e, attack) => Math.round((attack.damage * e.damage) / e.def.damage);

export const minionCount = (state, lairId) => state.enemies.filter((m) => m.owner === lairId && m.hp > 0).length;

function spawnMinions(state, e, a, rng) {
  const def = state.enemyDefs?.find((d) => d.id === a.minion);
  if (!def) return;
  const room = MAX_MINIONS - minionCount(state, e.lairId);
  for (let i = 0; i < Math.min(a.count, room); i++) {
    const ang = rng() * Math.PI * 2;
    const m = makeEnemy(def, e.x + Math.cos(ang) * (e.r + 30), e.y + Math.sin(ang) * (e.r + 30), e.tier);
    m.owner = e.lairId;
    m.mode = 'chase';
    m.home = { x: e.x, y: e.y };
    state.enemies.push(m);
  }
}

function startAttack(state, e, dist, rng) {
  let options = availableAttacks(e, dist);
  if (options.length > 1) options = options.filter((a) => a.kind !== e.lastKind); // no same attack twice in a row
  if (options.length === 0) return false;
  const a = options[Math.floor(rng() * options.length)];
  const p = state.player;
  e.atk = { kind: a.kind, def: a, phase: 'windup', t: 0, dur: a.windup, tx: p.x, ty: p.y, dir: Math.atan2(p.y - e.y, p.x - e.x), hit: false };
  return true;
}

function recover(e, a) {
  e.atk = { ...a, phase: 'recover', t: 0, dur: RECOVER };
}

// The end of a windup: the attack happens.
function execute(state, world, e, a, rng) {
  const p = state.player;
  const d = a.def;
  switch (a.kind) {
    case 'slam':
      state.effects.push({ kind: 'aoe', x: a.tx, y: a.ty, radius: d.radius, color: '#ff5252', t: 0, dur: 0.35 });
      if (!state.dead && Math.hypot(p.x - a.tx, p.y - a.ty) <= d.radius + PLAYER_R) damagePlayer(state, dmg(e, d));
      break;
    case 'fan':
      for (let i = 0; i < d.count; i++) {
        const spread = ((d.spread ?? 60) * Math.PI) / 180;
        const ang = a.dir + (d.count === 1 ? 0 : (i / (d.count - 1) - 0.5) * spread);
        spawnEnemyProjectile(state, e.x, e.y, ang, d.speed, dmg(e, d), 6, '#ffab40', (d.range ?? 520) + 200);
      }
      break;
    case 'nova': {
      const start = rng() * Math.PI * 2;
      for (let i = 0; i < d.count; i++) {
        spawnEnemyProjectile(state, e.x, e.y, start + (i * Math.PI * 2) / d.count, d.speed, dmg(e, d), 6, '#ff7043', 650);
      }
      break;
    }
    case 'summon':
      spawnMinions(state, e, d, rng);
      break;
    case 'charge':
      e.atk = { ...a, phase: 'dash', t: 0, hit: false };
      return;
    default:
  }
  recover(e, a);
}

function runAttack(state, world, e, dt, rng) {
  const a = e.atk;
  const p = state.player;
  a.t += dt;
  if (a.phase === 'windup') {
    if (a.t < a.dur * LOCK_AT) {
      a.tx = p.x;
      a.ty = p.y;
      a.dir = Math.atan2(p.y - e.y, p.x - e.x);
    }
    if (a.t >= a.dur) execute(state, world, e, a, rng);
  } else if (a.phase === 'dash') {
    moveWithCollision(world, e, Math.cos(a.dir) * a.def.speed * dt, Math.sin(a.dir) * a.def.speed * dt, true);
    if (!a.hit && !state.dead && Math.hypot(p.x - e.x, p.y - e.y) <= e.r + PLAYER_R + 6) {
      a.hit = true;
      damagePlayer(state, dmg(e, a.def));
    }
    if (a.t >= a.def.time) recover(e, a);
  } else if (a.t >= a.dur) {
    e.lastKind = a.kind;
    e.atkCd = e.def.cooldown * (0.55 + 0.45 * bossHpFraction(e)); // the angrier, the quicker
    e.atk = null;
  }
}

export function updateBoss(state, world, e, dt, rng = Math.random) {
  e.flash = Math.max(0, e.flash - dt);
  if (e.hp <= 0) return;
  const p = state.player;
  const def = e.def;
  const safe = state.dead || world.isTown(p.x, p.y);
  const dist = Math.hypot(p.x - e.x, p.y - e.y);
  const homeDist = Math.hypot(e.home.x - e.x, e.home.y - e.y);

  if (e.mode === 'idle') {
    if (!safe && dist < def.aggro && canSee(world, e.x, e.y, p.x, p.y)) {
      e.mode = 'chase';
      e.atkCd = Math.max(e.atkCd, 1.2); // a moment to see what is coming
    }
    return;
  }
  if (e.mode === 'return') {
    e.atk = null;
    moveToward(world, e, e.home.x, e.home.y, def.speed * RETURN_SPEED, dt, true);
    e.hp = Math.min(e.maxHp, e.hp + e.maxHp * RETURN_HEAL * dt);
    if (homeDist < 10) e.mode = 'idle';
    return;
  }

  if (safe || homeDist > def.leash || dist > def.aggro * 2) {
    e.mode = 'return';
    e.atk = null;
    return;
  }
  e.atkCd = Math.max(0, e.atkCd - dt);
  e.touchCd = Math.max(0, e.touchCd - dt);
  if (e.atk) {
    runAttack(state, world, e, dt, rng);
    return;
  }
  if (dist > e.r + PLAYER_R + 40) {
    chasePlayer(world, e, p.x, p.y, def.speed, dt, true);
  } else if (e.touchCd <= 0 && dist <= e.r + PLAYER_R + 12) {
    e.touchCd = TOUCH_COOLDOWN;
    damagePlayer(state, e.damage);
  }
  if (e.atkCd <= 0 && !(canSee(world, e.x, e.y, p.x, p.y) && startAttack(state, e, dist, rng))) e.atkCd = 0.3; // nothing in reach yet: look again soon
}
