import { hash2 } from '../core/rng.js';
import { TILE, BIOME_IDS } from '../world/world.js';
import { Dungeon } from '../world/dungeon.js';
import { generateDungeon, generateCave } from '../world/dungeongen.js';
import { valleysInRange, valleyById } from '../world/valleys.js';
import { tierAtTile } from './difficulty.js';
import { lairSiteAt, LAIR_CELL } from './lairs.js';
import { Explored, updateExploration, SIGHT_PX } from './explore.js';
import { rollItemMin, makeDrop } from '../sim/loot.js';
import { makeEnemy } from '../sim/enemy.js';
import { makeBoss } from '../sim/boss.js';
import { notePool, noteKey } from './lore.js';
import { beastName } from '../world/names.js';
import { takeArtifacts } from './history.js';
import { maybeRelic, relicPlace, RELIC_CHANCE } from './relics.js';
import { ringSite, consoleOpen, RING_ID } from './ring.js';

// Dungeon entrances in the open world: one candidate per DUNGEON_CELL tiles, placed from the seed, away from towns,
// lairs and the start. Walk up and press the action key to go down. Each entrance leads to the same floor every time.
export const DUNGEON_CELL = 160; // tiles
const ENTRANCE_CHANCE = 0.5;
const MIN_FROM_START = 40; // tiles
const TOWN_CLEARANCE = 20;
const LAIR_CLEARANCE = 25;
export const DOOR_REACH = 70; // px: how close you must stand to use a door
const CHEST_REACH = 38;

export const DUNGEON_ID = /^d:(-?\d{1,5}),(-?\d{1,5})$/;
export const CAVE_ID = /^c:(-?\d{1,5}),(-?\d{1,5})$/; // the cave into the hidden valley v:<same cell>

const sites = new WeakMap(); // world -> Map(cell -> site | null), independent of the dungeon data
const entrances = new WeakMap(); // world -> { defs, map }

// Free land (no water, cliff, chasm or river). Worlds without obstacles (and test stand-ins) only know land and water.
const ground = (world, tx, ty) => (world.openGround ? world.openGround(tx, ty) : world.rawBiomeIdAt(tx, ty) > 0);

function siteAt(world, cx, cy) {
  if (world.isMap) return world.placeById(`d:${cx},${cy}`);
  let map = sites.get(world);
  if (!map) sites.set(world, (map = new Map()));
  const key = `${cx},${cy}`;
  if (map.has(key)) return map.get(key);

  let site = null;
  if (hash2(cx, cy, world.seed + 7001) <= ENTRANCE_CHANCE) {
    const tx = cx * DUNGEON_CELL + 30 + Math.floor(hash2(cx, cy, world.seed + 7002) * 100);
    const ty = cy * DUNGEON_CELL + 30 + Math.floor(hash2(cx, cy, world.seed + 7003) * 100);
    const biomeId = world.rawBiomeIdAt(tx, ty);
    let ok = biomeId > 0 && ground(world, tx, ty) && Math.hypot(tx, ty) >= MIN_FROM_START;
    for (let i = 0; i < 8 && ok; i++) {
      const a = (i / 8) * Math.PI * 2;
      ok = ground(world, Math.round(tx + Math.cos(a) * 6), Math.round(ty + Math.sin(a) * 6));
    }
    ok = ok && !world.townAtPx(tx * TILE, ty * TILE, TOWN_CLEARANCE * TILE);
    for (let ly = Math.floor(ty / LAIR_CELL) - 1; ok && ly <= Math.floor(ty / LAIR_CELL) + 1; ly++) {
      for (let lx = Math.floor(tx / LAIR_CELL) - 1; ok && lx <= Math.floor(tx / LAIR_CELL) + 1; lx++) {
        const lair = lairSiteAt(world, lx, ly);
        if (lair && Math.hypot(lair.tx - tx, lair.ty - ty) < LAIR_CLEARANCE) ok = false;
      }
    }
    if (ok) site = { tx, ty, biome: BIOME_IDS[biomeId], tier: tierAtTile(tx, ty) };
  }
  map.set(key, site);
  return site;
}

export const themeForBiome = (dungeonDefs, biome) =>
  Object.keys(dungeonDefs.themes).find((name) => dungeonDefs.themes[name].biomes.includes(biome)) ?? null;

