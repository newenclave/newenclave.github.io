// Relief (generator 5): every tile has a level of height, 0 (the shore) to 3 on land, 4 for the mountains. Two
// neighbours on different levels have a cliff between them, which nobody walks over; a ramp (flag F.RAMP, on the upper
// tile) lets you walk up one level. The levels are data, not a look, so another renderer (an isometric one) can use them.
//
// In two parts. shapeRelief (before the tiles are made): a field of height from noise, rising a little towards the
// north, low by the water (shores, rivers and lakes stay on level 0, and the land climbs from them in wide terraces),
// flat under every place (towns, lairs, dungeons, camps, the Ring, valleys, the spots of side stories), cut into levels,
// and with no plateau smaller than a few houses. rampUp (after the tiles, before the reach check): roads and fords climb
// one level at a time and are ramps where they do, more ramps are spread along every cliff, and every piece of land you
// could walk to is joined to the start by at least one ramp. The reach check (index.js) then walks by the same rule.
import { fbm } from '../../core/noise.js';
import { K, isMount } from './terrain.js';
import { F } from './places.js';
import { hash2 } from '../../core/rng.js';

export const MOUNT_LEVEL = 4;
const N4 = (N, k) => {
  const x = k % N;
  return [x > 0 ? k - 1 : -1, x < N - 1 ? k + 1 : -1, k >= N ? k - N : -1, k < N * N - N ? k + N : -1];
};

// May you walk from tile k to its neighbour n? (The same rule as MapWorld.canStep.)
export const stepOk = (height, flags, k, n) => {
  const a = height[k];
  const b = height[n];
  return a === b || ((a - b === 1 || b - a === 1) && ((flags[k] | flags[n]) & F.RAMP) !== 0);
};

export function shapeRelief(m) {
  const { N, G, seed, recipe, kind, river } = m;
  const R = recipe.relief;
  const s = seed % 100000;
  // the broad shape, on the coarse grid: rolling noise, a little higher towards the north
  const W = G + 1;
  const coarse = new Float32Array(W * W);
  for (let gy = 0; gy <= G; gy++) {
    for (let gx = 0; gx <= G; gx++) coarse[gy * W + gx] = fbm(gx / R.scale, gy / R.scale, s + 7101, 4) + R.north * (1 - gy / G);
  }
  const f = new Float32Array(N * N);
  const Cc = N / G;
  for (let y = 0; y < N; y++) {
    const fy = y / Cc;
    const gy = Math.min(G - 1, Math.floor(fy));
    const ty = fy - gy;
    for (let x = 0; x < N; x++) {
      const fx = x / Cc;
      const gx = Math.min(G - 1, Math.floor(fx));
      const tx = fx - gx;
      const a = coarse[gy * W + gx];
      const b = coarse[gy * W + gx + 1];
      const c = coarse[(gy + 1) * W + gx];
      const d = coarse[(gy + 1) * W + gx + 1];
      f[y * N + x] = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty
        + R.jitter * (fbm(x / R.jitterScale, y / R.jitterScale, s + 7102, 2) - 0.5); // ragged edges at tile scale
    }
  }
  // low by the water: level 0 along the shore of the sea, a lake or a river, and from there at most one level more every
  // `shoreGap` tiles inland (wide terraces, not a staircase down to the water)
  const wd = waterDistance(m);
  const th = R.levels; // where each level above 0 begins
  for (let k = 0; k < N * N; k++) {
    const cap = wd[k] < R.shore ? 0 : 1 + Math.floor((wd[k] - R.shore) / R.shoreGap);
    if (cap < th.length) f[k] = Math.min(f[k], th[cap] - 1e-3);
  }
  // flat under every place, easing into the land around
  const flat = (x, y, rx, ry, band) => flatten(f, N, x, y, rx, ry, band);
  for (const t of m.towns) flat(t.x, t.y, t.layout.hx + 3, t.layout.hy + 3, 7);
  for (const l of m.lairs) flat(l.x, l.y, 12, 12, 6);
  for (const d of m.dungeons) flat(d.x, d.y, 5, 5, 4);
  for (const c of m.camps) flat(c.x, c.y, 5, 5, 4);
  for (const v of m.valleys) flat(v.x, v.y, Math.ceil(v.r * 1.22 + 7), Math.ceil(v.r * 1.22 + 7), 5);
  flat(m.ring.x, m.ring.y, 10, 10, 6);
  for (const S of Object.values(m.spots)) flat(S.x, S.y, S.r + 3, S.r + 3, 4);
  // into levels
  const height = new Uint8Array(N * N);
  for (let k = 0; k < N * N; k++) {
    if (kind[k] === K.WATER || river[k]) continue;
    if (isMount(kind[k])) { height[k] = MOUNT_LEVEL; continue; }
    let h = 0;
    while (h < th.length && f[k] >= th[h]) h++;
    height[k] = h;
  }
  dropSmallPatches(m, height, R.minPatch);
  // the ground the places stand on is one level, whatever the easing of a neighbour's ground did to it (the places do not
  // overlap: each has its own reserved ground)
  const core = (x, y, rx, ry) => {
    const lv = height[y * N + x];
    for (let yy = Math.max(0, y - ry); yy <= Math.min(N - 1, y + ry); yy++) {
      for (let xx = Math.max(0, x - rx); xx <= Math.min(N - 1, x + rx); xx++) {
        const k = yy * N + xx;
        if (kind[k] === K.LAND && !river[k]) height[k] = lv;
      }
    }
  };
  for (const t of m.towns) core(t.x, t.y, t.layout.hx + 1, t.layout.hy + 1);
  for (const l of m.lairs) core(l.x, l.y, 8, 8);
  for (const d of m.dungeons) core(d.x, d.y, 4, 4);
  for (const c of m.camps) core(c.x, c.y, 4, 4);
  core(m.ring.x, m.ring.y, 6, 6);
  for (const S of Object.values(m.spots)) core(S.x, S.y, S.r, S.r);
  m.height = height;
}

