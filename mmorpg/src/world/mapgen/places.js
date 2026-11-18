// Where things are: the start, the Ring and the places of the recipe (each a region with the land it needs), the
// danger tier of every region (it grows with the walking distance from the start), the biome of every region, and then
// the spots for towns, lairs, dungeons, camps and hidden valleys.
import { fbm } from '../../core/noise.js';
import { generateTown, TT, TOWN_KINDS } from '../towngen.js';
import { K, isMount, walkDistance } from './terrain.js';
import { stream, between, intBetween, pickOne, clamp, dist, sinTurn, cosTurn } from './util.js';

export const F = { RESERVED: 1, VRING: 2, VIN: 4, REACH: 8, ROAD: 16, RAMP: 32 }; // flags per tile (RAMP: relief.js)

// The start: on the southern shore of the continent, with room for its town.
export function chooseStart(m) {
  const { N, G, C, ck } = m;
  const rng = stream(m.seed, 'start');
  const coast = coastDistance(m);
  m.coast = coast;
  const cand = [];
  for (let gy = Math.floor(G * 0.64); gy < G - 4; gy++) {
    for (let gx = Math.floor(G * 0.22); gx < Math.floor(G * 0.78); gx++) {
      const i = gy * G + gx;
      if (ck[i] !== K.LAND || coast[i] < 3 || coast[i] > 8 || !seaToTheSouth(m, gx, gy)) continue;
      cand.push(i);
    }
  }
  for (let tries = 0; tries < 300 && cand.length; tries++) {
    const i = pickOne(rng, cand);
    const x = (i % G) * C + C / 2;
    const y = Math.floor(i / G) * C + C / 2;
    const town = fitTown(m, x, y, 'town', Math.floor(rng() * 2 ** 31));
    if (town) return town;
  }
  throw new Error('no room for the start');
}

// The open sea lies south within a few dozen cells (not just a lake nearby).
function seaToTheSouth(m, gx, gy) {
  for (let y = gy; y < Math.min(m.G, gy + 14); y++) {
    if (m.ck[y * m.G + gx] === K.WATER) {
      let n = 0;
      for (let yy = y; yy < Math.min(m.G, y + 10); yy++) if (m.ck[yy * m.G + gx] === K.WATER) n++;
      return n >= 8;
    }
  }
  return false;
}

// Coarse cells from the nearest water, counted in cells (water itself is 0).
function coastDistance(m) {
  const { G, ck } = m;
  const d = new Int32Array(G * G).fill(-1);
  const q = [];
  for (let i = 0; i < G * G; i++) if (ck[i] === K.WATER) { d[i] = 0; q.push(i); }
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    const x = i % G;
    const y = (i - x) / G;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= G || ny >= G) continue;
      const j = ny * G + nx;
      if (d[j] < 0) { d[j] = d[i] + 1; q.push(j); }
    }
  }
  return d;
}

// Is every tile within r of (x, y) open land (no water, mountain, river, nothing reserved)?
export function clear(m, x, y, rx, ry = rx) {
  const { N, kind, river, flags } = m;
  for (let yy = Math.floor(y - ry); yy <= Math.ceil(y + ry); yy++) {
    for (let xx = Math.floor(x - rx); xx <= Math.ceil(x + rx); xx++) {
      if (xx < 0 || yy < 0 || xx >= N || yy >= N) return false;
      const k = yy * N + xx;
      if (kind[k] !== K.LAND || river[k] || flags[k] & F.RESERVED) return false;
    }
  }
  return true;
}

export function reserve(m, x, y, rx, ry = rx) {
  const { N, flags } = m;
  for (let yy = Math.max(0, Math.floor(y - ry)); yy <= Math.min(N - 1, Math.ceil(y + ry)); yy++) {
    for (let xx = Math.max(0, Math.floor(x - rx)); xx <= Math.min(N - 1, Math.ceil(x + rx)); xx++) flags[yy * N + xx] |= F.RESERVED;
  }
}

// A town of this kind centred at (x, y), if it fits: its layout is made, then its whole box (and a margin) must be
// open land. Returns { x, y, kind, layout, seed } or null.
export function fitTown(m, x, y, kind, seed) {
  const { N, kind: K2, river } = m;
  const cx = Math.round(x);
  const cy = Math.round(y);
  const most = TOWN_KINDS[kind].half[1];
  if (!clear(m, cx, cy, most + 9)) return null; // quick: even the biggest town of the kind would fit
  const layout = generateTown({ seed, kind, land: (dx, dy) => { const k = (cy + dy) * N + cx + dx; return K2[k] === K.LAND && !river[k]; } });
  if (!clear(m, cx, cy, layout.hx + 9, layout.hy + 9)) return null;
  return { x: cx, y: cy, kind, layout, seed };
}

