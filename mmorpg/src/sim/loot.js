export const RARITIES = [
  { id: 'common',    weight: 60, mult: 1.0,  color: '#bdbdbd' },
  { id: 'uncommon',  weight: 25, mult: 1.15, color: '#4caf50' },
  { id: 'rare',      weight: 10, mult: 1.35, color: '#2196f3' },
  { id: 'epic',      weight: 4,  mult: 1.6,  color: '#9c27b0' },
  { id: 'legendary', weight: 1,  mult: 2.0,  color: '#ff9800' },
];

// How likely each rarity is, by the danger tier of the place (weights for common .. legendary): near the start nothing
// better than rare drops, legendary things only far out.
export const RARITY_BY_TIER = [
  [70, 25, 5, 0, 0],
  [55, 30, 12, 3, 0],
  [40, 33, 18, 8, 1],
  [30, 32, 23, 12, 3],
  [22, 30, 26, 16, 6],
];
const tierRow = (tier) => RARITY_BY_TIER[Math.max(0, Math.min(RARITY_BY_TIER.length - 1, Math.round(tier ?? 2)))];

// Base items that can turn up at a danger tier: leather anywhere, chain from tier 1, plate from tier 2 (and so on for
// anything with a "tier" in its data). If nothing fits, anything does.
function basesFor(list, tier) {
  const fit = list.filter((b) => (b.tier ?? 0) <= (tier ?? 2));
  return fit.length ? fit : list;
}

export const SLOTS = ['weapon', 'armor', 'accessory']; // what quests may give as a reward
export const MAX_STACK = 99; // ammo comes in stacks
// What drops and what shops sell. A slot without any base items in the catalog is left out.
const SLOT_WEIGHTS = [['weapon', 0.5], ['armor', 0.22], ['accessory', 0.16], ['ammo', 0.12]];

export function rarityById(id) {
  return RARITIES.find((r) => r.id === id) ?? RARITIES[0];
}

// A rarity for a place of this danger tier (no tier: the middle of the world).
// Luck (`luck`, from the attributes) makes rare and better things that much likelier.
export function rollRarity(rng = Math.random, tier = 2, luck = 0) {
  const w = tierRow(tier).map((x, i) => (i >= 2 ? x * Math.max(0.5, 1 + luck) : x));
  let roll = rng() * w.reduce((s, x) => s + x, 0);
  for (let i = 0; i < RARITIES.length; i++) {
    roll -= w[i];
    if (roll < 0) return RARITIES[i];
  }
  return RARITIES[0];
}

const round = (v, digits) => {
  const m = 10 ** digits;
  return Math.round(v * m) / m;
};

export const PLUS_BONUS = 0.1; // each blacksmith upgrade level adds 10% to the item's stat

// Items are fully derived from (slot, base id, rarity, plus), so saves only store those four.
// A stack of arrows or bolts. A better rarity means a bigger stack.
export function buildAmmo(base, rarityId, count) {
  const r = rarityById(rarityId);
  const n = Math.round(count ?? base.count * r.mult);
  return { ...base, slot: 'ammo', rarity: r.id, plus: 0, count: Math.max(1, Math.min(MAX_STACK, n)) };
}

export function buildItem(slot, base, rarityId, plus = 0, count) {
  if (slot === 'ammo') return buildAmmo(base, rarityId, count);
  const r = rarityById(rarityId);
  const k = r.mult * (1 + PLUS_BONUS * plus);
  if (slot === 'weapon') return { ...base, slot, rarity: r.id, plus, damage: Math.round(base.damage * k) };
  if (slot === 'armor') return { ...base, slot, rarity: r.id, plus, defense: Math.round(base.defense * k) };
  return { ...base, slot, rarity: r.id, plus, value: round(base.value * k, base.kind === 'pct' ? 3 : 1) };
}

function rollSlot(catalog, rng) {
  const options = SLOT_WEIGHTS.filter(([s]) => catalog[s]?.length);
  let roll = rng() * options.reduce((sum, [, w]) => sum + w, 0);
  for (const [s, w] of options) {
    roll -= w;
    if (roll < 0) return s;
  }
  return options[options.length - 1][0];
}

// A random item for a place of this danger tier: its kind, its base (what fits the tier) and its rarity.
export function rollItem(catalog, rng = Math.random, tier = 2, luck = 0) {
  const slot = rollSlot(catalog, rng);
  const list = basesFor(catalog[slot], tier);
  const base = list[Math.floor(rng() * list.length)];
  return buildItem(slot, base, rollRarity(rng, tier, luck).id);
}

// Like rollItem, but never worse than minRarity (chests and bosses). Above it, the tier decides as usual; where the tier
// allows nothing that good, it is exactly minRarity.
export function rollItemMin(catalog, minRarity, rng = Math.random, tier = 2) {
  const from = Math.max(0, RARITIES.findIndex((r) => r.id === minRarity));
  const w = tierRow(tier).slice(from);
  const total = w.reduce((s, x) => s + x, 0);
  let rarity = RARITIES[from];
  let roll = rng() * total;
  for (let i = 0; i < w.length && total > 0; i++) {
    roll -= w[i];
    if (roll < 0) { rarity = RARITIES[from + i]; break; }
  }
  const slot = rollSlot(catalog, rng);
  const list = basesFor(catalog[slot], tier);
  return buildItem(slot, list[Math.floor(rng() * list.length)], rarity.id);
}

export function makeDrop(x, y, item, delay = 0) {
  return { x, y, item, t: 0, delay, warnT: -99 };
}

export function dropLoot(state, enemy) {
  if (Math.random() >= enemy.def.drop) return;
  state.drops.push(makeDrop(enemy.x, enemy.y, rollItem(state.catalog, Math.random, enemy.tier ?? 0, state.player?.stats?.rarityLuck ?? 0)));
}