export function getEntrance(world, cx, cy, dungeonDefs) {
  let cache = entrances.get(world);
  if (!cache || cache.defs !== dungeonDefs) entrances.set(world, (cache = { defs: dungeonDefs, map: new Map() }));
  const key = `${cx},${cy}`;
  if (cache.map.has(key)) return cache.map.get(key);
  const site = siteAt(world, cx, cy);
  const theme = site && (site.theme ?? themeForBiome(dungeonDefs, site.biome)); // the map may name the theme (the plates)
  const entrance = theme && {
    id: `d:${cx},${cy}`, cx, cy, tx: site.tx, ty: site.ty, px: site.tx * TILE, py: site.ty * TILE, tier: site.tier, theme,
    bossId: dungeonDefs.themes[theme].boss, name: beastName(world.seed, cx, cy, 50),
  };
  cache.map.set(key, entrance || null);
  return entrance || null;
}

export function entranceById(world, id, dungeonDefs) {
  const m = DUNGEON_ID.exec(id);
  const e = m && !world.isDungeon && getEntrance(world, Number(m[1]), Number(m[2]), dungeonDefs);
  return e && e.id === id ? e : null;
}

export function entrancesInRange(world, px, py, rangePx, dungeonDefs) {
  if (world.isDungeon || !dungeonDefs) return [];
  if (world.isMap) {
    return world.sitesInRange(world.dungeonSites, px, py, rangePx).map((s) => getEntrance(world, s.cx, s.cy, dungeonDefs)).filter(Boolean);
  }
  const cell = DUNGEON_CELL * TILE;
  const out = [];
  for (let cy = Math.floor((py - rangePx) / cell); cy <= Math.floor((py + rangePx) / cell); cy++) {
    for (let cx = Math.floor((px - rangePx) / cell); cx <= Math.floor((px + rangePx) / cell); cx++) {
      const e = getEntrance(world, cx, cy, dungeonDefs);
      if (e && Math.hypot(e.px - px, e.py - py) <= rangePx) out.push(e);
    }
  }
  return out;
}

export function nearestEntrance(world, px, py, maxPx, dungeonDefs) {
  let best = null;
  let bestD = Infinity;
  for (const e of entrancesInRange(world, px, py, maxPx, dungeonDefs)) {
    const d = Math.hypot(e.px - px, e.py - py);
    if (d < bestD) { best = e; bestD = d; }
  }
  return best;
}

// An entrance is discovered when its centre has been seen. Returns the new ones.
export function discoverEntrances(state, world) {
  const p = state.player;
  const found = [];
  for (const e of entrancesInRange(world, p.x, p.y, SIGHT_PX + TILE, state.dungeonDefs)) {
    if (state.discovered.has(e.id) || !state.explored.has(e.tx, e.ty)) continue;
    state.discovered.add(e.id);
    found.push(e);
  }
  return found;
}

// ---------------------------------------------------------------- going down and coming back

const dungeonSeed = (world, entrance) => Math.floor(hash2(entrance.cx, entrance.cy, world.seed + 31337) * 2 ** 31);

// The monsters of a dungeon theme that are not far above the floor's danger tier.
function monsterPool(state, theme, tier) {
  const defs = state.dungeonDefs;
  const ids = (theme === 'cave' ? defs.caves : theme === 'ring' ? defs.ring : defs.themes[theme]).monsters;
  return state.enemyDefs.filter((d) => ids.includes(d.id) && (d.tier ?? 0) <= tier + 1);
}

function pickMonster(pool, tier, rng) {
  const weights = pool.map((d) => ((d.tier ?? 0) === tier ? 3 : 1));
  let roll = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll < 0) return pool[i];
  }
  return pool[pool.length - 1];
}

const centre = (tx, ty) => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });

