// The land of the map: the shape of the continent and its islands, the mountains (a wall along the north edge and
// chains across the land, broken by passes), lakes, rivers that run from the mountains down to the sea, and the
// regions the land is cut into. Works on two grids: the full map (one cell a tile) and a coarse one (C×C tiles a cell)
// for everything that needs to look far.
import { fbm } from '../../core/noise.js';
import { stream, between, intBetween, clamp, Heap, chaikin, stampSegment, dist, sinTurn, cosTurn } from './util.js';

export const K = { WATER: 0, LAND: 1, WALL: 2, CHAIN: 3 }; // what a full-res cell is, before biomes
export const isMount = (k) => k === K.WALL || k === K.CHAIN;

// The shape: the continent, the islands around it and the northern wall, as `kind` (full res) and coarse summaries.
export function shapeLand(m) {
  const { N, G, C, seed, recipe } = m;
  const F = recipe.frame;
  const s = seed % 100000;
  // coarse land potential of the continent: an ellipse bent by noise, pulled up towards the wall here and there
  const pot = new Float32Array((G + 1) * (G + 1));
  for (let gy = 0; gy <= G; gy++) {
    for (let gx = 0; gx <= G; gx++) {
      const nx = gx / G;
      const ny = gy / G;
      const wx = nx + F.warp * (fbm(nx * 3, ny * 3, s + 11, 3) * 2 - 1);
      const wy = ny + F.warp * (fbm(nx * 3 + 7, ny * 3 + 7, s + 12, 3) * 2 - 1);
      const dx = (wx - F.cx) / F.rx;
      const dy = (wy - F.cy) / F.ry;
      let p = 1 - Math.sqrt(dx * dx + dy * dy) + F.rough * (fbm(nx * 5, ny * 5, s + 13, 4) - 0.5);
      p += clamp((0.22 - ny) / 0.12, 0, 1) * (fbm(nx * 6, 0.5, s + 14, 2) - 0.48) * 1.6; // land bridges to the wall, or straits
      pot[gy * (G + 1) + gx] = p;
    }
  }
  const kind = new Uint8Array(N * N);
  const edge = F.edge; // tiles of open sea along the west, east and south edges
  for (let y = 0; y < N; y++) {
    const fy = y / C;
    const gy = Math.min(G - 1, Math.floor(fy));
    const ty = fy - gy;
    for (let x = 0; x < N; x++) {
      const fx = x / C;
      const gx = Math.min(G - 1, Math.floor(fx));
      const tx = fx - gx;
      const a = pot[gy * (G + 1) + gx];
      const b = pot[gy * (G + 1) + gx + 1];
      const c = pot[(gy + 1) * (G + 1) + gx];
      const d = pot[(gy + 1) * (G + 1) + gx + 1];
      let p = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
      p += 0.07 * (fbm(x / 14, y / 14, s + 15, 2) - 0.5); // a ragged coast at tile scale
      const toEdge = Math.min(x, N - 1 - x, N - 1 - y);
      if (toEdge < edge) p -= ((edge - toEdge) / edge) * 0.6;
      kind[y * N + x] = p > 0 ? K.LAND : K.WATER;
    }
  }
  // islands in the open sea, most of them small
  const rng = stream(seed, 'islands');
  const islands = [];
  for (let tries = 0; tries < 900 && islands.length < recipe.islands.count; tries++) {
    const x = intBetween(rng, edge + 30, N - edge - 30);
    const y = intBetween(rng, Math.floor(N * 0.25), N - edge - 30);
    const r = 5 + Math.floor(rng() * rng() * recipe.islands.maxRadius);
    if (kind[y * N + x] !== K.WATER || landWithin(kind, N, x, y, r + 14)) continue;
    if (islands.some((i) => dist(i.x, i.y, x, y) < i.r + r + 18)) continue;
    islands.push({ x, y, r });
  }
  for (const isl of islands) {
    const R = isl.r * 1.4 + 3;
    for (let y = Math.max(0, isl.y - R); y < Math.min(N, isl.y + R); y++) {
      for (let x = Math.max(0, isl.x - R); x < Math.min(N, isl.x + R); x++) {
        const p = 1 - dist(x, y, isl.x, isl.y) / isl.r + 0.45 * (fbm(x / 7, y / 7, s + 16, 2) - 0.5);
        if (p > 0) kind[Math.floor(y) * N + Math.floor(x)] = K.LAND;
      }
    }
  }
  // the northern wall: mountains along the whole north edge, their foot bent by noise
  for (let x = 0; x < N; x++) {
    const depth = Math.round(N * (F.wall + F.wallNoise * (fbm(x / 60, 3.3, s + 17, 3) * 2 - 1)));
    for (let y = 0; y < depth; y++) kind[y * N + x] = K.WALL;
  }
  m.kind = kind;
  m.islands = islands;
}

