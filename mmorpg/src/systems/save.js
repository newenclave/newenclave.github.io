import { recalcStats } from './stats.js';
import { restoreLearned, learnedSet, START } from './skilltree.js';
import { ATTRS, MIN as ATTR_MIN, MAX as ATTR_MAX, baseAttrs, CREATE_POINTS, PER_LEVEL, CREATE_SKILL_POINTS } from './attributes.js';
import { INV_SIZE } from './inventory.js';
import { MAX_PLUS } from './economy.js';
import { ensureTracked } from './quests.js';
import { choicesOf } from './deeds.js';
import { Explored } from './explore.js';
import { REST_ID, BOSS_RESPAWN, LAIR_ID } from './lairs.js';
import { EVENT_ID, ECHO_ID, ARTIFACT_ID } from './history.js';
import { PULSE_EFFECTS, MAX_PULSES } from './pulse.js';
import { ensureBestiary } from './bestiary.js';
import { WORLD_GEN, WORLD_GENS as ENDLESS_GENS } from '../world/world.js';
import { MAP_GEN } from '../world/map.js';

const WORLD_GENS = [...ENDLESS_GENS, MAP_GEN]; // the endless worlds (1-3) and the finite map (4)
import { buildItem, buildAmmo, rarityById, MAX_STACK } from '../sim/loot.js';
import { canEquipOffhand } from './loadout.js';
import { EQUIP_SLOTS, upgradeEquipment } from './equipment.js';
import { buildRelic } from './relics.js';

export const SAVE_KEY = 'mmorpg-draft-save';
const VERSION = 9;
const MAX_LEVEL = 200;
const MAX_GOLD = 1e9;
export const MAX_SEED = 2147483647;
const MAX_DISCOVERED = 2000;
// a town ("3,-2"), a boss lair ("l:3,-2"), a dungeon ("d:3,-2"), a cave ("c:3,-2") or a hidden valley ("v:3,-2")
const DISCOVERED_ID = /^(([ldcvk]:)?-?\d{1,5},-?\d{1,5}|r:ring)$/;
const RUN_ID = /^[dcvk]:-?\d{1,5},-?\d{1,5}$/; // places with chests: dungeons, caves, hidden valleys and camps
const MAX_DUNGEONS = 300;
const MAX_KILLS = 1e6;
const CHEST_SLOTS = 12;
const MAX_LAIR_STATES = 2000;
const MAX_LEARNED = 2000; // chronicle entries
const CAMP_REST_MAX = 600;
const PULSE_LANDS = ['grass', 'forest', 'desert', 'snow', 'beach'];
const MAX_CLOCK = 1e9; // seconds of play
// learned: events of the past, echoes of the future, steps of the story, and deeds of yours ("d:<quest>") a town retold
const LEARNED_ID = (id) => typeof id === 'string' && (EVENT_ID.test(id.replace(/~b$/, '')) || ECHO_ID.test(id) || /^s:(m:[1-9]|end:(fold|open)|set:[a-z_]{1,20})$/.test(id) || /^d:[a-z0-9_]{1,40}$/.test(id));

const slim = (item) => {
  if (!item) return null;
  const out = { slot: item.slot, id: item.id, rarity: item.rarity, plus: item.plus | 0 };
  if (item.art) out.art = item.art.id; // an artifact: its story is made again from the seed (resolveArtifact)
  if (item.relic) out.relic = true; // a relic of the old world: made again from data/relics.json
  if (item.slot === 'ammo') out.count = item.count;
  return out;
};

