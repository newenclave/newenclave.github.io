import { mulberry32 } from '../core/rng.js';

// Settlements (generator 3), from a hamlet in its fields to a capital with a castle. Every one is planned on its own
// small tile grid from its seed: the size class sets the range of sizes, the wall, the street plans to choose from
// and what the place offers; the seed picks the size, the outline (a rectangle or eight-sided), the plan, where the
// square is and which houses become shops. Rects are half-open: { x0, y0, x1, y1 } covers x0 <= x < x1, y0 <= y < y1.

// Local tile codes. OUT is not part of the town (the ground there stays what it was, e.g. water).
export const TT = { OUT: 0, STREET: 1, YARD: 2, HOUSE: 3, WALL: 4, FIELD: 5 };

// half: [min, max] tiles from the centre to the edge, on each axis; square: half-size of the market square; weight: how
// common the class is; plans: street plans to pick from (a repeat makes one likelier); gardens: share of empty lots;
// ring: width of the street along the inside of the wall (default 2); dense: houses fill their blocks; stalls: [min, max] market stalls; landRing: tiles around the centre that must be dry (default square + 2);
// services: who works there, how many goods the merchant has and their lowest rarity. Who works where:
//   elder (the hall), merchant (the shop), blacksmith (the forge), priest (the church), innkeeper (the inn),
//   chronicler (the library) keep a house each near the square; the captain stands inside a gate, the ruler in front of
//   the keep of a capital's castle; a trader works at each market stall.
const VILLAGE = ['elder', 'merchant', 'blacksmith', 'priest', 'innkeeper'];
const TOWN = [...VILLAGE, 'captain'];
export const WARES = ['fletcher', 'jeweler', 'armorer', 'weaponsmith']; // what a market trader sells
const HOUSELESS = ['captain', 'ruler'];
export const TOWN_KINDS = {
  hamlet: {
    half: [8, 10], square: 2, weight: 25, wall: 'none', plans: ['green', 'green', 'street'], gardens: 0.2, stalls: [0, 0],
    services: { npcs: ['elder', 'merchant'], stock: 5, minRarity: null },
  },
  village: {
    half: [9, 12], square: 3, weight: 30, wall: 'palisade', ring: 1, plans: ['street', 'street', 'cross'], gardens: 0.1, stalls: [0, 2],
    services: { npcs: VILLAGE, stock: 8, minRarity: null },
  },
  town: {
    half: [12, 15], square: 5, weight: 25, wall: 'stone', plans: ['cross', 'street', 'grid'], gardens: 0.12, stalls: [2, 3],
    services: { npcs: TOWN, stock: 10, minRarity: null },
  },
  city: {
    half: [16, 19], square: 6, weight: 15, wall: 'stone', towers: true, dense: true, plans: ['grid', 'grid', 'cross'], gardens: 0.08,
    stalls: [3, 5], fountain: true, services: { npcs: [...TOWN, 'chronicler'], stock: 12, minRarity: 'uncommon' },
  },
  capital: {
    half: [21, 24], square: 6, weight: 5, wall: 'stone', towers: true, dense: true, castle: true, plans: ['grid', 'cross'], gardens: 0.05,
    stalls: [4, 6], fountain: true, landRing: 18, services: { npcs: [...TOWN, 'chronicler', 'ruler'], stock: 14, minRarity: 'uncommon' },
  },
};
export const MAX_HALF = 24;
const SIDE = 2; // side streets between blocks
const MAX_BLOCK = 11; // a block longer than this is cut by a side street
const CASTLE_W = 15; // the castle quarter of a capital: along the town wall, and inwards
const CASTLE_D = 11;

// The size class for a random number in [0, 1).
export function pickKind(h) {
  const kinds = Object.keys(TOWN_KINDS);
  const total = kinds.reduce((sum, k) => sum + TOWN_KINDS[k].weight, 0);
  let roll = h * total;
  for (const k of kinds) {
    roll -= TOWN_KINDS[k].weight;
    if (roll < 0) return k;
  }
  return kinds[kinds.length - 1];
}

