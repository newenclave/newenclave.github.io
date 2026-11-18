// The hero's seven attributes (docs/character.md): strength, dexterity, endurance, intellect, perception, luck,
// charisma. There are no classes: a hero is what these and the skill web make of them.
// Every attribute starts at BASE, and its effects count from there: a hero with 3 everywhere plays as before,
// a stronger attribute adds, a weaker one takes away. What each point gives is in data/attributes.json; how much
// a weapon gains from an attribute is that weapon's `scale` (data/weapons.json).
import { recalcStats } from './stats.js';
import { learn } from './skilltree.js';
import { buildItem } from '../sim/loot.js';

export const ATTRS = ['str', 'dex', 'end', 'int', 'per', 'lck', 'cha'];
export const BASE = 3;
export const MIN = 1; // when the hero is made, an attribute can go this low to free points for others
export const CREATE_MAX = 10; // and no higher than this
export const MAX = 20; // the most an attribute can reach with points from levels
export const CREATE_POINTS = 12; // free points when the hero is made
export const PER_LEVEL = 1; // attribute points for each level

export const baseAttrs = () => Object.fromEntries(ATTRS.map((a) => [a, BASE]));

// The points the hero has spent on an attribute, and what it comes to with what the skill web adds (stats.js).
export const ownAttr = (player, id) => player?.attrs?.[id] ?? BASE;
export const attrOf = (player, id) => player?.stats?.attrs?.[id] ?? ownAttr(player, id);

// A check of an attribute, written "cha>=6" (or "str<4"): a condition of a side story (systems/sidequests.js) or of
// an answer to a quest (`when`, systems/deeds.js). What the skill web adds counts.
const CHECK = /^(str|dex|end|int|per|lck|cha)(>=|<)(\d+)$/;
export function parseCheck(c) {
  const m = typeof c === 'string' ? CHECK.exec(c) : null;
  return m ? { id: m[1], op: m[2], n: Number(m[3]) } : null;
}
export function passesCheck(player, c) {
  const k = parseCheck(c);
  if (!k) return false;
  const v = attrOf(player, k.id);
  return k.op === '>=' ? v >= k.n : v < k.n;
}

// Points above (or below) the base: what the effects are counted from.
export const attrBonus = (player, id) => attrOf(player, id) - BASE;

export function canRaise(player, id) {
  return ATTRS.includes(id) && (player.attrPoints | 0) > 0 && ownAttr(player, id) < MAX;
}

export function raiseAttr(state, id) {
  const p = state.player;
  if (!canRaise(p, id)) return false;
  p.attrs = { ...baseAttrs(), ...p.attrs, [id]: ownAttr(p, id) + 1 };
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

// The attributes' share of the stats (`attrs`: what each attribute comes to; stats.js adds it to the rest).
export function addAttrStats(s, attrs, defs) {
  for (const def of defs ?? []) {
    const n = (attrs[def.id] ?? BASE) - BASE;
    if (!n) continue;
    for (const e of def.effects) s[e.stat] = (s[e.stat] ?? 0) + e.value * n;
  }
}

// ---- making a hero (ui/create-ui.js): a draft of the attributes, spent from CREATE_POINTS, between MIN and CREATE_MAX
export const CREATE_SKILL_POINTS = 2; // skill points a new hero starts with

export const newDraft = () => ({ attrs: baseAttrs(), sel: ATTRS[0], train: [] });

// The first skills of the web's sectors (`entry`): each trains a kind of weapon. A new hero may take up to two.
export const entriesOf = (web) => (web?.nodes ?? []).filter((n) => n.kind === 'entry');

export function toggleTraining(draft, id) {
  draft.train ??= [];
  if (draft.train.includes(id)) draft.train = draft.train.filter((x) => x !== id);
  else if (draft.train.length < CREATE_SKILL_POINTS) draft.train.push(id);
  else return false;
  return true;
}

// What a new hero gets to go with the training: a weapon to try it with (the sword is always there).
export const STARTER_KIT = { heavyArms: 'greatsword', archery: 'bow', arcane: 'wand', dualWield: 'dagger' };

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
// The training picked is learned on the web with the two skill points, and comes with a weapon to try it with.
export function finishCreation(state, draft) {
  const p = state.player;
  p.attrs = { ...draft.attrs };
  p.attrPoints = Math.max(0, draftLeft(draft));
  p.skillPoints = (p.skillPoints | 0) + CREATE_SKILL_POINTS;
  recalcStats(state);
  for (const id of draft.train ?? []) {
    if (!learn(state, id)) continue;
    for (const g of state.web.index.get(id).grants ?? []) giveStarter(state, STARTER_KIT[g]);
  }
  recalcStats(state);
  p.hp = p.maxHp;
  p.mana = p.maxMana;
}

function giveStarter(state, weaponId) {
  const base = state.catalog?.weapon?.find((w) => w.id === weaponId);
  if (!base || !state.weapons) return;
  const item = buildItem('weapon', base, 'common');
  if (weaponId === 'dagger') { // two blades: a dagger in the other hand of the sword
    const slot = state.weapons.findIndex((w) => w?.id === 'sword' && w.grip === 'one');
    if (slot >= 0 && state.offhands && !state.offhands[slot]) {
      state.offhands[slot] = item;
      return;
    }
  }
  const free = state.weapons.findIndex((w) => !w);
  if (free >= 0) state.weapons[free] = item;
}
