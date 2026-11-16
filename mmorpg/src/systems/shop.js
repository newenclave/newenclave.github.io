import { mulberry32 } from '../core/rng.js';
import { buildItem, rollItem, rollItemMin } from '../sim/loot.js';
import { tierAtTile } from './difficulty.js';
import { itemPrice, sellPrice, upgradeCost, MAX_PLUS } from './economy.js';
import { recalcStats } from './stats.js';
import { addToBackpack, fitsInBackpack } from './backpack.js';

export const STOCK_SIZE = 10;

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// Same town, same seed -> same shelves (until you buy something). A bigger town has more goods, a city no poor ones
// (`services` of the town: { stock, minRarity }).
// `slots`: only these kinds of goods (a market trader sells one kind).
// `tier`: the danger tier of the town (what its people can get hold of).
export function makeStock(catalog, seed, townId, services = null, slots = null, tier = 2) {
  const rng = mulberry32(hashString(`${seed}:${townId}`));
  const size = services?.stock ?? STOCK_SIZE;
  const min = services?.minRarity;
  const goods = slots ? Object.fromEntries(slots.map((s) => [s, catalog[s]])) : catalog;
  return Array.from({ length: size }, () => (min ? rollItemMin(goods, min, rng, tier) : rollItem(goods, rng, tier)));
}

// What each market trader sells, and how much of it.
export const WARE_SLOTS = { fletcher: ['ammo'], jeweler: ['accessory'], armorer: ['armor'], weaponsmith: ['weapon'] };
const TRADER_STOCK = 8;

// The shop of a town's merchant, or of one of its market traders (`npc` with a `ware`): each keeps its own shelves.
export function openShop(state, town, npc = null) {
  state.shops ??= new Map();
  const ware = npc?.ware && WARE_SLOTS[npc.ware] ? npc.ware : null;
  const id = ware ? `${town.id}:${ware}` : town.id;
  if (!state.shops.has(id)) {
    const services = ware ? { stock: TRADER_STOCK, minRarity: town.services?.minRarity ?? null } : town.services;
    state.shops.set(id, { stock: makeStock(state.catalog, state.seed, id, services, ware ? WARE_SLOTS[ware] : null, town.tier ?? tierAtTile(town.tx, town.ty, state.world)) });
  }
  state.shop = state.shops.get(id);
}

export function buyStock(state, idx) {
  const item = state.shop?.stock[idx];
  if (!item) return { error: 'none' };
  const price = itemPrice(item);
  if (state.player.gold < price) return { error: 'gold' };
  if (!fitsInBackpack(state.inventory, item)) return { error: 'full' };
  state.player.gold -= price;
  addToBackpack(state.inventory, item);
  state.shop.stock[idx] = null;
  return { ok: true };
}

export function sellFromInventory(state, idx) {
  const item = state.inventory[idx];
  if (!item) return { error: 'none' };
  state.player.gold += sellPrice(item);
  state.inventory[idx] = null;
  return { ok: true };
}

// Upgrades the selected item (hotbar, worn or backpack) by one level.
export function upgradeSelected(state) {
  const sel = state.ui.selected;
  const p = state.player;
  if (!sel) return { error: 'none' };
  let old;
  if (sel.kind === 'inv') old = state.inventory[sel.index];
  else if (sel.kind === 'hot') old = state.weapons[sel.index];
  else if (sel.kind === 'off') old = state.offhands?.[sel.index];
  else if (sel.kind === 'eq') old = p.equipment[sel.slot];
  if (!old || old.slot === 'ammo') return { error: 'none' }; // ammo cannot be upgraded
  if ((old.plus | 0) >= MAX_PLUS) return { error: 'max' };
  const cost = upgradeCost(old);
  if (p.gold < cost) return { error: 'gold' };
  const base = state.catalog[old.slot].find((b) => b.id === old.id);
  if (!base) return { error: 'none' };

  const upgraded = buildItem(old.slot, base, old.rarity, (old.plus | 0) + 1);
  p.gold -= cost;
  if (sel.kind === 'inv') state.inventory[sel.index] = upgraded;
  else if (sel.kind === 'hot') {
    state.weapons[sel.index] = upgraded;
    if (p.weapon === old) p.weapon = upgraded;
  } else if (sel.kind === 'off') {
    state.offhands[sel.index] = upgraded;
  } else {
    p.equipment[sel.slot] = upgraded;
    recalcStats(state);
  }
  return { ok: true };
}
