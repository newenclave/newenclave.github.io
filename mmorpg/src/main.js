import { Input } from './core/input.js';
import { loadLang, t } from './core/i18n.js';
import { World, TILE, WORLD_GEN } from './world/world.js';
import { MapWorld, MAP_GEN } from './world/map.js';
import { goodStart } from './world/reach.js';
import { Renderer } from './render/renderer.js';
import { tryAttack, updateProjectiles, updateEffects, tickStatuses } from './sim/combat.js';
import { moveWithCollision, moveBoat, isFlying, bodyY } from './sim/entity.js';
import { toggleBoat, boatHint, BOAT_SPEED } from './systems/boat.js';
import { updateEnemies, updateEnemyProjectiles } from './sim/enemy.js';
import { topUpEnemies, cullFarEnemies, fadeCalm } from './systems/spawning.js';
import { updateCamps, campChests } from './systems/camps.js';
import {
  updateDoor, useDoor, updateChests, discoverEntrances, respawnPoint, valleyChests, discoverValleys, discoverRing,
} from './systems/dungeons.js';
import { updateLairs } from './systems/lairs.js';
import { buildItem, rarityById } from './sim/loot.js';
import { recalcStats } from './systems/stats.js';
import { rankUp } from './systems/skilltree.js';
import { emptyInventory, updateDrops, clickInventory, quickAction } from './systems/inventory.js';
import { openShop } from './systems/shop.js';
import { acceptQuest, turnIn, onVisit, clickJournal, ensureTracked, recallBosses, QUEST_ROLES } from './systems/quests.js';
import { generateTownQuests, townDifficulty, GENERATED_ID } from './systems/townquests.js';
import { Explored, updateExploration, discoverLairs, SIGHT_PX } from './systems/explore.js';
import { grantXp } from './systems/xp.js';
import { NOTE_TIME } from './systems/lore.js';
import { nextRumour, hearRumour, memorialsInRange, learn, ownHistory, ARTIFACT_ID } from './systems/history.js';
import { updatePulse } from './systems/pulse.js';
import { updateFolk } from './systems/townsfolk.js';
import { storyQuests } from './systems/storyline.js';
import { chooseEnding } from './systems/ring.js';
import { startStory } from './systems/storystart.js';
import { emptyEquipment } from './systems/equipment.js';
import { identifyRelics } from './systems/relics.js';
import { hitEnding } from './ui/ending-ui.js';
import { inscription } from './ui/chronicle-ui.js';
import { hitTest, hitClose } from './ui/skilltree-ui.js';
import { hitInventory } from './ui/inventory-ui.js';
import { hitDialog, dialogView, openDialog } from './ui/dialog-ui.js';
import { hitJournal } from './ui/journal-ui.js';
import { hitMap } from './ui/map-ui.js';
import { hitBestiary, clickBestiary } from './ui/bestiary-ui.js';
import { scanVisible, entriesFor } from './systems/bestiary.js';
import {
  serializeState, applySave, loadSave, writeSave, clearSave, saveSeed, saveGen, describeSave, MAX_SEED,
} from './systems/save.js';
import { loadSettings, storeSettings } from './systems/settings.js';
import { newMenu, menuClick, menuEnter, menuEscape, menuMove, fixCursor } from './systems/menu.js';
import { layoutMenu, hitMenu, menuContext } from './ui/menu-ui.js';

const STEP = 1 / 60;
const SPEED = 190;
const ROLL_SPEED = 520;
const ROLL_TIME = 0.22;
const ROLL_COOLDOWN = 0.8;
const PLAYER_MAX_HP = 100;
const BASE_REGEN = 3;
const TOWN_REGEN = 25; // HP/s inside a town
const AIM_DRAG_MIN = 14;
const AUTO_AIM_RANGE = Math.min(450, SIGHT_PX); // you cannot auto-aim at what the fog hides
const NPC_REACH = 70;
const GRAVE_REACH = 50;

const ENEMY_TOP_UP_EVERY = 4; // seconds between wanderers coming in (one group at a time)

async function loadJson(path) {
  const res = await fetch(path);
  return res.json();
}

const notify = (state, key, color = '#ff5252') => {
  const p = state.player;
  state.floaters.push({ x: p.x, y: p.y - 40, color, t: 0, dur: 1.4, text: t(key) });
};

// Talking to someone in a town: the people who give quests open the quest window with their own quests and words
// (the elder, the priest and the innkeeper tell the town's past); merchants and market traders trade, the blacksmith
// upgrades.
function openNpc(state, npc, town) {
  const ui = state.ui;
  ui.selected = null;
  if (npc.id === 'chronicler') nameRelics(state); // relics you carry are named first
  if (QUEST_ROLES.includes(npc.id)) {
    ui.panel = 'quests';
    ui.questTown = town.id;
    ui.questNpc = npc.id;
    ui.rumour = TELLERS.includes(npc.id) ? nextRumour(state, state.world, town, npc.id) : null; // a piece of the town's past
    const h = state.history;
    if (npc.id === 'elder' && town.id === '0,0' && (h.firstTalk ?? 0) < FIRST_TALKS) { // the first words you hear here
      ui.rumour = null;
      ui.firstTalk = h.firstTalk ?? 0;
      h.firstTalk = ui.firstTalk + 1;
    } else ui.firstTalk = null;
    ui.sayLine = Math.floor(Math.random() * SAY_LINES);
    openDialog(state);
    return;
  }
  if (npc.id === 'merchant' || npc.id === 'trader') openShop(state, town, npc);
  ui.mode = npc.id === 'blacksmith' ? 'blacksmith' : 'merchant';
  ui.panel = 'inventory';
}
const TELLERS = ['elder', 'priest', 'innkeeper'];

