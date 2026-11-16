import { mulberry32 } from '../core/rng.js';

// Dungeon floor plans: rooms joined by corridors on a tile grid. Pure data, no drawing, fully decided by the seed.
export const DUNGEON_SIZE = 80; // tiles per side
export const MIN_ROOM = 9;
export const MAX_ROOM = 15;
export const CORRIDOR = 3; // tiles wide: room for a boss to follow you into the corridor
const ROOM_GAP = 4; // walls between rooms

export const roomCountFor = (tier) => Math.min(11, 7 + tier);

const overlaps = (a, b, gap) =>
  a.x - gap < b.x + b.w && a.x + a.w + gap > b.x && a.y - gap < b.y + b.h && a.y + a.h + gap > b.y;

function carve(tiles, size, x0, y0, w, h) {
  for (let y = Math.max(1, y0); y < Math.min(size - 1, y0 + h); y++) {
    for (let x = Math.max(1, x0); x < Math.min(size - 1, x0 + w); x++) tiles[y * size + x] = 1;
  }
}

// An L-shaped corridor between two room centres.
function corridor(tiles, size, a, b, rng) {
  const half = Math.floor(CORRIDOR / 2);
  const horizontal = (y, x1, x2) => carve(tiles, size, Math.min(x1, x2) - half, y - half, Math.abs(x2 - x1) + CORRIDOR, CORRIDOR);
  const vertical = (x, y1, y2) => carve(tiles, size, x - half, Math.min(y1, y2) - half, CORRIDOR, Math.abs(y2 - y1) + CORRIDOR);
  if (rng() < 0.5) { horizontal(a.cy, a.cx, b.cx); vertical(b.cx, a.cy, b.cy); } else { vertical(a.cx, a.cy, b.cy); horizontal(b.cy, a.cx, b.cx); }
}

// Steps from `from` to every floor tile (4-neighbour walk). -1 = unreachable.
export function distancesFrom(tiles, size, fromTx, fromTy) {
  const dist = new Int32Array(size * size).fill(-1);
  const queue = [fromTy * size + fromTx];
  dist[queue[0]] = 0;
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const x = i % size;
    const y = Math.floor(i / size);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const j = ny * size + nx;
      if (tiles[j] === 1 && dist[j] < 0) {
        dist[j] = dist[i] + 1;
        queue.push(j);
      }
    }
  }
  return dist;
}

function randomIn(room, rng, margin = 1) {
  return {
    tx: room.x + margin + Math.floor(rng() * (room.w - 2 * margin)),
    ty: room.y + margin + Math.floor(rng() * (room.h - 2 * margin)),
  };
}

function build(rooms, links, tier, size, rng) {
  const tiles = new Uint8Array(size * size); // 0 wall, 1 floor
  for (const r of rooms) carve(tiles, size, r.x, r.y, r.w, r.h);
  for (const [i, j] of links) corridor(tiles, size, rooms[i], rooms[j], rng);

  const start = rooms[0];
  const spawn = { tx: start.cx, ty: start.cy + 2 };
  const exit = { tx: start.cx, ty: start.cy };
  const dist = distancesFrom(tiles, size, spawn.tx, spawn.ty);

  // the boss waits in the room that is the longest walk away
  let boss = 1;
  for (let i = 1; i < rooms.length; i++) {
    if (dist[rooms[i].cy * size + rooms[i].cx] > dist[rooms[boss].cy * size + rooms[boss].cx]) boss = i;
  }

  const side = rooms.map((_, i) => i).filter((i) => i !== 0 && i !== boss);
  const monsters = [];
  for (const i of side) {
    const count = 2 + Math.floor(rng() * 3) + (tier >= 2 ? 1 : 0);
    for (let k = 0; k < count; k++) monsters.push({ room: i, ...randomIn(rooms[i], rng, 2) });
  }
  const chestCount = 3 + (tier >= 2 ? 1 : 0);
  const order = [...side].sort(() => rng() - 0.5);
  const chests = Array.from({ length: chestCount }, (_, k) => {
    const room = order[k % order.length];
    return { idx: k, room, ...randomIn(rooms[room], rng, 1) };
  });

  return {
    size, tiles, rooms, spawn, exit, bossRoom: boss, bossAt: { tx: rooms[boss].cx, ty: rooms[boss].cy },
    monsters, chests, farthest: dist[rooms[boss].cy * size + rooms[boss].cx],
  };
}