function landWithin(kind, N, x, y, r) {
  for (let k = 0; k < 16; k++) {
    const a = k / 16;
    const px = Math.round(x + r * cosTurn(a));
    const py = Math.round(y + r * sinTurn(a));
    if (px >= 0 && py >= 0 && px < N && py < N && kind[py * N + px] !== K.WATER) return true;
  }
  return false;
}

// Mountain chains across the land (they part the south from the north, so the way to the far north goes over a pass),
// and lakes.
export function raiseMountains(m) {
  const { N, seed, recipe, kind } = m;
  const s = seed % 100000;
  const rng = stream(seed, 'chains');
  const R = recipe.mountains;
  const chains = [];
  const n = intBetween(rng, R.chains[0], R.chains[1]);
  for (let c = 0; c < n; c++) {
    const pts = [];
    let x = N * between(rng, 0.08, 0.4);
    let y = N * between(rng, R.band[0], R.band[1]);
    let dx = 1;
    let dy = between(rng, -0.5, 0.5);
    const steps = intBetween(rng, R.length[0], R.length[1]);
    for (let i = 0; i <= steps; i++) {
      pts.push({ x, y });
      dy = clamp(dy + between(rng, -0.35, 0.35), -0.8, 0.8);
      const l = Math.sqrt(dx * dx + dy * dy);
      x += (dx / l) * R.step;
      y = clamp(y + (dy / l) * R.step, N * R.band[0] - 40, N * R.band[1] + 40);
      if (x > N - 60) break;
    }
    const width = between(rng, R.width[0], R.width[1]);
    const passes = Array.from({ length: intBetween(rng, R.passes[0], R.passes[1]) }, () => between(rng, 0.15, 0.85)).sort((a, b) => a - b);
    chains.push({ pts, width, passes });
    // spurs: shorter ridges branching off the chain, thinner
    for (let k = intBetween(rng, R.spurs?.[0] ?? 0, R.spurs?.[1] ?? 0); k > 0 && pts.length > 3; k--) {
      const at = pts[intBetween(rng, 1, pts.length - 2)];
      const spur = [{ x: at.x, y: at.y }];
      let sx = at.x;
      let sy = at.y;
      let vx = between(rng, -0.6, 0.6);
      const vy = rng() < 0.5 ? -1 : 1;
      for (let i = intBetween(rng, 2, 4); i > 0; i--) {
        vx += between(rng, -0.4, 0.4);
        const l = Math.sqrt(vx * vx + vy * vy);
        sx += (vx / l) * R.step * 0.8;
        sy += (vy / l) * R.step * 0.8;
        spur.push({ x: sx, y: sy });
      }
      chains.push({ pts: spur, width: width * 0.55, passes: [] });
    }
  }
  for (const ch of chains) {
    const total = ch.pts.length - 1;
    const smooth = chaikin(ch.pts, 2);
    for (let i = 0; i < smooth.length - 1; i++) {
      const t0 = i / (smooth.length - 1); // how far along the chain
      if (ch.passes.some((p) => Math.abs(p - t0) < R.passWidth / (total * R.step))) continue; // a pass: no rock here
      const taper = Math.min(1, t0 / 0.15, (1 - t0) / 0.15);
      const w = ch.width * (0.35 + 0.65 * taper);
      stampSegment(smooth[i], smooth[i + 1], w + 4, (x, y) => {
        if (x < 0 || y < 0 || x >= N || y >= N) return;
        const k = y * N + x;
        if (kind[k] !== K.LAND) return;
        const rough = w * (0.45 + 0.9 * fbm(x / 11, y / 11, s + 21, 4)); // ragged, broad here, thin there
        const d = segDist(smooth[i], smooth[i + 1], x + 0.5, y + 0.5);
        if (d < rough) kind[k] = K.CHAIN;
      });
    }
  }
  m.chains = chains;
  // lakes: a few blobs of water inland, away from the coast
  const lrng = stream(seed, 'lakes');
  const lakes = [];
  for (let tries = 0; tries < 400 && lakes.length < intBetween(lrng, recipe.lakes[0], recipe.lakes[1]); tries++) {
    const x = intBetween(lrng, 80, N - 80);
    const y = intBetween(lrng, Math.floor(N * 0.2), Math.floor(N * 0.8));
    const r = intBetween(lrng, 9, 20);
    let ok = true;
    for (let dy = -r - 12; dy <= r + 12 && ok; dy += 3) for (let dx = -r - 12; dx <= r + 12 && ok; dx += 3) if (kind[(y + dy) * N + x + dx] !== K.LAND) ok = false;
    if (!ok || lakes.some((l) => dist(l.x, l.y, x, y) < 90)) continue;
    lakes.push({ x, y, r });
    for (let yy = y - r * 2; yy <= y + r * 2; yy++) {
      for (let xx = x - r * 2; xx <= x + r * 2; xx++) {
        const p = 1 - dist(xx, yy, x, y) / r + 0.5 * (fbm(xx / 6, yy / 6, s + 22, 2) - 0.5);
        if (p > 0 && kind[yy * N + xx] === K.LAND) kind[yy * N + xx] = K.WATER;
      }
    }
  }
  m.lakes = lakes;
}

