import { TILE } from '../world/world.js';

// The farther from the start, the more dangerous the world: 5 tiers. The finite map knows the tier of each of its
// regions (it grows with the walking distance from the start); the endless world counts one per TIER_DISTANCE tiles.
// Monsters get tougher and hit harder, and pay more XP and gold for it.
export const TIER_DISTANCE = 250;
export const MAX_TIER = 4;

export const tierAtTile = (tx, ty, world = null) => (world?.tierAt
  ? world.tierAt(Math.floor(tx), Math.floor(ty))
  : Math.min(MAX_TIER, Math.floor(Math.hypot(tx, ty) / TIER_DISTANCE)));
export const tierAtPx = (x, y, world = null) => tierAtTile(x / TILE, y / TILE, world);

export function tierScale(tier) {
  return { hp: 1 + 0.45 * tier, damage: 1 + 0.3 * tier, reward: 1 + 0.5 * tier };
}
