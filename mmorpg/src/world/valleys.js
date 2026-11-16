import { hash2 } from '../core/rng.js';
import { roadAt } from './roads.js';
import { nearLairSite } from './sites.js';

// Hidden valleys (generator 3): a round patch of land closed in by a ring of cliffs, with no way in on foot but a cave.
// One mouth of the cave opens outside the ring, the other inside; walking through the cave is the only way in. Inside
// wait chests that nobody else could reach. One candidate per VALE_CELL tiles, decided by the seed alone: on land all
// round, away from the start, towns and boss lairs, and never across a road (a road would cut the ring open).
export const VALE_CELL = 220; // tiles
export const VALE_ID = /^v:(-?\d{1,5}),(-?\d{1,5})$/;
const CHANCE = 0.45;
const MIN_FROM_START = 130; // tiles
const WALL = 3; // tiles of cliff in the ring
const MARGIN = 45; // tiles from the edge of the cell to the centre: a valley stays inside its own cell
const TOWN_ROOM = 14; // tiles between the ring and the nearest town

const cache = new WeakMap(); // world -> Map(cell -> valley | null)

// How far the ring is from the centre in direction `a` (radians): round, but not quite.
export const ringRadius = (v, a) => v.r * (1 + 0.14 * Math.sin(3 * a + v.p1) + 0.08 * Math.sin(5 * a + v.p2));

export function valleyAt(world, cx, cy) {
  if (world.isMap) return world.placeById(`v:${cx},${cy}`);
  let map = cache.get(world);
  if (!map) cache.set(world, (map = new Map()));
  const key = cx + ',' + cy;
  if (map.has(key)) return map.get(key);
  map.set(key, null); // while it is being placed (the checks below look at the ground, which asks about valleys)
  const v = placeValley(world, cx, cy);
  map.set(key, v);
  return v;
}

function placeValley(world, cx, cy) {
  if (!world.params?.obstacles) return null;
  const s = world.seed;
  if (hash2(cx, cy, s + 6001) > CHANCE) return null;
  const tx = cx * VALE_CELL + MARGIN + Math.floor(hash2(cx, cy, s + 6002) * (VALE_CELL - 2 * MARGIN));
  const ty = cy * VALE_CELL + MARGIN + Math.floor(hash2(cx, cy, s + 6003) * (VALE_CELL - 2 * MARGIN));
  if (Math.hypot(tx, ty) < MIN_FROM_START) return null;
  const v = {
    id: `v:${cx},${cy}`, cx, cy, tx, ty,
    r: 12 + Math.floor(hash2(cx, cy, s + 6004) * 8),
    p1: hash2(cx, cy, s + 6005) * Math.PI * 2,
    p2: hash2(cx, cy, s + 6006) * Math.PI * 2,
  };
  const outerR = v.r * 1.22 + WALL + 4;
  if (world.townAtPx((tx + 0.5) * world.tileSize, (ty + 0.5) * world.tileSize, (outerR + TOWN_ROOM) * world.tileSize)) return null;
  if (nearLairSite(s, tx, ty, outerR + 30)) return null; // the ring would cut through a boss arena
  // land all round, the ring and a strip outside it included (no sea to sail in by), and no road across the ring
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const R = ringRadius(v, a);
    for (let d = 0; d <= R + WALL + 3; d += 1.5) {
      if (world.rawBiomeIdAt(Math.round(tx + Math.cos(a) * d), Math.round(ty + Math.sin(a) * d)) === 0) return null;
    }
    for (let d = R - 1; d <= R + WALL + 1; d += 1) if (roadAt(world, Math.round(tx + Math.cos(a) * d), Math.round(ty + Math.sin(a) * d))) return null;
  }
  // the cave: its outer mouth just outside the ring on open ground, its inner mouth just inside
  const start = hash2(cx, cy, s + 6007) * Math.PI * 2;
  for (let k = 0; k < 12 && !v.outer; k++) {
    const a = start + (k / 12) * Math.PI * 2;
    const R = ringRadius(v, a);
    const out = { tx: Math.round(tx + Math.cos(a) * (R + WALL + 3)), ty: Math.round(ty + Math.sin(a) * (R + WALL + 3)) };
    if (!openOutside(world, out.tx, out.ty)) continue;
    v.angle = a;
    v.outer = out;
    v.inner = { tx: Math.round(tx + Math.cos(a) * (R - 3)), ty: Math.round(ty + Math.sin(a) * (R - 3)) };
  }
  if (!v.outer) return null;
  // two or three chests around the middle
  const n = 2 + (hash2(cx, cy, s + 6008) < 0.5 ? 1 : 0);
  v.chests = Array.from({ length: n }, (_, i) => {
    const a = start + Math.PI + (i - (n - 1) / 2) * 0.9; // across the valley from the cave
    const d = v.r * (0.3 + 0.3 * hash2(cx + i, cy, s + 6009));
    return { idx: i, tx: Math.round(tx + Math.cos(a) * d), ty: Math.round(ty + Math.sin(a) * d) };
  });
  return v;
}

// Open ground outside a valley, worked out without asking about valleys (that is what is being decided).
function openOutside(world, tx, ty) {
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const raw = world.rawBiomeIdAt(tx + dx, ty + dy);
    if (raw === 0 || world.obstacleAt(tx + dx, ty + dy, raw) !== null) return false;
  }
  return true;
}

// 0: not in a valley, 1: the ring of cliffs, 2: inside.
export function valleyTileAt(world, tx, ty) {
  if (world.isMap) return world.valleyTileAt(tx, ty);
  const v = valleyAt(world, Math.floor(tx / VALE_CELL), Math.floor(ty / VALE_CELL));
  if (!v) return 0;
  const dx = tx + 0.5 - (v.tx + 0.5);
  const dy = ty + 0.5 - (v.ty + 0.5);
  const d = Math.hypot(dx, dy);
  if (d > v.r * 1.22 + WALL + 1) return 0;
  const R = ringRadius(v, Math.atan2(dy, dx));
  if (d < R) return 2;
  return d < R + WALL ? 1 : 0;
}

export function valleysInRange(world, px, py, rangePx) {
  if (world.isMap) {
    return world.valleys.filter((v) => Math.hypot((v.tx + 0.5) * world.tileSize - px, (v.ty + 0.5) * world.tileSize - py) <= rangePx + (v.r * 1.22 + WALL + 4) * world.tileSize);
  }
  if (!world.params?.obstacles) return [];
  const cell = VALE_CELL * world.tileSize;
  const out = [];
  for (let cy = Math.floor((py - rangePx) / cell); cy <= Math.floor((py + rangePx) / cell); cy++) {
    for (let cx = Math.floor((px - rangePx) / cell); cx <= Math.floor((px + rangePx) / cell); cx++) {
      const v = valleyAt(world, cx, cy);
      if (v && Math.hypot((v.tx + 0.5) * world.tileSize - px, (v.ty + 0.5) * world.tileSize - py) <= rangePx + (v.r * 1.22 + WALL + 4) * world.tileSize) out.push(v);
    }
  }
  return out;
}

export function valleyById(world, id) {
  const m = VALE_ID.exec(id);
  const v = m && valleyAt(world, Number(m[1]), Number(m[2]));
  return v && v.id === id ? v : null;
}