const rect = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
const rw = (r) => r.x1 - r.x0;
const rh = (r) => r.y1 - r.y0;
const grow = (r, d) => rect(r.x0 - d, r.y0 - d, r.x1 + d, r.y1 + d);
const WALKABLE = [TT.STREET, TT.YARD, TT.FIELD];

function shuffle(list, rng) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/**
 * `r` minus `holes`, as non-overlapping rects (after the block carver of slop-newyork): the rect is sliced into strips
 * at every hole edge across the x axis, and neighbouring strips with identical spans are merged back, so an L-plan
 * comes out as two rects and a U-plan as its base bar plus two wings.
 */
export function carve(r, holes) {
  const cuts = [r.x0, r.x1];
  for (const h of holes) {
    if (h.x0 > r.x0 && h.x0 < r.x1) cuts.push(h.x0);
    if (h.x1 > r.x0 && h.x1 < r.x1) cuts.push(h.x1);
  }
  cuts.sort((a, b) => a - b);
  const out = [];
  let open = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const ua = cuts[i];
    const ub = cuts[i + 1];
    if (ub <= ua) continue;
    const um = (ua + ub) / 2;
    let spans = [[r.y0, r.y1]];
    for (const h of holes) {
      if (um <= h.x0 || um >= h.x1) continue;
      const next = [];
      for (const [a, b] of spans) {
        if (h.y1 <= a || h.y0 >= b) { next.push([a, b]); continue; }
        if (h.y0 > a) next.push([a, h.y0]);
        if (h.y1 < b) next.push([h.y1, b]);
      }
      spans = next;
    }
    const nextOpen = [];
    for (const [a, b] of spans) {
      let strip = open.find((o) => o[2] === a && o[3] === b);
      if (strip) strip[1] = ub;
      else out.push((strip = [ua, ub, a, b]));
      nextOpen.push(strip);
    }
    open = nextOpen;
  }
  return out.map(([x0, x1, y0, y1]) => rect(x0, y0, x1, y1));
}

