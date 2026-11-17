export const MAX_PLUS = 5;
const SELL_RATE = 0.4;
const RARITY_PRICE = { common: 1, uncommon: 1.3, rare: 1.8, epic: 3, legendary: 6 };
const FLAT_SCORE = { maxHp: 0.8, regen: 12, lifeOnKill: 6, defense: 5 }; // gold value of one point of a flat stat (defense as on armor)
const PCT_SCORE = 400; // gold value of +100% of a percentage stat

// A rough "power" of the item in gold, built from its (already rarity- and plus-scaled) stats.
export function itemScore(item) {
  if (item.slot === 'ammo') return item.count * item.unit;
  if (item.slot === 'weapon') return item.damage / item.cooldown;
  if (item.slot === 'armor') return item.defense * 5;
  return item.kind === 'pct' ? item.value * PCT_SCORE : item.value * (FLAT_SCORE[item.stat] ?? 1);
}

function listPrice(item) {
  if (item.relic) return item.price ?? 100; // a relic of the old world has its own price
  if (item.slot === 'ammo') return Math.max(5, Math.round(item.count * item.unit)); // a stack costs what its shots cost
  return Math.max(5, Math.round(itemScore(item) * (RARITY_PRICE[item.rarity] ?? 1)));
}

// Charisma bargains: buying is cheaper and selling dearer, by up to this much either way.
export const MAX_BARTER = 0.3;
const barterOf = (player) => Math.max(-MAX_BARTER, Math.min(MAX_BARTER, player?.stats?.barter ?? 0));

// What a merchant asks for the item (from this hero, if one is given).
export function itemPrice(item, player = null) {
  return Math.max(1, Math.round(listPrice(item) * (1 - barterOf(player))));
}

export function sellPrice(item, player = null) {
  return Math.max(1, Math.floor(listPrice(item) * SELL_RATE * (1 + barterOf(player))));
}

export function upgradeCost(item) {
  return Math.round(listPrice(item) * 0.5 + 30 * ((item.plus | 0) + 1));
}
