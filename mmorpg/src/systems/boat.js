import { TILE } from '../world/world.js';

// Boats: buy one from a merchant, then board it on a shore and sail over open water. It is put away when you land.
export const BOAT_PRICE = 400;
export const BOAT_SPEED = 1.25; // times your walking speed
const SHORE_REACH = 2; // tiles: how far from where you stand the water (or the land) may be

// The tile centre nearest to (px, py) within SHORE_REACH tiles that satisfies `ok`, or null.
function nearestSpot(px, py, ok) {
  const tx = Math.floor(px / TILE);
  const ty = Math.floor(py / TILE);
  let best = null;
  let bestD = Infinity;
  for (let dy = -SHORE_REACH; dy <= SHORE_REACH; dy++) {
    for (let dx = -SHORE_REACH; dx <= SHORE_REACH; dx++) {
      const x = (tx + dx + 0.5) * TILE;
      const y = (ty + dy + 0.5) * TILE;
      const d = Math.hypot(x - px, y - py);
      if (d < bestD && ok(x, y)) { best = { x, y }; bestD = d; }
    }
  }
  return best;
}

export const boardingSpot = (world, px, py) => nearestSpot(px, py, (x, y) => world.isSailable(x, y));
export const landingSpot = (world, px, py) => nearestSpot(px, py, (x, y) => world.isWalkable(x, y));

// What the B key would do right now: 'board', 'land', or null.
export function boatHint(state, world) {
  const p = state.player;
  if (state.area || !p.boat || state.dead) return null;
  if (p.boating) return landingSpot(world, p.x, p.y) ? 'land' : null;
  return boardingSpot(world, p.x, p.y) ? 'board' : null;
}

// Board or land. Returns { ok } or { error: 'noboat' | 'indungeon' | 'nowater' | 'noland' }.
export function toggleBoat(state, world) {
  const p = state.player;
  if (state.area) return { error: 'indungeon' };
  if (!p.boat) return { error: 'noboat' };
  if (p.boating) {
    const spot = landingSpot(world, p.x, p.y);
    if (!spot) return { error: 'noland' };
    Object.assign(p, { x: spot.x, y: spot.y, boating: false });
    return { ok: 'landed' };
  }
  const spot = boardingSpot(world, p.x, p.y);
  if (!spot) return { error: 'nowater' };
  Object.assign(p, { x: spot.x, y: spot.y, boating: true, rollTime: 0 });
  return { ok: 'boarded' };
}

export function buyBoat(state) {
  const p = state.player;
  if (p.boat) return { error: 'owned' };
  if (p.gold < BOAT_PRICE) return { error: 'gold' };
  p.gold -= BOAT_PRICE;
  p.boat = true;
  return { ok: true };
}