function populate(state, dungeon, entrance, rng) {
  const { layout } = dungeon;
  const tier = entrance.tier;
  const cleared = (state.lairs.get(entrance.id)?.respawn ?? 0) > 0;
  state.enemies = [];
  if (!cleared) {
    const pool = monsterPool(state, entrance.theme, tier);
    for (const m of layout.monsters) {
      const def = pickMonster(pool, tier, rng);
      const size = def.pack ? def.pack.min + Math.floor(rng() * (def.pack.max - def.pack.min + 1)) : 1;
      const at = centre(m.tx, m.ty);
      for (let i = 0; i < size; i++) {
        const x = at.x + (i === 0 ? 0 : (rng() - 0.5) * 70);
        const y = at.y + (i === 0 ? 0 : (rng() - 0.5) * 70);
        if (i > 0 && !dungeon.isWalkable(x, y)) continue;
        const e = makeEnemy(def, x, y, tier);
        e.dungeon = entrance.id;
        state.enemies.push(e);
      }
    }
    const bossDef = layout.bossAt && state.bossDefs.find((b) => b.id === entrance.bossId); // caves have no boss
    if (bossDef) {
      const at = centre(layout.bossAt.tx, layout.bossAt.ty);
      const boss = makeBoss(bossDef, { id: entrance.id, name: entrance.name, px: at.x, py: at.y }, tier);
      boss.noDespawn = true; // a dungeon is bigger than the distance at which open-world bosses go back to sleep
      state.enemies.push(boss);
    }
  }
  const opened = state.dungeonRuns.get(entrance.id)?.opened ?? [];
  state.chests = layout.chests.map((c) => ({ idx: c.idx, ...centre(c.tx, c.ty), opened: opened.includes(c.idx), tier, run: entrance.id }));
}

// Goes down. The overworld is put aside (its map, what lies on the ground) and comes back when you leave.
export function enterDungeon(state, entrance, rng = Math.random) {
  if (state.area) return false;
  // a dungeon whose rest time is over starts afresh: monsters, boss and chests
  const rest = state.lairs.get(entrance.id);
  if (rest && rest.respawn <= 0) {
    state.lairs.delete(entrance.id);
    state.dungeonRuns.delete(entrance.id);
  }
  const layout = generateDungeon({ seed: dungeonSeed(state.world, entrance), tier: entrance.tier });
  const dungeon = new Dungeon(layout, entrance.theme, state.world.biomes);
  const exit = centre(layout.exit.tx, layout.exit.ty);
  // the Ring has a console in its keeper's room, where the story ends
  const consoleAt = entrance.ring ? centre(layout.bossAt.tx, layout.bossAt.ty + 2) : null;
  descend(state, dungeon, {
    kind: 'dungeon', id: entrance.id, theme: entrance.theme, tier: entrance.tier, entrance, spawn: dungeon.findSpawn(), exit, exits: [exit], console: consoleAt,
  }, rng);
  return true;
}

// Goes into the cave under the ring of a hidden valley, from its outer mouth or from the inner one. You come out at
// the mouth on the other side (or back where you came in).
export function enterCave(state, valley, side, rng = Math.random) {
  if (state.area) return false;
  const id = `c:${valley.cx},${valley.cy}`;
  const tier = valley.tier ?? tierAtTile(valley.tx, valley.ty, state.world);
  const layout = generateCave({ seed: Math.floor(hash2(valley.cx, valley.cy, state.world.seed + 6200) * 2 ** 31), tier });
  const dungeon = new Dungeon(layout, 'cave', state.world.biomes);
  const mouth = (m) => ({ x: m.tx * TILE + TILE / 2, y: m.ty * TILE + TILE / 2 });
  const exits = [
    { ...centre(layout.exit.tx, layout.exit.ty), out: mouth(valley.outer), side: 'outer' },
    { ...centre(layout.far.tx, layout.far.ty), out: mouth(valley.inner), side: 'inner' },
  ];
  const spawn = side === 'inner' ? centre(layout.farSpawn.tx, layout.farSpawn.ty) : centre(layout.spawn.tx, layout.spawn.ty);
  const entrance = { id, theme: 'cave', tier, ...mouth(side === 'inner' ? valley.inner : valley.outer) };
  entrance.px = entrance.x;
  entrance.py = entrance.y;
  descend(state, dungeon, { kind: 'cave', id, theme: 'cave', tier, entrance, valley: valley.id, spawn, exit: exits[0], exits }, rng);
  return true;
}