// The chronicler names the relics you bring (what they really were), pays for them, and rewards a complete set.
function nameRelics(state) {
  const r = identifyRelics(state);
  if (!r.named.length && !r.sets.length) return;
  const p = state.player;
  if (r.sets.length) {
    const set = r.sets[0];
    state.note = { text: t('relic.set.done', { set: t('relicset.' + set), reward: t(`relicset.${set}.reward`) }), title: 'relic.title', t: 0, dur: 14 };
  } else if (r.named.length === 1) {
    const id = r.named[0];
    const truth = id === 'relic_lab_badge' ? t('chronicler.badge') : t(`relic.${id}.truth`);
    state.note = { text: t('relic.identified', { name: t('relic.' + id), truth, gold: r.gold }), title: 'relic.title', t: 0, dur: 14 };
  } else {
    state.note = { text: t('relic.identified.more', { n: r.named.length, gold: r.gold }), title: 'relic.title', t: 0, dur: 10 };
  }
  state.floaters.push({ x: p.x, y: p.y - 40, text: `+${r.gold}g`, color: '#ffd54f', t: 0, dur: 1.6 });
}
const SAY_LINES = 3; // say.<role>.0 .. 2
const FIRST_TALKS = 3; // elder.first.0 .. 2: what the elder of the first town says to you, one each of the first talks

function updateTown(state, world) {
  const p = state.player;
  const town = world.townAtPx(p.x, p.y);
  state.town = town;
  if ((town?.id ?? null) !== state.townId) {
    state.townId = town?.id ?? null;
    if (town) {
      const name = t('town.name.' + town.nameIndex);
      state.banner = { text: t(town.walled ? 'town.enter.' + town.kind : 'town.enter', { name }), t: 0 };
      state.ensureTownQuests(town);
      for (const id of onVisit(state, town.id)) {
        state.floaters.push({ x: p.x, y: p.y - 60, key: 'quest.ready', questId: id, color: '#9ccc65', t: 0, dur: 2.2 });
      }
    }
    // walking out of town closes the shop and quest windows
    else if (state.ui.panel === 'quests' || (state.ui.panel === 'inventory' && state.ui.mode !== 'inventory')) state.ui.panel = null;
  }
  let near = null; // the closest keeper within reach (two shops can share a corner)
  for (const n of town?.npcs ?? []) {
    const d = Math.hypot(n.x - p.x, n.y - p.y);
    if (d <= NPC_REACH && (!near || d < near.d)) near = { n, d };
  }
  state.nearNpc = near?.n ?? null;
}

