// The finite world: one map made by the generator (src/world/mapgen/) from the seed and a recipe (data/maps/*.json).
// It answers the same questions as the endless World (tiles, towns, what can be walked, what stops arrows), and also
// where things stand: boss lairs, dungeons, camps, hidden valleys and the Ring are lists here, not cells of a grid, and
// the danger tier comes from the regions of the map. The systems ask the world (world.isMap) instead of the grid.
// Beyond the edge lies the sea, or the northern mountains: never walkable, never sailable.
import { TILE, CHUNK, BIOME_IDS } from './world.js';
import { townTile, TT } from './towngen.js';
import { beastName } from './names.js';
import { generateMap } from './mapgen/index.js';
import { F } from './mapgen/places.js';
import { buildField, stepAlong } from './flowfield.js';

export const MAP_GEN = 5; // the world generator version saves remember for the finite map (5: with relief)
export const MAP_GENS = [4, 5]; // 4: the same map, flat (saves from before the relief keep their world)
const ID = Object.fromEntries(BIOME_IDS.map((n, i) => [n, i]));
const SOLID = new Set([ID.cliff, ID.town_wall, ID.house, ID.palisade, ID.mountain]);
const LOS_STEP = 6;
const SEA_MARGIN = 4; // tiles along the edge of the map no boat can enter
const CHASE_R = 40; // monsters find their way to you within this many tiles of you
const HOME_R = 24; // ... and back home within this many tiles of home
const BODY = 10; // half the width of a walking monster: a straight way must be clear this far to each side
const WALK_STEP = 8;
const TOWN_GROUND = new Set([ID.town, ID.yard, ID.field]); // monsters keep out of towns

function insideTown(t, px, py, margin) {
  if (Math.abs(px - t.px) > (t.hx + 0.5) * TILE + margin || Math.abs(py - t.py) > (t.hy + 0.5) * TILE + margin) return false;
  if (margin > 0) return true;
  return townTile(t.layout, Math.floor(px / TILE) - t.tx + t.hx, Math.floor(py / TILE) - t.ty + t.hy) !== TT.OUT;
}

// A town as the game knows it (the same shape as the endless world's walled towns).
function townRecord(t) {
  const { layout, tx, ty } = t;
  const { hx, hy } = layout;
  const ox = (tx - hx) * TILE;
  const oy = (ty - hy) * TILE;
  const at = (p) => ({ ...p, x: ox + p.x * TILE, y: oy + p.y * TILE });
  const box = (r) => ({ x: ox + r.x0 * TILE, y: oy + r.y0 * TILE, w: (r.x1 - r.x0) * TILE, h: (r.y1 - r.y0) * TILE });
  return {
    id: t.id, tx, ty, px: (tx + 0.5) * TILE, py: (ty + 0.5) * TILE, nameIndex: t.nameIndex, walled: true, kind: t.kind, plan: layout.plan,
    hx, hy, layout, style: t.biome, services: layout.services, tier: t.tier, region: t.region, role: t.role,
    reachPx: Math.sqrt((hx + 0.5) * (hx + 0.5) + (hy + 0.5) * (hy + 0.5)) * TILE,
    npcs: layout.npcs.map((n) => ({ ...n, x: ox + n.x * TILE, y: oy + n.y * TILE })),
    buildings: layout.buildings.filter((b) => b.pieces.length).map((b) => ({ id: b.kind, roof: b.roof, ...box(b), pieces: b.pieces.map(box) })),
    gates: layout.gates.map((g) => ({ side: g.side, tx: tx - hx + g.x, ty: ty - hy + g.y, dx: g.dx, dy: g.dy })),
    well: at(layout.well),
    stalls: layout.stalls.map(at),
    towers: layout.towers.map((p) => at({ x: p.x + 0.5, y: p.y + 0.5 })),
    castle: layout.castle && box(layout.castle.outer),
  };
}