function descend(state, dungeon, area, rng) {
  const p = state.player;
  state.overworld = { world: state.world, explored: state.explored, lastRevealTile: state.lastRevealTile, drops: state.drops, x: p.x, y: p.y };
  state.world = dungeon;
  if (!state.dungeonExplored.has(area.id)) state.dungeonExplored.set(area.id, new Explored());
  state.explored = state.dungeonExplored.get(area.id);
  state.lastRevealTile = null;
  state.visible = null;
  state.drops = [];
  state.projectiles = [];
  state.enemyProjectiles = [];
  state.effects = [];
  state.area = area;
  p.x = area.spawn.x;
  p.y = area.spawn.y;
  p.rollTime = 0;
  state.ui.panel = null;
  state.town = null;
  state.townId = null;
  state.nearNpc = null;
  populate(state, dungeon, area.entrance, rng);
  updateExploration(state, dungeon);
  state.banner = { key: 'dungeon.entered', theme: area.theme, t: 0 };
}

// Goes back up, to just outside the entrance; or, through a door that leads elsewhere (the far end of a cave), there.
export function leaveDungeon(state, exit = null) {
  if (!state.area) return false;
  const ow = state.overworld;
  const p = state.player;
  state.world = ow.world;
  state.explored = ow.explored;
  state.lastRevealTile = null;
  state.visible = null;
  state.drops = ow.drops;
  state.enemies = [];
  state.chests = [];
  state.projectiles = [];
  state.enemyProjectiles = [];
  state.effects = [];
  const e = state.area.entrance;
  p.x = exit?.out ? exit.out.x : ow.x;
  p.y = exit?.out ? exit.out.y : ow.y;
  p.rollTime = 0;
  if (!state.world.isWalkable(p.x, p.y)) { p.x = e.px; p.y = e.py + 60; }
  state.area = null;
  state.overworld = null;
  state.ui.panel = null;
  updateExploration(state, state.world);
  return true;
}

// Where you come back after dying: the start town, or the entrance room when you are in a dungeon.
export const respawnPoint = (state) => (state.area ? state.area.spawn : state.spawn);

// ---------------------------------------------------------------- the door you stand at

// Updates state.nearDoor: an entrance or a cave mouth outside; the stairs up or a way out of a cave inside.
export function updateDoor(state, world) {
  const p = state.player;
  if (state.area) {
    const con = state.area.console;
    if (con && consoleOpen(state) && Math.hypot(con.x - p.x, con.y - p.y) <= DOOR_REACH) {
      state.nearDoor = { kind: 'console' };
      return;
    }
    const exit = (state.area.exits ?? [state.area.exit]).find((x) => Math.hypot(x.x - p.x, x.y - p.y) <= DOOR_REACH);
    state.nearDoor = exit ? (exit.out ? { kind: 'exit', exit } : { kind: 'exit' }) : null;
    return;
  }
  const e = entrancesInRange(world, p.x, p.y, DOOR_REACH, state.dungeonDefs).find((en) => Math.hypot(en.px - p.x, en.py - p.y) <= DOOR_REACH);
  const ring = ringSite(world);
  if (!e && ring && Math.hypot(ring.px - p.x, ring.py - p.y) <= DOOR_REACH) { state.nearDoor = { kind: 'enter', entrance: ring }; return; }
  state.nearDoor = e ? { kind: 'enter', entrance: e } : caveMouthNear(state, world, p.x, p.y);
}

// The cave mouth within reach, as a door: { kind: 'cave', valley, side: 'outer' | 'inner', sealed }. Once the dimension
// is folded back the valleys go dark and their caves fall in from the outside (the way out of one stays open).
export const valleysSealed = (state) => state.ending === 'fold';
function caveMouthNear(state, world, px, py) {
  for (const v of valleysInRange(world, px, py, DOOR_REACH)) {
    for (const side of ['outer', 'inner']) {
      const m = v[side];
      if (Math.hypot(m.tx * TILE + TILE / 2 - px, m.ty * TILE + TILE / 2 - py) <= DOOR_REACH) {
        return { kind: 'cave', valley: v, side, sealed: side === 'outer' && valleysSealed(state) };
      }
    }
  }
  return null;
}

