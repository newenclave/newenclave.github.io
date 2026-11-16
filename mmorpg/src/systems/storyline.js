import { TILE } from '../world/world.js';
import { personName } from '../world/names.js';
import { entrancesInRange, entranceById } from './dungeons.js';
import { tierAtTile } from './difficulty.js';
import { ringSite, ringDirection, RING_ID } from './ring.js';
import { roleIn } from './quests.js';

// The main story, act 2 (docs/story.md): the elder of the first town sends you to a chronicler in the nearest city;
// the chronicler wants the three calibration plates of the old world, kept by the bosses of a crypt, a frozen cave and
// a sand tomb; with the plates you go to the capital, where the truth about the Ring is read out. Built for each world
// from where things are in it, with the quest kinds that exist (travel to a town, beat a dungeon boss).
export const STORY_ID = /^m:([1-9])$/;
export const ACT1_END = 'q_packleader';
const SEARCH = [200, 400, 800, 1500, 3000]; // tiles: look for a place this far, then farther
const PLATE_THEMES = ['crypt', 'ice', 'tomb'];

const dist = (a, b) => Math.hypot(a.px - b.px, a.py - b.py);

// The nearest town (from `from`) that passes `ok`, looking farther and farther out.
function nearestTown(world, from, ok) {
  for (const r of SEARCH) {
    const found = world.townsInRange(from.px, from.py, r * TILE)
      .filter((t) => t.id !== from.id && ok(t))
      .sort((a, b) => dist(a, from) - dist(b, from))[0];
    if (found) return found;
  }
  return null;
}

function nearestDungeon(world, from, theme, dungeonDefs) {
  for (const r of SEARCH) {
    const found = entrancesInRange(world, from.px, from.py, r * TILE, dungeonDefs)
      .filter((e) => e.theme === theme)
      .sort((a, b) => dist(a, from) - dist(b, from))[0];
    if (found) return found;
  }
  return null;
}

const big = (t) => t.kind === 'city' || t.kind === 'capital';

// The quests of act 2 for this world: [] if the world lacks what the story needs (it never should).
export function storyQuests(world, dungeonDefs) {
  const start = world.getTown(0, 0);
  if (!start) return [];
  // older worlds have round towns of one size: any other town will do
  // the finite map names the chronicler's city and the capital; the endless world takes the nearest
  const city = world.isMap ? world.getTownById(world.story.city) : nearestTown(world, start, (t) => !t.walled || big(t));
  if (!city) return [];
  const capital = (world.isMap ? world.getTownById(world.story.capital)
    : nearestTown(world, city, (t) => (t.walled ? t.kind === 'capital' : dist(t, city) > 2 * world.townCell * TILE))) ?? city;
  const chronicler = personName(world.seed, city.tx, city.ty, 500);
  const ruler = personName(world.seed, capital.tx, capital.ty, 600);
  const words = { chronicler, ruler };
  // town: where the quest leads (a visit) or where it is given; city and capital for the words around it
  const args = (town, extra = {}) => ({ town: town.nameIndex, city: city.nameIndex, capital: capital.nameIndex, words, ...extra });
  const keys = (k) => ({ titleKey: `story.${k}.title`, textKey: `story.${k}.text`, doneKey: `story.${k}.done`, chronKey: `story.${k}.chron` });
  const out = [{
    id: 'm:1', giver: start.id, npc: 'elder', turnInAt: city.id, turnInNpc: roleIn(city, 'chronicler'), kind: 'visit', target: city.id, count: 1,
    requires: ACT1_END, story: true,
    ...keys('m1'), args: args(city), reward: { gold: 150, xp: 400 },
  }];
  const plates = [];
  for (const theme of PLATE_THEMES) {
    const e = dungeonDefs && (world.isMap ? entranceById(world, world.story.plates[theme] ?? '', dungeonDefs) : nearestDungeon(world, city, theme, dungeonDefs));
    if (!e) continue;
    const n = 2 + plates.length;
    const tier = Math.max(e.tier, tierAtTile(city.tx, city.ty, world));
    plates.push(`m:${n}`);
    out.push({
      id: `m:${n}`, giver: city.id, npc: roleIn(city, 'chronicler'), kind: 'kill', target: e.bossId, count: 1, lair: e.id, requires: 'm:1', story: true,
      ...keys(`plate.${theme}`), args: args(city, { dungeon: theme }), reward: { gold: 250 + 120 * tier, xp: 500 * (1 + tier) },
    });
  }
  if (!plates.length) return out;
  out.push({
    id: 'm:5', giver: city.id, npc: roleIn(city, 'chronicler'), turnInAt: capital.id, turnInNpc: roleIn(capital, 'ruler'), kind: 'visit', target: capital.id,
    count: 1, requires: plates, story: true,
    ...keys('m5'), args: args(capital), reward: { gold: 600, xp: 2500, item: { slot: 'accessory', id: 'ring_precision', rarity: 'epic' } },
    doneKeyEnded: 'story.m5.done.ended', // the plates read after you have already been down to the Ring
  });
  // act 3: down to the Ring, past its keeper, to the console; the ruler hears what you chose
  const ring = ringSite(world);
  if (!ring) return out;
  const far = Math.round(Math.hypot(ring.tx - capital.tx, ring.ty - capital.ty) / 100) * 100;
  out.push({
    id: 'm:6', giver: capital.id, npc: roleIn(capital, 'ruler'), kind: 'ending', count: 1, lair: RING_ID, requires: 'm:5', story: true, ...keys('m6'),
    args: args(capital, { dirKey: ringDirection(world, capital), words: { ...words, far } }),
    doneKey: null, doneKeys: { fold: 'story.m6.done.fold', open: 'story.m6.done.open' }, // the ruler answers your choice
    reward: { gold: 2000, xp: 8000 },
  });
  return out;
}
