import { hash2 } from '../core/rng.js';
import { TILE, BIOME_IDS } from '../world/world.js';
import { lairCandidate, LAIR_CELL } from '../world/sites.js';
import { beastName } from '../world/names.js';
import { avertFuture, takeArtifacts } from './history.js';
import { maybeRelic, relicPlace, badgeFromTomb, RELIC_CHANCE } from './relics.js';
import { tierAtTile } from './difficulty.js';
import { rollItemMin, makeDrop } from '../sim/loot.js';
import { makeBoss, updateBoss } from '../sim/boss.js';

// Boss lairs: one candidate per LAIR_CELL x LAIR_CELL tiles, placed from the world seed, far from towns and the start.
// A boss waits in its lair, fights until you flee or die, and comes back some minutes after it was killed.
export { LAIR_CELL };
export const LAIR_RADIUS = 6; // tiles, the ruins around the boss
const MIN_FROM_START = 70; // tiles: the first area is boss-free
const TOWN_CLEARANCE = 30; // tiles between a lair and the nearest town
export const ACTIVATE_PX = 700; // the boss appears when you come this close
export const DESPAWN_PX = 2300; // and is put back when you are this far away
export const BOSS_RESPAWN = 900; // seconds after a kill

export const LAIR_ID = /^l:(-?\d{1,5}),(-?\d{1,5})$/;
export const REST_ID = /^[ld]:(-?\d{1,5}),(-?\d{1,5})$/; // anything with a boss rest timer: a lair (l:) or a dungeon (d:)

const sites = new WeakMap(); // world -> Map(cell -> site | null): where lairs may be, independent of the boss data
const lairs = new WeakMap(); // world -> { defs, map }: the lairs for a given boss list

// Free land (no water, cliff, chasm or river). Worlds without obstacles (and test stand-ins) only know land and water.
const ground = (world, tx, ty) => (world.openGround ? world.openGround(tx, ty) : world.rawBiomeIdAt(tx, ty) > 0);

export function lairSiteAt(world, cx, cy) {
  if (world.isMap) return world.placeById(`l:${cx},${cy}`);
  let map = sites.get(world);
  if (!map) sites.set(world, (map = new Map()));
  const key = `${cx},${cy}`;
  if (map.has(key)) return map.get(key);

  let site = null;
  const spot = lairCandidate(world.seed, cx, cy);
  if (spot) {
    const { tx, ty } = spot;
    const biomeId = world.rawBiomeIdAt(tx, ty);
    let landAround = biomeId > 0 && ground(world, tx, ty);
    for (let i = 0; i < 8 && landAround; i++) {
      const a = (i / 8) * Math.PI * 2;
      landAround = ground(world, Math.round(tx + Math.cos(a) * 8), Math.round(ty + Math.sin(a) * 8));
    }
    if (landAround && Math.hypot(tx, ty) >= MIN_FROM_START && !world.townAtPx(tx * TILE, ty * TILE, TOWN_CLEARANCE * TILE)) {
      site = { tx, ty, biome: BIOME_IDS[biomeId], tier: tierAtTile(tx, ty) };
    }
  }
  map.set(key, site);
  return site;
}

// The strongest boss that belongs to this region (right biome, not above the region's tier).
function pickBoss(site, bossDefs, cx, cy, seed) {
  const fits = bossDefs.filter((b) => !b.dungeon && b.tier <= site.tier && b.biomes.includes(site.biome)); // dungeon bosses stay underground
  if (fits.length === 0) return null;
  const top = Math.max(...fits.map((b) => b.tier));
  const best = fits.filter((b) => b.tier === top);
  return best[Math.floor(hash2(cx, cy, seed + 9004) * best.length)];
}

export function getLair(world, cx, cy, bossDefs) {
  let cache = lairs.get(world);
  if (!cache || cache.defs !== bossDefs) lairs.set(world, (cache = { defs: bossDefs, map: new Map() }));
  const key = `${cx},${cy}`;
  if (cache.map.has(key)) return cache.map.get(key);
  const site = lairSiteAt(world, cx, cy);
  const boss = site && (site.bossId ? bossDefs.find((b) => b.id === site.bossId) : pickBoss(site, bossDefs, cx, cy, world.seed)); // the map may name it
  const lair = boss && {
    id: `l:${cx},${cy}`, cx, cy, tx: site.tx, ty: site.ty, px: site.tx * TILE, py: site.ty * TILE, tier: site.tier, bossId: boss.id,
    name: beastName(world.seed, cx, cy), // every lair boss has a name, and a past (see systems/history.js)
  };
  cache.map.set(key, lair || null);
  return lair || null;
}

