import { CHUNK, TILE } from '../world/world.js';
import { lairsInRange } from './lairs.js';

// Fog of war: which tiles the player has already seen. Stored as one bit per tile, per chunk.
export const SIGHT = 12; // tiles you see around you
export const SIGHT_PX = SIGHT * TILE;
export const REVEAL = SIGHT + 1; // revealed a bit further than the fog fades, so the fade never meets a hidden tile
const FAR_SIGHT = 1.4; // safety glasses (a relic): see this much farther below ground

// How far you see right now, in tiles: farther below ground with something on that gives far sight.
export function sightOf(state) {
  const far = state.area && Object.values(state.player?.equipment ?? {}).some((it) => it?.effect === 'farSight');
  const own = SIGHT + Math.trunc(state.player?.stats?.sight ?? 0); // perception: a tile more for every two points
  return far ? Math.round(own * FAR_SIGHT) : own;
}
export const MAX_SAVED_CHUNKS = 4000;

const BYTES = (CHUNK * CHUNK) / 8;
const KEY = /^(-?\d{1,5}),(-?\d{1,5})$/;
const key = (cx, cy) => `${cx},${cy}`;

export class Explored {
  constructor() {
    this.chunks = new Map(); // "cx,cy" -> { cx, cy, bits: Uint8Array, version }
    this.tiles = 0; // how many tiles have been seen
  }

  chunk(cx, cy, create = false) {
    const k = key(cx, cy);
    let c = this.chunks.get(k);
    if (!c && create) {
      c = { cx, cy, bits: new Uint8Array(BYTES), version: 0 };
      this.chunks.set(k, c);
    }
    return c;
  }

  has(tx, ty) {
    const cx = Math.floor(tx / CHUNK);
    const cy = Math.floor(ty / CHUNK);
    const c = this.chunks.get(key(cx, cy));
    if (!c) return false;
    const i = (ty - cy * CHUNK) * CHUNK + (tx - cx * CHUNK);
    return ((c.bits[i >> 3] >> (i & 7)) & 1) === 1;
  }

  // Marks every tile within r tiles of (tx, ty) as seen (only those `visible(x, y)` allows, if given: walls hide what is behind
  // them). Returns how many tiles were new.
  reveal(tx, ty, r = REVEAL, visible = null) {
    let added = 0;
    const touched = new Set();
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = tx + dx;
        const y = ty + dy;
        if (visible && !visible(x, y)) continue;
        const cx = Math.floor(x / CHUNK);
        const cy = Math.floor(y / CHUNK);
        const c = this.chunk(cx, cy, true);
        const i = (y - cy * CHUNK) * CHUNK + (x - cx * CHUNK);
        const mask = 1 << (i & 7);
        if (c.bits[i >> 3] & mask) continue;
        c.bits[i >> 3] |= mask;
        touched.add(c);
        added++;
      }
    }
    for (const c of touched) c.version++;
    this.tiles += added;
    return added;
  }

  toJSON() {
    const chunks = {};
    for (const [k, c] of this.chunks) {
      if (c.bits.some((b) => b !== 0)) chunks[k] = btoa(String.fromCharCode(...c.bits));
    }
    return { chunks };
  }

  // Loads saved data, which may be damaged or edited: anything that does not fit is skipped.
  static fromJSON(data) {
    const ex = new Explored();
    const raw = data && typeof data.chunks === 'object' && data.chunks ? data.chunks : {};
    let loaded = 0;
    for (const [k, b64] of Object.entries(raw)) {
      if (loaded >= MAX_SAVED_CHUNKS) break;
      const m = KEY.exec(k);
      if (!m || typeof b64 !== 'string' || b64.length > 200) continue;
      let bytes;
      try {
        bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
      } catch {
        continue;
      }
      if (bytes.length !== BYTES) continue;
      const c = ex.chunk(Number(m[1]), Number(m[2]), true);
      c.bits.set(bytes);
      c.version = 1;
      for (const byte of bytes) ex.tiles += POPCOUNT[byte];
      loaded++;
    }
    return ex;
  }
}

const POPCOUNT = Array.from({ length: 256 }, (_, n) => {
  let c = 0;
  for (let v = n; v; v >>= 1) c += v & 1;
  return c;
});

// A town counts as discovered once its centre has been seen. Returns the towns that are new.
export function discoverTowns(state, world) {
  const p = state.player;
  const found = [];
  for (const town of world.townsInRange(p.x, p.y, SIGHT_PX + TILE)) {
    if (state.discovered.has(town.id) || !state.explored.has(town.tx, town.ty)) continue;
    state.discovered.add(town.id);
    found.push(town);
  }
  return found;
}

// A boss lair is discovered when its centre has been seen. Returns the lairs that are new.
export function discoverLairs(state, world) {
  const p = state.player;
  const found = [];
  for (const lair of lairsInRange(world, p.x, p.y, SIGHT_PX + TILE, state.bossDefs ?? [])) {
    if (state.discovered.has(lair.id) || !state.explored.has(lair.tx, lair.ty)) continue;
    state.discovered.add(lair.id);
    found.push(lair);
  }
  return found;
}

// Reveals the area around the player when they enter a new tile. Returns the newly discovered towns.
export function updateExploration(state, world) {
  const p = state.player;
  const tx = Math.floor(p.x / TILE);
  const ty = Math.floor(p.y / TILE);
  if (state.lastRevealTile && state.lastRevealTile[0] === tx && state.lastRevealTile[1] === ty) return [];
  state.lastRevealTile = [tx, ty];
  // in a dungeon the walls decide what you see; in the open it is everything around you
  const reveal = sightOf(state) + 1;
  const vis = world.computeVisible ? world.computeVisible(tx, ty, reveal) : null;
  state.visible = vis;
  return state.explored.reveal(tx, ty, reveal, vis ? (x, y) => vis.has(x, y) : null) > 0 ? discoverTowns(state, world) : [];
}
