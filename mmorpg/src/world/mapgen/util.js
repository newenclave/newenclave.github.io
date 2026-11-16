// Small tools for the map generator. Everything here is plain arithmetic: the same seed must give the same map in any
// browser, so no Math.random and no Math.sin/cos/atan2/hypot/pow (they may differ between engines in the last bits).
import { hash2, mulberry32 } from '../../core/rng.js';

// A stream of random numbers of its own for each stage, so tuning one stage does not reshuffle the others.
export function stream(seed, stage) {
  let h = 2166136261;
  for (let i = 0; i < stage.length; i++) h = Math.imul(h ^ stage.charCodeAt(i), 16777619);
  return mulberry32(Math.floor(hash2(seed | 0, h | 0, 4242) * 4294967296));
}

export const between = (rng, a, b) => a + rng() * (b - a);
export const intBetween = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));
export const pickOne = (rng, list) => list[Math.floor(rng() * list.length)];
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const dist = (ax, ay, bx, by) => Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));

// sin and cos of a turn t (0..1 is a full circle), from a polynomial: good to about 1e-3, the same everywhere.
export function sinTurn(t) {
  let x = t - Math.floor(t); // 0..1
  let sign = 1;
  if (x >= 0.5) { x -= 0.5; sign = -1; }
  const p = 2 * x * (1 - 2 * x); // u(1-u) for u = 2x, half a turn: Bhaskara's sin(pi u) = 16p / (5 - 4p)
  return (sign * 16 * p) / (5 - 4 * p);
}
export const cosTurn = (t) => sinTurn(t + 0.25);

// A binary min-heap of integer keys with float priorities, on typed arrays (for A* and Dijkstra on big grids).
export class Heap {
  constructor(cap = 1024) {
    this.keys = new Int32Array(cap);
    this.pri = new Float64Array(cap);
    this.size = 0;
  }
  push(key, p) {
    if (this.size === this.keys.length) {
      const k = new Int32Array(this.size * 2);
      k.set(this.keys);
      const q = new Float64Array(this.size * 2);
      q.set(this.pri);
      this.keys = k;
      this.pri = q;
    }
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.pri[parent] <= p) break;
      this.keys[i] = this.keys[parent];
      this.pri[i] = this.pri[parent];
      i = parent;
    }
    this.keys[i] = key;
    this.pri[i] = p;
  }
  pop() { // the key with the lowest priority; read its priority from lastPri
    const top = this.keys[0];
    this.lastPri = this.pri[0];
    const n = --this.size;
    if (n > 0) {
      const key = this.keys[n];
      const p = this.pri[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && this.pri[c + 1] < this.pri[c]) c++;
        if (this.pri[c] >= p) break;
        this.keys[i] = this.keys[c];
        this.pri[i] = this.pri[c];
        i = c;
      }
      this.keys[i] = key;
      this.pri[i] = p;
    }
    return top;
  }
}

// Corner-cutting smoothing of a polyline (Chaikin): each pass rounds every bend a little more. Ends stay put.
export function chaikin(pts, passes = 2) {
  let out = pts;
  for (let k = 0; k < passes; k++) {
    if (out.length < 3) return out;
    const next = [out[0]];
    for (let i = 0; i < out.length - 1; i++) {
      const a = out[i];
      const b = out[i + 1];
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    next.push(out[out.length - 1]);
    out = next;
  }
  return out;
}

// Every tile within `half` tiles of the segment a-b (tile centres), as callbacks.
export function stampSegment(a, b, half, visit) {
  const x0 = Math.floor(Math.min(a.x, b.x) - half - 1);
  const x1 = Math.ceil(Math.max(a.x, b.x) + half + 1);
  const y0 = Math.floor(Math.min(a.y, b.y) - half - 1);
  const y1 = Math.ceil(Math.max(a.y, b.y) + half + 1);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5 - a.x;
      const py = y + 0.5 - a.y;
      const t = clamp((px * dx + py * dy) / len2, 0, 1);
      const ex = px - t * dx;
      const ey = py - t * dy;
      if (ex * ex + ey * ey <= half * half) visit(x, y, t);
    }
  }
}

// FNV-1a over bytes: the fingerprint of a map.
export function fingerprint(bytes) {
  let h = 2166136261;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}