function updatePlayer(state, input, world) {
  const p = state.player;
  const touch = input.touch;
  p.hurt = Math.max(0, p.hurt - STEP);
  p.sinceHit += STEP;
  updateTown(state, world);
  for (const town of updateExploration(state, world)) {
    const xp = 25 * (1 + townDifficulty(town)); // finding a town is worth more the farther it is
    grantXp(state, xp);
    state.banner = { text: t('town.discovered', { name: t('town.name.' + town.nameIndex) }), t: 0 };
    state.floaters.push({ x: p.x, y: p.y - 50, text: `+${xp} XP`, color: '#90caf9', t: 0, dur: 1.8 });
  }

  updateDoor(state, world);
  if (p.boating) state.nearDoor = null; // no walking into dungeons from a boat
  state.boatHint = boatHint(state, world);
  for (const e of discoverEntrances(state, world)) {
    const xp = 20 * (1 + e.tier);
    grantXp(state, xp);
    state.banner = { key: 'dungeon.discovered', theme: e.theme, t: 0 };
    state.floaters.push({ x: p.x, y: p.y - 50, text: `+${xp} XP`, color: '#90caf9', t: 0, dur: 1.8 });
  }
  if (!state.area) {
    // a grave by the road: read when you walk up to it, then it is in the chronicle
    const grave = memorialsInRange(state, world, p.x, p.y, GRAVE_REACH)[0] ?? null;
    if (grave && state.nearGrave !== grave.id) {
      learn(state, grave.id);
      state.note = { text: inscription(grave), title: grave.future ? 'grave.future.title' : 'grave.title', t: 0 };
    }
    state.nearGrave = grave?.id ?? null;
    state.chests = [...valleyChests(state, world), ...campChests(state, world, state.campDefs)]; // chests in the open: valleys, cleared camps
    if (state.pulse?.active?.chest) state.chests.push(state.pulse.active.chest); // and so does one left by a Pulse
    if (discoverRing(state, world)) state.banner = { key: 'ring.discovered', t: 0 }; // the shaft down to the Ring
    for (const found of discoverValleys(state, world)) {
      const xp = (found.kind === 'valley' ? 40 : 15) * (1 + Math.floor(Math.hypot(found.valley.tx, found.valley.ty) / 400));
      grantXp(state, xp);
      state.banner = { text: t(found.kind + '.discovered'), t: 0 };
      state.floaters.push({ x: p.x, y: p.y - 50, text: `+${xp} XP`, color: '#90caf9', t: 0, dur: 1.8 });
    }
  }
  for (const lair of discoverLairs(state, world)) {
    const xp = 15 * (1 + lair.tier);
    grantXp(state, xp);
    state.banner = { key: 'lair.discovered', bossId: lair.bossId, t: 0 };
    state.floaters.push({ x: p.x, y: p.y - 50, text: `+${xp} XP`, color: '#90caf9', t: 0, dur: 1.8 });
  }

  if (state.dead) {
    state.deadTimer -= STEP;
    if (state.deadTimer <= 0) {
      const home = respawnPoint(state); // the start town, or the entrance room in a dungeon
      p.x = home.x;
      p.y = home.y;
      p.hp = p.maxHp;
      p.rollTime = 0;
      p.boating = false;
      state.dead = false;
    }
    return;
  }
  if (p.hp < p.maxHp) {
    if (state.town) p.hp = Math.min(p.maxHp, p.hp + TOWN_REGEN * STEP);
    else if (p.sinceHit > 5) p.hp = Math.min(p.maxHp, p.hp + (BASE_REGEN + p.stats.regen) * STEP);
  }

  p.cooldown = Math.max(0, p.cooldown - STEP);
  p.cooldownOff = Math.max(0, (p.cooldownOff ?? 0) - STEP);
  p.rollCooldown = Math.max(0, p.rollCooldown - STEP);

  const ui = state.ui;
  const toggle = (name) => {
    ui.panel = ui.panel === name ? null : name;
    if (ui.panel === 'inventory') { ui.mode = 'inventory'; ui.selected = null; }
    if (ui.panel === 'journal') { ensureTracked(state); ui.journalSel = p.tracked; ui.abandonArmed = null; }
    if (ui.panel === 'bestiary') {
      ui.bestiaryTab ??= 'monsters';
      ui.bestiarySel ??= entriesFor(state, ui.bestiaryTab)[0]?.id ?? null;
    }
    touch.releaseAll();
  };
  if (input.wasPressed('KeyK') || touch.pressed.has('skills')) toggle('skills');
  if (input.wasPressed('KeyI') || touch.pressed.has('bag')) toggle('inventory');
  if (input.wasPressed('KeyJ') || touch.pressed.has('journal')) toggle('journal');
  if (input.wasPressed('KeyM') || touch.pressed.has('map')) toggle('map');
  if (input.wasPressed('KeyN') || touch.pressed.has('bestiary')) toggle('bestiary');
  if (input.wasPressed('KeyB') || touch.pressed.has('boat')) {
    const { error } = toggleBoat(state, world);
    if (error) notify(state, ERROR_KEYS[error]);
    touch.releaseAll();
  }
  if (input.wasPressed('KeyE') || touch.pressed.has('talk')) {
    if (!ui.panel && state.nearDoor) {
      useDoor(state);
      touch.releaseAll();
    } else if (!ui.panel && state.nearNpc) {
      openNpc(state, state.nearNpc, state.town);
      touch.releaseAll();
    }
  }
  if (input.wasPressed('Escape')) {
    if (ui.dialog && ui.dialog.stage !== 'hub') ui.dialog.stage = 'hub'; // back to the start of the conversation
    else if (ui.panel) { ui.panel = null; ui.dialog = null; }
    else state.wantPause = true; // Escape with nothing open: the pause menu
  }
  if (touch.pressed.has('menu') && !ui.panel) state.wantPause = true;
  if (ui.panel === 'skills') handleSkillClicks(state, input);
  else if (ui.panel === 'inventory') handleInventoryClicks(state, input);
  else if (ui.panel === 'quests') handleQuestClicks(state, input);
  else if (ui.panel === 'journal') handleJournalClicks(state, input);
  else if (ui.panel === 'ending') handleEndingClicks(state, input);
  else if (ui.panel === 'map') handleMapClicks(state, input);
  else if (ui.panel === 'bestiary') handleBestiaryClicks(state, input);
  touch.blocked = ui.panel !== null;
  touch.talkVisible = !!(state.nearNpc || state.nearDoor) && !ui.panel;
  touch.boatVisible = !!state.boatHint && !ui.panel;

  if (ui.panel !== 'quests') state.weapons.forEach((w, i) => { // in a conversation, 1-3 are answers
    if (w && (input.wasPressed('Digit' + (i + 1)) || touch.pressed.has('slot' + i))) p.weapon = w; // an empty set does nothing
  });
  if (touch.pressed.has('swap')) { // the next set that holds a weapon
    const n = state.weapons.length;
    const at = state.weapons.indexOf(p.weapon);
    for (let k = 1; k < n; k++) {
      const w = state.weapons[(at + k) % n];
      if (w) { p.weapon = w; break; }
    }
  }

  if (p.rollTime > 0) {
    p.rollTime -= STEP;
    moveWithCollision(world, p, p.rollDir.x * ROLL_SPEED * STEP, p.rollDir.y * ROLL_SPEED * STEP);
  } else {
    let dx = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
    let dy = (input.isDown('KeyS') ? 1 : 0) - (input.isDown('KeyW') ? 1 : 0);
    let len = Math.hypot(dx, dy);
    if (len > 0) {
      dx /= len; dy /= len; len = 1;
    } else if (touch.move.x || touch.move.y) {
      // analog stick: vector length (0..1) scales the speed
      dx = touch.move.x; dy = touch.move.y; len = Math.hypot(dx, dy);
    }
    if (len > 0) p.facing = { x: dx / len, y: dy / len };
    const rollTapped = touch.pressed.has('roll');
    if ((input.wasPressed('Space') || rollTapped) && p.rollCooldown <= 0 && (len > 0 || rollTapped) && !p.boating) {
      p.rollTime = ROLL_TIME;
      p.rollCooldown = ROLL_COOLDOWN * (1 - p.stats.rollCooldown);
      p.rollDir = len > 0 ? { x: dx / len, y: dy / len } : p.facing;
    }
    const speed = SPEED * (1 + p.stats.moveSpeed) * (p.boating ? BOAT_SPEED : 1);
    (p.boating ? moveBoat : moveWithCollision)(world, p, dx * speed * STEP, dy * speed * STEP);
  }

  const aim = currentAim(state, input);
  if (aim) tryAttack(state, p, aim);
}

