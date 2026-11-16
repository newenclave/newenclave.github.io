import { hash2, mulberry32 } from '../core/rng.js';
import { TILE } from '../world/world.js';
import { personName } from '../world/names.js';
import { valleysInRange, valleyTileAt, VALE_CELL } from '../world/valleys.js';
import { lairsInRange, lairById, LAIR_CELL } from './lairs.js';
import { entrancesInRange, DUNGEON_CELL } from './dungeons.js';
import { buildItem } from '../sim/loot.js';
import { tierAtTile } from './difficulty.js';
import { deedTales } from './deeds.js';

// The history of the world (docs/story.md), Dwarf Fortress style but local: every town keeps its own chronicle, worked
// out from the seed with no look at the rest of the world, so the infinite world can have it everywhere. The Shift is
// year 0, now is NOW; Pulses rewrite what towns remember, so two towns may tell one event two ways, and both are true.
// Echoes of all this reach the present: elders' rumours, graves where heroes fell, and echoes of a possible future,
// such as the grave of the player near a boss lair, which goes away if the player wins that fight.
export const NOW = 300;
export const PULSE_FACTS = 12; // chron.pulse.0 .. 11: what a Pulse made a town remember
export const FACILITIES = 6; // chron.facility.0 .. 5: what a dungeon was before the Shift
// Artifacts: art.name.<form> with art.adj.<n> and art.noun.<slot>.<n> (see data/lang/)
export const ART_FORMS = 3;
export const ART_ADJS = 10;
export const ART_NOUNS = 8;
export const ARTIFACT_ID = /^a:(-?\d{1,5},-?\d{1,5})$/;
const ART_CHANCE = 0.6;
const ART_SLOTS = ['weapon', 'armor', 'accessory'];
export const EVENT_ID = /^(-?\d{1,5},-?\d{1,5})#(\d{1,2})$/; // an event of a town's chronicle: "3,-2#4"
export const ECHO_ID = /^f:l:(-?\d{1,5}),(-?\d{1,5})$/; // an echo of the future at a lair: "f:l:3,-2"
const FUTURE_CHANCE = 0.4;
const RAID_RANGE = 200 * TILE; // a lair this close to a town has raided it at some time
const MAX_PULSES = 3; // Pulses a town remembers
const NEAR_RANGE = 160 * TILE; // dungeons and valleys a town has stories about
const NEIGHBOURS = 2; // rumours about this many neighbouring towns
// Years a town of each size was founded in: the capital first, in the Century of Anchors; hamlets last.
const FOUNDED = { capital: [40, 60], city: [50, 110], town: [80, 160], village: [120, 220], hamlet: [180, 270] };

const cache = new WeakMap(); // world -> { bossDefs, dungeonDefs, own: Map(town id -> events), echoes: Map }

function store(world, defs) {
  let c = cache.get(world);
  if (!c || c.bossDefs !== defs.bossDefs || c.dungeonDefs !== defs.dungeonDefs) {
    cache.set(world, (c = { bossDefs: defs.bossDefs, dungeonDefs: defs.dungeonDefs, own: new Map(), echoes: new Map() }));
  }
  return c;
}

// Years of the great Pulses since the Shift, the same for the whole world.
export function pulseYears(seed) {
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const out = [];
  for (let y = 5 + Math.floor(rng() * 15); y < NOW; y += 18 + Math.floor(rng() * 30)) out.push(y);
  return out;
}

const townSeed = (world, town) => Math.floor(hash2(town.tx, town.ty, world.seed + 8800) * 2 ** 31);

// Open ground near (tx, ty) for a grave: a few tries around it, not in a town or a hidden valley.
function groundNear(world, tx, ty, rng) {
  for (let i = 0; i < 30; i++) {
    const a = rng() * Math.PI * 2;
    const d = i < 2 ? 0 : 1 + rng() * (2 + i * 0.4);
    const x = Math.round(tx + Math.cos(a) * d);
    const y = Math.round(ty + Math.sin(a) * d);
    const free = world.openGround ? world.openGround(x, y) : world.rawBiomeIdAt(x, y) > 0;
    if (free && !world.townAtPx((x + 0.5) * TILE, (y + 0.5) * TILE, TILE) && valleyTileAt(world, x, y) === 0) return { tx: x, ty: y };
  }
  return null;
}