// How far each tile is from water (the sea, a lake, a river), in tiles, by a two-sweep chamfer distance.
function waterDistance(m) {
  const { N, kind, river } = m;
  const d = new Float32Array(N * N);
  const BIG = 1e6;
  for (let k = 0; k < N * N; k++) d[k] = kind[k] === K.WATER || river[k] === 1 ? 0 : BIG;
  const D = 1.4142;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const k = y * N + x;
      let v = d[k];
      if (x > 0) v = Math.min(v, d[k - 1] + 1);
      if (y > 0) {
        v = Math.min(v, d[k - N] + 1);
        if (x > 0) v = Math.min(v, d[k - N - 1] + D);
        if (x < N - 1) v = Math.min(v, d[k - N + 1] + D);
      }
      d[k] = v;
    }
  }
  for (let y = N - 1; y >= 0; y--) {
    for (let x = N - 1; x >= 0; x--) {
      const k = y * N + x;
      let v = d[k];
      if (x < N - 1) v = Math.min(v, d[k + 1] + 1);
      if (y < N - 1) {
        v = Math.min(v, d[k + N] + 1);
        if (x < N - 1) v = Math.min(v, d[k + N + 1] + D);
        if (x > 0) v = Math.min(v, d[k + N - 1] + D);
      }
      d[k] = v;
    }
  }
  return d;
}

// The field is the value of its centre within the box (rx, ry), and eases back to itself over `band` tiles around it.
function flatten(f, N, x, y, rx, ry, band) {
  const c = f[y * N + x];
  for (let yy = Math.max(0, y - ry - band); yy <= Math.min(N - 1, y + ry + band); yy++) {
    for (let xx = Math.max(0, x - rx - band); xx <= Math.min(N - 1, x + rx + band); xx++) {
      const out = Math.max(Math.abs(xx - x) - rx, Math.abs(yy - y) - ry, 0);
      const t = Math.min(1, out / band);
      const w = t * t * (3 - 2 * t); // smoothstep: 0 inside, 1 at the outer edge of the band
      const k = yy * N + xx;
      f[k] = c + (f[k] - c) * w;
    }
  }
}