export function serializeState(state, seed) {
  const p = state.player;
  const ow = state.overworld; // inside a dungeon the open world is put aside: that is what gets saved
  return {
    v: VERSION,
    seed,
    gen: (ow ? ow.world : state.world)?.gen ?? WORLD_GEN,
    savedAt: Date.now(),
    player: {
      x: ow ? ow.x : p.x, y: ow ? ow.y : p.y, hp: p.hp, mana: p.mana ?? 0, level: p.level, xp: p.xp, skillPoints: p.skillPoints, gold: p.gold,
      learned: [...learnedSet(p)].filter((id) => id !== START), attrs: { ...(p.attrs ?? baseAttrs()) }, attrPoints: p.attrPoints | 0, weaponIndex: Math.max(0, state.weapons.indexOf(p.weapon)),
      tracked: p.tracked ?? null,
      boat: !!p.boat, boating: !!p.boating,
      // a quest that ended with a choice keeps it, and when (systems/deeds.js); a side quest also what you picked, and
      // a closed one what closed it and whether its giver has said so (systems/sidequests.js)
      quests: Object.fromEntries(Object.entries(p.quests).map(([id, q]) => [id, saveQuest(q)])),
      items: { ...(p.items ?? {}) }, // things carried for quests
      heard: [...(p.heard ?? [])], // what the people of the side stories have said once
    },
    weapons: state.weapons.map(slim),
    offhands: (state.offhands ?? []).map(slim),
    inventory: state.inventory.map(slim),
    equipment: Object.fromEntries(EQUIP_SLOTS.map((k) => [k, slim(p.equipment[k])])),
    explored: (ow ? ow.explored : state.explored).toJSON(),
    discovered: [...state.discovered],
    bestiary: {
      seen: [...ensureBestiary(state).seen],
      kills: Object.fromEntries(state.bestiary.kills),
    },
    // what you explored in each dungeon, and which chests you opened there
    dungeons: Object.fromEntries([...(state.dungeonExplored ?? [])].filter(([, ex]) => ex.tiles > 0).slice(0, MAX_DUNGEONS).map(([id, ex]) => [id, ex.toJSON()])),
    runs: Object.fromEntries([...(state.dungeonRuns ?? [])].map(([id, run]) => [id, run.opened])),
    // lairs and dungeons whose boss was killed and has not come back yet: id -> seconds left
    lairs: Object.fromEntries([...(state.lairs ?? [])].filter(([, st]) => st.respawn > 0).map(([id, st]) => [id, Math.ceil(st.respawn)])),
    ending: state.ending ?? null, // what was chosen at the Ring
    // cleared monster camps: id -> seconds they stay empty, and the round they are in
    clock: Math.floor(state.clock ?? 0), // seconds of play: deeds take a while to get around
    camps: Object.fromEntries([...(state.camps ?? [])].filter(([, c]) => c.rest > 0 || c.round).map(([id, c]) => [id, { rest: Math.ceil(c.rest ?? 0), round: c.round ?? 0 }])),
    // the chronicle: what you have learned of the past, and the futures you have undone
    history: {
      learned: [...(state.history?.learned ?? [])], averted: [...(state.history?.averted ?? [])], pulses: state.history?.pulses ?? [],
      firstTalk: state.history?.firstTalk ?? 0, // the elder's first words are said once
      found: [...(state.history?.found ?? [])],
      relicsFound: [...(state.history?.relicsFound ?? [])], relicsKnown: [...(state.history?.relicsKnown ?? [])],
      setsDone: [...(state.history?.setsDone ?? [])], titles: state.history?.titles ?? [],
    },
  };
}

function saveQuest(q) {
  const out = { status: q.status, progress: q.progress };
  if (q.choice) out.choice = q.choice;
  if (q.at !== undefined) out.at = q.at;
  if (q.picked?.length) out.picked = [...q.picked];
  if (q.status === 'closed') Object.assign(out, { by: q.by, told: !!q.told, was: !!q.was });
  return out;
}

const ITEM_ID = /^[a-z][a-z0-9_]{0,40}$/;
const num = (v, min, max, fallback) => (Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);

