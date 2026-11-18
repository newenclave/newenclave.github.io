import { t } from '../core/i18n.js';
import { TILE, CHUNK, BIOME_IDS } from '../world/world.js';
import { guideWaypoint } from '../systems/quests.js';
import { lairById, LAIR_ID } from '../systems/lairs.js';
import { entranceById, DUNGEON_ID } from '../systems/dungeons.js';

// Half-size of a town's mark on the map, by size class (round towns of older worlds: 5).
const TOWN_MARK = { hamlet: 3, village: 4, town: 5, city: 6, capital: 8 };

const CLOSE_R = 20;
const MIN_TOUCH_R = 22;
const MARGIN = 30;
const MIN_SCALE = 0.4; // pixels per tile
const MAX_SCALE = 5;

export function hitMap(mx, my, w) {
  return Math.hypot(mx - (w - 34), my - 34) <= Math.max(CLOSE_R, MIN_TOUCH_R) ? { kind: 'close' } : null;
}

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// Draws the explored part of the world. One small canvas per explored chunk, redrawn only when it changes.
export class WorldMapView {
  constructor(world) {
    this.world = world;
    this.cache = new Map();
    this.rgb = Object.fromEntries(Object.entries(world.biomes).map(([name, b]) => [name, hexToRgb(b.color)]));
  }

  // How much lighter or darker a tile is drawn for the relief (world/mapgen/relief.js); 1 on a flat map.
  shade(tx, ty) {
    const w = this.world;
    if (!w.map?.height) return 1;
    const lv = w.heightAt(tx, ty);
    if (lv >= 4) return 1;
    const below = w.heightAt(tx, ty + 1);
    if (below < lv && !w.isRamp(tx, ty) && BIOME_IDS[w.tileAt(tx, ty + 1)] !== 'water') return 0.62;
    return 1 + 0.07 * lv;
  }

