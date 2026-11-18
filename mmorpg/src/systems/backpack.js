import { MAX_STACK } from '../sim/loot.js';

export const INV_SIZE = 40; // 8 x 5

export function emptyInventory() {
  return new Array(INV_SIZE).fill(null);
}

const sameStack = (a, b) => a && b && a.slot === 'ammo' && b.slot === 'ammo' && a.id === b.id;

// Can this item be put in without losing any of it?
export function fitsInBackpack(inventory, item) {
  if (item.slot !== 'ammo') return inventory.includes(null);
  let room = inventory.includes(null) ? MAX_STACK : 0;
  for (const cell of inventory) if (sameStack(cell, item)) room += MAX_STACK - cell.count;
  return room >= item.count;
}

// Puts an item in the first free cell. Ammo is added to stacks of the same kind first (up to MAX_STACK each).
// Returns the cell it ended up in, or -1 when there is no room (then nothing is changed).
export function addToBackpack(inventory, item) {
  if (!fitsInBackpack(inventory, item)) return -1;
  if (item.slot !== 'ammo') {
    const i = inventory.indexOf(null);
    inventory[i] = item;
    return i;
  }
  let left = item.count;
  let last = -1;
  inventory.forEach((cell, i) => {
    if (left > 0 && sameStack(cell, item) && cell.count < MAX_STACK) {
      const moved = Math.min(left, MAX_STACK - cell.count);
      cell.count += moved;
      left -= moved;
      last = i;
    }
  });
  if (left > 0) {
    last = inventory.indexOf(null);
    inventory[last] = { ...item, count: left };
  }
  return last;
}
