// The map generator: one finite map, made from a seed and a recipe (data/maps/*.json), the same every time for the same
// pair, so it is never saved. In order: the shape of the land and the northern wall, mountain chains and lakes,
// rivers, the start, regions and how far each is from the start on foot, the places of the recipe and the biomes,
// the tiles, the spots for towns, lairs, dungeons, camps and valleys, roads, and a last check that everything that
// must be reached on foot can be (cutting a way through where it cannot). With `relief` (generator 5) the land also has
// levels of height, cliffs between them and ramps up them (relief.js).
// Coordinates: the arrays are N×N from (0,0) at the north-west; the world puts the start town's centre at tile (0,0),
// so world tile = array index + (x0, y0).
import { fbm } from '../../core/noise.js';
import { BIOME_IDS } from '../world.js';
import { TT, townTile } from '../towngen.js';
import { K, isMount, shapeLand, raiseMountains, coarsen, runRivers, cutRegions } from './terrain.js';
import { F, chooseStart, measure, assignPlaces, placeSites } from './places.js';
import { buildRoads } from './roads.js';
import { Heap, fingerprint } from './util.js';
import { shapeRelief, rampUp, makeRamp, stepOk } from './relief.js';

const ID = Object.fromEntries(BIOME_IDS.map((n, i) => [n, i]));
const TOWN_TILES = { [TT.STREET]: ID.town, [TT.YARD]: ID.yard, [TT.HOUSE]: ID.house, [TT.WALL]: ID.town_wall, [TT.FIELD]: ID.field };

const memo = new Map(); // "seed:recipe" -> map (the last few)

export function generateMap(seed, recipe, walkable, { fresh = false, relief = false } = {}) {
  const key = seed + ':' + recipe.id + (relief ? ':relief' : '');
  if (!fresh && memo.has(key)) return memo.get(key);
  // a seed whose land cannot hold the recipe tries again with a seed made from it: still the same map for that seed
  let out = null;
  let attempt = 0;
  for (; !out && attempt < 8; attempt++) {
    try {
      out = build(attempt ? (Math.imul(seed ^ 0x9e3779b9, attempt + 1) >>> 1) % 2147483647 : seed, recipe, walkable, relief);
    } catch (e) {
      if (attempt === 7) throw e;
    }
  }
  out.seed = seed;
  out.stats.attempts = attempt;
  memo.set(key, out);
  if (memo.size > 4) memo.delete(memo.keys().next().value);
  return out;
}