// What a town itself remembers, in order of years. Each event: { id, year, key, args, site? } where args hold raw values
// (town name numbers, names, years) turned into text by the UI, and a site is a place in the world (a grave).
export function ownHistory(world, town, defs) {
  const c = store(world, defs);
  if (c.own.has(town.id)) return c.own.get(town.id);
  const rng = mulberry32(townSeed(world, town));
  const kind = town.kind ?? 'town';
  const [f0, f1] = FOUNDED[kind];
  const founded = f0 + Math.floor(rng() * (f1 - f0 + 1));
  const name = (salt) => personName(world.seed, town.tx, town.ty, salt);
  const events = [];
  const add = (year, key, args = {}, site = null) => events.push({ year, key, args: { town: town.nameIndex, year, ...args }, site });

  const founder = name(1);
  add(founded, 'chron.founded', { founder });
  if (town.walled && town.layout?.wall !== 'none') {
    add(founded + 4 + Math.floor(rng() * 30), town.layout?.wall === 'palisade' ? 'chron.wall.palisade' : 'chron.wall.stone', { founder });
  }
  // elders, one after another, up to the one you meet
  let year = founded;
  let elder = founder;
  for (let k = 2; year < NOW - 10; k++) {
    year += 18 + Math.floor(rng() * 35);
    if (year >= NOW) break;
    const next = name(k * 3);
    add(year, 'chron.elder', { elder: next, before: elder });
    elder = next;
  }
  town.elderName ??= elder;
  // what the Pulses changed
  const facts = Array.from({ length: PULSE_FACTS }, (_, i) => i); // each fact at most once per town
  for (let i = facts.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [facts[i], facts[j]] = [facts[j], facts[i]];
  }
  let pulses = 0;
  for (const py of pulseYears(world.seed)) {
    if (py > founded && pulses < MAX_PULSES && rng() < 0.45) add(py, 'chron.pulse', { fact: facts[pulses++] });
  }
  // a raid from the nearest lair, and the hero who fell holding it off; the grave lies on the way to the lair
  const lair = lairsInRange(world, town.px, town.py, RAID_RANGE, defs.bossDefs)
    .sort((a, b) => Math.hypot(a.px - town.px, a.py - town.py) - Math.hypot(b.px - town.px, b.py - town.py))[0];
  if (lair) {
    const ry = Math.max(founded + 3, NOW - 10 - Math.floor(rng() * (NOW - founded - 12)));
    const hero = name(77);
    const at = groundNear(world, Math.round(town.tx + (lair.tx - town.tx) * 0.55), Math.round(town.ty + (lair.ty - town.ty) * 0.55), rng);
    add(ry, 'chron.raid', { hero, boss: lair.name, species: lair.bossId, lair: lair.id }, at && { kind: 'grave', ...at });
  }
  // what lies near: a dungeon that was something else before the Shift, a valley nobody walks into
  const dungeon = entrancesInRange(world, town.px, town.py, NEAR_RANGE, defs.dungeonDefs)[0];
  if (dungeon) add(0, 'chron.dungeon', { theme: dungeon.theme, facility: Math.floor(rng() * FACILITIES) });
  const valley = valleysInRange(world, town.px, town.py, NEAR_RANGE)[0];
  if (valley) {
    const vy = founded + Math.floor(rng() * (NOW - founded));
    add(vy, 'chron.valley', { walker: name(91), back: vy + 1 + Math.floor(rng() * 60) });
  }
  events.sort((a, b) => a.year - b.year);
  events.forEach((e, i) => { e.id = `${town.id}#${i}`; });
  // a lost artifact: carried into the nearest dungeon, swallowed with its owner by the raiding boss, or left in a hidden
  // valley. Added after the others and numbered after them, so the ids of older events never change.
  const places = [];
  if (dungeon) places.push({ at: dungeon.id, key: 'chron.artifact.dungeon', args: { theme: dungeon.theme } });
  if (lair) places.push({ at: lair.id, key: 'chron.artifact.lair', args: { boss: lair.name, species: lair.bossId } });
  if (valley) places.push({ at: valley.id, key: 'chron.artifact.valley', args: {} });
  if (places.length && rng() < ART_CHANCE) {
    const place = places[Math.floor(rng() * places.length)];
    const slot = ART_SLOTS[Math.floor(rng() * ART_SLOTS.length)];
    const art = {
      id: `a:${town.id}`, at: place.at, slot, base: Math.floor(rng() * 100), owner: name(55), town: town.nameIndex,
      form: Math.floor(rng() * ART_FORMS), adj: Math.floor(rng() * ART_ADJS), noun: Math.floor(rng() * ART_NOUNS),
      year: founded + 1 + Math.floor(rng() * Math.max(1, NOW - founded - 2)),
    };
    events.push({ id: `${town.id}#${events.length}`, year: art.year, key: place.key, args: { town: town.nameIndex, year: art.year, owner: art.owner, art, ...place.args }, artifact: art });
    events.sort((a, b) => a.year - b.year);
  }
  c.own.set(town.id, events);
  return events;
}

