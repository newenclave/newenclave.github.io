// Pure combat logic: no DOM or Canvas, so it can move to a server later.
import { dropLoot } from './loot.js';
import { damagePlayer } from './player-damage.js';
import { isFlying, bodyY } from './entity.js';
import { bossRewards } from '../systems/lairs.js';
import { CALM_MAX } from '../systems/spawning.js';
import { grantXp } from '../systems/xp.js';
import { onKill } from '../systems/quests.js';
import { recordKill } from '../systems/bestiary.js';
import { loadoutOf, slotOf, OFFHAND_DAMAGE } from '../systems/loadout.js';
import { applyDot, applySlow, DOT_STEP } from './status.js';

export { damagePlayer }; // kept here too: it is part of the combat API

const DEG = Math.PI / 180;
const MELEE_TYPES = new Set(['arc', 'thrust']);

export function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

export function rollDamage(player, weapon, rng = Math.random) {
  const s = player.stats;
  const classBonus = MELEE_TYPES.has(weapon.type) ? s.meleeDamage : s.rangedDamage;
  let amount = weapon.damage * (1 + s.damage + classBonus);
  const crit = rng() < s.critChance;
  if (crit) amount *= 1.5 + s.critDamage;
  return { amount, crit };
}

export function damageEnemy(state, enemy, hit) {
  if (enemy.hp <= 0) return;
  enemy.hp -= hit.amount;
  enemy.flash = 0.12;
  state.floaters.push({
    x: enemy.x, y: enemy.y - 20, t: 0, dur: hit.crit ? 1.1 : 0.8,
    text: Math.round(hit.amount) + (hit.crit ? '!' : ''), color: hit.color ?? (hit.crit ? '#ff9800' : undefined),
  });
  if (enemy.hp <= 0) {
    if (!enemy.boss && !enemy.owner && !enemy.camp) state.calm = Math.min(CALM_MAX, (state.calm ?? 0) + 1); // fewer wanderers for a while
    recordKill(state, enemy.def.id);
    if (enemy.boss) bossRewards(state, enemy);
    else dropLoot(state, enemy);
    const p = state.player;
    p.hp = Math.min(p.maxHp, p.hp + p.stats.lifeOnKill);
    grantXp(state, enemy.xp ?? enemy.def.xp); // tougher monsters (farther from the start) pay more
    const [lo, hi] = enemy.def.gold ?? [0, 0];
    const gold = Math.round((lo + Math.floor(Math.random() * (hi - lo + 1))) * (enemy.goldMult ?? 1));
    if (gold > 0) {
      p.gold += gold;
      state.floaters.push({ x: enemy.x, y: enemy.y - 36, text: `+${gold}g`, color: '#ffd54f', t: 0, dur: 1 });
    }
    for (const id of onKill(state, enemy.def.id)) {
      state.floaters.push({ x: p.x, y: p.y - 60, key: 'quest.ready', questId: id, color: '#9ccc65', t: 0, dur: 2.2 });
    }
  } else if (enemy.mode === 'idle') {
    enemy.mode = 'chase';
  }
}

// Walls (in a dungeon) stop blows and shots: a monster in the next room cannot be hit through the wall.
const clear = (state, ax, ay, bx, by) => (state.world?.lineClear ? state.world.lineClear(ax, ay, bx, by) : true);

// The farthest point towards (bx, by) that can be seen from (ax, ay): a spell cast at a wall bursts against it.
function reachable(state, ax, ay, bx, by) {
  for (let f = 1; f > 0; f -= 0.05) {
    const x = ax + (bx - ax) * f;
    const y = ay + (by - ay) * f;
    if (clear(state, ax, ay, x, y)) return { x, y };
  }
  return { x: ax, y: ay };
}

const cooldownOf = (player, weapon) => weapon.cooldown / (1 + player.stats.attackSpeed);

