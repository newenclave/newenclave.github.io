// Side stories off the main road (docs/side-stories-knots.md, data/sidestories.json): quests that send you to find
// someone or something somewhere in a circle of the map (`find`), to gather what grows in a place (`gather`), to carry a
// thing to a person (`deliver`); people with names (a merchant and smiths in towns, a herb-woman out in the wood); quest
// items you carry; quests that close others for good (`excludes`); a ward that keeps wolves off a farm.
//
// Places in a quest are written as symbols and found in the world when a game starts: "@start", "@road", "@city"
// (towns the map names, world.story), "@farm", "@glade" (spots of the map, world.spots), "#brannoc" (where a person
// stands). A quest whose places this world does not have (the endless world) is left out.
import { TILE } from '../world/world.js';
import { hash2 } from '../core/rng.js';
import { parseRequirement } from './deeds.js';

export const FIND_REACH = 52; // px: how close you come to what you are looking for to find it
export const GATHER_REACH = 30;
export const PERSON_REACH = 70; // px: to talk to someone out in the wild (as NPC_REACH in towns)
export const SPOT_PREFIX = 'p:'; // a spot as a giver: "p:farm"
const LEAVE_SIGHT = 26; // tiles: someone out in the wild moves to their next place only when you are this far away

const spotGiver = (name) => SPOT_PREFIX + name;
const strHash = (s) => {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619);
  return (x >>> 0) % 100000;
};

// "@x" -> a town id or a spot giver id; anything else stays as it is. null: this world has no such place.
function resolvePlace(world, ref) {
  if (typeof ref !== 'string' || ref[0] !== '@') return ref;
  const name = ref.slice(1);
  if (world.spots?.[name]) return spotGiver(name);
  return world.story?.[name] ?? null;
}

// The side quests of this world, with their places found; the people, with where they live. Call once per game.
export function setupSideStories(state, world, data) {
  const people = new Map();
  for (const [id, p] of Object.entries(data?.people ?? {})) {
    const home = resolvePlace(world, '@' + p.at);
    if (!home) continue;
    const town = world.getTownById?.(home) ?? null;
    if (town) { // a named townsperson: the one in that job there
      const npc = town.npcs.find((n) => n.id === p.role && !n.person);
      if (!npc) continue;
      npc.person = id;
      people.set(id, { id, def: p, home, town, npc });
    } else {
      people.set(id, { id, person: id, def: p, home, town: null, npc: null, x: 0, y: 0 });
    }
  }
  state.people = people;
  state.wards = (data?.wards ?? []).filter((w) => world.spots?.[w.spot]);
  state.raids = (data?.raids ?? []).filter((r) => world.spots?.[r.spot]).map((r) => ({ ...r }));
  const defs = [];
  for (const q of data?.quests ?? []) {
    const def = { ...q, side: true };
    def.giver = resolvePlace(world, q.giver);
    if (q.turnInAt) def.turnInAt = resolvePlace(world, q.turnInAt);
    if (q.toldIn) def.toldIn = q.toldIn.map((r) => resolvePlace(world, r)).filter(Boolean);
    if (!def.giver || (q.turnInAt && !def.turnInAt)) continue;
    if (q.at && q.at[0] === '@' && !world.spots?.[q.at.slice(1)] && !resolvePlace(world, q.at)) continue;
    if (q.at && q.at[0] === '#' && !people.has(q.at.slice(1))) continue;
    defs.push(def);
  }
  // a quest given or taken back by someone this world does not have is left out too
  const known = (role, giver) => !people.has(role) || people.get(role).home === giver;
  return defs.filter((d) => known(d.npc, d.giver) && (!d.turnInNpc || known(d.turnInNpc, d.turnInAt)));
}

// ---- conditions: "q" (done), "q:choice" (done with that answer), "found:q" (its goal reached), "active:q", "!..."
export function cond(state, c) {
  if (!c) return true;
  if (Array.isArray(c)) return c.every((x) => cond(state, x));
  if (c[0] === '!') return !cond(state, c.slice(1));
  if (c.includes('|')) return c.split('|').some((x) => cond(state, x));
  const quests = state.player.quests;
  if (c.startsWith('item:')) return hasItem(state, c.slice(5));
  if (c.startsWith('heard:')) return !!state.player.heard?.includes(c.slice(6));
  if (c.startsWith('found:')) {
    const id = c.slice(6);
    const e = quests[id];
    return !!e && (e.status === 'done' || (e.status === 'active' && e.progress >= (state.questIndex.get(id)?.count ?? 1)));
  }
  if (c.startsWith('active:')) return quests[c.slice(7)]?.status === 'active';
  if (c.startsWith('closed:')) return quests[c.slice(7)]?.status === 'closed';
  const { id, choice } = parseRequirement(c);
  const e = quests[id];
  return e?.status === 'done' && (!choice || e.choice === choice);
}

// ---- people
// Where someone out in the wild is now: the first of their `where` whose condition holds, else at home.
function wildSpot(state, person) {
  for (const w of person.def.where ?? []) if (cond(state, w.when)) return w.spot;
  return person.def.at;
}

