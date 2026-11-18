// Flying monsters hover this high above their shadow: their body is drawn, and hit by arrows, this much higher.
export const FLY_HEIGHT = 20;
export const isFlying = (e) => !!e.def?.flying;
export const bodyY = (e) => (isFlying(e) ? e.y - FLY_HEIGHT : e.y);

// avoidTown: the entity may not enter a town (used by enemies, towns are safe zones).
// Flyers cross water and anything else that is only ground; they are stopped by walls (in a dungeon) and by towns.
// Walkers also keep to the levels of the relief: no stepping off or up a cliff, only along a ramp (world.canStep).
export function moveWithCollision(world, e, dx, dy, avoidTown = false) {
  const flying = isFlying(e);
  const open = (x, y) => (flying ? !world.blocksShots?.(x, y) : world.isWalkable(x, y) && world.canStep?.(e.x, e.y, x, y) !== false);
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

// Walk towards the player. When something is in the way (a wall underground; a cliff, a river or a mountain on the
// map), follow the way round the world offers instead. When there is no way at all, the monster still presses on, and
// e.lost counts how long it has found none (enemy.js gives up the chase after a while).
export function chasePlayer(world, e, px, py, speed, dt, avoidTown = false) {
  const dir = world.chaseDirection?.(e.x, e.y, px, py);
  e.lost = dir?.none ? (e.lost ?? 0) + dt : 0;
  if (dir && !dir.none) moveWithCollision(world, e, dir.x * speed * dt, dir.y * speed * dt, avoidTown);
  else moveToward(world, e, px, py, speed, dt, avoidTown);
}

// Walk back home, the way round if need be. One that finds no way home for a few seconds is simply back there (it
// happens out of the fight: a monster goes home when you are far, safe, or out of its reach).
export const LOST_HOME = 4;
export function goHome(world, e, speed, dt, avoidTown = true) {
  const dir = world.wayTo?.(e.x, e.y, e.home.x, e.home.y, e);
  if (dir?.none) {
    e.lost = (e.lost ?? 0) + dt;
    if (e.lost > LOST_HOME) { e.x = e.home.x; e.y = e.home.y; e.lost = 0; }
    return;
  }
  e.lost = 0;
  if (dir) moveWithCollision(world, e, dir.x * speed * dt, dir.y * speed * dt, avoidTown);
  else moveToward(world, e, e.home.x, e.home.y, speed, dt, avoidTown);
}

export function moveToward(world, e, tx, ty, speed, dt, avoidTown = false) {
  const dx = tx - e.x;
  const dy = ty - e.y;
  const d = Math.hypot(dx, dy);
  if (d < 1) return;
  const step = Math.min(speed * dt, d);
  moveWithCollision(world, e, (dx / d) * step, (dy / d) * step, avoidTown);
}
