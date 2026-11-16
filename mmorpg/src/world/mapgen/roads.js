// Roads between towns: which towns are linked (the shortest tree joining them all, plus the road of the story from
// the start to the chronicler's city and on to the capital), and how each road runs: the cheapest way over the
// coarse grid (A*), easy over meadows, harder through forest, snow and up slopes, never over mountains or lakes,
// across a river only on a bridge; a road already built is cheap to follow, so roads merge into a network. Then the
// path is smoothed and laid down three tiles wide, from gate to gate.
import { K } from './terrain.js';
import { F } from './places.js';
import { Heap, chaikin, stampSegment, dist } from './util.js';
import { TT, townTile } from '../towngen.js';

const COST = { grass: 1, beach: 1.3, desert: 1.4, forest: 1.8, snow: 2 };
const ROAD_HALF = 1.3;
const STUB = 3; // tiles a road runs straight out of a gate
const ON_ROAD = 0.35; // cost of following a road already built

// Where a town's road leaves: the gate on the side that faces the other town (or the gate nearest to it).
export function gateFacing(t, other) {
  const dx = other.x - t.x;
  const dy = other.y - t.y;
  const side = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : dy > 0 ? 's' : 'n';
  const gates = t.layout.gates.map((g) => ({ ...g, x: t.x - t.layout.hx + g.x, y: t.y - t.layout.hy + g.y }));
  const d = (g) => dist(other.x, other.y, g.x, g.y);
  return gates.find((g) => g.side === side) ?? gates.reduce((a, b) => (d(b) < d(a) ? b : a));
}

export function buildRoads(m) {
  const { G, C, N, towns, story } = m;
  // the cost of each coarse cell
  const cost = new Float32Array(G * G);
  const inTown = new Uint8Array(G * G);
  for (const t of towns) { // the inside of a town (not the ring along its wall, where roads arrive at the gates)
    for (let y = t.y - t.layout.hy + 3; y <= t.y + t.layout.hy - 3; y++) {
      for (let x = t.x - t.layout.hx + 3; x <= t.x + t.layout.hx - 3; x++) inTown[Math.floor(y / C) * G + Math.floor(x / C)] = 1;
    }
  }
  for (let gy = 0; gy < G; gy++) {
    for (let gx = 0; gx < G; gx++) {
      const i = gy * G + gx;
      let water = 0;
      let rock = 0;
      let wet = 0;
      let vale = 0;
      for (let y = 0; y < C; y++) {
        for (let x = 0; x < C; x++) {
          const k = (gy * C + y) * N + gx * C + x;
          if (m.kind[k] === K.WATER) water++;
          else if (m.kind[k] !== K.LAND) rock++;
          if (m.river[k]) wet++;
          if (m.flags[k] & (F.VRING | F.VIN)) vale++;
        }
      }
      if (water > 4 || rock > 4 || vale || inTown[i]) { cost[i] = Infinity; continue; }
      const R = m.regions[m.cregion[i]];
      cost[i] = (COST[R?.biome] ?? 1.5) + (wet ? 7 : 0) + (rock ? 3 : 0);
    }
  }
  // which towns to link: a minimum spanning tree (Prim) over straight distances, and the story's road
  const n = towns.length;
  const inTree = new Array(n).fill(false);
  const bestD = new Array(n).fill(Infinity);
  const from = new Array(n).fill(-1);
  bestD[0] = 0;
  const edges = [];
  for (let k = 0; k < n; k++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!inTree[i] && (u < 0 || bestD[i] < bestD[u])) u = i;
    inTree[u] = true;
    if (from[u] >= 0) edges.push([from[u], u]);
    for (let v = 0; v < n; v++) {
      if (inTree[v]) continue;
      const d = dist(towns[u].x, towns[u].y, towns[v].x, towns[v].y);
      if (d < bestD[v]) { bestD[v] = d; from[v] = u; }
    }
  }
  const idx = (role) => towns.findIndex((t) => t.role === role);
  for (const [a, b] of [['start', 'city'], ['city', 'capital']]) {
    const i = idx(a);
    const j = idx(b);
    if (i >= 0 && j >= 0 && !edges.some(([p, q]) => (p === i && q === j) || (p === j && q === i))) edges.push([i, j]);
  }
  // build the shortest first, so the long ones can follow them
  edges.sort((e1, e2) => dist(towns[e1[0]].x, towns[e1[0]].y, towns[e1[1]].x, towns[e1[1]].y) - dist(towns[e2[0]].x, towns[e2[0]].y, towns[e2[1]].x, towns[e2[1]].y));
  const onRoad = new Uint8Array(G * G);
  const roads = [];
  for (const [i, j] of edges) {
    const a = towns[i];
    const b = towns[j];
    const ga = gateFacing(a, b);
    const gb = gateFacing(b, a);
    const pa = { x: ga.x + 0.5 + ga.dx * STUB, y: ga.y + 0.5 + ga.dy * STUB };
    const pb = { x: gb.x + 0.5 + gb.dx * STUB, y: gb.y + 0.5 + gb.dy * STUB };
    const path = aStar(m, cost, onRoad, pa, pb);
    if (!path) continue;
    for (const c of path) onRoad[c] = 1;
    const mid = path.map((c) => ({ x: (c % G) * C + C / 2, y: Math.floor(c / G) * C + C / 2 }));
    const pts = chaikin([{ x: ga.x + 0.5, y: ga.y + 0.5 }, pa, ...mid.slice(1, -1), pb, { x: gb.x + 0.5, y: gb.y + 0.5 }], 2);
    let len = 0;
    for (let k = 0; k < pts.length - 1; k++) {
      len += dist(pts[k].x, pts[k].y, pts[k + 1].x, pts[k + 1].y);
      stampSegment(pts[k], pts[k + 1], ROAD_HALF, (x, y) => {
        if (x < 0 || y < 0 || x >= N || y >= N) return;
        if (insideAnyTown(towns, x, y)) return;
        const q = y * N + x;
        if (m.kind[q] === K.WATER && !m.river[q]) return; // never out onto a lake
        m.flags[q] |= F.ROAD;
      });
    }
    roads.push({ from: i, to: j, pts, len });
  }
  m.roads = roads;
}

