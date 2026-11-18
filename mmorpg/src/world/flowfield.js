// Finding the way on the open map: a distance map (breadth-first) over a square window of tiles around a goal, kept to
// the rules of walking (what is open ground, and which neighbours you may step between: the cliffs of the relief).
// A monster then steps to the neighbouring tile that is closer to the goal. The same idea as the dungeon's map of the
// whole floor (world/dungeon.js), cut to a window because the map is a thousand tiles across.
export const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
export const NO_WAY = Object.freeze({ x: 0, y: 0, none: true }); // the goal cannot be reached from here

// open(tx, ty): may a walker be on this tile; step(ax, ay, bx, by): may it go between these two neighbouring tiles.
// A diagonal step needs both straight ways round to be open (no cutting corners).
export function makePasses(open, step) {
  return (x, y, dx, dy) => {
    const nx = x + dx;
    const ny = y + dy;
    if (!open(nx, ny)) return false;
    if (dx === 0 || dy === 0) return step(x, y, nx, ny);
    return open(x + dx, y) && open(x, y + dy)
      && step(x, y, x + dx, y) && step(x + dx, y, nx, ny)
      && step(x, y, x, y + dy) && step(x, y + dy, nx, ny);
  };
}

// The distance (in steps) from every tile of the window to the goal (cx, cy); -1 where the goal cannot be reached.
export function buildField(cx, cy, r, open, step) {
  const passes = makePasses(open, step);
  const side = 2 * r + 1;
  const dist = new Int16Array(side * side).fill(-1);
  const queue = new Int32Array(side * side);
  let tail = 0;
  if (open(cx, cy)) {
    dist[r * side + r] = 0;
    queue[tail++] = r * side + r;
  }
  for (let head = 0; head < tail; head++) {
    const i = queue[head];
    const lx = i % side;
    const ly = (i - lx) / side;
    const x = cx - r + lx;
    const y = cy - r + ly;
    for (const [dx, dy] of NEIGHBOURS) {
      const nlx = lx + dx;
      const nly = ly + dy;
      if (nlx < 0 || nly < 0 || nlx >= side || nly >= side || dist[nly * side + nlx] >= 0) continue;
      if (!open(x + dx, y + dy) || !passes(x + dx, y + dy, -dx, -dy)) continue; // a walker there steps this way to come closer
      dist[nly * side + nlx] = dist[i] + 1;
      queue[tail++] = nly * side + nlx;
    }
  }
  return { cx, cy, r, side, dist, passes };
}

export function fieldAt(f, tx, ty) {
  const lx = tx - f.cx + f.r;
  const ly = ty - f.cy + f.r;
  if (lx < 0 || ly < 0 || lx >= f.side || ly >= f.side) return -1;
  return f.dist[ly * f.side + lx];
}

// Which way should a walker at the point (ex, ey) go to come closer to the goal of the field? A unit vector towards the
// centre of the next tile; null when it is already there (go straight); NO_WAY when the goal cannot be reached from here.
export function stepAlong(f, ex, ey, tile) {
  const etx = Math.floor(ex / tile);
  const ety = Math.floor(ey / tile);
  const here = fieldAt(f, etx, ety);
  if (here < 0) return NO_WAY;
  if (here === 0) return null;
  let best = null;
  let bestD = here;
  for (const [dx, dy] of NEIGHBOURS) {
    const d = fieldAt(f, etx + dx, ety + dy);
    if (d >= 0 && d < bestD && f.passes(etx, ety, dx, dy)) { best = [dx, dy]; bestD = d; }
  }
  if (!best) return null;
  const tx = (etx + best[0] + 0.5) * tile - ex;
  const ty = (ety + best[1] + 0.5) * tile - ey;
  const len = Math.sqrt(tx * tx + ty * ty) || 1;
  return { x: tx / len, y: ty / len };
}
