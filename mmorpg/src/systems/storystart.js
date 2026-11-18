import { buildItem } from '../sim/loot.js';
import { grantXp, xpToNext } from './xp.js';
import { recalcStats } from './stats.js';
import { acceptQuest, ensureTracked, setTracked } from './quests.js';
import { ringSite } from './ring.js';
import { ARMOR_PARTS } from './equipment.js';
import { learn } from './skilltree.js';
import { entriesOf } from './attributes.js';
import { syncHands } from './loadout.js';
import { addToBackpack } from './backpack.js';

// A shortcut into the story for trying it out (?story=2, ?story=3, ?story=ring on a new game): the acts before are
// marked done, the player gets the level and the gear the act expects, and stands where the act begins.
export const STORY_STAGES = ['2', '3', 'ring'];
const LEVEL = { 2: 10, 3: 30, ring: 34 };
const GOLD = { 2: 1000, 3: 5000, ring: 5000 };

const done = (state, id) => { state.player.quests[id] = { status: 'done', progress: state.questIndex.get(id)?.count ?? 1 }; };
const best = (list, key) => list.reduce((a, b) => (b[key] > a[key] ? b : a));

// Returns false for an unknown stage. Call on a fresh game, before the first look at the world.
export function startStory(state, stage) {
  if (!STORY_STAGES.includes(stage)) return false;
  const p = state.player;
  for (const def of state.questDefs) if (def.giver === '0,0' && !def.story && !def.titleKey && !def.side) done(state, def.id); // act 1 (the side stories stay open)
  if (stage !== '2') for (const id of ['m:1', 'm:2', 'm:3', 'm:4', 'm:5']) if (state.questIndex.has(id)) done(state, id);
  while (p.level < LEVEL[stage]) grantXp(state, xpToNext(p.level) - p.xp); // one level at a time, with its skill point
  p.gold = GOLD[stage];
  if (stage !== '2') { // gear for the far end of the world, and a hero strong and trained enough for all of it
    p.attrs = { ...p.attrs, str: 7, dex: 6, int: 6, per: 5 };
    for (const e of entriesOf(state.web)) {
      p.skillPoints = (p.skillPoints | 0) + 1;
      learn(state, e.id);
    }
    const all = state.catalog.weapon.map((b) => buildItem('weapon', b, 'epic', 2)); // every weapon: the sets full, the rest in the backpack
    state.weapons = state.weapons.map((_, i) => all[i] ?? null);
    for (const w of all.slice(state.weapons.length)) addToBackpack(state.inventory, w);
    syncHands(state, 0);
    for (const part of ARMOR_PARTS) { // the best piece for every part of the body
      const pieces = state.catalog.armor.filter((a) => a.part === part);
      if (pieces.length) p.equipment[part] = buildItem('armor', best(pieces, 'defense'), 'epic', 2);
    }
    const jewel = (id) => state.catalog.accessory.find((a) => a.id === id);
    for (const [place, id] of [['ring1', 'ring_precision'], ['ring2', 'ring_might'], ['neck', 'amulet_vigor'], ['wrist1', 'bracer_guard'], ['wrist2', 'charm_haste']]) {
      if (jewel(id)) p.equipment[place] = buildItem('accessory', jewel(id), place === 'ring1' ? 'legendary' : 'epic');
    }
  }
  const m6 = state.questIndex.get('m:6');
  if (stage === '3' && m6) { // in the capital, by its ruler
    const elder = state.world.getTownById(m6.giver)?.npcs.find((n) => n.id === 'elder');
    if (elder) Object.assign(p, { x: elder.x, y: elder.y + 40 });
  }
  if (stage === 'ring') {
    if (m6) {
      acceptQuest(state, 'm:6');
      setTracked(state, 'm:6');
    }
    const ring = ringSite(state.world);
    if (ring) Object.assign(p, { x: ring.px, y: ring.py + 40 }); // right by the shaft (its own tile is open ground)
  }
  ensureTracked(state);
  recalcStats(state);
  p.hp = p.maxHp;
  return true;
}
