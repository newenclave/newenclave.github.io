import { fbm } from '../core/noise.js';
import { hash2 } from '../core/rng.js';
import { generateTown, townTile, pickKind, TT, TOWN_KINDS } from './towngen.js';
import { roadAt } from './roads.js';
import { valleyTileAt } from './valleys.js';
import { nearLairSite } from './sites.js';

export const TILE = 32;
export const CHUNK = 32;
// Terrain generator versions. A save remembers the one it was made with, so old worlds do not change under it.
//   1: the first one (big seas, the start could be water)
//   2: less sea, and a meadow around the start, so you never begin on an island
//   3: walled towns of different sizes, roads between them, and ground you cannot cross (cliffs, chasms, rivers)
export const WORLD_GEN = 3;
export const WORLD_GENS = [1, 2, 3];
const GEN_PARAMS = {
  1: { water: 0.38, beach: 0.42, home: 0 },
  2: { water: 0.33, beach: 0.37, home: 48 }, // home = radius in tiles of the meadow around the start
  3: { water: 0.33, beach: 0.37, home: 48, walled: true, obstacles: true },
};
const smooth = (t) => t * t * (3 - 2 * t);

export const BIOME_IDS = [
  'water', 'beach', 'grass', 'forest', 'desert', 'snow', 'town',
  'crypt_floor', 'crypt_wall', 'ice_floor', 'ice_wall', 'tomb_floor', 'tomb_wall', // dungeon tiles
  'road', 'bridge', 'cliff', 'chasm', 'river', // open world, generator 3
  'town_wall', 'house', 'yard', // walled towns
  'palisade', 'field', // villages and hamlets
  'cave_floor', 'cave_wall', // the caves under the cliffs around hidden valleys
  'ring_floor', 'ring_wall', // the Ring, deep under the edge of the known world
  'mountain', 'ford', // the finite map: mountains nobody crosses, and shallows across a river
];
const id = (name) => BIOME_IDS.indexOf(name);
const TOWN_ID = 6;
export const TILE_IDS = {
  road: id('road'), bridge: id('bridge'), cliff: id('cliff'), chasm: id('chasm'), river: id('river'),
  town: TOWN_ID, wall: id('town_wall'), house: id('house'), yard: id('yard'), palisade: id('palisade'), field: id('field'),
};
const TOWN_TILE_IDS = {
  [TT.STREET]: TOWN_ID, [TT.YARD]: TILE_IDS.yard, [TT.HOUSE]: TILE_IDS.house, [TT.WALL]: TILE_IDS.wall, [TT.FIELD]: TILE_IDS.field,
};
// Tiles that stop arrows and bolts (and flyers): you cannot shoot through a rock face or a house.
const SOLID = new Set([TILE_IDS.cliff, TILE_IDS.wall, TILE_IDS.house, TILE_IDS.palisade]);
const LOS_STEP = 6; // pixels between samples when checking whether a shot or a blow gets through
const TOWN_CLEAR = 8; // tiles around a walled town kept free of cliffs, chasms and rivers, so its gates stay open

export const TOWN_CELL = 96; // tiles; at most one town per cell
export const TOWN_RADIUS = 8; // tiles; paved area and safe zone of the round towns of generators 1 and 2
export const TOWN_RADIUS_PX = TOWN_RADIUS * TILE;
const TOWN_CHANCE = 0.55;
const TOWN_NAMES = { 1: 8, 2: 8, 3: 24 }; // town.name.0 .. town.name.23 in the language file; older worlds keep their names

// Layout of a town relative to its centre, in pixels. NPCs stand in front of their buildings.
export const TOWN_LAYOUT = {
  npcs: [
    { id: 'merchant', dx: -125, dy: -45 },
    { id: 'blacksmith', dx: 125, dy: -45 },
    { id: 'elder', dx: 0, dy: 40 },
  ],
  buildings: [
    { id: 'merchant', dx: -175, dy: -120, w: 100, h: 64, color: '#8d6e63' },
    { id: 'blacksmith', dx: 75, dy: -120, w: 100, h: 64, color: '#78909c' },
    { id: 'elder', dx: -50, dy: 66, w: 100, h: 64, color: '#a1887f' },
  ],
};

function insideTown(t, px, py, margin) {
  if (!t.walled) return Math.hypot(px - t.px, py - t.py) <= TOWN_RADIUS_PX + margin;
  if (Math.abs(px - t.px) > (t.hx + 0.5) * TILE + margin || Math.abs(py - t.py) > (t.hy + 0.5) * TILE + margin) return false;
  if (margin > 0) return true; // the area around a town is a box
  // the town itself is its tiles: not the corners cut off an eight-sided wall, not the water
  return townTile(t.layout, Math.floor(px / TILE) - t.tx + t.hx, Math.floor(py / TILE) - t.ty + t.hy) !== TT.OUT;
}

