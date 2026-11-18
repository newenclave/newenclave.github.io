import { grantXp } from './xp.js';
import { buildItem, makeDrop } from '../sim/loot.js';
import { lairById } from './lairs.js';
import { addToBackpack } from './backpack.js';
import { entranceById } from './dungeons.js';
import { ensureHistory } from './history.js';
import { ringSite } from './ring.js';
import { TILE } from '../world/world.js';
import { answersOf, outcomeOf, rewardOf, parseRequirement } from './deeds.js';
import { passesCheck } from './attributes.js';
import { onSideAccept, onSideTurnIn, onSideAbandon, canHandIn, searchArea, personPos, takeItem, spotOfGiver } from './sidequests.js';

export const MAX_ACTIVE = 5;
// A boss or dungeon you have a quest for does not keep you waiting: it comes back after this many seconds at most.
export const QUEST_RECALL = 60;
const STORY_NOTE_TIME = 18; // seconds: what the main story tells you is longer than a note in a chest

export const questDef = (state, id) => state.questIndex.get(id);
export const isActive = (state, id) => state.player.quests[id]?.status === 'active';
export const questEntry = (state, id) => state.player.quests[id] ?? null;
// Where a quest is handed in: the town that gave it, unless it says otherwise (courier quests).
export const turnInTown = (def) => def.turnInAt ?? def.giver;

// Who gives a quest (`npc`, the elder unless it says otherwise) and who takes it back: the same person, or for a quest
// that ends in another town, whoever it names there (`turnInNpc`, the elder unless it says otherwise).
export const giverRole = (def) => def.npc ?? 'elder';
export const turnInRole = (def) => (turnInTown(def) === def.giver ? giverRole(def) : def.turnInNpc ?? 'elder');

// The role in this town, or the elder when nobody does that job there (a hamlet has no captain).
export const roleIn = (town, role) => (town?.npcs?.some((n) => n.id === role || n.person === role) ? role : 'elder');
const npcFor = (town, role) => town?.npcs?.find((n) => n.person === role) ?? town?.npcs?.find((n) => n.id === role && !n.person);

export const QUEST_ROLES = ['elder', 'priest', 'captain', 'innkeeper', 'chronicler', 'ruler']; // people who give quests

// `requires`: a quest id, or a list of them (all must be done). "quest:choice" asks for that quest done with that answer
// (a quest with consequences, systems/deeds.js), so a story can go one way or the other.
export function isUnlocked(state, def) {
  const need = Array.isArray(def.requires) ? def.requires : def.requires ? [def.requires] : [];
  return need.every((req) => {
    const { id, choice } = parseRequirement(req);
    const e = questEntry(state, id);
    return e?.status === 'done' && (!choice || e.choice === choice);
  });
}

export function isComplete(state, id) {
  const e = questEntry(state, id);
  if (!e || e.status !== 'active') return false;
  const def = questDef(state, id);
  return e.progress >= def.count && (!def.takes || canHandIn(state, def)); // a thing to bring must still be with you
}

// What a person in a town shows: quests they give here (new ones, active ones) and quests that end with them. Without a
// role: everything of the town. A finished quest is only 'complete' (hand-in possible) where it is handed in.
export function listForGiver(state, townId, role = null) {
  const out = [];
  for (const def of state.questDefs) {
    const e = questEntry(state, def.id);
    if (e?.status === 'done' || e?.status === 'closed') continue;
    const givenHere = def.giver === townId && isUnlocked(state, def) && (!role || giverRole(def) === role);
    const endsHere = turnInTown(def) === townId && e?.status === 'active' && (!role || turnInRole(def) === role);
    if (!givenHere && !endsHere) continue;
    let status = 'available';
    if (e) status = isComplete(state, def.id) && turnInTown(def) === townId ? 'complete' : 'active';
    out.push({ def, status, progress: e?.progress ?? 0 });
  }
  return out;
}