export function useDoor(state) {
  const door = state.nearDoor;
  if (!door) return false;
  if (door.kind === 'enter') return enterDungeon(state, door.entrance);
  if (door.kind === 'cave') return door.sealed ? false : enterCave(state, door.valley, door.side);
  if (door.kind === 'console') { state.ui.panel = 'ending'; return true; } // the choice (ui/ending-ui.js)
  return leaveDungeon(state, door.exit);
}

// ---------------------------------------------------------------- hidden valleys

// The chests of the hidden valleys near the player, as chests of the open world (what was opened is remembered under
// the valley's id). Better than dungeon chests: getting there took a cave.
export function valleyChests(state, world) {
  const p = state.player;
  const out = [];
  for (const v of valleysInRange(world, p.x, p.y, SIGHT_PX * 2)) {
    const opened = state.dungeonRuns.get(v.id)?.opened ?? [];
    const tier = (v.tier ?? tierAtTile(v.tx, v.ty, world)) + 1;
    for (const c of v.chests) out.push({ idx: c.idx, ...centre(c.tx, c.ty), opened: opened.includes(c.idx), tier, run: v.id, minRarity: 'rare' });
  }
  return out;
}

// A valley is discovered once its middle has been seen, a cave once either of its mouths has. Returns the new ones.
export function discoverValleys(state, world) {
  const p = state.player;
  const found = [];
  for (const v of valleysInRange(world, p.x, p.y, SIGHT_PX + TILE)) {
    const cave = `c:${v.cx},${v.cy}`;
    if (!state.discovered.has(cave) && (state.explored.has(v.outer.tx, v.outer.ty) || state.explored.has(v.inner.tx, v.inner.ty))) {
      state.discovered.add(cave);
      found.push({ kind: 'cave', id: cave, valley: v });
    }
    if (!state.discovered.has(v.id) && state.explored.has(v.tx, v.ty)) {
      state.discovered.add(v.id);
      found.push({ kind: 'valley', id: v.id, valley: v });
    }
  }
  return found;
}

export { valleyById };

// The shaft to the Ring is found once it has been seen. Returns it the first time, else null.
export function discoverRing(state, world) {
  const ring = ringSite(world);
  if (!ring || state.discovered.has(RING_ID) || !state.explored.has(ring.tx, ring.ty)) return null;
  state.discovered.add(RING_ID);
  return ring;
}

// ---------------------------------------------------------------- chests

// Walk up to a chest and it opens by itself: loot on the floor, a pile of gold. What was opened is remembered.
export function updateChests(state, rng = Math.random) {
  if (!state.chests?.length || state.dead) return;
  const p = state.player;
  for (const c of state.chests) {
    if (c.opened || Math.hypot(c.x - p.x, c.y - p.y) > CHEST_REACH) continue;
    c.opened = true;
    const runId = c.run ?? state.area.id;
    const run = state.dungeonRuns.get(runId) ?? { opened: [] };
    run.opened.push(c.idx);
    state.dungeonRuns.set(runId, run);
    const items = 1 + (rng() < 0.5 ? 1 : 0) + (c.tier >= 2 ? 1 : 0);
    for (let i = 0; i < items; i++) {
      const a = (i / items) * Math.PI * 2 + 0.5;
      state.drops.push(makeDrop(c.x + Math.cos(a) * 36, c.y + Math.sin(a) * 36, rollItemMin(state.catalog, c.minRarity ?? 'uncommon', rng, c.tier)));
    }
    const gold = Math.round((25 + Math.floor(rng() * 25)) * (1 + 0.5 * c.tier) * (1 + (p.stats?.goldFind ?? 0)));
    p.gold += gold;
    const pool = notePool(runId, state.area?.theme);
    if (pool) state.note = { key: noteKey(pool, runId, c.idx), t: 0 }; // someone left a few words in it
    if (runId.startsWith('v:')) takeArtifacts(state, state.world, runId, c.x, c.y, makeDrop); // what was lost in a valley
    // and maybe a relic of the old world, of a set that is found in places like this
    maybeRelic(state, relicPlace(state, runId, c.relicPlace ?? {}), RELIC_CHANCE.chest, c.x, c.y, rng);
    state.floaters.push({ x: c.x, y: c.y - 24, text: `+${gold}g`, color: '#ffd54f', t: 0, dur: 1.4 });
  }
}
