import { hash2, mulberry32 } from '../core/rng.js';
import { TILE, BIOME_IDS } from '../world/world.js';
import { valleyTileAt } from '../world/valleys.js';
import { tierAtTile } from './difficulty.js';
import { nearLairSite } from '../world/sites.js';
import { makeEnemy } from '../sim/enemy.js';

// Monster camps (data/camps.json): groups that live in fixed places of the open world, decided by the seed (a wolf den,
// a goblin camp, a slime pool...). A camp fills up when you come near; once every monster of it is dead it stays empty
// for a while (CAMP_REST, kept in the save), and its chest can be opened once (the chest is an open-world chest, its
// opening kept like a dungeon's under the camp id). When the rest is over, the camp is back, with a new chest.
export const CAMP_CELL = 48; // tiles: at most one camp per cell
export const CAMP_ID = /^k:(-?\d{1,5}),(-?\d{1,5})$/;
export const CAMP_REST = [300, 480]; // seconds a cleared camp stays empty
export const CAMP_WAKE = 900; // px: the camp fills up when you come this close
export const CAMP_SLEEP = 2200; // px: and its monsters go back to sleep (whole again) when you are this far
const CHANCE = 0.45;
const FROM_START = 25; // tiles: no camp right at the start
const TOWN_ROOM = 14; // tiles between a camp and a town
const LAIR_ROOM = 16; // tiles between a camp and where a boss lair may be
const SPREAD = 70; // px: how far around the centre the members stand

const cache = new WeakMap(); // world -> { defs, map }

export function campAt(world, cx, cy, campDefs) {
  if (!campDefs?.length || world.isDungeon) return null;
  let c = cache.get(world);
  if (!c || c.defs !== campDefs) cache.set(world, (c = { defs: campDefs, map: new Map() }));
  const key = cx + ',' + cy;
  if (c.map.has(key)) return c.map.get(key);
  c.map.set(key, null);
  let camp = null;
  const s = world.seed;
  const site = world.isMap ? world.placeById(`k:${cx},${cy}`) : null;
  if (site) { // the finite map: the spot is its own; the kind of camp is what it names, or one that fits the land
    const fits = campDefs.filter((d) => d.biomes.includes(site.biome) && d.minTier <= site.tier);
    const def = (site.def && campDefs.find((d) => d.id === site.def)) || fits[Math.floor(hash2(cx, cy, s + 5503) * fits.length)];
    if (def) camp = { id: site.id, cx, cy, tx: site.tx, ty: site.ty, px: site.px, py: site.py, tier: site.tier, def };
  } else if (!world.isMap && hash2(cx, cy, s + 5500) < CHANCE) {
    const tx = cx * CAMP_CELL + 8 + Math.floor(hash2(cx, cy, s + 5501) * (CAMP_CELL - 16));
    const ty = cy * CAMP_CELL + 8 + Math.floor(hash2(cx, cy, s + 5502) * (CAMP_CELL - 16));
    const px = (tx + 0.5) * TILE;
    const py = (ty + 0.5) * TILE;
    const open = (x, y) => (world.openGround ? world.openGround(x, y) : world.rawBiomeIdAt(x, y) > 0);
    const ok = Math.hypot(tx, ty) >= FROM_START && open(tx, ty) && [[3, 0], [-3, 0], [0, 3], [0, -3]].every(([dx, dy]) => open(tx + dx, ty + dy))
      && !world.townAtPx(px, py, TOWN_ROOM * TILE) && valleyTileAt(world, tx, ty) !== 1 && !nearLairSite(s, tx, ty, LAIR_ROOM);
    if (ok) {
      const biome = BIOME_IDS[world.rawBiomeIdAt(tx, ty)];
      const tier = tierAtTile(tx, ty);
      const fits = campDefs.filter((d) => d.biomes.includes(biome) && d.minTier <= tier);
      if (fits.length) {
        const def = fits[Math.floor(hash2(cx, cy, s + 5503) * fits.length)];
        camp = { id: `k:${cx},${cy}`, cx, cy, tx, ty, px, py, tier, def };
      }
    }
  }
  c.map.set(key, camp);
  return camp;
}