// Every region's walking distance from the start, the Ring (the farthest open land at the foot of the northern wall),
// progress and tier.
export function measure(m, start) {
  const { G, C, ck, regions, cregion, recipe } = m;
  const d = walkDistance(m, start.x, start.y);
  m.dStart = d;
  for (const R of regions) { R.dSum = 0; R.dn = 0; }
  for (let i = 0; i < G * G; i++) {
    const r = cregion[i];
    if (r === 255 || ck[i] !== K.LAND || d[i] === Infinity) continue;
    regions[r].dSum += d[i];
    regions[r].dn++;
  }
  // the Ring: the open cell farthest from the start among those at the foot of the wall
  // (or, when the land never meets the wall, the farthest in the north)
  let ring = -1;
  for (const strict of [true, false]) {
    for (let i = 0; i < G * G && (strict || ring < 0); i++) {
      if (ck[i] !== K.LAND || d[i] === Infinity) continue;
      const gy = Math.floor(i / G);
      if (gy > G * (strict ? 0.3 : 0.4) || (strict && !nearWall(m, i))) continue;
      if (ring < 0 || d[i] > d[ring]) ring = i;
    }
    if (ring >= 0) break;
  }
  for (let i = 0; i < G * G && ring < 0; i++) { // at worst: the farthest land that can be walked to at all
    if (ck[i] === K.LAND && d[i] !== Infinity && d[i] > 200 && (ring < 0 || d[i] > d[ring])) ring = i;
  }
  if (ring < 0) throw new Error('no place for the Ring');
  m.ringCell = ring;
  const far = d[ring];
  m.far = far;
  for (const R of regions) {
    const mean = R.dn ? R.dSum / R.dn : Infinity;
    R.walk = mean;
    // an island or a cut-off corner: as dangerous as its straight-line distance says, a little more
    R.progress = mean === Infinity ? clamp((dist(R.cx, R.cy, start.x, start.y) * 1.3) / far, 0, 1) : clamp(mean / far, 0, 1);
    R.island = mean === Infinity;
  }
}

function nearWall(m, i) {
  const { G, C, N, kind } = m;
  const gx = i % G;
  const gy = (i - gx) / G;
  for (let dy = -4; dy <= 0; dy++) {
    const y = (gy + dy) * C;
    if (y < 0) continue;
    if (kind[y * N + gx * C] === K.WALL) return true;
  }
  return false;
}

export const tierOf = (curve, p) => {
  let t = 0;
  for (let k = 0; k < curve.length; k++) if (p >= curve[k]) t = k;
  return t;
};