// Items are rebuilt from the catalog, so an edited save can never contain stats the game would not generate.
function rebuild(state, raw, expectSlot) {
  const slot = expectSlot ?? raw?.slot;
  if (!raw || (raw.slot !== undefined && raw.slot !== slot)) return null;
  if (raw.relic === true) { // a relic: only as itself, and only in a place it fits
    const relic = typeof raw.id === 'string' ? buildRelic(state.catalog, raw.id) : null;
    return relic && relic.slot === slot ? relic : null;
  }
  const base = Object.hasOwn(state.catalog, slot) ? state.catalog[slot].find((b) => b.id === raw.id) : undefined;
  if (!base) return null;
  if (slot === 'ammo') return buildAmmo(base, rarityById(raw.rarity).id, Math.round(num(raw.count, 1, MAX_STACK, 1)));
  const item = buildItem(slot, base, rarityById(raw.rarity).id, Math.round(num(raw.plus, 0, MAX_PLUS, 0)));
  // an artifact keeps its story only if the world really has it, and it is this very item (else it is an ordinary one)
  const art = typeof raw.art === 'string' && ARTIFACT_ID.test(raw.art) ? state.resolveArtifact?.(raw.art) : null;
  const list = state.catalog[slot];
  if (art && art.slot === slot && list[art.base % list.length] === base && ['rare', 'epic', 'legendary'].includes(item.rarity)) item.art = art;
  return item;
}