// A patch of one level smaller than `min` tiles takes the level most of its neighbours have.
function dropSmallPatches(m, height, min) {
  const { N, kind, river } = m;
  const fixed = (k) => kind[k] === K.WATER || river[k] || isMount(kind[k]);
  const seen = new Uint8Array(N * N);
  const stack = new Int32Array(N * N);
  const cells = new Int32Array(N * N);
  for (let k0 = 0; k0 < N * N; k0++) {
    if (seen[k0] || fixed(k0)) continue;
    const h = height[k0];
    let sp = 0;
    let n = 0;
    stack[sp++] = k0;
    seen[k0] = 1;
    const count = [0, 0, 0, 0, 0];
    while (sp) {
      const k = stack[--sp];
      cells[n++] = k;
      for (const j of N4(N, k)) {
        if (j < 0 || fixed(j)) continue;
        if (height[j] !== h) { count[height[j]]++; continue; }
        if (!seen[j]) { seen[j] = 1; stack[sp++] = j; }
      }
    }
    if (n >= min) continue;
    let best = -1;
    for (let l = 0; l < count.length; l++) if (count[l] > 0 && (best < 0 || count[l] > count[best])) best = l;
    if (best < 0) continue; // a patch with nothing but water around: an islet, keep it
    for (let i = 0; i < n; i++) height[cells[i]] = best;
  }
}

// Ramps: roads and fords climb one level at a time and are ramps where they do; more ramps along every cliff, about one
// every `rampEvery` tiles. Then rampUp's caller (the reach check) joins what is still cut off.
export function rampUp(m, tiles, walkable) {
  const { N, flags, height, recipe, seed } = m;
  const R = recipe.relief;
  const isWay = (k) => (flags[k] & F.ROAD) !== 0 || m.river[k] === 2;
  // a way never steps more than one level from tile to tile (the higher side comes down)
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (let k = 0; k < N * N; k++) {
      if (!isWay(k)) continue;
      for (const n of N4(N, k)) {
        if (n >= 0 && isWay(n) && height[n] > height[k] + 1 && height[n] !== MOUNT_LEVEL) { height[n] = height[k] + 1; changed = true; }
      }
    }
    if (!changed) break;
  }
  for (let k = 0; k < N * N; k++) {
    if (!isWay(k)) continue;
    for (const n of N4(N, k)) {
      if (n < 0 || !isWay(n) || height[k] - height[n] !== 1) continue;
      flags[k] |= F.RAMP; // the upper tile of the step
    }
  }
  // along the cliffs: in every square of rampEvery tiles, the edge tile with the smallest hash gets a ramp
  const open = (k) => walkable[tiles[k]] && !(flags[k] & (F.VRING | F.VIN));
  const S = R.rampEvery;
  for (let cy = 0; cy < N; cy += S) {
    for (let cx = 0; cx < N; cx += S) {
      let best = -1;
      let bestH = 2;
      let bestN = -1;
      for (let y = cy; y < Math.min(N, cy + S); y++) {
        for (let x = cx; x < Math.min(N, cx + S); x++) {
          const k = y * N + x;
          if (!open(k) || flags[k] & F.RAMP) continue;
          for (const n of N4(N, k)) {
            if (n < 0 || !open(n) || height[k] - height[n] !== 1) continue;
            const h = hash2(x, y, seed + 7103);
            if (h < bestH) { bestH = h; best = k; bestN = n; }
          }
        }
      }
      if (best >= 0) makeRamp(m, tiles, walkable, best, bestN);
    }
  }
}

// A ramp on the upper tile `up` down to its neighbour `low`, three tiles wide along the cliff where it can be.
export function makeRamp(m, tiles, walkable, up, low) {
  const { N, flags, height } = m;
  flags[up] |= F.RAMP;
  const side = Math.abs(up - low) === 1 ? N : 1; // along the cliff
  for (const s of [side, -side]) {
    const u = up + s;
    const l = low + s;
    if (u < 0 || l < 0 || u >= N * N || l >= N * N) continue;
    if (side === 1 && Math.floor(u / N) !== Math.floor(up / N)) continue;
    if (walkable[tiles[u]] && walkable[tiles[l]] && height[u] - height[l] === 1) flags[u] |= F.RAMP;
  }
}
