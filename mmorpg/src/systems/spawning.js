import { TILE, BIOME_IDS } from '../world/world.js';
import { tierAtPx } from './difficulty.js';
import { lairsInRange } from './lairs.js';
import { makeEnemy } from '../sim/enemy.js';
import { pulseSpawn } from './pulse.js';

// Wanderers: a few monsters about, besides the camps. They come in from well outside the screen, one group at a time,
// and fewer while the area is calm (every wanderer you kill calms it; the calm wears off).
export const ENEMY_TARGET = 8;
export const ENEMY_CULL_DIST = 2200;
export const CALM_MAX = 6;
export const CALM_FADE = 15; // seconds for one point of calm to wear off
export const SPAWN_NEAR = 900; // px: wanderers appear no closer than this
export const SPAWN_FAR = 1400;
export const ENEMY_TOWN_MARGIN = 220; // monsters never spawn this close to a town...
// ...while its anchor stone is warm. The stone is a piece of the Ring: fold the Ring back and it goes cold, and the
// walls still stand but hold nothing back - monsters come right up to them (inside, you are still safe).
export const ENEMY_TOWN_MARGIN_COLD = 40;
export const townMargin = (state) => (state.ending === 'fold' ? ENEMY_TOWN_MARGIN_COLD : ENEMY_TOWN_MARGIN);
const LAIR_MARGIN = 420; // ...or to a boss lair

// Bosses, their minions and camp monsters are not part of the "wanderers around you" count.
const ordinary = (e) => !e.boss && !e.owner && !e.camp;

// Which monster fits here: its biome, and not tougher than the region allows. Monsters of the region's own tier are likelier.
export function pickEnemyDef(defs, biome, tier, rng = Math.random) {
  const options = defs.filter((d) => d.biomes.includes(biome) && (d.tier ?? 0) <= tier);
  if (options.length === 0) return null;
  const weights = options.map((d) => ((d.tier ?? 0) === tier ? 3 : 1));
  let roll = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < options.length; i++) {
    roll -= weights[i];
    if (roll < 0) return options[i];
  }
  return options[options.length - 1];
}

// The world is open, so monsters follow the player: new ones appear in a ring around, in packs where the monster comes in packs.
// `groups`: how many groups may come in at once (one, normally; more to fill a fresh world).
export function topUpEnemies(state, world, defs, minD = SPAWN_NEAR, maxD = SPAWN_FAR, rng = Math.random, groups = 1) {
  const p = state.player;
  let count = state.enemies.filter(ordinary).length;
  const target = Math.max(2, ENEMY_TARGET - Math.floor(state.calm ?? 0));
  let added = 0;
  for (let tries = 0; count < target && added < groups && tries < 300; tries++) {
    const a = rng() * Math.PI * 2;
    const d = minD + rng() * (maxD - minD);
    const x = p.x + Math.cos(a) * d;
    const y = p.y + Math.sin(a) * d;
    if (!world.isWalkable(x, y) || world.townAtPx(x, y, townMargin(state))) continue;
    if (lairsInRange(world, x, y, LAIR_MARGIN, state.bossDefs ?? []).length > 0) continue;
    // a Pulse may bring monsters of another land, tougher ones, or none at all
    const shaped = pulseSpawn(state, x, y, BIOME_IDS[world.tileAt(Math.floor(x / TILE), Math.floor(y / TILE))], tierAtPx(x, y, world));
    if (!shaped) continue;
    const { tier } = shaped;
    const def = pickEnemyDef(defs, shaped.biome, tier, rng);
    if (!def) continue;
    const size = def.pack ? def.pack.min + Math.floor(rng() * (def.pack.max - def.pack.min + 1)) : 1;
    for (let i = 0; i < size; i++) {
      const ox = i === 0 ? 0 : (rng() - 0.5) * 90;
      const oy = i === 0 ? 0 : (rng() - 0.5) * 90;
      if (i > 0 && (!world.isWalkable(x + ox, y + oy) || world.isTown(x + ox, y + oy))) continue;
      state.enemies.push(makeEnemy(def, x + ox, y + oy, tier));
      count++;
    }
    added++;
  }
}

// The calm of an area wears off with time.
export function fadeCalm(state, dt) {
  if (state.calm) state.calm = Math.max(0, state.calm - dt / CALM_FADE);
}

// Far-away monsters are removed (the ones chasing you stay).
export function cullFarEnemies(state) {
  const p = state.player;
  state.enemies = state.enemies.filter((e) => e.boss || e.owner || e.mode === 'chase' || Math.hypot(e.x - p.x, e.y - p.y) < ENEMY_CULL_DIST);
}