function handleSkillClicks(state, input) {
  const w = innerWidth;
  const h = innerHeight;
  const clicks = [...input.clicks, ...input.touch.taps.map((c) => ({ ...c, touch: true }))];
  for (const c of clicks) {
    if (hitClose(c.x, c.y, w, h)) {
      state.ui.panel = null;
      state.ui.selectedSkill = null;
      return;
    }
    const node = hitTest(state, c.x, c.y, w, h);
    if (!node) continue;
    // touch has no hover: first tap selects (shows tooltip), second tap learns
    if (c.touch && state.ui.selectedSkill !== node.id) state.ui.selectedSkill = node.id;
    else rankUp(state, node.id);
  }
}

const ERROR_KEYS = {
  full: 'err.full', gold: 'err.gold', max: 'err.max', limit: 'err.limit',
  noboat: 'err.noboat', nowater: 'err.nowater', noland: 'err.noland', indungeon: 'err.indungeon',
};

function handleInventoryClicks(state, input) {
  const clicks = [...input.clicks, ...input.touch.taps];
  for (const c of clicks) {
    const region = hitInventory(state, c.x, c.y, innerWidth, innerHeight);
    if (!region) continue;
    if (region.kind === 'close') {
      state.ui.panel = null;
      return;
    }
    const { error } = clickInventory(state, region);
    if (error && ERROR_KEYS[error]) notify(state, ERROR_KEYS[error]);
  }
  // the right mouse button, or a finger held on a cell: sell, buy, upgrade, put on or take off at once
  for (const c of [...input.rightClicks, ...input.touch.longPresses]) {
    const region = hitInventory(state, c.x, c.y, innerWidth, innerHeight);
    if (!region || region.kind === 'close') continue;
    const r = quickAction(state, region);
    if (r.error && ERROR_KEYS[r.error]) notify(state, ERROR_KEYS[r.error]);
    if (r.sold) state.floaters.push({ x: state.player.x, y: state.player.y - 40, text: t('shop.sold', { price: r.price }), color: '#ffd54f', t: 0, dur: 1.2 });
  }
}

// Talking to someone who gives quests: a conversation (ui/dialog-ui.js). Answers by mouse, touch or keys 1-6.
function handleQuestClicks(state, input) {
  const ui = state.ui;
  let pick = null;
  for (const c of [...input.clicks, ...input.touch.taps]) pick ??= hitDialog(state, c.x, c.y, innerWidth, innerHeight);
  (dialogView(state)?.options ?? []).forEach((o, i) => { if (input.wasPressed('Digit' + (i + 1))) pick = o; });
  if (pick) answerDialog(state, pick);
  if (!ui.dialog) ui.panel = null;
}

function answerDialog(state, o) {
  const ui = state.ui;
  const d = ui.dialog;
  if (!d) return;
  if (o.kind === 'close' || o.kind === 'bye') ui.dialog = null;
  else if (o.kind === 'ask') Object.assign(d, { id: o.id, status: 'available', stage: 'offer' });
  else if (o.kind === 'done') Object.assign(d, { id: o.id, status: 'complete', stage: 'offer' });
  else if (o.kind === 'job') Object.assign(d, { id: o.id, status: 'active', stage: 'offer' });
  else if (o.kind === 'place') {
    d.stage = 'place';
    const town = state.world.getTownById?.(ui.questTown);
    if (town && TELLERS.includes(ui.questNpc)) hearRumour(state, town, ui.questNpc, ui.rumour); // told: into the chronicle
  }
  else if (o.kind === 'more') d.stage = 'more';
  else if (o.kind === 'decline') {
    d.skipped.push(d.id);
    d.asked++;
    d.stage = 'declined';
  } else if (o.kind === 'accept') {
    const { error } = acceptQuest(state, d.id);
    if (error && ERROR_KEYS[error]) notify(state, ERROR_KEYS[error]);
    else d.asked++;
    d.stage = 'hub';
  } else if (o.kind === 'turnin') {
    if (turnIn(state, d.id, ui.questTown).ok) notify(state, 'quest.completed', '#ffd54f');
    d.stage = 'hub';
  } else if (o.kind === 'choose') { // a quest that ends with a choice: the answer is kept, and they react to it
    if (turnIn(state, d.id, ui.questTown, o.choice).ok) {
      notify(state, 'quest.completed', '#ffd54f');
      Object.assign(d, { stage: 'chosen', choice: o.choice });
    } else d.stage = 'hub';
  } else d.stage = 'hub'; // back
}