export class World {
  constructor(seed, biomes, gen = WORLD_GEN) {
    this.gen = GEN_PARAMS[gen] ? gen : WORLD_GEN;
    this.params = GEN_PARAMS[this.gen];
    this.seed = seed;
    this.biomes = biomes;
    this.chunks = new Map();
    this.towns = new Map();
    this.townCell = TOWN_CELL;
    this.tileSize = TILE;
  }

  rawBiomeIdAt(tx, ty) {
    const P = this.params;
    let e = fbm(tx / 90, ty / 90, this.seed, 5);
    let m = fbm(tx / 70, ty / 70, this.seed + 1000, 4);
    const d = P.home ? Math.hypot(tx, ty) / P.home : 1;
    if (d < 1) { // pull the land around the start towards plain meadow: there e stays well above the water line
      const w = smooth(1 - d);
      e += (0.5 - e) * w;
      m += (0.5 - m) * w;
    }
    if (e < P.water) return 0;
    if (e < P.beach) return 1;
    if (e > 0.68) return 5;
    if (m < 0.38) return 4;
    if (m > 0.58) return 3;
    return 2;
  }

  // What the ground is, with towns, roads and obstacles on top of the raw biome (no caching: see tileAt for that).
  biomeIdAt(tx, ty) {
    const town = this.townIdAt(tx, ty);
    if (town >= 0) return town;
    const raw = this.rawBiomeIdAt(tx, ty);
    if (!this.params.obstacles || raw === 0) return raw;
    const vale = valleyTileAt(this, tx, ty); // a hidden valley: its ring of cliffs, and meadows and groves inside
    if (vale === 1) return TILE_IDS.cliff;
    if (vale === 2) return fbm(tx / 9, ty / 9, this.seed + 6100, 2) > 0.56 ? 3 : 2; // green inside, whatever lies around
    const ob = this.obstacleAt(tx, ty, raw);
    if (roadAt(this, tx, ty)) return ob === TILE_IDS.river || ob === TILE_IDS.chasm ? TILE_IDS.bridge : TILE_IDS.road;
    return ob ?? raw;
  }

  // Cliffs, chasms and fast rivers (generator 3). Each comes from its own noise field, so no neighbours are needed to
  // decide a tile: a cliff is a contour line of one field, broken by passes; a river is a contour line of a wider field,
  // broken by fords; chasms are the highest blobs of a third field. None near the start, around a town or where a
  // boss lair may be.
  obstacleAt(tx, ty, raw) {
    const s = this.seed;
    if (Math.hypot(tx, ty) < this.params.home) return null;
    let ob = null;
    if (Math.abs(fbm(tx / 160, ty / 160, s + 2000, 3) - 0.5) < 0.011 && fbm(tx / 20, ty / 20, s + 2100, 2) < 0.64) ob = TILE_IDS.river;
    else if (raw !== 1) { // the beach stays open
      if (fbm(tx / 240, ty / 240, s + 3100, 2) > 0.47 && Math.abs(fbm(tx / 70, ty / 70, s + 3000, 3) - 0.5) < 0.013
        && fbm(tx / 12, ty / 12, s + 3200, 2) < 0.72) ob = TILE_IDS.cliff;
      else if (fbm(tx / 260, ty / 260, s + 4100, 2) > 0.5 && fbm(tx / 28, ty / 28, s + 4000, 3) > 0.72) ob = TILE_IDS.chasm;
    }
    if (ob !== null && this.townAtPx((tx + 0.5) * TILE, (ty + 0.5) * TILE, TOWN_CLEAR * TILE)) return null;
    if (ob !== null && nearLairSite(this.seed, tx, ty)) return null; // a boss arena is open ground
    return ob;
  }

  // The tile of the town at (tx, ty), or -1 outside towns. Round towns (generators 1, 2) are paved all over.
  townIdAt(tx, ty) {
    const town = this.townAtPx((tx + 0.5) * TILE, (ty + 0.5) * TILE);
    if (!town) return -1;
    if (!town.walled) return TOWN_ID;
    const v = townTile(town.layout, tx - town.tx + town.hx, ty - town.ty + town.hy);
    if (v === TT.WALL && town.layout.wall === 'palisade') return TILE_IDS.palisade;
    return v === TT.OUT ? -1 : TOWN_TILE_IDS[v];
  }