export class MapWorld {
  constructor(seed, biomes, recipe, gen = MAP_GEN) {
    this.seed = seed;
    this.biomes = biomes;
    this.recipe = recipe;
    this.gen = gen;
    this.isMap = true;
    this.tileSize = TILE;
    this.chunks = new Map();
    this.walkableIds = BIOME_IDS.map((n) => (biomes[n]?.walkable ? 1 : 0));
    this.wayIds = this.walkableIds.map((v, id) => (v && !TOWN_GROUND.has(id) ? 1 : 0)); // where monsters find their way
    const M = generateMap(seed, recipe, this.walkableIds, { relief: gen >= 5 });
    this.map = M;
    this.N = M.size;
    this.x0 = M.x0;
    this.y0 = M.y0;
    this.bounds = { x0: M.x0, y0: M.y0, x1: M.x0 + M.size, y1: M.y0 + M.size };
    this.townList = M.towns.map(townRecord);
    this.byId = new Map();
    for (const t of this.townList) this.byId.set(t.id, t);
    const px = (s) => ({ px: s.tx * TILE, py: s.ty * TILE });
    this.lairSites = M.lairs.map((s) => ({ ...s, ...px(s) }));
    this.dungeonSites = M.dungeons.map((s) => ({ ...s, ...px(s) }));
    this.campSites = M.camps.map((s) => ({ ...s, px: (s.tx + 0.5) * TILE, py: (s.ty + 0.5) * TILE }));
    this.valleys = M.valleys.map((v) => ({ id: v.id, cx: v.cx, cy: v.cy, tx: v.tx, ty: v.ty, r: v.r, p1: v.p1, p2: v.p2, angle: v.angle, outer: v.outer, inner: v.inner, chests: v.chests, tier: v.tier, biome: v.biome }));
    const r = M.ring;
    this.ringSite = {
      id: 'r:ring', cx: 9001, cy: 9001, tx: r.tx, ty: r.ty, px: r.tx * TILE + TILE / 2, py: r.ty * TILE + TILE / 2, tier: 4, theme: 'ring',
      bossId: 'ring_keeper', name: beastName(seed, 9001, 9001, 77), ring: true, angle: 0,
    };
    for (const list of [this.lairSites, this.dungeonSites, this.campSites, this.valleys]) for (const s of list) this.byId.set(s.id, s);
    this.byId.set('r:ring', this.ringSite);
    // the small places of the side stories (systems/sidequests.js): id -> { tx, ty, px, py, r, look }
    this.spots = Object.fromEntries(Object.entries(M.spots ?? {}).map(([id, s]) => [id, { ...s, px: (s.tx + 0.5) * TILE, py: (s.ty + 0.5) * TILE }]));
    this.story = { ...M.story, road: M.story.road ?? this.roadTown()?.id ?? null }; // (older recipes have no road town)
  }

  // The first town with a smithy on the road from the start to the chronicler's city (the side stories send you
  // there), or the nearest such town to the start when the road has none.
  roadTown() {
    const start = this.getTownById(this.map.story.start);
    const smith = (t) => t && t !== start && t.npcs.some((n) => n.id === 'blacksmith');
    const links = new Map();
    for (const r of this.map.roads) {
      for (const [a, b] of [[r.from, r.to], [r.to, r.from]]) {
        if (!links.has(a)) links.set(a, []);
        links.get(a).push(b);
      }
    }
    const prev = new Map([[start.id, null]]);
    const queue = [start.id];
    for (let i = 0; i < queue.length; i++) {
      for (const n of links.get(queue[i]) ?? []) if (!prev.has(n)) { prev.set(n, queue[i]); queue.push(n); }
    }
    const path = [];
    for (let id = this.map.story.city; id && prev.has(id); id = prev.get(id)) path.unshift(id);
    const onRoad = path.map((id) => this.getTownById(id)).find(smith);
    if (onRoad) return onRoad;
    const d = (t) => Math.hypot(t.tx - start.tx, t.ty - start.ty);
    return this.townList.filter(smith).sort((a, b) => d(a) - d(b))[0] ?? null;
  }

  inBounds(tx, ty) {
    return tx >= this.x0 && ty >= this.y0 && tx < this.x0 + this.N && ty < this.y0 + this.N;
  }

  tileAt(tx, ty) {
    if (!this.inBounds(tx, ty)) return ty < this.y0 ? ID.mountain : ID.water; // the wall goes on to the north, the sea elsewhere
    return this.map.tiles[(ty - this.y0) * this.N + (tx - this.x0)];
  }

  biomeIdAt(tx, ty) {
    return this.tileAt(tx, ty);
  }

  // The ground of the land before anything was built on it: the biome of its region (water is 0).
  rawBiomeIdAt(tx, ty) {
    const id = this.tileAt(tx, ty);
    if (id === ID.water) return 0;
    if (!this.inBounds(tx, ty)) return id;
    const C = this.map.coarse;
    const G = this.N / C;
    const r = this.map.cregion[Math.floor((ty - this.y0) / C) * G + Math.floor((tx - this.x0) / C)];
    return r === 255 ? id : ID[this.map.regionBiome[r]] ?? id;
  }

  tierAt(tx, ty) {
    if (!this.inBounds(tx, ty)) return 4;
    const C = this.map.coarse;
    return this.map.tierMap[Math.floor((ty - this.y0) / C) * (this.N / C) + Math.floor((tx - this.x0) / C)];
  }

