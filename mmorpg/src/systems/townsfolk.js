import { TILE } from '../world/world.js';
import { townTile, TT } from '../world/towngen.js';
import { folkDeedLine } from './deeds.js';

// People in the streets of walled towns: they wander from place to place, stop for a while, and say a word when you
// walk by. Only the towns near the player have them; they are not saved (a town fills up again when you come back).
export const FOLK = { hamlet: 2, village: 3, town: 5, city: 7, capital: 9 };
export const FOLK_LINES = 14; // folk.say.0 .. 13
export const FOLK_LOOKS = 6;
const NEAR = 1400; // px: towns this close have people out
const SPEED = 38; // px/s, a stroll
const WANDER = 7; // tiles: how far one goes at a time
const TALK_REACH = 55; // px: walk this close and they say something
const TALK_TIME = 3.2; // seconds a line stays above their head
const TALK_AGAIN = 25; // seconds before the same person speaks again

const WALK = [TT.STREET, TT.YARD, TT.FIELD];

// A random walkable tile of the town (local tile coordinates), or null.
function streetTile(town, rng, near = null) {
  const L = town.layout;
  for (let i = 0; i < 40; i++) {
    const x = near ? near.x + Math.round((rng() - 0.5) * 2 * WANDER) : Math.floor(rng() * L.w);
    const y = near ? near.y + Math.round((rng() - 0.5) * 2 * WANDER) : Math.floor(rng() * L.h);
    if (WALK.includes(townTile(L, x, y))) return { x, y };
  }
  return null;
}

const toPx = (town, tile) => ({ x: (town.tx - town.hx + tile.x + 0.5) * TILE, y: (town.ty - town.hy + tile.y + 0.5) * TILE });

function populate(town, rng) {
  const out = [];
  for (let i = 0; i < (FOLK[town.kind] ?? 0); i++) {
    const at = streetTile(town, rng);
    if (!at) continue;
    out.push({ ...toPx(town, at), tile: at, target: null, wait: rng() * 3, look: Math.floor(rng() * FOLK_LOOKS), line: Math.floor(rng() * FOLK_LINES), say: 0, quiet: 0 });
  }
  return out;
}

// Moves the people of the towns near the player, and lets them speak when the player passes. state.folk: town id -> list.
export function updateFolk(state, world, dt, rng = Math.random) {
  state.folk ??= new Map();
  if (state.area || world.isDungeon) return;
  const p = state.player;
  const near = new Set();
  for (const town of world.townsInRange(p.x, p.y, NEAR)) {
    if (!town.walled) continue;
    near.add(town.id);
    if (!state.folk.has(town.id)) state.folk.set(town.id, populate(town, rng));
    for (const f of state.folk.get(town.id)) {
      f.say = Math.max(0, f.say - dt);
      f.quiet = Math.max(0, f.quiet - dt);
      if (f.quiet <= 0 && Math.hypot(f.x - p.x, f.y - p.y) <= TALK_REACH) { // a word as you pass
        f.say = TALK_TIME;
        f.quiet = TALK_AGAIN;
        f.line = folkDeedLine(state, town.id, rng) ?? Math.floor(rng() * FOLK_LINES); // sometimes, what you did here
      }
      if (f.say > 0) continue; // people stop to talk
      if (f.wait > 0) { f.wait -= dt; continue; }
      if (!f.target) {
        const next = streetTile(town, rng, f.tile);
        f.target = next && { ...toPx(town, next), tile: next };
        if (!f.target) { f.wait = 2; continue; }
      }
      const dx = f.target.x - f.x;
      const dy = f.target.y - f.y;
      const d = Math.hypot(dx, dy);
      const step = SPEED * dt;
      const nx = f.x + (d > step ? (dx / d) * step : dx);
      const ny = f.y + (d > step ? (dy / d) * step : dy);
      if (!world.isWalkable(nx, ny)) { // a house in the way: try somewhere else
        f.target = null;
        f.wait = 0.5;
        continue;
      }
      f.x = nx;
      f.y = ny;
      if (d <= step) {
        f.tile = f.target.tile;
        f.target = null;
        f.wait = 1 + rng() * 4;
      }
    }
  }
  for (const id of state.folk.keys()) if (!near.has(id)) state.folk.delete(id); // far away: back indoors
}