export function campsInRange(world, px, py, rangePx, campDefs) {
  if (world.isDungeon || !campDefs?.length) return [];
  if (world.isMap) return world.sitesInRange(world.campSites, px, py, rangePx).map((s) => campAt(world, s.cx, s.cy, campDefs)).filter(Boolean);
  const cell = CAMP_CELL * TILE;
  const out = [];
  for (let cy = Math.floor((py - rangePx) / cell) - 1; cy <= Math.floor((py + rangePx) / cell) + 1; cy++) {
    for (let cx = Math.floor((px - rangePx) / cell) - 1; cx <= Math.floor((px + rangePx) / cell) + 1; cx++) {
      const c = campAt(world, cx, cy, campDefs);
      if (c && Math.hypot(c.px - px, c.py - py) <= rangePx) out.push(c);
    }
  }
  return out;
}

// What is known about a camp: state.camps: id -> { rest: seconds left empty, woke: its monsters are out, round }.
const stateOf = (state, id) => state.camps?.get(id) ?? null;
export const campResting = (state, id) => (stateOf(state, id)?.rest ?? 0) > 0;

// Fills a camp with its monsters (the same ones every time for that camp and round).
function wake(state, camp) {
  const rng = mulberry32(Math.floor(hash2(camp.cx, camp.cy, state.world.seed + 5600 + (stateOf(state, camp.id)?.round ?? 0)) * 2 ** 31));
  const [lo, hi] = camp.def.size;
  const n = lo + Math.floor(rng() * (hi - lo + 1));
  const defs = camp.def.monsters.map((id) => state.enemyDefs.find((d) => d.id === id)).filter(Boolean);
  for (let i = 0; i < n && defs.length; i++) {
    const a = (i / n) * Math.PI * 2 + rng();
    const d = i === 0 ? 0 : 20 + rng() * SPREAD;
    let x = camp.px + Math.cos(a) * d;
    let y = camp.py + Math.sin(a) * d;
    if (!state.world.isWalkable(x, y)) { x = camp.px; y = camp.py; }
    const e = makeEnemy(defs[i % defs.length], x, y, camp.tier);
    e.camp = camp.id;
    state.enemies.push(e);
  }
}

// Every tick in the open world: rest timers, camps that wake as you come near, sleep when you leave, and are cleared
// when their last monster dies.
export function updateCamps(state, world, dt, campDefs, rng = Math.random) {
  state.camps ??= new Map();
  for (const [id, st] of state.camps) {
    if (st.rest > 0) {
      st.rest = Math.max(0, st.rest - dt);
      if (st.rest === 0) { // back: a new round, and the chest of the last one is gone
        st.round = (st.round ?? 0) + 1;
        state.dungeonRuns?.delete(id);
      }
    }
  }
  if (state.area || world.isDungeon) return;
  const p = state.player;
  // monsters of a camp you left far behind go back to sleep (the camp is whole again when you return)
  const far = new Set();
  for (const e of state.enemies) if (e.camp && e.hp > 0 && Math.hypot(e.home.x - p.x, e.home.y - p.y) > CAMP_SLEEP) far.add(e.camp);
  if (far.size) state.enemies = state.enemies.filter((e) => !far.has(e.camp));
  const awake = new Set(state.enemies.filter((e) => e.camp && e.hp > 0).map((e) => e.camp));
  for (const camp of campsInRange(world, p.x, p.y, CAMP_WAKE, campDefs)) {
    if (state.explored?.has(camp.tx, camp.ty)) state.discovered?.add(camp.id); // seen once, named on the screen
    const st = stateOf(state, camp.id);
    if (awake.has(camp.id) || st?.rest > 0 || st?.woke) continue;
    wake(state, camp);
    state.camps.set(camp.id, { ...(st ?? {}), rest: 0, woke: true });
  }
  // a camp whose monsters are all dead is cleared
  for (const [id, st] of state.camps) {
    if (!st.woke || awake.has(id)) continue;
    if (state.enemies.some((e) => e.camp === id && e.hp > 0)) continue;
    const sleeping = far.has(id);
    state.camps.set(id, sleeping ? { ...st, woke: false } : { ...st, woke: false, rest: CAMP_REST[0] + rng() * (CAMP_REST[1] - CAMP_REST[0]) });
  }
}

// The chest of a cleared camp, as an open-world chest (opened once per round).
export function campChests(state, world, campDefs) {
  const p = state.player;
  const out = [];
  for (const camp of campsInRange(world, p.x, p.y, 900, campDefs)) {
    const st = stateOf(state, camp.id);
    if (!st || !(st.rest > 0)) continue;
    const opened = (state.dungeonRuns?.get(camp.id)?.opened ?? []).includes(0);
    out.push({ idx: 0, x: camp.px + 26, y: camp.py - 18, opened, tier: camp.tier, run: camp.id, minRarity: 'common', camp: true });
  }
  return out;
}