// The neighbours' raids, as this town tells them: the other version (where the town there remembers a hero, here they
// remember a burnt granary). Rumours only: { id of the event, version: 'b' }.
export function rumoursAbout(world, town, defs) {
  const near = world.townsInRange(town.px, town.py, 2.2 * (world.townCell ?? 96) * TILE)
    .filter((o) => o.id !== town.id)
    .sort((a, b) => Math.hypot(a.px - town.px, a.py - town.py) - Math.hypot(b.px - town.px, b.py - town.py))
    .slice(0, NEIGHBOURS);
  const out = [];
  for (const o of near) {
    const raid = ownHistory(world, o, defs).find((e) => e.key === 'chron.raid');
    if (raid) out.push({ ...raid, key: 'chron.raid.other', version: 'b', site: null, args: { ...raid.args, teller: town.nameIndex } });
  }
  return out;
}

// ---- echoes of the future: at some lairs, the grave of the player as it will be if the boss wins
export function futureEcho(world, lair, defs) {
  if (!lair) return null;
  const c = store(world, defs);
  if (c.echoes.has(lair.id)) return c.echoes.get(lair.id);
  let echo = null;
  if (hash2(lair.cx, lair.cy, world.seed + 8900) < FUTURE_CHANCE) {
    const rng = mulberry32(Math.floor(hash2(lair.cx, lair.cy, world.seed + 8901) * 2 ** 31));
    const a = rng() * Math.PI * 2;
    const at = groundNear(world, Math.round(lair.tx + Math.cos(a) * 11), Math.round(lair.ty + Math.sin(a) * 11), rng);
    if (at) {
      echo = {
        id: `f:${lair.id}`, year: NOW + 1 + Math.floor(rng() * 12), key: 'chron.future',
        args: { boss: lair.name, species: lair.bossId, lair: lair.id, town: 0 }, site: { kind: 'future', ...at }, future: true,
      };
      echo.args.year = echo.year;
    }
  }
  c.echoes.set(lair.id, echo);
  return echo;
}

// ---- what the player knows

export function ensureHistory(state) {
  state.history ??= { learned: new Set(), averted: new Set() };
  return state.history;
}

export const learn = (state, id) => {
  const h = ensureHistory(state);
  if (h.learned.has(id)) return false;
  h.learned.add(id);
  return true;
};

const defsOf = (state) => ({ bossDefs: state.bossDefs ?? [], dungeonDefs: state.dungeonDefs });

// An event from its id, wherever it is in the world (for the chronicle, which keeps only ids).
export function eventById(state, world, id) {
  const defs = defsOf(state);
  const echo = ECHO_ID.exec(id);
  if (echo) return futureEcho(world, lairById(world, id.slice(2), defs.bossDefs), defs);
  const m = EVENT_ID.exec(id);
  const town = m && world.getTownById(m[1]);
  return town ? ownHistory(world, town, defs).find((e) => e.id === id) ?? null : null;
}

// What the elder of a town may tell, in turn: the town's own past (the Shift's tale, the Pulses, the raid...), the
// other version of a neighbour's raid, and a prophecy when a lair nearby casts an echo of the future. The elder also
// tells your own deeds here, first, once word of them has got around (systems/deeds.js): news before history.
export function tellable(state, world, town, role = 'elder') {
  const defs = defsOf(state);
  const own = ownHistory(world, town, defs).filter((e) => e.key !== 'chron.elder');
  const deeds = role === 'elder' ? deedTales(state, town.id, town.nameIndex) : [];
  const out = [...deeds, ...own, ...rumoursAbout(world, town, defs)];
  const raid = own.find((e) => e.key === 'chron.raid');
  const echo = raid && futureEcho(world, lairById(world, raid.args.lair, defs.bossDefs), defs);
  if (echo && !ensureHistory(state).averted.has(echo.args.lair) && state.ending !== 'fold') out.push({ ...echo, key: 'chron.prophecy' });
  return out;
}

// The story this teller (the elder, the priest, the innkeeper) has ready for you, in turn; every so often just what the
// town believes (null). Each keeps their own place in the list, and moves on only when you have heard them out.
const tellerKey = (town, role) => (role === 'elder' ? town.id : `${town.id}:${role}`); // the elder's key as saves had it
export function nextRumour(state, world, town, role = 'elder') {
  const list = tellable(state, world, town, role);
  const n = ensureHistory(state).told?.get(tellerKey(town, role)) ?? 0;
  const i = n % (list.length + 1);
  return i === list.length ? null : list[i];
}

