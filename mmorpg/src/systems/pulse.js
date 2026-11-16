import { TILE, BIOME_IDS } from '../world/world.js';
import { tierAtPx, MAX_TIER } from './difficulty.js';
import { ensureHistory } from './history.js';

// The Pulse (docs/story.md): the collider still beats, and every so often a wave rewrites a piece of the open world
// around the player for a while. One change at a time, so the place stays readable:
//   strangers - the monsters that turn up belong to another land (ice wolves in the desert)
//   surge     - the monsters are a tier tougher, and worth it
//   calm      - the ordinary monsters there are gone, and no new ones come
//   cache     - a chest from another version of the world lies nearby
// Each Pulse is written into the chronicle: these are the only events not made from the seed, they happen to you.
export const PULSE_EFFECTS = ['strangers', 'surge', 'calm', 'cache'];
export const PULSE_GAP = [360, 600]; // seconds between Pulses
export const PULSE_TIME = 180; // seconds an effect lasts
export const PULSE_RADIUS = 45 * TILE;
export const PULSE_WAVE = 1.6; // seconds the wave takes to spread on screen
export const MAX_PULSES = 100; // kept in the chronicle
const LANDS = ['grass', 'forest', 'desert', 'snow', 'beach'];

// Left open, the Ring beats twice as often.
const gap = (rng, state) => (PULSE_GAP[0] + rng() * (PULSE_GAP[1] - PULSE_GAP[0])) * (state?.ending === 'open' ? 0.5 : 1);

export function ensurePulse(state, rng = Math.random) {
  state.pulse ??= { next: gap(rng, state), active: null, wave: 0 };
  return state.pulse;
}

// The effect at a point, if a Pulse is active there.
export function pulseAt(state, x, y) {
  const a = state.pulse?.active;
  return a && Math.hypot(x - a.x, y - a.y) <= a.r ? a : null;
}

// What a monster spawning at (x, y) becomes under the Pulse: another land, a higher tier, or nothing at all (calm).
export function pulseSpawn(state, x, y, biome, tier) {
  const a = pulseAt(state, x, y);
  if (!a) return { biome, tier };
  if (a.effect === 'calm') return null;
  if (a.effect === 'surge') return { biome, tier: Math.min(MAX_TIER, tier + 1) };
  if (a.effect === 'strangers' && LANDS.includes(biome)) return { biome: a.biome, tier };
  return { biome, tier };
}

export function updatePulse(state, world, dt, rng = Math.random) {
  const pulse = ensurePulse(state, rng);
  pulse.wave = Math.max(0, pulse.wave - dt);
  if (pulse.active) {
    pulse.active.left -= dt;
    if (pulse.active.left <= 0) pulse.active = null;
  }
  if (state.ending === 'fold') { // folded back: the Ring is still, and no Pulse will come again
    pulse.active = null;
    return null;
  }
  if (state.area || state.dead || world.isDungeon) return null; // it only reaches the open world
  pulse.next -= dt;
  if (pulse.next > 0) return null;
  return firePulse(state, world, rng);
}

// A Pulse passes over the player now. Returns what it did.
export function firePulse(state, world, rng = Math.random, effect = null) {
  const pulse = ensurePulse(state, rng);
  const p = state.player;
  pulse.next = gap(rng, state);
  pulse.wave = PULSE_WAVE;
  const here = BIOME_IDS[world.rawBiomeIdAt(Math.floor(p.x / TILE), Math.floor(p.y / TILE))];
  const kind = effect ?? PULSE_EFFECTS[Math.floor(rng() * PULSE_EFFECTS.length)];
  const others = LANDS.filter((b) => b !== here);
  const active = { effect: kind, x: p.x, y: p.y, r: PULSE_RADIUS, left: PULSE_TIME, biome: others[Math.floor(rng() * others.length)] };
  const h = ensureHistory(state);
  h.pulses ??= [];
  const n = (h.pulses.at(-1)?.n ?? 0) + 1;
  active.n = n;
  if (kind === 'calm') {
    state.enemies = state.enemies.filter((e) => e.boss || e.owner || Math.hypot(e.x - active.x, e.y - active.y) > active.r);
  }
  if (kind === 'cache') active.chest = cacheChest(state, world, active, rng);
  pulse.active = active;
  const near = world.townsInRange(p.x, p.y, 120 * TILE).sort((a, b) => Math.hypot(a.px - p.x, a.py - p.y) - Math.hypot(b.px - p.x, b.py - p.y))[0];
  h.pulses.push({ n, effect: kind, biome: active.biome, town: near?.nameIndex ?? null });
  if (h.pulses.length > MAX_PULSES) h.pulses.shift();
  state.banner = { key: 'pulse.passes', t: 0 };
  state.note = { key: `pulse.effect.${kind}`, args: { biome: active.biome }, title: 'pulse.title', t: 0 };
  return active;
}

// A chest from another version of the world, on open ground a little way off.
function cacheChest(state, world, active, rng) {
  for (let i = 0; i < 40; i++) {
    const a = rng() * Math.PI * 2;
    const d = (5 + rng() * 6) * TILE;
    const x = active.x + Math.cos(a) * d;
    const y = active.y + Math.sin(a) * d;
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    const free = world.openGround ? world.openGround(tx, ty) : world.isWalkable(x, y);
    if (free && !world.isTown(x, y)) {
      const tier = tierAtPx(x, y, world);
      const minRarity = state.ending === 'open' ? 'epic' : tier >= 2 ? 'rare' : 'uncommon'; // generous, but not at the start
      const relicPlace = { cold: BIOME_IDS[world.rawBiomeIdAt(tx, ty)] === 'snow', far: tierAtPx(x, y, world) >= 3 }; // which relics may be in it
      return { idx: 0, x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE, opened: false, tier: tierAtPx(x, y, world) + 1, run: `p:${active.n}`, minRarity, relicPlace };
    }
  }
  return null;
}
