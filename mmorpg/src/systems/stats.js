import { wornItems } from './equipment.js';
import { addAttrStats } from './attributes.js';

export const BASE_HP = 100;
export const HP_PER_LEVEL = 10;

export function computeStats(player, skills, attrDefs = null) {
  const s = {
    damage: 0, meleeDamage: 0, rangedDamage: 0, attackSpeed: 0, moveSpeed: 0, maxHp: 0, regen: 0,
    critChance: 0.05, critDamage: 0, rollCooldown: 0, aoeRadius: 0, lifeOnKill: 0, defense: 0,
    // from the attributes (data/attributes.json): shorter daze and drag, sight in tiles, shot range, better loot,
    // more gold, better prices, bigger quest rewards
    toughness: 0, sight: 0, range: 0, rarityLuck: 0, goldFind: 0, barter: 0, rewardBonus: 0,
  };
  addAttrStats(s, player, attrDefs);
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
  p.stats = computeStats(p, state.skills, state.attrDefs);
  p.maxHp = BASE_HP + HP_PER_LEVEL * (p.level - 1) + p.stats.maxHp;
  p.hp = Math.min(p.hp, p.maxHp);
}
