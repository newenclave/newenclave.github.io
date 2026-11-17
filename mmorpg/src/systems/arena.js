// The test arena: one closed hall to try fights in. Monsters of any kind and danger tier on demand, every weapon at any
// rarity, a damage meter, a god mode. Nothing here is saved. Open it from the main menu or with ?arena.
import { Dungeon } from '../world/dungeon.js';
import { TILE } from '../world/world.js';
import { makeEnemy } from '../sim/enemy.js';
import { makeBoss } from '../sim/boss.js';
import { buildItem, RARITIES } from '../sim/loot.js';
import { Explored, updateExploration } from './explore.js';
import { recalcStats } from './stats.js';
import { MAX_TIER } from './difficulty.js';

export const ARENA_SIZE = 64;
const HALL = { x0: 3, y0: 3, x1: 60, y1: 44 }; // the floor, in tiles
const SPAWN_AT = { tx: 14, ty: 24 };
const PACK = 5;

// A hall with a few pillars (to hide behind, to test sight and shots) and a side room behind a wall with a doorway.
export function arenaLayout() {
  const size = ARENA_SIZE;
  const tiles = new Uint8Array(size * size);
  const set = (x, y, v) => { tiles[y * size + x] = v; };
  for (let y = HALL.y0; y <= HALL.y1; y++) for (let x = HALL.x0; x <= HALL.x1; x++) set(x, y, 1);
  for (const [px, py] of [[24, 14], [24, 33], [36, 23], [12, 10], [12, 38]]) { // 2x2 pillars
    for (let y = py; y < py + 2; y++) for (let x = px; x < px + 2; x++) set(x, y, 0);
  }
  for (let y = HALL.y0; y <= HALL.y1; y++) if (y < 21 || y > 26) set(48, y, 0); // the wall of the side room, a doorway
  return {
    size, tiles, seed: 1, tier: 0, spawn: SPAWN_AT, exit: SPAWN_AT, rooms: [], chests: [], monsters: [], bossAt: SPAWN_AT, bossRoom: 0,
  };
}

const centre = (tx, ty) => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });

// What can be summoned: every monster, then every boss ("boss:<id>").
export const arenaRoster = (state) => [
  ...state.enemyDefs.map((d) => d.id),
  ...(state.bossDefs ?? []).map((b) => 'boss:' + b.id),
];

export const newMeter = () => ({ dealt: 0, taken: 0, kills: 0, t: 0 });

// Puts the player into the arena (in place of the open world, the way a dungeon does). The world map stays loaded
// underneath but is never seen: there is no door out, the way back is the pause menu.
export function enterArena(state) {
  const dungeon = new Dungeon(arenaLayout(), 'crypt', state.world.biomes);
  const spawn = centre(SPAWN_AT.tx, SPAWN_AT.ty);
  const p = state.player;
  state.overworld = { world: state.world, explored: state.explored, lastRevealTile: null, drops: state.drops, x: p.x, y: p.y };
  state.world = dungeon;
  state.explored = new Explored();
  state.visible = null;
  state.fog = false;
  state.drops = [];
  state.enemies = [];
  state.projectiles = [];
  state.enemyProjectiles = [];
  state.effects = [];
  state.note = null;
  state.area = { kind: 'arena', id: 'arena', theme: 'crypt', tier: 0, entrance: { id: 'arena', ...spawn, px: spawn.x, py: spawn.y }, spawn, exits: [] };
  state.arena = { sel: state.enemyDefs.findIndex((d) => d.id === 'wolf'), tier: 0, rarity: 'common', god: false, n: 0 };
  state.meter = newMeter();
  p.attrPoints = ARENA_ATTR_POINTS; // to try builds with (the sheet, key C)
  p.x = spawn.x;
  p.y = spawn.y;
  armArena(state);
  updateExploration(state, dungeon);
  return dungeon;
}

export const ARENA_ATTR_POINTS = 50;

// Every weapon in the hotbar, at the arena's rarity.
function armArena(state) {
  const p = state.player;
  const at = Math.max(0, state.weapons.indexOf(p.weapon));
  state.weapons = state.catalog.weapon.map((w) => buildItem('weapon', w, state.arena.rarity));
  state.offhands = state.weapons.map(() => null);
  p.weapon = state.weapons[at] ?? state.weapons[0];
  recalcStats(state);
  p.hp = p.maxHp;
}

// A free spot `dist` px from the player, somewhere around.
function spotNear(state, dist, rng) {
  const p = state.player;
  for (let i = 0; i < 40; i++) {
    const a = rng() * Math.PI * 2;
    const x = p.x + Math.cos(a) * dist;
    const y = p.y + Math.sin(a) * dist;
    if (state.world.isWalkable(x, y) && state.world.lineClear(p.x, p.y, x, y)) return { x, y };
  }
  return { x: p.x + dist, y: p.y };
}

function summon(state, count, rng) {
  const a = state.arena;
  const id = arenaRoster(state)[a.sel];
  const at = spotNear(state, 300, rng);
  for (let i = 0; i < count; i++) {
    const x = at.x + (i ? (rng() - 0.5) * 90 : 0);
    const y = at.y + (i ? (rng() - 0.5) * 90 : 0);
    const spot = state.world.isWalkable(x, y) ? { x, y } : at;
    let e;
    if (id.startsWith('boss:')) {
      const def = state.bossDefs.find((b) => b.id === id.slice(5));
      a.n += 1;
      e = makeBoss(def, { id: `arena:${a.n}`, name: null, px: spot.x, py: spot.y }, Math.max(a.tier, def.tier));
      e.noDespawn = true;
    } else {
      e = makeEnemy(state.enemyDefs.find((d) => d.id === id), spot.x, spot.y, a.tier);
    }
    e.mode = 'chase';
    state.enemies.push(e);
  }
}

const cycleIn = (list, v, d = 1) => list[(list.indexOf(v) + d + list.length) % list.length];

// The arena's buttons and keys: prev, next, one, pack, tier, rarity, god, heal, clear, meter.
export function arenaAction(state, id, rng = Math.random) {
  const a = state.arena;
  if (!a) return false;
  const n = arenaRoster(state).length;
  switch (id) {
    case 'prev': a.sel = (a.sel - 1 + n) % n; break;
    case 'next': a.sel = (a.sel + 1) % n; break;
    case 'one': summon(state, 1, rng); break;
    case 'pack': summon(state, arenaRoster(state)[a.sel].startsWith('boss:') ? 1 : PACK, rng); break;
    case 'tier': a.tier = (a.tier + 1) % (MAX_TIER + 1); break;
    case 'rarity': a.rarity = cycleIn(RARITIES.map((r) => r.id), a.rarity); armArena(state); break;
    case 'god': a.god = !a.god; break;
    case 'heal': state.player.hp = state.player.maxHp; state.player.mana = state.player.maxMana; break;
    case 'clear': state.enemies = []; state.enemyProjectiles = []; state.blasts = []; break;
    case 'meter': state.meter = newMeter(); break;
    default: return false;
  }
  return true;
}

export const ARENA_KEYS = { KeyZ: 'prev', KeyX: 'next', KeyF: 'one', KeyV: 'pack', KeyT: 'tier', KeyR: 'rarity', KeyG: 'god', KeyH: 'heal', KeyL: 'clear', KeyY: 'meter' };

// Every tick: the fight clock of the meter runs while something is after you.
export function updateArena(state, dt) {
  if (!state.arena) return;
  if (state.enemies.some((e) => e.hp > 0 && e.mode === 'chase')) state.meter.t += dt;
}