// The places of the recipe, each in a region that suits it; then the biome and tier of every region.
export function assignPlaces(m, start) {
  const { regions, recipe, cregion, G, C } = m;
  const rng = stream(m.seed, 'places');
  const startRegion = cregion[Math.floor(start.y / C) * G + Math.floor(start.x / C)];
  const ringRegion = cregion[m.ringCell];
  const used = new Map(); // region -> place id
  const placed = {};
  placed.start = { region: startRegion, x: start.x, y: start.y };
  used.set(startRegion, 'start');
  const rx = (m.ringCell % G) * C + C / 2;
  const ry = Math.floor(m.ringCell / G) * C + C / 2;
  placed.ring = { region: ringRegion, x: rx, y: ry };
  used.set(ringRegion, 'ring');
  const walkFrom = new Map([['start', m.dStart]]);
  const fromField = (id) => {
    if (!walkFrom.has(id)) walkFrom.set(id, walkDistance(m, placed[id].x, placed[id].y));
    return walkFrom.get(id);
  };
  const cellOf = (R) => Math.floor(R.cy / C) * G + Math.floor(R.cx / C);
  for (const P of recipe.places) {
    if (P.id === 'start' || P.id === 'ring') { regions[placed[P.id].region].place = P.id; continue; }
    let best = null;
    // when no region fits, the demands ease: first the neighbour rule, then distances grow, then the tier band goes
    for (let ease = 0; ease < 4 && !best; ease++) {
    const c0 = P.region ?? {};
    const c = {
      ...c0,
      adjacent: ease >= 1 ? undefined : c0.adjacent,
      near: c0.near && { ...c0.near, max: c0.near.max * (ease >= 2 ? 1.6 : 1), min: ease >= 2 ? 0 : c0.near.min },
      progress: ease >= 3 ? undefined : c0.progress,
      share: ease >= 3 ? true : c0.share,
    };
    let bestScore = Infinity;
    for (const R of regions) {
      if (!R.cells || R.island) continue;
      if (used.has(R.id) && !(c.share && used.get(R.id) !== 'start' && used.get(R.id) !== 'ring' && (c.share === true || c.share === used.get(R.id)))) continue;
      if (c.progress && (R.progress < c.progress[0] || R.progress > c.progress[1])) continue;
      if (c.adjacent && !R.nbrs.includes(placed[c.adjacent].region)) continue;
      if (c.north && R.cy > m.N * c.north) continue;
      let score = rng() * 0.2;
      if (c.near) {
        const field = fromField(c.near.place);
        const d = nearestWalk(m, field, R);
        if (d < (c.near.min ?? 0) || d > c.near.max) continue;
        score += d / c.near.max;
      }
      if (c.progress) score += Math.abs(R.progress - (c.progress[0] + c.progress[1]) / 2) * 2;
      if (P.biome && !compatible(m, R, P.biome)) score += 0.6; // a region next to snow would rather not be desert
      if (P.biome === 'snow') score += (R.cy / m.N) * 2; // snow belongs in the cold north
      if (P.biome === 'desert') score += Math.abs(R.cy / m.N - 0.55); // and sand in the warm middle
      score -= Math.min(R.cells, 900) / 3000; // bigger is better
      if (score < bestScore) { bestScore = score; best = R; }
    }
    if (best && ease) (m.eased ??= []).push(P.id);
    }
    if (!best) throw new Error('no region for ' + P.id);
    best.place = best.place ?? P.id;
    used.set(best.id, P.id);
    placed[P.id] = { region: best.id, x: best.cx, y: best.cy };
    if (P.biome) best.forced = P.biome;
  }
  regions[startRegion].forced = 'grass';
  regions[ringRegion].forced = 'snow';
  m.placed = placed;
  // biomes: forced ones first, then a climate for the rest (colder to the north, drier inland in the middle)
  const s = m.seed % 100000;
  for (const R of regions) {
    if (!R.cells) continue;
    if (R.forced) { R.biome = R.forced; continue; }
    const ny = R.cy / m.N;
    const cold = ny + 0.08 * (fbm(R.cx / 200, R.cy / 200, s + 51, 2) - 0.5) * 2;
    const dry = fbm(R.cx / 260, R.cy / 260, s + 52, 3);
    const wet = fbm(R.cx / 180 + 3, R.cy / 180, s + 53, 3);
    if (cold < 0.27) R.biome = 'snow';
    else if (dry > 0.6 && ny > 0.3) R.biome = 'desert';
    else if (wet > 0.57) R.biome = 'forest';
    else R.biome = 'grass';
  }
  for (const R of regions) { // desert never borders snow (unless a place insists)
    if (R.forced || R.biome !== 'desert') continue;
    if (R.nbrs.some((n) => regions[n].biome === 'snow')) R.biome = 'grass';
  }
  for (const R of regions) {
    R.tier = R.id === ringRegion ? recipe.tierCurve.length - 1 : tierOf(recipe.tierCurve, R.progress);
  }
}

function compatible(m, R, biome) {
  if (biome === 'desert') return !R.nbrs.some((n) => m.regions[n].forced === 'snow' || m.regions[n].biome === 'snow');
  if (biome === 'snow') return !R.nbrs.some((n) => m.regions[n].forced === 'desert');
  return true;
}

// The walking distance from a field's source to the nearest cell of a region.
function nearestWalk(m, field, R) {
  const { G, cregion } = m;
  let best = Infinity;
  for (let i = 0; i < G * G; i++) if (cregion[i] === R.id && field[i] < best) best = field[i];
  return best;
}