// `land(dx, dy)`: is the tile dx, dy from the centre on land? Tiles over water are left out of the town; houses are
// never built there.
export function generateTown({ seed, kind = 'town', land: landAround = () => true }) {
  const rng = mulberry32(seed);
  const K = TOWN_KINDS[kind] ?? TOWN_KINDS.town;
  const plan = K.plans[Math.floor(rng() * K.plans.length)];
  const span = ([a, b]) => a + Math.floor(rng() * (b - a + 1));
  let hx = span(K.half);
  let hy = span(K.half);
  if (plan === 'street') { // stretched along its one street
    const long = Math.max(hx, hy);
    const short = Math.max(K.half[0], Math.min(hx, hy) - 2);
    [hx, hy] = rng() < 0.5 ? [long, short] : [short, long];
  }
  const w = 2 * hx + 1;
  const h = 2 * hy + 1;
  const land = (x, y) => landAround(x - hx, y - hy);
  const cut = !K.castle && rng() < 0.45 ? Math.floor(Math.min(hx, hy) * (0.3 + rng() * 0.2)) : 0; // eight-sided
  const RING = K.ring ?? 2;
  const inShape = (x, y) => x >= 0 && y >= 0 && x < w && y < h && Math.abs(x - hx) + Math.abs(y - hy) <= hx + hy - cut;
  const walled = K.wall !== 'none';

  const tiles = new Uint8Array(w * h);
  const get = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? TT.OUT : tiles[y * w + x]);
  const paint = (r, v, over) => {
    for (let y = Math.max(0, r.y0); y < Math.min(h, r.y1); y++) {
      for (let x = Math.max(0, r.x0); x < Math.min(w, r.x1); x++) if (over.includes(tiles[y * w + x])) tiles[y * w + x] = v;
    }
  };
  const blocked = (x, y) => get(x, y) !== TT.YARD || !land(x, y);
  const free = (r) => { // every tile an empty yard on dry land
    for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) if (blocked(x, y)) return false;
    return true;
  };
  // The biggest free rect inside a lot (the lot itself when nothing is in the way), so houses still fit where the wall
  // of an eight-sided town or the shore cuts across their lot. Lots are small: trying every rect is cheap.
  const trim = (r) => {
    let best = null;
    for (let y0 = r.y0; y0 < r.y1; y0++) {
      for (let x0 = r.x0; x0 < r.x1; x0++) {
        for (let y1 = y0 + 2; y1 <= r.y1; y1++) {
          for (let x1 = x0 + 2; x1 <= r.x1; x1++) {
            const t = rect(x0, y0, x1, y1);
            if ((!best || rw(t) * rh(t) > rw(best) * rh(best)) && free(t)) best = t;
          }
        }
      }
    }
    return best && rw(best) * rh(best) >= 4 ? best : null;
  };

  // the wall where the outside is next to a tile (corners too, so it has no diagonal gaps), the ring street inside it;
  // a hamlet has no wall, only fields all round
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inShape(x, y)) continue;
      let d = RING + 2;
      for (let r = 1; r <= RING + 1 && d > RING + 1; r++) {
        for (let dy = -r; dy <= r && d > RING + 1; dy++) for (let dx = -r; dx <= r; dx++) if (!inShape(x + dx, y + dy)) { d = r; break; }
      }
      let v = plan === 'green' ? TT.FIELD : TT.YARD;
      if (d === 1) v = walled ? TT.WALL : TT.FIELD;
      else if (d <= RING + 1 && walled) v = TT.STREET;
      tiles[y * w + x] = v;
    }
  }

  const MAIN = [TT.YARD, TT.STREET, TT.WALL, TT.FIELD]; // main streets run through everything, the wall too (gates)
  const LANE = [TT.YARD]; // side streets only through what is still empty
  const lo = walled ? 1 + RING : 1;
  const ctx = { rng, K, w, h, hx, hy, lo, paint, MAIN, LANE };
  const { plaza, districts, gateLines } = PLANS[plan](ctx);
  paint(plaza, TT.STREET, [TT.YARD, TT.FIELD]);

  const buildings = [];
  const build = (r, k, pieces = [r]) => {
    for (const p of pieces) paint(p, TT.HOUSE, [TT.YARD, TT.FIELD, TT.STREET]);
    const b = { ...r, kind: k, pieces, roof: Math.floor(rng() * 6) };
    buildings.push(b);
    return b;
  };

  // a capital's castle: its own wall with a gate towards the town, a courtyard, and the keep in the middle
  let castle = null;
  if (K.castle) {
    castle = castleQuarter(ctx, plaza);
    paint(grow(castle.outer, 1), TT.STREET, [TT.YARD, TT.FIELD]);
    paint(castle.outer, TT.WALL, MAIN.concat(TT.HOUSE));
    paint(grow(castle.outer, -1), TT.STREET, [TT.WALL]);
    paint(castle.gate, TT.STREET, [TT.WALL]);
    build(castle.keep, 'castle');
  }

  const blocks = [];
  const split = (r) => {
    const bw = rw(r);
    const bh = rh(r);
    if (bw < 3 || bh < 3) return;
    if (Math.max(bw, bh) <= MAX_BLOCK) { blocks.push(r); return; }
    if (bw >= bh) {
      const s = r.x0 + Math.floor(bw / 2 - SIDE / 2 + (rng() - 0.5) * bw * 0.3);
      paint(rect(s, r.y0, s + SIDE, r.y1), TT.STREET, LANE);
      split(rect(r.x0, r.y0, s, r.y1));
      split(rect(s + SIDE, r.y0, r.x1, r.y1));
    } else {
      const s = r.y0 + Math.floor(bh / 2 - SIDE / 2 + (rng() - 0.5) * bh * 0.3);
      paint(rect(r.x0, s, r.x1, s + SIDE), TT.STREET, LANE);
      split(rect(r.x0, r.y0, r.x1, s));
      split(rect(r.x0, s + SIDE, r.x1, r.y1));
    }
  };
  const keepOut = castle ? [grow(castle.outer, 1)] : [];
  for (const d of districts) for (const piece of carve(d, keepOut)) split(piece);

  // houses: lots along the long side of each block, one row (or two rows back to back with gardens between)
  for (const b of blocks) {
    const along = rw(b) >= rh(b);
    const len = along ? rw(b) : rh(b);
    const depth = along ? rh(b) : rw(b);
    const deep = (max) => (K.dense ? max : Math.min(max, 3 + Math.floor(rng() * 3)));
    let rows;
    if (depth >= 8) {
      const half = Math.floor((depth - 1) / 2);
      rows = [[0, deep(half)], [depth - deep(half), depth]];
    } else {
      const d = deep(depth);
      rows = [rng() < 0.5 ? [0, d] : [depth - d, depth]];
      if (K.dense && depth >= 6) rows = [[0, depth]];
    }
    for (const [d0, d1] of rows) {
      let at = 0;
      while (at < len) {
        let lot = 3 + Math.floor(rng() * 3);
        if (len - (at + lot + 1) < 2) lot = len - at; // the last lot takes what is left
        const end = Math.min(len, at + lot);
        const r = along ? rect(b.x0 + at, b.y0 + d0, b.x0 + end, b.y0 + d1) : rect(b.x0 + d0, b.y0 + at, b.x0 + d1, b.y0 + end);
        at = end + 1; // an alley between houses
        const plot = rw(r) >= 2 && rh(r) >= 2 && rng() >= K.gardens ? trim(r) : null;
        if (!plot || rw(plot) < 2 || rh(plot) < 2) continue; // a garden
        build(plot, 'house', shapeHouse(plot, rng, along, d0 === 0));
      }
    }
  }
  if (plan === 'green') scatterHouses(ctx, get, land, build);

  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!land(x, y)) tiles[y * w + x] = TT.OUT;
  for (const b of buildings) {
    if (b.pieces.some((p) => { for (let y = p.y0; y < p.y1; y++) for (let x = p.x0; x < p.x1; x++) if (!land(x, y)) return true; return false; })) b.pieces = [];
  }

  const square = { x: (plaza.x0 + plaza.x1) / 2, y: (plaza.y0 + plaza.y1) / 2 };
  const npcs = placeKeepers(ctx, get, buildings, plaza, square);
  const stalls = placeStalls(ctx, get, plaza, square, npcs);
  const gates = gateLines.map(([x0, y0, dx, dy]) => {
    let x = x0;
    let y = y0;
    while (inShape(x + dx, y + dy)) { x += dx; y += dy; }
    return { side: dx ? (dx > 0 ? 'e' : 'w') : dy > 0 ? 's' : 'n', x, y, dx, dy };
  });
  placeGuards(ctx, get, npcs, gates, castle);
  const towers = K.towers || castle ? placeTowers(get, w, h, K.towers ? null : castle.outer) : [];
  return {
    kind, plan, hx, hy, w, h, tiles, buildings, npcs, gates, plaza, stalls, towers, castle,
    well: { ...square, fountain: !!K.fountain }, wall: K.wall, services: K.services, square: K.square,
  };
}