export function activeCount(state) {
  return Object.values(state.player.quests).filter((e) => e.status === 'active').length;
}

// ---- journal: the player's active quests and which one is "current" (tracked)
export function activeQuests(state) {
  const out = [];
  for (const [id, entry] of Object.entries(state.player.quests)) {
    const def = questDef(state, id);
    if (def && entry.status === 'active') out.push({ def, entry });
  }
  return out;
}

export const completedCount = (state) => Object.values(state.player.quests).filter((e) => e.status === 'done').length;

// Keeps `tracked` pointing at an active quest: falls back to the oldest active one, or none.
export function ensureTracked(state) {
  const p = state.player;
  if (p.tracked && isActive(state, p.tracked)) return;
  p.tracked = activeQuests(state)[0]?.def.id ?? null;
}

export function setTracked(state, id) {
  state.player.tracked = id && isActive(state, id) ? id : null;
}

export function abandonQuest(state, id) {
  if (!isActive(state, id)) return { error: 'none' };
  const def = questDef(state, id);
  if (def?.kind === 'deliver') for (const it of [def.gives].flat().filter(Boolean)) takeItem(state, it); // the letter goes back
  delete state.player.quests[id]; // it can be taken again later
  if (def?.side) onSideAbandon(state, def); // what you found for it goes back where it was
  ensureTracked(state);
  return { ok: true };
}

// Seconds until the boss of this place is back (0 = it is there).
export const restLeft = (state, placeId) => state.lairs?.get(placeId)?.respawn ?? 0;

// Quests for a resting boss or dungeon bring it back sooner. Safe to call as often as you like.
export function recallBosses(state) {
  for (const [id, entry] of Object.entries(state.player.quests)) {
    const def = questDef(state, id);
    // the last step of the story is about the console behind the Ring's keeper, not the fight: do not bring the keeper
    // back early, or the console closes while you are still thinking
    if (entry.status !== 'active' || !def?.lair || def.kind === 'ending' || entry.progress >= def.count) continue;
    const rest = state.lairs?.get(def.lair);
    if (rest && rest.respawn > QUEST_RECALL) rest.respawn = QUEST_RECALL;
  }
}

export function acceptQuest(state, id) {
  const def = questDef(state, id);
  if (!def || !isUnlocked(state, def) || questEntry(state, id)) return { error: 'none' };
  if (activeCount(state) >= MAX_ACTIVE) return { error: 'limit' };
  // the choice at the Ring made before this quest was taken: it is done already, take it back to the capital
  state.player.quests[id] = { status: 'active', progress: def.kind === 'ending' && state.ending ? def.count : 0 };
  if (def.side) onSideAccept(state, def, state.player.quests[id]); // a letter in your hands, a thing already found
  if (!state.player.tracked) state.player.tracked = id; // the first quest becomes the current one
  recallBosses(state);
  return { ok: true };
}

const becameReady = (def, e, before) => before < def.count && e.progress >= def.count;

// The choice at the Ring was made: the quest that led there is done, to be told in the capital.
export function onEnding(state) {
  const ready = [];
  for (const def of state.questDefs) {
    const e = questEntry(state, def.id);
    if (e?.status !== 'active' || def.kind !== 'ending') continue;
    const before = e.progress;
    e.progress = def.count;
    if (becameReady(def, e, before)) ready.push(def.id);
  }
  return ready;
}

// Both return the ids of quests that just became ready to hand in.
export function onKill(state, enemyId) {
  const ready = [];
  for (const def of state.questDefs) {
    const e = questEntry(state, def.id);
    if (!e || e.status !== 'active' || def.kind !== 'kill') continue;
    if (def.target !== 'any' && def.target !== enemyId) continue;
    const before = e.progress;
    e.progress = Math.min(def.count, e.progress + 1);
    if (becameReady(def, e, before)) ready.push(def.id);
  }
  return ready;
}

