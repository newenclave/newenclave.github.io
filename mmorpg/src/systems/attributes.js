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

// ---- making a hero (ui/create-ui.js): a draft of the attributes, spent from CREATE_POINTS, between MIN and CREATE_MAX
export const CREATE_SKILL_POINTS = 2; // skill points a new hero starts with

export const newDraft = () => ({ attrs: baseAttrs(), sel: ATTRS[0] });

// Points still free in the draft: lowering an attribute below the base frees points for others.
export const draftLeft = (draft) => CREATE_POINTS - ATTRS.reduce((sum, id) => sum + draft.attrs[id] - BASE, 0);

export function canAdjust(draft, id, d) {
  if (!ATTRS.includes(id)) return false;
  const v = draft.attrs[id] + d;
  return v >= MIN && v <= CREATE_MAX && (d < 0 || draftLeft(draft) >= d);
}

export function adjustDraft(draft, id, d) {
  if (!canAdjust(draft, id, d)) return false;
  draft.attrs[id] += d;
  draft.sel = id;
  return true;
}

// The hero is made: the draft becomes the attributes, points left over stay to spend later.
export function finishCreation(state, draft) {
  const p = state.player;
  p.attrs = { ...draft.attrs };
  p.attrPoints = Math.max(0, draftLeft(draft));
  p.skillPoints = (p.skillPoints | 0) + CREATE_SKILL_POINTS;
  recalcStats(state);
  p.hp = p.maxHp;
}
