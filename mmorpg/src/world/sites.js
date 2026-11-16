import { hash2 } from '../core/rng.js';

// Where boss lairs may be, from the seed alone (before any look at the ground). The terrain needs this too: it keeps
// the arena around every possible lair free of cliffs, chasms and rivers, so a boss fight is never split by a gap.
export const LAIR_CELL = 128; // tiles
const LAIR_CHANCE = 0.6;
export const LAIR_ARENA = 22; // tiles around a lair kept open (a boss wakes within ACTIVATE_PX)

export function lairCandidate(seed, cx, cy) {
  if (hash2(cx, cy, seed + 9001) > LAIR_CHANCE) return null;
  return {
    tx: cx * LAIR_CELL + 24 + Math.floor(hash2(cx, cy, seed + 9002) * 80),
    ty: cy * LAIR_CELL + 24 + Math.floor(hash2(cx, cy, seed + 9003) * 80),
  };
}

// Is the tile within the arena of a possible lair?
export function nearLairSite(seed, tx, ty, reach = LAIR_ARENA) {
  const cx = Math.floor(tx / LAIR_CELL);
  const cy = Math.floor(ty / LAIR_CELL);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const c = lairCandidate(seed, cx + dx, cy + dy);
      if (c && Math.hypot(c.tx - tx, c.ty - ty) < reach) return true;
    }
  }
  return false;
}