function build(seed, recipe, walkable, relief) {
  const ms = {};
  const t0 = now();
  const lap = (name) => { ms[name] = Math.round(now() - (lap.t ?? t0)); lap.t = now(); };
  const N = recipe.size;
  const C = recipe.coarse;
  const m = { seed, recipe, N, C, G: N / C };
  m.flags = new Uint8Array(N * N);
  shapeLand(m); lap('land');
  raiseMountains(m); lap('mountains');
  coarsen(m);
  runRivers(m); lap('rivers');
  const start = chooseStart(m);
  cutRegions(m);
  measure(m, start);
  assignPlaces(m, start); lap('places');
  placeSites(m, start); lap('sites');
  buildRoads(m); lap('roads');
  if (relief && recipe.relief) { shapeRelief(m); lap('relief'); }
  const tiles = raster(m); lap('tiles');
  if (m.height) { rampUp(m, tiles, walkable); lap('ramps'); }
  const repairs = reach(m, tiles, walkable); lap('reach');
  const out = output(m, tiles, start, repairs);
  out.stats = { ms, total: Math.round(now() - t0), repairs, eased: m.eased ?? [] };
  return out;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// The tiles: water, mountains, rivers and fords, roads and bridges, the cliffs of the valleys and the green inside them,
// the towns, and everywhere else the biome of the region (its borders ragged, with clearings and groves, beaches on
// the shore).
function raster(m) {
  const { N, C, G, kind, river, flags, cregion, regions, seed } = m;
  const s = seed % 100000;
  const tiles = new Uint8Array(N * N);
  // tiles from the water, up to 3
  const wd = new Uint8Array(N * N).fill(9);
  for (let k = 0; k < N * N; k++) if (kind[k] === K.WATER) wd[k] = 0;
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 1; y < N - 1; y++) {
      for (let x = 1; x < N - 1; x++) {
        const k = y * N + x;
        const v = Math.min(wd[k - 1], wd[k + 1], wd[k - N], wd[k + N]) + 1;
        if (v < wd[k]) wd[k] = v;
      }
    }
  }
  const spacing = m.recipe.regionSpacing / C;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const k = y * N + x;
      const kk = kind[k];
      if (flags[k] & F.VRING) { tiles[k] = ID.cliff; continue; }
      if (flags[k] & F.VIN) { tiles[k] = fbm(x / 9, y / 9, s + 6100, 2) > 0.56 ? ID.forest : ID.grass; continue; }
      if (flags[k] & F.ROAD && kk !== K.WATER) { tiles[k] = river[k] ? ID.bridge : ID.road; continue; }
      if (flags[k] & F.ROAD) { tiles[k] = ID.bridge; continue; }
      if (kk === K.WATER) { tiles[k] = ID.water; continue; }
      if (isMount(kk)) { tiles[k] = ID.mountain; continue; }
      if (river[k] === 1) { tiles[k] = ID.river; continue; }
      if (river[k] === 2) { tiles[k] = ID.ford; continue; }
      // the region, looked up a little off to the side, so borders wind and interlock
      const wx = x / C + (fbm(x / 22, y / 22, s + 61, 2) - 0.5) * spacing * 0.22;
      const wy = y / C + (fbm(x / 22 + 4, y / 22, s + 62, 2) - 0.5) * spacing * 0.22;
      const gx = Math.max(0, Math.min(G - 1, Math.floor(wx)));
      const gy = Math.max(0, Math.min(G - 1, Math.floor(wy)));
      let r = cregion[gy * G + gx];
      if (r === 255) r = cregion[Math.floor(y / C) * G + Math.floor(x / C)];
      const biome = regions[r]?.biome ?? 'grass';
      const v = fbm(x / 16, y / 16, s + 63, 3);
      let id = ID[biome];
      if (biome === 'forest' && v > 0.64) id = ID.grass; // a clearing
      else if (biome === 'grass' && v > 0.67) id = ID.forest; // a grove
      else if (biome === 'snow' && v > 0.7) id = ID.forest; // dark firs in the snow
      if (wd[k] <= 2 && biome !== 'snow' && fbm(x / 10, y / 10, s + 64, 2) > 0.36) id = ID.beach;
      tiles[k] = id;
    }
  }
  // the towns, on top
  for (const t of m.towns) {
    const L = t.layout;
    for (let ly = 0; ly < L.h; ly++) {
      for (let lx = 0; lx < L.w; lx++) {
        const v = townTile(L, lx, ly);
        if (v === TT.OUT) continue;
        const x = t.x - L.hx + lx;
        const y = t.y - L.hy + ly;
        tiles[y * N + x] = v === TT.WALL && L.wall === 'palisade' ? ID.palisade : TOWN_TILES[v];
      }
    }
  }
  for (const S of Object.values(m.spots)) stampSpot(m, tiles, S);
  return tiles;
}

// A spot of a side story: open ground with a ragged edge; a farm also gets its cottage (house tiles: solid, the
// renderer draws the roof) and a fence round the yard with a gate to the south.
export const COTTAGE = { w: 4, h: 3, dy: -3 }; // the cottage's tiles, from the centre of the spot
function stampSpot(m, tiles, S) {
  const { N, seed } = m;
  const s = seed % 100000;
  for (let dy = -S.r - 2; dy <= S.r + 2; dy++) {
    for (let dx = -S.r - 2; dx <= S.r + 2; dx++) {
      const x = S.x + dx;
      const y = S.y + dy;
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      const d = Math.sqrt(dx * dx + dy * dy) + (fbm(x / 4, y / 4, s + 6400, 2) - 0.5) * 3;
      if (d <= S.r) tiles[y * N + x] = ID.grass;
    }
  }
  if (S.look !== 'farm') return;
  const fr = S.r - 1; // the fence: a ring of palisade, the gate three tiles wide in the south
  for (let dy = -fr; dy <= fr; dy++) {
    for (let dx = -fr; dx <= fr; dx++) {
      const edge = Math.abs(dx) === fr || Math.abs(dy) === fr;
      if (!edge || (dy === fr && Math.abs(dx) <= 1)) continue;
      tiles[(S.y + dy) * N + S.x + dx] = ID.palisade;
    }
  }
  for (let dy = 0; dy < COTTAGE.h; dy++) {
    for (let dx = 0; dx < COTTAGE.w; dx++) tiles[(S.y + COTTAGE.dy + dy) * N + S.x - 2 + dx] = ID.house;
  }
}