function handleMapClicks(state, input) {
  for (const c of [...input.clicks, ...input.touch.taps]) {
    if (hitMap(c.x, c.y, innerWidth)) {
      state.ui.panel = null;
      return;
    }
  }
}

function handleBestiaryClicks(state, input) {
  for (const c of [...input.clicks, ...input.touch.taps]) {
    const hit = hitBestiary(state, c.x, c.y, innerWidth, innerHeight);
    if (!hit) continue;
    if (hit.kind === 'close') {
      state.ui.panel = null;
      return;
    }
    clickBestiary(state, hit);
  }
}

// The console of the Ring: close it to think, or choose (once, for good).
function handleEndingClicks(state, input) {
  for (const c of [...input.clicks, ...input.touch.taps]) {
    const hit = hitEnding(c.x, c.y, innerWidth, innerHeight);
    if (hit?.kind === 'close') state.ui.panel = null;
    if (hit?.kind === 'choose' && chooseEnding(state, hit.choice)) state.banner = { key: `ending.${hit.choice}.banner`, t: 0 };
  }
}

function handleJournalClicks(state, input) {
  const clicks = [...input.clicks, ...input.touch.taps];
  for (const c of clicks) {
    const hit = hitJournal(state, c.x, c.y, innerWidth, innerHeight);
    if (!hit) continue;
    if (hit.kind === 'close') {
      state.ui.panel = null;
      return;
    }
    if (clickJournal(state, hit).abandoned) notify(state, 'journal.abandoned', '#ffab91');
  }
}

// The nearest monster the held weapon can actually hit (a sword cannot reach a flyer: do not aim at one).
function nearestEnemy(state, maxDist) {
  const p = state.player;
  let best = null;
  let bestD = maxDist;
  for (const e of state.enemies) {
    if (e.hp <= 0 || (isFlying(e) && p.weapon.reach !== 'both')) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < bestD) { best = e; bestD = d; }
  }
  return best;
}

// World-space point to attack this tick, or null when not attacking (also: no fighting inside towns).
function currentAim(state, input) {
  if (state.ui.panel || state.town) return null;
  const p = state.player;
  const a = input.touch.aim;
  if (a.active) {
    if (a.mag >= AIM_DRAG_MIN) {
      const reach = Math.max(60, p.weapon.range * Math.min(1, a.mag / 60));
      p.facing = { x: a.dx, y: a.dy };
      return { x: p.x + a.dx * reach, y: p.y + a.dy * reach };
    }
    // holding without dragging: auto-aim at the nearest enemy
    const target = nearestEnemy(state, AUTO_AIM_RANGE);
    if (target) return { x: target.x, y: bodyY(target) };
    return { x: p.x + p.facing.x * 100, y: p.y + p.facing.y * 100 };
  }
  if (input.mouse.down) {
    return {
      x: p.x + (input.mouse.x - innerWidth / 2),
      y: p.y + (input.mouse.y - innerHeight / 2),
    };
  }
  return null;
}

const randomSeed = () => 1 + Math.floor(Math.random() * (MAX_SEED - 1));

// ?seed=123 picks the world of a new game (handy for testing); otherwise every new game gets a random world.
function seedFromUrl() {
  const v = new URLSearchParams(location.search).get('seed');
  const n = Number(v);
  return v !== null && Number.isInteger(n) && n >= 0 && n <= MAX_SEED ? n : null;
}

// ?story=2, ?story=3 or ?story=ring starts a new game at that point of the story (for trying it out).
const storyFromUrl = () => new URLSearchParams(location.search).get('story');

// A random world whose start is not an island: it must lead to a big landmass with several towns.
function findGoodSeed(biomes) {
  let seed = randomSeed();
  for (let tries = 0; tries < 15; tries++) {
    if (goodStart(new World(seed, biomes))) return seed;
    seed = randomSeed();
  }
  return seed;
}

const fogEnabled = (settings) => settings.fog && !new URLSearchParams(location.search).has('nofog'); // ?nofog: debugging