export function lairById(world, id, bossDefs) {
  const m = LAIR_ID.exec(id);
  const lair = m && getLair(world, Number(m[1]), Number(m[2]), bossDefs);
  return lair && lair.id === id ? lair : null;
}

export function lairsInRange(world, px, py, rangePx, bossDefs) {
  if (world.isMap) {
    return world.sitesInRange(world.lairSites, px, py, rangePx).map((s) => getLair(world, s.cx, s.cy, bossDefs)).filter(Boolean);
  }
  const cell = LAIR_CELL * TILE;
  const out = [];
  for (let cy = Math.floor((py - rangePx) / cell); cy <= Math.floor((py + rangePx) / cell); cy++) {
    for (let cx = Math.floor((px - rangePx) / cell); cx <= Math.floor((px + rangePx) / cell); cx++) {
      const lair = getLair(world, cx, cy, bossDefs);
      if (lair && Math.hypot(lair.px - px, lair.py - py) <= rangePx) out.push(lair);
    }
  }
  return out;
}

export function nearestLair(world, px, py, maxPx, bossDefs) {
  let best = null;
  let bestD = Infinity;
  for (const lair of lairsInRange(world, px, py, maxPx, bossDefs)) {
    const d = Math.hypot(lair.px - px, lair.py - py);
    if (d < bestD) { best = lair; bestD = d; }
  }
  return best;
}

// Every tick: lair timers, the bosses' own behaviour, bosses appearing when you come close and leaving when you are far.
export function updateLairs(state, world, dt, rng = Math.random) {
  state.lairs ??= new Map();
  const p = state.player;
  for (const st of state.lairs.values()) st.respawn = Math.max(0, st.respawn - dt);
  for (const e of state.enemies) if (e.boss) updateBoss(state, world, e, dt, rng);

  state.enemies = state.enemies.filter((e) => !e.boss || (e.hp > 0 && (e.noDespawn || Math.hypot(e.home.x - p.x, e.home.y - p.y) <= DESPAWN_PX)));
  const present = new Set(state.enemies.filter((e) => e.boss).map((e) => e.lairId));
  state.enemies = state.enemies.filter((e) => !e.owner || present.has(e.owner)); // minions go with their boss

  if (state.dead || state.area || world.isTown(p.x, p.y)) return; // below ground no lair of the open world wakes up
  for (const lair of lairsInRange(world, p.x, p.y, ACTIVATE_PX, state.bossDefs ?? [])) {
    const st = state.lairs.get(lair.id);
    if ((st && st.respawn > 0) || present.has(lair.id)) continue;
    const def = state.bossDefs.find((b) => b.id === lair.bossId);
    state.enemies.push(makeBoss(def, lair, lair.tier));
  }
}

// A boss died: start the lair timer, drop the loot (at least rare), and remove its minions.
export function bossRewards(state, boss) {
  state.lairs ??= new Map();
  state.lairs.set(boss.lairId, { respawn: BOSS_RESPAWN });
  state.enemies = state.enemies.filter((e) => e.owner !== boss.lairId);
  const count = boss.tier >= 3 ? 3 : 2;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    state.drops.push(makeDrop(boss.x + Math.cos(a) * 44, boss.y + Math.sin(a) * 44, rollItemMin(state.catalog, 'rare', Math.random, boss.tier)));
  }
  state.banner = { key: 'boss.defeated', bossId: boss.def.id, ...(boss.name && { name: boss.name }), t: 0 };
  // the grave that waited for you near this lair belonged to a future that will not happen now
  if (state.world && avertFuture(state, state.world, boss.lairId)) state.note = { key: 'echo.undone', args: { name: boss.name ?? '' }, t: 0 };
  // an artifact the chronicles say was lost here (in this lair, or in this dungeon) is found on the boss
  if (state.world) takeArtifacts(state, state.world, boss.lairId, boss.x, boss.y, makeDrop);
  // relics of the old world: the hero's own badge with the first Sand Tomb king, others by chance
  if (state.area?.theme === 'tomb' && state.catalog) badgeFromTomb(state, boss.x, boss.y);
  const place = state.catalog && relicPlace(state, boss.lairId, { tier: boss.tier });
  if (place) maybeRelic(state, place, place === 'ring' ? RELIC_CHANCE.ring : RELIC_CHANCE.boss, boss.x + 40, boss.y);
}