// ---- street plans. Each paints its streets and returns the market square, the districts left for houses (rects, to be
// cut into blocks) and the gate lines: [x, y, dx, dy] = from a point on a main street outwards until the edge.
const FOUR_WAYS = (hx, hy) => [[hx, hy, 0, -1], [hx, hy, 0, 1], [hx, hy, -1, 0], [hx, hy, 1, 0]];

const PLANS = {
  // two main streets crossing at a square in the middle, four gates
  cross({ K, w, h, hx, hy, lo, paint, MAIN }) {
    paint(rect(hx - 1, 0, hx + 2, h), TT.STREET, MAIN);
    paint(rect(0, hy - 1, w, hy + 2), TT.STREET, MAIN);
    const s = K.square;
    const plaza = rect(hx - s, hy - s, hx + s + 1, hy + s + 1);
    const quarters = [rect(lo, lo, hx - 1, hy - 1), rect(hx + 2, lo, w - lo, hy - 1), rect(lo, hy + 2, hx - 1, h - lo), rect(hx + 2, hy + 2, w - lo, h - lo)];
    return { plaza, districts: quarters.flatMap((q) => carve(q, [plaza])), gateLines: FOUR_WAYS(hx, hy) };
  },

  // one long street from gate to gate with the square on it (not always in the middle), lanes across it, sometimes a
  // third gate at the end of a lane
  street({ rng, K, w, h, hx, hy, lo, paint, MAIN, LANE }) {
    const horiz = w >= h;
    const L = horiz ? w : h;
    const V = horiz ? h : w;
    const cu = horiz ? hx : hy;
    const cv = horiz ? hy : hx;
    const R = (u0, v0, u1, v1) => (horiz ? rect(u0, v0, u1, v1) : rect(v0, u0, v1, u1));
    paint(R(0, cv - 1, L, cv + 2), TT.STREET, MAIN);
    const s = K.square;
    const pu = cu + Math.round((rng() - 0.5) * Math.max(0, cu - s - 4));
    const pw = Math.max(1, Math.min(3, cv - lo - 2)); // half-width of the square across the street
    const plaza = R(pu - s, cv - pw, pu + s + 1, cv + pw + 1);
    const uHi = L - lo;
    const vHi = V - lo;
    const lanes = [];
    for (let tries = 0; tries < 8 && lanes.length < (L > 26 ? 2 : 1) && uHi - lo > 10; tries++) {
      const u = lo + 3 + Math.floor(rng() * (uHi - lo - 8));
      if (Math.abs(u + 1 - pu) < s + 3 || lanes.some((o) => Math.abs(o - u) < 6)) continue;
      lanes.push(u);
    }
    const holes = [plaza];
    for (const u of lanes) {
      const r = R(u, lo, u + SIDE, vHi);
      paint(r, TT.STREET, LANE);
      holes.push(r);
    }
    const gateLines = horiz ? [[hx, hy, -1, 0], [hx, hy, 1, 0]] : [[hx, hy, 0, -1], [hx, hy, 0, 1]];
    if (lanes.length && K.wall !== 'none' && rng() < 0.5) {
      const u = lanes[0];
      const up = rng() < 0.5;
      paint(up ? R(u, 0, u + SIDE, cv) : R(u, cv, u + SIDE, V), TT.STREET, MAIN);
      gateLines.push(horiz ? [u, cv, 0, up ? -1 : 1] : [cv, u, up ? -1 : 1, 0]);
    }
    const districts = [...carve(R(lo, lo, uHi, cv - 1), holes), ...carve(R(lo, cv + 2, uHi, vHi), holes)];
    return { plaza, districts, gateLines };
  },

  // a grid of streets; the main ones lead to four gates, the square takes one of the blocks at the main crossing
  grid({ rng, w, h, hx, hy, lo, paint, MAIN, LANE }) {
    const B = 7 + Math.floor(rng() * 3); // block size between streets
    const lines = (c, n) => {
      const hi = n - lo;
      const streets = [[c - 1, 3]];
      for (let s0 = c + 2 + B; s0 + SIDE <= hi - 3; s0 += SIDE + B) streets.push([s0, SIDE]);
      for (let e = c - 1 - B; e - SIDE >= lo + 3; e -= SIDE + B) streets.push([e - SIDE, SIDE]);
      streets.sort((a, b) => a[0] - b[0]);
      const cells = [];
      let from = lo;
      for (const [s0, wd] of streets) {
        if (s0 - from >= 2) cells.push([from, s0]);
        from = s0 + wd;
      }
      if (hi - from >= 2) cells.push([from, hi]);
      return { streets, cells };
    };
    const X = lines(hx, w);
    const Y = lines(hy, h);
    for (const [s0, wd] of X.streets) paint(rect(s0, 0, s0 + wd, h), TT.STREET, wd === 3 ? MAIN : LANE);
    for (const [s0, wd] of Y.streets) paint(rect(0, s0, w, s0 + wd), TT.STREET, wd === 3 ? MAIN : LANE);
    const nearX = X.cells.filter(([a, b]) => b === hx - 1 || a === hx + 2);
    const nearY = Y.cells.filter(([a, b]) => b === hy - 1 || a === hy + 2);
    let plaza = rect(hx - 2, hy - 2, hx + 3, hy + 3);
    if (nearX.length && nearY.length) {
      const [xa, xb] = nearX[Math.floor(rng() * nearX.length)];
      const [ya, yb] = nearY[Math.floor(rng() * nearY.length)];
      plaza = rect(xa, ya, xb, yb);
    }
    const districts = [];
    for (const [xa, xb] of X.cells) {
      for (const [ya, yb] of Y.cells) if (!(xa === plaza.x0 && ya === plaza.y0)) districts.push(...carve(rect(xa, ya, xb, yb), [plaza]));
    }
    return { plaza, districts, gateLines: FOUR_WAYS(hx, hy) };
  },

  // a hamlet: a green with a well, paths out into the fields, cottages around (see scatterHouses)
  green({ rng, K, h, w, hx, hy, paint, MAIN }) {
    const s = K.square;
    const plaza = rect(hx - s, hy - s, hx + s + 1, hy + s + 1);
    const ways = shuffle(FOUR_WAYS(hx, hy), rng).slice(0, 2 + Math.floor(rng() * 3)); // two to four paths
    for (const [, , dx, dy] of ways) {
      const r = dx ? rect(dx < 0 ? 0 : hx, hy, dx < 0 ? hx + 1 : w, hy + 2) : rect(hx, dy < 0 ? 0 : hy, hx + 2, dy < 0 ? hy + 1 : h);
      paint(r, TT.STREET, MAIN);
    }
    return { plaza, districts: [], gateLines: ways };
  },
};