// You asked about the place and heard the story: the chronicle keeps it, and next time this teller tells another.
export function hearRumour(state, town, role, r) {
  const h = ensureHistory(state);
  h.told ??= new Map();
  h.told.set(tellerKey(town, role), (h.told.get(tellerKey(town, role)) ?? 0) + 1);
  if (r) learn(state, r.version ? `${r.id}~b` : r.id);
}

// Graves and other marks of the past (and of a possible future) near a point.
export function memorialsInRange(state, world, px, py, range) {
  if (world.isDungeon) return [];
  const defs = defsOf(state);
  const out = [];
  for (const town of world.townsInRange(px, py, range + RAID_RANGE)) {
    for (const e of ownHistory(world, town, defs)) {
      if (e.site && Math.hypot((e.site.tx + 0.5) * TILE - px, (e.site.ty + 0.5) * TILE - py) <= range) out.push(e);
    }
  }
  const averted = ensureHistory(state).averted;
  if (state.ending === 'fold') return out; // with the fold closed there are no futures left to echo
  for (const lair of lairsInRange(world, px, py, range + 20 * TILE, defs.bossDefs)) {
    const echo = futureEcho(world, lair, defs);
    if (echo && !averted.has(lair.id) && Math.hypot((echo.site.tx + 0.5) * TILE - px, (echo.site.ty + 0.5) * TILE - py) <= range) out.push(echo);
  }
  return out;
}

// ---- artifacts

// The artifacts lost at a place (a dungeon "d:", a lair "l:", a valley "v:") that you have not found yet. The towns that
// remember them are near the place, so only those chronicles are read.
export function artifactsAt(state, world, placeId) {
  if (world.isDungeon) world = state.overworld?.world ?? world;
  const defs = defsOf(state);
  const h = ensureHistory(state);
  h.found ??= new Set();
  const out = [];
  const seen = new Set();
  const [cx, cy] = placeId.slice(2).split(',').map(Number);
  // the endless world: every kind of place sits in cells of its own size; the finite map knows the place itself
  const cell = world.isMap ? 0 : { d: DUNGEON_CELL, l: LAIR_CELL, v: VALE_CELL }[placeId[0]];
  const place = world.isMap ? world.placeById(placeId) : null;
  if (world.isMap && !place) return [];
  const px = place ? place.tx * TILE : (cx + 0.5) * cell * TILE;
  const py = place ? place.ty * TILE : (cy + 0.5) * cell * TILE;
  for (const town of world.townsInRange(px, py, cell * TILE + Math.max(RAID_RANGE, NEAR_RANGE))) {
    for (const e of ownHistory(world, town, defs)) {
      if (e.artifact?.at === placeId && !h.found.has(e.artifact.id) && !seen.has(e.artifact.id)) {
        seen.add(e.artifact.id);
        out.push(e);
      }
    }
  }
  return out;
}

// The item of an artifact: its base from the catalog, with its story attached. How rare it is follows the danger of
// the place it was found (rare near the start, legendary far out).
export const ART_RARITY = ['rare', 'rare', 'epic', 'legendary', 'legendary'];
export function artifactItem(catalog, art, tier = 4) {
  const list = catalog[art.slot] ?? [];
  if (!list.length) return null;
  return { ...buildItem(art.slot, list[art.base % list.length], ART_RARITY[Math.max(0, Math.min(4, tier))]), art };
}

// An artifact lost at this place comes out now (a boss falls, a chest opens): dropped at (x, y), marked found, its story
// learned. One at a time: when the chronicles lost several in one place, come back for the next. Returns [] or [art].
export function takeArtifacts(state, world, placeId, x, y, makeDrop) {
  const found = [];
  const tier = state.area?.tier ?? tierAtTile(Math.floor(x / TILE), Math.floor(y / TILE), world);
  for (const e of artifactsAt(state, world, placeId).slice(0, 1)) {
    const item = artifactItem(state.catalog, e.artifact, tier);
    if (!item) continue;
    ensureHistory(state).found.add(e.artifact.id);
    learn(state, e.id);
    state.drops.push(makeDrop(x + 30 * found.length, y - 40, item, 0.8));
    found.push(e.artifact);
  }
  if (found.length) state.note = { key: 'art.found', art: found[0], title: 'art.found.title', t: 0, dur: 12 };
  return found;
}

// A boss killed: if its lair cast an echo of the future, that future is undone. Returns the echo, or null.
export function avertFuture(state, world, lairId) {
  const defs = defsOf(state);
  const echo = futureEcho(world, lairById(world, lairId, defs.bossDefs), defs);
  const h = ensureHistory(state);
  if (!echo || h.averted.has(lairId)) return null;
  h.averted.add(lairId);
  learn(state, echo.id);
  return echo;
}