export function segDist(a, b, px, py) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = clamp(((px - a.x) * dx + (py - a.y) * dy) / len2, 0, 1);
  const ex = px - a.x - t * dx;
  const ey = py - a.y - t * dy;
  return Math.sqrt(ex * ex + ey * ey);
}

// Coarse summaries: per C×C cell, is it water, mountain or open land.
export function coarsen(m) {
  const { N, G, C, kind } = m;
  const ck = new Uint8Array(G * G); // K of the majority
  for (let gy = 0; gy < G; gy++) {
    for (let gx = 0; gx < G; gx++) {
      let w = 0;
      let mt = 0;
      for (let y = 0; y < C; y++) {
        for (let x = 0; x < C; x++) {
          const k = kind[(gy * C + y) * N + gx * C + x];
          if (k === K.WATER) w++;
          else if (isMount(k)) mt++;
        }
      }
      const half = (C * C) / 2;
      ck[gy * G + gx] = w > half ? K.WATER : mt > half ? K.CHAIN : K.LAND;
    }
  }
  m.ck = ck;
}

const N8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];

// Rivers: water flows from high to low. The height falls from the north (the mountains) to the south (the sea); a
// priority flood from every sea and lake cell gives each land cell the cell it drains into, and summing the cells
// upstream (flow accumulation) shows where the water gathers. The biggest streams are drawn, widening downstream, with
// a ford every so often.
export function runRivers(m) {
  const { N, G, C, seed, recipe, ck, kind } = m;
  const s = seed % 100000;
  const H = new Float32Array(G * G);
  for (let gy = 0; gy < G; gy++) {
    for (let gx = 0; gx < G; gx++) {
      const i = gy * G + gx;
      H[i] = (1 - gy / G) * 1.6 + 0.5 * fbm(gx / 18, gy / 18, s + 31, 3) + (ck[i] === K.CHAIN ? 0.5 : 0);
    }
  }
  const filled = new Float32Array(G * G).fill(Infinity);
  const recv = new Int32Array(G * G).fill(-1);
  const order = [];
  const heap = new Heap(G * G);
  for (let i = 0; i < G * G; i++) {
    if (ck[i] === K.WATER) { filled[i] = 0; heap.push(i, 0); }
  }
  while (heap.size) {
    const i = heap.pop();
    if (heap.lastPri > filled[i]) continue;
    order.push(i);
    const x = i % G;
    const y = (i - x) / G;
    for (const [dx, dy] of N8) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= G || ny >= G) continue;
      const j = ny * G + nx;
      if (filled[j] !== Infinity) continue;
      filled[j] = Math.max(H[j], filled[i] + 1e-4);
      recv[j] = i;
      heap.push(j, filled[j]);
    }
  }
  const acc = new Float32Array(G * G);
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k];
    if (ck[i] === K.WATER) continue;
    acc[i] += 1;
    if (recv[i] >= 0) acc[recv[i]] += acc[i];
  }
  m.recv = recv;
  m.acc = acc;
  // river cells, and the paths of the rivers from their heads down to the water
  const T = recipe.rivers.threshold;
  const isRiver = (i) => ck[i] === K.LAND && acc[i] >= T;
  const fed = new Uint8Array(G * G);
  for (let i = 0; i < G * G; i++) if (isRiver(i) && recv[i] >= 0) fed[recv[i]] = 1;
  const river = new Uint8Array(N * N);
  const paths = [];
  const heads = [];
  for (let i = 0; i < G * G; i++) if (isRiver(i) && !fed[i]) heads.push(i); // a head: nothing river-sized flows into it
  const lengthOf = (i) => { let n = 0; for (let j = i; j >= 0 && ck[j] !== K.WATER && n < 2000; j = recv[j]) n++; return n; };
  const lens = new Map(heads.map((i) => [i, lengthOf(i)]));
  heads.sort((a, b) => lens.get(b) - lens.get(a) || a - b); // the longest first: they are the main stems
  const drawn = new Uint8Array(G * G);
  for (const i of heads) {
    const pts = [];
    let j = i;
    let guard = 0;
    while (j >= 0 && guard++ < 2000) {
      const x = j % G;
      pts.push({ x: x * C + C / 2, y: ((j - x) / G) * C + C / 2, a: acc[j] });
      if (ck[j] === K.WATER || drawn[j]) break; // the sea, a lake, or a river already drawn: this one ends there
      drawn[j] = 1;
      j = recv[j];
    }
    if (pts.length < 5) continue;
    paths.push(pts);
  }
  const rng = stream(seed, 'rivers');
  for (const pts of paths) {
    const sm = chaikin(pts.map((p) => ({ x: p.x + (fbm(p.x / 11, p.y / 11, s + 33, 2) - 0.5) * C * 1.5, y: p.y + (fbm(p.x / 11 + 9, p.y / 11, s + 34, 2) - 0.5) * C * 1.5 })), 3);
    const accAt = (t) => pts[Math.min(pts.length - 1, Math.floor(t * (pts.length - 1)))].a;
    let nextFord = between(rng, recipe.rivers.ford[0], recipe.rivers.ford[1]);
    let walked = 0;
    for (let k = 0; k < sm.length - 1; k++) {
      const t = k / (sm.length - 1);
      const half = 0.55 + 1.15 * clamp((accAt(t) - T) / (T * 6), 0, 1);
      const seg = dist(sm[k].x, sm[k].y, sm[k + 1].x, sm[k + 1].y);
      walked += seg;
      const ford = walked > nextFord;
      if (ford && walked > nextFord + 3) { walked = 0; nextFord = between(rng, recipe.rivers.ford[0], recipe.rivers.ford[1]); }
      stampSegment(sm[k], sm[k + 1], half, (x, y) => {
        if (x < 0 || y < 0 || x >= N || y >= N) return;
        const q = y * N + x;
        if (kind[q] !== K.LAND) return;
        if (ford) river[q] = 2;
        else if (river[q] !== 2) river[q] = 1;
      });
    }
  }
  m.river = river; // 1: river, 2: a ford
  m.riverPaths = paths;
}