// The castle quarter of a capital: against the town wall on the side away from the square.
function castleQuarter({ w, h, hx, hy, lo }, plaza) {
  const px = (plaza.x0 + plaza.x1) / 2 - hx;
  const py = (plaza.y0 + plaza.y1) / 2 - hy;
  const side = Math.abs(px) > Math.abs(py) ? (px > 0 ? 'w' : 'e') : py > 0 ? 'n' : 's';
  const a = Math.floor(CASTLE_W / 2);
  let outer;
  let gate;
  if (side === 'n') { outer = rect(hx - a, lo, hx + a + 1, lo + CASTLE_D); gate = rect(hx - 1, outer.y1 - 1, hx + 2, outer.y1); }
  if (side === 's') { outer = rect(hx - a, h - lo - CASTLE_D, hx + a + 1, h - lo); gate = rect(hx - 1, outer.y0, hx + 2, outer.y0 + 1); }
  if (side === 'w') { outer = rect(lo, hy - a, lo + CASTLE_D, hy + a + 1); gate = rect(outer.x1 - 1, hy - 1, outer.x1, hy + 2); }
  if (side === 'e') { outer = rect(w - lo - CASTLE_D, hy - a, w - lo, hy + a + 1); gate = rect(outer.x0, hy - 1, outer.x0 + 1, hy + 2); }
  return { side, outer, gate, keep: grow(outer, -3) };
}