function attempt(rng, tier, size) {
  const want = roomCountFor(tier);
  const rooms = [];
  for (let tries = 0; tries < 400 && rooms.length < want; tries++) {
    const w = MIN_ROOM + Math.floor(rng() * (MAX_ROOM - MIN_ROOM + 1));
    const h = MIN_ROOM + Math.floor(rng() * (MAX_ROOM - MIN_ROOM + 1));
    const r = { x: 2 + Math.floor(rng() * (size - w - 4)), y: 2 + Math.floor(rng() * (size - h - 4)), w, h };
    if (rooms.every((o) => !overlaps(r, o, ROOM_GAP))) rooms.push({ ...r, cx: r.x + Math.floor(r.w / 2), cy: r.y + Math.floor(r.h / 2) });
  }
  if (rooms.length < 5) return null;

  // join every room to the nearest room already joined (so everything is connected), plus a couple of loops
  const links = [];
  const joined = [0];
  const rest = new Set(rooms.map((_, i) => i).slice(1));
  const gap = (i, j) => Math.hypot(rooms[i].cx - rooms[j].cx, rooms[i].cy - rooms[j].cy);
  while (rest.size) {
    let best = null;
    for (const j of rest) for (const i of joined) if (!best || gap(i, j) < best.d) best = { i, j, d: gap(i, j) };
    links.push([best.i, best.j]);
    joined.push(best.j);
    rest.delete(best.j);
  }
  for (let k = 0; k < 2 && rooms.length >= 6; k++) {
    const i = Math.floor(rng() * rooms.length);
    const j = Math.floor(rng() * rooms.length);
    if (i !== j && !links.some(([a, b]) => (a === i && b === j) || (a === j && b === i))) links.push([i, j]);
  }
  return build(rooms, links, tier, size, rng);
}

// The plan can always be made: after a few unlucky tries a fixed three-room plan is used.
export function fallbackDungeon(tier, size = DUNGEON_SIZE) {
  const rooms = [0.12, 0.44, 0.75].map((f) => {
    const x = Math.floor(size * f);
    const y = Math.floor(size / 2) - 6;
    return { x, y, w: 12, h: 12, cx: x + 6, cy: y + 6 };
  });
  return build(rooms, [[0, 1], [1, 2]], tier, size, mulberry32(1));
}

export function generateDungeon({ seed, tier = 0, size = DUNGEON_SIZE }) {
  for (let n = 0; n < 20; n++) {
    const layout = attempt(mulberry32((seed + n * 7919) >>> 0), tier, size);
    if (layout) return { ...layout, seed, tier };
  }
  return { ...fallbackDungeon(tier, size), seed, tier };
}

// ---- caves: a passage under a ring of cliffs, from one mouth to the other
export const CAVE_SIZE = 64;

// A chain of rooms from one end to the other, joined in order: no way round the monsters in the middle. Each end has a
// way out (`exit` at the first room, `far` at the last) and a place to arrive at (`spawn`, `farSpawn`).
export function generateCave({ seed, tier = 0, size = CAVE_SIZE }) {
  const rng = mulberry32(seed >>> 0);
  const n = 4 + Math.floor(rng() * 2);
  const rooms = [];
  for (let i = 0; i < n; i++) {
    const w = 8 + Math.floor(rng() * 4);
    const h = 8 + Math.floor(rng() * 4);
    const x = 3 + Math.round((i * (size - 6 - w)) / (n - 1));
    const y = 4 + Math.floor(rng() * (size - h - 8));
    rooms.push({ x, y, w, h, cx: x + Math.floor(w / 2), cy: y + Math.floor(h / 2) });
  }
  const tiles = new Uint8Array(size * size);
  for (const r of rooms) carve(tiles, size, r.x, r.y, r.w, r.h);
  for (let i = 1; i < n; i++) corridor(tiles, size, rooms[i - 1], rooms[i], rng);
  const first = rooms[0];
  const last = rooms[n - 1];
  const monsters = [];
  for (let i = 1; i < n - 1; i++) {
    const count = 2 + Math.floor(rng() * 2) + (tier >= 2 ? 1 : 0);
    for (let k = 0; k < count; k++) monsters.push({ room: i, ...randomIn(rooms[i], rng, 2) });
  }
  const room = 1 + Math.floor(rng() * (n - 2));
  const dist = distancesFrom(tiles, size, first.cx, first.cy);
  return {
    seed, tier, size, tiles, rooms,
    exit: { tx: first.cx, ty: first.cy }, spawn: { tx: first.cx, ty: first.cy + 2 },
    far: { tx: last.cx, ty: last.cy }, farSpawn: { tx: last.cx, ty: last.cy + 2 },
    monsters, chests: [{ idx: 0, room, ...randomIn(rooms[room], rng, 1) }], bossAt: null,
    through: dist[last.cy * size + last.cx],
  };
}
