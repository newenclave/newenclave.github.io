import { Input } from './core/input.js';
import { loadLang, t } from './core/i18n.js';
import { World, TILE, WORLD_GEN } from './world/world.js';
import { MapWorld, MAP_GEN, MAP_GENS } from './world/map.js';
import { goodStart } from './world/reach.js';
import { Renderer } from './render/renderer.js';
import { tryAttack, updateProjectiles, updateEffects, tickStatuses, moveFactor, tickPlayerCombat, regenMana } from './sim/combat.js';
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
import { buildWeb, learnPath, forget, respec, START } from './systems/skilltree.js';
import { baseAttrs, raiseAttr, CREATE_POINTS, ATTRS, newDraft, adjustDraft, finishCreation, entriesOf, toggleTraining } from './systems/attributes.js';
import { hitCharacter } from './ui/character-ui.js';
import { hitCreate } from './ui/create-ui.js';
import { emptyInventory, updateDrops, clickInventory, quickAction, dragItem } from './systems/inventory.js';
import { emptySets, nextSet, selectSet } from './systems/loadout.js';
import { openShop } from './systems/shop.js';
import { acceptQuest, turnIn, onVisit, clickJournal, ensureTracked, recallBosses, listForGiver, QUEST_ROLES } from './systems/quests.js';
import { generateTownQuests, townDifficulty, GENERATED_ID } from './systems/townquests.js';
import { Explored, updateExploration, discoverLairs, SIGHT_PX } from './systems/explore.js';
import { grantXp } from './systems/xp.js';
import { NOTE_TIME } from './systems/lore.js';
import { nextRumour, hearRumour, memorialsInRange, learn, ownHistory, ARTIFACT_ID } from './systems/history.js';
import { updatePulse } from './systems/pulse.js';
import { updateFolk } from './systems/townsfolk.js';
import { storyQuests } from './systems/storyline.js';
import { setupSideStories, placePeople, wildPeople, updateSideQuests, warded, raidsDue, untoldClosed, PERSON_REACH } from './systems/sidequests.js';
import { makeEnemy } from './sim/enemy.js';
import { chooseEnding } from './systems/ring.js';
import { startStory } from './systems/storystart.js';
import { emptyEquipment } from './systems/equipment.js';
import { identifyRelics } from './systems/relics.js';
import { hitEnding } from './ui/ending-ui.js';
import { inscription } from './ui/chronicle-ui.js';
import { hitWeb, webView, zoomAt, panBy, fitZoom } from './ui/skilltree-ui.js';
import { hitInventory, insideInventory } from './ui/inventory-ui.js';
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
import { enterArena, arenaAction, updateArena, ARENA_KEYS } from './systems/arena.js';
import { hitArena, overArenaPanel } from './ui/arena-ui.js';

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
  ui.talkNpc = npc;
  // a named merchant or smith talks only when there is something to talk about (a job, a job closed); else: the shop
  const trader = !!town && !QUEST_ROLES.includes(npc.id); // a merchant, a market trader or a smith in a town
  const talk = !trader || listForGiver(state, town.id, npc.person).length > 0 || untoldClosed(state, town.id, npc.person).length > 0;
  if (QUEST_ROLES.includes(npc.id) || (npc.person && talk)) { // a named person talks first (a merchant or a smith still trades)
    ui.panel = 'quests';
    ui.questTown = town?.id ?? npc.home;
    ui.questNpc = npc.person ?? npc.id;
    ui.rumour = TELLERS.includes(npc.id) && town ? nextRumour(state, state.world, town, npc.id) : null; // a piece of the town's past
    const h = state.history;
    if (npc.id === 'elder' && town?.id === '0,0' && (h.firstTalk ?? 0) < FIRST_TALKS) { // the first words you hear here
      ui.rumour = null;
      ui.firstTalk = h.firstTalk ?? 0;
      h.firstTalk = ui.firstTalk + 1;
    } else ui.firstTalk = null;
    ui.sayLine = Math.floor(Math.random() * SAY_LINES);
    openDialog(state);
    return;
  }
  openTrade(state, npc, town);
}