// Cottages of a hamlet, each in its own little yard, scattered over the fields.
function scatterHouses({ rng, w, h, paint }, get, land, build) {
  const want = 6 + Math.floor(rng() * 5);
  let built = 0;
  for (let tries = 0; tries < 300 && built < want; tries++) {
    const bw = 2 + Math.floor(rng() * 3);
    const bh = 2 + Math.floor(rng() * 2);
    const x0 = 1 + Math.floor(rng() * (w - bw - 2));
    const y0 = 1 + Math.floor(rng() * (h - bh - 2));
    const r = rect(x0, y0, x0 + bw, y0 + bh);
    const yard = grow(r, 1);
    let ok = true;
    for (let y = yard.y0; y < yard.y1 && ok; y++) for (let x = yard.x0; x < yard.x1 && ok; x++) ok = get(x, y) === TT.FIELD && land(x, y);
    if (!ok) continue;
    paint(yard, TT.YARD, [TT.FIELD]);
    build(r, 'house');
    built++;
  }
}
// The keepers: the houses closest to the square become their shops; each keeper stands at the door, on a tile you can
// walk to from the square. With too few houses about, a keeper stands on the square itself.
function placeKeepers({ rng, K, w, h }, get, buildings, plaza, square) {
  const reach = new Set();
  const start = [Math.floor(square.x), Math.floor(square.y)];
  const queue = [start];
  reach.add(start[1] * w + start[0]);
  while (queue.length) {
    const [x, y] = queue.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      const k = ny * w + nx;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || reach.has(k) || !WALKABLE.includes(get(nx, ny))) continue;
      reach.add(k);
      queue.push([nx, ny]);
    }
  }
  const cands = [];
  for (const b of buildings) {
    if (b.kind !== 'house' || !b.pieces.length) continue;
    let best = null;
    for (const p of b.pieces) {
      const around = [];
      for (let x = p.x0; x < p.x1; x++) around.push([x, p.y0 - 1], [x, p.y1]);
      for (let y = p.y0; y < p.y1; y++) around.push([p.x0 - 1, y], [p.x1, y]);
      for (const [x, y] of around) {
        if (!reach.has(y * w + x)) continue;
        const d = Math.hypot(x + 0.5 - square.x, y + 0.5 - square.y) + (get(x, y) === TT.STREET ? 0 : 2);
        if (!best || d < best.d) best = { x, y, d };
      }
    }
    if (best) cands.push({ b, door: best, area: rw(b) * rh(b) });
  }
  cands.sort((a, b) => a.door.d - b.door.d);
  const roles = shuffle(K.services.npcs.filter((r) => !HOUSELESS.includes(r)), rng);
  const npcs = [];
  const apart = (x, y) => npcs.every((n) => Math.hypot(n.x - x - 0.5, n.y - y - 0.5) >= 3); // never two keepers in one reach
  for (const role of roles) {
    const c = cands.find((o) => !o.taken && o.area >= 6 && apart(o.door.x, o.door.y));
    if (c) {
      c.taken = true;
      c.b.kind = role;
      npcs.push({ id: role, x: c.door.x + 0.5, y: c.door.y + 0.5 });
      continue;
    }
    for (let y = plaza.y0; y < plaza.y1 && npcs.length < roles.indexOf(role) + 1; y++) {
      for (let x = plaza.x0; x < plaza.x1; x++) {
        if (get(x, y) === TT.STREET && apart(x, y) && Math.hypot(x + 0.5 - square.x, y + 0.5 - square.y) >= 1.5) {
          npcs.push({ id: role, x: x + 0.5, y: y + 0.5 });
          break;
        }
      }
    }
  }
  return npcs;
}

