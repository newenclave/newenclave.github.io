import { TILE, CHUNK, BIOME_IDS } from './world.js';

const SIGHT_STEP = 0.5; // tiles between samples when checking what you can see
const LOS_STEP = 6; // pixels between samples when checking whether a shot or a blow gets through
const BODY = 10; // half the width of a walking monster: a path must be clear this far to each side
const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// A dungeon floor as a world: it offers the same questions as the open world (is this walkable? what tile is that?),
// so movement, combat, fog of war and drawing work unchanged. Walls also block sight, shots and blows.
export class Dungeon {
  constructor(layout, theme, biomes) {
    this.isDungeon = true;
    this.layout = layout;
    this.theme = theme;
    this.biomes = biomes;
    this.seed = layout.seed;
    this.gen = 0;
    this.size = layout.size;
    this.floorId = BIOME_IDS.indexOf(`${theme}_floor`);
    this.wallId = BIOME_IDS.indexOf(`${theme}_wall`);
    this.chunks = new Map();
    this.field = null;
  }

  isFloorTile(tx, ty) {
    return tx >= 0 && ty >= 0 && tx < this.size && ty < this.size && this.layout.tiles[ty * this.size + tx] === 1;
  }

  tileAt(tx, ty) {
    return this.isFloorTile(tx, ty) ? this.floorId : this.wallId;
  }

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

  isWalkable(px, py) {
    return this.isFloorTile(Math.floor(px / TILE), Math.floor(py / TILE));
  }

  // ---- the questions the open world answers about towns and land: there is none of that down here
  isTown() { return false; }
  isSailable() { return false; }
  townAtPx() { return null; }
  townsInRange() { return []; }
  getTown() { return null; }
  getTownById() { return null; }
  rawBiomeIdAt() { return 0; }
  isLand() { return false; }
  pruneChunks() {}

  findSpawn() {
    return { x: this.layout.spawn.tx * TILE + TILE / 2, y: this.layout.spawn.ty * TILE + TILE / 2 };
  }

  // ---- walls get in the way
  // Can a shot or a blow go straight from a to b? (Both ends are not checked, only what lies between.)
  lineClear(ax, ay, bx, by) {
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.ceil(len / LOS_STEP);
    for (let k = 1; k < n; k++) {
      const f = k / n;
      if (!this.isWalkable(ax + (bx - ax) * f, ay + (by - ay) * f)) return false;
    }
    return true;
  }

  // Can something with a body walk straight from a to b? Like lineClear, but three rays wide: a ray that slips past a
  // wall corner is not enough for a monster that would catch on it.
  wideClear(ax, ay, bx, by) {
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const nx = (-(by - ay) / len) * BODY;
    const ny = ((bx - ax) / len) * BODY;
    return this.lineClear(ax, ay, bx, by) && this.lineClear(ax + nx, ay + ny, bx + nx, by + ny) && this.lineClear(ax - nx, ay - ny, bx - nx, by - ny);
  }

  blocksShots(px, py) {
    return !this.isWalkable(px, py);
  }

  // Which tiles within r of (tx, ty) can be seen from there. A wall can be seen, what is behind it cannot.
  computeVisible(tx, ty, r) {
    const side = 2 * r + 1;
    const bits = new Uint8Array(side * side);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const dist = Math.hypot(dx, dy);
        const n = Math.max(1, Math.ceil(dist / SIGHT_STEP));
        let open = true;
        for (let k = 1; k < n && open; k++) {
          const f = k / n;
          const cx = Math.floor(tx + 0.5 + dx * f);
          const cy = Math.floor(ty + 0.5 + dy * f);
          if (cx === tx + dx && cy === ty + dy) break; // the ray has arrived: a wall is seen, only what lies behind it is not
          open = this.isFloorTile(cx, cy);
        }
        if (open) bits[(dy + r) * side + dx + r] = 1;
      }
    }
    return {
      tx, ty, r,
      has: (x, y) => {
        const dx = x - tx;
        const dy = y - ty;
        return Math.abs(dx) <= r && Math.abs(dy) <= r && bits[(dy + r) * side + dx + r] === 1;
      },
    };
  }

  // ---- finding the way: a distance map over the whole floor, rebuilt when the player changes tile
  buildField(ptx, pty) {
    const size = this.size;
    const dist = new Int16Array(size * size).fill(-1);
    const queue = new Int32Array(size * size);
    let tail = 0;
    const start = pty * size + ptx;
    if (this.isFloorTile(ptx, pty)) {
      dist[start] = 0;
      queue[tail++] = start;
    }
    for (let head = 0; head < tail; head++) {
      const i = queue[head];
      const x = i % size;
      const y = (i - x) / size;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (!this.isFloorTile(nx, ny) || dist[ny * size + nx] >= 0) continue;
        if (dx !== 0 && dy !== 0 && !(this.isFloorTile(x + dx, y) && this.isFloorTile(x, y + dy))) continue; // no cutting corners
        dist[ny * size + nx] = dist[i] + 1;
        queue[tail++] = ny * size + nx;
      }
    }
    return { tx: ptx, ty: pty, dist };
  }

  // Which way should a monster at (ex, ey) walk to reach (px, py)? null = straight at it (nothing in the way).
  chaseDirection(ex, ey, px, py) {
    if (this.wideClear(ex, ey, px, py)) return null;
    const ptx = Math.floor(px / TILE);
    const pty = Math.floor(py / TILE);
    if (!this.field || this.field.tx !== ptx || this.field.ty !== pty) this.field = this.buildField(ptx, pty);
    const { dist } = this.field;
    const size = this.size;
    const etx = Math.floor(ex / TILE);
    const ety = Math.floor(ey / TILE);
    const at = (x, y) => (this.isFloorTile(x, y) ? dist[y * size + x] : -1);
    const here = at(etx, ety);
    if (here < 0) return null;
    let best = null;
    let bestD = here;
    for (const [dx, dy] of NEIGHBOURS) {
      const d = at(etx + dx, ety + dy);
      if (d >= 0 && d < bestD) { best = [dx, dy]; bestD = d; }
    }
    if (!best) return null;
    const tx = (etx + best[0] + 0.5) * TILE - ex;
    const ty = (ety + best[1] + 0.5) * TILE - ey;
    const len = Math.hypot(tx, ty) || 1;
    return { x: tx / len, y: ty / len };
  }
}