// One press of the attack button: every hand that is ready swings. The off hand has its own clock.
export function tryAttack(state, player, aim) {
  const lo = loadoutOf(state);
  let acted = false;
  if (!(player.cooldown > 0)) { // (a missing cooldown means ready)
    swing(state, player, aim, player.weapon, { ammo: lo.mode === 'ammo' ? lo.off : null });
    player.cooldown = cooldownOf(player, player.weapon);
    acted = true;
  }
  if (lo.mode === 'dual' && !(player.cooldownOff > 0)) {
    swing(state, player, aim, lo.off, { mult: OFFHAND_DAMAGE });
    player.cooldownOff = cooldownOf(player, lo.off);
    acted = true;
  }
  return acted;
}

// A shot with special ammo uses one up; when the stack is empty the off hand is free again.
function useAmmo(state, ammo) {
  ammo.count -= 1;
  if (ammo.count > 0) return;
  state.offhands[slotOf(state)] = null;
  state.floaters.push({ x: state.player.x, y: state.player.y - 30, key: 'ammo.empty', color: '#ffcc80', t: 0, dur: 1.4 });
}

function swing(state, player, aim, w, { mult = 1, ammo = null } = {}) {
  const ang = Math.atan2(aim.y - player.y, aim.x - player.x);
  // Weapons that only reach the ground cannot touch flyers; a shot or a spell can (see `reach` in weapons.json).
  const reachesAir = w.reach === 'both';
  const withinReach = [];
  let missedFlyer = null;
  for (const e of state.enemies) {
    if (e.hp <= 0) continue;
    if (isFlying(e) && !reachesAir) missedFlyer = missedFlyer ?? e;
    else withinReach.push(e);
  }
  const alive = withinReach;
  const hit = () => {
    const h = rollDamage(player, w);
    h.amount *= mult;
    return h;
  };
  const noteMiss = (area) => { // tell the player why nothing happened
    if (missedFlyer && area(missedFlyer)) {
      state.floaters.push({ x: missedFlyer.x, y: missedFlyer.y - 40, key: 'combat.outOfReach', color: '#b0bec5', t: 0, dur: 1 });
    }
  };

  switch (w.type) {
    case 'arc': {
      state.effects.push({ kind: 'arc', x: player.x, y: player.y, ang, range: w.range, arc: w.arc * DEG, color: w.color, t: 0, dur: 0.15 });
      for (const e of alive) {
        const dist = Math.hypot(e.x - player.x, e.y - player.y) - e.r;
        if (dist <= w.range && angleDiff(Math.atan2(e.y - player.y, e.x - player.x), ang) <= (w.arc * DEG) / 2 && clear(state, player.x, player.y, e.x, e.y)) {
          damageEnemy(state, e, hit());
        }
      }
      noteMiss((f) => Math.hypot(f.x - player.x, f.y - player.y) - f.r <= w.range && angleDiff(Math.atan2(f.y - player.y, f.x - player.x), ang) <= (w.arc * DEG) / 2);
      break;
    }
    case 'thrust': {
      state.effects.push({ kind: 'thrust', x: player.x, y: player.y, ang, range: w.range, width: w.width, color: w.color, t: 0, dur: 0.18 });
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      for (const e of alive) {
        const dx = e.x - player.x;
        const dy = e.y - player.y;
        const along = dx * cos + dy * sin;
        const across = Math.abs(-dx * sin + dy * cos);
        if (along >= 0 && along <= w.range + e.r && across <= w.width / 2 + e.r && clear(state, player.x, player.y, e.x, e.y)) damageEnemy(state, e, hit());
      }
      noteMiss((f) => {
        const dx = f.x - player.x;
        const dy = f.y - player.y;
        const along = dx * cos + dy * sin;
        return along >= 0 && along <= w.range + f.r && Math.abs(-dx * sin + dy * cos) <= w.width / 2 + f.r;
      });
      break;
    }
    case 'projectile': {
      const shot = {
        x: player.x, y: player.y, vx: Math.cos(ang) * w.speed, vy: Math.sin(ang) * w.speed,
        left: w.range, r: w.radius, hit: hit(), color: w.color,
      };
      const fx = ammo && state.ammoEffects?.[ammo.effect];
      if (fx) { // special ammo: the effect travels with the shot
        shot.effect = fx;
        shot.pierce = fx.pierce ?? 0;
        shot.color = fx.color ?? w.color;
        useAmmo(state, ammo);
      }
      state.projectiles.push(shot);
      break;
    }
    case 'aoe': {
      const radius = w.radius * (1 + player.stats.aoeRadius);
      const d = Math.min(Math.hypot(aim.x - player.x, aim.y - player.y), w.range);
      const { x, y } = reachable(state, player.x, player.y, player.x + Math.cos(ang) * d, player.y + Math.sin(ang) * d);
      state.effects.push({ kind: 'aoe', x, y, radius, color: w.color, t: 0, dur: 0.3 });
      for (const e of alive) {
        if (Math.hypot(e.x - x, e.y - y) <= radius + e.r && clear(state, x, y, e.x, e.y)) damageEnemy(state, e, hit());
      }
      break;
    }
    default:
  }
}