// Called when the player enters a town: courier quests addressed to it are now delivered.
export function onVisit(state, townId) {
  const ready = [];
  for (const def of state.questDefs) {
    const e = questEntry(state, def.id);
    if (e?.status !== 'active' || def.kind !== 'visit' || def.target !== townId) continue;
    const before = e.progress;
    e.progress = def.count;
    if (becameReady(def, e, before)) ready.push(def.id);
  }
  return ready;
}

// Where the objective of a quest leads right now, or null while it is "hunt anywhere".
export function targetTownId(state, def) {
  if (def.kind === 'visit') return def.target;
  if (def.kind === 'deliver') return turnInTown(def);
  return isComplete(state, def.id) ? turnInTown(def) : null;
}

// Where the current quest points: a lair while its boss is still alive, otherwise a town. Shape:
// { id, x, y (pixels), tx, ty (tiles), nameKey (language key of its name), townKey (for a person: their town),
// kind: 'town' | 'npc' | 'lair' | 'dungeon', def }
function waypointTarget(state, world, def) {
  if (def.side && !isComplete(state, def.id) && (def.kind === 'find' || def.kind === 'gather')) { // a circle to search
    const a = searchArea(state, def);
    if (def.person && a?.r === 0) return { id: def.id, x: a.x, y: a.y, tx: Math.floor(a.x / TILE), ty: Math.floor(a.y / TILE), nameKey: 'npc.' + def.person, kind: 'npc' };
    return a && { id: def.id, x: a.x, y: a.y, r: a.r, tx: Math.floor(a.x / TILE), ty: Math.floor(a.y / TILE), nameKey: `quest.${def.id}.where`, kind: 'area' };
  }
  if (def.side && isComplete(state, def.id) && spotOfGiver(state, turnInTown(def))) { // handed in to someone out in the wild
    const pos = personPos(state, turnInRole(def));
    if (pos) return { id: turnInTown(def), x: pos.x, y: pos.y, tx: Math.floor(pos.x / TILE), ty: Math.floor(pos.y / TILE), nameKey: 'npc.' + turnInRole(def), kind: 'npc' };
  }
  if (def.kind === 'kill' && def.lair?.startsWith('d:') && !isComplete(state, def.id)) { // a dungeon: point at its entrance
    const e = entranceById(world, def.lair, state.dungeonDefs);
    return e && { id: e.id, x: e.px, y: e.py, tx: e.tx, ty: e.ty, nameKey: 'dungeon.theme.' + e.theme, kind: 'dungeon' };
  }
  if (def.kind === 'ending' && !isComplete(state, def.id)) { // the shaft down to the Ring
    const ring = ringSite(world);
    return ring && { id: ring.id, x: ring.px, y: ring.py, tx: ring.tx, ty: ring.ty, nameKey: 'ring.name', kind: 'dungeon' };
  }
  if (def.kind === 'kill' && def.lair && !isComplete(state, def.id)) {
    const lair = lairById(world, def.lair, state.bossDefs ?? []);
    return lair && { id: lair.id, x: lair.px, y: lair.py, tx: lair.tx, ty: lair.ty, nameKey: 'enemy.' + lair.bossId, kind: 'lair' };
  }
  const townId = targetTownId(state, def);
  const town = townId ? world.getTownById(townId) : null;
  if (!town) return null;
  // a job done: the arrow leads to the very person who takes it back, not just to their town
  const npc = (isComplete(state, def.id) || def.kind === 'deliver') && npcFor(town, roleIn(town, turnInRole(def)));
  if (npc) return { id: town.id, x: npc.x, y: npc.y, tx: Math.floor(npc.x / TILE), ty: Math.floor(npc.y / TILE), nameKey: 'npc.' + (npc.person ?? npc.id), townKey: 'town.name.' + town.nameIndex, kind: 'npc' };
  return { id: town.id, x: town.px, y: town.py, tx: town.tx, ty: town.ty, nameKey: 'town.name.' + town.nameIndex, kind: 'town' };
}