  chunkCanvas(chunk, explored) {
    const k = `${chunk.cx},${chunk.cy}`;
    let entry = this.cache.get(k);
    if (!entry) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = CHUNK;
      entry = { canvas, version: -1 };
      this.cache.set(k, entry);
    }
    if (entry.version !== chunk.version) {
      const g = entry.canvas.getContext('2d');
      const img = g.createImageData(CHUNK, CHUNK);
      for (let y = 0; y < CHUNK; y++) {
        for (let x = 0; x < CHUNK; x++) {
          const tx = chunk.cx * CHUNK + x;
          const ty = chunk.cy * CHUNK + y;
          if (!explored.has(tx, ty)) continue;
          const [r, gr, b] = this.rgb[BIOME_IDS[this.world.tileAt(tx, ty)]];
          const k = this.shade(tx, ty); // the relief: lighter up high, dark along the foot of a cliff
          const i = (y * CHUNK + x) * 4;
          img.data[i] = Math.min(255, r * k); img.data[i + 1] = Math.min(255, gr * k); img.data[i + 2] = Math.min(255, b * k); img.data[i + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
      entry.version = chunk.version;
    }
    return entry.canvas;
  }

  draw(ctx, state, w, h) {
    const p = state.player;
    const ex = state.explored;
    const ptx = p.x / TILE;
    const pty = p.y / TILE;

    // fit everything explored (plus the player) on the screen
    let minX = Math.floor(ptx / CHUNK);
    let maxX = minX;
    let minY = Math.floor(pty / CHUNK);
    let maxY = minY;
    for (const c of ex.chunks.values()) {
      minX = Math.min(minX, c.cx); maxX = Math.max(maxX, c.cx);
      minY = Math.min(minY, c.cy); maxY = Math.max(maxY, c.cy);
    }
    const cols = maxX - minX + 1;
    const rows = maxY - minY + 1;
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, (w - 2 * MARGIN) / (cols * CHUNK), (h - 110) / (rows * CHUNK)));
    const ox = (w - cols * CHUNK * scale) / 2 - minX * CHUNK * scale;
    const oy = 70 + ((h - 110) - rows * CHUNK * scale) / 2 - minY * CHUNK * scale;
    const sx = (tileX) => ox + tileX * scale;
    const sy = (tileY) => oy + tileY * scale;

    ctx.fillStyle = 'rgba(6,6,12,0.95)';
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(t(this.world.isDungeon ? 'map.title.dungeon' : 'map.title'), w / 2, 38);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#9e9e9e';
    ctx.font = '13px sans-serif';
    ctx.fillText(t('map.explored', { n: ex.tiles }), MARGIN, 38);

    ctx.strokeStyle = '#888';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(w - 34, 34, CLOSE_R, 0, Math.PI * 2);
    ctx.moveTo(w - 42, 26); ctx.lineTo(w - 26, 42);
    ctx.moveTo(w - 26, 26); ctx.lineTo(w - 42, 42);
    ctx.stroke();

    ctx.imageSmoothingEnabled = false;
    for (const chunk of ex.chunks.values()) {
      ctx.drawImage(this.chunkCanvas(chunk, ex), sx(chunk.cx * CHUNK), sy(chunk.cy * CHUNK), CHUNK * scale + 0.5, CHUNK * scale + 0.5);
    }
    ctx.imageSmoothingEnabled = true;

    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    for (const id of state.discovered) {
      if (LAIR_ID.test(id) || DUNGEON_ID.test(id)) continue; // lairs and dungeons are drawn below
      const town = this.world.getTownById(id);
      if (!town) continue;
      const x = sx(town.tx);
      const y = sy(town.ty);
      const r = TOWN_MARK[town.kind] ?? 5; // bigger towns get bigger marks
      ctx.fillStyle = '#ffd54f';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
      ctx.strokeRect(x - r, y - r, 2 * r, 2 * r);
      const name = t('town.name.' + town.nameIndex);
      ctx.lineWidth = 3;
      ctx.strokeText(name, x, y - r - 5);
      ctx.fillStyle = '#fff';
      ctx.fillText(name, x, y - r - 5);
    }

    for (const id of state.discovered) { // boss lairs: a red mark, grey while the boss is away
      const lair = LAIR_ID.test(id) ? lairById(this.world, id, state.bossDefs ?? []) : null;
      if (!lair) continue;
      const x = sx(lair.tx);
      const y = sy(lair.ty);
      const dead = (state.lairs?.get(lair.id)?.respawn ?? 0) > 0;
      ctx.fillStyle = dead ? '#757575' : '#e53935';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y - 7); ctx.lineTo(x + 7, y + 6); ctx.lineTo(x - 7, y + 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      const name = t('enemy.' + lair.bossId);
      ctx.lineWidth = 3;
      ctx.strokeText(name, x, y - 12);
      ctx.fillStyle = dead ? '#bdbdbd' : '#ffab91';
      ctx.fillText(name, x, y - 12);
    }

    for (const id of state.discovered) { // dungeon entrances: a purple door
      const e = DUNGEON_ID.test(id) ? entranceById(this.world, id, state.dungeonDefs) : null;
      if (!e) continue;
      const x = sx(e.tx);
      const y = sy(e.ty);
      ctx.fillStyle = '#ab47bc';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.fillRect(x - 5, y - 6, 10, 12);
      ctx.strokeRect(x - 5, y - 6, 10, 12);
      const name = t('dungeon.theme.' + e.theme);
      ctx.lineWidth = 3;
      ctx.strokeText(name, x, y - 12);
      ctx.fillStyle = '#ce93d8';
      ctx.fillText(name, x, y - 12);
    }

    const wp = guideWaypoint(state, this.world);
    if (wp) {
      const x = sx(wp.tx);
      const y = sy(wp.ty);
      if (wp.kind === 'area') { // the circle you search
        ctx.fillStyle = 'rgba(255,213,79,0.18)';
        ctx.beginPath();
        ctx.arc(x, y, Math.max(6, Math.abs(sx(wp.tx + wp.r / TILE) - x)), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = '#9ccc65';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, 10 + Math.abs(Math.sin(performance.now() / 400)) * 4, 0, Math.PI * 2);
      ctx.stroke();
      if (!state.discovered.has(wp.id)) { // undiscovered target: only a "?" is shown
        ctx.fillStyle = '#9ccc65';
        ctx.font = 'bold 16px sans-serif';
        ctx.fillText('?', x, y + 6);
      }
    }

    const px = sx(ptx);
    const py = sy(pty);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = 'left';
  }
}