// The shop of a merchant or a market trader; the blacksmith upgrades.
function openTrade(state, npc, town) {
  const ui = state.ui;
  if (npc.id === 'merchant' || npc.id === 'trader') openShop(state, town, npc);
  ui.mode = npc.id === 'blacksmith' ? 'blacksmith' : 'merchant';
  ui.panel = 'inventory';
  ui.dialog = null;
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
  if (!town && !state.area) { // out in the wild: someone of a side story (systems/sidequests.js)
    placePeople(state, world);
    for (const n of wildPeople(state)) {
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d <= PERSON_REACH && (!near || d < near.d)) near = { n, d };
    }
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
      p.mana = p.maxMana;
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

  regenMana(p, STEP);
  p.cooldown = Math.max(0, p.cooldown - STEP);
  p.cooldownOff = Math.max(0, (p.cooldownOff ?? 0) - STEP);
  tickPlayerCombat(p, STEP);
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
  if (input.wasPressed('KeyC') || touch.pressed.has('hero')) toggle('hero');
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
  else if (ui.panel === 'hero') handleCharacterClicks(state, input);
  else if (ui.panel === 'inventory') handleInventoryClicks(state, input);
  else if (ui.panel === 'quests') handleQuestClicks(state, input);
  else if (ui.panel === 'journal') handleJournalClicks(state, input);
  else if (ui.panel === 'ending') handleEndingClicks(state, input);
  else if (ui.panel === 'map') handleMapClicks(state, input);
  else if (ui.panel === 'bestiary') handleBestiaryClicks(state, input);
  touch.blocked = ui.panel !== null;
  touch.talkVisible = !!(state.nearNpc || state.nearDoor) && !ui.panel;
  touch.boatVisible = !!state.boatHint && !ui.panel;

  if (ui.panel !== 'quests') { // in a conversation, 1-3 are answers
    state.weapons.forEach((w, i) => {
      if (input.wasPressed('Digit' + (i + 1)) || touch.pressed.has('slot' + i)) selectSet(state, i); // an empty set: fists
    });
    if (input.wasPressed('KeyQ') || touch.pressed.has('swap')) nextSet(state); // the next set round the circle
  }

  if (state.arena && !ui.panel) { // the test arena's keys and buttons (systems/arena.js)
    for (const [key, id] of Object.entries(ARENA_KEYS)) if (input.wasPressed(key)) arenaAction(state, id);
    for (const c of [...input.clicks, ...touch.taps]) {
      const id = hitArena(c.x, c.y);
      if (id) arenaAction(state, id);
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
    p.moveDir = len > 0 ? p.facing : null; // a blow in the back while running away dazes you
    const rollTapped = touch.pressed.has('roll');
    if ((input.wasPressed('Space') || rollTapped) && p.rollCooldown <= 0 && (len > 0 || rollTapped) && !p.boating) {
      p.rollTime = ROLL_TIME;
      p.rollCooldown = ROLL_COOLDOWN * (1 - p.stats.rollCooldown) * (p.stats.rules.includes('unshaken') ? 2 : 1); // the price of the unshaken
      p.rollDir = len > 0 ? { x: dx / len, y: dy / len } : p.facing;
    }
    const speed = SPEED * (1 + p.stats.moveSpeed) * (p.boating ? BOAT_SPEED : moveFactor(p, dx, dy)); // a blow slows you
    (p.boating ? moveBoat : moveWithCollision)(world, p, dx * speed * STEP, dy * speed * STEP);
  }

  const aim = currentAim(state, input);
  if (aim) tryAttack(state, p, aim);
}

// The skill web (ui/skilltree-ui.js): drag to look around, zoom with the wheel, two fingers or the buttons; a click on a
// skill learns the way to it (a tap shows it first, a second tap learns). In the arena, a right click gives one back.
function handleSkillClicks(state, input) {
  const w = innerWidth;
  const h = innerHeight;
  const v = webView(state, w, h);
  const touch = input.touch;
  // dragging: the mouse with its button held, or one finger
  const m = input.mouse;
  if (m.down && v.last) panBy(v, m.x - v.last.x, m.y - v.last.y);
  v.last = m.down ? { x: m.x, y: m.y } : null;
  if (touch.drag.dx || touch.drag.dy) panBy(v, touch.drag.dx, touch.drag.dy);
  if (touch.pinch !== 1) zoomAt(v, w, h, touch.pinch);
  if (input.wheel) zoomAt(v, w, h, Math.pow(1.15, -input.wheel), m.x, m.y);
  if (input.wasPressed('Equal') || input.wasPressed('NumpadAdd')) zoomAt(v, w, h, 1.25);
  if (input.wasPressed('Minus') || input.wasPressed('NumpadSubtract')) zoomAt(v, w, h, 0.8);
  const clicks = [...input.releases.filter((r) => !r.moved), ...touch.cleanTaps.map((c) => ({ ...c, touch: true }))];
  for (const c of clicks) {
    const hit = hitWeb(state, c.x, c.y, w, h);
    if (!hit) continue;
    if (hit.kind === 'button') {
      if (hit.id === 'close') {
        state.ui.panel = null;
        v.sel = null;
        return;
      }
      if (hit.id === 'zoomIn') zoomAt(v, w, h, 1.25);
      else if (hit.id === 'zoomOut') zoomAt(v, w, h, 0.8);
      else Object.assign(v, { x: 0, y: 0, zoom: fitZoom(w, h) });
      continue;
    }
    // touch has no hover: the first tap shows the skill, a second one learns it
    if (c.touch && v.sel !== hit.node.id) v.sel = hit.node.id;
    else learnPath(state, hit.node.id);
  }
  if (state.arena) { // the test arena: give a skill back
    for (const c of [...input.rightClicks, ...touch.longPresses]) {
      const hit = hitWeb(state, c.x, c.y, w, h);
      if (hit?.kind === 'node') forget(state, hit.node.id);
    }
  }
}

function handleCharacterClicks(state, input) {
  const clicks = [...input.clicks, ...input.touch.taps];
  for (const c of clicks) {
    const hit = hitCharacter(state, c.x, c.y, innerWidth, innerHeight);
    if (!hit) continue;
    if (hit.kind === 'close') {
      state.ui.panel = null;
      return;
    }
    state.ui.selectedAttr = hit.id; // touch has no hover: a tap on a row shows what it does
    if (hit.kind === 'plus') raiseAttr(state, hit.id);
  }
}

// The hero-making screen: - and + (or the arrow keys) move points, Reset starts over, Begin (or Enter) starts the game.
function handleCreate(state, input) {
  const ui = state.ui;
  const draft = ui.create;
  input.touch.blocked = true;
  const at = ATTRS.indexOf(draft.sel);
  if (input.wasPressed('ArrowUp')) draft.sel = ATTRS[(at + ATTRS.length - 1) % ATTRS.length];
  if (input.wasPressed('ArrowDown')) draft.sel = ATTRS[(at + 1) % ATTRS.length];
  if (input.wasPressed('ArrowLeft') || input.wasPressed('Minus')) adjustDraft(draft, draft.sel, -1);
  if (input.wasPressed('ArrowRight') || input.wasPressed('Equal')) adjustDraft(draft, draft.sel, 1);
  let begin = input.wasPressed('Enter');
  for (const c of [...input.clicks, ...input.touch.taps]) {
    const hit = hitCreate(c.x, c.y, innerWidth, innerHeight, entriesOf(state.web));
    if (!hit) continue;
    if (hit.kind === 'minus') adjustDraft(draft, hit.id, -1);
    else if (hit.kind === 'plus') adjustDraft(draft, hit.id, 1);
    else if (hit.kind === 'row') draft.sel = hit.id;
    else if (hit.kind === 'train') toggleTraining(draft, hit.id);
    else if (hit.kind === 'reset') ui.create = newDraft();
    else if (hit.kind === 'begin') begin = true;
  }
  if (!begin) return;
  finishCreation(state, ui.create);
  ui.panel = null;
  ui.create = null;
  state.note = ui.afterCreate ?? null; // and now, how you got here
  ui.afterCreate = null;
  input.touch.releaseAll();
}

const ERROR_KEYS = {
  full: 'err.full', gold: 'err.gold', max: 'err.max', limit: 'err.limit',
  noboat: 'err.noboat', nowater: 'err.nowater', noland: 'err.noland', indungeon: 'err.indungeon',
  fit: 'err.fit', req: 'err.req', twoHanded: 'err.twoHanded', ammoKind: 'err.ammoKind',
};

// The inventory window (ui/inventory-ui.js). A drag carries a thing from one place to another (off the window: to the
// ground); a click or a tap that did not move selects, and a second one on the same thing puts it on.
function handleInventoryClicks(state, input) {
  const W = innerWidth;
  const H = innerHeight;
  state.ui.drag = input.dragNow();
  for (const d of input.drops()) {
    const from = hitInventory(state, d.x0, d.y0, W, H);
    if (!from || from.kind === 'close') continue;
    const out = !insideInventory(d.x, d.y, W, H);
    const to = out ? null : hitInventory(state, d.x, d.y, W, H);
    if (!out && (!to || to.kind === 'close')) continue; // let go on nothing: it stays where it was
    const r = dragItem(state, from, to);
    if (r.error && ERROR_KEYS[r.error]) notify(state, ERROR_KEYS[r.error]);
    if (r.sold) state.floaters.push({ x: state.player.x, y: state.player.y - 40, text: t('shop.sold', { price: r.price }), color: '#ffd54f', t: 0, dur: 1.2 });
  }
  const clicks = [...input.releases.filter((c) => !c.moved), ...input.touch.cleanTaps];
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
  else if (o.kind === 'trade' && ui.talkNpc) openTrade(state, ui.talkNpc, state.town);
  else if (o.kind === 'respec') d.stage = 'respec';
  else if (o.kind === 'respecYes') d.stage = respec(state).ok ? 'respecDone' : 'respecPoor';
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
  if (input.mouse.down && !(state.arena && overArenaPanel(input.mouse.x, input.mouse.y))) {
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
function createGame({ assets, seed, gen = MAP_GEN, saveData, settings, input, arena = false }) {
  const { weapons, armor, accessories, questDefs, skillData, enemyDefs, bossDefs, dungeonDefs, ammoData, relicData } = assets;
  // the finite map (generator 4), or the endless world of the older generators (still there to try things on)
  // (a save from before the relief keeps its flat map: generator 4)
  const world = MAP_GENS.includes(gen) ? new MapWorld(seed, assets.biomes, assets.maps.main, gen) : new World(seed, assets.biomes, gen);
  const spawn = world.findSpawn();
  // you start with a plain sword; the other weapon sets are empty until you find, buy or earn something for them
  const hotbar = emptySets();
  hotbar[0] = buildItem('weapon', weapons[0], 'common');
  const state = {
    seed,
    spawn,
    player: {
      ...spawn, weapon: hotbar[0], cooldown: 0, rollTime: 0, rollCooldown: 0, rollDir: { x: 0, y: 0 },
      hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP, hurt: 0, sinceHit: 99,
      level: 1, xp: 0, skillPoints: 0, learned: new Set([START]), stats: null, facing: { x: 1, y: 0 },
      attrs: baseAttrs(), attrPoints: CREATE_POINTS, // the seven attributes (systems/attributes.js)
      cooldownOff: 0, equipment: emptyEquipment(), gold: 0, quests: {}, tracked: null, boat: false, boating: false,
      items: {}, // things carried for quests (systems/sidequests.js)
    },
    attrDefs: assets.attrDefs ?? [],
    builds: assets.builds ?? null, // ready heroes for the test arena (data/builds.json)
    web: buildWeb(skillData), // the skill web (systems/skilltree.js)
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
    activeSet: 0, // the weapon set in your hands (systems/loadout.js)
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
  // the side stories: named people, quests to find, gather and carry things (systems/sidequests.js)
  for (const def of setupSideStories(state, world, assets.sideStories)) {
    state.questDefs.push(def);
    state.questIndex.set(def.id, def);
  }
  placePeople(state, world);
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
  if (arena) enterArena(state); // the test arena (systems/arena.js): no prologue, no wanderers, never saved
  else if (!loaded) { // a new game: first you make the hero (ui/create-ui.js), then how you got here (docs/prologue.md)
    state.ui.panel = 'create';
    state.ui.create = newDraft();
    state.ui.afterCreate = { text: [0, 1, 2, 3].map((i) => t('intro.' + i)).join(' '), title: 'intro.title', t: 0, dur: 20 };
  }
  if (!saveData && startStory(state, storyFromUrl())) { // a shortcut into the story: no hero to make, no prologue
    state.note = null;
    state.ui.panel = null;
    state.ui.create = null;
  }
  if (!arena) {
    updateExploration(state, world); // reveal the start; towns seen right now count as already discovered
    topUpEnemies(state, world, enemyDefs, 600, 1300, Math.random, 3); // a few wanderers about from the start
  }

  return {
    state,
    world,
    seed,
    loaded,
    enemyDefs,
    timers: { acc: 0, frames: 0, fps: 0, save: 0, enemy: 0, prune: 0, recall: 0, look: 0 },
    save: arena ? () => {} : () => writeSave(serializeState(state, seed)),
    onPickup: (item) => {
      state.floaters.push({
        x: state.player.x, y: state.player.y - 40, color: rarityById(item.rarity).color, t: 0, dur: 1.6,
        text: t('loot.pickup', { rarity: t('rarity.' + item.rarity), name: t(`${item.slot}.${item.id}`) }),
      });
    },
    onFull: () => notify(state, 'err.full'),
  };
}

// Side quests: reaching what you look for, picking what you gather, quests that just closed.
function stepSideQuests(state) {
  const p = state.player;
  const { ready, found } = updateSideQuests(state);
  for (const f of found) {
    const def = state.questIndex.get(f.id);
    const e = state.player.quests[f.id];
    const text = f.gather ? `${t('quest.' + f.id + '.title')} ${e.progress}/${def.count}` : t('quest.found');
    state.floaters.push({ x: f.x, y: f.y - 30, text, color: '#c5e1a5', t: 0, dur: 1.6 });
    const item = [def.gives].flat()[0];
    if (!f.gather && item && t(`item.${item}.found`) !== `item.${item}.found`) { // what you see when you find it, and what it is
      state.note = { text: `${t(`item.${item}.found`)}\n\n${t(`item.${item}.name`)}: ${t(`item.${item}.desc`)}`, title: 'quest.' + f.id + '.title', t: 0, dur: 12 };
    }
    if (def.person && !state.ui.panel) { // a person you were looking for: they speak first
      const who = state.people?.get(def.person);
      if (who) openNpc(state, who, null);
    }
  }
  for (const { raid, spot } of raidsDue(state)) { // what comes for a place that lost its ward
    const def = state.enemyDefs.find((d) => d.id === raid.enemy);
    if (!def) continue;
    const a = Math.atan2(spot.py - p.y, spot.px - p.x); // from the far side of the place, out of the trees
    for (let k = 0; k < raid.count; k++) {
      const b = a + (k - (raid.count - 1) / 2) * 0.5;
      const x = spot.px + Math.cos(b) * (spot.r + 6) * TILE;
      const y = spot.py + Math.sin(b) * (spot.r + 6) * TILE;
      if (!state.world.isWalkable(x, y)) continue;
      const e = makeEnemy(def, x, y, state.world.tierAt?.(Math.floor(x / TILE), Math.floor(y / TILE)) ?? 0);
      e.raid = raid.spot;
      e.home = { x: spot.px + Math.cos(b) * 3 * TILE, y: spot.py + Math.sin(b) * 3 * TILE + 2 * TILE }; // at the step
      state.enemies.push(e);
    }
  }
  for (const id of ready) state.floaters.push({ x: p.x, y: p.y - 60, key: 'quest.ready', questId: id, color: '#9ccc65', t: 0, dur: 2.2 });
  for (const id of state.closedNow ?? []) {
    state.floaters.push({ x: p.x, y: p.y - 80, text: t('quest.closed', { title: t('quest.' + id + '.title') }), color: '#ef9a9a', t: 0, dur: 3.2 });
  }
  state.closedNow = null;
}

// A ward (a warm stone under a farm's step) keeps its monsters out: one that wanders in is turned back at the edge.
function keepOffWards(state) {
  if (!state.wards?.length || state.area) return;
  for (const e of state.enemies) {
    const s = warded(state, e.x, e.y, e.def?.id);
    if (!s) continue;
    const w = state.wards.find((x) => x.spot === s.id);
    const d = Math.hypot(e.x - s.px, e.y - s.py) || 1;
    const R = w.r * TILE;
    e.x = s.px + ((e.x - s.px) / d) * R;
    e.y = s.py + ((e.y - s.py) / d) * R;
    if (e.home && Math.hypot(e.home.x - s.px, e.home.y - s.py) < R) e.home = { x: e.x, y: e.y };
    if (e.mode === 'chase') { e.mode = 'return'; e.atk = null; }
  }
}

function stepGame(game, input, dt) {
  const { state, timers } = game;
  timers.acc += dt;
  while (timers.acc >= STEP) {
    if (state.ui.panel === 'create') { // making the hero: the world waits
      handleCreate(state, input);
      input.endFrame();
      timers.acc -= STEP;
      continue;
    }
    state.clock = (state.clock ?? 0) + STEP; // seconds of play (deeds take a while to get around: systems/deeds.js)
    updatePlayer(state, input, state.world);
    // read the world again: going through a door in updatePlayer swaps it, and the rest of the step must see the new one
    // (or a lair of the open world could wake up at your dungeon coordinates and follow you down)
    const world = state.world;
    updateEnemies(state, world, STEP);
    keepOffWards(state);
    stepSideQuests(state);
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
    updateArena(state, STEP);
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
  const settings = loadSettings(undefined, navigator.languages ?? [navigator.language]); // a Russian browser starts in Russian
  const [biomes, weapons, enemyDefs, skillData, armor, accessories, questDefs, bossDefs, dungeonDefs, ammoData, relicData, campDefs, mainMap, sideStories, attrDefs, builds] = await Promise.all([
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
    loadJson('data/sidestories.json'),
    loadJson('data/attributes.json'),
    loadJson('data/builds.json'),
    loadLang(settings.lang),
  ]);
  const assets = { biomes, weapons, enemyDefs, skillData, armor, accessories, questDefs, bossDefs, dungeonDefs, ammoData, relicData, campDefs, maps: { main: mainMap }, sideStories, attrDefs, builds };
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
      case 'arena': {
        const game = createGame({ assets, seed: randomSeed(), saveData: null, settings, input, arena: true });
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

  if (new URLSearchParams(location.search).has('arena')) perform({ action: 'arena' }); // ?arena: straight into the test arena

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