export function trackedWaypoint(state, world) {
  if (world.isDungeon) return null; // below ground there is nothing to point at
  const id = state.player.tracked;
  const def = id && isActive(state, id) ? questDef(state, id) : null;
  const target = def && waypointTarget(state, world, def);
  return target ? { ...target, def } : null;
}

// Clicks in the journal window. A click on a row selects it and makes it the current quest
// (clicking the current one again clears it). Abandoning needs two clicks.
export function clickJournal(state, region) {
  const ui = state.ui;
  if (region.kind === 'tab') {
    ui.journalTab = region.tab;
    ui.chronPage = 0;
    return {};
  }
  if (region.kind === 'page') {
    ui.chronPage = Math.max(0, (ui.chronPage ?? 0) + region.step); // the chronicle clamps it to its last page
    return {};
  }
  if (region.kind === 'row') {
    if (ui.journalSel !== region.id) ui.abandonArmed = null;
    ui.journalSel = region.id;
    setTracked(state, state.player.tracked === region.id ? null : region.id);
    return {};
  }
  if (region.kind === 'abandon' && ui.journalSel && isActive(state, ui.journalSel)) {
    if (ui.abandonArmed !== ui.journalSel) {
      ui.abandonArmed = ui.journalSel;
      return {};
    }
    const id = ui.journalSel;
    ui.abandonArmed = null;
    ui.journalSel = state.player.tracked;
    return abandonQuest(state, id).ok ? { abandoned: id } : {};
  }
  return {};
}

// choice: the answer the hero gives, for a quest that ends with one (one of its `choices` the hero may give: a check,
// `when`, must be passed). The quest remembers the outcome the answer leads to (`as`).
export function turnIn(state, id, townId, choice = null) {
  if (!isComplete(state, id)) return { error: 'none' };
  const def = questDef(state, id);
  if (turnInTown(def) !== townId) return { error: 'none' };
  const answers = answersOf(def, (w) => passesCheck(state.player, w));
  if (answers.length ? !answers.includes(choice) : choice) return { error: 'choice' };
  const p = state.player;
  const r = rewardOf(def, choice);
  p.gold += Math.round((r.gold ?? 0) * (1 + Math.max(0, p.stats?.rewardBonus ?? 0))); // charisma talks the reward up
  if (r.xp) grantXp(state, r.xp);
  if (r.item) {
    const base = state.catalog[r.item.slot]?.find((b) => b.id === r.item.id);
    if (base) {
      const item = buildItem(r.item.slot, base, r.item.rarity);
      if (addToBackpack(state.inventory, item) < 0) state.drops.push(makeDrop(p.x + p.facing.x * 60, p.y + p.facing.y * 60, item, 1.5)); // backpack full
    }
  }
  const outcome = choice ? outcomeOf(def, choice) : null;
  state.player.quests[id] = outcome ? { status: 'done', progress: def.count, choice: outcome, at: state.clock ?? 0 } : { status: 'done', progress: def.count };
  if (def.side) { // things handed over, quests this closes; a side quest's ending is remembered for the talk of the town
    onSideTurnIn(state, def, outcome);
    state.player.quests[id].at = state.clock ?? 0;
  }
  ensureTracked(state);
  if (def.doneKeys?.[state.ending]) { // the end of the story: the ruler answers what you chose
    state.note = { key: def.doneKeys[state.ending], args: def.args, title: 'story.note.title', t: 0, dur: STORY_NOTE_TIME, story: true };
    ensureHistory(state).learned.add(`s:${def.id}`);
  } else if (def.doneKey) { // a step of the main story: what you learn by it, on paper and in the chronicle
    const key = state.ending && def.doneKeyEnded ? def.doneKeyEnded : def.doneKey; // nothing to ask of a choice made
    state.note = { key, args: def.args, title: 'story.note.title', t: 0, dur: STORY_NOTE_TIME, story: true };
    ensureHistory(state).learned.add(`s:${def.id}`);
  }
  return { ok: true };
}