function insideAnyTown(towns, x, y) {
  for (const t of towns) {
    const lx = x - t.x + t.layout.hx;
    const ly = y - t.y + t.layout.hy;
    if (lx < -1 || ly < -1 || lx > 2 * t.layout.hx + 1 || ly > 2 * t.layout.hy + 1) continue;
    if (townTile(t.layout, lx, ly) !== TT.OUT) return true;
  }
  return false;
}

const N8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];

function aStar(m, cost, onRoad, a, b) {
  const { G, C } = m;
  const s = Math.floor(a.y / C) * G + Math.floor(a.x / C);
  const t = Math.floor(b.y / C) * G + Math.floor(b.x / C);
  const g = new Float32Array(G * G).fill(Infinity);
  const prev = new Int32Array(G * G).fill(-1);
  const tx = t % G;
  const ty = Math.floor(t / G);
  const h = (i) => {
    const dx = Math.abs((i % G) - tx);
    const dy = Math.abs(Math.floor(i / G) - ty);
    return ON_ROAD * (Math.max(dx, dy) + 0.4142 * Math.min(dx, dy));
  };
  const heap = new Heap(8192);
  g[s] = 0;
  heap.push(s, h(s));
  let steps = 0;
  while (heap.size && steps++ < 200000) {
    const i = heap.pop();
    if (i === t) break;
    if (heap.lastPri > g[i] + h(i) + 1e-6) continue; // an old entry: this cell was reached more cheaply since
    const x = i % G;
    const y = (i - x) / G;
    for (const [dx, dy, w] of N8) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= G || ny >= G) continue;
      const j = ny * G + nx;
      let c = cost[j];
      if (c === Infinity && j !== t) continue;
      if (c === Infinity) c = 1;
      if (onRoad[j]) c = ON_ROAD;
      const ng = g[i] + c * w;
      if (ng < g[j]) {
        g[j] = ng;
        prev[j] = i;
        heap.push(j, ng + h(j));
      }
    }
  }
  if (g[t] === Infinity) return null;
  const path = [];
  for (let i = t; i >= 0; i = prev[i]) path.push(i);
  return path.reverse();
}
