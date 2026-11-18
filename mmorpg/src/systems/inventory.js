import { makeDrop, MAX_STACK } from '../sim/loot.js';
import { canUse } from './requirements.js';
import { recalcStats } from './stats.js';
import { buyStock, sellFromInventory, upgradeSelected } from './shop.js';
import { buyBoat } from './boat.js';
import { addToBackpack, INV_SIZE, emptyInventory } from './backpack.js';
import { canEquipOffhand, pairError, selectSet, slotOf, syncHands } from './loadout.js';
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

// ---------------------------------------------------------------- moving things between places
// A place: { kind: 'inv', index } (a backpack cell; without an index, wherever it fits), { kind: 'eq', slot } (on the
// body), { kind: 'hot', index } (the main hand of a weapon set), { kind: 'off', index } (its off hand) or
// { kind: 'ground' }.
export function itemAt(state, at) {
  if (at.kind === 'inv') return state.inventory[at.index] ?? null;
  if (at.kind === 'eq') return state.player.equipment[at.slot] ?? null;
  if (at.kind === 'hot') return state.weapons?.[at.index] ?? null;
  if (at.kind === 'off') return state.offhands?.[at.index] ?? null;
  return null;
}

function putAt(state, at, item) {
  if (at.kind === 'inv') state.inventory[at.index] = item;
  else if (at.kind === 'eq') state.player.equipment[at.slot] = item;
  else if (at.kind === 'hot') state.weapons[at.index] = item;
  else if (at.kind === 'off') state.offhands[at.index] = item;
}

function validPlace(state, at) {
  if (!at) return false;
  if (at.kind === 'inv') return at.index === undefined || (at.index >= 0 && at.index < state.inventory.length);
  if (at.kind === 'eq') return at.slot in state.player.equipment;
  if (at.kind === 'hot' || at.kind === 'off') return at.index >= 0 && at.index < (state.weapons?.length ?? 0);
  return at.kind === 'ground';
}

// Can this item go to that place at all? null when it can, else the reason.
export function fitError(state, item, at) {
  if (!item || at.kind === 'inv' || at.kind === 'ground') return null;
  if (at.kind === 'eq') {
    if (!placesFor(item).includes(at.slot)) return 'fit';
    return canUse(state, item) ? null : 'req'; // too heavy for you yet (systems/requirements.js)
  }
  if (at.kind === 'hot') return item.slot === 'weapon' ? null : 'fit';
  return canEquipOffhand(item) ? null : 'fit';
}

// Everything a move can change, to put it back.
function snapshot(state) {
  return {
    inventory: [...state.inventory], weapons: [...state.weapons], offhands: [...state.offhands], set: slotOf(state),
    equipment: { ...state.player.equipment }, drops: state.drops.length, counts: state.inventory.map((c) => c?.count),
  };
}
function restore(state, before) {
  state.inventory = before.inventory;
  before.counts.forEach((n, i) => { if (state.inventory[i]?.slot === 'ammo') state.inventory[i].count = n; });
  state.weapons = before.weapons;
  state.offhands = before.offhands;
  state.player.equipment = before.equipment;
  state.drops.length = before.drops;
  syncHands(state, before.set);
}

// Would this move work? The same answer as moveItem, with nothing changed (the window lights the places up green or red
// while you carry something).
export function tryMove(state, from, to) {
  const before = snapshot(state);
  const p = state.player;
  const kept = { stats: p.stats, hp: p.hp, maxHp: p.maxHp, mana: p.mana, maxMana: p.maxMana }; // recalcStats changes these
  const r = moveItem(state, from, to);
  restore(state, before);
  Object.assign(p, kept);
  return r;
}

const samePlace = (a, b) => a.kind === b.kind && a.index === b.index && a.slot === b.slot;
const sameStack = (a, b) => a && b && a.slot === 'ammo' && b.slot === 'ammo' && a.id === b.id;

