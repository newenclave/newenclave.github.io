import { TILE, CHUNK, BIOME_IDS, TOWN_RADIUS_PX } from '../world/world.js';
import { listForGiver, activeQuests, trackedWaypoint, guideWaypoint, mainStepWaypoint, isMain, QUEST_ROLES } from '../systems/quests.js';
import { questTitle, objectiveText, questArgs } from '../ui/quest-ui.js';
import { drawDialog } from '../ui/dialog-ui.js';
import { artName } from '../ui/chronicle-ui.js';
import { drawJournal } from '../ui/journal-ui.js';
import { drawBestiary } from '../ui/bestiary-ui.js';
import { isFlying, bodyY } from '../sim/entity.js';
import { BITE_ARC } from '../sim/enemy.js';
import { WorldMapView } from '../ui/map-ui.js';
import { sightOf } from '../systems/explore.js';
import { wearsEffect, setDone } from '../systems/relics.js';
import { lairsInRange, LAIR_RADIUS } from '../systems/lairs.js';
import { tierAtPx, MAX_TIER } from '../systems/difficulty.js';
import { entrancesInRange } from '../systems/dungeons.js';
import { valleysInRange } from '../world/valleys.js';
import { memorialsInRange } from '../systems/history.js';
import { PULSE_WAVE } from '../systems/pulse.js';
import { campsInRange, campResting } from '../systems/camps.js';
import { wildPeople, gatherPoints } from '../systems/sidequests.js';
import { ringSite, consoleOpen } from '../systems/ring.js';
import { drawEnding } from '../ui/ending-ui.js';
import { mmss, wrapText } from '../core/format.js';
import { NOTE_TIME } from '../systems/lore.js';
import { hash2 } from '../core/rng.js';
import { t } from '../core/i18n.js';
import { rarityById } from '../sim/loot.js';
import { xpToNext } from '../systems/xp.js';
import { drawSkillTree } from '../ui/skilltree-ui.js';
import { drawInventory } from '../ui/inventory-ui.js';
import { drawTouchControls } from '../ui/touch-ui.js';
import { drawArenaPanel } from '../ui/arena-ui.js';
import { drawCharacter } from '../ui/character-ui.js';
import { drawCreate } from '../ui/create-ui.js';
import { canUse } from '../systems/requirements.js';
import { drawMenu, drawMenuBackground } from '../ui/menu-ui.js';
import { hotbarLayout } from '../core/touch.js';
import { loadoutOf, slotOf, FISTS } from '../systems/loadout.js';
import { drawSprite, drawEnemySprite, enemyScale, pose } from './sprites.js';
import { drawItemIcon } from './icons.js';

const CHUNK_PX = TILE * CHUNK;
// Who wears what: the sprite of each townsperson and the colours of their clothes (A: an apron), hair (h).
const NPC_LOOKS = {
  merchant: ['villager', { T: '#ffb74d', A: '#e8dcc0', h: '#2b1a10' }],
  blacksmith: ['villager', { T: '#90a4ae', A: '#4e342e', h: '#1b1622' }],
  elder: ['robe', { T: '#ba68c8' }],
  priest: ['robe', { T: '#eceff1' }],
  innkeeper: ['villager', { T: '#a1887f', A: '#f4f1e8', h: '#c0662b' }],
  captain: ['guard', { T: '#e53935' }],
  chronicler: ['robe', { T: '#4db6ac' }],
  ruler: ['royal', { T: '#ffd700' }],
  trader: ['villager', { T: '#ffcc80', A: '#8d6e63', h: '#6d4c41' }],
};
const HAIR = ['#5b3a24', '#2b1a10', '#c0662b', '#d9b26a', '#8a8a8a', '#1b1622'];
const DROP_ICONS = { armor: 'armor', accessory: 'amulet', ammo: 'quiver' };
// Roofs by the land a town stands in: red tiles on grass, wooden shingles in forests, pale flat roofs in the desert,
// dark timber in the snow.
const ROOFS = {
  grass: ['#8d4a3a', '#a0603c', '#6e4b3a', '#7d5a50', '#9e5b4b', '#5d4037'],
  beach: ['#a0603c', '#b0775a', '#8d4a3a', '#9e7b5b', '#7d5a50', '#c08a62'],
  forest: ['#5d4037', '#6d4c41', '#4e342e', '#795548', '#5b4a3a', '#6a5a44'],
  desert: ['#d8c39a', '#cdb489', '#e0cfa8', '#c9a878', '#d4b98e', '#bfa27a'],
  snow: ['#3e3a40', '#4a4046', '#37474f', '#4e4448', '#3b3f46', '#504a4e'],
};
const SHOP_ROOFS = { merchant: '#b26a2e', blacksmith: '#546e7a', elder: '#7b4f8a', priest: '#cfd8dc', innkeeper: '#8d6e63', chronicler: '#00695c', castle: '#455a64' };
const STALL_COLORS = ['#e53935', '#1e88e5', '#fdd835', '#43a047'];
const FOLK_COLORS = ['#8d6e63', '#5c6bc0', '#7cb342', '#d84315', '#6d4c41', '#00897b'];
// A boss with a name: "Skraix, Slime King".
const named = (name, kind) => (name ? t('boss.named', { name, kind }) : kind);
const bossLabel = (e) => named(e.name, t('bestiary.name.' + e.def.id));

// Which way someone faces (fx, fy) and how far they have walked (for the step of their walk), from how they moved
// since the last frame. face, when given, decides the facing instead (the hero looks where they aim, a hunter at its
// prey, a townsperson at you). Everyone starts facing you, down the screen.
const motion = new WeakMap();
function stepOf(o, face) {
  let m = motion.get(o);
  if (!m) motion.set(o, (m = { x: o.x, y: o.y, fx: 0, fy: 1, dist: 0, moving: false }));
  const dx = o.x - m.x;
  const dy = o.y - m.y;
  const d = Math.hypot(dx, dy);
  if (d < 60) m.dist += d; // a jump (a door, a new area) is not a step
  if (face && Math.hypot(face.x, face.y) > 0.01) {
    m.fx = face.x;
    m.fy = face.y;
  } else if (!face && d > 0.3 && d < 60) {
    m.fx = dx;
    m.fy = dy;
  }
  m.moving = d > 0.2 && d < 60;
  m.x = o.x;
  m.y = o.y;
  return m;
}
const walkFrame = (m, stride = 10) => (m.moving ? Math.floor(m.dist / stride) : 0);

// Details drawn over the plain colour of a tile (x, y: its top left corner in the chunk canvas; h: a random number of
// the tile; near(dx, dy): the name of a neighbouring tile).
const GROUND_DETAIL = {
  road(g, x, y, h) {
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(x + 6 + h * 16, y + 8 + ((h * 7) % 1) * 14, 3, 3);
  },
  bridge(g, x, y, h, near) {
    const across = near(-1, 0) === 'river' || near(1, 0) === 'river' || near(-1, 0) === 'chasm' || near(1, 0) === 'chasm';
    g.strokeStyle = 'rgba(0,0,0,0.35)'; // planks run across the gap
    g.lineWidth = 1;
    for (let k = 4; k < TILE; k += 7) {
      g.beginPath();
      if (across) { g.moveTo(x + k, y); g.lineTo(x + k, y + TILE); } else { g.moveTo(x, y + k); g.lineTo(x + TILE, y + k); }
      g.stroke();
    }
  },
  river(g, x, y, h) {
    g.strokeStyle = 'rgba(255,255,255,0.35)'; // white water
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x + 4 + h * 10, y + 8 + h * 12);
    g.lineTo(x + 14 + h * 10, y + 6 + h * 12);
    g.stroke();
  },
  chasm(g, x, y, h, near) {
    g.fillStyle = '#3a3036'; // crumbling rim where the ground ends
    if (near(0, -1) !== 'chasm') g.fillRect(x, y, TILE, 6);
    g.fillStyle = 'rgba(80,60,70,0.5)';
    if (near(-1, 0) !== 'chasm') g.fillRect(x, y, 3, TILE);
    if (near(1, 0) !== 'chasm') g.fillRect(x + TILE - 3, y, 3, TILE);
  },
  cliff(g, x, y, h, near) {
    g.fillStyle = 'rgba(255,255,255,0.12)'; // lit top of the rock
    if (near(0, -1) !== 'cliff') g.fillRect(x, y, TILE, 7);
    g.fillStyle = 'rgba(0,0,0,0.35)'; // its shadowed face
    if (near(0, 1) !== 'cliff') g.fillRect(x, y + TILE - 9, TILE, 9);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(x + 4 + h * 18, y + 10 + h * 8, 6, 4);
  },
  town_wall(g, x, y) {
    g.strokeStyle = 'rgba(0,0,0,0.3)'; // big stone blocks
    g.lineWidth = 1;
    g.strokeRect(x + 0.5, y + 0.5, TILE / 2, TILE / 2);
    g.strokeRect(x + TILE / 2 + 0.5, y + TILE / 2 + 0.5, TILE / 2 - 1, TILE / 2 - 1);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(x, y, TILE, 4);
  },
  yard(g, x, y, h) {
    if (h < 0.25) drawSprite(g, h < 0.08 ? 'tree' : 'bush', x + 16, y + 16); // a bush or a small tree in the garden
  },
  house() {}, // the roof is drawn over it with the town
  palisade(g, x, y) {
    g.fillStyle = 'rgba(0,0,0,0.3)'; // upright logs with pointed tops
    for (let k = 0; k < TILE; k += 8) g.fillRect(x + k + 6, y, 2, TILE);
    g.fillStyle = 'rgba(255,255,255,0.1)';
    g.fillRect(x, y, TILE, 3);
  },
  mountain(g, x, y, h, near) { // rock: lit along the top, in shadow below, cracks and boulders, snow on the high ones
    g.fillStyle = 'rgba(255,255,255,0.10)';
    g.fillRect(x + 2 + Math.floor(h * 12), y + 4, 10, 2);
    g.fillRect(x + 14 + Math.floor(h * 8), y + 16, 8, 2);
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.fillRect(x + 4 + Math.floor(h * 14), y + 10, 2, 8);
    g.fillRect(x + 18, y + 22 + Math.floor(h * 4), 10, 4);
    if (near(0, -1) !== 'mountain') { g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x, y, TILE, 4); }
    if (near(0, 1) !== 'mountain') { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x, y + TILE - 8, TILE, 8); }
    if (h > 0.82) { g.fillStyle = 'rgba(240,244,248,0.85)'; g.fillRect(x + 8, y + 6, 12, 4); g.fillRect(x + 10, y + 4, 8, 2); }
  },
  ford(g, x, y, h) { // shallows: ripples and stepping stones
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(x + 4, y + 8 + Math.floor(h * 6), 10, 2);
    g.fillRect(x + 16, y + 20, 10, 2);
    g.fillStyle = '#8d8a84';
    g.fillRect(x + 6 + Math.floor(h * 14), y + 14, 6, 4);
    g.fillRect(x + 20 - Math.floor(h * 10), y + 26, 4, 4);
  },
  field(g, x, y, h) {
    g.fillStyle = h < 0.5 ? 'rgba(80,60,20,0.25)' : 'rgba(60,90,20,0.25)'; // furrows, ploughed or green
    for (let k = 3; k < TILE; k += 8) g.fillRect(x, y + k, TILE, 3);
  },
};

