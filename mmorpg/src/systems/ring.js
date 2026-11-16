import { hash2 } from '../core/rng.js';
import { TILE } from '../world/world.js';
import { beastName } from '../world/names.js';
import { valleyTileAt } from '../world/valleys.js';
import { ensureHistory } from './history.js';
import { onEnding } from './quests.js';

// The Ring (docs/story.md, act 3): the collider that unfolded the world, still running, deep under the ground far out
// where the danger is greatest. One per world, its place decided by the seed. A shaft leads down to it; below waits its
// keeper, and behind the keeper the console where the player decides: fold the dimension back, or leave it open.
export const RING_ID = 'r:ring';
export const RING_DISTANCE = 1500; // tiles from the start
export const ENDINGS = ['fold', 'open'];
const SEARCH = 80; // tiles around the chosen point to find open ground for the shaft

const cache = new WeakMap(); // world -> the Ring's entrance

// The shaft down to the Ring, as a dungeon entrance (enterDungeon takes it like any other).
export function ringSite(world) {
  if (world.isMap) return world.ringSite; // the finite map placed it at the foot of the northern wall
  if (cache.has(world)) return cache.get(world);
  let site = null;
  if (!world.isDungeon) {
    const a = hash2(17, 23, world.seed + 7700) * Math.PI * 2;
    const cx = Math.round(Math.cos(a) * RING_DISTANCE);
    const cy = Math.round(Math.sin(a) * RING_DISTANCE);
    for (let r = 0; r <= SEARCH && !site; r += 2) {
      for (let k = 0; k < Math.max(1, r * 3) && !site; k++) {
        const b = (k / Math.max(1, r * 3)) * Math.PI * 2;
        const tx = Math.round(cx + Math.cos(b) * r);
        const ty = Math.round(cy + Math.sin(b) * r);
        const free = world.openGround ? world.openGround(tx, ty) : world.rawBiomeIdAt(tx, ty) > 0;
        if (!free || world.townAtPx((tx + 0.5) * TILE, (ty + 0.5) * TILE, 10 * TILE) || valleyTileAt(world, tx, ty) !== 0) continue;
        site = {
          id: RING_ID, cx: 9001, cy: 9001, tx, ty, px: tx * TILE + TILE / 2, py: ty * TILE + TILE / 2, tier: 4, theme: 'ring',
          bossId: 'ring_keeper', name: beastName(world.seed, 9001, 9001, 77), ring: true, angle: a,
        };
      }
    }
  }
  cache.set(world, site);
  return site;
}

// Which way the Ring lies from a place, as a compass word: dir.n, dir.ne, ...
export function ringDirection(world, from) {
  const site = ringSite(world);
  if (!site) return 'dir.n';
  const a = Math.atan2(site.ty - from.ty, site.tx - from.tx); // y grows southwards
  const dirs = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'];
  return 'dir.' + dirs[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
}

// The console in the keeper's room: there once the keeper is beaten, for as long as the choice is not made.
export function consoleOpen(state) {
  return state.area?.id === RING_ID && !state.ending && (state.lairs?.get(RING_ID)?.respawn ?? 0) > 0;
}

// The choice. Returns false if it cannot be made (already made, or not at the console).
export function chooseEnding(state, choice) {
  if (!ENDINGS.includes(choice) || !consoleOpen(state)) return false; // only at the console, once its keeper is down
  state.ending = choice;
  ensureHistory(state).learned.add(`s:end:${choice}`);
  if (choice === 'fold' && state.pulse) state.pulse.active = null; // the last Pulse fades as the fold closes
  state.note = { key: `ending.${choice}.note`, title: 'ending.title', t: 0, dur: 22 };
  onEnding(state);
  state.ui.panel = null;
  return true;
}