// The keepers without a house: the captain just inside a gate, the ruler in front of the keep of the castle.
function placeGuards({ K }, get, npcs, gates, castle) {
  const free = (x, y) => [TT.STREET, TT.YARD].includes(get(x, y)) && npcs.every((n) => Math.hypot(n.x - x - 0.5, n.y - y - 0.5) >= 3);
  if (K.services.npcs.includes('captain')) {
    let spot = null;
    for (const g of gates) { // two tiles in from the gate, a step to the side of the way through
      for (const side of [2, -2, 3, -3]) {
        const x = g.x - 2 * g.dx + (g.dy ? side : 0);
        const y = g.y - 2 * g.dy + (g.dx ? side : 0);
        if (!spot && free(x, y)) spot = { x, y };
      }
    }
    if (spot) npcs.push({ id: 'captain', x: spot.x + 0.5, y: spot.y + 0.5 });
  }
  if (K.services.npcs.includes('ruler') && castle) {
    npcs.push({ id: 'ruler', x: (castle.keep.x0 + castle.keep.x1) / 2, y: castle.keep.y1 + 0.5 });
  }
}

// Market stalls on the square (only drawn, you walk past them), each with a trader in front who sells one kind of goods.
function placeStalls({ rng, K }, get, plaza, square, npcs) {
  const want = K.stalls[0] + Math.floor(rng() * (K.stalls[1] - K.stalls[0] + 1));
  const wares = shuffle([...WARES], rng); // every stall its own goods, as long as there are kinds left
  const out = [];
  for (let tries = 0; tries < 60 && out.length < want; tries++) {
    const x = plaza.x0 + 1 + Math.floor(rng() * Math.max(1, rw(plaza) - 2));
    const y = plaza.y0 + 1 + Math.floor(rng() * Math.max(1, rh(plaza) - 2));
    const cx = x + 0.5;
    const cy = y + 0.5;
    if (get(x, y) !== TT.STREET || Math.hypot(cx - square.x, cy - square.y) < 2) continue;
    if (npcs.some((n) => Math.hypot(n.x - cx, n.y - cy) < 2) || out.some((s) => Math.hypot(s.x - cx, s.y - cy) < 2)) continue;
    const ware = wares[out.length % wares.length];
    out.push({ x: cx, y: cy, color: WARES.indexOf(ware), ware });
    if (get(x, y + 1) === TT.STREET) npcs.push({ id: 'trader', ware, x: cx, y: cy + 1 });
  }
  return out;
}

