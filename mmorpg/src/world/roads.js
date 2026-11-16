import { hash2 } from '../core/rng.js';

// Roads between neighbouring walled towns (generator 3): from a gate of one town to the facing gate of the other, in a
// gentle curve. Where a road meets a river or a chasm it becomes a bridge, and it cuts a pass through cliffs, so the
// towns of a landmass stay connected. Decided by the towns alone, so any tile can be asked about on its own.
const ROAD_HALF = 1.3; // tiles from the middle of a road to its edge: three tiles wide
const STUB = 3; // tiles a road runs straight out of a gate before it starts to bend
const CURVE_STEPS = 10;

const cache = new WeakMap(); // world -> Map(cell key -> roads near that town cell)

// The gate on the side that faces the other town; a town with no gate there (a long village has only two) uses the
// gate nearest to it.
function gateFacing(town, other) {
  const dx = other.tx - town.tx;
  const dy = other.ty - town.ty;
  const side = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : dy > 0 ? 's' : 'n';
  const dist = (g) => Math.hypot(other.tx - g.tx, other.ty - g.ty);
  return town.gates.find((g) => g.side === side) ?? town.gates.reduce((a, b) => (dist(b) < dist(a) ? b : a));
}

function makeRoad(world, a, b) {
  const ga = gateFacing(a, b);
  const gb = gateFacing(b, a);
  const p0 = { x: ga.tx + 0.5, y: ga.ty + 0.5 };
  const p1 = { x: p0.x + ga.dx * STUB, y: p0.y + ga.dy * STUB };
  const p3 = { x: gb.tx + 0.5, y: gb.ty + 0.5 };
  const p2 = { x: p3.x + gb.dx * STUB, y: p3.y + gb.dy * STUB };
  const len = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
  const bend = (hash2(a.tx + b.tx, a.ty + b.ty, world.seed + 5000) - 0.5) * 0.4 * len;
  const ctrl = { x: (p1.x + p2.x) / 2 - ((p2.y - p1.y) / len) * bend, y: (p1.y + p2.y) / 2 + ((p2.x - p1.x) / len) * bend };
  const pts = [p0];
  for (let i = 0; i <= CURVE_STEPS; i++) { // quadratic Bezier from p1 to p2
    const t = i / CURVE_STEPS;
    const u = 1 - t;
    pts.push({ x: u * u * p1.x + 2 * u * t * ctrl.x + t * t * p2.x, y: u * u * p1.y + 2 * u * t * ctrl.y + t * t * p2.y });
  }
  pts.push(p3);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return {
    from: a.id, to: b.id, pts,
    minX: Math.min(...xs) - ROAD_HALF, maxX: Math.max(...xs) + ROAD_HALF, minY: Math.min(...ys) - ROAD_HALF, maxY: Math.max(...ys) + ROAD_HALF,
  };
}

// Roads that start at the town of cell (cx, cy): to the east and south neighbours, and to the south-east one when one of
// those is missing. Every pair of neighbours is linked from one side only, so no road is made twice.
export function roadsFrom(world, cx, cy) {
  const a = world.getTown(cx, cy);
  if (!a?.walled) return [];
  const east = world.getTown(cx + 1, cy);
  const south = world.getTown(cx, cy + 1);
  const out = [];
  if (east) out.push(makeRoad(world, a, east));
  if (south) out.push(makeRoad(world, a, south));
  const se = !east || !south ? world.getTown(cx + 1, cy + 1) : null;
  if (se) out.push(makeRoad(world, a, se));
  return out;
}

function roadsNearCell(world, cx, cy) {
  let map = cache.get(world);
  if (!map) cache.set(world, (map = new Map()));
  const key = cx + ',' + cy;
  let list = map.get(key);
  if (list) return list;
  const C = world.townCell;
  const box = { minX: cx * C - C / 2, maxX: cx * C + C / 2, minY: cy * C - C / 2, maxY: cy * C + C / 2 };
  list = [];
  for (let y = cy - 2; y <= cy + 1; y++) {
    for (let x = cx - 2; x <= cx + 1; x++) {
      for (const r of roadsFrom(world, x, y)) {
        if (r.maxX >= box.minX && r.minX <= box.maxX && r.maxY >= box.minY && r.minY <= box.maxY) list.push(r);
      }
    }
  }
  map.set(key, list);
  return list;
}

function segmentDist(px, py, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2)) : 0;
  return Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t));
}

// Is the tile on a road?
export function roadAt(world, tx, ty) {
  if (!world.params.walled) return false;
  const C = world.townCell;
  const list = roadsNearCell(world, Math.floor((tx + C / 2) / C), Math.floor((ty + C / 2) / C));
  const x = tx + 0.5;
  const y = ty + 0.5;
  for (const r of list) {
    if (x < r.minX || x > r.maxX || y < r.minY || y > r.maxY) continue;
    for (let i = 1; i < r.pts.length; i++) if (segmentDist(x, y, r.pts[i - 1], r.pts[i]) <= ROAD_HALF) return true;
  }
  return false;
}
