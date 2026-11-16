// Flying monsters hover this high above their shadow: their body is drawn, and hit by arrows, this much higher.
export const FLY_HEIGHT = 20;
export const isFlying = (e) => !!e.def?.flying;
export const bodyY = (e) => (isFlying(e) ? e.y - FLY_HEIGHT : e.y);

// avoidTown: the entity may not enter a town (used by enemies, towns are safe zones).
// Flyers cross water and anything else that is only ground; they are stopped by walls (in a dungeon) and by towns.
export function moveWithCollision(world, e, dx, dy, avoidTown = false) {
  const flying = isFlying(e);
  const open = (x, y) => (flying ? !world.blocksShots?.(x, y) : world.isWalkable(x, y));
  const ok = (x, y) => open(x, y) && !(avoidTown && world.isTown(x, y));
  if (ok(e.x + dx, e.y)) e.x += dx;
  if (ok(e.x, e.y + dy)) e.y += dy;
}

// A boat moves over open water only.
export function moveBoat(world, e, dx, dy) {
  if (world.isSailable(e.x + dx, e.y)) e.x += dx;
  if (world.isSailable(e.x, e.y + dy)) e.y += dy;
}

// Is there a clear line between two points? Always yes in the open; inside a dungeon, walls get in the way.
export const canSee = (world, ax, ay, bx, by) => (world.lineClear ? world.lineClear(ax, ay, bx, by) : true);

// Walk towards the player. Inside a dungeon, when a wall is in the way, follow the path the world offers instead.
export function chasePlayer(world, e, px, py, speed, dt, avoidTown = false) {
  const dir = world.chaseDirection?.(e.x, e.y, px, py);
  if (dir) moveWithCollision(world, e, dir.x * speed * dt, dir.y * speed * dt, avoidTown);
  else moveToward(world, e, px, py, speed, dt, avoidTown);
}

export function moveToward(world, e, tx, ty, speed, dt, avoidTown = false) {
  const dx = tx - e.x;
  const dy = ty - e.y;
  const d = Math.hypot(dx, dy);
  if (d < 1) return;
  const step = Math.min(speed * dt, d);
  moveWithCollision(world, e, (dx / d) * step, (dy / d) * step, avoidTown);
}
