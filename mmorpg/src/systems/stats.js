import { wornItems } from './equipment.js';

export const BASE_HP = 100;
export const HP_PER_LEVEL = 10;

export function computeStats(player, skills) {
  const s = {
    damage: 0, meleeDamage: 0, rangedDamage: 0, attackSpeed: 0, moveSpeed: 0, maxHp: 0, regen: 0,
    critChance: 0.05, critDamage: 0, rollCooldown: 0, aoeRadius: 0, lifeOnKill: 0, defense: 0,
  };
  for (const node of skills) {
    const rank = player.ranks[node.id] | 0;
    if (!rank) continue;
    for (const e of node.effects) s[e.stat] += e.value * rank;
  }
  for (const item of wornItems(player.equipment)) { // armor adds defense, jewellery its bonus
    if (item.slot === 'armor') s.defense += item.defense;
    else s[item.stat] += item.value;
  }
  return s;
}

export function recalcStats(state) {
  const p = state.player;
  p.stats = computeStats(p, state.skills);
  p.maxHp = BASE_HP + HP_PER_LEVEL * (p.level - 1) + p.stats.maxHp;
  p.hp = Math.min(p.hp, p.maxHp);
}