  // 0: not in a hidden valley, 1: its ring of cliffs, 2: inside it.
  valleyTileAt(tx, ty) {
    if (!this.inBounds(tx, ty)) return 0;
    const f = this.map.flags[(ty - this.y0) * this.N + (tx - this.x0)];
    return f & F.VRING ? 1 : f & F.VIN ? 2 : 0;
  }

  // ---- relief (generator 5, mapgen/relief.js): levels of height, cliffs between them, ramps up them
  // The level of a tile: 0 (the shore) to 3 on land, 4 for the mountains (and beyond the north edge); 0 on a flat map.
  heightAt(tx, ty) {
    if (!this.map.height) return 0;
    if (!this.inBounds(tx, ty)) return ty < this.y0 ? 4 : 0;
    return this.map.height[(ty - this.y0) * this.N + (tx - this.x0)];
  }

  isRamp(tx, ty) {
    return this.inBounds(tx, ty) && !!(this.map.flags[(ty - this.y0) * this.N + (tx - this.x0)] & F.RAMP);
  }

  // May a walker step from one point to another close by? Within a tile, or onto a neighbour on the same level, or one
  // level up or down where either tile is a ramp. A cliff otherwise.
  canStep(ax, ay, bx, by) {
    return this.stepTiles(Math.floor(ax / TILE), Math.floor(ay / TILE), Math.floor(bx / TILE), Math.floor(by / TILE));
  }

  // The same between two tiles.
  stepTiles(tx, ty, ux, uy) {
    if (!this.map.height || (tx === ux && ty === uy)) return true;
    const a = this.heightAt(tx, ty);
    const b = this.heightAt(ux, uy);
    return a === b || (Math.abs(a - b) === 1 && (this.isRamp(tx, ty) || this.isRamp(ux, uy)));
  }