// Regions: points spread evenly over the land (each at least `spacing` from the others), and every land cell joins
// the nearest point, measured on a map bent by noise, so the borders wind.
export function cutRegions(m) {
  const { G, C, seed, recipe, ck } = m;
  const s = seed % 100000;
  const rng = stream(seed, 'regions');
  const spacing = recipe.regionSpacing / C;
  const pts = [];
  for (let tries = 0; tries < 6000; tries++) {
    const x = rng() * G;
    const y = rng() * G;
    if (ck[Math.floor(y) * G + Math.floor(x)] !== K.LAND) continue;
    if (pts.some((p) => (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y) < spacing * spacing)) continue;
    pts.push({ x, y });
  }
  const region = new Uint8Array(G * G).fill(255);
  for (let gy = 0; gy < G; gy++) {
    for (let gx = 0; gx < G; gx++) {
      const i = gy * G + gx;
      if (ck[i] === K.WATER) continue;
      const wx = gx + (fbm(gx / 14, gy / 14, s + 41, 3) - 0.5) * spacing * 0.7;
      const wy = gy + (fbm(gx / 14 + 5, gy / 14 + 5, s + 42, 3) - 0.5) * spacing * 0.7;
      let best = 0;
      let bd = Infinity;
      for (let k = 0; k < pts.length; k++) {
        const d = (pts[k].x - wx) * (pts[k].x - wx) + (pts[k].y - wy) * (pts[k].y - wy);
        if (d < bd) { bd = d; best = k; }
      }
      region[i] = best;
    }
  }
  const regions = pts.map((p, id) => ({ id, sx: p.x * C, sy: p.y * C, cells: 0, cx: 0, cy: 0, nbrs: new Set(), coast: false, wall: false }));
  for (let gy = 0; gy < G; gy++) {
    for (let gx = 0; gx < G; gx++) {
      const r = region[gy * G + gx];
      if (r === 255 || ck[gy * G + gx] !== K.LAND) continue;
      const R = regions[r];
      R.cells++;
      R.cx += gx;
      R.cy += gy;
      for (const [dx, dy] of N8) {
        const nx = gx + dx;
        const ny = gy + dy;
        if (nx < 0 || ny < 0 || nx >= G || ny >= G) continue;
        const o = region[ny * G + nx];
        const ok = ck[ny * G + nx];
        if (ok === K.WATER) R.coast = true;
        if (ok === K.CHAIN && ny < G * 0.12) R.wall = true;
        if (o !== 255 && o !== r && ok === K.LAND) R.nbrs.add(o);
      }
    }
  }
  for (const R of regions) {
    if (R.cells) { R.cx = (R.cx / R.cells) * C + C / 2; R.cy = (R.cy / R.cells) * C + C / 2; }
    R.nbrs = [...R.nbrs].sort((a, b) => a - b);
  }
  m.cregion = region;
  m.regions = regions;
}

// Walking distance (in tiles, on the coarse grid) from a point to every cell, over open land; rivers slow but do not
// stop you (there are fords and bridges).
export function walkDistance(m, fromX, fromY) {
  const { G, C, ck, river, N } = m;
  const d = new Float32Array(G * G).fill(Infinity);
  const heap = new Heap(4096);
  const start = Math.floor(fromY / C) * G + Math.floor(fromX / C);
  d[start] = 0;
  heap.push(start, 0);
  while (heap.size) {
    const i = heap.pop();
    if (heap.lastPri > d[i]) continue;
    const x = i % G;
    const y = (i - x) / G;
    for (const [dx, dy, w] of N8) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= G || ny >= G) continue;
      const j = ny * G + nx;
      if (m.ck[j] !== K.LAND) continue;
      const wet = river[(ny * C + C / 2) * N + nx * C + C / 2] === 1 ? 2 : 1;
      const nd = d[i] + w * C * wet;
      if (nd < d[j]) { d[j] = nd; heap.push(j, nd); }
    }
  }
  return d;
}
