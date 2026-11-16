// Two hands. The main hand holds the weapon you chose (keys 1-6). Each of those six slots has its own off hand:
//   - a one-handed weapon next to another one-handed weapon: you fight with both (dual wielding);
//   - arrows or bolts next to a bow or crossbow: the shots carry the special effect;
//   - anything else is "not in use" until the main hand changes.
export const OFFHAND_DAMAGE = 0.65; // the off hand hits a little weaker than the main hand

// Which hotbar slot the main-hand weapon is in (-1 when it is not from the hotbar).
export const slotOf = (state, weapon = state.player.weapon) => state.weapons?.indexOf(weapon) ?? -1;

export const offhandOf = (state, slot = slotOf(state)) => (slot >= 0 ? state.offhands?.[slot] ?? null : null);

// Can this item be held in an off hand at all?
export const canEquipOffhand = (item) => !!item && (item.slot === 'ammo' || (item.slot === 'weapon' && item.grip === 'one'));

// What the hands do: { main, off, mode, reason }. Without a slot it is about the weapon in your hand now.
//   mode: 'single' (nothing in the off hand), 'dual', 'ammo', or 'idle' (the off hand item cannot be used with this main weapon)
//   reason (for 'idle'): 'twoHanded' | 'wrongAmmo' | 'noQuiver'
export function loadoutOf(state, slot) {
  const main = slot === undefined ? state.player.weapon : state.weapons[slot];
  const off = offhandOf(state, slot === undefined ? slotOf(state) : slot);
  if (!off) return { main, off: null, mode: 'single' };
  if (!main) return { main: null, off, mode: 'idle', reason: 'noQuiver' }; // an empty set: nothing to use the off hand with
  if (off.slot === 'ammo') {
    if (main.ammoKind === off.kind) return { main, off, mode: 'ammo' };
    return { main, off, mode: 'idle', reason: main.ammoKind ? 'wrongAmmo' : 'noQuiver' };
  }
  if (main.grip === 'one' && off.grip === 'one') return { main, off, mode: 'dual' };
  return { main, off, mode: 'idle', reason: 'twoHanded' };
}