// One play session: a world and everything in it. Made for "new game" and for "continue".
function createGame({ assets, seed, gen = MAP_GEN, saveData, settings, input }) {
  const { weapons, armor, accessories, questDefs, skillData, enemyDefs, bossDefs, dungeonDefs, ammoData, relicData } = assets;
  // the finite map (generator 4), or the endless world of the older generators (still there to try things on)
  const world = gen === MAP_GEN ? new MapWorld(seed, assets.biomes, assets.maps.main) : new World(seed, assets.biomes, gen);
  const spawn = world.findSpawn();
  // you start with a plain sword; the other five weapon sets are empty until you find, buy or earn something for them
  const hotbar = weapons.map((w, i) => (i === 0 ? buildItem('weapon', w, 'common') : null));
  const state = {
    seed,
    spawn,
    player: {
      ...spawn, weapon: hotbar[0], cooldown: 0, rollTime: 0, rollCooldown: 0, rollDir: { x: 0, y: 0 },
      hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP, hurt: 0, sinceHit: 99,
      level: 1, xp: 0, skillPoints: 0, ranks: {}, stats: null, facing: { x: 1, y: 0 },
      cooldownOff: 0, equipment: emptyEquipment(), gold: 0, quests: {}, tracked: null, boat: false, boating: false,
    },
    skills: skillData.nodes,
    skillBranches: skillData.branches,
    skillIndex: new Map(skillData.nodes.map((n) => [n.id, n])),
    questDefs: [...questDefs],
    questIndex: new Map(questDefs.map((q) => [q.id, q])),
    ui: {
      panel: null, bestiaryTab: 'monsters', bestiarySel: null, mode: 'inventory', selectedSkill: null, selected: null, questTown: null, dialog: null, journalSel: null, abandonArmed: null,
    },
    world,
    mouse: input.mouse,
    touch: input.touch,
    explored: new Explored(),
    discovered: new Set(),
    lastRevealTile: null,
    fog: fogEnabled(settings),
    wantPause: false,
    weapons: hotbar,
    inventory: emptyInventory(),
    catalog: { weapon: weapons, armor, accessory: accessories, ammo: ammoData.items, relic: relicData?.items ?? [] },
    relicSets: relicData?.sets ?? [], // relics of the old world (systems/relics.js)
    campDefs: assets.campDefs ?? [], // monster camps (systems/camps.js)
    camps: new Map(),
    clock: 0, // seconds of play
    ammoEffects: ammoData.effects,
    offhands: hotbar.map(() => null), // one off hand for each hotbar slot
    shops: new Map(),
    shop: null,
    town: null,
    townId: null,
    nearNpc: null,
    banner: null,
    enemies: [],
    enemyDefs,
    bossDefs,
    dungeonDefs,
    dungeonExplored: new Map(), // what you have seen of each dungeon: id -> Explored
    dungeonRuns: new Map(), // opened chests of each dungeon: id -> { opened: [chest numbers] }
    area: null, // null in the open world, or { kind: 'dungeon', ... } below ground
    overworld: null, // the open world put aside while you are in a dungeon
    chests: [],
    visible: null,
    nearDoor: null,
    boatHint: null,
    bestiary: { seen: new Set(), kills: new Map() },
    history: { learned: new Set(), averted: new Set(), found: new Set() }, // the chronicle (systems/history.js)
    ending: null, // the choice at the Ring: 'fold' | 'open' (systems/ring.js)
    lairs: new Map(), // lairs and dungeons whose boss was killed: id -> { respawn: seconds left }
    enemyProjectiles: [],
    questBoards: new Set(),
    drops: [],
    projectiles: [],
    effects: [],
    floaters: [],
    dead: false,
    deadTimer: 0,
    fps: 0,
  };
  // used by the save loader: an artifact's story from its id ("a:<town>"), made again from the seed
  state.resolveArtifact = (id) => {
    const town = world.getTownById(ARTIFACT_ID.exec(id)?.[1] ?? '');
    return town ? ownHistory(world, town, { bossDefs, dungeonDefs }).find((e) => e.artifact?.id === id)?.artifact ?? null : null;
  };
  for (const def of storyQuests(world, dungeonDefs)) { // the main story, act 2: placed in this world (systems/storyline.js)
    state.questDefs.push(def);
    state.questIndex.set(def.id, def);
  }
  state.ensureTownQuests = (town) => {
    if (state.questBoards.has(town.id)) return; // the board of a town is made once (route searches are not free)
    state.questBoards.add(town.id);
    for (const def of generateTownQuests(world, town, state.catalog, enemyDefs, seed, bossDefs, dungeonDefs)) {
      if (state.questIndex.has(def.id)) continue;
      state.questDefs.push(def);
      state.questIndex.set(def.id, def);
    }
  };
  // used by the save loader: rebuilds a generated quest from its id ("t:<cx>,<cy>:<n>")
  state.resolveQuest = (id) => {
    const m = GENERATED_ID.exec(id);
    const town = m && world.getTown(Number(m[1]), Number(m[2]));
    if (!town) return null;
    state.ensureTownQuests(town);
    return state.questIndex.get(id) ?? null;
  };
  input.touch.slotCount = hotbar.length;
  recalcStats(state);
  state.player.hp = state.player.maxHp;

  let loaded = false;
  if (saveData) {
    loaded = applySave(state, saveData, seed);
    const p = state.player;
    if (loaded && p.boating && !world.isSailable(p.x, p.y)) p.boating = false; // saved in a boat, but the water is gone
    if (loaded && !p.boating && !world.isWalkable(p.x, p.y)) {
      p.x = spawn.x;
      p.y = spawn.y;
    }
  }
  if (!loaded) { // a new game opens with how you got here (docs/prologue.md)
    state.note = { text: [0, 1, 2, 3].map((i) => t('intro.' + i)).join(' '), title: 'intro.title', t: 0, dur: 20 };
  }
  if (!saveData && startStory(state, storyFromUrl())) state.note = null; // a shortcut into the story
  updateExploration(state, world); // reveal the start; towns seen right now count as already discovered
  topUpEnemies(state, world, enemyDefs, 600, 1300, Math.random, 3); // a few wanderers about from the start

  return {
    state,
    world,
    seed,
    loaded,
    enemyDefs,
    timers: { acc: 0, frames: 0, fps: 0, save: 0, enemy: 0, prune: 0, recall: 0, look: 0 },
    save: () => writeSave(serializeState(state, seed)),
    onPickup: (item) => {
      state.floaters.push({
        x: state.player.x, y: state.player.y - 40, color: rarityById(item.rarity).color, t: 0, dur: 1.6,
        text: t('loot.pickup', { rarity: t('rarity.' + item.rarity), name: t(`${item.slot}.${item.id}`) }),
      });
    },
    onFull: () => notify(state, 'err.full'),
  };
}