// A spot of open land of radius r in a region (or anywhere when region is null), scored by `score(x, y)` (lower is
// better). Tries a number of random cells of the region.
export function findSpot(m, region, r, rng, score = () => 0, tries = 140) {
  const { G, C, cregion, ck } = m;
  const cells = region === null ? null : m.regionCells[region];
  let best = null;
  let bestScore = Infinity;
  for (let k = 0; k < tries; k++) {
    let i;
    if (cells) {
      if (!cells.length) return null;
      i = cells[Math.floor(rng() * cells.length)];
    } else {
      i = Math.floor(rng() * G * G);
    }
    if (ck[i] !== K.LAND) continue;
    const x = (i % G) * C + Math.floor(rng() * C);
    const y = Math.floor(i / G) * C + Math.floor(rng() * C);
    if (!clear(m, x, y, r)) continue;
    const sc = score(x, y);
    if (sc < bestScore) { bestScore = sc; best = { x, y }; }
  }
  return best;
}

// Towns, boss lairs, dungeons, camps, hidden valleys and the Ring: spots on the map (array coordinates), each with
// the region, biome and tier of where it stands. Nothing about bosses or camps beyond what the recipe names: the game
// picks those from its data.
export function placeSites(m, start) {
  const { regions, recipe, placed, G, C, cregion } = m;
  const rng = stream(m.seed, 'sites');
  m.regionCells = regions.map(() => []);
  for (let i = 0; i < G * G; i++) if (cregion[i] !== 255 && m.ck[i] === K.LAND) m.regionCells[cregion[i]].push(i);
  const regionAt = (x, y) => cregion[Math.floor(y / C) * G + Math.floor(x / C)];
  const info = (x, y) => {
    const R = regions[regionAt(x, y)] ?? regions[0];
    return { region: R.id, biome: R.biome, tier: R.tier };
  };
  const towns = [];
  const addTown = (t, role) => {
    reserve(m, t.x, t.y, t.layout.hx + 8, t.layout.hy + 8);
    towns.push({ ...t, role, ...info(t.x, t.y) });
  };
  addTown(start, 'start');
  const lairs = [];
  const dungeons = [];
  const camps = [];
  const story = {};
  const spots = {}; // small named places of the side stories (a farm, a glade): id -> spot
  const srng = stream(m.seed, 'spots'); // their own stream, so adding one does not move everything else
  const townGap = recipe.fill.towns.minGap;
  const farFromTowns = (x, y, gap) => towns.every((t) => dist(t.x, t.y, x, y) > gap);
  // the places of the recipe
  for (const P of recipe.places) {
    const R = regions[placed[P.id].region];
    if (P.town && P.id !== 'start') {
      let t = null;
      // in its region if it fits, else as near to it as the land allows
      for (let k = 0; k < 600 && !t; k++) {
        const wide = k > 150;
        const spot = wide
          ? { x: Math.round(R.cx + between(rng, -1, 1) * (40 + k / 4)), y: Math.round(R.cy + between(rng, -1, 1) * (40 + k / 4)) }
          : findSpot(m, R.id, 6, rng, (x, y) => dist(x, y, R.cx, R.cy) / 40 + rng(), 20);
        if (spot && farFromTowns(spot.x, spot.y, townGap)) t = fitTown(m, spot.x, spot.y, P.town.kind, Math.floor(rng() * 2 ** 31));
      }
      if (!t) throw new Error('no room for the town of ' + P.id);
      addTown(t, P.id);
      story[P.id] = t;
      placed[P.id].x = t.x;
      placed[P.id].y = t.y;
    }
    if (P.dungeon) {
      const near = placed[P.dungeon.near ?? P.id];
      const spot = findSpot(m, R.id, 7, rng, (x, y) => dist(x, y, near.x, near.y) / 100 + (farFromTowns(x, y, 30) ? 0 : 5));
      if (!spot) throw new Error('no room for the dungeon of ' + P.id);
      reserve(m, spot.x, spot.y, 7);
      const d = { ...spot, theme: P.dungeon.theme, story: P.id, ...info(spot.x, spot.y) };
      dungeons.push(d);
      story[P.id] = d;
    }
    if (P.lair) {
      const from = placed[P.lair.near ?? 'start'];
      const lairScore = (x, y) => Math.abs(dist(x, y, from.x, from.y) - (P.lair.dist ?? 0)) / 100 + (farFromTowns(x, y, 40) ? 0 : 5);
      // in its region, or failing that anywhere around at about the same distance
      const spot = findSpot(m, R.id, 23, rng, lairScore) ?? findSpot(m, null, 23, rng, (x, y) => lairScore(x, y) + (regions[regionAt(x, y)]?.island ? 9 : 0), 4000);
      if (spot) {
        reserve(m, spot.x, spot.y, 22);
        lairs.push({ ...spot, bossId: P.lair.bossId, story: P.id, ...info(spot.x, spot.y) });
      }
    }
    for (const def of P.camps ?? []) {
      const near = placed[P.id];
      const spot = findSpot(m, R.id, 5, rng, (x, y) => dist(x, y, near.x, near.y) / 200 + (farFromTowns(x, y, 26) ? 0 : 5));
      if (spot && farFromTowns(spot.x, spot.y, 26)) {
        reserve(m, spot.x, spot.y, 5);
        camps.push({ ...spot, def, ...info(spot.x, spot.y) });
      }
    }
    // spots: in the region of the place, at a distance from the start town or from another spot ([min, max] tiles)
    for (const S of P.spots ?? []) {
      const from = S.from ? spots[S.from] : towns[0];
      const [lo, hi] = S.dist ?? [0, 1e9];
      const score = (x, y) => {
        const d = dist(x, y, from.x, from.y);
        return (d < lo || d > hi ? 10 : 0) + Math.abs(d - (lo + hi) / 2) / 100 + (farFromTowns(x, y, S.r + 24) ? 0 : 5) +
          ([...camps, ...lairs].some((c) => dist(c.x, c.y, x, y) < S.r + 32) ? 5 : 0); // not next to a den
      };
      const spot = findSpot(m, R.id, S.r + 2, srng, score, 400) ??
        findSpot(m, null, S.r + 2, srng, (x, y) => score(x, y) + (regions[regionAt(x, y)]?.island ? 50 : 0), 4000);
      if (!spot) throw new Error('no room for the spot ' + S.id);
      reserve(m, spot.x, spot.y, S.r + 2);
      spots[S.id] = { ...spot, id: S.id, r: S.r, look: S.look ?? S.id, place: P.id, ...info(spot.x, spot.y) };
    }
  }
  // the Ring: open ground at the foot of the wall
  const ringSpot = findSpot(m, regionAt(placed.ring.x, placed.ring.y), 9, rng, (x, y) => dist(x, y, placed.ring.x, placed.ring.y) / 50) ??
    findSpot(m, null, 9, rng, (x, y) => dist(x, y, placed.ring.x, placed.ring.y), 3000);
  reserve(m, ringSpot.x, ringSpot.y, 10);
  const ring = { ...ringSpot, ...info(ringSpot.x, ringSpot.y), tier: recipe.tierCurve.length - 1 };
  // more towns, smaller the farther out; at most the number of town names
  const F2 = recipe.fill;
  for (let k = 0; k < 400 && towns.length < F2.towns.max; k++) {
    const spot = findSpot(m, null, 6, rng, () => rng(), 1);
    if (!spot || !farFromTowns(spot.x, spot.y, townGap)) continue;
    const R = regions[regionAt(spot.x, spot.y)];
    if (!R || R.island) continue;
    const kinds = F2.towns.kinds[Math.min(R.tier, F2.towns.kinds.length - 1)];
    const t = fitTown(m, spot.x, spot.y, pickOne(rng, kinds), Math.floor(rng() * 2 ** 31));
    if (t) addTown(t, null);
  }
  // a boss lair in most regions out of the cradle
  for (const R of regions) {
    if (!R.cells || R.tier < F2.lairs.minTier || R.cells < 120) continue;
    if (rng() > F2.lairs.chance) continue;
    const spot = findSpot(m, R.id, 23, rng, (x, y) => (farFromTowns(x, y, 45) ? 0 : 5) - dist(x, y, R.cx, R.cy) / 400 + rng());
    if (spot && farFromTowns(spot.x, spot.y, 40)) {
      reserve(m, spot.x, spot.y, 22);
      lairs.push({ ...spot, ...info(spot.x, spot.y) });
    }
  }
  // dungeons, out of the cradle
  const nd = intBetween(rng, F2.dungeons[0], F2.dungeons[1]);
  for (let k = 0; k < 200 && dungeons.length < nd + 3; k++) {
    const spot = findSpot(m, null, 7, rng, () => rng(), 1);
    if (!spot || !farFromTowns(spot.x, spot.y, 30)) continue;
    const R = regions[regionAt(spot.x, spot.y)];
    if (!R || R.tier < 1 || dungeons.some((d) => dist(d.x, d.y, spot.x, spot.y) < 90)) continue;
    reserve(m, spot.x, spot.y, 7);
    dungeons.push({ ...spot, ...info(spot.x, spot.y) });
  }
  // hidden valleys, out of the cradle
  const valleys = [];
  const nv = intBetween(rng, F2.valleys[0], F2.valleys[1]);
  for (let k = 0; k < 400 && valleys.length < nv; k++) {
    const r = intBetween(rng, 12, 19);
    const outer = Math.ceil(r * 1.22 + 3 + 4);
    const spot = findSpot(m, null, outer, rng, () => rng(), 1);
    if (!spot || !farFromTowns(spot.x, spot.y, outer + 16)) continue;
    const R = regions[regionAt(spot.x, spot.y)];
    if (!R || R.tier < F2.valleysMinTier || R.island) continue;
    const v = stampValley(m, spot.x, spot.y, r, rng);
    if (v) valleys.push({ ...v, ...info(spot.x, spot.y) });
  }
  // camps: spread over every region, more out where it is wilder; on the islands too
  for (const R of regions) {
    if (!R.cells) continue;
    const n = Math.round((R.cells / 600) * (F2.camps.density[Math.min(R.tier, F2.camps.density.length - 1)]));
    for (let k = 0; k < n; k++) {
      const spot = findSpot(m, R.id, 5, rng, () => rng(), 25);
      if (!spot || !farFromTowns(spot.x, spot.y, 22) || camps.some((c) => dist(c.x, c.y, spot.x, spot.y) < F2.camps.minGap)) continue;
      reserve(m, spot.x, spot.y, 5);
      camps.push({ ...spot, ...info(spot.x, spot.y) });
    }
  }
  Object.assign(m, { towns, lairs, dungeons, camps, valleys, ring, story, spots });
}