// Towers on the wall: at its corners and every few tiles along the straight runs, never two side by side. Only the
// castle wall (`only`) gets them when the town wall has none.
function placeTowers(get, w, h, only) {
  const out = [];
  const isWall = (x, y) => get(x, y) === TT.WALL;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!isWall(x, y)) continue;
      if (only && !(x >= only.x0 && x < only.x1 && y >= only.y0 && y < only.y1)) continue;
      const horiz = isWall(x - 1, y) || isWall(x + 1, y);
      const vert = isWall(x, y - 1) || isWall(x, y + 1);
      const corner = horiz && vert;
      const run = (horiz && !vert && x % 8 === 0) || (vert && !horiz && y % 8 === 0);
      if (!corner && !run) continue;
      if (out.some((t) => Math.abs(t.x - x) + Math.abs(t.y - y) < 5)) continue;
      out.push({ x, y });
    }
  }
  return out;
}

// A plain house, or one with a corner cut away (an L) or a yard cut into its back (a U).
function shapeHouse(r, rng, along, frontLow) {
  const w = rw(r);
  const h = rh(r);
  const roll = rng();
  if (w >= 4 && h >= 4 && roll < 0.3) {
    const nx = 1 + Math.floor(rng() * Math.max(1, Math.floor(w / 2) - 1)) + 1;
    const ny = 1 + Math.floor(rng() * Math.max(1, Math.floor(h / 2) - 1)) + 1;
    const right = rng() < 0.5;
    const low = rng() < 0.5;
    const hole = rect(right ? r.x1 - nx : r.x0, low ? r.y1 - ny : r.y0, right ? r.x1 : r.x0 + nx, low ? r.y1 : r.y0 + ny);
    return carve(r, [hole]);
  }
  if (w >= 5 && h >= 5 && roll < 0.5) { // the yard opens at the back, away from the street
    if (along) {
      const y0 = frontLow ? r.y1 - 2 : r.y0;
      return carve(r, [rect(r.x0 + 1 + (w > 6 ? 1 : 0), y0, r.x1 - 1 - (w > 6 ? 1 : 0), y0 + 2)]);
    }
    const x0 = frontLow ? r.x1 - 2 : r.x0;
    return carve(r, [rect(x0, r.y0 + 1, x0 + 2, r.y1 - 1)]);
  }
  return [r];
}

export const townTile = (layout, x, y) => (x < 0 || y < 0 || x >= layout.w || y >= layout.h ? TT.OUT : layout.tiles[y * layout.w + x]);