export function placePeople(state, world) {
  for (const person of state.people?.values() ?? []) {
    if (person.town) continue;
    const name = wildSpot(state, person);
    const s = world.spots?.[name];
    if (!s) continue;
    // they walk over while you are not looking: not before your eyes
    const p = state.player;
    if (person.spot && person.spot !== name && Math.hypot(p.x - person.x, p.y - person.y) < LEAVE_SIGHT * TILE) continue;
    const [dx, dy] = person.def.offset?.[name] ?? [0, 0];
    person.spot = name;
    person.x = s.px + dx * TILE;
    person.y = s.py + dy * TILE;
  }
}

// People out in the wild (not in towns), as the renderer and the talk button see them.
export const wildPeople = (state) => [...(state.people?.values() ?? [])].filter((p) => !p.town && p.spot);

export function personPos(state, id) {
  const p = state.people?.get(id);
  if (!p) return null;
  return p.npc ? { x: p.npc.x, y: p.npc.y } : p.spot ? { x: p.x, y: p.y } : null;
}

// ---- where to look
function spotOrPerson(state, ref) {
  if (!ref) return null;
  if (ref[0] === '#') {
    const pos = personPos(state, ref.slice(1));
    return pos && { px: pos.x, py: pos.y, r: 3 };
  }
  return state.world.spots?.[ref.slice(1)] ?? null;
}

// The very point a `find` quest is after: a person (`person`), or a thing lying somewhere in its place.
export function findPoint(state, def) {
  if (def.person) return personPos(state, def.person);
  const s = spotOrPerson(state, def.at);
  if (!s) return null;
  if (def.at[0] === '#') return { x: s.px + (def.dx ?? 0) * TILE, y: s.py + (def.dy ?? -1) * TILE }; // in their workshop
  if (def.dx !== undefined || def.dy !== undefined) return { x: s.px + (def.dx ?? 0) * TILE, y: s.py + (def.dy ?? 0) * TILE }; // a set place
  const seed = state.world.seed;
  const h = strHash(def.id);
  const a = hash2(h, 1, seed + 9100) * Math.PI * 2;
  const r = (0.25 + 0.5 * hash2(h, 2, seed + 9100)) * s.r * TILE;
  return { x: s.px + Math.cos(a) * r, y: s.py + Math.sin(a) * r };
}

// The circle the arrow and the map show: around the place, not on the point itself (the looking is yours).
export function searchArea(state, def) {
  if (def.kind === 'gather') {
    const s = spotOrPerson(state, def.at);
    return s && { x: s.px, y: s.py, r: (s.r + 2) * TILE };
  }
  const p = findPoint(state, def);
  if (!p) return null;
  const r = (def.radius ?? 14) * TILE;
  if (def.person && def.radius === 0) return { x: p.x, y: p.y, r: 0 };
  const seed = state.world.seed;
  const h = strHash(def.id);
  const a = hash2(h, 3, seed + 9100) * Math.PI * 2;
  const off = 0.45 * r * hash2(h, 4, seed + 9100);
  return { x: p.x + Math.cos(a) * off, y: p.y + Math.sin(a) * off, r };
}

// The plants (or whatever it is) of a `gather` quest: a few more than you need, scattered over its place.
export function gatherPoints(state, def) {
  const s = spotOrPerson(state, def.at);
  if (!s) return [];
  const n = def.count + (def.spare ?? 3);
  const out = [];
  const seed = state.world.seed;
  const h = strHash(def.id);
  for (let i = 0; i < n; i++) {
    const a = hash2(h + i, 5, seed + 9200) * Math.PI * 2;
    const r = (0.2 + 0.75 * hash2(h + i, 6, seed + 9200)) * s.r * TILE;
    out.push({ i, x: s.px + Math.cos(a) * r, y: s.py + Math.sin(a) * r });
  }
  return out;
}

// ---- items you carry for quests (a book, a letter, a hammer): id -> count, kept in the save
export const hasItem = (state, id) => (state.player.items?.[id] ?? 0) > 0;
export function giveItem(state, id) {
  const items = (state.player.items ??= {});
  items[id] = (items[id] ?? 0) + 1;
}
export function takeItem(state, id) {
  const items = state.player.items ?? {};
  if (!items[id]) return false;
  if (--items[id] <= 0) delete items[id];
  return true;
}
const asList = (x) => (Array.isArray(x) ? x : x ? [x] : []);

// ---- the quest system calls these
// Taken: a letter is in your hands at once; a thing you look for that you already carry is found.
export function onSideAccept(state, def, entry) {
  if (def.kind === 'deliver') {
    for (const id of asList(def.gives)) giveItem(state, id);
    entry.progress = def.count;
  } else if (def.kind === 'find' && def.gives && asList(def.gives).every((id) => hasItem(state, id))) {
    entry.progress = def.count;
  }
  if (def.excludeOn === 'accept') closeAll(state, def.excludes, def.id);
}