  // ---- finding the way (world/flowfield.js)
  // Can something with a body walk straight from a to b: open ground all the way, no cliff, three rays wide?
  walkClear(ax, ay, bx, by) {
    const len = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay)) || 1;
    const nx = (-(by - ay) / len) * BODY;
    const ny = ((bx - ax) / len) * BODY;
    return this.rayClear(ax, ay, bx, by) && this.rayClear(ax + nx, ay + ny, bx + nx, by + ny) && this.rayClear(ax - nx, ay - ny, bx - nx, by - ny);
  }

  rayClear(ax, ay, bx, by) {
    const n = Math.ceil(Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay)) / WALK_STEP);
    let ptx = Math.floor(ax / TILE);
    let pty = Math.floor(ay / TILE);
    for (let k = 1; k <= n; k++) {
      const tx = Math.floor((ax + ((bx - ax) * k) / n) / TILE);
      const ty = Math.floor((ay + ((by - ay) * k) / n) / TILE);
      if (tx === ptx && ty === pty) continue;
      if (!this.wayIds[this.tileAt(tx, ty)]) return false;
      const corner = ptx !== tx && pty !== ty; // a diagonal: one of the ways round must be open too
      if (!(corner
        ? (this.wayIds[this.tileAt(tx, pty)] && this.stepTiles(ptx, pty, tx, pty) && this.stepTiles(tx, pty, tx, ty))
          || (this.wayIds[this.tileAt(ptx, ty)] && this.stepTiles(ptx, pty, ptx, ty) && this.stepTiles(ptx, ty, tx, ty))
        : this.stepTiles(ptx, pty, tx, ty))) return false;
      ptx = tx;
      pty = ty;
    }
    return true;
  }

  // A distance map to a goal tile, within r tiles of it.
  fieldTo(tx, ty, r) {
    return buildField(tx, ty, r, (x, y) => this.wayIds[this.tileAt(x, y)] === 1, (x, y, u, v) => this.stepTiles(x, y, u, v));
  }

  // Which way should a monster at (ex, ey) walk to reach the player at (px, py)? null: straight at them (nothing in the
  // way); a unit vector: along the way round (a ramp up a cliff, a ford over a river); NO_WAY: there is none near.
  // One map serves every monster; it is made again when the player steps onto another tile.
  chaseDirection(ex, ey, px, py) {
    if (this.walkClear(ex, ey, px, py)) return null;
    const ptx = Math.floor(px / TILE);
    const pty = Math.floor(py / TILE);
    if (!this.field || this.field.cx !== ptx || this.field.cy !== pty) this.field = this.fieldTo(ptx, pty, CHASE_R);
    return stepAlong(this.field, ex, ey, TILE);
  }

  // The same for a way to any point (a monster going home): the map is kept on `holder` while the goal stays put.
  wayTo(ex, ey, gx, gy, holder) {
    if (this.walkClear(ex, ey, gx, gy)) return null;
    const gtx = Math.floor(gx / TILE);
    const gty = Math.floor(gy / TILE);
    let f = holder.way;
    if (!f || f.cx !== gtx || f.cy !== gty) f = holder.way = this.fieldTo(gtx, gty, HOME_R);
    return stepAlong(f, ex, ey, TILE);
  }

  // Can this tile be reached on foot from the start (as the generator saw it)?
  reachable(tx, ty) {
    return this.inBounds(tx, ty) && !!(this.map.flags[(ty - this.y0) * this.N + (tx - this.x0)] & F.REACH);
  }

  placeById(id) {
    return this.byId.get(id) ?? null;
  }

  // ---- towns
  getTownById(id) {
    const t = this.byId.get(id);
    return t && t.layout ? t : null;
  }

  getTown(cx, cy) {
    return this.getTownById(`${cx},${cy}`);
  }

  townAtPx(px, py, marginPx = 0) {
    for (const t of this.townList) if (insideTown(t, px, py, marginPx)) return t;
    return null;
  }

  isTown(px, py) {
    return this.townAtPx(px, py) !== null;
  }

  townsInRange(px, py, rangePx) {
    return this.townList.filter((t) => Math.sqrt((px - t.px) * (px - t.px) + (py - t.py) * (py - t.py)) <= rangePx + t.reachPx);
  }

  // Places of one kind (sites with px, py) within range of a point.
  sitesInRange(list, px, py, rangePx) {
    return list.filter((s) => Math.sqrt((s.px - px) * (s.px - px) + (s.py - py) * (s.py - py)) <= rangePx);
  }

  // ---- tiles
  getChunk(cx, cy) {
    const key = cx + ',' + cy;
    let chunk = this.chunks.get(key);
    if (!chunk) {
      const tiles = new Uint8Array(CHUNK * CHUNK);
      for (let y = 0; y < CHUNK; y++) for (let x = 0; x < CHUNK; x++) tiles[y * CHUNK + x] = this.tileAt(cx * CHUNK + x, cy * CHUNK + y);
      chunk = { cx, cy, tiles, canvas: null };
      this.chunks.set(key, chunk);
    }
    return chunk;
  }

  isLand(tx, ty) {
    return this.tileAt(tx, ty) !== ID.water;
  }

  isSailable(px, py) {
    const tx = Math.floor(px / TILE);
    const ty = Math.floor(py / TILE);
    if (tx < this.x0 + SEA_MARGIN || ty < this.y0 + SEA_MARGIN || tx >= this.x0 + this.N - SEA_MARGIN || ty >= this.y0 + this.N - SEA_MARGIN) return false;
    return this.tileAt(tx, ty) === ID.water;
  }

  isWalkable(px, py) {
    return !!this.walkableIds[this.tileAt(Math.floor(px / TILE), Math.floor(py / TILE))];
  }

  passable(tx, ty) {
    if (this.townAtPx((tx + 0.5) * TILE, (ty + 0.5) * TILE)) return true;
    return !!this.walkableIds[this.tileAt(tx, ty)];
  }

  openGround(tx, ty) {
    const id = this.tileAt(tx, ty);
    return id !== ID.water && !!this.walkableIds[id];
  }

  blocksShots(px, py) {
    return SOLID.has(this.tileAt(Math.floor(px / TILE), Math.floor(py / TILE)));
  }

  lineClear(ax, ay, bx, by) {
    const n = Math.ceil(Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay)) / LOS_STEP);
    for (let k = 1; k < n; k++) {
      const f = k / n;
      if (this.blocksShots(ax + (bx - ax) * f, ay + (by - ay) * f)) return false;
    }
    return true;
  }

  // Where a new game begins: the square of the first town (the town at (0,0)).
  findSpawn() {
    const t = this.getTownById('0,0');
    if (t) {
      for (const [dx, dy] of [[0, 0], [0, 2], [2, 0], [0, -2], [-2, 0], [3, 3]]) {
        const x = t.well.x + dx * TILE;
        const y = t.well.y + 40 + dy * TILE;
        if (this.isWalkable(x, y)) return { x, y };
      }
    }
    return { x: TILE / 2, y: TILE / 2 };
  }

  pruneChunks(cx, cy, keep = 6) {
    for (const [key, c] of this.chunks) {
      if (Math.abs(c.cx - cx) > keep || Math.abs(c.cy - cy) > keep) this.chunks.delete(key);
    }
  }
}
