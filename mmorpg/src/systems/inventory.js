import { makeDrop } from '../sim/loot.js';
import { recalcStats } from './stats.js';
import { buyStock, sellFromInventory, upgradeSelected } from './shop.js';
import { buyBoat } from './boat.js';
import { addToBackpack, INV_SIZE, emptyInventory } from './backpack.js';
import { canEquipOffhand, slotOf } from './loadout.js';
import { placeFor, placesFor } from './equipment.js';
import { sellPrice } from './economy.js';

export { INV_SIZE, emptyInventory };
const PICKUP_RADIUS = 28;
const DROP_LIFETIME = 60;
const FULL_WARN_INTERVAL = 3;

// Puts an item in the backpack (ammo joins the stacks it fits). Returns the cell, or -1 when there is no room.
export function addToInventory(state, item) {
  return addToBackpack(state.inventory, item);
}

// Equipping swaps in place, so the inventory never overflows.
// A weapon replaces the main hand of the active weapon set; armor and jewellery go where they fit on the body (a ring
// or a bracelet to a free hand first). `place` forces one of the places it fits.
export function equipFromInventory(state, idx, place = null) {
  const item = state.inventory[idx];
  if (!item) return false;
  const p = state.player;
  if (item.slot === 'ammo') return equipOffhand(state, idx); // ammo only goes to the off hand
  if (item.slot === 'weapon') { // to an empty set if there is one (you keep what you hold), else into the active set
    const empty = state.weapons.indexOf(null);
    const hot = empty >= 0 ? empty : state.weapons.indexOf(p.weapon);
    state.inventory[idx] = state.weapons[hot];
    state.weapons[hot] = item;
    p.weapon = item;
    return true;
  }
  const to = place && placesFor(item).includes(place) ? place : placeFor(p.equipment, item);
  if (!to) return false;
  state.inventory[idx] = p.equipment[to];
  p.equipment[to] = item;
  recalcStats(state);
  return true;
}

// Moves a one-handed weapon or a stack of ammo from the backpack to the off hand of the current hotbar slot.
// What was there goes back to the same cell.
export function equipOffhand(state, idx) {
  const item = state.inventory[idx];
  const slot = slotOf(state);
  if (!canEquipOffhand(item) || slot < 0) return false;
  state.inventory[idx] = state.offhands[slot];
  state.offhands[slot] = item;
  return true;
}

export function unequipOffhand(state, slot) {
  const item = state.offhands?.[slot];
  if (!item || addToInventory(state, item) < 0) return false;
  state.offhands[slot] = null;
  return true;
}

export function unequip(state, slot) {
  const p = state.player;
  const item = p.equipment[slot];
  if (!item || addToInventory(state, item) < 0) return false;
  p.equipment[slot] = null;
  recalcStats(state);
  return true;
}

export function dropFromInventory(state, idx) {
  const item = state.inventory[idx];
  if (!item) return false;
  state.inventory[idx] = null;
  const p = state.player;
  // placed outside the pickup radius and ignored for a moment so it is not instantly re-collected
  state.drops.push(makeDrop(p.x + p.facing.x * 60, p.y + p.facing.y * 60, item, 1.5));
  return true;
}

export function selectedItem(state) {
  const sel = state.ui.selected;
  if (!sel) return null;
  if (sel.kind === 'inv') return state.inventory[sel.index];
  if (sel.kind === 'hot') return state.weapons[sel.index];
  if (sel.kind === 'stock') return state.shop?.stock[sel.index] ?? null;
  if (sel.kind === 'off') return state.offhands?.[sel.index] ?? null;
  if (sel.kind === 'eq') return state.player.equipment[sel.slot] ?? null;
  return null;
}

// Applies a click on an inventory-panel region. The panel has three modes (state.ui.mode):
// 'inventory' (default), 'merchant' (buy from stock, sell from the backpack), 'blacksmith' (upgrade).
// Returns { error } when the action failed: 'full', 'gold', 'max' or 'none'.
export function clickInventory(state, region) {
  const ui = state.ui;
  const mode = ui.mode ?? 'inventory';
  const p = state.player;
  const sel = ui.selected;
  const select = (kind, index) => { ui.selected = { kind, index }; };
  ui.sellArmed = null; // a left click calms a sale waiting for its second right click

  switch (region.kind) {
    case 'hot':
      select('hot', region.index);
      if (mode === 'inventory' && state.weapons[region.index]) p.weapon = state.weapons[region.index];
      return {};
    case 'eq': // a place on the body
      ui.selected = { kind: 'eq', slot: region.slot };
      return {};
    case 'stock':
      select('stock', region.index);
      return {};
    case 'off':
      select('off', region.index);
      return {};
    case 'offaction': // the "Off hand" button: put the selected backpack item in the off hand
      if (mode === 'inventory' && sel?.kind === 'inv' && equipOffhand(state, sel.index)) return {};
      return {};
    case 'boat': {
      const r = buyBoat(state); // the merchant's boat counter (merchant mode only)
      return r.error === 'gold' ? { error: 'gold' } : {};
    }
    case 'inv':
      if (mode === 'inventory' && sel?.kind === 'inv' && sel.index === region.index && state.inventory[region.index]) {
        equipFromInventory(state, region.index); // second click equips
      } else {
        select('inv', region.index);
      }
      return {};
    case 'action':
      return runAction(state, mode, sel);
    case 'drop':
      if (mode === 'inventory' && sel?.kind === 'inv' && dropFromInventory(state, sel.index)) ui.selected = null;
      return {};
    default:
      return {};
  }
}