  // ---- towns: deterministic from the seed, one candidate per cell of TOWN_CELL tiles
  getTown(cx, cy) {
    const key = cx + ',' + cy;
    if (this.towns.has(key)) return this.towns.get(key);
    const town = this.makeTown(cx, cy, key);
    this.towns.set(key, town);
    return town;
  }

  makeTown(cx, cy, id) {
    const walled = !!this.params.walled;
    let tx = 0;
    let ty = 0;
    let nameIndex = 0;
    let kind = 'town';
    if (cx !== 0 || cy !== 0) {
      if (hash2(cx, cy, this.seed + 777) > TOWN_CHANCE) return null;
      const jitter = walled ? 40 : 60; // walled towns are bigger: less room to wander inside the cell
      tx = cx * TOWN_CELL + Math.round((hash2(cx, cy, this.seed + 778) - 0.5) * jitter);
      ty = cy * TOWN_CELL + Math.round((hash2(cx, cy, this.seed + 779) - 0.5) * jitter);
      if (!this.isLand(tx, ty)) return null;
      if (walled) kind = pickKind(hash2(cx, cy, this.seed + 781));
      const ring = walled ? TOWN_KINDS[kind].landRing ?? TOWN_KINDS[kind].square + 2 : 14; // keep towns off tiny islands, and the market square dry
      for (let i = 0, n = walled ? 16 : 8; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        if (!this.isLand(Math.round(tx + Math.cos(a) * ring), Math.round(ty + Math.sin(a) * ring))) return null;
      }
      nameIndex = Math.floor(hash2(cx, cy, this.seed + 780) * TOWN_NAMES[this.gen]);
    }
    if (walled) return this.makeWalledTown(id, tx, ty, nameIndex, kind, cx, cy);
    const px = tx * TILE;
    const py = ty * TILE;
    return {
      id, tx, ty, px, py, nameIndex, walled: false, reachPx: TOWN_RADIUS_PX,
      npcs: TOWN_LAYOUT.npcs.map((n) => ({ id: n.id, x: px + n.dx, y: py + n.dy })),
      buildings: TOWN_LAYOUT.buildings.map((b) => ({ ...b, x: px + b.dx, y: py + b.dy })),
    };
  }

  makeWalledTown(id, tx, ty, nameIndex, kind, cx, cy) {
    const layout = generateTown({
      seed: Math.floor(hash2(cx, cy, this.seed + 782) * 2 ** 31),
      kind,
      land: (dx, dy) => this.isLand(tx + dx, ty + dy),
    });
    const { hx, hy } = layout;
    const ox = (tx - hx) * TILE; // top left corner of the town, in pixels
    const oy = (ty - hy) * TILE;
    const at = (p) => ({ ...p, x: ox + p.x * TILE, y: oy + p.y * TILE });
    const box = (r) => ({ x: ox + r.x0 * TILE, y: oy + r.y0 * TILE, w: (r.x1 - r.x0) * TILE, h: (r.y1 - r.y0) * TILE });
    return {
      id, tx, ty, px: (tx + 0.5) * TILE, py: (ty + 0.5) * TILE, nameIndex, walled: true, kind, plan: layout.plan, hx, hy, layout,
      style: BIOME_IDS[this.rawBiomeIdAt(tx, ty)], // the look of roofs and walls follows the land around
      services: layout.services,
      reachPx: Math.hypot(hx + 0.5, hy + 0.5) * TILE,
      npcs: layout.npcs.map((n) => ({ ...n, x: ox + n.x * TILE, y: oy + n.y * TILE })), // a market trader also says what it sells (ware)
      buildings: layout.buildings.filter((b) => b.pieces.length).map((b) => ({ id: b.kind, roof: b.roof, ...box(b), pieces: b.pieces.map(box) })),
      gates: layout.gates.map((g) => ({ side: g.side, tx: tx - hx + g.x, ty: ty - hy + g.y, dx: g.dx, dy: g.dy })),
      well: at(layout.well),
      stalls: layout.stalls.map(at),
      towers: layout.towers.map((p) => at({ x: p.x + 0.5, y: p.y + 0.5 })),
      castle: layout.castle && box(layout.castle.outer),
    };
  }

  // Towns are named by their cell: "cx,cy" (see makeTown).
  getTownById(id) {
    const m = /^(-?\d{1,5}),(-?\d{1,5})$/.exec(id);
    return m ? this.getTown(Number(m[1]), Number(m[2])) : null;
  }

  isLand(tx, ty) {
    return this.rawBiomeIdAt(tx, ty) !== 0;
  }

  townCellOf(px, py) {
    return [Math.floor((px / TILE + TOWN_CELL / 2) / TOWN_CELL), Math.floor((py / TILE + TOWN_CELL / 2) / TOWN_CELL)];
  }

