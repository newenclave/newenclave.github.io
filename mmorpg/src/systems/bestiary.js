import { TIER_DISTANCE } from './difficulty.js';

// The bestiary: what you have met and what you know about it.
// A creature appears in the book when you first see it; its numbers once you have defeated one; its loot after a few.
export const LEARN_STATS_AT = 1; // defeats
export const LEARN_LOOT_AT = 3;
export const TABS = ['monsters', 'bosses'];

export function ensureBestiary(state) {
  state.bestiary ??= { seen: new Set(), kills: new Map() };
  return state.bestiary;
}

export function markSeen(state, id) {
  const b = ensureBestiary(state);
  if (b.seen.has(id)) return false;
  b.seen.add(id);
  return true;
}

export function recordKill(state, id) {
  const b = ensureBestiary(state);
  markSeen(state, id);
  b.kills.set(id, (b.kills.get(id) ?? 0) + 1);
}

export const isSeen = (state, id) => !!state.bestiary?.seen.has(id);
export const killsOf = (state, id) => state.bestiary?.kills.get(id) ?? 0;

// Everything you can see right now goes into the book. `visible` is the view inside a dungeon (null in the open).
export function scanVisible(state, sightPx, tile) {
  const p = state.player;
  const found = [];
  for (const e of state.enemies) {
    if (e.hp <= 0 || Math.hypot(e.x - p.x, e.y - p.y) >= sightPx) continue;
    if (state.visible && !state.visible.has(Math.floor(e.x / tile), Math.floor(e.y / tile))) continue;
    if (markSeen(state, e.def.id)) found.push(e.def.id);
  }
  return found;
}

// The pages of a tab, in the order they are listed: lower danger first.
export function entriesFor(state, tab) {
  const byTier = (a, b) => (a.def.tier ?? 0) - (b.def.tier ?? 0);
  if (tab === 'bosses') return state.bossDefs.map((def) => ({ id: def.id, kind: 'boss', def })).sort(byTier);
  return state.enemyDefs.map((def) => ({ id: def.id, kind: 'monster', def })).sort(byTier);
}

export function progress(state) {
  const all = [...entriesFor(state, 'monsters'), ...entriesFor(state, 'bosses')];
  return { seen: all.filter((e) => isSeen(state, e.id)).length, total: all.length };
}

// Short labels for how a creature fights: language keys under bestiary.tag.
export function traits(entry) {
  const d = entry.def;
  const tags = [];
  if (entry.kind === 'boss') { // a boss has a whole set of attacks: no single "melee" or "ranged" label fits
    tags.push(d.dungeon ? 'dungeonBoss' : 'boss');
    if (d.flying) tags.push('flying');
    return tags;
  }
  if (d.flying) tags.push('flying');
  tags.push({ ranged: 'ranged', charger: 'charger' }[d.ai] ?? 'melee');
  if (d.pack) tags.push('pack');
  return tags;
}

// Where it is found: biomes, danger tier (and how far from the start that begins), dungeons it lives in.
export function whereFound(state, entry) {
  const d = entry.def;
  const tier = d.tier ?? 0;
  const themes = state.dungeonDefs?.themes ?? {};
  const out = { biomes: d.biomes ?? [], tier, fromTiles: tier * TIER_DISTANCE, dungeons: [], guards: null };
  if (entry.kind === 'boss' && d.dungeon) {
    out.guards = Object.keys(themes).find((name) => themes[name].boss === d.id) ?? (d.ring ? 'ring' : null);
    out.biomes = [];
  } else if (entry.kind === 'monster') {
    out.dungeons = Object.keys(themes).filter((name) => themes[name].monsters.includes(d.id));
  }
  return out;
}

// How much of a page is filled in.
export function knowledge(state, id) {
  const kills = killsOf(state, id);
  return { seen: isSeen(state, id), stats: kills >= LEARN_STATS_AT, loot: kills >= LEARN_LOOT_AT, kills };
}