function runAction(state, mode, sel) {
  if (!sel) return {};
  if (mode === 'merchant') {
    let r = {};
    if (sel.kind === 'stock') r = buyStock(state, sel.index);
    else if (sel.kind === 'inv') r = sellFromInventory(state, sel.index);
    if (r.ok) state.ui.selected = null;
    return r.error ? { error: r.error } : {};
  }
  if (mode === 'blacksmith') {
    const r = upgradeSelected(state);
    return r.error ? { error: r.error } : {};
  }
  if (sel.kind === 'inv') equipFromInventory(state, sel.index);
  else if (sel.kind === 'eq') return unequip(state, sel.slot) ? {} : { error: 'full' };
  else if (sel.kind === 'off') return unequipOffhand(state, sel.index) ? {} : { error: 'full' };
  return {};
}

// The right mouse button (or a long touch) on a cell: the quick thing to do with it, with no button to press.
//   at the merchant: sell a backpack item (rare and better ask twice, artifacts too); buy from the stock
//   at the blacksmith: upgrade
//   in the inventory: put a backpack item on, take a worn one off
// Returns what happened: { sold, price } | { armed } | { error } | {}.
const PRECIOUS = ['epic', 'legendary'];
export function quickAction(state, region) {
  const ui = state.ui;
  const mode = ui.mode ?? 'inventory';
  const pick = (sel) => { ui.selected = sel; };
  if (mode === 'merchant') {
    if (region.kind === 'stock') {
      pick({ kind: 'stock', index: region.index });
      ui.sellArmed = null;
      return runAction(state, mode, ui.selected);
    }
    if (region.kind !== 'inv' || !state.inventory[region.index]) return {};
    const item = state.inventory[region.index];
    if ((PRECIOUS.includes(item.rarity) || item.art) && ui.sellArmed !== region.index) {
      pick({ kind: 'inv', index: region.index });
      ui.sellArmed = region.index; // the second right click sells
      return { armed: true };
    }
    ui.sellArmed = null;
    const price = sellPrice(item);
    pick({ kind: 'inv', index: region.index });
    const r = runAction(state, mode, ui.selected);
    return r.error ? r : { sold: true, price };
  }
  ui.sellArmed = null;
  if (mode === 'blacksmith') {
    if (!['inv', 'hot', 'off', 'eq'].includes(region.kind)) return {};
    pick(region.kind === 'eq' ? { kind: 'eq', slot: region.slot } : { kind: region.kind, index: region.index });
    return runAction(state, mode, ui.selected);
  }
  if (region.kind === 'inv' && state.inventory[region.index]) {
    pick({ kind: 'inv', index: region.index });
    equipFromInventory(state, region.index);
    return {};
  }
  if (region.kind === 'eq' && state.player.equipment[region.slot]) return unequip(state, region.slot) ? {} : { error: 'full' };
  if (region.kind === 'off' && state.offhands?.[region.index]) return unequipOffhand(state, region.index) ? {} : { error: 'full' };
  return {};
}

// Auto-pickup of everything that lies within reach. Armor or jewellery with a free place on the body is put on.
export function updateDrops(state, dt, onPickup, onFull) {
  const p = state.player;
  state.drops = state.drops.filter((d) => {
    d.t += dt;
    if (d.t > DROP_LIFETIME) return false;
    if (state.dead || d.t < d.delay || Math.hypot(d.x - p.x, d.y - p.y) > PICKUP_RADIUS) return true;
    const item = d.item;
    const free = placesFor(item).find((s) => !p.equipment[s]);
    if (free) {
      p.equipment[free] = item;
      recalcStats(state);
      onPickup(item);
      return false;
    }
    if (addToInventory(state, item) < 0) {
      if (d.t - d.warnT > FULL_WARN_INTERVAL) { d.warnT = d.t; onFull(); }
      return true;
    }
    onPickup(item);
    return false;
  });
}
