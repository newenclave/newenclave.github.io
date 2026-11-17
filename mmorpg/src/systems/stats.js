import { wornItems } from './equipment.js';
import { addAttrStats, ATTRS, baseAttrs } from './attributes.js';
import { learnedSet } from './skilltree.js';

export const BASE_HP = 100;
export const HP_PER_LEVEL = 10;
// Mana (docs/character.md, section 2): 30 and 3.5 a second at intellect 3; each point of intellect adds 10 and 0.5.
export const BASE_MANA = 30;
export const BASE_MANA_REGEN = 3.5;

// Everything the hero adds up to: the skill web, the gear, and the attributes (the ones spent plus those the web adds).
export function computeStats(player, web, attrDefs = null) {
  const s = {
    damage: 0, meleeDamage: 0, rangedDamage: 0, spellDamage: 0, attackSpeed: 0, moveSpeed: 0, maxHp: 0, regen: 0,
    critChance: 0.05, critDamage: 0, rollCooldown: 0, aoeRadius: 0, lifeOnKill: 0, defense: 0,
    // from the attributes (data/attributes.json): shorter daze and drag, sight in tiles, shot range, better loot,
    // more gold, better prices, bigger quest rewards
    toughness: 0, sight: 0, range: 0, rarityLuck: 0, goldFind: 0, barter: 0, rewardBonus: 0,
    maxMana: 0, manaRegen: BASE_MANA_REGEN,
    // from notable skills of the web (systems/skilltree.js)
    openDamage: 0, skirmish: 0, arrowInt: 0, manaOnCrit: 0, dualAttackSpeed: 0,
    grants: [], // kinds of weapons the hero is trained in
    rules: [], // keystones: rules the hero plays by
    attrs: { ...baseAttrs(), ...(player.attrs ?? {}) }, // the attributes with what the web adds
  };
  for (const id of learnedSet(player)) {
    const node = web?.index.get(id);
    if (!node) continue;
    for (const e of node.effects ?? []) {
      if (ATTRS.includes(e.stat)) s.attrs[e.stat] += e.value;
      else s[e.stat] = (s[e.stat] ?? 0) + e.value;
    }
    for (const g of node.grants ?? []) if (!s.grants.includes(g)) s.grants.push(g);
    if (node.rule && !s.rules.includes(node.rule)) s.rules.push(node.rule);
  }
  for (const item of wornItems(player.equipment)) { // armor adds defense, jewellery its bonus
    if (item.slot === 'armor') s.defense += item.defense;
    else s[item.stat] += item.value;
  }
  addAttrStats(s, s.attrs, attrDefs);
  return s;
}

export function recalcStats(state) {
  const p = state.player;
  p.stats = computeStats(p, state.web, state.attrDefs);
  p.maxHp = BASE_HP + HP_PER_LEVEL * (p.level - 1) + p.stats.maxHp;
  p.hp = Math.min(p.hp, p.maxHp);
  // blood magic (a keystone): spells are paid in health, and there is no mana at all
  p.maxMana = p.stats.rules.includes('bloodMagic') ? 0 : Math.max(0, Math.round(BASE_MANA + p.stats.maxMana));
  p.mana = Math.min(p.mana ?? p.maxMana, p.maxMana); // a new hero starts full
}