// What special ammo does to the monster it hit (and the ones around it).
function applyAmmoEffect(state, shot, target) {
  const fx = shot.effect;
  if (!fx) return;
  const amount = shot.hit.amount;
  if (fx.dot) applyDot(target, fx.dot.kind, amount * fx.dot.share, fx.dot.time);
  if (fx.slow) applySlow(target, fx.slow.mult, fx.slow.time);
  if (fx.blast) {
    state.effects.push({ kind: 'aoe', x: shot.x, y: shot.y, radius: fx.blast.radius, color: fx.color ?? '#ffb300', t: 0, dur: 0.25 });
    for (const e of state.enemies) {
      if (e === target || e.hp <= 0) continue;
      if (Math.hypot(e.x - shot.x, bodyY(e) - shot.y) <= fx.blast.radius + e.r) {
        damageEnemy(state, e, { amount: amount * fx.blast.share, crit: false, color: fx.color });
      }
    }
  }
}

export function updateProjectiles(state, dt) {
  state.projectiles = state.projectiles.filter((p) => {
    const step = Math.hypot(p.vx, p.vy) * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.left -= step;
    if (state.world?.blocksShots?.(p.x, p.y)) return false; // the arrow hits the wall
    for (const e of state.enemies) {
      if (e.hp <= 0 || p.pierced?.has(e) || Math.hypot(e.x - p.x, bodyY(e) - p.y) > e.r + p.r) continue;
      damageEnemy(state, e, p.hit);
      applyAmmoEffect(state, p, e);
      if (p.pierce > 0) { // a piercing arrow goes on to the next one
        p.pierce -= 1;
        (p.pierced ??= new Set()).add(e);
        return p.left > 0;
      }
      return false;
    }
    return p.left > 0;
  });
}

const DOT_COLORS = { burn: '#ff7043', poison: '#9ccc65' };

// Burning and poison hurt a little every half second; slows wear off. Kills by these count like any other kill.
export function tickStatuses(state, dt) {
  for (const e of [...state.enemies]) {
    if (e.hp <= 0) { e.dots = null; e.slowLeft = 0; continue; }
    if (e.slowLeft > 0) e.slowLeft = Math.max(0, e.slowLeft - dt);
    if (!e.dots?.length) continue;
    for (const dot of e.dots) {
      dot.left -= dt;
      dot.acc += dt;
      while (dot.acc >= DOT_STEP && e.hp > 0) {
        dot.acc -= DOT_STEP;
        damageEnemy(state, e, { amount: dot.dps * DOT_STEP, crit: false, color: DOT_COLORS[dot.kind] });
      }
    }
    e.dots = e.dots.filter((d) => d.left > 0 && e.hp > 0);
  }
}

export function updateEffects(state, dt) {
  for (const list of [state.effects, state.floaters]) {
    for (const f of list) f.t += dt;
  }
  state.effects = state.effects.filter((f) => f.t < f.dur);
  state.floaters = state.floaters.filter((f) => f.t < f.dur);
}
