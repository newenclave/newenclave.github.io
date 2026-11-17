// The hero's seven attributes (docs/character.md): strength, dexterity, endurance, intellect, perception, luck,
// charisma. There are no classes: a hero is what these and the skill web make of them.
// Every attribute starts at BASE, and its effects count from there: a hero with 3 everywhere plays as before,
// a stronger attribute adds, a weaker one takes away. What each point gives is in data/attributes.json; how much
// a weapon gains from an attribute is that weapon's `scale` (data/weapons.json).
import { recalcStats } from './stats.js';

export const ATTRS = ['str', 'dex', 'end', 'int', 'per', 'lck', 'cha'];
export const BASE = 3;
export const MIN = 1; // when the hero is made, an attribute can go this low to free points for others
export const CREATE_MAX = 10; // and no higher than this
export const MAX = 20; // the most an attribute can reach with points from levels
export const CREATE_POINTS = 12; // free points when the hero is made
export const PER_LEVEL = 1; // attribute points for each level

export const baseAttrs = () => Object.fromEntries(ATTRS.map((a) => [a, BASE]));

export const attrOf = (player, id) => player?.attrs?.[id] ?? BASE;

// Points above (or below) the base: what the effects are counted from.
export const attrBonus = (player, id) => attrOf(player, id) - BASE;

export function canRaise(player, id) {
  return ATTRS.includes(id) && (player.attrPoints | 0) > 0 && attrOf(player, id) < MAX;
}

export function raiseAttr(state, id) {
  const p = state.player;
  if (!canRaise(p, id)) return false;
  p.attrs = { ...baseAttrs(), ...p.attrs, [id]: attrOf(p, id) + 1 };
  p.attrPoints -= 1;
  recalcStats(state);
  return true;
}

// How much a weapon's damage grows from the hero's attributes: the sum of scale x points above the base.
export function scaleBonus(player, weapon) {
  let k = 0;
  for (const [id, per] of Object.entries(weapon?.scale ?? {})) k += per * attrBonus(player, id);
  return k;
}

// The attributes' share of the stats (stats.js adds it to the skill web's and the gear's).
export function addAttrStats(s, player, defs) {
  for (const def of defs ?? []) {
    const n = attrBonus(player, def.id);
    if (!n) continue;
    for (const e of def.effects) s[e.stat] = (s[e.stat] ?? 0) + e.value * n;
  }
}
