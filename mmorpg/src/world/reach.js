import { TILE } from './world.js';

// Can you walk from here to there? Land is explored on a coarse grid (one node per STEP tiles); two
// neighbouring nodes are joined only when every tile between them is land, so narrow rivers are never jumped.
// Used to pick a start that is not an island, and to keep quests pointing at places you can actually reach.
const STEP = 4;
const nodeKey = (ix, iy) => (ix + 8192) * 16384 + (iy + 8192);
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Walkable ground. Worlds that cannot tell (test stand-ins) count any land or town.
export const landTile = (world, tx, ty) => (world.passable
  ? world.passable(tx, ty)
  : world.townAtPx((tx + 0.5) * TILE, (ty + 0.5) * TILE) !== null || world.rawBiomeIdAt(tx, ty) !== 0);

function edgeOpen(world, ix, iy, jx, jy) {
  for (let k = 1; k < STEP; k++) {
    const tx = ix * STEP + Math.round(((jx - ix) * STEP * k) / STEP);
    const ty = iy * STEP + Math.round(((jy - iy) * STEP * k) / STEP);
    if (!landTile(world, tx, ty)) return false;
  }
  return true;
}

// Breadth-first walk over land from (tx, ty). Stops after maxNodes, inside `bounds` (tile box) if given,
// or as soon as it gets next to `goal` ({ tx, ty }).
export function flood(world, tx, ty, { maxNodes = 20000, bounds = null, goal = null } = {}) {
  const visited = new Map();
  const land = new Map();
  const isLand = (ix, iy) => {
    const k = nodeKey(ix, iy);
    let v = land.get(k);
    if (v === undefined) {
      v = landTile(world, ix * STEP, iy * STEP);
      land.set(k, v);
    }
    return v;
  };
  const start = [Math.round(tx / STEP), Math.round(ty / STEP)];
  const goalNode = goal && [Math.round(goal.tx / STEP), Math.round(goal.ty / STEP)];
  const queue = [start];
  visited.set(nodeKey(...start), true);
  let reachedGoal = false;
  for (let head = 0; head < queue.length && visited.size < maxNodes; head++) {
    const [ix, iy] = queue[head];
    if (goalNode && Math.abs(ix - goalNode[0]) <= 1 && Math.abs(iy - goalNode[1]) <= 1) {
      reachedGoal = true;
      break;
    }
    for (const [dx, dy] of DIRS) {
      const jx = ix + dx;
      const jy = iy + dy;
      const k = nodeKey(jx, jy);
      if (visited.has(k)) continue;
      if (bounds && (jx * STEP < bounds.minX || jx * STEP > bounds.maxX || jy * STEP < bounds.minY || jy * STEP > bounds.maxY)) continue;
      if (!isLand(jx, jy) || !edgeOpen(world, ix, iy, jx, jy)) continue;
      visited.set(k, true);
      queue.push([jx, jy]);
    }
  }
  return { visited, count: visited.size, capped: visited.size >= maxNodes, reachedGoal };
}

export function reached(result, tx, ty) {
  const ix = Math.round(tx / STEP);
  const iy = Math.round(ty / STEP);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) if (result.visited.has(nodeKey(ix + dx, iy + dy))) return true;
  }
  return false;
}

// Is there a land route between two tiles? Only looks in the box around them (plus a margin), so it stays cheap.
export function canWalk(world, from, to, { margin = 60, maxNodes = 14000 } = {}) {
  const bounds = {
    minX: Math.min(from.tx, to.tx) - margin, maxX: Math.max(from.tx, to.tx) + margin,
    minY: Math.min(from.ty, to.ty) - margin, maxY: Math.max(from.ty, to.ty) + margin,
  };
  return flood(world, from.tx, from.ty, { maxNodes, bounds, goal: to }).reachedGoal;
}

// A good place to start: a big landmass that leads to several towns.
export function goodStart(world) {
  const f = flood(world, 0, 0, { maxNodes: 20000 });
  if (f.count < 12000) return false;
  const others = world.townsInRange(0, 0, 350 * TILE).filter((t) => t.id !== '0,0');
  return others.filter((t) => reached(f, t.tx, t.ty)).length >= 3;
}