  // The town whose area (grown by marginPx) contains the point, or null. Round towns are circles, walled towns squares
  // (the wall included).
  townAtPx(px, py, marginPx = 0) {
    const [cx, cy] = this.townCellOf(px, py);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const t = this.getTown(cx + dx, cy + dy);
        if (t && insideTown(t, px, py, marginPx)) return t;
      }
    }
    return null;
  }

  isTown(px, py) {
    return this.townAtPx(px, py) !== null;
  }

  townsInRange(px, py, rangePx) {
    const out = [];
    const [c0x, c0y] = this.townCellOf(px - rangePx, py - rangePx);
    const [c1x, c1y] = this.townCellOf(px + rangePx, py + rangePx);
    for (let cy = c0y - 1; cy <= c1y + 1; cy++) {
      for (let cx = c0x - 1; cx <= c1x + 1; cx++) {
        const t = this.getTown(cx, cy);
        if (t && Math.hypot(px - t.px, py - t.py) <= rangePx + t.reachPx) out.push(t);
      }
    }
    return out;
  }

  getChunk(cx, cy) {
    const key = cx + ',' + cy;
    let chunk = this.chunks.get(key);
    if (!chunk) {
      const tiles = new Uint8Array(CHUNK * CHUNK);
      for (let y = 0; y < CHUNK; y++) {
        for (let x = 0; x < CHUNK; x++) {
          tiles[y * CHUNK + x] = this.biomeIdAt(cx * CHUNK + x, cy * CHUNK + y);
        }
      }
      chunk = { cx, cy, tiles, canvas: null };
      this.chunks.set(key, chunk);
    }
    return chunk;
  }

  tileAt(tx, ty) {
    const cx = Math.floor(tx / CHUNK);
    const cy = Math.floor(ty / CHUNK);
    const chunk = this.getChunk(cx, cy);
    return chunk.tiles[(ty - cy * CHUNK) * CHUNK + (tx - cx * CHUNK)];
  }

  // Open water: where a boat can go (beaches and towns are land).
  isSailable(px, py) {
    return this.tileAt(Math.floor(px / TILE), Math.floor(py / TILE)) === 0;
  }

  isWalkable(px, py) {
    const id = this.tileAt(Math.floor(px / TILE), Math.floor(py / TILE));
    return this.biomes[BIOME_IDS[id]].walkable;
  }

  // Can you get across this tile? Like isWalkable, but worked out afresh instead of filling the chunk cache: used by route
  // searches that look far away, on a grid too coarse for streets. So a whole town counts as open: its streets join all
  // its gates. Generators 1 and 2 keep their old answer (any land, any town).
  passable(tx, ty) {
    if (this.townAtPx((tx + 0.5) * TILE, (ty + 0.5) * TILE)) return true;
    if (!this.params.obstacles) return this.rawBiomeIdAt(tx, ty) !== 0;
    return this.biomes[BIOME_IDS[this.biomeIdAt(tx, ty)]].walkable;
  }

  // Free land for a lair or a dungeon entrance: not water, and (generator 3) no cliff, chasm, river or town wall.
  openGround(tx, ty) {
    return this.rawBiomeIdAt(tx, ty) > 0 && (!this.params.obstacles || this.biomes[BIOME_IDS[this.biomeIdAt(tx, ty)]].walkable);
  }

  // ---- what stops arrows (generator 3): rock faces, town walls and houses. Chasms and rivers can be shot across.
  blocksShots(px, py) {
    return !!this.params.obstacles && SOLID.has(this.tileAt(Math.floor(px / TILE), Math.floor(py / TILE)));
  }

  // Can a shot or a blow go straight from a to b? (Both ends are not checked, only what lies between.)
  lineClear(ax, ay, bx, by) {
    if (!this.params.obstacles) return true;
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) / LOS_STEP);
    for (let k = 1; k < n; k++) {
      const f = k / n;
      if (this.blocksShots(ax + (bx - ax) * f, ay + (by - ay) * f)) return false;
    }
    return true;
  }

  findSpawn() {
    for (let r = 0; r < 200; r++) {
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const x = Math.cos(ang) * r * TILE;
        const y = Math.sin(ang) * r * TILE;
        if (this.isWalkable(x, y)) return { x, y };
      }
    }
    return { x: 0, y: 0 };
  }

  pruneChunks(cx, cy, keep = 6) {
    for (const [key, c] of this.chunks) {
      if (Math.abs(c.cx - cx) > keep || Math.abs(c.cy - cy) > keep) this.chunks.delete(key);
    }
  }
}
