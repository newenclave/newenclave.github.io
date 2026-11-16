import { makeDrop } from '../sim/loot.js';
import { ensureHistory } from './history.js';
import { addToBackpack } from './backpack.js';

// Relics of the world before the Shift (docs/relics.md): wearable ones (armor, jewellery, two weapons) with fixed stats,
// and curios that are only worth their story. They turn up in the places of their set, once each per game; a
// chronicler names them (what they really were), pays for the knowledge, and rewards a complete set.
// catalog.relic: the relic items of data/relics.json; state.relicSets: its sets.
export const RELIC_CHANCE = { chest: 0.3, boss: 0.5, ring: 0.7 };
const BADGE = 'relic_lab_badge'; // the hero's own badge: always in the vault of the first Sand Tomb king you beat

// The item of a relic: fixed stats (no rarity scaling), always shown as epic, marked `relic`.
export function buildRelic(catalog, id) {
  const def = catalog.relic?.find((r) => r.id === id);
  if (!def) return null;
  const item = { ...def, rarity: 'epic', plus: 0, relic: true };
  if (def.slot === 'weapon') { // a relic weapon: a base weapon, with the relic's own numbers on top
    const base = catalog.weapon.find((w) => w.id === def.base);
    if (!base) return null;
    return { ...base, ...item, slot: 'weapon' };
  }
  return item;
}

export const relicDef = (catalog, id) => catalog.relic?.find((r) => r.id === id) ?? null;

const known = (state) => {
  const h = ensureHistory(state);
  h.relicsFound ??= new Set();
  h.relicsKnown ??= new Set();
  h.setsDone ??= new Set();
  h.titles ??= [];
  return h;
};

// The kind of place a chest or a boss is, for the relic sets: a dungeon theme, a cave, a valley, a Pulse cache (cold or
// far), a far lair, the Ring.
export function relicPlace(state, runId, extra = {}) {
  if (runId === 'r:ring') return 'ring';
  if (runId.startsWith('v:')) return 'valley';
  if (runId.startsWith('c:')) return 'cave';
  if (runId.startsWith('p:')) return extra.cold ? 'pulse_cold' : extra.far ? 'pulse_far' : 'pulse';
  if (runId.startsWith('l:')) return (extra.tier ?? 0) >= 3 ? 'lair_far' : null;
  return state.area?.theme ?? null; // a dungeon: crypt, ice or tomb
}

// Relics that can still turn up at a kind of place: those of the sets found there, not found yet.
export function relicsFor(state, place) {
  const h = known(state);
  return (state.relicSets ?? []).filter((s) => s.places.includes(place)).flatMap((s) => s.items)
    .filter((id) => !h.relicsFound.has(id) && id !== BADGE);
}

function give(state, id, x, y) {
  const item = buildRelic(state.catalog, id);
  if (!item) return null;
  known(state).relicsFound.add(id);
  state.drops.push(makeDrop(x, y + 30, item, 0.8));
  return item;
}

// A chest opens or a boss falls at a kind of place: maybe a relic. Returns the relic, or null.
export function maybeRelic(state, place, chance, x, y, rng = Math.random) {
  if (!place || rng() >= chance) return null;
  const left = relicsFor(state, place);
  if (!left.length) return null;
  const item = give(state, left[Math.floor(rng() * left.length)], x, y);
  return item;
}

// The first Sand Tomb king you beat kept your badge for you.
export function badgeFromTomb(state, x, y) {
  if (known(state).relicsFound.has(BADGE)) return null;
  const item = give(state, BADGE, x, y);
  if (item) state.note = { key: 'note.tomb.3', t: 0, dur: 12 };
  return item;
}

// Everything you carry or wear that is a relic.
function carried(state) {
  const p = state.player;
  return [...state.inventory, ...Object.values(p.equipment ?? {}), ...(state.weapons ?? []), ...(state.offhands ?? [])].filter((it) => it?.relic);
}

// At a chronicler: every relic you carry that nobody has named yet is named and paid for; a set whose relics are all
// named gives its reward. Returns { named: [ids], gold, sets: [set ids] }.
export function identifyRelics(state) {
  const h = known(state);
  const named = [];
  let gold = 0;
  for (const it of carried(state)) {
    if (h.relicsKnown.has(it.id)) continue;
    h.relicsKnown.add(it.id);
    named.push(it.id);
    gold += relicDef(state.catalog, it.id)?.price ?? 0;
  }
  const sets = [];
  for (const set of state.relicSets ?? []) {
    if (h.setsDone.has(set.id) || !set.items.every((id) => h.relicsKnown.has(id))) continue;
    h.setsDone.add(set.id);
    sets.push(set.id);
    gold += set.reward.gold ?? 0;
    if (set.reward.title) h.titles.push(set.reward.title);
    if (set.reward.item) {
      const item = buildRelic(state.catalog, set.reward.item);
      if (item && addToBackpack(state.inventory, item) < 0) state.drops.push(makeDrop(state.player.x, state.player.y + 40, item, 1));
    }
    h.learned.add(`s:set:${set.id}`); // the chronicle tells of it
  }
  state.player.gold += gold;
  return { named, gold, sets };
}

export const setDone = (state, id) => known(state).setsDone.has(id);
export const isKnown = (state, id) => known(state).relicsKnown.has(id);
export const isFound = (state, id) => known(state).relicsFound.has(id);
export const titlesOf = (state) => known(state).titles;
// Is something worn that has this effect? ('farSight', 'ringCompass')
export const wearsEffect = (state, effect) => Object.values(state.player?.equipment ?? {}).some((it) => it?.effect === effect);