// Saved data comes from localStorage, so every field is validated before use.
export function applySave(state, data, seed) {
  if (!data || !(data.v >= 1 && data.v <= VERSION) || data.seed !== seed) return false;
  if (!data.player || !Array.isArray(data.weapons) || data.weapons.length > state.weapons.length) return false;

  // a set may be empty (null); one that holds something that cannot be rebuilt makes the save invalid. A save from before
  // a weapon set was added has fewer: the new ones start empty.
  const weapons = state.weapons.map((_, i) => (i >= data.weapons.length || data.weapons[i] === null ? null : rebuild(state, data.weapons[i], 'weapon')));
  if (weapons.some((w, i) => !w && i < data.weapons.length && data.weapons[i] !== null) || !weapons.some(Boolean)) return false;

  const s = data.player;
  const p = state.player;
  p.level = Math.round(num(s.level, 1, MAX_LEVEL, 1));
  p.xp = num(s.xp, 0, 1e9, 0);
  p.skillPoints = Math.round(num(s.skillPoints, 0, 1000, 0));
  // the attributes; a save from before them starts at the base with every point it would have had to spend
  p.attrs = baseAttrs();
  if (s.attrs && typeof s.attrs === 'object') {
    for (const id of ATTRS) p.attrs[id] = Math.round(num(s.attrs[id], ATTR_MIN, ATTR_MAX, p.attrs[id]));
    p.attrPoints = Math.round(num(s.attrPoints, 0, 1000, 0));
  } else {
    p.attrPoints = CREATE_POINTS + PER_LEVEL * (p.level - 1);
  }
  // the skill web; a save from before it (ranks of the old tree) gets every point back to spend
  if (Array.isArray(s.learned)) {
    p.learned = restoreLearned(state.web, s.learned);
  } else {
    p.learned = new Set([START]);
    p.skillPoints = Math.min(1000, CREATE_SKILL_POINTS + (p.level - 1));
  }
  p.x = num(s.x, -1e7, 1e7, p.x);
  p.y = num(s.y, -1e7, 1e7, p.y);
  p.gold = Math.floor(num(s.gold, 0, MAX_GOLD, 0));
  p.boat = s.boat === true;
  p.boating = p.boat && s.boating === true; // you cannot be in a boat you do not own
  p.quests = {};
  // generated town quests are re-created from the seed by resolveQuest before they are validated
  for (const [id, q] of Object.entries(s.quests && typeof s.quests === 'object' ? s.quests : {})) {
    const def = state.questIndex.get(id) ?? state.resolveQuest?.(id);
    if (def && (q?.status === 'active' || q?.status === 'done' || (q?.status === 'closed' && def.side))) {
      const e = p.quests[id] = { status: q.status, progress: Math.round(num(q.progress, 0, def.count, 0)) };
      if (q.status === 'done' && choicesOf(def).includes(q.choice)) Object.assign(e, { choice: q.choice, at: num(q.at, 0, MAX_CLOCK, 0) });
      else if (q.status === 'done' && def.side) e.at = num(q.at, 0, MAX_CLOCK, 0);
      if (def.side && Array.isArray(q.picked)) e.picked = [...new Set(q.picked.filter((i) => Number.isInteger(i) && i >= 0 && i < 64))];
      if (q.status === 'closed') Object.assign(e, { progress: 0, by: typeof q.by === 'string' ? q.by.slice(0, 60) : null, told: q.told === true, was: q.was === true, at: num(q.at, 0, MAX_CLOCK, 0) });
    }
  }

  p.heard = (Array.isArray(s.heard) ? s.heard : []).filter((k) => typeof k === 'string' && k.length < 80).slice(0, 200);
  p.items = {};
  for (const [id, n] of Object.entries(s.items && typeof s.items === 'object' ? s.items : {}).slice(0, 64)) {
    if (ITEM_ID.test(id) && Number.isFinite(n) && n >= 1) p.items[id] = Math.min(99, Math.floor(n));
  }
  p.tracked = typeof s.tracked === 'string' && p.quests[s.tracked]?.status === 'active' ? s.tracked : null;
  ensureTracked(state);

  state.weapons = weapons;
  p.weapon = weapons[Math.round(num(s.weaponIndex, 0, weapons.length - 1, 0))] ?? weapons.find(Boolean);
  state.inventory = Array.from({ length: INV_SIZE }, (_, i) => rebuild(state, data.inventory?.[i], null));
  // one off hand per hotbar slot; an item that cannot be held there is simply dropped from the save
  const savedOff = Array.isArray(data.offhands) ? data.offhands : [];
  state.offhands = weapons.map((_, i) => {
    const item = rebuild(state, savedOff[i], null);
    return canEquipOffhand(item) ? item : null;
  });
  // older saves wore one armor and one accessory: they are put where they fit on the body
  p.equipment = upgradeEquipment(data.equipment, (raw, slot) => rebuild(state, raw, slot));
  state.explored = Explored.fromJSON(data.explored);
  state.dungeonExplored = new Map();
  const savedDungeons = data.dungeons && typeof data.dungeons === 'object' ? Object.entries(data.dungeons) : [];
  for (const [id, json] of savedDungeons.slice(0, MAX_DUNGEONS)) {
    if (RUN_ID.test(id)) state.dungeonExplored.set(id, Explored.fromJSON(json));
  }
  state.dungeonRuns = new Map();
  const savedRuns = data.runs && typeof data.runs === 'object' ? Object.entries(data.runs) : [];
  for (const [id, opened] of savedRuns.slice(0, MAX_DUNGEONS)) {
    if (!RUN_ID.test(id) || !Array.isArray(opened)) continue;
    const ok = [...new Set(opened.filter((n) => Number.isInteger(n) && n >= 0 && n < CHEST_SLOTS))];
    state.dungeonRuns.set(id, { opened: ok });
  }
  state.bestiary = { seen: new Set(), kills: new Map() };
  const known = new Set([...state.enemyDefs, ...state.bossDefs].map((d) => d.id));
  const savedBook = data.bestiary && typeof data.bestiary === 'object' ? data.bestiary : {};
  for (const id of Array.isArray(savedBook.seen) ? savedBook.seen : []) if (typeof id === 'string' && known.has(id)) state.bestiary.seen.add(id);
  for (const [id, n] of Object.entries(savedBook.kills && typeof savedBook.kills === 'object' ? savedBook.kills : {})) {
    if (!known.has(id) || !Number.isFinite(n) || n < 1) continue;
    state.bestiary.kills.set(id, Math.floor(Math.min(MAX_KILLS, n)));
    state.bestiary.seen.add(id); // a creature you have killed has been seen
  }
  state.area = null;
  state.overworld = null;
  state.lairs = new Map();
  const savedLairs = data.lairs && typeof data.lairs === 'object' ? Object.entries(data.lairs) : [];
  for (const [id, left] of savedLairs.slice(0, MAX_LAIR_STATES)) {
    // lairs, dungeons and the Ring ("r:ring": its keeper stays down, so the console stays open after a reload)
    if ((REST_ID.test(id) || id === 'r:ring') && Number.isFinite(left) && left > 0) state.lairs.set(id, { respawn: Math.min(BOSS_RESPAWN, left) });
  }
  state.ending = ['fold', 'open'].includes(data.ending) ? data.ending : null;
  state.clock = num(data.clock, 0, MAX_CLOCK, 0);
  state.camps = new Map();
  for (const [id, c] of Object.entries(data.camps && typeof data.camps === 'object' ? data.camps : {}).slice(0, MAX_LAIR_STATES)) {
    if (!/^k:-?\d{1,5},-?\d{1,5}$/.test(id) || !c || typeof c !== 'object') continue;
    state.camps.set(id, { rest: num(c.rest, 0, CAMP_REST_MAX, 0), round: Math.round(num(c.round, 0, 1e6, 0)), woke: false });
  }
  const hist = data.history && typeof data.history === 'object' ? data.history : {};
  const isRelic = (id) => (state.catalog.relic ?? []).some((r) => r.id === id);
  const isSet = (id) => (state.relicSets ?? []).some((s) => s.id === id);
  state.history = {
    firstTalk: Math.round(num(hist.firstTalk, 0, 99, 0)),
    learned: new Set((Array.isArray(hist.learned) ? hist.learned : []).filter(LEARNED_ID).slice(0, MAX_LEARNED)),
    averted: new Set((Array.isArray(hist.averted) ? hist.averted : []).filter((id) => typeof id === 'string' && LAIR_ID.test(id)).slice(0, MAX_LAIR_STATES)),
    found: new Set((Array.isArray(hist.found) ? hist.found : []).filter((id) => typeof id === 'string' && ARTIFACT_ID.test(id)).slice(0, MAX_LEARNED)),
    // relics: found, named by a chronicler, sets rewarded, titles earned (only ids the game knows)
    relicsFound: new Set((Array.isArray(hist.relicsFound) ? hist.relicsFound : []).filter(isRelic)),
    relicsKnown: new Set((Array.isArray(hist.relicsKnown) ? hist.relicsKnown : []).filter(isRelic)),
    setsDone: new Set((Array.isArray(hist.setsDone) ? hist.setsDone : []).filter(isSet)),
    titles: (Array.isArray(hist.titles) ? hist.titles : []).filter((x) => (state.relicSets ?? []).some((s) => s.reward.title === x)),
    // the Pulses you lived through (not made from the seed: they happened to you)
    pulses: (Array.isArray(hist.pulses) ? hist.pulses : [])
      .filter((pl) => pl && Number.isInteger(pl.n) && pl.n > 0 && PULSE_EFFECTS.includes(pl.effect) && PULSE_LANDS.includes(pl.biome)
        && (pl.town === null || (Number.isInteger(pl.town) && pl.town >= 0 && pl.town < 64)))
      .slice(-MAX_PULSES)
      .map((pl) => ({ n: pl.n, effect: pl.effect, biome: pl.biome, town: pl.town })),
  };
  const ids = Array.isArray(data.discovered) ? data.discovered : [];
  state.discovered = new Set(ids.filter((id) => typeof id === 'string' && DISCOVERED_ID.test(id)).slice(0, MAX_DISCOVERED));
  state.lastRevealTile = null;
  recalcStats(state);
  p.hp = num(s.hp, 1, p.maxHp, p.maxHp);
  p.mana = num(s.mana, 0, p.maxMana, p.maxMana);
  return true;
}

// Which terrain generator the saved world was made with (saves from before versions existed used 1).
export function saveGen(data) {
  return WORLD_GENS.includes(data?.gen) ? data.gen : 1;
}

// The world seed stored in a save, or null when it is not a usable seed.
export function saveSeed(data) {
  return data && Number.isInteger(data.seed) && data.seed >= 0 && data.seed <= MAX_SEED ? data.seed : null;
}

// What the "Continue" button shows. Returns null when the data cannot be a usable save.
export function describeSave(data) {
  const pl = data?.player;
  if (saveSeed(data) === null || !(data.v >= 1 && data.v <= VERSION) || !pl || typeof pl !== 'object') return null;
  if (!Number.isFinite(pl.level)) return null;
  const quests = pl.quests && typeof pl.quests === 'object' ? Object.values(pl.quests) : [];
  return {
    level: Math.round(num(pl.level, 1, MAX_LEVEL, 1)),
    gold: Math.floor(num(pl.gold, 0, MAX_GOLD, 0)),
    quests: quests.filter((q) => q?.status === 'done').length,
    savedAt: Number.isFinite(data.savedAt) ? data.savedAt : null,
  };
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeSave(data) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* storage unavailable */ }
}