// A hidden valley: a ring of cliffs around a green patch, a cave with one mouth outside and one inside, chests in the
// middle. Marks VRING and VIN, and reserves its ground. Returns null if the ring would not close on open land.
function stampValley(m, x, y, r, rng) {
  const { N, flags } = m;
  const WALL = 3;
  const p1 = rng();
  const p2 = rng();
  const R = (a) => r * (1 + 0.14 * sinTurn(3 * a + p1) + 0.08 * sinTurn(5 * a + p2)); // a = turns
  const reach = Math.ceil(r * 1.22 + WALL + 4);
  if (!clear(m, x, y, reach)) return null;
  for (let yy = y - reach; yy <= y + reach; yy++) {
    for (let xx = x - reach; xx <= x + reach; xx++) {
      const dx = xx + 0.5 - (x + 0.5);
      const dy = yy + 0.5 - (y + 0.5);
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > r * 1.22 + WALL + 1) continue;
      const a = turnOf(dx, dy);
      const rr = R(a);
      const k = yy * N + xx;
      if (d < rr) flags[k] |= F.VIN;
      else if (d < rr + WALL) flags[k] |= F.VRING;
    }
  }
  reserve(m, x, y, reach);
  const a0 = rng();
  const rr = R(a0);
  const outer = { x: Math.round(x + cosTurn(a0) * (rr + WALL + 3)), y: Math.round(y + sinTurn(a0) * (rr + WALL + 3)) };
  const inner = { x: Math.round(x + cosTurn(a0) * (rr - 3)), y: Math.round(y + sinTurn(a0) * (rr - 3)) };
  const n = 2 + (rng() < 0.5 ? 1 : 0);
  const chests = Array.from({ length: n }, (_, i) => {
    const a = a0 + 0.5 + (i - (n - 1) / 2) * 0.14;
    const d = r * (0.3 + 0.3 * rng());
    return { idx: i, x: Math.round(x + cosTurn(a) * d), y: Math.round(y + sinTurn(a) * d) };
  });
  return { x, y, r, p1, p2, angle: a0, outer, inner, chests };
}

// The direction of (dx, dy) as a turn (0..1, 0 = east, 0.25 = south), without atan2: an octant and a rational fraction.
export function turnOf(dx, dy) {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax === 0 && ay === 0) return 0;
  const t = ax >= ay ? ay / ax : ax / ay; // 0..1, within one octant
  const a = t / 8 - (t * (t - 1) * (0.2447 + 0.0663 * t)) / 6.283185307179586; // atan(t) in turns, to about 1e-4
  let base = ax >= ay ? a : 0.25 - a;
  if (dx < 0) base = 0.5 - base;
  if (dy < 0) base = 1 - base;
  return base;
}