// Everything that matters must be reachable on foot from the start: a flood fill shows what is; for each place that is
// not, the cheapest way to the reached land is cut through (rock becomes ground, a river gets a ford, a chasm a
// bridge). Water is never crossed: places on islands are left to the boat.
// With relief the walk keeps to the rule of the levels (relief.js, stepOk): first every piece of land that is only cut
// off by a cliff of one level gets a ramp to what is reached, then the places that are still out of reach get a way
// cut, which climbs one level at a time (ramps where it does).
function reach(m, tiles, walkable) {
  const { N, flags } = m;
  const H = m.height;
  const start = m.towns[0];
  const cliffs = []; // [reached tile, its walkable neighbour one level up or down], found while flooding
  const flood = (seeds) => {
    const q = [...seeds];
    for (const k of q) flags[k] |= F.REACH;
    for (let h = 0; h < q.length; h++) {
      const k = q[h];
      const x = k % N;
      for (const n of [k - 1, k + 1, k - N, k + N]) {
        if (n < 0 || n >= N * N || (n === k - 1 && x === 0) || (n === k + 1 && x === N - 1)) continue;
        if (flags[n] & F.REACH || !walkable[tiles[n]]) continue;
        if (H && !stepOk(H, flags, k, n)) {
          if (H[k] - H[n] === 1 || H[n] - H[k] === 1) cliffs.push(k, n);
          continue;
        }
        flags[n] |= F.REACH;
        q.push(n);
      }
    }
  };
  flood([start.y * N + start.x]);
  if (H) { // land behind a cliff of one level: a ramp joins it (the flood that follows finds more)
    for (let i = 0; i < cliffs.length; i += 2) {
      const k = cliffs[i];
      const n = cliffs[i + 1];
      if (flags[n] & F.REACH || flags[n] & (F.VRING | F.VIN)) continue;
      if (H[k] > H[n]) makeRamp(m, tiles, walkable, k, n);
      else makeRamp(m, tiles, walkable, n, k);
      flood([n]);
    }
  }
  const targets = [
    ...m.towns.map((t) => ({ x: t.x, y: t.y, kind: 'town', ref: t })),
    ...m.lairs.map((l) => ({ x: l.x, y: l.y, kind: 'lair', ref: l })),
    ...m.dungeons.map((d) => ({ x: d.x, y: d.y, kind: 'dungeon', ref: d })),
    ...m.valleys.map((v) => ({ x: v.outer.x, y: v.outer.y, kind: 'valley', ref: v })),
    { x: m.ring.x, y: m.ring.y, kind: 'ring', ref: m.ring },
    ...m.camps.filter((c) => !m.regions[c.region]?.island).map((c) => ({ x: c.x, y: c.y, kind: 'camp', ref: c })),
    ...Object.values(m.spots).map((S) => ({ x: S.x, y: S.y + (S.look === 'farm' ? S.r - 1 : 0), kind: 'spot', ref: S })),
  ];
  let repairs = 0;
  for (const tg of targets) {
    const k0 = tg.y * N + tg.x;
    if (flags[k0] & F.REACH) continue;
    if (m.kind[k0] === K.WATER) continue;
    const path = cutThrough(m, tiles, walkable, k0);
    if (!path) { tg.ref.unreached = true; continue; }
    for (const k of path) {
      const id = tiles[k];
      if (walkable[id]) continue;
      if (id === ID.river) tiles[k] = ID.ford;
      else if (id === ID.chasm) tiles[k] = ID.bridge;
      else tiles[k] = ID.grass;
    }
    if (H) { // the way climbs one level at a time, from the reached end to the place
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1];
        const b = path[i];
        if (H[b] > H[a] + 1) H[b] = H[a] + 1;
        else if (H[b] < H[a] - 1) H[b] = H[a] - 1;
        if (H[a] !== H[b]) flags[H[a] > H[b] ? a : b] |= F.RAMP;
      }
    }
    repairs++;
    flood(path.filter((k) => !(flags[k] & F.REACH)));
  }
  return repairs;
}

// The cheapest line of tiles from k0 to land already reached (Dijkstra): open ground costs 1, rock and rivers more;
// water, valley rings and town walls cannot be cut.
function cutThrough(m, tiles, walkable, k0) {
  const { N, flags } = m;
  const d = new Map([[k0, 0]]);
  const prev = new Map();
  const heap = new Heap(4096);
  heap.push(k0, 0);
  let steps = 0;
  while (heap.size && steps++ < 400000) {
    const k = heap.pop();
    if (heap.lastPri > d.get(k)) continue;
    if (flags[k] & F.REACH) {
      const path = [];
      for (let c = k; c !== undefined; c = prev.get(c)) path.push(c);
      return path;
    }
    const x = k % N;
    for (const n of [k - 1, k + 1, k - N, k + N]) {
      if (n < 0 || n >= N * N || (n === k - 1 && x === 0) || (n === k + 1 && x === N - 1)) continue;
      const id = tiles[n];
      let c;
      if (walkable[id]) c = 1;
      else if (id === ID.water || id === ID.town_wall || id === ID.house || id === ID.palisade || flags[n] & (F.VRING | F.VIN)) continue;
      else if (id === ID.river) c = 6;
      else c = 14; // mountain, cliff, chasm
      if (m.height && !stepOk(m.height, flags, k, n)) c += 10; // a cliff to be cut into a ramp
      const nd = d.get(k) + c;
      if (nd < (d.get(n) ?? Infinity)) { d.set(n, nd); prev.set(n, k); heap.push(n, nd); }
    }
  }
  return null;
}