// A weapon the hero is not up to yet (systems/requirements.js): a red cross over its slot.
function unusable(ctx, x, y, w, h) {
  ctx.save();
  ctx.fillStyle = 'rgba(120,0,0,0.35)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#ef5350';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + 4, y + 4); ctx.lineTo(x + w - 4, y + h - 4);
  ctx.moveTo(x + w - 4, y + 4); ctx.lineTo(x + 4, y + h - 4);
  ctx.stroke();
  ctx.restore();
}


// The relief of one tile (world/mapgen/relief.js), drawn over its ground in the chunk picture. Seen from above and a
// little from the south: where the ground below is lower, the tile ends in a rock face; the north edge of a raised tile
// catches the light, its east and west edges are dark lines; a tile at the foot of a cliff lies in its shadow. A ramp
// has steps going down to the lower side and no face.
const SIDES = [[0, 1], [1, 0], [-1, 0], [0, -1]]; // south, east, west, north
function drawRelief(g, world, tx, ty, px, py) {
  const lv = world.heightAt(tx, ty);
  if (lv >= 4 || BIOME_IDS[world.tileAt(tx, ty)] === 'water') return;
  const ground = (dx, dy) => {
    const n = BIOME_IDS[world.tileAt(tx + dx, ty + dy)];
    return n !== 'water' && n !== 'mountain';
  };
  const nl = (dx, dy) => world.heightAt(tx + dx, ty + dy);
  const ramp = world.isRamp(tx, ty);
  const T = TILE;
  if (ramp) { // steps down towards the lower neighbour
    const side = SIDES.find(([dx, dy]) => ground(dx, dy) && nl(dx, dy) === lv - 1);
    if (side) {
      const [dx, dy] = side;
      for (let i = 0; i < 4; i++) {
        const t = (i + 1) / 4; // 0 at the top of the ramp, 1 at its foot
        g.fillStyle = `rgba(0,0,0,${0.05 + 0.08 * t})`;
        if (dy) g.fillRect(px, dy > 0 ? py + i * 8 + 6 : py + T - i * 8 - 8, T, 2);
        else g.fillRect(dx > 0 ? px + i * 8 + 6 : px + T - i * 8 - 8, py, 2, T);
      }
    }
    return;
  }
  // a face down to the south
  if (ground(0, 1) && nl(0, 1) < lv && !world.isRamp(tx, ty + 1)) {
    const F = Math.min(14, 6 + 4 * (lv - nl(0, 1)));
    g.fillStyle = 'rgba(38,30,26,0.78)';
    g.fillRect(px, py + T - F, T, F);
    g.fillStyle = 'rgba(255,255,255,0.16)'; // the lip
    g.fillRect(px, py + T - F, T, 2);
    g.fillStyle = 'rgba(0,0,0,0.3)'; // cracks
    const h = hash2(tx, ty, 9907);
    g.fillRect(px + 4 + Math.floor(h * 10), py + T - F + 3, 2, F - 4);
    g.fillRect(px + 18 + Math.floor(h * 97 % 10), py + T - F + 5, 2, F - 6);
  }
  if (ground(0, -1) && nl(0, -1) < lv && !world.isRamp(tx, ty - 1)) { // the north edge in the light
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(px, py, T, 3);
  }
  if (ground(1, 0) && nl(1, 0) < lv && !world.isRamp(tx + 1, ty)) {
    g.fillStyle = 'rgba(0,0,0,0.32)';
    g.fillRect(px + T - 3, py, 3, T);
  }
  if (ground(-1, 0) && nl(-1, 0) < lv && !world.isRamp(tx - 1, ty)) {
    g.fillStyle = 'rgba(0,0,0,0.2)';
    g.fillRect(px, py, 3, T);
  }
  // at the foot of a cliff: in its shadow
  if (nl(0, -1) > lv && nl(0, -1) < 4 && !world.isRamp(tx, ty - 1)) {
    for (const [o, a] of [[0, 0.26], [3, 0.16], [6, 0.08]]) {
      g.fillStyle = `rgba(0,0,0,${a})`;
      g.fillRect(px, py + o, T, 3);
    }
  }
  if (nl(-1, 0) > lv && nl(-1, 0) < 4 && !world.isRamp(tx - 1, ty)) {
    g.fillStyle = 'rgba(0,0,0,0.14)';
    g.fillRect(px, py, 4, T);
  }
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = null;
    this.mini = document.createElement('canvas');
    this.mini.width = this.mini.height = 160;
    this.dpr = window.devicePixelRatio || 1;
    this.setWorld(null);
  }

  // The renderer outlives games: every new or loaded game brings its own world.
  setWorld(world) {
    this.world = world;
    this.mapView = world ? new WorldMapView(world) : null;
    this.fog = null; // small canvas, one pixel per tile, stretched over the screen for soft edges
    this.miniTimer = 0;
  }

  // Menu on top of the dimmed game (paused) or on its own background (main menu).
  drawMenuScreen(app) {
    const { ctx, canvas, dpr } = this;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (app.game) {
      ctx.fillStyle = 'rgba(5,8,16,0.72)';
      ctx.fillRect(0, 0, w, h);
    } else {
      drawMenuBackground(ctx, w, h, performance.now());
    }
    drawMenu(ctx, app, w, h);
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(innerWidth * dpr);
    this.canvas.height = Math.floor(innerHeight * dpr);
    this.dpr = dpr;
  }

  chunkCanvas(chunk) {
    if (chunk.canvas) return chunk.canvas;
    const c = document.createElement('canvas');
    c.width = c.height = CHUNK_PX;
    const g = c.getContext('2d');
    const relief = !!this.world.map?.height; // a map with levels of height (world/mapgen/relief.js)
    for (let y = 0; y < CHUNK; y++) {
      for (let x = 0; x < CHUNK; x++) {
        const id = chunk.tiles[y * CHUNK + x];
        const name = BIOME_IDS[id];
        g.fillStyle = this.world.biomes[name].color;
        g.fillRect(x * TILE, y * TILE, TILE, TILE);
        if (relief) { // higher ground is a little lighter
          const lv = this.world.heightAt(chunk.cx * CHUNK + x, chunk.cy * CHUNK + y);
          if (lv > 0 && lv < 4) {
            g.fillStyle = `rgba(255,240,210,${0.05 * lv})`;
            g.fillRect(x * TILE, y * TILE, TILE, TILE);
          }
        }
        const h = hash2(chunk.cx * CHUNK + x, chunk.cy * CHUNK + y, this.world.seed);
        if (name.endsWith('_wall')) { // brickwork
          g.strokeStyle = 'rgba(255,255,255,0.07)';
          g.strokeRect(x * TILE + 0.5, y * TILE + 0.5, TILE - 1, TILE - 1);
          g.fillStyle = 'rgba(255,255,255,0.05)';
          g.fillRect(x * TILE, y * TILE, TILE, 4);
          continue;
        }
        if (name.endsWith('_floor')) { // flagstones
          g.strokeStyle = 'rgba(0,0,0,0.2)';
          g.strokeRect(x * TILE + 0.5, y * TILE + 0.5, TILE - 1, TILE - 1);
          continue;
        }
        if (name === 'town') {
          g.strokeStyle = 'rgba(0,0,0,0.14)'; // cobblestones
          g.strokeRect(x * TILE + 0.5, y * TILE + 0.5, TILE - 1, TILE - 1);
          continue;
        }
        if (GROUND_DETAIL[name]) {
          GROUND_DETAIL[name](g, x * TILE, y * TILE, h, (dx, dy) => BIOME_IDS[this.world.tileAt(chunk.cx * CHUNK + x + dx, chunk.cy * CHUNK + y + dy)]);
          continue;
        }
        const px = x * TILE + 16;
        const py = y * TILE + 16;
        if (name === 'forest' && h < 0.4) {
          drawSprite(g, h < 0.3 ? 'tree' : 'bush', px, py);
        } else if (name === 'snow' && h > 0.92) {
          drawSprite(g, 'pine', px, py);
        } else if (name === 'desert' && h > 0.92) {
          drawSprite(g, h > 0.96 ? 'cactus' : 'rock', px, py);
        } else if (name === 'grass' && h > 0.9) {
          drawSprite(g, h > 0.97 ? 'flowers' : h > 0.94 ? 'bush' : 'tuft', px, py);
        } else if (h > 0.9 && name !== 'water') {
          g.fillStyle = 'rgba(0,0,0,0.12)';
          g.fillRect(x * TILE + 12, y * TILE + 12, 6, 6);
        }
      }
    }
    if (relief) for (let y = 0; y < CHUNK; y++) for (let x = 0; x < CHUNK; x++) drawRelief(g, this.world, chunk.cx * CHUNK + x, chunk.cy * CHUNK + y, x * TILE, y * TILE);
    chunk.canvas = c;
    return c;
  }

  // Fog of war on the main view: clear around the player, dim where you have been, black where you have not.
  drawFog(state, camX, camY, w, h) {
    if (!state.fog) return;
    const p = state.player;
    const tx0 = Math.floor(camX / TILE) - 1;
    const ty0 = Math.floor(camY / TILE) - 1;
    const cols = Math.ceil(w / TILE) + 3;
    const rows = Math.ceil(h / TILE) + 3;
    if (!this.fog || this.fog.width !== cols || this.fog.height !== rows) {
      this.fog = document.createElement('canvas');
      this.fog.width = cols;
      this.fog.height = rows;
      this.fogImage = this.fog.getContext('2d').createImageData(cols, rows);
    }
    const data = this.fogImage.data;
    const px = p.x / TILE;
    const py = p.y / TILE;
    const SIGHT = sightOf(state);
    const clear = SIGHT - 3;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const tx = tx0 + col;
        const ty = ty0 + row;
        const d = Math.hypot(tx + 0.5 - px, ty + 0.5 - py);
        const far = state.explored.has(tx, ty) ? 0.62 : 1;
        let a = d <= clear ? 0 : d >= SIGHT ? far : (far * (d - clear)) / 3;
        if (state.visible && !state.visible.has(tx, ty)) a = far; // behind a wall: remembered at best
        const i = (row * cols + col) * 4;
        data[i] = 8; data[i + 1] = 8; data[i + 2] = 16; data[i + 3] = Math.round(a * 255);
      }
    }
    this.fog.getContext('2d').putImageData(this.fogImage, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.drawImage(this.fog, tx0 * TILE, ty0 * TILE, cols * TILE, rows * TILE);
  }

  // Only what you have explored is drawn; towns appear once discovered.
  drawMinimap(state) {
    const player = state.player;
    const g = this.mini.getContext('2d');
    const relief = !!this.world.map?.height;
    const size = 80;
    const step = this.world.isDungeon ? 1 : 4; // tiles per minimap cell
    const ptx = Math.floor(player.x / TILE);
    const pty = Math.floor(player.y / TILE);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const tx = ptx + (x - size / 2) * step;
        const ty = pty + (y - size / 2) * step;
        if (state.fog && !state.explored.has(tx, ty)) {
          g.fillStyle = '#0b0b12';
        } else {
          g.fillStyle = this.world.biomes[BIOME_IDS[this.world.tileAt(tx, ty)]].color;
        }
        g.fillRect(x * 2, y * 2, 2, 2);
        if (relief && g.fillStyle !== '#0b0b12') { // the levels: lighter up high, dark along a cliff
          const lv = this.world.heightAt(tx, ty);
          const below = this.world.heightAt(tx, ty + step);
          if (lv > below && below < 4 && lv < 4 && !this.world.isRamp(tx, ty)) g.fillStyle = 'rgba(0,0,0,0.35)';
          else if (lv > 0 && lv < 4) g.fillStyle = `rgba(255,240,210,${0.06 * lv})`;
          else continue;
          g.fillRect(x * 2, y * 2, 2, 2);
        }
      }
    }
    for (const lair of lairsInRange(this.world, player.x, player.y, (size / 2) * step * TILE, state.bossDefs ?? [])) {
      if (state.fog && !state.discovered.has(lair.id)) continue;
      const lx = ((lair.tx - ptx) / step + size / 2) * 2;
      const ly = ((lair.ty - pty) / step + size / 2) * 2;
      g.fillStyle = (state.lairs?.get(lair.id)?.respawn ?? 0) > 0 ? '#757575' : '#e53935';
      g.fillRect(lx - 2, ly - 2, 5, 5);
    }
    for (const v of valleysInRange(this.world, player.x, player.y, (size / 2) * step * TILE)) {
      if (state.fog && !state.discovered.has(`c:${v.cx},${v.cy}`)) continue;
      for (const m of [v.outer, v.inner]) {
        g.fillStyle = '#8d6e63';
        g.fillRect(((m.tx - ptx) / step + size / 2) * 2 - 2, ((m.ty - pty) / step + size / 2) * 2 - 2, 4, 4);
      }
    }
    for (const e of entrancesInRange(this.world, player.x, player.y, (size / 2) * step * TILE, state.dungeonDefs)) {
      if (state.fog && !state.discovered.has(e.id)) continue;
      g.fillStyle = '#ab47bc';
      g.fillRect(((e.tx - ptx) / step + size / 2) * 2 - 2, ((e.ty - pty) / step + size / 2) * 2 - 2, 5, 5);
    }
    for (const town of this.world.townsInRange(player.x, player.y, (size / 2) * step * TILE)) {
      if (state.fog && !state.discovered.has(town.id)) continue;
      const mx = ((town.tx - ptx) / step + size / 2) * 2;
      const my = ((town.ty - pty) / step + size / 2) * 2;
      const r = town.kind === 'capital' || town.kind === 'city' ? 4 : town.kind === 'hamlet' ? 2 : 3;
      g.fillStyle = '#ffd54f';
      g.fillRect(mx - r, my - r, 2 * r, 2 * r);
      g.strokeStyle = '#000';
      g.strokeRect(mx - r, my - r, 2 * r, 2 * r);
    }
  }

  draw(state, dt) {
    const { ctx, canvas, dpr } = this;
    const player = state.player;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, w, h);

    const camX = player.x - w / 2;
    const camY = player.y - h / 2;
    ctx.save();
    ctx.translate(-camX, -camY);

    const c0x = Math.floor(camX / CHUNK_PX);
    const c1x = Math.floor((camX + w) / CHUNK_PX);
    const c0y = Math.floor(camY / CHUNK_PX);
    const c1y = Math.floor((camY + h) / CHUNK_PX);
    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const chunk = this.world.getChunk(cx, cy);
        ctx.drawImage(this.chunkCanvas(chunk), cx * CHUNK_PX, cy * CHUNK_PX);
      }
    }

    this.drawTowns(state, camX + w / 2, camY + h / 2, Math.hypot(w, h) / 2);
    this.drawLairs(state, camX + w / 2, camY + h / 2, Math.hypot(w, h) / 2);
    this.drawCamps(state, camX + w / 2, camY + h / 2, Math.hypot(w, h) / 2);
    this.drawSidePlaces(state, camX + w / 2, camY + h / 2, Math.hypot(w, h) / 2);

    const seen = (x, y) => !state.fog || (Math.hypot(x - player.x, y - player.y) < sightOf(state) * TILE
      && (!state.visible || state.visible.has(Math.floor(x / TILE), Math.floor(y / TILE)))); // nothing is visible in the fog or behind a wall
    this.drawDoors(state, camX + w / 2, camY + h / 2, Math.hypot(w, h) / 2, seen);
    this.drawChests(state, seen);
    this.drawGraves(state, camX + w / 2, camY + h / 2, Math.hypot(w, h) / 2, seen);
    for (const e of state.enemies) {
      if (e.hp <= 0 || !seen(e.x, e.y)) continue;
      this.drawEnemyTelegraph(e);
      const cy = bodyY(e); // a flyer's body hovers above its shadow
      const m = stepOf(e, e.mode === 'chase' ? { x: player.x - e.x, y: player.y - e.y } : undefined);
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.ellipse(e.x, e.y + e.r * (isFlying(e) ? 0.4 : 0.8), e.r * 0.9, e.r * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
      const box = drawEnemySprite(ctx, e.def, e.x, cy, {
        scale: enemyScale(e.def, e.r),
        frame: isFlying(e) ? Math.floor(performance.now() / 110 + (e.phase ?? 0) * 3) : walkFrame(m),
        fx: m.fx,
        fy: m.fy,
        flash: e.flash > 0,
        outline: e.boss ? '#ffd54f' : e.mode === 'chase' ? '#b71c1c' : undefined, // gold: a boss; red: it hunts you
      });
      if (!box && isFlying(e)) {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.ellipse(e.x, e.y + e.r * 0.4, e.r * 0.9, e.r * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
        const flap = Math.sin(performance.now() / 70 + e.phase); // wings
        ctx.fillStyle = e.flash > 0 ? '#fff' : e.def.color;
        ctx.globalAlpha = 0.75;
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(e.x, cy);
          ctx.lineTo(e.x + side * e.r * 2, cy - e.r * (0.6 + flap * 0.7));
          ctx.lineTo(e.x + side * e.r * 1.4, cy + e.r * 0.5);
          ctx.closePath();
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      if (!box) { // a monster with no picture yet: a round body
        ctx.fillStyle = e.flash > 0 ? '#fff' : e.def.color;
        ctx.beginPath();
        ctx.arc(e.x, cy, e.r, 0, Math.PI * 2);
        ctx.fill();
        if (e.boss || e.mode === 'chase') {
          ctx.strokeStyle = e.boss ? '#ffd54f' : '#ff1744';
          ctx.lineWidth = e.boss ? 4 : 2;
          ctx.stroke();
        }
      }
      const barY = Math.min(cy - e.r, box ? box.top : cy) - 10;
      const barW = Math.max(36, e.r * 2);
      ctx.fillStyle = '#000';
      ctx.fillRect(e.x - barW / 2, barY, barW, 5);
      ctx.fillStyle = e.boss ? '#ff6f00' : '#e74c3c';
      ctx.fillRect(e.x - barW / 2, barY, barW * (e.hp / e.maxHp), 5);
      if (e.dots?.length) { // burning or poisoned
        ctx.fillStyle = e.dots.some((d) => d.kind === 'burn') ? '#ff7043' : '#9ccc65';
        ctx.fillRect(e.x + barW / 2 - 5, barY - 8, 5, 5);
      }
      if (e.slowLeft > 0) { // slowed: a pale ring
        ctx.strokeStyle = '#81d4fa';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(e.x, cy, e.r + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (e.tier > 0 && !e.boss) { // one gold pip per danger tier of the region it lives in
        ctx.fillStyle = '#ffd54f';
        for (let i = 0; i < e.tier; i++) ctx.fillRect(e.x - barW / 2 + i * 7, barY - 8, 5, 5);
      }
      if (e.boss) {
        ctx.textAlign = 'center';
        ctx.font = 'bold 13px sans-serif';
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#000';
        ctx.strokeText(bossLabel(e), e.x, barY - 6);
        ctx.fillStyle = '#ffd54f';
        ctx.fillText(bossLabel(e), e.x, barY - 6);
      }
    }

    for (const sh of state.enemyProjectiles ?? []) {
      if (!seen(sh.x, sh.y)) continue;
      ctx.fillStyle = sh.color;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(sh.x, sh.y, sh.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    for (const d of state.drops) if (seen(d.x, d.y)) this.drawDrop(d, player);

    for (const f of state.effects) this.drawEffect(f);

    for (const p of state.projectiles) {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }

    if (!state.dead) {
      if (player.boating) this.drawBoat(player);
      const m = stepOf(player, player.facing);
      const look = pose('hero', m.fx, m.fy);
      ctx.globalAlpha = player.rollTime > 0 ? 0.5 : 1;
      if (!player.boating) {
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.beginPath();
        ctx.ellipse(player.x, player.y + 13, 12, 5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      drawSprite(ctx, look.name, player.x, player.y - 4, {
        frame: player.boating ? 0 : walkFrame(m),
        flip: look.flip,
        flash: player.hurt > 0 && Math.floor(performance.now() / 70) % 2 === 0, // blinks white when hit
      });
      ctx.globalAlpha = 1;
    }
    this.drawFog(state, camX, camY, w, h);
    this.drawWaypointArrow(state, player);
    this.drawRingCompass(state, player);

    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    for (const f of state.floaters) {
      ctx.globalAlpha = 1 - f.t / f.dur;
      ctx.fillStyle = f.color ?? '#ffeb3b';
      let text = f.text;
      if (f.questId) {
        const def = state.questIndex.get(f.questId);
        text = def ? t(f.key, { title: questTitle(def) }) : '';
      } else if (f.key) {
        text = t(f.key);
      }
      ctx.fillText(text, f.x, f.y - f.t * 40);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    this.miniTimer -= dt;
    if (this.miniTimer <= 0) { this.drawMinimap(state); this.miniTimer = 0.5; }
    const ms = state.touch.enabled ? 110 : 160;
    ctx.drawImage(this.mini, w - ms - 10, 10, ms, ms);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.strokeRect(w - ms - 10, 10, ms, ms);
    ctx.fillStyle = '#fff';
    ctx.fillRect(w - 10 - ms / 2 - 2, 10 + ms / 2 - 2, 4, 4);
    this.drawMinimapWaypoint(state, player, w, ms);

    this.drawHud(state, w, h);
    drawArenaPanel(this.ctx, state);
  }

  // Arrow next to the player pointing at the tracked quest's destination, with the distance in tiles.
  // The lab badge (a relic) on your neck: a thin violet needle by your feet always points at the Ring.
  drawRingCompass(state, player) {
    if (state.area || !wearsEffect(state, 'ringCompass')) return;
    const ring = ringSite(this.world);
    if (!ring) return;
    const { ctx } = this;
    const a = Math.atan2(ring.py - player.y, ring.px - player.x);
    ctx.save();
    ctx.translate(player.x + Math.cos(a) * 34, player.y + 18 + Math.sin(a) * 14);
    ctx.rotate(a);
    ctx.fillStyle = 'rgba(206,147,216,0.85)';
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-6, 4);
    ctx.lineTo(-6, -4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawWaypointArrow(state, player) {
    const wp = guideWaypoint(state, this.world);
    if (!wp || state.dead) return;
    const dx = wp.x - player.x;
    const dy = wp.y - player.y;
    const dist = Math.hypot(dx, dy);
    if (dist < (wp.kind === 'npc' ? 70 : wp.kind === 'area' ? wp.r : TOWN_RADIUS_PX)) return; // already there (next to the person, in the town, in the circle you search)
    const { ctx } = this;
    const a = Math.atan2(dy, dx);
    const r = 56 + Math.sin(performance.now() / 300) * 3;
    ctx.save();
    ctx.translate(player.x + Math.cos(a) * r, player.y + Math.sin(a) * r);
    ctx.rotate(a);
    ctx.fillStyle = '#ffd54f';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(12, 0); ctx.lineTo(-8, 9); ctx.lineTo(-3, 0); ctx.lineTo(-8, -9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.textAlign = 'center';
    ctx.font = 'bold 11px sans-serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000';
    const label = String(Math.round(dist / TILE));
    const lx = player.x + Math.cos(a) * (r + 22);
    const ly = player.y + Math.sin(a) * (r + 22) + 4;
    ctx.strokeText(label, lx, ly);
    ctx.fillStyle = '#ffd54f';
    ctx.fillText(label, lx, ly);
  }

  // Ring on the minimap at the tracked destination; pinned to the edge when it is out of range.
  drawMinimapWaypoint(state, player, w, ms) {
    const wp = guideWaypoint(state, this.world);
    if (!wp) return;
    const { ctx } = this;
    const scale = ms / 160 / (((this.world.isDungeon ? 1 : 4) * TILE) / 2); // minimap pixels per world pixel
    let mx = (wp.x - player.x) * scale;
    let my = (wp.y - player.y) * scale;
    const half = ms / 2 - 5;
    const outside = Math.abs(mx) > half || Math.abs(my) > half;
    if (outside) {
      const k = half / Math.max(Math.abs(mx), Math.abs(my));
      mx *= k;
      my *= k;
    }
    const cx = w - 10 - ms / 2 + mx;
    const cy = 10 + ms / 2 + my;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = outside ? '#ffd54f' : '#9ccc65';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 6 + (outside ? 0 : Math.abs(Math.sin(performance.now() / 400)) * 3), 0, Math.PI * 2);
    ctx.stroke();
  }

  // The current quest is shown big, the others small. Returns the y for whatever comes next.
  drawQuestTracker(state, y) {
    const { ctx } = this;
    const p = state.player;
    const list = activeQuests(state).sort((a, b) => (b.def.id === p.tracked) - (a.def.id === p.tracked));
    ctx.textAlign = 'left';
    const title = (def) => (isMain(def) ? t('hud.story', { title: questTitle(def) }) : questTitle(def));
    const next = mainStepWaypoint(state, this.world); // the main line goes on with someone you have not spoken to yet
    if (next) {
      const tiles = Math.round(Math.hypot(next.x - p.x, next.y - p.y) / TILE);
      ctx.font = 'bold 13px sans-serif';
      ctx.fillStyle = '#ffab40';
      ctx.fillText(t('hud.story.next'), 10, y);
      ctx.font = '12px monospace';
      ctx.fillStyle = '#90caf9';
      ctx.fillText(t('hud.story.talk', { who: t(next.nameKey), town: t(next.townKey), n: tiles }), 10, y + 15);
      y += 34;
    }
    for (const { def, entry } of list) {
      const ready = entry.progress >= def.count;
      const progress = def.kind === 'kill' || def.kind === 'gather' ? ` ${entry.progress}/${def.count}` : '';
      if (def.id === p.tracked) {
        ctx.font = 'bold 13px sans-serif';
        ctx.fillStyle = isMain(def) ? '#ffab40' : '#ffd54f';
        ctx.fillText(`★ ${title(def)}`, 10, y);
        ctx.font = '12px monospace';
        ctx.fillStyle = ready ? '#9ccc65' : '#fff';
        ctx.fillText(ready ? t('journal.ready') : objectiveText(def) + progress, 10, y + 15);
        y += 30;
        const wp = trackedWaypoint(state, this.world);
        if (wp) {
          const tiles = Math.round(Math.hypot(wp.x - p.x, wp.y - p.y) / TILE);
          ctx.fillStyle = '#90caf9';
          const rest = state.lairs?.get(wp.id)?.respawn ?? 0;
          const where = wp.townKey ? t('journal.go.person', { who: t(wp.nameKey), town: t(wp.townKey) }) : t(wp.nameKey);
          const line = rest > 0
            ? t('journal.go.resting', { town: where, n: tiles, time: mmss(rest) })
            : t('journal.go', { town: where, n: tiles });
          ctx.fillText(line, 10, y - 2);
          y += 15;
        }
      } else {
        ctx.font = '11px monospace';
        ctx.fillStyle = ready ? '#9ccc65' : '#999';
        ctx.fillText(`${title(def)}${progress}`, 10, y);
        y += 14;
      }
    }
    return y;
  }

  // Dungeon entrances in the open world, and the stairs up inside a dungeon, with a hint when you stand next to one.
  drawDoors(state, cx, cy, range, seen) {
    const { ctx } = this;
    const hint = (x, y, key) => {
      ctx.textAlign = 'center';
      ctx.font = '13px sans-serif';
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#000';
      const text = t(state.touch.enabled ? key + '.touch' : key);
      ctx.strokeText(text, x, y);
      ctx.fillStyle = '#ffd54f';
      ctx.fillText(text, x, y);
    };
    if (state.area?.console && consoleOpen(state)) { // the console of the Ring, alive once its keeper is down
      const c = state.area.console;
      const glow = 0.5 + 0.3 * Math.sin(performance.now() / 250);
      ctx.fillStyle = `rgba(206,147,216,${0.25 * glow})`;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 60, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2b2236';
      ctx.fillRect(c.x - 26, c.y - 18, 52, 34);
      ctx.fillStyle = `rgba(225,190,231,${glow})`;
      ctx.fillRect(c.x - 20, c.y - 12, 40, 14);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.strokeRect(c.x - 26, c.y - 18, 52, 34);
      if (state.nearDoor?.kind === 'console') hint(c.x, c.y - 34, 'ring.console');
    }
    if (state.area) {
      for (const exit of state.area.exits ?? [state.area.exit]) {
        if (exit.out) { // a way out of a cave: daylight at the end of the passage
          const glow = ctx.createRadialGradient(exit.x, exit.y, 4, exit.x, exit.y, 46);
          glow.addColorStop(0, 'rgba(255,248,220,0.9)');
          glow.addColorStop(1, 'rgba(255,248,220,0)');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(exit.x, exit.y, 46, 0, Math.PI * 2);
          ctx.fill();
          if (state.nearDoor?.exit === exit) hint(exit.x, exit.y - 40, 'cave.out');
          continue;
        }
        ctx.fillStyle = '#6d6d78';
        ctx.fillRect(exit.x - 22, exit.y - 22, 44, 44);
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 2;
        ctx.strokeRect(exit.x - 22, exit.y - 22, 44, 44);
        ctx.fillStyle = '#9e9ea8'; // steps going up
        for (let i = 0; i < 4; i++) ctx.fillRect(exit.x - 18 + i * 3, exit.y - 18 + i * 9, 36 - i * 6, 6);
        if (state.nearDoor?.kind === 'exit' && !state.nearDoor.exit) hint(exit.x, exit.y - 34, 'dungeon.exit');
      }
      return;
    }
    const ring = ringSite(this.world);
    if (ring && Math.hypot(ring.px - cx, ring.py - cy) <= range + 100 && seen(ring.px, ring.py)) { // the shaft down to the Ring
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 400);
      ctx.strokeStyle = `rgba(206,147,216,${0.3 + 0.3 * pulse})`;
      ctx.lineWidth = 6;
      for (const r of [70, 50]) {
        ctx.beginPath();
        ctx.arc(ring.px, ring.py, r + pulse * 6, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = '#1a1424';
      ctx.beginPath();
      ctx.arc(ring.px, ring.py, 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#6a5a7a';
      ctx.lineWidth = 4;
      ctx.stroke();
      if (state.discovered.has(ring.id)) {
        ctx.textAlign = 'center';
        ctx.font = 'bold 13px sans-serif';
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#000';
        ctx.strokeText(t('ring.name'), ring.px, ring.py - 86);
        ctx.fillStyle = '#e1bee7';
        ctx.fillText(t('ring.name'), ring.px, ring.py - 86);
      }
      if (state.nearDoor?.entrance === ring) hint(ring.px, ring.py + 50, 'ring.enter');
    }
    for (const v of valleysInRange(this.world, cx, cy, range)) { // the two mouths of the cave into a hidden valley
      for (const side of ['outer', 'inner']) {
        const x = v[side].tx * TILE + TILE / 2;
        const y = v[side].ty * TILE + TILE / 2;
        if (!seen(x, y)) continue;
        // a heap of rock around a dark hole; fallen in once the dimension is folded back
        drawSprite(ctx, side === 'outer' && state.ending === 'fold' ? 'cave_sealed' : 'cave', x, y - 4);
        const near = state.nearDoor?.kind === 'cave' && state.nearDoor.valley === v && state.nearDoor.side === side;
        if (near) hint(x, y + 40, state.nearDoor.sealed ? 'cave.sealed' : 'cave.enter');
      }
    }
    for (const e of entrancesInRange(this.world, cx, cy, range, state.dungeonDefs)) {
      if (!seen(e.px, e.py)) continue;
      ctx.fillStyle = 'rgba(20,10,30,0.25)';
      ctx.beginPath();
      ctx.arc(e.px, e.py, 64, 0, Math.PI * 2);
      ctx.fill();
      drawSprite(ctx, 'arch', e.px, e.py - 4); // a stone arch around a dark opening
      ctx.textAlign = 'center';
      ctx.strokeStyle = '#000';
      ctx.font = 'bold 12px sans-serif';
      if (state.discovered.has(e.id)) {
        ctx.lineWidth = 3;
        ctx.strokeText(t('dungeon.theme.' + e.theme), e.px, e.py - 38);
        ctx.fillStyle = '#ce93d8';
        ctx.fillText(t('dungeon.theme.' + e.theme), e.px, e.py - 38);
      }
      if (state.nearDoor?.entrance?.id === e.id) hint(e.px, e.py + 44, 'dungeon.enter');
    }
  }

  // Graves of the past by the roads, and graves of a possible future near lairs: pale, flickering, not quite here.
  drawGraves(state, cx, cy, range, seen) {
    const { ctx } = this;
    for (const g of memorialsInRange(state, this.world, cx, cy, range)) {
      const x = g.site.tx * TILE + TILE / 2;
      const y = g.site.ty * TILE + TILE / 2;
      if (!seen(x, y)) continue;
      ctx.globalAlpha = g.future ? 0.45 + 0.25 * Math.sin(performance.now() / 300) : 1;
      drawSprite(ctx, 'grave', x, y, { slots: { B: g.future ? '#80deea' : '#9e9e9e' } });
      ctx.globalAlpha = 1;
    }
  }

  drawChests(state, seen) {
    const { ctx } = this;
    for (const c of state.chests ?? []) {
      if (!seen(c.x, c.y)) continue;
      drawSprite(ctx, c.opened ? 'chest_open' : 'chest', c.x, c.y);
    }
  }

  // The ruins around a boss lair: dark ground, standing stones, an altar that glows while the boss lives.
  // Monster camps: a den, tents, a pool, a nest... dim while the camp lies empty after you cleared it.
  drawCamps(state, cx, cy, range) {
    const { ctx } = this;
    for (const camp of campsInRange(this.world, cx, cy, range + 100, state.campDefs)) {
      const { px: x, py: y } = camp;
      ctx.globalAlpha = campResting(state, camp.id) ? 0.45 : 1;
      const look = camp.def.look;
      ctx.fillStyle = 'rgba(60,40,20,0.25)'; // trampled ground
      ctx.beginPath();
      ctx.ellipse(x, y, 95, 70, 0, 0, Math.PI * 2);
      ctx.fill();
      if (look === 'pool') {
        ctx.fillStyle = '#6fbf73';
        ctx.beginPath();
        ctx.ellipse(x, y, 48, 30, 0.3, 0, Math.PI * 2);
        ctx.fill();
      } else if (look === 'tents') {
        for (const [dx, dy, c] of [[-40, -20, '#8d6e63'], [30, -30, '#a1887f'], [0, 30, '#795548']]) {
          drawSprite(ctx, 'tent', x + dx, y + dy - 6, { slots: { B: c } });
        }
        drawSprite(ctx, 'fire', x, y - 4, { frame: Math.floor(performance.now() / 160) }); // the fire
      } else if (look === 'circle') {
        ctx.strokeStyle = '#7e57c2';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, 50, 0, Math.PI * 2);
        ctx.stroke();
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          drawSprite(ctx, 'stone', x + Math.cos(a) * 50, y + Math.sin(a) * 50 - 6);
        }
      } else { // den, nest, roost, wallow: a dark hollow ringed with sticks and bones
        ctx.fillStyle = look === 'wallow' ? '#5d4037' : '#3e2723';
        ctx.beginPath();
        ctx.ellipse(x, y, 40, 26, 0, 0, Math.PI * 2);
        ctx.fill();
        for (let k = 0; k < 7; k++) { // bones around it
          const a = (k / 7) * Math.PI * 2;
          drawSprite(ctx, 'bone', x + Math.cos(a) * 44, y + Math.sin(a) * 28, { flip: k % 2 === 1 });
        }
      }
      ctx.globalAlpha = 1;
      if (state.discovered.has(camp.id) || !state.fog) {
        ctx.textAlign = 'center';
        ctx.font = 'bold 12px sans-serif';
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#000';
        const name = t('camp.' + camp.def.id);
        ctx.strokeText(name, x, y - 60);
        ctx.fillStyle = campResting(state, camp.id) ? '#9e9e9e' : '#ef9a9a';
        ctx.fillText(name, x, y - 60);
      }
    }
  }

  // The places of the side stories (systems/sidequests.js): a farm's cottage, what grows where you gather, the circle
  // you search, and the people who live out in the wild.
  drawSidePlaces(state, cx, cy, range) {
    const { ctx } = this;
    const near = (x, y, pad = 0) => Math.hypot(x - cx, y - cy) < range + pad;
    for (const s of Object.values(this.world.spots ?? {})) {
      if (s.look !== 'farm' || !near(s.px, s.py, 300)) continue;
      const x = (s.tx - 2) * TILE;
      const y = (s.ty - 3) * TILE;
      const W = 4 * TILE;
      const H = 3 * TILE;
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; // its shadow
      ctx.fillRect(x + 6, y + 8, W, H);
      ctx.fillStyle = '#6d4c33'; // a wooden roof, shingled, the ridge along the long side
      ctx.fillRect(x, y, W, H);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(x, y + H / 2, W, H / 2);
      this.drawShingles({ x, y, w: W, h: H });
      ctx.fillStyle = '#4e342e';
      ctx.fillRect(x, y + H / 2 - 2, W, 4);
      ctx.fillStyle = '#5d5d5d'; // the chimney
      ctx.fillRect(x + W - 26, y + 6, 12, 14);
      ctx.fillStyle = '#3e2723'; // the door, at the front (the step is under it)
      ctx.fillRect(x + W / 2 - 9, y + H - 6, 18, 8);
      ctx.fillStyle = '#8d6e63';
      ctx.fillRect(x + W / 2 - 14, y + H + 2, 28, 7);
    }
    const p = state.player;
    for (const [id, e] of Object.entries(p.quests)) { // what you gather: the plants still standing
      if (e.status !== 'active') continue;
      const def = state.questIndex.get(id);
      if (def?.kind !== 'gather' || e.progress >= def.count) continue;
      for (const g of gatherPoints(state, def)) {
        if (e.picked?.includes(g.i) || !near(g.x, g.y)) continue;
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath();
        ctx.ellipse(g.x, g.y + 6, 9, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = def.color ?? '#7cb342';
        for (const [dx, dy] of [[-5, -2], [5, -2], [0, -7], [-2, 2], [3, 3]]) ctx.fillRect(g.x + dx - 2, g.y + dy - 3, 4, 7);
        ctx.fillStyle = def.flower ?? '#ba68c8';
        for (const [dx, dy] of [[-5, -6], [5, -6], [0, -11]]) ctx.fillRect(g.x + dx - 2, g.y + dy - 2, 4, 4);
      }
    }
    const wp = trackedWaypoint(state, this.world); // the circle you search, on the ground
    if (wp?.kind === 'area' && wp.r && near(wp.x, wp.y, wp.r)) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,213,79,0.45)';
      ctx.lineWidth = 3;
      ctx.setLineDash([14, 12]);
      ctx.beginPath();
      ctx.arc(wp.x, wp.y, wp.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    for (const person of wildPeople(state)) if (near(person.x, person.y, 60)) this.drawNpc(state, person, { id: person.home });
  }

  drawLairs(state, cx, cy, range) {
    const { ctx } = this;
    for (const lair of lairsInRange(this.world, cx, cy, range, state.bossDefs ?? [])) {
      const dead = (state.lairs?.get(lair.id)?.respawn ?? 0) > 0;
      const R = LAIR_RADIUS * TILE;
      ctx.fillStyle = dead ? 'rgba(40,40,40,0.18)' : 'rgba(110,0,0,0.22)';
      ctx.beginPath();
      ctx.arc(lair.px, lair.py, R, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 12; i++) { // standing stones in a ring
        const a = (i / 12) * Math.PI * 2;
        drawSprite(ctx, 'stone', lair.px + Math.cos(a) * R, lair.py + Math.sin(a) * R - 6);
      }
      ctx.fillStyle = '#2a2a2a';
      ctx.beginPath();
      ctx.arc(lair.px, lair.py, 16, 0, Math.PI * 2);
      ctx.fill();
      if (!dead) {
        ctx.fillStyle = `rgba(255,61,0,${0.55 + 0.3 * Math.sin(performance.now() / 300)})`;
        ctx.beginPath();
        ctx.arc(lair.px, lair.py, 7, 0, Math.PI * 2);
        ctx.fill();
      } else if (Math.hypot(lair.px - state.player.x, lair.py - state.player.y) < 450) {
        // the boss is away: say so, and when it comes back
        const text = t('lair.resting', { name: named(lair.name, t('enemy.' + lair.bossId)), time: mmss(state.lairs.get(lair.id).respawn) });
        ctx.textAlign = 'center';
        ctx.font = '13px sans-serif';
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#000';
        ctx.strokeText(text, lair.px, lair.py + 40);
        ctx.fillStyle = '#ffcc80';
        ctx.fillText(text, lair.px, lair.py + 40);
      }
    }
  }

  // What an enemy is about to do: the red areas are where it will hit. Move out before the windup ends.
  drawEnemyTelegraph(e) {
    const a = e.atk;
    if (!a) return;
    const { ctx } = this;
    if (a.kind === 'bite') { // a melee blow: the wedge it will land in
      if (a.phase !== 'windup') return;
      const k = Math.min(1, a.t / a.dur);
      ctx.fillStyle = `rgba(255,60,60,${0.12 + 0.25 * k})`;
      ctx.strokeStyle = 'rgba(255,80,80,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(e.x, e.y);
      ctx.arc(e.x, e.y, a.reach, a.dir - BITE_ARC, a.dir + BITE_ARC);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(e.x, e.y, a.reach * k, a.dir - BITE_ARC, a.dir + BITE_ARC);
      ctx.stroke();
      return;
    }
    if (!e.boss) { // a boar's charge line
      if (a.phase !== 'windup') return;
      const c = e.def.charger;
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(a.dir);
      ctx.fillStyle = `rgba(255,60,60,${0.15 + 0.2 * Math.min(1, a.t / a.dur)})`;
      ctx.fillRect(0, -e.r, c.speed * c.time, e.r * 2);
      ctx.restore();
      return;
    }
    if (a.phase !== 'windup') return;
    const k = Math.min(1, a.t / a.dur);
    const d = a.def;
    ctx.fillStyle = `rgba(255,60,60,${0.12 + 0.2 * k})`;
    ctx.strokeStyle = 'rgba(255,80,80,0.85)';
    ctx.lineWidth = 2;
    if (a.kind === 'slam') {
      ctx.beginPath();
      ctx.arc(a.tx, a.ty, d.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(a.tx, a.ty, d.radius * k, 0, Math.PI * 2);
      ctx.stroke();
    } else if (a.kind === 'charge') {
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(a.dir);
      ctx.fillRect(0, -e.r, d.speed * d.time, e.r * 2);
      ctx.restore();
    } else if (a.kind === 'fan') {
      const spread = ((d.spread ?? 60) * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(e.x, e.y);
      ctx.arc(e.x, e.y, 380, a.dir - spread / 2, a.dir + spread / 2);
      ctx.closePath();
      ctx.fill();
    } else { // nova and summon: a ring that grows around the boss
      ctx.strokeStyle = a.kind === 'summon' ? 'rgba(186,104,200,0.9)' : 'rgba(255,112,67,0.9)';
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r + 20 + 40 * k, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // A small wooden boat under the player, with a wake behind it.
  drawBoat(p) {
    const { ctx } = this;
    const t0 = performance.now() / 400;
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 10, 30 + Math.sin(t0) * 2, 15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6d4c41';
    ctx.strokeStyle = '#2e1c14';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 6, 25, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#8d6e63';
    ctx.fillRect(p.x - 18, p.y + 3, 36, 3);
  }

  // What the B key would do here: board a boat at the shore, or land from one.
  drawBoatHint(state, w, h) {
    if (!state.boatHint || state.ui.panel) return;
    const { ctx } = this;
    const key = state.boatHint === 'board' ? 'boat.board' : 'boat.land';
    ctx.textAlign = 'center';
    ctx.font = '14px sans-serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000';
    const text = t(state.touch.enabled ? key + '.touch' : key);
    ctx.strokeText(text, w / 2, h - 150);
    ctx.fillStyle = '#81d4fa';
    ctx.fillText(text, w / 2, h - 150);
    ctx.textAlign = 'left';
  }

  // The fight bar at the bottom: name, health, and a tick where a new attack joins in.
  drawBossBar(state, w, h) {
    const boss = state.enemies.find((e) => e.boss && e.hp > 0 && e.mode === 'chase');
    if (!boss) return;
    const { ctx } = this;
    const bw = Math.min(480, w - 40);
    const x = (w - bw) / 2;
    const y = h - 104;
    ctx.textAlign = 'center';
    ctx.font = 'bold 15px sans-serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000';
    ctx.strokeText(bossLabel(boss), w / 2, y - 6);
    ctx.fillStyle = '#ffd54f';
    ctx.fillText(bossLabel(boss), w / 2, y - 6);
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(x - 2, y - 2, bw + 4, 18);
    ctx.fillStyle = '#d84315';
    ctx.fillRect(x, y, bw * (boss.hp / boss.maxHp), 14);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (const a of boss.def.attacks) if ((a.from ?? 1) < 1) ctx.fillRect(x + bw * a.from - 1, y, 2, 14);
    ctx.fillStyle = '#fff';
    ctx.font = '11px monospace';
    ctx.fillText(`${Math.ceil(boss.hp)} / ${boss.maxHp}`, w / 2, y + 11);
    ctx.textAlign = 'left';
  }

  drawTowns(state, cx, cy, range) {
    const { ctx } = this;
    for (const town of this.world.townsInRange(cx, cy, range)) {
      if (town.walled) {
        this.drawWalledTown(state, town);
        continue;
      }
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.arc(town.px, town.py, TOWN_RADIUS_PX * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#546e7a'; // well
      ctx.beginPath();
      ctx.arc(town.px, town.py, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#4fc3f7';
      ctx.beginPath();
      ctx.arc(town.px, town.py, 9, 0, Math.PI * 2);
      ctx.fill();

      ctx.setLineDash([10, 10]); // edge of the safe zone
      ctx.strokeStyle = 'rgba(255,213,79,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(town.px, town.py, TOWN_RADIUS_PX, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.textAlign = 'center';
      ctx.font = '12px sans-serif';
      for (const b of town.buildings) {
        ctx.fillStyle = b.color;
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; // roof
        ctx.fillRect(b.x, b.y, b.w, 14);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.strokeRect(b.x, b.y, b.w, b.h);
        ctx.fillStyle = '#fff';
        ctx.fillText(t('npc.' + b.id + '.shop'), b.x + b.w / 2, b.y + b.h / 2 + 12);
      }
      for (const npc of town.npcs) this.drawNpc(state, npc, town);
    }
  }

  // Houses with their roofs (a ridge along the long side), the shops labelled, the castle of a capital, towers on the
  // walls of big towns, a well or a fountain and market stalls on the square.
  drawWalledTown(state, town) {
    const { ctx } = this;
    const roofs = ROOFS[town.style] ?? ROOFS.grass;
    const label = (text, x, y) => {
      ctx.textAlign = 'center';
      ctx.font = 'bold 12px sans-serif';
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#000';
      ctx.strokeText(text, x, y);
      ctx.fillStyle = '#fff';
      ctx.fillText(text, x, y);
    };

    const { well } = town;
    drawSprite(ctx, well.fountain ? 'fountain' : 'well', well.x, well.y, { frame: Math.floor(performance.now() / 300) });

    for (const b of town.buildings) {
      const roof = SHOP_ROOFS[b.id] ?? roofs[b.roof % roofs.length];
      for (const p of b.pieces) {
        ctx.fillStyle = roof;
        ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.fillStyle = 'rgba(0,0,0,0.22)'; // the half of the roof turned away from the light (desert roofs are flat)
        if (town.style === 'desert' && !SHOP_ROOFS[b.id]) ctx.fillRect(p.x + 4, p.y + 4, p.w - 8, p.h - 8);
        else if (p.w >= p.h) ctx.fillRect(p.x, p.y + p.h / 2, p.w, p.h / 2);
        else ctx.fillRect(p.x + p.w / 2, p.y, p.w / 2, p.h);
        if (!(town.style === 'desert' && !SHOP_ROOFS[b.id])) this.drawShingles(p);
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = 2;
        ctx.strokeRect(p.x + 1, p.y + 1, p.w - 2, p.h - 2);
        if (town.style === 'snow' && !SHOP_ROOFS[b.id]) { // snow on the ridge
          ctx.fillStyle = 'rgba(255,255,255,0.55)';
          if (p.w >= p.h) ctx.fillRect(p.x + 2, p.y + p.h / 2 - 3, p.w - 4, 6);
          else ctx.fillRect(p.x + p.w / 2 - 3, p.y + 2, 6, p.h - 4);
        }
      }
      if (b.id === 'castle') this.drawKeep(b);
      if (b.id === 'priest') { // the church: a cross on the roof
        ctx.fillStyle = '#5d4037';
        ctx.fillRect(b.x + b.w / 2 - 2, b.y + b.h / 2 - 12, 4, 20);
        ctx.fillRect(b.x + b.w / 2 - 8, b.y + b.h / 2 - 6, 16, 4);
      }
      if (SHOP_ROOFS[b.id]) label(t(b.id === 'castle' ? 'town.castle' : 'npc.' + b.id + '.shop'), b.x + b.w / 2, b.y + b.h / 2 + 4);
    }
    for (const tw of town.towers ?? []) drawSprite(ctx, 'tower', tw.x, tw.y); // round towers standing out of the wall
    for (const st of town.stalls ?? []) { // a striped awning over a table
      drawSprite(ctx, 'stall', st.x, st.y, { slots: { B: STALL_COLORS[st.color % STALL_COLORS.length] } });
    }
    for (const npc of town.npcs) this.drawNpc(state, npc, town);
    for (const f of state.folk?.get(town.id) ?? []) this.drawFolk(f);
  }

  // Someone in the street: a small figure in plain clothes, and what they say when you pass.
  drawFolk(f) {
    const { ctx } = this;
    const m = stepOf(f);
    const T = FOLK_COLORS[f.look % FOLK_COLORS.length];
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(f.x, f.y + 13, 11, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    const look = pose('villager', m.fx, m.fy);
    drawSprite(ctx, look.name, f.x, f.y - 4, { frame: walkFrame(m), flip: look.flip, slots: { T, A: T, h: HAIR[(f.look * 7 + 3) % HAIR.length] } });
    if (f.say > 0) {
      ctx.font = 'italic 12px serif';
      ctx.textAlign = 'center';
      const text = t(typeof f.line === 'string' ? 'folk.' + f.line : 'folk.say.' + f.line); // a word about your deeds, or the usual
      const w = ctx.measureText(text).width + 12;
      ctx.globalAlpha = Math.min(1, f.say / 0.4);
      ctx.fillStyle = 'rgba(255,250,235,0.92)';
      ctx.fillRect(f.x - w / 2, f.y - 48, w, 18);
      ctx.fillStyle = '#3b2f1e';
      ctx.fillText(text, f.x, f.y - 35);
      ctx.globalAlpha = 1;
    }
  }

  // The Pulse: a ring spreading over the screen when it passes, and a faint shimmer at the edge of the changed area.
  drawPulse(state, w, h) {
    const pulse = state.pulse;
    if (!pulse || state.area) return;
    const { ctx } = this;
    if (pulse.wave > 0) {
      const k = 1 - pulse.wave / PULSE_WAVE;
      ctx.strokeStyle = `rgba(206,147,216,${0.8 * (1 - k)})`;
      ctx.lineWidth = 6 + 20 * (1 - k);
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, k * Math.hypot(w, h) * 0.6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `rgba(206,147,216,${0.15 * (1 - k)})`;
      ctx.fillRect(0, 0, w, h);
    }
    const a = pulse.active;
    if (a) {
      const p = state.player;
      const sx = w / 2 + (a.x - p.x);
      const sy = h / 2 + (a.y - p.y);
      ctx.setLineDash([6, 14]);
      ctx.strokeStyle = `rgba(206,147,216,${0.25 + 0.1 * Math.sin(performance.now() / 400)})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(sx, sy, a.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // A note found in a chest (or the line that opens a game): a scrap of paper at the bottom of the screen.
  drawNote(note, w, h) {
    const { ctx } = this;
    ctx.font = 'italic 15px serif';
    const bw = Math.min(520, w - 32);
    let args = note.story ? questArgs({ args: note.args }) : note.args;
    if (note.art) args = { name: artName(note.art), owner: note.art.owner, year: note.art.year, town: t('town.name.' + note.art.town) };
    const lines = wrapText(ctx, note.text ?? t(note.key, args), bw - 40);
    const bh = 46 + lines.length * 20;
    const x = (w - bw) / 2;
    const y = h - bh - 120;
    ctx.globalAlpha = Math.max(0, Math.min(1, note.t / 0.4, ((note.dur ?? NOTE_TIME) - note.t) / 0.8));
    ctx.fillStyle = '#e8dcc0';
    ctx.fillRect(x, y, bw, bh);
    ctx.strokeStyle = '#7a6440';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 4, y + 4, bw - 8, bh - 8);
    ctx.fillStyle = '#7a6440';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(t(note.title ?? 'note.title'), w / 2, y + 22);
    ctx.fillStyle = '#3b2f1e';
    ctx.font = 'italic 15px serif';
    lines.forEach((line, i) => ctx.fillText(line, w / 2, y + 44 + i * 20));
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
  }

  // Rows of shingles on one piece of a roof, two pixels thick, running along its ridge, with the joints staggered.
  drawShingles(p) {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    const along = p.w >= p.h;
    const len = along ? p.w : p.h;
    const across = along ? p.h : p.w;
    for (let a = 6, row = 0; a < across - 3; a += 6, row++) {
      if (along) ctx.fillRect(p.x + 2, p.y + a, p.w - 4, 2);
      else ctx.fillRect(p.x + a, p.y + 2, 2, p.h - 4);
      for (let b = row % 2 ? 4 : 8; b < len - 3; b += 8) {
        if (along) ctx.fillRect(p.x + b, p.y + a - 4, 2, 4);
        else ctx.fillRect(p.x + a - 4, p.y + b, 4, 2);
      }
    }
  }

  // The keep of a castle: battlements along its edge and a tower on each corner.
  drawKeep(b) {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    for (let k = 0; k < b.w; k += 12) {
      ctx.fillRect(b.x + k, b.y, 6, 6);
      ctx.fillRect(b.x + k, b.y + b.h - 6, 6, 6);
    }
    for (const [cx, cy] of [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]]) drawSprite(ctx, 'turret', cx, cy);
    ctx.fillStyle = '#c62828'; // the banner
    ctx.fillRect(b.x + b.w / 2 - 1, b.y - 26, 2, 26);
    ctx.fillRect(b.x + b.w / 2 + 1, b.y - 26, 14, 9);
  }

  drawNpc(state, npc, town) {
    const { ctx } = this;
    const [look, slots] = npc.def?.look ? [npc.def.look, npc.def.slots ?? {}] : NPC_LOOKS[npc.id] ?? ['villager', {}];
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(npc.x, npc.y + 13, 12, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    const p = state.player; // turns to face you when you come near
    const near = Math.hypot(p.x - npc.x, p.y - npc.y) < 220;
    const view = pose(look, near ? p.x - npc.x : 0, near ? p.y - npc.y : 1);
    drawSprite(ctx, view.name, npc.x, npc.y - 4, { slots, flip: view.flip });
    ctx.textAlign = 'center';
    ctx.font = 'bold 12px sans-serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000';
    const name = t(npc.person ? 'npc.' + npc.person : npc.ware ? 'npc.trader.' + npc.ware : 'npc.' + npc.id);
    ctx.strokeText(name, npc.x, npc.y - 28);
    ctx.fillStyle = '#fff';
    ctx.fillText(name, npc.x, npc.y - 28);

    if (QUEST_ROLES.includes(npc.id) || npc.person) { // ! a quest to take, ? one to hand in; the main story in orange
      const rows = listForGiver(state, town.id, npc.person ?? npc.id);
      const ready = rows.find((r) => r.status === 'complete');
      const open = rows.filter((r) => r.status === 'available');
      if (ready || open.length) {
        const story = isMain((ready ?? open.find((r) => isMain(r.def)) ?? open[0]).def) || open.some((r) => isMain(r.def));
        ctx.font = story ? 'bold 26px sans-serif' : 'bold 22px sans-serif';
        ctx.fillStyle = ready ? '#9ccc65' : story ? '#ff9800' : '#ffd54f';
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#000';
        const mark = ready ? '?' : '!';
        const y = npc.y - 46 + Math.sin(performance.now() / 250) * 3;
        ctx.strokeText(mark, npc.x, y);
        ctx.fillText(mark, npc.x, y);
      }
    }
    if (state.nearNpc === npc && !state.ui.panel) {
      ctx.strokeStyle = '#ffd54f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(npc.x, npc.y + 13, 18, 7, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = '13px sans-serif';
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#000';
      const hint = t(state.touch.enabled ? 'npc.talk.touch' : 'npc.talk');
      ctx.strokeText(hint, npc.x, npc.y + 36);
      ctx.fillStyle = '#ffd54f';
      ctx.fillText(hint, npc.x, npc.y + 36);
    }
  }

  // A sword, a breastplate, an amulet or a quiver, outlined in the colour of its rarity; the name shows when you are close.
  drawDrop(d, player) {
    const { ctx } = this;
    const color = rarityById(d.item.rarity).color;
    const y = d.y + Math.sin(d.t * 4) * 3;
    drawSprite(ctx, DROP_ICONS[d.item.slot] ?? 'sword', d.x, y, { slots: { O: color } }); // outlined in its rarity
    if (Math.hypot(d.x - player.x, d.y - player.y) < 150) {
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      const label = t(`${d.item.slot}.${d.item.id}`);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#000';
      ctx.strokeText(label, d.x, y - 18);
      ctx.fillStyle = color;
      ctx.fillText(label, d.x, y - 18);
    }
  }

  drawEffect(f) {
    const { ctx } = this;
    const k = 1 - f.t / f.dur;
    ctx.globalAlpha = k;
    ctx.fillStyle = f.color;
    ctx.strokeStyle = f.color;
    if (f.kind === 'arc') {
      ctx.beginPath();
      ctx.moveTo(f.x, f.y);
      ctx.arc(f.x, f.y, f.range, f.ang - f.arc / 2, f.ang + f.arc / 2);
      ctx.closePath();
      ctx.fill();
    } else if (f.kind === 'thrust') {
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.ang);
      ctx.fillRect(0, -f.width / 2, f.range, f.width);
      ctx.restore();
    } else if (f.kind === 'aoe') {
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.radius * (1.2 - k * 0.2), 0, Math.PI * 2);
      ctx.fill();
    } else if (f.kind === 'mark') { // a spell on its way down: the ring fills up until it lands
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.18 + 0.2 * (1 - k);
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.radius * (1 - k), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawHud(state, w, h) {
    const { ctx } = this;
    const p = state.player;
    ctx.textAlign = 'left';
    ctx.font = '14px monospace';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(10, 10, 260, 64);
    ctx.fillStyle = '#fff';
    ctx.fillText(t('hud.weapon', { name: t('weapon.' + p.weapon.id) }) + ` (${p.weapon.damage})`, 20, 30);
    const lo = loadoutOf(state);
    if (lo.off) ctx.fillText(t('hud.offhand', { name: t(`${lo.off.slot}.${lo.off.id}`) + (lo.off.slot === 'ammo' ? ` x${lo.off.count}` : '') }) + (lo.mode === 'idle' ? ' (idle)' : ''), 20, 66);
    ctx.fillText(t('hud.position', { x: Math.round(p.x / TILE), y: Math.round(p.y / TILE), fps: state.fps }), 20, 50);

    const touchMode = state.touch.enabled;
    if (touchMode) {
      // compact tappable slots: number + damage
      const active = slotOf(state);
      hotbarLayout(w, h, state.weapons.length).forEach((s, i) => {
        const wp = state.weapons[i];
        ctx.fillStyle = i === active ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.55)';
        ctx.fillRect(s.x, s.y, s.w, s.h);
        if (!wp) { // an empty set: bare fists
          ctx.strokeStyle = '#444';
          ctx.lineWidth = 2;
          ctx.strokeRect(s.x, s.y, s.w, s.h);
          ctx.globalAlpha = 0.6;
          drawItemIcon(ctx, FISTS, s.x + s.w / 2, s.y + s.h / 2 - 2, { scale: 2 });
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#bbb';
          ctx.textAlign = 'left';
          ctx.font = 'bold 12px monospace';
          ctx.fillText(String(i + 1), s.x + 4, s.y + 13);
          return;
        }
        ctx.strokeStyle = rarityById(wp.rarity).color;
        ctx.lineWidth = 2;
        ctx.strokeRect(s.x, s.y, s.w, s.h);
        drawItemIcon(ctx, wp, s.x + s.w / 2, s.y + s.h / 2 - 2, { scale: 2 });
        if (!canUse(state, wp)) unusable(ctx, s.x, s.y, s.w, s.h);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'left';
        ctx.font = 'bold 12px monospace';
        ctx.fillText(String(i + 1), s.x + 4, s.y + 13);
        ctx.textAlign = 'right';
        ctx.font = '11px monospace';
        ctx.fillText(String(wp.damage), s.x + s.w - 4, s.y + s.h - 4);
        if (state.offhands?.[i]) { // a dot: this slot has an off hand
          ctx.fillStyle = loadoutOf(state, i).mode === 'idle' ? '#ef9a9a' : '#c5e1a5';
          ctx.fillRect(s.x + s.w - 9, s.y + 4, 5, 5);
          ctx.fillStyle = '#fff';
        }
        ctx.textAlign = 'left';
      });
      ctx.font = '14px monospace';
    } else {
      const slotW = Math.min(170, Math.floor((w - 20) / state.weapons.length));
      const x0 = w / 2 - (state.weapons.length * slotW) / 2;
      const active = slotOf(state);
      state.weapons.forEach((wp, i) => {
        const sel = i === active;
        ctx.fillStyle = sel ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.55)';
        ctx.fillRect(x0 + i * slotW, h - 44, slotW - 6, 34);
        if (!wp) { // an empty set: bare fists
          ctx.strokeStyle = '#444';
          ctx.lineWidth = 2;
          ctx.strokeRect(x0 + i * slotW, h - 44, slotW - 6, 34);
          ctx.globalAlpha = 0.6;
          drawItemIcon(ctx, FISTS, x0 + i * slotW + 20, h - 27, { scale: 2 });
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#888';
          ctx.fillText(`${i + 1} ${t('weapon.fists')}`, x0 + i * slotW + 42, h - 22, slotW - 50);
          return;
        }
        ctx.strokeStyle = rarityById(wp.rarity).color;
        ctx.lineWidth = 2;
        ctx.strokeRect(x0 + i * slotW, h - 44, slotW - 6, 34);
        if (!canUse(state, wp)) unusable(ctx, x0 + i * slotW, h - 44, slotW - 6, 34);
        ctx.fillStyle = '#fff';
        const off = state.offhands?.[i];
        const sx = x0 + i * slotW;
        drawItemIcon(ctx, wp, sx + 20, h - 27, { scale: 2 });
        if (off) drawItemIcon(ctx, off, sx + 34, h - 17, { scale: 1 }); // what the other hand holds, small
        ctx.fillText(`${i + 1} ${wp.relic ? t('relic.' + wp.id) : t('weapon.' + wp.id)}`, sx + 42, off ? h - 28 : h - 22, slotW - 50);
        if (off) {
          ctx.font = '11px monospace';
          ctx.fillStyle = loadoutOf(state, i).mode === 'idle' ? '#ef9a9a' : '#c5e1a5';
          ctx.fillText('+ ' + t(`${off.slot}.${off.id}`) + (off.slot === 'ammo' ? ` x${off.count}` : ''), sx + 42, h - 15, slotW - 50);
          ctx.font = '14px monospace';
        }
      });
    }

    const barW = 240;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(10, 78, barW, 18);
    ctx.fillStyle = '#e53935';
    ctx.fillRect(10, 78, barW * (p.hp / p.maxHp), 18);
    ctx.fillStyle = '#fff';
    ctx.fillText(t('hud.hp', { hp: Math.ceil(p.hp), max: p.maxHp }), 16, 92);

    let by = 100; // the next bar
    if (p.maxMana > 0 && [...state.weapons, ...(state.offhands ?? [])].some((it) => it?.mana > 0)) { // mana, for a caster
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(10, by, barW, 14);
      ctx.fillStyle = '#5c6bc0';
      ctx.fillRect(10, by, barW * Math.max(0, Math.min(1, (p.mana ?? 0) / p.maxMana)), 14);
      ctx.fillStyle = '#fff';
      ctx.font = '12px monospace';
      ctx.fillText(t('hud.mana', { n: Math.floor(p.mana ?? 0), max: p.maxMana }), 16, by + 11);
      by += 18;
    }
    const need = xpToNext(p.level);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(10, by, barW, 14);
    ctx.fillStyle = '#42a5f5';
    ctx.fillRect(10, by, barW * (p.xp / need), 14);
    ctx.fillStyle = '#fff';
    ctx.font = '12px monospace';
    ctx.fillText(t('hud.level', { level: p.level, xp: p.xp, need }), 16, by + 11);
    ctx.font = '14px monospace';
    ctx.fillStyle = '#ffd54f';
    ctx.fillText(t('hud.gold', { n: p.gold }), 10, by + 32);
    let y = by + 50;
    if (p.skillPoints > 0) {
      ctx.fillStyle = Math.floor(performance.now() / 400) % 2 ? '#ffd54f' : '#fff';
      ctx.fillText(t(touchMode ? 'hud.points.touch' : 'hud.points', { n: p.skillPoints }), 10, y);
      y += 18;
    }
    if (p.attrPoints > 0) {
      ctx.fillStyle = Math.floor(performance.now() / 400) % 2 ? '#ffd54f' : '#fff';
      ctx.fillText(t(touchMode ? 'hud.attrPoints.touch' : 'hud.attrPoints', { n: p.attrPoints }), 10, y);
      y += 18;
    }
    this.drawQuestTracker(state, y + 4);
    this.drawBossBar(state, w, h);
    this.drawBoatHint(state, w, h);
    {
      const ms = touchMode ? 110 : 160;
      const tier = tierAtPx(p.x, p.y, this.world);
      ctx.textAlign = 'right';
      ctx.font = '12px sans-serif';
      ctx.fillStyle = state.town ? '#a5d6a7' : '#ffcc80';
      const stars = '★'.repeat(tier + 1) + '☆'.repeat(MAX_TIER - tier);
      let label = t('hud.danger', { stars });
      if (state.town) label = t('town.safe');
      if (state.area) label = t('hud.dungeon', { name: t('dungeon.theme.' + state.area.theme), stars: '★'.repeat(state.area.tier + 1) });
      ctx.fillText(label, w - 10, 10 + ms + 16);
      const pa = state.pulse?.active;
      if (pa && !state.area) { // what the Pulse changed here, and for how long
        ctx.fillStyle = '#ce93d8';
        ctx.fillText(t('hud.pulse', { what: t('pulse.name.' + pa.effect), time: mmss(pa.left) }), w - 10, 10 + ms + 34);
      }
      ctx.textAlign = 'left';
    }

    this.drawPulse(state, w, h);
    if (state.note && !state.ui.panel) this.drawNote(state.note, w, h);
    if (state.banner) {
      const b = state.banner;
      ctx.globalAlpha = Math.max(0, Math.min(1, b.t / 0.4, (3.5 - b.t) / 0.6));
      ctx.textAlign = 'center';
      ctx.font = 'bold 28px sans-serif';
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#000';
      const bannerText = b.text ?? t(b.key, { name: b.theme ? t('dungeon.theme.' + b.theme) : named(b.name, t('enemy.' + b.bossId)) });
      ctx.strokeText(bannerText, w / 2, 70);
      ctx.fillStyle = '#ffd54f';
      ctx.fillText(bannerText, w / 2, 70);
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    }
    if (state.town && !state.ui.panel) {
      ctx.textAlign = 'center';
      ctx.font = '13px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillText(t('town.safe'), w / 2, 94);
      ctx.textAlign = 'left';
    }

    if (state.ui.panel === 'skills') drawSkillTree(ctx, state, w, h);
    else if (state.ui.panel === 'hero') drawCharacter(ctx, state, w, h);
    else if (state.ui.panel === 'create') drawCreate(ctx, state, w, h);
    else if (state.ui.panel === 'inventory') drawInventory(ctx, state, w, h);
    else if (state.ui.panel === 'quests') drawDialog(ctx, state, w, h);
    else if (state.ui.panel === 'journal') drawJournal(ctx, state, w, h);
    else if (state.ui.panel === 'ending') drawEnding(ctx, w, h, setDone(state, 'night_shift'));
    else if (state.ui.panel === 'map') this.mapView.draw(ctx, state, w, h);
    else if (state.ui.panel === 'bestiary') drawBestiary(ctx, state, w, h);

    if (state.dead) {
      ctx.fillStyle = 'rgba(80,0,0,0.5)';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.font = 'bold 36px sans-serif';
      ctx.fillText(t('hud.dead'), w / 2, h / 2);
      ctx.font = '18px sans-serif';
      ctx.fillText(t('hud.respawn', { s: Math.ceil(state.deadTimer) }), w / 2, h / 2 + 32);
      ctx.textAlign = 'left';
    }
    if (touchMode) {
      if (!state.ui.panel) drawTouchControls(ctx, state.touch, state, w, h);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '14px monospace';
      ctx.fillText(t('hud.controls'), 20, h - 56);
    }
  }
}