// Given up: a thing you found for it goes back where it was (nobody else is after it any more), a letter too.
export function onSideAbandon(state, def) {
  for (const it of [...asList(def.gives), ...asList(def.takes)]) {
    if (!hasItem(state, it)) continue;
    const wanted = Object.entries(state.player.quests).some(([id, e]) => {
      const d = e.status === 'active' && id !== def.id && state.questIndex.get(id);
      return d && (asList(d.gives).includes(it) || asList(d.takes).includes(it));
    });
    if (!wanted) delete state.player.items[it];
  }
}

// Can it be handed in? A thing you were to bring must still be with you (you may have given it to someone else).
export const canHandIn = (state, def) => asList(def.takes).every((id) => hasItem(state, id));

export function onSideTurnIn(state, def, choice) {
  for (const id of asList(def.takes)) takeItem(state, id);
  const c = choice && def.choices?.[choice];
  for (const id of asList(c?.gives)) giveItem(state, id);
  for (const id of asList(c?.takes)) takeItem(state, id);
  if (def.excludeOn !== 'accept') closeAll(state, def.excludes, def.id);
  closeAll(state, c?.excludes, def.id);
}

// Closed for good: never offered again; if you had taken it, it leaves your journal. The giver says so, once.
export function closeQuest(state, id, by) {
  const e = state.player.quests[id];
  if (e?.status === 'done' || e?.status === 'closed') return false;
  state.player.quests[id] = { status: 'closed', progress: 0, by, at: state.clock ?? 0, told: false, was: e?.status === 'active' };
  if (state.player.tracked === id) state.player.tracked = null;
  (state.closedNow ??= []).push(id);
  return true;
}
function closeAll(state, ids, by) {
  for (const id of asList(ids)) closeQuest(state, id, by);
}

// ---- each frame: reaching what you look for, picking what you gather. Returns the ids that just became ready.
export function updateSideQuests(state) {
  const ready = [];
  const found = [];
  const p = state.player;
  if (state.area || state.dead) return { ready, found };
  for (const [id, e] of Object.entries(p.quests)) {
    if (e.status !== 'active') continue;
    const def = state.questIndex.get(id);
    if (!def?.side || e.progress >= def.count) continue;
    if (def.kind === 'find') {
      if (def.gives && asList(def.gives).every((it) => hasItem(state, it))) { // already in your bag (found for someone else)
        e.progress = def.count;
        ready.push(id);
        continue;
      }
      const pt = findPoint(state, def);
      if (pt && Math.hypot(pt.x - p.x, pt.y - p.y) <= (def.person ? PERSON_REACH : FIND_REACH)) {
        e.progress = def.count;
        for (const it of asList(def.gives)) if (!hasItem(state, it)) giveItem(state, it);
        ready.push(id);
        found.push({ id, x: pt.x, y: pt.y });
      }
    } else if (def.kind === 'gather') {
      e.picked ??= [];
      for (const g of gatherPoints(state, def)) {
        if (e.picked.includes(g.i) || Math.hypot(g.x - p.x, g.y - p.y) > GATHER_REACH) continue;
        e.picked.push(g.i);
        e.progress = Math.min(def.count, e.progress + 1);
        found.push({ id, x: g.x, y: g.y, gather: true });
        if (e.progress >= def.count) { ready.push(id); break; }
      }
    }
  }
  return { ready, found };
}

// ---- raids: while their condition holds, a few of a monster come to a spot when you are near (the wolves find the
// step). The ones that come stay about the place; more come only when they are gone.
export function raidsDue(state) {
  const p = state.player;
  const out = [];
  for (const r of state.raids ?? []) {
    const s = state.world.spots?.[r.spot];
    if (!s || !cond(state, r.while)) continue;
    const d = Math.hypot(p.x - s.px, p.y - s.py);
    if (d > (r.near ?? 30) * TILE || d < 8 * TILE) continue; // they come while you approach, not out of thin air at your feet
    if (state.enemies.some((e) => e.raid === r.spot && e.hp > 0)) continue;
    if ((state.clock ?? 0) - (r.last ?? -1e9) < (r.every ?? 90)) continue;
    r.last = state.clock ?? 0;
    out.push({ raid: r, spot: s });
  }
  return out;
}

// ---- wards: while their condition holds, the listed monsters do not come within r tiles of a spot
export function warded(state, x, y, enemyId) {
  for (const w of state.wards ?? []) {
    if (w.enemies && !w.enemies.includes(enemyId)) continue;
    if (!cond(state, w.while)) continue;
    const s = state.world.spots?.[w.spot];
    if (s && Math.hypot(x - s.px, y - s.py) < w.r * TILE) return s;
  }
  return null;
}

// Closed quests a person has not yet told you about (their `closed` lines are said once).
export function untoldClosed(state, giverId, role) {
  const out = [];
  for (const [id, e] of Object.entries(state.player.quests)) {
    if (e.status !== 'closed' || e.told) continue;
    const def = state.questIndex.get(id);
    if (def && def.giver === giverId && (def.npc ?? 'elder') === role) out.push({ id, def, entry: e });
  }
  return out;
}

export const isSpotGiver = (id) => typeof id === 'string' && id.startsWith(SPOT_PREFIX);
export const spotOfGiver = (state, id) => (isSpotGiver(id) ? state.world.spots?.[id.slice(SPOT_PREFIX.length)] ?? null : null);