function stepGame(game, input, dt) {
  const { state, timers } = game;
  timers.acc += dt;
  while (timers.acc >= STEP) {
    state.clock = (state.clock ?? 0) + STEP; // seconds of play (deeds take a while to get around: systems/deeds.js)
    updatePlayer(state, input, state.world);
    // read the world again: going through a door in updatePlayer swaps it, and the rest of the step must see the new one
    // (or a lair of the open world could wake up at your dungeon coordinates and follow you down)
    const world = state.world;
    updateEnemies(state, world, STEP);
    tickStatuses(state, STEP);
    updateEnemyProjectiles(state, world, STEP);
    updateLairs(state, world, STEP);
    updatePulse(state, world, STEP);
    updateFolk(state, world, STEP);
    updateCamps(state, world, STEP, state.campDefs);
    updateChests(state);
    updateProjectiles(state, STEP);
    updateDrops(state, STEP, game.onPickup, game.onFull);
    updateEffects(state, STEP);
    input.endFrame();
    timers.acc -= STEP;
    if (state.wantPause) break;
  }
  timers.frames++;
  timers.fps += dt;
  if (timers.fps >= 1) { state.fps = timers.frames; timers.frames = 0; timers.fps = 0; }
  timers.save += dt;
  if (timers.save > 10) { game.save(); timers.save = 0; }
  timers.enemy += dt;
  if (timers.enemy > ENEMY_TOP_UP_EVERY) {
    if (!state.area) { // wanderers come into the open world, not into dungeons (their monsters were placed in the rooms)
      cullFarEnemies(state);
      topUpEnemies(state, state.world, game.enemyDefs);
    }
    fadeCalm(state, timers.enemy);
    timers.enemy = 0;
  }
  if (state.banner) {
    state.banner.t += dt;
    if (state.banner.t > 3.5) state.banner = null;
  }
  // Notes come one at a time: one that arrives while another is still on screen waits its turn instead of replacing
  // it, and a note waits while a window covers it (it is drawn only when no window is open), so none goes unread.
  if (state.note !== timers.note) {
    const shown = timers.note;
    if (shown && state.note && shown.t < (shown.dur ?? NOTE_TIME)) {
      (state.noteQueue ??= []).push(state.note);
      if (state.noteQueue.length > 5) state.noteQueue.shift(); // a flood of notes: the oldest waiting ones give way
      state.note = shown;
    }
    timers.note = state.note;
  }
  if (!state.note && state.noteQueue?.length) timers.note = state.note = state.noteQueue.shift();
  if (state.note && !state.ui.panel) {
    state.note.t += dt;
    if (state.note.t > (state.note.dur ?? NOTE_TIME)) timers.note = state.note = null;
  }
  timers.look += dt;
  if (timers.look > 0.4) { // whatever is in view goes into the bestiary
    scanVisible(state, SIGHT_PX, TILE);
    timers.look = 0;
  }
  timers.recall += dt;
  if (timers.recall > 1) {
    recallBosses(state); // also covers quests accepted before this rule existed
    timers.recall = 0;
  }
  timers.prune += dt;
  if (timers.prune > 5) {
    state.world.pruneChunks(Math.floor(state.player.x / TILE / 32), Math.floor(state.player.y / TILE / 32));
    timers.prune = 0;
  }
}