// Moves an item from one place to another. What was there goes back where the item came from (a swap), or, when it
// cannot go there, to the backpack. The two hands of a set are kept a pair that goes together: a two-handed weapon
// sends the off hand to the backpack, so does a bow taken off (its arrows), and a lone off-hand weapon moves to the main
// hand. Everything or nothing: { ok: true } or { error: 'none' | 'fit' | 'req' | 'twoHanded' | 'ammoKind' | 'full' }.
export function moveItem(state, from, to) {
  if (!validPlace(state, from) || !validPlace(state, to) || from.kind === 'ground' || (from.kind === 'inv' && from.index === undefined)) return { error: 'none' };
  const item = itemAt(state, from);
  if (!item) return { error: 'none' };
  if (samePlace(from, to)) return { ok: true };
  const set = slotOf(state); // the set in your hands stays the set in your hands
  const before = snapshot(state);
  const undo = (error) => {
    restore(state, before);
    return { error };
  };

  const fit = fitError(state, item, to);
  if (fit) return { error: fit };
  putAt(state, from, null);
  if (to.kind === 'ground') {
    const p = state.player; // placed outside the pickup radius and ignored for a moment so it is not instantly re-collected
    state.drops.push(makeDrop(p.x + p.facing.x * 60, p.y + p.facing.y * 60, item, 1.5));
  } else if (to.kind === 'inv' && to.index === undefined) {
    if (addToBackpack(state.inventory, item) < 0) return undo('full');
  } else {
    const other = itemAt(state, to);
    if (to.kind === 'inv' && sameStack(other, item)) { // ammo onto the same ammo: one stack, the rest stays where it was
      const moved = Math.min(item.count, MAX_STACK - other.count);
      other.count += moved;
      if (item.count > moved) putAt(state, from, { ...item, count: item.count - moved });
    } else {
      putAt(state, to, item);
      if (other) {
        if (!fitError(state, other, from)) putAt(state, from, other); // a swap
        else if (addToBackpack(state.inventory, other) < 0) return undo('full');
      }
    }
  }
  // the hands of every set that was touched
  for (const s of new Set([from, to].filter((at) => at.kind === 'hot' || at.kind === 'off').map((at) => at.index))) {
    if (!state.weapons[s] && state.offhands[s]?.slot === 'weapon') { // a lone blade goes to the main hand
      state.weapons[s] = state.offhands[s];
      state.offhands[s] = null;
    }
    const why = pairError(state.weapons[s], state.offhands[s]);
    if (!why) continue;
    if (to.kind === 'off' && to.index === s) return undo(why); // you asked for this pair: it does not go together
    const off = state.offhands[s]; // it came out of a change of the main hand: the off hand goes to the backpack
    state.offhands[s] = null;
    if (addToBackpack(state.inventory, off) < 0) return undo('full');
  }
  if (from.kind === 'eq' || to.kind === 'eq') recalcStats(state);
  syncHands(state, set);
  return { ok: true };
}

// Equipping swaps in place, so the inventory never overflows.
// A weapon goes to the main hand: of the set in your hands if it is empty, else of the first empty set, else it
// replaces the one you hold; then that set is in your hands. Ammo goes to the off hand. Armor and jewellery go where
// they fit on the body (a ring or a bracelet to a free hand first). `place` forces one of the places it fits.
// `why.error` says what stopped it.
export function equipFromInventory(state, idx, place = null, why = {}) {
  const item = state.inventory[idx];
  if (!item) return false;
  if (item.slot === 'ammo') return equipOffhand(state, idx, why); // ammo only goes to the off hand
  let r;
  if (item.slot === 'weapon') {
    const active = slotOf(state);
    const empty = state.weapons.indexOf(null);
    const set = !state.weapons[active] ? active : empty >= 0 ? empty : active;
    r = moveItem(state, { kind: 'inv', index: idx }, { kind: 'hot', index: set });
    if (r.ok) selectSet(state, set);
  } else {
    const to = place && placesFor(item).includes(place) ? place : placeFor(state.player.equipment, item);
    r = to ? moveItem(state, { kind: 'inv', index: idx }, { kind: 'eq', slot: to }) : { error: 'fit' };
  }
  why.error = r.error;
  return !!r.ok;
}

// Moves a one-handed weapon or a stack of ammo from the backpack to the off hand of the set in your hands. What was
// there goes back to the same cell. Arrows only go next to a bow, bolts next to a crossbow, nothing next to a
// two-handed weapon: `why.error` gets the reason when it does not go.
export function equipOffhand(state, idx, why = {}) {
  const set = slotOf(state);
  const r = set < 0 ? { error: 'none' } : moveItem(state, { kind: 'inv', index: idx }, { kind: 'off', index: set });
  why.error = r.error;
  return !!r.ok;
}

