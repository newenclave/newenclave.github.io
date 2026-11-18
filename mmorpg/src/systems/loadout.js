// Two hands and three weapon sets. Each set has a main hand and an off hand; keys 1-3 pick a set, Q goes to the next.
//   - a one-handed weapon next to another one-handed weapon: you fight with both (dual wielding);
//   - arrows or bolts next to a bow or crossbow: the shots carry the special effect;
//   - a two-handed weapon takes both hands.
// The inventory only lets pairs that go together into a set (canPair); the one thing that can still sit there unused is
// a second blade without the training "Two Blades". A set with nothing in the main hand fights with bare fists.
import { canDualWield } from './requirements.js';

export const SETS = 3;
export const OFFHAND_DAMAGE = 0.55; // the off hand hits a little weaker than the main hand

// What the hero hits with when the set holds no weapon: weak, close, and asks nothing. Not an item: it is never in the
// backpack, a shop or the loot.
export const FISTS = Object.freeze({
  id: 'fists', slot: 'weapon', fists: true, rarity: 'common', plus: 0,
  type: 'arc', damage: 5, cooldown: 0.4, recover: 0.15, moveMult: 0.8, range: 40, arc: 80,
  color: '#e0b896', reach: 'ground', grip: 'one',
});

export const emptySets = () => Array.from({ length: SETS }, () => null);

// Which set is in your hands. The main hand's weapon tells (so it stays right when something sets player.weapon
// directly); with bare fists it is the remembered one.
export function slotOf(state, weapon = state.player.weapon) {
  const at = weapon && !weapon.fists ? state.weapons?.indexOf(weapon) ?? -1 : -1;
  if (at >= 0) return at;
  const n = state.weapons?.length ?? 0;
  return n ? Math.min(n - 1, Math.max(0, state.activeSet | 0)) : -1;
}

// After anything changed in the sets: the hand holds what the active set holds, or fists.
export function syncHands(state, set = slotOf(state)) {
  state.activeSet = Math.max(0, set);
  state.player.weapon = state.weapons?.[state.activeSet] ?? FISTS;
}

// Take up a set (keys 1-3, a tab in the inventory); an empty one means fists.
export function selectSet(state, set) {
  if (!(set >= 0 && set < (state.weapons?.length ?? 0))) return false;
  syncHands(state, set);
  return true;
}

// The next set round the circle (Q, the touch button "Swap").
export const nextSet = (state) => selectSet(state, (slotOf(state) + 1) % state.weapons.length);

export const offhandOf = (state, slot = slotOf(state)) => (slot >= 0 ? state.offhands?.[slot] ?? null : null);

// Can this item be held in an off hand at all?
export const canEquipOffhand = (item) => !!item && (item.slot === 'ammo' || (item.slot === 'weapon' && item.grip === 'one'));

// Do these two go in one set? null when they do, else why not: 'fit' (not an off-hand thing), 'twoHanded' (the main
// weapon takes both hands), 'ammoKind' (ammo that the main weapon does not shoot).
export function pairError(main, off) {
  if (!off) return null;
  if (!canEquipOffhand(off)) return 'fit';
  if (off.slot === 'ammo') return main && !main.fists && main.ammoKind === off.kind ? null : 'ammoKind';
  if (main && main.grip !== 'one') return 'twoHanded';
  return null;
}
export const canPair = (main, off) => pairError(main, off) === null;

// What the hands do: { main, off, mode, reason }. Without a slot it is about the weapon in your hand now.
//   mode: 'single' (nothing in the off hand), 'dual', 'ammo', or 'idle' (the off hand item cannot be used with this main weapon)
//   reason (for 'idle'): 'twoHanded' | 'wrongAmmo' | 'noQuiver' | 'untrained' (two weapons need the training "Two Blades")
export function loadoutOf(state, slot) {
  const main = slot === undefined ? state.player.weapon : state.weapons[slot];
  const off = offhandOf(state, slot === undefined ? slotOf(state) : slot);
  if (!off) return { main, off: null, mode: 'single' };
  if (!main || main.fists) return { main: main ?? null, off, mode: 'idle', reason: 'noQuiver' }; // an empty set: nothing to use the off hand with
  if (off.slot === 'ammo') {
    if (main.ammoKind === off.kind) return { main, off, mode: 'ammo' };
    return { main, off, mode: 'idle', reason: main.ammoKind ? 'wrongAmmo' : 'noQuiver' };
  }
  if (main.grip === 'one' && off.grip === 'one') return canDualWield(state) ? { main, off, mode: 'dual' } : { main, off, mode: 'idle', reason: 'untrained' };
  return { main, off, mode: 'idle', reason: 'twoHanded' };
}
