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

export function itemPrice(item) {
  if (item.relic) return item.price ?? 100; // a relic of the old world has its own price
  if (item.slot === 'ammo') return Math.max(5, Math.round(item.count * item.unit)); // a stack costs what its shots cost
  return Math.max(5, Math.round(itemScore(item) * (RARITY_PRICE[item.rarity] ?? 1)));
}

export function sellPrice(item) {
  return Math.max(1, Math.floor(itemPrice(item) * SELL_RATE));
}

export function upgradeCost(item) {
  return Math.round(itemPrice(item) * 0.5 + 30 * ((item.plus | 0) + 1));
}