// The map as the world sees it: tiles and what stands where, in world coordinates (the start town at (0,0)).
function output(m, tiles, start, repairs) {
  const { N, flags, cregion, C, G, regions, recipe } = m;
  const x0 = -start.x;
  const y0 = -start.y;
  const W = (p) => ({ tx: p.x + x0, ty: p.y + y0 });
  const tierMap = new Uint8Array(G * G);
  for (let i = 0; i < G * G; i++) tierMap[i] = cregion[i] === 255 ? 0 : regions[cregion[i]].tier;
  const regionBiome = regions.map((R) => R.biome ?? 'grass');
  // town names: the start keeps the first, the others get the rest in a shuffled order
  const names = Array.from({ length: 23 }, (_, i) => i + 1);
  let h = m.seed >>> 0;
  for (let i = names.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const j = h % (i + 1);
    [names[i], names[j]] = [names[j], names[i]];
  }
  const towns = m.towns.map((t, i) => ({ ...W(t), id: `${t.x + x0},${t.y + y0}`, kind: t.kind, layout: t.layout, role: t.role, region: t.region, biome: t.biome, tier: t.tier, nameIndex: i === 0 ? 0 : names[(i - 1) % names.length] }));
  const site = (p, prefix) => {
    const w = W(p);
    return { ...p, ...w, id: `${prefix}:${w.tx},${w.ty}`, cx: w.tx, cy: w.ty };
  };
  const lairs = m.lairs.map((l) => site(l, 'l'));
  const dungeons = m.dungeons.map((d) => site(d, 'd'));
  const camps = m.camps.map((c) => site(c, 'k'));
  const valleys = m.valleys.map((v) => {
    const s = site(v, 'v');
    return {
      ...s, caveId: `c:${s.tx},${s.ty}`,
      outer: { tx: v.outer.x + x0, ty: v.outer.y + y0 }, inner: { tx: v.inner.x + x0, ty: v.inner.y + y0 },
      chests: v.chests.map((c) => ({ idx: c.idx, tx: c.x + x0, ty: c.y + y0 })),
    };
  });
  const ring = { ...site(m.ring, 'r'), id: 'r:ring' };
  const storyId = (p) => {
    const s = m.story[p];
    if (!s) return null;
    return s.layout ? `${s.x + x0},${s.y + y0}` : `d:${s.x + x0},${s.y + y0}`;
  };
  const plates = {};
  for (const P of recipe.places) if (P.dungeon?.plate) plates[P.dungeon.theme] = storyId(P.id);
  return {
    seed: m.seed, recipeId: recipe.id, size: N, coarse: C, x0, y0, tiles, flags, cregion, tierMap, regionBiome,
    regions: regions.map((R) => ({ id: R.id, cx: R.cx + x0, cy: R.cy + y0, biome: R.biome, tier: R.tier, progress: R.progress, island: R.island, place: R.place ?? null, nbrs: R.nbrs })),
    towns, lairs, dungeons, camps, valleys, ring,
    roads: m.roads.map((r) => ({ from: towns[r.from].id, to: towns[r.to].id, len: Math.round(r.len) })),
    story: { start: towns[0].id, road: storyId('road'), city: storyId('city'), capital: storyId('capital'), plates, ring: 'r:ring' },
    spots: Object.fromEntries(Object.values(m.spots).map((S) => [S.id, { id: S.id, ...W(S), r: S.r, look: S.look, region: S.region, biome: S.biome, tier: S.tier }])),
    islands: m.islands.map((i) => ({ tx: i.x + x0, ty: i.y + y0, r: i.r })),
    height: m.height ?? null, // levels 0-4 (relief.js), null on a map without relief
    fp: m.height ? fingerprint(tiles) + fingerprint(m.height.map((h, k) => h | (flags[k] & F.RAMP))) : fingerprint(tiles),
  };
}