export function unequipOffhand(state, slot) {
  return !!moveItem(state, { kind: 'off', index: slot }, { kind: 'inv' }).ok;
}

// Takes the weapon of a set off (to the backpack): that set fights with bare fists.
export function unequipMain(state, slot) {
  return !!moveItem(state, { kind: 'hot', index: slot }, { kind: 'inv' }).ok;
}

export function unequip(state, slot) {
  return !!moveItem(state, { kind: 'eq', slot }, { kind: 'inv' }).ok;
}

export function dropFromInventory(state, idx) {
  return !!moveItem(state, { kind: 'inv', index: idx }, { kind: 'ground' }).ok;
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
      if (mode === 'inventory' && state.weapons[region.index]) selectSet(state, region.index);
      return {};
    case 'set': // a tab of the weapon sets: take that set up (an empty one: fists)
      selectSet(state, region.index);
      if (sel?.kind === 'hot' || sel?.kind === 'off') ui.selected = null;
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
    case 'offaction': { // the "Off hand" button: put the selected backpack item in the off hand
      const why = {};
      if (mode === 'inventory' && sel?.kind === 'inv' && !equipOffhand(state, sel.index, why)) return { error: why.error };
      return {};
    }
    case 'boat': {
      const r = buyBoat(state); // the merchant's boat counter (merchant mode only)
      return r.error === 'gold' ? { error: 'gold' } : {};
    }
    case 'inv':
      if (mode === 'inventory' && sel?.kind === 'inv' && sel.index === region.index && state.inventory[region.index]) {
        const why = {}; // second click equips
        if (!equipFromInventory(state, region.index, null, why)) return { error: why.error };
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
  if (sel.kind === 'inv') {
    const why = {};
    return equipFromInventory(state, sel.index, null, why) ? {} : { error: why.error };
  }
  if (sel.kind === 'eq') return unequip(state, sel.slot) ? {} : { error: 'full' };
  if (sel.kind === 'off') return unequipOffhand(state, sel.index) ? {} : { error: 'full' };
  if (sel.kind === 'hot') return unequipMain(state, sel.index) ? {} : { error: 'full' }; // the set fights with fists
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
    const price = sellPrice(item, state.player);
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
    const why = {};
    return equipFromInventory(state, region.index, null, why) ? {} : { error: why.error };
  }
  if (region.kind === 'hot' && state.weapons?.[region.index]) return unequipMain(state, region.index) ? {} : { error: 'full' };
  if (region.kind === 'eq' && state.player.equipment[region.slot]) return unequip(state, region.slot) ? {} : { error: 'full' };
  if (region.kind === 'off' && state.offhands?.[region.index]) return unequipOffhand(state, region.index) ? {} : { error: 'full' };
  return {};
}

// An item dragged from one place and let go over another (ui/inventory-ui.js finds the places): `to` null is outside
// the window, which drops it on the ground. At the merchant, from the stock to the backpack buys and from the backpack
// to the stock sells; the blacksmith only lets you sort. Returns {} or { error } like a click, or { sold, price }.
export function dragItem(state, from, to) {
  const ui = state.ui;
  const mode = ui.mode ?? 'inventory';
  if (!from || ['action', 'offaction', 'drop', 'boat', 'set', 'close'].includes(from.kind)) return {};
  if (to && samePlace(from, to)) return {};
  if (from.kind === 'stock') {
    if (mode !== 'merchant' || to?.kind !== 'inv') return {};
    ui.selected = { kind: 'stock', index: from.index };
    return runAction(state, mode, ui.selected);
  }
  if (mode === 'merchant' && from.kind === 'inv' && to?.kind === 'stock') return quickAction(state, from); // sell (precious things ask twice)
  if (!to) {
    if (mode !== 'inventory') return {};
    to = { kind: 'ground' };
  }
  if (!['inv', 'eq', 'hot', 'off', 'ground'].includes(to.kind)) return {};
  if (mode !== 'inventory' && to.kind !== 'inv') return {}; // in a shop the body and the hands are not shown
  const r = moveItem(state, from, to);
  if (r.error) return { error: r.error };
  ui.selected = to.kind === 'ground' ? null : to.kind === 'eq' ? { kind: 'eq', slot: to.slot } : { kind: to.kind, index: to.index };
  if (!itemAt(state, to)) ui.selected = null; // ammo that merged, or a lone blade that moved to the main hand
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
