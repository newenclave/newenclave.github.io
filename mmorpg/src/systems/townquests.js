import { mulberry32 } from '../core/rng.js';
import { roleIn } from './quests.js';
import { BIOME_IDS, TILE } from '../world/world.js';
import { SLOTS } from '../sim/loot.js';
import { canWalk } from '../world/reach.js';
import { tierAtTile, MAX_TIER, TIER_DISTANCE } from './difficulty.js';
import { nearestLair } from './lairs.js';
import { nearestEntrance } from './dungeons.js';

// Every town has its own quest board, generated from the world seed and the town itself,
// so the same town always offers the same quests. Difficulty grows with the distance from the start.
const REWARD_RARITY = ['uncommon', 'uncommon', 'rare', 'rare', 'epic'];
const SAMPLE_RADIUS = 18; // tiles around the town used to find which monsters live nearby
const COURIER_RANGE = 6000; // px

export const GENERATED_ID = /^t:(-?\d{1,5}),(-?\d{1,5}):([0-4])$/;
const BOSS_QUEST_RANGE = 150 * TILE; // a boss lair this close to the town gets a quest

export const townDifficulty = (town) => town.tier ?? tierAtTile(town.tx, town.ty); // the finite map gives each town its tier
export { TIER_DISTANCE, MAX_TIER };

// Enemies whose biome is found around the town (and that already appear in this region: no tier-3 monsters near the start).
export function localEnemies(world, town, enemyDefs) {
  const tier = townDifficulty(town);
  const biomes = new Set();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const tx = Math.round(town.tx + Math.cos(a) * SAMPLE_RADIUS);
    const ty = Math.round(town.ty + Math.sin(a) * SAMPLE_RADIUS);
    biomes.add(BIOME_IDS[world.rawBiomeIdAt(tx, ty)]);
  }
  return enemyDefs.filter((e) => (e.tier ?? 0) <= tier && e.biomes.some((b) => biomes.has(b)));
}

// The closest other town you can walk to (a town on another island does not count).
// The route search is not free, and its answer never changes, so it is remembered per world.
const courierCache = new WeakMap();

function nearestOtherTown(world, town) {
  let cache = courierCache.get(world);
  if (!cache) courierCache.set(world, (cache = new Map()));
  if (cache.has(town.id)) return cache.get(town.id);
  const others = world.townsInRange(town.px, town.py, COURIER_RANGE)
    .filter((o) => o.id !== town.id)
    .map((o) => ({ town: o, distPx: Math.hypot(o.px - town.px, o.py - town.py) }))
    .sort((a, b) => a.distPx - b.distPx);
  const found = others.slice(0, 4).find((o) => canWalk(world, town, o.town)) ?? null;
  cache.set(town.id, found);
  return found;
}

export function generateTownQuests(world, town, catalog, enemyDefs, seed, bossDefs = [], dungeonDefs = null) {
  const rng = mulberry32((seed ^ Math.imul(town.tx, 73856093) ^ Math.imul(town.ty, 19349663)) >>> 0);
  const tier = townDifficulty(town);
  const id = (n) => `t:${town.id}:${n}`;
  const out = [];

  const locals = localEnemies(world, town, enemyDefs);
  const target = locals.length ? locals[Math.floor(rng() * locals.length)] : null;
  const bountyCount = 5 + 2 * tier + Math.floor(rng() * 3);
  out.push({
    id: id(0), giver: town.id, npc: roleIn(town, 'captain'), kind: 'kill', target: target ? target.id : 'any', count: bountyCount, gen: target ? 'bounty' : 'patrol',
    titleKey: target ? 'quest.gen.bounty.title' : 'quest.gen.patrol.title',
    args: target ? { enemy: target.id } : { town: town.nameIndex },
    reward: { gold: bountyCount * (6 + 3 * tier), xp: bountyCount * (7 + 3 * tier) },
  });

  const patrolCount = 14 + 4 * tier;
  const slot = SLOTS[Math.floor(rng() * SLOTS.length)];
  const list = catalog[slot];
  const base = list[Math.floor(rng() * list.length)];
  out.push({
    id: id(1), giver: town.id, npc: roleIn(town, 'captain'), kind: 'kill', target: 'any', count: patrolCount, gen: 'patrol',
    titleKey: 'quest.gen.patrol.title', args: { town: town.nameIndex },
    reward: {
      gold: patrolCount * (7 + 3 * tier), xp: patrolCount * (8 + 3 * tier),
      item: { slot, id: base.id, rarity: REWARD_RARITY[tier] },
    },
  });

  const dest = nearestOtherTown(world, town);
  if (dest) {
    const distTiles = Math.round(dest.distPx / TILE);
    out.push({
      id: id(2), giver: town.id, npc: roleIn(town, 'innkeeper'), turnInAt: dest.town.id, turnInNpc: roleIn(dest.town, 'innkeeper'), kind: 'visit', target: dest.town.id, count: 1, gen: 'courier',
      titleKey: 'quest.gen.courier.title', args: { town: dest.town.nameIndex },
      reward: { gold: 40 + Math.round(distTiles * 0.8), xp: 30 + Math.round(distTiles * 0.6) },
    });
  }

  // a boss lair within reach: a quest to slay its boss (only if you can actually walk there)
  const lair = nearestLair(world, town.px, town.py, BOSS_QUEST_RANGE, bossDefs);
  if (lair && canWalk(world, town, lair, { margin: 80 })) {
    const bossTier = Math.max(tier, lair.tier);
    const rewardSlot = SLOTS[Math.floor(rng() * SLOTS.length)];
    const rewardBase = catalog[rewardSlot][Math.floor(rng() * catalog[rewardSlot].length)];
    out.push({
      id: id(3), giver: town.id, npc: roleIn(town, 'captain'), kind: 'kill', target: lair.bossId, count: 1, lair: lair.id, gen: 'boss',
      titleKey: 'quest.gen.boss.title', args: { enemy: lair.bossId },
      reward: {
        gold: 150 + 100 * bossTier, xp: 250 * (1 + bossTier),
        item: { slot: rewardSlot, id: rewardBase.id, rarity: REWARD_RARITY[Math.min(MAX_TIER, bossTier + 1)] },
      },
    });
  }

  // a dungeon within reach: a quest to defeat what rules it
  const entrance = dungeonDefs && nearestEntrance(world, town.px, town.py, BOSS_QUEST_RANGE, dungeonDefs);
  if (entrance && canWalk(world, town, entrance, { margin: 80 })) {
    const dTier = Math.max(tier, entrance.tier);
    const slot2 = SLOTS[Math.floor(rng() * SLOTS.length)];
    const base2 = catalog[slot2][Math.floor(rng() * catalog[slot2].length)];
    out.push({
      id: id(4), giver: town.id, npc: roleIn(town, 'priest'), kind: 'kill', target: entrance.bossId, count: 1, lair: entrance.id, gen: 'dungeon',
      titleKey: 'quest.gen.dungeon.title', args: { dungeon: entrance.theme },
      reward: {
        gold: 180 + 110 * dTier, xp: 300 * (1 + dTier),
        item: { slot: slot2, id: base2.id, rarity: REWARD_RARITY[Math.min(MAX_TIER, dTier + 1)] },
      },
    });
  }
  return out;
}