async function main() {
  const canvas = document.getElementById('game');
  const settings = loadSettings();
  const [biomes, weapons, enemyDefs, skillData, armor, accessories, questDefs, bossDefs, dungeonDefs, ammoData, relicData, campDefs, mainMap] = await Promise.all([
    loadJson('data/biomes.json'),
    loadJson('data/weapons.json'),
    loadJson('data/enemies.json'),
    loadJson('data/skills.json'),
    loadJson('data/armor.json'),
    loadJson('data/accessories.json'),
    loadJson('data/quests.json'),
    loadJson('data/bosses.json'),
    loadJson('data/dungeons.json'),
    loadJson('data/ammo.json'),
    loadJson('data/relics.json'),
    loadJson('data/camps.json'),
    loadJson('data/maps/main.json'),
    loadLang(settings.lang),
  ]);
  const assets = { biomes, weapons, enemyDefs, skillData, armor, accessories, questDefs, bossDefs, dungeonDefs, ammoData, relicData, campDefs, maps: { main: mainMap } };
  const input = new Input(canvas);
  input.touch.setMode(settings.touch);
  const renderer = new Renderer(canvas);
  renderer.resize();
  addEventListener('resize', () => renderer.resize());

  if (new URLSearchParams(location.search).has('reset')) clearSave();
  const app = {
    game: null, // the running game, or null in the main menu
    paused: false,
    menu: newMenu('main'),
    settings,
    saveInfo: describeSave(loadSave()), // what Continue shows; null = no usable save
    notice: null,
    lastMouse: { x: -1, y: -1 },
    touchUi: false,
  };
  let shownLang = settings.lang;
  if (new URLSearchParams(location.search).has('debug')) globalThis.__app = app; // lets the smoke test reach into the game

  const say = (key) => { app.notice = { text: t(key), left: 2.5 }; };
  // clicks that start or resume a game must not turn into an attack
  const releaseInput = () => { input.mouse.down = false; input.touch.releaseAll(); };

  function startGame(game) {
    app.game = game;
    app.paused = false;
    app.menu = newMenu('pause');
    renderer.setWorld(game.world);
    releaseInput();
  }

  function openPause() {
    app.paused = true;
    app.menu = newMenu('pause');
    releaseInput();
  }

  async function perform({ action }) {
    switch (action) {
      case 'continue': {
        const data = loadSave();
        const seed = saveSeed(data);
        const game = seed === null ? null : createGame({ assets, seed, gen: saveGen(data), saveData: data, settings, input });
        if (!game?.loaded) { say('menu.badsave'); return; } // the save stays untouched
        startGame(game);
        break;
      }
      case 'new': {
        // the finite map; ?world=endless starts in the endless world instead (to try things on)
        const endless = new URLSearchParams(location.search).get('world') === 'endless';
        const seed = seedFromUrl() ?? (endless ? findGoodSeed(assets.biomes) : randomSeed());
        const game = createGame({ assets, seed, gen: endless ? WORLD_GEN : MAP_GEN, saveData: null, settings, input });
        game.save(); // the new game replaces the old save right away
        app.saveInfo = describeSave(loadSave());
        startGame(game);
        break;
      }
      case 'delete':
        clearSave();
        app.saveInfo = null;
        say('menu.deleted');
        break;
      case 'resume':
        app.paused = false;
        releaseInput();
        break;
      case 'save':
        app.game.save();
        say('menu.saved');
        break;
      case 'toMain':
        app.game.save();
        app.game = null;
        app.paused = false;
        app.menu = newMenu('main');
        app.saveInfo = describeSave(loadSave());
        renderer.setWorld(null);
        break;
      case 'settings':
        storeSettings(settings);
        input.touch.setMode(settings.touch);
        if (app.game) app.game.state.fog = fogEnabled(settings);
        if (settings.lang !== shownLang) {
          shownLang = settings.lang;
          await loadLang(settings.lang);
        }
        break;
      default:
    }
  }

  // Menu input: mouse/touch buttons, arrow keys + Enter, Escape. Runs on the main menu and while paused.
  function runMenu() {
    const menu = app.menu;
    const ctx = menuContext(app);
    const { items, rects } = layoutMenu(app, innerWidth, innerHeight);
    fixCursor(menu, items);
    input.touch.blocked = true; // touches only produce taps while a menu is open
    app.touchUi = input.touch.enabled;

    const m = input.mouse;
    if (m.x !== app.lastMouse.x || m.y !== app.lastMouse.y) {
      app.lastMouse = { x: m.x, y: m.y };
      const hover = hitMenu(rects, m.x, m.y);
      if (hover >= 0 && items[hover].enabled !== false) menu.cursor = hover;
    }

    let result = null;
    const clicks = [...input.clicks, ...input.touch.taps];
    const clicked = clicks.map((c) => hitMenu(rects, c.x, c.y)).find((i) => i >= 0);
    if (clicked !== undefined) { // the layout changes after a click, so only the first one counts
      menu.cursor = clicked;
      result = menuClick(menu, items[clicked].id, ctx);
    } else if (input.wasPressed('ArrowUp') || input.wasPressed('KeyW')) {
      menuMove(menu, items, -1);
    } else if (input.wasPressed('ArrowDown') || input.wasPressed('KeyS')) {
      menuMove(menu, items, 1);
    } else if (input.wasPressed('Enter') || input.wasPressed('Space')) {
      result = menuEnter(menu, ctx);
    } else if (input.wasPressed('Escape')) {
      result = menuEscape(menu);
    }
    input.endFrame();
    if (result) perform(result);
  }

  addEventListener('pagehide', () => app.game?.save());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden || !app.game) return;
    app.game.save();
    if (!app.paused) app.game.state.wantPause = true; // leaving the tab pauses the game
  });

  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (app.notice && (app.notice.left -= dt) <= 0) app.notice = null;

    if (!app.game || app.paused) runMenu(); // may start, resume or leave the game, so decide again below
    if (!app.game || app.paused) {
      if (app.game) renderer.draw(app.game.state, 0); // the frozen game behind the menu
      renderer.drawMenuScreen(app);
    } else {
      stepGame(app.game, input, dt);
      if (renderer.world !== app.game.state.world) renderer.setWorld(app.game.state.world); // went down or came up
      if (app.game.state.wantPause) {
        app.game.state.wantPause = false;
        openPause();
      }
      renderer.draw(app.game.state, dt);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main();
